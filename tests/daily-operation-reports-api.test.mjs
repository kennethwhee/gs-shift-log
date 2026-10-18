import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import * as api from '../functions/api/daily-operation-reports.js';

const DATE = '2026-10-17';
const TABLE = 'daily_operation_reports_v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const packet = (overrides = {}) => ({
  workDate: DATE, schemaVersion: 1, version: 0,
  values: { generation_u1_day: 0, generation_u2_day: 12.34567, remarks: '<b>문자 그대로</b>', empty: null },
  sources: { generation_u1_day: { source: 'morning-meeting', label: '전력 현황', date: DATE,
    sourceDate: '2026-10-18', requestId: 'source-1', updatedAt: '2026-10-18T08:00:00+09:00', note: 'TO 저장값' } },
  note: '특이사항\n줄바꿈 유지', ...overrides
});

function database(t) {
  const raw = new DatabaseSync(':memory:');
  t.after(() => raw.close());
  raw.exec(`CREATE TABLE users (employee_no TEXT PRIMARY KEY, name TEXT, is_active INTEGER, role TEXT);
    CREATE TABLE shift_log_sessions (token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT, last_used_at TEXT);
    CREATE TABLE morning_meeting_snapshots (target_date TEXT PRIMARY KEY, values_json TEXT);
    CREATE TABLE efficiency_daily_work_records (work_date TEXT PRIMARY KEY, content_json TEXT);
    INSERT INTO users VALUES ('1000001', '운전자', 1, 'user'), ('1000002', '수정자', 1, 'user'), ('1000003', '중지', 0, 'admin');
    INSERT INTO morning_meeting_snapshots VALUES ('2026-10-17', '{"protected":1}');
    INSERT INTO efficiency_daily_work_records VALUES ('2026-10-17', '{"protected":2}');`);
  for (const [token, employee, expiry] of [
    ['valid', '1000001', '2099-01-01'], ['second', '1000002', '2099-01-01'],
    ['disabled', '1000003', '2099-01-01'], ['expired', '1000001', '2020-01-01'], ['invalid-expiry', '1000001', 'bad']
  ]) raw.prepare('INSERT INTO shift_log_sessions VALUES (?, ?, ?, ?)').run(hash(token), employee, expiry, 'untouched');
  const db = {
    raw, writes: [], beforeMutation: null,
    prepare(sql) {
      let args = [];
      const execute = async fn => {
        if (/^\s*(?:CREATE|INSERT|UPDATE|DELETE)\b/i.test(sql)) {
          db.writes.push(sql);
          if (!/^\s*CREATE\b/i.test(sql) && db.beforeMutation) {
            const hook = db.beforeMutation;
            db.beforeMutation = null;
            await hook(sql, args);
          }
        }
        return fn();
      };
      return {
        bind(...values) { args = values; return this; },
        async first() { return execute(() => raw.prepare(sql).get(...args) || null); },
        async all() { return execute(() => ({ results: raw.prepare(sql).all(...args).map(row => ({ ...row })) })); },
        async run() { return execute(() => ({ success: true, meta: { changes: Number(raw.prepare(sql).run(...args).changes) } })); }
      };
    }
  };
  return db;
}

async function call(db, { method = 'POST', body = packet(), query = '', token = 'valid', headers = {} } = {}) {
  const request = new Request('https://gs.example/api/daily-operation-reports' + query, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
  });
  const handler = api['onRequest' + method[0] + method.slice(1).toLowerCase()];
  const response = await handler({ request, env: { DB: db } });
  return { status: response.status, payload: await response.json(), headers: response.headers };
}
const detail = (db, date = DATE) => call(db, { method: 'GET', query: '?date=' + encodeURIComponent(date) });
const stored = (db, date = DATE) => ({ ...db.raw.prepare(`SELECT * FROM ${TABLE} WHERE work_date = ?`).get(date) });
const mutation = (version, extra = {}) => packet({ version, ...extra });

test('an unsaved exact date and archive stay empty; read creates no schema or source writes', async t => {
  const db = database(t);
  const read = await detail(db);
  assert.equal(read.status, 200);
  assert.deepEqual(read.payload, { ok: true, workDate: DATE, version: 0, deleted: false, item: null });
  assert.match(read.headers.get('cache-control'), /no-store/);
  assert.deepEqual((await call(db, { method: 'GET', query: '?month=2026-10' })).payload,
    { ok: true, items: [], nextBefore: null });
  assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE name=?").get(TABLE), undefined);
  assert.deepEqual(db.writes, []);
});

test('active regular users save full precision, explicit zero, null, text and source metadata without changing other tables', async t => {
  const db = database(t), input = packet();
  const sessionsBefore = db.raw.prepare('SELECT * FROM shift_log_sessions ORDER BY token_hash').all();
  const saved = await call(db);
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.equal(saved.payload.version, 1);
  assert.equal(saved.payload.item.authorName, '운전자');
  const read = await detail(db);
  assert.deepEqual(read.payload.item.values, input.values);
  assert.deepEqual(read.payload.item.sources, input.sources);
  assert.equal(read.payload.item.note, input.note);
  assert.deepEqual(db.raw.prepare('SELECT * FROM shift_log_sessions ORDER BY token_hash').all(), sessionsBefore);
  assert.equal(db.raw.prepare('SELECT values_json FROM morning_meeting_snapshots').get().values_json, '{"protected":1}');
  assert.equal(db.raw.prepare('SELECT content_json FROM efficiency_daily_work_records').get().content_json, '{"protected":2}');
  assert.ok(db.writes.every(sql => sql.includes(TABLE)));
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).get().n, 1);
});

test('same-date creation conflicts and update preserves author while recording actual modifying login', async t => {
  const db = database(t);
  const first = (await call(db)).payload.item;
  const duplicate = await call(db, { token: 'second', body: packet({ note: '중복' }) });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.payload.currentVersion, 1);
  assert.equal(duplicate.payload.item.note, first.note);
  const updated = await call(db, { method: 'PUT', token: 'second', body: mutation(1, { note: '수정' }) });
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.version, 2);
  assert.equal(updated.payload.item.authorId, first.authorId);
  assert.equal(updated.payload.item.createdAt, first.createdAt);
  assert.equal(updated.payload.item.updatedByName, '수정자');
  const stale = await call(db, { method: 'PUT', body: mutation(1, { note: '옛 화면' }) });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.version, 2);
  assert.equal(stale.payload.item.note, '수정');
  assert.equal(stored(db).version, 2);
});

test('conditional SQL wins a concurrent modification race without overwriting the newer report', async t => {
  const db = database(t);
  await call(db);
  db.beforeMutation = () => db.raw.prepare(`UPDATE ${TABLE} SET version=version+1, note='다른 사용자가 먼저 저장' WHERE work_date=?`).run(DATE);
  const result = await call(db, { method: 'PUT', body: mutation(1, { note: '늦은 저장' }) });
  assert.equal(result.status, 409);
  assert.equal(result.payload.currentVersion, 2);
  assert.equal(stored(db).note, '다른 사용자가 먼저 저장');
});

test('deletion clears content, retains tombstone version and rejects stale creates, saves and deletes', async t => {
  const db = database(t);
  await call(db);
  const deleted = await call(db, { method: 'DELETE', body: { workDate: DATE, version: 1 } });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.payload, { ok: true, workDate: DATE, version: 2, deleted: true, item: null });
  const row = stored(db);
  assert.equal(row.values_json, '{}');
  assert.equal(row.sources_json, '{}');
  assert.equal(row.note, '');
  assert.ok(row.deleted_at);
  assert.deepEqual((await detail(db)).payload, deleted.payload);
  assert.equal((await call(db, { method: 'GET', query: '?month=2026-10' })).payload.items.length, 0);
  for (const options of [
    { body: packet() }, { method: 'PUT', body: mutation(1) },
    { method: 'DELETE', body: { workDate: DATE, version: 1 } },
    { method: 'DELETE', body: { workDate: DATE, version: 2 } }
  ]) {
    const result = await call(db, options);
    assert.equal(result.status, 409);
    assert.equal(result.payload.version, 2);
    assert.equal(result.payload.item, null);
    assert.equal(result.payload.deleted, true);
  }
  const restored = await call(db, { method: 'PUT', token: 'second', body: mutation(2, { note: '새로 작성' }) });
  assert.equal(restored.status, 200);
  assert.equal(restored.payload.version, 3);
  assert.equal(restored.payload.item.authorName, '수정자');
  assert.equal(restored.payload.deleted, false);
  const staleDelete = await call(db, { method: 'DELETE', body: { workDate: DATE, version: 1 } });
  assert.equal(staleDelete.status, 409);
  assert.equal(stored(db).note, '새로 작성');
});

test('delete uses version in SQL and cannot remove a concurrently edited report', async t => {
  const db = database(t);
  await call(db);
  db.beforeMutation = () => db.raw.prepare(`UPDATE ${TABLE} SET version=2 WHERE work_date=?`).run(DATE);
  const result = await call(db, { method: 'DELETE', body: { workDate: DATE, version: 1 } });
  assert.equal(result.status, 409);
  assert.equal(stored(db).deleted_at, null);
  assert.equal(stored(db).version, 2);
});

test('month archive is date-sorted, cursor-paginated, excludes other months and exposes full values only on bounded request', async t => {
  const db = database(t);
  for (const workDate of ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-11-01']) {
    assert.equal((await call(db, { body: packet({ workDate, sources: {} }) })).status, 200);
  }
  const first = (await call(db, { method: 'GET', query: '?month=2026-10&limit=2' })).payload;
  assert.deepEqual(first.items.map(item => item.workDate), ['2026-10-03', '2026-10-02']);
  assert.equal(first.nextBefore, '2026-10-02');
  assert.equal(first.items[0].filledCount, 3);
  assert.equal(Object.hasOwn(first.items[0], 'values'), false);
  const second = (await call(db, { method: 'GET', query: '?month=2026-10&limit=2&before=' + first.nextBefore })).payload;
  assert.deepEqual(second.items.map(item => item.workDate), ['2026-10-01']);
  assert.equal(second.nextBefore, null);
  const complete = (await call(db, { method: 'GET', query: '?month=2026-10&includeValues=1' })).payload;
  assert.equal(complete.items.length, 3);
  assert.deepEqual(complete.items[0].values, packet().values);
  assert.equal((await call(db, { method: 'GET', query: '?includeValues=1' })).status, 400);
  assert.equal((await detail(db, '2026-10-04')).payload.item, null);
});

test('invalid, expired and inactive logins cannot read, modify or create schema', async t => {
  const db = database(t);
  for (const token of ['', 'unknown', 'disabled', 'expired', 'invalid-expiry']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const result = await call(db, { token, method, query: '?date=' + DATE, body: mutation(1) });
      assert.equal(result.status, 401, `${token}/${method}`);
    }
  }
  assert.deepEqual(db.writes, []);
});

test('atomic login guard blocks create/update/delete when authentication is revoked during the request', async t => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const revoke of ['session', 'inactive', 'expired']) {
      await t.test(method + ' ' + revoke, async sub => {
        const db = database(sub);
        if (method !== 'POST') await call(db);
        const before = method === 'POST' ? null : stored(db);
        db.beforeMutation = () => {
          if (revoke === 'session') db.raw.prepare('DELETE FROM shift_log_sessions WHERE token_hash=?').run(hash('valid'));
          if (revoke === 'inactive') db.raw.prepare('UPDATE users SET is_active=0 WHERE employee_no=?').run('1000001');
          if (revoke === 'expired') db.raw.prepare("UPDATE shift_log_sessions SET expires_at='2020-01-01' WHERE token_hash=?").run(hash('valid'));
        };
        const result = await call(db, { method, body: method === 'DELETE' ? { workDate: DATE, version: 1 } : mutation(method === 'POST' ? 0 : 1) });
        assert.equal(result.status, 401);
        if (before) assert.deepEqual(stored(db), before);
        else assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).get().n, 0);
      });
    }
  }
});

test('calendar validation rejects rollover dates and accepts leap days without selecting a different date', async t => {
  const db = database(t);
  for (const date of ['2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-10-00', '2026-10-1', '2026-10-17 ', '1999-12-31']) {
    assert.equal((await detail(db, date)).status, 400, date);
    assert.equal((await call(db, { body: packet({ workDate: date, sources: {} }) })).status, 400, date);
  }
  assert.equal((await call(db, { body: packet({ workDate: '2028-02-29', sources: {} }) })).status, 200);
  for (const query of ['?month=2026-13', '?month=2026-1', '?limit=0', '?limit=201', '?limit=2abc', '?before=2026-02-29']) {
    assert.equal((await call(db, { method: 'GET', query })).status, 400, query);
  }
});

test('write validation rejects nested values, non-finite numbers, unsafe fields, wrong source dates and forged metadata', async t => {
  const db = database(t);
  const bad = [
    packet({ values: [] }), packet({ values: { value: {} } }), packet({ values: { value: true } }),
    packet({ values: { value: 'x'.repeat(2001) } }), packet({ values: { value: 1e16 } }),
    packet({ values: Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['f' + i, i])) }),
    packet({ values: { constructor: 1 } }), packet({ values: { 'not safe': 1 } }),
    packet({ sources: { missing: { source: 'manual' } } }), packet({ sources: { generation_u1_day: [] } }),
    packet({ sources: { generation_u1_day: { source: 'manual', date: '2026-10-18' } } }),
    packet({ sources: { generation_u1_day: { source: 'manual', sourceDate: '2026-02-29' } } }),
    packet({ sources: { generation_u1_day: { source: 'manual', updatedAt: 'bad' } } }),
    packet({ sources: { generation_u1_day: { source: 'manual', unknown: 'x' } } }),
    packet({ sources: { generation_u1_day: {} } }), packet({ authorId: 'spoofed' }),
    packet({ schemaVersion: 2 }), packet({ version: '0' }), packet({ note: 'x'.repeat(10001) }),
    packet({ values: { value: '\u0000' } })
  ];
  for (const body of bad) assert.equal((await call(db, { body })).status, 400, JSON.stringify(body).slice(0, 100));
  assert.equal((await call(db, { body: '{"workDate":"2026-10-17","version":0,"values":{"a":1e999}}' })).status, 400);
  assert.equal((await call(db, { body: '{"workDate":"2026-10-17","version":0,"values":{"__proto__":4}}' })).status, 400);
  assert.deepEqual(db.writes, []);
});

test('malformed, oversized and cross-origin JSON never mutates reports', async t => {
  const db = database(t);
  for (const body of ['', '{', '[]', 'null']) assert.equal((await call(db, { body })).status, 400);
  assert.equal((await call(db, { body: ' '.repeat(128 * 1024 + 1) })).status, 413);
  assert.equal((await call(db, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call(db, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await call(db, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.deepEqual(db.writes, []);
  assert.equal((await call(db, { headers: { Origin: 'https://gs.example' } })).status, 200);
});

test('write method versions are explicit and missing-date updates or deletes cannot create a record', async t => {
  const db = database(t);
  for (const version of [null, undefined, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.equal((await call(db, { body: packet({ version }) })).status, 400);
  }
  assert.equal((await call(db, { body: mutation(1) })).status, 400);
  assert.equal((await call(db, { method: 'PUT', body: mutation(0) })).status, 400);
  assert.equal((await call(db, { method: 'DELETE', body: { workDate: DATE, version: 0 } })).status, 400);
  const missingDelete = await call(db, { method: 'DELETE', body: { workDate: DATE, version: 1 } });
  assert.equal(missingDelete.status, 409);
  assert.deepEqual(db.writes, []);
  const missingUpdate = await call(db, { method: 'PUT', body: mutation(1) });
  assert.equal(missingUpdate.status, 409);
  assert.equal(missingUpdate.payload.version, 0);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).get().n, 0);
});
