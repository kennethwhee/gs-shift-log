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

  // COFIRING_TOTAL_HEAT_BASIS_V2_R3: advisory target uses total fuel heat; organic/manure stay fixed while Coal/Bio are rebalanced.
  function forUnit(unit, durationHours) {
    if (!positive(durationHours) || !unit ||
        unit.coal?.complete === false || unit.bio?.complete === false ||
        unit.organic?.complete === false || unit.manure?.complete === false) return null;
    const coal = unit.coal?.quantity, bio = unit.bio?.quantity, organic = unit.organic?.quantity, manure = unit.manure?.quantity;
    const coalCalorific = unit.calorifics?.coal, bioCalorific = unit.calorifics?.bio,
      organicCalorific = unit.calorifics?.organic, manureCalorific = unit.calorifics?.manure;
    if (![coal,bio,organic,manure].every(nonnegative) ||
        ![coalCalorific,bioCalorific,organicCalorific,manureCalorific].every(positive)) return null;

    const coalHeat = coal * coalCalorific, bioHeat = bio * bioCalorific,
      organicHeat = organic * organicCalorific, manureHeat = manure * manureCalorific;
    const fixedHeat = organicHeat + manureHeat, totalHeat = coalHeat + bioHeat + fixedHeat;
    if (!positive(totalHeat)) return null;
    const targetBioHeat = totalHeat * TARGET_SHARE;
    const targetCoalHeat = totalHeat - fixedHeat - targetBioHeat;
    if (targetCoalHeat < -1e-10) return null;
    const currentBioTonPerHour = bio / durationHours;
    const currentCoalTonPerHour = coal / durationHours;
    const targetBioTonPerHour = targetBioHeat / bioCalorific / durationHours;
    const targetCoalTonPerHour = Math.max(0, targetCoalHeat) / coalCalorific / durationHours;
    const totalFuelHeatGcalPerHour = totalHeat / 1000 / durationHours;
    const currentBioPercent = bioHeat / totalHeat * 100;
    if (![currentBioTonPerHour,currentCoalTonPerHour,currentBioPercent,targetBioTonPerHour,targetCoalTonPerHour,totalFuelHeatGcalPerHour].every(nonnegative)) return null;

    return {
      targetPercent: TARGET_PERCENT, durationHours, currentBioPercent, currentBioTonPerHour, targetBioTonPerHour,
      differenceBioTonPerHour: targetBioTonPerHour-currentBioTonPerHour, currentCoalTonPerHour, targetCoalTonPerHour,
      differenceCoalTonPerHour: targetCoalTonPerHour-currentCoalTonPerHour,
      targetMeasuredBioTonPerHour: measuredEquivalent(targetBioTonPerHour,unit.bio?.coefficient),
      targetMeasuredCoalTonPerHour: measuredEquivalent(targetCoalTonPerHour,unit.coal?.coefficient),
      totalFuelHeatGcalPerHour, coalBioHeatGcalPerHour: totalFuelHeatGcalPerHour,
      basis: 'selected-period-average-total-fuel-heat', quantityBasis: 'coefficient-corrected-tonnes'
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
      basis: 'selected-period-average-total-fuel-heat',
      quantityBasis: 'coefficient-corrected-tonnes'
    };
    for (const key of ['currentBioTonPerHour', 'targetBioTonPerHour', 'differenceBioTonPerHour',
      'currentCoalTonPerHour', 'targetCoalTonPerHour', 'differenceCoalTonPerHour',
      'coalBioHeatGcalPerHour', 'totalFuelHeatGcalPerHour', 'targetMeasuredBioTonPerHour', 'targetMeasuredCoalTonPerHour']) {
      combined[key] = strictSum(references.map(reference => reference[key]));
      if (combined[key] === null && !key.startsWith('targetMeasured')) return output;
    }
    const bioHeat = strictSum(references.map(reference =>
      reference.totalFuelHeatGcalPerHour * (reference.currentBioPercent / 100)));
    if (bioHeat === null || !positive(combined.totalFuelHeatGcalPerHour)) return output;
    combined.currentBioPercent = bioHeat / combined.totalFuelHeatGcalPerHour * 100;
    if (!nonnegative(combined.currentBioPercent)) return output;
    output.combined = combined;
    return output;
  }

  return Object.freeze({ TARGET_PERCENT, forUnit, fromResult });
}));
