import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(process.argv[2] || process.cwd());
const source = fs.readFileSync(path.join(root, 'maintenance/blower-history.js'), 'utf8');
const tag = '104HHL10AN631';
const now = '2026-09-11T00:00:00.000Z';

function node() {
  return {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, listeners: {}, title: '',
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {},
    closest(selector) { return selector === '.settings-strip' ? this.settingsStrip || null : null; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; }
  };
}

function harness() {
  const nodes = new Map();
  const calls = [];
  let request = async options => {
    if (options?.body?.action === 'history_event_delete_preview') {
      return {
        previewToken: 'a'.repeat(64),
        preview: { detail: '삭제 후 현재 Cycle 유지', lastReplacementAt: '2026-06-05T00:00:00.000Z', operationState: 'stopped', runtimeHours: 2310.5, asOf: now }
      };
    }
    return { message: '저장 완료' };
  };
  const context = vm.createContext({
    console,
    HTMLButtonElement: class {},
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      readyState: 'loading', body: node(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }
    },
    window: { matchMedia: () => ({ matches: false }), setTimeout(fn) { fn(); } }
  });
  const marker = '  if (document.readyState === "loading") {';
  const expose = `globalThis.ui={state,elements,cacheElements,bindEvents,openAssetHistory,openHistoryEventEditDialog,openHistoryDeleteDialog,submitHistoryEventEdit,submitHistoryDelete,canEditAnyHistoryEvent};\n` +
    `globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;showToast=h.toast;currentServerDate=()=>new Date('${now}');};\n`;
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, expose + marker), context);
  const ui = context.ui;
  ui.cacheElements();
  ui.bindEvents();
  const asset = {
    tagNumber: tag, blowerType: 'seal_pot', displayName: '#1 Seal Pot Blower #C', positionLabel: '#C', unitNo: '1',
    lastReplacementAt: '2026-06-05T00:00:00.000Z', cycleStartState: 'started', cycleStartedAt: '2026-06-05T01:00:00.000Z',
    cycleStartRevision: '', cycleRuntimeRevision: '', cycleElapsedHours: 2310.5, cycleRuntimeState: 'stopped', cycleRuntimeTracked: true,
    isRunning: false, severity: 'normal'
  };
  const event = {
    id: 'legacy-event', tagNumber: tag, blowerType: 'seal_pot', displayName: asset.displayName, positionLabel: '#C',
    eventType: 'replacement', eventDate: asset.lastReplacementAt, runtimeHours: 0, issueType: '정기주기', actionType: 'V-Belt 교체',
    note: '계획정비 이후 기동', sourceType: 'manual', createdByName: '테스터', createdAt: '2026-06-05T00:01:00.000Z', updatedAt: '2026-06-05T00:01:00.000Z'
  };
  ui.state.data = {
    permissions: { canWrite: true }, user: { name: 'Tester', isSuperAdmin: true }, backfill: { hasRun: true, status: 'complete' },
    types: [{ key: 'seal_pot', label: 'Seal Pot Blower' }], assets: [asset], events: [event], missingSlots: [], missingTags: [], settings: { seal_pot: { cycleDays: 90, warningDays: 7, criticalDays: 3 } }
  };
  context.hooks({
    api: async options => { calls.push(JSON.parse(JSON.stringify(options || {}))); return request(options || {}); },
    load: async () => {}, toast: () => {}
  });
  return { ui, asset, event, calls, setRequest(fn) { request = fn; } };
}

function actionButtonsEnabled(markup) {
  const edits = [...markup.matchAll(/<button[^>]*data-history-action="history_event_edit"[^>]*>/g)].map(x => x[0]);
  const deletes = [...markup.matchAll(/<button[^>]*data-history-action="history_event_delete"[^>]*>/g)].map(x => x[0]);
  assert.ok(edits.length > 0, 'edit button present');
  assert.ok(deletes.length > 0, 'delete button present');
  for (const button of [...edits, ...deletes]) assert.doesNotMatch(button, /\sdisabled(?:\s|=|>)/);
}

test('legacy empty cycle revisions still expose generic edit and delete', () => {
  const { ui, asset, event } = harness();
  assert.equal(ui.canEditAnyHistoryEvent(asset, event), true);
  ui.openAssetHistory(tag);
  actionButtonsEnabled(ui.elements.assetHistoryList.innerHTML);
});

test('after one edit, reopened history actions are immediately enabled without close/reopen', async () => {
  const { ui, calls } = harness();
  ui.openAssetHistory(tag);
  ui.openHistoryEventEditDialog(tag, 'legacy-event');
  assert.equal(ui.elements.historyEventEditDialog.open, true);
  ui.elements.historyEventEditType.value = 'replacement';
  ui.elements.historyEventEditDate.value = '2026-06-05T09:00';
  ui.elements.historyEventEditRuntime.value = '0';
  ui.elements.historyEventEditIssue.value = '정기주기';
  ui.elements.historyEventEditAction.value = 'V-Belt 교체';
  ui.elements.historyEventEditNote.value = '내용 정정';
  ui.elements.historyEventEditReason.value = '오입력 수정';
  await ui.elements.historyEventEditForm.listeners.submit({ preventDefault() {} });
  assert.equal(ui.state.busy, false);
  assert.equal(ui.elements.historyDialog.open, true);
  actionButtonsEnabled(ui.elements.assetHistoryList.innerHTML);
  const body = calls.find(call => call.body?.action === 'history_event_edit')?.body;
  assert.equal(body.expectedCycleStartRevision, '');
  assert.equal(body.expectedCycleRuntimeRevision, '');
});

test('after one delete, reopened history actions are immediately enabled without close/reopen', async () => {
  const { ui, calls } = harness();
  ui.openAssetHistory(tag);
  await ui.openHistoryDeleteDialog(tag, 'legacy-event');
  assert.equal(ui.elements.historyDeleteDialog.open, true);
  assert.equal(ui.elements.historyDeleteConfirm.disabled, false);
  await ui.elements.historyDeleteForm.listeners.submit({ preventDefault() {} });
  assert.equal(ui.state.busy, false);
  assert.equal(ui.elements.historyDialog.open, true);
  actionButtonsEnabled(ui.elements.assetHistoryList.innerHTML);
  const preview = calls.find(call => call.body?.action === 'history_event_delete_preview')?.body;
  const commit = calls.find(call => call.body?.action === 'history_event_delete')?.body;
  assert.equal(preview.expectedCycleStartRevision, '');
  assert.equal(commit.expectedCycleRuntimeRevision, '');
});
