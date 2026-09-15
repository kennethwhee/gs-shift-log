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
  h.ready=async()=>{await flush();if([...h.timers.values()].some(t=>t.ms===0))h.tick(0);await flush();h.loads=[];h.events=[];};
  return h;
}

const exportedContext=vm.createContext({CofiringCore:core,CofiringPeriodAdjustmentV56:{}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-deadline-target-v1.js'),'utf8'),exportedContext);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8'),exportedContext);
const ui=exportedContext.CofiringPeriodV5;
const deadline=require('../maintenance/cofiring-deadline-target-v1.js');
function comparable(value){return JSON.parse(JSON.stringify(value));}
function scope(startLocal,endLocal){return {startLocal,endLocal,stepUnit:'minute',stepValue:1};}
async function selectPeriod(h,start,end){
  h.find('cfv8-start').value=start;h.find('cfv8-end').value=end;h.find('cfv8-mode').value='period';
  await h.find('cfv8-mode').fire('change');await flush();
}
function summary(h){return h.find('cfv52-summary-grid').innerHTML;}
function format(value){return value.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});}

test('custom period keeps exact requested endpoints, uses minute intervals and pads query by one minute',()=>{
  const p=ui.customSpec('2026-09-14T07:15','2026-09-15T11:40');
  assert.equal(p.startLocal,'2026-09-14T07:15');assert.equal(p.endLocal,'2026-09-15T11:40');
  assert.equal(p.queryEnd,'2026-09-15T11:41:00+09:00');assert.equal(p.durationMinutes,1705);
  assert.equal(p.stepUnit,'minute');assert.equal(p.stepValue,1);
});
test('custom period accepts month/year/leap boundaries and exactly 31 days but rejects invalid dates or duration',()=>{
  for(const [start,end] of [['2026-09-30T23:59','2026-10-01T00:01'],['2026-12-31T23:59','2027-01-01T00:01'],['2028-02-29T23:59','2028-03-01T00:01']])assert.equal(ui.customSpec(start,end).durationMinutes,2);
  assert.equal(ui.customSpec('2026-01-01T00:00','2026-02-01T00:00').durationHours,744);
  for(const [start,end] of [['2026-01-01T00:00','2026-02-01T00:01'],['2026-02-29T00:00','2026-03-01T01:00'],['2026-09-15T12:00','2026-09-15T12:00'],['2026-09-15T13:00','2026-09-15T12:00'],['2026-09-15T00:00:00','2026-09-15T01:00'],['2020-12-31T23:59','2021-01-01T01:00'],['','2026-09-15T01:00']])assert.throws(()=>ui.customSpec(start,end),start+' ~ '+end);
});
test('custom range and today shortcut use Korean time independently of the computer timezone',()=>{
  const {spawnSync}=require('node:child_process'),file=path.resolve(__dirname,'../maintenance/cofiring-period-ui-v5.js');
  const program=`const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const c=vm.createContext({CofiringCore:require(path.join(path.dirname(${JSON.stringify(file)}),'cofiring-core.js')),CofiringPeriodAdjustmentV56:{}});vm.runInContext(fs.readFileSync(${JSON.stringify(file)},'utf8'),c);console.log(JSON.stringify([c.CofiringPeriodV5.customSpec('2026-09-30T22:30','2026-10-01T01:15'),c.CofiringPeriodV5.currentDaySpec(Date.parse('2026-09-15T04:02:59.999Z'))]));`;
  const values=['UTC','Asia/Seoul','America/Los_Angeles'].map(TZ=>{const r=spawnSync(process.execPath,['-e',program],{env:{...process.env,TZ},encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;});
  assert.equal(new Set(values).size,1);
  const latest=JSON.parse(values[0])[1];assert.equal(latest.startLocal,'2026-09-15T00:00');assert.equal(latest.endLocal,'2026-09-15T13:01');assert.equal(latest.queryEnd,'2026-09-15T13:02:00+09:00');
});
test('a selected custom period loads the same manual range and posts exactly that scope only on Calculate',async()=>{
  const h=mounted();await h.ready();await selectPeriod(h,'2026-09-13T07:00','2026-09-14T19:00');
  const expected=scope('2026-09-13T07:00','2026-09-14T19:00');
  assert.deepEqual(comparable(h.controller.getSpec()),expected);assert.deepEqual(h.storeSelections.settings,['2026-09-13']);
  assert.deepEqual(h.storeSelections.manual,['2026-09-13T07:00','2026-09-14T19:00']);assert.equal(h.posts.length,0);
  assert.equal(h.find('cfv8-daily-fields').hidden,true);assert.equal(h.find('cfv8-period-fields').hidden,false);
  await h.find('cfv5-query').fire('click');assert.equal(h.posts.length,1);assert.deepEqual(comparable(h.posts[0].spec),expected);
  assert.equal(h.find('cfv7-daily-window').textContent,'2026-09-13 07:00 ~ 2026-09-14 19:01');h.controller.dispose();
});
test('future custom query boundary blocks both Calculate and Requery without any prerequisite reads',async()=>{
  const h=mounted({now:'2026-09-15T13:00:59.999+09:00'});await h.ready();h.events=[];h.loads=[];
  await selectPeriod(h,'2026-09-15T00:00','2026-09-15T13:00');
  await h.find('cfv5-query').fire('click');await h.find('cfv5-requery').fire('click');
  assert.equal(h.posts.length,0);assert.equal(h.loads.length,0);assert.deepEqual(h.events,[]);assert.equal(h.find('cfv5-query').disabled,true);
  assert.match(h.find('cfv5-status').textContent,/2026-09-15 13:01/);
  h.now=Date.parse('2026-09-15T13:01:00+09:00');assert.equal(h.ui.selectedAvailability({querySelector:sel=>({'[data-cfv8-mode]':h.find('cfv8-mode'),'[data-cfv8-start]':h.find('cfv8-start'),'[data-cfv8-end]':h.find('cfv8-end')})[sel]},h.now).ready,true);h.controller.dispose();
});
test('switching from daily to a custom period during click prerequisites cancels the original request',async()=>{
  const h=mounted();await h.ready();h.loadGate=deferred();const click=h.find('cfv5-query').fire('click');await flush();
  h.find('cfv8-start').value='2026-09-14T07:00';h.find('cfv8-end').value='2026-09-14T19:00';h.find('cfv8-mode').value='period';
  const changed=h.find('cfv8-mode').fire('change');await flush();h.loadGate.resolve();await Promise.all([click,changed]);
  assert.equal(h.posts.length,0);assert.equal(h.timing.state().status,'cancelled');assert.deepEqual(comparable(h.controller.getSpec()),scope('2026-09-14T07:00','2026-09-14T19:00'));h.controller.dispose();
});
test('changing the custom end while click prerequisites are pending cannot submit either period',async()=>{
  const h=mounted();await h.ready();await selectPeriod(h,'2026-09-15T00:00','2026-09-15T12:00');
  h.loadGate=deferred();const click=h.find('cfv5-query').fire('click');await flush();h.find('cfv8-end').value='2026-09-15T11:00';
  const changed=h.find('cfv8-end').fire('change');await flush();h.loadGate.resolve();await Promise.all([click,changed]);
  assert.equal(h.posts.length,0);assert.equal(h.timing.state().status,'cancelled');assert.equal(h.controller.getSpec().endLocal,'2026-09-15T11:00');h.controller.dispose();
});
test('today shortcut sets midnight through the last fully available minute without issuing DataPARC requests',async()=>{
  const h=mounted({now:'2026-09-15T13:02:59.999+09:00'});await h.ready();
  await h.find('cfv8-today').fire('click');await flush();const expected=scope('2026-09-15T00:00','2026-09-15T13:01');
  assert.equal(h.find('cfv8-mode').value,'period');assert.deepEqual(comparable(h.controller.getSpec()),expected);assert.equal(h.posts.length,0);
  assert.equal(h.find('cfv7-daily-window').textContent,'2026-09-15 00:00 ~ 2026-09-15 13:02');
  h.now=Date.parse('2026-09-15T17:40:00+09:00');await h.find('cfv5-query').fire('click');assert.equal(h.posts.length,1);assert.deepEqual(comparable(h.posts[0].spec),expected);h.controller.dispose();
});
test('today shortcut cannot construct an empty or previous-day interval at 00:00 or 00:01',()=>{
  for(const now of ['2026-09-16T00:00:00+09:00','2026-09-16T00:00:59.999+09:00','2026-09-16T00:01:00+09:00','2026-09-16T00:01:59.999+09:00'])assert.throws(()=>ui.currentDaySpec(Date.parse(now)));
  const p=ui.currentDaySpec(Date.parse('2026-09-16T00:02:00+09:00'));assert.equal(p.startLocal,'2026-09-16T00:00');assert.equal(p.endLocal,'2026-09-16T00:01');assert.equal(p.durationMinutes,1);
});
test('returning to daily mode restores the selected date with its full day and original store scope',async()=>{
  const h=mounted();await h.ready();h.find('cfv7-date').value='2026-09-13';await h.find('cfv7-date').fire('change');
  await selectPeriod(h,'2026-09-15T07:00','2026-09-15T12:00');h.find('cfv8-mode').value='daily';await h.find('cfv8-mode').fire('change');
  assert.equal(h.find('cfv7-date').value,'2026-09-13');assert.deepEqual(comparable(h.controller.getSpec()),scope('2026-09-13T00:00','2026-09-14T00:00'));
  assert.deepEqual(h.storeSelections.manual,['2026-09-13T00:00','2026-09-14T00:00']);assert.equal(h.find('cfv8-daily-fields').hidden,false);assert.equal(h.find('cfv8-period-fields').hidden,true);assert.equal(h.posts.length,0);h.controller.dispose();
});
test('real partial-day calculation renders deadline Bio rate with a separate measured-feed conversion',async()=>{
  const h=mounted({savedId:'saved-partial',now:'2026-09-15T12:10:00+09:00'});await h.ready();
  h.find('cfv7-date').value='2026-09-14';await h.find('cfv7-date').fire('change');
  const settings=comparable(h.controller.settings.defaults());settings.unit1.coal.coefficient=1.1;settings.unit1.bio.coefficient=1.2;h.settingsByDate['2026-09-15']=settings;
  await selectPeriod(h,'2026-09-15T00:00','2026-09-15T12:00');await h.find('cfv5-query').fire('click');
  const result=h.controller.getResult(),unit=result.units.unit1,ref=deadline.forUnit(unit,result.period,{now:h.now});
  assert.ok(Math.abs(unit.coal.quantity-52.8)<1e-9);assert.ok(Math.abs(unit.bio.quantity-14.4)<1e-9);assert.equal(ref.ready,true);
  const remaining=12+1/60,coalFinal=52.8+(52.8/12)*remaining,extra=coalFinal*5800/3200/3-14.4,target=extra/remaining;
  assert.ok(Math.abs(ref.targetBioTonPerHour-target)<1e-9);assert.ok(Math.abs(ref.targetMeasuredBioTonPerHour-target/1.2)<1e-9);
  const html=summary(h);assert.match(html,/마감까지 Bio 필요 투입량/);assert.ok(html.includes(format(target)),html);assert.ok(html.includes(format(target/1.2)),html);
  assert.match(html,/2026-09-16 00:01/);assert.match(html,/2026-09-15 12:00/);assert.doesNotMatch(html,/동일 열량 기준 Coal|Bio 25% 목표 참고치/);assert.equal(h.posts.length,0);h.controller.dispose();
});
test('closed daily result keeps the actual co-firing result but does not offer a remaining feed rate',async()=>{
  const h=mounted({savedId:'closed-day',now:'2026-09-16T01:00:00+09:00'});await h.ready();h.find('cfv7-date').value='2026-09-15';await h.find('cfv7-date').fire('change');await h.find('cfv5-query').fire('click');
  assert.ok(h.controller.getResult());assert.equal(h.controller.getResult().period.durationHours,24);const html=summary(h);
  assert.match(html,/마감/);assert.doesNotMatch(html,/data-cfv6-target-bio>\s*\d/);assert.doesNotMatch(html,/Bio 25% 목표 참고치/);h.controller.dispose();
});
test('a non-midnight or multiple-day result computes selected usage without claiming a daily deadline target',async()=>{
  const h=mounted({savedId:'saved-window',now:'2026-09-15T13:02:00+09:00'});await h.ready();
  for(const [start,end] of [['2026-09-15T07:00','2026-09-15T12:00'],['2026-09-13T00:00','2026-09-15T12:00']]){
    await selectPeriod(h,start,end);await h.find('cfv5-query').fire('click');const result=h.controller.getResult();assert.ok(result);assert.equal(result.period.startLocal,start);assert.equal(result.period.endLocal,end);
    assert.doesNotMatch(summary(h),/data-cfv6-target-bio>\s*\d/);assert.match(summary(h),/00:00|하루|당일/);
  }
  assert.equal(h.posts.length,0);h.controller.dispose();
});

test('changing calculation mode cancels prerequisites even when both modes describe the same endpoints',async()=>{
  const h=mounted();await h.ready();const selected=h.controller.getSpec();h.loadGate=deferred();
  const click=h.find('cfv5-query').fire('click');await flush();h.find('cfv8-start').value=selected.startLocal;h.find('cfv8-end').value=selected.endLocal;h.find('cfv8-mode').value='period';
  const changed=h.find('cfv8-mode').fire('change');await flush();h.loadGate.resolve();await Promise.all([click,changed]);
  assert.deepEqual(comparable(h.controller.getSpec()),comparable(selected));assert.equal(h.posts.length,0);assert.equal(h.timing.state().status,'cancelled');h.controller.dispose();
});

test('the displayed partial-day feed target closes at midnight deadline without a network request',async()=>{
  const h=mounted({savedId:'saved-near-close',now:'2026-09-15T23:59:00+09:00'});await h.ready();
  await selectPeriod(h,'2026-09-15T00:00','2026-09-15T23:58');await h.find('cfv5-query').fire('click');
  assert.match(summary(h),/data-cfv6-target-bio>\s*\d/);const loads=h.loads.length,posts=h.posts.length;
  h.now=Date.parse('2026-09-16T00:01:00+09:00');h.tick(60000);await flush();
  assert.match(summary(h),/마감 완료/);assert.doesNotMatch(summary(h),/data-cfv6-target-bio>\s*\d/);
  assert.equal(h.loads.length,loads);assert.equal(h.posts.length,posts);assert.equal([...h.timers.values()].filter(t=>t.ms===60000).length,0);h.controller.dispose();
});

test('Calculate resumes a stopped active request with one full read and waits for its exact result ID',async()=>{
  const h=mounted({savedId:'previous-saved'});await h.ready();const item=h.live.state().item;
  item.active={id:'accepted-active-request',status:'processing'};item.lastAttempt={...item.active};item.statusStopped=true;
  item.error='자동 상태 확인을 멈췄습니다.';h.emitOld();h.loadGate=deferred();
  const loadOptions=[],read=h.live.load;h.live.load=async options=>{loadOptions.push(comparable(options));const ok=await read(options);item.statusStopped=false;item.error='';return ok;};
  const click=h.find('cfv5-query').fire('click');await flush();
  assert.equal(h.loads.length,1);assert.deepEqual(loadOptions,[{force:true}]);assert.equal(h.posts.length,0);
  assert.equal(h.timing.state().mode,'resume_existing');assert.equal(h.timing.state().status,'running');assert.equal(h.frames.size,0);
  h.loadGate.resolve();await click;assert.equal(h.loads.length,1);assert.equal(h.posts.length,0);
  assert.equal(item.statusStopped,false);assert.equal(h.timing.state().expectedRequestId,'accepted-active-request');
  h.emitOld();assert.equal(h.timing.state().status,'running');assert.equal(h.frames.size,0);
  h.complete('previous-saved');assert.equal(h.timing.state().status,'running');assert.equal(h.frames.size,0);
  h.complete('accepted-active-request');assert.equal(h.timing.state().status,'finishing');h.frame();h.frame();
  assert.equal(h.timing.state().status,'complete');assert.equal(h.timing.state().requestId,'accepted-active-request');assert.equal(h.timing.state().source,'resume_existing');
  assert.equal(h.loads.length,1);assert.equal(h.posts.length,0);h.controller.dispose();
});

test('invalid Bio calorific input clears the target and cannot revive it through store or visibility callbacks',async()=>{
  const h=mounted({savedId:'saved-partial-inputs',now:'2026-09-15T12:10:00+09:00'});await h.ready();
  await selectPeriod(h,'2026-09-15T00:00','2026-09-15T12:00');await h.find('cfv5-query').fire('click');
  const rateShown=()=>/data-cfv6-target-bio>\s*\d/.test(summary(h));
  const refreshTimers=()=>[...h.timers.values()].filter(t=>t.ms===60000);
  assert.equal(rateShown(),true);assert.equal(refreshTimers().length,1);const queuedRefresh=refreshTimers()[0].f;
  const bioCV=h.find('cfv5-calorific="unit1:bio"');bioCV.value='0';await bioCV.fire('input');
  assert.equal(rateShown(),false);assert.match(h.find('cfv5-status').textContent,/Bio.*발열량|입력/);assert.equal(refreshTimers().length,0);
  queuedRefresh();assert.equal(rateShown(),false);assert.equal(refreshTimers().length,0);
  await h.controller.manual.load();assert.equal(rateShown(),false);assert.equal(refreshTimers().length,0);
  h.setHidden(true);h.setHidden(false);await flush();assert.equal(rateShown(),false);assert.equal(refreshTimers().length,0);
  bioCV.value='3200';await bioCV.fire('input');assert.equal(rateShown(),true);assert.equal(refreshTimers().length,1);
  bioCV.value='';await bioCV.fire('input');assert.equal(rateShown(),false);assert.equal(refreshTimers().length,0);
  bioCV.value='3200';await bioCV.fire('input');assert.equal(rateShown(),true);assert.equal(refreshTimers().length,1);
  assert.equal(h.posts.length,0);h.controller.dispose();
});
