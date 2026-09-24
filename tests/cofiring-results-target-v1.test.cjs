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
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  removeAttribute(key){delete this.attributes[key];}
  focus(){}
  closest(){return null;}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  async fire(type,extra={}){for(const fn of this.listeners[type]||[])await fn({target:this,preventDefault(){},...extra});}
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function blank(){return {unit1:{organic:null,manure:null},unit2:{organic:null,manure:null}};}
function fixtureReference(spec){
  const p=core.periodRange(spec.startLocal,spec.endLocal,spec.stepUnit,spec.stepValue);
  return {kind:'cofiring_period_summary_v1',schemaVersion:1,...spec,summaries:core.requiredSeries.map(d=>({key:d.id,unit:d.unit,fuel:d.fuel,tag:d.queryTag,startValue:100,endValue:112,min:100,max:112,delta:12,usageTon:12,startQuality:'Good',endQuality:'Good',startTime:p.start,endTime:p.end,durationGoodSeconds:p.durationMinutes*60,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}))};
}
function mounted({savedId=null,now='2026-09-15T04:02:00Z',storage=null}={}){
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
  const context=vm.createContext({Date:FixedDate,console,localStorage:storage,MutationObserver:class {constructor(fn){h.visibilityChanged=fn;}observe(){}disconnect(){}},performance:{now:()=>h.clock},CofiringCore:core,CofiringLive:{createPeriod:options=>{liveOptions=options;return live;}},CofiringCalculationSettingsStorage:{create:options=>store('settings',options)},CofiringPeriodManualStorage:{blank,parseValue:v=>v===''?null:Number(v),create:options=>store('manual',options)},CofiringPeriodAdjustmentV56:{create:()=>null},CofiringTargetReferenceV6:{forUnit:()=>null},getShiftLogAuthHeaders:()=>({Authorization:h.auth}),document:{readyState:'loading',addEventListener(){},getElementById:()=>null},navigator:{userAgent:'desktop'},location:{pathname:'/maintenance/'},setTimeout:setTimer,clearTimeout:clearTimer,requestAnimationFrame:f=>{const id=++serial;h.frames.set(id,f);return id;},cancelAnimationFrame:id=>h.frames.delete(id),confirm:()=>true});
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


// New cases deliberately keep measured results separate from the planning target.
const KEY='gs-shift-log.cofiring.bio-target-percent.v1';
function memoryStorage(initial=null){let value=initial;return {getItem:key=>key===KEY?value:null,setItem(key,next){assert.equal(key,KEY);value=next;},value:()=>value};}
const targetUnit=()=>({coal:{quantity:120,coefficient:1.5,complete:true},bio:{quantity:20,coefficient:1.25,complete:true},calorifics:{coal:6000,bio:4000}});
const partial={startLocal:'2026-09-15T00:00',endLocal:'2026-09-15T12:00'};
const at=Date.parse('2026-09-15T12:10:00+09:00');

test('editable Bio goal reconstructs each requested heat ratio without changing corrected quantities',()=>{
  const unit=targetUnit(),before=comparable(unit);let previous=0;
  for(const targetPercent of [15,25,30.5,45]){
    const r=deadline.forUnit(unit,partial,{now:at,targetPercent});assert.equal(r.ready,true);assert.equal(r.targetPercent,targetPercent);
    const bio=unit.bio.quantity+r.targetBioTonPerHour*r.remainingHours;
    const coal=unit.coal.quantity+r.coalTonPerHour*r.remainingHours;
    assert.ok(Math.abs(100*bio*4000/(coal*6000+bio*4000)-targetPercent)<1e-9);
    assert.ok(Math.abs(r.targetMeasuredBioTonPerHour*1.25-r.targetBioTonPerHour)<1e-9);
    assert.ok(r.targetBioTonPerHour>previous);previous=r.targetBioTonPerHour;
  }
  assert.deepEqual(unit,before);
  assert.deepEqual(deadline.forUnit(unit,partial,{now:at}),deadline.forUnit(unit,partial,{now:at,targetPercent:25}));
});
test('editable Bio goal validates numeric bounds and keeps closed/missing-data protections',()=>{
  for(const targetPercent of [0,100,-1,100.01,NaN,Infinity,null,'30',true,undefined]){
    const r=deadline.forUnit(targetUnit(),partial,{now:at,targetPercent});assert.equal(r.status,'invalid_target');assert.equal(r.ready,false);assert.equal(r.targetBioTonPerHour,null);
  }
  assert.equal(deadline.forUnit(targetUnit(),partial,{now:at,targetPercent:0.01}).targetBioTonPerHour,0);
  assert.equal(deadline.forUnit(targetUnit(),partial,{now:at,targetPercent:99.99}).ready,true);
  const r=deadline.forUnit(targetUnit(),partial,{now:at,targetPercent:1});assert.equal(r.status,'above_target');assert.match(r.message,/1%/);
  assert.equal(deadline.forUnit(null,partial,{now:at,targetPercent:30}).status,'incomplete_data');
  assert.equal(deadline.forUnit(targetUnit(),partial,{now:at+24*3600000,targetPercent:30}).status,'closed');
});
test('editable Bio goal applies to both units, updates labels, and changes only future feed rates without network traffic',async()=>{
  const storage=memoryStorage(),h=mounted({savedId:'goal-test',now:'2026-09-15T12:10:00+09:00',storage});await h.ready();
  await selectPeriod(h,partial.startLocal,partial.endLocal);await h.find('cfv5-query').fire('click');
  const before=comparable(h.controller.getDisplayResult());assert.ok(before);
  const loads=h.loads.length,posts=h.posts.length;
  const input=h.find('cfv-target-input');input.value='30.5';await input.fire('input');
  assert.match(summary(h),/25% 목표/);assert.equal(storage.value(),null);
  await input.fire('keydown',{key:'Enter'});
  assert.equal(storage.value(),'30.5');assert.equal(h.find('cfv-target-label').textContent,'30.5%');
  assert.equal((summary(h).match(/30\.5% 목표/g)||[]).length,2);
  for(const unit of ['unit1','unit2']){
    const expected=deadline.forUnit(before.units[unit],before.period,{now:h.now,targetPercent:30.5});assert.equal(expected.ready,true);
    assert.ok(summary(h).includes(format(expected.targetBioTonPerHour)),summary(h));
  }
  assert.deepEqual(comparable(h.controller.getDisplayResult()),before);assert.equal(h.loads.length,loads);assert.equal(h.posts.length,posts);
  h.tick(60000);assert.match(summary(h),/30\.5% 목표/);
  for(const value of ['', '0', '100', '25.555', '-2','no']){
    input.value=value;await h.find('cfv-target-apply').fire('click');assert.equal(storage.value(),'30.5');assert.match(summary(h),/30\.5% 목표/);assert.equal(input.getAttribute('aria-invalid'),'true');
  }
  h.controller.dispose();
  const reopened=mounted({storage});await reopened.ready();assert.equal(reopened.find('cfv-target-input').value,'30.5');assert.match(summary(reopened),/30\.5% 목표/);reopened.controller.dispose();
});
test('editable Bio goal falls back for corrupt storage and works when browser storage is blocked',async()=>{
  for(const storage of [memoryStorage('100'),memoryStorage('bad'),{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}]){
    const h=mounted({storage});await h.ready();assert.equal(h.find('cfv-target-input').value,'25');h.find('cfv-target-input').value='28';await h.find('cfv-target-apply').fire('click');assert.match(summary(h),/28% 목표/);h.controller.dispose();
  }
});
test('editable Bio goal never revives a target invalidated by settings or a closed date',async()=>{
  const h=mounted({savedId:'goal-guards',now:'2026-09-15T12:10:00+09:00'});await h.ready();await selectPeriod(h,partial.startLocal,partial.endLocal);await h.find('cfv5-query').fire('click');
  const bio=h.find('cfv5-calorific="unit1:bio"');bio.value='0';await bio.fire('input');
  h.find('cfv-target-input').value='30';await h.find('cfv-target-apply').fire('click');assert.doesNotMatch(summary(h),/data-cfv6-target-bio>\s*\d/);
  bio.value='3200';await bio.fire('input');await bio.fire('change');assert.match(summary(h),/30% 목표/);assert.match(summary(h),/data-cfv6-target-bio>\s*\d/);
  h.now=Date.parse('2026-09-16T00:01:00+09:00');h.tick(60000);h.find('cfv-target-input').value='35';await h.find('cfv-target-apply').fire('click');
  assert.match(summary(h),/마감 완료/);assert.doesNotMatch(summary(h),/data-cfv6-target-bio>\s*\d/);h.controller.dispose();
});
