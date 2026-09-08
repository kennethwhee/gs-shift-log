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
  const expose = `globalThis.ui={state,elements,cacheElements,bindEvents,openAssetHistory,canEditManualReplacement,openReplacementEditDialog,updateReplacementEditFields,saveReplacementEdit,canDeleteManualHistoryEvent,openHistoryDeleteDialog,submitHistoryDelete,renderAssetCard,applyMobileMonitoringMode,applyPublicMonitoringMode};
    globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;showToast=h.toast;currentServerDate=()=>new Date('${now}');};\n`;
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, expose + marker), context);
  const ui = context.ui; ui.cacheElements(); ui.bindEvents();
  const asset = { tagNumber: tag, blowerType: 'organic_fuel', displayName: '#1 유기성 고형연료 Blower #A', positionLabel: '#A',
    lastReplacementAt: '2026-08-19T15:00:00.000Z', cycleStartState: 'pending', cycleStartRevision: 'start-original', cycleRuntimeRevision: 'runtime-original',
    cycleElapsedHours: 0, cycleRuntimeState: 'stopped', isRunning: false, severity: 'startup_pending', cycleRuntimeTracked: true };
  const replacement = { id: 'manual-current', tagNumber: tag, eventType: 'replacement', sourceType: 'manual', eventDate: asset.lastReplacementAt,
    issueType: '이상진동', actionType: 'V-Belt 교체', note: '잘못 입력한 교체', updatedAt: '2026-09-08T14:15:00.000Z', createdAt: '2026-09-08T14:15:00.000Z' };
  ui.state.data = { permissions: { canWrite }, user: canWrite ? { name: 'Tester' } : null, backfill: { hasRun: true, status: 'complete' }, assets: [asset],
    events: [{ id: 'runtime', tagNumber: tag, sourceType: 'dataparc_runtime', eventType: 'runtime_correction', eventDate: now, note: 'Earlier DataPARC result' }, replacement,
      { ...replacement, id: 'old-manual', eventDate: '2025-12-18T15:00:00.000Z' }, { ...replacement, id: 'old-auto', sourceType: 'shift_log_history_v13', eventDate: '2025-01-01T00:00:00.000Z' }] };
  let request = async options => options.body.action === 'history_event_delete_preview'
    ? { previewToken: 'a'.repeat(64), preview: { detail: '기동 대기·누적 0시간으로 돌아갑니다.', lastReplacementAt: asset.lastReplacementAt, operationState: 'startup_pending', runtimeHours: 0, asOf: now } }
    : { message: '삭제 완료' };
  context.hooks({ api: async options => { calls.push(JSON.parse(JSON.stringify(options))); return request(options); }, load: async options => { refreshes.push(options); }, toast: (...args) => { toasts.push(args); } });
  const open = () => ui.openReplacementEditDialog(tag, replacement.id);
  const submit = () => ui.elements.replacementEditForm.listeners.submit({ preventDefault() {} });
  return { ui, asset, replacement, calls, refreshes, toasts, open, submit, deleteOpen: () => ui.openHistoryDeleteDialog(tag, replacement.id), deleteSubmit: () => ui.elements.historyDeleteForm.listeners.submit({ preventDefault() {} }), setRequest: fn => { request = fn; } };
}


test('manual replacement rows get compact deletion controls without removing existing edit',()=>{
 const h=harness();h.ui.openAssetHistory(tag);const markup=h.ui.elements.assetHistoryList.innerHTML;
 assert.equal((markup.match(/data-history-action="history_event_delete"/g)||[]).length,2);
 assert.match(markup,/data-history-action="replacement_event_edit"/);assert.doesNotMatch(markup,/data-history-action="history_event_delete" data-event-id="runtime"/);
});
test('all supported manual kinds can expose deletion, including problem records previously hidden in history',()=>{
 const h=harness();for(const eventType of ['startup','operation_start','operation_stop','runtime_correction','problem'])h.ui.state.data.events.unshift({...h.replacement,id:eventType,eventType});
 h.ui.openAssetHistory(tag);for(const eventType of ['startup','operation_start','operation_stop','runtime_correction','problem'])assert.match(h.ui.elements.assetHistoryList.innerHTML,new RegExp(`data-history-action="history_event_delete" data-event-id="${eventType}"`));
});
test('public, mobile, automatic, linked, disabled and unverifiable rows cannot force open deletion',async()=>{
 for(const options of [{mobile:true},{canWrite:false}]){const h=harness(options);h.ui.openAssetHistory(tag);assert.doesNotMatch(h.ui.elements.assetHistoryList.innerHTML,/data-history-action="history_event_delete"/);await h.deleteOpen();assert.equal(h.ui.elements.historyDeleteDialog.open,false);assert.equal(h.calls.length,0);}
 for(const change of [h=>h.replacement.sourceType='dataparc_runtime',h=>h.replacement.sourceLogId='log',h=>h.replacement.updatedAt='',h=>h.asset.cycleRuntimeRevision='',h=>h.ui.state.busy=true,h=>h.ui.state.dataparcRuntimeBusy=true]){const h=harness();change(h);await h.deleteOpen();assert.equal(h.calls.length,0);assert.equal(h.ui.elements.historyDeleteDialog.open,false);}
});
test('opening deletion performs only read-only preview and displays server computed outcome',async()=>{
 const h=harness();h.ui.openAssetHistory(tag);await h.deleteOpen();assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].body.action,'history_event_delete_preview');assert.equal(h.ui.elements.historyDialog.open,false);assert.equal(h.ui.elements.historyDeleteDialog.open,true);
 assert.equal(h.ui.elements.historyDeleteConfirm.disabled,false);assert.match(h.ui.elements.historyDeletePreview.textContent,/기동 대기/);assert.match(h.ui.elements.historyDeletePreview.textContent,/0시간/);
 assert.equal(h.ui.elements.historyDeleteSnapshot,undefined);assert.equal(h.ui.state.historyDeleteToken,'a'.repeat(64));
});
test('deletion preview with unknown hours never formats them as 0',async()=>{
 const h=harness();h.setRequest(async()=>({previewToken:'b'.repeat(64),preview:{detail:'직전 교체 기준으로 복원, 운전시간 확인 필요',lastReplacementAt:'2025-12-18T15:00:00.000Z',operationState:'unknown',runtimeHours:null,asOf:now}}));await h.deleteOpen();
 assert.match(h.ui.elements.historyDeletePreview.textContent,/운전상태: 확인 필요/);assert.match(h.ui.elements.historyDeletePreview.textContent,/누적 운전시간: 확인 필요/);assert.doesNotMatch(h.ui.elements.historyDeletePreview.textContent,/0시간/);
});
test('dependency rejection shows server guidance and leaves delete disabled',async()=>{
 const h=harness();h.setRequest(async()=>{throw new Error('나중 기동 이력부터 삭제해 주세요.');});await h.deleteOpen();assert.equal(h.ui.elements.historyDeleteConfirm.disabled,true);assert.equal(h.ui.state.historyDeleteToken,'');assert.match(h.ui.elements.historyDeleteError.textContent,/나중 기동/);
 await h.deleteSubmit();assert.equal(h.calls.length,1);
});
test('cancelled or superseded preview response cannot arm a different confirmation dialog',async()=>{
 const h=harness();let resolve;h.setRequest(()=>new Promise(r=>resolve=r));const pending=h.deleteOpen();h.ui.elements.historyDeleteDialog.open=false;h.ui.elements.historyDeleteDialog.listeners.close();
 resolve({previewToken:'a'.repeat(64),preview:{operationState:'running',runtimeHours:7}});await pending;
 assert.equal(h.ui.state.historyDeleteToken,'');assert.equal(h.ui.elements.historyDeleteConfirm.disabled,true);
});
test('submit sends exact immutable snapshot and confirms once, then refreshes without auto-operation sync',async()=>{
 const h=harness();await h.deleteOpen();const original={...h.ui.state.historyDeleteSnapshot};h.ui.elements.historyDeleteReason.value=' 중복 입력 ';
 await h.deleteSubmit();const request=h.calls[1];assert.equal(request.body.action,'history_event_delete');assert.equal(request.body.confirmDelete,true);assert.equal(request.body.changeNote,'중복 입력');assert.equal(request.body.previewToken,'a'.repeat(64));
 for(const key of Object.keys(original))assert.equal(request.body[key],original[key]);
 assert.equal(h.refreshes.length,1);assert.equal(h.refreshes[0].syncOperations,false);assert.equal(h.ui.state.historyDeleteSnapshot,null);assert.equal(h.ui.state.busy,false);
 await h.deleteSubmit();assert.equal(h.calls.length,2);
});
test('double click while deleting makes only one write request',async()=>{
 const h=harness();await h.deleteOpen();let resolve;h.setRequest(()=>new Promise(r=>resolve=r));const first=h.deleteSubmit();await h.deleteSubmit();assert.equal(h.calls.length,2);assert.equal(h.ui.state.historyDeleteSubmitting,true);
 let prevented=false;h.ui.elements.historyDeleteDialog.listeners.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);
 resolve({message:'삭제 완료'});await first;assert.equal(h.ui.state.historyDeleteSubmitting,false);
});
test('lost permissions after preview prevents commit and public mode clears its dialog',async()=>{
 const h=harness();await h.deleteOpen();h.ui.state.data.permissions.canWrite=false;await h.deleteSubmit();assert.equal(h.calls.length,1);h.ui.applyPublicMonitoringMode();assert.equal(h.ui.elements.historyDeleteDialog.open,false);assert.equal(h.ui.state.historyDeleteToken,'');
});
test('failed commit clears preview token, keeps failure visible and does not silently retry',async()=>{
 const h=harness();await h.deleteOpen();h.setRequest(async()=>{throw new Error('다른 사용자가 이력을 변경했습니다.');});await h.deleteSubmit();assert.equal(h.ui.elements.historyDeleteDialog.open,true);assert.match(h.ui.elements.historyDeleteError.textContent,/다른 사용자/);assert.equal(h.ui.state.historyDeleteToken,'');assert.equal(h.ui.state.busy,false);await h.deleteSubmit();assert.equal(h.calls.length,2);
});
test('unknown current runtime stays unknown in cards and history with no fabricated zero, D-day or progress',()=>{
 const h=harness();Object.assign(h.asset,{cycleStartState:'legacy',cycleRuntimeState:'unknown',operationState:'unknown',severity:'runtime_unknown',cycleElapsedHours:null,runtimeHours:null,remainingHours:null,progressPct:null});
 h.ui.openAssetHistory(tag);assert.match(h.ui.elements.historyCycleSummary.innerHTML,/확인 필요/);assert.doesNotMatch(h.ui.elements.historyCycleSummary.innerHTML,/0시간|정지중|기동중/);
 const card=h.ui.renderAssetCard(h.asset,{cycleDays:90});assert.match(card,/확인 필요/);assert.doesNotMatch(card,/aria-valuenow|0%|D-DAY|data-asset-action="operation_toggle"/);assert.match(card,/data-asset-action="dataparc_runtime_probe"/);
});
test('delete dialog ids are unique, errors accessible, cancel is default and cache versions match',()=>{
 for(const id of ['historyDeleteDialog','historyDeleteForm','historyDeleteAsset','historyDeleteTarget','historyDeletePreview','historyDeleteReason','historyDeleteError','historyDeleteConfirm','historyDeleteCancel'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
 assert.match(html,/id="historyDeleteCancel"[^>]*autofocus/);assert.match(html,/id="historyDeleteConfirm"[^>]*disabled/);assert.match(html,/id="historyDeleteError" role="alert" hidden/);assert.match(css,/body\.mobile-monitoring #historyDeleteDialog/);assert.match(css,/body\.public-monitoring #historyDeleteDialog/);
 assert.match(html,/blower-history\.js\?v=20260909-history-delete-v1/);
});
