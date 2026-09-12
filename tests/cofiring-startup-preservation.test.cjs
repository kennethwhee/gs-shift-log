'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'local-tools/ois-agent/cofiring-period-v5');
const workerBytes = fs.readFileSync(path.join(runtime, 'cofiring-period-worker-v5.ps1'));
const worker = workerBytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const controller = fs.readFileSync(path.join(runtime, 'run-cofiring-period-v5.ps1'), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const baselines = require('./cofiring-startup-preservation-baselines.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function preservedPart(item) {
  const source = item.source === 'worker' ? worker : controller;
  const start = source.indexOf(item.start);
  assert.notEqual(start, -1);
  const end = source.indexOf(item.end, start);
  assert.notEqual(end, -1);
  return source.slice(start, end).replace(/^\s*Write-CofiringProgress '(?:QUERY_START|QUERY_COMPLETE|CLEANUP)'\n/gm, '');
}
test('startup budget patch preserves reviewed NativeOM and owned Excel exit', () => {
  for (const item of baselines.slice(0, 2)) assert.equal(sha(preservedPart(item)), item.sha256);
});
test('startup budget patch preserves controller ownership, cleanup and execution acceptance', () => {
  const item = baselines[2];
  assert.equal(sha(preservedPart(item)), item.sha256);
});
test('startup budget patch preserves every summary formula, value and quality gate', () => {
  const item = baselines[3];
  assert.equal(sha(preservedPart(item)), item.sha256);
});
test('startup budget patch preserves worker cleanup and uncertainty failure', () => {
  const item = baselines[4];
  assert.equal(sha(preservedPart(item)), item.sha256);
});
test('controller integrity pin matches the worker actually shipped', () => {
  const pin = controller.match(/\$expectedWorkerSha256='([a-f0-9]{64})'/);
  assert.ok(pin);
  assert.equal(pin[1], sha(workerBytes));
});
