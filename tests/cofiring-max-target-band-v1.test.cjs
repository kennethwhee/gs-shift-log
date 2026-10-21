'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const adjustment = require('../maintenance/cofiring-period-adjustment-v56.js');

const UNITS = ['unit1', 'unit2'];
const FUELS = ['coal', 'bio', 'organic', 'manure'];
const settings = {
  unit1: {coal: {calorific: 5868}, bio: {calorific: 3237}, organic: {calorific: 3487}, manure: {calorific: 3100}},
  unit2: {coal: {calorific: 5700}, bio: {calorific: 3000}, organic: {calorific: 3300}, manure: {calorific: 2900}}
};
const near = (actual, expected, tolerance = 0.000001) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${actual} must equal ${expected} within ${tolerance}`
);
const quantities = result => UNITS.map(unit => result.units[unit].bio.quantity);
const bioTotal = result => quantities(result).reduce((sum, value) => sum + value, 0);
function base(hours = 24, bio1 = 450, bio2 = 400) {
  const result = {period: {durationHours: hours}, units: {}, combined: {}};
  for (const [index, unit] of UNITS.entries()) {
    const value = result.units[unit] = {
      coal: {quantity: index === 0 ? 600.123456 : 650.654321},
      bio: {quantity: index === 0 ? bio1 : bio2},
      organic: {quantity: index === 0 ? 30.123456 : 12.654321},
      manure: {quantity: index === 0 ? 7.123456 : 3.654321},
      heats: {}
    };
    for (const fuel of FUELS) value.heats[fuel] = value[fuel].quantity * settings[unit][fuel].calorific / 1000;
    value.heats.total = FUELS.reduce((sum, fuel) => sum + value.heats[fuel], 0);
  }
  return result;
}
function sequence(...values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'The engine must only draw the supplied targets');
    return values[index++];
  };
}
function verifyPhysicalContracts(original, changed) {
  assert.equal(changed.ok, true, changed.message);
  const result = changed.result;
  for (const unit of UNITS) {
    const before = original.units[unit], after = result.units[unit];
    for (const fuel of ['organic', 'manure']) assert.deepEqual(after[fuel], before[fuel]);
    near(after.coal.quantity, before.coal.quantity +
      (before.bio.quantity - after.bio.quantity) * settings[unit].bio.calorific / settings[unit].coal.calorific);
    near(after.heats.total, before.heats.total, 0.00001);
    for (const fuel of FUELS) near(after.heats[fuel], after[fuel].quantity * settings[unit][fuel].calorific / 1000, 0.00000001);
    near(after.fuelRatios.bio, after.heats.bio / after.heats.total * 100, 0.00000001);
    near(after.fuelRatios.organicGroup, (after.heats.organic + after.heats.manure) / after.heats.total * 100, 0.00000001);
    near(after.fuelRatios.total, (after.heats.bio + after.heats.organic + after.heats.manure) / after.heats.total * 100, 0.00000001);
  }
  for (const fuel of [...FUELS, 'total']) near(result.combined.heats[fuel],
    result.units.unit1.heats[fuel] + result.units.unit2.heats[fuel], 0.00000001);
  near(result.combined.fuelRatios.total,
    (result.combined.heats.bio + result.combined.heats.organic + result.combined.heats.manure) /
    result.combined.heats.total * 100, 0.00000001);
  assert.ok(bioTotal(result) <= bioTotal(original) + 0.000002, 'Adjustment must not invent Bio');
  assert.equal(changed.adjustment.excludedBioTons,
    Math.round(Math.max(0, bioTotal(original) - bioTotal(result)) * 1000) / 1000);
}

test('daily maximum 361.40 includes both 361.30 and 361.40 and draws each unit independently', () => {
  const original = base(), preserved = structuredClone(original);
  const changed = adjustment.autoMax(original, settings, 361.4, sequence(0, 1 - Number.EPSILON));
  verifyPhysicalContracts(original, changed);
  assert.deepEqual(quantities(changed.result), [361.3, 361.4]);
  assert.equal(changed.adjustment.maxBioTpd, 361.4);
  assert.equal(changed.adjustment.periodCapTons, 361.4);
  assert.equal(changed.adjustment.mode, 'max_auto');
  assert.equal(changed.adjustment.applied, true);
  assert.deepEqual(original, preserved);
});

test('the complete daily target band uses two-decimal 0.01 t/d steps', () => {
  const seen = new Set();
  for (let index = 0; index <= 10; index++) {
    const draw = (index + 0.5) / 11;
    const changed = adjustment.autoMax(base(), settings, 361.4, () => draw);
    assert.equal(changed.ok, true, changed.message);
    const value = changed.result.units.unit1.bio.quantity;
    assert.ok(value >= 361.3 && value <= 361.4);
    near(value * 100, Math.round(value * 100), 0.00000001);
    seen.add(value.toFixed(2));
  }
  assert.equal(seen.size, 11, 'All eleven cent-ton targets must be selectable');
});

test('a fresh preview can change targets while a replay preserves the selected targets', () => {
  const original = base();
  const low = adjustment.autoMax(original, settings, 361.4, () => 0);
  const high = adjustment.autoMax(original, settings, 361.4, () => 1 - Number.EPSILON);
  assert.notDeepEqual(quantities(low.result), quantities(high.result));
  for (const preview of [low, high]) {
    const replayed = adjustment.replayAutoMax(original, settings, 361.4, ...quantities(preview.result));
    assert.equal(replayed.ok, true, replayed.message);
    assert.deepEqual(replayed.result, preview.result);
    assert.deepEqual(replayed.adjustment, preview.adjustment);
  }
});

test('original quantities under the configured maximum remain unchanged without drawing', () => {
  const original = base(24, 361.35, 120), preserved = structuredClone(original);
  const unchanged = adjustment.autoMax(original, settings, 361.4, () => { throw Error('Unexpected target draw'); });
  assert.equal(unchanged.ok, false);
  assert.deepEqual(original, preserved);
});

test('integer maximum values retain a 0.10 t/d band', () => {
  const changed = adjustment.autoMax(base(), settings, 361, sequence(0, 1 - Number.EPSILON));
  verifyPhysicalContracts(base(), changed);
  assert.deepEqual(quantities(changed.result), [360.9, 361]);
});

test('a small positive maximum cannot produce negative or over-maximum targets', () => {
  for (const draw of [0, 0.5, 1 - Number.EPSILON]) {
    const original = base(24, 1, 1);
    const changed = adjustment.autoMax(original, settings, 0.05, () => draw);
    verifyPhysicalContracts(original, changed);
    for (const value of quantities(changed.result)) assert.ok(value >= 0 && value <= 0.05);
  }
});

test('fractional configured maxima never round selected targets above the maximum', () => {
  const changed = adjustment.autoMax(base(), settings, 361.1492, () => 1 - Number.EPSILON);
  assert.equal(changed.ok, true, changed.message);
  for (const value of quantities(changed.result)) {
    assert.ok(value <= 361.1492);
    near(value * 100, Math.round(value * 100), 0.00000001);
  }
});

for (const hours of [12, 48, 24 + 1 / 60]) {
  test(`daily target band uses a full-day minimum for the ${hours}-hour selected period`, () => {
    const original = base(hours, 1000, 1000);
    const changed = adjustment.autoMax(original, settings, 361.4, sequence(0, 1 - Number.EPSILON));
    verifyPhysicalContracts(original, changed);
    assert.deepEqual(quantities(changed.result), [adjustment.periodCap(361.3, hours), adjustment.periodCap(361.4, hours)]);
    assert.equal(changed.adjustment.periodCapTons, adjustment.periodCap(361.4, hours));
    const replayed = adjustment.replayAutoMax(original, settings, 361.4, ...quantities(changed.result));
    assert.equal(replayed.ok, true, replayed.message);
    assert.deepEqual(replayed.result, changed.result);
  });
}

test('unit 1 excess moves to unit 2 before exclusion and preserves exact total', () => {
  const original = base(24, 500.123456, 100.654321);
  const changed = adjustment.autoMax(original, settings, 361.4, () => 0);
  verifyPhysicalContracts(original, changed);
  near(changed.result.units.unit1.bio.quantity, 361.3);
  near(changed.result.units.unit2.bio.quantity, 239.477777);
  near(bioTotal(changed.result), bioTotal(original));
  assert.equal(changed.adjustment.excludedBioTons, 0);
  assert.equal(changed.adjustment.fromUnit, 1);
  assert.equal(changed.adjustment.bioTransferTons, 138.823);
  const replayed = adjustment.replayAutoMax(original, settings, 361.4, ...quantities(changed.result));
  assert.deepEqual(replayed.result, changed.result);
});

test('unit 2 excess moves in the reverse direction with each unit calorific value', () => {
  const original = base(24, 100.654321, 500.123456);
  const changed = adjustment.autoMax(original, settings, 361.4, () => 0);
  verifyPhysicalContracts(original, changed);
  near(changed.result.units.unit1.bio.quantity, 239.477777);
  near(changed.result.units.unit2.bio.quantity, 361.3);
  near(bioTotal(changed.result), bioTotal(original));
  assert.equal(changed.adjustment.fromUnit, 2);
  assert.equal(changed.adjustment.excludedBioTons, 0);
  assert.deepEqual(adjustment.replayAutoMax(original, settings, 361.4, ...quantities(changed.result)).result, changed.result);
});

test('both saturated units record only the excess not accepted by the chosen targets', () => {
  const original = base(24, 400, 500);
  const changed = adjustment.autoMax(original, settings, 361.4, sequence(0, 1 - Number.EPSILON));
  verifyPhysicalContracts(original, changed);
  assert.deepEqual(quantities(changed.result), [361.3, 361.4]);
  assert.equal(changed.adjustment.excludedBioTons, 177.3);
});

test('replay accepts exact-cap daily and longer-period adjustments', () => {
  for (const [hours, maximum, b1, b2, final1, final2] of [
    [24, 361.4, 450, 400, 361.4, 361.4],
    [48, 240, 600, 100, 480, 220],
    [24, 361.1492, 450, 400, 361.149, 361.149]
  ]) {
    const original = base(hours, b1, b2);
    const replayed = adjustment.replayAutoMax(original, settings, maximum, final1, final2);
    verifyPhysicalContracts(original, replayed);
    assert.deepEqual(quantities(replayed.result), [final1, final2]);
  }
});

test('replay rejects out-of-band, invented, or incorrectly redistributed final quantities', () => {
  const saturated = base(24, 450, 400);
  for (const finals of [[361.29, 361.4], [361.41, 361.3], [-1, 361.3], [null, 361.3], [NaN, 361.3], [361.3, Infinity]]) {
    assert.equal(adjustment.replayAutoMax(saturated, settings, 361.4, ...finals).ok, false, JSON.stringify(finals));
  }
  const transferable = base(24, 500, 100);
  assert.equal(adjustment.replayAutoMax(transferable, settings, 361.4, 361.3, 238.69).ok, false,
    'A recipient below the band must receive all transferable Bio');
  assert.equal(adjustment.replayAutoMax(transferable, settings, 361.4, 361.3, 361.3).ok, false,
    'Final total must not exceed measured Bio');
});

test('a saved shared adjustment reloads the selected finals without drawing new targets', async t => {
  const original = base(), preview = adjustment.autoMax(original, settings, 361.4, sequence(0.2, 0.8));
  const previousFetch = globalThis.fetch, previousStorage = globalThis.localStorage, previousRandom = Math.random;
  t.after(() => { globalThis.fetch = previousFetch; globalThis.localStorage = previousStorage; Math.random = previousRandom; });
  const store = new Map();
  globalThis.localStorage = {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key)};
  globalThis.fetch = async () => ({ok: true, json: async () => ({ok: true,
    start: '2026-10-16T00:00', end: '2026-10-17T00:00', revision: 7,
    adjustment: {...preview.adjustment, finalBioUnit1: preview.result.units.unit1.bio.quantity,
      finalBioUnit2: preview.result.units.unit2.bio.quantity}, setting: {maxBioTpd: 361.4}})});
  Math.random = () => { throw Error('Reload must not randomize saved targets'); };
  const spec = {startLocal: '2026-10-16T00:00', endLocal: '2026-10-17T00:00'};
  const loaded = await adjustment.resolveServer(original, settings, spec, () => ({}));
  assert.equal(loaded.loaded, true, loaded.error);
  assert.equal(loaded.adjusted, true);
  assert.deepEqual(loaded.result, preview.result);
  const cached = adjustment.resolveStored(original, settings, spec);
  assert.equal(cached.ok, true);
  assert.deepEqual(cached.result, preview.result);
});

test('server close replays selected maximum targets without a second random draw', async t => {
  const fixture = await import('./helpers/cofiring-review-fixture.mjs');
  const packet = fixture.packet(), original = packet.snapshot.result;
  const preview = adjustment.autoMax(original, packet.snapshot.settings, 30, sequence(0.2, 0.8));
  assert.equal(preview.ok, true, preview.message);
  packet.snapshot.result = preview.result;
  const db = fixture.database(t);
  const previousRandom = Math.random;
  Math.random = () => { throw Error('Server validation must not draw new targets'); };
  let response;
  try { response = await fixture.call(db, {body: packet}); }
  finally { Math.random = previousRandom; }
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  const saved = JSON.parse(fixture.stored(db).snapshot_json);
  assert.deepEqual(saved.result, preview.result);
  assert.deepEqual(saved.originalResult, original);
});

test('manual transfer and direct final edit remain independent of automatic target draws', () => {
  const original = base(24, 400, 200), preserved = structuredClone(original);
  const transferred = adjustment.manualTransfer(original, settings, 1, 10.123456);
  verifyPhysicalContracts(original, transferred);
  assert.deepEqual(quantities(transferred.result), [389.876544, 210.123456]);
  const direct = adjustment.adjustFinal(original, settings, 390, 205, {mode: 'manual_final'});
  verifyPhysicalContracts(original, direct);
  assert.deepEqual(quantities(direct.result), [390, 205]);
  assert.deepEqual(original, preserved);
});
