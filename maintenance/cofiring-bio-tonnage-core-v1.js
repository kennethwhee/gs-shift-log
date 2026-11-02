(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.CofiringBioTonnageCoreV1=factory();
}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

/**
 * Pure Bio tonnage planning. The caller must supply actual quantities from one
 * valid daily result and hours from that result's KST as-of to next midnight.
 * This function does not inspect the clock, historical results or plant state.
 * `need` is additional TOTAL feed; `support` is a subset of the helper's `need`.
 * support: Unit 1 helps a manually planned Unit 2; support2 reverses those roles.
 * A planned rate/amount is not a need or a measured rate. `final` is conditional
 * on those planned/required additions. Indices refer to zero-based unit arrays.
 * An explicit combinedTarget is the daily goal for combined/support modes, not
 * a feeding cap. Only old callers that omit it use the sum of the unit goals.
 * Global modes derive both unit baselines from half of that daily goal. Manual
 * per-unit targets apply only in individual mode; no goal is rounded here.
 */
function calculate(input) {
  const errors = [];
  const modes = ['individual', 'combined', 'support', 'support2'];
  const invalid = () => ({
    valid: false, state: 'invalid', errors: errors.slice(),
    mode: modes.includes(input && input.mode) ? input.mode : null,
    projectionAvailable: false, total: null, unitTargetTotal: null,
    combinedTargetApplied: false, effectiveTargets: Object.freeze([null, null]),
    current: null, gaps: [null, null],
    remaining: null, currentExcess: null, need: [null, null], rates: [null, null],
    final: [null, null], finalTotal: null, support: null, supportRate: null,
    short1: null, short2: null, credit1: null, credit2: null,
    creditedTo1: null, creditedTo2: null, excess: null,
    rateKinds: [null, null], helperIndex: null, plannedIndex: null
  });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push({ field: 'input', code: 'required' });
    return invalid();
  }
  const checkNumber = (value, field, nonnegative = true) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push({ field, code: 'finite-number-required' });
    } else if (nonnegative && value < 0) errors.push({ field, code: 'negative' });
  };
  for (const field of ['targets', 'current']) {
    const values = input[field];
    if (!Array.isArray(values) || values.length !== 2) {
      errors.push({ field, code: 'two-values-required' });
    } else {
      // Index reads also reject sparse arrays; Array.every alone would skip them.
      checkNumber(values[0], field + '[0]');
      checkNumber(values[1], field + '[1]');
    }
  }
  checkNumber(input.remainingHours, 'remainingHours', false);
  if (!modes.includes(input.mode)) errors.push({ field: 'mode', code: 'unsupported' });
  const combinedTargetApplied = input.mode !== 'individual' &&
    Object.prototype.hasOwnProperty.call(input, 'combinedTarget');
  if (combinedTargetApplied) checkNumber(input.combinedTarget, 'combinedTarget');
  const helperIndex = input.mode === 'support' ? 0 : input.mode === 'support2' ? 1 : null;
  const plannedIndex = helperIndex === null ? null : 1 - helperIndex;
  const plannedField = plannedIndex === null ? null : 'plannedRate' + (plannedIndex + 1);
  if (plannedField !== null) checkNumber(input[plannedField], plannedField);
  if (errors.length) return invalid();

  const targets = input.targets;
  const actual = input.current;
  const hours = input.remainingHours;
  const unitTargetTotal = targets[0] + targets[1];
  const total = combinedTargetApplied ? input.combinedTarget : unitTargetTotal;
  const current = actual[0] + actual[1];
  if (!Number.isFinite(unitTargetTotal) || !Number.isFinite(total) || !Number.isFinite(current)) {
    errors.push({ field: 'totals', code: 'overflow' });
    return invalid();
  }
  const half = total / 2;
  if (input.mode !== 'individual' && total > 0 && half === 0) {
    errors.push({ field: 'effectiveTargets', code: 'underflow' });
    return invalid();
  }
  const effectiveTargets = Object.freeze(input.mode === 'individual' ? targets.slice() : [half, half]);
  const gaps = [Math.max(0, effectiveTargets[0] - actual[0]), Math.max(0, effectiveTargets[1] - actual[1])];
  const remaining = Math.max(0, total - current);
  const credit1 = Math.max(0, actual[0] - effectiveTargets[0]);
  const credit2 = Math.max(0, actual[1] - effectiveTargets[1]);
  const rateKinds = ['required', 'required'];
  if (plannedIndex !== null) rateKinds[plannedIndex] = 'planned';
  const base = {
    valid: true, state: hours > 0 ? 'active' : 'closed', errors: [],
    mode: input.mode, projectionAvailable: hours > 0,
    total, unitTargetTotal, combinedTargetApplied, effectiveTargets, current, gaps, remaining,
    currentExcess: Math.max(0, current - total),
    need: [null, null], rates: [null, null], final: [null, null], finalTotal: null,
    support: null, supportRate: null, short1: null, short2: null, credit1, credit2,
    creditedTo1: null, creditedTo2: null, excess: null,
    rateKinds, helperIndex, plannedIndex
  };
  // Keep actual deficits visible at/after midnight. No hypothetical additional
  // feed or final achievement is projected into an already closed period.
  if (hours <= 0) return base;

  let need;
  if (input.mode === 'individual') {
    need = gaps.slice();
  } else if (input.mode === 'combined') {
    if (remaining === 0) need = [0, 0];
    else {
      // Match equal END totals while neither unit has exceeded its derived
      // half. An irreversible surplus reduces only the other unit's remainder.
      const first = Math.min(remaining, gaps[0]);
      // The residual conserves the combined goal without rounding odd halves.
      need = [first, Math.max(0, remaining - first)];
    }
  } else {
    const planned = input[plannedField] * hours;
    if (!Number.isFinite(planned)) {
      errors.push({ field: plannedField, code: 'product-overflow' });
      return invalid();
    }
    // Never cap the opposite unit's plan to hide a projected overshoot.
    need = [0, 0];
    need[plannedIndex] = planned;
    need[helperIndex] = Math.max(0, remaining - planned);
  }
  const final = [actual[0] + need[0], actual[1] + need[1]];
  const finalTotal = final[0] + final[1];
  const rates = need.map(value => value / hours);
  if (plannedIndex !== null) rates[plannedIndex] = input[plannedField];
  const support = helperIndex === null ? 0 : Math.max(0, need[helperIndex] - gaps[helperIndex]);
  const supportRate = support / hours;
  const short1 = Math.max(0, effectiveTargets[0] - final[0]);
  const short2 = Math.max(0, effectiveTargets[1] - final[1]);
  const creditedTo1 = helperIndex === 1 ? Math.min(credit2, short1) : 0;
  const creditedTo2 = helperIndex === 0 ? Math.min(credit1, short2) : 0;
  const excess = Math.max(0, finalTotal - total);
  const derived = [...need, ...final, finalTotal, ...rates, support, supportRate,
    short1, short2, creditedTo1, creditedTo2, excess];
  if (derived.some(value => !Number.isFinite(value) || value < 0)) {
    errors.push({ field: 'derived', code: 'overflow' });
    return invalid();
  }
  return Object.assign(base, { need, rates, final, finalTotal, support, supportRate,
    short1, short2, creditedTo1, creditedTo2, excess });
}

return Object.freeze({ calculate });
}));
