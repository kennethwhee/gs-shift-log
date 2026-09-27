'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the real authentication/transport functions without requiring a DOM
// package. Mounted form, archive and conflict flows are also browser-checked.
const source = fs.readFileSync(path.join(__dirname,
  '../inspection-logs/weekly/soot-blower/soot-blower-weekly.js'), 'utf8');
const authStart = source.indexOf('  function loadStoredUser()');
const authEnd = source.indexOf('    Soot Blower 주간점검 일정 자동 연동', authStart);
assert.ok(authStart >= 0 && authEnd > authStart, 'authentication section exists');
const authSource = source.slice(authStart,
  source.lastIndexOf('  /*', authEnd));
const endpoint = '/api/inspection-logs/soot-blower-weekly';

function fixture({ stored = JSON.stringify({sessionToken: 'session-a'}), failStorage = false,
  respond = () => Response.json({ok: true, log: null}) } = {}) {
  const calls = [];
  const context = vm.createContext({
    SOOT_CURRENT_USER_STORAGE_KEY: 'gsShiftLog.currentUser',
    normalizeText: value => String(value ?? '').trim(),
    console: {warn() {}}, Headers,
    localStorage: {getItem(key) {
      assert.equal(key, 'gsShiftLog.currentUser');
      if (failStorage) throw new Error('storage blocked');
      return stored;
    }},
    fetch: async (url, options) => {
      calls.push({url, options});
      return respond(url, options);
    }
  });
  vm.runInContext(authSource, context);
  return {calls, request: context.requestApi, setStored(value) { stored = value; }};
}

test('authenticated date lookup passes the exact date and server record', async () => {
  const log = {id: 'record-a', inspectionDate: '2026-09-27', serverRevision: 4};
  const h = fixture({respond: () => Response.json({ok: true, log})});
  const result = await h.request(endpoint + '?date=2026-09-27');
  assert.deepEqual(result.log, log);
  assert.equal(h.calls[0].url, endpoint + '?date=2026-09-27');
  assert.equal(h.calls[0].options.headers.get('Authorization'), 'Bearer session-a');
  assert.equal(h.calls[0].options.headers.get('Accept'), 'application/json');
});

test('save and delete retain JSON bodies and revision guards with either header format', async () => {
  const h = fixture({respond: () => Response.json({ok: true})});
  for (const method of ['POST', 'DELETE']) {
    const body = JSON.stringify({id: 'record-a', expectedRevision: 7});
    const headers = method === 'POST'
      ? {'Content-Type': 'application/json', authorization: 'Bearer stale'}
      : new Headers({'Content-Type': 'application/json', 'X-Request-ID': 'fixture'});
    await h.request(endpoint, {method, headers, body});
    const request = h.calls.at(-1).options;
    assert.equal(request.method, method);
    assert.equal(request.body, body);
    assert.equal(request.headers.get('Content-Type'), 'application/json');
    assert.equal(request.headers.get('Authorization'), 'Bearer session-a');
    assert.equal(new Headers(headers).get('Authorization'), method === 'POST' ? 'Bearer stale' : null,
      'caller headers are not mutated');
  }
});

test('missing, corrupt or inaccessible login prevents every network request', async () => {
  for (const options of [{stored: null}, {stored: '{'}, {stored: '{}'},
    {stored: JSON.stringify({sessionToken: '  '})}, {failStorage: true}]) {
    const h = fixture(options);
    await assert.rejects(h.request(endpoint), /로그인 정보가 없습니다/);
    assert.equal(h.calls.length, 0);
  }
});

test('each call reads the current token, including legacy session_token', async () => {
  const h = fixture();
  await h.request(endpoint);
  h.setStored(JSON.stringify({session_token: ' session-b '}));
  await h.request('/api/inspection-schedule-status', {method: 'POST'});
  assert.deepEqual(h.calls.map(c => c.options.headers.get('Authorization')),
    ['Bearer session-a', 'Bearer session-b']);
  h.setStored(null);
  await assert.rejects(h.request(endpoint), /로그인/);
  assert.equal(h.calls.length, 2);
});

test('HTTP errors preserve status and payload for expired sessions and revision conflicts', async () => {
  for (const status of [401, 403, 404, 409, 500]) {
    const payload = {ok: false, message: '서버 안내',
      ...(status === 409 ? {currentLog: {id: 'record-a', serverRevision: 8}} : {})};
    const h = fixture({respond: () => Response.json(payload, {status})});
    await assert.rejects(h.request(endpoint), error => {
      assert.equal(error.message, payload.message);
      assert.equal(error.status, status);
      assert.deepEqual(error.payload, payload);
      return true;
    });
  }
});

test('successful HTTP with ok:false is a failure, not a saved record', async () => {
  const payload = {ok: false, message: '저장 실패'};
  const h = fixture({respond: () => Response.json(payload)});
  await assert.rejects(h.request(endpoint, {method: 'POST'}), error => {
    assert.equal(error.status, 200);
    assert.deepEqual(error.payload, payload);
    return error.message === '저장 실패';
  });
});

test('empty, non-JSON and malformed success responses fail closed', async () => {
  for (const body of ['', '<html>Gateway</html>', 'null', '{}', '[]', '{"ok":"true"}']) {
    const h = fixture({respond: () => new Response(body, {status: 200})});
    await assert.rejects(h.request(endpoint, {method: 'POST'}), /서버 응답을 확인하지 못했습니다/);
  }
  const h = fixture({respond: () => new Response('<html>Gateway</html>', {status: 502})});
  await assert.rejects(h.request(endpoint), error =>
    error.status === 502 && error.payload === null && error.message.includes('502'));
});

test('valid empty date/archive responses remain usable and network failures propagate', async () => {
  for (const payload of [{ok: true, log: null}, {ok: true, logs: []}]) {
    const h = fixture({respond: () => Response.json(payload)});
    assert.deepEqual(await h.request(endpoint), payload);
  }
  const offline = new TypeError('Failed to fetch');
  const h = fixture({respond: () => {throw offline;}});
  await assert.rejects(h.request(endpoint), error => error === offline);
  assert.equal(h.calls.length, 1, 'failed writes are not silently retried');
});
