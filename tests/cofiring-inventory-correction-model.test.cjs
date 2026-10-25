'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../maintenance/cofiring-core.js');
const contract=require('../maintenance/cofiring-live-contract.js');
const model=require('../maintenance/cofiring-inventory-correction.js');
const spec={startLocal:'2026-10-23T00:00',endLocal:'2026-10-24T00:00',stepUnit:'minute',stepValue:1};
const values=[
  [7.813262939453125,15.709686279296875,'2026-10-22T23:59:19+09:00','2026-10-23T23:59:52+09:00',13.625],
  [56.435546875,43.8623046875,'2026-10-22T23:59:20+09:00','2026-10-23T23:59:43+09:00',34.664],
  [58.6328125,null,'2026-10-22T23:56:41+09:00','2026-10-23T23:10:18+09:00',3119.648]
];
// Inventory values/quality/timestamps from the failed 2026-10-23 report. Run IDs,
// host details and unrelated diagnostics are intentionally not test fixtures.
function reference(){return {...spec,kind:'cofiring_period_summary_v1',schemaVersion:1,organicInventoryReady:false,organicInventory:null,
  organicInventorySamples:contract.inventoryDefinitions.map((def,i)=>({...def,
    startValue:values[i][0],endValue:values[i][1],startQuality:'Raw, Good',endQuality:i===2?'Raw, Bad':'Raw, Good',
    startTime:values[i][2],endTime:values[i][3],durationGoodSeconds:86400-values[i][4],durationBadSeconds:values[i][4],
    durationCoverageValid:true,boundaryValid:i!==2,dataComplete:i!==2}))};}
function correction(overrides={}){return {silo:'organicStorageSiloB',boundaryLocal:spec.endLocal,tons:30.19,method:'confirmed',reason:'운전 기록의 00시 재고 확인값',
  evidence:[{id:'unloading-evidence-1',version:2}],revision:1,updatedById:'operator-1',updatedByName:'확인 담당자',updatedAt:'2026-10-25T15:00:00Z',...overrides};}

test('failed real inventory keeps five valid endpoints and requests only Storage B end',()=>{
  const ref=reference(),before=structuredClone(ref),out=model.resolve(ref,[],spec);
  assert.equal(out.ok,false);assert.equal(out.code,'ORGANIC_BOUNDARY_CORRECTION_REQUIRED');
  assert.deepEqual(out.missing.map(({silo,side,boundaryLocal})=>({silo,side,boundaryLocal})),[{silo:'organicStorageSiloB',side:'end',boundaryLocal:spec.endLocal}]);
  assert.equal(out.missing[0].value,null);assert.equal(out.missing[0].quality,'Raw, Bad');
  assert.deepEqual(ref,before);
});

test('confirmed boundary produces actual balance and preserves original Bad diagnostic and audit',()=>{
  const ref=reference(),entry=correction(),before=structuredClone({ref,entry});
  const out=model.usage(ref,40,spec,[entry]);
  assert.equal(out.ok,true);assert.equal(out.provisional,false);assert.equal(out.basis,'operator-corrected-inventory-balance-v1');
  const expected=values.reduce((n,v)=>n+v[0],0)+40-values[0][1]-values[1][1]-30.19;
  assert.ok(Math.abs(out.usage-expected)<1e-9);
  assert.equal(out.allocation.unit1,Math.round(expected/2*10000)/10000);
  assert.equal(out.inventory.basis,'operator_corrected_period_boundary');
  assert.equal(out.inventory.samples[2].endValue,null);assert.equal(out.inventory.samples[2].endQuality,'Raw, Bad');
  assert.equal(out.inventory.boundaries.end.organicStorageSiloB.source,'operator');
  assert.equal(out.inventory.boundaries.start.organicStorageSiloB.source,'dataparc');
  assert.deepEqual(out.corrections,[entry]);assert.deepEqual({ref,entry},before);
  out.corrections[0].reason='changed copy';assert.equal(entry.reason,before.entry.reason);
});

test('estimated boundaries remain provisional while confirmed zero is an actual zero',()=>{
  const ref=reference();
  const provisional=model.usage(ref,40,spec,[correction({method:'estimated'})]);
  assert.equal(provisional.ok,true);assert.equal(provisional.provisional,true);assert.match(provisional.message,/임시/);
  const zero=model.usage(ref,40,spec,[correction({tons:0})]);
  assert.equal(zero.ok,true);assert.equal(zero.inventory.end.organicStorageSiloB,0);assert.equal(zero.provisional,false);
  for(const tons of [null,'',undefined,NaN,-1,Infinity,1000001])assert.equal(model.resolve(ref,[correction({tons})],spec).ok,false,String(tons));
});

test('a shared midnight correction is used as previous end and next start without duplicating history',()=>{
  const shared=correction(),first=model.resolve(reference(),[shared],spec);
  const nextSpec={...spec,startLocal:spec.endLocal,endLocal:'2026-10-25T00:00'},next=reference();
  Object.assign(next,nextSpec);
  next.organicInventorySamples.forEach((sample,i)=>Object.assign(sample,{startValue:i===2?null:40+i,endValue:20+i,
    startTime:nextSpec.startLocal+':00+09:00',endTime:nextSpec.endLocal+':00+09:00',
    startQuality:i===2?'Raw, Bad':'Raw, Good',endQuality:'Raw, Good',boundaryValid:i!==2,dataComplete:i!==2}));
  const second=model.resolve(next,[shared],nextSpec);
  assert.equal(first.ok,true);assert.equal(second.ok,true);
  assert.equal(first.inventory.end.organicStorageSiloB,second.inventory.start.organicStorageSiloB);
  assert.deepEqual(first.corrections,second.corrections);
  assert.equal(model.boundaryKey(shared.silo,shared.boundaryLocal),'organicStorageSiloB|2026-10-24T00:00');
});

test('valid source endpoint wins over an obsolete correction without losing the original source',()=>{
  const ref=reference(),samples=ref.organicInventorySamples;
  Object.assign(samples[2],{endValue:25,endQuality:'Raw, Good',endTime:spec.endLocal+':00+09:00',boundaryValid:true,dataComplete:true});
  const out=model.usage(ref,40,spec,[correction({tons:999,method:'estimated'})]);
  assert.equal(out.ok,true);assert.equal(out.inventory.end.organicStorageSiloB,25);assert.equal(out.provisional,false);
  assert.equal(out.basis,'dataparc-inventory-balance-v1');assert.deepEqual(out.corrections,[]);
});

test('good inventory delegates to the original calculator including existing partial-day zero policy',async()=>{
  const {sourceResult,spec:fixtureSpec}=await import('./helpers/cofiring-review-fixture.mjs');
  const ref=sourceResult().report.reference;
  for(const [receipt,options] of [[30,{}],[0,{}],[0,{allowProvisionalZero:true}]]){
    const old=core.organicInventoryUsage(ref,receipt,fixtureSpec,options),current=model.usage(ref,receipt,fixtureSpec,[],options);
    for(const key of Object.keys(old))assert.deepEqual(current[key],old[key],key);
    assert.deepEqual(current.corrections,[]);assert.equal(current.provisional,false);
  }
});

test('wrong or duplicate TAG identities and malformed coverage fail globally even with a correction',()=>{
  for(const mutate of [
    r=>r.organicInventorySamples[2].tag='foreign/tag',
    r=>r.organicInventorySamples[2].label='Wrong Silo',
    r=>r.organicInventorySamples[2].key='organicStorageSiloA',
    r=>r.organicInventorySamples.pop(),
    r=>r.organicInventorySamples[0].durationGoodSeconds=2,
    r=>r.organicInventorySamples[0].durationCoverageValid=false,
    r=>r.organicInventorySamples[0].boundaryValid=false
  ]){
    const ref=reference();mutate(ref);const out=model.resolve(ref,[correction()],spec);
    assert.equal(out.ok,false);assert.equal(out.inventory,null);
  }
});

test('partial endpoints use contract lookback, timezone and quality checks independently',()=>{
  const ref=reference();
  for(const [field,value] of [['startTime','2026-10-21T23:59:59+09:00'],['startTime','2026-10-23T00:00:01+09:00'],['startTime','2026-10-23T00:00:00'],['startQuality','Interpolated, Good'],['startQuality','Uncertain'],['startValue',-1]]){
    const input=structuredClone(ref);input.organicInventorySamples[2][field]=value;
    const out=model.resolve(input,[correction()],spec);
    assert.equal(out.ok,false,field+' '+value);assert.ok(out.missing.some(m=>m.silo==='organicStorageSiloB'&&m.side==='start'));
  }
  const badEnd=reference();badEnd.organicInventorySamples[0].endTime='2026-10-24T00:01:00+09:00';
  assert.equal(model.resolve(badEnd,[correction()],spec).ok,false);
  const earliest=reference();earliest.organicInventorySamples[2].startTime='2026-10-22T00:00:00+09:00';
  assert.equal(model.resolve(earliest,[correction()],spec).ok,true);
});

test('period mismatch and duplicate or foreign correction records cannot replace a missing boundary',()=>{
  const ref=reference();
  for(const entries of [[correction(),correction({revision:2})],[correction({boundaryLocal:'2026-10-25T00:00'})],[correction({silo:'unknown'})],[correction({revision:0})],[correction({reason:''})],[correction({updatedById:''})],[correction({updatedAt:'invalid'})],[correction({evidence:[{id:'same',version:1},{id:'same',version:2}]})]]){
    assert.equal(model.resolve(ref,entries,spec).ok,false);
  }
  assert.equal(model.resolve(ref,[correction()],{...spec,endLocal:'2026-10-25T00:00'}).ok,false);
  assert.equal(model.resolve({...ref,kind:'foreign_report'},[correction()],spec).ok,false);
  assert.equal(model.resolve({...ref,schemaVersion:2},[correction()],spec).ok,false);
  assert.equal(model.resolve({...ref,stepValue:0},[correction()],{...spec,stepValue:0}).ok,false);
  assert.equal(model.resolve(ref,[correction()],{...spec,stepValue:2}).ok,false);
  assert.equal(model.localMinute('2026-02-30T00:00'),null);
});

test('missing boundaries never use min/max, last bad value, or implicit zero',()=>{
  const ref=reference(),sample=ref.organicInventorySamples[2];
  Object.assign(sample,{min:0,max:30.19,endValue:30.19});
  const out=model.usage(ref,40,spec,[]);
  assert.equal(out.ok,false);assert.equal(out.usage,null);assert.equal(out.missing[0].value,30.19);
  assert.equal(model.usage(ref,40,spec,[correction({tons:27})]).inventory.end.organicStorageSiloB,27);
});

test('negative balance is rejected and receipt absence differs from real zero',()=>{
  const ref=reference();
  const negative=model.usage(ref,0,spec,[correction({tons:1000})]);
  assert.equal(negative.ok,false);assert.equal(negative.code,'ORGANIC_BALANCE_NEGATIVE');assert.equal(negative.usage,null);
  const partial=model.usage(ref,0,spec,[correction({tons:1000})],{allowProvisionalZero:true});
  assert.equal(partial.ok,true);assert.equal(partial.provisionalZero,true);assert.equal(partial.usage,0);
  assert.equal(model.usage(ref,null,spec,[correction()]).code,'ORGANIC_RECEIPT_MISSING');
  assert.equal(model.usage(ref,0,spec,[correction()]).ok,true);
});

test('source totalizer values and real 11.6953125 t Bio quantity are preserved during correction',async()=>{
  const {sourceResult}=await import('./helpers/cofiring-review-fixture.mjs');
  const source=sourceResult({specification:spec}),ref=source.report.reference;
  const bio=ref.summaries.find(s=>s.key==='unit2Bio');
  Object.assign(bio,{startValue:51213.6640625,endValue:51225.359375,min:51213.6640625,max:51225.359375,delta:11.6953125,usageTon:11.6953125,effectiveStartValue:51213.6640625,effectiveEndValue:51225.359375});
  Object.assign(ref,reference());const before=structuredClone(ref.summaries);
  const organic=model.usage(ref,40,spec,[correction()]),p=core.periodRange(spec.startLocal,spec.endLocal,'minute',1);
  const result=core.analyzePeriodSummary(ref,{organic:{start:p.start,end:p.end,unit1:organic.allocation.unit1,unit2:organic.allocation.unit2},manure:{start:p.start,end:p.end,unit1:0,unit2:0}});
  assert.equal(result.units.unit2.bio.quantity,11.6953125);assert.deepEqual(ref.summaries,before);
});
