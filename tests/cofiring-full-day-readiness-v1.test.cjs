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
const worker=fs.readFileSync(workerPath,'utf8');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('today daily mode grows from 00:00 through the click-time completed boundary',()=>{
  for(const [at,endLocal,queryEnd] of [
    ['2026-09-17T02:00:00+09:00','2026-09-17T01:59','2026-09-17T02:00:00+09:00'],
    ['2026-09-17T13:37:42+09:00','2026-09-17T13:36','2026-09-17T13:37:00+09:00']
  ]){
    const spec=ui.dailySelectionSpec('2026-09-17',Date.parse(at));
    assert.equal(spec.startLocal,'2026-09-17T00:00');
    assert.equal(spec.endLocal,endLocal);
    assert.equal(spec.queryEnd,queryEnd);
  }
});
test('past daily mode uses the full day and caps at next-day 00:01',()=>{
  const spec=ui.dailySelectionSpec('2026-09-17',Date.parse('2026-09-18T03:00:00+09:00'));
  assert.equal(spec.startLocal,'2026-09-17T00:00');
  assert.equal(spec.endLocal,'2026-09-18T00:00');
  assert.equal(spec.queryEnd,'2026-09-18T00:01:00+09:00');
});
test('UI describes today cumulative and past-day full range',()=>{
  const markup=ui.markup();
  assert.match(markup,/오늘은 00:00부터 현재까지 누적/);
  assert.match(markup,/지난 날짜는 00:00부터 다음 날 00:01까지/);
});
test('controller waits for a non-empty worker executable path',()=>{
  assert.match(controller,/function Get-CofiringStableWorkerSignature\(/);
  assert.match(controller,/\$workerSignature=Get-CofiringStableWorkerSignature \$worker/);
});
test('worker retries exact-owned NativeOM attachment once with bounded waits',()=>{
  assert.match(worker,/COFIRING_EXCEL_NATIVEOM_RETRY_V4/);
  assert.match(worker,/\$excelAttachAttempt -le 2/);
  assert.match(worker,/UtcNow\.AddSeconds\(20\)/);
  assert.match(worker,/DataPARC Host가 이미 시작되어 자동 재시도를 중단/);
});
test('Agent hash lock matches patched controller and worker',()=>{
  assert.match(agent,new RegExp("PERIOD_CONTROLLER_SHA256='"+sha(controllerPath)+"'"));
  assert.match(agent,new RegExp("PERIOD_WORKER_SHA256='"+sha(workerPath)+"'"));
});
test('index uses adaptive cumulative UI and current-selector organic cache tags',()=>{
  assert.match(index,/cofiring-period-ui-v5\.js\?v=20260917-cumulative-nativeom-adaptive-v4/);
  assert.match(index,/cofiring-organic-excel-auto-v1\.js\?v=20260917-selector-v4/);
});
