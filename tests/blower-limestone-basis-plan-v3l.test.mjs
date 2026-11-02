import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../maintenance/blower-unified-refresh.js');
const now = new Date('2026-11-02T12:00:00Z');
const tags = ['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'];
const signal = tag => `GSPOGE.ABB_DCS.${tag}XB04`;
const replacement = tag => tag === '203HRJ01AN601'
  ? '2026-05-12T00:00:00+09:00' : '2026-09-22T00:00:00+09:00';

function asset(tag, patch = {}) {
  return {
    enabled: true, blowerType: 'limestone', tagNumber: tag, displayName: tag,
    lastReplacementAt: replacement(tag), cycleStartState: 'legacy',
    cycleStartedAt: '', cycleStartRevision: 'confirmed-start',
    cycleRuntimeRevision: 'confirmed-runtime', dataParcTag: signal(tag),
    dataParcRuntimeBasis: null, hasUnverifiedDataParcHistory: true,
    limestoneBasisConfirmed: true, limestoneRunDisputed: false,
    cycleElapsedHours: null, measurementRequired: true, ...patch
  };
}

function staleTrack(tag) {
  return {
    tagNumber: tag, dataParcTag: signal(tag),
    lastReplacementAt: replacement(tag), cycleStartRevision: 'old-start',
    observedAt: '2026-10-31T08:58:00Z', totalRunningSeconds: 105480
  };
}

for (const tag of tags) {
  test(`${tag}: confirmed recovery queries the full replacement cycle, excluding old checkpoint and ledger`, async () => {
    const current = asset(tag, {
      // A saved startup from the old history must not shorten recovery.
      cycleStartState: 'started', cycleStartedAt: '2026-10-01T00:00:00Z'
    });
    const original = structuredClone(current);
    let cachedReads = 0, trackingReads = 0;
    const planned = core.plan([current], now, () => {
      cachedReads += 1;
      return { startAt: replacement(tag), observedAt: '2026-10-30T01:31:19Z',
        appendReady: true, dataParcTag: signal(tag), runningSeconds: 3319733 };
    }, () => { trackingReads += 1; return staleTrack(tag); });
    assert.equal(planned.tasks.length, 1);
    assert.equal(planned.skipped.length, 0);
    const task = planned.tasks[0];
    assert.equal(task.previewOnly, undefined);
    assert.equal(task.incremental, false);
    assert.equal(task.startAt, replacement(tag));
    assert.equal(task.queryStartAt, replacement(tag));
    assert.equal(cachedReads, 0);
    assert.equal(trackingReads, 0);
    assert.deepEqual(current, original);

    const calls = [];
    const results = await core.executeDataParcBatch([task], {
      assertWritable() {}, api: async options => {
        calls.push(options);
        if (options.body?.action === 'create_blower_runtime_probe_batch') {
          const id = `recovered-${tag}`;
          return { ok: true, atomic: true, batchVersion: 1, requestedCount: 1,
            results: [{ ok: true, assetTag: tag, item: { id, status: 'complete',
              requestType: 'blower_runtime_probe', probe: { assetTag: tag, requestId: id } } }] };
        }
        assert.equal(options.body?.action, 'dataparc_runtime_sync');
        return { ok: true, message: 'confirmed cycle measured' };
      }
    });
    assert.equal(results[0].status, 'complete');
    const request = calls[0].body.requests[0];
    assert.equal(request.startAt, replacement(tag));
    assert.equal(request.requireIncrementalAppend, false);
    assert.equal(request.incrementalRefresh, true);
    assert.equal(request.limestoneTrackingOnly, undefined);
    assert.equal(request.expectedCycleStartRevision, 'confirmed-start');
    assert.equal(request.expectedCycleRuntimeRevision, 'confirmed-runtime');
    assert.equal(calls.length, 2);
  });

  test(`${tag}: a measured confirmed cycle preserves its normal incremental checkpoint`, () => {
    const basis = {
      startAt: replacement(tag), observedAt: '2026-11-02T10:00:00Z',
      dataParcTag: signal(tag), appendReady: true, runningSeconds: 1000
    };
    const planned = core.plan([asset(tag, { dataParcRuntimeBasis: basis })], now,
      () => { throw new Error('cached basis must not override the server'); },
      () => { throw new Error('old RUN ledger must not participate'); });
    assert.equal(planned.tasks.length, 1);
    assert.equal(planned.tasks[0].incremental, true);
    assert.equal(planned.tasks[0].startAt, replacement(tag));
    assert.equal(planned.tasks[0].queryStartAt, basis.observedAt);
  });

  test(`${tag}: confirmation never overrides a verified basis that cannot append safely`, () => {
    const planned = core.plan([asset(tag, { dataParcRuntimeBasis: {
      startAt: replacement(tag), observedAt: '2026-11-02T10:00:00Z',
      dataParcTag: signal(tag), appendReady: false
    } })], now);
    assert.equal(planned.tasks.length, 0);
    assert.equal(planned.skipped.length, 1);
    assert.match(planned.skipped[0].message, /기존 조회값 보호/);
  });

  test(`${tag}: an unconfirmed disputed cycle continues its exact RUN tracking interval`, () => {
    const current = asset(tag, { limestoneBasisConfirmed: false, limestoneRunDisputed: true });
    const track = { ...staleTrack(tag), cycleStartRevision: current.cycleStartRevision };
    const planned = core.plan([current], now, () => null, () => track);
    assert.equal(planned.tasks.length, 1);
    assert.equal(planned.tasks[0].previewOnly, true);
    assert.equal(Date.parse(planned.tasks[0].startAt), Date.parse(track.observedAt));
    assert.equal(planned.tasks[0].incremental, false);
  });
}

test('server dispute status wins over changed-looking dates and contradictory confirmation', () => {
  const current = asset(tags[0], { lastReplacementAt: '2026-09-22T14:30:00+09:00',
    hasUnverifiedDataParcHistory: false, limestoneRunDisputed: true });
  const planned = core.plan([current], now);
  assert.equal(planned.tasks.length, 1);
  assert.equal(planned.tasks[0].previewOnly, true);
});

test('an explicitly undisputed cycle with unverified history requires confirmation instead of a rejected tracking write', () => {
  const current = asset(tags[0], { lastReplacementAt: '2026-09-22T14:30:00+09:00',
    limestoneBasisConfirmed: false, limestoneRunDisputed: false });
  const planned = core.plan([current], now);
  assert.equal(planned.tasks.length, 0);
  assert.equal(planned.skipped.length, 1);
  assert.match(planned.skipped[0].message, /교체 기준 확정/);
});

test('a mixed deployment with no basis status retains legacy hold and tracking guards', () => {
  const current = asset(tags[0]);
  delete current.limestoneBasisConfirmed;
  delete current.limestoneRunDisputed;
  const held = core.plan([current], now);
  assert.equal(held.tasks[0].previewOnly, true);
  const changedTrack = core.plan([current], now, () => null, () => staleTrack(tags[0]));
  assert.equal(changedTrack.tasks.length, 0);
  assert.match(changedTrack.skipped[0].message, /자동 초기화 금지/);
});

test('certification fields do not change unrelated blower or Limestone 1A planning', () => {
  const ordinary = {
    enabled: true, blowerType: 'organic_fuel', tagNumber: '104SDF01AN001',
    lastReplacementAt: '2026-10-01T00:00:00Z', cycleStartState: 'legacy',
    dataParcTag: signal('104SDF01AN001'), dataParcRuntimeBasis: null
  };
  const oneA = { ...ordinary, blowerType: 'limestone', tagNumber: '103HRJ01AN601',
    dataParcTag: signal('103HRJ01AN601') };
  for (const current of [ordinary, oneA]) {
    const original = core.plan([current], now);
    const decorated = { ...current, limestoneBasisConfirmed: true, limestoneRunDisputed: true };
    const actual = core.plan([decorated], now);
    assert.equal(actual.tasks.length, 1);
    assert.equal(actual.tasks[0].startAt, original.tasks[0].startAt);
    assert.equal(actual.tasks[0].queryStartAt, original.tasks[0].queryStartAt);
    assert.equal(actual.tasks[0].incremental, original.tasks[0].incremental);
    assert.equal(actual.tasks[0].previewOnly, undefined);
  }
});
