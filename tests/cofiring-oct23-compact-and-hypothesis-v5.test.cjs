'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'..');
const moduleNotice=require('../maintenance/cofiring-communication-warning-v2.js');
const scenario=require('../maintenance/cofiring-organic-scenario-v5.js');
const period={startLocal:'2026-10-23T00:00',endLocal:'2026-10-24T00:00',stepUnit:'minute',stepValue:1};
const definitions=[
 ['organicDaySilo',7.813262939453125,15.709686279296875,5.61981201171875,20.211029052734375],
 ['organicStorageSiloA',56.435546875,43.8623046875,0,105.56884765625],
 ['organicStorageSiloB',58.6328125,null,19.14306640625,58.9990234375]
];
function fixture(){return {...period,organicInventoryReady:false,organicInventory:null,
 organicInventorySamples:definitions.map(([key,startValue,endValue,min,max],i)=>({key,startValue,endValue,min,max,
  startQuality:'Raw, Good',endQuality:i===2?'Raw, Bad':'Raw, Good',
  boundaryValid:i!==2,dataComplete:i!==2,delta:i===2?null:1,
  durationGoodSeconds:i===2?83280.352:86380,durationBadSeconds:i===2?3119.648:20,
  durationCoverageValid:true})),summaries:[
  {unit:'unit1',fuel:'coal',startQuality:'Raw, Good',endQuality:'Raw, Good',durationBadSeconds:25.2,dataComplete:true},
  {unit:'unit2',fuel:'bio',startQuality:'Raw, Good',endQuality:'Raw, Good',durationBadSeconds:35.33,dataComplete:true}]};}
function missing(){return {ok:false,code:'ORGANIC_BOUNDARY_CORRECTION_REQUIRED',missing:[{silo:'organicStorageSiloB',side:'end',boundaryLocal:'2026-10-24T00:00'}]};}
function host(){return {hidden:true,textContent:'',title:'',dataset:{}};}
test('10/23 compact main banner names only one true blocker, while preserving all source diagnostics',()=>{
 const input=fixture(),original=JSON.stringify(input),h=host();
 const raw=moduleNotice.notices(input,missing());
 assert.ok(raw.length>=3,'raw diagnostic notices are retained');
 const returned=moduleNotice.render(h,input,missing());
 assert.deepEqual(returned.map(x=>x),raw.map(x=>x.text),'API returns all original diagnostics');
 assert.match(h.textContent,/Storage B.*10월 24일 00:00.*원본 재고 계측 오류/);
 assert.doesNotMatch(h.textContent,/25\.2초|35\.3초| \/ /);
 assert.ok(h.textContent.length<100,'single short line');
 assert.ok(h.title.includes('1호기 Coal'),'original diagnostics are accessible in tooltip');
 assert.equal(h.dataset.tone,'warning');assert.equal(JSON.stringify(input),original);
});
test('no missing organic boundary leaves existing full quality warning and clean-case behavior unchanged',()=>{
 const input=fixture(),h=host(),ret=moduleNotice.render(h,input,{ok:true,missing:[]});
 assert.equal(ret.length,2);assert.match(h.textContent,/25\.2초/);
 const clean=host();moduleNotice.render(clean,{...input,summaries:[]},{ok:true,missing:[]});assert.equal(clean.hidden,true);
});
test('actual 10/23 samples produce read-only approximate 50:50 what-if, not verified inventory',()=>{
 const input=fixture(),original=JSON.stringify(input);
 const x=scenario.scenario(input,89.62,period);
 assert.equal(x.kind,'what-if-not-measured');assert.equal(x.verified,false);
 assert.equal(x.assumedEnd,19.14306640625);assert.ok(Math.abs(x.total-133.78656494140625)<1e-8);
 assert.ok(Math.abs(x.unitTons-66.89328247070313)<1e-8);
 assert.equal(JSON.stringify(input),original);
 assert.ok(!('usage' in input));
});
test('what-if fails closed when an assumption is unsupported, a counter is missing, or receipt is absent',()=>{
 const input=fixture();
 for(const receipt of [null,NaN,-1,'89.62'])assert.equal(scenario.scenario(input,receipt,period),null);
 const mutations=[
  f=>f.organicInventorySamples[2].min=null,
  f=>f.organicInventorySamples[2].delta=1,
  f=>f.organicInventorySamples[2].endValue=5,
  f=>f.organicInventorySamples[2].durationBadSeconds=7200,
  f=>f.organicInventorySamples[2].endQuality='Raw, Good',
  f=>f.organicInventorySamples[1].endValue=null,
  f=>f.organicInventorySamples[0].startQuality='Raw, Bad',
  f=>f.organicInventoryReady=true,
  f=>f.organicInventory={},
  f=>f.endLocal='2026-10-25T00:00',
 ];
 for(const mutation of mutations){const f=fixture();mutation(f);assert.equal(scenario.scenario(f,89.62,period),null);}
});
test('production UI shows clearly labelled scenario but never inserts it into calculation inputs or close',()=>{
 const ui=fs.readFileSync(path.join(dir,'maintenance/cofiring-period-ui-v5.js'),'utf8');
 const index=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 assert.match(ui,/total\.scenario=root\.CofiringOrganicScenarioV5\?\.scenario\?\./);
 assert.match(ui,/가정 ≈/);assert.match(ui,/확정 사용량 아님 · 저장 불가/);
 assert.match(ui,/mv\[u\]\.organic=organicUsageState\?\.ok\?organicUsageState\.allocation\[u\]:null/);
 assert.match(ui,/if\(organicUsageState\?\.ok!==true\)throw new Error/);
 assert.match(ui,/b\.disabled=!lastResult\|\|mobile\|\|organicUsageState\?\.ok!==true/);
 assert.match(index,/cofiring-organic-scenario-v5\.js\?v=20261026-v5/);
 assert.match(index,/cofiring-communication-warning-v2\.js\?v=20261026-quality-v3&amp;compact=20261026-v5&amp;shared=20261026-v6/);
});
