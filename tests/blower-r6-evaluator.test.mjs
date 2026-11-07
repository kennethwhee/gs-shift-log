import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateVerifiedRebaseline,R6_TARGET} from '../functions/_shared/blower-r6-evaluator.mjs';

const startAt='2026-07-24T00:00:00.000Z';
const cutoffAt='2026-11-06T15:01:00.000Z'; // Nov 7 00:01 KST
const endAt='2026-11-07T00:23:00.000Z'; // Nov 7 09:23 KST
const snapshotSha256='a'.repeat(64);
const baseline={tag:R6_TARGET.tag,signal:R6_TARGET.signal,actorId:'operator-2',cycleRevision:'revision-1',
  lastReplacementAt:'2026-07-24T00:00:00.000Z',lastState:'running',savedSeconds:4149227,
  failedAppendSeconds:32999,startAt,cutoffAt,endAt,snapshotSha256};
const makeRead=(requestId,begin,end,seconds,startState,endState,index)=>({
  requestId,requestType:'blower_runtime_probe',status:'complete',tag:R6_TARGET.tag,
  signal:R6_TARGET.signal,startAt:begin,endAt:end,runningSeconds:seconds,
  startState,endState,coverageComplete:true, contractValidated:true,badQualitySeconds:0,missingSeconds:0,
  estimatedSeconds:0,fromCachedResult:false,fromManualOverride:false,
  expectedRevision:baseline.cycleRevision,expectedReplacementAt:baseline.lastReplacementAt,
  requestedBy:baseline.actorId,requestCreatedAt:`2026-11-07T00:${String(25 + index - 10).padStart(2,'0')}:00.000Z`,
  completedAt:`2026-11-07T00:${String(25 + index - 10).padStart(2,'0')}:20.000Z`,
  observedAt:end,collectedAt:`2026-11-07T00:${String(25 + index - 10).padStart(2,'0')}:10.000Z`,
});
const fresh=()=>({fullA:makeRead('a',startAt,endAt,4182335,'running','running',10),
    fullB:makeRead('b',startAt,endAt,4182335,'running','running',11),
    prefix:makeRead('c',startAt,cutoffAt,4149336,'running','stopped',12),
    suffix:makeRead('d',cutoffAt,endAt,32999,'stopped','running',13)});
const run=(reads=fresh(),base=baseline,sha=snapshotSha256)=>evaluateVerifiedRebaseline({baseline:base,reads,freshSnapshotSha256:sha});

test('R6 109-second conflict can only become a human-reviewed proposal',()=>{
 const x=run();assert.equal(x.status,'requires_authorized_review');
 assert.equal(x.code,'R6_EVIDENCE_AGREES');assert.equal(x.totalDifferenceSeconds,109);
 assert.equal(x.historicalDifferenceSeconds,109);assert.equal(x.suffixDifferenceSeconds,0);
 assert.equal(x.proposedSeconds,4182335);assert.equal(x.authorizedToWrite,false);
 assert.equal(x.verifiedRequestIds.length,4);
});
test('R6 fails closed if independent full requery differs by more than 2 seconds',()=>{
 const reads=fresh();reads.fullB.runningSeconds+=3;assert.equal(run(reads).code,'R6_MEASUREMENT_CONFLICT');
});
test('R6 refuses a fake independent request or duplicated collection timestamp',()=>{
 const reads=fresh();reads.fullB.requestId='a';assert.equal(run(reads).code,'R6_NOT_INDEPENDENT');
 const reads2=fresh();reads2.fullB.requestCreatedAt=reads2.fullA.requestCreatedAt;
 assert.equal(run(reads2).code,'R6_NOT_INDEPENDENT');
});
test('R6 refuses mismatched boundary state and segment sums',()=>{
 const reads=fresh();reads.suffix.startState='running';assert.equal(run(reads).code,'R6_STATE_CONFLICT');
 const reads2=fresh();reads2.prefix.runningSeconds-=5;assert.equal(run(reads2).code,'R6_MEASUREMENT_CONFLICT');
});
test('R6 refuses missing, low quality, estimated or manually overridden measurements',()=>{
 for(const [field,value] of [['coverageComplete',false],['badQualitySeconds',1],['estimatedSeconds',9],['missingSeconds',60],['fromManualOverride',true],['fromCachedResult',true]]){
   const reads=fresh();reads.fullA[field]=value;assert.equal(run(reads).code,'R6_READ_INVALID',field);
 }
});
test('R6 enforces asset ID, tag, query window, original revision and immutable DB snapshot',()=>{
 assert.equal(run(fresh(),{...baseline,tag:'104SDF01AN001'}).code,'R6_BASE_INVALID');
 assert.equal(run(fresh(),baseline,'b'.repeat(64)).code,'R6_BASE_INVALID');
 for(const [field,value] of [['signal','wrong'],['expectedRevision','revision-new'],['endAt','2026-11-07T00:22:00.000Z'],['expectedReplacementAt','changed']]){
  const reads=fresh();reads.fullA[field]=value;assert.equal(run(reads).code,'R6_READ_INVALID',field);
 }
});
test('R6 never accepts a modified tolerance, negative duration or impossible full RUN',()=>{
 assert.equal(evaluateVerifiedRebaseline({baseline,reads:fresh(),freshSnapshotSha256:snapshotSha256,maxSampleDifferenceSeconds:110}).code,'R6_TOLERANCE_MODIFIED');
 const reads=fresh();reads.fullA.runningSeconds=999999999;assert.equal(run(reads).code,'R6_READ_INVALID');
 const reads2=fresh();reads2.suffix.runningSeconds=-1;assert.equal(run(reads2).code,'R6_READ_INVALID');
});
test('R6 returns no-correction-needed only when both full probes and split recomposition agree',()=>{
 const reads=fresh();reads.prefix.runningSeconds=baseline.savedSeconds;reads.fullA.runningSeconds=baseline.savedSeconds+baseline.failedAppendSeconds;reads.fullB.runningSeconds=reads.fullA.runningSeconds;
 const x=run(reads);assert.equal(x.status,'no_correction_needed');assert.equal(x.code,'R6_WITHIN_EXISTING_TOLERANCE');
});
