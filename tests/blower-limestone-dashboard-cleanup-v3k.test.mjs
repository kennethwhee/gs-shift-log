import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Smoke the actual frontend source, not a duplicate miniature renderer.
const script = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../maintenance/blower-history.html', import.meta.url), 'utf8');
const listeners = [];
const mutations = [];
const fakeNode = () => ({innerHTML:'',textContent:'',hidden:false,disabled:false,dataset:{},style:{},
  setAttribute(){},removeAttribute(){},addEventListener(){},querySelector(){return null;},
  querySelectorAll(){return []},classList:{add(){},remove(){},toggle(){}}});
const elements = new Map();
const document = {readyState:'loading',body:fakeNode(),
  addEventListener(name,callback){listeners.push({name,callback});},
  querySelectorAll(){return [];},
  getElementById(id){if(!elements.has(id)) elements.set(id,fakeNode());return elements.get(id);},
  createElement(tag){mutations.push(tag);return fakeNode();}};
const window = {matchMedia:()=>({matches:false}),setTimeout(){return 0;},
  fetch(){throw Error('No network request is authorized by UI init');}};
const expose=`globalThis.cleanupV3K={state,renderAllOverviewCard,verifiedLimestoneRunDisplay};\n`;
const marker='  if (document.readyState === "loading") {';
assert.equal(script.split(marker).length,2,'DOM ready anchor changed');
const sandbox=vm.createContext({window,document,console,navigator:{},localStorage:{getItem(){return null;}},
  HTMLButtonElement:class{},Date,Number,Intl,Map,Set,URL});
vm.runInContext(script.replace(marker,expose+marker),sandbox);
const ui=sandbox.cleanupV3K;
const before='2026-10-30T10:31:19+09:00';
const after='2026-10-31T17:35:00+09:00';
function asset(tag, hours){return {tagNumber:tag,blowerType:'limestone',unitNo:tag.startsWith('203')?'2':'1',
  positionLabel:tag.endsWith('601')?'#A':'#B',displayName:tag,enabled:true,
  lastReplacementAt:tag==='203HRJ01AN601'?'2026-05-12T00:00:00+09:00':'2026-09-22T00:00:00+09:00',
  cycleStartState:'pending',cycleStartRevision:'r1',cycleRuntimeRevision:'r2',
  cycleElapsedHours:hours,cycleRuntimeHours:hours,cycleRuntimeState:'running',
  cycleRuntimeTracked:true,runtimeAccumulationMode:'measured_only',measurementRequired:false,isRunning:true,operationState:'running',
  dataParcTag:`GSPOGE.ABB_DCS.${tag}XB04`,dataParcRuntimeBasis:{
    startAt:tag==='203HRJ01AN601'?'2026-05-12T00:00:00+09:00':'2026-09-22T00:00:00+09:00',observedAt:before}};}
const assets=[asset('103HRJ01AN602',922.1),asset('203HRJ01AN601',4080.1),asset('203HRJ01AN602',921.9)];
const oneA=asset('103HRJ01AN601',1035.2);
const ordinary={...asset('104ETG30AN601',866.9),blowerType:'flyash_bag'};
function proof(a,observedAt=after){return {tagNumber:a.tagNumber,dataParcTag:a.dataParcTag,
  lastReplacementAt:a.lastReplacementAt,cycleStartRevision:'r1',segmentCount:4,totalRunningSeconds:25*3600,
  endState:'running',coverageStartAt:'2026-10-30T16:23:03+09:00',observedAt};}
ui.state.data={assets:[...assets,oneA,ordinary],limestoneRunTracking:assets.map(a=>proof(a)),
  events:[],types:[],settings:{},missingSlots:[],backfill:{hasRun:true,status:'complete'}};
const card = a=>ui.renderAllOverviewCard(a);

test('the separate 204SDF01AN002 recovery box is retired without breaking its guarded contract',()=>{
  assert.doesNotMatch(script,/gs-blower-boundary-recovery-v1|RUN 경계 정밀 복구|204SDF01AN002 경계 검증·복구/);
  assert.ok(window.GSBlowerBoundaryRecoveryV1);
  assert.equal(typeof window.GSBlowerBoundaryRecoveryV1.run,'function');
  assert.equal(listeners.filter(x=>x.name==='DOMContentLoaded').length,1,
    'only the original page initializer may register a DOMContentLoaded listener');
  assert.deepEqual(mutations,[],'no standalone recovery card/button should be constructed at module load');
  assert.doesNotMatch(page,/gs-blower-boundary-recovery-v1|RUN 경계 정밀 복구/);
});

test('three Limestone cards keep their previous checkpoint and show separately observed RUN time',()=>{
  for(const [i,a] of assets.entries()){
    const out=card(a);
    assert.match(out,/data-limestone-display="previous-checkpoint"/);
    assert.match(out,/이전 저장값 · 교체 기준 확인 필요/);
    assert.match(out,/data-limestone-run-asof="true"/);
    assert.match(out,/최근 RUN 확인 2026-10-31 17:35 · 누적 미반영/);
    assert.match(out,/데이터 조회 기간[\s\S]*2026-10-30 10:31/);
    assert.match(out,new RegExp(['922\\.1시간','4,080\\.1시간','921\\.9시간'][i]));
    assert.doesNotMatch(out,/25\.0시간|947\.1시간|4,105\.1시간|946\.9시간/);
  }
});

test('subsequent ledger time can advance without changing the previous V-Belt checkpoint',()=>{
  const a=assets[0]; const initial=card(a);
  ui.state.data.limestoneRunTracking=assets.map(x=>proof(x,'2026-10-31T17:51:00+09:00'));
  const updated=card(a);
  assert.match(initial,/RUN 확인 2026-10-31 17:35/);
  assert.match(updated,/RUN 확인 2026-10-31 17:51/);
  assert.match(updated,/922\.1시간/);
  assert.match(updated,/2026-10-30 10:31/);
  assert.doesNotMatch(updated,/25\.0시간/);
  ui.state.data.limestoneRunTracking=assets.map(x=>proof(x));
});

test('1A and unrelated blower cards keep their exact original markup',()=>{
  const oneABefore=card(oneA), ordinaryBefore=card(ordinary);
  ui.state.data.limestoneRunTracking=assets.map(x=>proof(x,'2026-10-31T18:03:00+09:00'));
  assert.equal(card(oneA),oneABefore);
  assert.equal(card(ordinary),ordinaryBefore);
  assert.doesNotMatch(card(oneA),/data-limestone-run-asof/);
  assert.doesNotMatch(card(ordinary),/data-limestone-run-asof/);
  ui.state.data.limestoneRunTracking=assets.map(x=>proof(x));
});

test('invalid or missing RUN proof is never shown as current or added to total',()=>{
  const a=assets[1];
  for(const bad of [null,{...proof(a),dataParcTag:'BAD'}, {...proof(a),totalRunningSeconds:-1},
    {...proof(a),observedAt:'malformed'}]){
    ui.state.data.limestoneRunTracking=bad?[bad]:[];
    const out=card(a);
    assert.doesNotMatch(out,/data-limestone-run-asof/);
    assert.match(out,/4,080\.1시간/);
    assert.match(out,/이전 저장값 · 교체 기준 확인 필요/);
  }
  ui.state.data.limestoneRunTracking=assets.map(x=>proof(x));
});

test('only blower history JS cache identity changes, no Agent or API bundle',()=>{
  assert.match(page,/blower-history\.js\?v=20261031-limestone-ledger-v3g-checkpoint-v3k-ui/);
  assert.match(page,/blower-unified-refresh\.js\?v=20261031-limestone-ledger-v3g/);
  assert.match(page,/blower-schedule-v1\.js\?v=20261031-limestone-ledger-v3g/);
});
