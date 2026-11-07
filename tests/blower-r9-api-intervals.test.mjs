import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBlowerRuntimeProbeResult} from '../functions/api/ois-data-requests.js';
const id='00000000-0000-4000-8000-000000000123', tag='203HRJ01AN601',signal='GSPOGE.ABB_DCS.203HRJ01AN601XB04';
const start='2026-09-19T00:00:00+09:00',end='2026-09-20T00:00:00+09:00';
const revision='r7-evidence-only-v1:r9_signal_v1:runtime-rev';
const probe={schemaVersion:1,requestType:'blower_runtime_probe',readOnly:true,requestId:id,
 assetTag:tag,dataParcTag:signal,startAt:start,endAt:end,chunkDays:31,chunkCount:1,
 expectedLastReplacementAt:'2026-09-20T00:00:00+09:00',expectedCycleStartState:'legacy',expectedCycleStartedAt:'',
 expectedCycleStartRevision:'start-rev',expectedCycleRuntimeRevision:revision};
const p1={startAt:'2026-09-19T08:00:00+09:00',endAt:'2026-09-19T10:30:00+09:00',startKind:'start_signal',endKind:'stop_signal'};
const p2={startAt:'2026-09-19T13:00:00+09:00',endAt:'2026-09-19T14:00:00+09:00',startKind:'start_signal',endKind:'stop_signal'};
const original=()=>({schemaVersion:1,requestType:'blower_runtime_probe',requestId:id,ok:true,readOnly:true,
 assetTag:tag,dataParcTag:signal,startAt:start,endAt:end,observedAt:end,
 expectedLastReplacementAt:probe.expectedLastReplacementAt,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',
 expectedCycleStartRevision:'start-rev',expectedCycleRuntimeRevision:revision,
 chunkDays:31,chunkCount:1,completedChunkCount:1,startState:'stopped',endState:'stopped',
 totalRunningHours:3.5,runningSeconds:12600,collectedAt:'2026-09-20T00:01:00+09:00',
 chunks:[{index:1,startAt:start,endAt:end,startState:'stopped',endState:'stopped',
 totalRunningHours:3.5,runningSeconds:12600,eventSource:'dataparc_fnValTime_intervals_v1',runPeriods:[p1,p2]}]});
const check=x=>normalizeBlowerRuntimeProbeResult(x,probe,id,new Date('2026-09-20T00:05:00+09:00'));
test('server accepts strict R9 original period receipt but never changes saved runtime',()=>{
 const {result,error}=check(original());assert.equal(error,undefined);assert.ok(result);
 assert.equal(result.chunks[0].runPeriods.length,2);
 assert.equal(result.chunks[0].runPeriods[0].startAt,p1.startAt);
 assert.equal(result.runningSeconds,12600);
 assert.equal(result.expectedCycleRuntimeRevision,revision);
});
test('server rejects R9 periods with forged source, overlaps, gaps or 10s discrepancy',()=>{
 const invalid=[
  x=>x.chunks[0].eventSource='guessed-bucket',
  x=>x.chunks[0].runPeriods=[p2,p1],
  x=>x.chunks[0].runPeriods=[p1,{...p2,startAt:'2026-09-19T10:00:00+09:00'}],
  x=>x.chunks[0].runPeriods=[],
  x=>x.chunks[0].runPeriods[0]={...p1,endAt:'2026-09-19T10:29:30+09:00'},
  x=>x.chunks[0].runPeriods[0]={...p1,startKind:'window_boundary'}
 ];
 for(const damage of invalid){const copy=original();damage(copy);assert.ok(check(copy).error,'must block forged original interval');}
});
test('server never promotes ordinary runtime without R9 marker to event receipt',()=>{
 const legacy=original();legacy.expectedCycleRuntimeRevision='runtime-rev';delete legacy.chunks[0].runPeriods;delete legacy.chunks[0].eventSource;
 const norm=normalizeBlowerRuntimeProbeResult(legacy,{...probe,expectedCycleRuntimeRevision:'runtime-rev'},id,new Date('2026-09-20T00:05:00+09:00'));
 assert.ok(norm.result&&!norm.error);assert.equal(norm.result.chunks[0].runPeriods,undefined);
});
