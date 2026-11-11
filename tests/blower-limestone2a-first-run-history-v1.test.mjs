import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {loadAppendBase} from '../functions/_shared/blower-incremental.js';
import {createLimestone2aFixture,ordinaryAppend,publicHistory,TAG,SIGNAL,START,OWNER} from './helpers/blower-limestone2a-fixture-v1.mjs';
const require=createRequire(import.meta.url),refresh=require('../maintenance/blower-unified-refresh.js');
const ui=require('../maintenance/blower-limestone2a-first-run-v1.js');

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
  assert.equal(a.cycleBasisKind,'replacement_first_run_equivalent');
  assert.equal(a.dataParcRuntimeBasis.runningSeconds,seconds);
  assert.deepEqual(a.limestone2aFirstRunProof,a.dataParcRuntimeBasis.limestone2aFirstRun);
  assert.deepEqual(a.runtimeCoverageEvidence.limestone2aFirstRun,a.limestone2aFirstRunProof);
  assert.equal(a.runRuntime.verified,true);
  assert.equal(a.cycleSourceReview,undefined);
  assert.ok(refresh.verifiedLimestone2aFirstRun(a),'real server projection must pass the browser proof check');
  assert.equal(refresh.runReviewStatus(a),null);
  assert.doesNotMatch(JSON.stringify(a),/limestone2aSourceGuards|siloSourceGuards|result_json|SELECT 1 FROM/);
}
test('current projection verifies duration while preserving unknown physical completion and pending state',async t=>{
  const f=await createLimestone2aFixture(t),before=f.asset(),applied=await f.apply(await f.status()),current=await state(f);
  assertEquivalent(current,54094);
  assert.ok(ui.verifyReadback(current,applied));
  assert.equal(f.asset().last_replacement_at,START);
  assert.equal(f.asset().cycle_start_state,'pending');
  assert.equal(f.asset().cycle_started_at,null);
  assert.equal(f.asset().runtime_hours,54094/3600);
  assert.equal(f.events().find(e=>e.id===OWNER).updated_at,f.events().find(e=>e.id===OWNER).created_at);
  assert.equal(before.cycle_runtime_hours,1);
});
test('normal append keeps duration evidence and current source drift restores review without resetting the counter',async t=>{
  const f=await createLimestone2aFixture(t),applied=await f.apply(await f.status());await ordinaryAppend(f);
  const current=await state(f);assertEquivalent(current,54104);assert.ok(ui.verifyReadback(current,applied));
  f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BO2'").run();
  const a=await state(f);
  assert.equal(a.dataParcRuntimeBasis,null);
  assert.equal(a.runtimeCoverageEvidence.durationEquivalent,undefined);
  assert.equal(a.runtimeCoverageEvidence.measurementVerified,false);
  assert.equal(a.cycleSourceReview.code,'LIMESTONE2A_FIRST_RUN_SOURCE_CHANGED');
  assert.equal(f.asset().cycle_runtime_hours,54104/3600);
});
test('source changing after append validation rolls back the entire update and preserves prior audit and total',async t=>{
  const f=await createLimestone2aFixture(t);await f.apply(await f.status());
  const before=JSON.stringify([f.asset(),f.events(),f.sql.prepare('SELECT * FROM blower_history_asset_history ORDER BY id').all()]);
  f.db.beforeBatch=sql=>sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BO2'").run();
  await assert.rejects(ordinaryAppend(f));
  assert.equal(JSON.stringify([f.asset(),f.events(),f.sql.prepare('SELECT * FROM blower_history_asset_history ORDER BY id').all()]),before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
});
test('authenticated generic edits, deletes and resets cannot destroy a recovered first RUN certificate',async t=>{
  const f=await createLimestone2aFixture(t);await f.apply(await f.status());
  const selected=f.events().filter(e=>['runtime_correction','replacement'].includes(e.event_type));
  for(const e of selected)for(const action of ['history_event_edit','history_event_delete_preview','history_event_delete','runtime_event_edit']){
    const before=JSON.stringify([f.asset(),f.events()]);
    const out=await publicHistory(f,{action,...identity(f,e),eventType:'problem',eventDate:e.event_date,
      runtimeHours:0,note:'Fixture edit',changeNote:'Fixture correction',confirmDelete:true,previewToken:'a'.repeat(64)});
    assert.equal(out.status,409,JSON.stringify(out.body));
    assert.equal(out.body.code,'LIMESTONE2A_FIRST_RUN_EVIDENCE_PROTECTED');
    assert.equal(JSON.stringify([f.asset(),f.events()]),before);
  }
  for(const action of ['runtime','startup','limestone_basis_confirm']){
    const a=f.asset(),before=JSON.stringify(a),out=await publicHistory(f,{action,tagNumber:TAG,runtimeHours:0,
      eventDate:new Date(f.now.getTime()-1000).toISOString(),replacementAt:START,evidence:'Fixture exact completion source',
      expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartRevision:a.cycle_start_revision,
      expectedCycleRuntimeRevision:a.cycle_runtime_revision});
    assert.equal(out.status,409,JSON.stringify(out.body));
    assert.equal(out.body.code,'LIMESTONE2A_FIRST_RUN_EVIDENCE_PROTECTED');
    assert.equal(JSON.stringify(f.asset()),before);
  }
});
test('a problem note remains editable and a genuine later replacement starts the next cycle',async t=>{
  const f=await createLimestone2aFixture(t);await f.apply(await f.status());
  const note=f.addEvent({id:'fixture-note',event_type:'problem',event_date:f.end,source_type:'manual',source_text:'Inspection',action_type:'점검'});
  const edited=await publicHistory(f,{action:'history_event_edit',...identity(f,note),eventType:'problem',
    eventDate:f.end,runtimeHours:0,issueType:'점검',actionType:'점검',note:'점검 내용 정정',changeNote:'Fixture note edit'});
  assert.equal(edited.status,200,JSON.stringify(edited.body));
  assert.ok(await loadAppendBase(f.db,f.asset(),SIGNAL));
  const cert=f.events().find(e=>e.source_type==='dataparc_limestone2a_first_run_v1');
  const out=await publicHistory(f,{action:'replacement',tagNumber:TAG,eventDate:new Date(f.now.getTime()-3600000).toISOString()});
  assert.equal(out.status,200,JSON.stringify(out.body));
  assert.ok(!f.asset().cycle_start_revision.startsWith('lime2a-first-run-v1:'));
  const protectedCert=await publicHistory(f,{action:'history_event_delete_preview',...identity(f,cert)});
  assert.equal(protectedCert.status,409);
  assert.equal(protectedCert.body.code,'LIMESTONE2A_FIRST_RUN_EVIDENCE_PROTECTED');
});
