import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const NOW = '2026-11-04T00:00:00.000Z', OBSERVED = '2026-11-03T15:12:58.000Z';
const TOKEN = 'snapshot-regression-session';
const TAGS = ['104HHL60AP611', '104HHL60AP621'];
function asset(tagNumber, partial = false) {
  const startAt = partial ? '2026-09-04T01:50:00.000Z' : '2026-09-04T00:00:00+09:00';
  const dataParcTag = `GSPOGE.ABB_DCS.TEST_ONLY_BINARY_${tagNumber}`;
  return { tagNumber, displayName: tagNumber, blowerType: 'fbhe', unitNo: '1', enabled: true,
    lastReplacementAt: '2026-09-04T00:00:00+09:00', cycleStartState: 'legacy',
    cycleStoredStartedAt: null, cycleStartedAt: null, cycleStartRevision: 'source-reviewed-start',
    cycleRuntimeRevision: 'source-reviewed-runtime', runtimeHours: 2, cycleElapsedHours: 2,
    cycleRuntimeState: 'running', isRunning: true, measurementRequired: false,
    hasUnverifiedDataParcHistory: false, dataParcTag,
    ...(partial ? { cycleSourceReview: { code: 'VERIFIED_RUNTIME_RANGE', measuredRangeMayContinue: true } } : {}),
    dataParcRuntimeBasis: { requestId: `saved-${tagNumber}`, startAt, observedAt: OBSERVED,
      dataParcTag, runningSeconds: 7200, runtimeHours: 2, appendReady: true, coverageComplete: !partial } };
}
function node() {
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, title: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {}, addEventListener() {},
    showModal() { this.open = true; }, close() { this.open = false; } };
}
function fixture({ pageFailure = '', beforeFinalPage = null, afterCreate = null, serverConflict = false } = {}) {
  const calls = [], nodes = new Map(), fresh = TAGS.map((tag, i) => asset(tag, i === 0));
  const context = vm.createContext({ console, Date, clearTimeout() {}, performance: { now: () => 0 },
    HTMLButtonElement: class {}, navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia: () => ({ matches: false }),
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setTimeout(fn) { fn(); },
      setInterval() { return 1; }, clearInterval() {}, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui={state,elements,cacheElements,refreshAllBlowers,createUnifiedRuntimeAssetResolver:typeof createUnifiedRuntimeAssetResolver==='function'?createUnifiedRuntimeAssetResolver:null,readUnifiedRefreshPlan};
    globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;getSessionToken=()=> '${TOKEN}';
      currentServerDate=()=>new Date('${NOW}');showToast=()=>{};setBusy=v=>{state.busy=v;};
      startUnifiedRefreshFeedback=()=>{};finishUnifiedRefreshFeedback=()=>{};
      renderAssets=()=>{};renderOverviewRefreshPanel=()=>{};};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets: fresh.map(a => ({ ...structuredClone(a),
    cycleStartRevision: 'old-display-start', cycleRuntimeRevision: 'old-display-runtime',
    displayDecoration: { preserved: true } })), events: [], permissions: { canWrite: true },
    user: { name: 'Fixture', employeeNo: 'fixture-owner' }, backfill: { hasRun: true, status: 'complete' },
    settings: {}, types: [], missingSlots: [], missingTags: [], replacementNormalizationVersion: 4,
    unrelatedDisplayMetadata: { retained: true } };
  const original = structuredClone(ui.state.data), originalData = ui.state.data;
  context.hooks({ async load() { calls.push({ action: 'reload' }); return ui.state.data; }, async api(request) {
    calls.push(structuredClone(request));
    const action = request.body?.action;
    if (action === 'latest_logs_step') {
      if (request.body.phase === 'replacement') assert.equal(request.body.normalizationVersion, 4);
      return { ok: true, version: 'bounded-logs-v1', replacementAutoVersion: 3, normalizationVersion: 4,
        phase: request.body.phase, done: true, nextCursor: null, scannedLogCount: 1,
        insertedCount: 0, appliedStateChanges: 0,
        window: { fromDate: '2026-10-01', endDate: '2026-11-05', snapshotAt: NOW } };
    }
    if (request.url?.includes('action=refresh_state_page')) {
      const first = !new URL(request.url, 'https://fixture.invalid').searchParams.get('cursor');
      if (!first) beforeFinalPage?.(ui, fresh);
      return { ok: true, version: 'blower-refresh-state-page-v1', generatedAt: NOW,
        permissions: { canWrite: !(pageFailure === 'access' && !first) },
        assets: [structuredClone(fresh[first ? 0 : 1])], done: !first,
        nextCursor: first ? TAGS[0] : pageFailure === 'protocol' ? 'invalid-final-cursor' : null };
    }
    if (action === 'create_blower_runtime_probe_batch') {
      assert.equal(request.body.requests.length, 2, 'one original atomic batch contains both fresh plans');
      for (const body of request.body.requests) {
        assert.equal(body.expectedCycleStartRevision, 'source-reviewed-start');
        assert.equal(body.expectedCycleRuntimeRevision, 'source-reviewed-runtime');
        assert.equal(body.requireIncrementalAppend, true);
      }
      afterCreate?.(ui, fresh);
      return { ok: true, atomic: true, batchVersion: 1, requestedCount: 2,
        results: TAGS.map(assetTag => ({ ok: true, assetTag,
          item: { id: `accepted-${assetTag}`, status: 'complete', requestType: 'blower_runtime_probe',
            probe: { assetTag, requestId: `accepted-${assetTag}` } } })) };
    }
    if (action === 'dataparc_runtime_sync') {
      if (serverConflict && request.body.requestId === `accepted-${TAGS[0]}`) {
        throw Object.assign(new Error('Fixture server rejected changed cycle ownership'), { status: 409, code: 'CYCLE_CONFLICT' });
      }
      return { ok: true, applied: true, requestId: request.body.requestId,
        tagNumber: request.body.requestId.replace('accepted-', '') };
    }
    throw Error(`Unexpected request ${action || request.url}`);
  } });
  return { ui, calls, fresh, original, originalData };
}
const createCalls = f => f.calls.filter(r => r.body?.action === 'create_blower_runtime_probe_batch');
const applyCalls = f => f.calls.filter(r => r.body?.action === 'dataparc_runtime_sync');

test('real Latest uses the completed paged planning snapshot after source normalization while display data stays intact', async () => {
  const f = fixture();
  await f.ui.refreshAllBlowers();
  assert.equal(createCalls(f).length, 1);
  assert.equal(applyCalls(f).length, 2, 'partial and complete measured ranges both reach original server apply guards');
  assert.equal(f.ui.state.unifiedRefreshResults.filter(r => r.status === 'complete').length, 2);
  assert.equal(f.ui.state.unifiedRefreshResults.filter(r => r.status === 'failed').length, 0);
  assert.equal(f.calls.filter(r => r.action === 'reload').length, 1);
  assert.equal(f.ui.state.data, f.originalData, 'trimmed planning projections never replace the display payload');
  assert.deepEqual(f.ui.state.data, f.original);
});

test('an invalid final planning page cannot install a partial snapshot or create any RUN request', async () => {
  const f = fixture({ pageFailure: 'protocol' });
  await f.ui.refreshAllBlowers();
  assert.equal(createCalls(f).length, 0); assert.equal(applyCalls(f).length, 0);
  assert.equal(f.ui.state.data, f.originalData); assert.deepEqual(f.ui.state.data, f.original);
});

test('revoked permission on the final planning page prevents creation and preserves display data', async () => {
  const f = fixture({ pageFailure: 'access' });
  await f.ui.refreshAllBlowers();
  assert.equal(createCalls(f).length, 0); assert.equal(applyCalls(f).length, 0);
  assert.deepEqual(f.ui.state.data, f.original);
});

test('a later in-place manual edit wins over the fresh plan and is not overwritten by accepted partial RUN', async () => {
  const f = fixture({ afterCreate(ui) {
    Object.assign(ui.state.data.assets[0], { runtimeHours: 9, cycleElapsedHours: 9, cycleRuntimeRevision: 'later-manual-correction' });
  } });
  await f.ui.refreshAllBlowers();
  assert.equal(createCalls(f).length, 1); assert.equal(applyCalls(f).length, 1);
  assert.equal(applyCalls(f)[0].body.requestId, `accepted-${TAGS[1]}`);
  assert.equal(f.ui.state.unifiedRefreshResults.find(r => r.tagNumber === TAGS[0]).status, 'skipped');
  assert.equal(f.ui.state.data.assets[0].cycleElapsedHours, 9);
  assert.equal(f.ui.state.data.assets[0].cycleRuntimeRevision, 'later-manual-correction');
});

test('a later deletion cannot borrow the captured planning asset to apply a partial result', async () => {
  const f = fixture({ afterCreate(ui) { ui.state.data.assets.splice(0, 1); } });
  await f.ui.refreshAllBlowers();
  assert.equal(createCalls(f).length, 1); assert.equal(applyCalls(f).length, 1);
  assert.equal(f.ui.state.unifiedRefreshResults.find(r => r.tagNumber === TAGS[0]).status, 'skipped');
  assert.equal(f.ui.state.data.assets.some(a => a.tagNumber === TAGS[0]), false);
});

test('a later display reload is authoritative even if the original display objects still exist', async () => {
  const f = fixture({ afterCreate(ui) {
    ui.state.data = { ...ui.state.data, assets: ui.state.data.assets.map(a => ({ ...a, cycleRuntimeRevision: 'later-reloaded-owner' })) };
  } });
  await f.ui.refreshAllBlowers();
  assert.equal(createCalls(f).length, 1); assert.equal(applyCalls(f).length, 1);
  assert.equal(f.ui.state.unifiedRefreshResults.find(r => r.tagNumber === TAGS[0]).status, 'skipped');
});

test('an edit during planning page collection is authoritative before the completed snapshot is adopted', async () => {
  const f = fixture({ beforeFinalPage(ui) {
    Object.assign(ui.state.data.assets[0], { runtimeHours: 11, cycleElapsedHours: 11, cycleRuntimeRevision: 'edited-during-planning' });
  } });
  await f.ui.refreshAllBlowers();
  assert.equal(createCalls(f).length, 0, 'the original guard rejects changed ownership before any atomic create');
  assert.equal(applyCalls(f).length, 0);
  assert.equal(f.ui.state.data.assets[0].cycleElapsedHours, 11);
  assert.equal(f.ui.state.data.assets[0].cycleRuntimeRevision, 'edited-during-planning');
});

test('server ownership rejection remains a failure after the frontend snapshot check passes', async () => {
  const f = fixture({ serverConflict: true }); await f.ui.refreshAllBlowers();
  assert.equal(createCalls(f).length, 1); assert.equal(applyCalls(f).length, 2);
  assert.equal(f.ui.state.unifiedRefreshResults.find(r => r.tagNumber === TAGS[0]).status, 'failed');
  assert.deepEqual(f.ui.state.data, f.original);
});

test('the resolver starts without a planning snapshot and releases captured objects on any later data change', () => {
  const f = fixture(), resolver = f.ui.createUnifiedRuntimeAssetResolver();
  const old = f.ui.state.data.assets[0], fresh = f.fresh[0];
  assert.equal(resolver.current(TAGS[0]), old, 'resume starts from actual display state');
  resolver.adopt(f.fresh); assert.equal(resolver.current(TAGS[0]), fresh);
  f.ui.state.data.assets[0] = { ...old };
  assert.equal(resolver.current(TAGS[0]), f.ui.state.data.assets[0], 'object replacement is a new observation');
  f.ui.state.data.assets.splice(0, 1); assert.equal(resolver.current(TAGS[0]), null);
});
