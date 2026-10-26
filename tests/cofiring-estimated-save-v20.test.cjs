'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const src=fs.readFileSync(__dirname+'/../maintenance/cofiring-provisional-v12.js','utf8');
const UUID='01234567-89ab-4def-9234-abcdef987654';
const OTHER='98765432-1234-4321-aabc-123456789abc';
const date='2026-10-24';
const spec={startLocal:'2026-10-24T00:00',endLocal:'2026-10-25T00:00',stepUnit:'minute',stepValue:1};
const assumption={kind:'cross-day-shared-what-if-v7',assumedStorageBTons:19.143,receipt:175.43,unitTons:78.03,verified:false,provisional:true};
const base={unit1:{coal:523.57,bio:489.85,organic:78.03,manure:0},unit2:{coal:750.15,bio:3.36,organic:78.03,manure:0}};
const preview={hypothesisDisplay:assumption,units:Object.fromEntries(Object.entries(base).map(([k,v])=>[k,{...Object.fromEntries(Object.entries(v).map(([f,n])=>[f,{quantity:n}])),fuelRatios:{bio:12,organicGroup:7,total:19}}])),combined:{fuelRatios:{bio:12,organicGroup:7,total:19}}};
const summary={unit1:{...base.unit1,bioRatio:12,organicGroupRatio:7,totalRatio:19},unit2:{...base.unit2,bioRatio:12,organicGroupRatio:7,totalRatio:19},combined:{totalRatio:19}};
const savedComplete={status:'complete',id:UUID,requestType:'cofiring_period',targetDate:date};
const stored={targetDate:date,recordKind:'hypothesis',verificationStatus:'unverified',officialClose:false,assumption:{silo:'organicStorageSiloB',boundaryLocal:'2026-10-24T00:00',tons:19.143},sourceRequestId:UUID,summary};
function setup({saved=savedComplete,active=null,loading=false,submitting=false,resultId=UUID,period=spec,existing=null}={}){
 const span={textContent:'',dataset:{},setAttribute(){}};
 const toolbar={querySelector:()=>null,append(){}},shell={querySelector:s=>({'[data-cfv7-date]':{value:date},'[data-cfv8-mode]':{value:'daily'},'.cfv56-summary-actions':toolbar,'.cfv17-hypothesis-card':{}})[s]||null};
 let gets=0,posts=0;
 const ctrl={getSpec:()=>spec,getResult:()=>raw,getDisplayResult:()=>null,live:{state:()=>({period,item:{saved,active,loading,submitting,result:{requestId:resultId}}})}};
 const raw={units:{unit1:{},unit2:{}},combined:{}};
 const win={console,document:{querySelector:s=>s==='.cofiring-period-v5'?shell:null,createElement:()=>span,head:{append(){}},addEventListener(){},readyState:'loading'},
 getShiftLogAuthHeaders:()=>({Authorization:'Bearer user'}),CofiringSharedScenarioV7:{project:r=>r===raw?preview:null,isScenario:r=>r===assumption},
 CofiringPeriodV5:{readSettings:()=>Object.fromEntries(['unit1','unit2'].map(u=>[u,Object.fromEntries(['coal','bio','organic','manure'].map(f=>[f,{calorific:4000,coefficient:1}]))])),readManual:()=>({unit1:{manure:0},unit2:{manure:0}})},
 __cofiringPeriodV5Controller:ctrl,crypto:{randomUUID:()=>OTHER},CustomEvent:class{constructor(t,o){this.detail=o?.detail;}},dispatchEvent(){},
 fetch:async(_url,opts)=>{if(opts.method==='POST'){posts++;return {ok:true,json:async()=>({ok:true,item:stored})};}gets++;return {ok:true,json:async()=>({ok:true,item:existing})};}};
 vm.runInNewContext(src,win,{filename:'provisional-v20.js'});
 return {w:win,get gets(){return gets},get posts(){return posts},get status(){return span.textContent}};
}
test('verified completed saved source can be recorded while an unrelated newer DataPARC request is active',async()=>{
 const c=setup({active:{status:'processing',id:OTHER}});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.gets,1);assert.equal(c.posts,1);assert.match(c.status,/저장 완료/);
});
test('verified completed saved source survives status polling and loading flag',async()=>{
 const c=setup({loading:true});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.posts,1);
});
test('verified completed saved source survives submission of a different later request',async()=>{
 const c=setup({submitting:true});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.posts,1);
});
test('still refuses to save if only a pending source exists',async()=>{
 const c=setup({saved:null,active:{status:'processing',id:OTHER}});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.gets,0);assert.equal(c.posts,0);assert.match(c.status,/원본이 아직 없습니다/);
});
test('rejects stale visible original ID even if a saved source exists',async()=>{
 const c=setup({resultId:OTHER,active:{status:'processing'}});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.gets,0);assert.equal(c.posts,0);assert.match(c.status,/조회 ID가 다릅니다/);
});
test('rejects mismatched period even when saved result exists',async()=>{
 const c=setup({period:{...spec,startLocal:'2026-10-23T00:00'},active:{status:'processing'}});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.posts,0);assert.match(c.status,/조회 기간이 다릅니다/);
});
test('during active refresh never saves without a verifiable displayed result ID',async()=>{
 const c=setup({active:{status:'processing',id:OTHER},resultId:null});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.posts,0);assert.match(c.status,/원본 ID가 필요/);
});
test('rejects stale saved status despite a matching displayed ID',async()=>{
 const c=setup({saved:{...savedComplete,status:'pending'}});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.posts,0);
});
test('legacy completed raw ID without transient activity continues through server revalidation',async()=>{
 const c=setup({saved:null});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.posts,1);
});
test('same already stored result does not POST again',async()=>{
 const c=setup({existing:stored,active:{status:'pending'}});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.gets,1);assert.equal(c.posts,0);assert.match(c.status,/저장 완료/);
});
test('never activates official closing APIs or mutates original measured DataPARC',()=>{
 assert.match(src,/GS_V20_COMPLETED_SOURCE_WHILE_REFRESHING = true/);
 assert.ok(!src.includes("fetch('/api/cofiring-closed-history"));
 assert.ok(!src.includes("method:'DELETE'"));
});
