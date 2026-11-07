import test from 'node:test';
import assert from 'node:assert/strict';
import {R8_ROOTS,R8_MODE_PREFIX,r8TimelineEntry,r8ClassifySlice,r8CompareChildren} from '../functions/_shared/blower-r8-timeline.js';
import {R7_EVIDENCE_PREFIX,r7EvidencePlan,validateR7RequestBody,evaluateR7MeasuredResult} from '../functions/_shared/blower-r7-evidence.js';
const now=new Date('2026-11-07T15:55:00+09:00');
const auth={role:'super_admin'};
const stamp=Date.parse;
function asset(mode){const p=r8TimelineEntry(mode);return {
 tag_number:p.tag,blower_type:p.type,unit_no:p.unit,enabled:1,
 last_replacement_at:p.r8Root.startsWith('fbhe')?'2026-10-08T00:00:00+09:00':'2026-09-20T00:00:00+09:00',
 cycle_runtime_hours:0,runtime_hours:0,cycle_runtime_state:'stopped',
 cycle_start_state:'pending',cycle_started_at:'',cycle_start_revision:'rev-start',cycle_runtime_revision:'rev-hours'
};}
function payload(mode,a=asset(mode)){const p=r7EvidencePlan(mode,a,auth,now);return {
 r7EvidenceMode:mode,unifiedRefresh:true,incrementalRefresh:false,requireIncrementalAppend:false,
 assetTag:p.tag,dataParcTag:p.signal,confirmRunSignal:true,startAt:p.startAt,
 expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,
 expectedCycleStartedAt:a.cycle_started_at,expectedCycleStartRevision:a.cycle_start_revision,
 expectedCycleRuntimeRevision:a.cycle_runtime_revision
};}
function item(mode,seconds=0){const p=r8TimelineEntry(mode),d=(stamp(p.endAt)-stamp(p.startAt))/1000;
 const st=seconds===0?'stopped':'running',en=st;
 return {id:'request-id',requestType:'blower_runtime_probe',status:'complete',probe:{requestId:'request-id',assetTag:p.tag,
 dataParcTag:p.signal,startAt:p.startAt,endAt:p.endAt,chunkCount:1,
 expectedCycleRuntimeRevision:R7_EVIDENCE_PREFIX+'rev-hours'},result:{schemaVersion:1,requestId:'request-id',
 requestType:'blower_runtime_probe',ok:true,readOnly:true,assetTag:p.tag,dataParcTag:p.signal,
 expectedCycleRuntimeRevision:R7_EVIDENCE_PREFIX+'rev-hours',startAt:p.startAt,endAt:p.endAt,observedAt:p.endAt,
 startState:st,endState:en,runningSeconds:seconds,totalRunningHours:seconds/3600,
 chunkCount:1,completedChunkCount:1,chunks:[{index:1,startAt:p.startAt,endAt:p.endAt,startState:st,endState:en,
 runningSeconds:seconds,totalRunningHours:seconds/3600}]}};
}
test('R8 fixed roots and valid hierarchical windows never accept arbitrary tags/dates',()=>{
 for(const key of Object.keys(R8_ROOTS)){
  const root=r8TimelineEntry(R8_MODE_PREFIX+key+':');assert.equal(root.r8Root,key);
  assert.equal(root.readOnly,true);
  assert.equal(root.startAt,R8_ROOTS[key].startAt);assert.equal(root.endAt,R8_ROOTS[key].endAt);
  const a=r8TimelineEntry(R8_MODE_PREFIX+key+':0'),b=r8TimelineEntry(R8_MODE_PREFIX+key+':1');
  assert.equal(Date.parse(a.startAt),Date.parse(root.startAt));assert.equal(Date.parse(a.endAt),Date.parse(b.startAt));
  assert.equal(Date.parse(b.endAt),Date.parse(root.endAt));
  assert.equal((Date.parse(a.endAt)-Date.parse(a.startAt))+(Date.parse(b.endAt)-Date.parse(b.startAt)),Date.parse(root.endAt)-Date.parse(root.startAt));
 }
 for(const bad of [null,'',R8_MODE_PREFIX+'fbhe_workday:2',R8_MODE_PREFIX+'limestone_day:010201',
     R8_MODE_PREFIX+'limestone_day:00000000000000000',R8_MODE_PREFIX+'limestone_day:0000000000000000',
     'r8_timeline_v1:unlisted:0','r8_timeline_v1:fbhe_workday:0\n'])assert.equal(r8TimelineEntry(bad),null);
});
test('R8 remains administrator-only and freezes exact revision, tag, clock and signal',()=>{
 for(const key of Object.keys(R8_ROOTS)){
  const mode=R8_MODE_PREFIX+key+':01',a=asset(mode),p=r7EvidencePlan(mode,a,auth,now);
  assert.equal(p.startAt,r8TimelineEntry(mode).startAt);
  assert.equal(validateR7RequestBody(payload(mode,a),p,a),true);
  assert.throws(()=>r7EvidencePlan(mode,a,{role:'operator'},now),{code:'R7_FORBIDDEN'});
  assert.throws(()=>r7EvidencePlan(mode,{...a,tag_number:'BAD'},auth,now),{code:'R7_ASSET_STATE_CHANGED'});
  assert.throws(()=>validateR7RequestBody({...payload(mode,a),startAt:R8_ROOTS[key].startAt},p,a),{code:'R7_REQUEST_CONFLICT'});
  assert.throws(()=>validateR7RequestBody({...payload(mode,a),expectedCycleRuntimeRevision:'new'},p,a),{code:'R7_REQUEST_CONFLICT'});
  assert.throws(()=>validateR7RequestBody({...payload(mode,a),incrementalRefresh:true},p,a),{code:'R7_REQUEST_CONFLICT'});
  assert.throws(()=>validateR7RequestBody({...payload(mode,a),appendBoundaryRecovery:true},p,a),{code:'R7_REQUEST_CONFLICT'});
 }
});
test('R8 FBHE cannot run against changed replacement day and neither probe can change saved hours',()=>{
 const mode=R8_MODE_PREFIX+'fbhe_workday:0',a=asset(mode);
 assert.throws(()=>r7EvidencePlan(mode,{...a,last_replacement_at:'2026-10-09'},auth,now),{code:'R7_FHBE_DATE_CHANGED'});
 const m=R8_MODE_PREFIX+'limestone_day:0',l=asset(m);
 assert.equal(r7EvidencePlan(m,{...l,last_replacement_at:'2026-09-19'},auth,now).readOnly,true);
});
test('R8 validated R7-compatible read-only receipts and detects forged/missing chunks',()=>{
 for(const key of Object.keys(R8_ROOTS)){
  const mode=R8_MODE_PREFIX+key+':0',v=item(mode,647);
  assert.equal(evaluateR7MeasuredResult(mode,v).runningSeconds,647);
  const forged=structuredClone(v);forged.result.readOnly=false;
  assert.equal(evaluateR7MeasuredResult(mode,forged).ok,false);
  const wrong=structuredClone(v);wrong.result.chunks[0].endAt=wrong.result.startAt;
  assert.equal(evaluateR7MeasuredResult(mode,wrong).ok,false);
  const mismatch=structuredClone(v);mismatch.result.runningSeconds=648;
  assert.equal(evaluateR7MeasuredResult(mode,mismatch).ok,false);
  const missing=structuredClone(v);missing.result.chunks=[];
  assert.equal(evaluateR7MeasuredResult(mode,missing).ok,false);
 }
});
test('RUN zero, constant run and mixed intervals have distinct non-final classifications',()=>{
 const p=r8TimelineEntry(R8_MODE_PREFIX+'limestone_day:0');
 assert.equal(r8ClassifySlice({runningSeconds:0,startState:'stopped',endState:'stopped',startAt:p.startAt,endAt:p.endAt}).kind,'stopped');
 assert.equal(r8ClassifySlice({runningSeconds:43200,startState:'running',endState:'running',startAt:p.startAt,endAt:p.endAt}).kind,'running');
 assert.equal(r8ClassifySlice({runningSeconds:647,startState:'stopped',endState:'stopped',startAt:p.startAt,endAt:p.endAt}).kind,'mixed');
 assert.equal(r8ClassifySlice({runningSeconds:-1,startState:'stopped',endState:'stopped',startAt:p.startAt,endAt:p.endAt}).kind,'unknown');
});
test('Parent children cross-check fails closed on sum, gap and state discrepancy',()=>{
 const base=R8_MODE_PREFIX+'limestone_day:',p=r8TimelineEntry(base),l=r8TimelineEntry(base+'0'),r=r8TimelineEntry(base+'1');
 const parent={startAt:p.startAt,endAt:p.endAt,runningSeconds:50494,startState:'running',endState:'running'};
 const left={startAt:l.startAt,endAt:l.endAt,runningSeconds:20000,startState:'running',endState:'running'};
 const right={startAt:r.startAt,endAt:r.endAt,runningSeconds:30494,startState:'running',endState:'running'};
 assert.equal(r8CompareChildren(parent,left,right).ok,true);
 assert.equal(r8CompareChildren(parent,left,{...right,runningSeconds:30497}).ok,false);
 assert.equal(r8CompareChildren(parent,left,{...right,startState:'stopped'}).ok,false);
 assert.equal(r8CompareChildren(parent,left,{...right,startAt:p.startAt}).ok,false);
});
test('FBHE scope full bounded intervals cover both dated roots without crossing the original work day',()=>{
 const a=r8TimelineEntry(R8_MODE_PREFIX+'fbhe_workday:'),b=r8TimelineEntry(R8_MODE_PREFIX+'fbhe_after:');
 assert.equal(a.endAt,b.startAt);
 assert.equal(a.startAt,'2026-10-08T13:04:00+09:00');
 assert.equal(b.endAt,'2026-11-07T14:00:00+09:00');
});
