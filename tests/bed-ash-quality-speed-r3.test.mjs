import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../efficiency/bed-ash-discharge.js', import.meta.url), 'utf8');
const TODAY = '2026-10-13';
const SELECTED = '2026-10-12';
const JOB = date => `active-${date}`;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// Only browser surfaces, transport and the clock are simulated. The feature's
// date calculation, bound handlers, rendering, loading and polling stay intact.
class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.dataset = {};
    this.attributes = {}; this.children = []; this.listeners = new Map();
    this.value = ''; this.disabled = false; this.hidden = false;
    this.className = ''; this.style = {}; this._text = '';
    const names = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...values) => { this.className = [...new Set([...names(), ...values])].join(' '); },
      remove: (...values) => { this.className = [...names()].filter(v => !values.includes(v)).join(' '); },
      contains: value => names().has(value),
      toggle: (value, enabled) => {
        enabled ??= !names().has(value);
        this.classList[enabled ? 'add' : 'remove'](value);
        return enabled;
      }
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent || '').join(' '); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, callback) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
  }
  async fire(type) {
    for (const callback of this.listeners.get(type) || []) await callback({ target: this, type });
  }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) {
    this._text = ''; this.children = [];
    children.forEach(child => child.tagName === 'FRAGMENT'
      ? child.children.forEach(c => this.appendChild(c)) : this.appendChild(child));
  }
  contains(child) { return child === this || this.children.some(c => c.contains?.(child)); }
  matches(selector) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName.toLowerCase() === selector; }
  querySelectorAll(selector) {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
}

function hourlyEvents(date) {
  return Array.from({ length: 5 }, (_, index) => ({
    eventKey: `saved-${date}-${index}`, unitNo: index % 2 + 1,
    startAt: `${date}T07:00:00+09:00`, endAt: `${date}T09:00:00+09:00`,
    thresholdCrossedAt: `${date}T08:00:00+09:00`, startLevelTon: 30,
    endLevelTon: 20, estimatedTon: 10, status: 'confirmed', confirmedTon: 10,
    confirmedAt: `${date}T09:00:00+09:00`, algorithmVersion: 'bed-ash-drop-v2',
    sourceKind: 'ois_bed_ash_hourly', sampleIntervalSeconds: 3600
  }));
}

function savedData(date, options = {}) {
  const minute = options.minute === true;
  const events = hourlyEvents(date);
  if (minute) {
    events[0].minuteObservations = [{
      eventKey: `minute-${date}`, unitNo: 1,
      startAt: `${date}T07:03:17+09:00`, endAt: `${date}T07:08:21+09:00`,
      startLevelTon: 30, endLevelTon: 20, estimatedTon: 10,
      sourceKind: 'dataparc_bed_ash_minute', sampleIntervalSeconds: 60, reviewReady: true
    }];
  }
  return {
    events, latestLevels: {}, coverage: {
      dates: [date], completeDates: [date], missingDates: [], pendingDates: [], failedDates: [],
      requests: [{ date, status: 'complete', requestId: `saved-${date}` }],
      minuteDates: minute ? [date] : [], hourlyDates: minute ? [] : [date],
      baseline: null, lookahead: options.lookahead || null
    }
  };
}

function client(options = {}) {
  let token = 'session-a', now = Date.parse(`${TODAY}T10:22:00+09:00`), timerId = 0;
  const timers = new Map(), windowListeners = new Map();
  const ids = [
    'efficiencyBedAshDischargeView', 'efficiencyBedAshDischargeTab',
    'bedAshDischargeAnchorDate', 'refreshBedAshDischargeButton', 'bedAshDischargeRangeLabel',
    'bedAshDischargeStatus', 'bedAshDischargeEventTableBody', 'bedAshDischargeEventCount',
    'bedAshDischargeLoadingState', 'bedAshDischargeEmptyState',
    'bedAshDischargeTotalAmount', 'bedAshDischargeUnitOneAmount', 'bedAshDischargeUnitTwoAmount',
    'bedAshDischargeUnitOneLatestLevel', 'bedAshDischargeUnitOneLatestAt',
    'bedAshDischargeUnitTwoLatestLevel', 'bedAshDischargeUnitTwoLatestAt'
  ];
  const elements = new Map(ids.map(id => [id, new Element(id.includes('Button') ? 'button' : 'div', id)]));
  elements.get('efficiencyBedAshDischargeView').classList.add('is-active');
  for (const id of ['bedAshDischargeTotalAmount', 'bedAshDischargeUnitOneAmount', 'bedAshDischargeUnitTwoAmount']) {
    const article = new Element('article'); article.append(elements.get(id), new Element('small'));
  }
  const calls = { ranges: [], posts: [], statuses: [] };
  const document = {
    readyState: 'loading', visibilityState: 'visible', activeElement: null,
    getElementById: id => elements.get(id) || null, querySelectorAll: () => [], querySelector: () => null,
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'),
    addEventListener() {}
  };
  const window = {
    location: { pathname: options.mobile ? '/mobile-app/' : '/' },
    getShiftLogSessionToken: () => token,
    addEventListener: (type, fn) => windowListeners.set(type, [...(windowListeners.get(type) || []), fn]),
    setInterval() {}, setTimeout: (fn, ms = 0) => {
      const id = ++timerId; timers.set(id, { fn, ms }); return id;
    }, clearTimeout: id => timers.delete(id)
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({
    console, Date: Clock, URL, URLSearchParams, Response, AbortController, Element, document, window,
    localStorage: { getItem: () => null }, MutationObserver: class { observe() {} disconnect() {} },
    fetch: async (url, init = {}) => {
      const parsed = new URL(url, 'https://fixture.invalid');
      if (parsed.pathname === '/api/bed-ash-discharge') {
        if (parsed.searchParams.get('mode') === 'summary') {
          return Response.json({ ok: true, data: { pendingCount: 0, pendingEstimatedTon: 0, latestPending: null } });
        }
        const request = {
          startDate: parsed.searchParams.get('startDate'), endDate: parsed.searchParams.get('endDate'),
          authorization: init.headers.Authorization
        };
        calls.ranges.push(request);
        const payload = options.range ? await options.range(request, calls) : savedData(request.startDate);
        return Response.json({ ok: true, data: payload });
      }
      assert.equal(parsed.pathname, '/api/ois-data-requests');
      if (init.method === 'POST') {
        const body = JSON.parse(init.body); calls.posts.push(body);
        return Response.json({ ok: true, item: {
          id: JOB(body.targetDate), requestType: 'bed_ash_level', targetDate: body.targetDate, status: 'pending'
        } });
      }
      assert.equal(parsed.searchParams.get('action'), 'status_batch');
      assert.equal(parsed.searchParams.get('compact'), '1');
      const ids = parsed.searchParams.get('ids').split(','); calls.statuses.push(ids);
      const status = options.status ? await options.status(ids, calls) : 'complete';
      return Response.json({ ok: true, items: ids.map(id => ({
        id, requestType: 'bed_ash_level', targetDate: id.slice('active-'.length), status
      })), missingIds: [] });
    }
  });
  const hook = '  window.__refreshR2 = {state, initialize, loadSelectedRange};\n';
  vm.runInContext(source.replace('  window.openBedAshDischargeView =', hook + '  window.openBedAshDischargeView ='), context);
  const api = window.__refreshR2;
  const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  const poll = async () => {
    now += 2000;
    const pending = [...timers].filter(([, timer]) => timer.ms === 2000);
    assert.ok(pending.length, 'a real poll delay was scheduled');
    for (const [id, timer] of pending) { timers.delete(id); timer.fn(); }
    await flush();
  };
  const date = elements.get('bedAshDischargeAnchorDate');
  const refresh = elements.get('refreshBedAshDischargeButton');
  const status = elements.get('bedAshDischargeStatus');
  const table = elements.get('bedAshDischargeEventTableBody');
  api.initialize();
  return {
    api, calls, date, refresh, status, table, flush, poll, elements,
    choose: async value => { date.value = value; await date.fire('change'); await flush(); },
    switchAccount: async value => {
      token = value;
      for (const fn of windowListeners.get('storage') || []) fn({ key: 'gsShiftLog.currentUser' });
      await flush();
    }
  };
}

const support = (date, status = 'pending') => ({
  date, available: true, status, pending: status === 'pending', complete: false, requestId: JOB(date)
});
const card = (h, id) => h.elements.get(id);
const detail = (h, id) => card(h, id).parentElement.querySelector('small').textContent;
function qualityData() {
  const data = savedData(SELECTED, { minute: true, lookahead: support(TODAY) });
  data.coverage.baseline = support('2026-10-11');
  data.events = [7, 9.03, 6].map((estimatedTon, index) => ({
    ...hourlyEvents(SELECTED)[index], eventKey: `candidate-${index}`, unitNo: 1,
    algorithmVersion: 'bed-ash-drop-minute-v1', sourceKind: 'dataparc_bed_ash_minute',
    sampleIntervalSeconds: 60, status: 'pending', confirmedTon: null,
    estimatedTon, reviewReady: index === 0, closeReason: index === 0 ? 'stable' : 'data_gap'
  }));
  data.latestLevels = {
    1: { unitNo: 1, sampledAt: `${SELECTED}T18:01:17+09:00`, levelTon: 17.5 },
    2: { unitNo: 2, sampledAt: `${SELECTED}T23:59:00+09:00`, levelTon: null }
  };
  data.unitCoverage = {
    1: { hasMinuteSource: true, minuteSampleCount: 1440, validMinuteSampleCount: 1400,
      missingMinuteSampleCount: 40, hasGaps: true, latestMinuteBucketAt: `${SELECTED}T23:59:00+09:00`,
      latestMinuteMissing: true, latestValidAt: `${SELECTED}T18:01:17+09:00`, hourlySampleCount: 0 },
    2: { hasMinuteSource: true, minuteSampleCount: 1440, validMinuteSampleCount: 0,
      missingMinuteSampleCount: 1440, hasGaps: true, latestMinuteBucketAt: `${SELECTED}T23:59:00+09:00`,
      latestMinuteMissing: true, latestValidAt: '', hourlySampleCount: 0 }
  };
  return data;
}

test('three minute candidates with two incomplete endings do not become confirmed tons and missing unit2 cannot imply no discharge', async () => {
  const raw = qualityData(), before = JSON.stringify(raw);
  const h = client({ range: () => raw }); await h.choose(SELECTED);
  assert.equal(h.table.children.length, 3);
  assert.equal(h.api.state.summary.confirmedTon, 0);
  assert.equal(h.api.state.summary.pendingEstimatedTon, 7);
  assert.equal(h.api.state.summary.pendingCount, 1);
  assert.equal(h.api.state.summary.incompleteCount, 2);
  assert.equal(card(h, 'bedAshDischargeTotalAmount').textContent, '22.03t');
  assert.match(detail(h, 'bedAshDischargeTotalAmount'), /관측 3구간 · 계근 확정 0건 · 0.0t/);
  assert.equal(card(h, 'bedAshDischargeUnitOneAmount').textContent, '22.03t');
  assert.equal(card(h, 'bedAshDischargeUnitTwoAmount').textContent, '자료 없음');
  assert.match(detail(h, 'bedAshDischargeUnitTwoAmount'), /반출 여부 확인 불가/);
  assert.equal(card(h, 'bedAshDischargeUnitTwoLatestLevel').textContent, '--.-t');
  assert.match(card(h, 'bedAshDischargeUnitTwoLatestAt').textContent, /23:59 자료 미수신/);
  assert.equal(card(h, 'bedAshDischargeUnitOneLatestLevel').textContent, '17.5t');
  assert.equal(card(h, 'bedAshDischargeUnitOneLatestAt').textContent, '18:01 기준 · 이후 미수신');
  assert.match(card(h, 'bedAshDischargeUnitOneLatestAt').title, /18:01 마지막 유효값 · .*23:59 자료 미수신/);
  assert.equal(h.status.dataset.state, 'warning');
  assert.match(h.status.title, /1호기 자료 누락 있음/);
  assert.match(h.status.textContent, /2호기 미수신/);
  assert.match(h.status.title, /2호기 1분 자료 미수신/);
  assert.match(h.status.title, /자료 확인 2구간/);
  assert.doesNotMatch(h.status.textContent, /첫날 자정|후속 자료|조회 중/);
  assert.equal(h.calls.posts.length, 0); assert.equal(h.calls.statuses.length, 0);
  assert.equal(JSON.stringify(raw), before, 'readonly presentation must retain source records and quantities');
});

test('latest missing or blank values stay absent while an explicitly measured zero remains visible', async () => {
  for (const missing of [null, '', '0', '12.3', undefined]) {
    const raw = savedData(SELECTED, { minute: true });
    raw.latestLevels = {
      1: { unitNo: 1, sampledAt: `${SELECTED}T23:59:00+09:00`, levelTon: missing },
      2: { unitNo: 2, sampledAt: `${SELECTED}T23:59:17+09:00`, levelTon: 0 }
    };
    const h = client({ range: () => raw }); await h.choose(SELECTED);
    assert.equal(card(h, 'bedAshDischargeUnitOneLatestLevel').textContent, '--.-t');
    assert.equal(card(h, 'bedAshDischargeUnitTwoLatestLevel').textContent, '0.0t');
    assert.match(card(h, 'bedAshDischargeUnitTwoLatestAt').textContent, /23:59 기준/);
    assert.match(card(h, 'bedAshDischargeUnitTwoLatestAt').title, /23:59 마지막 유효값/);
  }
});

test('minute force queues only the selected date and completes without waiting for already pending adjacent jobs', async () => {
  let complete = false;
  const h = client({
    range: () => {
      const payload = savedData(SELECTED, { minute: complete, lookahead: support(TODAY) });
      payload.coverage.baseline = support('2026-10-11'); return payload;
    },
    status: ids => ids.includes(JOB(SELECTED)) && complete ? 'complete' : 'pending'
  });
  await h.choose(SELECTED);
  assert.equal(h.calls.posts.length, 0);
  assert.deepEqual(h.calls.statuses[0].sort(), [JOB('2026-10-11'), JOB(TODAY)].sort());
  const forced = h.refresh.fire('click'); await h.flush();
  assert.deepEqual(h.calls.posts, [{ requestType: 'bed_ash_level', targetDate: SELECTED, forceRefresh: true }]);
  assert.deepEqual(h.calls.statuses.at(-1), [JOB(SELECTED)]);
  assert.match(h.status.textContent, /OIS 수집 0\/1건 완료 · 선택일 0\/1건/);
  assert.doesNotMatch(h.status.textContent, /시간자료 보완/);
  complete = true; await h.poll(); await forced;
  assert.equal(h.api.state.activeRangeLoad, null); assert.equal(h.api.state.loading, false);
  assert.equal(h.api.state.coverage.baseline.pending, true);
  assert.equal(h.api.state.coverage.lookahead.pending, true);
  assert.equal(h.api.state.coverage.minuteDates[0], SELECTED);
  assert.equal(h.status.dataset.state, 'success'); assert.equal(h.date.value, SELECTED);
  assert.equal(h.calls.posts.length, 1, 'the server jobs for prior/next day must stay untouched');
  assert.equal(h.calls.ranges.length, 3, 'one ordinary read, one forced saved read and one terminal read');
});

test('ordinary minute navigation ignores missing and pending legacy support without starting or polling adjacent jobs', async () => {
  for (const status of ['pending', 'missing']) {
    const raw = savedData(SELECTED, { minute: true, lookahead: support(TODAY, status) });
    raw.coverage.baseline = support('2026-10-11', status);
    const h = client({ range: () => raw }); await h.choose(SELECTED);
    assert.equal(h.calls.posts.length, 0); assert.equal(h.calls.statuses.length, 0);
    assert.equal(h.api.state.activeRangeLoad, null); assert.equal(h.status.dataset.state, 'success');
    assert.doesNotMatch(h.status.textContent, /자정 기준|후속 자료|처리 중/);
  }
});

test('received partial minute data is reused on navigation and retried only by an explicit selected-day force', async () => {
  const raw = qualityData(); raw.coverage.completeDates = []; raw.coverage.missingDates = [SELECTED];
  raw.coverage.lookahead = support(TODAY, 'missing'); raw.coverage.baseline = support('2026-10-11', 'missing');
  const h = client({ range: () => raw }); await h.choose(SELECTED);
  assert.equal(h.calls.posts.length, 0); assert.equal(h.calls.statuses.length, 0);
  assert.equal(h.api.state.activeRangeLoad, null); assert.equal(h.status.dataset.state, 'warning');
  assert.match(h.status.title, /1\/1일 자료 수신/);
  assert.match(h.status.title, /1분 자료 일부 미수신 1일/);
  assert.doesNotMatch(h.status.textContent, /자료 없음 1일/);
  await h.api.loadSelectedRange();
  assert.equal(h.calls.posts.length, 0, 'intrinsic NoData must not start collection every time the view opens');
  await h.refresh.fire('click');
  assert.deepEqual(h.calls.posts, [{ requestType: 'bed_ash_level', targetDate: SELECTED, forceRefresh: true }]);
  assert.deepEqual(h.calls.statuses, [[JOB(SELECTED)]]);
  assert.equal(h.status.dataset.state, 'warning'); assert.equal(h.api.state.coverage.completeDates.length, 0);
  assert.equal(h.api.state.anchorDate, SELECTED); assert.equal(h.calls.ranges.length, 4);
});

test('ordinary partial-minute reuse still observes an already active selected-day job without adopting adjacent jobs', async () => {
  let complete = false;
  const h = client({
    range: () => {
      const raw = qualityData(); raw.coverage.completeDates = [];
      raw.coverage.pendingDates = complete ? [] : [SELECTED];
      raw.coverage.missingDates = complete ? [SELECTED] : [];
      raw.coverage.requests = [{ date: SELECTED, requestId: JOB(SELECTED), status: complete ? 'complete' : 'processing' }];
      return raw;
    },
    status: () => complete ? 'complete' : 'processing'
  });
  await h.choose(SELECTED);
  assert.equal(h.calls.posts.length, 0); assert.deepEqual(h.calls.statuses, [[JOB(SELECTED)]]);
  assert.match(h.status.textContent, /선택일 0\/1건/); assert.doesNotMatch(h.status.textContent, /시간자료 보완/);
  complete = true; await h.poll();
  assert.equal(h.api.state.activeRangeLoad, null); assert.equal(h.calls.posts.length, 0);
  assert.deepEqual(h.calls.statuses, [[JOB(SELECTED)], [JOB(SELECTED)]]);
  assert.equal(h.status.dataset.state, 'warning'); assert.match(h.status.title, /1분 자료 일부 미수신 1일/);
});

test('ordinary hourly navigation still collects missing midnight and next-day support', async () => {
  const raw = savedData(SELECTED, { lookahead: support(TODAY, 'missing') });
  raw.coverage.baseline = support('2026-10-11', 'missing');
  const h = client({ range: () => raw }); await h.choose(SELECTED);
  assert.deepEqual(h.calls.posts.map(body => body.targetDate).sort(), ['2026-10-11', TODAY]);
  assert.deepEqual(h.calls.statuses[0].sort(), [JOB('2026-10-11'), JOB(TODAY)].sort());
  assert.equal(h.status.dataset.state, 'warning');
  assert.match(h.status.textContent, /첫날 자정 기준 자료 없음/);
  assert.match(h.status.textContent, /마지막 날 후속 자료 보완 필요/);
});

test('manual confirmed amounts stay separate from ready estimates, incomplete drops and readonly nested evidence', async () => {
  const raw = qualityData();
  raw.events.unshift({ ...hourlyEvents(SELECTED)[0], eventKey: 'confirmed-original', confirmedTon: 10.7,
    minuteObservations: savedData(SELECTED, { minute: true }).events[0].minuteObservations });
  const before = JSON.stringify(raw);
  const h = client({ range: () => raw }); await h.choose(SELECTED);
  assert.equal(h.api.state.summary.confirmedTon, 10.7); assert.equal(h.api.state.summary.confirmedCount, 1);
  assert.equal(h.api.state.summary.pendingEstimatedTon, 7); assert.equal(h.api.state.summary.incompleteCount, 2);
  assert.equal(card(h, 'bedAshDischargeTotalAmount').textContent, '32.03t');
  assert.equal(card(h, 'bedAshDischargeUnitOneAmount').textContent, '32.03t');
  assert.match(detail(h, 'bedAshDischargeUnitOneAmount'), /관측 4구간 · 계근 확정 1건 · 10.7t/);
  assert.equal(h.api.state.events.find(e => e.eventKey === 'confirmed-original').confirmedTon, 10.7);
  assert.equal(JSON.stringify(raw), before);
});
