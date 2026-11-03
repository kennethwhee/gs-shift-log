import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';

// Exact Bag B saved asset and five owned evidence rows from the R3 actual-data
// replay (00:12 receipt, not the later 04:59 screenshot). The RUN completion
// below is synthetic and verifies protocol/application safety only.
const ACTUAL = {"asset":{"tag_number":"104ETG30AN602","blower_type":"flyash_bag","unit_no":"1","position_label":"#B","display_name":"#1 Fly Ash Bag Filter Aeration Blower #B","sort_order":502,"enabled":1,"last_replacement_at":"2026-09-25T05:40:00.000Z","runtime_hours":400.1322222222222,"runtime_anchor_at":"2026-11-03T15:12:58.000Z","is_running":1,"last_modified_by_id":"2014081","last_modified_by_name":"이휘근","created_at":"2026-08-26T00:23:08.335Z","updated_at":"2026-11-03T15:13:42.724Z","asset_group":"","asset_revision":"","cycle_started_at":"2026-10-17T23:04:00.000Z","cycle_start_state":"started","cycle_start_revision":"c98c5f4f-1ee0-47a9-8bf6-360e68f51ace","cycle_runtime_hours":400.1322222222222,"cycle_runtime_anchor_at":"2026-11-03T15:12:58.000Z","cycle_runtime_state":"running","cycle_runtime_revision":"cf652210-4172-4a0d-85ad-2535de02312e","limestone_basis_confirmation":""},"events":[{"id":"1e50d394-5719-4bae-9456-8008df1ee0ea","tag_number":"104ETG30AN602","event_type":"replacement","event_date":"2026-09-25T05:40:00.000Z","runtime_hours":3270.692777777778,"issue_type":"정기주기","action_type":"V-Belt 교체","note":"최신화 시 업무일지의 확정 V-Belt 교체 자동반영","source_type":"shift_log_auto","source_log_id":"legacy-POCHEON#20260925#DAY#BCO1","source_text":"Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 완료_TM 작업","created_by_id":"latest_replacement_auto","created_by_name":"업무일지 최신화 V-Belt 자동반영","created_at":"2026-10-20T09:20:27.067Z","updated_at":"2026-10-20T09:20:27.067Z"},{"id":"dataparc_runtime:brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_03","tag_number":"104ETG30AN602","event_type":"runtime_correction","event_date":"2026-11-03T15:12:58.000Z","runtime_hours":400.1322222222222,"issue_type":"DataPARC","action_type":"DataPARC 운전중 동기화","note":"DataPARC 증분조회 2026-11-03T13:56:34.000Z ~ 2026-11-03T15:12:58.000Z · 추가 1.2733333333333334시간 · 누적 400.1322222222222시간","source_type":"dataparc_runtime","source_log_id":"brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_03","source_text":"{\"schemaVersion\":1,\"requestType\":\"blower_runtime_probe\",\"requestId\":\"brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_03\",\"assetTag\":\"104ETG30AN602\",\"dataParcTag\":\"GSPOGE.ABB_DCS.103ETG30AN602XJ04\",\"startAt\":\"2026-11-03T13:56:34.000Z\",\"endAt\":\"2026-11-03T15:12:58.000Z\",\"observedAt\":\"2026-11-03T15:12:58.000Z\",\"expectedLastReplacementAt\":\"2026-09-25T05:40:00.000Z\",\"expectedCycleStartState\":\"started\",\"expectedCycleStartedAt\":\"2026-10-17T23:04:00.000Z\",\"expectedCycleStartRevision\":\"c98c5f4f-1ee0-47a9-8bf6-360e68f51ace\",\"expectedCycleRuntimeRevision\":\"1690921b-aa8c-44e1-a7b0-31741d2fbc57\",\"startState\":\"running\",\"endState\":\"running\",\"totalRunningHours\":1.273333,\"runningSeconds\":4584,\"chunkCount\":1,\"collectedAt\":\"2026-11-03T15:13:31.926Z\",\"incremental\":{\"version\":1,\"baseEventId\":\"dataparc_runtime:brb1_a1346944-fcc6-4232-8da2-172293604fb3_27_03\",\"baseObservedAt\":\"2026-11-03T13:56:34.000Z\",\"coverageStartAt\":\"2026-10-17T23:04:00.000Z\",\"baseRunningSeconds\":1435892,\"deltaRunningSeconds\":4584,\"totalRunningSeconds\":1440476}}","created_by_id":"2014081","created_by_name":"이휘근","created_at":"2026-11-03T15:13:42.724Z","updated_at":"2026-11-03T15:13:42.724Z"},{"id":"replacement-auto-v3:confirm:7e5aea13ea9fea6fdc03dea9b13c93d863f4667552a83b088f59190bf1633c0a","tag_number":"104ETG30AN602","event_type":"cycle_source_reconcile","event_date":"2026-11-03T15:43:00.000Z","runtime_hours":0,"issue_type":"업무일지 교체완료","action_type":"교체 근거 재해석","note":"승인 업무일지 교체완료를 기존 등록 교체와 대조·자동 확인 · 누적시간과 Cycle 변경 없음","source_type":"shift_log_auto_v3","source_log_id":"legacy-POCHEON#20260925#DAY#BCO1","source_text":"{\"schemaVersion\":3,\"replacementAutoV3\":true,\"currentCycle\":true,\"confirmationOnly\":true,\"replacementEventId\":\"1e50d394-5719-4bae-9456-8008df1ee0ea\",\"currentLastReplacementAt\":\"2026-09-25T05:40:00.000Z\",\"timePrecision\":\"minute\",\"recordDate\":\"2026-09-25\",\"registeredBaseline\":false,\"cycleStartRevision\":\"c98c5f4f-1ee0-47a9-8bf6-360e68f51ace\",\"cycleRuntimeRevision\":\"cf652210-4172-4a0d-85ad-2535de02312e\",\"sourceKey\":\"[\\\"legacy-POCHEON#20260925#DAY#BCO1\\\",\\\"104ETG30AN602\\\",\\\"legacy-entry-POCHEON#20260925#DAY#BCO1-2-5\\\",0]\",\"sourcePhysicalId\":\"POCHEON#20260925#DAY#BCO1\",\"sourceSnapshotSha256\":\"3af0a328e4ae20873d498c871c07a1ad21801e5e692e85fc135afc150e88ddb4\",\"sourceText\":\"Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 완료_TM 작업\"}","created_by_id":"latest_replacement_auto","created_by_name":"업무일지 최신화 V-Belt 자동반영","created_at":"2026-11-03T15:43:00.000Z","updated_at":"2026-11-03T15:43:00.000Z"},{"id":"replacement-auto-v3:confirm:89a56c38035b250f158d57e68a436bc1fd1be0d56ef3d5a7f9e950250e3b091f","tag_number":"104ETG30AN602","event_type":"cycle_source_reconcile","event_date":"2026-11-03T15:43:00.000Z","runtime_hours":0,"issue_type":"업무일지 교체완료","action_type":"교체 근거 재해석","note":"승인 업무일지 교체완료를 기존 등록 교체와 대조·자동 확인 · 누적시간과 Cycle 변경 없음","source_type":"shift_log_auto_v3","source_log_id":"legacy-POCHEON#20260925#DAY#BO1","source_text":"{\"schemaVersion\":3,\"replacementAutoV3\":true,\"currentCycle\":true,\"confirmationOnly\":true,\"replacementEventId\":\"1e50d394-5719-4bae-9456-8008df1ee0ea\",\"currentLastReplacementAt\":\"2026-09-25T05:40:00.000Z\",\"timePrecision\":\"day\",\"recordDate\":\"2026-09-25\",\"registeredBaseline\":true,\"cycleStartRevision\":\"c98c5f4f-1ee0-47a9-8bf6-360e68f51ace\",\"cycleRuntimeRevision\":\"cf652210-4172-4a0d-85ad-2535de02312e\",\"sourceKey\":\"[\\\"legacy-POCHEON#20260925#DAY#BO1\\\",\\\"104ETG30AN602\\\",\\\"legacy-entry-POCHEON#20260925#DAY#BO1-2-0\\\",0]\",\"sourcePhysicalId\":\"POCHEON#20260925#DAY#BO1\",\"sourceSnapshotSha256\":\"b274a286197d8af946dbca5881e67a16fd607bdfd9c5c4760df6866b645c2046\",\"normalizationVersion\":4,\"registeredRuntimeRange\":true,\"basisKind\":\"verified_runtime_range\",\"rangeTrackingAllowed\":true,\"rangeStartAt\":\"2026-10-17T23:04:00.000Z\",\"preservedRuntimeEventId\":\"dataparc_runtime:brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_03\",\"sourceText\":\"Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 실시\"}","created_by_id":"latest_replacement_auto","created_by_name":"업무일지 최신화 V-Belt 자동반영","created_at":"2026-11-03T15:43:00.000Z","updated_at":"2026-11-03T15:43:00.000Z"},{"id":"operation-auto:166c2f90:start","tag_number":"104ETG30AN602","event_type":"startup","event_date":"2026-10-17T23:04:00.000Z","runtime_hours":0,"issue_type":"","action_type":"교체운전 자동 기동","note":"업무일지 교체운전 문구에서 자동 반영","source_type":"shift_log_operation_auto","source_log_id":"legacy-POCHEON#20261018#DAY#GROUP_LEADER","source_text":"08:04 Fly Ash Aeration Blower #A 정지 -> #B 기동","created_by_id":"operation_auto","created_by_name":"업무일지 교체운전 자동","created_at":"2026-10-27T18:10:53.065Z","updated_at":"2026-10-27T18:10:53.065Z"}]};
const API_URL=new URL('../functions/api/ois-data-requests.js',import.meta.url);
const source=fs.readFileSync(API_URL,'utf8').replace(/from (["'])(\.\.?\/[^"']+)\1/g,
 (_,quote,relative)=>'from '+JSON.stringify(new URL(relative,API_URL).href));
const {__confirmedGapQueueR4:queue}=await import('data:text/javascript;base64,'+Buffer.from(source+
 '\nexport const __confirmedGapQueueR4={createBlowerRuntimeProbeRequest,buildBlowerRuntimeProbeChunks};').toString('base64'));
const TAG=ACTUAL.asset.tag_number;
const SIGNAL=JSON.parse(ACTUAL.events.find(row=>row.source_type==='dataparc_runtime').source_text).dataParcTag;
const OWNER={employeeNo:'gap-recovery-test-owner',name:'Recovery fixture',isSuperAdmin:false};
const TOKEN='gap-recovery-local-session';
const NOW=new Date(Math.floor(Date.now()/1000)*1000);
const parse=async response=>({status:response.status,body:await response.json()});

async function fixture(t){
 const sql=new DatabaseSync(':memory:'); t.after(()=>sql.close());
 const db={prepare(text){return {text,values:[],bind(...values){this.values=values;return this;},
  async run(){return {meta:{changes:Number(sql.prepare(text).run(...this.values).changes)}};},
  async first(){return sql.prepare(text).get(...this.values)||null;},
  async all(){return {results:sql.prepare(text).all(...this.values)};}};},
  async batch(items){sql.exec('BEGIN IMMEDIATE');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 await history.ensureSchema(db);
 sql.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
 CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
 CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY NOT NULL,request_type TEXT NOT NULL,target_date TEXT NOT NULL,
 status TEXT NOT NULL,requested_by_id TEXT NOT NULL,requested_by_name TEXT NOT NULL,requested_at TEXT NOT NULL,
 started_at TEXT,completed_at TEXT,agent_id TEXT NOT NULL DEFAULT '',result_json TEXT,error_message TEXT NOT NULL DEFAULT '',
 expires_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
 sql.prepare('INSERT INTO users VALUES(?,?,?,?)').run(OWNER.employeeNo,OWNER.name,'user',1);
 sql.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(TOKEN).digest('hex'),OWNER.employeeNo,
  new Date(NOW.getTime()+86400000).toISOString(),NOW.toISOString());
 const keys=Object.keys(ACTUAL.asset).filter(key=>key!=='tag_number');
 sql.prepare('UPDATE blower_history_assets SET '+keys.map(key=>key+'=?').join(',')+' WHERE tag_number=?')
  .run(...keys.map(key=>ACTUAL.asset[key]),TAG);
 for(const event of ACTUAL.events){const keys=Object.keys(event);sql.prepare('INSERT INTO blower_history_events ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>event[key]));}
 const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG);
 const events=()=>sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
 const before=asset(),originalEvents=events();
 function body(){const a=asset();return {action:'create_blower_runtime_probe',assetTag:TAG,dataParcTag:SIGNAL,confirmRunSignal:true,
  unifiedRefresh:true,incrementalRefresh:false,requireIncrementalAppend:false,startAt:a.last_replacement_at,
  expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,
  expectedCycleStartedAt:a.cycle_started_at||'',expectedCycleStartRevision:a.cycle_start_revision,
  expectedCycleRuntimeRevision:a.cycle_runtime_revision};}
 const create=async(payload=body(),token=TOKEN,now=NOW)=>parse(await queue.createBlowerRuntimeProbeRequest(
  {request:new Request('https://example.test/api/ois-data-requests',{headers:token?{Authorization:'Bearer '+token}:{}}),env:{DB:db}},payload,{now}));
 async function completed(payload=body(),secondsOverride=null,now=NOW){
  const created=await create(payload,TOKEN,now);assert.equal(created.status,201,JSON.stringify(created.body));
  const probe=created.body.item.probe;
  const seconds=secondsOverride ?? Math.round(before.cycle_runtime_hours*3600)+3600;
  const duration=(Date.parse(probe.endAt)-Date.parse(probe.startAt))/1000;let accounted=0;
  const plannedChunks=queue.buildBlowerRuntimeProbeChunks(probe.startAt,probe.endAt);
  const chunks=plannedChunks.map((chunk,index)=>{const part=index===plannedChunks.length-1?seconds-accounted:
   Math.floor(seconds*(Date.parse(chunk.endAt)-Date.parse(chunk.startAt))/1000/duration);accounted+=part;
   return {...chunk,startState:'running',endState:'running',runningSeconds:part,totalRunningHours:part/3600};});
  const raw={...probe,requestId:created.body.item.id,ok:true,readOnly:true,observedAt:probe.endAt,
   collectedAt:new Date(Date.parse(probe.endAt)+1000).toISOString(),startState:'running',endState:'running',
   runningSeconds:seconds,totalRunningHours:seconds/3600,completedChunkCount:chunks.length,chunks};
  return {created,raw};
 }
 function install(raw,status='complete'){sql.prepare('UPDATE ois_data_requests SET status=?,result_json=?,completed_at=? WHERE id=?').run(status,JSON.stringify(raw),raw.collectedAt,raw.requestId);}
 const apply=async(raw,user=OWNER,now=new Date(Date.parse(raw.endAt)+2000))=>parse(await history.applyDataParcRuntimeSync(db,user,{requestId:raw.requestId},{now}));
 const assertPreserved=()=>{assert.deepEqual(asset(),before);assert.deepEqual(events(),originalEvents);};
 return {sql,db,asset,events,before,originalEvents,body,create,completed,install,apply,assertPreserved};
}

test('R4 actual Bag B full request begins at confirmed replacement, retains saved value pending, and stores one verified full total',async t=>{
 const f=await fixture(t);
 const initial=await history.loadAssetStates(f.db,{flyash_bag:{}},{assetRows:[f.asset()],skipDecorations:true});
 assert.equal(initial[0].dataParcRuntimeBasis.confirmedGapRecoveryEligible,true);
 const {created,raw}=await f.completed();
 assert.equal(Date.parse(raw.startAt),Date.parse('2026-09-25T14:40:00+09:00'));
 assert.ok(Date.parse(raw.startAt)<Date.parse(raw.expectedCycleStartedAt));
 assert.equal(raw.dataParcTag,'GSPOGE.ABB_DCS.103ETG30AN602XJ04');
 f.assertPreserved();
 assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='blower_runtime_append_v1'").get().count,0);
 f.install(raw);const result=await f.apply(raw);assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(f.asset().cycle_runtime_hours,raw.runningSeconds/3600);
 assert.equal(f.asset().cycle_start_revision,f.before.cycle_start_revision);
 assert.equal(f.asset().last_replacement_at,f.before.last_replacement_at);
 assert.equal(f.asset().cycle_started_at,f.before.cycle_started_at);
 for(const old of f.originalEvents)assert.deepEqual(f.events().find(row=>row.id===old.id),old);
 const next=await history.loadAssetStates(f.db,{flyash_bag:{cycleDays:null,warningDays:null,criticalDays:null}},{assetRows:[f.asset()],skipDecorations:true});
 assert.equal(next[0].replacementAutoCycle.clockKnown,true);
 assert.equal(next[0].dataParcRuntimeBasis.coverageComplete,true);
 assert.equal(next[0].dataParcRuntimeBasis.missingLeadingSeconds,0);
 assert.equal(next[0].dataParcRuntimeBasis.confirmedGapRecoveryEligible,undefined);
 const snapshot=f.asset(),events=f.events();const again=await f.apply(raw);assert.equal(again.status,200);assert.deepEqual(f.asset(),snapshot);assert.deepEqual(f.events(),events);
 const appended=await f.completed({...f.body(),incrementalRefresh:true,requireIncrementalAppend:true},1800,new Date(NOW.getTime()+3600000));
 assert.equal(Date.parse(appended.raw.startAt),Date.parse(raw.endAt));
 const intent=f.sql.prepare('SELECT * FROM blower_runtime_append_v1 WHERE request_id=?').get(appended.raw.requestId);
 assert.equal(Date.parse(intent.coverage_start_at),Date.parse(raw.startAt));assert.equal(intent.base_running_seconds,raw.runningSeconds);
 f.install(appended.raw);const appendedResult=await f.apply(appended.raw);assert.equal(appendedResult.status,200,JSON.stringify(appendedResult.body));
 assert.equal(f.asset().cycle_runtime_hours,(raw.runningSeconds+1800)/3600);
 const final=await history.loadAssetStates(f.db,{flyash_bag:{}},{assetRows:[f.asset()],skipDecorations:true});
 assert.equal(final[0].dataParcRuntimeBasis.coverageComplete,true);
 assert.equal(Date.parse(final[0].dataParcRuntimeBasis.startAt),Date.parse(raw.startAt));
 assert.equal(final[0].dataParcRuntimeBasis.appendReady,true);
});

test('R4 full recovery queue rejects stale browser cycle/runtime snapshots before creating requests',async t=>{
 for(const key of ['expectedLastReplacementAt','expectedCycleStartRevision','expectedCycleRuntimeRevision']){
  const f=await fixture(t),body=f.body();body[key]='stale-value';const result=await f.create(body);
  assert.equal(result.status,409);assert.equal(result.body.code,'BLOWER_RUNTIME_REFRESH_CYCLE_CONFLICT');
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM ois_data_requests').get().count,0);f.assertPreserved();
 }
});

test('R4 full recovery queue requires an active authenticated user and a valid confirmed RUN mapping',async t=>{
 for(const mode of ['no-session','inactive-user','foreign-source']){
  const f=await fixture(t),body=f.body();
  if(mode==='inactive-user')f.sql.prepare('UPDATE users SET is_active=0').run();
  if(mode==='foreign-source')body.dataParcTag='GSPOGE.ABB_DCS.003ETH03AN602XB04';
  const result=await f.create(body,mode==='no-session'?'':TOKEN);
  assert.ok(result.status>=400,JSON.stringify(result));assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM ois_data_requests').get().count,0);f.assertPreserved();
 }
});

test('R4 rejected incomplete, wrong-signal, failed, or stale results preserve the previous measured asset and receipt',async t=>{
 for(const mode of ['incomplete','wrong-signal','failed','stale']){
  const f=await fixture(t),{raw}=await f.completed();
  if(mode==='incomplete')raw.completedChunkCount--;
  if(mode==='wrong-signal')raw.dataParcTag='GSPOGE.ABB_DCS.DIFFERENT_BINARY_RUN';
  f.install(raw,mode==='failed'?'failed':'complete');
  const result=await f.apply(raw,OWNER,mode==='stale'?new Date(NOW.getTime()+16*60000):undefined);
  assert.ok(result.status>=400,mode+JSON.stringify(result));f.assertPreserved();
 }
});

test('R4 a different requester cannot apply the completed recovery to the saved cycle',async t=>{
 const f=await fixture(t),{raw}=await f.completed();f.install(raw);
 const result=await f.apply(raw,{...OWNER,employeeNo:'another-user'});
 assert.equal(result.status,403);assert.equal(result.body.code,'DATAPARC_RUNTIME_PROBE_FORBIDDEN');f.assertPreserved();
});

test('R4 a runtime change while recovery is pending blocks application and keeps the concurrent value',async t=>{
 const f=await fixture(t),{raw}=await f.completed();f.install(raw);
 f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=?,cycle_runtime_hours=?,runtime_hours=? WHERE tag_number=?').run('concurrent-manual-revision',401,401,TAG);
 const concurrent=f.asset(),events=f.events();const result=await f.apply(raw);
 assert.equal(result.status,409);assert.equal(result.body.code,'DATAPARC_RUNTIME_CYCLE_CONFLICT');
 assert.deepEqual(f.asset(),concurrent);assert.deepEqual(f.events(),events);
});

test('R4 recovery eligibility requires unchanged automatic changeover and nonconflicting current-owner minute proof',async t=>{
 for(const mode of ['missing-changeover','manual-startup','edited-changeover','same-time-manual','clock-conflict','day-only-proof']){
  const f=await fixture(t);
  if(mode==='missing-changeover')f.sql.prepare('DELETE FROM blower_history_events WHERE id=?').run('operation-auto:166c2f90:start');
  if(mode==='manual-startup')f.sql.prepare('UPDATE blower_history_events SET source_type=? WHERE id=?').run('manual','operation-auto:166c2f90:start');
  if(mode==='edited-changeover')f.sql.prepare('UPDATE blower_history_events SET updated_at=? WHERE id=?').run('2026-11-04T00:00:00.000Z','operation-auto:166c2f90:start');
  if(mode==='same-time-manual'){
   const row={...ACTUAL.events.find(row=>row.id==='operation-auto:166c2f90:start'),id:'manual-same-time-startup',source_type:'manual'};
   const keys=Object.keys(row);f.sql.prepare('INSERT INTO blower_history_events ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key]));
  }
  for(const event of f.events().filter(row=>row.source_type==='shift_log_auto_v3')){
   const source=JSON.parse(event.source_text);
   if(mode==='clock-conflict')source.completionClockConflict=true;
   if(mode==='day-only-proof' && source.timePrecision==='minute')source.timePrecision='day';
   f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(source),event.id);
  }
  const immutable=f.asset(),events=f.events();
  const projected=await history.loadAssetStates(f.db,{flyash_bag:{}},{assetRows:[f.asset()],skipDecorations:true});
  assert.notEqual(projected[0].dataParcRuntimeBasis?.confirmedGapRecoveryEligible,true,mode);
  assert.deepEqual(f.asset(),immutable);assert.deepEqual(f.events(),events);
 }
});

test('R4 full receipt before a manual or unknown startup stays unrecognized without automatic changeover authority',async t=>{
 for(const mode of ['manual-startup','missing-changeover','clock-conflict','edited-receipt']){
  const f=await fixture(t),{raw}=await f.completed();f.install(raw);
  const applied=await f.apply(raw);assert.equal(applied.status,200);
  if(mode==='manual-startup')f.sql.prepare('UPDATE blower_history_events SET source_type=? WHERE id=?').run('manual','operation-auto:166c2f90:start');
  if(mode==='missing-changeover')f.sql.prepare('DELETE FROM blower_history_events WHERE id=?').run('operation-auto:166c2f90:start');
  if(mode==='clock-conflict')for(const event of f.events().filter(row=>row.source_type==='shift_log_auto_v3')){
   const source={...JSON.parse(event.source_text),completionClockConflict:true};
   f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(source),event.id);
  }
  if(mode==='edited-receipt')f.sql.prepare('UPDATE blower_history_events SET updated_at=? WHERE id=?').run(new Date(NOW.getTime()+10000).toISOString(),'dataparc_runtime:'+raw.requestId);
  const immutable=f.asset(),events=f.events();
  assert.equal(history.currentDataParcRuntimeBasis(f.asset(),f.events().sort((a,b)=>b.created_at.localeCompare(a.created_at))),null,mode);
  assert.deepEqual(f.asset(),immutable);assert.deepEqual(f.events(),events);
 }
});
