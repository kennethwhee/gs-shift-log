import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet } from '../functions/api/ois-data-requests.js';

const TYPES = ['water_environment', 'limestone_stock', 'turbine_gear_pinion', 'silo_level'];
const DAY = '2026-11-14';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE ois_data_requests (id TEXT PRIMARY KEY, request_type TEXT, target_date TEXT, status TEXT,
    requested_by_id TEXT, requested_by_name TEXT, requested_at TEXT, started_at TEXT, completed_at TEXT,
    agent_id TEXT, result_json TEXT, error_message TEXT, expires_at TEXT, updated_at TEXT);`);
  const calls = [];
  let hook = null;
  const db = {
    prepare(sql) {
      return { values: [], bind(...values) { this.values = values; return this; },
        async first() { calls.push({ sql, method: 'first', values: this.values }); await hook?.(sql, 'first', this.values);
          return sqlite.prepare(sql).get(...this.values) || null; },
        async all() { calls.push({ sql, method: 'all', values: this.values }); await hook?.(sql, 'all', this.values);
          return { results: sqlite.prepare(sql).all(...this.values) }; },
        async run() { calls.push({ sql, method: 'run', values: this.values }); await hook?.(sql, 'run', this.values);
          return { meta: { changes: Number(sqlite.prepare(sql).run(...this.values).changes) } }; } };
    },
    async batch(statements) { return await Promise.all(statements.map(statement => statement.run())); }
  };
  function add(id, type, { day = DAY, status = 'pending', owner = '', expiresAt, requestedAt } = {}) {
    const now = new Date().toISOString();
    sqlite.prepare('INSERT INTO ois_data_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, type, day, status, 'user', 'User', requestedAt || now,
      status === 'processing' ? now : null, null, owner, null, '',
      expiresAt || new Date(Date.now() + 60000).toISOString(), now);
  }
  async function claim({ parallel = true, owner = 'morning-pc', types = TYPES,
    extra = '', headers = {} } = {}) {
    const query = new URLSearchParams({ action: 'next_lanes', oisRequestTypes: types.join(','),
      excelRequestTypes: 'daily_data_excel' });
    if (parallel) query.set('morningOisConcurrency', '4');
    const response = await onRequestGet({
      request: new Request(`https://example.test/api/ois-data-requests?${query}${extra}`, {
        headers: { 'X-OIS-Agent-Key': 'agent-key', 'X-OIS-Agent-Id': owner, ...headers }
      }), env: { DB: db, OIS_AGENT_KEY: 'agent-key' }
    });
    return { status: response.status, body: await response.json() };
  }
  async function fill(primaryRequestId, { owner = 'morning-pc', headers = {}, requestTypes } = {}) {
    const query = new URLSearchParams({ action: 'morning_ois_fill' });
    if (primaryRequestId !== undefined) query.set('primaryRequestId', primaryRequestId);
    if (requestTypes !== undefined) query.set('requestTypes', Array.isArray(requestTypes) ? requestTypes.join(',') : requestTypes);
    const response = await onRequestGet({
      request: new Request(`https://example.test/api/ois-data-requests?${query}`, {
        headers: { 'X-OIS-Agent-Key': 'agent-key', 'X-OIS-Agent-Id': owner, ...headers }
      }), env: { DB: db, OIS_AGENT_KEY: 'agent-key' }
    });
    return { status: response.status, body: await response.json() };
  }
  return { sqlite, calls, add, claim, fill, setHook: value => hook = value,
    rows: () => sqlite.prepare('SELECT * FROM ois_data_requests ORDER BY id').all(), close: () => sqlite.close() };
}

test('legacy next_lanes still claims one OIS and one Excel without a new response field', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type));
  f.add('excel-1', 'daily_data_excel'); f.add('excel-2', 'daily_data_excel');
  const { status, body } = await f.claim({ parallel: false });
  assert.equal(status, 200); assert.equal(body.items.ois.requestType, TYPES[0]);
  assert.equal(body.items.excel.id, 'excel-1');
  assert.equal(Object.hasOwn(body.items, 'morningOis'), false);
  assert.equal(Object.hasOwn(body, 'morningOisParallelVersion'), false);
  assert.equal(f.rows().filter(row => row.status === 'processing').length, 2);
});

test('explicit capability claims four different same-date OIS types plus only one Excel', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type));
  f.add('excel-1', 'daily_data_excel'); f.add('excel-2', 'daily_data_excel');
  const { status, body } = await f.claim();
  assert.equal(status, 200); assert.equal(body.morningOisParallelVersion, 1);
  assert.equal(body.morningOisConcurrency, 4);
  assert.deepEqual(body.items.morningOis.map(item => item.requestType), TYPES);
  assert.deepEqual(body.items.ois, body.items.morningOis[0]);
  assert.equal(body.items.excel.id, 'excel-1');
  for (const item of body.items.morningOis) {
    assert.equal(item.status, 'processing'); assert.equal(item.agentId, 'morning-pc');
    assert.equal(item.targetDate, DAY); assert.ok(Date.parse(item.expiresAt) > Date.now() + 60000);
  }
  assert.equal(f.rows().find(row => row.id === 'excel-2').status, 'pending');
  assert.equal((await f.claim()).body.items.morningOis.length, 0, 'a repeated poll cannot claim a fifth OIS job');
});

test('parallel claims never duplicate a type, cross target dates, or include another OIS collector', async t => {
  const f = fixture(); t.after(f.close);
  f.add('water-a', TYPES[0]); f.add('water-b', TYPES[0]);
  f.add('limestone-other-date', TYPES[1], { day: '2026-11-13' });
  f.add('gear', TYPES[2]); f.add('silo', TYPES[3]); f.add('steam', 'steam_status');
  const { body } = await f.claim({ types: [...TYPES, 'steam_status'] });
  assert.deepEqual(body.items.morningOis.map(item => item.id), ['water-a', 'gear', 'silo']);
  for (const id of ['water-b', 'limestone-other-date', 'steam']) {
    assert.equal(f.rows().find(row => row.id === id).status, 'pending');
  }
});

for (const type of ['steam_status', 'bed_ash_level', 'auxiliary_materials', 'logsheet_approval']) {
  test(`a first ${type} request keeps the OIS lane single`, async t => {
    const f = fixture(); t.after(f.close);
    f.add('first', type); TYPES.forEach((requestType, i) => f.add(`ois-${i}`, requestType));
    const { body } = await f.claim({ types: [type, ...TYPES] });
    assert.deepEqual(body.items.morningOis.map(item => item.id), ['first']);
    assert.equal(f.rows().filter(row => row.status === 'processing').length, 1);
  });
}

test('an incompatible active OIS job blocks new-mode OIS claims but leaves Excel independent', async t => {
  const f = fixture(); t.after(f.close);
  f.add('active-steam', 'steam_status', { status: 'processing', owner: 'morning-pc' });
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type)); f.add('excel', 'daily_data_excel');
  const { body } = await f.claim();
  assert.equal(body.items.ois, null); assert.deepEqual(body.items.morningOis, []);
  assert.equal(body.items.excel.id, 'excel');
});

test('active claims at another date or an existing same-type job are not extended by a later poll', async t => {
  const f = fixture(); t.after(f.close);
  f.add('active-water', TYPES[0], { status: 'processing', owner: 'morning-pc', day: '2026-11-13' });
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type));
  assert.deepEqual((await f.claim()).body.items.morningOis, []);
  f.sqlite.prepare("UPDATE ois_data_requests SET target_date=? WHERE id='active-water'").run(DAY);
  assert.deepEqual((await f.claim()).body.items.morningOis, [], 'unacknowledged prior jobs are not silently resumed');
});

test('only live processing rows for this Agent constrain the opted-in lane', async t => {
  const f = fixture(); t.after(f.close);
  f.add('expired-active', 'steam_status', { status: 'processing', owner: 'morning-pc',
    expiresAt: new Date(Date.now() - 1000).toISOString() });
  f.add('another-agent', 'steam_status', { status: 'processing', owner: 'other-pc' });
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type));
  assert.equal((await f.claim()).body.items.morningOis.length, 4);
});

test('restart guard prevents both OIS and Excel claims in four-query mode', async t => {
  const f = fixture(); t.after(f.close);
  f.add('restart', 'cofiring_restart_guard', { status: 'guard', owner: 'morning-pc' });
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type)); f.add('excel', 'daily_data_excel');
  const { body } = await f.claim();
  assert.equal(body.items.ois, null); assert.equal(body.items.excel, null);
  assert.deepEqual(body.items.morningOis, []);
  assert.equal(f.rows().filter(row => row.status === 'processing').length, 0);
});

test('simultaneous same-Agent polls cannot double-claim or exceed four OIS jobs', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => { f.add(`ois-${i}-a`, type); f.add(`ois-${i}-b`, type); });
  const responses = await Promise.all([f.claim(), f.claim(), f.claim()]);
  const claimed = responses.flatMap(response => response.body.items.morningOis);
  assert.equal(claimed.length, 4); assert.equal(new Set(claimed.map(item => item.id)).size, 4);
  assert.equal(new Set(claimed.map(item => item.requestType)).size, 4);
  assert.equal(f.rows().filter(row => row.status === 'processing').length, 4);
});

test('two different Agents racing use pending-state CAS and never receive the same request', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type));
  const responses = await Promise.all([f.claim({ owner: 'pc-a' }), f.claim({ owner: 'pc-b' })]);
  const claimed = responses.flatMap(response => response.body.items.morningOis);
  assert.equal(claimed.length, 4); assert.equal(new Set(claimed.map(item => item.id)).size, 4);
});

test('an incompatible job appearing after candidate selection is blocked by the atomic claim guard', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type));
  let injected = false;
  f.setHook((sql, method) => {
    if (!injected && method === 'run' && /UPDATE ois_data_requests/.test(sql)) {
      injected = true;
      f.add('racing-steam', 'steam_status', { status: 'processing', owner: 'morning-pc' });
    }
  });
  const { body } = await f.claim();
  assert.deepEqual(body.items.morningOis, []);
  assert.equal(f.rows().filter(row => row.status === 'processing').length, 1);
});

test('a type claimed between extra SELECT and UPDATE cannot be duplicated or exceed the cap', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type));
  let injected = false;
  f.setHook((sql, method, values) => {
    if (!injected && method === 'run' && /UPDATE ois_data_requests/.test(sql) && values[4] === 'ois-1') {
      injected = true;
      f.add('racing-limestone', TYPES[1], { status: 'processing', owner: 'morning-pc' });
    }
  });
  const { body } = await f.claim();
  assert.deepEqual(body.items.morningOis.map(item => item.id), ['ois-0', 'ois-2', 'ois-3']);
  assert.equal(f.rows().filter(row => row.status === 'processing').length, 4);
  assert.equal(f.rows().find(row => row.id === 'ois-1').status, 'pending');
});

test('extras require the original primary to remain live and owned at UPDATE time', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type));
  let injected = false;
  f.setHook((sql, method, values) => {
    if (!injected && method === 'run' && /UPDATE ois_data_requests/.test(sql) && values[4] === 'ois-1') {
      injected = true;
      f.sqlite.prepare("UPDATE ois_data_requests SET status='complete' WHERE id='ois-0'").run();
    }
  });
  const { body } = await f.claim();
  assert.deepEqual(body.items.morningOis.map(item => item.id), ['ois-0']);
  assert.equal(f.rows().filter(row => row.status === 'pending').length, 3);
});

test('a later candidate read failure returns already-claimed OIS and Excel items', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type)); f.add('excel', 'daily_data_excel');
  f.setHook((sql, method) => { if (method === 'first' && /SELECT request\.\* FROM ois_data_requests/.test(sql)) throw new Error('injected extra-select failure'); });
  const { status, body } = await f.claim();
  assert.equal(status, 200); assert.equal(body.items.ois.id, 'ois-0');
  assert.deepEqual(body.items.morningOis.map(item => item.id), ['ois-0']);
  assert.equal(body.items.excel.id, 'excel'); assert.match(body.laneErrors.ois, /injected extra-select failure/);
});

test('a failed extra UPDATE retains every earlier successful claim', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type));
  f.setHook((sql, method, values) => {
    if (method === 'run' && /UPDATE ois_data_requests/.test(sql) && values[4] === 'ois-2') throw new Error('injected extra-update failure');
  });
  const { body } = await f.claim();
  assert.deepEqual(body.items.morningOis.map(item => item.id), ['ois-0', 'ois-1']);
  assert.match(body.laneErrors.ois, /injected extra-update failure/);
  assert.equal(f.rows().find(row => row.id === 'ois-2').status, 'pending');
});

test('expired pending requests are not claimed and the empty poll still performs one candidate SELECT', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`expired-${i}`, type, { expiresAt: new Date(Date.now() - 1000).toISOString() }));
  const { body } = await f.claim();
  assert.deepEqual(body.items.morningOis, []);
  assert.equal(f.calls.filter(call => call.method === 'all').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'first').length, 0);
});

test('invalid concurrency parameters and unauthenticated claims never mutate the queue', async t => {
  const f = fixture(); t.after(f.close); f.add('water', TYPES[0]);
  for (const value of ['', '1', '2', '5', '04', '-4', '4.0', 'four']) {
    const { status } = await f.claim({ parallel: false, extra: `&morningOisConcurrency=${value}` });
    assert.equal(status, 400, value);
  }
  assert.equal((await f.claim({ headers: { 'X-OIS-Agent-Key': 'wrong' } })).status, 403);
  assert.equal(f.rows()[0].status, 'pending'); assert.equal(f.calls.length, 0);
});

test('late card requests fill all three free slots while the first Water query is still processing', async t => {
  const f = fixture(); t.after(f.close);
  f.add('water', TYPES[0]);
  const first = await f.claim();
  assert.deepEqual(first.body.items.morningOis.map(item => item.id), ['water']);
  TYPES.slice(1).forEach((type, i) => f.add(`late-${i}`, type));
  f.add('excel-late', 'daily_data_excel');
  const beforeFill = f.calls.length;
  const { status, body } = await f.fill('water');
  assert.equal(status, 200); assert.equal(body.morningOisParallelVersion, 1);
  assert.equal(body.morningOisConcurrency, 4);
  assert.deepEqual(body.items.morningOis.map(item => item.id), ['late-0', 'late-1', 'late-2']);
  assert.deepEqual(body.items.ois, body.items.morningOis[0]); assert.equal(body.items.excel, null);
  assert.equal(f.rows().filter(row => row.status === 'processing').length, 4);
  assert.equal(f.rows().find(row => row.id === 'water').status, 'processing');
  assert.equal(f.rows().find(row => row.id === 'excel-late').status, 'pending');
  assert.equal(f.calls.slice(beforeFill).some(call => /excel_candidate/.test(call.sql)), false,
    'fill does not poll or claim the Excel lane');
});

test('fill reuses a finished slot without restarting or returning an existing live job', async t => {
  const f = fixture(); t.after(f.close);
  TYPES.forEach((type, i) => f.add(`ois-${i}`, type)); await f.claim();
  assert.deepEqual((await f.fill('ois-0')).body.items.morningOis, []);
  f.sqlite.prepare("UPDATE ois_data_requests SET status='complete' WHERE id='ois-2'").run();
  f.add('new-gear', TYPES[2]);
  const { body } = await f.fill('ois-0');
  assert.deepEqual(body.items.morningOis.map(item => item.id), ['new-gear']);
  assert.equal(f.rows().filter(row => row.status === 'processing').length, 4);
});

test('fill never crosses the primary date or claims a duplicate type or unrelated collector', async t => {
  const f = fixture(); t.after(f.close);
  f.add('water', TYPES[0]); await f.claim();
  f.add('water-duplicate', TYPES[0]);
  f.add('limestone-other-day', TYPES[1], { day: '2026-11-13' });
  f.add('gear', TYPES[2]); f.add('silo', TYPES[3]); f.add('steam', 'steam_status');
  const { body } = await f.fill('water');
  assert.deepEqual(body.items.morningOis.map(item => item.id), ['gear', 'silo']);
  for (const id of ['water-duplicate', 'limestone-other-day', 'steam']) {
    assert.equal(f.rows().find(row => row.id === id).status, 'pending');
  }
});

test('concurrent fill calls are bounded by the four live same-Agent jobs and unique type CAS', async t => {
  const f = fixture(); t.after(f.close);
  f.add('water', TYPES[0]); await f.claim();
  TYPES.slice(1).forEach((type, i) => { f.add(`late-${i}-a`, type); f.add(`late-${i}-b`, type); });
  const responses = await Promise.all([f.fill('water'), f.fill('water'), f.fill('water')]);
  const newlyClaimed = responses.flatMap(response => response.body.items.morningOis);
  assert.equal(newlyClaimed.length, 3); assert.equal(new Set(newlyClaimed.map(item => item.id)).size, 3);
  assert.equal(new Set(newlyClaimed.map(item => item.requestType)).size, 3);
  assert.equal(f.rows().filter(row => row.status === 'processing').length, 4);
});

test('fill rejects absent, malformed, unknown, wrong-owner, expired and noneligible primaries', async t => {
  const f = fixture(); t.after(f.close);
  for (const id of [undefined, '', 'has space', '../water', "' OR 1=1", 'a'.repeat(129)]) {
    assert.equal((await f.fill(id)).status, 400, String(id));
  }
  assert.equal(f.calls.length, 0);
  f.add('wrong-owner', TYPES[0], { status: 'processing', owner: 'other-pc' });
  f.add('expired', TYPES[0], { status: 'processing', owner: 'morning-pc',
    expiresAt: new Date(Date.now() - 1000).toISOString() });
  f.add('steam', 'steam_status', { status: 'processing', owner: 'morning-pc' });
  f.add('pending', TYPES[0]); f.add('finished', TYPES[0], { status: 'complete', owner: 'morning-pc' });
  for (const id of ['missing', 'wrong-owner', 'expired', 'steam', 'pending', 'finished']) {
    const { status, body } = await f.fill(id);
    assert.equal(status, 409, id); assert.equal(body.code, 'MORNING_OIS_PRIMARY_NOT_LIVE');
  }
  assert.equal(f.calls.some(call => call.method === 'run'), false);
  assert.equal((await f.fill('pending', { headers: { 'X-OIS-Agent-Key': 'wrong' } })).status, 403);
});

test('fill checks the live primary atomically again if it finishes after the initial lookup', async t => {
  const f = fixture(); t.after(f.close); f.add('water', TYPES[0]); await f.claim();
  f.add('limestone', TYPES[1]);
  let injected = false;
  f.setHook((sql, method) => {
    if (!injected && method === 'run' && /UPDATE ois_data_requests/.test(sql)) {
      injected = true;
      f.sqlite.prepare("UPDATE ois_data_requests SET status='complete' WHERE id='water'").run();
    }
  });
  const { body } = await f.fill('water');
  assert.deepEqual(body.items.morningOis, []);
  assert.equal(f.rows().find(row => row.id === 'limestone').status, 'pending');
});

test('a restart guard acquired after the initial query prevents supplementary claims', async t => {
  const f = fixture(); t.after(f.close); f.add('water', TYPES[0]); await f.claim();
  f.add('limestone', TYPES[1]);
  f.add('restart', 'cofiring_restart_guard', { status: 'guard', owner: 'morning-pc' });
  const { body } = await f.fill('water');
  assert.deepEqual(body.items.morningOis, []);
  assert.equal(f.rows().find(row => row.id === 'limestone').status, 'pending');
});

test('a later fill SELECT failure still returns newly claimed work without returning the primary', async t => {
  const f = fixture(); t.after(f.close); f.add('water', TYPES[0]); await f.claim();
  TYPES.slice(1).forEach((type, i) => f.add(`late-${i}`, type));
  let extraSelects = 0;
  f.setHook((sql, method) => {
    if (method === 'first' && /SELECT request\.\* FROM ois_data_requests/.test(sql) && ++extraSelects === 2) {
      throw new Error('injected late fill failure');
    }
  });
  const { status, body } = await f.fill('water');
  assert.equal(status, 200); assert.deepEqual(body.items.morningOis.map(item => item.id), ['late-0']);
  assert.equal(body.items.ois.id, 'late-0'); assert.match(body.laneErrors.ois, /injected late fill failure/);
});

test('fill can exclude late Water while the caller still runs its previously claimed Excel job', async t => {
  const f = fixture(); t.after(f.close);
  f.add('gear', TYPES[2]); f.add('excel', 'daily_data_excel');
  const initial = await f.claim();
  assert.deepEqual(initial.body.items.morningOis.map(item => item.id), ['gear']);
  assert.equal(initial.body.items.excel.id, 'excel');
  f.add('water-late', TYPES[0]); f.add('limestone-late', TYPES[1]); f.add('silo-late', TYPES[3]);
  const filling = await f.fill('gear', { requestTypes: TYPES.slice(1) });
  assert.deepEqual(filling.body.items.morningOis.map(item => item.id), ['limestone-late', 'silo-late']);
  assert.equal(f.rows().find(row => row.id === 'water-late').status, 'pending');
  assert.equal(f.rows().find(row => row.id === 'excel').status, 'processing');
  f.sqlite.prepare("UPDATE ois_data_requests SET status='complete' WHERE id='excel'").run();
  const afterExcel = await f.fill('gear');
  assert.deepEqual(afterExcel.body.items.morningOis.map(item => item.id), ['water-late']);
  assert.equal(f.rows().filter(row => row.status === 'processing').length, 4);
});

test('the fill subset constrains new work only and need not include a Water primary', async t => {
  const f = fixture(); t.after(f.close); f.add('water', TYPES[0]); await f.claim();
  f.add('limestone', TYPES[1]); f.add('gear', TYPES[2]); f.add('silo', TYPES[3]);
  const { status, body } = await f.fill('water', { requestTypes: TYPES.slice(1) });
  assert.equal(status, 200);
  assert.deepEqual(body.items.morningOis.map(item => item.id), ['limestone', 'gear', 'silo']);
});

test('empty or unsupported fill type subsets fail before any queue read or mutation', async t => {
  const f = fixture(); t.after(f.close); f.add('water', TYPES[0]); await f.claim();
  f.add('limestone', TYPES[1]);
  const callsBefore = f.calls.length;
  for (const requestTypes of ['', [], ['steam_status'], ['bed_ash_level'], ['daily_data_excel'],
    ['limestone_stock', 'steam_status'], 'limestone_stock,', 'unknown']) {
    const { status, body } = await f.fill('water', { requestTypes });
    assert.equal(status, 400, String(requestTypes)); assert.equal(body.code, 'MORNING_OIS_FILL_TYPES_INVALID');
  }
  assert.equal(f.calls.length, callsBefore);
  assert.equal(f.rows().find(row => row.id === 'limestone').status, 'pending');
});
