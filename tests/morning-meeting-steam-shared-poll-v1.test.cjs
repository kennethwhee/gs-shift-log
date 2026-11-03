'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const main=fs.readFileSync(path.join(ROOT,'script.js'),'utf8');
const begin=main.indexOf('(function installSharedOisStatusPollCoordinator()');
const end=main.indexOf('\n})();',begin);assert.ok(begin>=0&&end>begin);
const coordinator=main.slice(begin,end+7);
const provider=fs.readFileSync(path.join(ROOT,'maintenance/morning-meeting-steam-ois-probe-v1.js'),'utf8');
const DATE='2026-11-03',STEAM='steam-fixture';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function complete(overrides={}) {return{id:STEAM,requestType:'steam_status',targetDate:DATE,status:'complete',result:{sourceDate:DATE,targetDate:DATE,
 unitOneProduction:10,unitTwoProduction:20,totalProduction:30,steamSalesLowPressure:4,steamSalesHighPressure:6,steamSales:10},...overrides};}
function harness({fallback=false,readyAt=3000,itemPatch=null,sharedStub=null,history=[]}={}) {
 let clock=0,nextTimer=0,auth='Bearer fixture';const timers=new Map(),net=[],updates=[],events=[];
 const panel={dataset:{morningMeetingAutoBaseDate:DATE}},state={};
 const document={readyState:'loading',getElementById:id=>id==='efficiencyMorningMeetingWaterPanel'?panel:null,
  addEventListener(){},querySelectorAll:()=>[],dispatchEvent:event=>events.push(event)};
 const later=(fn,ms=0)=>{const id=++nextTimer;timers.set(id,{fn,at:clock+ms});return id;};
 const window={location:{origin:'https://fixture.invalid'},setTimeout:later,clearTimeout:id=>timers.delete(id),
  efficiencyMorningMeetingUploadState:state,getShiftLogAuthHeaders:()=>({Authorization:auth}),addEventListener(){}};
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const response=value=>({ok:true,status:200,text:async()=>JSON.stringify(value)});
 const fetch=async(raw,options={})=>{
  const url=new URL(raw,window.location.origin),body=options.body?JSON.parse(options.body):null;
  const request={method:options.method||'GET',action:url.searchParams.get('action'),id:url.searchParams.get('id'),ids:(url.searchParams.get('ids')||'').split(',').filter(Boolean),body,at:clock};net.push(request);
  if(body?.requestType==='steam_status')return response({ok:true,item:{id:STEAM,requestType:'steam_status',targetDate:DATE,status:'pending'}});
  if(request.action==='completed_history')return response({ok:true,items:history});
  const item=id=>id===STEAM?complete({status:clock>=readyAt?'complete':'processing',...(itemPatch||{})}):
   {id,requestType:'water_environment',targetDate:DATE,status:clock>=readyAt?'complete':'processing',result:{value:0}};
  if(request.action==='status_batch')return response({ok:true,items:request.ids.map(item),missingIds:[]});
  if(request.id)return response({ok:true,item:item(request.id)});
  throw Error('Unexpected fixture fetch');
 };
 window.fetch=fetch;
 const ctx=vm.createContext({window,document,fetch,URL,Date:FakeDate,Map,Set,Promise,Error,
  console:{log(){},info(){},warn(){},error(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},MutationObserver:class{observe(){}disconnect(){}}});
 vm.runInContext(coordinator,ctx,{filename:'actual-shared-poll.js'});const shared=window.waitForSharedOisRequestCompletion;
 if(fallback)delete window.waitForSharedOisRequestCompletion;
 if(sharedStub)window.waitForSharedOisRequestCompletion=sharedStub;
 vm.runInContext(provider,ctx,{filename:'actual-steam-provider.js'});
 async function settle(promise,maxTicks=600) {
  let done=false,out,error;promise.then(value=>{done=true;out=value;},reason=>{done=true;error=reason;});
  for(let i=0;i<maxTicks&&!done;i++){
   await flush();if(done)break;
   const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(next,'fixture has pending work without a timer');
   timers.delete(next[0]);clock=next[1].at;next[1].fn();
  }
  assert.ok(done,'fixture exceeded fake-clock bound');if(error)throw error;return out;
 }
 const steam=options=>window.loadEfficiencyMorningMeetingSteamOis({userInitiated:true,targetDate:DATE,ignoreSaved:true,silent:true,...options});
 return{window,document,panel,state,net,updates,events,shared,steam,settle,now:()=>clock,setAuth:value=>{auth=value;}};
}

test('actual shared coordinator polls four operations plus steam together instead of an extra per-steam GET loop',async()=>{
 async function run(fallback){const h=harness({fallback});const operations=['water','limestone','gear','silo'].map(id=>h.shared(id,{maximumWaitMs:300000,onUpdate:item=>h.updates.push(item.id+':'+item.status)}));
  const result=await h.settle(Promise.all([...operations,h.steam()]));return{h,result};}
 const pooled=await run(false),separate=await run(true);
 assert.equal(pooled.result[4].complete,true);assert.equal(separate.result[4].complete,true);
 assert.equal(pooled.h.net.filter(item=>item.body?.requestType==='steam_status').length,1);
 assert.equal(separate.h.net.filter(item=>item.body?.requestType==='steam_status').length,1);
 assert.deepEqual(pooled.h.net.filter(item=>item.action==='status_batch').map(item=>item.ids.length),[5,5,5]);
 assert.equal(pooled.h.net.filter(item=>item.id).length,0);
 assert.equal(separate.h.net.filter(item=>item.id===STEAM).length,3);
 assert.equal(pooled.h.net.filter(item=>item.method==='GET').length,3);
 assert.equal(separate.h.net.filter(item=>item.method==='GET').length,6);
 assert.ok(pooled.h.updates.includes('water:processing'));assert.ok(pooled.h.updates.includes('water:complete'));
 assert.equal(pooled.h.events.filter(event=>event.type==='efficiencyMorningMeetingSteamStatusLoaded').length,1);
});

test('shared waiting preserves the five-minute processing window without starting another job',async()=>{
 const h=harness({readyAt:Infinity});await assert.rejects(h.settle(h.steam()),/응답 시간이 초과/);
 assert.equal(h.now(),300000);assert.equal(h.net.filter(item=>item.body).length,1);assert.equal(h.net.filter(item=>item.id).length,0);
});

test('fallback still works when the shared coordinator is unavailable',async()=>{
 const h=harness({fallback:true});const result=await h.settle(h.steam());
 assert.equal(result.requestId,STEAM);assert.equal(result.complete,true);assert.equal(h.net.filter(item=>item.id===STEAM).length,3);
});

for(const [label,patch] of [['ID',{id:'another-request'}],['type',{requestType:'silo_level'}],['request date',{targetDate:'2026-11-02'}],['result date',{result:{sourceDate:'2026-11-02'}}]])
 test('shared completion rejects mismatched '+label+' before publishing data',async()=>{
  const h=harness({sharedStub:async()=>complete(patch)});await assert.rejects(h.steam(),/일치하지 않습니다/);
  assert.equal(h.state.steamStatus,undefined);assert.equal(h.events.length,0);assert.equal(h.net.filter(item=>item.body).length,1);
 });

test('failed shared request remains a failure and does not trigger a duplicate steam job',async()=>{
 const h=harness({sharedStub:async()=>{throw Error('fixture company-PC failure');}});
 await assert.rejects(h.steam(),/company-PC failure/);assert.equal(h.panel.dataset.steamStatusStatus,'error');assert.equal(h.net.filter(item=>item.body).length,1);
});

test('explicit fresh-only requery fails even when a complete same-date saved snapshot exists',async()=>{
 const h=harness({sharedStub:async()=>{throw Error('fixture fresh-only failure');}});
 h.state.steamStatus={...complete().result,requestId:'saved-complete',requestType:'steam_status'};
 await assert.rejects(h.steam({forceRefresh:true,ignoreSaved:true}),/fresh-only failure/);
 assert.equal(h.panel.dataset.steamStatusStatus,'error');assert.equal(h.events.length,0);
 assert.equal(h.net.filter(item=>item.body).length,1);assert.equal(h.net.filter(item=>item.action==='completed_history').length,0);
});

test('ordinary saved-first refresh keeps a known partial side when the fresh shared request fails',async()=>{
 const h=harness({sharedStub:async()=>{throw Error('fixture partial failure');}});
 h.state.steamStatus={sourceDate:DATE,targetDate:DATE,requestId:'saved-production',unitOneProduction:10,unitTwoProduction:20,totalProduction:30};
 const value=await h.steam({forceRefresh:false,ignoreSaved:false});
 assert.equal(value.productionComplete,true);assert.equal(value.salesComplete,false);assert.equal(value.complete,false);
 assert.equal(value.unitOneProduction,10);assert.match(value.salesError,/partial failure/);assert.equal(h.panel.dataset.steamStatusStatus,'partial');
 assert.equal(h.net.filter(item=>item.body).length,1);
});

for(const reason of ['date','session'])test('in-flight completion after '+reason+' change cannot publish old data or restore an old fallback',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve;});
 const h=harness({sharedStub:async()=>waiting});
 const oldPartial={...complete().result,requestId:'old-partial',productionComplete:true,salesComplete:false,steamSales:null,steamSalesLowPressure:null,steamSalesHighPressure:null};
 h.state.steamStatus=oldPartial;
 const pending=h.steam({ignoreSaved:false});await flush();
 if(reason==='date'){h.panel.dataset.morningMeetingAutoBaseDate='2026-11-04';h.state.steamStatus={sourceDate:'2026-11-04',requestId:'new-date-data'};}
 else h.setAuth('Bearer different-session');
 const before=JSON.stringify(h.state.steamStatus),eventsBefore=h.events.length;
 release(complete());await assert.rejects(pending,error=>error.code==='STEAM_QUERY_CANCELLED');
 assert.equal(JSON.stringify(h.state.steamStatus),before);assert.equal(h.events.length,eventsBefore);
 assert.notEqual(h.panel.dataset.steamStatusStatus,'error');assert.equal(h.net.filter(item=>item.body).length,1);
});

test('normal complete saved steam data still avoids any new Agent job or status polling',async()=>{
 const h=harness();h.state.steamStatus={...complete().result,requestId:'saved-complete',requestType:'steam_status'};
 const value=await h.steam({ignoreSaved:false,forceRefresh:false});assert.equal(value.complete,true);assert.equal(h.net.length,0);
});

test('complementary saved steam sides still merge before a new request is considered',async()=>{
 const stored={...complete(),id:'saved-sales',result:{sourceDate:DATE,targetDate:DATE,steamSalesLowPressure:4,steamSalesHighPressure:6,steamSales:10}};
 const h=harness({history:[stored]});h.state.steamStatus={sourceDate:DATE,targetDate:DATE,requestId:'saved-production',unitOneProduction:10,unitTwoProduction:20,totalProduction:30};
 const value=await h.steam({ignoreSaved:false,forceRefresh:false});assert.equal(value.complete,true);
 assert.equal(h.net.length,1);assert.equal(h.net[0].action,'completed_history');
});
