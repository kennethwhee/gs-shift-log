import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.TO_POWER_SOURCE_ROOT || (existsSync(path.join(packageRoot, 'script.js')) ? packageRoot : path.join(packageRoot, 'files'));
const source = readFileSync(path.join(root, 'script.js'), 'utf8').replaceAll('\r\n', '\n');
const index = readFileSync(path.join(root, 'index.html'), 'utf8');
const providerSource = readFileSync(path.join(root, 'maintenance/to-night-power.js'), 'utf8');
const providerCss = readFileSync(path.join(root, 'maintenance/to-night-power.css'), 'utf8');
const pureContext = {module: {exports: {}}};
vm.runInNewContext(providerSource, pureContext);
const pure = pureContext.module.exports;
const sourceFunction = name => {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1);
  const endMarker = name === 'getCurrentShiftContext' ? 'function getShiftDisplayName(' : 'async function createMorningMeetingWorkbook(';
  const end = source.indexOf(endMarker, start + marker.length);
  assert.notEqual(end, -1);
  return source.slice(start, end);
};
test('actual patched main script parses', () => { new vm.Script(source, {filename: 'script.js'}); });
test('provider loads after the classic main script; both cache keys and CSS are present', () => {
  const main = [...index.matchAll(/<script\b[^>]*src=["']\/?script\.js(?:\?[^"']*)?["'][^>]*>/gi)];
  assert.equal(main.length, 1); assert.match(main[0][0], /toNightPower=20260928-v1-r6-state1/);
  assert.ok(index.indexOf('/maintenance/to-night-power.js?v=20260928-v1-r6-state1') > main[0].index);
  assert.equal(index.split('/maintenance/to-night-power.js?v=20260928-v1-r6-state1').length - 1, 1);
  assert.equal(index.split('/maintenance/to-night-power.css?v=20260928-v1-r2-ui2-state1').length - 1, 1);
});
test('TO card distinguishes incomplete, complete and checking states', () => {
  assert.match(providerSource, /function paintInputButton\(button, entry, eligible\)/);
  assert.match(providerSource, /const complete = ready && Boolean\(entry\.payload\.item\)/);
  assert.match(providerSource, /setText\(button, '전력 입력'\)/);
  assert.match(providerSource, /setText\(button, '✓ 입력 완료'\)/);
  assert.match(providerSource, /setText\(button, '확인 중…'\)/);
  assert.match(providerCss, /background:\s*#eaf4ff/);
  assert.match(providerCss, /\.to-night-power-button\.is-complete/);
  assert.match(providerCss, /background:\s*#eaf8ef/);
  assert.match(providerCss, /\.to-night-power-button\.is-checking/);
});
test('TO render runs after existing closed-data/query render', () => {
  assert.match(source, /window\.morningMeetingClosedCofiring\?\.renderOrganic\(\);\s*window\.morningMeetingQuerySources\?\.render\(\);\s*window\.toNightPower\?\.renderMeeting\(\);/);
});
test('TO provider renders server-derived monthly/yearly solar cumulative fields', () => {
  assert.match(providerSource, /efficiencyMorningMeetingAutoSolarMonthlyCumulative/);
  assert.match(providerSource, /efficiencyMorningMeetingAutoSolarYearlyCumulative/);
  assert.match(providerSource, /solarMonthlyCumulative/);
  assert.match(providerSource, /solarYearlyCumulative/);
});
test('workbook captures saved data before awaits and checks selection and reset before writing', () => {
  const start = source.indexOf('async function createMorningMeetingWorkbook');
  const capture = source.indexOf('finalWorkbookCurrentValueCollectorV9.capture(', start);
  const firstAwait = source.indexOf('await ', start);
  const write = source.indexOf('const dailyDataResult =', capture);
  assert.ok(capture > start && capture < firstAwait && write > capture);
  assert.doesNotMatch(source.slice(start, write), /toNightPower\.ensureForWorkbook/);
  assert.match(source.slice(capture, write), /mustSuppressSelectedAutomaticDate\(\)/);
  assert.match(source.slice(capture, write), /assertWorkbookSelection\(\)/);
});
const dateCases = [
  ['19:00', new Date(2026, 8, 26, 19, 0), '2026-09-26', 'NS'],
  ['23:59', new Date(2026, 8, 26, 23, 59), '2026-09-26', 'NS'],
  ['00:00 next day', new Date(2026, 8, 27, 0, 0), '2026-09-26', 'NS'],
  ['06:59 next day', new Date(2026, 8, 27, 6, 59), '2026-09-26', 'NS'],
  ['07:00 next day', new Date(2026, 8, 27, 7, 0), '2026-09-27', 'DS']
];
for (const [name, now, date, shift] of dateCases) test('actual workdate boundary: ' + name, () => {
  const context = vm.createContext({}); vm.runInContext(sourceFunction('getCurrentShiftContext'), context);
  const result = context.getCurrentShiftContext(now);
  const text = [result.date.getFullYear(), String(result.date.getMonth() + 1).padStart(2, '0'), String(result.date.getDate()).padStart(2, '0')].join('-');
  assert.equal(text, date); assert.equal(result.shift, shift);
});
function exportFixture(manual = true) {
  const date = '2026-09-26', cells = new Map();
  const payload = {ok: true, targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh', canEdit: true,
    sourceLog: {id: 'test-source', revision: 1}, item: manual ? {targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh', revision: 1,
      values: {generatorEcmsGen1: 1000500.125, ismartReception: 0, epowerTransmission: 888777.25, solarDailyGeneration: 154.375}} : null,
    solarCumulative: manual ? {monthly: 12345.5, yearly: 98765.25} : null};
  const context = vm.createContext({window: {
    morningMeetingClosedCofiring: {valuesForWorkbook: (data, options) => options.suppressClosedValues ? {} : {...data, sludgeTotal: 116.73}},
    toNightPower: {valuesForWorkbook: (data, options) => pure.mergeValues(data, payload, options.targetDate, options.suppressClosedValues)}
  }, setMorningMeetingNumericCellValue: (_doc, address, value) => { cells.set(address, value); return {found: true, written: true}; }});
  vm.runInContext(sourceFunction('applyMorningMeetingDailyDataValues'), context);
  const data = {generatorEcmsGen1: 100, ismartReception: 2, epowerTransmission: 98, solarDailyGeneration: 4,
    unitOneProduction: 300, unitTwoProduction: 250, solarMonthlyCumulative: 999, solarYearlyCumulative: 8888};
  return {cells, context, data, date};
}
test('actual workbook function converts thermal power kWh to MWh, not solar', () => {
  const f = exportFixture(); f.context.applyMorningMeetingDailyDataValues({}, f.data, {targetDate: f.date});
  assert.equal(f.cells.get('AK7'), 1000.500125); assert.equal(f.cells.get('AK8'), 888.77725);
  assert.equal(f.cells.get('AK9'), 0); assert.equal(f.cells.get('H18'), 154.375);
});
test('actual workbook overlays TO solar cumulative while preserving steam, organic and formulas', () => {
  const f = exportFixture(); f.context.applyMorningMeetingDailyDataValues({}, f.data, {targetDate: f.date});
  assert.equal(f.cells.get('E7'), 300); assert.equal(f.cells.get('E8'), 250);
  assert.equal(f.cells.get('M18'), 12345.5); assert.equal(f.cells.get('V18'), 98765.25); assert.equal(f.cells.get('AH14'), 116.73);
  for (const address of ['E11', 'AN7', 'AN8', 'AN9', 'AM11', 'AE13']) assert.equal(f.cells.has(address), false);
  assert.equal(f.data.generatorEcmsGen1, 100); assert.equal(f.data.solarMonthlyCumulative, 999);
});
test('no manual record retains existing same-date workbook values', () => {
  const f = exportFixture(false); f.context.applyMorningMeetingDailyDataValues({}, f.data, {targetDate: f.date});
  assert.equal(f.cells.get('AK7'), .1); assert.equal(f.cells.get('H18'), 4);
  assert.equal(f.cells.get('M18'), 999); assert.equal(f.cells.get('V18'), 8888);
});
test('suppressed export cannot repopulate manually saved values', () => {
  const f = exportFixture(); f.context.applyMorningMeetingDailyDataValues({}, {}, {targetDate: f.date, suppressClosedValues: true});
  assert.equal(f.cells.get('AK7'), null); assert.equal(f.cells.get('AK9'), null); assert.equal(f.cells.get('H18'), null);
});
test('mismatched manual date throws before any workbook cell write', () => {
  const f = exportFixture(); assert.throws(() => f.context.applyMorningMeetingDailyDataValues({}, f.data, {targetDate: '2026-09-25'}));
  assert.equal(f.cells.size, 0);
});

for (const replacement of [undefined, null, {}, {generatorEcmsGen1: '', ismartReception: null},
  {generatorEcmsGen1: 0, ismartReception: 0, epowerTransmission: 0, solarDailyGeneration: 0}]) {
  test('legacy/morning refresh source cannot override explicit manual values: ' + JSON.stringify(replacement), () => {
    const f = exportFixture();
    f.context.applyMorningMeetingDailyDataValues({}, replacement, {targetDate: f.date});
    assert.equal(f.cells.get('AK7'), 1000.500125);
    assert.equal(f.cells.get('AK9'), 0);
  });
}
