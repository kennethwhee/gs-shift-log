import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../maintenance/blower-unified-refresh.js');
const end = new Date('2026-10-31T05:00:00Z');
const tags = ['103HRJ01AN602','203HRJ01AN601','203HRJ01AN602'];
const fullSignal = t => `GSPOGE.ABB_DCS.${t}XB04`;
function asset(t, overrides = {}) {
  const lastReplacementAt = t === '203HRJ01AN601'
    ? '2026-02-24T13:45:00+09:00' : '2026-09-22T00:00:00+09:00';
  return { enabled:true, blowerType:'limestone', tagNumber:t, displayName:t,
    lastReplacementAt, cycleStartState:'legacy', cycleStoredStartedAt:'',
    cycleStartRevision:'start-1', cycleRuntimeRevision:'runtime-1',
    dataParcTag:fullSignal(t), dataParcRuntimeBasis:null, ...overrides };
}
function reply(t, task, id, overrides = {}) {
  const probe = { requestId:id, assetTag:t, dataParcTag:fullSignal(t),
    expectedLastReplacementAt:task.snapshot.lastReplacementAt,
    startAt:task.startAt, endAt:end.toISOString() };
  const result = { requestId:id, assetTag:t, dataParcTag:fullSignal(t),
    ok:true, readOnly:true, requestType:'blower_runtime_probe',
    startAt:probe.startAt, endAt:probe.endAt, observedAt:probe.endAt,
    endState:'stopped', runningSeconds:3600, totalRunningHours:1 };
  return { ok:true, item:{ id, status:'complete', requestType:'blower_runtime_probe', probe,
    result:{...result, ...(overrides.result || {})}, ...(overrides.item || {}) }, ...overrides.top };
}
function fakeIo(t, task, tamper) {
  const id='v3f-id-'+t; const calls=[];
  return { calls, io:{ assertWritable(){}, api:async options=> {
    calls.push(options);
    if (options.body?.action === 'create_blower_runtime_probe_batch') {
      return {ok:true,atomic:true,batchVersion:1,requestedCount:1,
        results:[{ok:true,assetTag:t,item:{id,status:'complete',requestType:'blower_runtime_probe',probe:{assetTag:t,requestId:id}}}]};
    }
    if (options.url?.startsWith('/api/ois-data-requests?id=')) return reply(t,task,id,tamper || {});
    if (options.body?.action === 'limestone_run_track_apply') {
      return {ok:true,tagNumber:t,requestId:id,totalRunningSeconds:3600,
        coverageStartAt:task.startAt,observedAt:end.toISOString()};
    }
    throw new Error('dataparc_runtime_sync is prohibited for a Limestone preview');
  } } };
}
for(const tag of tags) {
  test(`${tag}: missing append basis still creates a bounded RUN preview`,()=>{
    const p=core.plan([asset(tag)],end);
    assert.equal(p.tasks.length,1); assert.equal(p.skipped.length,0);
    const task=p.tasks[0];
    assert.equal(task.previewOnly,true); assert.equal(task.incremental,false);
    assert.equal(Date.parse(task.startAt),end.getTime()-24*3600*1000);
    assert.equal(task.snapshot.lastReplacementAt,asset(tag).lastReplacementAt);
  });
  test(`${tag}: read-only preview returns state and never writes cumulative hours`,async()=>{
    const task=core.plan([asset(tag)],end).tasks[0];
    const f=fakeIo(tag,task); const result=await core.executeDataParcBatch([task],f.io);
    assert.equal(result.length,1); assert.equal(result[0].previewOnly,true);
    assert.equal(result[0].status,'complete');assert.equal(result[0].unchanged,true);
    assert.equal(result[0].previewState,'stopped');assert.equal(result[0].previewHours,1);
    assert.match(result[0].message,/누적시간 미반영/);
    assert.equal(f.calls.length,3);
    assert.equal(f.calls[0].body.requests[0].requireIncrementalAppend,false);
    assert.equal(f.calls[0].body.requests[0].incrementalRefresh,false);
    assert.equal(f.calls[0].body.requests[0].limestoneTrackingOnly,true);
    assert.equal(f.calls[2].body.action,'limestone_run_track_apply');
    assert.equal(f.calls[1].method,undefined);
    assert.equal(f.calls.filter(x=>x.body?.action==='dataparc_runtime_sync').length,0);
  });
  test(`${tag}: spoofed probe identity is rejected before showing RUN`,async()=>{
    const task=core.plan([asset(tag)],end).tasks[0];
    const f=fakeIo(tag,task,{result:{assetTag:'WRONG_TAG'}});
    const result=await core.executeDataParcBatch([task],f.io);
    assert.equal(result[0].status,'failed');assert.ok(!result[0].previewState);
    assert.equal(f.calls.length,2);
  });
}
test('safe corrected 1B/2A/2B V-Belt records use normal existing sync path',async()=>{
  for(const [tag,lastReplacementAt] of [
    ['103HRJ01AN602','2026-09-22T10:15:00+09:00'],
    ['203HRJ01AN601','2026-09-19T14:20:00+09:00'],
    ['203HRJ01AN602','2026-09-22T10:15:00+09:00']]){
    const p=core.plan([asset(tag,{lastReplacementAt})],end);
    assert.equal(p.tasks.length,1);assert.equal(p.tasks[0].previewOnly,undefined);
  }
});
test('1A and one non-Limestone asset still call normal sync, no preview GET',async()=>{
  for(const a of [asset('103HRJ01AN601',{lastReplacementAt:'2026-09-18T14:20:00+09:00'}),
    {enabled:true,blowerType:'fbhe',tagNumber:'104HHL60AP611',lastReplacementAt:'2026-09-15T00:00:00+09:00',
      dataParcTag:'GSPOGE.ABB_DCS.104HHL60AP611XB04',cycleStartState:'legacy',cycleStartRevision:'s',cycleRuntimeRevision:'r'}]) {
    const p=core.plan([a],end);assert.equal(p.tasks.length,1);
    const t=p.tasks[0];assert.equal(t.previewOnly,undefined);
    const calls=[]; const rs=await core.executeDataParcBatch([t],{assertWritable(){},api:async options=>{
      calls.push(options);if(options.body?.action==='create_blower_runtime_probe_batch')
        return {ok:true,atomic:true,batchVersion:1,requestedCount:1,results:[{ok:true,assetTag:a.tagNumber,item:{id:'normal',status:'complete',requestType:'blower_runtime_probe',probe:{assetTag:a.tagNumber,requestId:'normal'}}}]};
      return {message:'applied'};
    }});
    assert.equal(rs[0].status,'complete');
    assert.deepEqual(calls.map(x=>x.body?.action),['create_blower_runtime_probe_batch','dataparc_runtime_sync']);
  }
});
test('no replacement and malformed signal are never previewed',()=>{
  assert.equal(core.plan([asset(tags[0],{lastReplacementAt:''})],end).tasks.length,0);
  assert.equal(core.plan([asset(tags[0],{dataParcTag:'BAD',limestoneSignalCandidate:''})],end).tasks.length,0);
});
test('frontend planning admits disputed 3 even if server has unverified prior rows',()=>{
  for(const tag of tags) assert.equal(core.plan([asset(tag,{hasUnverifiedDataParcHistory:true})],end).tasks[0].previewOnly,true);
  const ui=fs.readFileSync(new URL('../maintenance/blower-history.js',import.meta.url),'utf8');
  assert.match(ui,/isPreviewCandidate/);
  assert.match(ui,/!asset\.hasUnverifiedDataParcHistory \|\| isPreviewCandidate\(asset\)/);
  assert.match(ui,/RUN 확인\(누적 미반영\)/);
  assert.match(ui,/limestoneRunPreviews\[result.tagNumber\]/);
  assert.match(ui,/data-limestone-run-preview/);
});
test('server denies disputed V-Belt cycle write before asset and event SQL transaction',()=>{
  const api=fs.readFileSync(new URL('../functions/api/blower-history.js',import.meta.url),'utf8');
  const body=api.slice(api.indexOf('async function applyDataParcRuntimeSync('),api.indexOf('async function applyDataParcRuntimeSync(')+27000);
  const guard=body.indexOf("code: 'LIMESTONE_VBELT_ANCHOR_UNCONFIRMED'");
  const write=body.indexOf('UPDATE blower_history_assets');
  assert.ok(guard>0 && write>guard,'held Limestone runtime must reject before persisted Cycle mutation');
  assert.match(body,/const heldB = asset.blower_type === 'limestone'/);
  assert.match(body,/const held2A = asset.blower_type === 'limestone'/);
});
test('HTML cache keys force the new core and UI into production',()=>{
  const html=fs.readFileSync(new URL('../maintenance/blower-history.html',import.meta.url),'utf8');
  assert.match(html,/blower-unified-refresh\.js\?v=20261031-limestone-ledger-v3g/);
  assert.match(html,/blower-history\.js\?v=20261031-limestone-ledger-v3g/);
});
