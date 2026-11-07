import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {onRequestGet as requestsGet} from '../functions/api/ois-data-requests.js';
import {loadApprovedReplacementPage,replacementSourceGuard,storeReplacementLogReceipts,loadCurrentReplacementRoleContext,replacementSourceHashes} from '../functions/_shared/blower-replacement-log-source-v3.js';
import {reconcileApprovedReplacementLog,replacementAutoCycleProof} from '../functions/_shared/blower-replacement-auto-v3.js';
import {COMPLETION_WINDOW_PREFIX,COMPLETION_WINDOW_TAG as TAG,COMPLETION_WINDOW_SIGNAL as SIGNAL,COMPLETION_WINDOW_START as START,COMPLETION_WINDOW_END as END,completionWindowRecoveryCandidate,loadCompletionWindowRecoveryProof,loadCompletionWindowRecoveryReview,persistCompletionWindowRecoveryReview} from '../functions/_shared/blower-completion-window-v1.js';
import {agent,agentClaim,agentComplete,historyPost,callApi} from './helpers/blower-incremental-fixture.mjs';

const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const API_URL=new URL('../functions/api/ois-data-requests.js',import.meta.url);
const source=fs.readFileSync(API_URL,'utf8').replace(/from (["'])(\.\.?\/[^"']+)\1/g,(_,quote,relative)=>'from '+JSON.stringify(new URL(relative,API_URL).href));
const {__completionQueue:queue}=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport const __completionQueue={createBlowerRuntimeProbeRequest,createBlowerRuntimeProbeBatchRequest,buildBlowerRuntimeProbeChunks};').toString('base64'));
const NOW=new Date(Math.floor(Date.now()/1000)*1000),BEFORE_END=new Date(NOW.getTime()-3600000).toISOString();
const OWNER={employeeNo:'completion-owner',name:'Completion fixture',isSuperAdmin:false},TOKEN='completion-session';
const ORIGIN='2026-09-16T00:00:00+09:00',RANGE='2026-09-16T00:30:00.000Z';
const SOURCE_CASES=[
  {role:'BCO2',id:'legacy-POCHEON#20260916#DAY#BCO2',time:'09:23',content:'FBHE Blower #C->#B 교체운전 실시\n- FBHE Blower #C V-Belt 교체 완료(동일->TR)\n- FBHE Left Damper 조정 실시'},
  {role:'BO2',id:'legacy-POCHEON#20260916#DAY#BO2',time:'',content:'[TM] 09:23 FBHE Blower #C V-Blet 전체 교체 실시\n- 교체운전 실시 (#C 정지, #B 기동)\n- V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)\n- FBHE Left Damper 조정 실시'}
];
const parse=async response=>({status:response.status,body:await response.json()});

export async function completionFixture(t,{depthCheck=false,sourceRows=null}={}) {
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());let checkedGuards=0,batchTail=Promise.resolve();
  const sqliteDepth=Number(sql.prepare('PRAGMA compile_options').all().find(row=>row.compile_options.startsWith('MAX_EXPR_DEPTH=')).compile_options.split('=')[1]);
  const db={beforeBatch:null,afterRead:null,prepare(query){
    if(depthCheck && query.includes('INSERT INTO blower_history_atomic_guard') && query.includes('CASE WHEN')){
      sql.prepare('EXPLAIN '+query.replace(' THEN 1 ELSE 0 END)',' AND 1'.repeat(sqliteDepth-100)+' THEN 1 ELSE 0 END)'));checkedGuards++;}
    return {query,values:[],bind(...values){assert.ok(values.length<=100,'D1 bind limit '+values.length);this.values=values;return this;},
      async run(){return {meta:{changes:Number(sql.prepare(query).run(...this.values).changes)}};},
      async first(){const row=sql.prepare(query).get(...this.values)||null;await db.afterRead?.(query,row);return row;},
      async all(){const rows=sql.prepare(query).all(...this.values);await db.afterRead?.(query,rows);return {results:rows};}};
  },async batch(items){if(db.beforeBatch && items.some(item=>item.query.includes('blower_completion_window_intents_v1') || item.query.includes('blower_completion_window_outcomes_v1') || item.values.includes('completion_window_runtime_recovery'))){const fn=db.beforeBatch;db.beforeBatch=null;await fn();}
    const prior=batchTail;let release;batchTail=new Promise(resolve=>{release=resolve});await prior;
    sql.exec('BEGIN IMMEDIATE');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}finally{release();}}};
  await history.ensureSchema(db);await history.ensureIncrementalLogSchema(db);
  sql.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
    CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);
    CREATE INDEX idx_shift_work_date ON shift_logs(work_date,shift,role);
    CREATE TABLE legacy_logs(id INTEGER PRIMARY KEY,legacy_diary_id TEXT NOT NULL UNIQUE,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,entries_json TEXT,original_json TEXT,updated_at TEXT);
    CREATE INDEX idx_legacy_work_date ON legacy_logs(work_date,shift,role);
    CREATE TABLE legacy_log_suppressions(legacy_diary_id TEXT NOT NULL,work_date TEXT NOT NULL,shift TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(legacy_diary_id,work_date,shift,role));
    CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY NOT NULL,request_type TEXT NOT NULL,target_date TEXT NOT NULL,status TEXT NOT NULL,
      requested_by_id TEXT NOT NULL,requested_by_name TEXT NOT NULL,requested_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,agent_id TEXT NOT NULL DEFAULT '',
      result_json TEXT,error_message TEXT NOT NULL DEFAULT '',expires_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  sql.prepare('INSERT INTO users VALUES(?,?,?,1)').run(OWNER.employeeNo,OWNER.name,'user');
  sql.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(TOKEN).digest('hex'),OWNER.employeeNo,new Date(NOW.getTime()+86400000).toISOString(),NOW.toISOString());
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='pending',cycle_started_at=NULL,
    cycle_start_revision='de920f95-7aeb-474e-98a3-7a7d64bae658',cycle_runtime_revision='07d8f1bd-b50a-4b56-bed1-6ce78f2f6e15',cycle_runtime_hours=?,runtime_hours=?,
    cycle_runtime_anchor_at=?,runtime_anchor_at=?,cycle_runtime_state='running',is_running=1 WHERE tag_number=?`).run(ORIGIN,2644666/3600,2644666/3600,BEFORE_END,BEFORE_END,TAG);
  const add=(table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  const event=patch=>add('blower_history_events',{id:'5f022645-7303-4bea-93da-f5afffda4fcc',tag_number:TAG,event_type:'replacement',event_date:ORIGIN,runtime_hours:77,
    issue_type:'',action_type:'교체',note:'Preserved original registration with no completion clock',source_type:'manual',source_log_id:'',source_text:'',
    created_by_id:'prior-owner',created_by_name:'Prior owner',created_at:'2026-09-16T10:00:00.000Z',updated_at:'2026-09-16T10:00:00.000Z',...patch});
  event({});
  const priorId='brb1_267757b9-3cf1-4594-8a91-d13e1c154b12_27_23';
  event({id:'dataparc_runtime:'+priorId,event_type:'runtime_correction',event_date:BEFORE_END,runtime_hours:2644666/3600,source_type:'dataparc_runtime',source_log_id:priorId,
    source_text:JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',requestId:priorId,assetTag:TAG,dataParcTag:SIGNAL,
      startAt:RANGE,endAt:BEFORE_END,observedAt:BEFORE_END,expectedLastReplacementAt:ORIGIN,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',
      expectedCycleStartRevision:'de920f95-7aeb-474e-98a3-7a7d64bae658',expectedCycleRuntimeRevision:'older-runtime',signalOnlyCycle:true,
      startState:'stopped',endState:'running',runningSeconds:2644666,totalRunningHours:2644666/3600}),created_at:BEFORE_END,updated_at:BEFORE_END});
  if(sourceRows){
    for(const table of ['shift_logs','legacy_logs'])for(const row of sourceRows[table]){
      const cols=sql.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name);add(table,Object.fromEntries(cols.map(key=>[key,row[key]])));}
  } else for(const spec of SOURCE_CASES)add('shift_logs',{id:spec.id,work_date:'2026-09-16',shift:'DS',role:spec.role,author:'Original source',status:'결재완료',
    log_json:JSON.stringify({id:spec.id,date:'2026-09-16',shift:'DS',role:spec.role,entries:[{id:'legacy-entry-'+spec.id.slice(7)+'-2-0',time:spec.time,content:spec.content}]}),updated_at:'2026-09-16T10:03:35.033Z'});
  const seed=await loadApprovedReplacementPage(db,{limit:8},{now:NOW,analysisVersion:4});
  const assets=sql.prepare('SELECT * FROM blower_history_assets').all();
  for(const row of seed.logs){const response=await reconcileApprovedReplacementLog(db,OWNER,row,history.collectReplacementFactsForRolePriority(row,assets),
    {now:NOW,normalizationVersion:4,sourceGuard:replacementSourceGuard(row)});assert.equal(response.ok,true);}
  await storeReplacementLogReceipts(db,seed.logs,NOW);
  let window=null,cursor=null;
  for(let index=0;index<16;index++){const response=await parse(await history.latestLogsStep(db,OWNER,{phase:'replacement',incrementalLogs:true,
    replacementAutoVersion:3,normalizationVersion:4,autoApplyConfirmedReplacements:true,limit:2,window,cursor},{now:NOW}));
    assert.equal(response.status,200,JSON.stringify(response.body));if(response.body.done)break;window=response.body.window;cursor=response.body.nextCursor;}
  const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG);
  const events=()=>sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
  assert.ok(completionWindowRecoveryCandidate(asset(),events()),'source-owned pending original range is eligible');
  const before=asset(),beforeEvents=events();
  const body=()=>{const a=asset();return {action:'create_blower_runtime_probe',assetTag:TAG,dataParcTag:SIGNAL,confirmRunSignal:true,completionWindowRecovery:true,
    startAt:START,endAt:END,unifiedRefresh:true,incrementalRefresh:false,requireIncrementalAppend:false,
    expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',
    expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision};};
  const create=async(payload=body(),token=TOKEN,now=NOW)=>parse(await queue.createBlowerRuntimeProbeRequest({env:{DB:db},
    request:new Request('https://example.test/api/ois-data-requests',{headers:token?{Authorization:'Bearer '+token}:{}})},payload,{now}));
  const createBatch=async(requests=[body()],token=TOKEN)=>parse(await queue.createBlowerRuntimeProbeBatchRequest({env:{DB:db},
    request:new Request('https://example.test/api/ois-data-requests',{headers:token?{Authorization:'Bearer '+token}:{}})},
    {action:'create_blower_runtime_probe_batch',requests}));
  function resultFor(item,seconds=0,now=NOW,state='stopped'){
    const probe=item.probe,chunks=queue.buildBlowerRuntimeProbeChunks(probe.startAt,probe.endAt);
    assert.equal(chunks.length,1);Object.assign(chunks[0],{startState:state,endState:state,runningSeconds:seconds,totalRunningHours:seconds/3600});
    return {...probe,requestId:item.id,ok:true,readOnly:true,observedAt:probe.endAt,collectedAt:now.toISOString(),
      startState:state,endState:state,runningSeconds:seconds,totalRunningHours:seconds/3600,completedChunkCount:1,chunks};}
  async function completed(seconds=0,payload=body(),now=NOW){const created=await create(payload,TOKEN,now);assert.equal(created.status,201,JSON.stringify(created.body));return resultFor(created.body.item,seconds,now);}
  const install=(raw,status='complete',completedAt=raw.collectedAt)=>sql.prepare('UPDATE ois_data_requests SET status=?,result_json=?,completed_at=? WHERE id=?').run(status,JSON.stringify(raw),completedAt,raw.requestId);
  const apply=(raw,user=OWNER,now=NOW)=>history.applyCompletionWindowRuntimeRecovery(db,user,{requestId:raw.requestId},{now}).then(parse);
  const get=async(action='data')=>parse(await history.handleGet({env:{DB:db},request:new Request('https://example.test/api/blower-history?action='+action+(action==='refresh_state_page'?'&cursor=204HHL60AP621':''))},OWNER));
  const preserved=(includingCertificate=false)=>{assert.deepEqual(asset(),before);assert.deepEqual(events().filter(row=>!includingCertificate || row.source_type!=='dataparc_completion_window_v1'),beforeEvents);};
  const audits=()=>sql.prepare("SELECT * FROM blower_history_asset_history WHERE action_type='completion_window_runtime_recovery'").all();
  const mutateSource=()=>sql.prepare("UPDATE shift_logs SET log_json=replace(log_json,'09:23','09:24') WHERE role='BCO2'").run();
  return {sql,db,asset,events,before,beforeEvents,body,create,createBatch,resultFor,completed,install,apply,get,preserved,audits,mutateSource,checkedGuards:()=>checkedGuards};
}

async function projected(f,action='data'){const result=await f.get(action);assert.equal(result.status,200,JSON.stringify(result.body));return result.body.assets.find(row=>row.tagNumber===TAG);}

test('completed R3 nonzero window is read-only review, persists under D1 limits, and survives an ordinary append',async t=>{
  const f=await completionFixture(t,{depthCheck:true});
  const raw=await f.completed(1);f.install(raw);
  const writeCount=()=>f.sql.prepare('SELECT total_changes() n').get().n;
  const beforeReads=writeCount();
  const review=await loadCompletionWindowRecoveryReview(f.db,f.asset(),f.events(),{now:NOW});
  assert.equal(review?.reasonCode,'RUN_OBSERVED');assert.equal(review.runningSeconds,1);assert.equal(review.automaticRetry,false);
  assert.equal(writeCount(),beforeReads,'reviewing an old completed request performs no database writes');f.preserved();
  for(const action of ['data','refresh_state_page']){
    const a=await projected(f,action);assert.equal(a.completionWindowRecoveryReview?.requestId,raw.requestId);
    assert.equal(a.completionWindowRecovery?.eligible,false);assert.equal(a.completionWindowProof,undefined);
    assert.ok(a.cycleSourceReview);assert.equal(core.plan([a],NOW).tasks[0].kind,'dataparc');
  }
  const retry=await f.create();assert.equal(retry.status,409,JSON.stringify(retry.body));
  assert.equal(retry.body.code,'BLOWER_COMPLETION_WINDOW_SOURCE_REQUIRED');
  const payload={...f.body(),completionWindowRecovery:false,incrementalRefresh:true,requireIncrementalAppend:true};delete payload.startAt;delete payload.endAt;
  const append=await f.create(payload,TOKEN,NOW);assert.equal(append.status,201,JSON.stringify(append.body));
  const appended=f.resultFor(append.body.item,3600,NOW,'running');f.install(appended);
  const result=await parse(await history.applyDataParcRuntimeSync(f.db,OWNER,{requestId:appended.requestId},{now:NOW}));
  assert.equal(result.status,200,JSON.stringify(result.body));
  const stored=f.sql.prepare('SELECT * FROM blower_completion_window_outcomes_v1 WHERE request_id=?').get(raw.requestId);assert.ok(stored);
  const after=await projected(f);assert.equal(after.completionWindowRecovery?.eligible,false);
  assert.equal(after.completionWindowRecoveryReview?.runtimeRevision,f.asset().cycle_runtime_revision);
  assert.equal(after.completionWindowRecoveryReview?.runtimeRequestId,appended.requestId);
  assert.equal(after.completionWindowRecoveryReview?.proofFingerprint,review.proofFingerprint);
  assert.equal(f.asset().cycle_runtime_hours,f.before.cycle_runtime_hours+1);
  assert.equal(after.completionWindowProof,undefined);assert.ok(after.cycleSourceReview);
  f.sql.prepare('DELETE FROM ois_data_requests WHERE id=?').run(raw.requestId);
  assert.equal((await projected(f)).completionWindowRecoveryReview?.requestId,raw.requestId,'durable evidence survives raw request retention');
  assert.ok(f.checkedGuards()>=2);assert.equal(f.audits().length,0);
});

test('fresh nonzero apply records a negative result and never changes a saved runtime or event',async t=>{
  const f=await completionFixture(t,{depthCheck:true}),raw=await f.completed(7);f.install(raw);
  const result=await f.apply(raw);assert.equal(result.status,409,JSON.stringify(result.body));
  assert.equal(result.body.code,'BLOWER_COMPLETION_WINDOW_NOT_ZERO');assert.equal(result.body.completionWindowRecoveryReview?.reasonCode,'RUN_OBSERVED');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM blower_completion_window_outcomes_v1').get().n,1);
  f.preserved();assert.equal(f.audits().length,0);
  const stored=f.sql.prepare('SELECT * FROM blower_completion_window_outcomes_v1').get();
  await persistCompletionWindowRecoveryReview(f.db,f.asset(),undefined,{now:NOW});
  assert.deepEqual(f.sql.prepare('SELECT * FROM blower_completion_window_outcomes_v1').get(),stored);
});

test('zero seconds with an unproven stopped boundary is distinct from observed RUN',async t=>{
  const f=await completionFixture(t),raw=await f.completed();raw.startState='running';raw.chunks[0].startState='running';f.install(raw);
  const result=await f.apply(raw);assert.equal(result.status,409,JSON.stringify(result.body));
  const review=result.body.completionWindowRecoveryReview;assert.equal(review?.reasonCode,'CONTINUOUS_STOP_UNPROVEN');assert.equal(review.runningSeconds,0);
  assert.equal((await projected(f)).completionWindowRecovery?.eligible,false);f.preserved();assert.equal(f.audits().length,0);
});

test('old completed zero data cannot create either a negative outcome or a fresh success certificate',async t=>{
  const f=await completionFixture(t),raw=await f.completed();f.install(raw);const later=new Date(NOW.getTime()+86400000);
  assert.equal(await loadCompletionWindowRecoveryReview(f.db,f.asset(),f.events(),{now:later}),null);
  assert.equal(await persistCompletionWindowRecoveryReview(f.db,f.asset(),undefined,{now:later}),null);
  const result=await f.apply(raw,OWNER,later);assert.equal(result.status,409,JSON.stringify(result.body));
  assert.equal(result.body.code,'BLOWER_COMPLETION_WINDOW_COLLECTION_STALE');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM blower_completion_window_outcomes_v1').get().n,0);f.preserved();
});

for(const mode of ['schema','incomplete','chunk-sum','unknown-state','wrong-window','request-intent','future-collection','network-error'])test('uncertain '+mode+' result cannot suppress automatic recovery as negative evidence',async t=>{
  const f=await completionFixture(t),raw=await f.completed(1);let status='complete';
  if(mode==='schema')raw.schemaVersion=2;
  if(mode==='incomplete')raw.completedChunkCount=0;
  if(mode==='chunk-sum')raw.chunks[0].runningSeconds=0;
  if(mode==='unknown-state')raw.startState=raw.chunks[0].startState='unknown';
  if(mode==='wrong-window')raw.startAt=raw.chunks[0].startAt=RANGE;
  if(mode==='request-intent')f.sql.prepare("UPDATE blower_runtime_probe_intents_v5 SET expected_cycle_runtime_revision='foreign' WHERE request_id=?").run(raw.requestId);
  if(mode==='future-collection')raw.collectedAt=new Date(NOW.getTime()+6*60000).toISOString();
  if(mode==='network-error'){raw.ok=false;status='error';}
  f.install(raw,status);
  assert.equal(await loadCompletionWindowRecoveryReview(f.db,f.asset(),f.events(),{now:NOW}),null);
  assert.equal(await persistCompletionWindowRecoveryReview(f.db,f.asset(),undefined,{now:NOW}),null);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM blower_completion_window_outcomes_v1').get().n,0);f.preserved();
});

for(const mode of ['edited','unapproved','excluded','annotated'])test('source '+mode+' invalidates a durable negative observation without clearing the original review',async t=>{
  const f=await completionFixture(t),raw=await f.completed(1);f.install(raw);
  const review=await persistCompletionWindowRecoveryReview(f.db,f.asset(),undefined,{now:NOW});assert.ok(review);
  f.sql.prepare('DELETE FROM ois_data_requests WHERE id=?').run(raw.requestId);sourceChange(f,mode);
  const current=await projected(f);assert.equal(current.completionWindowRecoveryReview,undefined);assert.equal(current.completionWindowProof,undefined);
  assert.ok(current.cycleSourceReview);f.preserved();
});

for(const race of ['source','raw'])test('negative outcome commit rejects atomic '+race+' changes and leaves the counter intact',async t=>{
  const f=await completionFixture(t,{depthCheck:true}),raw=await f.completed(1);f.install(raw);
  f.db.beforeBatch=race==='source'?f.mutateSource:()=>f.sql.prepare("UPDATE ois_data_requests SET result_json='{}' WHERE id=?").run(raw.requestId);
  await assert.rejects(persistCompletionWindowRecoveryReview(f.db,f.asset(),undefined,{now:NOW}),error=>error.code==='BLOWER_COMPLETION_WINDOW_CONFLICT');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM blower_completion_window_outcomes_v1').get().n,0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM blower_history_atomic_guard').get().n,0);f.preserved();
});

test('tampered durable negative evidence is rejected when the original raw request has expired',async t=>{
  const f=await completionFixture(t),raw=await f.completed(1);f.install(raw);
  assert.ok(await persistCompletionWindowRecoveryReview(f.db,f.asset(),undefined,{now:NOW}));
  f.sql.prepare('DELETE FROM ois_data_requests WHERE id=?').run(raw.requestId);
  f.sql.prepare("UPDATE blower_completion_window_outcomes_v1 SET outcome_json=json_set(outcome_json,'$.reasonCode','CONTINUOUS_STOP_UNPROVEN') WHERE request_id=?").run(raw.requestId);
  assert.equal(await loadCompletionWindowRecoveryReview(f.db,f.asset(),f.events(),{now:NOW}),null);f.preserved();
});

test('historical zero request is source-pinned, exposes typed mode in authenticated API, and cannot use generic runtime sync',async t=>{
  const f=await completionFixture(t);const before=await projected(f);assert.ok(before.completionWindowRecovery?.eligible);assert.ok(before.cycleSourceReview);
  f.preserved();const created=await f.create();assert.equal(created.status,201,JSON.stringify(created.body));const item=created.body.item;
  assert.equal(Date.parse(item.probe.startAt),Date.parse(START));assert.equal(Date.parse(item.probe.endAt),Date.parse(END));assert.equal(item.probe.expectedCycleRuntimeRevision,COMPLETION_WINDOW_PREFIX+f.before.cycle_runtime_revision);
  assert.equal(item.probe.runtimeRecovery?.mode,'completion_window_zero');
  const detail=await parse(await requestsGet({env:{DB:f.db},request:new Request('https://example.test/api/ois-data-requests?action=detail&id='+item.id,{headers:{Authorization:'Bearer '+TOKEN}})}));
  assert.equal(detail.status,200,JSON.stringify(detail.body));assert.equal(detail.body.item.probe.runtimeRecovery?.mode,'completion_window_zero');
  const again=await f.create();assert.equal(again.status,200,JSON.stringify(again.body));assert.equal(again.body.item.id,item.id);f.preserved();
  const raw=f.resultFor(item);f.install(raw);const generic=await parse(await history.applyDataParcRuntimeSync(f.db,OWNER,{requestId:item.id},{now:NOW}));
  assert.equal(generic.status,409,JSON.stringify(generic.body));assert.equal(generic.body.code,'BLOWER_COMPLETION_WINDOW_APPLY_REQUIRED');f.preserved();
});

test('exact historical zero certifies duration only, preserves every original value, replays, and survives a real ordinary append',async t=>{
  const f=await completionFixture(t,{depthCheck:true});const raw=await f.completed();f.install(raw);
  const result=await f.apply(raw);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.certificateOnly,true);assert.equal(result.body.applied,true);
  assert.equal(result.body.runtimeHours,f.before.cycle_runtime_hours);assert.equal(result.body.observedAt,f.before.cycle_runtime_anchor_at);f.preserved(true);
  const cert=f.events().find(row=>row.source_type==='dataparc_completion_window_v1');assert.ok(cert);assert.ok(cert.source_text.length<=2000);
  assert.equal(f.sql.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(raw.requestId).result_json,JSON.stringify(raw));assert.equal(f.audits().length,1);
  for(const action of ['data','refresh_state_page']){const a=await projected(f,action);assert.equal(a.runtimeHours,f.before.cycle_runtime_hours);assert.equal(a.actualLastReplacementAt,'');assert.equal(a.lastReplacementAt,ORIGIN);
    assert.equal(a.completionWindowProof?.durationVerified,true);assert.equal(a.completionWindowProof?.completionClockKnown,false);assert.equal(a.runtimeCoverageEvidence?.durationEquivalent,true);
    assert.equal(a.runtimeCoverageEvidence?.wholeCycleVerified,false);assert.equal(a.cycleSourceReview,undefined);assert.equal(a.completionWindowRecovery,undefined);assert.ok(core.verifiedCompletionWindow(a));assert.equal(core.fbheSealRunView(a).durationEquivalent,true);}
  const replay=await f.apply(raw,OWNER,new Date(NOW.getTime()+86400000));assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.replayed,true);f.preserved(true);assert.equal(f.audits().length,1);
  const payload={...f.body(),completionWindowRecovery:false,incrementalRefresh:true,requireIncrementalAppend:true};delete payload.startAt;delete payload.endAt;
  const append=await f.create(payload,TOKEN,NOW);assert.equal(append.status,201,JSON.stringify(append.body));assert.equal(Date.parse(append.body.item.probe.startAt),Date.parse(BEFORE_END));
  const appended=f.resultFor(append.body.item,3600,NOW,'running');f.install(appended);
  const applied=await parse(await history.applyDataParcRuntimeSync(f.db,OWNER,{requestId:appended.requestId},{now:NOW}));assert.equal(applied.status,200,JSON.stringify(applied.body));
  const a=await projected(f);assert.equal(a.completionWindowProof?.requestId,raw.requestId);assert.equal(a.completionWindowProof?.runtimeRequestId,appended.requestId);assert.equal(a.completionWindowProof?.runtimeRevision,f.asset().cycle_runtime_revision);
  assert.equal(a.runtimeCoverageEvidence?.durationEquivalent,true);assert.equal(a.cycleSourceReview,undefined);assert.equal(a.completionWindowRecovery,undefined);assert.ok(core.verifiedCompletionWindow(a));assert.ok(f.checkedGuards()>=4);
});

for(const [key,value] of [['startAt',RANGE],['endAt',NOW.toISOString()],['assetTag','104HHL60AP631'],['dataParcTag','GSPOGE.ABB_DCS.104HHL60AP631XB04'],['expectedCycleRuntimeRevision','changed'],['expectedCycleStartRevision','changed'],['expectedLastReplacementAt',START],['incrementalRefresh',true],['requireIncrementalAppend',true],['rolePriorityRecovery',true]])test('queue rejects altered '+key,async t=>{
  const f=await completionFixture(t);const response=await f.create({...f.body(),[key]:value});assert.ok([400,409].includes(response.status),JSON.stringify(response.body));f.preserved();assert.equal(f.sql.prepare('SELECT count(*) n FROM ois_data_requests').get().n,0);
});

for(const mode of ['run-second','start-running','end-running','incomplete','rounded-zero','wrong-window','foreign-owner','collected-stale','completed-stale','collected-future','completed-future'])test('apply protects current values when '+mode,async t=>{
  const f=await completionFixture(t);const raw=await f.completed();let user=OWNER,completedAt=NOW.toISOString();
  if(mode==='run-second'){raw.runningSeconds=1;raw.totalRunningHours=1/3600;Object.assign(raw.chunks[0],{runningSeconds:1,totalRunningHours:1/3600});}
  if(mode==='start-running'){raw.startState='running';raw.chunks[0].startState='running';}
  if(mode==='end-running'){raw.endState='running';raw.chunks[0].endState='running';}
  if(mode==='incomplete')raw.completedChunkCount=0;
  if(mode==='rounded-zero'){raw.chunks[0].runningSeconds=1;raw.chunks[0].totalRunningHours=1/3600;}
  if(mode==='wrong-window'){raw.startAt=RANGE;raw.chunks[0].startAt=RANGE;}
  if(mode==='foreign-owner')user={...OWNER,employeeNo:'other'};
  if(mode==='collected-stale')raw.collectedAt=new Date(NOW.getTime()-16*60000).toISOString();
  if(mode==='completed-stale')completedAt=new Date(NOW.getTime()-16*60000).toISOString();
  if(mode==='collected-future')raw.collectedAt=new Date(NOW.getTime()+6*60000).toISOString();
  if(mode==='completed-future')completedAt=new Date(NOW.getTime()+6*60000).toISOString();
  f.install(raw,'complete',completedAt);const response=await f.apply(raw,user);assert.ok([400,403,409].includes(response.status),JSON.stringify(response.body));f.preserved();assert.equal(f.audits().length,0);
});

function sourceChange(f,mode){
  if(mode==='edited')f.mutateSource();
  if(mode==='deleted')f.sql.prepare("DELETE FROM shift_logs WHERE role='BCO2'").run();
  if(mode==='unapproved')f.sql.prepare("UPDATE shift_logs SET status='작성중' WHERE role='BCO2'").run();
  if(mode==='late-peer')f.sql.prepare("INSERT INTO shift_logs SELECT 'new-approved-peer',work_date,shift,role,author,status,log_json,updated_at FROM shift_logs WHERE role='BCO2'").run();
  if(mode==='excluded')f.sql.prepare(`INSERT INTO blower_history_candidates(id,source_fingerprint,tag_number,detected_type,detected_date,source_log_id,source_text,status,created_at) VALUES('excluded','excluded',?,'replacement',?,'legacy-POCHEON#20260916#DAY#BO2','excluded','excluded',?)`).run(TAG,ORIGIN,NOW.toISOString());
  if(mode==='annotated')f.sql.prepare("UPDATE shift_logs SET log_json=json_set(log_json,'$.entries[0].vBeltReplacement',json('{\"completedAt\":\"2026-09-16T10:00:00+09:00\"}')) WHERE role='BO2'").run();
  if(mode==='missing-suppression')f.sql.exec('DROP TABLE legacy_log_suppressions');
}
for(const mode of ['edited','deleted','unapproved','late-peer','excluded','annotated','missing-suppression'])test('source '+mode+' invalidates queued apply and prevents false duration certification',async t=>{
  const f=await completionFixture(t);const raw=await f.completed();f.install(raw);sourceChange(f,mode);const response=await f.apply(raw);assert.equal(response.status,409,JSON.stringify(response.body));f.preserved();assert.equal(f.audits().length,0);
});
for(const mode of ['edited','deleted','unapproved','late-peer','excluded','annotated','missing-suppression'])test('source '+mode+' after a certificate restores review without changing runtime',async t=>{
  const f=await completionFixture(t);const raw=await f.completed();f.install(raw);const result=await f.apply(raw);assert.equal(result.status,200,JSON.stringify(result.body));sourceChange(f,mode);
  const a=await projected(f);assert.equal(a.completionWindowProof,undefined);assert.notEqual(a.runtimeCoverageEvidence?.durationEquivalent,true);assert.ok(a.cycleSourceReview);f.preserved(true);
});

test('atomic guard catches a source edit inside the apply transaction',async t=>{
  const f=await completionFixture(t);const raw=await f.completed();f.install(raw);f.db.beforeBatch=f.mutateSource;
  const result=await f.apply(raw);assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(result.body.code,'BLOWER_COMPLETION_WINDOW_CONFLICT');f.preserved();assert.equal(f.audits().length,0);
});

test('raw request cannot change between validation and certificate commit',async t=>{
  const f=await completionFixture(t);const raw=await f.completed();f.install(raw);f.db.beforeBatch=()=>f.sql.prepare("UPDATE ois_data_requests SET result_json='{}' WHERE id=?").run(raw.requestId);
  const result=await f.apply(raw);assert.equal(result.status,409,JSON.stringify(result.body));f.preserved();assert.equal(f.audits().length,0);
});

test('tampered certificate, audit, current owner or equal manual overlay cannot borrow historical zero proof',async t=>{
  const f=await completionFixture(t);const raw=await f.completed();f.install(raw);assert.equal((await f.apply(raw)).status,200);
  const certificate=f.events().find(row=>row.source_type==='dataparc_completion_window_v1'),audit=f.audits()[0],before=f.asset();
  for(const mode of ['certificate','audit','owner','equal-manual']){
    if(mode==='certificate')f.sql.prepare('UPDATE blower_history_events SET updated_at=? WHERE id=?').run(new Date(NOW.getTime()+1000).toISOString(),certificate.id);
    if(mode==='audit')f.sql.prepare('UPDATE blower_history_asset_history SET after_json=? WHERE id=?').run('{}',audit.id);
    if(mode==='owner')f.sql.prepare("UPDATE blower_history_assets SET cycle_start_revision='changed' WHERE tag_number=?").run(TAG);
    if(mode==='equal-manual'){const row=f.events().find(row=>row.id.startsWith('dataparc_runtime:'));const meta=JSON.parse(row.source_text);meta.manualOverride={version:1,hours:before.cycle_runtime_hours};f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(meta),row.id);}
    const a=await projected(f);assert.equal(a.completionWindowProof,undefined,mode);assert.notEqual(a.runtimeCoverageEvidence?.durationEquivalent,true,mode);
    f.sql.prepare('UPDATE blower_history_events SET updated_at=?,source_text=? WHERE id=?').run(certificate.updated_at,certificate.source_text,certificate.id);
    f.sql.prepare('UPDATE blower_history_asset_history SET after_json=? WHERE id=?').run(audit.after_json,audit.id);
    f.sql.prepare('UPDATE blower_history_assets SET cycle_start_revision=? WHERE tag_number=?').run(before.cycle_start_revision,TAG);
    for(const row of f.beforeEvents)f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(row.source_text,row.id);
  }
});

test('actual batch→existing Agent parser→complete→dedicated authenticated API certifies without Agent changes',async t=>{
  const f=await completionFixture(t,{depthCheck:true});const batch=await f.createBatch();assert.equal(batch.status,201,JSON.stringify(batch.body));
  const item=batch.body.results[0].item;assert.match(item.id,/^brb1_[a-f0-9-]{36}_01_00$/);assert.equal(item.probe.runtimeRecovery?.mode,'completion_window_zero');
  const claimed=await agentClaim(f.db);assert.equal(claimed.status,200,JSON.stringify(claimed.body));const acquired=claimed.body.items.excel;assert.equal(acquired.id,item.id);
  const parsed=agent.parseClaim(acquired);assert.equal(parsed.expectedCycleRuntimeRevision,COMPLETION_WINDOW_PREFIX+f.before.cycle_runtime_revision);
  const normalized=agent.normalizeResult(f.resultFor(acquired),parsed);const complete=await agentComplete(f.db,item.id,normalized);
  assert.equal(complete.status,200,JSON.stringify(complete.body));assert.equal(complete.body.item.status,'complete');f.preserved();
  const raw=f.sql.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(item.id).result_json;
  const apply=await callApi(historyPost,f.db,new Request('https://example.test/api/blower-history',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({action:'apply_completion_window_runtime_recovery',requestId:item.id})}));
  assert.equal(apply.status,200,JSON.stringify(apply.body));assert.equal(apply.body.certificateOnly,true);f.preserved(true);
  assert.equal(f.sql.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(item.id).result_json,raw);
  const a=await projected(f);assert.equal(a.completionWindowProof?.durationVerified,true);assert.equal(a.actualLastReplacementAt,'');assert.equal(a.cycleSourceReview,undefined);
});

for(const mode of ['runtime-revision','counter','replacement-owner','cycle-owner','earlier-source-hash','manual-overlay'])test('queued proof cannot move to a changed '+mode,async t=>{
  const f=await completionFixture(t);const raw=await f.completed();f.install(raw);
  if(mode==='runtime-revision')f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='other' WHERE tag_number=?").run(TAG);
  if(mode==='counter')f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=cycle_runtime_hours+1,runtime_hours=runtime_hours+1 WHERE tag_number=?').run(TAG);
  if(mode==='replacement-owner')f.sql.prepare("UPDATE blower_history_events SET id='other-owner' WHERE tag_number=? AND event_type='replacement'").run(TAG);
  if(mode==='cycle-owner')f.sql.prepare("UPDATE blower_history_assets SET cycle_start_revision='other' WHERE tag_number=?").run(TAG);
  if(mode==='earlier-source-hash'){
    const proof=replacementAutoCycleProof(f.asset(),f.events()),context=await loadCurrentReplacementRoleContext(f.db,{workDate:'2026-09-16',shift:'DS'});
    const old=(await replacementSourceHashes(context.logs.find(row=>row.id===proof.sourceLogId))).sourceSnapshotHistorySha256[0];
    f.sql.prepare("UPDATE blower_history_events SET source_text=json_set(source_text,'$.sourceSnapshotSha256',?) WHERE id=?").run(old,proof.eventId);
  }
  if(mode==='manual-overlay')f.sql.prepare(`INSERT INTO blower_history_events SELECT 'newer-manual',tag_number,'runtime_correction',event_date,runtime_hours,issue_type,'운전중','equal manual overlay','manual','','',created_by_id,created_by_name,?,? FROM blower_history_events WHERE source_type='dataparc_runtime' AND tag_number=?`).run(NOW.toISOString(),NOW.toISOString(),TAG);
  const assets=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG),events=f.events();
  const result=await f.apply(raw);assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(f.audits().length,0);assert.deepEqual(f.asset(),assets);assert.deepEqual(f.events(),events);
});

test('source changes inside queue transaction roll back both request and intent',async t=>{
  const f=await completionFixture(t);f.db.beforeBatch=f.mutateSource;const result=await f.create();assert.equal(result.status,409,JSON.stringify(result.body));f.preserved();
  assert.equal(f.sql.prepare('SELECT count(*) n FROM ois_data_requests').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM blower_completion_window_intents_v1').get().n,0);
});

test('completed certificate replay rejects changed certificate or audit evidence',async t=>{
  const f=await completionFixture(t);const raw=await f.completed();f.install(raw);assert.equal((await f.apply(raw)).status,200);
  const cert=f.events().find(row=>row.source_type==='dataparc_completion_window_v1');f.sql.prepare("UPDATE blower_history_events SET source_text='{}' WHERE id=?").run(cert.id);
  const result=await f.apply(raw);assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(result.body.code,'BLOWER_COMPLETION_WINDOW_IDEMPOTENCY_CONFLICT');assert.deepEqual(f.asset(),f.before);assert.equal(f.audits().length,1);
});

test('concurrent identical applies create one certificate and replay the winning immutable audit',async t=>{
  const f=await completionFixture(t);const raw=await f.completed();f.install(raw);
  const results=await Promise.all([f.apply(raw),f.apply(raw)]);for(const result of results)assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(results.filter(result=>result.body.applied===true).length,1);assert.equal(results.filter(result=>result.body.replayed===true).length,1);
  assert.equal(f.audits().length,1);assert.equal(f.events().filter(row=>row.source_type==='dataparc_completion_window_v1').length,1);f.preserved(true);
});
