import test from 'node:test';
import assert from 'node:assert/strict';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {loadAppendBase} from '../functions/_shared/blower-incremental.js';
import {convertBlowerRuntimeProbeIntentRow,normalizeBlowerRuntimeProbeResult,buildBlowerRuntimeProbeChunks} from '../functions/api/ois-data-requests.js';
import {createFbhe1aRuntimeFixture,publicRequest,insert,result,TAG,SIGNAL,START} from './helpers/blower-fbhe1a-runtime-fixture-v1.mjs';
const encode=JSON.stringify;
const state=async f=>JSON.parse(encode((await history.loadAssetStates(f.db,{},{assetRows:[f.asset()]}))[0]));
function frozen(f){return encode({asset:f.asset(),events:f.events(),requests:f.sql.prepare('SELECT * FROM ois_data_requests ORDER BY id').all(),intents:f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 ORDER BY request_id').all(),appends:f.sql.prepare('SELECT * FROM blower_runtime_append_v1 ORDER BY request_id').all()});}
function certificate(f){return encode({certificate:f.sql.prepare('SELECT * FROM blower_fbhe1a_runtime_intents_v1 ORDER BY request_id').all(),audit:f.sql.prepare("SELECT * FROM blower_history_asset_history WHERE action_type='fbhe1a_runtime_recovery' ORDER BY id").all()});}
function seedOtherAssets(f){
 for(const a of f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number<>? ORDER BY tag_number').all(TAG)){
  const signal=a.tag_number==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.'+a.tag_number+'XB04';
  const revision='fixture-start:'+a.tag_number,id='ordinary-root:'+a.tag_number;
  const intent={request_id:id,reuse_key:id,schema_version:1,asset_tag:a.tag_number,dataparc_tag:signal,window_start:START,window_end:f.end,chunk_days:31,chunk_count:buildBlowerRuntimeProbeChunks(START,f.end).length,expected_last_replacement_at:START,expected_cycle_start_state:'legacy',expected_cycle_started_at:'',expected_cycle_start_revision:revision,expected_cycle_runtime_revision:'fixture-seed:'+a.tag_number,created_at:f.end,updated_at:f.end};
  const raw=result(intent,f.end,0,'stopped','stopped'),normalized=normalizeBlowerRuntimeProbeResult(raw,convertBlowerRuntimeProbeIntentRow(intent),id,new Date(f.end));assert.equal(normalized.error,undefined);
  insert(f.sql,'blower_runtime_probe_intents_v5',intent);
  insert(f.sql,'ois_data_requests',{id,request_type:'blower_runtime_probe',target_date:`v1|${a.tag_number}|${START}|${f.end}`,status:'complete',requested_by_id:f.user.employeeNo,requested_by_name:f.user.name,requested_at:new Date(Date.parse(f.end)-1000).toISOString(),started_at:f.end,completed_at:f.end,agent_id:'fixture-agent',result_json:encode(raw),error_message:'',expires_at:new Date(f.now.getTime()+3600000).toISOString(),updated_at:f.end});
  insert(f.sql,'blower_history_events',{id:'dataparc_runtime:'+id,tag_number:a.tag_number,event_type:'runtime_correction',event_date:f.end,runtime_hours:0,issue_type:'',action_type:'RUN 조회',note:'Fixture measured range',source_type:'dataparc_runtime',source_log_id:id,source_text:encode(normalized.result),created_by_id:f.user.employeeNo,created_by_name:f.user.name,created_at:f.end,updated_at:f.end});
  f.sql.prepare("UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,cycle_start_revision=?,cycle_runtime_revision=?,cycle_runtime_hours=0,runtime_hours=0,cycle_runtime_anchor_at=?,cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0 WHERE tag_number=?").run(START,revision,'fixture-runtime:'+a.tag_number,f.end,a.tag_number);
 }
}
test('one public full batch keeps all 27 ordinary append bases, including the corrected FBHE 1A range',async t=>{
 const f=await createFbhe1aRuntimeFixture(t);await f.apply(await f.ready());seedOtherAssets(f);
 const proof=certificate(f),assets=f.sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all();assert.equal(assets.length,27);
 for(const a of assets){const signal=a.tag_number==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.'+a.tag_number+'XB04';assert.ok(await loadAppendBase(f.db,a,signal),a.tag_number);}
 const body={action:'create_blower_runtime_probe_batch',requests:assets.map(a=>({action:'create_blower_runtime_probe',assetTag:a.tag_number,dataParcTag:a.tag_number==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.'+a.tag_number+'XB04',confirmRunSignal:true,unifiedRefresh:true,incrementalRefresh:true,requireIncrementalAppend:true,expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision}))};
 const out=await publicRequest(f,body);assert.equal(out.status,201,encode(out.body));assert.equal(out.body.createdCount,27);
 assert.equal(certificate(f),proof);assert.equal(f.asset().cycle_runtime_hours,99960/3600);
});
test('normal source synchronization preserves the certificate, original owner and all asset counters',async t=>{
 const f=await createFbhe1aRuntimeFixture(t),applied=await f.apply(await f.ready()),proof=certificate(f),before=frozen(f);
 const now=f.now,endDate=new Date(now.getTime()+32400000).toISOString().slice(0,10),fromDate=new Date(now.getTime()+32400000-365*86400000).toISOString().slice(0,10);
 let body={incrementalLogs:true,autoApplyConfirmedReplacements:true,normalizationVersion:4,window:{fromDate,endDate,snapshotAt:now.toISOString()},limit:8},done=false;
 for(let page=0;page<20;page++){
  const response=await history.reflectApprovedReplacementPageV3(f.db,f.user,body,{now}),view=await response.json();assert.equal(response.status,200,encode(view));
  if(view.done){done=true;break;}body={...body,cursor:view.nextCursor};
 }
 assert.equal(done,true);assert.equal(certificate(f),proof);assert.equal(frozen(f),before);assert.ok((await state(f)).fbhe1aRuntimeProof);assert.equal(f.asset().cycle_runtime_hours,99960/3600);
});
