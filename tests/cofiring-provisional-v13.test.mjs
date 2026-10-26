import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const FILE=path.join(import.meta.dirname,'../maintenance/cofiring-provisional-v12.js');
const SOURCE=fs.readFileSync(FILE,'utf8');
const ratio=(bio,organic)=>({bioRatio:bio,organicGroupRatio:organic,totalRatio:bio+organic});
function record(date='2026-10-24'){
 const one={coal:523.57,bio:489.85,organic:78.03,manure:0,...ratio(33.14,5.23)};
 const two={coal:750.15,bio:3.36,organic:78.03,manure:0,...ratio(0.24,5.58)};
 return {targetDate:date,recordKind:'hypothesis',verificationStatus:'unverified',officialClose:false,
  assumption:{silo:'organicStorageSiloB',boundaryLocal:'2026-10-24T00:00',tons:19.143},
  sourceRequestId:'12345678-1234-4234-8234-123456789abc',summary:{unit1:one,unit2:two,combined:{totalRatio:22.62}}};
}
function context(root={}){
 const w={console,document:null,...root};vm.runInNewContext(SOURCE,w,{filename:FILE});return w;
}
test('only two approved historical dates have valid provisional labels; normal Oct26 has none',()=>{
 const w=context(),api=w.CofiringProvisionalV12;
 assert.equal(api.validItem(record('2026-10-24'),'2026-10-24'),true);
 assert.equal(api.validItem(record('2026-10-23'),'2026-10-23'),true);
 assert.equal(api.validItem(record('2026-10-26'),'2026-10-26'),false); // normal dates must never have the estimated badge
 assert.equal(SOURCE.includes("const APPROVED=new Set(['2026-10-23','2026-10-24'])"),true);
 assert.equal(api.validItem({...record(),officialClose:true},'2026-10-24'),false);
 assert.equal(api.validItem({...record(),verificationStatus:'confirmed'},'2026-10-24'),false);
 assert.equal(api.validItem({...record(),assumption:{...record().assumption,tons:23}},'2026-10-24'),false);
});
test('a saved record never claims measured fuel or official close',()=>{
 const w=context(),api=w.CofiringProvisionalV12,x=record();
 const base={targetDate:'2026-10-24',sourceRequestId:x.sourceRequestId,unitTons:78.03,preview:{units:{unit1:{coal:523.57,bio:489.85,organic:78.03,manure:0,ratios:{total:38.38}},unit2:{coal:750.15,bio:3.36,organic:78.03,manure:0,ratios:{total:5.82}}},combined:{total:22.62}}};
 assert.equal(api.sameSaved(x,base),false); // server summary and client preview disagree: prevents silent skip
 x.summary.unit1.totalRatio=38.38;x.summary.unit2.totalRatio=5.82;
 assert.equal(api.sameSaved(x,base),true);
 assert.equal(api.sameSaved({...x,sourceRequestId:'foreign'},base),false);
});
class CList{constructor(){this.items=new Set()}add(s){this.items.add(s)}remove(s){this.items.delete(s)}contains(s){return this.items.has(s)}}
class N{
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.classList=new CList();this.textContent='';this.parentElement=null;this.title='';}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n)}}
 remove(){if(this.parentElement){const a=this.parentElement.children;const i=a.indexOf(this);if(i>=0)a.splice(i,1)}}
 hasAttribute(name){return name==='data-gs-v13-row'&&this.dataset.gsV13Row!==undefined}
 get cells(){return this.children}
 contains(el){return el===this||this.children.some(x=>x.contains(el))}
 querySelector(sel){if(sel==='h3')return this.children.find(x=>x.tag==='h3')||null;if(sel==='[data-gs-v13-note]')return this.children.flatMap(n=>[n,...n.children]).find(x=>x.dataset.gsV13Note!==undefined)||null;return null}
 querySelectorAll(sel){if(sel==='[data-gs-v13-field]')return this.children.filter(x=>x.dataset.gsV13Field!==undefined);return []}
}
test('morning existing card is yellow and labelled only for an unconfirmed scenario; confirmed original takes precedence',()=>{
 const doc=new N('document'),card=new N('section'),hdr=new N('h3');card.append(hdr);
 const ids={},fields=['unit1','unit2'];for(const u of fields)for(const type of ['CoalUsage','BioUsage','OrganicInput','BioRatio','OrganicRatio','TotalRatio']){
  const no=u==='unit1'?'1':'2',id='efficiencyMorningMeetingCofiringUnit'+no+type;
  const wrap=new N(),el=new N('span');wrap.append(el);card.append(wrap);ids[id]=el;
 }
 const w=context();w.document={getElementById:id=>id==='efficiencyMorningMeetingAutoCofiringCard'?card:ids[id]||null,createElement:tag=>new N(tag)};
 w.morningMeetingClosedCofiring={targetDate:()=>w.selectedDate||'2026-10-24',isBlocked:()=>false,peek:()=>w.official||null};
 const item=record();assert.equal(w.CofiringProvisionalV12.applyMorning(item,'2026-10-24'),true);
 assert.equal(card.classList.contains('gs-v13-morning-hypothesis'),true);
 assert.match(ids.efficiencyMorningMeetingCofiringUnit1OrganicInput.textContent,/≈78\.03/);
 assert.equal(ids.efficiencyMorningMeetingCofiringUnit1OrganicInput.parentElement.classList.contains('gs-v13-cell-box'),true);
 assert.match(card.querySelector('[data-gs-v13-note]').textContent,/유기성 추정 계산/);
 w.official={targetDate:'2026-10-24'};
 assert.equal(w.CofiringProvisionalV12.applyMorning(item,'2026-10-24'),false);
 w.official=null;w.selectedDate='2026-10-26';
 assert.equal(w.CofiringProvisionalV12.applyMorning(item,'2026-10-24'),false);
});
test('V13 has no separate save, read or history panel, uses the existing official fields only',()=>{
 assert.doesNotMatch(SOURCE,/createElement\(['"]button['"]\)/);
 assert.doesNotMatch(SOURCE,/textContent\s*=\s*['"]가정 계산 저장/);
 assert.doesNotMatch(SOURCE,/textContent\s*=\s*['"]가정자료 조회/);
 assert.match(SOURCE,/cfv12-history-panel/);
 assert.match(SOURCE,/clearLegacyExtras/);
 assert.doesNotMatch(SOURCE,/\/api\/cofiring-closed-history/);
 assert.match(SOURCE,/state\.saveKey=key/);
 assert.match(SOURCE,/X-ShiftLog-Client/);
});

test('automatic save posts only a server-reverified snapshot and does not offer a button',async()=>{
 const saved=record();let reads=0,writes=0,posted=null;
 const shell={querySelector:sel=>({
  '[data-cfv7-date]':{value:'2026-10-24'},'[data-cfv8-mode]':{value:'daily'}
 })[sel]||null};
 const settings=Object.fromEntries(['unit1','unit2'].map(u=>[u,Object.fromEntries(['coal','bio','organic','manure'].map(f=>[f,{calorific:f==='coal'?5800:3200,coefficient:1}]))]));
 const previewUnits={unit1:{coal:{quantity:523.57},bio:{quantity:489.85},organic:{quantity:78.03},manure:{quantity:0},fuelRatios:{bio:33.14,organicGroup:5.23,total:38.38}},unit2:{coal:{quantity:750.15},bio:{quantity:3.36},organic:{quantity:78.03},manure:{quantity:0},fuelRatios:{bio:0.24,organicGroup:5.58,total:5.82}}};
 const controller={getSpec:()=>({startLocal:'2026-10-24T00:00',endLocal:'2026-10-25T00:00'}),getResult:()=>({}),live:{state:()=>({item:{saved:{status:'complete',id:saved.sourceRequestId},active:null,loading:false,submitting:false}})}};
 const scenario={assumedStorageBTons:19.143,receipt:175.43,unitTons:78.03};
 const w=context();
 w.document={querySelector:sel=>sel==='.cofiring-period-v5'?shell:null};
 w.__cofiringPeriodV5Controller=controller;
 w.CofiringSharedScenarioV7={project:()=>({hypothesisDisplay:scenario,units:previewUnits,combined:{fuelRatios:{bio:17.22,organicGroup:5.4,total:22.62}}}),isScenario:()=>true};
 w.CofiringPeriodV5={readSettings:()=>settings,readManual:()=>({unit1:{manure:0},unit2:{manure:0}})};
 w.crypto={randomUUID:()=>saved.sourceRequestId};
 w.getShiftLogAuthHeaders=()=>({Authorization:'Bearer testcase'});
 w.fetch=async(url,options)=>{
  if(options.method==='POST'){writes++;posted=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,item:saved})}}
  reads++;return {ok:true,json:async()=>({ok:true,item:null})};
 };
 await w.CofiringProvisionalV12.autoSave();
 assert.equal(reads,1);assert.equal(writes,1);
 assert.equal(posted.targetDate,'2026-10-24');
 assert.equal(posted.unitTons,78.03);assert.equal(posted.acknowledgeUnverified,true);
 assert.equal(posted.preview.units.unit1.organic,78.03);
 assert.equal(posted['officialClose'],undefined);
 await w.CofiringProvisionalV12.autoSave();assert.equal(reads,1);assert.equal(writes,1);
});

test('existing close-data table gets a pale-yellow row in place; official rows are never touched',()=>{
 const w=context(),rows=[];
 w.document={createElement:tag=>new N(tag)};
 const official={cells:[{textContent:'2026-10-26'}],hasAttribute:()=>false};
 const tbody={children:rows,append(row){row.parentElement=this;rows.push(row)}};
 const table={querySelectorAll(sel){return sel==='tbody tr'?[official,...rows]:[]},querySelector(sel){return sel==='tbody'?tbody:null}};
 const panel={hidden:false};
 const body={closest:()=>panel,querySelector:()=>table,querySelectorAll:()=>rows.filter(n=>n.dataset.gsV13Row)};
 const api=w.CofiringProvisionalV12;
 api.decorateHistory(body,[record('2026-10-24')]);
 assert.equal(rows.length,1);assert.equal(rows[0].dataset.gsV13Row,'2026-10-24');
 assert.match(rows[0].children[0].textContent,/유기성 \(가정\)/);
 assert.match(rows[0].children[4].textContent,/미확정/);
 assert.equal(official.cells[0].textContent,'2026-10-26');
 api.decorateHistory(body,[record('2026-10-24')]);assert.equal(rows.length,1);
 api.decorateHistory(body,[record('2026-10-26')]);
 assert.equal(official.cells[0].textContent,'2026-10-26');
});
