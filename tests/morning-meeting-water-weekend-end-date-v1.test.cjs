'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const repo = process.env.WATER_DATE_REPO || path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(repo, 'script.js'), 'utf8');
const prefetch = fs.readFileSync(path.join(repo, 'maintenance/morning-meeting-final-water-prefetch-v1.js'), 'utf8');
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const KEY = 'gsShiftLog.morningMeetingAutoDataCache.v1';
const waterKeys = ['rawWaterInflow', 'demiProduction', 'pureWaterUsage', 'rawWaterTankAmount', 'rawWaterTankRate', 'filteredWaterTankAmount', 'filteredWaterTankRate', 'demiWaterTankAmount', 'demiWaterTankRate'];
function water(date, seed) {
  return Object.fromEntries([['sourceDate', date], ['targetDate', date], ...waterKeys.map((key, i) => [key, seed + i])]);
}
function part(start, end) {
  const a = script.indexOf(start), b = script.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'actual production function boundaries');
  return script.slice(a, b);
}
const writer = part('function applyMorningMeetingWaterTreatmentValues(', 'function normalizeMorningMeetingBoilerTemperatureNumber(');
const queryStart = script.indexOf('async function loadWaterTreatment(');
const queryTail = script.slice(queryStart).match(/const targetDates\s*=\s*\[\s*currentDate\s*\];/);
assert.ok(queryStart >= 0 && queryTail, 'single-date OIS query remains present');
const query = script.slice(queryStart, queryStart + queryTail.index + queryTail[0].length) + '\nreturn { previousDate, currentDate, targetDates };\n}';
const silent = { log() {}, warn() {}, error() {} };
function harness({ workDate, startDate, endDate, enabled = true, cache = {}, source, apiWater } = {}) {
  const state = { workDate, weekendMode: { enabled, startDate, endDate }, waterTreatment: source || null };
  const storage = { [KEY]: JSON.stringify({ water: cache, gear: { preserved: true } }) };
  const requests = [], errors = [];
  const localStorage = { getItem: key => storage[key] || null, setItem: (key, value) => { storage[key] = value; } };
  const window = { efficiencyMorningMeetingUploadState: state, localStorage, location: { origin: 'https://example.invalid' } };
  const document = { getElementById: () => ({ value: workDate }), addEventListener() {} };
  const context = vm.createContext({ window, document, localStorage, console: silent,
    getState: () => state, getElements: () => ({ panel: { dataset: {} } }), hideError() {}, showError: x => errors.push(x),
    setMorningMeetingNumericCellValue: (sheet, address, value) => { sheet[address] = value; return { found: true }; },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      if (!apiWater) throw Error('Unexpected network request in offline regression test');
      return { ok: true, text: async () => JSON.stringify({ ok: true, item: { id: 'test-only-request', status: 'complete', targetDate: body.targetDate, result: apiWater } }) };
    }
  });
  vm.runInContext(prefetch, context);
  vm.runInContext(writer + '\n' + query, context);
  return { state, storage, requests, errors, context, api: window.MorningMeetingFinalWaterPrefetchV1,
    write: (sourceValue = source || {}, options = {}) => {
      const sheet = { unrelated: 'keep', AH18: -999, AJ18: -999 };
      context.applyMorningMeetingWaterTreatmentValues(sheet, sourceValue, options);
      return sheet;
    }
  };
}
const cases = [
  ['weekday with dormant weekend settings', '2026-10-05', '2026-09-01', '2026-09-12', false, '2026-10-04', '2026-10-05'],
  ['two-day weekend', '2026-10-04', '2026-10-03', '2026-10-04', true, '2026-10-03', '2026-10-04'],
  ['three-day weekend', '2026-10-04', '2026-10-02', '2026-10-04', true, '2026-10-03', '2026-10-04'],
  ['long holiday ending October 5', '2026-10-05', '2026-09-30', '2026-10-05', true, '2026-10-04', '2026-10-05'],
  ['month boundary', '2026-10-01', '2026-09-27', '2026-10-01', true, '2026-09-30', '2026-10-01'],
  ['year boundary', '2027-01-01', '2026-12-29', '2027-01-01', true, '2026-12-31', '2027-01-01'],
  ['leap year boundary', '2028-03-01', '2028-02-27', '2028-03-01', true, '2028-02-29', '2028-03-01'],
  ['non-leap February', '2027-03-01', '2027-02-26', '2027-03-01', true, '2027-02-28', '2027-03-01'],
  ['single-day weekend range', '2026-10-05', '2026-10-05', '2026-10-05', true, '2026-10-04', '2026-10-05']
];
for (const [label, workDate, startDate, endDate, enabled, previous, current] of cases) {
  test(label + ': query, prefetch and actual Excel cells agree', async () => {
    const cache = { [startDate]: water(startDate, 100), [previous]: water(previous, 200), [current]: water(current, 300) };
    const h = harness({ workDate, startDate, endDate, enabled, cache, source: water(current, 400) });
    const d = h.api.resolveDates();
    assert.equal(d.previousDate, previous); assert.equal(d.currentDate, current);
    const q = await h.context.loadWaterTreatment();
    assert.equal(q.previousDate, previous); assert.equal(q.currentDate, current);
    assert.deepEqual(Array.from(q.targetDates), [current], 'normal OIS query remains one date');
    const sheet = h.write();
    assert.deepEqual(['AH18', 'AH19', 'AH20', 'AH21', 'AH22'].map(a => sheet[a]), [200, 201, 203, 205, 207]);
    assert.deepEqual(['AJ18', 'AJ19', 'AM19', 'AJ20', 'AM20', 'AJ21', 'AM21', 'AJ22', 'AM22'].map(a => sheet[a]), [400, 401, 402, 403, 404, 405, 406, 407, 408]);
    assert.equal(sheet.unrelated, 'keep');
  });
}
test('changing only holiday start date does not change water columns', () => {
  const make = startDate => harness({ workDate: '2026-10-05', startDate, endDate: '2026-10-05', cache: { '2026-10-04': water('2026-10-04', 200) }, source: water('2026-10-05', 400) }).write();
  assert.deepEqual(make('2026-10-01'), make('2026-10-03'));
});
test('missing end-minus-one cache never copies start-day or template numbers', () => {
  const h = harness({ workDate: '2026-10-05', startDate: '2026-10-01', endDate: '2026-10-05', cache: { '2026-10-01': water('2026-10-01', 100) }, source: water('2026-10-05', 400) });
  const sheet = h.write();
  for (const a of ['AH18', 'AH19', 'AH20', 'AH21', 'AH22']) assert.equal(sheet[a], null);
  assert.equal(sheet.AJ18, 400);
});
test('prefetch reuses the exact end-minus-one saved result including zero', async () => {
  const cached = water('2026-10-04', 0);
  const h = harness({ workDate: '2026-10-05', startDate: '2026-10-01', endDate: '2026-10-05', cache: { '2026-10-04': cached } });
  const result = await h.api.ensurePreviousWater();
  assert.equal(result.dates.previousDate, '2026-10-04'); assert.equal(result.source, 'cache');
  assert.equal(result.water.rawWaterInflow, 0); assert.equal(h.requests.length, 0);
  assert.equal(h.write().AH18, 0);
});
test('prefetch requests only end-minus-one when only start-day cache exists', async () => {
  const source = water('2026-10-05', 400);
  const h = harness({ workDate: '2026-10-05', startDate: '2026-10-01', endDate: '2026-10-05', cache: { '2026-10-01': water('2026-10-01', 100) }, source, apiWater: water('2026-10-04', 200) });
  const result = await h.api.ensurePreviousWater();
  assert.equal(result.dates.previousDate, '2026-10-04'); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].targetDate, '2026-10-04'); assert.equal(h.requests[0].requestType, 'water_environment');
  assert.equal(h.requests[0].forceRefresh, false);
  const cache = JSON.parse(h.storage[KEY]);
  assert.equal(cache.water['2026-10-01'].rawWaterInflow, 100); assert.equal(cache.water['2026-10-04'].rawWaterInflow, 200);
  assert.equal(cache.gear.preserved, true); assert.equal(h.state.waterTreatment, source);
  assert.equal(h.write().AH18, 200); assert.equal(h.write().AJ18, 400);
});
test('wrong-date server result is rejected without caching it under requested date', async () => {
  const h = harness({ workDate: '2026-10-05', startDate: '2026-10-01', endDate: '2026-10-05', apiWater: water('2026-10-01', 100) });
  await assert.rejects(h.api.ensurePreviousWater(), /날짜가 다릅니다/);
  assert.equal(JSON.parse(h.storage[KEY]).water['2026-10-04'], undefined);
});
test('suppressed current source still leaves the correct previous-day column', () => {
  const h = harness({ workDate: '2026-10-05', startDate: '2026-10-01', endDate: '2026-10-05', cache: { '2026-10-04': water('2026-10-04', 200), '2026-10-05': water('2026-10-05', 300) }, source: water('2026-10-05', 400) });
  const sheet = h.write(undefined, { suppressCurrentDate: true });
  assert.equal(sheet.AH18, 200); assert.equal(sheet.AJ18, null);
});
test('reversed weekend range still stops the normal query', async () => {
  const h = harness({ workDate: '2026-10-05', startDate: '2026-10-06', endDate: '2026-10-05' });
  assert.equal(await h.context.loadWaterTreatment(), undefined);
  assert.equal(h.errors.length, 1); assert.match(h.errors[0], /날짜 범위/); assert.equal(h.requests.length, 0);
});
test('both deployed JavaScript URLs receive a cache version update', () => {
  const urls = [...html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  assert.ok(urls.some(x => /^(?:\.\/|\/)?script\.js\?/.test(x) && x.includes('waterEndDate=20261006-v1')));
  assert.ok(urls.some(x => x.includes('maintenance/morning-meeting-final-water-prefetch-v1.js?') && x.includes('waterEndDate=20261006-v1')));
});
