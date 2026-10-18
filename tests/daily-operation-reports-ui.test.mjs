import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Execute the actual browser module against a small event-driven DOM. This
// verifies behavior/state races, not CSS or browser layout (which need visual QA).
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.attributes = {}; this.dataset = {}; this.style = {}; this.events = new Map();
    this.value = ''; this.className = ''; this.hidden = false; this.disabled = false; this._text = '';
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const present = this.className.split(/\s+/).includes(name), add = force === undefined ? !present : force;
        if (add) this.classList.add(name); else this.classList.remove(name);
        return add;
      },
      contains: name => this.className.split(/\s+/).includes(name)
    };
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
    if (key === 'id') this.id = String(value);
    if (key === 'class') this.className = String(value);
    if (key === 'hidden') this.hidden = true;
    if (key === 'disabled') this.disabled = true;
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; if (key === 'hidden') this.hidden = false; }
  append(...items) {
    for (const item of items) {
      const child = typeof item === 'string' ? Object.assign(new Element('#text'), { _text: item }) : item;
      child.parentNode = this; this.children.push(child);
    }
  }
  replaceChildren(...items) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...items); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get childElementCount() { return this.children.filter(child => child.tagName !== '#TEXT').length; }
  addEventListener(type, handler) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(handler); }
  removeEventListener(type, handler) { this.events.set(type, (this.events.get(type) || []).filter(item => item !== handler)); }
  dispatchEvent(event) { this.emit(event.type, event); return true; }
  emit(type, extras = {}) {
    const event = { type, target: this, currentTarget: this, preventDefault() {}, ...extras };
    for (const handler of this.events.get(type) || []) handler(event);
  }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) {
      const value = attribute[1].startsWith('data-') ? this.dataset[attribute[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.getAttribute(attribute[1]);
      return attribute[2] === undefined ? value !== undefined && value !== null : value === attribute[2];
    }
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(item => item.trim()), found = [];
    const visit = element => {
      for (const child of element.children) {
        if (selectors.some(item => child.matches(item))) found.push(child);
        visit(child);
      }
    };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let element = this; element; element = element.parentNode) if (element.matches(selector)) return element; return null; }
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const copy = value => JSON.parse(JSON.stringify(value));
const record = (date, values = {}, version = 1) => ({ workDate: date, version, schemaVersion: 1,
  values, sources: {}, note: '', authorName: '운전자', updatedByName: '운전자', updatedAt: '2026-10-18T01:00:00Z' });

function harness() {
  const document = new Element('document');
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.querySelector('#' + id);
  document.activeElement = null;
  document.readyState = 'complete';
  const view = new Element('section'); view.id = 'efficiencyDailyOperationView'; document.append(view);
  const records = new Map(), calls = [], sourceCalls = [], events = new Map();
  let token = 'session-one', fetchOverride = null, sourceOverride = null, clearCount = 0;
  const json = (payload, status = 200) => Response.json(payload, { status });
  const sandbox = {
    document, console, URL, URLSearchParams, Headers, Response, Request, AbortController, Date, Intl, Set, Map,
    setTimeout, clearTimeout, queueMicrotask,
    location: { href: 'https://gs.example/index.html' },
    addEventListener(type, handler) { if (!events.has(type)) events.set(type, []); events.get(type).push(handler); },
    removeEventListener(type, handler) { events.set(type, (events.get(type) || []).filter(item => item !== handler)); },
    dispatchEvent(event) { for (const handler of events.get(event.type) || []) handler(event); },
    localStorage: { getItem: key => key === 'gsShiftLog.currentUser' && token ? JSON.stringify({ employeeNo: token, sessionToken: token }) : null },
    confirm: () => true,
    getShiftLogSessionToken: () => token,
    loadCurrentUser: () => token ? { employeeNo: token, sessionToken: token } : null,
    getShiftLogAuthHeaders: extra => ({ ...extra, ...(token ? { Authorization: 'Bearer ' + token } : {}) }),
    saveCurrentUser(user) { token = user.sessionToken; },
    clearCurrentUser() { token = ''; clearCount++; },
    openLoginScreen() {},
    GSDailyOperationSources: {
      async collect(date, options) {
        sourceCalls.push({ date, options });
        if (sourceOverride) return sourceOverride(date, options);
        return { values: {}, sources: {}, warnings: [] };
      }
    },
    async fetch(url, options) {
      const parsed = new URL(url, 'https://gs.example'), method = options.method || 'GET';
      const request = { url: parsed, method, options, body: options.body ? JSON.parse(options.body) : null };
      calls.push(request);
      if (fetchOverride) {
        const result = fetchOverride(request);
        if (result !== undefined) return result;
      }
      if (!new Headers(options.headers).get('Authorization')) return json({ ok: false, message: '로그인 필요' }, 401);
      if (method === 'GET' && parsed.searchParams.has('date')) {
        const date = parsed.searchParams.get('date'), entry = records.get(date);
        return json({ ok: true, workDate: date, version: entry?.version || 0, deleted: !!entry?.deleted, item: entry?.deleted ? null : entry || null });
      }
      if (method === 'GET') return json({ ok: true, items: [...records.values()].filter(item => !item.deleted && item.workDate.startsWith(parsed.searchParams.get('month'))), nextBefore: null });
      const body = request.body, previous = records.get(body.workDate);
      if ((method === 'POST' && previous) || (method !== 'POST' && previous?.version !== body.version)) {
        return json({ ok: false, code: 'VERSION_CONFLICT', version: previous?.version || 0, item: previous, message: '최신 기록을 불러와 주세요.' }, 409);
      }
      if (method === 'DELETE') {
        const tombstone = { workDate: body.workDate, version: body.version + 1, deleted: true };
        records.set(body.workDate, tombstone);
        return json({ ok: true, ...tombstone, item: null });
      }
      const saved = { ...record(body.workDate), ...body, version: body.version + 1 };
      records.set(body.workDate, copy(saved));
      return json({ ok: true, workDate: body.workDate, version: saved.version, item: saved, deleted: false });
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../maintenance/daily-operation-layout.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../maintenance/daily-operation-reports.js', import.meta.url), 'utf8'), context);
  const byId = id => document.getElementById(id);
  const field = id => view.querySelectorAll('[data-dor-field]').find(input => input.dataset.dorField === id);
  const action = (name, date) => view.querySelectorAll('[data-dor-action]').find(button => button.dataset.dorAction === name && (!date || button.dataset.date === date));
  return {
    sandbox, records, calls, sourceCalls, view, document, byId, field, action, json,
    setFetch(fn) { fetchOverride = fn; }, setCollect(fn) { sourceOverride = fn; },
    get token() { return token; }, get clearCount() { return clearCount; },
    async open() { sandbox.openDailyOperationReportView(); await settle(); },
    click(name, date) { const target = action(name, date); assert.ok(target, `action ${name} exists`); document.activeElement = target; view.emit('click', { target }); },
    input(id, value) { const target = field(id); assert.ok(target, `field ${id} exists`); target.value = value; document.activeElement = target; view.emit('input', { target }); },
    navigate(date) { const input = byId('dailyOperationDate'); input.value = date; input.emit('change'); },
    login(next) { sandbox.saveCurrentUser({ employeeNo: next, sessionToken: next }); },
    logout() { sandbox.clearCurrentUser(); },
    fire(type, extras = {}) { sandbox.dispatchEvent({ type, ...extras }); }
  };
}

test('navigation renders only saved matching-date records, clears previous values, and does not query sources', async () => {
  const h = harness(); await h.open();
  h.records.set('2026-10-16', record('2026-10-16', { coal_u1_daily: 123.456 }));
  h.navigate('2026-10-16'); await settle();
  assert.equal(h.field('coal_u1_daily').value, '123.5');
  h.navigate('2026-10-17'); await settle();
  assert.equal(h.field('coal_u1_daily').value, '');
  assert.equal(h.sourceCalls.length, 0);
  assert.match(h.byId('dailyOperationStatus').textContent, /저장자료가 없습니다/);
});

test('late date read and late source collection cannot populate a later selected day', async () => {
  const h = harness(); await h.open();
  const pending = deferred();
  h.setFetch(request => request.url.searchParams.get('date') === '2026-10-16' ? pending.promise : undefined);
  h.navigate('2026-10-16'); await settle();
  h.navigate('2026-10-17'); await settle();
  pending.resolve(h.json({ ok: true, version: 1, item: record('2026-10-16', { coal_u1_daily: 999 }) })); await settle();
  assert.equal(h.byId('dailyOperationDate').value, '2026-10-17');
  assert.equal(h.field('coal_u1_daily').value, '');
  const source = deferred(); h.setCollect(() => source.promise);
  h.click('collect'); await settle();
  h.navigate('2026-10-15'); await settle();
  assert.equal(h.sourceCalls[0].options.signal.aborted, true);
  source.resolve({ values: { coal_u1_daily: 777 }, sources: { coal_u1_daily: { source: 'test', date: '2026-10-17' } }, warnings: [] }); await settle();
  assert.equal(h.byId('dailyOperationDate').value, '2026-10-15');
  assert.equal(h.field('coal_u1_daily').value, '');
});

test('manual edits during source loading win and known zero is imported and saved unchanged', async () => {
  const h = harness(); await h.open(); h.navigate('2026-10-17'); await settle();
  const source = deferred(); h.setCollect(() => source.promise);
  h.click('collect'); await settle();
  h.input('coal_u1_daily', '45.6789');
  source.resolve({ values: { coal_u1_daily: 999, coal_u2_daily: 0 },
    sources: { coal_u1_daily: { source: 'test', date: '2026-10-17' }, coal_u2_daily: { source: 'test', date: '2026-10-17' } }, warnings: [] });
  await settle(); h.click('save'); await settle();
  const saved = h.records.get('2026-10-17');
  assert.equal(saved.values.coal_u1_daily, 45.6789);
  assert.equal(saved.values.coal_u2_daily, 0);
  assert.equal(saved.sources.coal_u1_daily.source, 'manual');
});

test('invalid numeric and malformed grouping stay visible and cannot be saved as null or a different number', async () => {
  const h = harness(); await h.open(); h.navigate('2026-10-17'); await settle();
  for (const value of ['abc', '1.2.3', '1,2', '1,23,4', '1e3', 'Infinity']) {
    h.input('coal_u1_daily', value);
    assert.equal(h.field('coal_u1_daily').value, value);
    assert.equal(h.field('coal_u1_daily').getAttribute('aria-invalid'), 'true', value);
    assert.equal(h.action('save').disabled, true);
    h.click('save'); await settle();
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  }
  h.input('coal_u1_daily', '1,234.567'); h.click('save'); await settle();
  assert.equal(h.records.get('2026-10-17').values.coal_u1_daily, 1234.567);
});

test('version conflict preserves user input and requires explicit latest-record reload', async () => {
  const h = harness(); await h.open();
  h.records.set('2026-10-17', record('2026-10-17', { coal_u1_daily: 10 }));
  h.navigate('2026-10-17'); await settle(); h.input('coal_u1_daily', '11');
  h.records.set('2026-10-17', record('2026-10-17', { coal_u1_daily: 12 }, 2));
  h.click('save'); await settle();
  assert.equal(h.field('coal_u1_daily').value, '11');
  assert.equal(h.byId('dailyOperationConflict').hidden, false);
  assert.equal(h.action('save').disabled, true);
  assert.equal(h.records.get('2026-10-17').values.coal_u1_daily, 12);
  h.click('reload'); await settle();
  assert.equal(h.field('coal_u1_daily').value, '12.0');
  assert.equal(h.byId('dailyOperationConflict').hidden, true);
});

test('delete clears selected report, keeps tombstone version and recreates via conditional PUT', async () => {
  const h = harness(); await h.open(); h.navigate('2026-10-17'); await settle();
  h.input('coal_u1_daily', '5'); h.click('save'); await settle();
  h.click('delete-record', '2026-10-17'); await settle();
  assert.equal(h.field('coal_u1_daily').value, '');
  assert.doesNotMatch(h.byId('dailyOperationSaveState').textContent, /저장된 자료/);
  h.input('coal_u1_daily', '6'); h.click('save'); await settle();
  const writes = h.calls.filter(call => call.method !== 'GET');
  assert.deepEqual(writes.map(call => call.method), ['POST', 'DELETE', 'PUT']);
  assert.equal(writes[2].body.version, 2);
  assert.equal(h.records.get('2026-10-17').version, 3);
});

test('account change clears unsaved state and rejects a prior session late401 without logging out the new account', async () => {
  const h = harness(); await h.open(); h.navigate('2026-10-17'); await settle();
  h.input('coal_u1_daily', '88');
  const late = deferred();
  h.setFetch(request => request.method === 'GET' && request.url.searchParams.has('month') ? late.promise : undefined);
  h.click('refresh-list'); await settle();
  h.login('session-two'); h.fire('storage', { key: 'gsShiftLog.currentUser' }); await settle();
  assert.equal(h.field('coal_u1_daily').value, '');
  late.resolve(h.json({ ok: false, message: 'old expired session' }, 401)); await settle();
  assert.equal(h.token, 'session-two');
  assert.equal(h.clearCount, 0);
  assert.equal(h.field('coal_u1_daily').value, '');
});

test('late successful save from the old account cannot repaint a cleared session', async () => {
  const h = harness(); await h.open(); h.navigate('2026-10-17'); await settle();
  h.input('coal_u1_daily', '77');
  const saved = deferred();
  h.setFetch(request => request.method === 'POST' ? saved.promise : undefined);
  h.click('save'); await settle();
  h.logout(); h.login('session-two'); h.fire('focus'); await settle();
  saved.resolve(h.json({ ok: true, version: 1, item: record('2026-10-17', { coal_u1_daily: 77 }) })); await settle();
  assert.equal(h.token, 'session-two');
  assert.equal(h.field('coal_u1_daily').value, '');
  assert.doesNotMatch(h.byId('dailyOperationStatus').textContent, /자료를 저장했습니다/);
});

test('daily edits invalidate related automatic monthly totals, preserve siblings and warn for manual monthly values', async () => {
  const h = harness(); await h.open();
  const initial = record('2026-10-17', {
    coal_u1_daily: 10, coal_u2_daily: 20, coal_u1_mtd: 100, coal_u2_mtd: 200,
    coal_total_mtd: 300, bio_u1_mtd: 999,
    power_generation_daily: 1000, power_export_daily: 900,
    power_internal_daily: 100, power_generation_mtd: 17000, power_internal_mtd: 1700,
    power_export_mtd: 15000
  });
  initial.sources = { coal_u2_mtd: { source: 'manual', date: '2026-10-17', label: '직접 입력' } };
  h.records.set('2026-10-17', initial); h.navigate('2026-10-17'); await settle();
  h.input('coal_u1_daily', '11');
  assert.equal(h.field('coal_u1_mtd').value, '');
  assert.equal(h.field('coal_total_mtd').value, '');
  assert.equal(h.field('coal_u2_mtd').value, '200.0');
  assert.equal(h.field('bio_u1_mtd').value, '999.0');
  assert.match(h.byId('dailyOperationStatus').textContent, /관련 누계를 비웠습니다/);
  h.input('coal_u2_daily', '21');
  assert.equal(h.field('coal_u2_mtd').value, '200.0');
  assert.match(h.byId('dailyOperationStatus').textContent, /직접 입력한 관련 누계는 유지/);
  h.input('power_generation_daily', '1100');
  assert.equal(h.field('power_generation_mtd').value, '');
  assert.equal(h.field('power_internal_mtd').value, '');
  assert.equal(h.field('power_export_mtd').value, '15,000.0');
});

test('manual blanks and invalidated monthly markers survive save/reload and are passed to collection', async () => {
  const h = harness(); await h.open();
  h.records.set('2026-10-17', record('2026-10-17', { coal_u1_daily: 10, coal_u1_mtd: 100, bio_u1_mtd: 200 }));
  h.navigate('2026-10-17'); await settle(); h.input('coal_u1_daily', '');
  h.click('save'); await settle();
  assert.equal(h.records.get('2026-10-17').sources.coal_u1_mtd.source, 'invalidated_daily_change');
  h.navigate('2026-10-16'); await settle(); h.navigate('2026-10-17'); await settle();
  h.setCollect(() => ({ values: { coal_u1_daily: 888 }, sources: { coal_u1_daily: { source: 'test', date: '2026-10-17' } }, warnings: [] }));
  h.click('collect'); await settle();
  assert.equal(h.field('coal_u1_daily').value, '');
  const options = h.sourceCalls.at(-1).options;
  assert.equal(options.preservedBlankFields.includes('coal_u1_daily'), true);
  assert.equal(options.invalidatedMonthly.includes('coal_u1_mtd'), true);
  assert.equal(options.invalidatedMonthly.includes('bio_u1_mtd'), false);
  assert.equal(options.missingFields.includes('coal_u1_daily'), false);
});
