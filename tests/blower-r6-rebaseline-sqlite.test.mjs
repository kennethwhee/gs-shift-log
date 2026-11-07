import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {__oisDataRequestsTest as ois} from '../functions/api/ois-data-requests.js';
import {ensureAppendSchema,verifiedAppendBase} from '../functions/_shared/blower-incremental.js';
import {ensureBoundaryRecoverySchema,loadBoundaryRecoveryProof,boundaryRecoveryQueueStatements,BOUNDARY_RECOVERY_PREFIX} from '../functions/_shared/blower-boundary-recovery-v1.js';
import {r6Status,r6Begin,r6Advance,r6Apply,r6Cancel} from '../functions/_shared/blower-r6-rebaseline.js';

const TAG='204SDF01AN002',SIGNAL=`GSPOGE.ABB_DCS.${TAG}XB04`,START='2026-07-24T19:00:00+09:00',
  REPLACEMENT='2026-07-24T00:00:00+09:00',CUTOFF='2026-11-07T00:01:15+09:00',
  DELTA_END='2026-11-07T09:18:00+09:00',END='2026-11-07T09:18:35+09:00',
  BASE=4149227,DELTA=32998,DIFF=109,TOTAL=BASE+DELTA+DIFF;
const OWNER={employeeNo:'r6-test-owner',name:'R6 owner',isSuperAdmin:true};
const time=v=>new Date(v).getTime(), stamp=x=>new Date(x).toISOString();
function d1(){
  const sqlite=new DatabaseSync(':memory:');
  const db={prepare(sql){return {sql,values:[],bind(...v){this.values=v;return this},
    async first(){return sqlite.prepare(this.sql).get(...this.values)||null},
    async all(){return {results:sqlite.prepare(this.sql).all(...this.values)}},
    async run(){const res=sqlite.prepare(this.sql).run(...this.values);return {meta:{changes:res.changes}}}}},
    async batch(statements){const result=[];sqlite.exec('BEGIN IMMEDIATE');
      try{for(const stmt of statements)result.push(await stmt.run());sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}return result;}}
  return {db,sqlite,close:()=>sqlite.close()};
}
function raw({id,start,end,seconds,revision,startState='running',endState='stopped',collectedAt}){
  const chunks=ois.buildBlowerRuntimeProbeChunks(start,end),periods=chunks.map(c=>Math.floor((time(c.endAt)-time(c.startAt))/1000));
  let left=seconds;
  const ch=chunks.map((c,i)=>{
    const max=periods[i],budget=i===chunks.length-1?left:Math.min(max,Math.round(seconds*max/periods.reduce((a,b)=>a+b,0)));
    left-=budget;
    return {...c,startState:i===0?startState:'running',endState:i===chunks.length-1?endState:'running',
      runningSeconds:budget,totalRunningHours:budget/3600};
  });
  if(left)ch.at(-1).runningSeconds+=left,ch.at(-1).totalRunningHours=ch.at(-1).runningSeconds/3600;
  assert.equal(ch.reduce((v,c)=>v+c.runningSeconds,0),seconds);
  return {schemaVersion:1,requestType:'blower_runtime_probe',requestId:id,ok:true,readOnly:true,
    assetTag:TAG,dataParcTag:SIGNAL,startAt:start,endAt:end,observedAt:end,
    collectedAt,expectedLastReplacementAt:REPLACEMENT,
    expectedCycleStartState:'started',expectedCycleStartedAt:START,expectedCycleStartRevision:'start-r1',
    expectedCycleRuntimeRevision:revision,chunkDays:31,chunkCount:ch.length,completedChunkCount:ch.length,
    startState,endState,runningSeconds:seconds,totalRunningHours:seconds/3600,chunks:ch};
}
const add=(sql,t,row)=>sql.prepare(`INSERT INTO ${t} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
async function init(t){
  const {db,sqlite,close}=d1();t.after(close);
  await history.ensureSchema(db);await ois.ensureBlowerRuntimeProbeSchema(db);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS ois_data_requests (id TEXT PRIMARY KEY NOT NULL,request_type TEXT NOT NULL,
    target_date TEXT NOT NULL,status TEXT NOT NULL,requested_by_id TEXT NOT NULL,requested_by_name TEXT NOT NULL,
    requested_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,agent_id TEXT,result_json TEXT,error_message TEXT,
    expires_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  await ensureAppendSchema(db);await ensureBoundaryRecoverySchema(db);
  sqlite.prepare('DELETE FROM blower_history_events WHERE tag_number=?').run(TAG);
  sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='started',cycle_started_at=?,
     cycle_start_revision='start-r1',cycle_runtime_revision='runtime-r1',cycle_runtime_hours=?,runtime_hours=?,
     cycle_runtime_anchor_at=?,cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0,updated_at=? WHERE tag_number=?`)
     .run(REPLACEMENT,START,BASE/3600,BASE/3600,CUTOFF,CUTOFF,TAG);
  const asset=()=>sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG);
  const events=()=>sqlite.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
  const ev={id:'dataparc_runtime:prior-owner',tag_number:TAG,event_type:'runtime_correction',event_date:CUTOFF,
    runtime_hours:BASE/3600,issue_type:'DataPARC',action_type:'RUN',note:'prior',source_type:'dataparc_runtime',
    source_log_id:'prior-owner',source_text:JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',
      requestId:'prior-owner',assetTag:TAG,dataParcTag:SIGNAL,startAt:START,endAt:CUTOFF,observedAt:CUTOFF,
      expectedLastReplacementAt:REPLACEMENT,expectedCycleStartState:'started',expectedCycleStartedAt:START,
      expectedCycleStartRevision:'start-r1',expectedCycleRuntimeRevision:'older-runtime',startState:'running',
      endState:'stopped',runningSeconds:BASE,totalRunningHours:BASE/3600,chunkCount:4,collectedAt:CUTOFF}),
    created_by_id:OWNER.employeeNo,created_by_name:OWNER.name,created_at:CUTOFF,updated_at:CUTOFF};
  add(sqlite,'blower_history_events',ev);
  const failed=raw({id:'failed-append',start:CUTOFF,end:DELTA_END,seconds:DELTA,
    revision:'append-v1:runtime-r1',startState:'running',endState:'stopped',collectedAt:'2026-11-07T00:19:00.000Z'});
  add(sqlite,'ois_data_requests',{id:'failed-append',request_type:'blower_runtime_probe',status:'complete',
    target_date:`v1|${TAG}|${CUTOFF}|${DELTA_END}`,requested_by_id:OWNER.employeeNo,requested_by_name:OWNER.name,
    requested_at:'2026-11-07T00:18:10.000Z',started_at:'2026-11-07T00:18:12.000Z',completed_at:'2026-11-07T00:19:01.000Z',agent_id:'reviewed-agent',
    result_json:JSON.stringify(failed),error_message:'',expires_at:'2026-11-07T02:30:00Z',updated_at:'2026-11-07T00:19:01.000Z'});
  add(sqlite,'blower_runtime_probe_intents_v5',{request_id:'failed-append',reuse_key:'append-v1:'+'a'.repeat(64),schema_version:1,
    asset_tag:TAG,dataparc_tag:SIGNAL,window_start:CUTOFF,window_end:DELTA_END,chunk_days:31,chunk_count:1,
    expected_last_replacement_at:REPLACEMENT,expected_cycle_start_state:'started',expected_cycle_started_at:START,
    expected_cycle_start_revision:'start-r1',expected_cycle_runtime_revision:'append-v1:runtime-r1',
    created_at:'2026-11-07T00:18:10.000Z',updated_at:'2026-11-07T00:18:10.000Z'});
  add(sqlite,'blower_runtime_append_v1',{request_id:'failed-append',base_event_id:ev.id,base_revision:'runtime-r1',
    base_observed_at:CUTOFF,coverage_start_at:START,base_running_seconds:BASE,created_at:'2026-11-07T00:18:10.000Z'});
  const proof=await loadBoundaryRecoveryProof(db,asset(),SIGNAL,'failed-append',OWNER,{now:new Date('2026-11-07T00:21:00Z'),
    loadRuntimeIntent:async(database,id)=>database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(id).first(),
    normalizeProbe:(...args)=>history.normalizeDataParcRuntimeProbeResult(...args),
    matchesRuntimeIntent:(intent,result)=>intent.request_id===result.requestId&&intent.asset_tag===result.assetTag&&
      intent.dataparc_tag===result.dataParcTag&&intent.window_start===result.rawStartAt&&intent.window_end===result.rawEndAt&&
      intent.expected_last_replacement_at===result.expectedLastReplacementAt&&
      intent.expected_cycle_start_state===result.expectedCycleStartState&&intent.expected_cycle_started_at===result.expectedCycleStartedAt&&
      intent.expected_cycle_start_revision===result.expectedCycleStartRevision&&intent.expected_cycle_runtime_revision===result.expectedCycleRuntimeRevision});
  const requestId='r5-full',createdAt='2026-11-07T00:21:00.000Z';
  const statements=boundaryRecoveryQueueStatements(db,proof,requestId,createdAt);
  const full=raw({id:requestId,start:START,end:END,seconds:TOTAL,revision:BOUNDARY_RECOVERY_PREFIX+'runtime-r1',
    startState:'running',endState:'stopped',collectedAt:'2026-11-07T00:23:00.000Z'});
  await db.batch([...statements.before,
    db.prepare(`INSERT INTO ois_data_requests(id,request_type,target_date,status,requested_by_id,requested_by_name,
      requested_at,started_at,completed_at,agent_id,result_json,error_message,expires_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(requestId,'blower_runtime_probe',`v1|${TAG}|${START}|${END}`,'complete',
        OWNER.employeeNo,OWNER.name,createdAt,createdAt,'2026-11-07T00:23:01.000Z','reviewed-agent',JSON.stringify(full),'',
        '2026-11-07T02:30:00Z','2026-11-07T00:23:01.000Z'),
    db.prepare(`INSERT INTO blower_runtime_probe_intents_v5(request_id,reuse_key,schema_version,asset_tag,dataparc_tag,
      window_start,window_end,chunk_days,chunk_count,expected_last_replacement_at,expected_cycle_start_state,
      expected_cycle_started_at,expected_cycle_start_revision,expected_cycle_runtime_revision,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(requestId,BOUNDARY_RECOVERY_PREFIX+'b'.repeat(64),1,TAG,SIGNAL,
        START,END,31,full.chunkCount,REPLACEMENT,'started',START,'start-r1',BOUNDARY_RECOVERY_PREFIX+'runtime-r1',createdAt,createdAt),
    ...statements.after]);
  return {db,sqlite,asset,events};
}

async function completeNext(f,role,now){
  const row=f.sqlite.prepare(`SELECT r.*, q.* FROM blower_r6_rebaseline_reads_v1 r
     JOIN ois_data_requests q ON q.id=r.request_id WHERE r.role=?`).get(role);
  assert.ok(row,role);
  const intent=f.sqlite.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(row.request_id);
  const sec=role==='prefix'?BASE+DIFF:role==='suffix'?DELTA:TOTAL;
  const isPrefix=role==='prefix',isSuffix=role==='suffix';
  const result=raw({id:row.request_id,start:intent.window_start,end:intent.window_end,seconds:sec,
    revision:intent.expected_cycle_runtime_revision,startState:'running',endState:isPrefix?'running':'stopped',
    collectedAt:stamp(now+1000)});
  f.sqlite.prepare("UPDATE ois_data_requests SET status='complete',completed_at=?,result_json=?,agent_id='reviewed-agent' WHERE id=?")
    .run(stamp(now+2000),JSON.stringify(result),row.request_id);
}

test('R6 four independent jobs -> verified proposal -> atomic approved correction -> append base -> replay',async t=>{
  const NativeDate=Date;let clock=time('2026-11-07T01:00:00Z');
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
  try{
    const f=await init(t),before=f.asset(),eventsBefore=f.events();
    const begun=await r6Begin(f.db,OWNER);
    assert.equal(begun.case.originalSeconds,BASE);assert.equal(begun.case.status,'collecting');
    assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),eventsBefore);
    const id=begun.case.id;
    for(const role of ['fullA','fullB','prefix','suffix']){
      let next=await r6Advance(f.db,OWNER,id);
      assert.equal(next.stage.find(x=>x.role===role).status,'pending');
      const queued=f.sqlite.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(next.stage.find(x=>x.role===role).requestId);
      assert.equal(queued.request_type,'blower_runtime_probe');
      assert.match(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(queued.id).reuse_key,/^r6-rebaseline-v1:/);
      const afterQueue=await r6Advance(f.db,OWNER,id);
      assert.equal(afterQueue.stage.find(x=>x.role===role).requestId,queued.id,'pending request must be reused');
      clock+=2000;
      await completeNext(f,role,clock);
      clock+=7000;
    }
    const ready=await r6Advance(f.db,OWNER,id);
    assert.equal(ready.case.status,'ready');assert.equal(ready.proposal.status,'requires_authorized_review');
    assert.equal(ready.proposal.totalDifferenceSeconds,DIFF);
    assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),eventsBefore);
    await assert.rejects(r6Apply(f.db,{...OWNER,isSuperAdmin:false},id,TAG,'관리자가 승인하는 109초 재검증'),e=>e.code==='R6_APPROVAL_FORBIDDEN');
    const applied=await r6Apply(f.db,OWNER,id,TAG,'분할 독립 RUN 실측 4회로 109초 보정 승인');
    assert.equal(applied.case.status,'applied');assert.ok(applied.case.eventId);
    assert.equal(f.asset().cycle_runtime_hours,TOTAL/3600);
    assert.equal(f.events().length,eventsBefore.length+1);
    for(const k of ['last_replacement_at','cycle_started_at','cycle_start_state','cycle_start_revision'])assert.equal(f.asset()[k],before[k]);
    const append=verifiedAppendBase(f.asset(),f.events(),SIGNAL);
    assert.ok(append,'R6 receipt must remain compatible with the next ordinary append');
    assert.equal(append.runningSeconds,TOTAL);assert.equal(append.coverageComplete,true);
    const saved=f.asset(),events=f.events();
    const replay=await r6Apply(f.db,OWNER,id,TAG,'분할 독립 RUN 실측 4회로 109초 보정 승인');
    assert.equal(replay.case.status,'applied');assert.deepEqual(f.asset(),saved);assert.deepEqual(f.events(),events);
  }finally{globalThis.Date=NativeDate}
});

test('R6 storage remains untouched if an approved source event changes before approval',async t=>{
  const NativeDate=Date;let clock=time('2026-11-07T01:00:00Z');
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
  try{
    const f=await init(t),id=(await r6Begin(f.db,OWNER)).case.id;
    for(const role of ['fullA','fullB','prefix','suffix']){await r6Advance(f.db,OWNER,id);clock+=2000;await completeNext(f,role,clock);clock+=7000;}
    await r6Advance(f.db,OWNER,id);
    const before=f.asset();f.sqlite.prepare("UPDATE blower_history_events SET note='edited' WHERE id='dataparc_runtime:prior-owner'").run();
    await assert.rejects(r6Apply(f.db,OWNER,id,TAG,'승인 근거를 분리해서 기록'),e=>!!(e.code||/CHECK/.test(e.message)));
    assert.deepEqual(f.asset(),before);assert.equal(f.events().length,1);
  }finally{globalThis.Date=NativeDate}
});

test('A different superadmin can inspect the frozen original R5 evidence without changing its owner',async t=>{
  const NativeDate=Date;let clock=time('2026-11-07T01:00:00Z');
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
  try{
    const f=await init(t),before=f.asset(),admin={...OWNER,employeeNo:'independent-admin',name:'Reviewing administrator'};
    const begun=await r6Begin(f.db,admin);
    assert.equal(begun.case.status,'collecting');
    assert.deepEqual(f.asset(),before);
    const advanced=await r6Advance(f.db,admin,begun.case.id);
    assert.equal(advanced.stage.find(x=>x.role==='fullA').status,'pending');
    assert.equal(f.sqlite.prepare('SELECT requested_by_id FROM ois_data_requests WHERE id=?').get(advanced.stage[0].requestId).requested_by_id,admin.employeeNo);
    assert.deepEqual(f.asset(),before);
  }finally{globalThis.Date=NativeDate}
});


// R6 V5 eligibility — completed queue entries may retire only their reusable
// key. The authenticated R5 frozen base and full measurement must still match.
test('R6 V5 reuses validated *completed* R5 full evidence after NULL reuse key',async t=>{
  const NativeDate=Date;let clock=time('2026-11-07T01:00:00Z');
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
  try{
    const f=await init(t),before=f.asset(),events=f.events();
    f.sqlite.prepare('UPDATE blower_runtime_probe_intents_v5 SET reuse_key=NULL,updated_at=? WHERE request_id=?')
      .run('2026-11-07T00:59:00.000Z','r5-full');
    const next=await r6Begin(f.db,OWNER);
    assert.equal(next.case.status,'collecting');
    assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),events);
    const queued=await r6Advance(f.db,OWNER,next.case.id);
    assert.equal(queued.stage[0].status,'pending');
  }finally{globalThis.Date=NativeDate}
});

test('R6 V5 never promotes an altered non-NULL full queue key',async t=>{
  const NativeDate=Date;let clock=time('2026-11-07T01:00:00Z');
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
  try{
    const f=await init(t),before=f.asset();
    f.sqlite.prepare('UPDATE blower_runtime_probe_intents_v5 SET reuse_key=? WHERE request_id=?').run('unexpected-prefix:123','r5-full');
    await assert.rejects(r6Begin(f.db,OWNER),e=>e.code==='R6_FULL_SOURCE_INVALID'&&/연결키 1건/.test(e.message));
    assert.deepEqual(f.asset(),before);
  }finally{globalThis.Date=NativeDate}
});

test('R6 V5 diagnoses a retired original append reuse key but does not authorize writes',async t=>{
  const NativeDate=Date;let clock=time('2026-11-07T01:00:00Z');
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
  try{
    const f=await init(t),before=f.asset(),ev=f.events();
    f.sqlite.prepare('UPDATE blower_runtime_probe_intents_v5 SET reuse_key=NULL WHERE request_id=?').run('failed-append');
    await assert.rejects(r6Begin(f.db,OWNER),e=>e.code==='R6_APPEND_RECEIPT_RETIRED');
    assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),ev);
  }finally{globalThis.Date=NativeDate}
});

test('R6 V5 refuses altered raw full totals even when reuse key was retired',async t=>{
  const NativeDate=Date;let clock=time('2026-11-07T01:00:00Z');
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
  try{
    const f=await init(t),before=f.asset();
    f.sqlite.prepare('UPDATE blower_runtime_probe_intents_v5 SET reuse_key=NULL WHERE request_id=?').run('r5-full');
    const raw=JSON.parse(f.sqlite.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get('r5-full').result_json);
    raw.runningSeconds+=100; // breaks chunk/total integrity
    f.sqlite.prepare('UPDATE ois_data_requests SET result_json=? WHERE id=?').run(JSON.stringify(raw),'r5-full');
    await assert.rejects(r6Begin(f.db,OWNER),e=>e.code==='R6_FULL_SOURCE_INVALID'&&/결과 1건/.test(e.message));
    assert.deepEqual(f.asset(),before);
  }finally{globalThis.Date=NativeDate}
});

test('R6 V5 diagnoses current asset changes and prevents stale approval proposals',async t=>{
  const NativeDate=Date;let clock=time('2026-11-07T01:00:00Z');
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
  try{
    const f=await init(t),before=f.asset();
    f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?').run('external-revision',TAG);
    await assert.rejects(r6Begin(f.db,OWNER),e=>e.code==='R6_BASE_PROOF_CHANGED');
    assert.notDeepEqual(f.asset(),before);
  }finally{globalThis.Date=NativeDate}
});


test('R6 V5 rejects R5 full-result ownership changes without revealing identities', async t=>{
  const NativeDate=Date;let clock=time('2026-11-07T01:00:00Z');
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
  try{
    const f=await init(t),before=f.asset();
    f.sqlite.prepare('UPDATE blower_runtime_probe_intents_v5 SET reuse_key=NULL WHERE request_id=?').run('r5-full');
    f.sqlite.prepare('UPDATE ois_data_requests SET requested_by_id=? WHERE id=?').run('other-user','r5-full');
    await assert.rejects(r6Begin(f.db,OWNER),e=>e.code==='R6_FULL_SOURCE_INVALID'&&/연결키 1건/.test(e.message));
    assert.deepEqual(f.asset(),before);
  }finally{globalThis.Date=NativeDate}
});
