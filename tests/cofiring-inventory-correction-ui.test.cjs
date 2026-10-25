'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../maintenance/cofiring-core.js'),contract=require('../maintenance/cofiring-live-contract.js');
const model=require('../maintenance/cofiring-inventory-correction.js');
const ui=require('../maintenance/cofiring-inventory-correction-ui.js');
const {Element,inventoryReport}=require('./helpers/cofiring-period-dom.cjs');
const spec={startLocal:'2026-10-23T00:00',endLocal:'2026-10-24T00:00',stepUnit:'minute',stepValue:1};
const entry=(other={})=>({silo:'organicStorageSiloB',boundaryLocal:spec.endLocal,tons:30,method:'confirmed',reason:'운전기록의 자정 재고 확인',evidence:[],revision:1,updatedById:'user-1',updatedByName:'확인 담당자',updatedAt:'2026-10-25T15:00:00Z',...other});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function rawReference(){
  const p=core.periodRange(spec.startLocal,spec.endLocal,'minute',1),report=inventoryReport({kind:'cofiring_period_summary_v1',schemaVersion:1,...spec,summaries:core.requiredSeries.map(d=>({key:d.id,unit:d.unit,fuel:d.fuel,tag:d.queryTag,startValue:100,endValue:d.id==='unit2Bio'?111.6953125:112,min:100,max:d.id==='unit2Bio'?111.6953125:112,delta:d.id==='unit2Bio'?11.6953125:12,usageTon:d.id==='unit2Bio'?11.6953125:12,startQuality:'Good',endQuality:'Good',startTime:p.start,endTime:p.end,durationGoodSeconds:86400,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}))});
  const samples=structuredClone(report.organicInventory.samples);Object.assign(samples[2],{endValue:null,endQuality:'Raw, Bad',endTime:'2026-10-23T23:10:18+09:00',boundaryValid:false,dataComplete:false});
  return {...report.reference,organicInventory:null,organicInventoryReady:false,organicInventorySamples:samples};
}

test('late correction GET cannot cross the selected midnight or signed-in identity',async()=>{
  for(const change of ['period','identity']){
    const gate=deferred();let auth='Bearer first';const store=ui.createStore({getHeaders:()=>({Authorization:auth}),fetch:async()=>gate.promise});
    store.select(spec);const pending=store.load();
    if(change==='period')store.select({...spec,startLocal:spec.endLocal,endLocal:'2026-10-25T00:00'});else{auth='Bearer second';store.state();}
    gate.resolve(response({ok:true,start:spec.startLocal,end:spec.endLocal,entries:[entry()]}));assert.equal(await pending,false);assert.deepEqual(store.state().entries,[]);store.dispose();
  }
});

test('unmatched periods, duplicate corrections, and forged evidence confirmations remain unavailable',async()=>{
  for(const body of [{start:'2026-10-22T00:00',entries:[entry()]},{entries:[entry(),entry()]},{entries:[entry({tons:null})]}]){
    const store=ui.createStore({getHeaders:()=>({Authorization:'Bearer first'}),fetch:async()=>response({ok:true,start:spec.startLocal,end:spec.endLocal,...body})});
    store.select(spec);assert.equal(await store.load(),false);assert.deepEqual(store.state().entries,[]);assert.match(store.state().error,/응답|이력/);store.dispose();
  }
});

test('save carries exact zero and retained evidence without requiring the evidence drawer to open',async()=>{
  const calls=[],evidence=[{id:'receipt-1',version:2}];
  const store=ui.createStore({getHeaders:()=>({Authorization:'Bearer first'}),fetch:async(url,init)=>{
    calls.push({url,init});if(init.method==='POST'){const body=JSON.parse(init.body);return response({ok:true,entry:entry({...body,revision:body.expectedRevision+1})});}return response({ok:true,start:spec.startLocal,end:spec.endLocal,entries:[entry({evidence})]});
  }});
  store.select(spec);await store.load();assert.equal(calls.length,1);
  assert.equal(await store.save({...entry({evidence}),tons:'0',reason:'경계 시각 빈 Silo 현장 확인'}),true);
  const body=JSON.parse(calls[1].init.body);assert.equal(body.tons,0);assert.equal(body.expectedRevision,1);assert.deepEqual(body.evidence,evidence);assert.equal(store.state().entries[0].revision,2);
  assert.throws(()=>ui.parseTons(''),/재고/);store.dispose();
});

test('revision conflict clears active corrections and preserves a useful conflict explanation',async()=>{
  const store=ui.createStore({getHeaders:()=>({Authorization:'Bearer first'}),fetch:async(url,init)=>init.method==='POST'?response({ok:false,code:'REVISION_CONFLICT'},409):response({ok:true,start:spec.startLocal,end:spec.endLocal,entries:[entry()]})});
  store.select(spec);await store.load();assert.equal(await store.save({...entry(),tons:32}),false);assert.equal(store.state().loaded,false);assert.deepEqual(store.state().entries,[]);assert.match(store.state().error,/입력한 내용은 유지/);store.dispose();
});

test('server save cannot substitute different evidence provenance',async()=>{
  const store=ui.createStore({getHeaders:()=>({Authorization:'Bearer first'}),fetch:async(url,init)=>init.method==='POST'?response({ok:true,entry:entry({revision:2,evidence:[{id:'foreign',version:1}]})}):response({ok:true,start:spec.startLocal,end:spec.endLocal,entries:[entry()]})});
  store.select(spec);await store.load();assert.equal(await store.save(entry()),false);assert.match(store.state().error,/저장 확인값/);assert.equal(store.state().loaded,false);assert.deepEqual(store.state().entries,[]);store.dispose();
});

test('an uncertain POST outcome invalidates old correction values until an explicit server reload',async()=>{
  let saved=entry();const store=ui.createStore({getHeaders:()=>({Authorization:'Bearer first'}),fetch:async(url,init)=>{
    if(init.method==='POST'){const body=JSON.parse(init.body);saved=entry({...body,revision:body.expectedRevision+1});throw new TypeError('Network response lost');}
    return response({ok:true,start:spec.startLocal,end:spec.endLocal,entries:[saved]});
  }});
  store.select(spec);await store.load();assert.equal(await store.save({...entry(),tons:31}),false);assert.equal(store.state().loaded,false);assert.deepEqual(store.state().entries,[]);assert.match(store.state().error,/최신 기록을 다시 불러와 저장 결과/);
  assert.equal(await store.save({...entry(),tons:32}),false,'cannot submit with unknown revision');
  assert.equal(await store.load({force:true}),true);assert.equal(store.state().entries[0].tons,31);assert.equal(store.state().entries[0].revision,2);store.dispose();
});

test('evidence drawer stays open through async reload and does not erase unsaved reason or selected provenance',async()=>{
  const host=new Element(),gate=deferred();let savedBody=null;
  const controller=ui.create({host,getHeaders:()=>({Authorization:'Bearer first'}),fetch:async(url,init)=>{
    if(url.includes('inventoryBoundary'))return gate.promise;
    if(init.method==='POST'){savedBody=JSON.parse(init.body);return response({ok:true,entry:entry({...savedBody,revision:2})});}
    return response({ok:true,start:spec.startLocal,end:spec.endLocal,entries:[entry({evidence:[{id:'receipt-1',version:2}]})]});
  }});
  controller.setContext(spec,rawReference());await flush();
  let reason=host.querySelector('[data-cfv-inventory-reason="0"]');reason.value='입고기록과 현장 확인을 함께 대조함';await reason.fire('input');
  let details=host.querySelector('[data-cfv-inventory-details="0"]');details.open=true;await details.fire('toggle');
  assert.equal(host.querySelector('[data-cfv-inventory-details="0"]').open,true);
  gate.resolve(response({ok:true,boundaryLocal:spec.endLocal,source:'solid-fuel-unloading',basis:'completed-unloading-departure',truncated:false,records:[{id:'receipt-1',version:2,vehicleNo:'12가3456',companyName:'업체',arrivalLocal:'2026-10-23T23:40',departureLocal:'2026-10-24T00:15',receiptTons:23.45,siloRoute:'#B',flags:['crosses-boundary']}]}));await flush();
  assert.equal(host.querySelector('[data-cfv-inventory-details="0"]').open,true);assert.equal(host.querySelector('[data-cfv-inventory-reason="0"]').value,'입고기록과 현장 확인을 함께 대조함');assert.equal(host.querySelector('[data-cfv-inventory-evidence="0:0"]').checked,true);
  assert.match(host.innerHTML,/경계 시각에 하역 중/);assert.doesNotMatch(host.innerHTML,/crosses-boundary/);
  await host.querySelector('[data-cfv-inventory-save="0"]').fire('click');assert.deepEqual(savedBody.evidence,[{id:'receipt-1',version:2}]);controller.dispose();
});

test('a late evidence response cannot replace the result of a newer explicit refresh',async()=>{
  const first=deferred(),second=deferred();let requests=0;const store=ui.createStore({getHeaders:()=>({Authorization:'Bearer first'}),fetch:async()=>++requests===1?first.promise:second.promise});
  store.select(spec);const pendingFirst=store.evidence(spec.endLocal),pendingSecond=store.evidence(spec.endLocal,{force:true});
  const body=version=>({ok:true,boundaryLocal:spec.endLocal,source:'solid-fuel-unloading',basis:'completed-unloading-departure',records:[{id:'receipt-1',version}]});
  second.resolve(response(body(2)));assert.equal(await pendingSecond,true);first.resolve(response(body(1)));assert.equal(await pendingFirst,false);assert.equal(store.state().evidence[spec.endLocal].records[0].version,2);store.dispose();
});

test('read-only history retains old values and saved receipt identity separately from current records',()=>{
  const old=entry({tons:25,revision:1,reason:'과거 확인값 <script>alert(1)</script>',evidence:[{id:'receipt-1',version:2}],evidenceSnapshots:[{id:'receipt-1',version:2,vehicleNo:'12가3456',siloRoute:'#B'}]}),latest=entry({revision:2,tons:30});
  const html=ui.historyMarkup([latest,old],latest,false);assert.match(html,/v2 · 30 t/);assert.match(html,/v1 · 25 t/);assert.match(html,/12가3456/);assert.match(html,/기록 receipt-1 · v2/);assert.doesNotMatch(html,/<script>|<input|<button/);assert.match(html,/&lt;script&gt;/);
});

function mounted({method='estimated',correctionFailure=false}={}){
  const host=new Element(),settings={};host.classList.contains=()=>false;for(const u of ['unit1','unit2']){settings[u]={};for(const f of ['coal','bio','organic','manure'])settings[u][f]={calorific:3000,coefficient:1};}
  let liveOptions,adjustmentOptions,liveState={authenticated:true,canQuery:true,period:null,item:{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''}},manualSaves=0;
  const blank=()=>({unit1:{organic:null,manure:null},unit2:{organic:null,manure:null},receipts:{organic:null,manure:null}});
  const store=options=>{const state={loaded:false,loading:false,saving:false,error:'',canEdit:true,settings,values:blank(),revision:0};return {state:()=>state,defaults:()=>settings,select(){state.loaded=false;},async load(){state.loaded=true;options.onChange();return true;},async save(){manualSaves++;return true;},dispose(){}};};
  const live={state:()=>liveState,select(p){liveState.period={...p};},async load(){return true;},pause(){},dispose(){}};
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-25T22:00:00+09:00']));}static now(){return Date.parse('2026-10-25T22:00:00+09:00');}}
  const context=vm.createContext({Date:FixedDate,Promise,URLSearchParams,crypto:globalThis.crypto,console,CofiringCore:core,CofiringPeriodAdjustmentV56:{create:options=>{adjustmentOptions=options;return {resolve:()=>({ok:false}),dispose(){}};}},CofiringLiveContract:contract,CofiringInventoryCorrection:model,CofiringLive:{createPeriod:options=>{liveOptions=options;return live;}},CofiringCalculationSettingsStorage:{create:store},CofiringPeriodManualStorage:{create:store,blank,parseValue:v=>v===''?null:Number(v)},getShiftLogAuthHeaders:()=>({Authorization:'Bearer operator'}),document:{readyState:'loading',addEventListener(){},getElementById:()=>null,createElement:()=>new Element(),head:{appendChild(){}}},navigator:{userAgent:'desktop'},location:{pathname:'/maintenance/'},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},fetch:async(url)=>{
    const request=new URL(url,'https://fixture.invalid');if(request.pathname==='/api/cofiring-closed-history')return response({ok:true,item:null});
    if(request.pathname==='/api/cofiring-inventory-corrections'){if(correctionFailure)return response({ok:false,message:'보완 이력 연결 실패'},503);return response({ok:true,start:request.searchParams.get('start'),end:request.searchParams.get('end'),entries:[entry({method})]});}
    if(request.pathname==='/api/solid-fuel-trouble')return response({ok:true,receiptStart:request.searchParams.get('receiptStart'),receiptEnd:request.searchParams.get('receiptEnd'),source:'solid-fuel-unloading',basis:'completed-unloading-departure',receipts:{organic:30,manure:0},counts:{organic:1,manure:0}});throw Error('unexpected '+url);
  }});
  for(const name of ['cofiring-inventory-correction-ui.js','cofiring-period-ui-v5.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance',name),'utf8'),context);
  const controller=context.CofiringPeriodV5.mount(host),find=attr=>host.querySelector(`[data-${attr}]`);
  async function ready(){await flush();find('cfv7-date').value='2026-10-23';await controller.periodChanged();await flush();const ref=rawReference();liveState.item={saved:{id:'saved-request'},result:{requestId:'saved-request',report:{reference:ref,organicInventoryReady:false,organicInventory:null,organicInventorySamples:ref.organicInventorySamples}},active:null,lastAttempt:null,loading:false,submitting:false,error:''};liveOptions.onResult(liveState.item.result);liveOptions.onChange(liveState);await flush();}
  return {controller,host,find,ready,get manualSaves(){return manualSaves;},get adjustmentContext(){return adjustmentOptions.getContext;}};
}

test('mounted UI shows actual Bio during inventory outage, previews estimated balance, and blocks save/close',async t=>{
  const h=mounted();t.after(()=>h.controller.dispose());await h.ready();
  const result=h.controller.getResult();assert.equal(result.units.unit2.bio.quantity,11.6953125);assert.equal(result.organicUsage.ok,true);assert.equal(result.organicUsage.provisional,true);
  assert.match(h.find('cfv52-summary-grid').innerHTML,/11\.70/);assert.match(h.find('cfv52-summary-grid').innerHTML,/추정 재고 · 임시 계산/);assert.match(h.find('cfv15-organic-usage').innerHTML,/사용량 =/);assert.match(h.find('cfv15-organic-usage').innerHTML,/추정 재고 임시 계산/);
  assert.equal(h.find('cfv5-manual-save').disabled,true);assert.equal(h.find('cfv56-adjust').disabled,true);assert.throws(()=>h.adjustmentContext(),/추정 재고.*혼소 조정/);assert.throws(()=>h.controller.getSnapshotInputs(),/추정 재고.*저장·마감/);await h.find('cfv5-manual-save').fire('click');assert.equal(h.manualSaves,0);
});

test('confirmed correction snapshot keeps provenance while a correction service outage leaves real fuel visible',async t=>{
  const confirmed=mounted({method:'confirmed'});t.after(()=>confirmed.controller.dispose());await confirmed.ready();
  const inputs=confirmed.controller.getSnapshotInputs();assert.equal(inputs.organicCorrections.length,1);assert.equal(inputs.organicCorrections[0].method,'confirmed');assert.equal(confirmed.controller.getResult().organicUsage.provisional,false);assert.equal(confirmed.find('cfv56-adjust').disabled,false);assert.equal(confirmed.adjustmentContext().result,confirmed.controller.getResult());
  const failed=mounted({correctionFailure:true});t.after(()=>failed.controller.dispose());await failed.ready();
  const result=failed.controller.getResult();assert.equal(result.units.unit2.bio.quantity,11.6953125);assert.equal(result.units.unit1.organic.quantity,null);assert.equal(result.organicUsage.ok,false);assert.match(failed.find('cfv52-summary-grid').innerHTML,/11\.70/);assert.match(failed.find('cfv-inventory-correction').innerHTML,/보완 이력 연결 실패/);
});
