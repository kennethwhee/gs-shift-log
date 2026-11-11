import test from 'node:test';
import assert from 'node:assert/strict';
import {createFbhe1aRuntimeFixture,ordinaryAppend,publicRequest,OWNER,TAG,SIGNAL,START,BASE_START,DAY_END} from './helpers/blower-fbhe1a-runtime-fixture-v1.mjs';
import {applyFbhe1aRuntime} from '../functions/_shared/blower-fbhe1a-runtime-v1.js';
import {verifiedAppendBase,loadAppendBase,incrementalEvidence,FBHE1A_CYCLE_PREFIX,FBHE1A_SOURCE} from '../functions/_shared/blower-incremental.js';

async function recovered(t,options){const f=await createFbhe1aRuntimeFixture(t,options);await f.apply(await f.ready());return f;}
function changeCertificate(f,change){const row=f.events().find(row=>row.source_type===FBHE1A_SOURCE),source=JSON.parse(row.source_text);change(source);f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(source),row.id);}
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

for(const [fraction,excluded]of [['250',39],['750',40]])test('the fresh measurement retains fractional witness '+fraction+' and derives the rounded exclusion without a completion or first-restart clock',async t=>{
  const f=await recovered(t,{fraction}),a=f.asset(),base=await loadAppendBase(f.db,a,SIGNAL),pure=verifiedAppendBase(a,f.events(),SIGNAL);
  assert.ok(base);assert.deepEqual(base.fbhe1aRuntime,pure.fbhe1aRuntime);
  assert.equal(a.last_replacement_at,START);assert.equal(a.cycle_start_state,'legacy');assert.equal(a.cycle_started_at,null);
  assert.equal(base.startAt,DAY_END);assert.equal(base.runningSeconds,100000-excluded);assert.equal(base.appendReady,true);assert.equal(base.composite,true);
  const p=base.fbhe1aRuntime;
  assert.equal(p.excludedPreReplacementSeconds,excluded);assert.equal(p.lastRunStoppedAt,'2026-09-04T10:50:39.'+fraction+'+09:00');
  assert.equal(p.measuredStartAt,DAY_END);assert.equal(p.completionClockKnown,false);assert.equal(p.durationEquivalent,true);assert.equal(p.sampleGoodCertified,false);
  assert.equal(p.replacementCompletedAfterStop,true);assert.equal(p.noRestartThroughWindowEnd,true);assert.equal(p.zeroWindowEndAt,DAY_END);
  assert.equal(p.operatorReportedRestartDay,'2026-10-08');assert.equal(p.firstRunAt,undefined);assert.equal(p.rawFirstRunAt,undefined);
  assert.equal(base.requiredStartAt,START);assert.equal(base.missingLeadingSeconds,0);
  assert.equal(p.witnessRequestId,f.witnessRequestId);assert.equal(p.measuredRunningSeconds,100000-excluded);
  assert.equal(p.proofHash,a.cycle_start_revision.slice(FBHE1A_CYCLE_PREFIX.length));assert.equal(p.currentRunningSeconds,100000-excluded);
  assert.equal(p.currentRuntimeRevision,a.cycle_runtime_revision);assert.equal(p.currentObservedAt,base.observedAt);
  assert.equal(p.currentAnchorAt,a.cycle_runtime_anchor_at);assert.equal(p.currentState,'running');assert.equal(p.measuredState,'running');
  assert.equal(p.preservedStateBoundary,false);
  const certificate=JSON.parse(f.events().find(row=>row.source_type===FBHE1A_SOURCE).source_text);
  assert.equal(p.comparisonToleranceSeconds,Math.ceil((certificate.baseline.chunkCount+certificate.measurement.chunkCount+1)/2)+2);
});

test('UTC saved receipt boundaries create canonical KST wire chunks at the same frozen endpoint',async t=>{
  const f=await createFbhe1aRuntimeFixture(t),old=f.events().find(row=>row.id==='dataparc_runtime:baseline-root'),saved=JSON.parse(old.source_text);
  for(const key of ['startAt','endAt','observedAt'])saved[key]=new Date(saved[key]).toISOString();
  f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(saved),old.id);
  f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_anchor_at=?,runtime_anchor_at=? WHERE tag_number=?').run(saved.observedAt,saved.observedAt,TAG);
  f.sql.prepare('UPDATE blower_history_events SET event_date=? WHERE id=?').run(saved.observedAt,old.id);
  const before=f.asset(),pending=await f.start(await f.status()),intent=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(pending.request.id);
  assert.equal(Date.parse(intent.window_end),Date.parse(before.cycle_runtime_anchor_at));assert.match(intent.window_end,/\+09:00$/);
  assert.equal(f.asset().cycle_runtime_anchor_at,before.cycle_runtime_anchor_at);
  f.complete(pending);await f.apply(await f.status());
  const base=await loadAppendBase(f.db,f.asset(),SIGNAL);
  assert.ok(base);assert.equal(base.observedAt,saved.observedAt);assert.equal(base.runningSeconds,99960);
  await ordinaryAppend(f);assert.equal((await loadAppendBase(f.db,f.asset(),SIGNAL)).runningSeconds,99970);
});

test('an ordinary append continues from the fresh certificate while keeping witness and fresh request bytes unchanged',async t=>{
  const f=await recovered(t),ids=[f.witnessRequestId,f.requestId],before=ids.map(id=>f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(id));
  await ordinaryAppend(f);const base=await loadAppendBase(f.db,f.asset(),SIGNAL);
  assert.ok(base);assert.equal(base.runningSeconds,99970);assert.equal(base.fbhe1aRuntime.freshRequestId,f.requestId);
  assert.equal(base.fbhe1aRuntime.currentRunningSeconds,99970);assert.equal(base.fbhe1aRuntime.currentRuntimeRevision,f.asset().cycle_runtime_revision);
  assert.deepEqual(ids.map(id=>f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(id)),before);
  const raw=JSON.parse(f.events().find(row=>row.id==='dataparc_runtime:ordinary-append').source_text);
  assert.equal(incrementalEvidence(raw).baseEventId,'dataparc_fbhe1a_runtime:'+f.requestId);
});

for(const kind of ['manual','automatic'])test(kind+' equal-counter state overlays preserve the measured seam and later append',async t=>{
  const f=await recovered(t),at=f.asset().cycle_runtime_anchor_at;stateBoundary(f,kind);
  const base=await loadAppendBase(f.db,f.asset(),SIGNAL);
  assert.ok(base);assert.equal(base.preservedStateBoundary,true);assert.equal(base.observedAt,at);assert.equal(base.state,'running');
  assert.equal(base.fbhe1aRuntime.currentState,'stopped');assert.equal(base.fbhe1aRuntime.measuredState,'running');
  assert.equal(base.fbhe1aRuntime.currentAnchorAt,f.asset().cycle_runtime_anchor_at);
  await ordinaryAppend(f);assert.equal((await loadAppendBase(f.db,f.asset(),SIGNAL)).runningSeconds,99970);
});

for(const mode of ['counter','mixed'])test(mode+' state overlays cannot provide a closed append proof',async t=>{
  const f=await recovered(t);stateBoundary(f,'manual',mode==='counter'?{delta:1}:{mixed:true});
  assert.equal(verifiedAppendBase(f.asset(),f.events(),SIGNAL),null);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

for(const [label,change]of [
  ['completion clock',s=>s.completionClockKnown=true],['attested replacement window',s=>s.attestation.noRestartThroughWindowEnd=false],
  ['zero envelope endpoint',s=>s.attestation.zeroWindowEndAt=BASE_START],['fresh start',s=>s.measurement.startAt=START],
  ['fresh seconds',s=>s.measurement.runningSeconds++],['expanded tolerance',s=>s.comparison.toleranceSeconds++],
  ['excluded duration',s=>s.r9.excludedDurationMilliseconds++],['proof hash',s=>s.proofHash='f'.repeat(64)],
  ['replacement date',s=>s.owner.event_date=DAY_END],['role owner',s=>s.roleOwner.note='changed']
])test('changed '+label+' cannot preserve a valid closed certificate',async t=>{
  const f=await recovered(t);changeCertificate(f,change);
  assert.equal(verifiedAppendBase(f.asset(),f.events(),SIGNAL),null);assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

test('a missing certificate cannot fall back to a plausible ordinary descendant',async t=>{
  const f=await recovered(t);await ordinaryAppend(f);f.sql.prepare('DELETE FROM blower_history_events WHERE source_type=?').run(FBHE1A_SOURCE);
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
  ['audit snapshot',"UPDATE blower_history_asset_history SET before_json=json_set(before_json,'$.changed',true) WHERE action_type='fbhe1a_runtime_recovery'"],
  ['witness request bytes',"UPDATE ois_data_requests SET result_json=result_json||' ' WHERE id='00000000-0000-4000-8000-000000000095'"],
  ['case receipt',"UPDATE blower_fbhe1a_runtime_intents_v1 SET nonce='changed'"],
  ['case outcome',"UPDATE blower_fbhe1a_runtime_intents_v1 SET applied_json=json_set(applied_json,'$.preview.totalRunningSeconds',1)"]
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

for(const [column,value]of [['blower_type','limestone'],['unit_no','2'],['enabled',0]])test('changed asset identity '+column+' cannot donate the closed certificate',async t=>{
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
  assert.equal(Date.parse(intent.window_start),Date.parse(a.cycle_runtime_anchor_at));assert.equal(intent.expected_cycle_start_revision,a.cycle_start_revision);
  f.sql.exec("DELETE FROM ois_data_requests WHERE status='pending'; DELETE FROM blower_runtime_probe_intents_v5 WHERE request_id NOT IN(SELECT id FROM ois_data_requests)");
  f.sql.prepare("UPDATE blower_history_events SET note='changed' WHERE event_type='cycle_source_reconcile'").run();
  const denied=await publicRequest(f,body);assert.equal(denied.status,409);assert.equal(denied.body.code,'BLOWER_INCREMENTAL_BASE_REQUIRED');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM ois_data_requests WHERE status='pending'").get().n,0);
});

for(const delta of [-1,1])test('fresh authoritative measurement '+(delta>0?'+':'')+delta+' within the frozen comparison bound wins over naive subtraction',async t=>{
  const f=await createFbhe1aRuntimeFixture(t),started=await f.start(await f.status());f.complete(started,delta);
  const ready=await f.status();assert.equal(ready.preview.expectedRunningSeconds,99960);assert.equal(ready.preview.measuredRunningSeconds,99960+delta);assert.equal(ready.preview.differenceSeconds,delta);
  await f.apply(ready);const base=await loadAppendBase(f.db,f.asset(),SIGNAL);assert.ok(base);
  assert.equal(base.runningSeconds,99960+delta);assert.equal(base.fbhe1aRuntime.measuredRunningSeconds,99960+delta);
  assert.equal(base.fbhe1aRuntime.comparisonDifferenceSeconds,delta);assert.notEqual(base.runningSeconds,ready.preview.expectedRunningSeconds);
});

test('the case preserves the original actor name while an authenticated rename records the current applying name',async t=>{
  const f=await createFbhe1aRuntimeFixture(t),ready=await f.ready(),renamed={...f.user,name:'Current applying operator'};
  const applied=await applyFbhe1aRuntime(f.db,renamed,{requestId:f.requestId,expectedProofHash:ready.proofHash,confirmation:'FBHE_1A_RUNTIME_20260904',attestation:f.attestation(ready)},{now:new Date(f.now.getTime()+2000)});
  assert.equal(applied.applied,true);const cert=f.events().find(row=>row.source_type===FBHE1A_SOURCE),source=JSON.parse(cert.source_text),base=await loadAppendBase(f.db,f.asset(),SIGNAL);
  assert.equal(source.attestation.actorName,f.user.name);assert.equal(source.attestation.appliedByName,renamed.name);assert.equal(cert.created_by_name,renamed.name);assert.ok(base);assert.equal(base.runningSeconds,99960);
});

for(const mutation of ['delete','change'])test('original pre-recovery append receipt '+mutation+' is required before a new repair can start',async t=>{
  const f=await createFbhe1aRuntimeFixture(t);await ordinaryAppend({...f,now:new Date(f.now.getTime()-10000)});assert.equal((await f.status()).eligible,true);
  if(mutation==='delete')f.sql.prepare('DELETE FROM blower_runtime_append_v1 WHERE request_id=?').run('ordinary-append');
  else f.sql.prepare('UPDATE blower_runtime_append_v1 SET base_running_seconds=base_running_seconds+1 WHERE request_id=?').run('ordinary-append');
  await assert.rejects(f.status,err=>err?.status===409&&err?.code==='FBHE1A_RUNTIME_BASELINE_INVALID');
});

for(const mutation of ['delete','change'])test('original pre-recovery append receipt '+mutation+' invalidates later strict reads without changing the repaired counter',async t=>{
  const f=await createFbhe1aRuntimeFixture(t);await ordinaryAppend({...f,now:new Date(f.now.getTime()-10000)});const started=await f.start(await f.status());f.complete(started,10);await f.apply(await f.status());
  const valid=await loadAppendBase(f.db,f.asset(),SIGNAL);assert.ok(valid);assert.equal(valid.runningSeconds,99970);const before=f.asset();
  if(mutation==='delete')f.sql.prepare('DELETE FROM blower_runtime_append_v1 WHERE request_id=?').run('ordinary-append');
  else f.sql.prepare('UPDATE blower_runtime_append_v1 SET base_running_seconds=base_running_seconds+1 WHERE request_id=?').run('ordinary-append');
  assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);assert.deepEqual(f.asset(),before);
});

test('legacy descendants cannot acquire a signal-only wire prefix',async t=>{
  const f=await recovered(t);await ordinaryAppend(f);const intent=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get('ordinary-append');
  assert.equal(intent.expected_cycle_start_revision,f.asset().cycle_start_revision);
  f.sql.prepare('UPDATE blower_runtime_probe_intents_v5 SET expected_cycle_start_revision=? WHERE request_id=?').run('signal-only-v1:'+intent.expected_cycle_start_revision,'ordinary-append');
  assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
});

test('new A strict reads obey the five-term workerd cap and return every unchanged individual transaction guard',async t=>{
  const f=await recovered(t),prior=await loadAppendBase(f.db,f.asset(),SIGNAL),prepare=f.db.prepare.bind(f.db),calls=[];let writes=0;
  f.db.batch=async()=>{writes++;throw new Error('Read attempted a batch');};
  f.db.prepare=query=>{const statement=prepare(query);statement.run=async()=>{writes++;throw new Error('Read attempted a write');};
    if(/^SELECT [0-9]+ AS guard_index,CASE WHEN \(/.test(query)){const all=statement.all;statement.all=async function(){const terms=(query.match(/ AS guard_index,CASE WHEN /g)||[]).length;if(terms>5)throw new Error('too many terms in compound SELECT');const out=await all.call(this);calls.push({query,values:this.bindings,rows:out.results});return out;};}return statement;};
  const base=await loadAppendBase(f.db,f.asset(),SIGNAL);assert.ok(base);assert.equal(writes,0);assert.deepEqual(base.fbhe1aSourceGuards,prior.fbhe1aSourceGuards);
  const readGuards=base.fbhe1aSourceGuards.slice(0,-1);assert.equal(calls.length,Math.ceil(readGuards.length/5));assert.equal(calls.flatMap(call=>call.rows).length,readGuards.length);
  assert.deepEqual(calls.flatMap(call=>call.rows.map(row=>row.guard_index)),readGuards.map((_,index)=>index));
  for(const [n,call]of calls.entries()){const offset=n*5,group=readGuards.slice(offset,offset+5);assert.equal(call.query,group.map((guard,index)=>`SELECT ${offset+index} AS guard_index,CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS valid`).join(' UNION ALL '));assert.deepEqual(call.values,group.flatMap(guard=>guard.values));assert.ok(Buffer.byteLength(call.query)<100000);assert.ok(call.values.length<=100);}
});

test('a failed condition in a later A guard group cannot borrow the earlier successful conditions',async t=>{
  const f=await recovered(t),prepare=f.db.prepare.bind(f.db);let groups=0;
  f.db.prepare=query=>{const statement=prepare(query);if(/^SELECT [0-9]+ AS guard_index,CASE WHEN \(/.test(query)){const all=statement.all;statement.all=async function(){const out=await all.call(this);groups++;return groups===2?{...out,results:out.results.map((row,index)=>index===0?{...row,valid:0}:row)}:out;};}return statement;};
  assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);assert.equal(groups,2);
});

for(const mode of ['version','extra'])test('an audit after wrapper with changed '+mode+' cannot authorize strict reads or replay',async t=>{
  const f=await recovered(t),row=f.sql.prepare("SELECT * FROM blower_history_asset_history WHERE action_type='fbhe1a_runtime_recovery'").get(),after=JSON.parse(row.after_json),before=f.asset();
  if(mode==='version')after.version=2;else after.unrecognizedAuthority=true;
  f.sql.prepare('UPDATE blower_history_asset_history SET after_json=? WHERE id=?').run(JSON.stringify(after),row.id);
  assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
  await assert.rejects(f.status,err=>err?.status===409);assert.deepEqual(f.asset(),before);
});

for(const [label,change]of [
  ['total seconds',out=>out.preview.totalRunningSeconds++],
  ['applied disposition',out=>out.applied=false],
  ['reported restart day',out=>out.operatorReportedRestartDay='2026-10-07']
])test('coherent case and audit outcome tampering of '+label+' cannot replace the deterministically derived result',async t=>{
  const f=await recovered(t),receipt=f.sql.prepare('SELECT * FROM blower_fbhe1a_runtime_intents_v1 WHERE request_id=?').get(f.requestId),audit=f.sql.prepare("SELECT * FROM blower_history_asset_history WHERE action_type='fbhe1a_runtime_recovery'").get(),out=JSON.parse(receipt.applied_json),after=JSON.parse(audit.after_json),before=f.asset();
  change(out);after.outcome=structuredClone(out);
  f.sql.prepare('UPDATE blower_fbhe1a_runtime_intents_v1 SET applied_json=? WHERE request_id=?').run(JSON.stringify(out),f.requestId);
  f.sql.prepare('UPDATE blower_history_asset_history SET after_json=? WHERE id=?').run(JSON.stringify(after),audit.id);
  assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
  await assert.rejects(f.status,err=>err?.status===409);assert.deepEqual(f.asset(),before);
});
