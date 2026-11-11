import test from 'node:test';
import assert from 'node:assert/strict';
import {createLimestone2aFixture,ordinaryAppend,publicRequest,OWNER,TAG,SIGNAL,START,FIRST} from './helpers/blower-limestone2a-fixture-v1.mjs';
import {verifiedAppendBase,loadAppendBase,incrementalEvidence,LIMESTONE2A_CYCLE_PREFIX,LIMESTONE2A_SOURCE} from '../functions/_shared/blower-incremental.js';

async function recovered(t){const f=await createLimestone2aFixture(t);await f.apply(await f.status());return f;}
function source(f){const row=f.events().find(row=>row.source_type===LIMESTONE2A_SOURCE);return {row,value:JSON.parse(row.source_text)};}
function changeCertificate(f,fn){const {row,value}=source(f);fn(value);f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(value),row.id);}
function stateBoundary(f,kind,{delta=0,mixed=false}={}){
  const a=f.asset(),at=new Date(Date.parse(a.cycle_runtime_anchor_at)+60000).toISOString();
  f.addEvent({id:kind==='manual'?'manual-stop':'operation-auto:1234abcd:stop',event_type:'operation_stop',event_date:at,
    runtime_hours:a.cycle_runtime_hours+delta,source_type:kind==='manual'?'manual':'shift_log_operation_auto',
    source_log_id:'fixture-stop-source',source_text:'Stored state boundary',action_type:kind==='manual'?'정지':'교체운전 자동 정지',created_at:at,updated_at:at});
  let anchor=at;
  if(mixed){anchor=new Date(Date.parse(at)+60000).toISOString();f.addEvent({id:'operation-auto:8765abcd:stop',event_type:'operation_stop',event_date:anchor,
    runtime_hours:a.cycle_runtime_hours,source_type:'shift_log_operation_auto',source_log_id:'other-state-source',source_text:'Automatic state boundary',
    action_type:'교체운전 자동 정지',created_at:anchor,updated_at:anchor});}
  f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_anchor_at=?,cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0,cycle_runtime_revision='state-boundary-revision',cycle_runtime_hours=?,runtime_hours=? WHERE tag_number=?")
    .run(anchor,a.cycle_runtime_hours+delta,a.cycle_runtime_hours+delta,TAG);
}

test('the closed certificate retains the date placeholder, pending state and fractional first RUN without claiming a completion clock',async t=>{
  const f=await recovered(t),asset=f.asset(),pure=verifiedAppendBase(asset,f.events(),SIGNAL),base=await loadAppendBase(f.db,asset,SIGNAL);
  assert.ok(base);assert.deepEqual(base.limestone2aFirstRun,pure.limestone2aFirstRun);
  assert.equal(asset.last_replacement_at,START);assert.equal(asset.cycle_start_state,'pending');assert.equal(asset.cycle_started_at,null);
  assert.equal(base.startAt,START);assert.equal(base.runningSeconds,54094);assert.equal(base.composite,true);assert.equal(base.appendReady,true);
  const p=base.limestone2aFirstRun;
  assert.equal(p.firstRunAt,'2026-09-19T09:58:26.250+09:00');assert.equal(Math.floor(Date.parse(p.firstRunAt)/1000),Date.parse(FIRST)/1000);
  assert.equal(p.completionClockKnown,false);assert.equal(p.durationEquivalent,true);assert.equal(p.sampleGoodCertified,false);
  assert.equal(p.noEarlierPostReplacementRun,true);assert.equal(p.completionBeforeFirstRun,true);
  assert.equal(p.proofHash,asset.cycle_start_revision.slice(LIMESTONE2A_CYCLE_PREFIX.length));
  assert.equal(p.currentRuntimeRevision,asset.cycle_runtime_revision);assert.equal(p.currentRunningSeconds,54094);
  assert.equal(p.currentObservedAt,base.observedAt);assert.equal(p.currentAnchorAt,asset.cycle_runtime_anchor_at);
  assert.equal(p.currentState,'running');assert.equal(p.measuredState,'running');assert.equal(p.preservedStateBoundary,false);
  assert.ok(base.limestone2aSourceGuards.length>=9);
});

test('an ordinary append continues from the immutable composite and retains all archived prefix bytes',async t=>{
  const f=await recovered(t),before=f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(f.requestId),intent=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(f.requestId);
  await ordinaryAppend(f);
  const base=await loadAppendBase(f.db,f.asset(),SIGNAL);
  assert.ok(base);assert.equal(base.runningSeconds,54104);assert.equal(base.limestone2aFirstRun.currentRunningSeconds,54104);
  assert.equal(base.limestone2aFirstRun.prefixRequestId,f.requestId);assert.equal(base.limestone2aFirstRun.currentRuntimeRevision,f.asset().cycle_runtime_revision);
  assert.deepEqual(f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(f.requestId),before);
  assert.deepEqual(f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(f.requestId),intent);
  assert.equal(incrementalEvidence(JSON.parse(f.events().find(row=>row.id==='dataparc_runtime:ordinary-append').source_text)).baseEventId,'dataparc_limestone2a_first_run:'+f.requestId);
});

for(const kind of ['manual','automatic'])test(kind+' equal-counter state boundaries keep the measured seam and allow a subsequent append',async t=>{
  const f=await recovered(t),observed=f.asset().cycle_runtime_anchor_at;stateBoundary(f,kind);
  const base=await loadAppendBase(f.db,f.asset(),SIGNAL);
  assert.ok(base);assert.equal(base.preservedStateBoundary,true);assert.equal(base.observedAt,observed);assert.equal(base.state,'running');
  assert.equal(base.limestone2aFirstRun.currentState,'stopped');assert.equal(base.limestone2aFirstRun.measuredState,'running');
  assert.equal(base.limestone2aFirstRun.currentAnchorAt,f.asset().cycle_runtime_anchor_at);assert.equal(base.limestone2aFirstRun.preservedStateBoundary,true);
  await ordinaryAppend(f);assert.equal((await loadAppendBase(f.db,f.asset(),SIGNAL)).runningSeconds,54104);
});

for(const mode of ['counter','mixed'])test(mode+' state overlays cannot manufacture a valid append certificate',async t=>{
  const f=await recovered(t);stateBoundary(f,'manual',mode==='counter'?{delta:1}:{mixed:true});
  assert.equal(verifiedAppendBase(f.asset(),f.events(),SIGNAL),null);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

for(const [label,mutate]of [
  ['completion clock',s=>s.completionClockKnown=true],['operator fact',s=>s.attestation.completionBeforeFirstRun=false],
  ['earlier RUN fact',s=>s.attestation.noEarlierPostReplacementRun=false],['first RUN',s=>s.prefix.firstRunAt='2026-09-19T10:00:00+09:00'],
  ['prefix seconds',s=>s.prefix.runningSeconds++],['proof hash',s=>s.proofHash='f'.repeat(64)],
  ['owner date',s=>s.owner.event_date='2026-09-19T10:00:00+09:00'],['tail start state',s=>s.tailAsset.cycle_start_state='legacy']
])test('changed '+label+' cannot certify the closed cycle',async t=>{
  const f=await recovered(t);changeCertificate(f,mutate);
  assert.equal(verifiedAppendBase(f.asset(),f.events(),SIGNAL),null);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

test('deleting the certificate never falls back to an otherwise plausible ordinary descendant',async t=>{
  const f=await recovered(t);await ordinaryAppend(f);
  f.sql.prepare('DELETE FROM blower_history_events WHERE source_type=?').run(LIMESTONE2A_SOURCE);
  assert.equal(verifiedAppendBase(f.asset(),f.events(),SIGNAL),null);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

for(const [label,sql]of [
  ['original event note',"UPDATE blower_history_events SET note='changed' WHERE id='dataparc_runtime:tail-root'"],
  ['original event source extras',"UPDATE blower_history_events SET source_text=json_set(source_text,'$.extra','changed') WHERE id='dataparc_runtime:tail-root'"],
  ['original raw request',"UPDATE ois_data_requests SET error_message='changed' WHERE id='tail-root'"],
  ['original intent',"UPDATE blower_runtime_probe_intents_v5 SET expected_cycle_runtime_revision='changed' WHERE request_id='tail-root'"],
  ['replacement owner',"UPDATE blower_history_events SET note='changed' WHERE id='"+OWNER+"'"],
  ['approved source',"UPDATE shift_logs SET updated_at='2026-11-11T22:00:00Z' WHERE role='BO2'"],
  ['audit snapshot',"UPDATE blower_history_asset_history SET before_json=json_set(before_json,'$.unrelated','changed') WHERE action_type='limestone2a_first_run_recovery'"],
  ['prefix request bytes',"UPDATE ois_data_requests SET result_json=result_json||' ' WHERE id='00000000-0000-4000-8000-000000000091'"],
  ['prefix intent',"UPDATE blower_runtime_probe_intents_v5 SET reuse_key='changed' WHERE request_id='00000000-0000-4000-8000-000000000091'"]
])test('current strict loading rejects edits to '+label,async t=>{
  const f=await recovered(t);f.sql.exec(sql);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

for(const [label,sql]of [
  ['appended raw result',"UPDATE ois_data_requests SET result_json=json_set(result_json,'$.runningSeconds',11) WHERE id='ordinary-append'"],
  ['appended intent identity',"UPDATE blower_runtime_probe_intents_v5 SET expected_cycle_start_revision='changed' WHERE request_id='ordinary-append'"],
  ['appended server receipt',"UPDATE blower_runtime_append_v1 SET base_running_seconds=base_running_seconds+1 WHERE request_id='ordinary-append'"]
])test('ordinary descendant '+label+' remains part of strict current evidence',async t=>{
  const f=await recovered(t);await ordinaryAppend(f);f.sql.exec(sql);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

test('batch preparation uses the same strict loader and cannot borrow the ordinary bulk fallback after raw evidence changes',async t=>{
  const f=await recovered(t),a=f.asset(),item={action:'create_blower_runtime_probe',assetTag:TAG,dataParcTag:SIGNAL,confirmRunSignal:true,
    unifiedRefresh:true,incrementalRefresh:true,requireIncrementalAppend:true,expectedLastReplacementAt:a.last_replacement_at,
    expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',expectedCycleStartRevision:a.cycle_start_revision,
    expectedCycleRuntimeRevision:a.cycle_runtime_revision},body={action:'create_blower_runtime_probe_batch',requests:[item]};
  const result=await publicRequest(f,body);assert.ok([200,201].includes(result.status),JSON.stringify(result.body));
  const queued=f.sql.prepare("SELECT * FROM ois_data_requests WHERE status='pending'").all();assert.equal(queued.length,1);
  const intent=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(queued[0].id);
  assert.equal(Date.parse(intent.window_start),Date.parse(f.asset().cycle_runtime_anchor_at));
  assert.equal(intent.expected_cycle_start_revision,'signal-only-v1:'+f.asset().cycle_start_revision);
  f.sql.exec("DELETE FROM ois_data_requests WHERE status='pending'; DELETE FROM blower_runtime_probe_intents_v5 WHERE request_id NOT IN(SELECT id FROM ois_data_requests)");
  f.sql.prepare("UPDATE blower_history_events SET note='changed' WHERE id='dataparc_runtime:tail-root'").run();
  const denied=await publicRequest(f,body);assert.equal(denied.status,409);assert.equal(denied.body.code,'BLOWER_INCREMENTAL_BASE_REQUIRED');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM ois_data_requests WHERE status='pending'").get().n,0);
});
