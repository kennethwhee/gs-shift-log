'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const scenario=require('../maintenance/cofiring-shared-scenario-v7.js');
const B='organicStorageSiloB',SEAM='2026-10-24T00:00';
const period={startLocal:SEAM,endLocal:'2026-10-25T00:00',stepUnit:'minute',stepValue:1};
const tags={organicDaySilo:'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT',organicStorageSiloA:'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT',organicStorageSiloB:'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'};
const reference={kind:'cofiring_period_summary_v1',schemaVersion:1,...period,organicInventoryReady:false,organicInventory:null,organicInventorySamples:[
 {key:'organicDaySilo',tag:tags.organicDaySilo,startQuality:'Raw, Good',endQuality:'Raw, Good',startValue:15.71,endValue:8.099,startTime:'2026-10-23T23:59:49+09:00',endTime:'2026-10-24T23:59:48+09:00'},
 {key:'organicStorageSiloA',tag:tags.organicStorageSiloA,startQuality:'Raw, Good',endQuality:'Raw, Good',startValue:43.862,endValue:32.144,startTime:'2026-10-23T23:59:52+09:00',endTime:'2026-10-24T23:59:46+09:00'},
 {key:B,tag:tags[B],startQuality:'Raw, Bad',endQuality:'Raw, Good',startValue:66.506,endValue:57.839,startTime:'2026-10-23T23:10:18+09:00',endTime:'2026-10-24T23:59:51+09:00'}
]};
const peer={startLocal:'2026-10-23T00:00',endLocal:SEAM,organicInventoryReady:false,organicInventory:null,organicInventorySamples:[
 {...reference.organicInventorySamples[0],startValue:19.102,endValue:15.71},
 {...reference.organicInventorySamples[1],startValue:45.15,endValue:43.862},
 {key:B,tag:tags[B],startQuality:'Raw, Good',endQuality:'Raw, Bad',startValue:58.6328125,endValue:null,startTime:'2026-10-23T00:00:08+09:00',endTime:'2026-10-23T23:10:18+09:00',min:19.143,max:58.9,delta:null,durationGoodSeconds:83280,durationBadSeconds:3120,durationCoverageValid:true,boundaryValid:false,dataComplete:false}
]};
const copy=x=>JSON.parse(JSON.stringify(x));
const bad=v=>{const x=copy(reference);v(x.organicInventorySamples[2],x);return x;};
test('strict saved-value validation remains unchanged when Bad row differs',()=>{
 for(const x of [bad(b=>b.startValue=78),bad(b=>b.startTime='2026-10-24T00:00:03+09:00'),bad(b=>b.startValue=null)]){
   assert.equal(scenario.scenario(x,175.43,period,peer),null);
 }
});
test('display-only historical 19.143t assumption tolerates shifted Bad readings at the same midnight',()=>{
 const examples=[
   bad(b=>b.startValue=78),
   bad(b=>{b.startTime='2026-10-24T00:00:03+09:00';b.startValue=40.12;}),
   bad(b=>{b.startValue=null;b.startQuality='No Data, Bad';b.startTime='2026-10-24T00:00:00+09:00';}),
   bad(b=>{b.startValue=12.3;b.startTime='2026-10-23T22:15:00+09:00';})
 ];
 for(const x of examples){
   const result=scenario.displayScenario(x,175.43,period,peer);
   assert.ok(result,'only a read-only WHAT-IF should project');
   assert.equal(result.assumedStorageBTons,19.143);
   assert.equal(result.startTotal,78.715);
   assert.equal(result.endTotal,98.082);
   assert.equal(result.unitTons,78.0315);
   assert.equal(result.verified,false);assert.equal(result.provisional,true);
   assert.equal(result.badBoundarySourceIgnoredForPreview,true);
   assert.match(result.assumptionSource,/Bad 품질/);
   assert.equal(scenario.isScenario(result),true);
 }
});
test('no guessing for Good, unknown, off-date, foreign TAG, no reliable other silos or receipts',()=>{
 const unsafe=[
  bad(b=>b.startQuality='Raw, Good'),
  bad(b=>b.startQuality='unverified'),
  bad(b=>b.startTime='2026-10-24T05:00:00+09:00'),
  bad(b=>b.startTime='2026-10-23T16:00:00+09:00'),
  bad(b=>b.tag='WRONG TAG'),
  bad((b,x)=>x.endLocal='2026-10-26T00:00'),
  bad((b,x)=>x.organicInventorySamples[0].startTime='2026-10-24T03:00:00+09:00'),
  bad((b,x)=>x.organicInventorySamples[1].endQuality='Raw, Bad'),
  bad(b=>b.endQuality='Raw, Bad'),
  bad(b=>b.startValue=-1)
 ];
 for(const x of unsafe)assert.equal(scenario.displayScenario(x,175.43,period,peer),null);
 assert.equal(scenario.displayScenario(reference,null,period,peer),null);
});
test('read-only diagnostics distinguish a good endpoint, wrong tag and out-of-window Bad timestamp',()=>{
 const good=bad(b=>b.startQuality='Raw, Good');
 const tag=bad(b=>b.tag='WRONG');
 const time=bad(b=>b.startTime='2026-10-24T05:00:00+09:00');
 assert.match(scenario.scenarioReason(good,175.43,period,peer),/Good/);
 assert.match(scenario.scenarioReason(tag,175.43,period,peer),/TAG/);
 assert.match(scenario.scenarioReason(time,175.43,period,peer),/시각/);
});
test('confirmed neighboring midnight, incorrect historical minimum and foreign neighbor still block display',()=>{
 const current=bad(b=>b.startValue=80);
 const confirmed=copy(peer);confirmed.organicInventoryReady=true;confirmed.organicInventory={end:{organicStorageSiloB:25.45}};
 assert.equal(scenario.displayScenario(current,175.43,period,confirmed),null);
 const mismatched=copy(peer);mismatched.organicInventorySamples[2].min=25.45;
 assert.equal(scenario.displayScenario(current,175.43,period,mismatched),null);
 const foreign=copy(peer);foreign.endLocal='2026-10-25T00:00';
 assert.equal(scenario.displayScenario(current,175.43,period,foreign),null);
});
test('actual correction UI uses strict then display-only branch without changing official usage or save guards',()=>{
 const environment=vm.createContext({Promise,Date,console,
   CofiringInventoryCorrection:{localMinute:x=>Date.parse(String(x)+':00+09:00'),resolve:()=>({ok:true,provisional:true,missing:[{silo:B,boundaryLocal:SEAM,side:'start'}]}),usage:()=>({ok:true,provisional:true,allocation:{unit1:101.713,unit2:101.713}}),validCorrection:()=>true},
   CofiringSharedMidnightV6:{plan:()=>null},CofiringSharedScenarioV7:scenario});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-inventory-correction-ui.js'),'utf8'),environment);
 const ui=environment.CofiringInventoryCorrectionUI.create({host:null,canEdit:()=>false,getHeaders:()=>({})});
 ui.setContext(period,bad(b=>{b.startValue=47;b.startTime='2026-10-24T00:00:00+09:00';}));
 const v=ui.usage(175.43);assert.ok(v.scenario);assert.equal(v.scenario.unitTons,78.0315);
 assert.equal(v.allocation.unit1,101.713);assert.equal(v.provisional,true);
 assert.equal(v.scenario.verified,false);ui.dispose();
 const src=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');
 assert.match(src,/if\(total\.scenario\|\|total\.sharedScenarioPending\)throw new Error/);
 assert.match(src,/if\(organicUsageState\?\.scenario\|\|organicUsageState\?\.sharedScenarioPending\)throw new Error/);
});
test('version bumps both changed browser modules without duplicate script includes',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.match(html,/peerQuality=20261026-v10/);
 assert.match(html,/badPreview=20261026-v11/);
 assert.match(html,/displayBadPreview=20261026-v11/);
 for(const name of ['cofiring-shared-scenario-v7.js','cofiring-inventory-correction-ui.js'])assert.equal((html.match(new RegExp('/maintenance/'+name.replaceAll('.','\\.')+'\\?','g'))||[]).length,1);
});
