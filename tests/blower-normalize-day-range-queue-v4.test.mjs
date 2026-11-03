import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';

const apiUrl=new URL('../functions/api/ois-data-requests.js',import.meta.url);
let source=fs.readFileSync(apiUrl,'utf8');
// Captured Blower-only source lacks two unrelated contracts. Isolate those
// uncalled bindings in memory, never create substitute production files or
// return fake contract results. A full clone imports the actual contracts.
for(const [binding,relative] of [['dailyOperationQueryContract','../../daily-operation/daily-operation-query-contract.js'],
  ['bedAshMinuteContract','../../efficiency/bed-ash-minute-contract.js']]) {
  if(!fs.existsSync(new URL(relative,apiUrl))) {
    source=source.replace(`import ${binding} from ${JSON.stringify(relative)};`,`const ${binding}=undefined;`);
  }
}
source=source.replace(/from (["'])(\.\.?\/[^"']+)\1/g,
  (_,quote,relative)=>'from '+JSON.stringify(new URL(relative,apiUrl).href));
const {__normalizeDayQueueV4:api}=await import('data:text/javascript;base64,'+Buffer.from(source+`
export const __normalizeDayQueueV4={createBlowerRuntimeProbeRequest,createBlowerRuntimeProbeBatchRequest,
  loadBlowerRuntimeProbeBatchPreparation,ensureBlowerRuntimeProbeSchema};`).toString('base64'));

const TOKEN='queue-v3-test-session',EMPLOYEE='queue-v3-owner';
const TAG='104HHL60AP611',SECOND='204HHL60AP631';
const nowMs=Math.floor(Date.now()/1000)*1000;
const replacementDay=new Date(nowMs-3*86400000+9*3600000).toISOString().slice(0,10);
const replacement=new Date(replacementDay+'T00:00:00+09:00').toISOString();
const clockNow=new Date(nowMs);
const eventHash='a'.repeat(64);
async function fixture() {
  const sqlite=new DatabaseSync(':memory:'),reads=[];
  const db={prepare(sql){return {sql,bindings:[],bind(...values){this.bindings=values;return this;},
    async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...this.bindings).changes)}};},
    async all(){reads.push({sql,bindings:this.bindings});return {results:sqlite.prepare(sql).all(...this.bindings)};},
    async first(){reads.push({sql,bindings:this.bindings});return sqlite.prepare(sql).get(...this.bindings)||null;}};},
    async batch(items){sqlite.exec('BEGIN IMMEDIATE');try{const out=[];for(const item of items)out.push(await item.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  await history.ensureSchema(db);
  sqlite.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
    CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY NOT NULL,request_type TEXT NOT NULL,target_date TEXT NOT NULL,
      status TEXT NOT NULL,requested_by_id TEXT NOT NULL,requested_by_name TEXT NOT NULL,requested_at TEXT NOT NULL,
      started_at TEXT,completed_at TEXT,agent_id TEXT NOT NULL DEFAULT '',result_json TEXT,error_message TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  sqlite.prepare('INSERT INTO users VALUES(?,?,?,?)').run(EMPLOYEE,'Queue fixture','user',1);
  sqlite.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(TOKEN).digest('hex'),EMPLOYEE,
    new Date(nowMs+86400000).toISOString(),clockNow.toISOString());
  sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='pending',cycle_started_at=NULL,
    cycle_start_revision='normal-start-r1',cycle_runtime_revision='normal-runtime-r1',cycle_runtime_hours=0,runtime_hours=0,
    cycle_runtime_state='stopped',cycle_runtime_anchor_at=?,runtime_anchor_at=NULL,is_running=0,enabled=1`).run(replacement,replacement);
  function asset(tag=TAG){return sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);}
  function auto(tag=TAG,{precision='minute',registeredBaseline=false,missing=false,mutate=null}={}) {
    const startRevision='replacement-auto-v3:'+crypto.randomUUID(),runtimeRevision=crypto.randomUUID();
    sqlite.prepare('UPDATE blower_history_assets SET cycle_start_revision=?,cycle_runtime_revision=? WHERE tag_number=?').run(startRevision,runtimeRevision,tag);
    if(missing)return asset(tag);
    const meta={schemaVersion:3,replacementAutoV3:true,currentCycle:true,timePrecision:precision,
      currentLastReplacementAt:replacement,cycleStartRevision:startRevision,cycleRuntimeRevision:runtimeRevision,
      sourceSnapshotSha256:eventHash,registeredBaseline};
    if(mutate)mutate(meta);
    const eventId='replacement-auto-v3:fixture:'+tag;
    sqlite.prepare(`INSERT INTO blower_history_events(id,tag_number,event_type,event_date,runtime_hours,issue_type,
      action_type,note,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId,tag,registeredBaseline?'cycle_source_reconcile':'replacement',replacement,0,
      '업무일지 교체완료','교체','fixture','shift_log_auto_v3','approved-source-'+tag,JSON.stringify(meta),EMPLOYEE,'Fixture',replacement,replacement);
    return asset(tag);
  }
  function body(tag=TAG){const a=asset(tag);return {action:'create_blower_runtime_probe',unifiedRefresh:true,
    incrementalRefresh:true,requireIncrementalAppend:false,assetTag:tag,
    dataParcTag:tag==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_'+tag,
    confirmRunSignal:true,startAt:a.last_replacement_at,expectedLastReplacementAt:a.last_replacement_at,
    expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',
    expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision};}
  const context={request:new Request('https://example.test/api/ois-data-requests',{headers:{Authorization:'Bearer '+TOKEN}}),env:{DB:db}};
  const parse=async response=>({status:response.status,body:await response.json()});
  const create=async bodyValue=>parse(await api.createBlowerRuntimeProbeRequest(context,bodyValue));
  const single=async(tag=TAG)=>create(body(tag));
  const batch=async tags=>parse(await api.createBlowerRuntimeProbeBatchRequest(context,{action:'create_blower_runtime_probe_batch',requests:tags.map(body)}));
  const count=()=>sqlite.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n;
  const proofReads=()=>reads.filter(row=>row.sql.includes("event_type IN ('replacement','cycle_source_reconcile')"));
  return {sqlite,db,reads,asset,auto,body,create,single,batch,count,proofReads};
}

const rangeStart=new Date(Date.parse(replacement)+86400000).toISOString();
const observedAt=new Date(nowMs-3600000).toISOString();
function dayProof(f,tag=TAG,extra={}){
 const a=f.auto(tag,{precision:'day'});
 return {schemaVersion:3,eventId:'replacement-auto-v3:fixture:'+tag,sourceLogId:'approved-source-'+tag,
  sourceSnapshotSha256:eventHash,timePrecision:'day',registeredBaseline:false,clockKnown:false,requiredStartAt:'',
  normalizationVersion:4,rangeTrackingAllowed:true,rangeStartAt:rangeStart,rangeQueryEligible:true,
  freshQueryEligible:false,cycleStartRevision:a.cycle_start_revision,cycleRuntimeRevision:a.cycle_runtime_revision,...extra};
}
// Queue boundary tests consume a server-side certificate. The common proof
// producer has separate tests; browser JSON is never used as this trusted map.
async function queue(f,proof,body=f.body(),extra={}){
 const context={request:new Request('https://example.test/api/ois-data-requests',{headers:{Authorization:'Bearer '+TOKEN}}),env:{DB:f.db}};
 const response=await api.createBlowerRuntimeProbeRequest(context,body,{now:clockNow,replacementAutoProofsByTag:new Map([[body.assetTag,proof]]),...extra});
 return{status:response.status,body:await response.json()};
}
function seed(f,proof,{tag=TAG,seconds=1800,startAt=rangeStart,withEvent=true}={}){
 const revision='measured-runtime-'+crypto.randomUUID();
 f.sqlite.prepare(`UPDATE blower_history_assets SET cycle_runtime_hours=?,runtime_hours=?,cycle_runtime_revision=?,cycle_runtime_anchor_at=?,runtime_anchor_at=?,cycle_runtime_state='stopped',is_running=0 WHERE tag_number=?`).run(seconds/3600,seconds/3600,revision,observedAt,observedAt,tag);
 const a=f.asset(tag),dataParcTag=f.body(tag).dataParcTag;
 if(withEvent){const source={schemaVersion:1,requestType:'blower_runtime_probe',requestId:'seed-'+tag,assetTag:tag,dataParcTag,
  expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',expectedCycleStartRevision:a.cycle_start_revision,
  expectedCycleRuntimeRevision:proof.cycleRuntimeRevision,signalOnlyCycle:true,startAt,endAt:observedAt,observedAt,runningSeconds:seconds,endState:'stopped'};
  f.sqlite.prepare(`INSERT INTO blower_history_events(id,tag_number,event_type,event_date,runtime_hours,issue_type,action_type,note,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('dataparc_runtime:seed-'+tag,tag,'runtime_correction',observedAt,seconds/3600,'RUN','정지','fixture','dataparc_runtime','seed-'+tag,JSON.stringify(source),EMPLOYEE,'Fixture',observedAt,observedAt);
 }
 return a;
}

test('V4 day range creates a fresh pending-zero seed from the certified later boundary, retaining the legacy Agent wire',async t=>{
 const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f),body=f.body();delete body.startAt;
 const before=f.asset(),out=await queue(f,proof,body);assert.equal(out.status,201,JSON.stringify(out.body));assert.equal(Date.parse(out.body.item.probe.startAt),Date.parse(rangeStart));
 assert.equal(out.body.item.probe.expectedCycleStartState,'legacy');assert.equal(out.body.item.probe.expectedCycleStartRevision,'signal-only-v1:'+before.cycle_start_revision);assert.equal(out.body.item.probe.expectedCycleRuntimeRevision,before.cycle_runtime_revision);assert.deepEqual(f.asset(),before);assert.equal(f.count(),1);
});
test('fresh day-range seed rejects client-selected earlier/later starts and accepts the exact instant',async t=>{
 for(const startAt of [replacement,new Date(Date.parse(rangeStart)+3600000).toISOString(),'invalid-time']){const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f),out=await queue(f,proof,{...f.body(),startAt});assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(out.body.code,'BLOWER_REPLACEMENT_RANGE_INVALID');assert.equal(f.count(),0);}
 const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f),out=await queue(f,proof,{...f.body(),startAt:rangeStart});assert.equal(out.status,201,JSON.stringify(out.body));
});
test('V3 day proof and browser-supplied V4 flags retain the original409 gate',async t=>{
 const f=await fixture();t.after(()=>f.sqlite.close());f.auto(TAG,{precision:'day'});const out=await f.create({...f.body(),normalizationVersion:4,rangeTrackingAllowed:true,rangeStartAt:rangeStart,rangeQueryEligible:true,clockKnown:true});
 assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(out.body.code,'BLOWER_REPLACEMENT_TIME_REQUIRED');assert.equal(f.count(),0);
});
test('only strict current-cycle V4 range certificates cross the day gate',async t=>{
 for(const change of [{normalizationVersion:3},{rangeTrackingAllowed:false},{rangeTrackingAllowed:'true'},{rangeStartAt:'2026-11-01'},{rangeStartAt:replacement},{cycleStartRevision:'another-start'}]){const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f,TAG,change),body={...f.body(),startAt:rangeStart};const out=await queue(f,proof,body);assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(f.count(),0);}
});
test('pending-zero state, reset runtime revision and one-shot eligibility are all required before fresh seeding',async t=>{
 for(const mode of ['no-certificate','wrong-runtime','positive-counter','null-counter','started','manual-mode']){const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f);if(mode==='no-certificate')proof.rangeQueryEligible=false;if(mode==='wrong-runtime')proof.cycleRuntimeRevision='old-runtime';if(mode==='positive-counter')f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=1,runtime_hours=1 WHERE tag_number=?').run(TAG);if(mode==='null-counter')f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=NULL WHERE tag_number=?').run(TAG);if(mode==='started')f.sqlite.prepare("UPDATE blower_history_assets SET cycle_start_state='started',cycle_started_at=? WHERE tag_number=?").run(rangeStart,TAG);const body={...f.body(),startAt:rangeStart,...(mode==='manual-mode'?{incrementalRefresh:false}: {})};const out=await queue(f,proof,body);assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(f.count(),0);}
});
test('a seeded zero-second range cannot be freshly replayed without its verified append event',async t=>{
 const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f);seed(f,proof,{seconds:0,withEvent:false});const out=await queue(f,proof,{...f.body(),startAt:rangeStart});assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(out.body.code,'BLOWER_INCREMENTAL_BASE_REQUIRED');assert.equal(f.count(),0);
});
test('valid partial day-range append keeps the registered proof revision unchanged and uses the current measured revision',async t=>{
 const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f),initialRevision=proof.cycleRuntimeRevision;seed(f,proof);proof.rangeQueryEligible=false;
 const before=f.asset(),out=await queue(f,proof,f.body());assert.equal(out.status,201,JSON.stringify(out.body));assert.notEqual(before.cycle_runtime_revision,initialRevision);assert.equal(proof.cycleRuntimeRevision,initialRevision);assert.equal(Date.parse(out.body.item.probe.startAt),Date.parse(observedAt));assert.equal(out.body.item.probe.expectedCycleRuntimeRevision,'append-v1:'+before.cycle_runtime_revision);assert.deepEqual(f.asset(),before);
 const ledger=f.sqlite.prepare('SELECT * FROM blower_runtime_append_v1').get();assert.equal(Date.parse(ledger.coverage_start_at),Date.parse(rangeStart));assert.equal(ledger.base_running_seconds,1800);
});
test('partial append cannot borrow a different range start or a stale measured revision',async t=>{
 {const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f);seed(f,proof,{startAt:new Date(Date.parse(rangeStart)+3600000).toISOString()});proof.rangeQueryEligible=false;const out=await queue(f,proof);assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(out.body.code,'BLOWER_INCREMENTAL_BASE_REQUIRED');assert.equal(f.count(),0);}
 {const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f);seed(f,proof);proof.rangeQueryEligible=false;const out=await queue(f,proof,f.body(),{appendBasesByTag:new Map([[TAG,{startAt:rangeStart,observedAt,runningSeconds:1800,eventId:'dataparc_runtime:seed-'+TAG,cycleRuntimeRevision:'stale-measured-revision'}]])});assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(f.count(),0);}
});
test('zero-second verified append remains appendable after fresh authority was consumed',async t=>{
 const f=await fixture();t.after(()=>f.sqlite.close());const proof=dayProof(f);seed(f,proof,{seconds:0});proof.rangeQueryEligible=false;const out=await queue(f,proof);assert.equal(out.status,201,JSON.stringify(out.body));assert.equal(Date.parse(out.body.item.probe.startAt),Date.parse(observedAt));assert.equal(f.sqlite.prepare('SELECT base_running_seconds FROM blower_runtime_append_v1').get().base_running_seconds,0);
});
test('a restored Silo range with its original non-prefixed revision keeps the ordinary append path and no proof lookup',async t=>{
 const f=await fixture();t.after(()=>f.sqlite.close());const tag='104ETH03AN602',proof=dayProof(f,tag);
 f.sqlite.prepare('UPDATE blower_history_assets SET cycle_start_revision=? WHERE tag_number=?').run('restored-old-cycle-uuid',tag);
 seed(f,proof,{tag});const before=f.asset(tag),out=await queue(f,null,f.body(tag));
 assert.equal(out.status,201,JSON.stringify(out.body));assert.equal(Date.parse(out.body.item.probe.startAt),Date.parse(observedAt));assert.equal(out.body.item.probe.expectedCycleRuntimeRevision,'append-v1:'+before.cycle_runtime_revision);assert.equal(f.proofReads().length,0);assert.deepEqual(f.asset(tag),before);
});
