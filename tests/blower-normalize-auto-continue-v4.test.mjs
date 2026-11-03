import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const NOW = '2026-11-03T04:00:00.000Z';
const WINDOW = { fromDate: '2026-10-01', endDate: '2026-11-04', snapshotAt: NOW };
const TOKEN = 'fixture-session';
const cursor = n => ({ workDate: '2026-11-03', updatedAt: NOW, id: `fixture-source-${String(n).padStart(4, '0')}` });
function page(phase, overrides = {}) {
  return { ok: true, version: 'bounded-logs-v1', replacementAutoVersion: 3, normalizationVersion: 4, phase,
    done: true, window: { ...WINDOW }, nextCursor: null, scannedLogCount: phase === 'replacement' ? 2 : 0,
    insertedCount: 0, appliedStateChanges: 0, autoAppliedReplacementCount: 0,
    autoCorrectedReplacementCount: 0, autoRetractedReplacementCount: 0,
    autoHistoricalReplacementCount: 0, autoLinkedReplacementCount: 0, autoConfirmedReplacementCount: 0, ...overrides };
}
function fixture(handler) {
  const calls = [], checkpoints = [], sleeps = [];
  let milliseconds = 0;
  const f = { calls, checkpoints, sleeps,
    get milliseconds() { return milliseconds; }, advance(ms) { milliseconds += ms; },
    options: { replacementAutoVersion: 3, normalizationVersion: 4, autoContinue: true, clock: () => milliseconds,
      sleep: async ms => { sleeps.push(ms); milliseconds += ms; } },
    io: { assertWritable() {}, checkpoint(value) { checkpoints.push(structuredClone(value)); },
      async api(request) {
        calls.push(structuredClone(request));
        assert.equal(request.body?.action, 'latest_logs_step', 'normalization never starts a RUN request');
        return handler(request, calls.length, f);
      } }
  };
  return f;
}
function assertHeld(result, f) {
  assert.equal(result.complete, false);
  assert.equal(result.replacementComplete, false);
  assert.equal(result.runtimeAllowed, false);
  assert.ok(typeof result.warning === 'string' && result.warning.trim(), 'a bounded stop explains why normalization is incomplete');
  assert.ok(typeof result.automaticContinuation?.stopped === 'string' && result.automaticContinuation.stopped.trim(),
    'the explicit continuation reason distinguishes a bound from a completed scan');
  assert.ok(f.checkpoints.at(-1), 'the last source checkpoint remains available');
  assert.equal(f.checkpoints.at(-1).phase, 'replacement');
  assert.equal(f.checkpoints.at(-1).replacementAutoVersion, 3);
  assert.equal(f.checkpoints.at(-1).normalizationVersion, 4);
}

test('one call automatically processes more than 400 sources across the 200-page slice and then finishes the operation phase', async () => {
  let replacements = 0;
  const f = fixture(request => {
    if (request.body.phase === 'operation') return page('operation');
    replacements++;
    assert.equal(request.body.replacementAutoVersion, 3);
    assert.equal(request.body.normalizationVersion, 4);
    assert.deepEqual(request.body.cursor, replacements === 1 ? null : cursor(replacements - 1));
    assert.deepEqual(request.body.window, replacements === 1 ? null : WINDOW);
    return page('replacement', { done: replacements === 201,
      nextCursor: replacements === 201 ? null : cursor(replacements),
      autoAppliedReplacementCount: 1, autoConfirmedReplacementCount: 2 });
  });
  const result = await core.refreshLogsForRuntime(f.io, f.options);
  assert.equal(result.complete, true);
  assert.equal(result.replacementComplete, true);
  assert.equal(result.runtimeAllowed, true);
  assert.equal(replacements, 201);
  assert.equal(f.calls.length, 202);
  assert.equal(result.totals.scannedReplacementLogs, 402);
  assert.equal(result.totals.autoAppliedReplacementCount, 201);
  assert.equal(result.totals.autoConfirmedReplacementCount, 402, 'continuation does not lose or double-add prior receipts');
  assert.equal(result.automaticContinuation.chunks, 2);
  assert.equal(f.checkpoints.at(-1), null);
  assert.ok(f.checkpoints.some(value => value?.phase === 'replacement' && value.cursor?.id === cursor(200).id));
});

test('after transient retries are exhausted the next slice retries the same failed cursor and fixed source window', async () => {
  let failures = 0;
  const f = fixture((request, index) => {
    if (index === 1) return page('replacement', { done: false, nextCursor: cursor(1), autoAppliedReplacementCount: 1 });
    if (request.body.phase === 'operation') return page('operation');
    assert.deepEqual(request.body.cursor, cursor(1));
    assert.deepEqual(request.body.window, WINDOW);
    if (failures++ < 5) throw Object.assign(new Error('Fixture transient gateway failure'), { status: 503, retryable: true });
    return page('replacement', { scannedLogCount: request.body.limit, autoAppliedReplacementCount: 2 });
  });
  const result = await core.refreshLogsForRuntime(f.io, f.options);
  assert.equal(result.complete, true);
  assert.equal(f.calls.length, 8, 'one good page, five failed attempts, one recovered page and one operation page');
  assert.equal(result.totals.scannedReplacementLogs, 3, 'the recovered page honors the existing adaptive one-source limit');
  assert.equal(result.totals.autoAppliedReplacementCount, 3);
  assert.ok(f.sleeps.some(ms => ms >= 1000), 'transient continuation yields through bounded backoff');
  assert.equal(f.checkpoints.at(-1), null);
});

test('the continuation chunk limit retains the successful cursor and holds RUN without restarting the first page', async () => {
  let sources = 0;
  const f = fixture(request => {
    sources++;
    assert.deepEqual(request.body.cursor, sources === 1 ? null : cursor(sources - 1));
    return page('replacement', { done: false, nextCursor: cursor(sources) });
  });
  const result = await core.refreshLogsForRuntime(f.io, { ...f.options, maxPages: 1, maxContinuationChunks: 2 });
  assertHeld(result, f);
  assert.equal(f.calls.length, 2);
  assert.equal(result.automaticContinuation.chunks, 2);
  assert.deepEqual(f.checkpoints.at(-1).cursor, cursor(2));
});

test('the consecutive transient-strike limit stops recovery attempts while retaining the last confirmed source cursor', async () => {
  const f = fixture((request, index) => {
    if (index === 1) return page('replacement', { done: false, nextCursor: cursor(1) });
    throw Object.assign(new Error('Fixture repeated gateway failure'), { status: 503, retryable: true });
  });
  const result = await core.refreshLogsForRuntime(f.io, { ...f.options, maxContinuationStrikes: 1 });
  assertHeld(result, f);
  assert.equal(f.calls.length, 6, 'one confirmed page plus the existing five attempts, with no extra recovery slice');
  assert.deepEqual(f.checkpoints.at(-1).cursor, cursor(1));
});

test('the overall deadline bounds source normalization and preserves the receipt for the last successful page', async () => {
  let sources = 0;
  const f = fixture((request, index, clock) => {
    clock.advance(30);
    sources++;
    return page('replacement', { done: false, nextCursor: cursor(sources) });
  });
  const result = await core.refreshLogsForRuntime(f.io, { ...f.options, totalTimeBudgetMs: 40 });
  assertHeld(result, f);
  assert.ok(f.calls.length <= 2, 'one bounded network response may consume the remaining time, but no fresh slice starts');
  assert.deepEqual(f.checkpoints.at(-1).cursor, cursor(sources));
});

test('conflict, authentication and malformed protocol failures are not retried by automatic continuation', async () => {
  for (const kind of ['conflict', 'authentication', 'protocol']) {
    const f = fixture(() => {
      if (kind === 'protocol') return page('replacement', { replacementAutoVersion: 2 });
      throw Object.assign(new Error(`Fixture ${kind}`), { status: kind === 'conflict' ? 409 : 403, retryable: true });
    });
    await assert.rejects(core.refreshLogsForRuntime(f.io, f.options), error =>
      kind === 'protocol' ? error.code === 'INVALID_LOG_PAGE' : error.status === (kind === 'conflict' ? 409 : 403));
    assert.equal(f.calls.length, 1, kind);
    assert.equal(f.sleeps.length, 0, kind);
  }
});

test('legacy callers and V3 callers without opt-in retain the existing one-slice pause behavior', async () => {
  for (const version of [undefined, 3]) {
    const f = fixture(() => page('replacement', { done: false, nextCursor: cursor(1),
      scannedLogCount: 1, replacementAutoVersion: version, normalizationVersion: undefined }));
    const { autoContinue, ...withoutOptIn } = f.options;
    const result = await core.refreshLogsForRuntime(f.io, { ...withoutOptIn, replacementAutoVersion: version,
      normalizationVersion: undefined, maxPages: 1 });
    assert.equal(result.complete, false);
    assert.equal(f.calls.length, 1);
    assert.equal(result.runtimeAllowed, version === 3 ? false : undefined);
    assert.equal(result.automaticContinuation, undefined);
    assert.equal(f.calls[0].body.normalizationVersion, undefined);
    assert.deepEqual(f.checkpoints.at(-1).cursor, cursor(1));
  }
});

test('a completed replacement scan does not automatically replay an incomplete operation scan', async () => {
  const f = fixture(request => request.body.phase === 'replacement' ? page('replacement')
    : page('operation', { done: false, scannedLogCount: 2, nextCursor: cursor(1) }));
  const result = await core.refreshLogsForRuntime(f.io, { ...f.options, maxPages: 2 });
  assert.equal(result.complete, false);
  assert.equal(result.replacementComplete, true);
  assert.equal(result.runtimeAllowed, true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.checkpoints.at(-1).phase, 'operation');
  assert.deepEqual(f.checkpoints.at(-1).cursor, cursor(1));
});

function node() {
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, title: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {}, addEventListener() {},
    showModal() { this.open = true; }, close() { this.open = false; } };
}

async function uiFixture({ normalizationCap = true } = {}) {
  const tags = ['104HHL60AP611','104HHL60AP621','104HHL60AP631','204HHL60AP611','204HHL60AP621','204HHL60AP631',
    '104HHL10AN611','104HHL10AN621','104HHL10AN631','204HHL10AN611','204HHL10AN621','204HHL10AN631',
    '104SDF01AN001','104SDF01AN002','204SDF01AN001','204SDF01AN002','204LMDF01AN001',
    '104ETG30AN601','104ETG30AN602','204ETG30AN601','204ETG30AN602','104ETH03AN601','104ETH03AN602',
    '103HRJ01AN601','103HRJ01AN602','203HRJ01AN601','203HRJ01AN602'];
  const calls = [], captured = [], requests = [], nodes = new Map();
  let ms = 0, sources = 0;
  const runtimeCore = { ...core, refreshLogsForRuntime(io, options) {
    captured.push(structuredClone(options));
    return core.refreshLogsForRuntime(io, { ...options, maxPages: 1, maxContinuationChunks: 2,
      clock: () => ms, sleep: async delay => { ms += delay; } });
  } };
  const context = vm.createContext({ console, Date, clearTimeout() {}, performance: { now: () => 0 },
    HTMLButtonElement: class {}, navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: runtimeCore, matchMedia: () => ({ matches: false }),
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setTimeout(fn) { fn(); },
      setInterval() { return 1; }, clearInterval() {}, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui={state,elements,cacheElements,refreshAllBlowers,renderInlineRefreshStatus};
    globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;getSessionToken=()=> '${TOKEN}';
      currentServerDate=()=>new Date('${NOW}');showToast=()=>{};setBusy=v=>{state.busy=v;};
      startUnifiedRefreshFeedback=()=>{};finishUnifiedRefreshFeedback=()=>{};
      renderAssets=()=>{};renderOverviewRefreshPanel=()=>{};};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets: tags.map(tagNumber => ({ tagNumber, displayName: tagNumber, enabled: true,
    lastReplacementAt: '2026-10-01T00:00:00.000Z' })), events: [], permissions: { canWrite: true },
    user: { name: 'Fixture', employeeNo: 'fixture-employee' }, backfill: { hasRun: true, status: 'complete' },
    settings: {}, types: [], missingSlots: [], missingTags: [],
    ...(normalizationCap ? { replacementNormalizationVersion: 4 } : {}) };
  const original = structuredClone(ui.state.data);
  context.hooks({ async load() { calls.push('reload'); return ui.state.data; }, async api(request) {
    calls.push(request.body?.action || 'unexpected-read');
    requests.push(structuredClone(request));
    assert.equal(request.body?.action, 'latest_logs_step', 'no runtime planning, create, reset or apply before analysis finishes');
    sources++;
    return page('replacement', { done: false, nextCursor: cursor(sources), scannedLogCount: 1,
      normalizationVersion: normalizationCap ? 4 : undefined });
  } });
  await ui.refreshAllBlowers();
  ui.renderInlineRefreshStatus();
  return { ui, calls, captured, requests, original };
}

test('an incomplete analysis in the full VM keeps its checkpoint without reporting 27 unqueried Blowers as missing RUN results', async () => {
  const { ui, calls, captured, requests, original } = await uiFixture();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].replacementAutoVersion, 3);
  assert.equal(captured[0].autoContinue, true, 'the real Latest controller opts into bounded automatic continuation');
  assert.equal(captured[0].normalizationVersion, 4);
  assert.ok(requests.every(request => request.body.normalizationVersion === 4));
  assert.deepEqual(calls, ['latest_logs_step', 'latest_logs_step', 'reload']);
  assert.equal(ui.state.unifiedRefreshRuntimePlanned, false);
  assert.equal(ui.state.unifiedRefreshResults.length, 0);
  assert.equal(ui.state.unifiedLogResume.replacementAutoVersion, 3);
  assert.equal(ui.state.unifiedLogResume.normalizationVersion, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.state.unifiedLogResume.cursor)), cursor(2));
  const label = ui.elements.overviewRefreshProgressText.textContent;
  const count = ui.elements.overviewRefreshCount.textContent;
  assert.match(label, /교체 원문 확인 대기/);
  assert.match(count, /2건/);
  assert.equal(ui.state.unifiedRefreshLogCounts.replacement, 2);
  assert.doesNotMatch(label + ' ' + count, /미확인 27|반영 0/);
  assert.deepEqual(ui.state.data, original, 'normalization status does not change cached Blower values');
});

test('the real UI preserves the earlier single-pass behavior when the server does not advertise V4 capability', async () => {
  const { ui, calls, captured, requests, original } = await uiFixture({ normalizationCap: false });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].replacementAutoVersion, 3);
  assert.notEqual(captured[0].autoContinue, true);
  assert.equal(captured[0].normalizationVersion, undefined);
  assert.deepEqual(calls, ['latest_logs_step', 'reload']);
  assert.equal(requests[0].body.normalizationVersion, undefined);
  assert.equal(ui.state.unifiedLogResume.normalizationVersion, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.state.unifiedLogResume.cursor)), cursor(1));
  assert.equal(ui.state.unifiedRefreshRuntimePlanned, false);
  assert.deepEqual(ui.state.data, original);
});

test('V4 rejects earlier normalization receipts and restarts an older V3 operation checkpoint from replacement analysis', async () => {
  for (const normalizationVersion of [undefined, 3, '4']) {
    const f = fixture(() => page('replacement', { normalizationVersion }));
    await assert.rejects(core.refreshLogsForRuntime(f.io, f.options), error => error.code === 'INVALID_LOG_PAGE');
    assert.equal(f.calls.length, 1);
    assert.ok(f.checkpoints.every(value => value?.phase === 'replacement' && value.cursor === null &&
      value.replacementComplete === false), 'an incompatible receipt cannot advance the source cursor or operation phase');
  }
  const resume = { replacementAutoVersion: 3, replacementComplete: true, phase: 'operation',
    window: { ...WINDOW }, cursor: cursor(999), limit: 2, totals: { scannedReplacementLogs: 999 } };
  const before = structuredClone(resume), f = fixture(request => page(request.body.phase));
  const result = await core.refreshLogsForRuntime(f.io, { ...f.options, resume });
  assert.equal(result.complete, true);
  assert.equal(f.calls[0].body.phase, 'replacement');
  assert.equal(f.calls[0].body.window, null);
  assert.equal(f.calls[0].body.cursor, null);
  assert.equal(f.calls[0].body.normalizationVersion, 4);
  assert.equal(result.totals.scannedReplacementLogs, 2, 'old-protocol totals are not carried into the new source analysis');
  assert.deepEqual(resume, before);
});

const RANGE_TAG = '204HHL60AP621';
const RANGE_SIGNAL = 'GSPOGE.ABB_DCS.TEST_ONLY_CONFIRMED_BINARY_204HHL60AP621';
const DAY_RECORDED = '2026-10-29T15:00:00.000Z'; // October 30, KST day-only record.
const RANGE_START = '2026-10-30T15:00:00.000Z'; // Server-selected October 31 00:00 KST.
const RANGE_END = '2026-11-02T15:00:00.000Z';

function rangeAsset() {
  return { tagNumber: RANGE_TAG, blowerType: 'fbhe', unitNo: '2', positionLabel: '#B',
    displayName: '#2 FBHE Blower #B', enabled: true, lastReplacementAt: DAY_RECORDED,
    cycleBasisKind: 'replacement', cycleStartState: 'pending', cycleStartedAt: null, cycleStoredStartedAt: null,
    cycleStartRevision: 'fixture-range-new-start', cycleRuntimeRevision: 'fixture-range-new-runtime',
    runtimeHours: null, cycleElapsedHours: null, measurementRequired: true, severity: 'runtime_unknown',
    cycleRuntimeTracked: true, cycleRuntimeState: 'unknown', operationState: 'unknown', isRunning: false,
    runtimeAccumulationMode: 'measured_only', hasUnverifiedDataParcHistory: false,
    dataParcTag: RANGE_SIGNAL, dataParcRuntimeBasis: null,
    runRuntime: { verified: false, source: 'unverified', state: 'unknown', measuredAt: '' },
    replacementAutoCycle: { schemaVersion: 3, normalizationVersion: 4, timePrecision: 'day',
      clockKnown: false, registeredBaseline: false, requiredStartAt: '', freshQueryEligible: false,
      requiresRunRefresh: true, sourceLogId: 'fixture-approved-day-log', eventId: 'fixture-day-replacement',
      cycleStartRevision: 'fixture-range-new-start', cycleRuntimeRevision: 'fixture-range-new-runtime',
      storedRuntimeHours: 0, storedLegacyRuntimeHours: 0,
      rangeTrackingAllowed: true, rangeQueryEligible: true, rangeStartAt: RANGE_START },
    cycleSourceReview: { code: 'REPLACEMENT_COMPLETION_TIME_MISSING',
      message: '완료 시각이 없는 교체 기록 이후의 확인된 RUN 구간을 조회합니다.', measuredRangeMayContinue: false } };
}
function measuredRange(state = 'running') {
  const asset = rangeAsset();
  Object.assign(asset, { runtimeHours: 2, cycleElapsedHours: 2, measurementRequired: false,
    cycleRuntimeRevision: 'fixture-range-seeded-runtime', cycleRuntimeAnchorAt: RANGE_END,
    cycleRuntimeState: state, operationState: state, isRunning: state === 'running' });
  Object.assign(asset.replacementAutoCycle, { requiresRunRefresh: false, rangeQueryEligible: false,
    storedRuntimeHours: 2, storedLegacyRuntimeHours: 2 });
  asset.cycleSourceReview.measuredRangeMayContinue = true;
  asset.runRuntime = { verified: true, source: 'dataparc', state, measuredAt: RANGE_END };
  asset.dataParcRuntimeBasis = { requestId: 'fixture-range-seed', eventId: 'dataparc_runtime:fixture-range-seed',
    dataParcTag: RANGE_SIGNAL, startAt: RANGE_START, coverageStartAt: RANGE_START, observedAt: RANGE_END,
    runtimeHours: 2, runningSeconds: 7200, coverageComplete: false, appendReady: true };
  return asset;
}
function cardFixture(asset) {
  const nodes = new Map(), context = vm.createContext({ console, clearTimeout() {}, HTMLButtonElement: class {}, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia: () => ({ matches: false }),
      setTimeout(fn) { fn(); }, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui={state,elements,cacheElements,renderAssetCard,
    renderAllOverviewCard,openAssetHistory};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { replacementNormalizationVersion: 4, assets: [asset], events: [],
    permissions: { canWrite: true }, user: { name: 'Fixture' }, backfill: { hasRun: true, status: 'complete' },
    settings: {}, types: [], missingSlots: [], missingTags: [] };
  return ui;
}
function allViews(ui, asset) {
  ui.openAssetHistory(asset.tagNumber);
  return [ui.renderAssetCard(asset, { cycleDays: 90 }), ui.renderAllOverviewCard(asset),
    ui.elements.historyCycleSummary.innerHTML];
}

test('a server-authorized V4 day range seeds from the supplied KST midnight rather than the unknown replacement clock', async () => {
  for (const rangeStartAt of [RANGE_START, '2026-10-31T15:00:00.000Z']) {
    const asset = rangeAsset(); asset.replacementAutoCycle.rangeStartAt = rangeStartAt;
    const before = structuredClone(asset), result = core.plan([asset], new Date(NOW));
    assert.equal(core.freshReplacementQuery(asset, new Date(NOW)).startAt, rangeStartAt);
    assert.equal(result.tasks.length, 1, 'both daytime +1-day and night-shaped +2-day server ranges are supported');
    const task = result.tasks[0];
    assert.equal(task.replacementAutoRange, true);
    assert.equal(task.partialTracking, true);
    assert.notEqual(task.partialRange, true, 'a fresh range seed is not an append with a nonexistent predecessor');
    assert.equal(task.incremental, false);
    assert.equal(task.startAt, rangeStartAt);
    assert.equal(task.queryStartAt, rangeStartAt);
    assert.deepEqual(asset, before);
  }
  const asset = rangeAsset(), task = core.plan([asset], new Date(NOW)).tasks[0], calls = [];
  const result = await core.executeDataParcBatch([task], { assertWritable() {}, currentAssetFor: () => asset,
    async api(request) {
      calls.push(structuredClone(request));
      if (request.body.action === 'create_blower_runtime_probe_batch') return { ok: true, atomic: true,
        batchVersion: 1, requestedCount: 1, results: [{ ok: true, assetTag: RANGE_TAG,
          item: { id: 'fixture-range-request', status: 'complete', requestType: 'blower_runtime_probe',
            probe: { requestId: 'fixture-range-request', assetTag: RANGE_TAG } } }] };
      assert.deepEqual(request.body, { action: 'dataparc_runtime_sync', requestId: 'fixture-range-request' });
      return { ok: true, message: 'Fixture confirmed RUN range applied' };
    } });
  assert.equal(result[0].status, 'complete');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.requests[0].startAt, RANGE_START);
  assert.equal(calls[0].body.requests[0].replacementAutoRange, true);
  assert.equal(calls[0].body.requests[0].partialTracking, true);
  assert.equal(calls[0].body.requests[0].expectedLastReplacementAt, DAY_RECORDED);
  assert.equal(calls[0].body.requests[0].requireIncrementalAppend, false);
});

test('range seeding rejects missing capability, unsafe clocks, stale counters and revisions while V3 day-only policy stays held', () => {
  const changes = [
    a => { delete a.replacementAutoCycle.normalizationVersion; },
    a => { a.replacementAutoCycle.rangeTrackingAllowed = false; },
    a => { a.replacementAutoCycle.rangeQueryEligible = false; },
    a => { a.replacementAutoCycle.rangeStartAt = ''; },
    a => { a.replacementAutoCycle.rangeStartAt = DAY_RECORDED; },
    a => { a.replacementAutoCycle.rangeStartAt = '2026-10-30T15:01:00.000Z'; },
    a => { a.replacementAutoCycle.rangeStartAt = '2026-11-02T15:00:00.000Z'; },
    a => { a.cycleStartRevision = ''; },
    a => { a.cycleRuntimeRevision = ''; },
    a => { a.replacementAutoCycle.cycleStartRevision = 'fixture-different-start'; },
    a => { a.replacementAutoCycle.cycleRuntimeRevision = 'fixture-different-runtime'; },
    a => { a.cycleStartState = 'legacy'; },
    a => { a.cycleStartState = 'started'; a.cycleStoredStartedAt = a.cycleStartedAt = RANGE_START; },
    a => { a.cycleStoredStartedAt = a.cycleStartedAt = RANGE_START; },
    a => { a.replacementAutoCycle.sourceLogId = ''; },
    a => { a.replacementAutoCycle.storedLegacyRuntimeHours = 1; },
    a => { a.replacementAutoCycle.storedRuntimeHours = '0'; },
    a => { a.runtimeHours = a.cycleElapsedHours = 2; }
  ];
  for (const change of changes) {
    const asset = rangeAsset(); change(asset);
    const before = structuredClone(asset), result = core.plan([asset], new Date(NOW));
    assert.equal(core.freshReplacementQuery(asset, new Date(NOW)), null);
    assert.equal(result.tasks.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.deepEqual(asset, before);
  }
});

test('a successful day-range seed appends only from its measured endpoint while retaining the original range start and total', () => {
  const asset = measuredRange(), before = structuredClone(asset), result = core.plan([asset], new Date(NOW));
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].incremental, true);
  assert.equal(result.tasks[0].startAt, RANGE_START);
  assert.equal(result.tasks[0].queryStartAt, RANGE_END);
  assert.equal(result.tasks[0].partialRange, true);
  assert.deepEqual(asset, before);
  const legacy = structuredClone(asset);
  delete legacy.replacementAutoCycle.normalizationVersion;
  const held = core.plan([legacy], new Date(NOW));
  assert.equal(held.tasks.length, 0, 'older V3 proof cannot inherit V4 range continuation privileges');
  assert.equal(held.skipped.length, 1);
});

test('day-range cards and history distinguish an unmeasured seed from measured running and stopped ranges without cycle progress', () => {
  const pending = rangeAsset(), ui = cardFixture(pending), before = structuredClone(pending);
  for (const markup of allViews(ui, pending)) {
    assert.match(markup, /교체 기록 이후 확인된 RUN|확인 구간 RUN/);
    assert.ok(!markup.includes('0.0시간'));
    assert.doesNotMatch(markup, /class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
  }
  assert.deepEqual(pending, before);
  for (const state of ['running', 'stopped']) {
    const asset = measuredRange(state), measuredUi = cardFixture(asset), original = structuredClone(asset);
    assert.equal(core.fbheSealRunView(asset, asset.dataParcRuntimeBasis).state, state,
      'a real measured endpoint remains valid even though replacement completion time is unknown');
    for (const markup of allViews(measuredUi, asset)) {
      assert.ok(markup.includes('2.0시간'));
      assert.match(markup, /확인 구간 RUN 누적/);
      assert.doesNotMatch(markup, /class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
    }
    assert.deepEqual(asset, original);
  }
});

test('Silo B keeps its verified 1938-hour RUN range and query basis without displaying a false automatic replacement', () => {
  const tagNumber = '104ETH03AN602', signal = 'GSPOGE.ABB_DCS.003ETH03AN602XB04';
  const asset = measuredRange();
  Object.assign(asset, { tagNumber, blowerType: 'flyash_silo', unitNo: 'shared', positionLabel: '#B',
    displayName: 'Fly Ash Silo Aeration Blower #B', cycleBasisKind: 'verified_runtime_range',
    lastReplacementAt: '2026-05-04T00:00:00+09:00', runtimeHours: 1938, cycleElapsedHours: 1938,
    dataParcTag: signal, cycleStartState: 'legacy' });
  Object.assign(asset.replacementAutoCycle, { registeredRuntimeRange: true, rangeStartAt: '2026-05-09T15:00:00.000Z',
    requiredStartAt: '2026-05-09T15:00:00.000Z', storedRuntimeHours: 1938, storedLegacyRuntimeHours: 1938 });
  asset.cycleSourceReview = { message: '기존에 검증된 RUN 조회범위와 누적값을 유지합니다.', measuredRangeMayContinue: true };
  Object.assign(asset.dataParcRuntimeBasis, { requestId: 'fixture-silo-range', eventId: 'dataparc_runtime:fixture-silo-range',
    dataParcTag: signal, startAt: '2026-05-09T15:00:00.000Z', coverageStartAt: '2026-05-09T15:00:00.000Z',
    runtimeHours: 1938, runningSeconds: 6976800 });
  const before = structuredClone(asset), result = core.plan([asset], new Date(NOW));
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].incremental, true);
  assert.equal(result.tasks[0].startAt, asset.dataParcRuntimeBasis.startAt);
  assert.equal(result.tasks[0].queryStartAt, RANGE_END);
  const ui = cardFixture(asset);
  for (const markup of allViews(ui, asset)) {
    assert.ok(markup.includes('1,938.0시간'));
    assert.match(markup, /RUN 조회\s*기준/);
    assert.match(markup, /조회구간 RUN 누적|확인 구간 RUN 누적/);
    assert.ok(!markup.includes('교체 자동반영'));
    assert.doesNotMatch(markup, /class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
  }
  assert.deepEqual(asset, before, 'neither planning nor relabeling changes the old checkpoint or its integer seconds');
});

function acceptedRange(status = 'complete') {
  return { ok: true, atomic: true, batchVersion: 1, requestedCount: 1,
    results: [{ ok: true, assetTag: RANGE_TAG,
      item: { id: 'fixture-accepted-range', status, requestType: 'blower_runtime_probe',
        probe: { requestId: 'fixture-accepted-range', assetTag: RANGE_TAG } } }] };
}

test('a manual counter or revision change after range creation stops apply and preserves the newer two-hour correction', async () => {
  const original = rangeAsset(), task = core.plan([original], new Date(NOW)).tasks[0];
  const calls = [], checkpoints = [];
  let current = original, manualSnapshot;
  const result = await core.executeDataParcBatch([task], { assertWritable() {}, currentAssetFor: () => current,
    runtimeCheckpoint: value => checkpoints.push(structuredClone(value)), async api(request) {
      calls.push(structuredClone(request));
      assert.equal(request.body.action, 'create_blower_runtime_probe_batch');
      current = structuredClone(original);
      Object.assign(current, { runtimeHours: 2, cycleElapsedHours: 2,
        cycleRuntimeRevision: 'fixture-manual-runtime-revision', measurementRequired: false });
      current.runRuntime = { verified: true, source: 'manual', state: 'running', measuredAt: NOW };
      manualSnapshot = structuredClone(current);
      return acceptedRange();
    } });
  assert.equal(calls.length, 1, 'no result apply, reset, cancel or duplicate create follows the manual change');
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'skipped');
  assert.match(result[0].message, /기준 변경|기존 값 유지/);
  assert.equal(checkpoints.at(-1), null);
  assert.deepEqual(current, manualSnapshot, 'the later manual two-hour value and revised ownership stay intact');
});

test('an accepted fresh-range checkpoint resumes its exact ID without new requests for both zero and already-owned measured states', async () => {
  for (const ownership of ['zero', 'already-owned']) {
    const original = rangeAsset(), task = core.plan([original], new Date(NOW)).tasks[0];
    const current = ownership === 'zero' ? original : measuredRange();
    if (ownership === 'already-owned') Object.assign(current.dataParcRuntimeBasis, {
      requestId: 'fixture-accepted-range', eventId: 'dataparc_runtime:fixture-accepted-range'
    });
    const resume = { version: 1, tasks: [{ ...task, asset: { tagNumber: RANGE_TAG, displayName: original.displayName } }],
      createdBatch: acceptedRange('pending'), outcomes: [] };
    const before = structuredClone(current), receipt = structuredClone(resume), calls = [], checkpoints = [];
    const result = await core.executeDataParcBatch([], { assertWritable() {}, runtimeResume: resume,
      currentAssetFor: () => current, runtimeCheckpoint: value => checkpoints.push(structuredClone(value)),
      async api(request) {
        calls.push(structuredClone(request));
        if (!request.body) {
          assert.ok(request.url.includes('fixture-accepted-range'));
          return { items: [{ id: 'fixture-accepted-range', status: 'complete' }] };
        }
        assert.deepEqual(request.body, { action: 'dataparc_runtime_sync', requestId: 'fixture-accepted-range' });
        return { ok: true, replayed: ownership === 'already-owned', message: 'Fixture accepted range reconciled' };
      } });
    assert.equal(calls.length, 2, 'only accepted-ID status and idempotent apply occur; no log scan or create POST');
    assert.equal(result[0].status, 'complete', ownership);
    assert.equal(checkpoints.at(-1), null);
    assert.deepEqual(current, before);
    assert.deepEqual(resume, receipt, 'the accepted request and original range snapshot remain unchanged');
  }
});
