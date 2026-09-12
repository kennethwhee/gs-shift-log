'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const target = require('../maintenance/cofiring-target-reference-v6.js');
const adjustment = require('../maintenance/cofiring-period-adjustment-v56.js');

const near = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to equal ${expected} within ${tolerance}`);
};
function unit(coal = 120, bio = 40, coalCalorific = 6000, bioCalorific = 3000,
  coalCoefficient = 1, bioCoefficient = 1) {
  return {
    coal: {quantity: coal, measuredQuantity: coal / coalCoefficient, coefficient: coalCoefficient, complete: true},
    bio: {quantity: bio, measuredQuantity: bio / bioCoefficient, coefficient: bioCoefficient, complete: true},
    organic: {quantity: 10, complete: true}, manure: {quantity: 2, complete: true},
    calorifics: {coal: coalCalorific, bio: bioCalorific, organic: 3000, manure: 3000}
  };
}
function verifyTargetHeat(input, reference) {
  const originalHeat = (input.coal.quantity * input.calorifics.coal + input.bio.quantity * input.calorifics.bio) / reference.durationHours;
  const targetBioHeat = reference.targetBioTonPerHour * input.calorifics.bio;
  const targetCoalHeat = reference.targetCoalTonPerHour * input.calorifics.coal;
  near(targetCoalHeat + targetBioHeat, originalHeat, 1e-7);
  near(targetBioHeat / (targetCoalHeat + targetBioHeat) * 100, 25);
  near(reference.coalBioHeatGcalPerHour, originalHeat / 1000);
}

test('25% target holds selected-period heat constant and substitutes Coal at unequal calorific values', () => {
  const input = unit(), reference = target.forUnit(input, 4);
  assert.equal(target.TARGET_PERCENT, 25);
  near(reference.currentBioTonPerHour, 10);
  near(reference.currentCoalTonPerHour, 30);
  near(reference.targetBioTonPerHour, 17.5);
  near(reference.targetCoalTonPerHour, 26.25);
  near(reference.differenceBioTonPerHour, 7.5);
  near(reference.differenceCoalTonPerHour, -3.75);
  verifyTargetHeat(input, reference);
});

test('above-target input yields a negative Bio difference and a positive Coal difference', () => {
  const input = unit(60, 120), reference = target.forUnit(input, 6);
  near(reference.currentBioPercent, 50);
  near(reference.targetBioTonPerHour, 10);
  near(reference.differenceBioTonPerHour, -10);
  near(reference.differenceCoalTonPerHour, 5);
  verifyTargetHeat(input, reference);
});

test('a period already at 25% has zero hourly differences', () => {
  const reference = target.forUnit(unit(90, 60), 3);
  near(reference.currentBioPercent, 25);
  near(reference.differenceBioTonPerHour, 0);
  near(reference.differenceCoalTonPerHour, 0);
});

test('corrected quantities are not multiplied by coefficients twice; measured equivalents divide once', () => {
  const reference = target.forUnit(unit(120, 40, 6000, 3000, 1.25, 0.8), 4);
  near(reference.targetBioTonPerHour, 17.5);
  near(reference.currentBioTonPerHour, 10);
  near(reference.targetMeasuredBioTonPerHour, 21.875);
  near(reference.targetMeasuredCoalTonPerHour, 21);
  assert.equal(reference.quantityBasis, 'coefficient-corrected-tonnes');
});

test('duration is in hours, including short periods, without a daily or future-time assumption', () => {
  const hourly = target.forUnit(unit(), 1), halfHour = target.forUnit(unit(), 0.5);
  near(halfHour.currentBioTonPerHour, hourly.currentBioTonPerHour * 2);
  near(halfHour.targetBioTonPerHour, hourly.targetBioTonPerHour * 2);
  near(halfHour.currentBioPercent, hourly.currentBioPercent);
  assert.equal(halfHour.basis, 'selected-period-average-coal-bio-heat');
});

test('organic and manure cannot change the Coal+Bio target or suppress a valid reference', () => {
  const input = unit(), original = target.forUnit(input, 4);
  input.organic = {quantity: 1e8, complete: false};
  input.manure = {quantity: null, complete: false};
  input.calorifics.organic = 8000;
  input.calorifics.manure = null;
  input.heats = {coal: null, bio: null, organic: 1e20, manure: null, total: 1e20};
  assert.deepEqual(target.forUnit(input, 4), original);
});

test('missing, blank, negative or non-finite fuel values and invalid durations do not become zero', () => {
  for (const value of [undefined, null, '', '0', false, -1, NaN, Infinity, -Infinity]) {
    for (const fuel of ['coal', 'bio']) {
      const input = unit(); input[fuel].quantity = value;
      assert.equal(target.forUnit(input, 4), null, `${fuel} quantity ${String(value)}`);
    }
  }
  for (const hours of [undefined, null, '', '4', 0, -1, NaN, Infinity]) {
    assert.equal(target.forUnit(unit(), hours), null, `duration ${String(hours)}`);
  }
  assert.equal(target.forUnit(null, 4), null);
  assert.equal(target.forUnit({}, 4), null);
});

test('missing calorifics, incomplete fuel counters, zero heat and overflow do not display a target', () => {
  for (const value of [undefined, null, '', '3000', 0, -1, NaN, Infinity]) {
    for (const fuel of ['coal', 'bio']) {
      const input = unit(); input.calorifics[fuel] = value;
      assert.equal(target.forUnit(input, 4), null, `${fuel} calorific ${String(value)}`);
    }
  }
  for (const fuel of ['coal', 'bio']) {
    const input = unit(); input[fuel].complete = false;
    assert.equal(target.forUnit(input, 4), null);
  }
  assert.equal(target.forUnit(unit(0, 0), 4), null);
  assert.equal(target.forUnit(unit(Number.MAX_VALUE, 40), 4), null);
  assert.equal(target.forUnit(unit(), Number.MIN_VALUE), null);
});

test('a validated zero Bio or zero Coal input is usable when the other fuel provides heat', () => {
  for (const input of [unit(120, 0), unit(0, 40)]) {
    const reference = target.forUnit(input, 4);
    assert.ok(reference);
    verifyTargetHeat(input, reference);
  }
});

test('unknown coefficients hide only the optional measured equivalent and never assume one', () => {
  for (const coefficient of [undefined, null, '', '1', 0, -1, NaN, Infinity, Number.MIN_VALUE]) {
    const input = unit(); input.bio.coefficient = coefficient;
    const reference = target.forUnit(input, 4);
    near(reference.targetBioTonPerHour, 17.5);
    assert.equal(reference.targetMeasuredBioTonPerHour, null);
    near(reference.targetMeasuredCoalTonPerHour, 26.25);
  }
});

test('combined references sum independent unit targets and use heat-weighted ratios', () => {
  const input = {period: {durationHours: 4}, units: {
    unit1: unit(), unit2: unit(60, 30, 5000, 2500, 1, 0.5)
  }};
  const original = structuredClone(input), result = target.fromResult(input);
  near(result.units.unit2.targetBioTonPerHour, 9.375);
  near(result.combined.targetBioTonPerHour, 26.875);
  near(result.combined.targetMeasuredBioTonPerHour, 36.25);
  near(result.combined.currentBioPercent, (120000 + 75000) / (840000 + 375000) * 100);
  const simpleRatio = (result.units.unit1.currentBioPercent + result.units.unit2.currentBioPercent) / 2;
  assert.ok(Math.abs(result.combined.currentBioPercent - simpleRatio) > 0.1);
  assert.deepEqual(input, original);
});

test('one invalid unit suppresses only its reference and the aggregate; optional equivalents remain strict', () => {
  const input = {period: {durationHours: 4}, units: {unit1: unit(), unit2: unit()}};
  input.units.unit2.bio.quantity = null;
  let output = target.fromResult(input);
  assert.ok(output.units.unit1);
  assert.equal(output.units.unit2, null);
  assert.equal(output.combined, null);
  input.units.unit2 = unit(); delete input.units.unit2.bio.coefficient;
  output = target.fromResult(input);
  near(output.combined.targetBioTonPerHour, 35);
  assert.equal(output.combined.targetMeasuredBioTonPerHour, null);
  assert.deepEqual(target.fromResult(null), {targetPercent: 25, units: {unit1: null, unit2: null}, combined: null});
});

test('an adjusted result uses its displayed corrected quantities while preserving the original heat target', () => {
  const input = {period: {durationHours: 4}, units: {unit1: unit(), unit2: unit()}};
  const settings = Object.fromEntries(['unit1', 'unit2'].map(id => [id,
    Object.fromEntries(Object.entries(input.units[id].calorifics).map(([fuel, calorific]) => [fuel, {calorific}]))]));
  const original = structuredClone(input), before = target.fromResult(input);
  const changed = adjustment.adjustFinal(input, settings, 20, 30);
  assert.equal(changed.ok, true, changed.message);
  const after = target.fromResult(changed.result);
  near(after.units.unit1.currentBioTonPerHour, 5);
  near(after.units.unit1.targetBioTonPerHour, before.units.unit1.targetBioTonPerHour);
  near(after.units.unit1.differenceBioTonPerHour, 12.5);
  assert.deepEqual(input, original);
});

test('browser and CommonJS exports expose the same pure API', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../maintenance/cofiring-target-reference-v6.js'), 'utf8'), context);
  assert.equal(context.CofiringTargetReferenceV6.TARGET_PERCENT, 25);
  near(context.CofiringTargetReferenceV6.forUnit(unit(), 4).targetBioTonPerHour, 17.5);
  assert.deepEqual(Object.keys(context.CofiringTargetReferenceV6).sort(), Object.keys(target).sort());
});
