import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../maintenance/blower-history.html', import.meta.url), 'utf8');
const realCore = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const marker = '  if (document.readyState === "loading") {';
const now = '2026-11-02T12:30:00.000Z';
const tags = ['104ETG30AN601', '104ETH03AN602'];
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
  assert.equal(Boolean(predicate()), true, 'expected refresh phase was not reached');
}

function element() {
  const classes = new Set();
  return { innerHTML: '', textContent: '', value: '', hidden: true, disabled: false,
    open: false, style: {}, dataset: {}, attributes: {}, listeners: {}, classes,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name),
      toggle(name, value) { if (value) classes.add(name); else classes.delete(name); } },
    setAttribute(name, value) { this.attributes[name] = String(value); }, removeAttribute(name) { delete this.attributes[name]; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(type, fn) { this.listeners[type] = fn; }, replaceChildren() {}, focus() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    showModal() { this.open = true; }, close() { this.open = false; } };
}

function harness(options = {}) {
  const nodes = new Map(), body = element(), timers = new Map();
  const calls = { logs: 0, batch: 0, load: 0, api: [], toasts: [] };
  let time = 0, timerId = 0, ui;
  const assets = tags.map(tag => ({ tagNumber: tag, blowerType: 'flyash_bag', enabled: true,
    displayName: `Blower ${tag}`, unitNo: '1', positionLabel: '#A', severity: 'normal',
    lastReplacementAt: '2026-10-01T00:00:00.000Z', cycleStartState: 'legacy',
    cycleStartRevision: 'cycle-r1', cycleRuntimeRevision: 'runtime-r1', cycleStartedAt: '',
    dataParcTag: `GSPOGE.ABB_DCS.${tag}XB04`, dataParcRuntimeBasis: null,
    hasUnverifiedDataParcHistory: false, cycleElapsedHours: 205.3 }));
  const core = { ...realCore,
    readWithRetry: async read => read(),
    refreshLogsForRuntime: async io => {
      calls.logs++; io.logProgress?.({ scannedReplacementLogs: 7, scannedOperationLogs: 4 });
      if (options.logGate) await options.logGate.promise;
      return { complete: true, totals: {} };
    },
    executeDataParcBatch: async (tasks, io) => {
      calls.batch++; calls.tasks = tasks; calls.io = io;
      if (options.batch) return options.batch(tasks, io, calls.batch);
      return tasks.map(task => ({ tagNumber: task.snapshot.tagNumber, status: 'complete' }));
    }
  };
  const context = vm.createContext({ console, HTMLButtonElement: class {}, URL, Date, Number, String, Intl, Map, Set,
    localStorage: { getItem() { return null; } }, navigator: {}, performance: { now: () => time },
    document: { readyState: 'loading', body, addEventListener() {}, querySelectorAll() { return []; },
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia: () => ({ matches: false }), addEventListener() {},
      setTimeout() { return ++timerId; }, clearTimeout() {},
      setInterval(fn) { timers.set(++timerId, fn); return timerId; }, clearInterval(id) { timers.delete(id); },
      sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } } });
  const expose = `globalThis.ui = { state, elements, cacheElements, refreshAllBlowers,
    renderInlineRefreshStatus, observeUnifiedRefreshStatuses, observeUnifiedRefreshApply,
    startUnifiedRefreshFeedback, finishUnifiedRefreshFeedback, dismissUnifiedRefreshFeedback,
    setUnifiedRefreshPhase, renderUnifiedRefreshOutcome, updateOverviewRefreshProgress };
    globalThis.hooks = h => { apiRequest = h.api; loadData = h.load; showToast = h.toast;
      currentServerDate = () => new Date('${now}'); getSessionToken = () => 'test-session';
      setBusy = value => { state.busy = value; }; renderAssets = () => {}; renderOverviewRefreshPanel = () => {}; };\n`;
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, expose + marker), context);
  ui = context.ui; ui.cacheElements();
  ui.state.data = { user: { name: 'Tester', employeeNo: 'tester' }, permissions: { canWrite: true },
    assets, events: [], types: [], settings: {}, missingSlots: [], backfill: { hasRun: true, status: 'complete' } };
  context.hooks({ api: async request => {
    calls.api.push(JSON.parse(JSON.stringify(request)));
    if (request.method === 'POST') return typeof options.saveResponse === 'function' ? options.saveResponse(request)
      : options.saveResponse ?? { ok: true, requestId: request.body.requestId,
        tagNumber: request.body.requestId === 'request-2' ? tags[1] : tags[0], applied: true, replayed: false };
    return { ok: true, version: 'blower-refresh-state-page-v1', done: true, nextCursor: null,
      user: { name: 'Tester' }, permissions: { canWrite: true }, generatedAt: now, assets: assets.map(a => ({ ...a })) };
  }, load: async () => {
    calls.load++; if (options.finalGate) await options.finalGate.promise;
    if (options.finalError) throw options.finalError;
    return ui.state.data;
  }, toast: (...args) => calls.toasts.push(args) });
  return { ui, nodes, body, timers, calls, assets, core,
    tick(ms) { time = ms; for (const fn of [...timers.values()]) fn(); },
    run: () => ui.refreshAllBlowers(),
    count: () => ui.elements.overviewRefreshCount.textContent,
    phase: () => ui.elements.overviewRefreshProgressText.textContent };
}

function assertNoMask(h) {
  assert.equal(h.ui.elements.blowerQueryOverlay.hidden, true);
  assert.equal(h.body.classes.has('blower-query-active'), false);
  assert.equal(h.ui.elements.overviewRefreshInlineStatus.hidden, false);
}

test('actual refresh stays inline through log work, duplicate click, long elapsed time, and final completion', async () => {
  const gate = defer(), h = harness({ logGate: gate });
  const running = h.run();
  assertNoMask(h);
  assert.match(h.phase(), /교체|업무일지/);
  assert.equal(h.ui.elements.overviewRefreshCount.hidden, false, 'received log counts must actually be visible');
  const count = h.count(), percent = h.ui.state.unifiedRefreshProgressPct;
  h.tick(125000);
  assertNoMask(h); assert.equal(h.count(), count);
  assert.equal(h.ui.state.unifiedRefreshProgressPct, percent, 'elapsed time cannot invent completed work');
  assert.match(h.ui.elements.overviewRefreshElapsed.textContent, /02:05/);
  await h.run(); assert.equal(h.calls.logs, 1); assert.equal(h.calls.batch, 0);
  gate.resolve(); await running;
  assert.equal(h.calls.batch, 1); assert.equal(h.calls.load, 1);
  assert.equal(h.ui.elements.unifiedRefreshStatus.dataset.state, 'complete');
  assertNoMask(h); assert.equal(h.timers.size, 0);
  assert.equal(h.ui.state.unifiedRefreshBusy, false);
});

test('observed request completion and accepted save responses remain separate, unique counts', () => {
  const h = harness(), { ui } = h;
  ui.state.unifiedRefreshBusy = true; ui.state.unifiedRefreshProgressTarget = 2;
  ui.state.unifiedRefreshPhase = 'DataPARC 일괄 조회';
  ui.observeUnifiedRefreshStatuses([
    { id: 'request-1', status: 'complete' }, { id: 'request-1', status: 'complete' },
    { id: 'request-2', status: 'processing' }
  ]);
  assert.equal(ui.elements.overviewRefreshCount.hidden, false);
  assert.match(h.count(), /조회[^·]*1\s*\/\s*2/);
  assert.match(h.count(), /저장 반영\s*0대/);
  const request = { method: 'POST', body: { action: 'dataparc_runtime_sync', requestId: 'request-1' } };
  ui.observeUnifiedRefreshApply(request, { ok: true, tagNumber: tags[0], requestId: 'request-1', applied: true });
  ui.observeUnifiedRefreshApply(request, { ok: true, tagNumber: tags[0], requestId: 'request-1', applied: true });
  assert.match(h.count(), /저장 반영\s*1대/);
  ui.observeUnifiedRefreshStatuses([{ id: 'request-2', status: 'complete' }, { id: 'request-1', status: 'complete' }]);
  assert.match(h.count(), /조회[^·]*2\s*\/\s*2/);
  assert.match(h.count(), /저장 반영\s*1대/);
  ui.observeUnifiedRefreshApply({ method: 'POST', body: { action: 'dataparc_runtime_sync', requestId: 'request-2' } },
    { ok: false, tagNumber: tags[1] });
  assert.match(h.count(), /저장 반영\s*1대/);
});

test('independent ledger proof and already-saved replay never count as newly applied official runtime', () => {
  const h = harness(), { ui } = h;
  ui.state.unifiedRefreshBusy = true; ui.state.unifiedRefreshProgressTarget = 2;
  ui.state.unifiedRefreshPhase = 'DataPARC 일괄 조회';
  ui.observeUnifiedRefreshApply({ method: 'POST', body: { action: 'limestone_run_track_apply', requestId: 'ledger-only' } },
    { ok: true, tagNumber: tags[0], requestId: 'ledger-only', applied: true });
  ui.observeUnifiedRefreshApply({ method: 'POST', body: { action: 'dataparc_runtime_sync', requestId: 'replayed' } },
    { ok: true, tagNumber: tags[1], requestId: 'replayed', applied: false, replayed: true });
  assert.match(h.count(), /저장 반영\s*0대/);
});

test('real refresh wires live query and successful save observations into the same inline status', async () => {
  const gate = defer(); let reached = false, h;
  h = harness({ batch: async (tasks, io) => {
    assert.equal(typeof io.onStatuses, 'function');
    io.onStatuses([{ id: 'request-1', status: 'complete' }, { id: 'request-2', status: 'complete' }]);
    await io.api({ method: 'POST', body: { action: 'dataparc_runtime_sync', requestId: 'request-1' } });
    reached = true; await gate.promise;
    return tasks.map(task => ({ tagNumber: task.snapshot.tagNumber, status: 'complete' }));
  } });
  const running = h.run(); await until(() => reached);
  assertNoMask(h); assert.match(h.phase(), /운전시간 조회/);
  assert.equal(h.ui.elements.overviewRefreshCount.hidden, false);
  assert.match(h.count(), /조회 완료\s*2\s*\/\s*2대/);
  assert.match(h.count(), /저장 반영\s*1대/);
  gate.resolve(); await running;
  assert.equal(h.ui.elements.unifiedRefreshStatus.dataset.state, 'complete');
});

test('final saved-data reload remains a visible verification phase until it actually resolves', async () => {
  const gate = defer(), h = harness({ finalGate: gate });
  const running = h.run();
  await until(() => h.calls.load);
  assert.equal(h.ui.state.unifiedRefreshBusy, true); assertNoMask(h);
  assert.match(h.phase(), /결과|저장.*확인/);
  assert.doesNotMatch(h.phase(), /^완료$|조회 완료$/);
  gate.resolve(); await running;
  assert.equal(h.ui.elements.unifiedRefreshStatus.dataset.state, 'complete');
});

for (const [name, makeResults] of [
  ['waiting', tasks => tasks.map(task => ({ tagNumber: task.snapshot.tagNumber, status: 'waiting' }))],
  ['partial failure', tasks => [{ tagNumber: tasks[0].snapshot.tagNumber, status: 'complete' },
    { tagNumber: tasks[1].snapshot.tagNumber, status: 'failed', message: 'query failed' }]],
  ['missing outcomes', tasks => [{ tagNumber: tasks[0].snapshot.tagNumber, status: 'complete' }]],
  ['duplicate outcomes', tasks => [{ tagNumber: tasks[0].snapshot.tagNumber, status: 'complete' },
    { tagNumber: tasks[0].snapshot.tagNumber, status: 'complete' }]],
  ['empty outcomes', () => []]
]) test(`${name} cannot display complete or imply every planned asset was applied`, async () => {
  const h = harness({ batch: async tasks => makeResults(tasks) });
  await h.run();
  assert.equal(h.ui.elements.unifiedRefreshStatus.dataset.state, 'partial');
  assert.notEqual(h.ui.state.unifiedRefreshInlineOutcome, 'complete');
  assert.doesNotMatch(h.ui.elements.unifiedRefreshText.textContent, /^Blower 조회가 완료됐습니다\.$/);
  assertNoMask(h);
});

test('a resumed already-applied response remains kept in the final counts rather than a new reflection', async () => {
  const h = harness({ saveResponse: request => ({ ok: true, applied: false, replayed: true,
    requestId: request.body.requestId, assetTag: request.body.requestId === 'request-2' ? tags[1] : tags[0] }),
  batch: async (tasks, io) => {
    for (let index = 0; index < tasks.length; index++) {
      await io.api({ method: 'POST', body: { action: 'dataparc_runtime_sync', requestId: `request-${index + 1}` } });
    }
    return tasks.map(task => ({ tagNumber: task.snapshot.tagNumber, status: 'complete', message: 'already saved' }));
  } });
  await h.run();
  assert.equal(h.ui.elements.unifiedRefreshStatus.dataset.state, 'complete');
  assert.match(h.count(), /유지\s*2대/);
  assert.doesNotMatch(h.count(), /반영\s*[1-9]\d*대/);
});

test('a failed final reload preserves the displayed runtime and reports failure without a fake completed count', async () => {
  const h = harness({ finalError: Object.assign(new Error('reload failed'), { status: 503 }) });
  const before = JSON.stringify(h.ui.state.data);
  await h.run();
  assert.equal(JSON.stringify(h.ui.state.data), before);
  assert.equal(h.ui.elements.unifiedRefreshStatus.dataset.state, 'failed');
  assert.notEqual(h.ui.state.unifiedRefreshInlineOutcome, 'complete');
  assertNoMask(h); assert.equal(h.timers.size, 0);
});

test('presentation callback errors cannot turn a successful query or save into an operational failure', async () => {
  let h;
  h = harness({ batch: async (tasks, io) => {
    const target = h.ui.elements.overviewRefreshCount;
    const descriptor = Object.getOwnPropertyDescriptor(target, 'textContent');
    Object.defineProperty(target, 'textContent', { configurable: true,
      get: () => 'display temporarily unavailable', set() { throw new Error('synthetic rendering failure'); } });
    try {
      assert.equal(typeof io.onStatuses, 'function');
      assert.doesNotThrow(() => io.onStatuses([{ id: 'request-1', status: 'complete' }]));
      const saved = await io.api({ method: 'POST', body: { action: 'dataparc_runtime_sync', requestId: 'request-1' } });
      assert.equal(saved.ok, true, 'a committed save result must survive observer errors');
    } finally { Object.defineProperty(target, 'textContent', descriptor); }
    return tasks.map(task => ({ tagNumber: task.snapshot.tagNumber, status: 'complete' }));
  } });
  await h.run();
  assert.equal(h.ui.elements.unifiedRefreshStatus.dataset.state, 'complete');
  assert.equal(h.calls.batch, 1); assert.equal(h.calls.load, 1);
});

test('DOM has one inline live status and no duplicate percentage or blocking progress surface', () => {
  assert.equal((html.match(/id="overviewRefreshInlineStatus"/g) || []).length, 1);
  for (const id of ['overviewRefreshProgressText', 'overviewRefreshCount', 'overviewRefreshElapsed']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  assert.match(html, /id="blowerQueryOverlay"[^>]*aria-hidden="true"[^>]*hidden/);
  assert.match(html, /id="overviewRefreshPercent"[^>]*aria-hidden="true"[^>]*hidden/);
  assert.match(html, /id="overviewRefreshProgressTrack"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /id="overviewRefreshProgressTrack"[^>]*role="progressbar"/);
});
