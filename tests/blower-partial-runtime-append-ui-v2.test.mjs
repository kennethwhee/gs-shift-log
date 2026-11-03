import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const uiSource = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const WARNING = '일부 기간 RUN 누적 · 교체 기준 확인 필요';
const OBSERVED = '2026-11-02T15:00:25.000Z';
const NOW = new Date('2026-11-03T03:00:00.000Z');
const CATALOG = [
  ['104HHL60AP611','fbhe','1'], ['104HHL60AP621','fbhe','1'], ['104HHL60AP631','fbhe','1'],
  ['204HHL60AP611','fbhe','2'], ['204HHL60AP621','fbhe','2'], ['204HHL60AP631','fbhe','2'],
  ['104HHL10AN611','seal_pot','1'], ['104HHL10AN621','seal_pot','1'], ['104HHL10AN631','seal_pot','1'],
  ['204HHL10AN611','seal_pot','2'], ['204HHL10AN621','seal_pot','2'], ['204HHL10AN631','seal_pot','2'],
  ['104SDF01AN001','organic_fuel','1'], ['104SDF01AN002','organic_fuel','1'],
  ['204SDF01AN001','organic_fuel','2'], ['204SDF01AN002','organic_fuel','2'],
  ['204LMDF01AN001','organic_fuel','2','manure'],
  ['104ETG30AN601','flyash_bag','1'], ['104ETG30AN602','flyash_bag','1'],
  ['204ETG30AN601','flyash_bag','2'], ['204ETG30AN602','flyash_bag','2'],
  ['104ETH03AN601','flyash_silo','shared'], ['104ETH03AN602','flyash_silo','shared'],
  ['103HRJ01AN601','limestone','1'], ['103HRJ01AN602','limestone','1'],
  ['203HRJ01AN601','limestone','2'], ['203HRJ01AN602','limestone','2']
];

// Seven saved timestamp/total shapes extracted from REPORT SHA256
// 87d0507336823eca21f5e392bbb3fffaebd0269c19395997c07b489738ae548e.
// They are historical DB evidence, not proof of physical RUN correctness. The
// other twenty receipts, request/revision IDs and nonfixed signals are synthetic.
const PARTIAL = new Map([
  ['104ETH03AN602',['2026-05-04T00:00:00+09:00','2026-05-09T15:00:00.000Z',6891972,'legacy',null]],
  ['104HHL10AN611',['2026-08-03T00:00:00+09:00','2026-08-03T00:15:00.000Z',41,'legacy',null]],
  ['104HHL60AP611',['2026-09-04T00:00:00+09:00','2026-09-04T01:50:00.000Z',2199380,'legacy',null]],
  ['104SDF01AN001',['2026-08-20T00:00:00+09:00','2026-08-20T02:00:00.000Z',4506199,'started','2026-08-19T15:00:00.000Z']],
  ['204HHL10AN611',['2026-05-11T00:00:00+09:00','2026-05-18T09:00:00.000Z',14536623,'legacy',null]],
  ['204HHL10AN631',['2026-05-10T15:00:00.000Z','2026-05-11T09:00:00.000Z',15141319,'legacy',null]],
  ['204HHL60AP631',['2026-09-16T00:00:00+09:00','2026-09-16T00:30:00.000Z',2299016,'pending',null]]
]);
const signalFor = (tag, type) => tag === '104ETH03AN602' ? 'GSPOGE.ABB_DCS.003ETH03AN602XB04'
  : type === 'limestone' ? `GSPOGE.ABB_DCS.${tag}XB04` : `GSPOGE.ABB_DCS.TEST_ONLY_BINARY_${tag}`;

function inventory() {
  return CATALOG.map(([tagNumber, blowerType, unitNo, assetGroup = ''], index) => {
    const partial = PARTIAL.get(tagNumber);
    const [replacement, startAt, runningSeconds, cycleStartState, started] = partial ||
      ['2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',3601 + index,'legacy',null];
    const runtimeHours = runningSeconds / 3600, dataParcTag = signalFor(tagNumber, blowerType);
    return { tagNumber, blowerType, unitNo, assetGroup, enabled: true, positionLabel: '#A', displayName: tagNumber,
      lastReplacementAt: replacement, actualLastReplacementAt: replacement, cycleBasisKind: 'replacement',
      cycleStartState, cycleStoredStartedAt: started, cycleStartedAt: started,
      cycleStartRevision: `fixture-start-${tagNumber}`, cycleRuntimeRevision: `fixture-runtime-${tagNumber}`,
      cycleElapsedHours: runtimeHours, runtimeHours, cycleRuntimeTracked: true,
      cycleRuntimeAnchorAt: OBSERVED, cycleRuntimeState: 'running', operationState: 'running', isRunning: true,
      measurementRequired: false, severity: 'normal', remainingHours: 20000,
      runtimeAccumulationMode: 'measured_only', hasUnverifiedDataParcHistory: false, dataParcTag,
      ...(blowerType === 'limestone' ? { limestoneAutoApply: true, limestoneBasisConfirmed: true,
        limestoneRunDisputed: false, limestoneBasisReviewRequired: false } : {}),
      runRuntime: { verified: true, source: 'dataparc', state: 'running', measuredAt: OBSERVED },
      dataParcRuntimeBasis: { requestId: `fixture-owner-${tagNumber}`, eventId: `dataparc_runtime:fixture-owner-${tagNumber}`,
        dataParcTag, startAt, coverageStartAt: startAt, observedAt: OBSERVED,
        runtimeHours, runningSeconds, coverageComplete: !partial, appendReady: true,
        requiredStartAt: started || replacement }
    };
  });
}
function partialAsset() { return inventory().find(a => a.tagNumber === '104HHL60AP611'); }
function planned(asset) {
  const p = core.plan([asset], NOW);
  assert.equal(p.tasks.length, 1, p.skipped[0]?.message || 'expected one append task');
  return p.tasks[0];
}
function accepted(task, status = 'complete') {
  return { ok: true, atomic: true, batchVersion: 1, requestedCount: 1,
    results: [{ ok: true, assetTag: task.snapshot.tagNumber,
      item: { id: 'fixture-accepted', status, requestType: 'blower_runtime_probe',
        probe: { assetTag: task.snapshot.tagNumber, requestId: 'fixture-accepted' } } }] };
}

test('all 27 assets append from their own saved endpoint while 20 complete and 7 partial receipts retain their original totals and dates', () => {
  const assets = inventory(), before = structuredClone(assets);
  const p = core.plan(assets, NOW);
  assert.equal(assets.length, 27);
  assert.equal(new Set(assets.map(a => a.tagNumber)).size, 27);
  assert.equal(p.targetCount, 27);
  assert.equal(p.tasks.length, 27);
  assert.equal(p.skipped.length, 0);
  assert.equal(p.tasks.filter(t => t.partialRange === true).length, 7);
  assert.equal(p.tasks.filter(t => t.partialRange !== true).length, 20);
  for (const task of p.tasks) {
    const asset = assets.find(a => a.tagNumber === task.snapshot.tagNumber), basis = asset.dataParcRuntimeBasis;
    assert.equal(task.incremental, true, asset.tagNumber);
    assert.equal(task.startAt, basis.startAt, asset.tagNumber);
    assert.equal(task.queryStartAt, basis.observedAt, asset.tagNumber);
    assert.equal(task.limestoneAutoRebuild, undefined, 'verified receipts do not trigger a full rebuild');
    if (PARTIAL.has(asset.tagNumber)) assert.deepEqual(task.partialBase, {
      requestId: basis.requestId, startAt: basis.startAt, observedAt: basis.observedAt,
      runtimeHours: basis.runtimeHours, runningSeconds: basis.runningSeconds, dataParcTag: basis.dataParcTag
    });
  }
  assert.deepEqual(assets, before, 'planning is pure: missing ranges are not filled and saved counters are not replaced');
});

test('a partial receipt without server append authorization is held without falling back to a full query', () => {
  for (const asset of inventory().filter(a => PARTIAL.has(a.tagNumber))) {
    asset.dataParcRuntimeBasis.appendReady = false;
    const before = structuredClone(asset), p = core.plan([asset], NOW);
    assert.equal(p.tasks.length, 0, asset.tagNumber);
    assert.equal(p.skipped.length, 1, asset.tagNumber);
    assert.deepEqual(asset, before);
  }
});

test('malformed, mismatched or stale partial receipts never become append or full-range tasks', () => {
  const changes = [
    a => { a.dataParcRuntimeBasis.requestId = ''; },
    a => { a.dataParcRuntimeBasis.dataParcTag = 'GSPOGE.ABB_DCS.TEST_ONLY_DIFFERENT'; },
    a => { a.dataParcRuntimeBasis.startAt = 'invalid'; },
    a => { a.dataParcRuntimeBasis.observedAt = a.dataParcRuntimeBasis.startAt; },
    a => { a.dataParcRuntimeBasis.observedAt = '2026-11-04T00:00:00Z'; },
    a => { a.dataParcRuntimeBasis.runningSeconds += 3; },
    a => { a.dataParcRuntimeBasis.runtimeHours += 1; },
    a => { a.cycleElapsedHours += 1; }
  ];
  for (const change of changes) {
    const asset = partialAsset(); change(asset);
    const before = structuredClone(asset), p = core.plan([asset], NOW);
    assert.equal(p.tasks.length, 0);
    assert.equal(p.skipped.length, 1);
    assert.deepEqual(asset, before);
  }
});

test('a manual counter change from one hour to two hours cannot append to the older one-hour receipt', () => {
  const asset = partialAsset();
  Object.assign(asset.dataParcRuntimeBasis, { runtimeHours: 1, runningSeconds: 3600 });
  asset.cycleElapsedHours = asset.runtimeHours = 2;
  const p = core.plan([asset], NOW);
  assert.equal(p.tasks.length, 0);
  assert.equal(p.skipped.length, 1);
  assert.equal(asset.cycleElapsedHours, 2);
  assert.equal(asset.dataParcRuntimeBasis.runtimeHours, 1);
});

test('a verified zero-second partial receipt can append without fabricating a stopped-prefix duration', () => {
  const asset = partialAsset();
  asset.cycleElapsedHours = asset.runtimeHours = 0;
  Object.assign(asset.dataParcRuntimeBasis, { runtimeHours: 0, runningSeconds: 0 });
  const before = structuredClone(asset), task = planned(asset);
  assert.equal(task.partialRange, true);
  assert.equal(task.partialBase.runningSeconds, 0);
  assert.equal(task.startAt, asset.dataParcRuntimeBasis.startAt);
  assert.deepEqual(asset, before);
});

test('automatic or basis-confirmed Limestone holds a late-start partial receipt without a full-cycle rebuild', () => {
  const strictBasisTags = new Set(['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602']);
  for (const automatic of [true, false]) for (const asset of inventory().filter(a => strictBasisTags.has(a.tagNumber))) {
    asset.limestoneAutoApply = automatic;
    asset.limestoneBasisConfirmed = true;
    Object.assign(asset.dataParcRuntimeBasis, { coverageComplete: false,
      startAt: '2026-10-02T00:00:00Z', coverageStartAt: '2026-10-02T00:00:00Z' });
    const before = structuredClone(asset), result = core.plan([asset], NOW);
    assert.equal(result.tasks.length, 0, 'the existing Limestone API baseline restriction stays authoritative');
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0].message, /Limestone.*전체 재조회하지 않음/);
    assert.deepEqual(asset, before, 'holding preserves the original range and total without a full rebuild');
  }
});

test('a newly planned partial append creates one atomic batch and applies only the returned accepted ID', async () => {
  const asset = partialAsset(), task = planned(asset), before = structuredClone(asset), calls = [], checkpoints = [];
  const results = await core.executeDataParcBatch([task], {
    assertWritable() {}, currentAssetFor: tag => tag === asset.tagNumber ? asset : null,
    runtimeCheckpoint: value => checkpoints.push(value),
    async api(request) {
      calls.push(request);
      if (request.body?.action === 'create_blower_runtime_probe_batch') return accepted(task);
      assert.deepEqual(request.body, { action: 'dataparc_runtime_sync', requestId: 'fixture-accepted' });
      return { message: 'fixture append applied' };
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.requests.length, 1);
  const submitted = calls[0].body.requests[0];
  assert.equal(submitted.requireIncrementalAppend, true);
  assert.equal(submitted.incrementalRefresh, true);
  assert.equal(submitted.startAt, asset.dataParcRuntimeBasis.startAt);
  assert.equal(results[0].status, 'complete');
  assert.equal(checkpoints.at(-1), null);
  assert.deepEqual(asset, before);
});

test('an accepted partial append resumes the same ID without creating a duplicate queue request', async () => {
  const asset = partialAsset(), task = planned(asset), calls = [], checkpoints = [];
  const savedTask = { ...task, asset: { tagNumber: asset.tagNumber, displayName: asset.displayName } };
  const resume = { version: 1, tasks: [savedTask], createdBatch: accepted(task, 'pending'), outcomes: [] };
  const before = structuredClone(resume);
  const results = await core.executeDataParcBatch([], {
    assertWritable() {}, runtimeResume: resume, currentAssetFor: () => asset,
    runtimeCheckpoint: value => checkpoints.push(value),
    async api(request) {
      calls.push(request);
      assert.notEqual(request.body?.action, 'create_blower_runtime_probe_batch');
      if (!request.body) {
        assert.ok(request.url.includes('fixture-accepted'));
        return { items: [{ id: 'fixture-accepted', status: 'complete' }] };
      }
      assert.deepEqual(request.body, { action: 'dataparc_runtime_sync', requestId: 'fixture-accepted' });
      return { message: 'fixture resumed append applied' };
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(results[0].status, 'complete');
  assert.equal(checkpoints.at(-1), null);
  assert.deepEqual(resume, before, 'the original accepted receipt stays immutable');
});

test('older accepted full-query tasks for partial coverage are held instead of polled or applied', async () => {
  for (const change of [task => { task.incremental = false; }, task => { delete task.partialRange; }]) {
    const asset = partialAsset(), task = planned(asset); change(task);
    const calls = [], checkpoints = [];
    const result = await core.executeDataParcBatch([], {
      assertWritable() {}, currentAssetFor: () => asset,
      runtimeResume: { version: 1, tasks: [{ ...task, asset: { tagNumber: asset.tagNumber } }],
        createdBatch: accepted(task, 'pending'), outcomes: [] },
      runtimeCheckpoint: value => checkpoints.push(value),
      async api(request) { calls.push(request); throw new Error('unexpected API'); }
    });
    assert.equal(result[0].status, 'skipped');
    assert.equal(calls.length, 0);
    assert.equal(checkpoints.at(-1), null);
  }
});

test('a changed current counter or partial base snapshot prevents accepted-result apply', async () => {
  for (const change of [
    (asset, task) => { asset.cycleElapsedHours += 1; asset.runtimeHours += 1; },
    (asset, task) => { task.partialBase.runningSeconds += 1; },
    (asset, task) => { task.partialBase.requestId = 'fixture-different-owner'; },
    (asset, task) => { asset.cycleRuntimeRevision = 'fixture-manual-revision'; }
  ]) {
    const asset = partialAsset(), task = planned(asset); change(asset, task);
    const calls = [];
    const result = await core.executeDataParcBatch([], {
      assertWritable() {}, currentAssetFor: () => asset,
      runtimeResume: { version: 1, tasks: [{ ...task, asset: { tagNumber: asset.tagNumber } }],
        createdBatch: accepted(task, 'complete'), outcomes: [] }, runtimeCheckpoint() {},
      async api(request) { calls.push(request); throw new Error('unexpected API'); }
    });
    assert.equal(result[0].status, 'skipped');
    assert.equal(calls.length, 0);
  }
});

function node() {
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, title: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {}, addEventListener() {},
    showModal() { this.open = true; }, close() { this.open = false; } };
}
function uiHarness(assets) {
  const nodes = new Map(), context = vm.createContext({ console, clearTimeout() {}, HTMLButtonElement: class {}, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia: () => ({ matches: false }),
      setTimeout(fn) { fn(); }, addEventListener() {} } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(uiSource.split(marker).length, 2);
  vm.runInContext(uiSource.replace(marker, `globalThis.ui={state,elements,cacheElements,commonRunCoverage,renderAssetCard,
    renderAllOverviewCard,openAssetHistory,renderStatusFilters,renderAllOverviewDashboard,
    renderUnifiedRefreshProgress};\n` + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets, events: [], permissions: { canWrite: true }, user: { name: 'Fixture' },
    backfill: { hasRun: true, status: 'complete' }, missingSlots: [], missingTags: [], settings: {}, types: [] };
  return ui;
}

test('partial append eligibility never disguises the seven saved ranges as whole-cycle totals in cards or history', () => {
  const assets = inventory().filter(a => PARTIAL.has(a.tagNumber)), before = structuredClone(assets), ui = uiHarness(assets);
  for (const asset of assets) {
    ui.openAssetHistory(asset.tagNumber);
    const amount = `${asset.dataParcRuntimeBasis.runtimeHours.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}시간`;
    for (const markup of [ui.renderAssetCard(asset, { cycleDays: 90 }),
      ui.renderAllOverviewCard(asset), ui.elements.historyCycleSummary.innerHTML]) {
      assert.ok(markup.includes(WARNING), asset.tagNumber);
      assert.ok(markup.includes(amount), asset.tagNumber);
      assert.doesNotMatch(markup, /class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
    }
  }
  assert.deepEqual(assets, before);
});

for (const tag of ['104ETH03AN602', '204HHL60AP621']) test(`${tag}: source-review warnings survive an allowed append and remain visible after rereading the asset`, () => {
  const asset = inventory().find(a => a.tagNumber === tag);
  if (tag === '204HHL60AP621') {
    // The complete recorded range can still have a disputed replacement source.
    // This saved DB shape does not prove that the physical belt was replaced.
    Object.assign(asset, { lastReplacementAt: '2026-09-16T00:23:00.000Z',
      actualLastReplacementAt: '2026-09-16T00:23:00.000Z', cycleStartState: 'pending',
      cycleElapsedHours: 3816811 / 3600, runtimeHours: 3816811 / 3600 });
    Object.assign(asset.dataParcRuntimeBasis, { startAt: asset.lastReplacementAt,
      coverageStartAt: asset.lastReplacementAt, requiredStartAt: asset.lastReplacementAt,
      runtimeHours: 3816811 / 3600, runningSeconds: 3816811, coverageComplete: true });
  }
  asset.cycleSourceReview = { message: 'Fixture audit: registered replacement source requires review',
    measuredRangeMayContinue: true,
    sourceReportSha256: '87d0507336823eca21f5e392bbb3fffaebd0269c19395997c07b489738ae548e' };
  const before = structuredClone(asset), task = planned(asset);
  assert.equal(task.incremental, true, 'source review does not invalidate a trusted measured append owner');
  assert.equal(task.partialRange, true, 'a trusted measured range remains separate from an uncertified replacement cycle');
  assert.equal(task.sourceReviewRange, true);
  assert.deepEqual(asset, before, 'planning must not clear a replacement-source review');
  asset.dataParcRuntimeBasis.appendReady = false;
  const held = core.plan([asset], NOW);
  assert.equal(held.tasks.length, 0, 'source-review UI flags cannot grant append authorization');
  assert.equal(held.skipped.length, 1);
  asset.dataParcRuntimeBasis.appendReady = true;

  // A successful refresh/reread may return new objects. The source-review
  // object is still authoritative when its saved warning is returned again.
  for (const reread of [asset, structuredClone(asset)]) {
    const ui = uiHarness([reread]);
    ui.openAssetHistory(tag);
    for (const markup of [ui.renderAssetCard(reread, { cycleDays: 90 }),
      ui.renderAllOverviewCard(reread), ui.elements.historyCycleSummary.innerHTML]) {
      assert.ok(markup.includes('조회구간 RUN 누적 · 교체 기준 확인 필요'), tag);
      assert.match(markup, /조회구간 RUN 누적/);
      assert.match(markup, /등록\s*기준/);
      assert.doesNotMatch(markup, /(?:<em>|<small>|<span>)최근(?: V-Belt)? 교체(?:<\/em>|<\/small>|<\/span>)/);
      assert.doesNotMatch(markup, /class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
    }
    assert.deepEqual(reread, before, 'rendering a refreshed object retains warning, integer total and source dates');
  }
});

test('a manual two-hour correction takes priority over an older one-hour receipt while keeping the source-review warning', () => {
  const asset = inventory().find(a => a.tagNumber === '204HHL60AP621');
  Object.assign(asset.dataParcRuntimeBasis, { runtimeHours: 1, runningSeconds: 3600 });
  asset.cycleElapsedHours = asset.runtimeHours = 2;
  asset.runRuntime = { verified: true, source: 'manual', state: 'running', measuredAt: OBSERVED };
  asset.cycleSourceReview = { message: 'Fixture: replacement source requires review', measuredRangeMayContinue: true };
  const before = structuredClone(asset), ui = uiHarness([asset]);
  ui.openAssetHistory(asset.tagNumber);
  for (const markup of [ui.renderAssetCard(asset, { cycleDays: 90 }),
    ui.renderAllOverviewCard(asset), ui.elements.historyCycleSummary.innerHTML]) {
    assert.ok(markup.includes('조회구간 RUN 누적 · 교체 기준 확인 필요'));
    assert.ok(markup.includes('2.0시간'), 'current manual value remains the primary value');
    assert.ok(!markup.includes('1.0시간'), 'the old receipt cannot overwrite a newer manual correction');
    assert.doesNotMatch(markup, /class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
  }
  assert.deepEqual(asset, before, 'rendering preserves both the newer manual value and older provenance');
});

test('a simulated successful 27-asset append reports eight basis-review targets and zero held queries', () => {
  const assets = inventory();
  for (const tag of ['104ETH03AN602', '204HHL60AP621']) assets.find(a => a.tagNumber === tag).cycleSourceReview = {
    message: 'Fixture: replacement source requires review', measuredRangeMayContinue: true
  };
  const before = structuredClone(assets), plan = core.plan(assets, NOW);
  assert.equal(plan.tasks.length, 27);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.tasks.filter(task => task.partialRange === true).length, 8,
    'reviewed Silo B already belongs to the seven partial ranges and is counted once');
  const ui = uiHarness(assets);
  ui.renderStatusFilters();
  const chip = ui.elements.statusFilters.innerHTML.match(/<button\b[^>]*data-status-filter="runtime_unknown"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(chip);
  assert.match(chip, /<span>기준·구간 확인<\/span>\s*<strong>8<\/strong>/);
  const dashboard = ui.renderAllOverviewDashboard(assets, []);
  assert.match(dashboard, /<span>확인 필요<\/span><strong>8대<\/strong>/);

  // Presentation-only mock outcomes; no company PC, Agent, API or DB is run.
  const simulated = plan.tasks.map(task => ({ tagNumber: task.snapshot.tagNumber,
    displayName: task.asset.displayName, status: 'complete', partialRange: task.partialRange === true,
    message: 'Fixture simulated append completion' }));
  const originalResults = structuredClone(simulated);
  ui.renderUnifiedRefreshProgress('Fixture simulated results', simulated);
  assert.match(ui.elements.unifiedRefreshSummary.textContent, /기준·구간 확인 8대/);
  assert.match(ui.elements.unifiedRefreshSummary.textContent, /조회 보류 0대/);
  assert.deepEqual(simulated, originalResults, 'progress presentation does not rewrite result records');
  assert.deepEqual(assets, before, 'summary and planning do not alter the original 27 counters or basis dates');
});

test('invalid source-review hour values remain unknown while an explicit numeric zero remains a measured zero', () => {
  const review = { message: 'Fixture: replacement source requires review', measuredRangeMayContinue: true };
  for (const source of ['dataparc', 'manual']) for (const invalid of [null, undefined, '', '  ', true, false]) {
    const asset = inventory().find(a => a.tagNumber === '204HHL60AP621');
    asset.cycleSourceReview = { ...review };
    asset.cycleElapsedHours = asset.runtimeHours = asset.dataParcRuntimeBasis.runtimeHours = invalid;
    asset.runRuntime.source = source;
    const before = structuredClone(asset), view = core.fbheSealRunView(asset, asset.dataParcRuntimeBasis);
    assert.equal(view.hours, null, `${source}: ${String(invalid)}`);
    assert.equal(view.primary, '확인 필요');
    const ui = uiHarness([asset]), coverage = ui.commonRunCoverage(asset);
    assert.equal(coverage.hours, null);
    assert.equal(coverage.runtime, '확인 필요');
    ui.openAssetHistory(asset.tagNumber);
    for (const markup of [ui.renderAssetCard(asset, { cycleDays: 90 }),
      ui.renderAllOverviewCard(asset), ui.elements.historyCycleSummary.innerHTML]) {
      assert.ok(markup.includes('확인 필요'));
      assert.ok(markup.includes('조회구간 RUN 누적 · 교체 기준 확인 필요'));
      assert.ok(!markup.includes('0.0시간'), 'null, blank and booleans cannot fabricate measured zero hours');
      assert.doesNotMatch(markup, /class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
    }
    assert.deepEqual(asset, before);
  }

  const zero = inventory().find(a => a.tagNumber === '204HHL60AP621');
  zero.cycleSourceReview = { ...review };
  zero.cycleElapsedHours = zero.runtimeHours = zero.dataParcRuntimeBasis.runtimeHours = 0;
  zero.dataParcRuntimeBasis.runningSeconds = 0;
  const view = core.fbheSealRunView(zero, zero.dataParcRuntimeBasis), ui = uiHarness([zero]);
  assert.equal(view.hours, 0);
  assert.equal(view.primary, '0.0시간');
  assert.equal(ui.commonRunCoverage(zero).hours, 0);
  assert.equal(ui.commonRunCoverage(zero).runtime, '0.0시간');
  ui.openAssetHistory(zero.tagNumber);
  for (const markup of [ui.renderAssetCard(zero, { cycleDays: 90 }),
    ui.renderAllOverviewCard(zero), ui.elements.historyCycleSummary.innerHTML]) {
    assert.ok(markup.includes('0.0시간'), 'an explicit valid numeric zero remains visible');
    assert.ok(markup.includes('조회구간 RUN 누적 · 교체 기준 확인 필요'));
    assert.doesNotMatch(markup, /class="cycle-deadline-metric|class="cycle-usage-metric|role="progressbar"/);
  }
});
