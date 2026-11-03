import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const TAG = '104ETG30AN602';
const SIGNAL = 'GSPOGE.ABB_DCS.103ETG30AN602XJ04';
const CLOCK = '2026-09-25T05:40:00.000Z';
const START = '2026-10-17T23:04:00.000Z';
const END = '2026-11-03T15:12:58.000Z';
const TOKEN = 'fixture-session-owner';

// Timestamp, signal and measured-total shapes from the prior captured Bag B
// projection; IDs are synthetic. No live database or RUN measurement is used.
function bag() {
  return { tagNumber: TAG, dataParcTag: SIGNAL, blowerType: 'flyash_bag', unitNo: '1',
    positionLabel: '#B', displayName: 'Fixture Bag B', enabled: true, cycleBasisKind: 'replacement',
    lastReplacementAt: CLOCK, actualLastReplacementAt: CLOCK,
    cycleStartState: 'started', cycleStoredStartedAt: START, cycleStartedAt: START,
    cycleStartRevision: 'fixture-start', cycleRuntimeRevision: 'fixture-runtime',
    runtimeHours: 400.1322222222222, cycleElapsedHours: 400.1322222222222,
    hasUnverifiedDataParcHistory: false, cycleRuntimeState: 'running', operationState: 'running',
    cycleRuntimeTracked: true, runtimeAccumulationMode: 'measured_only', isRunning: true,
    cycleSourceReview: { code: 'CONFIRMED_REPLACEMENT_RUN_GAP', cycleBasisConfirmed: true, measuredRangeMayContinue: true },
    replacementAutoCycle: { schemaVersion: 3, normalizationVersion: 4, timePrecision: 'minute',
      clockKnown: true, registeredBaseline: true, completionClockConflict: false,
      requiresRunRefresh: false, confirmedReplacementAt: CLOCK,
      confirmedClockEventId: 'fixture-approved-clock', confirmedClockSourceSnapshotSha256: 'b'.repeat(64) },
    dataParcRuntimeBasis: { requestId: 'fixture-previous', dataParcTag: SIGNAL,
      startAt: START, observedAt: END, requiredStartAt: CLOCK, runtimeHours: 400.1322222222222,
      runningSeconds: 1440476, coverageComplete: false, cycleBasisConfirmed: true, appendReady: true,
      confirmedGapRecoveryEligible: true } };
}
function node() {
  const listeners = new Map();
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, readOnly: false, checked: false, dataset: {}, title: '', style: {}, listeners,
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {},
    replaceChildren() {}, focus() {}, querySelector() { return null; }, contains() { return false; },
    addEventListener(name, handler) { listeners.set(name, [...(listeners.get(name) || []), handler]); },
    showModal() { this.open = true; }, close() { this.open = false; } };
}
function harness(options = {}) {
  const a = options.asset || bag(), nodes = new Map(), calls = [], phases = [], toasts = [], errors = [];
  let mobile = options.mobile === true, token = options.token === undefined ? TOKEN : options.token, reads = 0;
  const context = vm.createContext({ console: { log() {}, warn() {}, error(...args) { errors.push(args); } },
    clearTimeout() {}, HTMLButtonElement: class {}, navigator: {}, URL, URLSearchParams,
    localStorage: { getItem() { return JSON.stringify({ sessionToken: token }); }, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll() { return []; }, querySelector() { return null; },
      addEventListener() {}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia() { return { matches: mobile }; },
      setTimeout(fn) { fn(); }, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui={state,elements,cacheElements,bindEvents,confirmedGapRecoveryProof,
    openDataParcRuntimeDialog,submitDataParcRuntimeRange,syncDataParcBlowerRuntime,openAssetHistory};
    globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;showToast=h.toast;renderAssets=()=>{};};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets: [a], events: [], permissions: { canWrite: options.write !== false }, user: { name: 'Fixture' },
    backfill: { hasRun: true, status: 'complete' }, missingSlots: [], missingTags: [], settings: {}, types: [] };
  const original = structuredClone(ui.state.data);
  const f = { ui, asset: a, original, calls, phases, toasts, errors,
    setMobile(v) { mobile = v; }, setToken(v) { token = v; },
    clickRecovery() {
      ui.state.historyAssetTag = TAG;
      const event = { target: { closest() { return { dataset: { historyAction: 'confirmed_gap_recovery' } }; } }, preventDefault() {} };
      for (const fn of ui.elements.historyDialog.listeners.get('click') || []) fn(event);
    },
    async submit() { await ui.submitDataParcRuntimeRange({ preventDefault() {} }); },
    async sync() {
      const proof = ui.confirmedGapRecoveryProof(a);
      assert.ok(proof, 'fixture must be eligible before the requested lifecycle test');
      await ui.syncDataParcBlowerRuntime(TAG, CLOCK, { dataParcTag: SIGNAL, confirmRunSignal: true,
        confirmedGapRecovery: { proof, owner: token } });
    } };
  context.hooks({ toast(message, kind) { toasts.push({ message, kind }); },
    async load() { phases.push('reload'); options.onReload?.(f); return ui.state.data; },
    async api(request) {
      calls.push(structuredClone(request));
      if (request.url?.includes('action=refresh_state_page')) {
        phases.push('read'); reads += 1;
        const result = { ok: true, version: 'blower-refresh-state-page-v1', generatedAt: '2026-11-03T19:59:00Z',
          permissions: { canWrite: true }, assets: [structuredClone(a)], done: true, nextCursor: null };
        options.onRead?.(result, reads, f); return result;
      }
      if (request.body?.action === 'create_blower_runtime_probe') {
        phases.push('create'); options.onCreate?.(f);
        return options.createResponse === undefined ? { item: { id: 'fixture-accepted' } } : options.createResponse;
      }
      if (request.url?.includes('action=status_batch')) {
        phases.push('wait'); options.onWait?.(f);
        return { items: [{ id: 'fixture-accepted', status: options.waitFailed ? 'failed' : 'complete', errorMessage: 'fixture RUN failure' }] };
      }
      if (request.body?.action === 'dataparc_runtime_sync') {
        phases.push('sync'); options.onSync?.(f);
        if (options.syncFailed) throw Object.assign(new Error('fixture server owner conflict'), { status: 409 });
        return { ok: true, message: 'Fixture recovery saved' };
      }
      throw new Error('Unexpected fixture request');
    } });
  ui.bindEvents();
  return f;
}

test('confirmed Bag B proof uses the approved replacement clock and preserves the later measured start as history', () => {
  const f = harness(), before = structuredClone(f.asset), proof = f.ui.confirmedGapRecoveryProof(f.asset);
  assert.ok(proof); assert.equal(proof.tagNumber, TAG); assert.equal(proof.dataParcTag, SIGNAL);
  assert.equal(proof.startAt, CLOCK); assert.equal(proof.previousStartAt, START); assert.equal(proof.cycleStartedAt, START);
  assert.equal(proof.previousRunningSeconds, 1440476); assert.deepEqual(f.asset, before);
});

test('unknown, day-only, conflicting, unsupported or incomplete recovery proofs are ineligible', () => {
  const changes = {
    'no capability': a => { delete a.dataParcRuntimeBasis.confirmedGapRecoveryEligible; },
    'false capability': a => { a.dataParcRuntimeBasis.confirmedGapRecoveryEligible = false; },
    'unknown clock': a => { a.replacementAutoCycle.clockKnown = false; },
    'day precision': a => { a.replacementAutoCycle.timePrecision = 'day'; },
    'clock conflict': a => { a.replacementAutoCycle.completionClockConflict = true; },
    'unconfirmed source': a => { a.cycleSourceReview.cycleBasisConfirmed = false; },
    'unknown history': a => { a.hasUnverifiedDataParcHistory = true; },
    'no runtime revision': a => { a.cycleRuntimeRevision = ''; },
    'no start revision': a => { a.cycleStartRevision = ''; },
    'whitespace revision': a => { a.cycleRuntimeRevision = ' '; },
    'whitespace start revision': a => { a.cycleStartRevision = ' '; },
    'disabled': a => { a.enabled = false; },
    'other family': a => { a.blowerType = 'limestone'; },
    'wrong tag': a => { a.tagNumber = 'UNSUPPORTED'; },
    'pending cycle': a => { a.cycleStartState = 'pending'; },
    'missing owner': a => { a.dataParcRuntimeBasis.requestId = ''; },
    'whitespace owner': a => { a.dataParcRuntimeBasis.requestId = ' '; },
    'no append authorization': a => { a.dataParcRuntimeBasis.appendReady = false; },
    'unconfirmed basis': a => { a.dataParcRuntimeBasis.cycleBasisConfirmed = false; },
    'complete range': a => { a.dataParcRuntimeBasis.coverageComplete = true; },
    'no leading gap': a => { a.dataParcRuntimeBasis.startAt = CLOCK; },
    'bad range end': a => { a.dataParcRuntimeBasis.observedAt = START; },
    'wrong required start': a => { a.dataParcRuntimeBasis.requiredStartAt = START; },
    'wrong physical clock': a => { a.actualLastReplacementAt = START; },
    'wrong stored clock': a => { a.lastReplacementAt = START; },
    'wrong signal': a => { a.dataParcRuntimeBasis.dataParcTag = 'GSPOGE.ABB_DCS.OTHER'; },
    'negative seconds': a => { a.dataParcRuntimeBasis.runningSeconds = -1; },
    'fractional seconds': a => { a.dataParcRuntimeBasis.runningSeconds = 1.5; },
    'inconsistent measured hours': a => { a.dataParcRuntimeBasis.runtimeHours += 1; },
    'unknown stored hours': a => { a.cycleElapsedHours = undefined; a.runtimeHours = undefined; },
    'nonnumeric stored hours': a => { a.cycleElapsedHours = 'invalid'; },
    'mismatched stored hours': a => { a.cycleElapsedHours += 1; }
  };
  const unexpected = [];
  for (const [label, change] of Object.entries(changes)) {
    const f = harness(); change(f.asset);
    if (f.ui.confirmedGapRecoveryProof(f.asset) !== null) unexpected.push(label);
  }
  assert.deepEqual(unexpected, [], 'each malformed or unsupported basis must be denied');
});

test('ordinary dialog retains the previous measured start; recovery fixes the confirmed clock despite later switching timestamp', () => {
  const f = harness(), before = structuredClone(f.asset), e = f.ui.elements;
  f.ui.openDataParcRuntimeDialog(TAG);
  assert.equal(e.dataparcRuntimeStartAt.value, '2026-10-18T08:04'); assert.equal(e.dataparcRuntimeStartAt.readOnly, false);
  assert.equal(e.dataparcRuntimeStartAt.min, '2026-10-18T08:04'); assert.equal(f.ui.state.dataparcConfirmedGapRecovery, null);
  e.dataparcRuntimeDialog.close(); f.clickRecovery();
  assert.equal(e.dataparcRuntimeDialog.open, true); assert.equal(e.dataparcRuntimeStartAt.value, '2026-09-25T14:40');
  assert.equal(e.dataparcRuntimeStartAt.min, '2026-09-25T14:40'); assert.equal(e.dataparcRuntimeStartAt.readOnly, true);
  assert.equal(e.dataparcRuntimeSourceTag.value, SIGNAL); assert.equal(e.dataparcRuntimeSourceTag.readOnly, true);
  assert.equal(e.dataparcRuntimeConfirmSignal.disabled, true);
  assert.match(e.dataparcRuntimePreviousBasis.textContent, /2026-10-18 08:04/);
  assert.match(e.dataparcRuntimeSourceHelp.textContent, /중복해서 더하지 않/);
  assert.equal(f.ui.state.dataparcConfirmedGapRecovery.owner, TOKEN);
  assert.deepEqual(f.asset, before); assert.equal(f.calls.length, 0);
  e.dataparcRuntimeDialog.close(); f.ui.openDataParcRuntimeDialog(TAG);
  assert.equal(e.dataparcRuntimeStartAt.readOnly, false); assert.equal(e.dataparcRuntimeSourceTag.readOnly, false);
  assert.equal(e.dataparcRuntimeConfirmSignal.disabled, false); assert.equal(f.ui.state.dataparcConfirmedGapRecovery, null);
});

test('recovery is absent from read-only or mobile history and delegated clicks cannot open it', () => {
  for (const options of [{ write: false }, { mobile: true }, { token: '' }]) {
    const f = harness(options); f.ui.openAssetHistory(TAG);
    if (options.write === false || options.mobile) assert.doesNotMatch(f.ui.elements.historyCycleSummary.innerHTML, /data-confirmed-gap-recovery/);
    f.clickRecovery();
    assert.equal(f.ui.elements.dataparcRuntimeDialog.open, false); assert.equal(f.calls.length, 0);
    assert.equal(f.ui.state.dataparcConfirmedGapRecovery, null);
  }
  for (const flag of ['busy', 'unifiedRefreshBusy', 'backfillRunning', 'dataparcRuntimeBusy']) {
    const f = harness(); f.ui.state[flag] = true; f.clickRecovery();
    assert.equal(f.ui.elements.dataparcRuntimeDialog.open, false); assert.equal(f.calls.length, 0);
  }
});

test('submit follows fresh read, create, wait, fresh read, accepted-ID sync and reload without changing stored values locally', async () => {
  const f = harness({ onCreate(f) { assert.deepEqual(f.ui.state.data, f.original); },
    onWait(f) { assert.deepEqual(f.ui.state.data, f.original); }, onSync(f) { assert.deepEqual(f.ui.state.data, f.original); } });
  f.clickRecovery(); await f.submit();
  assert.deepEqual(f.phases, ['read', 'create', 'wait', 'read', 'sync', 'reload']);
  const create = f.calls.find(r => r.body?.action === 'create_blower_runtime_probe');
  assert.deepEqual(create.body, { action: 'create_blower_runtime_probe', assetTag: TAG, dataParcTag: SIGNAL,
    confirmRunSignal: true, startAt: CLOCK, unifiedRefresh: true, incrementalRefresh: false, requireIncrementalAppend: false,
    expectedLastReplacementAt: CLOCK, expectedCycleStartState: 'started', expectedCycleStartedAt: START,
    expectedCycleStartRevision: 'fixture-start', expectedCycleRuntimeRevision: 'fixture-runtime' });
  assert.deepEqual(f.calls.find(r => r.body?.action === 'dataparc_runtime_sync').body,
    { action: 'dataparc_runtime_sync', requestId: 'fixture-accepted' });
  assert.equal(f.ui.state.dataparcRuntimeBusy, false); assert.equal(f.ui.state.operationSyncCompleted, true);
  assert.deepEqual(f.ui.state.data, f.original); assert.equal(f.errors.length, 0);
});

test('changed dialog fields, permissions, login or basis reject submit before request creation', async () => {
  const changes = [
    f => { f.ui.elements.dataparcRuntimeStartAt.value = '2026-10-18T08:04'; },
    f => { f.ui.elements.dataparcRuntimeSourceTag.value = 'GSPOGE.ABB_DCS.OTHER'; },
    f => { f.ui.state.data.permissions.canWrite = false; },
    f => { f.setToken('fixture-new-session'); },
    f => { f.asset.cycleRuntimeRevision = 'changed'; },
    f => { f.ui.state.busy = true; },
    f => { f.ui.state.unifiedRefreshBusy = true; },
    f => { f.setMobile(true); }
  ];
  for (const change of changes) {
    const f = harness(); f.clickRecovery(); change(f); await f.submit();
    assert.equal(f.calls.length, 0); assert.ok(f.toasts.length > 0);
  }
});

test('fresh server ownership mismatch prevents creation and leaves stored totals intact', async () => {
  const f = harness({ onRead(page) { page.assets[0].cycleRuntimeRevision = 'newer-server-revision'; } });
  await f.sync(); assert.deepEqual(f.phases, ['read']);
  assert.deepEqual(f.ui.state.data, f.original); assert.equal(f.ui.state.dataparcRuntimeBusy, false);
  assert.match(f.toasts.at(-1).message, /서버의 교체 기준 또는 누적값이 변경/);
});

test('failed, malformed or readonly fresh pages cannot authorize a recovery request', async () => {
  const corruptions = [
    page => { page.permissions.canWrite = false; }, page => { page.version = 'wrong'; },
    page => { page.generatedAt = 'invalid'; }, page => { page.done = false; page.nextCursor = null; },
    page => { page.assets = []; }, page => { page.assets[0].dataParcRuntimeBasis.confirmedGapRecoveryEligible = false; }
  ];
  for (const corrupt of corruptions) {
    const f = harness({ onRead: corrupt }); await f.sync();
    assert.deepEqual(f.phases, ['read']); assert.deepEqual(f.ui.state.data, f.original);
  }
});

test('a post-measurement server revision change prevents sync instead of applying an older proof', async () => {
  const f = harness({ onRead(page, count) { if (count === 2) page.assets[0].cycleRuntimeRevision = 'new-server-owner'; } });
  await f.sync(); assert.deepEqual(f.phases, ['read', 'create', 'wait', 'read']);
  assert.deepEqual(f.ui.state.data, f.original); assert.equal(f.ui.state.dataparcRuntimeBusy, false);
});

test('a session, permission or concurrent-edit change during measurement or fresh reread prevents sync', async () => {
  for (const change of [f => f.setToken('new-owner'), f => { f.ui.state.data.permissions.canWrite = false; },
    f => { f.ui.state.busy = true; }]) {
    const f = harness({ onWait: change }); await f.sync();
    assert.deepEqual(f.phases, ['read', 'create', 'wait']); assert.equal(f.ui.state.dataparcRuntimeBusy, false);
    assert.equal(f.asset.runtimeHours, f.original.assets[0].runtimeHours);
  }
  const fresh = harness({ onRead(page, count, f) { if (count === 2) f.ui.state.busy = true; } });
  await fresh.sync();
  assert.deepEqual(fresh.phases, ['read', 'create', 'wait', 'read']);
  assert.deepEqual(fresh.ui.state.data, fresh.original); assert.equal(fresh.ui.state.dataparcRuntimeBusy, false);
});

test('missing request IDs, RUN failure and server sync rejection never fabricate new local totals', async () => {
  for (const [options, expected] of [
    [{ createResponse: {} }, ['read', 'create']],
    [{ waitFailed: true }, ['read', 'create', 'wait']],
    [{ syncFailed: true }, ['read', 'create', 'wait', 'read', 'sync']]
  ]) {
    const f = harness(options); await f.sync(); assert.deepEqual(f.phases, expected);
    assert.deepEqual(f.ui.state.data, f.original); assert.equal(f.ui.state.dataparcRuntimeBusy, false);
    assert.ok(f.toasts.some(t => t.kind === 'error'));
  }
});
