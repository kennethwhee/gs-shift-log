import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import * as api from '../functions/api/cofiring-closed-history.js';
const require=createRequire(import.meta.url);
const core=require('../maintenance/cofiring-core.js');
const contract=require('../maintenance/cofiring-live-contract.js');
const adjust=require('../maintenance/cofiring-period-adjustment-v56.js');
const history=require('../maintenance/cofiring-date-history-v1.js');
const clone=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const SOURCE_ID='00000000-0000-4000-8000-000000000123';
const DATE='2026-09-10';
const spec={startLocal:DATE+'T00:00',endLocal:'2026-09-11T00:00',stepUnit:'minute',stepValue:1};
function sourceResult({gap=false,specification=spec}={}){
  const p=contract.period(specification,Number.MAX_SAFE_INTEGER),duration=p.durationMinutes*60;
  const report={kind:'cofiring_dataparc_period_report',schemaVersion:1,status:gap?'PERIOD_DATA_GAPS':'PERIOD_READY',
    runId:'0123456789abcdef0123456789abcdef',...specification,queryEndLocal:p.queryEndLocal,
    executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],
    completedAtUtc:'2026-09-11T01:00:00Z',summaries:contract.definitions.map((def,i)=>{
      const start=10000+i*1000,usage=def.fuel==='coal'?100+i:40+i;
      return {key:def.id,unit:def.unit,fuel:def.fuel,tag:def.queryTag,startValue:start,endValue:start+usage,
        min:start,max:start+usage,delta:usage,usageTon:usage,startQuality:'Raw, Good',endQuality:'Good, Raw',
        startTime:specification.startLocal+':00+09:00',endTime:specification.endLocal+':00+09:00',
        durationGoodSeconds:duration-(gap&&i===0?60:0),durationBadSeconds:gap&&i===0?60:0,boundaryValid:true,durationCoverageValid:true};})};
  return contract.periodResult({kind:'cofiring_period_live_result',schemaVersion:1,requestId:SOURCE_ID,request:specification,report},SOURCE_ID,specification);
}
function packet(source=sourceResult()){
  const reference=source.report.reference,settings={},manual={unit1:{organic:10,manure:2},unit2:{organic:null,manure:0},receipts:{organic:null,manure:0}};
  for(const unit of ['unit1','unit2'])settings[unit]=Object.fromEntries(['coal','bio','organic','manure'].map(fuel=>[fuel,{calorific:reference.calorifics[unit][fuel],coefficient:reference.coefficients[unit][fuel]}]));
  const p=core.periodRange(spec.startLocal,spec.endLocal,'minute',1);
  const result=core.analyzePeriodSummary(reference,{organic:{start:p.start,end:p.end,unit1:10,unit2:0},manure:{start:p.start,end:p.end,unit1:2,unit2:0}});
  const summary=core.summaryFromResult(result);
  return {targetDate:DATE,sourceRequestId:SOURCE_ID,expectedRevision:0,expectedVersion:null,overwrite:false,summary,
    snapshot:{schemaVersion:1,targetDate:DATE,period:p,sourceRequestId:SOURCE_ID,result,settings,manual,summary,capturedAt:'2026-09-11T02:00:00Z'}};
}
function database(t,source=sourceResult()){
  const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
  raw.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
    CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,result_json TEXT);
    INSERT INTO users VALUES('9000001','검토 사용자',1),('9000002','사용중지',0);`);
  for(const [token,id,expiry] of [['valid','9000001','2099-01-01'],['disabled','9000002','2099-01-01'],['expired','9000001','2020-01-01'],['bad-expiry','9000001','invalid']])raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(hash(token),id,expiry,'');
  raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?)').run(SOURCE_ID,'cofiring_period',DATE,'complete',JSON.stringify(source));
  const db={raw,beforeWrite:null,writes:0,prepare(sql){let args=[];return{bind(...values){args=values;return this;},
    async first(){return raw.prepare(sql).get(...args)||null;},
    async all(){if(/^(UPDATE|INSERT|DELETE)\s/i.test(sql.trim())){db.writes++;if(db.beforeWrite){const hook=db.beforeWrite;db.beforeWrite=null;await hook(sql,args);}}return {results:raw.prepare(sql).all(...args)};},
    async run(){const result=raw.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};}};
  return db;
}
async function call(db,{method='POST',body=packet(),query='',token='valid',headers={}}={}){
  const request=new Request('https://review.invalid/api/cofiring-closed-history'+query,{method,
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},
    ...(['GET','DELETE'].includes(method)?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  const response=await api.onRequest({request,env:{DB:db}});return {status:response.status,payload:await response.json()};
}
const stored=db=>db.raw.prepare('SELECT * FROM cofiring_closed_snapshots WHERE target_date=?').get(DATE);
const expect=item=>({expectedRevision:item.revision,expectedVersion:item.version,overwrite:true});
const deleteQuery=item=>'?'+new URLSearchParams({targetDate:DATE,expectedRevision:item.revision,expectedVersion:item.version});

test('closed API denies anonymous, expired, disabled and malformed sessions before business writes',async t=>{
  const db=database(t);for(const token of [undefined,'wrong','disabled','expired','bad-expiry'])for(const method of ['GET','POST','DELETE']){
    const r=await call(db,{token:token??'',method});assert.equal(r.status,401);
  }assert.equal(db.writes,0);assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE name='cofiring_closed_snapshots'").get(),undefined);
});
test('server recomputes summaries and preserves blank manual input separately from explicit zero',async t=>{
  const db=database(t),p=packet();p.summary={combined:{totalRatio:999}};p.snapshot.summary=p.summary;p.snapshot.result.heats={total:999};
  const r=await call(db,{body:p});assert.equal(r.status,200,JSON.stringify(r.payload));
  const saved=stored(db),snapshot=JSON.parse(saved.snapshot_json),summary=JSON.parse(saved.summary_json);
  assert.equal(snapshot.validationVersion,3);assert.equal(snapshot.manual.unit2.organic,null);assert.equal(snapshot.manual.unit2.manure,0);
  assert.equal(snapshot.result.units.unit2.organic.quantity,0);assert.deepEqual(summary,core.summaryFromResult(p.snapshot.result));
  assert.equal(summary.unit1.organicGroupRatio,snapshot.result.units.unit1.fuelRatios.organicGroup);
  assert.notEqual(summary.combined.totalRatio,999);assert.match(r.payload.item.version,/^[a-f0-9]{64}$/);
  const detail=await call(db,{method:'GET',query:'?targetDate='+DATE});assert.equal(detail.payload.item.version,r.payload.item.version);
});
test('modified quantities, ratios, missing settings and invalid numeric types cannot be closed',async t=>{
  const db=database(t);const variants=[
    p=>p.snapshot.result.units.unit1.coal.quantity++,p=>p.snapshot.result.units.unit1.heats.total++,p=>p.snapshot.result.units.unit2.bio.quantity=null,
    p=>p.snapshot.result.units.unit1.fuelRatios.total++,p=>p.snapshot.result.combined.fuelRatios.total++,
    p=>p.snapshot.settings.unit1.coal.coefficient=0,p=>p.snapshot.settings.unit2.bio.calorific='3237',
    p=>p.snapshot.manual.unit1.organic=true,p=>delete p.snapshot.manual.unit2.manure,
    p=>p.snapshot.manual.unit1.organic=-1,p=>p.snapshot.result.period.endLocal='2026-09-10T12:00',
    p=>p.snapshot.sourceRequestId='different',p=>p.snapshot.settings.unit1.coal.calorific=100000
  ];for(const mutate of variants){const p=packet();mutate(p);const r=await call(db,{body:p});assert.equal(r.status,400,JSON.stringify(r));}
  assert.equal(db.writes,0);assert.equal(stored(db),undefined);
});
test('completed status alone cannot authorize a partial-day, corrupt or different-request source',async t=>{
  const db=database(t);for(const source of [{}, {...sourceResult(),requestId:'00000000-0000-4000-8000-000000000456'},sourceResult({specification:{...spec,endLocal:DATE+'T12:00'}})]){
    db.raw.prepare('UPDATE ois_data_requests SET result_json=?').run(JSON.stringify(source));
    assert.equal((await call(db)).status,400);
  }assert.equal(db.writes,0);
});
test('legitimate quality-gap reports retain quantities and quality warnings in the closed result',async t=>{
  const source=sourceResult({gap:true}),db=database(t,source);assert.equal((await call(db,{body:packet(source)})).status,200);
  const snap=JSON.parse(stored(db).snapshot_json);assert.equal(snap.result.qualityVerified,false);assert.ok(snap.result.warnings.some(x=>/품질 공백/.test(x)));
});
test('manual transfer, direct final values and max-auto adjustment use the same server and browser calculation',async t=>{
  for(const mode of ['manual_transfer','fractional_transfer','manual_final','max_auto']){
    const db=database(t),p=packet(),base=p.snapshot.result,s=p.snapshot.settings;
    const result=mode==='fractional_transfer'?adjust.manualTransfer(base,s,1,0.123456):mode==='manual_transfer'?adjust.manualTransfer(base,s,1,5):mode==='max_auto'?adjust.autoMax(base,s,30):adjust.adjustFinal(base,s,25,35,{mode});
    assert.equal(result.ok,true);p.snapshot.result=result.result;
    const r=await call(db,{body:p});assert.equal(r.status,200,mode+': '+JSON.stringify(r.payload));
    const snap=JSON.parse(stored(db).snapshot_json);assert.deepEqual(snap.result,result.result);
  }
});
test('missing fuel cannot become zero during adjustment; organic group includes manure consistently',()=>{
  const p=packet(),base=p.snapshot.result,settings=p.snapshot.settings;
  for(const unit of ['unit1','unit2'])for(const fuel of ['coal','bio','organic','manure']){
    const broken=clone(base);broken.units[unit][fuel].quantity=null;assert.equal(adjust.adjustFinal(broken,settings,20,20).ok,false);
  }
  assert.equal(adjust.adjustFinal(base,settings,null,20).ok,false);
  const changed=adjust.manualTransfer(base,settings,1,5).result;
  assert.equal(changed.units.unit1.ratios.organic,changed.units.unit1.fuelRatios.organicGroup);
  assert.equal(changed.combined.ratios.organic,changed.combined.fuelRatios.organicGroup);
  assert.notEqual(changed.units.unit1.ratios.organic,changed.units.unit1.fuelRatios.organic);
});
test('new client is required for writes while older snapshots remain readable without rewriting',async t=>{
  const db=database(t);assert.equal((await call(db,{body:{targetDate:DATE}})).status,428);
  assert.equal((await call(db,{method:'DELETE',query:'?targetDate='+DATE})).status,428);
  await call(db,{method:'GET'});
  db.raw.prepare(`INSERT INTO cofiring_closed_snapshots VALUES(?,?,?,?,?,?,?,?,?)`).run(DATE,7,SOURCE_ID,'{"unit1":{"coal":0}}','{"schemaVersion":1,"note":"기존 저장 자료"}','old','이전 사용자','old-created','old-updated');
  const before=stored(db),read=await call(db,{method:'GET',query:'?targetDate='+DATE});
  assert.equal(read.status,200);assert.equal(read.payload.item.snapshot.note,'기존 저장 자료');assert.deepEqual(stored(db),before);
});
test('simultaneous initial closes produce one result and one conflict',async t=>{
  const db=database(t),r=await Promise.all([call(db),call(db)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);assert.equal(stored(db).revision,1);
});
test('simultaneous replacements from the same version cannot overwrite each other',async t=>{
  const db=database(t),first=await call(db),p={...packet(),...expect(first.payload.item)};
  const results=await Promise.all([call(db,{body:p}),call(db,{body:p})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(stored(db).revision,2);
  assert.equal((await call(db,{body:p})).status,409);
});
test('save and delete include a final atomic condition after validation',async t=>{
  const db=database(t),first=await call(db),p={...packet(),...expect(first.payload.item)};
  db.beforeWrite=()=>db.raw.prepare('UPDATE cofiring_closed_snapshots SET revision=revision+1,updated_at=? WHERE target_date=?').run('concurrent',DATE);
  assert.equal((await call(db,{body:p})).status,409);assert.equal(stored(db).updated_at,'concurrent');
  const current=await call(db,{method:'GET',query:'?targetDate='+DATE});
  db.beforeWrite=()=>db.raw.prepare('UPDATE cofiring_closed_snapshots SET revision=revision+1 WHERE target_date=?').run(DATE);
  assert.equal((await call(db,{method:'DELETE',query:deleteQuery(current.payload.item)})).status,409);assert.ok(stored(db));
});
test('stale delete cannot erase a newer snapshot or a deleted-and-recreated first revision',async t=>{
  const db=database(t),first=await call(db);
  assert.equal((await call(db,{method:'DELETE',query:deleteQuery(first.payload.item)})).status,200);
  const recreated=await call(db);assert.equal(recreated.payload.item.revision,1);assert.notEqual(recreated.payload.item.version,first.payload.item.version);
  assert.equal((await call(db,{method:'DELETE',query:deleteQuery(first.payload.item)})).status,409);
  assert.equal((await call(db,{body:{...packet(),...expect(first.payload.item)}})).status,409);
  assert.equal((await call(db,{method:'DELETE',query:deleteQuery(recreated.payload.item)})).status,200);
});
test('month filtering can read older years beyond the latest 366 records',async t=>{
  const db=database(t);await call(db);
  const insert=db.raw.prepare('INSERT INTO cofiring_closed_snapshots VALUES(?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<400;i++){const date=new Date(Date.UTC(2023,0,1+i)).toISOString().slice(0,10);insert.run(date,1,SOURCE_ID,'{}','{}','a','b','c','d');}
  const month=await call(db,{method:'GET',query:'?month=2023-01'});assert.equal(month.status,200);assert.equal(month.payload.items.length,31);
  assert.ok(month.payload.items.every(item=>item.targetDate.startsWith('2023-01')));
  assert.equal((await call(db,{method:'GET',query:'?month=2023-13'})).status,400);
});
test('invalid JSON, arrays, oversized multibyte input and cross-origin writes fail without stored changes',async t=>{
  const db=database(t);for(const [body,status] of [['{',400],['null',400],['[]',400],[JSON.stringify({...packet(),padding:'가'.repeat(510000)}),413]])assert.equal((await call(db,{body})).status,status);
  assert.equal((await call(db,{headers:{Origin:'https://other.invalid'}})).status,403);assert.equal(db.writes,0);
});
test('database failures leave the previous snapshot intact and return a generic error',async t=>{
  const db=database(t),first=await call(db),before=stored(db);db.beforeWrite=()=>{throw Error('synthetic sensitive SQL text');};
  t.mock.method(console,'error',()=>{});
  const r=await call(db,{body:{...packet(),...expect(first.payload.item)}});assert.equal(r.status,500);assert.doesNotMatch(JSON.stringify(r.payload),/synthetic|SQL/);assert.deepEqual(stored(db),before);
});
test('browser and server summary agree, including incomplete and explicit zero values',()=>{
  const result=packet().snapshot.result;assert.deepEqual(history.summaryFromResult(result),core.summaryFromResult(result));
  result.units.unit1.coal.quantity=null;result.units.unit1.bio.quantity=0;
  const summary=core.summaryFromResult(result);assert.equal(summary.unit1.coal,null);assert.equal(summary.unit1.bio,0);
});
test('the recorded settings and manual inputs reproduce the actual edited calculation',async t=>{
  const source=sourceResult(),db=database(t,source),p=packet(source),calorifics={},coefficients={};
  p.snapshot.manual.unit1.organic=23;
  for(const unit of ['unit1','unit2']){
    p.snapshot.settings[unit].coal.calorific=6100;p.snapshot.settings[unit].bio.coefficient=0.87;
    calorifics[unit]=Object.fromEntries(Object.entries(p.snapshot.settings[unit]).map(([fuel,value])=>[fuel,value.calorific]));
    coefficients[unit]=Object.fromEntries(Object.entries(p.snapshot.settings[unit]).map(([fuel,value])=>[fuel,value.coefficient]));
  }
  const period=p.snapshot.period;
  p.snapshot.result=core.analyzePeriodSummary(source.report.reference,{calorifics,coefficients,
    organic:{start:period.start,end:period.end,unit1:23,unit2:0},manure:{start:period.start,end:period.end,unit1:2,unit2:0}});
  const response=await call(db,{body:p});assert.equal(response.status,200,JSON.stringify(response.payload));
  const snapshot=JSON.parse(stored(db).snapshot_json);
  assert.deepEqual(snapshot.settings,p.snapshot.settings);assert.deepEqual(snapshot.manual,p.snapshot.manual);
  assert.equal(snapshot.result.units.unit1.organic.quantity,23);assert.equal(snapshot.result.units.unit1.bio.quantity,44*0.87);
});
test('stopped counters preserve zero fuel and leave zero-total-heat ratios undefined',async t=>{
  const raw=sourceResult();for(const item of raw.report.summaries){item.endValue=item.startValue;item.max=item.min;item.delta=0;item.usageTon=0;delete item.effectiveEndValue;}
  const source=contract.periodResult(raw,SOURCE_ID,spec),db=database(t,source),p=packet(source),period=p.snapshot.period;
  p.snapshot.manual={unit1:{organic:0,manure:0},unit2:{organic:0,manure:0},receipts:{organic:null,manure:null}};
  p.snapshot.result=core.analyzePeriodSummary(source.report.reference,{organic:{start:period.start,end:period.end,unit1:0,unit2:0},manure:{start:period.start,end:period.end,unit1:0,unit2:0}});
  const response=await call(db,{body:p});assert.equal(response.status,200,JSON.stringify(response.payload));
  assert.equal(response.payload.item.summary.unit1.coal,0);assert.equal(response.payload.item.summary.unit1.bioRatio,null);
  assert.equal(response.payload.item.summary.combined.totalRatio,null);
});
test('monthly arithmetic average excludes missing values and includes explicit zero',()=>{
  const file=new URL('../maintenance/cofiring-closed-history-cards-v2.js',import.meta.url);
  const context=vm.createContext({console,module:{exports:{}},setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(file,'utf8'),context);const monthly=context.module.exports;
  const mean=monthly.averageRows([{unit1:{coal:null,bioRatio:null}},{unit1:{coal:0,bioRatio:0}},{unit1:{coal:30,bioRatio:30}}]);
  assert.equal(mean.unit1.coal,15);assert.equal(mean.unit1.bioRatio,15);assert.equal(mean.unit2.coal,null);
});
