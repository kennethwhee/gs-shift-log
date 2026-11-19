import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import * as legacyLogs from '../functions/api/legacy-logs.js';

// First-screen request reduction (2026-11-20):
// 1. GET /api/legacy-logs?from&to returns many dates in one request.
// 2. script.js loads search/ARM ROLL BOX ranges in 31-day windows and falls back to per-date calls.
// 3. assets/api-request-dedupe-v1.js shares duplicate startup GETs.

const hash = value => createHash('sha256').update(value).digest('hex');
const ROLES = ['파트장', 'TGO', 'BCO1', 'BCO2', 'TO', 'BO1', 'BO2'];
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

function addDays(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function legacyDatabase(t, { firstDay = '2026-11-06', days = 15 } = {}) {
  const raw = new DatabaseSync(':memory:');
  t.after(() => raw.close());
  raw.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, employee_no TEXT UNIQUE, name TEXT, password_hash TEXT, role TEXT, is_active INTEGER, approved_at TEXT, approved_by TEXT, created_at TEXT, last_login_at TEXT);
    CREATE TABLE employees (employee_no TEXT PRIMARY KEY, name TEXT, default_role TEXT, position TEXT, is_allowed INTEGER);
    CREATE TABLE shift_log_sessions (token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT, created_at TEXT, last_used_at TEXT);
    CREATE TABLE legacy_logs (id INTEGER PRIMARY KEY, legacy_diary_id TEXT, work_date TEXT, shift TEXT, role TEXT, author TEXT, writer_id TEXT, status TEXT, operation_status TEXT, entries_json TEXT, original_json TEXT, legacy_position TEXT, legacy_version TEXT, source_updated_at TEXT, imported_at TEXT, updated_at TEXT);
    CREATE TABLE legacy_attachments (id INTEGER PRIMARY KEY, legacy_diary_id TEXT, file_name TEXT, original_url TEXT, r2_key TEXT, mime_type TEXT, file_size INTEGER, uploaded_at TEXT);
  `);
  raw.prepare('INSERT INTO users(employee_no,name,role,is_active,password_hash) VALUES(?,?,?,?,?)').run('9000002', '검토 직원', 'user', 1, 'unchanged-hash');
  raw.prepare('INSERT INTO employees VALUES(?,?,?,?,?)').run('9000002', '검토 직원', 'user', 'BO1', 1);
  raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?,?)').run(hash('user-token'), '9000002', '2099-01-01', '', '');
  const insertLog = raw.prepare(`INSERT INTO legacy_logs(legacy_diary_id,work_date,shift,role,author,writer_id,status,operation_status,entries_json,original_json,legacy_position,legacy_version,source_updated_at,imported_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'[]','{}','','','','','')`);
  const insertAttachment = raw.prepare('INSERT INTO legacy_attachments(legacy_diary_id,file_name,original_url,r2_key,mime_type,file_size,uploaded_at) VALUES(?,?,?,?,?,?,?)');
  // Insert in reverse role order so the API's ORDER BY is what puts 파트장 first.
  for (let day = 0; day < days; day += 1) {
    const date = addDays(firstDay, day);
    for (const shift of ['DS', 'NS']) {
      for (const role of [...ROLES].reverse()) {
        const diaryId = `diary-${date}-${shift}-${role}`;
        insertLog.run(diaryId, date, shift, role, '작성자', 'writer', '결재완료', '');
        insertAttachment.run(diaryId, '점검표.pdf', '', `legacy/${diaryId}.pdf`, 'application/pdf', 10, '');
      }
    }
  }
  const statements = [];
  const db = {
    raw,
    statements,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async all() { statements.push({ sql, args }); return { results: raw.prepare(sql).all(...args) }; },
        async first() { statements.push({ sql, args }); return raw.prepare(sql).get(...args) || null; },
        async run() { statements.push({ sql, args }); const result = raw.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; }
      };
    },
    async batch(list) { const results = []; for (const statement of list) results.push(await statement.run()); return results; }
  };
  return db;
}

async function getLegacy(db, query, token = 'user-token') {
  const response = await legacyLogs.onRequestGet({
    env: { DB: db, ATTACHMENTS: { async get() { return null; } } },
    request: new Request('https://review.invalid/api/legacy-logs?' + query, {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    }),
    waitUntil(task) { task?.catch?.(() => {}); }
  });
  return { status: response.status, body: await response.json() };
}

test('legacy-logs returns a whole date range in one ordered, suppression-aware response', async t => {
  const db = legacyDatabase(t);
  const { status, body } = await getLegacy(db, 'from=2026-11-06&to=2026-11-20');
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.from, '2026-11-06');
  assert.equal(body.to, '2026-11-20');
  assert.equal(body.items.length, 15 * 2 * ROLES.length);

  const dates = body.items.map(item => item.date);
  assert.deepEqual(dates, [...dates].sort(), 'dates are ascending');
  for (const date of new Set(dates)) {
    const roleOrder = body.items.filter(item => item.date === date).map(item => ROLES.indexOf(item.role));
    assert.deepEqual(roleOrder, [...roleOrder].sort((a, b) => a - b), `${date} keeps the per-date role order`);
  }

  // 210 diaries need more than one attachment query; every statement stays under D1's 100 bindings.
  assert.ok(body.items.every(item => item.attachments.length === 1), 'every log keeps its attachment');
  const attachmentQueries = db.statements.filter(entry => /FROM legacy_attachments/.test(entry.sql));
  assert.ok(attachmentQueries.length >= 3);
  assert.ok(db.statements.every(entry => entry.args.length <= 100), 'no statement binds more than 100 values');

  // A suppressed (user-deleted) synced log disappears from range results too.
  db.raw.prepare(`INSERT INTO legacy_log_suppressions(legacy_diary_id,work_date,shift,role,deleted_at) VALUES(?,?,?,?,?)`)
    .run('diary-2026-11-10-DS-TGO', '2026-11-10', 'DS', 'TGO', 'now');
  const suppressed = await getLegacy(db, 'from=2026-11-06&to=2026-11-20');
  assert.equal(suppressed.body.items.length, 15 * 2 * ROLES.length - 1);
  assert.ok(!suppressed.body.items.some(item => item.legacyDiaryId === 'diary-2026-11-10-DS-TGO'));
});

test('a date taken from the range matches the single-date response exactly', async t => {
  const db = legacyDatabase(t);
  const range = await getLegacy(db, 'from=2026-11-06&to=2026-11-20');
  const single = await getLegacy(db, 'date=2026-11-11');
  assert.equal(single.status, 200);
  assert.deepEqual(range.body.items.filter(item => item.date === '2026-11-11'), single.body.items);
  const nightOnly = await getLegacy(db, 'from=2026-11-06&to=2026-11-20&shift=NS');
  assert.equal(nightOnly.body.items.length, 15 * ROLES.length);
  assert.ok(nightOnly.body.items.every(item => item.shift === 'NS'));
});

test('range requests are validated, limited to 62 days and still require a session', async t => {
  const db = legacyDatabase(t, { firstDay: '2026-09-01', days: 2 });
  for (const query of ['from=2026-11-20&to=2026-11-06', 'from=2026-02-30&to=2026-03-02', 'from=2026-11-06', 'to=2026-11-06', 'from=20261106&to=20261120']) {
    assert.equal((await getLegacy(db, query)).status, 400, query);
  }
  assert.equal((await getLegacy(db, 'from=2026-09-01&to=2026-11-02')).status, 400, '63 days is too long');
  assert.equal((await getLegacy(db, 'from=2026-09-01&to=2026-11-01')).status, 200, '62 days is allowed');
  assert.equal((await getLegacy(db, 'from=2026-09-01&to=2026-09-02', '')).status, 401);
  assert.equal((await getLegacy(db, 'from=2026-09-01&to=2026-09-02', 'wrong-token')).status, 401);
});

test('the suppression table DDL runs once per database binding instead of on every request', async t => {
  const db = legacyDatabase(t);
  for (let index = 0; index < 4; index += 1) {
    assert.equal((await getLegacy(db, 'date=2026-11-11')).status, 200);
  }
  assert.equal((await getLegacy(db, 'from=2026-11-06&to=2026-11-08')).status, 200);
  const ddl = db.statements.filter(entry => /CREATE (TABLE|INDEX) IF NOT EXISTS/.test(entry.sql));
  assert.equal(ddl.length, 2, 'one CREATE TABLE and one CREATE INDEX for this binding');
});

// ---------------------------------------------------------------- script.js range loader

function extractFunction(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(declaration, `${name} is missing from script.js`);
  const bodyStart = source.indexOf('{', source.indexOf(')', declaration.index));
  const stack = [];
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    const top = stack[stack.length - 1];
    if (top === '`') {
      if (character === '\\') { index += 1; continue; }
      if (character === '`') { stack.pop(); continue; }
      if (character === '$' && next === '{') { stack.push('${'); index += 1; }
      continue;
    }
    if (top === '"' || top === "'") {
      if (character === '\\') { index += 1; continue; }
      if (character === top) stack.pop();
      continue;
    }
    if (character === '/' && next === '/') { index = source.indexOf('\n', index); continue; }
    if (character === '/' && next === '*') { index = source.indexOf('*/', index + 2) + 1; continue; }
    if (character === '"' || character === "'" || character === '`') { stack.push(character); continue; }
    if (character === '{') { stack.push('{'); continue; }
    if (character === '}') {
      const opened = stack.pop();
      if (opened === '{' && stack.length === 0) return source.slice(declaration.index, index + 1);
    }
  }
  throw new Error(`${name} body is not closed`);
}

const rangeLoaderSource = ['formatInputDate', 'createSearchDateRange', 'loadLegacyLogsForSearchRange',
  'requestLegacyLogsDateRangeV1', 'loadLegacyLogsSearchWindowV1', 'loadLegacyLogsSearchDatesOneByOneV1']
  .map(name => extractFunction(read('script.js'), name)).join('\n');

function rangeLoader(respond) {
  const calls = { requests: [], loads: [] };
  const context = vm.createContext({
    console: { warn() {}, error() {}, log() {} },
    window: { location: { origin: 'https://review.invalid' } },
    URL,
    getShiftLogAuthHeaders: headers => ({ ...headers, Authorization: 'Bearer review' }),
    async fetchShiftLogWithTimeout(url) {
      const parsed = new URL(url);
      calls.requests.push(Object.fromEntries(parsed.searchParams));
      return respond(parsed);
    },
    async loadLegacyLogsForSearchDate(date, prefetched) {
      calls.loads.push({ date, prefetched: Array.isArray(prefetched) ? prefetched.map(item => item.id) : null });
      return Array.isArray(prefetched)
        ? prefetched.map(item => ({ id: item.id, date }))
        : [{ id: 'per-date-' + date, date }];
    }
  });
  vm.runInContext(rangeLoaderSource, context);
  return { context, calls };
}

const rangeOk = parsed => {
  const from = parsed.searchParams.get('from');
  const to = parsed.searchParams.get('to');
  const items = [];
  for (let date = from; date <= to; date = addDays(date, 1)) items.push({ id: 'log-' + date, date });
  items.push({ id: 'outside', date: '2025-01-01' });
  return { ok: true, async json() { return { success: true, from, to, items }; } };
};

test('the ARM ROLL BOX 15-day window is one range request converted date by date in order', async () => {
  const { context, calls } = rangeLoader(rangeOk);
  const logs = await context.loadLegacyLogsForSearchRange('2026-11-06', '2026-11-20');
  assert.deepEqual(calls.requests, [{ from: '2026-11-06', to: '2026-11-20' }]);
  assert.equal(calls.loads.length, 15);
  assert.ok(calls.loads.every(load => Array.isArray(load.prefetched)), 'no per-date requests');
  // Arrays built inside the vm context are copied so strict deep equality compares values only.
  assert.deepEqual(Array.from(logs, log => log.id), calls.loads.map(load => 'log-' + load.date));
  assert.ok(!logs.some(log => log.id === 'outside'), 'items outside the window are ignored');
});

test('long searches are split into 31-day range requests', async () => {
  const { context, calls } = rangeLoader(rangeOk);
  await context.loadLegacyLogsForSearchRange('2026-11-01', '2026-12-10');
  assert.deepEqual(calls.requests, [{ from: '2026-11-01', to: '2026-12-01' }, { from: '2026-12-02', to: '2026-12-10' }]);
  assert.equal(calls.loads.length, 40);
});

test('a failed or unsupported range request falls back to the previous per-date loading', async () => {
  const failures = [
    () => ({ ok: false, async json() { return { success: false }; } }),
    () => ({ ok: true, async json() { return { success: true, date: '2026-11-06', items: [] }; } }),
    () => { throw new Error('network down'); },
    () => ({ ok: true, async json() { throw new Error('not json'); } })
  ];
  for (const failure of failures) {
    const { context, calls } = rangeLoader(failure);
    const logs = await context.loadLegacyLogsForSearchRange('2026-11-06', '2026-11-08');
    assert.equal(calls.requests.length, 1);
    assert.deepEqual(calls.loads.map(load => load.prefetched), [null, null, null]);
    assert.deepEqual(Array.from(logs, log => log.id), ['per-date-2026-11-06', 'per-date-2026-11-07', 'per-date-2026-11-08']);
  }
});

test('the single-date loader accepts prefetched range items and skips its own request', () => {
  const source = extractFunction(read('script.js'), 'loadLegacyLogsForSearchDate');
  assert.match(source, /async function loadLegacyLogsForSearchDate\(\s*searchDate,\s*prefetchedDateItems = null\s*\)/);
  assert.match(source, /Array\.isArray\(\s*prefetchedDateItems\s*\)/);
  assert.ok(source.indexOf('fetchShiftLogWithTimeout') > source.indexOf('prefetchedDateItems\n'), 'the request only runs without prefetched items');
});

// ---------------------------------------------------------------- startup GET sharing

function dedupeHarness() {
  let clock = 1_000_000;
  const timers = [];
  const native = [];
  class FakeDate extends Date { static now() { return clock; } }
  const window = {
    location: { href: 'https://review.invalid/', origin: 'https://review.invalid' },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    async fetch(input, init = {}) {
      native.push({ url: String(input), init });
      const url = new URL(String(input), 'https://review.invalid/');
      if (init.method && init.method !== 'GET') return new Response('{}', { status: 200 });
      const status = url.searchParams.get('status') ? Number(url.searchParams.get('status')) : 200;
      await new Promise(resolve => setImmediate(resolve));
      return new Response(JSON.stringify({ n: native.length, path: url.pathname }), { status, headers: { 'Content-Type': 'application/json' } });
    }
  };
  const context = vm.createContext({ window, Date: FakeDate, URL, URLSearchParams, Headers, Request, Response, DOMException, Promise, Map, Set });
  vm.runInContext(read('assets/api-request-dedupe-v1.js'), context);
  return { window, native, timers, advance(ms) { clock += ms; } };
}

const auth = token => ({ headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });

test('identical startup GETs share one request even with different cache-busting _ values', async () => {
  const h = dedupeHarness();
  const url = '/api/ois-data-requests?action=completed_history&startDate=2026-11-20&endDate=2026-11-20';
  const [first, second] = await Promise.all([h.window.fetch(url + '&_=1', auth('a')), h.window.fetch(url + '&_=2', auth('a'))]);
  assert.equal(h.native.length, 1);
  assert.deepEqual(await first.json(), await second.json());
  // Reused for 5 seconds after completion, then fetched again.
  h.advance(4000);
  await (await h.window.fetch(url, auth('a'))).text();
  assert.equal(h.native.length, 1);
  h.advance(1500);
  await (await h.window.fetch(url, auth('a'))).text();
  assert.equal(h.native.length, 2);
});

test('only allow-listed reads from the same session are shared', async () => {
  const h = dedupeHarness();
  const weather = '/api/weather-forecast?action=history&startDate=2026-11-21&endDate=2026-11-21';
  await Promise.all([h.window.fetch(weather, auth('a')), h.window.fetch(weather, auth('b'))]);
  assert.equal(h.native.length, 2, 'different sessions never share');
  await Promise.all([h.window.fetch('/api/shift-logs', auth('a')), h.window.fetch('/api/shift-logs', auth('a'))]);
  assert.equal(h.native.length, 4, 'non-listed paths are untouched');
  const claim = '/api/ois-data-requests?action=claim';
  await Promise.all([h.window.fetch(claim, auth('a')), h.window.fetch(claim, auth('a'))]);
  assert.equal(h.native.length, 6, 'non-listed Agent actions are untouched');
});

test('any API write clears shared responses so a later read is fresh', async () => {
  const h = dedupeHarness();
  const url = '/api/morning-meeting-boiler-snapshot?date=2026-11-20';
  await (await h.window.fetch(url, auth('a'))).text();
  await h.window.fetch('/api/morning-meeting-boiler-snapshot', { method: 'POST', ...auth('a'), body: '{}' });
  await (await h.window.fetch(url, auth('a'))).text();
  assert.equal(h.native.filter(call => !call.init.method || call.init.method === 'GET').length, 2);
});

test('failed responses are not reused and sharing stops after the startup window', async () => {
  const h = dedupeHarness();
  const failing = '/api/legacy-logs?date=2026-11-19&status=500';
  await (await h.window.fetch(failing, auth('a'))).text();
  await (await h.window.fetch(failing, auth('a'))).text();
  assert.equal(h.native.length, 2);
  h.advance(15000);
  const url = '/api/legacy-logs?date=2026-11-18';
  await Promise.all([h.window.fetch(url, auth('a')), h.window.fetch(url, auth('a'))]);
  assert.equal(h.native.length, 4, 'after 15 seconds every call goes to the network');
  assert.ok(h.timers.some(timer => timer.ms === 20000), 'shared responses are released after the window');
});

test('aborting one caller rejects only that caller and never cancels the shared request', async () => {
  const h = dedupeHarness();
  const url = '/api/weather-forecast?action=history&startDate=2026-11-21&endDate=2026-11-21';
  const controller = new AbortController();
  const aborted = h.window.fetch(url, { ...auth('a'), signal: controller.signal });
  const kept = h.window.fetch(url, auth('a'));
  controller.abort();
  await assert.rejects(aborted, error => error.name === 'AbortError');
  assert.equal((await (await kept).json()).path, '/api/weather-forecast');
  assert.equal(h.native.length, 1);
  assert.equal(h.native[0].init.signal, undefined, 'the network request does not carry a caller signal');
});

test('index.html installs the request sharing before any other script', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => match[0]);
  assert.match(scripts[0], /src="assets\/api-request-dedupe-v1\.js\?v=[^"]+"/);
  assert.doesNotMatch(scripts[0], /\b(?:defer|async|type\s*=)/, 'it must run synchronously before modules');
});
