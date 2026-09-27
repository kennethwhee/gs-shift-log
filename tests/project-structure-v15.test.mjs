import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectWebAssets } from '../scripts/build-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const asset = 'maintenance/efficiency-daily-work-expanded-mode.js';
const moduleSource = read(asset);
const mainSource = read('script.js');
const invocation = '(0, window.GSEfficiencyDailyWorkExpandedMode.install)();';

// A small tree-based DOM: closest follows ancestors, IDs are resolved afresh,
// and events visit capture listeners before target/bubble listeners. Stopping
// propagation still permits other listeners on the same node, as in the DOM.
class EventNode {
  parentNode = null;
  children = [];
  listeners = [];
  append(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  addEventListener(type, callback, options = false) {
    this.listeners.push({ type, callback, capture: options === true || options?.capture === true });
  }
}
class Element extends EventNode {
  attributes = new Map();
  hidden = false;
  textContent = '';
  classes = new Set();
  classList = {
    contains: token => this.classes.has(token),
    add: token => { this.classes.add(token); },
    toggle: (token, force = !this.classes.has(token)) => {
      if (force) this.classes.add(token); else this.classes.delete(token);
      return Boolean(force);
    }
  };
  constructor(id = '') { super(); this.id = id; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim();
      if (value.startsWith('#')) return this.id === value.slice(1);
      if (value.startsWith('.')) return this.classList.contains(value.slice(1));
      throw new Error('Unsupported fixture selector: ' + value);
    });
  }
  closest(selector) {
    for (let node = this; node instanceof Element; node = node.parentNode) {
      if (node.matches(selector)) return node;
    }
    return null;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const descendant = child.querySelector(selector);
      if (descendant) return descendant;
    }
    return null;
  }
}

function createContext() {
  const document = new EventNode();
  document.body = document.append(new Element('fixture-body'));
  document.getElementById = id => document.body.id === id ? document.body : document.body.querySelector('#' + id);
  const frames = [], scrolls = [];
  const context = vm.createContext({ document, Element, requestAnimationFrame: callback => frames.push(callback) });
  context.window = context;
  function click(target) {
    const event = { type: 'click', target, defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; } };
    const route = [];
    for (let node = target; node; node = node.parentNode) route.push(node);
    if (!route.includes(document)) route.push(document);
    function visit(node, capture) {
      for (const listener of node.listeners ?? []) {
        if (listener.type === 'click' && listener.capture === capture) listener.callback(event);
      }
    }
    for (const node of [...route].reverse()) {
      visit(node, true);
      if (event.propagationStopped) return event;
    }
    for (const node of route) {
      visit(node, false);
      if (event.propagationStopped) break;
    }
    return event;
  }
  function addUI({ archiveVisible = true } = {}) {
    const modal = document.body.append(new Element('efficiencyTeamModal'));
    const view = modal.append(new Element('efficiencyDailyWorkView'));
    const dashboard = view.append(new Element('efficiencyDailyWorkDashboard'));
    const button = modal.append(new Element('toggleEfficiencyDailyWorkExpandedButton'));
    button.setAttribute('aria-pressed', 'false');
    const icon = button.append(new Element('expand-icon'));
    const archive = dashboard.append(new Element('efficiencyDailyWorkArchivePanel'));
    archive.hidden = !archiveVisible;
    const archiveButton = dashboard.append(new Element('toggleEfficiencyDailyWorkArchiveButton'));
    const paper = dashboard.append(new Element());
    paper.classList.add('efficiency-daily-work-paper-scroll');
    paper.scrollTo = options => scrolls.push(JSON.parse(JSON.stringify(options)));
    const close = modal.append(new Element('closeEfficiencyTeamModalButton'));
    const footerClose = modal.append(new Element('closeEfficiencyTeamModalFooterButton'));
    return { modal, view, dashboard, button, icon, archive, archiveButton, paper, close, footerClose };
  }
  const load = () => vm.runInContext(moduleSource, context);
  const install = () => vm.runInContext(invocation, context);
  const flushFrames = () => { for (const frame of frames.splice(0)) frame(); };
  return { context, document, frames, scrolls, click, addUI, load, install, flushFrames };
}

function harness(options) {
  const state = createContext();
  state.load(); state.install();
  return { ...state, ui: state.addUI(options) };
}

function assertExpanded(state, expanded, archiveVisible = true) {
  const { ui, document } = state;
  assert.equal(ui.modal.classList.contains('is-daily-work-expanded'), expanded);
  assert.equal(ui.view.classList.contains('is-expanded'), expanded);
  assert.equal(ui.dashboard.classList.contains('is-expanded'), expanded);
  assert.equal(document.body.classList.contains('is-efficiency-daily-work-expanded'), expanded);
  assert.equal(ui.button.getAttribute('aria-pressed'), String(expanded));
  assert.equal(ui.button.textContent, expanded ? '원래 크기' : '크게 보기');
  assert.equal(ui.button.getAttribute('aria-label'), expanded ? '일일업무현황 원래 크기로 보기' : '일일업무현황 크게 보기');
  assert.equal(ui.archive.hidden, expanded || !archiveVisible);
  assert.equal(ui.archive.getAttribute('aria-hidden'), String(expanded || !archiveVisible));
  assert.equal(ui.archiveButton.hidden, expanded);
  assert.equal(ui.archiveButton.getAttribute('aria-expanded'), String(!expanded && archiveVisible));
  assert.equal(ui.dashboard.classList.contains('is-archive-hidden'), expanded || !archiveVisible);
}

test('expanded-view definition loads without binding events or changing the current UI', () => {
  const state = createContext();
  const ui = state.addUI();
  state.load();
  assert.equal(state.document.listeners.length, 0);
  assert.equal(state.context.setEfficiencyDailyWorkExpandedMode, undefined);
  assert.equal(Object.isFrozen(state.context.GSEfficiencyDailyWorkExpandedMode), true);
  state.click(ui.icon);
  assert.equal(ui.button.getAttribute('aria-pressed'), 'false');
  assert.equal(ui.archive.hidden, false);
  assert.equal(state.frames.length, 0);
});

test('early installation survives a later main error and precedes main microtasks', async () => {
  const state = createContext();
  state.load();
  assert.throws(() => vm.runInContext(`
    Promise.resolve().then(() => { window.setterWasReady = typeof window.setEfficiencyDailyWorkExpandedMode === 'function'; });
    ${invocation}
    throw new Error('later main feature failed');
  `, state.context), /later main feature failed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.context.setterWasReady, true);
  state.ui = state.addUI();
  state.click(state.ui.icon);
  assertExpanded(state, true);
  assert.ok(mainSource.indexOf(invocation) < mainSource.indexOf('const AUTH_STORAGE_KEY'), 'install must stay before login initialization');
});

test('enlarging and restoring remembers either initial archive visibility', () => {
  for (const archiveVisible of [true, false]) {
    const state = harness({ archiveVisible });
    state.click(state.ui.button);
    assertExpanded(state, true, archiveVisible);
    state.click(state.ui.button);
    assertExpanded(state, false, archiveVisible);
  }
});

test('a nested expand control is intercepted in capture before competing bubble handlers', () => {
  const state = harness();
  const visited = [];
  state.ui.button.addEventListener('click', () => visited.push('button'));
  state.document.addEventListener('click', () => visited.push('document bubble'));
  state.document.addEventListener('click', () => visited.push('same document capture'), true);
  const event = state.click(state.ui.icon);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(visited, ['same document capture']);
  assertExpanded(state, true);
});

test('either modal close button restores size without consuming the existing close action', () => {
  for (const closeName of ['close', 'footerClose']) {
    const state = harness({ archiveVisible: false });
    state.click(state.ui.icon);
    let closed = false;
    state.ui[closeName].addEventListener('click', () => { closed = true; });
    const icon = state.ui[closeName].append(new Element());
    const event = state.click(icon);
    assertExpanded(state, false, false);
    assert.equal(closed, true);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
  }
});

test('delegation works for a modal inserted or replaced after installation', () => {
  const state = createContext();
  state.load(); state.install();
  state.ui = state.addUI();
  state.click(state.ui.icon);
  assertExpanded(state, true);
  state.context.setEfficiencyDailyWorkExpandedMode(false);
  state.ui.modal.remove();
  state.ui = state.addUI({ archiveVisible: false });
  state.click(state.ui.icon);
  assertExpanded(state, true, false);
  state.click(state.ui.icon);
  assertExpanded(state, false, false);
});

test('missing required modal or expand control makes external calls harmless', () => {
  for (const missing of ['modal', 'button']) {
    const state = harness();
    state.ui[missing].remove();
    assert.doesNotThrow(() => state.context.setEfficiencyDailyWorkExpandedMode(true));
    assert.equal(state.document.body.classList.contains('is-efficiency-daily-work-expanded'), false);
    assert.equal(state.frames.length, 0);
  }
});

test('optional dashboard, archive, view and scroll elements may be absent', () => {
  const state = harness();
  state.ui.view.remove();
  state.click(state.ui.icon);
  assert.equal(state.ui.button.getAttribute('aria-pressed'), 'true');
  assert.equal(state.ui.modal.classList.contains('is-daily-work-expanded'), true);
  assert.doesNotThrow(state.flushFrames);
  assert.deepEqual(state.scrolls, []);
  state.click(state.ui.icon);
  assert.equal(state.ui.button.getAttribute('aria-pressed'), 'false');
  assert.equal(state.document.body.classList.contains('is-efficiency-daily-work-expanded'), false);
});

test('reloading and reinstalling do not attach a second toggle or replace the external setter', () => {
  const state = harness();
  const setter = state.context.setEfficiencyDailyWorkExpandedMode;
  state.load(); state.install(); state.install();
  assert.equal(state.context.setEfficiencyDailyWorkExpandedMode, setter);
  state.click(state.ui.icon);
  assertExpanded(state, true);
  assert.equal(state.frames.length, 1);
});

test('external callers can expand and restore using the same UI and archive state', () => {
  const state = harness();
  state.context.setEfficiencyDailyWorkExpandedMode(true);
  assertExpanded(state, true);
  state.context.setEfficiencyDailyWorkExpandedMode(false);
  assertExpanded(state, false);
});

test('unrelated elements and non-Element event targets leave other click actions alone', () => {
  const state = harness();
  const unrelated = state.ui.modal.append(new Element('other-control'));
  for (const target of [unrelated, { parentNode: state.ui.button }, null]) {
    const event = state.click(target);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
    assert.equal(state.ui.button.getAttribute('aria-pressed'), 'false');
  }
  assert.equal(state.frames.length, 0);
});

test('expand scroll waits for an animation frame; restore does not queue a new scroll', () => {
  const state = harness();
  state.click(state.ui.icon);
  assert.deepEqual(state.scrolls, []);
  assert.equal(state.frames.length, 1);
  state.flushFrames();
  assert.deepEqual(state.scrolls, [{ top: 0, left: 0, behavior: 'smooth' }]);
  state.click(state.ui.icon);
  assert.equal(state.frames.length, 0);
  state.flushFrames();
  assert.equal(state.scrolls.length, 1);
});

test('PC ships the new definition before the existing search definition and main, using classic defer', async () => {
  const scripts = [...read('index.html').matchAll(/<script\b([^>]*)>\s*<\/script>/gi)]
    .map(m => ({ attributes: m[1], url: m[1].match(/\bsrc="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&') }));
  const locate = target => {
    const matches = scripts.filter(script => script.url?.split('?')[0] === target);
    assert.equal(matches.length, 1, target + ' must load exactly once');
    return matches[0];
  };
  const definition = locate(asset);
  const search = locate('maintenance/shift-log-search-matched-items.js');
  const main = locate('script.js');
  for (const script of [definition, search, main]) {
    assert.match(script.attributes, /\bdefer\b/);
    assert.doesNotMatch(script.attributes, /\basync\b|\btype\s*=\s*["']module/i);
    assert.ok(script.url.split('?')[1], 'each definition needs a cache version');
  }
  assert.equal(scripts.indexOf(definition) + 1, scripts.indexOf(search));
  assert.equal(scripts.indexOf(search) + 1, scripts.indexOf(main));
  assert.equal(definition.url, asset + '?v=20260927-structure-v15');
  assert.equal(search.url, 'maintenance/shift-log-search-matched-items.js?v=20260927-structure-v14');
  const mainParameters = new URL('https://example.invalid/' + main.url).searchParams;
  assert.equal(mainParameters.get('v'), '20260927-structure-v15');
  assert.equal(mainParameters.get('limestone'), '20260925-v1');
  assert.equal(mainParameters.get('closedcards'), '20260927-v1', 'preserve the concurrent closed-data card release');
  assert.equal(mainSource.split(invocation).length - 1, 1);
  assert.doesNotMatch(mainSource, /function initializeEfficiencyDailyWorkExpandedModeFinal/);
  assert.ok((await collectWebAssets(root)).includes(asset));
  assert.doesNotMatch(read('mobile-app/index.html'), /efficiency-daily-work-expanded-mode\.js/);
});
