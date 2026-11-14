'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const adapter = require('../maintenance/blower-schedule-browser-v1.js');
const contract = require('../maintenance/cofiring-live-contract.js');
const {createPeriod} = require('../maintenance/cofiring-live.js');
const AUTH = 'gsShiftLog.currentUser';
const TOKEN = 'fixture-session-only';
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
  emit(name, event = {}) { return Promise.all((this.listeners.get(name) || []).map(listener => listener(event))); }
}
function browser({page = 'blower-history', hidden = false, mobile = false, loggedOut = false} = {}) {
  const root = new Target(), document = new Target(), calls = [], storageReads = [];
  const elements = new Map([['appShell', {hidden: false}], ['loginScreen', {hidden: true}]]);
  document.documentElement = {dataset: {shiftLogPage: page}};
  document.hidden = hidden; document.visibilityState = hidden ? 'hidden' : 'visible'; document.readyState = 'complete';
  document.getElementById = id => elements.get(id) || null;
  let authenticated = !loggedOut;
  root.localStorage = {getItem(key) { storageReads.push(key); return key === AUTH && authenticated ? JSON.stringify({employeeNo: 'fixture-user', sessionToken: TOKEN}) : null; }, setItem() {}};
  const media = new Target(); media.matches = mobile; root.matchMedia = () => media;
  const timers = new Map(), intervals = new Map(); let serial = 0;
  root.setTimeout = (fn, ms) => { const id = ++serial; timers.set(id, {fn, ms}); return id; };
  root.clearTimeout = id => timers.delete(id);
  root.setInterval = (fn, ms) => { const id = ++serial; intervals.set(id, {fn, ms}); return id; };
  root.clearInterval = id => intervals.delete(id);
  root.location = {origin: 'https://fixture.invalid'}; root.AbortController = AbortController;
  root.MutationObserver = class {observe() {}};
  root.Event = class {constructor(type) {this.type = type;}};
  root.dispatchEvent = event => root.emit(event.type, event);
  root.navigator = {locks: {}}; root.performance = {now: () => 1};
  root.crypto = {getRandomValues: array => array.fill(1)};
  root.fetch = async (url, options = {}) => {calls.push({url, options}); return {ok: true, status: 200, json: async () => ({ok: true})};};
  const controllers = [];
  root.BlowerUnifiedRefresh = {};
  root.BlowerScheduleV1 = {createController(options) { controllers.push(options); return {
    tick() { if (options.identity()) return options.api({method: 'POST', body: {action: 'scheduled_refresh', operation: 'status'}}, TOKEN); return Promise.resolve(); },
    snapshot: () => ({status: null}), stop() {}}; }};
  root.document = document;
  const visibility = value => {document.hidden = !value; document.visibilityState = value ? 'visible' : 'hidden';};
  return {root, document, calls, storageReads, timers, intervals, controllers, media, visibility, logout: () => {authenticated = false;}};
}
async function flush() {for (let i = 0; i < 20; i++) await Promise.resolve();}
const denied = error => error.code === 'WRITE_ACCESS_CHANGED' && error.status === 403;
function deferred() {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};}

for (const page of ['', 'cofiring', 'daily-log'])
test(`logged-in ${JSON.stringify(page)} document installs no Blower timers, listeners, controller or API work`, async () => {
  const b = browser({page}); adapter.install(b.root);
  assert.equal(b.root.__blowerScheduleBrowserV1, undefined);
  assert.equal(b.controllers.length, 0); assert.equal(b.timers.size, 0); assert.equal(b.intervals.size, 0);
  assert.equal(b.document.listeners.size, 0); assert.equal(b.root.listeners.size, 0); assert.equal(b.storageReads.length, 0);
  for (const event of ['focus', 'online', 'pageshow', 'storage']) await b.root.emit(event, {persisted: true, key: AUTH});
  await b.document.emit('visibilitychange'); await b.document.emit('DOMContentLoaded'); await flush();
  assert.equal(b.calls.length, 0);
});

test('missing page marker, mobile and logout identities fail closed; owned desktop visibility can resume', () => {
  const b = browser(); assert.equal(adapter.identity(b.root).token, TOKEN);
  b.visibility(false); assert.equal(adapter.identity(b.root), null);
  b.visibility(true); assert.equal(adapter.identity(b.root).token, TOKEN);
  for (const value of ['prerender', undefined, 'unknown']) {
    b.document.visibilityState = value; assert.equal(adapter.identity(b.root), null);
  }
  b.document.visibilityState = 'visible';
  b.media.matches = true; assert.equal(adapter.identity(b.root), null); b.media.matches = false;
  delete b.document.documentElement.dataset.shiftLogPage; assert.equal(adapter.identity(b.root), null);
  b.document.documentElement.dataset.shiftLogPage = 'blower-history';
  b.logout(); assert.equal(adapter.identity(b.root), null);
});

test('hidden owned document installs its resume lifecycle while making no API call until visible', async () => {
  const b = browser({hidden: true}); adapter.install(b.root); await flush();
  assert.equal(b.controllers.length, 1); assert.equal(b.intervals.size, 1);
  assert.equal(b.calls.length, 0);
  for (const entry of b.intervals.values()) entry.fn(); await flush(); assert.equal(b.calls.length, 0);
  b.visibility(true); await b.document.emit('visibilitychange'); await flush();
  assert.equal(b.calls.length, 1); assert.equal(JSON.parse(b.calls[0].options.body).operation, 'status');
  b.document.documentElement.dataset.shiftLogPage = 'cofiring';
  await b.root.emit('online'); await b.root.emit('storage', {key: AUTH}); await flush();
  assert.equal(b.calls.length, 1, 'later route changes cannot authorize further requests');
});

test('API rejects hidden entry before fetch and still permits a fresh visible owned request', async () => {
  const b = browser({hidden: true}), api = adapter.createApi(b.root, () => adapter.identity(b.root));
  await assert.rejects(api({method: 'POST', body: {action: 'scheduled_refresh', operation: 'claim'}}, TOKEN), denied);
  assert.equal(b.calls.length, 0);
  b.visibility(true); await api({}, TOKEN); assert.equal(b.calls.length, 1);
});

for (const awaitStage of ['fetch', 'json'])
test(`hidden scope invalidates a stale ${awaitStage} response even if abort is ignored and visibility returns`, async () => {
  const b = browser(), api = adapter.createApi(b.root, () => adapter.identity(b.root));
  const gate = deferred(); let observedSignal, jsonCalls = 0;
  b.root.fetch = async (url, options) => {
    b.calls.push({url, options}); observedSignal = options.signal;
    if (awaitStage === 'fetch') await gate.promise;
    return {ok: true, status: 200, json: async () => {jsonCalls++; if (awaitStage === 'json') await gate.promise; return {ok: true};}};
  };
  const chain = api({}, TOKEN).then(() => api({method: 'POST', body: {action: 'create_blower_runtime_probe_batch', requests: []}}, TOKEN));
  const rejection = assert.rejects(chain, denied); await flush();
  b.visibility(false); api.invalidate(); assert.equal(observedSignal.aborted, true);
  b.visibility(true); gate.resolve(); await rejection;
  assert.equal(b.calls.length, 1, 'no follow-up queue creation is allowed from a stale response');
  assert.equal(jsonCalls, awaitStage === 'fetch' ? 0 : 1);
  assert.equal(b.timers.size, 0);
});

test('real co-firing Calculate creates one co-firing request with no Blower read, reservation or batch', async () => {
  const b = browser({page: ''}); adapter.install(b.root);
  const spec = {startLocal: '2026-09-14T00:00', endLocal: '2026-09-15T00:00', stepUnit: 'minute', stepValue: 1};
  const id = '11111111-1111-4111-8111-111111111111', calls = [];
  b.root.fetch = async (url, options = {}) => {
    const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
    calls.push({url, method, body});
    const result = method === 'POST' ? {ok: true, bridgeVersion: 2, periodKey: contract.periodKey(spec), item: {
      id, requestType: 'cofiring_period', targetDate: spec.startLocal.slice(0, 10), status: 'pending', request: contract.periodEnvelope(spec), result: contract.periodEnvelope(spec)}} :
      {ok: true, bridgeVersion: 2, periodKey: contract.periodKey(spec), saved: null, active: null, lastAttempt: null, result: null};
    return {ok: true, status: 200, json: async () => result};
  };
  const live = createPeriod({getHeaders: () => ({Authorization: 'Bearer ' + TOKEN}), canQuery: () => true, isVisible: () => true,
    makeId: () => id, fetch: b.root.fetch, setTimeout: b.root.setTimeout, clearTimeout: b.root.clearTimeout});
  try {
    live.select(spec); await flush(); assert.equal(calls.filter(call => call.method === 'POST').length, 0);
    await live.query({explicit: true}); await flush();
    const posts = calls.filter(call => call.method === 'POST');
    assert.equal(posts.length, 1); assert.equal(posts[0].body.action, 'create'); assert.equal(posts[0].body.requestType, 'cofiring_period');
    assert.equal(live.state().item.active.id, id);
    assert.ok(calls.every(call => new URL(call.url, b.root.location.origin).pathname === '/api/ois-data-requests'));
    assert.ok(calls.every(call => !/blower|scheduled_refresh/.test(JSON.stringify(call))));
    assert.equal(b.controllers.length, 0); assert.equal(b.intervals.size, 0);
  } finally {live.dispose();}
});

test('entry HTML scopes only scheduling drivers to Blower and retains the shared pure Seal Pot dependency', () => {
  const index = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const blower = fs.readFileSync(path.join(__dirname, '../maintenance/blower-history.html'), 'utf8');
  for (const name of ['blower-schedule-v1.js', 'blower-schedule-browser-v1.js', 'blower-schedule-v1.css']) assert.ok(!index.includes(name));
  assert.match(index, /<script[^>]+blower-unified-refresh\.js/);
  assert.match(blower, /<script[^>]+seal-pot-ois-shadow\.js/);
  assert.match(blower, /data-shift-log-page="blower-history"/);
  assert.match(blower, /blower-schedule-browser-v1\.js[^"']*pageOnly=20261115-v1/);
  assert.match(blower, /Blower 화면이 보이는 동안에만/);
  assert.match(blower, /업무일지·혼소율 화면에서는 실행하지 않습니다/);
});
