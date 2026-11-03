import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const WARNING = '일부 기간 RUN 누적 · 교체 기준 확인 필요';
const REPLACEMENT = '2026-10-01T00:00:00+09:00';
const START = '2026-10-03T01:02:03.000Z';
const PARTIAL_START = '2026-10-20T00:00:00.000Z';
const OBSERVED = '2026-11-02T15:00:00.000Z';
const NOW = new Date('2026-11-03T03:00:00.000Z');

// Synthetic data: all six blower types plus the organic/manure subtype. These
// matching stored counters describe the measured period, not the whole cycle.
const CASES = [
  ['FBHE', '104HHL60AP611', 'fbhe'],
  ['Seal Pot', '104HHL10AN611', 'seal_pot'],
  ['Organic fuel', '104SDF01AN001', 'organic_fuel'],
  ['Manure', '204LMDF01AN001', 'organic_fuel', 'manure'],
  ['Fly Ash Bag', '104ETG30AN601', 'flyash_bag'],
  ['Fly Ash Silo', '104ETH03AN601', 'flyash_silo'],
  ['Limestone', '103HRJ01AN602', 'limestone']
];

function assetFor([label, tagNumber, blowerType, assetGroup = '']) {
  const dataParcTag = `GSPOGE.ABB_DCS.TEST_ONLY_BINARY_${tagNumber}`;
  return {
    tagNumber, blowerType, assetGroup, displayName: label, positionLabel: '#A', unitNo: '1', enabled: true,
    lastReplacementAt: REPLACEMENT, actualLastReplacementAt: REPLACEMENT, cycleBasisKind: 'replacement',
    cycleStartState: 'started', cycleStoredStartedAt: START, cycleStartedAt: START,
    cycleStartRevision: `fixture-start-${tagNumber}`, cycleRuntimeRevision: `fixture-runtime-${tagNumber}`,
    cycleElapsedHours: 12.5, runtimeHours: 12.5, remainingHours: 2147.5,
    cycleRuntimeTracked: true, cycleRuntimeState: 'running', operationState: 'running', isRunning: true,
    runtimeAccumulationMode: 'measured_only', measurementRequired: false, severity: 'normal',
    hasUnverifiedDataParcHistory: false, dataParcTag,
    ...(blowerType === 'limestone' ? { limestoneAutoApply: true, limestoneBasisConfirmed: true,
      limestoneBasisReviewRequired: false, limestoneRunDisputed: false } : {}),
    runRuntime: { verified: true, source: 'dataparc', state: 'running', measuredAt: OBSERVED },
    dataParcRuntimeBasis: {
      startAt: PARTIAL_START, coverageStartAt: PARTIAL_START, observedAt: OBSERVED,
      requiredStartAt: START, coverageComplete: false, runtimeHours: 12.5,
      runningSeconds: 45000, appendReady: true, dataParcTag
    }
  };
}

function node() {
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, title: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {},
    replaceChildren() {}, focus() {}, addEventListener() {},
    showModal() { this.open = true; }, close() { this.open = false; } };
}

function harness(assets, { mobile = false, canWrite = true } = {}) {
  const nodes = new Map();
  const context = vm.createContext({ console, clearTimeout() {}, HTMLButtonElement: class {}, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia: () => ({ matches: mobile }),
      setTimeout(fn) { fn(); }, addEventListener() {} }
  });
  const marker = '  if (document.readyState === "loading") {';
  const expose = `globalThis.ui={state,elements,cacheElements,commonRunCoverage,
    renderAssetCard,renderAllOverviewCard,renderStatusFilters,renderAllOverviewDashboard,
    openAssetHistory,openDataParcRuntimeDialog};\n`;
  assert.equal(source.split(marker).length, 2, 'instrument the complete production IIFE once');
  vm.runInContext(source.replace(marker, expose + marker), context);
  const ui = context.ui;
  ui.cacheElements();
  ui.state.data = {
    assets, events: assets.map(a => ({ id: `fixture-replacement-${a.tagNumber}`, tagNumber: a.tagNumber,
      eventType: 'replacement', sourceType: 'manual', eventDate: a.lastReplacementAt,
      actionType: 'V-Belt 교체', note: 'Synthetic confirmed replacement',
      createdAt: a.lastReplacementAt, updatedAt: a.lastReplacementAt })),
    permissions: { canWrite }, user: canWrite ? { name: 'Fixture', isSuperAdmin: true } : null,
    backfill: { hasRun: true, status: 'complete' }, missingSlots: [], missingTags: [],
    settings: Object.fromEntries(CASES.map(([, , type]) => [type, { cycleDays: 90, warningDays: 7, criticalDays: 3 }])),
    types: []
  };
  return { ui, context };
}

for (const item of CASES) test(`${item[0]}: detail, all overview and history identify a partial RUN receipt without changing saved values`, () => {
  const asset = assetFor(item), before = structuredClone(asset);
  const { ui } = harness([asset]);
  for (const [place, markup] of [
    ['detail', ui.renderAssetCard(asset, { cycleDays: 90 })],
    ['all overview', ui.renderAllOverviewCard(asset)]
  ]) {
    assert.ok(markup.includes(WARNING), `${place}: common partial-coverage warning`);
    assert.match(markup, /12\.5시간/, `${place}: retain the receipt's measured hours`);
    assert.doesNotMatch(markup, /876\.5/, `${place}: stale cycle total must not masquerade as partial RUN`);
    assert.doesNotMatch(markup, /role="progressbar"|class="cycle-deadline-metric|class="cycle-usage-metric/, `${place}: no whole-cycle due/progress estimate`);
  }
  ui.openAssetHistory(asset.tagNumber);
  assert.ok(ui.elements.historyCycleSummary.innerHTML.includes(WARNING));
  assert.match(ui.elements.historyCycleSummary.innerHTML, /12\.5시간/);
  assert.doesNotMatch(ui.elements.historyCycleSummary.innerHTML, /876\.5/);
  assert.deepEqual(asset, before, 'rendering preserves both raw stored counters and the immutable receipt');
});

test('a complete measured receipt retains the established display without the partial-coverage warning', () => {
  const assets = CASES.map(assetFor);
  for (const a of assets) {
    a.cycleElapsedHours = a.runtimeHours = 12.5;
    Object.assign(a.dataParcRuntimeBasis, { coverageComplete: true, startAt: START, coverageStartAt: START });
  }
  const { ui } = harness(assets);
  for (const a of assets) {
    const card = ui.renderAssetCard(a, { cycleDays: 90 });
    const overview = ui.renderAllOverviewCard(a);
    assert.ok(!card.includes(WARNING), a.tagNumber);
    assert.ok(!overview.includes(WARNING), a.tagNumber);
    assert.match(overview, /12\.5시간/);
    ui.openAssetHistory(a.tagNumber);
    assert.ok(!ui.elements.historyCycleSummary.innerHTML.includes(WARNING), a.tagNumber);
  }
});

test('a newer manual correction stays visible when an older partial DataPARC receipt remains on a mixed-version response', () => {
  const asset = assetFor(CASES[0]);
  asset.cycleElapsedHours = asset.runtimeHours = 2;
  asset.runRuntime = { verified: true, source: 'manual', state: 'running', measuredAt: '2026-11-02T15:10:00.000Z' };
  Object.assign(asset.dataParcRuntimeBasis, { runtimeHours: 1, runningSeconds: 3600 });
  const { ui } = harness([asset]);
  ui.state.data.events.push(
    { id: 'dataparc_runtime:old-partial', tagNumber: asset.tagNumber, eventType: 'runtime_correction',
      sourceType: 'dataparc_runtime', eventDate: OBSERVED, runtimeHours: 1,
      sourceText: JSON.stringify({ startAt: PARTIAL_START, observedAt: OBSERVED, runningSeconds: 3600 }) },
    { id: 'manual-current', tagNumber: asset.tagNumber, eventType: 'runtime_correction', sourceType: 'manual',
      eventDate: asset.runRuntime.measuredAt, runtimeHours: 2, actionType: '운전중', note: '직접 확인한 누적시간' }
  );
  const before = structuredClone(asset);
  assert.equal(ui.commonRunCoverage(asset), null, 'the old one-hour receipt does not describe the current stored amount');
  const view = core.fbheSealRunView(asset, asset.dataParcRuntimeBasis);
  assert.equal(view.manual, true);
  assert.equal(view.primary, '2.0시간');
  for (const markup of [ui.renderAssetCard(asset, { cycleDays: 90 }), ui.renderAllOverviewCard(asset)]) {
    assert.match(markup, /2\.0시간/);
    assert.ok(!markup.includes(WARNING));
  }
  ui.openAssetHistory(asset.tagNumber);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /2\.0시간/);
  assert.ok(!ui.elements.historyCycleSummary.innerHTML.includes(WARNING));
  assert.match(ui.elements.historyCycleSummary.innerHTML, /수동 보정/);
  assert.deepEqual(asset, before);

  // A state boundary that does not change the number cannot erase a real gap.
  asset.cycleElapsedHours = asset.runtimeHours = 1;
  assert.ok(ui.commonRunCoverage(asset));
  assert.equal(core.fbheSealRunView(asset, asset.dataParcRuntimeBasis).partial, true);
});

test('mobile monitoring displays the same incomplete-period warning and measured amount', () => {
  const asset = assetFor(CASES[3]);
  const { ui } = harness([asset], { mobile: true });
  const card = ui.renderAssetCard(asset, { cycleDays: 90 });
  assert.ok(card.includes(WARNING));
  assert.match(card, /data-mobile-value="12\.5시간"/);
  assert.match(ui.renderAllOverviewCard(asset), /12\.5시간/);
});

test('public and mobile history retain the warning while hiding and rejecting a forced query dialog', () => {
  for (const options of [{ canWrite: false }, { mobile: true }]) {
    const asset = assetFor(CASES[0]), before = structuredClone(asset);
    const { ui } = harness([asset], options);
    ui.openAssetHistory(asset.tagNumber);
    assert.equal(ui.elements.historyDialog.open, true, 'history remains available');
    assert.ok(ui.elements.historyCycleSummary.innerHTML.includes(WARNING));
    assert.equal(ui.elements.historyRuntimeQueryButton.hidden, true);
    assert.equal(ui.elements.historyRuntimeQueryButton.disabled, true);
    ui.openDataParcRuntimeDialog(asset.tagNumber);
    assert.equal(ui.elements.dataparcRuntimeDialog.open, false, 'direct invocation cannot bypass permissions');
    assert.equal(ui.elements.dataparcRuntimeDialogTag.value, '', 'blocked opening cannot prepare a mutation target');
    assert.deepEqual(asset, before);
  }
});

test('the real core RUN view labels partial measurements without certifying a complete cycle for any type', () => {
  for (const item of CASES) {
    const asset = assetFor(item), before = structuredClone(asset);
    const view = core.fbheSealRunView(asset, asset.dataParcRuntimeBasis);
    assert.equal(view.partial, true, item[0]);
    assert.equal(view.verified, false, item[0]);
    assert.equal(view.pending, false, item[0]);
    assert.equal(view.hours, 12.5, item[0]);
    assert.equal(view.primary, '12.5시간', item[0]);
    assert.equal(view.message, WARNING, item[0]);
    assert.equal(view.basis, asset.dataParcRuntimeBasis);
    assert.equal(view.measuredAt, OBSERVED);
    assert.deepEqual(asset, before, 'RUN view preserves the original integer seconds and raw stored total');
  }
});

test('query settings default to the actual cycle start, never a later partial-coverage start', () => {
  // This historical case name is retained. The conservative v2 policy now
  // prefills the owned measured interval rather than suggesting a midnight requery.
  const assets = CASES.map(assetFor), { ui } = harness(assets);
  for (const a of assets) {
    ui.openDataParcRuntimeDialog(a.tagNumber);
    assert.equal(ui.elements.dataparcRuntimeStartAt.value, '2026-10-20T09:00', a.tagNumber);
    assert.equal(ui.elements.dataparcRuntimeStartAt.min, '2026-10-03T10:03', a.tagNumber);
    assert.equal(ui.elements.dataparcRuntimeSourceTag.value, a.dataParcTag, a.tagNumber);
    assert.ok(ui.elements.dataparcRuntimePreviousBasis.textContent.includes('2026-10-20'), 'keep the previous partial interval visible as evidence');
  }
});

test('pending-cycle query settings begin at the confirmed replacement instead of a later partial receipt', () => {
  // Keep the original registered minimum, but do not turn it into an automatic full-query default.
  const asset = assetFor(CASES[0]);
  Object.assign(asset, { cycleStartState: 'pending', cycleStoredStartedAt: '', cycleStartedAt: '' });
  const { ui } = harness([asset]);
  ui.openDataParcRuntimeDialog(asset.tagNumber);
  assert.equal(ui.elements.dataparcRuntimeStartAt.value, '2026-10-20T09:00');
  assert.equal(ui.elements.dataparcRuntimeStartAt.min, '2026-10-01T00:00');
});

test('the integrated planner skips incomplete receipts across every type even when appendReady is true', () => {
  const assets = CASES.map(assetFor), before = structuredClone(assets);
  const planned = core.plan(assets, NOW);
  assert.equal(planned.tasks.length, 0);
  assert.equal(planned.skipped.length, assets.length);
  assert.equal(planned.targetCount, assets.length);
  for (const a of assets) {
    const skipped = planned.skipped.find(s => s.tagNumber === a.tagNumber);
    assert.ok(skipped, a.tagNumber);
    assert.match(skipped.message, /일부 기간|앞 구간|전체.*확인|미조회|완전/);
  }
  assert.deepEqual(assets, before, 'planning cannot reset or rewrite a partial saved counter');
});

test('one partial receipt does not prevent a different complete cycle from appending from its own endpoint', () => {
  const partial = assetFor(CASES[0]), complete = assetFor(CASES[4]);
  complete.cycleElapsedHours = complete.runtimeHours = 12.5;
  Object.assign(complete.dataParcRuntimeBasis, { coverageComplete: true, startAt: START, coverageStartAt: START });
  const planned = core.plan([partial, complete], NOW);
  assert.equal(planned.skipped.length, 1);
  assert.equal(planned.skipped[0].tagNumber, partial.tagNumber);
  assert.equal(planned.tasks.length, 1);
  assert.equal(planned.tasks[0].asset.tagNumber, complete.tagNumber);
  assert.equal(planned.tasks[0].incremental, true);
  assert.equal(planned.tasks[0].startAt, START);
  assert.equal(planned.tasks[0].queryStartAt, OBSERVED);
});

test('automatic Limestone cannot turn a known partial receipt into a replacement-wide rebuild', () => {
  const asset = assetFor(CASES[6]);
  asset.dataParcRuntimeBasis.appendReady = false;
  const planned = core.plan([asset], NOW);
  assert.equal(planned.tasks.length, 0);
  assert.equal(planned.skipped.length, 1);
  assert.equal(asset.dataParcRuntimeBasis.runningSeconds, 45000);
  assert.equal(asset.cycleElapsedHours, 12.5);
});

function taskForCompleteCycle(partialAsset) {
  const complete = structuredClone(partialAsset);
  Object.assign(complete.dataParcRuntimeBasis, {
    coverageComplete: true, startAt: START, coverageStartAt: START
  });
  const task = core.plan([complete], NOW).tasks[0];
  assert.ok(task, 'fixture starts with an otherwise valid accepted-query plan');
  return task;
}

test('execution rejects a partial task before registering any queue or touching an API', async () => {
  const asset = assetFor(CASES[0]), before = structuredClone(asset);
  const task = { ...taskForCompleteCycle(asset), asset };
  const apiCalls = [], checkpoints = [];
  await assert.rejects(core.executeDataParcBatch([task], {
    assertWritable() {},
    async api(request) { apiCalls.push(request); throw new Error('unexpected API'); },
    runtimeCheckpoint(value) { checkpoints.push(value); }
  }), error => error.code === 'BLOWER_CYCLE_COVERAGE_INCOMPLETE');
  assert.equal(apiCalls.length, 0, 'no create, reset, poll, result read or apply');
  assert.equal(checkpoints.length, 0, 'an unaccepted task cannot create a resume receipt');
  assert.deepEqual(asset, before);
});

test('an accepted resume rechecks current partial coverage and retires its local checkpoint without API writes or reads', async () => {
  const asset = assetFor(CASES[0]), before = structuredClone(asset);
  const planned = taskForCompleteCycle(asset);
  const task = { ...planned, asset: { tagNumber: asset.tagNumber, displayName: asset.displayName } };
  const resume = {
    version: 1, tasks: [task], outcomes: [],
    createdBatch: { ok: true, atomic: true, batchVersion: 1, requestedCount: 1,
      results: [{ ok: true, assetTag: asset.tagNumber,
        item: { id: 'accepted', status: 'pending', requestType: 'blower_runtime_probe',
          probe: { assetTag: asset.tagNumber, requestId: 'accepted' } } }] }
  };
  const originalResume = structuredClone(resume), apiCalls = [], checkpoints = [], lookups = [];
  const result = await core.executeDataParcBatch([], {
    runtimeResume: resume, assertWritable() {},
    currentAssetFor(tag) { lookups.push(tag); return tag === asset.tagNumber ? asset : null; },
    async api(request) { apiCalls.push(request); throw new Error('unexpected API'); },
    runtimeCheckpoint(value) { checkpoints.push(value); }
  });
  assert.deepEqual(lookups, [asset.tagNumber]);
  assert.equal(result.length, 1);
  assert.equal(result[0].tagNumber, asset.tagNumber);
  assert.equal(result[0].status, 'skipped');
  assert.match(result[0].message, /일부 기간 RUN 누적.*교체 기준 확인 필요/);
  assert.equal(apiCalls.length, 0, 'accepted request is never requeued, reset, polled, cancelled or applied');
  assert.ok(checkpoints.length > 0);
  assert.equal(checkpoints.at(-1), null, 'no stale local resume remains eligible for later apply');
  assert.deepEqual(resume, originalResume, 'the original server acceptance evidence stays intact');
  assert.deepEqual(asset, before, 'partial runtime and its provenance remain unchanged');
});

test('the seven audited coverage-gap snapshots retain their exact stored values and warn in every view', () => {
  // Historical extracted fields from REPORT SHA256
  // 87d0507336823eca21f5e392bbb3fffaebd0269c19395997c07b489738ae548e.
  // These are saved DB evidence, not an assertion of physical RUN correctness.
  // Signals remain explicit TEST fixtures; no production TAG mapping is inferred.
  const snapshots = [
    ['104ETH03AN602', 'flyash_silo', '2026-05-04T00:00:00+09:00', '2026-05-09T15:00:00.000Z', 6891972, 'legacy', null],
    ['104HHL10AN611', 'seal_pot', '2026-08-03T00:00:00+09:00', '2026-08-03T00:15:00.000Z', 41, 'legacy', null],
    ['104HHL60AP611', 'fbhe', '2026-09-04T00:00:00+09:00', '2026-09-04T01:50:00.000Z', 2199380, 'legacy', null],
    ['104SDF01AN001', 'organic_fuel', '2026-08-20T00:00:00+09:00', '2026-08-20T02:00:00.000Z', 4506199, 'started', '2026-08-19T15:00:00.000Z'],
    ['204HHL10AN611', 'seal_pot', '2026-05-11T00:00:00+09:00', '2026-05-18T09:00:00.000Z', 14536623, 'legacy', null],
    ['204HHL10AN631', 'seal_pot', '2026-05-10T15:00:00.000Z', '2026-05-11T09:00:00.000Z', 15141319, 'legacy', null],
    ['204HHL60AP631', 'fbhe', '2026-09-16T00:00:00+09:00', '2026-09-16T00:30:00.000Z', 2299016, 'pending', null]
  ];
  const assets = snapshots.map(([tag, type, replacement, coverage, seconds, state, started]) => {
    const asset = assetFor([tag, tag, type]);
    Object.assign(asset, { lastReplacementAt: replacement, actualLastReplacementAt: replacement,
      cycleStartState: state, cycleStoredStartedAt: started, cycleStartedAt: started,
      cycleElapsedHours: seconds / 3600, runtimeHours: seconds / 3600 });
    Object.assign(asset.dataParcRuntimeBasis, { startAt: coverage, coverageStartAt: coverage,
      requiredStartAt: started || replacement, observedAt: '2026-11-02T15:00:25Z',
      runningSeconds: seconds, runtimeHours: seconds / 3600 });
    asset.runRuntime.measuredAt = '2026-11-02T15:00:25Z';
    return asset;
  });
  const before = structuredClone(assets), { ui } = harness(assets);
  for (const asset of assets) {
    const storedLabel = `${asset.dataParcRuntimeBasis.runtimeHours.toLocaleString('ko-KR', {
      minimumFractionDigits: 1, maximumFractionDigits: 1
    })}시간`;
    ui.openAssetHistory(asset.tagNumber);
    for (const markup of [ui.renderAssetCard(asset, { cycleDays: 90 }),
      ui.renderAllOverviewCard(asset), ui.elements.historyCycleSummary.innerHTML]) {
      assert.ok(markup.includes(WARNING), asset.tagNumber);
      assert.ok(markup.includes(storedLabel), `${asset.tagNumber}: ${storedLabel}`);
    }
  }
  assert.deepEqual(assets, before, 'all seven exact integer totals, timestamps and cycle states survive rendering');
});

test('status filters and the dashboard count partial coverage once while retaining the independent observed-state counts', () => {
  const assets = CASES.map(assetFor);
  Object.assign(assets[0], { cycleRuntimeState: 'unknown', operationState: 'unknown', isRunning: false });
  assets[0].runRuntime.state = 'unknown';
  const before = structuredClone(assets), { ui } = harness(assets);
  ui.state.data.types = [...new Set(CASES.map(([, , type]) => type))].map(key => ({ key, label: key }));
  ui.renderStatusFilters();
  const chip = ui.elements.statusFilters.innerHTML.match(/<button\b[^>]*data-status-filter="runtime_unknown"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(chip, 'partially measured cycles have a visible status filter');
  assert.match(chip, /<span>운전시간 확인<\/span>\s*<strong>7<\/strong>/);
  const dashboard = ui.renderAllOverviewDashboard(assets, []);
  assert.match(dashboard, /<span>확인 필요<\/span><strong>7대<\/strong>/,
    'one partial cycle whose state is also unknown is not counted twice');
  assert.match(dashboard, /<span>현재 기동<\/span><strong>4대<\/strong>/);
  assert.match(dashboard, /<span>현재 정지<\/span><strong>0대<\/strong>/);
  assert.match(dashboard, /<span>간헐운전 대상<\/span><strong>2대<\/strong>/);
  assert.deepEqual(assets, before, 'aggregate views do not alter saved runtime or observed state');

  for (const a of assets) {
    a.cycleElapsedHours = a.runtimeHours = 12.5;
    Object.assign(a.dataParcRuntimeBasis, { coverageComplete: true, startAt: START, coverageStartAt: START });
    Object.assign(a, { cycleRuntimeState: 'running', operationState: 'running', isRunning: true });
    a.runRuntime.state = 'running';
  }
  ui.renderStatusFilters();
  assert.doesNotMatch(ui.elements.statusFilters.innerHTML, /data-status-filter="runtime_unknown"/,
    'the zero-count runtime warning filter stays hidden when every cycle is complete');
  const completeDashboard = ui.renderAllOverviewDashboard(assets, []);
  assert.match(completeDashboard, /<span>확인 필요<\/span><strong>0대<\/strong>/);
  assert.match(completeDashboard, /<span>현재 기동<\/span><strong>5대<\/strong>/);
});
