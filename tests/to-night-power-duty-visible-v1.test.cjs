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
const DATE = '2026-11-02', NEXT_DATE = '2026-11-03';
const PREFIX = 'efficiencyMorningMeetingAutoDaily';
const KEYS = pure.FIELDS.map(([key]) => key);
const VALUES = {generatorEcmsGen1: 125000.25, ismartReception: null, epowerTransmission: 110000, solarDailyGeneration: 50};
const IDS = Object.fromEntries(pure.FIELDS.map(([key, , suffix]) => [key, PREFIX + suffix]));
const COMPLETE = {...VALUES, ismartReception: 0};

function payload(values = VALUES, options = {}) {
  const date = options.date || DATE;
  return {
    ok: true, targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh',
    ...(options.omitCapabilities ? {} : {capabilities: options.capabilities || {partialValues: true, clearFields: true}}),
    canEdit: options.canEdit !== false, sourceLog: options.canEdit === false ? null : {id: 'employee-position:test-to', revision: 1},
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
  const meetingView = add('efficiencyMorningMeetingView', 'section'); meetingView.hidden = true;
  const panel = add('efficiencyMorningMeetingWaterPanel', 'div'); panel.dataset.morningMeetingAutoBaseDate = DATE;
  const card = add(PREFIX + 'PowerCard', 'div'); card.dataset.toPowerDate = DATE;
  add(PREFIX + 'PowerDate').textContent = DATE;
  const status = add(PREFIX + 'PowerStatus');
  for (const id of [...Object.values(IDS), 'efficiencyMorningMeetingAutoSolarMonthlyCumulative', 'efficiencyMorningMeetingAutoSolarYearlyCumulative']) add(id).textContent = '-';
  let token = 'Bearer test-to';
  const window = {document, getShiftLogAuthHeaders: () => token ? {Authorization: token} : {},
    setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, confirm: () => true,
    updateShiftMemberCardStates() {}, clearCurrentUser() { token = ''; },
    fetch: (url, request) => new Promise((resolve, reject) => requests.push({url, request,
      respond: (data, status = 200) => resolve({ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data)}),
      fail: () => reject(new Error('Test refresh failure'))}))};
  const appState = {selectedDate: DATE, selectedShift: 'NS', logs: []};
  const context = vm.createContext({window, appState, formatInputDate: date => date, Headers, AbortController,
    MutationObserver: class {observe() {}}, queueMicrotask, console});
  vm.runInContext(source, context);
  const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
  return {window, document, requests, status, panel, card, appState, flush,
    get: id => document.getElementById(id),
    button: () => dutyCard.querySelector('[data-to-night-power-button]'),
    init: async () => { listeners.get('DOMContentLoaded')(); await flush(); },
    start: async data => { listeners.get('DOMContentLoaded')(); await flush(); requests.at(-1).respond(data); await flush(); },
    click: async () => { dutyCard.querySelector('[data-to-night-power-button]').dispatch('click'); await flush(); },
    repaint: async () => { window.updateShiftMemberCardStates(); await flush(); },
    open: async data => { dutyCard.querySelector('[data-to-night-power-button]').dispatch('click'); await flush(); requests.at(-1).respond(data); await flush(); },
    input: key => document.getElementById('toNightPower-' + key),
    submit: async () => { document.getElementById('toNightPowerDialog').querySelector('form').dispatch('submit'); await flush(); },
    setToken: value => { token = value; },
    select: date => { appState.selectedDate = date; panel.dataset.morningMeetingAutoBaseDate = date; }
  };
}

for (const failure of ['network', 'server']) {
  test(`initial ${failure} failure keeps a visible retry and never repeats GET automatically`, async () => {
    const f = fixture(); await f.init();
    assert.equal(f.button().hidden, false);
    assert.equal(f.button().disabled, true);
    assert.equal(f.requests[0].request.method, 'GET');
    if (failure === 'network') f.requests[0].fail();
    else f.requests[0].respond({ok: false, message: '전력 서버 점검 중입니다.'}, 503);
    await f.flush();
    assert.equal(f.button().hidden, false);
    assert.equal(f.button().disabled, false);
    assert.equal(f.button().textContent, '전력 확인 실패 · 재시도');
    assert.equal(f.button().classList.contains('is-error'), true);
    assert.equal(f.button().getAttribute('aria-busy'), null);
    assert.match(f.button().title, failure === 'network' ? /Test refresh failure/ : /서버 점검/);
    await f.repaint(); await f.repaint();
    assert.equal(f.requests.length, 1);

    await f.click();
    assert.equal(f.get('toNightPowerDialog').open, true);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].request.method, 'GET');
    assert.equal(f.requests[1].url, '/api/to-night-power?date=' + DATE);
    f.requests[1].respond(payload(null)); await f.flush();
    assert.equal(f.button().textContent, '전력 입력');
    assert.equal(f.get('toNightPowerSave').hidden, false);
    assert.equal(f.get('toNightPowerSave').disabled, false);
    assert.equal(f.requests.filter(row => row.request.method === 'POST').length, 0);
  });
}

test('failed retry shows the server message and cannot save until a fresh GET succeeds', async () => {
  const f = fixture(); await f.init(); f.requests[0].fail(); await f.flush();
  await f.click();
  f.requests[1].respond({ok: false, message: '전력 저장자료를 불러올 수 없습니다.'}, 503); await f.flush();
  assert.match(f.get('toNightPowerMessage').textContent, /전력 저장자료를 불러올 수 없습니다/);
  assert.equal(f.get('toNightPowerSave').hidden, true);
  assert.equal(f.get('toNightPowerSave').disabled, true);
  const count = f.requests.length; await f.submit();
  assert.equal(f.requests.length, count);
  f.get('toNightPowerDialog').querySelector('footer [data-close]').dispatch('click');
  await f.click();
  assert.equal(f.requests.at(-1).request.method, 'GET');
  f.requests.at(-1).respond(payload(null)); await f.flush();
  for (const key of KEYS) f.input(key).value = String(COMPLETE[key]);
  await f.submit();
  assert.equal(f.requests.at(-1).request.method, 'POST');
  const body = JSON.parse(f.requests.at(-1).request.body);
  assert.equal(body.targetDate, DATE);
  assert.equal(body.sourceLogId, 'employee-position:test-to');
  assert.equal(body.expectedRevision, 0);
  f.requests.at(-1).respond(payload(COMPLETE)); await f.flush();
  assert.equal(f.get('toNightPowerDialog').open, false);
  assert.equal(f.button().textContent, '✓ 입력 완료');
  assert.equal(f.button().classList.contains('is-complete'), true);
  assert.equal(f.button().classList.contains('is-error'), false);
  assert.equal(f.requests.filter(row => row.request.method === 'POST').length, 1);
});

for (const [name, values, label, complete] of [
  ['complete', COMPLETE, '✓ 입력 완료', true],
  ['partial', VALUES, '일부 입력 3/4', false],
  ['empty', null, '전력 미입력', false]
]) {
  test(`non-TO sees ${name} saved status and can only read the dialog`, async () => {
    const data = payload(values, {canEdit: false});
    const f = fixture(); await f.start(data);
    assert.equal(f.button().hidden, false);
    assert.equal(f.button().textContent, label);
    assert.equal(f.button().classList.contains('is-complete'), complete);
    assert.equal(f.button().classList.contains('is-readonly'), true);
    assert.match(f.button().title, /읽기 전용/);
    await f.open(data);
    assert.equal(f.get('toNightPowerTitle').textContent, '전력 실적 확인');
    assert.equal(f.get('toNightPowerSave').hidden, true);
    assert.equal(f.get('toNightPowerSave').disabled, true);
    assert.equal(f.get('toNightPowerReload').hidden, true);
    for (const key of KEYS) {
      assert.equal(f.input(key).readOnly, true);
      assert.equal(f.input(key).value, String(values?.[key] ?? ''));
    }
    // Even a forged change and form submit cannot turn a read-only GET into POST.
    f.input(KEYS[0]).value = '999';
    const count = f.requests.length; await f.submit();
    assert.equal(f.requests.length, count);
    assert.equal(f.requests.every(row => row.request.method === 'GET'), true);
  });
}

for (const canEdit of [true, false]) {
  for (const [name, values, status] of [
    ['complete', COMPLETE, '✓ 입력 완료'],
    ['partial', VALUES, '일부 입력 3/4']
  ]) {
    test(`${name} ${canEdit ? 'TO' : 'non-TO'} status is explicitly last-saved during loading and failure`, async () => {
      const data = payload(values, {canEdit}); const f = fixture(); await f.start(data);
      const refresh = f.window.toNightPower.refreshMeeting(); await f.flush();
      assert.equal(f.button().hidden, false);
      assert.equal(f.button().disabled, true);
      assert.equal(f.button().textContent, `마지막 저장 · ${status} · 확인 중…`);
      assert.equal(f.button().classList.contains('is-checking'), true);
      assert.equal(f.button().getAttribute('aria-busy'), 'true');
      f.requests.at(-1).fail(); await refresh; await f.flush();
      assert.equal(f.button().hidden, false);
      assert.equal(f.button().disabled, false);
      assert.equal(f.button().textContent, `마지막 저장 · ${status} · 확인 실패 · 재시도`);
      assert.equal(f.button().classList.contains('is-error'), true);
      assert.match(f.button().title, /마지막 확인된 저장값/);
      const count = f.requests.length; await f.repaint();
      assert.equal(f.requests.length, count);
      assert.equal(f.requests.every(row => row.request.method === 'GET'), true);
      await f.open(data);
      assert.equal(f.button().textContent, status);
      assert.equal(f.button().classList.contains('is-error'), false);
    });
  }
}

for (const status of [401, 403]) {
  test(`HTTP ${status} discards retained status and leaves a retry without edit access`, async () => {
    const f = fixture(); await f.start(payload(COMPLETE));
    const refresh = f.window.toNightPower.refreshMeeting(); await f.flush();
    f.requests.at(-1).respond({ok: false, message: '로그인 권한을 확인해 주세요.'}, status);
    await refresh; await f.flush();
    assert.equal(f.button().textContent, '전력 확인 실패 · 재시도');
    assert.equal(f.button().hidden, false);
    assert.equal(f.button().classList.contains('is-complete'), false);
    await f.click();
    f.requests.at(-1).respond(payload(COMPLETE, {canEdit: false})); await f.flush();
    assert.equal(f.get('toNightPowerSave').hidden, true);
    const count = f.requests.length; await f.submit();
    assert.equal(f.requests.length, count);
  });
}

test('D/S hides the action and starts no power request; returning to N/S rechecks saved status', async () => {
  const f = fixture(); await f.start(payload(COMPLETE));
  f.appState.selectedShift = 'DS'; const count = f.requests.length; await f.repaint();
  assert.equal(f.button().hidden, true);
  assert.equal(f.requests.length, count);
  // The handler also protects a synthetic click on the hidden action.
  await f.click(); assert.equal(f.get('toNightPowerDialog'), null);
  assert.equal(f.requests.length, count);
  f.appState.selectedShift = 'NS'; await f.repaint();
  assert.equal(f.button().hidden, false);
  assert.equal(f.button().textContent, '마지막 저장 · ✓ 입력 완료 · 확인 중…');
  assert.equal(f.requests.length, count + 1);
  f.requests.at(-1).respond(payload(COMPLETE)); await f.flush();
  assert.equal(f.button().textContent, '✓ 입력 완료');
});

test('date change isolates completion and cannot save an open dialog to another duty', async () => {
  const f = fixture(); await f.start(payload(COMPLETE)); await f.open(payload(COMPLETE));
  f.select(NEXT_DATE); await f.repaint();
  assert.equal(f.requests.at(-1).url, '/api/to-night-power?date=' + NEXT_DATE);
  assert.equal(f.button().textContent, '확인 중…');
  assert.equal(f.button().classList.contains('is-complete'), false);
  f.input('ismartReception').value = '15'; const count = f.requests.length; await f.submit();
  assert.equal(f.requests.length, count);
  assert.match(f.get('toNightPowerMessage').textContent, /근무가 바뀌/);
  f.requests.at(-1).respond(payload(null, {date: NEXT_DATE, canEdit: false})); await f.flush();
  assert.equal(f.button().textContent, '전력 미입력');
});

test('session change clears completion, closes the dialog, and rejects the previous in-flight response', async () => {
  const f = fixture(); await f.start(payload(COMPLETE)); await f.open(payload(COMPLETE));
  const refresh = f.window.toNightPower.refreshMeeting(); await f.flush();
  const oldRequest = f.requests.at(-1);
  f.setToken('Bearer another-position'); await f.repaint();
  const newRequest = f.requests.at(-1);
  assert.notEqual(newRequest, oldRequest);
  assert.equal(oldRequest.request.signal.aborted, true);
  assert.equal(f.get('toNightPowerDialog').open, false);
  assert.equal(f.button().textContent, '확인 중…');
  assert.equal(f.button().classList.contains('is-complete'), false);
  oldRequest.respond(payload(COMPLETE)); await refresh; await f.flush();
  assert.equal(f.button().textContent, '확인 중…');
  newRequest.respond(payload(null, {canEdit: false})); await f.flush();
  assert.equal(f.button().textContent, '전력 미입력');
  assert.equal(f.requests.every(row => row.request.method === 'GET'), true);
  const count = f.requests.length; f.window.clearCurrentUser(); await f.flush();
  assert.equal(f.button().hidden, true);
  assert.equal(f.requests.length, count);
});

