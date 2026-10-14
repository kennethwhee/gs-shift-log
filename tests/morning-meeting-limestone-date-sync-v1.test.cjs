'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootPath = process.env.LIMESTONE_DATE_SYNC_SOURCE_ROOT || path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(rootPath, name), 'utf8');
const OLD_DATE = '2026-10-13', DATE = '2026-10-14';
const LIMESTONE_PREFIX = 'efficiencyMorningMeetingAutoLimestone';
const LIMESTONE_IDS = ['Date', 'Status', 'UnitOneStock', 'UnitTwoStock', 'Receipt',
  'ReceiptUnitOne', 'ReceiptUnitTwo', 'Usage', 'UsageUnitOne', 'UsageUnitTwo', 'FutureValue']
  .map(suffix => LIMESTONE_PREFIX + suffix);
const POWER_IDS = ['efficiencyMorningMeetingAutoDailyPowerDate',
  'efficiencyMorningMeetingAutoDailyPowerStatus',
  'efficiencyMorningMeetingAutoDailyGeneratorEcmsGen1',
  'efficiencyMorningMeetingAutoSolarYearlyCumulative'];

class Element {
  constructor(id = '', tagName = 'SPAN') {
    this.id = id; this.tagName = tagName; this.textContent = '-'; this.value = '';
    this.dataset = {}; this.children = []; this.hidden = false; this.disabled = false;
    this.attributes = new Map(); this.listeners = new Map(); this.events = [];
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
  appendChild(element) { this.children.push(element); return element; }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]);
    return selector === '[id]' ? all.filter(element => element.id) : [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  dispatchEvent(event) { this.events.push(event.type); }
  focus() {}
}

function instantRestoreFixture({poisoned = false, zero = false} = {}) {
  const elements = new Map(), observations = [], timers = new Map();
  const add = (id, tag = 'SPAN') => { const element = new Element(id, tag); elements.set(id, element); return element; };
  const head = add('head', 'HEAD');
  const document = {readyState: 'complete', head, documentElement: head,
    getElementById: id => elements.get(id) || head.children.find(element => element.id === id) || null,
    createElement: tag => new Element('', String(tag).toUpperCase()), addEventListener() {}};
  const preview = add('efficiencyMorningMeetingAutoPreview', 'DIV');
  const panel = add('efficiencyMorningMeetingWaterPanel', 'DIV');
  panel.dataset.morningMeetingAutoBaseDate = DATE;
  const limestone = LIMESTONE_IDS.map(id => {
    const element = add(id); preview.appendChild(element);
    element.textContent = id.endsWith('Date') ? DATE : id.endsWith('Status') ? '조회 대기' : (zero ? '0.00 t' : '-');
    return element;
  });
  const power = POWER_IDS.map(id => {
    const element = add(id); preview.appendChild(element);
    element.textContent = id.endsWith('PowerDate') ? DATE : '0 kWh';
    return element;
  });
  const other = Array.from({length: 24}, (_, i) => {
    const element = add('efficiencyMorningMeetingOtherValue' + i); preview.appendChild(element);
    element.textContent = poisoned ? '-' : String(100 + i) + ' t'; return element;
  });
  const key = 'gsShiftLog.morningMeetingDisplaySnapshot.v1';
  const savedElements = Object.fromEntries([
    ...LIMESTONE_IDS.map(id => [id, {text: id.endsWith('Date') ? OLD_DATE : '999.99 t', title: 'old limestone', stateClasses: ['is-complete']}]),
    ...POWER_IDS.map(id => [id, {text: '999 kWh', title: 'old power', stateClasses: ['is-complete']}]),
    ...other.map((element, i) => [element.id, {text: String(200 + i) + ' t', title: 'valid source', stateClasses: ['is-complete']}])
  ]);
  let stored = poisoned ? JSON.stringify({version: 1, entries: {
    [DATE]: {date: DATE, savedAt: Date.now(), richness: 39, elements: savedElements}
  }}) : null;
  let timerId = 0;
  const window = {document, HTMLElement: Element,
    localStorage: {getItem: asked => asked === key ? stored : null,
      setItem: (asked, value) => { if (asked === key) stored = value; }},
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id), addEventListener() {}};
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target) { observations.push({target, callback: this.callback}); }
    disconnect() {}
  }
  vm.runInNewContext(read('maintenance/morning-meeting-instant-restore-v1.js'), {window, MutationObserver, console});
  return {window, elements, limestone, power, other, preview, panel,
    api: window.morningMeetingInstantRestore,
    notifyPreview: () => observations.filter(item => item.target === preview).forEach(item => item.callback([])),
    stored: () => JSON.parse(stored),
    texts: group => group.map(element => element.textContent)};
}

test('13 to 14 navigation ignores poisoned generic limestone inventory, usage, date and status during initial restore', () => {
  const f = instantRestoreFixture({poisoned: true});
  assert.equal(f.elements.get(LIMESTONE_PREFIX + 'Date').textContent, DATE);
  assert.equal(f.elements.get(LIMESTONE_PREFIX + 'Status').textContent, '조회 대기');
  for (const element of f.limestone.filter(element => !/Date$|Status$/.test(element.id))) {
    assert.equal(element.textContent, '-', 'must not restore previous limestone field ' + element.id);
    assert.equal(element.classList.contains('is-complete'), false);
    assert.equal(element.getAttribute('title'), null);
  }
  f.other.forEach((element, i) => assert.equal(element.textContent, String(200 + i) + ' t'));
  assert.deepEqual(f.texts(f.power), POWER_IDS.map(id => id.endsWith('PowerDate') ? DATE : '0 kWh'));
});

test('generic mutation guard cannot bring old limestone values back after the owner clears them', () => {
  const f = instantRestoreFixture({poisoned: true});
  f.limestone.forEach(element => { element.textContent = '-'; element.classList.remove('is-complete'); });
  f.other[0].textContent = '-';
  f.notifyPreview();
  assert.deepEqual(f.texts(f.limestone), LIMESTONE_IDS.map(() => '-'));
  assert.equal(f.other[0].textContent, '200 t', 'other cards retain their existing instant restore guard');
});

test('generic capture removes old limestone prefix entries while retaining other cards and power exclusion', () => {
  const f = instantRestoreFixture({poisoned: true});
  assert.equal(f.api.capture(DATE), true);
  const entry = f.stored().entries[DATE];
  for (const id of [...LIMESTONE_IDS, ...POWER_IDS]) {
    assert.equal(Object.hasOwn(entry.elements, id), false, 'rewriting must remove poisoned field ' + id);
  }
  f.other.forEach(element => assert.equal(entry.elements[element.id].text, element.textContent));
  assert.equal(entry.richness, f.other.length);
});

test('current-date limestone zero values remain visible and are not recaptured by generic snapshots', () => {
  const f = instantRestoreFixture({poisoned: true, zero: true});
  const expected = LIMESTONE_IDS.map(id => id.endsWith('Date') ? DATE : id.endsWith('Status') ? '조회 대기' : '0.00 t');
  assert.deepEqual(f.texts(f.limestone), expected);
  f.notifyPreview(); assert.deepEqual(f.texts(f.limestone), expected);
  assert.equal(f.api.capture(DATE), true);
  for (const id of LIMESTONE_IDS) assert.equal(Object.hasOwn(f.stored().entries[DATE].elements, id), false);
});

const script = read('script.js');
const clientStart = script.indexOf('(function installLimestoneOisRequestClient() {');
const clientEnd = script.indexOf('\n})();', clientStart) + '\n})();'.length;
assert.ok(clientStart > 0 && clientEnd > clientStart, 'actual limestone OIS client boundaries');

const STOCK_IDS = ['limestoneUsageUnitOneStartStock', 'limestoneUsageUnitOneEndStock',
  'limestoneUsageUnitTwoStartStock', 'limestoneUsageUnitTwoEndStock'];
const DISPLAY_IDS = ['limestoneUsageUnitOneReceipt', 'limestoneUsageUnitOneUsage', 'limestoneUsageUnitOneSummary',
  'limestoneUsageUnitTwoReceipt', 'limestoneUsageUnitTwoUsage', 'limestoneUsageUnitTwoSummary', 'limestoneUsageTotalSummary'];
function records(date = DATE, zero = false) {
  return [1, 2].map(unitNo => ({unitNo, usageDate: date, startStock: zero ? 0 : 400 + unitNo,
    endStock: zero ? 0 : 390 + unitNo, receiptQuantity: zero ? 0 : 2 + unitNo,
    usageQuantity: zero ? 0 : 12 + unitNo, updatedAt: date + 'T23:00:00+09:00'}));
}
function deferred() { let resolve; const promise = new Promise(callback => { resolve = callback; }); return {promise, resolve}; }
function savedUsageFixture({date = DATE, rows, setterResult = true} = {}) {
  const nodes = new Map(), requests = [], receiptUpdates = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id); };
  node('limestoneUsageDate').value = date;
  let initialize;
  const window = {location: {origin: 'https://example.invalid'},
    setTimeout: callback => { queueMicrotask(callback); return 1; },
    setLimestoneUsageSavedReceiptQuantities: (targetDate, values) => {
      receiptUpdates.push({targetDate, values}); return setterResult;
    }, renderEfficiencyMorningMeetingAutoPreview() {}};
  const document = {readyState: 'loading', getElementById: node, querySelector: node,
    addEventListener: (name, callback) => { if (name === 'DOMContentLoaded') initialize = callback; }};
  const context = vm.createContext({window, document, URL, Event,
    console: {warn() {}, error() {}}, getShiftLogAuthHeaders: () => ({Authorization: 'synthetic-test-only'}),
    isLimestoneUsageMobileMonitorMode: () => false,
    fetch: async (url, options) => {
      requests.push({url, options});
      assert.equal(options.method, 'GET', 'saved-date navigation must not calculate or write OIS data');
      assert.equal(new URL(url).searchParams.get('action'), 'usage_records');
      const items = typeof rows === 'function' ? await rows() : (rows || records(date));
      return {ok: true, status: 200, text: async () => JSON.stringify({ok: true, items})};
    }});
  vm.runInContext(script.slice(clientStart, clientEnd), context); initialize();
  STOCK_IDS.forEach((id, i) => { node(id).value = String(100 + i); });
  DISPLAY_IDS.forEach((id, i) => { node(id).textContent = String(20 + i) + ' t'; });
  node('limestoneUsageCalculatorView').dataset.savedUsageDate = date;
  node('limestoneUsageCalculatorView').dataset.savedUsageUpdatedAt = 'old saved timestamp';
  const snapshot = () => JSON.stringify({stocks: STOCK_IDS.map(id => node(id).value),
    display: DISPLAY_IDS.map(id => node(id).textContent), dataset: node('limestoneUsageCalculatorView').dataset,
    status: node('limestoneUsageStatusTitle').textContent, description: node('limestoneUsageStatusDescription').textContent,
    events: STOCK_IDS.map(id => node(id).events)});
  return {window, node, requests, receiptUpdates, snapshot,
    restore: (targetDate = date, options) => window.loadSavedLimestoneUsageRecords(targetDate, options),
    change: nextDate => { node('limestoneUsageDate').value = nextDate; node('limestoneUsageDate').listeners.get('change')(); }};
}

for (const options of [undefined, {requireActiveUsageDate: false}]) {
  test('old-date D1 restoration is rejected before GET even when the caller does not require an active date (' + String(options?.requireActiveUsageDate) + ')', async () => {
    const f = savedUsageFixture({date: DATE, rows: records(OLD_DATE)});
    const before = f.snapshot();
    assert.equal(await f.restore(OLD_DATE, options), false);
    assert.equal(f.requests.length, 0);
    assert.equal(f.receiptUpdates.length, 0);
    assert.equal(f.snapshot(), before, 'new-date source fields and status must remain untouched');
  });
}

test('delayed D1 response for 13 is rejected after input changes to 14 without a change event', async () => {
  const gate = deferred();
  const f = savedUsageFixture({date: OLD_DATE, rows: () => gate.promise});
  const before = f.snapshot(), run = f.restore(OLD_DATE);
  assert.equal(f.requests.length, 1);
  f.node('limestoneUsageDate').value = DATE;
  gate.resolve(records(OLD_DATE));
  assert.equal(await run, false);
  assert.equal(f.receiptUpdates.length, 0);
  assert.equal(f.snapshot(), before);
});

test('a rejected calculator receipt update prevents partial D1 stocks, usage, metadata or status changes', async () => {
  const f = savedUsageFixture({setterResult: false});
  const before = f.snapshot();
  assert.equal(await f.restore(), false);
  assert.equal(f.requests.length, 1); assert.equal(f.receiptUpdates.length, 1);
  assert.equal(f.snapshot(), before);
});

test('strict current-date D1 restoration preserves legitimate zero inventories, receipts and usage', async () => {
  const f = savedUsageFixture({rows: records(DATE, true)});
  assert.equal(await f.restore(), true);
  assert.equal(f.requests.length, 1);
  assert.equal(new URL(f.requests[0].url).searchParams.get('targetDate'), DATE);
  assert.deepEqual(STOCK_IDS.map(id => f.node(id).value), ['0', '0', '0', '0']);
  assert.deepEqual(DISPLAY_IDS.map(id => f.node(id).textContent),
    ['0.00 ton', '0.00 ton', '0.00', '0.00 ton', '0.00 ton', '0.00', '0.00']);
  assert.equal(f.node('limestoneUsageCalculatorView').dataset.savedUsageDate, DATE);
  assert.equal(f.node('limestoneUsageCalculatorView').dataset.limestoneUsageStatus, 'complete');
  assert.equal(f.receiptUpdates[0].targetDate, DATE);
  assert.equal(f.receiptUpdates[0].values[1], 0); assert.equal(f.receiptUpdates[0].values[2], 0);
});

test('date navigation clears the old saved limestone provenance along with OIS metadata', () => {
  const f = savedUsageFixture({date: OLD_DATE});
  f.node('limestoneUsageCalculatorView').dataset.oisRequestId = 'old request';
  f.node('limestoneUsageCalculatorView').dataset.oisAgentId = 'old agent';
  f.change(DATE);
  const dataset = f.node('limestoneUsageCalculatorView').dataset;
  for (const key of ['savedUsageDate', 'savedUsageUpdatedAt', 'oisRequestId', 'oisAgentId']) {
    assert.equal(Object.hasOwn(dataset, key), false, 'old metadata must be removed: ' + key);
  }
});
