import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../maintenance/blower-unified-refresh.js');
const assessment = require('../maintenance/blower-runtime-assessment.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const TAG = '103HRJ01AN601';
const SIGNAL = 'GSPOGE.ABB_DCS.103HRJ01AN601XB04';
const PRIOR = '2026-09-18T05:20:00.000Z';
const SELECTED = '2026-09-18T05:24:00.000Z';
const END = '2026-11-06T07:12:00.000Z';
const TOKEN = 'fixture-owner';
function asset() {
  return { tagNumber: TAG, blowerType: 'limestone', displayName: 'Fixture Limestone 1A',
    unitNo: '1', positionLabel: '#A', enabled: true, dataParcTag: SIGNAL,
    lastReplacementAt: PRIOR, actualLastReplacementAt: '', cycleBasisKind: 'replacement_source_review',
    cycleStartState: 'legacy', cycleStartedAt: '', cycleStoredStartedAt: '',
    cycleStartRevision: 'fixture-start', cycleRuntimeRevision: 'fixture-runtime',
    runtimeHours: 1177.8, cycleElapsedHours: 1177.8, cycleRuntimeState: 'running',
    runtimeAccumulationMode: 'measured_only', cycleRuntimeTracked: true, isRunning: true,
    hasUnverifiedDataParcHistory: false,
    cycleSourceReview: { code: 'ROLE_PRIORITY_RUN_REBUILD', cycleBasisConfirmed: false, measuredRangeMayContinue: true },
    replacementAutoCycle: { schemaVersion: 3, normalizationVersion: 4, rolePriorityRecoveryEligible: true,
      clockKnown: false, registeredBaseline: true, registeredRuntimeRange: true, rangeTrackingAllowed: true,
      rangeStartAt: PRIOR, requiresRunRefresh: false, timePrecision: 'minute',
      rolePrioritySelection: { version: 1, selectedRole: 'BCO1', selectedCompletionAt: SELECTED,
        selectedWorkDate: '2026-09-18', registeredReplacementAt: PRIOR, timePrecision: 'minute',
        selectedSourceLogId: 'fixture-approved-log', selectedSourceKey: '["fixture-approved-log","103HRJ01AN601","job",0]',
        selectedSourceSnapshotSha256: 'a'.repeat(64), requiredRebuild: true } },
    dataParcRuntimeBasis: { requestId: 'fixture-saved-query', dataParcTag: SIGNAL, startAt: PRIOR,
      observedAt: END, requiredStartAt: PRIOR, runtimeHours: 1177.8, runningSeconds: 4240080,
      coverageComplete: false, cycleBasisConfirmed: false, appendReady: true },
    runtimeCoverageEvidence: { version: 1, source: 'dataparc', measurementVerified: true,
      hours: 1177.8, requestId: 'fixture-saved-query', startAt: PRIOR, observedAt: END,
      requiredStartAt: PRIOR, missingLeadingSeconds: 0, coverageComplete: true,
      cycleBasisConfirmed: false, wholeCycleVerified: false } };
}
function node() {
  const listeners = new Map();
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, readOnly: false, checked: false, dataset: {}, title: '', style: {}, listeners,
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {},
    replaceChildren() {}, focus() {}, querySelector() { return null; }, contains() { return false; },
    addEventListener(name, fn) { listeners.set(name, [...(listeners.get(name) || []), fn]); },
    showModal() { this.open = true; }, close() { this.open = false; } };
}
function harness(options = {}) {
  const a = options.asset || asset(), nodes = new Map(), calls = [], phases = [], toasts = [];
  let mobile = options.mobile === true, token = options.token === undefined ? TOKEN : options.token;
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, clearTimeout() {},
    HTMLButtonElement: class {}, navigator: {}, URL, URLSearchParams,
    localStorage: { getItem() { return JSON.stringify({ sessionToken: token }); }, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll() { return []; }, querySelector() { return null; },
      addEventListener() {}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, BlowerRuntimeAssessment: assessment,
      matchMedia() { return { matches: mobile }; }, setTimeout(fn) { fn(); }, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui={state,elements,cacheElements,bindEvents,rolePriorityRecoveryProof,
    allOverviewRuntimeAssessment,renderAllOverviewCard,openOverviewAssessmentAction,
    openDataParcRuntimeDialog,submitDataParcRuntimeRange,syncDataParcBlowerRuntime,openAssetHistory};
    globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;showToast=h.toast;renderAssets=()=>{};};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets: [a], events: [], permissions: { canWrite: options.write !== false },
    backfill: { hasRun: true, status: 'complete' }, missingSlots: [], missingTags: [], settings: {}, types: [] };
  const original = structuredClone(ui.state.data);
  const f = { ui, asset: a, original, calls, phases, toasts,
    setToken(v) { token = v; }, setMobile(v) { mobile = v; },
    open() { ui.openOverviewAssessmentAction(TAG); },
    async submit() { await ui.submitDataParcRuntimeRange({ preventDefault() {} }); },
    async sync() {
      const proof = ui.rolePriorityRecoveryProof(a);
      assert.ok(proof);
      await ui.syncDataParcBlowerRuntime(TAG, SELECTED, { dataParcTag: SIGNAL, confirmRunSignal: true,
        rolePriorityRecovery: { proof, owner: token } });
    } };
  context.hooks({
    toast(message, kind) { toasts.push({ message, kind }); },
    async load() { phases.push('reload'); options.onReload?.(f); return ui.state.data; },
    async api(request) {
      calls.push(structuredClone(request));
      if (request.url?.includes('action=refresh_state_page')) {
        phases.push('read');
        const result = { ok: true, version: 'blower-refresh-state-page-v1', generatedAt: END,
          permissions: { canWrite: true }, assets: [structuredClone(a)], done: true, nextCursor: null };
        options.onRead?.(result, f); return result;
      }
      if (request.body?.action === 'create_blower_runtime_probe') {
        phases.push('create'); options.onCreate?.(f);
        if (options.createFailed) throw new Error('Fixture queue rejected source');
        return { item: { id: 'fixture-role-request' } };
      }
      if (request.url?.includes('action=status_batch')) {
        phases.push('wait'); options.onWait?.(f);
        return { items: [{ id: 'fixture-role-request', status: options.waitFailed ? 'failed' : 'complete',
          errorMessage: 'Fixture RUN failure' }] };
      }
      if (request.body?.action === 'apply_role_priority_runtime_recovery') {
        phases.push('apply'); options.onApply?.(f);
        if (options.applyFailed) throw new Error('Fixture source or owner changed');
        return { ok: true, message: 'Fixture selected basis and measured hours adopted' };
      }
      throw new Error('Unexpected request: ' + JSON.stringify(request));
    }
  });
  ui.bindEvents();
  return f;
}

test('selected minute proof opens a fixed 14:24 full-query action while retaining 14:20 and 1177.8 until apply', async () => {
  const f = harness({ onCreate(g) { assert.deepEqual(g.ui.state.data, g.original); },
    onWait(g) { assert.deepEqual(g.ui.state.data, g.original); },
    onApply(g) { assert.deepEqual(g.ui.state.data, g.original); } });
  const proof = f.ui.rolePriorityRecoveryProof(f.asset);
  assert.equal(proof.startAt, SELECTED); assert.equal(proof.lastReplacementAt, PRIOR);
  assert.equal(f.ui.allOverviewRuntimeAssessment(f.asset).nextActionKey, 'selected_basis_recovery');
  assert.match(f.ui.renderAllOverviewCard(f.asset), /data-overview-next="selected_basis_recovery"/);
  f.open();
  assert.equal(f.ui.elements.dataparcRuntimeDialog.open, true);
  assert.equal(f.ui.elements.dataparcRuntimeStartAt.value, '2026-09-18T14:24');
  assert.equal(f.ui.elements.dataparcRuntimeStartAt.readOnly, true);
  assert.equal(f.ui.elements.dataparcRuntimeSourceTag.readOnly, true);
  assert.match(f.ui.elements.dataparcRuntimeSourceHelp.textContent, /교체 기준과 누적시간을 함께/);
  await f.submit();
  assert.deepEqual(f.phases, ['read','create','wait','read','apply','reload']);
  const create = f.calls.find(c => c.body?.action === 'create_blower_runtime_probe').body;
  assert.equal(create.rolePriorityRecovery, true);
  assert.equal(Date.parse(create.startAt), Date.parse(SELECTED));
  assert.equal(Date.parse(create.selectedCompletionAt), Date.parse(SELECTED));
  assert.equal(create.expectedLastReplacementAt, PRIOR);
  assert.equal(create.expectedCycleStartRevision, 'fixture-start');
  assert.equal(create.expectedCycleRuntimeRevision, 'fixture-runtime');
  assert.equal(create.incrementalRefresh, false);
  assert.equal(f.calls.some(c => c.body?.action === 'dataparc_runtime_sync'), false);
  assert.deepEqual(f.ui.state.data, f.original);
  assert.equal(f.ui.state.dataparcRuntimeBusy, false);
});

test('already measured pending Limestone exposes selected recovery without inventing a startup', async () => {
  const a = asset();
  a.cycleStartState = 'pending';
  const f = harness({asset:a});
  assert.equal(f.ui.rolePriorityRecoveryProof(a)?.cycleStartState,'pending');
  assert.equal(f.ui.allOverviewRuntimeAssessment(a).nextActionKey,'selected_basis_recovery');
  f.open();
  await f.submit();
  const create = f.calls.find(call => call.body?.action === 'create_blower_runtime_probe')?.body;
  assert.ok(create);
  assert.equal(create.expectedCycleStartState,'pending');
  assert.equal(create.expectedCycleStartedAt,'');
  assert.equal(create.selectedCompletionAt,SELECTED);
  assert.deepEqual(f.ui.state.data,f.original);
  a.cycleStoredStartedAt = '2026-09-18T05:25:00.000Z';
  assert.equal(f.ui.rolePriorityRecoveryProof(a),null);
});

test('the dialog explains selected-basis adoption and restores the ordinary-query warning when reopened', () => {
  const f = harness();
  f.open();
  const warning = f.ui.elements.dataparcRuntimeRangeWarning;
  assert.match(warning.textContent, /선택한 교체 완료시각부터 RUN을 다시 측정/);
  assert.match(warning.textContent, /교체 기준과 누적시간을 함께 갱신/);
  assert.doesNotMatch(warning.textContent, /교체일은 유지/);
  f.ui.elements.dataparcRuntimeDialog.close();
  f.ui.openDataParcRuntimeDialog(TAG);
  assert.equal(f.ui.elements.dataparcRuntimeDialog.open, true);
  assert.equal(warning.textContent, '선택한 시각 이후의 RUN 누적시간과 현재 상태를 갱신합니다. V-Belt 교체일은 유지됩니다.');
  assert.equal(f.ui.elements.dataparcRuntimeStartAt.value, '2026-09-18T14:20');
  assert.equal(f.ui.elements.dataparcRuntimeStartAt.readOnly, false);
  assert.equal(f.ui.state.dataparcRolePriorityRecovery, null);
  assert.equal(f.calls.length, 0, 'opening either dialog must not submit a query or change a saved value');
  assert.deepEqual(f.ui.state.data, f.original);
});

test('day-only, revoked, unsupported, stale, partial and mismatched saved owners have no selected-basis capability', () => {
  const changes = [
    a => { delete a.replacementAutoCycle.rolePriorityRecoveryEligible; },
    a => { a.replacementAutoCycle.rolePriorityRecoveryEligible = false; },
    a => { a.replacementAutoCycle.rolePrioritySourceRevoked = true; },
    a => { a.replacementAutoCycle.rolePrioritySelection.timePrecision = 'day'; a.replacementAutoCycle.rolePrioritySelection.selectedCompletionAt = ''; },
    a => { a.replacementAutoCycle.rolePrioritySelection.requiredRebuild = false; },
    a => { a.replacementAutoCycle.rolePrioritySelection.registeredReplacementAt = SELECTED; },
    a => { a.tagNumber = '203HRJ01AN601'; },
    a => { a.cycleStartState = 'started'; },
    a => { a.dataParcRuntimeBasis.startAt = SELECTED; },
    a => { a.dataParcRuntimeBasis.runtimeHours += 1; },
    a => { a.dataParcRuntimeBasis.appendReady = false; },
    a => { a.hasUnverifiedDataParcHistory = true; },
    a => { a.cycleRuntimeRevision = ''; }
  ];
  for (const change of changes) {
    const a = asset(); change(a); const f = harness({ asset: a });
    assert.equal(f.ui.rolePriorityRecoveryProof(a), null, change.toString());
    f.ui.openDataParcRuntimeDialog(a.tagNumber, { rolePriority: true });
    assert.equal(f.ui.elements.dataparcRuntimeDialog.open, false);
    assert.equal(f.calls.length, 0);
  }
});

test('read-only, mobile and busy views do not launch selected-basis mutation', async () => {
  for (const mode of ['public','mobile','busy']) {
    const f = harness({ write: mode !== 'public', mobile: mode === 'mobile' });
    if (mode === 'busy') f.ui.state.unifiedRefreshBusy = true;
    assert.equal(f.ui.allOverviewRuntimeAssessment(f.asset).nextActionKey, 'history');
    f.ui.openDataParcRuntimeDialog(TAG, { rolePriority: true });
    assert.equal(f.ui.elements.dataparcRuntimeDialog.open, false);
    assert.equal(f.calls.length, 0);
  }
});

test('tampered selected clock or a session change after opening is rejected before queue creation', async () => {
  for (const mode of ['clock','session','revision']) {
    const f = harness(); f.open();
    if (mode === 'clock') f.ui.elements.dataparcRuntimeStartAt.value = '2026-09-18T14:20';
    if (mode === 'session') f.setToken('different-session');
    if (mode === 'revision') f.asset.cycleRuntimeRevision = 'changed-runtime';
    await f.submit();
    assert.equal(f.calls.length, 0, mode);
    assert.match(f.toasts.at(-1).message, /변경/);
  }
});

test('current server proof is checked before request and again before atomic adoption', async () => {
  for (const mode of ['before-create','after-wait','session-after-wait']) {
    let reads = 0;
    const f = harness({ onRead(result) {
      reads++;
      if ((mode === 'before-create' && reads === 1) || (mode === 'after-wait' && reads === 2))
        result.assets[0].replacementAutoCycle.rolePrioritySelection.selectedSourceSnapshotSha256 = 'b'.repeat(64);
    }, onWait(g) { if (mode === 'session-after-wait') g.setToken('changed-owner'); } });
    await f.sync();
    assert.equal(f.calls.some(c => c.body?.action === 'apply_role_priority_runtime_recovery'), false, mode);
    if (mode === 'before-create') assert.equal(f.calls.some(c => c.body?.action === 'create_blower_runtime_probe'), false);
    assert.equal(f.phases.includes('reload'), false);
    assert.deepEqual(f.ui.state.data, f.original);
    assert.equal(f.ui.state.dataparcRuntimeBusy, false);
  }
});

test('queue, RUN and apply failures retain the saved value with no ordinary-sync fallback', async () => {
  for (const key of ['createFailed','waitFailed','applyFailed']) {
    const f = harness({ [key]: true }); await f.sync();
    assert.equal(f.calls.some(c => c.body?.action === 'dataparc_runtime_sync'), false, key);
    assert.equal(f.phases.includes('reload'), false);
    assert.deepEqual(f.ui.state.data, f.original);
    assert.equal(f.ui.state.dataparcRuntimeBusy, false);
    assert.equal(f.toasts.at(-1).kind, 'error');
  }
});
