'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const adjustment = require('../maintenance/cofiring-period-adjustment-v56.js');

const units = ['unit1', 'unit2'];
const settings = Object.fromEntries(units.map(unit => [unit, {
  coal: {calorific: 5868}, bio: {calorific: 3237},
  organic: {calorific: 3487}, manure: {calorific: 3487}
}]));
const near = (actual, expected, tolerance = 0.000001) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${actual} must equal ${expected} within ${tolerance}`
);
function base(bio1 = 328.66, bio2 = 0, hours = 17 + 51 / 60) {
  const result = {period: {durationHours: hours}, units: {}, combined: {}};
  for (const [index, unit] of units.entries()) {
    const value = result.units[unit] = {
      coal: {quantity: index === 0 ? 419.061234567 : 582.281234567},
      bio: {quantity: index === 0 ? bio1 : bio2},
      organic: {quantity: 20 + index}, manure: {quantity: 0}, heats: {}
    };
    for (const fuel of ['coal', 'bio', 'organic', 'manure']) {
      value.heats[fuel] = value[fuel].quantity * settings[unit][fuel].calorific / 1000;
    }
    value.heats.total = ['coal', 'bio', 'organic', 'manure'].reduce((sum, fuel) => sum + value.heats[fuel], 0);
  }
  return result;
}
const quantities = result => units.map(unit => result.units[unit].bio.quantity);
const table = result => ({
  finalCoalUnit1: result.units.unit1.coal.quantity,
  finalCoalUnit2: result.units.unit2.coal.quantity,
  finalBioUnit1: result.units.unit1.bio.quantity,
  finalBioUnit2: result.units.unit2.bio.quantity
});
const finalsFor = (index, activeBio, inactiveBio = 0) => index === 0 ? [activeBio, inactiveBio] : [inactiveBio, activeBio];

for (const activeIndex of [0, 1]) {
  for (const [draw, target] of [[0, 361.3], [0.5, 361.35], [1 - Number.EPSILON, 361.4]]) {
    test(`screenshot regression: only unit ${activeIndex + 1} used Bio and target ${target} stays in that unit`, () => {
      const original = base(...finalsFor(activeIndex, 328.66));
      const preserved = structuredClone(original);
      let draws = 0;
      const changed = adjustment.autoMax(original, settings, 361.4, () => { draws++; return draw; });
      assert.equal(changed.ok, true, changed.message);
      assert.equal(draws, 1, 'Only the unit that used Bio needs a target');
      const active = units[activeIndex], inactive = units[1 - activeIndex];
      const expected = adjustment.periodCap(target, original.period.durationHours);
      assert.equal(changed.result.units[active].bio.quantity, expected);
      assert.equal(changed.result.units[inactive].bio.quantity, 0);
      assert.equal(changed.result.units[inactive].coal.quantity, original.units[inactive].coal.quantity,
        'Unused unit Coal must remain exact, including its existing precision');
      assert.deepEqual(changed.adjustment.deltas[inactive], {bioDelta: 0, coalDelta: 0});
      assert.equal(changed.adjustment.fromUnit, null);
      assert.equal(changed.adjustment.bioTransferTons, 0);
      near(changed.adjustment.excludedBioTons, Math.round((328.66 - expected) * 1000) / 1000);
      near(changed.result.units[active].coal.quantity,
        original.units[active].coal.quantity + (328.66 - expected) * 3237 / 5868);
      near(changed.result.units[active].heats.total, original.units[active].heats.total, 0.00001);
      for (const unit of units) for (const fuel of ['organic', 'manure']) {
        assert.deepEqual(changed.result.units[unit][fuel], original.units[unit][fuel]);
      }
      const replay = adjustment.replayAutoMax(original, settings, 361.4, ...quantities(changed.result));
      assert.equal(replay.ok, true, replay.message);
      assert.deepEqual(replay.result, changed.result);
      assert.deepEqual(original, preserved, 'Original measured quantities must not be changed');
    });
  }
}

test('both zero-use units remain zero and need no maximum target draw', () => {
  const original = base(0, 0), preserved = structuredClone(original);
  const changed = adjustment.autoMax(original, settings, 361.4, () => { throw Error('Unexpected target'); });
  assert.equal(changed.ok, false);
  const direct = adjustment.adjustFinal(original, settings, 0, 0);
  assert.equal(direct.ok, true, direct.message);
  assert.deepEqual(quantities(direct.result), [0, 0]);
  for (const unit of units) assert.equal(direct.result.units[unit].coal.quantity, original.units[unit].coal.quantity);
  assert.deepEqual(original, preserved);
});

test('one active unit under its maximum does not change either unit or draw targets', () => {
  for (const finals of [[100, 0], [0, 100]]) {
    const original = base(...finals), preserved = structuredClone(original);
    assert.equal(adjustment.autoMax(original, settings, 361.4, () => { throw Error('Unexpected target'); }).ok, false);
    assert.deepEqual(original, preserved);
  }
});

test('manual transfers cannot bypass an original zero-use unit in either direction', () => {
  for (const finals of [[328.66, 0], [0, 328.66], [0, 0]]) {
    for (const direction of [1, 2]) {
      const changed = adjustment.manualTransfer(base(...finals), settings, direction, 1);
      assert.equal(changed.ok, false);
      assert.match(changed.message, /0톤/);
    }
  }
});

test('direct final edits preserve zero-use units and refuse even sub-rounding positive Bio', () => {
  for (const activeIndex of [0, 1]) {
    const original = base(...finalsFor(activeIndex, 328.66));
    for (const invented of [1, 0.000000000001]) {
      const changed = adjustment.adjustFinal(original, settings, ...finalsFor(activeIndex, 200, invented));
      assert.equal(changed.ok, false);
      assert.match(changed.message, /0톤/);
    }
    const allowed = adjustment.adjustFinal(original, settings, ...finalsFor(activeIndex, 200));
    assert.equal(allowed.ok, true, allowed.message);
    assert.deepEqual(quantities(allowed.result), finalsFor(activeIndex, 200));
  }
});

test('table edits may correct Coal but cannot assign Bio to an unused unit before rounding', () => {
  for (const activeIndex of [0, 1]) {
    const original = base(...finalsFor(activeIndex, 328.66));
    const inactiveNumber = 2 - activeIndex;
    for (const invented of [1, 0.000000000001]) {
      const values = table(original);
      values['finalBioUnit' + inactiveNumber] = invented;
      assert.equal(adjustment.adjustTable(original, settings, values).ok, false);
    }
    const values = table(original);
    values['finalCoalUnit' + inactiveNumber] = 500;
    const changed = adjustment.adjustTable(original, settings, values);
    assert.equal(changed.ok, true, changed.message);
    assert.equal(changed.result.units[units[1 - activeIndex]].bio.quantity, 0);
    assert.equal(changed.result.units[units[1 - activeIndex]].coal.quantity, 500);
    assert.equal(adjustment.editTableValue(original, settings, original, units[1 - activeIndex], 'bio', 1).ok, false);
    assert.equal(adjustment.editTableValue(original, settings, original, units[1 - activeIndex], 'coal', 500).ok, true);
  }
});

test('saved adjustment paths refuse old redistributions into a zero-use unit', () => {
  for (const activeIndex of [0, 1]) {
    const original = base(...finalsFor(activeIndex, 328.66));
    const [finalBioUnit1, finalBioUnit2] = finalsFor(activeIndex, 268.76, 59.9);
    for (const mode of ['max_auto', 'manual_transfer', 'manual_final', 'manual_table']) {
      const saved = {...table(original), mode, finalBioUnit1, finalBioUnit2, maxBioTpd: 361.4};
      assert.equal(adjustment.resolveAdjustment(original, settings, saved).ok, false, mode);
      assert.equal(adjustment.resolveAdjustment(original, settings, {...saved, meta: {...saved}}).ok, false, mode + ' local metadata');
    }
    assert.equal(adjustment.replayAutoMax(original, settings, 361.4, finalBioUnit1, finalBioUnit2).ok, false);
    assert.equal(adjustment.replayAutoMax(original, settings, 361.4, ...finalsFor(activeIndex, 268.76, 0.000000000001)).ok, false,
      'Replay tolerance must not authorize positive Bio at the unused unit');
  }
});

test('local stored old redistribution is ignored while a valid zero-preserving saved edit reloads', () => {
  const original = base(), spec = {startLocal: '2026-10-21T00:00', endLocal: '2026-10-21T17:51'};
  const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
  const fingerprint = JSON.stringify([spec.startLocal, spec.endLocal,
    round(original.units.unit1.coal.quantity), round(original.units.unit1.bio.quantity),
    round(original.units.unit2.coal.quantity), round(original.units.unit2.bio.quantity)]);
  let saved = {fingerprint, finalBioUnit1: 268.76, finalBioUnit2: 59.9, meta: {mode: 'max_auto'}};
  const sandbox = {module: {exports: {}}, localStorage: {getItem: () => JSON.stringify(saved)}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../maintenance/cofiring-period-adjustment-v56.js'), 'utf8'), sandbox);
  assert.equal(sandbox.module.exports.resolveStored(original, settings, spec), null);
  saved = {...saved, finalBioUnit2: 0};
  const restored = sandbox.module.exports.resolveStored(original, settings, spec);
  assert.equal(restored.ok, true);
  assert.equal(restored.result.units.unit2.bio.quantity, 0);
});

test('missing, malformed and nonfinite Bio quantities are not interpreted as inactive zero', () => {
  for (const value of [null, undefined, NaN, Infinity, '0']) {
    for (const missingIndex of [0, 1]) {
      const original = base(328.66, 328.66);
      original.units[units[missingIndex]].bio.quantity = value;
      assert.equal(adjustment.autoMax(original, settings, 361.4, () => { throw Error('Unexpected target'); }).ok, false);
      assert.equal(adjustment.adjustFinal(original, settings, 200, 0).ok, false);
    }
  }
});

test('any strictly positive original Bio use remains eligible for redistribution', () => {
  for (const recipientIndex of [0, 1]) {
    const original = base(...finalsFor(1 - recipientIndex, 500, 0.000000000001), 24);
    let draws = 0;
    const changed = adjustment.autoMax(original, settings, 361.4, () => { draws++; return 0; });
    assert.equal(changed.ok, true, changed.message);
    assert.equal(draws, 2);
    assert.ok(changed.result.units[units[recipientIndex]].bio.quantity > 100);
    assert.ok(changed.adjustment.bioTransferTons > 0);
    assert.equal(adjustment.manualTransfer(original, settings, 2 - recipientIndex, 1).ok, true);
  }
});

test('both active units retain their independent random band and ordinary transfer behavior', () => {
  const original = base(450, 400, 24), draws = [0, 1 - Number.EPSILON];
  const changed = adjustment.autoMax(original, settings, 361.4, () => draws.shift());
  assert.equal(changed.ok, true, changed.message);
  assert.deepEqual(quantities(changed.result), [361.3, 361.4]);
  const transfer = adjustment.manualTransfer(base(400, 200, 24), settings, 1, 10);
  assert.equal(transfer.ok, true, transfer.message);
  assert.deepEqual(quantities(transfer.result), [390, 210]);
});
