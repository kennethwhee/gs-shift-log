'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../maintenance/cofiring-core.js');
const contract = require('../maintenance/cofiring-live-contract.js');
const ui = require('../maintenance/cofiring-period-ui-v5.js');
const adjustment = require('../maintenance/cofiring-period-adjustment-v56.js');

const UNITS = ['unit1', 'unit2'];
const FUELS = ['coal', 'bio', 'organic', 'manure'];
const spec = {
  startLocal: '2026-09-10T00:00', endLocal: '2026-09-10T12:00',
  stepUnit: 'hour', stepValue: 1
};
const settings = {
  unit1: {coal: {calorific: 5868}, bio: {calorific: 3237}, organic: {calorific: 3487}, manure: {calorific: 3100}},
  unit2: {coal: {calorific: 5700}, bio: {calorific: 3000}, organic: {calorific: 3300}, manure: {calorific: 2900}}
};
const near = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to equal ${expected} within ${tolerance}`);
};

// The same validated period-report shape used by cofiring-period-v5.test.cjs.
// Build the ten counters from the authoritative definitions, not array positions.
function fixture() {
  const period = contract.period(spec, Number.MAX_SAFE_INTEGER);
  const quantities = {unit1: {coal: 400, bio: 300}, unit2: {coal: 1000, bio: 60}};
  const summaries = contract.definitions.map((definition, index) => {
    const count = contract.definitions.filter(item => item.unit === definition.unit && item.fuel === definition.fuel).length;
    const usage = quantities[definition.unit][definition.fuel] / count;
    const startValue = 20000 + index * 1000;
    return {
      key: definition.id, unit: definition.unit, fuel: definition.fuel, tag: definition.queryTag,
      startValue, endValue: startValue + usage, min: startValue, max: startValue + usage,
      delta: usage, usageTon: usage, startQuality: 'Raw, Good', endQuality: 'Good, Raw',
      startTime: spec.startLocal + ':00+09:00', endTime: spec.endLocal + ':00+09:00',
      durationGoodSeconds: period.durationMinutes * 60, durationBadSeconds: 0,
      boundaryValid: true, durationCoverageValid: true
    };
  });
  const report = {
    kind: 'cofiring_dataparc_period_report', schemaVersion: 1, status: 'PERIOD_READY',
    runId: '0123456789abcdef0123456789abcdef', ...spec, queryEndLocal: period.queryEndLocal,
    executionSucceeded: true, cleanupVerified: true, processCleanupVerified: true,
    timedOut: false, workerExitCode: 0, cleanupErrors: [], completedAtUtc: '2026-09-10T03:02:00Z',
    summaries
  };
  const reference = contract.validatePeriodReport(report, spec).reference;
  const calorifics = {}, coefficients = {};
  for (const unit of UNITS) {
    calorifics[unit] = Object.fromEntries(FUELS.map(fuel => [fuel, settings[unit][fuel].calorific]));
    coefficients[unit] = Object.fromEntries(FUELS.map(fuel => [fuel, 1]));
  }
  const bounds = {start: spec.startLocal + ':00+09:00', end: spec.endLocal + ':00+09:00'};
  return core.analyzePeriodSummary(reference, {
    ...spec, calorifics, coefficients,
    organic: {...bounds, unit1: 30, unit2: 12},
    manure: {...bounds, unit1: 7, unit2: 3}
  });
}

function expectedHeats(unitResult, unit) {
  const heats = Object.fromEntries(FUELS.map(fuel => [fuel, unitResult[fuel].quantity * settings[unit][fuel].calorific / 1000]));
  heats.total = FUELS.reduce((sum, fuel) => sum + heats[fuel], 0);
  return heats;
}

function verifyRatios(result) {
  const combined = {coal: 0, bio: 0, organic: 0, manure: 0, total: 0};
  for (const unit of UNITS) {
    const value = result.units[unit], heat = expectedHeats(value, unit);
    for (const fuel of [...FUELS, 'total']) {
      near(value.heats[fuel], heat[fuel]);
      combined[fuel] += heat[fuel];
    }
    near(ui.coalBioRatio(value), heat.bio / (heat.coal + heat.bio) * 100);
    near(value.fuelRatios.organicGroup, (heat.organic + heat.manure) / heat.total * 100);
    near(value.fuelRatios.total, (heat.bio + heat.organic + heat.manure) / heat.total * 100);
  }
  for (const fuel of [...FUELS, 'total']) near(result.combined.heats[fuel], combined[fuel]);
  near(ui.combinedCoalBio(result).ratio, combined.bio / (combined.coal + combined.bio) * 100);
  near(result.combined.fuelRatios.organicGroup, (combined.organic + combined.manure) / combined.total * 100);
  near(result.combined.fuelRatios.total, (combined.bio + combined.organic + combined.manure) / combined.total * 100);
  const simpleAverage = UNITS.reduce((sum, unit) => sum + result.units[unit].fuelRatios.total, 0) / 2;
  assert.ok(Math.abs(simpleAverage - result.combined.fuelRatios.total) > 0.1,
    'Unequal unit heat totals must not be combined with a simple percentage average');
}

function verifyAdjustment(base, changed) {
  assert.equal(changed.ok, true, changed.message);
  for (const unit of UNITS) {
    for (const fuel of ['organic', 'manure']) assert.deepEqual(changed.result.units[unit][fuel], base.units[unit][fuel]);
    // Coal is rounded to six decimals by the existing adjustment contract.
    near(changed.result.units[unit].heats.total, base.units[unit].heats.total, 1e-5);
    const removedBio = base.units[unit].bio.quantity - changed.result.units[unit].bio.quantity;
    near(changed.result.units[unit].coal.quantity,
      base.units[unit].coal.quantity + removedBio * settings[unit].bio.calorific / settings[unit].coal.calorific,
      0.000001);
  }
  verifyRatios(changed.result);
}

test('three dashboard rates use their declared heat denominators and combine unit heat totals', () => {
  const base = fixture();
  assert.equal(base.qualityVerified, true);
  verifyRatios(base);
  const unit = base.units.unit1;
  assert.ok(ui.coalBioRatio(unit) > unit.fuelRatios.bio,
    'The displayed Bio rate excludes organic and manure from its denominator');
  assert.ok(Math.abs(ui.coalBioRatio(unit) + unit.fuelRatios.organicGroup - unit.fuelRatios.total) > 0.01,
    'Rates with different denominators must not be added to obtain the total rate');
});

test('both manual Bio transfer directions conserve fuel totals and each unit heat without mutating the source', () => {
  const base = fixture(), original = structuredClone(base);
  for (const direction of [1, 2]) {
    const changed = adjustment.manualTransfer(base, settings, direction, 15);
    verifyAdjustment(base, changed);
    near(changed.result.units.unit1.bio.quantity + changed.result.units.unit2.bio.quantity, 360);
    near(changed.result.units.unit1.bio.quantity, direction === 1 ? 285 : 315);
    near(changed.result.units.unit2.bio.quantity, direction === 1 ? 75 : 45);
  }
  assert.deepEqual(base, original);
});

test('automatic maximum transfers available excess then compensates excluded Bio at each unit calorific value', () => {
  const base = fixture();
  const transfer = adjustment.autoMax(base, settings, 400);
  verifyAdjustment(base, transfer);
  near(transfer.adjustment.periodCapTons, 200);
  near(transfer.result.units.unit1.bio.quantity, 200);
  near(transfer.result.units.unit2.bio.quantity, 160);
  near(transfer.adjustment.excludedBioTons, 0);
  const excluded = adjustment.autoMax(base, settings, 120);
  verifyAdjustment(base, excluded);
  near(excluded.adjustment.periodCapTons, 60);
  near(excluded.result.units.unit1.bio.quantity, 60);
  near(excluded.result.units.unit2.bio.quantity, 60);
  near(excluded.adjustment.excludedBioTons, 240);
});

test('direct final Bio edits retain organic and manure, conserve heat and reject invented Bio quantity', () => {
  const base = fixture(), original = structuredClone(base);
  const changed = adjustment.adjustFinal(base, settings, 250, 80, {mode: 'manual_final'});
  verifyAdjustment(base, changed);
  near(changed.adjustment.excludedBioTons, 30);
  assert.equal(adjustment.adjustFinal(base, settings, 301, 60).ok, false);
  assert.deepEqual(base, original);
});

test('adjustment dialog exposes all three ratios and the requested adjustment controls', () => {
  const html = adjustment.modalHtml();
  for (const label of ['바이오 혼소율', '유기성 및 축분 혼소율', '종합혼소율']) {
    assert.ok(html.includes(`<th>${label}</th>`), `Missing final-result column: ${label}`);
  }
  for (const attribute of [
    'data-cfv56-max', 'data-cfv56-save-max', 'data-cfv56-dir="1"', 'data-cfv56-dir="2"',
    'data-cfv56-transfer', 'data-cfv56-preview-transfer', 'data-cfv56-auto',
    'data-cfv56-edit', 'data-cfv56-final1', 'data-cfv56-final2', 'data-cfv56-preview-final',
    'data-cfv56-reset', 'data-cfv56-cancel', 'data-cfv56-apply', 'data-cfv56-close'
  ]) assert.ok(html.includes(attribute), `Missing adjustment control: ${attribute}`);
  for (const label of ['1호기 → 2호기', '2호기 → 1호기', '최대혼소 자동 조정', 'Coal 자동 보정', '원복', '취소', '적용']) {
    assert.ok(html.includes(label), `Missing adjustment function: ${label}`);
  }
  assert.match(html, /role="dialog" aria-modal="true" aria-label="혼소 조정"/);
});
