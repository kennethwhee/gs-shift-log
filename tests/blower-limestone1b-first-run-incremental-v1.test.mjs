import test from 'node:test';
import assert from 'node:assert/strict';
import {createLimestone1bFixture,ordinaryAppend,publicRequest,OWNER,TAG,SIGNAL,START,FIRST} from './helpers/blower-limestone1b-fixture-v1.mjs';
import {verifiedAppendBase,loadAppendBase,incrementalEvidence,LIMESTONE1B_CYCLE_PREFIX,LIMESTONE1B_SOURCE} from '../functions/_shared/blower-incremental.js';

async function recovered(t,options){const f=await createLimestone1bFixture(t,options);await f.apply(await f.ready());return f;}
function changeCertificate(f,change){const row=f.events().find(row=>row.source_type===LIMESTONE1B_SOURCE),source=JSON.parse(row.source_text);change(source);f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(source),row.id);}
function stateBoundary(f,kind,{delta=0,mixed=false}={}){
  const a=f.asset(),at=new Date(Date.parse(a.cycle_runtime_anchor_at)+60000).toISOString();
  f.addEvent({id:kind==='manual'?'manual-stop':'operation-auto:1234abcd:stop',event_type:'operation_stop',event_date:at,
    runtime_hours:a.cycle_runtime_hours+delta,source_type:kind==='manual'?'manual':'shift_log_operation_auto',source_log_id:'fixture-stop-source',
    source_text:'Stored state boundary',action_type:kind==='manual'?'정지':'교체운전 자동 정지',created_at:at,updated_at:at});
  let anchor=at;
  if(mixed){anchor=new Date(Date.parse(at)+60000).toISOString();f.addEvent({id:'operation-auto:8765abcd:stop',event_type:'operation_stop',event_date:anchor,
    runtime_hours:a.cycle_runtime_hours,source_type:'shift_log_operation_auto',source_log_id:'other-state-source',source_text:'Automatic state boundary',
    action_type:'교체운전 자동 정지',created_at:anchor,updated_at:anchor});}
  f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_anchor_at=?,cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0,cycle_runtime_revision='state-boundary-revision',cycle_runtime_hours=?,runtime_hours=? WHERE tag_number=?")
    .run(anchor,a.cycle_runtime_hours+delta,a.cycle_runtime_hours+delta,TAG);
}

for(const [fraction,excluded]of [['250',34166],['750',34167]])test('the fresh measurement retains fractional witness '+fraction+' and derives the rounded exclusion without a completion clock',async t=>{
  const f=await recovered(t,{fraction}),a=f.asset(),base=await loadAppendBase(f.db,a,SIGNAL),pure=verifiedAppendBase(a,f.events(),SIGNAL);
  assert.ok(base);assert.deepEqual(base.limestone1bFirstRun,pure.limestone1bFirstRun);
  assert.equal(a.last_replacement_at,START);assert.equal(a.cycle_start_state,'pending');assert.equal(a.cycle_started_at,null);
  assert.equal(base.startAt,FIRST);assert.equal(base.runningSeconds,100000-excluded);assert.equal(base.appendReady,true);assert.equal(base.composite,true);
  const p=base.limestone1bFirstRun;
  assert.equal(p.excludedRunningSeconds,excluded);assert.equal(p.rawFirstRunAt,'2026-09-22T09:50:26.'+fraction+'+09:00');
  assert.equal(p.measurementStartAt,FIRST);assert.equal(p.completionClockKnown,false);assert.equal(p.durationEquivalent,true);assert.equal(p.sampleGoodCertified,false);
  assert.equal(p.priorRunBelongsToPreviousBelt,true);assert.equal(p.completedDuringStoppedWindow,true);
  assert.equal(p.proofHash,a.cycle_start_revision.slice(LIMESTONE1B_CYCLE_PREFIX.length));assert.equal(p.currentRunningSeconds,100000-excluded);
  assert.equal(p.currentRuntimeRevision,a.cycle_runtime_revision);assert.equal(p.currentObservedAt,base.observedAt);
  assert.equal(p.currentAnchorAt,a.cycle_runtime_anchor_at);assert.equal(p.currentState,'running');assert.equal(p.measuredState,'running');
  assert.equal(p.preservedStateBoundary,false);assert.equal(p.comparisonToleranceSeconds,5);
});

test('UTC saved receipt boundaries create canonical KST wire chunks at the same frozen endpoint',async t=>{
  const f=await createLimestone1bFixture(t),old=f.events().find(row=>row.id==='dataparc_runtime:baseline-root'),saved=JSON.parse(old.source_text);
  for(const key of ['startAt','endAt','observedAt'])saved[key]=new Date(saved[key]).toISOString();
  f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(saved),old.id);
  const before=f.asset(),pending=await f.start(await f.status()),intent=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(pending.request.id);
  assert.equal(Date.parse(intent.window_end),Date.parse(before.cycle_runtime_anchor_at));assert.match(intent.window_end,/\+09:00$/);
  assert.equal(f.asset().cycle_runtime_anchor_at,before.cycle_runtime_anchor_at);
  f.complete(pending);await f.apply(await f.status());
  const base=await loadAppendBase(f.db,f.asset(),SIGNAL);
  assert.ok(base);assert.equal(base.observedAt,saved.observedAt);assert.equal(base.runningSeconds,65833);
  await ordinaryAppend(f);assert.equal((await loadAppendBase(f.db,f.asset(),SIGNAL)).runningSeconds,65843);
});

test('an ordinary append continues from the fresh certificate while keeping witness and fresh request bytes unchanged',async t=>{
  const f=await recovered(t),ids=[f.witnessRequestId,f.requestId],before=ids.map(id=>f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(id));
  await ordinaryAppend(f);const base=await loadAppendBase(f.db,f.asset(),SIGNAL);
  assert.ok(base);assert.equal(base.runningSeconds,65843);assert.equal(base.limestone1bFirstRun.freshRequestId,f.requestId);
  assert.equal(base.limestone1bFirstRun.currentRunningSeconds,65843);assert.equal(base.limestone1bFirstRun.currentRuntimeRevision,f.asset().cycle_runtime_revision);
  assert.deepEqual(ids.map(id=>f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(id)),before);
  const raw=JSON.parse(f.events().find(row=>row.id==='dataparc_runtime:ordinary-append').source_text);
  assert.equal(incrementalEvidence(raw).baseEventId,'dataparc_limestone1b_first_run:'+f.requestId);
});

for(const kind of ['manual','automatic'])test(kind+' equal-counter state overlays preserve the measured seam and later append',async t=>{
  const f=await recovered(t),at=f.asset().cycle_runtime_anchor_at;stateBoundary(f,kind);
  const base=await loadAppendBase(f.db,f.asset(),SIGNAL);
  assert.ok(base);assert.equal(base.preservedStateBoundary,true);assert.equal(base.observedAt,at);assert.equal(base.state,'running');
  assert.equal(base.limestone1bFirstRun.currentState,'stopped');assert.equal(base.limestone1bFirstRun.measuredState,'running');
  assert.equal(base.limestone1bFirstRun.currentAnchorAt,f.asset().cycle_runtime_anchor_at);
  await ordinaryAppend(f);assert.equal((await loadAppendBase(f.db,f.asset(),SIGNAL)).runningSeconds,65843);
});

for(const mode of ['counter','mixed'])test(mode+' state overlays cannot provide a closed append proof',async t=>{
  const f=await recovered(t);stateBoundary(f,'manual',mode==='counter'?{delta:1}:{mixed:true});
  assert.equal(verifiedAppendBase(f.asset(),f.events(),SIGNAL),null);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

for(const [label,change]of [
  ['completion clock',s=>s.completionClockKnown=true],['attested replacement window',s=>s.attestation.completedDuringStoppedWindow=false],
  ['previous belt attribution',s=>s.attestation.priorRunBelongsToPreviousBelt=false],['fresh start',s=>s.measurement.startAt=START],
  ['fresh seconds',s=>s.measurement.runningSeconds++],['expanded tolerance',s=>s.comparison.toleranceSeconds++],
  ['excluded duration',s=>s.r9.excludedDurationMilliseconds++],['proof hash',s=>s.proofHash='f'.repeat(64)],
  ['replacement date',s=>s.owner.event_date=FIRST],['role owner',s=>s.roleOwner.note='changed']
])test('changed '+label+' cannot preserve a valid closed certificate',async t=>{
  const f=await recovered(t);changeCertificate(f,change);
  assert.equal(verifiedAppendBase(f.asset(),f.events(),SIGNAL),null);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

test('a missing certificate cannot fall back to a plausible ordinary descendant',async t=>{
  const f=await recovered(t);await ordinaryAppend(f);f.sql.prepare('DELETE FROM blower_history_events WHERE source_type=?').run(LIMESTONE1B_SOURCE);
  assert.equal(verifiedAppendBase(f.asset(),f.events(),SIGNAL),null);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

for(const [label,sql]of [
  ['old event note',"UPDATE blower_history_events SET note='changed' WHERE id='dataparc_runtime:baseline-root'"],
  ['old event extras',"UPDATE blower_history_events SET source_text=json_set(source_text,'$.extra','changed') WHERE id='dataparc_runtime:baseline-root'"],
  ['old raw request',"UPDATE ois_data_requests SET error_message='changed' WHERE id='baseline-root'"],
  ['old intent',"UPDATE blower_runtime_probe_intents_v5 SET expected_cycle_runtime_revision='changed' WHERE request_id='baseline-root'"],
  ['manual replacement owner',"UPDATE blower_history_events SET note='changed' WHERE id='"+OWNER+"'"],
  ['role selection owner',"UPDATE blower_history_events SET note='changed' WHERE event_type='cycle_source_reconcile'"],
  ['approved source',"UPDATE shift_logs SET updated_at='2026-11-12T00:00:00Z' WHERE role='BCO1'"],
  ['audit snapshot',"UPDATE blower_history_asset_history SET before_json=json_set(before_json,'$.changed',true) WHERE action_type='limestone1b_first_run_recovery'"],
  ['witness request bytes',"UPDATE ois_data_requests SET result_json=result_json||' ' WHERE id='00000000-0000-4000-8000-000000000092'"],
  ['case receipt',"UPDATE blower_limestone1b_first_run_intents_v1 SET nonce='changed'"],
  ['case outcome',"UPDATE blower_limestone1b_first_run_intents_v1 SET applied_json=json_set(applied_json,'$.preview.totalRunningSeconds',1)"]
])test('strict loading rejects changes to '+label,async t=>{
  const f=await recovered(t);f.sql.exec(sql);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

test('strict loading rejects edits to the fresh measurement and its intent',async t=>{
  const f=await recovered(t),row=f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(f.requestId);
  f.sql.prepare('UPDATE ois_data_requests SET result_json=result_json||? WHERE id=?').run(' ',f.requestId);
  assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
  f.sql.prepare('UPDATE ois_data_requests SET result_json=? WHERE id=?').run(row.result_json,f.requestId);
  f.sql.prepare("UPDATE blower_runtime_probe_intents_v5 SET expected_cycle_start_revision='changed' WHERE request_id=?").run(f.requestId);
  assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

for(const [label,sql]of [
  ['raw total',"UPDATE ois_data_requests SET result_json=json_set(result_json,'$.runningSeconds',11) WHERE id='ordinary-append'"],
  ['intent identity',"UPDATE blower_runtime_probe_intents_v5 SET expected_cycle_start_revision='changed' WHERE request_id='ordinary-append'"],
  ['append receipt',"UPDATE blower_runtime_append_v1 SET base_running_seconds=base_running_seconds+1 WHERE request_id='ordinary-append'"]
])test('current descendant '+label+' is required for future strict appends',async t=>{
  const f=await recovered(t);await ordinaryAppend(f);f.sql.exec(sql);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

for(const [column,value]of [['blower_type','fbhe'],['unit_no','2'],['enabled',0]])test('changed asset identity '+column+' cannot donate the closed certificate',async t=>{
  const f=await recovered(t);f.sql.prepare("UPDATE blower_history_assets SET "+column+"=?,asset_group='fixture-identity-only' WHERE tag_number=?").run(value,TAG);
  assert.equal(verifiedAppendBase(f.asset(),f.events(),SIGNAL),null);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

test('full batch preparation reloads the closed proof and never falls back after witness/source evidence changes',async t=>{
  const f=await recovered(t),a=f.asset(),item={action:'create_blower_runtime_probe',assetTag:TAG,dataParcTag:SIGNAL,confirmRunSignal:true,
    unifiedRefresh:true,incrementalRefresh:true,requireIncrementalAppend:true,expectedLastReplacementAt:a.last_replacement_at,
    expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:'',expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision},
    body={action:'create_blower_runtime_probe_batch',requests:[item]};
  const created=await publicRequest(f,body);assert.ok([200,201].includes(created.status),JSON.stringify(created.body));
  const pending=f.sql.prepare("SELECT * FROM ois_data_requests WHERE status='pending'").all();assert.equal(pending.length,1);
  const intent=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(pending[0].id);
  assert.equal(Date.parse(intent.window_start),Date.parse(a.cycle_runtime_anchor_at));assert.equal(intent.expected_cycle_start_revision,'signal-only-v1:'+a.cycle_start_revision);
  f.sql.exec("DELETE FROM ois_data_requests WHERE status='pending'; DELETE FROM blower_runtime_probe_intents_v5 WHERE request_id NOT IN(SELECT id FROM ois_data_requests)");
  f.sql.prepare("UPDATE blower_history_events SET note='changed' WHERE event_type='cycle_source_reconcile'").run();
  const denied=await publicRequest(f,body);assert.equal(denied.status,409);assert.equal(denied.body.code,'BLOWER_INCREMENTAL_BASE_REQUIRED');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM ois_data_requests WHERE status='pending'").get().n,0);
});
