'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const src=fs.readFileSync(__dirname+'/../maintenance/cofiring-provisional-v12.js','utf8');
const UUID='01234567-89ab-4def-9234-abcdef987654';
const scenario={kind:'cross-day-shared-what-if-v7',assumedStorageBTons:19.143,receipt:175.43,unitTons:78.03,verified:false,provisional:true};
const baseQuant={unit1:{coal:523.57,bio:489.85,organic:78.03,manure:0},unit2:{coal:750.15,bio:3.36,organic:78.03,manure:0}};
const preview={hypothesisDisplay:scenario,units:Object.fromEntries(Object.entries(baseQuant).map(([k,v])=>[k,{...Object.fromEntries(Object.entries(v).map(([f,q])=>[f,{quantity:q}])),fuelRatios:{bio:12,organicGroup:7,total:19}}])),combined:{fuelRatios:{bio:12,organicGroup:7,total:19}}};
const spec={startLocal:'2026-10-24T00:00',endLocal:'2026-10-25T00:00',stepUnit:'minute',stepValue:1};
function create({saved=null,active=null,mode='daily',date='2026-10-24',raw={units:{unit1:{},unit2:{}},combined:{}},itemResult={requestId:UUID}}={}){
  const span={textContent:'',dataset:{},setAttribute(){}};
  const shell={dataset:{},querySelector(sel){return ({'[data-cfv7-date]':{value:date},'[data-cfv8-mode]':{value:mode},'.cfv56-summary-actions':{querySelector(){return null},append(){}},'.cfv17-hypothesis-card':{}})[sel]||null}};
  let posts=0,gets=0;
  const w={console,document:{querySelector:sel=>sel==='.cofiring-period-v5'?shell:null,querySelectorAll:()=>[],getElementById:()=>null,head:{append(){}},createElement:()=>span,addEventListener(){}},getShiftLogAuthHeaders:()=>({Authorization:'Bearer user'}),CofiringSharedScenarioV7:{isScenario:s=>s===scenario,project:r=>r===raw?preview:null},CofiringPeriodV5:{readSettings:()=>Object.fromEntries(['unit1','unit2'].map(u=>[u,Object.fromEntries(['coal','bio','organic','manure'].map(f=>[f,{calorific:3500,coefficient:1}]))])),readManual:()=>({unit1:{manure:0},unit2:{manure:0}})},crypto:{randomUUID:()=>UUID},CustomEvent:class{constructor(n,o){this.name=n;this.detail=o?.detail}},dispatchEvent(){},fetch:async(url,opts)=>{if(opts.method==='POST'){posts++;return {ok:true,json:async()=>({ok:true,item:{targetDate:date,recordKind:'hypothesis',verificationStatus:'unverified',officialClose:false,assumption:{silo:'organicStorageSiloB',boundaryLocal:'2026-10-24T00:00',tons:19.143}}})};}gets++;return {ok:true,json:async()=>({ok:true,item:null})}}};
  w.__cofiringPeriodV5Controller={getSpec:()=>spec,getResult:()=>raw,getDisplayResult:()=>null,live:{state:()=>({item:{saved,active,loading:false,submitting:false,result:itemResult}})}};
  vm.runInNewContext(src,w,{filename:'provisional-v17.js'});
  return {w,get posts(){return posts},get gets(){return gets}};
}
test('V17 binds existing verified result request id even if optional saved metadata is absent',async()=>{
 const c=create();await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.posts,1);assert.equal(c.gets,1);
});
test('V17 does not issue POST while a new DataPARC operation remains active',async()=>{
 const c=create({active:{status:'processing'}});await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.posts,0);
});
test('V17 rejects mismatch between saved source and visible calculation',async()=>{
 const c=create({saved:{status:'complete',id:UUID},itemResult:{requestId:'12345678-1234-4234-8234-123456789abc'}});
 await c.w.CofiringProvisionalV12.autoSave();assert.equal(c.posts,0);
});
test('V17 honors exact daily window and has safe next-morning source dates',async()=>{
 const c=create();const f=c.w.CofiringProvisionalV12;
 assert.equal(f.morningSourceDate('2026-10-24'),'2026-10-23');assert.equal(f.morningSourceDate('2026-10-25'),'2026-10-24');assert.equal(f.morningSourceDate('2026-10-26'),'');
 assert.equal(f.projectionContext().saved.id,UUID);
});
test('V17 never rewrites official closing endpoints',()=>{
 assert.ok(!src.includes('fetch(\'/api/cofiring-closed-history\''));
 assert.ok(!src.includes('method:\'DELETE\''));
 assert.match(src,/const GS_V17_CONTEXT_BINDING = true/);
});
