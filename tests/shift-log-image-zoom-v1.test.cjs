'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
function controllerSource() {
  const start = source.indexOf('function createAttachmentImageZoomController(');
  const end = source.indexOf('/* ATTACHMENT_IMAGE_ZOOM_V1_END */', start);
  assert.ok(start >= 0 && end > start, 'Image zoom controller source is available');
  return source.slice(start, end);
}
class FakeNode {
  constructor(id) {
    this.id = id; this.listeners = new Map(); this.attributes = new Map(); this.captures = new Set();
    this.disabled = false; this.textContent = ''; this.hidden = false; this.tagName = 'DIV';
    this._src = ''; this.complete = true;
    Object.defineProperty(this, 'src', {
      get: () => this._src,
      set: value => {
        this._src = String(value); this.attributes.set('src', String(value));
        this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0;
      }
    });
    this.clientWidth = 1000; this.clientHeight = 700; this.left = 100; this.top = 50;
    this.style = { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } };
    const values = new Set();
    this.classList = { add: (...keys) => keys.forEach(key => values.add(key)), remove: (...keys) => keys.forEach(key => values.delete(key)), contains: key => values.has(key), toggle(key, force) { const enabled = force ?? !values.has(key); if (enabled) values.add(key); else values.delete(key); return enabled; } };
  }
  addEventListener(type, callback, options) { const list = this.listeners.get(type) || []; list.push({ callback, options }); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.callback !== callback)); }
  emit(type, values = {}) {
    const event = { type, target: this, currentTarget: this, cancelable: true, defaultPrevented: false, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', clientX: this.left + this.clientWidth / 2, clientY: this.top + this.clientHeight / 2, deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false,
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
    for (const { callback } of [...(this.listeners.get(type) || [])]) callback.call(this, event);
    return event;
  }
  setAttribute(key, value) { if (key === 'src') this.src = value; else this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); if (key === 'src') { this._src = ''; this.complete = true; this.naturalWidth = this.naturalHeight = 0; } }
  getBoundingClientRect() { return { x: this.left, y: this.top, left: this.left, top: this.top, right: this.left + this.clientWidth, bottom: this.top + this.clientHeight, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  closest(selector) { return selector.includes('button') && this.tagName === 'BUTTON' ? this : null; }
  contains(node) { return node === this || node.parentElement === this; }
  focus() {}
}
function setup({ naturalWidth = 2000, naturalHeight = 1000, ready = true } = {}) {
  const ids = ['attachmentPreviewViewport', 'attachmentPreviewImage', 'attachmentPreviewZoomOut', 'attachmentPreviewZoomIn', 'attachmentPreviewZoomFit', 'attachmentPreviewZoomValue'];
  const nodes = Object.fromEntries(ids.map(id => [id, new FakeNode(id)]));
  const modal = new FakeNode('attachmentPreviewModal'); modal.classList.add('is-open');
  modal.querySelector = selector => nodes[selector.replace(/^#/, '')] || null;
  const viewport = nodes.attachmentPreviewViewport, image = nodes.attachmentPreviewImage;
  image.naturalWidth = naturalWidth; image.naturalHeight = naturalHeight; image.parentElement = viewport;
  for (const id of ['attachmentPreviewZoomOut', 'attachmentPreviewZoomIn', 'attachmentPreviewZoomFit']) nodes[id].tagName = 'BUTTON';
  const observers = [];
  class ResizeObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(node) { this.target = node; }
    disconnect() { this.target = null; }
    unobserve() { this.target = null; }
  }
  const window = new FakeNode('window');
  const document = new FakeNode('document'); document.getElementById = id => id === modal.id ? modal : nodes[id] || null;
  const context = vm.createContext({ console, Math, Number, Map, Set, Object, ResizeObserver, window, document, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame: () => {}, setTimeout: callback => { callback(); return 1; }, clearTimeout: () => {} });
  window.requestAnimationFrame = context.requestAnimationFrame; window.cancelAnimationFrame = context.cancelAnimationFrame;
  vm.runInContext(controllerSource(), context);
  const controller = context.createAttachmentImageZoomController(modal);
  controller.reset(); if (ready) controller.loaded();
  return { context, modal, viewport, image, nodes, controller, observers, window, document };
}
function geometry(fixture) {
  const transform = fixture.image.style.transform || '';
  const scale = transform.match(/scale\(\s*([\d.e+-]+)\s*\)/);
  const pan = transform.match(/translate\(\s*([\d.e+-]+)px\s*,\s*([\d.e+-]+)px\s*\)/);
  assert.ok(scale, `Rendered scale exists: ${transform}`);
  assert.ok(pan, `Rendered pan exists: ${transform}`);
  return { zoom: Number(scale[1]), x: Number(pan[1]), y: Number(pan[2]), width: parseFloat(fixture.image.style.width), height: parseFloat(fixture.image.style.height) };
}
function closeEnough(actual, expected, tolerance = 0.05) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is near ${expected}`); }
function zoomIn(fixture, times = 4) { for (let index = 0; index < times; index++) fixture.nodes.attachmentPreviewZoomIn.emit('click'); }

test('fit sizes the image itself and plus/minus change its scale without resizing the viewer', () => {
  const fixture = setup();
  let current = geometry(fixture);
  closeEnough(current.width, 968); closeEnough(current.height, 484); closeEnough(current.zoom, 1);
  assert.equal(fixture.nodes.attachmentPreviewZoomValue.textContent, '100%');
  fixture.nodes.attachmentPreviewZoomIn.emit('click'); current = geometry(fixture);
  closeEnough(current.zoom, 1.25);
  assert.equal(fixture.viewport.clientWidth, 1000);
  assert.equal(fixture.viewport.clientHeight, 700);
  fixture.nodes.attachmentPreviewZoomOut.emit('click'); closeEnough(geometry(fixture).zoom, 1);
});

test('Ctrl and Meta wheel zoom the image around the cursor; ordinary and outside wheel remain untouched', () => {
  const fixture = setup(); zoomIn(fixture);
  const before = geometry(fixture), px = 70, py = 25;
  const event = fixture.viewport.emit('wheel', { ctrlKey: true, deltaY: -120, clientX: 600 + px, clientY: 400 + py });
  const after = geometry(fixture);
  assert.equal(event.defaultPrevented, true); assert.ok(after.zoom > before.zoom);
  closeEnough((px - before.x) / before.zoom, (px - after.x) / after.zoom);
  closeEnough((py - before.y) / before.zoom, (py - after.y) / after.zoom);
  const untouched = geometry(fixture);
  assert.equal(fixture.viewport.emit('wheel', { deltaY: -120 }).defaultPrevented, false);
  assert.deepEqual(geometry(fixture), untouched);
  assert.equal(fixture.document.emit('wheel', { ctrlKey: true, deltaY: -120 }).defaultPrevented, false);
  assert.equal(fixture.window.emit('wheel', { ctrlKey: true, deltaY: -120 }).defaultPrevented, false);
  assert.equal(fixture.viewport.emit('wheel', { metaKey: true, deltaY: 60 }).defaultPrevented, true);
  assert.ok((fixture.viewport.listeners.get('wheel') || []).some(item => item.options?.passive === false));
});

test('zoom clamps at fit and 800 percent and consumes modified wheel at both limits', () => {
  const fixture = setup();
  assert.equal(fixture.viewport.emit('wheel', { ctrlKey: true, deltaY: 2000 }).defaultPrevented, true);
  closeEnough(geometry(fixture).zoom, 1);
  zoomIn(fixture, 30); closeEnough(geometry(fixture).zoom, 8);
  assert.equal(fixture.viewport.emit('wheel', { ctrlKey: true, deltaY: -2000 }).defaultPrevented, true);
  closeEnough(geometry(fixture).zoom, 8);
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  fixture.nodes.attachmentPreviewZoomFit.emit('click');
  closeEnough(geometry(fixture).zoom, 1); closeEnough(geometry(fixture).x, 0); closeEnough(geometry(fixture).y, 0);
});

test('line and page wheel deltas use the same bounded pixel normalization', () => {
  const pixels = setup(), lines = setup(), pages = setup(), capped = setup();
  pixels.viewport.emit('wheel', { ctrlKey: true, deltaY: -16, deltaMode: 0 });
  lines.viewport.emit('wheel', { ctrlKey: true, deltaY: -1, deltaMode: 1 });
  closeEnough(geometry(pixels).zoom, geometry(lines).zoom, 0.0001);
  pages.viewport.emit('wheel', { ctrlKey: true, deltaY: -1, deltaMode: 2 });
  capped.viewport.emit('wheel', { ctrlKey: true, deltaY: -240, deltaMode: 0 });
  closeEnough(geometry(pages).zoom, geometry(capped).zoom, 0.0001);
});

test('drag uses pointer capture, stays bounded and ends on release or cancellation', () => {
  const fixture = setup(); zoomIn(fixture);
  fixture.viewport.emit('pointerdown', { pointerId: 7, clientX: 600, clientY: 400 });
  assert.ok(fixture.viewport.captures.has(7));
  fixture.viewport.emit('pointermove', { pointerId: 7, clientX: 10600, clientY: -9600 });
  const dragged = geometry(fixture);
  assert.ok(Math.abs(dragged.x) <= Math.max(0, (dragged.width * dragged.zoom - fixture.viewport.clientWidth) / 2) + 1);
  assert.ok(Math.abs(dragged.y) <= Math.max(0, (dragged.height * dragged.zoom - fixture.viewport.clientHeight) / 2) + 1);
  fixture.viewport.emit('pointerup', { pointerId: 7 });
  assert.equal(fixture.viewport.captures.has(7), false);
  const released = geometry(fixture);
  fixture.viewport.emit('pointermove', { pointerId: 7, clientX: 0, clientY: 0 });
  assert.deepEqual(geometry(fixture), released);
  fixture.viewport.emit('pointerdown', { pointerId: 8, clientX: 600, clientY: 400 });
  fixture.viewport.emit('pointercancel', { pointerId: 8 });
  assert.equal(fixture.viewport.captures.has(8), false);
  fixture.viewport.emit('pointermove', { pointerId: 8, clientX: 0, clientY: 0 });
  assert.deepEqual(geometry(fixture), released);
});

test('two touch pointers pinch the image and one remaining pointer continues without a jump', () => {
  const fixture = setup(); zoomIn(fixture);
  fixture.viewport.emit('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 560, clientY: 400 });
  fixture.viewport.emit('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 640, clientY: 400 });
  const before = geometry(fixture);
  fixture.viewport.emit('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 680, clientY: 400 });
  assert.ok(geometry(fixture).zoom > before.zoom);
  fixture.viewport.emit('pointerup', { pointerType: 'touch', pointerId: 2, clientX: 680, clientY: 400 });
  const onePointer = geometry(fixture);
  fixture.viewport.emit('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 570, clientY: 400 });
  const moved = geometry(fixture);
  closeEnough(moved.zoom, onePointer.zoom); closeEnough(moved.x - onePointer.x, 10);
});

test('resize recomputes fitted dimensions while preserving zoom and clamping the image', () => {
  const fixture = setup(); zoomIn(fixture);
  const before = geometry(fixture);
  fixture.viewport.clientWidth = 650; fixture.viewport.clientHeight = 450;
  for (const observer of fixture.observers) observer.callback([{ target: fixture.viewport }]);
  const resized = geometry(fixture);
  closeEnough(resized.width, 618); closeEnough(resized.height, 309); closeEnough(resized.zoom, before.zoom);
  assert.ok(Math.abs(resized.x) <= Math.max(0, (resized.width * resized.zoom - 650) / 2) + 1);
});

test('reset and close clear gestures and disable image controls until a new image loads', () => {
  const fixture = setup(); zoomIn(fixture);
  fixture.viewport.emit('pointerdown', { pointerId: 9, clientX: 600, clientY: 400 });
  fixture.controller.reset();
  closeEnough(geometry(fixture).zoom, 1); closeEnough(geometry(fixture).x, 0); closeEnough(geometry(fixture).y, 0);
  assert.equal(fixture.viewport.captures.has(9), false);
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  fixture.controller.loaded(); assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, false);
  fixture.controller.deactivate(); fixture.modal.classList.remove('is-open');
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  const closed = geometry(fixture);
  fixture.viewport.emit('wheel', { ctrlKey: true, deltaY: -120 });
  fixture.viewport.emit('pointermove', { pointerId: 9, clientX: 0, clientY: 0 });
  assert.deepEqual(geometry(fixture), closed);
});

test('zero-sized or unloaded image cannot be zoomed and reopening does not duplicate listeners', () => {
  const fixture = setup({ naturalWidth: 0, naturalHeight: 0 });
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  const listenerCount = (fixture.viewport.listeners.get('wheel') || []).length;
  fixture.controller.deactivate(); fixture.controller.reset();
  fixture.image.naturalWidth = 1200; fixture.image.naturalHeight = 600; fixture.controller.loaded();
  assert.equal((fixture.viewport.listeners.get('wheel') || []).length, listenerCount);
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, false);
  fixture.nodes.attachmentPreviewZoomIn.emit('click'); closeEnough(geometry(fixture).zoom, 1.25);
});

function sourceBetween(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Lifecycle section exists: ${start}`);
  return source.slice(from, to);
}
function lifecycleSetup() {
  const fixture = setup({ ready: false });
  const timers = new Map(); let nextTimer = 1;
  fixture.window.setTimeout = callback => { const id = nextTimer++; timers.set(id, callback); return id; };
  fixture.window.clearTimeout = id => timers.delete(id);
  for (const id of ['attachmentPreviewTitle', 'attachmentPreviewCounter', 'attachmentPreviewFileName', 'attachmentPreviewLoading', 'attachmentPreviewPreviousButton', 'attachmentPreviewNextButton']) fixture.nodes[id] = new FakeNode(id);
  fixture.document.body = new FakeNode('body'); fixture.document.body.classList.add('modal-open');
  const detailModal = new FakeNode('logDetailModal'); detailModal.classList.add('is-open');
  fixture.modal.attachmentImageZoom = fixture.controller;
  const state = { items: [{ name: 'A.jpg', url: '/image-a.jpg' }, { name: 'B.jpg', url: '/image-b.jpg' }], currentIndex: 0, renderSequence: 0, sourceTimer: null, returnFocus: null };
  Object.assign(fixture.context, { attachmentPreviewState: state, elements: { logDetailModal: detailModal, logEditorModal: new FakeNode('logEditorModal') } });
  const loadLifecycle = code => vm.runInContext(code, fixture.context);
  loadLifecycle(sourceBetween('function renderCurrentAttachmentPreview()', 'function openAttachmentPreview('));
  loadLifecycle(sourceBetween('function moveAttachmentPreview(', 'function closeAttachmentPreview()'));
  loadLifecycle(sourceBetween('function closeAttachmentPreview()', 'const attachmentSelectorState ='));
  return { ...fixture, state, timers, detailModal };
}

test('next image cancels old source assignment and ignores stale load/error callbacks', () => {
  const fixture = lifecycleSetup();
  fixture.context.renderCurrentAttachmentPreview();
  const oldTimer = fixture.timers.get(fixture.state.sourceTimer), oldLoad = fixture.image.onload, oldError = fixture.image.onerror;
  fixture.context.moveAttachmentPreview(1);
  assert.equal(fixture.state.currentIndex, 1);
  assert.equal(fixture.timers.size, 1);
  oldTimer(); oldLoad();
  assert.notEqual(fixture.image.src, '/image-a.jpg');
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  fixture.timers.get(fixture.state.sourceTimer)();
  assert.equal(fixture.image.src, '/image-b.jpg');
  finishImageLoad(fixture);
  assert.equal(fixture.image.style.display, 'block');
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, false);
  oldError();
  assert.equal(fixture.image.style.display, 'block');
  assert.equal(fixture.nodes.attachmentPreviewLoading.hidden, true);
});

test('close invalidates pending source/load callbacks, releases gestures and preserves the parent modal', () => {
  const fixture = lifecycleSetup();
  let restoredFocus = 0;
  fixture.state.returnFocus = { isConnected: true, focus: () => { restoredFocus++; } };
  fixture.context.renderCurrentAttachmentPreview();
  const pendingTimer = fixture.timers.get(fixture.state.sourceTimer), lateLoad = fixture.image.onload;
  fixture.context.closeAttachmentPreview();
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.modal.classList.contains('is-open'), false);
  assert.equal(fixture.state.items.length, 0);
  assert.equal(restoredFocus, 1);
  pendingTimer(); lateLoad();
  assert.equal(fixture.image.src, '');
  assert.equal(fixture.image.style.display, 'none');
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  assert.equal(fixture.detailModal.classList.contains('is-open'), true);
  assert.equal(fixture.document.body.classList.contains('modal-open'), true);
});

test('each next or previous image starts fitted, and current image errors disable zoom', () => {
  const fixture = lifecycleSetup();
  fixture.context.renderCurrentAttachmentPreview(); fixture.timers.get(fixture.state.sourceTimer)(); finishImageLoad(fixture);
  zoomIn(fixture); assert.ok(geometry(fixture).zoom > 1);
  fixture.context.moveAttachmentPreview(-1);
  assert.equal(fixture.state.currentIndex, 1);
  closeEnough(geometry(fixture).zoom, 1);
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  fixture.timers.get(fixture.state.sourceTimer)(); finishImageError(fixture);
  assert.equal(fixture.image.hidden, true);
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  assert.match(fixture.nodes.attachmentPreviewLoading.textContent, /불러오지 못했습니다/);
});

function finishImageLoad(fixture, width = 2000, height = 1000) {
  fixture.image.naturalWidth = width;
  fixture.image.naturalHeight = height;
  fixture.image.complete = true;
  fixture.image.onload?.();
}
function finishImageError(fixture) {
  fixture.image.naturalWidth = fixture.image.naturalHeight = 0;
  fixture.image.complete = true;
  fixture.image.onerror?.();
}

function installModalKeyboard(fixture) {
  const assignment = source.indexOf('  modal.attachmentImageZoom = createAttachmentImageZoomController(modal);');
  const from = source.indexOf('  modal.addEventListener("keydown",', assignment);
  const to = source.indexOf('\n\n  return modal;', from);
  assert.ok(assignment >= 0 && from > assignment && to > from);
  fixture.context.modal = fixture.modal;
  vm.runInContext(source.slice(from, to), fixture.context);
}

test('modal Escape closes only the image viewer and stops the underlying detail shortcut', () => {
  const fixture = lifecycleSetup(); installModalKeyboard(fixture);
  const event = fixture.modal.emit('keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.equal(fixture.modal.classList.contains('is-open'), false);
  assert.equal(fixture.detailModal.classList.contains('is-open'), true);
  assert.equal(fixture.document.body.classList.contains('modal-open'), true);
});

test('modal navigation consumes arrows and Tab stays within enabled viewer controls', () => {
  const fixture = lifecycleSetup(); installModalKeyboard(fixture);
  const previous = fixture.modal.emit('keydown', { key: 'ArrowLeft' });
  assert.equal(previous.defaultPrevented, true); assert.equal(previous.stopped, true);
  assert.equal(fixture.state.currentIndex, 1);
  const first = new FakeNode('closeButton'), last = fixture.viewport, disabled = fixture.nodes.attachmentPreviewZoomIn;
  first.parentElement = last.parentElement = fixture.modal; disabled.disabled = true;
  first.focus = () => { fixture.document.activeElement = first; };
  last.focus = () => { fixture.document.activeElement = last; };
  fixture.modal.querySelectorAll = () => [first, disabled, last];
  fixture.document.activeElement = last;
  const tab = fixture.modal.emit('keydown', { key: 'Tab' });
  assert.equal(tab.defaultPrevented, true); assert.equal(fixture.document.activeElement, first);
  const shiftTab = fixture.modal.emit('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(shiftTab.defaultPrevented, true); assert.equal(fixture.document.activeElement, last);
});

test('open focuses the close control and close restores the original opener', () => {
  const fixture = lifecycleSetup(); fixture.modal.classList.remove('is-open');
  const opener = new FakeNode('attachmentCard'); opener.isConnected = true;
  const close = new FakeNode('closeButton'); close.isConnected = true;
  opener.focus = () => { fixture.document.activeElement = opener; };
  close.focus = () => { fixture.document.activeElement = close; };
  const findNode = fixture.modal.querySelector;
  fixture.modal.querySelector = selector => selector === 'button[data-attachment-preview-close]' ? close : findNode(selector);
  fixture.document.activeElement = opener;
  fixture.context.ensureAttachmentPreviewModal = () => fixture.modal;
  fixture.context.showToast = () => {};
  vm.runInContext(sourceBetween('function normalizeDetailAttachment(', 'function ensureAttachmentPreviewModal()'), fixture.context);
  vm.runInContext(sourceBetween('function openAttachmentPreview(', 'function moveAttachmentPreview('), fixture.context);
  fixture.context.openAttachmentPreview([{ name: 'photo.jpg', url: '/photo.jpg' }]);
  assert.equal(fixture.document.activeElement, close);
  assert.equal(fixture.modal.classList.contains('is-open'), true);
  fixture.context.closeAttachmentPreview();
  assert.equal(fixture.document.activeElement, opener);
});

test('queued old DOM events cannot activate the newly installed handlers before its source assignment', () => {
  const fixture = lifecycleSetup();
  fixture.context.renderCurrentAttachmentPreview(); fixture.timers.get(fixture.state.sourceTimer)(); finishImageLoad(fixture);
  fixture.context.moveAttachmentPreview(1);
  assert.equal(fixture.image.getAttribute('src'), null);
  assert.equal(fixture.image.complete, true);
  fixture.image.onload(); fixture.image.onerror();
  assert.equal(fixture.image.style.display, 'none');
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  assert.equal(fixture.nodes.attachmentPreviewLoading.hidden, false);
  assert.match(fixture.nodes.attachmentPreviewLoading.textContent, /불러오는 중/);
});

test('new load and error handlers ignore queued events while the new request is incomplete', () => {
  const fixture = lifecycleSetup();
  fixture.context.renderCurrentAttachmentPreview(); fixture.context.moveAttachmentPreview(1);
  fixture.timers.get(fixture.state.sourceTimer)();
  assert.equal(fixture.image.getAttribute('src'), '/image-b.jpg');
  assert.equal(fixture.image.complete, false);
  // Some engines can expose previous dimensions while a replacement request is pending.
  fixture.image.naturalWidth = 2000; fixture.image.naturalHeight = 1000;
  fixture.image.onload();
  fixture.image.naturalWidth = fixture.image.naturalHeight = 0;
  fixture.image.onerror();
  assert.equal(fixture.image.style.display, 'none');
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, true);
  assert.match(fixture.nodes.attachmentPreviewLoading.textContent, /불러오는 중/);
  finishImageLoad(fixture);
  assert.equal(fixture.image.style.display, 'block');
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, false);
});

test('a queued stale error cannot hide the current image after cached successful completion', () => {
  const fixture = lifecycleSetup();
  fixture.context.renderCurrentAttachmentPreview(); fixture.context.moveAttachmentPreview(1);
  fixture.timers.get(fixture.state.sourceTimer)(); finishImageLoad(fixture);
  assert.equal(fixture.image.complete, true); assert.ok(fixture.image.naturalWidth > 0);
  fixture.image.onerror();
  assert.equal(fixture.image.style.display, 'block');
  assert.equal(fixture.image.hidden, false);
  assert.equal(fixture.nodes.attachmentPreviewZoomIn.disabled, false);
  assert.equal(fixture.nodes.attachmentPreviewLoading.hidden, true);
});
