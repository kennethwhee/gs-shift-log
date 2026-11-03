import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const NOW = new Date('2026-11-03T19:59:00Z');
const OBSERVED = '2026-11-03T19:24:00Z';
const REPLACEMENT = '2026-09-25T05:40:00Z';

function node() {
  return { textContent: '', innerHTML: '', hidden: false, value: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {},
    addEventListener() {}, focus() {}, replaceChildren() {} };
}
function uiHarness() {
  const nodes = new Map(), context = vm.createContext({ console, navigator: {}, clearTimeout() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll() { return []; }, addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia() { return { matches: false }; },
      setTimeout(fn) { fn(); }, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, 'globalThis.ui={state,elements,cacheElements,commonRunCoverage,compactRunCoverageStatus,renderUnifiedRefreshProgress};\n' + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets: [], events: [] };
  return ui;
}
function asset(kind) {
  const tagNumber = '104ETG30AN602', dataParcTag = 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_104ETG30AN602';
  const a = { tagNumber, dataParcTag, blowerType: 'flyash_bag', unitNo: '1', displayName: 'Fixture Bag B', enabled: true,
    lastReplacementAt: REPLACEMENT, cycleStartState: 'legacy', cycleStoredStartedAt: '', cycleStartedAt: '',
    cycleStartRevision: 'fixture-start', cycleRuntimeRevision: 'fixture-runtime', cycleElapsedHours: 1, runtimeHours: 1,
    dataParcRuntimeBasis: { requestId: 'fixture-previous', dataParcTag, startAt: '2026-10-17T23:04:00Z',
      observedAt: OBSERVED, runtimeHours: 1, runningSeconds: 3600, appendReady: true,
      coverageComplete: false, requiredStartAt: REPLACEMENT } };
  if (kind === 'leading-gap') {
    a.cycleSourceReview = { code: 'CONFIRMED_REPLACEMENT_RUN_GAP', cycleBasisConfirmed: true, measuredRangeMayContinue: true };
    a.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, clockKnown: true,
      registeredBaseline: true, confirmedReplacementAt: REPLACEMENT, requiresRunRefresh: false };
  } else if (kind === 'completion-time-conflict') {
    a.cycleSourceReview = { code: 'REPLACEMENT_RECORDED_RANGE', measuredRangeMayContinue: true };
    a.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, clockKnown: false,
      registeredBaseline: true, completionClockConflict: true, requiresRunRefresh: false };
  } else if (kind === 'completion-time-missing') {
    a.lastReplacementAt = '2026-09-24T15:00:00Z';
    a.dataParcRuntimeBasis.startAt = '2026-09-25T15:00:00Z';
    a.dataParcRuntimeBasis.requiredStartAt = a.lastReplacementAt;
    a.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, clockKnown: false,
      timePrecision: 'day', rangeTrackingAllowed: true, rangeStartAt: a.dataParcRuntimeBasis.startAt,
      requiresRunRefresh: false };
  } else if (kind === 'replacement-basis-review') {
    a.cycleSourceReview = { code: 'VERIFIED_RUNTIME_RANGE', measuredRangeMayContinue: true };
    a.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, clockKnown: false,
      registeredRuntimeRange: true, registeredBaseline: true, requiresRunRefresh: false };
  } else if (kind === 'complete') {
    a.dataParcRuntimeBasis.coverageComplete = true;
    a.dataParcRuntimeBasis.startAt = REPLACEMENT;
  }
  return a;
}
const labels = { 'leading-gap': '누적 구간 확인', 'coverage-gap': '누적 구간 확인',
  'completion-time-conflict': '교체 시각 불일치', 'completion-time-missing': '완료 시각 미기록',
  'replacement-basis-review': '교체 기준 확인' };
function plan(a) {
  const p = core.plan([a], NOW);
  assert.equal(p.tasks.length, 1, p.skipped[0]?.message); assert.equal(p.skipped.length, 0);
  return p.tasks[0];
}
function accepted(task, status = 'complete') {
  return { ok: true, atomic: true, batchVersion: 1, requestedCount: 1,
    results: [{ ok: true, assetTag: task.snapshot.tagNumber, item: { id: 'fixture-accepted', status,
      requestType: 'blower_runtime_probe', probe: { assetTag: task.snapshot.tagNumber, requestId: 'fixture-accepted' } } }] };
}
async function execute(a, { resume = false, oldCheckpoint = false } = {}) {
  const task = plan(a), calls = [], checkpoints = [];
  if (oldCheckpoint) delete task.runReviewStatus;
  const savedTask = { ...task, asset: { tagNumber: a.tagNumber, displayName: a.displayName } };
  const results = await core.executeDataParcBatch(resume ? [] : [task], {
    assertWritable() {}, currentAssetFor() { return a; }, runtimeCheckpoint(value) { checkpoints.push(value); },
    ...(resume ? { runtimeResume: { version: 1, tasks: [savedTask], createdBatch: accepted(task, 'pending'), outcomes: [] } } : {}),
    async api(request) {
      calls.push(structuredClone(request));
      if (request.body?.action === 'create_blower_runtime_probe_batch') return accepted(task);
      if (!request.body) return { items: [{ id: 'fixture-accepted', status: 'complete' }] };
      assert.deepEqual(request.body, { action: 'dataparc_runtime_sync', requestId: 'fixture-accepted' });
      return { ok: true, message: 'Fixture server complete' };
    } });
  return { result: results[0], calls, checkpoints, task };
}

for (const [kind, label] of Object.entries(labels)) {
  test(`completed ${kind} retains the card reason without changing the append body or stored asset`, async () => {
    const a = asset(kind), before = structuredClone(a), ui = uiHarness();
    const cardStatus = ui.compactRunCoverageStatus(ui.commonRunCoverage(a));
    assert.equal(cardStatus.key, kind); assert.equal(cardStatus.label, label);
    const { result, calls, checkpoints, task } = await execute(a);
    assert.equal(result.status, 'complete'); assert.equal(result.partialRange, true);
    assert.deepEqual(result.runReviewStatus, { key: kind, label });
    assert.equal(result.message, `RUN 이어조회 완료 · ${label}`);
    assert.deepEqual(task.runReviewStatus, { key: kind, label });
    assert.equal(calls.length, 2, 'same one batch and one accepted-ID sync');
    const body = calls[0].body.requests[0];
    assert.equal(body.startAt, a.dataParcRuntimeBasis.startAt);
    assert.equal(body.requireIncrementalAppend, true); assert.equal(body.incrementalRefresh, true);
    assert.equal(body.expectedCycleRuntimeRevision, a.cycleRuntimeRevision);
    assert.equal(body.expectedCycleStartRevision, a.cycleStartRevision);
    assert.equal(body.expectedLastReplacementAt, a.lastReplacementAt);
    assert.ok(!Object.hasOwn(body, 'runReviewStatus'), 'display metadata never enters a server request');
    assert.equal(checkpoints.at(-1), null); assert.deepEqual(a, before);
  });
}

test('an older compact resume resolves its gap reason from the current server projection without creating another request', async () => {
  const a = asset('leading-gap'), before = structuredClone(a);
  const { result, calls } = await execute(a, { resume: true, oldCheckpoint: true });
  assert.equal(result.message, 'RUN 이어조회 완료 · 누적 구간 확인');
  assert.equal(result.runReviewStatus.key, 'leading-gap');
  assert.equal(calls.length, 2); assert.ok(calls.every(r => r.body?.action !== 'create_blower_runtime_probe_batch'));
  assert.deepEqual(a, before);
});

test('a changed or incomplete clock proof cannot claim the confirmed-gap reason', () => {
  for (const weaken of [
    a => { a.cycleSourceReview.cycleBasisConfirmed = false; },
    a => { a.replacementAutoCycle.clockKnown = false; },
    a => { a.replacementAutoCycle.confirmedReplacementAt = 'invalid'; }
  ]) {
    const a = asset('leading-gap'); weaken(a);
    assert.notEqual(core.runReviewStatus(a)?.key, 'leading-gap');
  }
  const conflict = asset('leading-gap'); conflict.replacementAutoCycle.completionClockConflict = true;
  assert.equal(core.runReviewStatus(conflict).key, 'completion-time-conflict');
});

test('complete coverage keeps the server message and has no review result metadata', async () => {
  const a = asset('complete'), before = structuredClone(a), { result } = await execute(a);
  assert.equal(core.runReviewStatus(a), null); assert.equal(result.message, 'Fixture server complete');
  assert.equal(result.partialRange, undefined); assert.equal(result.runReviewStatus, undefined);
  assert.deepEqual(a, before);
});

test('summary identifies eleven basis or range reviews without calling all eleven missing-coverage assets', () => {
  const ui = uiHarness();
  const outcomes = [
    ...Array.from({ length: 11 }, (_, i) => ({ tagNumber: `review-${i}`, status: 'complete', partialRange: true, message: 'RUN 이어조회 완료' })),
    ...Array.from({ length: 16 }, (_, i) => ({ tagNumber: `complete-${i}`, status: 'complete', message: 'RUN 이어조회 완료' }))
  ];
  const before = structuredClone(outcomes); ui.renderUnifiedRefreshProgress('완료', outcomes);
  assert.match(ui.elements.unifiedRefreshSummary.textContent, /반영 27대/);
  assert.match(ui.elements.unifiedRefreshSummary.textContent, /기준·구간 확인 11대/);
  assert.match(ui.elements.unifiedRefreshSummary.textContent, /조회 보류 0대/);
  assert.doesNotMatch(ui.elements.unifiedRefreshSummary.textContent, /일부 구간 이어조회/);
  assert.deepEqual(outcomes, before);
});
