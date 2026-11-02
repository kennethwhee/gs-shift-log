import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { __blowerHistoryTest as h } from '../functions/api/blower-history.js';
const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');

const TAGS = ['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'];
const now = new Date('2026-11-02T12:00:00.000Z');
const user = { employeeNo: 'editor', name: '확인자' };
function d1() {
  const raw = new DatabaseSync(':memory:');
  return { raw, beforeBatch: null,
    prepare(sql) { return { sql, values: [], bind(...values) { this.values = values; return this; },
      async run() { return { meta: { changes: Number(raw.prepare(this.sql).run(...this.values).changes) } }; },
      async all() { return { results: raw.prepare(this.sql).all(...this.values) }; },
      async first() { return raw.prepare(this.sql).get(...this.values) || null; } }; },
    async batch(statements) {
      if (this.beforeBatch) { const hook = this.beforeBatch; this.beforeBatch = null; hook(); }
      raw.exec('BEGIN IMMEDIATE');
      try { const out = []; for (const statement of statements) out.push(await statement.run()); raw.exec('COMMIT'); return out; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    }
  };
}
async function fixture(tag = TAGS[0]) {
  const db = d1(); await h.ensureSchema(db);
  const replacement = tag === TAGS[1] ? '2026-05-12T00:00:00+09:00' : '2026-09-22T00:00:00+09:00';
  db.raw.prepare(`UPDATE blower_history_assets SET last_replacement_at=?, cycle_start_state='pending',
    cycle_start_revision='s-old', cycle_runtime_revision='r-old', cycle_runtime_hours=922.1,
    cycle_runtime_anchor_at='2026-10-30T01:31:19Z', cycle_runtime_state='running',
    runtime_hours=922.1, runtime_anchor_at='2026-10-30T01:31:19Z', is_running=1 WHERE tag_number=?`).run(replacement, tag);
  db.raw.exec(`CREATE TABLE blower_limestone_run_segments_v1 (request_id TEXT PRIMARY KEY,tag_number TEXT,start_ms INTEGER,end_ms INTEGER,running_seconds INTEGER);
    INSERT INTO blower_limestone_run_segments_v1 VALUES('old-run','${tag}',1793344983000,1793437569000,88985);`);
  db.raw.prepare(`INSERT INTO blower_history_events
    (id,tag_number,event_type,event_date,runtime_hours,source_type,source_text,created_by_id,created_by_name,created_at,updated_at)
    VALUES('old-runtime',?,'runtime_correction','2026-10-30T01:31:19Z',922.1,'dataparc_runtime','old-proof','owner','owner','2026-10-30T01:31:20Z','2026-10-30T01:31:20Z')`).run(tag);
  const before = db.raw.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  const body = { action: 'limestone_basis_confirm', tagNumber: tag, replacementAt: replacement,
    evidence: '작업 완료 기록과 현장 확인으로 실제 교체 완료 시각 확인',
    expectedLastReplacementAt: before.last_replacement_at,
    expectedCycleStartRevision: before.cycle_start_revision,
    expectedCycleRuntimeRevision: before.cycle_runtime_revision };
  return { db, tag, body, before };
}
const options = { now };

for (const tag of TAGS) test(`${tag}: explicit completion confirms exact basis, hides old total, and preserves all old proof`, async () => {
  const f = await fixture(tag);
  try {
    const oldEvent = f.db.raw.prepare("SELECT * FROM blower_history_events WHERE id='old-runtime'").get();
    const oldLedger = f.db.raw.prepare('SELECT * FROM blower_limestone_run_segments_v1').get();
    const response = await h.confirmLimestoneBasis(f.db, user, f.body, options);
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.requiresFullRunRefresh, true);
    const row = f.db.raw.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
    assert.equal(h.limestoneBasisConfirmed(row), true); assert.equal(h.limestoneRunDisputed(row), false);
    assert.equal(Date.parse(row.last_replacement_at), Date.parse(f.body.replacementAt));
    assert.notEqual(row.cycle_start_revision, 's-old'); assert.notEqual(row.cycle_runtime_revision, 'r-old');
    assert.equal(row.cycle_start_state, 'legacy'); assert.equal(row.cycle_started_at, null);
    assert.equal(row.cycle_runtime_state, 'unknown'); assert.equal(row.cycle_runtime_hours, 0);
    assert.equal(row.cycle_runtime_anchor_at, null);
    const view = h.buildAssetState(row, null, null, null, now);
    assert.equal(view.limestoneBasisConfirmed, true); assert.equal(view.limestoneRunDisputed, false);
    assert.equal(view.cycleElapsedHours, null); assert.equal(view.runtimeHours, null);
    assert.deepEqual(f.db.raw.prepare("SELECT * FROM blower_history_events WHERE id='old-runtime'").get(), oldEvent);
    assert.deepEqual(f.db.raw.prepare('SELECT * FROM blower_limestone_run_segments_v1').get(), oldLedger);
    const audit = f.db.raw.prepare("SELECT * FROM blower_history_asset_history WHERE action_type='limestone_basis_confirm'").get();
    assert.deepEqual(JSON.parse(audit.before_json).asset, { ...f.before });
    const event = f.db.raw.prepare("SELECT * FROM blower_history_events WHERE source_type='limestone_basis_confirmed'").get();
    assert.equal(event.note, f.body.evidence); assert.equal(event.event_type, 'basis_confirmation');
    const publicProof = JSON.parse(event.source_text);
    assert.equal(publicProof.confirmedById, undefined); assert.equal(publicProof.confirmedByName, undefined);
    assert.equal(publicProof.replacementAt, row.last_replacement_at);
    assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n, 0);
  } finally { f.db.raw.close(); }
});

test('certification is invalidated by replacement/start revision changes and survives runtime-only revisions', async () => {
  const f = await fixture(); try {
    assert.equal((await h.confirmLimestoneBasis(f.db, user, f.body, options)).status, 200);
    const row = f.db.raw.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag);
    assert.equal(h.limestoneBasisConfirmed({ ...row, cycle_runtime_revision: 'next-run' }), true);
    assert.equal(h.limestoneBasisConfirmed({ ...row, cycle_start_revision: 'new-cycle' }), false);
    assert.equal(h.limestoneRunDisputed({ ...row, cycle_start_revision: 'new-cycle' }), true);
    assert.equal(h.limestoneBasisConfirmed({ ...row, last_replacement_at: '2026-09-23T00:00:00Z' }), false);
    assert.equal(h.limestoneBasisConfirmed({ ...row, limestone_basis_confirmation: '{' }), false);
  } finally { f.db.raw.close(); }
});

test('missing evidence, imprecise/future date, wrong asset, and anonymous user do not write', async () => {
  const f = await fixture(); try {
    for (const override of [{ evidence: '' }, { evidence: ' '.repeat(5) }, { evidence: 'x'.repeat(1501) },
      { replacementAt: '2026-09-22' }, { replacementAt: '2026-09-22T00:00:00' },
      { replacementAt: '2026-11-03T00:00:00Z' }, { tagNumber: '103HRJ01AN601' },
      { expectedCycleRuntimeRevision: undefined }]) {
      assert.equal((await h.confirmLimestoneBasis(f.db, user, { ...f.body, ...override }, options)).status, 400);
    }
    assert.equal((await h.confirmLimestoneBasis(f.db, null, f.body, options)).status, 403);
    assert.deepEqual(f.db.raw.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag), f.before);
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM blower_history_events WHERE source_type='limestone_basis_confirmed'").get().n, 0);
  } finally { f.db.raw.close(); }
});

test('stale snapshot and replay do not reset a newer cycle or add another certificate', async () => {
  const f = await fixture(); try {
    assert.equal((await h.confirmLimestoneBasis(f.db, user, { ...f.body, expectedCycleStartRevision: 'stale' }, options)).status, 409);
    assert.equal((await h.confirmLimestoneBasis(f.db, user, f.body, options)).status, 200);
    const saved = f.db.raw.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag);
    assert.equal((await h.confirmLimestoneBasis(f.db, user, f.body, options)).status, 409);
    assert.deepEqual(f.db.raw.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag), saved);
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM blower_history_events WHERE source_type='limestone_basis_confirmed'").get().n, 1);
  } finally { f.db.raw.close(); }
});

test('atomic CAS rolls back evidence and certification if runtime changes between read and write', async () => {
  const f = await fixture(); try {
    f.db.beforeBatch = () => f.db.raw.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='race' WHERE tag_number=?").run(f.tag);
    const response = await h.confirmLimestoneBasis(f.db, user, f.body, options);
    assert.equal(response.status, 409);
    const row = f.db.raw.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag);
    assert.equal(row.cycle_runtime_revision, 'race'); assert.equal(row.limestone_basis_confirmation, '');
    assert.equal(row.cycle_runtime_hours, 922.1);
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM blower_history_events WHERE source_type='limestone_basis_confirmed'").get().n, 0);
    assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n, 0);
  } finally { f.db.raw.close(); }
});

test('refresh-state pages and normal state expose the same certification booleans', async () => {
  const f = await fixture(); try {
    await h.confirmLimestoneBasis(f.db, user, f.body, options);
    const state = await h.buildRefreshState(f.db, user);
    const normal = state.assets.find(a => a.tagNumber === f.tag);
    assert.equal(normal.limestoneBasisConfirmed, true); assert.equal(normal.limestoneRunDisputed, false);
    const response = await h.buildRefreshStatePage(f.db, user, '103HRJ01AN601', 2);
    const page = await response.json(); const item = page.assets.find(a => a.tagNumber === f.tag);
    assert.equal(item.limestoneBasisConfirmed, true); assert.equal(item.limestoneRunDisputed, false);
    assert.equal(item.dataParcRuntimeBasis, null); assert.equal(item.hasUnverifiedDataParcHistory, true);
  } finally { f.db.raw.close(); }
});

test('certificate evidence cannot be edited or deleted through generic history mutation', async () => {
  const f = await fixture(); try {
    await h.confirmLimestoneBasis(f.db, user, f.body, options);
    const row = f.db.raw.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(f.tag);
    const event = f.db.raw.prepare("SELECT * FROM blower_history_events WHERE source_type='limestone_basis_confirmed'").get();
    assert.equal(h.planManualHistoryDeletion(row, [event], event.id, options).code, 'LIMESTONE_BASIS_EVIDENCE_PROTECTED');
    const reply = await h.editAnyHistoryEvent(f.db, user, { eventId: event.id, tagNumber: f.tag,
      expectedEventUpdatedAt: event.updated_at, expectedLastReplacementAt: row.last_replacement_at,
      expectedCycleStartRevision: row.cycle_start_revision, expectedCycleRuntimeRevision: row.cycle_runtime_revision }, options);
    assert.equal(reply.status, 409); assert.equal((await reply.json()).code, 'LIMESTONE_BASIS_EVIDENCE_PROTECTED');
  } finally { f.db.raw.close(); }
});

test('existing installed schema receives the additive certificate column through readiness check', async () => {
  const f = await fixture(); try {
    f.db.raw.exec('ALTER TABLE blower_history_assets DROP COLUMN limestone_basis_confirmation');
    await h.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(f.db.raw.prepare('SELECT limestone_basis_confirmation FROM blower_history_assets LIMIT 1').get().limestone_basis_confirmation, '');
  } finally { f.db.raw.close(); }
});

for (const tag of TAGS) test(`${tag}: real authenticated API confirms, fully remeasures, then appends without old proof reuse`, async t => {
  const NativeDate = Date; let clock = NativeDate.parse('2026-11-02T12:00:00.000Z');
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  t.after(() => { globalThis.Date = NativeDate; });
  const { fixture: apiFixture, browserCreate, agentClaim, agentComplete, callApi,
    BROWSER_TOKEN, historyPost } = await import('./helpers/blower-incremental-fixture.mjs');
  const { __oisDataRequestsTest: ois } = await import('../functions/api/ois-data-requests.js');
  const f = await apiFixture(tag, true); t.after(() => f.database.close());
  const replacement = tag === TAGS[1] ? '2026-05-12T00:00:00+09:00' : '2026-09-22T00:00:00+09:00';
  f.sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at=?, cycle_start_revision='historical-start',
    cycle_runtime_revision='historical-runtime', cycle_runtime_hours=922.1, runtime_hours=922.1 WHERE tag_number=?`).run(replacement, tag);
  f.sqlite.prepare(`INSERT INTO blower_history_events
    (id,tag_number,event_type,event_date,runtime_hours,source_type,source_text,created_by_id,created_by_name,created_at,updated_at)
    VALUES('historical',?,'runtime_correction','2026-10-30T01:31:19Z',922.1,'dataparc_runtime','old-invalid-proof','owner','owner','2026-10-30T01:31:20Z','2026-10-30T01:31:20Z')`).run(tag);
  f.sqlite.exec(`CREATE TABLE blower_limestone_run_segments_v1 (request_id TEXT PRIMARY KEY,tag_number TEXT,start_ms INTEGER,end_ms INTEGER,running_seconds INTEGER);
    INSERT INTO blower_limestone_run_segments_v1 VALUES('historical-run','${tag}',1793344983000,1793437569000,88985);`);
  const read = () => f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  const rows = () => f.sqlite.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY created_at DESC,id DESC').all(tag);
  const apiHistory = body => callApi(historyPost, f.database,
    new Request('https://example.test/api/blower-history', { method: 'POST',
      headers: { Authorization: `Bearer ${BROWSER_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const requestBody = task => ({ action: 'create_blower_runtime_probe', unifiedRefresh: true,
    incrementalRefresh: true, requireIncrementalAppend: task.incremental === true, assetTag: tag,
    dataParcTag: task.dataParcTag, confirmRunSignal: true, startAt: task.startAt,
    expectedLastReplacementAt: task.snapshot.lastReplacementAt,
    expectedCycleStartState: task.snapshot.cycleStartState,
    expectedCycleStartedAt: task.snapshot.cycleStartedAt,
    expectedCycleStartRevision: task.snapshot.cycleStartRevision,
    expectedCycleRuntimeRevision: task.snapshot.cycleRuntimeRevision });
  async function collect(created, seconds, firstState) {
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const claim = await agentClaim(f.database);
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    const item = claim.body.items.excel;
    assert.equal(item.id, created.body.item.id);
    const chunks = ois.buildBlowerRuntimeProbeChunks(item.probe.startAt, item.probe.endAt).map((chunk, i) => ({
      ...chunk, startState: i === 0 ? firstState : 'running', endState: 'running',
      totalRunningHours: i === 0 ? seconds / 3600 : 0, runningSeconds: i === 0 ? seconds : 0 }));
    const complete = await agentComplete(f.database, item.id, { ...item.probe, requestId: item.id,
      ok: true, readOnly: true, observedAt: item.probe.endAt, collectedAt: new Date().toISOString(),
      completedChunkCount: chunks.length, startState: firstState, endState: 'running',
      totalRunningHours: seconds / 3600, runningSeconds: seconds, chunks });
    assert.equal(complete.status, 200, JSON.stringify(complete.body));
    return item;
  }
  // An in-flight observation accepted before certification must not become the
  // new cycle's basis even when its nominal replacement timestamp is unchanged.
  const before = read();
  const oldTask = { dataParcTag: `GSPOGE.ABB_DCS.${tag}XB04`, startAt: replacement, incremental: false,
    snapshot: { lastReplacementAt: before.last_replacement_at, cycleStartState: before.cycle_start_state,
      cycleStartedAt: '', cycleStartRevision: before.cycle_start_revision, cycleRuntimeRevision: before.cycle_runtime_revision } };
  const oldRequest = await collect(await browserCreate(f.database, requestBody(oldTask)), 1001, 'stopped');
  const confirmed = await apiHistory({ action: 'limestone_basis_confirm', tagNumber: tag,
    replacementAt: replacement, evidence: '실제 교체 완료 시각을 작업 완료 기록과 현장 확인으로 확정',
    expectedLastReplacementAt: before.last_replacement_at, expectedCycleStartRevision: before.cycle_start_revision,
    expectedCycleRuntimeRevision: before.cycle_runtime_revision });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const confirmedRow = read();
  const oldApply = await apiHistory({ action: 'dataparc_runtime_sync', requestId: oldRequest.id });
  assert.equal(oldApply.status, 409, JSON.stringify(oldApply.body));
  assert.deepEqual(read(), confirmedRow, 'old completion cannot change the certified cycle');

  const state = await h.buildRefreshState(f.database, user);
  const a = state.assets.find(asset => asset.tagNumber === tag);
  assert.equal(a.hasUnverifiedDataParcHistory, true); assert.equal(a.limestoneBasisConfirmed, true);
  const plan = core.plan([a], new Date());
  assert.equal(plan.tasks.length, 1, JSON.stringify(plan));
  const firstTask = plan.tasks[0];
  assert.equal(firstTask.previewOnly, undefined); assert.equal(firstTask.incremental, false);
  assert.equal(Date.parse(firstTask.startAt), Date.parse(replacement));
  const partialTask = { ...firstTask, startAt: new Date(clock - 3600000).toISOString() };
  const partial = await collect(await browserCreate(f.database,
    { ...requestBody(partialTask), incrementalRefresh: false }), 123, 'stopped');
  const partialApply = await apiHistory({ action: 'dataparc_runtime_sync', requestId: partial.id });
  assert.equal(partialApply.status, 409, JSON.stringify(partialApply.body));
  assert.equal(partialApply.body.code, 'LIMESTONE_BASIS_FULL_RANGE_REQUIRED');
  assert.deepEqual(read(), confirmedRow, 'a recent subrange cannot be published as the full certified cycle');
  const first = await collect(await browserCreate(f.database, requestBody(firstTask)), 1001, 'stopped');
  const applied = await apiHistory({ action: 'dataparc_runtime_sync', requestId: first.id });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.ok(Math.abs(read().cycle_runtime_hours - 1001 / 3600) < 1e-9, 'entire new total comes from RUN proof, never old total+ledger');
  assert.equal(h.limestoneBasisConfirmed(read()), true);
  const basis = h.currentDataParcRuntimeBasis(read(), rows());
  assert.equal(basis?.appendReady, true, JSON.stringify(basis));
  assert.equal(basis.runningSeconds, 1001);
  assert.equal(f.sqlite.prepare('SELECT running_seconds FROM blower_limestone_run_segments_v1').get().running_seconds, 88985);
  assert.equal(f.sqlite.prepare("SELECT runtime_hours FROM blower_history_events WHERE id='historical'").get().runtime_hours, 922.1);

  clock += 10 * 60000;
  const next = (await h.buildRefreshState(f.database, user)).assets.find(asset => asset.tagNumber === tag);
  const nextTask = core.plan([next], new Date()).tasks[0];
  assert.equal(nextTask.incremental, true); assert.equal(nextTask.queryStartAt, basis.observedAt);
  const second = await collect(await browserCreate(f.database, requestBody(nextTask)), 67, 'running');
  assert.equal(Date.parse(second.probe.startAt), Date.parse(basis.observedAt));
  const delta = await apiHistory({ action: 'dataparc_runtime_sync', requestId: second.id });
  assert.equal(delta.status, 200, JSON.stringify(delta.body));
  assert.equal(delta.body.addedRunningSeconds, 67);
  assert.ok(Math.abs(read().cycle_runtime_hours - 1068 / 3600) < 1e-9);
  assert.equal(h.limestoneBasisConfirmed(read()), true);
  assert.equal(h.currentDataParcRuntimeBasis(read(), rows())?.appendReady, true);
});
