import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const api = await import('../functions/api/cofiring-inventory-corrections.js');
const token = 'inventory-correction-test';
const tokenHash = createHash('sha256').update(token).digest('hex');
const boundary = '2026-10-24T00:00';
let sequence = 0;

function database(t) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
    CREATE TABLE solid_fuel_unloading_logs(
      id TEXT PRIMARY KEY, source_key TEXT, unloading_date TEXT, arrival_time TEXT, departure_time TEXT,
      duration_minutes INTEGER, duration_known INTEGER, company_name TEXT, vehicle_no TEXT, silo_route TEXT,
      fuel_type TEXT, receipt_tons REAL, note TEXT, version INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,result_json TEXT);
    CREATE TABLE cofiring_closed_snapshots(target_date TEXT PRIMARY KEY,snapshot_json TEXT);
    INSERT INTO ois_data_requests VALUES ('original','{"organicInventory":null,"quality":"Raw, Bad"}');
    INSERT INTO cofiring_closed_snapshots VALUES ('2026-10-23','{"saved":"unchanged"}');
  `);
  raw.prepare('INSERT INTO users VALUES(?,?,?,?)').run('tester', '시험 사용자', 'user', 1);
  raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(tokenHash, 'tester', '2099-01-01T00:00:00Z', '');
  t.after(() => raw.close());
  const statements = [];
  return { raw, statements, prepare(sql) {
    statements.push(sql);
    let parameters = [];
    return {
      bind(...values) { parameters = values; return this; },
      async first() { return raw.prepare(sql).get(...parameters) ?? null; },
      async all() { return { results: raw.prepare(sql).all(...parameters) }; },
      async run() { const result = raw.prepare(sql).run(...parameters); return { success: true, meta: { changes: Number(result.changes) } }; }
    };
  } };
}

function addReceipt(DB, changes = {}) {
  const row = {
    id: 'receipt-001', source_key: 'manual-1', unloading_date: '2026-10-24', arrival_time: '23:30', departure_time: '00:20',
    duration_minutes: 50, duration_known: 1, company_name: '시험 운송', vehicle_no: '1234', silo_route: '#A → #B → Day',
    fuel_type: 'organic', receipt_tons: 20, note: '자정 통과 하역', version: 1,
    created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z', deleted_at: null,
    ...changes
  };
  const keys = Object.keys(row);
  DB.raw.prepare(`INSERT INTO solid_fuel_unloading_logs(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
  return row;
}

function body(changes = {}) {
  return {
    silo: 'organicStorageSiloB', boundaryLocal: boundary, tons: 30.19, method: 'confirmed',
    reason: '운전 기록과 현장 확인으로 경계 재고를 확인함', evidence: [], expectedRevision: 0,
    requestId: String(++sequence).padStart(32, '0'), ...changes
  };
}

async function call(DB, { method = 'GET', start = '2026-10-23T00:00', end = boundary, value, auth = true, headers = {}, rawBody } = {}) {
  const request = new Request(`https://shift.test/api/cofiring-inventory-corrections?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-ShiftLog-Client': 'desktop' } : {}), ...headers },
    ...(method === 'POST' ? { body: rawBody ?? JSON.stringify(value) } : {})
  });
  const response = await (method === 'POST' ? api.onRequestPost : api.onRequestGet)({ request, env: { DB } });
  return { status: response.status, data: await response.json() };
}

test('inventory correction keeps absent values absent and accepts an explicit zero only', async t => {
  const DB = database(t);
  const empty = await call(DB);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.entries, []);
  for (const tons of [null, '', false, -1, 1000001, 0.1234567]) {
    assert.equal((await call(DB, { method: 'POST', value: body({ tons }) })).status, 400, `tons=${JSON.stringify(tons)}`);
  }
  const missing = body(); delete missing.tons;
  assert.equal((await call(DB, { method: 'POST', value: missing })).status, 400);
  const saved = await call(DB, { method: 'POST', value: body({ tons: 0 }) });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.entry.tons, 0);
  assert.equal(saved.data.entry.method, 'confirmed');
  assert.equal(saved.data.entry.updatedById, 'tester');
});

test('one canonical midnight correction is shared by the previous end and next start', async t => {
  const DB = database(t);
  assert.equal((await call(DB, { method: 'POST', value: body() })).status, 200);
  const previous = await call(DB);
  const next = await call(DB, { start: boundary, end: '2026-10-25T00:00' });
  assert.equal(previous.data.entries.length, 1);
  assert.deepEqual(next.data.entries, previous.data.entries);
  assert.deepEqual((await call(DB, { start: '2026-10-24T00:01', end: '2026-10-25T00:00' })).data.entries, []);
});

test('append-only revisions and request identities reject lost updates and replay exactly', async t => {
  const DB = database(t);
  const first = body();
  const saved = await call(DB, { method: 'POST', value: first });
  assert.equal(saved.status, 200);
  const replay = await call(DB, { method: 'POST', value: first });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.entry, saved.data.entry);
  assert.equal((await call(DB, { method: 'POST', value: { ...first, tons: 31 } })).status, 409);
  assert.equal((await call(DB, { method: 'POST', value: body({ tons: 31 }) })).status, 409);
  const second = await call(DB, { method: 'POST', value: body({ tons: 31, expectedRevision: 1, method: 'estimated', reason: '통신 복구 후 인접 관측으로 추정' }) });
  assert.equal(second.status, 200);
  assert.equal(second.data.entry.revision, 2);
  assert.equal(second.data.entry.method, 'estimated');
  const state = (await call(DB)).data;
  assert.equal(state.entries[0].tons, 31);
  assert.equal(state.entries[0].revision, 2);
  assert.ok(state.history.some(entry => entry.revision === 1 && entry.tons === 30.19));
  assert.deepEqual(DB.raw.prepare('SELECT * FROM ois_data_requests').all().map(row => ({ ...row })), [{ id: 'original', result_json: '{"organicInventory":null,"quality":"Raw, Bad"}' }]);
  assert.equal(DB.raw.prepare('SELECT snapshot_json FROM cofiring_closed_snapshots').get().snapshot_json, '{"saved":"unchanged"}');
});

test('two concurrent writers cannot both win the same expected revision', async t => {
  const DB = database(t);
  const results = await Promise.all([
    call(DB, { method: 'POST', value: body({ tons: 12 }) }),
    call(DB, { method: 'POST', value: body({ tons: 15 }) })
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const state = (await call(DB)).data;
  assert.equal(state.entries[0].revision, 1);
  assert.equal(state.history.length, 1);
});

test('correction evidence is server-snapshotted and does not allocate a mixed truck route', async t => {
  const DB = database(t); addReceipt(DB);
  const first = body({ evidence: [{ id: 'receipt-001', version: 1 }] });
  const saved = await call(DB, { method: 'POST', value: first });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.entry.evidence, first.evidence);
  assert.equal(saved.data.entry.evidenceSnapshots.length, 1);
  const evidence = saved.data.entry.evidenceSnapshots[0];
  assert.equal(evidence.siloRoute, '#A → #B → Day');
  assert.equal(evidence.receiptTons, 20);
  assert.equal(saved.data.entry.tons, 30.19);
  DB.raw.prepare('UPDATE solid_fuel_unloading_logs SET version=2, receipt_tons=25 WHERE id=?').run('receipt-001');
  const read = await call(DB);
  assert.equal(read.data.entries[0].evidenceSnapshots[0].receiptTons, 20);
  const replay = await call(DB, { method: 'POST', value: first });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal((await call(DB, { method: 'POST', value: body({ expectedRevision: 1, evidence: first.evidence }) })).status, 409);
});

test('missing, deleted, stale and foreign-period evidence cannot certify a new correction', async t => {
  const DB = database(t);
  addReceipt(DB, { id: 'deleted', deleted_at: '2026-10-25T00:00:00Z' });
  addReceipt(DB, { id: 'stale', version: 2 });
  addReceipt(DB, { id: 'foreign', unloading_date: '2026-09-01' });
  for (const id of ['missing', 'deleted', 'stale', 'foreign']) {
    assert.equal((await call(DB, { method: 'POST', value: body({ evidence: [{ id, version: 1 }] }) })).status, 409, id);
  }
  assert.deepEqual((await call(DB)).data.entries, []);
});

test('an evidence edit between review and the SQL append rejects the entire correction', async t => {
  const DB = database(t); addReceipt(DB);
  const originalPrepare = DB.prepare.bind(DB);
  let changed = false;
  DB.prepare = sql => {
    const statement = originalPrepare(sql);
    if (/INSERT INTO cofiring_inventory_correction_history/.test(sql)) {
      const originalRun = statement.run.bind(statement);
      statement.run = async () => {
        DB.raw.prepare('UPDATE solid_fuel_unloading_logs SET version=2, receipt_tons=25 WHERE id=?').run('receipt-001');
        changed = true;
        return originalRun();
      };
    }
    return statement;
  };
  const response = await call(DB, { method: 'POST', value: body({ evidence: [{ id: 'receipt-001', version: 1 }] }) });
  assert.equal(changed, true);
  assert.equal(response.status, 409);
  assert.deepEqual((await call(DB)).data.entries, []);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM cofiring_inventory_correction_history').get().n, 0);
});

test('correction write guards enforce authentication, origin, desktop, shape and bounds', async t => {
  const DB = database(t);
  assert.equal((await call(DB, { auth: false })).status, 401);
  assert.equal((await call(DB, { method: 'POST', auth: false, value: body() })).status, 401);
  assert.equal((await call(DB, { method: 'POST', value: body(), headers: { Origin: 'https://elsewhere.test' } })).status, 403);
  assert.equal((await call(DB, { method: 'POST', value: body(), headers: { 'User-Agent': 'iPhone Mobile' } })).status, 403);
  assert.equal((await call(DB, { method: 'POST', value: body(), headers: { 'X-ShiftLog-Client': '' } })).status, 403);
  for (const change of [
    { silo: 'someOtherTag' }, { boundaryLocal: '2026-02-30T00:00' }, { boundaryLocal: boundary + ':00' },
    { reason: '' }, { reason: 'x'.repeat(1001) }, { method: 'Raw, Good' }, { expectedRevision: -1 },
    { evidence: [{ id: 'receipt-001', version: 0 }] }, { evidence: [{ id: 'receipt-001', version: 1, receiptTons: 10 }] },
    { unexpected: true }
  ]) assert.equal((await call(DB, { method: 'POST', value: body(change) })).status, 400, JSON.stringify(change));
  assert.equal((await call(DB, { method: 'POST', rawBody: '{' })).status, 400);
  assert.equal((await call(DB, { method: 'POST', rawBody: ' '.repeat(16385) })).status, 413);
  assert.equal((await call(DB, { start: boundary, end: boundary })).status, 400);
  assert.deepEqual((await call(DB)).data.entries, []);
});
