import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../maintenance/blower-unified-refresh.js');
const assessor=require('../maintenance/blower-runtime-assessment.js');
const TAG='204HHL60AP631', SIGNAL=`GSPOGE.ABB_DCS.${TAG}XB04`;
const START='2026-09-16T00:23:00.000Z', END='2026-09-16T15:00:00.000Z';
const TAIL='2026-09-16T00:30:00.000Z', OBSERVED='2026-11-06T15:01:15.000Z';
const NOW='2026-11-07T01:30:00.000Z', HASH='a'.repeat(64);
function asset(){
  return {tagNumber:TAG,displayName:'#2 FBHE Blower #C',blowerType:'fbhe',enabled:true,
    lastReplacementAt:'2026-09-16T00:00:00+09:00',actualLastReplacementAt:'',cycleStartState:'pending',cycleStoredStartedAt:'',
    cycleStartRevision:'owner-start',cycleRuntimeRevision:'owner-runtime',cycleRuntimeAnchorAt:OBSERVED,
    cycleRuntimeState:'running',dataParcTag:SIGNAL,cycleElapsedHours:734,runtimeHours:734,
    measurementRequired:false,hasUnverifiedDataParcHistory:false,
    dataParcRuntimeBasis:{requestId:'tail-request',dataParcTag:SIGNAL,startAt:TAIL,observedAt:OBSERVED,
      requiredStartAt:'2026-09-16T00:00:00+09:00',runtimeHours:734,runningSeconds:734*3600,
      appendReady:true,coverageComplete:false,cycleBasisConfirmed:false},
    runtimeCoverageEvidence:{version:1,source:'dataparc',measurementVerified:true,requestId:'tail-request',
      hours:734,startAt:TAIL,observedAt:OBSERVED,coverageComplete:false,missingLeadingSeconds:34200},
    runRuntime:{verified:true,source:'dataparc',state:'running',measuredAt:OBSERVED},
    replacementAutoCycle:{schemaVersion:3,normalizationVersion:4,clockKnown:false,timePrecision:'day',
      registeredBaseline:true,registeredRuntimeRange:true,sourceLogId:'approved-sep16-BO2',sourceSnapshotSha256:HASH},
    cycleSourceReview:{code:'VERIFIED_RUNTIME_RANGE',cycleBasisConfirmed:false,measuredRangeMayContinue:true},
    completionWindowRecovery:{version:1,eligible:true,startAt:START,endAt:END,windowStartAt:START,windowEndAt:END,dataParcTag:SIGNAL}};
}
function certified(a=asset()){
  delete a.completionWindowRecovery;delete a.cycleSourceReview;
  Object.assign(a.runtimeCoverageEvidence,{durationEquivalent:true,durationVerified:true,coverageComplete:true,missingLeadingSeconds:0,
    completionClockKnown:false,completionWindowCertificateId:'zero-certificate'});
  a.completionWindowProof={version:1,kind:'completion_window_zero',durationVerified:true,completionClockKnown:false,
    certificateOnly:true,dataParcTag:SIGNAL,cycleStartRevision:a.cycleStartRevision,
    windowStartAt:START,windowEndAt:END,certificateEventId:'zero-certificate',requestId:'accepted-zero',
    runtimeRequestId:'tail-request',runtimeRevision:a.cycleRuntimeRevision,baseEventId:'tail-event',
    sourceLogId:a.replacementAutoCycle.sourceLogId,sourceSnapshotSha256:HASH};
  return a;
}
function scenario(a=asset(),config={}){
  const source=core.plan([a],new Date(NOW)).tasks,calls=[];let current=a,checkpoint=null,clock=0;
  const io={currentAssetFor:()=>current,clock:()=>clock,sleep:async ms=>{clock+=ms;},assertWritable(){},
    runtimeCheckpoint(v){checkpoint=structuredClone(v);},async api(request){
      calls.push(structuredClone(request));
      if(request.body?.action==='create_blower_runtime_probe_batch')return {ok:true,atomic:true,batchVersion:1,requestedCount:1,
        results:[{ok:true,assetTag:TAG,item:{id:'accepted-zero',status:'pending',requestType:'blower_runtime_probe',probe:{assetTag:TAG,requestId:'accepted-zero'}}}]};
      if(request.url?.includes('action=status_batch'))return {items:[{id:'accepted-zero',status:config.wait?'processing':'complete'}]};
      if(request.body?.action==='apply_completion_window_runtime_recovery'){
        if(config.fail)throw Object.assign(new Error('해당 구간의 운전 기록이 있어 완료시각 확인이 필요합니다.'),{status:409});
        current=certified(structuredClone(current));
        return {ok:true,applied:true,requestId:'accepted-zero',assetTag:TAG,dataParcTag:SIGNAL,runtimeHours:734,
          observedAt:OBSERVED,completionWindowRecovery:true,certificateOnly:true,verifiedWindowStartAt:START,verifiedWindowEndAt:END,...config.reply};
      }
      throw new Error('Unexpected request '+JSON.stringify(request));
    }};
  return {source,calls,io,run:()=>core.executeDataParcBatch(source,io),get checkpoint(){return checkpoint;},get current(){return current;}};
}
test('a current eligible FBHE2C gets exactly one fixed historical zero-window task, not a second append',()=>{
  const a=asset(),before=structuredClone(a),plan=core.plan([a],new Date(NOW));
  assert.equal(plan.tasks.length,1);assert.equal(plan.skipped.length,0);
  assert.deepEqual(core.runtimeRecoveryPlan(a,NOW),{recoveryMode:'completion_window_zero',startAt:START,endAt:END,dataParcTag:SIGNAL});
  assert.equal(plan.tasks[0].kind,'dataparc_repair');assert.equal(plan.tasks[0].incremental,false);assert.deepEqual(a,before);
});
test('historical candidate mismatch or stale current receipt cannot schedule a zero proof',()=>{
  for(const change of [a=>{a.completionWindowRecovery.endAt=NOW;},a=>{a.completionWindowRecovery.windowStartAt=TAIL;},
    a=>{a.completionWindowRecovery.dataParcTag='foreign';},a=>{a.cycleStartState='started';},a=>{a.replacementAutoCycle.clockKnown=true;},
    a=>{a.dataParcRuntimeBasis.requestId='different';},a=>{a.runtimeCoverageEvidence.hours=0;},a=>{a.runRuntime.source='manual';}]){
    const a=asset();change(a);assert.equal(core.runtimeRecoveryPlan(a,NOW),null,String(change));
  }
});
test('zero-window execution uses the fixed endpoint and certificate action, retaining actual hours and latest time',async()=>{
  const f=scenario(),result=await f.run();
  assert.equal(result[0].status,'complete');assert.equal(result[0].recoveryApplied,true);
  const item=f.calls.find(r=>r.body?.action==='create_blower_runtime_probe_batch').body.requests[0];
  assert.equal(item.completionWindowRecovery,true);assert.equal(item.startAt,START);assert.equal(item.endAt,END);
  assert.equal(item.incrementalRefresh,false);assert.equal(item.requireIncrementalAppend,false);
  assert.equal(f.calls.some(r=>r.body?.action==='dataparc_runtime_sync'),false);
  assert.equal(f.current.cycleElapsedHours,734);assert.equal(f.current.cycleRuntimeAnchorAt,OBSERVED);
  assert.equal(f.current.lastReplacementAt,'2026-09-16T00:00:00+09:00');assert.equal(f.current.actualLastReplacementAt,'');
});
test('a nonzero window rejection leaves current basis and duration under review',async()=>{
  const a=asset(),before=structuredClone(a),f=scenario(a,{fail:true}),result=await f.run();
  assert.equal(result[0].status,'failed');assert.deepEqual(f.current,before);assert.ok(core.runReviewStatus(f.current));
});
test('unconfirmed certificate response never counts as repaired',async()=>{
  for(const reply of [{certificateOnly:false},{verifiedWindowEndAt:NOW},{runtimeHours:735},{observedAt:END},{completionWindowRecovery:false}]){
    const f=scenario(asset(),{reply}),result=await f.run();assert.notEqual(result[0].status,'complete');
    assert.equal(result[0].recoveryApplied,undefined);
  }
});
test('resuming a timed-out zero query retains its exact fixed window and accepted ID',async()=>{
  const f=scenario(asset(),{wait:true}),result=await f.run();assert.equal(result[0].status,'waiting');
  const checkpoint=f.checkpoint;assert.equal(checkpoint.tasks[0].endAt,END);assert.equal(checkpoint.createdBatch.results[0].recoveryMode,'completion_window_zero');
  const resumed=scenario();resumed.io.runtimeResume=checkpoint;
  const out=await resumed.run();assert.equal(out[0].status,'complete');
  assert.equal(resumed.calls.some(r=>r.body?.action==='create_blower_runtime_probe_batch'),false);
});
test('verified current proof clears duration review while the physical completion clock remains unknown',()=>{
  const a=certified();assert.ok(core.verifiedCompletionWindow(a));assert.equal(core.runReviewStatus(a),null);
  assert.equal(core.fbheSealRunView(a).verified,true);assert.equal(core.fbheSealRunView(a).partial,undefined);
  const assessment=assessor.assess({tagNumber:TAG,hours:734,provenance:'measured',durationEquivalent:true,
    wholeCycleVerified:false,coverage:{complete:true,startAt:TAIL,observedAt:OBSERVED,missingLeadingSeconds:0},review:null});
  assert.equal(assessment.requiresReview,false);assert.equal(assessment.scope,'cycle-equivalent');assert.equal(assessment.scopeLabel,'교체 후 누적');
  assert.equal(assessment.wholeCycleVerified,false);assert.equal(a.replacementAutoCycle.clockKnown,false);
  const plan=core.plan([a],new Date(NOW));assert.equal(plan.tasks.length,1);assert.equal(plan.tasks[0].kind,'dataparc');assert.equal(plan.tasks[0].incremental,true);
});
test('a stale, unlinked, changed-source or manual-owned certificate cannot hide a review',()=>{
  for(const change of [a=>{a.completionWindowProof.runtimeRevision='old';},a=>{a.completionWindowProof.runtimeRequestId='other';},
    a=>{a.completionWindowProof.cycleStartRevision='old';},a=>{a.completionWindowProof.dataParcTag='foreign';},
    a=>{a.completionWindowProof.certificateOnly=false;},a=>{a.runtimeCoverageEvidence.completionWindowCertificateId='other';},
    a=>{a.runtimeCoverageEvidence.completionClockKnown=true;},
    a=>{a.completionWindowProof.windowStartAt=TAIL;},a=>{a.completionWindowProof.completionClockKnown=true;},
    a=>{a.replacementAutoCycle.sourceSnapshotSha256='b'.repeat(64);},a=>{a.runtimeCoverageEvidence.durationEquivalent=false;},
    a=>{a.runtimeCoverageEvidence.hours=NaN;},a=>{a.cycleRuntimeAnchorAt=NOW;},a=>{a.runRuntime.source='manual';},
    a=>{a.cycleSourceReview={code:'SOURCE_CHANGED'};},a=>{a.actualLastReplacementAt=START;}]){
    const a=certified();change(a);assert.equal(core.verifiedCompletionWindow(a),null,String(change));assert.ok(core.runReviewStatus(a));
  }
});
test('a fresh server projection can recognize the already committed certificate by the same accepted ID',()=>{
  const task=core.plan([asset()],new Date(NOW)).tasks[0],a=certified();
  assert.equal(core.recognizedRuntimeRecovery(task,a,'accepted-zero'),true);
  assert.equal(core.recognizedRuntimeRecovery(task,a,'different-request'),false);
});
