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
    runBlowerResolutionRefresh,renderBlowerResolutionCenter,renderBlowerResolutionHistoryGuide,renderCompletionWindowProof};
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
  assert.deepEqual(guide.summarize([{ tagNumber: 'a', kind: 'automatic' }, { tagNumber: 'b', kind: 'source' },
    { tagNumber: 'a', kind: 'source' }, { tagNumber: 'c', kind: 'measurement' }, { tagNumber: 'x', kind: 'fake' }, null], 2),
  { total: 5, automatic: 1, source: 1, measurement: 3 });
  assert.deepEqual(guide.summarize([], -1), { total: 0, automatic: 0, source: 0, measurement: 0 });
});

test('the center is collapsed by default; toggling and opening evidence are read-only actions', () => {
  const a = candidate(), f = harness([a]); f.ui.bindEvents(); f.ui.renderAssets();
  let html = f.ui.elements.assetGroups.innerHTML;
  assert.match(html, /확인 항목 <b>1대/); assert.match(html, /자동 보완 1대/);
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
  assert.match(f.ui.elements.assetGroups.innerHTML, /확인 항목 <b>0대/);
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
