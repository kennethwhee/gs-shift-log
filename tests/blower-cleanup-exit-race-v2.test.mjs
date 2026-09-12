import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createCofiringPeriodCollector,
  PERIOD_CONTROLLER_SHA256,
  PERIOD_WORKER_SHA256
} = require('../local-tools/ois-agent/cofiring-dataparc-agent.js');

const agent = fs.readFileSync('local-tools/ois-agent/ois-login.js', 'utf8');
const periodWorker = fs.readFileSync(
  'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1',
  'utf8'
);
const periodController = fs.readFileSync(
  'local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1',
  'utf8'
);

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const occurrences = (source, pattern) => [...source.matchAll(pattern)].length;

test('Blower single and batch cleanup use retained handles and recheck exit races', () => {
  assert.equal(occurrences(agent, /function Test-ProbePinnedProcessExited\(\$Process\)/g), 2);
  assert.equal(occurrences(agent, /function Wait-ProbePinnedProcessExit\(\$Process, \[int\]\$TimeoutMilliseconds\)/g), 2);
  assert.equal(occurrences(agent, /Wait-ProbePinnedProcessExit \$launchedExcelProcess 2000/g), 2);
  assert.equal(occurrences(agent, /\$launchedExcelProcess\.Kill\(\)/g), 2);
  assert.equal(occurrences(agent, /\$launchedExcelProcess\.Dispose\(\)/g), 2);
  assert.equal(occurrences(agent, /\$ownedHostProcess\.Kill\(\)/g), 2);
  assert.equal(occurrences(agent, /\$ownedHostProcess\.Dispose\(\)/g), 2);
  assert.equal(occurrences(agent, /\$lateOwnedHosts\.Count -gt 1/g), 2);
  assert.equal(occurrences(agent, /function Test-ProbeExactProcessUniverse\(/g), 2);
  assert.equal(occurrences(agent, /최종 Excel 프로세스 전수 확인/g), 2);
  assert.equal(occurrences(agent, /최종 DataPARC Host 전수 확인/g), 2);
  assert.equal(occurrences(agent, /\$deferredExcelTeardownErrors = New-Object/g), 2);
  assert.equal(occurrences(agent, /\$excelExitVerified -and \$excelUniverseVerified -and \$hostUniverseVerified/g), 2);
  assert.equal(occurrences(agent, /\$cleanupErrors\.Add\("종료 직전 Excel COM PID가 소유 PID와 다릅니다\."\)/g), 2);
  assert.doesNotMatch(agent, /Stop-Process -Id \$ownedExcelPid/);
  assert.doesNotMatch(agent, /Stop-Process -Id \(\[int\]\$ownedHostSnapshot\.ProcessId\)/);
});

test('Blower cleanup remains fail-closed when a pinned process is still live or changes identity', () => {
  assert.equal(
    occurrences(
      agent,
      /Test-OwnedProbeExcelIdentity \$ownedExcelPid \$ownedExcelStartTicks \$ownedExcelPath \$ownedExcelSessionId[\s\S]*?\$launchedExcelProcess\.Kill\(\)/g
    ),
    2
  );
  assert.equal(occurrences(agent, /\$lateOwnedHosts\.Count -eq 1/g), 2);
  assert.equal(occurrences(agent, /\$lateOwnedHosts\.Count -gt 1/g), 2);
  assert.equal(
    occurrences(
      agent,
      /function Test-ProbeExactProcessUniverse[\s\S]*?\$actualIds\.Count -ne \$expectedIds\.Count[\s\S]*?\$actualIds -notcontains \[int\]\$expectedId[\s\S]*?Test-ProbeProcessSignatureSet \$Signatures/g
    ),
    2
  );
  assert.equal(
    occurrences(
      agent,
      /\[void\]\$ownedHostProcess\.Handle[\s\S]*?StartTime\.ToUniversalTime\(\)\.Ticks[\s\S]*?SessionId[\s\S]*?Path[\s\S]*?Test-ProbeHostSignature \$ownedHostSnapshot[\s\S]*?\$ownedHostProcess\.Kill\(\)/g
    ),
    2
  );

  let cleanupCursor = 0;
  for (let index = 0; index < 2; index += 1) {
    const excelCensus = agent.indexOf('$finalExcelPids = @(', cleanupCursor);
    const hostCensus = agent.indexOf('$finalHostPids = @(', excelCensus);
    const dispose = agent.indexOf('$launchedExcelProcess.Dispose()', hostCensus);
    assert.ok(excelCensus >= cleanupCursor && hostCensus > excelCensus && dispose > hostCensus);
    cleanupCursor = dispose + 1;
  }
  assert.equal(
    occurrences(agent, /if \(-not \$hostExited\) \{\s*\$cleanupErrors\.Add\("자동조회용 DataPARC Host가 종료되지 않았습니다\."\)\s*\}/g),
    2
  );
  assert.match(agent, /Test-ProbeExactProcessUniverse \$baselineExcelSignatures \$finalExcelPids/);
  assert.match(agent, /Test-ProbeExactProcessUniverse \$baselineHostSignatures \$finalHostPids/);
  assert.equal(
    occurrences(
      agent,
      /Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue \|\s*Where-Object \{ \[int\]\$_\.SessionId -eq \$currentSessionId \} \|\s*ForEach-Object \{ \[int\]\$_\.Id \}/g
    ),
    2
  );
  assert.equal(
    occurrences(
      agent,
      /Get-ProbeDataParcHosts \|\s*Where-Object \{ \[int\]\$_\.SessionId -eq \$currentSessionId \} \|\s*ForEach-Object \{ \[int\]\$_\.ProcessId \}/g
    ),
    2
  );
  assert.equal(
    occurrences(
      agent,
      /Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue \|\s*Where-Object \{ \[int\]\$_\.SessionId -eq \$ownedExcelSessionId \}/g
    ),
    2
  );
});

test('current co-firing progress/startup worker preserves its Excel fix and hardens late Host cleanup', () => {
  for (const token of [
    'Complete-OwnedProbeExcelExit',
    "Write-CofiringProgress 'READY'",
    "Write-CofiringProgress 'QUERY_START'",
    "Write-CofiringProgress 'QUERY_COMPLETE'",
    "Write-CofiringProgress 'COMPLETE'"
  ]) {
    assert.ok(periodWorker.includes(token), `missing current co-firing behavior: ${token}`);
  }
  assert.match(periodWorker, /\$ProcessObject\.Kill\(\)[\s\S]*?if \(\$ProcessObject\.HasExited\)/);
  assert.match(periodWorker, /\$lateOwnedHosts\.Count -eq 1[\s\S]*?Write-ProbeOwnership[\s\S]*?\$lateOwnedHosts\.Count -gt 1/);
  assert.match(periodWorker, /\[void\]\$ownedHostProcess\.Handle[\s\S]*?\$ownedHostProcess\.Kill\(\)[\s\S]*?Wait-ProbePinnedProcessExit \$ownedHostProcess 5000/);
  assert.match(periodWorker, /\$launchedExcelProcess\.Dispose\(\)/);
  assert.match(periodWorker, /Test-ProbeExactProcessUniverse \$baselineExcelSignatures \$finalExcelPids/);
  assert.match(periodWorker, /Test-ProbeExactProcessUniverse \$baselineHostSignatures \$finalHostPids/);
  assert.match(periodWorker, /\$deferredExcelTeardownErrors = New-Object/);
  assert.match(periodWorker, /\$excelExitVerified -and \$excelUniverseVerified -and \$hostUniverseVerified/);
  assert.match(periodWorker, /\$cleanupErrors\.Add\('살아 있는 Excel COM PID가 소유 PID와 달라 COM Close\/Quit을 차단했습니다\.'\)/);
  assert.match(
    periodWorker,
    /Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue \|\s*Where-Object \{ \[int\]\$_\.SessionId -eq \$currentSessionId \} \|\s*ForEach-Object \{ \[int\]\$_\.Id \}/
  );
  assert.match(
    periodWorker,
    /function Test-ProbeExactProcessUniverse[\s\S]*?\$actualIds\.Count -ne \$expectedIds\.Count[\s\S]*?\$actualIds -notcontains \[int\]\$expectedId[\s\S]*?Test-ProbeProcessSignatureSet \$Signatures/
  );
  assert.ok(periodWorker.indexOf('$launchedExcelProcess.Dispose()') > periodWorker.indexOf('$finalHostPids = @('));
  assert.match(
    periodWorker,
    /Get-ProbeDataParcHosts \|\s*Where-Object \{ \[int\]\$_\.SessionId -eq \$currentSessionId \} \|\s*ForEach-Object \{ \[int\]\$_\.ProcessId \}/
  );
  assert.doesNotMatch(periodWorker, /Stop-Process -Id \$ownedExcelPid/);
  assert.doesNotMatch(periodWorker, /Stop-Process -Id \(\[int\]\$ownedHostSnapshot\.ProcessId\)/);
});

test('period worker, controller and bridge hashes remain one verified chain', () => {
  assert.equal(sha256(periodWorker), PERIOD_WORKER_SHA256);
  assert.match(periodController, new RegExp(`\\$expectedWorkerSha256='${PERIOD_WORKER_SHA256}'`));
  assert.equal(sha256(periodController), PERIOD_CONTROLLER_SHA256);
});

function request() {
  return {
    id: '4c7c7d90-5115-4631-a072-cd2533d3476e',
    requestType: 'cofiring_period',
    status: 'processing',
    agentId: 'TEST-AGENT',
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    result: {
      kind: 'cofiring_period_request',
      schemaVersion: 1,
      startLocal: '2026-09-12T00:00',
      endLocal: '2026-09-12T09:58',
      stepUnit: 'hour',
      stepValue: 1
    }
  };
}

function failedChild(report, progressRunId = '') {
  return (_command, args) => {
    const child = new EventEmitter();
    child.pid = 32100;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    const output = args[args.indexOf('-OutputDirectory') + 1];
    fs.writeFileSync(path.join(output, 'period-report.json'), JSON.stringify(report));
    queueMicrotask(() => {
      if (progressRunId) {
        child.stdout.emit('data', `__COFIRING_PROGRESS__${JSON.stringify({
          schemaVersion: 1,
          runId: progressRunId,
          phase: 'CLEANUP',
          atUtc: '2026-09-12T01:03:40.000Z',
          elapsedSeconds: 90
        })}\n`);
      }
      child.emit('close', 1, null);
    });
    return child;
  };
}

async function markerFor(report, progressRunId = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cofiring-cleanup-identity-'));
  const collect = createCofiringPeriodCollector({
    platform: 'win32',
    runsDirectory: root,
    controllerPath: path.resolve('local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1'),
    workerPath: path.resolve('local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'),
    spawnProcess: failedChild(report, progressRunId),
    log: () => {}
  });
  try {
    await assert.rejects(() => collect({ agentId: 'TEST-AGENT' }, request()));
    return fs.existsSync(path.join(root, 'cleanup-blocked.json'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('only an identity-matched dual cleanup certificate can suppress the global block', async () => {
  const runId = '0f2886538f9f4d948731c91e72ec0d3b';
  const valid = {
    kind: 'cofiring_dataparc_period_report',
    schemaVersion: 1,
    runId,
    startLocal: '2026-09-12T00:00',
    endLocal: '2026-09-12T09:58',
    stepUnit: 'hour',
    stepValue: 1,
    queryEndLocal: '2026-09-12T09:59',
    cleanupVerified: true,
    processCleanupVerified: true,
    cleanupErrors: []
  };

  assert.equal(await markerFor(valid), true);
  assert.equal(await markerFor(valid, runId), false);
  for (const unsafe of [
    { ...valid, kind: 'foreign' },
    { ...valid, schemaVersion: 2 },
    { ...valid, startLocal: '2026-09-12T00:01' },
    { ...valid, endLocal: '2026-09-12T09:59' },
    { ...valid, stepUnit: 'minute' },
    { ...valid, stepValue: 5 },
    { ...valid, queryEndLocal: '2026-09-12T10:00' },
    { ...valid, runId: undefined },
    { ...valid, runId: 'not-a-run-id' },
    { ...valid, cleanupVerified: false },
    { ...valid, processCleanupVerified: false },
    { ...valid, cleanupErrors: ['unverified'] }
  ]) {
    assert.equal(await markerFor(unsafe, runId), true);
  }
  assert.equal(await markerFor({ ...valid, runId: 'f'.repeat(32) }, runId), true);
});
