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

test('source controls mount after the date, label workbook rows and never query on render or navigation', () => {
  const h = harness();
  assert.equal(h.dateBar.nextSibling.id, 'morningMeetingQuerySources');
  assert.equal(h.byId('efficiencyMorningMeetingAutoPreview').dataset.querySourcesReady, 'true');
  assert.equal(h.byId('morningMeetingDataParcQueryButton').textContent, '조회하기');
  assert.equal(h.byId('morningMeetingWorkbookQueryButton').textContent, '조회하기');
  assert.match(h.byId('morningMeetingQuerySources').textContent, /DataPARC유기성 Silo 재고/);
  assert.match(h.byId('morningMeetingQuerySources').textContent, /일일 DATA 엑셀전력·증기·혼소율·유기성 입고/);
  for (const id of cardIds) {
    const body = h.byId(`${id}-body`);
    assert.match(body.firstChild.textContent, /일일 DATA 엑셀/);
    assert.equal(h.byId(`${id}-value`).textContent, 'unchanged');
  }
  for (let i = 0; i < 3; i += 1) h.api.render();
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-02'; h.api.render();
  assert.equal(h.document.querySelectorAll('#morningMeetingQuerySources').length, 1);
  assert.equal(h.document.querySelectorAll('.morning-meeting-workbook-source').length, 4);
  assert.equal(h.calls.length, 0);
});

test('explicit source buttons route only to the chosen loader with the workbook intent guard', async () => {
  const h = harness();
  h.byId('morningMeetingDataParcQueryButton').click();
  await new Promise(resolve => setImmediate(resolve));
  h.byId('morningMeetingWorkbookQueryButton').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    { source: 'dataparc', options: { userInitiated: true, forceRefresh: true } },
    { source: 'workbook', options: { userInitiated: true, forceRefresh: true, querySource: 'daily_data_excel' } }
  ]);
});

test('automatic callers, signed-out/mobile callers and unavailable DataPARC dates cannot start work', async () => {
  const h = harness();
  for (const sourceName of ['dataparc', 'workbook']) {
    await h.api.query(sourceName);
    h.signedIn(''); await h.api.query(sourceName, { userInitiated: true });
    h.signedIn('token'); h.mobile(true); await h.api.query(sourceName, { userInitiated: true });
    h.mobile(false);
  }
  await h.api.query('other', { userInitiated: true });
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-08'; await h.api.query('dataparc', { userInitiated: true });
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-02-30'; await h.api.query('workbook', { userInitiated: true });
  assert.equal(h.calls.length, 0);
  h.mobile(true); h.api.render();
  assert.equal(h.byId('morningMeetingWorkbookQueryButton').hidden, true);
});

test('DataPARC success is independent of workbook failure and zero inventory is a saved result', () => {
  const h = harness();
  h.inventory.set('2026-09-01', { organicSiloTotal: 0 });
  h.panel.dataset.steamStatusTargetDate = '2026-09-01'; h.panel.dataset.steamStatusStatus = 'error';
  const original = { sourceDate: '2026-09-01', sludgeTotal: 0, generatorEcmsGen1: 4 };
  h.window.efficiencyMorningMeetingUploadState = { steamStatus: original, steamStatusError: 'workbook unavailable' };
  h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-dataparc').textContent, '조회 완료');
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 실패');
  assert.match(h.byId('morningMeetingQuerySourceStatus-workbook').title, /기존 저장값을 유지/);
  assert.equal(h.window.efficiencyMorningMeetingUploadState.steamStatus, original);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-02'; h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
  assert.equal(h.byId('morningMeetingQuerySourceStatus-dataparc').textContent, '조회 전');
});

test('workbook fallback inventory never marks DataPARC complete, and old DataPARC errors stay on their date', () => {
  const h = harness();
  h.window.efficiencyMorningMeetingUploadState.steamStatus = { sourceDate: '2026-09-01', organicSiloTotal: 9, sludgeTotal: 30 };
  h.panel.dataset.steamStatusTargetDate = '2026-09-01'; h.panel.dataset.steamStatusStatus = 'complete';
  h.organicBadge.classList.toggle('is-error', true); h.organicBadge.title = 'old query error';
  h.organicBadge.dataset.queryTargetDate = '2026-08-31';
  h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 완료');
  assert.equal(h.byId('morningMeetingQuerySourceStatus-dataparc').textContent, '조회 전');
  h.window.efficiencyMorningMeetingUploadState.steamStatus = { sourceDate: '2026-09-01' };
  h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
  h.window.efficiencyMorningMeetingUploadState.steamStatus.sludgeTotal = 0;
  h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 완료');
});

test('duplicate and second-source requests wait for the active query; late resolution does not complete a new date', async () => {
  const h = harness(); let resolveQuery;
  h.window.organicSiloDataParc.load = options => {
    h.calls.push({ source: 'dataparc', options }); return new Promise(resolve => { resolveQuery = resolve; });
  };
  const pending = h.api.query('dataparc', { userInitiated: true });
  await h.api.query('dataparc', { userInitiated: true });
  await h.api.query('workbook', { userInitiated: true });
  assert.equal(h.calls.length, 1);
  assert.equal(h.byId('morningMeetingWorkbookQueryButton').disabled, true);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-02'; h.api.render();
  resolveQuery({ organicSiloTotal: 5 }); await pending;
  assert.equal(h.byId('morningMeetingQuerySourceStatus-dataparc').textContent, '조회 전');
  assert.equal(h.byId('morningMeetingWorkbookQueryButton').disabled, false);
});

test('loader errors keep saved workbook values and show a date-specific failure', async () => {
  const h = harness();
  const original = { sourceDate: '2026-09-01', sludgeTotal: 12 };
  h.window.efficiencyMorningMeetingUploadState.steamStatus = original;
  h.window.loadEfficiencyMorningMeetingDailyData = async () => { throw new Error('Agent unavailable'); };
  await h.api.query('workbook', { userInitiated: true });
  assert.equal(h.window.efficiencyMorningMeetingUploadState.steamStatus, original);
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 실패');
  assert.match(h.byId('morningMeetingQuerySourceStatus-workbook').title, /Agent unavailable/);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-02'; h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
});

test('the observer ignores its own controls and coalesces date changes without starting requests', () => {
  const h = harness(); const observer = h.observers[0];
  assert.equal(observer.node, h.panel);
  assert.equal(observer.options.characterData, undefined);
  observer.fn([{ type: 'childList', addedNodes: [h.byId('morningMeetingQuerySources')] }]);
  assert.equal(h.timers.size, 0);
  observer.fn([{ type: 'attributes', addedNodes: [] }]);
  observer.fn([{ type: 'attributes', addedNodes: [] }]);
  assert.equal(h.timers.size, 1);
  h.flush(); assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 0);
});
