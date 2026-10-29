import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const TAG = '204LMDF01AN001';
const START = '2026-09-11T04:27:00.000Z';
const SIGNAL = 'GSPOGE.ABB_DCS.204LMDF01AN001XB04';

function node() {
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, title: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {}, addEventListener() {},
    showModal() { this.open = true; }, close() { this.open = false; } };
}
function initialAsset() {
  return { tagNumber: TAG, displayName: '축분 Blower', blowerType: 'organic_fuel', assetGroup: 'manure',
    unitNo: '2', positionLabel: '#1', enabled: true, lastReplacementAt: START,
    cycleBasisKind: 'initial_startup', initialStartedAt: START, actualLastReplacementAt: '',
    cycleStartState: 'started', cycleStartedAt: START, cycleStoredStartedAt: START,
    cycleStartRevision: 'fixture-start', cycleRuntimeRevision: 'fixture-runtime',
    cycleRuntimeTracked: true, cycleRuntimeState: 'unknown', operationState: 'unknown',
    cycleElapsedHours: null, measurementRequired: true, isRunning: false,
    runtimeAccumulationMode: 'measured_only', severity: 'runtime_unknown',
    dataParcTag: SIGNAL, dataParcRuntimeBasis: null };
}
function initialEvent() {
  return { id: 'fixture-initial-start', tagNumber: TAG, eventType: 'startup', eventDate: START,
    runtimeHours: 0, sourceType: 'initial_startup_confirmed', actionType: '최초 기동 기준 등록',
    sourceText: '{"version":1}', note: '확인된 최초 기동 시각을 RUN 조회 시작 기준으로 등록했습니다.',
    createdAt: '2026-10-29T01:00:00Z', updatedAt: '2026-10-29T01:00:00Z' };
}
function harness({ mobile = false, write = true, virgin = false } = {}) {
  const nodes = new Map();
  const context = vm.createContext({ console, HTMLButtonElement: class {}, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia: () => ({ matches: mobile }),
      setTimeout(fn) { fn(); }, addEventListener() {} }
  });
  const marker = '  if (document.readyState === "loading") {';
  const expose = `globalThis.ui={state,elements,cacheElements,isInitialStartupBasis,cycleReferenceLabel,cycleReferenceDisplay,
    initialStartupEvidence,isAssetAwaitingBackfill,renderAssetCard,renderAllOverviewCard,openAssetHistory,
    openDataParcRuntimeDialog,canEditAnyHistoryEvent,canDeleteManualHistoryEvent,
    initializeConfirmedManureRun,refreshAllBlowers};
    globalThis.flowHooks=h=>{
      apiRequest=h.api;loadData=h.load;readUnifiedRefreshPlan=h.plan;showToast=h.toast;
      getSessionToken=()=> 'fixture-token';restoreUnifiedRuntimeResume=()=>{};
      startUnifiedRefreshFeedback=()=>{};finishUnifiedRefreshFeedback=()=>{};
      renderAssets=()=>{};renderOverviewRefreshPanel=()=>{};
      setBusy=value=>{state.busy=value;};
    };
  `;
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, expose + marker), context);
  const ui = context.ui;
  ui.cacheElements();
  const asset = initialAsset();
  if (virgin) Object.assign(asset, { lastReplacementAt: '', cycleBasisKind: 'none', initialStartedAt: '',
    cycleStartState: 'pending', cycleStartedAt: '', cycleStoredStartedAt: '' });
  ui.state.data = { assets: [asset], events: virgin ? [] : [initialEvent()],
    permissions: { canWrite: write }, user: write ? { name: 'Fixture', isSuperAdmin: true } : null,
    backfill: { hasRun: true, status: 'complete' }, missingSlots: [], missingTags: [],
    settings: { organic_fuel: { cycleDays: 90, warningDays: 7, criticalDays: 3 } }, types: [] };
  return { ui, context, asset };
}
function setupResponse(disposition = 'initialized') {
  return { ok: true, disposition, initialized: disposition === 'initialized', tagNumber: TAG,
    cycleBasisKind: 'initial_startup', initialStartedAt: START };
}

test('first startup has an exact KST label and cannot masquerade as a replacement or another asset', () => {
  const { ui, asset } = harness();
  assert.equal(ui.cycleReferenceLabel(asset), '최초 기동');
  assert.equal(ui.cycleReferenceDisplay(asset), '2026-09-11 13:27');
  for (const change of [{ tagNumber: '204SDF01AN001' }, { cycleBasisKind: 'replacement' },
    { initialStartedAt: 'invalid' }, { lastReplacementAt: '2026-09-12T04:27:00Z' }]) {
    assert.equal(ui.isInitialStartupBasis({ ...asset, ...change }), false);
  }
});

test('overview and detail cards show first startup and unmeasured RUN without a false zero', () => {
  const { ui, asset } = harness();
  for (const markup of [ui.renderAllOverviewCard(asset), ui.renderAssetCard(asset, { cycleDays: 90 })]) {
    assert.match(markup, /최초 기동/);
    assert.match(markup, /2026-09-11 13:27/);
    assert.match(markup, /최신화 필요/);
    assert.doesNotMatch(markup, /최근 (?:V-Belt )?교체/);
    assert.doesNotMatch(markup, />0\.0시간</);
  }
});

test('history keeps the startup record visible and protects its provenance from generic edit/delete', () => {
  const { ui, asset } = harness();
  ui.openAssetHistory(TAG);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /최초 기동/);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /2026-09-11 13:27/);
  assert.doesNotMatch(ui.elements.historyCycleSummary.innerHTML, /최근 V-Belt 교체/);
  assert.match(ui.elements.assetHistoryList.innerHTML, /확인된 최초 기동/);
  assert.match(ui.elements.assetHistoryList.innerHTML, /최초 기동 기준 등록/);
  assert.doesNotMatch(ui.elements.assetHistoryList.innerHTML, /data-history-action="history_event_(?:edit|delete)"/);
  assert.equal(ui.canEditAnyHistoryEvent(asset, initialEvent()), false);
  assert.equal(ui.canDeleteManualHistoryEvent(asset, initialEvent()), false);
  for (const eventType of ['startup', 'runtime', 'replacement', 'operation_start', 'operation_stop']) {
    const event = { ...initialEvent(), sourceType: 'manual', eventType };
    assert.equal(ui.canEditAnyHistoryEvent(asset, event), false, eventType);
    assert.equal(ui.canDeleteManualHistoryEvent(asset, event), false, eventType);
  }
  const problem = { ...initialEvent(), sourceType: 'manual', eventType: 'problem' };
  assert.equal(ui.canEditAnyHistoryEvent(asset, problem), true);
  assert.equal(ui.canDeleteManualHistoryEvent(asset, problem), true);
});

test('confirmed initial startup is independent of replacement backfill and uses its own evidence', () => {
  const { ui, asset } = harness();
  ui.state.data.backfill = { hasRun: false, requiresInitialRebuild: true };
  assert.equal(ui.isAssetAwaitingBackfill(asset), false);
  assert.equal(ui.initialStartupEvidence(asset).id, initialEvent().id);
  const markup = ui.renderAssetCard(asset, { cycleDays: 90 });
  assert.match(markup, /최초 기동 등록 근거/);
  assert.match(markup, /확인된 최초 기동 시각을 RUN 조회 시작 기준으로 등록했습니다/);
  assert.doesNotMatch(markup, /자동 이력 재확인 중/);
});

test('a real later replacement switches labels back without losing the older startup history', () => {
  const { ui, asset } = harness();
  Object.assign(asset, { cycleBasisKind: 'replacement', lastReplacementAt: '2026-10-20T00:00:00+09:00',
    actualLastReplacementAt: '2026-10-20T00:00:00+09:00' });
  assert.equal(ui.cycleReferenceLabel(asset), '최근 V-Belt 교체');
  const markup = ui.renderAllOverviewCard(asset);
  assert.match(markup, /최근 V-Belt 교체/);
  assert.match(markup, /2026-10-20/);
  ui.openAssetHistory(TAG);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /최근 V-Belt 교체/);
  assert.match(ui.elements.assetHistoryList.innerHTML, /최초 기동 기준 등록/);
  assert.equal(ui.canEditAnyHistoryEvent(asset, initialEvent()), false);
  assert.equal(ui.canDeleteManualHistoryEvent(asset, initialEvent()), false);
  for (const eventType of ['startup', 'runtime', 'replacement', 'problem']) {
    const event = { ...initialEvent(), sourceType: 'manual', eventType };
    assert.equal(ui.canEditAnyHistoryEvent(asset, event), true, eventType);
    assert.equal(ui.canDeleteManualHistoryEvent(asset, event), true, eventType);
  }
});

test('query settings use first-start wording and the canonical RUN source without PLOT', () => {
  const { ui } = harness();
  ui.openDataParcRuntimeDialog(TAG);
  assert.equal(ui.elements.dataparcRuntimeStartAt.value, '2026-09-11T13:27');
  assert.equal(ui.elements.dataparcRuntimeSourceTag.value, SIGNAL);
  assert.match(ui.elements.dataparcRuntimeMinimum.textContent, /최초 기동 이후/);
  assert.doesNotMatch(ui.elements.dataparcRuntimeMinimum.textContent, /V-Belt 교체/);
  assert.match(ui.elements.dataparcRuntimeSourceHelp.textContent, /실제 RUN=1 구간만 합산/);
});

test('initialization sends one fixed-purpose POST only after a complete scan and retains cached state until reread', async () => {
  const { ui, asset } = harness({ virgin: true });
  const before = JSON.stringify(asset), order = [];
  const result = await ui.initializeConfirmedManureRun({ assertWritable() { order.push('auth'); },
    progress() {}, async api(request) { order.push('post');
      assert.equal(request.method, 'POST');
      assert.deepEqual(JSON.parse(JSON.stringify(request.body)), { action: 'initialize_manure_run', unifiedRefresh: true });
      return setupResponse(); } }, { complete: true });
  assert.equal(result.initialized, true);
  assert.deepEqual(order, ['auth', 'post', 'auth']);
  assert.equal(JSON.stringify(asset), before);
});

test('incomplete scans, absent/disabled assets and existing cycles do not send initialization', async () => {
  for (const change of [f => { f.log.complete = false; }, f => { f.ui.state.data.assets = []; },
    f => { f.asset.enabled = false; }, f => { f.asset.enabled = 0; }, f => { f.asset.lastReplacementAt = START; }]) {
    const f = { ...harness({ virgin: true }), log: { complete: true } }; change(f);
    assert.equal(await f.ui.initializeConfirmedManureRun({ assertWritable() { throw Error('unexpected'); },
      progress() {}, api() { throw Error('unexpected'); } }, f.log), null);
  }
});

test('uncertain initialization response and changed authorization fail before planning', async () => {
  const { ui } = harness({ virgin: true });
  for (const response of [null, {}, { ...setupResponse(), ok: false },
    { ...setupResponse(), tagNumber: 'OTHER' }, { ...setupResponse(), disposition: 'unknown' }]) {
    await assert.rejects(ui.initializeConfirmedManureRun({ assertWritable() {}, progress() {}, api: async () => response },
      { complete: true }), /저장 결과를 확인하지 못했습니다/);
  }
  let calls = 0;
  await assert.rejects(ui.initializeConfirmedManureRun({ assertWritable() { throw Error('AUTH'); },
    progress() {}, api: async () => { calls++; } }, { complete: true }), /AUTH/);
  assert.equal(calls, 0);
});

function refreshHarness(options = {}) {
  const f = harness({ virgin: true, ...options }), order = [];
  const plan = { tasks: [], skipped: [], targetCount: 1 };
  const fakeCore = { ...core,
    async refreshLogsForRuntime() { order.push('logs'); return { complete: options.complete !== false, totals: {}, warning: 'incomplete' }; },
    async executeDataParcBatch() { order.push('execute'); return []; },
    async readWithRetry(operation) { return operation(); }, errorLabel: e => e.message };
  f.context.window.BlowerUnifiedRefresh = fakeCore;
  f.context.flowHooks({
    async api(request) { order.push(request.body?.action || 'api'); return setupResponse(); },
    async load() { order.push('load'); },
    async plan() { order.push('plan'); return plan; }, toast() {}
  });
  return { ...f, order };
}

test('full refresh performs logs, explicit initializer, and planning in that order', async () => {
  const f = refreshHarness();
  await f.ui.refreshAllBlowers();
  assert.deepEqual(f.order, ['logs', 'initialize_manure_run', 'plan', 'load']);
});

test('runtime resume never initializes, rescans logs or replans accepted requests', async () => {
  const f = refreshHarness();
  f.ui.state.unifiedRuntimeResume = { tasks: [{ asset: { tagNumber: TAG } }], skipped: [], targetCount: 1 };
  await f.ui.refreshAllBlowers();
  assert.deepEqual(f.order, ['execute', 'load']);
});

test('incomplete log scan keeps initialization deferred while retaining existing refresh flow', async () => {
  const f = refreshHarness({ complete: false });
  await f.ui.refreshAllBlowers();
  assert.deepEqual(f.order, ['logs', 'plan', 'load']);
});

for (const options of [{ mobile: true }, { write: false }]) test('mobile/public refresh never initializes: ' + JSON.stringify(options), async () => {
  const f = refreshHarness(options);
  await f.ui.refreshAllBlowers();
  assert.deepEqual(f.order, ['load']);
});

test('loading the frontend only registers DOM readiness; no initializer or API is called', () => {
  const { ui } = harness({ virgin: true });
  assert.equal(ui.state.unifiedRefreshBusy, false);
  assert.equal(ui.state.data.assets[0].lastReplacementAt, '');
  assert.equal(ui.state.data.events.length, 0);
});
