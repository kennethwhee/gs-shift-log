import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {createFbhe1bStandbyFixture} from './helpers/blower-fbhe1b-standby-fixture-v1.mjs';
import {loadAppendBase} from '../functions/_shared/blower-incremental.js';
import {convertBlowerRuntimeProbeIntentRow,normalizeBlowerRuntimeProbeResult,buildBlowerRuntimeProbeChunks} from '../functions/api/ois-data-requests.js';
import {createFbhe2cStandbyFixture,ordinaryAppend,publicHistory,publicRequest,insert,result,installNegativeCompletionReview,TAG,SIGNAL,START,SEAM,RANGE} from './helpers/blower-fbhe2c-standby-fixture-v1.mjs';
const require=createRequire(import.meta.url),TABLE='blower_fbhe2c_standby_certificates_v1';
const encode=JSON.stringify;
const state=async f=>JSON.parse(JSON.stringify((await history.loadAssetStates(f.db,{},{assetRows:[f.asset()]}))[0]));
function frozen(f){return encode({asset:f.asset(),events:f.events(),requests:f.sql.prepare('SELECT * FROM ois_data_requests ORDER BY id').all(),intents:f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 ORDER BY request_id').all(),appends:f.sql.prepare('SELECT * FROM blower_runtime_append_v1 ORDER BY request_id').all()});}
function certificate(f){return encode({certificate:f.sql.prepare('SELECT * FROM '+TABLE+' ORDER BY id').all(),audit:f.sql.prepare("SELECT * FROM blower_history_asset_history WHERE action_type='fbhe2c_standby_recovery' ORDER BY id").all()});}
function equivalent(a,seconds,applied){
 const refresh=require('../maintenance/blower-unified-refresh.js'),ui=require('../maintenance/blower-fbhe2c-standby-v1.js');
 assert.equal(a.dataParcRuntimeBasis.runningSeconds,seconds);
 assert.equal(Date.parse(a.dataParcRuntimeBasis.startAt),Date.parse(RANGE));
 assert.equal(a.runtimeCoverageEvidence.measurementVerified,true);
 assert.equal(a.runtimeCoverageEvidence.durationEquivalent,true);
 assert.equal(a.runtimeCoverageEvidence.durationVerified,true);
 assert.equal(a.runtimeCoverageEvidence.completionClockKnown,false);
 assert.equal(a.runtimeCoverageEvidence.wholeCycleVerified,false);
 assert.equal(a.runtimeCoverageEvidence.cycleBasisConfirmed,false);
 assert.equal(a.runtimeCoverageEvidence.sampleGoodCertified,false);
 assert.equal(a.fbhe2cStandbyProof.noRestartThroughWindowEnd,true);
 assert.equal(a.fbhe2cStandbyProof.zeroWindowEndAt,SEAM);
 assert.equal(a.fbhe2cStandbyProof.originalTailRunningSeconds,3600);
 assert.equal(a.actualLastReplacementAt,'');
 assert.equal(a.cycleBasisKind,'replacement_standby_equivalent');
 assert.deepEqual(a.fbhe2cStandbyProof,a.dataParcRuntimeBasis.fbhe2cStandby);
 assert.deepEqual(a.fbhe2cStandbyProof,a.runtimeCoverageEvidence.fbhe2cStandby);
 assert.equal(a.runRuntime.verified,true);
 assert.equal(a.cycleSourceReview,undefined);
 assert.ok(refresh.verifiedFbhe2cStandby(a),'the browser must accept the actual serialized server projection');
 assert.equal(refresh.runReviewStatus(a),null);
 assert.ok(ui.verifyReadback(a,applied));
 assert.doesNotMatch(encode(a),/evidence_json|attestation_json|result_json|snapshot_json|SourceGuards|SELECT 1 FROM|Bearer /);
}
function seedOtherAssets(f){
 for(const a of f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number<>? ORDER BY tag_number').all(TAG)){
  const signal=a.tag_number==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.'+a.tag_number+'XB04';
  const revision='fixture-start:'+a.tag_number,id='ordinary-root:'+a.tag_number;
  const intent={request_id:id,reuse_key:id,schema_version:1,asset_tag:a.tag_number,dataparc_tag:signal,window_start:START,window_end:f.end,chunk_days:31,chunk_count:buildBlowerRuntimeProbeChunks(START,f.end).length,expected_last_replacement_at:START,expected_cycle_start_state:'legacy',expected_cycle_started_at:'',expected_cycle_start_revision:revision,expected_cycle_runtime_revision:'fixture-seed:'+a.tag_number,created_at:f.end,updated_at:f.end};
  const raw=result(intent,f.end),normalized=normalizeBlowerRuntimeProbeResult(raw,convertBlowerRuntimeProbeIntentRow(intent),id,new Date(f.end));assert.equal(normalized.error,undefined);
  insert(f.sql,'blower_runtime_probe_intents_v5',intent);
  insert(f.sql,'ois_data_requests',{id,request_type:'blower_runtime_probe',target_date:`v1|${a.tag_number}|${START}|${f.end}`,status:'complete',requested_by_id:f.user.employeeNo,requested_by_name:f.user.name,requested_at:new Date(Date.parse(f.end)-1000).toISOString(),started_at:f.end,completed_at:f.end,agent_id:'fixture-agent',result_json:encode(raw),error_message:'',expires_at:new Date(f.now.getTime()+3600000).toISOString(),updated_at:f.end});
  insert(f.sql,'blower_history_events',{id:'dataparc_runtime:'+id,tag_number:a.tag_number,event_type:'runtime_correction',event_date:f.end,runtime_hours:0,issue_type:'',action_type:'RUN 조회',note:'Fixture measured range',source_type:'dataparc_runtime',source_log_id:id,source_text:encode(normalized.result),created_by_id:f.user.employeeNo,created_by_name:f.user.name,created_at:f.end,updated_at:f.end});
  f.sql.prepare("UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,cycle_start_revision=?,cycle_runtime_revision=?,cycle_runtime_hours=0,runtime_hours=0,cycle_runtime_anchor_at=?,cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0 WHERE tag_number=?").run(START,revision,'fixture-runtime:'+a.tag_number,f.end,a.tag_number);
 }
}
test('standby certification changes no asset, event, saved request, intent or append receipt bytes',async t=>{
 const f=await createFbhe2cStandbyFixture(t),before=frozen(f),applied=await f.apply(await f.status());
 assert.equal(frozen(f),before);
 assert.equal(f.asset().cycle_start_state,'pending');assert.equal(f.asset().cycle_started_at,null);
 assert.equal(Date.parse(f.asset().last_replacement_at),Date.parse(START));
 const beforeRead=certificate(f);equivalent(await state(f),3600,applied);
 assert.equal(certificate(f),beforeRead);assert.equal(frozen(f),before);
});
test('ordinary positive RUN append retains the certificate and verifies the current duration',async t=>{
 const f=await createFbhe2cStandbyFixture(t),applied=await f.apply(await f.status()),proof=certificate(f),revision=f.asset().cycle_start_revision;
 await ordinaryAppend(f);
 const base=await loadAppendBase(f.db,f.asset(),SIGNAL);assert.equal(base.runningSeconds,3610);
 assert.equal(f.asset().cycle_start_revision,revision);assert.equal(f.asset().cycle_start_state,'pending');assert.equal(f.asset().cycle_started_at,null);
 assert.equal(certificate(f),proof);equivalent(await state(f),3610,applied);
 const beforeReplay=frozen(f);await f.apply(await f.status());assert.equal(frozen(f),beforeReplay);assert.equal(certificate(f),proof);
});
test('one public full batch keeps all 27 ordinary append bases, including the certified FBHE range',async t=>{
 const f=await createFbhe2cStandbyFixture(t);await f.apply(await f.status());seedOtherAssets(f);
 const proof=certificate(f),assets=f.sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all();assert.equal(assets.length,27);
 for(const a of assets){const signal=a.tag_number==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.'+a.tag_number+'XB04';assert.ok(await loadAppendBase(f.db,a,signal),a.tag_number);}
 const body={action:'create_blower_runtime_probe_batch',requests:assets.map(a=>({action:'create_blower_runtime_probe',assetTag:a.tag_number,dataParcTag:a.tag_number==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.'+a.tag_number+'XB04',confirmRunSignal:true,unifiedRefresh:true,incrementalRefresh:true,requireIncrementalAppend:true,expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision}))};
 const out=await publicRequest(f,body);assert.equal(out.status,201,encode(out.body));assert.equal(out.body.createdCount,27);
 assert.equal(certificate(f),proof);assert.equal(f.asset().cycle_runtime_hours,1);
});
test('normal source synchronization preserves the certificate, original owner and all asset counters',async t=>{
 const f=await createFbhe2cStandbyFixture(t),applied=await f.apply(await f.status()),proof=certificate(f),before=frozen(f);
 const now=f.now,endDate=new Date(now.getTime()+32400000).toISOString().slice(0,10),fromDate=new Date(now.getTime()+32400000-365*86400000).toISOString().slice(0,10);
 let body={incrementalLogs:true,autoApplyConfirmedReplacements:true,normalizationVersion:4,window:{fromDate,endDate,snapshotAt:now.toISOString()},limit:8},done=false;
 for(let page=0;page<20;page++){
  const response=await history.reflectApprovedReplacementPageV3(f.db,f.user,body,{now}),view=await response.json();assert.equal(response.status,200,encode(view));
  if(view.done){done=true;break;}body={...body,cursor:view.nextCursor};
 }
 assert.equal(done,true);assert.equal(certificate(f),proof);assert.equal(frozen(f),before);equivalent(await state(f),3600,applied);
});
test('revoked approved source restores review while preserving both the measured tail and certificate',async t=>{
 const f=await createFbhe2cStandbyFixture(t);await f.apply(await f.status());await ordinaryAppend(f);
 const proof=certificate(f),before=frozen(f);f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BCO2'").run();
 const a=await state(f);assert.equal(a.fbhe2cStandbyProof,undefined);assert.notEqual(a.runtimeCoverageEvidence.durationEquivalent,true);assert.ok(a.cycleSourceReview);
 assert.equal(a.dataParcRuntimeBasis.runningSeconds,3610);assert.equal(frozen(f),before);assert.equal(certificate(f),proof);
 assert.equal((await loadAppendBase(f.db,f.asset(),SIGNAL)).runningSeconds,3610);
});
test('a later explicit physical clock invalidates only the old duration projection',async t=>{
 const f=await createFbhe2cStandbyFixture(t);await f.apply(await f.status());const proof=certificate(f);
 f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run('2026-09-16T09:40:00+09:00',TAG);
 const before=frozen(f),a=await state(f);assert.equal(a.fbhe2cStandbyProof,undefined);assert.notEqual(a.runtimeCoverageEvidence.durationEquivalent,true);
 assert.equal(frozen(f),before);assert.equal(certificate(f),proof);assert.equal(f.asset().cycle_runtime_hours,1);
});
test('a genuine later replacement leaves the old standby certificate historical',async t=>{
 const f=await createFbhe2cStandbyFixture(t);await f.apply(await f.status());const proof=certificate(f),revision=f.asset().cycle_start_revision;
 const out=await publicHistory(f,{action:'replacement',tagNumber:TAG,eventDate:new Date(f.now.getTime()-3600000).toISOString()});assert.equal(out.status,200,encode(out.body));
 assert.notEqual(f.asset().cycle_start_revision,revision);assert.equal(certificate(f),proof);
 const a=await state(f);assert.equal(a.fbhe2cStandbyProof,undefined);assert.notEqual(a.runtimeCoverageEvidence.durationEquivalent,true);
});

test('the historical 09:23 window with 325 pre-job RUN seconds is suppressed only while the new zero-envelope certificate is valid',async t=>{
 const f=await createFbhe2cStandbyFixture(t),negative=await installNegativeCompletionReview(f),old=await state(f);
 assert.equal(old.completionWindowRecoveryReview.requestId,negative.requestId);assert.equal(old.completionWindowRecoveryReview.runningSeconds,325);
 const oldRows=encode({outcomes:f.sql.prepare('SELECT * FROM blower_completion_window_outcomes_v1 ORDER BY request_id').all(),intents:f.sql.prepare('SELECT * FROM blower_completion_window_intents_v1 ORDER BY request_id').all()}),before=frozen(f),applied=await f.apply(await f.status());
 const a=await state(f);equivalent(a,3600,applied);
 const core=require('../maintenance/blower-unified-refresh.js'),planned=core.plan([a],f.now);assert.equal(core.runtimeRecoveryPlan(a,f.now),null);assert.equal(planned.tasks.length,1);assert.equal(planned.skipped.length,0);assert.equal(planned.tasks[0].kind,'dataparc');assert.equal(planned.tasks[0].incremental,true);assert.equal(Date.parse(planned.tasks[0].queryStartAt),Date.parse(a.dataParcRuntimeBasis.observedAt));assert.notEqual(planned.tasks[0].partialRange,true);assert.equal(planned.tasks[0].recoveryMode,undefined);
 assert.equal(a.completionWindowRecoveryReview,undefined);assert.equal(a.completionWindowRecovery,undefined);
 assert.equal(frozen(f),before);assert.equal(encode({outcomes:f.sql.prepare('SELECT * FROM blower_completion_window_outcomes_v1 ORDER BY request_id').all(),intents:f.sql.prepare('SELECT * FROM blower_completion_window_intents_v1 ORDER BY request_id').all()}),oldRows);
 f.sql.prepare('UPDATE '+TABLE+' SET proof_hash=?').run('0'.repeat(64));
 const invalid=await state(f);assert.equal(invalid.fbhe2cStandbyProof,undefined);assert.equal(invalid.completionWindowRecoveryReview.requestId,negative.requestId);assert.equal(invalid.completionWindowRecoveryReview.runningSeconds,325);assert.equal(invalid.completionWindowRecovery.eligible,false);
 assert.equal(invalid.dataParcRuntimeBasis.runningSeconds,3600);assert.equal(frozen(f),before);
 assert.equal(encode({outcomes:f.sql.prepare('SELECT * FROM blower_completion_window_outcomes_v1 ORDER BY request_id').all(),intents:f.sql.prepare('SELECT * FROM blower_completion_window_intents_v1 ORDER BY request_id').all()}),oldRows);
});

test('a real certified B projection plans an ordinary append while an invalid B certificate retains the existing hold',async t=>{
 const f=await createFbhe1bStandbyFixture(t);await f.apply(await f.status());
 const core=require('../maintenance/blower-unified-refresh.js'),a=await state(f),before=frozen(f),planned=core.plan([a],f.now);
 assert.ok(core.verifiedFbhe1bStandby(a));assert.equal(core.runtimeRecoveryPlan(a,f.now),null);
 assert.equal(planned.tasks.length,1);assert.equal(planned.skipped.length,0);
 const task=planned.tasks[0];assert.equal(task.kind,'dataparc');assert.equal(task.incremental,true);assert.equal(Date.parse(task.queryStartAt),Date.parse(a.dataParcRuntimeBasis.observedAt));assert.notEqual(task.partialRange,true);assert.equal(task.recoveryMode,undefined);
 const invalid=structuredClone(a);invalid.fbhe1bStandbyProof.proofHash='0'.repeat(64);
 assert.equal(core.verifiedFbhe1bStandby(invalid),null);const held=core.plan([invalid],f.now);assert.equal(held.tasks.length,0);assert.equal(held.skipped.length,1);assert.equal(frozen(f),before);
});
