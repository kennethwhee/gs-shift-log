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


test('three disputed cards show 922.1, 4080.1, and 921.9 as last-known totals, never short-window RUN 24.1',()=>{
 const expected=new Map([['103HRJ01AN602','922.1'],['203HRJ01AN601','4,080.1'],['203HRJ01AN602','921.9']]);
 for(const [tag,hours] of expected){
  const out=card(tag);
  assert.match(out,/data-limestone-display="previous-checkpoint"/);
  assert.match(out,/<small>이전 저장 누적<\/small>/);
  assert.ok(out.includes(`<strong>${hours}시간</strong>`),tag);
  assert.doesNotMatch(out,/<small>누적 기동시간<\/small><strong>24\.1시간<\/strong>/);
  assert.doesNotMatch(out,/24\.1시간|24\.5시간|946\.2시간|4,104\.2시간|946\.0시간/);
 }
});

test('period on card comes from its original accumulation checkpoint, not newer ledger',()=>{
 for(const a of assets){
  a.dataParcRuntimeBasis={startAt:a.lastReplacementAt,observedAt:
    a.tagNumber==='203HRJ01AN601'?'2026-10-30T10:34:00+09:00':
    a.tagNumber==='203HRJ01AN602'?'2026-10-30T10:32:00+09:00':'2026-10-30T10:31:00+09:00'};
  const out=card(a.tagNumber);
  assert.match(out,/2026-10-30 10:(31|32|34)/);
  assert.doesNotMatch(out,/2026-10-31 16:30/);
  assert.match(out,/이전 저장값 · 교체 기준 확인 필요/);
 }
});

test('latest valid RUN state may show running without turning short history into belt total',()=>{
 const a=assets[0];
 const old=proof(a);
 ui.state.data.limestoneRunTracking=[{...old,endState:'stopped'},...assets.slice(1).map(a=>proof(a))];
 const out=card(a.tagNumber);
 assert.match(out,/data-operation-state="stopped"/);
 assert.match(out,/정지중/);
 assert.match(out,/922\.1시간/);
 assert.doesNotMatch(out,/24\.1시간/);
 ui.state.data.limestoneRunTracking=assets.map(a=>proof(a));
});

test('next RUN ledger append changes no previous checkpoint, and never adds it to official hours',()=>{
 const a=assets[2];const before=card(a.tagNumber);const value=a.cycleElapsedHours;
 ui.state.data.limestoneRunTracking=assets.map(x=>({...proof(x,30*3600),observedAt:'2026-10-31T22:23:00+09:00'}));
 const after=card(a.tagNumber);
 assert.equal(after,before);
 assert.equal(a.cycleElapsedHours,value);
 assert.match(after,/921\.9시간/);
 assert.doesNotMatch(after,/30\.0시간|951\.9시간/);
 ui.state.data.limestoneRunTracking=assets.map(a=>proof(a));
});

test('missing historical measurement must show required verification, not a fake total from RUN ledger',()=>{
 const a=assets[1];const last={hours:a.cycleElapsedHours,required:a.measurementRequired};
 a.cycleElapsedHours=null; a.measurementRequired=true;
 const out=card(a.tagNumber);
 assert.match(out,/최신화 필요/);
 assert.doesNotMatch(out,/4,080\.1시간|24\.1시간/);
 a.cycleElapsedHours=last.hours;a.measurementRequired=last.required;
});

test('Limestone 1A and existing Bag Filter remain unchanged by disputed 3-asset display',()=>{
 const a=card('103HRJ01AN601'),b=card('104ETG30AN601');
 assert.match(a,/1,034\.1시간/);
 assert.match(b,/865\.8시간/);
 assert.doesNotMatch(a,/이전 저장 누적|data-limestone-display/);
 assert.doesNotMatch(b,/이전 저장 누적|data-limestone-display/);
});

test('history reveals prior total and separate ledger proof without declaring a final belt cycle',()=>{
 ui.openAssetHistory(assets[0].tagNumber);
 const out=ui.elements.historyCycleSummary.innerHTML;
 assert.match(out,/이전 저장 누적/);
 assert.match(out,/922\.1시간/);
 assert.match(out,/DataPARC RUN 검증구간 누적: 24\.1시간/);
 assert.match(out,/합산하거나 전체 누적시간으로 확정하지 않습니다/);
 assert.doesNotMatch(out,/946\.2시간/);
});

test('cache identity changes only history.js; server ledger and scheduler remain untouched',()=>{
 assert.match(html,/blower-history\.js\?v=20261031-limestone-ledger-v3g-checkpoint-v3i/);
 assert.match(html,/blower-unified-refresh\.js\?v=20261031-limestone-ledger-v3g/);
 assert.match(html,/blower-schedule-v1\.js\?v=20261031-limestone-ledger-v3g/);
 const ledgerFile=fs.readFileSync(new URL('../functions/api/blower-history.js',import.meta.url),'utf8');
 assert.match(ledgerFile,/CREATE TABLE IF NOT EXISTS blower_limestone_run_segments_v1/);
});
