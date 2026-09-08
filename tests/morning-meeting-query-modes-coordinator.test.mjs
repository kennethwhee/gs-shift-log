import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const first = script.indexOf('(function installMorningMeetingAutoRetryButtons()');
const last = script.indexOf('\n})();', first);
assert.ok(first >= 0 && last > first, 'The real morning meeting coordinator must exist.');
const coordinator = script.slice(first, last + '\n})();'.length);
const BULK_ID = 'loadEfficiencyMorningMeetingWaterButton';
const DATE_IDS = ['efficiencyMorningMeetingLimestonePreviousButton', 'efficiencyMorningMeetingLimestoneTodayButton',
  'efficiencyMorningMeetingLimestoneNextButton', 'efficiencyMorningMeetingAutoDatePicker'];
const STATUS_IDS = {
  water: 'efficiencyMorningMeetingAutoWaterStatus', limestone: 'efficiencyMorningMeetingAutoLimestoneStatus',
  gear: 'efficiencyMorningMeetingAutoGearPinionStatus', silo: 'efficiencyMorningMeetingAutoSiloStatus'
};
const LOADERS = {
  water: 'loadEfficiencyMorningMeetingWaterTreatment', limestone: 'loadLimestoneOisStock',
  gear: 'loadEfficiencyMorningMeetingGearPinion', silo: 'loadEfficiencyMorningMeetingSiloLevel',
  smp: 'loadEfficiencyMorningMeetingSmpPrice', weather: 'loadEfficiencyMorningMeetingWeather'
};
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.id = ''; this.className = ''; this.dataset = {};
    this.children = []; this.parentElement = null; this.attributes = new Map(); this.listeners = new Map();
    this.style = {}; this.textContent = ''; this.hidden = false; this.value = '';
    if (['BUTTON', 'INPUT'].includes(this.tagName)) this.disabled = false;
    this.classList = { contains: name => this.className.split(/\s+/).includes(name) };
  }
  get isConnected() { return this.tagName === 'BODY' || Boolean(this.parentElement?.isConnected); }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, next) {
    if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
    child.parentElement = this;
    const index = next ? this.children.indexOf(next) : -1;
    if (index >= 0) this.children.splice(index, 0, child); else this.children.push(child);
    return child;
  }
  matches(selector) {
    return selector.startsWith('#') ? this.id === selector.slice(1) :
      selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName.toLowerCase() === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(type, listener, capture = false) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, capture: capture === true }); this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener, capture = false) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.listener !== listener || item.capture !== (capture === true)));
  }
  dispatch(type, options = {}) {
    const event = { type, target: this, currentTarget: this, defaultPrevented: false, immediateStopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
      stopImmediatePropagation() { this.immediateStopped = true; }, ...options };
    const listeners = [...(this.listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const { listener } of listeners) { listener(event); if (event.immediateStopped) break; }
    return event;
  }
  click() { return this.disabled || this.hidden ? null : this.dispatch('click'); }
}

function harness() {
  const document = new Element('body'); document.readyState = 'complete';
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.querySelectorAll(`#${id}`)[0] || null;
  const make = (id, tag = 'div', parent = document, className = '') => {
    const element = new Element(tag); element.id = id; element.className = className; parent.appendChild(element); return element;
  };
  const panel = make('efficiencyMorningMeetingWaterPanel'); panel.dataset.morningMeetingAutoBaseDate = '2026-09-04';
  const preview = make('efficiencyMorningMeetingAutoPreview', 'div', panel);
  const bulk = make(BULK_ID, 'button', preview);
  for (const id of DATE_IDS) make(id, id.endsWith('Picker') ? 'input' : 'button', preview);
  const wrap = make('efficiencyMorningMeetingAutoDatePickerWrap', 'label', preview);
  wrap.setAttribute('tabindex', '0'); wrap.style.pointerEvents = 'auto';
  const preserved = make('efficiencyMorningMeetingWorkDatePreviousButton', 'button', preview); preserved.disabled = true;
  for (const [key, id] of Object.entries(STATUS_IDS)) {
    const row = make(`${key}-actions`, 'div', preview, 'efficiency-morning-meeting-auto-card__status-actions');
    make(id, 'span', row);
  }
  const calls = [], behaviors = {}, observers = [], timers = new Map();
  let token = 'session-token', mobile = false, modeBusy = false, timerId = 0;
  const window = {
    navigator: { userAgent: 'Windows', platform: 'Win32', maxTouchPoints: 0 },
    matchMedia: () => ({ matches: mobile }), efficiencyMorningMeetingUploadState: {},
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    morningMeetingQuerySources: { isBusy: () => modeBusy, query() { throw Error('Operations must not recursively enter the mode UI.'); } },
    loadEfficiencyMorningMeetingDailyData() { calls.push({ key: 'workbook' }); throw Error('An operations query cannot read Excel.'); }
  };
  for (const [key, name] of Object.entries(LOADERS)) window[name] = options => {
    calls.push({ key, options: plain(options) });
    return behaviors[key] ? behaviors[key](options) : Promise.resolve({ key, sourceDate: panel.dataset.morningMeetingAutoBaseDate });
  };
  const context = vm.createContext({ window, document, Date, Map, Set, Promise,
    console: { log() {}, warn() {}, error() {} }, getShiftLogSessionToken: () => token,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; }
      disconnect() { this.disconnected = true; }
    }
  });
  vm.runInContext(coordinator, context, { filename: 'actual-morning-meeting-coordinator.js' });
  const flush = () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  };
  return { window, document, panel, preview, bulk, wrap, preserved, calls, behaviors, observers, timers, flush,
    byId: document.getElementById, run: options => window.runEfficiencyMorningMeetingBulkLookup(options),
    token: value => { token = value; }, mobile: value => { mobile = value; },
    busy: value => { modeBusy = value; }, announce: () => document.dispatch('morningMeetingQueryModeStateChanged') };
}

const request = { userInitiated: true, targetDate: '2026-09-04' };

test('actual operations hook starts six source loaders together, deduplicates the run and never reads Excel', async () => {
  const h = harness(), pending = deferred();
  for (const key of Object.keys(LOADERS)) h.behaviors[key] = () => pending.promise;
  const firstRun = h.run(request);
  assert.equal(h.run(request), firstRun, 'A duplicate operation must reuse its active promise.');
  assert.deepEqual(h.calls.map(call => call.key).sort(), Object.keys(LOADERS).sort());
  assert.ok(h.calls.every(call => call.options.forceRefresh === false));
  pending.resolve({ complete: true });
  const results = plain(await firstRun);
  assert.equal(results.length, 6);
  assert.ok(results.every(item => item.status === 'fulfilled'));
  assert.equal(h.calls.length, 6);
  assert.equal(h.window.__efficiencyMorningMeetingBulkLookupPromise, undefined);
});

test('operations entry requires explicit intent, authenticated desktop and the exact valid selected date', async () => {
  const cases = [
    ['automatic', h => {}, {}],
    ['signed out', h => h.token(''), request],
    ['narrow screen', h => h.mobile(true), request],
    ['mobile browser', h => { h.window.navigator.userAgent = 'Android Mobile'; }, request],
    ['iPad desktop identity', h => { h.window.navigator.platform = 'MacIntel'; h.window.navigator.maxTouchPoints = 5; }, request],
    ['missing date', h => { h.panel.dataset.morningMeetingAutoBaseDate = ''; }, request],
    ['invalid calendar day', h => { h.panel.dataset.morningMeetingAutoBaseDate = '2026-02-30'; }, { userInitiated: true }],
    ['late intent for old date', h => { h.panel.dataset.morningMeetingAutoBaseDate = '2026-10-01'; }, request]
  ];
  for (const [label, setup, options] of cases) {
    const h = harness(); setup(h);
    assert.equal(await h.run(options), null, label);
    assert.equal(h.calls.length, 0, `${label}: no source may be contacted`);
    assert.equal(h.bulk.disabled, false, `${label}: rejected intent must not acquire the query lock`);
  }
});

test('date and individual controls remain locked after operations finish until the Excel mode task ends', async () => {
  const h = harness(), pending = deferred(); h.busy(true); h.announce();
  h.behaviors.water = () => pending.promise;
  const run = h.run(request);
  for (const id of DATE_IDS) assert.equal(h.byId(id).disabled, true);
  assert.equal(h.wrap.getAttribute('aria-disabled'), 'true');
  pending.resolve({ complete: true }); await run; h.flush();
  for (const id of DATE_IDS) assert.equal(h.byId(id).disabled, true, `${id}: Excel is still reading`);
  const retry = h.byId('efficiencyMorningMeetingAutoRetry-water');
  assert.equal(retry.disabled, true);
  const before = h.calls.length;
  retry.disabled = false; retry.dispatch('click');
  assert.equal(h.calls.length, before, 'The retry callback must also reject a busy mode, even if another renderer re-enables it.');
  const blocked = h.wrap.dispatch('click');
  assert.equal(blocked.defaultPrevented, true); assert.equal(blocked.immediateStopped, true);
  h.busy(false); h.announce(); h.flush();
  for (const id of DATE_IDS) assert.equal(h.byId(id).disabled, false);
  assert.equal(retry.disabled, false);
  assert.equal(h.wrap.getAttribute('aria-disabled'), null);
  assert.equal(h.wrap.getAttribute('tabindex'), '0');
  assert.equal(h.wrap.style.pointerEvents, 'auto');
  assert.equal(h.wrap.dispatch('click').defaultPrevented, false, 'The temporary capture blocker must be removed.');
  assert.equal(h.preserved.disabled, true, 'An originally disabled control remains disabled.');
});

test('an Excel-only mode state event locks and restores operations/date controls without starting operations', () => {
  const h = harness(); h.busy(true); h.announce();
  for (const id of DATE_IDS) assert.equal(h.byId(id).disabled, true);
  assert.equal(h.byId('efficiencyMorningMeetingAutoRetry-water').disabled, true);
  assert.equal(h.calls.length, 0);
  h.busy(false); h.announce();
  for (const id of DATE_IDS) assert.equal(h.byId(id).disabled, false);
  assert.equal(h.byId('efficiencyMorningMeetingAutoRetry-water').disabled, false);
  assert.equal(h.calls.length, 0);
});

test('legacy bulk button routes one all-mode intent; its operations hook never routes recursively', async () => {
  const h = harness(), modes = []; let completion;
  h.window.morningMeetingQuerySources.query = (mode, options) => {
    modes.push({ mode, options: plain(options) });
    h.busy(true); h.announce();
    completion = h.run({ ...options, targetDate: h.panel.dataset.morningMeetingAutoBaseDate })
      .finally(() => { h.busy(false); h.announce(); });
    return completion;
  };
  h.bulk.click();
  assert.deepEqual(modes, [{ mode: 'all', options: { userInitiated: true } }]);
  await completion; h.flush();
  assert.equal(modes.length, 1);
  assert.deepEqual(h.calls.map(call => call.key).sort(), Object.keys(LOADERS).sort());
  assert.equal((h.bulk.listeners.get('click') || []).length, 1, 'Repeated sync must not add another routing handler.');
});

test('operations preserve completed source reuse while querying a Gear result from the wrong date', async () => {
  const h = harness();
  for (const id of [STATUS_IDS.limestone, STATUS_IDS.gear, STATUS_IDS.silo]) h.byId(id).className = 'is-complete';
  h.window.efficiencyMorningMeetingUploadState.gearPinion = { sourceDate: '2026-08-31' };
  const result = plain(await h.run(request));
  assert.deepEqual(h.calls.map(call => call.key).sort(), ['water', 'gear', 'smp', 'weather'].sort());
  const skipped = result.filter(item => item.value?.status === 'skipped-complete').map(item => item.value.key);
  assert.deepEqual(skipped.sort(), ['limestone', 'silo-level']);
});

test('a rejected operation does not cancel the other five source queries or leave controls locked', async () => {
  const h = harness(); h.behaviors.water = async () => { throw Error('OIS unavailable'); };
  const result = plain(await h.run(request)); h.flush();
  assert.equal(result.filter(item => item.status === 'rejected').length, 1);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 5);
  assert.equal(h.calls.length, 6);
  for (const id of DATE_IDS) assert.equal(h.byId(id).disabled, false);
  assert.equal(h.bulk.disabled, false);
});

test('coordinator observer coalesces updates and stops writing unchanged disabled/text properties after synchronization', () => {
  const h = harness(), writes = [], records = [];
  const controls = [...h.preview.querySelectorAll('button'), ...h.preview.querySelectorAll('input')];
  for (const element of controls) {
    for (const property of ['disabled', 'textContent']) {
      let value = element[property];
      Object.defineProperty(element, property, {
        configurable: true,
        get: () => value,
        set: next => {
          // DOM setters can report a mutation even when assigned their current value.
          writes.push({ id: element.id, property, previous: value, next }); value = next;
          records.push({ target: element, type: property === 'disabled' ? 'attributes' : 'childList',
            attributeName: property === 'disabled' ? 'disabled' : undefined });
        }
      });
    }
  }
  const previewObserver = h.observers.find(item => item.target === h.preview);
  const drain = () => {
    for (let turn = 0; turn < 10 && (records.length || h.timers.size); turn += 1) {
      if (records.length) previewObserver.callback(records.splice(0));
      h.flush();
    }
    assert.equal(records.length, 0, 'Synchronization must reach a stable DOM instead of producing another mutation batch.');
    assert.equal(h.timers.size, 0, 'No synchronization timer may remain scheduled by its own unchanged writes.');
  };
  for (let index = 0; index < 4; index += 1) previewObserver.callback([{ type: 'childList', target: h.preview }]);
  assert.equal(h.timers.size, 1, 'Several external mutations share a single synchronization task.');
  drain();
  assert.equal(writes.length, 0, 'An already synchronized idle view does not rewrite its label or controls.');

  h.busy(true); h.announce(); drain();
  const lockedWrites = writes.length;
  assert.ok(lockedWrites > 0, 'The transition into a query actually locks the controls.');
  for (let index = 0; index < 3; index += 1) previewObserver.callback([{ type: 'attributes', attributeName: 'disabled' }]);
  assert.equal(h.timers.size, 1); drain();
  assert.equal(writes.length, lockedWrites, 'An unchanged busy view does not repeatedly set disabled=true.');

  h.busy(false); h.announce(); drain();
  const idleWrites = writes.length;
  assert.ok(idleWrites > lockedWrites, 'The ending event actually restores controls.');
  previewObserver.callback([{ type: 'childList', target: h.preview }]); drain();
  assert.equal(writes.length, idleWrites, 'The restored idle label does not schedule an endless observer/timer loop.');
  assert.equal(h.calls.length, 0);
});
