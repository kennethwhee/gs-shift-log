import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { __blowerHistoryTest as history } from '../functions/api/blower-history.js';
const require=createRequire(import.meta.url);
const core=require('../maintenance/blower-unified-refresh.js');
const TAGS=['103HRJ01AN602','203HRJ01AN601','203HRJ01AN602'];
const user={employeeNo:'2014081',name:'Test Owner',isSuperAdmin:false};
const signal=t=>`GSPOGE.ABB_DCS.${t}XB04`;
const replacement=t=>t==='203HRJ01AN601' ? '2026-02-24T13:45:00+09:00' : '2026-09-22T00:00:00+09:00';
class D1 {
  constructor(){ this.raw=new DatabaseSync(':memory:'); }
  prepare(sql){
    const base=this.raw.prepare(sql);
    return {bind(...params){ const exec={
      first:async()=>base.get(...params)||null,
      all:async()=>({results:base.all(...params)}),
      run:async()=>({meta:{changes:base.run(...params).changes}})};
      return exec;
    },run:async()=>({meta:{changes:base.run().changes}}),all:async()=>({results:base.all()})};
  }
}
const utc=(ms)=>new Date(ms).toISOString();
function fixture(tag){
 const database=new D1();
 database.raw.exec(`CREATE TABLE blower_history_assets (
   tag_number TEXT PRIMARY KEY, blower_type TEXT, enabled INTEGER,
   last_replacement_at TEXT, cycle_start_state TEXT, cycle_start_revision TEXT,
   cycle_runtime_revision TEXT, cycle_started_at TEXT, cycle_runtime_hours REAL);
 CREATE TABLE ois_data_requests (
  id TEXT PRIMARY KEY,request_type TEXT,status TEXT,requested_by_id TEXT,result_json TEXT,completed_at TEXT);
 CREATE TABLE blower_runtime_probe_intents_v5 (
  request_id TEXT PRIMARY KEY,reuse_key TEXT,asset_tag TEXT,dataparc_tag TEXT,
  window_start TEXT,window_end TEXT,schema_version INTEGER,chunk_days INTEGER,chunk_count INTEGER,
  expected_last_replacement_at TEXT,expected_cycle_start_state TEXT,expected_cycle_started_at TEXT,
  expected_cycle_start_revision TEXT,expected_cycle_runtime_revision TEXT);
 CREATE TABLE sentinel_check (t TEXT PRIMARY KEY,value TEXT);
 INSERT INTO sentinel_check(t,value) VALUES('CANARY','UNCHANGED');`);
 database.raw.prepare(`INSERT INTO blower_history_assets VALUES(?,?,?,?,?,?,?,?,?)`)
   .run(tag,'limestone',1,replacement(tag),'legacy','s1','r1','',922.1);
 return database;
}
function queue(db,tag,id,startMs,endMs,runningSeconds,{source=signal(tag),owner=user.employeeNo,modified={}}={}){
 const startAt=utc(startMs),endAt=utc(endMs), collectedAt=utc(endMs+2000);
 const body={schemaVersion:1,requestType:'blower_runtime_probe',requestId:id,ok:true,readOnly:true,
   assetTag:tag,dataParcTag:source,startAt,endAt,observedAt:endAt,collectedAt,
   expectedLastReplacementAt:replacement(tag),expectedCycleStartState:'legacy',expectedCycleStartedAt:'',
   expectedCycleStartRevision:'s1',expectedCycleRuntimeRevision:'r1',
   startState:'running',endState:'running',currentState:'running',isRunning:true,
   totalRunningHours:runningSeconds/3600,runningSeconds,chunkDays:31,chunkCount:1,completedChunkCount:1,
   chunks:[{index:1,startAt,endAt,startState:'running',endState:'running',totalRunningHours:runningSeconds/3600,runningSeconds}],
   ...modified};
 db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?)')
   .run(id,'blower_runtime_probe','complete',owner,JSON.stringify(body),collectedAt);
 db.raw.prepare(`INSERT INTO blower_runtime_probe_intents_v5 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .run(id,`limestone-run-ledger-v1:${id}`,tag,source,startAt,endAt,1,31,1,replacement(tag),'legacy','','s1','r1');
}
function responseJson(reply){assert.equal(reply instanceof Response,true);return reply.json();}
function dates(){const end=Math.floor((Date.now()-60000)/1000)*1000;return [end-2*3600000,end];}
for(const tag of TAGS){
 test(`${tag} tracks consecutive verified seconds exactly, replays without another write`,async()=>{
  const db=fixture(tag),[s,e]=dates();
  assert.deepEqual(await history.readLimestoneRunTracking(db),[]);
  queue(db,tag,'first',s,e,3600);
  let result=await responseJson(await history.applyLimestoneRunTrack(db,user,{requestId:'first'}));
  assert.equal(result.ok,true);assert.equal(result.applied,true);
  assert.equal(result.totalRunningSeconds,3600);assert.equal(result.segmentCount,1);
  const firstRow=db.raw.prepare('SELECT * FROM blower_limestone_run_segments_v1').get();
  result=await responseJson(await history.applyLimestoneRunTrack(db,user,{requestId:'first'}));
  assert.equal(result.replayed,true);assert.equal(result.totalRunningSeconds,3600);
  assert.deepEqual(db.raw.prepare('SELECT * FROM blower_limestone_run_segments_v1').get(),firstRow);
  const t=e+1000; // first end was already close to now; second cannot be fresher in future. Use overlapping protected test below.
  assert.equal(db.raw.prepare('SELECT cycle_runtime_hours FROM blower_history_assets').get().cycle_runtime_hours,922.1);
  assert.equal(db.raw.prepare(`SELECT value FROM sentinel_check WHERE t='CANARY'`).get().value,'UNCHANGED');
 });
 test(`${tag} blocks overlapping RUN, changed cycle, wrong tag and unauthorized owner`,async()=>{
  const db=fixture(tag),[s,e]=dates();
  queue(db,tag,'first',s,e,3600);
  assert.equal((await responseJson(await history.applyLimestoneRunTrack(db,user,{requestId:'first'}))).ok,true);
  queue(db,tag,'overlap',s+60000,e,1200);
  const replay=await history.applyLimestoneRunTrack(db,user,{requestId:'overlap'});
  assert.equal(replay.status,409);
  assert.equal((await history.readLimestoneRunTracking(db))[0].totalRunningSeconds,3600);
  assert.equal((await history.applyLimestoneRunTrack(db,{employeeNo:'other'}, {requestId:'first'})).status,403);
  db.raw.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?').run('r2',tag);
  assert.equal((await history.applyLimestoneRunTrack(db,user,{requestId:'overlap'})).status,409);
 });
 test(`${tag} persists proof in SQL and planner uses exact last endpoint`,async()=>{
  const db=fixture(tag),[s,e]=dates();queue(db,tag,'first',s,e,3600);
  assert.equal((await history.applyLimestoneRunTrack(db,user,{requestId:'first'})).status,200);
  const stored=(await history.readLimestoneRunTracking(db))[0];
  const now=new Date(e+10000);
  const a={enabled:true,blowerType:'limestone',tagNumber:tag,lastReplacementAt:replacement(tag),
    cycleStartState:'legacy',cycleStartRevision:'s1',cycleRuntimeRevision:'r1',
    dataParcTag:signal(tag)};
  const planned=core.plan([a],now,()=>null,()=>stored);
  assert.equal(planned.tasks.length,1);assert.equal(planned.tasks[0].startAt,utc(e));
  assert.equal(planned.tasks[0].previewOnly,true);
  assert.equal(planned.skipped.length,0);
  assert.equal(core.plan([a],now,()=>null,()=>({...stored,totalRunningSeconds:-1})).tasks.length,0);
 });
}
test('three RUN-only requests cannot alter any V-Belt accumulated hour and never borrow another asset signal',async()=>{
 const db=fixture(TAGS[0]),[s,e]=dates();
 queue(db,TAGS[0],'wrong',s,e,3600,{source:signal(TAGS[1])});
 const r=await history.applyLimestoneRunTrack(db,user,{requestId:'wrong'});
 assert.equal(r.status,409);
 assert.deepEqual(await history.readLimestoneRunTracking(db),[]);
 assert.equal(db.raw.prepare('SELECT cycle_runtime_hours FROM blower_history_assets').get().cycle_runtime_hours,922.1);
});
test('scheduling handles RUN-only receipts separately without modifying standard dataparc sync',()=>{
 const s=fs.readFileSync(new URL('../maintenance/blower-schedule-v1.js',import.meta.url),'utf8');
 assert.match(s,/limestoneTrackingOnly:\s*actual\.probe\?\.limestoneTrackingOnly/);
 assert.match(s,/limestone_run_track_apply/);
 assert.match(s,/core\.plan\(data\.assets, new Date\(data\.generatedAt\), \(\) => null,/);
 const api=fs.readFileSync(new URL('../functions/api/ois-data-requests.js',import.meta.url),'utf8');
 assert.match(api,/limestone-run-ledger-v1:/);
 assert.match(api,/limestoneTrackingOnly/);
});
test('full UI uses saved RUN tracking as a single verified display, never writes to V-Belt totals',()=>{
 const ui=fs.readFileSync(new URL('../maintenance/blower-history.js',import.meta.url),'utf8');
 assert.match(ui,/data-limestone-display/);
 assert.match(ui,/verifiedLimestoneRunDisplay/);
 assert.match(ui,/state\.data\?\.limestoneRunTracking/);
 assert.match(ui,/if \(snapshot\.assets\.some\(isPreviewCandidate\)\)/);
 assert.match(ui,/API_URL \+ ['"]\?action=limestone_run_tracking/);
 const server=fs.readFileSync(new URL('../functions/api/blower-history.js',import.meta.url),'utf8');
 assert.match(server,/CREATE TABLE IF NOT EXISTS blower_limestone_run_segments_v1/);
 assert.match(server,/limestoneRunTracking: await readLimestoneRunTracking\(database\)/);
 assert.match(server,/LIMESTONE_TRACK_NOT_CONTIGUOUS/);
 assert.match(server,/intent\.reuse_key/);
});
for(const tag of TAGS) {
  test(`${tag}: second verified interval starts at previous saved end and adds only new RUN seconds`,async()=>{
    const db=fixture(tag),[start,end]=dates();
    queue(db,tag,'segment-one',start,end,3600);
    assert.equal((await responseJson(await history.applyLimestoneRunTrack(db,user,{requestId:'segment-one'}))).totalRunningSeconds,3600);
    queue(db,tag,'segment-two',end,end+30000,30);
    const confirmed=await responseJson(await history.applyLimestoneRunTrack(db,user,{requestId:'segment-two'}));
    assert.equal(confirmed.applied,true);
    assert.equal(confirmed.totalRunningSeconds,3630);
    assert.equal(confirmed.segmentCount,2);
    assert.equal(confirmed.observedAt,utc(end+30000));
    assert.equal((await responseJson(await history.applyLimestoneRunTrack(db,user,{requestId:'segment-two'}))).totalRunningSeconds,3630);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS count FROM blower_limestone_run_segments_v1').get().count,2);
    assert.equal(db.raw.prepare('SELECT cycle_runtime_hours FROM blower_history_assets').get().cycle_runtime_hours,922.1);
  });
}
test('a replacement or runtime revision changed during the insert is rejected by SQL-level compare-and-swap',async()=>{
  const tag=TAGS[0],db=fixture(tag),[s,e]=dates();queue(db,tag,'race',s,e,3600);
  const originalPrepare=db.prepare.bind(db);
  let changeOnce=true;
  db.prepare=(sql)=>{
    const statement=originalPrepare(sql);
    if (changeOnce && sql.includes('WITH previous AS (')) {
      changeOnce=false;
      const oldBind=statement.bind.bind(statement);
      statement.bind=(...params)=>{
        const prepared=oldBind(...params), originalRun=prepared.run;
        prepared.run=async()=>{
          db.raw.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=?').run('r-concurrent');
          return originalRun();
        };
        return prepared;
      };
    }
    return statement;
  };
  const result=await history.applyLimestoneRunTrack(db,user,{requestId:'race'});
  assert.equal(result.status,409);
  assert.deepEqual(await history.readLimestoneRunTracking(db),[]);
  assert.equal(db.raw.prepare('SELECT cycle_runtime_hours FROM blower_history_assets').get().cycle_runtime_hours,922.1);
});
test('initial RUN tracking rejects full-cycle retroactive writes and does not invent prehistory',async()=>{
  const tag=TAGS[0],db=fixture(tag),end=dates()[1];
  queue(db,tag,'too-long',end-25*3600000,end,24*3600);
  const reply=await history.applyLimestoneRunTrack(db,user,{requestId:'too-long'});
  assert.equal(reply.status,409);
  assert.equal((await reply.json()).code,'LIMESTONE_TRACK_FIRST_RANGE_TOO_LARGE');
  assert.deepEqual(await history.readLimestoneRunTracking(db),[]);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='blower_limestone_run_segments_v1'").get().n,0,
    'rejected first window must not create an unnecessary D1 ledger table');
});
test('invalid Agent result cannot create a RUN ledger segment',async()=>{
  const tag=TAGS[0],db=fixture(tag),[s,e]=dates();
  queue(db,tag,'invalid-binary',s,e,3600,{modified:{endState:'unknown'}});
  const reply=await history.applyLimestoneRunTrack(db,user,{requestId:'invalid-binary'});
  assert.equal(reply.status,409);
  assert.deepEqual(await history.readLimestoneRunTracking(db),[]);
});

// V3-G R2: realistic UI planner contract. A separate held-Limestone ledger
// request must not run for unrelated Blowers, and ledger outages cannot
// disable already-working ordinary assets or bypass login loss.
const vm=require('node:vm');
function ledgerUiPlanFixture({withHeld=false, ledgerError=null, ledgerItems=[]}={}) {
  const ui=fs.readFileSync(new URL('../maintenance/blower-history.js',import.meta.url),'utf8');
  const first=ui.indexOf('  async function readUnifiedRefreshPlan(core, io)');
  const last=ui.indexOf('  function updateOverviewRefreshProgress(',first);
  assert.ok(first >= 0 && last > first);
  const lastReplacementAt='2026-09-22T00:00:00+09:00';
  const normal={tagNumber:'104ETG30AN601',displayName:'Bag Filter A',enabled:true,
    blowerType:'flyash_bag',lastReplacementAt:'2026-09-25T00:00:00+09:00',
    cycleStartState:'legacy',cycleStartRevision:'s1',cycleRuntimeRevision:'r1',
    dataParcTag:'GSPOGE.ABB_DCS.104ETG30AN601XB04',dataParcRuntimeBasis:null,
    hasUnverifiedDataParcHistory:false};
  const held={tagNumber:'103HRJ01AN602',displayName:'Limestone 1B',enabled:true,
    blowerType:'limestone',lastReplacementAt,cycleStartState:'legacy',
    cycleStartRevision:'s1',cycleRuntimeRevision:'r1',
    dataParcTag:signal('103HRJ01AN602'),dataParcRuntimeBasis:null,
    hasUnverifiedDataParcHistory:true};
  const page={ok:true,version:'blower-refresh-state-page-v1',done:true,
    nextCursor:null,user:{name:'operator'},permissions:{canWrite:true},
    assets:withHeld?[held,normal]:[normal],generatedAt:'2026-10-31T07:00:00Z'};
  const context=vm.createContext({Date,Map,Set,Number,String,Array,Error,Math,
    API_URL:'/api/blower-history',encodeURIComponent,
    assertUnifiedRefreshWritable(){},hasAuthenticatedWriteAccess(){return true;}});
  vm.runInContext(ui.slice(first,last),context);
  const calls=[];
  const io={api:async options=>{
    calls.push(options.url);
    if (options.url.includes('?action=limestone_run_tracking')) {
      if (ledgerError) throw ledgerError;
      return {ok:true,version:'limestone-run-ledger-v1',items:ledgerItems};
    }
    return page;
  }};
  const planner={readWithRetry:op=>op(),plan:core.plan};
  return {context,io,planner,calls,page};
}
test('V3-G R2: standard Blower plan has no extra Limestone ledger read',async()=>{
  const h=ledgerUiPlanFixture();
  const planned=await h.context.readUnifiedRefreshPlan(h.planner,h.io);
  assert.equal(h.calls.length,1);
  assert.ok(h.calls[0].includes('refresh_state_page'));
  assert.equal(planned.tasks.length,1);
  assert.equal(planned.tasks[0].asset.tagNumber,'104ETG30AN601');
});
test('V3-G R2: held Limestone uses fresh ledger endpoint without disturbing standard Blowers',async()=>{
  const tag='103HRJ01AN602',stored={tagNumber:tag,dataParcTag:signal(tag),
    lastReplacementAt:'2026-09-22T00:00:00+09:00',cycleStartRevision:'s1',
    totalRunningSeconds:3600,observedAt:'2026-10-31T06:30:00Z'};
  const h=ledgerUiPlanFixture({withHeld:true,ledgerItems:[stored]});
  const planned=await h.context.readUnifiedRefreshPlan(h.planner,h.io);
  assert.equal(h.calls.length,2);
  assert.ok(h.calls[1].includes('?action=limestone_run_tracking'));
  assert.equal(planned.tasks.length,2);
  const held=planned.tasks.find(x=>x.snapshot.tagNumber===tag);
  assert.equal(held.previewOnly,true);
  assert.equal(held.startAt,new Date(stored.observedAt).toISOString());
  assert.equal(planned.targetCount,2);
});
test('V3-G R2: ledger outage skips only held Limestone, without stopping ordinary Blower',async()=>{
  const h=ledgerUiPlanFixture({withHeld:true,ledgerError:Object.assign(new Error('ledger offline'),{status:503})});
  const planned=await h.context.readUnifiedRefreshPlan(h.planner,h.io);
  assert.equal(planned.tasks.length,1);
  assert.equal(planned.tasks[0].snapshot.tagNumber,'104ETG30AN601');
  assert.equal(planned.skipped.length,1);
  assert.equal(planned.skipped[0].tagNumber,'103HRJ01AN602');
  assert.match(planned.skipped[0].message,/저장 기준|저장 기준 확인|추적 저장 기준/);
  assert.equal(planned.targetCount,2);
});
test('V3-G R2: denied ledger access aborts the entire refresh',async()=>{
  const h=ledgerUiPlanFixture({withHeld:true,ledgerError:Object.assign(new Error('expired'),{status:401})});
  await assert.rejects(()=>h.context.readUnifiedRefreshPlan(h.planner,h.io),e=>e.status===401);
});
