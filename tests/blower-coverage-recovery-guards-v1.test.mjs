import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import {
  COVERAGE_RECOVERY_PREFIX, ensureCoverageRecoverySchema, loadCoverageRecoveryProof,
  validateCoverageRecoveryView, coverageRecoveryQueueStatements, validCoverageRecoveryReuse,
  loadCoverageRecoveryIntent, validateCoverageRecoveryApply
} from '../functions/_shared/blower-coverage-recovery-v1.js';
import { loadCurrentReplacementRoleContext, replacementSourceHashes, storeReplacementLogReceipts } from '../functions/_shared/blower-replacement-log-source-v3.js';
import { fixture as apiFixture, browserCreate, agentClaim, agentComplete, callApi,
  BROWSER_TOKEN, BROWSER_EMPLOYEE_NO, history, historyPost } from './helpers/blower-incremental-fixture.mjs';

const require = createRequire(import.meta.url);
const core = require('../maintenance/blower-unified-refresh.js');
const assessment = require('../maintenance/blower-runtime-assessment.js');
const uiSource = fs.readFileSync(new URL('../maintenance/blower-history.js',import.meta.url),'utf8');

const NOW = new Date('2026-11-06T09:36:00.000Z');
const END = '2026-11-06T09:29:35.000Z';
const BAG = '104ETG30AN602', SEAL_A = '204HHL10AN611', SEAL_C = '204HHL10AN631';
const BAG_ORIGIN = '2026-09-25T05:40:00.000Z';
const SEAL_ORIGIN = '2026-05-11T00:00:00+09:00';
const SOURCE = 'legacy-POCHEON#20260925#DAY#BCO1';
const DIARY = SOURCE.slice(7);
const sourceEntry = {id:'legacy-entry-POCHEON#20260925#DAY#BCO1-2-5',time:'14:40',
  content:'Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 완료_TM 작업'};
const errorCode = code => error => error.code === code && error.status >= 400;

async function fixture(t, {tag=BAG,legacy=false,depthCheck=false} = {}) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  const reads = [], writes = [];
  let guardsChecked = 0;
  const sqliteDepth = Number(sql.prepare('PRAGMA compile_options').all()
    .find(row => row.compile_options.startsWith('MAX_EXPR_DEPTH=')).compile_options.split('=')[1]);
  const db = {prepare(query) {
    if (depthCheck && query.includes('INSERT INTO blower_history_atomic_guard') && query.includes('CASE WHEN')) {
      sql.prepare('EXPLAIN ' + query.replace(' THEN 1 ELSE 0 END)', ' AND 1'.repeat(sqliteDepth-100) + ' THEN 1 ELSE 0 END)'));
      guardsChecked++;
    }
    return {query,values:[],bind(...values) {assert.ok(values.length <= 100,'D1 bind limit: ' + values.length);this.values=values;return this;},
      async all() {reads.push(query);return {results:sql.prepare(query).all(...this.values)};},
      async first() {reads.push(query);return sql.prepare(query).get(...this.values) || null;},
      async run() {writes.push(query);return {meta:{changes:Number(sql.prepare(query).run(...this.values).changes)}};}};
  },async batch(statements) {
    sql.exec('BEGIN IMMEDIATE');
    try {const out=[];for(const statement of statements)out.push(await statement.run());sql.exec('COMMIT');return out;}
    catch(error) {sql.exec('ROLLBACK');throw error;}
  }};
  const bag = tag === BAG;
  const signal = bag ? 'GSPOGE.ABB_DCS.103ETG30AN602XJ04' : `GSPOGE.ABB_DCS.${tag}XB04`;
  const origin = bag ? BAG_ORIGIN : SEAL_ORIGIN;
  const tailStart = bag ? '2026-10-17T23:04:00.000Z'
    : tag === SEAL_A ? '2026-05-18T09:00:00.000Z' : '2026-05-11T09:00:00.000Z';
  const oldSeconds = bag ? 1679073 : 3600000;
  const initial = {tag_number:tag,blower_type:bag?'flyash_bag':'seal_pot',unit_no:bag?'1':'2',
    position_label:bag?'#B':tag===SEAL_A?'#A':'#C',display_name:'Guard fixture',sort_order:1,enabled:1,
    last_replacement_at:origin,runtime_hours:oldSeconds/3600,runtime_anchor_at:END,is_running:1,
    last_modified_by_id:'prior-owner',last_modified_by_name:'Prior owner',created_at:'2026-08-26T00:23:08.335Z',
    updated_at:END,asset_group:'',asset_revision:'',cycle_started_at:bag?tailStart:null,
    cycle_start_state:bag?'started':'legacy',cycle_start_revision:'prior-start',cycle_runtime_hours:oldSeconds/3600,
    cycle_runtime_anchor_at:END,cycle_runtime_state:'running',cycle_runtime_revision:'prior-runtime',limestone_basis_confirmation:''};
  sql.exec(`CREATE TABLE blower_history_assets (${Object.keys(initial).map(key => key + (key==='tag_number'?' TEXT PRIMARY KEY'
    : ['enabled','sort_order','is_running'].includes(key)?' INTEGER':key.endsWith('_hours')?' REAL':' TEXT')).join(',')});
    CREATE TABLE blower_history_events(id TEXT PRIMARY KEY,tag_number TEXT,event_type TEXT,event_date TEXT,runtime_hours REAL,
      issue_type TEXT,action_type TEXT,note TEXT,source_type TEXT,source_log_id TEXT,source_text TEXT,
      created_by_id TEXT,created_by_name TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE blower_history_candidates(id TEXT PRIMARY KEY,tag_number TEXT,status TEXT,detected_type TEXT,source_log_id TEXT);
    CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);
    CREATE INDEX idx_shift_work_date ON shift_logs(work_date,shift,role);
    CREATE TABLE legacy_logs(id INTEGER PRIMARY KEY,legacy_diary_id TEXT NOT NULL UNIQUE,work_date TEXT,shift TEXT,role TEXT,
      author TEXT,status TEXT,entries_json TEXT,original_json TEXT,updated_at TEXT);
    CREATE INDEX idx_legacy_work_date ON legacy_logs(work_date,shift,role);
    CREATE TABLE legacy_log_suppressions(legacy_diary_id TEXT NOT NULL,work_date TEXT NOT NULL,shift TEXT NOT NULL,role TEXT NOT NULL,
      PRIMARY KEY(legacy_diary_id,work_date,shift,role));
    CREATE TABLE blower_log_receipts_v1(log_id TEXT PRIMARY KEY,source_snapshot TEXT,replacement_done INTEGER,operation_done INTEGER,processed_at TEXT);
    CREATE TABLE queued_requests(id TEXT PRIMARY KEY);
    CREATE TABLE applied_repairs(id TEXT PRIMARY KEY);`);
  const add = (table,row) => sql.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  add('blower_history_assets',initial);
  const event = patch => add('blower_history_events',{id:'replacement-owner',tag_number:tag,event_type:'replacement',event_date:origin,
    runtime_hours:0,issue_type:'',action_type:'V-Belt 교체',note:'Saved replacement registration',source_type:bag?'shift_log_auto':'manual',
    source_log_id:bag?SOURCE:'',source_text:bag?sourceEntry.content:'',created_by_id:'prior-owner',created_by_name:'Prior owner',
    created_at:'2026-10-20T09:20:27.067Z',updated_at:'2026-10-20T09:20:27.067Z',...patch});
  event({});
  event({id:'dataparc_runtime:prior-query',event_type:'runtime_correction',event_date:END,runtime_hours:oldSeconds/3600,
    source_type:'dataparc_runtime',source_log_id:'prior-query',created_at:END,updated_at:END,
    source_text:JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',requestId:'prior-query',assetTag:tag,dataParcTag:signal,
      startAt:tailStart,endAt:END,observedAt:END,expectedLastReplacementAt:origin,expectedCycleStartState:initial.cycle_start_state,
      expectedCycleStartedAt:initial.cycle_started_at||'',expectedCycleStartRevision:'prior-start',expectedCycleRuntimeRevision:'older-runtime',
      startState:'running',endState:'running',runningSeconds:oldSeconds,totalRunningHours:oldSeconds/3600,collectedAt:END,chunkCount:1})});
  const canonicalSource = (id=SOURCE,role='BCO1',content=sourceEntry.content) => {
    const row={id,work_date:'2026-09-25',shift:'DS',role,author:'Approved source',status:'결재완료',
      log_json:JSON.stringify({id,date:'2026-09-25',shift:'DS',role,entries:[{...sourceEntry,content}]}),updated_at:'2026-09-25T10:00:00Z'};
    add('shift_logs',row);return row;
  };
  if (bag) {
    event({id:'operation-auto:166c2f90:start',event_type:'startup',event_date:tailStart,runtime_hours:0,
      source_type:'shift_log_operation_auto',source_log_id:'legacy-POCHEON#20261018#DAY#GROUP_LEADER',
      source_text:'08:04 Fly Ash Aeration Blower #A 정지 -> #B 기동',created_at:'2026-10-27T18:10:53.065Z',updated_at:'2026-10-27T18:10:53.065Z'});
    canonicalSource('lower-source','BO1','Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 실시');
    if (legacy) add('legacy_logs',{id:9700,legacy_diary_id:DIARY,work_date:'2026-09-25',shift:'DS',role:'BCO1',author:'Approved source',
      status:'결재완료',entries_json:JSON.stringify([sourceEntry]),original_json:JSON.stringify({body:[sourceEntry]}),updated_at:'2026-09-25T10:00:00Z'});
    else canonicalSource();
    const {logs}=await loadCurrentReplacementRoleContext(db,{workDate:'2026-09-25',shift:'DS'},{now:NOW});
    const selected=logs.find(row=>row.role==='BCO1');
    const {sourceSnapshotSha256}=await replacementSourceHashes(selected);
    const sourceKey=JSON.stringify([SOURCE,tag,sourceEntry.id,0]);
    event({id:'replacement-auto-v3:role-priority:fixture',event_type:'cycle_source_reconcile',event_date:'2026-11-05T09:00:00.000Z',
      source_type:'shift_log_auto_v3',source_log_id:SOURCE,created_at:'2026-11-05T09:00:00.000Z',updated_at:'2026-11-05T09:00:00.000Z',
      source_text:JSON.stringify({schemaVersion:3,replacementAutoV3:true,normalizationVersion:4,currentCycle:true,confirmationOnly:true,
        replacementEventId:'replacement-owner',currentLastReplacementAt:origin,timePrecision:'minute',recordDate:'2026-09-25',
        registeredBaseline:false,cycleStartRevision:'prior-start',cycleRuntimeRevision:'prior-runtime',sourceKey,
        sourcePhysicalId:DIARY,sourceSnapshotSha256,sourceText:sourceEntry.content,
        rolePrioritySelection:{version:1,selectedRole:'BCO1',selectedWorkDate:'2026-09-25',selectedShift:'DS',
          selectedCompletionAt:origin,timePrecision:'minute',requiredRebuild:false,suppressedRoles:['BO1']}})});
    await storeReplacementLogReceipts(db,logs,NOW);
  }
  await ensureCoverageRecoverySchema(db);
  const mode=bag?'confirmed_gap':'seal_first_run';
  const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  const events=()=>sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(tag);
  const flags=()=>bag?{confirmedGapRecovery:true}:{requireFirstRunStart:true};
  const body=()=>{const a=asset();return {assetTag:tag,dataParcTag:signal,startAt:origin,...flags(),incrementalRefresh:false,requireIncrementalAppend:false,
    expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',
    expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision};};
  const proof=()=>loadCoverageRecoveryProof(db,asset(),signal,mode,{now:NOW});
  async function queue(id='coverage-request',p=null) {
    p ||= await proof();
    validateCoverageRecoveryView(body(),p);
    const statements=coverageRecoveryQueueStatements(db,p,id,NOW.toISOString());
    await db.batch([...statements.before,db.prepare('INSERT INTO queued_requests VALUES(?)').bind(id),...statements.after]);
    return {proof:p,intent:await loadCoverageRecoveryIntent(db,id)};
  }
  const probe=(id='coverage-request')=>({requestId:id,assetTag:tag,dataParcTag:signal,startAt:new Date(origin).toISOString(),
    endAt:NOW.toISOString(),observedAt:NOW.toISOString(),collectedAt:NOW.toISOString(),expectedLastReplacementAt:origin,
    expectedCycleStartState:initial.cycle_start_state,expectedCycleStartedAt:initial.cycle_started_at||'',
    expectedCycleStartRevision:initial.cycle_start_revision,expectedCycleRuntimeRevision:initial.cycle_runtime_revision,
    startState:bag?'running':'stopped',endState:'running',runningSeconds:oldSeconds+3600,runtimeHours:(oldSeconds+3600)/3600,
    ...(!bag?{firstRunStartedAt:new Date(Date.parse(origin)+60000).toISOString()}:{})});
  const applyCheck=(intent,p=probe(),payload=flags())=>validateCoverageRecoveryApply(db,intent,asset(),p,payload,{now:NOW});
  const guardStatement=checks=>db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES (?,CASE WHEN ${checks.map(check=>'('+check.sql+')').join(' AND ')} THEN 1 ELSE 0 END)`)
    .bind('apply-guard',...checks.flatMap(check=>check.values));
  async function applyGuard(checks, mutate=false) {
    return db.batch([guardStatement(checks),db.prepare('INSERT INTO applied_repairs VALUES(?)').bind('applied'),
      ...(mutate?[db.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=? WHERE tag_number=?').bind(probe().runtimeHours,tag)]:[]),
      db.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind('apply-guard')]);
  }
  return {sql,db,reads,writes,tag,signal,origin,mode,oldSeconds,asset,events,event,add,canonicalSource,body,flags,proof,queue,probe,applyCheck,applyGuard,
    guardsChecked:()=>guardsChecked};
}

for (const tag of [BAG,SEAL_A,SEAL_C]) test(`${tag} queues a fixed full repair without changing saved asset/events and validates its full result`,async t=>{
  const f=await fixture(t,{tag}),before=f.asset(),events=f.events();
  const writes=f.writes.length,p=await f.proof();
  assert.equal(f.writes.length,writes,'proof loading is read-only');
  assert.equal(p.startAt,new Date(f.origin).toISOString());
  assert.equal(p.snapshot.baseRunningSeconds,f.oldSeconds);
  const {intent}=await f.queue('coverage-request',p);
  assert.equal(intent.recovery_mode,f.mode);
  assert.equal(await validCoverageRecoveryReuse(f.db,'coverage-request',await f.proof()),true);
  assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),events);
  const checked=await f.applyCheck(intent);await f.applyGuard(checked.guards);
  assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),events);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
  assert.equal(COVERAGE_RECOVERY_PREFIX,'coverage-recovery-v1:');
});

test('a stopped current DataPARC receipt retains its cycle anchor and is eligible',async t=>{
  const f=await fixture(t,{tag:SEAL_C});
  f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0").run();
  const row=f.events().find(row=>row.id==='dataparc_runtime:prior-query'),source=JSON.parse(row.source_text);source.endState='stopped';
  f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(source),row.id);
  const p=await f.proof();assert.equal(p.base.state,'stopped');assert.equal(p.base.observedAt,END);
});

test('queue view rejects mixed modes, append flags, foreign signals and stale client revisions',async t=>{
  const f=await fixture(t),p=await f.proof();
  for(const patch of [{confirmedGapRecovery:false},{requireFirstRunStart:true},{incrementalRefresh:true},{requireIncrementalAppend:true},
    {rolePriorityRecovery:true},{limestoneTrackingOnly:true},{dataParcTag:'GSPOGE.ABB_DCS.104ETG30AN602XB04'},
    {expectedCycleRuntimeRevision:'stale'},{startAt:'2026-10-18T00:00:00+09:00'}])
    assert.throws(()=>validateCoverageRecoveryView({...f.body(),...patch},p),error=>!!error.code&&!!error.status);
});

for(const change of ['edit','delete','unapprove','suppress','late-peer','lower-edit','exclude','missing-suppression','missing-legacy'])
  test(`Bag current approved source revalidation rejects ${change}`,async t=>{
    const f=await fixture(t),before=f.asset(),events=f.events();
    const {intent}=await f.queue();
    if(change==='edit')f.sql.prepare('UPDATE shift_logs SET log_json=? WHERE id=?').run(JSON.stringify({entries:[{...sourceEntry,time:'14:41'}]}),SOURCE);
    if(change==='delete')f.sql.prepare('DELETE FROM shift_logs WHERE id=?').run(SOURCE);
    if(change==='unapprove')f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE id=?").run(SOURCE);
    if(change==='suppress')f.add('legacy_log_suppressions',{legacy_diary_id:DIARY,work_date:'2026-09-25',shift:'DS',role:'BCO1'});
    if(change==='late-peer')f.canonicalSource('late-approved-peer','BCO2','204HHL60AP611 V-Belt 교체 완료');
    if(change==='lower-edit')f.sql.prepare("UPDATE shift_logs SET log_json=? WHERE id='lower-source'").run(JSON.stringify({entries:[{...sourceEntry,time:'14:41'}]}));
    if(change==='exclude')f.add('blower_history_candidates',{id:'excluded',tag_number:BAG,status:'excluded',detected_type:'replacement',source_log_id:SOURCE});
    if(change==='missing-suppression')f.sql.exec('DROP TABLE legacy_log_suppressions');
    if(change==='missing-legacy')f.sql.exec('DROP TABLE legacy_logs');
    const expected=change.startsWith('missing-')?'BLOWER_COVERAGE_RECOVERY_SOURCE_COVERAGE':change==='exclude'
      ?'BLOWER_COVERAGE_RECOVERY_SOURCE_EXCLUDED':'BLOWER_COVERAGE_RECOVERY_SOURCE_CHANGED';
    await assert.rejects(f.applyCheck(intent),errorCode(expected));
    assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),events);
  });

test('a canonical mirror inserted after a legacy proof invalidates source ownership',async t=>{
  const f=await fixture(t,{legacy:true}),{intent}=await f.queue();
  f.canonicalSource();
  await assert.rejects(f.applyCheck(intent),errorCode('BLOWER_COVERAGE_RECOVERY_SOURCE_CHANGED'));
});

test('context overflow is rejected without truncating approved source certification',async t=>{
  const f=await fixture(t);
  for(let i=0;i<63;i++)f.canonicalSource('peer-'+i,'BO2','204HHL60AP611 V-Belt 교체 완료');
  await assert.rejects(f.proof(),errorCode('BLOWER_ROLE_PRIORITY_CONTEXT_LIMIT'));
});

test('same-anchor newer manual ownership, changed totals, edits and manual startup cannot borrow the old measurement',async t=>{
  for(const change of ['new-owner','total','receipt-edit','manual-start']){
    const f=await fixture(t);
    if(change==='new-owner')f.event({id:'newer-manual',event_type:'runtime_correction',event_date:END,runtime_hours:f.oldSeconds/3600,
      source_type:'manual',source_log_id:'',source_text:'',action_type:'운전중',created_at:NOW.toISOString(),updated_at:NOW.toISOString()});
    if(change==='total')f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=cycle_runtime_hours+1,runtime_hours=runtime_hours+1').run();
    if(change==='receipt-edit')f.sql.prepare("UPDATE blower_history_events SET updated_at=? WHERE id='dataparc_runtime:prior-query'").run(NOW.toISOString());
    if(change==='manual-start')f.sql.prepare("UPDATE blower_history_events SET source_type='manual' WHERE event_type='startup'").run();
    await assert.rejects(f.proof(),errorCode('BLOWER_COVERAGE_RECOVERY_PROOF_REQUIRED'));
  }
});

test('Seal repair stays limited to the exact registered May11 legacy cycles and known binary signals',async t=>{
  for(const change of ['signal','origin','startup','other-tag','later-replacement']){
    const f=await fixture(t,{tag:SEAL_A});
    if(change==='origin')f.sql.prepare("UPDATE blower_history_assets SET last_replacement_at='2026-05-12T00:00:00+09:00'").run();
    if(change==='startup')f.sql.prepare("UPDATE blower_history_assets SET cycle_start_state='started',cycle_started_at='2026-05-18T09:00:00Z'").run();
    if(change==='later-replacement')f.event({id:'new-belt',event_date:'2026-06-01T00:00:00+09:00'});
    const asset=change==='other-tag'?{...f.asset(),tag_number:'204HHL10AN621'}:f.asset();
    await assert.rejects(loadCoverageRecoveryProof(f.db,asset,change==='signal'?'GSPOGE.ABB_DCS.204HHL10AN611XJ04':f.signal,'seal_first_run',{now:NOW}),
      errorCode('BLOWER_COVERAGE_RECOVERY_PROOF_REQUIRED'));
  }
});

test('a complete-looking full result cannot undercount the old tail or add overlapping whole totals',async t=>{
  const f=await fixture(t),{intent,proof}=await f.queue();
  const prefix=(Date.parse(proof.base.startAt)-Date.parse(proof.startAt))/1000;
  const suffix=(NOW.getTime()-Date.parse(proof.base.observedAt))/1000;
  for(const seconds of [f.oldSeconds-1,f.oldSeconds+prefix+suffix+1]){
    const p={...f.probe(),runningSeconds:seconds,runtimeHours:seconds/3600};
    await assert.rejects(f.applyCheck(intent,p),errorCode('BLOWER_COVERAGE_RECOVERY_TOTAL_CONFLICT'));
  }
  await assert.rejects(f.applyCheck(intent,{...f.probe(),endAt:'2026-11-06T09:00:00.000Z',observedAt:'2026-11-06T09:00:00.000Z'}),
    errorCode('BLOWER_COVERAGE_RECOVERY_TOTAL_CONFLICT'));
  await assert.rejects(f.applyCheck(intent,{...f.probe(),endAt:END,observedAt:END,endState:'stopped'}),
    errorCode('BLOWER_COVERAGE_RECOVERY_TOTAL_CONFLICT'));
});

test('Seal full repair requires a normalized first RUN consistent with the old positive tail',async t=>{
  const f=await fixture(t,{tag:SEAL_C}),{intent}=await f.queue();
  for(const patch of [{firstRunStartedAt:undefined},{firstRunStartedAt:'not-a-time'},
    {firstRunStartedAt:new Date(f.origin).toISOString()},{startState:'running'},
    {firstRunStartedAt:'2026-05-11T10:00:00.000Z'},
    {firstRunStartedAt:new Date(NOW.getTime()-f.oldSeconds*1000).toISOString(),runningSeconds:f.oldSeconds,runtimeHours:f.oldSeconds/3600}])
    await assert.rejects(f.applyCheck(intent,{...f.probe(),...patch}),errorCode('BLOWER_COVERAGE_RECOVERY_FIRST_RUN_REQUIRED'));
});

test('request identity, full start, unprefixed revision and mode flags must match the persisted intent',async t=>{
  const f=await fixture(t),{intent}=await f.queue();
  for(const patch of [{requestId:'other'},{startAt:'2026-09-26T05:40:00Z'},
    {expectedCycleRuntimeRevision:COVERAGE_RECOVERY_PREFIX+'prior-runtime'},
    {incremental:{version:1}},{expectedCycleStartRevision:'foreign-start'}])
    await assert.rejects(f.applyCheck(intent,{...f.probe(),...patch}),errorCode('BLOWER_COVERAGE_RECOVERY_CONFLICT'));
  await assert.rejects(f.applyCheck(intent,f.probe(),{}),errorCode('BLOWER_COVERAGE_RECOVERY_MODE_INVALID'));
  await assert.rejects(f.applyCheck(intent,f.probe(),{confirmedGapRecovery:true,requireFirstRunStart:true}),errorCode('BLOWER_COVERAGE_RECOVERY_MODE_INVALID'));
});

test('intent tampering invalidates reuse and apply without overwriting the saved asset',async t=>{
  const f=await fixture(t),before=f.asset(),{proof}=await f.queue();
  f.sql.prepare("UPDATE blower_coverage_recovery_intents_v1 SET snapshot_sha256='damaged'").run();
  assert.equal(await validCoverageRecoveryReuse(f.db,'coverage-request',proof),false);
  await assert.rejects(f.applyCheck(await loadCoverageRecoveryIntent(f.db,'coverage-request')),errorCode('BLOWER_COVERAGE_RECOVERY_CONFLICT'));
  assert.deepEqual(f.asset(),before);
});

test('source and asset races fail the queue guard and roll back request/intent creation',async t=>{
  for(const change of ['asset','source']){
    const f=await fixture(t),p=await f.proof();
    if(change==='asset')f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='new-owner'").run();
    else f.sql.prepare("UPDATE shift_logs SET log_json='{}' WHERE id=?").run(SOURCE);
    const statements=coverageRecoveryQueueStatements(f.db,p,'racing-request',NOW.toISOString());
    await assert.rejects(f.db.batch([...statements.before,f.db.prepare('INSERT INTO queued_requests VALUES(?)').bind('racing-request'),...statements.after]),/CHECK constraint failed/);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM queued_requests').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_coverage_recovery_intents_v1').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
  }
});

test('all returned apply guards bind source, asset, complete event history and immutable repair intent at commit',async t=>{
  for(const change of ['source','asset','event','intent']){
    const f=await fixture(t),{intent}=await f.queue(),checked=await f.applyCheck(intent);
    if(change==='source')f.canonicalSource('late-peer','BCO2','204HHL60AP611 V-Belt 교체 완료');
    if(change==='asset')f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='new-owner'").run();
    if(change==='event')f.event({id:'late-event',event_type:'operation_stop',event_date:NOW.toISOString(),source_type:'manual'});
    if(change==='intent')f.sql.prepare("UPDATE blower_coverage_recovery_intents_v1 SET created_at='changed'").run();
    const before=f.asset();
    await assert.rejects(f.applyGuard(checked.guards,true),/CHECK constraint failed/);
    assert.deepEqual(f.asset(),before);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM applied_repairs').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
  }
});

test('a mid-transaction insert failure rolls back the guard and all attempted repair writes',async t=>{
  const f=await fixture(t),before=f.asset(),{intent}=await f.queue(),checked=await f.applyCheck(intent);
  f.sql.prepare('INSERT INTO applied_repairs VALUES(?)').run('applied');
  await assert.rejects(f.applyGuard(checked.guards,true),/UNIQUE constraint failed/);
  assert.deepEqual(f.asset(),before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
});

for(const legacy of [false,true])test(`canonical=${!legacy} full queue/apply guards stay inside D1 depth100 and bind100`,async t=>{
  const f=await fixture(t,{legacy,depthCheck:true}),{intent}=await f.queue();
  const checked=await f.applyCheck(intent);await f.applyGuard(checked.guards);
  assert.ok(f.guardsChecked()>=2);
});

function dashboardAssessment(data, asset) {
  const context=vm.createContext({console,URL,URLSearchParams,Date,navigator:{},
    fetch(){throw new Error('Projection must not start a query');},
    localStorage:{getItem(){return JSON.stringify({sessionToken:BROWSER_TOKEN});}},
    document:{readyState:'loading',addEventListener(){}},
    window:{BlowerUnifiedRefresh:core,BlowerRuntimeAssessment:assessment,
      matchMedia(){return {matches:false};},addEventListener(){}}});
  const marker='  if (document.readyState === "loading") {';
  assert.equal(uiSource.split(marker).length,2);
  vm.runInContext(uiSource.replace(marker,'globalThis.ui={state,allOverviewRuntimeAssessment};\n'+marker),context);
  context.ui.state.data=data;
  return context.ui.allOverviewRuntimeAssessment(asset);
}

async function integration(t,tag) {
  // Source fixtures use the exact current Tag/origin/automatic-start shapes.
  // New full RUN samples below are synthetic protocol tests, not plant data.
  const seed=await fixture(t,{tag});
  const RealDate=Date;
  let clock=NOW.getTime();
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
  t.after(()=>{globalThis.Date=RealDate;});
  const f=await apiFixture(tag,true);
  t.after(()=>f.database.close());
  const {database:db,sqlite:sql}=f;
  const initial=seed.asset(),events=seed.events();
  const keys=Object.keys(initial).filter(key=>key!=='tag_number');
  sql.prepare(`UPDATE blower_history_assets SET ${keys.map(key=>key+'=?').join(',')} WHERE tag_number=?`).run(...keys.map(key=>initial[key]),tag);
  sql.prepare('DELETE FROM blower_history_events WHERE tag_number=?').run(tag);
  const add=(table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  for(const row of events)add('blower_history_events',row);
  for(const table of ['shift_logs','legacy_logs','legacy_log_suppressions','blower_log_receipts_v1']){
    if(!sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
      sql.exec(seed.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql);
    for(const index of seed.sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table))
      if(!sql.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(index.name))sql.exec(index.sql);
    for(const row of seed.sql.prepare('SELECT * FROM '+table).all())add(table,row);
  }
  const oldSource=JSON.parse(events.find(row=>row.id==='dataparc_runtime:prior-query').source_text);
  const oldRaw=JSON.stringify({...oldSource,ok:true,readOnly:true,chunkDays:31});
  add('ois_data_requests',{id:'prior-query',request_type:'blower_runtime_probe',target_date:`v1|${tag}|${oldSource.startAt}|${oldSource.endAt}`,
    status:'complete',requested_by_id:BROWSER_EMPLOYEE_NO,requested_by_name:'Prior owner',requested_at:END,started_at:END,completed_at:END,
    agent_id:'prior-agent',result_json:oldRaw,error_message:'',expires_at:'2026-11-07T09:36:00.000Z',updated_at:END});
  const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  const savedEvents=()=>sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(tag);
  const rawRequest=id=>sql.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(id).result_json;
  const flags=seed.flags;
  const payload=(append=false)=>{const a=asset();return {action:'create_blower_runtime_probe',assetTag:tag,dataParcTag:seed.signal,
    confirmRunSignal:true,unifiedRefresh:true,incrementalRefresh:append,requireIncrementalAppend:append,
    ...(!append?{...flags(),startAt:a.last_replacement_at}:{}),
    expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,
    expectedCycleStartedAt:a.cycle_started_at||'',expectedCycleStartRevision:a.cycle_start_revision,
    expectedCycleRuntimeRevision:a.cycle_runtime_revision};};
  const project=async()=>{const response=await history.handleGet({env:{DB:db},request:new Request('https://example.test/api/blower-history?action=data')},
    {employeeNo:BROWSER_EMPLOYEE_NO,name:'Coverage fixture',isSuperAdmin:false});
    assert.equal(response.status,200);const data=await response.json();return {data,asset:data.assets.find(a=>a.tagNumber===tag)};};
  async function create(append=false){
    const response=await browserCreate(db,{action:'create_blower_runtime_probe_batch',requests:[payload(append)]});
    assert.equal(response.status,201,JSON.stringify(response.body));
    assert.equal(response.body.atomic,true);assert.equal(response.body.results.length,1);
    return response.body.results[0].item;
  }
  function fullResult(item,append=false) {
    const probe=item.probe,start=RealDate.parse(probe.startAt),end=RealDate.parse(probe.endAt);
    const kst=value=>new RealDate(value+9*3600000).toISOString().slice(0,19)+'+09:00';
    const chunks=[];let cursor=start;
    while(cursor<end){const next=Math.min(end,cursor+31*86400000);
      chunks.push({index:chunks.length+1,startAt:kst(cursor),endAt:kst(next)});cursor=next;}
    const seconds=append?600:seed.oldSeconds+3600;
    const first=tag===BAG?null:new RealDate(RealDate.parse(seed.origin)+60000).toISOString();
    const available=end-(first?RealDate.parse(first):start);let used=0;
    for(const [index,chunk] of chunks.entries()){
      const from=Math.max(RealDate.parse(chunk.startAt),first?RealDate.parse(first):start),to=RealDate.parse(chunk.endAt);
      const part=index===chunks.length-1?seconds-used:Math.floor(seconds*Math.max(0,to-from)/available);used+=part;
      Object.assign(chunk,{startState:index===0&&!append&&tag!==BAG?'stopped':'running',endState:'running',runningSeconds:part,totalRunningHours:part/3600});
    }
    return {...probe,requestId:item.id,ok:true,readOnly:true,observedAt:probe.endAt,collectedAt:new Date().toISOString(),
      startState:chunks[0].startState,endState:'running',completedChunkCount:chunks.length,chunks,
      runningSeconds:seconds,totalRunningHours:seconds/3600,...(!append&&first?{firstRunStartedAt:first}:{})};
  }
  async function complete(item,append=false,patch={}){
    const claimed=await agentClaim(db);assert.equal(claimed.status,200,JSON.stringify(claimed.body));
    assert.equal(claimed.body.items.excel.id,item.id);
    const raw={...fullResult(claimed.body.items.excel,append),...patch};
    const completed=await agentComplete(db,item.id,raw);assert.equal(completed.status,200,JSON.stringify(completed.body));
    return JSON.parse(rawRequest(item.id));
  }
  const apply=(id,append=false,extra={})=>callApi(historyPost,db,new Request('https://example.test/api/blower-history',{
    method:'POST',headers:{Authorization:'Bearer '+BROWSER_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({action:'dataparc_runtime_sync',requestId:id,...(!append?flags():{}),...extra})}));
  return {db,sql,tag,seed,initial,originalEvents:events,oldRaw,asset,savedEvents,rawRequest,flags,payload,project,create,complete,apply,
    advance(){clock+=3600000;}};
}

for(const tag of [BAG,SEAL_A,SEAL_C])test(`${tag} actual API batch/Agent/apply clears the gap, keeps raw evidence, then appends and replays`,async t=>{
  const f=await integration(t,tag);
  const before=await f.project(),plan=core.plan([before.asset],new Date());
  assert.equal(plan.tasks.length,1,JSON.stringify(plan));assert.equal(plan.tasks[0].kind,'dataparc_repair');
  assert.equal(plan.tasks[0].recoveryMode,tag===BAG?'confirmed_gap':'seal_first_run');
  assert.equal(dashboardAssessment(before.data,before.asset).requiresReview,true);
  const item=await f.create();
  assert.equal(item.probe.expectedCycleRuntimeRevision,COVERAGE_RECOVERY_PREFIX+f.initial.cycle_runtime_revision);
  assert.equal(RealDateParse(item.probe.startAt),RealDateParse(f.initial.last_replacement_at));
  const intent=await loadCoverageRecoveryIntent(f.db,item.id);assert.equal(intent.recovery_mode,tag===BAG?'confirmed_gap':'seal_first_run');
  assert.deepEqual(f.asset(),f.initial);assert.deepEqual(f.savedEvents(),f.originalEvents);
  const raw=await f.complete(item),rawBefore=f.rawRequest(item.id);
  if(tag!==BAG)assert.equal(raw.firstRunStartedAt,new Date(Date.parse(f.initial.last_replacement_at)+60000).toISOString());
  const wrongMode=await f.apply(item.id,true);assert.equal(wrongMode.status,409);
  assert.equal(wrongMode.body.code,'BLOWER_COVERAGE_RECOVERY_INTENT_CONFLICT');
  assert.deepEqual(f.asset(),f.initial);
  const applied=await f.apply(item.id);assert.equal(applied.status,200,JSON.stringify(applied.body));
  assert.equal(f.asset().cycle_runtime_hours,raw.runningSeconds/3600);
  assert.equal(f.asset().last_replacement_at,f.initial.last_replacement_at);
  assert.equal(f.asset().cycle_start_revision,f.initial.cycle_start_revision);
  assert.equal(f.asset().cycle_started_at,f.initial.cycle_started_at);
  for(const old of f.originalEvents)assert.deepEqual(f.savedEvents().find(row=>row.id===old.id),old);
  assert.equal(f.rawRequest('prior-query'),f.oldRaw);assert.equal(f.rawRequest(item.id),rawBefore);
  const after=await f.project(),resolved=dashboardAssessment(after.data,after.asset);
  assert.equal(after.asset.dataParcRuntimeBasis.coverageComplete,true);
  assert.equal(after.asset.runtimeCoverageEvidence.coverageComplete,true);
  assert.equal(after.asset.runtimeCoverageEvidence.missingLeadingSeconds,0);
  assert.equal(resolved.requiresReview,false,JSON.stringify(resolved));
  assert.equal(after.asset.runtimeCoverageEvidence.wholeCycleVerified,tag===BAG,
    'Seal first RUN resolves measured coverage without inventing a physical belt-completion clock');
  if(tag!==BAG){assert.equal(after.asset.runtimeCoverageEvidence.firstRunVerified,true);assert.equal(after.asset.runtimeCoverageEvidence.cycleBasisConfirmed,false);}
  assert.equal((await f.apply(item.id)).body.replayed,true);
  f.advance();
  const next=core.plan([(await f.project()).asset],new Date());assert.equal(next.tasks[0].kind,'dataparc');
  const append=await f.create(true);
  assert.match(append.probe.expectedCycleRuntimeRevision,/^append-v1:/);
  assert.equal(await loadCoverageRecoveryIntent(f.db,append.id),null);
  assert.equal(RealDateParse(append.probe.startAt),RealDateParse(raw.observedAt));
  const delta=await f.complete(append,true),appended=await f.apply(append.id,true);
  assert.equal(appended.status,200,JSON.stringify(appended.body));
  assert.equal(f.asset().cycle_runtime_hours,(raw.runningSeconds+delta.runningSeconds)/3600);
  const final=await f.project();assert.equal(final.asset.dataParcRuntimeBasis.coverageComplete,true);
  assert.equal(dashboardAssessment(final.data,final.asset).requiresReview,false);
  if(tag!==BAG)assert.equal(final.asset.dataParcRuntimeBasis.firstRunStartedAt,raw.firstRunStartedAt);
  const finalAsset=f.asset();
  assert.equal((await f.apply(item.id)).body.replayed,true);assert.deepEqual(f.asset(),finalAsset);
  assert.equal(f.rawRequest(item.id),rawBefore);assert.equal(f.rawRequest('prior-query'),f.oldRaw);
});

const RealDateParse=value=>Date.parse(value);

for(const change of ['manual-owner','approved-source'])test(`actual queued repair preserves stored values when ${change} changes before apply`,async t=>{
  const f=await integration(t,BAG),item=await f.create();await f.complete(item);
  if(change==='manual-owner')f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='manual-change',cycle_runtime_hours=cycle_runtime_hours+1,runtime_hours=runtime_hours+1 WHERE tag_number=?").run(BAG);
  else f.sql.prepare('UPDATE shift_logs SET log_json=? WHERE id=?').run(JSON.stringify({entries:[{...sourceEntry,time:'14:41'}]}),SOURCE);
  const before=f.asset(),events=f.savedEvents(),raw=f.rawRequest(item.id);
  const applied=await f.apply(item.id);assert.equal(applied.status,409,JSON.stringify(applied.body));
  assert.deepEqual(f.asset(),before);assert.deepEqual(f.savedEvents(),events);assert.equal(f.rawRequest(item.id),raw);
});

test('actual Seal API rejects an unvalidated first-RUN result and retains the original partial measurement',async t=>{
  const f=await integration(t,SEAL_A),item=await f.create();
  const raw=await f.complete(item,false,{firstRunStartedAt:'2026-05-10T15:00:00.000Z'});
  assert.equal(raw.firstRunStartedAt,undefined,'Agent completion normalizer removes invalid first-RUN evidence');
  const before=f.asset(),events=f.savedEvents(),applied=await f.apply(item.id);
  assert.equal(applied.status,409,JSON.stringify(applied.body));assert.equal(applied.body.code,'DATAPARC_FIRST_RUN_UNVERIFIED');
  assert.deepEqual(f.asset(),before);assert.deepEqual(f.savedEvents(),events);
});

test('actual API transaction rolls back when the approved source changes after proof validation',async t=>{
  const f=await integration(t,BAG),item=await f.create();await f.complete(item);
  const before=f.asset(),events=f.savedEvents(),raw=f.rawRequest(item.id);
  const batch=f.db.batch.bind(f.db);let injected=false;
  f.db.batch=async statements=>{
    if(!injected&&statements.some(statement=>statement.sql.includes('INSERT INTO blower_history_atomic_guard')&&statement.sql.includes('CASE WHEN'))){
      injected=true;
      f.sql.prepare('UPDATE shift_logs SET log_json=? WHERE id=?').run(JSON.stringify({entries:[{...sourceEntry,time:'14:41'}]}),SOURCE);
    }
    return batch(statements);
  };
  const result=await f.apply(item.id);assert.equal(injected,true);assert.equal(result.status,409,JSON.stringify(result.body));
  assert.deepEqual(f.asset(),before);assert.deepEqual(f.savedEvents(),events);assert.equal(f.rawRequest(item.id),raw);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
});
