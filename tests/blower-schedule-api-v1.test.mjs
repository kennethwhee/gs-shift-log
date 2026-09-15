import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  handleBlowerSchedule, prepareScheduledBatch, scheduledBatchStatements,
  isScheduledBatchConflict, __blowerScheduleTest
} from '../functions/_shared/blower-schedule-v1.js';

const DEVICE = 'a'.repeat(64), OTHER_DEVICE = 'b'.repeat(64), TOKEN = 'c'.repeat(64);
const USER = { employeeNo: 'TEST_BCO1' };
const SLOT = '2026-09-15T19:00:00.000Z';
const RealDate = Date;
let clock = RealDate.parse(SLOT);
function at(value) { clock = typeof value === 'number' ? value : RealDate.parse(value); }
function installClock(t) {
  at(SLOT);
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  t.after(() => { globalThis.Date = RealDate; });
}
function fixture(t, withQueue = true) {
  installClock(t);
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  if (withQueue) sqlite.exec(`CREATE TABLE ois_data_requests (id TEXT PRIMARY KEY,request_type TEXT,status TEXT);
    CREATE TABLE existing_results (id TEXT PRIMARY KEY,value TEXT);
    INSERT INTO existing_results VALUES ('preserved','123.456');`);
  const state = { beforeRun: null };
  const db = {
    prepare(sql) {
      let args = [];
      const statement = {
        sql,
        bind(...values) { args = values; return statement; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() {
          if (state.beforeRun) state.beforeRun(sql, args);
          return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } };
        }
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
    }
  };
  async function call(operation, values = {}, user = USER, headers = {}) {
    const response = await handleBlowerSchedule({ env: { DB: db }, request: new Request('https://test.invalid/api/blower-history', { headers }) },
      user, { action: 'scheduled_refresh', operation, ...values });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  const register = (deviceKey = DEVICE, expectedRevision = 0, user = USER) =>
    call('register', { deviceKey, expectedRevision, confirmedPhysicalBco1: true }, user);
  const metadata = { deviceKey: DEVICE, runToken: TOKEN, slotKey: SLOT };
  const claim = (values = {}, user = USER) => call('claim', { ...metadata, ...values }, user);
  return { db, sqlite, state, call, register, claim, metadata };
}

test('all six KST slots and midnight/year boundaries use server time', () => {
  for (const date of ['2026-09-16', '2027-01-01']) {
    for (const hour of [0, 4, 8, 12, 16, 20]) {
      const kst = `${date}T${String(hour).padStart(2, '0')}:00:00+09:00`;
      const start = RealDate.parse(kst);
      assert.equal(__blowerScheduleTest.slotStart(start), start);
      assert.equal(__blowerScheduleTest.slotStart(start + 1), start);
      assert.equal(__blowerScheduleTest.slotStart(start - 1), start - 14400000);
    }
  }
});

test('status defaults disabled and requires no device registration', async t => {
  const f = fixture(t);
  const reply = await f.call('status');
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.data, { version: 'blower-schedule-v1', serverNow: SLOT, ok: true,
    enabled: false, revision: 0, thisDevice: false, nextSlotAt: '2026-09-15T23:00:00.000Z', latestSlot: null });
  assert.equal(reply.headers.get('cache-control'), 'no-store');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 0);
});

test('registration requires explicit BCO1 confirmation, strict key and revision', async t => {
  const f = fixture(t);
  assert.equal((await f.call('register', { deviceKey: DEVICE, expectedRevision: 0 })).data.code, 'physical_bco1_confirmation_required');
  for (const key of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), { toString: () => DEVICE }]) {
    assert.equal((await f.call('register', { deviceKey: key, expectedRevision: 0, confirmedPhysicalBco1: true })).status, 400);
  }
  for (const revision of [-1, 0.1, '0', Number.MAX_SAFE_INTEGER]) {
    assert.equal((await f.call('register', { deviceKey: DEVICE, expectedRevision: revision, confirmedPhysicalBco1: true })).status, 400);
  }
  const result = await f.register();
  assert.equal(result.data.enabled, true);
  assert.equal(result.data.revision, 1);
  assert.equal(result.data.thisDevice, true);
  const stored = f.sqlite.prepare('SELECT * FROM blower_schedule_config_v1').get();
  assert.notEqual(stored.device_hash, DEVICE);
  assert.equal(stored.device_hash.length, 64);
});

test('simultaneous first registration and replacement use revision CAS', async t => {
  const f = fixture(t);
  const initial = await Promise.all([f.register(DEVICE), f.register(OTHER_DEVICE)]);
  assert.deepEqual(initial.map(r => r.status).sort(), [200, 409]);
  const replacement = await Promise.all([f.register(DEVICE, 1), f.register(OTHER_DEVICE, 1)]);
  assert.deepEqual(replacement.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.sqlite.prepare('SELECT revision FROM blower_schedule_config_v1').get().revision, 2);
});

test('anonymous and mobile clients are denied before storage access', async t => {
  const f = fixture(t);
  assert.equal((await f.call('status', {}, null)).status, 401);
  assert.equal((await f.call('register', { deviceKey: DEVICE, expectedRevision: 0, confirmedPhysicalBco1: true }, USER,
    { 'X-GS-Client-Mode': 'mobile-monitoring' })).status, 403);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'blower_schedule_%'").get().n, 0);
});

test('disable requires designated device or superadmin and preserves revision guards', async t => {
  const f = fixture(t);
  await f.register();
  assert.equal((await f.call('disable', { deviceKey: OTHER_DEVICE, expectedRevision: 1 })).status, 403);
  assert.equal((await f.call('disable', { deviceKey: DEVICE, expectedRevision: 0 })).status, 409);
  const disabled = await f.call('disable', { deviceKey: OTHER_DEVICE, expectedRevision: 1 }, { ...USER, isSuperAdmin: true });
  assert.equal(disabled.data.enabled, false);
  assert.equal(disabled.data.revision, 2);
  assert.equal((await f.claim()).status, 403);
});

test('claim admits exact start and last millisecond, rejects past/future/noncanonical slots', async t => {
  const f = fixture(t);
  await f.register();
  assert.equal((await f.claim()).data.acquired, true);
  at(RealDate.parse(SLOT) + 119999);
  assert.equal((await f.claim()).data.acquired, false);
  at(RealDate.parse(SLOT) + 120000);
  assert.equal((await f.claim()).data.code, 'outside_slot_window');
  at(SLOT);
  assert.equal((await f.claim({ slotKey: '2026-09-15T15:00:00.000Z' })).data.code, 'outside_slot_window');
  assert.equal((await f.claim({ slotKey: '2026-09-15T23:00:00.000Z' })).data.code, 'outside_slot_window');
  assert.equal((await f.claim({ slotKey: '2026-09-16T04:00:00+09:00' })).data.code, 'invalid_run');
  assert.equal((await f.claim({ deviceKey: OTHER_DEVICE })).status, 403);
});

test('simultaneous tabs/accounts/nonces obtain at most one durable permission', async t => {
  const f = fixture(t);
  await f.register();
  const replies = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    f.claim({ runToken: i.toString(16).padStart(64, '0') }, { employeeNo: `test${i}` })));
  assert.equal(replies.filter(r => r.data.acquired === true).length, 1);
  assert.equal(replies.filter(r => r.data.acquired === false).length, 19);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 1);
});

test('same-slot receipt survives disable and re-registration to a different browser', async t => {
  const f = fixture(t);
  await f.register();
  await f.claim();
  await f.call('disable', { deviceKey: DEVICE, expectedRevision: 1 });
  await f.register(OTHER_DEVICE, 2);
  const result = await f.claim({ deviceKey: OTHER_DEVICE, runToken: 'd'.repeat(64) }, { employeeNo: 'other' });
  assert.equal(result.data.acquired, false);
  assert.equal(result.data.code, 'slot_already_claimed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 1);
});

test('pending and processing Blower rows block claims without expiring or rewriting them', async t => {
  const f = fixture(t);
  await f.register();
  for (const state of ['pending', 'processing']) {
    f.sqlite.prepare('INSERT INTO ois_data_requests VALUES (?,?,?)').run(state, 'blower_runtime_probe', state);
    const before = JSON.stringify(f.sqlite.prepare('SELECT * FROM ois_data_requests ORDER BY id').all());
    assert.equal((await f.claim()).data.code, 'blower_busy');
    assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM ois_data_requests ORDER BY id').all()), before);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT value FROM existing_results').get().value, '123.456');
});

test('completed Blower and unrelated pending rows do not block a claim', async t => {
  const f = fixture(t);
  f.sqlite.exec("INSERT INTO ois_data_requests VALUES ('done','blower_runtime_probe','complete'),('cofire','cofiring','pending')");
  await f.register();
  assert.equal((await f.claim()).data.acquired, true);
});

test('missing request queue fails closed rather than assuming idle', async t => {
  const f = fixture(t, false);
  await f.register();
  const result = await f.claim();
  assert.equal(result.status, 503);
  assert.equal(result.data.code, 'storage_unavailable');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 0);
});

test('configuration and queue changes at the insertion boundary invalidate claim', async t => {
  const f = fixture(t);
  await f.register();
  f.state.beforeRun = sql => {
    if (sql.includes('INSERT INTO blower_schedule_slots_v1')) {
      f.state.beforeRun = null;
      f.sqlite.exec('UPDATE blower_schedule_config_v1 SET revision = revision + 1');
    }
  };
  assert.equal((await f.claim()).data.code, 'configuration_changed');
  f.state.beforeRun = sql => {
    if (sql.includes('INSERT INTO blower_schedule_slots_v1')) {
      f.state.beforeRun = null;
      f.sqlite.exec("INSERT INTO ois_data_requests VALUES ('race','blower_runtime_probe','processing')");
    }
  };
  assert.equal((await f.claim()).data.code, 'blower_busy');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 0);
});

test('check distinguishes absent receipt and enforces original user, device and nonce', async t => {
  const f = fixture(t);
  await f.register();
  assert.equal((await f.call('check', { ...f.metadata, purpose: 'resume' })).data.code, 'run_not_found');
  await f.claim();
  for (const [values, user] of [[{ runToken: 'd'.repeat(64) }, USER], [{}, { employeeNo: 'other' }], [{ deviceKey: OTHER_DEVICE }, USER]]) {
    assert.equal((await f.call('check', { ...f.metadata, purpose: 'resume', ...values }, user)).status, 403);
  }
  const result = await f.call('check', { ...f.metadata, purpose: 'resume' });
  assert.equal(result.data.allowed, true);
  assert.equal(result.data.state, 'running');
  assert.equal(result.data.batchReceipt, null);
});

test('create and resume deadlines never renew the original claim', async t => {
  const f = fixture(t);
  await f.register(); await f.claim();
  at(RealDate.parse(SLOT) + 600000);
  assert.equal((await f.call('check', { ...f.metadata, purpose: 'create' })).data.allowed, true);
  at(clock + 1);
  assert.equal((await f.call('check', { ...f.metadata, purpose: 'create' })).data.code, 'run_expired');
  at(RealDate.parse(SLOT) + 86400000);
  assert.equal((await f.call('check', { ...f.metadata, purpose: 'resume' })).data.allowed, true);
  at(clock + 1);
  assert.equal((await f.call('check', { ...f.metadata, purpose: 'resume' })).data.code, 'run_expired');
  assert.equal(f.sqlite.prepare('SELECT claimed_at FROM blower_schedule_slots_v1').get().claimed_at, SLOT);
});

test('finish is count-bounded, immutable after first terminal result and allowed after disabling', async t => {
  const f = fixture(t);
  await f.register(); await f.claim();
  const result = { ...f.metadata, status: 'complete', targetCount: 20, completedCount: 20, failedCount: 0 };
  assert.equal((await f.call('finish', { ...result, completedCount: 19 })).data.code, 'invalid_result');
  assert.equal((await f.call('finish', { ...result, targetCount: 1001 })).data.code, 'invalid_result');
  assert.equal((await f.call('finish', result, { employeeNo: 'other' })).status, 403);
  await f.call('disable', { deviceKey: DEVICE, expectedRevision: 1 });
  at(clock + 10000);
  assert.equal((await f.call('finish', result)).data.state, 'complete');
  const storedAt = f.sqlite.prepare('SELECT updated_at FROM blower_schedule_slots_v1').get().updated_at;
  at(clock + 10000);
  assert.equal((await f.call('finish', result)).status, 200);
  assert.equal(f.sqlite.prepare('SELECT updated_at FROM blower_schedule_slots_v1').get().updated_at, storedAt);
  assert.equal((await f.call('finish', { ...result, status: 'failed' })).data.code, 'result_already_recorded');
});

const RECEIPT = { version: 1, requestedCount: 2,
  items: [{ id: 'brb1_test_01_00', assetTag: '104HHL60AP611' }], upToDateTags: ['104HHL60AP621'] };

test('batch receipt commits atomically, returns through resume and prevents all replayed creates', async t => {
  const f = fixture(t);
  await f.register(); await f.claim();
  const guard = await prepareScheduledBatch(f.db, USER, f.metadata);
  const duplicateGuard = await prepareScheduledBatch(f.db, USER, f.metadata);
  await f.db.batch([...scheduledBatchStatements(f.db, guard, { ...RECEIPT, unsafeExtra: TOKEN }),
    f.db.prepare("INSERT INTO ois_data_requests VALUES ('brb1_test_01_00','blower_runtime_probe','pending')")]);
  const resume = await f.call('check', { ...f.metadata, purpose: 'resume' });
  assert.deepEqual(resume.data.batchReceipt, RECEIPT);
  assert.equal((await f.call('check', { ...f.metadata, purpose: 'create' })).data.code, 'run_not_creatable');
  await assert.rejects(prepareScheduledBatch(f.db, USER, f.metadata), cause => cause.code === 'run_not_creatable');
  await assert.rejects(f.db.batch([...scheduledBatchStatements(f.db, duplicateGuard, RECEIPT),
    f.db.prepare("INSERT INTO ois_data_requests VALUES ('duplicate','blower_runtime_probe','pending')")]), isScheduledBatchConflict);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM blower_schedule_assertions_v1').get().n, 0);
});

test('batch configuration race and delayed create roll back receipt and request mutations', async t => {
  const f = fixture(t);
  await f.register(); await f.claim();
  const guard = await prepareScheduledBatch(f.db, USER, f.metadata);
  f.sqlite.exec('UPDATE blower_schedule_config_v1 SET revision = revision + 1');
  await assert.rejects(f.db.batch([...scheduledBatchStatements(f.db, guard, RECEIPT),
    f.db.prepare("INSERT INTO ois_data_requests VALUES ('bad','blower_runtime_probe','pending')")]), isScheduledBatchConflict);
  f.sqlite.exec('UPDATE blower_schedule_config_v1 SET revision = revision - 1');
  at(clock + 600001);
  await assert.rejects(f.db.batch([...scheduledBatchStatements(f.db, guard, RECEIPT),
    f.db.prepare("INSERT INTO ois_data_requests VALUES ('late','blower_runtime_probe','pending')")]), isScheduledBatchConflict);
  assert.equal(f.sqlite.prepare('SELECT batch_receipt FROM blower_schedule_slots_v1').get().batch_receipt, null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n, 0);
});

test('failure of a later request statement rolls back the receipt too', async t => {
  const f = fixture(t);
  await f.register(); await f.claim();
  const guard = await prepareScheduledBatch(f.db, USER, f.metadata);
  await assert.rejects(f.db.batch([...scheduledBatchStatements(f.db, guard, RECEIPT),
    f.db.prepare("INSERT INTO missing_table VALUES ('fails')")]));
  assert.equal(f.sqlite.prepare('SELECT batch_receipt FROM blower_schedule_slots_v1').get().batch_receipt, null);
  assert.equal((await f.call('check', { ...f.metadata, purpose: 'create' })).data.allowed, true);
});

test('receipt rejects duplicate/oversized IDs or tags and can record an empty no-work batch', async t => {
  const f = fixture(t);
  await f.register(); await f.claim();
  const guard = await prepareScheduledBatch(f.db, USER, f.metadata);
  const invalid = [
    { ...RECEIPT, requestedCount: 25 },
    { ...RECEIPT, upToDateTags: ['104HHL60AP611'] },
    { version: 1, requestedCount: 2, items: [RECEIPT.items[0], { ...RECEIPT.items[0], assetTag: '104HHL60AP621' }], upToDateTags: [] },
    { ...RECEIPT, items: [{ ...RECEIPT.items[0], id: 'x'.repeat(201) }] },
    { ...RECEIPT, items: [{ ...RECEIPT.items[0], assetTag: '../secret' }] }
  ];
  for (const receipt of invalid) assert.throws(() => scheduledBatchStatements(f.db, guard, receipt), cause => cause.code === 'invalid_batch_receipt');
  const empty = { version: 1, requestedCount: 0, items: [], upToDateTags: [] };
  await f.db.batch(scheduledBatchStatements(f.db, guard, empty));
  assert.deepEqual((await f.call('check', { ...f.metadata, purpose: 'resume' })).data.batchReceipt, empty);
});

test('responses expose bounded summaries and never device keys, run tokens or hashes', async t => {
  const f = fixture(t);
  const outputs = [await f.register(), await f.claim(), await f.call('check', { ...f.metadata, purpose: 'resume' }),
    await f.call('status', { deviceKey: DEVICE })];
  const stored = f.sqlite.prepare('SELECT device_hash,run_hash FROM blower_schedule_slots_v1').get();
  for (const output of outputs) {
    const serialized = JSON.stringify(output.data);
    for (const secret of [DEVICE, TOKEN, stored.device_hash, stored.run_hash]) assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes('owner_id'), false);
  }
  assert.equal(f.sqlite.prepare('SELECT value FROM existing_results').get().value, '123.456');
});
