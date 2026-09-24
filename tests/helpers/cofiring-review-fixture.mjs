import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as api from '../../functions/api/cofiring-closed-history.js';
const require=createRequire(import.meta.url);
const core=require('../../maintenance/cofiring-core.js');
const contract=require('../../maintenance/cofiring-live-contract.js');
const adjust=require('../../maintenance/cofiring-period-adjustment-v56.js');
const history=require('../../maintenance/cofiring-date-history-v1.js');
const clone=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const SOURCE_ID='00000000-0000-4000-8000-000000000123';
const DATE='2026-09-10';
const spec={startLocal:DATE+'T00:00',endLocal:'2026-09-11T00:00',stepUnit:'minute',stepValue:1};
function sourceResult({gap=false,specification=spec,inventory=true}={}){
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
  if(inventory){
    const starts={organicDaySilo:20,organicStorageSiloA:80,organicStorageSiloB:50};
    const ends={organicDaySilo:10,organicStorageSiloA:90,organicStorageSiloB:60};
    report.organicInventoryReady=true;
    report.organicInventory={schemaVersion:1,basis:'dataparc_period_boundary',startLocal:specification.startLocal,endLocal:specification.endLocal,
      start:{...starts,total:150},end:{...ends,total:160},samples:contract.inventoryDefinitions.map(def=>({
        ...def,startValue:starts[def.key],endValue:ends[def.key],startQuality:'Raw, Good',endQuality:'Good, Raw',
        startTime:specification.startLocal+':00+09:00',endTime:specification.endLocal+':00+09:00',
        durationGoodSeconds:duration,durationBadSeconds:0,durationCoverageValid:true,boundaryValid:true,dataComplete:true
      }))};
  }
  return contract.periodResult({kind:'cofiring_period_live_result',schemaVersion:1,requestId:SOURCE_ID,request:specification,report},SOURCE_ID,specification);
}
function packet(source=sourceResult()){
  const reference=source.report.reference,settings={},manual={unit1:{organic:10,manure:2},unit2:{organic:10,manure:0},receipts:{organic:30,manure:0}};
  for(const unit of ['unit1','unit2'])settings[unit]=Object.fromEntries(['coal','bio','organic','manure'].map(fuel=>[fuel,{calorific:reference.calorifics[unit][fuel],coefficient:reference.coefficients[unit][fuel]}]));
  const p=core.periodRange(spec.startLocal,spec.endLocal,'minute',1);
  const result=core.analyzePeriodSummary(reference,{organic:{start:p.start,end:p.end,unit1:10,unit2:10},manure:{start:p.start,end:p.end,unit1:2,unit2:0}});
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


export { sourceResult, packet, database, call, stored, expect, deleteQuery, SOURCE_ID, DATE, spec, core, contract, adjust, history, clone };
