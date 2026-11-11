import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createLimestone1bFixture,TAG as LIME1B} from './helpers/blower-limestone1b-fixture-v1.mjs';
import {onRequestGet as historyGet,onRequestPost as historyPost} from '../functions/api/blower-history.js';
import {onRequestPost as requestsPost,buildBlowerRuntimeProbeChunks,convertBlowerRuntimeProbeIntentRow,normalizeBlowerRuntimeProbeResult} from '../functions/api/ois-data-requests.js';
const require=createRequire(import.meta.url),core=require('../maintenance/blower-unified-refresh.js');
const CLOSED=['103HRJ01AN602','203HRJ01AN601','104ETH03AN602','104HHL60AP611','104HHL60AP621','204HHL60AP631'];
const wire=body=>JSON.parse(JSON.stringify(body));
async function fixtureModule(path,replacements=[],prefixOnly=false){
 const url=new URL(path,import.meta.url);let source=fs.readFileSync(url,'utf8');
 if(prefixOnly){source=source.slice(0,source.indexOf('\ntest('));source+='\nexport {fixture};';}
 // The independent fixtures use short global request IDs. Give each copied
 // fixture its own IDs before merging their real server-generated records.
 for(const [from,to]of replacements)source=source.replaceAll(from,to);
 source=source.replace(/from\s*'([^']+)'/g,(match,spec)=>spec.startsWith('.')?`from '${new URL(spec,url).href}'`:match);
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
async function allRecovered(t){
 const modules=await Promise.all([
  fixtureModule('./helpers/blower-limestone2a-fixture-v1.mjs',[['r9-fixture','lime2a-r9-fixture'],['append-fixture','lime2a-append-fixture']]),
  fixtureModule('./blower-silo-basis-v1.test.mjs',[['tail-root','silo-tail-root']],true),
  fixtureModule('./helpers/blower-fbhe1b-standby-fixture-v1.mjs',[['tail-root','fbhe1b-tail-root'],['r9-fixture','fbhe1b-r9-fixture'],['ordinary-append','fbhe1b-ordinary-append'],['append-fixture','fbhe1b-append-fixture']]),
  fixtureModule('./helpers/blower-fbhe2c-standby-fixture-v1.mjs',[['tail-root','fbhe2c-tail-root'],['r9-fixture','fbhe2c-r9-fixture'],['ordinary-append','fbhe2c-ordinary-append'],['append-fixture','fbhe2c-append-fixture']]),
  fixtureModule('./helpers/blower-fbhe1a-runtime-fixture-v1.mjs',[['baseline-root','fbhe1a-baseline-root'],['r9-fixture','fbhe1a-r9-fixture'],['ordinary-append','fbhe1a-ordinary-append'],['append-fixture','fbhe1a-append-fixture']])
 ]),[gmod,smod,bmod,cmod,amod]=modules;
 const f=await createLimestone1bFixture(),g=await gmod.createLimestone2aFixture(),s=await smod.fixture(),b=await bmod.createFbhe1bStandbyFixture(),c=await cmod.createFbhe2cStandbyFixture(),a=await amod.createFbhe1aRuntimeFixture();
 t.after(()=>{for(const item of[f,g,s,b,c,a])item.sql.close()});
 await f.apply(await f.ready());await g.apply(await g.status());await gmod.ordinaryAppend(g);await s.apply(await s.ready());await b.apply(await b.status());await c.apply(await c.status());await a.apply(await a.ready());
 function merge(from,tag){
  for(const table of from.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
   if(!f.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table.name))f.sql.exec(table.sql);
   if(table.name==='blower_history_assets'){const row=from.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag),keys=Object.keys(row).filter(k=>k!=='tag_number');f.sql.prepare('UPDATE blower_history_assets SET '+keys.map(k=>'"'+k+'"=?').join(',')+' WHERE tag_number=?').run(...keys.map(k=>row[k]),tag);continue}
   for(const row of from.prepare('SELECT * FROM "'+table.name+'"').all()){const keys=Object.keys(row);f.sql.prepare('INSERT OR IGNORE INTO "'+table.name+'"('+keys.map(k=>'"'+k+'"').join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]))}
  }
 }
 for(const [item,tag]of [[g,gmod.TAG],[s,'104ETH03AN602'],[b,bmod.TAG],[c,cmod.TAG],[a,amod.TAG]])merge(item.sql,tag);
 for(const asset of f.sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all()){
  if(CLOSED.includes(asset.tag_number))continue;
  const tag=asset.tag_number,signal='GSPOGE.ABB_DCS.'+tag+'XB04',id='ordinary-root:'+tag,revision='ordinary-cycle:'+tag;
  const intent={request_id:id,reuse_key:id,schema_version:1,asset_tag:tag,dataparc_tag:signal,window_start:bmod.START,window_end:f.end,chunk_days:31,chunk_count:buildBlowerRuntimeProbeChunks(bmod.START,f.end).length,expected_last_replacement_at:bmod.START,expected_cycle_start_state:'legacy',expected_cycle_started_at:'',expected_cycle_start_revision:revision,expected_cycle_runtime_revision:'seed:'+tag,created_at:f.end,updated_at:f.end},raw=bmod.result(intent,f.end),normalized=normalizeBlowerRuntimeProbeResult(raw,convertBlowerRuntimeProbeIntentRow(intent),id,new Date(f.end));assert.equal(normalized.error,undefined);
  bmod.insert(f.sql,'blower_runtime_probe_intents_v5',intent);bmod.insert(f.sql,'ois_data_requests',{id,request_type:'blower_runtime_probe',target_date:`v1|${tag}|${intent.window_start}|${f.end}`,status:'complete',requested_by_id:f.user.employeeNo,requested_by_name:f.user.name,requested_at:new Date(Date.parse(f.end)-1000).toISOString(),started_at:f.end,completed_at:f.end,agent_id:'fixture-agent',result_json:JSON.stringify(raw),error_message:'',expires_at:new Date(f.now.getTime()+3600000).toISOString(),updated_at:f.end});
  bmod.insert(f.sql,'blower_history_events',{id:'dataparc_runtime:'+id,tag_number:tag,event_type:'runtime_correction',event_date:f.end,runtime_hours:0,issue_type:'',action_type:'RUN 조회',note:'Synthetic ordinary measured range',source_type:'dataparc_runtime',source_log_id:id,source_text:JSON.stringify(normalized.result),created_by_id:f.user.employeeNo,created_by_name:f.user.name,created_at:new Date(f.end).toISOString(),updated_at:new Date(f.end).toISOString()});
  f.sql.prepare("UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,cycle_start_revision=?,cycle_runtime_revision=?,cycle_runtime_hours=0,runtime_hours=0,cycle_runtime_anchor_at=?,cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0 WHERE tag_number=?").run(bmod.START,revision,'runtime:'+tag,f.end,tag);
 }
 const mergedA={...a,db:f.db,sql:f.sql,asset:()=>f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(amod.TAG),addRequest:(i,r,collected)=>{amod.insert(f.sql,'blower_runtime_probe_intents_v5',i);amod.insert(f.sql,'ois_data_requests',{id:i.request_id,request_type:'blower_runtime_probe',target_date:`v1|${amod.TAG}|${i.window_start}|${i.window_end}`,status:'complete',requested_by_id:amod.USER.employeeNo,requested_by_name:amod.USER.name,requested_at:new Date(Date.parse(collected)-1000).toISOString(),started_at:collected,completed_at:collected,agent_id:'fixture-agent',result_json:JSON.stringify(r),error_message:'',expires_at:new Date(Date.parse(collected)+3600000).toISOString(),updated_at:collected})}};
 return{f,appendA:()=>amod.ordinaryAppend(mergedA)};
}
const auth={Authorization:'Bearer lime1b-browser-token','Content-Type':'application/json'};
async function publicAssets(f){const r=await historyGet({env:{DB:f.db},request:new Request('https://fixture.test/api/blower-history',{headers:auth})});assert.equal(r.status,200);const body=wire(await r.json());assert.equal(body.assets.length,27);return body.assets}
function protectedBytes(f){const names=['blower_history_assets','blower_history_events','blower_history_asset_history','blower_limestone1b_first_run_intents_v1','blower_silo_basis_intents_v1','blower_fbhe1b_standby_certificates_v1','blower_fbhe2c_standby_certificates_v1','blower_fbhe1a_runtime_intents_v1'];return JSON.stringify(names.map(name=>[name,f.sql.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]))}
function verifySix(assets){const by=new Map(assets.map(a=>[a.tagNumber,a]));assert.ok(core.verifiedLimestone1bFirstRun(by.get(LIME1B)));assert.ok(core.verifiedLimestone2aFirstRun(by.get('203HRJ01AN601')));assert.ok(by.get('104ETH03AN602').runtimeCoverageEvidence.siloBasis);assert.ok(core.verifiedFbhe1bStandby(by.get('104HHL60AP621')));assert.ok(core.verifiedFbhe2cStandby(by.get('204HHL60AP631')));assert.ok(core.verifiedFbhe1aRuntime(by.get('104HHL60AP611')))}
async function browserEnqueue(f,assets){
 const plan=core.plan(assets,new Date(Date.now()+10000));assert.equal(plan.tasks.length,27,JSON.stringify(plan.skipped));assert.equal(plan.skipped.length,0);
 const before=protectedBytes(f),calls=[],batch=f.db.batch.bind(f.db);let atomicQueueBatches=0;f.db.batch=async items=>{if(items.some(item=>/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+ois_data_requests\b/i.test(item.query)))atomicQueueBatches++;return batch(items)};const stop=Object.assign(new Error('Stop after the real atomic enqueue, before Agent execution'),{status:418});let response;
 let failure;try{await core.executeDataParcBatch(plan.tasks,{currentAssetFor:tag=>assets.find(a=>a.tagNumber===tag),assertWritable(){},progress(){},async api(options){calls.push(options);assert.equal(options.method,'POST');assert.equal(options.url,'/api/ois-data-requests');const body=wire(options.body);assert.equal(body.action,'create_blower_runtime_probe_batch');assert.equal(body.requests.length,27);response=await requestsPost({env:{DB:f.db},request:new Request('https://fixture.test/api/ois-data-requests',{method:'POST',headers:auth,body:JSON.stringify(body)})});response={status:response.status,body:await response.json(),wire:body};if(response.status>=400)throw Object.assign(new Error(response.body.message),{status:response.status,code:response.body.code});throw stop}})}catch(error){failure=error}
 assert.equal(calls.length,1,'one browser POST; no individual fallback');assert.ok(response);const index=response.body.failedIndex,bad=response.wire.requests[index];assert.equal(response.status,201,JSON.stringify({code:response.body.code,failedIndex:index,badTag:bad?.assetTag,incrementalRefresh:bad?.incrementalRefresh,requireIncrementalAppend:bad?.requireIncrementalAppend}));
 assert.equal(failure,stop);assert.equal(atomicQueueBatches,1,'all new queue rows commit in one D1 batch');assert.equal(response.body.atomic,true);assert.equal(response.body.requestedCount,27);assert.equal(response.body.createdCount+response.body.reusedCount+response.body.upToDateCount,27);assert.equal(protectedBytes(f),before);const created=response.body.results.filter(item=>item.disposition==='created').map(item=>item.item.id);assert.ok(created.length>0);assert.ok(created.every(id=>/^brb1_[a-f0-9-]{36}_\d{2}_\d{2}$/.test(id)));assert.equal(new Set(created.map(id=>id.split('_')[1])).size,1,'all created requests share one Agent group');
 for(const item of response.wire.requests){assert.equal(item.incrementalRefresh,true,item.assetTag);assert.equal(item.requireIncrementalAppend,true,item.assetTag);assert.equal(item.limestoneTrackingOnly,undefined);assert.equal(item.rolePriorityRecovery,undefined);assert.equal(item.completionWindowRecovery,undefined)}
 const a=response.wire.requests.find(r=>r.assetTag==='104HHL60AP611');assert.equal(a.expectedCycleStartState,'legacy');assert.equal(a.expectedCycleStartedAt,'');assert.equal(Date.parse(a.startAt),Date.parse('2026-09-05T00:00:00+09:00'));
 return{response,plan};
}
test('all 27 actual browser planned JSON items preserve six recovered proofs in one strict atomic batch',async t=>{const {f}=await allRecovered(t),assets=await publicAssets(f);verifySix(assets);const a=assets.find(a=>a.tagNumber==='104HHL60AP611');assert.equal(a.cycleStoredStartedAt,'');assert.equal(a.cycleStartState,'legacy');await browserEnqueue(f,assets)});
test('the same full public browser-to-server batch remains valid after a normal recovered 1A append',async t=>{const {f,appendA}=await allRecovered(t);await appendA();const assets=await publicAssets(f);verifySix(assets);await browserEnqueue(f,assets)});
