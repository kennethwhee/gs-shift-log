const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = readFileSync(path.join(__dirname, '../script.js'), 'utf8').replace(/\r\n/g, '\n');
function select(start, end, after = 0) {
  const first = script.indexOf(start, after), last = script.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source boundary: ${start}`);
  return script.slice(first, last);
}
const number = value => value == null || String(value).trim() === '' ? null :
  Number.isFinite(Number(value)) ? Number(value) : null;

test('final workbook applies closed organic quantities without changing power or mutating the daily result', () => {
  const writes = new Map();
  const daily = { generatorEcmsGen1: 1000, sludgeTruckCount: 5, sludgeTotal: 999,
    organicDaySilo: 9, organicStorageSiloA: 9, organicStorageSiloB: 9 };
  const before = JSON.stringify(daily);
  const context = vm.createContext({ window: { morningMeetingClosedCofiring: {
    valuesForWorkbook(value) {
      assert.equal(value, daily);
      return { ...value, sludgeTruckCount: null, sludgeTotal: 42,
        organicDaySilo: 1.234567, organicStorageSiloA: 0, organicStorageSiloB: 2 };
    }
  } }, setMorningMeetingNumericCellValue(_doc, address, value) {
    writes.set(address, value); return { found: true, written: true };
  } });
  vm.runInContext(select('function applyMorningMeetingDailyDataValues(', 'async function createMorningMeetingWorkbook()'), context);
  context.applyMorningMeetingDailyDataValues({}, daily);
  assert.equal(writes.get('AK7'), 1);
  assert.equal(writes.get('AH14'), 42);
  assert.equal(writes.get('AH13'), null);
  assert.equal(writes.get('AC14'), 1.234567);
  assert.equal(writes.get('X14'), 0);
  assert.equal(writes.get('Z14'), 2);
  assert.equal(writes.has('AE13'), false, 'inventory total formula is retained');
  assert.equal(JSON.stringify(daily), before);
});

test('a missing or reset close clears organic workbook cells even when the workbook has stale values', () => {
  const writes = new Map();
  const context = vm.createContext({ window: { morningMeetingClosedCofiring: {
    valuesForWorkbook(value) { return { generatorEcmsGen1: value.generatorEcmsGen1 }; }
  } }, setMorningMeetingNumericCellValue(_doc, address, value) {
    writes.set(address, value); return { found: true, written: true };
  } });
  vm.runInContext(select('function applyMorningMeetingDailyDataValues(', 'async function createMorningMeetingWorkbook()'), context);
  context.applyMorningMeetingDailyDataValues({}, { generatorEcmsGen1: 1000, sludgeTruckCount: 5,
    sludgeTotal: 999, organicDaySiloLevel: 9, organicStorageSiloALevel: 9, organicStorageSiloBLevel: 9 });
  assert.equal(writes.get('AK7'), 1);
  for (const address of ['AH13', 'AH14', 'AC14', 'X14', 'Z14']) assert.equal(writes.get(address), null, address);
});

test('latched export suppression reaches the provider even after the live reset becomes inactive', () => {
  const writes = new Map();
  const options = { suppressClosedValues: true, targetDate: '2026-09-01' };
  const context = vm.createContext({ window: {
    isMorningMeetingSelectedDateResetActive: () => false,
    morningMeetingClosedCofiring: {
      valuesForWorkbook(value, received) {
        assert.equal(received, options);
        return received.suppressClosedValues ? value : { ...value, sludgeTotal: 42,
          organicDaySilo: 1, organicStorageSiloA: 2, organicStorageSiloB: 3 };
      }
    }
  }, setMorningMeetingNumericCellValue(_doc, address, value) {
    writes.set(address, value); return { found: true, written: true };
  } });
  vm.runInContext(select('function applyMorningMeetingDailyDataValues(', 'async function createMorningMeetingWorkbook()'), context);
  context.applyMorningMeetingDailyDataValues({}, {}, options);
  for (const address of ['AH13', 'AH14', 'AC14', 'X14', 'Z14']) assert.equal(writes.get(address), null, address);
});

test('actual workbook call sites propagate the same frozen source date and suppression to both writers', () => {
  for (const suppress of [false, true]) for (const hasProvider of [false, true]) {
    const observed = [];
    let previewDate = '2026-09-02';
    const context = vm.createContext({ worksheetDocument: {}, dailyDataForWorkbook: {},
      suppressAutomaticWorkbookValues: suppress, expectedWaterSourceDate: '2026-09-01',
      applyMorningMeetingDailyDataValues(_doc, _daily, options) {
        observed.push(['daily', JSON.parse(JSON.stringify(options))]);
      }, window: { ...(hasProvider ? { morningMeetingClosedCofiring: { targetDate: () => previewDate } } : {}),
        applyMorningMeetingCofiringExcelValues(_doc, options) {
        observed.push(['cofiring', JSON.parse(JSON.stringify(options))]);
      } } });
    vm.runInContext(select('const closedValuesTargetDate =', 'const isSelectedAutomaticDateReset ='), context);
    // Navigation during the asynchronous template read must not change the export's selected date.
    previewDate = '2026-09-03';
    vm.runInContext(select('const dailyDataResult =', 'console.log('), context);
    vm.runInContext(select('const cofiringFinalExcelResult =', '\n\nif ('), context);
    const capturedDate = hasProvider ? '2026-09-02' : '2026-09-01';
    assert.deepEqual(observed, [
      ['daily', { suppressClosedValues: suppress, targetDate: capturedDate }],
      ['cofiring', { suppressClosedValues: suppress, targetDate: capturedDate }]
    ]);
  }
  const generation = select('async function createMorningMeetingWorkbook()', 'const closedValuesTargetDate =');
  assert.doesNotMatch(generation, /\bawait\s/, 'capture occurs before the asynchronous output/template work');
});

test('every daily-data renderer pass gives the closed organic card final control of its values and metadata', () => {
  const cell = () => ({ textContent: '' });
  const card = {}, date = cell(), status = cell();
  const elements = { card, cards: [card], dates: [date], panel: { dataset: { steamStatusStatus: 'complete' } },
    organicDaySilo: cell(), organicStorageSiloA: cell(), organicStorageSiloB: cell(), organicSiloTotal: cell(),
    sludgeTotal: cell(), sludgeTruckCount: cell(), generatorEcmsGen1: cell() };
  const state = { steamStatus: { schemaVersion: 2, sludgeEntries: Array(10).fill({ amount: null }),
    sourceDate: '2026-09-01', workbook: '26.09-일일DATA관리.xlsx', organicDaySilo: 999,
    organicStorageSiloA: 999, organicStorageSiloB: 999, organicSiloTotal: 2997, generatorEcmsGen1: 1000 } };
  let calls = 0, closed = true;
  const context = vm.createContext({ normalizeNumber: number, normalizeText: v => String(v ?? '').trim(),
    getElements: () => elements, getState: () => state, resolveTargetDate: () => '2026-09-01',
    setStatusBadge(_kind, label) { status.textContent = label; },
    formatOrganicSilo: v => v === null ? '-' : `${v} ton`, formatAmount: v => v === null ? '-' : String(v),
    window: { morningMeetingQuerySources: { render() {} }, morningMeetingClosedCofiring: {
      renderOrganic() {
        calls += 1;
        date.textContent = '2026-09-01 · 혼소율 마감';
        status.textContent = closed ? '마감값' : '마감 자료 없음';
        card.title = '혼소율 마감';
        for (const key of ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB', 'organicSiloTotal']) {
          elements[key].textContent = closed ? '0 ton' : '-';
        }
      }
    } } });
  vm.runInContext(select('  function isCompleteDailyDataResult(', '  function setStatusBadge(') +
    select('  function renderSteamStatus()', '  function scheduleRender()'), context);
  context.renderSteamStatus();
  assert.equal(elements.organicDaySilo.textContent, '0 ton');
  assert.equal(date.textContent, '2026-09-01 · 혼소율 마감');
  assert.equal(card.title, '혼소율 마감');
  assert.notEqual(elements.generatorEcmsGen1.textContent, '-');
  closed = false;
  context.renderSteamStatus();
  assert.equal(elements.organicDaySilo.textContent, '-');
  assert.equal(status.textContent, '마감 자료 없음');
  assert.equal(calls, 2);
});

test('organic mini refresh only reloads shared closed data while power and steam retain workbook refresh', async () => {
  const calls = [];
  const window = { morningMeetingClosedCofiring: { async refresh(options) {
    calls.push(['closed', JSON.parse(JSON.stringify(options))]); return 'closed';
  } }, morningMeetingQuerySources: { async query(source, options) {
    calls.push([source, JSON.parse(JSON.stringify(options))]); return 'workbook';
  } } };
  const context = vm.createContext({ window });
  const miniStart = script.indexOf('(function installMorningMeetingDailyDataMiniRefreshButtons()');
  vm.runInContext(select('  async function refreshDailyData(item)', '  function installButton(', miniStart), context);
  assert.equal(await context.refreshDailyData({ section: 'organic' }), 'closed');
  assert.deepEqual(calls, [['closed', { force: true }]]);
  await context.refreshDailyData({ section: 'power' });
  await context.refreshDailyData({ section: 'steam' });
  assert.deepEqual(calls.slice(1), [['workbook', { userInitiated: true }], ['workbook', { userInitiated: true }]]);
  delete window.morningMeetingClosedCofiring;
  assert.equal(await context.refreshDailyData({ section: 'organic' }), 'workbook');
});
