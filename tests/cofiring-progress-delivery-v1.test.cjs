'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const agent=require('../local-tools/ois-agent/cofiring-dataparc-agent.js');
const contract=require('../maintenance/cofiring-live-contract.js');
const id='11111111-1111-4111-8111-111111111111',runId='0123456789abcdef0123456789abcdef';
const spec={startLocal:'2021-09-10T00:00',endLocal:'2021-09-10T03:00',stepUnit:'minute',stepValue:1};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function report(overrides={}){
  const p=contract.period(spec),duration=p.durationMinutes*60;
  return {kind:'cofiring_dataparc_period_report',schemaVersion:1,status:'PERIOD_READY',runId,...spec,queryEndLocal:p.queryEndLocal,
    executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],completedAtUtc:'2021-09-10T04:02:00Z',
    summaries:contract.definitions.map((def,i)=>({key:def.id,unit:def.unit,fuel:def.fuel,tag:def.queryTag,startValue:100+i,endValue:120+i,min:100+i,max:120+i,delta:20,usageTon:20,startQuality:'Good',endQuality:'Good',startTime:spec.startLocal+':00+09:00',endTime:spec.endLocal+':00+09:00',durationGoodSeconds:duration,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true})),...overrides};
}
function failedReport(overrides={}){return report({status:'FAIL',executionSucceeded:false,workerExitCode:1,...overrides});}
function event(phase,elapsedSeconds,overrides={}){
  return '__COFIRING_PROGRESS__'+JSON.stringify({schemaVersion:1,runId,phase,atUtc:'2021-09-10T04:00:00Z',elapsedSeconds,...overrides})+'\n';
}
function harness(t,{postProgress,spawnError,pid=777,collectorOptions={}}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cofiring-progress-delivery-'));
  const posts=[],logs=[],children=[];let launches=0;
  t.after(()=>{for(const c of children)if(!c.closed){c.stdout.end();c.stderr.end();c.emit('close',1,null);}fs.rmSync(root,{recursive:true,force:true});});
  const collect=agent.createCofiringPeriodCollector({platform:'win32',runsDirectory:root,log:line=>logs.push(line),...collectorOptions,spawnProcess:(executable,args,options)=>{
    launches++;assert.match(executable,/WindowsPowerShell/);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);
    if(spawnError)throw spawnError;
    const child=new EventEmitter();child.pid=pid;child.stdout=new PassThrough();child.stderr=new PassThrough();child.dir=args[args.indexOf('-OutputDirectory')+1];
    child.once('close',()=>{child.closed=true;});children.push(child);return child;
  }});
  const request={id,requestType:'cofiring_period',status:'processing',agentId:'test-agent',startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+10*60000).toISOString(),result:contract.periodEnvelope(spec)};
  return {root,posts,logs,request,get launches(){return launches;},get child(){return children.at(-1);},
    run:(changes={},withProgress=true)=>collect({agentId:'test-agent'},{...request,...changes},withProgress?{postProgress:value=>{posts.push(value);return postProgress?.(value,posts.length);}}:{}),
    emit:(phase,elapsed,overrides)=>children.at(-1).stdout.write(event(phase,elapsed,overrides)),
    writeReport:value=>fs.writeFileSync(path.join(children.at(-1).dir,'period-report.json'),typeof value==='string'?value:JSON.stringify(value)),
    close(value=report(),code=0){const child=children.at(-1);if(value!==null)this.writeReport(value);child.stdout.end();child.stderr.end();child.emit('close',code,null);}
  };
}

test('slow progress keeps one active POST and delivers only the newest unsent stage',async t=>{
  const gate=deferred();let active=0,maximumActive=0;
  const h=harness(t,{postProgress:async(_value,count)=>{active++;maximumActive=Math.max(active,maximumActive);try{if(count===1)await gate.promise;}finally{active--;}}});
  const outcome=h.run();await turn();
  h.emit('WORKER_ENTERED',0);h.emit('QUERY_START',10);h.emit('QUERY_COMPLETE',11);h.emit('CLEANUP',12);
  assert.deepEqual(h.posts,[{phase:'starting',completedTags:0}]);
  gate.resolve();await turn();
  assert.deepEqual(h.posts,[{phase:'starting',completedTags:0},{phase:'cleanup',completedTags:10}]);assert.equal(maximumActive,1);
  h.close();assert.equal((await outcome).report.status,'PERIOD_READY');assert.equal(h.posts.length,2);
});

test('success discards unsent progress but waits for the actual active POST before terminal delivery',async t=>{
  const gate=deferred(),order=[];let settled=false;
  const h=harness(t,{postProgress:async value=>{order.push('post '+value.phase);if(value.phase==='reading')await gate.promise;order.push('ack '+value.phase);}});
  const outcome=h.run().then(value=>{settled=true;order.push('terminal complete');return value;});await turn();
  h.emit('WORKER_ENTERED',0);h.emit('QUERY_START',10);await turn();
  h.emit('QUERY_COMPLETE',11);h.emit('CLEANUP',12);h.close();await turn();
  assert.equal(settled,false);assert.deepEqual(h.posts,[{phase:'starting',completedTags:0},{phase:'reading',completedTags:0}]);
  gate.resolve();assert.equal((await outcome).report.status,'PERIOD_READY');await turn();
  assert.deepEqual(order,['post starting','ack starting','post reading','ack reading','terminal complete']);
  assert.ok(fs.existsSync(path.join(h.child.dir,'bridge-result.json')));assert.equal(h.posts.some(x=>x.phase==='uploading'),false);
});

test('terminal failure drains active progress and never sends queued cleanup after failure',async t=>{
  const gate=deferred(),order=[];let settled=false;
  const h=harness(t,{postProgress:async value=>{order.push('post '+value.phase);if(value.phase==='reading')await gate.promise;order.push('ack '+value.phase);}});
  const outcome=h.run().then(()=>assert.fail('expected failure'),error=>{settled=true;order.push('terminal fail');return error;});await turn();
  h.emit('WORKER_ENTERED',0);h.emit('QUERY_START',10);await turn();h.emit('CLEANUP',12);h.close(failedReport(),1);await turn();
  assert.equal(settled,false);gate.resolve();assert.match((await outcome).message,/프로세스 종료 오류/);await turn();
  assert.deepEqual(order,['post starting','ack starting','post reading','ack reading','terminal fail']);
  assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),false);
});

test('a child error immediately stops new stages while the in-flight POST is drained',async t=>{
  const gate=deferred();let settled=false;
  const h=harness(t,{postProgress:value=>value.phase==='reading'?gate.promise:undefined});
  const outcome=h.run().catch(error=>{settled=true;return error;});await turn();h.emit('WORKER_ENTERED',0);h.emit('QUERY_START',10);await turn();
  h.writeReport(failedReport());h.child.emit('error',new Error('synthetic stream error'));h.emit('QUERY_COMPLETE',11);h.emit('CLEANUP',12);await turn();
  assert.equal(settled,false);gate.resolve();assert.match((await outcome).message,/synthetic stream error/);await turn();
  assert.deepEqual(h.posts,[{phase:'starting',completedTags:0},{phase:'reading',completedTags:0}]);
});

test('synchronous launch failure drains the initial status and does not claim a cleanup block',async t=>{
  const h=harness(t,{spawnError:new Error('synthetic launch error')});
  await assert.rejects(h.run(),/synthetic launch error/);await turn();assert.deepEqual(h.posts,[{phase:'starting',completedTags:0}]);
  assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),false);
});

test('an error before a process PID is assigned drains progress without creating an owned-process block',async t=>{
  const gate=deferred();let settled=false;
  const h=harness(t,{pid:undefined,postProgress:()=>gate.promise});
  const outcome=h.run().catch(error=>{settled=true;return error;});await turn();h.child.pid=undefined;
  h.child.emit('error',new Error('synthetic spawn error'));await turn();assert.equal(settled,false);
  gate.resolve();assert.match((await outcome).message,/synthetic spawn error/);
  assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),false);assert.equal(h.posts.length,1);
});

test('progress delivery rejection does not discard a validated result or schedule retries after completion',async t=>{
  const h=harness(t,{postProgress:()=>Promise.reject(new Error('synthetic API timeout'))});const outcome=h.run();await turn();
  h.emit('WORKER_ENTERED',0);h.emit('QUERY_START',10);await turn();h.emit('QUERY_COMPLETE',11);h.close();
  const result=await outcome,count=h.posts.length;await turn();assert.equal(result.requestId,id);assert.equal(result.report.status,'PERIOD_READY');
  assert.ok(h.logs.some(x=>x.includes('진행상태 전송 보류')));assert.equal(h.posts.length,count);
});

test('collector works without a progress callback and still validates the report before returning',async t=>{
  const h=harness(t),outcome=h.run({},false);h.emit('WORKER_ENTERED',0);h.close();assert.equal((await outcome).report.status,'PERIOD_READY');assert.deepEqual(h.posts,[]);
});

test('malformed and foreign cleanup reports cannot release the owned-process block',async t=>{
  const cases=[
    ['malformed JSON','{broken'],['missing report',null],['foreign run',failedReport({runId:'f'.repeat(32)})],
    ['foreign period',failedReport({startLocal:'2021-09-09T00:00'})],['foreign kind',failedReport({kind:'other_report'})],
    ['unverified cleanup',failedReport({cleanupVerified:false})],['unverified process cleanup',failedReport({processCleanupVerified:false})],
    ['cleanup errors',failedReport({cleanupErrors:['process still running']})]
  ];
  for(const [label,value]of cases)await t.test(label,async t=>{
    const h=harness(t),outcome=h.run();await turn();h.emit('WORKER_ENTERED',0);h.close(value,1);
    await assert.rejects(outcome,/프로세스 종료 오류/);const marker=JSON.parse(fs.readFileSync(path.join(h.root,'cleanup-blocked.json'),'utf8'));
    assert.equal(marker.requestId,id);assert.deepEqual(marker.period,{startLocal:spec.startLocal,endLocal:spec.endLocal});
    await assert.rejects(h.run(),/정리가 확인되지/);assert.equal(h.launches,1);
  });
});

test('invalid successful reports never return a result and preserve unverified cleanup blocking',async t=>{
  const h=harness(t),outcome=h.run();await turn();h.emit('WORKER_ENTERED',0);h.close(report({processCleanupVerified:false}));
  await assert.rejects(outcome,/Excel 종료\/실행 확인/);assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),true);
  assert.equal(fs.existsSync(path.join(h.child.dir,'bridge-result.json')),false);
});

test('request ownership and lease checks still prevent a second or foreign launch',async t=>{
  const h=harness(t);
  for(const change of [{id:'invalid'},{agentId:'another-agent'},{status:'pending'},{expiresAt:new Date(Date.now()+7*60000).toISOString()}])await assert.rejects(h.run(change),/요청 소유권 또는 남은 처리시간/);
  assert.equal(h.launches,0);const outcome=h.run();await turn();await assert.rejects(h.run(),/정리가 확인되지/);assert.equal(h.launches,1);
  h.emit('WORKER_ENTERED',0);h.close();await outcome;
});

test('unaltered controller and worker hashes remain required before any process launches',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cofiring-progress-wrong-worker-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const workerPath=path.join(dir,'worker.ps1');fs.writeFileSync(workerPath,'this is not the verified worker');
  const h=harness(t,{collectorOptions:{workerPath}});await assert.rejects(h.run(),/PowerShell 파일이 없거나 변경/);assert.equal(h.launches,0);
  for(const [file,hash]of [['run-cofiring-period-v5.ps1',agent.PERIOD_CONTROLLER_SHA256],['cofiring-period-worker-v5.ps1',agent.PERIOD_WORKER_SHA256]]){
    const actual=fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/cofiring-period-v5',file));assert.equal(crypto.createHash('sha256').update(actual).digest('hex'),hash);
  }
});

test('undefined or null progress rejections and a failing warning logger remain non-fatal',async t=>{
  for(const reason of [undefined,null,'synthetic failure'])await t.test(String(reason),async t=>{
    const h=harness(t,{postProgress:()=>Promise.reject(reason),collectorOptions:{log:line=>{if(line.includes('진행상태 전송 보류'))throw new Error('synthetic logger failure');}}});
    const outcome=h.run();await turn();h.emit('WORKER_ENTERED',0);h.close();assert.equal((await outcome).report.status,'PERIOD_READY');
  });
});

test('a diagnostic write failure cannot escape the collector before active progress is drained',async t=>{
  const gate=deferred();let settled=false;
  const h=harness(t,{postProgress:()=>gate.promise}),outcome=h.run().catch(error=>{settled=true;return error;});await turn();
  fs.mkdirSync(path.join(h.root,'cleanup-blocked.json'));h.emit('WORKER_ENTERED',0);h.close(failedReport({cleanupVerified:false}),1);await turn();
  assert.equal(settled,false);gate.resolve();assert.equal((await outcome).code,'EISDIR');await turn();assert.equal(h.posts.length,1);
});

test('close before the initial POST is dispatched cancels that unsent status',async t=>{
  const h=harness(t),outcome=h.run();h.emit('WORKER_ENTERED',0);h.close();assert.equal((await outcome).report.status,'PERIOD_READY');assert.deepEqual(h.posts,[]);
});

test('malformed, foreign and backwards worker events cannot advance progress',async t=>{
  const h=harness(t),outcome=h.run();await turn();h.emit('WORKER_ENTERED',0);h.emit('QUERY_START',10);await turn();
  for(const override of [{runId:'f'.repeat(32)},{schemaVersion:2},{atUtc:'bad date'},{elapsedSeconds:9},{elapsedSeconds:'11'}])h.emit('QUERY_COMPLETE',11,override);
  h.child.stdout.write('__COFIRING_PROGRESS__{broken}\n');h.child.stdout.write('untrusted text '+event('QUERY_COMPLETE',11));h.emit('READY',12);await turn();
  assert.deepEqual(h.posts,[{phase:'starting',completedTags:0},{phase:'reading',completedTags:0}]);
  h.emit('QUERY_COMPLETE',13);await turn();assert.deepEqual(h.posts.at(-1),{phase:'reading',completedTags:10});
  h.emit('CLEANUP',14);await turn();assert.deepEqual(h.posts.at(-1),{phase:'cleanup',completedTags:10});h.close();await outcome;
});
