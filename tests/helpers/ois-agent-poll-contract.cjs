'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');

// The repository uses 1 s for fast pickup. docs/review-2026-09-24.md A03
// explicitly preserves the observed 10 s workstation idle setting.
// Neither value changes browser status polling or the Blower batch window.
const REVIEWED_IDLE_INTERVALS = Object.freeze([1000, 10000]);

function numericConstant(source, name) {
  const matches = [...source.matchAll(new RegExp('\\bconst\\s+' + name + '\\s*=\\s*(\\d+)\\s*;', 'g'))];
  assert.equal(matches.length, 1, `expected one numeric ${name} declaration`);
  return Number(matches[0][1]);
}

function assertReviewedAgentPolling(source) {
  const idle = numericConstant(source, 'OIS_AGENT_POLL_INTERVAL');
  assert.ok(REVIEWED_IDLE_INTERVALS.includes(idle), 'Agent idle poll must be the reviewed 1000 or 10000 ms value');
  assert.equal(numericConstant(source, 'OIS_AGENT_ERROR_RETRY_INTERVAL'), 60000, 'claim errors must retain the 60 s backoff');
  return idle;
}

function loginSource(source) {
  const start = source.indexOf('async function loginOis()');
  const end = source.indexOf('\nconst oisAgentStartPromise', start);
  assert.ok(start >= 0 && end > start, 'loginOis and its startup boundary are required');
  return source.slice(start, end);
}

// Execute the real loginOis function in an isolated context. Only queue,
// collection, delivery and clock boundaries are mocked. No Agent module is
// imported, and no browser, Excel, network or host process is started.
async function verifyAgentPollingScenario(source, scenario) {
  const idle = assertReviewedAgentPolling(source);
  assert.ok(['idle', 'request', 'error'].includes(scenario));
  const events = [], exits = [], failures = [], handlers = new Map();
  const item = {id: 'poll-test-request', requestType: 'cofiring_period', targetDate: '2026-09-27'};
  const result = {requestId: item.id, readOnly: true};
  let claims = 0;
  const stop = async () => {
    assert.ok(handlers.has('SIGINT'), 'the real shutdown handler must be registered');
    await handlers.get('SIGINT')();
  };
  const context = {
    OIS_AGENT_POLL_INTERVAL: idle,
    OIS_AGENT_ERROR_RETRY_INTERVAL: 60000,
    BLOWER_RUNTIME_PROBE_REQUEST_TYPE: 'blower_runtime_probe',
    getOisAgentConfig: () => ({agentMode: 'excel', agentId: 'poll-fixture', shiftLogBaseUrl: 'fixture'}),
    console: {log() {}, warn() {}, error() {}},
    process: {once: (signal, callback) => handlers.set(signal, callback), exit: code => exits.push(code)},
    getNextOisAgentLaneRequests: async () => {
      events.push('claim');
      claims += 1;
      // Bound a mutation that removes the awaited sleep instead of hanging.
      if (claims > 1) {await stop(); return [];}
      if (scenario === 'error') throw new Error('synthetic queue error');
      return scenario === 'request' ? [item] : [];
    },
    waitOisAgent: async ms => {events.push(['wait', ms]); await stop();},
    normalizeOisAgentText: value => String(value ?? '').trim(),
    getOisAgentRequestType: request => request.requestType,
    getOisAgentRequestLabel: type => type,
    isExcelOnlyRequestType: () => true,
    isExcelComRequestType: () => true,
    collectOisAgentRequestResult: async (_page, _config, request) => {
      assert.equal(request, item); events.push('collect'); return result;
    },
    completeOisAgentRequest: async (_config, id, value) => {
      assert.equal(id, item.id); assert.equal(value, result); events.push('complete');
    },
    printOisAgentRequestResult() {},
    failOisAgentRequest: async (_config, _id, error) => {failures.push(error); await stop();}
  };
  await new vm.Script(loginSource(source) + '\nloginOis();', {filename: 'isolated-loginOis.js'})
    .runInNewContext(context, {timeout: 1000});
  assert.deepEqual(failures, [], 'claimed request must not fail');
  assert.equal(claims, 1, 'one loop iteration must await its appropriate delay');
  assert.deepEqual(exits, [0], 'the fixture shuts down through the real handler');
  const expected = scenario === 'request'
    ? ['claim', 'collect', 'complete', ['wait', 1000]]
    : ['claim', ['wait', scenario === 'error' ? 60000 : idle]];
  assert.deepEqual(events, expected, 'queue pickup, completion and backoff order must be preserved');
  return events;
}

module.exports = {REVIEWED_IDLE_INTERVALS, assertReviewedAgentPolling, verifyAgentPollingScenario};
