import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const NOW=new Date('2026-11-04T13:00:00.000Z');
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

test('V4 approved day job becomes an owned conservative RUN range, applies measured seconds and keeps partial coverage',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);f.oldDp(FBHE);
  f.shift('v4-day','2026-11-03','BCO1',[{id:'day-completion',tag:FBHE,content:'FBHE Blower #A V-Belt 교체 완료'}]);
  await normalize(f);const a=f.asset(FBHE),view=await f.project(FBHE);
  assert.equal(a.cycle_runtime_hours,0);assert.equal(view.runtimeHours,null);
  assert.equal(view.replacementAutoCycle.clockKnown,false);
  assert.equal(view.replacementAutoCycle.rangeQueryEligible,true);
  const from='2026-11-03T15:00:00.000Z';assert.equal(view.replacementAutoCycle.rangeStartAt,from);
  const planned=core.plan([view],NOW);assert.equal(planned.tasks.length,1,JSON.stringify(planned));
  assert.equal(planned.tasks[0].queryStartAt,from);assert.equal(planned.tasks[0].replacementAutoRange,true);
  const request=f.completedRequest(FBHE,'v4-range-seed',{startAt:from});
  const response=await api.applyDataParcRuntimeSync(f.db,USER,{requestId:request.requestId},{now:NOW});
  assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.equal(f.asset(FBHE).cycle_runtime_hours,.5);
  const measured=await f.project(FBHE);
  assert.equal(measured.dataParcRuntimeBasis.coverageComplete,false);
  assert.equal(measured.dataParcRuntimeBasis.appendReady,true);
  assert.equal(measured.dataParcRuntimeBasis.startAt,from);
  assert.equal(measured.remainingHours,null);assert.equal(measured.progressPct,null);
  assert.equal(measured.actualLastReplacementAt,'');assert.equal(measured.replacementAutoCycle.rangeQueryEligible,false);
  const next=core.plan([measured],new Date(NOW.getTime()+3600000));
  assert.equal(next.tasks.length,1,JSON.stringify(next));assert.equal(next.tasks[0].incremental,true);
  assert.equal(next.tasks[0].queryStartAt,NOW.toISOString());
});

test('a caller cannot apply replacement-day midnight or another recent subrange as the V4 seed',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);
  f.shift('v4-day','2026-11-03','BCO1',[{tag:FBHE,content:'FBHE Blower #A V-Belt 교체 완료'}]);await normalize(f);
  for(const [n,startAt]of ['2026-11-02T15:00:00.000Z','2026-11-04T01:00:00.000Z'].entries()){
    const request=f.completedRequest(FBHE,'forged-range-'+n,{startAt});const before=JSON.stringify(f.asset(FBHE));
    const response=await api.applyDataParcRuntimeSync(f.db,USER,{requestId:request.requestId,partialTracking:true,replacementAutoRange:true},{now:NOW});
    assert.equal(response.status,409);assert.equal(JSON.stringify(f.asset(FBHE)),before);
  }
});

test('night-shift untimed completion tracks only after the entire following workday',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);f.oldDp(FBHE);
  f.shift('night-job','2026-11-02','BCO1',[{tag:FBHE,content:'FBHE Blower #A V-Belt 교체 완료'}]);
  f.sql.prepare("UPDATE shift_logs SET shift='NS' WHERE id='night-job'").run();
  await normalize(f);const view=await f.project(FBHE);
  assert.equal(view.replacementAutoCycle.rangeStartAt,'2026-11-03T15:00:00.000Z');
  assert.equal(view.replacementAutoCycle.clockKnown,false);
  assert.equal(core.plan([view],NOW).tasks[0].queryStartAt,'2026-11-03T15:00:00.000Z');
});

test('range append retains exact seed coverage and replay never adds measured seconds twice',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);f.oldDp(FBHE);
  f.shift('seed-job','2026-11-03','BCO1',[{tag:FBHE,content:'FBHE Blower #A V-Belt 교체 완료'}]);await normalize(f);
  const from=(await f.project(FBHE)).replacementAutoCycle.rangeStartAt;
  const seed=f.completedRequest(FBHE,'range-seed',{startAt:from});
  assert.equal((await api.applyDataParcRuntimeSync(f.db,USER,{requestId:seed.requestId},{now:NOW})).status,200);
  const base=(await f.project(FBHE)).dataParcRuntimeBasis,a=f.asset(FBHE),end=new Date(NOW.getTime()+3600000).toISOString();
  const request=f.completedRequest(FBHE,'range-append',{startAt:NOW.toISOString(),endAt:end,observedAt:end,collectedAt:end,
    expectedCycleRuntimeRevision:'append-v1:'+a.cycle_runtime_revision,startState:'running',runningSeconds:900,totalRunningHours:.25});
  f.sql.prepare('INSERT INTO blower_runtime_append_v1 VALUES(?,?,?,?,?,?,?)').run(request.requestId,'dataparc_runtime:'+base.requestId,a.cycle_runtime_revision,
    base.observedAt,base.startAt,base.runningSeconds,NOW.toISOString());
  const options={now:new Date(end)};
  const applied=await api.applyDataParcRuntimeSync(f.db,USER,{requestId:request.requestId},options);
  assert.equal(applied.status,200,JSON.stringify(await applied.json()));assert.equal(f.asset(FBHE).cycle_runtime_hours,.75);
  const revision=f.asset(FBHE).cycle_runtime_revision;
  const replay=await api.applyDataParcRuntimeSync(f.db,USER,{requestId:request.requestId},options);
  assert.equal((await replay.json()).replayed,true);assert.equal(f.asset(FBHE).cycle_runtime_hours,.75);
  assert.equal(f.asset(FBHE).cycle_runtime_revision,revision);
  const view=await f.project(FBHE);assert.equal(view.dataParcRuntimeBasis.coverageComplete,false);
  assert.equal(view.dataParcRuntimeBasis.startAt,from);assert.equal(view.dataParcRuntimeBasis.runningSeconds,2700);
});

test('a manual runtime change after a V4 seed request keeps its value and rejects the completed stale result',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);
  f.shift('day-job','2026-11-03','BCO1',[{tag:FBHE,content:'FBHE Blower #A V-Belt 교체 완료'}]);await normalize(f);
  const from=(await f.project(FBHE)).replacementAutoCycle.rangeStartAt;
  const request=f.completedRequest(FBHE,'stale-range',{startAt:from});
  f.sql.prepare("UPDATE blower_history_assets SET runtime_hours=2,cycle_runtime_hours=2,cycle_runtime_revision='manual-new' WHERE tag_number=?").run(FBHE);
  const response=await api.applyDataParcRuntimeSync(f.db,USER,{requestId:request.requestId},{now:NOW});
  assert.equal(response.status,409);assert.equal(f.asset(FBHE).cycle_runtime_hours,2);
});

test('an automatic changeover cannot zero either a fresh or already measured signal-only replacement cycle',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);
  f.shift('precise-job','2026-11-03','BCO1',[{tag:FBHE,time:'09:58',content:'FBHE Blower #A V-Belt 교체 완료'}]);await normalize(f);
  const body={tagNumber:FBHE,expectedLastReplacementAt:f.asset(FBHE).last_replacement_at,eventDate:'2026-11-03T10:00:00+09:00'};
  let before=JSON.stringify(f.asset(FBHE));
  let response=await api.registerStartup(f.db,USER,body,{sourceType:'shift_log_operation_auto'});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'REPLACEMENT_BINARY_RUN_REQUIRED');
  assert.equal(JSON.stringify(f.asset(FBHE)),before);
  const request=f.completedRequest(FBHE,'precise-measurement');
  assert.equal((await api.applyDataParcRuntimeSync(f.db,USER,{requestId:request.requestId},{now:NOW})).status,200);
  before=JSON.stringify(f.asset(FBHE));
  response=await api.registerStartup(f.db,USER,body,{sourceType:'shift_log_operation_auto'});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'REPLACEMENT_BINARY_RUN_REQUIRED');
  assert.equal(JSON.stringify(f.asset(FBHE)),before);assert.equal(f.asset(FBHE).cycle_runtime_hours,.5);
});

test('all seven leader aliases keep mixed plaintext siblings out of legacy auto-scan while V4 applies only the explicit author-selected job',async t=>{
  const B='104HHL60AP621';
  for(const role of ['PART_LEADER','PARTLEADER','GROUP_LEADER','GROUPLEADER','SHIFT_LEADER','SHIFTLEADER','파트장']){
    const f=await fixture();t.after(()=>f.sql.close());f.prime(FBHE);f.prime(B,'2026-07-01T00:00:00+09:00',7);
    const checked='FBHE Blower #A V-Belt 교체 완료',id='mixed-leader-'+role;
    f.shift(id,'2026-11-03',role,[{id:'explicit-author-A',tag:FBHE,time:'09:58',content:checked,
      vBeltReplacement:{version:1,confirmed:true,content:checked,targets:[{tagNumber:FBHE,replacedOn:'2026-11-03',completedTime:''}]}},
      {id:'unannotated-summary-B',tag:B,time:'11:00',content:`[${B}] FBHE Blower #B V-Belt 교체 완료`}]);
    const beforeA=JSON.stringify(f.asset(FBHE)),beforeB=JSON.stringify(f.asset(B));
    const row=f.sql.prepare('SELECT * FROM shift_logs WHERE id=?').get(id);
    const legacy=await api.scanShiftLogs(f.db,USER,{autoApplyConfirmedReplacements:true},{logs:[row]});
    assert.equal(legacy.status,200,role);assert.equal((await legacy.json()).detectedCount,0,role);
    assert.equal(JSON.stringify(f.asset(FBHE)),beforeA,role);assert.equal(JSON.stringify(f.asset(B)),beforeB,role);
    await normalize(f);assert.equal(f.asset(FBHE).cycle_runtime_hours,0,role);assert.equal(JSON.stringify(f.asset(B)),beforeB,role);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM blower_history_events WHERE tag_number=? AND event_type='replacement'").get(FBHE).n,1,role);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM blower_history_events WHERE tag_number=? AND event_type='replacement'").get(B).n,0,role);
    assert.equal((await f.project(FBHE)).replacementAutoCycle.clockKnown,false,role);
  }
});
