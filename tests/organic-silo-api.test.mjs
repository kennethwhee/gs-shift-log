import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { onRequestGet, onRequestPost, __oisDataRequestsTest } from '../functions/api/ois-data-requests.js';

// node:sqlite is optional: deployed Agent Node versions need not provide a test-only dependency.
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
const sqliteTestOptions = {
  skip: DatabaseSync ? false : 'node:sqlite unavailable; SQLite API integration test skipped (pure validators still run)'
};

const { normalizeOrganicSiloDataParcResult: validate, isOrganicSiloQualityGood: good } = __oisDataRequestsTest;
const TYPE = 'organic_silo_dataparc';
const DAY = '2026-08-01';
const TAGS = [
  ['organicDaySilo', 'Day Silo', 'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT', 10.216522216796875],
  ['organicStorageSiloA', 'Storage A', 'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT', 0.1611328125],
  ['organicStorageSiloB', 'Storage B', 'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT', 9.6826171875]
];
function result() {
  return { schemaVersion: 1, source: 'dataparc_hidden_excel', targetDate: DAY, aggregation: 'End', step: '1D',
    intervalStartKst: `${DAY}T00:00:00+09:00`, intervalEndKst: '2026-08-02T00:00:00+09:00',
    ...Object.fromEntries(TAGS.map(([key, , , value]) => [key, value])), organicSiloTotal: 20.060272216796875,
    samples: TAGS.map(([key, label, tag, value]) => ({ date: DAY, key, label, tag, value,
      qualityText: 'Raw, Good', returnedTimeText: `${DAY} 00:00:00` })),
    qualityValidationVersion: '1.2', allQualitiesGood: true, cleanupVerified: true };
}

test('quality recognizes observed Raw, Good without accepting adverse or unknown qualifiers', () => {
  for (const value of ['Good', 'Raw, Good', 'good, raw', ' RAW , GOOD ']) assert.equal(good(value), true, value);
  for (const value of ['', null, 'Raw', 'Not Good', 'Raw, Bad', 'Raw, Uncertain', 'Good, Bad',
    'Calculated, Good', 'Good, Raw, Bad', 'Good,', ',Good', 'Good, Good']) assert.equal(good(value), false, String(value));
});

test('preserves unrounded values and validates source, fixed TAGs, date, time and cleanup', () => {
  const valid = validate(result(), DAY);
  assert.equal(valid.error, undefined);
  assert.equal(valid.result.organicDaySilo, TAGS[0][3]);
  assert.equal(valid.result.organicSiloTotal, 20.060272216796875);
  assert.equal(valid.result.samples.length, 3);
  const mutations = [
    r => r.targetDate = '2026-08-02', r => r.schemaVersion = '1', r => r.source = 'daily_data_excel',
    r => r.aggregation = 'Average', r => r.step = '1H', r => r.intervalEndKst = '2026-08-03T00:00:00+09:00',
    r => r.cleanupVerified = false, r => r.allQualitiesGood = 'true', r => r.qualityValidationVersion = 'unknown',
    r => r.samples.pop(), r => r.samples[1] = r.samples[0], r => r.samples[0].tag = TAGS[1][2],
    r => r.samples[0].date = '2026-07-31', r => r.samples[0].qualityText = 'Good, Uncertain',
    r => r.samples[0].returnedTimeText = '', r => r.samples[0].returnedTimeText = '2026-07-31 23:59:59',
    r => r.samples[0].returnedTimeText = '2026-08-02 00:00:01',
    r => r.samples[0].returnedTimeText = '2026-02-30 12:00:00', r => r.samples[0].statistic = 'Avg',
    r => r.samples[0].periodStartKst = '2026-07-31 00:00:00+09:00',
    r => r.organicDaySilo = null, r => r.samples[0].value = -1, r => r.samples[0].value = Infinity,
    r => r.organicSiloTotal = Number(r.organicSiloTotal.toFixed(3))
  ];
  for (const mutate of mutations) {
    const r = result(); mutate(r);
    assert.ok(validate(r, DAY).error, String(mutate));
  }
  const ending = result(); ending.samples[0].returnedTimeText = '2026-08-02 00:00:00';
  assert.equal(validate(ending, DAY).error, undefined);
});

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (employee_no TEXT PRIMARY KEY, name TEXT, role TEXT, is_active INTEGER);
    CREATE TABLE shift_log_sessions (token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT, last_used_at TEXT);
    CREATE TABLE ois_data_requests (id TEXT PRIMARY KEY, request_type TEXT, target_date TEXT, status TEXT,
      requested_by_id TEXT, requested_by_name TEXT, requested_at TEXT, started_at TEXT, completed_at TEXT,
      agent_id TEXT, result_json TEXT, error_message TEXT, expires_at TEXT, updated_at TEXT);`);
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO users VALUES ('user1', 'Test', 'user', 1)").run();
  sqlite.prepare("INSERT INTO shift_log_sessions VALUES (?, 'user1', ?, ?)").run(
    createHash('sha256').update('browser-token').digest('hex'), new Date(Date.now() + 86400000).toISOString(), now);
  const db = {
    prepare(sql) {
      return { bindings: [], bind(...values) { this.bindings = values; return this; },
        async first() { return sqlite.prepare(sql).get(...this.bindings) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.bindings) }; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...this.bindings).changes) } }; } };
    },
    async batch(statements) { return await Promise.all(statements.map(s => s.run())); }
  };
  async function api(method, body, query = '', headers = { Authorization: 'Bearer browser-token' }) {
    const request = new Request(`https://example.test/api/ois-data-requests${query}`, { method, headers: {
      'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
    const response = await (method === 'POST' ? onRequestPost : onRequestGet)({ request, env: { DB: db, OIS_AGENT_KEY: 'agent-key' } });
    return { status: response.status, body: await response.json() };
  }
  const agentHeaders = owner => ({ 'X-OIS-Agent-Key': 'agent-key', 'X-OIS-Agent-Id': owner || 'excel1' });
  return { sqlite, api, agentHeaders, close: () => sqlite.close() };
}

test('new type is authenticated, completed-day-only, deduplicated and claimed through Excel lane', sqliteTestOptions, async t => {
  const f = fixture(); t.after(f.close);
  const anonymous = await f.api('POST', { requestType: TYPE, targetDate: DAY }, '', {});
  assert.equal(anonymous.status, 401);
  for (const targetDate of ['2020-12-31', '2026-02-30', '9999-01-01', new Date(Date.now()+9*3600000).toISOString().slice(0,10)]) {
    assert.equal((await f.api('POST', { requestType: TYPE, targetDate })).status, 400);
  }
  const first = await f.api('POST', { requestType: TYPE, targetDate: DAY });
  assert.equal(first.status, 201, JSON.stringify(first));
  const duplicate = await f.api('POST', { requestType: TYPE, targetDate: DAY, forceRefresh: true });
  assert.equal(duplicate.body.item.id, first.body.item.id);
  const wrongLane = await f.api('GET', null, `?action=next_lanes&oisRequestTypes=${TYPE}&excelRequestTypes=daily_data_excel`, f.agentHeaders());
  assert.equal(wrongLane.status, 400);
  const claim = await f.api('GET', null, `?action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=${TYPE}`, f.agentHeaders());
  assert.equal(claim.status, 200, JSON.stringify(claim));
  assert.equal(claim.body.items.excel.id, first.body.item.id);
  assert.equal(claim.body.items.ois, null);
  assert.ok(Date.parse(claim.body.items.excel.expiresAt) - Date.now() > 450000);
});

test('only the claimant can complete valid inventory; replay is idempotent and daily history stays intact', sqliteTestOptions, async t => {
  const f = fixture(); t.after(f.close);
  const created = await f.api('POST', { requestType: TYPE, targetDate: DAY });
  const id = created.body.item.id;
  const complete = (r, owner = 'excel1') => f.api('POST', { action: 'complete', requestId: id, result: r }, '', f.agentHeaders(owner));
  assert.equal((await complete(result())).status, 409); // pending cannot bypass claim
  await f.api('GET', null, `?action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=${TYPE}`, f.agentHeaders());
  assert.equal((await complete(result(), 'excel2')).status, 409);
  const invalid = result(); invalid.cleanupVerified = false;
  assert.equal((await complete(invalid)).status, 400);
  assert.equal(f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?').get(id).status, 'processing');
  const success = await complete(result());
  assert.equal(success.status, 200, JSON.stringify(success));
  const replay = await complete(result()); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  const changed = result(); changed.samples[0].qualityText = 'Good';
  assert.equal((await complete(changed)).status, 409);
  const reused = await f.api('POST', { requestType: TYPE, targetDate: DAY });
  assert.equal(reused.body.item.id, id);
  const fresh = await f.api('POST', { requestType: TYPE, targetDate: DAY, forceRefresh: true });
  assert.equal(fresh.status, 201); assert.notEqual(fresh.body.item.id, id);
  f.sqlite.prepare(`INSERT INTO ois_data_requests SELECT 'daily-old', 'daily_data_excel', target_date,
    'complete', requested_by_id, requested_by_name, requested_at, started_at, completed_at, agent_id,
    '{"generation":123,"organicReceipt":25}', '', expires_at, updated_at FROM ois_data_requests WHERE id=?`).run(id);
  const history = await f.api('GET', null, `?action=completed_history&startDate=${DAY}&endDate=${DAY}`);
  assert.equal(history.status, 200, JSON.stringify(history));
  assert.equal(history.body.items.length, 2);
  assert.equal(history.body.items.find(x => x.requestType === 'daily_data_excel').result.generation, 123);
  assert.equal(history.body.items.find(x => x.requestType === TYPE).result.organicSiloTotal, 20.060272216796875);
});
