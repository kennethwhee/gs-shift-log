import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const guide = require('../maintenance/blower-resolution-guide.js');
const core = require('../maintenance/blower-unified-refresh.js');
const assessor = require('../maintenance/blower-runtime-assessment.js');
const historySource = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const NOW = '2026-11-07T01:30:00.000Z';
const OBSERVED = '2026-11-06T15:01:15.000Z';
const WINDOW_START = '2026-09-16T00:23:00.000Z';
const WINDOW_END = '2026-09-16T15:00:00.000Z';
const RANGE_START = '2026-09-16T00:30:00.000Z';
const HASH = 'a'.repeat(64);

function asset(tag = '204HHL60AP631', type = 'fbhe') {
  const signal = `GSPOGE.ABB_DCS.${tag}XB04`;
  return { tagNumber: tag, displayName: '#2 FBHE Blower #C', blowerType: type, enabled: true,
    unitNo: '2', positionLabel: '#C', severity: 'unset', sortOrder: 1,
    lastReplacementAt: '2026-09-16T00:00:00+09:00', actualLastReplacementAt: '',
    cycleStartState: 'pending', cycleStoredStartedAt: '', cycleStartRevision: 'owner-start',
    cycleRuntimeRevision: 'owner-runtime', cycleRuntimeAnchorAt: OBSERVED,
    cycleRuntimeState: 'running', operationState: 'running', isRunning: true,
    dataParcTag: signal, cycleElapsedHours: 734, runtimeHours: 734,
    measurementRequired: false, hasUnverifiedDataParcHistory: false,
    dataParcRuntimeBasis: { requestId: 'tail-request', dataParcTag: signal, startAt: RANGE_START,
      observedAt: OBSERVED, requiredStartAt: '2026-09-16T00:00:00+09:00', runtimeHours: 734,
      runningSeconds: 734 * 3600, appendReady: true, coverageComplete: false, cycleBasisConfirmed: false },
    runtimeCoverageEvidence: { version: 1, source: 'dataparc', measurementVerified: true, requestId: 'tail-request',
      hours: 734, startAt: RANGE_START, observedAt: OBSERVED, coverageComplete: false,
      missingLeadingSeconds: 34200, cycleBasisConfirmed: false, wholeCycleVerified: false },
    runRuntime: { verified: true, source: 'dataparc', state: 'running', measuredAt: OBSERVED },
    replacementAutoCycle: { schemaVersion: 3, normalizationVersion: 4, clockKnown: false, timePrecision: 'day',
      registeredBaseline: true, registeredRuntimeRange: true, sourceLogId: 'approved-sep16-BO2',
      sourceSnapshotSha256: HASH },
    cycleSourceReview: { code: 'VERIFIED_RUNTIME_RANGE', cycleBasisConfirmed: false, measuredRangeMayContinue: true }
  };
}

function candidate() {
  const a = asset();
  a.completionWindowRecovery = { version: 1, eligible: true, startAt: WINDOW_START, endAt: WINDOW_END,
    windowStartAt: WINDOW_START, windowEndAt: WINDOW_END, dataParcTag: a.dataParcTag };
  return a;
}

function certified() {
  const a = asset(); delete a.cycleSourceReview;
  Object.assign(a.runtimeCoverageEvidence, {
    durationEquivalent: true, durationVerified: true, coverageComplete: true, missingLeadingSeconds: 0,
    completionClockKnown: false, completionWindowCertificateId: 'certificate'
  });
  a.completionWindowProof = { version: 1, kind: 'completion_window_zero', durationVerified: true,
    completionClockKnown: false, windowStartAt: WINDOW_START, windowEndAt: WINDOW_END,
    certificateEventId: 'certificate', requestId: 'zero-request', runtimeRequestId: 'tail-request',
    runtimeRevision: a.cycleRuntimeRevision, baseEventId: 'tail-event',
    sourceLogId: a.replacementAutoCycle.sourceLogId, sourceSnapshotSha256: HASH,
    certificateOnly: true, dataParcTag: a.dataParcTag, cycleStartRevision: a.cycleStartRevision };
  return a;
}

function negativeWindow(reasonCode = 'CONTINUOUS_STOP_UNPROVEN') {
  const a = candidate();
  a.completionWindowRecovery.eligible = false;
  a.replacementAutoCycle.replacementEventId = 'original-replacement';
  a.replacementAutoCycle.eventId = 'later-reconciliation';
  a.completionWindowRecoveryReview = { version: 1, mode: 'completion_window_zero', status: 'source_required',
    automaticRetry: false, reasonCode, requestId: 'unsuccessful-window', windowStartAt: WINDOW_START,
    windowEndAt: WINDOW_END, runningSeconds: reasonCode === 'RUN_OBSERVED' ? 600 : 0,
    startState: 'stopped', endState: 'unknown', collectedAt: NOW, completedAt: NOW,
    dataParcTag: a.dataParcTag, cycleStartRevision: a.cycleStartRevision, runtimeRevision: a.cycleRuntimeRevision,
    runtimeRequestId: a.dataParcRuntimeBasis.requestId, baseEventId: 'older-runtime-tail',
    replacementEventId: a.replacementAutoCycle.replacementEventId, sourceLogId: a.replacementAutoCycle.sourceLogId,
    sourceSnapshotSha256: HASH, proofFingerprint: 'b'.repeat(64) };
  return a;
}

function queryResult(a, extras = {}) {
  return { tagNumber: a.tagNumber, status: 'failed', requestId: 'failed-request', dataParcTag: a.dataParcTag,
    cycleSnapshot: core.snapshot(a), errorCode: 'DATAPARC_APPEND_BOUNDARY_CHANGED', failureStage: 'apply',
    startAt: a.dataParcRuntimeBasis.observedAt, endAt: NOW, completedAt: NOW,
    message: 'Previous boundary and new boundary differ. Existing value retained.', ...extras };
}

function review(a, extras = {}) {
  return { tagNumber: a.tagNumber, enabled: true, requiresReview: true, reviewGroup: 'basis',
    reasonKey: 'replacement-basis-review', reasonLabel: '교체 기준 확인',
    coverage: { startAt: RANGE_START, observedAt: OBSERVED }, ...extras };
}

function node() {
  const listeners = new Map();
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, style: {}, title: '', listeners,
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {}, replaceChildren() {},
    focus() {}, scrollIntoView() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, addEventListener(name, handler) {
      listeners.set(name, [...(listeners.get(name) || []), handler]);
    }, showModal() { this.open = true; }, close() { this.open = false; } };
}

function harness(assets, options = {}) {
  const nodes = new Map(), calls = []; let mobile = options.mobile === true;
  const context = vm.createContext({ console, URL, URLSearchParams, clearTimeout() {}, HTMLButtonElement: class {}, navigator: {},
    fetch() { throw new Error('Read-only guidance must never create a network request'); },
    localStorage: { getItem() { return JSON.stringify({ sessionToken: 'synthetic-session' }); }, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll() { return []; }, querySelector() { return null; },
      addEventListener() {}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, BlowerRuntimeAssessment: assessor, BlowerResolutionGuide: guide,
      matchMedia() { return { matches: mobile }; }, setTimeout(fn) { fn(); }, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(historySource.split(marker).length, 2);
  vm.runInContext(historySource.replace(marker, `globalThis.ui={state,elements,cacheElements,bindEvents,renderAssets,
    allOverviewRuntimeAssessment,renderAllOverviewCard,openAssetHistory,blowerResolutionGuide,blowerResolutionAccess,
    blowerResolutionActionAccess,runBlowerResolutionRefresh,renderBlowerResolutionCenter,renderBlowerResolutionHistoryGuide,
    renderCompletionWindowProof,renderUnifiedRefreshProgress,renderInlineRefreshStatus,observeUnifiedRefreshApply,
    inlineRefreshApplied,renderOverviewRefreshPanel,matchesOverviewFilter,openOverviewAssessmentAction,sendApiRequest};
    globalThis.stubRefresh=record=>{refreshAllBlowers=async()=>record('refresh');};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets, types: [['fbhe', 'FBHE Blower'], ['organic_fuel', '유기성 고형연료 Blower'],
    ['flyash_silo', 'Fly Ash Silo Aeration Blower']].map(([key, label]) => ({ key, label })),
    events: options.events || [], settings: {}, missingSlots: [], missingTags: [], generatedAt: NOW,
    permissions: { canWrite: options.write === true }, user: { name: 'Synthetic fixture' },
    backfill: { hasRun: true, status: 'complete' } };
  context.stubRefresh((...args) => calls.push(args));
  return { ui, context, calls, setMobile(value) { mobile = value; } };
}

function click(element, selector, dataset) {
  const button = { dataset };
  const event = { target: { closest(value) { return value === selector ? button : null; } } };
  for (const handler of element.listeners.get('click') || []) handler(event);
}

test('guidance is limited to current canonical review rows and a current recognized repair plan', () => {
  const a = candidate(), before = structuredClone(a), assessment = review(a);
  const plan = core.runtimeRecoveryPlan(a, NOW);
  const found = guide.describe(a, assessment, { recovery: plan });
  assert.equal(found.kind, 'automatic'); assert.equal(found.recoveryMode, 'completion_window_zero');
  assert.equal(found.queryStartAt, WINDOW_START); assert.match(found.detail, /정확한 완료시각은 미기록/);
  assert.equal(guide.describe(a, { ...assessment, requiresReview: false }, { recovery: plan }), null);
  assert.equal(guide.describe({ ...a, enabled: false }, assessment, { recovery: plan }), null);
  assert.equal(guide.describe(a, { ...assessment, tagNumber: 'other' }, { recovery: plan }), null);
  for (const invalid of [{ ...plan, recoveryMode: 'force_reset' }, { ...plan, dataParcTag: 'foreign' },
    { ...plan, startAt: '2026-09-16' }, null]) {
    assert.equal(guide.describe(a, assessment, { recovery: invalid }).kind, 'source');
  }
  assert.deepEqual(a, before, 'a display plan must not certify, reset or mutate the underlying asset');
});

test('source selection respects the exact selected event, tag, and original day precision', () => {
  const a = asset(); a.replacementAutoCycle.eventId = 'selected-source';
  a.replacementAutoCycle.rolePrioritySelection = { selectedWorkDate: '2026-09-16', selectedShift: 'DS', selectedRole: 'BO2' };
  const events = [
    { id: 'selected-source', tagNumber: 'other', eventType: 'replacement', eventDate: NOW, sourceText: 'foreign row' },
    { id: 'selected-source', tagNumber: a.tagNumber, eventType: 'replacement', eventDate: a.lastReplacementAt,
      sourceTimePrecision: 'day', sourceText: 'FBHE #C V-Belt 교체 완료' },
    { id: 'later', tagNumber: a.tagNumber, eventType: 'replacement', eventDate: NOW, sourceText: 'later unrelated record' }
  ];
  const result = guide.describe(a, review(a), { events });
  assert.equal(result.source.kind, 'selected'); assert.equal(result.source.excerpt, 'FBHE #C V-Belt 교체 완료');
  assert.equal(result.source.workDate, '2026-09-16'); assert.equal(result.source.shift, '주간');
  assert.equal(result.source.completionClockMissing, true); assert.match(result.title, /완료시각 확인/);
  assert.match(result.steps.join(' '), /V-belt 교체 완료 확인/); assert.match(result.steps.join(' '), /다시 승인/);
  assert.match(result.nextStep, /조회 시작시각이나 자정을 완료시각으로 대신 쓰지/);
  assert.equal(result.queryStartAt, '');
});

test('public historical evidence stays a reference and never becomes a selected source', () => {
  const a = asset('104ETH03AN602', 'flyash_silo'); a.lastReplacementAt = '2026-05-04T00:00:00+09:00';
  a.replacementAutoCycle.eventId = 'private-id';
  const events = [{ tagNumber: a.tagNumber, eventType: 'replacement', eventDate: '2025-10-23T09:17:00+09:00',
    sourceText: 'Silo #B V-Belt 교체 완료' }];
  const result = guide.describe(a, review(a), { events });
  assert.equal(result.source.kind, 'historical'); assert.equal(result.source.workDate, '2025-10-23');
  assert.match(result.source.label, /현재 기준 미확정/); assert.match(result.title, /과거 교체 기록과 현재 기준 대조/);
  assert.equal(result.source.role, ''); assert.equal(result.recoveryMode, '');
});

test('organic source guidance distinguishes a whole Blower replacement from a belt replacement', () => {
  const a = asset('104SDF01AN001', 'organic_fuel'); delete a.replacementAutoCycle;
  const result = guide.describe(a, review(a, { reviewGroup: 'range', reasonKey: 'coverage-gap' }), { events: [
    { tagNumber: a.tagNumber, eventType: 'replacement', eventDate: a.lastReplacementAt, sourceText: 'Blower 본체 교체 완료' }
  ] });
  assert.equal(result.kind, 'source'); assert.match(result.detail, /Blower 본체 교체와 V-Belt 교체를 구분/);
  assert.match(result.steps[0], /실제 V-Belt 교체 작업/); assert.equal(result.queryStartAt, '');
});

test('source metadata is unwrapped only as text and malformed JSON never becomes an operator quote', () => {
  const a = asset();
  const make = sourceText => guide.describe(a, review(a), { events: [{ tagNumber: a.tagNumber,
    eventType: 'replacement', eventDate: a.lastReplacementAt, sourceText }] }).source.excerpt;
  assert.equal(make(JSON.stringify({ sourceText: '원문 확인', requestId: 'internal-metadata' })), '원문 확인');
  assert.equal(make('{broken'), ''); assert.equal(make(JSON.stringify({ requestId: 'internal-metadata' })), '');
  assert.equal(make('[1호기] V-Belt 교체 완료'), '[1호기] V-Belt 교체 완료');
  assert.equal(make('[정비 기록] 완료시각 미기록'), '[정비 기록] 완료시각 미기록');
  assert.equal(make('[{"requestId":"broken'), ''); assert.equal(make('[1,2]'), '');
  assert.equal(make('a'.repeat(1500)).length, 1200);
});

test('summary is computed from actual unique review rows including missing measurement slots', () => {
  const empty = { total: 0, automatic: 0, source: 0, measurement: 0, query: 0, freshness: 0,
    requiresReview: 0, latest: 0, failed: 0, waiting: 0, behind: 0, overlap: 0 };
  assert.deepEqual(guide.summarize([{ tagNumber: 'a', kind: 'automatic', requiresReview: true },
    { tagNumber: 'b', kind: 'source', requiresReview: true }, { tagNumber: 'a', kind: 'source' },
    { tagNumber: 'c', kind: 'measurement', requiresReview: true }, { tagNumber: 'x', kind: 'fake' }, null], 2),
  { ...empty, total: 5, automatic: 1, source: 1, measurement: 3, requiresReview: 5 });
  assert.deepEqual(guide.summarize([], -1), empty);
});

test('the center is collapsed by default; toggling and opening evidence are read-only actions', () => {
  const a = candidate(), f = harness([a]); f.ui.bindEvents(); f.ui.renderAssets();
  let html = f.ui.elements.assetGroups.innerHTML;
  assert.match(html, /확인할 설비 <b>1대/); assert.match(html, /보완 검증 가능 1대/);
  assert.match(html, /id="blowerResolutionItems" class="blower-resolution-items" hidden/);
  assert.match(html, /data-resolution-action="refresh" disabled/); assert.match(html, /조회 전용 화면/);
  click(f.ui.elements.assetGroups, '[data-resolution-action]', { resolutionAction: 'toggle' });
  html = f.ui.elements.assetGroups.innerHTML;
  assert.match(html, /aria-expanded="true"/); assert.doesNotMatch(html, /class="blower-resolution-items" hidden/);
  click(f.ui.elements.assetGroups, '[data-resolution-action]', { resolutionAction: 'open', tag: a.tagNumber });
  assert.equal(f.ui.elements.historyDialog.open, true); assert.equal(f.ui.state.historyAssetTag, a.tagNumber);
  assert.match(f.ui.elements.historyCycleSummary.innerHTML, /교체 작업 중 정지 구간 검증/);
  assert.match(f.ui.elements.historyCycleSummary.innerHTML, /data-history-action="resolution_refresh" disabled/);
  assert.deepEqual(f.calls, []);
});

test('a permitted explicit action starts the existing whole-refresh workflow once and closes history', async () => {
  const a = candidate(), f = harness([a], { write: true }); f.ui.bindEvents(); f.ui.openAssetHistory(a.tagNumber);
  assert.doesNotMatch(f.ui.elements.historyCycleSummary.innerHTML, /data-history-action="resolution_refresh" disabled/);
  click(f.ui.elements.historyDialog, '[data-history-action]', { historyAction: 'resolution_refresh' });
  await Promise.resolve();
  assert.deepEqual(f.calls, [['refresh']]); assert.equal(f.ui.elements.historyDialog.open, false);
  assert.equal(a.cycleElapsedHours, 734); assert.ok(a.cycleSourceReview, 'clicking the action cannot clear the warning');
});

test('a stale enabled action rechecks live permission, mobile and each in-progress guard', async () => {
  for (const block of [f => { f.ui.state.data.permissions.canWrite = false; }, f => f.setMobile(true),
    ...['busy', 'unifiedRefreshBusy', 'dataparcRuntimeBusy', 'backfillRunning', 'auditRunning']
      .map(key => f => { f.ui.state[key] = true; })]) {
    const a = candidate(), f = harness([a], { write: true }); f.ui.openAssetHistory(a.tagNumber); block(f);
    assert.equal(await f.ui.runBlowerResolutionRefresh(a.tagNumber), false);
    assert.equal(f.ui.elements.historyDialog.open, true); assert.deepEqual(f.calls, []);
    assert.match(f.ui.renderBlowerResolutionHistoryGuide(f.ui.blowerResolutionGuide(a)), /data-history-action="resolution_refresh" disabled/);
  }
});

test('a stale recovery candidate or a source-only row cannot dispatch an automatic repair', async () => {
  for (const change of [a => { a.completionWindowRecovery.dataParcTag = 'foreign'; },
    a => { a.runtimeCoverageEvidence.requestId = 'old-owner'; }, a => { delete a.completionWindowRecovery; }]) {
    const a = candidate(), f = harness([a], { write: true }); change(a);
    assert.equal(f.ui.blowerResolutionGuide(a).kind, 'source');
    assert.equal(await f.ui.runBlowerResolutionRefresh(a.tagNumber), false); assert.deepEqual(f.calls, []);
  }
});

test('cards, history and center clear only a verified linked duration certificate while keeping the unknown clock visible', () => {
  const pending = candidate(), valid = certified(), before = structuredClone(valid), f = harness([pending]);
  assert.equal(f.ui.allOverviewRuntimeAssessment(pending).requiresReview, true);
  f.ui.state.data.assets = [valid]; f.ui.renderAssets(); f.ui.openAssetHistory(valid.tagNumber);
  const assessed = f.ui.allOverviewRuntimeAssessment(valid), card = f.ui.renderAllOverviewCard(valid);
  assert.equal(assessed.scope, 'cycle-equivalent'); assert.equal(assessed.requiresReview, false);
  assert.equal(assessed.wholeCycleVerified, false); assert.equal(f.ui.blowerResolutionGuide(valid), null);
  assert.match(card, /교체 후 누적/); assert.match(card, /<small>교체일<\/small><strong>2026-09-16<\/strong>/);
  assert.match(card, /완료시각 미기록 · 정지 구간 검증/); assert.match(card, /734\.0시간/);
  assert.doesNotMatch(card, /조회 구간 RUN|측정 구간 누적/);
  assert.match(f.ui.elements.assetGroups.innerHTML, /확인할 설비 <b>0대/);
  assert.match(f.ui.elements.historyCycleSummary.innerHTML, /data-completion-window-proof="true"/);
  assert.match(f.ui.elements.historyCycleSummary.innerHTML, /2026-09-16 09:23 → 2026-09-17 00:00/);
  assert.match(f.ui.elements.historyCycleSummary.innerHTML, /실제 교체 완료시각은 미기록/);
  assert.deepEqual(valid, before);
});

test('a bare flag, foreign owner or changed source cannot hide the current review or display a completion proof', () => {
  for (const change of [a => { delete a.completionWindowProof; }, a => { a.completionWindowProof.runtimeRequestId = 'foreign'; },
    a => { a.completionWindowProof.runtimeRevision = 'old'; }, a => { a.replacementAutoCycle.sourceSnapshotSha256 = 'b'.repeat(64); },
    a => { a.runtimeCoverageEvidence.completionWindowCertificateId = 'other-certificate'; },
    a => { a.completionWindowProof.cycleStartRevision = 'old-start'; },
    a => { a.actualLastReplacementAt = WINDOW_START; }]) {
    const a = certified(); change(a); const f = harness([a]);
    assert.equal(f.ui.renderCompletionWindowProof(a), ''); assert.equal(f.ui.allOverviewRuntimeAssessment(a).requiresReview, true);
    assert.doesNotMatch(f.ui.renderAllOverviewCard(a), /data-runtime-scope="cycle-equivalent"/);
  }
});

test('operator names and quoted evidence are escaped while stopped cards retain their background and saved hours', () => {
  const a = candidate(); a.displayName = '<img src=x onerror=alert(1)>';
  a.cycleRuntimeState = 'stopped'; a.operationState = 'stopped'; a.isRunning = false; a.runRuntime.state = 'stopped';
  a.replacementAutoCycle.eventId = 'quoted';
  const events = [{ id: 'quoted', tagNumber: a.tagNumber, eventType: 'replacement', eventDate: a.lastReplacementAt,
    sourceText: JSON.stringify({ sourceText: '<script>injected()</script> & 작업 내용', requestId: 'secret-internal-metadata' }) }];
  const f = harness([a], { events, mobile: true }); f.ui.renderAssets(); f.ui.openAssetHistory(a.tagNumber);
  const dashboard = f.ui.elements.assetGroups.innerHTML, history = f.ui.elements.historyCycleSummary.innerHTML;
  assert.doesNotMatch(dashboard, /<img src=x/); assert.match(dashboard, /&lt;img src=x/);
  assert.doesNotMatch(history, /<script>|secret-internal-metadata/); assert.match(history, /&lt;script&gt;injected/);
  assert.match(f.ui.renderAllOverviewCard(a), /all-overview-card-shell is-stopped/);
  assert.match(f.ui.renderAllOverviewCard(a), /734\.0시간/); assert.deepEqual(f.calls, []);
});

test('the disabled next step remains visible in the read-only and mobile guide without changing stopped-state styles', () => {
  const css = fs.readFileSync(new URL('../maintenance/blower-resolution-guide.css', import.meta.url), 'utf8');
  assert.match(css, /body\.public-monitoring \.blower-resolution-guide \[data-mobile-write\]:disabled \{ display: inline-flex !important;/);
  assert.match(css, /@media[\s\S]*\.blower-resolution-guide \[data-mobile-write\]:disabled \{ display: inline-flex !important;/);
  assert.doesNotMatch(css, /\.all-overview-card|\.is-stopped\s*\{/);
});

test('long source quotations remain available in a closed disclosure so the next action stays immediately visible', () => {
  const a = asset('104HHL60AP621'), excerpt = '작업 기록 원문을 보존하면서 완료시각 확인 절차를 먼저 보여줍니다. '.repeat(18);
  const events = [{ tagNumber: a.tagNumber, eventType: 'replacement', eventDate: a.lastReplacementAt, sourceText: excerpt }];
  const f = harness([a], { events, mobile: true }); f.ui.openAssetHistory(a.tagNumber);
  const html = f.ui.elements.historyCycleSummary.innerHTML;
  assert.match(html, /<details class="blower-resolution-source-quote"><summary>긴 원문 발췌 보기<\/summary>/);
  assert.ok(html.includes(excerpt.trim())); assert.match(html, /V-belt 교체 완료 확인/);
  assert.equal((html.match(/<summary>기존 저장 구간 정보<\/summary>/g) || []).length, 1);
  assert.deepEqual(f.calls, []);
});

test('only the newest typed result for the exact current cycle and signal becomes a live query issue', () => {
  const a = asset(), failed = queryResult(a), before = structuredClone(failed);
  assert.equal(guide.currentQueryResult(a, [failed]).errorCode, 'DATAPARC_APPEND_BOUNDARY_CHANGED');
  for (const change of [r => { delete r.cycleSnapshot; }, r => { delete r.dataParcTag; },
    r => { r.dataParcTag = 'GSPOGE.ABB_DCS.OTHER'; }, r => { r.cycleSnapshot.cycleRuntimeRevision = 'older'; },
    r => { r.cycleSnapshot.cycleStartRevision = 'older'; }, r => { r.cycleSnapshot.cycleStartedAt = NOW; },
    r => { r.cycleSnapshot.lastReplacementAt = NOW; }, r => { r.startAt = '2026-11-06'; },
    r => { r.endAt = r.startAt; }]) {
    const invalid = structuredClone(failed); change(invalid);
    assert.equal(guide.currentQueryResult(a, [invalid]), null);
  }
  assert.equal(guide.currentQueryResult(a, [failed, { ...failed, status: 'complete' }]), null);
  assert.deepEqual(failed, before);
});

test('a time difference alone is neutral; an actual boundary failure adds a separate query issue without inventing a basis error', () => {
  const a = asset('204SDF01AN002', 'organic_fuel'); a.cycleElapsedHours = a.runtimeHours = 1152.5630555555556;
  const assessment = review(a, { requiresReview: false, reasonLabel: '', freshness: { state: 'behind' } });
  const old = guide.describe(a, assessment);
  assert.equal(old.kind, 'freshness'); assert.equal(old.requiresReview, false);
  assert.match(old.detail, /시각 차이만으로 조회 실패나 누적 기준 오류/);
  const result = guide.describe(a, assessment, { results: [queryResult(a)] });
  assert.equal(result.kind, 'query'); assert.equal(result.action, 'refresh'); assert.equal(result.requiresReview, false);
  assert.match(result.title, /조회 구간 연결 확인/); assert.doesNotMatch(result.nextStep, /완료시각|V-Belt/);
  assert.equal(a.cycleElapsedHours, 1152.5630555555556);
});

test('eight basis reviews and three old failed results with two shared assets are nine unique guides', () => {
  const assets = Array.from({ length: 9 }, (_, i) => asset(`104TAG${i}`, i === 8 ? 'organic_fuel' : 'fbhe'));
  const failed = [assets[0], assets[1], assets[8]].map(a => queryResult(a));
  const assessments = new Map(assets.map((a, i) => [a.tagNumber, review(a, {
    requiresReview: i < 8, reasonLabel: i < 8 ? '교체 기준 확인' : '',
    freshness: { state: [0, 1, 8].includes(i) ? 'behind' : 'aligned' }
  })]));
  const rows = assets.map(a => guide.describe(a, assessments.get(a.tagNumber), { results: failed }));
  const summary = guide.summarize(rows);
  assert.equal(summary.total, 9); assert.equal(summary.requiresReview, 8);
  assert.equal(summary.latest, 3); assert.equal(summary.failed, 3); assert.equal(summary.overlap, 2);
  const f = harness(assets); f.ui.state.unifiedRefreshResults = failed;
  const html = f.ui.renderBlowerResolutionCenter(assets, assessments);
  assert.match(html, /확인할 설비 <b>9대/); assert.match(html, /누적 근거 확인 8대 · 최신 반영 확인 3대/);
  assert.match(html, /겹치는 2대는 한 번만/); assert.match(html, /최근 조회 미반영 3대/);
  assert.doesNotMatch(html, /11대/);
});

test('a failed method is not advertised as automatic again while a changed registered-range method remains explicit', () => {
  const a = candidate(), plan = core.runtimeRecoveryPlan(a, NOW);
  const zeroFailure = queryResult(a, { errorCode: 'BLOWER_COMPLETION_WINDOW_NOT_ZERO', recoveryMode: 'completion_window_zero' });
  const old = guide.describe(a, review(a), { recovery: plan, results: [zeroFailure] });
  assert.equal(old.kind, 'query'); assert.equal(old.action, 'review');
  assert.doesNotMatch(old.detail, /운전 기록이 있어/);
  const seal = asset('204HHL10AN631', 'seal_pot');
  const firstRunFailure = queryResult(seal, { errorCode: 'DATAPARC_FIRST_RUN_UNVERIFIED', recoveryMode: 'seal_first_run' });
  const changed = guide.describe(seal, review(seal), { results: [firstRunFailure], recovery: {
    recoveryMode: 'seal_registered_range', startAt: RANGE_START, dataParcTag: seal.dataParcTag
  } });
  assert.equal(changed.kind, 'automatic'); assert.equal(changed.action, 'refresh');
  assert.match(changed.detail, /실제 최초 기동시각을 확인한 것으로 처리하지 않습니다/);
  assert.equal(changed.queryResult.errorCode, 'DATAPARC_FIRST_RUN_UNVERIFIED');
  const fullFailure = guide.describe(seal, review(seal), { results: [queryResult(seal, { recoveryMode: 'append_boundary_full' })] });
  assert.equal(fullFailure.action, 'review'); assert.match(fullFailure.title, /연결 구간 보완 미반영/);
});

test('bound negative completion-window evidence retains the source review and permits only ordinary latest refresh guidance', () => {
  for (const reasonCode of ['CONTINUOUS_STOP_UNPROVEN', 'RUN_OBSERVED']) {
    const a = negativeWindow(reasonCode), before = structuredClone(a);
    assert.equal(guide.verifiedCompletionWindowReview(a), a.completionWindowRecoveryReview);
    const described = guide.describe(a, review(a), { recovery: null });
    assert.equal(described.kind, 'source'); assert.equal(described.requiresReview, true);
    assert.equal(described.recoveryMode, ''); assert.equal(described.action, 'refresh');
    assert.match(described.nextStep, /같은 과거 정지 구간은 자동 재조회하지 않습니다/);
    assert.equal(/운전 기록이 있어/.test(described.detail), reasonCode === 'RUN_OBSERVED');
    const f = harness([a], { write: true });
    const html = f.ui.renderBlowerResolutionHistoryGuide(described);
    assert.match(html, /data-completion-window-review="true"/);
    assert.equal(/확인된 RUN 600초/.test(html), reasonCode === 'RUN_OBSERVED');
    assert.match(html, /V-belt 교체 완료 확인/); assert.equal(a.actualLastReplacementAt, '');
    assert.deepEqual(a, before);
  }
});

test('negative evidence is discarded on changed owner, source, signal, receipt or malformed numbers', () => {
  for (const change of [a => { a.completionWindowRecovery.eligible = true; },
    a => { a.completionWindowProof = {}; }, a => { a.completionWindowRecoveryReview.dataParcTag = 'other'; },
    a => { a.completionWindowRecoveryReview.replacementEventId = a.replacementAutoCycle.eventId; },
    a => { a.completionWindowRecoveryReview.runtimeRevision = 'old'; },
    a => { a.completionWindowRecoveryReview.runtimeRequestId = 'old'; },
    a => { a.completionWindowRecoveryReview.cycleStartRevision = 'old'; },
    a => { a.replacementAutoCycle.sourceSnapshotSha256 = 'c'.repeat(64); },
    a => { a.actualLastReplacementAt = WINDOW_START; }, a => { a.dataParcRuntimeBasis.runtimeHours = NaN; },
    a => { a.runtimeCoverageEvidence.hours = Infinity; }, a => { a.completionWindowRecoveryReview.runningSeconds = 0.5; },
    a => { a.completionWindowRecoveryReview.reasonCode = 'RUN_OBSERVED'; }]) {
    const a = negativeWindow(); change(a); assert.equal(guide.verifiedCompletionWindowReview(a), null);
  }
  // A valid later append retains the original failed-window event but links
  // the review to the current visible tail, as projected by the server.
  const advanced = negativeWindow(); advanced.cycleRuntimeRevision = 'new-runtime';
  advanced.dataParcRuntimeBasis.requestId = advanced.runtimeCoverageEvidence.requestId = 'new-tail';
  advanced.dataParcRuntimeBasis.observedAt = advanced.runtimeCoverageEvidence.observedAt =
    advanced.cycleRuntimeAnchorAt = advanced.runRuntime.measuredAt = NOW;
  advanced.completionWindowRecoveryReview.runtimeRevision = 'new-runtime';
  advanced.completionWindowRecoveryReview.runtimeRequestId = 'new-tail';
  assert.ok(guide.verifiedCompletionWindowReview(advanced));
});

test('waiting guidance resumes only an exact accepted request and never enables a fresh duplicate request', async () => {
  const a = candidate(), f = harness([a], { write: true });
  f.ui.state.unifiedRefreshResults = [queryResult(a, { status: 'waiting', errorCode: 'REQUEST_TIMEOUT' })];
  let described = f.ui.blowerResolutionGuide(a);
  assert.equal(described.action, 'resume'); assert.equal(described.kind, 'query');
  assert.equal(await f.ui.runBlowerResolutionRefresh(a.tagNumber), false);
  f.ui.state.unifiedRuntimeResume = { createdBatch: { results: [{ assetTag: a.tagNumber, item: { id: 'foreign-id' } }] } };
  assert.equal(await f.ui.runBlowerResolutionRefresh(a.tagNumber), false);
  f.ui.state.unifiedRuntimeResume.createdBatch.results[0].item.id = 'failed-request';
  assert.match(f.ui.renderBlowerResolutionHistoryGuide(described), /조회 결과 다시 확인/);
  assert.equal(await f.ui.runBlowerResolutionRefresh(a.tagNumber), true);
  assert.deepEqual(f.calls, [['refresh']]);
});

test('a saved organic runtime keeps its scope, stopped color and hours while actual failed query details remain readable', () => {
  const a = asset('204SDF01AN002', 'organic_fuel'), start = '2026-07-24T10:00:00.000Z';
  a.lastReplacementAt = a.actualLastReplacementAt = '2026-07-24T00:00:00+09:00';
  a.cycleStartState = 'started'; a.cycleStartedAt = a.cycleStoredStartedAt = start;
  a.cycleElapsedHours = a.runtimeHours = 1152.5630555555556;
  a.operationState = a.cycleRuntimeState = 'stopped'; a.isRunning = false;
  delete a.runRuntime; delete a.replacementAutoCycle; delete a.cycleSourceReview;
  Object.assign(a.dataParcRuntimeBasis, { startAt: start, requiredStartAt: start, coverageComplete: true,
    missingLeadingSeconds: 0, runtimeHours: a.runtimeHours, runningSeconds: 4149227 });
  Object.assign(a.runtimeCoverageEvidence, { startAt: start, requiredStartAt: start, coverageComplete: true,
    missingLeadingSeconds: 0, hours: a.runtimeHours });
  const f = harness([a]), baseline = f.ui.allOverviewRuntimeAssessment(a);
  f.ui.state.unifiedRefreshResults = [queryResult(a, { message: '<script>unsafe()</script>' })];
  const assessed = f.ui.allOverviewRuntimeAssessment(a), card = f.ui.renderAllOverviewCard(a);
  assert.equal(assessed.requiresReview, false); assert.equal(assessed.scope, baseline.scope); assert.equal(assessed.hours, baseline.hours);
  assert.match(card, /1,152\.6시간/); assert.match(card, /is-stopped/); assert.match(card, /data-runtime-review="false"/);
  assert.match(card, /data-query-result="failed"/); assert.match(card, /조회 결과 보기/);
  assert.equal(f.ui.matchesOverviewFilter(a, assessed, 'query'), true);
  assert.equal(f.ui.matchesOverviewFilter(a, assessed, 'review'), false);
  f.ui.openOverviewAssessmentAction(a.tagNumber);
  const html = f.ui.elements.historyCycleSummary.innerHTML;
  assert.match(html, /2026-11-07 00:01/); assert.match(html, /2026-11-07 10:30/);
  assert.match(html, /DATAPARC_APPEND_BOUNDARY_CHANGED/); assert.match(html, /&lt;script&gt;unsafe/);
  assert.doesNotMatch(html, /<script>|V-belt 교체 완료 확인/);
  assert.match(fs.readFileSync(new URL('../maintenance/blower-readable-compact-v1.css', import.meta.url), 'utf8'), /#fff1f1/);
  assert.deepEqual(f.calls, []);
});

test('all recovery modes count and a completion-window certificate never advances the runtime reflection count or saved time', () => {
  const a = certified(), f = harness([a]);
  const modes = ['role_priority', 'confirmed_gap', 'seal_first_run', 'seal_registered_range', 'completion_window_zero', 'append_boundary_full'];
  const results = modes.map((recoveryMode, i) => ({ tagNumber: `T${i}`, status: 'complete', recoveryMode,
    recoveryApplied: true, message: '검증 완료' }));
  f.ui.state.unifiedRefreshResults = results; f.ui.state.unifiedRefreshProgressTarget = 6;
  f.ui.state.unifiedRefreshInlineOutcome = 'complete'; f.ui.renderUnifiedRefreshProgress('완료');
  assert.match(f.ui.elements.unifiedRefreshSummary.textContent, /반영 5대 · 보완 반영 6대 · 근거 검증 1대\(누적값·반영 시각 유지\)/);
  f.ui.observeUnifiedRefreshApply({ body: { action: 'apply_completion_window_runtime_recovery', requestId: 'cert' } },
    { ok: true, requestId: 'cert', tagNumber: a.tagNumber, applied: true, certificateOnly: true });
  assert.equal(f.ui.inlineRefreshApplied(), 0); f.ui.renderInlineRefreshStatus();
  assert.match(f.ui.elements.overviewRefreshCount.textContent, /반영 5대/);
  assert.match(f.ui.elements.overviewRefreshCount.textContent, /근거 검증 1대 · 반영 시각 유지/);
  f.ui.renderOverviewRefreshPanel(); assert.equal(f.ui.elements.overviewLatestQueryAt.textContent, '2026-11-07 00:01');
  results[4].unchanged = true; f.ui.renderUnifiedRefreshProgress('동일 증거 확인');
  assert.match(f.ui.elements.unifiedRefreshSummary.textContent, /반영 5대/);
  assert.doesNotMatch(f.ui.elements.unifiedRefreshSummary.textContent, /유지 1대/);
});

test('the summary keeps all current basis reviews even when their latest query failed and details preserve typed reasons safely', () => {
  const a = candidate(), f = harness([a]);
  const failed = queryResult(a, { errorCode: 'BLOWER_COMPLETION_WINDOW_NOT_ZERO', recoveryMode: 'completion_window_zero',
    message: '<img src=x onerror=boom>' });
  f.ui.state.unifiedRefreshResults = [failed]; const before = structuredClone(failed);
  f.ui.renderUnifiedRefreshProgress('부분 완료');
  assert.match(f.ui.elements.unifiedRefreshSummary.textContent, /기준·구간 확인 1대/);
  assert.match(f.ui.elements.unifiedRefreshSummary.textContent, /실패 1대/);
  assert.match(f.ui.elements.unifiedRefreshList.innerHTML, /정지 구간 입증 안 됨/);
  assert.match(f.ui.elements.unifiedRefreshList.innerHTML, /저장 전 검증/);
  assert.match(f.ui.elements.unifiedRefreshList.innerHTML, /&lt;img src=x/);
  assert.doesNotMatch(f.ui.elements.unifiedRefreshList.innerHTML, /<img/);
  assert.deepEqual(failed, before);
});

test('the API adapter forwards only a bounded boundary recovery envelope for the same failed request', async () => {
  const a = asset('204SDF01AN002', 'organic_fuel'), f = harness([a], { write: true });
  const boundary = { version: 1, eligible: true, requestId: 'attempt', assetTag: a.tagNumber,
    dataParcTag: a.dataParcTag, startAt: RANGE_START, endAt: NOW, arbitraryAuthority: true };
  const read = async (payload) => {
    f.context.fetch = async () => ({ ok: false, status: 409, headers: { get() { return null; } }, text: async () => JSON.stringify(payload) });
    try { await f.ui.sendApiRequest({ method: 'POST', timeoutMs: 0, body: { action: 'dataparc_runtime_sync', requestId: 'attempt' } }); }
    catch (error) { return error; }
    assert.fail('fixture must fail');
  };
  const payload = { ok: false, code: 'DATAPARC_APPEND_BOUNDARY_CHANGED', message: 'Boundary differs', boundaryRecovery: boundary };
  const good = await read(payload);
  assert.equal(good.code, payload.code); assert.equal(good.boundaryRecovery.requestId, 'attempt');
  assert.equal(good.boundaryRecovery.arbitraryAuthority, undefined); assert.ok(Object.isFrozen(good.boundaryRecovery));
  for (const change of [p => { p.code = 'UNRELATED_ERROR'; }, p => { p.boundaryRecovery.requestId = 'foreign'; },
    p => { p.boundaryRecovery.eligible = false; }, p => { p.boundaryRecovery.version = 2; },
    p => { p.boundaryRecovery.dataParcTag = 'bad signal'; }, p => { p.boundaryRecovery.startAt = '2026-09-16'; },
    p => { p.boundaryRecovery.endAt = p.boundaryRecovery.startAt; }, p => { p.boundaryRecovery.startAt = '2020-01-01T00:00:00Z'; }]) {
    const bad = structuredClone(payload); change(bad); assert.equal((await read(bad)).boundaryRecovery, undefined);
  }
});
