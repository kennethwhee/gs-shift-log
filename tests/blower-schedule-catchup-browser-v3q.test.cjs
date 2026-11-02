'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scheduler = require('../maintenance/blower-schedule-v1.js');
const core = require('../maintenance/blower-unified-refresh.js');

// Install the production browser adapter with the real controller and planner.
// Only browser primitives and HTTP responses are controlled by this fixture.
const adapterSource = fs.readFileSync(path.join(__dirname, '../maintenance/blower-schedule-browser-v1.js'), 'utf8');
const AUTH = 'gsShiftLog.currentUser';
const DEVICE = 'a'.repeat(64);
const TIMING = { intervalHours: 24, startTime: '00:00', timeZone: 'Asia/Seoul' };
const TAGS = ['104ETG30AN601', '104ETH03AN602'];
const iso = value => new Date(value).toISOString();

class Target {
  constructor() { this.listeners = new Map(); this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; }
  addEventListener(name, callback) {
    const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list);
  }
  async emit(name, event = {}) { await Promise.all((this.listeners.get(name) || []).map(callback => callback(event))); }
}

function fixture(options = {}) {
  const start = Date.parse(options.start || '2026-11-01T15:05:00.000Z');
  const f = { mono: 0, calls: [], records: new Map(), requests: new Map(), applied: new Set(),
    controllers: [], enabled: true, designated: true, authorized: true, queueBusy: false,
    held: new Set(), dueOverride: undefined, ...options };
  f.now = () => start + f.mono;
  const root = new Target(), document = new Target(), nodes = new Map(), timeouts = new Map(), intervals = new Map();
  let timerId = 0, requestId = 0;
  f.saved = new Map([[AUTH, JSON.stringify({ employeeNo: 'bco1-user', sessionToken: 'session-one', role: 'BCO1' })],
    [scheduler.DEVICE_KEY, DEVICE]]);
  if (options.loggedOut) f.saved.delete(AUTH);
  f.nodes = nodes; f.root = root; f.document = document; f.intervals = intervals;
  document.readyState = 'complete'; document.documentElement = { dataset: { shiftLogPage: 'blower-history' } };
  document.getElementById = id => { if (!nodes.has(id)) nodes.set(id, new Target()); return nodes.get(id); };
  root.document = document; root.location = { origin: 'https://schedule.example.invalid' };
  root.localStorage = { getItem: key => f.saved.get(key) ?? null,
    setItem: (key, value) => f.saved.set(key, String(value)), removeItem: key => f.saved.delete(key) };
  const media = new Target(); media.matches = false; root.matchMedia = () => media;
  root.performance = { now: () => f.mono }; root.AbortController = AbortController;
  root.Event = class { constructor(type) { this.type = type; } };
  root.dispatchEvent = event => root.emit(event.type, event);
  root.MutationObserver = class { constructor(callback) { this.callback = callback; } observe() {} };
  root.crypto = { getRandomValues(array) { for (let i = 0; i < array.length; i++) array[i] = (i + requestId + timerId + 1) % 256; return array; } };
  root.confirm = () => false;
  root.setTimeout = (callback, ms) => { const id = ++timerId; timeouts.set(id, { callback, at: f.mono + ms }); return id; };
  root.clearTimeout = id => timeouts.delete(id);
  root.setInterval = (callback, ms) => { const id = ++timerId; intervals.set(id, { callback, ms }); return id; };
  root.clearInterval = id => intervals.delete(id);
  root.navigator = { locks: { async request(name, lockOptions, callback) {
    assert.equal(name, scheduler.LOCK_NAME); assert.equal(lockOptions.ifAvailable, true);
    if (f.held.has(name)) return callback(null);
    f.held.add(name); try { return await callback({ name }); } finally { f.held.delete(name); }
  } } };
  root.BlowerUnifiedRefresh = core;
  root.BlowerScheduleV1 = { ...scheduler, createController(settings) {
    const controller = scheduler.createController(settings); f.controllers.push(controller); return controller;
  } };
  const assets = TAGS.map(tag => ({ tagNumber: tag, displayName: tag, blowerType: 'flyash_bag', enabled: true,
    lastReplacementAt: '2026-10-01T00:00:00.000Z', cycleStartState: 'legacy', cycleStartedAt: '',
    cycleStartRevision: 'cycle-one', cycleRuntimeRevision: 'runtime-one',
    dataParcTag: `GSPOGE.ABB_DCS.${tag}XB04`, dataParcRuntimeBasis: null,
    hasUnverifiedDataParcHistory: false }));
  function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
  const fail = (code, status) => response({ ok: false, code, message: code }, status);
  const envelope = body => ({ ok: true, version: scheduler.VERSION, serverNow: iso(f.now()), ...body });
  function status() {
    const slot = scheduler.slotAt(f.now(), TIMING), current = f.records.get(iso(slot));
    const latest = [...f.records.values()].sort((a, b) => b.slotKey.localeCompare(a.slotKey))[0];
    const configuredAt = Date.parse('2026-11-01T14:00:00.000Z');
    const due = f.enabled && f.designated && configuredAt <= slot && !current ? iso(slot) : null;
    return envelope({ enabled: f.enabled, thisDevice: f.designated, revision: 1, timing: TIMING,
      nextSlotAt: iso(slot + 24 * 3600000), dueSlotAt: f.dueOverride === undefined ? due : f.dueOverride,
      latestSlot: latest ? { slotKey: latest.slotKey, claimedAt: latest.claimedAt, state: latest.state,
        targetCount: latest.targetCount, completedCount: latest.completedCount, failedCount: latest.failedCount } : null });
  }
  root.fetch = async (url, config) => {
    const parsed = new URL(url); const body = config.body ? JSON.parse(config.body) : {};
    f.calls.push({ url: parsed, method: config.method, body, at: iso(f.now()) });
    assert.equal(parsed.origin, root.location.origin);
    assert.match(config.headers.Authorization, /^Bearer /);
    if (!f.authorized) return fail('AUTHENTICATION_REQUIRED', 401);
    if (body.action === 'scheduled_refresh') {
      if (body.operation === 'status') return response(status());
      if (body.operation === 'claim') {
        if (f.queueBusy) return fail('blower_busy', 409);
        if (f.records.has(body.slotKey)) return response(envelope({ acquired: false, slotKey: body.slotKey }));
        if (body.slotKey !== iso(scheduler.slotAt(f.now(), TIMING))) return fail('outside_slot_window', 409);
        const record = { slotKey: body.slotKey, claimedAt: iso(f.now()), state: 'running',
          runToken: body.runToken, batchReceipt: null };
        f.records.set(record.slotKey, record);
        return response(envelope({ acquired: true, slotKey: record.slotKey, claimedAt: record.claimedAt }));
      }
      const record = f.records.get(body.slotKey);
      if (!record) return fail('run_not_found', 404);
      if (record.runToken !== body.runToken) return fail('run_not_owned', 403);
      if (body.operation === 'check') return response(envelope({ allowed: true, purpose: body.purpose,
        slotKey: record.slotKey, claimedAt: record.claimedAt, state: record.state, batchReceipt: record.batchReceipt }));
      if (body.operation === 'finish') {
        Object.assign(record, { state: body.status, targetCount: body.targetCount,
          completedCount: body.completedCount, failedCount: body.failedCount });
        return response(envelope({ slotKey: record.slotKey, claimedAt: record.claimedAt,
          state: record.state, targetCount: record.targetCount, completedCount: record.completedCount, failedCount: record.failedCount }));
      }
      return fail('unexpected_schedule_operation', 400);
    }
    if (body.action === 'latest_logs_step') return response({ ok: true, version: 'bounded-logs-v1',
      phase: body.phase, done: true, nextCursor: null, scannedLogCount: 0,
      window: body.window || { fromDate: '2026-11-01', endDate: '2026-11-02', snapshotAt: iso(f.now()) } });
    if (parsed.pathname === '/api/blower-history' && parsed.searchParams.get('action') === 'refresh_state_page') {
      const cursor = parsed.searchParams.get('cursor') || '', limit = Number(parsed.searchParams.get('limit'));
      assert.ok(limit >= 1 && limit <= 2);
      const page = assets.filter(asset => asset.tagNumber > cursor).slice(0, limit);
      const done = !assets.some(asset => asset.tagNumber > (page.at(-1)?.tagNumber || cursor));
      return response({ ok: true, version: 'blower-refresh-state-page-v1', user: { employeeNo: 'bco1-user' },
        permissions: { canWrite: true }, generatedAt: iso(f.now()), assets: page,
        done, nextCursor: done ? null : page.at(-1).tagNumber });
    }
    if (body.action === 'create_blower_runtime_probe_batch') {
      const record = f.records.get(body.scheduledRefresh.slotKey);
      assert.ok(record); assert.equal(record.batchReceipt, null, 'an accepted slot never creates a second batch');
      const results = body.requests.map(request => {
        const id = `accepted-${++requestId}`, probe = { assetTag: request.assetTag, requestId: id };
        const item = { id, requestType: 'blower_runtime_probe', status: 'complete', probe };
        f.requests.set(id, item); return { ok: true, assetTag: request.assetTag, item };
      });
      record.batchReceipt = { version: 1, requestedCount: results.length,
        items: results.map(item => ({ id: item.item.id, assetTag: item.assetTag })), upToDateTags: [] };
      return response({ ok: true, atomic: true, batchVersion: 1, requestedCount: results.length, results });
    }
    if (parsed.pathname === '/api/ois-data-requests' && parsed.searchParams.get('action') === 'status_batch') {
      const ids = parsed.searchParams.get('ids').split(',');
      return response({ ok: true, items: ids.map(id => f.requests.get(id)) });
    }
    if (parsed.pathname === '/api/ois-data-requests' && parsed.searchParams.has('id')) {
      return response({ ok: true, item: f.requests.get(parsed.searchParams.get('id')) });
    }
    if (body.action === 'dataparc_runtime_sync') {
      assert.ok(f.requests.has(body.requestId)); const prior = f.applied.has(body.requestId); f.applied.add(body.requestId);
      return response({ ok: true, requestId: body.requestId,
        assetTag: f.requests.get(body.requestId).probe.assetTag, applied: !prior, replayed: prior });
    }
    throw new Error(`Unexpected HTTP request: ${config.method} ${parsed.pathname}${parsed.search} ${body.action || ''}`);
  };
  class BrowserDate extends Date { constructor(...args) { super(...(args.length ? args : [f.now()])); } static now() { return f.now(); } }
  vm.runInNewContext(adapterSource, { globalThis: root, Date: BrowserDate, URL, Intl, Uint8Array, console },
    { filename: 'blower-schedule-browser-v1.js' });
  f.flush = async () => {
    for (let i = 0; i < 1500; i++) {
      await Promise.resolve();
      // The real log walker yields for 20ms between bounded pages. Advance
      // those short browser tasks without firing API aborts or retry timers.
      const next = [...timeouts.entries()].filter(([, item]) => item.at <= f.mono + 100)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (next) { timeouts.delete(next[0]); f.mono = Math.max(f.mono, next[1].at); next[1].callback(); }
    }
  };
  f.tick = async (ms = 15000) => {
    f.mono += ms;
    for (const { callback } of [...intervals.values()]) callback();
    await f.flush();
  };
  f.actions = action => f.calls.filter(call => call.body.action === action);
  f.operations = operation => f.calls.filter(call => call.body.operation === operation);
  f.snapshot = () => f.controllers.at(-1).snapshot();
  f.close = async () => { await root.emit('pagehide'); await f.flush(); };
  return f;
}

for (const [label, start] of [['00:05', '2026-11-01T15:05:00.000Z'], ['09:00', '2026-11-02T00:00:00.000Z']])
test(`installed browser started at ${label} executes the server-approved current missing slot once through bounded planning`, async t => {
  const f = fixture({ start }); t.after(() => f.close()); await f.flush();
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.operations('claim')[0].body.slotKey, '2026-11-01T15:00:00.000Z');
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1, JSON.stringify({ snapshot: f.snapshot(),
    calls: f.calls.map(call => `${call.method} ${call.url.pathname}${call.url.search} ${call.body.action || ''}/${call.body.operation || ''}`) }));
  assert.equal(f.applied.size, 2);
  assert.equal([...f.records.values()][0].state, 'complete');
  assert.match(f.nodes.get('blowerScheduleLast').textContent, /완료.*반영 2건.*실행/);
  assert.ok(f.calls.some(call => call.url.searchParams.get('action') === 'refresh_state_page'));
  assert.ok(!f.calls.some(call => call.method === 'GET' && call.url.pathname === '/api/blower-history' && !call.url.search));
  await f.tick(); await f.tick();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
});

test('the actual installed timer recovers a missed boundary after a background freeze without replaying multiple days', async t => {
  const f = fixture({ start: '2026-11-01T14:59:30.000Z' }); t.after(() => f.close()); await f.flush();
  assert.equal(f.operations('claim').length, 0);
  await f.tick(7 * 60000);
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.operations('claim')[0].body.slotKey, '2026-11-01T15:00:00.000Z');
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
});

test('a temporary manual-query lock is retried after release rather than losing the midnight slot', async t => {
  const f = fixture(); t.after(() => f.close()); f.held.add(scheduler.LOCK_NAME); await f.flush();
  assert.equal(f.operations('claim').length, 0);
  f.held.delete(scheduler.LOCK_NAME); await f.tick(30000);
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
});

test('a temporary server queue-busy refusal is retried through the same eligible current slot', async t => {
  const f = fixture({ queueBusy: true }); t.after(() => f.close()); await f.flush();
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.match(f.nodes.get('blowerScheduleNext').textContent, /미처리 예약 재시도/);
  assert.doesNotMatch(f.nodes.get('blowerScheduleProgress').textContent, /자동조회가 완료/);
  f.queueBusy = false; await f.tick(30000);
  assert.equal(f.operations('claim').length, 2);
  assert.equal(new Set(f.operations('claim').map(call => call.body.slotKey)).size, 1);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
});

test('a server-null due slot never starts a catch-up query merely because it is shortly after midnight', async t => {
  const f = fixture({ dueOverride: null }); t.after(() => f.close()); await f.flush(); await f.tick();
  assert.equal(f.operations('claim').length, 0);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
});

test('a foreign prior-day due slot is rejected rather than replayed by a fresh browser', async t => {
  const f = fixture({ dueOverride: '2026-10-31T15:00:00.000Z' }); t.after(() => f.close()); await f.flush();
  assert.equal(f.operations('claim').length, 0);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
});

test('logged-out or server-revoked authentication cannot enqueue a scheduled batch', async t => {
  const loggedOut = fixture({ loggedOut: true }), revoked = fixture({ authorized: false });
  t.after(async () => { await loggedOut.close(); await revoked.close(); });
  await loggedOut.flush(); await revoked.flush();
  assert.equal(loggedOut.calls.length, 0);
  assert.equal(revoked.operations('claim').length, 0);
  assert.equal(revoked.actions('create_blower_runtime_probe_batch').length, 0);
  assert.ok(revoked.nodes.get('blowerScheduleProgress').textContent);
});

test('captured logout blocks a newly eligible due slot before persisted credentials are cleared', async t => {
  const f = fixture({ dueOverride: null }); t.after(() => f.close()); await f.flush();
  const before = f.calls.length; f.dueOverride = undefined;
  await f.document.emit('click', { target: { closest: selector => selector === '#logoutButton' ? {} : null } });
  await f.flush(); await f.tick(60000);
  assert.equal(f.calls.length, before);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.equal(f.snapshot().phase, 'signed_out');
  assert.ok(f.saved.get(AUTH), 'logout capture must block the old bearer even before local storage is cleared');
});

test('pagehide stops the installed timer and persisted pageshow rechecks the current missing slot once', async t => {
  const f = fixture({ dueOverride: null }); t.after(() => f.close()); await f.flush();
  await f.close();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.snapshot().phase, 'stopped');
  const before = f.calls.length; f.dueOverride = undefined;
  await f.tick(60000); assert.equal(f.calls.length, before);
  await f.root.emit('pageshow', { persisted: true }); await f.flush();
  assert.equal(f.controllers.length, 2, 'restored page uses a fresh controller with a fresh server status');
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  await f.tick(30000);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
});
