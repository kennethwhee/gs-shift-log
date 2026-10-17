'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../maintenance/cofiring-period-adjustment-v56.js');

const units = ['unit1', 'unit2'];
const fuels = ['coal', 'bio', 'organic', 'manure'];
const settings = {
  unit1: {coal: {calorific: 5868}, bio: {calorific: 3237}, organic: {calorific: 3487}, manure: {calorific: 3100}},
  unit2: {coal: {calorific: 5700}, bio: {calorific: 3000}, organic: {calorific: 3300}, manure: {calorific: 2900}}
};
const spec = {startLocal: '2026-10-16T00:00', endLocal: '2026-10-17T00:00'};
const near = (actual, expected, tolerance = 0.000001) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${actual} must equal ${expected} within ${tolerance}`
);
function base() {
  const value = {period: {...spec, durationHours: 24}, units: {}, combined: {}};
  for (const [index, unit] of units.entries()) {
    value.units[unit] = {
      coal: {quantity: index === 0 ? 600 : 650},
      bio: {quantity: index === 0 ? 400 : 350},
      organic: {quantity: index === 0 ? 30 : 12},
      manure: {quantity: index === 0 ? 5 : 3},
      heats: {}
    };
  }
  return value;
}
const finals = result => ({
  finalCoalUnit1: result.units.unit1.coal.quantity,
  finalCoalUnit2: result.units.unit2.coal.quantity,
  finalBioUnit1: result.units.unit1.bio.quantity,
  finalBioUnit2: result.units.unit2.bio.quantity
});
function canonical(raw = base()) {
  const result = engine.adjustTable(raw, settings, finals(raw));
  assert.equal(result.ok, true, result.message);
  return result.result;
}
function checkDerived(raw, changed) {
  assert.equal(changed.ok, true, changed.message);
  const result = changed.result;
  for (const unit of units) {
    const value = result.units[unit];
    for (const fuel of ['organic', 'manure']) assert.deepEqual(value[fuel], raw.units[unit][fuel]);
    for (const fuel of fuels) near(value.heats[fuel], value[fuel].quantity * settings[unit][fuel].calorific / 1000, 1e-8);
    near(value.heats.total, fuels.reduce((sum, fuel) => sum + value.heats[fuel], 0), 1e-8);
    if (value.heats.total > 0) {
      near(value.fuelRatios.bio, value.heats.bio / value.heats.total * 100, 1e-8);
      near(value.fuelRatios.organicGroup, (value.heats.organic + value.heats.manure) / value.heats.total * 100, 1e-8);
      near(value.fuelRatios.total, value.fuelRatios.bio + value.fuelRatios.organicGroup, 1e-8);
    }
    near(value.coal.averageTonPerHour, value.coal.quantity / 24);
    near(value.bio.averageTonPerHour, value.bio.quantity / 24);
  }
  for (const fuel of [...fuels, 'total']) near(result.combined.heats[fuel],
    result.units.unit1.heats[fuel] + result.units.unit2.heats[fuel], 1e-8);
  if (result.combined.heats.total > 0) near(result.combined.fuelRatios.total,
    result.combined.fuelRatios.bio + result.combined.fuelRatios.organicGroup, 1e-8);
}

test('table adjustment stores independent Coal/Bio quantities, rounds to six decimals, and preserves the raw source', () => {
  const raw = base(), preserved = structuredClone(raw);
  const changed = engine.adjustTable(raw, settings, {...finals(raw), finalCoalUnit1: 598.1234567, finalBioUnit1: 390.1234567});
  checkDerived(raw, changed);
  assert.equal(changed.result.units.unit1.coal.quantity, 598.123457);
  assert.equal(changed.result.units.unit1.bio.quantity, 390.123457);
  assert.equal(changed.adjustment.mode, 'manual_table');
  assert.equal(changed.adjustment.applied, true);
  near(changed.adjustment.deltas.unit1.coalDelta, -1.876543);
  near(changed.adjustment.deltas.unit1.bioDelta, 9.876543);
  assert.equal(changed.adjustment.excludedBioTons, 9.877);
  assert.deepEqual(raw, preserved);
});

test('independent Coal edit retains Bio and changes total heat and all derived percentages', () => {
  const raw = base(), current = canonical(raw), preserved = structuredClone(current);
  const changed = engine.editTableValue(raw, settings, current, 'unit1', 'coal', 700);
  checkDerived(raw, changed);
  assert.equal(changed.result.units.unit1.coal.quantity, 700);
  assert.equal(changed.result.units.unit1.bio.quantity, 400);
  near(changed.result.units.unit1.heats.total - current.units.unit1.heats.total, 100 * 5868 / 1000);
  assert.ok(changed.result.units.unit1.fuelRatios.bio < current.units.unit1.fuelRatios.bio);
  assert.deepEqual(current, preserved);
});

test('Bio edit compensates Coal using the current draft heat after a previous independent Coal edit', () => {
  const raw = base(), original = canonical(raw);
  const coalEdit = engine.editTableValue(raw, settings, original, 'unit1', 'coal', 700);
  const bioEdit = engine.editTableValue(raw, settings, coalEdit.result, 'unit1', 'bio', 390);
  checkDerived(raw, bioEdit);
  assert.equal(bioEdit.result.units.unit1.bio.quantity, 390);
  near(bioEdit.result.units.unit1.coal.quantity, 700 + 10 * 3237 / 5868);
  near(bioEdit.result.units.unit1.heats.total, coalEdit.result.units.unit1.heats.total, 0.00001);
  assert.ok(bioEdit.result.units.unit1.heats.total > original.units.unit1.heats.total);
});

for (const [key, target, property] of [
  ['bioRatio', 20, 'bio'],
  ['organicRatio', 3, 'organicGroup'],
  ['totalRatio', 35, 'total']
]) {
  test(`${key} inverse edit reaches the requested total-heat percentage by changing only Coal`, () => {
    const raw = base(), current = canonical(raw), preserved = structuredClone(current);
    const changed = engine.editTableValue(raw, settings, current, 'unit1', key, target);
    checkDerived(raw, changed);
    assert.equal(changed.result.units.unit1.bio.quantity, current.units.unit1.bio.quantity);
    assert.notEqual(changed.result.units.unit1.coal.quantity, current.units.unit1.coal.quantity);
    near(changed.result.units.unit1.fuelRatios[property], target);
    assert.deepEqual(changed.result.units.unit2, current.units.unit2);
    assert.deepEqual(current, preserved);
  });
}

test('unit 2 ratio edits use unit 2 calorifics and do not affect unit 1', () => {
  const raw = base(), current = canonical(raw);
  const changed = engine.editTableValue(raw, settings, current, 'unit2', 'bioRatio', 20);
  checkDerived(raw, changed);
  near(changed.result.units.unit2.fuelRatios.bio, 20);
  const heat = 350 * 3000 / 1000 / 0.2;
  const expectedCoal = (heat - 350 * 3000 / 1000 - 12 * 3300 / 1000 - 3 * 2900 / 1000) * 1000 / 5700;
  near(changed.result.units.unit2.coal.quantity, expectedCoal);
  assert.deepEqual(changed.result.units.unit1, current.units.unit1);
});

test('100% total renewable heat is attainable at zero Coal while excessive individual percentages are rejected', () => {
  const raw = base(), current = canonical(raw);
  const changed = engine.editTableValue(raw, settings, current, 'unit1', 'totalRatio', 100);
  checkDerived(raw, changed);
  assert.equal(changed.result.units.unit1.coal.quantity, 0);
  near(changed.result.units.unit1.fuelRatios.total, 100);
  for (const [key, target] of [['bioRatio', 99], ['organicRatio', 50]]) {
    const rejected = engine.editTableValue(raw, settings, current, 'unit1', key, target);
    assert.equal(rejected.ok, false);
    assert.match(rejected.message, /최대/);
  }
});

test('positive fuel heat cannot become a zero percentage and the current draft remains intact on failure', () => {
  const raw = base(), current = canonical(raw), preserved = structuredClone(current);
  for (const key of ['bioRatio', 'organicRatio', 'totalRatio']) {
    const rejected = engine.editTableValue(raw, settings, current, 'unit1', key, 0);
    assert.equal(rejected.ok, false);
    assert.match(rejected.message, /0%/);
    assert.deepEqual(current, preserved);
  }
});

test('zero numerator permits only zero percent and an empty total heat requires quantities first', () => {
  const raw = base(); raw.units.unit1.organic.quantity = 0; raw.units.unit1.manure.quantity = 0;
  const current = canonical(raw);
  assert.equal(engine.editTableValue(raw, settings, current, 'unit1', 'organicRatio', 0).ok, true);
  const positive = engine.editTableValue(raw, settings, current, 'unit1', 'organicRatio', 1);
  assert.equal(positive.ok, false); assert.match(positive.message, /사용량이 0/);
  for (const fuel of fuels) raw.units.unit1[fuel].quantity = 0;
  const empty = canonical(raw);
  assert.equal(empty.units.unit1.fuelRatios.total, null);
  const rejected = engine.editTableValue(raw, settings, empty, 'unit1', 'totalRatio', 0);
  assert.equal(rejected.ok, false); assert.match(rejected.message, /총 투입열량이 0/);
});

test('Bio retains the existing total-increase tolerance and rejects amounts beyond it', () => {
  const raw = base(), values = finals(raw);
  assert.equal(engine.adjustTable(raw, settings, {...values, finalBioUnit1: 400.011}).ok, true);
  assert.equal(engine.adjustTable(raw, settings, {...values, finalBioUnit1: 400.011001}).ok, false);
  assert.equal(engine.editTableValue(raw, settings, canonical(raw), 'unit1', 'bio', 450).ok, false);
});

test('Bio heat compensation rejects negative Coal even if aggregate Bio remains within the measured total', () => {
  const raw = base(); raw.units.unit1.coal.quantity = 0; raw.units.unit1.bio.quantity = 100;
  const rejected = engine.editTableValue(raw, settings, canonical(raw), 'unit1', 'bio', 200);
  assert.equal(rejected.ok, false); assert.match(rejected.message, /Coal이 0 미만/);
});

test('all four final quantities require finite numeric values within zero to one million tonnes', () => {
  const raw = base(), values = finals(raw);
  for (const field of Object.keys(values)) for (const invalid of [-0.000001, 1000000.000001, NaN, Infinity, null, '', '12', true]) {
    assert.equal(engine.adjustTable(raw, settings, {...values, [field]: invalid}).ok, false, `${field}: ${String(invalid)}`);
  }
  assert.equal(engine.adjustTable(raw, settings, {...values, finalCoalUnit1: 1000000}).ok, true);
  assert.equal(engine.adjustTable(raw, settings, {...values, finalCoalUnit1: 0, finalBioUnit1: 0}).ok, true);
});

test('cell edits reject malformed identities, invalid numeric types, ratios over 100, and vanishing ratio overflow', () => {
  const raw = base(), current = canonical(raw);
  for (const [unit, key, value] of [['unit3', 'coal', 1], ['unit1', 'heats', 1], ['unit1', 'coal', null],
    ['unit1', 'bio', '1'], ['unit1', 'bioRatio', 100.001], ['unit1', 'coal', 1000001],
    ['unit1', 'totalRatio', NaN], ['unit1', 'totalRatio', Number.MIN_VALUE]]) {
    assert.equal(engine.editTableValue(raw, settings, current, unit, key, value).ok, false);
  }
});

test('missing baseline quantities and invalid fuel calorifics cannot produce table adjustments', () => {
  const raw = base();
  for (const unit of units) for (const fuel of fuels) {
    const broken = structuredClone(raw); broken.units[unit][fuel].quantity = null;
    assert.equal(engine.adjustTable(broken, settings, finals(raw)).ok, false);
    const badSettings = structuredClone(settings); badSettings[unit][fuel].calorific = 0;
    assert.equal(engine.adjustTable(raw, badSettings, finals(raw)).ok, false);
  }
});

test('manual_table replay uses saved Coal as well as Bio and rejects incomplete table records', () => {
  const raw = base(), changed = engine.adjustTable(raw, settings, {...finals(raw), finalCoalUnit1: 713.456789, finalBioUnit2: 340.123456});
  const saved = {...changed.adjustment, ...finals(changed.result)};
  const replay = engine.resolveAdjustment(raw, settings, saved);
  assert.deepEqual(replay, changed);
  const local = engine.resolveAdjustment(raw, settings, {...finals(changed.result), meta: changed.adjustment});
  assert.deepEqual(local, changed);
  delete saved.finalCoalUnit1;
  assert.equal(engine.resolveAdjustment(raw, settings, saved).ok, false);
});

test('existing manual-final, transfer and random maximum records replay through the prior exact calculation', () => {
  const raw = canonical(base());
  const prior = [engine.adjustFinal(raw, settings, 390, 350, {mode: 'manual_final'}),
    engine.manualTransfer(raw, settings, 1, 10), engine.autoMax(raw, settings, 361.4, () => 0)];
  for (const preview of prior) {
    assert.equal(preview.ok, true, preview.message);
    const saved = {...preview.adjustment, finalBioUnit1: preview.result.units.unit1.bio.quantity,
      finalBioUnit2: preview.result.units.unit2.bio.quantity};
    assert.deepEqual(engine.resolveAdjustment(raw, settings, saved), preview);
  }
});

test('shared and local replay preserve independent Coal, retain six-decimal finals, and write no feedback loop', async t => {
  const raw = base(), changed = engine.adjustTable(raw, settings, {...finals(raw), finalCoalUnit1: 713.456789, finalBioUnit2: 340.123456});
  const previousFetch = globalThis.fetch, previousStorage = globalThis.localStorage;
  t.after(() => { globalThis.fetch = previousFetch; globalThis.localStorage = previousStorage; });
  const store = new Map(); let writes = 0;
  globalThis.localStorage = {getItem: key => store.get(key) ?? null, setItem: (key, value) => {writes++; store.set(key, value);}, removeItem: key => store.delete(key)};
  globalThis.fetch = async () => ({ok: true, json: async () => ({ok: true,
    start: spec.startLocal, end: spec.endLocal, revision: 3,
    adjustment: {...changed.adjustment, ...finals(changed.result)}, setting: {maxBioTpd: 361.4}})});
  for (let index = 0; index < 2; index++) {
    const loaded = await engine.resolveServer(raw, settings, spec, () => ({}));
    assert.equal(loaded.loaded, true, loaded.error);
    assert.deepEqual(loaded.result, changed.result);
  }
  assert.equal(writes, 1, 'An identical server reread must not trigger a cross-tab save loop');
  const cached = engine.resolveStored(raw, settings, spec);
  assert.deepEqual(cached, changed);
  const saved = JSON.parse([...store.values()][0]);
  assert.equal(saved.finalCoalUnit1, 713.456789);
  assert.equal(saved.finalCoalUnit2, 650);
  const newerRaw = structuredClone(raw); newerRaw.units.unit1.coal.quantity += 0.01;
  assert.equal(engine.resolveStored(newerRaw, settings, spec), null);
});
