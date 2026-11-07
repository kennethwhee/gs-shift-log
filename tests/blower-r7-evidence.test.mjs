import test from 'node:test';
import assert from 'node:assert/strict';
import { R7_WINDOWS,R7_EVIDENCE_PREFIX,r7EvidencePlan,validateR7RequestBody,evaluateR7MeasuredResult } from '../functions/_shared/blower-r7-evidence.js';
const now = new Date('2026-11-07T12:38:00+09:00');
function asset(kind){const p=R7_WINDOWS[kind];return {
 tag_number:p.tag,blower_type:p.type,unit_no:p.unit,enabled:1,
 last_replacement_at:kind==='fbhe1b_zero'?'2026-10-08T00:00:00+09:00':'2026-09-20T00:00:00+09:00',
 cycle_runtime_hours:0,runtime_hours:0,cycle_runtime_state:'stopped',
 cycle_start_state:'pending',cycle_started_at:'',cycle_start_revision:'cycle-r1',cycle_runtime_revision:'run-r1'
}}
const su = {isSuperAdmin:true};
function item(kind, seconds=0){const p=R7_WINDOWS[kind],end=p.endAt||'2026-11-07T12:38:00+09:00',start=p.startAt;
  return {id:'request-1',status:'complete',requestType:'blower_runtime_probe',probe:{requestId:'request-1',assetTag:p.tag,dataParcTag:p.signal,
    startAt:start,endAt:end,chunkCount:1,expectedCycleRuntimeRevision:R7_EVIDENCE_PREFIX+'run-r1'},
    result:{schemaVersion:1,ok:true,readOnly:true,requestType:'blower_runtime_probe',requestId:'request-1',assetTag:p.tag,dataParcTag:p.signal,
     startAt:start,endAt:end,observedAt:end,startState:seconds?'running':'stopped',endState:seconds?'running':'stopped',
     expectedCycleRuntimeRevision:R7_EVIDENCE_PREFIX+'run-r1',runningSeconds:seconds,totalRunningHours:seconds/3600,
     chunkCount:1,completedChunkCount:1,chunks:[{index:1,startAt:start,endAt:end,startState:seconds?'running':'stopped',
        endState:seconds?'running':'stopped',runningSeconds:seconds,totalRunningHours:seconds/3600}]}};
}
for(const kind of Object.keys(R7_WINDOWS)){
 test(kind+' scoped candidate plan',()=>{const a=asset(kind),p=r7EvidencePlan(kind,a,su,now);assert.equal(p.readOnly,true);
  const b={r7EvidenceMode:kind,assetTag:p.tag,dataParcTag:p.signal,confirmRunSignal:true,
   unifiedRefresh:true,incrementalRefresh:false,requireIncrementalAppend:false,startAt:p.startAt,
   expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,
   expectedCycleStartedAt:a.cycle_started_at,expectedCycleStartRevision:a.cycle_start_revision,
   expectedCycleRuntimeRevision:a.cycle_runtime_revision};
  assert.equal(validateR7RequestBody(b,p,a),true);
  assert.throws(()=>validateR7RequestBody({...b,confirmedGapRecovery:true},p,a));
  assert.throws(()=>validateR7RequestBody({...b,startAt:'2026-09-18T00:00:00+09:00'},p,a));
  assert.throws(()=>validateR7RequestBody({...b,expectedCycleRuntimeRevision:'altered'},p,a));
  assert.throws(()=>r7EvidencePlan(kind,a,{isSuperAdmin:false},now));
  assert.throws(()=>r7EvidencePlan(kind,{...a,tag_number:'104ETH03AN601'},su,now));
 });
 test(kind+' result validation',()=>{const v=item(kind,0);const out=evaluateR7MeasuredResult(kind,v);assert.equal(out.ok,true);assert.equal(out.runningSeconds,0);
   assert.equal(out.zero,true);assert.equal(evaluateR7MeasuredResult(kind,item(kind,125)).runningSeconds,125);
   const d=structuredClone(v);d.result.readOnly=false;assert.equal(evaluateR7MeasuredResult(kind,d).ok,false);
   const s=structuredClone(v);s.result.chunks[0].endState='running';assert.equal(evaluateR7MeasuredResult(kind,s).ok,false);
   const g=structuredClone(v);g.result.runningSeconds=10;assert.equal(evaluateR7MeasuredResult(kind,g).ok,false);
   const e=structuredClone(v);e.probe.expectedCycleRuntimeRevision='run-r1';assert.equal(evaluateR7MeasuredResult(kind,e).ok,false);
   const t=structuredClone(v);t.result.chunks[0].startAt='2026-01-01T00:00:00+09:00';assert.equal(evaluateR7MeasuredResult(kind,t).ok,false);
 });
}
test('FBHE 1B changes to saved RUN are not silently reset',()=>{const a=asset('fbhe1b_zero');a.cycle_runtime_hours=0.1;
 assert.throws(()=>r7EvidencePlan('fbhe1b_zero',a,su,now));});
test('Limestone pre-baseline window is pinned exactly to Sep 19',()=>{const a=asset('limestone2a_leading');
 const p=r7EvidencePlan('limestone2a_leading',a,su,now);
 assert.equal(p.startAt,'2026-09-19T00:00:00+09:00');assert.equal(p.endAt,'2026-09-20T00:00:00+09:00');
 assert.equal(r7EvidencePlan('limestone2a_leading',{...a,last_replacement_at:'2026-09-19T00:00:00+09:00'},su,now).readOnly,true);});
test('R7 can never silently mark negative or missing samples as proven zero',()=>{const v=item('fbhe1b_zero',0);
 v.result.chunks=[];assert.equal(evaluateR7MeasuredResult('fbhe1b_zero',v).ok,false);
 v.result.chunks=[{...item('fbhe1b_zero',0).result.chunks[0],runningSeconds:-1}];
 assert.equal(evaluateR7MeasuredResult('fbhe1b_zero',v).ok,false);
});


test('limestone2a historical RUN read allows registered date drift but never weakens tag or write safeguards',()=>{
 for(const basis of ['2026-05-12T00:00:00+09:00','2026-09-19T00:00:00+09:00','2026-09-20T00:00:00+09:00']){
  const a={...asset('limestone2a_leading'),last_replacement_at:basis};
  const p=r7EvidencePlan('limestone2a_leading',a,su,now);
  assert.equal(p.startAt,'2026-09-19T00:00:00+09:00');
  assert.equal(p.endAt,'2026-09-20T00:00:00+09:00');
  assert.equal(p.readOnly,true);
  const body={r7EvidenceMode:p.mode,assetTag:p.tag,dataParcTag:p.signal,
   confirmRunSignal:true,unifiedRefresh:true,incrementalRefresh:false,
   requireIncrementalAppend:false,startAt:p.startAt,
   expectedLastReplacementAt:basis,expectedCycleStartState:a.cycle_start_state,
   expectedCycleStartedAt:a.cycle_started_at,
   expectedCycleStartRevision:a.cycle_start_revision,
   expectedCycleRuntimeRevision:a.cycle_runtime_revision};
  assert.equal(validateR7RequestBody(body,p,a),true);
  if(basis!=='2026-09-20T00:00:00+09:00')
   assert.throws(()=>validateR7RequestBody({...body,expectedLastReplacementAt:'2026-09-20T00:00:00+09:00'},p,a),{code:'R7_REQUEST_CONFLICT'});
  assert.throws(()=>validateR7RequestBody({...body,incrementalRefresh:true},p,a),{code:'R7_REQUEST_CONFLICT'});
 }
 const a=asset('limestone2a_leading');
 assert.throws(()=>r7EvidencePlan('limestone2a_leading',{...a,blower_type:'fbhe'},su,now),{code:'R7_ASSET_STATE_CHANGED'});
 assert.throws(()=>r7EvidencePlan('limestone2a_leading',{...a,enabled:0},su,now),{code:'R7_ASSET_DISABLED'});
 assert.throws(()=>r7EvidencePlan('limestone2a_leading',{...a,cycle_start_revision:''},su,now),{code:'R7_CYCLE_REVISION_MISSING'});
 assert.throws(()=>r7EvidencePlan('limestone2a_leading',{...a,last_replacement_at:''},su,now),{code:'R7_REPLACEMENT_BASIS_MISSING'});
 assert.throws(()=>r7EvidencePlan('limestone2a_leading',a,{role:'operator'},now),{code:'R7_FORBIDDEN'});
 const f=asset('fbhe1b_zero');
 assert.throws(()=>r7EvidencePlan('fbhe1b_zero',{...f,last_replacement_at:'2026-10-09T00:00:00+09:00'},su,now),{code:'R7_FHBE_DATE_CHANGED'});
});

test('R7 recognizes date-only work evidence without fabricating a completion minute',()=>{
 const a=asset('fbhe1b_zero'); a.last_replacement_at='2026-10-08';
 assert.equal(r7EvidencePlan('fbhe1b_zero',a,su,now).replacementDate,'2026-10-08');
 const b=asset('limestone2a_leading'); b.last_replacement_at='2026-09-20';
 assert.equal(r7EvidencePlan('limestone2a_leading',b,su,now).replacementDate,'2026-09-20');
 assert.equal(r7EvidencePlan('limestone2a_leading',{...b,last_replacement_at:'2026-09-19'},su,now).readOnly,true);
});
