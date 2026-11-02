import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleBlowerSchedule, prepareScheduledBatch, scheduledBatchStatements } from '../functions/_shared/blower-schedule-v1.js';

const NativeDate = Date;
const SLOT = '2026-11-01T15:00:00.000Z'; // 11/2 00:00 KST.
const DEVICE = 'a'.repeat(64), OTHER = 'b'.repeat(64), NONCE = 'c'.repeat(64);
const USER = { employeeNo: 'bco1-owner' };
async function fixture(t, options = {}) {
  let now = NativeDate.parse(SLOT) - 30000;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  t.after(() => { globalThis.Date = NativeDate; });
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  raw.exec(`CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('unchanged');`);
  const db = { prepare(sql) { return { sql, values: [], bind(...values) { this.values = values; return this; },
    async run() { return { meta: { changes: Number(raw.prepare(this.sql).run(...this.values).changes) } }; },
    async all() { return { results: raw.prepare(this.sql).all(...this.values) }; },
    async first() { return raw.prepare(this.sql).get(...this.values) || null; } }; },
    async batch(statements) { raw.exec('BEGIN IMMEDIATE'); try {
      const values = []; for (const statement of statements) values.push(await statement.run()); raw.exec('COMMIT'); return values;
    } catch (error) { raw.exec('ROLLBACK'); throw error; } }
  };
  const set = value => { now = typeof value === 'number' ? value : NativeDate.parse(value); };
  const call = async (operation, extra = {}, user = USER) => {
    const response = await handleBlowerSchedule({ env: { DB: db }, request: new Request('https://example.test/api/blower-history') },
      user, { action: 'scheduled_refresh', scheduleVersion: 2, operation, deviceKey: DEVICE, ...extra });
    return { status: response.status, body: await response.json() };
  };
  const claim = (extra = {}, user) => call('claim', { slotKey: SLOT, runToken: NONCE,
    expectedRevision: raw.prepare('SELECT revision FROM blower_schedule_config_v1 WHERE singleton=1').get()?.revision || 0, ...extra }, user);
  if (options.registerAt) set(options.registerAt);
  const registered = await call('register', { confirmedPhysicalBco1: true, expectedRevision: 0, ...(options.timing ? { timing: options.timing } : {}) });
  assert.equal(registered.status, 200, JSON.stringify(registered.body));
  set(options.now || NativeDate.parse(SLOT) + 6 * 3600000);
  return { raw, db, set, call, claim, now: () => now };
}

test('late login/wake advertises and claims the current missed midnight once, without changing requests or results', async t => {
  const f = await fixture(t);
  const before = f.raw.prepare('SELECT * FROM blower_schedule_config_v1').get();
  const status = await f.call('status');
  assert.equal(status.body.dueSlotAt, SLOT); assert.equal(status.body.nextSlotAt, '2026-11-02T15:00:00.000Z');
  assert.deepEqual(f.raw.prepare('SELECT * FROM blower_schedule_config_v1').get(), before);
  assert.equal((await f.claim()).body.acquired, true);
  assert.equal((await f.call('status')).body.dueSlotAt, null);
  assert.equal((await f.claim({ runToken: 'd'.repeat(64) })).body.acquired, false);
  const finished = await f.call('finish', { slotKey: SLOT, runToken: NONCE, status: 'complete',
    targetCount: 0, completedCount: 0, failedCount: 0 });
  assert.equal(finished.status, 200);
  assert.equal((await f.call('status')).body.dueSlotAt, null, 'a terminal current slot is not made due again');
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 1);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n, 0);
  assert.equal(f.raw.prepare('SELECT value FROM preserved').get().value, 'unchanged');
});

test('several missed days coalesce to only the newest canonical current interval', async t => {
  const f = await fixture(t, { now: '2026-11-05T03:00:00Z' });
  const due = '2026-11-04T15:00:00.000Z';
  assert.equal((await f.call('status')).body.dueSlotAt, due);
  assert.equal((await f.claim()).body.code, 'outside_slot_window');
  assert.equal((await f.claim({ slotKey: '2026-11-03T15:00:00.000Z' })).body.code, 'outside_slot_window');
  assert.equal((await f.claim({ slotKey: due })).body.acquired, true);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 1);
});

test('fresh registration and timing changes take effect only for slots at or after their saved effective time', async t => {
  const f = await fixture(t, { registerAt: '2026-11-02T01:00:00Z', now: '2026-11-02T01:01:00Z' });
  assert.equal((await f.call('status')).body.dueSlotAt, null);
  assert.equal((await f.claim()).body.code, 'outside_slot_window');
  f.set('2026-11-02T15:01:00Z');
  assert.equal((await f.call('status')).body.dueSlotAt, '2026-11-02T15:00:00.000Z');
  const configured = await f.call('configure', { expectedRevision: 1, timing: { intervalHours: 1, startTime: '00:00' } });
  assert.equal(configured.status, 200); assert.equal(configured.body.dueSlotAt, null);
  assert.equal((await f.claim({ slotKey: '2026-11-02T15:00:00.000Z' })).body.code, 'outside_slot_window');
  f.set('2026-11-02T16:10:00Z');
  assert.equal((await f.call('status')).body.dueSlotAt, '2026-11-02T16:00:00.000Z');
  assert.equal((await f.claim({ slotKey: '2026-11-02T16:00:00.000Z' })).body.acquired, true);
});

test('live queue contention keeps the same slot due and permits a later retry after completion', async t => {
  const f = await fixture(t);
  f.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?)').run('live', 'blower_runtime_probe', 'processing', '2026-11-02T14:00:00Z');
  assert.equal((await f.claim()).body.code, 'blower_busy');
  assert.equal((await f.call('status')).body.dueSlotAt, SLOT);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 0);
  f.raw.prepare("UPDATE ois_data_requests SET status='complete' WHERE id='live'").run();
  f.set(NativeDate.parse(SLOT) + 7 * 3600000);
  assert.equal((await f.claim()).body.acquired, true);
});

test('only provably expired queue rows are ignored; null, invalid, and exact-now expiry still block unchanged', async t => {
  const f = await fixture(t);
  for (const [id, expiry] of [['expired-pending', '2026-11-01T16:00:00Z'], ['expired-processing', '2026-11-01T18:00:00+01:00']])
    f.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?)').run(id, 'blower_runtime_probe', id.endsWith('pending') ? 'pending' : 'processing', expiry);
  const expired = f.raw.prepare('SELECT * FROM ois_data_requests ORDER BY id').all();
  for (const value of [null, '', 'not-a-date', new Date(f.now()).toISOString()]) {
    f.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?)').run('uncertain', 'blower_runtime_probe', 'pending', value);
    const before = f.raw.prepare('SELECT * FROM ois_data_requests ORDER BY id').all();
    assert.equal((await f.claim()).body.code, 'blower_busy', String(value));
    assert.deepEqual(f.raw.prepare('SELECT * FROM ois_data_requests ORDER BY id').all(), before);
    f.raw.prepare("DELETE FROM ois_data_requests WHERE id='uncertain'").run();
  }
  assert.equal((await f.claim()).body.acquired, true);
  assert.deepEqual(f.raw.prepare('SELECT * FROM ois_data_requests ORDER BY id').all(), expired);
});

test('disabled, foreign-device and anonymous clients cannot claim or receive an actionable due slot', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('status', { deviceKey: OTHER })).body.dueSlotAt, null);
  assert.equal((await f.claim({ deviceKey: OTHER })).status, 403);
  assert.equal((await f.claim({}, null)).status, 401);
  assert.equal((await f.call('status', {}, null)).status, 401);
  await f.call('disable', { expectedRevision: 1 });
  assert.equal((await f.call('status')).body.dueSlotAt, null);
  assert.equal((await f.claim()).status, 403);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM blower_schedule_slots_v1').get().n, 0);
});

test('concurrent late retries create one owner and do not take over an old claimed slot', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => f.claim({ runToken: i.toString(16).padStart(64, '0') })));
  assert.equal(results.filter(r => r.body.acquired === true).length, 1);
  const before = f.raw.prepare('SELECT * FROM blower_schedule_slots_v1').get();
  f.set(NativeDate.parse(SLOT) + 12 * 3600000);
  assert.equal((await f.call('status')).body.dueSlotAt, null);
  assert.equal((await f.claim({ runToken: NONCE })).body.acquired, false);
  assert.deepEqual(f.raw.prepare('SELECT * FROM blower_schedule_slots_v1').get(), before);
});

test('late catch-up retains the original ten-minute create and 24-hour resume deadlines and immutable receipt', async t => {
  const f = await fixture(t);
  assert.equal((await f.claim()).body.acquired, true);
  const metadata = { deviceKey: DEVICE, runToken: NONCE, slotKey: SLOT };
  const guard = await prepareScheduledBatch(f.db, USER, metadata, f.now());
  await f.db.batch(scheduledBatchStatements(f.db, guard,
    { version: 1, requestedCount: 0, items: [], upToDateTags: [] }, f.now()));
  const before = f.raw.prepare('SELECT * FROM blower_schedule_slots_v1').get();
  f.set(f.now() + 11 * 60000);
  assert.equal((await f.call('check', { ...metadata, purpose: 'create' })).body.code, 'run_expired');
  assert.equal((await f.call('check', { ...metadata, purpose: 'resume' })).body.allowed, true);
  f.set(NativeDate.parse(before.claimed_at) + 24 * 3600000 + 1);
  assert.equal((await f.call('check', { ...metadata, purpose: 'resume' })).body.code, 'run_expired');
  assert.deepEqual(f.raw.prepare('SELECT * FROM blower_schedule_slots_v1').get(), before);
});
