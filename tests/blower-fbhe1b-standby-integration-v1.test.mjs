import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {loadAppendBase} from '../functions/_shared/blower-incremental.js';
import {convertBlowerRuntimeProbeIntentRow,normalizeBlowerRuntimeProbeResult,buildBlowerRuntimeProbeChunks} from '../functions/api/ois-data-requests.js';
import {createFbhe1bStandbyFixture,ordinaryAppend,publicHistory,publicRequest,insert,result,TAG,SIGNAL,START,SEAM} from './helpers/blower-fbhe1b-standby-fixture-v1.mjs';
const require=createRequire(import.meta.url),TABLE='blower_fbhe1b_standby_certificates_v1';
const encode=JSON.stringify;
const state=async f=>JSON.parse(JSON.stringify((await history.loadAssetStates(f.db,{},{assetRows:[f.asset()]}))[0]));
function frozen(f){return encode({asset:f.asset(),events:f.events(),requests:f.sql.prepare('SELECT * FROM ois_data_requests ORDER BY id').all(),intents:f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 ORDER BY request_id').all(),appends:f.sql.prepare('SELECT * FROM blower_runtime_append_v1 ORDER BY request_id').all()});}
function certificate(f){return encode({certificate:f.sql.prepare('SELECT * FROM '+TABLE+' ORDER BY id').all(),audit:f.sql.prepare("SELECT * FROM blower_history_asset_history WHERE action_type='fbhe1b_standby_recovery' ORDER BY id").all()});}
function equivalent(a,seconds,applied){
 const refresh=require('../maintenance/blower-unified-refresh.js'),ui=require('../maintenance/blower-fbhe1b-standby-v1.js');
 assert.equal(a.dataParcRuntimeBasis.runningSeconds,seconds);
 assert.equal(Date.parse(a.dataParcRuntimeBasis.startAt),Date.parse(SEAM));
 assert.equal(a.runtimeCoverageEvidence.measurementVerified,true);
 assert.equal(a.runtimeCoverageEvidence.durationEquivalent,true);
 assert.equal(a.runtimeCoverageEvidence.durationVerified,true);
 assert.equal(a.runtimeCoverageEvidence.completionClockKnown,false);
 assert.equal(a.runtimeCoverageEvidence.wholeCycleVerified,false);
 assert.equal(a.runtimeCoverageEvidence.cycleBasisConfirmed,false);
 assert.equal(a.runtimeCoverageEvidence.sampleGoodCertified,false);
 assert.equal(a.actualLastReplacementAt,'');
 assert.equal(a.cycleBasisKind,'replacement_standby_equivalent');
 assert.deepEqual(a.fbhe1bStandbyProof,a.dataParcRuntimeBasis.fbhe1bStandby);
 assert.deepEqual(a.fbhe1bStandbyProof,a.runtimeCoverageEvidence.fbhe1bStandby);
 assert.equal(a.runRuntime.verified,true);
 assert.equal(a.cycleSourceReview,undefined);
 assert.ok(refresh.verifiedFbhe1bStandby(a),'the browser must accept the actual serialized server projection');
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
 const f=await createFbhe1bStandbyFixture(t),before=frozen(f),applied=await f.apply(await f.status());
 assert.equal(frozen(f),before);
 assert.equal(f.asset().cycle_start_state,'pending');assert.equal(f.asset().cycle_started_at,null);
 assert.equal(Date.parse(f.asset().last_replacement_at),Date.parse(START));
 const beforeRead=certificate(f);equivalent(await state(f),0,applied);
 assert.equal(certificate(f),beforeRead);assert.equal(frozen(f),before);
});
test('ordinary positive RUN append retains the certificate and verifies the current duration',async t=>{
 const f=await createFbhe1bStandbyFixture(t),applied=await f.apply(await f.status()),proof=certificate(f),revision=f.asset().cycle_start_revision;
 await ordinaryAppend(f);
 const base=await loadAppendBase(f.db,f.asset(),SIGNAL);assert.equal(base.runningSeconds,10);
 assert.equal(f.asset().cycle_start_revision,revision);assert.equal(f.asset().cycle_start_state,'pending');assert.equal(f.asset().cycle_started_at,null);
 assert.equal(certificate(f),proof);equivalent(await state(f),10,applied);
 const beforeReplay=frozen(f);await f.apply(await f.status());assert.equal(frozen(f),beforeReplay);assert.equal(certificate(f),proof);
});
test('one public full batch keeps all 27 ordinary append bases, including the certified FBHE range',async t=>{
 const f=await createFbhe1bStandbyFixture(t);await f.apply(await f.status());seedOtherAssets(f);
 const proof=certificate(f),assets=f.sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all();assert.equal(assets.length,27);
 for(const a of assets){const signal=a.tag_number==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.'+a.tag_number+'XB04';assert.ok(await loadAppendBase(f.db,a,signal),a.tag_number);}
 const body={action:'create_blower_runtime_probe_batch',requests:assets.map(a=>({action:'create_blower_runtime_probe',assetTag:a.tag_number,dataParcTag:a.tag_number==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.'+a.tag_number+'XB04',confirmRunSignal:true,unifiedRefresh:true,incrementalRefresh:true,requireIncrementalAppend:true,expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision}))};
 const out=await publicRequest(f,body);assert.equal(out.status,201,encode(out.body));assert.equal(out.body.createdCount,27);
 assert.equal(certificate(f),proof);assert.equal(f.asset().cycle_runtime_hours,0);
});
test('normal source synchronization preserves the certificate, original owner and all asset counters',async t=>{
 const f=await createFbhe1bStandbyFixture(t),applied=await f.apply(await f.status()),proof=certificate(f),before=frozen(f);
 const now=f.now,endDate=new Date(now.getTime()+32400000).toISOString().slice(0,10),fromDate=new Date(now.getTime()+32400000-365*86400000).toISOString().slice(0,10);
 let body={incrementalLogs:true,autoApplyConfirmedReplacements:true,normalizationVersion:4,window:{fromDate,endDate,snapshotAt:now.toISOString()},limit:8},done=false;
 for(let page=0;page<20;page++){
  const response=await history.reflectApprovedReplacementPageV3(f.db,f.user,body,{now}),view=await response.json();assert.equal(response.status,200,encode(view));
  if(view.done){done=true;break;}body={...body,cursor:view.nextCursor};
 }
 assert.equal(done,true);assert.equal(certificate(f),proof);assert.equal(frozen(f),before);equivalent(await state(f),0,applied);
});
test('revoked approved source restores review while preserving both the measured tail and certificate',async t=>{
 const f=await createFbhe1bStandbyFixture(t);await f.apply(await f.status());await ordinaryAppend(f);
 const proof=certificate(f),before=frozen(f);f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BCO1'").run();
 const a=await state(f);assert.equal(a.fbhe1bStandbyProof,undefined);assert.notEqual(a.runtimeCoverageEvidence.durationEquivalent,true);assert.ok(a.cycleSourceReview);
 assert.equal(a.dataParcRuntimeBasis.runningSeconds,10);assert.equal(frozen(f),before);assert.equal(certificate(f),proof);
 assert.equal((await loadAppendBase(f.db,f.asset(),SIGNAL)).runningSeconds,10);
});
test('a later explicit physical clock invalidates only the old duration projection',async t=>{
 const f=await createFbhe1bStandbyFixture(t);await f.apply(await f.status());const proof=certificate(f);
 f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run('2026-10-08T13:30:00+09:00',TAG);
 const before=frozen(f),a=await state(f);assert.equal(a.fbhe1bStandbyProof,undefined);assert.notEqual(a.runtimeCoverageEvidence.durationEquivalent,true);
 assert.equal(frozen(f),before);assert.equal(certificate(f),proof);assert.equal(f.asset().cycle_runtime_hours,0);
});
test('a genuine later replacement leaves the old standby certificate historical',async t=>{
 const f=await createFbhe1bStandbyFixture(t);await f.apply(await f.status());const proof=certificate(f),revision=f.asset().cycle_start_revision;
 const out=await publicHistory(f,{action:'replacement',tagNumber:TAG,eventDate:new Date(f.now.getTime()-3600000).toISOString()});assert.equal(out.status,200,encode(out.body));
 assert.notEqual(f.asset().cycle_start_revision,revision);assert.equal(certificate(f),proof);
 const a=await state(f);assert.equal(a.fbhe1bStandbyProof,undefined);assert.notEqual(a.runtimeCoverageEvidence.durationEquivalent,true);
});
