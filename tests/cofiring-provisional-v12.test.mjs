import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import crypto from 'node:crypto';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.join(HERE,'../functions/api/cofiring-provisional-v12.js'),'utf8');
const UI=fs.readFileSync(path.join(HERE,'../maintenance/cofiring-provisional-v12.js'),'utf8');
const isNum=x=>typeof x==='number'&&Number.isFinite(x);
function mocks(){
 const contract={periodResult:(body,id,spec)=>{
   if(body.requestId!==id||body.report.reference.startLocal!==spec.startLocal||body.report.reference.endLocal!==spec.endLocal)throw Error('period');
   return body;
 }};
 const whatif={displayScenario:(r,receipt,spec)=>r.quality==='Good'?null:{
   kind:'cross-day-shared-what-if-v7',provisional:true,verified:false,assumptionBoundaryLocal:'2026-10-24T00:00',
   assumedStorageBTons:19.143,unitTons:(r.quantity+receipt)/2,total:r.quantity+receipt,
   role:spec.startLocal==='2026-10-23T00:00'?'prev':'next',receipt,startTotal:150,endTotal:100},
  isScenario:x=>x?.kind==='cross-day-shared-what-if-v7'&&x.verified===false};
 const core={analyzePeriodSummary:(r,opt)=>{
   const units={},heats={coal:0,bio:0,organic:0,manure:0,total:0};
   for(const u of ['unit1','unit2']){
    const qty={coal:r.coal[u],bio:r.bio[u],organic:opt.organic[u]*opt.coefficients[u].organic,manure:opt.manure[u]*opt.coefficients[u].manure};
    const h={total:0};for(const fuel of ['coal','bio','organic','manure']){h[fuel]=qty[fuel]*opt.calorifics[u][fuel]/1000;h.total+=h[fuel];heats[fuel]+=h[fuel]}heats.total+=h.total;
    const ratios={bio:h.bio/h.total*100,organicGroup:(h.organic+h.manure)/h.total*100,total:(h.bio+h.organic+h.manure)/h.total*100};
    units[u]={coal:{quantity:qty.coal,complete:true},bio:{quantity:qty.bio,complete:true},organic:{quantity:qty.organic},manure:{quantity:qty.manure},fuelRatios:ratios};
   }
   const ratios={bio:heats.bio/heats.total*100,organicGroup:(heats.organic+heats.manure)/heats.total*100,total:(heats.bio+heats.organic+heats.manure)/heats.total*100};
   return {units,combined:{fuelRatios:ratios}};
  },summaryFromResult:r=>({unit1:{coal:r.units.unit1.coal.quantity,bio:r.units.unit1.bio.quantity,organic:r.units.unit1.organic.quantity,manure:r.units.unit1.manure.quantity,bioRatio:r.units.unit1.fuelRatios.bio,organicGroupRatio:r.units.unit1.fuelRatios.organicGroup,totalRatio:r.units.unit1.fuelRatios.total},unit2:{coal:r.units.unit2.coal.quantity,bio:r.units.unit2.bio.quantity,organic:r.units.unit2.organic.quantity,manure:r.units.unit2.manure.quantity,bioRatio:r.units.unit2.fuelRatios.bio,organicGroupRatio:r.units.unit2.fuelRatios.organicGroup,totalRatio:r.units.unit2.fuelRatios.total},combined:{bioRatio:r.combined.fuelRatios.bio,organicGroupRatio:r.combined.fuelRatios.organicGroup,totalRatio:r.combined.fuelRatios.total}})};
 return {core,contract,whatif};
}
const {core,contract,whatif}=mocks();
const rewritten=source.replace(/^import core[^;]*;\s*/m,'const core=globalThis.__test_core;\n')
 .replace(/^import contract[^;]*;\s*/m,'const contract=globalThis.__test_contract;\n')
 .replace(/^import scenarioApi[^;]*;\s*/m,'const scenarioApi=globalThis.__test_scenario;\n')
 .replace(/^import \{ensureCorrectionTable,latestCorrection\}[^;]*;\s*/m,'const ensureCorrectionTable=async()=>{}; const latestCorrection=async()=>null;\n');
globalThis.__test_core=core;globalThis.__test_contract=contract;globalThis.__test_scenario=whatif;
const API=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));
class FakeD1{
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('CREATE TABLE shift_log_sessions(employee_no TEXT,expires_at TEXT,token_hash TEXT);CREATE TABLE users(employee_no TEXT,name TEXT,is_active INTEGER);CREATE TABLE ois_data_requests(id TEXT,target_date TEXT,request_type TEXT,status TEXT,result_json TEXT,created_at TEXT);CREATE TABLE solid_fuel_unloading_logs(id TEXT,version INTEGER,unloading_date TEXT,departure_time TEXT,fuel_type TEXT,receipt_tons REAL,deleted_at TEXT);CREATE TABLE cofiring_closed_snapshots(target_date TEXT)');}
 prepare(sql){const stmt=this.db.prepare(sql);const make=(...args)=>({first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>stmt.run(...args)});return {...make(),bind:(...args)=>make(...args)};}
}
const token='test-token-123',uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const d=new FakeD1(),hash=crypto.createHash('sha256').update(token).digest('hex');
 d.db.prepare('INSERT INTO users VALUES(?,?,?)').run('control3','Operator',1);
 d.db.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?)').run('control3','2099-01-01T00:00:00Z',hash);
 for(const [idx,date,quantity,receipt] of [[1,'2026-10-23',44.16,89.62],[2,'2026-10-24',-19.37,175.43]]){
  const end=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const reference={startLocal:date+'T00:00',endLocal:end+'T00:00',quality:'Bad',quantity,
   coal:{unit1:500,unit2:740},bio:{unit1:535,unit2:11.6953125}};
  d.db.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?)').run(uuid(idx),date,'cofiring_period','complete',JSON.stringify({requestId:uuid(idx),report:{reference}}),'2026-10-27T00:00:00Z');
  d.db.prepare('INSERT INTO solid_fuel_unloading_logs VALUES(?,?,?,?,?,?,?)').run(uuid(idx),1,date,'10:00','organic',receipt,null);
 }
 return d;
}
const settings=Object.fromEntries(['unit1','unit2'].map(u=>[u,Object.fromEntries(['coal','bio','organic','manure'].map(f=>[f,{calorific:f==='coal'?5868:f==='bio'?3237:3487,coefficient:1}]))]));
const prepare=(date,revision=0,n=100)=>{
 const quantity=date==='2026-10-23'?44.16:-19.37,receipt=date==='2026-10-23'?89.62:175.43;
 const sc=whatif.displayScenario({quality:'Bad',quantity},receipt,{startLocal:date+'T00:00'});
 const calorifics={},coefficients={};for(const u of ['unit1','unit2']){calorifics[u]={};coefficients[u]={};for(const f of ['coal','bio','organic','manure']){calorifics[u][f]=settings[u][f].calorific;coefficients[u][f]=1;}}
 const r=core.analyzePeriodSummary({coal:{unit1:500,unit2:740},bio:{unit1:535,unit2:11.6953125}}, {calorifics,coefficients,organic:{unit1:sc.unitTons,unit2:sc.unitTons},manure:{unit1:0,unit2:0}});
 const preview={units:{},combined:{}};for(const u of ['unit1','unit2']){preview.units[u]={ratios:{}};for(const f of ['coal','bio','organic','manure'])preview.units[u][f]=r.units[u][f].quantity;for(const k of ['bio','organicGroup','total'])preview.units[u].ratios[k]=r.units[u].fuelRatios[k];}
 for(const k of ['bio','organicGroup','total'])preview.combined[k]=r.combined.fuelRatios[k];
 return {targetDate:date,sourceRequestId:uuid(date==='2026-10-23'?1:2),receiptTons:receipt,unitTons:sc.unitTons,settings,manure:{unit1:0,unit2:0},preview,acknowledgeUnverified:true,expectedRevision:revision,requestId:uuid(n)};
};
const call=(db,method,body,auth=token)=>{const url='https://fake.local/api/cofiring-provisional-v12';
 const request=new Request(url,{method,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...(method==='POST'?{'Content-Type':'application/json','X-ShiftLog-Client':'desktop',Origin:'https://fake.local'}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 return API.onRequest({request,env:{DB:db}}).then(async r=>({status:r.status,...await r.json()}));};
test('auth required, new table does not change the official closing table',async()=>{
 const d=fixture();let x=await call(d,'GET',null,null);assert.equal(x.status,401);
 x=await call(d,'POST',prepare('2026-10-23'));assert.equal(x.status,200,JSON.stringify(x));assert.equal(x.item.officialClose,false);
 assert.equal(d.db.prepare('SELECT count(*) AS count FROM cofiring_closed_snapshots').get().count,0);
 assert.equal(d.db.prepare('SELECT count(*) AS count FROM cofiring_provisional_snapshots_v12').get().count,1);
});
test('saved 23 and 24 daily records share one seam, remain provisional, can be read again',async()=>{
 const d=fixture();const a=await call(d,'POST',prepare('2026-10-23'));const b=await call(d,'POST',prepare('2026-10-24',0,101));assert.equal(a.status,200,JSON.stringify(a));assert.equal(b.status,200,JSON.stringify(b));
 const rr=await API.onRequestGet({request:new Request('https://fake.local/api/cofiring-provisional-v12?targetDate=2026-10-24',{headers:{Authorization:'Bearer '+token}}),env:{DB:d}});
 const j=await rr.json();assert.equal(j.item.record.assumption.tons,19.143);assert.equal(j.item.verificationStatus,'unverified');assert.equal(j.item.officialClose,false);assert.ok(j.item.summary.unit2.organic>0);
});
test('client cannot silently save changed usage, forged receipt, fake Good source or stale revision',async()=>{
 const d=fixture(),base=prepare('2026-10-23');
 assert.equal((await call(d,'POST',{...base,preview:{...base.preview,combined:{...base.preview.combined,total:99}}})).status,409);
 assert.equal((await call(d,'POST',{...base,receiptTons:999})).status,409);
 assert.equal((await call(d,'POST',{...base,acknowledgeUnverified:false})).status,409);
 assert.equal((await call(d,'POST',base)).status,200);
 assert.equal((await call(d,'POST',{...base,requestId:uuid(101)})).status,409);
 const same=await call(d,'POST',base);assert.equal(same.status,200);assert.equal(same.replayed,true);
 const changed=await call(d,'POST',{...base,unitTons:0});assert.equal(changed.status,409);
 d.db.prepare('UPDATE ois_data_requests SET result_json=REPLACE(result_json,\'"Bad"\',\'"Good"\') WHERE target_date=?').run('2026-10-24');
 const good=await call(d,'POST',prepare('2026-10-24',0,102));assert.equal(good.status,409);
});
test('V13 auto-syncs verified provisional values inline, without V12 save/query widgets or official-close write',()=>{
 assert.match(UI,/async function autoSave/);assert.match(UI,/const API='\/api\/cofiring-provisional-v12'/);
 assert.match(UI,/cfv12-history-panel/);assert.match(UI,/efficiencyMorningMeetingAutoCofiringCard/);
 assert.match(UI,/가정 계산 · 미확정/);
 assert.doesNotMatch(UI,/textContent='가정 계산 저장'/);
 assert.doesNotMatch(UI,/textContent='가정자료 조회'/);
 assert.doesNotMatch(UI,/\/api\/cofiring-closed-history/);
 assert.match(UI,/hasOfficialMorning\(date\)/);
});
