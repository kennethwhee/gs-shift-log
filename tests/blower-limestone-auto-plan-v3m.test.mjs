import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const now = new Date('2026-11-02T13:00:00.000Z');
const signal = tag => `GSPOGE.ABB_DCS.${tag}XB04`;
const saved = [
  ['103HRJ01AN602', '2026-09-22T00:00:00+09:00', 922.1480555556, '2026-10-30T01:31:19Z'],
  ['203HRJ01AN601', '2026-05-12T00:00:00+09:00', 4080.081111111, '2026-10-30T01:34:30Z'],
  ['203HRJ01AN602', '2026-09-22T00:00:00+09:00', 921.8586111111, '2026-10-30T01:32:35Z']
];
function original(index = 0, patch = {}) {
  const [tagNumber, lastReplacementAt, cycleElapsedHours, cycleRuntimeAnchorAt] = saved[index];
  return {
    enabled: true, blowerType: 'limestone', tagNumber, displayName: tagNumber,
    lastReplacementAt, cycleElapsedHours, cycleRuntimeAnchorAt,
    cycleStartState: 'pending', cycleStartedAt: '', cycleStoredStartedAt: '',
    cycleStartRevision: 'unchanged-start', cycleRuntimeRevision: 'unchanged-runtime',
    dataParcTag: signal(tagNumber), dataParcRuntimeBasis: null,
    hasUnverifiedDataParcHistory: true, limestoneBasisConfirmed: false,
    limestoneRunDisputed: true, limestoneAutoApply: true, ...patch
  };
}
function completeBasis(a, patch = {}) {
  return { appendReady: true, startAt: a.lastReplacementAt,
    observedAt: '2026-11-02T12:00:00Z', dataParcTag: signal(a.tagNumber),
    runningSeconds: 7200, ...patch };
}
async function execute(task) {
  const calls = [];
  const result = await core.executeDataParcBatch([task], { assertWritable() {},
    api: async options => {
      calls.push(options);
      if (options.body?.action === 'create_blower_runtime_probe_batch') {
        const id = `auto-${task.snapshot.tagNumber}`;
        return { ok: true, atomic: true, batchVersion: 1, requestedCount: 1,
          results: [{ ok: true, assetTag: task.snapshot.tagNumber,
            item: { id, status: 'complete', requestType: 'blower_runtime_probe',
              probe: { assetTag: task.snapshot.tagNumber, requestId: id } } }] };
      }
      assert.equal(options.body?.action, 'dataparc_runtime_sync');
      return { ok: true, message: 'measured RUN saved' };
    } });
  assert.equal(result[0].status, 'complete');
  assert.equal(calls.length, 2);
  return calls[0].body.requests[0];
}

for (let i = 0; i < saved.length; i += 1) {
  const tag = saved[i][0];
  test(`${tag}: automatic mode rebuilds the original pending baseline without confirmation or ledger arithmetic`, async () => {
    const a = original(i), snapshot = structuredClone(a);
    const planned = core.plan([a], now,
      () => { throw new Error('browser checkpoint cannot replace server state'); },
      () => { throw new Error('separate ledger contains a gap and must not be summed'); });
    assert.equal(planned.tasks.length, 1);
    assert.equal(planned.skipped.length, 0);
    const task = planned.tasks[0];
    assert.equal(task.previewOnly, undefined);
    assert.equal(task.limestoneAutoRebuild, true);
    assert.equal(task.incremental, false);
    assert.equal(task.startAt, a.lastReplacementAt);
    assert.equal(task.queryStartAt, a.lastReplacementAt);
    assert.equal(task.snapshot.cycleStartState, 'pending');
    assert.equal(task.snapshot.cycleStartRevision, 'unchanged-start');
    assert.equal(task.snapshot.cycleRuntimeRevision, 'unchanged-runtime');
    assert.deepEqual(a, snapshot, 'planning does not reset stored hours or forge a certificate');
    const request = await execute(task);
    assert.equal(request.incrementalRefresh, false);
    assert.equal(request.requireIncrementalAppend, false);
    assert.equal(request.limestoneTrackingOnly, undefined);
    assert.equal(request.startAt, a.lastReplacementAt);
    assert.equal(request.expectedLastReplacementAt, a.lastReplacementAt);
    assert.equal(request.expectedCycleStartState, 'pending');
    assert.equal(request.expectedCycleStartedAt, '');
    assert.equal(request.expectedCycleStartRevision, a.cycleStartRevision);
    assert.equal(request.expectedCycleRuntimeRevision, a.cycleRuntimeRevision);
    assert.equal(request.runningSeconds, undefined);
    assert.equal(request.runtimeHours, undefined);
    assert.equal(request.limestoneBasisConfirmed, undefined);
  });

  test(`${tag}: a current verified full-baseline receipt appends from its exact endpoint`, async () => {
    const a = original(i, { hasUnverifiedDataParcHistory: false });
    a.dataParcRuntimeBasis = completeBasis(a);
    const planned = core.plan([a], now, () => null,
      () => { throw new Error('old ledger must not affect a measured full-baseline checkpoint'); });
    const task = planned.tasks[0];
    assert.equal(task.incremental, true);
    assert.equal(task.limestoneAutoRebuild, undefined);
    assert.equal(task.previewOnly, undefined);
    assert.equal(task.startAt, a.lastReplacementAt);
    assert.equal(task.queryStartAt, a.dataParcRuntimeBasis.observedAt);
    const request = await execute(task);
    assert.equal(request.incrementalRefresh, true);
    assert.equal(request.requireIncrementalAppend, true);
    assert.equal(request.limestoneTrackingOnly, undefined);
  });

  test(`${tag}: non-appendable, partial, mismatched and malformed prior receipts rebuild the full stored baseline`, () => {
    const a = original(i);
    for (const prior of [null,
      completeBasis(a, { appendReady: false }),
      completeBasis(a, { dataParcTag: signal('103HRJ01AN601') }),
      completeBasis(a, { startAt: '2026-10-01T00:00:00Z' }),
      completeBasis(a, { observedAt: 'not-a-timestamp' }),
      completeBasis(a, { observedAt: '2026-11-03T00:00:00Z' }),
      completeBasis(a, { observedAt: a.lastReplacementAt })]) {
      a.dataParcRuntimeBasis = prior;
      const planned = core.plan([a], now);
      assert.equal(planned.tasks.length, 1, JSON.stringify(prior));
      assert.equal(planned.tasks[0].limestoneAutoRebuild, true, JSON.stringify(prior));
      assert.equal(planned.tasks[0].incremental, false);
      assert.equal(planned.tasks[0].startAt, a.lastReplacementAt);
      assert.equal(planned.tasks[0].queryStartAt, a.lastReplacementAt);
    }
  });
}

test('a complete receipt with an equivalent timestamp representation remains appendable', () => {
  const a = original();
  a.dataParcRuntimeBasis = completeBasis(a, { startAt: new Date(a.lastReplacementAt).toISOString() });
  const task = core.plan([a], now).tasks[0];
  assert.equal(task.incremental, true);
  assert.equal(task.limestoneAutoRebuild, undefined);
});

test('a saved full receipt at the current endpoint is unchanged without a new query', () => {
  const a = original();
  a.dataParcRuntimeBasis = completeBasis(a, { observedAt: now.toISOString() });
  const planned = core.plan([a], now);
  assert.equal(planned.tasks.length, 0);
  assert.equal(planned.skipped[0].status, 'complete');
  assert.equal(planned.skipped[0].unchanged, true);
});

test('automatic mode still rejects missing and future stored baselines', () => {
  for (const patch of [{ lastReplacementAt: '' }, { lastReplacementAt: '2026-11-03T00:00:00Z' }]) {
    const planned = core.plan([original(0, patch)], now);
    assert.equal(planned.tasks.length, 0);
    assert.equal(planned.skipped.length, 1);
  }
});

test('automatic mode uses the final canonical three RUN signals despite reversed or malformed historical projections', () => {
  for (let i = 0; i < saved.length; i += 1) {
    const a = original(i, { dataParcTag: signal(saved[(i + 1) % saved.length][0]),
      limestoneSignalCandidate: 'not-a-valid-RUN-tag' });
    // A historical receipt for another equipment signal is not an append base.
    a.dataParcRuntimeBasis = completeBasis(a, { dataParcTag: a.dataParcTag });
    const planned = core.plan([a], now);
    assert.equal(planned.tasks.length, 1);
    assert.equal(planned.tasks[0].dataParcTag, signal(a.tagNumber));
    assert.equal(planned.tasks[0].limestoneAutoRebuild, true);
    assert.equal(planned.tasks[0].incremental, false);
    assert.equal(planned.tasks[0].startAt, a.lastReplacementAt);
    a.dataParcTag = 'not-a-valid-RUN-tag';
    assert.equal(core.plan([a], now).tasks[0].dataParcTag, signal(a.tagNumber));
  }
});

test('older server snapshots retain the existing held RUN tracking behavior', () => {
  for (let i = 0; i < saved.length; i += 1) {
    const a = original(i);
    delete a.limestoneAutoApply;
    const task = core.plan([a], now).tasks[0];
    assert.equal(task.previewOnly, true);
    assert.equal(task.limestoneAutoRebuild, undefined);
    assert.equal(Date.parse(task.startAt), now.getTime() - 86400000);
  }
});

test('automatic capability cannot alter the other 24 blower plans or their request flags', async () => {
  const tags = ['104HHL60AP611','104HHL60AP621','104HHL60AP631',
    '204HHL60AP611','204HHL60AP621','204HHL60AP631',
    '104HHL10AN611','104HHL10AN621','104HHL10AN631',
    '204HHL10AN611','204HHL10AN621','204HHL10AN631',
    '104SDF01AN001','104SDF01AN002','204SDF01AN001','204SDF01AN002','204LMDF01AN001',
    '104ETG30AN601','104ETG30AN602','204ETG30AN601','204ETG30AN602',
    '104ETH03AN601','104ETH03AN602','103HRJ01AN601'];
  for (const tag of tags) {
    const a = { enabled: true, tagNumber: tag, displayName: tag,
      blowerType: tag === '103HRJ01AN601' ? 'limestone' : 'organic_fuel',
      lastReplacementAt: '2026-10-01T00:00:00Z', cycleStartState: 'legacy',
      cycleStartRevision: 's', cycleRuntimeRevision: 'r', dataParcTag: signal(tag) };
    const originalTask = core.plan([a], now).tasks[0];
    const actual = core.plan([{ ...a, limestoneAutoApply: true }], now).tasks[0];
    for (const key of ['startAt', 'queryStartAt', 'incremental', 'previewOnly', 'limestoneAutoRebuild']) {
      assert.equal(actual[key], originalTask[key], `${tag} ${key}`);
    }
    const body = await execute(actual);
    assert.equal(body.incrementalRefresh, true, tag);
    assert.equal(body.requireIncrementalAppend, false, tag);
    assert.equal(body.limestoneTrackingOnly, undefined, tag);
  }
});
