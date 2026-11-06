import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../maintenance/blower-unified-refresh.js');
const assessment = require('../maintenance/blower-runtime-assessment.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const END = '2026-11-05T23:47:00.000Z';
const START = '2026-08-26T23:40:00.000Z';
const types = [
  ['fbhe', 'FBHE Blower'], ['seal_pot', 'Seal Pot Blower'], ['organic_fuel', '유기성 고형연료 Blower'],
  ['flyash_bag', 'Fly Ash Bag Filter Aeration Blower'], ['flyash_silo', 'Fly Ash Silo Aeration Blower'], ['limestone', 'Limestone Blower']
].map(([key, label]) => ({ key, label }));

function node() {
  const listeners = new Map();
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false, open: false,
    dataset: {}, style: {}, title: '', listeners, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {}, scrollIntoView() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    addEventListener(name, handler) { listeners.set(name, [...(listeners.get(name) || []), handler]); },
    showModal() { this.open = true; }, close() { this.open = false; } };
}

function harness(assets, options = {}) {
  const nodes = new Map(), calls = [];
  let mobile = options.mobile === true;
  const context = vm.createContext({ console, URL, URLSearchParams, clearTimeout() {}, HTMLButtonElement: class {}, navigator: {},
    fetch() { throw new Error('Rendering and opening a workflow must not make a live request'); },
    localStorage: { getItem() { return JSON.stringify({ sessionToken: 'synthetic-ui-session' }); }, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll() { return []; }, querySelector() { return null; },
      addEventListener() {}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, BlowerRuntimeAssessment: assessment,
      matchMedia() { return { matches: mobile }; }, setTimeout(fn) { fn(); }, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui={state,elements,cacheElements,bindEvents,renderAssets,renderStatusFilters,renderAllOverviewCard,
    allOverviewRuntimeAssessment,allOverviewQueryStats,matchesOverviewFilter,openOverviewAssessmentAction,openAssetHistory,
    confirmedGapRecoveryProof,overviewManualTimestamp};
    globalThis.stubWorkflows=record=>{openAssetHistory=tag=>record('history',tag);
      openDataParcRuntimeDialog=(tag,options)=>record('runtime',tag,options);
      openLimestoneBasisDialog=tag=>record('basis',tag);};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets, types, events: [], settings: {}, missingSlots: [], missingTags: [],
    permissions: { canWrite: options.write === true }, user: { name: 'Synthetic fixture' }, backfill: { hasRun: true, status: 'complete' } };
  return { ui, context, calls, setMobile(value) { mobile = value; },
    stubWorkflows() { context.stubWorkflows((...args) => calls.push(args)); } };
}

function measured(tagNumber, blowerType = 'fbhe', hours = 163.4, extras = {}) {
  const dataParcTag = `GSPOGE.ABB_DCS.${tagNumber}XB04`;
  const basis = { requestId: `fixture-${tagNumber}`, dataParcTag, startAt: START, observedAt: END,
    requiredStartAt: START, runtimeHours: hours, runningSeconds: Math.round(hours * 3600), appendReady: true, coverageComplete: true };
  const asset = { tagNumber, dataParcTag, blowerType, unitNo: '2', positionLabel: '#A', displayName: tagNumber,
    enabled: true, sortOrder: 1, lastReplacementAt: START, actualLastReplacementAt: START,
    cycleStartState: 'legacy', cycleStoredStartedAt: '', cycleStartRevision: 'fixture-start', cycleRuntimeRevision: 'fixture-runtime',
    cycleElapsedHours: hours, runtimeHours: hours, cycleRuntimeTracked: true, cycleRuntimeState: 'running', operationState: 'running',
    isRunning: true, runtimeAccumulationMode: 'measured_only', runtimeMeasuredAt: END, severity: 'unset', measurementRequired: false,
    dataParcRuntimeBasis: basis,
    runtimeCoverageEvidence: { version: 1, source: 'dataparc', measurementVerified: true, hours, requestId: basis.requestId,
      startAt: START, observedAt: END, requiredStartAt: START, missingLeadingSeconds: 0, coverageComplete: true,
      cycleBasisConfirmed: false, wholeCycleVerified: false, firstRunVerified: false }, ...extras };
  if (['fbhe', 'seal_pot'].includes(blowerType)) asset.runRuntime = {
    verified: true, source: 'dataparc', state: asset.cycleRuntimeState, measuredAt: END
  };
  return asset;
}

function roster() {
  const rows = [
    ['104HHL60AP611','fbhe','1','#A',691.7,'running','basis'], ['104HHL60AP621','fbhe','1','#B',0,'stopped','basis'],
    ['104HHL60AP631','fbhe','1','#C',1510.1,'running'], ['204HHL60AP611','fbhe','2','#A',163.4,'running'],
    ['204HHL60AP621','fbhe','2','#B',1060.2,'stopped'], ['204HHL60AP631','fbhe','2','#C',719.4,'running','basis'],
    ['104HHL10AN611','seal_pot','1','#A',0,'stopped'], ['104HHL10AN621','seal_pot','1','#B',2279.5,'running'],
    ['104HHL10AN631','seal_pot','1','#C',3992.7,'running'], ['204HHL10AN611','seal_pot','2','#A',4118.7,'running','range'],
    ['204HHL10AN621','seal_pot','2','#B',0,'stopped'], ['204HHL10AN631','seal_pot','2','#C',4286.7,'running','range'],
    ['104SDF01AN001','organic_fuel','1','#A',1322.5,'running','range'], ['104SDF01AN002','organic_fuel','1','#B',851.4,'running'],
    ['204SDF01AN001','organic_fuel','2','#A',1704.2,'running'], ['204SDF01AN002','organic_fuel','2','#B',1144.4,'running'],
    ['204LMDF01AN001','organic_fuel','2','#1',45.9,'running'], ['104ETG30AN601','flyash_bag','1','#A',1002.1,'running'],
    ['104ETG30AN602','flyash_bag','1','#B',456.7,'running','range'], ['204ETG30AN601','flyash_bag','2','#A',1001.9,'running'],
    ['204ETG30AN602','flyash_bag','2','#B',1078.4,'running'], ['104ETH03AN601','flyash_silo','shared','#A',2326.3,'stopped'],
    ['104ETH03AN602','flyash_silo','shared','#B',1995.2,'running','basis'], ['103HRJ01AN601','limestone','1','#A',1170.4,'running','basis'],
    ['103HRJ01AN602','limestone','1','#B',1088.4,'running','basis'], ['203HRJ01AN601','limestone','2','#A',1130.1,'running','basis'],
    ['203HRJ01AN602','limestone','2','#B',1078.2,'running']
  ];
  return rows.map(([tag, type, unit, position, hours, state, review], index) => {
    const a = measured(tag, type, hours, { unitNo: unit, positionLabel: position, sortOrder: index,
      cycleRuntimeState: state, operationState: state, isRunning: state === 'running', limestoneAutoApply: type === 'limestone' });
    if (tag === '204LMDF01AN001') a.assetGroup = 'manure';
    if (review === 'basis') a.cycleSourceReview = { code: 'VERIFIED_RUNTIME_RANGE', cycleBasisConfirmed: false,
      measuredRangeMayContinue: true, message: 'Synthetic source review preserved in detailed history.' };
    if (review === 'range') {
      a.dataParcRuntimeBasis.coverageComplete = false;
      a.runtimeCoverageEvidence.coverageComplete = false;
      a.runtimeCoverageEvidence.missingLeadingSeconds = 3600;
    }
    if (['204HHL60AP611', '204HHL60AP621'].includes(tag)) {
      a.runtimeCoverageEvidence.cycleBasisConfirmed = true;
      a.runtimeCoverageEvidence.wholeCycleVerified = true;
    }
    if (tag === '204HHL60AP621') a.stopMaintenance = { kind: 'oil_change', workDate: '2026-11-05' };
    if (tag === '203HRJ01AN601') {
      const older = '2026-11-05T17:09:00.000Z';
      a.dataParcRuntimeBasis.observedAt = older; a.runtimeCoverageEvidence.observedAt = older; a.runtimeMeasuredAt = older;
    }
    return a;
  });
}

test('all 27 retain their numbers and group order; review and freshness counts use the displayed assessments', () => {
  const assets = roster(), before = structuredClone(assets), { ui } = harness(assets);
  ui.renderAssets();
  const html = ui.elements.assetGroups.innerHTML;
  assert.equal((html.match(/class="all-overview-card is-assessed"/g) || []).length, 27);
  for (const [key, label] of types.map(t => [t.key, t.label])) assert.ok(html.includes(`data-overview-type="${key}"`), label);
  assert.ok(html.indexOf('data-overview-type="fbhe"') < html.indexOf('data-overview-type="seal_pot"'));
  assert.ok(html.indexOf('data-overview-type="flyash_silo"') < html.indexOf('data-overview-type="limestone"'));
  const summaries = assets.map(a => ui.allOverviewRuntimeAssessment(a));
  const counts = assessment.summarize(summaries);
  assert.deepEqual({ total: counts.total, review: counts.requiresReview, basis: counts.basisReview, range: counts.rangeReview,
    behind: counts.behind, running: counts.running, stopped: counts.stopped, intermittent: counts.intermittent },
  { total: 27, review: 11, basis: 7, range: 4, behind: 1, running: 17, stopped: 5, intermittent: 5 });
  for (const a of assets) {
    const card = ui.renderAllOverviewCard(a);
    assert.ok(card.includes(`${a.cycleElapsedHours.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}시간`));
    assert.match(card, /누적 운전시간/);
    assert.match(card, /조회 시작/);
    assert.match(card, /반영 시각/);
    assert.match(card, /data-asset-action="overview_review"/);
  }
  assert.match(ui.renderAllOverviewCard(assets.find(a => a.tagNumber === '204HHL60AP621')), /오일 교체 완료 · V-Belt 누적 유지/);
  assert.deepEqual(assets, before, 'presentation cannot reset hours, rewrite sources or change operating state');
  const disabled = structuredClone(assets[0]); disabled.tagNumber = 'DISABLED_FIXTURE'; disabled.enabled = false; disabled.severity = 'warning';
  ui.state.data.assets.push(disabled); ui.renderAssets();
  assert.equal((ui.elements.assetGroups.innerHTML.match(/class="all-overview-card is-assessed"/g) || []).length, 27);
  assert.doesNotMatch(ui.elements.assetGroups.innerHTML, /DISABLED_FIXTURE/);
  assert.match(ui.elements.assetGroups.innerHTML, /확인 필요<\/span><strong>11대/);
  assert.match(ui.elements.assetGroups.innerHTML, /교체 알림<\/span><strong>0대/);
});

test('filters and group review buttons select the same assets as the summary, without a query', () => {
  const assets = roster(), { ui } = harness(assets);
  for (const [filter, count] of [['review', 11], ['basis', 7], ['range', 4], ['behind', 1], ['running', 17], ['stopped', 5], ['intermittent', 5]]) {
    ui.state.overviewFilter = filter; ui.renderAssets();
    assert.equal((ui.elements.assetGroups.innerHTML.match(/class="all-overview-card is-assessed"/g) || []).length, count, filter);
    assert.equal(ui.elements.visibleAssetCount.hidden, false);
  }
  ui.state.overviewFilter = 'review'; ui.state.overviewFilterType = 'fbhe'; ui.renderAssets();
  assert.equal((ui.elements.assetGroups.innerHTML.match(/class="all-overview-card is-assessed"/g) || []).length, 3);
  assert.doesNotMatch(ui.elements.assetGroups.innerHTML, /data-overview-type="limestone"/);
});

test('the original status toolbar returns when leaving the overview for a single family', () => {
  const { ui } = harness(roster()), toolbar = { hidden: false };
  ui.elements.statusFilters.closest = () => toolbar;
  ui.renderStatusFilters(); assert.equal(toolbar.hidden, true);
  ui.state.activeType = 'fbhe'; ui.renderStatusFilters();
  assert.equal(toolbar.hidden, false);
  assert.match(ui.elements.statusFilters.innerHTML, /data-status-filter="runtime_unknown"/);
});

test('legacy conservative flags cannot hide linked whole-cycle evidence or mislabel source uncertainty as missing RUN', () => {
  const a = measured('104ETG30AN601', 'flyash_bag', 1002.1);
  a.dataParcRuntimeBasis.coverageComplete = false;
  a.runtimeCoverageEvidence.wholeCycleVerified = true;
  a.runtimeCoverageEvidence.cycleBasisConfirmed = true;
  const { ui } = harness([a]);
  assert.equal(ui.allOverviewRuntimeAssessment(a).scope, 'whole');
  assert.equal(ui.allOverviewRuntimeAssessment(a).requiresReview, false);
  a.runtimeCoverageEvidence.wholeCycleVerified = false;
  a.runtimeCoverageEvidence.cycleBasisConfirmed = false;
  assert.equal(ui.allOverviewRuntimeAssessment(a).reasonKey, 'replacement-basis-review');
  assert.equal(ui.allOverviewRuntimeAssessment(a).reviewGroup, 'basis');
});

test('history uses the same scope and counter as the card while retaining conflicting legacy detail access', () => {
  const a = measured('104ETG30AN601', 'flyash_bag', 1002.1);
  a.dataParcRuntimeBasis.coverageComplete = false;
  a.runtimeCoverageEvidence.wholeCycleVerified = true; a.runtimeCoverageEvidence.cycleBasisConfirmed = true;
  const { ui } = harness([a]), before = structuredClone(a);
  const card = ui.renderAllOverviewCard(a);
  ui.openAssetHistory(a.tagNumber);
  const history = ui.elements.historyCycleSummary.innerHTML;
  assert.match(card, /확정 기준 누적/); assert.match(history, /data-runtime-assessment="whole"/);
  assert.match(history, /누적 범위<\/span><strong>확정 기준 누적/);
  assert.match(history, /누적 운전시간<\/span><strong>1,002\.1시간/);
  assert.match(history, /<details class="runtime-source-details"><summary>기존 저장 구간 정보/);
  assert.match(history, /일부 기간 RUN 누적/, 'legacy source information remains available inside details');
  assert.deepEqual(a, before);
});

test('stale receipt metadata cannot promote the current number to verified whole-cycle hours', () => {
  for (const change of [a => { a.runtimeCoverageEvidence.requestId = 'old-owner'; },
    a => { a.runtimeCoverageEvidence.hours += 1; }, a => { a.runtimeCoverageEvidence.observedAt = START; }]) {
    const a = measured('204HHL60AP611'); a.dataParcRuntimeBasis.coverageComplete = false;
    a.runtimeCoverageEvidence.wholeCycleVerified = true; change(a);
    const { ui } = harness([a]), result = ui.allOverviewRuntimeAssessment(a);
    assert.equal(result.wholeCycleVerified, false);
    assert.equal(result.requiresReview, true);
    assert.match(ui.renderAllOverviewCard(a), /163\.4시간/);
  }
});

test('explicit canonical ownership rejection cannot fall back to legacy dates or a conflicting manual projection', () => {
  for (const legacySource of ['dataparc', 'manual']) {
    const a = measured('104SDF01AN001', 'organic_fuel', 1);
    a.runtimeCoverageEvidence = { version: 1, source: 'unverified', measurementVerified: false,
      hours: null, requestId: '', observedAt: '', startAt: '', coverageComplete: null, wholeCycleVerified: false };
    if (legacySource === 'manual') a.runRuntime = { verified: true, source: 'manual', state: 'running', measuredAt: END };
    const { ui } = harness([a]), before = structuredClone(a), result = ui.allOverviewRuntimeAssessment(a);
    assert.equal(ui.overviewManualTimestamp(a), '');
    assert.equal(result.scope, 'retained');
    assert.equal(result.provenance, 'retained');
    assert.equal(result.reasonKey, 'measurement-unverified');
    assert.equal(result.requiresReview, true);
    assert.match(ui.renderAllOverviewCard(a), /기존 저장값/);
    assert.match(ui.renderAllOverviewCard(a), /1\.0시간/);
    assert.deepEqual(a, before);
  }
});

test('generic measured and manual assets work without an FBHE runRuntime projection', () => {
  const a = measured('104ETG30AN601', 'flyash_bag', 1002.1);
  a.runtimeCoverageEvidence.cycleBasisConfirmed = true; a.runtimeCoverageEvidence.wholeCycleVerified = true;
  const { ui } = harness([a]);
  assert.equal(a.runRuntime, undefined);
  assert.equal(ui.allOverviewRuntimeAssessment(a).wholeCycleVerified, true);
  const manualTime = '2026-11-06T00:30:00.000Z';
  a.cycleElapsedHours = 123.5; a.runtimeHours = 123.5; a.runtimeMeasuredAt = manualTime;
  a.runtimeCoverageEvidence = { version: 1, source: 'manual', measurementVerified: true, hours: 123.5,
    requestId: '', observedAt: manualTime, startAt: '', coverageComplete: null, wholeCycleVerified: false };
  const result = ui.allOverviewRuntimeAssessment(a);
  assert.equal(result.scope, 'manual'); assert.equal(result.coverage.observedAt, null);
  assert.equal(result.freshness.state, 'unknown'); assert.equal(result.requiresReview, false);
  assert.equal(ui.allOverviewQueryStats().queriedCount, 0, 'an old DataPARC receipt cannot set the manual asset freshness');
  assert.match(ui.renderAllOverviewCard(a), /직접 입력 누적/);
  assert.match(ui.renderAllOverviewCard(a), /2026-11-06 09:30/);
  ui.openAssetHistory(a.tagNumber);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /data-runtime-assessment="manual"/);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /누적 범위<\/span><strong>직접 입력 누적/);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /누적 운전시간<\/span><strong>123\.5시간/);
});

test('a measured zero remains zero; an unqueried new cycle does not acquire a zero-hour measurement', () => {
  const zero = measured('204HHL60AP611', 'fbhe', 0), pending = measured('104HHL60AP621', 'fbhe', 0);
  pending.replacementAutoCycle = { schemaVersion: 3, clockKnown: true, requiresRunRefresh: true };
  pending.runRuntime = { verified: false, source: 'replacement_auto', state: 'unknown' };
  const { ui } = harness([zero, pending]);
  assert.equal(ui.allOverviewRuntimeAssessment(zero).hours, 0);
  assert.match(ui.renderAllOverviewCard(zero), /0\.0시간/);
  assert.equal(ui.allOverviewRuntimeAssessment(pending).hours, null);
  assert.doesNotMatch(ui.renderAllOverviewCard(pending), /0\.0시간/);
  assert.match(ui.renderAllOverviewCard(pending), /조회 대기/);
});

function disputedCheckpoint(tagNumber = '103HRJ01AN602') {
  return {
    enabled: true, tagNumber, blowerType: 'limestone', unitNo: tagNumber.startsWith('203') ? '2' : '1',
    positionLabel: '#B', displayName: `Limestone ${tagNumber}`, sortOrder: 1,
    lastReplacementAt: '2026-09-22T00:00:00+09:00', cycleStartState: 'legacy',
    cycleStartRevision: 'checkpoint-start', cycleRuntimeRevision: 'checkpoint-runtime',
    cycleElapsedHours: 922.1, runtimeHours: 922.1, cycleRuntimeState: 'running',
    runtimeAccumulationMode: 'measured_only', isRunning: true, operationState: 'running', severity: 'normal',
    dataParcTag: `GSPOGE.ABB_DCS.${tagNumber}XB04`,
    dataParcRuntimeBasis: { startAt: '2026-09-22T00:00:00+09:00', observedAt: '2026-10-30T10:31:00+09:00' }
  };
}

function independentRunLedger(asset) {
  return {
    tagNumber: asset.tagNumber, dataParcTag: asset.dataParcTag, lastReplacementAt: asset.lastReplacementAt,
    cycleStartRevision: asset.cycleStartRevision, totalRunningSeconds: 24 * 3600 + 360, segmentCount: 2,
    endState: 'stopped', coverageStartAt: '2026-10-30T16:23:00+09:00', observedAt: '2026-10-31T16:30:00+09:00'
  };
}

test('assessed disputed Limestone keeps its provisional checkpoint and the independent RUN observation time', () => {
  for (const tag of ['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602']) {
    const a = disputedCheckpoint(tag), before = structuredClone(a), { ui } = harness([a], { write: true });
    ui.state.data.limestoneRunTracking = [independentRunLedger(a)];
    const assessment = ui.allOverviewRuntimeAssessment(a), card = ui.renderAllOverviewCard(a);
    assert.equal(assessment.scope, 'retained', tag);
    assert.equal(assessment.reasonKey, 'replacement-basis-review');
    assert.equal(assessment.requiresReview, true);
    assert.equal(assessment.nextActionKey, 'limestone_basis_confirm');
    assert.equal(assessment.hours, 922.1);
    assert.equal(assessment.operation.state, 'stopped');
    assert.match(card, /기존 저장값/);
    assert.match(card, /교체 기준 확인/);
    assert.match(card, /922\.1시간/);
    assert.match(card, /반영 시각<\/small><strong>2026-10-30 10:31/);
    assert.match(card, /data-limestone-run-asof="true"/);
    assert.match(card, /최근 RUN 확인 2026-10-31 16:30 · 누적 미반영/);
    assert.doesNotMatch(card, /24\.1시간|946\.2시간/);
    ui.renderAssets();
    assert.match(ui.elements.assetGroups.innerHTML, /확인 필요<\/span><strong>1대/);
    ui.openAssetHistory(a.tagNumber);
    assert.match(ui.elements.historyCycleSummary.innerHTML, /data-runtime-assessment="retained"/);
    assert.match(ui.elements.historyCycleSummary.innerHTML, /최근 RUN 상태 정지중 · 2026-10-31 16:30 · 누적 미반영/);
    assert.deepEqual(a, before);
  }
});

test('advancing an independent RUN ledger changes only its observed state and time, never checkpoint hours or freshness', () => {
  const a = disputedCheckpoint(), { ui } = harness([a]);
  ui.state.data.limestoneRunTracking = [independentRunLedger(a)];
  const before = ui.allOverviewRuntimeAssessment(a);
  ui.state.data.limestoneRunTracking[0] = { ...independentRunLedger(a), totalRunningSeconds: 30 * 3600,
    observedAt: '2026-10-31T22:23:00+09:00', endState: 'running' };
  const after = ui.allOverviewRuntimeAssessment(a), card = ui.renderAllOverviewCard(a);
  assert.equal(after.hours, before.hours);
  assert.deepEqual(after.coverage, before.coverage);
  assert.deepEqual(after.freshness, before.freshness);
  assert.equal(after.requiresReview, true);
  assert.equal(after.operation.state, 'running');
  assert.match(card, /기동중/);
  assert.match(card, /최근 RUN 확인 2026-10-31 22:23 · 누적 미반영/);
  assert.match(card, /반영 시각<\/small><strong>2026-10-30 10:31/);
  assert.doesNotMatch(card, /2026-10-31 16:30|30\.0시간|952\.1시간/);
});

test('a session-only Limestone preview remains visible without becoming a saved value or operating state', () => {
  const a = disputedCheckpoint(), { ui } = harness([a]), before = ui.allOverviewRuntimeAssessment(a);
  ui.state.limestoneRunPreviews[a.tagNumber] = { previewOnly: true, previewState: 'stopped',
    previewObservedAt: '2026-10-31T16:30:00+09:00', previewHours: 24.1 };
  const card = ui.renderAllOverviewCard(a);
  assert.match(card, /data-limestone-run-preview="true"/);
  assert.match(card, /최근 RUN 확인 정지중 · 2026-10-31 16:30 · 누적 미반영/);
  assert.match(card, /class="operation-pill running">기동중/);
  assert.match(card, /922\.1시간/);
  assert.doesNotMatch(card, /24\.1시간|946\.2시간/);
  assert.deepEqual(ui.allOverviewRuntimeAssessment(a), before);
  a.limestoneBasisConfirmed = true;
  assert.doesNotMatch(ui.renderAllOverviewCard(a), /data-limestone-run-preview|2026-10-31 16:30/);
});

test('a current manual Limestone correction owns the displayed value and state while its unresolved belt basis stays visible', () => {
  for (const hours of [123.5, 922.1]) {
    const a = disputedCheckpoint(), manualAt = '2026-11-06T00:30:00.000Z';
    Object.assign(a, { cycleElapsedHours: hours, runtimeHours: hours, cycleRuntimeState: 'running',
      runtimeMeasuredAt: manualAt, cycleRuntimeAnchorAt: manualAt,
      runtimeCoverageEvidence: { version: 1, source: 'manual', measurementVerified: true, hours,
        observedAt: manualAt, coverageComplete: null, wholeCycleVerified: false } });
    const before = structuredClone(a), { ui } = harness([a]);
    ui.state.data.limestoneRunTracking = [independentRunLedger(a)];
    const assessment = ui.allOverviewRuntimeAssessment(a), card = ui.renderAllOverviewCard(a);
    assert.equal(assessment.scope, 'manual');
    assert.equal(assessment.hours, hours);
    assert.equal(assessment.reasonKey, 'replacement-basis-review');
    assert.equal(assessment.operation.state, 'running', 'an older RUN ledger cannot replace the selected manual state');
    assert.equal(assessment.operation.observedAt, manualAt);
    assert.equal(assessment.coverage.observedAt, null);
    assert.equal(ui.allOverviewQueryStats().queriedCount, 0);
    assert.match(card, /직접 입력 누적/);
    assert.ok(card.includes(`${hours.toFixed(1)}시간`));
    assert.match(card, /기동중/);
    assert.match(card, /보정 시각<\/small><strong>2026-11-06 09:30/);
    assert.doesNotMatch(card, /정지중|최근 RUN 확인 2026-10-31/);
    ui.openAssetHistory(a.tagNumber);
    assert.match(ui.elements.historyCycleSummary.innerHTML, /data-runtime-assessment="manual"/);
    assert.match(ui.elements.historyCycleSummary.innerHTML, /기록 상태 기동중 · 2026-11-06 09:30/);
    assert.deepEqual(a, before);
  }
});

function recoverableGap() {
  const a = measured('104ETG30AN602', 'flyash_bag', 456.7);
  const clock = '2026-08-26T22:40:00.000Z';
  a.lastReplacementAt = clock; a.actualLastReplacementAt = clock;
  a.hasUnverifiedDataParcHistory = false;
  a.cycleSourceReview = { code: 'CONFIRMED_REPLACEMENT_RUN_GAP', cycleBasisConfirmed: true, measuredRangeMayContinue: true };
  a.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, timePrecision: 'minute', clockKnown: true,
    registeredBaseline: true, completionClockConflict: false, requiresRunRefresh: false, confirmedReplacementAt: clock,
    confirmedClockEventId: 'fixture-clock', confirmedClockSourceSnapshotSha256: 'b'.repeat(64) };
  Object.assign(a.dataParcRuntimeBasis, { coverageComplete: false, requiredStartAt: clock, cycleBasisConfirmed: true,
    confirmedGapRecoveryEligible: true });
  Object.assign(a.runtimeCoverageEvidence, { coverageComplete: false, requiredStartAt: clock,
    missingLeadingSeconds: 3600, cycleBasisConfirmed: true });
  return a;
}

test('review action opens the proven recovery workflow, while public/mobile/busy views only open history', () => {
  const a = recoverableGap(), f = harness([a], { write: true });
  assert.ok(f.ui.confirmedGapRecoveryProof(a));
  assert.equal(f.ui.allOverviewRuntimeAssessment(a).nextActionKey, 'confirmed_gap_recovery');
  f.stubWorkflows(); f.ui.openOverviewAssessmentAction(a.tagNumber);
  assert.equal(f.calls[0][0], 'runtime'); assert.equal(f.calls[0][2].confirmedGap, true);
  f.ui.state.data.permissions.canWrite = false; f.ui.openOverviewAssessmentAction(a.tagNumber);
  assert.equal(f.calls.at(-1)[0], 'history');
  f.ui.state.data.permissions.canWrite = true; f.setMobile(true); f.ui.openOverviewAssessmentAction(a.tagNumber);
  assert.equal(f.calls.at(-1)[0], 'history');
  f.setMobile(false); f.ui.state.unifiedRefreshBusy = true; f.ui.openOverviewAssessmentAction(a.tagNumber);
  assert.equal(f.calls.at(-1)[0], 'history');
});

test('opening the Seal Pot first-run action preserves the explicit history query step', () => {
  const origin = '2026-05-10T15:00:00.000Z';
  const a = measured('204HHL10AN611', 'seal_pot', 4118.7);
  a.lastReplacementAt = origin; a.dataParcRuntimeBasis.requiredStartAt = origin; a.dataParcRuntimeBasis.coverageComplete = false;
  a.runtimeCoverageEvidence.requiredStartAt = origin; a.runtimeCoverageEvidence.coverageComplete = false;
  a.runtimeCoverageEvidence.missingLeadingSeconds = 3600;
  const f = harness([a], { write: true });
  assert.equal(f.ui.allOverviewRuntimeAssessment(a).nextActionKey, 'seal_pot_first_run');
  f.stubWorkflows(); f.ui.openOverviewAssessmentAction(a.tagNumber);
  assert.deepEqual(f.calls, [['history', a.tagNumber]], 'opening the card cannot create or auto-confirm a RUN request');
});

// These fixtures are deliberately synthetic; the live 27 receipts are not
// fetched or altered by this test. Exporting supports local layout inspection.
export { harness, roster };
