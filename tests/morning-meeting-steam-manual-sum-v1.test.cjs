'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.STEAM_MANUAL_SUM_SOURCE_ROOT || path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'maintenance/morning-meeting-card-overrides-v1.js'), 'utf8');
const A = '2026-10-18', B = '2026-10-19';
const IDS = {
  steamSalesLowPressure: 'efficiencyMorningMeetingAutoDailySteamSalesLowPressure',
  steamSalesHighPressure: 'efficiencyMorningMeetingAutoDailySteamSalesHighPressure',
  steamSales: 'efficiencyMorningMeetingAutoSteamSales',
  unitOneProduction: 'efficiencyMorningMeetingAutoSteamProductionUnitOne',
  unitTwoProduction: 'efficiencyMorningMeetingAutoSteamProductionUnitTwo',
  totalProduction: 'efficiencyMorningMeetingAutoSteamProductionTotal'
};

function dataName(name) { return name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
class Element {
  constructor(tag = 'span', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.dataset = {}; this.children = [];
    this.parentElement = null; this.textContent = ''; this.hidden = false; this.disabled = false;
    this.className = ''; this.attributes = new Map();
    if (tag === 'input') this.value = '';
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/), ...names])].filter(Boolean).join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name)
    };
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
    this.children.push(child); child.parentElement = this; return child;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  insertAdjacentElement(position, child) {
    assert.equal(position, 'afterend');
    const parent = this.parentElement;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, child); child.parentElement = parent;
  }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const match = selector.match(/^(\w+)?(?:\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\])?$/);
    if (!match) return false;
    if (match[1] && this.tagName !== match[1].toUpperCase()) return false;
    if (match[2]) {
      const actual = match[2].startsWith('data-') ? this.dataset[dataName(match[2])] : this.attributes.get(match[2]);
      if (actual === undefined || (match[3] !== undefined && actual !== match[3])) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [child, ...child.querySelectorAll('*')])
      .filter(child => selector === '*' || child.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
}

function fixture({source = {}, saved = null, display = {}} = {}) {
  const documentElement = new Element('html'), listeners = new Map(), frames = [];
  const elements = new Map(), rows = new Map(), requests = [], alerts = [], blocked = new Set();
  if (saved) rows.set(A, {cardKey: 'steam', revision: 1, active: true, values: {...saved}});
  const add = (tag, id, parent = documentElement) => {
    const element = new Element(tag, id); parent.appendChild(element); elements.set(id, element); return element;
  };
  const panel = add('div', 'efficiencyMorningMeetingWaterPanel');
  panel.dataset.morningMeetingAutoBaseDate = A;
  const card = add('div', 'efficiencyMorningMeetingAutoSteamCard', panel);
  card.dataset.steamSourceDate = A;
  const header = add('div', 'steam-header', card); header.className = 'efficiency-morning-meeting-auto-card__header';
  const meta = add('div', 'steam-meta', card); meta.className = 'efficiency-morning-meeting-auto-card__meta';
  for (const [key, id] of Object.entries(IDS)) {
    const wrapper = add('div', id + '-wrapper', card), element = add('span', id, wrapper);
    element.textContent = Object.hasOwn(display, key) ? String(display[key]) : Object.hasOwn(source, key) ? String(source[key]) : '-';
  }
  const document = {
    documentElement, readyState: 'complete', hidden: false,
    getElementById: id => elements.get(id) || null,
    createElement: tag => new Element(tag),
    querySelector: selector => documentElement.querySelector(selector),
    querySelectorAll: selector => documentElement.querySelectorAll(selector),
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return true; }
  };
  const window = {
    document, location: {origin: 'https://fixture.test'},
    console: {warn(){}, error(){}, log(){}},
    requestAnimationFrame: callback => {frames.push(callback); return frames.length;},
    setTimeout: () => 1, addEventListener(){},
    getEfficiencyMorningMeetingSteamOisValues: () => ({sourceDate: panel.dataset.morningMeetingAutoBaseDate, ...source}),
    isMorningMeetingSelectedDateResetActive: date => blocked.has(date),
    showToast(){}, confirm: () => true, alert: message => alerts.push(message),
    async fetch(url, options = {}) {
      const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : null;
      const date = body?.targetDate || new URL(url).searchParams.get('date');
      requests.push({url: String(url), method, body});
      let payload;
      if (method === 'GET') {
        payload = {ok: true, targetDate: date, resetActive: blocked.has(date), items: {steam: rows.get(date) || {cardKey:'steam', revision:0, active:false, values:{}}}};
      } else {
        const current = rows.get(date);
        const item = {cardKey: body.cardKey, revision:(current?.revision || 0)+1, active:method !== 'DELETE', values:method === 'DELETE' ? {} : body.values};
        rows.set(date, item); payload = {ok:true,targetDate:date,item};
      }
      return {ok:true, status:200, text:async () => JSON.stringify(payload)};
    }
  };
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const context = vm.createContext({window, console:window.console, URL, Element, CustomEvent});
  vm.runInContext(SOURCE, context, {filename:'morning-meeting-card-overrides-v1.js'});
  const event = (type, target) => document.dispatchEvent({type, target, preventDefault(){}, stopPropagation(){}});
  const input = key => document.querySelector(`input[data-morning-card-override-input="steam:${key}"]`);
  const flush = async () => {
    for (let i = 0; i < 35; i++) { const callbacks = frames.splice(0); callbacks.forEach(callback => callback()); await Promise.resolve(); }
  };
  return {
    window, api:window.morningMeetingCardOverrides, document, elements, panel, card, source, rows, requests, alerts, blocked,
    flush, input,
    display:key => elements.get(IDS[key]),
    click(action) { const button = card.querySelector(`[data-morning-card-override-action="${action}"]`); assert.ok(button, action); event('click', button); },
    type(key, value) { const element = input(key); assert.ok(element, key); element.value = value; event('input', element); },
    select(date) { panel.dataset.morningMeetingAutoBaseDate = date; }
  };
}

test('typing the screenshot low/high pressure values immediately fills 108.08 ton', async () => {
  const f = fixture(); await f.flush(); f.click('edit');
  f.type('steamSalesLowPressure', '64.11'); f.type('steamSalesHighPressure', '43.97');
  assert.equal(Number(f.input('steamSales').value), 108.08);
  f.click('save'); await f.flush();
  const saved = f.requests.find(request => request.method === 'POST').body.values;
  assert.equal(saved.steamSalesLowPressure, 64.11); assert.equal(saved.steamSalesHighPressure, 43.97); assert.equal(saved.steamSales, 108.08);
  assert.equal(f.display('steamSales').dataset.rawValue, '108.08');
  assert.equal(f.display('steamSales').dataset.morningCardOverride, 'true');
});

test('zero components form a valid zero total and are saved without a missing value', async () => {
  const f = fixture(); await f.flush(); f.click('edit');
  f.type('steamSalesLowPressure', '0'); f.type('steamSalesHighPressure', '0');
  assert.equal(Number(f.input('steamSales').value), 0);
  f.click('save'); await f.flush();
  assert.equal(f.requests.find(request => request.method === 'POST').body.values.steamSales, 0);
});

test('opening the editor fills a missing total from the existing low/high pressure fields', async () => {
  const f = fixture({display:{steamSalesLowPressure:64.11,steamSalesHighPressure:43.97}});
  await f.flush(); f.click('edit');
  assert.equal(Number(f.input('steamSales').value),108.08);
});

test('grouped numeric input is summed without losing decimal precision', async () => {
  const f = fixture(); await f.flush(); f.click('edit');
  f.type('steamSalesLowPressure','1,234.56'); f.type('steamSalesHighPressure','43.97');
  assert.equal(Number(f.input('steamSales').value),1278.53);
  f.click('save'); await f.flush();
  assert.equal(f.rows.get(A).values.steamSales,1278.53);
});

for (const invalid of ['', 'abc', '-1', '1x', '1.2.3', '1000000000001']) {
  test('incomplete or invalid component does not leave a fabricated automatic total: ' + JSON.stringify(invalid), async () => {
    const f = fixture(); await f.flush(); f.click('edit');
    f.type('steamSalesLowPressure', '64.11'); f.type('steamSalesHighPressure', '43.97');
    f.type('steamSalesHighPressure', invalid);
    assert.equal(f.input('steamSales').value, '');
    if (invalid) {
      f.click('save'); await f.flush(); assert.equal(f.requests.some(request => request.method === 'POST'), false);
      assert.equal(f.alerts.length, 1);
    }
  });
}

test('directly entered total remains supported; changing a component resumes automatic sum', async () => {
  const f = fixture(); await f.flush(); f.click('edit');
  f.type('steamSalesLowPressure', '64.11'); f.type('steamSalesHighPressure', '43.97');
  f.type('steamSales', '123.45'); f.click('save'); await f.flush();
  assert.equal(f.rows.get(A).values.steamSales, 123.45);
  f.click('edit'); assert.equal(Number(f.input('steamSales').value), 123.45);
  f.type('steamSalesLowPressure', '65.11');
  assert.equal(Number(f.input('steamSales').value), 109.08);
});

test('an automatic total equal to the original is persisted with changed components', async () => {
  const f = fixture({source:{steamSalesLowPressure:60,steamSalesHighPressure:40,steamSales:100}});
  await f.flush(); f.click('edit');
  f.type('steamSalesLowPressure', '65'); f.type('steamSalesHighPressure', '35');
  f.click('save'); await f.flush();
  const saved = f.requests.find(request => request.method === 'POST').body.values;
  assert.equal(saved.steamSales, 100); assert.equal(saved.steamSalesLowPressure,65); assert.equal(saved.steamSalesHighPressure,35);
});

test('previous component-only saved edits restore and export their total without another save', async () => {
  const f = fixture({saved:{steamSalesLowPressure:64.11,steamSalesHighPressure:43.97}});
  await f.flush();
  assert.equal(f.display('steamSales').dataset.rawValue, '108.08');
  assert.equal(f.display('steamSales').dataset.morningCardOverride, 'true');
  assert.equal(f.api.overrideValues({}, A).steamSales, 108.08);
  assert.equal(f.requests.some(request => request.method !== 'GET'), false);
});

test('one saved component combines with the selected source peer and replaces the original total', async () => {
  const f = fixture({source:{steamSalesLowPressure:10,steamSalesHighPressure:20,steamSales:30},saved:{steamSalesLowPressure:15}});
  await f.flush(); assert.equal(f.display('steamSales').dataset.rawValue, '35');
  assert.equal(f.api.overrideValues({steamSales:30}, A).steamSales,35);
});

test('a previously saved explicit total wins over the inferred sum in display and export', async () => {
  const f = fixture({saved:{steamSalesLowPressure:64.11,steamSalesHighPressure:43.97,steamSales:120}});
  await f.flush(); assert.equal(f.display('steamSales').dataset.rawValue,'120');
  assert.equal(f.api.overrideValues({}, A).steamSales,120);
});

test('an incomplete saved pair cannot fabricate a zero or partial total', async () => {
  const f = fixture({saved:{steamSalesLowPressure:64.11}}); await f.flush();
  assert.equal(f.display('steamSales').textContent,'-');
  assert.equal(Object.hasOwn(f.api.overrideValues({}, A),'steamSales'),false);
});

test('the original OIS total remains unchanged while the card has no manual overrides', async () => {
  const f = fixture({source:{steamSalesLowPressure:64.11,steamSalesHighPressure:43.97,steamSales:108.09}});
  await f.flush(); assert.equal(f.display('steamSales').textContent,'108.09 ton');
  assert.equal(Object.hasOwn(f.api.overrideValues({}, A),'steamSales'),false);
});

test('date-specific sums and reset suppression do not leak into a different day', async () => {
  const f = fixture({saved:{steamSalesLowPressure:64.11,steamSalesHighPressure:43.97}}); await f.flush();
  assert.equal(f.api.overrideValues({}, A).steamSales,108.08);
  f.select(B); await f.api.load(B);
  assert.equal(Object.hasOwn(f.api.overrideValues({}, B),'steamSales'),false);
  f.blocked.add(A);
  assert.equal(Object.hasOwn(f.api.overrideValues({}, A),'steamSales'),false);
});

test('a peer component visibly owned by another date cannot complete the selected override total', async () => {
  const f = fixture({source:{steamSalesHighPressure:43.97},saved:{steamSalesLowPressure:64.11}});
  f.card.dataset.steamSourceDate = B;
  await f.flush();
  assert.equal(Object.hasOwn(f.api.overrideValues({}, A),'steamSales'),false);
  assert.equal(f.display('steamSales').dataset.morningCardOverride,undefined);
});

test('cancel discards the unsaved automatic sum and restores the selected saved total', async () => {
  const f = fixture({saved:{steamSalesLowPressure:64.11,steamSalesHighPressure:43.97}});
  await f.flush(); f.click('edit'); f.type('steamSalesLowPressure','70');
  assert.equal(Number(f.input('steamSales').value),113.97);
  f.click('cancel'); await f.flush();
  assert.equal(f.display('steamSales').dataset.rawValue,'108.08');
  assert.equal(f.input('steamSales').hidden,true);
  assert.equal(f.requests.some(request => request.method !== 'GET'),false);
});

test('original restore clears the inferred total when there is no original source value', async () => {
  const f = fixture({saved:{steamSalesLowPressure:64.11,steamSalesHighPressure:43.97}});
  await f.flush(); f.click('restore'); await f.flush();
  assert.equal(f.display('steamSales').textContent,'-');
  assert.equal(f.display('steamSales').dataset.rawValue,undefined);
  assert.equal(f.display('steamSales').dataset.morningCardOverride,undefined);
  assert.equal(f.display('steamSalesLowPressure').textContent,'-');
  assert.equal(f.display('steamSalesHighPressure').textContent,'-');
  assert.equal(f.requests.filter(request => request.method === 'DELETE').length,1);
});
