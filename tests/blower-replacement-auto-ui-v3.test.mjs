import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const TAG = '204HHL60AP621';
const SIGNAL = 'GSPOGE.ABB_DCS.TEST_ONLY_CONFIRMED_BINARY_204HHL60AP621';
const NOW = '2026-11-03T04:00:00.000Z';
const REPLACED = '2026-11-03T00:58:00.000Z'; // 09:58 KST, synthetic confirmed work.
const TOKEN = 'fixture-session';
const WINDOW = { fromDate: '2026-10-01', endDate: '2026-11-04', snapshotAt: NOW };
const COUNTER_KEYS = ['autoAppliedReplacementCount', 'autoCorrectedReplacementCount', 'autoRetractedReplacementCount',
  'autoHistoricalReplacementCount', 'autoLinkedReplacementCount', 'autoConfirmedReplacementCount'];
const CATALOG = [
  ['104HHL60AP611','fbhe','1'], ['104HHL60AP621','fbhe','1'], ['104HHL60AP631','fbhe','1'],
  ['204HHL60AP611','fbhe','2'], ['204HHL60AP621','fbhe','2'], ['204HHL60AP631','fbhe','2'],
  ['104HHL10AN611','seal_pot','1'], ['104HHL10AN621','seal_pot','1'], ['104HHL10AN631','seal_pot','1'],
  ['204HHL10AN611','seal_pot','2'], ['204HHL10AN621','seal_pot','2'], ['204HHL10AN631','seal_pot','2'],
  ['104SDF01AN001','organic_fuel','1'], ['104SDF01AN002','organic_fuel','1'],
  ['204SDF01AN001','organic_fuel','2'], ['204SDF01AN002','organic_fuel','2'],
  ['204LMDF01AN001','organic_fuel','2','manure'],
  ['104ETG30AN601','flyash_bag','1'], ['104ETG30AN602','flyash_bag','1'],
  ['204ETG30AN601','flyash_bag','2'], ['204ETG30AN602','flyash_bag','2'],
  ['104ETH03AN601','flyash_silo','shared'], ['104ETH03AN602','flyash_silo','shared'],
  ['103HRJ01AN601','limestone','1'], ['103HRJ01AN602','limestone','1'],
  ['203HRJ01AN601','limestone','2'], ['203HRJ01AN602','limestone','2']
];

test('legacy persistent 503 keeps the original null totals response and exact 296-log checkpoint', async () => {
  const checkpoint = { phase: 'replacement', window: { ...WINDOW },
    cursor: { workDate: '2026-08-15', updatedAt: '', id: 'row296' }, limit: 4,
    totals: { scannedReplacementLogs: 296 } };
  const calls = []; let current = checkpoint;
  const result = await core.refreshLogsForRuntime({
    assertWritable() {}, checkpoint: value => { current = value; },
    async api(request) {
      calls.push(structuredClone(request));
      throw Object.assign(new Error('request failed'), { status: 503, cfRay: 'fixture-ray' });
    }
  }, { resume: checkpoint, sleep: async () => {} });
  assert.equal(result.complete, false);
  assert.equal(result.totals, null);
  assert.equal(result.runtimeAllowed, undefined);
  assert.match(result.warning, /296건/); assert.match(result.warning, /2026-08-15/);
  assert.match(result.warning, /503/); assert.match(result.warning, /fixture-ray/);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(request => request.body.action === 'latest_logs_step' &&
    request.body.cursor.id === 'row296' && request.body.replacementAutoVersion === undefined));
  assert.equal(current.cursor.id, 'row296');
  assert.equal(current.totals.scannedReplacementLogs, 296);
});

test('V3 persistent 503 retains replacement totals and blocks RUN until that exact replacement page completes', async () => {
  const checkpoint = { phase: 'replacement', replacementAutoVersion: 3, replacementComplete: false,
    window: { ...WINDOW }, cursor: { workDate: '2026-08-15', updatedAt: '', id: 'row296' }, limit: 2,
    totals: { scannedReplacementLogs: 296, autoAppliedReplacementCount: 7 } };
  const calls = []; let current = checkpoint;
  const result = await core.refreshLogsForRuntime({
    assertWritable() {}, checkpoint: value => { current = value; },
    async api(request) {
      calls.push(structuredClone(request));
      throw Object.assign(new Error('request failed'), { status: 503, cfRay: 'fixture-ray' });
    }
  }, { resume: checkpoint, replacementAutoVersion: 3, sleep: async () => {} });
  assert.equal(result.complete, false);
  assert.equal(result.runtimeAllowed, false); assert.equal(result.replacementComplete, false);
  assert.equal(result.totals.scannedReplacementLogs, 296);
  assert.equal(result.totals.autoAppliedReplacementCount, 7);
  assert.match(result.warning, /296건/); assert.match(result.warning, /503/);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(request => request.body.action === 'latest_logs_step' &&
    request.body.phase === 'replacement' && request.body.cursor.id === 'row296' &&
    request.body.replacementAutoVersion === 3));
  assert.equal(current.cursor.id, 'row296');
  assert.equal(current.totals.scannedReplacementLogs, 296);
  assert.equal(current.totals.autoAppliedReplacementCount, 7);
  assert.equal(current.replacementComplete, false);
});

function oldAsset() {
  return { tagNumber: TAG, blowerType: 'fbhe', unitNo: '2', positionLabel: '#B', displayName: '#2 FBHE Blower #B',
    enabled: true, lastReplacementAt: '2026-09-16T00:23:00.000Z', cycleBasisKind: 'replacement',
    cycleStartState: 'pending', cycleStoredStartedAt: null, cycleStartedAt: null,
    cycleStartRevision: 'fixture-old-start', cycleRuntimeRevision: 'fixture-old-runtime',
    cycleElapsedHours: 200, runtimeHours: 200, remainingHours: 1960,
    cycleRuntimeTracked: true, cycleRuntimeState: 'stopped', operationState: 'stopped', isRunning: false,
    runtimeAccumulationMode: 'measured_only', measurementRequired: false, severity: 'normal',
    hasUnverifiedDataParcHistory: false, dataParcTag: SIGNAL,
    runRuntime: { verified: true, source: 'dataparc', state: 'stopped', measuredAt: '2026-11-02T15:00:00Z' },
    dataParcRuntimeBasis: { requestId: 'fixture-old-run', eventId: 'dataparc_runtime:fixture-old-run',
      startAt: '2026-09-16T00:23:00.000Z', observedAt: '2026-11-02T15:00:00.000Z',
      runtimeHours: 200, runningSeconds: 720000, dataParcTag: SIGNAL, coverageComplete: true, appendReady: true } };
}
function proof(overrides = {}) {
  return { schemaVersion: 3, timePrecision: 'minute', clockKnown: true, registeredBaseline: true,
    requiredStartAt: REPLACED, freshQueryEligible: true, requiresRunRefresh: true,
    sourceLogId: 'fixture-approved-log', eventId: 'fixture-auto-replacement', ...overrides };
}
function freshAsset(overrides = {}) {
  const old = oldAsset();
  return { ...old, lastReplacementAt: REPLACED, cycleStartState: 'pending',
    cycleStartRevision: 'fixture-new-start', cycleRuntimeRevision: 'fixture-new-runtime',
    cycleElapsedHours: 0, runtimeHours: 0, measurementRequired: true, severity: 'startup_pending',
    cycleRuntimeState: 'unknown', operationState: 'unknown', isRunning: false,
    dataParcRuntimeBasis: null, hasUnverifiedDataParcHistory: false,
    runRuntime: { verified: false, source: 'unverified', state: 'unknown', measuredAt: '' },
    replacementAutoCycle: proof(), ...overrides };
}
function dayAsset() {
  return freshAsset({ lastReplacementAt: '2026-11-02T15:00:00.000Z',
    replacementAutoCycle: proof({ timePrecision: 'day', clockKnown: false, registeredBaseline: false,
      requiredStartAt: '', freshQueryEligible: false }) });
}
function page(phase, options = {}) {
  return { ok: true, version: 'bounded-logs-v1', phase, done: true, window: { ...WINDOW }, nextCursor: null,
    scannedLogCount: phase === 'replacement' ? 1 : 0, insertedCount: 0, appliedStateChanges: 0,
    replacementAutoVersion: 3, ...Object.fromEntries(COUNTER_KEYS.map(key => [key, 0])), ...options };
}
function accepted(task, status = 'complete') {
  return { ok: true, atomic: true, batchVersion: 1, requestedCount: 1,
    results: [{ ok: true, assetTag: TAG, item: { id: 'fixture-new-run', status,
      requestType: 'blower_runtime_probe', probe: { assetTag: TAG, requestId: 'fixture-new-run' } } }] };
}
function node() {
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, title: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {}, addEventListener() {},
    showModal() { this.open = true; }, close() { this.open = false; } };
}
function data(asset) {
  return { assets: [asset], events: [{ id: 'fixture-old-replacement', tagNumber: TAG,
    eventType: 'replacement', sourceType: 'manual', eventDate: oldAsset().lastReplacementAt,
    actionType: 'V-Belt 교체', note: 'Synthetic old-belt history retained', createdAt: NOW, updatedAt: NOW }],
    permissions: { canWrite: true }, user: { name: 'Fixture', employeeNo: 'fixture-employee' },
    backfill: { hasRun: true, status: 'complete' }, missingSlots: [], missingTags: [],
    settings: { fbhe: { cycleDays: 90, warningDays: 7, criticalDays: 3 } }, types: [] };
}
function harness({ initial = oldAsset(), replacementReply, operationReply, pausePhase = '', resume, freshOverrides = {}, reloadError } = {}) {
  const nodes = new Map(), calls = [], storage = new Map(), toasts = [];
  let stored = structuredClone(initial), ui;
  const replacement = replacementReply || page('replacement', { insertedCount: 99, autoAppliedReplacementCount: 1,
    autoCorrectedReplacementCount: 2, autoRetractedReplacementCount: 3,
    autoHistoricalReplacementCount: 4, autoLinkedReplacementCount: 5, autoConfirmedReplacementCount: 6 });
  const runtimeCore = { ...core, refreshLogsForRuntime: (io, options) => core.refreshLogsForRuntime(io, {
    ...options, sleep: async () => {}, ...(pausePhase ? { maxPages: pausePhase === 'replacement' ? 1 : 2 } : {})
  }) };
  const context = vm.createContext({ console, Date, clearTimeout() {}, performance: { now: () => 0 },
    HTMLButtonElement: class {}, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: runtimeCore, matchMedia: () => ({ matches: false }),
      sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key) }, setTimeout(fn) { fn(); },
      setInterval() { return 1; }, clearInterval() {}, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui={state,elements,cacheElements,renderAssetCard,
    renderAllOverviewCard,openAssetHistory,renderHistory,refreshAllBlowers,scanShiftLogs};
    globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;getSessionToken=()=> '${TOKEN}';
      currentServerDate=()=>new Date('${NOW}');showToast=h.toast;setBusy=v=>{state.busy=v;};
      startUnifiedRefreshFeedback=()=>{};finishUnifiedRefreshFeedback=()=>{};
      renderAssets=()=>{};renderOverviewRefreshPanel=()=>{};};\n` + marker), context);
  ui = context.ui; ui.cacheElements(); ui.state.data = data(structuredClone(initial));
  if (resume) { ui.state.unifiedRuntimeResume = resume; ui.state.unifiedRuntimeResumeOwner = TOKEN; }
  context.hooks({ toast: (...args) => toasts.push(args),
    async load() {
      calls.push({ kind: 'reload' });
      if (reloadError) throw reloadError;
      ui.state.data = data(structuredClone(stored)); return ui.state.data;
    },
    async api(request) {
      calls.push({ kind: request.body?.action || (request.url?.includes('refresh_state_page') ? 'plan' : 'status'),
        request: structuredClone(request) });
      if (request.body?.action === 'latest_logs_step') {
        if (request.body.phase === 'replacement') {
          stored = freshAsset(freshOverrides);
          return structuredClone(replacement);
        }
        return structuredClone(operationReply || page('operation'));
      }
      if (request.url?.includes('refresh_state_page')) return { ok: true, version: 'blower-refresh-state-page-v1',
        done: true, nextCursor: null, generatedAt: NOW, user: data(stored).user,
        permissions: { canWrite: true }, assets: [structuredClone(stored)] };
      if (request.body?.action === 'create_blower_runtime_probe_batch') return accepted(request.body.requests[0]);
      if (request.body?.action === 'dataparc_runtime_sync') return { ok: true, tagNumber: TAG,
        requestId: request.body.requestId, message: 'Fixture new belt RUN result applied' };
      if (!request.body && request.url?.includes('fixture-new-run')) return { items: [{ id: 'fixture-new-run', status: 'complete' }] };
      throw new Error('Unexpected fixture request: ' + JSON.stringify(request));
    } });
  return { ui, calls, toasts, context, storage, get stored() { return stored; },
    set stored(value) { stored = value; } };
}

test('a minute-precision automatic replacement at 09:58 permits a fresh new-belt query with the new cycle snapshot', () => {
  const assets = CATALOG.map(([tagNumber, blowerType, unitNo, assetGroup = '']) => freshAsset({
    tagNumber, blowerType, unitNo, assetGroup, displayName: tagNumber,
    dataParcTag: tagNumber === '104ETH03AN602' ? 'GSPOGE.ABB_DCS.003ETH03AN602XB04'
      : `GSPOGE.ABB_DCS.TEST_ONLY_CONFIRMED_BINARY_${tagNumber}`,
    hasUnverifiedDataParcHistory: true, dataParcRuntimeBasis: null,
    runtimeHours: null, cycleElapsedHours: null,
    replacementAutoCycle: proof({ storedRuntimeHours: 0, storedLegacyRuntimeHours: 0 }),
    cycleStartRevision: `fixture-new-start-${tagNumber}`, cycleRuntimeRevision: `fixture-new-runtime-${tagNumber}`,
    ...(blowerType === 'limestone' ? { limestoneAutoApply: false, limestoneBasisConfirmed: false,
      limestoneRunDisputed: true } : {})
  }));
  const before = structuredClone(assets);
  const result = core.plan(assets, new Date(NOW), () => oldAsset().dataParcRuntimeBasis);
  assert.equal(new Set(assets.map(asset => asset.tagNumber)).size, 27);
  assert.equal(result.targetCount, 27);
  assert.equal(result.tasks.length, 27);
  assert.equal(result.skipped.length, 0);
  assert.ok(assets.some(asset => asset.assetGroup === 'manure'));
  for (const task of result.tasks) {
    const asset = assets.find(a => a.tagNumber === task.snapshot.tagNumber);
    assert.equal(task.replacementAutoFresh, true, asset.tagNumber);
    assert.equal(task.incremental, false, asset.tagNumber);
    assert.notEqual(task.previewOnly, true, 'fresh server evidence supersedes an older Limestone dispute');
    assert.equal(task.startAt, REPLACED, asset.tagNumber);
    assert.equal(task.queryStartAt, REPLACED, asset.tagNumber);
    assert.equal(task.snapshot.cycleStartRevision, asset.cycleStartRevision);
    assert.equal(task.snapshot.cycleRuntimeRevision, asset.cycleRuntimeRevision);
  }
  assert.deepEqual(assets, before, 'fresh planning preserves all 27 reset counters, proofs and revised cycle identities');
});

test('day-only automatic replacement holds RUN without turning midnight into a measured replacement time', () => {
  const asset = dayAsset(), before = structuredClone(asset), result = core.plan([asset], new Date(NOW));
  assert.equal(result.tasks.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].message, '교체 자동반영 완료 · 완료 시각 미기록 · 새 벨트 RUN 기준 확인 필요');
  const view = core.fbheSealRunView(asset);
  assert.equal(view.verified, false);
  assert.ok(!view.primary.includes('0.0시간'));
  const { ui } = harness({ initial: asset }); ui.openAssetHistory(TAG);
  for (const markup of [ui.renderAssetCard(asset, { cycleDays: 90 }),
    ui.renderAllOverviewCard(asset), ui.elements.historyCycleSummary.innerHTML]) {
    assert.ok(markup.includes('완료 시각 미기록'));
    assert.ok(!markup.includes('0.0시간'));
    assert.ok(!markup.includes('200.0시간'));
    assert.doesNotMatch(markup, /operation-pill stopped|class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
  }
  assert.deepEqual(asset, before);
});

test('minute-precision automatic replacement displays the confirmed 09:58 basis and unmeasured new-belt RUN', () => {
  const asset = freshAsset(), before = structuredClone(asset), { ui } = harness({ initial: asset });
  const view = core.fbheSealRunView(asset);
  assert.equal(view.verified, false);
  assert.ok(!view.primary.includes('0.0시간'));
  ui.openAssetHistory(TAG);
  for (const markup of [ui.renderAssetCard(asset, { cycleDays: 90 }),
    ui.renderAllOverviewCard(asset), ui.elements.historyCycleSummary.innerHTML]) {
    assert.ok(markup.includes('09:58'), 'minute-level completion time remains visible in the cycle basis');
    assert.match(markup, /교체.*자동.*반영/);
    assert.match(markup, /RUN.*(?:대기|확인|조회)/);
    assert.ok(!markup.includes('0.0시간'));
    assert.ok(!markup.includes('200.0시간'));
    assert.doesNotMatch(markup, /operation-pill stopped|class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
  }
  assert.deepEqual(asset, before);
});

test('full VM refresh reads replacement facts before planning and creates only one new-belt RUN request', async () => {
  const fixture = harness({ freshOverrides: { hasUnverifiedDataParcHistory: true } });
  await fixture.ui.refreshAllBlowers();
  const kinds = fixture.calls.map(call => call.kind);
  assert.deepEqual(kinds, ['latest_logs_step', 'latest_logs_step', 'plan',
    'create_blower_runtime_probe_batch', 'dataparc_runtime_sync', 'reload']);
  const log = fixture.calls.find(call => call.kind === 'latest_logs_step').request.body;
  assert.equal(log.replacementAutoVersion, 3);
  const submitted = fixture.calls.find(call => call.kind === 'create_blower_runtime_probe_batch').request.body.requests;
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].startAt, REPLACED);
  assert.equal(submitted[0].expectedCycleStartRevision, 'fixture-new-start');
  assert.equal(submitted[0].expectedCycleRuntimeRevision, 'fixture-new-runtime');
  assert.equal(submitted[0].requireIncrementalAppend, false);
  assert.equal(fixture.ui.state.unifiedRefreshResults[0].status, 'complete');
  assert.equal(fixture.stored.hasUnverifiedDataParcHistory, true,
    'a validated fresh replacement capability can query its new cycle despite an aggregate older-history flag');
  assert.match(fixture.ui.elements.unifiedRefreshDiagnosticText.textContent, /교체 자동반영 1건/);
  assert.match(fixture.ui.elements.unifiedRefreshDiagnosticText.textContent, /근거 정정 2건/);
  assert.match(fixture.ui.elements.unifiedRefreshDiagnosticText.textContent, /오귀속 철회 3건/);
  assert.match(fixture.ui.elements.unifiedRefreshDiagnosticText.textContent, /과거 이력 4건/);
  assert.match(fixture.ui.elements.unifiedRefreshDiagnosticText.textContent, /기존 이력 연결 5건/);
  assert.match(fixture.ui.elements.unifiedRefreshDiagnosticText.textContent, /확정 근거 반영 6건/);
  assert.doesNotMatch(fixture.ui.elements.unifiedRefreshDiagnosticText.textContent, /교체 자동반영 99건/,
    'detected candidates cannot be relabeled as applied replacements');
  assert.ok(fixture.ui.state.data.events.some(event => event.id === 'fixture-old-replacement'), 'old belt history stays readable');
});

test('an incomplete V3 replacement scan reloads recorded facts but starts no RUN from the old cached basis', async () => {
  const replacementReply = page('replacement', {
    done: false, nextCursor: { workDate: '2026-11-03', updatedAt: NOW, id: 'fixture-log-1' }, autoAppliedReplacementCount: 1
  });
  const fixture = harness({ pausePhase: 'replacement', replacementReply });
  await fixture.ui.refreshAllBlowers();
  assert.deepEqual(fixture.calls.map(call => call.kind), ['latest_logs_step', 'reload']);
  assert.ok(fixture.ui.state.unifiedLogResume, 'retain the successful replacement page checkpoint');
  assert.equal(fixture.ui.state.unifiedLogResume.phase, 'replacement');
  assert.equal(fixture.ui.state.data.assets[0].cycleStartRevision, 'fixture-new-start');
  assert.notEqual(fixture.ui.elements.unifiedRefreshStatus.dataset.state, 'complete');

  const failedRead = harness({ pausePhase: 'replacement', replacementReply,
    reloadError: Object.assign(new Error('Fixture committed read failed'), { retryable: false, status: 409 }) });
  await failedRead.ui.refreshAllBlowers();
  assert.deepEqual(failedRead.calls.map(call => call.kind), ['latest_logs_step', 'reload'],
    'the catch path reuses the rejected committed read instead of issuing another full reload');
  assert.ok(failedRead.ui.state.unifiedLogResume, 'a failed facts read cannot erase completed replacement-page progress');
  assert.equal(failedRead.ui.state.unifiedLogResume.phase, 'replacement');
  assert.equal(failedRead.ui.elements.unifiedRefreshStatus.dataset.state, 'failed');
});

test('a pause after replacement completion may continue from the newly read cycle without replaying the replacement page', async () => {
  const fixture = harness({ pausePhase: 'operation', operationReply: page('operation', { done: false, scannedLogCount: 1,
    nextCursor: { workDate: '2026-11-03', updatedAt: NOW, id: 'fixture-operation-1' } }) });
  await fixture.ui.refreshAllBlowers();
  assert.equal(fixture.calls.filter(call => call.kind === 'create_blower_runtime_probe_batch').length, 1);
  assert.equal(fixture.calls.find(call => call.kind === 'create_blower_runtime_probe_batch').request.body.requests[0].startAt, REPLACED);
  assert.equal(fixture.ui.state.unifiedLogResume.phase, 'operation');
  assert.notEqual(fixture.ui.elements.unifiedRefreshStatus.dataset.state, 'complete');
});

test('an accepted RUN checkpoint resumes only its accepted ID without rescanning replacement logs or creating a duplicate', async () => {
  const asset = freshAsset(), task = core.plan([asset], new Date(NOW)).tasks[0];
  const resume = { version: 1, tasks: [{ ...task, asset: { tagNumber: TAG, displayName: asset.displayName } }],
    createdBatch: accepted(task, 'pending'), outcomes: [], skipped: [], targetCount: 1 };
  const before = structuredClone(resume), fixture = harness({ initial: asset, resume });
  await fixture.ui.refreshAllBlowers();
  assert.deepEqual(fixture.calls.map(call => call.kind), ['status', 'dataparc_runtime_sync', 'reload']);
  assert.equal(fixture.calls[1].request.body.requestId, 'fixture-new-run');
  assert.equal(fixture.ui.state.unifiedRuntimeResume, null);
  assert.deepEqual(resume, before);
});

function logsFixture(replies) {
  const calls = [], checkpoints = [], reports = [];
  return { calls, checkpoints, reports, io: { assertWritable() {},
    checkpoint(value) { checkpoints.push(structuredClone(value)); },
    logProgress(value) { reports.push(structuredClone(value)); },
    async api(request) {
      calls.push(structuredClone(request));
      const response = replies[calls.length - 1];
      assert.ok(response, 'no unexpected extra log page');
      if (response instanceof Error) throw response;
      return structuredClone(response);
    } } };
}

test('V3 aggregates actual applied, corrected, retracted, historical and linked replacement counts separately from detections', async () => {
  const first = page('replacement', { done: false, insertedCount: 50,
    nextCursor: { workDate: '2026-11-03', updatedAt: NOW, id: 'fixture-first-page' },
    autoAppliedReplacementCount: 2, autoCorrectedReplacementCount: 1, autoRetractedReplacementCount: 1,
    autoHistoricalReplacementCount: 3, autoLinkedReplacementCount: 4, autoConfirmedReplacementCount: 6 });
  const second = page('replacement', { insertedCount: 7, autoAppliedReplacementCount: 1,
    autoCorrectedReplacementCount: 2, autoRetractedReplacementCount: 0,
    autoHistoricalReplacementCount: 1, autoLinkedReplacementCount: 5, autoConfirmedReplacementCount: 2 });
  const operation = page('operation', { autoAppliedReplacementCount: 999, autoConfirmedReplacementCount: 999 });
  const f = logsFixture([first, second, operation]);
  const result = await core.refreshLogsForRuntime(f.io, { replacementAutoVersion: 3, sleep: async () => {} });
  assert.equal(result.complete, true);
  assert.equal(result.replacementComplete, true);
  assert.equal(result.runtimeAllowed, true);
  assert.equal(result.totals.insertedCount, 57, 'detection count remains independent of actual cycle changes');
  assert.deepEqual(Object.fromEntries(COUNTER_KEYS.map(key => [key, result.totals[key]])), {
    autoAppliedReplacementCount: 3, autoCorrectedReplacementCount: 3, autoRetractedReplacementCount: 1,
    autoHistoricalReplacementCount: 4, autoLinkedReplacementCount: 9, autoConfirmedReplacementCount: 8
  });
  assert.equal(f.calls[0].body.replacementAutoVersion, 3);
  assert.equal(f.calls[1].body.replacementAutoVersion, 3);
  assert.equal(f.calls[2].body.phase, 'operation');
  assert.equal(f.checkpoints.at(-1), null);
  assert.ok(f.checkpoints.some(c => c?.replacementAutoVersion === 3 && c.replacementComplete === true));
});

test('V3 rejects a replacement page from an older protocol before advancing or starting the operation phase', async () => {
  for (const version of [undefined, 2, '3']) {
    const f = logsFixture([page('replacement', { replacementAutoVersion: version })]);
    await assert.rejects(core.refreshLogsForRuntime(f.io, { replacementAutoVersion: 3, sleep: async () => {} }),
      error => error.code === 'INVALID_LOG_PAGE');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].body.phase, 'replacement');
    assert.ok(!f.checkpoints.some(c => c?.replacementComplete === true));
  }
});

test('requesting V3 discards an old operation-phase log checkpoint and begins a new replacement scan', async () => {
  const oldResume = { phase: 'operation', window: { ...WINDOW },
    cursor: { workDate: '2026-11-03', updatedAt: NOW, id: 'fixture-old-operation-cursor' }, limit: 1,
    totals: { scannedReplacementLogs: 999, autoAppliedReplacementCount: 999 } };
  const before = structuredClone(oldResume), f = logsFixture([page('replacement'), page('operation')]);
  const result = await core.refreshLogsForRuntime(f.io, { replacementAutoVersion: 3, resume: oldResume, sleep: async () => {} });
  assert.equal(f.calls[0].body.phase, 'replacement');
  assert.equal(f.calls[0].body.cursor, null);
  assert.equal(f.calls[0].body.window, null);
  assert.equal(result.totals.scannedReplacementLogs, 1);
  assert.equal(result.totals.autoAppliedReplacementCount, 0);
  assert.deepEqual(oldResume, before, 'old checkpoint evidence is not edited in place');
});

test('a V3 operation checkpoint retains replacement completion and can continue RUN despite a later pause', async () => {
  const cursor = { workDate: '2026-11-03', updatedAt: NOW, id: 'fixture-operation-cursor' };
  const f = logsFixture([page('operation', { done: false, scannedLogCount: 1,
    nextCursor: { ...cursor, id: 'fixture-operation-next' } })]);
  const result = await core.refreshLogsForRuntime(f.io, { replacementAutoVersion: 3, maxPages: 1,
    resume: { replacementAutoVersion: 3, replacementComplete: true, phase: 'operation',
      window: { ...WINDOW }, cursor, totals: { autoAppliedReplacementCount: 2 } }, sleep: async () => {} });
  assert.equal(result.complete, false);
  assert.equal(result.replacementComplete, true);
  assert.equal(result.runtimeAllowed, true);
  assert.equal(f.calls[0].body.phase, 'operation');
  assert.deepEqual(f.calls[0].body.cursor, cursor);
  assert.equal(f.checkpoints.at(-1).replacementAutoVersion, 3);
  assert.equal(f.checkpoints.at(-1).replacementComplete, true);
  assert.equal(f.checkpoints.at(-1).phase, 'operation');
});

test('legacy callers retain their existing log protocol without a new version requirement', async () => {
  const f = logsFixture([page('replacement', { replacementAutoVersion: undefined }), page('operation')]);
  const result = await core.refreshLogsForRuntime(f.io, { sleep: async () => {} });
  assert.equal(result.complete, true);
  assert.equal(f.calls[0].body.replacementAutoVersion, undefined);
  assert.equal(result.replacementComplete, undefined);
  assert.equal(result.runtimeAllowed, undefined);
});

test('fresh replacement proof rejects stale counters, missing revisions and missing or invalid time authority', () => {
  const valid = freshAsset();
  assert.deepEqual(core.freshReplacementQuery(valid, new Date(NOW)), { startAt: REPLACED });
  for (const change of [
    a => { a.runtimeHours = a.cycleElapsedHours = 1; },
    a => { a.runtimeHours = a.cycleElapsedHours = null; },
    a => { a.cycleStartRevision = ''; },
    a => { a.cycleRuntimeRevision = ''; },
    a => { a.replacementAutoCycle.sourceLogId = ''; },
    a => { a.replacementAutoCycle.eventId = ''; },
    a => { a.replacementAutoCycle.requiredStartAt = 'invalid'; },
    a => { a.replacementAutoCycle.requiredStartAt = '2026-11-02T00:00:00Z'; },
    a => { a.replacementAutoCycle.clockKnown = false; a.replacementAutoCycle.registeredBaseline = false; },
    a => { a.replacementAutoCycle.freshQueryEligible = false; }
  ]) {
    const asset = freshAsset(); change(asset);
    const before = structuredClone(asset);
    assert.equal(core.freshReplacementQuery(asset, new Date(NOW)), null);
    const result = core.plan([asset], new Date(NOW));
    assert.equal(result.tasks.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.deepEqual(asset, before);
  }
});

test('the work-log analysis button uses the same V3 replacement, fresh-plan and RUN controller', async () => {
  const fixture = harness();
  await fixture.ui.scanShiftLogs();
  assert.deepEqual(fixture.calls.map(call => call.kind), ['latest_logs_step', 'latest_logs_step', 'plan',
    'create_blower_runtime_probe_batch', 'dataparc_runtime_sync', 'reload']);
  assert.equal(fixture.calls[0].request.body.replacementAutoVersion, 3);
  assert.equal(fixture.calls[0].request.body.phase, 'replacement');
  assert.equal(fixture.calls.filter(call => call.kind === 'create_blower_runtime_probe_batch').length, 1);
  assert.ok(!fixture.calls.some(call => ['scan_shift_logs', 'operation_sync', 'sync_operations'].includes(call.kind)),
    'no unguarded legacy analysis or operation synchronization path is invoked');
  assert.equal(fixture.ui.elements.scanButton.textContent, '업무일지 분석');
  assert.equal(fixture.ui.state.busy, false);
  assert.equal(fixture.ui.state.unifiedRefreshBusy, false);
});

test('V3 day-precision history shows an unknown completion time and reconciliation uses a readable label and prose', () => {
  const asset = dayAsset(), fixture = harness({ initial: asset });
  const dayEvent = { id: 'fixture-v3-day-replacement', tagNumber: TAG, eventType: 'replacement',
    sourceType: 'shift_log_auto_v3', replacementAutoV3: true, sourceTimePrecision: 'day',
    eventDate: '2026-11-02T15:00:00.000Z', runtimeHours: 0, sourceLogId: 'fixture-v3-day-log',
    issueType: '정기주기', actionType: 'V-Belt 교체',
    sourceText: '[TM] 2호기 FBHE Blower #B V-Belt 교체 완료. 완료 시각은 일지에 기록되지 않음.',
    createdAt: NOW, updatedAt: NOW };
  const correction = { id: 'fixture-v3-reconcile', tagNumber: TAG, eventType: 'cycle_source_reconcile',
    sourceType: 'shift_log_auto_v3', replacementAutoV3: true, eventDate: NOW, runtimeHours: 0,
    actionType: '교체 근거 정정', note: '다른 설비에 귀속된 교체 근거를 정정하고 기존 이력을 보존했습니다.',
    sourceText: '{"schemaVersion":3,"action":"cycle_source_reconcile"}', createdAt: NOW, updatedAt: NOW };
  fixture.ui.state.data.events.push(dayEvent, correction);
  const before = structuredClone(fixture.ui.state.data.events);
  fixture.ui.openAssetHistory(TAG);
  fixture.ui.elements.historyFilter.value = 'all';
  fixture.ui.renderHistory();
  for (const markup of [fixture.ui.elements.assetHistoryList.innerHTML, fixture.ui.elements.historyBody.innerHTML]) {
    const visible = markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.match(visible, /2026-11-03 · 완료 시각 미기록/);
    assert.ok(!visible.includes('00:00'), 'the day-only zero sentinel cannot look like an actual midnight completion');
    assert.ok(!visible.includes('0.0시간'));
    assert.match(visible, /교체 근거 정정/);
    assert.match(visible, /다른 설비에 귀속된 교체 근거를 정정하고 기존 이력을 보존했습니다/);
    assert.ok(!visible.includes('cycle_source_reconcile'), 'an internal enum is never shown as the event label or content');
  }
  assert.deepEqual(fixture.ui.state.data.events, before, 'formatting does not change stored sentinel or correction evidence');
});

test('an unregistered day-only replacement keeps a measured two-hour range visible but cannot append or claim a current RUN state', () => {
  const asset = dayAsset();
  Object.assign(asset.replacementAutoCycle, { requiresRunRefresh: false, freshQueryEligible: false });
  Object.assign(asset, { cycleElapsedHours: 2, runtimeHours: 2, measurementRequired: false,
    cycleRuntimeState: 'running', operationState: 'running', isRunning: true,
    cycleRuntimeAnchorAt: '2026-11-03T03:00:00.000Z' });
  asset.dataParcRuntimeBasis = { requestId: 'fixture-day-range', eventId: 'dataparc_runtime:fixture-day-range',
    startAt: asset.lastReplacementAt, observedAt: '2026-11-03T03:00:00.000Z', dataParcTag: SIGNAL,
    runtimeHours: 2, runningSeconds: 7200, coverageComplete: true, appendReady: true };
  asset.runRuntime = { verified: true, source: 'dataparc', state: 'running', measuredAt: '2026-11-03T03:00:00.000Z' };
  asset.cycleSourceReview = { code: 'REPLACEMENT_COMPLETION_TIME_MISSING',
    message: '교체 자동반영 완료 · 완료 시각 미기록', measuredRangeMayContinue: false };
  const before = structuredClone(asset), plan = core.plan([asset], new Date(NOW));
  assert.equal(plan.tasks.length, 0, 'requiresRunRefresh=false does not certify an unknown physical completion time');
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].message, /교체 자동반영 완료.*완료 시각 미기록/);
  const view = core.fbheSealRunView(asset, asset.dataParcRuntimeBasis);
  assert.equal(view.hours, 2);
  assert.equal(view.primary, '2.0시간');
  assert.equal(view.state, 'unknown');
  assert.equal(view.verified, false);
  const { ui } = harness({ initial: asset }); ui.openAssetHistory(TAG);
  for (const markup of [ui.renderAssetCard(asset, { cycleDays: 90 }),
    ui.renderAllOverviewCard(asset), ui.elements.historyCycleSummary.innerHTML]) {
    assert.ok(markup.includes('2.0시간'), 'keep the measured range, without inventing a new-belt total');
    assert.ok(markup.includes('교체 자동반영 완료'));
    assert.ok(markup.includes('완료 시각 미기록'));
    assert.ok(!markup.includes('0.0시간'));
    assert.ok(!markup.includes('오귀속'), 'missing completion time must not be described as misattributed work');
    assert.doesNotMatch(markup, /기동중|정지중|operation-pill (?:running|stopped)|class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
  }
  assert.deepEqual(asset, before);

  const registered = structuredClone(asset);
  Object.assign(registered.replacementAutoCycle, { registeredBaseline: true,
    requiredStartAt: registered.dataParcRuntimeBasis.startAt });
  const allowed = core.plan([registered], new Date(NOW));
  assert.equal(allowed.tasks.length, 1, 'an explicitly registered baseline remains usable despite day-only source wording');
  assert.equal(allowed.tasks[0].incremental, true);
  assert.equal(allowed.tasks[0].queryStartAt, registered.dataParcRuntimeBasis.observedAt);
});

test('hidden public reset counters require both exact server-owned zeros and never override a finite current counter', () => {
  const projected = () => freshAsset({ runtimeHours: null, cycleElapsedHours: null,
    replacementAutoCycle: proof({ storedRuntimeHours: 0, storedLegacyRuntimeHours: 0 }) });
  const asset = projected(), before = structuredClone(asset);
  assert.deepEqual(core.freshReplacementQuery(asset, new Date(NOW)), { startAt: REPLACED });
  assert.equal(core.plan([asset], new Date(NOW)).tasks[0].replacementAutoFresh, true);
  const view = core.fbheSealRunView(asset), { ui } = harness({ initial: asset });
  assert.equal(view.hours, null, 'a reset checkpoint is not a measured zero-hour RUN result');
  assert.equal(view.verified, false);
  ui.openAssetHistory(TAG);
  for (const markup of [ui.renderAssetCard(asset, { cycleDays: 90 }),
    ui.renderAllOverviewCard(asset), ui.elements.historyCycleSummary.innerHTML]) {
    assert.match(markup, /RUN.*(?:대기|조회|확인)/);
    assert.ok(!markup.includes('0.0시간'));
    assert.doesNotMatch(markup, /operation-pill stopped|class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
  }
  assert.deepEqual(asset, before);

  for (const [storedRuntimeHours, storedLegacyRuntimeHours] of [
    [0, undefined], [undefined, 0], [0, 1], [1, 0], [false, 0], [0, false],
    ['0', 0], [0, '0'], [null, 0], [0, null]
  ]) {
    const invalid = projected();
    Object.assign(invalid.replacementAutoCycle, { storedRuntimeHours, storedLegacyRuntimeHours });
    const original = structuredClone(invalid);
    assert.equal(core.freshReplacementQuery(invalid, new Date(NOW)), null,
      'one zero, nonzero, boolean, string or missing metadata cannot authorize a hidden reset');
    assert.equal(core.plan([invalid], new Date(NOW)).tasks.length, 0);
    assert.deepEqual(invalid, original);
  }
  const notEligible = projected();
  notEligible.replacementAutoCycle.freshQueryEligible = false;
  assert.equal(core.freshReplacementQuery(notEligible, new Date(NOW)), null);
  const changed = projected();
  changed.runtimeHours = changed.cycleElapsedHours = 2;
  assert.equal(core.freshReplacementQuery(changed, new Date(NOW)), null,
    'a finite current value takes priority over older zero metadata');
  assert.equal(core.plan([changed], new Date(NOW)).tasks.length, 0);
});
