import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet, onRequestPost } from '../functions/api/ois-data-requests.js';

// This fixture deliberately imports neither blower-history.js nor its helpers.
// All production behavior is exercised through the public API handlers.
const OWNER = 'queue-owner';
const TOKEN = 'queue-recovery-browser-token';
const OTHER_TOKEN = 'queue-recovery-other-token';
const AGENT_KEY = 'queue-recovery-agent-key';
const AGENT_ID = 'queue-recovery-agent';
const MARKER = 'BLOWER_GROUP_RETRY_REQUIRED';
const TAGS = [
  '104ETH03AN601', '104ETH03AN602', '104ETG30AN601', '104ETG30AN602',
  '204ETG30AN601', '204ETG30AN602', '104SDF01AN001', '104SDF01AN002',
  '204SDF01AN001', '204SDF01AN002', '204LMDF01AN001',
  '104HHL60AP611', '104HHL60AP621', '104HHL60AP631',
  '204HHL60AP611', '204HHL60AP621', '204HHL60AP631',
  '104HHL10AN611', '104HHL10AN621', '104HHL10AN631',
  '204HHL10AN611', '204HHL10AN621', '204HHL10AN631',
  '103HRJ01AN601', '103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'
];

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const database = {
    beforeBatch: null,
    prepare(sql) {
      return {
        sql, bindings: [],
        bind(...bindings) { this.bindings = bindings; return this; },
        async run() {
          const result = sqlite.prepare(this.sql).run(...this.bindings);
          return { meta: { changes: Number(result.changes) } };
        },
        async all() { return { results: sqlite.prepare(this.sql).all(...this.bindings) }; },
        async first() { return sqlite.prepare(this.sql).get(...this.bindings) || null; }
      };
    },
    async batch(statements) {
      if (this.beforeBatch) await this.beforeBatch(statements);
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  sqlite.exec(`
    CREATE TABLE users (employee_no TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL, is_active INTEGER NOT NULL);
    CREATE TABLE shift_log_sessions (token_hash TEXT PRIMARY KEY NOT NULL,
      employee_no TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT);
    CREATE TABLE ois_data_requests (
      id TEXT PRIMARY KEY NOT NULL, request_type TEXT NOT NULL, target_date TEXT NOT NULL,
      status TEXT NOT NULL, requested_by_id TEXT NOT NULL, requested_by_name TEXT NOT NULL,
      requested_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
      agent_id TEXT NOT NULL DEFAULT '', result_json TEXT, error_message TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE blower_runtime_probe_intents_v5 (
      request_id TEXT PRIMARY KEY NOT NULL, reuse_key TEXT UNIQUE, schema_version INTEGER NOT NULL,
      asset_tag TEXT NOT NULL, dataparc_tag TEXT NOT NULL, window_start TEXT NOT NULL,
      window_end TEXT NOT NULL, chunk_days INTEGER NOT NULL, chunk_count INTEGER NOT NULL,
      expected_last_replacement_at TEXT NOT NULL, expected_cycle_start_state TEXT NOT NULL,
      expected_cycle_started_at TEXT NOT NULL, expected_cycle_start_revision TEXT NOT NULL,
      expected_cycle_runtime_revision TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE blower_history_assets (tag_number TEXT PRIMARY KEY, runtime_hours REAL,
      is_running INTEGER, cycle_runtime_revision TEXT);
    CREATE TABLE blower_history_events (id TEXT PRIMARY KEY, tag_number TEXT,
      event_type TEXT, runtime_hours REAL, source_log_id TEXT);
    INSERT INTO blower_history_assets VALUES ('103HRJ01AN601', 1002.5, 1, 'preserve-runtime-revision');
    INSERT INTO blower_history_events VALUES ('already-applied-leader', '103HRJ01AN601',
      'runtime_correction', 1002.5, 'preserve-source');
  `);
  const nowMs = Math.floor(Date.now() / 1000) * 1000;
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + 3600000).toISOString();
  for (const [token, owner] of [[TOKEN, OWNER], [OTHER_TOKEN, 'other-owner']]) {
    sqlite.prepare('INSERT INTO users VALUES (?, ?, ?, 1)').run(owner, owner, 'user');
    sqlite.prepare('INSERT INTO shift_log_sessions VALUES (?, ?, ?, ?)').run(
      createHash('sha256').update(token).digest('hex'), owner, expiresAt, now
    );
  }
  return { sqlite, database, now, nowMs, expiresAt };
}

function insertRequest(f, { id, status = 'pending', owner = OWNER, tag = TAGS[0],
  type = 'blower_runtime_probe', expiresAt = f.expiresAt } = {}) {
  // The collector contract serializes chunk boundaries as KST without milliseconds.
  const kst = milliseconds => new Date(milliseconds + 9 * 3600000).toISOString().slice(0, 19) + '+09:00';
  const startAt = kst(f.nowMs - 3600000);
  const endAt = kst(f.nowMs);
  const signal = tag === '104ETH03AN602' ? 'GSPOGE.ABB_DCS.003ETH03AN602XB04'
    : /^(103|203)HRJ01AN60[12]$/.test(tag) ? `GSPOGE.ABB_DCS.${tag}XB04`
    : `GSPOGE.ABB_DCS.TEST_ONLY_BINARY_${tag}`;
  f.sqlite.prepare(`INSERT INTO ois_data_requests
    (id, request_type, target_date, status, requested_by_id, requested_by_name,
     requested_at, started_at, completed_at, agent_id, result_json, error_message, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Queue test', ?, ?, ?, ?, ?, '', ?, ?)`).run(
      id, type, `v1|${tag}|${startAt}|${endAt}`, status, owner,
      new Date(f.nowMs - 60000).toISOString(), status === 'pending' ? null : startAt,
      ['complete', 'failed'].includes(status) ? endAt : null,
      status === 'pending' ? '' : AGENT_ID,
      status === 'complete' ? JSON.stringify({ keep: 'completed-result', runningSeconds: 3609000 }) : null,
      expiresAt, endAt
    );
  f.sqlite.prepare(`INSERT INTO blower_runtime_probe_intents_v5
    (request_id, reuse_key, schema_version, asset_tag, dataparc_tag, window_start, window_end,
     chunk_days, chunk_count, expected_last_replacement_at, expected_cycle_start_state,
     expected_cycle_started_at, expected_cycle_start_revision, expected_cycle_runtime_revision,
     created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, 31, 1, ?, 'legacy', '', '', ?, ?, ?)`).run(
      id, `reuse:${id}`, tag, signal, startAt, endAt, startAt, `runtime:${tag}`, startAt, endAt
    );
  return id;
}

function seedGroup(f, count = 24, { leaderStatus = 'complete', owner = OWNER } = {}) {
  const prefix = `brb1_${randomUUID()}_${String(count).padStart(2, '0')}_`;
  return Array.from({ length: count }, (_, index) => insertRequest(f, {
    id: prefix + String(index).padStart(2, '0'),
    status: index === 0 ? leaderStatus : 'pending', owner, tag: TAGS[index]
  }));
}

async function api(f, handler, query = '', { headers = {}, body } = {}) {
  const response = await handler({
    request: new Request(`https://example.test/api/ois-data-requests${query ? '?' + query : ''}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }),
    env: { DB: f.database, OIS_AGENT_KEY: AGENT_KEY }
  });
  return { status: response.status, body: await response.json() };
}

function statusBatch(f, ids, token = TOKEN) {
  return api(f, onRequestGet, `action=status_batch&ids=${ids.join(',')}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

const agentHeaders = () => ({ 'X-OIS-Agent-Key': AGENT_KEY, 'X-OIS-Agent-Id': AGENT_ID });
const agentGet = (f, query) => api(f, onRequestGet, query, { headers: agentHeaders() });
const agentPost = (f, body) => api(f, onRequestPost, '', { headers: agentHeaders(), body });
const row = (f, id) => f.sqlite.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(id);
const intent = (f, id) => f.sqlite.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(id);
const queueSnapshot = f => JSON.stringify({
  requests: f.sqlite.prepare('SELECT * FROM ois_data_requests ORDER BY id').all(),
  intents: f.sqlite.prepare('SELECT * FROM blower_runtime_probe_intents_v5 ORDER BY request_id').all()
});
const historySnapshot = f => JSON.stringify({
  assets: f.sqlite.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all(),
  events: f.sqlite.prepare('SELECT * FROM blower_history_events ORDER BY id').all()
});

test('historical status reads without a V5 intent table do not migrate or retire requests', async t => {
  const f = fixture(t), ids = seedGroup(f);
  f.sqlite.exec('DROP TABLE blower_runtime_probe_intents_v5');
  const before = JSON.stringify(f.sqlite.prepare('SELECT * FROM ois_data_requests ORDER BY id').all());
  const response = await statusBatch(f, ids.slice(1));
  assert.equal(response.status, 200);
  assert.ok(response.body.items.every(item => item.status === 'pending'));
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM ois_data_requests ORDER BY id').all()), before);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='blower_runtime_probe_intents_v5'").get().n, 0);
});

test('owner confirmation retires all 23 orphan pending requests, releases only their keys, and preserves completed data', async t => {
  const f = fixture(t), ids = seedGroup(f);
  const leaderBefore = row(f, ids[0]), leaderIntentBefore = intent(f, ids[0]);
  const historyBefore = historySnapshot(f);
  const response = await statusBatch(f, ids.slice(1));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.items.length, 23);
  for (const item of response.body.items) {
    assert.equal(item.status, 'failed', item.id);
    assert.match(item.errorMessage, new RegExp(MARKER));
    const saved = row(f, item.id);
    assert.equal(saved.status, 'failed');
    assert.ok(saved.completed_at);
    assert.equal(saved.agent_id, '');
    assert.equal(saved.result_json, null);
    assert.equal(intent(f, item.id).reuse_key, null);
  }
  assert.deepEqual(row(f, ids[0]), leaderBefore);
  assert.deepEqual(intent(f, ids[0]), leaderIntentBefore);
  assert.equal(historySnapshot(f), historyBefore);
  const settled = queueSnapshot(f);
  await statusBatch(f, ids.slice(1));
  assert.equal(queueSnapshot(f), settled, 'confirmation is idempotent');
});

test('only selected pending IDs are retired; unselected siblings and another request for the same asset remain intact', async t => {
  const f = fixture(t), ids = seedGroup(f);
  const outside = insertRequest(f, { id: 'outside-same-asset', tag: TAGS[1] });
  const untouched = new Map([ids[0], ...ids.slice(3), outside].map(id => [id, [row(f, id), intent(f, id)]]));
  const response = await statusBatch(f, [ids[1], ids[2], outside]);
  assert.equal(response.status, 200);
  for (const id of ids.slice(1, 3)) {
    assert.equal(row(f, id).status, 'failed');
    assert.equal(intent(f, id).reuse_key, null);
  }
  for (const [id, before] of untouched) assert.deepEqual([row(f, id), intent(f, id)], before, id);
});

for (const [label, token, expectedStatus] of [['non-owner', OTHER_TOKEN, 200], ['unauthenticated', null, 401]]) {
  test(`${label} cannot retire another owner's orphan group`, async t => {
    const f = fixture(t), ids = seedGroup(f), before = queueSnapshot(f);
    const response = await statusBatch(f, ids.slice(1), token);
    assert.equal(response.status, expectedStatus);
    assert.equal(queueSnapshot(f), before);
  });
}

for (const [label, mutate] of [
  ['missing sibling', (f, ids) => f.sqlite.prepare('DELETE FROM ois_data_requests WHERE id=?').run(ids.at(-1))],
  ['missing leader', (f, ids) => f.sqlite.prepare('DELETE FROM ois_data_requests WHERE id=?').run(ids[0])],
  ['wrong-owner leader', (f, ids) => f.sqlite.prepare("UPDATE ois_data_requests SET requested_by_id='other-owner' WHERE id=?").run(ids[0])],
  ['wrong-owner sibling', (f, ids) => f.sqlite.prepare("UPDATE ois_data_requests SET requested_by_id='other-owner' WHERE id=?").run(ids.at(-1))],
  ['wrong-type leader', (f, ids) => f.sqlite.prepare("UPDATE ois_data_requests SET request_type='water_environment' WHERE id=?").run(ids[0])],
  ['failed leader', (f, ids) => f.sqlite.prepare("UPDATE ois_data_requests SET status='failed' WHERE id=?").run(ids[0])],
  ['pending leader', (f, ids) => f.sqlite.prepare("UPDATE ois_data_requests SET status='pending' WHERE id=?").run(ids[0])],
  ['malformed sibling index', (f, ids) => f.sqlite.prepare('UPDATE ois_data_requests SET id=? WHERE id=?').run(ids[0].slice(0, -2) + '99', ids.at(-1))]
]) {
  test(`${label} prevents orphan retirement`, async t => {
    const f = fixture(t), ids = seedGroup(f);
    mutate(f, ids);
    const before = queueSnapshot(f);
    const response = await statusBatch(f, ids.slice(1));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(queueSnapshot(f), before);
  });
}

for (const expired of [false, true]) {
  test(`an ${expired ? 'expired' : 'unexpired'} processing sibling prevents retirement even when omitted from selected IDs`, async t => {
    const f = fixture(t), ids = seedGroup(f);
    f.sqlite.prepare("UPDATE ois_data_requests SET status='processing',agent_id=?,expires_at=? WHERE id=?").run(
      AGENT_ID, expired ? new Date(f.nowMs - 60000).toISOString() : f.expiresAt, ids[1]
    );
    const before = queueSnapshot(f);
    const response = await statusBatch(f, ids.slice(2));
    assert.equal(response.status, 200);
    assert.equal(queueSnapshot(f), before);
  });
}

for (const [label, sql] of [
  ['started timestamp', "UPDATE ois_data_requests SET started_at=? WHERE id=?"],
  ['Agent assignment', "UPDATE ois_data_requests SET agent_id=? WHERE id=?"]
]) {
  test(`a pending row with an existing ${label} is preserved`, async t => {
    const f = fixture(t), ids = seedGroup(f);
    f.sqlite.prepare(sql).run(label === 'started timestamp' ? f.now : AGENT_ID, ids[1]);
    const before = queueSnapshot(f);
    const response = await statusBatch(f, [ids[1]]);
    assert.equal(response.status, 200);
    assert.equal(queueSnapshot(f), before);
  });
}

test('previously completed and failed siblings remain byte-for-byte intact', async t => {
  const f = fixture(t), ids = seedGroup(f);
  f.sqlite.prepare("UPDATE ois_data_requests SET status='complete',result_json=?,completed_at=? WHERE id=?").run(
    JSON.stringify({ saved: 'second-complete' }), f.now, ids[1]
  );
  f.sqlite.prepare("UPDATE ois_data_requests SET status='failed',error_message='prior failure',completed_at=? WHERE id=?").run(f.now, ids[2]);
  const before = [ids[0], ids[1], ids[2]].map(id => [row(f, id), intent(f, id)]);
  const response = await statusBatch(f, ids.slice(1));
  assert.equal(response.status, 200);
  for (const id of ids.slice(3)) {
    assert.equal(row(f, id).status, 'failed');
    assert.equal(intent(f, id).reuse_key, null);
  }
  assert.deepEqual([ids[0], ids[1], ids[2]].map(id => [row(f, id), intent(f, id)]), before);
});

test('failure while clearing a reuse key rolls back every request retirement', async t => {
  const f = fixture(t), ids = seedGroup(f), before = queueSnapshot(f);
  // The public handler logs the deliberately injected transaction failure.
  t.mock.method(console, 'error', () => {});
  f.sqlite.exec(`CREATE TRIGGER reject_reuse_release BEFORE UPDATE OF reuse_key ON blower_runtime_probe_intents_v5
    WHEN OLD.request_id='${ids[1]}' AND NEW.reuse_key IS NULL
    BEGIN SELECT RAISE(ABORT, 'injected-reuse-release-failure'); END;`);
  const response = await statusBatch(f, ids.slice(1));
  assert.equal(response.status, 500);
  assert.equal(queueSnapshot(f), before);
});

test('a pending-to-processing race before the mutation transaction preserves the entire group', async t => {
  const f = fixture(t), ids = seedGroup(f);
  let raced = false;
  f.database.beforeBatch = statements => {
    const recovery = statements.some(statement => /UPDATE\s+ois_data_requests/i.test(statement.sql)
      && (statement.sql.includes(MARKER) || statement.bindings.some(value => String(value).includes(MARKER))));
    if (!recovery || raced) return;
    raced = true;
    f.sqlite.prepare("UPDATE ois_data_requests SET status='processing',agent_id=? WHERE id=?").run(AGENT_ID, ids[1]);
  };
  const keysBefore = ids.map(id => intent(f, id));
  const response = await statusBatch(f, ids.slice(1));
  assert.equal(response.status, 200);
  assert.equal(raced, true, 'the test must race the actual retirement transaction');
  assert.equal(row(f, ids[0]).status, 'complete');
  assert.equal(row(f, ids[1]).status, 'processing');
  for (const id of ids.slice(2)) assert.equal(row(f, id).status, 'pending');
  assert.deepEqual(ids.map(id => intent(f, id)), keysBefore);
});

function zeroRuntimeResult(item) {
  const probe = item.probe;
  return {
    ...probe, schemaVersion: 1, requestType: 'blower_runtime_probe', requestId: item.id,
    ok: true, readOnly: true, observedAt: probe.endAt, collectedAt: new Date().toISOString(),
    completedChunkCount: 1, startState: 'stopped', endState: 'stopped',
    totalRunningHours: 0, runningSeconds: 0,
    chunks: [{ index: 1, startAt: probe.startAt, endAt: probe.endAt,
      startState: 'stopped', endState: 'stopped', totalRunningHours: 0, runningSeconds: 0 }]
  };
}

test('limit zero reports live cap 26 without claiming; values above 26 are rejected', async t => {
  const f = fixture(t);
  seedGroup(f, 27, { leaderStatus: 'pending' });
  const before = queueSnapshot(f);
  for (const limit of [0, 27, 99]) {
    const response = await agentGet(f, `action=next_blower_batch&limit=${limit}`);
    assert.equal(response.status, 400);
    assert.match(response.body.message, /1 이상 26 이하/);
    assert.equal(response.body.code, 'BLOWER_LIMIT_VALIDATION_V7');
    assert.equal(response.body.queueRecoveryVersion, 7);
    assert.equal(response.body.maxAdditionalClaims, 26);
    assert.equal(response.body.maxCompletionItems, 27);
    assert.equal(queueSnapshot(f), before);
  }
});

test('a full 27-member group claims its leader plus 26 siblings and accepts all 27 valid completion results', async t => {
  const f = fixture(t), ids = seedGroup(f, 27, { leaderStatus: 'pending' });
  const historyBefore = historySnapshot(f);
  const first = await agentGet(f, 'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.items.excel?.id, ids[0], JSON.stringify(first.body));
  const extra = await agentGet(f, 'action=next_blower_batch&limit=26');
  assert.equal(extra.status, 200, JSON.stringify(extra.body));
  assert.equal(extra.body.items.length, 26, JSON.stringify(extra.body));
  const claimed = [first.body.items.excel, ...extra.body.items];
  assert.deepEqual(claimed.map(item => item.id), ids);
  for (const id of ids) assert.equal(row(f, id).status, 'processing');
  const completionItems = claimed.map(item => ({ requestId: item.id, result: zeroRuntimeResult(item) }));
  const tooMany = await agentPost(f, { action: 'complete_blower_runtime_probe_batch', items: [...completionItems, completionItems[0]] });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.message, /27/);
  for (const id of ids) assert.equal(row(f, id).status, 'processing');
  const completed = await agentPost(f, { action: 'complete_blower_runtime_probe_batch', items: completionItems });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.items.length, 27);
  assert.ok(completed.body.items.every(item => item.ok === true), JSON.stringify(completed.body));
  assert.ok(completed.body.items.every(item => item.status === 'complete'), JSON.stringify(completed.body));
  for (const id of ids) {
    const saved = row(f, id);
    assert.equal(saved.status, 'complete', id);
    const result = JSON.parse(saved.result_json);
    assert.equal(result.requestId, id);
    assert.equal(result.runningSeconds, 0);
    assert.equal(result.completedChunkCount, 1);
    assert.equal(result.chunks.length, 1);
  }
  assert.equal(historySnapshot(f), historyBefore, 'queue completion does not apply or rewrite runtime history');
  const afterCompletion = queueSnapshot(f);
  const replay = await agentPost(f, { action: 'complete_blower_runtime_probe_batch', items: completionItems });
  assert.equal(replay.status, 200);
  assert.ok(replay.body.items.every(item => item.ok === true), JSON.stringify(replay.body));
  assert.equal(queueSnapshot(f), afterCompletion, 'completion replay is idempotent');
});
