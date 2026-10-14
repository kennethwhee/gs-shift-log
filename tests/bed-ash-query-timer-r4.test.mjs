import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../efficiency/bed-ash-discharge.js', import.meta.url), 'utf8');
const TODAY = '2026-10-13';
const SELECTED = '2026-10-12';
const JOB = date => `active-${date}`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
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
  const timers = new Map(), intervals = new Map(), windowListeners = new Map(), documentListeners = new Map(), observers = [];
  const ids = [
    'efficiencyBedAshDischargeView', 'efficiencyBedAshDischargeTab',
    'bedAshDischargeAnchorDate', 'refreshBedAshDischargeButton', 'bedAshDischargeRangeLabel',
    'bedAshDischargeStatus', 'bedAshDischargeEventTableBody', 'bedAshDischargeEventCount',
    'bedAshDischargeLoadingState', 'bedAshDischargeEmptyState', 'bedAshDischargeElapsedTime', 'efficiencyTeamModal',
    'bedAshDischargeQueryProgress', 'bedAshDischargeQueryProgressPhase', 'bedAshDischargeQueryProgressElapsed'
  ];
  const elements = new Map(ids.map(id => [id, new Element(id.includes('Button') ? 'button' : 'div', id)]));
  elements.get('efficiencyBedAshDischargeView').classList.add('is-active');
  elements.get('efficiencyTeamModal').setAttribute('aria-hidden', 'false');
  elements.get('bedAshDischargeElapsedTime').hidden = true;
  elements.get('bedAshDischargeQueryProgress').hidden = true;
  const calls = { ranges: [], posts: [], statuses: [] };
  const document = {
    readyState: 'loading', visibilityState: 'visible', activeElement: null,
    getElementById: id => elements.get(id) || null, querySelectorAll: () => [], querySelector: () => null,
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'),
    addEventListener: (type, fn) => documentListeners.set(type, [...(documentListeners.get(type) || []), fn])
  };
  const window = {
    location: { pathname: options.mobile ? '/mobile-app/' : '/' },
    getShiftLogSessionToken: () => token,
    addEventListener: (type, fn) => windowListeners.set(type, [...(windowListeners.get(type) || []), fn]),
    setInterval: (fn, ms) => { const id = ++timerId; intervals.set(id, { fn, ms }); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: (fn, ms = 0) => {
      const id = ++timerId; timers.set(id, { fn, ms, at: now + ms }); return id;
    }, clearTimeout: id => timers.delete(id)
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({
    console, Date: Clock, URL, URLSearchParams, Response, AbortController, Element, document, window,
    localStorage: { getItem: () => null }, MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
      observe(target) { this.targets.push(target); } disconnect() { this.targets = []; }
    },
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
        const payload = options.range ? await options.range(request, calls, init) : savedData(request.startDate);
        return Response.json({ ok: true, data: payload });
      }
      assert.equal(parsed.pathname, '/api/ois-data-requests');
      if (init.method === 'POST') {
        const body = JSON.parse(init.body); calls.posts.push(body);
        if (options.post) await options.post(body, calls, init);
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
    api, calls, date, refresh, status, table, flush, poll, intervals, timers,
    elapsed: elements.get('bedAshDischargeElapsedTime'),
    progress: elements.get('bedAshDischargeQueryProgress'),
    progressPhase: elements.get('bedAshDischargeQueryProgressPhase'),
    progressElapsed: elements.get('bedAshDischargeQueryProgressElapsed'),
    view: elements.get('efficiencyBedAshDischargeView'), modal: elements.get('efficiencyTeamModal'), document,
    elapsedIntervals: () => [...intervals.values()].filter(timer => timer.ms === 1000),
    advance: async ms => { now += ms; for (const timer of [...intervals.values()]) if (timer.ms === 1000) timer.fn(); await flush(); },
    runDue: async () => {
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await flush();
    },
    notify: async element => { for (const observer of observers) if (observer.targets.includes(element)) observer.callback(); await flush(); },
    documentEvent: async type => { for (const fn of documentListeners.get(type) || []) fn({ type }); await flush(); },
    windowEvent: async type => { for (const fn of windowListeners.get(type) || []) fn({ type }); await flush(); },
    choose: async value => { date.value = value; await date.fire('change'); await flush(); },
    switchAccount: async value => {
      token = value;
      for (const fn of windowListeners.get('storage') || []) fn({ key: 'gsShiftLog.currentUser' });
      await flush();
    }
  };
}

test('saved-data query ticks from wall time and freezes its measured duration after completion', async () => {
  const read = deferred();
  const h = client({ range: async request => { await read.promise; return savedData(request.startDate); } });
  assert.equal(h.elapsed.hidden, true);
  const query = h.api.loadSelectedRange(); await h.flush();
  assert.equal(h.progress.hidden, true, 'ordinary saved-data reads do not show the forced-query overlay');
  assert.equal(h.elapsed.hidden, false); assert.equal(h.elapsed.dataset.state, 'running');
  assert.equal(h.elapsed.textContent, '조회 경과 00:00 · 저장 자료');
  assert.equal(h.elapsedIntervals().length, 1);
  const staleTick = h.elapsedIntervals()[0].fn;
  await h.advance(5400);
  assert.equal(h.elapsed.textContent, '조회 경과 00:05 · 저장 자료', 'elapsed uses real wall time rather than number of ticks');
  read.resolve(); await query;
  assert.equal(h.elapsed.textContent, '조회 경과 00:05 · 저장 자료 · 완료');
  assert.equal(h.elapsedIntervals().length, 0); assert.equal(h.calls.posts.length, 0);
  await h.advance(20000); staleTick();
  assert.equal(h.elapsed.textContent, '조회 경과 00:05 · 저장 자료 · 완료');
  assert.doesNotMatch(h.elapsed.textContent, /%|예상|남은/);
});

test('one live clock spans saved GET, forced POST, status polling and final source read without resetting on repeated clicks', async () => {
  const saved = deferred(), post = deferred(), finalRead = deferred(); let complete = false;
  const h = client({
    range: async (request, calls) => {
      await (calls.ranges.length === 1 ? saved.promise : finalRead.promise);
      return savedData(request.startDate, { minute: complete });
    },
    post: () => post.promise,
    status: () => complete ? 'complete' : 'pending'
  });
  const query = h.refresh.fire('click'); await h.flush();
  assert.equal(h.progress.hidden, false); assert.equal(h.refresh.disabled, true);
  assert.equal(h.progressPhase.textContent, '저장 자료를 확인하고 있어요');
  assert.equal(h.progressElapsed.textContent, '경과 00:00');
  await h.advance(2100); saved.resolve(); await h.flush();
  assert.equal(h.elapsed.textContent, '조회 경과 00:02 · DataPARC 수집');
  assert.equal(h.api.state.loading, false, 'saved GET has finished while the forced query continues');
  assert.equal(h.progress.hidden, false); assert.equal(h.refresh.disabled, true);
  assert.equal(h.date.disabled, false, 'date navigation remains available during collection');
  assert.equal(h.progressPhase.textContent, '최신 자료를 불러오고 있어요');
  assert.equal(h.progressElapsed.textContent, '경과 00:02');
  await h.advance(3200); post.resolve(); await h.flush();
  assert.match(h.status.textContent, /선택일 0\/1건/);
  const startedAt = h.api.state.queryTiming.startedAt;
  await h.refresh.fire('click'); await h.flush();
  assert.equal(h.api.state.queryTiming.startedAt, startedAt); assert.equal(h.elapsedIntervals().length, 1);
  assert.equal(h.calls.posts.length, 1);
  complete = true; await h.advance(4800); await h.runDue();
  assert.equal(h.calls.ranges.length, 2);
  assert.equal(h.elapsed.textContent, '조회 경과 00:10 · DataPARC 수집');
  assert.equal(h.progress.hidden, false); assert.equal(h.refresh.disabled, true);
  assert.equal(h.progressElapsed.textContent, '경과 00:10');
  await h.advance(6300); finalRead.resolve(); await query;
  assert.equal(h.elapsed.textContent, '조회 경과 00:16 · DataPARC 수집 · 완료');
  assert.equal(h.api.state.queryTiming.endedAt - startedAt, 16400);
  assert.equal(h.elapsedIntervals().length, 0);
  assert.equal(h.progress.hidden, true); assert.equal(h.refresh.disabled, false);
});

test('a failed saved-data request freezes its actual failure duration and releases its interval', async () => {
  const read = deferred(); const h = client({ range: () => read.promise });
  const query = h.refresh.fire('click'); await h.flush();
  assert.equal(h.progress.hidden, false);
  await h.advance(7200); read.reject(new Error('source transport failed')); await query;
  assert.equal(h.elapsed.textContent, '조회 경과 00:07 · 저장 자료 · 실패');
  assert.equal(h.elapsed.dataset.state, 'failed'); assert.equal(h.elapsedIntervals().length, 0);
  assert.equal(h.status.dataset.state, 'error');
  assert.equal(h.progress.hidden, true); assert.equal(h.refresh.disabled, false);
  await h.advance(10000); assert.match(h.elapsed.textContent, /00:07/);
});

test('the actual request abort freezes wall-clock time as a timeout', async () => {
  const h = client({ range: (_request, _calls, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('request aborted', 'AbortError')), { once: true });
  }) });
  const query = h.refresh.fire('click'); await h.flush();
  assert.equal(h.progress.hidden, false);
  await h.advance(31000); await h.runDue(); await query;
  assert.equal(h.elapsed.textContent, '조회 경과 00:31 · 저장 자료 · 시간 초과');
  assert.equal(h.elapsed.dataset.state, 'timeout'); assert.equal(h.elapsedIntervals().length, 0);
  assert.match(h.status.textContent, /30초를 초과/);
  assert.equal(h.progress.hidden, true); assert.equal(h.refresh.disabled, false);
});

test('ten-minute collection timeout freezes the measured total including the initial saved read', async () => {
  const saved = deferred();
  const h = client({ range: async request => { await saved.promise; return savedData(request.startDate); }, status: () => 'pending' });
  const query = h.refresh.fire('click'); await h.flush();
  await h.advance(2400); saved.resolve(); await h.flush();
  assert.equal(h.progress.hidden, false); assert.equal(h.refresh.disabled, true);
  await h.advance(602100); await h.runDue(); await query;
  assert.equal(h.elapsed.textContent, '조회 경과 10:04 · DataPARC 수집 · 시간 초과');
  assert.equal(h.elapsed.dataset.state, 'timeout'); assert.equal(h.elapsedIntervals().length, 0);
  assert.equal(h.api.state.queryTiming.endedAt - h.api.state.queryTiming.startedAt, 604500);
  assert.match(h.status.textContent, /10분 이상 지연/);
  assert.equal(h.progress.hidden, true); assert.equal(h.refresh.disabled, false);
});

test('ordinary-to-force promotion resets the clock while old ticks and old finally cannot stop its replacement', async () => {
  const oldStatus = deferred(), forcedRead = deferred(); let reads = 0, complete = false;
  const h = client({
    range: async request => {
      reads++; if (reads === 2) await forcedRead.promise;
      return savedData(request.startDate, { minute: complete,
        lookahead: { date: TODAY, available: true, complete: false, status: reads === 1 ? 'missing' : 'pending', requestId: JOB(TODAY) } });
    },
    status: (ids, calls) => ids.includes(JOB(TODAY)) && calls.statuses.length === 2
      ? oldStatus.promise : complete ? 'complete' : 'pending'
  });
  await h.choose(SELECTED);
  await h.advance(7200); await h.runDue();
  assert.match(h.elapsed.textContent, /00:07 · DataPARC 수집/);
  const oldTick = h.elapsedIntervals()[0].fn;
  const oldStartedAt = h.api.state.queryTiming.startedAt;
  const query = h.refresh.fire('click'); await h.flush();
  const newStartedAt = h.api.state.queryTiming.startedAt;
  assert.equal(newStartedAt - oldStartedAt, 7200); assert.match(h.elapsed.textContent, /00:00 · 저장 자료/);
  await h.advance(3400); oldTick(); oldStatus.resolve('complete'); await h.flush();
  assert.equal(h.api.state.queryTiming.startedAt, newStartedAt); assert.equal(h.elapsedIntervals().length, 1);
  assert.match(h.elapsed.textContent, /00:03 · 저장 자료/); assert.equal(h.elapsed.dataset.state, 'running');
  forcedRead.resolve(); await h.flush();
  complete = true; await h.advance(5600); await h.runDue(); await query;
  assert.equal(h.elapsed.textContent, '조회 경과 00:09 · DataPARC 수집 · 완료');
  assert.equal(h.elapsedIntervals().length, 0); assert.equal(h.date.value, SELECTED);
});

test('date and account switches invalidate old clocks and delayed responses without clearing the new account timer', async () => {
  const oldDay = deferred(), oldAccount = deferred(), newAccount = deferred();
  const h = client({ range: async request => {
    await (request.authorization === 'Bearer session-b' ? newAccount.promise
      : request.startDate === TODAY ? oldDay.promise : oldAccount.promise);
    return savedData(request.startDate, { minute: true });
  } });
  const oldQuery = h.api.loadSelectedRange(); await h.flush(); await h.advance(4000);
  await h.choose(SELECTED); const selectedStartedAt = h.api.state.queryTiming.startedAt;
  await h.advance(2500); oldDay.resolve(); await oldQuery;
  assert.equal(h.api.state.queryTiming.startedAt, selectedStartedAt); assert.match(h.elapsed.textContent, /00:02 · 저장 자료/);
  await h.switchAccount('session-b');
  assert.equal(h.elapsed.hidden, true); assert.equal(h.elapsedIntervals().length, 0);
  assert.equal(h.progress.hidden, true); assert.equal(h.refresh.disabled, false);
  const newQuery = h.refresh.fire('click'); await h.flush();
  const accountStartedAt = h.api.state.queryTiming.startedAt;
  oldAccount.resolve(); await h.flush();
  assert.equal(h.api.state.queryTiming.startedAt, accountStartedAt); assert.equal(h.elapsedIntervals().length, 1);
  assert.equal(h.progress.hidden, false); assert.equal(h.refresh.disabled, true);
  await h.advance(5200); newAccount.resolve(); await newQuery;
  assert.equal(h.elapsed.textContent, '조회 경과 00:05 · DataPARC 수집 · 완료');
  assert.equal(h.date.value, SELECTED); assert.equal(h.calls.posts.length, 1);
  assert.equal(h.progress.hidden, true); assert.equal(h.refresh.disabled, false);
});

test('closing, navigation and page visibility release the interval and reopening catches up to wall time', async () => {
  const read = deferred(); const h = client({ range: async request => { await read.promise; return savedData(request.startDate); } });
  const query = h.refresh.fire('click'); await h.flush(); await h.advance(3000);
  assert.equal(h.progress.hidden, false); assert.equal(h.progressElapsed.textContent, '경과 00:03');
  h.view.hidden = true; await h.notify(h.view); assert.equal(h.elapsedIntervals().length, 0);
  assert.equal(h.progress.hidden, true); assert.equal(h.refresh.disabled, true);
  await h.advance(10000); assert.match(h.elapsed.textContent, /00:03/);
  h.view.hidden = false; await h.notify(h.view);
  assert.equal(h.elapsedIntervals().length, 1); assert.match(h.elapsed.textContent, /00:13/);
  assert.equal(h.progress.hidden, false); assert.equal(h.progressElapsed.textContent, '경과 00:13');
  h.document.visibilityState = 'hidden'; await h.documentEvent('visibilitychange');
  assert.equal(h.elapsedIntervals().length, 0);
  assert.equal(h.progress.hidden, true);
  await h.advance(2000); h.document.visibilityState = 'visible'; await h.documentEvent('visibilitychange');
  assert.equal(h.elapsedIntervals().length, 1); assert.match(h.elapsed.textContent, /00:15/);
  assert.equal(h.progress.hidden, false); assert.equal(h.progressElapsed.textContent, '경과 00:15');
  await h.windowEvent('pagehide'); assert.equal(h.elapsedIntervals().length, 0);
  await h.advance(1000); await h.windowEvent('pageshow');
  assert.equal(h.elapsedIntervals().length, 1); assert.match(h.elapsed.textContent, /00:16/);
  h.modal.setAttribute('aria-hidden', 'true'); await h.notify(h.modal);
  assert.equal(h.elapsedIntervals().length, 0);
  assert.equal(h.progress.hidden, true); assert.equal(h.refresh.disabled, true);
  await h.advance(5000); read.resolve(); await query;
  assert.equal(h.elapsed.textContent, '조회 경과 00:21 · DataPARC 수집 · 완료');
  assert.equal(h.progress.hidden, true); assert.equal(h.refresh.disabled, false);
  h.modal.setAttribute('aria-hidden', 'false'); await h.notify(h.modal);
  assert.equal(h.elapsedIntervals().length, 0); assert.equal(h.calls.ranges.length, 2);
  assert.equal(h.elapsed.textContent, '조회 경과 00:21 · DataPARC 수집 · 완료');
  assert.equal(h.progress.hidden, true); assert.equal(h.calls.posts.length, 1);
});
