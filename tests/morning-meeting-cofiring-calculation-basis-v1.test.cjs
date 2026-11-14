'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../maintenance/cofiring-core.js');
const basisApi = require('../maintenance/cofiring-calculation-basis-v1.js');
const {normalizeItem} = require('../maintenance/morning-meeting-closed-cofiring.js');
const repo = path.resolve(__dirname, '..');
const DATE = '2026-11-12', NEXT = '2026-11-13';
const copy = value => structuredClone(value);
const read = name => fs.readFileSync(path.join(repo, 'maintenance', name), 'utf8');

function fixture(gap = 34.519, mode = 'original') {
  const period = {startLocal: DATE + 'T00:00', endLocal: NEXT + 'T00:00', stepUnit: 'minute', stepValue: 1};
  const summaries = core.requiredSeries.map((definition, index) => {
    const bad = index === 0 ? gap : 0;
    return {key: definition.id, unit: definition.unit, fuel: definition.fuel, tag: definition.queryTag,
      startValue: 1000 + index * 100, endValue: 1010 + index * 100,
      effectiveStartValue: 1000 + index * 100, effectiveEndValue: 1010 + index * 100,
      min: 1000 + index * 100, max: 1010 + index * 100, delta: 10, usageTon: 10,
      rangeSpread: 10, usageBasis: 'end_minus_start_boundary',
      startQuality: 'Raw, Good', endQuality: 'Raw, Good',
      startTime: period.startLocal + ':00+09:00', endTime: period.endLocal + ':00+09:00',
      durationGoodSeconds: 86400 - bad, durationBadSeconds: bad,
      boundaryValid: true, durationCoverageValid: true, dataComplete: bad === 0};
  });
  const reference = {kind: 'cofiring_period_summary_v1', schemaVersion: 1, ...period, summaries};
  const manual = tons => ({start: period.startLocal + ':00+09:00', end: period.endLocal + ':00+09:00', unit1: tons, unit2: tons});
  const settings = value => Object.fromEntries(['unit1', 'unit2'].map(unit => [unit,
    Object.fromEntries(['coal', 'bio', 'organic', 'manure'].map(fuel => [fuel, value]))]));
  const original = core.analyzePeriodSummary(reference, {...period, calorifics: settings(4000), coefficients: settings(1), organic: manual(5), manure: manual(0)});
  // Real validated closes persist this alongside result, rather than inside it.
  const snapshot = {schemaVersion: 1, targetDate: DATE, period, sourceRequestId: 'fixture-source', result: original,
    organicUsage: {ok: true, provisional: false, endTotal: 30}, manual: {receipts: {organic: 10}},
    organicInventory: {...period, end: {organicDaySilo: 10, organicStorageSiloA: 10, organicStorageSiloB: 10, total: 30}}};
  const item = {targetDate: DATE, revision: 1, sourceRequestId: 'fixture-source', snapshot,
    summary: core.summaryFromResult(original)};
  if (mode !== 'original') {
    const effective = copy(original);
    effective.units.unit1.bio.quantity = 11;
    delete effective.units.unit1.bio.counters;
    effective.adjustment = {applied: true, mode: 'manual_final'};
    item.effectiveResult = mode === 'cleared' ? original : effective;
    item.adjustmentApplied = mode !== 'cleared';
    if (mode === 'cleared') { snapshot.originalResult = original; snapshot.result = effective; }
  }
  return item;
}

test('frozen same-day boundary evidence adds a description without changing any stored number', () => {
  const item = fixture(), before = copy(item), normalized = normalizeItem(item, DATE);
  assert.equal(normalized.calculationBasis.kind, 'counter-boundary-quality-gap');
  assert.equal(normalized.calculationBasis.maxGapSeconds, 34.519);
  assert.match(normalized.calculationBasis.note, /누적계 기준.*34\.5초/);
  assert.equal(normalized.unitOne.coal, item.summary.unit1.coal);
  assert.equal(normalized.unitTwo.bio, item.summary.unit2.bio);
  assert.equal(normalized.combined.totalRatio, item.snapshot.result.combined.fuelRatios.total);
  assert.deepEqual(item, before);
});

test('effective adjustment and CLEAR keep provenance from their own frozen original', () => {
  for (const mode of ['applied', 'cleared']) {
    const item = fixture(34.519, mode), before = copy(item), normalized = normalizeItem(item, DATE);
    assert.equal(normalized.calculationBasis.maxGapSeconds, 34.519);
    assert.equal(normalized.unitOne.bio, mode === 'applied' ? 11 : 10);
    assert.equal(normalized.adjustmentApplied, mode === 'applied');
    assert.deepEqual(item, before);
  }
});

test('clean, incomplete, estimated or different-period originals receive no new label', () => {
  const cases = [fixture(0), fixture(), fixture(), fixture(), fixture()];
  cases[1].snapshot.result.units.unit1.coal.counters[0].complete = false;
  cases[2].snapshot.organicUsage.provisional = true;
  cases[3].snapshot.result.period = {...cases[3].snapshot.result.period, startLocal: '2026-11-11T00:00'};
  cases[4].snapshot.result.organicUsage = {ok: true, provisional: true};
  for (const item of cases) assert.equal(Object.hasOwn(normalizeItem(item, DATE), 'calculationBasis'), false);
  const wrongDate = fixture(); wrongDate.snapshot.targetDate = NEXT;
  assert.throws(() => normalizeItem(wrongDate, DATE), /선택일/);
  const wrongSource = fixture(); wrongSource.snapshot.sourceRequestId = 'different-source';
  assert.throws(() => normalizeItem(wrongSource, DATE), /선택일/);
});

class Hub {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
  dispatchEvent(event) { for (const callback of [...(this.listeners.get(event.type) || [])]) callback(event); }
}
class Element extends Hub {
  constructor(id = '') {
    super(); this.id = id; this.dataset = {}; this.textContent = ''; this.attributes = new Map();
    const classes = new Set();
    this.classList = {add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name),
      toggle: (name, yes) => yes ? classes.add(name) : classes.delete(name)};
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
}
class Button extends Element {}
class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

function browser({helper = true} = {}) {
  const root = new Hub(), doc = new Hub(), elements = new Map();
  const add = (id, Type = Element) => { const element = new Type(id); elements.set(id, element); return element; };
  doc.body = new Element('body'); doc.readyState = 'loading'; doc.hidden = false;
  doc.getElementById = id => elements.get(id) || null; doc.querySelector = () => null;
  doc.createElement = tag => new Element(tag);
  const panel = add('efficiencyMorningMeetingWaterPanel'); panel.dataset.morningMeetingAutoBaseDate = DATE;
  const parent = new Element(), source = add('efficiencyMorningMeetingAutoSiloCard'); source.parentElement = parent;
  const card = add('efficiencyMorningMeetingAutoCofiringCard'); card.parentElement = parent; card.previousElementSibling = source;
  const badge = add('efficiencyMorningMeetingCofiringStatus'); badge.setAttribute('title', 'ordinary title'); badge.setAttribute('aria-label', 'ordinary label');
  add('efficiencyMorningMeetingCofiringDate'); add('morningMeetingCofiringRefreshButton', Button);
  for (const unit of [1, 2]) for (const field of ['CoalUsage', 'BioUsage', 'BioRatio', 'OrganicInput', 'OrganicRatio', 'TotalRatio']) add(`efficiencyMorningMeetingCofiringUnit${unit}${field}`);
  let token = 'fixture-user', blocked = false, row = fixture(), pending = null;
  Object.assign(root, {document: doc, CustomEvent, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    getShiftLogAuthHeaders: () => token ? {Authorization: 'Bearer ' + token} : {},
    isMorningMeetingSelectedDateResetActive: () => blocked,
    morningMeetingQuerySources: {resetState: () => ({active: blocked}), loadResetStatus: async () => ({active: blocked})},
    fetch: async rawUrl => {
      const url = new URL(String(rawUrl), 'https://offline.invalid');
      if (url.pathname === '/api/cofiring-closed-history') {
        if (pending) return pending;
        return {ok: true, json: async () => ({ok: true, item: copy(row)})};
      }
      if (url.pathname === '/api/solid-fuel-trouble') return {ok: true, json: async () => ({source: 'solid-fuel-unloading', basis: 'completed-unloading-departure', receiptStart: DATE + 'T00:00', receiptEnd: NEXT + 'T00:00', receipts: {organic: 10}, counts: {organic: 1}})};
      return {ok: true, json: async () => ({ok: true, item: null})};
    }});
  if (helper) root.CofiringCalculationBasisV1 = basisApi;
  const context = vm.createContext({window: root, document: doc, CustomEvent, Headers, AbortController, URLSearchParams,
    HTMLElement: Element, Element, HTMLButtonElement: Button, HTMLInputElement: class extends Element {},
    MutationObserver: class {observe() {} disconnect() {}}, console: {warn() {}, error() {}}});
  vm.runInContext(read('morning-meeting-closed-cofiring.js'), context);
  vm.runInContext(read('morning-meeting-cofiring-card.js'), context);
  doc.dispatchEvent(new CustomEvent('DOMContentLoaded')); doc.readyState = 'complete';
  return {root, doc, elements, badge, panel, provider: root.morningMeetingClosedCofiring,
    row: value => { row = value; }, auth: value => { token = value; }, block: value => { blocked = value; },
    pending: value => { pending = value; }, paint: () => doc.dispatchEvent(new CustomEvent('morningMeetingClosedCofiringChanged'))};
}

test('actual morning card shows provenance while preserving quantities, adjustment and CLEAR', async () => {
  const b = browser();
  await b.provider.load();
  assert.equal(b.badge.textContent, '누적계 기준 · 품질 공백');
  assert.match(b.badge.getAttribute('title'), /34\.5초/);
  assert.equal(b.badge.getAttribute('aria-label'), b.badge.getAttribute('title'));
  assert.equal(b.elements.get('efficiencyMorningMeetingCofiringUnit1BioUsage').textContent, '10.00 t/d');
  b.row(fixture(34.519, 'applied')); await b.provider.load(DATE, {force: true});
  assert.equal(b.badge.textContent, '혼소조정 적용 · 품질 공백');
  assert.equal(b.elements.get('efficiencyMorningMeetingCofiringUnit1BioUsage').textContent, '11.00 t/d');
  b.row(fixture(34.519, 'cleared')); await b.provider.load(DATE, {force: true});
  assert.equal(b.badge.textContent, '누적계 기준 · 품질 공백');
  assert.equal(b.elements.get('efficiencyMorningMeetingCofiringUnit1BioUsage').textContent, '10.00 t/d');
});

test('clean, loading, reset, date and auth transitions clear owned title/aria without stale provenance', async () => {
  const b = browser(); await b.provider.load();
  const ordinary = () => { assert.equal(b.badge.getAttribute('title'), 'ordinary title'); assert.equal(b.badge.getAttribute('aria-label'), 'ordinary label'); };
  b.row(fixture(0)); await b.provider.load(DATE, {force: true});
  assert.equal(b.badge.textContent, '마감자료'); ordinary();
  b.row(fixture()); await b.provider.load(DATE, {force: true});
  let release; b.pending(new Promise(resolve => { release = resolve; }));
  const loading = b.provider.load(DATE, {force: true}); await settle();
  assert.equal(b.badge.textContent, '마감자료 조회 중'); ordinary();
  release({ok: true, json: async () => ({ok: true, item: fixture()})}); b.pending(null); await loading;
  b.block(true); b.paint(); assert.equal(b.badge.textContent, '조회 대기'); ordinary();
  b.block(false); b.paint(); assert.match(b.badge.textContent, /품질 공백/);
  b.panel.dataset.morningMeetingAutoBaseDate = NEXT; b.paint(); assert.equal(b.badge.textContent, '마감자료 없음'); ordinary();
  b.panel.dataset.morningMeetingAutoBaseDate = DATE; b.paint(); assert.match(b.badge.textContent, /품질 공백/);
  b.auth(''); b.paint(); assert.equal(b.badge.textContent, '마감자료 없음'); ordinary();
});

test('unavailable optional helper keeps the existing saved-card presentation', async () => {
  const b = browser({helper: false}); await b.provider.load();
  assert.equal(b.provider.peek().calculationBasis, undefined);
  assert.equal(b.badge.textContent, '마감자료');
  assert.equal(b.badge.getAttribute('title'), 'ordinary title');
});

test('a different-date legacy saved fallback cannot inherit the previous boundary note', async () => {
  const b = browser(); await b.provider.load();
  assert.match(b.badge.getAttribute('title'), /34\.5초/);
  b.root.morningMeetingLegacySavedDailyData = {
    peek: date => date === NEXT ? {legacy: true} : null,
    render: () => { b.badge.textContent = '기존 저장값'; }
  };
  b.panel.dataset.morningMeetingAutoBaseDate = NEXT; b.paint();
  assert.equal(b.badge.textContent, '기존 저장값');
  assert.equal(b.badge.getAttribute('title'), 'ordinary title');
  assert.equal(b.badge.getAttribute('aria-label'), 'ordinary label');
});
