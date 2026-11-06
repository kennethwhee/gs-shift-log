import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { validatedFirstRunStart } from '../functions/_shared/blower-run-transition.js';

const require = createRequire(import.meta.url);
const { assess, summarize } = require('../maintenance/blower-runtime-assessment.js');
const refresh = require('../maintenance/blower-unified-refresh.js');
const END = '2026-11-06T08:47:00+09:00';
const START = '2026-08-27T08:40:00+09:00';
function measured(overrides = {}) {
  return {
    tagNumber: '204HHL60AP621', enabled: true, hours: 1060.2,
    provenance: 'measured', pending: false, wholeCycleVerified: false,
    coverage: { complete: true, startAt: START, observedAt: END, requiredStartAt: START, missingLeadingSeconds: 0 },
    review: null, action: null,
    operation: { state: 'stopped', intermittent: false, observedAt: END }, referenceObservedAt: END,
    ...overrides
  };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('FBHE 2B keeps 1,060.2 measured hours while a stop/oil job changes only operation details', () => {
  const input = freeze(measured()), before = structuredClone(input);
  const stopped = assess(input);
  const running = assess({ ...input, operation: { ...input.operation, state: 'running' } });
  assert.equal(stopped.hours, 1060.2);
  assert.equal(running.hours, 1060.2);
  assert.equal(stopped.operation.state, 'stopped');
  assert.equal(running.operation.state, 'running');
  assert.equal(stopped.requiresReview, false);
  assert.equal(stopped.wholeCycleVerified, false, 'no missing review flag can certify the physical cycle');
  assert.equal(stopped.scopeLabel, '등록 기준 누적');
  assert.deepEqual(input, before);
});

test('a measured zero remains zero; missing, pending and nonnumeric values never become zero', () => {
  const zero = assess(measured({ hours: 0, wholeCycleVerified: true }));
  assert.equal(zero.hours, 0);
  assert.equal(zero.scope, 'whole');
  assert.equal(zero.requiresReview, false);
  for (const hours of [null, undefined, '', '0', true, false, NaN, Infinity, -1]) {
    const result = assess(measured({ hours, wholeCycleVerified: true }));
    assert.equal(result.hours, null);
    assert.equal(result.scope, 'pending');
    assert.equal(result.wholeCycleVerified, false);
    assert.equal(result.requiresReview, true);
  }
  const pending = assess(measured({ hours: 0, pending: true, wholeCycleVerified: true }));
  assert.equal(pending.hours, null, 'an unmeasured reset sentinel is not zero RUN');
});

test('a saved or manual number cannot acquire a measured whole-cycle badge', () => {
  for (const provenance of ['manual', 'retained', 'unknown']) {
    const result = assess(measured({ provenance, wholeCycleVerified: true }));
    assert.equal(result.hours, 1060.2);
    assert.equal(result.wholeCycleVerified, false);
    assert.equal(result.scope, provenance === 'manual' ? 'manual' : 'retained');
    assert.equal(result.requiresReview, provenance !== 'manual');
  }
  const withoutDates = assess(measured({ wholeCycleVerified: true, coverage: { complete: true } }));
  assert.equal(withoutDates.wholeCycleVerified, false);
  assert.equal(withoutDates.requiresReview, true);
});

test('upper-role clock selection remains a basis review even when the displayed date is made to match', () => {
  const baseline = '2026-09-18T14:20:00+09:00', selectedAt = '2026-09-18T14:24:00+09:00';
  const role = {
    lastReplacementAt: baseline,
    replacementAutoCycle: { schemaVersion: 3, rolePrioritySelection: {
      version: 1, selectedRole: 'BCO1', timePrecision: 'minute', selectedSourceLogId: 'fixture-approved-log',
      selectedSourceKey: 'fixture-entry', selectedSourceSnapshotSha256: 'a'.repeat(64),
      selectedWorkDate: '2026-09-18', registeredReplacementAt: baseline,
      selectedCompletionAt: selectedAt, requiredRebuild: true
    } }
  };
  const review = refresh.rolePriorityReview(role);
  assert.equal(review.key, 'role-priority-run-rebuild');
  const input = measured({ tagNumber: '103HRJ01AN601', hours: 1170.4, wholeCycleVerified: true, review,
    coverage: { complete: true, startAt: selectedAt, requiredStartAt: selectedAt, observedAt: END, missingLeadingSeconds: 0 } });
  const result = assess(input);
  assert.equal(result.hours, 1170.4);
  assert.equal(result.wholeCycleVerified, false);
  assert.equal(result.reviewGroup, 'basis');
  assert.equal(result.reasonKey, 'role-priority-run-rebuild');
  role.replacementAutoCycle.rolePrioritySelection.timePrecision = 'day';
  delete role.replacementAutoCycle.rolePrioritySelection.selectedCompletionAt;
  const missingClock = assess({ ...input, hours: 0, review: refresh.rolePriorityReview(role) });
  assert.equal(missingClock.hours, 0);
  assert.equal(missingClock.reasonKey, 'role-priority-clock-missing');
  assert.equal(missingClock.scope, 'partial');
});

test('a proven missing prefix and an uncertain physical basis remain different review groups', () => {
  const measuredWindow = { complete: false, startAt: '2026-10-18T08:04:00+09:00', observedAt: END,
    requiredStartAt: '2026-09-25T14:40:00+09:00', missingLeadingSeconds: 1963440 };
  const gap = assess(measured({ tagNumber: '104ETG30AN602', hours: 456.7, coverage: measuredWindow,
    review: { key: 'leading-gap' }, action: { key: 'confirmed_gap_recovery', available: true } }));
  const basis = assess(measured({ coverage: measuredWindow, review: { key: 'replacement-basis-review' } }));
  assert.equal(gap.reviewGroup, 'range');
  assert.equal(gap.nextActionKey, 'confirmed_gap_recovery');
  assert.equal(basis.reviewGroup, 'basis', 'a missing physical basis is not cured by filling a time range');
  assert.equal(gap.wholeCycleVerified, false);
  assert.equal(gap.hours, 456.7);
  assert.equal(assess({ ...measured(), wholeCycleVerified: true,
    coverage: { ...measured().coverage, missingLeadingSeconds: 10 } }).wholeCycleVerified, false);
});

test('Seal Pot first RUN only resolves after the existing proof validator certifies the full preceding stopped range', () => {
  const origin = '2026-05-11T00:00:00+09:00', boundary = '2026-05-18T18:00:00+09:00';
  const first = '2026-05-18T09:01:22.000Z', seconds = 4118.7 * 3600;
  const raw = {
    assetTag: '204HHL10AN611', dataParcTag: 'GSPOGE.ABB_DCS.204HHL10AN611XB04',
    expectedCycleStartState: 'legacy', expectedCycleStartedAt: '', expectedLastReplacementAt: origin,
    expectedCycleStartRevision: 'fixture-start', expectedCycleRuntimeRevision: 'fixture-runtime',
    startAt: origin, observedAt: END, startState: 'stopped', endState: 'running',
    runningSeconds: seconds, firstRunStartedAt: first,
    chunks: [
      { startAt: origin, endAt: boundary, startState: 'stopped', endState: 'stopped', runningSeconds: 0 },
      { startAt: boundary, endAt: END, startState: 'stopped', endState: 'running', runningSeconds: seconds }
    ]
  };
  const before = measured({ tagNumber: raw.assetTag, hours: 4118.7,
    coverage: { complete: false, startAt: boundary, observedAt: END, requiredStartAt: origin, missingLeadingSeconds: 669600 },
    review: { key: 'coverage-gap' }, action: { key: 'seal_pot_first_run', available: true } });
  assert.equal(assess({ ...before, wholeCycleVerified: true }).requiresReview, true,
    'a claimed start/proof flag cannot erase a still-active coverage warning');
  assert.equal(validatedFirstRunStart(raw), first);
  const after = assess({ ...before, wholeCycleVerified: validatedFirstRunStart(raw) === first, review: null,
    coverage: { complete: true, startAt: origin, observedAt: END, requiredStartAt: origin, missingLeadingSeconds: 0 } });
  assert.equal(after.wholeCycleVerified, true);
  assert.equal(after.requiresReview, false);
  assert.equal(after.hours, 4118.7);
  assert.equal(after.coverage.startAt, origin, 'the underlying full verification range stays intact');
  const uncertain = structuredClone(raw);
  uncertain.chunks[0].runningSeconds = 1;
  assert.equal(validatedFirstRunStart(uncertain), '', 'a prior positive interval invalidates first RUN proof');
});

test('Limestone 2A shows a 6h38m query-time difference independently from its basis review and latest RUN state', () => {
  const oldEnd = '2026-11-06T02:09:00+09:00';
  const input = measured({ tagNumber: '203HRJ01AN601', hours: 1130.1,
    coverage: { ...measured().coverage, observedAt: oldEnd },
    review: { key: 'replacement-basis-review' },
    operation: { state: 'running', intermittent: false, observedAt: END } });
  const result = assess(input);
  assert.equal(result.freshness.lagSeconds, 6 * 3600 + 38 * 60);
  assert.equal(result.freshness.state, 'behind');
  assert.equal(result.operation.observedAt, END);
  assert.equal(result.coverage.observedAt, oldEnd);
  assert.equal(result.hours, 1130.1);
  assert.equal(result.reviewGroup, 'basis');
  const onlyEarlier = assess({ ...input, review: null });
  assert.equal(onlyEarlier.requiresReview, false, 'relative age does not prove a failed query or a bad value');
  const localTime = assess({ ...input, referenceObservedAt: '2026-11-06 08:47:00' });
  assert.equal(localTime.freshness.state, 'unknown', 'a timezone-free display string is not a reference instant');
});

test('read-only adapters and unknown actions never expose a query/confirmation workflow', () => {
  for (const action of [null, { key: 'seal_pot_first_run', available: false },
    { key: 'limestone_basis_confirm' }, { key: 'unknown_mutation', available: true }]) {
    assert.equal(assess(measured({ action })).nextActionKey, 'history');
  }
  assert.equal(assess(measured({ action: { key: 'seal_pot_first_run', available: true } })).nextActionKey, 'seal_pot_first_run');
});

test('27 visible card scenarios produce one consistent 17/5/5 operation count and 7 basis + 4 range reviews', () => {
  // Visible amounts/states are transcribed for a regression scenario. These
  // fixtures do not assert that production has independent whole-cycle proof.
  const rows = [
    ['104HHL60AP611', 691.7, 'running', 'replacement-basis-review'],
    ['104HHL60AP621', 0, 'stopped', 'role-priority-clock-missing'],
    ['104HHL60AP631', 1510.1, 'running'], ['204HHL60AP611', 163.4, 'running'],
    ['204HHL60AP621', 1060.2, 'stopped'], ['204HHL60AP631', 719.4, 'running', 'replacement-basis-review'],
    ['104HHL10AN611', 0, 'stopped'], ['104HHL10AN621', 2279.5, 'running'],
    ['104HHL10AN631', 3992.7, 'running'], ['204HHL10AN611', 4118.7, 'running', 'coverage-gap'],
    ['204HHL10AN621', 0, 'stopped'], ['204HHL10AN631', 4286.7, 'running', 'coverage-gap'],
    ['104SDF01AN001', 1322.5, 'intermittent', 'coverage-gap'], ['104SDF01AN002', 851.4, 'intermittent'],
    ['204SDF01AN001', 1704.2, 'intermittent'], ['204SDF01AN002', 1144.4, 'intermittent'],
    ['204LMDF01AN001', 45.9, 'intermittent'],
    ['104ETG30AN601', 1002.1, 'running'], ['104ETG30AN602', 456.7, 'running', 'leading-gap'],
    ['204ETG30AN601', 1001.9, 'running'], ['204ETG30AN602', 1078.4, 'running'],
    ['104ETH03AN601', 2326.3, 'stopped'], ['104ETH03AN602', 1995.2, 'running', 'replacement-basis-review'],
    ['103HRJ01AN601', 1170.4, 'running', 'role-priority-run-rebuild'],
    ['103HRJ01AN602', 1088.4, 'running', 'role-priority-clock-missing'],
    ['203HRJ01AN601', 1130.1, 'running', 'replacement-basis-review'], ['203HRJ01AN602', 1078.2, 'running']
  ];
  const results = rows.map(([tagNumber, hours, state, reason]) => assess(measured({
    tagNumber, hours, review: reason ? { key: reason } : null,
    operation: { state: state === 'intermittent' ? 'running' : state, intermittent: state === 'intermittent', observedAt: END },
    coverage: { ...measured().coverage, observedAt: tagNumber === '203HRJ01AN601' ? '2026-11-06T02:09:00+09:00' : END }
  })));
  const snapshot = structuredClone(results);
  freeze(results);
  const summary = summarize(results);
  assert.equal(summary.total, 27);
  assert.equal(summary.running, 17);
  assert.equal(summary.stopped, 5);
  assert.equal(summary.intermittent, 5);
  assert.equal(summary.requiresReview, 11);
  assert.equal(summary.basisReview, 7);
  assert.equal(summary.rangeReview, 4);
  assert.equal(summary.measurementReview, 0);
  assert.equal(summary.behind, 1);
  assert.equal(summary.whole, 0, 'no whole-cycle proof is fabricated for the otherwise unflagged cards');
  assert.equal(summary.partial, 27);
  assert.deepEqual(results.map(item => item.hours), rows.map(row => row[1]));
  assert.deepEqual(results, snapshot);
  assert.equal(summarize([...results, assess(measured({ enabled: false }))]).total, 27);
});

test('the standalone browser script and Node import expose the same side-effect-free contract', () => {
  const code = fs.readFileSync(new URL('../maintenance/blower-runtime-assessment.js', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(code, context);
  assert.equal(typeof context.BlowerRuntimeAssessment.assess, 'function');
  assert.equal(typeof context.BlowerRuntimeAssessment.summarize, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(context.BlowerRuntimeAssessment.assess(measured()))), assess(measured()));
});
