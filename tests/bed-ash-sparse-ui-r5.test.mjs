import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../efficiency/bed-ash-discharge.js', import.meta.url), 'utf8');

// Simulate browser DOM surfaces only; normalizers, rendering, summaries and
// review guards execute the production functions without substitutions.
class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = [];
    this.dataset = {}; this.attributes = {}; this.style = {}; this.className = '';
    this._text = ''; this.hidden = false; this.listeners = new Map();
    const names = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...items) => { this.className = [...new Set([...names(), ...items])].join(' '); },
      remove: (...items) => { this.className = [...names()].filter(item => !items.includes(item)).join(' '); },
      contains: item => names().has(item),
      toggle: (item, enabled = !names().has(item)) => { this.classList[enabled ? 'add' : 'remove'](item); return enabled; }
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return [this._text, ...this.children.map(child => child.textContent)].filter(Boolean).join(' '); }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) {
    this._text = ''; this.children = [];
    children.forEach(child => child.tagName === 'FRAGMENT'
      ? child.children.forEach(nested => this.appendChild(nested)) : this.appendChild(child));
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  matches(selector) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName.toLowerCase() === selector; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(child) { return child === this || this.children.some(item => item.contains(child)); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
}

function client() {
  const ids = [
    'bedAshDischargeStatus', 'bedAshDischargeEventTableBody', 'bedAshDischargeEventCount',
    'bedAshDischargeEmptyState', 'bedAshDischargeTotalAmount', 'bedAshDischargeUnitOneAmount',
    'bedAshDischargeUnitTwoAmount', 'bedAshDischargePendingCount',
    'bedAshDischargeMinorObservations', 'bedAshDischargeMinorObservationSummary', 'bedAshDischargeMinorObservationList'
  ];
  const elements = new Map(ids.map(id => [id, new Element('div', id)]));
  for (const id of ['bedAshDischargeTotalAmount', 'bedAshDischargeUnitOneAmount', 'bedAshDischargeUnitTwoAmount', 'bedAshDischargePendingCount']) {
    const card = new Element('article'); card.append(elements.get(id), new Element('small'));
  }
  let requests = 0;
  const document = {
    readyState: 'loading', activeElement: null,
    getElementById: id => elements.get(id) || null, querySelector: () => null, querySelectorAll: () => [],
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'), addEventListener() {}
  };
  const window = { location: { pathname: '/' }, addEventListener() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {} };
  const context = vm.createContext({
    Date, Intl, console, URLSearchParams, AbortController, Element, document, window,
    localStorage: { getItem: () => null }, MutationObserver: class { observe() {} },
    fetch: async () => { requests++; throw new Error('No read-only render may send a request.'); }
  });
  const hook = '  window.__sparseUi = { state, normalizeEvent, normalizeMinorObservations, createEventRow, renderData, clearDetailData, summarizeVisibleEvents, submitReview };\n';
  vm.runInContext(source.replace('  window.openBedAshDischargeView =', hook + '  window.openBedAshDischargeView ='), context);
  return { api: window.__sparseUi, elements, requests: () => requests,
    table: elements.get('bedAshDischargeEventTableBody'), minor: elements.get('bedAshDischargeMinorObservations'),
    minorList: elements.get('bedAshDischargeMinorObservationList') };
}

const DATE = '2026-08-07';
const at = value => `${DATE}T${value}+09:00`;
const current = {
  eventKey: 'current-sparse', unitNo: 1, algorithmVersion: 'bed-ash-drop-minute-v3', isRapidDecline: true,
  sourceKind: 'dataparc_bed_ash_minute', sampleIntervalSeconds: 60,
  startAt: at('07:10:17'), endAt: at('07:28:42'), startLevelTon: 49, endLevelTon: 34,
  estimatedTon: 15, reviewReady: false, hasSourceGaps: true, sourceGapCount: 4, status: 'pending',
  closeReason: 'stable', confidence: 'low'
};
const legacy = {
  ...current, eventKey: 'saved-v1', algorithmVersion: 'bed-ash-drop-minute-v1',
  startAt: at('07:10:17'), endAt: at('07:15:01'), startLevelTon: 49, endLevelTon: 42,
  estimatedTon: 7, status: 'confirmed', reviewReady: true, hasSourceGaps: false, sourceGapCount: 0,
  confirmedAt: at('07:31:00'), confirmedTon: 10.7, revision: 3, evidenceFingerprint: 'saved-fingerprint',
  note: 'saved review', minuteObservations: [current]
};
const minor = { ...current, eventKey: 'minor', unitNo: 2, startLevelTon: 40.2, endLevelTon: 37.55, estimatedTon: 2.65 };
function payload(events = [], minors = [], extra = {}) {
  return { events, minorObservations: minors, latestLevels: {}, unitCoverage: {},
    coverage: { dates: [DATE], completeDates: [DATE], minuteDates: [DATE] }, ...extra };
}


test('reviewed v1 record shows corrected read-only sparse range while preserving saved amount and original minute provenance', () => {
  const h = client(), original = JSON.stringify(legacy);
  h.api.renderData(payload([legacy]), [DATE]);
  const row = h.table.children[0], event = h.api.state.events[0];
  assert.equal(row.querySelector('.bed-ash-discharge-minute-range').textContent, '07:10 ~ 07:28');
  assert.match(row.querySelector('.bed-ash-discharge-minute-range').title, /07:10:17 ~ 07:28:42/);
  assert.match(row.textContent, /자료 공백 포함 · 계근 확인/);
  assert.match(row.textContent, /새 관측 근거 · 읽기 전용/);
  const originalRecord = row.querySelector('.bed-ash-discharge-original-evidence');
  assert.match(originalRecord.textContent, /기존 분 감지 기록/);
  assert.match(originalRecord.textContent, /DataPARC · 1분 자료/);
  assert.match(originalRecord.textContent, /07:10 ~ 07:15/);
  assert.match(originalRecord.textContent, /확정 시각 2026.08.07 07:31/);
  assert.doesNotMatch(originalRecord.textContent, /운영정보|기존 시간기록/);
  assert.match(row.querySelector('.bed-ash-discharge-estimated-cell').textContent, /10.7t 기존 확정량 구간별 배분 안 함/);
  assert.equal(row.querySelectorAll('button').length, 0);
  assert.equal(event.eventKey, legacy.eventKey); assert.equal(event.startAt, legacy.startAt); assert.equal(event.endAt, legacy.endAt);
  assert.equal(event.revision, 3); assert.equal(event.confirmedTon, 10.7); assert.equal(event.evidenceFingerprint, legacy.evidenceFingerprint);
  assert.equal(event.minuteObservations[0].confirmedTon, undefined); assert.equal(event.minuteObservations[0].reviewReady, false);
  assert.equal(h.api.state.summary.confirmedTon, 10.7); assert.equal(h.api.state.summary.pendingEstimatedTon, 0);
  assert.equal(h.elements.get('bedAshDischargeTotalAmount').textContent, '15.0t');
  assert.match(h.elements.get('bedAshDischargeTotalAmount').closest('article').querySelector('small').textContent, /계근 확정 1건 · 10.7t/);
  assert.equal(JSON.stringify(legacy), original); assert.equal(h.requests(), 0);
});

test('excluded v1 parent retains exclusion with corrected read-only evidence and contributes no amount', () => {
  const h = client(), excluded = h.api.normalizeEvent({ ...legacy, status: 'excluded', confirmedAt: '', confirmedTon: null });
  const row = h.api.createEventRow(excluded);
  assert.match(row.textContent, /기존 분 감지 기록/); assert.match(row.textContent, /기존 제외 기록/);
  assert.match(row.textContent, /구간별 배분 안 함/); assert.equal(row.querySelectorAll('button').length, 0);
  assert.equal(excluded.status, 'excluded'); assert.equal(excluded.estimatedTon, 7);
  const summary = h.api.summarizeVisibleEvents([excluded]);
  assert.equal(summary.confirmedTon, 0); assert.equal(summary.pendingEstimatedTon, 0); assert.equal(summary.observationCount, 0);
});

test('shared corrected interval across saved v1 records never divides or adds to the historical confirmation amounts', () => {
  const h = client(), observation = { ...current, sharedReviewedEvidence: true, relatedReviewedEventKeys: ['saved-v1', 'saved-v1-second'] };
  const events = [{ ...legacy, minuteObservations: [observation] },
    { ...legacy, eventKey: 'saved-v1-second', confirmedTon: 9.4, minuteObservations: [observation] }];
  h.api.renderData(payload(events), [DATE]);
  assert.equal(h.api.state.summary.confirmedCount, 2); assert.equal(h.api.state.summary.confirmedTon, 20.1);
  assert.equal(h.api.state.summary.pendingEstimatedTon, 0);
  for (const row of h.table.children) {
    assert.match(row.textContent, /공유 감지 근거 · 개별 반출 연결 미확정/);
    assert.match(row.textContent, /구간별 배분 안 함/); assert.equal(row.querySelectorAll('button').length, 0);
  }
});

test('gap metadata overrides an incorrectly enabled review flag, keeps source seconds and blocks submission', async () => {
  const h = client(), event = h.api.normalizeEvent({ ...current, reviewReady: true, hasSourceGaps: false });
  const row = h.api.createEventRow(event), summary = h.api.summarizeVisibleEvents([event]);
  assert.equal(event.hasSourceGaps, true); assert.equal(event.reviewReady, false); assert.equal(event.confidence, 'low');
  assert.equal(row.querySelectorAll('button').length, 0);
  assert.match(row.children[0].title, /07:10:17 ~ 07:28:42/);
  assert.match(row.textContent, /자료 공백 포함 · 계근 확인/);
  assert.equal(summary.incompleteCount, 1); assert.equal(summary.pendingCount, 0);
  assert.equal(summary.pendingEstimatedTon, 0); assert.equal(summary.confirmedTon, 0);
  await h.api.submitReview({ ...event, reviewReady: true }, row.children.at(-1), 'confirmed');
  assert.equal(h.requests(), 0); assert.match(h.elements.get('bedAshDischargeStatus').textContent, /자료 공백/);
});

test('contiguous settled observation still permits normal manual review without acquiring confirmed quantity', () => {
  const h = client(), event = h.api.normalizeEvent({ ...current, hasSourceGaps: false, sourceGapCount: 0, reviewReady: true });
  const row = h.api.createEventRow(event), summary = h.api.summarizeVisibleEvents([event]);
  assert.equal(row.querySelectorAll('button').length, 1); assert.match(row.textContent, /확인 입력/);
  assert.equal(summary.pendingEstimatedTon, 15); assert.equal(summary.confirmedTon, 0);
});

test('minor observations render only valid subthreshold evidence, stay read-only and never enter event totals', () => {
  const h = client();
  h.api.renderData(payload([], [minor,
    { ...minor, estimatedTon: 5 }, { ...minor, estimatedTon: 0.49 }, { ...minor, estimatedTon: null },
    { ...minor, estimatedTon: NaN }, { ...minor, estimatedTon: Infinity },
    { ...minor, startLevelTon: null }, { ...minor, unitNo: 3 }, { ...minor, sourceKind: 'ois_bed_ash_hourly' },
    { ...minor, endAt: minor.startAt }, { ...minor, endAt: 'malformed' }
  ], { minorObservationsOmitted: 2 }), [DATE]);
  assert.equal(h.minor.hidden, false); assert.equal(h.minorList.children.length, 1);
  assert.match(h.minorList.textContent, /2호기 · 관측 구간 07:10 ~ 07:28/);
  assert.match(h.minorList.textContent, /40.2t → 37.55t · 관측 감소 2.65t/);
  assert.match(h.minorList.textContent, /3.0t 미만 · 읽기 전용/);
  assert.match(h.minorList.textContent, /자료 공백 포함 · 계근 확인/);
  assert.match(h.elements.get('bedAshDischargeMinorObservationSummary').textContent, /1구간 · 3t 미만·완만한 감소 · 추가 2구간 생략/);
  assert.equal(h.minorList.querySelectorAll('button').length, 0);
  assert.equal(h.api.state.summary.observationCount, 0); assert.equal(h.api.state.summary.pendingEstimatedTon, 0);
  assert.equal(h.api.state.summary.confirmedTon, 0); assert.equal(h.table.children.length, 0);
  assert.doesNotMatch(h.minorList.textContent, /NaN|Infinity/); assert.equal(h.requests(), 0);
});

test('new empty range and explicit detail reset both remove stale minor evidence and prior totals', () => {
  const h = client();
  for (const clear of [() => h.api.renderData(payload(), [DATE]), () => h.api.clearDetailData()]) {
    h.api.renderData(payload([legacy], [minor], { minorObservationsOmitted: 2 }), [DATE]);
    assert.equal(h.minorList.children.length, 1); assert.equal(h.table.children.length, 1);
    clear();
    assert.equal(h.minorList.children.length, 0); assert.equal(h.minor.hidden, true);
    assert.equal(h.table.children.length, 0); assert.equal(h.api.state.minorObservationsOmitted, 0);
    assert.equal(h.api.state.summary.confirmedTon, 0); assert.equal(h.elements.get('bedAshDischargeTotalAmount').textContent, '감지 내역 없음');
  }
});

test('malformed or wrong-unit nested gap evidence cannot replace reviewed source provenance or introduce NaN', () => {
  const h = client(), event = h.api.normalizeEvent({ ...legacy, minuteObservations: [
    { ...current, eventKey: 'null-level', startLevelTon: null },
    { ...current, eventKey: 'other-unit', unitNo: 2 },
    { ...current, eventKey: 'bad-time', startAt: 'bad-time' },
    { ...current, eventKey: 'no-source', sourceKind: '' },
    { ...current, eventKey: 'bad-number', estimatedTon: Infinity },
    current, current
  ] });
  assert.equal(event.minuteObservations.length, 1);
  const row = h.api.createEventRow(event);
  assert.doesNotMatch(row.textContent, /NaN|Infinity/); assert.equal(event.confirmedTon, 10.7);
  assert.equal(event.minuteObservations[0].confirmedTon, undefined);
});
