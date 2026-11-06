import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { onRequestGet as requestGet } from '../functions/api/ois-data-requests.js';
import { onRequestGet as historyGet } from '../functions/api/blower-history.js';
import { verifiedAppendBase } from '../functions/_shared/blower-incremental.js';
import { fixture, browserCreate, agentClaim, agentComplete, callApi,
  BROWSER_TOKEN, historyPost } from './helpers/blower-incremental-fixture.mjs';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const TAG = '203HRJ01AN601', SIGNAL = `GSPOGE.ABB_DCS.${TAG}XB04`;
// Synthetic partial interval reproduces the reported 02:09 -> 16:12 hold.
// These dates are not a claim about the current production replacement clock.
const REPLACEMENT = '2026-05-12T00:00:00+09:00';
const RANGE_START = '2026-09-20T00:00:00+09:00';
const OBSERVED = '2026-11-05T17:09:00.000Z';
const NOW = '2026-11-06T07:12:00.000Z';
const BASE_ID = 'dataparc_runtime:verified-partial';

async function setup(t, seconds = 3601) {
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [NativeDate.parse(NOW)])); }
    static now() { return NativeDate.parse(NOW); }
  };
  t.after(() => { globalThis.Date = NativeDate; });
  const f = await fixture(TAG, true);
  t.after(() => f.database.close());
  const { sqlite } = f;
  sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='pending',
    cycle_started_at=NULL,cycle_start_revision='partial-start',cycle_runtime_revision='partial-runtime',
    cycle_runtime_hours=?,runtime_hours=?,cycle_runtime_anchor_at=?,runtime_anchor_at=?,
    cycle_runtime_state='running',is_running=1,limestone_basis_confirmation='' WHERE tag_number=?`)
    .run(REPLACEMENT, seconds / 3600, seconds / 3600, OBSERVED, OBSERVED, TAG);
  const source = { schemaVersion: 1, requestType: 'blower_runtime_probe', requestId: 'verified-partial',
    assetTag: TAG, dataParcTag: SIGNAL, startAt: RANGE_START, endAt: OBSERVED, observedAt: OBSERVED,
    expectedLastReplacementAt: REPLACEMENT, expectedCycleStartState: 'legacy', expectedCycleStartedAt: '',
    expectedCycleStartRevision: 'partial-start', expectedCycleRuntimeRevision: 'earlier-runtime',
    signalOnlyCycle: true, startState: 'stopped', endState: 'running',
    runningSeconds: seconds, totalRunningHours: seconds / 3600, chunkCount: 2, collectedAt: OBSERVED };
  function insert(row) {
    const defaults = { issue_type: '', action_type: '', note: '', source_log_id: '', source_text: '',
      created_by_id: 'fixture', created_by_name: 'fixture' };
    const data = { ...defaults, ...row }, keys = Object.keys(data);
    sqlite.prepare(`INSERT INTO blower_history_events(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
      .run(...Object.values(data));
  }
  insert({ id: BASE_ID, tag_number: TAG, event_type: 'runtime_correction', event_date: OBSERVED,
    runtime_hours: seconds / 3600, source_type: 'dataparc_runtime', source_log_id: source.requestId,
    source_text: JSON.stringify(source), created_at: OBSERVED, updated_at: OBSERVED });
  const read = () => sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG);
  const events = () => sqlite.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
  const protectedState = () => JSON.stringify({ asset: read(), events: events(),
    history: sqlite.prepare('SELECT * FROM blower_history_asset_history ORDER BY id').all() });
  const api = body => callApi(historyPost, f.database, new Request('https://example.test/api/blower-history', {
    method: 'POST', headers: { Authorization: `Bearer ${BROWSER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }));
  const project = async () => {
    const result = await callApi(historyGet, f.database, new Request('https://example.test/api/blower-history?action=refresh_state',
      { headers: { Authorization: `Bearer ${BROWSER_TOKEN}` } }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.assets.find(a => a.tagNumber === TAG);
  };
  const body = () => ({ action: 'create_blower_runtime_probe', unifiedRefresh: true,
    incrementalRefresh: true, requireIncrementalAppend: true, assetTag: TAG, dataParcTag: SIGNAL,
    confirmRunSignal: true, startAt: RANGE_START, expectedLastReplacementAt: REPLACEMENT,
    expectedCycleStartState: read().cycle_start_state, expectedCycleStartedAt: read().cycle_started_at || '',
    expectedCycleStartRevision: read().cycle_start_revision, expectedCycleRuntimeRevision: read().cycle_runtime_revision });
  async function complete(id, delta, startState = 'running') {
    const claimed = await agentClaim(f.database);
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    const item = claimed.body.items.excel;
    assert.equal(item.id, id);
    assert.equal(Date.parse(item.probe.startAt), Date.parse(OBSERVED), 'the server queries only after the verified endpoint');
    assert.equal(Date.parse(item.probe.endAt), Date.parse(NOW));
    const result = await agentComplete(f.database, item.id, { ...item.probe, requestId: item.id,
      ok: true, readOnly: true, observedAt: item.probe.endAt, collectedAt: NOW, completedChunkCount: 1,
      startState, endState: 'running', runningSeconds: delta, totalRunningHours: delta / 3600,
      chunks: [{ index: 1, startAt: item.probe.startAt, endAt: item.probe.endAt,
        startState, endState: 'running', runningSeconds: delta, totalRunningHours: delta / 3600 }] });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return item;
  }
  return { ...f, seconds, source, insert, read, events, protectedState, api, project, body, complete };
}

for (const mode of ['single', 'unified batch']) for (const seconds of [3601, 0]) {
  test(`${mode}: Limestone partial ${seconds}s receipt advances only the measured range and retains basis review`, async t => {
    const f = await setup(t, seconds), original = f.read(), oldEvents = f.events();
    const state = await f.project(), plan = core.plan([state], new Date());
    assert.equal(state.limestoneAutoApply, true);
    assert.equal(state.limestoneBasisReviewRequired, true);
    assert.equal(state.dataParcRuntimeBasis.coverageComplete, false);
    assert.equal(plan.tasks.length, 1, JSON.stringify(plan));
    const [task] = plan.tasks;
    assert.equal(task.incremental, true);
    assert.equal(task.partialRange, true);
    assert.equal(Date.parse(task.startAt), Date.parse(RANGE_START));
    assert.equal(task.queryStartAt, OBSERVED);
    assert.equal(task.limestoneAutoRebuild, undefined);
    let id;
    if (mode === 'single') {
      const created = await browserCreate(f.database, f.body());
      assert.equal(created.status, 201, JSON.stringify(created.body));
      id = created.body.item.id;
      await f.complete(id, 67);
      const applied = await f.api({ action: 'dataparc_runtime_sync', requestId: id });
      assert.equal(applied.status, 200, JSON.stringify(applied.body));
      assert.equal(applied.body.addedRunningSeconds, 67);
    } else {
      const requests = [];
      const outcomes = await core.executeDataParcBatch(plan.tasks, {
        assertWritable() {}, currentAssetFor: () => state, sleep: async () => {},
        async api(request) {
          requests.push(request);
          let response;
          if (request.body?.action === 'create_blower_runtime_probe_batch') {
            response = await browserCreate(f.database, request.body);
            assert.equal(response.status, 201, JSON.stringify(response.body));
            assert.equal(request.body.requests[0].requireIncrementalAppend, true);
            assert.equal(request.body.requests[0].incrementalRefresh, true);
            id = response.body.results[0].item.id;
            await f.complete(id, 67);
          } else if ((request.method || 'GET') === 'GET') {
            response = await callApi(requestGet, f.database, new Request(`https://example.test${request.url}`,
              { headers: { Authorization: `Bearer ${BROWSER_TOKEN}` } }));
          } else response = await f.api(request.body);
          assert.ok(response.status < 300, JSON.stringify(response));
          return response.body;
        }
      });
      assert.equal(outcomes[0].status, 'complete', JSON.stringify(outcomes));
      assert.equal(outcomes[0].partialRange, true);
      assert.equal(outcomes[0].runReviewStatus.key, 'coverage-gap');
      assert.equal(requests.filter(r => r.body?.action === 'create_blower_runtime_probe_batch').length, 1);
    }
    const intent = f.sqlite.prepare('SELECT * FROM blower_runtime_append_v1 WHERE request_id=?').get(id);
    assert.equal(intent.base_event_id, BASE_ID);
    assert.equal(intent.base_running_seconds, seconds);
    assert.equal(Date.parse(intent.coverage_start_at), Date.parse(RANGE_START));
    assert.equal(intent.base_observed_at, OBSERVED);
    const after = f.read(), saved = await f.project(), basis = saved.dataParcRuntimeBasis;
    for (const key of ['last_replacement_at', 'cycle_started_at', 'cycle_start_state', 'cycle_start_revision', 'limestone_basis_confirmation'])
      assert.equal(after[key], original[key], key);
    for (const old of oldEvents) assert.deepEqual(f.events().find(r => r.id === old.id), old);
    assert.equal(after.cycle_runtime_hours, (seconds + 67) / 3600);
    assert.equal(basis.runningSeconds, seconds + 67);
    assert.equal(Date.parse(basis.startAt), Date.parse(RANGE_START));
    assert.equal(Date.parse(basis.observedAt), Date.parse(NOW));
    assert.equal(basis.coverageComplete, false);
    assert.equal(basis.appendReady, true);
    assert.equal(basis.missingLeadingSeconds, state.dataParcRuntimeBasis.missingLeadingSeconds);
    assert.equal(saved.limestoneBasisReviewRequired, true);
    assert.equal(saved.runtimeCoverageEvidence.wholeCycleVerified, false);
    assert.equal(saved.runtimeCoverageEvidence.measurementVerified, true);
    assert.equal(saved.severity, 'runtime_unknown');
    assert.equal(saved.remainingHours, null);
    assert.equal(saved.progressPct, null);
    const beforeReplay = f.protectedState();
    const replay = await f.api({ action: 'dataparc_runtime_sync', requestId: id });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(f.protectedState(), beforeReplay, 'replay cannot add the same delta twice');
    assert.equal(core.plan([saved], new Date()).tasks.length, 0, 'an unchanged endpoint does not create another query');
  });
}

for (const sourceType of ['manual', 'shift_log_operation_auto', 'dataparc_runtime']) {
  test(`a newer ${sourceType} owner with a conflicting total blocks old-receipt append before queue publication`, async t => {
    const f = await setup(t);
    const newer = { ...f.events()[0], id: 'newer-owner', source_type: sourceType, runtime_hours: 2,
      created_at: '2026-11-05T17:09:01.000Z', updated_at: '2026-11-05T17:09:01.000Z' };
    f.insert(newer);
    const before = f.protectedState();
    assert.equal(verifiedAppendBase(f.read(), f.events(), SIGNAL), null);
    const created = await browserCreate(f.database, f.body());
    assert.equal(created.status, 409, JSON.stringify(created.body));
    assert.equal(created.body.code, 'BLOWER_INCREMENTAL_BASE_REQUIRED');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n, 0);
    assert.equal(f.protectedState(), before);
  });
}

for (const [kind, expected] of [
  ['boundary', 'DATAPARC_APPEND_BOUNDARY_CHANGED'],
  ['owner', 'DATAPARC_APPEND_BASE_CHANGED'],
  ['cycle', 'DATAPARC_RUNTIME_CYCLE_CONFLICT']
]) {
  test(`partial Limestone append retains the ${kind} race guard and does not change existing runtime`, async t => {
    const f = await setup(t), created = await browserCreate(f.database, f.body());
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.item.id;
    await f.complete(id, 67, kind === 'boundary' ? 'stopped' : 'running');
    if (kind === 'owner') f.insert({ ...f.events()[0], id: 'newer-manual', source_type: 'manual', runtime_hours: 2,
      created_at: NOW, updated_at: NOW });
    if (kind === 'cycle') f.sqlite.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='changed' WHERE tag_number=?").run(TAG);
    const before = f.protectedState();
    const applied = await f.api({ action: 'dataparc_runtime_sync', requestId: id });
    assert.equal(applied.status, 409, JSON.stringify(applied.body));
    assert.equal(applied.body.code, expected);
    assert.equal(f.protectedState(), before);
  });
}
