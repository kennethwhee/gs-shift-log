 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const scenario=require('../maintenance/cofiring-shared-scenario-v7.js');
const S='2026-10-24T00:00',D={startLocal:S,endLocal:'2026-10-25T00:00',stepUnit:'minute',stepValue:1};
const B='organicStorageSiloB';
const tag={organicDaySilo:'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT',organicStorageSiloA:'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT',organicStorageSiloB:'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'};
const today={kind:'cofiring_period_summary_v1',schemaVersion:1,...D,organicInventoryReady:false,organicInventory:null,organicInventorySamples:[
 {key:'organicDaySilo',tag:tag.organicDaySilo,startQuality:'Raw, Good',endQuality:'Raw, Good',startValue:15.71,endValue:8.099,startTime:'2026-10-23T23:59:49+09:00',endTime:'2026-10-24T23:59:48+09:00'},
 {key:'organicStorageSiloA',tag:tag.organicStorageSiloA,startQuality:'Raw, Good',endQuality:'Raw, Good',startValue:43.862,endValue:32.144,startTime:'2026-10-23T23:59:52+09:00',endTime:'2026-10-24T23:59:46+09:00'},
 {key:B,tag:tag[B],startQuality:'Raw, Bad',endQuality:'Raw, Good',startValue:66.506,endValue:57.839,startTime:'2026-10-23T23:10:18+09:00',endTime:'2026-10-24T23:59:51+09:00'}
]};
const peer={kind:today.kind,schemaVersion:1,startLocal:'2026-10-23T00:00',endLocal:S,stepUnit:'minute',stepValue:1,organicInventoryReady:false,organicInventory:null,organicInventorySamples:[
 {key:'organicDaySilo',tag:tag.organicDaySilo,startQuality:'Raw, Good',endQuality:'Raw, Good',startValue:19.102,endValue:15.71,startTime:'2026-10-23T00:00:06+09:00',endTime:'2026-10-23T23:59:49+09:00'},
 {key:'organicStorageSiloA',tag:tag.organicStorageSiloA,startQuality:'Raw, Good',endQuality:'Raw, Good',startValue:45.15,endValue:43.862,startTime:'2026-10-23T00:00:10+09:00',endTime:'2026-10-23T23:59:52+09:00'},
 {key:B,tag:tag[B],startQuality:'Raw, Good',endQuality:'Raw, Bad',startValue:58.6328125,endValue:null,startTime:'2026-10-23T00:00:08+09:00',endTime:'2026-10-23T23:10:18+09:00',min:19.143,max:58.9,delta:null,durationGoodSeconds:83280,durationBadSeconds:3120,durationCoverageValid:true,boundaryValid:false,dataComplete:false}
]};
const copy=x=>JSON.parse(JSON.stringify(x));
const calc=p=>scenario.scenario(today,175.43,D,p);
test('authenticated same-period peer with missing ancillary quality fields is incomplete, not foreign',()=>{
 for(const mutation of [
  p=>{delete p.schemaVersion;},
  p=>{delete p.organicInventoryReady;delete p.organicInventory;},
  p=>{delete p.organicInventorySamples[2].min;},
  p=>{delete p.organicInventorySamples[2].durationBadSeconds;},
  p=>{p.organicInventorySamples[2].startQuality=null;},
  p=>{p.organicInventorySamples[2].durationGoodSeconds=null;},
  p=>{p.organicInventorySamples=[];}
 ]){
  const item=copy(peer);mutation(item);const verdict=scenario.peerForOct24(item);
  assert.ok(['incomplete','measured-min'].includes(verdict.status));const projected=calc(item);
  assert.ok(projected,'historical preview must be available for incomplete peer metadata');
  assert.equal(projected.verified,false);assert.equal(projected.unitTons,78.0315);
 }
});
test('actual 24th direct Bad source must be unchanged, and no peer is still hypothetical',()=>{
 const out=calc(null);assert.ok(out);assert.equal(out.assumedStorageBTons,19.143);
 assert.equal(out.startTotal,78.715);assert.equal(out.endTotal,98.082);
 assert.equal(out.total,156.063);assert.equal(out.unitTons,78.0315);
});
test('authentic conflicting start-date, measured minimum, Good endpoint, or amended TAG always blocks',()=>{
 const cases=[
  p=>{p.startLocal='2026-10-22T00:00';},
  p=>{p.organicInventorySamples[2].min=21.27;},
  p=>{p.organicInventorySamples[2].min=null;},
  p=>{p.organicInventorySamples[2].endValue=64.30;p.organicInventorySamples[2].endQuality='Good';p.organicInventorySamples[2].endTime='2026-10-24T00:00:02+09:00';},
  p=>{p.organicInventorySamples[2].tag='WRONG';},
  p=>{p.organicInventorySamples[2].delta=1.5;},
 ];
 for(const edit of cases){const item=copy(peer);edit(item);assert.equal(calc(item),null);}
});
test('confirmed saved physical midnight stock cannot be replaced by a 19.143t guess',()=>{
 const p=copy(peer);p.organicInventoryReady=true;p.organicInventory={end:{organicStorageSiloB:25.45}};
 assert.equal(scenario.peerForOct24(p).status,'confirmed-source');assert.equal(calc(p),null);
});
test('bad B identity, Bad source replaced by Good, or bad receipt cannot be forced into a display',()=>{
 for(const edit of [x=>x.organicInventorySamples[2].tag='other',x=>x.organicInventorySamples[2].startValue=80,x=>x.organicInventorySamples[2].startQuality='Good']){
  const c=copy(today);edit(c);assert.equal(scenario.scenario(c,175.43,D,null),null);
 }
 assert.equal(scenario.scenario(today,undefined,D,null),null);
});
test('result remains a non-persistent what-if projection',()=>{
 const usage=calc(peer);assert.ok(usage);assert.equal(usage.provisional,true);assert.equal(usage.verified,false);assert.equal(usage.receiptNeedsReview,true);
 assert.match(usage.assumption,/가정/);
});
test('the UI stops showing indefinite peer checking and keeps storage/close protections',()=>{
 const root=path.join(__dirname,'..');const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');const corr=fs.readFileSync(path.join(root,'maintenance/cofiring-inventory-correction-ui.js'),'utf8');const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.doesNotMatch(ui,/pendingHypothesis\?'가정 근거 확인 중'/);
 assert.match(ui,/pendingHypothesis\?'가정 계산 보류'/);
 assert.match(ui,/if\(total\.scenario\|\|total\.sharedScenarioPending\)throw new Error/);
 assert.match(ui,/if\(organicUsageState\?\.scenario\|\|organicUsageState\?\.sharedScenarioPending\)throw new Error/);
 assert.match(corr,/sharedScenarioReason/);
 assert.match(html,/peerQuality=20261026-v10/);
});
