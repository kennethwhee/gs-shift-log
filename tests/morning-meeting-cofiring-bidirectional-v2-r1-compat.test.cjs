'use strict';
// R1: execute the actual legacy entry-point module, not a copied branch.
// Missing shared bridge must fail closed; a present bridge owns its own button
// state and open action. All legacy API/network activity is forbidden here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'maintenance', 'morning-meeting-cofiring-adjustment.js'), 'utf8');
const BUTTON = 'morningMeetingCofiringAdjustmentButton';
const MODAL = 'morningMeetingCofiringAdjustmentModal';
function harness(sharedAvailable = false) {
  const nodes = new Map(), documentEvents = new Map(), requests = [], calls = {sync: 0, open: 0};
  class Element {
    constructor(id = '') {
      this.id = id; this.hidden = false; this.disabled = false; this.title = ''; this.dataset = {}; this.events = new Map();
      const classes = new Set();
      this.classList = {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x, b) => b ? classes.add(x) : classes.delete(x)};
    }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(fn); }
    appendChild(child) { nodes.set(child.id, child); child.parentElement = this; return child; }
    insertBefore(child) { return this.appendChild(child); }
    querySelector(selector) { return selector === '.morning-meeting-cofiring-card__meta' ? nodes.get('meta') : null; }
    querySelectorAll() { return []; }
    closest() { return null; }
  }
  class Button extends Element {}
  class Input extends Element {}
  for (const id of ['efficiencyMorningMeetingAutoCofiringCard', 'meta']) nodes.set(id, new Element(id));
  const document = {
    readyState: 'loading', body: new Element('body'),
    getElementById: id => nodes.get(id) || null,
    createElement: tag => tag === 'button' ? new Button() : new Element(),
    addEventListener(type, fn) { if (!documentEvents.has(type)) documentEvents.set(type, []); documentEvents.get(type).push(fn); }
  };
  const bridge = {morning: {
    syncButton(button) { calls.sync++; button.disabled = false; button.title = '공용 혼소조정'; },
    async open() { calls.open++; return true; }
  }};
  const window = {
    morningMeetingClosedCofiring: {targetDate: () => '2026-10-01'}, location: {origin: 'https://fixture.invalid'},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, alert() {}
  };
  if (sharedAvailable) window.CofiringSharedAdjustmentSyncV2 = bridge;
  const context = vm.createContext({window, document, Element, HTMLElement: Element, HTMLButtonElement: Button, HTMLInputElement: Input,
    MutationObserver: class {observe() {} disconnect() {}}, URL, console,
    fetch: async (...args) => { requests.push(args); throw Error('Unexpected legacy request'); }
  });
  vm.runInContext(source, context);
  const emit = type => { for (const fn of documentEvents.get(type) || []) fn({detail: {targetDate: '2026-10-01'}}); };
  emit('DOMContentLoaded');
  return {window, nodes, requests, calls, emit, bridge, button: () => nodes.get(BUTTON),
    refresh: () => window.refreshMorningMeetingCofiringAdjustment(),
    // Forced invocation checks that even synthetic clicks cannot bypass guards.
    forceClick: async () => { for (const fn of nodes.get(BUTTON)?.events.get('click') || []) await fn({}); }
  };
}

test('R1 missing bridge keeps button disabled, preserves calculator-menu fallback, and sends no legacy requests', async () => {
  const h = harness(); await h.refresh();
  assert.equal(h.button().disabled, true);
  assert.match(h.button().title, /혼소율 메뉴/);
  assert.match(h.button().title, /새로고침/);
  assert.equal(h.requests.length, 0); assert.equal(h.nodes.has(MODAL), false);
});
test('R1 forced click without shared bridge never opens or calls the legacy editor', async () => {
  const h = harness(); await h.forceClick();
  assert.equal(h.calls.open, 0); assert.equal(h.requests.length, 0); assert.equal(h.nodes.has(MODAL), false);
});
test('R1 loaded shared bridge owns the enabled morning button and receives exactly one open call', async () => {
  const h = harness(true); await h.refresh();
  assert.equal(h.button().disabled, false); assert.ok(h.calls.sync > 0);
  assert.equal(h.button().events.get('click').length, 1);
  await h.forceClick(); assert.equal(h.calls.open, 1); assert.equal(h.requests.length, 0); assert.equal(h.nodes.has(MODAL), false);
});
test('R1 delayed shared-bridge load restores editing without recreating or duplicating the button', async () => {
  const h = harness(), button = h.button(); assert.equal(button.disabled, true);
  h.window.CofiringSharedAdjustmentSyncV2 = h.bridge; await h.refresh();
  assert.equal(h.button(), button); assert.equal(button.disabled, false);
  await h.forceClick(); assert.equal(h.calls.open, 1); assert.equal(button.events.get('click').length, 1); assert.equal(h.requests.length, 0);
});
test('R1 unavailable bridge after refresh safely restores the fallback instead of legacy writes', async () => {
  const h = harness(true); h.window.CofiringSharedAdjustmentSyncV2 = undefined;
  await h.refresh(); await h.forceClick();
  assert.equal(h.button().disabled, true); assert.match(h.button().title, /혼소율 메뉴/);
  assert.equal(h.calls.open, 0); assert.equal(h.requests.length, 0); assert.equal(h.nodes.has(MODAL), false);
});
test('R1 repeated closed-card notifications keep one shared click handler and no legacy network traffic', async () => {
  const h = harness(true), button = h.button();
  for (let i = 0; i < 3; i++) h.emit('morningMeetingClosedCofiringChanged');
  assert.equal(h.button(), button); assert.equal(button.events.get('click').length, 1);
  await h.forceClick(); assert.equal(h.calls.open, 1); assert.equal(h.requests.length, 0);
});
