'use strict';
// Offline regression tests: the fetched project modules are exercised with
// synthetic API responses / DOM cells. No application, DB or Agent is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(repo, p), 'utf8').replace(/\r\n/g, '\n');
const {normalizeItem, matchingReceiptCount} = require(path.join(repo, 'maintenance/morning-meeting-closed-cofiring.js'));
const adjuster = require(path.join(repo, 'maintenance/cofiring-period-adjustment-v56.js'));
const DATE = '2026-10-01';
const copy = x => structuredClone(x);
const next = date => new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const period = date => ({startLocal: date + 'T00:00', endLocal: next(date) + 'T00:01', durationHours: 1441 / 60});
const closeTo = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function unit(coal, bio, bioRatio, organicRatio, heat = 1000) {
  const h = {coal: heat * (1 - bioRatio / 100), bio: heat * bioRatio / 100,
    organic: heat * (organicRatio / 100) / (1 - organicRatio / 100), manure: 0};
  h.total = h.coal + h.bio + h.organic;
  return {coal: {quantity: coal}, bio: {quantity: bio}, organic: {quantity: 88.89}, manure: {quantity: 0}, heats: h,
    fuelRatios: {organicGroup: organicRatio, total: (h.bio + h.organic) / h.total * 100}};
}
// Synthetic precision reproduces the screenshot rounding; it is not live API data.
function result(date, adjusted) {
  const units = adjusted
    ? {unit1: unit(580.350123, 361.400456, 25.10, 5.83), unit2: unit(586.580234, 361.400456, 24.897, 5.786, 1200)}
    : {unit1: unit(540.530123, 435.410123, 30.24, 5.83), unit2: unit(589.370234, 356.210123, 24.54, 5.79, 1200)};
  const heats = Object.fromEntries(['coal', 'bio', 'organic', 'manure', 'total'].map(k => [k, units.unit1.heats[k] + units.unit2.heats[k]]));
  return {period: period(date), units, combined: {heats, fuelRatios: {organicGroup: heats.organic / heats.total * 100,
    total: (heats.bio + heats.organic) / heats.total * 100}}, ...(adjusted ? {adjustment: {applied: true, mode: 'max_auto'}} : {})};
}
function summary(r) {
  const ratios = u => ({bioRatio: u.heats.bio / (u.heats.coal + u.heats.bio) * 100,
    organicGroupRatio: u.fuelRatios.organicGroup, totalRatio: u.fuelRatios.total});
  const fuel = u => ({...ratios(u), ...Object.fromEntries(['coal', 'bio', 'organic', 'manure'].map(k => [k, u[k].quantity]))});
  return {unit1: fuel(r.units.unit1), unit2: fuel(r.units.unit2), combined: ratios(r.combined)};
}
function fixture(date = DATE, mode = 'original') {
  const raw = result(date, false), final = result(date, true);
  const snapshot = {targetDate: date, schemaVersion: 1, sourceRequestId: 'fixture-' + date, period: period(date),
    result: raw, manual: {receipts: {organic: 174.26}}, organicUsage: {endTotal: 35.38},
    organicInventory: {...period(date), end: {organicDaySilo: 6, organicStorageSiloA: 28.91, organicStorageSiloB: 0.47, total: 35.38}}};
  const item = {targetDate: date, revision: 7, sourceRequestId: snapshot.sourceRequestId, updatedAt: '2026-10-01T16:00:00Z',
    snapshot, summary: summary(raw)};
  if (mode !== 'legacy') {
    item.effectiveResult = mode === 'applied' ? final : raw;
    item.adjustmentApplied = mode === 'applied';
    item.adjustmentSource = mode === 'applied' ? 'period_adjustment' : 'closed_snapshot_original';
  }
  if (mode === 'cleared') {
    snapshot.result = final; snapshot.originalResult = raw; item.summary = summary(final);
    item.adjustmentSource = 'period_adjustment_cleared';
  }
  return item;
}

class Hub {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback, options) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push({callback, once: options?.once});
  }
  removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(x => x.callback !== callback)); }
  dispatchEvent(e) {
    for (const x of [...(this.listeners.get(e.type) || [])]) {
      if (x.once) this.removeEventListener(e.type, x.callback);
      x.callback.call(this, e);
    }
    return true;
  }
}
class E extends Hub {
  constructor(id = '') {
    super(); this.id = id; this.dataset = {}; this.textContent = ''; this.children = []; this.attrs = new Map();
    const classes = new Set();
    this.classList = {add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)),
      contains: x => classes.has(x), toggle(x, flag) { const yes = flag ?? !classes.has(x); yes ? classes.add(x) : classes.delete(x); return yes; }};
  }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; }
}
class Button extends E {}
class Input extends E {}
class CE { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
function browser({sticky = false, installCard = true, selected = DATE} = {}) {
  const root = new Hub(), doc = new Hub(), els = new Map(), rows = new Map(), requests = [], waits = [];
  const add = (id, cls = E) => { const e = new cls(id); els.set(id, e); return e; };
  doc.getElementById = id => els.get(id) || null;
  doc.body = new E('body'); doc.readyState = 'loading'; doc.hidden = false;
  doc.createElement = tag => new E(tag); doc.querySelector = () => null;
  const panel = add('efficiencyMorningMeetingWaterPanel'); panel.dataset.morningMeetingAutoBaseDate = selected;
  const parent = new E('parent'), source = add('efficiencyMorningMeetingAutoSiloCard'); source.parentElement = parent;
  const card = add('efficiencyMorningMeetingAutoCofiringCard'); card.parentElement = parent; card.previousElementSibling = source;
  add('efficiencyMorningMeetingCofiringStatus'); add('efficiencyMorningMeetingCofiringDate');
  add('morningMeetingCofiringRefreshButton', Button);
  for (const u of [1, 2]) for (const field of ['CoalUsage', 'BioUsage', 'BioRatio', 'OrganicInput', 'OrganicRatio', 'TotalRatio']) add(`efficiencyMorningMeetingCofiringUnit${u}${field}`);
  const prefix = 'efficiencyMorningMeetingAutoDaily';
  for (const field of ['SludgeCard', 'SludgeDate', 'SludgeStatus', 'SludgeTotal', 'SludgeTruckCount', 'OrganicDaySilo', 'OrganicStorageSiloA', 'OrganicStorageSiloB', 'OrganicSiloTotal']) add(prefix + field);
  if (sticky) {
    els.get(prefix + 'SludgeDate').textContent = selected + ' · 기존 저장값';
    els.get(prefix + 'SludgeStatus').textContent = '기존 저장값';
    els.get(prefix + 'SludgeTotal').textContent = '999.00 t';
  }
  root.document = doc; root.CustomEvent = CE; root.Event = CE;
  let token = 'fixture-token', blocked = false, timerId = 0;
  root.getShiftLogAuthHeaders = () => ({Authorization: 'Bearer ' + token});
  root.isMorningMeetingSelectedDateResetActive = () => blocked;
  root.morningMeetingQuerySources = {resetState: () => ({active: blocked}), loadResetStatus: async () => ({active: blocked})};
  root.setTimeout = () => ++timerId; root.clearTimeout = () => {}; root.setInterval = () => ++timerId; root.clearInterval = () => {};
  root.applyMorningMeetingDailyDataValues = () => ({});
  root.fetch = async (url, options) => {
    requests.push({url: String(url), options});
    const parsed = new URL(String(url), 'https://offline.invalid');
    if (parsed.pathname === '/api/cofiring-closed-history') {
      const date = parsed.searchParams.get('targetDate');
      if (waits.length) return waits.shift().promise;
      const item = rows.has(date) ? rows.get(date) : fixture(date);
      return {ok: true, json: async () => ({ok: true, item: copy(item)})};
    }
    assert.equal(parsed.pathname, '/api/solid-fuel-trouble');
    return {ok: true, json: async () => ({source: 'solid-fuel-unloading', basis: 'completed-unloading-departure',
      receiptStart: parsed.searchParams.get('receiptStart'), receiptEnd: parsed.searchParams.get('receiptEnd'), receipts: {organic: 174.26}, counts: {organic: 6}})};
  };
  const sandbox = {window: root, document: doc, CustomEvent: CE, Event: CE, Headers, AbortController, URLSearchParams,
    HTMLElement: E, Element: E, HTMLButtonElement: Button, HTMLInputElement: Input,
    MutationObserver: class {observe() {} disconnect() {}}, console: {log() {}, warn() {}, error() {}}};
  vm.createContext(sandbox);
  vm.runInContext(read('maintenance/morning-meeting-closed-cofiring.js'), sandbox);
  if (installCard) vm.runInContext(read('maintenance/morning-meeting-cofiring-card.js'), sandbox);
  vm.runInContext(read('maintenance/morning-meeting-cofiring-final-excel.js'), sandbox);
  const start = () => { doc.dispatchEvent(new CE('DOMContentLoaded')); doc.readyState = 'complete'; };
  const provider = root.morningMeetingClosedCofiring;
  const send = (date = DATE, end) => root.dispatchEvent(new CE('cofiring:period-adjustment-changed', {detail: {start: date + 'T00:00', end: end || next(date) + 'T00:01'}}));
  const text = id => els.get(id)?.textContent;
  const closedCalls = () => requests.filter(r => r.url.startsWith('/api/cofiring-closed-history'));
  return {root, doc, els, rows, requests, waits, provider, sandbox, start, send, text, closedCalls,
    select: d => { panel.dataset.morningMeetingAutoBaseDate = d; }, token: t => { token = t; }, block: b => { blocked = b; }};
}

// Pure normalization and source precedence.
test('legacy compact close keeps existing saved quantities, zero and summary compatibility', () => {
  const item = fixture(DATE, 'legacy'); delete item.summary.unit1.bioRatio;
  const saved = normalizeItem(item, DATE);
  closeTo(saved.unitOne.bioRatio, 30.24); assert.equal(saved.unitOne.coal, 540.530123);
  assert.equal(saved.unitOne.manure, 0); assert.equal(saved.adjustmentApplied, false);
});
test('effective result replaces every stale fuel/ratio summary field, preserving precision', () => {
  const item = fixture(DATE, 'applied'), before = copy(item), saved = normalizeItem(item, DATE);
  assert.equal(saved.unitOne.coal, 580.350123); assert.equal(saved.unitTwo.coal, 586.580234);
  assert.equal(saved.unitOne.bio, 361.400456); assert.equal(saved.unitTwo.bio, 361.400456);
  closeTo(saved.unitOne.bioRatio, 25.10); closeTo(saved.unitTwo.bioRatio, 24.897);
  assert.equal(saved.unitOne.totalRatio.toFixed(2), '29.47'); assert.equal(saved.unitTwo.totalRatio.toFixed(2), '29.24');
  assert.equal(saved.adjustmentApplied, true); assert.equal(saved.adjustmentSource, 'period_adjustment');
  assert.deepEqual(item, before, 'normalization must not mutate a saved record');
});
test('CLEAR overrides an adjusted closed snapshot and adjusted summary without re-closing', () => {
  const saved = normalizeItem(fixture(DATE, 'cleared'), DATE);
  assert.equal(saved.adjustmentApplied, false); assert.equal(saved.unitOne.coal, 540.530123);
  closeTo(saved.unitTwo.bioRatio, 24.54); assert.equal(saved.unitOne.totalRatio.toFixed(2), '34.31');
});
test('legacy explicit CLEAR uses originalResult rather than stale adjusted summary', () => {
  const item = fixture(DATE, 'cleared'); delete item.effectiveResult;
  assert.equal(normalizeItem(item, DATE).unitOne.bio, 435.410123);
});
test('combined Bio uses Coal+Bio heat weighting, not a simple mean or total-fuel denominator', () => {
  const item = fixture(DATE, 'applied'), value = normalizeItem(item, DATE);
  const h = item.effectiveResult.combined.heats;
  closeTo(value.combined.bioRatio, h.bio / (h.coal + h.bio) * 100);
  assert.notEqual(value.combined.bioRatio, 25);
});
test('organic receipts/inventory and matching truck-count checks are unchanged', () => {
  const raw = normalizeItem(fixture(), DATE), adjusted = normalizeItem(fixture(DATE, 'applied'), DATE);
  assert.deepEqual(adjusted.organic, raw.organic); assert.equal(adjusted.organic.sludgeTotal, 174.26);
  const receipt = {source: 'solid-fuel-unloading', basis: 'completed-unloading-departure',
    receiptStart: period(DATE).startLocal, receiptEnd: period(DATE).endLocal, receipts: {organic: 174.26}, counts: {organic: 6}};
  assert.equal(matchingReceiptCount(receipt, adjusted), 6);
  receipt.receipts.organic = 174.27; assert.equal(matchingReceiptCount(receipt, adjusted), null);
});
test('invalid effective payloads never borrow good-looking old summary fields', () => {
  for (const mutate of [x => { x.effectiveResult = null; }, x => { delete x.effectiveResult.units.unit1.coal; },
    x => { x.effectiveResult.units.unit2.bio.quantity = null; }, x => { x.effectiveResult.units.unit1.coal.quantity = -1; },
    x => { x.effectiveResult.period.endLocal = next(DATE) + 'T00:00'; }, x => { x.adjustmentApplied = 'true'; },
    x => { x.adjustmentApplied = false; }, x => { x.targetDate = next(DATE); }]) {
    const item = fixture(DATE, 'applied'); mutate(item); assert.throws(() => normalizeItem(item, DATE));
  }
});
test('missing effective ratios remain missing rather than silently using old ratios', () => {
  const item = fixture(DATE, 'applied'); delete item.effectiveResult.units.unit1.heats;
  assert.equal(normalizeItem(item, DATE).unitOne.bioRatio, null);
});

test('actual server hydration + actual adjustment algorithm normalize once; CLEAR restores base', async () => {
  const source = read('functions/api/cofiring-closed-history.js');
  const fragment = source.slice(source.indexOf("const PERIOD_ADJUSTMENT_TABLE="), source.indexOf('function nextClosedMonth('));
  assert.ok(fragment.length > 1000);
  const context = {adjustment: adjuster}; vm.createContext(context); vm.runInContext(fragment, context);
  const item = fixture(DATE, 'legacy');
  item.snapshot.settings = Object.fromEntries(['unit1', 'unit2'].map(u => [u, {coal: {calorific: 5300}, bio: {calorific: 2852}, organic: {calorific: 3000}, manure: {calorific: 1000}}]));
  let row = {cleared: 0, revision: 8, adjustment_json: JSON.stringify({mode: 'max_auto', finalBioUnit1: 361.4, finalBioUnit2: 361.4, maxBioTpd: 361.15})};
  const db = {prepare(sql) { assert.match(sql, /cofiring_period_adjustment_history/); return {bind(key) {
    assert.equal(key, period(DATE).startLocal + '|' + period(DATE).endLocal); return {first: async () => row};
  }}; }};
  const projected = await context.hydrateActivePeriodAdjustment(db, copy(item));
  const saved = normalizeItem(projected, DATE);
  assert.equal(saved.unitOne.coal, projected.effectiveResult.units.unit1.coal.quantity);
  assert.equal(saved.unitOne.bio, 361.4); assert.equal(saved.adjustmentApplied, true);
  row = {cleared: 1, revision: 9, adjustment_json: '{}'};
  const oldAdjusted = copy(item); oldAdjusted.snapshot.originalResult = copy(item.snapshot.result);
  oldAdjusted.snapshot.result = projected.effectiveResult; oldAdjusted.summary = summary(projected.effectiveResult);
  const cleared = normalizeItem(await context.hydrateActivePeriodAdjustment(db, oldAdjusted), DATE);
  assert.equal(cleared.adjustmentApplied, false); assert.equal(cleared.unitOne.coal, item.snapshot.result.units.unit1.coal.quantity);
});

// Browser lifecycle / asynchronous-generation tests with the real modules.
test('apply event automatically refreshes the already-open card; CLEAR restores values and badge', async () => {
  const b = browser(); b.start(); await settle();
  assert.equal(b.text('efficiencyMorningMeetingCofiringUnit1BioRatio'), '30.24%');
  b.rows.set(DATE, fixture(DATE, 'applied')); b.send(); await settle();
  assert.equal(b.text('efficiencyMorningMeetingCofiringUnit1CoalUsage'), '580.35 t/d');
  assert.equal(b.text('efficiencyMorningMeetingCofiringUnit2BioRatio'), '24.90%');
  assert.equal(b.text('efficiencyMorningMeetingCofiringStatus'), '혼소조정 적용');
  b.rows.set(DATE, fixture(DATE, 'cleared')); b.send(); await settle();
  assert.equal(b.text('efficiencyMorningMeetingCofiringUnit1BioRatio'), '30.24%');
  assert.equal(b.text('efficiencyMorningMeetingCofiringStatus'), '마감자료');
  assert.equal(b.closedCalls().length, 3);
});
test('other-tab storage apply and removal both re-read server state', async () => {
  const b = browser(); b.start(); await settle();
  const key = 'gspo:cofiring-period-adjust:v56:' + encodeURIComponent(period(DATE).startLocal + '|' + period(DATE).endLocal);
  b.rows.set(DATE, fixture(DATE, 'applied'));
  b.root.dispatchEvent({type: 'storage', key, newValue: '{}'}); await settle();
  assert.equal(b.provider.peek().adjustmentApplied, true);
  b.rows.set(DATE, fixture(DATE, 'cleared'));
  b.root.dispatchEvent({type: 'storage', key, newValue: null}); await settle();
  assert.equal(b.provider.peek().adjustmentApplied, false);
});
test('another date is invalidated without replacing the currently displayed date', async () => {
  const b = browser(); b.start(); await settle();
  const other = next(DATE); await b.provider.load(other);
  const count = b.closedCalls().length; b.rows.set(other, fixture(other, 'applied')); b.send(other); await settle();
  assert.equal(b.closedCalls().length, count); assert.equal(b.provider.peek().targetDate, DATE);
  assert.equal(b.provider.state(other).status, 'idle');
  assert.equal((await b.provider.load(other)).adjustmentApplied, true);
});
test('sub-day, multi-day, malformed and nonmatching 1440/1441 period events do not replace a daily close', async () => {
  const b = browser(); b.start(); await settle(); const count = b.closedCalls().length;
  for (const detail of [{start: DATE + 'T07:00', end: next(DATE) + 'T00:01'},
    {start: DATE + 'T00:00', end: next(next(DATE)) + 'T00:01'},
    {start: 'bad', end: 'bad'}, {start: DATE + 'T00:00', end: next(DATE) + 'T00:00'}]) {
    b.root.dispatchEvent(new CE('cofiring:period-adjustment-changed', {detail}));
  }
  b.root.dispatchEvent({type: 'storage', key: 'gspo:cofiring-period-adjust:v56:%invalid'});
  await settle(); assert.equal(b.closedCalls().length, count);
});
test('late pre-adjustment response cannot overwrite a newer applied card or clear it', async () => {
  const b = browser(), old = deferred(); b.waits.push(old); b.start(); await settle();
  const oldCardRefresh = b.root.refreshMorningMeetingCofiringCard({force: true}); await settle();
  b.rows.set(DATE, fixture(DATE, 'applied')); b.send(); await settle();
  old.resolve({ok: true, json: async () => ({ok: true, item: fixture()})}); await oldCardRefresh; await settle();
  assert.equal(b.provider.peek().adjustmentApplied, true);
  assert.equal(b.text('efficiencyMorningMeetingCofiringUnit1BioRatio'), '25.10%');
});
test('late failed pre-adjustment request cannot repaint a newer successful card as failed', async () => {
  const b = browser(); b.start(); await settle(); const old = deferred(); b.waits.push(old);
  const pending = b.root.refreshMorningMeetingCofiringCard({force: true}); await settle();
  b.rows.set(DATE, fixture(DATE, 'applied')); b.send(); await settle();
  old.reject(new Error('fixture old request failed')); await pending; await settle();
  assert.equal(b.text('efficiencyMorningMeetingCofiringStatus'), '혼소조정 적용');
});
test('apply then CLEAR during pending lookup keeps the newest generation', async () => {
  const b = browser(); b.start(); await settle(); const old = deferred(); b.waits.push(old);
  b.send(); await settle(); b.rows.set(DATE, fixture(DATE, 'cleared')); b.send(); await settle();
  old.resolve({ok: true, json: async () => ({ok: true, item: fixture(DATE, 'applied')})}); await settle();
  assert.equal(b.provider.peek().adjustmentApplied, false); assert.equal(b.text('efficiencyMorningMeetingCofiringUnit1BioRatio'), '30.24%');
});
test('organic saved-first policy does not block co-firing sync or erase saved organic values', async () => {
  const b = browser({sticky: true}); b.start(); await settle();
  await b.root.refreshMorningMeetingCofiringCard(); await settle();
  b.rows.set(DATE, fixture(DATE, 'applied')); b.send(); await settle();
  assert.equal(b.text('efficiencyMorningMeetingCofiringUnit1BioRatio'), '25.10%');
  assert.equal(b.text('efficiencyMorningMeetingAutoDailySludgeTotal'), '999.00 t');
  const existing = {sludgeTotal: 999, organicDaySilo: 1, organicStorageSiloA: 2, organicStorageSiloB: 3, organicSiloTotal: 6};
  assert.equal(b.provider.valuesForWorkbook(existing, {targetDate: DATE}).sludgeTotal, 999);
});
test('focus/visibility picks up another-PC state even with sticky organic, coalescing pending GETs', async () => {
  const b = browser({sticky: true}); b.start(); await b.provider.load(); await settle();
  b.rows.set(DATE, fixture(DATE, 'applied')); const count = b.closedCalls().length;
  b.root.dispatchEvent(new CE('focus')); b.doc.dispatchEvent(new CE('visibilitychange')); await settle();
  assert.equal(b.closedCalls().length, count + 1); assert.equal(b.provider.peek().adjustmentApplied, true);
  assert.equal(b.text('efficiencyMorningMeetingAutoDailySludgeTotal'), '999.00 t');
});
test('selected-date reset stays blocked; adjustment notification does not re-enable or fetch it', async () => {
  const b = browser(); b.start(); await settle(); b.block(true);
  b.doc.dispatchEvent(new CE('morningMeetingSelectedDateResetStateChanged', {detail: {targetDate: DATE, active: true}}));
  const count = b.closedCalls().length; b.send(); await settle();
  assert.equal(b.closedCalls().length, count); assert.equal(b.provider.peek(), null);
  assert.equal(b.text('efficiencyMorningMeetingCofiringUnit1BioRatio'), '-');
  assert.equal(b.root.getMorningMeetingCofiringExcelValues().unitOneCoal, undefined);
});
test('date change during pending old-date response does not overwrite the new date', async () => {
  const b = browser(); b.start(); await settle(); const old = deferred(); b.waits.push(old);
  const pending = b.root.refreshMorningMeetingCofiringCard({force: true}); await settle();
  b.select(next(DATE)); b.rows.set(next(DATE), fixture(next(DATE), 'applied'));
  await b.root.refreshMorningMeetingCofiringCard({force: true});
  old.resolve({ok: true, json: async () => ({ok: true, item: fixture()})}); await pending; await settle();
  assert.equal(b.provider.peek().targetDate, next(DATE)); assert.equal(b.text('efficiencyMorningMeetingCofiringUnit1BioRatio'), '25.10%');
});
test('session change invalidates the previous in-flight response', async () => {
  const b = browser(); const old = deferred(); b.waits.push(old); const pending = b.provider.load(); await settle();
  b.token('other-fixture-token'); b.rows.set(DATE, fixture(DATE, 'applied')); await b.provider.load();
  old.resolve({ok: true, json: async () => ({ok: true, item: fixture()})}); await pending;
  assert.equal(b.provider.peek().adjustmentApplied, true);
});
test('invalid refreshed result leaves export unavailable rather than exporting stale original values', async () => {
  const b = browser(); b.start(); await settle(); const broken = fixture(DATE, 'applied'); broken.effectiveResult = null;
  b.rows.set(DATE, broken); b.send(); await settle();
  assert.equal(b.provider.state().status, 'error'); assert.equal(b.root.getMorningMeetingCofiringExcelValues().unitOneCoal, undefined);
});
test('closed save event uses the same current source and preserves organic sticky state', async () => {
  const b = browser({sticky: true}); b.start(); await b.provider.load(); await settle();
  b.rows.set(DATE, fixture(DATE, 'applied'));
  b.root.dispatchEvent(new CE('cofiring:closed-history-changed', {detail: {targetDate: DATE}})); await settle();
  assert.equal(b.provider.peek().adjustmentApplied, true); assert.equal(b.text('efficiencyMorningMeetingAutoDailySludgeTotal'), '999.00 t');
});
test('refresh paths use only existing GETs; no Excel, Agent or adjustment-save API calls', async () => {
  const b = browser(); b.start(); await settle(); b.send(); await settle();
  for (const r of b.requests) { assert.equal(r.options.method, 'GET'); assert.equal(r.options.cache, 'no-store');
    assert.match(r.url, /^\/api\/(cofiring-closed-history|solid-fuel-trouble)\?/); }
});

// Actual final-export getters / writers run against the same normalized source.
test('final Excel input cells use the adjusted precision and combined ratio without recalculation', async () => {
  const b = browser(); b.rows.set(DATE, fixture(DATE, 'applied')); b.start(); await settle();
  const cells = new Map();
  b.root.setMorningMeetingNumericCellValue = (doc, address, value) => { cells.set(address, value); return {found: true, written: value !== null, cleared: value === null}; };
  const written = b.root.applyMorningMeetingCofiringExcelValues({}, {targetDate: DATE});
  assert.equal(cells.get('I7'), 580.350123); assert.equal(cells.get('I8'), 586.580234);
  assert.equal(cells.get('N7'), 361.400456); assert.equal(cells.get('N8'), 361.400456);
  closeTo(cells.get('X7'), 25.10); closeTo(cells.get('X8'), 24.897);
  closeTo(cells.get('X9'), b.provider.peek().combined.bioRatio);
  assert.equal(written.adjustmentApplied, true); assert.equal(written.appliedCount, 12);
  assert.equal(cells.has('L7'), false); assert.equal(cells.has('U7'), false);
  b.rows.set(DATE, fixture(DATE, 'cleared')); b.send(); await settle();
  const clear = b.root.applyMorningMeetingCofiringExcelValues({}, {targetDate: DATE});
  assert.equal(cells.get('I7'), 540.530123); assert.equal(clear.adjustmentApplied, false);
});
test('final export suppression/date mismatch still clears input values', async () => {
  const b = browser(); b.start(); await settle(); let values = [];
  b.root.setMorningMeetingNumericCellValue = (doc, address, value) => { values.push(value); return {found: true, written: value !== null, cleared: value === null}; };
  b.root.applyMorningMeetingCofiringExcelValues({}, {targetDate: next(DATE)}); assert.ok(values.every(x => x === null));
  values = []; b.root.applyMorningMeetingCofiringExcelValues({}, {suppressClosedValues: true}); assert.ok(values.every(x => x === null));
});
test('long-holiday writer reads each date through corrected provider, including apply/CLEAR states', async () => {
  const b = browser(); const d2 = next(DATE); b.rows.set(DATE, fixture(DATE, 'applied')); b.rows.set(d2, fixture(d2, 'cleared'));
  b.start(); await settle();
  const mappings = [{date: DATE, unitOne: 'G26', unitTwo: 'G27', average: 'G28', total: 'G29'},
    {date: d2, unitOne: 'K26', unitTwo: 'K27', average: 'K28', total: 'K29'},
    {date: next(d2), unitOne: 'O26', unitTwo: 'O27', average: 'O28', total: 'O29'},
    {date: next(next(d2)), unitOne: 'S26', unitTwo: 'S27', average: 'S28', total: 'S29'}];
  b.rows.set(next(d2), null); b.rows.set(next(next(d2)), fixture(next(next(d2)), 'applied'));
  const cells = mappings.flatMap(m => [m.unitOne, m.unitTwo, m.average, m.total]).map(a => { const e = new E(a); e.setAttribute('r', a); return e; });
  const ws = {documentElement: {namespaceURI: 'urn:fixture'}, getElementsByTagNameNS: (ns, name) => name === 'c' ? cells : [],
    getElementsByTagName: name => name === 'c' ? cells : [], createElementNS: (ns, tag) => new E(tag)};
  const written = await b.root.applyMorningMeetingLongHolidayCofiringExcelValues(ws, {longHoliday: true, cofiringValueCells: mappings});
  const text = a => cells.find(e => e.id === a).children[0]?.children[0]?.textContent;
  assert.equal(text('G26'), '25.10 / 5.83'); assert.equal(text('G27'), '24.90 / 5.79');
  assert.equal(text('K26'), '30.24 / 5.83'); assert.equal(text('K27'), '24.54 / 5.79');
  assert.equal(written.appliedCount, 3); assert.equal(written.missingCount, 1);
});
