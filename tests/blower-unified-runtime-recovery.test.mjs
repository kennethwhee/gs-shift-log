import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const core = require('../maintenance/blower-unified-refresh.js');
const assessment = require('../maintenance/blower-runtime-assessment.js');
const NOW = '2026-11-06T09:30:00.000Z';
const OBSERVED = '2026-11-06T09:25:00.000Z';
const ORIGIN = '2026-05-11T00:00:00+09:00';
const clone = value => structuredClone(value);
const hash = 'a'.repeat(64);
const TAGS = [
  ...['104', '204'].flatMap(prefix => ['611', '621', '631'].map(suffix => `${prefix}HHL60AP${suffix}`)),
  ...['104', '204'].flatMap(prefix => ['611', '621', '631'].map(suffix => `${prefix}HHL10AN${suffix}`)),
  '104SDF01AN001', '104SDF01AN002', '204SDF01AN001', '204SDF01AN002', '204LMDF01AN001',
  '104ETG30AN601', '104ETG30AN602', '204ETG30AN601', '204ETG30AN602',
  '104ETH03AN601', '104ETH03AN602', '103HRJ01AN601', '103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'
];

function measured(tag, { start = '2026-09-01T00:00:00+09:00', replacement = start,
  hours = 163.4, state = 'legacy', signal = `GSPOGE.ABB_DCS.${tag}XB04`, partial = false } = {}) {
  const blowerType = tag.includes('HHL60') ? 'fbhe' : tag.includes('HHL10') ? 'seal_pot'
    : tag.includes('SDF') || tag.includes('LMDF') ? 'organic_fuel' : tag.includes('ETG') ? 'flyash_bag'
    : tag.includes('ETH') ? 'flyash_silo' : 'limestone';
  if (tag === '104ETH03AN602') signal = 'GSPOGE.ABB_DCS.003ETH03AN602XB04';
  return {
    tagNumber: tag, displayName: `Fixture ${tag}`, blowerType, enabled: true,
    lastReplacementAt: replacement, actualLastReplacementAt: replacement,
    cycleStartState: state, cycleStoredStartedAt: state === 'started' ? start : '',
    cycleStartRevision: `start-${tag}`, cycleRuntimeRevision: `runtime-${tag}`,
    cycleElapsedHours: hours, runtimeHours: hours, cycleRuntimeState: 'running',
    dataParcTag: signal, measurementRequired: false, hasUnverifiedDataParcHistory: false,
    dataParcRuntimeBasis: { requestId: `base-${tag}`, dataParcTag: signal, startAt: start,
      observedAt: OBSERVED, requiredStartAt: replacement, runtimeHours: hours,
      runningSeconds: Math.round(hours * 3600), appendReady: true, coverageComplete: !partial, cycleBasisConfirmed: true },
    runtimeCoverageEvidence: { version: 1, source: 'dataparc', measurementVerified: true,
      requestId: `base-${tag}`, hours, startAt: start, observedAt: OBSERVED, firstRunVerified: false },
    ...(['fbhe', 'seal_pot'].includes(blowerType)
      ? { runRuntime: { verified: true, source: 'dataparc', state: 'running', measuredAt: OBSERVED } } : {}),
    ...(blowerType === 'limestone' && tag !== '103HRJ01AN601'
      ? { limestoneAutoApply: true, limestoneRunDisputed: false } : {})
  };
}

function role() {
  const a = measured('103HRJ01AN601', { start: '2026-09-18T14:20:00+09:00', hours: 1170.4,
    state: 'pending', partial: true });
  a.cycleSourceReview = { code: 'ROLE_PRIORITY_RUN_REBUILD', cycleBasisConfirmed: false, measuredRangeMayContinue: true };
  a.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, requiresRunRefresh: false,
    registeredBaseline: true, registeredRuntimeRange: true, clockKnown: false, rolePriorityRecoveryEligible: true,
    rolePrioritySelection: { version: 1, selectedRole: 'BCO1', timePrecision: 'minute',
      selectedSourceLogId: 'fixture-role-log', selectedSourceKey: 'fixture-role-entry',
      selectedSourceSnapshotSha256: hash, selectedWorkDate: '2026-09-18', selectedShift: 'DS',
      registeredReplacementAt: a.lastReplacementAt, selectedCompletionAt: '2026-09-18T14:24:00+09:00', requiredRebuild: true } };
  return a;
}

function bag() {
  const a = measured('104ETG30AN602', { start: '2026-10-18T08:04:00+09:00',
    replacement: '2026-09-25T14:40:00+09:00', hours: 456.7, state: 'started', partial: true,
    signal: 'GSPOGE.ABB_DCS.103ETG30AN602XJ04' });
  a.dataParcRuntimeBasis.confirmedGapRecoveryEligible = true;
  a.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, requiresRunRefresh: false,
    timePrecision: 'minute', clockKnown: true, completionClockConflict: false,
    confirmedReplacementAt: a.lastReplacementAt, confirmedClockEventId: 'fixture-clock-event',
    confirmedClockSourceSnapshotSha256: hash };
  // The real confirmed projection has no optional cycleSourceReview object.
  return a;
}

function seal(tag = '204HHL10AN611') {
  return measured(tag, { replacement: ORIGIN, partial: true,
    start: tag === '204HHL10AN611' ? '2026-05-18T18:00:00+09:00' : '2026-05-11T18:00:00+09:00',
    hours: tag === '204HHL10AN611' ? 4118.7 : 4000 });
}

function repairs() { return [role(), bag(), seal(), seal('204HHL10AN631')]; }
function tasks(assets = repairs()) { return core.plan(assets, new Date(NOW)).tasks; }
function allAssets() {
  const replacement = new Map(repairs().map(a => [a.tagNumber, a]));
  return TAGS.map(tag => replacement.get(tag) || measured(tag, { hours: tag === '204HHL60AP621' ? 1060.2 : 163.4 }));
}
function accepted(source, status = 'pending') {
  return { ok: true, atomic: true, batchVersion: 1, requestedCount: source.length,
    results: source.map(task => ({ ok: true, assetTag: task.snapshot.tagNumber,
      item: { id: `accepted-${task.snapshot.tagNumber}`, status, requestType: 'blower_runtime_probe',
        probe: { assetTag: task.snapshot.tagNumber, requestId: `accepted-${task.snapshot.tagNumber}` } } })) };
}
function applied(task, replayed = false) {
  return { ok: true, applied: !replayed, replayed, requestId: `accepted-${task.snapshot.tagNumber}`,
    assetTag: task.snapshot.tagNumber, dataParcTag: task.dataParcTag, observedAt: NOW,
    runtimeHours: task.recoveryProof?.cycleElapsedHours ?? task.asset.cycleElapsedHours,
    ...(task.recoveryMode === 'role_priority'
      ? { rolePriorityRecovery: true, selectedCompletionAt: task.startAt } : {}) };
}
function commitProjection(task, current) {
  const a = clone(current);
  a.cycleRuntimeRevision += '-repaired';
  a.dataParcRuntimeBasis = { ...a.dataParcRuntimeBasis, requestId: `accepted-${a.tagNumber}`,
    startAt: task.startAt, requiredStartAt: task.startAt, observedAt: NOW, coverageComplete: true,
    confirmedGapRecoveryEligible: false };
  a.runtimeCoverageEvidence = { ...a.runtimeCoverageEvidence, requestId: a.dataParcRuntimeBasis.requestId,
    startAt: task.startAt, observedAt: NOW, firstRunVerified: task.recoveryMode === 'seal_first_run' };
  if (a.runRuntime) a.runRuntime.measuredAt = NOW;
  delete a.cycleSourceReview;
  if (task.recoveryMode === 'role_priority') {
    a.lastReplacementAt = a.actualLastReplacementAt = task.startAt;
    a.cycleStartState = 'legacy'; a.cycleStartRevision += '-repaired';
    a.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, clockKnown: true,
      registeredBaseline: true, requiresRunRefresh: false, rolePriorityRecoveryEligible: false };
  }
  if (task.recoveryMode === 'seal_first_run') a.dataParcRuntimeBasis.firstRunStartedAt = '2026-05-18T18:01:22+09:00';
  return a;
}

function scenario(source = tasks(), config = {}) {
  let now = 0, checkpoint;
  const calls = [], checkpoints = [], current = new Map(source.map(task => [task.snapshot.tagNumber, clone(task.asset)]));
  const io = {
    clock: () => now, sleep: async ms => { now += ms; }, progress() {},
    assertWritable() { config.assertWritable?.(); },
    currentAssetFor: tag => current.get(tag) || null,
    runtimeCheckpoint(value) { checkpoint = clone(value); checkpoints.push(checkpoint); },
    async api(request) {
      calls.push(clone(request));
      if (request.body?.action === 'create_blower_runtime_probe_batch') {
        if (config.createError) throw config.createError;
        return clone(config.createdBatch || accepted(source));
      }
      if (request.url?.includes('action=status_batch')) {
        if (config.pollError) throw config.pollError;
        config.onPoll?.(current);
        const ids = new URL(request.url, 'https://fixture.invalid').searchParams.get('ids').split(',');
        return { items: ids.map(id => ({ id, status: config.statusFor?.(id, now) || 'complete' })) };
      }
      if (['dataparc_runtime_sync', 'apply_role_priority_runtime_recovery'].includes(request.body?.action)) {
        const task = source.find(t => `accepted-${t.snapshot.tagNumber}` === request.body.requestId);
        assert.ok(task, 'only an exact accepted request may be applied');
        config.onApply?.(task, current);
        if (config.applyError) throw config.applyError;
        return config.applyReply?.(task) || applied(task, config.replayed === true);
      }
      throw new Error('Unexpected request in offline recovery fixture');
    }
  };
  return { source, config, io, calls, current, checkpoints, get now() { return now; },
    get checkpoint() { return checkpoint; },
    creates: () => calls.filter(call => call.body?.action === 'create_blower_runtime_probe_batch'),
    applies: () => calls.filter(call => ['dataparc_runtime_sync', 'apply_role_priority_runtime_recovery'].includes(call.body?.action)),
    polls: () => calls.filter(call => call.url?.includes('action=status_batch')),
    resume() { io.runtimeResume = clone(checkpoint); }, run: () => core.executeDataParcBatch(source, io) };
}

test('one 27-device plan schedules exactly four proven repairs and 23 ordinary appends without changing saved values', () => {
  const assets = allAssets(), before = clone(assets), plan = core.plan(assets, new Date(NOW));
  assert.equal(plan.targetCount, 27); assert.equal(plan.tasks.length, 27); assert.equal(plan.skipped.length, 0);
  assert.equal(new Set(plan.tasks.map(task => task.snapshot.tagNumber)).size, 27);
  const repair = plan.tasks.filter(task => task.kind === 'dataparc_repair');
  assert.deepEqual(repair.map(task => [task.snapshot.tagNumber, task.recoveryMode]).sort(), [
    ['103HRJ01AN601', 'role_priority'], ['104ETG30AN602', 'confirmed_gap'],
    ['204HHL10AN611', 'seal_first_run'], ['204HHL10AN631', 'seal_registered_range']]);
  assert.ok(repair.every(task => task.incremental === false && task.queryStartAt === task.startAt));
  assert.ok(plan.tasks.filter(task => task.kind === 'dataparc').every(task => task.incremental === true));
  assert.equal(repair.find(task => task.recoveryMode === 'role_priority').snapshot.cycleStartState, 'pending');
  assert.equal(repair.find(task => task.recoveryMode === 'confirmed_gap').asset.cycleSourceReview, undefined);
  assert.equal(repair.find(task => task.recoveryMode === 'confirmed_gap').dataParcTag, 'GSPOGE.ABB_DCS.103ETG30AN602XJ04');
  assert.deepEqual(assets, before);
});

test('partial recovery never promotes missing, stale, manual, rejected or mismatched measurement ownership', () => {
  const changes = [
    a => { delete a.hasUnverifiedDataParcHistory; }, a => { a.hasUnverifiedDataParcHistory = null; },
    a => { a.hasUnverifiedDataParcHistory = true; }, a => { a.measurementRequired = true; },
    a => { a.cycleRuntimeRevision = ''; }, a => { a.enabled = false; }, a => { a.cycleElapsedHours = null; a.runtimeHours = null; },
    a => { a.cycleElapsedHours = '456.7'; }, a => { a.cycleElapsedHours += 1; },
    a => { a.dataParcRuntimeBasis.appendReady = false; }, a => { a.dataParcRuntimeBasis.requestId = ''; },
    a => { a.dataParcRuntimeBasis.runningSeconds = 1; }, a => { a.dataParcRuntimeBasis.observedAt = '2026-11-07T00:00:00Z'; },
    a => { a.runtimeCoverageEvidence.source = 'unverified'; a.runtimeCoverageEvidence.measurementVerified = false; },
    a => { a.runtimeCoverageEvidence.requestId = 'different-owner'; }, a => { a.runtimeCoverageEvidence.observedAt = NOW; },
    a => { a.runRuntime = { verified: true, source: 'manual', measuredAt: OBSERVED }; }
  ];
  for (const mutate of changes) {
    const a = bag(); mutate(a);
    assert.equal(core.runtimeRecoveryPlan(a, NOW), null, String(mutate));
    assert.ok(tasks([a]).every(task => task.kind !== 'dataparc_repair'), String(mutate));
  }
});

test('pending is allowed only for the exact server-authorized Limestone repair with an empty stored startup', () => {
  assert.equal(core.runtimeRecoveryPlan(role(), NOW)?.recoveryMode, 'role_priority');
  const legacy = role(); legacy.cycleStartState = 'legacy';
  assert.equal(core.runtimeRecoveryPlan(legacy, NOW)?.recoveryMode, 'role_priority');
  for (const mutate of [
    a => { delete a.replacementAutoCycle.rolePriorityRecoveryEligible; },
    a => { a.replacementAutoCycle.rolePriorityRecoveryEligible = false; },
    a => { a.replacementAutoCycle.rolePrioritySourceRevoked = true; },
    a => { a.cycleStoredStartedAt = a.lastReplacementAt; }, a => { a.cycleStartState = 'started'; },
    a => { a.tagNumber = '203HRJ01AN601'; },
    a => { a.replacementAutoCycle.rolePrioritySelection.timePrecision = 'day'; },
    a => { a.replacementAutoCycle.rolePrioritySelection.selectedCompletionAt = a.lastReplacementAt; }
  ]) { const a = role(); mutate(a); assert.equal(core.runtimeRecoveryPlan(a, NOW), null, String(mutate)); }
  for (const a of [bag(), seal()]) { a.cycleStartState = 'pending'; assert.equal(core.runtimeRecoveryPlan(a, NOW), null); }
});

test('confirmed-gap repair requires the authoritative minute and Seal repair stays limited to two incomplete May 11 receipts', () => {
  for (const mutate of [
    a => { a.dataParcRuntimeBasis.confirmedGapRecoveryEligible = false; },
    a => { a.dataParcRuntimeBasis.cycleBasisConfirmed = false; },
    a => { a.replacementAutoCycle.completionClockConflict = true; },
    a => { a.replacementAutoCycle.timePrecision = 'day'; },
    a => { a.replacementAutoCycle.confirmedClockSourceSnapshotSha256 = ''; },
    a => { a.actualLastReplacementAt = '2026-09-25T00:00:00+09:00'; },
    a => { a.cycleSourceReview = { cycleBasisConfirmed: false }; }
  ]) { const a = bag(); mutate(a); assert.equal(core.runtimeRecoveryPlan(a, NOW), null, String(mutate)); }
  for (const mutate of [
    a => { a.tagNumber = '204HHL10AN621'; }, a => { a.cycleStartState = 'started'; },
    a => { a.lastReplacementAt = '2026-05-12T00:00:00+09:00'; },
    a => { a.dataParcRuntimeBasis.coverageComplete = true; },
    a => { a.runtimeCoverageEvidence.firstRunVerified = true; },
    a => { a.runRuntime.verified = false; }, a => { a.runRuntime.measuredAt = NOW; },
    a => { a.dataParcTag = 'GSPOGE.ABB_DCS.UNRELATED'; }
  ]) { const a = seal(); mutate(a); assert.equal(core.runtimeRecoveryPlan(a, NOW), null, String(mutate)); }
  assert.equal(core.runtimeRecoveryPlan(seal(), '2027-05-13T00:00:00+09:00'), null, 'repair queries obey the 366-day bound');
});

test('one mixed batch preserves every frozen owner and dispatches each repair through its exact apply contract', async () => {
  const source = tasks(allAssets()), before = clone(source), f = scenario(source);
  const out = await f.run();
  assert.equal(f.creates().length, 1); assert.equal(f.applies().length, 27);
  assert.ok(out.every(item => item.status === 'complete'));
  const requestByTag = new Map(f.creates()[0].body.requests.map(request => [request.assetTag, request]));
  for (const task of source) {
    const create = requestByTag.get(task.snapshot.tagNumber), s = task.snapshot;
    assert.equal(create.expectedLastReplacementAt, s.lastReplacementAt);
    assert.equal(create.expectedCycleStartState, s.cycleStartState);
    assert.equal(create.expectedCycleStartedAt, s.cycleStartedAt);
    assert.equal(create.expectedCycleStartRevision, s.cycleStartRevision);
    assert.equal(create.expectedCycleRuntimeRevision, s.cycleRuntimeRevision);
    const apply = f.applies().find(call => call.body.requestId === `accepted-${s.tagNumber}`).body;
    if (task.kind === 'dataparc_repair') {
      assert.equal(create.incrementalRefresh, false); assert.equal(create.requireIncrementalAppend, false);
      assert.equal(create.startAt, task.startAt);
      assert.equal([create.rolePriorityRecovery, create.confirmedGapRecovery, create.requireFirstRunStart, create.registeredRangeRecovery].filter(Boolean).length, 1);
      if (task.recoveryMode === 'role_priority') {
        assert.equal(create.rolePriorityRecovery, true); assert.equal(create.selectedCompletionAt, task.startAt);
        assert.deepEqual(apply, { action: 'apply_role_priority_runtime_recovery', requestId: `accepted-${s.tagNumber}` });
      } else {
        const flag = task.recoveryMode === 'confirmed_gap' ? 'confirmedGapRecovery'
          : task.recoveryMode === 'seal_registered_range' ? 'registeredRangeRecovery' : 'requireFirstRunStart';
        assert.equal(create[flag], true);
        assert.deepEqual(apply, { action: 'dataparc_runtime_sync', requestId: `accepted-${s.tagNumber}`, [flag]: true });
      }
      const result = out.find(item => item.tagNumber === s.tagNumber);
      assert.equal(result.recoveryMode, task.recoveryMode); assert.equal(result.recoveryApplied, true);
      assert.equal(result.partialRange, undefined);
    } else {
      assert.equal(create.incrementalRefresh, true); assert.equal(create.requireIncrementalAppend, true);
      assert.deepEqual(apply, { action: 'dataparc_runtime_sync', requestId: `accepted-${s.tagNumber}` });
    }
  }
  assert.deepEqual(source, before); assert.equal(f.checkpoint, null);
});

test('after a successful full repair the next latest refresh appends from its receipt without repeating recovery', () => {
  const source = tasks();
  const current = source.map(task => commitProjection(task, task.asset));
  const next = core.plan(current, new Date('2026-11-06T09:35:00.000Z'));
  assert.equal(next.tasks.length, 4); assert.equal(next.skipped.length, 0);
  assert.ok(next.tasks.every(task => task.kind === 'dataparc' && task.incremental === true && task.queryStartAt === NOW));
});

for (const [status, limit] of [['pending', 45000], ['processing', 120000]]) {
  test(`${status} recovery leaves a bounded accepted checkpoint and resumes the same mode and IDs`, async () => {
    const f = scenario(tasks(), { statusFor: () => status });
    const first = await f.run();
    assert.ok(first.every(item => item.status === 'waiting'));
    assert.ok(f.now >= limit && f.now <= limit + 2500, `wait=${f.now}`);
    assert.equal(f.creates().length, 1); assert.equal(f.applies().length, 0);
    assert.equal(f.checkpoint.runtimeRecoveryVersion, 1);
    assert.ok(f.checkpoint.tasks.every(task => task.kind === 'dataparc_repair' && task.recoveryVersion === 1));
    assert.deepEqual(f.checkpoint.createdBatch.results.map(row => row.recoveryMode), ['role_priority', 'confirmed_gap', 'seal_first_run', 'seal_registered_range']);
    f.resume(); f.config.statusFor = () => 'complete';
    const second = await f.run();
    assert.ok(second.every(item => item.status === 'complete' && item.recoveryApplied === true));
    assert.equal(f.creates().length, 1); assert.equal(f.applies().length, 4); assert.equal(f.checkpoint, null);
  });
}

test('a lost role apply response resumes the accepted receipt after its own boundary/revisions change, never reruns collection', async () => {
  const source = tasks([role()]);
  const f = scenario(source, { applyError: Object.assign(new Error('reply lost'), { status: 504 }),
    onApply(task, current) { current.set(task.snapshot.tagNumber, commitProjection(task, current.get(task.snapshot.tagNumber))); } });
  const first = await f.run();
  assert.equal(first[0].status, 'waiting'); assert.equal(first[0].recoveryApplied, undefined);
  assert.ok(f.checkpoint); assert.equal(f.checkpoint.outcomes.length, 0);
  f.resume(); f.config.applyError = null; f.config.onApply = null; f.config.replayed = true;
  const second = await f.run();
  assert.equal(second[0].status, 'complete'); assert.equal(second[0].recoveryMode, 'role_priority');
  assert.equal(second[0].recoveryApplied, false); assert.equal(second[0].unchanged, true);
  assert.equal(f.creates().length, 1);
  assert.deepEqual(f.applies().map(call => call.body), Array(2).fill({ action: 'apply_role_priority_runtime_recovery', requestId: 'accepted-103HRJ01AN601' }));
});

test('checkpoint mode/proof corruption cannot downgrade a repair into an ordinary query or sync', async () => {
  const base = scenario(tasks([role()]), { statusFor: () => 'pending' });
  await base.run();
  for (const mutate of [
    cp => { delete cp.runtimeRecoveryVersion; }, cp => { cp.runtimeRecoveryVersion = 2; },
    cp => { delete cp.tasks[0].recoveryMode; }, cp => { cp.tasks[0].recoveryMode = 'confirmed_gap'; },
    cp => { cp.tasks[0].kind = 'dataparc'; }, cp => { cp.tasks[0].incremental = true; },
    cp => { cp.tasks[0].startAt = cp.tasks[0].snapshot.lastReplacementAt; },
    cp => { cp.tasks[0].recoveryProof.replacementAutoCycle.rolePriorityRecoveryEligible = false; },
    cp => { cp.tasks[0].snapshot.cycleRuntimeRevision = 'different'; },
    cp => { delete cp.createdBatch.results[0].recoveryMode; },
    cp => { cp.createdBatch.results[0].recoveryMode = 'seal_first_run'; }
  ]) {
    const cp = clone(base.checkpoint); mutate(cp);
    const f = scenario(tasks([role()])); f.io.runtimeResume = cp;
    await assert.rejects(f.run, error => error.code === 'BLOWER_RUNTIME_RECOVERY_INVALID', String(mutate));
    assert.equal(f.calls.length, 0, 'no downgraded create, poll or apply');
  }
});

test('proof edits and current-owner changes invalidate automatic recovery before creation or just before apply', async () => {
  const mutations = [
    a => { a.cycleRuntimeRevision += '-manual'; },
    a => { a.replacementAutoCycle.rolePrioritySelection.selectedSourceSnapshotSha256 = 'b'.repeat(64); },
    a => { a.replacementAutoCycle.rolePrioritySelection.selectedShift = 'NS'; },
    a => { a.runtimeHours += 1; a.cycleElapsedHours += 1; }
  ];
  for (const mutate of mutations) {
    const source = tasks([role()]), beforeCreate = scenario(source);
    mutate(beforeCreate.current.get(source[0].snapshot.tagNumber));
    await assert.rejects(beforeCreate.run, error => error.code === 'BLOWER_RUNTIME_RECOVERY_CHANGED');
    assert.equal(beforeCreate.calls.length, 0);
    const during = scenario(source, { onPoll(current) { mutate(current.get(source[0].snapshot.tagNumber)); } });
    const out = await during.run();
    assert.equal(out[0].status, 'skipped'); assert.equal(during.creates().length, 1); assert.equal(during.applies().length, 0);
  }
});

test('a competing receipt cannot use the own-repair replay exception', async () => {
  const source = tasks([role()]), f = scenario(source, { statusFor: () => 'pending' });
  await f.run(); f.resume();
  const current = commitProjection(source[0], f.current.get(source[0].snapshot.tagNumber));
  current.dataParcRuntimeBasis.requestId = 'competing-request';
  f.current.set(current.tagNumber, current); f.config.statusFor = () => 'complete';
  const out = await f.run();
  assert.equal(out[0].status, 'skipped'); assert.equal(f.creates().length, 1); assert.equal(f.applies().length, 0);
});

test('read-only access and session expiry stop recovery without a mutation fallback', async () => {
  const denied = Object.assign(new Error('write access changed'), { code: 'WRITE_ACCESS_CHANGED' });
  const fresh = scenario(tasks([bag()]), { assertWritable() { throw denied; } });
  await assert.rejects(fresh.run, error => error === denied); assert.equal(fresh.calls.length, 0);
  const poll = scenario(tasks([bag()]), { pollError: Object.assign(new Error('login expired'), { status: 401 }) });
  await assert.rejects(poll.run, error => error.status === 401); assert.equal(poll.applies().length, 0);
  let expired = false;
  const apply = scenario(tasks([bag()]), { onApply() { expired = true; }, assertWritable() { if (expired) throw denied; } });
  await assert.rejects(apply.run, error => error === denied);
  assert.equal(apply.applies().length, 1); assert.ok(apply.checkpoint); assert.equal(apply.checkpoint.outcomes.length, 0);
});

test('uncertain create and explicit server rejection never retry or fall back to unflagged ordinary sync', async () => {
  const create = scenario(tasks(), { createError: Object.assign(new Error('response lost'), { status: 503 }) });
  await assert.rejects(create.run, error => error.code === 'CREATE_RESULT_UNCONFIRMED');
  assert.equal(create.creates().length, 1); assert.equal(create.applies().length, 0); assert.equal(create.checkpoints.length, 0);
  const rejected = scenario(tasks(), { applyError: Object.assign(new Error('proof changed'), { status: 409 }) });
  const out = await rejected.run();
  assert.ok(out.every(item => item.status === 'failed' && item.recoveryApplied !== true));
  assert.equal(rejected.creates().length, 1); assert.equal(rejected.applies().length, 4);
  assert.ok(rejected.applies().filter(call => call.body.action === 'dataparc_runtime_sync')
    .every(call => call.body.confirmedGapRecovery === true || call.body.requireFirstRunStart === true || call.body.registeredRangeRecovery === true));
});

test('repair create must return an accepted full-query ID, never an up-to-date shortcut', async () => {
  const source = tasks([bag()]), response = accepted(source);
  response.results[0] = { ok: true, assetTag: source[0].snapshot.tagNumber, upToDate: true };
  const f = scenario(source, { createdBatch: response });
  await assert.rejects(f.run, error => error.code === 'CREATE_BATCH_RESPONSE_MISMATCH');
  assert.equal(f.applies().length, 0); assert.equal(f.checkpoints.length, 0);
});

test('an incomplete or mismatched successful HTTP response remains unconfirmed and retains the exact repair ID', async () => {
  for (const mutate of [
    reply => { delete reply.applied; }, reply => { reply.requestId = 'other'; },
    reply => { reply.assetTag = 'other'; }, reply => { reply.runtimeHours = null; },
    reply => { reply.incremental = true; }, reply => { reply.observedAt = '2026-11-01T00:00:00Z'; },
    reply => { reply.rolePriorityRecovery = false; }, reply => { reply.selectedCompletionAt = '2026-09-18T14:20:00+09:00'; }
  ]) {
    const f = scenario(tasks([role()]), { applyReply(task) { const reply = applied(task); mutate(reply); return reply; } });
    const out = await f.run();
    assert.equal(out[0].status, 'waiting', String(mutate)); assert.equal(out[0].recoveryApplied, undefined);
    assert.equal(f.checkpoint.createdBatch.results[0].recoveryMode, 'role_priority');
    assert.equal(f.checkpoint.outcomes.length, 0); assert.equal(f.applies().length, 1);
  }
});

test('the cleaner partial label preserves review counts, measured zero and missing-value semantics', () => {
  const input = { tagNumber: '104ETG30AN602', enabled: true, hours: 456.7, provenance: 'measured',
    wholeCycleVerified: false, coverage: { complete: false, startAt: bag().dataParcRuntimeBasis.startAt,
      requiredStartAt: bag().lastReplacementAt, observedAt: OBSERVED, missingLeadingSeconds: 1963440 },
    review: { key: 'leading-gap' }, operation: { state: 'stopped', observedAt: OBSERVED }, referenceObservedAt: OBSERVED };
  const result = assessment.assess(input);
  assert.equal(result.scopeLabel, '확인 구간 누적'); assert.equal(result.scope, 'partial');
  assert.equal(result.hours, 456.7); assert.equal(result.requiresReview, true);
  assert.equal(result.reviewGroup, 'range'); assert.equal(result.wholeCycleVerified, false);
  const zero = assessment.assess({ ...input, hours: 0 }), missing = assessment.assess({ ...input, hours: null });
  assert.equal(zero.hours, 0); assert.equal(zero.scopeLabel, '확인 구간 누적');
  assert.equal(missing.hours, null); assert.equal(missing.scope, 'pending');
  const counts = assessment.summarize([result, zero, missing]);
  assert.equal(counts.requiresReview, 3);
});

function historyFixture(config = {}) {
  const nodes = new Map(), calls = [], toasts = [];
  const fresh = allAssets().sort((a, b) => a.tagNumber.localeCompare(b.tagNumber));
  const planned = new Map(tasks(fresh).map(task => [task.snapshot.tagNumber, task]));
  const committed = new Map(fresh.map(a => [a.tagNumber, clone(a)]));
  const node = () => ({ value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    required: false, open: false, dataset: {}, title: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {},
    replaceChildren() {}, focus() {}, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; } });
  const context = vm.createContext({ console, Date, clearTimeout() {}, performance: { now: () => 0 },
    HTMLButtonElement: class {}, navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, BlowerRuntimeAssessment: assessment,
      matchMedia: () => ({ matches: config.mobile === true }),
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setTimeout(fn) { fn(); },
      setInterval() { return 1; }, clearInterval() {}, addEventListener() {} } });
  const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui={state,elements,cacheElements,refreshAllBlowers};
    globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;getSessionToken=()=> 'fixture-recovery-session';
      currentServerDate=()=>new Date('${NOW}');showToast=h.toast;setBusy=v=>{state.busy=v;};
      startUnifiedRefreshFeedback=()=>{};finishUnifiedRefreshFeedback=()=>{};
      renderAssets=()=>{};renderOverviewRefreshPanel=()=>{};};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets: fresh.map(a => ({ ...clone(a), cycleStartRevision: 'old-display-start',
    cycleRuntimeRevision: 'old-display-runtime' })), events: [], permissions: { canWrite: config.public !== true },
    user: { name: 'Offline fixture', employeeNo: 'fixture-owner' }, backfill: { hasRun: true, status: 'complete' },
    settings: {}, types: [], missingSlots: [], missingTags: [], replacementNormalizationVersion: 4 };
  context.hooks({ toast: text => toasts.push(text),
    async load(options) {
      calls.push({ action: 'reload', options: clone(options) });
      ui.state.data = { ...ui.state.data, assets: [...committed.values()].map(clone) };
      return ui.state.data;
    },
    async api(request) {
      calls.push(clone(request));
      const action = request.body?.action;
      if (action === 'latest_logs_step') return { ok: true, version: 'bounded-logs-v1',
        replacementAutoVersion: 3, normalizationVersion: 4, phase: request.body.phase,
        done: true, nextCursor: null, scannedLogCount: 1, insertedCount: 0, appliedStateChanges: 0,
        window: { fromDate: '2026-10-01', endDate: '2026-11-06', snapshotAt: NOW } };
      if (request.url?.includes('action=refresh_state_page')) {
        const cursor = new URL(request.url, 'https://fixture.invalid').searchParams.get('cursor');
        const remaining = fresh.filter(a => !cursor || a.tagNumber > cursor), page = remaining.slice(0, 2);
        return { ok: true, version: 'blower-refresh-state-page-v1', generatedAt: NOW,
          permissions: { canWrite: true }, assets: page.map(clone), done: remaining.length <= 2,
          nextCursor: remaining.length <= 2 ? null : page.at(-1).tagNumber };
      }
      if (action === 'create_blower_runtime_probe_batch') {
        config.afterCreate?.(ui);
        return accepted([...planned.values()], 'complete');
      }
      if (['dataparc_runtime_sync', 'apply_role_priority_runtime_recovery'].includes(action)) {
        const tag = request.body.requestId.replace('accepted-', ''), task = planned.get(tag);
        assert.ok(task);
        if (task.kind === 'dataparc_repair') committed.set(tag, commitProjection(task, committed.get(tag)));
        return applied(task);
      }
      throw new Error(`Unexpected real-controller fixture request: ${action || request.url}`);
    }
  });
  return { ui, calls, toasts, fresh,
    creates: () => calls.filter(call => call.body?.action === 'create_blower_runtime_probe_batch'),
    applies: () => calls.filter(call => ['dataparc_runtime_sync', 'apply_role_priority_runtime_recovery'].includes(call.body?.action)) };
}

test('the real Latest controller creates all 27 requests once, applies four repair modes and rereads committed state once', async () => {
  const f = historyFixture();
  await f.ui.refreshAllBlowers();
  assert.equal(f.creates().length, 1, f.toasts.join('\n'));
  assert.equal(f.creates()[0].body.requests.length, 27);
  const requests = f.creates()[0].body.requests;
  assert.equal(requests.filter(body => body.rolePriorityRecovery === true).length, 1);
  assert.equal(requests.filter(body => body.confirmedGapRecovery === true).length, 1);
  assert.equal(requests.filter(body => body.requireFirstRunStart === true).length, 1);
  assert.equal(requests.filter(body => body.registeredRangeRecovery === true).length, 1);
  assert.equal(requests.filter(body => body.incrementalRefresh === true).length, 23);
  assert.ok(requests.every(body => body.expectedCycleRuntimeRevision !== 'old-display-runtime'));
  assert.equal(f.applies().length, 27);
  assert.equal(f.applies().filter(call => call.body.action === 'apply_role_priority_runtime_recovery').length, 1);
  assert.equal(f.ui.state.unifiedRefreshResults.length, 27);
  assert.ok(f.ui.state.unifiedRefreshResults.every(item => item.status === 'complete'));
  assert.equal(f.ui.state.unifiedRefreshResults.filter(item => item.recoveryApplied === true).length, 4);
  assert.equal(Object.keys(f.ui.state.unifiedRefreshAppliedRequests).length, 27);
  assert.match(f.ui.elements.unifiedRefreshSummary.textContent, /반영 27대 · 보완 반영 4대/);
  assert.equal(f.calls.filter(call => call.action === 'reload').length, 1);
  const roleNow = f.ui.state.data.assets.find(a => a.tagNumber === '103HRJ01AN601');
  assert.equal(roleNow.lastReplacementAt, role().replacementAutoCycle.rolePrioritySelection.selectedCompletionAt);
  assert.equal(roleNow.dataParcRuntimeBasis.requestId, 'accepted-103HRJ01AN601');
  assert.equal(f.ui.state.unifiedRefreshBusy, false); assert.equal(f.ui.state.busy, false);
});

test('the real Latest controller keeps public/mobile paths read-only and refuses a second busy admission', async () => {
  for (const config of [{ public: true }, { mobile: true }]) {
    const f = historyFixture(config); await f.ui.refreshAllBlowers();
    assert.equal(f.creates().length, 0); assert.equal(f.applies().length, 0);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action, 'reload');
    assert.equal(f.calls[0].options.syncOperations, false);
  }
  const f = historyFixture(); f.ui.state.unifiedRefreshBusy = true;
  await f.ui.refreshAllBlowers(); assert.equal(f.calls.length, 0);
});

test('the real Latest controller stops before repair apply when write access changes after atomic create', async () => {
  const f = historyFixture({ afterCreate(ui) { ui.state.data.permissions.canWrite = false; } });
  await f.ui.refreshAllBlowers();
  assert.equal(f.creates().length, 1); assert.equal(f.applies().length, 0);
  assert.equal(f.ui.state.unifiedRefreshInlineOutcome, 'failed');
  assert.equal(f.ui.state.unifiedRefreshResults.some(item => item.recoveryApplied === true), false);
  assert.equal(f.ui.state.unifiedRefreshBusy, false); assert.equal(f.ui.state.busy, false);
});
