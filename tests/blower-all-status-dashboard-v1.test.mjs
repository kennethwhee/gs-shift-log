import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(process.argv[2]||process.cwd());
const source=fs.readFileSync(path.join(root,'maintenance/blower-history.js'),'utf8');
const css=fs.readFileSync(path.join(root,'maintenance/blower-history.css'),'utf8');
const html=fs.readFileSync(path.join(root,'maintenance/blower-history.html'),'utf8');
function node(){return{innerHTML:'',textContent:'',hidden:false,disabled:false,dataset:{},title:'',classList:{toggle(){},add(){},remove(){}},setAttribute(){},removeAttribute(){},closest(){return null;},addEventListener(){},focus(){}};}
const nodes=new Map();
const context=vm.createContext({console,HTMLButtonElement:class{},localStorage:{getItem:()=>null},document:{readyState:'loading',body:node(),querySelectorAll:()=>[],addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);}},window:{matchMedia:()=>({matches:false}),setTimeout(fn){fn();}}});
const marker='  if (document.readyState === "loading") {';
const expose='globalThis.ui={state,elements,cacheElements,renderTypeTabs,renderAssets,renderStatusFilters};\n';
vm.runInContext(source.replace(marker,expose+marker),context);
const ui=context.ui; ui.cacheElements();
ui.state.data={permissions:{canWrite:true},user:{name:'Tester'},backfill:{hasRun:true,status:'complete'},types:[
  {key:'fbhe',label:'FBHE Blower'},{key:'seal_pot',label:'Seal Pot Blower'},{key:'organic_fuel',label:'유기성 Blower'},{key:'flyash_bag',label:'Fly Ash Bag Filter Aeration Blower'}],
  settings:{},missingSlots:[],events:[],assets:[
  {tagNumber:'104HHL60AP611',blowerType:'fbhe',unitNo:'1',positionLabel:'#A',displayName:'#1 FBHE #A',sortOrder:1,lastReplacementAt:'2026-08-20T02:00:00.000Z',cycleStartState:'started',cycleStartedAt:'2026-08-20T02:00:00.000Z',cycleElapsedHours:370.5,cycleRuntimeTracked:true,cycleRuntimeState:'running',isRunning:true,severity:'normal',dataParcRuntimeBasis:{startAt:'2026-08-20T02:00:00.000Z',observedAt:'2026-09-11T00:12:00.000Z'}},
  {tagNumber:'104HHL10AN631',blowerType:'seal_pot',unitNo:'1',positionLabel:'#C',displayName:'#1 Seal Pot #C',sortOrder:3,lastReplacementAt:'2026-06-05T00:00:00.000Z',cycleStartState:'started',cycleElapsedHours:2310.5,cycleRuntimeTracked:true,cycleRuntimeState:'stopped',isRunning:false,severity:'warning'},
  {tagNumber:'204SDF01AN002',blowerType:'organic_fuel',unitNo:'2',positionLabel:'#B',displayName:'#2 유기성 #B',sortOrder:2,lastReplacementAt:'2026-07-24T10:00:00.000Z',cycleStartState:'started',cycleElapsedHours:296.3,cycleRuntimeTracked:true,cycleRuntimeState:'stopped',runtimeAccumulationMode:'measured_only',isRunning:false,severity:'normal',dataParcRuntimeBasis:{startAt:'2026-07-24T10:00:00.000Z',observedAt:'2026-09-09T17:56:00.000Z'}},
  {tagNumber:'104ETG30AN601',blowerType:'flyash_bag',unitNo:'1',positionLabel:'#A',displayName:'#1 Fly Ash Bag #A',sortOrder:1,lastReplacementAt:'2026-05-10T00:00:00.000Z',cycleStartState:'started',cycleElapsedHours:2934.6,cycleRuntimeTracked:true,cycleRuntimeState:'running',runtimeAccumulationMode:'measured_only',isRunning:true,severity:'normal',dataParcRuntimeBasis:{startAt:'2026-05-10T00:00:00.000Z',observedAt:'2026-09-09T06:36:00.000Z'}}
]};

test('page lands on one-screen all blower dashboard with every type available',()=>{
  assert.equal(ui.state.activeType,'all');
  ui.renderTypeTabs(); ui.renderStatusFilters(); ui.renderAssets();
  assert.match(ui.elements.typeTabs.innerHTML,/data-type="all"[\s\S]*전체 현황/);
  for(const label of ['FBHE Blower','Seal Pot Blower','유기성 Blower','Fly Ash Bag Filter Aeration Blower']) assert.match(ui.elements.assetGroups.innerHTML,new RegExp(label));
  for(const tag of ['104HHL60AP611','104HHL10AN631','204SDF01AN002','104ETG30AN601']) assert.match(ui.elements.assetGroups.innerHTML,new RegExp(tag));
  assert.match(ui.elements.assetGroups.innerHTML,/데이터 조회 기간/);
  assert.match(ui.elements.assetGroups.innerHTML,/data-asset-action="history"/);
});

test('asset card visible source heading uses 데이터 조회 기간 instead of DataPARC',()=>{
  const cardSection=source.slice(source.indexOf('function renderAssetCard'),source.indexOf('function compareAssetDisplayEntries'));
  assert.match(cardSection,/데이터 조회 기간/);
  assert.doesNotMatch(cardSection,/<span>DataPARC<\/span>/);
});

test('dashboard keeps intermittent equipment out of instantaneous running/stopped display while Fly Ash still shows queried RUN state',()=>{
  ui.renderAssets();
  const out=ui.elements.assetGroups.innerHTML;
  assert.match(out,/간헐운전 대상/);
  assert.match(out,/<span>현재 기동<\/span><strong>2대<\/strong>/);
  assert.match(out,/<span>현재 정지<\/span><strong>1대<\/strong>/);
  assert.match(out,/<span>간헐운전 대상<\/span><strong>1대<\/strong>/);
  const organic=out.match(/<button[^>]*data-tag="204SDF01AN002"[\s\S]*?<\/button>/)?.[0]||'';
  assert.match(organic,/data-operation-mode="intermittent"/);
  assert.match(organic,/data-operation-state="intermittent"/);
  assert.match(organic,/간헐운전/);
  assert.doesNotMatch(organic,/기동중|정지중/);
  assert.doesNotMatch(organic,/operation-pill (?:running|stopped)/);
  assert.doesNotMatch(organic,/조회값 반영/);
  const flyash=out.match(/<button[^>]*data-tag="104ETG30AN601"[\s\S]*?<\/button>/)?.[0]||'';
  assert.match(flyash,/data-operation-state="running"/);
  assert.match(flyash,/기동중/);
  assert.doesNotMatch(flyash,/조회값 반영/);
});

test('dashboard separates blower types into visible 1호기/2호기 unit panels',()=>{
  ui.renderAssets();
  const out=ui.elements.assetGroups.innerHTML;
  assert.match(out,/data-overview-type="fbhe"[\s\S]*?data-unit-kind="unit-1"[\s\S]*?<strong>1호기<\/strong>/);
  assert.match(out,/data-overview-type="organic_fuel"[\s\S]*?data-unit-kind="unit-2"[\s\S]*?<strong>2호기<\/strong>/);
  assert.match(out,/data-unit-count="/);
  assert.match(source,/groupKey === "manure"[\s\S]*?label: "축분"/);
  assert.match(source,/blowerType === "flyash_silo"[\s\S]*?label: "1·2호기 공용"/);
});

test('dashboard styles keep the six-item summary but group cards inside colored unit subpanels',()=>{
  assert.match(css,/\.all-overview-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,/);
  assert.match(css,/\.all-overview-unit-layout\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
  assert.match(css,/\.all-overview-unit-panel\[data-unit-kind="unit-1"\][\s\S]*?background:\s*#eef7ff/);
  assert.match(css,/\.all-overview-unit-panel\[data-unit-kind="unit-2"\][\s\S]*?background:\s*#effaf3/);
  assert.match(css,/\.all-overview-unit-panel\[data-unit-kind="shared"\][\s\S]*?background:\s*#f5f1ff/);
  assert.match(css,/\.all-overview-unit-card-grid\[data-card-count="3"\][\s\S]*?repeat\(3,/);
  assert.match(css,/operation-mode-pill\.intermittent/);
  assert.match(html,/blower-history\.css\?v=20260911-mobile-refresh-hide-only-v10-r1/);
  assert.match(html,/blower-unified-refresh\.js\?v=20260911-fast-manual-resume-v11/);
  assert.match(html,/blower-history\.js\?v=20260911-fast-manual-resume-v11/);
});
