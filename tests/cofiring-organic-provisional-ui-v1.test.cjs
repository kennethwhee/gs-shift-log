'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../maintenance/cofiring-core.js');

// Exercise the real mounted UI and real timing helper. Only remote stores/live
// transport and the selector/event DOM are modeled; calculation uses the core.
const {Element,inventoryReport,receiptFetch}=require('./helpers/cofiring-period-dom.cjs');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function blank(){return {unit1:{organic:null,manure:null},unit2:{organic:null,manure:null}};}
function fixtureReference(spec){
  const p=core.periodRange(spec.startLocal,spec.endLocal,spec.stepUnit,spec.stepValue);
  return {kind:'cofiring_period_summary_v1',schemaVersion:1,...spec,summaries:core.requiredSeries.map(d=>({key:d.id,unit:d.unit,fuel:d.fuel,tag:d.queryTag,startValue:100,endValue:112,min:100,max:112,delta:12,usageTon:12,startQuality:'Good',endQuality:'Good',startTime:p.start,endTime:p.end,durationGoodSeconds:p.durationMinutes*60,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}))};
}
function mounted({savedId=null,receipt=0,inventory=true,receiptError=false}={}){
  const h={receipt,inventory,receiptError,receiptCalls:[],receiptGate:null,saves:[],syncGate:null,syncCalls:0,auth:'Bearer test-user-a',settingsGate:null,manualGate:null,loadGate:null,queryGate:null,savedId,loads:[],posts:[],events:[],clock:100,wallTime:Date.parse('2026-10-13T07:19:00+09:00'),timers:new Map(),frames:new Map(),timing:null};
  let serial=0,liveOptions,liveState={authenticated:true,canQuery:true,period:null,item:{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''}};
  const container=new Element();
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
    return {state:()=>state,defaults:()=>settings,select(...values){const next=JSON.stringify(values);if(next!==selected){selected=next;state.loaded=false;}},async load(){h.events.push(kind+'.load');state.loading=true;const gate=h[kind+'Gate'];if(gate)await gate.promise;state.loaded=true;state.loading=false;options.onChange();return true;},dispose(){},async save(values){h.saves.push(JSON.parse(JSON.stringify(values)));return true;}};
  }
  function emit(){liveOptions.onChange(liveState);}
  function result(id){
    const report=inventoryReport(fixtureReference(liveState.period));
    const start={organicDaySilo:9.110260009765625,organicStorageSiloA:57.65625,organicStorageSiloB:1.80908203125,total:68.57559204101562};
    const end={organicDaySilo:15.118408203125,organicStorageSiloA:61.13525390625,organicStorageSiloB:15.23681640625,total:91.490478515625};
    report.organicInventory.start=start;report.organicInventory.end=end;
    for(const sample of report.organicInventory.samples){sample.startValue=start[sample.key];sample.endValue=end[sample.key];}
    if(!h.inventory){delete report.organicInventory;report.organicInventoryReady=false;}
    return {requestId:id,report:{...report,completedAtUtc:new Date(h.wallTime).toISOString(),queryElapsedSeconds:6.374,workerElapsedSeconds:26.499,timing:{controllerElapsedSeconds:28.155}}};
  }
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
  const context=vm.createContext({Date:FixedDate,URLSearchParams,fetch:async(url)=>{
    if(!url.startsWith('/api/solid-fuel-trouble'))return receiptFetch(url);
    h.receiptCalls.push(url);const gate=h.receiptGate;if(gate)await gate.promise;if(h.receiptError)throw Error('Synthetic receipt outage');
    const response=await receiptFetch(url),payload=await response.json();payload.receipts.organic=h.receipt;
    return {ok:true,json:async()=>payload};
  },console,performance:{now:()=>h.clock},CofiringCore:core,CofiringLive:{createPeriod:options=>{liveOptions=options;return live;}},CofiringCalculationSettingsStorage:{create:options=>store('settings',options)},CofiringPeriodManualStorage:{blank,parseValue:v=>v===''?null:Number(v),create:options=>store('manual',options)},CofiringPeriodAdjustmentV56:{create:options=>{h.adjustmentOptions=options;return {resolve:()=>({ok:false}),dispose(){}};},
    resolveServer:async(result)=>{h.syncCalls++;if(h.syncGate)await h.syncGate.promise;return {loaded:true,adjusted:false,result};}},CofiringTargetReferenceV6:{forUnit:()=>null},getShiftLogAuthHeaders:()=>({Authorization:h.auth}),document:{readyState:'loading',addEventListener(){},getElementById:()=>null,createElement:()=>new Element(),head:{appendChild(){}}},navigator:{userAgent:'desktop'},location:{pathname:'/maintenance/'},setTimeout:setTimer,clearTimeout:clearTimer,requestAnimationFrame:f=>{const id=++serial;h.frames.set(id,f);return id;},cancelAnimationFrame:id=>h.frames.delete(id),confirm:()=>true});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-click-timing-v1.js'),'utf8'),context);
  const createTiming=context.CofiringClickTimingV1.create;
  context.CofiringClickTimingV1={create:options=>(h.timing=createTiming(options))};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-deadline-target-v1.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-shared-adjustment-sync-v2.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8'),context);
  h.controller=context.CofiringPeriodV5.mount(container);h.find=key=>container.querySelector(`[data-${key}]`);
  h.frame=()=>{const entry=h.frames.entries().next().value;assert.ok(entry,'animation frame scheduled');h.frames.delete(entry[0]);h.clock+=16;entry[1]();};
  h.tick=ms=>{const entry=[...h.timers].find(([,t])=>t.ms===ms);assert.ok(entry,'timer '+ms+' scheduled');h.timers.delete(entry[0]);h.clock+=ms;entry[1].f();};
  h.ready=async()=>{await flush();if([...h.timers.values()].some(t=>t.ms===0))h.tick(0);await flush();h.loads=[];h.events=[];};
  return h;
}

function plain(value){return JSON.parse(JSON.stringify(value));}
async function useScope(h,{date,mode='daily',start,end}){
  h.find('cfv8-mode').value=mode;
  if(date)h.find('cfv7-date').value=date;
  if(start)h.find('cfv8-start').value=start;
  if(end)h.find('cfv8-end').value=end;
  await h.controller.periodChanged();await flush();
}

test('today partial negative balance displays provisional zero with the original arithmetic and blocks persistence',async t=>{
  const h=mounted();t.after(()=>h.controller.dispose());await h.ready();h.seed('saved-current');await flush();
  const result=h.controller.getResult(),usage=result.organicUsage;
  assert.equal(usage.ok,true);assert.equal(usage.provisionalZero,true);assert.equal(usage.rawUsage,-22.914886474609375);
  assert.equal(usage.usage,0);assert.equal(usage.startTotal,68.57559204101562);assert.equal(usage.endTotal,91.490478515625);
  for(const unit of ['unit1','unit2']){
    assert.equal(result.units[unit].organic.quantity,0);assert.equal(result.units[unit].fuelRatios.organicGroup,0);
    assert.ok(Number.isFinite(result.units[unit].fuelRatios.bio));assert.ok(Number.isFinite(result.units[unit].fuelRatios.total));
    assert.equal(h.container.querySelector(`[data-cfv5-manual="${unit}:organic"]`).value,'0.00');
  }
  assert.equal(result.combined.fuelRatios.organicGroup,0);
  assert.match(h.find('cfv52-summary-grid').innerHTML,/유기성 0t 임시 표시/);
  const detail=h.find('cfv15-organic-usage');
  assert.match(detail.innerHTML,/유기성 총 0\.00t · 임시 표시/);assert.match(detail.innerHTML,/68\.576t/);assert.match(detail.innerHTML,/91\.490t/);assert.match(detail.innerHTML,/-22\.915t/);
  assert.match(detail.innerHTML,/입고량·재고수지 확인 필요/);assert.equal(detail.dataset.tone,'working');
  assert.match(h.find('cfv11-status-line').textContent,/계산 완료 · 유기성 0t 임시 표시/);assert.equal(h.find('cfv11-status-line').dataset.tone,'working');
  assert.match(h.find('cfv5-status').textContent,/-22\.91 t.*0\.00 t 임시 표시/);
  assert.ok(result.warnings.some(w=>w.includes('0.00 t 임시 표시')));
  assert.equal(h.find('cfv5-manual-save').disabled,true);assert.throws(()=>h.controller.getSnapshotInputs(),/임시 표시값은 저장·마감할 수 없습니다/);
  await h.find('cfv5-manual-save').fire('click');assert.equal(h.saves.length,0);
});

test('the source cutoff matches the report endpoint rather than the one-minute query padding',async t=>{
  const h=mounted({receipt:30});t.after(()=>h.controller.dispose());await h.ready();h.seed('saved-basis');await flush();
  assert.equal(h.controller.getSpec().endLocal,'2026-10-13T07:18');
  assert.match(h.find('cfv7-daily-window').textContent,/07:19$/);
  assert.match(h.find('cfv6-data-source').textContent,/자료 기준 07:18/);
  assert.doesNotMatch(h.find('cfv6-data-source').textContent,/자료 기준 확인 필요|자료 기준 07:17/);
});

test('missing inventory and failed receipt reads remain unconfirmed rather than provisional zero',async t=>{
  for(const options of [{inventory:false},{receiptError:true}]){
    const h=mounted(options);t.after(()=>h.controller.dispose());await h.ready();h.seed('saved-unconfirmed');await flush();
    const result=h.controller.getResult();assert.equal(result.organicUsage.ok,false);assert.notEqual(result.organicUsage.provisionalZero,true);
    assert.equal(result.units.unit1.organic.quantity,null);assert.equal(result.units.unit1.fuelRatios.organicGroup,null);
    assert.equal(h.container.querySelector('[data-cfv5-manual="unit1:organic"]').value,'');
    assert.match(h.find('cfv11-status-line').textContent,/유기성 자료 확인 필요/);assert.equal(h.find('cfv5-status').dataset.tone,'error');
    assert.doesNotMatch(h.find('cfv5-status').textContent,/공용 혼소조정 원복 상태/);
    assert.equal(h.find('cfv5-manual-save').disabled,true);
  }
});

test('past daily and custom-period negatives keep the strict rejection',async t=>{
  for(const scope of [
    {date:'2026-10-12'},
    {mode:'period',start:'2026-10-13T00:00',end:'2026-10-13T07:18'},
    {mode:'period',start:'2026-10-12T23:00',end:'2026-10-13T07:18'}
  ]){
    const h=mounted();t.after(()=>h.controller.dispose());await h.ready();await useScope(h,scope);h.seed('saved-strict');await flush();
    const result=h.controller.getResult();assert.equal(result.organicUsage.ok,false);assert.equal(result.organicUsage.code,'ORGANIC_BALANCE_NEGATIVE');
    assert.equal(result.units.unit1.organic.quantity,null);assert.equal(h.find('cfv5-status').dataset.tone,'error');
    assert.doesNotMatch(h.find('cfv11-status-line').textContent,/0t 임시 표시/);
  }
});

test('shared synchronization and reset callbacks preserve organic provisional and missing-source diagnostics',async t=>{
  for(const options of [{},{inventory:false}]){
    const h=mounted(options);t.after(()=>h.controller.dispose());await h.ready();h.syncGate=deferred();h.seed('saved-sync');
    const before=h.find('cfv5-status').textContent,tone=h.find('cfv5-status').dataset.tone;
    await flush();assert.ok(h.syncCalls>0);h.syncGate.resolve();await flush();
    assert.equal(h.find('cfv5-status').textContent,before);assert.equal(h.find('cfv5-status').dataset.tone,tone);
    h.adjustmentOptions.onReset();assert.equal(h.find('cfv5-status').textContent,before);
    assert.equal(h.find('cfv5-status').dataset.tone,tone);
  }
});

test('same-minute cached Calculate retries a failed receipt without another DataPARC request',async t=>{
  const h=mounted({receiptError:true,receipt:30});t.after(()=>h.controller.dispose());await h.ready();h.seed('saved-receipt');await flush();
  assert.equal(h.controller.getResult().organicUsage.code,'ORGANIC_RECEIPT_MISSING');
  const spec=plain(h.controller.getSpec());h.receiptError=false;h.receiptCalls=[];h.loads=[];h.posts=[];
  await h.find('cfv5-query').fire('click');await flush();
  assert.equal(h.receiptCalls.length,1);assert.equal(h.posts.length,0);assert.equal(h.loads.length,0);assert.deepEqual(plain(h.controller.getSpec()),spec);
  const result=h.controller.getResult();assert.equal(result.organicUsage.ok,true);assert.equal(result.organicUsage.provisionalZero,false);
  assert.ok(result.units.unit1.organic.quantity>0);assert.equal(h.find('cfv5-manual-save').disabled,false);
  assert.equal(h.find('cfv5-status').dataset.tone,'success');
  h.receiptCalls=[];await h.find('cfv5-query').fire('click');await flush();assert.equal(h.receiptCalls.length,0);
});

test('cached Calculate retains the provisional warning and valid balances keep their calculated precision',async t=>{
  const h=mounted();t.after(()=>h.controller.dispose());await h.ready();h.seed('saved-provisional');await flush();h.receiptCalls=[];
  await h.find('cfv5-query').fire('click');await flush();
  assert.equal(h.receiptCalls.length,0);assert.match(h.find('cfv5-status').textContent,/0\.00 t 임시 표시/);assert.equal(h.find('cfv5-status').dataset.tone,'working');
  const valid=mounted({receipt:30.12345});t.after(()=>valid.controller.dispose());await valid.ready();valid.seed('saved-valid');await flush();
  const result=valid.controller.getResult();assert.equal(result.organicUsage.provisionalZero,false);
  assert.equal(result.units.unit1.organic.quantity,3.6043);assert.equal(result.units.unit2.organic.quantity,3.6043);
  assert.equal(valid.find('cfv5-manual-save').disabled,false);
  assert.equal(valid.controller.getSnapshotInputs().manual.unit1.organic,3.6043);
  assert.doesNotMatch(valid.find('cfv15-organic-usage').innerHTML,/임시 표시/);
});


test('a delayed cached receipt retry cannot overwrite a changed selected date',async t=>{
  const h=mounted({receiptError:true,receipt:30});t.after(()=>h.controller.dispose());await h.ready();h.seed('saved-old-retry');await flush();
  h.receiptError=false;const gate=deferred();h.receiptGate=gate;
  const click=h.find('cfv5-query').fire('click');await flush();
  h.receiptGate=null;await useScope(h,{date:'2026-10-12'});h.seed('saved-new-date');await flush();
  const newResult=h.controller.getResult();gate.resolve();await click;await flush();
  assert.equal(h.controller.getSpec().startLocal,'2026-10-12T00:00');assert.equal(h.controller.getResult(),newResult);
  assert.equal(h.controller.getResult().organicUsage.startLocal,'2026-10-12T00:00');assert.equal(h.posts.length,0);
});

test('one versioned core and UI loader each requests the organic-zero revision',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for(const asset of ['cofiring-core.js','cofiring-period-ui-v5.js']){
    const tags=[...html.matchAll(/<script\s+src="([^"]+)"\s+defer><\/script>/g)].filter(m=>m[1].startsWith('/maintenance/'+asset+'?'));
    assert.equal(tags.length,1,asset);
    const url=new URL(tags[0][1].replaceAll('&amp;','&'),'https://review.invalid');
    assert.equal(url.searchParams.get('organicZero'),'20261013-v1',asset);
  }
});
