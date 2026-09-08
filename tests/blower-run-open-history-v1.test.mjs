import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import unified from '../maintenance/blower-unified-refresh.js';
import { __blowerHistoryTest as history } from '../functions/api/blower-history.js';

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql) {
      return { sql, bindings: [], bind(...bindings) { this.bindings = bindings; return this; },
        async run() { const r = sqlite.prepare(this.sql).run(...this.bindings); return { meta: { changes: Number(r.changes) } }; },
        async all() { return { results: sqlite.prepare(this.sql).all(...this.bindings) }; },
        async first() { return sqlite.prepare(this.sql).get(...this.bindings) || null; } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const out=[]; for (const st of statements) out.push(await st.run()); sqlite.exec('COMMIT'); return out; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    }, raw:()=>sqlite, close:()=>sqlite.close()
  };
  return db;
}

const fbhe = {
  tagNumber: '104HHL60AP621', displayName: '#1 FBHE #B', enabled: true,
  lastReplacementAt: '2026-08-24T00:00:00.000Z',
  cycleStartState: 'started', cycleStartedAt: '2026-09-04T01:39:00.000Z', cycleStoredStartedAt: '2026-09-04T01:39:00.000Z',
  cycleStartRevision: 's1', cycleRuntimeRevision: 'r1',
  dataParcTag: 'GSPOGE.ABB_DCS.TESTRUN001'
};

test('FBHE/Seal Latest starts at the confirmed cycle start and pending no longer blocks RUN query', () => {
  const now = new Date('2026-09-09T05:00:00.000Z');
  const started = unified.plan([fbhe], now);
  assert.equal(started.tasks.length, 1);
  assert.equal(started.tasks[0].startAt, fbhe.cycleStartedAt);
  assert.equal(started.tasks[0].queryStartAt, fbhe.cycleStartedAt);

  const pending = unified.plan([{ ...fbhe, cycleStartState:'pending', cycleStartedAt:'', cycleStoredStartedAt:'' }], now);
  assert.equal(pending.tasks.length, 1);
  assert.equal(pending.tasks[0].startAt, fbhe.lastReplacementAt);
  assert.equal(pending.skipped.some(x => /기동 대기/.test(x.message)), false);
});

test('verified binary RUN remains the displayed cumulative basis even when the legacy manual cycle is pending', () => {
  const view = unified.fbheSealRunView({ ...fbhe, cycleStartState:'pending', cycleStartedAt:'',
    cycleElapsedHours:10.8, measurementRequired:false, runRuntime:{ verified:true, source:'dataparc', state:'stopped', measuredAt:'2026-09-09T04:46:00.000Z' } });
  assert.equal(view.verified, true);
  assert.equal(view.pending, false);
  assert.equal(view.primary, '10.8시간');
  assert.equal(view.stateLabel, '정지중');
});

test('verified DataPARC basis before an explicit first-start marker is rejected', () => {
  const asset = {
    tag_number: '104HHL60AP621', last_replacement_at: '2026-08-24T00:00:00.000Z',
    cycle_start_state: 'started', cycle_started_at: '2026-09-04T01:39:00.000Z',
    cycle_start_revision: 's1'
  };
  const bad = {
    id: 'dataparc-runtime:req1', tag_number: asset.tag_number, event_type:'runtime_correction',
    event_date:'2026-09-09T04:42:00.000Z', runtime_hours:370.9, source_type:'dataparc_runtime', source_log_id:'req1',
    created_at:'2026-09-09T04:42:01.000Z', updated_at:'2026-09-09T04:42:01.000Z',
    source_text: JSON.stringify({ assetTag:asset.tag_number, requestType:'blower_runtime_probe', requestId:'req1',
      dataParcTag:'GSPOGE.ABB_DCS.TESTRUN001', startAt:'2026-08-24T00:00:00.000Z', observedAt:'2026-09-09T04:42:00.000Z',
      endAt:'2026-09-09T04:42:00.000Z', expectedLastReplacementAt:asset.last_replacement_at,
      expectedCycleStartState:'started', expectedCycleStartedAt:asset.cycle_started_at, expectedCycleStartRevision:'s1',
      runningSeconds:1335240, endState:'running' })
  };
  assert.equal(history.currentDataParcRuntimeBasis(asset, [bad]), null);
});



test('the bad 8/24-to-9/9 370.9h FBHE basis is hidden and Latest replans from the confirmed 9/4 first-start', async () => {
  const db=d1();
  try {
    await history.ensureSchema(db);
    const sql=db.raw();
    const tag='104HHL60AP621';
    const replacement='2026-08-24T00:00:00.000Z';
    const started='2026-09-04T01:39:00.000Z';
    const observed='2026-09-09T04:42:00.000Z';
    sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?, cycle_start_state='started', cycle_started_at=?,
      cycle_start_revision='s1', cycle_runtime_revision='r1', cycle_runtime_hours=370.9, cycle_runtime_anchor_at=?, cycle_runtime_state='running',
      runtime_hours=370.9, runtime_anchor_at=?, is_running=1 WHERE tag_number=?`).run(replacement, started, observed, observed, tag);
    sql.prepare(`INSERT INTO blower_history_events
      (id,tag_number,event_type,event_date,runtime_hours,issue_type,action_type,note,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('start',tag,'operation_start',started,174,'','기동','교체 후 첫 기동','manual','','','u','사용자',started,started);
    const source={schemaVersion:1,assetTag:tag,requestType:'blower_runtime_probe',requestId:'bad-3709',dataParcTag:'GSPOGE.ABB_DCS.TESTRUN001',
      startAt:replacement,observedAt:observed,endAt:observed,expectedLastReplacementAt:replacement,expectedCycleStartState:'started',
      expectedCycleStartedAt:started,expectedCycleStartRevision:'s1',expectedCycleRuntimeRevision:'old-r0',runningSeconds:1335240,endState:'running'};
    sql.prepare(`INSERT INTO blower_history_events
      (id,tag_number,event_type,event_date,runtime_hours,issue_type,action_type,note,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('dataparc_runtime:bad-3709',tag,'runtime_correction',observed,370.9,'DataPARC','동기화','잘못된 전체기간 기준','dataparc_runtime','bad-3709',JSON.stringify(source),'agent','DataPARC',observed,observed);
    const state=(await history.loadAssetStates(db,{fbhe:{cycleDays:90,warningDays:7,criticalDays:3}})).find(x=>x.tagNumber===tag);
    assert.equal(state.dataParcTag,'GSPOGE.ABB_DCS.TESTRUN001');
    assert.equal(state.dataParcRuntimeBasis,null,'bad pre-start basis must not remain appendable');
    assert.equal(state.runRuntime.verified,false,'370.9h must not be presented as verified RUN time');
    const planned=unified.plan([state],new Date('2026-09-09T05:00:00.000Z'));
    assert.equal(planned.tasks.length,1);
    assert.equal(Date.parse(planned.tasks[0].startAt),Date.parse(started));
    assert.equal(planned.tasks[0].incremental,false,'the bad full-cycle result is replaced, not appended');
  } finally { db.close(); }
});
test('delete plan accepts automatic/DataPARC rows and does not require latest-first', () => {
  const asset = { tag_number:'104HHL60AP621', last_replacement_at:'2026-08-24T00:00:00.000Z',
    cycle_start_state:'started', cycle_started_at:'2026-09-04T01:39:00.000Z', cycle_runtime_state:'running',
    cycle_runtime_hours:100, cycle_runtime_anchor_at:'2026-09-09T04:42:00.000Z' };
  const rows = [
    { id:'rep', tag_number:asset.tag_number, event_type:'replacement', event_date:asset.last_replacement_at, runtime_hours:0,
      source_type:'shift_log_auto', source_log_id:'log-1', source_text:'', created_at:'2026-08-24T00:01:00.000Z', updated_at:'2026-08-24T00:01:00.000Z' },
    { id:'start', tag_number:asset.tag_number, event_type:'operation_start', event_date:asset.cycle_started_at, runtime_hours:0,
      source_type:'manual', source_log_id:'', source_text:'', created_at:'2026-09-04T01:40:00.000Z', updated_at:'2026-09-04T01:40:00.000Z' },
    { id:'dp', tag_number:asset.tag_number, event_type:'runtime_correction', event_date:'2026-09-09T04:42:00.000Z', runtime_hours:100,
      source_type:'dataparc_runtime', source_log_id:'req', source_text:'{}', created_at:'2026-09-09T04:42:01.000Z', updated_at:'2026-09-09T04:42:01.000Z' }
  ];
  const autoDelete = history.planManualHistoryDeletion(asset, rows, 'rep', { now:new Date('2026-09-09T05:00:00.000Z') });
  assert.equal(autoDelete.ok, true);
  assert.equal(autoDelete.preview.currentCycleChanged, true);
  const nonLatest = history.planManualHistoryDeletion(asset, rows, 'start', { now:new Date('2026-09-09T05:00:00.000Z') });
  assert.equal(nonLatest.ok, true);
  assert.equal(nonLatest.preview.currentCycleChanged, true);
});

test('generic history edit preserves source provenance, audits, and invalidates current RUN projection', async () => {
  const db=d1();
  try {
    await history.ensureSchema(db);
    const sql=db.raw();
    const tag='104HHL60AP621';
    sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?, cycle_start_state='started', cycle_started_at=?,
      cycle_start_revision='s1', cycle_runtime_revision='r1', cycle_runtime_hours=100, cycle_runtime_anchor_at=?, cycle_runtime_state='running',
      runtime_hours=100, runtime_anchor_at=?, is_running=1 WHERE tag_number=?`).run(
        '2026-08-24T00:00:00.000Z','2026-09-04T01:39:00.000Z','2026-09-09T04:42:00.000Z','2026-09-09T04:42:00.000Z',tag);
    const baseCols = `(id,tag_number,event_type,event_date,runtime_hours,issue_type,action_type,note,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)`;
    sql.prepare(`INSERT INTO blower_history_events ${baseCols} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'rep',tag,'replacement','2026-08-24T00:00:00.000Z',0,'정기주기','V-Belt 교체','auto','shift_log_auto','log-1','src','auto','업무일지','2026-08-24T00:01:00.000Z','2026-08-24T00:01:00.000Z');
    sql.prepare(`INSERT INTO blower_history_events ${baseCols} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'start',tag,'operation_start','2026-09-04T01:39:00.000Z',0,'','기동','manual','manual','','','u','사용자','2026-09-04T01:40:00.000Z','2026-09-04T01:40:00.000Z');
    const user={employeeNo:'u2',name:'정정자'};
    const response=await history.editAnyHistoryEvent(db,user,{
      tagNumber:tag,eventId:'start',eventType:'startup',eventDate:'2026-09-04T02:00:00+09:00',runtimeHours:0,
      issueType:'',actionType:'첫 기동',note:'실제 기동시각 정정',changeNote:'기동 기준 정정',
      expectedEventUpdatedAt:'2026-09-04T01:40:00.000Z',expectedLastReplacementAt:'2026-08-24T00:00:00.000Z',
      expectedCycleStartRevision:'s1',expectedCycleRuntimeRevision:'r1'
    }, {now:new Date('2026-09-09T05:00:00.000Z')});
    const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    assert.equal(body.runtimeInvalidated,true);
    const edited=sql.prepare(`SELECT * FROM blower_history_events WHERE id='start'`).get();
    assert.equal(edited.event_type,'startup');
    assert.equal(edited.source_type,'manual');
    const asset=sql.prepare(`SELECT * FROM blower_history_assets WHERE tag_number=?`).get(tag);
    assert.equal(asset.cycle_start_state,'started');
    assert.equal(asset.cycle_started_at,'2026-09-03T17:00:00.000Z');
    assert.equal(asset.cycle_runtime_state,'unknown');
    assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM blower_history_asset_history WHERE action_type='history_event_edit'`).get().n,1);
  } finally { db.close(); }
});
