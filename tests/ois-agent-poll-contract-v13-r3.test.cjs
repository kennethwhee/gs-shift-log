'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertReviewedAgentPolling, verifyAgentPollingScenario} = require('./helpers/ois-agent-poll-contract.cjs');
const source = fs.readFileSync(path.join(__dirname, '../local-tools/ois-agent/ois-login.js'), 'utf8');

function withIdle(ms) {
  assertReviewedAgentPolling(source);
  return source.replace(/(const\s+OIS_AGENT_POLL_INTERVAL\s*=\s*)\d+(\s*;)/, `$1${ms}$2`);
}
function mutateOnce(text, pattern, replacement) {
  const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
  assert.equal(matches.length, 1, 'mutation must address exactly one production branch');
  return text.replace(pattern, replacement);
}

test('installed Agent keeps a reviewed idle value and the unchanged claim-error backoff', () => {
  assertReviewedAgentPolling(source);
});

for (const ms of [1000, 10000]) {
  for (const scenario of ['idle', 'request', 'error']) {
    test(`real loginOis: ${ms} ms idle setting, ${scenario} path`, async () => {
      await verifyAgentPollingScenario(withIdle(ms), scenario);
    });
  }
}

test('the contract rejects unreviewed idle values and missing or duplicate declarations', () => {
  for (const value of [0, 500, 5000, 10001, 60000]) {
    assert.throws(() => assertReviewedAgentPolling(withIdle(value)), /reviewed 1000 or 10000/);
  }
  assert.throws(() => assertReviewedAgentPolling(source.replace(/const\s+OIS_AGENT_POLL_INTERVAL\s*=\s*\d+\s*;/, '')), /expected one/);
  assert.throws(() => assertReviewedAgentPolling(source + '\nconst OIS_AGENT_POLL_INTERVAL = 1000;'), /expected one/);
});

test('real-loop assertions catch ignored idle settings, missing waits and a slowed active queue', async () => {
  const tenSecond = withIdle(10000);
  const idleWait = /await waitOisAgent\(\s*OIS_AGENT_POLL_INTERVAL\s*\);/;
  await assert.rejects(verifyAgentPollingScenario(mutateOnce(tenSecond, idleWait, 'await waitOisAgent(1000);'), 'idle'));
  await assert.rejects(verifyAgentPollingScenario(mutateOnce(tenSecond, idleWait, ''), 'idle'));
  const beforeCollection = /result =\s*await collectOisAgentRequestResult\(\s*null,/;
  await assert.rejects(verifyAgentPollingScenario(mutateOnce(tenSecond, beforeCollection,
    'await waitOisAgent(1000);\n$&'), 'request'));
  const activeWait = /await waitOisAgent\(\s*1000\s*\);\s*\}\s*\}\s*finally/;
  await assert.rejects(verifyAgentPollingScenario(mutateOnce(tenSecond, activeWait,
    'await waitOisAgent(OIS_AGENT_POLL_INTERVAL);\n    }\n  } finally'), 'request'));
  const errorWait = /await waitOisAgent\(\s*OIS_AGENT_ERROR_RETRY_INTERVAL\s*\);/;
  await assert.rejects(verifyAgentPollingScenario(mutateOnce(tenSecond, errorWait, 'await waitOisAgent(1000);'), 'error'));
});
