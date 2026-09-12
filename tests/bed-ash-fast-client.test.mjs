import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../efficiency/bed-ash-discharge.js', import.meta.url), 'utf8');
const DATE = '2026-09-10';
const range = date => ({ period: 'daily', anchorDate: date, queryStartDate: date, queryEndDate: date, today: '2026-09-12' });
const coverage = (overrides = {}) => ({ dates: [DATE], completeDates: [DATE], missingDates: [], pendingDates: [], failedDates: [], requests: [], baseline: null, lookahead: null, ...overrides });
const data = c => ({ events: [], coverage: c });
const row = (id, status = 'pending', targetDate = DATE) => ({ id, status, targetDate, requestType: 'bed_ash_level' });
const pendingCoverage = (id = 'job-new') => coverage({ pendingDates: [DATE], requests: [{ date: DATE, requestId: id, status: 'processing' }] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness(options = {}) {
  let token = 'session-a', mobile = Boolean(options.mobile), now = 0;
  const calls = { range: [], statuses: [], post: [], delays: [], statusesShown: [], renders: [], loading: [], summary: 0 };
  const scheduled = [];
  const context = vm.createContext({ console, URLSearchParams, AbortController,
    Date: class extends Date { static now() { return now; } },
    document: { readyState: 'loading', addEventListener() {} },
    localStorage: { getItem: () => null },
    window: { setTimeout: fn => { scheduled.push(fn); return scheduled.length; }, clearTimeout() {}, setInterval() {} }
  });
  const hook = `  window.__fastTest = {
    state, loadSelectedRange, pollRange, fetchCompactStatuses, addTrackedRequest,
    trackCoverageRequests, buildOisRequestPlans, scheduleReviewRangePolling,
    preserveReviewedEventInRangeData, normalizeEvent, normalizeCoverage,
    installDependencies(d) {
      getSessionToken = d.getToken; isMobileClient = d.isMobile;
      calculatePeriod = d.calculatePeriod; renderPeriodControls = d.renderPeriodControls;
      requestJson = d.requestJson; fetchRangeData = d.fetchRangeData;
      renderEvents = () => {}; renderData = d.renderData; setStatus = d.setStatus;
      setLoading = d.setLoading; clearSummaryAlert = () => {};
      clearDetailData = d.clearDetailData; refreshSummary = d.refreshSummary; delay = d.delay;
    }
  };
`;
  vm.runInContext(source.replace('  window.openBedAshDischargeView =', hook + '  window.openBedAshDischargeView ='), context);
  const api = context.window.__fastTest;
  api.state.anchorDate = DATE;
  api.installDependencies({
    getToken: () => token, isMobile: () => mobile,
    calculatePeriod: (_, date) => range(date),
    renderPeriodControls: () => range(api.state.anchorDate),
    requestJson: async (url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body); calls.post.push(body);
        return options.post ? options.post(body, calls.post.length) : { item: row(`new-${body.targetDate}`, 'pending', body.targetDate) };
      }
      const q = new URL(url, 'https://gs-shift-log.pages.dev').searchParams;
      assert.equal(q.get('action'), 'status_batch'); assert.equal(q.get('compact'), '1');
      const ids = q.get('ids').split(','); calls.statuses.push(ids);
      return options.status ? options.status(ids, calls.statuses.length) : { items: ids.map(id => row(id, 'complete')), missingIds: [] };
    },
    fetchRangeData: async r => {
      calls.range.push(r);
      return options.range ? options.range(r, calls.range.length) : data(coverage());
    },
    renderData: (value, dates) => {
      calls.renders.push(value);
      api.state.coverage = api.normalizeCoverage(value.coverage, dates);
      api.state.events = value.events || [];
    },
    setStatus: (message, tone) => calls.statusesShown.push({ message, tone }),
    setLoading: value => { api.state.loading = value; calls.loading.push(value); },
    clearDetailData: message => { api.state.coverage = null; api.state.events = []; calls.statusesShown.push({ message, tone: 'clear' }); },
    refreshSummary: () => { calls.summary++; return new Promise(() => {}); },
    delay: async ms => {
      calls.delays.push(ms); now += options.delayAdvance || ms;
      if (options.onDelay) await options.onDelay(api, calls);
    }
  });
  return { api, calls, scheduled, setToken: value => { token = value; }, setMobile: value => { mobile = value; } };
}

test('saved detail finishes without waiting for the independently slow summary', async () => {
  const h = harness();
  await h.api.loadSelectedRange();
  assert.equal(h.calls.range.length, 1); assert.equal(h.calls.summary, 0);
  assert.equal(h.api.state.loading, false); assert.equal(h.calls.statuses.length, 0);
});

test('exact pending ID is checked immediately; only terminal transition reloads detail', async () => {
  const h = harness({
    range: (_, n) => data(n === 1 ? pendingCoverage() : coverage()),
    status: (ids, n) => ({ items: ids.map(id => row(id, n < 3 ? 'processing' : 'complete')) })
  });
  await h.api.loadSelectedRange();
  assert.equal(h.calls.post.length, 0); assert.equal(h.calls.statuses.length, 3);
  assert.deepEqual(h.calls.delays, [2000, 2000]); assert.equal(h.calls.range.length, 2);
  assert.equal(h.calls.statusesShown.at(-1).tone, 'success');
});

test('reused complete POST ID has no forced delay and one authoritative final read', async () => {
  const h = harness({
    range: () => data(coverage()), post: body => ({ reused: true, item: row('reused-done', 'complete', body.targetDate) })
  });
  await h.api.loadSelectedRange({ forceRefresh: true });
  assert.deepEqual(h.calls.statuses, [['reused-done']]); assert.equal(h.calls.delays.length, 0);
  assert.equal(h.calls.range.length, 2);
});

test('old complete coverage never completes a newer pending request', async () => {
  const gate = deferred();
  const h = harness({ onDelay: () => gate.promise, status: (ids, n) => ({ items: ids.map(id => row(id, n === 1 ? 'pending' : 'complete')) }) });
  const running = h.api.loadSelectedRange({ forceRefresh: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.range.length, 1); assert.equal(h.api.state.loading, false);
  assert.equal(h.calls.statusesShown.at(-1).tone, 'loading');
  assert.match(h.calls.statusesShown.at(-1).message, /OIS 수집 0\/1/);
  gate.resolve(); await running;
  assert.equal(h.calls.range.length, 2);
});

test('missing status ID stays incomplete with bounded timeout and no repeated range GET', async () => {
  const h = harness({ range: () => data(pendingCoverage()), status: ids => ({ items: [], missingIds: ids }), delayAdvance: 600000 });
  await h.api.loadSelectedRange();
  assert.equal(h.calls.range.length, 1); assert.equal(h.calls.statusesShown.at(-1).tone, 'warning');
  assert.match(h.calls.statusesShown.at(-1).message, /10분/);
});

test('mismatched type/date or unknown status cannot complete or refresh detail', async () => {
  for (const bad of [{ requestType: 'daily_data_excel' }, { targetDate: '2026-09-09' }, { status: 'mystery' }]) {
    const h = harness({ range: () => data(pendingCoverage()), status: ids => ({ items: ids.map(id => ({ ...row(id, 'complete'), ...bad })) }), delayAdvance: 600000 });
    await h.api.loadSelectedRange();
    assert.equal(h.calls.range.length, 1); assert.equal(h.calls.statusesShown.at(-1).tone, 'warning');
  }
});

test('status batches contain at most twelve IDs and at most three run together', async () => {
  let active = 0, peak = 0;
  const h = harness({ status: async ids => { active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--; return { items: ids.map(id => row(id, 'processing')) }; } });
  const jobs = Array.from({ length: 50 }, (_, i) => row(`job-${i}`));
  const results = await h.api.fetchCompactStatuses(jobs, () => true, 1000);
  assert.equal(results.length, 5); assert.equal(peak, 3);
  assert.deepEqual(h.calls.statuses.map(ids => ids.length), [12, 12, 12, 12, 2]);
});

test('account change during status request discards result and no next range GET', async () => {
  let h;
  h = harness({ range: () => data(pendingCoverage()), status: ids => { h.setToken('session-b'); return { items: ids.map(id => row(id, 'complete')) }; } });
  await h.api.loadSelectedRange();
  assert.equal(h.calls.range.length, 1); assert.equal(h.calls.renders.length, 1);
  assert.equal(h.calls.delays.length, 0);
});

test('date change while creating requests stops queued POSTs and discards old response', async () => {
  let h;
  const dates = Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  h = harness({
    range: () => data(coverage({ dates, completeDates: [], missingDates: dates })),
    post: body => { h.api.state.anchorDate = '2026-09-11'; return { item: row('old-job', 'pending', body.targetDate) }; }
  });
  // Ten pending creation plans exercise the real bounded queue.
  await h.api.loadSelectedRange();
  assert.equal(h.calls.post.length, 1); assert.equal(h.calls.statuses.length, 0); assert.equal(h.calls.range.length, 1);
});

test('partial terminal success/failure refreshes once and keeps explicit failure warning', async () => {
  const c = pendingCoverage('one'); c.baseline = { date: '2026-09-09', available: true, pending: true, status: 'pending', requestId: 'two' };
  const h = harness({ range: (_, n) => data(n === 1 ? c : coverage()), status: ids => ({ items: ids.map(id => row(id, id === 'one' ? 'complete' : 'failed', id === 'one' ? DATE : '2026-09-09')) }) });
  await h.api.loadSelectedRange();
  assert.equal(h.calls.range.length, 2); assert.equal(h.calls.delays.length, 0);
  assert.match(h.calls.statusesShown.at(-1).message, /수집 일부 실패/); assert.equal(h.calls.statusesShown.at(-1).tone, 'warning');
});

test('same-range opening while collection is active does not create duplicate work', async () => {
  const gate = deferred();
  const h = harness({ status: async ids => { await gate.promise; return { items: ids.map(id => row(id, 'complete')) }; } });
  const first = h.api.loadSelectedRange({ forceRefresh: true });
  await new Promise(resolve => setImmediate(resolve));
  await h.api.loadSelectedRange({ forceRefresh: true });
  assert.equal(h.calls.post.length, 1); assert.equal(h.calls.range.length, 1);
  gate.resolve(); await first;
});

test('missing or failed ordinary plans are retried; completed past day has no new POST', () => {
  const h = harness();
  const plans = h.api.buildOisRequestPlans(coverage({ missingDates: ['2026-09-08'], failedDates: ['2026-09-09'] }), ['2026-09-08', '2026-09-09', DATE], false);
  assert.deepEqual(Array.from(plans, plan => plan.date), ['2026-09-08', '2026-09-09']);
});

test('mobile shows saved data and observes existing work without creating OIS jobs', async () => {
  const h = harness({ mobile: true }); await h.api.loadSelectedRange({ forceRefresh: true });
  assert.equal(h.calls.post.length, 0); assert.equal(h.calls.range.length, 1);
});

test('review polling retains confirmed event against stale pending detector response', async () => {
  const saved = { eventKey: 'event-1', status: 'confirmed', confirmedTon: 11.84 };
  const h = harness({ range: () => ({ coverage: coverage(), events: [{ ...saved, status: 'pending', confirmedTon: null }] }) });
  h.api.state.coverage = h.api.normalizeCoverage(pendingCoverage(), [DATE]);
  const result = await h.api.pollRange(range(DATE), 0, [DATE], new Map(), saved);
  assert.equal(result, 'complete'); assert.equal(h.api.state.events[0].status, 'confirmed');
  assert.equal(h.api.state.events[0].confirmedTon, 11.84);
});

test('baseline and available lookahead IDs are tracked, unavailable future support is ignored', () => {
  const h = harness(); const tracked = new Map();
  h.api.trackCoverageRequests(tracked, coverage({ baseline: { date: '2026-09-09', available: true, pending: true, requestId: 'before' }, lookahead: { date: '2026-09-11', available: false, pending: true, requestId: 'after' } }));
  assert.deepEqual([...tracked.keys()], ['before']);
  assert.throws(() => h.api.trackCoverageRequests(new Map(), coverage({ pendingDates: [DATE], requests: [] })), /요청번호/);
});

test('malformed POST cannot be mistaken for completion even over old completed coverage', async () => {
  const h = harness({ post: () => ({ item: { targetDate: DATE, requestType: 'bed_ash_level', status: 'complete' } }) });
  await h.api.loadSelectedRange({ forceRefresh: true });
  assert.equal(h.calls.statuses.length, 0); assert.equal(h.calls.statusesShown.at(-1).tone, 'warning');
  assert.match(h.calls.statusesShown.at(-1).message, /요청 1건 실패/);
});


test('force refresh preserves an already active OIS job without another POST', async () => {
  const h = harness({ range: (_, n) => data(n === 1 ? pendingCoverage() : coverage()) });
  await h.api.loadSelectedRange({ forceRefresh: true });
  assert.equal(h.calls.post.length, 0); assert.deepEqual(h.calls.statuses, [['job-new']]);
});

test('terminal status with still-pending authoritative range stays a warning', async () => {
  const h = harness({ range: () => data(pendingCoverage()) });
  await h.api.loadSelectedRange();
  assert.equal(h.calls.range.length, 2); assert.equal(h.calls.statusesShown.at(-1).tone, 'warning');
  assert.match(h.calls.statusesShown.at(-1).message, /기간 자료 반영/);
  assert.equal(h.api.state.loadedAt, 0);
});

test('401 status failure clears detail instead of displaying previous authenticated values', async () => {
  const h = harness({ range: () => data(pendingCoverage()), status: () => { throw Object.assign(new Error('expired'), { status: 401 }); } });
  await h.api.loadSelectedRange();
  assert.equal(h.api.state.coverage, null); assert.equal(h.calls.statusesShown.at(-1).tone, 'error');
  assert.equal(h.calls.delays.length, 0);
});

test('new pending support job in authoritative refresh is tracked before completion', async () => {
  const c = coverage({ lookahead: { date: '2026-09-11', available: true, pending: true, requestId: 'next-day' } });
  const h = harness({
    range: (_, n) => data(n === 1 ? pendingCoverage() : n === 2 ? c : coverage()),
    status: ids => ({ items: ids.map(id => row(id, 'complete', id === 'next-day' ? '2026-09-11' : DATE)) })
  });
  await h.api.loadSelectedRange();
  assert.deepEqual(h.calls.statuses, [['job-new'], ['next-day']]);
  assert.equal(h.calls.range.length, 3); assert.equal(h.calls.statusesShown.at(-1).tone, 'success');
});


test('authentication failure stops queued creation after already in-flight requests', async () => {
  const dates = Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  const h = harness({
    range: () => data(coverage({ dates, completeDates: [], missingDates: dates })),
    post: () => { throw Object.assign(new Error('unauthorized'), { status: 403 }); }
  });
  await h.api.loadSelectedRange();
  assert.ok(h.calls.post.length <= 3); assert.equal(h.calls.statuses.length, 0);
  assert.equal(h.api.state.coverage, null);
});


test('review polling keeps partial authoritative coverage in warning tone after exact job completes', async () => {
  const h = harness({ range: () => data(coverage({ baseline: { date: '2026-09-09', available: true, complete: false, status: 'missing' } })) });
  h.api.state.coverage = h.api.normalizeCoverage(pendingCoverage(), [DATE]);
  h.api.scheduleReviewRangePolling({ range: range(DATE), sequence: 0, requestedDates: [DATE], savedEvent: null, selectedRangeKey: `daily:${DATE}:${DATE}` });
  assert.equal(h.scheduled.length, 1);
  h.scheduled.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.range.length, 1);
  assert.equal(h.calls.statusesShown.at(-1).tone, 'warning');
  assert.match(h.calls.statusesShown.at(-1).message, /첫날 자정 기준 자료 없음/);
});
