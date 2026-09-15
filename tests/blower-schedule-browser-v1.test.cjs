'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {identity, createApi, formatKst, install} = require('../maintenance/blower-schedule-browser-v1.js');
const AUTH_KEY = 'gsShiftLog.currentUser';

class Target {
  constructor() { this.listeners = new Map(); this.hidden = false; this.disabled = false; this.textContent = ''; }
  addEventListener(name, fn, options) {
    const listeners = this.listeners.get(name) || [];
    listeners.push({fn, capture: options === true || options?.capture === true});
    this.listeners.set(name, listeners);
  }
  emit(name, event = {}) {
    return Promise.all((this.listeners.get(name) || []).map(({fn}) => fn(event)));
  }
}

function browser(options = {}) {
  const root = new Target();
  const document = new Target();
  const elements = new Map();
  for (const id of ['appShell', 'loginScreen', 'blowerSchedulePanel', 'blowerScheduleState',
    'blowerScheduleNext', 'blowerScheduleProgress', 'blowerScheduleLast', 'blowerScheduleRegister',
    'blowerScheduleDisable', 'blowerScheduleMenuStatus']) elements.set(id, new Target());
  elements.get('loginScreen').hidden = true;
  document.getElementById = id => elements.get(id) || null;
  document.documentElement = {dataset: options.blower ? {shiftLogPage: 'blower-history'} : {}};
  document.readyState = 'complete';
  const saved = new Map([[AUTH_KEY, JSON.stringify({employeeNo: 'employee-a', sessionToken: 'token-a', role: 'BCO1'})]]);
  root.localStorage = {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)};
  root.document = document;
  root.mobile = false;
  const media = new Target();
  root.matchMedia = () => { media.matches = root.mobile; return media; };
  root.location = {origin: 'https://example.invalid'};
  root.AbortController = AbortController;
  let timerId = 0;
  const timers = new Map(), intervals = new Map();
  root.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, {fn, ms}); return id; };
  root.clearTimeout = id => timers.delete(id);
  root.setInterval = (fn, ms) => { const id = ++timerId; intervals.set(id, {fn, ms}); return id; };
  root.clearInterval = id => intervals.delete(id);
  root.performance = {now: () => 123};
  root.crypto = {getRandomValues: values => values.fill(7)};
  root.navigator = {locks: {request() { throw new Error('fake controller must not request a lock'); }}};
  root.MutationObserver = class { constructor(fn) { this.fn = fn; } observe() {} };
  root.Event = class { constructor(type) { this.type = type; } };
  root.dispatchEvent = event => root.emit(event.type, event);
  root.confirmations = [];
  root.confirmResult = false;
  root.confirm = message => { root.confirmations.push(message); return root.confirmResult; };
  root.BlowerUnifiedRefresh = {};
  return {root, document, elements, saved, timers, intervals, media};
}

function successful(body = {ok: true}) {
  return {ok: true, status: 200, json: async () => body};
}

function pendingFetch(root) {
  const calls = [];
  root.fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})), {once: true});
    calls.push({url, options, resolve, reject});
  });
  return calls;
}

function controllerBrowser(options = {}) {
  const f = browser(options);
  const calls = {ticks: [], register: [], disable: 0, stop: 0, controllers: []};
  let state = {busy: false, status: {version: 'blower-schedule-v1', enabled: false, thisDevice: false}};
  f.root.BlowerScheduleV1 = {createController(io) {
    calls.controllers.push(io);
    return {
      tick() { calls.ticks.push(io.identity()); return Promise.resolve(); },
      snapshot: () => state,
      register(value) { calls.register.push(value); return Promise.resolve(); },
      disable() { calls.disable += 1; return Promise.resolve(); },
      stop() { calls.stop += 1; }
    };
  }};
  return {...f, calls, setState(value) { state = value; }};
}

test('main page requires visible application, hidden login screen, and complete authenticated identity', () => {
  const f = browser();
  assert.deepEqual(identity(f.root), {token: 'token-a', employeeNo: 'employee-a'});
  f.elements.get('appShell').hidden = true;
  assert.equal(identity(f.root), null);
  f.elements.get('appShell').hidden = false;
  f.elements.get('loginScreen').hidden = false;
  assert.equal(identity(f.root), null);
  f.elements.get('loginScreen').hidden = true;
  f.saved.set(AUTH_KEY, JSON.stringify({employeeNo: 'employee-a'}));
  assert.equal(identity(f.root), null);
  f.saved.set(AUTH_KEY, JSON.stringify({sessionToken: 'token-a'}));
  assert.equal(identity(f.root), null);
});

test('Blower page uses the shared login bearer, while public/mobile/broken storage remain inactive', () => {
  const f = browser({blower: true});
  f.elements.delete('appShell'); f.elements.delete('loginScreen');
  f.saved.set(AUTH_KEY, JSON.stringify({employee_no: 'employee-b', session_token: 'token-b', role: 'TGO'}));
  assert.deepEqual(identity(f.root), {token: 'token-b', employeeNo: 'employee-b'});
  assert.equal(identity(f.root, 'token-b'), null);
  f.root.mobile = true;
  assert.equal(identity(f.root), null);
  f.root.mobile = false;
  f.saved.set(AUTH_KEY, '{broken');
  assert.equal(identity(f.root), null);
  f.saved.delete(AUTH_KEY);
  assert.equal(identity(f.root), null);
  f.root.localStorage.getItem = () => { throw new Error('storage unavailable'); };
  assert.equal(identity(f.root), null);
});

test('API limits requests to the two same-origin APIs and pins bearer headers without leaking token elsewhere', async () => {
  const f = browser(); const calls = [];
  f.root.fetch = async (...args) => { calls.push(args); return successful(); };
  const api = createApi(f.root, () => identity(f.root));
  for (const url of ['https://foreign.invalid/api/blower-history', '//foreign.invalid/api/ois-data-requests', '/api/users', 'javascript:alert(1)']) {
    await assert.rejects(api({url}, 'token-a'), /API 경로/);
  }
  assert.equal(calls.length, 0);
  await api({method: 'POST', body: {action: 'schedule_status'}}, 'token-a');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://example.invalid/api/blower-history');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer token-a');
  assert.equal(calls[0][1].headers['X-GS-Client-Mode'], 'desktop');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.deepEqual(JSON.parse(calls[0][1].body), {action: 'schedule_status'});
  assert.equal(f.timers.size, 0);
});

test('token changed while fetch awaits prevents response parsing or returning old-session data', async () => {
  const f = browser(); const calls = pendingFetch(f.root);
  const api = createApi(f.root, () => identity(f.root));
  let jsonCalls = 0;
  const pending = api({}, 'token-a');
  f.saved.set(AUTH_KEY, JSON.stringify({employeeNo: 'employee-b', sessionToken: 'token-b'}));
  calls[0].resolve({ok: true, status: 200, json: async () => { jsonCalls++; return {ok: true}; }});
  await assert.rejects(pending, error => error.code === 'WRITE_ACCESS_CHANGED' && error.status === 403);
  assert.equal(jsonCalls, 0);
  assert.equal(f.timers.size, 0);
});

test('token changed while JSON awaits prevents returning old-session data', async () => {
  const f = browser(); let resolveJson;
  f.root.fetch = async () => ({ok: true, status: 200, json: () => new Promise(resolve => { resolveJson = resolve; })});
  const api = createApi(f.root, () => identity(f.root));
  const pending = api({}, 'token-a');
  await Promise.resolve();
  assert.equal(typeof resolveJson, 'function');
  f.saved.set(AUTH_KEY, JSON.stringify({employeeNo: 'employee-b', sessionToken: 'token-b'}));
  resolveJson({ok: true, source: 'old session'});
  await assert.rejects(pending, error => error.code === 'WRITE_ACCESS_CHANGED');
  assert.equal(f.timers.size, 0);
});

test('invalidation aborts only old-session requests; page shutdown can abort all', async () => {
  const f = browser(); const calls = pendingFetch(f.root);
  const api = createApi(f.root, () => identity(f.root));
  const old = api({}, 'token-a');
  const rejected = assert.rejects(old, error => error.code === 'WRITE_ACCESS_CHANGED');
  f.saved.set(AUTH_KEY, JSON.stringify({employeeNo: 'employee-b', sessionToken: 'token-b'}));
  const current = api({}, 'token-b');
  api.invalidate();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(calls[1].options.signal.aborted, false);
  calls[1].resolve(successful({ok: true, current: true}));
  await rejected;
  assert.deepEqual(await current, {ok: true, current: true});
  const shutdown = api({}, 'token-b');
  const shutdownRejected = assert.rejects(shutdown, error => error.code === 'REQUEST_TIMEOUT');
  api.invalidate(true);
  assert.equal(calls[2].options.signal.aborted, true);
  await shutdownRejected;
  assert.equal(f.timers.size, 0);
});

test('timed-out API request produces bounded timeout classification and retains authentication errors', async () => {
  const f = browser(); pendingFetch(f.root);
  const api = createApi(f.root, () => identity(f.root));
  const pending = api({timeoutMs: 1500}, 'token-a');
  const rejected = assert.rejects(pending, error => error.code === 'REQUEST_TIMEOUT' && error.status === 0);
  assert.equal(f.timers.size, 1);
  const timer = [...f.timers.values()][0];
  assert.equal(timer.ms, 1500);
  timer.fn(); await rejected;
  assert.equal(f.timers.size, 0);
  f.root.fetch = async () => ({ok: false, status: 401, json: async () => ({ok: false, code: 'SESSION_EXPIRED', message: '로그인 만료'})});
  await assert.rejects(api({}, 'token-a'), error => error.status === 401 && error.code === 'SESSION_EXPIRED');
});

test('BCO1 role never registers the browser automatically; designation requires its explicit confirmed click', async () => {
  const f = controllerBrowser(); install(f.root);
  assert.equal(f.calls.controllers.length, 1);
  assert.equal(f.calls.ticks.length, 1);
  assert.equal(f.calls.register.length, 0);
  assert.equal(f.root.confirmations.length, 0);
  assert.equal(f.elements.get('blowerScheduleRegister').hidden, false);
  await f.elements.get('blowerScheduleRegister').emit('click');
  assert.equal(f.root.confirmations.length, 1);
  assert.equal(f.calls.register.length, 0);
  f.root.confirmResult = true;
  await f.elements.get('blowerScheduleRegister').emit('click');
  assert.deepEqual(f.calls.register, [{confirmedPhysicalBco1: true}]);
  assert.match(f.root.confirmations[1], /BCO1 PC/);
  install(f.root);
  assert.equal(f.calls.controllers.length, 1, 'repeated install must not attach another scheduler');
});

test('denied localStorage property access disables setup gracefully without starting a controller or timer', () => {
  const f = controllerBrowser();
  Object.defineProperty(f.root, 'localStorage', {get() { throw Object.assign(new Error('storage denied'), {name: 'SecurityError'}); }});
  assert.equal(identity(f.root), null);
  assert.doesNotThrow(() => install(f.root));
  assert.equal(f.calls.controllers.length, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.calls.register.length, 0);
});

test('logout click blocks the old bearer synchronously before delayed logout API or storage clearing', async () => {
  const f = controllerBrowser(); install(f.root);
  const io = f.calls.controllers[0];
  assert.equal(io.identity().token, 'token-a');
  assert.ok(f.document.listeners.get('click').some(listener => listener.capture));
  const emitted = f.document.emit('click', {target: {closest: selector => selector === '#logoutButton'}});
  assert.equal(io.identity(), null);
  assert.equal(f.calls.ticks.at(-1), null);
  assert.equal(f.elements.get('blowerSchedulePanel').hidden, true);
  assert.equal(JSON.parse(f.saved.get(AUTH_KEY)).sessionToken, 'token-a', 'shared storage is still uncleared at this point');
  await emitted;
  f.saved.set(AUTH_KEY, JSON.stringify({employeeNo: 'employee-b', sessionToken: 'token-b'}));
  await f.root.emit('storage', {key: AUTH_KEY});
  assert.equal(io.identity().token, 'token-b');
});

test('main login visibility, mobile switch, and page lifecycle promptly update scheduler identity', async () => {
  const f = controllerBrowser(); install(f.root);
  f.elements.get('appShell').hidden = true;
  await f.document.emit('visibilitychange');
  assert.equal(f.calls.ticks.at(-1), null);
  assert.equal(f.elements.get('blowerSchedulePanel').hidden, true);
  f.elements.get('appShell').hidden = false;
  f.root.mobile = true;
  await f.media.emit('change');
  assert.equal(f.calls.ticks.at(-1), null);
  f.root.mobile = false;
  await f.root.emit('pagehide');
  assert.equal(f.calls.stop, 1);
  assert.equal(f.intervals.size, 0);
  const ticks = f.calls.ticks.length;
  await f.root.emit('online');
  assert.equal(f.calls.ticks.length, ticks, 'suspended page must not schedule more work');
  await f.root.emit('pageshow', {persisted: true});
  assert.equal(f.calls.controllers.length, 2);
  assert.equal(f.intervals.size, 1);
});

test('next and last server slot times render in KST including midnight rollover', () => {
  const f = controllerBrowser(); install(f.root);
  const snapshot = {busy: false, status: {version: 'blower-schedule-v1', enabled: true, thisDevice: true,
    nextSlotAt: '2026-09-15T15:00:00.000Z', latestSlot: {slotKey: '2026-09-15T11:00:00.000Z', state: 'complete', completedCount: 20}}};
  f.calls.controllers[0].onState(snapshot);
  assert.match(formatKst(snapshot.status.nextSlotAt), /09\D+16\D+00:00/);
  assert.match(f.elements.get('blowerScheduleNext').textContent, /09\D+16\D+00:00/);
  assert.match(f.elements.get('blowerScheduleLast').textContent, /20:00.*완료.*20건/);
  assert.equal(f.elements.get('blowerScheduleRegister').hidden, true);
  assert.equal(f.elements.get('blowerScheduleDisable').hidden, false);
  assert.equal(formatKst('invalid time'), '확인 중');
});

test('both pages load scheduling scripts once; Blower owns the designation panel and main links to it', () => {
  for (const relative of ['index.html', 'maintenance/blower-history.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi)].map(match => match[1].split('?')[0].split('/').at(-1));
    const dependencies = ['blower-unified-refresh.js', 'blower-schedule-v1.js', 'blower-schedule-browser-v1.js'];
    for (const name of dependencies) assert.equal(scripts.filter(src => src === name).length, 1, `${relative}: ${name} once`);
    assert.ok(scripts.indexOf(dependencies[0]) < scripts.indexOf(dependencies[1]), `${relative}: core before controller`);
    assert.ok(scripts.indexOf(dependencies[1]) < scripts.indexOf(dependencies[2]), `${relative}: controller before adapter`);
    if (relative === 'maintenance/blower-history.html') {
      for (const id of ['blowerSchedulePanel', 'blowerScheduleRegister', 'blowerScheduleDisable', 'blowerScheduleNext']) {
        assert.equal([...html.matchAll(new RegExp(`\\bid\\s*=\\s*['"]${id}['"]`, 'g'))].length, 1, `${relative}: ${id} once`);
      }
    } else {
      assert.equal([...html.matchAll(/\bid\s*=\s*['"]blowerScheduleMenuStatus['"]/g)].length, 1);
      const blowerLink = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map(match => match[0]).find(link => /\bid\s*=\s*['"]blowerHistoryHeaderButton['"]/.test(link));
      assert.ok(blowerLink, 'main has a Blower menu link');
      assert.match(blowerLink, /\bhref\s*=\s*['"]\/maintenance\/blower-history['"]/);
      assert.match(blowerLink, /\bid\s*=\s*['"]blowerScheduleMenuStatus['"]/);
    }
  }
});
