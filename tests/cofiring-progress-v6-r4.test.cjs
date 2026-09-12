'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createCofiringPeriodCollector}=require('../local-tools/ois-agent/cofiring-dataparc-agent.js');
const contract=require('../maintenance/cofiring-live-contract.js');
const {createPeriod}=require('../maintenance/cofiring-live.js');
const {liveRequestPresentation}=require('../maintenance/cofiring-period-ui-v5.js');
const id='11111111-1111-4111-8111-111111111111',savedId='22222222-2222-4222-8222-222222222222',runId='0123456789abcdef0123456789abcdef';
const spec={startLocal:'2026-09-10T00:00',endLocal:'2026-09-10T12:00',stepUnit:'hour',stepValue:1};
function report(overrides={}){
  const p=contract.period(spec,Number.MAX_SAFE_INTEGER),duration=p.durationMinutes*60;
  const summaries=contract.definitions.map((def,i)=>({key:def.id,unit:def.unit,fuel:def.fuel,tag:def.queryTag,startValue:100+i,endValue:120+i,min:100+i,max:120+i,delta:20,usageTon:20,startQuality:'Good',endQuality:'Good',startTime:spec.startLocal+':00+09:00',endTime:spec.endLocal+':00+09:00',durationGoodSeconds:duration,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}));
  return {kind:'cofiring_dataparc_period_report',schemaVersion:1,status:'PERIOD_READY',runId,...spec,queryEndLocal:p.queryEndLocal,executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],completedAtUtc:'2026-09-10T04:02:00Z',summaries,...overrides};
}
function event(phase,seconds,overrides={}){return '__COFIRING_PROGRESS__'+JSON.stringify({schemaVersion:1,runId,phase,atUtc:new Date(Date.parse('2026-09-10T04:00:00Z')+seconds*1000).toISOString(),elapsedSeconds:seconds,...overrides})+'\n';}
function harness(t,{chunks=[],result=report(),code=0,progressError=false,onProgress,errorInsteadOfClose=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cofiring-progress-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let calls=0,lastChild;const progress=[],logs=[];
  const collect=createCofiringPeriodCollector({platform:'win32',runsDirectory:root,log:line=>logs.push(line),spawnProcess:(exe,args,options)=>{
    calls++;assert.match(exe,/WindowsPowerShell/);assert.equal(options.shell,false);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);
    const dir=args[args.indexOf('-OutputDirectory')+1],child=new EventEmitter();lastChild=child;child.pid=777;child.stdout=new PassThrough();child.stderr=new PassThrough();
    setImmediate(()=>{for(const chunk of chunks)child.stdout.write(chunk);if(result)fs.writeFileSync(path.join(dir,'period-report.json'),JSON.stringify(result));if(errorInsteadOfClose)child.emit('error',new Error('synthetic child stream failure'));else{child.stdout.end();child.stderr.end();child.emit('close',code,null);}});
    return child;
  }});
  const request={id,requestType:'cofiring_period',status:'processing',agentId:'test-agent',startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+10*60000).toISOString(),result:contract.periodEnvelope(spec)};
  return {root,progress,logs,request,get calls(){return calls;},get child(){return lastChild;},run:(changes={})=>collect({agentId:'test-agent'},{...request,...changes},{postProgress:async value=>{progress.push(value);if(onProgress)await onProgress(value);if(progressError)throw new Error('synthetic progress outage');}})};
}

test('verified period events advance stages while banners and cleanup preflight never imply completion',async t=>{
  const reading=event('QUERY_START',10);
  const h=harness(t,{chunks:['===== COFIRING DATAPARC PERIOD V5 =====\nExcel cleanup preflight\n고속 요약 계산 완료\n',event('WORKER_ENTERED',0),event('INITIALIZATION_COMPLETE',1),event('READY',2),event('EXCEL_START',3),reading.slice(0,31),reading.slice(31),event('QUERY_COMPLETE',11),event('CLEANUP',12),event('COMPLETE',13)]});
  const result=await h.run();assert.equal(result.report.status,'PERIOD_READY');
  assert.deepEqual(h.progress,[{phase:'starting',completedTags:0},{phase:'reading',completedTags:0},{phase:'reading',completedTags:10},{phase:'cleanup',completedTags:10},{phase:'uploading',completedTags:10}]);
});
test('malformed, foreign and backwards progress events cannot falsify the active stage',async t=>{
  const h=harness(t,{chunks:[event('WORKER_ENTERED',0),event('QUERY_START',10),event('QUERY_COMPLETE',11,{schemaVersion:2}),event('QUERY_COMPLETE',11,{runId:'f'.repeat(32)}),event('QUERY_COMPLETE',11,{elapsedSeconds:'11'}),event('QUERY_COMPLETE',11,{atUtc:'not a date'}),event('QUERY_COMPLETE',11,{elapsedSeconds:-1}),event('QUERY_COMPLETE',11,{extra:'x'.repeat(2100)}),'__COFIRING_PROGRESS__{broken}\n','prefix '+event('QUERY_COMPLETE',11),event('READY',11),event('QUERY_COMPLETE',9),event('CLEANUP',12),event('QUERY_COMPLETE',13),event('COMPLETE',14)],result:report({status:'FAIL',executionSucceeded:false,workerExitCode:1}),code:1});
  await assert.rejects(h.run(),/프로세스 종료 오류/);
  assert.deepEqual(h.progress,[{phase:'starting',completedTags:0},{phase:'reading',completedTags:0},{phase:'cleanup',completedTags:0}]);
  assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),false);
});
test('a UTC clock correction does not freeze valid monotonic worker progress',async t=>{
  const h=harness(t,{chunks:[event('WORKER_ENTERED',0),event('QUERY_START',10),event('QUERY_COMPLETE',11,{atUtc:'2026-09-10T03:00:00Z'}),event('CLEANUP',12,{atUtc:'2026-09-10T03:00:01Z'})]});
  await h.run();assert.deepEqual(h.progress,[{phase:'starting',completedTags:0},{phase:'reading',completedTags:0},{phase:'reading',completedTags:10},{phase:'cleanup',completedTags:10},{phase:'uploading',completedTags:10}]);
});
test('COMPLETE stdout alone never marks ten tags complete or announces result upload',async t=>{
  const h=harness(t,{chunks:[event('WORKER_ENTERED',0),event('COMPLETE',1)],result:report({summaries:[]})});
  await assert.rejects(h.run(),/10개 TAG/);
  assert.deepEqual(h.progress,[{phase:'starting',completedTags:0},{phase:'cleanup',completedTags:0}]);
});
test('a failed process with unverified cleanup writes only its configured run-root marker',async t=>{
  const h=harness(t,{result:report({status:'FAIL',executionSucceeded:false,cleanupVerified:false,processCleanupVerified:false,workerExitCode:1}),code:1});
  await assert.rejects(h.run(),/프로세스 종료 오류/);
  const marker=JSON.parse(fs.readFileSync(path.join(h.root,'cleanup-blocked.json'),'utf8'));
  assert.equal(marker.requestId,id);assert.ok(marker.diagnosticDirectory.startsWith(h.root+path.sep));
});
test('a configured cleanup marker prevents launch without affecting a different run root',async t=>{
  const blocked=harness(t),clear=harness(t);fs.writeFileSync(path.join(blocked.root,'cleanup-blocked.json'),'{}');
  await assert.rejects(blocked.run(),/정리가 확인되지/);assert.equal(blocked.calls,0);
  await clear.run();assert.equal(clear.calls,1);assert.equal(fs.readFileSync(path.join(blocked.root,'cleanup-blocked.json'),'utf8'),'{}');
});
test('period launch requires enough valid lease time for startup, query and cleanup',async t=>{
  const h=harness(t);
  for(const expiresAt of [new Date(Date.now()+7*60000).toISOString(),'invalid',null])await assert.rejects(h.run({expiresAt}),/남은 처리시간/);
  assert.equal(h.calls,0);await h.run();assert.equal(h.calls,1);
});
test('a progress delivery outage does not discard a validated calculation result',async t=>{
  const h=harness(t,{chunks:[event('QUERY_START',1),event('QUERY_COMPLETE',2),event('CLEANUP',3)],progressError:true});
  assert.equal((await h.run()).report.status,'PERIOD_READY');assert.ok(h.logs.some(line=>line.includes('진행상태 전송 보류')));
});
test('terminal failure waits for in-flight progress so stale processing cannot follow the caller failure update',async t=>{
  let release,settled=false;
  const h=harness(t,{chunks:[event('QUERY_START',1),event('CLEANUP',2)],result:report({status:'FAIL',executionSucceeded:false,workerExitCode:1}),code:1,onProgress:value=>value.phase==='reading'?new Promise(resolve=>{release=resolve;}):undefined});
  const outcome=h.run().then(()=>{throw new Error('failure was expected');},error=>{settled=true;return error;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');assert.equal(settled,false);
  release();assert.match((await outcome).message,/프로세스 종료 오류/);assert.deepEqual(h.progress.at(-1),{phase:'cleanup',completedTags:0});
});
test('the error boundary stops producing progress before draining existing callbacks',async t=>{
  let release;
  const h=harness(t,{chunks:[event('QUERY_START',1)],errorInsteadOfClose:true,result:report({status:'FAIL',executionSucceeded:false,workerExitCode:1}),onProgress:value=>value.phase==='reading'?new Promise(resolve=>{release=resolve;}):undefined});
  const outcome=h.run().then(()=>{throw new Error('failure was expected');},error=>error);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');
  h.child.stdout.write(event('QUERY_COMPLETE',2));h.child.stdout.write(event('CLEANUP',3));
  release();assert.match((await outcome).message,/synthetic child stream failure/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.progress,[{phase:'starting',completedTags:0},{phase:'reading',completedTags:0}]);
  h.child.stdout.end();h.child.stderr.end();h.child.emit('close',1,null);
});
test('verified timeout categories explain the failed stage without exposing raw controller exceptions',async t=>{
  for(const [controllerFailureCode,label]of Object.entries({STARTUP_TIMEOUT:'조회 환경 준비 제한시간',EXECUTION_TIMEOUT:'조회 실행 제한시간',OVERALL_TIMEOUT:'작업 프로그램의 시작·조회 제한시간'})){
    const h=harness(t,{chunks:[event('WORKER_ENTERED',0)],result:report({status:'FAIL',executionSucceeded:false,timedOut:true,workerExitCode:1,controllerFailureCode,controllerFailure:'synthetic private exception C:\\private\\do-not-display'}),code:1});
    await assert.rejects(h.run(),error=>{assert.ok(error.message.includes(label));assert.match(error.message,/정리는 확인됐습니다/);assert.doesNotMatch(error.message,/private|do-not-display/);return true;});
  }
});
test('a cleanup-certified timeout without an observed run ID remains blocked and never claims cleanup assurance',async t=>{
  const h=harness(t,{chunks:[],result:report({status:'FAIL',executionSucceeded:false,timedOut:true,workerExitCode:1,controllerFailureCode:'STARTUP_TIMEOUT'}),code:1});
  await assert.rejects(h.run(),error=>{assert.match(error.message,/프로세스 종료 오류/);assert.doesNotMatch(error.message,/정리는 확인됐습니다/);return true;});
  assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),true);
});
test('foreign, unmatched and cleanup-unverified reports cannot add trusted timeout explanations',async t=>{
  for(const overrides of [{runId:'f'.repeat(32)},{kind:'other_report'},{startLocal:'2026-09-09T00:00'},{queryEndLocal:'2026-09-10T12:02'},{cleanupVerified:false},{processCleanupVerified:false},{cleanupErrors:['unverified']},{timedOut:false},{controllerFailureCode:'toString'},{controllerFailureCode:null,controllerFailure:'arbitrary timeout details'}]){
    const h=harness(t,{chunks:[event('WORKER_ENTERED',0)],result:report({status:'FAIL',executionSucceeded:false,timedOut:true,workerExitCode:1,controllerFailureCode:'STARTUP_TIMEOUT',...overrides}),code:1});
    await assert.rejects(h.run(),error=>{assert.match(error.message,/프로세스 종료 오류/);assert.doesNotMatch(error.message,/정리는 확인됐습니다|arbitrary timeout details/);return true;});
  }
});
test('the compact UI distinguishes preparation, calculation, cleanup and upload without promising completion',()=>{
  for(const [phase,label]of Object.entries({starting:'조회 환경 준비 중',reading:'DataPARC 계산 중',cleanup:'조회용 Excel 정리 중',uploading:'결과 저장 중'})){
    const value=liveRequestPresentation({authenticated:true,item:{active:{status:'processing',progress:{phase,completedTags:10}},loading:true}});
    assert.equal(value.progressLabel,label);assert.equal(value.buttonText,'상태 확인');assert.equal(value.busy,true);
    assert.match(value.progressMessage,/아직 계산 완료가 아닙니다/);assert.match(value.progressMessage,/서버에 저장 결과가 도착하면/);
  }
});
test('unknown progress and pending requests keep neutral labels instead of trusting arbitrary phase text',()=>{
  for(const phase of ['completed','toString','__proto__',undefined]){
    const value=liveRequestPresentation({authenticated:true,item:{active:{status:'processing',progress:{phase}}}});
    assert.equal(value.progressLabel,'DataPARC 작업 중');assert.match(value.progressMessage,/아직 계산 완료가 아닙니다/);
  }
  const pending=liveRequestPresentation({authenticated:true,item:{active:{status:'pending',progress:{phase:'reading'}}}});
  assert.equal(pending.progressLabel,'');assert.equal(pending.progressMessage,'');
});
test('terminal failure stops polling and retains the previous saved calculation instead of repeating progress',async()=>{
  let failed=false,calls=0;const timers=new Map();let sequence=0;
  const saved={id:savedId,requestType:'cofiring_period',status:'complete'},prior={kind:'cofiring_period_live_result',schemaVersion:1,requestId:savedId,request:spec,report:report()};
  const live=createPeriod({getHeaders:()=>({Authorization:'Bearer synthetic-test'}),canQuery:()=>true,isVisible:()=>true,setTimeout:(fn,ms)=>{const key=++sequence;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key),fetch:async(_url,options)=>{
    calls++;assert.equal(options.method,undefined);
    const attempt={id,requestType:'cofiring_period',status:failed?'failed':'processing',progress:{phase:'starting',completedTags:0},errorMessage:failed?'조회 환경 준비 제한시간을 초과했습니다.':''};
    return {ok:true,json:async()=>({ok:true,bridgeVersion:2,periodKey:contract.periodKey(spec),saved,result:calls===1?prior:null,active:failed?null:attempt,lastAttempt:attempt})};
  }});
  live.select(spec);assert.equal(await live.load(),true);const previous=live.state().item.result;
  assert.equal(liveRequestPresentation(live.state()).progressLabel,'조회 환경 준비 중');assert.equal(timers.size,1);
  failed=true;assert.equal(await live.load(),true);const state=live.state(),value=liveRequestPresentation(state);
  assert.equal(state.item.active,null);assert.equal(state.item.result,previous);assert.equal(state.item.saved.id,savedId);assert.equal(value.failureMessage,'조회 환경 준비 제한시간을 초과했습니다.');assert.equal(value.progressLabel,'');assert.equal(value.progressMessage,'');assert.equal(value.buttonText,'계산하기');assert.equal(timers.size,0);assert.equal(calls,2);live.dispose();
});
