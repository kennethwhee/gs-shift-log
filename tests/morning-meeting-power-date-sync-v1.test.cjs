'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootPath = process.env.POWER_DATE_SYNC_SOURCE_ROOT || path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(rootPath, 'maintenance', name), 'utf8');
const PREFIX = 'efficiencyMorningMeetingAutoDaily';
const A = '2026-10-07', B = '2026-10-08', C = '2026-10-09';
const VALUE_IDS = [
  PREFIX + 'GeneratorEcmsGen1', PREFIX + 'IsmartReception',
  PREFIX + 'EpowerTransmission', PREFIX + 'SolarGeneration',
  'efficiencyMorningMeetingAutoSolarMonthlyCumulative',
  'efficiencyMorningMeetingAutoSolarYearlyCumulative'
];

class Element {
  constructor(id = '', tagName = 'SPAN') {
    this.id = id; this.tagName = tagName; this.textContent = '-';
    this.dataset = {}; this.children = []; this.hidden = false;
    this.title = ''; this.attributes = new Map(); this.listeners = new Map();
    const names = new Set();
    this.classList = {
      add: (...values) => values.forEach(value => names.add(value)),
      remove: (...values) => values.forEach(value => names.delete(value)),
      contains: value => names.has(value),
      toggle: (value, state) => {
        const enabled = state === undefined ? !names.has(value) : Boolean(state);
        if (enabled) names.add(value); else names.delete(value);
        return enabled;
      }
    };
  }
  get childElementCount() { return this.children.length; }
  appendChild(element) { this.children.push(element); element.parent = this; return element; }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]);
    return selector === '[id]' ? all.filter(element => element.id) : [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
}

function documentFixture(readyState = 'loading') {
  const elements = new Map(), listeners = new Map();
  const head = new Element('head', 'HEAD');
  const document = {
    readyState, head, documentElement: head, body: new Element('body', 'BODY'),
    hidden: false,
    getElementById: id => elements.get(id) || head.children.find(element => element.id === id) || null,
    querySelectorAll: () => [],
    createElement: tag => new Element('', String(tag).toUpperCase()),
    addEventListener: (name, listener) => listeners.set(name, listener)
  };
  function add(id, tag = 'SPAN') {
    const element = new Element(id, tag); elements.set(id, element); return element;
  }
  return {document, elements, listeners, add};
}

function responsePayload(date, seed = 1, options = {}) {
  const values = {
    generatorEcmsGen1: seed * 1000, ismartReception: seed * 100,
    epowerTransmission: seed * 900, solarDailyGeneration: seed * 10
  };
  const item = options.missing ? null : {
    targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh', revision: options.revision || 1,
    values: options.zero ? Object.fromEntries(Object.keys(values).map(key => [key, 0])) : values,
    updatedBy: 'TO test', updatedAt: date + 'T23:00:00+09:00'
  };
  return {
    ok: true, targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh',
    canEdit: false, sourceLog: {id: 'TO-' + date, revision: 1}, item,
    solarCumulative: item ? (options.nullCumulative ? {monthly: null, yearly: null} : {monthly: seed * 30, yearly: seed * 300}) : null
  };
}

function powerFixture(options = {}) {
  const dom = documentFixture();
  const panel = dom.add('efficiencyMorningMeetingWaterPanel', 'DIV');
  panel.dataset.morningMeetingAutoBaseDate = options.date || A;
  const card = dom.add(PREFIX + 'PowerCard', 'DIV');
  const dateHeader = dom.add(PREFIX + 'PowerDate');
  dateHeader.textContent = options.date || A;
  dom.add(PREFIX + 'PowerStatus');
  for (const id of VALUE_IDS) dom.add(id);
  const requests = [], blockedDates = new Set();
  const observations = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { observations.push({observer: this, target, options}); }
    disconnect() {}
  }
  const notifyMutation = (target, attributeName) => {
    for (const observation of observations) {
      if (observation.target !== target || !observation.options.attributes) continue;
      if (observation.options.attributeFilter && !observation.options.attributeFilter.includes(attributeName)) continue;
      queueMicrotask(() => observation.observer.callback([{type: 'attributes', target, attributeName}]));
    }
  };
  const timers = new Map(); let timerId = 0;
  let token = options.token === undefined ? 'Bearer first-user' : options.token;
  const window = {
    document: dom.document,
    getShiftLogAuthHeaders: () => token ? {Authorization: token} : {},
    isMorningMeetingSelectedDateResetActive: date => blockedDates.has(date),
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: () => {},
    fetch: (url, request) => new Promise((resolve, reject) => {
      requests.push({url, request,
        respond: payload => resolve({ok: true, status: 200, text: async () => JSON.stringify(payload)}),
        fail: error => reject(error || new Error('Network temporarily unavailable'))});
    })
  };
  const context = vm.createContext({window, Headers, AbortController, queueMicrotask, MutationObserver, console});
  vm.runInContext(source('to-night-power.js'), context, {filename: 'to-night-power.js'});
  const f = {
    ...dom, panel, card, dateHeader, requests, blockedDates, window,
    api: window.toNightPower,
    render: () => window.toNightPower.renderMeeting(),
    select: date => { panel.dataset.morningMeetingAutoBaseDate = date; dateHeader.textContent = date; },
    selectObserved: date => {
      panel.dataset.morningMeetingAutoBaseDate = date; dateHeader.textContent = date;
      notifyMutation(panel, 'data-morning-meeting-auto-base-date');
    },
    initialize: () => dom.listeners.get('DOMContentLoaded')(),
    notifyMutation,
    values: () => VALUE_IDS.map(id => dom.elements.get(id).textContent),
    setValues: values => VALUE_IDS.forEach((id, index) => { dom.elements.get(id).textContent = values[index]; }),
    setToken: value => { token = value; },
    flush: async () => { for (let i = 0; i < 14; i++) await Promise.resolve(); }
  };
  if (options.view) {
    f.view = dom.add('efficiencyMorningMeetingView', 'SECTION'); f.view.hidden = true;
  }
  return f;
}

function assertReadOnlyRequests(f) {
  for (const {url, request} of f.requests) {
    assert.match(url, /^\/api\/to-night-power\?date=20\d{2}-\d{2}-\d{2}$/);
    assert.equal(request.method, 'GET');
    assert.equal(request.body, undefined);
    assert.equal(request.credentials, 'same-origin');
  }
}

function assertBlank(f) { assert.deepEqual(f.values(), ['-', '-', '-', '-', '-', '-']); }
function assertRow(f, seed) {
  const expected = [seed * 1000, seed * 100, seed * 900, seed * 10, seed * 30, seed * 300]
    .map(value => value.toLocaleString('ko-KR', {maximumFractionDigits: 6}) + ' kWh');
  assert.deepEqual(f.values(), expected);
}

test('first active meeting render reads saved TO data once and renders without a manual refresh', async () => {
  const f = powerFixture();
  f.render(); f.render(); f.render();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/to-night-power?date=' + A);
  f.requests[0].respond(responsePayload(A, 1)); await f.flush();
  assertRow(f, 1);
  f.render(); f.render(); await f.flush();
  assert.equal(f.requests.length, 1, 'render callbacks must not form a fetch loop');
  assert.equal(f.card.dataset.toPowerDate, A);
  assertReadOnlyRequests(f);
});

test('opening a previously hidden meeting reads the selected TO date', async () => {
  const f = powerFixture({view: true});
  f.render(); assert.equal(f.requests.length, 0);
  f.view.hidden = false; f.render();
  assert.equal(f.requests.length, 1);
  f.requests[0].respond(responsePayload(A, 2)); await f.flush();
  assertRow(f, 2);
  assertReadOnlyRequests(f);
});

test('changing the panel date clears old owned values even when the common header is already relabelled', async () => {
  const f = powerFixture();
  f.render(); f.requests[0].respond(responsePayload(A, 1)); await f.flush();
  f.select(B); f.render();
  assertBlank(f);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].url, '/api/to-night-power?date=' + B);
  f.requests[1].respond(responsePayload(B, 2)); await f.flush();
  assertRow(f, 2);
  assert.equal(f.card.dataset.toPowerDate, B);
  assertReadOnlyRequests(f);
});

test('selected panel date remains canonical while the closed-data helper still reports the previous date', async () => {
  const f = powerFixture({date: B});
  f.window.morningMeetingClosedCofiring = {targetDate: () => A};
  assert.equal(f.api.targetDate(), B);
  f.render();
  assert.equal(f.requests[0].url, '/api/to-night-power?date=' + B);
  f.requests[0].respond(responsePayload(B, 2)); await f.flush();
  assertRow(f, 2);
  assert.equal(f.dateHeader.textContent, B);
  assertReadOnlyRequests(f);
});

test('a previous-date card override loses both its visible value and its export raw value on navigation', async () => {
  const f = powerFixture();
  f.card.dataset.toPowerDate = A;
  f.setValues(VALUE_IDS.map(() => '999 kWh'));
  for (const id of VALUE_IDS) {
    f.elements.get(id).dataset.rawValue = '999';
    f.elements.get(id).dataset.morningCardOverride = 'true';
  }
  f.select(B); f.render();
  assertBlank(f);
  for (const id of VALUE_IDS) {
    assert.equal(Object.hasOwn(f.elements.get(id).dataset, 'rawValue'), false, id);
    assert.equal(Object.hasOwn(f.elements.get(id).dataset, 'morningCardOverride'), false, id);
  }
  f.requests[0].respond(responsePayload(B, 2)); await f.flush();
  assertRow(f, 2);
  const exportValues = f.api.valuesForWorkbook({}, {targetDate: B});
  assert.equal(exportValues.generatorEcmsGen1, 2000);
  assert.equal(exportValues.solarYearlyCumulative, 600);
  assertReadOnlyRequests(f);
});

test('real initialization observes date navigation and meeting reopen without a manual render or refresh', async () => {
  const f = powerFixture({view: true});
  f.initialize(); await f.flush();
  assert.equal(f.requests.length, 0, 'initially hidden meeting must not read TO data');
  f.view.hidden = false;
  f.notifyMutation(f.view, 'hidden'); await f.flush();
  assert.equal(f.requests.length, 1, 'opening the meeting must trigger its installed observer');
  f.requests[0].respond(responsePayload(A, 1)); await f.flush(); assertRow(f, 1);

  f.selectObserved(B); await f.flush();
  assertBlank(f);
  assert.equal(f.requests.length, 2, 'panel date observer must read the newly selected TO record');
  assert.equal(f.requests[1].url, '/api/to-night-power?date=' + B);
  f.requests[1].respond(responsePayload(B, 2)); await f.flush(); assertRow(f, 2);
  f.notifyMutation(f.panel, 'data-morning-meeting-auto-base-date'); await f.flush();
  assert.equal(f.requests.length, 2, 'same-date observer redraw must not repeatedly fetch');

  f.view.hidden = true; f.notifyMutation(f.view, 'hidden'); await f.flush();
  assert.equal(f.requests.length, 2);
  f.view.hidden = false; f.notifyMutation(f.view, 'hidden'); await f.flush();
  assert.equal(f.requests.length, 3, 'reopening must check for a newer TO input');
  f.requests[2].respond(responsePayload(B, 3, {revision: 2})); await f.flush();
  assertRow(f, 3);
  assertReadOnlyRequests(f);
});

test('rapid A to B to C navigation rejects stale visible results and a missing C row stays blank', async () => {
  const f = powerFixture();
  f.render();
  f.select(B); f.render();
  f.select(C); f.render();
  assert.equal(f.requests.length, 3); assertBlank(f);
  f.requests[1].respond(responsePayload(B, 2)); await f.flush(); assertBlank(f);
  f.requests[0].respond(responsePayload(A, 1)); await f.flush(); assertBlank(f);
  f.requests[2].respond(responsePayload(C, 3, {missing: true})); await f.flush();
  assertBlank(f);
  assert.equal(f.dateHeader.textContent, C);
  assert.equal(f.card.dataset.toPowerDate, C);
  assertReadOnlyRequests(f);
});

for (const failure of ['missing row', 'network error']) {
  test('same-date strict saved values survive TO ' + failure, async () => {
    const f = powerFixture({date: C});
    const saved = ['7,777 kWh', '0 kWh', '6,666 kWh', '12 kWh', '123 kWh', '456 kWh'];
    f.card.dataset.toPowerDate = C; f.setValues(saved);
    f.render(); assert.deepEqual(f.values(), saved);
    if (failure === 'missing row') f.requests[0].respond(responsePayload(C, 1, {missing: true}));
    else f.requests[0].fail();
    await f.flush(); assert.deepEqual(f.values(), saved);
    assertReadOnlyRequests(f);
  });
}

test('same-date confirmed TO cache survives an explicit refresh failure', async () => {
  const f = powerFixture();
  f.render(); f.requests[0].respond(responsePayload(A, 3)); await f.flush();
  const refresh = f.api.refreshMeeting(A);
  assert.equal(f.requests.length, 2);
  f.requests[1].fail(); await refresh; await f.flush();
  assertRow(f, 3);
  assertReadOnlyRequests(f);
});

test('reset suppression clears values and release reads the TO source afresh', async () => {
  const f = powerFixture();
  f.render(); f.requests[0].respond(responsePayload(A, 1)); await f.flush();
  f.blockedDates.add(A); f.render();
  assertBlank(f); assert.equal(f.requests.length, 1);
  f.render(); assert.equal(f.requests.length, 1, 'reset must suppress automatic TO GET');
  f.blockedDates.delete(A); f.render();
  assert.equal(f.requests.length, 2);
  f.requests[1].respond(responsePayload(A, 2, {revision: 2})); await f.flush();
  assertRow(f, 2);
  assertReadOnlyRequests(f);
});

test('zero TO inputs render as zero and absent solar cumulative values clear stale totals', async () => {
  const f = powerFixture();
  f.card.dataset.toPowerDate = A;
  f.setValues(['999 kWh', '999 kWh', '999 kWh', '999 kWh', '999 kWh', '999 kWh']);
  f.render(); f.requests[0].respond(responsePayload(A, 1, {zero: true, nullCumulative: true}));
  await f.flush();
  assert.deepEqual(f.values(), ['0 kWh', '0 kWh', '0 kWh', '0 kWh', '-', '-']);
  assertReadOnlyRequests(f);
});

test('changing authentication reads again and late results from its predecessor session cannot overwrite it', async () => {
  const f = powerFixture();
  f.render(); f.requests[0].respond(responsePayload(A, 1)); await f.flush();
  const oldRefresh = f.api.refreshMeeting(A);
  assert.equal(f.requests.length, 2);
  f.setToken('Bearer second-user'); f.render();
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].request.headers.get('Authorization'), 'Bearer second-user');
  f.requests[2].respond(responsePayload(A, 4)); await f.flush();
  assertRow(f, 4);
  // Simulate an old request completing despite AbortController cancellation.
  f.requests[1].respond(responsePayload(A, 9)); await oldRefresh; await f.flush();
  assertRow(f, 4);
  assertReadOnlyRequests(f);
});

function instantRestoreFixture(poisoned = false) {
  const dom = documentFixture('complete');
  const preview = dom.add('efficiencyMorningMeetingAutoPreview', 'DIV');
  const panel = dom.add('efficiencyMorningMeetingWaterPanel', 'DIV');
  panel.dataset.morningMeetingAutoBaseDate = C;
  const card = dom.add(PREFIX + 'PowerCard', 'DIV'); preview.appendChild(card);
  const powerIds = [...VALUE_IDS, PREFIX + 'PowerDate', PREFIX + 'PowerStatus'];
  for (const id of powerIds) {
    const element = dom.add(id); card.appendChild(element);
    element.textContent = id.endsWith('PowerDate') ? C : (id.endsWith('PowerStatus') ? 'TO 입력 완료' : '555 kWh');
  }
  const nonPower = [];
  for (let i = 0; i < 24; i++) {
    const element = dom.add('efficiencyMorningMeetingOtherValue' + i);
    element.textContent = poisoned ? '-' : String(100 + i) + ' t';
    nonPower.push(element); preview.appendChild(element);
  }
  const key = 'gsShiftLog.morningMeetingDisplaySnapshot.v1';
  const savedElements = Object.fromEntries([
    ...powerIds.map(id => [id, {text: 'WRONG OLD POWER 999 kWh', title: 'wrong power', stateClasses: ['is-complete']}]),
    ...nonPower.map((element, i) => [element.id, {text: String(200 + i) + ' t', title: 'valid source', stateClasses: ['is-complete']}])
  ]);
  let stored = poisoned ? JSON.stringify({version: 1, entries: {[C]: {date: C, savedAt: Date.now(), richness: 32, elements: savedElements}}}) : null;
  let timer = 0;
  const window = {
    document: dom.document, HTMLElement: Element,
    localStorage: {getItem: asked => asked === key ? stored : null, setItem: (asked, value) => { if (asked === key) stored = value; }},
    setTimeout: () => ++timer, clearTimeout: () => {}, addEventListener: () => {}
  };
  class MutationObserver { observe() {} disconnect() {} }
  vm.runInNewContext(source('morning-meeting-instant-restore-v1.js'), {window, MutationObserver, console},
    {filename: 'morning-meeting-instant-restore-v1.js'});
  return {...dom, window, card, powerIds, nonPower,
    api: window.morningMeetingInstantRestore,
    stored: () => JSON.parse(stored),
    powerTexts: () => powerIds.map(id => dom.elements.get(id).textContent)};
}

test('generic display snapshot captures other fields and excludes TO power values, date and status', () => {
  const f = instantRestoreFixture();
  assert.equal(f.api.capture(C), true);
  const entry = f.stored().entries[C];
  for (const id of f.powerIds) assert.equal(Object.hasOwn(entry.elements, id), false, 'must not capture ' + id);
  for (const element of f.nonPower) assert.equal(entry.elements[element.id].text, element.textContent);
});

test('old poisoned generic snapshots never restore or guard TO power, while other saved cards restore normally', () => {
  const f = instantRestoreFixture(true);
  const expectedPower = f.powerIds.map(id => id.endsWith('PowerDate') ? C : (id.endsWith('PowerStatus') ? 'TO 입력 완료' : '555 kWh'));
  assert.deepEqual(f.powerTexts(), expectedPower, 'initial restore must ignore old cached power entries');
  for (let i = 0; i < f.nonPower.length; i++) assert.equal(f.nonPower[i].textContent, String(200 + i) + ' t');
  for (const id of f.powerIds) f.elements.get(id).textContent = '-';
  f.nonPower[0].textContent = '-';
  assert.equal(f.api.restore(C), true);
  assert.deepEqual(f.powerTexts(), f.powerIds.map(() => '-'));
  assert.equal(f.nonPower[0].textContent, '200 t');
  assert.equal(f.api.capture(C), true);
  for (const id of f.powerIds) assert.equal(Object.hasOwn(f.stored().entries[C].elements, id), false,
    'rewriting an existing snapshot must remove poisoned field ' + id);
});
