'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const repo=path.join(__dirname,'..');
const workerPath=path.join(repo,'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1');
const controllerPath=path.join(repo,'local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1');
const agentPath=path.join(repo,'local-tools/ois-agent/cofiring-dataparc-agent.js');
const worker=fs.readFileSync(workerPath,'utf8');
const controller=fs.readFileSync(controllerPath,'utf8');
const agent=fs.readFileSync(agentPath,'utf8');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('NativeOM retry opens the exact-owned /x Excel with a local workbook bootstrap',()=>{
  assert.match(worker,/COFIRING_NATIVEOM_BOOTSTRAP_WORKBOOK_V6/);
  assert.match(worker,/cofiring-nativeom-bootstrap-/);
  assert.match(worker,/NativeOM Bootstrap/);
  assert.match(worker,/-ArgumentList\s+@\("\/x",\s*\$nativeOmBootstrapArgument\)/);
});
test('existing exact-owned safety and two-attempt retry remain intact',()=>{
  assert.match(worker,/COFIRING_EXCEL_NATIVEOM_RETRY_V4/);
  assert.match(worker,/\$excelAttachAttempt\s*-le\s*2/);
  assert.match(worker,/Stop-OwnedProbeExcelAttachAttempt/);
  assert.match(worker,/DataPARC Host가 이미 시작되어 자동 재시도를 중단/);
});
test('bootstrap gets a fail-safe cleanup in the worker cleanup path',()=>{
  const marker=worker.indexOf('COFIRING_NATIVEOM_BOOTSTRAP_WORKBOOK_V6');
  const cleanupStage=worker.indexOf('조회용 Excel·DataPARC Host 정리');
  const cleanupDelete=worker.indexOf('Delete($nativeOmBootstrapPath)',cleanupStage);
  assert.ok(marker>=0&&cleanupStage>marker&&cleanupDelete>cleanupStage);
});
test('controller and Agent hash locks match the actual patched bytes',()=>{
  assert.match(controller,new RegExp("expectedWorkerSha256='"+sha(workerPath)+"'"));
  assert.match(agent,new RegExp("PERIOD_CONTROLLER_SHA256='"+sha(controllerPath)+"'"));
  assert.match(agent,new RegExp("PERIOD_WORKER_SHA256='"+sha(workerPath)+"'"));
});
