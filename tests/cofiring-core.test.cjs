'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../maintenance/cofiring-core.js');
const reference = JSON.parse(fs.readFileSync(path.join(__dirname, '../maintenance/cofiring-draft-reference.json'), 'utf8'));
const copy = () => structuredClone(reference);
const fullOptions = () => ({ start: reference.start, end: reference.end, organic: structuredClone(reference.manualOrganic) });
const near = (actual, expected, tolerance = 1e-9) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tolerance, actual + ' differs from ' + expected);

test('actual saved full-day boundaries reproduce complete unit 1 quantities and heat ratios without rounding', () => {
  const result = core.analyze(reference, fullOptions());
  assert.equal(result.period.boundaryCount, 1441);
  assert.equal(result.period.durationHours, 24);
  near(result.units.unit1.coal.quantity, 598.6298828125);
  near(result.units.unit1.bio.quantity, 379.390625);
  near(result.units.unit1.organic.quantity, 59.84);
  near(result.units.unit1.ratios.bio, 24.8123052820876);
  near(result.units.unit1.ratios.organic, 4.2158131463528665);
  near(result.units.unit1.ratios.total, 29.028118428440465);
  assert.equal(result.qualityVerified, false);
  assert.equal(result.productionReady, false);
  assert.equal(result.databaseWritten, false);
});

test('the actual ten missing unit 2 Bio minutes leave confirmed usage and ratios unavailable while exposing the labelled Excel comparison', () => {
  const result = core.analyze(reference, fullOptions());
  near(result.units.unit2.coal.quantity, 634.4833984375);
  assert.equal(result.units.unit2.bio.missingSamples, 10);
  assert.equal(result.units.unit2.bio.quantity, null);
  near(result.units.unit2.bio.referenceQuantity, 305.93359375);
  assert.deepEqual(result.units.unit2.ratios, { bio: null, organic: null, total: null });
  assert.equal(result.combined.ratios.total, null);
  assert.equal(result.units.unit1.complete, true);
});

test('a real 13-hour subset uses 781 boundary points and never carries the original 24-hour organic entries into it', () => {
  const result = core.analyze(reference, { ...fullOptions(), end: '2026-09-07T13:00:00+09:00' });
  assert.equal(result.period.boundaryCount, 781);
  assert.equal(result.period.durationMinutes, 780);
  near(result.units.unit1.coal.quantity, 337.2001953125);
  near(result.units.unit1.bio.quantity, 175.17578125);
  near(result.units.unit2.coal.quantity, 363.125);
  near(result.units.unit2.bio.referenceQuantity, 128.65234375);
  assert.equal(result.units.unit1.organic.quantity, null);
  assert.ok(result.units.unit1.organic.issues.includes('stale_organic_period'));
  assert.equal(result.units.unit1.ratios.total, null);
});

test('period-bound organic entries and changed heating values use heat shares rather than mass shares', () => {
  const start = reference.start, end = '2026-09-07T13:00:00+09:00';
  const result = core.analyze(reference, { start, end, organic: { start, end, unit1: 12, unit2: 9 }, calorifics: { unit1: { coal: 6000, bio: 3000, organic: 3500 } }, coefficients: { unit1: { coal: 0.97, bio: 1.02, organic: 1 } } });
  const coal = 337.2001953125 * 0.97, bio = 175.17578125 * 1.02;
  const totalHeat = coal * 6 + bio * 3 + 12 * 3.5;
  near(result.units.unit1.heats.total, totalHeat);
  near(result.units.unit1.ratios.total, (bio * 3 + 42) / totalHeat * 100);
  near(result.units.unit1.bio.averageTonPerHour, bio / 13);
});

test('stopped counters and explicit zero organic are valid, while zero total heat has no invented percentage', () => {
  const data = copy();
  data.series.forEach(series => { series.values.fill(100); });
  const result = core.analyze(data, { ...fullOptions(), organic: { start: data.start, end: data.end, unit1: 0, unit2: 0 } });
  for (const unit of ['unit1', 'unit2']) {
    assert.equal(result.units[unit].coal.quantity, 0);
    assert.equal(result.units[unit].bio.quantity, 0);
    assert.equal(result.units[unit].organic.quantity, 0);
    assert.equal(result.units[unit].complete, true);
    assert.equal(result.units[unit].heats.total, 0);
    assert.equal(result.units[unit].ratios.total, null);
  }
});

test('blank or unbound organic values remain missing and do not become an implicit zero', () => {
  for (const organic of [undefined, { unit1: 59.84, unit2: 59.84 }, { start: reference.start, end: reference.end, unit1: '', unit2: null }]) {
    const result = core.analyze(reference, { ...fullOptions(), organic });
    assert.equal(result.units.unit1.organic.quantity, null);
    assert.equal(result.units.unit1.ratios.total, null);
    near(result.units.unit1.coal.quantity, 598.6298828125);
  }
});

test('reset, negative and nonfinite counters cannot become valid fuel quantities', () => {
  for (const [value, issue] of [[0, 'counter_reset'], [-1, 'negative_counter'], [Infinity, 'invalid_number'], ['123', 'invalid_number']]) {
    const data = copy();
    data.series[0].values[100] = value;
    const result = core.analyze(data, fullOptions());
    assert.equal(result.units.unit1.coal.quantity, null);
    assert.equal(result.units.unit1.coal.referenceQuantity, null);
    assert.ok(result.units.unit1.coal.issues.includes(issue));
    assert.equal(result.units.unit1.ratios.total, null);
  }
});

test('missing or swapped fixed TAGs invalidate only the affected fuel and cannot borrow another feeder', () => {
  const missing = copy();
  missing.series.shift();
  let result = core.analyze(missing, fullOptions());
  assert.equal(result.units.unit1.coal.quantity, null);
  assert.equal(result.units.unit1.coal.missingSamples, 1441);
  near(result.units.unit1.bio.quantity, 379.390625);
  const swapped = copy();
  swapped.series[0].queryTag = swapped.series[1].queryTag;
  result = core.analyze(swapped, fullOptions());
  assert.ok(result.units.unit1.coal.issues.includes('tag_identity_mismatch'));
  assert.equal(result.units.unit1.coal.quantity, null);
  const duplicate = copy();
  duplicate.series.push(structuredClone(duplicate.series[0]));
  assert.throws(() => core.analyze(duplicate, fullOptions()), /중복/);
});

test('end-boundary omission, duplicate or shifted timestamps and unequal value lengths cannot silently shorten a period', () => {
  const noEnd = copy(); noEnd.timestamps.pop();
  assert.throws(() => core.analyze(noEnd, fullOptions()), /개수/);
  const duplicate = copy(); duplicate.timestamps[10] = duplicate.timestamps[9];
  assert.throws(() => core.analyze(duplicate, fullOptions()), /시각/);
  const shortValues = copy(); shortValues.series[0].values.pop();
  const result = core.analyze(shortValues, fullOptions());
  assert.equal(result.units.unit1.coal.quantity, null);
  assert.ok(result.units.unit1.coal.issues.includes('sample_count_mismatch'));
});

test('range validation requires real zoned minute boundaries and a duration no greater than 24 hours', () => {
  for (const [start, end] of [
    ['2026-09-07T00:00:00', '2026-09-07T13:00:00'],
    ['2026-02-30T00:00:00+09:00', '2026-03-01T00:00:00+09:00'],
    [reference.start, reference.start],
    [reference.end, reference.start],
    [reference.start, '2026-09-08T00:01:00+09:00'],
    [reference.start, '2026-09-07T13:00:01+09:00']
  ]) assert.throws(() => core.validateRange(start, end));
  assert.equal(core.validateRange('2026-09-06T15:00:00Z', '2026-09-07T04:00:00Z').boundaryCount, 781);
  assert.throws(() => core.analyze(reference, { start: '2026-09-08T00:00:00+09:00', end: '2026-09-08T13:00:00+09:00' }), /벗어/);
});

test('strict live-quality mode requires every quality and rejects adverse or unknown qualifiers', () => {
  let data = copy();
  let result = core.analyze(data, { ...fullOptions(), requireQuality: true });
  assert.equal(result.units.unit1.coal.quantity, null);
  assert.ok(result.units.unit1.coal.issues.includes('quality_not_recorded'));
  data.series.forEach(series => { series.qualities = series.values.map(() => 'Raw, Good'); });
  result = core.analyze(data, { ...fullOptions(), requireQuality: true });
  near(result.units.unit1.coal.quantity, 598.6298828125);
  for (const quality of ['Not Good', 'Raw, Good, Bad', 'Unknown, Good', '', null]) {
    data.series[0].qualities[100] = quality;
    result = core.analyze(data, { ...fullOptions(), requireQuality: true });
    assert.equal(result.units.unit1.coal.quantity, null);
  }
});

test('invalid manual inputs or calorific assumptions never generate numeric ratios', () => {
  for (const value of [-1, Infinity, '59.84']) {
    const result = core.analyze(reference, { ...fullOptions(), organic: { ...reference.manualOrganic, unit1: value } });
    assert.equal(result.units.unit1.organic.quantity, null);
    assert.equal(result.units.unit1.ratios.total, null);
  }
  for (const value of [0, -1, Infinity, '', null]) assert.throws(() => core.analyze(reference, { ...fullOptions(), calorifics: { unit1: { coal: value } } }), /발열량/);
});
