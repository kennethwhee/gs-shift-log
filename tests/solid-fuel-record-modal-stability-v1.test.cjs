'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('maintenance/cofiring-solid-fuel-management-tab-v2.js', 'utf8');

function fixture() {
  const pending = new Map(), writes = [], attributes = {};
  let nextId = 1;
  const state = { bottom: 1040, modalOpen: false, loaded: '1', height: 900, width: 1100 };
  const page = { getBoundingClientRect: () => ({ bottom: state.bottom }) };
  const doc = {
    body: {},
    documentElement: { dataset: { get solidFuelLoaded() { return state.loaded; } } },
    querySelector: selector => selector === 'main.page' ? page : state.modalOpen ? {} : null,
    defaultView: { scrollY: 0, getComputedStyle: () => ({ paddingBottom: '9px', marginBottom: '0px' }) }
  };
  const frame = {
    hidden: false, isConnected: true, contentDocument: doc,
    parentElement: { hidden: false, setAttribute: (key, value) => { attributes[key] = value; } },
    getBoundingClientRect: () => ({ height: state.height, width: state.width }),
    removeAttribute() {},
    style: { set height(value) { writes.push(value); state.height = parseFloat(value); } }
  };
  const window = {
    getComputedStyle: () => ({ minHeight: '720px' }),
    requestAnimationFrame: callback => { const id = nextId++; pending.set(id, callback); return id; },
    cancelAnimationFrame: id => pending.delete(id),
    clearTimeout() {}
  };
  const context = vm.createContext({ window });
  vm.runInContext(src.slice(0, src.indexOf('  function findEmbeddedTab')) +
    'globalThis.host = { embeddedDocumentHeight, resizeFrameToContent, scheduleFrameResize, frameStates }; })();', context);
  context.host.frameStates.set(frame, { doc, raf: 0, slowTimer: 0 });
  const flush = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn()); };
  return { ...context.host, frame, state, writes, attributes, pending, flush };
}

test('repeated resize requests share one frame and never collapse the viewport', () => {
  const f = fixture();
  for (let i = 0; i < 50; i++) f.scheduleFrameResize(f.frame);
  assert.equal(f.pending.size, 1);
  assert.deepEqual(f.writes, []);
  f.flush();
  assert.deepEqual(f.writes, ['1057px']);
  assert.equal(f.attributes['aria-busy'], 'false');
  f.scheduleFrameResize(f.frame); f.flush();
  assert.deepEqual(f.writes, ['1057px'], 'unchanged content must not write height again');
});

test('measurement uses content and can shrink without a temporary height reset', () => {
  const f = fixture();
  f.state.height = 2000;
  f.state.bottom = 880;
  f.resizeFrameToContent(f.frame);
  assert.deepEqual(f.writes, ['897px']);
  f.state.bottom = 200;
  f.resizeFrameToContent(f.frame);
  assert.deepEqual(f.writes, ['897px', '720px']);
});

test('an open record dialog retains its viewport through background data changes', () => {
  const f = fixture();
  f.state.modalOpen = true;
  f.state.bottom = 1500;
  f.scheduleFrameResize(f.frame); f.flush();
  assert.deepEqual(f.writes, []);
  assert.equal(f.state.height, 900);
  f.state.modalOpen = false;
  f.scheduleFrameResize(f.frame); f.flush();
  assert.deepEqual(f.writes, ['1517px']);
});

test('hidden tabs and pending initial data never overwrite a retained height', () => {
  const f = fixture();
  f.frame.parentElement.hidden = true;
  f.resizeFrameToContent(f.frame);
  f.frame.parentElement.hidden = false;
  f.state.width = 0;
  f.resizeFrameToContent(f.frame);
  f.state.width = 1100; f.state.loaded = undefined;
  f.resizeFrameToContent(f.frame);
  assert.deepEqual(f.writes, []);
  assert.equal(f.attributes['aria-busy'], undefined);
  f.state.loaded = '1';
  f.resizeFrameToContent(f.frame);
  assert.deepEqual(f.writes, ['1057px']);
});
