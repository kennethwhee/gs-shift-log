import test from 'node:test';
import assert from 'node:assert/strict';
import * as fixture from './helpers/cofiring-review-fixture.mjs';

const units = ['unit1', 'unit2'];
const partialSpec = {startLocal: '2026-10-21T00:00', endLocal: '2026-10-21T17:51',
  stepUnit: 'minute', stepValue: 1};
const clone = value => structuredClone(value);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001,
  `${actual} differs from ${expected}`);

function sourceFor(activeUnit, quantity = 328.66) {
  const source = fixture.sourceResult();
  for (const summary of source.report.summaries) {
    if (summary.fuel !== 'bio') continue;
    const usage = summary.unit === activeUnit ? quantity : 0;
    summary.endValue = summary.startValue + usage;
    summary.min = summary.startValue;
    summary.max = summary.endValue;
    summary.delta = usage;
    summary.usageTon = usage;
  }
  return fixture.contract.periodResult(source, fixture.SOURCE_ID, fixture.spec);
}

function partialCalculation(activeUnit, quantity = 328.66) {
  const packet = fixture.packet(sourceFor(activeUnit, quantity));
  const base = packet.snapshot.result;
  base.period = fixture.core.periodRange(partialSpec.startLocal, partialSpec.endLocal, 'minute', 1);
  return {base, settings: packet.snapshot.settings};
}

const savedMaximum = (activeUnit, quantity = 268.72) => ({mode: 'max_auto',
  finalBioUnit1: activeUnit === 'unit1' ? quantity : 0,
  finalBioUnit2: activeUnit === 'unit2' ? quantity : 0,
  maxBioTpd: 361.4, periodCapTons: 268.791, fromUnit: null,
  bioTransferTons: 0, excludedBioTons: 59.94});

function savedServices(t, base, saved) {
  const previousFetch = globalThis.fetch, previousStorage = globalThis.localStorage;
  t.after(() => { globalThis.fetch = previousFetch; globalThis.localStorage = previousStorage; });
  const cacheKey = 'gspo:cofiring-period-adjust:v56:' + encodeURIComponent(
    partialSpec.startLocal + '|' + partialSpec.endLocal);
  const rounded = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
  const fingerprint = JSON.stringify([partialSpec.startLocal, partialSpec.endLocal,
    rounded(base.units.unit1.coal.quantity), rounded(base.units.unit1.bio.quantity),
    rounded(base.units.unit2.coal.quantity), rounded(base.units.unit2.bio.quantity)]);
  const cached = {fingerprint, finalBioUnit1: saved.finalBioUnit1,
    finalBioUnit2: saved.finalBioUnit2, meta: saved};
  const mutations = [], requests = [];
  globalThis.localStorage = {
    getItem: key => key === cacheKey ? JSON.stringify(cached) : null,
    setItem: (...args) => mutations.push(['set', ...args]),
    removeItem: (...args) => mutations.push(['remove', ...args])
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({url: String(url), options});
    assert.notEqual(options.method, 'POST', 'Reading a saved adjustment must not rewrite server data');
    return {ok: true, json: async () => ({ok: true,
      start: partialSpec.startLocal, end: partialSpec.endLocal,
      revision: 3, adjustment: saved, setting: {maxBioTpd: 361.4}})};
  };
  return {mutations, requests};
}

for (const activeUnit of units) {
  const inactiveUnit = activeUnit === 'unit1' ? 'unit2' : 'unit1';
  test(`17h51 ${activeUnit} 328.66t does not restore a prorated 268.72t saved maximum adjustment`, async t => {
    const {base, settings} = partialCalculation(activeUnit), before = clone(base);
    const saved = savedMaximum(activeUnit), services = savedServices(t, base, saved);
    const noAdjustment = fixture.adjust.autoMax(base, settings, 361.4, () => {
      throw new Error('Usage below the daily maximum must not select a target');
    });
    assert.equal(noAdjustment.ok, false);
    assert.match(noAdjustment.message, /361\.40/);
    assert.equal(fixture.adjust.resolveStored(base, settings, partialSpec), null);
    const restored = await fixture.adjust.resolveServer(base, settings, partialSpec, () => ({}));
    assert.equal(restored.loaded, false);
    assert.match(restored.error, /361\.40/);
    assert.deepEqual(services.mutations, []);
    assert.equal(services.requests.length, 1);
    assert.deepEqual(base, before);
    near(base.units[activeUnit].bio.quantity, 328.66);
    assert.equal(base.units[inactiveUnit].bio.quantity, 0);
  });

  test(`short-period ${activeUnit} above 361.40t replays the full daily target without using the zero unit`, async t => {
    const {base, settings} = partialCalculation(activeUnit, 450), before = clone(base);
    const preview = fixture.adjust.autoMax(base, settings, 361.4, () => 0);
    assert.equal(preview.ok, true, preview.message);
    assert.equal(preview.result.units[activeUnit].bio.quantity, 361.3);
    assert.equal(preview.result.units[inactiveUnit].bio.quantity, 0);
    assert.equal(preview.result.units[inactiveUnit].coal.quantity, base.units[inactiveUnit].coal.quantity);
    assert.equal(preview.adjustment.periodCapTons, 361.4);
    assert.equal(preview.adjustment.excludedBioTons, 88.7);
    assert.equal(preview.adjustment.bioTransferTons, 0);
    const saved = {...preview.adjustment,
      finalBioUnit1: preview.result.units.unit1.bio.quantity,
      finalBioUnit2: preview.result.units.unit2.bio.quantity};
    const services = savedServices(t, base, saved);
    const restored = await fixture.adjust.resolveServer(base, settings, partialSpec, () => ({}));
    assert.equal(restored.loaded, true, restored.error);
    assert.equal(restored.adjusted, true);
    assert.deepEqual(restored.result, preview.result);
    assert.deepEqual(base, before);
    assert.equal(services.requests.length, 1);
  });

  test(`server close preserves ${activeUnit}'s 328.66t without an unnecessary maximum adjustment`, async t => {
    const source = sourceFor(activeUnit), packet = fixture.packet(source);
    const original = clone(packet.snapshot.result), db = fixture.database(t, source);
    const sourceBefore = db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(fixture.SOURCE_ID).result_json;
    const response = await fixture.call(db, {body: packet});
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    const saved = JSON.parse(fixture.stored(db).snapshot_json);
    assert.deepEqual(saved.result, original);
    near(saved.result.units[activeUnit].bio.quantity, 328.66);
    assert.equal(saved.result.units[inactiveUnit].bio.quantity, 0);
    assert.equal(db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(fixture.SOURCE_ID).result_json, sourceBefore);
  });

  test(`server close rejects an obsolete 268.72t automatic cut when ${activeUnit}'s source is below 361.40t`, async t => {
    const source = sourceFor(activeUnit), packet = fixture.packet(source);
    const finals = savedMaximum(activeUnit);
    // A consistent reduced snapshot must still pass the automatic-policy replay.
    const obsolete = fixture.adjust.adjustFinal(packet.snapshot.result, packet.snapshot.settings,
      finals.finalBioUnit1, finals.finalBioUnit2, finals);
    assert.equal(obsolete.ok, true, obsolete.message);
    packet.snapshot.result = obsolete.result;
    const db = fixture.database(t, source);
    const sourceBefore = db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(fixture.SOURCE_ID).result_json;
    const response = await fixture.call(db, {body: packet});
    assert.equal(response.status, 400, JSON.stringify(response.payload));
    assert.match(response.payload.message, /361\.40/);
    assert.equal(fixture.stored(db), undefined);
    assert.equal(db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(fixture.SOURCE_ID).result_json, sourceBefore);
  });
}
