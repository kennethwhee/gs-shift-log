'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scheduler = require('../maintenance/blower-schedule-v1.js');
const core = require('../maintenance/blower-unified-refresh.js');
const DEVICE = 'a'.repeat(64), DAY = 86400000;
const TIMING = { intervalHours: 24, startTime: '00:00', timeZone: 'Asia/Seoul' };
const iso = value => new Date(value).toISOString();
const fault = (code, status = 503) => Object.assign(new Error(code), { code, status });
const asset = (tag = '104ETG30AN601', patch = {}) => ({
  tagNumber: tag, displayName: tag, enabled: true, blowerType: 'flyash_bag',
  lastReplacementAt: '2026-09-22T00:00:00+09:00', cycleStartState: 'legacy', cycleStartedAt: '',
  cycleStartRevision: 's1', cycleRuntimeRevision: 'r1', dataParcTag: `GSPOGE.ABB_DCS.${tag}XB04`,
  hasUnverifiedDataParcHistory: false, dataParcRuntimeBasis: null, ...patch
});

function fixture(options = {}) {
  const f = { base: Date.parse(options.start || '2026-11-02T15:05:00Z'), mono: 0,
    identity: { token: 'current-session', employeeNo: 'operator' }, enabled: true, designated: true,
    configuredAt: Date.parse('2026-11-01T14:00:00Z'), revision: 1, held: false, queueBusy: false,
    statusFailures: 0, calls: [], records: new Map(), requests: new Map(), applied: new Set(),
    assets: [asset()], counter: 0, ...options };
  f.now = () => f.base + f.mono;
  f.advance = ms => { f.mono += ms; };
  const saved = new Map([[scheduler.DEVICE_KEY, DEVICE]]);
  f.storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const envelope = values => ({ ok: true, version: scheduler.VERSION, serverNow: iso(f.now()), ...values });
  f.status = () => {
    const slot = scheduler.slotAt(f.now(), TIMING), row = f.records.get(iso(slot));
    const due = f.enabled && f.designated && slot >= f.configuredAt && !row ? iso(slot) : null;
    return envelope({ enabled: f.enabled, thisDevice: f.designated, revision: f.revision, timing: TIMING,
      nextSlotAt: iso(slot + DAY), dueSlotAt: f.dueOverride === undefined ? due : f.dueOverride });
  };
  f.api = async config => {
    f.calls.push({ ...config, at: f.mono });
    const body = config.body || {}, url = new URL(config.url, 'https://example.test');
    if (f.beforeApi) await f.beforeApi(config);
    if (body.action === 'scheduled_refresh') {
      if (body.operation === 'status') {
        if (f.statusFailures > 0) { f.statusFailures--; throw fault('temporarily_unavailable'); }
        return f.status();
      }
      if (['register', 'configure', 'disable'].includes(body.operation)) {
        assert.equal(body.expectedRevision, f.revision);
        f.configuredAt = f.now(); f.revision++;
        if (body.operation !== 'configure') f.enabled = body.operation === 'register';
        return f.status();
      }
      if (body.operation === 'claim') {
        if (f.queueBusy) throw fault('blower_busy', 409);
        assert.equal(body.expectedRevision, f.revision);
        assert.equal(body.slotKey, iso(scheduler.slotAt(f.now(), TIMING)));
        if (f.records.has(body.slotKey)) return envelope({ acquired: false, slotKey: body.slotKey });
        const record = { slotKey: body.slotKey, runToken: body.runToken, employeeNo: f.identity.employeeNo,
          claimedAt: iso(f.now()), state: 'running', batchReceipt: null };
        f.records.set(body.slotKey, record);
        return envelope({ acquired: true, slotKey: record.slotKey, claimedAt: record.claimedAt });
      }
      const row = f.records.get(body.slotKey);
      if (!row) throw fault('run_not_found', 404);
      if (row.runToken !== body.runToken || row.employeeNo !== f.identity.employeeNo) throw fault('run_not_owned', 403);
      if (body.operation === 'check') return envelope({ allowed: true, purpose: body.purpose, ...row });
      if (body.operation === 'finish') {
        Object.assign(row, { state: body.status, targetCount: body.targetCount,
          completedCount: body.completedCount, failedCount: body.failedCount });
        return envelope({ ...row });
      }
    }
    if (body.action === 'latest_logs_step') return { ok: true, version: 'bounded-logs-v1', phase: body.phase,
      done: true, scannedLogCount: 0, window: body.window || {
        fromDate: '2026-11-01', endDate: '2026-11-03', snapshotAt: iso(f.now()) } };
    if (url.searchParams.get('action') === 'refresh_state_page') {
      const cursor = url.searchParams.get('cursor') || '';
      assert.equal(url.searchParams.get('limit'), '2');
      const remaining = f.assets.filter(a => a.tagNumber > cursor).sort((a, b) => a.tagNumber.localeCompare(b.tagNumber));
      const assets = remaining.slice(0, 2), done = remaining.length <= 2;
      return { ok: true, version: 'blower-refresh-state-page-v1', user: { employeeNo: f.identity.employeeNo },
        permissions: { canWrite: true }, assets, generatedAt: iso(f.now()), done,
        nextCursor: done ? null : assets.at(-1).tagNumber, ...(f.pageOverride || {}) };
    }
    if (body.action === 'create_blower_runtime_probe_batch') {
      const row = f.records.get(body.scheduledRefresh.slotKey);
      assert.equal(row.batchReceipt, null, 'one accepted slot creates one batch');
      const results = body.requests.map(request => {
        const id = `accepted-${++f.counter}`, item = { id, status: 'complete', requestType: 'blower_runtime_probe',
          probe: { assetTag: request.assetTag, requestId: id } };
        f.requests.set(id, item); return { ok: true, assetTag: request.assetTag, item };
      });
      row.batchReceipt = { version: 1, requestedCount: results.length,
        items: results.map(r => ({ id: r.item.id, assetTag: r.assetTag })), upToDateTags: [] };
      if (f.loseCreateResponse) { f.loseCreateResponse = false; throw fault('response_lost', 0); }
      return { ok: true, atomic: true, batchVersion: 1, requestedCount: results.length, results };
    }
    if (url.searchParams.get('action') === 'status_batch') return { ok: true,
      items: url.searchParams.get('ids').split(',').map(id => f.requests.get(id)) };
    if (url.pathname === '/api/ois-data-requests' && url.searchParams.has('id'))
      return { ok: true, item: f.requests.get(url.searchParams.get('id')) };
    if (body.action === 'dataparc_runtime_sync') {
      assert.ok(f.requests.has(body.requestId)); f.applied.add(body.requestId); return { ok: true };
    }
    throw new Error('Unexpected or broad API read: ' + config.url);
  };
  f.controller = scheduler.createController({ core, storage: f.storage, api: f.api,
    identity: () => f.identity, clock: f.now, monotonicNow: () => f.mono,
    sleep: async ms => f.advance(ms), randomKey: () => (++f.counter).toString(16).padStart(64, '0'),
    locks: { async request(name, opts, callback) {
      assert.equal(name, scheduler.LOCK_NAME); assert.equal(opts.ifAvailable, true);
      return callback(f.held ? null : { name });
    } } });
  f.tick = () => f.controller.tick();
  f.operations = name => f.calls.filter(c => c.body?.operation === name);
  f.actions = name => f.calls.filter(c => c.body?.action === name);
  return f;
}

test('a late page load executes only the server-approved current missing slot once', async () => {
  const f = fixture(); await f.tick();
  assert.equal(f.operations('claim').length, 1); assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  assert.equal(f.applied.size, 1);
  for (let i = 0; i < 20; i++) { f.advance(15000); await f.tick(); }
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.records.size, 1);
});

test('waking after several missed days authorizes only the latest current canonical slot', async () => {
  const f = fixture({ start: '2026-11-02T14:59:30Z', configuredAt: Date.parse('2026-11-02T14:00:00Z') });
  await f.tick(); assert.equal(f.operations('claim').length, 0);
  f.advance(3 * DAY + 45000); await f.tick();
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.operations('claim')[0].body.slotKey, iso(scheduler.slotAt(f.now(), TIMING)));
  assert.equal(f.records.size, 1);
});

for (const reason of ['manual lock', 'server queue']) test(`${reason} contention retains eligibility and retries with fresh status after 30 seconds`, async () => {
  const f = fixture({ held: reason === 'manual lock', queueBusy: reason === 'server queue' });
  await f.tick(); assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  const statusReads = f.operations('status').length;
  f.held = false; f.queueBusy = false;
  f.advance(15000); await f.tick(); assert.equal(f.operations('status').length, statusReads);
  f.advance(15000); await f.tick();
  assert.equal(f.operations('status').length > statusReads, true);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
});

test('unavailable status uses bounded backoff rather than a full database read every timer tick', async () => {
  const f = fixture({ statusFailures: 4 });
  await f.tick(); assert.equal(f.operations('status').length, 1);
  for (let i = 0; i < 29; i++) { f.advance(1000); await f.tick(); }
  assert.equal(f.operations('status').length, 1);
  for (const target of [30000, 90000, 210000, 450000]) { f.mono = target; await f.tick(); }
  assert.deepEqual(f.operations('status').slice(0, 5).map(c => c.at), [0, 30000, 90000, 210000, 450000]);
  assert.equal(f.operations('status').length, 6, 'successful completion refreshes its stored outcome once');
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
});

test('null, future, foreign and malformed due contracts cannot start an unauthorized query', async () => {
  for (const dueOverride of [null, '2026-11-01T15:00:00.000Z', '2026-11-03T15:00:00.000Z',
    '2026-11-02T15:01:00.000Z', '2026-11-02T15:00:00+00:00']) {
    const f = fixture({ dueOverride }); await f.tick();
    assert.equal(f.operations('claim').length, 0, String(dueOverride));
    assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  }
});

test('configuration made after a slot starts preserves next-slot-only activation', async () => {
  const f = fixture({ configuredAt: Date.parse('2026-11-02T15:01:00Z') });
  await f.tick(); assert.equal(f.operations('claim').length, 0);
  await f.controller.configure({ intervalHours: 24, startTime: '00:00' });
  await f.tick(); assert.equal(f.operations('claim').length, 0);
  f.advance(DAY); await f.tick(); assert.equal(f.operations('claim').length, 1);
});

test('an accepted batch whose response was lost is recovered by receipt without a second create', async () => {
  const f = fixture({ loseCreateResponse: true }); await f.tick();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  assert.equal(f.applied.size, 1);
  f.advance(60000); await f.tick();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  assert.equal([...f.records.values()][0].state, 'complete');
});

test('bounded planning preserves ordinary unverified history while automatically rebuilding the exact Limestone three', async () => {
  const auto = ['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'].map(tag => asset(tag, {
    blowerType: 'limestone', cycleStartState: 'pending', limestoneAutoApply: true,
    limestoneRunDisputed: false, limestoneBasisConfirmed: false, hasUnverifiedDataParcHistory: true }));
  const held = asset('104ETG30AN601', { hasUnverifiedDataParcHistory: true });
  const f = fixture({ assets: [...auto, held] }); await f.tick();
  const requests = f.actions('create_blower_runtime_probe_batch')[0].body.requests;
  assert.deepEqual(requests.map(r => r.assetTag).sort(), auto.map(a => a.tagNumber).sort());
  assert.ok(requests.every(r => r.incrementalRefresh === false && r.requireIncrementalAppend === false));
  assert.equal(f.calls.some(c => c.url.includes('limestone_run_tracking')), false);
  assert.ok(f.calls.filter(c => c.url.includes('refresh_state_page')).length >= 4);
  assert.equal([...f.records.values()][0].state, 'partial');
});

test('malformed or read-only planning pages abort before an Agent request is created', async () => {
  for (const pageOverride of [{ permissions: { canWrite: false } }, { assets: [asset(), asset()] },
    { assets: [asset('203HRJ01AN601'), asset('103HRJ01AN602')] }, { version: 'foreign' }]) {
    const f = fixture({ pageOverride }); await f.tick();
    assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  }
});

test('a logout during bounded planning cannot produce a subsequent request', async () => {
  const f = fixture();
  f.beforeApi = config => { if (config.url.includes('refresh_state_page')) f.identity = null; };
  await f.tick(); assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.ok(f.storage.getItem(scheduler.RECEIPT_KEY + '.operator'), 'accepted ownership receipt is retained');
});
