import test from 'node:test';
import assert from 'node:assert/strict';
import * as incremental from '../functions/_shared/blower-incremental.js';

const LIMESTONE = ['103HRJ01AN601', '103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'];
const EXISTING = [
  '104ETH03AN601', '104ETH03AN602', '104ETG30AN601', '104ETG30AN602',
  '204ETG30AN601', '204ETG30AN602', '104SDF01AN001', '104SDF01AN002',
  '204SDF01AN001', '204SDF01AN002', '204LMDF01AN001',
  '104HHL60AP611', '104HHL60AP621', '104HHL60AP631',
  '204HHL60AP611', '204HHL60AP621', '204HHL60AP631',
  '104HHL10AN611', '104HHL10AN621', '104HHL10AN631',
  '204HHL10AN611', '204HHL10AN621', '204HHL10AN631'
];
// Synthetic fixture times are test data, never inferred maintenance timestamps.
const START = '2026-10-01T09:00:00+09:00';
const OBSERVED = '2026-10-01T10:00:00+09:00';
const BOUNDARY = '2026-10-01T10:10:00+09:00';
const NEXT = '2026-10-01T11:00:00+09:00';
const signalFor = tag => tag === '104ETH03AN602' ? 'GSPOGE.ABB_DCS.003ETH03AN602XB04'
  : LIMESTONE.includes(tag) ? `GSPOGE.ABB_DCS.${tag}XB04` : `GSPOGE.ABB_DCS.TEST_ONLY_BINARY_${tag}`;

function measured(tag, cycle = 'pending') {
  const seconds = 1001;
  const signal = signalFor(tag);
  const asset = {
    tag_number: tag, last_replacement_at: START, cycle_start_state: cycle,
    cycle_started_at: cycle === 'started' ? START : null,
    cycle_start_revision: 'cycle-start-r1', cycle_runtime_revision: 'runtime-r2',
    cycle_runtime_hours: seconds / 3600, cycle_runtime_anchor_at: OBSERVED,
    cycle_runtime_state: 'running'
  };
  const source = {
    schemaVersion: 1, requestType: 'blower_runtime_probe', requestId: 'first-measurement',
    assetTag: tag, dataParcTag: signal, startAt: START, endAt: OBSERVED, observedAt: OBSERVED,
    expectedLastReplacementAt: START, expectedCycleStartState: cycle === 'pending' ? 'legacy' : cycle,
    expectedCycleStartedAt: cycle === 'started' ? START : '', expectedCycleStartRevision: 'cycle-start-r1',
    expectedCycleRuntimeRevision: 'runtime-r1', startState: 'stopped', endState: 'running',
    runningSeconds: seconds, totalRunningHours: seconds / 3600,
    ...(cycle === 'pending' ? { signalOnlyCycle: true } : {})
  };
  const row = {
    id: 'dataparc_runtime:first-measurement', tag_number: tag, event_type: 'runtime_correction',
    event_date: OBSERVED, runtime_hours: seconds / 3600, source_type: 'dataparc_runtime',
    source_log_id: 'first-measurement', source_text: JSON.stringify(source),
    created_at: OBSERVED, updated_at: OBSERVED
  };
  return { asset, source, row, signal, seconds };
}

function verify(f, rows = [f.row]) {
  return incremental.verifiedAppendBase(f.asset, rows, f.signal);
}

function updateSource(f, changes) {
  Object.assign(f.source, changes);
  f.row.source_text = JSON.stringify(f.source);
}

for (const tag of LIMESTONE) {
  test(`Limestone pending ${tag} reuses a valid signal-only legacy receipt`, () => {
    const f = measured(tag), before = JSON.stringify(f);
    const base = verify(f);
    assert.ok(base, `${tag} needs its existing measured RUN receipt as an append base`);
    assert.equal(base.requestId, 'first-measurement');
    assert.equal(base.observedAt, OBSERVED);
    assert.equal(base.startAt, START);
    assert.equal(base.runningSeconds, 1001);
    assert.equal(base.cycleRuntimeRevision, 'runtime-r2');
    assert.equal(JSON.stringify(f), before, 'base verification must not rewrite a Cycle or receipt');
  });
}

test('all existing 23 RUN assets retain their pending signal-only append behavior', () => {
  for (const tag of EXISTING) assert.equal(verify(measured(tag))?.runningSeconds, 1001, tag);
});

for (const tag of LIMESTONE) {
  test(`Limestone ${tag} appends exact integer seconds and retains immutable replay totals`, () => {
    const f = measured(tag), base = verify(f);
    assert.ok(base);
    const probe = {
      ...f.source, requestId: 'second-measurement', startAt: OBSERVED, endAt: NEXT, observedAt: NEXT,
      expectedCycleRuntimeRevision: base.cycleRuntimeRevision,
      runningSeconds: 67, totalRunningHours: 67 / 3600
    };
    const receipt = {
      request_id: probe.requestId, base_event_id: base.eventId, base_revision: base.cycleRuntimeRevision,
      base_observed_at: base.observedAt, coverage_start_at: base.startAt,
      base_running_seconds: base.runningSeconds
    };
    const combined = incremental.combineAppendProbe(probe, receipt);
    assert.equal(combined.runningSeconds, 67, 'the stored result remains the measured delta');
    assert.equal(combined.incremental.totalRunningSeconds, 1068);
    assert.equal(combined.runtimeHours, 1068 / 3600);
    assert.deepEqual(incremental.combineAppendProbe(probe, receipt), combined,
      'replaying an immutable receipt must not add its delta to its own previous total');
    assert.equal(incremental.incrementalEvidence(combined)?.totalRunningSeconds, 1068);
    const nextRow = {
      ...f.row, id: 'dataparc_runtime:second-measurement', source_log_id: 'second-measurement',
      source_text: JSON.stringify(combined), event_date: NEXT, created_at: NEXT, updated_at: NEXT,
      runtime_hours: combined.runtimeHours
    };
    const nextAsset = {
      ...f.asset, cycle_runtime_hours: combined.runtimeHours, cycle_runtime_anchor_at: NEXT,
      cycle_runtime_revision: 'runtime-r3'
    };
    const nextBase = incremental.verifiedAppendBase(nextAsset, [nextRow, f.row], f.signal);
    assert.equal(nextBase?.runningSeconds, 1068);
    assert.equal(nextBase?.observedAt, NEXT);
    assert.equal(nextBase?.startAt, START, 'coverage stays anchored to the original measured Cycle');
    const third = incremental.combineAppendProbe({
      ...probe, requestId: 'third-measurement', startAt: NEXT,
      expectedCycleRuntimeRevision: 'runtime-r3', runningSeconds: 29
    }, {
      ...receipt, request_id: 'third-measurement', base_event_id: nextBase.eventId,
      base_revision: 'runtime-r3', base_observed_at: NEXT, base_running_seconds: nextBase.runningSeconds
    });
    assert.equal(third.incremental.totalRunningSeconds, 1097);
    assert.equal(third.runtimeHours, 1097 / 3600);
  });
}

function boundaryFixture(tag, mode = 'automatic') {
  const f = measured(tag, 'started');
  f.asset.cycle_runtime_anchor_at = BOUNDARY;
  f.asset.cycle_runtime_state = 'stopped';
  f.asset.cycle_runtime_revision = 'runtime-boundary-r3';
  const boundary = {
    id: mode === 'automatic' ? 'operation-auto:1234abcd:stop' : 'manual-stop',
    tag_number: tag, event_type: 'operation_stop', event_date: BOUNDARY,
    runtime_hours: f.seconds / 3600, source_type: mode === 'automatic' ? 'shift_log_operation_auto' : 'manual',
    source_log_id: mode === 'automatic' ? 'confirmed-operation-log' : '',
    action_type: mode === 'automatic' ? '교체운전 자동 정지' : '정지',
    created_at: BOUNDARY, updated_at: BOUNDARY
  };
  return { ...f, boundary };
}

for (const tag of LIMESTONE) {
  for (const mode of ['manual', 'automatic']) {
    test(`Limestone ${tag} preserves a verified total across an unchanged ${mode} boundary`, () => {
      const f = boundaryFixture(tag, mode);
      const base = verify(f, [f.boundary, f.row]);
      assert.ok(base, `${tag} ${mode} boundary must retain its measured predecessor`);
      assert.equal(base.observedAt, OBSERVED, 'resume from the last DataPARC observation, not the later boundary');
      assert.equal(base.runningSeconds, 1001);
      assert.equal(base.cycleRuntimeRevision, 'runtime-boundary-r3');
    });
  }
}

for (const [label, mutate] of [
  ['unknown equipment', f => {
    f.asset.tag_number = f.row.tag_number = '103HRJ01AN603';
    updateSource(f, { assetTag: '103HRJ01AN603' });
  }],
  ['wrong RUN signal', f => updateSource(f, { dataParcTag: 'GSPOGE.ABB_DCS.103HRJ01AN602XB04' })],
  ['changed replacement Cycle', f => { f.asset.last_replacement_at = '2026-10-01T09:10:00+09:00'; }],
  ['changed Cycle revision', f => { f.asset.cycle_start_revision = 'changed-start-revision'; }],
  ['changed accumulated hours', f => { f.asset.cycle_runtime_hours += 1; }],
  ['missing observation timestamp', f => { f.asset.cycle_runtime_anchor_at = null; }],
  ['missing replacement timestamp', f => { f.asset.last_replacement_at = null; }],
  ['pending receipt without signal-only evidence', f => updateSource(f, { signalOnlyCycle: false })],
  ['pending receipt with an invented startup time', f => updateSource(f, { expectedCycleStartedAt: START })],
  ['non-integer measured seconds', f => updateSource(f, { runningSeconds: 1001.5 })],
  ['unmatched source request ID', f => { f.row.source_log_id = 'unrelated-request'; }]
]) {
  test(`${label} still fails closed for a Limestone append base`, () => {
    const f = measured(LIMESTONE[0]);
    mutate(f);
    const before = JSON.stringify(f);
    assert.equal(verify(f), null);
    assert.equal(JSON.stringify(f), before);
  });
}

for (const [label, mutate] of [
  ['changed boundary total', f => { f.boundary.runtime_hours += 1; }],
  ['edited automatic event', f => { f.boundary.updated_at = NEXT; }],
  ['unrecognized automatic event', f => { f.boundary.id = 'unverified-stop'; }],
  ['missing boundary timestamp', f => { f.boundary.event_date = ''; }],
  ['pending Cycle with an automatic boundary', f => { f.asset.cycle_start_state = 'pending'; }]
]) {
  test(`${label} cannot authorize an automatic Limestone append`, () => {
    const f = boundaryFixture(LIMESTONE[0]);
    mutate(f);
    assert.equal(verify(f, [f.boundary, f.row]), null);
  });
}

test('append intent revision and boundary mismatches still reject without changing the probe', () => {
  const f = measured(LIMESTONE[0]), base = verify(f);
  const probe = { ...f.source, requestId: 'delta', startAt: OBSERVED,
    expectedCycleRuntimeRevision: base.cycleRuntimeRevision, runningSeconds: 67 };
  const receipt = { request_id: 'delta', base_event_id: base.eventId, base_revision: base.cycleRuntimeRevision,
    base_observed_at: base.observedAt, coverage_start_at: base.startAt, base_running_seconds: base.runningSeconds };
  for (const changes of [{ base_revision: 'changed' }, { base_observed_at: BOUNDARY }, { base_running_seconds: -1 }]) {
    assert.throws(() => incremental.combineAppendProbe(probe, { ...receipt, ...changes }),
      error => error.code === 'DATAPARC_APPEND_INTENT_CONFLICT');
  }
  assert.equal(probe.runningSeconds, 67);
  assert.equal(probe.incremental, undefined);
});

test('authenticated limit-zero fingerprint reports V8 without touching the queue', async () => {
  const { onRequestGet } = await import('../functions/api/ois-data-requests.js');
  let databaseCalls = 0;
  const database = { prepare() { databaseCalls++; throw new Error('no database access expected'); } };
  const response = await onRequestGet({
    request: new Request('https://example.test/api/ois-data-requests?action=next_blower_batch&limit=0', {
      headers: { 'X-OIS-Agent-Key': 'fixture-agent-key', 'X-OIS-Agent-Id': 'fixture-agent' }
    }), env: { DB: database, OIS_AGENT_KEY: 'fixture-agent-key' }
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.limestoneIncrementalVersion, 8);
  assert.equal(payload.maxAdditionalClaims, 26);
  assert.equal(payload.maxCompletionItems, 27);
  assert.equal(databaseCalls, 0);
});

test('the public request API retains the exact Limestone RUN tag guard', async () => {
  const { onRequestPost } = await import('../functions/api/ois-data-requests.js');
  for (const tag of LIMESTONE) {
    let reads = 0;
    const database = { prepare(sql) {
      assert.match(sql, /FROM shift_log_sessions/);
      reads++;
      return { bind() { return this; }, async first() { return {
        employee_no: 'fixture-owner', expires_at: new Date(Date.now() + 3600000).toISOString(),
        last_used_at: new Date().toISOString(), name: 'Fixture', role: 'user', is_active: 1
      }; } };
    } };
    const response = await onRequestPost({
      request: new Request('https://example.test/api/ois-data-requests', {
        method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_blower_runtime_probe', assetTag: tag,
          dataParcTag: 'GSPOGE.ABB_DCS.WRONG_BINARY_SIGNAL', confirmRunSignal: true })
      }), env: { DB: database }
    });
    const payload = await response.json();
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.equal(payload.code, 'BLOWER_RUNTIME_PROBE_SIGNAL_REQUIRED');
    assert.equal(reads, 1);
  }
});

const NativeDate = Date;
function installFixtureClock(t) {
  let now = NativeDate.parse('2026-10-30T00:00:00.000Z');
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  t.after(() => { globalThis.Date = NativeDate; });
  return milliseconds => { now += milliseconds; };
}

function createBodyFromAsset(asset, requireAppend) {
  return {
    action: 'create_blower_runtime_probe', unifiedRefresh: true, incrementalRefresh: true,
    requireIncrementalAppend: requireAppend, assetTag: asset.tag_number,
    dataParcTag: signalFor(asset.tag_number), confirmRunSignal: true,
    startAt: asset.last_replacement_at, expectedLastReplacementAt: asset.last_replacement_at,
    expectedCycleStartState: asset.cycle_start_state,
    expectedCycleStartedAt: asset.cycle_started_at || '',
    expectedCycleStartRevision: asset.cycle_start_revision || '',
    expectedCycleRuntimeRevision: asset.cycle_runtime_revision || ''
  };
}

function collectedResult(item, seconds, startState) {
  return {
    ...item.probe, requestId: item.id, ok: true, readOnly: true,
    observedAt: item.probe.endAt, collectedAt: new Date().toISOString(),
    completedChunkCount: 1, startState, endState: 'running',
    totalRunningHours: seconds / 3600, runningSeconds: seconds,
    chunks: [{ index: 1, startAt: item.probe.startAt, endAt: item.probe.endAt,
      startState, endState: 'running', totalRunningHours: seconds / 3600, runningSeconds: seconds }]
  };
}

for (const tag of LIMESTONE) {
  test(`real API/history ${tag} creates and applies a pending-cycle delta once without replacing its first receipt`, async t => {
    const { fixture, browserCreate, agentClaim, agentComplete, callApi, BROWSER_TOKEN,
      historyPost, history } = await import('./helpers/blower-incremental-fixture.mjs');
    const advance = installFixtureClock(t);
    const f = await fixture(tag, true);
    t.after(() => f.database.close());
    f.sqlite.prepare(`UPDATE blower_history_assets SET cycle_start_state='pending',cycle_started_at=NULL,
      cycle_start_revision='pending-start-r1',cycle_runtime_hours=0,cycle_runtime_state='stopped',
      runtime_hours=0,is_running=0,cycle_runtime_anchor_at=NULL,runtime_anchor_at=NULL WHERE tag_number=?`).run(tag);
    const readAsset = () => f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
    const readRows = () => f.sqlite.prepare(`SELECT * FROM blower_history_events
      WHERE tag_number=? ORDER BY event_date DESC,updated_at DESC,created_at DESC,id DESC`).all(tag);
    const apply = requestId => callApi(historyPost, f.database,
      new Request('https://example.test/api/blower-history', {
        method: 'POST', headers: { Authorization: `Bearer ${BROWSER_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dataparc_runtime_sync', requestId })
      }));
    const firstCreate = await browserCreate(f.database, createBodyFromAsset(readAsset(), false));
    assert.equal(firstCreate.status, 201, JSON.stringify(firstCreate.body));
    const firstClaim = await agentClaim(f.database);
    assert.equal(firstClaim.status, 200, JSON.stringify(firstClaim.body));
    const firstItem = firstClaim.body.items.excel;
    assert.equal(firstItem.id, firstCreate.body.item.id);
    assert.equal(firstItem.probe.expectedCycleStartState, 'legacy');
    assert.match(firstItem.probe.expectedCycleStartRevision, /^signal-only-v1:/);
    const firstComplete = await agentComplete(f.database, firstItem.id, collectedResult(firstItem, 1001, 'stopped'));
    assert.equal(firstComplete.status, 200, JSON.stringify(firstComplete.body));
    const firstApplied = await apply(firstItem.id);
    assert.equal(firstApplied.status, 200, JSON.stringify(firstApplied.body));
    const firstRow = f.sqlite.prepare('SELECT * FROM blower_history_events WHERE id=?').get(`dataparc_runtime:${firstItem.id}`);
    const firstAsset = readAsset();
    assert.equal(firstAsset.cycle_start_state, 'pending');
    assert.equal(JSON.parse(firstRow.source_text).signalOnlyCycle, true);
    const basis = history.currentDataParcRuntimeBasis(firstAsset, readRows());
    assert.equal(basis?.appendReady, true, JSON.stringify(basis));
    assert.equal(basis.runningSeconds, 1001);

    advance(10 * 60000);
    const secondCreate = await browserCreate(f.database, createBodyFromAsset(readAsset(), true));
    assert.equal(secondCreate.status, 201, JSON.stringify(secondCreate.body));
    const secondClaim = await agentClaim(f.database);
    assert.equal(secondClaim.status, 200, JSON.stringify(secondClaim.body));
    const secondItem = secondClaim.body.items.excel;
    assert.equal(secondItem.id, secondCreate.body.item.id);
    assert.equal(secondItem.probe.startAt, firstItem.probe.endAt,
      'only the interval after the last successful observation is requested');
    assert.match(secondItem.probe.expectedCycleRuntimeRevision, /^append-v1:/);
    const secondComplete = await agentComplete(f.database, secondItem.id, collectedResult(secondItem, 67, 'running'));
    assert.equal(secondComplete.status, 200, JSON.stringify(secondComplete.body));
    const secondApplied = await apply(secondItem.id);
    assert.equal(secondApplied.status, 200, JSON.stringify(secondApplied.body));
    assert.equal(secondApplied.body.incremental, true);
    assert.equal(secondApplied.body.addedRunningSeconds, 67);
    const finalAsset = readAsset();
    assert.equal(finalAsset.cycle_start_state, 'pending');
    assert.ok(Math.abs(finalAsset.cycle_runtime_hours - 1068 / 3600) < 0.000001);
    const deltaRow = f.sqlite.prepare('SELECT * FROM blower_history_events WHERE id=?').get(`dataparc_runtime:${secondItem.id}`);
    const deltaSource = JSON.parse(deltaRow.source_text);
    assert.equal(deltaSource.runningSeconds, 67);
    assert.equal(deltaSource.incremental.baseRunningSeconds, 1001);
    assert.equal(deltaSource.incremental.totalRunningSeconds, 1068);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM blower_history_events WHERE id=?').get(firstRow.id), firstRow);
    assert.equal(history.currentDataParcRuntimeBasis(finalAsset, readRows())?.appendReady, true);

    const beforeReplay = JSON.stringify({ asset: readAsset(), rows: readRows() });
    const replay = await apply(secondItem.id);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(JSON.stringify({ asset: readAsset(), rows: readRows() }), beforeReplay,
      'repeating the apply request cannot add the 67 seconds again or rewrite either receipt');
  });
}
