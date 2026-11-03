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
const {__queueAutoV3:api}=await import('data:text/javascript;base64,'+Buffer.from(source+`
export const __queueAutoV3={createBlowerRuntimeProbeRequest,createBlowerRuntimeProbeBatchRequest,
  loadBlowerRuntimeProbeBatchPreparation,ensureBlowerRuntimeProbeSchema};`).toString('base64'));

const TOKEN='queue-v3-test-session',EMPLOYEE='queue-v3-owner';
const TAG='104HHL60AP611',SECOND='204HHL60AP631';
const nowMs=Math.floor(Date.now()/1000)*1000;
const replacement=new Date(nowMs-3*86400000).toISOString();
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

test('minute auto replacement permits the existing fresh full RUN queue path',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.auto();
  const out=await f.single();assert.equal(out.status,201,JSON.stringify(out.body));assert.equal(f.count(),1);
  assert.equal(Date.parse(out.body.item.probe.startAt),Date.parse(replacement));
  assert.equal(out.body.item.probe.assetTag,TAG);assert.equal(f.proofReads().length,1);
});

test('day auto replacement is registered history but cannot create a midnight RUN request',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.auto(TAG,{precision:'day'});
  const before=f.asset(),out=await f.single();assert.equal(out.status,409,JSON.stringify(out.body));
  assert.equal(out.body.code,'BLOWER_REPLACEMENT_TIME_REQUIRED');assert.equal(f.count(),0);
  assert.deepEqual(f.asset(),before);assert.equal(f.proofReads().length,1);
});

test('client-supplied proof flags cannot override server-owned day precision',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.auto(TAG,{precision:'day'});
  const out=await f.create({...f.body(),clockKnown:true,registeredBaseline:true,timePrecision:'minute',
    replacementAutoProofsByTag:{[TAG]:{schemaVersion:3,clockKnown:true,registeredBaseline:true,requiredStartAt:replacement}}});
  assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(out.body.code,'BLOWER_REPLACEMENT_TIME_REQUIRED');
  assert.equal(f.count(),0);
});

for(const [name,options] of [
  ['missing proof',{missing:true}],['malformed precision',{precision:'invented'}],
  ['different start revision',{mutate:meta=>{meta.cycleStartRevision='another-revision';}}],
  ['different boundary',{mutate:meta=>{meta.currentLastReplacementAt=new Date(nowMs-3600000).toISOString();}}],
  ['invalid source hash',{mutate:meta=>{meta.sourceSnapshotSha256='not-a-source-hash';}}]
])test(`${name} fails closed before queue creation`,async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.auto(TAG,options);
  const before=f.asset(),out=await f.single();assert.equal(out.status,409,JSON.stringify(out.body));
  assert.equal(out.body.code,'BLOWER_REPLACEMENT_PROOF_REQUIRED');assert.equal(f.count(),0);assert.deepEqual(f.asset(),before);
});

test('a server-owned registered baseline permits its existing query path even when original replacement clock was unknown',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.auto(TAG,{precision:'day',registeredBaseline:true});
  const out=await f.single();assert.equal(out.status,201,JSON.stringify(out.body));assert.equal(f.count(),1);
});

test('an atomic mixed minute/day batch reads metadata once and creates no partial queue',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.auto(TAG);f.auto(SECOND,{precision:'day'});
  const before=[f.asset(TAG),f.asset(SECOND)],out=await f.batch([TAG,SECOND]);
  assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(out.body.code,'BLOWER_REPLACEMENT_TIME_REQUIRED');
  assert.equal(out.body.failedIndex,1);assert.equal(f.count(),0);assert.equal(f.proofReads().length,1);
  assert.deepEqual([f.asset(TAG),f.asset(SECOND)],before);
});

test('a minute/registered-baseline batch reuses one metadata cache through both preparation passes',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.auto(TAG);f.auto(SECOND,{precision:'day',registeredBaseline:true});
  const out=await f.batch([TAG,SECOND]);assert.equal(out.status,201,JSON.stringify(out.body));
  assert.equal(out.body.atomic,true);assert.equal(f.count(),2);assert.equal(f.proofReads().length,1);
});

test('normal 27-asset batch preparation performs exactly its original two reads and no metadata lookup',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.reads.length=0;
  const tags=f.sqlite.prepare('SELECT tag_number FROM blower_history_assets ORDER BY tag_number').all().map(a=>a.tag_number);
  assert.equal(tags.length,27);
  const mappings=tags.map(assetTag=>({assetTag,dataParcTag:f.body(assetTag).dataParcTag}));
  const prepared=await api.loadBlowerRuntimeProbeBatchPreparation(f.db,mappings);
  assert.equal(prepared.assetsByTag.size,27);assert.equal(f.reads.length,2);assert.equal(f.proofReads().length,0);
  assert.equal(Object.hasOwn(prepared,'replacementAutoProofsByTag'),false);
});

test('the single shared metadata query uses the existing equipment-leading event index',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.auto(TAG);f.auto(SECOND);
  await api.loadBlowerRuntimeProbeBatchPreparation(f.db,[TAG,SECOND].map(assetTag=>({assetTag,dataParcTag:f.body(assetTag).dataParcTag})));
  const reads=f.proofReads();assert.equal(reads.length,1);
  const plan=f.sqlite.prepare('EXPLAIN QUERY PLAN '+reads[0].sql).all(...reads[0].bindings);
  assert.ok(plan.some(row=>/SEARCH blower_history_events USING INDEX/.test(row.detail)&&/tag_number=/.test(row.detail)),JSON.stringify(plan));
});

test('a normal single asset preserves the existing query path without a replacement metadata read',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());
  const out=await f.single();assert.equal(out.status,201,JSON.stringify(out.body));assert.equal(f.count(),1);
  assert.equal(f.proofReads().length,0);
});

test('changed proof ownership on a later request is rechecked rather than trusted from a prior call',async t=>{
  const f=await fixture();t.after(()=>f.sqlite.close());f.auto();assert.equal((await f.single()).status,201);
  f.sqlite.prepare('UPDATE blower_history_assets SET cycle_start_revision=? WHERE tag_number=?').run('replacement-auto-v3:'+crypto.randomUUID(),TAG);
  const out=await f.single();assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(f.count(),1);
});
