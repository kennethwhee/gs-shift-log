import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as h } from '../functions/api/blower-history.js';

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    prepare(sql) { return { sql, bindings: [], bind(...x) { this.bindings = x; return this; },
      async run() { const r = sqlite.prepare(this.sql).run(...this.bindings); return { meta: { changes: Number(r.changes) } }; },
      async all() { return { results: sqlite.prepare(this.sql).all(...this.bindings) }; },
      async first() { return sqlite.prepare(this.sql).get(...this.bindings) || null; } }; },
    async batch(stmts) { sqlite.exec('BEGIN IMMEDIATE'); try { const out=[]; for (const st of stmts) out.push(await st.run()); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
    raw: () => sqlite, close: () => sqlite.close()
  };
}
const cols='(id,tag_number,event_type,event_date,runtime_hours,issue_type,action_type,note,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)';

async function fixture() {
  const db = d1(); await h.ensureSchema(db); const sql = db.raw(); const tag = '104HHL10AN631';
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?, cycle_start_state='started', cycle_started_at=?, cycle_start_revision='', cycle_runtime_hours=10, cycle_runtime_anchor_at=?, cycle_runtime_state='stopped', cycle_runtime_revision='', runtime_hours=10, runtime_anchor_at=?, is_running=0 WHERE tag_number=?`)
    .run('2026-06-05T00:00:00.000Z','2026-06-05T01:00:00.000Z','2026-06-05T11:00:00.000Z','2026-06-05T11:00:00.000Z',tag);
  sql.prepare(`INSERT INTO blower_history_events ${cols} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('legacy',tag,'problem','2026-06-05T10:00:00.000Z',9.5,'점검','확인','legacy empty revision row','manual','','','u','사용자','2026-06-05T10:01:00.000Z','2026-06-05T10:01:00.000Z');
  return { db, sql, tag, user: { employeeNo: 'editor', name: '수정자' } };
}
function body(f) {
  const a=f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag);
  const e=f.sql.prepare("SELECT * FROM blower_history_events WHERE id='legacy'").get();
  return { tagNumber:f.tag,eventId:'legacy',expectedEventUpdatedAt:e.updated_at,expectedLastReplacementAt:a.last_replacement_at,
    expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision };
}

test('delete preview accepts empty legacy cycle revision tokens as exact CAS values', async () => {
  const f=await fixture(); try {
    const b=body(f); assert.equal(b.expectedCycleStartRevision,''); assert.equal(b.expectedCycleRuntimeRevision,'');
    const r=await h.previewManualHistoryDeletion(f.db,f.user,b,{now:new Date('2026-09-11T00:00:00Z')});
    const j=await r.json(); assert.equal(r.status,200,JSON.stringify(j)); assert.match(j.previewToken,/^[a-f0-9]{64}$/);
  } finally { f.db.close(); }
});

test('generic edit accepts empty legacy cycle revision tokens and preserves source provenance', async () => {
  const f=await fixture(); try {
    const b=body(f);
    const r=await h.editAnyHistoryEvent(f.db,f.user,{...b,eventType:'problem',eventDate:'2026-06-05T10:00:00.000Z',runtimeHours:9.5,issueType:'점검',actionType:'확인',note:'정정된 내용',changeNote:'오입력 수정'}, {now:new Date('2026-09-11T00:00:00Z')});
    const j=await r.json(); assert.equal(r.status,200,JSON.stringify(j));
    const row=f.sql.prepare("SELECT source_type,note FROM blower_history_events WHERE id='legacy'").get();
    assert.equal(row.source_type,'manual'); assert.equal(row.note,'정정된 내용');
  } finally { f.db.close(); }
});
