'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const contract=require('../maintenance/cofiring-live-contract.js');
const {createPeriod}=require('../maintenance/cofiring-live.js');
const ID='11111111-1111-4111-8111-111111111111',OLD='22222222-2222-4222-8222-222222222222';
const SPEC={startLocal:'2026-09-14T00:00',endLocal:'2026-09-15T00:00',stepUnit:'minute',stepValue:1};
const OTHER={...SPEC,startLocal:'2026-09-13T00:00',endLocal:'2026-09-14T00:00'};
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function flush(){for(let i=0;i<15;i++)await Promise.resolve();}
function row(status='pending',id=ID,spec=SPEC){return {id,requestType:'cofiring_period',targetDate:spec.startLocal.slice(0,10),status,result:contract.periodEnvelope(spec)};}
function result(id=ID,spec=SPEC){
  const p=contract.period(spec);
  const summaries=contract.definitions.map(d=>({key:d.id,unit:d.unit,fuel:d.fuel,tag:d.queryTag,startValue:100,endValue:112,min:100,max:112,delta:12,usageTon:12,startQuality:'Good',endQuality:'Good',startTime:spec.startLocal+':00+09:00',endTime:spec.endLocal+':00+09:00',durationGoodSeconds:p.durationMinutes*60,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}));
  return {kind:'cofiring_period_live_result',schemaVersion:1,requestId:id,request:spec,report:{kind:'cofiring_dataparc_period_report',schemaVersion:1,status:'PERIOD_READY',executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],runId:'a'.repeat(32),...spec,queryEndLocal:p.queryEndLocal,summaries,completedAtUtc:'2026-09-15T01:00:00Z'}};
}
function status(item=row()){return {ok:true,requestedIds:[ID],missingIds:[],items:[item]};}
function full({active=row(),saved=null,lastAttempt=active,spec=SPEC,value=null}={}){return {ok:true,bridgeVersion:2,periodKey:contract.periodKey(spec),saved,active,lastAttempt,result:value};}
function completed(id=ID,spec=SPEC){const item=row('complete',id,spec);item.result=result(id,spec);return item;}
function completedFull(id=ID,spec=SPEC){return full({active:null,saved:row('complete',id,spec),lastAttempt:row('complete',id,spec),spec,value:result(id,spec)});}
function harness(){
  const h={auth:'Bearer original',visible:true,timers:new Map(),calls:[],status:[],full:[],posts:[],results:[],changes:[]};let serial=0;
  h.live=createPeriod({getHeaders:()=>({Authorization:h.auth}),canQuery:()=>true,isVisible:()=>h.visible,makeId:()=>ID,
    setTimeout:(f,ms)=>{const id=++serial;h.timers.set(id,{f,ms});return id;},clearTimeout:id=>h.timers.delete(id),
    onChange:s=>h.changes.push(s.item?.error||''),onResult:(r,s)=>h.results.push({r,s}),
    fetch:async(url,init={})=>{
      const action=new URL(url,'https://example.invalid').searchParams.get('action'),method=init.method||'GET';h.calls.push({url,action,method,init});
      let response;if(method==='POST')response=h.posts.shift()||{ok:true,periodKey:contract.periodKey(SPEC),item:row()};
      else if(action==='status_batch')response=h.status.shift()||status();
      else response=h.full.shift()||full();
      response=await response;if(response instanceof Error)throw response;
      if(response?.httpStatus)return {ok:false,status:response.httpStatus,json:async()=>{if(response.badJson)throw Error('bad JSON');return response.body;}};
      return {ok:true,status:200,json:async()=>response};
    }});
  h.live.select(SPEC);
  h.start=()=>h.live.query({explicit:true});
  h.polls=()=>[...h.timers.values()].filter(t=>t.ms===1000||t.ms===2000);
  h.tick=async()=>{const entry=[...h.timers].find(([,t])=>t.ms===1000||t.ms===2000);assert.ok(entry,'status poll scheduled');h.timers.delete(entry[0]);await entry[1].f();};
  h.count=action=>h.calls.filter(c=>c.action===action).length;
  return h;
}

test('pending and processing use exact-ID status reads, preserving progress without full range scans',async()=>{
  const h=harness();await h.start();assert.equal(h.count('cofiring_period'),1);
  h.status.push(status());await h.tick();
  const item=row('processing');item.result={kind:'cofiring_period_progress',schemaVersion:1,request:contract.periodEnvelope(SPEC),phase:'reading',completedTags:6,updatedAt:'2026-09-15T00:00:00Z'};
  h.status.push(status(item));await h.tick();assert.equal(h.count('cofiring_period'),1);assert.equal(h.count('status_batch'),2);
  assert.equal(h.live.state().item.active.progress.completedTags,6);assert.equal(h.results.length,0);
  for(const call of h.calls.filter(c=>c.action==='status_batch')){const u=new URL(call.url,'https://example.invalid');assert.equal(u.searchParams.get('ids'),ID);assert.equal(u.searchParams.has('compact'),false);assert.equal(call.method,'GET');assert.equal(call.init.cache,'no-store');}
  assert.equal(h.calls.filter(c=>c.method==='POST').length,1);h.live.dispose();
});

test('exact completion makes one final authoritative read and waits for its validated result',async()=>{
  const h=harness();await h.start();const gate=deferred();h.status.push(status(completed()));h.full.push(gate.promise);
  const tick=h.tick();await flush();assert.equal(h.count('cofiring_period'),2);assert.equal(h.results.length,0);
  gate.resolve(completedFull());await tick;assert.equal(h.results.length,1);assert.equal(h.results[0].r.requestId,ID);assert.equal(h.results[0].r.report.reference.summaries.length,10);
  assert.equal(h.live.state().item.active,null);assert.equal(h.polls().length,0);h.live.dispose();
});

test('missing, mismatched, malformed or foreign status responses stop after three attempts without completing',async()=>{
  const cases=[
    {ok:true,requestedIds:[ID],missingIds:[ID],items:[]},
    status(row('complete',OLD)),
    status({...row(),requestType:'blower_runtime_probe'}),
    status({...row(),targetDate:'2026-09-13'}),
    status({...row(),status:'unknown'}),
    status({...row(),result:contract.periodEnvelope({...SPEC,endLocal:'2026-09-14T13:00'})}),
    {...status(),requestedIds:[OLD]},
    {...status(),items:[row(),row()]},
    status({...completed(),result:result(OLD)}),
    status({...row('processing'),result:{kind:'cofiring_period_progress',schemaVersion:1,request:SPEC,phase:'reading',completedTags:11}})
  ];
  for(const malformed of cases){const h=harness();await h.start();h.status.push(malformed,malformed,malformed);await h.tick();await h.tick();await h.tick();assert.equal(h.results.length,0);assert.equal(h.count('cofiring_period'),1);assert.equal(h.count('status_batch'),3);assert.equal(h.live.state().item.active.id,ID);assert.equal(h.live.state().item.statusStopped,true);assert.equal(h.polls().length,0);assert.match(h.live.state().item.error,/자동 확인을 멈췄습니다/);h.live.dispose();}
});

test('network failures have bounded retries and never create a replacement request',async()=>{
  const h=harness();await h.start();h.status.push(Error('offline'),Error('offline'),Error('offline'));await h.tick();await h.tick();await h.tick();
  assert.equal(h.count('status_batch'),3);assert.equal(h.polls().length,0);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.results.length,0);h.live.dispose();
});

test('temporary status failure recovers and explicit load remains a full range read',async()=>{
  const h=harness();await h.start();h.status.push(Error('temporary'));await h.tick();assert.equal(h.live.state().item.statusFailures,1);
  await h.tick();assert.equal(h.live.state().item.statusFailures,0);assert.equal(h.live.state().item.error,'');assert.equal(h.count('cofiring_period'),1);
  await h.live.load({force:true});assert.equal(h.count('cofiring_period'),2);h.live.dispose();
});

test('401 stops polling even with a non-JSON response and same credentials cannot restart it',async()=>{
  const h=harness();await h.start();h.status.push({httpStatus:401,badJson:true});await h.tick();
  assert.equal(h.live.state().authenticated,false);assert.equal(h.live.state().item.active,null);assert.equal(h.polls().length,0);
  const calls=h.calls.length;await h.live.load({force:true});await h.live.query({explicit:true});assert.equal(h.calls.length,calls);
  h.auth='Bearer replacement';await h.live.load({force:true});assert.equal(h.live.state().authenticated,true);h.live.dispose();
});

test('period changes discard delayed status results and cannot trigger a final read for the old request',async()=>{
  const h=harness();await h.start();const gate=deferred();h.status.push(gate.promise);const tick=h.tick();await flush();h.live.select(OTHER);gate.resolve(status(completed()));await tick;
  assert.equal(h.results.length,0);assert.equal(h.count('cofiring_period'),1);assert.equal(h.polls().length,0);assert.equal(h.live.state().item.active,null);h.live.dispose();
});

test('authentication changes discard delayed status results and all old-session timers',async()=>{
  const h=harness();await h.start();const gate=deferred();h.status.push(gate.promise);const tick=h.tick();await flush();h.auth='Bearer replacement';h.live.state();gate.resolve(status(completed()));await tick;
  assert.equal(h.results.length,0);assert.equal(h.count('cofiring_period'),1);assert.equal(h.polls().length,0);h.live.dispose();
});

test('stale saved completion returned by the final range read is rejected without success',async()=>{
  const h=harness();await h.start();h.status.push(status(completed()));h.full.push(completedFull(OLD));await h.tick();
  assert.equal(h.results.length,0);assert.equal(h.count('cofiring_period'),2);assert.equal(h.live.state().item.active.id,ID);assert.equal(h.live.state().item.statusStopped,true);assert.equal(h.polls().length,0);h.live.dispose();
});

test('failed terminal status preserves prior saved data and never emits it as new success',async()=>{
  const h=harness();h.full.push(full({saved:row('complete',OLD),value:result(OLD)}));await h.start();assert.equal(h.results.length,1);
  h.status.push(status(row('failed')));h.full.push(full({active:null,lastAttempt:row('failed'),saved:row('complete',OLD),value:null}));await h.tick();
  assert.equal(h.results.length,1);assert.equal(h.live.state().item.saved.id,OLD);assert.equal(h.live.state().item.lastAttempt.status,'failed');assert.equal(h.live.state().item.active,null);assert.equal(h.polls().length,0);h.live.dispose();
});

test('final read network error or invalid actual report stops after one attempt and can be manually recovered',async()=>{
  for(const failure of [Error('final offline'),{...completedFull(),result:{...result(),report:{...result().report,cleanupVerified:false}}}]){
    const h=harness();await h.start();h.status.push(status(completed()));h.full.push(failure);await h.tick();
    assert.equal(h.results.length,0);assert.equal(h.count('cofiring_period'),2);assert.equal(h.polls().length,0);assert.equal(h.live.state().item.active.id,ID);
    h.full.push(completedFull());await h.live.load({force:true});assert.equal(h.results.length,1);assert.equal(h.live.state().item.active,null);h.live.dispose();
  }
});

test('double submit and a full-load attempt during a status request do not duplicate network work',async()=>{
  const h=harness();await h.start();const gate=deferred();h.status.push(gate.promise);const tick=h.tick();await flush();
  const load=h.live.load({force:true});await h.live.query({explicit:true,force:true});assert.equal(h.count('cofiring_period'),1);assert.equal(h.count('status_batch'),1);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
  gate.resolve(status());await Promise.all([tick,load]);assert.equal(h.polls().length,1);h.live.dispose();
});

test('pause and dispose prevent delayed polls from scheduling further work',async()=>{
  for(const operation of ['pause','dispose'])for(const response of [status(),status(completed())]){const h=harness();await h.start();const gate=deferred();h.status.push(gate.promise);const tick=h.tick();await flush();h.live[operation]();gate.resolve(response);await tick;assert.equal(h.polls().length,0);assert.equal(h.results.length,0);assert.equal(h.count('cofiring_period'),1);h.live.dispose();}
});

test('healthy but never-ending pending responses reach a bounded polling limit',async()=>{
  const h=harness();await h.start();for(let i=0;i<901;i++)await h.tick();assert.equal(h.count('status_batch'),900);assert.equal(h.live.state().item.statusStopped,true);assert.equal(h.polls().length,0);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);h.live.dispose();
});
