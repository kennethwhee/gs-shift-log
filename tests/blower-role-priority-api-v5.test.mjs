import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
import {loadApprovedReplacementPage,replacementSourceGuard,storeReplacementLogReceipts} from '../functions/_shared/blower-replacement-log-source-v3.js';
import {reconcileApprovedReplacementLog} from '../functions/_shared/blower-replacement-auto-v3.js';
const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const NOW=new Date('2026-11-04T13:00:00.000Z');
const USER={employeeNo:'integration-owner',name:'Approved replacement integration'};
const SEAL='104HHL10AN611',FBHE='104HHL60AP611';
const SETTINGS=Object.fromEntries(['fbhe','seal_pot','organic_fuel','flyash_bag','flyash_silo','limestone'].map(type=>[type,{cycleDays:90,warningDays:7,criticalDays:3}]));
function database(){
  const sqlite=new DatabaseSync(':memory:');
  const db={sqlite,beforeBatch:null,prepare(sql){return{values:[],bind(...values){assert.ok(values.length<=100,'D1 bind limit');this.values=values;return this;},async all(){return{results:sqlite.prepare(sql).all(...this.values)};},async first(){return sqlite.prepare(sql).get(...this.values)||null;},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...this.values).changes)}};}};},
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
  function oldDp(tag,replacement=asset(tag).last_replacement_at){const id='old-dp-'+tag;return event(tag,{id:'dataparc_runtime:'+id,event_type:'runtime_correction',event_date:NOW.toISOString(),runtime_hours:asset(tag).cycle_runtime_hours,source_type:'dataparc_runtime',source_log_id:id,source_text:JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',requestId:id,assetTag:tag,dataParcTag:tag==='103HRJ01AN601'?'GSPOGE.ABB_DCS.103HRJ01AN601XB04':'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_'+tag,startAt:replacement,endAt:NOW.toISOString(),observedAt:NOW.toISOString(),expectedLastReplacementAt:replacement,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',expectedCycleStartRevision:'old-start',expectedCycleRuntimeRevision:'earlier-runtime',runningSeconds:asset(tag).cycle_runtime_hours*3600,totalRunningHours:asset(tag).cycle_runtime_hours,startState:'running',endState:'running'}),created_at:NOW.toISOString(),updated_at:NOW.toISOString()});}
  async function step(extra={}){const response=await api.latestLogsStep(db,USER,{phase:'replacement',incrementalLogs:true,replacementAutoVersion:3,autoApplyConfirmedReplacements:true,limit:2,...extra},{now:NOW});return{status:response.status,...await response.json()};}
  async function drain(){let window=null,cursor=null,totals={applied:0,corrected:0,retracted:0,historical:0,confirmed:0};for(let i=0;i<40;i++){const p=await step({window,cursor});assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.replacementAutoVersion,3);for(const key of Object.keys(totals))totals[key]+=p['auto'+key[0].toUpperCase()+key.slice(1)+'ReplacementCount']||0;if(p.done)return totals;window=p.window;cursor=p.nextCursor;}throw Error('source phase did not terminate');}
  const project=async tag=>(await api.loadAssetStates(db,SETTINGS,{assetRows:[asset(tag)],skipDecorations:true,planning:true}))[0];
  function completedRequest(tag,id='new-cycle-query',changes={}){const a=asset(tag),start=a.last_replacement_at,end=NOW.toISOString();const raw={schemaVersion:1,requestType:'blower_runtime_probe',requestId:id,ok:true,readOnly:true,assetTag:tag,dataParcTag:tag==='103HRJ01AN601'?'GSPOGE.ABB_DCS.103HRJ01AN601XB04':'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_'+tag,startAt:start,endAt:end,observedAt:end,expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',expectedCycleStartRevision:'signal-only-v1:'+a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision,startState:'stopped',endState:'running',runningSeconds:1800,totalRunningHours:.5,chunkDays:31,chunkCount:1,completedChunkCount:1,collectedAt:end,...changes};raw.chunks=[{index:1,startAt:raw.startAt,endAt:raw.endAt,startState:raw.startState,endState:raw.endState,runningSeconds:raw.runningSeconds,totalRunningHours:raw.totalRunningHours}];sql.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?)').run(id,raw.requestType,'complete',`v1|${tag}|${raw.startAt}|${raw.endAt}`,USER.employeeNo,JSON.stringify(raw),end);sql.prepare('INSERT INTO blower_runtime_probe_intents_v4 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,1,tag,raw.dataParcTag,raw.startAt,raw.endAt,31,1,raw.expectedLastReplacementAt,raw.expectedCycleStartState,raw.expectedCycleStartedAt,raw.expectedCycleStartRevision,raw.expectedCycleRuntimeRevision);return raw;}
  return{db,sql,prime,asset,event,shift,legacy,oldDp,step,drain,project,completedRequest};
}

async function normalize(f) {
  let window=null,cursor=null;
  for(let n=0;n<20;n++){
    const p=await f.step({normalizationVersion:4,window,cursor});
    assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.normalizationVersion,4);
    if(p.done)return p;
    window=p.window;cursor=p.nextCursor;
  }
  throw Error('Normalization source phase did not finish');
}


const LIME='103HRJ01AN601',LIME_DAY='2026-09-18';
const LOW_TEXT='Limestone Blower #A V-Belt 전량 파손 -> 14:20 Belt 교체 후 정상화';
const HIGH_TEXT='Limestone Blower #A V-Belt 전량 파손되어 투입 불가 상태\n- Manual Slide Close 및 Blower 정지 후 차단기 OFF -> 밸브 및 차단기 원복\n- <BM작업> 14:24 Blower #A V-Belt 전량 교체하여 정상화 완료';
function actualPair(f){f.shift('a-low',LIME_DAY,'BO1',[{id:'low-job',time:'11:27',content:LOW_TEXT}]);f.shift('z-high',LIME_DAY,'BCO1',[{id:'high-job',time:'11:27',content:HIGH_TEXT}]);}
async function seedR4(f){const page=await loadApprovedReplacementPage(f.db,{limit:8},{now:NOW,analysisVersion:4});const assets=f.sql.prepare('SELECT * FROM blower_history_assets').all();for(const row of page.logs){const facts=api.collectReplacementFactsForRolePriority(row,assets);const result=await reconcileApprovedReplacementLog(f.db,USER,row,facts,{now:NOW,normalizationVersion:4,sourceGuard:replacementSourceGuard(row)});assert.equal(result.ok,true);}await storeReplacementLogReceipts(f.db,page.logs,NOW);}
test('actual September 18 wording selects BCO1 14:24 across pages while preserving manual 14:20 and every measured asset value',async t=>{
 const f=await fixture();t.after(()=>f.sql.close());f.prime(LIME,'2026-09-18T14:20:00+09:00',1119.1);f.event(LIME);f.oldDp(LIME);actualPair(f);await seedR4(f);
 const before=f.sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all();let window=null,cursor=null;
 for(let i=0;i<5;i++){const page=await f.step({normalizationVersion:4,limit:1,window,cursor});assert.equal(page.status,200,JSON.stringify(page));if(page.done)break;window=page.window;cursor=page.nextCursor;}
 assert.deepEqual(f.sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all(),before);
 const view=await f.project(LIME),selection=view.replacementAutoCycle.rolePrioritySelection;
 assert.equal(selection.selectedRole,'BCO1');assert.equal(selection.selectedCompletionAt,'2026-09-18T05:24:00.000Z');assert.equal(selection.requiredRebuild,true);assert.equal(view.cycleSourceReview.code,'ROLE_PRIORITY_RUN_REBUILD');assert.equal(view.dataParcRuntimeBasis.cycleBasisConfirmed,false);assert.equal(view.runtimeHours,1119.1);
 const historyBefore=f.sql.prepare('SELECT * FROM blower_history_events ORDER BY id').all();await normalize(f);assert.deepEqual(f.sql.prepare('SELECT * FROM blower_history_events ORDER BY id').all(),historyBefore);
});
test('fresh duplicate processing applies only the higher completion boundary even when lower is the first one-row page',async t=>{
 const f=await fixture();t.after(()=>f.sql.close());f.prime(LIME);actualPair(f);const first=await f.step({normalizationVersion:4,limit:1});assert.equal(first.status,200,JSON.stringify(first));assert.equal(f.asset(LIME).last_replacement_at,'2026-09-18T05:24:00.000Z');
 await normalize(f);assert.equal(f.asset(LIME).last_replacement_at,'2026-09-18T05:24:00.000Z');const view=await f.project(LIME);assert.equal(view.replacementAutoCycle.rolePrioritySelection.selectedRole,'BCO1');assert.equal(view.replacementAutoCycle.rolePrioritySelection.requiredRebuild,false);
});
test('higher untimed completion does not acquire the lower precise clock in automatic new cycles',async t=>{
 const f=await fixture();t.after(()=>f.sql.close());f.prime(LIME);f.shift('a-low',LIME_DAY,'BO1',[{id:'low-job',time:'14:20',tag:LIME,content:'Limestone Blower #A V-Belt 교체 완료'}]);f.shift('z-high',LIME_DAY,'BCO1',[{id:'high-job',tag:LIME,content:'Limestone Blower #A V-Belt 교체 완료'}]);await normalize(f);const view=await f.project(LIME);assert.equal(view.replacementAutoCycle.rolePrioritySelection.timePrecision,'day');assert.equal(view.replacementAutoCycle.clockKnown,false);assert.equal(view.actualLastReplacementAt,'');assert.equal(view.cycleSourceReview.code,'ROLE_PRIORITY_COMPLETION_TIME_MISSING');
});
test('deleted, unapproved or withdrawn higher evidence cannot promote the lower day fact or preserved manual clock',async t=>{
 for(const mode of ['delete','unapprove','withdraw']){
  const f=await fixture();t.after(()=>f.sql.close());f.prime(LIME,'2026-09-18T14:20:00+09:00',1119.1);f.event(LIME);f.oldDp(LIME);actualPair(f);await seedR4(f);await normalize(f);assert.ok((await f.project(LIME)).replacementAutoCycle.rolePrioritySelection);const before=JSON.stringify(f.asset(LIME));
  if(mode==='delete')f.sql.prepare("DELETE FROM shift_logs WHERE id='z-high'").run();
  if(mode==='unapprove')f.sql.prepare("UPDATE shift_logs SET status='작성중' WHERE id='z-high'").run();
  if(mode==='withdraw')f.sql.prepare("UPDATE shift_logs SET log_json='{}' WHERE id='z-high'").run();
  await normalize(f);const view=await f.project(LIME);
  assert.equal(view.replacementAutoCycle?.rolePrioritySelection,undefined,mode);assert.equal(view.replacementAutoCycle?.clockKnown,false,mode);assert.equal(view.actualLastReplacementAt,'',mode);assert.equal(view.dataParcRuntimeBasis.cycleBasisConfirmed,false,mode);assert.equal(view.dataParcRuntimeBasis.coverageComplete,false,mode);assert.equal(view.runtimeHours,1119.1,mode);assert.equal(JSON.stringify(f.asset(LIME)),before,mode);
 }
});
test('a source change during an authoritative transaction fails the dependency guard without changing the asset',async t=>{
 const f=await fixture();t.after(()=>f.sql.close());f.prime(LIME);actualPair(f);const before=JSON.stringify(f.asset(LIME));f.db.beforeBatch=()=>f.sql.prepare("UPDATE shift_logs SET log_json='{}' WHERE id='z-high'").run();const page=await f.step({normalizationVersion:4,limit:1});assert.equal(page.status,409);assert.equal(JSON.stringify(f.asset(LIME)),before);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM blower_log_receipts_v1 WHERE log_id LIKE '%role-priority%'").get().n,0);
});
test('an excluded off-page upper canonical source keeps its numeric legacy exclusion and cannot suppress the lower record',async t=>{
 const f=await fixture();t.after(()=>f.sql.close());f.prime(LIME);const diary='POCHEON#20260918#DAY#BCO1';const content='Limestone Blower #A V-Belt 교체 완료';f.shift('a-low',LIME_DAY,'BO1',[{id:'low-entry',tag:LIME,time:'14:20',content}]);f.legacy(987,diary,LIME_DAY,'BCO1',content);f.shift('legacy-'+diary,LIME_DAY,'BCO1',[{id:'high-entry',tag:LIME,time:'14:24',content}]);
 f.sql.prepare('INSERT INTO blower_history_candidates(id,source_fingerprint,tag_number,detected_type,detected_date,source_log_id,source_text,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('excluded-upper','excluded-upper',LIME,'replacement',LIME_DAY,'987',content,'excluded',NOW.toISOString());
 const page=await f.step({normalizationVersion:4,limit:1});assert.equal(page.status,200,JSON.stringify(page));assert.equal(page.rolePrioritySelectionCount,0);assert.equal(f.asset(LIME).last_replacement_at,'2026-09-18T05:20:00.000Z');assert.equal((await f.project(LIME)).replacementAutoCycle?.rolePrioritySelection,undefined);
});
test('cross-family same-rank authority cannot depend on which approved log fits the first page',async t=>{
 const f=await fixture();t.after(()=>f.sql.close());f.prime(LIME);const content='#1 Limestone Blower #A V-Belt 교체 완료';f.shift('a-low',LIME_DAY,'BO1',[{id:'low',tag:LIME,time:'14:20',content}]);f.shift('b-upper',LIME_DAY,'BCO1',[{id:'upper',tag:LIME,time:'14:24',content}]);f.shift('z-unranked',LIME_DAY,'TGO',[{id:'peer',tag:LIME,time:'14:30',content}]);
 const page=await f.step({normalizationVersion:4,limit:1});assert.equal(page.status,200,JSON.stringify(page));assert.equal(page.rolePrioritySelectionCount,0);assert.equal((await f.project(LIME)).replacementAutoCycle?.rolePrioritySelection,undefined);
});
