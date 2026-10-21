import test from 'node:test';
import assert from 'node:assert/strict';
import * as fixture from './helpers/cofiring-review-fixture.mjs';

const units = ['unit1', 'unit2'];
const fuels = ['coal', 'bio', 'organic', 'manure'];
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

function sourceFor(activeUnit) {
  const source = fixture.sourceResult();
  for (const summary of source.report.summaries) {
    if (summary.fuel !== 'bio') continue;
    const usage = summary.unit === activeUnit ? 450 : 0;
    summary.endValue = summary.startValue + usage;
    summary.min = summary.startValue;
    summary.max = summary.endValue;
    summary.delta = usage;
    summary.usageTon = usage;
  }
  return fixture.contract.periodResult(source, fixture.SOURCE_ID, fixture.spec);
}

// A physically consistent snapshot of the former redistribution behavior.
// This fixture intentionally gives 88.6t to a unit whose saved source Bio is 0t.
function legacyRedistribution(original, settings, activeUnit, mode = 'max_auto') {
  const result = structuredClone(original);
  const finals = Object.fromEntries(units.map(unit => [unit, unit === activeUnit ? 361.4 : 88.6]));
  const deltas = {};
  for (const unit of units) {
    const before = original.units[unit], after = result.units[unit], cals = settings[unit];
    const bioDelta = before.bio.quantity - finals[unit];
    const coalDelta = bioDelta * cals.bio.calorific / cals.coal.calorific;
    after.bio.quantity = finals[unit];
    after.coal.quantity = round(before.coal.quantity + coalDelta);
    for (const fuel of fuels) after.heats[fuel] = after[fuel].quantity * cals[fuel].calorific / 1000;
    after.heats.total = fuels.reduce((sum, fuel) => sum + after.heats[fuel], 0);
    after.ratios = {
      bio: after.heats.bio / after.heats.total * 100,
      organic: (after.heats.organic + after.heats.manure) / after.heats.total * 100,
      total: (after.heats.bio + after.heats.organic + after.heats.manure) / after.heats.total * 100
    };
    after.fuelRatios = {
      bio: after.ratios.bio,
      organic: after.heats.organic / after.heats.total * 100,
      manure: after.heats.manure / after.heats.total * 100,
      organicGroup: after.ratios.organic,
      total: after.ratios.total
    };
    after.coal.averageTonPerHour = after.coal.quantity / result.period.durationHours;
    after.bio.averageTonPerHour = after.bio.quantity / result.period.durationHours;
    deltas[unit] = { bioDelta, coalDelta };
  }
  const heats = Object.fromEntries([...fuels, 'total'].map(fuel => [fuel,
    result.units.unit1.heats[fuel] + result.units.unit2.heats[fuel]]));
  result.combined = {
    heats,
    ratios: {
      bio: heats.bio / heats.total * 100,
      organic: (heats.organic + heats.manure) / heats.total * 100,
      total: (heats.bio + heats.organic + heats.manure) / heats.total * 100
    },
    fuelRatios: {
      bio: heats.bio / heats.total * 100,
      organic: heats.organic / heats.total * 100,
      manure: heats.manure / heats.total * 100,
      organicGroup: (heats.organic + heats.manure) / heats.total * 100,
      total: (heats.bio + heats.organic + heats.manure) / heats.total * 100
    }
  };
  result.adjustment = {
    mode,
    fromUnit: ['max_auto', 'manual_transfer'].includes(mode) ? (activeUnit === 'unit1' ? 1 : 2) : null,
    bioTransferTons: ['max_auto', 'manual_transfer'].includes(mode) ? 88.6 : 0,
    maxBioTpd: mode === 'max_auto' ? 361.4 : null,
    periodCapTons: mode === 'max_auto' ? 361.4 : null,
    excludedBioTons: 0,
    deltas,
    applied: true
  };
  return result;
}

for (const activeUnit of units) {
  const inactiveUnit = activeUnit === 'unit1' ? 'unit2' : 'unit1';
  test(`server close adjusts only ${activeUnit} and preserves the saved ${inactiveUnit} zero source`, async t => {
    const source = sourceFor(activeUnit), packet = fixture.packet(source), original = structuredClone(packet.snapshot.result);
    const preview = fixture.adjust.autoMax(original, packet.snapshot.settings, 361.4, () => 0);
    assert.equal(preview.ok, true, preview.message);
    assert.equal(preview.result.units[inactiveUnit].bio.quantity, 0);
    assert.equal(preview.result.units[inactiveUnit].coal.quantity, original.units[inactiveUnit].coal.quantity);
    assert.equal(preview.adjustment.bioTransferTons, 0);
    assert.equal(preview.adjustment.excludedBioTons, 88.7);
    packet.snapshot.result = preview.result;
    const db = fixture.database(t, source);
    const before = db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(fixture.SOURCE_ID).result_json;
    const previousRandom = Math.random;
    Math.random = () => { throw new Error('Server close must replay the chosen active-unit target'); };
    let response;
    try { response = await fixture.call(db, { body: packet }); }
    finally { Math.random = previousRandom; }
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    const saved = JSON.parse(fixture.stored(db).snapshot_json);
    assert.deepEqual(saved.originalResult, original);
    assert.deepEqual(saved.result, preview.result);
    assert.equal(db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(fixture.SOURCE_ID).result_json, before);
  });

  for (const mode of ['max_auto', 'manual_transfer', 'manual_final', 'manual_table']) {
    test(`server close rejects historical ${mode} that assigns Bio to original-zero ${inactiveUnit}`, async t => {
      const source = sourceFor(activeUnit), packet = fixture.packet(source);
      packet.snapshot.result = legacyRedistribution(packet.snapshot.result, packet.snapshot.settings, activeUnit, mode);
      // A client-supplied original or activity flag must never replace the saved source.
      packet.snapshot.originalResult = structuredClone(packet.snapshot.result);
      const db = fixture.database(t, source);
      const before = db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(fixture.SOURCE_ID).result_json;
      const response = await fixture.call(db, { body: packet });
      assert.equal(response.status, 400, JSON.stringify(response.payload));
      assert.match(response.payload.message, /Bio|바이오/);
      assert.equal(fixture.stored(db), undefined);
      assert.equal(db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(fixture.SOURCE_ID).result_json, before);
    });
  }
}

test('a stale shared adjustment cannot restore transferred Bio into an original-zero unit or write its local cache', async t => {
  const source = sourceFor('unit1'), packet = fixture.packet(source), original = packet.snapshot.result;
  const spec = fixture.spec, previousFetch = globalThis.fetch, previousStorage = globalThis.localStorage;
  t.after(() => { globalThis.fetch = previousFetch; globalThis.localStorage = previousStorage; });
  const mutations = [];
  globalThis.localStorage = {
    getItem: () => null,
    setItem: (...args) => mutations.push(['set', ...args]),
    removeItem: (...args) => mutations.push(['remove', ...args])
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    ok: true, start: spec.startLocal, end: spec.endLocal, revision: 3,
    adjustment: { mode: 'max_auto', finalBioUnit1: 361.4, finalBioUnit2: 88.6,
      maxBioTpd: 361.4, bioTransferTons: 88.6, fromUnit: 1 },
    setting: { maxBioTpd: 361.4 }
  }) });
  const before = structuredClone(original);
  const result = await fixture.adjust.resolveServer(original, packet.snapshot.settings, spec, () => ({}));
  assert.equal(result.loaded, false);
  assert.match(result.error, /Bio|바이오/);
  assert.deepEqual(original, before);
  assert.deepEqual(mutations, []);
});
