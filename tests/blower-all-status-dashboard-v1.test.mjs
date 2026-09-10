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
  {key:'fbhe',label:'FBHE Blower'},{key:'seal_pot',label:'Seal Pot Blower'},{key:'organic_fuel',label:'유기성 Blower'}],
  settings:{},missingSlots:[],events:[],assets:[
  {tagNumber:'104HHL60AP611',blowerType:'fbhe',unitNo:'1',positionLabel:'#A',displayName:'#1 FBHE #A',sortOrder:1,lastReplacementAt:'2026-08-20T02:00:00.000Z',cycleStartState:'started',cycleStartedAt:'2026-08-20T02:00:00.000Z',cycleElapsedHours:370.5,cycleRuntimeTracked:true,cycleRuntimeState:'running',isRunning:true,severity:'normal',dataParcRuntimeBasis:{startAt:'2026-08-20T02:00:00.000Z',observedAt:'2026-09-11T00:12:00.000Z'}},
  {tagNumber:'104HHL10AN631',blowerType:'seal_pot',unitNo:'1',positionLabel:'#C',displayName:'#1 Seal Pot #C',sortOrder:3,lastReplacementAt:'2026-06-05T00:00:00.000Z',cycleStartState:'started',cycleElapsedHours:2310.5,cycleRuntimeTracked:true,cycleRuntimeState:'stopped',isRunning:false,severity:'warning'},
  {tagNumber:'204SDF01AN002',blowerType:'organic_fuel',unitNo:'2',positionLabel:'#B',displayName:'#2 유기성 #B',sortOrder:2,lastReplacementAt:'2026-07-24T10:00:00.000Z',cycleStartState:'started',cycleElapsedHours:296.3,cycleRuntimeTracked:true,cycleRuntimeState:'stopped',runtimeAccumulationMode:'measured_only',isRunning:false,severity:'normal',dataParcRuntimeBasis:{startAt:'2026-07-24T10:00:00.000Z',observedAt:'2026-09-09T17:56:00.000Z'}}
]};

test('page lands on one-screen all blower dashboard with every type available',()=>{
  assert.equal(ui.state.activeType,'all');
  ui.renderTypeTabs(); ui.renderStatusFilters(); ui.renderAssets();
  assert.match(ui.elements.typeTabs.innerHTML,/data-type="all"[\s\S]*전체 현황/);
  for(const label of ['FBHE Blower','Seal Pot Blower','유기성 Blower']) assert.match(ui.elements.assetGroups.innerHTML,new RegExp(label));
  for(const tag of ['104HHL60AP611','104HHL10AN631','204SDF01AN002']) assert.match(ui.elements.assetGroups.innerHTML,new RegExp(tag));
  assert.match(ui.elements.assetGroups.innerHTML,/데이터 조회 기간/);
  assert.match(ui.elements.assetGroups.innerHTML,/data-asset-action="history"/);
});

test('asset card visible source heading uses 데이터 조회 기간 instead of DataPARC',()=>{
  const cardSection=source.slice(source.indexOf('function renderAssetCard'),source.indexOf('function compareAssetDisplayEntries'));
  assert.match(cardSection,/데이터 조회 기간/);
  assert.doesNotMatch(cardSection,/<span>DataPARC<\/span>/);
});

test('dashboard styles use a compact six-column desktop grid and cache is bumped',()=>{
  assert.match(css,/\.all-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,/);
  assert.match(html,/blower-history\.css\?v=20260911-all-dashboard-v1/);
  assert.match(html,/blower-history\.js\?v=20260911-all-dashboard-v1/);
});
