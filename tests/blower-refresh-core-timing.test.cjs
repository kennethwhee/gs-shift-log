'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../maintenance/blower-unified-refresh.js');
function task() {
  const asset = {tagNumber:'104ETH03AN601', blowerType:'flyash_silo', displayName:'test', enabled:true,
    lastReplacementAt:'2026-09-01T00:00:00+09:00', cycleStartState:'legacy', cycleStoredStartedAt:'',
    cycleStartedAt:'2026-09-01T00:00:00+09:00', cycleStartRevision:'s1', cycleRuntimeRevision:'r1',
    dataParcTag:'GSPOGE.ABB_DCS.TEST_ONLY_CONFIRMED_BINARY'};
  return core.plan([asset],new Date('2026-09-15T00:00:00Z')).tasks[0];
}
function setup(t, timing) {
  const old = Object.getOwnPropertyDescriptor(globalThis,'BlowerRefreshTiming');
  Object.defineProperty(globalThis,'BlowerRefreshTiming',{configurable:true,writable:true,value:timing});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'BlowerRefreshTiming',old);else delete globalThis.BlowerRefreshTiming;});
}
function successfulIo() {
  const calls=[];
  return { calls, io:{assertWritable(){},api:async request=>{
    calls.push(request);
    if(request.body.action==='create_blower_runtime_probe_batch')return {
      ok:true,atomic:true,batchVersion:1,requestedCount:1,results:[{ok:true,assetTag:'104ETH03AN601',
        item:{id:'exact',status:'complete',requestType:'blower_runtime_probe',probe:{assetTag:'104ETH03AN601',requestId:'exact'}}}]
    };
    return {message:'saved'};
  }}};
}
test('browser phase measurement preserves one atomic create and exact apply request',async t=>{
  const events=[];
  setup(t,{beginPhase(name,metadata){events.push({name,metadata});return {end(status,counts){events.push({status,counts});}};}});
  const f=successfulIo();const result=await core.executeDataParcBatch([task()],f.io);
  assert.equal(result[0].status,'complete');assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls[1].body,{action:'dataparc_runtime_sync',requestId:'exact'});
  assert.deepEqual(events.filter(x=>x.name).map(x=>x.name),['createRequests','waitResults','applyResults']);
  assert.deepEqual(events[0].metadata,{targetCount:1});
  assert.ok(!JSON.stringify(events).includes('TEST_ONLY_CONFIRMED_BINARY'));
  assert.ok(!JSON.stringify(events).includes('exact'));
});
test('missing, throwing, and malformed diagnostics never change successful requests or results',async t=>{
  setup(t,undefined);
  const baseline=successfulIo();const expected=await core.executeDataParcBatch([task()],baseline.io);
  for(const telemetry of [null,{beginPhase(){throw new Error('timer');}},{beginPhase(){return {end(){throw new Error('timer');}};}},{beginPhase(){return {end:5};}}]){
    globalThis.BlowerRefreshTiming=telemetry;const f=successfulIo();
    assert.deepEqual(await core.executeDataParcBatch([task()],f.io),expected);
    assert.deepEqual(f.calls,baseline.calls);
  }
});
test('a throwing telemetry property getter cannot block a business operation',async t=>{
  setup(t,undefined);
  Object.defineProperty(globalThis,'BlowerRefreshTiming',{configurable:true,get(){throw new Error('getter');}});
  const f=successfulIo();assert.equal((await core.executeDataParcBatch([task()],f.io))[0].status,'complete');
});
test('create failure preserves the original exception and exports no error text',async t=>{
  const records=[];const original=Object.assign(new Error('private error token'),{status:401});
  setup(t,{beginPhase(name,metadata){records.push({name,metadata});return {end(status,counts){records.push({status,counts});}};}});
  let calls=0;
  await assert.rejects(core.executeDataParcBatch([task()],{assertWritable(){},api:async()=>{calls++;throw original;}}),e=>e===original);
  assert.equal(calls,1);assert.equal(records.at(-1).status,'failed');
  assert.ok(!JSON.stringify(records).includes('private'));
});
test('partial apply is reported as partial without repeating the save',async t=>{
  const events=[];
  setup(t,{beginPhase(name){return {end(status,counts){events.push({name,status,counts});}};}});
  const f=successfulIo();const original=f.io.api;
  f.io.api=async request=>{if(request.body.action==='dataparc_runtime_sync'){f.calls.push(request);throw new Error('save unavailable');}return original(request);};
  const result=await core.executeDataParcBatch([task()],f.io);
  assert.equal(result[0].status,'failed');assert.equal(f.calls.length,2);
  assert.deepEqual(events.at(-1),{name:'applyResults',status:'partial',counts:{completedCount:0,failedCount:1}});
});
test('work-log authorization failure is measured and remains a hard failure',async t=>{
  const events=[];const original=Object.assign(new Error('expired secret'),{status:401});
  setup(t,{beginPhase(name,metadata){events.push({name,metadata});return {end(status){events.push({status});}};}});
  await assert.rejects(core.refreshLogsForRuntime({api:async()=>{throw original;},assertWritable(){},sleep:async()=>{}}),e=>e===original);
  assert.equal(events[0].name,'workLogs');assert.equal(events.at(-1).status,'failed');
  assert.ok(!JSON.stringify(events).includes('secret'));
});
