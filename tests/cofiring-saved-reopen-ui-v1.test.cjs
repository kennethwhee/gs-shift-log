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
  constructor(attributes={}){this.attributes=attributes;this.dataset={};this.value=attributes.value||'';this.hidden=Object.hasOwn(attributes,'hidden');this.disabled=Object.hasOwn(attributes,'disabled');this.textContent='';this.children=[];this.listeners={};this.classList={add(){},remove(){},toggle(){}};}
  set innerHTML(value){this.html=value;this.children=[];for(const tag of value.matchAll(/<[a-z][^>]*\bdata-cfv[^>]*>/g)){const attrs={};for(const a of tag[0].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]||'';this.children.push(new Element(attrs));}}
  get innerHTML(){return this.html||'';}
  querySelectorAll(selector){const selectors=selector.split(',').map(s=>/^\[([^=\]]+)(?:="([^\"]+)")?\]$/.exec(s.trim())),out=[];for(const child of this.children){if(selectors.some(m=>m&&Object.hasOwn(child.attributes,m[1])&&(m[2]===undefined||child.attributes[m[1]]===m[2])))out.push(child);out.push(...child.querySelectorAll(selector));}return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getAttribute(name){return Object.hasOwn(this.attributes,name)?this.attributes[name]:null;}
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
function mounted({savedId=null,now='2026-09-15T04:02:00Z',latest=null,manualByRange={}}={}){
  const h={hidden:false,settingsByDate:{},manualByStart:{},manualByRange,latest,latestGate:null,latestCalls:[],savedRecords:new Map(),storeSelections:{},now:Date.parse(now),auth:'Bearer test-user-a',settingsGate:null,manualGate:null,loadGate:null,queryGate:null,savedId,loads:[],posts:[],events:[],clock:100,timers:new Map(),frames:new Map(),timing:null};
  let serial=0,liveOptions,liveState={authenticated:true,canQuery:true,period:null,item:{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''}};
  const container=new Element(),view={};container.closest=selector=>selector==='[data-efficiency-view]'?view:selector.includes('[hidden]')&&h.hidden?view:null;
  const settings={};for(const unit of ['unit1','unit2']){settings[unit]={};for(const fuel of ['coal','bio','organic','manure'])settings[unit][fuel]={calorific:fuel==='coal'?5800:fuel==='bio'?3200:3400,coefficient:1};}
  function store(kind,options){
    let selected=null;
    const state={loaded:false,loading:false,saving:false,error:'',canEdit:true,settings,values:blank(),revision:0};
    return {state:()=>state,defaults:()=>settings,select(...values){h.storeSelections[kind]=values;const next=JSON.stringify(values);if(next!==selected){selected=next;state.loaded=false;state.settings=h.settingsByDate[values[0]]||settings;state.values=h.manualByRange[values.join('|')]||blank();}},async load(){h.events.push(kind+'.load');state.loading=true;const gate=h[kind+'Gate'];if(gate)await gate.promise;state.loaded=true;state.loading=false;state.error=h[kind+'Error']||'';options.onChange();return !state.error;},dispose(){},save:async()=>true};
  }
  function emit(){liveOptions.onChange(liveState);}
  function result(id,spec=liveState.period){return {requestId:id,report:{reference:fixtureReference(spec),queryElapsedSeconds:6.374,workerElapsedSeconds:26.499,timing:{controllerElapsedSeconds:28.155}}};}
  function save(id){liveState.item.saved={id,status:'complete'};liveState.item.result=result(id);}
  if(latest)h.savedRecords.set(JSON.stringify(latest.period),latest.saved.id);
  const live={
    state:()=>{liveState.authenticated=!!h.auth;return liveState;},
    async readLatestDaily(date){h.latestCalls.push({date,auth:h.auth});const value=h.latest;if(h.latestGate)await h.latestGate.promise;return value;},
    select(spec){const changed=JSON.stringify(spec)!==JSON.stringify(liveState.period);liveState.period={...spec};if(changed)liveState.item={saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''};},
    async load(){const spec={...liveState.period};h.loads.push({spec,auth:h.auth});h.events.push('live.load');liveState.item.loading=true;emit();if(h.loadGate)await h.loadGate.promise;liveState.item.loading=false;const id=h.savedRecords.get(JSON.stringify(spec));if(id)save(id);if(liveState.item.result)liveOptions.onResult(liveState.item.result);emit();return true;},
    async query(options){h.posts.push({spec:{...liveState.period},auth:h.auth,...options});h.events.push('live.query');liveState.item.submitting=true;emit();if(h.queryGate)await h.queryGate.promise;liveState.item.submitting=false;if(h.queryConflict){liveState.item.error='같은 시작일의 다른 혼소율 기간 조회';emit();return false;}if(h.queryImmediateFailed){liveState.item.active=null;liveState.item.lastAttempt={id:'request-'+h.posts.length,status:'failed',errorMessage:'Synthetic immediate failure'};emit();return true;}const active={id:'request-'+h.posts.length,status:'pending'};liveState.item.active=active;liveState.item.lastAttempt=active;emit();return true;},
    pause(){},dispose(){},
  };
  h.live=live;h.emitReference=ref=>{liveOptions.onResult({report:{reference:ref}});emit();};
  h.complete=id=>{h.savedRecords.set(JSON.stringify(liveState.period),id);h.latest={period:{...liveState.period},saved:{id,status:'complete'},result:result(id)};liveState.item.active=null;liveState.item.lastAttempt={id,status:'complete'};save(id);liveOptions.onResult(liveState.item.result);emit();};
  h.seed=id=>{h.savedId=id;save(id);liveOptions.onResult(liveState.item.result);emit();};
  h.emitOld=()=>{if(liveState.item.result)liveOptions.onResult(liveState.item.result);emit();};
  const setTimer=(f,ms)=>{const id=++serial;h.timers.set(id,{f,ms});return id;},clearTimer=id=>h.timers.delete(id);
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:[h.now]));}static now(){return h.now;}}
  const context=vm.createContext({Date:FixedDate,console,MutationObserver:class {constructor(fn){h.visibilityChanged=fn;}observe(){}disconnect(){}},performance:{now:()=>h.clock},CofiringCore:core,CofiringLive:{createPeriod:options=>{liveOptions=options;return live;}},CofiringCalculationSettingsStorage:{create:options=>store('settings',options)},CofiringPeriodManualStorage:{blank,parseValue:v=>v===''?null:Number(v),create:options=>store('manual',options)},CofiringPeriodAdjustmentV56:{create:()=>null},CofiringTargetReferenceV6:{forUnit:()=>null},getShiftLogAuthHeaders:()=>({Authorization:h.auth}),document:{readyState:'loading',addEventListener(){},getElementById:()=>null},navigator:{userAgent:'desktop'},location:{pathname:'/maintenance/'},setTimeout:setTimer,clearTimeout:clearTimer,requestAnimationFrame:f=>{const id=++serial;h.frames.set(id,f);return id;},cancelAnimationFrame:id=>h.frames.delete(id),confirm:()=>true});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-click-timing-v1.js'),'utf8'),context);
  const createTiming=context.CofiringClickTimingV1.create;
  context.CofiringClickTimingV1={create:options=>(h.timing=createTiming(options))};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-deadline-target-v1.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8'),context);
  h.setHidden=value=>{h.hidden=value;h.visibilityChanged();};h.ui=context.CofiringPeriodV5;h.controller=context.CofiringPeriodV5.mount(container);h.find=key=>container.querySelector(`[data-${key}]`);h.container=container;
  h.frame=()=>{const entry=h.frames.entries().next().value;assert.ok(entry,'animation frame scheduled');h.frames.delete(entry[0]);h.clock+=16;entry[1]();};
  h.tick=ms=>{const entry=[...h.timers].find(([,t])=>t.ms===ms);assert.ok(entry,'timer '+ms+' scheduled');h.timers.delete(entry[0]);h.clock+=ms;entry[1].f();};
  h.ready=async()=>{await flush();if([...h.timers.values()].some(t=>t.ms===0))h.tick(0);await flush();h.loads=[];h.events=[];};
  return h;
}


function scope(startLocal,endLocal){return {startLocal,endLocal,stepUnit:'minute',stepValue:1};}
function plain(value){return JSON.parse(JSON.stringify(value));}
const OLD=scope('2026-09-16T00:00','2026-09-16T03:08');
function stored(period=OLD,id='saved-old'){return {period,saved:{id,status:'complete'}};}
function finish(h,id){h.complete(id);h.frame();h.frame();assert.equal(h.timing.state().status,'complete');}

test('freshly mounted today restores the last saved 03:09 query with its exact manual range and no query request',async()=>{
  const values={unit1:{organic:5,manure:2},unit2:{organic:3,manure:1}};
  const h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored(),manualByRange:{[OLD.startLocal+'|'+OLD.endLocal]:values}});await h.ready();
  assert.deepEqual(plain(h.controller.getSpec()),OLD);
  assert.equal(h.find('cfv7-daily-window').textContent,'2026-09-16 00:00 ~ 2026-09-16 03:09');
  assert.deepEqual(h.storeSelections.manual,[OLD.startLocal,OLD.endLocal]);
  assert.equal(h.controller.getResult().units.unit1.organic.quantity,5);assert.equal(h.controller.getResult().units.unit2.manure.quantity,1);
  assert.equal(h.posts.length,0);assert.equal(h.latestCalls.length,1);
  assert.match(h.find('cfv11-status-line').textContent,/계산 완료.*03:08 기준/);
  assert.doesNotMatch(h.find('cfv11-status-line').textContent,/회사 PC|DataPARC|빈칸|새 결과|초/);
  h.controller.dispose();
});

test('closing and reopening, then recreating the whole screen, both show the saved original endpoint',async()=>{
  let h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored()});await h.ready();
  h.now=Date.parse('2026-09-16T03:30:00+09:00');h.setHidden(true);h.setHidden(false);await flush();if([...h.timers.values()].some(t=>t.ms===0))h.tick(0);await flush();
  assert.deepEqual(plain(h.controller.getSpec()),OLD);assert.ok(h.controller.getResult());assert.equal(h.posts.length,0);h.controller.dispose();
  h=mounted({now:'2026-09-16T04:00:00+09:00',latest:stored()});await h.ready();
  assert.deepEqual(plain(h.controller.getSpec()),OLD);assert.ok(h.controller.getResult());assert.equal(h.posts.length,0);h.controller.dispose();
});

test('Calculate after saved restore advances to current time and still requires a new exact result',async()=>{
  const h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored()});await h.ready();
  h.now=Date.parse('2026-09-16T03:20:00+09:00');await h.find('cfv5-query').fire('click');
  assert.equal(h.posts.length,1);assert.deepEqual(plain(h.posts[0].spec),scope('2026-09-16T00:00','2026-09-16T03:19'));
  assert.equal(h.controller.getResult(),null);assert.equal(h.timing.state().status,'running');
  finish(h,'request-1');assert.match(h.find('cfv11-status-line').textContent,/계산 완료.*03:19 기준.*초/);h.controller.dispose();
});

test('restoration to an older result cannot overwrite a Calculate clicked during the read',async()=>{
  const h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored()});h.latestGate=deferred();await h.ready();
  await h.find('cfv5-query').fire('click');assert.equal(h.posts.length,1);
  h.latestGate.resolve();await flush();assert.deepEqual(plain(h.controller.getSpec()),scope('2026-09-16T00:00','2026-09-16T03:14'));
  assert.equal(h.posts.length,1);finish(h,'request-1');h.controller.dispose();
});

test('date, mode, auth, hide and dispose changes reject a delayed old saved-period restoration',async()=>{
  for(const operation of ['date','mode','auth','hide','dispose']){
    const h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored()});h.latestGate=deferred();await h.ready();
    if(operation==='date'){h.find('cfv7-date').value='2026-09-14';await h.find('cfv7-date').fire('change');}
    if(operation==='mode'){h.find('cfv8-mode').value='period';h.find('cfv8-start').value='2026-09-16T01:00';h.find('cfv8-end').value='2026-09-16T02:00';await h.find('cfv8-mode').fire('change');}
    if(operation==='auth')h.auth='Bearer replacement';
    if(operation==='hide')h.setHidden(true);
    if(operation==='dispose')h.controller.dispose();
    h.latestGate.resolve();await flush();assert.notDeepEqual(plain(h.controller.getSpec()),OLD,operation);assert.equal(h.posts.length,0,operation);assert.equal(h.controller.getResult(),null,operation);
    h.controller.dispose();
  }
});

test('manual input entered during restore is kept and cannot be silently replaced by old-range input',async()=>{
  const h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored()});h.latestGate=deferred();await h.ready();
  const input=h.container.querySelector('[data-cfv5-manual="unit1:organic"]');input.value='9';await input.fire('input');h.latestGate.resolve();await flush();
  assert.notDeepEqual(plain(h.controller.getSpec()),OLD);assert.equal(input.value,'9');assert.equal(h.posts.length,0);h.controller.dispose();
});

test('changing to another date and back to today rediscovers the last saved cumulative scope',async()=>{
  const h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored()});await h.ready();
  h.find('cfv7-date').value='2026-09-14';await h.find('cfv7-date').fire('change');h.tick(0);await flush();assert.equal(h.controller.getSpec().endLocal,'2026-09-15T00:00');
  h.find('cfv7-date').value='2026-09-16';await h.find('cfv7-date').fire('change');h.tick(0);await flush();
  assert.deepEqual(plain(h.controller.getSpec()),OLD);assert.ok(h.controller.getResult());assert.equal(h.posts.length,0);h.controller.dispose();
});

test('a failed longer query does not prevent reopening the last successful saved result',async()=>{
  const h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored()});await h.ready();h.queryImmediateFailed=true;
  await h.find('cfv5-query').fire('click');assert.equal(h.timing.state().status,'failed');assert.equal(h.controller.getResult(),null);
  h.setHidden(true);h.setHidden(false);await flush();h.tick(0);await flush();
  assert.deepEqual(plain(h.controller.getSpec()),OLD);assert.ok(h.controller.getResult());assert.equal(h.posts.length,1);assert.equal(h.timing.state().status,'failed');h.controller.dispose();
});

test('past, future and custom periods never adopt today cumulative saved scope',async()=>{
  for(const choice of ['past','future','custom']){
    const h=mounted({now:'2026-09-16T03:15:00+09:00'});await h.ready();h.latest=stored();h.latestCalls=[];
    if(choice==='custom'){h.find('cfv8-mode').value='period';h.find('cfv8-start').value='2026-09-16T01:00';h.find('cfv8-end').value='2026-09-16T02:00';await h.find('cfv8-mode').fire('change');}
    else{h.find('cfv7-date').value=choice==='past'?'2026-09-14':'2026-09-17';await h.find('cfv7-date').fire('change');}
    if([...h.timers.values()].some(t=>t.ms===0))h.tick(0);await flush();assert.equal(h.latestCalls.length,0);assert.equal(h.posts.length,0);assert.notDeepEqual(plain(h.controller.getSpec()),OLD);h.controller.dispose();
  }
});

test('normal status uses one short line and raw error/timing text remains inside closed native details',async()=>{
  const h=mounted({now:'2026-09-16T03:15:00+09:00'});await h.ready();h.queryImmediateFailed=true;await h.find('cfv5-query').fire('click');
  assert.match(h.find('cfv11-status-line').textContent,/조회 실패/);assert.doesNotMatch(h.find('cfv11-status-line').textContent,/Synthetic/);
  assert.match(h.find('cfv5-status').textContent,/Synthetic immediate failure/);
  const html=h.ui.markup();assert.match(html,/<details[^>]*data-cfv11-status-details><summary>상세<\/summary>/);assert.ok(html.indexOf('data-cfv7-click-timing')>html.indexOf('data-cfv11-status-details'));assert.ok(html.indexOf('data-cfv5-status')<html.indexOf('</details>'));
  h.controller.dispose();
});


test('superseding a pending restore with a past or custom period clears the compact restoring state',async()=>{
  for(const mode of ['past','custom']){
    const h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored()});h.latestGate=deferred();await h.ready();
    if(mode==='past'){h.find('cfv7-date').value='2026-09-14';await h.find('cfv7-date').fire('change');}
    else{h.find('cfv8-mode').value='period';h.find('cfv8-start').value='2026-09-16T01:00';h.find('cfv8-end').value='2026-09-16T02:00';await h.find('cfv8-mode').fire('change');}
    h.latestGate.resolve();await flush();h.tick(0);await flush();
    h.complete('restored-other-scope');assert.match(h.find('cfv11-status-line').textContent,/계산 완료/);assert.doesNotMatch(h.find('cfv11-status-line').textContent,/저장 결과 확인 중/);h.controller.dispose();
  }
});

test('a manual-store error while restoring is visible on the compact status without opening detail',async()=>{
  const h=mounted({now:'2026-09-16T03:15:00+09:00',latest:stored()});h.manualError='수동 사용량 불러오기 실패';await h.ready();
  assert.equal(h.controller.getResult(),null);assert.match(h.find('cfv11-status-line').textContent,/계산 기준 확인 실패/);assert.equal(h.find('cfv11-status-line').dataset.tone,'error');assert.equal(h.posts.length,0);h.controller.dispose();
});
