import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const NOW=new Date('2026-09-09T01:00:00.000Z');
const USER={employeeNo:'latest-button-test',name:'최신화 시험'};

async function fixture(){
  const sql=new DatabaseSync(':memory:'); let batches=Promise.resolve();
  const db={prepare(text){return {values:[],bind(...v){this.values=v;return this;},
    async run(){return {meta:{changes:Number(sql.prepare(text).run(...this.values).changes)}};},
    async all(){return {results:sql.prepare(text).all(...this.values)};},
    async first(){return sql.prepare(text).get(...this.values)||null;}};},
    async batch(items){let release;const prior=batches;batches=new Promise(r=>release=r);await prior;sql.exec('BEGIN IMMEDIATE');try{const out=[];for(const s of items)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}finally{release();}}};
  await api.ensureSchema(db);
  sql.exec('CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);');
  function add(id,entries){sql.prepare('INSERT INTO shift_logs VALUES(?,?,?,?,?,?,?,?)').run(id,'2026-09-08','D/S','BCO1','테스트','결재완료',JSON.stringify({entries}),'2026-09-08T10:30:00.000Z');}
  function prime(tag,hours=123.4){sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_started_at=?,cycle_start_state='started',cycle_start_revision=?,cycle_runtime_hours=?,cycle_runtime_anchor_at=?,cycle_runtime_state='running',cycle_runtime_revision=?,runtime_hours=?,runtime_anchor_at=?,is_running=1 WHERE tag_number=?`)
    .run('2026-08-01T00:00:00+09:00','2026-08-01T00:00:00+09:00','start-old',hours,'2026-09-08T00:00:00+09:00','runtime-old',hours,'2026-09-08T00:00:00+09:00',tag);}
  async function step(extra={}){const r=await api.latestLogsStep(db,USER,{phase:'replacement',incrementalLogs:true,limit:4,...extra},{now:NOW});return {status:r.status,...await r.json()};}
  return {sql,db,add,prime,step,close:()=>sql.close()};
}

test('Latest replacement phase auto-confirms a precise actual V-Belt replacement and resets the current Cycle to zero',async()=>{const f=await fixture();try{
  const tag='104HHL60AP611'; f.prime(tag); f.add('belt-auto',[{time:'10:00',content:'#1 FBHE Blower #A 104HHL60AP611 V-Belt 교체 완료'}]);
  const out=await f.step({autoApplyConfirmedReplacements:true}); assert.equal(out.status,200,JSON.stringify(out)); assert.equal(out.autoAppliedReplacementCount,1);
  const asset=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  assert.equal(Date.parse(asset.last_replacement_at),Date.parse('2026-09-08T10:00:00+09:00')); assert.equal(asset.cycle_start_state,'pending'); assert.equal(Number(asset.cycle_runtime_hours),0); assert.equal(Number(asset.runtime_hours),0); assert.equal(Number(asset.is_running),0);
  const candidate=f.sql.prepare("SELECT * FROM blower_history_candidates WHERE source_log_id='belt-auto' AND tag_number=?").get(tag); assert.equal(candidate.status,'auto_confirmed'); assert.equal(candidate.reviewed_by_id,'latest_replacement_auto');
  const event=f.sql.prepare("SELECT * FROM blower_history_events WHERE source_log_id='belt-auto' AND tag_number=? AND event_type='replacement'").get(tag); assert.equal(event.source_type,'shift_log_auto'); assert.equal(event.created_by_id,'latest_replacement_auto');
}finally{f.close();}});

test('Latest never guesses a midnight reset when the approved replacement entry has no exact time',async()=>{const f=await fixture();try{
  const tag='104HHL60AP611'; f.prime(tag,77.7); const before=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag); f.add('belt-no-time',[{content:'#1 FBHE Blower #A 104HHL60AP611 V-Belt 교체 완료'}]);
  const out=await f.step({autoApplyConfirmedReplacements:true}); assert.equal(out.status,200,JSON.stringify(out)); assert.equal(out.autoAppliedReplacementCount,0); assert.equal(out.pendingReplacementTimeCount,1);
  assert.equal(f.sql.prepare("SELECT status FROM blower_history_candidates WHERE source_log_id='belt-no-time'").get().status,'pending'); assert.deepEqual(f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag),before);
}finally{f.close();}});

test('ordinary scans and legacy bounded calls cannot opt into automatic Cycle reset',async()=>{const f=await fixture();try{
  const tag='104HHL60AP611'; f.prime(tag); const before=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag); f.add('belt-legacy',[{time:'10:00',content:'#1 FBHE Blower #A 104HHL60AP611 V-Belt 교체 완료'}]);
  const response=await api.latestLogsStep(f.db,USER,{phase:'replacement',incrementalLogs:false,limit:4,autoApplyConfirmedReplacements:true},{now:NOW}); const out=await response.json(); assert.equal(response.status,200,JSON.stringify(out)); assert.equal(Number(out.autoAppliedReplacementCount||0),0); assert.deepEqual(f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag),before);
}finally{f.close();}});

test('one-click refresh explicitly enables auto-apply only during replacement analysis and keeps operation analysis separate',async()=>{
  const calls=[]; const window={fromDate:'2025-09-09',endDate:'2026-09-09',snapshotAt:'2026-09-09T01:00:00.000Z'};
  const io={assertWritable(){},progress(){},checkpoint(){},api:async ({body})=>{calls.push(body);return {ok:true,version:'bounded-logs-v1',phase:body.phase,window:body.window||window,limit:body.limit,done:true,nextCursor:null,scannedLogCount:0,insertedCount:0,appliedStateChanges:0};}};
  await core.refreshLogs(io,{sleep:async()=>{}}); assert.equal(calls.length,2); assert.equal(calls[0].phase,'replacement'); assert.equal(calls[0].autoApplyConfirmedReplacements,true); assert.equal(calls[1].phase,'operation'); assert.equal(calls[1].autoApplyConfirmedReplacements,false);
});
