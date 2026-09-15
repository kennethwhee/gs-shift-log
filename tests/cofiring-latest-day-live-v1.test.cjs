'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const contract=require('../maintenance/cofiring-live-contract.js');
const {createPeriod}=require('../maintenance/cofiring-live.js');
const DATE='2026-09-16',ID='11111111-1111-4111-8111-111111111111',OTHER_ID='22222222-2222-4222-8222-222222222222';
const SAVED={startLocal:DATE+'T00:00',endLocal:DATE+'T03:08',stepUnit:'minute',stepValue:1};
const CURRENT={...SAVED,endLocal:DATE+'T03:13'};
const NOW=Date.parse(DATE+'T03:14:00+09:00');
const clone=v=>JSON.parse(JSON.stringify(v));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function result(spec=SAVED,id=ID){
  const p=contract.period(spec,Number.MAX_SAFE_INTEGER);
  const summaries=contract.definitions.map(d=>({key:d.id,unit:d.unit,fuel:d.fuel,tag:d.queryTag,startValue:100,endValue:112,min:100,max:112,delta:12,usageTon:12,startQuality:'Good',endQuality:'Good',startTime:spec.startLocal+':00+09:00',endTime:spec.endLocal+':00+09:00',durationGoodSeconds:p.durationMinutes*60,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}));
  return {kind:'cofiring_period_live_result',schemaVersion:1,requestId:id,request:spec,report:{kind:'cofiring_dataparc_period_report',schemaVersion:1,status:'PERIOD_READY',executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],runId:'a'.repeat(32),...spec,queryEndLocal:p.queryEndLocal,summaries,completedAtUtc:'2026-09-15T18:09:00Z'}};
}
function latest(spec=SAVED,id=ID){return {ok:true,bridgeVersion:2,targetDate:DATE,periodKey:contract.periodKey(spec),period:{start:spec.startLocal,end:spec.endLocal,stepUnit:spec.stepUnit,stepValue:spec.stepValue},saved:{id,requestType:'cofiring_period',status:'complete',targetDate:DATE,request:spec},result:result(spec,id)};}
function none(){return {ok:true,bridgeVersion:2,targetDate:DATE,periodKey:null,period:null,saved:null,result:null};}
function harness(){
  const h={auth:'Bearer original',now:NOW,calls:[],responses:[],results:[],timers:new Map()};let serial=0;
  h.live=createPeriod({getHeaders:()=>({Authorization:h.auth}),now:()=>h.now,canQuery:()=>true,isVisible:()=>true,
    setTimeout:(f,ms)=>{const id=++serial;h.timers.set(id,{f,ms});return id;},clearTimeout:id=>h.timers.delete(id),onResult:(r,s)=>h.results.push({r,s}),
    fetch:async(url,init={})=>{
      h.calls.push({url,init});const data=await (h.responses.shift()||none());
      if(data instanceof Error)throw data;
      return {ok:!data.httpStatus,status:data.httpStatus||200,json:async()=>{if(data.badJson)throw Error('bad JSON');return data.body||data;}};
    }});
  h.live.select(CURRENT);return h;
}

test('latest daily read restores a validated detached snapshot without selecting, emitting or submitting',async()=>{
  const h=harness(),response=latest(),before=clone(h.live.state());h.responses.push(response);
  const snapshot=await h.live.readLatestDaily(DATE);
  assert.deepEqual(snapshot.period,SAVED);assert.equal(snapshot.saved.id,ID);assert.equal(snapshot.result.report.reference.summaries.length,10);
  assert.deepEqual(h.live.state(),before);assert.equal(h.results.length,0);assert.equal(h.calls.length,1);
  const call=h.calls[0],url=new URL(call.url,'https://example.invalid');
  assert.equal(url.searchParams.get('action'),'cofiring_period_latest');assert.equal(url.searchParams.get('targetDate'),DATE);
  assert.equal(call.init.method||'GET','GET');assert.equal(call.init.cache,'no-store');assert.equal(call.init.headers.Authorization,'Bearer original');
  snapshot.result.report.summaries[0].usageTon=999;assert.equal(response.result.report.summaries[0].usageTon,12);
  snapshot.saved.request.endLocal='changed';assert.equal(response.saved.request.endLocal,SAVED.endLocal);
  h.live.dispose();
});

test('concurrent lookups share one request, then an explicit later lookup reads the server again',async()=>{
  const h=harness(),gate=deferred();h.responses.push(gate.promise);
  const a=h.live.readLatestDaily(DATE),b=h.live.readLatestDaily(DATE);assert.equal(h.calls.length,1);
  gate.resolve(latest());const values=await Promise.all([a,b]);assert.equal(values[0].saved.id,ID);assert.equal(values[1].saved.id,ID);
  h.responses.push(none());assert.equal(await h.live.readLatestDaily(DATE),null);assert.equal(h.calls.length,2);h.live.dispose();
});

test('no saved result requires the complete explicit empty envelope',async()=>{
  const h=harness();h.responses.push(none());assert.equal(await h.live.readLatestDaily(DATE),null);
  for(const data of [{...none(),periodKey:''},{...none(),result:latest().result},{...none(),saved:latest().saved},{...none(),bridgeVersion:1},{...none(),targetDate:'2026-09-15'}]){
    h.responses.push(data);await assert.rejects(h.live.readLatestDaily(DATE));
  }
  assert.equal(h.live.state().item.result,null);h.live.dispose();
});

test('foreign, partial, future or malformed latest results are rejected without adopting any values',async()=>{
  const cases=[
    x=>{x.saved.id='not-an-id';},x=>{x.saved.requestType='blower_runtime_probe';},x=>{x.saved.status='pending';},x=>{x.saved.targetDate='2026-09-15';},
    x=>{x.saved.request={...SAVED,endLocal:DATE+'T03:07'};},x=>{delete x.saved.request;},x=>{x.result.requestId=OTHER_ID;},
    x=>{x.result.report.cleanupVerified=false;},x=>{x.result.report.summaries[0].usageTon=999;},x=>{x.result.request={...SAVED,endLocal:DATE+'T03:07'};},
    x=>{x.periodKey='foreign';},x=>{x.period.start='2026-09-15T00:00';},x=>{x.period.start=DATE+'T01:00';},x=>{x.period.end='2026-09-17T00:01';},
    x=>{x.period.end=DATE+'T03:14';},x=>{x.period.stepUnit='hour';},x=>{x.period.stepValue='1';},x=>{x.period.stepValue=2;},
    x=>{x.result=null;},x=>{x.period.end='2026-09-31T00:00';}
  ];
  for(const mutate of cases){const h=harness(),data=latest(),before=clone(h.live.state());mutate(data);h.responses.push(data);await assert.rejects(h.live.readLatestDaily(DATE));assert.deepEqual(h.live.state(),before);assert.equal(h.results.length,0);assert.equal(h.calls.length,1);h.live.dispose();}
});

test('latest result query boundary must be complete to the millisecond, including full-day midnight',async()=>{
  const h=harness();h.now=Date.parse(DATE+'T03:09:00+09:00')-1;h.responses.push(latest());await assert.rejects(h.live.readLatestDaily(DATE),/완료된 누적/);
  h.now++;h.responses.push(latest());assert.equal((await h.live.readLatestDaily(DATE)).period.endLocal,SAVED.endLocal);
  const full={...SAVED,endLocal:'2026-09-17T00:00'};h.now=Date.parse('2026-09-17T00:01:00+09:00')-1;h.responses.push(latest(full));await assert.rejects(h.live.readLatestDaily(DATE),/완료된 누적/);
  h.now++;h.responses.push(latest(full));assert.equal((await h.live.readLatestDaily(DATE)).period.endLocal,full.endLocal);h.live.dispose();
});

test('selection, authentication, pause and disposal discard delayed success or failure',async()=>{
  for(const operation of ['select','auth','pause','dispose'])for(const response of [latest(),Error('offline'),{httpStatus:401,badJson:true}]){
    const h=harness(),gate=deferred();h.responses.push(gate.promise);const pending=h.live.readLatestDaily(DATE);
    if(operation==='select')h.live.select({...CURRENT,endLocal:DATE+'T03:12'});
    else if(operation==='auth'){h.auth='Bearer replacement';h.live.state();}
    else h.live[operation]();
    gate.resolve(response);assert.equal(await pending,null);assert.equal(h.results.length,0);assert.equal(h.calls.length,1);
    if(operation==='auth')assert.equal(h.live.state().authenticated,true);h.live.dispose();
  }
});

test('a stale 401 cannot clear replacement-session results or its ongoing latest lookup',async()=>{
  const h=harness(),oldGate=deferred(),newGate=deferred();h.responses.push(oldGate.promise);const old=h.live.readLatestDaily(DATE);
  h.auth='Bearer replacement';h.responses.push(newGate.promise);const fresh=h.live.readLatestDaily(DATE);
  oldGate.resolve({httpStatus:401,badJson:true});assert.equal(await old,null);assert.equal(h.live.state().authenticated,true);
  const duplicate=h.live.readLatestDaily(DATE);assert.equal(h.calls.length,2);newGate.resolve(latest());assert.equal((await fresh).saved.id,ID);assert.equal((await duplicate).saved.id,ID);h.live.dispose();
});

test('current-session expiry disables further network work until credentials change',async()=>{
  const h=harness();h.responses.push({httpStatus:401,badJson:true});await assert.rejects(h.live.readLatestDaily(DATE),/세션이 만료/);
  assert.equal(h.live.state().authenticated,false);await assert.rejects(h.live.readLatestDaily(DATE),/로그인/);assert.equal(await h.live.load(),false);assert.equal(h.calls.length,1);
  h.auth='Bearer replacement';h.responses.push(latest());assert.equal((await h.live.readLatestDaily(DATE)).saved.id,ID);assert.equal(h.live.state().authenticated,true);h.live.dispose();
});

test('network, JSON, service and timeout failures remain visible and retryable without creating a query',async()=>{
  const h=harness(),timeout=new Error('aborted');timeout.name='AbortError';
  for(const response of [Error('offline'),{badJson:true},{httpStatus:503,body:{ok:false,message:'검색 한도에 도달했습니다.'}},timeout]){
    h.responses.push(response);await assert.rejects(h.live.readLatestDaily(DATE));
    h.responses.push(latest());assert.equal((await h.live.readLatestDaily(DATE)).saved.id,ID);
  }
  assert.ok(h.calls.every(c=>(c.init.method||'GET')==='GET'));assert.equal(h.live.state().item.result,null);h.live.dispose();
});

test('invalid dates or missing authentication issue no request and disposed readers remain inert',async()=>{
  const h=harness();for(const date of ['2026-09-31','invalid','2026-09-16T00:00'])await assert.rejects(h.live.readLatestDaily(date));
  h.auth='';await assert.rejects(h.live.readLatestDaily(DATE),/로그인/);assert.equal(h.calls.length,0);h.live.dispose();assert.equal(await h.live.readLatestDaily(DATE),null);
});

test('adopting a discovered cutoff still requires the authoritative exact-period load before rendering',async()=>{
  const h=harness();h.responses.push(latest());const snapshot=await h.live.readLatestDaily(DATE);assert.equal(h.results.length,0);
  h.live.select(snapshot.period);assert.equal(h.live.state().item.result,null);
  h.responses.push({ok:true,bridgeVersion:2,periodKey:contract.periodKey(SAVED),saved:snapshot.saved,result:snapshot.result,active:null,lastAttempt:snapshot.saved});
  assert.equal(await h.live.load(),true);assert.equal(h.live.state().item.saved.id,ID);assert.equal(h.results.length,1);assert.equal(h.calls.length,2);assert.equal(h.calls[1].init.method||'GET','GET');h.live.dispose();
});
