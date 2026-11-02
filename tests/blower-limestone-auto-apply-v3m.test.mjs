import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { __blowerHistoryTest as h, onRequestGet as historyGet } from '../functions/api/blower-history.js';
const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const TAGS = ['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'];
const signal = tag => `GSPOGE.ABB_DCS.${tag}XB04`;

test('automatic saved-baseline policy is exact-three, active-only and does not invent confirmation', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const a = { enabled: 1, blower_type: 'limestone', tag_number: TAGS[0], last_replacement_at: '2026-09-22T00:00:00+09:00' };
  assert.equal(h.limestoneAutoApply(a, now), true);
  assert.equal(h.limestoneBasisConfirmed(a), false);
  assert.equal(h.limestoneBasisReviewRequired(a), true);
  assert.equal(h.limestoneRunDisputed(a), true, 'old independent-ledger eligibility retains its historical predicate');
  for (const change of [{ enabled: 0 }, { blower_type: 'fbhe' }, { tag_number: '103HRJ01AN601' },
    { last_replacement_at: '' }, { last_replacement_at: '2026-09-22' }, { last_replacement_at: '2026-11-03T00:00:00Z' }])
    assert.equal(h.limestoneAutoApply({ ...a, ...change }, now), false);
});

for (const cycle of ['pending', 'started']) for (const tag of TAGS) test(`${tag}: saved ${cycle} baseline automatically rebuilds measured total and then appends, with old ledger isolated`, async t => {
  const NativeDate = Date; let clock = NativeDate.parse('2026-11-02T12:00:00Z');
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  t.after(() => { globalThis.Date = NativeDate; });
  const { fixture, browserCreate, agentClaim, agentComplete, callApi,
    BROWSER_TOKEN, historyPost } = await import('./helpers/blower-incremental-fixture.mjs');
  const { __oisDataRequestsTest: ois } = await import('../functions/api/ois-data-requests.js');
  const f = await fixture(tag, true); t.after(() => f.database.close());
  const baseline = tag === TAGS[1] ? '2026-05-12T00:00:00+09:00' : '2026-09-22T00:00:00+09:00';
  const startedAt = cycle === 'started' ? new Date(Date.parse(baseline) + 3600000).toISOString() : null;
  f.sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state=?,cycle_started_at=?,
    cycle_start_revision='historical-start',cycle_runtime_revision='historical-runtime',
    cycle_runtime_hours=922.1,runtime_hours=922.1 WHERE tag_number=?`).run(baseline, cycle, startedAt, tag);
  const source = { schemaVersion: 1, requestType: 'blower_runtime_probe', requestId: 'historical',
    assetTag: tag, dataParcTag: signal(tag), startAt: baseline, observedAt: '2026-10-30T01:31:19Z',
    expectedLastReplacementAt: baseline, expectedCycleStartState: cycle === 'pending' ? 'legacy' : cycle,
    expectedCycleStartedAt: startedAt || '', expectedCycleStartRevision: 'historical-start',
    expectedCycleRuntimeRevision: 'historical-runtime', ...(cycle === 'pending' ? { signalOnlyCycle: true } : {}) };
  // 1B has a displayable old checkpoint whose append ownership is missing;
  // 2A/2B have no valid current basis but retain old DataPARC event rows.
  const priorProof = tag === TAGS[0] ? JSON.stringify(source) : 'unverified historical proof';
  f.sqlite.prepare(`INSERT INTO blower_history_events
    (id,tag_number,event_type,event_date,runtime_hours,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)
    VALUES('dataparc_runtime:historical',?,'runtime_correction','2026-10-30T01:31:19Z',922.1,'dataparc_runtime','historical',?,'owner','owner','2026-10-30T01:31:20Z','2026-10-30T01:31:20Z')`).run(tag, priorProof);
  const read = () => f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  const api = body => callApi(historyPost, f.database,
    new Request('https://example.test/api/blower-history', { method: 'POST',
      headers: { Authorization: `Bearer ${BROWSER_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const getState = async () => {
    const reply = await callApi(historyGet, f.database, new Request('https://example.test/api/blower-history?action=refresh_state',
      { headers: { Authorization: `Bearer ${BROWSER_TOKEN}` } }));
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    return reply.body.assets.find(a => a.tagNumber === tag);
  };
  const body = (asset, startAt, overrides = {}) => ({ action: 'create_blower_runtime_probe', unifiedRefresh: true,
    incrementalRefresh: false, requireIncrementalAppend: false, assetTag: tag, dataParcTag: signal(tag),
    confirmRunSignal: true, startAt, expectedLastReplacementAt: asset.last_replacement_at,
    expectedCycleStartState: asset.cycle_start_state, expectedCycleStartedAt: asset.cycle_started_at || '',
    expectedCycleStartRevision: asset.cycle_start_revision, expectedCycleRuntimeRevision: asset.cycle_runtime_revision,
    ...overrides });
  async function collect(requestBody, seconds, startState = 'running') {
    const created = await browserCreate(f.database, requestBody);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const claim = await agentClaim(f.database); assert.equal(claim.status, 200, JSON.stringify(claim.body));
    const item = claim.body.items.excel; assert.equal(item.id, created.body.item.id);
    const chunks = ois.buildBlowerRuntimeProbeChunks(item.probe.startAt, item.probe.endAt).map((chunk, i) => ({
      ...chunk, startState: i === 0 ? startState : 'running', endState: 'running',
      totalRunningHours: i === 0 ? seconds / 3600 : 0, runningSeconds: i === 0 ? seconds : 0 }));
    const completed = await agentComplete(f.database, item.id, { ...item.probe, requestId: item.id,
      ok: true, readOnly: true, observedAt: item.probe.endAt, collectedAt: new Date().toISOString(),
      completedChunkCount: chunks.length, startState, endState: 'running',
      totalRunningHours: seconds / 3600, runningSeconds: seconds, chunks });
    assert.equal(completed.status, 200, JSON.stringify(completed.body)); return item;
  }
  const original = read();
  const ledgerItem = await collect(body(original, new Date(clock - 3600000).toISOString(), { limestoneTrackingOnly: true }), 123);
  const ledgerSaved = await api({ action: 'limestone_run_track_apply', requestId: ledgerItem.id });
  assert.equal(ledgerSaved.status, 200, JSON.stringify(ledgerSaved.body));
  const ledgerRows = f.sqlite.prepare('SELECT * FROM blower_limestone_run_segments_v1').all();
  const oldRow = f.sqlite.prepare("SELECT * FROM blower_history_events WHERE id='dataparc_runtime:historical'").get();
  assert.equal((await api({ action: 'dataparc_runtime_sync', requestId: ledgerItem.id })).body.code, 'LIMESTONE_LEDGER_ONLY_INTENT');
  const a = await getState();
  assert.equal(a.limestoneAutoApply, true); assert.equal(a.limestoneBasisConfirmed, false);
  assert.equal(a.limestoneRunDisputed, false); assert.equal(a.limestoneBasisReviewRequired, true);
  assert.deepEqual(read(), original, 'reading/planning and independent ledger do not edit the stored date or revisions');
  if (tag === TAGS[0]) assert.equal(a.dataParcRuntimeBasis?.appendReady, false);
  else { assert.equal(a.dataParcRuntimeBasis, null); assert.equal(a.hasUnverifiedDataParcHistory, true); }
  let planned = core.plan([a], new Date()); assert.equal(planned.tasks.length, 1, JSON.stringify(planned));
  assert.equal(planned.tasks[0].previewOnly, undefined); assert.equal(planned.tasks[0].incremental, false);
  assert.equal(Date.parse(planned.tasks[0].startAt), Date.parse(baseline));

  const partial = await collect(body(read(), new Date(clock - 3600000).toISOString()), 77);
  assert.equal((await api({ action: 'dataparc_runtime_sync', requestId: partial.id })).body.code, 'LIMESTONE_BASIS_FULL_RANGE_REQUIRED');
  assert.deepEqual(read(), original);
  const stale = await collect(body(read(), baseline), 200);
  f.sqlite.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='raced-runtime' WHERE tag_number=?").run(tag);
  const raced = read();
  assert.equal((await api({ action: 'dataparc_runtime_sync', requestId: stale.id })).body.code, 'DATAPARC_RUNTIME_CYCLE_CONFLICT');
  assert.deepEqual(read(), raced);
  const current = await getState(); planned = core.plan([current], new Date());
  assert.equal(planned.tasks.length, 1); assert.equal(planned.tasks[0].incremental, false);
  const full = await collect(body(read(), planned.tasks[0].startAt), 1001, 'stopped');
  const applied = await api({ action: 'dataparc_runtime_sync', requestId: full.id });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.ok(Math.abs(read().cycle_runtime_hours - 1001 / 3600) < 1e-9);
  assert.equal(read().last_replacement_at, baseline); assert.equal(read().cycle_start_revision, original.cycle_start_revision);
  assert.equal(read().cycle_start_state, cycle); assert.equal(read().cycle_started_at, startedAt);
  assert.equal(read().limestone_basis_confirmation, '');
  assert.equal(h.limestoneBasisConfirmed(read()), false);
  const measured = await getState(); assert.equal(measured.dataParcRuntimeBasis?.appendReady, true);
  clock += 600000;
  const nextTask = core.plan([measured], new Date()).tasks[0]; assert.equal(nextTask.incremental, true);
  const delta = await collect(body(read(), nextTask.startAt, { incrementalRefresh: true, requireIncrementalAppend: true }), 67);
  assert.equal(Date.parse(delta.probe.startAt), Date.parse(measured.dataParcRuntimeBasis.observedAt));
  const appended = await api({ action: 'dataparc_runtime_sync', requestId: delta.id });
  assert.equal(appended.status, 200, JSON.stringify(appended.body)); assert.equal(appended.body.addedRunningSeconds, 67);
  assert.ok(Math.abs(read().cycle_runtime_hours - 1068 / 3600) < 1e-9);
  assert.equal(read().last_replacement_at, baseline); assert.equal(read().cycle_start_revision, original.cycle_start_revision);
  assert.equal(read().limestone_basis_confirmation, '');
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM blower_limestone_run_segments_v1').all(), ledgerRows);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM blower_history_events WHERE id='dataparc_runtime:historical'").get(), oldRow);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM blower_history_events WHERE event_type='basis_confirmation'").get().n, 0);
});
