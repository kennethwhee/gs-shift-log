 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const m=require('../maintenance/cofiring-shared-scenario-v7.js');
const next={kind:'cofiring_period_summary_v1',schemaVersion:1,startLocal:'2026-10-24T00:00',endLocal:'2026-10-25T00:00',stepUnit:'minute',stepValue:1,organicInventoryReady:false,organicInventory:null,
 organicInventorySamples:[
 {key:'organicDaySilo',tag:'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT',startQuality:'Good',endQuality:'Good',startValue:15.71,endValue:8.099,startTime:'2026-10-23T23:59:49+09:00',endTime:'2026-10-24T23:59:48+09:00'},
 {key:'organicStorageSiloA',tag:'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT',startQuality:'Good',endQuality:'Good',startValue:43.862,endValue:32.144,startTime:'2026-10-23T23:59:52+09:00',endTime:'2026-10-24T23:59:46+09:00'},
 {key:'organicStorageSiloB',tag:'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT',startQuality:'Raw, Bad',endQuality:'Good',startValue:66.506,endValue:57.839,startTime:'2026-10-23T23:10:18+09:00',endTime:'2026-10-24T23:59:51+09:00'}]};
const copy=x=>JSON.parse(JSON.stringify(x));
test('Oct 24 displays the approved 19.143t scenario even when adjacent GET is absent',()=>{
 for(const peer of [null,undefined]){
  const out=m.scenario(next,175.43,next,peer);
  assert.ok(out);assert.equal(out.assumedStorageBTons,19.143);
  assert.equal(out.unitTons,78.0315);assert.equal(out.total,156.063);
  assert.equal(out.verified,false);assert.equal(out.provisional,true);
  assert.equal(out.peerConfirmedForPreview,false);assert.equal(out.receiptNeedsReview,true);
  assert.match(out.assumptionSource,/고정 가정/);
 }
});
test('Fall back is strictly tied to the SAME historical Bad source identity',()=>{
 const invalid=[
  o=>o.organicInventorySamples[2].startQuality='Raw, Good',
  o=>o.organicInventorySamples[2].startValue=58.5,
  o=>o.organicInventorySamples[2].startTime='2026-10-24T01:00:00+09:00',
  o=>o.organicInventorySamples[2].tag='other',
  o=>o.endLocal='2026-10-25T01:00',
  o=>o.organicInventorySamples[0].endQuality='Bad',
  o=>o.organicInventorySamples[1].startTime='2026-10-24T03:00:00+09:00'
 ];for(const change of invalid){const ref=copy(next);change(ref);assert.equal(m.scenario(ref,175.43,ref,null),null);}
});
test('Bad adjacent report is a real conflict, never silently overridden by fixed assumption',()=>{
 assert.equal(m.scenario(next,175.43,next,{}),null);
 assert.equal(m.scenario(next,175.43,next,{kind:'cofiring_period_summary_v1',schemaVersion:1,startLocal:'2026-10-23T00:00',endLocal:'2026-10-24T00:00',stepUnit:'minute',stepValue:1,organicInventoryReady:false,organicInventory:null,organicInventorySamples:[]}),null);
});
test('Actual original and save paths remain separate; approximation appears next to only organic',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');
 assert.match(ui,/cfv18-hypothesis-organic/);assert.match(ui,/cfv18-assumption-label/);assert.match(ui,/hypothesis\?'≈'/);
 assert.match(ui,/if\(total\.scenario\|\|total\.sharedScenarioPending\)throw new Error/);
 const index=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');assert.match(index,/cofiring-shared-scenario-v7\.js\?v=20261026-v8/);
});

test('real inventory correction UI exposes the fixed scenario without an adjacent fetch',()=>{
 const vm=require('node:vm');
 const environment=vm.createContext({
   CofiringInventoryCorrection:{
     localMinute:x=>Date.parse(String(x)+':00+09:00'),
     resolve:()=>({ok:true,provisional:true,missing:[{silo:'organicStorageSiloB',boundaryLocal:'2026-10-24T00:00',side:'start'}]}),
     usage:()=>({ok:true,provisional:true,allocation:{unit1:101.713,unit2:101.713}}),
     validCorrection:()=>true
   },
   CofiringSharedScenarioV7:m,
   CofiringSharedMidnightV6:{plan:()=>null},Promise,Date,console
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-inventory-correction-ui.js'),'utf8'),environment);
 const widget=environment.CofiringInventoryCorrectionUI.create({host:null,getHeaders:()=>({}),canEdit:()=>false});
 widget.setContext(next,next);
 const result=widget.usage(175.43);
 assert.ok(result.scenario);assert.equal(result.scenario.unitTons,78.0315);
 assert.notEqual(result.scenario.unitTons,result.allocation.unit1);
 assert.equal(result.scenario.verified,false);widget.dispose();
});
