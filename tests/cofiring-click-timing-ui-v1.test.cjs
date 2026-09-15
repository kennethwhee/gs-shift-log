'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../maintenance/cofiring-core.js');

// Exercise the real mounted UI and real timing helper. Only remote stores/live
// transport and the selector/event DOM are modeled; calculation uses the core.
class Element {
  constructor(attributes={}){this.attributes=attributes;this.dataset={};this.value=attributes.value||'';this.hidden=false;this.disabled=false;this.textContent='';this.children=[];this.listeners={};this.classList={add(){},remove(){},toggle(){}};}
  set innerHTML(value){this.html=value;this.children=[];for(const tag of value.matchAll(/<[a-z][^>]*\bdata-cfv[^>]*>/g)){const attrs={};for(const a of tag[0].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]||'';this.children.push(new Element(attrs));}}
  get innerHTML(){return this.html||'';}
  querySelectorAll(selector){const selectors=selector.split(',').map(s=>/^\[([^=\]]+)(?:="([^\"]+)")?\]$/.exec(s.trim())),out=[];for(const child of this.children){if(selectors.some(m=>m&&Object.hasOwn(child.attributes,m[1])&&(m[2]===undefined||child.attributes[m[1]]===m[2])))out.push(child);out.push(...child.querySelectorAll(selector));}return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(){return null;}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  async fire(type){for(const fn of this.listeners[type]||[])await fn({target:this});}
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function blank(){return {unit1:{organic:null,manure:null},unit2:{organic:null,manure:null}};}
function fixtureReference(spec){
  const p=core.periodRange(spec.startLocal,spec.endLocal,spec.stepUnit,spec.stepValue);
  return {kind:'cofiring_period_summary_v1',schemaVersion:1,...spec,summaries:core.requiredSeries.map(d=>({key:d.id,unit:d.unit,fuel:d.fuel,tag:d.queryTag,startValue:100,endValue:112,min:100,max:112,delta:12,usageTon:12,startQuality:'Good',endQuality:'Good',startTime:p.start,endTime:p.end,durationGoodSeconds:p.durationMinutes*60,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}))};
}
function mounted({savedId=null}={}){
  const h={auth:'Bearer test-user-a',settingsGate:null,manualGate:null,loadGate:null,queryGate:null,savedId,loads:[],posts:[],events:[],clock:100,timers:new Map(),frames:new Map(),timing:null};
  let serial=0,liveOptions,liveState={authenticated:true,canQuery:true,period:null,item:{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''}};
  const container=new Element();
  const settings={};for(const unit of ['unit1','unit2']){settings[unit]={};for(const fuel of ['coal','bio','organic','manure'])settings[unit][fuel]={calorific:fuel==='coal'?5800:fuel==='bio'?3200:3400,coefficient:1};}
  function store(kind,options){
    let selected=null;
    const state={loaded:false,loading:false,saving:false,error:'',canEdit:true,settings,values:blank(),revision:0};
    return {state:()=>state,defaults:()=>settings,select(...values){const next=JSON.stringify(values);if(next!==selected){selected=next;state.loaded=false;}},async load(){h.events.push(kind+'.load');state.loading=true;const gate=h[kind+'Gate'];if(gate)await gate.promise;state.loaded=true;state.loading=false;options.onChange();return true;},dispose(){},save:async()=>true};
  }
  function emit(){liveOptions.onChange(liveState);}
  function result(id){return {requestId:id,report:{reference:fixtureReference(liveState.period),queryElapsedSeconds:6.374,workerElapsedSeconds:26.499,timing:{controllerElapsedSeconds:28.155}}};}
  function save(id){liveState.item.saved={id,status:'complete'};liveState.item.result=result(id);}
  const live={
    state:()=>liveState,
    select(spec){const changed=JSON.stringify(spec)!==JSON.stringify(liveState.period);liveState.period={...spec};if(changed)liveState.item={saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''};},
    async load(){const spec={...liveState.period};h.loads.push({spec,auth:h.auth});h.events.push('live.load');liveState.item.loading=true;emit();if(h.loadGate)await h.loadGate.promise;liveState.item.loading=false;if(h.savedId)save(h.savedId);if(liveState.item.result)liveOptions.onResult(liveState.item.result);emit();return true;},
    async query(options){h.posts.push({spec:{...liveState.period},auth:h.auth,...options});h.events.push('live.query');liveState.item.submitting=true;emit();if(h.queryGate)await h.queryGate.promise;liveState.item.submitting=false;if(h.queryConflict){liveState.item.error='같은 시작일의 다른 혼소율 기간 조회';emit();return false;}if(h.queryImmediateFailed){liveState.item.active=null;liveState.item.lastAttempt={id:'request-'+h.posts.length,status:'failed',errorMessage:'Synthetic immediate failure'};emit();return true;}const active={id:'request-'+h.posts.length,status:'pending'};liveState.item.active=active;liveState.item.lastAttempt=active;emit();return true;},
    pause(){},dispose(){},
  };
  h.live=live;
  h.complete=id=>{liveState.item.active=null;liveState.item.lastAttempt={id,status:'complete'};save(id);liveOptions.onResult(liveState.item.result);emit();};
  h.seed=id=>{h.savedId=id;save(id);liveOptions.onResult(liveState.item.result);emit();};
  h.emitOld=()=>{if(liveState.item.result)liveOptions.onResult(liveState.item.result);emit();};
  const setTimer=(f,ms)=>{const id=++serial;h.timers.set(id,{f,ms});return id;},clearTimer=id=>h.timers.delete(id);
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-09-15T04:02:00Z']));}static now(){return Date.parse('2026-09-15T04:02:00Z');}}
  const context=vm.createContext({Date:FixedDate,console,performance:{now:()=>h.clock},CofiringCore:core,CofiringLive:{createPeriod:options=>{liveOptions=options;return live;}},CofiringCalculationSettingsStorage:{create:options=>store('settings',options)},CofiringPeriodManualStorage:{blank,parseValue:v=>v===''?null:Number(v),create:options=>store('manual',options)},CofiringPeriodAdjustmentV56:{create:()=>null},CofiringTargetReferenceV6:{forUnit:()=>null},getShiftLogAuthHeaders:()=>({Authorization:h.auth}),document:{readyState:'loading',addEventListener(){},getElementById:()=>null},navigator:{userAgent:'desktop'},location:{pathname:'/maintenance/'},setTimeout:setTimer,clearTimeout:clearTimer,requestAnimationFrame:f=>{const id=++serial;h.frames.set(id,f);return id;},cancelAnimationFrame:id=>h.frames.delete(id),confirm:()=>true});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-click-timing-v1.js'),'utf8'),context);
  const createTiming=context.CofiringClickTimingV1.create;
  context.CofiringClickTimingV1={create:options=>(h.timing=createTiming(options))};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8'),context);
  h.controller=context.CofiringPeriodV5.mount(container);h.find=key=>container.querySelector(`[data-${key}]`);
  h.frame=()=>{const entry=h.frames.entries().next().value;assert.ok(entry,'animation frame scheduled');h.frames.delete(entry[0]);h.clock+=16;entry[1]();};
  h.tick=ms=>{const entry=[...h.timers].find(([,t])=>t.ms===ms);assert.ok(entry,'timer '+ms+' scheduled');h.timers.delete(entry[0]);h.clock+=ms;entry[1].f();};
  h.ready=async()=>{await flush();h.tick(0);await flush();h.loads=[];h.events=[];};
  return h;
}

test('saved Calculate renders real core results with no network request and completes after two frames',async()=>{
  const h=mounted({savedId:'saved-original'});await h.ready();
  assert.equal(h.timing.state().status,'idle');
  await h.find('cfv5-query').fire('click');
  assert.equal(h.loads.length,0);assert.equal(h.posts.length,0);
  assert.equal(h.controller.getResult().units.unit1.coal.quantity,48);
  assert.equal(h.timing.state().status,'finishing');
  h.frame();assert.equal(h.timing.state().status,'finishing');h.frame();
  assert.equal(h.timing.state().status,'complete');assert.equal(h.timing.state().source,'saved_recalculate');
  assert.equal(h.timing.state().requestId,'saved-original');assert.match(h.find('cfv7-click-timing').textContent,/저장값 재계산/);h.controller.dispose();
});
test('settings, manual inputs and saved-result load begin in parallel; request waits for every prerequisite',async()=>{
  const h=mounted();await h.ready();h.settingsGate=deferred();h.manualGate=deferred();h.loadGate=deferred();
  const click=h.find('cfv5-query').fire('click');await flush();
  assert.deepEqual(h.events.slice(0,3),['settings.load','manual.load','live.load']);assert.equal(h.posts.length,0);
  h.loadGate.resolve();await flush();assert.equal(h.posts.length,0);
  h.settingsGate.resolve();await flush();assert.equal(h.posts.length,0);
  h.manualGate.resolve();await click;assert.equal(h.posts.length,1);assert.equal(h.posts[0].force,false);assert.equal(h.timing.state().expectedRequestId,'request-1');h.controller.dispose();
});
test('saved data discovered by concurrent preflight calculates without a new request',async()=>{
  const h=mounted();await h.ready();h.savedId='server-saved';h.loadGate=deferred();
  const click=h.find('cfv5-query').fire('click');await flush();assert.equal(h.posts.length,0);
  h.loadGate.resolve();await click;assert.equal(h.posts.length,0);assert.equal(h.timing.state().status,'finishing');h.frame();h.frame();
  assert.equal(h.timing.state().requestId,'server-saved');assert.equal(h.timing.state().source,'saved_recalculate');h.controller.dispose();
});
test('changing selected period during click prerequisites cannot submit either stale or new period',async()=>{
  const h=mounted();await h.ready();h.loadGate=deferred();const click=h.find('cfv5-query').fire('click');await flush();
  h.find('cfv5-end').value='2026-09-15T12:00';const changed=h.find('cfv5-end').fire('change');await flush();
  h.loadGate.resolve();await Promise.all([click,changed]);assert.equal(h.posts.length,0);assert.equal(h.timing.state().status,'cancelled');h.controller.dispose();
});
test('changing authentication during click prerequisites cannot submit under the replacement user',async()=>{
  const h=mounted();await h.ready();h.loadGate=deferred();const click=h.find('cfv5-query').fire('click');await flush();
  h.auth='Bearer test-user-b';h.loadGate.resolve();await click;assert.equal(h.posts.length,0);
  h.tick(200);assert.equal(h.timing.state().status,'cancelled');h.controller.dispose();
});
test('authentication change during busy retry delay cannot issue a second request',async()=>{
  const h=mounted();await h.ready();h.queryConflict=true;const click=h.find('cfv5-query').fire('click');await flush();
  assert.equal(h.posts.length,1);assert.equal(h.posts[0].auth,'Bearer test-user-a');
  h.auth='Bearer test-user-b';h.tick(3000);await click;
  assert.equal(h.posts.length,1);h.tick(200);assert.equal(h.timing.state().status,'cancelled');h.controller.dispose();
});
test('forced requery preserves old values but cannot complete timing from them or an unrelated result',async()=>{
  const h=mounted({savedId:'old-saved'});await h.ready();h.queryGate=deferred();const click=h.find('cfv5-requery').fire('click');await flush();
  assert.equal(h.posts.length,1);assert.equal(h.posts[0].force,true);h.emitOld();
  assert.equal(h.timing.state().status,'running');assert.equal(h.frames.size,0);
  h.queryGate.resolve();await click;h.emitOld();assert.equal(h.timing.state().expectedRequestId,'request-1');assert.equal(h.frames.size,0);
  h.complete('different-request');assert.equal(h.timing.state().status,'running');assert.equal(h.frames.size,0);
  h.complete('request-1');assert.equal(h.timing.state().status,'finishing');h.frame();assert.equal(h.timing.state().status,'finishing');h.frame();
  assert.equal(h.timing.state().status,'complete');assert.equal(h.timing.state().source,'new_query');assert.equal(h.timing.state().controllerSeconds,28.155);h.controller.dispose();
});
test('double click during asynchronous work preserves original measurement and makes one request',async()=>{
  const h=mounted();await h.ready();h.loadGate=deferred();const first=h.find('cfv5-query').fire('click');await flush();h.clock+=750;
  await h.find('cfv5-query').fire('click');assert.equal(h.loads.length,1);assert.equal(h.posts.length,0);
  h.loadGate.resolve();await first;assert.equal(h.posts.length,1);h.complete('request-1');h.frame();h.frame();
  assert.equal(h.timing.state().status,'complete');assert.equal(h.timing.state().elapsedMs,782);h.controller.dispose();
});
test('an immediately failed request is terminal even before its ID is accepted by the click timer',async()=>{
  const h=mounted();await h.ready();h.queryImmediateFailed=true;
  await h.find('cfv5-query').fire('click');
  assert.equal(h.posts.length,1);assert.equal(h.live.state().item.lastAttempt.status,'failed');
  assert.equal(h.timing.state().status,'failed');assert.equal(h.frames.size,0);
  assert.equal([...h.timers.values()].filter(t=>t.ms===200).length,0);assert.match(h.find('cfv7-click-timing').textContent,/완료되지 않음/);h.controller.dispose();
});
test('requery before cached calculation paints starts a fresh measurement and ignores the stale frame',async()=>{
  const h=mounted({savedId:'old-saved'});await h.ready();
  await h.find('cfv5-query').fire('click');assert.equal(h.timing.state().status,'finishing');
  const staleFrame=[...h.frames.values()][0];assert.ok(staleFrame);h.clock+=200;h.queryGate=deferred();
  const refresh=h.find('cfv5-requery').fire('click');await flush();
  assert.equal(h.timing.state().mode,'forced_requery');assert.equal(h.timing.state().status,'running');assert.equal(h.timing.state().elapsedMs,0);assert.equal(h.posts.length,1);
  staleFrame();assert.equal(h.timing.state().status,'running');assert.equal(h.frames.size,0);
  h.queryGate.resolve();await refresh;assert.equal(h.timing.state().expectedRequestId,'request-1');
  h.clock+=50;h.complete('request-1');h.frame();h.frame();
  assert.equal(h.timing.state().status,'complete');assert.equal(h.timing.state().source,'new_query');assert.equal(h.timing.state().requestId,'request-1');assert.equal(h.timing.state().elapsedMs,82);h.controller.dispose();
});
