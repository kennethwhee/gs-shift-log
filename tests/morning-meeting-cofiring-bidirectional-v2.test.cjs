'use strict';
// Actual project modules + synthetic API/DOM adapters. No live DB or Agent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(repo, name), 'utf8').replace(/\r\n/g, '\n');
const copy = x => JSON.parse(JSON.stringify(x));
const DATE = '2026-10-01';
const spec = {startLocal: DATE + 'T00:00', endLocal: '2026-10-02T00:01'};
const tick = async () => { for (let i = 0; i < 9; i++) await new Promise(r => setImmediate(r)); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return {resolve, promise}; }
class Event {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; Object.assign(this, options); }
  preventDefault() {} stopPropagation() {}
}
class Hub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(event) { for (const fn of [...(this.listeners.get(event.type) || [])]) fn.call(this, event); return true; }
}
class Element extends Hub {
  constructor(tag = 'div', attrs = {}) {
    super(); this.tagName = tag.toUpperCase(); this.attrs = new Map(Object.entries(attrs)); this.dataset = {}; this.children = [];
    this.hidden = Object.hasOwn(attrs, 'hidden'); this.disabled = false; this.isConnected = true; this.textContent = ''; this.value = ''; this.style = {};
    const classes = new Set(String(attrs.class || '').split(' ').filter(Boolean));
    this.classList = {contains: x => classes.has(x), add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)),
      toggle: (x, on = !classes.has(x)) => { on ? classes.add(x) : classes.delete(x); return on; }};
    for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.get(k) ?? null; }
  hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); }
  appendChild(child) { child.parentNode = child.parentElement = this; this.children.push(child); return child; }
  prepend(child) { child.parentNode = child.parentElement = this; this.children.unshift(child); }
  insertAdjacentElement(_, child) { this.parentElement?.appendChild(child); }
  remove() { this.isConnected = false; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); }
  focus() {} closest() { return null; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    if (this.nodes) {
      const selectors = sel.split(',');
      return this.nodes.filter(e => selectors.some(s => {
        s = s.trim();
        const data = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s);
        if (data) return e.hasAttribute(data[1]) && (data[2] === undefined || e.getAttribute(data[1]) === data[2]);
        if (s.startsWith('.cfv56-adjust-body ')) return e.tagName === s.split(' ').at(-1).toUpperCase();
        if (s.startsWith('.')) return e.classList.contains(s.slice(1));
        return false;
      }));
    }
    return this.children.flatMap(e => [...e.querySelectorAll(sel)]);
  }
  set innerHTML(html) {
    this.html = html;
    if (!html.includes('cfv56-adjust-modal')) return;
    const modal = new Element('div', {class: 'cfv56-adjust-modal', hidden: '', 'data-cfv56-adjust-modal': ''});
    modal.nodes = [];
    for (const match of html.matchAll(/<(div|section|header|button|input|p|strong|tbody|span)\b([^>]*)>/g)) {
      const attrs = {};
      for (const a of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
      const el = new Element(match[1], attrs); el.parentNode = el.parentElement = modal; modal.nodes.push(el);
    }
    this.firstElementChild = modal;
  }
  get innerHTML() { return this.html || ''; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
function browser() {
  const root = new Hub(), doc = new Hub(), ids = new Map(), logs = [], posts = [], gets = [], store = new Map();
  let selected = DATE, auth = 'Bearer regression-user', blocked = false, closedRevision = 7, failWrite = false, writes = 0;
  let server = {revision: 0, adjustment: null};
  const qWaits = [], closeWaits = [];
  const card = new Element(), button = new Element('button'); ids.set('efficiencyMorningMeetingAutoCofiringCard', card); ids.set('morningMeetingCofiringAdjustmentButton', button);
  doc.hidden = false; doc.body = new Element('body'); doc.activeElement = new Element('button'); doc.readyState = 'complete';
  doc.getElementById = id => ids.get(id) || null; doc.createElement = tag => new Element(tag); doc.querySelector = () => null;
  root.document = doc; root.Headers = Headers; root.URLSearchParams = URLSearchParams; root.CustomEvent = Event; root.Event = Event;
  root.AbortController = AbortController; root.navigator = {userAgent: 'desktop fixture', platform: 'Win32', maxTouchPoints: 0};
  root.console = console; root.setTimeout = () => 1; root.clearTimeout = () => {}; root.requestAnimationFrame = () => {};
  root.crypto = {randomUUID: () => '00000000-0000-4000-8000-' + String(posts.length + 1).padStart(12, '0')};
  root.localStorage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => { writes++; store.set(k, v); }, removeItem: k => { if (store.has(k)) { writes++; store.delete(k); } }};
  root.getShiftLogAuthHeaders = () => ({Authorization: auth}); root.alert = m => logs.push(m); root.showToast = m => logs.push(m);
  root.morningMeetingClosedCofiring = {targetDate: () => selected, isBlocked: () => blocked, peek: () => ({revision: closedRevision, adjustmentApplied: !!server.adjustment})};
  const context = vm.createContext(root);
  vm.runInContext(read('maintenance/cofiring-period-adjustment-v56.js'), context);
  vm.runInContext(read('maintenance/cofiring-shared-adjustment-sync-v2.js'), context);
  const adjust = root.CofiringPeriodAdjustmentV56, shared = root.CofiringSharedAdjustmentSyncV2;
  const settings = {};
  for (const [unit, coalHV, bioHV] of [['unit1', 5800, 3200], ['unit2', 6010, 3190]]) settings[unit] = {
    coal: {calorific: coalHV, coefficient: 1}, bio: {calorific: bioHV, coefficient: 1},
    organic: {calorific: 3400, coefficient: 1}, manure: {calorific: 2900, coefficient: 1}
  };
  const base = {period: {...spec, durationHours: 1441 / 60}, units: {}};
  for (const [unit, coal, bio, manure] of [['unit1', 540.530123, 435.410987, 0], ['unit2', 589.370234, 356.210456, 1.23001]]) base.units[unit] = {
    coal: {quantity: coal}, bio: {quantity: bio}, organic: {quantity: 88.891234}, manure: {quantity: manure}
  };
  // Compute a physically consistent raw fixture with the actual shared engine.
  const raw = adjust.adjustFinal(base, settings, base.units.unit1.bio.quantity, base.units.unit2.bio.quantity).result; delete raw.adjustment;
  function item() {
    const result = server.adjustment ? adjust.adjustFinal(raw, settings, server.adjustment.finalBioUnit1, server.adjustment.finalBioUnit2, server.adjustment).result : raw;
    return {targetDate: DATE, revision: closedRevision, sourceRequestId: 'fixture-source-1', adjustmentApplied: !!server.adjustment,
      effectiveOriginalResult: server.adjustment ? copy(raw) : null, effectiveResult: copy(result),
      snapshot: {schemaVersion: 1, targetDate: DATE, sourceRequestId: 'fixture-source-1', period: copy(raw.period), settings: copy(settings), result: copy(raw)}};
  }
  function answer(payload, ok = true) { return {ok, status: ok ? 200 : 409, json: async () => copy(payload)}; }
  function periodAnswer() { return answer({ok: true, start: spec.startLocal, end: spec.endLocal, revision: server.revision, adjustment: server.adjustment, setting: {maxBioTpd: 361.1492}}); }
  root.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), 'https://fixture.invalid');
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); posts.push({url: parsed.pathname, body, headers: options.headers});
      assert.equal(parsed.pathname, '/api/cofiring-period-adjustments');
      if (failWrite) return answer({ok: false, message: 'WRITE_FAILED'}, false);
      if (body.action === 'save_setting') return answer({ok: true, setting: {maxBioTpd: body.maxBioTpd}});
      if (body.expectedRevision !== server.revision) return answer({ok: false, message: 'REVISION_CONFLICT'}, false);
      assert.equal(body.start, spec.startLocal); assert.equal(body.end, spec.endLocal);
      server = {revision: server.revision + 1, adjustment: body.action === 'clear' ? null : body.adjustment};
      return answer({ok: true, entry: {revision: server.revision}, adjustment: server.adjustment});
    }
    gets.push(parsed.pathname);
    if (parsed.pathname === '/api/cofiring-closed-history') return closeWaits.length ? closeWaits.shift().promise : answer({ok: true, item: item()});
    assert.equal(parsed.pathname, '/api/cofiring-period-adjustments');
    return qWaits.length ? qWaits.shift().promise : periodAnswer();
  };
  function setServer(final1 = 361.400123, final2 = 361.400234) {
    server = {revision: server.revision + 1, adjustment: {mode: 'manual_final', finalBioUnit1: final1, finalBioUnit2: final2, fromUnit: null, bioTransferTons: 0, maxBioTpd: null, excludedBioTons: 0}};
  }
  return {root, doc, card, button, logs, posts, gets, store, adjust, shared, raw, settings, item, answer, periodAnswer, qWaits, closeWaits,
    setServer, clearServer: () => { server = {revision: server.revision + 1, adjustment: null}; }, server: () => server,
    select: d => { selected = d; }, auth: x => { auth = x; }, block: x => { blocked = x; }, closeRevision: n => { closedRevision = n; },
    failWrite: x => { failWrite = x; }, writes: () => writes,
    modal: () => doc.body.children.find(x => x.nodes),
    event: (type, detail) => root.dispatchEvent(new Event(type, {detail}))};
}
function calculator(b) {
  const applied = [], errors = [], deferredMessages = [];
  let visible = true;
  let ctx = {result: copy(b.raw), settings: copy(b.settings), spec: copy(spec), identity: 'Bearer regression-user', suspended: false};
  const sync = b.shared.createCalculatorSync({getContext: () => ctx, getHeaders: b.root.getShiftLogAuthHeaders, isVisible: () => visible,
    onResult: (r, state) => applied.push({result: copy(r), ...state}), onError: e => errors.push(e.message), onDeferred: () => deferredMessages.push('deferred')});
  return {sync, applied, errors, deferredMessages, ctx: () => ctx, replace: c => { ctx = c; }, visible: v => { visible = v; }};
}
const change = b => b.event('cofiring:period-adjustment-changed', {start: spec.startLocal, end: spec.endLocal, source: 'morning-meeting-card'});
const storageKey = () => 'gspo:cofiring-period-adjust:v56:' + encodeURIComponent(spec.startLocal + '|' + spec.endLocal);

test('morning context uses unadjusted original, exact period, per-unit heating values and full precision', () => {
  const b = browser(); b.setServer(); const input = b.item(), before = JSON.stringify(input);
  const ctx = b.shared.contextFromClosedItem(input, DATE);
  assert.equal(ctx.result.units.unit1.bio.quantity, b.raw.units.unit1.bio.quantity);
  assert.notEqual(ctx.result.units.unit1.bio.quantity, input.effectiveResult.units.unit1.bio.quantity);
  assert.equal(ctx.settings.unit2.coal.calorific, 6010); assert.equal(ctx.result.period.durationHours, 1441 / 60);
  assert.equal(JSON.stringify(input), before); ctx.result.units.unit1.bio.quantity = 0;
  assert.notEqual(input.snapshot.result.units.unit1.bio.quantity, 0);
});
for (const [name, mutate] of [
  ['wrong day', i => { i.targetDate = '2026-09-30'; }], ['wrong source', i => { i.sourceRequestId = 'other'; }],
  ['wrong period', i => { i.snapshot.period.endLocal = '2026-10-03T00:01'; }],
  ['missing original for adjusted close', i => { i.snapshot.result.adjustment = {applied: true}; }],
  ['adjusted original', i => { i.effectiveOriginalResult = {...copy(i.snapshot.result), adjustment: {applied: true}}; }],
  ['missing fuel', i => { delete i.snapshot.result.units.unit2.manure; }],
  ['negative fuel', i => { i.snapshot.result.units.unit1.coal.quantity = -1; }],
  ['missing heating value', i => { delete i.snapshot.settings.unit2.bio; }],
  ['wrong raw period', i => { i.snapshot.result.period.startLocal = '2026-09-30T00:00'; }],
  ['wrong duration', i => { i.snapshot.result.period.durationHours = 24; }]
]) test('context rejects ' + name, () => {
  const b = browser(), item = b.item(); mutate(item); assert.throws(() => b.shared.contextFromClosedItem(item, DATE));
});
test('old adjusted snapshot with originalResult can be edited without double adjustment', () => {
  const b = browser(), item = b.item();
  item.snapshot.originalResult = copy(item.snapshot.result); item.snapshot.result = b.adjust.adjustFinal(b.raw, b.settings, 360, 360).result;
  assert.equal(b.shared.contextFromClosedItem(item, DATE).result.units.unit1.bio.quantity, b.raw.units.unit1.bio.quantity);
});
test('exact old 24-hour close stays 24 hours, not silently widened by one minute', () => {
  const b = browser(), item = b.item(); item.snapshot.period.endLocal = '2026-10-02T00:00';
  item.snapshot.result.period.endLocal = '2026-10-02T00:00'; item.snapshot.result.period.durationHours = 24;
  assert.equal(b.shared.contextFromClosedItem(item, DATE).result.period.durationHours, 24);
});
test('real morning editor manual apply writes the shared API once and notifies the saved period', async () => {
  const b = browser(), original = JSON.stringify(b.raw), events = [];
  b.root.addEventListener('cofiring:period-adjustment-changed', e => events.push(e.detail));
  b.shared.morning.syncButton(); assert.equal(b.button.disabled, false);
  assert.equal(await b.shared.morning.open(), true);
  const modal = b.modal();
  modal.querySelector('[data-cfv56-final1]').value = '361.400123'; modal.querySelector('[data-cfv56-final2]').value = '361.400234';
  modal.querySelector('[data-cfv56-preview-final]').click(); modal.querySelector('[data-cfv56-apply]').click(); await tick();
  assert.equal(b.posts.length, 1); assert.equal(b.posts[0].body.expectedRevision, 0);
  assert.equal(b.posts[0].body.adjustment.finalBioUnit1, 361.400123);
  assert.equal(b.posts[0].headers['X-ShiftLog-Client'], 'desktop'); assert.equal(modal.hidden, true);
  assert.equal(events.length, 1); assert.equal(events[0].start, spec.startLocal); assert.equal(events[0].source, 'morning-meeting-card');
  assert.equal(JSON.stringify(b.raw), original);
});
test('real morning maximum-auto preview uses same engine and only apply persists', async () => {
  const b = browser(); await b.shared.morning.open(); const modal = b.modal();
  modal.querySelector('[data-cfv56-auto]').click(); assert.equal(b.posts.length, 0);
  const expected = b.adjust.autoMax(b.raw, b.settings, 361.1492);
  modal.querySelector('[data-cfv56-apply]').click(); await tick();
  assert.equal(b.posts.length, 1); assert.equal(b.posts[0].body.adjustment.mode, 'max_auto');
  assert.equal(b.posts[0].body.adjustment.finalBioUnit1, expected.result.units.unit1.bio.quantity);
  assert.equal(b.posts[0].body.adjustment.finalBioUnit2, expected.result.units.unit2.bio.quantity);
});
test('real morning manual transfer preserves exact donor/recipient values with one shared write', async () => {
  const b = browser(); await b.shared.morning.open(); const modal = b.modal();
  modal.querySelector('[data-cfv56-transfer]').value = '10.123'; modal.querySelector('[data-cfv56-preview-transfer]').click();
  modal.querySelector('[data-cfv56-apply]').click(); await tick();
  assert.equal(b.posts.length, 1); assert.equal(b.posts[0].body.adjustment.mode, 'manual_transfer');
  assert.equal(b.posts[0].body.adjustment.finalBioUnit1, 425.287987);
});
test('real morning reset writes a CLEAR revision and notifies calculator', async () => {
  const b = browser(); b.setServer(); const c = calculator(b); await c.sync.refresh();
  await b.shared.morning.open(); b.modal().querySelector('[data-cfv56-reset]').click(); await tick();
  assert.equal(b.posts.length, 1); assert.equal(b.posts[0].body.action, 'clear'); assert.equal(b.server().revision, 2);
  assert.equal(c.applied.at(-1).adjusted, false); assert.deepEqual(c.applied.at(-1).result, copy(b.raw));
});
test('morning apply propagates to calculator without adjustment-on-adjustment or a second POST', async () => {
  const b = browser(); b.setServer(370, 340); const c = calculator(b); await c.sync.refresh();
  await b.shared.morning.open(); const m = b.modal();
  m.querySelector('[data-cfv56-final1]').value = '361.400123'; m.querySelector('[data-cfv56-final2]').value = '361.400234';
  m.querySelector('[data-cfv56-preview-final]').click(); m.querySelector('[data-cfv56-apply]').click(); await tick();
  const expected = b.adjust.adjustFinal(b.raw, b.settings, 361.400123, 361.400234, b.server().adjustment).result;
  assert.deepEqual(c.applied.at(-1).result, copy(expected)); assert.equal(b.posts.length, 1);
  assert.equal(c.ctx().result.units.unit1.bio.quantity, b.raw.units.unit1.bio.quantity);
});
test('HTTP failure never publishes, overwrites local adjusted cache, or closes a failed save as success', async () => {
  const b = browser(); b.setServer(); await b.shared.morning.open(); const m = b.modal();
  const before = JSON.stringify([...b.store]); let events = 0; b.root.addEventListener('cofiring:period-adjustment-changed', () => events++);
  b.failWrite(true); m.querySelector('[data-cfv56-apply]').click(); await tick();
  assert.equal(events, 0); assert.equal(JSON.stringify([...b.store]), before); assert.equal(m.hidden, false);
  assert.match(m.querySelector('[data-cfv56-msg]').textContent, /WRITE_FAILED/);
});
test('concurrent save conflicts keep editor open and do not overwrite the other writer', async () => {
  const b = browser(); b.setServer(); await b.shared.morning.open(); const m = b.modal();
  b.setServer(320, 350); const before = JSON.stringify(b.server());
  m.querySelector('[data-cfv56-apply]').click(); await tick();
  assert.equal(JSON.stringify(b.server()), before); assert.equal(m.hidden, false);
  assert.match(m.querySelector('[data-cfv56-msg]').textContent, /REVISION_CONFLICT/);
});
test('double click on apply produces one POST', async () => {
  const b = browser(); b.setServer(); await b.shared.morning.open(); const button = b.modal().querySelector('[data-cfv56-apply]');
  button.click(); button.click(); await tick(); assert.equal(b.posts.length, 1);
});
test('canceling the shared preview does not write', async () => {
  const b = browser(); await b.shared.morning.open(); b.modal().querySelector('[data-cfv56-auto]').click();
  b.modal().querySelector('[data-cfv56-cancel]').click(); assert.equal(b.posts.length, 0); assert.equal(b.modal().hidden, true);
});
for (const [label, mutate] of [['date change', b => b.select('2026-10-02')], ['logout', b => b.auth('')], ['reset block', b => b.block(true)], ['new closing', b => b.closeRevision(8)]]) {
  test('editor blocks a stale preview after ' + label, async () => {
    const b = browser(); b.setServer(); await b.shared.morning.open(); mutate(b);
    b.modal().querySelector('[data-cfv56-apply]').click(); await tick(); assert.equal(b.posts.length, 0);
  });
}
test('date change while loading a close cannot open the wrong-date modal', async () => {
  const b = browser(), wait = deferred(); b.closeWaits.push(wait); const promise = b.shared.morning.open();
  b.select('2026-10-02'); wait.resolve(b.answer({ok: true, item: b.item()})); await promise;
  assert.equal(b.modal(), undefined); assert.equal(b.posts.length, 0);
});
test('date change during successful write still notifies the saved period, not the new date', async () => {
  const b = browser(), events = []; b.setServer(); await b.shared.morning.open();
  b.root.addEventListener('cofiring:period-adjustment-changed', e => events.push(e.detail));
  b.modal().querySelector('[data-cfv56-apply]').click(); b.select('2026-10-02'); await tick();
  assert.equal(b.posts.length, 1); assert.equal(events.length, 1);
  assert.equal(events[0].start, spec.startLocal); assert.equal(events[0].end, spec.endLocal);
});
test('mobile and unauthenticated buttons remain read-only', () => {
  const b = browser(); b.root.navigator.userAgent = 'iPhone'; b.shared.morning.syncButton(); assert.equal(b.button.disabled, true);
  b.root.navigator.userAgent = 'desktop'; b.auth(''); b.shared.morning.syncButton(); assert.equal(b.button.disabled, true);
});
test('server resolver updates calculator storage idempotently, avoiding cross-tab reread loops', async () => {
  const b = browser(); b.setServer(); const c = calculator(b); await c.sync.refresh(); const writes = b.writes();
  await c.sync.refresh({force: true}); await c.sync.refresh({force: true}); assert.equal(b.writes(), writes);
  assert.equal(b.posts.length, 0); assert.equal(c.applied.at(-1).adjusted, true);
});
test('late apply GET cannot overwrite a newer CLEAR event or its local cache', async () => {
  const b = browser(); b.setServer(); const c = calculator(b), wait = deferred();
  const old = b.periodAnswer(); b.qWaits.push(wait); const pending = c.sync.refresh();
  b.clearServer(); change(b); await tick(); wait.resolve(old); await pending;
  assert.equal(c.applied.length, 1); assert.equal(c.applied[0].adjusted, false); assert.equal(b.store.size, 0);
});
test('late CLEAR GET cannot erase a newer apply', async () => {
  const b = browser(), c = calculator(b), wait = deferred(), old = b.periodAnswer();
  b.qWaits.push(wait); const pending = c.sync.refresh(); b.setServer(); change(b); await tick(); wait.resolve(old); await pending;
  assert.equal(c.applied.length, 1); assert.equal(c.applied[0].adjusted, true); assert.ok(b.store.size > 0);
});
test('unrelated day and one-minute mismatched period events do not touch the selected calculator', async () => {
  const b = browser(), c = calculator(b);
  b.event('cofiring:period-adjustment-changed', {start: '2026-09-30T00:00', end: '2026-10-01T00:01'});
  b.event('cofiring:period-adjustment-changed', {start: spec.startLocal, end: '2026-10-02T00:00'}); await tick();
  assert.equal(b.gets.length, 0); assert.equal(c.applied.length, 0);
});
test('other-tab storage change uses the authenticated shared server, not arbitrary local payload', async () => {
  const b = browser(), c = calculator(b); b.setServer();
  b.root.dispatchEvent(new Event('storage', {key: storageKey(), newValue: 'untrusted'})); await tick();
  assert.equal(c.applied.at(-1).result.units.unit1.bio.quantity, b.server().adjustment.finalBioUnit1); assert.equal(b.posts.length, 0);
});
test('hidden calculator waits and picks up another-PC state on activation', async () => {
  const b = browser(), c = calculator(b); c.visible(false); b.setServer(); change(b); await tick(); assert.equal(b.gets.length, 0);
  c.visible(true); b.event('focus'); await tick(); assert.equal(c.applied.at(-1).adjusted, true);
});
test('focus plus visibility notifications share one pending GET', async () => {
  const b = browser(), c = calculator(b), wait = deferred(); b.qWaits.push(wait);
  b.event('focus'); b.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(b.gets.length, 1);
  wait.resolve(b.periodAnswer()); await tick(); assert.equal(c.applied.length, 1);
});
test('unsaved calculator inputs are retained and synchronization resumes after save/revert', async () => {
  const b = browser(), c = calculator(b); c.ctx().suspended = true; b.setServer(); change(b); await tick();
  assert.equal(c.applied.length, 0); assert.equal(b.gets.length, 0); assert.equal(c.deferredMessages.length, 1);
  c.ctx().suspended = false; await c.sync.refresh(); assert.equal(c.applied.at(-1).adjusted, true);
});
test('date/session/base replacement while GET runs prevents stale cache or render writes', async () => {
  const b = browser(), c = calculator(b), wait = deferred(); b.setServer(); b.qWaits.push(wait); const pending = c.sync.refresh();
  c.replace({...c.ctx(), identity: 'Bearer other-user'}); wait.resolve(b.periodAnswer()); await pending;
  assert.equal(c.applied.length, 0); assert.equal(b.store.size, 0);
});
test('failed server refresh retains last successful display and adjustment cache', async () => {
  const b = browser(), c = calculator(b); b.setServer(); await c.sync.refresh(); const before = JSON.stringify([...b.store]);
  b.qWaits.push({promise: Promise.resolve(b.answer({ok: false, message: 'GET_FAILED'}, false))});
  await c.sync.refresh({force: true}); assert.equal(c.applied.length, 1); assert.equal(JSON.stringify([...b.store]), before);
  assert.equal(c.errors.length, 1);
});
test('successful but wrong-period server response is not interpreted as CLEAR', async () => {
  const b = browser(), c = calculator(b); b.setServer(); await c.sync.refresh(); const before = JSON.stringify([...b.store]);
  b.qWaits.push({promise: Promise.resolve(b.answer({ok: true, start: spec.startLocal, end: '2026-10-02T00:00', revision: 2, adjustment: null}))});
  await c.sync.refresh({force: true}); assert.equal(c.applied.length, 1); assert.equal(JSON.stringify([...b.store]), before);
});
test('dispose removes listeners and prevents a pending query from repainting', async () => {
  const b = browser(), c = calculator(b), wait = deferred(); b.qWaits.push(wait); const promise = c.sync.refresh(); c.sync.dispose();
  wait.resolve(b.periodAnswer()); await promise; change(b); b.event('focus'); await tick();
  assert.equal(c.applied.length, 0); assert.equal(b.gets.length, 1);
});
test('integration keeps legacy writes blocked and wires actual calculator render/activation/dispose', () => {
  const legacy = read('maintenance/morning-meeting-cofiring-adjustment.js'), ui = read('maintenance/cofiring-period-ui-v5.js');
  assert.match(legacy, /async function openModal\(\)[\s\S]{0,220}CofiringSharedAdjustmentSyncV2\?\.morning\?\.open\(\)/);
  assert.match(legacy, /function requireLegacyMode\(\)[\s\S]{0,180}throw new Error/);
  assert.match(ui, /createCalculatorSync\(\{/); assert.match(ui, /void adjustmentSync\?\.refresh\(\)/);
  assert.match(ui, /void adjustmentSync\?\.refresh\(\{force:true\}\)/); assert.match(ui, /adjustmentSync\?\.dispose\?\.\(\)/);
  assert.match(ui, /renderDisplay\(result,state\)/); assert.match(ui, /suspended:disposed\|\|settingsDirty\|\|manualTouched\|\|!!usageEditSnapshot/);
  const code = read('maintenance/cofiring-shared-adjustment-sync-v2.js');
  assert.doesNotMatch(code, /morning-meeting-cofiring-adjustments|ois-data-requests|daily_data_excel/);
});
test('new loader exists once, after shared engine and before calculator UI', () => {
  const index = read('index.html');
  const loader = '/maintenance/cofiring-shared-adjustment-sync-v2.js';
  assert.equal(index.split(loader).length - 1, 1);
  assert.ok(index.indexOf('/maintenance/cofiring-period-adjustment-v56.js') < index.indexOf(loader));
  assert.ok(index.indexOf(loader) < index.indexOf('/maintenance/cofiring-period-ui-v5.js'));
});
