import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(process.argv[2] || process.cwd());
const source = fs.readFileSync(path.join(root, 'maintenance/blower-history.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'maintenance/blower-history.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'maintenance/blower-history.css'), 'utf8');
const tag = '104SDF01AN001';
const now = '2026-09-08T14:30:00.000Z';
function node() {
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false, open: false, dataset: {}, listeners: {},
    classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, showModal() { this.open = true; }, close() { this.open = false; }
  };
}
function harness({ mobile = false, canWrite = true } = {}) {
  const nodes = new Map(), calls = [], refreshes = [], toasts = [];
  const context = vm.createContext({ console, HTMLButtonElement: class {}, localStorage: { getItem: () => null },
    document: { readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { matchMedia: () => ({ matches: mobile }), setTimeout(fn) { fn(); } }
  });
  const marker = '  if (document.readyState === "loading") {';
  const expose = `globalThis.ui={state,elements,cacheElements,bindEvents,openAssetHistory,canEditManualReplacement,openReplacementEditDialog,updateReplacementEditFields,saveReplacementEdit};
    globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;showToast=h.toast;currentServerDate=()=>new Date('${now}');};\n`;
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, expose + marker), context);
  const ui = context.ui; ui.cacheElements(); ui.bindEvents();
  const asset = { tagNumber: tag, blowerType: 'organic_fuel', displayName: '#1 유기성 고형연료 Blower #A', positionLabel: '#A',
    lastReplacementAt: '2026-08-19T15:00:00.000Z', cycleStartState: 'pending', cycleStartRevision: 'start-original', cycleRuntimeRevision: 'runtime-original',
    cycleElapsedHours: 0, isRunning: false, severity: 'startup_pending', cycleRuntimeTracked: true };
  const replacement = { id: 'manual-current', tagNumber: tag, eventType: 'replacement', sourceType: 'manual', eventDate: asset.lastReplacementAt,
    issueType: '이상진동', actionType: 'V-Belt 교체', note: '잘못 입력한 교체', updatedAt: '2026-09-08T14:15:00.000Z', createdAt: '2026-09-08T14:15:00.000Z' };
  ui.state.data = { permissions: { canWrite }, user: canWrite ? { name: 'Tester' } : null, backfill: { hasRun: true, status: 'complete' }, assets: [asset],
    events: [{ id: 'runtime', tagNumber: tag, sourceType: 'dataparc_runtime', eventType: 'runtime_correction', eventDate: now, runtimeHours: 12.3, note: 'Earlier DataPARC result', createdAt: now, updatedAt: now }, replacement,
      { ...replacement, id: 'old-manual', eventDate: '2025-12-18T15:00:00.000Z' }, { ...replacement, id: 'old-auto', sourceType: 'shift_log_history_v13', eventDate: '2025-01-01T00:00:00.000Z' }] };
  let request = async () => ({ message: '수정 완료' });
  context.hooks({ api: async options => { calls.push(JSON.parse(JSON.stringify(options))); return request(options); }, load: async options => { refreshes.push(options); }, toast: (...args) => { toasts.push(args); } });
  const open = () => ui.openReplacementEditDialog(tag, replacement.id);
  const submit = () => ui.elements.replacementEditForm.listeners.submit({ preventDefault() {} });
  return { ui, asset, replacement, calls, refreshes, toasts, open, submit, setRequest: fn => { request = fn; } };
}

test('authenticated desktop exposes generic edit and delete on current, older, automatic and DataPARC history rows', () => {
  const { ui } = harness(); ui.openAssetHistory(tag);
  const markup = ui.elements.assetHistoryList.innerHTML;
  assert.equal((markup.match(/data-history-action="history_event_edit"/g) || []).length, 4);
  assert.equal((markup.match(/data-history-action="history_event_delete"/g) || []).length, 4);
  for (const id of ['runtime','manual-current','old-manual','old-auto']) {
    assert.match(markup, new RegExp(`data-history-action="history_event_edit" data-event-id="${id}"`));
    assert.match(markup, new RegExp(`data-history-action="history_event_delete" data-event-id="${id}"`));
  }
  assert.match(ui.elements.historyCycleSummary.innerHTML, /기동 대기/);
});
test('latest operation also uses the same generic edit/delete path while cycle summary stays measured-only', () => {
  const { ui, asset } = harness(); Object.assign(asset, { cycleStartState: 'started', isRunning: false });
  ui.state.data.events.unshift({ id: 'stop', tagNumber: tag, eventType: 'operation_stop', sourceType: 'manual', eventDate: '2026-09-08T14:30:01.000Z', runtimeHours: 12.3, createdAt: '2026-09-08T14:30:01.000Z', updatedAt: '2026-09-08T14:30:01.000Z' });
  ui.openAssetHistory(tag);
  const markup = ui.elements.assetHistoryList.innerHTML;
  assert.match(markup, /data-history-action="history_event_edit" data-event-id="stop"/);
  assert.match(markup, /data-history-action="history_event_delete" data-event-id="stop"/);
  assert.doesNotMatch(markup, /data-history-action="runtime_state_edit"/);
  assert.doesNotMatch(markup, /data-history-action="replacement_event_edit"/);
  assert.match(ui.elements.historyCycleSummary.innerHTML, /누적 기동시간/);
  assert.doesNotMatch(ui.elements.historyCycleSummary.innerHTML, /정지중|기동중/);
});
test('mobile, public, automatic, superseded and unverifiable replacements cannot expose or force open editing', () => {
  for (const options of [{ mobile: true }, { canWrite: false }]) {
    const { ui, open } = harness(options); ui.openAssetHistory(tag);
    assert.doesNotMatch(ui.elements.assetHistoryList.innerHTML, /data-history-action="replacement_event_edit"/);
    open(); assert.equal(ui.elements.replacementEditDialog.open, false);
  }
  for (const change of [h => { h.replacement.sourceType = 'shift_log_history_v13'; }, h => { h.asset.lastReplacementAt = '2026-08-20T15:00:00.000Z'; }, h => { h.replacement.updatedAt = ''; }]) {
    const h = harness(); change(h); h.open(); assert.equal(h.ui.elements.replacementEditDialog.open, false);
  }
});
test('delegated history edit opens real form with preserve default and no invented startup timestamp', () => {
  const { ui } = harness(); ui.openAssetHistory(tag);
  ui.elements.historyDialog.listeners.click({ target: { closest: () => ({ dataset: { historyAction: 'replacement_event_edit', eventId: 'manual-current' } }) } });
  assert.equal(ui.elements.historyDialog.open, false); assert.equal(ui.elements.replacementEditDialog.open, true);
  assert.equal(ui.elements.replacementEditDate.value, '2026-08-20');
  assert.equal(ui.elements.replacementEditOperation.value, 'preserve'); assert.equal(ui.elements.replacementEditPreserveOption.textContent, '현재 상태 유지 · 기동 대기');
  assert.equal(ui.elements.replacementEditStartupAt.value, ''); assert.equal(ui.elements.replacementEditStartupAt.required, false);
  assert.equal(ui.elements.replacementEditStoppedAt.required, false); assert.equal(ui.elements.replacementEditIssueType.value, '이상진동');
});
test('stopped form requires real start and stop, sends KST instants and immutable open-time guards, then reopens history', async () => {
  const { ui, asset, replacement, open, submit, calls, refreshes } = harness(); open();
  asset.cycleRuntimeRevision = 'changed-after-open'; asset.cycleStartRevision = 'changed-start'; replacement.updatedAt = 'changed-event';
  ui.elements.replacementEditOperation.value = 'stopped'; ui.elements.replacementEditOperation.listeners.change();
  assert.equal(ui.elements.replacementEditStartupAt.required, true); assert.equal(ui.elements.replacementEditStoppedAt.required, true);
  ui.elements.replacementEditStartupAt.value = '2026-08-21T09:30'; ui.elements.replacementEditStoppedAt.value = '2026-09-08T10:45';
  ui.elements.replacementEditNote.value = '실제 정지 상태 정정'; await submit();
  assert.equal(calls.length, 1); assert.equal(calls[0].body.action, 'replacement_event_edit');
  assert.equal(calls[0].body.startupAt, '2026-08-21T00:30:00.000Z'); assert.equal(calls[0].body.stoppedAt, '2026-09-08T01:45:00.000Z');
  assert.equal(calls[0].body.expectedCycleRuntimeRevision, 'runtime-original'); assert.equal(calls[0].body.expectedCycleStartRevision, 'start-original');
  assert.equal(calls[0].body.expectedEventUpdatedAt, '2026-09-08T14:15:00.000Z');
  assert.equal(ui.elements.replacementEditDialog.open, false); assert.equal(ui.elements.historyDialog.open, true); assert.equal(refreshes[0].syncOperations, false);
});
test('unchanged calendar date and startup fields preserve exact recorded seconds', async () => {
  const { ui, asset, replacement, open, submit, calls } = harness();
  asset.lastReplacementAt = replacement.eventDate = '2026-08-20T00:30:42.123Z';
  Object.assign(asset, { cycleStartState: 'started', isRunning: true, cycleStartedAt: '2026-08-20T00:30:55.321Z' });
  open(); ui.elements.replacementEditOperation.value = 'running'; ui.elements.replacementEditOperation.listeners.change(); await submit();
  assert.equal(calls[0].body.eventDate, replacement.eventDate); assert.equal(calls[0].body.startupAt, asset.cycleStartedAt);
});
test('active preserve cannot silently change replacement date, pending preserve can and hidden fields are not required', async () => {
  const active = harness(); active.asset.cycleStartState = 'started'; active.open(); active.ui.elements.replacementEditDate.value = '2026-08-21';
  await active.submit(); assert.equal(active.calls.length, 0); assert.equal(active.ui.elements.replacementEditDialog.open, true); assert.match(active.ui.elements.replacementEditError.textContent, /운전상태/);
  const pending = harness(); pending.open(); pending.ui.elements.replacementEditDate.value = '2026-08-21';
  pending.ui.elements.replacementEditOperation.value = 'stopped'; pending.ui.updateReplacementEditFields();
  pending.ui.elements.replacementEditOperation.value = 'preserve'; pending.ui.updateReplacementEditFields();
  assert.equal(pending.ui.elements.replacementEditStartupAt.required, false); assert.equal(pending.ui.elements.replacementEditStoppedAt.required, false);
  await pending.submit(); assert.equal(pending.calls[0].body.eventDate, '2026-08-20T15:00:00.000Z'); assert.equal(pending.calls[0].body.operationMode, 'preserve');
});
test('invalid calendar dates, missing start, before-replacement start and stop-before-start remain open without writes', async () => {
  for (const setup of [ui => { ui.elements.replacementEditDate.value = '2026-02-30'; }, ui => { ui.elements.replacementEditOperation.value = 'running'; },
    ui => { ui.elements.replacementEditOperation.value = 'running'; ui.elements.replacementEditStartupAt.value = '2026-08-19T00:00'; },
    ui => { ui.elements.replacementEditOperation.value = 'stopped'; ui.elements.replacementEditStartupAt.value = '2026-08-21T12:00'; ui.elements.replacementEditStoppedAt.value = '2026-08-21T11:59'; }]) {
    const h = harness(); h.open(); setup(h.ui); await h.submit(); assert.equal(h.calls.length, 0); assert.equal(h.ui.elements.replacementEditDialog.open, true); assert.equal(h.ui.elements.replacementEditError.hidden, false);
  }
});
test('pending correction sends explicit zero-time intent and the calculation preview explains continuous runtime', async () => {
  const h = harness(); h.open(); h.ui.elements.replacementEditOperation.value = 'running'; h.ui.updateReplacementEditFields();
  assert.match(h.ui.elements.replacementEditPreview.textContent, /기간 전체/); assert.match(h.ui.elements.replacementEditPreview.textContent, /중간 정지/);
  h.ui.elements.replacementEditOperation.value = 'pending'; h.ui.updateReplacementEditFields(); assert.match(h.ui.elements.replacementEditPreview.textContent, /0시간/);
  await h.submit(); assert.equal(h.calls[0].body.operationMode, 'pending'); assert.equal(h.calls[0].body.startupAt, ''); assert.equal(h.calls[0].body.stoppedAt, '');
});
test('busy or running DataPARC blocks opening and duplicate submit; failed save keeps input and original guards', async () => {
  for (const key of ['busy', 'dataparcRuntimeBusy']) {
    const h = harness(); h.ui.state[key] = true; h.open(); assert.equal(h.ui.elements.replacementEditDialog.open, false);
    h.ui.state[key] = false; h.open(); h.ui.state[key] = true; await h.submit(); assert.equal(h.calls.length, 0);
  }
  const h = harness(); h.open(); let reject; h.setRequest(() => new Promise((_, no) => { reject = no; }));
  const saving = h.submit(); await h.submit(); assert.equal(h.calls.length, 1); assert.equal(h.ui.elements.replacementEditSaveButton.disabled, true);
  reject(new Error('다른 사용자가 수정했습니다.')); await saving;
  assert.equal(h.ui.elements.replacementEditDialog.open, true); assert.equal(h.ui.elements.replacementEditNote.value, '잘못 입력한 교체');
  assert.equal(h.ui.elements.replacementEditError.textContent, '다른 사용자가 수정했습니다.'); assert.equal(h.ui.state.busy, false);
});
test('true latest replacement ordering matches timestamps and never treats an observation anchor as a stop', () => {
  const h = harness(); h.asset.lastReplacementAt = h.replacement.eventDate = '2026-08-20T01:00:00.000Z';
  const earlier = { ...h.replacement, id: 'earlier-same-day', eventDate: '2026-08-20T00:00:00.000Z', createdAt: now };
  h.ui.state.data.events.unshift(earlier);
  assert.equal(h.ui.canEditManualReplacement(h.asset, earlier), false);
  assert.equal(h.ui.canEditManualReplacement(h.asset, h.replacement), true);
  Object.assign(h.asset, { cycleStartState: 'started', isRunning: false, cycleStartedAt: '2026-08-21T01:00:00.000Z', cycleRuntimeAnchorAt: now });
  h.open(); assert.equal(h.ui.elements.replacementEditStartupAt.value, '2026-08-21T10:00'); assert.equal(h.ui.elements.replacementEditStoppedAt.value, '');
});
test('dialog fields use a compact responsive grid and distinct cache versions', () => {
  for (const id of ['replacementEditDialog', 'replacementEditForm', 'replacementEditDate', 'replacementEditOperation', 'replacementEditStartupAt', 'replacementEditStoppedAt', 'replacementEditError']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  assert.match(css, /@media \(min-width: 600px\)[\s\S]*?\.replacement-edit-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /blower-history\.css\?v=20260911-all-dashboard-v1/); assert.match(html, /blower-history\.js\?v=20260911-all-dashboard-v1/);
});
