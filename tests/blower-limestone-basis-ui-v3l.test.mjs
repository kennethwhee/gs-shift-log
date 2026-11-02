import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
  return { ui, assets, calls, loads, toasts, open, submit, setRequest(fn) { request = fn; } };
}

test('all three certified Limestone cards show the full new measurement and its latest range', () => {
  const { ui, assets } = harness({ certified: true });
  for (const a of assets) {
    assert.equal(ui.isLimestoneDisputedAsset(a), false);
    assert.equal(ui.verifiedLimestoneRunDisplay(a), null);
    const overview = ui.renderAllOverviewCard(a), detail = ui.renderAssetCard(a, null);
    for (const rendered of [overview, detail]) {
      assert.doesNotMatch(rendered, /이전 저장 누적|교체 기준 확인 필요|previous-checkpoint|최근 RUN 확인|24\.0시간/);
      assert.match(rendered, /2026-11-02 21:00/);
    }
    assert.match(overview, /1,111\.5시간/);
    assert.match(detail, /46일 7시간/);
    ui.openAssetHistory(a.tagNumber);
    assert.doesNotMatch(ui.elements.historyCycleSummary.innerHTML, /이전 저장 누적|data-limestone-run-audit|24\.0시간/);
    assert.equal(ui.elements.limestoneBasisButton.hidden, false);
    assert.equal(ui.elements.limestoneBasisButton.textContent, '교체 기준 정정');
  }
});

test('uncertified assets retain their previous checkpoints and keep measured RUN proof separate', () => {
  const { ui, assets } = harness();
  for (const a of assets) {
    const out = ui.renderAllOverviewCard(a);
    assert.equal(ui.isLimestoneDisputedAsset(a), true);
    assert.match(out, /data-limestone-display="previous-checkpoint"/);
    assert.match(out, /이전 저장 누적/);
    assert.match(out, /최근 RUN 확인 2026-10-31 16:30 · 누적 미반영/);
    assert.match(out, /2026-10-30 10:31/);
    assert.doesNotMatch(out, /<strong>24\.0시간<\/strong>/);
    ui.openAssetHistory(a.tagNumber);
    assert.equal(ui.elements.limestoneBasisButton.hidden, false);
  }
});

test('authoritative disputed boolean governs the UI and older server snapshots remain provisional', () => {
  const { ui, assets } = harness();
  const a = assets[0];
  a.limestoneBasisConfirmed = true;
  assert.equal(ui.isLimestoneDisputedAsset(a), true, 'authoritative server dispute wins over a stale confirmation flag');
  a.limestoneRunDisputed = false; a.limestoneBasisConfirmed = false;
  assert.equal(ui.isLimestoneDisputedAsset(a), false);
  delete a.limestoneRunDisputed;
  assert.equal(ui.isLimestoneDisputedAsset(a), true, 'legacy server cannot silently unlock TAG-only holds');
  assert.equal(ui.isLimestoneDisputedAsset({ ...a, tagNumber: '103HRJ01AN601' }), false);
  assert.equal(ui.isLimestoneDisputedAsset({ ...a, blowerType: 'seal_pot' }), false);
});

test('stale ledger state and an in-memory old preview cannot override a certified full-cycle result', () => {
  const { ui, assets } = harness({ certified: true });
  for (const a of assets) {
    ui.state.limestoneRunPreviews = { [a.tagNumber]: { previewOnly: true, previewState: 'stopped',
      previewObservedAt: '2026-10-31T17:58:00+09:00', previewHours: 29.3 } };
    const out = ui.renderAllOverviewCard(a);
    assert.match(out, /data-operation-state="running"/);
    assert.match(out, /1,111\.5시간/);
    assert.match(out, /2026-11-02 21:00/);
    assert.doesNotMatch(out, /누적 미반영|RUN=0|data-limestone-run-preview|2026-10-31 17:58/);
  }
});

test('delegated basis action opens empty actual-time and evidence fields and freezes current CAS guards', () => {
  const h = harness();
  h.ui.openAssetHistory(tags[0]);
  h.ui.elements.limestoneBasisAt.value = '2026-09-22T00:00';
  h.ui.elements.limestoneBasisEvidence.value = 'earlier entry';
  h.ui.elements.historyDialog.listeners.click({ target: { closest: () => ({ dataset: { historyAction: 'limestone_basis_confirm' } }) } });
  assert.equal(h.ui.elements.historyDialog.open, false);
  assert.equal(h.ui.elements.limestoneBasisDialog.open, true);
  assert.equal(h.ui.elements.limestoneBasisAt.value, '');
  assert.equal(h.ui.elements.limestoneBasisEvidence.value, '');
  assert.equal(h.ui.elements.limestoneBasisAt.max, '2026-11-02T21:30');
  assert.equal(Object.isFrozen(h.ui.state.limestoneBasisSnapshot), true);
});

test('mobile, read-only, busy and unrelated assets cannot open basis confirmation', () => {
  for (const options of [{ mobile: true }, { canWrite: false }]) {
    const h = harness(options);
    h.ui.openAssetHistory(tags[0]);
    assert.equal(h.ui.elements.limestoneBasisButton.hidden, true);
    h.open();
    assert.equal(h.ui.elements.limestoneBasisDialog.open, false, JSON.stringify(options));
  }
  for (const flag of ['busy', 'unifiedRefreshBusy', 'dataparcRuntimeBusy']) {
    const h = harness(); h.ui.state[flag] = true; h.open();
    assert.equal(h.ui.elements.limestoneBasisDialog.open, false, flag);
  }
  const h = harness(); h.open('103HRJ01AN601');
  assert.equal(h.ui.elements.limestoneBasisDialog.open, false);
});

test('certified basis correction requires fresh empty input and captures the current revisions', () => {
  const h = harness({ certified: true });
  const a = h.assets[0];
  a.cycleStartRevision = 'confirmed-cycle'; a.cycleRuntimeRevision = 'latest-measurement';
  a.lastReplacementAt = '2026-09-22T05:25:00.000Z';
  h.ui.elements.limestoneBasisAt.value = '2026-09-22T14:25';
  h.ui.elements.limestoneBasisEvidence.value = 'old confirmation evidence';
  h.ui.openAssetHistory(a.tagNumber);
  assert.equal(h.ui.elements.limestoneBasisButton.textContent, '교체 기준 정정');
  h.open();
  assert.equal(h.ui.elements.limestoneBasisDialog.open, true);
  assert.equal(h.ui.elements.limestoneBasisAt.value, '');
  assert.equal(h.ui.elements.limestoneBasisEvidence.value, '');
  assert.deepEqual(JSON.parse(JSON.stringify(h.ui.state.limestoneBasisSnapshot)), {
    tagNumber: a.tagNumber, expectedLastReplacementAt: a.lastReplacementAt,
    expectedCycleStartRevision: 'confirmed-cycle', expectedCycleRuntimeRevision: 'latest-measurement'
  });
});

test('empty or invalid actual time, future time and short evidence cannot submit a basis', async () => {
  const attempts = [
    { at: '', evidence: '현장 완료 확인 기록 12345' },
    { at: '2026-02-30T10:00', evidence: '현장 완료 확인 기록 12345' },
    { at: '2026-11-03T01:00', evidence: '현장 완료 확인 기록 12345' },
    { at: '2026-09-22T14:25', evidence: '' },
    { at: '2026-09-22T14:25', evidence: '123456789' }
  ];
  for (const attempt of attempts) {
    const h = harness(); h.open();
    h.ui.elements.limestoneBasisAt.value = attempt.at;
    h.ui.elements.limestoneBasisEvidence.value = attempt.evidence;
    await h.submit();
    assert.equal(h.calls.length, 0, JSON.stringify(attempt));
    assert.equal(h.ui.elements.limestoneBasisDialog.open, true);
    assert.equal(h.ui.elements.limestoneBasisError.hidden, false);
  }
});

test('basis submission sends exact KST completion, evidence and immutable open-time CAS, then requires full recalculation', async () => {
  const h = harness(); h.open();
  const original = { ...h.assets[0] };
  h.assets[0].cycleStartRevision = 'concurrently-changed';
  h.assets[0].cycleRuntimeRevision = 'concurrently-changed';
  h.assets[0].lastReplacementAt = '2026-09-23T00:00:00+09:00';
  h.ui.elements.limestoneBasisAt.value = '2026-09-22T14:25';
  h.ui.elements.limestoneBasisEvidence.value = '  정비 완료 기록 2026-09-22 현장 확인자 김담당  ';
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].body, { action: 'limestone_basis_confirm', tagNumber: tags[0],
    expectedLastReplacementAt: original.lastReplacementAt,
    expectedCycleStartRevision: original.cycleStartRevision,
    expectedCycleRuntimeRevision: original.cycleRuntimeRevision,
    replacementAt: '2026-09-22T05:25:00.000Z', evidence: '정비 완료 기록 2026-09-22 현장 확인자 김담당' });
  assert.equal(h.ui.elements.limestoneBasisDialog.open, false);
  assert.equal(h.ui.state.limestoneBasisSnapshot, null);
  assert.equal(h.loads.length, 1); assert.equal(h.loads[0].syncOperations, false);
  assert.ok(h.toasts.some(args => /전체 최신화/.test(args[0])));
  assert.equal(h.ui.elements.historyDialog.open, true);
});

test('a conflict or incomplete success response keeps the form and CAS snapshot available without accepting a save', async () => {
  for (const response of [async () => { throw new Error('교체 기준이 변경되었습니다.'); },
    async () => ({ ok: true, limestoneBasisConfirmed: true })]) {
    const h = harness(); h.open();
    h.ui.elements.limestoneBasisAt.value = '2026-09-22T14:25';
    h.ui.elements.limestoneBasisEvidence.value = '정비 완료 기록 및 현장 확인 결과';
    h.setRequest(response); await h.submit();
    assert.equal(h.ui.elements.limestoneBasisDialog.open, true);
    assert.equal(h.ui.elements.limestoneBasisError.hidden, false);
    assert.notEqual(h.ui.state.limestoneBasisSnapshot, null);
    assert.equal(h.ui.elements.limestoneBasisSave.disabled, false);
    assert.equal(h.loads.length, 0);
  }
});

test('basis form requires actual completion and evidence, identifies KST, and has mobile write guards', () => {
  assert.match(html, /id="limestoneBasisButton"[^>]*data-mobile-write[^>]*data-history-action="limestone_basis_confirm"[^>]*hidden/);
  assert.match(html, /실제 교체 완료일시 \(한국시간\)/);
  assert.match(html, /id="limestoneBasisAt"[^>]*type="datetime-local"[^>]*required/);
  assert.match(html, /id="limestoneBasisEvidence"[^>]*required[^>]*minlength="10"[^>]*maxlength="1500"/);
  assert.match(html, /id="limestoneBasisSave"[^>]*data-mobile-write/);
});
