'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const adjustment = require('../maintenance/cofiring-period-adjustment-v56.js');
const settings = Object.fromEntries(['unit1', 'unit2'].map(unit => [unit, {
  coal: {calorific: 5868}, bio: {calorific: 3237}, organic: {calorific: 3487}, manure: {calorific: 3487}
}]));
function base(hours, one = 328.66, two = 0) {
  return {period: {durationHours: hours}, units: {
    unit1: {coal: {quantity: 419.06}, bio: {quantity: one}, organic: {quantity: 20}, manure: {quantity: 0}, heats: {}},
    unit2: {coal: {quantity: 582.28}, bio: {quantity: two}, organic: {quantity: 20}, manure: {quantity: 0}, heats: {}}
  }, combined: {}};
}
const quantities = result => [result.units.unit1.bio.quantity, result.units.unit2.bio.quantity];
const noRandom = () => { throw Error('A maximum that was not exceeded must not draw targets'); };

for (const hours of [1 / 60, 0.5, 12, 17 + 51 / 60, 24]) {
  test(`${hours} hours keeps the full 361.4t daily threshold and leaves screenshot quantities unchanged`, () => {
    assert.equal(adjustment.periodCap(361.4, hours), 361.4);
    for (const values of [[328.66, 0], [0, 328.66], [361.4, 361.35], [361.4, 361.4], [0, 0]]) {
      const original = base(hours, ...values), before = structuredClone(original);
      const changed = adjustment.autoMax(original, settings, 361.4, noRandom);
      assert.equal(changed.ok, false);
      assert.match(changed.message, /이하이므로 조정하지 않습니다/);
      assert.deepEqual(original, before);
    }
  });
}

test('the configured daily maximum is not rounded down before the trigger comparison', () => {
  const maximum = 361.1492;
  for (const hours of [12, 24]) {
    assert.equal(adjustment.periodCap(maximum, hours), maximum);
    assert.equal(adjustment.autoMax(base(hours, maximum, 361.1491), settings, maximum, noRandom).ok, false);
  }
});

test('above-threshold partial-day Bio adjusts to the full daily band without populating the unused unit', () => {
  for (const values of [[400, 0], [0, 400]]) {
    const original = base(17 + 51 / 60, ...values);
    const changed = adjustment.autoMax(original, settings, 361.4, () => 0);
    assert.equal(changed.ok, true, changed.message);
    assert.deepEqual(quantities(changed.result), values[0] ? [361.3, 0] : [0, 361.3]);
    assert.equal(changed.adjustment.periodCapTons, 361.4);
    assert.equal(changed.adjustment.excludedBioTons, 38.7);
    assert.equal(changed.adjustment.bioTransferTons, 0);
    const replayed = adjustment.replayAutoMax(original, settings, 361.4, ...quantities(changed.result));
    assert.equal(replayed.ok, true, replayed.message);
    assert.deepEqual(replayed.result, changed.result);
  }
});

test('a unit already at or below the maximum is never reduced by the sampled band when its peer exceeds the maximum', () => {
  for (const values of [[361.35, 450], [450, 361.35], [361.4, 450], [450, 361.4]]) {
    const original = base(17 + 51 / 60, ...values), underIndex = values[0] <= 361.4 ? 0 : 1;
    for (const draw of [0, 1 - Number.EPSILON]) {
      const changed = adjustment.autoMax(original, settings, 361.4, () => draw);
      assert.equal(changed.ok, true, changed.message);
      assert.ok(quantities(changed.result)[underIndex] >= values[underIndex]);
      const replayed = adjustment.replayAutoMax(original, settings, 361.4, ...quantities(changed.result));
      assert.equal(replayed.ok, true, replayed.message);
      assert.deepEqual(replayed.result, changed.result);
    }
    const lowered = [361.3, 361.3];
    assert.equal(adjustment.replayAutoMax(original, settings, 361.4, ...lowered).ok, false,
      'A saved band result cannot lower the unit that was already under the configured maximum');
  }
});

test('an unchanged under-limit peer retains its original Bio and Coal precision', () => {
  for (const values of [[361.3500000123, 450], [450, 361.3500000123]]) {
    const original = base(17.85, ...values), underUnit = values[0] < 361.4 ? 'unit1' : 'unit2';
    original.units[underUnit].coal.quantity = 419.0612345678;
    const changed = adjustment.autoMax(original, settings, 361.4, () => 0);
    assert.equal(changed.ok, true, changed.message);
    assert.equal(changed.result.units[underUnit].bio.quantity, original.units[underUnit].bio.quantity);
    assert.equal(changed.result.units[underUnit].coal.quantity, original.units[underUnit].coal.quantity);
  }
});

test('obsolete partial-day automatic reductions are rejected on replay and saved-value resolution', () => {
  for (const values of [[328.66, 0], [0, 328.66], [328.66, 100]]) {
    const original = base(17 + 51 / 60, ...values);
    const saved = {mode: 'max_auto', maxBioTpd: 361.4,
      finalBioUnit1: values[0] ? 268.73 : 0, finalBioUnit2: values[1] ? Math.min(values[1], 268.73) : 0};
    assert.equal(adjustment.replayAutoMax(original, settings, saved.maxBioTpd, saved.finalBioUnit1, saved.finalBioUnit2).ok, false);
    assert.equal(adjustment.resolveAdjustment(original, settings, saved).ok, false);
    assert.equal(adjustment.resolveAdjustment(original, settings, {...saved, meta: {...saved}}).ok, false);
  }
  const original = base(12, 150, 50);
  assert.equal(adjustment.replayAutoMax(original, settings, 240, 120, 80).ok, false);
});

test('obsolete proportionally reduced targets are also rejected when actual partial-day Bio exceeds the daily maximum', () => {
  const original = base(17 + 51 / 60, 400, 0);
  const saved = {mode: 'max_auto', maxBioTpd: 361.4, finalBioUnit1: 268.73, finalBioUnit2: 0};
  assert.equal(adjustment.replayAutoMax(original, settings, 361.4, 268.73, 0).ok, false);
  assert.equal(adjustment.resolveAdjustment(original, settings, saved).ok, false);
});

test('longer selected periods retain the previous proportional thresholds and replay behavior', () => {
  for (const hours of [24 + 1 / 60, 48, 72]) {
    const expected = Math.round((361.4 * hours / 24 + Number.EPSILON) * 1000) / 1000;
    assert.equal(adjustment.periodCap(361.4, hours), expected);
    const original = base(hours, expected + 100, 0);
    const changed = adjustment.autoMax(original, settings, 361.4, () => 0);
    assert.equal(changed.ok, true, changed.message);
    assert.equal(changed.adjustment.periodCapTons, expected);
    assert.equal(changed.result.units.unit1.bio.quantity, adjustment.periodCap(361.3, hours));
    assert.equal(changed.result.units.unit2.bio.quantity, 0);
    assert.equal(adjustment.replayAutoMax(original, settings, 361.4, ...quantities(changed.result)).ok, true);
  }
});
