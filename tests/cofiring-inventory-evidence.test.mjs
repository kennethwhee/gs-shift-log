import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const api = await import('../functions/api/solid-fuel-trouble.js');
const token = 'inventory-evidence-test';
const tokenHash = createHash('sha256').update(token).digest('hex');

function database(t) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
    CREATE TABLE solid_fuel_unloading_logs(
      id TEXT PRIMARY KEY,source_key TEXT,unloading_date TEXT,arrival_time TEXT,departure_time TEXT,
      duration_minutes INTEGER,duration_known INTEGER,company_name TEXT,vehicle_no TEXT,silo_route TEXT,
      fuel_type TEXT,receipt_tons REAL,note TEXT,version INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT
    );
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

function add(DB, changes = {}) {
  const row = {
    id: 'cross-midnight', source_key: '', unloading_date: '2026-10-24', arrival_time: '23:30', departure_time: '00:20',
    duration_minutes: 50, duration_known: 1, company_name: '시험 운송', vehicle_no: '1234', silo_route: '#A → #B → Day',
    fuel_type: 'organic', receipt_tons: 20, note: '자정 통과', version: 3,
    created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z', deleted_at: null,
    ...changes
  };
  const keys = Object.keys(row);
  DB.raw.prepare(`INSERT INTO solid_fuel_unloading_logs(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
}

async function call(DB, { boundary = '2026-10-24T00:00', auth = true } = {}) {
  const request = new Request(`https://shift.test/api/solid-fuel-trouble?inventoryBoundary=${encodeURIComponent(boundary)}`, {
    headers: auth ? { Authorization: `Bearer ${token}` } : {}
  });
  const response = await api.onRequestGet({ request, env: { DB } });
  return { status: response.status, data: await response.json() };
}

test('inventory evidence retains completion-date semantics across midnight without allocating truck weight', async t => {
  const DB = database(t); add(DB);
  const response = await call(DB);
  assert.equal(response.status, 200);
  assert.equal(response.data.boundaryLocal, '2026-10-24T00:00');
  assert.equal(response.data.source, 'solid-fuel-unloading');
  assert.equal(response.data.basis, 'completed-unloading-departure');
  assert.equal(response.data.truncated, false);
  assert.equal(response.data.records.length, 1);
  const row = response.data.records[0];
  assert.equal(row.arrivalLocal, '2026-10-23T23:30');
  assert.equal(row.departureLocal, '2026-10-24T00:20');
  assert.equal(row.unloadingDate, '2026-10-24');
  assert.equal(row.receiptTons, 20);
  assert.equal(row.siloRoute, '#A → #B → Day');
  assert.equal(row.version, 3);
  assert.ok(row.flags.includes('crosses-boundary'));
  assert.ok(row.flags.includes('silo-allocation-unknown'));
  assert.equal(Object.hasOwn(row, 'organicStorageSiloB'), false);
  assert.equal(Object.hasOwn(row, 'beforeBoundaryTons'), false);
  assert.equal(Object.hasOwn(row, 'afterBoundaryTons'), false);
});

test('unknown and in-progress evidence is retained while deleted and remote records stay out', async t => {
  const DB = database(t);
  add(DB, { id: 'in-progress', unloading_date: '2026-10-23', arrival_time: '23:40', departure_time: '', duration_known: 0, duration_minutes: 0, receipt_tons: null, fuel_type: '', silo_route: '' });
  add(DB, { id: 'missing-arrival', arrival_time: '', departure_time: '00:05', duration_known: 0, receipt_tons: null, silo_route: '#B' });
  add(DB, { id: 'deleted', deleted_at: '2026-10-24T01:00:00Z' });
  add(DB, { id: 'remote', unloading_date: '2026-09-01' });
  const response = await call(DB);
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.records.map(row => row.id).sort(), ['in-progress', 'missing-arrival']);
  const progress = response.data.records.find(row => row.id === 'in-progress');
  assert.equal(progress.arrivalLocal, null, 'completion date cannot establish arrival date until departure is known');
  assert.equal(progress.departureLocal, null);
  assert.equal(progress.receiptTons, null);
  assert.equal(progress.durationKnown, false);
  for (const flag of ['arrival-time-unknown', 'departure-time-unknown', 'duration-unknown', 'receipt-tons-unknown', 'fuel-type-unknown', 'silo-allocation-unknown']) assert.ok(progress.flags.includes(flag), flag);
  const unknown = response.data.records.find(row => row.id === 'missing-arrival');
  assert.equal(unknown.arrivalLocal, null);
  assert.equal(unknown.departureLocal, '2026-10-24T00:05');
});

test('a truck completed exactly at midnight retains that completion date and is not marked crossing it', async t => {
  const DB = database(t);
  add(DB, { id: 'midnight-completion', arrival_time: '23:50', departure_time: '00:00', duration_minutes: 10, silo_route: '#B' });
  const response = await call(DB);
  assert.equal(response.status, 200);
  const row = response.data.records[0];
  assert.equal(row.arrivalLocal, '2026-10-23T23:50');
  assert.equal(row.departureLocal, '2026-10-24T00:00');
  assert.equal(row.unloadingDate, '2026-10-24');
  assert.equal(row.flags.includes('crosses-boundary'), false);
  assert.equal(row.receiptTons, 20);
});

test('evidence fetch is bounded and discloses truncation without photo repair or initialization writes', async t => {
  const DB = database(t);
  for (let index = 0; index < 2100; index++) add(DB, { id: `bounded-${String(index).padStart(4, '0')}` });
  const response = await call(DB);
  assert.equal(response.status, 200);
  assert.equal(response.data.truncated, true);
  assert.equal(response.data.records.length, 400);
  assert.ok(response.data.windowStart);
  assert.ok(response.data.windowEnd);
  assert.equal(DB.statements.some(sql => /(?:CREATE\s+TABLE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:solid_fuel|cofiring)/i.test(sql)), false);
  assert.equal(DB.statements.some(sql => /solid_fuel_(?:trouble_photos|photo_repair_state)/i.test(sql)), false);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM solid_fuel_unloading_logs').get().n, 2100);
});

test('evidence requires a session and a valid canonical local minute', async t => {
  const DB = database(t);
  assert.equal((await call(DB, { auth: false })).status, 401);
  for (const boundary of ['2026-02-30T00:00', '2026-10-24T24:00', '2026-10-24', '2026-10-24T00:00:00']) {
    assert.equal((await call(DB, { boundary })).status, 400, boundary);
  }
  const empty = await call(DB);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.records, []);
  assert.equal(empty.data.truncated, false);
});
