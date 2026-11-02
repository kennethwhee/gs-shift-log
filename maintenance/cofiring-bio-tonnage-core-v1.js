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
 * `need` is additional TOTAL feed; `support` is a subset of Unit 1's `need`.
 * In support mode Unit 2's rate/amount are the operator's plan, not a need or
 * measured rate. `final` is conditional on those planned/required additions.
 */
function calculate(input) {
  const errors = [];
  const modes = ['individual', 'combined', 'support'];
  const invalid = () => ({
    valid: false, state: 'invalid', errors: errors.slice(),
    mode: modes.includes(input && input.mode) ? input.mode : null,
    projectionAvailable: false, total: null, current: null, gaps: [null, null],
    remaining: null, currentExcess: null, need: [null, null], rates: [null, null],
    final: [null, null], finalTotal: null, support: null, supportRate: null,
    short2: null, credit1: null, creditedTo2: null, excess: null,
    rateKinds: [null, null]
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
  if (input.mode === 'support') checkNumber(input.plannedRate2, 'plannedRate2');
  if (errors.length) return invalid();

  const targets = input.targets;
  const actual = input.current;
  const hours = input.remainingHours;
  const total = targets[0] + targets[1];
  const current = actual[0] + actual[1];
  if (!Number.isFinite(total) || !Number.isFinite(current)) {
    errors.push({ field: 'totals', code: 'overflow' });
    return invalid();
  }
  const gaps = [Math.max(0, targets[0] - actual[0]), Math.max(0, targets[1] - actual[1])];
  const remaining = Math.max(0, total - current);
  const credit1 = Math.max(0, actual[0] - targets[0]);
  const base = {
    valid: true, state: hours > 0 ? 'active' : 'closed', errors: [],
    mode: input.mode, projectionAvailable: hours > 0,
    total, current, gaps, remaining, currentExcess: Math.max(0, current - total),
    need: [null, null], rates: [null, null], final: [null, null], finalTotal: null,
    support: null, supportRate: null, short2: null, credit1,
    creditedTo2: null, excess: null,
    rateKinds: ['required', input.mode === 'support' ? 'planned' : 'required']
  };
  // Keep actual deficits visible at/after midnight. No hypothetical additional
  // feed or final achievement is projected into an already closed period.
  if (hours <= 0) return base;

  let need;
  if (input.mode === 'individual') {
    need = gaps.slice();
  } else if (input.mode === 'combined') {
    const gapTotal = gaps[0] + gaps[1];
    if (remaining === 0) need = [0, 0];
    else if (!(gapTotal > 0) || !Number.isFinite(gapTotal)) {
      errors.push({ field: 'allocation', code: 'invalid-gap-total' });
      return invalid();
    } else {
      const first = Math.max(0, remaining * (gaps[0] / gapTotal));
      // Allocate the residual once so the two amounts conserve the remaining
      // combined target instead of independently rounding two percentages.
      need = [first, Math.max(0, remaining - first)];
    }
  } else {
    const planned2 = input.plannedRate2 * hours;
    if (!Number.isFinite(planned2)) {
      errors.push({ field: 'plannedRate2', code: 'product-overflow' });
      return invalid();
    }
    // Never cap the operator's Unit 2 plan to hide a projected overshoot.
    need = [Math.max(0, remaining - planned2), planned2];
  }
  const final = [actual[0] + need[0], actual[1] + need[1]];
  const finalTotal = final[0] + final[1];
  const rates = [need[0] / hours, input.mode === 'support' ? input.plannedRate2 : need[1] / hours];
  const support = input.mode === 'support' ? Math.max(0, need[0] - gaps[0]) : 0;
  const supportRate = support / hours;
  const short2 = Math.max(0, targets[1] - final[1]);
  const creditedTo2 = input.mode === 'support' ? Math.min(credit1, short2) : 0;
  const excess = Math.max(0, finalTotal - total);
  const derived = [...need, ...final, finalTotal, ...rates, support, supportRate, short2, creditedTo2, excess];
  if (derived.some(value => !Number.isFinite(value) || value < 0)) {
    errors.push({ field: 'derived', code: 'overflow' });
    return invalid();
  }
  return Object.assign(base, { need, rates, final, finalTotal, support, supportRate, short2, creditedTo2, excess });
}

return Object.freeze({ calculate });
}));
