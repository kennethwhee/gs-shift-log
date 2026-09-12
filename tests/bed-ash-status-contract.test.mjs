import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import vm from 'node:vm';

// Exercise the existing production route, including its real session validation.
// The installer supplies the user's current OIS API as a validation dependency.
const sourcePath = process.env.BED_ASH_OIS_API_SOURCE || new URL('../functions/api/ois-data-requests.js', import.meta.url);
const productionSource = await readFile(sourcePath, 'utf8');

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE users(employee_no TEXT PRIMARY KEY, name TEXT, role TEXT, is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT, last_used_at TEXT);
    CREATE TABLE ois_data_requests(
      id TEXT PRIMARY KEY, request_type TEXT NOT NULL, target_date TEXT NOT NULL, status TEXT NOT NULL,
      requested_by_id TEXT, requested_by_name TEXT, requested_at TEXT, started_at TEXT, completed_at TEXT,
      agent_id TEXT, result_json TEXT, error_message TEXT, expires_at TEXT, updated_at TEXT);
  `);
  for (const [id, name] of [['2026001', 'BCO2'], ['2026002', 'TGO']]) {
    sqlite.prepare('INSERT INTO users VALUES (?,?,?,1)').run(id, name, 'user');
    sqlite.prepare('INSERT INTO shift_log_sessions VALUES (?,?,?,?)').run(
      createHash('sha256').update('session-' + id).digest('hex'), id,
      new Date(Date.now() + 3600000).toISOString(), new Date().toISOString());
  }
  const statements = [];
  const db = { prepare(sql) {
    statements.push(sql);
    const prepared = sqlite.prepare(sql);
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return prepared.get(...args) ?? null; },
      async all() { return { results: prepared.all(...args) }; },
      async run() { const outcome = prepared.run(...args); return { meta: { changes: outcome.changes } }; },
    };
  } };
  function insert(id, overrides = {}) {
    const now = new Date().toISOString();
    const row = {
      id, request_type: 'bed_ash_level', target_date: '2026-09-12', status: 'pending',
      requested_by_id: '2026001', requested_by_name: 'BCO2', requested_at: now,
      started_at: '', completed_at: '', agent_id: 'CCR-OIS-PC-01',
      result_json: '', error_message: '', expires_at: new Date(Date.now() + 3600000).toISOString(),
      updated_at: now, ...overrides,
    };
    sqlite.prepare(`INSERT INTO ois_data_requests (${Object.keys(row).join(',')})
      VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  }
  return { sqlite, db, statements, insert };
}

function createApi(rawSource = productionSource) {
  const globals = { crypto: webcrypto, Response, Request, URL, TextEncoder,
    console: { log() {}, error() {} },
    // This branch must never enter Blower helpers or make internal/full-range requests.
    fetch() { throw new Error('Status polling must not fetch another API'); },
    loadAppendBase() { throw new Error('Unrelated Blower helper invoked'); },
    ensureAppendSchema() { throw new Error('Unrelated Blower schema invoked'); },
    appendIntentStatement() { throw new Error('Unrelated Blower write invoked'); },
  };
  // Normalize only the VM's in-memory copy. Company sources may begin with a
  // UTF-8 BOM and use CRLF; neither changes the ES module's actual behavior.
  const source = rawSource.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '') +
    '\n;globalThis.handlers = { onRequestGet };';
  vm.runInNewContext(source, globals, { timeout: 3000 });
  return globals.handlers;
}

async function getStatus(api, db, ids, options = {}) {
  const query = new URLSearchParams({ action: 'status_batch', compact: '1' });
  if (ids !== undefined) query.set('ids', Array.isArray(ids) ? ids.join(',') : ids);
  const headers = { ...options.headers };
  const employeeNo = options.employeeNo === undefined ? '2026001' : options.employeeNo;
  if (employeeNo) headers.Authorization = 'Bearer session-' + employeeNo;
  const response = await api.onRequestGet({ env: { DB: db, OIS_AGENT_KEY: 'test-agent-key' },
    request: new Request('https://gs-shift-log.pages.dev/api/ois-data-requests?' + query, { headers }) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test('real status handler accepts LF/CRLF API copies with or without UTF-8 BOM', async t => {
  const { db, sqlite, insert } = createDatabase(); t.after(() => sqlite.close());
  insert('bed-encoding');
  const lf = productionSource.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (const newline of ['\n', '\r\n']) {
    for (const bom of ['', '\uFEFF']) {
      const input = bom + lf.replace(/\n/g, newline);
      const reply = await getStatus(createApi(input), db, ['bed-encoding']);
      assert.equal(reply.status, 200);
      assert.equal(reply.body.items[0].id, 'bed-encoding');
      assert.equal(reply.body.items[0].requestType, 'bed_ash_level');
      assert.equal(reply.body.items[0].status, 'pending');
    }
  }
});

test('compact Bed Ash status requires an active ordinary session; Agent key alone is insufficient', async t => {
  const { db, sqlite, insert, statements } = createDatabase(); t.after(() => sqlite.close());
  insert('bed-active');
  const api = createApi();
  for (const employeeNo of ['', 'unknown']) {
    const reply = await getStatus(api, db, ['bed-active'], { employeeNo,
      headers: { 'X-OIS-Agent-Key': 'test-agent-key', 'X-OIS-Agent-Id': 'CCR-OIS-PC-01' } });
    assert.equal(reply.status, 401);
  }
  sqlite.exec("UPDATE users SET is_active = 0 WHERE employee_no = '2026001'");
  assert.equal((await getStatus(api, db, ['bed-active'])).status, 401);
  sqlite.exec("UPDATE users SET is_active = 1; UPDATE shift_log_sessions SET expires_at = '2020-01-01T00:00:00Z'");
  assert.equal((await getStatus(api, db, ['bed-active'])).status, 401);
  assert.equal(statements.filter(sql => /FROM ois_data_requests/i.test(sql)).length, 0);
});

test('compact Bed Ash response carries only status metadata and performs one selected-ID read without detection or synchronization', async t => {
  const { db, sqlite, insert, statements } = createDatabase(); t.after(() => sqlite.close());
  insert('bed-complete', { status: 'complete', requested_by_id: '2026002',
    result_json: 'intentionally invalid result JSON: ' + 'X'.repeat(250000),
    completed_at: '2026-09-12T08:00:00.000Z' });
  const reply = await getStatus(createApi(), db, ['bed-complete']);
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.ok, true);
  assert.deepEqual(reply.body.requestedIds, ['bed-complete']);
  assert.deepEqual(reply.body.missingIds, []);
  assert.equal(reply.body.items.length, 1);
  const item = reply.body.items[0];
  assert.deepEqual(Object.keys(item).sort(), [
    'id', 'requestType', 'targetDate', 'status', 'requestedAt', 'startedAt', 'completedAt', 'errorMessage', 'disposition',
  ].sort());
  assert.equal(item.id, 'bed-complete');
  assert.equal(item.requestType, 'bed_ash_level');
  assert.equal(item.targetDate, '2026-09-12');
  assert.equal(item.status, 'complete');
  assert.equal(item.completedAt, '2026-09-12T08:00:00.000Z');
  assert.ok(JSON.stringify(reply.body).length < 1200, 'raw result must not be serialized into status response');
  assert.match(reply.headers.get('cache-control'), /no-store/);
  assert.equal(statements.length, 2, 'one session SELECT and one selected-ID SELECT only');
  assert.match(statements[0], /FROM shift_log_sessions/);
  assert.match(statements[1], /FROM ois_data_requests\s+WHERE id IN \(\?\)/);
  assert.ok(statements.every(sql => !/\b(?:UPDATE|INSERT|DELETE|CREATE)\b/i.test(sql)));
});

test('batch response preserves requested order, deduplicates IDs and reports the exact missing IDs', async t => {
  const { db, sqlite, insert } = createDatabase(); t.after(() => sqlite.close());
  insert('bed-first', { target_date: '2026-09-11', status: 'processing' });
  insert('bed-last', { status: 'complete' });
  const reply = await getStatus(createApi(), db, ['bed-last', 'missing-one', 'bed-first', 'bed-last', 'missing-two']);
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.deepEqual(reply.body.requestedIds, ['bed-last', 'missing-one', 'bed-first', 'missing-two']);
  assert.deepEqual(reply.body.items.map(item => item.id), ['bed-last', 'bed-first']);
  assert.deepEqual(reply.body.missingIds, ['missing-one', 'missing-two']);
  assert.equal(reply.body.items[1].targetDate, '2026-09-11');
});

test('status route supports every client batch size from 1 to 12 and rejects malformed input', async t => {
  const { db, sqlite, insert, statements } = createDatabase(); t.after(() => sqlite.close());
  const api = createApi();
  const twelve = Array.from({ length: 12 }, (_, index) => 'bed-' + index);
  for (const id of twelve) insert(id);
  // Bed Ash sends at most 12 IDs. Other features may increase the server's
  // shared upper limit; rejecting a 13th ID is not required by this client.
  for (let count = 1; count <= twelve.length; count++) {
    const requested = twelve.slice(0, count);
    const success = await getStatus(api, db, requested);
    assert.equal(success.status, 200, JSON.stringify(success.body));
    assert.deepEqual(success.body.requestedIds, requested);
    assert.deepEqual(success.body.items.map(item => item.id), requested);
    assert.deepEqual(success.body.missingIds, []);
  }
  const longestClientId = 'X'.repeat(128);
  insert(longestClientId);
  const longestReply = await getStatus(api, db, [longestClientId]);
  assert.equal(longestReply.status, 200, JSON.stringify(longestReply.body));
  assert.deepEqual(longestReply.body.items.map(item => item.id), [longestClientId]);
  const readCount = statements.filter(sql => /FROM ois_data_requests/i.test(sql)).length;
  for (const invalid of [undefined, '',
    'bed-valid,,bed-other', 'bed-valid,bad/id', 'bad id']) {
    const reply = await getStatus(api, db, invalid);
    assert.equal(reply.status, 400, JSON.stringify(reply.body));
    assert.equal(reply.body.ok, false);
  }
  assert.equal(statements.filter(sql => /FROM ois_data_requests/i.test(sql)).length, readCount);
});

test('polling expires only selected expired active requests and preserves unrelated and completed rows', async t => {
  const { db, sqlite, insert, statements } = createDatabase(); t.after(() => sqlite.close());
  const expired = '2020-01-01T00:00:00.000Z';
  insert('selected-pending', { expires_at: expired });
  insert('selected-processing', { status: 'processing', expires_at: expired, requested_by_id: '2026002' });
  insert('selected-complete', { status: 'complete', expires_at: expired, result_json: '{"unchanged":true}' });
  insert('selected-failed', { status: 'failed', expires_at: expired, error_message: 'Original failure' });
  insert('selected-unexpired');
  insert('selected-invalid-expiry', { expires_at: 'not-a-date' });
  insert('unselected-bed', { expires_at: expired });
  insert('unselected-blower', { request_type: 'blower_runtime_probe', status: 'processing', expires_at: expired });
  const before = sqlite.prepare('SELECT * FROM ois_data_requests ORDER BY id').all();
  const changedIds = ['selected-pending', 'selected-processing'];
  const reply = await getStatus(createApi(), db, [
    ...changedIds, 'selected-complete', 'selected-failed', 'selected-unexpired', 'selected-invalid-expiry',
  ]);
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  for (const id of changedIds) {
    const row = sqlite.prepare('SELECT * FROM ois_data_requests WHERE id = ?').get(id);
    assert.equal(row.status, 'failed');
    assert.match(row.error_message, /응답 시간이 초과/);
    assert.ok(Number.isFinite(Date.parse(row.completed_at)));
    assert.equal(reply.body.items.find(item => item.id === id).status, 'failed', 'response must reread updated status');
  }
  const unchangedAfter = sqlite.prepare('SELECT * FROM ois_data_requests ORDER BY id').all()
    .filter(row => !changedIds.includes(row.id));
  assert.deepEqual(unchangedAfter, before.filter(row => !changedIds.includes(row.id)));
  assert.equal(statements.filter(sql => /UPDATE ois_data_requests/i.test(sql)).length, 1);
  assert.equal(statements.filter(sql => /FROM ois_data_requests/i.test(sql)).length, 2);
  assert.ok(statements.every(sql => !/\b(?:INSERT|DELETE|CREATE)\b/i.test(sql)));
});

test('unknown statuses and non-Bed-Ash request types are preserved, so clients must validate tracked rows', async t => {
  const { db, sqlite, insert } = createDatabase(); t.after(() => sqlite.close());
  insert('bed-unknown', { status: 'paused_by_future_agent', expires_at: '2020-01-01T00:00:00.000Z' });
  insert('different-type', { request_type: 'daily_data_excel', status: 'complete' });
  const reply = await getStatus(createApi(), db, ['bed-unknown', 'different-type', 'missing-bed']);
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.items[0].status, 'paused_by_future_agent');
  assert.equal(reply.body.items[1].requestType, 'daily_data_excel');
  assert.deepEqual(reply.body.missingIds, ['missing-bed']);
  assert.equal(sqlite.prepare('SELECT status FROM ois_data_requests WHERE id = ?').get('bed-unknown').status,
    'paused_by_future_agent');
});
