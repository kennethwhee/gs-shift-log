import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { __blowerHistoryTest as api, onRequestPost } from '../functions/api/blower-history.js';
const TAG = '104SDF01AN001';
const DATE = '2026-08-19T15:00:00.000Z';
const OLD = '2025-12-18T15:00:00.000Z';
const NOW = new Date('2026-09-08T15:00:00.000Z');
const USER = { employeeNo: 'test-operator', name: '삭제 담당자' };
function fixture({ running = false, old = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    beforeBatch: null, afterStatement: null, writes: 0,
    prepare(sql) { return { sql, values: [], bind(...values) {
      assert.ok(values.length <= 100, `D1 parameter limit: ${values.length}`);
      this.values = values; return this;
    }, async first() { return sqlite.prepare(sql).get(...this.values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
    async run() { db.writes++; return { meta: { changes: Number(sqlite.prepare(sql).run(...this.values).changes) } }; } }; },
    async batch(statements) {
      if (db.beforeBatch) { const hook = db.beforeBatch; db.beforeBatch = null; hook(sqlite); }
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = [];
        for (const [index, statement] of statements.entries()) {
          results.push(await statement.run());
          if (db.afterStatement) db.afterStatement({ index, statement, sqlite });
        }
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  const add = (overrides = {}) => {
    const row = { id: 'replacement', tag_number: TAG, event_type: 'replacement', event_date: DATE,
      runtime_hours: 0, issue_type: '정기주기', action_type: '교체', note: '잘못 입력한 교체', source_type: 'manual',
      source_log_id: '', source_text: '', created_by_id: 'original', created_by_name: '원등록자',
      created_at: '2026-09-08T14:20:00.000Z', updated_at: '2026-09-08T14:20:00.000Z', ...overrides };
    sqlite.prepare(`INSERT INTO blower_history_events (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    return row;
  };
  const asset = () => sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG);
  const row = id => sqlite.prepare('SELECT * FROM blower_history_events WHERE id=?').get(id);
  const state = () => JSON.stringify({ a: sqlite.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all(),
    e: sqlite.prepare('SELECT * FROM blower_history_events ORDER BY id').all(),
    h: sqlite.prepare('SELECT * FROM blower_history_asset_history ORDER BY id').all(),
    g: sqlite.prepare('SELECT * FROM blower_history_atomic_guard').all() });
  const body = (id='replacement') => { const a=asset(), e=row(id); return { tagNumber: TAG, eventId: id,
    expectedEventUpdatedAt: e.updated_at, expectedLastReplacementAt: a.last_replacement_at || '',
    expectedCycleStartRevision: a.cycle_start_revision, expectedCycleRuntimeRevision: a.cycle_runtime_revision }; };
  const read = async response => ({ status: response.status, ...await response.json() });
  const preview = async (id='replacement', input=null) => read(await api.previewManualHistoryDeletion(db, USER, input || body(id), { now: NOW }));
  const confirm = async (id='replacement', input=null) => {
    const b = input || body(id), p = await preview(id, b);
    if (!p.ok) return p;
    return read(await api.deleteManualHistoryEvent(db, USER, { ...b, previewToken:p.previewToken, confirmDelete:true }, { now: NOW }));
  };
  return { sqlite, db, add, asset, row, state, body, read, preview, confirm,
    async ready() { await api.ensureSchema(db);
      sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at=?, cycle_started_at=?, cycle_start_state=?,
        cycle_start_revision='start-r1', cycle_runtime_hours=?, cycle_runtime_anchor_at=?, cycle_runtime_state=?,
        cycle_runtime_revision='runtime-r1', runtime_hours=?, runtime_anchor_at=?, is_running=?, updated_at=? WHERE tag_number=?`)
        .run(DATE, running ? '2026-09-08T14:30:00.000Z':null, running?'started':'pending', running?0.5:0,
          NOW.toISOString(), running?'running':'stopped', running?0.5:0, running?NOW.toISOString():null, running?1:0, '2026-09-08T14:31:00.000Z', TAG);
      if(old) add({ id:'old-replacement', event_date:OLD, source_type:'shift_log_history_v13', created_at:'2026-08-28T00:00:00.000Z', updated_at:'2026-08-28T00:00:00.000Z' });
      add();
      if(running) add({id:'startup', event_type:'startup', event_date:'2026-09-08T14:30:00.000Z', action_type:'기동', created_at:'2026-09-08T14:31:00.000Z', updated_at:'2026-09-08T14:31:00.000Z'});
      db.writes=0; return this;
    }
  };
}
const use = async options => fixture(options).ready();

test('preview is read-only and reports pending 0h for a wrongly entered first startup', async () => {
  const f=await use({running:true}); try {
    const before=f.state(), p=await f.preview('startup');
    assert.equal(p.status,200,p.message); assert.equal(p.preview.operationState,'startup_pending');
    assert.equal(p.preview.runtimeHours,0); assert.equal(p.preview.lastReplacementAt,DATE);
    assert.match(p.previewToken,/^[a-f0-9]{64}$/); assert.equal(f.state(),before); assert.equal(f.db.writes,0);
  } finally { f.sqlite.close(); }
});
test('startup then replacement deletion preserves original evidence and audits each deletion', async () => {
  const f=await use({running:true}); try {
    const original={...f.row('startup')};
    let p=await f.confirm(); assert.equal(p.code,'HISTORY_DELETE_DEPENDENT_EVENTS'); assert.equal(p.blockingEventId,'startup');
    p=await f.confirm('startup'); assert.equal(p.status,200,p.message);
    assert.equal(f.asset().cycle_start_state,'pending'); assert.equal(f.asset().cycle_runtime_hours,0); assert.equal(f.row('startup'),undefined);
    assert.notEqual(f.asset().cycle_runtime_revision,'runtime-r1');
    const audit=f.sqlite.prepare('SELECT * FROM blower_history_asset_history').get();
    assert.deepEqual(JSON.parse(audit.before_json).event,original);
    assert.equal(audit.changed_by_name,USER.name); assert.equal(audit.action_type,'history_event_delete');
    p=await f.confirm(); assert.equal(p.status,200,p.message); assert.equal(f.asset().last_replacement_at,OLD);
    assert.equal(f.asset().cycle_runtime_state,'unknown'); assert.equal(p.preview.runtimeHours,null);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
  } finally {f.sqlite.close();}
});
test('last replacement removal clears the cycle without inventing a previous replacement', async () => {
  const f=await use({old:false}); try {
    const p=await f.confirm(); assert.equal(p.status,200,p.message);
    const a=f.asset(); assert.equal(a.last_replacement_at,null); assert.equal(a.cycle_started_at,null);
    assert.equal(a.cycle_runtime_state,'unknown'); assert.equal(a.runtime_anchor_at,null); assert.equal(p.preview.runtimeHours,null);
  } finally {f.sqlite.close();}
});
test('backdated replacement does not absorb a pre-existing DataPARC row and restores its old-cycle state', async t=>{
  for(const running of [true,false]) await t.test(running?'running':'stopped',async()=>{
    const f=await use(); try {
      const observation='2026-09-08T14:00:00.000Z';
      const e=f.add({id:'old-query',event_type:'runtime_correction',event_date:observation,runtime_hours:1234.5,
        action_type:running?'DataPARC 운전중 동기화':'DataPARC 정지 동기화',source_type:'dataparc_runtime',source_log_id:'req-old',
        source_text:JSON.stringify({expectedLastReplacementAt:OLD,expectedCycleStartState:'legacy',observedAt:observation}),
        created_at:'2026-09-08T14:16:00.000Z',updated_at:'2026-09-08T14:16:00.000Z'});
      const p=await f.confirm(); assert.equal(p.status,200,p.message); assert.deepEqual({...f.row('old-query')},e);
      assert.equal(f.asset().cycle_runtime_state,running?'running':'stopped');
      assert.equal(f.asset().cycle_runtime_hours,1234.5);
      assert.equal(f.asset().last_replacement_at,OLD); assert.equal(f.asset().cycle_start_state,'legacy');
    } finally {f.sqlite.close();}
  });
});
test('intermittent stop deletion restores measured startup total without wall-clock addition', async()=>{
  const f=await use({running:true}); try {
    f.add({id:'stop',event_type:'operation_stop',event_date:'2026-09-08T14:45:00.000Z',runtime_hours:999,action_type:'정지',created_at:'2026-09-08T14:46:00.000Z',updated_at:'2026-09-08T14:46:00.000Z'});
    f.sqlite.prepare("UPDATE blower_history_assets SET cycle_runtime_state='stopped', cycle_runtime_hours=999, runtime_hours=999, is_running=0 WHERE tag_number=?").run(TAG);
    const blocked=await f.confirm('startup'); assert.equal(blocked.code,'HISTORY_DELETE_LATEST_FIRST'); assert.equal(blocked.blockingEventId,'stop');
    const p=await f.confirm('stop'); assert.equal(p.status,200,p.message);
    assert.equal(f.asset().cycle_runtime_hours,0); assert.equal(f.asset().is_running,1);
  } finally{f.sqlite.close();}
});
test('latest restart removal restores the previous stopped total with no elapsed-time addition',async()=>{
  const f=await use({running:true});try{
    f.add({id:'stop',event_type:'operation_stop',event_date:'2026-09-08T14:40:00.000Z',runtime_hours:0.16666666666666666,action_type:'정지',created_at:'2026-09-08T14:41:00.000Z',updated_at:'2026-09-08T14:41:00.000Z'});
    f.add({id:'restart',event_type:'operation_start',event_date:'2026-09-08T14:50:00.000Z',runtime_hours:0.16666666666666666,action_type:'재기동',created_at:'2026-09-08T14:51:00.000Z',updated_at:'2026-09-08T14:51:00.000Z'});
    const p=await f.confirm('restart');assert.equal(p.status,200,p.message);assert.equal(f.asset().cycle_runtime_state,'stopped');
    assert.equal(f.asset().cycle_runtime_hours,0.16666666666666666);
  }finally{f.sqlite.close();}
});
test('manual correction deletion restores its audited before-state even after a pending reset',async()=>{
  const f=await use();try{
    f.add({id:'correction',event_type:'runtime_correction',event_date:'2026-09-08T14:50:00.000Z',runtime_hours:0,action_type:'교체 수정 · 미기동 정지 · 0시간',
      source_text:JSON.stringify({replacementEdit:true,replacementEventId:'replacement',before:{lastReplacementAt:DATE,cycleStartState:'started',cycleStartedAt:'2026-09-08T14:00:00.000Z',cycleRuntimeHours:2,cycleRuntimeAnchorAt:'2026-09-08T14:45:00.000Z',cycleRuntimeState:'stopped'}}),
      created_at:'2026-09-08T14:51:00.000Z',updated_at:'2026-09-08T14:51:00.000Z'});
    const p=await f.confirm('correction');assert.equal(p.status,200,p.message);assert.equal(f.asset().cycle_start_state,'started');assert.equal(f.asset().cycle_runtime_hours,2);
  }finally{f.sqlite.close();}
});
test('a replacement edit before-snapshot for a DIFFERENT replacement date is never reused',async()=>{
  const f=await use();try{
    f.add({id:'correction',event_type:'runtime_correction',event_date:'2026-09-08T14:50:00.000Z',action_type:'교체 수정 · 정지 보정',source_text:JSON.stringify({replacementEdit:true,replacementEventId:'replacement',before:{lastReplacementAt:OLD,cycleStartState:'started',cycleRuntimeHours:999,cycleRuntimeAnchorAt:NOW.toISOString(),cycleRuntimeState:'running'}}),created_at:'2026-09-08T14:51:00.000Z'});
    const p=await f.confirm('correction');assert.equal(p.status,200,p.message);assert.equal(f.asset().cycle_runtime_state,'unknown');assert.equal(p.preview.runtimeHours,null);assert.equal(f.asset().last_replacement_at,DATE);
  }finally{f.sqlite.close();}
});
test('automatic rows, linked rows, and unsupported event kinds cannot be deleted',async t=>{
  for(const changed of [{source_type:'dataparc_runtime'},{source_type:'shift_log_auto'},{source_type:'shift_log_operation_auto'},{source_log_id:'source-log'},{event_type:'unknown'}]) await t.test(JSON.stringify(changed),async()=>{
    const f=await use();try{
      f.sqlite.prepare(`UPDATE blower_history_events SET ${Object.keys(changed).map(k=>`${k}=?`).join(',')} WHERE id='replacement'`).run(...Object.values(changed));
      const before=f.state(),p=await f.confirm();assert.equal(p.status,403);assert.equal(f.state(),before);
    }finally{f.sqlite.close();}
  });
});
test('a dependent automatic observation is preserved and blocks replacement deletion',async()=>{
  const f=await use();try{
    f.add({id:'new-query',event_type:'runtime_correction',event_date:'2026-09-08T14:40:00.000Z',source_type:'dataparc_runtime',action_type:'DataPARC 정지',source_text:JSON.stringify({expectedLastReplacementAt:DATE}),created_at:'2026-09-08T14:41:00.000Z'});
    const before=f.state(),p=await f.confirm();assert.equal(p.code,'HISTORY_DELETE_DEPENDENT_EVENTS');assert.match(p.message,/\[수정\]/);assert.equal(f.state(),before);
  }finally{f.sqlite.close();}
});
test('historical manual replacement and problem deletion preserve every current asset field',async t=>{
  for(const type of ['replacement','problem','operation_stop']) await t.test(type,async()=>{
    const f=await use({running:true});try{
      f.add({id:'historical',event_type:type,event_date:'2024-01-01T00:00:00.000Z',note:'과거 입력'});
      const before=JSON.stringify(f.asset()),p=await f.confirm('historical');assert.equal(p.status,200,p.message);
      assert.equal(JSON.stringify(f.asset()),before);assert.equal(p.preview.currentCycleChanged,false);assert.equal(f.row('historical'),undefined);
    }finally{f.sqlite.close();}
  });
});
test('stale expected snapshot fields reject without any write',async t=>{
  for(const key of ['expectedEventUpdatedAt','expectedLastReplacementAt','expectedCycleStartRevision','expectedCycleRuntimeRevision']) await t.test(key,async()=>{
    const f=await use();try{const before=f.state(),b={...f.body(),[key]:'changed'},p=await f.preview('replacement',b);assert.equal(p.status,409);assert.equal(f.state(),before);assert.equal(f.db.writes,0);}finally{f.sqlite.close();}
  });
});
test('confirmation is required; changed event sets invalidate preview even with unchanged cycle revision',async()=>{
  const f=await use();try{
    const b=f.body(),p=await f.preview(),before=f.state();
    let r=await f.read(await api.deleteManualHistoryEvent(f.db,USER,{...b,previewToken:p.previewToken},{now:NOW}));assert.equal(r.status,400);assert.equal(f.state(),before);
    f.add({id:'late-note',event_type:'problem'});
    r=await f.read(await api.deleteManualHistoryEvent(f.db,USER,{...b,confirmDelete:true,previewToken:p.previewToken},{now:NOW}));assert.equal(r.code,'HISTORY_DELETE_PREVIEW_STALE');assert.ok(f.row('replacement'));
  }finally{f.sqlite.close();}
});
test('atomic before-guard rejects concurrent insert, note edit, or asset update after server planning',async t=>{
  for(const mutation of ['insert','note','asset']) await t.test(mutation,async()=>{
    const f=await use();try{
      const p=await f.preview(),b=f.body();
      f.db.beforeBatch=()=>{if(mutation==='insert')f.add({id:'concurrent',event_type:'problem'});else if(mutation==='note')f.sqlite.exec("UPDATE blower_history_events SET note='other operator' WHERE id='replacement'");else f.sqlite.exec("UPDATE blower_history_assets SET cycle_runtime_hours=77 WHERE tag_number='104SDF01AN001'");};
      const r=await f.read(await api.deleteManualHistoryEvent(f.db,USER,{...b,confirmDelete:true,previewToken:p.previewToken},{now:NOW}));
      assert.equal(r.status,409,r.message);assert.ok(f.row('replacement'));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,0);
    }finally{f.sqlite.close();}
  });
});
test('atomic after-guard rolls back missing deletion, altered evidence, missing audit, and asset clobber',async t=>{
  for(const mutation of ['deleted-row','survivor','audit','asset']) await t.test(mutation,async()=>{
    const f=await use();try{
      const before=f.state(),original={...f.row('replacement')};let fired=false;
      f.db.afterStatement=({statement})=>{if(fired||!statement.sql.startsWith('INSERT INTO blower_history_asset_history'))return;fired=true;
        if(mutation==='deleted-row')f.add(original);
        if(mutation==='survivor')f.sqlite.exec("UPDATE blower_history_events SET note='clobber' WHERE id='old-replacement'");
        if(mutation==='audit')f.sqlite.exec('DELETE FROM blower_history_asset_history');
        if(mutation==='asset')f.sqlite.exec("UPDATE blower_history_assets SET cycle_runtime_hours=999 WHERE tag_number='104SDF01AN001'");
      };
      const p=await f.confirm();assert.equal(p.status,409,p.message);assert.equal(f.state(),before);
    }finally{f.sqlite.close();}
  });
});
test('audit write failure rolls back deletion and state; double submission produces exactly one audit',async()=>{
  const f=await use();try{
    const before=f.state();f.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON blower_history_asset_history BEGIN SELECT RAISE(ABORT, 'test audit failure'); END");
    await assert.rejects(()=>f.confirm(),/test audit failure/);assert.equal(f.state(),before);f.sqlite.exec('DROP TRIGGER fail_audit');
    const b=f.body(),p=await f.preview();
    const request={...b,previewToken:p.previewToken,confirmDelete:true};
    let r=await f.read(await api.deleteManualHistoryEvent(f.db,USER,request,{now:NOW}));assert.equal(r.status,200);
    r=await f.read(await api.deleteManualHistoryEvent(f.db,USER,request,{now:NOW}));assert.equal(r.status,404);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,1);
  }finally{f.sqlite.close();}
});
test('unknown sentinel survives schema readiness without fabricated elapsed hours, D-day, or use percentage',async()=>{
  const f=await use();try{
    await f.confirm();await api.ensureBlowerHistorySchemaReady(f.db);
    const state=api.buildAssetState(f.asset(),{cycleDays:90,warningDays:7,criticalDays:3},null,null,NOW);
    assert.equal(state.operationState,'unknown');assert.equal(state.cycleElapsedHours,null);assert.equal(state.runtimeHours,null);
    assert.equal(state.remainingHours,null);assert.equal(state.progressPct,null);assert.equal(state.severity,'runtime_unknown');assert.equal(state.isRunning,false);
  }finally{f.sqlite.close();}
});
test('unknown state can only be corrected with explicit state and hours; ordinary corrections still preserve state',async()=>{
  const f=await use();try{
    await f.confirm();let a=f.asset();const context={env:{DB:f.db},request:new Request('https://test/api/blower-history',{headers:{'X-GS-Client-Mode':'desktop'}})};
    let r=await f.read(await api.handlePost(context,USER,{action:'runtime',tagNumber:TAG,runtimeHours:15,expectedCycleRuntimeRevision:a.cycle_runtime_revision}));assert.equal(r.status,400);
    r=await f.read(await api.handlePost(context,USER,{action:'runtime',tagNumber:TAG,runtimeHours:15,isRunning:true,expectedCycleRuntimeRevision:a.cycle_runtime_revision}));assert.equal(r.status,200,r.message);assert.equal(f.asset().cycle_runtime_state,'running');assert.equal(f.asset().cycle_runtime_hours,15);
  }finally{f.sqlite.close();}
});
test('public and mobile API callers cannot delete or request deletion preview',async t=>{
  for(const action of ['history_event_delete','history_event_delete_preview'])await t.test(action,async()=>{
    const database={prepare(){throw new Error('must not query')}};
    let r=await onRequestPost({env:{DB:database},request:new Request('https://test/api/blower-history',{method:'POST',body:JSON.stringify({action})})});assert.equal(r.status,401);
    r=await api.handlePost({env:{DB:database},request:new Request('https://test/api/blower-history',{headers:{'X-GS-Client-Mode':'mobile-monitoring'}})},USER,{action});assert.equal(r.status,403);
  });
});
