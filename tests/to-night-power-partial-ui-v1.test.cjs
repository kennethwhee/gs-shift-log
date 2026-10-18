'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.TO_POWER_SOURCE_ROOT || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'maintenance/to-night-power.js'), 'utf8');
const pureContext = {module: {exports: {}}};
vm.runInNewContext(source, pureContext);
const pure = pureContext.module.exports;
const DATE = '2026-10-18', NEXT_DATE = '2026-10-19';
const PREFIX = 'efficiencyMorningMeetingAutoDaily';
const KEYS = pure.FIELDS.map(([key]) => key);
const VALUES = {generatorEcmsGen1: 125000.25, ismartReception: null, epowerTransmission: 110000, solarDailyGeneration: 50};
const IDS = Object.fromEntries(pure.FIELDS.map(([key, , suffix]) => [key, PREFIX + suffix]));
const plain = value => JSON.parse(JSON.stringify(value));

function payload(values = VALUES, options = {}) {
  const date = options.date || DATE;
  return {
    ok: true, targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh',
    canEdit: options.canEdit !== false, sourceLog: {id: 'employee-position:test-to', revision: 1},
    item: values === null ? null : {targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh',
      revision: options.revision || 1, values: {...values}, updatedBy: 'TO test'},
    solarCumulative: values === null ? null : values.solarDailyGeneration === null
      ? {monthly: null, yearly: null} : {monthly: 1500, yearly: 12000}
  };
}

// Exercise actual installed listeners and generated form, using the same VM / DOM
// fixture approach as the existing morning-meeting power date-sync regression suite.
class Element {
  constructor(tag = 'span') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parent = null;
    this.attributes = new Map(); this.listeners = new Map(); this.dataset = {};
    this.value = ''; this.disabled = false; this.hidden = false; this.open = false; this._text = '';
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, on = !this.classes.has(name)) => {
        if (on) this.classes.add(name); else this.classes.delete(name); return on;
      }
    };
  }
  set id(value) { this.attributes.set('id', value); }
  get id() { return this.attributes.get('id') || ''; }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(markup) {
    this.children = []; this._text = ''; this.markup = markup;
    const stack = [this];
    for (const token of markup.match(/<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (token.startsWith('<')) {
        const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
        const element = new Element(tag);
        for (const match of token.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
          element.setAttribute(match[1], match[2] ?? '');
        }
        stack.at(-1).appendChild(element);
        if (!['input', 'br'].includes(tag)) stack.push(element);
      } else stack.at(-1)._text += token;
    }
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[')) {
      const name = selector.slice(1, -1);
      if (name.startsWith('data-')) return Object.hasOwn(this.dataset, name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
      return this.attributes.has(name);
    }
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(part => part.trim());
    return this.all().filter(element => selectors.some(part => {
      const segments = part.split(/\s+/); if (!element.matches(segments.pop())) return false;
      let ancestor = element.parent;
      while (segments.length) {
        const match = segments.pop();
        while (ancestor && !ancestor.matches(match)) ancestor = ancestor.parent;
        if (!ancestor) return false; ancestor = ancestor.parent;
      }
      return true;
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = value;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatch(name) { this.listeners.get(name)?.({target: this, preventDefault() {}, stopPropagation() {}}); }
  get elements() { return {namedItem: name => this.querySelectorAll('input').find(input => input.getAttribute('name') === name)}; }
  reset() { for (const input of this.querySelectorAll('input')) input.value = ''; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  getClientRects() { return this.hidden ? [] : [{}]; }
}

function fixture() {
  const body = new Element('body'), listeners = new Map(), requests = [];
  const document = {body, readyState: 'loading', hidden: false,
    createElement: tag => new Element(tag),
    getElementById: id => body.all().find(element => element.id === id) || null,
    querySelectorAll: selector => body.querySelectorAll(selector),
    addEventListener: (name, callback) => listeners.set(name, callback)};
  const add = (id, tag = 'span', parent = body) => {
    const element = new Element(tag); element.id = id; parent.appendChild(element); return element;
  };
  const grid = add('shiftMemberGrid', 'div');
  const dutyCard = add('toDutyCard', 'div', grid); dutyCard.dataset.role = 'TO'; dutyCard.className = 'shift-member-card';
  const panel = add('efficiencyMorningMeetingWaterPanel', 'div'); panel.dataset.morningMeetingAutoBaseDate = DATE;
  const card = add(PREFIX + 'PowerCard', 'div'); card.dataset.toPowerDate = DATE;
  add(PREFIX + 'PowerDate').textContent = DATE;
  const status = add(PREFIX + 'PowerStatus');
  for (const id of [...Object.values(IDS), 'efficiencyMorningMeetingAutoSolarMonthlyCumulative', 'efficiencyMorningMeetingAutoSolarYearlyCumulative']) add(id).textContent = '-';
  let token = 'Bearer test-to';
  const window = {document, getShiftLogAuthHeaders: () => token ? {Authorization: token} : {},
    setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, confirm: () => true,
    fetch: (url, request) => new Promise((resolve, reject) => requests.push({url, request,
      respond: data => resolve({ok: true, status: 200, text: async () => JSON.stringify(data)}),
      fail: () => reject(new Error('Test refresh failure'))}))};
  const appState = {selectedDate: DATE, selectedShift: 'NS', logs: []};
  const context = vm.createContext({window, appState, formatInputDate: date => date, Headers, AbortController,
    MutationObserver: class {observe() {}}, queueMicrotask, console});
  vm.runInContext(source, context);
  const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
  return {window, document, requests, status, panel, card, appState, flush,
    get: id => document.getElementById(id),
    button: () => dutyCard.querySelector('[data-to-night-power-button]'),
    start: async data => { listeners.get('DOMContentLoaded')(); await flush(); requests.at(-1).respond(data); await flush(); },
    open: async data => { dutyCard.querySelector('[data-to-night-power-button]').dispatch('click'); await flush(); requests.at(-1).respond(data); await flush(); },
    input: key => document.getElementById('toNightPower-' + key),
    submit: async () => { document.getElementById('toNightPowerDialog').querySelector('form').dispatch('submit'); await flush(); },
    setToken: value => { token = value; },
    select: date => { appState.selectedDate = date; panel.dataset.morningMeetingAutoBaseDate = date; }
  };
}

test('blank input means unknown; zero remains explicit and malformed numbers are rejected', () => {
  for (const value of ['', ' ', null, undefined]) assert.equal(pure.parseInput(value), null);
  assert.equal(pure.parseInput('0'), 0); assert.equal(pure.parseInput('1,234.50'), 1234.5);
  for (const value of ['1,2', '-1', 'NaN', 'Infinity', '1e3', 'abc']) assert.throws(() => pure.parseInput(value));
});

test('partial server row keeps all four keys including null and rejects malformed or empty records', () => {
  assert.deepEqual(plain(pure.normalizePayload(payload(), DATE).item.values), VALUES);
  for (const mutate of [
    p => delete p.item.values.ismartReception,
    p => p.item.values.ismartReception = '',
    p => p.item.values.ismartReception = undefined,
    p => p.item.values.ismartReception = NaN,
    p => p.item.values.ismartReception = Infinity,
    p => p.item.values = Object.fromEntries(KEYS.map(key => [key, null]))
  ]) { const invalid = payload(); mutate(invalid); assert.throws(() => pure.normalizePayload(invalid, DATE)); }
  const inherited = payload(); inherited.item.values = Object.create(VALUES);
  assert.throws(() => pure.normalizePayload(inherited, DATE));
});

test('missing solar input cannot be paired with fabricated cumulative totals', () => {
  const p = payload({...VALUES, solarDailyGeneration: null});
  assert.equal(pure.normalizePayload(p, DATE).solarCumulative.monthly, null);
  p.solarCumulative.monthly = 0;
  assert.throws(() => pure.normalizePayload(p, DATE));
});

test('workbook merge preserves unknown values and clears stale canonical, alias and solar totals', () => {
  const original = {ismartReception: 9, electricityReceived: 9, solarDailyGeneration: 9, solarDaily: 9,
    solarMonthlyCumulative: 99, solarYearlyCumulative: 999, solarCumulative: {month: {total: 99}}, steamSales: 25};
  const result = pure.mergeValues(original, payload({...VALUES, solarDailyGeneration: null}), DATE);
  for (const key of ['ismartReception', 'electricityReceived', 'solarDailyGeneration', 'solarDaily',
    'solarMonthlyCumulative', 'solarYearlyCumulative', 'solarCumulative']) assert.equal(result[key], null, key);
  assert.equal(result.steamSales, 25); assert.equal(original.ismartReception, 9);
  assert.equal(pure.mergeValues(original, payload(null), DATE).ismartReception, 9);
  assert.equal(pure.mergeValues(original, payload(), DATE, true).ismartReception, 9);
});

test('actual form submits three entered fields and null reception; partial cards stay incomplete', async () => {
  const f = fixture(); await f.start(payload(null)); await f.open(payload(null));
  for (const key of KEYS) {
    assert.equal(f.input(key).getAttribute('required'), null);
    assert.equal(f.input(key).getAttribute('placeholder'), '미입력');
    f.input(key).value = VALUES[key] === null ? '' : String(VALUES[key]);
  }
  await f.submit();
  const write = f.requests.at(-1); assert.equal(write.request.method, 'POST');
  assert.deepEqual(JSON.parse(write.request.body).values, VALUES);
  write.respond(payload()); await f.flush();
  assert.equal(f.get('toNightPowerDialog').open, false);
  assert.equal(f.button().textContent, '일부 입력 3/4');
  assert.equal(f.button().classList.contains('is-complete'), false);
  assert.equal(f.status.textContent, 'TO 일부 입력 3/4');
  assert.equal(f.status.classList.contains('is-complete'), false);
  assert.equal(f.get(IDS.ismartReception).textContent, '-');
  assert.equal(f.get(IDS.generatorEcmsGen1).textContent, '125,000.25 kWh');
  assert.equal(f.window.toNightPower.valuesForWorkbook({}, {targetDate: DATE}).ismartReception, null);
});

test('partial dialog reopens blank unknown field; completing it changes count and green state', async () => {
  const f = fixture(); await f.start(payload()); await f.open(payload());
  assert.equal(f.input('ismartReception').value, '');
  assert.match(f.get('toNightPowerDialog').querySelector('.to-night-power-help').textContent, /빈칸은 기존 저장값을 유지/);
  f.input('ismartReception').value = '0'; await f.submit();
  const write = f.requests.at(-1);
  assert.equal(JSON.parse(write.request.body).values.ismartReception, 0);
  assert.equal(JSON.parse(write.request.body).expectedRevision, 1);
  write.respond(payload({...VALUES, ismartReception: 0}, {revision: 2})); await f.flush();
  assert.equal(f.button().textContent, '✓ 입력 완료');
  assert.equal(f.button().classList.contains('is-complete'), true);
  assert.equal(f.status.textContent, 'TO 입력 완료');
  assert.equal(f.get(IDS.ismartReception).textContent, '0 kWh');
});

test('blanking a saved field submits null and shows the authoritative server-preserved value', async () => {
  const full = {...VALUES, ismartReception: 33};
  const f = fixture(); await f.start(payload(full)); await f.open(payload(full));
  f.input('ismartReception').value = ''; f.input('generatorEcmsGen1').value = '130000'; await f.submit();
  const write = f.requests.at(-1);
  assert.equal(JSON.parse(write.request.body).values.ismartReception, null);
  write.respond(payload({...full, generatorEcmsGen1: 130000}, {revision: 2})); await f.flush();
  assert.equal(f.get(IDS.ismartReception).textContent, '33 kWh');
  assert.equal(f.status.textContent, 'TO 입력 완료');
});

test('empty form and invalid number do not POST or lose typed values', async () => {
  const f = fixture(); await f.start(payload(null)); await f.open(payload(null));
  const count = f.requests.length; await f.submit();
  assert.equal(f.requests.length, count); assert.match(f.get('toNightPowerMessage').textContent, /하나 이상/);
  f.input('generatorEcmsGen1').value = '12'; f.input('ismartReception').value = '1,2'; await f.submit();
  assert.equal(f.requests.length, count); assert.equal(f.input('generatorEcmsGen1').value, '12');
  assert.equal(f.input('ismartReception').getAttribute('aria-invalid'), 'true');
});

test('read-only user sees partial status and unknown blank but cannot submit', async () => {
  const data = payload(VALUES, {canEdit: false}); const f = fixture(); await f.start(data); await f.open(data);
  assert.match(f.button().textContent, /일부 입력 3\/4/);
  assert.equal(f.button().classList.contains('is-complete'), false);
  assert.equal(f.input('ismartReception').value, ''); assert.equal(f.input('ismartReception').readOnly, true);
  assert.equal(f.get('toNightPowerSave').hidden, true);
  const count = f.requests.length; await f.submit(); assert.equal(f.requests.length, count);
});

test('partial refresh failure retains entered fields without null-format crashes or invented solar totals', async () => {
  const f = fixture();
  const unknownIds = [IDS.ismartReception, IDS.solarDailyGeneration,
    'efficiencyMorningMeetingAutoSolarMonthlyCumulative', 'efficiencyMorningMeetingAutoSolarYearlyCumulative'];
  for (const id of unknownIds) { f.get(id).textContent = '99 kWh'; f.get(id).dataset.rawValue = '99'; f.get(id).dataset.morningCardOverride = 'true'; }
  await f.start(payload({...VALUES, solarDailyGeneration: null}));
  for (const id of unknownIds) {
    assert.equal(f.get(id).textContent, '-'); assert.equal(Object.hasOwn(f.get(id).dataset, 'rawValue'), false);
  }
  const refreshing = f.window.toNightPower.refreshMeeting(); f.requests.at(-1).fail(); await refreshing; await f.flush();
  assert.equal(f.get(IDS.ismartReception).textContent, '-');
  assert.equal(f.get(IDS.generatorEcmsGen1).textContent, '125,000.25 kWh');
  assert.match(f.status.textContent, /마지막 저장값 유지/);
});

test('partial record keeps stale revision and equal-revision value-change protections', () => {
  const prior = payload(VALUES, {revision: 2});
  assert.throws(() => pure.acceptRefresh(prior, payload(), DATE));
  assert.throws(() => pure.acceptRefresh(prior, payload({...VALUES, ismartReception: 0}, {revision: 2}), DATE));
  assert.equal(pure.acceptRefresh(prior, payload({...VALUES, ismartReception: 0}, {revision: 3}), DATE).item.values.ismartReception, 0);
  assert.equal(prior.item.values.ismartReception, null);
});

test('same-date saved partial card remains partial when the TO row is unavailable', async () => {
  const f = fixture();
  for (const key of KEYS) f.get(IDS[key]).textContent = VALUES[key] === null ? '-' : VALUES[key] + ' kWh';
  f.status.classList.add('is-complete');
  await f.start(payload(null));
  assert.equal(f.status.textContent, '기존 저장값 · 일부 입력 3/4');
  assert.equal(f.status.classList.contains('is-complete'), false);
  assert.equal(f.get(IDS.ismartReception).textContent, '-');
});

test('same-date saved partial card has no completion color without a signed-in TO session', async () => {
  const f = fixture();
  for (const key of KEYS) f.get(IDS[key]).textContent = VALUES[key] === null ? '-' : VALUES[key] + ' kWh';
  f.status.classList.add('is-complete'); f.setToken('');
  f.window.toNightPower.renderMeeting(); await f.flush();
  assert.equal(f.status.textContent, '저장값 · 일부 입력 3/4');
  assert.equal(f.status.classList.contains('is-complete'), false);
  assert.equal(f.requests.length, 0);
});

test('date change still blocks an open partial form from saving to the wrong day', async () => {
  const f = fixture(); await f.start(payload()); await f.open(payload());
  f.select(NEXT_DATE); f.input('ismartReception').value = '17';
  const count = f.requests.length; await f.submit();
  assert.equal(f.requests.length, count); assert.match(f.get('toNightPowerMessage').textContent, /근무가 바뀌/);
});

test('session change closes an open partial form and prevents its POST', async () => {
  const f = fixture(); await f.start(payload()); await f.open(payload());
  f.setToken('Bearer different-user'); const count = f.requests.length; await f.submit();
  assert.equal(f.requests.length, count); assert.equal(f.get('toNightPowerDialog').open, false);
});
