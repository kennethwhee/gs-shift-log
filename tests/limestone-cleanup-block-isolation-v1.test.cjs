'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

function extractFunction(rawSource, name) {
  const source = rawSource.replace(/\r\n?/g, '\n');
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `Missing actual function ${name}`);
  const closingBrace = source.indexOf('\n}\n', start);
  assert.ok(closingBrace >= start, `Missing actual function boundary ${name}`);
  return source.slice(start, closingBrace + 3);
}

function readFunction(relativePath, name) {
  const sourcePath = name === 'getNextOisAgentLaneRequests' && process.env.GS_TEST_AGENT_SOURCE
    ? process.env.GS_TEST_AGENT_SOURCE : path.join(__dirname, '..', relativePath);
  return extractFunction(fs.readFileSync(sourcePath, 'utf8'), name);
}

const agentFunction = readFunction('local-tools/ois-agent/ois-login.js', 'getNextOisAgentLaneRequests');
const serverFunction = readFunction('functions/api/ois-data-requests.js', 'handleAgentNextRequest');
const limestone = { id: 'limestone-1', requestType: 'limestone_stock', targetDate: '2026-10-19' };

for (const eol of ['\n', '\r\n']) {
  test(`actual agent and server functions extract identically with ${eol === '\n' ? 'LF' : 'Windows CRLF'} source`, () => {
    for (const [relativePath, name, expected] of [
      ['local-tools/ois-agent/ois-login.js', 'getNextOisAgentLaneRequests', agentFunction],
      ['functions/api/ois-data-requests.js', 'handleAgentNextRequest', serverFunction]
    ]) {
      const raw = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8').replace(/\r\n?/g, '\n');
      assert.equal(extractFunction(raw.replace(/\n/g, eol), name), expected);
    }
  });
}

test('function extraction rejects absent functions and missing closing boundaries', () => {
  assert.throws(() => extractFunction('const other = 1;\r\n', 'missing'), /Missing actual function missing/);
  assert.throws(() => extractFunction('async function incomplete() {\r\n', 'incomplete'), /Missing actual function boundary incomplete/);
});

function agentHarness({ cofiring = false, bedAsh = false, response, api } = {}) {
  const calls = [];
  let legacyCalls = 0;
  const context = vm.createContext({
    Date, console: { warn() {} },
    isCofiringExcelBlocked: () => cofiring,
    isBedAshExcelBlocked: () => bedAsh,
    normalizeOisAgentText: value => String(value ?? '').trim(),
    DAILY_OPERATION_REQUEST_TYPE: 'daily_operation_data',
    getOisAgentApiUrl: (_config, params) => {
      const url = new URL('https://example.test/api/ois-data-requests');
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
      return url.toString();
    },
    requestOisAgentApi: async (config, url) => {
      calls.push({ config, url: new URL(url) });
      return api ? api(config, new URL(url)) : response ?? { item: limestone };
    },
    getNextOisAgentRequest: async () => { legacyCalls += 1; return limestone; }
  });
  vm.runInContext(agentFunction, context);
  return {
    calls,
    get legacyCalls() { return legacyCalls; },
    run: agentMode => context.getNextOisAgentLaneRequests({ agentMode, agentId: 'agent-a' })
  };
}

for (const [cofiring, bedAsh] of [[true, false], [false, true], [true, true]]) {
  const label = `cofiring=${cofiring}, Bed Ash=${bedAsh}`;
  test(`hybrid limestone remains available with ${label}`, async () => {
    const h = agentHarness({ cofiring, bedAsh });
    const items = await h.run('hybrid');
    assert.equal(items.length, 1);
    assert.equal(items[0], limestone);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url.searchParams.get('action'), 'next');
    assert.equal(h.calls[0].url.searchParams.get('requestTypes'), 'limestone_stock');
    assert.equal(h.calls[0].url.searchParams.has('excelRequestTypes'), false);
    assert.equal(h.calls[0].url.searchParams.has('oisRequestTypes'), false);
    assert.equal(h.legacyCalls, 0);
  });
  test(`Excel mode keeps its original block with ${label}`, async () => {
    const h = agentHarness({ cofiring, bedAsh });
    await assert.rejects(h.run('excel'), cofiring ? /혼소율 조회용 Excel 종료 확인/ : /Bed Ash 조회용 Excel 종료 확인/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.legacyCalls, 0);
  });
}

test('unblocked hybrid still claims its two original lanes in one request', async () => {
  const excel = { id: 'cofiring-1', requestType: 'cofiring_period' };
  const h = agentHarness({ response: { items: { ois: limestone, excel } } });
  const items = await h.run('hybrid');
  assert.equal(items.length, 2);
  assert.equal(items[0], limestone);
  assert.equal(items[1], excel);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url.searchParams.get('action'), 'next_lanes');
  assert.ok(h.calls[0].url.searchParams.get('oisRequestTypes').split(',').includes('limestone_stock'));
  assert.ok(h.calls[0].url.searchParams.get('excelRequestTypes').split(',').includes('cofiring_period'));
  assert.equal(h.legacyCalls, 0);
});

test('unblocked Excel mode keeps its original single-request function', async () => {
  const h = agentHarness();
  const items = await h.run('excel');
  assert.equal(items.length, 1);
  assert.equal(items[0], limestone);
  assert.equal(h.calls.length, 0);
  assert.equal(h.legacyCalls, 1);
});

test('restricted claim propagates API failure without another claim route', async () => {
  const failure = new Error('API connection failed');
  const h = agentHarness({ cofiring: true, api: async () => { throw failure; } });
  await assert.rejects(h.run('hybrid'), error => error === failure);
  assert.equal(h.calls.length, 1);
  assert.equal(h.legacyCalls, 0);
});

test('restricted claim with no item remains idle', async () => {
  for (const response of [{ item: null }, {}, { items: { ois: limestone } }]) {
    const h = agentHarness({ bedAsh: true, response });
    assert.equal((await h.run('hybrid')).length, 0);
    assert.equal(h.calls.length, 1);
  }
});

test('restricted claim accepts the existing snake-case request type', async () => {
  const item = { id: 'limestone-2', request_type: 'limestone_stock' };
  const h = agentHarness({ cofiring: true, response: { item } });
  assert.equal((await h.run('hybrid'))[0], item);
});

test('restricted claim rejects every unexpected returned request type', async () => {
  for (const type of ['water_environment', 'bed_ash_level', 'cofiring_period', 'daily_data_excel', 'organic_silo_dataparc', '']) {
    const h = agentHarness({ cofiring: true, response: { item: { id: 'wrong', requestType: type } } });
    await assert.rejects(h.run('hybrid'), /석회석 이외 요청/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.legacyCalls, 0);
  }
});

function serverHarness(t, guardAgentId) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE ois_data_requests (
    id TEXT PRIMARY KEY, request_type TEXT, status TEXT, target_date TEXT,
    requested_at TEXT, started_at TEXT, agent_id TEXT, expires_at TEXT, updated_at TEXT
  )`);
  const insert = sqlite.prepare('INSERT INTO ois_data_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run('limestone-1', 'limestone_stock', 'pending', '2026-10-19', '2026-10-19T00:00:00Z', null, null, '2099-01-01T00:00:00Z', null);
  insert.run('cofiring-1', 'cofiring_period', 'pending', '2026-10-19', '2026-10-18T00:00:00Z', null, null, '2099-01-01T00:00:00Z', null);
  if (guardAgentId) insert.run('guard-1', 'cofiring_restart_guard', 'guard', '', '', null, guardAgentId, '2099-01-01T00:00:00Z', null);
  const database = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; }
      };
    }
  };
  const context = vm.createContext({
    Date,
    authenticateOisAgent: async () => ({ agentId: 'agent-a' }),
    ensureOisQueuePerformanceIndexes: async () => {},
    normalizeText: value => String(value ?? '').trim(),
    normalizeRequestTypeList: value => String(value ?? '').split(',').filter(Boolean),
    normalizeRequestType: value => value,
    OIS_REQUEST_TYPES: ['limestone_stock', 'cofiring_period'],
    BLOWER_RUNTIME_PROBE_REQUEST_TYPE: 'blower_runtime_dataparc',
    getRequestProcessingTimeoutMinutes: () => 30,
    findRequestById: async (_database, id) => {
      const row = sqlite.prepare('SELECT * FROM ois_data_requests WHERE id = ?').get(id);
      return row ? { id: row.id, requestType: row.request_type, status: row.status, targetDate: row.target_date } : null;
    },
    jsonResponse: (body, status = 200) => ({ body, status })
  });
  vm.runInContext(serverFunction, context);
  return {
    sqlite,
    api: async (_config, url) => {
      const result = await context.handleAgentNextRequest({ env: { DB: database } }, url);
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
      return result.body;
    }
  };
}

test('actual action=next SQL honors this agent restart guard and leaves both requests pending', async t => {
  const server = serverHarness(t, 'agent-a');
  const h = agentHarness({ cofiring: true, bedAsh: true, api: server.api });
  assert.equal((await h.run('hybrid')).length, 0);
  const rows = server.sqlite.prepare('SELECT id, status, agent_id FROM ois_data_requests ORDER BY id').all();
  assert.deepEqual(rows.map(row => [row.id, row.status, row.agent_id]), [
    ['cofiring-1', 'pending', null], ['guard-1', 'guard', 'agent-a'], ['limestone-1', 'pending', null]
  ]);
});

for (const guardAgentId of [null, 'another-agent']) {
  test(`actual action=next SQL claims only limestone when guard belongs to ${guardAgentId || 'no agent'}`, async t => {
    const server = serverHarness(t, guardAgentId);
    const h = agentHarness({ cofiring: true, bedAsh: true, api: server.api });
    const items = await h.run('hybrid');
    assert.equal(items.length, 1);
    assert.equal(items[0].requestType, 'limestone_stock');
    assert.equal(server.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id='limestone-1'").get().status, 'processing');
    assert.equal(server.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id='cofiring-1'").get().status, 'pending');
    if (guardAgentId) assert.equal(server.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id='guard-1'").get().status, 'guard');
  });
}
