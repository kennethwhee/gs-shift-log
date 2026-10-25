'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'../maintenance');
const defs=[
  {key:'organicDaySilo',label:'Day Silo',tag:'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT'},
  {key:'organicStorageSiloA',label:'Storage Silo A',tag:'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT'},
  {key:'organicStorageSiloB',label:'Storage Silo B',tag:'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'}
];
const spec={startLocal:'2026-10-23T00:00',endLocal:'2026-10-24T00:00',stepUnit:'minute',stepValue:1};
const contract={good:quality=>quality==='Raw, Good',inventoryDefinitions:defs,period:s=>({startLocal:s.startLocal,endLocal:s.endLocal,startMs:Date.parse(s.startLocal+':00+09:00'),endMs:Date.parse(s.endLocal+':00+09:00'),durationMinutes:(Date.parse(s.endLocal+':00+09:00')-Date.parse(s.startLocal+':00+09:00'))/60000}),validateOrganicInventory:raw=>raw};
const core={organicInventoryUsage:(ref,receipt)=>({ok:true,basis:'dataparc-inventory-balance-v1',usage:receipt,allocation:{unit1:receipt/2,unit2:receipt/2},inventory:ref.organicInventory})};
const context=vm.createContext({CofiringCore:core,CofiringLiveContract:contract,Date,JSON,Number,Math,Map,Set,RegExp,Object,Array,String});
for(const relative of ['cofiring-inventory-correction.js','cofiring-communication-warning-v2.js'])vm.runInContext(fs.readFileSync(path.join(base,relative),'utf8'),context);
const model=context.CofiringInventoryCorrection,warning=context.CofiringCommunicationWarningV2;
function reference(){const pairs=[
  [7.813262939453125,15.709686279296875,'2026-10-22T23:59:19+09:00','2026-10-23T23:59:52+09:00',13.625],
  [56.435546875,43.8623046875,'2026-10-22T23:59:20+09:00','2026-10-23T23:59:43+09:00',34.664],
  [58.6328125,null,'2026-10-22T23:56:41+09:00','2026-10-23T23:10:18+09:00',3119.648]];
 return {...spec,kind:'cofiring_period_summary_v1',schemaVersion:1,organicInventoryReady:false,organicInventory:null,
  organicInventorySamples:defs.map((def,i)=>({...def,startValue:pairs[i][0],endValue:pairs[i][1],
    startQuality:'Raw, Good',endQuality:i===2?'Raw, Bad':'Raw, Good',startTime:pairs[i][2],endTime:pairs[i][3],
    durationGoodSeconds:86400-pairs[i][4],durationBadSeconds:pairs[i][4],durationCoverageValid:true,boundaryValid:i!==2,dataComplete:i!==2,
    min:i===2?30:0,max:i===2?70:100,delta:i===2?-18.5:0})),
  summaries:[{unit:'unit2',fuel:'bio',startQuality:'Raw, Good',endQuality:'Raw, Good',usageTon:11.6953125}]};
}
function correction(){return {silo:'organicStorageSiloB',boundaryLocal:spec.endLocal,tons:40,method:'confirmed',reason:'현장 확인',evidence:[],revision:1,updatedById:'id',updatedByName:'operator',updatedAt:'2026-10-25T06:00:00Z'};}
test('a DataPARC Delta can calculate a strictly provisional Storage B boundary without manual entry',()=>{
 const ref=reference(),original=structuredClone(ref);
 const out=model.usage(ref,40,spec,[],{enableAutoEstimate:true});
 assert.equal(out.ok,true);assert.equal(out.provisional,true);assert.equal(out.corrections.length,0);assert.equal(out.autoEstimates.length,1);
 assert.equal(out.autoEstimates[0].silo,'organicStorageSiloB');
 assert.equal(out.autoEstimates[0].tons,40.132813);
 assert.equal(out.inventory.end.organicStorageSiloB,40.132813);
 assert.equal(out.inventory.samples[2].endValue,null,'original bad reading remains bad');
 assert.equal(out.inventory.samples[2].endQuality,'Raw, Bad');
 assert.equal(out.inventory.boundaries.end.organicStorageSiloB.source,'dataparc-estimate');
 assert.equal(out.basis,'dataparc-estimated-inventory-balance-v2');
 assert.deepEqual(ref,original,'no mutation of the source report');
 assert.equal(out.allocation.unit1,out.allocation.unit2,'existing 50:50 allocation');
 assert.match(warning.messages(ref,out).join('\n'),/1·2호기 유기성 고형연료\(Storage B\).*10월 24일 00:00.*추정값.*재확인/);
 assert.doesNotMatch(warning.messages(ref,out).join('\n'),/2호기 Bio/,'unrelated Bio must not be labelled invalid');
});
test('good source and manual confirmed source are never replaced by automation',()=>{
 const good=reference();good.organicInventorySamples[2].endValue=39.5;good.organicInventorySamples[2].endQuality='Raw, Good';good.organicInventorySamples[2].endTime=spec.endLocal+':00+09:00';good.organicInventorySamples[2].boundaryValid=true;good.organicInventorySamples[2].dataComplete=true;
 assert.equal(model.usage(good,40,spec,[],{enableAutoEstimate:true}).provisional,false);
 assert.equal(model.usage(good,40,spec,[],{enableAutoEstimate:true}).autoEstimates?.length||0,0);
 const ref=reference(),confirmed=model.usage(ref,40,spec,[correction()],{enableAutoEstimate:true});
 assert.equal(confirmed.ok,true);assert.equal(confirmed.provisional,false);assert.equal(confirmed.autoEstimates.length,0);assert.equal(confirmed.inventory.end.organicStorageSiloB,40);
 assert.equal(model.usage(ref,40,spec,[]).ok,false,'opt-in prevents changing legacy direct computations');
});
test('wide gaps, stale times, unbounded delta and missing stats must never invent inventory',()=>{
 const mutations=[
  r=>{r.organicInventorySamples[2].durationBadSeconds=5401;r.organicInventorySamples[2].durationGoodSeconds=86400-5401;},
  r=>r.organicInventorySamples[2].endTime='2026-10-23T20:00:00+09:00',
  r=>r.organicInventorySamples[2].delta=null,
  r=>r.organicInventorySamples[2].delta=-100,
  r=>r.organicInventorySamples[2].min=55,
  r=>r.organicInventorySamples[2].durationCoverageValid=false
 ];
 for(const mutate of mutations){const ref=reference();mutate(ref);const out=model.usage(ref,40,spec,[],{enableAutoEstimate:true});assert.equal(out.ok,false);assert.equal(out.usage,null);assert.equal(out.code==='ORGANIC_BOUNDARY_CORRECTION_REQUIRED'||out.code==='ORGANIC_INVENTORY_INVALID',true);}
});
test('banner reports actual unit and fuel for separate counters, hides for healthy result, and escapes via textContent',()=>{
 const good={startLocal:spec.startLocal,endLocal:spec.endLocal,summaries:[{unit:'unit2',fuel:'bio',startQuality:'Raw, Good',endQuality:'Raw, Good'}]};
 assert.deepEqual(Array.from(warning.messages(good,{missing:[]})),[]);
 const withBad=structuredClone(good);withBad.summaries[0].endQuality='No Data, Bad';
 assert.match(warning.messages(withBad,{missing:[]})[0],/2호기 Bio.*10월 24일 00:00/);
 const host={hidden:false,textContent:'stale <script>'};
 warning.render(host,good,{missing:[]});assert.equal(host.hidden,true);assert.equal(host.textContent,'');
 warning.render(host,withBad,{missing:[]});assert.equal(host.hidden,false);assert.match(host.textContent,/2호기 Bio/);
});
test('banner appears in the real summary source without changing fuel cards, and cache busts the right bundle',()=>{
 const ui=fs.readFileSync(path.join(base,'cofiring-period-ui-v5.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.ok(ui.indexOf('data-cfv-communication-warning')<ui.indexOf('<div class="cfv52-summary-head">'));
 assert.match(ui,/communicationWarning\?\.render/);
 assert.match(html,/cofiring-communication-warning-v2\.js\?v=20261026-(?:auto-v2|quality-v3)/);
 assert.match(html,/cofiring-communication-warning-v2\.css\?v=20261026-(?:auto-v2|quality-v3|oct23-v4)/);
 assert.match(html,/cofiring-inventory-correction\.js\?v=20261026-auto-v2/);
});
