import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {loadAppendBase} from '../functions/_shared/blower-incremental.js';
import {createFbhe1aRuntimeFixture,ordinaryAppend,publicHistory,result as probeResult,TAG,SIGNAL,START,OWNER} from './helpers/blower-fbhe1a-runtime-fixture-v1.mjs';
import {buildBlowerRuntimeProbeChunks} from '../functions/api/ois-data-requests.js';
const require=createRequire(import.meta.url),refresh=require('../maintenance/blower-unified-refresh.js');
const ui=require('../maintenance/blower-fbhe1a-runtime-v1.js');

async function state(f){return (await history.loadAssetStates(f.db,{},{assetRows:[f.asset()]}))[0];}
function identity(f,e){const a=f.asset();return {tagNumber:TAG,eventId:e.id,expectedEventUpdatedAt:e.updated_at,
  expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartRevision:a.cycle_start_revision,
  expectedCycleRuntimeRevision:a.cycle_runtime_revision};}
function assertEquivalent(a,seconds){
  assert.equal(a.runtimeCoverageEvidence.measurementVerified,true);
  assert.equal(a.runtimeCoverageEvidence.durationEquivalent,true);
  assert.equal(a.runtimeCoverageEvidence.durationVerified,true);
  assert.equal(a.runtimeCoverageEvidence.completionClockKnown,false);
  assert.equal(a.runtimeCoverageEvidence.wholeCycleVerified,false);
  assert.equal(a.runtimeCoverageEvidence.cycleBasisConfirmed,false);
  assert.equal(a.actualLastReplacementAt,'');
  assert.equal(a.cycleBasisKind,'replacement_runtime_equivalent');
  assert.equal(a.dataParcRuntimeBasis.runningSeconds,seconds);
  assert.deepEqual(a.fbhe1aRuntimeProof,a.dataParcRuntimeBasis.fbhe1aRuntime);
  assert.deepEqual(a.runtimeCoverageEvidence.fbhe1aRuntime,a.fbhe1aRuntimeProof);
  assert.equal(a.runRuntime.verified,true);
  assert.equal(a.cycleSourceReview,undefined);
  assert.ok(refresh.verifiedFbhe1aRuntime(a),'real server projection must pass the browser proof check');
  assert.equal(refresh.runReviewStatus(a),null);
  assert.doesNotMatch(JSON.stringify(a),/fbhe1aSourceGuards|siloSourceGuards|result_json|SELECT 1 FROM/);
}
test('current projection verifies duration while preserving unknown physical completion and legacy state',async t=>{
  const f=await createFbhe1aRuntimeFixture(t),before=f.asset(),applied=await f.apply(await f.ready()),current=await state(f);
  assertEquivalent(current,99960);
  assert.ok(ui.verifyReadback(current,applied));
  assert.equal(f.asset().last_replacement_at,START);
  assert.equal(f.asset().cycle_start_state,'legacy');
  assert.equal(f.asset().cycle_started_at,null);
  assert.equal(f.asset().runtime_hours,99960/3600);
  assert.equal(f.events().find(e=>e.id===OWNER).source_type,'manual');
  assert.equal(before.cycle_runtime_hours,100000/3600);
});
test('normal append keeps duration evidence and current source drift restores review without resetting the counter',async t=>{
  const f=await createFbhe1aRuntimeFixture(t),applied=await f.apply(await f.ready());await ordinaryAppend(f);
  const current=await state(f);assertEquivalent(current,99970);assert.ok(ui.verifyReadback(current,applied));
  f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BCO1'").run();
  const a=await state(f);
  assert.equal(a.dataParcRuntimeBasis,null);
  assert.equal(a.runtimeCoverageEvidence.durationEquivalent,undefined);
  assert.equal(a.runtimeCoverageEvidence.measurementVerified,false);
  assert.equal(a.cycleSourceReview.code,'FBHE1A_RUNTIME_SOURCE_CHANGED');
  assert.equal(f.asset().cycle_runtime_hours,99970/3600);
});
test('source changing after append validation rolls back the entire update and preserves prior audit and total',async t=>{
  const f=await createFbhe1aRuntimeFixture(t);await f.apply(await f.ready());
  assert.ok(await loadAppendBase(f.db,f.asset(),SIGNAL));
  const before=JSON.stringify([f.asset(),f.events(),f.sql.prepare('SELECT * FROM blower_history_asset_history ORDER BY id').all()]);
  let raced=false;
  f.db.beforeBatch=sql=>{raced=true;sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BCO1'").run();};
  await assert.rejects(ordinaryAppend(f));
  assert.equal(raced,true,'the test must reach the guarded mutation transaction');
  assert.equal(JSON.stringify([f.asset(),f.events(),f.sql.prepare('SELECT * FROM blower_history_asset_history ORDER BY id').all()]),before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
});
test('an ordinary full query cannot restore pre-replacement RUN into a recovered counter',async t=>{
  const f=await createFbhe1aRuntimeFixture(t);await f.apply(await f.ready());const a=f.asset();
  const collected=new Date(f.now.getTime()+5000).toISOString();
  const endAt=buildBlowerRuntimeProbeChunks(START,collected).at(-1).endAt;
  const intent={request_id:'crafted-full',reuse_key:'crafted-full',schema_version:1,asset_tag:TAG,dataparc_tag:SIGNAL,
    window_start:START,window_end:endAt,chunk_days:31,
    chunk_count:buildBlowerRuntimeProbeChunks(START,endAt).length,
    expected_last_replacement_at:a.last_replacement_at,expected_cycle_start_state:'legacy',expected_cycle_started_at:'',
    expected_cycle_start_revision:a.cycle_start_revision,expected_cycle_runtime_revision:a.cycle_runtime_revision,
    created_at:collected,updated_at:collected};
  f.addRequest(intent,probeResult(intent,collected,100000),collected);
  const before=JSON.stringify([f.asset(),f.events()]);
  const out=await history.applyDataParcRuntimeSync(f.db,f.user,{requestId:intent.request_id},{now:new Date(f.now.getTime()+6000)});
  assert.equal(out.status,409);assert.equal((await out.json()).code,'FBHE1A_RUNTIME_EVIDENCE_PROTECTED');
  assert.equal(JSON.stringify([f.asset(),f.events()]),before);
});
test('authenticated generic edits, deletes and resets cannot destroy a recovered first RUN certificate',async t=>{
  const f=await createFbhe1aRuntimeFixture(t);await f.apply(await f.ready());
  const selected=f.events().filter(e=>['runtime_correction','replacement'].includes(e.event_type));
  for(const e of selected)for(const action of ['history_event_edit','history_event_delete_preview','history_event_delete','runtime_event_edit']){
    const before=JSON.stringify([f.asset(),f.events()]);
    const out=await publicHistory(f,{action,...identity(f,e),eventType:'problem',eventDate:e.event_date,
      runtimeHours:0,note:'Fixture edit',changeNote:'Fixture correction',confirmDelete:true,previewToken:'a'.repeat(64)});
    assert.equal(out.status,409,JSON.stringify(out.body));
    assert.equal(out.body.code,'FBHE1A_RUNTIME_EVIDENCE_PROTECTED');
    assert.equal(JSON.stringify([f.asset(),f.events()]),before);
  }
  for(const action of ['runtime','startup']){
    const a=f.asset(),before=JSON.stringify(a),out=await publicHistory(f,{action,tagNumber:TAG,runtimeHours:0,
      eventDate:new Date(f.now.getTime()-1000).toISOString(),replacementAt:START,evidence:'Fixture exact completion source',
      expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartRevision:a.cycle_start_revision,
      expectedCycleRuntimeRevision:a.cycle_runtime_revision});
    assert.equal(out.status,409,JSON.stringify(out.body));
    assert.equal(out.body.code,'FBHE1A_RUNTIME_EVIDENCE_PROTECTED');
    assert.equal(JSON.stringify(f.asset()),before);
  }
});
test('a problem note remains editable and a genuine later replacement starts the next cycle',async t=>{
  const f=await createFbhe1aRuntimeFixture(t);await f.apply(await f.ready());
  const note=f.addEvent({id:'fixture-note',event_type:'problem',event_date:f.end,source_type:'manual',source_text:'Inspection',action_type:'점검'});
  const edited=await publicHistory(f,{action:'history_event_edit',...identity(f,note),eventType:'problem',
    eventDate:f.end,runtimeHours:0,issueType:'점검',actionType:'점검',note:'점검 내용 정정',changeNote:'Fixture note edit'});
  assert.equal(edited.status,200,JSON.stringify(edited.body));
  assert.ok(await loadAppendBase(f.db,f.asset(),SIGNAL));
  const cert=f.events().find(e=>e.source_type==='dataparc_fbhe1a_runtime_v1');
  const out=await publicHistory(f,{action:'replacement',tagNumber:TAG,eventDate:new Date(f.now.getTime()-3600000).toISOString()});
  assert.equal(out.status,200,JSON.stringify(out.body));
  assert.ok(!f.asset().cycle_start_revision.startsWith('fbhe1a-runtime-v1:'));
  const protectedCert=await publicHistory(f,{action:'history_event_delete_preview',...identity(f,cert)});
  assert.equal(protectedCert.status,409);
  assert.equal(protectedCert.body.code,'FBHE1A_RUNTIME_EVIDENCE_PROTECTED');
});
