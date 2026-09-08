import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../maintenance/morning-meeting-query-sources.js', import.meta.url), 'utf8');
const cardIds = ['efficiencyMorningMeetingAutoDailyPowerCard', 'efficiencyMorningMeetingAutoSteamCard',
  'efficiencyMorningMeetingAutoCofiringCard', 'efficiencyMorningMeetingAutoDailySludgeCard'];

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.id = ''; this.className = ''; this.dataset = {};
    this.children = []; this.parentElement = null; this.attributes = {}; this.listeners = new Map();
    this._text = ''; this.hidden = false; this.disabled = false; this.title = '';
    this.classList = {
      contains: value => this.className.split(/\s+/).includes(value),
      toggle: (value, force) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force ?? !set.has(value)) set.add(value); else set.delete(value);
        this.className = [...set].join(' ');
      }
    };
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = value; this.children.forEach(child => { child.parentElement = null; }); this.children = []; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  append(...nodes) { nodes.forEach(node => this.insertBefore(node, null)); }
  insertBefore(node, before) {
    if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
    node.parentElement = this;
    if (before) this.children.splice(this.children.indexOf(before), 0, node); else this.children.push(node);
  }
  matches(selector) {
    if (selector[0] === '#') return this.id === selector.slice(1);
    if (selector[0] === '.') return this.classList.contains(selector.slice(1));
    return this.tagName.toLowerCase() === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  click() { if (!this.disabled && !this.hidden) (this.listeners.get('click') || []).forEach(fn => fn({ preventDefault() {} })); }
}

function harness() {
  const document = new Element('body'); document.readyState = 'complete';
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.querySelector(`#${id}`);
  const make = (id, parent = document, className = '') => {
    const node = new Element(); node.id = id; node.className = className; parent.append(node); return node;
  };
  const panel = make('efficiencyMorningMeetingWaterPanel');
  panel.dataset.morningMeetingAutoBaseDate = '2026-09-01';
  const preview = make('efficiencyMorningMeetingAutoPreview', panel);
  const grid = make('grid', preview, 'efficiency-morning-meeting-auto-preview__grid');
  const dateBar = make('dateBar', grid, 'efficiency-morning-meeting-auto-common-date');
  for (const cardId of cardIds) {
    const card = make(cardId, grid);
    const body = make(`${cardId}-body`, card, 'efficiency-morning-meeting-auto-card__body');
    make(`${cardId}-value`, body).textContent = 'unchanged';
  }
  for (const id of ['morningMeetingCofiringRefreshButton', 'efficiencyMorningMeetingAutoDailyPowerRefreshButton',
    'efficiencyMorningMeetingAutoSteamRefreshButton', 'efficiencyMorningMeetingAutoDailySludgeRefreshButton']) make(id, grid);
  const organicBadge = make('organicSiloDataParcStatus', document);
  organicBadge.dataset.queryTargetDate = '2026-09-01';
  make('resetEfficiencyMorningMeetingButton');
  const calls = []; const timers = new Map(); const observers = [];
  let timerId = 0; let token = 'signed-in'; let mobile = false;
  const inventory = new Map();
  const window = {
    efficiencyMorningMeetingUploadState: {}, navigator: { userAgent: 'Windows', platform: 'Win32' },
    matchMedia: () => ({ matches: mobile }), addEventListener() {},
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    organicSiloDataParc: {
      valuesForWorkbook: () => inventory.get(panel.dataset.morningMeetingAutoBaseDate) || {},
      load: async options => { calls.push({ source: 'dataparc', options }); return { organicSiloTotal: 0 }; }
    },
    loadEfficiencyMorningMeetingDailyData: async options => { calls.push({ source: 'workbook', options }); return { sludgeTotal: 0 }; }
  };
  class FixedDate extends Date {
    static now() { return Date.parse('2026-09-08T12:00:00Z'); }
  }
  vm.runInContext(source, vm.createContext({ window, document, console, Map, Set, Date: FixedDate,
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(node, options) { this.node = node; this.options = options; } },
    getShiftLogSessionToken: () => token }));
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  return { api: window.morningMeetingQuerySources, window, document, panel, grid, dateBar, calls, inventory, organicBadge,
    make, observers, timers, flush, byId: document.getElementById,
    signedIn: value => { token = value; }, mobile: value => { mobile = value; } };
}


const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const select = (start, end) => {
  const first = script.indexOf(start), last = script.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing boundary ${start}`);
  return script.slice(first, last);
};
const normalizeNumber = value => value === null || value === undefined || String(value).trim() === '' ? null :
  Number.isFinite(Number(value)) ? Number(value) : null;

test('workbook action stays in the compact toolbar without DataPARC source strips', () => {
  const h = harness();
  assert.equal(h.dateBar.nextSibling.id, 'morningMeetingQuerySources');
  assert.equal(h.byId('morningMeetingWorkbookQueryButton').textContent, '엑셀 조회하기');
  assert.equal(h.byId('morningMeetingDataParcQueryButton'), null);
  assert.equal(h.document.querySelectorAll('.morning-meeting-workbook-source').length, 0);
  assert.match(h.byId('morningMeetingQuerySources').textContent, /열린 대상 월 파일/);
  for (const id of cardIds) assert.equal(h.byId(`${id}-body`).firstChild.textContent, 'unchanged');
  for (let i = 0; i < 3; i += 1) h.api.render();
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-10-01'; h.api.render();
  assert.equal(h.document.querySelectorAll('#morningMeetingQuerySources').length, 1);
  assert.equal(h.calls.length, 0);
});

test('only an explicit authenticated desktop workbook action can launch; DataPARC is unreachable', async () => {
  const h = harness();
  for (const sourceName of ['dataparc', 'workbook']) {
    await h.api.query(sourceName);
    h.signedIn(''); await h.api.query(sourceName, { userInitiated: true });
    h.signedIn('token'); h.mobile(true); await h.api.query(sourceName, { userInitiated: true }); h.mobile(false);
  }
  await h.api.query('dataparc', { userInitiated: true });
  assert.equal(h.calls.length, 0);
  h.byId('morningMeetingWorkbookQueryButton').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ source: 'workbook', options: {
    userInitiated: true, forceRefresh: true, querySource: 'daily_data_excel' } }]);
});

test('saved DataPARC inventory cannot mark the workbook complete; an Excel zero is valid', () => {
  const h = harness();
  h.inventory.set('2026-09-01', { organicSiloTotal: 700 });
  h.api.render(); assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
  h.window.efficiencyMorningMeetingUploadState.steamStatus = { sourceDate: '2026-09-01', organicSiloTotal: 0 };
  h.api.render(); assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 완료');
});

test('the actual workbook name and open-file provenance follow the selected month', () => {
  const h = harness();
  h.window.efficiencyMorningMeetingUploadState.steamStatus = { sourceDate: '2026-09-01', sludgeTotal: 10,
    workbook: '26.09-일일DATA관리.xlsx', workbookFullName: 'W:\\운전\\2026\\26.09-일일DATA관리.xlsx',
    workbookSource: 'open_workbook', collectedAt: '2026-09-08T13:00:00Z' };
  h.api.render();
  assert.equal(h.byId('morningMeetingWorkbookSource').textContent, '26.09-일일DATA관리.xlsx · 열린 파일에서 조회');
  assert.match(h.byId('morningMeetingWorkbookSource').title, /W:\\운전\\2026/);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-10-01'; h.api.render();
  assert.doesNotMatch(h.byId('morningMeetingWorkbookSource').textContent, /26\.09/);
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
});

test('a duplicate query is blocked and all four card controls share the same busy/auth gate', async () => {
  const h = harness(); let finish;
  h.window.loadEfficiencyMorningMeetingDailyData = options => {
    h.calls.push({ source: 'workbook', options }); return new Promise(resolve => { finish = resolve; });
  };
  const pending = h.api.query('workbook', { userInitiated: true });
  await h.api.query('workbook', { userInitiated: true });
  assert.equal(h.calls.length, 1);
  const ids = ['morningMeetingCofiringRefreshButton', 'efficiencyMorningMeetingAutoDailyPowerRefreshButton',
    'efficiencyMorningMeetingAutoSteamRefreshButton', 'efficiencyMorningMeetingAutoDailySludgeRefreshButton'];
  for (const id of ids) assert.equal(h.byId(id).disabled, true);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-10-01'; h.api.render();
  finish({ sludgeTotal: 10 }); await pending;
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
  for (const id of ids) assert.equal(h.byId(id).disabled, false);
  h.signedIn(''); h.api.render(); for (const id of ids) assert.equal(h.byId(id).hidden, true);
});

test('failed refresh preserves the date-specific saved workbook values', async () => {
  const h = harness(); const saved = { sourceDate: '2026-09-01', organicSiloTotal: 32 };
  h.window.efficiencyMorningMeetingUploadState.steamStatus = saved;
  h.window.loadEfficiencyMorningMeetingDailyData = async () => { throw Error('2026-09 일일DATA관리 파일을 열어 주세요.'); };
  await h.api.query('workbook', { userInitiated: true });
  assert.equal(h.window.efficiencyMorningMeetingUploadState.steamStatus, saved);
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 실패');
  assert.match(h.byId('morningMeetingQuerySourceStatus-workbook').title, /기존 저장값을 유지/);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-10-01'; h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
});

test('render observer coalesces date changes and ignores its own toolbar mutations', () => {
  const h = harness(); const observer = h.observers[0];
  observer.fn([{ type: 'childList', addedNodes: [h.byId('morningMeetingQuerySources')] }]);
  assert.equal(h.timers.size, 0);
  observer.fn([{ type: 'attributes', addedNodes: [] }]); observer.fn([{ type: 'attributes', addedNodes: [] }]);
  assert.equal(h.timers.size, 1); h.flush(); assert.equal(h.calls.length, 0);
});

test('all active DataPARC hooks and assets are absent; card refreshes route to the workbook request', () => {
  assert.doesNotMatch(index, /morning-meeting-organic-silo-dataparc\.(js|css)/);
  assert.doesNotMatch(script, /organicSiloDataParc|hasOrganicSiloInventory|조회한 Silo 재고는 포함/);
  const mini = select('(function installMorningMeetingDailyDataMiniRefreshButtons()', '(function installMorningMeetingHistoryBalancedColumnWidths()');
  assert.match(mini, /morningMeetingQuerySources\?\.query\("workbook", \{ userInitiated: true \}\)/);
  assert.doesNotMatch(mini, /refreshEfficiencyMorningMeetingDailyDataSection/);
  const css = readFileSync(new URL('../maintenance/morning-meeting-query-sources.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /display:\s*none\s*!important|morning-meeting-workbook-source/);
});

test('final Excel uses only workbook values even if a legacy DataPARC object is present', () => {
  const writes = new Map();
  const context = vm.createContext({ window: { organicSiloDataParc: { valuesForWorkbook() { throw Error('DataPARC must not run'); } } },
    setMorningMeetingNumericCellValue(_doc, address, value) { writes.set(address, value); return { found: true, written: true }; } });
  vm.runInContext(select('function applyMorningMeetingDailyDataValues(', 'async function createMorningMeetingWorkbook()'), context);
  const daily = { generatorEcmsGen1: 1000, sludgeTruckCount: 2, sludgeTotal: 22,
    organicDaySilo: 6.123456789, organicStorageSiloA: 0, organicStorageSiloB: 7 };
  const before = JSON.stringify(daily);
  context.applyMorningMeetingDailyDataValues({}, daily);
  assert.equal(writes.get('AK7'), 1); assert.equal(writes.get('AH14'), 22);
  assert.equal(writes.get('AC14'), 6.123456789); assert.equal(writes.get('X14'), 0); assert.equal(writes.get('Z14'), 7);
  assert.equal(JSON.stringify(daily), before);
  context.applyMorningMeetingDailyDataValues({}, {}); assert.equal(writes.get('AC14'), null);
});

test('monthly history ignores DataPARC records while retaining daily file values and manual overrides', () => {
  const context = vm.createContext({ Map, console, normalizeText: v => String(v ?? '').trim(),
    getMonthRange: () => ({ startDate: '2026-09-01', endDate: '2026-09-30' }),
    isIsoDate: v => /^\d{4}-\d{2}-\d{2}$/.test(v), numberOrNull: normalizeNumber,
    readLocalSmpByDate: () => new Map(), addDateDays: d => d,
    applyMorningMeetingAutoHistoryOverride: (row, override) => ({ ...row, manual: override.values }),
    window: { organicSiloDataParc: { mergeHistoryRows() { throw Error('DataPARC must not run'); } } } });
  vm.runInContext(select('function mergeSavedRows(', 'function getWaterValues('), context);
  const records = [
    { targetDate: '2026-09-01', requestType: 'organic_silo_dataparc', status: 'complete', result: { organicSiloTotal: 999 } },
    { targetDate: '2026-09-01', requestType: 'daily_data_excel', status: 'complete', result: { organicSiloTotal: 0, sludgeTotal: 22 } },
    { targetDate: '2026-09-02', requestType: 'organic_silo_dataparc', status: 'complete', result: { organicSiloTotal: 88 } }
  ];
  const before = JSON.stringify(records);
  const rows = context.mergeSavedRows({ completedPayload: { items: records,
    overrides: [{ targetDate: '2026-09-01', values: { powerProduction: 15 } }] } }, '2026-09');
  assert.equal(rows.length, 1); assert.equal(rows[0].dailyData.organicSiloTotal, 0);
  assert.equal(rows[0].dailyData.sludgeTotal, 22); assert.equal(rows[0].manual.powerProduction, 15);
  assert.equal(JSON.stringify(records), before);
});

test('a valid partial workbook metric including zero makes the result usable without other cards', () => {
  const context = vm.createContext({ normalizeNumber });
  vm.runInContext(select('  function isCompleteDailyDataResult(', '  function setStatusBadge('), context);
  for (const key of ['sludgeTotal', 'organicSiloTotal', 'organicDaySilo', 'solarDailyGeneration', 'coalUsageUnitOne', 'bioUsageUnitTwo']) {
    const result = { schemaVersion: 2, sludgeEntries: Array(10).fill({ amount: null }), [key]: 0 };
    assert.equal(context.isCompleteDailyDataResult(result), true, key);
    result[key] = null; assert.equal(context.isCompleteDailyDataResult(result), false, key);
  }
});

test('opened workbook totals, blanks, precision and source metadata survive frontend normalization', () => {
  const context = vm.createContext({ console: { warn() {} }, normalizeNumber, normalizeText: v => String(v ?? '').trim() });
  vm.runInContext(select('  function normalizeSteamStatusResult(', '  function applySteamStatusResult('), context);
  for (const total of [null, 0, 27.123456789]) {
    const raw = { schemaVersion: 2, readerVersion: 'monthly-open-v1', sourceDate: '2026-09-01',
      workbook: '26.09-일일DATA관리.xlsx', workbookFullName: 'W:\\2026\\26.09-일일DATA관리.xlsx',
      workbookSource: 'open_workbook', workbookSaved: false, organicDaySilo: 1, organicStorageSiloA: 2,
      organicStorageSiloB: 3, organicSiloTotal: total, sludgeTotal: total, sludgeTruckCount: 0,
      sludgeEntries: [{ amount: 90 }], unitOneProduction: 0, unitTwoProduction: null, totalProduction: null };
    const result = context.normalizeSteamStatusResult({ result: raw, targetDate: '2026-09-01' }, '2026-09-01');
    assert.equal(result.organicSiloTotal, total); assert.equal(result.sludgeTotal, total); assert.equal(result.sludgeTruckCount, 0);
    assert.equal(result.unitOneProduction, 0); assert.equal(result.unitTwoProduction, null); assert.equal(result.totalProduction, null);
    assert.equal(result.workbook, raw.workbook); assert.equal(result.workbookFullName, raw.workbookFullName);
    assert.equal(result.workbookSaved, false); assert.equal(result.workbookSource, 'open_workbook');
  }
});

test('the actual card renderer keeps an available workbook Silo value when power and other cells are blank', () => {
  const cell = () => ({ textContent: '' });
  const card = {};
  const elements = { card, cards: [card], dates: [], panel: { dataset: { steamStatusStatus: 'complete' } },
    organicDaySilo: cell(), organicStorageSiloA: cell(), organicStorageSiloB: cell(), organicSiloTotal: cell(), generatorEcmsGen1: cell() };
  const state = { steamStatus: { schemaVersion: 2, sludgeEntries: Array(10).fill({ amount: null }),
    sourceDate: '2026-09-01', workbook: '26.09-일일DATA관리.xlsx', organicDaySilo: 0,
    organicStorageSiloA: null, organicStorageSiloB: 4.5, organicSiloTotal: null, generatorEcmsGen1: null } };
  const context = vm.createContext({ normalizeNumber, normalizeText: v => String(v ?? '').trim(),
    getElements: () => elements, getState: () => state, resolveTargetDate: () => '2026-09-01', setStatusBadge() {},
    formatOrganicSilo: v => v === null ? '-' : `${v} ton`, formatAmount: v => v === null ? '-' : String(v),
    window: { morningMeetingQuerySources: { render() {} }, organicSiloDataParc: { render() { throw Error('DataPARC must not run'); } } } });
  vm.runInContext(select('  function isCompleteDailyDataResult(', '  function setStatusBadge(') +
    select('  function renderSteamStatus()', '  function scheduleRender()'), context);
  context.renderSteamStatus();
  assert.equal(elements.organicDaySilo.textContent, '0 ton'); assert.equal(elements.organicStorageSiloA.textContent, '-');
  assert.equal(elements.organicStorageSiloB.textContent, '4.5 ton'); assert.equal(elements.organicSiloTotal.textContent, '-');
  assert.equal(elements.generatorEcmsGen1.textContent, '-'); assert.match(card.title, /26\.09-일일DATA관리.xlsx/);
});
