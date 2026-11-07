import test from 'node:test';
import assert from 'node:assert/strict';
import {R9_SIGNAL_MAP,r9Window,r9VerifiedSavedSignal,verifyR9Periods} from '../functions/_shared/blower-r9-signal-v1.js';
import {r7EvidencePlan,validateR7RequestBody} from '../functions/_shared/blower-r7-evidence.js';
const now=new Date('2026-11-07T16:00:00+09:00'),day='2026-09-19';
const mode=tag=>'r9_signal_v1:'+tag+':'+day.replaceAll('-','');
const asset=(tag,type,unit)=>({tag_number:tag,blower_type:type,unit_no:unit,enabled:1,last_replacement_at:'2026-10-10T00:00:00+09:00',cycle_runtime_revision:'r9-test',cycle_start_revision:'start-test',cycle_start_state:'pending',cycle_runtime_hours:20,runtime_hours:20});
const tag='203HRJ01AN601',a=asset(tag,'limestone','2');
function receipt(periods,seconds=12600){const r=r9Window(mode(tag),a,now);
 const data={schemaVersion:1,requestType:'blower_runtime_probe',requestId:'r9-test-request-id',ok:true,readOnly:true,
 assetTag:tag,dataParcTag:r.signal,startAt:r.startAt,endAt:r.endAt,observedAt:r.endAt,
 expectedCycleRuntimeRevision:'r7-evidence-only-v1:r9_signal_v1:r9-test',
 startState:'stopped',endState:'stopped',runningSeconds:seconds,chunkCount:1,completedChunkCount:1,
 chunks:[{index:1,startAt:r.startAt,endAt:r.endAt,startState:'stopped',endState:'stopped',
 runningSeconds:seconds,runPeriods:periods,eventSource:'dataparc_fnValTime_intervals_v1'}]};return data;}
const periods=[{startAt:'2026-09-19T08:00:00+09:00',endAt:'2026-09-19T10:30:00+09:00',startKind:'start_signal',endKind:'stop_signal'},
 {startAt:'2026-09-19T13:00:00+09:00',endAt:'2026-09-19T14:00:00+09:00',startKind:'start_signal',endKind:'stop_signal'}];
test('R9 catalog has exactly 27 unique signal pairs including special silo B',()=>{
 assert.equal(Object.keys(R9_SIGNAL_MAP).length,27);
 assert.equal(new Set(Object.values(R9_SIGNAL_MAP).map(x=>x.signal)).size,27);
 assert.equal(R9_SIGNAL_MAP['104ETH03AN602'].signal,'GSPOGE.ABB_DCS.003ETH03AN602XB04');
 assert.equal(R9_SIGNAL_MAP['203HRJ01AN601'].signal,'GSPOGE.ABB_DCS.203HRJ01AN601XB04');
});
test('R9 fixed date, old window, and identity controls',()=>{
 const p=r9Window(mode(tag),a,now);assert.equal(p.startAt,'2026-09-19T00:00:00+09:00');
 assert.equal(p.endAt,'2026-09-20T00:00:00+09:00');assert.equal(p.r9History,true);
 assert.equal(r9Window(mode(tag),{...a,unit_no:'1'},now),null);
 assert.equal(r9Window(mode(tag),{...a,blower_type:'fbhe'},now),null);
 assert.equal(r9Window(mode(tag),{...a,enabled:0},now),null);
 assert.equal(r9Window('r9_signal_v1:'+tag+':20261107',a,now),null);
 assert.equal(r9Window('r9_signal_v1:'+tag+':20260230',a,now),null);
 assert.equal(r9Window('r9_signal_v1:'+tag+':20250919',a,now),null);
 assert.equal(r9Window('r9_signal_v1:104ETH03AN601:20260919',a,now),null);
});
test('R9 uses R7 safe request policy and denies non-super administrators',()=>{
 const p=r7EvidencePlan(mode(tag),a,{role:'super_admin'},now);assert.equal(p.readOnly,true);
 assert.throws(()=>r7EvidencePlan(mode(tag),a,{role:'BO2'},now),{code:'R7_FORBIDDEN'});
 const body={action:'create_blower_runtime_probe',r7EvidenceMode:mode(tag),unifiedRefresh:true,
  incrementalRefresh:false,requireIncrementalAppend:false,assetTag:tag,dataParcTag:p.signal,
  confirmRunSignal:true,startAt:p.startAt,expectedLastReplacementAt:a.last_replacement_at,
  expectedCycleStartState:'pending',expectedCycleStartedAt:'',expectedCycleStartRevision:a.cycle_start_revision,
  expectedCycleRuntimeRevision:a.cycle_runtime_revision};
 assert.equal(validateR7RequestBody(body,p,a),true);
 for(const change of [{dataParcTag:'GSPOGE.ABB_DCS.WRONG'},{incrementalRefresh:true},{startAt:'2026-09-20T00:00:00+09:00'},
    {expectedCycleRuntimeRevision:'tampered'},{requireIncrementalAppend:true}])
 assert.throws(()=>validateR7RequestBody({...body,...change},p,a),{code:'R7_REQUEST_CONFLICT'});
});
test('R9 verified fnValTime intervals yield exact 3h30m and do not reset existing belt cycle',()=>{
 const result=verifyR9Periods(receipt(periods),'r9-test-request-id',tag,day);
 assert.equal(result.ok,true);assert.equal(result.runSeconds,12600);assert.equal(result.periods.length,2);
 assert.equal(a.cycle_runtime_hours,20);
});
test('R9 rejects fabricated, overlapping, unordered, boundary, or incomplete periods',()=>{
 const invalid=[
  [periods[0],{...periods[1],startAt:'2026-09-19T10:00:00+09:00'}],
  [...periods].reverse(),
  [{...periods[0],startKind:'window_boundary'},periods[1]],
  [],
  [{...periods[0],endAt:'2026-09-19T11:00:00+09:00'},periods[1]]
 ];
 for(const sample of invalid.slice(1)) assert.equal(verifyR9Periods(receipt(sample),'r9-test-request-id',tag,day).ok,false);
 assert.equal(verifyR9Periods(receipt(periods,12601),'r9-test-request-id',tag,day).ok,true); // 1s sentinel tolerance
 assert.equal(verifyR9Periods(receipt(periods,12610),'r9-test-request-id',tag,day).ok,false);
 const noQuality=receipt(periods);noQuality.chunks[0].eventSource='synthetic';assert.equal(verifyR9Periods(noQuality,'r9-test-request-id',tag,day).ok,false);
 const badRevision=receipt(periods);badRevision.expectedCycleRuntimeRevision='r7-evidence-only-v1:old';
 assert.equal(verifyR9Periods(badRevision,'r9-test-request-id',tag,day).ok,false);
});
test('R9 recognizes genuine continuing RUN at the date window boundary',()=>{
 const start='2026-09-19T00:00:00+09:00',stop='2026-09-19T01:00:00+09:00';
 const r=receipt([{startAt:start,endAt:stop,startKind:'window_boundary',endKind:'stop_signal'}],3600);
 r.startState=r.chunks[0].startState='running';
 const proof=verifyR9Periods(r,'r9-test-request-id',tag,day);
 assert.equal(proof.ok,true);assert.equal(proof.periods[0].startKind,'window_boundary');
});

test('R9 requires last authentic saved DataPARC RUN source: no guess from equipment TAG',()=>{
 const source=(signal)=>({id:'dataparc_runtime:00000000-0000-4000-8000-000000000123',tag_number:tag,
  event_type:'runtime_correction',source_type:'dataparc_runtime',
  source_log_id:'00000000-0000-4000-8000-000000000123',created_at:'2026-11-07T10:00:00Z',updated_at:'2026-11-07T10:00:00Z',
  source_text:JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',requestId:'00000000-0000-4000-8000-000000000123',
    assetTag:tag,dataParcTag:signal})});
 const expected=R9_SIGNAL_MAP[tag].signal;
 assert.equal(r9VerifiedSavedSignal([source(expected)],tag,expected).ok,true);
 assert.equal(r9VerifiedSavedSignal([source('GSPOGE.ABB_DCS.WRONG')],tag,expected).ok,false);
 assert.equal(r9VerifiedSavedSignal([],tag,expected).ok,false);
 assert.equal(r9VerifiedSavedSignal([{...source(expected),updated_at:'2026-11-07T11:00:00Z'}],tag,expected).ok,false);
 assert.equal(r9VerifiedSavedSignal([{...source(expected),id:'unverified'}],tag,expected).ok,false);
 assert.equal(r9VerifiedSavedSignal([source(expected)],tag,'GSPOGE.ABB_DCS.WRONG').ok,false);
});
