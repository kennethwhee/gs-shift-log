import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scheduledRuntimeRecoveryMetadata } from '../functions/_shared/blower-scheduled-recovery-v1.js';

const require = createRequire(import.meta.url);
const scheduler = require('../maintenance/blower-schedule-v1.js');
const core = require('../maintenance/blower-unified-refresh.js');
const NOW = '2026-11-06T15:05:00.000Z', PREVIOUS = '2026-11-06T15:01:00.000Z';
const TIMING = { intervalHours: 24, startTime: '00:00', timeZone: 'Asia/Seoul' };
const DEVICE = 'a'.repeat(64), HASH = 'b'.repeat(64), DAY = 86400000;
const MODES = {
  role_priority: { tag: '103HRJ01AN601', signal: 'GSPOGE.ABB_DCS.103HRJ01AN601XB04',
    prefix: 'role-priority-recovery-v1:', start: '2026-09-18T05:24:00.000Z', owner: '2026-09-18T05:20:00.000Z' },
  confirmed_gap: { tag: '104ETG30AN602', signal: 'GSPOGE.ABB_DCS.103ETG30AN602XJ04',
    prefix: 'coverage-recovery-v1:', start: '2026-09-25T05:40:00.000Z' },
  seal_first_run: { tag: '204HHL10AN611', signal: 'GSPOGE.ABB_DCS.204HHL10AN611XB04',
    prefix: 'coverage-recovery-v1:', start: '2026-05-10T15:00:00.000Z' },
  completion_window_zero: { tag: '204HHL60AP631', signal: 'GSPOGE.ABB_DCS.204HHL60AP631XB04',
    prefix: 'completion-window-recovery-v1:', start: '2026-09-16T00:23:00.000Z',
    owner: '2026-09-15T15:00:00.000Z', end: '2026-09-16T15:00:00.000Z' }
};
const iso = value => new Date(value).toISOString();
const clone = value => structuredClone(value);
const fault = (code, status = 409) => Object.assign(new Error(code), { code, status });
const receiptKey = () => scheduler.RECEIPT_KEY + '.operator';

function savedIntent(mode, patch = {}) {
  const m = MODES[mode];
  const signalOnly = ['role_priority', 'completion_window_zero'].includes(mode);
  return { request_id: 'accepted-' + m.tag, schema_version: 1, asset_tag: m.tag, dataparc_tag: m.signal,
    window_start: m.start, window_end: m.end || NOW, expected_last_replacement_at: m.owner || m.start,
    expected_cycle_start_state: mode === 'confirmed_gap' ? 'started' : 'legacy',
    expected_cycle_started_at: mode === 'confirmed_gap' ? '2026-10-17T23:04:00.000Z' : '',
    expected_cycle_start_revision: (signalOnly ? 'signal-only-v1:' : '') + 'saved-start-revision',
    expected_cycle_runtime_revision: m.prefix + 'saved-runtime-revision',
    reuse_key: m.prefix + (m.prefix === 'coverage-recovery-v1:' ? mode + ':' : '') +
      (signalOnly ? 'signal-only-v1:' : '') + HASH, ...patch };
}

function requestDetail(row) {
  return { id: row.request_id, requestType: 'blower_runtime_probe', status: 'complete',
    targetDate: `v1|${row.asset_tag}|${row.window_start}|${row.window_end}`,
    probe: { requestId: row.request_id, requestType: 'blower_runtime_probe', schemaVersion: 1, readOnly: true,
      assetTag: row.asset_tag, dataParcTag: row.dataparc_tag, startAt: row.window_start, endAt: row.window_end,
      expectedLastReplacementAt: row.expected_last_replacement_at,
      expectedCycleStartState: row.expected_cycle_start_state, expectedCycleStartedAt: row.expected_cycle_started_at,
      expectedCycleStartRevision: row.expected_cycle_start_revision,
      expectedCycleRuntimeRevision: row.expected_cycle_runtime_revision, ...scheduledRuntimeRecoveryMetadata(row) } };
}

function measured(tag, { start = '2026-09-01T00:00:00+09:00', replacement = start, state = 'legacy',
  hours = 100, partial = false, signal = `GSPOGE.ABB_DCS.${tag}XB04` } = {}) {
  const blowerType = tag.includes('HHL60') ? 'fbhe' : tag.includes('HHL10') ? 'seal_pot'
    : tag.includes('SDF') || tag.includes('LMDF') ? 'organic_fuel' : tag.includes('ETG') ? 'flyash_bag'
    : tag.includes('ETH') ? 'flyash_silo' : 'limestone';
  if (tag === '104ETH03AN602') signal = 'GSPOGE.ABB_DCS.003ETH03AN602XB04';
  return { tagNumber: tag, displayName: tag, blowerType, enabled: true, lastReplacementAt: replacement,
    actualLastReplacementAt: replacement, cycleStartState: state, cycleStoredStartedAt: state === 'started' ? start : '',
    cycleStartRevision: 'start-' + tag, cycleRuntimeRevision: 'runtime-' + tag, cycleElapsedHours: hours, runtimeHours: hours,
    cycleRuntimeState: 'running', dataParcTag: signal, measurementRequired: false, hasUnverifiedDataParcHistory: false,
    dataParcRuntimeBasis: { requestId: 'base-' + tag, dataParcTag: signal, startAt: start, observedAt: PREVIOUS,
      requiredStartAt: replacement, runtimeHours: hours, runningSeconds: hours * 3600, appendReady: true,
      coverageComplete: !partial, cycleBasisConfirmed: true },
    runtimeCoverageEvidence: { version: 1, source: 'dataparc', measurementVerified: true, requestId: 'base-' + tag,
      hours, startAt: start, observedAt: PREVIOUS, firstRunVerified: false },
    ...(['fbhe', 'seal_pot'].includes(blowerType)
      ? { runRuntime: { verified: true, source: 'dataparc', state: 'running', measuredAt: PREVIOUS } } : {}),
    ...(blowerType === 'limestone' && tag !== '103HRJ01AN601' ? { limestoneAutoApply: true, limestoneRunDisputed: false } : {}) };
}

function repairs() {
  const role = measured(MODES.role_priority.tag, { start: MODES.role_priority.owner, state: 'pending', partial: true });
  role.cycleSourceReview = { code: 'ROLE_PRIORITY_RUN_REBUILD', cycleBasisConfirmed: false, measuredRangeMayContinue: true };
  role.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, requiresRunRefresh: false,
    registeredBaseline: true, registeredRuntimeRange: true, clockKnown: false, rolePriorityRecoveryEligible: true,
    rolePrioritySelection: { version: 1, selectedRole: 'BCO1', timePrecision: 'minute',
      selectedSourceLogId: 'approved-role-log', selectedSourceKey: 'approved-role-entry',
      selectedSourceSnapshotSha256: HASH, selectedWorkDate: '2026-09-18', selectedShift: 'DS',
      registeredReplacementAt: role.lastReplacementAt, selectedCompletionAt: MODES.role_priority.start, requiredRebuild: true } };
  const bag = measured(MODES.confirmed_gap.tag, { start: '2026-10-17T23:04:00.000Z', replacement: MODES.confirmed_gap.start,
    state: 'started', partial: true, signal: MODES.confirmed_gap.signal });
  bag.dataParcRuntimeBasis.confirmedGapRecoveryEligible = true;
  bag.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, requiresRunRefresh: false,
    timePrecision: 'minute', clockKnown: true, completionClockConflict: false, confirmedReplacementAt: bag.lastReplacementAt,
    confirmedClockEventId: 'approved-bag-clock', confirmedClockSourceSnapshotSha256: HASH };
  const seals = ['204HHL10AN611', '204HHL10AN631'].map(tag => measured(tag, { partial: true,
    replacement: MODES.seal_first_run.start, start: tag.endsWith('611') ? '2026-05-18T09:00:00.000Z' : '2026-05-11T09:00:00.000Z' }));
  return [role, bag, ...seals];
}

function allAssets() {
  const tags = [...['104', '204'].flatMap(prefix => ['611', '621', '631'].flatMap(suffix =>
    [`${prefix}HHL60AP${suffix}`, `${prefix}HHL10AN${suffix}`])),
  '104SDF01AN001', '104SDF01AN002', '204SDF01AN001', '204SDF01AN002', '204LMDF01AN001',
  '104ETG30AN601', '104ETG30AN602', '204ETG30AN601', '204ETG30AN602', '104ETH03AN601', '104ETH03AN602',
  '103HRJ01AN601', '103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'];
  const special = new Map(repairs().map(asset => [asset.tagNumber, asset]));
  return tags.map(tag => special.get(tag) || measured(tag));
}

function fixture(options = {}) {
  const f = { mono: 0, base: Date.parse(NOW), identity: { token: 'same-user-session', employeeNo: 'operator' },
    assets: allAssets(), calls: [], requests: new Map(), slots: new Map(), applied: new Set(), storageData: new Map(),
    finishAfterMs: 130000, failureOnce: false, states: [], counter: 0, ...options };
  f.storageData.set(scheduler.DEVICE_KEY, DEVICE);
  f.storage = { getItem: key => f.storageData.get(key) ?? null, setItem: (key, value) => f.storageData.set(key, value),
    removeItem: key => f.storageData.delete(key) };
  f.now = () => f.base + f.mono;
  f.advance = ms => { f.mono += ms; };
  const envelope = value => ({ ok: true, version: scheduler.VERSION, serverNow: iso(f.now()), ...value });
  const status = () => { const slot = iso(scheduler.slotAt(f.now(), TIMING));
    return envelope({ enabled: true, thisDevice: true, revision: 1, timing: TIMING,
      nextSlotAt: iso(Date.parse(slot) + DAY), dueSlotAt: f.slots.has(slot) ? null : slot }); };
  f.api = async config => {
    f.calls.push(clone(config));
    f.beforeApi?.(config);
    const body = config.body || {}, url = new URL(config.url, 'https://fixture.invalid');
    if (body.action === 'scheduled_refresh') {
      if (body.operation === 'status') return status();
      if (body.operation === 'claim') {
        assert.equal(f.slots.has(body.slotKey), false);
        const row = { slotKey: body.slotKey, runToken: body.runToken, employeeNo: 'operator',
          claimedAt: iso(f.now()), state: 'running', batchReceipt: null };
        f.slots.set(row.slotKey, row); return envelope({ acquired: true, ...row });
      }
      const row = f.slots.get(body.slotKey);
      if (!row || row.runToken !== body.runToken || row.employeeNo !== f.identity.employeeNo) throw fault('run_not_owned', 403);
      if (body.operation === 'check') return envelope({ allowed: true, purpose: body.purpose, ...row });
      if (body.operation === 'finish') {
        Object.assign(row, { state: body.status, targetCount: body.targetCount, completedCount: body.completedCount,
          failedCount: body.failedCount }); return envelope(row);
      }
    }
    if (body.action === 'latest_logs_step') return { ok: true, version: 'bounded-logs-v1', phase: body.phase,
      done: true, scannedLogCount: 0, window: body.window || { fromDate: '2026-11-06', endDate: '2026-11-07', snapshotAt: NOW } };
    if (url.searchParams.get('action') === 'refresh_state_page') {
      const cursor = url.searchParams.get('cursor') || '', remaining = f.assets.filter(a => a.tagNumber > cursor)
        .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber)), assets = remaining.slice(0, 2), done = remaining.length <= 2;
      return { ok: true, version: 'blower-refresh-state-page-v1', user: { employeeNo: 'operator' },
        permissions: { canWrite: true }, assets, generatedAt: iso(f.now()), done, nextCursor: done ? null : assets.at(-1).tagNumber };
    }
    if (body.action === 'create_blower_runtime_probe_batch') {
      const slot = f.slots.get(body.scheduledRefresh.slotKey);
      assert.equal(slot.batchReceipt, null, 'an accepted schedule may create only once');
      const results = body.requests.map(request => {
        const mode = request.rolePriorityRecovery === true ? 'role_priority' : request.confirmedGapRecovery === true ? 'confirmed_gap'
          : request.requireFirstRunStart === true ? 'seal_first_run' : request.completionWindowRecovery === true ? 'completion_window_zero' : '';
        const pending = request.expectedCycleStartState === 'pending';
        const row = { ...(mode ? savedIntent(mode) : {}), request_id: 'accepted-' + request.assetTag, schema_version: 1,
          asset_tag: request.assetTag, dataparc_tag: request.dataParcTag, window_start: request.startAt,
          window_end: iso(f.now()), expected_last_replacement_at: request.expectedLastReplacementAt,
          expected_cycle_start_state: pending ? 'legacy' : request.expectedCycleStartState,
          expected_cycle_started_at: request.expectedCycleStartedAt,
          expected_cycle_start_revision: (pending ? 'signal-only-v1:' : '') + request.expectedCycleStartRevision,
          expected_cycle_runtime_revision: (mode ? MODES[mode].prefix : '') + request.expectedCycleRuntimeRevision,
          ...(!mode ? { reuse_key: 'append-v1:' + HASH } : {}) };
        const item = requestDetail(row);
        f.requests.set(item.id, { item, mode, request: clone(request) });
        return { ok: true, assetTag: item.probe.assetTag, item: { ...item, status: 'processing' } };
      });
      slot.batchReceipt = { version: 1, requestedCount: results.length,
        items: results.map(row => ({ id: row.item.id, assetTag: row.assetTag })), upToDateTags: [] };
      if (f.loseCreateResponse) throw fault('lost_create_response', 0);
      return { ok: true, atomic: true, batchVersion: 1, requestedCount: results.length, results };
    }
    if (url.searchParams.get('action') === 'status_batch') return { ok: true,
      items: url.searchParams.get('ids').split(',').map(id => ({ id, requestType: 'blower_runtime_probe',
        status: f.mono >= f.finishAfterMs ? 'complete' : 'processing' })) };
    if (url.pathname === '/api/ois-data-requests' && url.searchParams.has('id')) {
      const item = clone(f.requests.get(url.searchParams.get('id'))?.item);
      f.mutateDetail?.(item); return { ok: true, item };
    }
    if (['dataparc_runtime_sync', 'apply_role_priority_runtime_recovery', 'apply_completion_window_runtime_recovery'].includes(body.action)) {
      const accepted = f.requests.get(body.requestId); assert.ok(accepted, 'apply must use an original accepted request');
      const mode = accepted.mode;
      const requiredAction = mode === 'role_priority' ? 'apply_role_priority_runtime_recovery'
        : mode === 'completion_window_zero' ? 'apply_completion_window_runtime_recovery' : 'dataparc_runtime_sync';
      assert.equal(body.action, requiredAction, 'repair cannot downgrade to ordinary sync');
      assert.equal(body.confirmedGapRecovery === true, mode === 'confirmed_gap');
      assert.equal(body.requireFirstRunStart === true, mode === 'seal_first_run');
      if (f.rejectApply) throw fault(f.rejectApply);
      const replayed = f.applied.has(body.requestId); f.applied.add(body.requestId);
      if (f.failureOnce) { f.failureOnce = false; throw fault('acknowledgement_lost', 503); }
      const probe = accepted.item.probe;
      const result = { ok: true, applied: !replayed, replayed, requestId: body.requestId, assetTag: probe.assetTag,
        dataParcTag: probe.dataParcTag, runtimeHours: 100, observedAt: probe.endAt,
        ...(mode === 'role_priority' ? { rolePriorityRecovery: true, selectedCompletionAt: probe.startAt } : {}),
        ...(mode === 'completion_window_zero' ? { completionWindowRecovery: true, certificateOnly: true,
          observedAt: PREVIOUS, verifiedWindowStartAt: probe.startAt, verifiedWindowEndAt: probe.endAt } : {}) };
      f.mutateApply?.(result); return result;
    }
    throw new Error('Unexpected API: ' + config.url);
  };
  f.reload = () => { f.controller = scheduler.createController({ core, storage: f.storage, api: f.api,
    identity: () => f.identity, clock: f.now, monotonicNow: () => f.mono, sleep: async ms => f.advance(ms),
    randomKey: () => (++f.counter).toString(16).padStart(64, '0'), onState: value => f.states.push(value),
    locks: { async request(_name, _options, callback) { return callback({ name: scheduler.LOCK_NAME }); } } }); };
  f.reload();
  f.seed = (modes = Object.keys(MODES)) => {
    f.finishAfterMs = 0;
    const items = modes.map(mode => {
      const row = savedIntent(mode), item = requestDetail(row);
      f.requests.set(item.id, { item, mode }); return { id: item.id, assetTag: row.asset_tag };
    });
    const receipt = { version: 1, slotKey: iso(scheduler.slotAt(f.now(), TIMING)), runToken: 'c'.repeat(64),
      employeeNo: 'operator', claimedAt: iso(f.now()) };
    const { version: _localVersion, ...serverReceipt } = receipt;
    f.slots.set(receipt.slotKey, { ...serverReceipt, state: 'running', batchReceipt: { version: 1,
      requestedCount: items.length, items, upToDateTags: [] } });
    f.storage.setItem(receiptKey(), JSON.stringify(receipt));
    f.storage.setItem(scheduler.RECEIPT_KEY + '.owners', JSON.stringify(['operator']));
  };
  f.actions = action => f.calls.filter(call => call.body?.action === action);
  f.applies = () => f.calls.filter(call => ['dataparc_runtime_sync', 'apply_role_priority_runtime_recovery',
    'apply_completion_window_runtime_recovery'].includes(call.body?.action));
  return f;
}

test('persisted modes require the saved reuse key, wire revision, fixed signal and immutable request identity', () => {
  for (const mode of Object.keys(MODES)) {
    const row = savedIntent(mode), before = clone(row), meta = scheduledRuntimeRecoveryMetadata(row);
    assert.equal(meta.runtimeRecovery.mode, mode);
    assert.equal(meta.runtimeRecovery.requestId, row.request_id);
    assert.deepEqual(row, before);
    for (const patch of [{ reuse_key: null }, { reuse_key: 'coverage-recovery-v9:' + HASH },
      { expected_cycle_runtime_revision: 'ordinary-revision' }, { dataparc_tag: 'GSPOGE.ABB_DCS.WRONGXB04' },
      { asset_tag: '104HHL60AP621' }, { schema_version: 2 }, { window_end: row.window_start },
      { request_id: '../other' }, { expected_cycle_start_revision: '' }]) {
      assert.equal(scheduledRuntimeRecoveryMetadata({ ...row, ...patch }).runtimeRecovery.mode, 'invalid', mode + JSON.stringify(patch));
    }
  }
  assert.deepEqual(scheduledRuntimeRecoveryMetadata({ reuse_key: 'append-v1:' + HASH, expected_cycle_runtime_revision: 'ordinary' }), {});
});

test('27-device scheduled processing timeout recovers four repairs and 23 appends without re-creating the batch', async () => {
  const f = fixture(), before = clone(f.assets);
  await f.controller.tick();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  const requests = f.actions('create_blower_runtime_probe_batch')[0].body.requests;
  assert.equal(requests.length, 27);
  assert.equal(requests.filter(r => r.rolePriorityRecovery).length, 1);
  assert.equal(requests.filter(r => r.confirmedGapRecovery).length, 1);
  assert.equal(requests.filter(r => r.requireFirstRunStart).length, 2);
  assert.equal(requests.find(r => r.rolePriorityRecovery).expectedCycleStartState, 'pending');
  assert.ok(f.mono >= 130000, 'actual shared foreground deadline falls through to durable schedule recovery');
  assert.equal(f.applied.size, 27); assert.equal(f.applies().length, 27);
  assert.equal(f.actions('apply_role_priority_runtime_recovery').length, 1);
  assert.equal(f.applies().filter(call => call.body.confirmedGapRecovery).length, 1);
  assert.equal(f.applies().filter(call => call.body.requireFirstRunStart).length, 2);
  assert.equal([...f.slots.values()][0].state, 'complete');
  assert.equal(f.storage.getItem(receiptKey()), null);
  assert.deepEqual(f.assets, before, 'planning and recovery do not locally manufacture a new runtime or cycle');
});

test('a reloaded version1 receipt routes all four saved repair modes, including a certificate-only historical query', async () => {
  const f = fixture(); f.seed(); f.reload(); await f.controller.tick();
  assert.equal(f.applied.size, 4);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.equal(f.actions('latest_logs_step').length, 0);
  assert.equal(f.actions('apply_completion_window_runtime_recovery').length, 1);
  assert.equal([...f.slots.values()][0].state, 'complete');
});

test('older repair receipts without authenticated mode metadata remain pending without a generic apply', async () => {
  for (const mode of Object.keys(MODES)) {
    const f = fixture({ mutateDetail: item => { delete item.probe.runtimeRecovery; } }); f.seed([mode]);
    await f.controller.tick();
    assert.equal(f.applies().length, 0); assert.equal(f.applied.size, 0);
    assert.equal([...f.slots.values()][0].state, 'running');
    assert.ok(f.storage.getItem(receiptKey()));
    assert.equal(f.controller.snapshot().error, 'SCHEDULE_RECOVERY_INTENT_INVALID');
  }
});

test('mismatched saved mode, id, tag, signal or period aborts verification before any recovered apply', async () => {
  for (const mutate of [
    p => { p.runtimeRecovery.mode = 'unknown'; }, p => { p.runtimeRecovery.mode = 'confirmed_gap'; },
    p => { p.runtimeRecovery.requestId = 'other'; }, p => { p.runtimeRecovery.assetTag = '104ETG30AN602'; },
    p => { p.runtimeRecovery.dataParcTag = 'GSPOGE.ABB_DCS.WRONGXB04'; },
    p => { p.runtimeRecovery.startAt = '2026-01-01T00:00:00.000Z'; },
    p => { p.runtimeRecovery.endAt = '2026-01-01T00:00:00.000Z'; }, p => { p.limestoneTrackingOnly = true; },
    p => { p.schemaVersion = 9; }, p => { p.expectedCycleRuntimeRevision = 'ordinary-revision'; }
  ]) {
    const f = fixture({ mutateDetail: item => { if (item.probe.assetTag === MODES.role_priority.tag) mutate(item.probe); } });
    f.seed(); await f.controller.tick();
    assert.equal(f.applies().length, 0, String(mutate)); assert.ok(f.storage.getItem(receiptKey()));
    assert.equal(f.controller.snapshot().error, 'SCHEDULE_RECOVERY_INTENT_INVALID');
  }
});

test('lost repair acknowledgement retains the exact accepted receipt and replay uses no new query', async () => {
  const f = fixture({ failureOnce: true }); f.seed(['role_priority']);
  await f.controller.tick();
  assert.equal(f.applied.size, 1); assert.ok(f.storage.getItem(receiptKey()));
  assert.equal([...f.slots.values()][0].state, 'running');
  f.reload(); await f.controller.tick();
  assert.equal(f.applied.size, 1); assert.equal(f.applies().length, 2);
  assert.equal(new Set(f.applies().map(call => call.body.requestId)).size, 1);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.equal([...f.slots.values()][0].state, 'complete');
});

test('unverified repair success cannot finish the schedule or clear its durable receipt', async () => {
  for (const mutateApply of [r => { delete r.requestId; }, r => { r.assetTag = 'different'; },
    r => { r.applied = false; r.replayed = false; }, r => { r.incremental = true; },
    r => { r.runtimeHours = null; }, r => { r.runtimeHours = -1; }, r => { r.observedAt = PREVIOUS; },
    r => { r.rolePriorityRecovery = false; }, r => { r.selectedCompletionAt = MODES.role_priority.owner; }]) {
    const f = fixture({ mutateApply }); f.seed(['role_priority']); await f.controller.tick();
    assert.equal([...f.slots.values()][0].state, 'running', String(mutateApply));
    assert.ok(f.storage.getItem(receiptKey()));
    assert.equal(f.controller.snapshot().error, 'SCHEDULE_RECOVERY_APPLY_UNCONFIRMED');
  }
});

test('a zero-window certificate must acknowledge its exact historical bounds without pretending to refresh the tail', async () => {
  for (const mutateApply of [r => { r.certificateOnly = false; }, r => { r.completionWindowRecovery = false; },
    r => { r.verifiedWindowStartAt = MODES.completion_window_zero.owner; },
    r => { r.verifiedWindowEndAt = NOW; }, r => { r.observedAt = MODES.completion_window_zero.start; },
    r => { r.dataParcTag = MODES.role_priority.signal; }]) {
    const f = fixture({ mutateApply }); f.seed(['completion_window_zero']); await f.controller.tick();
    assert.equal([...f.slots.values()][0].state, 'running', String(mutateApply));
    assert.ok(f.storage.getItem(receiptKey()));
    assert.equal(f.controller.snapshot().error, 'SCHEDULE_RECOVERY_APPLY_UNCONFIRMED');
  }
});

test('a changed source or cycle rejected by the dedicated API remains a failed repair, never an ordinary sync', async () => {
  const f = fixture({ rejectApply: 'BLOWER_ROLE_RECOVERY_SOURCE_CHANGED' }); f.seed(['role_priority']);
  await f.controller.tick();
  assert.equal(f.applied.size, 0); assert.equal(f.actions('dataparc_runtime_sync').length, 0);
  assert.equal(f.actions('apply_role_priority_runtime_recovery').length, 1);
  assert.equal([...f.slots.values()][0].state, 'failed');
});

test('logout while reading a saved repair detail prevents any apply and preserves the receipt', async () => {
  const f = fixture(); f.seed(['role_priority']);
  f.beforeApi = config => { if (config.url.includes('/api/ois-data-requests?id=')) f.identity = null; };
  await f.controller.tick();
  assert.equal(f.applies().length, 0); assert.ok(f.storage.getItem(receiptKey()));
  assert.equal(f.controller.snapshot().phase, 'signed_out');
});
