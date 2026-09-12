import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync('functions/api/ois-data-requests.js', 'utf8');
const agent = fs.readFileSync('local-tools/ois-agent/ois-login.js', 'utf8');

test('rebased Blower API keeps every co-firing period queue route', () => {
  assert.match(api, /action === "cofiring_period"\) return await handleCofiringPeriodGet/);
  assert.match(api, /requestType === "cofiring_period"\) return await createCofiringPeriodRequest/);
  assert.match(api, /existingRequest\.requestType === "cofiring_period"\) return await completeCofiringPeriodRequest/);
  assert.match(api, /action === "cofiring_period_progress"\) return await handleCofiringPeriodProgress/);
  assert.match(api, /async function handleCofiringPeriodGet/);
  assert.match(api, /async function createCofiringPeriodRequest/);
  assert.match(api, /async function completeCofiringPeriodRequest/);
  assert.match(api, /async function handleCofiringPeriodProgress/);
  assert.match(api, /next_blower_batch/);
  assert.match(api, /complete_blower_runtime_probe_batch/);
});

test('rebased Agent keeps co-firing period collection and the faster current poll', () => {
  assert.match(agent, /COFIRING_PERIOD_REQUEST_TYPE/);
  assert.match(agent, /collectCofiringPeriodValues/);
  assert.match(agent, /requestType === "cofiring_period"/);
  assert.match(agent, /return await collectCofiringPeriodValues/);
  assert.match(agent, /const\s+OIS_AGENT_POLL_INTERVAL\s*=\s*1000\s*;/);
  assert.match(agent, /const\s+BLOWER_RUNTIME_PROBE_BATCH_COALESCE_MS\s*=\s*400\s*;/);
  assert.match(agent, /next_blower_batch/);
  assert.match(agent, /complete_blower_runtime_probe_batch/);
});

test('rebased shared files contain no merge markers', () => {
  assert.doesNotMatch(api, /^(?:<<<<<<<|\|\|\|\|\|\|\||=======|>>>>>>>)$/m);
  assert.doesNotMatch(agent, /^(?:<<<<<<<|\|\|\|\|\|\|\||=======|>>>>>>>)$/m);
});
