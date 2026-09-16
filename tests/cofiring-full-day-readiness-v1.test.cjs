'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const repo=path.join(__dirname,'..');
const ui=require('../maintenance/cofiring-period-ui-v5.js');
const index=fs.readFileSync(path.join(repo,'index.html'),'utf8');
const controllerPath=path.join(repo,'local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1');
const workerPath=path.join(repo,'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1');
const agent=fs.readFileSync(path.join(repo,'local-tools/ois-agent/cofiring-dataparc-agent.js'),'utf8');
const controller=fs.readFileSync(controllerPath,'utf8');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('daily mode is always selected day 00:00 through next day 00:01 boundary',()=>{
  const now=Date.parse('2026-09-17T00:32:00+09:00');
  const spec=ui.dailySelectionSpec('2026-09-17',now);
  assert.equal(spec.startLocal,'2026-09-17T00:00');
  assert.equal(spec.endLocal,'2026-09-18T00:00');
  assert.match(spec.queryEnd,/2026-09-18T00:01:00\+09:00$/);
  assert.equal(spec.durationHours,24);
});

test('today full-day daily mode waits for next-day 00:01 while custom today shortcut remains available separately',()=>{
  const before=ui.dayAvailability('2026-09-17',Date.parse('2026-09-17T23:59:59+09:00'));
  const ready=ui.dayAvailability('2026-09-17',Date.parse('2026-09-18T00:01:00+09:00'));
  assert.equal(before.ready,false);
  assert.equal(ready.ready,true);
  const custom=ui.currentDaySpec(Date.parse('2026-09-17T12:34:56+09:00'));
  assert.equal(custom.startLocal,'2026-09-17T00:00');
  assert.equal(custom.endLocal,'2026-09-17T12:33');
});

test('UI no longer describes daily mode as current-minute accumulation',()=>{
  const markup=ui.markup();
  assert.match(markup,/선택한 날짜의 하루 전체/);
  assert.doesNotMatch(markup,/오늘은 현재까지 누적/);
});

test('controller waits for a non-empty worker executable path before freezing readiness identity',()=>{
  assert.match(controller,/function Get-CofiringStableWorkerSignature\(/);
  assert.match(controller,/\$workerSignature=Get-CofiringStableWorkerSignature \$worker/);
  assert.match(controller,/IsNullOrWhiteSpace\(\[string\]\$signature\.Path\)/);
});

test('Agent hash lock matches the patched controller and unchanged worker',()=>{
  assert.match(agent,new RegExp("PERIOD_CONTROLLER_SHA256='"+sha(controllerPath)+"'"));
  assert.match(agent,new RegExp("PERIOD_WORKER_SHA256='"+sha(workerPath)+"'"));
});

test('host cache key points to recovered UI and organic auto-fill remains loaded',()=>{
  assert.match(index,/cofiring-period-ui-v5\.js\?v=20260917-full-day-readiness-v1/);
  assert.equal((index.match(/cofiring-organic-excel-auto-v1\.js/g)||[]).length,1);
});
