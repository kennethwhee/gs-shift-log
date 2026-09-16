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

test('compiler TEMP/TMP is scoped to Add-Type and restored before Excel startup',()=>{
  assert.match(worker,/COFIRING_RUNTIME_TEMP_PARITY_V7/);
  assert.match(controller,/COFIRING_CONTROLLER_RUNTIME_TEMP_PARITY_V7/);
  assert.doesNotMatch(controller,/^\s*TEMP=\$compilerTempDirectory\s*$/m);
  assert.doesNotMatch(controller,/^\s*TMP=\$compilerTempDirectory\s*$/m);
  assert.match(worker,/SetEnvironmentVariable\("TEMP", \$compilerTempPath, "Process"\)/);
  assert.match(worker,/SetEnvironmentVariable\("TMP", \$compilerTempPath, "Process"\)/);
  assert.match(worker,/SetEnvironmentVariable\("TEMP", \$runtimeTemp, "Process"\)/);
  assert.match(worker,/SetEnvironmentVariable\("TMP", \$runtimeTmp, "Process"\)/);
});

test('co-firing Excel startup now matches the proven Blower plain /x path',()=>{
  assert.match(worker,/COFIRING_BLOWER_STARTUP_PARITY_V7/);
  assert.match(worker,/Start-Process -FilePath \$ownedExcelPath -ArgumentList @\("\/x"\) -WindowStyle Hidden -PassThru/);
  assert.doesNotMatch(worker,/nativeOmBootstrap(?:Path|Argument)|COFIRING_NATIVEOM_BOOTSTRAP_WORKBOOK_V6/);
  assert.match(worker,/\$excelAttachAttempt\s*=\s*1; \$excelAttachAttempt -le 2/);
  assert.match(worker,/Wait-OwnedProbeExcelNativeObject/);
  assert.match(worker,/Write-ProbeStage "Excel COM 연결 완료"/);
  assert.match(worker,/Write-ProbeStage "Excel 옵션 설정 완료"/);
  assert.match(worker,/Write-ProbeStage "초기 통합문서 정리 완료"/);
  assert.match(worker,/Wait-OwnedProbeDataParcHost/);
});

test('controller and Agent hash locks match the patched runtime bytes',()=>{
  assert.match(controller,new RegExp("expectedWorkerSha256='"+sha(workerPath)+"'"));
  assert.match(agent,new RegExp("PERIOD_CONTROLLER_SHA256='"+sha(controllerPath)+"'"));
  assert.match(agent,new RegExp("PERIOD_WORKER_SHA256='"+sha(workerPath)+"'"));
});
