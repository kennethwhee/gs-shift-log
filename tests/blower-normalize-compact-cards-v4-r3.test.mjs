import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const END = '2026-11-03T19:24:00.000Z';
const REPLACEMENT = '2026-09-25T05:40:00.000Z';
const SOURCE_DETAIL = '승인 원문 근거는 이력에서 확인합니다. 기존 검증된 조회구간의 숫자는 실제 교체 전체 누적과 다릅니다.';
function node() {
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, title: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {}, addEventListener() {},
    showModal() { this.open = true; }, close() { this.open = false; } };
}
function harness(assets) {
  const nodes = new Map(), context = vm.createContext({ console, clearTimeout() {}, HTMLButtonElement: class {}, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia: () => ({ matches: false }), setTimeout(fn) { fn(); }, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui={state,elements,cacheElements,commonRunCoverage,commonRunCoverageNotice,
    compactRunCoverageStatus,renderAssetCard,renderAllOverviewCard,openAssetHistory,renderStatusFilters,renderUnifiedRefreshProgress,displaySeverity};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets, events: [], permissions: { canWrite: true }, user: { name: 'Fixture' },
    backfill: { hasRun: true, status: 'complete' }, missingSlots: [], missingTags: [], settings: {}, types: [] };
  return ui;
}
function measured(overrides = {}) {
  const tagNumber = '104ETG30AN602', dataParcTag = 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_104ETG30AN602';
  return { tagNumber, blowerType: 'flyash_bag', unitNo: '1', positionLabel: '#B', displayName: 'Fixture Bag #B',
    enabled: true, lastReplacementAt: REPLACEMENT, actualLastReplacementAt: '', cycleBasisKind: 'replacement_source_review',
    cycleStartState: 'legacy', cycleStoredStartedAt: '', cycleStartRevision: 'fixture-start', cycleRuntimeRevision: 'fixture-runtime',
    runtimeHours: 404.3, cycleElapsedHours: 404.3, cycleRuntimeTracked: true, cycleRuntimeState: 'running', operationState: 'running',
    isRunning: true, runtimeAccumulationMode: 'measured_only', severity: 'runtime_unknown', measurementRequired: false, dataParcTag,
    cycleSourceReview: { code: 'VERIFIED_RUNTIME_RANGE', cycleBasisConfirmed: false, measuredRangeMayContinue: true, message: SOURCE_DETAIL },
    dataParcRuntimeBasis: { requestId: 'fixture-existing-receipt', dataParcTag,
      startAt: '2026-10-17T23:04:00.000Z', observedAt: END, requiredStartAt: REPLACEMENT,
      runtimeHours: 404.3, runningSeconds: 1455480, appendReady: true, coverageComplete: false },
    runRuntime: { verified: true, source: 'dataparc', state: 'running', measuredAt: END }, ...overrides };
}
function knownClockGap() {
  const a = measured({ actualLastReplacementAt: REPLACEMENT, cycleBasisKind: 'replacement',
    replacementAutoCycle: { schemaVersion: 3, normalizationVersion: 4, clockKnown: true,
      confirmedReplacementAt: REPLACEMENT, completionClockReconciled: true, requiresRunRefresh: false,
      registeredRuntimeRange: false, registeredBaseline: true, timePrecision: 'minute' },
    cycleSourceReview: { code: 'CONFIRMED_REPLACEMENT_RUN_GAP', cycleBasisConfirmed: true, measuredRangeMayContinue: true,
      message: '교체 완료시각은 확인됐지만 앞 RUN 조회구간이 빠져 있습니다. 기존 검증값을 보존합니다.' } });
  a.dataParcRuntimeBasis.cycleBasisConfirmed = true;
  return a;
}
function visible(markup) {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function oneAmount(markup, expected) {
  const text = visible(markup);
  assert.equal((text.match(/(?:\d[\d,.]*)시간/g) || []).length, 1, 'overview has a single primary hour value');
  assert.ok(text.includes(expected), text);
}

test('overview keeps one measured value, its queried period and observed state with one concise basis badge', () => {
  const a = measured(), before = structuredClone(a), ui = harness([a]);
  const card = ui.renderAllOverviewCard(a), text = visible(card);
  oneAmount(card, '404.3시간');
  assert.match(card, /data-operation-state="running"/);
  assert.match(text, /기동중/);
  assert.match(card, /data-run-basis-status="replacement-basis-review"/);
  assert.match(text, /교체 기준 확인/);
  assert.match(text, /2026-10-18 08:04 → 2026-11-04 04:24/);
  assert.doesNotMatch(card, new RegExp(SOURCE_DETAIL));
  assert.doesNotMatch(text, /조회구간 RUN 누적 · 교체 기준 확인 필요/);
  ui.openAssetHistory(a.tagNumber);
  assert.ok(ui.elements.historyCycleSummary.innerHTML.includes(SOURCE_DETAIL), 'the full source explanation stays available in history');
  assert.match(ui.elements.historyCycleSummary.innerHTML, /조회구간 RUN 누적 · 교체 기준 확인 필요/);
  assert.deepEqual(a, before);
});

test('a certified completion clock with a missing prefix shows a gap, keeps 404.3 hours and displays 14:40 as replacement time', () => {
  const a = knownClockGap(), before = structuredClone(a), ui = harness([a]);
  const card = ui.renderAllOverviewCard(a), text = visible(card);
  oneAmount(card, '404.3시간');
  assert.match(card, /data-run-basis-status="leading-gap"/);
  assert.match(text, /누적 구간 확인/);
  assert.match(text, /최근 V-Belt 교체 2026-09-25 14:40/);
  assert.match(text, /2026-10-18 08:04 → 2026-11-04 04:24/);
  assert.doesNotMatch(text, /교체 기준 확인|완료 시각 미기록|실제 교체 기준 미확정/);
  ui.openAssetHistory(a.tagNumber);
  const detail = visible(ui.elements.historyCycleSummary.innerHTML);
  assert.match(detail, /교체 완료 2026-09-25 14:40/);
  assert.match(detail, /미조회 앞 구간 2026-09-25 14:40 → 2026-10-18 08:04/);
  assert.match(detail, /앞쪽 미조회 구간을 추정하거나 현재 조회값에 더하지 않으며/);
  assert.doesNotMatch(detail, /교체 기준 확인 전|완료 시각 미기록|교체 기준 미확정|등록기준 · 교체 기준 확인/);
  assert.equal(ui.displaySeverity(a), 'runtime_unknown', 'known clock does not certify the missing RUN prefix');
  assert.deepEqual(a, before);
});

test('a gap label without the complete authoritative clock proof cannot promote replacement certainty', () => {
  for (const weaken of [
    a => { a.cycleSourceReview.cycleBasisConfirmed = false; },
    a => { a.replacementAutoCycle.clockKnown = false; },
    a => { a.replacementAutoCycle.confirmedReplacementAt = ''; }
  ]) {
    const a = knownClockGap(); weaken(a);
    const ui = harness([a]), coverage = ui.commonRunCoverage(a), card = ui.renderAllOverviewCard(a);
    assert.equal(coverage.replacementClockConfirmed, false);
    assert.doesNotMatch(card, /data-run-basis-status="leading-gap"/);
    assert.equal(ui.displaySeverity(a), 'runtime_unknown');
    oneAmount(card, '404.3시간');
  }
});

test('complete certified coverage has no uncertainty badge and keeps its explicit replacement clock', () => {
  const a = knownClockGap(); delete a.cycleSourceReview;
  a.severity = 'unset'; a.dataParcRuntimeBasis.coverageComplete = true;
  a.dataParcRuntimeBasis.startAt = REPLACEMENT;
  const before = structuredClone(a), ui = harness([a]), card = ui.renderAllOverviewCard(a);
  oneAmount(card, '404.3시간');
  assert.equal(ui.commonRunCoverage(a), null);
  assert.equal(ui.displaySeverity(a), 'unset');
  assert.doesNotMatch(card, /data-run-basis-status|data-run-coverage="partial"/);
  assert.match(visible(card), /최근 V-Belt 교체 2026-09-25 14:40/);
  assert.deepEqual(a, before);
});

test('day-only replacement ranges retain an explicit missing completion-time badge and their conservative queried start', () => {
  const a = measured({ tagNumber: '204HHL60AP621', blowerType: 'fbhe', unitNo: '2',
    lastReplacementAt: '2026-10-29T15:00:00.000Z', cycleBasisKind: 'replacement_source_review',
    cycleStartState: 'pending', cycleStoredStartedAt: '',
    replacementAutoCycle: { schemaVersion: 3, normalizationVersion: 4, timePrecision: 'day', clockKnown: false,
      registeredRuntimeRange: false, requiresRunRefresh: false, rangeTrackingAllowed: true, rangeQueryEligible: false,
      rangeStartAt: '2026-10-30T15:00:00.000Z' } });
  a.dataParcRuntimeBasis.startAt = a.replacementAutoCycle.rangeStartAt;
  a.dataParcRuntimeBasis.requiredStartAt = a.lastReplacementAt;
  const before = structuredClone(a), ui = harness([a]), card = ui.renderAllOverviewCard(a);
  oneAmount(card, '404.3시간');
  assert.match(card, /data-run-basis-status="completion-time-missing"/);
  assert.match(visible(card), /확인 구간 RUN 누적/);
  assert.match(visible(card), /완료 시각 미기록/);
  assert.match(visible(card), /2026-10-31 00:00 → 2026-11-04 04:24/);
  assert.deepEqual(a, before);
});

test('unknown hour values never become a fabricated zero while a measured numeric zero stays visible', () => {
  for (const invalid of [null, undefined, '', ' ', true, false]) {
    const a = measured(); a.cycleElapsedHours = a.runtimeHours = a.dataParcRuntimeBasis.runtimeHours = invalid;
    const ui = harness([a]), text = visible(ui.renderAllOverviewCard(a));
    assert.match(text, /확인 필요/); assert.doesNotMatch(text, /0\.0시간/);
  }
  const zero = measured(); zero.cycleElapsedHours = zero.runtimeHours = zero.dataParcRuntimeBasis.runtimeHours = 0;
  zero.dataParcRuntimeBasis.runningSeconds = 0;
  oneAmount(harness([zero]).renderAllOverviewCard(zero), '0.0시간');
});

test('a newer manual correction stays primary and is identified by its own measurement time rather than an older receipt period', () => {
  const a = measured(); a.runtimeHours = a.cycleElapsedHours = 9;
  a.runRuntime = { verified: true, source: 'manual', state: 'stopped', measuredAt: '2026-11-03T18:30:00.000Z' };
  const before = structuredClone(a), ui = harness([a]), card = ui.renderAllOverviewCard(a), text = visible(card);
  oneAmount(card, '9.0시간'); assert.match(text, /수동 보정 누적/);
  assert.match(text, /수동 보정 기준시각 2026-11-04 03:30/);
  assert.doesNotMatch(text, /404\.3시간|2026-10-18 08:04 →/);
  assert.match(card, /data-operation-state="stopped"/);
  assert.match(card, /data-run-basis-status="replacement-basis-review"/);
  assert.deepEqual(a, before);
});

test('filter labels distinguish basis or range review from an unset replacement interval without changing classification keys', () => {
  const partial = measured(), unset = measured({ tagNumber: '104ETG30AN601', severity: 'unset' });
  delete unset.cycleSourceReview; unset.dataParcRuntimeBasis.coverageComplete = true;
  const ui = harness([partial, unset]); ui.renderStatusFilters();
  assert.match(ui.elements.statusFilters.innerHTML, /data-status-filter="runtime_unknown"[\s\S]*?<span>기준·구간 확인<\/span>\s*<strong>1<\/strong>/);
  assert.match(ui.elements.statusFilters.innerHTML, /data-status-filter="unset"[\s\S]*?<span>교체주기 미설정<\/span>\s*<strong>1<\/strong>/);
});

test('result summary labels only preexisting partial appends and does not present fresh conservative seeds as skipped queries', () => {
  const ui = harness([]), outcomes = [
    ...Array.from({ length: 9 }, (_, i) => ({ tagNumber: `partial-${i}`, status: 'complete', partialRange: true, message: 'Fixture saved-range append' })),
    ...Array.from({ length: 2 }, (_, i) => ({ tagNumber: `seed-${i}`, status: 'complete', message: 'Fixture fresh conservative range' })) ];
  const before = structuredClone(outcomes); ui.renderUnifiedRefreshProgress('Fixture', outcomes);
  assert.match(ui.elements.unifiedRefreshSummary.textContent, /반영 11대/);
  assert.match(ui.elements.unifiedRefreshSummary.textContent, /기준·구간 확인 9대/);
  assert.match(ui.elements.unifiedRefreshSummary.textContent, /조회 보류 0대/);
  assert.doesNotMatch(ui.elements.unifiedRefreshSummary.textContent, /기준 확인 대상 이어조회/);
  assert.deepEqual(outcomes, before);
});

function collapsedCardText(markup) {
  return visible(markup.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, content =>
    content.match(/<summary\b[^>]*>[\s\S]*?<\/summary>/)?.[0] || ''));
}

test('type-specific cards show one short coverage notice and keep full explanations in collapsed evidence and history', () => {
  for (const a of [measured(), knownClockGap()]) {
    const before = structuredClone(a), ui = harness([a]), card = ui.renderAssetCard(a, { cycleDays: 90 });
    const text = collapsedCardText(card);
    assert.equal((card.match(/data-run-basis-status=/g) || []).length, 1);
    assert.match(card, /<details class="asset-evidence[^>]*>[\s\S]*?data-run-coverage="partial"/);
    assert.doesNotMatch(card, /<details[^>]+\bopen\b/);
    assert.match(text, /404\.3시간/);
    assert.equal((text.match(/404\.3시간/g) || []).length, 1);
    assert.doesNotMatch(text, /앞쪽 미조회 구간을 추정|전체 벨트 누적|검증된 조회구간|승인 원문 근거/);
    assert.doesNotMatch(text, /조회구간 RUN 누적 ·|일부 기간 RUN 누적 ·/);
    assert.match(card, /data-asset-action="history"/);
    assert.doesNotMatch(card, /role="progressbar"|class="cycle-deadline-metric|class="cycle-usage-metric/);
    ui.openAssetHistory(a.tagNumber);
    assert.match(ui.elements.historyCycleSummary.innerHTML, /전체 벨트 누적|전체 Cycle 누적/);
    assert.deepEqual(a, before);
  }
});

test('conflicting completion clocks remain visibly unresolved on both card types and cannot display the disputed confirmed clock', () => {
  const a = knownClockGap();
  a.lastReplacementAt = '2026-09-25T05:20:00.000Z';
  a.replacementAutoCycle.completionClockConflict = true;
  const before = structuredClone(a), ui = harness([a]);
  assert.equal(ui.commonRunCoverage(a).replacementClockConfirmed, false);
  for (const card of [ui.renderAllOverviewCard(a), ui.renderAssetCard(a, { cycleDays: 90 })]) {
    assert.match(card, /data-run-basis-status="completion-time-conflict"/);
    assert.match(collapsedCardText(card), /교체 시각 불일치/);
    assert.doesNotMatch(collapsedCardText(card), /최근 V-Belt 교체 2026-09-25 14:40/);
    assert.doesNotMatch(card, /role="progressbar"|class="cycle-deadline-metric/);
  }
  assert.equal(ui.displaySeverity(a), 'runtime_unknown');
  assert.deepEqual(a, before);
});

test('type-specific manual corrections identify their own value and measurement time while keeping incomplete-basis status', () => {
  const a = measured(); a.runtimeHours = a.cycleElapsedHours = 9;
  a.runRuntime = { verified: true, source: 'manual', state: 'stopped', measuredAt: '2026-11-03T18:30:00.000Z' };
  const before = structuredClone(a), ui = harness([a]), card = ui.renderAssetCard(a, { cycleDays: 90 });
  const text = collapsedCardText(card);
  assert.match(text, /수동 보정 누적 9\.0시간/);
  assert.match(text, /수동 보정 기준시각 2026-11-04 03:30/);
  assert.doesNotMatch(text, /404\.3시간|2026-10-18 08:04 →/);
  assert.match(card, /data-run-basis-status="replacement-basis-review"/);
  assert.deepEqual(a, before);
});

test('a pending automatic replacement uses concise pending text without dropping its full explanation from history', () => {
  const a = measured({ cycleStartState: 'pending', cycleRuntimeState: 'unknown', runRuntime: null,
    replacementAutoCycle: { schemaVersion: 3, normalizationVersion: 4, timePrecision: 'minute', clockKnown: true,
      requiresRunRefresh: true, requiredStartAt: REPLACEMENT } });
  delete a.cycleSourceReview;
  const before = structuredClone(a), ui = harness([a]), card = ui.renderAssetCard(a, { cycleDays: 90 });
  const text = collapsedCardText(card);
  assert.match(text, /RUN 조회 대기/);
  assert.doesNotMatch(text, /교체 자동반영 · 새 교체 기준 RUN 조회 대기/);
  ui.openAssetHistory(a.tagNumber);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /교체 자동반영 · 새 교체 기준 RUN 조회 대기/);
  assert.deepEqual(a, before);
});
