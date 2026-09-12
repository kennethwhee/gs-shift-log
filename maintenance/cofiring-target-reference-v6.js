(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CofiringTargetReferenceV6 = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TARGET_PERCENT = 25;
  const TARGET_SHARE = TARGET_PERCENT / 100;
  const UNIT_IDS = ['unit1', 'unit2'];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const nonnegative = value => finite(value) && value >= 0;
  const positive = value => finite(value) && value > 0;

  function measuredEquivalent(rate, coefficient) {
    if (!positive(coefficient)) return null;
    const value = rate / coefficient;
    return nonnegative(value) ? value : null;
  }

  // This is an advisory steady-average reference, not a feeder command or a
  // deadline/catch-up calculation. Keep the selected period's Coal + Bio heat
  // constant while replacing Coal heat with Bio heat at the target share.
  // quantity is already coefficient-corrected tonnes; calorifics are kcal/kg.
  // Organic/manure are excluded to match the dashboard's Bio denominator.
  function forUnit(unit, durationHours) {
    if (!positive(durationHours) || !unit ||
        unit.coal?.complete === false || unit.bio?.complete === false) return null;
    const coal = unit.coal?.quantity, bio = unit.bio?.quantity;
    const coalCalorific = unit.calorifics?.coal, bioCalorific = unit.calorifics?.bio;
    if (!nonnegative(coal) || !nonnegative(bio) ||
        !positive(coalCalorific) || !positive(bioCalorific)) return null;

    const coalHeat = coal * coalCalorific, bioHeat = bio * bioCalorific;
    const totalHeat = coalHeat + bioHeat;
    if (!positive(totalHeat)) return null;
    const currentBioTonPerHour = bio / durationHours;
    const currentCoalTonPerHour = coal / durationHours;
    const targetBioTonPerHour = totalHeat * TARGET_SHARE / bioCalorific / durationHours;
    const targetCoalTonPerHour = totalHeat * (1 - TARGET_SHARE) / coalCalorific / durationHours;
    const coalBioHeatGcalPerHour = totalHeat / 1000 / durationHours;
    const currentBioPercent = bioHeat / totalHeat * 100;
    if (![currentBioTonPerHour, currentCoalTonPerHour, currentBioPercent].every(nonnegative) ||
        ![targetBioTonPerHour, targetCoalTonPerHour, coalBioHeatGcalPerHour].every(positive)) return null;

    return {
      targetPercent: TARGET_PERCENT,
      durationHours,
      currentBioPercent,
      currentBioTonPerHour,
      targetBioTonPerHour,
      differenceBioTonPerHour: targetBioTonPerHour - currentBioTonPerHour,
      currentCoalTonPerHour,
      targetCoalTonPerHour,
      differenceCoalTonPerHour: targetCoalTonPerHour - currentCoalTonPerHour,
      targetMeasuredBioTonPerHour: measuredEquivalent(targetBioTonPerHour, unit.bio?.coefficient),
      targetMeasuredCoalTonPerHour: measuredEquivalent(targetCoalTonPerHour, unit.coal?.coefficient),
      coalBioHeatGcalPerHour,
      basis: 'selected-period-average-coal-bio-heat',
      quantityBasis: 'coefficient-corrected-tonnes'
    };
  }

  function strictSum(values) {
    if (!values.every(finite)) return null;
    const sum = values.reduce((total, value) => total + value, 0);
    return finite(sum) ? sum : null;
  }

  function fromResult(result) {
    const durationHours = result?.period?.durationHours;
    const units = {};
    for (const id of UNIT_IDS) units[id] = forUnit(result?.units?.[id], durationHours);
    const output = { targetPercent: TARGET_PERCENT, units, combined: null };
    const references = UNIT_IDS.map(id => units[id]);
    if (references.some(reference => reference === null)) return output;

    // Sum each unit's tonnes only after its own calorific conversion. Averaging
    // calorifics or ratios would distort totals when the unit fuel values differ.
    const combined = {
      targetPercent: TARGET_PERCENT,
      durationHours,
      basis: 'selected-period-average-coal-bio-heat',
      quantityBasis: 'coefficient-corrected-tonnes'
    };
    for (const key of ['currentBioTonPerHour', 'targetBioTonPerHour', 'differenceBioTonPerHour',
      'currentCoalTonPerHour', 'targetCoalTonPerHour', 'differenceCoalTonPerHour',
      'coalBioHeatGcalPerHour', 'targetMeasuredBioTonPerHour', 'targetMeasuredCoalTonPerHour']) {
      combined[key] = strictSum(references.map(reference => reference[key]));
      if (combined[key] === null && !key.startsWith('targetMeasured')) return output;
    }
    const bioHeat = strictSum(references.map(reference =>
      reference.coalBioHeatGcalPerHour * (reference.currentBioPercent / 100)));
    if (bioHeat === null || !positive(combined.coalBioHeatGcalPerHour)) return output;
    combined.currentBioPercent = bioHeat / combined.coalBioHeatGcalPerHour * 100;
    if (!nonnegative(combined.currentBioPercent)) return output;
    output.combined = combined;
    return output;
  }

  return Object.freeze({ TARGET_PERCENT, forUnit, fromResult });
}));
