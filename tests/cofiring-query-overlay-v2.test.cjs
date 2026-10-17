'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../maintenance/cofiring-core.js');

// Exercise the real mounted UI and click lifecycle. Remote stores, transport
// and selector/visibility events are modeled; calculation uses the real core.
// The fake DOM does not model layout: workspace centering is browser-verified.
const {Element,inventoryReport,receiptFetch}=require('./helpers/cofiring-period-dom.cjs');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function blank(){return {unit1:{organic:null,manure:null},unit2:{organic:null,manure:null}};}
function fixtureReference(spec){
  const p=core.periodRange(spec.startLocal,spec.endLocal,spec.stepUnit,spec.stepValue);
  return {kind:'cofiring_period_summary_v1',schemaVersion:1,...spec,summaries:core.requiredSeries.map(d=>({key:d.id,unit:d.unit,fuel:d.fuel,tag:d.queryTag,startValue:100,endValue:112,min:100,max:112,delta:12,usageTon:12,startQuality:'Good',endQuality:'Good',startTime:p.start,endTime:p.end,durationGoodSeconds:p.durationMinutes*60,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}))};
}
function mounted({savedId=null,agentTiming=null}={}){
  const h={auth:'Bearer test-user-a',settingsGate:null,manualGate:null,loadGate:null,queryGate:null,savedId,loads:[],posts:[],events:[],clock:100,wallTime:Date.parse('2026-09-15T04:02:00Z'),timers:new Map(),frames:new Map(),timing:null};
  let serial=0,liveOptions,liveState={authenticated:true,canQuery:true,period:null,item:{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''}};
  const container=new Element();
  const view=new Element(),modal=new Element(),observers=[];
  h.hidden=false;
  container.closest=selector=>selector==='[hidden], [aria-hidden=\"true\"]'?(h.hidden?view:null):selector==='[data-efficiency-view]'?view:null;
  h.hide=()=>{h.hidden=true;for(const observer of observers)observer.callback();};
  h.show=()=>{h.hidden=false;for(const observer of observers)observer.callback();};
  class MutationObserver{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){observers.splice(observers.indexOf(this),1);}}
  const classes=new Set();
  container.classList={
    add(...names){for(const name of names)classes.add(name);},
    remove(...names){for(const name of names)classes.delete(name);},
    contains:name=>classes.has(name),
    toggle(name,force){const active=force===undefined?!classes.has(name):!!force;if(active)classes.add(name);else classes.delete(name);return active;}
  };
  h.container=container;
  const settings={};for(const unit of ['unit1','unit2']){settings[unit]={};for(const fuel of ['coal','bio','organic','manure'])settings[unit][fuel]={calorific:fuel==='coal'?5800:fuel==='bio'?3200:3400,coefficient:1};}
  function store(kind,options){
    let selected=null;
    const state={loaded:false,loading:false,saving:false,error:'',canEdit:true,settings,values:blank(),revision:0};
    return {state:()=>state,defaults:()=>settings,select(...values){const next=JSON.stringify(values);if(next!==selected){selected=next;state.loaded=false;}},async load(){h.events.push(kind+'.load');state.loading=true;const gate=h[kind+'Gate'];if(gate)await gate.promise;state.loaded=true;state.loading=false;options.onChange();return true;},dispose(){},save:async()=>true};
  }
  function emit(){liveOptions.onChange(liveState);}
  function result(id){return {requestId:id,report:{...inventoryReport(fixtureReference(liveState.period)),queryElapsedSeconds:6.374,workerElapsedSeconds:26.499,timing:{controllerElapsedSeconds:28.155,...(agentTiming?{agent:agentTiming}:{})}}};}
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
  h.processing=()=>{assert.ok(liveState.item.active,'request exists');liveState.item.active.status='processing';liveState.item.active.progress={phase:'reading'};emit();};
  h.fail=message=>{assert.ok(liveState.item.active,'request exists');liveState.item.lastAttempt={...liveState.item.active,status:'failed',errorMessage:message};liveState.item.active=null;emit();};
  const setTimer=(f,ms)=>{const id=++serial;h.timers.set(id,{f,ms});return id;},clearTimer=id=>h.timers.delete(id);
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:[h.wallTime]));}static now(){return h.wallTime;}}
  const context=vm.createContext({Date:FixedDate,URLSearchParams,fetch:receiptFetch,console,performance:{now:()=>h.clock},CofiringCore:core,CofiringLive:{createPeriod:options=>{liveOptions=options;return live;}},CofiringCalculationSettingsStorage:{create:options=>store('settings',options)},CofiringPeriodManualStorage:{blank,parseValue:v=>v===''?null:Number(v),create:options=>store('manual',options)},CofiringPeriodAdjustmentV56:{create:()=>null},CofiringTargetReferenceV6:{forUnit:()=>null},getShiftLogAuthHeaders:()=>({Authorization:h.auth}),document:{readyState:'loading',addEventListener(){},getElementById:id=>id==='efficiencyTeamModal'?modal:null,createElement:()=>new Element(),head:{appendChild(){}}},MutationObserver,navigator:{userAgent:'desktop'},location:{pathname:'/maintenance/'},setTimeout:setTimer,clearTimeout:clearTimer,requestAnimationFrame:f=>{const id=++serial;h.frames.set(id,f);return id;},cancelAnimationFrame:id=>h.frames.delete(id),confirm:()=>true});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-click-timing-v1.js'),'utf8'),context);
  const createTiming=context.CofiringClickTimingV1.create;
  context.CofiringClickTimingV1={create:options=>(h.timing=createTiming(options))};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-deadline-target-v1.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8'),context);
  h.controller=context.CofiringPeriodV5.mount(container);h.find=key=>container.querySelector(`[data-${key}]`);
  h.frame=()=>{const entry=h.frames.entries().next().value;assert.ok(entry,'animation frame scheduled');h.frames.delete(entry[0]);h.clock+=16;entry[1]();};
  h.tick=ms=>{const entry=[...h.timers].find(([,t])=>t.ms===ms);assert.ok(entry,'timer '+ms+' scheduled');h.timers.delete(entry[0]);h.clock+=ms;entry[1].f();};
  h.ready=async()=>{await flush();h.tick(0);await flush();h.loads=[];h.events=[];};
  return h;
}

function overlayState(h,showing){
  assert.equal(h.find('cfv-query-overlay').hidden,!showing,'query overlay visibility');
  assert.equal(h.container.getAttribute('aria-busy'),String(showing),'calculation busy state');
  assert.equal(h.container.classList.contains('cfv-query-overlay-active'),showing,'inline progress suppression');
}

test('query status is singular, has live semantics and stays hidden during automatic saved restoration',async t=>{
  const h=mounted({savedId:'saved-original'});t.after(()=>h.controller.dispose());
  const overlay=h.find('cfv-query-overlay');
  assert.equal(overlay.hidden,true);
  assert.equal(overlay.getAttribute('role'),'status');
  assert.equal(overlay.getAttribute('aria-live'),'polite');
  assert.equal(overlay.getAttribute('aria-atomic'),'true');
  assert.equal(h.find('cfv-query-overlay-elapsed').getAttribute('aria-hidden'),'true','elapsed ticks do not repeatedly announce');
  assert.equal(h.container.querySelectorAll('[data-cfv-query-overlay]').length,1);
  assert.match(h.container.innerHTML,/<span class="cfv-query-overlay__spinner" aria-hidden="true"><\/span>/);
  assert.match(h.container.innerHTML,/<strong class="cfv-query-overlay__title">혼소율을 조회 중입니다<\/strong>/);
  await h.ready();
  assert.equal(overlay.hidden,true);
  assert.equal(h.posts.length,0,'saved restoration does not submit a query');
});

test('Calculate shows progress before its first await, through pending and processing, and until both final paint frames',async t=>{
  const h=mounted();t.after(()=>h.controller.dispose());await h.ready();
  h.settingsGate=deferred();h.manualGate=deferred();h.loadGate=deferred();h.queryGate=deferred();
  const click=h.find('cfv5-query').fire('click');
  overlayState(h,true);
  assert.equal(h.find('cfv-query-overlay-elapsed').textContent,'경과 00:00');
  assert.equal(h.posts.length,0);
  await flush();
  assert.equal(h.loads.length,1);
  h.loadGate.resolve();h.settingsGate.resolve();h.manualGate.resolve();await flush();
  assert.equal(h.live.state().item.submitting,true);overlayState(h,true);
  h.queryGate.resolve();await click;
  assert.equal(h.live.state().item.active.status,'pending');overlayState(h,true);
  assert.match(h.find('cfv-query-overlay-phase').textContent,/회사 PC 대기/);
  h.processing();overlayState(h,true);
  assert.match(h.find('cfv-query-overlay-phase').textContent,/DataPARC 계산 중/);
  h.clock+=65000;h.tick(200);
  assert.equal(h.find('cfv-query-overlay-elapsed').textContent,'경과 01:05');
  h.complete('request-1');
  assert.equal(h.timing.state().status,'finishing');overlayState(h,true);
  assert.match(h.find('cfv-query-overlay-phase').textContent,/화면에 표시/);
  h.frame();overlayState(h,true);
  h.frame();overlayState(h,false);
  assert.equal(h.controller.getResult().units.unit1.coal.quantity,48);
  assert.equal(h.posts.length,1,'progress updates never add requests');
});

test('same-spec cached calculation displays progress even without a date or wall-clock change',async t=>{
  const h=mounted({savedId:'saved-original'});t.after(()=>h.controller.dispose());await h.ready();
  const period=JSON.stringify(h.controller.getSpec()),wallTime=h.wallTime;
  const click=h.find('cfv5-query').fire('click');overlayState(h,true);await click;
  assert.equal(h.wallTime,wallTime);assert.equal(JSON.stringify(h.controller.getSpec()),period);
  assert.equal(h.loads.length,0);assert.equal(h.posts.length,0);
  assert.equal(h.timing.state().status,'finishing');overlayState(h,true);
  h.frame();overlayState(h,true);h.frame();overlayState(h,false);
});

test('forced requery overlays saved values and ignores old or unrelated results',async t=>{
  const h=mounted({savedId:'saved-original'});t.after(()=>h.controller.dispose());await h.ready();
  const oldResult=h.controller.getResult();h.queryGate=deferred();
  const click=h.find('cfv5-requery').fire('click');overlayState(h,true);await flush();
  assert.equal(h.posts[0].force,true);assert.deepEqual(h.controller.getResult(),oldResult);
  h.emitOld();overlayState(h,true);assert.equal(h.frames.size,0);
  h.queryGate.resolve();await click;h.emitOld();overlayState(h,true);
  h.complete('unrelated-request');overlayState(h,true);assert.equal(h.frames.size,0);
  h.complete('request-1');overlayState(h,true);h.frame();h.frame();overlayState(h,false);
});

test('Agent request failure dismisses progress while preserving the failure guidance',async t=>{
  const h=mounted();t.after(()=>h.controller.dispose());await h.ready();
  await h.find('cfv5-query').fire('click');h.processing();overlayState(h,true);
  h.fail('Synthetic DataPARC failure');
  overlayState(h,false);assert.equal(h.timing.state().status,'failed');
  assert.match(h.find('cfv5-status').textContent,/Synthetic DataPARC failure/);
  assert.equal([...h.timers.values()].filter(timer=>timer.ms===200).length,0);
});

test('stopped status polling dismisses progress even when the accepted Agent request remains active',async t=>{
  const h=mounted();t.after(()=>h.controller.dispose());await h.ready();
  await h.find('cfv5-query').fire('click');h.processing();
  const item=h.live.state().item;
  item.error='상태 확인 시간이 초과됐습니다. 자동 확인을 멈췄습니다.';
  item.statusStopped=false;h.emitOld();
  overlayState(h,true);assert.equal(h.timing.state().status,'running','a recoverable polling error is not terminal');
  item.statusStopped=true;h.emitOld();
  assert.ok(item.active,'server request identity is preserved');
  overlayState(h,false);assert.equal(h.timing.state().status,'failed');
  assert.match(h.find('cfv5-status').textContent,/자동 확인을 멈췄습니다/);
});

test('prerequisite and immediate submission failures both dismiss query progress',async t=>{
  for(const mode of ['settings','immediate']){
    await t.test(mode,async t=>{
      const h=mounted();t.after(()=>h.controller.dispose());await h.ready();
      if(mode==='settings')h.controller.settings.state().error='Synthetic settings failure';
      else h.queryImmediateFailed=true;
      await h.find('cfv5-query').fire('click');
      overlayState(h,false);assert.equal(h.timing.state().status,'failed');
      assert.equal(h.posts.length,mode==='settings'?0:1);
    });
  }
});

test('changing dates dismisses progress and a delayed preflight cannot restore it or submit a query',async t=>{
  const h=mounted();t.after(()=>h.controller.dispose());await h.ready();
  h.loadGate=deferred();const click=h.find('cfv5-query').fire('click');overlayState(h,true);await flush();
  h.find('cfv7-date').value='2026-09-13';const changed=h.find('cfv7-date').fire('change');
  overlayState(h,false);
  h.loadGate.resolve();await Promise.all([click,changed]);
  overlayState(h,false);assert.equal(h.posts.length,0);
});

test('changing authentication dismisses progress at the next guarded clock tick',async t=>{
  const h=mounted();t.after(()=>h.controller.dispose());await h.ready();
  h.loadGate=deferred();const click=h.find('cfv5-query').fire('click');await flush();overlayState(h,true);
  h.auth='Bearer test-user-b';h.tick(200);overlayState(h,false);
  h.loadGate.resolve();await click;overlayState(h,false);assert.equal(h.posts.length,0);
});

test('hiding the view dismisses progress immediately and showing it again does not revive the old click',async t=>{
  const h=mounted();t.after(()=>h.controller.dispose());await h.ready();
  await h.find('cfv5-query').fire('click');overlayState(h,true);
  h.hide();overlayState(h,false);assert.equal(h.timing.state().status,'cancelled');
  h.show();await flush();overlayState(h,false);
});

test('disposing a busy controller dismisses progress and clears the click clock',async()=>{
  const h=mounted();await h.ready();await h.find('cfv5-query').fire('click');overlayState(h,true);
  h.controller.dispose();overlayState(h,false);
  assert.equal([...h.timers.values()].filter(timer=>timer.ms===200).length,0);
});

test('a stale completion callback cannot dismiss the progress of a newer forced requery',async t=>{
  const h=mounted({savedId:'saved-original'});t.after(()=>h.controller.dispose());await h.ready();
  await h.find('cfv5-query').fire('click');overlayState(h,true);
  const staleFrame=[...h.frames.values()][0];assert.ok(staleFrame);
  h.queryGate=deferred();const requery=h.find('cfv5-requery').fire('click');await flush();
  assert.equal(h.timing.state().mode,'forced_requery');overlayState(h,true);
  staleFrame();h.emitOld();overlayState(h,true);
  assert.equal(h.timing.state().status,'running');assert.equal(h.frames.size,0);
  h.queryGate.resolve();await requery;overlayState(h,true);
  h.complete('request-1');h.frame();overlayState(h,true);h.frame();overlayState(h,false);
});
