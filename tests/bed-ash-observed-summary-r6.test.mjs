import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../efficiency/bed-ash-discharge.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Browser surfaces only. Production normalization, summary and rendering run
// unchanged; any network request from this read-only render is a test failure.
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
    'bedAshDischargeMinorObservations', 'bedAshDischargeMinorObservationSummary', 'bedAshDischargeMinorObservationList',
    'bedAshDischargeSourceDetails', 'bedAshDischargeSourceDetailText'
  ];
  const elements = new Map(ids.map(id => [id, new Element(id.endsWith('SourceDetails') ? 'details' : 'div', id)]));
  for (const id of ['bedAshDischargeTotalAmount', 'bedAshDischargeUnitOneAmount', 'bedAshDischargeUnitTwoAmount', 'bedAshDischargePendingCount']) {
    new Element('article').append(elements.get(id), new Element('small'));
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
    fetch: async () => { requests++; throw new Error('Summary presentation cannot start a source job or review.'); }
  });
  const hook = '  window.__observedSummaryR6 = { state, normalizeEvent, renderData, clearDetailData, summarizeVisibleEvents };\n';
  vm.runInContext(source.replace('  window.openBedAshDischargeView =', hook + '  window.openBedAshDischargeView ='), context);
  return { api: window.__observedSummaryR6, elements, requests: () => requests,
    value: id => elements.get(id).textContent,
    detail: id => elements.get(id).closest('article').querySelector('small').textContent };
}

const DAY = '2026-08-07';
const at = time => `${DAY}T${time}+09:00`;
const amountIds = ['bedAshDischargeTotalAmount', 'bedAshDischargeUnitOneAmount', 'bedAshDischargeUnitTwoAmount'];
function observation(eventKey, unitNo, estimatedTon, startAt = '07:10:17', endAt = '07:28:42') {
  return {
    eventKey, unitNo, algorithmVersion: 'bed-ash-drop-minute-v2',
    sourceKind: 'dataparc_bed_ash_minute', sampleIntervalSeconds: 60,
    startAt: at(startAt), endAt: at(endAt), startLevelTon: 60, endLevelTon: 60 - estimatedTon,
    estimatedTon, reviewReady: false, hasSourceGaps: true, sourceGapCount: 3,
    status: 'pending', closeReason: 'stable', confidence: 'low'
  };
}
function coverage(valid) {
  return { hasMinuteSource: true, minuteSampleCount: 1440, validMinuteSampleCount: valid,
    missingMinuteSampleCount: 1440 - valid, hasGaps: true };
}
function payload(events = [], extra = {}) {
  return {
    events, minorObservations: [], latestLevels: {},
    unitCoverage: { 1: coverage(494), 2: coverage(697) },
    coverage: { dates: [DAY], completeDates: [], missingDates: [DAY], minuteDates: [DAY] },
    ...extra
  };
}

// Synthetic observations preserve the five-interval and sparse-coverage shape
// of the reported incident, without storing the plant's original packet.
const five = [
  observation('unit1-first', 1, 15.110, '03:23:17', '03:39:42'),
  observation('unit1-second', 1, 15.388, '08:04:17', '08:30:42'),
  observation('unit2-first', 2, 5.040, '02:37:17', '02:46:42'),
  observation('unit2-second', 2, 12.474, '07:24:17', '07:58:42'),
  observation('unit2-third', 2, 11.440, '15:02:17', '15:26:42')
];

test('five sparse observed intervals display their measured decreases without requiring all 1440 daily buckets', () => {
  const h = client(), raw = payload(five), original = JSON.stringify(raw);
  h.api.renderData(raw, [DAY]);
  const s = h.api.state.summary;
  assert.equal(s.observedCount, 5); assert.equal(s.observedTon, 59.452);
  assert.equal(s.units[1].observedCount, 2); assert.equal(s.units[1].observedTon, 30.498);
  assert.equal(s.units[2].observedCount, 3); assert.equal(s.units[2].observedTon, 28.954);
  assert.equal(h.value(amountIds[0]), '59.45t');
  assert.equal(h.value(amountIds[1]), '30.5t'); assert.equal(h.value(amountIds[2]), '28.95t');
  assert.match(h.detail(amountIds[1]), /관측 2구간/); assert.match(h.detail(amountIds[2]), /관측 3구간/);
  for (const id of amountIds) {
    assert.doesNotMatch(h.value(id), /미확정|0\.0t/);
    assert.doesNotMatch(h.detail(id), /1440|1,440|494|697/);
    assert.match(h.detail(id), /계근 확정/);
  }
  assert.equal(s.confirmedTon, 0); assert.equal(s.confirmedCount, 0);
  assert.equal(s.pendingEstimatedTon, 0); assert.equal(s.incompleteCount, 5);
  assert.equal(JSON.stringify(raw), original); assert.equal(h.requests(), 0);
});

test('source completeness remains inspectable in collapsed details and is not an eligibility test for observed totals', () => {
  const h = client(); h.api.renderData(payload(five), [DAY]);
  assert.equal(h.elements.get('bedAshDischargeSourceDetails').hidden, false);
  const detail = h.value('bedAshDischargeSourceDetailText').replaceAll(',', '');
  assert.match(detail, /494\/1440/); assert.match(detail, /697\/1440/);
  const detailsTag = html.match(/<details\b[^>]*id="bedAshDischargeSourceDetails"[^>]*>/)?.[0];
  assert.ok(detailsTag, 'the source counts need a real collapsible details element');
  assert.doesNotMatch(detailsTag, /\bopen(?:\s|=|>)/);
  h.api.renderData(payload(five, { unitCoverage: { 1: coverage(1440), 2: coverage(1440) } }), [DAY]);
  assert.equal(h.api.state.summary.observedTon, 59.452);
});

test('an entirely missing source never renders zero tons or a no-discharge conclusion', () => {
  const h = client();
  h.api.renderData(payload([], { unitCoverage: { 1: coverage(0), 2: coverage(0) } }), [DAY]);
  for (const id of amountIds) assert.doesNotMatch(h.value(id), /^0(?:[.,]0+)?t$|반출 없음/);
  assert.equal(h.value(amountIds[1]), '자료 없음'); assert.equal(h.value(amountIds[2]), '자료 없음');
  assert.equal(h.api.state.summary.observedCount, 0); assert.equal(h.requests(), 0);
});

test('received source without a detected interval is distinct from missing source and does not invent an observed amount', () => {
  const h = client(); h.api.renderData(payload(), [DAY]);
  assert.equal(h.value(amountIds[1]), '감지 내역 없음'); assert.equal(h.value(amountIds[2]), '감지 내역 없음');
  assert.equal(h.api.state.summary.observedCount, 0); assert.equal(h.api.state.summary.observedTon, 0);
});

test('manual confirmation remains separate from measured decrease and never changes on a summary read', () => {
  const h = client();
  const saved = { ...five[0], status: 'confirmed', confirmedTon: 18.6, confirmedAt: at('04:00:00'),
    revision: 4, note: 'manual weighbridge amount', evidenceFingerprint: 'original-evidence' };
  const raw = payload([saved, five[1]]), original = JSON.stringify(raw);
  h.api.renderData(raw, [DAY]);
  const s = h.api.state.summary;
  assert.equal(s.observedTon, 30.498); assert.equal(s.observedCount, 2);
  assert.equal(s.confirmedTon, 18.6); assert.equal(s.confirmedCount, 1);
  assert.equal(h.value(amountIds[1]), '30.5t'); assert.match(h.detail(amountIds[1]), /18\.6t/);
  assert.equal(s.incompleteCount, 1); assert.equal(s.pendingEstimatedTon, 0);
  const normalized = h.api.state.events.find(event => event.eventKey === saved.eventKey);
  assert.equal(normalized.confirmedTon, 18.6); assert.equal(normalized.revision, 4);
  assert.equal(normalized.evidenceFingerprint, 'original-evidence');
  assert.equal(JSON.stringify(raw), original); assert.equal(h.requests(), 0);
});

test('excluded parent and its corrected evidence contribute no measured or confirmed amount', () => {
  const h = client();
  const excluded = { ...five[0], status: 'excluded', confirmedTon: 100,
    minuteObservations: [{ ...five[1], estimatedTon: 19 }] };
  h.api.renderData(payload([excluded, five[2]]), [DAY]);
  const s = h.api.state.summary;
  assert.equal(s.observedTon, 5.04); assert.equal(s.observedCount, 1);
  assert.equal(s.units[1].observedTon, 0); assert.equal(s.confirmedTon, 0);
});

test('shared corrected minute evidence replaces obsolete parent estimates and counts once across parents and top-level events', () => {
  const h = client(), current = { ...five[0], sharedReviewedEvidence: true, relatedReviewedEventKeys: ['legacy-a', 'legacy-b'] };
  const parents = [7, 8].map((amount, index) => ({
    ...five[0], eventKey: index ? 'legacy-b' : 'legacy-a', algorithmVersion: 'bed-ash-drop-minute-v1',
    estimatedTon: amount, status: 'confirmed', confirmedTon: amount + 1,
    confirmedAt: at('04:00:00'), minuteObservations: [current]
  }));
  h.api.renderData(payload([...parents, current]), [DAY]);
  const s = h.api.state.summary;
  assert.equal(s.observedTon, 15.11); assert.equal(s.observedCount, 1);
  assert.equal(s.units[1].observedCount, 1); assert.equal(s.confirmedTon, 17); assert.equal(s.confirmedCount, 2);
  assert.equal(h.requests(), 0);
});

test('multiple current intervals attached to one reviewed record count individually without redistributing its saved confirmation', () => {
  const h = client();
  const saved = { ...five[0], eventKey: 'legacy-aggregate', status: 'confirmed', confirmedTon: 32.4,
    algorithmVersion: 'bed-ash-drop-v2', sourceKind: 'ois_bed_ash_hourly', sampleIntervalSeconds: 3600,
    estimatedTon: 31, minuteObservations: [five[0], five[1]] };
  h.api.renderData(payload([saved]), [DAY]);
  assert.equal(h.api.state.summary.observedCount, 2); assert.equal(h.api.state.summary.observedTon, 30.498);
  assert.equal(h.api.state.summary.confirmedCount, 1); assert.equal(h.api.state.summary.confirmedTon, 32.4);
});

test('deduplication preserves a shared-evidence warning regardless of duplicate row order', () => {
  const standalone = { ...five[0], sharedReviewedEvidence: false };
  const parent = { ...five[0], eventKey: 'legacy-shared', status: 'confirmed', confirmedTon: 17.3,
    minuteObservations: [{ ...five[0], sharedReviewedEvidence: true, relatedReviewedEventKeys: ['legacy-shared', 'legacy-other'] }] };
  for (const events of [[standalone, parent], [parent, standalone]]) {
    const h = client(); h.api.renderData(payload(events), [DAY]);
    assert.equal(h.api.state.summary.observedCount, 1); assert.equal(h.api.state.summary.observedTon, 15.11);
    assert.equal(h.api.state.summary.sharedObservedCount, 1);
    assert.match(h.detail(amountIds[1]), /공유 근거 1구간/);
  }
});

test('unsettled measured intervals display observations while keeping the previous review-readiness guard', () => {
  const h = client();
  const unsettled = { ...five[0], hasSourceGaps: false, sourceGapCount: 0, closeReason: 'range_end', reviewReady: false };
  h.api.renderData(payload([unsettled]), [DAY]);
  const s = h.api.state.summary;
  assert.equal(s.observedTon, 15.11); assert.equal(s.observedCount, 1);
  assert.equal(s.incompleteCount, 1); assert.equal(s.pendingEstimatedTon, 0); assert.equal(s.confirmedTon, 0);
  assert.equal(h.elements.get('bedAshDischargeEventTableBody').querySelectorAll('button').length, 0);
});

test('subthreshold read-only observations stay outside the main observed totals', () => {
  const h = client();
  h.api.renderData(payload([five[0]], { minorObservations: [observation('minor', 2, 2.7)] }), [DAY]);
  assert.equal(h.api.state.summary.observedCount, 1); assert.equal(h.api.state.summary.observedTon, 15.11);
  assert.equal(h.api.state.summary.units[2].observedCount, 0);
  assert.match(h.value('bedAshDischargeMinorObservationList'), /2\.7t/); assert.equal(h.requests(), 0);
});

test('date reset clears observed totals and source-detail text so prior sparse results cannot leak to a new date', () => {
  const h = client(); h.api.renderData(payload(five), [DAY]);
  h.api.clearDetailData();
  assert.equal(h.api.state.summary.observedCount, 0); assert.equal(h.api.state.summary.observedTon, 0);
  assert.equal(h.elements.get('bedAshDischargeSourceDetails').hidden, true);
  assert.doesNotMatch(h.value('bedAshDischargeSourceDetailText'), /494|697/);
  for (const id of amountIds) assert.doesNotMatch(h.value(id), /59\.45|30\.5|28\.95/);
  assert.equal(h.requests(), 0);
});

test('page titles identify observed amounts and each existing loader requests the R6 presentation once', () => {
  for (const label of ['관측 감소량 합계', '1호기 관측 감소량', '2호기 관측 감소량']) assert.ok(html.includes(label), label);
  for (const extension of ['js', 'css']) {
    const matches = [...html.matchAll(new RegExp(`/efficiency/bed-ash-discharge\\.${extension}\\?[^"\\s]+`, 'g'))];
    assert.equal(matches.length, 1, extension); assert.match(matches[0][0], /minuteDetection=20261013-v1-r6/);
  }
});
