import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as api, onRequestPost } from '../functions/api/blower-history.js';
const NOW = new Date('2026-09-09T01:00:00.000Z');
const USER = { employeeNo:'bounded-test', name:'묶음 시험' };
const WINDOW = {fromDate:'2025-09-09',endDate:'2026-09-09',snapshotAt:NOW.toISOString()};
const TAG = '104HHL60AP611', TAGB = '104HHL60AP621';
async function fixture() {
 const sql = new DatabaseSync(':memory:');
 const queries=[];
 const db={queries, failNext:null,
  prepare(text){return {values:[],bind(...values){assert.ok(values.length<=100);this.values=values;return this;},
   async all(){queries.push({text,args:this.values});if(db.failNext?.(text)) {db.failNext=null;throw new Error('D1_ERROR: test temporarily overloaded');}return {results:sql.prepare(text).all(...this.values)};},
   async first(){queries.push({text,args:this.values});return sql.prepare(text).get(...this.values)||null;},
   async run(){queries.push({text,args:this.values});return {meta:{changes:Number(sql.prepare(text).run(...this.values).changes)}};}};},
  async batch(statements){sql.exec('BEGIN IMMEDIATE');try {const out=[];for(const q of statements)out.push(await q.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}
 };
 await api.ensureSchema(db);
 sql.exec(`CREATE TABLE shift_logs (id TEXT PRIMARY KEY, work_date TEXT, shift TEXT, role TEXT, author TEXT, status TEXT, log_json TEXT, updated_at TEXT);
 CREATE INDEX shift_log_date ON shift_logs(work_date,updated_at,id);`);
 function add(id, text='', overrides={}) {
  const row={id,work_date:'2026-09-08',shift:'D/S',role:'BCO1',author:'시험자',status:'결재완료',
   log_json:JSON.stringify({entries:[{time:'10:00',content:text}]}),updated_at:'2026-09-08T10:00:00.000Z',...overrides};
  sql.prepare(`INSERT INTO shift_logs(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
 }
 const step=async body=>{const res=await api.latestLogsStep(db,USER,{phase:'replacement',window:WINDOW,...body},{now:NOW});return {status:res.status,...await res.json()};};
 const assets=()=>sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all();
 queries.length=0;
 return {sql,db,add,step,assets,close:()=>sql.close()};
}

test('server establishes the original 365-day KST window and enforces a bounded page',()=>{
 const p=api.latestLogWindow({phase:'replacement'},NOW);
 assert.deepEqual(p.window,WINDOW);assert.equal(p.limit,4);assert.equal(p.cursor,null);
 const roll=api.latestLogWindow({phase:'replacement'},new Date('2026-09-08T15:00:00Z'));
 assert.equal(roll.window.endDate,'2026-09-09');assert.equal(roll.window.fromDate,'2025-09-09');
});
for(const bad of [{phase:'anything'},{limit:0},{limit:9},{limit:'4'},{limit:2.5},{cursor:{id:'x'}},
 {window:{...WINDOW,fromDate:'2025-09-08'}},{window:{...WINDOW,endDate:'2026-09-10'}},
 {window:{...WINDOW,snapshotAt:'2025-09-09T00:00:00Z'}},{window:{...WINDOW,snapshotAt:'2026-09-10T00:00:00Z'}},
 {window:{...WINDOW,fromDate:'2025-02-30'}},
 {window:WINDOW,cursor:{workDate:'2026-09-08',updatedAt:'',id:''}},
 {window:WINDOW,cursor:{workDate:'2026-09-10',updatedAt:'',id:'x'}}])
 test(`invalid pagination rejected before DB reads: ${JSON.stringify(bad)}`,async()=>{
 const db={prepare(){throw new Error('DB must not be reached');}};
 const response=await api.latestLogsStep(db,USER,{phase:'replacement',...bad},{now:NOW});
 assert.equal(response.status,400);assert.equal((await response.json()).code,'BLOWER_LOG_PAGE_INVALID');
 });

test('keyset covers more than the old 10,000-row cap without OFFSET or large JSON reads',async()=>{
 const f=await fixture();try{
  f.sql.exec('BEGIN');
  for(let i=0;i<10037;i++)f.add(`log-${String(i).padStart(5,'0')}`,'',{work_date:new Date(Date.parse('2025-09-09T00:00:00Z')+(i%365)*86400000).toISOString().slice(0,10),updated_at:i%19===0?null:'2026-09-08T01:00:00Z'});
  f.sql.exec('COMMIT');
  let cursor=null, seen=new Set(),pages=0;
  while(true){const p=await api.loadLatestLogPage(f.db,{phase:'replacement',window:WINDOW,cursor,limit:8},{now:NOW});
   assert.ok(p.logs.length<=8);for(const row of p.logs){assert.ok(!seen.has(row.id));seen.add(row.id);}pages++;
   if(p.done)break;assert.notDeepEqual(p.nextCursor,cursor);cursor=p.nextCursor;
  }
  assert.equal(seen.size,10037);assert.equal(pages,1255);
  for(const q of f.db.queries){assert.doesNotMatch(q.text,/OFFSET/i);assert.equal(q.args.at(-1),9);}
 }finally{f.close();}
});

test('approved-only dates and cutoff include null timestamps but defer future edits',async()=>{
 const f=await fixture();try{
  f.add('old','',{work_date:'2025-09-08'});f.add('future','',{work_date:'2026-09-10'});
  f.add('draft','',{status:'작성중'});f.add('edited-later','',{updated_at:'2026-09-09T02:00:00.000Z'});
  f.add('null-stamp','',{updated_at:null});f.add('exact-cutoff','',{updated_at:NOW.toISOString()});
  f.add('normal');
  const p=await api.loadLatestLogPage(f.db,{phase:'replacement',window:WINDOW,limit:8},{now:NOW});
  assert.deepEqual(p.logs.map(x=>x.id),['null-stamp','normal','exact-cutoff']);assert.equal(p.done,true);
 }finally{f.close();}
});

test('deleting a previously processed source row cannot shift or skip the next page',async()=>{
 const f=await fixture();try{
  for(const id of ['a','b','c','d','e'])f.add(id);
  const a=await f.step({limit:2});assert.equal(a.scannedLogCount,2);
  f.sql.exec("DELETE FROM shift_logs WHERE id='a'");
  const b=await api.loadLatestLogPage(f.db,{phase:'replacement',window:WINDOW,cursor:a.nextCursor,limit:2},{now:NOW});
  assert.deepEqual(b.logs.map(x=>x.id),['c','d']);
 }finally{f.close();}
});

test('candidate processing is bounded, pending-only, replay-safe and does not change runtimes',async()=>{
 const f=await fixture();try{
  f.add('a',`#1 FBHE Blower #A ${TAG} V-Belt 교체 완료`);
  f.add('b',`#1 FBHE Blower #B ${TAGB} V-Belt 교체 완료`);
  f.add('c',`#1 FBHE Blower #C 104HHL60AP631 V-Belt 교체 예정`);
  const before=JSON.stringify(f.assets());
  const p=await f.step({limit:1});assert.equal(p.status,200,p.message);assert.equal(p.insertedCount,1);assert.equal(p.done,false);
  assert.equal(p.nextCursor.id,'a');assert.equal(p.pendingCandidates,undefined);
  const first=f.sql.prepare('SELECT * FROM blower_history_candidates').all();assert.equal(first.length,1);assert.equal(first[0].status,'pending');
  const replay=await f.step({limit:1});assert.equal(replay.insertedCount,0);assert.deepEqual(replay.nextCursor,p.nextCursor);
  const second=await f.step({limit:1,cursor:p.nextCursor});assert.equal(second.insertedCount,1);
  const third=await f.step({limit:1,cursor:second.nextCursor});assert.equal(third.insertedCount,0);assert.equal(third.done,true);
  assert.equal(JSON.stringify(f.assets()),before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_events').get().n,0);
 }finally{f.close();}
});

test('higher-role duplicate suppression still sees a superior log outside this one-row page',async()=>{
 const f=await fixture();try{
  const text=`#1 FBHE Blower #A ${TAG} V-Belt 교체 완료`;
  f.add('a-lower',text,{role:'BO1'});f.add('b-superior',text,{role:'BCO1'});
  const a=await f.step({limit:1});assert.equal(a.insertedCount,0);assert.ok(a.suppressedDuplicateFragments>0);
  const b=await f.step({limit:1,cursor:a.nextCursor});assert.equal(b.insertedCount,1);
  const candidate=f.sql.prepare('SELECT * FROM blower_history_candidates').get();assert.equal(candidate.source_log_id,'b-superior');
 }finally{f.close();}
});

function initOperation(f) {
 const replacement='2026-09-01T00:00:00+09:00';
 f.sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,
  cycle_runtime_state='stopped',cycle_runtime_hours=10,cycle_runtime_anchor_at=?,cycle_runtime_revision='r1',
  runtime_hours=10,runtime_anchor_at=NULL,is_running=0 WHERE tag_number IN (?,?)`).run(replacement,replacement,TAG,TAGB);
 f.sql.prepare(`UPDATE blower_history_assets SET cycle_runtime_state='running',is_running=1,runtime_anchor_at=? WHERE tag_number=?`).run(replacement,TAG);
}
test('operations preserve chronological order and deterministic event IDs across replay',async()=>{
 const f=await fixture();try{
  initOperation(f);
  f.add('one','#1 FBHE Blower #A 정지 #B 기동 교체운전 완료');
  let p=await f.step({phase:'operation',limit:1});assert.equal(p.status,200,p.message);assert.equal(p.appliedStateChanges,2);
  const before=f.sql.prepare('SELECT * FROM blower_history_events ORDER BY id').all();assert.equal(before.length,2);
  assert.ok(before.every(x=>x.source_type==='shift_log_operation_auto'));
  p=await f.step({phase:'operation',limit:1});assert.equal(p.appliedStateChanges,0);
  assert.deepEqual(f.sql.prepare('SELECT * FROM blower_history_events ORDER BY id').all(),before);
  assert.equal(f.sql.prepare('SELECT is_running FROM blower_history_assets WHERE tag_number=?').get(TAG).is_running,0);
  assert.equal(f.sql.prepare('SELECT is_running FROM blower_history_assets WHERE tag_number=?').get(TAGB).is_running,1);
 }finally{f.close();}
});

test('failure after candidate insertion replays without duplicate evidence or false completion',async()=>{
 const f=await fixture();try{
  f.add('a',`#1 FBHE Blower #A ${TAG} V-Belt 교체 완료`);
  f.db.failNext=text=>false;
  const original=f.db.prepare;
  let fail=true;
  f.db.prepare=function(text){const q=original(text);if(/SELECT \* FROM blower_history_candidates WHERE id = \? LIMIT 1/.test(text)){
    const first=q.first;q.first=async function(){if(fail){fail=false;throw new Error('D1_ERROR: test timeout after insert');}return first.call(this);};}return q;};
  const bad=await f.step({limit:1});assert.equal(bad.status,503);assert.equal(bad.ok,false);assert.equal(bad.nextCursor,undefined);
  const good=await f.step({limit:1});assert.equal(good.status,200);assert.equal(good.done,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_candidates').get().n,1);
 }finally{f.close();}
});

test('a transient DB error returns a retryable page error, not a pretend completed scan',async()=>{
 const f=await fixture();try{
  f.db.failNext=text=>/FROM shift_logs/.test(text);
  const p=await f.step({});assert.equal(p.status,503);assert.equal(p.retryable,true);assert.equal(p.phase,'replacement');assert.equal(p.nextCursor,undefined);
 }finally{f.close();}
});

test('public/mobile users cannot invoke bounded log mutations',async()=>{
 const database={prepare(){throw new Error('must not query')}};
 let response=await onRequestPost({env:{DB:database},request:new Request('https://test/api/blower-history',{method:'POST',body:JSON.stringify({action:'latest_logs_step',phase:'replacement'})})});
 assert.equal(response.status,401);
 response=await api.handlePost({env:{DB:database},request:new Request('https://test/api/blower-history',{headers:{'X-GS-Client-Mode':'mobile-monitoring'}})},USER,{action:'latest_logs_step',phase:'replacement'});
 assert.equal(response.status,403);
});
