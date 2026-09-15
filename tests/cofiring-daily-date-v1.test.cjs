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
function mounted({savedId=null,now='2026-09-15T04:02:00Z'}={}){
  const h={hidden:false,settingsByDate:{},manualByStart:{},storeSelections:{},now:Date.parse(now),auth:'Bearer test-user-a',settingsGate:null,manualGate:null,loadGate:null,queryGate:null,savedId,loads:[],posts:[],events:[],clock:100,timers:new Map(),frames:new Map(),timing:null};
  let serial=0,liveOptions,liveState={authenticated:true,canQuery:true,period:null,item:{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''}};
  const container=new Element(),view={};container.closest=selector=>selector==='[data-efficiency-view]'?view:selector.includes('[hidden]')&&h.hidden?view:null;
  const settings={};for(const unit of ['unit1','unit2']){settings[unit]={};for(const fuel of ['coal','bio','organic','manure'])settings[unit][fuel]={calorific:fuel==='coal'?5800:fuel==='bio'?3200:3400,coefficient:1};}
  function store(kind,options){
    let selected=null;
    const state={loaded:false,loading:false,saving:false,error:'',canEdit:true,settings,values:blank(),revision:0};
    return {state:()=>state,defaults:()=>settings,select(...values){h.storeSelections[kind]=values;const next=JSON.stringify(values);if(next!==selected){selected=next;state.loaded=false;state.settings=h.settingsByDate[values[0]]||settings;state.values=h.manualByStart[values[0]]||blank();}},async load(){h.events.push(kind+'.load');state.loading=true;const gate=h[kind+'Gate'];if(gate)await gate.promise;state.loaded=true;state.loading=false;options.onChange();return true;},dispose(){},save:async()=>true};
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
  h.live=live;h.emitReference=ref=>{liveOptions.onResult({report:{reference:ref}});emit();};
  h.complete=id=>{liveState.item.active=null;liveState.item.lastAttempt={id,status:'complete'};save(id);liveOptions.onResult(liveState.item.result);emit();};
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
  h.setHidden=value=>{h.hidden=value;h.visibilityChanged();};h.ui=context.CofiringPeriodV5;h.controller=context.CofiringPeriodV5.mount(container);h.find=key=>container.querySelector(`[data-${key}]`);
  h.frame=()=>{const entry=h.frames.entries().next().value;assert.ok(entry,'animation frame scheduled');h.frames.delete(entry[0]);h.clock+=16;entry[1]();};
  h.tick=ms=>{const entry=[...h.timers].find(([,t])=>t.ms===ms);assert.ok(entry,'timer '+ms+' scheduled');h.timers.delete(entry[0]);h.clock+=ms;entry[1].f();};
  h.ready=async()=>{await flush();h.tick(0);await flush();h.loads=[];h.events=[];};
  return h;
}

const exportedContext=vm.createContext({CofiringCore:core,CofiringPeriodAdjustmentV56:{},CofiringTargetReferenceV6:{}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-deadline-target-v1.js'),'utf8'),exportedContext);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8'),exportedContext);
const ui=exportedContext.CofiringPeriodV5;
const contract=require('../maintenance/cofiring-live-contract.js');
function comparable(value){return JSON.parse(JSON.stringify(value));}
function spec(date){const p=ui.dailySpec(date);return {startLocal:p.startLocal,endLocal:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue};}

test('one selected date queries through next 00:01 once while accounting for exactly 24 hours',()=>{
  const p=ui.dailySpec('2026-09-15'),v=contract.period(p,Number.MAX_SAFE_INTEGER);
  assert.equal(p.startLocal,'2026-09-15T00:00');assert.equal(p.endLocal,'2026-09-16T00:00');
  assert.equal(p.queryEnd,'2026-09-16T00:01:00+09:00');assert.equal(v.queryEndLocal,'2026-09-16T00:01');
  assert.equal(p.durationMinutes,1440);assert.equal(p.durationHours,24);assert.equal(p.stepUnit,'minute');assert.equal(p.stepValue,1);
});
test('month end, year end and leap day always use the following calendar midnight',()=>{
  for(const [date,next] of [['2026-09-30','2026-10-01'],['2026-12-31','2027-01-01'],['2028-02-29','2028-03-01']]){
    const p=ui.dailySpec(date);assert.equal(p.endLocal,next+'T00:00');assert.equal(p.queryEnd,next+'T00:01:00+09:00');assert.equal(p.durationHours,24);
  }
  assert.throws(()=>ui.dailySpec('2026-02-29'));assert.throws(()=>ui.dailySpec('2020-12-31'));assert.throws(()=>ui.dailySpec(''));
});
test('computer timezone cannot alter selected date, default completed date or query range',()=>{
  const {spawnSync}=require('node:child_process');
  const file=path.resolve(__dirname,'../maintenance/cofiring-period-ui-v5.js');
  const program=`const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const c=vm.createContext({CofiringCore:require(path.join(path.dirname(${JSON.stringify(file)}),'cofiring-core.js')),CofiringPeriodAdjustmentV56:{},CofiringTargetReferenceV6:{}});vm.runInContext(fs.readFileSync(${JSON.stringify(file)},'utf8'),c);const ui=c.CofiringPeriodV5;console.log(JSON.stringify([ui.dailySpec('2026-09-15'),ui.defaultCalculationDate(Date.parse('2026-09-15T15:01:00Z'))]));`;
  const values=['UTC','Asia/Seoul','America/Los_Angeles'].map(TZ=>{const r=spawnSync(process.execPath,['-e',program],{env:{...process.env,TZ},encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;});
  assert.equal(new Set(values).size,1);
});
test('daily readiness blocks 00:00:59.999 and allows exactly 00:01:00 KST',()=>{
  assert.equal(ui.dayAvailability('2026-09-15',Date.parse('2026-09-16T00:00:59.999+09:00')).ready,false);
  const a=ui.dayAvailability('2026-09-15',Date.parse('2026-09-16T00:01:00+09:00'));assert.equal(a.ready,true);
  assert.equal(ui.defaultCalculationDate(a.readyAt-1),'2026-09-14');assert.equal(ui.defaultCalculationDate(a.readyAt),'2026-09-15');
  assert.equal(ui.defaultCalculationDate(Date.parse('2026-09-16T23:59:00+09:00')),'2026-09-15');
});
test('daily mode exposes a date and displayed window with custom time fields hidden by default',()=>{
  const html=ui.markup();assert.match(html,/data-cfv7-date type="date"/);assert.match(html,/data-cfv7-daily-window/);
  assert.match(html,/<option value="daily" selected>/);assert.match(html,/<div[^>]*data-cfv8-period-fields[^>]*hidden/);
  assert.doesNotMatch(html,/data-cfv5-step-value|data-cfv5-step-unit/);
});
test('old partial-day saved data cannot be reused as the daily result',()=>{
  const daily=spec('2026-09-15'),partial={...daily,endLocal:'2026-09-15T22:11'},reference=fixtureReference(partial);
  const s={authenticated:true,canQuery:true,period:daily,item:{saved:{id:'old-partial'},result:{requestId:'old-partial',report:{reference}}}};
  assert.equal(ui.cachedReference(s,daily),null);
});
test('actual mounted calculation divides daily Coal and Bio usage by 24 hours',async()=>{
  const h=mounted({savedId:'daily-saved'});await h.ready();await h.find('cfv5-query').fire('click');
  const r=h.controller.getResult();assert.equal(r.period.durationHours,24);assert.equal(r.units.unit1.coal.quantity,48);
  const fuel=r.units.unit1.coal;assert.equal(fuel.averageTonPerHour,2);assert.equal(r.units.unit1.bio.averageTonPerHour,0.5);
  h.controller.dispose();
});
test('clicking at different hours requests the same fixed daily spec',async()=>{
  const sent=[];
  for(const now of ['2026-09-16T00:01:00+09:00','2026-09-16T23:55:00+09:00']){
    const h=mounted({now});await h.ready();h.find('cfv7-date').value='2026-09-15';await h.find('cfv7-date').fire('change');await h.find('cfv5-query').fire('click');
    assert.equal(h.posts.length,1);sent.push(comparable(h.posts[0].spec));assert.equal(h.find('cfv7-daily-window').textContent,'2026-09-15 00:00 ~ 2026-09-16 00:01');h.controller.dispose();
  }
  assert.deepEqual(sent[0],spec('2026-09-15'));assert.deepEqual(sent[0],sent[1]);
});
test('today and future selections preserve full-day window and issue no reads or query requests',async()=>{
  const h=mounted();await h.ready();
  for(const date of ['2026-09-15','2026-09-20']){
    h.events=[];h.loads=[];h.posts=[];h.find('cfv7-date').value=date;await h.find('cfv7-date').fire('change');
    await h.find('cfv5-query').fire('click');await h.find('cfv5-requery').fire('click');await flush();
    assert.equal(h.loads.length,0);assert.equal(h.posts.length,0);assert.deepEqual(h.events,[]);
    assert.deepEqual(comparable(h.controller.getSpec()),spec(date));assert.equal(h.find('cfv5-query').disabled,true);
    assert.equal(h.find('cfv5-manual-save').disabled,true);assert.equal(h.find('cfv5-settings-save').disabled,true);
    assert.match(h.find('cfv5-status').textContent,/00:01 이후 계산할 수 있습니다/);
    assert.ok(h.find('cfv7-daily-window').textContent.startsWith(date+' 00:00 ~ '));
  }
  h.controller.dispose();
});
test('late prior-day data is ignored after switching to an unfinished day',async()=>{
  const h=mounted({savedId:'daily-saved'});await h.ready();const old=fixtureReference(h.controller.getSpec());
  h.find('cfv7-date').value='2026-09-15';await h.find('cfv7-date').fire('change');h.emitReference(old);
  assert.equal(h.controller.getResult(),null);assert.equal(h.controller.getDisplayResult(),null);
  assert.match(h.find('cfv5-status').textContent,/2026-09-16 00:01 이후/);h.controller.dispose();
});
test('reaching midnight completion enables the selected date without starting a DataPARC request',async()=>{
  const h=mounted({now:'2026-09-16T00:00:59.999+09:00'});await h.ready();h.find('cfv7-date').value='2026-09-15';await h.find('cfv7-date').fire('change');
  assert.equal(h.find('cfv5-query').disabled,true);h.now=Date.parse('2026-09-16T00:01:00.100+09:00');h.tick(50);await flush();
  h.tick(0);await flush();assert.equal(h.find('cfv5-query').disabled,false);assert.equal(h.posts.length,0);assert.deepEqual(comparable(h.controller.getSpec()),spec('2026-09-15'));h.controller.dispose();
});
function liveHarness(){
  const gate=deferred(),calls=[],results=[],states=[];let now=Date.parse('2026-09-16T06:00:00+09:00');
  class FixedDate extends Date{static now(){return now;}}
  const context=vm.createContext({Date:FixedDate,URLSearchParams,TextEncoder,console,setTimeout:()=>1,clearTimeout(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-live-contract.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-live.js'),'utf8'),context);
  const live=context.CofiringLive.createPeriod({getHeaders:()=>({Authorization:'Bearer user'}),canQuery:()=>true,isVisible:()=>true,fetch:async(url,init)=>{calls.push({url,init});return gate.promise;},onResult:r=>results.push(r),onChange:s=>states.push(s)});
  return {live,gate,calls,results,states};
}
test('real live selection invalidates an in-flight completed result when switching to a future date',async()=>{
  const h=liveHarness(),old=spec('2026-09-15'),future=spec('2026-09-20');h.live.select(old);const pending=h.live.load();await flush();assert.equal(h.calls.length,1);
  h.live.select(future);const changes=h.states.length;
  const id='12345678-1234-4234-9234-123456789abc',r=fixtureReference(old),report={kind:'cofiring_dataparc_period_report',schemaVersion:1,status:'PERIOD_READY',executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],runId:'a'.repeat(32),...old,queryEndLocal:'2026-09-16T00:01',summaries:r.summaries,completedAtUtc:'2026-09-15T15:05:00Z'};
  const result={kind:'cofiring_period_live_result',schemaVersion:1,requestId:id,request:old,report};contract.periodResult(result,id,old);
  h.gate.resolve({ok:true,json:async()=>({ok:true,bridgeVersion:2,periodKey:contract.periodKey(old),saved:{id,requestType:'cofiring_period',status:'complete'},result,active:null,lastAttempt:null})});
  assert.equal(await pending,false);assert.equal(h.results.length,0);assert.equal(h.states.length,changes);
  assert.deepEqual(comparable(h.live.state().period),future);assert.equal(h.live.state().item.saved,null);assert.equal(h.live.state().canQuery,false);
  assert.equal(await h.live.load(),false);assert.equal(await h.live.query({explicit:true}),false);assert.equal(h.calls.length,1);h.live.dispose();
});
test('reopening after the selected day closes reloads that day settings and manual values before calculation',async()=>{
  const h=mounted({savedId:'saved-yesterday',now:'2026-09-15T23:59:00+09:00'});await h.ready();
  const nextSettings=comparable(h.controller.settings.defaults());nextSettings.unit1.coal.calorific=6000;nextSettings.unit1.bio.calorific=3000;
  h.settingsByDate['2026-09-15']=nextSettings;
  h.manualByStart['2026-09-15T00:00']={unit1:{organic:3,manure:5},unit2:{organic:7,manure:11}};
  assert.deepEqual(h.storeSelections.settings,['2026-09-14']);
  h.find('cfv7-date').value='2026-09-15';await h.find('cfv7-date').fire('change');
  assert.equal(h.find('cfv5-query').disabled,true);assert.equal(h.controller.getResult(),null);
  h.setHidden(true);assert.equal(h.timers.size,0);
  h.now=Date.parse('2026-09-16T00:01:10+09:00');h.events=[];h.loads=[];h.settingsGate=deferred();h.manualGate=deferred();h.savedId='saved-selected-day';
  h.setHidden(false);await flush();
  assert.deepEqual(h.storeSelections.settings,['2026-09-15']);assert.deepEqual(h.storeSelections.manual,['2026-09-15T00:00','2026-09-16T00:00']);
  assert.deepEqual(h.events,['settings.load','manual.load']);h.tick(0);await flush();
  assert.equal(h.loads.length,1);assert.equal(h.controller.getResult(),null);assert.equal(h.posts.length,0);
  h.settingsGate.resolve();await flush();assert.equal(h.controller.getResult(),null);
  h.manualGate.resolve();await flush();const r=h.controller.getResult();assert.ok(r);
  assert.equal(r.period.startLocal,'2026-09-15T00:00');assert.equal(r.units.unit1.calorifics.coal,6000);assert.equal(r.units.unit1.calorifics.bio,3000);
  assert.equal(r.units.unit1.organic.quantity,3);assert.equal(r.units.unit1.manure.quantity,5);assert.equal(r.units.unit2.organic.quantity,7);assert.equal(r.units.unit2.manure.quantity,11);
  assert.equal(h.posts.length,0);h.controller.dispose();
});
