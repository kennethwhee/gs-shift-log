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
function mounted({savedId=null,now='2026-09-15T04:02:00Z'}={}){
  const h={hidden:false,settingsByDate:{},manualByStart:{},manualByRange:{},storeSelections:{},now:Date.parse(now),auth:'Bearer test-user-a',settingsGate:null,manualGate:null,loadGate:null,queryGate:null,savedId,loads:[],posts:[],events:[],clock:100,timers:new Map(),frames:new Map(),timing:null};
  let serial=0,liveOptions,liveState={authenticated:true,canQuery:true,period:null,item:{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''}};
  const container=new Element(),view={};container.closest=selector=>selector==='[data-efficiency-view]'?view:selector.includes('[hidden]')&&h.hidden?view:null;
  const settings={};for(const unit of ['unit1','unit2']){settings[unit]={};for(const fuel of ['coal','bio','organic','manure'])settings[unit][fuel]={calorific:fuel==='coal'?5800:fuel==='bio'?3200:3400,coefficient:1};}
  function store(kind,options){
    let selected=null;
    const state={loaded:false,loading:false,saving:false,error:'',canEdit:true,settings,values:blank(),revision:0};
    return {state:()=>state,defaults:()=>settings,select(...values){h.storeSelections[kind]=values;const next=JSON.stringify(values);if(next!==selected){selected=next;state.loaded=false;state.settings=h.settingsByDate[values[0]]||settings;state.values=h.manualByRange[values.join('|')]||blank();}},async load(){h.events.push(kind+'.load');state.loading=true;const gate=h[kind+'Gate'];if(gate)await gate.promise;state.loaded=true;state.loading=false;options.onChange();return true;},dispose(){},save:async()=>true};
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
  h.ready=async()=>{await flush();if([...h.timers.values()].some(t=>t.ms===0))h.tick(0);await flush();h.loads=[];h.events=[];};
  return h;
}

const exportedContext=vm.createContext({CofiringCore:core,CofiringPeriodAdjustmentV56:{}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8'),exportedContext);
const ui=exportedContext.CofiringPeriodV5;
function comparable(value){return JSON.parse(JSON.stringify(value));}
function scope(startLocal,endLocal){return {startLocal,endLocal,stepUnit:'minute',stepValue:1};}
function summary(h){return h.find('cfv52-summary-grid').innerHTML;}
function finish(h,id){h.complete(id);h.frame();h.frame();assert.equal(h.timing.state().status,'complete');}

test('daily selection defaults to today KST and resolves today cumulative, past full day, and future first minute',()=>{
  const now=Date.parse('2026-09-16T13:02:59.999+09:00');assert.equal(ui.defaultCalculationDate(now),'2026-09-16');
  const today=ui.dailySelectionSpec('2026-09-16',now),past=ui.dailySelectionSpec('2026-09-15',now),future=ui.dailySelectionSpec('2026-09-17',now);
  assert.equal(today.startLocal,'2026-09-16T00:00');assert.equal(today.endLocal,'2026-09-16T13:01');assert.equal(today.queryEnd,'2026-09-16T13:02:00+09:00');
  assert.equal(past.endLocal,'2026-09-16T00:00');assert.equal(past.durationHours,24);assert.equal(past.queryEnd,'2026-09-16T00:01:00+09:00');
  assert.equal(future.startLocal,'2026-09-17T00:00');assert.equal(future.endLocal,'2026-09-17T00:01');assert.equal(future.queryEnd,'2026-09-17T00:02:00+09:00');
});

test('current daily boundaries and midnight date are independent of the browser computer timezone',()=>{
  const {spawnSync}=require('node:child_process'),file=path.resolve(__dirname,'../maintenance/cofiring-period-ui-v5.js');
  const program=`const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const c=vm.createContext({CofiringCore:require(path.join(path.dirname(${JSON.stringify(file)}),'cofiring-core.js')),CofiringPeriodAdjustmentV56:{}});vm.runInContext(fs.readFileSync(${JSON.stringify(file)},'utf8'),c);const ui=c.CofiringPeriodV5;console.log(JSON.stringify([ui.defaultCalculationDate(Date.parse('2026-09-15T15:00:00Z')),ui.dailySelectionSpec('2026-09-16',Date.parse('2026-09-16T04:02:59.999Z'))]));`;
  const values=['UTC','Asia/Seoul','America/Los_Angeles'].map(TZ=>{const r=spawnSync(process.execPath,['-e',program],{env:{...process.env,TZ},encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;});
  assert.equal(new Set(values).size,1);const [date,p]=JSON.parse(values[0]);assert.equal(date,'2026-09-16');assert.equal(p.endLocal,'2026-09-16T13:01');
});

test('today date calculates the current cumulative result and deadline Bio rate without selecting custom mode',async()=>{
  const h=mounted({now:'2026-09-16T13:02:59.999+09:00'});await h.ready();
  assert.equal(h.find('cfv7-date').value,'2026-09-16');assert.equal(h.find('cfv5-query').disabled,false);assert.equal(h.posts.length,0);
  h.now=Date.parse('2026-09-16T13:05:40+09:00');await h.find('cfv5-query').fire('click');
  const expected=scope('2026-09-16T00:00','2026-09-16T13:04');assert.equal(h.posts.length,1);assert.deepEqual(comparable(h.posts[0].spec),expected);
  assert.deepEqual(h.storeSelections.manual,['2026-09-16T00:00','2026-09-16T13:04']);
  assert.equal(h.find('cfv7-daily-window').textContent,'2026-09-16 00:00 ~ 2026-09-16 13:05');
  finish(h,'request-1');const result=h.controller.getResult(),hours=13+4/60;
  assert.equal(result.period.durationHours,hours);assert.ok(Math.abs(result.units.unit1.coal.averageTonPerHour-48/hours)<1e-9);
  assert.match(summary(h),/data-cfv6-target-bio>\s*\d/);assert.match(summary(h),/2026-09-17 00:01/);assert.match(summary(h),/2026-09-16 13:04/);
  assert.doesNotMatch(h.find('cfv5-status').textContent,/마감되지|이후 계산/);h.controller.dispose();
});

test('passing several minutes during parallel prerequisites cannot move or cancel the clicked daily interval',async()=>{
  const h=mounted({now:'2026-09-16T13:02:00+09:00'});await h.ready();h.settingsGate=deferred();h.manualGate=deferred();h.loadGate=deferred();
  h.now=Date.parse('2026-09-16T13:05:00+09:00');const click=h.find('cfv5-query').fire('click');await flush();
  const expected=scope('2026-09-16T00:00','2026-09-16T13:04');assert.deepEqual(comparable(h.controller.getSpec()),expected);
  assert.equal(h.posts.length,0);h.now=Date.parse('2026-09-16T13:08:00+09:00');h.tick(200);await flush();
  assert.equal(h.timing.state().status,'running');h.loadGate.resolve();h.settingsGate.resolve();await flush();assert.equal(h.posts.length,0);
  h.manualGate.resolve();await click;assert.equal(h.posts.length,1);assert.deepEqual(comparable(h.posts[0].spec),expected);
  finish(h,'request-1');assert.deepEqual(comparable(h.controller.getSpec()),expected);assert.equal(h.controller.getResult().period.endLocal,'2026-09-16T13:04');h.controller.dispose();
});

test('active request state checks keep the accepted daily interval after clock advances',async()=>{
  const h=mounted({now:'2026-09-16T13:02:00+09:00'});await h.ready();await h.find('cfv5-query').fire('click');const expected=comparable(h.posts[0].spec);
  h.now=Date.parse('2026-09-16T14:00:00+09:00');await h.find('cfv5-query').fire('click');
  assert.equal(h.posts.length,1);assert.deepEqual(comparable(h.controller.getSpec()),expected);assert.equal(h.timing.state().expectedRequestId,'request-1');
  finish(h,'request-1');assert.equal(h.controller.getResult().period.endLocal,'2026-09-16T13:01');h.controller.dispose();
});

test('the next Calculate refreshes today endpoint and cannot reuse the old shorter result',async()=>{
  const h=mounted({now:'2026-09-16T13:02:00+09:00'});await h.ready();await h.find('cfv5-query').fire('click');finish(h,'request-1');
  h.now=Date.parse('2026-09-16T13:10:00+09:00');await h.find('cfv5-query').fire('click');
  assert.equal(h.posts.length,2);assert.deepEqual(comparable(h.posts[1].spec),scope('2026-09-16T00:00','2026-09-16T13:09'));
  assert.equal(h.timing.state().status,'running');assert.equal(h.frames.size,0);finish(h,'request-2');assert.equal(h.controller.getResult().period.endLocal,'2026-09-16T13:09');h.controller.dispose();
});

test('Requery also refreshes today endpoint and forces exactly the new current range',async()=>{
  const h=mounted({now:'2026-09-16T13:02:00+09:00'});await h.ready();await h.find('cfv5-query').fire('click');finish(h,'request-1');
  h.now=Date.parse('2026-09-16T13:10:00+09:00');await h.find('cfv5-requery').fire('click');
  assert.equal(h.posts.length,2);assert.equal(h.posts[1].force,true);assert.deepEqual(comparable(h.posts[1].spec),scope('2026-09-16T00:00','2026-09-16T13:09'));
  finish(h,'request-2');h.controller.dispose();
});

test('passive target refresh, hiding, and reopening do not change today result range or issue a new request',async()=>{
  const h=mounted({now:'2026-09-16T13:02:00+09:00'});await h.ready();await h.find('cfv5-query').fire('click');finish(h,'request-1');
  const expected=comparable(h.controller.getSpec()),loads=h.loads.length,posts=h.posts.length;
  h.now=Date.parse('2026-09-16T13:10:00+09:00');h.tick(60000);await flush();
  assert.deepEqual(comparable(h.controller.getSpec()),expected);assert.equal(h.loads.length,loads);assert.equal(h.posts.length,posts);
  h.setHidden(true);h.setHidden(false);await flush();assert.deepEqual(comparable(h.controller.getSpec()),expected);assert.equal(h.posts.length,posts);
  assert.equal(h.controller.getResult().period.endLocal,'2026-09-16T13:01');h.controller.dispose();
});

test('a selected today becomes its complete historical day on the first click after next 00:01',async()=>{
  const h=mounted({now:'2026-09-16T23:59:00+09:00'});await h.ready();await h.find('cfv5-query').fire('click');finish(h,'request-1');
  h.now=Date.parse('2026-09-17T00:01:00+09:00');await h.find('cfv5-query').fire('click');
  assert.equal(h.find('cfv7-date').value,'2026-09-16');assert.equal(h.posts.length,2);
  assert.deepEqual(comparable(h.posts[1].spec),scope('2026-09-16T00:00','2026-09-17T00:00'));finish(h,'request-2');
  assert.equal(h.controller.getResult().period.durationHours,24);assert.match(summary(h),/마감 완료/);assert.doesNotMatch(summary(h),/data-cfv6-target-bio>\s*\d/);h.controller.dispose();
});

test('a calculation started before midnight completes with its accepted prefix after midnight',async()=>{
  const h=mounted({now:'2026-09-16T23:59:00+09:00'});await h.ready();h.loadGate=deferred();const click=h.find('cfv5-query').fire('click');await flush();
  h.now=Date.parse('2026-09-17T00:02:00+09:00');h.tick(200);h.loadGate.resolve();await click;
  assert.equal(h.posts.length,1);assert.equal(h.posts[0].spec.endLocal,'2026-09-16T23:58');finish(h,'request-1');
  assert.equal(h.controller.getResult().period.endLocal,'2026-09-16T23:58');assert.match(summary(h),/마감 완료/);h.controller.dispose();
});

test('today only waits until 00:02 for the first complete minute and never until the following day',async()=>{
  for(const now of ['2026-09-16T00:00:00+09:00','2026-09-16T00:01:59.999+09:00']){
    const h=mounted({now});await h.ready();assert.equal(h.find('cfv7-date').value,'2026-09-16');
    assert.equal(h.find('cfv5-query').disabled,true);assert.deepEqual(comparable(h.controller.getSpec()),scope('2026-09-16T00:00','2026-09-16T00:01'));
    assert.match(h.find('cfv5-status').textContent,/2026-09-16 00:02/);assert.doesNotMatch(h.find('cfv5-status').textContent,/2026-09-17/);
    await h.find('cfv5-query').fire('click');assert.equal(h.posts.length,0);assert.equal(h.loads.length,0);h.controller.dispose();
  }
  const h=mounted({now:'2026-09-16T00:02:00+09:00'});await h.ready();assert.equal(h.find('cfv5-query').disabled,false);
  await h.find('cfv5-query').fire('click');assert.equal(h.posts.length,1);assert.equal(h.posts[0].spec.endLocal,'2026-09-16T00:01');h.controller.dispose();
});

test('changing daily date clears prior elapsed display and blocks late completion from that old date',async()=>{
  const h=mounted({now:'2026-09-16T13:02:00+09:00'});await h.ready();await h.find('cfv5-query').fire('click');finish(h,'request-1');
  const old=fixtureReference(h.controller.getSpec());assert.equal(h.find('cfv7-click-timing').hidden,false);
  h.find('cfv7-date').value='2026-09-17';await h.find('cfv7-date').fire('change');h.emitReference(old);
  assert.equal(h.find('cfv7-click-timing').hidden,true);assert.equal(h.find('cfv7-click-timing').textContent,'');
  assert.equal(h.controller.getResult(),null);assert.equal(h.find('cfv5-query').disabled,true);assert.equal(h.posts.length,1);h.controller.dispose();
});

test('custom period remains fixed on later Calculate while daily mode refreshes its selected today',async()=>{
  const h=mounted({now:'2026-09-16T13:02:00+09:00'});await h.ready();h.find('cfv8-mode').value='period';h.find('cfv8-start').value='2026-09-16T07:00';h.find('cfv8-end').value='2026-09-16T12:00';await h.find('cfv8-mode').fire('change');
  h.now=Date.parse('2026-09-16T15:30:00+09:00');await h.find('cfv5-query').fire('click');assert.deepEqual(comparable(h.posts[0].spec),scope('2026-09-16T07:00','2026-09-16T12:00'));finish(h,'request-1');
  h.find('cfv8-mode').value='daily';await h.find('cfv8-mode').fire('change');assert.equal(h.find('cfv7-click-timing').hidden,true);
  await h.find('cfv5-query').fire('click');assert.deepEqual(comparable(h.posts[1].spec),scope('2026-09-16T00:00','2026-09-16T15:29'));h.controller.dispose();
});

test('unsaved manual usage and calorific edits survive the same-day current range extension',async()=>{
  const h=mounted({savedId:'loaded-current',now:'2026-09-16T13:02:00+09:00'});await h.ready();
  const organic=h.find('cfv5-manual="unit1:organic"'),bioCV=h.find('cfv5-calorific="unit1:bio"');organic.value='23.75';await organic.fire('input');bioCV.value='3550';await bioCV.fire('input');
  h.savedId=null;h.now=Date.parse('2026-09-16T13:10:00+09:00');await h.find('cfv5-query').fire('click');
  assert.equal(h.posts.length,1);assert.deepEqual(h.storeSelections.manual,['2026-09-16T00:00','2026-09-16T13:09']);
  assert.equal(h.find('cfv5-manual="unit1:organic"').value,'23.75');assert.equal(h.find('cfv5-calorific="unit1:bio"').value,'3550');
  finish(h,'request-1');assert.equal(h.controller.getResult().units.unit1.organic.quantity,23.75);assert.equal(h.controller.getResult().units.unit1.calorifics.bio,3550);h.controller.dispose();
});

test('saved manual usage for the old endpoint is not silently reused for a longer current range',async()=>{
  const h=mounted({now:'2026-09-16T13:02:00+09:00'});await h.ready();
  h.manualByRange['2026-09-16T00:00|2026-09-16T13:04']={unit1:{organic:17,manure:3},unit2:{organic:4,manure:5}};
  h.now=Date.parse('2026-09-16T13:05:00+09:00');await h.find('cfv5-query').fire('click');finish(h,'request-1');
  assert.equal(h.controller.getResult().units.unit1.organic.quantity,17);
  h.now=Date.parse('2026-09-16T13:10:00+09:00');await h.find('cfv5-query').fire('click');finish(h,'request-2');
  assert.equal(h.controller.getResult().units.unit1.organic.quantity,0);assert.equal(h.controller.getResult().units.unit1.manure.quantity,0);h.controller.dispose();
});

test('authentication change before today refresh discards the previous user unsaved manual and settings draft',async()=>{
  const h=mounted({now:'2026-09-16T13:02:00+09:00'});await h.ready();
  const organic=h.find('cfv5-manual="unit1:organic"'),bioCV=h.find('cfv5-calorific="unit1:bio"');
  organic.value='23.75';await organic.fire('input');bioCV.value='3550';await bioCV.fire('input');
  h.auth='Bearer replacement-user';h.now=Date.parse('2026-09-16T13:10:00+09:00');
  await h.find('cfv5-query').fire('click');
  assert.equal(h.posts.length,1);assert.equal(h.posts[0].auth,'Bearer replacement-user');
  assert.deepEqual(comparable(h.posts[0].spec),scope('2026-09-16T00:00','2026-09-16T13:09'));
  assert.equal(h.find('cfv5-manual="unit1:organic"').value,'');
  assert.equal(h.find('cfv5-calorific="unit1:bio"').value,'3200');
  finish(h,'request-1');assert.equal(h.controller.getResult().units.unit1.organic.quantity,0);
  assert.equal(h.controller.getResult().units.unit1.calorifics.bio,3200);h.controller.dispose();
});
