import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {createLimestone1bFixture,ordinaryAppend,publicRequest as request1b} from './helpers/blower-limestone1b-fixture-v1.mjs';
import {createLimestone2aFixture,publicRequest as request2a} from './helpers/blower-limestone2a-fixture-v1.mjs';
const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const json=value=>JSON.parse(JSON.stringify(value));
async function projected(f){return json((await history.loadAssetStates(f.db,{},{assetRows:[f.asset()]}))[0]);}
async function serialized(tasks,asset){
 let body;const captured=Object.assign(new Error('captured request before network'),{status:418,code:'TEST_CAPTURE'});
 await assert.rejects(core.executeDataParcBatch(tasks,{currentAssetFor:()=>asset,api:async options=>{
  assert.equal(options.method,'POST');assert.equal(options.url,'/api/ois-data-requests');assert.equal(body,undefined,'one batch POST only');
  body=json(options.body);throw captured;
 }}),error=>error===captured);
 assert.ok(body);return body;
}
function total(f){return JSON.stringify([f.asset(),f.events()]);}
for(const appended of [false,true])test('actual Lime1B '+(appended?'append descendant':'recovered first-run')+' serializes the existing measured range as one normal incremental batch item',async t=>{
 const f=await createLimestone1bFixture(t);await f.apply(await f.ready());if(appended)await ordinaryAppend(f);
 const asset=await projected(f),before=total(f),now=new Date(f.now.getTime()+10000);
 assert.ok(core.verifiedLimestone1bFirstRun(asset));assert.equal(asset.limestoneAutoApply,true);
 assert.notEqual(Date.parse(asset.dataParcRuntimeBasis.startAt),Date.parse(asset.lastReplacementAt),'first post-job RUN is not physical completion midnight');
 const plan=core.plan([asset],now);assert.equal(plan.skipped.length,0);assert.equal(plan.tasks.length,1);
 const task=plan.tasks[0];assert.equal(task.kind,'dataparc');assert.equal(task.incremental,true);assert.notEqual(task.limestoneAutoRebuild,true);
 assert.equal(task.startAt,asset.dataParcRuntimeBasis.startAt);assert.equal(task.queryStartAt,asset.dataParcRuntimeBasis.observedAt);
 assert.equal(task.recoveryMode,undefined);assert.equal(task.replacementAutoFresh,undefined);
 const body=await serialized(plan.tasks,asset),item=body.requests[0];
 assert.equal(item.incrementalRefresh,true);assert.equal(item.requireIncrementalAppend,true);
 assert.equal(item.startAt,asset.dataParcRuntimeBasis.startAt);assert.equal(item.expectedCycleStartedAt,'');
 const response=await request1b(f,body);
 // The descendant fixture endpoint can still be ahead of the real request clock.
 // Both an already-current reply and a new verified append are valid admission.
 if(appended && response.status===200){assert.equal(response.body.upToDateCount,1);assert.equal(response.body.createdCount,0);}
 else {
  assert.equal(response.status,201,JSON.stringify(response.body));assert.equal(response.body.createdCount,1);
  const id=response.body.results[0].item.id,append=f.sql.prepare('SELECT * FROM blower_runtime_append_v1 WHERE request_id=?').get(id);
  assert.equal(append.base_observed_at,asset.dataParcRuntimeBasis.observedAt);assert.equal(append.coverage_start_at,asset.dataParcRuntimeBasis.startAt);
  assert.equal(append.base_running_seconds,asset.dataParcRuntimeBasis.runningSeconds);
 }
 assert.equal(total(f),before,'queue creation never replaces the current counter or certificate');
});
test('actual Lime2A duration certificate retains the established normal incremental wire contract',async t=>{
 const f=await createLimestone2aFixture(t);await f.apply(await f.status());const asset=await projected(f),before=total(f);
 assert.ok(core.verifiedLimestone2aFirstRun(asset));const plan=core.plan([asset],new Date(f.now.getTime()+10000));
 assert.equal(plan.tasks.length,1);assert.equal(plan.skipped.length,0);assert.equal(plan.tasks[0].incremental,true);
 const body=await serialized(plan.tasks,asset);assert.equal(body.requests[0].incrementalRefresh,true);assert.equal(body.requests[0].requireIncrementalAppend,true);
 const response=await request2a(f,body);assert.equal(response.status,201,JSON.stringify(response.body));assert.equal(response.body.createdCount,1);assert.equal(total(f),before);
});
for(const item of [
 {name:'Lime1B',create:createLimestone1bFixture,ready:f=>f.ready(),verify:core.verifiedLimestone1bFirstRun,field:'limestone1bFirstRun'},
 {name:'Lime2A',create:createLimestone2aFixture,ready:f=>f.status(),verify:core.verifiedLimestone2aFirstRun,field:'limestone2aFirstRun'}
])test('a mismatched '+item.name+' certificate is held before any whole-range rebuild fallback',async t=>{
 const f=await item.create(t);await f.apply(await item.ready(f));const original=await projected(f),before=total(f);
 const pending=f.sql.prepare("SELECT COUNT(*) n FROM ois_data_requests WHERE status='pending'").get().n;
 for(const change of [a=>{a[item.field+'Proof'].proofHash='f'.repeat(64);},a=>{a.runtimeCoverageEvidence[item.field].currentRunningSeconds++;},a=>{a.cycleSourceReview={code:'SOURCE_CHANGED'};}]){
  const asset=json(original);change(asset);assert.equal(item.verify(asset),null);
  const plan=core.plan([asset],new Date(f.now.getTime()+10000));assert.equal(plan.tasks.length,0);assert.equal(plan.skipped.length,1);
  assert.equal(total(f),before);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM ois_data_requests WHERE status='pending'").get().n,pending);
 }
});
test('a genuine new replacement capability still plans its separate first full measurement',()=>{
 const replaced='2026-11-11T00:00:00+09:00',asset={tagNumber:'103HRJ01AN602',blowerType:'limestone',unitNo:'1',enabled:true,
  lastReplacementAt:replaced,cycleStartState:'pending',cycleStoredStartedAt:'',cycleStartedAt:'',cycleStartRevision:'new-real-belt',cycleRuntimeRevision:'new-real-runtime',
  cycleElapsedHours:0,runtimeHours:0,cycleRuntimeState:'unknown',hasUnverifiedDataParcHistory:false,dataParcTag:'GSPOGE.ABB_DCS.103HRJ01AN602XB04',
  measurementRequired:true,dataParcRuntimeBasis:null,limestoneAutoApply:true,limestoneBasisConfirmed:true,limestoneRunDisputed:false,
  replacementAutoCycle:{schemaVersion:3,timePrecision:'minute',clockKnown:true,registeredBaseline:true,requiredStartAt:replaced,freshQueryEligible:true,
   requiresRunRefresh:true,sourceLogId:'approved-new-replacement',eventId:'new-replacement-event'}};
 assert.equal(core.verifiedLimestone1bFirstRun(asset),null);assert.deepEqual(core.freshReplacementQuery(asset,new Date('2026-11-11T10:00:00+09:00')),{startAt:replaced});
 const plan=core.plan([asset],new Date('2026-11-11T10:00:00+09:00'));assert.equal(plan.tasks.length,1);assert.equal(plan.skipped.length,0);
 assert.equal(plan.tasks[0].incremental,false);assert.equal(plan.tasks[0].replacementAutoFresh,true);assert.equal(plan.tasks[0].startAt,replaced);
});
