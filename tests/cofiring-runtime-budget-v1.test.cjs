'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {createCofiringPeriodCollector} = require('../local-tools/ois-agent/cofiring-dataparc-agent.js');
const contract = require('../maintenance/cofiring-live-contract.js');

const root = path.resolve(__dirname, '..');
const controllerPath = path.join(root, 'local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1');
const workerPath = path.join(root, 'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1');
const controller = fs.readFileSync(controllerPath, 'utf8');
const agent = fs.readFileSync(path.join(root, 'local-tools/ois-agent/cofiring-dataparc-agent.js'), 'utf8');
const capturedRun = Object.freeze({readyObservedSeconds:33.8321315, timeoutObservedSeconds:184.6, completedSeconds:292, ownershipBeforeCancelSeconds:40.753604});
const fixedNow = Date.parse('2026-10-17T10:40:33.953Z');
const requestId = '11111111-1111-4111-8111-111111111111';
const runId = '0123456789abcdef0123456789abcdef';
const spec = {startLocal:'2021-09-10T00:00', endLocal:'2021-09-10T03:00', stepUnit:'minute', stepValue:1};

function configuredNumber(name) {
  const matches = [...controller.matchAll(new RegExp('^\\$'+name+'=(\\d+)\\s*$', 'gm'))];
  assert.equal(matches.length, 1, 'One unambiguous controller assignment is required for '+name);
  return Number(matches[0][1]);
}

function validReport(overrides={}) {
  const period = contract.period(spec, fixedNow), duration = period.durationMinutes * 60;
  return {kind:'cofiring_dataparc_period_report', schemaVersion:1, status:'PERIOD_READY', runId, ...spec,
    queryEndLocal:period.queryEndLocal, executionSucceeded:true, cleanupVerified:true, processCleanupVerified:true,
    timedOut:false, workerExitCode:0, cleanupErrors:[], completedAtUtc:'2021-09-10T04:02:00Z',
    summaries:contract.definitions.map((definition,index)=>({key:definition.id, unit:definition.unit,
      fuel:definition.fuel, tag:definition.queryTag, startValue:100+index, endValue:120+index,
      min:100+index, max:120+index, delta:20, usageTon:20, startQuality:'Good', endQuality:'Good',
      startTime:spec.startLocal+':00+09:00', endTime:spec.endLocal+':00+09:00',
      durationGoodSeconds:duration, durationBadSeconds:0, boundaryValid:true, durationCoverageValid:true})), ...overrides};
}

function harness(t, {report=validReport(), code=0}={}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cofiring-runtime-budget-'));
  t.after(()=>fs.rmSync(directory, {recursive:true, force:true}));
  let launches = 0;
  const collector = createCofiringPeriodCollector({platform:'win32', runsDirectory:directory, log:()=>{},
    spawnProcess:(_executable,args,options)=>{
      launches++;
      assert.equal(options.shell, false);
      const output = args[args.indexOf('-OutputDirectory')+1];
      const child = new EventEmitter();
      child.pid = 777;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(()=>{
        child.stdout.write('__COFIRING_PROGRESS__'+JSON.stringify({schemaVersion:1, runId,
          phase:'WORKER_ENTERED', atUtc:'2021-09-10T04:00:00Z', elapsedSeconds:0})+'\n');
        fs.writeFileSync(path.join(output, 'period-report.json'), JSON.stringify(report));
        child.stdout.end(); child.stderr.end(); child.emit('close', code, null);
      });
      return child;
    }});
  return {directory, get launches(){return launches;}, run:remainingMilliseconds=>collector({agentId:'test-agent'}, {
    id:requestId, requestType:'cofiring_period', status:'processing', agentId:'test-agent',
    startedAt:new Date(fixedNow).toISOString(), expiresAt:new Date(fixedNow+remainingMilliseconds).toISOString(),
    result:contract.periodEnvelope(spec)
  })};
}

test('the configured envelope covers the captured run and reserves room for independent cleanup and delivery', ()=>{
  const execution = configuredNumber('timeoutSeconds'), startup = configuredNumber('startupTimeoutSeconds');
  const outer = configuredNumber('outerTimeoutSeconds'), cleanup = configuredNumber('cleanupGraceSeconds');
  const remaining = /const PERIOD_MIN_REMAINING_MS=(\d+)\*60000;/.exec(agent);
  assert.ok(remaining, 'The Agent admission lease must remain explicit');
  assert.equal(startup, 120, 'The startup stall guard is preserved');
  assert.ok(capturedRun.readyObservedSeconds+execution > capturedRun.completedSeconds,
    'The final cleanup-certified write must fit; a 240-second execution budget still cuts this run short');
  assert.ok(outer > capturedRun.completedSeconds, 'The outer cap must not interrupt the captured completion');
  assert.ok(Number(remaining[1])*60 >= outer+cleanup+capturedRun.ownershipBeforeCancelSeconds+60,
    'Admission must cover the outer cap, cooperative cleanup, observed ownership lookup and delivery margin');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(workerPath)).digest('hex'),
    '7b02eaa5c8289bad2c1fd06c9acc82336cfae5dd3f572f99a97115194fe73f25',
    'This budget correction must leave the reviewed worker and cleanup implementation byte-identical');
});

test('a genuinely finished worker bypasses the timeout polling wait', ()=>{
  assert.match(controller, /if \(\$worker\.HasExited -and \$null -ne \$readyObservedSeconds\) \{ break \}/);
  const completed = controller.indexOf('if ($worker.HasExited -and $null -ne $readyObservedSeconds) { break }');
  const budget = controller.indexOf('$budget=Get-CofiringDeadlineDecision', completed);
  assert.ok(completed >= 0 && budget > completed,
    'A completed, readiness-verified worker must leave the loop before late log polling can mark it timed out');
});

test('period Agent rejects one millisecond below ten minutes before launching or creating a run', async t=>{
  t.mock.method(Date, 'now', ()=>fixedNow);
  const h = harness(t);
  await assert.rejects(h.run(10*60000-1), /남은 처리시간/);
  assert.equal(h.launches, 0);
  assert.deepEqual(fs.readdirSync(h.directory), []);
});

test('exactly ten minutes admits an immediate valid result without waiting for the expanded budget', async t=>{
  t.mock.method(Date, 'now', ()=>fixedNow);
  const h = harness(t);
  const outcome = await Promise.race([
    h.run(10*60000).then(value=>({finished:true, value})),
    new Promise(resolve=>setImmediate(()=>resolve({finished:false})))
  ]);
  assert.equal(outcome.finished, true, 'Budget is a ceiling, never an added delay or countdown');
  assert.equal(outcome.value.report.status, 'PERIOD_READY');
  assert.equal(h.launches, 1);
  assert.equal(fs.existsSync(path.join(h.directory, 'cleanup-blocked.json')), false);
});

test('more runtime allowance never promotes the captured preliminary summary without worker cleanup certification', async t=>{
  t.mock.method(Date, 'now', ()=>fixedNow);
  const h = harness(t, {report:validReport({summaryReady:true, cleanupVerified:false, processCleanupVerified:true})});
  await assert.rejects(h.run(30*60000));
  assert.equal(h.launches, 1);
  assert.equal(fs.existsSync(path.join(h.directory, 'cleanup-blocked.json')), true);
});

const candidates = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : [process.env.COFIRING_TEST_POWERSHELL || 'pwsh'];
const shell = candidates.find(candidate=>spawnSync(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'],
  {encoding:'utf8', timeout:15000}).status === 0);
test('actual PowerShell deadline and success gates use the captured timeline without Excel or waiting',
  {skip:!shell && 'PowerShell unavailable; run tests/helpers/cofiring-runtime-budget-v1.ps1 on Windows'}, ()=>{
    const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'helpers/cofiring-runtime-budget-v1.ps1')], {encoding:'utf8', timeout:30000});
    assert.equal(result.status, 0, result.stdout+'\n'+result.stderr);
    assert.match(result.stdout, /PASS: actual controller deadline/);
  });
