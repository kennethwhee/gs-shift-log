import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const NOW=new Date('2026-11-03T13:00:00.000Z');
const USER={employeeNo:'integration-owner',name:'Approved replacement integration'};
const SEAL='104HHL10AN611',FBHE='104HHL60AP611';
const SETTINGS=Object.fromEntries(['fbhe','seal_pot','organic_fuel','flyash_bag','flyash_silo','limestone'].map(type=>[type,{cycleDays:90,warningDays:7,criticalDays:3}]));
function database(){
  const sqlite=new DatabaseSync(':memory:');
  const db={sqlite,beforeBatch:null,prepare(sql){return{values:[],bind(...values){this.values=values;return this;},async all(){return{results:sqlite.prepare(sql).all(...this.values)};},async first(){return sqlite.prepare(sql).get(...this.values)||null;},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...this.values).changes)}};}};},
    async batch(items){if(db.beforeBatch){const fn=db.beforeBatch;db.beforeBatch=null;fn();}sqlite.exec('BEGIN IMMEDIATE');try{const rows=[];for(const item of items)rows.push(await item.run());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};return db;
}
async function fixture(){
  const db=database(),sql=db.sqlite;await api.ensureSchema(db);await api.ensureIncrementalLogSchema(db);
  sql.exec(`CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);
    CREATE INDEX idx_shift_work_date ON shift_logs(work_date,shift,role);
    CREATE TABLE legacy_logs(id INTEGER PRIMARY KEY,legacy_diary_id TEXT NOT NULL UNIQUE,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,entries_json TEXT,original_json TEXT,updated_at TEXT);
    CREATE INDEX idx_legacy_work_date ON legacy_logs(work_date,shift,role);
    CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,status TEXT,target_date TEXT,requested_by_id TEXT,result_json TEXT,completed_at TEXT);
    CREATE TABLE blower_runtime_probe_intents_v4(request_id TEXT PRIMARY KEY,schema_version INTEGER,asset_tag TEXT,dataparc_tag TEXT,window_start TEXT,window_end TEXT,chunk_days INTEGER,chunk_count INTEGER,expected_last_replacement_at TEXT,expected_cycle_start_state TEXT,expected_cycle_started_at TEXT,expected_cycle_start_revision TEXT,expected_cycle_runtime_revision TEXT);
    CREATE TABLE blower_runtime_append_v1(request_id TEXT PRIMARY KEY,base_event_id TEXT,base_revision TEXT,base_observed_at TEXT,coverage_start_at TEXT,base_running_seconds INTEGER,created_at TEXT)`);
  function prime(tag,date='2026-07-01T00:00:00+09:00',hours=5){sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,cycle_start_revision='old-start',cycle_runtime_revision='old-runtime',cycle_runtime_hours=?,runtime_hours=?,cycle_runtime_anchor_at=?,runtime_anchor_at=?,cycle_runtime_state='running',is_running=1 WHERE tag_number=?`).run(date,hours,hours,NOW.toISOString(),NOW.toISOString(),tag);}
  const asset=tag=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  function event(tag,patch={}){const row={id:'replacement-'+tag,tag_number:tag,event_type:'replacement',event_date:asset(tag).last_replacement_at,runtime_hours:1,issue_type:'',action_type:'교체',note:'',source_type:'manual',source_log_id:'',source_text:'',created_by_id:'prior',created_by_name:'Prior',created_at:'2026-08-28T05:43:47Z',updated_at:'2026-08-28T05:43:47Z',...patch};const cols=Object.keys(row);sql.prepare(`INSERT INTO blower_history_events(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));return row;}
  function shift(id,date,role,entries,status='결재완료'){sql.prepare('INSERT INTO shift_logs VALUES(?,?,?,?,?,?,?,?)').run(id,date,'DS',role,'Source',status,JSON.stringify({id,date,shift:'DS',role,entries}),date+'T10:00:00Z');}
  function legacy(id,diary,date,role,content){sql.prepare('INSERT INTO legacy_logs VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,diary,date,'DS',role,'Source','결재완료','[]',JSON.stringify({diary_id:diary,date:date.replaceAll('-',''),diary_status:'APPROVED',position:role,shift:'DAY',body:[{index:2,entry_id:'2',content}]}),date+'T10:00:00Z');}
  function oldDp(tag,replacement=asset(tag).last_replacement_at){const id='old-dp-'+tag;return event(tag,{id:'dataparc_runtime:'+id,event_type:'runtime_correction',event_date:NOW.toISOString(),runtime_hours:asset(tag).cycle_runtime_hours,source_type:'dataparc_runtime',source_log_id:id,source_text:JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',requestId:id,assetTag:tag,dataParcTag:'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_'+tag,startAt:replacement,endAt:NOW.toISOString(),observedAt:NOW.toISOString(),expectedLastReplacementAt:replacement,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',expectedCycleStartRevision:'old-start',expectedCycleRuntimeRevision:'earlier-runtime',runningSeconds:asset(tag).cycle_runtime_hours*3600,totalRunningHours:asset(tag).cycle_runtime_hours,startState:'running',endState:'running'}),created_at:NOW.toISOString(),updated_at:NOW.toISOString()});}
  async function step(extra={}){const response=await api.latestLogsStep(db,USER,{phase:'replacement',incrementalLogs:true,replacementAutoVersion:3,autoApplyConfirmedReplacements:true,limit:2,...extra},{now:NOW});return{status:response.status,...await response.json()};}
  async function drain(){let window=null,cursor=null,totals={applied:0,corrected:0,retracted:0,historical:0,confirmed:0};for(let i=0;i<40;i++){const p=await step({window,cursor});assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.replacementAutoVersion,3);for(const key of Object.keys(totals))totals[key]+=p['auto'+key[0].toUpperCase()+key.slice(1)+'ReplacementCount']||0;if(p.done)return totals;window=p.window;cursor=p.nextCursor;}throw Error('source phase did not terminate');}
  const project=async tag=>(await api.loadAssetStates(db,SETTINGS,{assetRows:[asset(tag)],skipDecorations:true,planning:true}))[0];
  function completedRequest(tag,id='new-cycle-query',changes={}){const a=asset(tag),start=a.last_replacement_at,end=NOW.toISOString();const raw={schemaVersion:1,requestType:'blower_runtime_probe',requestId:id,ok:true,readOnly:true,assetTag:tag,dataParcTag:'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_'+tag,startAt:start,endAt:end,observedAt:end,expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',expectedCycleStartRevision:'signal-only-v1:'+a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision,startState:'stopped',endState:'running',runningSeconds:1800,totalRunningHours:.5,chunkDays:31,chunkCount:1,completedChunkCount:1,collectedAt:end,...changes};raw.chunks=[{index:1,startAt:raw.startAt,endAt:raw.endAt,startState:raw.startState,endState:raw.endState,runningSeconds:raw.runningSeconds,totalRunningHours:raw.totalRunningHours}];sql.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?)').run(id,raw.requestType,'complete',`v1|${tag}|${raw.startAt}|${raw.endAt}`,USER.employeeNo,JSON.stringify(raw),end);sql.prepare('INSERT INTO blower_runtime_probe_intents_v4 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,1,tag,raw.dataParcTag,raw.startAt,raw.endAt,31,1,raw.expectedLastReplacementAt,raw.expectedCycleStartState,raw.expectedCycleStartedAt,raw.expectedCycleStartRevision,raw.expectedCycleRuntimeRevision);return raw;}
  return{db,sql,prime,asset,event,shift,legacy,oldDp,step,drain,project,completedRequest};
}

test('actual approved Seal Pot 1A 09:58 source replays an old receipt, corrects the V13 midnight basis, and the real projection permits fresh RUN',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(SEAL,'2026-08-03T00:00:00+09:00');f.oldDp(SEAL);f.event(SEAL,{id:'v13:104HHL10AN611|2026-08-03',source_type:'shift_log_history_v13',source_log_id:'3c2e6847-2672-449d-b5d7-11d0584219d4',source_text:'Seal Pot Blower #A V-Belt 교체 완료'});
  const id='9640da07-1a5b-4806-8a38-aa7da59765a5';f.shift(id,'2026-08-03','BO1',[{id:'entry-d5944210-8b76-43ba-a3ab-45bcc55ed93c',time:'09:58',tag:SEAL,content:'Seal Pot Blower #A V-Belt 교체 완료 현재 Stand-by'}]);
  f.sql.prepare('INSERT INTO blower_log_receipts_v1 VALUES(?,?,?,?,?)').run(id,'old-version-snapshot',1,1,NOW.toISOString());
  const counts=await f.drain();assert.equal(counts.corrected,1);assert.equal(f.asset(SEAL).last_replacement_at,'2026-08-03T00:58:00.000Z');assert.equal(f.asset(SEAL).cycle_runtime_hours,0);
  const view=await f.project(SEAL);assert.equal(view.runtimeHours,null);assert.equal(view.hasUnverifiedDataParcHistory,false);assert.equal(view.replacementAutoCycle.freshQueryEligible,true);
  const planned=core.plan([view],NOW);assert.equal(planned.skipped.length,0,JSON.stringify(planned));assert.equal(planned.tasks.length,1);assert.equal(planned.tasks[0].incremental,false);assert.equal(planned.tasks[0].queryStartAt,f.asset(SEAL).last_replacement_at);
});

test('approved legacy C-belt/B-operation source corrects B attribution and applies only the actual C completion fact',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());const B='204HHL60AP621',C='204HHL60AP631';f.prime(B,'2026-09-16T09:23:00+09:00',1060.2);f.prime(C);f.oldDp(B);f.event(B,{id:'prior-B-manual',event_date:'2026-08-27T00:00:00+09:00'});f.event(B,{id:'471d302e-a2af-42e7-8ebb-32cbb9d9d55d',source_type:'shift_log_auto',source_log_id:'legacy-POCHEON#20260916#DAY#BO2',source_text:'V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)'});
  f.legacy(40040,'POCHEON#20260916#DAY#BO2','2026-09-16','BO2','1. [TM] 09:23 FBHE Blower #C V-Blet 전체 교체 실시\n- 교체운전 실시 (#C 정지, #B 기동)\n- V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)');
  const counts=await f.drain();assert.equal(counts.retracted,1);assert.equal(counts.applied,1);assert.equal(f.asset(B).last_replacement_at,'2026-08-27T00:00:00+09:00');assert.equal(f.asset(B).cycle_runtime_hours,0);assert.equal(f.asset(C).last_replacement_at,'2026-09-15T15:00:00.000Z');
  const b=await f.project(B),c=await f.project(C);assert.equal(b.replacementAutoCycle.registeredBaseline,true);assert.equal(c.replacementAutoCycle.clockKnown,false);
  const plan=core.plan([b,c],NOW);assert.equal(plan.tasks.length,1,JSON.stringify(plan));assert.equal(plan.tasks[0].asset.tagNumber,B);assert.match(plan.skipped[0].message,/시각/);
  assert.equal(f.sql.prepare('SELECT event_type FROM blower_history_events WHERE id=?').get('471d302e-a2af-42e7-8ebb-32cbb9d9d55d').event_type,'_retracted_replacement');
});

test('a new completed day-only belt job is automatically reflected while public history and RUN planning preserve its unknown clock',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);f.shift('day-job','2026-11-03','BCO1',[{id:'day-entry',tag:FBHE,content:'FBHE Blower #A V-Belt 교체 완료'}]);
  const counts=await f.drain();assert.equal(counts.applied,1);assert.equal(f.asset(FBHE).cycle_runtime_hours,0);const view=await f.project(FBHE);assert.equal(view.replacementAutoCycle.clockKnown,false);assert.equal(view.actualLastReplacementAt,'');assert.equal(view.runtimeHours,null);assert.equal(view.remainingHours,null);
  const plan=core.plan([view],NOW);assert.equal(plan.tasks.length,0);assert.match(plan.skipped[0].message,/시각/);
  const events=await api.loadEvents(f.db);const job=events.find(e=>e.tagNumber===FBHE&&e.eventType==='replacement');assert.equal(job.sourceTimePrecision,'day');assert.equal(job.sourceText,'FBHE Blower #A V-Belt 교체 완료');assert.doesNotMatch(job.sourceText,/schemaVersion|cycleRuntimeRevision/);
});

test('actual Silo B not-performed work and a separate kitchen fan completion retract the false imported replacement without claiming another completed belt',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());const tag='104ETH03AN602';
  f.prime(tag,'2026-05-04T00:00:00+09:00',4000);f.oldDp(tag);
  f.event(tag,{id:'v13:104ETH03AN602|2026-05-04',source_type:'shift_log_history_v13',source_log_id:'38159',source_text:'Fly Ash Silo Aeration Blower는 추후 Belt 교체 후 #B 기동 요망 → 1층 주방용 환기팬 Belt 교체 완료_TM 작업'});
  f.legacy(38159,'POCHEON#20260504#DAY#BCO1','2026-05-04','BCO1','4. Fly Ash Silo Aeration Blower #B Belt 교체 하려했지만 미실시_모터 권선 체결 안되있으며 Base Bolt 체결 안되어있음\n - Fly Ash Silo Aeration Blower는 추후 Belt 교체 후 #B 기동 요망\n5. 1층 주방용 환기팬 Belt 교체 완료_TM 작업');
  const counts=await f.drain();assert.equal(counts.retracted,1);assert.equal(counts.applied,0);assert.equal(f.asset(tag).last_replacement_at,null);
  const view=await f.project(tag);assert.equal(view.replacementAutoCycle,undefined);assert.notEqual(view.cycleSourceReview?.code,'REPLACEMENT_COMPLETION_TIME_MISSING');
  const plan=core.plan([view],NOW);assert.equal(plan.tasks.length,0);assert.doesNotMatch(plan.skipped[0].message,/교체 자동반영 완료/);
});

test('an unknown replacement completion clock cannot be certified by a same-day or later automatic start; explicit actual startup ignores only owned old-cycle measurements',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);f.oldDp(FBHE);
  f.shift('day-boundary','2026-09-16','BCO1',[{tag:FBHE,content:'FBHE Blower #A V-Belt 교체 완료'}]);await f.drain();
  const body={tagNumber:FBHE,expectedLastReplacementAt:f.asset(FBHE).last_replacement_at};
  const before=JSON.stringify(f.asset(FBHE));
  for(const eventDate of ['2026-09-16T10:00:00+09:00','2026-09-17T10:00:00+09:00']){
    const response=await api.registerStartup(f.db,USER,{...body,eventDate},{sourceType:'shift_log_operation_auto'});
    assert.equal(response.status,409);assert.equal((await response.json()).code,'REPLACEMENT_COMPLETION_CLOCK_REQUIRED');assert.equal(JSON.stringify(f.asset(FBHE)),before);
  }
  const response=await api.registerStartup(f.db,USER,{...body,eventDate:'2026-09-17T10:00:00+09:00'});
  assert.equal(response.status,200,JSON.stringify(await response.json()));assert.equal(f.asset(FBHE).cycle_start_state,'started');assert.equal(f.asset(FBHE).cycle_runtime_hours,0);
});

test('a new precise approved replacement resets first, rebuilds actual new-cycle RUN, then replays without carrying or resetting old belt hours',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE,'2026-07-01T00:00:00+09:00',123);f.oldDp(FBHE);f.shift('new-precise','2026-11-03','BCO1',[{id:'new-job',tag:FBHE,time:'09:58',content:'FBHE Blower #A V-Belt 교체 완료'}]);await f.drain();
  assert.equal(f.asset(FBHE).cycle_runtime_hours,0);const request=f.completedRequest(FBHE);const response=await api.applyDataParcRuntimeSync(f.db,USER,{requestId:request.requestId},{now:NOW});const saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));assert.equal(f.asset(FBHE).cycle_runtime_hours,.5);assert.equal(f.asset(FBHE).runtime_hours,.5);
  const revision=f.asset(FBHE).cycle_runtime_revision;const replay=await api.applyDataParcRuntimeSync(f.db,USER,{requestId:request.requestId},{now:NOW});assert.equal((await replay.json()).replayed,true);await f.drain();assert.equal(f.asset(FBHE).cycle_runtime_hours,.5);assert.equal(f.asset(FBHE).cycle_runtime_revision,revision);
});

test('a completed old-cycle request cannot apply after the automatic replacement changed both cycle revisions',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE,'2026-11-03T00:00:00+09:00');const request=f.completedRequest(FBHE,'old-owned-query',{expectedCycleStartState:'legacy',expectedCycleStartRevision:'old-start'});f.shift('new-work','2026-11-03','BCO1',[{tag:FBHE,time:'09:58',content:'FBHE Blower #A V-Belt 교체 완료'}]);await f.drain();
  const before=JSON.stringify(f.asset(FBHE));const response=await api.applyDataParcRuntimeSync(f.db,USER,{requestId:request.requestId},{now:NOW});assert.equal(response.status,409);assert.equal(JSON.stringify(f.asset(FBHE)),before);
});

test('an explicitly excluded unchanged completion remains excluded and does not reset the asset',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);const source='FBHE Blower #A V-Belt 교체 완료';f.shift('excluded-work','2026-11-03','BCO1',[{tag:FBHE,time:'09:58',content:source}]);f.sql.prepare(`INSERT INTO blower_history_candidates(id,source_fingerprint,tag_number,detected_type,detected_date,issue_type,action_type,source_log_id,source_shift,source_role,source_author,source_text,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('excluded','excluded-fingerprint',FBHE,'replacement','2026-11-03T09:58:00+09:00','','','excluded-work','DS','BCO1','Source',source,'excluded',NOW.toISOString());
  const before=JSON.stringify(f.asset(FBHE));const counts=await f.drain();assert.equal(counts.applied,0);assert.equal(JSON.stringify(f.asset(FBHE)),before);
});

test('approval/source changes during the guarded write stop the page without a false reset or processed receipt',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);f.shift('changing-source','2026-11-03','BCO1',[{tag:FBHE,time:'09:58',content:'FBHE Blower #A V-Belt 교체 완료'}]);const before=JSON.stringify(f.asset(FBHE));f.db.beforeBatch=()=>f.sql.prepare("UPDATE shift_logs SET status='작성중' WHERE id='changing-source'").run();
  const response=await f.step();assert.equal(response.status,409,JSON.stringify(response));assert.equal(JSON.stringify(f.asset(FBHE)),before);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM blower_log_receipts_v1 WHERE log_id LIKE 'replacement-auto-v3:%'").get().n,0);
});

test('old observed rows are excluded only with explicit old ownership; corrupt or current-cycle history stays protected',()=>{
  const asset={tag_number:FBHE,last_replacement_at:'2026-11-03T00:58:00Z',cycle_start_revision:'replacement-auto-v3:new'};
  const row={tag_number:FBHE,event_type:'runtime_correction',source_type:'dataparc_runtime',event_date:NOW.toISOString(),source_text:'bad'};
  assert.equal(api.dataParcRecordBelongsToCurrentCycle(asset,row),true);
  assert.equal(api.dataParcRecordBelongsToCurrentCycle(asset,{...row,source_text:JSON.stringify({expectedLastReplacementAt:'2026-07-01T00:00:00Z',expectedCycleStartRevision:'old'})}),false);
  assert.equal(api.dataParcRecordBelongsToCurrentCycle(asset,{...row,source_text:JSON.stringify({expectedLastReplacementAt:asset.last_replacement_at,expectedCycleStartRevision:asset.cycle_start_revision})}),true);
});
