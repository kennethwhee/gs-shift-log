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
  make('loadEfficiencyMorningMeetingWaterButton', preview);
  make('efficiencyMorningMeetingAutoPreviewStatus', preview);
  const organicBadge = make('organicSiloDataParcStatus', document);
  organicBadge.dataset.queryTargetDate = '2026-09-01';
  make('resetEfficiencyMorningMeetingButton');
  const events = []; document.dispatchEvent = event => events.push(event);
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
    runEfficiencyMorningMeetingBulkLookup: async options => { calls.push({ source: 'operations', options }); return successfulOperations(); },
    loadEfficiencyMorningMeetingDailyData: async options => { calls.push({ source: 'workbook', options }); const result = { sourceDate: panel.dataset.morningMeetingAutoBaseDate, sludgeTotal: 0 }; window.efficiencyMorningMeetingUploadState.steamStatus = result; return result; }
  };
  class FixedDate extends Date {
    static now() { return Date.parse('2026-09-08T12:00:00Z'); }
  }
  vm.runInContext(source, vm.createContext({ window, document, console, Map, Set, Date: FixedDate, CustomEvent: class { constructor(type) { this.type = type; } },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(node, options) { this.node = node; this.options = options; } },
    getShiftLogSessionToken: () => token }));
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  return { events, api: window.morningMeetingQuerySources, window, document, panel, grid, dateBar, calls, inventory, organicBadge,
    make, observers, timers, flush, byId: document.getElementById,
    signedIn: value => { token = value; }, mobile: value => { mobile = value; } };
}


function successfulOperations() {
  return ['water', 'limestone', 'gear-pinion', 'silo-level', 'smp-price', 'weather'].map(key =>
    ({ status: 'fulfilled', value: { key, status: 'fulfilled', result: { value: 0 } } }));
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const queryIds = ['morningMeetingAllQueryButton', 'morningMeetingOperationsQueryButton', 'morningMeetingWorkbookQueryButton'];

test('three compact buttons mount once after the date and hide the replaced bulk button', () => {
  const h = harness();
  assert.equal(h.dateBar.nextSibling.id, 'morningMeetingQuerySources');
  assert.deepEqual(queryIds.map(id => h.byId(id).textContent), ['전체자료', '운영정보조회', '엑셀 조회하기']);
  assert.equal(h.byId('loadEfficiencyMorningMeetingWaterButton').hidden, true);
  assert.equal(h.byId('efficiencyMorningMeetingAutoPreviewStatus').hidden, true);
  for (let i = 0; i < 4; ++i) h.api.render();
  assert.equal(h.document.querySelectorAll('#morningMeetingQuerySources').length, 1);
  assert.equal(h.calls.length, 0);
});

test('each individual source launches only its own loader and all launches exactly both', async () => {
  for (const [mode, expected] of [['operations', ['operations']], ['workbook', ['workbook']], ['all', ['operations', 'workbook']]]) {
    const h = harness();
    await h.api.query(mode, { userInitiated: true });
    assert.deepEqual(h.calls.map(call => call.source), expected);
    const workbook = h.calls.find(call => call.source === 'workbook');
    if (workbook) assert.deepEqual(JSON.parse(JSON.stringify(workbook.options)), {
      userInitiated: true, forceRefresh: true, querySource: 'daily_data_excel' });
    const operations = h.calls.find(call => call.source === 'operations');
    if (operations) assert.deepEqual(JSON.parse(JSON.stringify(operations.options)), { userInitiated: true, targetDate: '2026-09-01' });
  }
});

test('all remains busy until both sources settle and rejects repeated or cross-source requests', async () => {
  const h = harness(); let finishOperations, finishWorkbook;
  h.window.runEfficiencyMorningMeetingBulkLookup = () => {
    h.calls.push({ source: 'operations' }); return new Promise(resolve => { finishOperations = resolve; });
  };
  h.window.loadEfficiencyMorningMeetingDailyData = () => {
    h.calls.push({ source: 'workbook' }); return new Promise(resolve => { finishWorkbook = resolve; });
  };
  const pending = h.api.query('all', { userInitiated: true });
  assert.equal(h.api.isBusy(), true);
  for (const mode of ['all', 'operations', 'workbook']) await h.api.query(mode, { userInitiated: true });
  assert.equal(h.calls.length, 2);
  finishOperations(successfulOperations()); await tick();
  assert.equal(h.api.isBusy(), true);
  assert.equal(h.byId('morningMeetingQuerySourceStatus-operations').textContent, '조회 완료');
  for (const id of queryIds) assert.equal(h.byId(id).disabled, true);
  finishWorkbook({ sludgeTotal: 0 }); await pending;
  assert.equal(h.api.isBusy(), false);
  for (const id of queryIds) assert.equal(h.byId(id).disabled, false);
  assert.deepEqual(h.events.map(event => event.type), ['morningMeetingQueryModeStateChanged', 'morningMeetingQueryModeStateChanged']);
});

test('a synchronous error in either loader cannot prevent the other source from starting or finishing', async () => {
  for (const failed of ['operations', 'workbook']) {
    const h = harness();
    const failedLoader = failed === 'operations' ? 'runEfficiencyMorningMeetingBulkLookup' : 'loadEfficiencyMorningMeetingDailyData';
    h.window[failedLoader] = () => { h.calls.push({ source: failed }); throw Error(`${failed} failed`); };
    const result = await h.api.query('all', { userInitiated: true });
    assert.deepEqual(h.calls.map(call => call.source), ['operations', 'workbook']);
    assert.equal(result.filter(item => item.status === 'rejected').length, 1);
    assert.equal(h.byId(`morningMeetingQuerySourceStatus-${failed}`).textContent, '조회 실패');
    const succeeded = failed === 'operations' ? 'workbook' : 'operations';
    assert.equal(h.byId(`morningMeetingQuerySourceStatus-${succeeded}`).textContent, '조회 완료');
    if (succeeded === 'workbook') assert.equal(h.window.efficiencyMorningMeetingUploadState.steamStatus.sludgeTotal, 0);
    assert.equal(h.api.isBusy(), false);
  }
});

test('a swallowed workbook failure stays failed while operations complete and saved Excel values survive', async () => {
  const h = harness(); const saved = { sourceDate: '2026-09-01', organicSiloTotal: 9 };
  h.window.efficiencyMorningMeetingUploadState.steamStatus = saved;
  h.window.loadEfficiencyMorningMeetingDailyData = async () => {
    h.panel.dataset.steamStatusTargetDate = '2026-09-01'; h.panel.dataset.steamStatusStatus = 'error';
    h.window.efficiencyMorningMeetingUploadState.steamStatusError = '월간 Excel 파일을 열어 주세요.'; return null;
  };
  await h.api.query('all', { userInitiated: true });
  assert.equal(h.byId('morningMeetingQuerySourceStatus-operations').textContent, '조회 완료');
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 실패');
  assert.match(h.byId('morningMeetingQuerySourceStatus-workbook').title, /기존 저장값을 유지/);
  assert.equal(h.window.efficiencyMorningMeetingUploadState.steamStatus, saved);
});

test('operations reports partial failure for rejected or swallowed null items, without inventing success', async () => {
  for (const failed of [{ status: 'rejected', reason: Error('weather failed') },
    { status: 'fulfilled', value: { key: 'weather', status: 'fulfilled', result: null } }]) {
    const h = harness();
    h.window.runEfficiencyMorningMeetingBulkLookup = async () => [...successfulOperations().slice(0, 5), failed];
    await h.api.query('operations', { userInitiated: true });
    assert.equal(h.byId('morningMeetingQuerySourceStatus-operations').textContent, '일부 실패');
    assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
  }
  const h = harness(); h.window.runEfficiencyMorningMeetingBulkLookup = async () => [];
  await h.api.query('operations', { userInitiated: true });
  assert.equal(h.byId('morningMeetingQuerySourceStatus-operations').textContent, '조회 종료');
});

test('automatic, signed-out, mobile, invalid dates, and unknown modes cannot start either source', async () => {
  const h = harness();
  for (const mode of ['all', 'operations', 'workbook']) {
    await h.api.query(mode);
    h.signedIn(''); await h.api.query(mode, { userInitiated: true }); h.signedIn('token');
    h.mobile(true); await h.api.query(mode, { userInitiated: true }); h.mobile(false);
    h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-31'; await h.api.query(mode, { userInitiated: true });
    h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-01';
  }
  await h.api.query('dataparc', { userInitiated: true });
  assert.equal(h.calls.length, 0);
});

test('external operations or workbook requests block new mode launches even across dates', async () => {
  const h = harness();
  h.window.__efficiencyMorningMeetingBulkLookupPromise = Promise.resolve();
  for (const mode of ['all', 'operations', 'workbook']) await h.api.query(mode, { userInitiated: true });
  delete h.window.__efficiencyMorningMeetingBulkLookupPromise;
  h.panel.dataset.steamStatusStatus = 'processing'; h.panel.dataset.steamStatusTargetDate = '2026-08-31';
  for (const mode of ['all', 'operations', 'workbook']) await h.api.query(mode, { userInitiated: true });
  assert.equal(h.calls.length, 0);
  h.api.render(); for (const id of queryIds) assert.equal(h.byId(id).disabled, true);
});

test('a late source failure or completion cannot report the previous date on the new date', async () => {
  const h = harness(); let finishOperations, rejectWorkbook;
  h.window.runEfficiencyMorningMeetingBulkLookup = () => new Promise(resolve => { finishOperations = resolve; });
  h.window.loadEfficiencyMorningMeetingDailyData = () => new Promise((resolve, reject) => { rejectWorkbook = reject; });
  const pending = h.api.query('all', { userInitiated: true });
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-10-01'; h.api.render();
  rejectWorkbook(Error('September failure')); finishOperations(successfulOperations()); await pending;
  for (const source of ['operations', 'workbook']) assert.equal(h.byId(`morningMeetingQuerySourceStatus-${source}`).textContent, '조회 전');
  assert.equal(h.calls.length, 0);
  assert.equal(h.api.isBusy(), false);
});

test('mini workbook controls retain a coordinator lock and toolbar changes do not loop the observer', () => {
  const h = harness(); const mini = h.byId('efficiencyMorningMeetingAutoSteamRefreshButton');
  mini.dataset.morningBulkLocked = 'true'; h.api.render(); assert.equal(mini.disabled, true);
  const observer = h.observers[0];
  observer.fn([{ type: 'childList', addedNodes: [h.byId('morningMeetingQuerySources')] }]);
  assert.equal(h.timers.size, 0);
  observer.fn([{ type: 'attributes', addedNodes: [] }]); observer.fn([{ type: 'attributes', addedNodes: [] }]);
  assert.equal(h.timers.size, 1); h.flush(); assert.equal(h.calls.length, 0);
});
