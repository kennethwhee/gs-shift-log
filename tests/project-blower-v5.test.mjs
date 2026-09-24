import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { onRequestGet, onRequestPost } from '../functions/api/blower-history.js';

const source = readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const tag = '104HHL10AN631';
const now = '2026-09-24T00:00:00.000Z';
function element() {
  return {
    value: '', hidden: true, disabled: false, textContent: '', innerHTML: '', open: false,
    dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {},
    addEventListener() {}, close() { this.open = false; }, showModal() { this.open = true; }
  };
}
function payload(hours, options = {}) {
  return {
    ok: true, generatedAt: now, permissions: { canWrite: true }, user: { name: 'Tester' },
    types: [], backfill: { hasRun: true, status: 'complete' },
    assets: [{ tagNumber: tag, cycleElapsedHours: hours }], events: [], ...options
  };
}
function harness() {
  const calls = [], renders = [], toasts = [], nodes = new Map();
  let session = 'review-session';
  const context = vm.createContext({
    console: { error() {}, warn() {}, log() {} }, Response, AbortController,
    localStorage: { getItem: () => session ? JSON.stringify({ sessionToken: session }) : null },
    document: {
      readyState: 'loading', body: element(), addEventListener() {}, querySelectorAll: () => [],
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }
    },
    window: { matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, addEventListener() {} },
    fetch(url, options) {
      return new Promise((resolve, reject) => {
        calls.push({ url, options, reject, resolve(body, status = 200) {
          resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
        } });
      });
    }
  });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `
    globalThis.ui = { state, elements, cacheElements, apiRequest, loadData, setBusy, submitHistoryEventEdit };
    globalThis.observe = hooks => {
      renderAll = () => hooks.render(state.data);
      showToast = hooks.toast;
      openAssetHistory = () => {};
    };
  ` + marker), context);
  context.observe({ render: data => renders.push(data), toast: (...args) => toasts.push(args) });
  const ui = context.ui;
  ui.cacheElements(); ui.state.data = payload(25);
  return { ui, calls, renders, toasts, setSession(value) { session = value; } };
}
const silent = { silent: true, syncOperations: false };
async function until(predicate) {
  for (let n = 0; n < 30 && !predicate(); n += 1) await Promise.resolve();
  assert.ok(predicate(), 'expected asynchronous request was reached');
}

test('a late older read cannot replace newer runtime, events or the server clock', async () => {
  const h = harness();
  const first = h.ui.loadData(silent), second = h.ui.loadData(silent);
  h.calls[1].resolve(payload(120, { events: [{ id: 'current' }] })); await second;
  const clock = h.ui.state.serverClockOffsetMs;
  h.calls[0].resolve(payload(40, { generatedAt: '2025-01-01T00:00:00Z', events: [{ id: 'deleted' }] })); await first;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 120);
  assert.equal(h.ui.state.data.events[0].id, 'current');
  assert.equal(h.ui.state.serverClockOffsetMs, clock);
  assert.equal(h.renders.length, 1);
});

test('a late failed read cannot replace a successful notice or display an obsolete error', async () => {
  const h = harness();
  const first = h.ui.loadData(silent), second = h.ui.loadData(silent);
  h.calls[1].resolve(payload(120)); await second;
  h.calls[0].reject(new Error('obsolete connection failure')); await first;
  assert.equal(h.ui.elements.authNotice.hidden, true);
  assert.equal(h.toasts.length, 0);
});

test('a reply for a previous login session cannot change the current view', async () => {
  const h = harness(); const pending = h.ui.loadData(silent);
  h.setSession('replacement-session'); h.calls[0].resolve(payload(999)); await pending;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 25);
  assert.equal(h.renders.length, 0);
});

test('a write invalidates earlier reads even before its replacement read begins', async () => {
  const h = harness(); const oldRead = h.ui.loadData(silent);
  const write = h.ui.apiRequest({ method: 'POST', body: { action: 'history_event_edit' } });
  h.calls[1].resolve({ ok: true }); await write;
  h.calls[0].resolve(payload(5, { events: [{ id: 'old' }] })); await oldRead;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 25);
  const reload = h.ui.loadData(silent); h.calls[2].resolve(payload(130)); await reload;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 130);
});

test('reads attempted during a pending write cannot publish an intermediate result', async () => {
  const h = harness();
  const write = h.ui.apiRequest({ method: 'POST', body: { action: 'history_event_delete' } });
  const read = h.ui.loadData(silent);
  if (h.calls[1]) h.calls[1].resolve(payload(0));
  await read;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 25);
  h.calls[0].resolve({ ok: true }); await write;
  assert.equal(h.ui.state.busy, false);
});

test('an old foreground read cannot unlock an ongoing edit', async () => {
  const h = harness(); const oldRead = h.ui.loadData();
  h.ui.setBusy(true); h.calls[0].resolve(payload(70)); await oldRead;
  assert.equal(h.ui.state.busy, true);
  assert.equal(h.ui.elements.refreshButton.disabled, true);
  h.ui.setBusy(false); assert.equal(h.ui.state.busy, false);
});

test('a newer silent read releases its inherited loading state without waiting for an obsolete read', async () => {
  const h = harness(); const oldRead = h.ui.loadData(), newRead = h.ui.loadData(silent);
  h.calls[1].resolve(payload(140)); await newRead;
  assert.equal(h.ui.state.busy, false);
  h.calls[0].resolve(payload(3)); await oldRead;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 140);
  assert.equal(h.ui.state.busy, false);
});

test('a superseded forced-sync read never launches its automatic write', async () => {
  const h = harness();
  const oldRead = h.ui.loadData({ ...silent, forceOperationSync: true, syncOperations: true });
  const newRead = h.ui.loadData(silent); h.calls[1].resolve(payload(140)); await newRead;
  h.calls[0].resolve(payload(3));
  // Drain any wrongly launched legacy sync without hanging the reproduction.
  for (let n = 0; n < 30; n += 1) {
    await Promise.resolve(); if (h.calls[2]) h.calls[2].resolve({ ok: true, appliedStateChanges: 0 });
  }
  await oldRead; assert.equal(h.calls.length, 2);
});

test('explicit operation sync still reloads its committed state and releases busy controls', async () => {
  const h = harness(); const read = h.ui.loadData({ forceOperationSync: true });
  h.calls[0].resolve(payload(25)); await until(() => h.calls.length === 2);
  assert.equal(JSON.parse(h.calls[1].options.body).action, 'operation_sync');
  h.calls[1].resolve({ ok: true, appliedStateChanges: 1 }); await until(() => h.calls.length === 3);
  h.calls[2].resolve(payload(55)); await read;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 55);
  assert.equal(h.ui.state.busy, false);
});

test('delete preview is read-only and does not discard an otherwise current read', async () => {
  const h = harness(); const read = h.ui.loadData(silent);
  const preview = h.ui.apiRequest({ method: 'POST', body: { action: 'history_event_delete_preview' } });
  h.calls[1].resolve({ ok: true }); await preview;
  h.calls[0].resolve(payload(60)); await read;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 60);
});

test('a skipped background read does not cancel explicit sync and its committed reread', async () => {
  const h = harness(); const read = h.ui.loadData({ forceOperationSync: true });
  h.calls[0].resolve(payload(25)); await until(() => h.calls.length === 2);
  await h.ui.loadData(silent);
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ ok: true, appliedStateChanges: 1 }); await until(() => h.calls.length === 3);
  h.calls[2].resolve(payload(58)); await read;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 58);
  assert.equal(h.ui.state.busy, false);
});

test('a lost write response keeps earlier reads invalid and releases its busy state', async () => {
  const h = harness(); const oldRead = h.ui.loadData();
  const write = h.ui.apiRequest({ method: 'POST', body: { action: 'history_event_edit' } });
  const failed = assert.rejects(write, error => error.code === 'NETWORK_ERROR');
  h.calls[1].reject(new Error('connection lost after possible commit')); await failed;
  assert.equal(h.ui.state.busy, false);
  h.calls[0].resolve(payload(3)); await oldRead;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 25);
  assert.equal(h.toasts.length, 0);
});

test('strict reads report supersession as retryable instead of claiming a fresh result', async () => {
  const h = harness(); const oldRead = h.ui.loadData({ ...silent, strict: true });
  const rejected = assert.rejects(oldRead, error => error.code === 'READ_SUPERSEDED' && error.retryable === true);
  const newRead = h.ui.loadData(silent); h.calls[1].resolve(payload(90)); await newRead;
  h.calls[0].resolve(payload(3)); await rejected;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 90);
  assert.equal(h.toasts.length, 0);
});

test('a current read failure preserves stored runtime and leaves retry controls usable', async () => {
  const h = harness(); const read = h.ui.loadData();
  h.calls[0].resolve({ ok: false, message: '일시적인 조회 오류' }, 503); await read;
  assert.equal(h.ui.state.data.assets[0].cycleElapsedHours, 25);
  assert.equal(h.ui.elements.authNotice.hidden, false);
  assert.equal(h.toasts.length, 1);
  assert.equal(h.ui.state.busy, false);
  assert.equal(h.ui.elements.refreshButton.disabled, false);
});

test('a successful edit followed by a failed read shows a visible saved-but-not-refreshed notice without retrying the write', async () => {
  const h = harness(), e = h.ui.elements;
  h.ui.state.historyEventEditSnapshot = { tagNumber: tag, eventId: 'event-1' };
  e.historyEventEditDialog.open = true;
  e.historyEventEditDate.value = '2026-09-24T09:00'; e.historyEventEditRuntime.value = '27.5';
  e.historyEventEditType.value = 'runtime_correction';
  const save = h.ui.submitHistoryEventEdit({ preventDefault() {} });
  h.calls[0].resolve({ ok: true, message: '저장 완료' }); await until(() => h.calls.length === 2);
  h.calls[1].resolve({ ok: false, message: '일시적인 조회 오류' }, 503); await save;
  assert.equal(e.historyEventEditDialog.open, false);
  assert.equal(h.ui.state.historyEventEditSnapshot, null);
  assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.ok(h.toasts.some(([message, kind]) => kind === 'error' && /수정.*완료|저장.*완료/.test(message) && /조회/.test(message)));
  assert.equal(h.ui.state.busy, false);
});

function apiContext(value, { failAuth = false } = {}) {
  const statements = [];
  const internal = 'SYNTHETIC_INTERNAL_DB_DETAIL';
  const DB = { prepare(sql) {
    statements.push(sql);
    if (failAuth || !sql.includes('FROM shift_log_sessions')) throw new Error(internal);
    return { bind() { return this; }, async first() {
      return { employee_no: 'reviewer', name: 'Tester', role: 'user', is_active: 1,
        expires_at: new Date(Date.now() + 3600000).toISOString(), last_used_at: new Date().toISOString() };
    } };
  } };
  return { statements, context: {
    request: new Request('https://review.invalid/api/blower-history', {
      method: 'POST', headers: { Authorization: 'Bearer review-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    }), env: { DB }
  } };
}

test('GET and POST failures return generic messages without internal database details', async () => {
  const original = console.error; console.error = () => {};
  try {
    for (const handler of [onRequestGet, onRequestPost]) {
      const { context } = apiContext({ action: 'history_event_edit' }, { failAuth: true });
      const result = await handler(context); assert.equal(result.status, 500);
      const body = await result.json(); assert.equal(body.ok, false);
      assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC_INTERNAL_DB_DETAIL|SELECT|stack/);
      assert.match(body.message, /오류/);
    }
  } finally { console.error = original; }
});

test('non-object request bodies are rejected before business queries or schema changes', async () => {
  const original = console.error; console.error = () => {};
  try {
    for (const value of [null, [], 'text', 7, true]) {
      const { context, statements } = apiContext(value);
      const response = await onRequestPost(context); assert.equal(response.status, 400, JSON.stringify(value));
      assert.equal(statements.length, 1, 'only the existing session is read');
      assert.match(statements[0], /FROM shift_log_sessions/);
    }
  } finally { console.error = original; }
});
