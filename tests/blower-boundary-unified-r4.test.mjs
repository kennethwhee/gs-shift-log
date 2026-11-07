import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), core=require('../maintenance/blower-unified-refresh.js');
const TAG='204SDF01AN002', SIGNAL=`GSPOGE.ABB_DCS.${TAG}XB04`;
const START='2026-07-24T10:00:00.000Z', OLD='2026-11-06T15:01:15.000Z';
const END='2026-11-06T23:30:00.000Z', FULL='2026-11-06T23:31:00.000Z';
function asset(tag=TAG) {
  const signal=`GSPOGE.ABB_DCS.${tag}XB04`, hours=1152.5630555555556;
  return {tagNumber:tag,displayName:tag,blowerType:'organic_fuel',enabled:true,
    lastReplacementAt:'2026-07-24T00:00:00+09:00',actualLastReplacementAt:'2026-07-24T00:00:00+09:00',
    cycleStartState:'started',cycleStoredStartedAt:START,cycleStartedAt:START,
    cycleStartRevision:'start',cycleRuntimeRevision:'runtime',cycleRuntimeState:'stopped',
    dataParcTag:signal,cycleElapsedHours:hours,runtimeHours:hours,measurementRequired:false,hasUnverifiedDataParcHistory:false,
    dataParcRuntimeBasis:{requestId:'old-'+tag,dataParcTag:signal,startAt:START,observedAt:OLD,requiredStartAt:START,
      runtimeHours:hours,runningSeconds:4149227,appendReady:true,coverageComplete:true,cycleBasisConfirmed:false},
    runtimeCoverageEvidence:{version:1,source:'dataparc',measurementVerified:true,requestId:'old-'+tag,
      hours,startAt:START,observedAt:OLD,firstRunVerified:false}};
}
function scenario(options={}) {
  const assets=[asset(),asset('104SDF01AN002')], before=structuredClone(assets);
  const source=core.plan(assets,new Date(END)).tasks, calls=[], checkpoints=[];
  const modeById=new Map();let clock=0,checkpoint=null,wait=!!options.wait,lost=false,fullItem=null;
  const io={currentAssetFor:tag=>assets.find(a=>a.tagNumber===tag),clock:()=>clock,sleep:async ms=>{clock+=ms;},
    assertWritable(){},allowBoundaryRecovery:options.allowBoundaryRecovery,
    runtimeCheckpoint(value){checkpoint=structuredClone(value);checkpoints.push(checkpoint);},
    async api(request){
      calls.push(structuredClone(request));
      if(request.body?.action==='create_blower_runtime_probe_batch') {
        const requests=request.body.requests;
        const response = {ok:true,atomic:true,batchVersion:1,requestedCount:requests.length,
          results:requests.map(body=>{
            const repair=body.appendBoundaryRecovery===true,id=(repair?'full-':'delta-')+body.assetTag;
            modeById.set(id,repair);
            const item={id,status:'pending',requestType:'blower_runtime_probe',
              probe:{requestId:id,assetTag:body.assetTag,dataParcTag:body.dataParcTag,startAt:body.startAt,endAt:repair?FULL:END,
                ...(repair?{runtimeRecovery:{version:1,mode:'append_boundary_full'}}:{})}};
            if(repair)fullItem=item;
            return {ok:true,assetTag:body.assetTag,item};
          })};
        if(options.loseCreate && requests.some(row=>row.appendBoundaryRecovery) && !lost){
          lost=true;throw Object.assign(new Error('gateway response lost'),{status:503});
        }
        return response;
      }
      if(request.url?.includes('action=boundary_recovery_status')) {
        if(options.lookupError)throw Object.assign(new Error('lookup temporarily unavailable'),{status:503});
        assert.equal(new URL(request.url,'https://example.test').searchParams.get('failureRequestId'),'delta-'+TAG);
        return options.lookupMiss ? {ok:true,found:false,failureRequestId:'delta-'+TAG}
          : {ok:true,found:true,failureRequestId:'delta-'+TAG,item:fullItem};
      }
      if(request.url?.includes('action=status_batch')) {
        const ids=new URL(request.url,'https://example.test').searchParams.get('ids').split(',');
        return {items:ids.map(id=>({id,status:wait&&id.startsWith('full-')?'processing':'complete',completedAt:FULL}))};
      }
      if(request.body?.action==='dataparc_runtime_sync') {
        const id=request.body.requestId,repair=id.startsWith('full-');
        if(id==='delta-'+TAG || repair&&options.repeatFailure) {
          throw Object.assign(new Error('경계 불일치'),{status:409,code:options.code||'DATAPARC_APPEND_BOUNDARY_CHANGED',
            boundaryRecovery:{version:1,eligible:true,requestId:id,assetTag:TAG,dataParcTag:SIGNAL,startAt:START,endAt:END,...options.proof}});
        }
        if(repair) assert.equal(request.body.appendBoundaryRecovery,true);
        return {ok:true,applied:true,requestId:id,assetTag:repair?TAG:id.slice(6),dataParcTag:SIGNAL,
          appendBoundaryRecovery:repair,runtimeHours:1153,observedAt:FULL};
      }
      throw new Error('Unexpected '+JSON.stringify(request));
    }};
  return {assets,before,source,io,calls,checkpoints,get checkpoint(){return checkpoint;},
    setWait(v){wait=v;},run:()=>core.executeDataParcBatch(source,io),
    creates:()=>calls.filter(c=>c.body?.action==='create_blower_runtime_probe_batch')};
}
test('fresh exact boundary failure gets one typed full query and replaces its result without changing other 26-device logic',async()=>{
  const f=scenario(), result=await f.run();
  assert.equal(f.creates().length,2);assert.equal(f.creates()[0].body.requests.length,2);
  const full=f.creates()[1].body.requests;
  assert.equal(full.length,1);assert.equal(full[0].assetTag,TAG);assert.equal(full[0].startAt,START);
  assert.equal(full[0].appendBoundaryRecovery,true);assert.equal(full[0].boundaryFailureRequestId,'delta-'+TAG);
  assert.equal(full[0].incrementalRefresh,false);assert.equal(full[0].requireIncrementalAppend,false);
  assert.equal(result.length,2);assert.ok(result.every(x=>x.status==='complete'));
  assert.equal(result[0].recoveryMode,'append_boundary_full');assert.equal(result[0].requestId,'full-'+TAG);
  assert.deepEqual(f.assets,f.before);assert.equal(f.checkpoint,null);
});
test('a waiting full query retains original batch outcomes and resumes its original full request after reload',async()=>{
  const f=scenario({wait:true}), first=await f.run();
  assert.equal(first[0].status,'waiting');assert.equal(first[1].status,'complete');
  const saved=structuredClone(f.checkpoint);
  assert.equal(saved.tasks.length,2);assert.equal(saved.tasks[0].recoveryMode,'append_boundary_full');
  assert.equal(saved.createdBatch.results[0].item.id,'full-'+TAG);
  assert.equal(saved.createdBatch.results[1].item.id,'delta-104SDF01AN002');
  assert.deepEqual(saved.outcomes.map(x=>x.tagNumber),['104SDF01AN002']);
  f.io.runtimeResume=saved;f.setWait(false);const second=await f.run();
  assert.equal(f.creates().length,2);assert.ok(second.every(x=>x.status==='complete'));
  assert.equal(second[0].requestId,'full-'+TAG);assert.equal(f.checkpoint,null);
});
test('ordinary errors, unowned proof or scheduled policy never trigger a full query',async()=>{
  for(const options of [{code:'DATAPARC_APPEND_BASE_CHANGED'},{proof:{requestId:'different'}},
    {proof:{assetTag:'104SDF01AN002'}},{proof:{dataParcTag:'wrong'}},{proof:{startAt:OLD}},
    {proof:{eligible:false}},{allowBoundaryRecovery:false}]){
    const f=scenario(options),result=await f.run();
    assert.equal(f.creates().length,1,JSON.stringify(options));assert.equal(result[0].status,'failed');
    assert.equal(result[0].failureStage,'apply');assert.equal(result[0].requestId,'delta-'+TAG);
    assert.equal(result[0].dataParcTag,SIGNAL);assert.equal(result[0].cycleSnapshot.cycleRuntimeRevision,'runtime');
  }
});
test('a full query failure is terminal for this refresh, with typed failure preserved and no retry loop',async()=>{
  const f=scenario({repeatFailure:true}),result=await f.run();
  assert.equal(f.creates().length,2);assert.equal(result[0].status,'failed');
  assert.equal(result[0].errorCode,'DATAPARC_APPEND_BOUNDARY_CHANGED');
  assert.equal(result[0].recoveryMode,'append_boundary_full');assert.equal(result[0].requestId,'full-'+TAG);
});
test('lost full-create response remains unconfirmed and a read-only lookup restores the exact accepted request',async()=>{
  const f=scenario({loseCreate:true}),first=await f.run();
  assert.equal(first[0].status,'waiting');assert.equal(first[0].requestId,'');
  assert.equal(first[0].errorCode,'CREATE_RESULT_UNCONFIRMED');assert.equal(first[1].status,'complete');
  const saved=structuredClone(f.checkpoint);
  assert.equal(saved.boundaryCreateUnconfirmed.task.boundaryFailureRequestId,'delta-'+TAG);
  f.io.runtimeResume=saved;const second=await f.run();
  assert.ok(second.every(row=>row.status==='complete'));assert.equal(second[0].requestId,'full-'+TAG);
  assert.equal(f.creates().length,2,'accepted full query must not be recreated');
  assert.equal(f.calls.filter(row=>row.url?.includes('action=boundary_recovery_status')).length,1);
  assert.equal(f.checkpoint,null);
});
test('failed lookup preserves create uncertainty and all prior accepted IDs without another write',async()=>{
  const f=scenario({loseCreate:true,lookupError:true});await f.run();
  const saved=structuredClone(f.checkpoint);f.io.runtimeResume=saved;
  const resumed=await f.run();assert.equal(resumed[0].status,'waiting');assert.equal(resumed[1].status,'complete');
  assert.equal(f.creates().length,2);assert.deepEqual(f.checkpoint,saved);
});
test('explicit resume after a successful absence lookup retries the identical frozen full body once',async()=>{
  const f=scenario({loseCreate:true,lookupMiss:true});await f.run();f.io.runtimeResume=structuredClone(f.checkpoint);
  const resumed=await f.run();assert.ok(resumed.every(row=>row.status==='complete'));
  assert.equal(f.creates().length,3);assert.deepEqual(f.creates()[2].body,f.creates()[1].body);
  assert.equal(f.creates()[2].body.requests[0].boundaryFailureRequestId,'delta-'+TAG);
  assert.equal(f.checkpoint,null);
});
