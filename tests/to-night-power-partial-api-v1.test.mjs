import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash, webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const root = process.env.TO_POWER_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'functions/api/to-night-power.js'), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const DATE = '2026-10-01';
const EMPTY = {generatorEcmsGen1: null, ismartReception: null, epowerTransmission: null, solarDailyGeneration: null};
const PARTIAL = {generatorEcmsGen1: 1000500.125, ismartReception: null, epowerTransmission: 888777.25, solarDailyGeneration: 154.375};
const TOKEN = 'partial-power-test-session';
const HASH = createHash('sha256').update(TOKEN).digest('hex');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE employees(employee_no TEXT PRIMARY KEY,position TEXT,is_allowed INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT);
    INSERT INTO users VALUES ('to', 'TEST TO', 'user', 1);
    INSERT INTO employees VALUES ('to', 'TO', 1);`);
  sql.prepare('INSERT INTO shift_log_sessions VALUES (?, ?, ?)').run(HASH, 'to', new Date(Date.now() + 3600000).toISOString());
  const db = {beforeWriteBatch: null, failAudit: false, prepare(query) {
    return {query, values: [], bind(...values) { return {...this, values}; },
      async first() { return sql.prepare(query).get(...this.values) || null; },
      async all() { return {results: sql.prepare(query).all(...this.values), success: true}; }};
  }, async batch(statements) {
    if (statements[0].query.includes('TO_POWER_CONFLICT') && this.beforeWriteBatch) {
      const mutation = this.beforeWriteBatch; this.beforeWriteBatch = null; mutation();
    }
    sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(prepared => {
        if (this.failAudit && prepared.query.startsWith('INSERT INTO to_night_power_audit')) throw new Error('Injected audit failure');
        const statement = sql.prepare(prepared.query);
        if (statement.columns().length) return {success: true, results: statement.all(...prepared.values)};
        statement.run(...prepared.values); return {success: true, results: []};
      });
      sql.exec('COMMIT'); return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  }};
  const body = (values = PARTIAL, revision = 0, date = DATE) => ({targetDate: date, shift: 'NS', role: 'TO', values: {...values},
    expectedRevision: revision, sourceLogId: 'employee-position:to', sourceLogRevision: 1});
  async function call(method, content, date = DATE) {
    const request = new Request('https://example.test/api/to-night-power?date=' + date, {method,
      headers: {Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Origin: 'https://example.test'},
      ...(method === 'POST' ? {body: JSON.stringify(content)} : {})});
    const result = await api[method === 'POST' ? 'onRequestPost' : 'onRequestGet']({request, env: {DB: db}});
    return {status: result.status, data: await result.json()};
  }
  function history(date, values) {
    sql.exec('CREATE TABLE IF NOT EXISTS morning_meeting_auto_history_overrides(target_date TEXT PRIMARY KEY, values_json TEXT NOT NULL)');
    sql.prepare('INSERT INTO morning_meeting_auto_history_overrides VALUES (?, ?)').run(date, JSON.stringify(values));
  }
  const audit = () => sql.prepare('SELECT revision, values_json FROM to_night_power_audit ORDER BY revision').all();
  return {sql, db, body, call, history, audit};
}
function run(name, fn) { test(name, async t => { const f = fixture(); t.after(() => f.sql.close()); await fn(f); }); }

run('three known fields save and GET returns reception as null, never zero', async f => {
  const result = await f.call('POST', f.body());
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.item.values, PARTIAL);
  assert.equal(result.data.item.revision, 1);
  assert.deepEqual((await f.call('GET')).data.item.values, PARTIAL);
  assert.deepEqual(JSON.parse(f.audit()[0].values_json), PARTIAL);
});

run('a later reception-only save fills the gap and retains earlier values and audit', async f => {
  await f.call('POST', f.body());
  const result = await f.call('POST', f.body({...EMPTY, ismartReception: 17.25}, 1));
  assert.equal(result.status, 200);
  assert.equal(result.data.item.revision, 2);
  assert.deepEqual(result.data.item.values, {...PARTIAL, ismartReception: 17.25});
  assert.deepEqual(f.audit().map(row => JSON.parse(row.values_json)), [PARTIAL, {...PARTIAL, ismartReception: 17.25}]);
});

run('null preserves an existing nonzero or zero number while explicit zero replaces a number', async f => {
  const initial = {generatorEcmsGen1: 12, ismartReception: 0, epowerTransmission: 25, solarDailyGeneration: 4};
  await f.call('POST', f.body(initial));
  const result = await f.call('POST', f.body({...EMPTY, epowerTransmission: 0}, 1));
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.item.values, {...initial, epowerTransmission: 0});
});

run('one explicitly entered zero is a valid partial record', async f => {
  const values = {...EMPTY, ismartReception: 0};
  const result = await f.call('POST', f.body(values));
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.item.values, values);
  assert.deepEqual(result.data.solarCumulative, {monthly: null, yearly: null});
});

run('all-null new submission is rejected without creating tables', async f => {
  assert.equal((await f.call('POST', f.body(EMPTY))).status, 400);
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'to_night_power_%'").get().n, 0);
});

run('all-null update is rejected without saving a new revision or audit', async f => {
  await f.call('POST', f.body());
  assert.equal((await f.call('POST', f.body(EMPTY, 1))).status, 400);
  assert.equal((await f.call('GET')).data.item.revision, 1);
  assert.equal(f.audit().length, 1);
});

run('partial input still requires exactly four keys and bounded numeric values', async f => {
  for (const values of [
    {generatorEcmsGen1: 1}, {...PARTIAL, extra: 1}, {...PARTIAL, ismartReception: ''},
    {...PARTIAL, ismartReception: '0'}, {...PARTIAL, ismartReception: false},
    {...PARTIAL, ismartReception: -1}, {...PARTIAL, ismartReception: 1e12 + 1}
  ]) assert.equal((await f.call('POST', f.body(values))).status, 400);
  assert.equal((await f.call('POST', f.body({...EMPTY, generatorEcmsGen1: 1e12}))).status, 200);
});

run('stale partial update conflicts instead of merging over newer values', async f => {
  await f.call('POST', f.body());
  await f.call('POST', f.body({...EMPTY, ismartReception: 19}, 1));
  const result = await f.call('POST', f.body({...EMPTY, solarDailyGeneration: 0}, 1));
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'POWER_REVISION_CONFLICT');
  assert.deepEqual((await f.call('GET')).data.item.values, {...PARTIAL, ismartReception: 19});
  assert.equal(f.audit().length, 2);
});

run('a write occurring after merge is detected by the atomic revision guard', async f => {
  await f.call('POST', f.body());
  const concurrent = {...PARTIAL, ismartReception: 33};
  f.db.beforeWriteBatch = () => f.sql.prepare('UPDATE to_night_power_daily SET values_json = ?, revision = 2').run(JSON.stringify(concurrent));
  const result = await f.call('POST', f.body({...EMPTY, solarDailyGeneration: 0}, 1));
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'POWER_WRITE_CONFLICT');
  assert.deepEqual((await f.call('GET')).data.item.values, concurrent);
  assert.equal(f.audit().length, 1);
});

run('partial save retains the transaction-time TO authority guard', async f => {
  await f.call('POST', f.body());
  f.db.beforeWriteBatch = () => f.sql.exec("UPDATE employees SET position = 'BCO1' WHERE employee_no = 'to'");
  assert.equal((await f.call('POST', f.body({...EMPTY, ismartReception: 1}, 1))).status, 409);
  assert.deepEqual((await f.call('GET')).data.item.values, PARTIAL);
  assert.equal(f.audit().length, 1);
});

run('partial merge and audit remain one transaction when audit insertion fails', async f => {
  await f.call('POST', f.body());
  f.db.failAudit = true;
  const originalError = console.error;
  console.error = () => {};
  let result;
  try { result = await f.call('POST', f.body({...EMPTY, ismartReception: 7}, 1)); }
  finally { console.error = originalError; }
  assert.equal(result.status, 500);
  assert.deepEqual((await f.call('GET')).data.item.values, PARTIAL);
  assert.equal(f.audit().length, 1);
});

run('reception gap does not block known solar daily from monthly and yearly totals', async f => {
  f.history('2026-09-30', {powerSolar: 250, powerSolarMonthly: 15000, powerSolarYearly: 150000});
  const saved = await f.call('POST', f.body());
  assert.deepEqual(saved.data.solarCumulative, {monthly: 154.375, yearly: 150154.375});
  assert.deepEqual((await f.call('GET')).data.solarCumulative, saved.data.solarCumulative);
  const filled = await f.call('POST', f.body({...EMPTY, ismartReception: 20}, 1));
  assert.deepEqual(filled.data.solarCumulative, saved.data.solarCumulative);
});

run('unknown solar does not become zero and later solar entry enables cumulative values', async f => {
  f.history('2026-09-30', {powerSolarYearly: 150000});
  f.history(DATE, {powerSolar: 300, powerSolarMonthly: 300, powerSolarYearly: 150300});
  const saved = await f.call('POST', f.body({...EMPTY, generatorEcmsGen1: 20}));
  assert.equal(saved.data.item.values.solarDailyGeneration, null);
  assert.deepEqual(saved.data.solarCumulative, {monthly: null, yearly: null});
  const filled = await f.call('POST', f.body({...EMPTY, solarDailyGeneration: 0}, 1));
  assert.deepEqual(filled.data.solarCumulative, {monthly: 0, yearly: 150000});
  assert.equal(filled.data.item.values.generatorEcmsGen1, 20);
});

run('historical daily fallback remains available for an earlier day with unknown TO solar', async f => {
  f.history('2026-09-30', {powerSolarYearly: 150000});
  f.history('2026-10-02', {powerSolar: 300, powerSolarMonthly: 700, powerSolarYearly: 150700});
  await f.call('POST', f.body({...EMPTY, solarDailyGeneration: 400}));
  await f.call('POST', f.body({...EMPTY, generatorEcmsGen1: 100}, 0, '2026-10-02'));
  const saved = await f.call('POST', f.body({...EMPTY, solarDailyGeneration: 500}, 0, '2026-10-03'));
  assert.deepEqual(saved.data.solarCumulative, {monthly: 1200, yearly: 151200});
});

run('GET and POST advertise nullable input and explicit clear support', async f => {
  const expected = {partialValues: true, clearFields: true};
  const empty = await f.call('GET');
  assert.equal(empty.data.item, null);
  assert.deepEqual(empty.data.capabilities, expected);
  assert.deepEqual((await f.call('POST', f.body())).data.capabilities, expected);
  assert.deepEqual((await f.call('GET')).data.capabilities, expected);
});

run('explicitly clearing a saved placeholder zero stores null and can later be filled', async f => {
  const initial = {generatorEcmsGen1: 4061112, ismartReception: 0, epowerTransmission: 3548720, solarDailyGeneration: 23.5};
  await f.call('POST', f.body(initial));
  const clearedValues = {...initial, ismartReception: null};
  const cleared = await f.call('POST', {...f.body(clearedValues, 1), clearFields: ['ismartReception']});
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.item.revision, 2);
  assert.deepEqual(cleared.data.item.values, clearedValues);
  assert.deepEqual((await f.call('GET')).data.item.values, clearedValues);
  assert.deepEqual(f.audit().map(row => JSON.parse(row.values_json)), [initial, clearedValues]);
  const filled = await f.call('POST', f.body({...EMPTY, ismartReception: 18.5}, 2));
  assert.equal(filled.status, 200);
  assert.equal(filled.data.item.revision, 3);
  assert.deepEqual(filled.data.item.values, {...initial, ismartReception: 18.5});
});

run('explicit clear affects only selected keys; legitimate zeros remain saved', async f => {
  const initial = {generatorEcmsGen1: 0, ismartReception: 5, epowerTransmission: 0, solarDailyGeneration: 0};
  await f.call('POST', f.body(initial));
  const result = await f.call('POST', {...f.body({...EMPTY, generatorEcmsGen1: 0}, 1), clearFields: ['ismartReception']});
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.item.values, {...initial, ismartReception: null});
});

run('malformed or contradictory clearFields cannot change stored values', async f => {
  const initial = {...PARTIAL, ismartReception: 0};
  await f.call('POST', f.body(initial));
  for (const clearFields of [null, {}, 'ismartReception', ['unknown'], ['__proto__'], [0],
    ['ismartReception', 'ismartReception'], ['solarDailyGeneration']]) {
    const result = await f.call('POST', {...f.body(PARTIAL, 1), clearFields});
    assert.equal(result.status, 400, JSON.stringify(clearFields));
  }
  assert.deepEqual((await f.call('GET')).data.item.values, initial);
  assert.equal(f.audit().length, 1);
});

run('an empty clearFields array keeps older-client null preservation semantics', async f => {
  const initial = {...PARTIAL, ismartReception: 0};
  await f.call('POST', f.body(initial));
  const result = await f.call('POST', {...f.body(PARTIAL, 1), clearFields: []});
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.item.values, initial);
});

run('explicit clear of an unknown new field is harmless but all-blank records remain rejected', async f => {
  const result = await f.call('POST', {...f.body(), clearFields: ['ismartReception']});
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.item.values, PARTIAL);
  const empty = await f.call('POST', {...f.body(EMPTY, 1), clearFields: Object.keys(EMPTY)});
  assert.equal(empty.status, 400);
  assert.equal(f.audit().length, 1);
  assert.deepEqual((await f.call('GET')).data.item.values, PARTIAL);
});

run('explicit clear cannot erase a newer value on stale or racing revisions', async f => {
  await f.call('POST', f.body({...PARTIAL, ismartReception: 0}));
  const request = {...f.body(PARTIAL, 1), clearFields: ['ismartReception']};
  assert.equal((await f.call('POST', {...request, expectedRevision: 0})).status, 409);
  const newer = {...PARTIAL, ismartReception: 42};
  f.db.beforeWriteBatch = () => f.sql.prepare('UPDATE to_night_power_daily SET values_json = ?, revision = 2').run(JSON.stringify(newer));
  const raced = await f.call('POST', request);
  assert.equal(raced.status, 409);
  assert.equal(raced.data.code, 'POWER_WRITE_CONFLICT');
  assert.deepEqual((await f.call('GET')).data.item.values, newer);
  assert.equal(f.audit().length, 1);
});

run('explicit clear is blocked after TO authority changes', async f => {
  const initial = {...PARTIAL, ismartReception: 0};
  await f.call('POST', f.body(initial));
  f.db.beforeWriteBatch = () => f.sql.exec("UPDATE employees SET position = 'BCO1' WHERE employee_no = 'to'");
  const result = await f.call('POST', {...f.body(PARTIAL, 1), clearFields: ['ismartReception']});
  assert.equal(result.status, 409);
  assert.deepEqual((await f.call('GET')).data.item.values, initial);
  assert.equal(f.audit().length, 1);
});

run('clearing solar explicitly invalidates its target cumulative instead of manufacturing zero', async f => {
  f.history('2026-09-30', {powerSolarYearly: 150000});
  await f.call('POST', f.body());
  const result = await f.call('POST', {...f.body({...PARTIAL, solarDailyGeneration: null}, 1), clearFields: ['solarDailyGeneration']});
  assert.equal(result.status, 200);
  assert.equal(result.data.item.values.solarDailyGeneration, null);
  assert.deepEqual(result.data.solarCumulative, {monthly: null, yearly: null});
});
