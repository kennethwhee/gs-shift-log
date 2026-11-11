import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {__blowerHistoryTest as history,onRequestPost as historyPost} from '../../functions/api/blower-history.js';
import {__oisDataRequestsTest as requests,onRequestPost as requestPost,convertBlowerRuntimeProbeIntentRow,buildBlowerRuntimeProbeChunks,normalizeBlowerRuntimeProbeResult} from '../../functions/api/ois-data-requests.js';
import {loadFbhe2cStandbyApprovedCompletion,fbhe2cStandbyStatus,applyFbhe2cStandby} from '../../functions/_shared/blower-fbhe2c-standby-v1.js';
import {COMPLETION_WINDOW_PREFIX,COMPLETION_WINDOW_START,COMPLETION_WINDOW_END,ensureCompletionWindowSchema,loadCompletionWindowRecoveryProof,loadCompletionWindowRecoveryReview,persistCompletionWindowRecoveryReview} from '../../functions/_shared/blower-completion-window-v1.js';
import {loadAppendBase,ensureAppendSchema} from '../../functions/_shared/blower-incremental.js';
export const TAG='204HHL60AP631',SIGNAL='GSPOGE.ABB_DCS.204HHL60AP631XB04',START='2026-09-16T00:00:00+09:00',SEAM='2026-09-17T00:00:00+09:00';
export const USER={employeeNo:'fbhe2c-fixture-operator',name:'Fixture operator',isSuperAdmin:true};
export const OWNER='5f022645-7303-4bea-93da-f5afffda4fcc',ROLE_OWNER='replacement-auto-v3:confirm:fbhe2c-fixture-source';
export const RANGE='2026-09-16T09:30:00+09:00';
export const COMPLETION='FBHE Blower #C->#B 교체운전 실시\n- FBHE Blower #C V-Belt 교체 완료(동일->TR)\n- FBHE Left Damper 조정 실시';
export const BO_COMPLETION='[TM] 09:23 FBHE Blower #C V-Blet 전체 교체 실시\n- 교체운전 실시 (#C 정지, #B 기동)\n- V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)\n- FBHE Left Damper 조정 실시';
export const BROWSER_TOKEN='fbhe2c-browser-token';
export function insert(sql,table,row){sql.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));}
export function result(intent,collectedAt,seconds=0,startState='stopped',endState='stopped'){
 const p=convertBlowerRuntimeProbeIntentRow(intent),chunks=buildBlowerRuntimeProbeChunks(p.startAt,p.endAt).map((c,n,a)=>{const runningSeconds=Math.floor(seconds/a.length)+(n===0?seconds%a.length:0);return {...c,index:n+1,startState:n===0?startState:'stopped',endState:n===a.length-1?endState:'stopped',runningSeconds,totalRunningHours:runningSeconds/3600};});
 chunks[0].startAt=p.startAt;chunks.at(-1).endAt=p.endAt;
 return {...p,schemaVersion:1,requestType:'blower_runtime_probe',ok:true,readOnly:true,observedAt:p.endAt,startState,endState,currentState:endState,isRunning:endState==='running',chunkDays:31,chunkCount:chunks.length,completedChunkCount:chunks.length,chunks,runningSeconds:seconds,totalRunningHours:seconds/3600,collectedAt};
}
export async function createFbhe2cStandbyFixture(t,options={}){
 const now=new Date(Math.floor(Date.now()/1000)*1000),end=requests.formatKstRfc3339(new Date(now.getTime()-7200000)),sql=new DatabaseSync(':memory:');t?.after(()=>sql.close());
 const db={sql,beforeBatch:null,maxBindings:0,prepare(query){return {query,bindings:[],bind(...bindings){assert.ok(bindings.length<=100,'D1 bind limit');db.maxBindings=Math.max(db.maxBindings,bindings.length);this.bindings=bindings;return this;},async first(){return sql.prepare(query).get(...this.bindings)||null;},async all(){return {results:sql.prepare(query).all(...this.bindings)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...this.bindings).changes)}};}};},async batch(items){if(db.beforeBatch){const fn=db.beforeBatch;db.beforeBatch=null;fn(sql);}sql.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 await history.ensureSchema(db);
 sql.exec(`CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,requested_by_id TEXT,requested_by_name TEXT,requested_at TEXT,started_at TEXT,completed_at TEXT,agent_id TEXT,result_json TEXT,error_message TEXT,expires_at TEXT,updated_at TEXT);
 CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);CREATE INDEX fixture_shift_date ON shift_logs(work_date,shift,role);
 CREATE TABLE legacy_logs(id INTEGER PRIMARY KEY,legacy_diary_id TEXT UNIQUE,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,entries_json TEXT,original_json TEXT,updated_at TEXT);CREATE INDEX fixture_legacy_date ON legacy_logs(work_date,shift,role);
 CREATE TABLE legacy_log_suppressions(legacy_diary_id TEXT,work_date TEXT,shift TEXT,role TEXT,PRIMARY KEY(legacy_diary_id,work_date,shift,role));
 CREATE TABLE blower_log_receipts_v1(log_id TEXT PRIMARY KEY,source_snapshot TEXT NOT NULL,replacement_done INTEGER NOT NULL DEFAULT 0,operation_done INTEGER NOT NULL DEFAULT 0,processed_at TEXT NOT NULL);
 CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);`);
 await requests.ensureBlowerRuntimeProbeSchema(db);await ensureAppendSchema(db);
 insert(sql,'users',{employee_no:USER.employeeNo,name:USER.name,role:'super_admin',is_active:1});insert(sql,'shift_log_sessions',{token_hash:createHash('sha256').update(BROWSER_TOKEN).digest('hex'),employee_no:USER.employeeNo,expires_at:new Date(now.getTime()+86400000).toISOString(),last_used_at:now.toISOString()});
 const sourceId=role=>'legacy-POCHEON#20260916#DAY#'+role,entryId=role=>'legacy-entry-POCHEON#20260916#DAY#'+role+'-2-0';
 for(const role of ['BCO2','BO2'])insert(sql,'shift_logs',{id:sourceId(role),work_date:'2026-09-16',shift:'DS',role,author:'Masked '+role,status:'결재완료',log_json:JSON.stringify({entries:[{id:entryId(role),time:role==='BCO2'?'09:23':'',content:role==='BCO2'?COMPLETION:BO_COMPLETION,legacyBodyIndex:2,legacyLineIndex:0,importedFromEntryIndex:0}]}),updated_at:'2026-11-03T20:17:49Z'});
 const startRev='de920f95-7aeb-474e-98a3-7a7d64bae658';
 sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='pending',cycle_started_at=NULL,cycle_start_revision=?,cycle_runtime_revision='tail-runtime',cycle_runtime_hours=1,runtime_hours=1,cycle_runtime_anchor_at=?,cycle_runtime_state='running',runtime_anchor_at=?,is_running=1 WHERE tag_number=?`).run(START,startRev,end,end,TAG);
 const source=await loadFbhe2cStandbyApprovedCompletion(db,{now}),hash=source.hashes.find(row=>row.sourceLogId.endsWith('#BO2')).sourceSnapshotSha256;
 const ownerMeta={schemaVersion:3,replacementAutoV3:true,currentCycle:true,replacementEventId:OWNER,currentLastReplacementAt:START,recordDate:'2026-09-16',timePrecision:'day',cycleStartRevision:startRev,cycleRuntimeRevision:'seed-runtime',sourcePhysicalId:'POCHEON#20260916#DAY#BO2',sourceSnapshotSha256:hash,sourceKey:JSON.stringify([sourceId('BO2'),TAG,entryId('BO2'),4]),normalizationVersion:4,rangeTrackingAllowed:true,rangeStartAt:RANGE,registeredBaseline:true,registeredRuntimeRange:true,basisKind:'verified_runtime_range',preservedRuntimeEventId:'dataparc_runtime:tail-root',sourceWorkDate:'2026-09-16',sourceShift:'DS',runtimeAtReplacementKnown:false,previousStoredCounterPreserved:true,sourceText:BO_COMPLETION};
 const addEvent=patch=>{const row={id:OWNER,tag_number:TAG,event_type:'replacement',event_date:START,runtime_hours:0,issue_type:'업무일지 교체완료',action_type:'교체',note:'완료시각 미기록 · 날짜 보관용',source_type:'manual',source_log_id:'',source_text:'',created_by_id:'fixture-history',created_by_name:'Fixture history',created_at:'2026-11-03T20:17:49Z',updated_at:'2026-11-03T20:17:49Z',...patch};insert(sql,'blower_history_events',row);return row;};addEvent({});
 const roleMeta={...ownerMeta,confirmationOnly:true};
 addEvent({id:ROLE_OWNER,event_type:'cycle_source_reconcile',event_date:'2026-11-03T20:17:49Z',source_type:'shift_log_auto_v3',source_log_id:sourceId('BO2'),source_text:JSON.stringify(roleMeta)});
 // These fixed historical owner IDs already resulted from approved-source
 // processing; preserve that state with the exact current role-context receipts.
 for(const row of source.sources)insert(sql,'blower_log_receipts_v1',{log_id:row.receiptId,source_snapshot:row.source_snapshot,replacement_done:1,operation_done:0,processed_at:now.toISOString()});
 const addRequest=(intent,raw,collected)=>{insert(sql,'blower_runtime_probe_intents_v5',intent);insert(sql,'ois_data_requests',{id:intent.request_id,request_type:'blower_runtime_probe',target_date:`v1|${TAG}|${intent.window_start}|${intent.window_end}`,status:'complete',requested_by_id:USER.employeeNo,requested_by_name:USER.name,requested_at:new Date(Date.parse(collected)-1000).toISOString(),started_at:collected,completed_at:collected,agent_id:'fixture-agent',result_json:JSON.stringify(raw),error_message:'',expires_at:new Date(Date.parse(collected)+3600000).toISOString(),updated_at:collected});};
 const tailIntent={request_id:'tail-root',reuse_key:'tail-root',schema_version:1,asset_tag:TAG,dataparc_tag:SIGNAL,window_start:RANGE,window_end:end,chunk_days:31,chunk_count:buildBlowerRuntimeProbeChunks(RANGE,end).length,expected_last_replacement_at:START,expected_cycle_start_state:'legacy',expected_cycle_started_at:'',expected_cycle_start_revision:'signal-only-v1:'+startRev,expected_cycle_runtime_revision:'seed-runtime',created_at:end,updated_at:end};
 const rawTail=result(tailIntent,end,3600,'stopped','running'),normalized=normalizeBlowerRuntimeProbeResult(rawTail,convertBlowerRuntimeProbeIntentRow(tailIntent),'tail-root',new Date(end));assert.equal(normalized.error,undefined);addRequest(tailIntent,rawTail,end);
 addEvent({id:'dataparc_runtime:tail-root',event_type:'runtime_correction',event_date:end,runtime_hours:1,source_type:'dataparc_runtime',source_log_id:'tail-root',source_text:JSON.stringify({...normalized.result,expectedCycleStartRevision:startRev,signalOnlyCycle:true}),created_at:new Date(end).toISOString(),updated_at:new Date(end).toISOString()});
 const requestId='00000000-0000-4000-8000-000000000094',collected=new Date(now.getTime()-(options.archiveDays??2)*86400000).toISOString(),stop=options.lastRunStoppedAt??'2026-09-16T09:28:25.171+09:00';
 const witnessIntent={...tailIntent,request_id:requestId,reuse_key:'r9-fixture',window_start:START,window_end:SEAM,chunk_count:1,expected_cycle_runtime_revision:'r7-evidence-only-v1:r9_signal_v1:tail-runtime',created_at:collected,updated_at:collected};
 const witness=result(witnessIntent,collected,34105,'running','stopped');Object.assign(witness,{trailingStateStartedAt:stop});Object.assign(witness.chunks[0],{eventSource:'dataparc_fnValTime_intervals_v1',runPeriods:[{startAt:START,endAt:stop,startKind:'window_boundary',endKind:'stop_signal'}]});addRequest(witnessIntent,witness,collected);
 const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG),events=()=>sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
 const attestation=view=>({version:1,completionDay:'2026-09-16',lastRunStoppedAt:view.witness.lastRunStoppedAt,replacementCompletedAfterStop:true,noRestartThroughWindowEnd:true,zeroWindowEndAt:SEAM,statementCode:'BELT_COMPLETED_AFTER_LAST_STOP_AND_REMAINED_STANDBY_THROUGH_WINDOW_END'});
 const status=()=>fbhe2cStandbyStatus(db,USER,{requestId},{now}),apply=view=>applyFbhe2cStandby(db,USER,{requestId,expectedProofHash:view.proofHash,confirmation:'FBHE_2C_STANDBY_20260916',attestation:attestation(view)},{now});
 return {sql,db,now,end,user:USER,requestId,asset,events,addEvent,addRequest,status,apply,attestation,roleOwnerId:ROLE_OWNER};
}
export async function ordinaryAppend(f,seconds=10){
 const asset=f.asset(),base=await loadAppendBase(f.db,asset,SIGNAL);assert.ok(base);const end=requests.formatKstRfc3339(new Date(f.now.getTime()+1000)),id='ordinary-append';
 const intent={request_id:id,reuse_key:'append-fixture',schema_version:1,asset_tag:TAG,dataparc_tag:SIGNAL,window_start:requests.formatKstRfc3339(new Date(base.observedAt)),window_end:end,chunk_days:31,chunk_count:1,expected_last_replacement_at:asset.last_replacement_at,expected_cycle_start_state:'legacy',expected_cycle_started_at:'',expected_cycle_start_revision:'signal-only-v1:'+asset.cycle_start_revision,expected_cycle_runtime_revision:'append-v1:'+asset.cycle_runtime_revision,created_at:end,updated_at:end};
 const raw=result(intent,end,seconds,base.state,'running');f.addRequest(intent,raw,end);insert(f.sql,'blower_runtime_append_v1',{request_id:id,base_event_id:base.eventId,base_revision:asset.cycle_runtime_revision,base_observed_at:base.observedAt,coverage_start_at:base.startAt,base_running_seconds:base.runningSeconds,created_at:end});
 const response=await history.applyDataParcRuntimeSync(f.db,USER,{requestId:id},{now:new Date(f.now.getTime()+2000)}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
}
export async function publicHistory(f,body){const response=await historyPost({env:{DB:f.db},request:new Request('https://fixture.test/api/blower-history',{method:'POST',headers:{Authorization:'Bearer '+BROWSER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};}
export async function publicRequest(f,body){const response=await requestPost({env:{DB:f.db},request:new Request('https://fixture.test/api/ois-data-requests',{method:'POST',headers:{Authorization:'Bearer '+BROWSER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};}

export async function installNegativeCompletionReview(f){
 await ensureCompletionWindowSchema(f.db);
 const proof=await loadCompletionWindowRecoveryProof(f.db,f.asset(),{now:f.now,allowCompletedReview:true});
 const id='historical-negative-325',collected=new Date(f.now.getTime()-3600000).toISOString(),a=f.asset();
 const intent={request_id:id,reuse_key:COMPLETION_WINDOW_PREFIX+'fixture-negative',schema_version:1,asset_tag:TAG,dataparc_tag:SIGNAL,window_start:COMPLETION_WINDOW_START,window_end:COMPLETION_WINDOW_END,chunk_days:31,chunk_count:1,expected_last_replacement_at:a.last_replacement_at,expected_cycle_start_state:'legacy',expected_cycle_started_at:'',expected_cycle_start_revision:'signal-only-v1:'+a.cycle_start_revision,expected_cycle_runtime_revision:COMPLETION_WINDOW_PREFIX+a.cycle_runtime_revision,created_at:collected,updated_at:collected};
 f.addRequest(intent,result(intent,collected,325,'running','stopped'),collected);
 insert(f.sql,'blower_completion_window_intents_v1',{request_id:id,version:1,asset_tag:TAG,start_at:COMPLETION_WINDOW_START,end_at:COMPLETION_WINDOW_END,snapshot_sha256:proof.snapshotSha256,snapshot_json:proof.snapshotJson,created_at:collected});
 const read=await loadCompletionWindowRecoveryReview(f.db,f.asset(),f.events(),{now:f.now});
 assert.equal(read?.requestId,id);assert.equal(read.runningSeconds,325);assert.equal(read.reasonCode,'RUN_OBSERVED');
 const saved=await persistCompletionWindowRecoveryReview(f.db,f.asset(),f.events(),{now:f.now});assert.equal(saved.requestId,id);
 return {requestId:id,review:saved,row:f.sql.prepare('SELECT * FROM blower_completion_window_outcomes_v1 WHERE request_id=?').get(id)};
}
