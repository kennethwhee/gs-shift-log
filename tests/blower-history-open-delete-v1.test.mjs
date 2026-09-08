import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as h } from '../functions/api/blower-history.js';

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql){ return {sql,bindings:[],bind(...x){this.bindings=x;return this;},
      async run(){const r=sqlite.prepare(this.sql).run(...this.bindings);return{meta:{changes:Number(r.changes)}};},
      async all(){return{results:sqlite.prepare(this.sql).all(...this.bindings)};},
      async first(){return sqlite.prepare(this.sql).get(...this.bindings)||null;} };},
    async batch(stmts){sqlite.exec('BEGIN IMMEDIATE');try{const out=[];for(const st of stmts)out.push(await st.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}},
    raw:()=>sqlite,close:()=>sqlite.close()
  }; return db;
}
const cols='(id,tag_number,event_type,event_date,runtime_hours,issue_type,action_type,note,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)';
async function fixture(){
  const db=d1(); await h.ensureSchema(db); const sql=db.raw(); const tag='104HHL60AP621';
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='started',cycle_started_at=?,cycle_start_revision='s1',cycle_runtime_hours=50,cycle_runtime_anchor_at=?,cycle_runtime_state='running',cycle_runtime_revision='r1',runtime_hours=50,runtime_anchor_at=?,is_running=1 WHERE tag_number=?`).run('2026-08-24T00:00:00.000Z','2026-09-04T01:00:00.000Z','2026-09-08T12:00:00.000Z','2026-09-08T12:00:00.000Z',tag);
  const add=(r)=>sql.prepare(`INSERT INTO blower_history_events ${cols} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...r);
  add(['rep',tag,'replacement','2026-08-24T00:00:00.000Z',0,'정기주기','V-Belt 교체','업무일지','shift_log_auto','log-1','src','auto','업무일지','2026-08-24T00:01:00.000Z','2026-08-24T00:01:00.000Z']);
  add(['start',tag,'operation_start','2026-09-04T01:00:00.000Z',0,'','기동','수동','manual','','','u','사용자','2026-09-04T01:01:00.000Z','2026-09-04T01:01:00.000Z']);
  add(['dp',tag,'runtime_correction','2026-09-08T12:00:00.000Z',50,'DataPARC','동기화','','dataparc_runtime','req-1','{}','agent','DataPARC','2026-09-08T12:00:01.000Z','2026-09-08T12:00:01.000Z']);
  return {db,sql,tag,user:{employeeNo:'editor',name:'수정자'}};
}
function requestBody(f,eventId){const a=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag);const e=f.sql.prepare('SELECT * FROM blower_history_events WHERE id=?').get(eventId);return{tagNumber:f.tag,eventId,expectedEventUpdatedAt:e.updated_at,expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision};}

test('automatic, DataPARC and non-latest history rows are all deletable by plan', async()=>{
  const f=await fixture();try{
    const asset=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag);
    const rows=f.sql.prepare("SELECT * FROM blower_history_events WHERE tag_number=? AND event_type<>'_deleted' ORDER BY id").all(f.tag);
    for(const id of ['rep','start','dp']) assert.equal(h.planManualHistoryDeletion(asset,rows,id,{now:new Date('2026-09-09T00:00:00Z')}).ok,true,id);
  }finally{f.db.close();}
});

test('delete soft-hides the original ID, preserves audit, and invalidates current-cycle RUN only when needed', async()=>{
  const f=await fixture();try{
    const body=requestBody(f,'dp');
    const preview=await h.previewManualHistoryDeletion(f.db,f.user,body,{now:new Date('2026-09-09T00:00:00Z')});
    const pv=await preview.json(); assert.equal(preview.status,200,JSON.stringify(pv)); assert.match(pv.previewToken,/^[a-f0-9]{64}$/);
    const response=await h.deleteManualHistoryEvent(f.db,f.user,{...body,previewToken:pv.previewToken,confirmDelete:true,changeNote:'잘못된 DataPARC 결과 삭제'},{now:new Date('2026-09-09T00:00:00Z')});
    const result=await response.json(); assert.equal(response.status,200,JSON.stringify(result));
    assert.equal(f.sql.prepare("SELECT event_type FROM blower_history_events WHERE id='dp'").get().event_type,'_deleted');
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM blower_history_asset_history WHERE action_type='history_event_delete'").get().n,1);
    assert.equal(f.sql.prepare('SELECT cycle_runtime_state FROM blower_history_assets WHERE tag_number=?').get(f.tag).cycle_runtime_state,'unknown');
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM blower_history_events WHERE id='dp'").get().n,1,'original primary key remains as tombstone against recreation');
  }finally{f.db.close();}
});

test('deleting an old problem/history-only row does not rewrite current runtime projection', async()=>{
  const f=await fixture();try{
    f.sql.prepare(`INSERT INTO blower_history_events ${cols} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('old-problem',f.tag,'problem','2025-01-01T00:00:00.000Z',0,'점검','확인','과거','shift_log_history_auto','old-log','src','auto','업무일지','2025-01-01T01:00:00.000Z','2025-01-01T01:00:00.000Z');
    const before=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag);
    const body=requestBody(f,'old-problem'); const pr=await h.previewManualHistoryDeletion(f.db,f.user,body); const pj=await pr.json();
    assert.equal(pj.preview.currentCycleChanged,false);
    const r=await h.deleteManualHistoryEvent(f.db,f.user,{...body,previewToken:pj.previewToken,confirmDelete:true}); assert.equal(r.status,200);
    const after=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag);
    for(const k of ['last_replacement_at','cycle_started_at','cycle_start_state','cycle_runtime_hours','cycle_runtime_state','cycle_runtime_revision']) assert.equal(after[k],before[k],k);
  }finally{f.db.close();}
});

test('preview token becomes stale after any active-history edit', async()=>{
  const f=await fixture();try{
    const body=requestBody(f,'start'); const pr=await h.previewManualHistoryDeletion(f.db,f.user,body); const pj=await pr.json();
    f.sql.prepare("UPDATE blower_history_events SET note='changed',updated_at='2026-09-09T00:00:01Z' WHERE id='dp'").run();
    const r=await h.deleteManualHistoryEvent(f.db,f.user,{...body,previewToken:pj.previewToken,confirmDelete:true});
    assert.equal(r.status,409); assert.notEqual(f.sql.prepare("SELECT event_type FROM blower_history_events WHERE id='start'").get().event_type,'_deleted');
  }finally{f.db.close();}
});
