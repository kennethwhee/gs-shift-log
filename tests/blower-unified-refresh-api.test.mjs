import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
import { __oisDataRequestsTest as queue } from '../functions/api/ois-data-requests.js';
const NOW = new Date('2026-09-09T06:00:00.000Z');
const REPLACEMENT = '2026-09-07T15:00:00.000Z';
const USER = {employeeNo:'operator-test', name:'최신화 시험'};
async function fixture({type='fbhe',pending=false}={}) {
  const sql = new DatabaseSync(':memory:');
  const db = { beforeBatch:null, afterStatement:null,
    prepare(text) { return {args:[], bind(...args) {assert.ok(args.length<=100); this.args=args; return this;},
      async first(){return sql.prepare(text).get(...this.args)||null;},
      async all(){return {results:sql.prepare(text).all(...this.args)};},
      async run(){return {meta:{changes:Number(sql.prepare(text).run(...this.args).changes)}};}};},
    async batch(statements){ if(this.beforeBatch){const f=this.beforeBatch;this.beforeBatch=null;f(sql);}sql.exec('BEGIN IMMEDIATE');
      try{const results=[];for(let i=0;i<statements.length;i++){results.push(await statements[i].run());this.afterStatement?.(sql,i);}sql.exec('COMMIT');return results;}
      catch(e){sql.exec('ROLLBACK');throw e;}}
  };
  await api.ensureSchema(db);
  sql.exec(`CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,started_at TEXT,requested_at TEXT,completed_at TEXT,result_json TEXT);`);
  const tag=type==='fbhe'?'104HHL60AP611':'104HHL10AN611';
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_started_at=NULL,cycle_start_state=?,cycle_start_revision='s1',cycle_runtime_revision='r1',cycle_runtime_state='stopped',cycle_runtime_hours=7,runtime_hours=7,runtime_anchor_at=NULL,cycle_runtime_anchor_at=?,is_running=0 WHERE tag_number=?`).run(REPLACEMENT,pending?'pending':'legacy',REPLACEMENT,tag);
  const kind=type==='fbhe'?'fbhe_vibration':'seal_pot_runtime';
  sql.prepare(`INSERT INTO ois_data_requests VALUES (?,?,?,?,?,?,?,?)`).run('q1',kind,'2026-09-08~2026-09-09','complete','2026-09-09T05:45:00.000Z','2026-09-09T05:44:00.000Z','2026-09-09T05:55:00.000Z','{"test":true}');
  const body={tagNumber:tag,requestType:kind,requestIds:['q1'],startDate:'2026-09-08',endDate:'2026-09-09',runtimeHours:20,
    observedAt:NOW.toISOString(),latestSampleAt:'2026-09-09T05:30:00.000Z',cycleCoveragePct:100,rangeCoveragePct:100,cycleRangeComplete:true,
    targetState:'running',stateSource:type==='fbhe'?'vibration':'pressure',firstRunningAt:'',expectedLastReplacementAt:REPLACEMENT,
    expectedCycleStartState:pending?'pending':'legacy',expectedCycleStartedAt:'',expectedCycleStartRevision:'s1',expectedCycleRuntimeRevision:'r1'};
  const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  const snapshot=()=>JSON.stringify({a:sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all(),e:sql.prepare('SELECT * FROM blower_history_events ORDER BY id').all(),h:sql.prepare('SELECT * FROM blower_history_asset_history ORDER BY id').all(),g:sql.prepare('SELECT * FROM blower_history_atomic_guard').all()});
  const apply=async overrides=>{const response=await api.applyOisRuntimeRefresh(db,USER,{...body,...overrides},{now:NOW});return {status:response.status,...await response.json()};};
  return {sql,db,tag,body,asset,snapshot,apply,close:()=>sql.close()};
}
for(const type of ['fbhe','seal']) for(const state of ['running','stopped','keep']) test(`atomic ${type} ${state}: exact runtime, replacement preserved, audit, replay`,async()=>{
 const f=await fixture({type});try{
   const out=await f.apply({targetState:state});assert.equal(out.status,200,out.message);
   const a=f.asset();assert.equal(a.last_replacement_at,REPLACEMENT);assert.equal(a.cycle_start_state,'legacy');assert.equal(a.cycle_started_at,null);
   assert.equal(a.cycle_runtime_hours,20);assert.equal(a.cycle_runtime_state,state==='keep'?'stopped':state);assert.notEqual(a.cycle_runtime_revision,'r1');
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_events').get().n,1);
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
   const before=f.snapshot();const replay=await f.apply({targetState:state});assert.equal(replay.status,200);assert.equal(replay.unchanged,true);assert.equal(f.snapshot(),before);
   const conflict=await f.apply({targetState:state,runtimeHours:19});assert.equal(conflict.status,409);assert.equal(f.snapshot(),before);
 }finally{f.close();}
});
const invalids=[
 {requestIds:[]},{requestIds:['q1','q1']},{requestIds:['x;drop']},{requestIds:Array(13).fill('a')},{requestType:'other'},
 {tagNumber:'104SDF01AN001'},{runtimeHours:-1},{runtimeHours:'20'},{runtimeHours:40},{runtimeHours:Infinity},{runtimeHours:NaN},
 {observedAt:'bad'},{observedAt:'2026-09-09T05:40:00.000Z'},{observedAt:'2026-09-09T06:02:00.000Z'},
 {latestSampleAt:'2026-09-09T02:59:00.000Z'},{latestSampleAt:'2026-09-09T06:02:00.000Z'},
 {cycleCoveragePct:94.999},{rangeCoveragePct:94},{rangeCoveragePct:101},{cycleCoveragePct:'100'},
 {cycleRangeComplete:false},{targetState:'unknown'},{stateSource:'temperature'},
 {expectedCycleStartRevision:'old'},{expectedCycleRuntimeRevision:'old'},{expectedLastReplacementAt:''},{expectedCycleStartedAt:'bad'},
 {expectedCycleRuntimeRevision:''},{endDate:'2026-09-08'},{startDate:'2026-09-09'},{startDate:'bad'}
];
for (const [i,input] of invalids.entries()) test(`OIS invalid input ${i+1} leaves every asset/event/audit unchanged`,async()=>{
 const f=await fixture();try{const before=f.snapshot(),out=await f.apply(input);assert.ok(out.status>=400,JSON.stringify(input));assert.equal(f.snapshot(),before);}finally{f.close();}
});
for(const mutation of ["UPDATE ois_data_requests SET status='processing'","UPDATE ois_data_requests SET request_type='seal_pot_runtime'","UPDATE ois_data_requests SET target_date='2026-09-07~2026-09-09'","UPDATE ois_data_requests SET completed_at='2026-09-09T02:00:00.000Z'","DELETE FROM ois_data_requests"])
test(`unverified OIS source cannot apply: ${mutation}`,async()=>{const f=await fixture();try{f.sql.exec(mutation);const before=f.snapshot(),out=await f.apply();assert.equal(out.status,409,out.message);assert.equal(f.snapshot(),before);}finally{f.close();}});
test('Seal temperature can correct runtime without deciding operating state',async()=>{const f=await fixture({type:'seal'});try{const before=f.snapshot();assert.equal((await f.apply({stateSource:'temperature'})).status,400);assert.equal(f.snapshot(),before);assert.equal((await f.apply({stateSource:'temperature',targetState:'keep'})).status,200);assert.equal(f.asset().is_running,0);}finally{f.close();}});
test('verified first OIS startup changes cycle only once with a separate startup event',async()=>{const f=await fixture({pending:true});try{const out=await f.apply({firstRunningAt:'2026-09-08T00:00:00.000Z'});assert.equal(out.status,200,out.message);assert.equal(f.asset().cycle_start_state,'started');assert.equal(f.asset().cycle_started_at,'2026-09-08T00:00:00.000Z');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM blower_history_events WHERE event_type='startup'").get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_events').get().n,2);}finally{f.close();}});
test('pending with verified stopped zero stays pending; unknown first startup cannot write',async()=>{const f=await fixture({pending:true});try{const before=f.snapshot();assert.equal((await f.apply({runtimeHours:0,targetState:'stopped'})).status,200);assert.equal(f.snapshot(),before);assert.equal((await f.apply()).status,400);assert.equal(f.snapshot(),before);}finally{f.close();}});
test('cycle changed immediately before transaction is preserved and no audit leaks',async()=>{const f=await fixture();try{f.db.beforeBatch=sql=>sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='concurrent',cycle_runtime_hours=123 WHERE tag_number=?").run(f.tag);const out=await f.apply();assert.equal(out.status,409,out.message);assert.equal(f.asset().cycle_runtime_hours,123);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_events').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,0);}finally{f.close();}});
test('SQL failure midway rolls back runtime and event as one transaction',async()=>{const f=await fixture();try{const before=f.snapshot();f.db.afterStatement=(_,i)=>{if(i===1)throw new Error('injected disk failure');};await assert.rejects(()=>f.apply(),/injected/);assert.equal(f.snapshot(),before);}finally{f.close();}});
for(const type of ['organic_fuel','fbhe'])test(`${type} running accumulation follows measured/continuous policy`,()=>{
 const asset={blower_type:type,tag_number:type==='fbhe'?'104HHL60AP611':'104SDF01AN001',runtime_hours:33.3,runtime_anchor_at:'2026-09-08T06:00:00.000Z',is_running:1,cycle_runtime_hours:33.3,cycle_runtime_state:'running',cycle_runtime_anchor_at:'2026-09-08T06:00:00.000Z'};
 for(const fn of [api.currentRuntimeHours,api.runtimeHoursAt,api.cycleRuntimeHoursAt])assert.ok(Math.abs(fn(asset,NOW)-(type==='organic_fuel'?33.3:57.3))<1e-8);
 assert.equal(api.isIntermittentBlower({tag_number:'204LMDF01AN001'}),true);
});
test('unmeasured organic legacy totals cannot surface as verified cumulative values',()=>{
 const a=api.buildAssetState({tag_number:'104SDF01AN001',blower_type:'organic_fuel',last_replacement_at:REPLACEMENT,runtime_hours:100,cycle_runtime_hours:100,cycle_start_state:'legacy',cycle_runtime_state:'running',runtime_measurement_verified:false},null,null,null,NOW);
 assert.equal(a.cycleElapsedHours,null);assert.equal(a.runtimeHours,null);assert.equal(a.measurementRequired,true);assert.equal(a.severity,'runtime_unknown');assert.equal(a.cycleStoredStartedAt,'');
});
test('old open-day OIS cache cannot masquerade as a full historical day',()=>{
 assert.equal(queue.completedOisChunkCoversEnd({started_at:'2026-09-08T14:59:59Z'},'2026-09-08'),false);
 assert.equal(queue.completedOisChunkCoversEnd({started_at:'2026-09-08T15:00:00Z'},'2026-09-08'),true);
 assert.equal(queue.completedOisChunkCoversEnd({requested_at:'2026-09-09T00:00:00Z'},'2026-09-08'),true);
 assert.equal(queue.completedOisChunkCoversEnd({},'2026-09-08'),false);
});
