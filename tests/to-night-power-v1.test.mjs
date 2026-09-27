import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {createHash, webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.TO_POWER_SOURCE_ROOT || (existsSync(path.join(root, 'functions/api/to-night-power.js')) ? root : path.join(root, 'files'));
const apiSource = readFileSync(path.join(base, 'functions/api/to-night-power.js'), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(apiSource).toString('base64'));
const sandbox = {module: {exports: {}}, console};
vm.runInNewContext(readFileSync(path.join(base, 'maintenance/to-night-power.js'), 'utf8'), sandbox);
const pure = sandbox.module.exports;
const DATE = '2026-09-26';
const VALUES = {generatorEcmsGen1: 1000500.125, ismartReception: 0, epowerTransmission: 888777.25, solarDailyGeneration: 154.375};
const tokenFor = id => 'test-session-' + id;
const hash = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT);
    CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,author_id TEXT,
      revision INTEGER,updated_at TEXT,created_at TEXT);`);
  for (const [id, name, role] of [['to', 'TEST TO', 'user'], ['other', 'TEST OTHER', 'user'], ['admin', 'TEST ADMIN', 'super_admin'], ['same-name', 'TEST TO', 'user']]) {
    sql.prepare('INSERT INTO users VALUES (?, ?, ?, 1)').run(id, name, role);
    sql.prepare('INSERT INTO shift_log_sessions VALUES (?, ?, ?)').run(hash(tokenFor(id)), id, new Date(Date.now() + 3600000).toISOString());
  }
  sql.prepare('INSERT INTO shift_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('log-ns-to', DATE, 'NS', 'TO', 'TEST TO', 'to', 2, '2026-09-26T20:00:00Z', '2026-09-26T19:00:00Z');
  const db = {sql, beforeWriteBatch: null, failAudit: false, prepare(query) {
    return {query, values: [], bind(...values) { return {...this, values}; },
      async first() { return sql.prepare(query).get(...this.values) || null; },
      async all() { return {results: sql.prepare(query).all(...this.values), success: true}; },
      async run() { const result = sql.prepare(query).run(...this.values); return {success: true, meta: {changes: Number(result.changes)}}; }};
  }, async batch(statements) {
    if (statements[0].query.includes('TO_POWER_CONFLICT') && this.beforeWriteBatch) {
      const fn = this.beforeWriteBatch; this.beforeWriteBatch = null; fn();
    }
    sql.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const prepared of statements) {
        if (this.failAudit && prepared.query.startsWith('INSERT INTO to_night_power_audit')) throw new Error('Injected audit failure');
        const statement = sql.prepare(prepared.query);
        if (statement.columns().length) results.push({success: true, results: statement.all(...prepared.values), meta: {changes: 0}});
        else { const result = statement.run(...prepared.values); results.push({success: true, results: [], meta: {changes: Number(result.changes)}}); }
      }
      sql.exec('COMMIT'); return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  }};
  const body = () => ({targetDate: DATE, shift: 'NS', role: 'TO', values: {...VALUES}, expectedRevision: 0,
    sourceLogId: 'log-ns-to', sourceLogRevision: 2});
  async function call(method = 'GET', content = body(), user = 'to', options = {}) {
    const headers = {...(user ? {Authorization: 'Bearer ' + tokenFor(user)} : {}),
      ...(method === 'POST' ? {'Content-Type': 'application/json', Origin: 'https://example.test'} : {}), ...options.headers};
    const request = new Request('https://example.test/api/to-night-power?date=' + (options.date ?? DATE), {
      method, headers, ...(method === 'POST' ? {body: options.raw ?? JSON.stringify(content)} : {})});
    const response = await api[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({request, env: {DB: db}});
    return {status: response.status, data: await response.json(), headers: response.headers};
  }
  const count = table => sql.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(table) ?
    sql.prepare(`SELECT count(*) n FROM ${table}`).get().n : 0;
  return {sql, db, call, body, count};
}
function run(name, fn) { test(name, async t => { const f = fixture(); t.after(() => f.sql.close()); await fn(f); }); }
run('GET: saved NS TO author is allowed; read causes no schema writes', async f => {
  const r = await f.call(); assert.equal(r.status, 200); assert.equal(r.data.canEdit, true); assert.equal(r.data.item, null);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'to_night_power_%'").get().n, 0);
  assert.match(r.headers.get('Cache-Control'), /no-store/);
});
for (const user of ['other', 'admin', 'same-name']) run(`GET/POST: ${user} has no owner bypass`, async f => {
  assert.equal((await f.call('GET', null, user)).data.canEdit, false);
  assert.equal((await f.call('POST', f.body(), user)).status, 403); assert.equal(f.count('to_night_power_daily'), 0);
});
run('missing saved duty does not grant input permission', async f => {
  f.sql.exec('DELETE FROM shift_logs'); assert.equal((await f.call()).data.canEdit, false);
  assert.equal((await f.call('POST')).status, 403);
});
for (const [name, modify] of [
  ['missing login', f => null], ['unknown token', f => 'missing'],
  ['inactive user', f => { f.sql.prepare('UPDATE users SET is_active = 0 WHERE employee_no = ?').run('to'); return 'to'; }],
  ['expired session', f => { f.sql.prepare('UPDATE shift_log_sessions SET expires_at = ?').run('2020-01-01T00:00:00Z'); return 'to'; }],
  ['malformed expiry', f => { f.sql.prepare('UPDATE shift_log_sessions SET expires_at = ?').run('not-a-date'); return 'to'; }]
]) run(`authentication: ${name}`, async f => {
  const user = modify(f); assert.equal((await f.call('POST', f.body(), user)).status, 401); assert.equal(f.count('to_night_power_daily'), 0);
});
for (const date of ['2026-02-30', '2026-13-01', '2026-9-26', '2026-09-26T00:00', "2026-09-26'", '']) run(`invalid date: ${date}`, async f => {
  assert.equal((await f.call('GET', null, 'to', {date})).status, 400);
});
run('leap day is accepted; ownership is still required', async f => {
  const r = await f.call('GET', null, 'to', {date: '2024-02-29'}); assert.equal(r.status, 200); assert.equal(r.data.canEdit, false);
});
for (const [key, value] of [['shift', 'DS'], ['shift', 'N/S'], ['role', 'BCO1'], ['role', 'admin']]) run(`reject duty spoof: ${key}=${value}`, async f => {
  const body = f.body(); body[key] = value; assert.equal((await f.call('POST', body)).status, 403); assert.equal(f.count('to_night_power_daily'), 0);
});
for (const [name, value] of [['empty string', ''], ['number string', '1'], ['null', null], ['negative', -1], ['boolean', true], ['array', []], ['too large', 1e13]]) run(`invalid value: ${name}`, async f => {
  const body = f.body(); body.values.ismartReception = value; assert.equal((await f.call('POST', body)).status, 400);
});
run('all four fields must be explicitly present; extra fields rejected', async f => {
  let body = f.body(); delete body.values.solarDailyGeneration; assert.equal((await f.call('POST', body)).status, 400);
  body = f.body(); body.values.extra = 5; assert.equal((await f.call('POST', body)).status, 400);
});
run('nonfinite JSON numeric input is rejected', async f => {
  const raw = JSON.stringify(f.body()).replace('1000500.125', '1e999'); assert.equal((await f.call('POST', null, 'to', {raw})).status, 400);
});
run('negative/missing revision is rejected', async f => {
  const body = f.body(); body.expectedRevision = -1; assert.equal((await f.call('POST', body)).status, 400);
  delete body.expectedRevision; assert.equal((await f.call('POST', body)).status, 400);
});
run('different origin and non-JSON content are rejected', async f => {
  assert.equal((await f.call('POST', f.body(), 'to', {headers: {Origin: 'https://elsewhere.test'}})).status, 403);
  assert.equal((await f.call('POST', f.body(), 'to', {headers: {'Content-Type': 'text/plain'}})).status, 415);
});
run('oversized or invalid JSON body is rejected', async f => {
  assert.equal((await f.call('POST', null, 'to', {raw: 'x'.repeat(9000)})).status, 413);
  assert.equal((await f.call('POST', null, 'to', {raw: '{bad'})).status, 400);
});
run('spoofed author metadata cannot be submitted', async f => {
  const body = f.body(); body.updatedById = 'admin'; assert.equal((await f.call('POST', body)).status, 400);
});
run('zero and decimal values persist; server identity and audit are authoritative', async f => {
  const beforeLogs = f.sql.prepare('SELECT * FROM shift_logs').all();
  const r = await f.call('POST'); assert.equal(r.status, 200); assert.deepEqual(r.data.item.values, VALUES);
  assert.equal(r.data.item.updatedBy, 'TEST TO'); assert.equal(r.data.item.revision, 1);
  assert.equal(f.count('to_night_power_audit'), 1);
  const row = f.sql.prepare('SELECT * FROM to_night_power_daily').get(); assert.equal(row.updated_by_id, 'to');
  assert.deepEqual(f.sql.prepare('SELECT * FROM shift_logs').all(), beforeLogs);
  assert.deepEqual((await f.call('GET', null, 'other')).data.item.values, VALUES);
});
run('all-zero values are a completed input, not missing data', async f => {
  const body = f.body(); for (const key of Object.keys(body.values)) body.values[key] = 0;
  const r = await f.call('POST', body); assert.equal(r.status, 200); assert.deepEqual(r.data.item.values, body.values);
});
run('same-day update increments revision and retains both audit snapshots', async f => {
  await f.call('POST'); const body = f.body(); body.expectedRevision = 1; body.values.ismartReception = 17;
  const r = await f.call('POST', body); assert.equal(r.status, 200); assert.equal(r.data.item.revision, 2);
  assert.equal(f.count('to_night_power_daily'), 1); assert.equal(f.count('to_night_power_audit'), 2);
});
run('stale revision cannot overwrite a newer record', async f => {
  await f.call('POST'); const body = f.body(); body.values.ismartReception = 999;
  assert.equal((await f.call('POST', body)).status, 409);
  assert.equal((await f.call()).data.item.values.ismartReception, 0); assert.equal(f.count('to_night_power_audit'), 1);
});
run('source log changed after opening dialog requires reloading', async f => {
  f.sql.exec('UPDATE shift_logs SET revision = 3'); assert.equal((await f.call('POST')).status, 409);
});
run('a saved DS TO log alone does not authorize NS entry', async f => {
  f.sql.exec("UPDATE shift_logs SET shift = 'DS'"); assert.equal((await f.call('POST')).status, 403);
});
run('latest NS TO owner overrides an older matching-author log', async f => {
  f.sql.prepare('INSERT INTO shift_logs SELECT ?,work_date,shift,role,author,?,revision,?,created_at FROM shift_logs').run('new-log', 'other', '2026-09-27T01:00:00Z');
  assert.equal((await f.call('POST')).status, 403);
});
for (const [name, mutation] of [
  ['duty reassignment', f => f.sql.exec("UPDATE shift_logs SET author_id = 'other'")],
  ['source revision', f => f.sql.exec('UPDATE shift_logs SET revision = 3')],
  ['session revoked', f => f.sql.exec('DELETE FROM shift_log_sessions')],
  ['user disabled', f => f.sql.exec("UPDATE users SET is_active = 0 WHERE employee_no = 'to'")]
]) run(`atomic write guard: ${name}`, async f => {
  f.db.beforeWriteBatch = () => mutation(f);
  assert.equal((await f.call('POST')).status, 409); assert.equal(f.count('to_night_power_daily'), 0); assert.equal(f.count('to_night_power_audit'), 0);
});
run('audit failure rolls back the saved values', async f => {
  await f.call('POST'); f.db.failAudit = true; const body = f.body(); body.expectedRevision = 1; body.values.ismartReception = 17;
  const oldError = console.error; console.error = () => {};
  let result; try { result = await f.call('POST', body); } finally { console.error = oldError; }
  assert.equal(result.status, 500); const row = (await f.call()).data.item;
  assert.equal(row.revision, 1); assert.equal(row.values.ismartReception, 0); assert.equal(f.count('to_night_power_audit'), 1);
});
for (const [text, expected] of [['0', 0], ['0.125', .125], ['1,234.56', 1234.56], [' 25 ', 25], ['0000', 0]]) {
  test(`UI parse accepts ${text}`, () => assert.equal(pure.parseInput(text), expected));
}
for (const text of ['', ' ', '1,2', '-1', 'NaN', 'Infinity', '0xFF', '1e3', '+2', '1.2.3', '1,000,00']) {
  test(`UI parse rejects ${JSON.stringify(text)}`, () => assert.throws(() => pure.parseInput(text)));
}
run('workbook merge is date-scoped, nonmutating and preserves unrelated fields', async f => {
  await f.call('POST'); const payload = (await f.call()).data;
  const original = {unitOneProduction: 123, sludgeTotal: 116.73, solarMonthlyCumulative: 456, generatorEcmsGen1: 1};
  const merged = pure.mergeValues(original, payload, DATE);
  assert.equal(merged.generatorEcmsGen1, VALUES.generatorEcmsGen1); assert.equal(original.generatorEcmsGen1, 1);
  assert.equal(merged.sludgeTotal, 116.73); assert.equal(merged.unitOneProduction, 123); assert.equal(merged.solarMonthlyCumulative, 456);
  assert.throws(() => pure.mergeValues(original, payload, '2026-09-25'));
  assert.equal(pure.mergeValues(original, payload, DATE, true).generatorEcmsGen1, 1);
});
run('UI rejects wrong response date, unit, revision or NaN record', async f => {
  await f.call('POST'); const payload = (await f.call()).data;
  for (const change of [p => p.targetDate = '2026-09-25', p => p.unit = 'MWh', p => p.item.revision = 0,
    p => p.item.values.generatorEcmsGen1 = NaN, p => p.sourceLog = null]) {
    const invalid = structuredClone(payload); change(invalid); assert.throws(() => pure.normalizePayload(invalid, DATE));
  }
});

// R2: old-log synchronization has no authority over the independent manual record.
function powerSnapshot(f) {
  return {daily: f.sql.prepare('SELECT * FROM to_night_power_daily ORDER BY target_date').all(),
    audit: f.sql.prepare('SELECT * FROM to_night_power_audit ORDER BY target_date, revision').all()};
}
run('legacy-style repeated overwrite with absent, blank, null or zero fields preserves every saved byte and audit', async f => {
  await f.call('POST'); const before = powerSnapshot(f);
  f.sql.exec("ALTER TABLE shift_logs ADD COLUMN log_json TEXT NOT NULL DEFAULT '{}'");
  f.sql.exec('CREATE TABLE legacy_logs(id TEXT PRIMARY KEY, original_json TEXT)');
  const sources = [{entries: []}, {}, {power: null}, {generatorEcmsGen1: ''},
    Object.fromEntries(Object.keys(VALUES).map(key => [key, 0]))];
  for (let round = 0; round < 4; round++) for (const incoming of sources) {
    f.sql.prepare('INSERT OR REPLACE INTO legacy_logs VALUES (?, ?)').run('legacy-to', JSON.stringify(incoming));
    f.sql.prepare('UPDATE shift_logs SET log_json = ?, revision = revision + 1 WHERE id = ?').run(JSON.stringify(incoming), 'log-ns-to');
    const result = await f.call();
    assert.equal(result.status, 200); assert.deepEqual(result.data.item.values, VALUES);
    assert.deepEqual(powerSnapshot(f), before);
  }
});
run('changing the synchronized TO log ID preserves manual values by date, not by log ID', async f => {
  await f.call('POST'); const before = powerSnapshot(f);
  f.sql.prepare('UPDATE shift_logs SET id = ?, revision = revision + 1').run('replacement-log');
  const result = await f.call();
  assert.deepEqual(result.data.item.values, VALUES); assert.equal(result.data.sourceLog.id, 'replacement-log');
  assert.equal(result.data.item.sourceLogId, 'log-ns-to'); assert.deepEqual(powerSnapshot(f), before);
});
run('temporary missing TO log during synchronization retains the record but grants no write permission', async f => {
  await f.call('POST'); const before = powerSnapshot(f); f.sql.exec('DELETE FROM shift_logs');
  const result = await f.call(); assert.equal(result.status, 200); assert.equal(result.data.canEdit, false);
  assert.equal(result.data.sourceLog, null); assert.deepEqual(result.data.item.values, VALUES);
  assert.deepEqual(powerSnapshot(f), before);
});
run('reassigning the synchronized author changes permission only, not existing manual data', async f => {
  await f.call('POST'); const before = powerSnapshot(f);
  f.sql.exec("UPDATE shift_logs SET author_id = 'other', author = 'TEST OTHER', revision = 3");
  assert.equal((await f.call()).data.canEdit, false);
  const result = await f.call('GET', null, 'other'); assert.equal(result.data.canEdit, true);
  assert.deepEqual(result.data.item.values, VALUES); assert.deepEqual(powerSnapshot(f), before);
});
run('power and audit tables have no log foreign key or cascade dependency', async f => {
  await f.call('POST'); f.sql.exec('PRAGMA foreign_keys = ON');
  for (const table of ['to_night_power_daily', 'to_night_power_audit']) {
    assert.equal(f.sql.prepare(`PRAGMA foreign_key_list(${table})`).all().length, 0);
  }
  const before = powerSnapshot(f); f.sql.exec('DELETE FROM shift_logs'); assert.deepEqual(powerSnapshot(f), before);
});
run('sync invalidates an open source revision without erasing the last successful save', async f => {
  await f.call('POST'); const before = powerSnapshot(f);
  const draft = f.body(); draft.expectedRevision = 1; draft.values.ismartReception = 99;
  f.sql.exec('UPDATE shift_logs SET revision = revision + 1');
  assert.equal((await f.call('POST', draft)).status, 409); assert.deepEqual(powerSnapshot(f), before);
});
run('sync races with explicit save: transaction stops without erasing saved values or audit', async f => {
  await f.call('POST'); const before = powerSnapshot(f); const draft = f.body();
  draft.expectedRevision = 1; draft.values.ismartReception = 25;
  f.db.beforeWriteBatch = () => f.sql.exec('UPDATE shift_logs SET revision = revision + 1');
  assert.equal((await f.call('POST', draft)).status, 409); assert.deepEqual(powerSnapshot(f), before);
});
run('empty automated-looking POST cannot clear an existing manual record', async f => {
  await f.call('POST'); const before = powerSnapshot(f);
  for (const missing of [{}, null, Object.fromEntries(Object.keys(VALUES).map(key => [key, '']))]) {
    const body = f.body(); body.expectedRevision = 1; body.values = missing;
    assert.equal((await f.call('POST', body)).status, 400); assert.deepEqual(powerSnapshot(f), before);
  }
});
run('explicit authorized correction to all zeros remains valid after synchronization', async f => {
  await f.call('POST'); f.sql.exec('UPDATE shift_logs SET revision = 3');
  const body = f.body(); body.expectedRevision = 1; body.sourceLogRevision = 3;
  body.values = Object.fromEntries(Object.keys(VALUES).map(key => [key, 0]));
  const result = await f.call('POST', body); assert.equal(result.status, 200);
  assert.equal(result.data.item.revision, 2); assert.deepEqual(result.data.item.values, body.values);
  assert.equal(f.count('to_night_power_audit'), 2);
});
run('other work dates do not inherit or clear the saved date values', async f => {
  await f.call('POST'); const before = powerSnapshot(f);
  for (const date of ['2026-09-25', '2026-09-27']) {
    const result = await f.call('GET', null, 'to', {date}); assert.equal(result.data.item, null);
  }
  assert.deepEqual(powerSnapshot(f), before); assert.deepEqual((await f.call()).data.item.values, VALUES);
});
run('repeated read/refresh does not increment revision or write an audit entry', async f => {
  await f.call('POST'); const before = powerSnapshot(f);
  for (let i = 0; i < 20; i++) assert.equal((await f.call()).data.item.revision, 1);
  assert.deepEqual(powerSnapshot(f), before);
});
for (const [name, mutate] of [
  ['null record', p => { p.item = null; }],
  ['lower revision', p => { p.item.revision = 1; }],
  ['equal revision with changed values', p => { p.item.values.generatorEcmsGen1 = 0; }],
  ['wrong date', p => { p.targetDate = '2026-09-27'; }],
  ['blank number', p => { p.item.values.generatorEcmsGen1 = ''; }]
]) run('refresh rejects ' + name + ' without mutating the confirmed payload', async f => {
  await f.call('POST'); const draft = f.body(); draft.expectedRevision = 1; await f.call('POST', draft);
  const prior = (await f.call()).data, before = JSON.stringify(prior), incoming = structuredClone(prior); mutate(incoming);
  assert.throws(() => pure.acceptRefresh(prior, incoming, DATE)); assert.equal(JSON.stringify(prior), before);
});
run('refresh accepts newer explicit zero correction and updated duty permission', async f => {
  await f.call('POST'); const prior = (await f.call()).data, incoming = structuredClone(prior);
  incoming.item.revision++; incoming.item.values.generatorEcmsGen1 = 0; incoming.canEdit = false; incoming.sourceLog = null;
  const accepted = pure.acceptRefresh(prior, incoming, DATE);
  assert.equal(accepted.item.values.generatorEcmsGen1, 0); assert.equal(accepted.canEdit, false);
  assert.equal(prior.item.values.generatorEcmsGen1, VALUES.generatorEcmsGen1);
});
run('unchanged revision may update source log identity and permissions without changing the record', async f => {
  await f.call('POST'); const prior = (await f.call()).data, incoming = structuredClone(prior);
  incoming.sourceLog = {id: 'sync-replacement', revision: 9}; incoming.canEdit = false;
  const accepted = pure.acceptRefresh(prior, incoming, DATE);
  assert.equal(accepted.sourceLog.id, 'sync-replacement'); assert.equal(accepted.canEdit, false);
  assert.deepEqual({...accepted.item.values}, VALUES);
});
run('an initial never-entered date stays missing: refresh does not manufacture a zero record', async f => {
  const incoming = (await f.call()).data, accepted = pure.acceptRefresh(null, incoming, DATE);
  assert.equal(accepted.item, null); assert.equal(f.count('to_night_power_daily'), 0);
});
