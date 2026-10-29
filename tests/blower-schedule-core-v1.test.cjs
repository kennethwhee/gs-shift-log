'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scheduler = require('../maintenance/blower-schedule-v1.js');
const core = require('../maintenance/blower-unified-refresh.js');

const DEVICE = 'a'.repeat(64), TOKEN = 'current-auth-token-do-not-store';
const FOUR_HOUR_TIMING = { intervalHours: 4, startTime: '00:00', timeZone: 'Asia/Seoul' };
const RECEIPT = employee => `${scheduler.RECEIPT_KEY}.${encodeURIComponent(employee)}`;
const date = value => new Date(value).toISOString();
function error(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
function memory() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function lockManager() {
  const held = new Set();
  return { held, async request(name, options, callback) {
    assert.equal(name, scheduler.LOCK_NAME); assert.equal(options.mode, 'exclusive'); assert.equal(options.ifAvailable, true);
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  } };
}
function fixture(options = {}) {
  const f = { base: Date.parse(options.start || '2026-09-16T02:59:30.000Z'), mono: 0, wallOffset: 0,
    identity: { token: TOKEN, employeeNo: 'BCO-1-user' }, calls: [], records: new Map(), requests: new Map(),
    enabled: true, revision: 1, configured: true, failCreate: '', failClaim: '', busy: false, requestCount: 0,
    states: [], storage: memory(), locks: lockManager(), counter: 0, timing: { ...FOUR_HOUR_TIMING }, ...options };
  f.storage.setItem(scheduler.DEVICE_KEY, DEVICE);
  f.now = () => f.base + f.mono;
  f.advance = ms => { f.mono += ms; };
  f.assets = options.assets || ['104ETH03AN602'];
  const response = values => ({ ok: true, version: scheduler.VERSION, serverNow: date(f.now()), ...values });
  const status = () => response({ enabled: f.enabled, revision: f.revision, thisDevice: f.configured,
    timing: { ...f.timing }, nextSlotAt: date(scheduler.slotAt(f.now(), f.timing) + f.timing.intervalHours * 3600000) });
  f.api = async (config, token) => {
    f.calls.push({ config, token, at: f.now() });
    if (f.beforeApi) await f.beforeApi(config, token);
    const body = config.body || {};
    let result;
    if (body.action === 'scheduled_refresh') {
      assert.equal(config.url, '/api/blower-history');
      assert.equal(body.scheduleVersion, 2);
      if (body.operation === 'status') result = status();
      else if (['register', 'configure', 'disable'].includes(body.operation)) {
        assert.equal(body.expectedRevision, f.revision);
        if (body.operation === 'register') { assert.equal(body.confirmedPhysicalBco1, true); assert.match(body.deviceKey, /^[a-f0-9]{64}$/); }
        if (body.operation !== 'configure') { f.enabled = body.operation === 'register'; f.configured = body.operation === 'register' || f.configured; }
        if (body.timing) f.timing = { ...body.timing, timeZone: 'Asia/Seoul' };
        f.revision += 1; result = status();
      } else if (body.operation === 'claim') {
        assert.ok(f.storage.getItem(RECEIPT(f.identity.employeeNo)), 'durable intent must precede claim');
        if (body.expectedRevision !== f.revision) throw error('configuration_changed', 409);
        if (f.busy) throw error('blower_busy', 409);
        if (f.records.has(body.slotKey)) result = response({ acquired: false });
        else {
          assert.equal(scheduler.slotAt(f.now(), f.timing), Date.parse(body.slotKey));
          if (f.failClaim === 'absent') throw error('network_lost', 0);
          const record = { slotKey: body.slotKey, runToken: body.runToken, employeeNo: f.identity.employeeNo,
            claimedAt: date(f.now()), state: 'running', batchReceipt: null };
          f.records.set(body.slotKey, record);
          if (f.failClaim === 'committed') throw error('network_lost', 0);
          result = response({ acquired: true, slotKey: body.slotKey, claimedAt: record.claimedAt });
        }
      } else {
        const record = f.records.get(body.slotKey);
        if (!record) throw error('run_not_found', 404);
        if (record.runToken !== body.runToken || record.employeeNo !== f.identity.employeeNo) throw error('run_not_owned', 403);
        if (body.operation === 'check') {
          if (body.purpose === 'create' && record.batchReceipt) throw error('already_created', 409);
          result = response({ allowed: true, purpose: body.purpose, slotKey: record.slotKey, claimedAt: record.claimedAt,
            state: record.state, batchReceipt: record.batchReceipt });
        } else if (body.operation === 'finish') {
          if (f.finishFailure) throw error('finish_failed', 503);
          assert.ok(['complete', 'partial', 'failed', 'interrupted'].includes(body.status));
          assert.ok(Number.isInteger(body.targetCount));
          Object.assign(record, { state: body.status, targetCount: body.targetCount, completedCount: body.completedCount, failedCount: body.failedCount });
          result = response({ state: record.state, slotKey: record.slotKey, claimedAt: record.claimedAt });
        } else throw error(`unknown operation ${body.operation}`);
      }
    } else if (body.action === 'latest_logs_step') {
      result = { ok: true, version: 'bounded-logs-v1', phase: body.phase, done: true, scannedLogCount: 0,
        window: { fromDate: '2026-09-15', endDate: '2026-09-16', snapshotAt: '2026-09-16T02:50:00.000Z' } };
    } else if (body.action === 'create_blower_runtime_probe_batch') {
      assert.equal(config.url, '/api/ois-data-requests');
      assert.match(body.scheduledRefresh.runToken, /^[a-f0-9]{64}$/);
      assert.equal(body.scheduledRefresh.deviceKey, DEVICE);
      const record = f.records.get(body.scheduledRefresh.slotKey);
      assert.ok(record); assert.equal(record.batchReceipt, null, 'create must be issued only once');
      if (f.failCreate === 'uncommitted') throw error('network_lost', 0);
      const results = body.requests.map(request => {
        const id = `request-${++f.requestCount}`, tag = request.assetTag;
        const item = { id, requestType: 'blower_runtime_probe', status: 'pending', probe: { requestId: id, assetTag: tag } };
        f.requests.set(id, { ...item, status: 'complete' });
        return { ok: true, assetTag: tag, item };
      });
      record.batchReceipt = { version: 1, requestedCount: results.length,
        items: results.map(entry => ({ id: entry.item.id, assetTag: entry.assetTag })), upToDateTags: [] };
      if (f.failCreate === 'committed') throw error('network_lost', 0);
      result = { ok: true, atomic: true, batchVersion: 1, requestedCount: results.length, results };
      if (f.malformedCreate) result.results[0].assetTag = 'FOREIGN';
    } else if ((config.url || '').startsWith('/api/ois-data-requests?action=status_batch')) {
      const ids = new URL(config.url, 'https://test.invalid').searchParams.get('ids').split(',');
      result = { ok: true, items: ids.map(id => ({ ...f.requests.get(id), ...(f.wrongStatusType ? { requestType: 'usage' } : {}) })) };
    } else if ((config.url || '').startsWith('/api/ois-data-requests?id=')) {
      const id = new URL(config.url, 'https://test.invalid').searchParams.get('id');
      const item = { ...f.requests.get(id) };
      if (f.wrongDetailTag) item.probe = { ...item.probe, assetTag: 'FOREIGN' };
      result = { ok: true, item };
    } else if (body.action === 'dataparc_runtime_sync') {
      assert.ok(f.requests.has(body.requestId));
      if (f.conflictId === body.requestId) throw error('CYCLE_CONFLICT', 409);
      result = { ok: true };
    } else if (config.url === '/api/blower-history' && !config.method) {
      result = { ok: true, generatedAt: date(f.now()), assets: f.assets.map(tag => ({
        tagNumber: tag, displayName: tag, enabled: true, lastReplacementAt: '2026-09-15T00:00:00.000Z',
        dataParcTag: `GSPOGE.ABB_DCS.${tag}XB04`, cycleStartState: 'legacy'
      })) };
    } else throw error(`unexpected API ${JSON.stringify(config)}`);
    if (f.afterApi) await f.afterApi(config, result);
    return result;
  };
  f.controller = extra => scheduler.createController({ core, api: f.api, storage: f.storage, locks: f.locks,
    clock: () => f.now() + f.wallOffset, monotonicNow: () => f.mono,
    sleep: async ms => { f.advance(ms); }, identity: () => f.identity,
    randomKey: () => (++f.counter).toString(16).padStart(64, '0'), onState: state => f.states.push(state), ...extra });
  f.c = f.controller();
  f.start = async () => { await f.c.tick(); };
  f.cross = async () => { f.advance(scheduler.slotAt(f.now(), f.timing) + f.timing.intervalHours * 3600000 - f.now()); return f.c.tick(); };
  f.actions = action => f.calls.filter(call => call.config.body?.action === action);
  f.operations = operation => f.calls.filter(call => call.config.body?.operation === operation);
  return f;
}

test('explicit four-hour KST slots retain the exact six canonical instants across midnight', () => {
  const utc = ['2026-09-15T15:00:00.000Z', '2026-09-15T19:00:00.000Z', '2026-09-15T23:00:00.000Z',
    '2026-09-16T03:00:00.000Z', '2026-09-16T07:00:00.000Z', '2026-09-16T11:00:00.000Z'];
  for (const slot of utc) assert.equal(date(scheduler.slotAt(Date.parse(slot) + 500, FOUR_HOUR_TIMING)), slot);
});

test('unregistered and logged-out initialization never generates credentials or issues queries', async () => {
  const f = fixture(); f.identity = null; f.storage.removeItem(scheduler.DEVICE_KEY);
  await f.c.tick(); await f.c.refreshStatus();
  assert.equal(f.calls.length, 0); assert.equal(f.counter, 0); assert.equal(f.storage.data.size, 0);
  f.identity = { token: TOKEN, employeeNo: 'BCO-1-user' }; f.enabled = false; f.configured = false;
  await f.c.tick(); await f.cross();
  assert.equal(f.operations('claim').length, 0); assert.equal(f.counter, 0);
});

test('register requires explicit BCO1 confirmation and starts at the next slot', async () => {
  const f = fixture({ start: '2026-09-16T03:00:05.000Z', enabled: false, configured: false });
  f.storage.removeItem(scheduler.DEVICE_KEY);
  await assert.rejects(f.c.register(), { code: 'SCHEDULE_PC_CONFIRMATION_REQUIRED' });
  assert.equal(f.calls.length, 0);
  await f.c.register({ confirmedPhysicalBco1: true });
  assert.match(f.storage.getItem(scheduler.DEVICE_KEY), /^[a-f0-9]{64}$/);
  await f.c.tick(); assert.equal(f.operations('claim').length, 0);
  assert.equal(f.operations('register').length, 1);
});

test('registration invalidates an older boundary tick awaiting status and starts only at a later slot', async () => {
  const f = fixture({ start: '2026-09-16T02:55:00.000Z', enabled: false, configured: false });
  await f.start();
  for (let step = 0; step < 9; step++) { f.advance(30000); await f.c.tick(); }
  let release;
  const responseGate = new Promise(resolve => { release = resolve; });
  let entered;
  const awaitingStatus = new Promise(resolve => { entered = resolve; });
  let holdOne = true;
  f.beforeApi = async config => {
    if (config.body?.operation === 'status' && holdOne) {
      holdOne = false; entered(); await responseGate;
    }
  };
  f.advance(30000);
  const oldTick = f.c.tick();
  await awaitingStatus;
  const registration = f.c.register({ confirmedPhysicalBco1: true });
  assert.equal(f.c.snapshot().busy, true);
  await registration;
  assert.equal(f.c.snapshot().busy, false);
  release(); await oldTick;
  assert.equal(f.operations('claim').length, 0);
  assert.equal(f.c.snapshot().phase, 'ready');
  await f.c.tick(); assert.equal(f.operations('claim').length, 0);
});

test('initial login exactly on a due time never performs immediate catch-up', async () => {
  const f = fixture({ start: '2026-09-16T03:00:00.000Z' });
  await f.start(); f.advance(30000); await f.c.tick();
  assert.equal(f.operations('status').length, 1);
  assert.equal(f.operations('claim').length, 0);
});

test('one continuous boundary uses the real normal latest workflow, one batch, and current auth', async () => {
  const f = fixture(); await f.start(); await f.cross();
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  assert.deepEqual(f.actions('latest_logs_step').map(call => call.config.body.phase), ['replacement', 'operation']);
  assert.equal(f.actions('dataparc_runtime_sync').length, 1);
  assert.equal([...f.records.values()][0].state, 'complete');
  assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), null);
  assert.ok(f.calls.every(call => call.token === TOKEN));
  assert.ok(![...f.storage.data.values()].join('').includes(TOKEN));
  await f.c.tick(); assert.equal(f.operations('claim').length, 1);
});

test('explicit four-hour timing crosses each of six daily slots once with five-minute status refresh', async () => {
  const f = fixture({ start: '2026-09-15T14:59:30.000Z' }); await f.start();
  const end = Date.parse('2026-09-16T11:00:30.000Z');
  while (f.now() < end) { f.advance(Math.min(30000, end - f.now())); await f.c.tick(); }
  const slots = f.operations('claim').map(call => call.config.body.slotKey);
  assert.equal(slots.length, 6); assert.equal(new Set(slots).size, 6);
  assert.deepEqual(slots.map(slot => new Date(Date.parse(slot) + 9 * 3600000).getUTCHours()), [0, 4, 8, 12, 16, 20]);
  assert.ok(f.operations('status').length < 270, 'status is not polled every timer tick');
});

test('a frozen tab or wall-clock jump resets the baseline without missed-slot replay', async () => {
  for (const mode of ['freeze', 'clock']) {
    const f = fixture(); await f.start();
    if (mode === 'freeze') f.advance(120000); else { f.advance(30000); f.wallOffset += 3600000; }
    await f.c.tick(); f.advance(10000); await f.c.tick();
    assert.equal(f.operations('claim').length, 0, mode);
  }
});

test('identity changes at a boundary establish a fresh baseline', async () => {
  const f = fixture(); await f.start();
  f.identity = { token: 'new-session', employeeNo: 'another-user' }; await f.cross();
  assert.equal(f.operations('claim').length, 0);
  assert.ok(f.calls.at(-1).token === 'new-session');
});

test('two tabs share the same manual-refresh WebLock and create only one batch', async () => {
  const f = fixture(), other = f.controller();
  await Promise.all([f.c.tick(), other.tick()]); f.advance(30000);
  await Promise.all([f.c.tick(), other.tick()]);
  assert.equal(f.operations('claim').length, 1); assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  assert.ok(f.states.some(state => state.phase === 'waiting'));
});

test('manual lock and missing WebLocks both prevent automatic claim', async () => {
  const f = fixture(); await f.start(); f.locks.held.add(scheduler.LOCK_NAME); await f.cross();
  assert.equal(f.operations('claim').length, 0);
  const g = fixture(); g.c = g.controller({ locks: null }); await g.start(); await g.cross();
  assert.equal(g.operations('claim').length, 0); assert.equal(g.c.snapshot().error, 'SCHEDULE_LOCK_UNAVAILABLE');
});

test('a server busy refusal creates no request and consumes no local recovery record', async () => {
  const f = fixture({ busy: true }); await f.start(); await f.cross();
  assert.equal(f.operations('claim').length, 1); assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), null);
});

test('logout after a log-page response blocks every following API', async () => {
  const f = fixture(); await f.start();
  f.afterApi = config => { if (config.body?.action === 'latest_logs_step') f.identity = null; };
  await f.cross();
  assert.equal(f.actions('latest_logs_step').length, 1);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.equal(f.operations('finish').length, 0);
  assert.equal(f.c.snapshot().error, 'WRITE_ACCESS_CHANGED');
});

test('logout after create preserves only a receipt and same-employee new session resumes without requery', async () => {
  const f = fixture(); await f.start();
  f.afterApi = config => { if (config.body?.action === 'create_blower_runtime_probe_batch') f.identity = null; };
  await f.cross();
  assert.equal(f.actions('dataparc_runtime_sync').length, 0);
  const saved = scheduler.readReceipt(f.storage.getItem(RECEIPT('BCO-1-user')));
  assert.ok(saved); assert.deepEqual(Object.keys(saved).sort(), ['claimedAt', 'employeeNo', 'runToken', 'slotKey', 'version']);
  assert.ok(!JSON.stringify(saved).includes(TOKEN)); assert.ok(!JSON.stringify(saved).includes('request-1'));
  f.afterApi = null; f.identity = { token: 'new-auth-session', employeeNo: 'BCO-1-user' };
  f.c = f.controller(); await f.c.tick();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  assert.equal(f.actions('latest_logs_step').length, 2);
  assert.equal(f.actions('dataparc_runtime_sync').length, 1);
  assert.equal(f.actions('dataparc_runtime_sync')[0].token, 'new-auth-session');
  assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), null);
});

test('a different employee never resumes another employee receipt and can run their next slot', async () => {
  const f = fixture(); await f.start();
  f.afterApi = config => { if (config.body?.action === 'create_blower_runtime_probe_batch') f.identity = null; };
  await f.cross();
  const saved = f.storage.getItem(RECEIPT('BCO-1-user'));
  f.afterApi = null; f.identity = { token: 'second-user-token', employeeNo: 'second-user' };
  f.c = f.controller(); await f.c.tick();
  assert.equal(f.operations('check').filter(call => call.config.body.purpose === 'resume').length, 0);
  assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), saved);
  const end = Date.parse('2026-09-16T07:00:00.000Z');
  while (f.now() < end) { f.advance(Math.min(60000, end - f.now())); await f.c.tick(); }
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 2);
  assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), saved);
});

test('a lost create response resumes the server receipt, never repeats create, and verifies exact details', async () => {
  const f = fixture({ failCreate: 'committed' }); await f.start(); await f.cross();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  assert.equal(f.calls.filter(call => call.config.url === '/api/ois-data-requests?id=request-1').length, 1);
  assert.equal(f.actions('dataparc_runtime_sync').length, 1);
  assert.equal([...f.records.values()][0].state, 'complete');
});

test('an uncommitted create gets bounded receipt checks then interrupted without a second query', async () => {
  const f = fixture({ failCreate: 'uncommitted' }); await f.start(); await f.cross();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  const checks = f.operations('check').filter(call => call.config.body.purpose === 'resume');
  assert.ok(checks.length >= 2 && checks.length <= 16); assert.equal(checks.at(-1).at - checks[0].at, 30000);
  assert.equal([...f.records.values()][0].state, 'interrupted');
  assert.equal(f.actions('dataparc_runtime_sync').length, 0);
});

test('a lost claim response with confirmed absent server slot clears only after 30-second reconciliation', async () => {
  const f = fixture({ failClaim: 'absent' }); await f.start(); await f.cross();
  assert.equal(f.operations('claim').length, 1); assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), null);
  assert.ok(f.mono >= 60000); assert.equal(f.c.snapshot().phase, 'interrupted');
});

test('server-owned nonce mismatch retains receipt and does not apply or finish', async () => {
  const f = fixture({ failClaim: 'committed' });
  f.afterApi = config => { if (config.body?.operation === 'status' && f.records.size) [...f.records.values()][0].runToken = 'f'.repeat(64); };
  const slotKey = '2026-09-16T03:00:00.000Z', item = { version: 1, slotKey, runToken: '1'.repeat(64), employeeNo: 'BCO-1-user', claimedAt: slotKey };
  f.storage.setItem(RECEIPT(item.employeeNo), JSON.stringify(item));
  f.records.set(slotKey, { ...item, state: 'running', batchReceipt: null });
  await f.c.tick();
  assert.ok(f.storage.getItem(RECEIPT(item.employeeNo))); assert.equal(f.operations('finish').length, 0);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
});

test('server-confirmed expired recovery releases that owner record without replaying the old slot', async () => {
  const f = fixture();
  const item = { version: 1, slotKey: '2026-09-14T03:00:00.000Z', runToken: '1'.repeat(64),
    employeeNo: 'BCO-1-user', claimedAt: '2026-09-14T03:00:00.000Z' };
  f.storage.setItem(RECEIPT(item.employeeNo), JSON.stringify(item));
  f.storage.setItem(`${scheduler.RECEIPT_KEY}.owners`, JSON.stringify([item.employeeNo]));
  f.beforeApi = config => { if (config.body?.operation === 'check') throw error('run_expired', 409); };
  await f.c.tick();
  assert.equal(f.storage.getItem(RECEIPT(item.employeeNo)), null);
  assert.equal(f.operations('claim').length, 0); assert.equal(f.operations('finish').length, 0);
  f.beforeApi = null; await f.cross();
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.operations('claim')[0].config.body.slotKey, '2026-09-16T03:00:00.000Z');
});

test('malformed server time cannot establish a scheduler baseline', async () => {
  const f = fixture();
  f.afterApi = (config, data) => { if (config.body?.operation === 'status') data.serverNow = 'invalid-clock'; };
  await f.start(); await f.cross();
  assert.equal(f.operations('claim').length, 0);
  assert.equal(f.c.snapshot().error, 'SCHEDULE_STATUS_INVALID');
});

test('malformed create response is reconciled using authoritative receipt without create replay', async () => {
  const f = fixture({ malformedCreate: true }); await f.start(); await f.cross();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  assert.equal(f.actions('dataparc_runtime_sync').length, 1);
  assert.equal([...f.records.values()][0].state, 'complete');
});

test('wrong request type and recovered asset mismatch prevent applying results', async () => {
  for (const flags of [{ wrongStatusType: true }, { failCreate: 'committed', wrongDetailTag: true }]) {
    const f = fixture(flags); await f.start(); await f.cross();
    assert.equal(f.actions('dataparc_runtime_sync').length, 0);
    assert.equal(f.operations('finish').length, 0);
    assert.ok(f.storage.getItem(RECEIPT('BCO-1-user')));
    assert.equal(f.c.snapshot().error, 'SCHEDULE_REQUEST_MISMATCH');
  }
});

test('a Cycle conflict is partial and preserves successful sibling results', async () => {
  const f = fixture({ assets: ['104ETH03AN602', '104ETH03AN601'], conflictId: 'request-1' });
  await f.start(); await f.cross();
  const record = [...f.records.values()][0];
  assert.equal(record.state, 'partial'); assert.equal(record.targetCount, 2); assert.equal(record.completedCount, 1); assert.equal(record.failedCount, 1);
});

test('failed completion delivery retains receipt until a confirmed terminal server record', async () => {
  const f = fixture({ finishFailure: true }); await f.start(); await f.cross();
  assert.ok(f.storage.getItem(RECEIPT('BCO-1-user')));
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  f.finishFailure = false; [...f.records.values()][0].state = 'complete'; f.c = f.controller();
  const applied = f.actions('dataparc_runtime_sync').length; await f.c.tick();
  assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), null);
  assert.equal(f.actions('dataparc_runtime_sync').length, applied);
});

test('ten-minute automatic deadline prevents creation after delayed preparation', async () => {
  const f = fixture(); await f.start();
  f.afterApi = config => { if (config.body?.action === 'latest_logs_step') f.advance(10 * 60000 + 1); };
  await f.cross();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.equal(f.operations('finish').length, 0); assert.equal(f.c.snapshot().error, 'SCHEDULE_RUN_EXPIRED');
});

test('stop during an awaited response prevents follow-up calls', async () => {
  const f = fixture(); await f.start();
  f.afterApi = config => { if (config.body?.action === 'latest_logs_step') f.c.stop(); };
  await f.cross(); const count = f.calls.length; await f.c.tick();
  assert.equal(f.calls.length, count); assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
});

test('receipt validation rejects duplicate IDs, duplicate tags, foreign fields, and non-minute times', () => {
  assert.throws(() => scheduler.validateBatchReceipt({ version: 1, requestedCount: 2, items: [
    { id: 'a', assetTag: '104ETH03AN602' }, { id: 'a', assetTag: '104ETH03AN601' }
  ], upToDateTags: [] }), { code: 'SCHEDULE_RECEIPT_INVALID' });
  assert.throws(() => scheduler.validateBatchReceipt({ version: 1, requestedCount: 2,
    items: [{ id: 'a', assetTag: '104ETH03AN602' }], upToDateTags: ['104ETH03AN602'] }), { code: 'SCHEDULE_RECEIPT_INVALID' });
  const item = { version: 1, slotKey: '2026-09-16T03:00:00.000Z', runToken: '1'.repeat(64), employeeNo: 'a', claimedAt: '2026-09-16T03:00:00.000Z' };
  assert.ok(scheduler.readReceipt(JSON.stringify(item)));
  assert.equal(scheduler.readReceipt(JSON.stringify({ ...item, token: 'not-allowed' })), null);
  assert.ok(scheduler.readReceipt(JSON.stringify({ ...item, slotKey: '2026-09-16T03:01:00.000Z' })), 'custom-minute and old-cadence receipts remain recoverable');
  assert.equal(scheduler.readReceipt(JSON.stringify({ ...item, slotKey: '2026-09-16T03:01:01.000Z' })), null);
});

test('actual server route accepts missing-device status and registration/configure/disable CAS', async t => {
  const { DatabaseSync } = require('node:sqlite');
  const { handleBlowerSchedule } = await import('../functions/_shared/blower-schedule-v1.js');
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = { prepare(sql) {
    let values = [];
    const statement = { bind(...args) { values = args; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; } };
    return statement;
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
  } };
  const f = fixture({ enabled: false, configured: false });
  f.storage.removeItem(scheduler.DEVICE_KEY);
  const calls = [];
  f.c = f.controller({ api: async (config, token) => {
    assert.equal(token, TOKEN); calls.push(config);
    const response = await handleBlowerSchedule({ env: { DB: db },
      request: new Request('https://test.invalid/api/blower-history') }, { employeeNo: f.identity.employeeNo }, config.body);
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw Object.assign(new Error(data.message), { code: data.code, status: response.status });
    return data;
  } });
  await f.c.tick();
  assert.equal(f.c.snapshot().phase, 'disabled');
  assert.equal(Object.hasOwn(calls[0].body, 'deviceKey'), false);
  assert.equal(f.counter, 0);
  await f.c.register({ confirmedPhysicalBco1: true });
  assert.equal(f.c.snapshot().status.enabled, true); assert.equal(f.c.snapshot().status.thisDevice, true);
  assert.equal(f.c.snapshot().status.revision, 1);
  assert.deepEqual(f.c.snapshot().status.timing, { ...scheduler.DEFAULT_TIMING });
  await f.c.configure({ intervalHours: 24, startTime: '07:35' });
  assert.equal(f.c.snapshot().status.enabled, true); assert.equal(f.c.snapshot().status.revision, 2);
  assert.equal(f.c.snapshot().status.timing.startTime, '07:35');
  await f.c.disable(); assert.equal(f.c.snapshot().status.enabled, false); assert.equal(f.c.snapshot().status.revision, 3);
  await f.c.configure({ intervalHours: 6, startTime: '01:25' });
  assert.equal(f.c.snapshot().status.enabled, false); assert.equal(f.c.snapshot().status.revision, 4);
  assert.deepEqual(f.c.snapshot().status.timing, { intervalHours: 6, startTime: '01:25', timeZone: 'Asia/Seoul' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 0);
  assert.equal(calls.some(call => call.body.operation === 'claim'), false);
});


test('default cadence is exactly one midnight KST slot per day and skips the retired four-hour boundaries', async () => {
  assert.deepEqual(scheduler.DEFAULT_TIMING, { intervalHours: 24, startTime: '00:00', timeZone: 'Asia/Seoul' });
  assert.equal(date(scheduler.slotAt(Date.parse('2026-10-29T14:59:59.999Z'))), '2026-10-28T15:00:00.000Z');
  assert.equal(date(scheduler.slotAt(Date.parse('2026-10-29T15:00:00.000Z'))), '2026-10-29T15:00:00.000Z');
  const f = fixture({ start: '2026-09-15T14:59:30.000Z', timing: { ...scheduler.DEFAULT_TIMING } });
  await f.start();
  const end = Date.parse('2026-09-16T15:00:30.000Z');
  while (f.now() < end) { f.advance(Math.min(30000, end - f.now())); await f.c.tick(); }
  assert.deepEqual(f.operations('claim').map(call => call.config.body.slotKey), ['2026-09-15T15:00:00.000Z', '2026-09-16T15:00:00.000Z']);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 2);
  assert.ok(f.operations('status').length < 310, 'daily cadence does not increase routine status polling');
});

test('custom minute time and interval boundaries drive real queries using server time', async () => {
  for (const timing of [{ intervalHours: 24, startTime: '08:17' }, { intervalHours: 4, startTime: '01:30' }]) {
    const slot = timing.intervalHours === 24 ? '2026-10-28T23:17:00.000Z' : '2026-10-28T20:30:00.000Z';
    const f = fixture({ start: date(Date.parse(slot) - 30000), timing: { ...timing, timeZone: 'Asia/Seoul' } });
    await f.start(); await f.cross();
    assert.equal(f.operations('claim').length, 1);
    assert.equal(f.operations('claim')[0].config.body.slotKey, slot);
    assert.equal(f.operations('claim')[0].config.body.expectedRevision, 1);
    assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  }
  const timing = { intervalHours: 4, startTime: '01:30' };
  for (const hour of [1, 5, 9, 13, 17, 21]) {
    const kst = `2026-10-29T${String(hour).padStart(2, '0')}:30:00+09:00`;
    assert.equal(scheduler.slotAt(Date.parse(kst) + 1, timing), Date.parse(kst));
  }
});

test('register can atomically submit selected timing while omitted timing preserves the configured cadence', async () => {
  const f = fixture({ enabled: false });
  await f.c.register({ confirmedPhysicalBco1: true, timing: { intervalHours: 24, startTime: '00:00' } });
  assert.deepEqual(f.operations('register')[0].config.body.timing, { intervalHours: 24, startTime: '00:00' });
  assert.deepEqual(f.c.snapshot().status.timing, { ...scheduler.DEFAULT_TIMING });
  await f.c.disable();
  await f.c.register({ confirmedPhysicalBco1: true });
  assert.equal(Object.hasOwn(f.operations('register')[1].config.body, 'timing'), false);
  assert.deepEqual(f.c.snapshot().status.timing, { ...scheduler.DEFAULT_TIMING });
  assert.equal(f.operations('claim').length, 0);
});

test('configure preserves enabled/designated state and starts only at a later scheduled boundary', async () => {
  for (const enabled of [true, false]) {
    const f = fixture({ start: '2026-09-16T03:00:00.000Z', enabled });
    await f.start();
    const result = await f.c.configure({ intervalHours: 24, startTime: '12:00' });
    assert.equal(result.status.enabled, enabled);
    assert.equal(result.status.thisDevice, true);
    assert.equal(result.status.revision, 2);
    assert.equal(result.status.nextSlotAt, '2026-09-17T03:00:00.000Z');
    await f.c.tick(); f.advance(15000); await f.c.tick();
    assert.equal(f.operations('claim').length, 0, 'saving at the current boundary does not catch up');
    assert.deepEqual(f.operations('configure')[0].config.body.timing, { intervalHours: 24, startTime: '12:00' });
    assert.equal(f.operations('configure')[0].config.body.expectedRevision, 1);
  }
});

test('invalid timing is rejected before saving or registering and another device cannot configure', async () => {
  const f = fixture();
  for (const timing of [null, [], {}, { intervalHours: '24', startTime: '00:00' },
    { intervalHours: 5, startTime: '00:00' }, { intervalHours: 24, startTime: '24:00' },
    { intervalHours: 24, startTime: '0:00' }, { intervalHours: 24, startTime: '00:60' },
    { intervalHours: 24, startTime: '00:00', timeZone: 'UTC' }, { intervalHours: 24, startTime: '00:00', enabled: true }]) {
    await assert.rejects(f.c.configure(timing), { code: 'SCHEDULE_TIMING_INVALID' });
    await assert.rejects(f.c.register({ confirmedPhysicalBco1: true, timing }), { code: 'SCHEDULE_TIMING_INVALID' });
  }
  assert.equal(f.calls.length, 0);
  f.configured = false;
  await assert.rejects(f.c.configure({ intervalHours: 24, startTime: '00:00' }), { code: 'SCHEDULE_PC_NOT_DESIGNATED' });
  assert.equal(f.operations('configure').length, 0);
});

test('saving settings invalidates a boundary tick awaiting status and never launches immediately', async () => {
  const f = fixture(); await f.start();
  let release, entered, hold = true;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  f.beforeApi = async config => { if (config.body?.operation === 'status' && hold) { hold = false; entered(); await gate; } };
  f.advance(30000); const older = f.c.tick(); await waiting;
  await f.c.configure({ intervalHours: 24, startTime: '12:00' });
  release(); await older;
  await f.c.tick();
  assert.equal(f.operations('claim').length, 0);
  assert.equal(f.c.snapshot().status.timing.intervalHours, 24);
});

test('server timing changes at a crossed boundary discard the old cadence before claiming', async () => {
  const f = fixture(); await f.start();
  let changed = false;
  f.beforeApi = config => {
    if (!changed && config.body?.operation === 'status') {
      changed = true; f.revision += 1; f.timing = { intervalHours: 24, startTime: '12:00', timeZone: 'Asia/Seoul' };
    }
  };
  await f.cross();
  assert.equal(f.operations('claim').length, 0);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.equal(f.c.snapshot().status.revision, 2);
});

test('claim carries the observed revision so a settings race after status cannot authorize obsolete cadence', async () => {
  const f = fixture(); await f.start();
  let changed = false;
  f.afterApi = config => { if (!changed && config.body?.operation === 'status') { changed = true; f.revision += 1; } };
  await f.cross();
  assert.equal(f.operations('claim').length, 1);
  assert.equal(f.operations('claim')[0].config.body.expectedRevision, 1);
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 0);
  assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), null);
});

test('invalid or missing server timing and inconsistent next times cannot authorize a query', async () => {
  for (const damage of [d => { delete d.timing; }, d => { d.timing.timeZone = 'UTC'; },
    d => { d.timing.intervalHours = 5; }, d => { d.nextSlotAt = date(Date.parse(d.nextSlotAt) + 60000); }]) {
    const f = fixture();
    f.afterApi = (config, data) => { if (config.body?.operation === 'status') damage(data); };
    await f.start(); await f.cross();
    assert.equal(f.operations('claim').length, 0);
    assert.equal(f.c.snapshot().error, 'SCHEDULE_STATUS_INVALID');
  }
});

test('adapter snapshot cannot mutate the trusted scheduler timing', async () => {
  const f = fixture(); await f.start();
  const exposed = f.c.snapshot(); exposed.status.timing.startTime = '12:17'; exposed.status.timing.intervalHours = 24;
  assert.deepEqual(f.c.snapshot().status.timing, FOUR_HOUR_TIMING);
  await f.cross(); assert.equal(f.operations('claim').length, 1);
});

test('a bounded foreground waiting result recovers only accepted receipt IDs instead of finishing partial', async () => {
  const f = fixture();
  f.afterApi = (config, data) => {
    if (config.url.startsWith('/api/ois-data-requests?action=status_batch') && f.mono < 155000) {
      // Stay processing past the foreground's two-minute poll budget, then
      // complete the SAME accepted request during durable receipt recovery.
      data.items = data.items.map(item => ({ ...item, status: 'processing' }));
    }
  };
  await f.start(); await f.cross();
  assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1);
  assert.equal(f.operations('finish').length, 1);
  assert.equal(f.operations('finish')[0].config.body.status, 'complete');
  assert.equal(f.actions('dataparc_runtime_sync').length, 1);
  assert.ok(f.mono >= 155000);
  const resumed = f.operations('check').filter(call => call.config.body.purpose === 'resume');
  assert.equal(resumed.length, 1);
  const detailReads = f.calls.filter(call => call.config.url.startsWith('/api/ois-data-requests?id='));
  assert.equal(detailReads.length, 1); assert.ok(detailReads[0].config.url.endsWith('request-1'));
  assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), null);
});


test('pending receipt recovery retains the live whole-plan count and incomplete-log warning', async () => {
  for (const scenario of ['skipped asset', 'incomplete logs', 'both']) {
    const f = fixture({ assets: scenario === 'incomplete logs' ? ['104ETH03AN602'] : ['104ETH03AN602', 'UNCONNECTED'] });
    const specialCore = scenario === 'skipped asset' ? core : { ...core,
      refreshLogsForRuntime: async (...args) => ({ ...await core.refreshLogsForRuntime(...args), complete: false, warning: 'Fixture incomplete logs' }) };
    f.c = f.controller({ core: specialCore });
    f.afterApi = (config, data) => {
      if (config.url.startsWith('/api/ois-data-requests?action=status_batch') && f.mono < 155000) {
        data.items = data.items.map(item => ({ ...item, status: 'processing' }));
      }
    };
    await f.start(); await f.cross();
    assert.equal(f.actions('create_blower_runtime_probe_batch').length, 1, scenario);
    assert.equal(f.actions('dataparc_runtime_sync').length, 1, scenario);
    assert.equal(f.operations('finish').length, 1, scenario);
    const finished = f.operations('finish')[0].config.body;
    assert.equal(finished.status, 'partial', scenario);
    assert.equal(finished.targetCount, scenario === 'incomplete logs' ? 1 : 2, scenario);
    assert.equal(finished.completedCount, 1, scenario);
    assert.equal(finished.failedCount, 0, scenario);
    assert.equal(f.operations('check').filter(call => call.config.body.purpose === 'resume').length, 1, scenario);
    assert.equal(f.storage.getItem(RECEIPT('BCO-1-user')), null, scenario);
  }
});
