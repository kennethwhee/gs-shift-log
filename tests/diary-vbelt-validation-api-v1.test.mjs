import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { onRequestPost as saveDiary } from '../functions/api/shift-logs.js';
import { onRequestGet as readBlowers } from '../functions/api/blower-history.js';

const CONTENT = '#1 FBHE Blower #A V-Belt 교체 완료';
const TAG = '104HHL60AP611';
const OTHER_TAG = '204HHL60AP611';
const DISABLED_TAG = '104HHL60AP621';
const hash = value => createHash('sha256').update(value).digest('hex');
const annotation = (confirmed = true, target = {}) => ({
  version: 1, confirmed, content: CONTENT,
  targets: confirmed ? [{tagNumber: TAG, replacedOn: '2020-01-02', completedTime: '09:15', ...target}] : [],
});
const entry = (confirmed = true) => ({id: 'entry-1', time: '09:15', content: CONTENT,
  vBeltReplacement: annotation(confirmed)});
const diary = (overrides = {}) => ({id: 'diary-1', date: '2020-01-02', shift: 'DS', role: 'TO',
  team: '가', status: '임시저장', entries: [entry()], ...overrides});

function fixture(t) {
  const raw = new DatabaseSync(':memory:');
  // Only the real routes' storage/auth columns are installed. In particular,
  // no Blower settings, event, runtime, migration, or schema-ready tables exist.
  raw.exec(`
    CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE employees(employee_no TEXT PRIMARY KEY,default_role TEXT,position TEXT);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
    CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,team TEXT,author TEXT,
      author_id TEXT,author_role TEXT,status TEXT,log_json TEXT,revision INTEGER,created_at TEXT,updated_at TEXT,
      last_modified_by TEXT,last_modified_by_id TEXT);
    CREATE TABLE shift_log_attachments(id TEXT PRIMARY KEY,log_id TEXT);
    CREATE TABLE blower_history_assets(tag_number TEXT PRIMARY KEY,blower_type TEXT,unit_no TEXT,
      asset_group TEXT,position_label TEXT,display_name TEXT,enabled INTEGER,sort_order INTEGER);
  `);
  for (const [token, id, role, active, expires] of [
    ['author-token', '9100001', 'user', 1, '2099-01-01'],
    ['admin-token', '9100002', 'super_admin', 1, '2099-01-01'],
    ['expired-token', '9100003', 'user', 1, '2000-01-01'],
    ['disabled-token', '9100004', 'user', 0, '2099-01-01'],
    ['malformed-token', '9100005', 'user', 1, 'invalid'],
  ]) {
    raw.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id, '시험 작성자', role, active);
    raw.prepare('INSERT INTO employees VALUES(?,?,?)').run(id, role, 'TO');
    // A deliberately old timestamp makes accidental session-touch writes visible.
    raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(hash(token), id, expires, '2000-01-01');
  }
  for (const [tag, unit, enabled, order] of [[TAG, '1', 1, 2], [OTHER_TAG, '2', 1, 1], [DISABLED_TAG, '1', 0, 0]]) {
    raw.prepare('INSERT INTO blower_history_assets VALUES(?,?,?,?,?,?,?,?)')
      .run(tag, 'fbhe', unit, '', 'A', `시험 FBHE ${unit}`, enabled, order);
  }
  const db = {raw, queries: [], writes: [],
    prepare(sql) {
      db.queries.push(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return raw.prepare(sql).get(...args) || null; },
        async all() { return {success: true, results: raw.prepare(sql).all(...args)}; },
        async run() {
          db.writes.push({sql, args});
          const result = raw.prepare(sql).run(...args);
          return {success: true, meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}};
        },
      };
    },
    async batch(statements) {
      raw.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        raw.exec('COMMIT');
        return result;
      } catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  };
  const pending = [];
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { networkCalls++; throw new Error('Unexpected test network request'); });
  // Unrelated inspection synchronization deliberately has no tables/configuration
  // in this minimal fixture; its ordinary best-effort errors are not the subject.
  t.mock.method(console, 'error', () => {});
  t.after(async () => { await Promise.allSettled(pending); raw.close(); assert.equal(networkCalls, 0); });
  const context = (path, {token = 'author-token', method = 'GET', body} = {}) => ({
    env: {DB: db},
    request: new Request(`https://fixture.invalid/api/${path}`, {
      method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    }),
    waitUntil(promise) { pending.push(promise); },
  });
  return {db, raw,
    async save(log, {action = 'save', token = 'author-token', expectedRevision = log.serverRevision || 0} = {}) {
      const response = await saveDiary(context('shift-logs', {method: 'POST', token, body: {action, log, expectedRevision}}));
      await Promise.allSettled(pending);
      return {status: response.status, body: await response.json()};
    },
    async assets(token = 'author-token') {
      const response = await readBlowers(context('blower-history?action=replacement_assets', {token}));
      return {status: response.status, body: await response.json()};
    },
    stored(id = 'diary-1') { const row = raw.prepare('SELECT * FROM shift_logs WHERE id=?').get(id); return row && {...row, log: JSON.parse(row.log_json)}; },
  };
}

test('real diary create/update round-trips true and false in every entry collection', async t => {
  const f = fixture(t);
  const log = diary({tmEntries: [{...entry(false), id: 'entry-2'}],
    handoverEntries: [{...entry(), id: 'entry-3'}], remarkEntries: [{...entry(false), id: 'entry-4'}]});
  let saved = await f.save(log);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  for (const section of ['entries', 'tmEntries', 'handoverEntries', 'remarkEntries']) {
    assert.deepEqual(saved.body.log[section][0].vBeltReplacement, log[section][0].vBeltReplacement);
    assert.deepEqual(f.stored().log[section][0].vBeltReplacement, log[section][0].vBeltReplacement);
  }
  const next = structuredClone(saved.body.log);
  next.entries[0].vBeltReplacement = annotation(false);
  next.tmEntries[0].vBeltReplacement = annotation(true);
  saved = await f.save(next);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.log.serverRevision, 2);
  assert.equal(f.stored().log.entries[0].vBeltReplacement.confirmed, false);
  assert.deepEqual(f.stored().log.entries[0].vBeltReplacement.targets, []);
  assert.equal(f.stored().log.tmEntries[0].vBeltReplacement.confirmed, true);
});

for (const previous of [false, true]) test(`older-client omission preserves a controlled unchecked marker after ${previous}`, async t => {
  const f = fixture(t);
  const first = await f.save(diary({entries: [entry(previous), {id: 'legacy-unannotated', content: CONTENT}]}));
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const next = structuredClone(first.body.log);
  delete next.entries[0].vBeltReplacement;
  const saved = await f.save(next);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.log.entries[0].vBeltReplacement, annotation(false));
  assert.equal(Object.hasOwn(saved.body.log.entries[1], 'vBeltReplacement'), false);
  assert.deepEqual(f.stored().log.entries, saved.body.log.entries);
});

for (const [name, patch, code] of [
  ['future completion date', a => { a.targets[0].replacedOn = '2098-12-31'; }, 'VBELT_CONFIRMATION_FUTURE'],
  ['unregistered equipment', a => { a.targets[0].tagNumber = '104HHL60AP999'; }, 'VBELT_CONFIRMATION_TARGET_INVALID'],
  ['disabled equipment', a => { a.targets[0].tagNumber = DISABLED_TAG; }, 'VBELT_CONFIRMATION_TARGET_INVALID'],
  ['string boolean', a => { a.confirmed = 'false'; }, 'VBELT_CONFIRMATION_INVALID'],
  ['numeric boolean', a => { a.confirmed = 1; }, 'VBELT_CONFIRMATION_INVALID'],
  ['null boolean', a => { a.confirmed = null; }, 'VBELT_CONFIRMATION_INVALID'],
]) test(`real diary POST rejects ${name} before writing a diary`, async t => {
  const f = fixture(t), log = diary();
  patch(log.entries[0].vBeltReplacement);
  const response = await f.save(log);
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.equal(response.body.code, code);
  assert.equal(f.stored(), undefined);
  assert.ok(f.db.writes.every(({sql}) => /UPDATE\s+shift_log_sessions/i.test(sql)), 'only the existing auth touch may write');
});

test('rejected annotation edit keeps the stored body and revision intact', async t => {
  const f = fixture(t), first = await f.save(diary({entries: [entry(false)]}));
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const before = f.stored(), next = structuredClone(first.body.log);
  next.entries[0].vBeltReplacement = annotation(true, {tagNumber: '104HHL60AP999'});
  const response = await f.save(next);
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.equal(response.body.code, 'VBELT_CONFIRMATION_TARGET_INVALID');
  assert.deepEqual(f.stored(), before);
});

for (const confirmed of [true, false]) test(`approval ignores submitted body tampering and retains saved ${confirmed} metadata`, async t => {
  const f = fixture(t);
  const first = await f.save(diary({status: '결재요청', entries: [entry(confirmed)]}));
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const submitted = structuredClone(first.body.log);
  submitted.entries[0].content = '승인 요청에 삽입한 다른 본문';
  submitted.entries[0].vBeltReplacement = {version: 1, confirmed: 'false', content: submitted.entries[0].content};
  const approved = await f.save(submitted, {action: 'approve', token: 'admin-token'});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.log.status, '결재완료');
  assert.deepEqual(approved.body.log.entries, first.body.log.entries);
  assert.deepEqual(f.stored().log.entries, first.body.log.entries);
  assert.equal(f.stored().revision, 2);
});

test('authenticated replacement asset picker uses SELECT only without schema setup or stale-session touch', async t => {
  const f = fixture(t);
  const sessions = f.raw.prepare('SELECT * FROM shift_log_sessions ORDER BY token_hash').all();
  const schema = f.raw.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  const response = await f.assets();
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.ok, true);
  assert.deepEqual(response.body.assets.map(asset => asset.tagNumber), [OTHER_TAG, TAG]);
  assert.ok(response.body.assets.every(asset => Object.keys(asset).sort().join(',') ===
    ['tagNumber', 'equipmentName', 'displayName', 'blowerType', 'unitNo', 'assetGroup', 'positionLabel'].sort().join(',')));
  assert.equal(f.db.writes.length, 0);
  assert.ok(f.db.queries.every(sql => /^\s*SELECT\b/i.test(sql)), f.db.queries.join('\n'));
  assert.equal(f.db.queries.length, 2, 'one auth SELECT and one asset SELECT, without migration/readiness probes');
  assert.deepEqual(f.raw.prepare('SELECT * FROM shift_log_sessions ORDER BY token_hash').all(), sessions);
  assert.deepEqual(f.raw.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), schema);
});

for (const token of ['', 'unknown-token', 'expired-token', 'disabled-token', 'malformed-token']) {
  test(`replacement asset picker rejects ${token || 'anonymous'} without DB writes or asset disclosure`, async t => {
    const f = fixture(t), sessions = f.raw.prepare('SELECT * FROM shift_log_sessions ORDER BY token_hash').all();
    const response = await f.assets(token);
    assert.equal(response.status, 401, JSON.stringify(response.body));
    assert.equal(response.body.assets, undefined);
    assert.equal(f.db.writes.length, 0);
    assert.ok(f.db.queries.every(sql => /^\s*SELECT\b/i.test(sql)));
    assert.ok(f.db.queries.every(sql => !/FROM\s+blower_history_assets/i.test(sql)));
    assert.deepEqual(f.raw.prepare('SELECT * FROM shift_log_sessions ORDER BY token_hash').all(), sessions);
  });
}
