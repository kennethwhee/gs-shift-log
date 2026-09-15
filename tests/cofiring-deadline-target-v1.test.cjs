'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const apiPath = path.resolve(__dirname, '../maintenance/cofiring-deadline-target-v1.js');
const api = require(apiPath);
const HOUR = 3600000;
const at = text => Date.parse(text + ':00+09:00');

function unit(coal = 120, bio = 20, coalCoefficient = 1, bioCoefficient = 1) {
  return {
    coal: { quantity: coal, measuredQuantity: coal / coalCoefficient, coefficient: coalCoefficient, complete: true },
    bio: { quantity: bio, measuredQuantity: bio / bioCoefficient, coefficient: bioCoefficient, complete: true },
    calorifics: { coal: 6000, bio: 4000 },
    organic: { quantity: 9000, complete: false }, manure: { quantity: 8000, complete: false }, complete: false
  };
}
function period(start = '2026-09-16T00:00', end = '2026-09-16T12:00') {
  return { startLocal: start, endLocal: end };
}
function solve(u = unit(), p = period(), extra = {}) {
  return api.forUnit(u, p, { now: at('2026-09-16T12:01'), ...extra });
}
function close(a, b, tolerance = 1e-10) {
  assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
}

test('remaining Bio rate reconstructs 25% of projected Coal plus Bio heat', () => {
  const u = unit(), result = solve(u);
  assert.equal(result.status, 'ready');
  assert.equal(result.ready, true);
  assert.equal(result.deadlineLocal, '2026-09-17T00:01');
  close(result.remainingHours, 12 + 1 / 60);
  assert.equal(result.coalAssumption, 'period-average');
  close(result.coalTonPerHour, 10);
  const futureCoal = u.coal.quantity + result.coalTonPerHour * result.remainingHours;
  const futureBio = u.bio.quantity + result.targetBioTonPerHour * result.remainingHours;
  close(futureBio * 4000 / (futureCoal * 6000 + futureBio * 4000), 0.25);
  close(result.projectedRatioPercent, 25);
});

test('corrected quantities are used once; displayed raw feeder rate reverses Bio coefficient', () => {
  const u = unit(180, 35, 1.5, 1.75), result = solve(u);
  assert.equal(result.status, 'ready');
  close(result.coalTonPerHour, 15);
  close(result.targetMeasuredBioTonPerHour * 1.75, result.targetBioTonPerHour);
  close(result.currentMeasuredBioTonPerHour, 20 / 12);
  close(result.currentBioTonPerHour, 35 / 12);
  const futureBio = u.bio.measuredQuantity * 1.75 + result.targetMeasuredBioTonPerHour * 1.75 * result.remainingHours;
  const futureCoal = u.coal.measuredQuantity * 1.5 + result.coalTonPerHour * result.remainingHours;
  close(futureBio * 4000 / (futureCoal * 6000 + futureBio * 4000), 0.25);
});

test('old snapshot keeps its own remaining denominator and exposes age instead of assuming new totals', () => {
  const first = solve(unit(), period(), { now: at('2026-09-16T12:00') });
  const later = solve(unit(), period(), { now: at('2026-09-16T17:00') });
  assert.equal(later.dataAsOfLocal, '2026-09-16T12:00');
  assert.equal(first.targetBioTonPerHour, later.targetBioTonPerHour);
  assert.equal(first.remainingHours, later.remainingHours);
  assert.equal(first.lagHours, 0);
  assert.equal(later.lagHours, 5);
});

test('explicit future Coal assumption supports a planned stop without changing cumulative use', () => {
  const u = unit(), result = solve(u, period(), { coalTonPerHour: 0 });
  assert.equal(result.status, 'ready');
  assert.equal(result.coalAssumption, 'specified');
  assert.equal(result.projectedCoalTon, 120);
  close(result.additionalBioTon, 40);
  const finalBio = u.bio.quantity + result.targetBioTonPerHour * result.remainingHours;
  close(finalBio * 4000 / (120 * 6000 + finalBio * 4000), 0.25);
});

test('overshoot returns zero extra Bio while clearly marking that exactly 25% is impossible', () => {
  const result = solve(unit(120, 130));
  assert.equal(result.status, 'above_target');
  assert.equal(result.ready, true);
  assert.equal(result.targetBioTonPerHour, 0);
  assert.equal(result.targetMeasuredBioTonPerHour, 0);
  assert.equal(result.exactTargetPossible, false);
  assert.ok(result.projectedRatioPercent > 25);
});

test('exact target at zero extra Bio remains achievable under specified zero Coal rate', () => {
  const result = solve(unit(120, 60), period(), { coalTonPerHour: 0 });
  assert.equal(result.status, 'ready');
  assert.equal(result.targetBioTonPerHour, 0);
  assert.equal(result.exactTargetPossible, true);
  close(result.projectedRatioPercent, 25);
});

test('closed full day and passed deadline never return a future feed-rate target', () => {
  const completed = solve(unit(), period('2026-09-15T00:00', '2026-09-16T00:00'), { now: at('2026-09-16T00:00') });
  assert.equal(completed.status, 'closed');
  assert.equal(completed.targetBioTonPerHour, null);
  const p = period('2026-09-15T00:00', '2026-09-15T23:59');
  assert.equal(solve(unit(), p, { now: at('2026-09-16T00:01') - 1 }).status, 'ready');
  const closed = solve(unit(), p, { now: at('2026-09-16T00:01') });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.ready, false);
  assert.equal(closed.targetBioTonPerHour, null);
});

test('partial non-midnight and multi-day periods have no daily catch-up target', () => {
  assert.equal(solve(unit(), period('2026-09-16T01:00', '2026-09-16T12:00')).status, 'unsupported_period');
  assert.equal(solve(unit(), period('2026-09-14T00:00', '2026-09-16T12:00')).status, 'unsupported_period');
  assert.equal(solve(unit(), period('2026-09-15T00:00', '2026-09-16T00:01')).status, 'unsupported_period');
});

test('zero time, invalid dates, contradictory timestamps and future data are rejected', () => {
  const invalid = [null, {}, period('2026-09-16T00:00', '2026-09-16T00:00'),
    period('2026-02-30T00:00', '2026-03-01T01:00'),
    { ...period(), startMs: at('2026-09-16T01:00') },
    { ...period(), durationHours: 12, endLocal: '2026-09-16T12:00:30' }];
  for (const p of invalid) assert.equal(solve(unit(), p).status, 'invalid_period');
  assert.equal(solve(unit(), period(), { now: at('2026-09-16T11:59') }).status, 'future_data');
  assert.equal(solve(unit(), period(), { now: NaN }).status, 'invalid_now');
  assert.equal(solve(unit(), period(), { now: '2026-09-16' }).status, 'invalid_now');
});

test('unknown or negative cumulative Coal/Bio, invalid heat and correction settings cannot become zero targets', () => {
  for (const fuel of ['coal', 'bio']) {
    for (const value of [null, -1, NaN, Infinity, '12']) {
      const u = unit(); u[fuel].quantity = value;
      const result = solve(u);
      assert.equal(result.status, 'incomplete_data'); assert.equal(result.targetBioTonPerHour, null);
    }
    const incomplete = unit(); incomplete[fuel].complete = false;
    assert.equal(solve(incomplete).status, 'incomplete_data');
    for (const value of [0, -1, null, Infinity, '1']) {
      const u = unit(); u[fuel].coefficient = value;
      assert.equal(solve(u).status, 'invalid_settings');
      const cv = unit(); cv.calorifics[fuel] = value;
      assert.equal(solve(cv).status, 'invalid_settings');
    }
  }
  for (const coalTonPerHour of [-1, null, NaN, Infinity, '10']) {
    assert.equal(solve(unit(), period(), { coalTonPerHour }).status, 'invalid_coal_rate');
  }
});

test('no heat stays undefined; Bio-only overshoot and planned new Coal are distinguished', () => {
  assert.equal(solve(unit(0, 0)).status, 'no_heat');
  const bioOnly = solve(unit(0, 10));
  assert.equal(bioOnly.status, 'above_target');
  assert.equal(bioOnly.projectedRatioPercent, 100);
  assert.equal(solve(unit(0, 0), period(), { coalTonPerHour: 10 }).status, 'ready');
  const overflow = unit(1e308, 0);
  assert.equal(solve(overflow).status, 'invalid_calculation');
});

test('daily deadline follows KST calendar through leap day, month end and year end', () => {
  for (const [date, next] of [['2028-02-29', '2028-03-01'], ['2026-09-30', '2026-10-01'], ['2026-12-31', '2027-01-01']]) {
    const p = period(date + 'T00:00', date + 'T23:00');
    const result = solve(unit(), p, { now: at(date + 'T23:01') });
    assert.equal(result.status, 'ready');
    assert.equal(result.deadlineLocal, next + 'T00:01');
    close(result.remainingHours, 1 + 1 / 60);
  }
});

test('core timestamp forms and computer timezone produce the identical deadline target', () => {
  const p = period();
  p.start = '2026-09-15T15:00:00Z'; p.end = '2026-09-16T03:00:00Z';
  p.startMs = at(p.startLocal); p.endMs = at(p.endLocal); p.durationHours = 100;
  const baseline = solve(unit(), p);
  assert.equal(baseline.elapsedHours, 12);
  const script = 'process.stdout.write(JSON.stringify(require(process.argv[1]).forUnit(JSON.parse(process.argv[2]),JSON.parse(process.argv[3]),JSON.parse(process.argv[4]))))';
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Asia/Seoul']) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script, apiPath, JSON.stringify(unit()), JSON.stringify(p), JSON.stringify({ now: at('2026-09-16T12:01') })], { env: { ...process.env, TZ }, encoding: 'utf8' }));
    assert.deepEqual(result, baseline);
  }
});
