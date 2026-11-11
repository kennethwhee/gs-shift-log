import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {onRequestPost as requestsPost,__oisDataRequestsTest as requests,buildBlowerRuntimeProbeChunks,convertBlowerRuntimeProbeIntentRow,normalizeBlowerRuntimeProbeResult} from '../functions/api/ois-data-requests.js';
import {siloBasisStatus,startSiloBasis,applySiloBasis} from '../functions/_shared/blower-silo-basis-v1.js';
import {loadAppendBase,ensureAppendSchema,SILO_BASIS_TAG as TAG,SILO_BASIS_SIGNAL as SIGNAL,SILO_BASIS_START as START,SILO_BASIS_SEAM as SEAM} from '../functions/_shared/blower-incremental.js';
const NOW=new Date(Math.floor(Date.now()/1000)*1000),END=new Date(NOW.getTime()-7200000).toISOString(),OLD='2026-05-04T00:00:00+09:00',USER={employeeNo:'silo-reviewer',name:'Silo fixture',isSuperAdmin:true};
const line='09:17 [TM 작업] Fly Ash Silo Aeration Blower #B V-Belt 교체 완료';
function insert(sql,t,r){sql.prepare(`INSERT INTO ${t}(${Object.keys(r).join(',')}) VALUES(${Object.keys(r).map(()=>'?').join(',')})`).run(...Object.values(r));}
function result(intent,collectedAt,seconds=0){const p=convertBlowerRuntimeProbeIntentRow(intent),chunks=buildBlowerRuntimeProbeChunks(p.startAt,p.endAt).map((c,i)=>({...c,index:i+1,startState:'stopped',endState:'stopped',runningSeconds:i===0?seconds:0,totalRunningHours:i===0?seconds/3600:0}));return {...p,schemaVersion:1,requestType:'blower_runtime_probe',ok:true,readOnly:true,observedAt:p.endAt,startState:'stopped',endState:'stopped',currentState:'stopped',isRunning:false,chunkDays:31,chunkCount:chunks.length,completedChunkCount:chunks.length,chunks,runningSeconds:seconds,totalRunningHours:seconds/3600,collectedAt};}
async function fixture(){
 const sql=new DatabaseSync(':memory:');const db={sql,beforeBatch:null,maxBindings:0,prepare(query){return {query,bindings:[],bind(...bindings){assert.ok(bindings.length<=100,'D1 bind limit');db.maxBindings=Math.max(db.maxBindings,bindings.length);this.bindings=bindings;return this;},async first(){return sql.prepare(query).get(...this.bindings)||null;},async all(){return {results:sql.prepare(query).all(...this.bindings)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...this.bindings).changes)}};}}},async batch(items){if(db.beforeBatch){const fn=db.beforeBatch;db.beforeBatch=null;fn(sql);}sql.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 await history.ensureSchema(db);sql.exec(`CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,requested_by_id TEXT,requested_by_name TEXT,requested_at TEXT,started_at TEXT,completed_at TEXT,agent_id TEXT,result_json TEXT,error_message TEXT,expires_at TEXT,updated_at TEXT);
 CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);CREATE INDEX idx_silo_shift_date ON shift_logs(work_date,shift,role);
 CREATE TABLE legacy_logs(id INTEGER PRIMARY KEY,legacy_diary_id TEXT UNIQUE,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,entries_json TEXT,original_json TEXT,updated_at TEXT);CREATE INDEX idx_silo_legacy_date ON legacy_logs(work_date,shift,role);
 CREATE TABLE legacy_log_suppressions(legacy_diary_id TEXT,work_date TEXT,shift TEXT,role TEXT,PRIMARY KEY(legacy_diary_id,work_date,shift,role));`);
 await requests.ensureBlowerRuntimeProbeSchema(db);
 sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,cycle_start_revision='',cycle_runtime_revision='tail-runtime',cycle_runtime_hours=1,runtime_hours=1,cycle_runtime_anchor_at=?,cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0 WHERE tag_number=?`).run(OLD,END,TAG);
 for(const role of ['BCO1','BO1','BO2'])insert(sql,'shift_logs',{id:'source-'+role,work_date:'2025-10-23',shift:'DS',role,author:'Masked source',status:'결재완료',log_json:JSON.stringify({entries:[{content:role==='BO2'?'[TM 작업] Fly Ash Silo Aeration Blower #B V-Belt 교체 완료':line}]}),updated_at:'2026-08-01T00:00:00Z'});
 const addEvent=patch=>{const e={id:'owner',tag_number:TAG,event_type:'replacement',event_date:'2025-10-23T00:00:00+09:00',runtime_hours:0,issue_type:'',action_type:'V-Belt 교체',note:'',source_type:'shift_log_history_v13',source_log_id:'source-BCO1',source_text:line,created_by_id:'history',created_by_name:'History',created_at:'2026-08-01T00:00:00Z',updated_at:'2026-08-01T00:00:00Z',...patch};insert(sql,'blower_history_events',e);return e;};
 addEvent({id:'v13:'+TAG+'|2025-10-23'});addEvent({id:'v13:'+TAG+'|2026-05-04',event_type:'_retracted_replacement',event_date:OLD,source_text:'다른 환기팬 교체 기록 오귀속 철회'});
 const intent={request_id:'tail-root',reuse_key:'tail-root',schema_version:1,asset_tag:TAG,dataparc_tag:SIGNAL,window_start:SEAM,window_end:requests.formatKstRfc3339(new Date(END)),chunk_days:31,chunk_count:buildBlowerRuntimeProbeChunks(SEAM,END).length,expected_last_replacement_at:OLD,expected_cycle_start_state:'legacy',expected_cycle_started_at:'',expected_cycle_start_revision:'',expected_cycle_runtime_revision:'old-tail-runtime',created_at:END,updated_at:END};
 const raw=result(intent,END,3600),normalized=normalizeBlowerRuntimeProbeResult(raw,convertBlowerRuntimeProbeIntentRow(intent),'tail-root',new Date(END));assert.equal(normalized.error,undefined);
 insert(sql,'blower_runtime_probe_intents_v5',intent);insert(sql,'ois_data_requests',{id:'tail-root',request_type:'blower_runtime_probe',target_date:`v1|${TAG}|${intent.window_start}|${intent.window_end}`,status:'complete',requested_by_id:USER.employeeNo,requested_by_name:USER.name,requested_at:new Date(Date.parse(END)-1000).toISOString(),started_at:END,completed_at:END,agent_id:'fixture-agent',result_json:JSON.stringify(normalized.result),error_message:'',expires_at:new Date(NOW.getTime()+86400000).toISOString(),updated_at:END});
 addEvent({id:'dataparc_runtime:tail-root',event_type:'runtime_correction',event_date:intent.window_end,runtime_hours:1,source_type:'dataparc_runtime',source_log_id:'tail-root',source_text:JSON.stringify({...normalized.result,expectedCycleRuntimeRevision:'old-tail-runtime'}),created_at:END,updated_at:END});
 const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG),events=()=>sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
 // Use the same spelling as the immutable measured event.
 sql.prepare('UPDATE blower_history_assets SET cycle_runtime_anchor_at=? WHERE tag_number=?').run(intent.window_end,TAG);
 const begin=async(nonce='silo-fixture-nonce-001')=>{const status=await siloBasisStatus(db,USER,{}, {now:NOW});return startSiloBasis(db,USER,{nonce,expectedProofHash:status.proofHash},{now:NOW});};
 const complete=(view,patch)=>{const i=sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(view.request.id),raw=result(i,new Date(NOW.getTime()+1000).toISOString(),100);patch?.(raw);sql.prepare("UPDATE ois_data_requests SET status='complete',completed_at=?,result_json=?,agent_id='fixture-agent',updated_at=? WHERE id=?").run(new Date(NOW.getTime()+1000).toISOString(),JSON.stringify(raw),new Date(NOW.getTime()+1000).toISOString(),view.request.id);return raw;};
 const ready=async()=>{const v=await begin();complete(v);return siloBasisStatus(db,USER,{requestId:v.request.id},{now:new Date(NOW.getTime()+2000)});};
 const apply=async v=>applySiloBasis(db,USER,{requestId:v.request.id,expectedProofHash:v.proofHash,confirmation:'SILO_PREFIX_STITCH'},{now:new Date(NOW.getTime()+2000)});
 return {db,sql,asset,events,addEvent,begin,complete,ready,apply};
}

// This is a synthetic certificate produced through the real recovery path.
// No production receipts, credentials or historian requests are used.
async function recoveredFixture(t){
 const f=await fixture();t.after(()=>f.sql.close());const ready=await f.ready();await f.apply(ready);f.prefixRequestId=ready.request.id;await ensureAppendSchema(f.db);
 f.sql.exec('CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT)');
 insert(f.sql,'users',{employee_no:USER.employeeNo,name:USER.name,role:'super_admin',is_active:1});
 insert(f.sql,'shift_log_sessions',{token_hash:createHash('sha256').update('silo-browser-token').digest('hex'),employee_no:USER.employeeNo,expires_at:new Date(NOW.getTime()+86400000).toISOString(),last_used_at:NOW.toISOString()});
 return f;
}
const signalFor=tag=>tag===TAG?SIGNAL:/^(?:103|203)HRJ/.test(tag)?'GSPOGE.ABB_DCS.'+tag+'XB04':'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_'+tag;
function seedOrdinary(f,tag){
 const id='ordinary-'+tag,signal=signalFor(tag),at=requests.formatKstRfc3339(new Date(END));
 f.sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,
   cycle_start_revision=?,cycle_runtime_revision=?,cycle_runtime_hours=2,runtime_hours=2,cycle_runtime_anchor_at=?,
   cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0 WHERE tag_number=?`).run(OLD,'ordinary-cycle:'+tag,'ordinary-runtime:'+tag,at,tag);
 const intent={request_id:id,reuse_key:id,schema_version:1,asset_tag:tag,dataparc_tag:signal,window_start:OLD,window_end:at,chunk_days:31,
   chunk_count:buildBlowerRuntimeProbeChunks(OLD,at).length,expected_last_replacement_at:OLD,expected_cycle_start_state:'legacy',
   expected_cycle_started_at:'',expected_cycle_start_revision:'ordinary-cycle:'+tag,expected_cycle_runtime_revision:'seed-runtime:'+tag,created_at:END,updated_at:END};
 const raw=result(intent,END,7200);insert(f.sql,'blower_runtime_probe_intents_v5',intent);
 insert(f.sql,'ois_data_requests',{id,request_type:'blower_runtime_probe',target_date:`v1|${tag}|${OLD}|${at}`,status:'complete',requested_by_id:USER.employeeNo,requested_by_name:USER.name,
   requested_at:END,started_at:END,completed_at:END,agent_id:'fixture-agent',result_json:JSON.stringify(raw),error_message:'',expires_at:new Date(NOW.getTime()+86400000).toISOString(),updated_at:END});
 f.addEvent({id:'dataparc_runtime:'+id,tag_number:tag,event_type:'runtime_correction',event_date:at,runtime_hours:2,source_type:'dataparc_runtime',source_log_id:id,source_text:JSON.stringify(raw),created_at:END,updated_at:END});
}
function bodyFor(f,tag){const a=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);return {
 action:'create_blower_runtime_probe',assetTag:tag,dataParcTag:signalFor(tag),confirmRunSignal:true,unifiedRefresh:true,
 incrementalRefresh:true,requireIncrementalAppend:true,expectedLastReplacementAt:a.last_replacement_at,
 expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',expectedCycleStartRevision:a.cycle_start_revision,
 expectedCycleRuntimeRevision:a.cycle_runtime_revision};}
async function batch(f,tags){const response=await requestsPost({env:{DB:f.db},request:new Request('https://fixture.test/api/ois-data-requests',{
 method:'POST',headers:{Authorization:'Bearer silo-browser-token','Content-Type':'application/json','X-ShiftLog-Client':'desktop'},
 body:JSON.stringify({action:'create_blower_runtime_probe_batch',requests:tags.map(tag=>bodyFor(f,tag))})})});return {status:response.status,body:await response.json()};}
const rowsDigest=(f,tables)=>createHash('sha256').update(JSON.stringify(tables.map(t=>[t,f.sql.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]))).digest('hex');
const protectedSnapshot=f=>rowsDigest(f,['blower_history_assets','blower_history_events','blower_history_asset_history']);
const queueSnapshot=f=>rowsDigest(f,['ois_data_requests','blower_runtime_probe_intents_v5','blower_runtime_append_v1']);
function completeQueued(f,id){
 const intent=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(id),collectedAt=new Date().toISOString(),raw=result(intent,collectedAt,10);
 f.sql.prepare("UPDATE ois_data_requests SET status='complete',completed_at=?,updated_at=?,result_json=?,agent_id='fixture-agent' WHERE id=?").run(collectedAt,collectedAt,JSON.stringify(raw),id);return raw;
}
function assertOneGroup(out,count){
 assert.equal(out.status,201,JSON.stringify(out.body));assert.equal(out.body.atomic,true);assert.equal(out.body.createdCount,count);
 const ids=out.body.results.map(r=>r.item.id);assert.equal(ids.length,count);assert.equal(new Set(ids.map(id=>id.slice(0,41))).size,1);
 for(const id of ids)assert.match(id,new RegExp('^brb1_[a-f0-9-]{36}_'+String(count).padStart(2,'0')+'_[0-9]{2}$'));
 return ids;
}
test('recovered Silo and an ordinary asset share one atomic append group without changing any runtime or raw evidence',async t=>{
 const f=await recoveredFixture(t),ordinary='104ETH03AN601';seedOrdinary(f,ordinary);const before=protectedSnapshot(f),raw=f.sql.prepare('SELECT id,result_json FROM ois_data_requests ORDER BY id').all();
 const out=await batch(f,[ordinary,TAG]);assertOneGroup(out,2);assert.equal(protectedSnapshot(f),before);
 for(const original of raw)assert.equal(f.sql.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(original.id).result_json,original.result_json);
 const receipts=f.sql.prepare('SELECT * FROM blower_runtime_append_v1 ORDER BY request_id').all();assert.equal(receipts.length,2);
 const silo=out.body.results.find(r=>r.assetTag===TAG),receipt=receipts.find(r=>r.request_id===silo.item.id);
 assert.equal(receipt.base_event_id,'dataparc_silo_basis:'+f.prefixRequestId);assert.equal(receipt.coverage_start_at,START);assert.equal(receipt.base_running_seconds,3700);
 assert.equal(Date.parse(silo.item.probe.startAt),Date.parse(f.asset().cycle_runtime_anchor_at));assert.notEqual(Date.parse(silo.item.probe.startAt),Date.parse(START));
});
test('all 27 valid measured assets queue in the same group with 27 bounded append receipts',async t=>{
 const f=await recoveredFixture(t),tags=f.sql.prepare('SELECT tag_number FROM blower_history_assets WHERE enabled=1 ORDER BY tag_number').all().map(r=>r.tag_number);assert.equal(tags.length,27);
 for(const tag of tags)if(tag!==TAG)seedOrdinary(f,tag);
 const prepare=f.db.prepare,strictTags=[];f.db.prepare=query=>{const statement=prepare(query);if(query.startsWith('SELECT * FROM blower_history_events\n    WHERE tag_number = ? AND event_type IN')){const all=statement.all;statement.all=async function(){strictTags.push(this.bindings[0]);return all.call(this);};}return statement;};
 const before=protectedSnapshot(f),out=await batch(f,tags),ids=assertOneGroup(out,27);assert.deepEqual(strictTags,[TAG],'ordinary 26 assets retain the original bulk path');
 assert.equal(protectedSnapshot(f),before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_runtime_append_v1').get().n,27);
 for(const item of out.body.results){const a=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(item.assetTag),i=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(item.item.id);
  assert.equal(Date.parse(i.window_start),Date.parse(a.cycle_runtime_anchor_at));assert.ok(Date.parse(i.window_end)-Date.parse(i.window_start)<86400000);assert.equal(i.expected_cycle_runtime_revision,'append-v1:'+a.cycle_runtime_revision);assert.ok(ids.includes(item.item.id));}
});
for(const status of ['pending','complete'])test(status+' request reuse still validates the current recovered certificate and avoids duplicate queue rows',async t=>{
 const f=await recoveredFixture(t),first=await batch(f,[TAG]);const [id]=assertOneGroup(first,1);if(status==='complete')completeQueued(f,id);
 const before=queueSnapshot(f),out=await batch(f,[TAG]);assert.equal(out.status,200,JSON.stringify(out.body));assert.equal(out.body.results[0].item.id,id);
 assert.equal(out.body.results[0].disposition,status==='pending'?'reused_active':'reused_complete');assert.equal(queueSnapshot(f),before);
 f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BO1'").run();const changed=queueSnapshot(f),blocked=await batch(f,[TAG]);
 assert.equal(blocked.status,409);assert.equal(blocked.body.code,'BLOWER_INCREMENTAL_BASE_REQUIRED');assert.equal(queueSnapshot(f),changed);
});
const tamperCases=[
 ['missing certificate',f=>f.sql.prepare("DELETE FROM blower_history_events WHERE source_type='dataparc_silo_basis_v1'").run()],
 ['changed replacement owner',f=>f.sql.prepare("UPDATE blower_history_events SET note='changed owner' WHERE id=?").run('v13:'+TAG+'|2025-10-23')],
 ['revoked approval',f=>f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BO1'").run()],
 ['same-stamp source edit',f=>f.sql.prepare("UPDATE shift_logs SET log_json=replace(log_json,'09:17','09:18') WHERE role='BCO1'").run()],
 ['changed prefix raw result',f=>f.sql.prepare("UPDATE ois_data_requests SET result_json='{}' WHERE id=?").run(f.prefixRequestId)],
 ['changed recovery audit',f=>f.sql.prepare("UPDATE blower_history_asset_history SET after_json='{}' WHERE action_type='silo_prefix_basis_recovery'").run()],
 ['changed prefix intent',f=>f.sql.prepare("UPDATE blower_runtime_probe_intents_v5 SET reuse_key='changed' WHERE request_id=?").run(f.prefixRequestId)],
 ['changed old tail raw result',f=>f.sql.prepare("UPDATE ois_data_requests SET result_json='{}' WHERE id='tail-root'").run()]
];
for(const [name,tamper] of tamperCases)test(name+' rejects the whole mixed batch without enqueueing or falling back to a full query',async t=>{
 const f=await recoveredFixture(t),ordinary='104ETH03AN601';seedOrdinary(f,ordinary);tamper(f);const before=protectedSnapshot(f),queueBefore=queueSnapshot(f),out=await batch(f,[ordinary,TAG]);
 assert.equal(out.status,409,JSON.stringify(out.body));assert.equal(out.body.code,'BLOWER_INCREMENTAL_BASE_REQUIRED');assert.equal(out.body.failedIndex,1);assert.equal(out.body.assetTag,TAG);
 assert.equal(protectedSnapshot(f),before);assert.equal(queueSnapshot(f),queueBefore);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM ois_data_requests WHERE status='pending'").get().n,0);
});
test('a source change after queue creation still rejects measured append application without changing the recovered total',async t=>{
 const f=await recoveredFixture(t),out=await batch(f,[TAG]),[id]=assertOneGroup(out,1);completeQueued(f,id);
 f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BO1'").run();const before=protectedSnapshot(f);
 const response=await history.applyDataParcRuntimeSync(f.db,USER,{requestId:id}),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));
 assert.equal(body.code,'DATAPARC_APPEND_BASE_CHANGED');assert.equal(protectedSnapshot(f),before);assert.equal(f.asset().cycle_runtime_hours,3700/3600);
});
test('measured results from the mixed batch append once and retain the Silo certificate lineage',async t=>{
 const f=await recoveredFixture(t),ordinary='104ETH03AN601';seedOrdinary(f,ordinary);const out=await batch(f,[ordinary,TAG]);assertOneGroup(out,2);
 for(const item of out.body.results){completeQueued(f,item.item.id);const response=await history.applyDataParcRuntimeSync(f.db,USER,{requestId:item.item.id}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));}
 assert.equal(Math.round(f.asset().cycle_runtime_hours*3600),3710);
 assert.equal(Math.round(f.sql.prepare('SELECT cycle_runtime_hours FROM blower_history_assets WHERE tag_number=?').get(ordinary).cycle_runtime_hours*3600),7210);
 const base=await loadAppendBase(f.db,f.asset(),SIGNAL);assert.equal(base.runningSeconds,3710);assert.equal(base.siloBasis.prefixRequestId,f.prefixRequestId);
 const again=await history.applyDataParcRuntimeSync(f.db,USER,{requestId:out.body.results.find(r=>r.assetTag===TAG).item.id});assert.equal(again.status,200);assert.equal(Math.round(f.asset().cycle_runtime_hours*3600),3710);
});
