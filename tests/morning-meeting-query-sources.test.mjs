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
  const completeOperations = [{ status:'fulfilled',value:{status:'fulfilled',result:{value:0}} }];
  const window = {
    efficiencyMorningMeetingUploadState: {}, navigator: { userAgent: 'Windows', platform: 'Win32' },
    matchMedia: () => ({ matches: mobile }), addEventListener() {},
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    runEfficiencyMorningMeetingBulkLookup: async options => { calls.push({source:'operations',options}); return completeOperations; },
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

test('source controls mount once after the date without changing card contents or starting queries', () => {
  const h = harness();
  assert.equal(h.dateBar.nextSibling.id, 'morningMeetingQuerySources');
  assert.equal(h.byId('morningMeetingAllQueryButton').textContent, '전체자료');
  assert.equal(h.byId('morningMeetingOperationsQueryButton').textContent, '운영정보조회');
  assert.equal(h.byId('morningMeetingWorkbookQueryButton').textContent, '엑셀 조회하기');
  assert.match(h.byId('morningMeetingQuerySources').textContent, /운영정보/);
  assert.match(h.byId('morningMeetingQuerySources').textContent, /열린 대상 월 파일에서 4개 카드 조회/);
  for (const id of cardIds) {
    const body = h.byId(`${id}-body`);
    assert.equal(body.children.length, 1, 'rendering does not insert obsolete source labels');
    assert.equal(h.byId(`${id}-value`).textContent, 'unchanged');
  }
  for (let i = 0; i < 3; i += 1) h.api.render();
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-02'; h.api.render();
  assert.equal(h.document.querySelectorAll('#morningMeetingQuerySources').length, 1);
  assert.equal(h.document.querySelectorAll('.morning-meeting-workbook-source').length, 0);
  assert.equal(h.calls.length, 0);
});

test('explicit source buttons route only to the chosen loader with the workbook intent guard', async () => {
  const h = harness();
  h.byId('morningMeetingOperationsQueryButton').click();
  await new Promise(resolve => setImmediate(resolve));
  h.byId('morningMeetingWorkbookQueryButton').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    { source: 'operations', options: { userInitiated: true, targetDate:'2026-09-01' } },
    { source: 'workbook', options: { userInitiated: true, forceRefresh: true, querySource: 'daily_data_excel' } }
  ]);
});

test('automatic callers, signed-out/mobile callers and unavailable DataPARC dates cannot start work', async () => {
  const h = harness();
  for (const sourceName of ['operations', 'workbook']) {
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

test('operations success is independent of workbook failure, including a zero-valued result', async () => {
  const h = harness();
  await h.api.query('operations', {userInitiated:true});
  h.panel.dataset.steamStatusTargetDate = '2026-09-01'; h.panel.dataset.steamStatusStatus = 'error';
  const original = { sourceDate: '2026-09-01', sludgeTotal: 0, generatorEcmsGen1: 4 };
  h.window.efficiencyMorningMeetingUploadState = { steamStatus: original, steamStatusError: 'workbook unavailable' };
  h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-operations').textContent, '조회 완료');
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 실패');
  assert.match(h.byId('morningMeetingQuerySourceStatus-workbook').title, /기존 저장값을 유지/);
  assert.equal(h.window.efficiencyMorningMeetingUploadState.steamStatus, original);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-02'; h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
  assert.equal(h.byId('morningMeetingQuerySourceStatus-operations').textContent, '조회 전');
});

test('workbook values cannot mark operations complete or reuse another date status', () => {
  const h = harness();
  h.window.efficiencyMorningMeetingUploadState.steamStatus = { sourceDate: '2026-09-01', organicSiloTotal: 9, sludgeTotal: 30 };
  h.panel.dataset.steamStatusTargetDate = '2026-09-01'; h.panel.dataset.steamStatusStatus = 'complete';
  h.organicBadge.classList.toggle('is-error', true); h.organicBadge.title = 'old query error';
  h.organicBadge.dataset.queryTargetDate = '2026-08-31';
  h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 완료');
  assert.equal(h.byId('morningMeetingQuerySourceStatus-operations').textContent, '조회 전');
  h.window.efficiencyMorningMeetingUploadState.steamStatus = { sourceDate: '2026-09-01' };
  h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 전');
  h.window.efficiencyMorningMeetingUploadState.steamStatus.sludgeTotal = 0;
  h.api.render();
  assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent, '조회 완료');
});

test('duplicate and second-source requests wait for the active query; late resolution does not complete a new date', async () => {
  const h = harness(); let resolveQuery;
  h.window.runEfficiencyMorningMeetingBulkLookup = options => {
    h.calls.push({ source: 'dataparc', options }); return new Promise(resolve => { resolveQuery = resolve; });
  };
  const pending = h.api.query('operations', { userInitiated: true });
  await h.api.query('operations', { userInitiated: true });
  await h.api.query('workbook', { userInitiated: true });
  assert.equal(h.calls.length, 1);
  assert.equal(h.byId('morningMeetingWorkbookQueryButton').disabled, true);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-02'; h.api.render();
  resolveQuery({ organicSiloTotal: 5 }); await pending;
  assert.equal(h.byId('morningMeetingQuerySourceStatus-operations').textContent, '조회 전');
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

test('closed-card mode explains separate sources and leaves their refresh controls to the provider', () => {
  const h = harness();
  const closed = h.make('morningMeetingCofiringRefreshButton');
  closed.disabled = false; closed.title = 'saved closing';
  h.window.morningMeetingClosedCofiring = {};
  h.window.efficiencyMorningMeetingUploadState.steamStatus = {sourceDate:'2026-09-01',powerGeneration:4};
  h.panel.dataset.steamStatusTargetDate = '2026-09-01';
  h.panel.dataset.steamStatusStatus = 'loading';
  h.api.render();
  assert.match(h.byId('morningMeetingWorkbookSource').textContent, /혼소율·유기성: 마감자료/);
  assert.equal(closed.disabled, false);
  assert.equal(closed.title, 'saved closing');
});

test('authenticated narrow-screen reader may check reset state without starting any company-PC work', async () => {
  const h = harness(), requests = [];
  h.mobile(true);
  h.window.fetch = async (url, options) => {
    requests.push({url, options});
    return {ok:true,json:async()=>({ok:true,item:{targetDate:'2026-09-01',active:false,revision:0}})};
  };
  const reset = await h.api.loadResetStatus('2026-09-01');
  assert.equal(reset.active, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'GET');
  assert.match(requests[0].url, /morning_meeting_auto_history_reset_status/);
  assert.equal(await h.api.query('workbook',{userInitiated:true}),null);
  assert.equal(h.calls.length, 0);
});
test('workbook status excludes obsolete co-firing and organic values when closed cards are active', () => {
  const h=harness();h.window.morningMeetingClosedCofiring={};
  h.window.efficiencyMorningMeetingUploadState.steamStatus={sourceDate:'2026-09-01',sludgeTotal:30,coalUsageUnitOne:123};
  h.api.render();assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent,'조회 전');
  h.window.efficiencyMorningMeetingUploadState.steamStatus.powerGeneration=0;
  h.api.render();assert.equal(h.byId('morningMeetingQuerySourceStatus-workbook').textContent,'조회 완료');
});
