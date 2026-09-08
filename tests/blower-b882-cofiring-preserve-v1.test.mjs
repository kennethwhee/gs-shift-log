import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../functions/api/ois-data-requests.js', import.meta.url), 'utf8');

test('b882 daily cofiring request bridge remains present after Blower repair merge', () => {
  assert.match(src, /requestType === "cofiring_daily"/);
  assert.match(src, /action === "cofiring_daily"/);
  assert.match(src, /action === "cofiring_progress"/);
  assert.match(src, /action === "cofiring_restart_guard"/);
  assert.match(src, /COFIRING_LIVE_CONTRACT_V1/);
  assert.match(src, /createCofiringLiveRequest/);
  assert.match(src, /completeCofiringLiveRequest/);
  assert.doesNotMatch(src, /<<<<<<<|>>>>>>>/);
});

test('Blower pending RUN request compatibility remains present in the merged request API', () => {
  assert.match(src, /blower_runtime_probe/);
  assert.match(src, /expected_cycle_start_state/);
  assert.match(src, /expected_cycle_started_at/);
});
