import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Render the actual production UI against a saved D1 ledger snapshot. The
// deployed UI must never splice the old V-Belt total into the verified RUN hours.
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../maintenance/blower-history.html', import.meta.url), 'utf8');
const marker='  if (document.readyState === "loading") {';
assert.ok(source.includes(marker), 'original DOM readiness contract must be present');
function element(){ return {
  innerHTML:'',textContent:'',disabled:false,hidden:false,style:{},dataset:{},
  setAttribute(){},removeAttribute(){},showModal(){},close(){},addEventListener(){},
  classList:{toggle(){},add(){},remove(){}},getAttribute(){return null;},closest(){return null;},
  querySelector(){return null;},querySelectorAll(){return []}
}; }
const elements=new Map();
const window={matchMedia:()=>({matches:false}),setTimeout(fn){ /* dormant: do not run timed network */ return 0; }};
const document={readyState:'loading',body:element(),addEventListener(){},querySelectorAll(){return [];},
  getElementById(id){if(!elements.has(id)) elements.set(id,element());return elements.get(id);}};
const sandbox=vm.createContext({console,window,document,HTMLButtonElement:class{},
  localStorage:{getItem(){return null;}},navigator:{},
  URL,Date,Number,Intl,Map,Set});
const expose=`globalThis.v3h={state,elements,cacheElements,renderAllOverviewCard,renderAssetCard,openAssetHistory,verifiedLimestoneRunDisplay};\n`;
vm.runInContext(source.replace(marker,expose+marker), sandbox);
const ui=sandbox.v3h;ui.cacheElements();
const base={enabled:true,unitNo:'1',sortOrder:1,positionLabel:'#B',lastReplacementAt:'2026-09-22T00:00:00+09:00',
  cycleStartState:'legacy',cycleStartRevision:'first',cycleRuntimeRevision:'runtime',
  cycleElapsedHours:922.1,cycleRuntimeState:'running',runtimeAccumulationMode:'measured_only',
  dataParcTag:'GSPOGE.ABB_DCS.103HRJ01AN602XB04',isRunning:true,operationState:'running',severity:'normal',
  dataParcRuntimeBasis:{startAt:'2026-09-22T00:00:00+09:00',observedAt:'2026-10-30T10:31:00+09:00'}};
const tagList=['103HRJ01AN602','203HRJ01AN601','203HRJ01AN602'];
function asset(tag){return {...base, tagNumber:tag,blowerType:'limestone',
  displayName:`Limestone ${tag}`,unitNo:tag.startsWith('203')?'2':'1',
  cycleElapsedHours:tag==='203HRJ01AN601'?4080.1:tag==='203HRJ01AN602'?921.9:922.1,
  lastReplacementAt:tag==='203HRJ01AN601'?'2026-05-12T10:00:00+09:00':base.lastReplacementAt,
  dataParcTag:`GSPOGE.ABB_DCS.${tag}XB04`};}
function proof(a,seconds=24*3600+360){return {tagNumber:a.tagNumber, dataParcTag:a.dataParcTag,
  lastReplacementAt:a.lastReplacementAt,cycleStartRevision:a.cycleStartRevision,
  totalRunningSeconds:seconds,segmentCount:2,endState:'running',
  coverageStartAt:'2026-10-30T16:23:00+09:00', observedAt:'2026-10-31T16:30:00+09:00'};}
const assets=tagList.map(asset);
const ordinary={...base,blowerType:'flyash_bag',tagNumber:'104ETG30AN601',
  dataParcTag:'GSPOGE.ABB_DCS.104ETG30AN601XB04',positionLabel:'#A',cycleElapsedHours:865.8};
const limestone1A={...base,tagNumber:'103HRJ01AN601',dataParcTag:'GSPOGE.ABB_DCS.103HRJ01AN601XB04',cycleElapsedHours:1034.1};
ui.state.data={permissions:{canWrite:true},user:{name:'tester'},assets:[...assets,ordinary,limestone1A],
  limestoneRunTracking:assets.map(a=>proof(a)),events:[],types:[],settings:{},missingSlots:[],
  backfill:{hasRun:true,status:'complete'}};
function card(tag){return ui.renderAllOverviewCard(ui.state.data.assets.find(a=>a.tagNumber===tag));}

test('all three held Limestone cards use one prominent saved RUN measure and its real coverage period',()=>{
 for (const a of assets){
  const out=card(a.tagNumber);
  assert.match(out,/data-limestone-display="verified-ledger"/);
  assert.match(out,/<small>누적 기동시간<\/small><strong>24\.1시간<\/strong>/);
  assert.match(out,/2026-10-30 16:23.*2026-10-31 16:30/);
  assert.match(out,/검증구간 기준.*교체시각 미확정/);
  assert.doesNotMatch(out,/data-limestone-run-tracking|data-limestone-run-preview/);
  assert.doesNotMatch(out,/946\.2시간|4,104\.2시간|946\.0시간/);
  assert.match(out,/data-operation-state="running"/);
 }
});

test('normal Blower and Limestone 1A are byte-for-byte unaffected by ledger proof on other assets',()=>{
 const ordinaryBefore=ui.renderAllOverviewCard(ordinary);
 const oneABefore=ui.renderAllOverviewCard(limestone1A);
 ui.state.data.limestoneRunTracking=[...ui.state.data.limestoneRunTracking,proof(ordinary)];
 assert.equal(ui.renderAllOverviewCard(ordinary),ordinaryBefore);
 assert.equal(ui.renderAllOverviewCard(limestone1A),oneABefore);
 assert.doesNotMatch(ordinaryBefore,/data-limestone-display/);
 assert.match(ordinaryBefore,/865\.8시간/);
 assert.match(oneABefore,/1,034\.1시간/);
 ui.state.data.limestoneRunTracking=assets.map(a=>proof(a));
});

test('reloading a later ledger snapshot changes only the card metric and query period; never mutates official hours',()=>{
 const original=assets[0]; const originalHours=original.cycleElapsedHours;
 const before=card(original.tagNumber);
 ui.state.data.limestoneRunTracking=assets.map(a=>({...proof(a,24*3600+720),observedAt:'2026-10-31T16:38:00+09:00'}));
 const after=card(original.tagNumber);
 assert.match(before,/24\.1시간/);
 assert.match(after,/24\.2시간/);
 assert.equal(original.cycleElapsedHours,originalHours);
 ui.state.data.limestoneRunTracking=assets.map(a=>proof(a));
});

test('malformed or stale ledgers never become certified display values',()=>{
 const original=assets[1],valid=proof(original);
 const mutations=[
   {totalRunningSeconds:-1},{totalRunningSeconds:90000000000000000},
   {segmentCount:0},{endState:'unknown'},
   {dataParcTag:'GSPOGE.ABB_DCS.103HRJ01AN602XB04'},
   {lastReplacementAt:'2026-09-19T00:00:00+09:00'},
   {cycleStartRevision:'changed'},
   {coverageStartAt:'2026-11-01T00:00:00+09:00'},
   {observedAt:'invalid'},
   {coverageStartAt:'2026-05-01T00:00:00+09:00'},
   {totalRunningSeconds:100*3600}
 ];
 for (const override of mutations){
   ui.state.data.limestoneRunTracking=[{...valid,...override}];
   assert.equal(ui.verifiedLimestoneRunDisplay(original),null,JSON.stringify(override));
   assert.doesNotMatch(card(original.tagNumber),/data-limestone-display="verified-ledger"/);
 }
 ui.state.data.limestoneRunTracking=assets.map(a=>proof(a));
});

test('history dialog retains separate V-Belt legacy hours and proof, with an explicit no-add warning',()=>{
 const a=assets[0];
 ui.openAssetHistory(a.tagNumber);
 const out=ui.elements.historyCycleSummary.innerHTML;
 assert.match(out,/data-limestone-run-audit="true"/);
 assert.match(out,/DataPARC RUN 검증구간 누적: 24\.1시간/);
 assert.match(out,/기존 V-Belt 이력 누적: 922\.1시간/);
 assert.match(out,/두 기록을 합산하지 않았으며/);
 const detail=ui.renderAssetCard(a,null);
 assert.match(detail,/data-limestone-display="verified-ledger"/);
 assert.match(detail,/24\.1시간/);
 assert.match(detail,/데이터 조회 기간/);
 assert.doesNotMatch(detail,/data-limestone-run-tracking="true"/);
});

test('new V3-H JS is cache-busted while existing scheduler/core cache identities remain unchanged',()=>{
 assert.match(html,/blower-history\.js\?v=20261031-limestone-ledger-v3g-display-v3h/);
 assert.match(html,/blower-unified-refresh\.js\?v=20261031-limestone-ledger-v3g/);
 assert.match(html,/blower-schedule-v1\.js\?v=20261031-limestone-ledger-v3g/);
});
