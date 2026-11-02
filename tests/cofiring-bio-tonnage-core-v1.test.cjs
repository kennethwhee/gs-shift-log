'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../maintenance/cofiring-bio-tonnage-core-v1.js');

const example = { targets: [361.4, 361.4], current: [400, 200], remainingHours: 4, mode: 'support', plannedRate2: 20 };
function near(actual, expected, tolerance = 1e-10) {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function normal(result) { assert.equal(result.valid, true); assert.equal(result.state, 'active'); }

test('approved support example credits existing Unit 1 surplus exactly once', () => {
  const r = calculate(example); normal(r);
  near(r.total, 722.8); near(r.current, 600); near(r.remaining, 122.8);
  near(r.need[0], 42.8); near(r.need[1], 80);
  near(r.rates[0], 10.7); near(r.rates[1], 20);
  near(r.final[0], 442.8); near(r.final[1], 280); near(r.finalTotal, 722.8);
  near(r.short2, 81.4); near(r.credit1, 38.6); near(r.creditedTo2, 38.6);
  near(r.support, 42.8); near(r.supportRate, 10.7);
  assert.deepEqual(r.rateKinds, ['required', 'planned']);
});

test('23:02 snapshot uses the exact 58-minute remaining window without premature rounding', () => {
  const r = calculate({ ...example, current: [443.4, 253.52], remainingHours: 58 / 60 }); normal(r);
  near(r.remaining, 25.88); near(r.need[0], 6.546666666666667);
  near(r.need[1], 19.333333333333332); near(r.rates[0], 6.772413793103448);
  near(r.final[0], 449.94666666666666); near(r.final[1], 272.85333333333335);
  near(r.finalTotal, 722.8); near(r.creditedTo2, 82);
});

test('Unit 1 required total includes its own deficit and the support subset', () => {
  const r = calculate({ ...example, current: [100, 200] }); normal(r);
  near(r.gaps[0], 261.4); near(r.need[0], 342.8); near(r.rates[0], 85.7);
  near(r.support, 81.4); near(r.supportRate, 20.35);
  near(r.gaps[0] + r.support, r.need[0]);
});

test('combined mode reallocates an overshoot without negative feeding', () => {
  const r = calculate({ ...example, mode: 'combined', plannedRate2: undefined }); normal(r);
  assert.equal(r.need[0], 0); near(r.need[1], 122.8);
  near(r.final[0], 400); near(r.final[1], 322.8); near(r.finalTotal, 722.8);
  near(r.rates[1], 30.7); assert.deepEqual(r.rateKinds, ['required', 'required']);
});

test('unequal targets retain their own deficits until a surplus is available', () => {
  const input = { targets: [500, 300], current: [100, 200], remainingHours: 2, mode: 'combined' };
  const r = calculate(input); normal(r);
  assert.deepEqual(r.need, [400, 100]); assert.deepEqual(r.final, [500, 300]);
  const surplus = calculate({ ...input, current: [550, 200] }); normal(surplus);
  assert.deepEqual(surplus.need, [0, 50]); assert.deepEqual(surplus.final, [550, 250]);
});

test('individual mode preserves each target rather than claiming combined credit', () => {
  const r = calculate({ ...example, mode: 'individual', plannedRate2: undefined }); normal(r);
  assert.equal(r.need[0], 0); near(r.need[1], 161.4);
  near(r.finalTotal, 761.4); near(r.excess, 38.6);
  assert.equal(r.support, 0);
});

test('planned Unit 2 overshoot is retained and reported', () => {
  const r = calculate({ ...example, plannedRate2: 40 }); normal(r);
  assert.deepEqual(r.need, [0, 160]); assert.deepEqual(r.final, [400, 360]);
  near(r.finalTotal, 760); near(r.excess, 37.2);
  assert.equal(r.rates[1], 40); assert.equal(r.support, 0);
});

test('zero planned Unit 2 rate assigns the whole remaining combined amount to Unit 1', () => {
  const r = calculate({ ...example, plannedRate2: 0 }); normal(r);
  near(r.need[0], 122.8); assert.equal(r.need[1], 0); near(r.finalTotal, 722.8);
});

test('Unit 2 projected surplus can cover Unit 1 rather than inventing support', () => {
  const r = calculate({ ...example, current: [100, 200], remainingHours: 6, plannedRate2: 30 }); normal(r);
  near(r.need[0], 242.8); assert.equal(r.support, 0); assert.equal(r.short2, 0);
  near(r.finalTotal, 722.8);
});

test('already achieved and zero targets do not divide by a zero gap total', () => {
  for (const input of [
    { targets: [0, 0], current: [0, 0] },
    { targets: [10, 20], current: [10, 20] },
    { targets: [10, 20], current: [12, 25] }
  ]) {
    const r = calculate({ ...input, mode: 'combined', remainingHours: 1 }); normal(r);
    assert.deepEqual(r.need, [0, 0]); assert.deepEqual(r.rates, [0, 0]);
    assert.equal(r.remaining, 0); assert.ok(Number.isFinite(r.finalTotal));
  }
  const planned = calculate({ ...example, targets: [10, 20], current: [12, 25] }); normal(planned);
  assert.deepEqual(planned.need, [0, 80]); assert.equal(planned.currentExcess, 7);
  assert.equal(planned.excess, 87);
});

test('at and after midnight show actual deficits but never a hypothetical achieved final', () => {
  for (const remainingHours of [0, -1]) for (const mode of ['individual', 'combined', 'support']) {
    const r = calculate({ ...example, mode, remainingHours });
    assert.equal(r.valid, true); assert.equal(r.state, 'closed');
    assert.equal(r.projectionAvailable, false); near(r.remaining, 122.8);
    near(r.gaps[1], 161.4); assert.deepEqual(r.need, [null, null]);
    assert.deepEqual(r.rates, [null, null]); assert.deepEqual(r.final, [null, null]);
    assert.equal(r.finalTotal, null); assert.equal(r.support, null); assert.equal(r.excess, null);
  }
});

test('missing, blank, coerced, sparse and negative quantities are not treated as zero', () => {
  const invalidInputs = [
    undefined, null, [], {},
    { ...example, targets: [361.4] },
    { ...example, targets: [361.4, ''] },
    { ...example, targets: [361.4, null] },
    { ...example, current: [400, '200'] },
    { ...example, current: new Array(2) },
    { ...example, current: [400, -1] },
    { ...example, targets: [-1, 361.4] },
    { ...example, remainingHours: '' },
    { ...example, remainingHours: null },
    { ...example, mode: 'unknown' },
    { ...example, plannedRate2: undefined },
    { ...example, plannedRate2: '' },
    { ...example, plannedRate2: -1 }
  ];
  for (const input of invalidInputs) {
    const r = calculate(input);
    assert.equal(r.valid, false); assert.equal(r.state, 'invalid');
    assert.ok(r.errors.length); assert.deepEqual(r.rates, [null, null]);
    assert.equal(r.total, null); assert.deepEqual(r.need, [null, null]);
  }
});

test('nonfinite values and overflow of totals, products, final sums or rates are rejected', () => {
  const invalidInputs = [
    { ...example, targets: [NaN, 361.4] },
    { ...example, current: [Infinity, 200] },
    { ...example, remainingHours: Infinity },
    { ...example, plannedRate2: Infinity },
    { ...example, targets: [Number.MAX_VALUE, Number.MAX_VALUE] },
    { ...example, current: [Number.MAX_VALUE, Number.MAX_VALUE] },
    { ...example, plannedRate2: Number.MAX_VALUE },
    { targets: [1, 1], current: [0, Number.MAX_VALUE], remainingHours: 1, mode: 'support', plannedRate2: Number.MAX_VALUE },
    { ...example, mode: 'combined', remainingHours: Number.MIN_VALUE }
  ];
  for (const input of invalidInputs) {
    const r = calculate(input);
    assert.equal(r.valid, false); assert.deepEqual(r.rates, [null, null]);
    assert.equal(r.finalTotal, null);
  }
});

test('calculation does not mutate caller inputs and does not expose caller arrays', () => {
  const targets = Object.freeze([361.4, 361.4]);
  const current = Object.freeze([400, 200]);
  const input = Object.freeze({ ...example, targets, current });
  const r = calculate(input); normal(r);
  r.need[0] = 999;
  assert.deepEqual(targets, [361.4, 361.4]); assert.deepEqual(current, [400, 200]);
  near(calculate(input).need[0], 42.8);
});

test('combined conservation and support subset invariants hold across operating combinations', () => {
  const targets = [[0, 0], [361.4, 361.4], [500, 300], [0, 100]];
  const actuals = [[0, 0], [100, 200], [400, 200], [443.4, 253.52], [800, 0], [800, 900]];
  for (const target of targets) for (const current of actuals) {
    const r = calculate({ targets: target, current, remainingHours: 58 / 60, mode: 'combined' }); normal(r);
    assert.ok(r.need.every(value => value >= 0));
    near(r.need[0] + r.need[1], r.remaining);
    near(r.finalTotal, Math.max(r.total, r.current));
    for (const plannedRate2 of [0, 20, 1000]) {
      const s = calculate({ targets: target, current, remainingHours: 58 / 60, mode: 'support', plannedRate2 }); normal(s);
      assert.ok(s.support >= 0 && s.support <= s.need[0]);
      near(s.finalTotal, Math.max(s.total, s.current + plannedRate2 * 58 / 60));
      near(s.creditedTo2 + s.support, s.short2);
    }
  }
});

test('Unit 2 support mirrors the approved quantities and credits its existing surplus only once', () => {
  const r = calculate({ ...example, current: [200, 400], mode: 'support2', plannedRate1: 20 }); normal(r);
  near(r.remaining, 122.8); near(r.need[0], 80); near(r.need[1], 42.8);
  near(r.rates[0], 20); near(r.rates[1], 10.7);
  near(r.final[0], 280); near(r.final[1], 442.8); near(r.finalTotal, 722.8);
  near(r.short1, 81.4); near(r.credit2, 38.6); near(r.creditedTo1, 38.6);
  near(r.support, 42.8); near(r.supportRate, 10.7);
  assert.equal(r.creditedTo2, 0); assert.equal(r.credit1, 0); assert.equal(r.short2, 0);
  assert.equal(r.helperIndex, 1); assert.equal(r.plannedIndex, 0);
  assert.deepEqual(r.rateKinds, ['planned', 'required']);
});

test('Unit 2 support keeps the exact 58-minute quantities and rate precision', () => {
  const r = calculate({ ...example, current: [253.52, 443.4], remainingHours: 58 / 60,
    mode: 'support2', plannedRate1: 20 }); normal(r);
  near(r.need[0], 19.333333333333332); near(r.need[1], 6.546666666666667);
  near(r.rates[1], 6.772413793103448); near(r.support, r.need[1]);
  near(r.creditedTo1, 82); near(r.finalTotal, 722.8);
});

test('Unit 2 total need includes its own unequal-target deficit and the support subset', () => {
  const r = calculate({ targets: [300, 500], current: [200, 100], remainingHours: 2,
    mode: 'support2', plannedRate1: 20 }); normal(r);
  assert.deepEqual(r.need, [40, 460]); assert.deepEqual(r.rates, [20, 230]);
  assert.equal(r.gaps[1], 400); assert.equal(r.support, 60); assert.equal(r.supportRate, 30);
  assert.equal(r.short1, 60); assert.equal(r.credit2, 0); assert.equal(r.creditedTo1, 0);
  assert.equal(r.need[1], r.gaps[1] + r.support);
  const credited = calculate({ targets: [300, 500], current: [100, 550], remainingHours: 2,
    mode: 'support2', plannedRate1: 30 }); normal(credited);
  assert.deepEqual(credited.need, [60, 90]); assert.equal(credited.short1, 140);
  assert.equal(credited.credit2, 50); assert.equal(credited.creditedTo1, 50);
  assert.equal(credited.support, 90); assert.equal(credited.finalTotal, 800);
});

test('Unit 1 planned overshoot remains explicit in Unit 2 support mode', () => {
  const r = calculate({ ...example, current: [200, 400], mode: 'support2', plannedRate1: 40 }); normal(r);
  assert.deepEqual(r.need, [160, 0]); assert.deepEqual(r.final, [360, 400]);
  near(r.finalTotal, 760); near(r.excess, 37.2);
  assert.equal(r.rates[0], 40); assert.equal(r.support, 0); assert.equal(r.creditedTo2, 0);
});

test('zero Unit 1 planned rate and zero targets are valid without inventing support', () => {
  const r = calculate({ ...example, current: [200, 400], mode: 'support2', plannedRate1: 0 }); normal(r);
  assert.equal(r.need[0], 0); near(r.need[1], 122.8); near(r.finalTotal, 722.8);
  const zero = calculate({ targets: [0, 100], current: [0, 0], remainingHours: 2,
    mode: 'support2', plannedRate1: 0 }); normal(zero);
  assert.deepEqual(zero.need, [0, 100]); assert.equal(zero.support, 0);
  assert.equal(zero.credit2, 0); assert.equal(zero.creditedTo1, 0);
  const achieved = calculate({ targets: [0, 0], current: [0, 0], remainingHours: 2,
    mode: 'support2', plannedRate1: 0 }); normal(achieved);
  assert.deepEqual(achieved.need, [0, 0]); assert.deepEqual(achieved.rates, [0, 0]);
});

test('Unit 1 planned surplus reduces Unit 2 own deficit without a false support label', () => {
  const r = calculate({ ...example, current: [200, 100], remainingHours: 6,
    mode: 'support2', plannedRate1: 30 }); normal(r);
  near(r.need[1], 242.8); assert.equal(r.support, 0); assert.equal(r.short1, 0);
  near(r.finalTotal, 722.8);
});

test('only the selected support direction plan is required and validated', () => {
  for (const plannedRate1 of [undefined, null, '', '20', -1, NaN, Infinity, new Number(20)]) {
    const r = calculate({ ...example, mode: 'support2', plannedRate1 });
    assert.equal(r.valid, false); assert.equal(r.mode, 'support2');
    assert.ok(r.errors.some(error => error.field === 'plannedRate1'));
    assert.deepEqual(r.need, [null, null]); assert.deepEqual(r.rates, [null, null]);
    for (const key of ['short1', 'short2', 'credit1', 'credit2', 'creditedTo1', 'creditedTo2', 'helperIndex', 'plannedIndex']) {
      assert.equal(r[key], null);
    }
  }
  const reverse = calculate({ ...example, mode: 'support2', plannedRate1: 20, plannedRate2: '' }); normal(reverse);
  const original = calculate({ ...example, plannedRate1: '' }); normal(original);
  assert.equal(original.helperIndex, 0); assert.equal(original.plannedIndex, 1);
  for (const mode of ['individual', 'combined']) {
    const r = calculate({ ...example, mode, plannedRate1: '', plannedRate2: '' }); normal(r);
    assert.equal(r.helperIndex, null); assert.equal(r.plannedIndex, null);
    assert.deepEqual(r.rateKinds, ['required', 'required']);
    assert.equal(r.creditedTo1, 0); assert.equal(r.creditedTo2, 0);
  }
});

test('reverse support retains direction labels but no future projection after midnight', () => {
  for (const remainingHours of [0, -1]) {
    const r = calculate({ ...example, mode: 'support2', plannedRate1: 20, remainingHours });
    assert.equal(r.valid, true); assert.equal(r.state, 'closed');
    assert.equal(r.helperIndex, 1); assert.equal(r.plannedIndex, 0);
    assert.deepEqual(r.rateKinds, ['planned', 'required']);
    assert.equal(r.projectionAvailable, false); near(r.remaining, 122.8);
    assert.deepEqual(r.need, [null, null]); assert.deepEqual(r.rates, [null, null]);
    assert.deepEqual(r.final, [null, null]); assert.equal(r.finalTotal, null);
    assert.equal(r.support, null); assert.equal(r.supportRate, null);
    assert.equal(r.short1, null); assert.equal(r.short2, null);
    assert.equal(r.creditedTo1, null); assert.equal(r.creditedTo2, null);
  }
});

test('reverse support rejects planned products, final additions and hourly-rate overflow', () => {
  const values = [
    { ...example, mode: 'support2', plannedRate1: Number.MAX_VALUE },
    { targets: [1, 1], current: [Number.MAX_VALUE, 0], remainingHours: 1,
      mode: 'support2', plannedRate1: Number.MAX_VALUE },
    { ...example, mode: 'support2', plannedRate1: 0, remainingHours: Number.MIN_VALUE }
  ];
  for (const input of values) {
    const r = calculate(input);
    assert.equal(r.valid, false); assert.deepEqual(r.rates, [null, null]);
    assert.equal(r.finalTotal, null); assert.equal(r.support, null);
  }
});

test('support2 leaves frozen inputs and the unused opposite-direction draft unchanged', () => {
  const targets = Object.freeze([300, 500]); const current = Object.freeze([100, 550]);
  const input = Object.freeze({ targets, current, remainingHours: 2, mode: 'support2', plannedRate1: 30, plannedRate2: '' });
  const r = calculate(input); normal(r);
  r.need[0] = 999; r.rates[1] = 999; r.final[0] = 999; r.gaps[1] = 999;
  assert.deepEqual(targets, [300, 500]); assert.deepEqual(current, [100, 550]);
  assert.equal(input.plannedRate2, ''); assert.deepEqual(calculate(input).need, [60, 90]);
});

test('support directions are symmetric under unit permutation with conservation and support bounds', () => {
  const reverse = values => [values[1], values[0]];
  const targetCases = [[0, 0], [361.4, 361.4], [500, 300], [0, 100], [100, 0]];
  const currentCases = [[0, 0], [100, 200], [400, 200], [443.4, 253.52], [800, 0], [800, 900]];
  for (const targets of targetCases) for (const current of currentCases) {
    for (const remainingHours of [58 / 60, 4]) for (const plannedRate of [0, 20, 1000]) {
      const original = calculate({ targets, current, remainingHours, mode: 'support', plannedRate2: plannedRate }); normal(original);
      const mirrored = calculate({ targets: reverse(targets), current: reverse(current), remainingHours,
        mode: 'support2', plannedRate1: plannedRate }); normal(mirrored);
      for (const field of ['need', 'rates', 'final', 'gaps']) {
        near(original[field][0], mirrored[field][1]); near(original[field][1], mirrored[field][0]);
      }
      for (const field of ['total', 'current', 'remaining', 'currentExcess', 'finalTotal', 'support', 'supportRate', 'excess']) {
        near(original[field], mirrored[field]);
      }
      near(original.short2, mirrored.short1); near(original.short1, mirrored.short2);
      near(original.credit1, mirrored.credit2); near(original.credit2, mirrored.credit1);
      near(original.creditedTo2, mirrored.creditedTo1); assert.equal(mirrored.creditedTo2, 0);
      assert.ok(mirrored.support >= 0 && mirrored.support <= mirrored.need[1]);
      near(mirrored.creditedTo1 + mirrored.support, mirrored.short1);
      near(mirrored.finalTotal, Math.max(mirrored.total, mirrored.current + plannedRate * remainingHours));
      assert.deepEqual(mirrored.rateKinds, ['planned', 'required']);
      assert.equal(mirrored.helperIndex, 1); assert.equal(mirrored.plannedIndex, 0);
    }
  }
});
