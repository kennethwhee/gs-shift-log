import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const REGISTERED = '2026-09-18T05:20:00.000Z';
const SELECTED = '2026-09-18T05:24:00.000Z';
const END = '2026-11-03T20:32:00.000Z';
const NOW = new Date('2026-11-03T21:00:00.000Z');
const KNOWN = '상위 보직 기준 선택 · RUN 재조회 필요';
const MISSING = '상위 보직 기준 선택 · 완료 시각 미기록';

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
  vm.runInContext(source.replace(marker, 'globalThis.ui={state,elements,cacheElements,commonRunCoverage,commonRunCoverageNotice,compactRunCoverageStatus,renderAssetCard,renderAllOverviewCard,openAssetHistory,displaySeverity};\n' + marker), context);
  const ui = context.ui; ui.cacheElements();
  ui.state.data = { assets, events: [], permissions: { canWrite: true }, user: { name: 'Fixture' },
    backfill: { hasRun: true, status: 'complete' }, missingSlots: [], missingTags: [], settings: {}, types: [] };
  return ui;
}
function asset(precision = 'minute') {
  const tagNumber = '103HRJ01AN601', dataParcTag = 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_103HRJ01AN601';
  return { tagNumber, dataParcTag, blowerType: 'limestone', unitNo: '1', positionLabel: '#A', displayName: 'Fixture Limestone #A',
    enabled: true, lastReplacementAt: REGISTERED, actualLastReplacementAt: '', cycleBasisKind: 'replacement_source_review',
    cycleStartState: 'legacy', cycleStoredStartedAt: '', cycleStartedAt: '', cycleStartRevision: 'fixture-start', cycleRuntimeRevision: 'fixture-runtime',
    runtimeHours: 1119.1, cycleElapsedHours: 1119.1, cycleRuntimeTracked: true, cycleRuntimeState: 'running', operationState: 'running',
    isRunning: true, runtimeAccumulationMode: 'measured_only', severity: 'runtime_unknown', measurementRequired: false,
    cycleSourceReview: { code: precision === 'minute' ? 'ROLE_PRIORITY_RUN_REBUILD' : 'ROLE_PRIORITY_COMPLETION_TIME_MISSING',
      cycleBasisConfirmed: false, measuredRangeMayContinue: true, message: '상위 업무일지 선택; 기존 조회구간 보존' },
    replacementAutoCycle: { schemaVersion: 3, normalizationVersion: 4, clockKnown: false, completionClockConflict: false,
      registeredRuntimeRange: true, registeredBaseline: true, requiresRunRefresh: false, freshQueryEligible: false, rangeQueryEligible: false,
      rolePrioritySelection: { version: 1, selectedRole: 'BCO1', selectedCompletionAt: precision === 'minute' ? SELECTED : '',
        timePrecision: precision, selectedSourceLogId: 'legacy-POCHEON#20260918#DAY#BCO1',
        selectedSourceKey: '["legacy-POCHEON#20260918#DAY#BCO1","103HRJ01AN601","fixture-entry",0]',
        selectedSourceSnapshotSha256: 'a'.repeat(64), selectedWorkDate: '2026-09-18', requiredRebuild: true,
        registeredReplacementAt: REGISTERED } },
    dataParcRuntimeBasis: { requestId: 'fixture-current-receipt', dataParcTag, startAt: REGISTERED, observedAt: END,
      runtimeHours: 1119.1, runningSeconds: 4028760, appendReady: true, coverageComplete: false, requiredStartAt: REGISTERED },
    runRuntime: { verified: true, source: 'dataparc', state: 'running', measuredAt: END } };
}
function visible(html) { return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function compact(html) { return visible(html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')); }
function selection(a) { return a.replacementAutoCycle.rolePrioritySelection; }

for (const precision of ['minute', 'day']) {
  test(`selected ${precision} source remains separate from the single saved RUN counter on both cards`, () => {
    const a = asset(precision), before = structuredClone(a), ui = harness([a]);
    const cards = [ui.renderAllOverviewCard(a), ui.renderAssetCard(a, { cycleDays: 90 })];
    for (const card of cards) {
      const text = compact(card);
      assert.match(text, /1,119\.1시간/);
      assert.match(text, /2026-09-18 14:20 → 2026-11-04 05:32/);
      assert.ok(text.includes(precision === 'minute' ? KNOWN : MISSING));
      assert.match(text, /상위 보직 교체 기준/);
      if (precision === 'minute') assert.match(text, /2026-09-18 14:24/);
      else assert.doesNotMatch(text, /14:24|2026-09-18 00:00/);
      assert.equal(ui.displaySeverity(a), 'runtime_unknown');
    }
    assert.equal((visible(cards[0]).match(/[\d,.]+시간/g) || []).length, 1);
    assert.deepEqual(a, before);
  });
}

test('history names the chosen source and old registered time without changing the old receipt or inventing a recovery action', () => {
  const a = asset(), before = structuredClone(a), ui = harness([a]); ui.openAssetHistory(a.tagNumber);
  const html = ui.elements.historyCycleSummary.innerHTML, text = visible(html);
  assert.match(text, /선택 근거 BCO1 업무일지 · 2026-09-18 14:24/);
  assert.match(text, /기존 RUN 등록 기준 2026-09-18 14:20/);
  assert.match(text, /legacy-POCHEON#20260918#DAY#BCO1/);
  assert.match(text, /기존 조회값과 원본 이력은 보존/);
  assert.match(text, /이어조회는 기존 조회구간만 연장/);
  assert.doesNotMatch(html, /data-confirmed-gap-recovery|data-history-action=".*priority/);
  assert.deepEqual(a, before);
});

test('a day-only superior source cannot inherit the lower source clock', () => {
  const a = asset('day'), ui = harness([a]); ui.openAssetHistory(a.tagNumber);
  const text = visible(ui.elements.historyCycleSummary.innerHTML);
  assert.match(text, /선택 근거 BCO1 업무일지 · 2026-09-18 · 완료 시각 미기록/);
  assert.match(text, /하위 보직의 시각을 대신 사용하지 않으며/);
  assert.equal(core.rolePriorityReview(a).key, 'role-priority-clock-missing');
  assert.equal(core.freshReplacementQuery(a, NOW), null);
  assert.equal(core.fbheSealRunView(a).primary, '1,119.1시간');
});

test('incomplete or detached selection metadata cannot introduce an authoritative-source label', () => {
  for (const weaken of [
    a => { selection(a).version = 2; }, a => { selection(a).selectedRole = 'BO1'; },
    a => { selection(a).selectedSourceLogId = ''; }, a => { selection(a).selectedSourceKey = ''; },
    a => { selection(a).selectedSourceSnapshotSha256 = ''; }, a => { selection(a).selectedWorkDate = ''; },
    a => { selection(a).registeredReplacementAt = SELECTED; }, a => { selection(a).selectedCompletionAt = 'invalid'; },
    a => { selection(a).requiredRebuild = false; }, a => { a.replacementAutoCycle.schemaVersion = 2; }
  ]) {
    const a = asset(); weaken(a); const ui = harness([a]);
    assert.equal(core.rolePriorityReview(a), null);
    assert.doesNotMatch(visible(ui.renderAllOverviewCard(a)), /상위 보직 기준 선택|상위 보직 교체 기준/);
  }
  const day = asset('day'); selection(day).selectedCompletionAt = SELECTED;
  assert.equal(core.rolePriorityReview(day), null);
});

test('an already matching, fully measured source adds no pending-rebuild badge', () => {
  const a = asset(); selection(a).selectedCompletionAt = REGISTERED; selection(a).requiredRebuild = false;
  Object.assign(a.replacementAutoCycle, { clockKnown: true, registeredRuntimeRange: false, confirmedReplacementAt: REGISTERED,
    completionClockReconciled: true, timePrecision: 'minute' });
  a.dataParcRuntimeBasis.coverageComplete = true; delete a.cycleSourceReview;
  const ui = harness([a]);
  assert.equal(core.rolePriorityReview(a), null); assert.equal(core.runReviewStatus(a), null);
  assert.doesNotMatch(ui.renderAllOverviewCard(a), /data-run-basis-status/);
});

test('a newer manual correction keeps its own number and timestamp under the selected-source warning', () => {
  const a = asset(); a.runtimeHours = a.cycleElapsedHours = 1200;
  a.runRuntime = { verified: true, source: 'manual', state: 'running', measuredAt: END };
  const before = structuredClone(a), ui = harness([a]), text = visible(ui.renderAllOverviewCard(a));
  assert.match(text, /수동 보정 누적 1,200\.0시간/); assert.doesNotMatch(text, /1,119\.1시간/);
  assert.match(text, /수동 보정 기준시각 2026-11-04 05:32/); assert.ok(text.includes(KNOWN));
  assert.deepEqual(a, before);
});

async function execute(a, resume = false) {
  const planned = core.plan([a], NOW); assert.equal(planned.skipped.length, 0); assert.equal(planned.tasks.length, 1);
  const task = planned.tasks[0], calls = [];
  const accepted = { ok: true, atomic: true, batchVersion: 1, requestedCount: 1,
    results: [{ ok: true, assetTag: a.tagNumber, item: { id: 'fixture-accepted', status: 'complete',
      requestType: 'blower_runtime_probe', probe: { assetTag: a.tagNumber, requestId: 'fixture-accepted' } } }] };
  const saved = { ...task, asset: { tagNumber: a.tagNumber, displayName: a.displayName } }; delete saved.runReviewStatus;
  const result = await core.executeDataParcBatch(resume ? [] : [task], {
    assertWritable() {}, currentAssetFor: () => a,
    ...(resume ? { runtimeResume: { version: 1, tasks: [saved], createdBatch: accepted, outcomes: [] } } : {}),
    async api(request) {
      calls.push(structuredClone(request));
      if (request.body?.action === 'create_blower_runtime_probe_batch') return accepted;
      if (!request.body) return { items: [{ id: 'fixture-accepted', status: 'complete' }] };
      assert.deepEqual(request.body, { action: 'dataparc_runtime_sync', requestId: 'fixture-accepted' });
      return { ok: true, message: 'Fixture append saved' };
    } });
  return { task, calls, result: result[0] };
}
for (const precision of ['minute', 'day']) {
  test(`${precision} source priority survives an ordinary successful append without rebasing its request`, async () => {
    const a = asset(precision), before = structuredClone(a), { task, calls, result } = await execute(a);
    const label = precision === 'minute' ? KNOWN : MISSING;
    assert.equal(result.status, 'complete'); assert.equal(result.partialRange, true);
    assert.equal(result.message, `RUN 이어조회 완료 · ${label}`);
    assert.equal(task.runReviewStatus.label, label);
    const request = calls[0].body.requests[0];
    assert.equal(request.startAt, REGISTERED); assert.equal(request.expectedLastReplacementAt, REGISTERED);
    assert.equal(request.requireIncrementalAppend, true); assert.equal(request.incrementalRefresh, true);
    assert.equal(request.expectedCycleStartRevision, before.cycleStartRevision);
    assert.equal(request.expectedCycleRuntimeRevision, before.cycleRuntimeRevision);
    assert.equal(Object.hasOwn(request, 'rolePrioritySelection'), false);
    assert.deepEqual(a, before);
  });
}

test('older resumed append resolves its pending-source label from the current projection', async () => {
  const a = asset(), { calls, result } = await execute(a, true);
  assert.equal(result.message, `RUN 이어조회 완료 · ${KNOWN}`);
  assert.ok(calls.every(call => call.body?.action !== 'create_blower_runtime_probe_batch'));
});

test('a selection without server authorization to continue the saved range does not plan a full rebuild', () => {
  const a = asset(); delete a.cycleSourceReview;
  const before = structuredClone(a), p = core.plan([a], NOW);
  assert.equal(p.tasks.length, 0); assert.equal(p.skipped.length, 1);
  assert.equal(p.skipped[0].message, `${KNOWN} · 기존 조회값 보존`);
  assert.deepEqual(a, before);
});

test('source identities are escaped in history evidence', () => {
  const a = asset(); selection(a).selectedSourceLogId = '<img src=x onerror=alert(1)>';
  const ui = harness([a]); ui.openAssetHistory(a.tagNumber);
  assert.doesNotMatch(ui.elements.historyCycleSummary.innerHTML, /<img/);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /&lt;img/);
});
