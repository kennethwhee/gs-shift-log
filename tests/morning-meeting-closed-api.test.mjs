import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceResult, packet, database, call, stored, SOURCE_ID, DATE, spec, core, contract } from './helpers/cofiring-review-fixture.mjs';

const detail = db => call(db, { method: 'GET', query: '?targetDate=' + DATE });

async function legacySnapshot(db) {
  const saved = await call(db);
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const snapshot = JSON.parse(stored(db).snapshot_json);
  delete snapshot.organicInventory;
  db.raw.prepare('UPDATE cofiring_closed_snapshots SET snapshot_json=? WHERE target_date=?')
    .run(JSON.stringify(snapshot), DATE);
  return snapshot;
}

test('new closed saves retain canonical individual inventory and ignore client-injected stock', async t => {
  const source = sourceResult(), db = database(t, source), p = packet(source);
  p.snapshot.organicInventory = { end: { total: 999999, organicDaySilo: 999999 } };
  const saved = await call(db, { body: p });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const snapshot = JSON.parse(stored(db).snapshot_json);
  assert.deepEqual(snapshot.organicInventory, source.report.reference.organicInventory);
  const before = stored(db), writes = db.writes;
  // Persisted stocks remain available after the original OIS request is retired.
  db.raw.prepare('DELETE FROM ois_data_requests').run();
  const read = await detail(db);
  assert.equal(read.status, 200);
  assert.deepEqual(read.payload.item.organicInventory, snapshot.organicInventory);
  assert.equal(read.payload.item.version, saved.payload.item.version);
  assert.equal(read.payload.item.revision, 1);
  assert.deepEqual(stored(db), before);
  assert.equal(db.writes, writes);
});

test('legacy exact-date GET recovers only the saved request inventory without rewriting history', async t => {
  const source = sourceResult(), db = database(t, source), snapshot = await legacySnapshot(db);
  const before = stored(db), writes = db.writes;
  const read = await detail(db);
  assert.equal(read.status, 200);
  assert.deepEqual(read.payload.item.organicInventory, source.report.reference.organicInventory);
  assert.deepEqual(read.payload.item.snapshot, snapshot);
  assert.deepEqual(read.payload.item.summary, JSON.parse(before.summary_json));
  assert.deepEqual(stored(db), before);
  assert.equal(db.writes, writes);
  const second = await detail(db);
  assert.equal(second.payload.item.version, read.payload.item.version);
  assert.equal(second.payload.item.updatedAt, read.payload.item.updatedAt);
});

test('legacy recovery rejects unavailable, different, incomplete and corrupt source records', async t => {
  const mutations = [
    db => db.raw.prepare('DELETE FROM ois_data_requests').run(),
    db => db.raw.prepare("UPDATE ois_data_requests SET id='00000000-0000-4000-8000-000000000456'").run(),
    db => db.raw.prepare("UPDATE ois_data_requests SET target_date='2026-09-09'").run(),
    db => db.raw.prepare("UPDATE ois_data_requests SET request_type='daily_data_excel'").run(),
    db => db.raw.prepare("UPDATE ois_data_requests SET status='processing'").run(),
    db => db.raw.prepare('UPDATE ois_data_requests SET result_json=?').run('{'),
    db => db.raw.prepare('UPDATE ois_data_requests SET result_json=?').run(JSON.stringify({ ...sourceResult(), requestId: '00000000-0000-4000-8000-000000000456' })),
    db => db.raw.prepare('UPDATE ois_data_requests SET result_json=?').run(JSON.stringify(sourceResult({ specification: { ...spec, endLocal: DATE + 'T12:00' } })))
  ];
  for (const [index, mutate] of mutations.entries()) {
    await t.test(String(index), async sub => {
      const db = database(sub); await legacySnapshot(db);
      const before = stored(db), writes = db.writes;
      mutate(db);
      const read = await detail(db);
      assert.equal(read.status, 200);
      assert.equal(read.payload.item.organicInventory, null);
      assert.deepEqual(stored(db), before);
      assert.equal(db.writes, writes);
    });
  }
});

test('inventory recovery requires matching closed totals and full-day snapshot identity', async t => {
  const mutations = [
    snapshot => { snapshot.organicUsage.startTotal += 1; },
    snapshot => { snapshot.organicUsage.endTotal += 1; },
    snapshot => { snapshot.organicUsage.endTotal = null; },
    snapshot => { snapshot.targetDate = '2026-09-09'; },
    snapshot => { snapshot.sourceRequestId = '00000000-0000-4000-8000-000000000456'; },
    snapshot => { snapshot.period.endLocal = DATE + 'T12:00'; }
  ];
  for (const [index, mutate] of mutations.entries()) {
    await t.test(String(index), async sub => {
      const db = database(sub), snapshot = await legacySnapshot(db);
      mutate(snapshot);
      db.raw.prepare('UPDATE cofiring_closed_snapshots SET snapshot_json=?').run(JSON.stringify(snapshot));
      const read = await detail(db);
      assert.equal(read.status, 200);
      assert.equal(read.payload.item.organicInventory, null);
      assert.deepEqual(read.payload.item.snapshot, snapshot);
    });
  }
});

test('explicit manual closing preserves available source inventory without inventing missing stock', async t => {
  for (const inventory of [true, false]) {
    const source = sourceResult({ inventory }), db = database(t, source), p = packet(source), period = p.snapshot.period;
    p.snapshot.manual = { inputMode: 'manual', unit1: { organic: 20, manure: 2 }, unit2: { organic: 34, manure: 0 }, receipts: { organic: 57.8, manure: 0 } };
    p.snapshot.result = core.analyzePeriodSummary(source.report.reference, {
      organic: { start: period.start, end: period.end, unit1: 20, unit2: 34 },
      manure: { start: period.start, end: period.end, unit1: 2, unit2: 0 }
    });
    const saved = await call(db, { body: p });
    assert.equal(saved.status, 200, JSON.stringify(saved.payload));
    const read = await detail(db);
    assert.deepEqual(read.payload.item.organicInventory, inventory ? source.report.reference.organicInventory : null);
    assert.equal(read.payload.item.snapshot.organicUsage.startTotal, undefined);
    assert.equal(read.payload.item.snapshot.organicUsage.endTotal, undefined);
  }
});

test('canonical zero stock and its raw negative evidence survive closing and reading', async t => {
  const raw = sourceResult(), inventory = raw.report.organicInventory;
  const sample = inventory.samples.find(item => item.key === 'organicStorageSiloA');
  sample.startValue = 0;
  sample.rawStartValue = -9.7;
  inventory.start.organicStorageSiloA = 0;
  inventory.start.total = 70;
  const source = contract.periodResult(raw, SOURCE_ID, spec), db = database(t, source), p = packet(source);
  p.snapshot.manual.receipts.organic = 110;
  const saved = await call(db, { body: p });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const read = await detail(db);
  assert.equal(read.payload.item.organicInventory.start.organicStorageSiloA, 0);
  assert.equal(read.payload.item.organicInventory.samples.find(item => item.key === 'organicStorageSiloA').rawStartValue, -9.7);
});

test('malformed persisted inventory is unavailable and does not silently use a different stock source', async t => {
  const db = database(t); await call(db);
  const snapshot = JSON.parse(stored(db).snapshot_json);
  snapshot.organicInventory.end.organicDaySilo = -1;
  db.raw.prepare('UPDATE cofiring_closed_snapshots SET snapshot_json=?').run(JSON.stringify(snapshot));
  const read = await detail(db);
  assert.equal(read.status, 200);
  assert.equal(read.payload.item.organicInventory, null);
});

test('missing exact dates stay empty and list lookups do not enrich unrelated days', async t => {
  const db = database(t); await call(db);
  const absent = await call(db, { method: 'GET', query: '?targetDate=2026-09-09' });
  assert.equal(absent.status, 200);
  assert.equal(absent.payload.item, null);
  const list = await call(db, { method: 'GET', query: '?month=2026-09' });
  assert.equal(list.status, 200);
  assert.equal(list.payload.items.length, 1);
  assert.equal(Object.hasOwn(list.payload.items[0], 'organicInventory'), false);
});
