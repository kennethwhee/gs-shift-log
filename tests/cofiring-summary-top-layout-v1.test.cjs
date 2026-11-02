'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the production arrangeResults closure, not a reimplementation of it.
function loadArrange() {
  const filename = path.join(__dirname, '../maintenance/cofiring-usage-layout-v1.js');
  const source = fs.readFileSync(filename, 'utf8');
  const marker = '  function observeView(view) {';
  assert.equal(source.split(marker).length, 2, 'one closure capture point');
  const document = { readyState: 'loading', activeElement: null, addEventListener() {} };
  const window = {};
  vm.runInNewContext(source.replace(marker, '  window.testArrangeResults = arrangeResults;\n' + marker),
    { document, window }, { filename });
  return { arrange: window.testArrangeResults, document };
}

// Small tree API used by the real function. Detaching a focused ancestor clears
// focus, so an unnecessary panel move would fail the preservation assertions.
class Element {
  constructor(document, className = '', text = '') {
    this.document = document;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.classes = new Set(className.split(/\s+/).filter(Boolean));
    this.classList = { contains: value => this.classes.has(value), add: value => this.classes.add(value) };
    this._text = text;
    this.listeners = new Map();
    this.moves = 0;
  }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] || null;
  }
  contains(node) {
    for (let cursor = node; cursor; cursor = cursor.parentElement) if (cursor === this) return true;
    return false;
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
    if (/^\[[^=\]]+\]$/.test(selector)) return this.attributes.has(selector.slice(1, -1));
    throw new Error('Unexpected selector: ' + selector);
  }
  closest(selector) {
    for (let cursor = this; cursor; cursor = cursor.parentElement) if (cursor.matches(selector)) return cursor;
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  insertBefore(node, reference) {
    if (node === reference) return;
    if (reference && reference.parentElement !== this) throw new Error('Foreign insert reference');
    node.remove();
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    this.children.splice(index, 0, node);
    node.parentElement = this;
    node.moves++;
  }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  before(node) { this.parentElement.insertBefore(node, this); }
  after(node) { this.parentElement.insertBefore(node, this.nextElementSibling); }
  replaceWith(node) { this.before(node); this.remove(); }
  remove() {
    if (!this.parentElement) return;
    if (this.contains(this.document.activeElement)) this.document.activeElement = null;
    const parent = this.parentElement;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
    this.moves++;
  }
  replaceChildren(...nodes) {
    for (const child of this.children.slice()) child.remove();
    this.append(...nodes);
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener.call(this, event); }
}

function fixture() {
  const { arrange, document } = loadArrange();
  const sheet = new Element(document, 'cfv5-sheet');
  const results = new Element(document, 'cfv-results-dark');
  const grid = new Element(document);
  grid.attributes.set('data-cfv52-summary-grid', '');
  const first = new Element(document, 'cfv52-card', '1호기 조정값');
  const second = new Element(document, 'cfv52-card', '2호기 조정값');
  const total = new Element(document, 'cfv52-card-total', '종합 혼소율 25.37%');
  const panel = new Element(document, 'cfv52-manual-panel');
  const input = new Element(document);
  input.value = '17.25';
  let inputEvents = 0;
  input.addEventListener('input', () => inputEvents++);
  panel.append(input);
  grid.append(first, second, total);
  results.append(grid, panel);
  sheet.append(results);
  document.activeElement = input;
  return { arrange, document, sheet, results, grid, first, second, total, panel, input,
    get inputEvents() { return inputEvents; } };
}

test('production arranger hoists the same green summary before unit cards and preserves manual controls', () => {
  const f = fixture();
  const panelMoves = f.panel.moves;
  f.arrange(f.panel);
  assert.deepEqual(f.results.children, [f.total, f.grid, f.panel]);
  assert.equal(f.total.parentElement, f.results);
  assert.equal(f.total.textContent, '종합 혼소율 25.37%');
  assert.deepEqual(f.grid.children, [f.first, f.second]);
  assert.equal(f.panel.moves, panelMoves);
  assert.equal(f.document.activeElement, f.input);
  assert.equal(f.input.value, '17.25');
  f.input.dispatchEvent({ type: 'input' });
  assert.equal(f.inputEvents, 1);
  const movements = [f.total.moves, f.grid.moves, f.panel.moves];
  for (let index = 0; index < 5; index++) f.arrange(f.panel);
  assert.deepEqual([f.total.moves, f.grid.moves, f.panel.moves], movements);
  assert.deepEqual(f.results.children, [f.total, f.grid, f.panel]);
});

test('a fresh rendered green summary replaces the previous summary without duplicate cards or reordered adjustments', () => {
  const f = fixture();
  f.arrange(f.panel);
  const adjusted1 = new Element(f.document, 'cfv52-card', '1호기 최신 조정');
  const adjusted2 = new Element(f.document, 'cfv52-card', '2호기 최신 조정');
  const freshTotal = new Element(f.document, 'cfv52-card-total', '종합 혼소율 26.12%');
  f.grid.replaceChildren(adjusted1, adjusted2, freshTotal);
  f.input.value = '21.75';
  f.arrange(f.panel);
  assert.deepEqual(f.results.children, [freshTotal, f.grid, f.panel]);
  assert.deepEqual(f.grid.children, [adjusted1, adjusted2]);
  assert.deepEqual(f.results.querySelectorAll('.cfv52-card-total'), [freshTotal]);
  assert.equal(f.total.parentElement, null);
  assert.equal(freshTotal.textContent, '종합 혼소율 26.12%');
  assert.equal(f.document.activeElement, f.input);
  assert.equal(f.input.value, '21.75');
  f.input.dispatchEvent({ type: 'input' });
  assert.equal(f.inputEvents, 1);
  f.arrange(f.panel);
  assert.equal(f.results.querySelectorAll('.cfv52-card-total').length, 1);
});

test('clearing the result grid removes its stale green summary while retaining the existing usage panel', () => {
  const f = fixture();
  f.arrange(f.panel);
  f.grid.replaceChildren();
  f.arrange(f.panel);
  assert.deepEqual(f.results.children, [f.grid, f.panel]);
  assert.equal(f.total.parentElement, null);
  assert.equal(f.results.querySelector('.cfv52-card-total'), null);
  assert.equal(f.document.activeElement, f.input);
  assert.equal(f.input.value, '17.25');
  const movements = [f.grid.moves, f.panel.moves];
  f.arrange(f.panel);
  assert.deepEqual([f.grid.moves, f.panel.moves], movements);
});
