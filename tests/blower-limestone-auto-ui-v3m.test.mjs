import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');

const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../maintenance/blower-history.html', import.meta.url), 'utf8');
const marker = '  if (document.readyState === "loading") {';
const tags = ['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'];
const now = '2026-11-02T12:30:00.000Z';

function element() {
  return { innerHTML: '', textContent: '', value: '', disabled: false, hidden: false,
    open: false, style: {}, dataset: {}, listeners: {},
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {},
    showModal() { this.open = true; }, close() { this.open = false; },
    addEventListener(type, callback) { this.listeners[type] = callback; },
    classList: { toggle() {}, add() {}, remove() {} },
    getAttribute() { return null; }, closest() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; } };
}

function asset(tag, certified = false) {
  const replacement = tag === '203HRJ01AN601'
    ? '2026-05-12T00:00:00+09:00' : '2026-09-22T00:00:00+09:00';
  return { enabled: true, tagNumber: tag, blowerType: 'limestone',
    displayName: `Limestone ${tag}`, unitNo: tag.startsWith('203') ? '2' : '1',
    positionLabel: tag.endsWith('601') ? '#A' : '#B', sortOrder: 1,
    lastReplacementAt: replacement, cycleStartState: 'legacy',
    cycleStartRevision: 'saved-cycle', cycleRuntimeRevision: 'saved-runtime',
    cycleRuntimeTracked: true, cycleRuntimeState: 'running', isRunning: true,
    operationState: 'running', severity: 'normal', runtimeAccumulationMode: 'measured_only',
    limestoneRunDisputed: !certified, limestoneBasisConfirmed: certified,
    cycleElapsedHours: certified ? 1111.5 : tag === '203HRJ01AN601' ? 4080.1 : tag === '103HRJ01AN602' ? 922.1 : 921.9,
    dataParcTag: `GSPOGE.ABB_DCS.${tag}XB04`,
    dataParcRuntimeBasis: { startAt: replacement,
      observedAt: certified ? '2026-11-02T21:00:00+09:00' : '2026-10-30T10:31:00+09:00' } };
}

function ledger(a) {
  return { tagNumber: a.tagNumber, dataParcTag: a.dataParcTag,
    lastReplacementAt: a.lastReplacementAt, cycleStartRevision: a.cycleStartRevision,
    totalRunningSeconds: 24 * 3600, segmentCount: 2, endState: 'stopped',
    coverageStartAt: '2026-10-30T16:23:00+09:00', observedAt: '2026-10-31T16:30:00+09:00' };
}

function harness({ mobile = false, canWrite = true, certified = false } = {}) {
  const nodes = new Map(), calls = [], loads = [], toasts = [];
  const context = vm.createContext({ console, HTMLButtonElement: class {},
    localStorage: { getItem() { return null; } }, navigator: {}, URL, Date, Number, Intl, Map, Set,
    window: { addEventListener() {}, matchMedia: () => ({ matches: mobile }), setTimeout() { return 0; } },
    document: { readyState: 'loading', body: element(), addEventListener() {}, querySelectorAll() { return []; },
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } } });
  const expose = `globalThis.ui = { state, elements, cacheElements, bindEvents,
    renderAllOverviewCard, renderAssetCard, openAssetHistory, verifiedLimestoneRunDisplay,
    isLimestoneDisputedAsset, openLimestoneBasisDialog, saveLimestoneBasis };
    globalThis.hooks = h => { apiRequest = h.api; loadData = h.load; showToast = h.toast;
      currentServerDate = () => new Date('${now}'); setBusy = value => { state.busy = value; }; };\n`;
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, expose + marker), context);
  const ui = context.ui;
  ui.cacheElements(); ui.bindEvents();
  const assets = tags.map(tag => asset(tag, certified));
  ui.state.data = { permissions: { canWrite }, user: canWrite ? { name: 'Tester' } : null,
    assets, limestoneRunTracking: assets.map(ledger), events: [], types: [], settings: {}, missingSlots: [],
    backfill: { hasRun: true, status: 'complete' } };
  let request = async () => ({ ok: true, limestoneBasisConfirmed: true, requiresFullRunRefresh: true });
  context.hooks({ api: async options => { calls.push(JSON.parse(JSON.stringify(options))); return request(options); },
    load: async options => { loads.push(options); }, toast: (...args) => { toasts.push(args); } });
  const open = (tag = tags[0]) => ui.openLimestoneBasisDialog(tag);
  const submit = () => ui.elements.limestoneBasisForm.listeners.submit({ preventDefault() {} });
  return { ui, assets, calls, loads, toasts, open, submit, context, setRequest(fn) { request = fn; } };
}


function automatic(options = {}) {
  const h = harness(options);
  for (const a of h.assets) Object.assign(a, {
    limestoneAutoApply: true, limestoneBasisReviewRequired: true,
    limestoneRunDisputed: false, limestoneBasisConfirmed: false,
    cycleElapsedHours: 1111.5,
    dataParcRuntimeBasis: { startAt: a.lastReplacementAt, observedAt: '2026-11-02T21:00:00+09:00' }
  });
  return h;
}

for (const tag of tags) test(`${tag}: automatic measured totals and latest range do not need replacement confirmation`, () => {
  const { ui, assets, calls } = automatic();
  const a = assets.find(item => item.tagNumber === tag);
  const overview = ui.renderAllOverviewCard(a), detail = ui.renderAssetCard(a, null);
  for (const out of [overview, detail]) {
    assert.doesNotMatch(out, /previous-checkpoint|이전 저장 누적|누적 미반영|교체 기준 확인 필요|24\.0시간/);
    assert.match(out, /2026-11-02 21:00/);
    assert.match(out, /저장된 교체 기준으로 계산/);
  }
  assert.match(overview, /1,111\.5시간/);
  assert.equal(ui.verifiedLimestoneRunDisplay(a), null);
  assert.equal(a.limestoneBasisConfirmed, false);
  ui.openAssetHistory(tag);
  assert.equal(ui.elements.limestoneBasisButton.textContent, '교체 기준 정정');
  assert.equal(ui.elements.limestoneBasisDialog.open, false);
  assert.deepEqual(calls, [], 'rendering/opening history never asserts an actual replacement');
});

test('stale RUN preview and independent ledger cannot override an automatic full measurement', () => {
  const { ui, assets } = automatic(); const a = assets[0];
  ui.state.limestoneRunPreviews = { [a.tagNumber]: { previewOnly: true, previewState: 'stopped',
    previewObservedAt: '2026-10-31T16:30:00+09:00', previewStartAt: '2026-10-30T16:23:00+09:00', previewHours: 24 } };
  for (const out of [ui.renderAllOverviewCard(a), ui.renderAssetCard(a, null)]) {
    assert.doesNotMatch(out, /누적 미반영|최근 RUN 확인|24\.0시간|data-limestone-run-preview/);
    assert.match(out, /기동중/);
  }
});

test('pending motors with measured full RUN show the current reading through the real core renderer', () => {
  const { ui, assets, context } = automatic(); const a = assets[1];
  context.window.BlowerUnifiedRefresh = core;
  Object.assign(a, { cycleStartState: 'pending', measurementRequired: false,
    runRuntime: { verified: true, source: 'dataparc', state: 'running', measuredAt: '2026-11-02T21:00:00+09:00' } });
  const out = ui.renderAllOverviewCard(a);
  assert.match(out, /1,111\.5시간/); assert.match(out, /기동중/);
  assert.doesNotMatch(out, /기동 대기|누적 미반영|previous-checkpoint/);
});

test('missing measurement remains unknown until the real query finishes', () => {
  const { ui, assets } = automatic(); const a = assets[0];
  Object.assign(a, { cycleElapsedHours: null, measurementRequired: true,
    cycleRuntimeState: 'unknown', dataParcRuntimeBasis: null });
  const out = ui.renderAllOverviewCard(a);
  assert.match(out, /최신화 필요/);
  assert.doesNotMatch(out, /1,111\.5시간|24\.0시간|교체 기준 확인 필요/);
});

test('an actual explicit confirmation suppresses the provisional stored-basis note', () => {
  const { ui, assets } = automatic(); const a = assets[0];
  a.limestoneBasisConfirmed = true; a.limestoneBasisReviewRequired = false;
  assert.doesNotMatch(ui.renderAllOverviewCard(a), /data-limestone-saved-basis/);
});

test('automatic operation keeps optional correction hidden for anonymous and mobile readers', () => {
  for (const options of [{ canWrite: false }, { mobile: true }]) {
    const { ui, assets } = automatic(options); ui.openAssetHistory(assets[0].tagNumber);
    assert.equal(ui.elements.limestoneBasisButton.hidden, true);
    assert.match(ui.renderAllOverviewCard(assets[0]), /1,111\.5시간/);
  }
});

test('a legacy server snapshot keeps the old guard while the new HTML describes correction as optional', () => {
  const { ui, assets } = harness();
  assert.equal(ui.isLimestoneDisputedAsset(assets[0]), true);
  assert.match(ui.renderAllOverviewCard(assets[0]), /previous-checkpoint/);
  assert.match(html, /운전시간은 현재 저장된 교체 기준으로 자동 갱신됩니다/);
  assert.match(html, /20261102-auto-v3m/);
});
