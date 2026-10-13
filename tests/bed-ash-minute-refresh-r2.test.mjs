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
  matches(selector) { return selector.startsWith('.') && this.classList.contains(selector.slice(1)); }
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
    'bedAshDischargeLoadingState', 'bedAshDischargeEmptyState'
  ];
  const elements = new Map(ids.map(id => [id, new Element(id.includes('Button') ? 'button' : 'div', id)]));
  elements.get('efficiencyBedAshDischargeView').classList.add('is-active');
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
    api, calls, date, refresh, status, table, flush, poll,
    choose: async value => { date.value = value; await date.fire('change'); await flush(); },
    switchAccount: async value => {
      token = value;
      for (const fn of windowListeners.get('storage') || []) fn({ key: 'gsShiftLog.currentUser' });
      await flush();
    }
  };
}

test('bound minute refresh promotes an hourly load, leaves its adjacent job independent and survives old callbacks', async () => {
  const oldStatus = deferred(), forcedRange = deferred();
  let selectedReads = 0, complete = false;
  const h = client({
    range: async request => {
      if (request.startDate !== SELECTED) return savedData(request.startDate);
      selectedReads++;
      if (selectedReads === 2) await forcedRange.promise;
      return savedData(SELECTED, {
        minute: complete,
        lookahead: { date: TODAY, available: true, complete: false, status: selectedReads === 1 ? 'complete' : 'pending',
          requestId: selectedReads === 1 ? 'saved-lookahead' : JOB(TODAY) }
      });
    },
    status: async (_ids, calls) => calls.statuses.length === 2 ? oldStatus.promise : complete ? 'complete' : 'pending'
  });
  await h.api.loadSelectedRange();
  assert.equal(h.date.value, TODAY);
  await h.choose(SELECTED);
  assert.deepEqual(h.calls.posts, [{ requestType: 'bed_ash_level', targetDate: TODAY, forceRefresh: true }]);
  assert.equal(h.table.children.length, 5);
  assert.equal(h.status.textContent, '저장된 자료 표시 중 · OIS 수집 0/1건 완료 · 시간자료 보완 0/1건');
  const ordinarySequence = h.api.state.loadSequence;
  await h.poll(); // Hold the old status request while the forced browser load starts.
  const forced = h.refresh.fire('click'); await h.flush();
  assert.ok(h.api.state.loadSequence > ordinarySequence, 'force must supersede the ordinary next-day poll');
  const forceSequence = h.api.state.loadSequence;
  assert.equal(h.api.state.activeRangeLoad.forceRefresh, true);
  assert.equal(h.api.state.loading, true);
  oldStatus.resolve('complete'); await h.flush();
  assert.equal(h.api.state.activeRangeLoad.sequence, forceSequence, 'old finally must retain the new active load');
  assert.equal(h.api.state.loading, true, 'old finally must not clear the new loading state');
  assert.equal(h.table.children.length, 5);
  forcedRange.resolve(); await h.flush();
  assert.deepEqual(h.calls.posts.map(body => body.targetDate), [TODAY, SELECTED]);
  assert.equal(h.calls.posts[1].forceRefresh, true);
  assert.deepEqual(h.calls.statuses.at(-1), [JOB(SELECTED)]);
  assert.equal(h.status.textContent, '저장된 자료 표시 중 · OIS 수집 0/1건 완료 · 선택일 0/1건');
  const readsBeforeRepeat = h.calls.ranges.length;
  await h.refresh.fire('click'); await h.flush();
  assert.equal(h.calls.ranges.length, readsBeforeRepeat, 'a repeated forced click must reuse the forced browser load');
  assert.equal(h.calls.posts.length, 2, 'the already running lookahead job must not be recreated');
  complete = true; await h.poll(); await forced;
  assert.equal(h.api.state.activeRangeLoad, null);
  assert.equal(h.api.state.anchorDate, SELECTED); assert.equal(h.date.value, SELECTED);
  assert.equal(h.api.state.loadedRangeKey, `daily:${SELECTED}:${SELECTED}`);
  assert.equal(h.api.state.coverage.minuteDates[0], SELECTED);
  assert.equal(h.api.state.coverage.lookahead.pending, true);
  assert.equal(h.api.state.events[0].minuteObservations.length, 1);
  assert.match(h.table.textContent, /07:03 ~ 07:08/);
  assert.match(h.table.textContent, /DataPARC · 1분 감지 근거/);
  assert.equal(h.status.dataset.state, 'success');
  assert.match(h.status.textContent, /DataPARC 1분 자료 1일/);
});

test('a forced load remains deduplicated before its first saved-data response arrives', async () => {
  const firstRead = deferred();
  const h = client({ range: async request => { await firstRead.promise; return savedData(request.startDate, { minute: true }); } });
  const first = h.refresh.fire('click'); await h.flush();
  const sequence = h.api.state.loadSequence;
  await h.refresh.fire('click'); await h.flush();
  assert.equal(h.api.state.loadSequence, sequence); assert.equal(h.calls.ranges.length, 1);
  firstRead.resolve(); await first;
  assert.equal(h.calls.posts.length, 1);
  assert.equal(h.calls.posts[0].targetDate, TODAY);
});

test('mobile bound date navigation reads saved hourly data and the refresh button creates no company job', async () => {
  const h = client({ mobile: true });
  await h.choose(SELECTED);
  assert.equal(h.table.children.length, 5); assert.equal(h.date.value, SELECTED);
  const rangeCount = h.calls.ranges.length;
  await h.refresh.fire('click'); await h.flush();
  assert.equal(h.calls.posts.length, 0); assert.equal(h.calls.statuses.length, 0);
  assert.equal(h.calls.ranges.length, rangeCount);
  assert.equal(h.refresh.disabled, true);
});

test('rapid explicit date changes discard a delayed forced response without requesting or painting the prior day', async () => {
  const staleRead = deferred(); let blockSelected = false;
  const h = client({ range: async request => {
    if (blockSelected && request.startDate === SELECTED) await staleRead.promise;
    return savedData(request.startDate, { minute: true });
  } });
  await h.choose(SELECTED); blockSelected = true;
  const forced = h.refresh.fire('click'); await h.flush();
  await h.choose('2026-10-11');
  assert.equal(h.date.value, '2026-10-11');
  assert.equal(h.api.state.events[0].eventKey, 'saved-2026-10-11-0');
  staleRead.resolve(); await forced;
  assert.equal(h.calls.posts.length, 0);
  assert.equal(h.api.state.loadedRangeKey, 'daily:2026-10-11:2026-10-11');
  assert.equal(h.api.state.anchorDate, '2026-10-11'); assert.equal(h.date.value, '2026-10-11');
  assert.equal(h.api.state.events[0].eventKey, 'saved-2026-10-11-0');
});

test('account switching invalidates old refresh callbacks while keeping the selected date for the new account', async () => {
  const staleRead = deferred(); let blockAccountA = false;
  const h = client({ range: async request => {
    if (blockAccountA && request.authorization === 'Bearer session-a') await staleRead.promise;
    const payload = savedData(request.startDate, { minute: request.authorization === 'Bearer session-b' });
    payload.events[0].eventKey += request.authorization === 'Bearer session-b' ? '-account-b' : '-account-a';
    return payload;
  } });
  await h.choose(SELECTED); blockAccountA = true;
  const old = h.refresh.fire('click'); await h.flush();
  await h.switchAccount('session-b');
  assert.equal(h.api.state.activeRangeLoad, null); assert.equal(h.table.children.length, 0);
  assert.equal(h.api.state.anchorDate, SELECTED); assert.equal(h.date.value, SELECTED);
  await h.refresh.fire('click');
  assert.equal(h.calls.ranges.at(-1).authorization, 'Bearer session-b');
  assert.equal(h.calls.posts.length, 1); assert.equal(h.calls.posts[0].targetDate, SELECTED);
  const newEventKey = h.api.state.events[0].eventKey;
  assert.match(newEventKey, /account-b$/);
  staleRead.resolve(); await old;
  assert.equal(h.api.state.events[0].eventKey, newEventKey);
  assert.equal(h.api.state.coverage.minuteDates[0], SELECTED);
  assert.equal(h.status.dataset.state, 'success'); assert.equal(h.date.value, SELECTED);
});
