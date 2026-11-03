'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Source section exists: ${start}`);
  return source.slice(from, to);
}
function load(context, code) {
  vm.runInContext(code, context);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, value => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[value]));
}
function makeContext(extra = {}) {
  return vm.createContext({ console, encodeURIComponent, File, FormData, escapeHtml, ...extra });
}
function detailHtml(log) {
  const content = { innerHTML: '', querySelectorAll: () => [] };
  const context = makeContext({
    appState: {}, elements: { logDetailContent: content, logDetailModal: {} },
    getShiftDisplayName: value => value, normalizeTeamName: value => value,
    normalizeMemberLogRole: value => value, getStatusClass: () => 'is-approved',
    collectLogEntriesForDisplay: () => [], sortDetailEntriesByTime: entries => entries,
    parseOperationStatusRowsForDisplay: () => [],
    bindDetailAttachmentPreviewEvents: () => {}, openModal: () => {}, showToast: () => {},
    createDetailAttachmentPreviewCardHtml: item => `<a href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a>`
  });
  load(context, between('function normalizeDetailAttachment(', 'function ensureAttachmentPreviewModal()'));
  load(context, between('function openLogDetail(\n', 'function closeLogDetail()'));
  context.openLogDetail({ id: 'log-1', date: '2026-11-03', shift: 'DS', role: 'BO2', author: '최연호', ...log });
  return content.innerHTML.split('shift-log-detail-section--attachment')[1];
}

const uploadNormalization = between('  function normalizeShiftLogRealAttachment(', '  /* =====================================================\n    실제 파일 R2 업로드');
const uploadRequest = between('  async function uploadShiftLogRealAttachments(', '  /* =====================================================\n    기존 업무일지 저장 함수 보존');
const uploadSaveWrapper = between('  saveCurrentLog =\n    async function saveCurrentLogWithRealAttachments(', '  /* =====================================================\n    신규 첨부파일 미리보기 주소 최종 처리');
const editorHelpers = between('  function getEditorAttachmentId(', '  /* =====================================================\n    새로 선택된 로컬 파일');
const editorSync = between('  function getSyncedShiftLogAttachmentCount(', '  /* =====================================================\n    실제 저장된 R2 첨부파일 삭제');
const editorDelete = between('  async function deleteSavedShiftLogAttachment(', '  /* =====================================================\n    첨부파일 삭제 버튼 이벤트');
const modern = { id: 'new-file-uuid', name: '현재.jpg', url: '/api/shift-log-files?id=new-file-uuid', storageType: 'shift-log-r2' };
const legacy = { id: 71, name: '과거.jpg', url: '/api/legacy-attachment?id=71', source: 'legacy', isLegacy: true };

function uploadContext(result) {
  const calls = [];
  const context = makeContext({
    SHIFT_LOG_FILE_API_URL: '/api/shift-log-files',
    getShiftLogAuthHeaders: () => ({ Authorization: 'Bearer test-session' }),
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, text: async () => JSON.stringify(result) }; }
  });
  load(context, between('  async function readShiftLogFileApiResponse(', '  /* =====================================================\n    신규 첨부파일 객체 정규화'));
  load(context, uploadNormalization + uploadRequest);
  return { context, calls };
}

function editorContext(log, attachments) {
  const calls = [], notices = [];
  const context = makeContext({
    SHIFT_LOG_FILE_API: '/api/shift-log-files',
    appState: { editorSavedAttachments: attachments, logs: [log] },
    currentSearchResultLogs: [{ ...log }],
    getCurrentEditingShiftLogId: () => log.id,
    getShiftLogAuthHeaders: () => ({ Authorization: 'Bearer test-session' }),
    showCompactConfirm: async () => true,
    showToast: message => notices.push(message),
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, text: async () => '{"ok":true}' }; },
    renderShiftLogEditorAttachments: () => {}, renderLogTable: () => {}, updateShiftMemberCardStates: () => {}
  });
  load(context, editorHelpers + editorSync + editorDelete);
  return { context, calls, notices };
}

test('partial lookup with no known files does not claim zero or no attachments', () => {
  const html = detailHtml({ attachments: [], legacyAttachmentCount: 1, attachmentLoadStatus: 'partial', attachmentLoadError: true });
  assert.match(html, /확인 필요/);
  assert.match(html, /첨부파일 정보를 모두 확인하지 못했습니다/);
  assert.doesNotMatch(html, /첨부파일이 없습니다|>\s*0개\s*</);
});

test('partial lookup keeps valid known cards visible with a warning', () => {
  const html = detailHtml({ attachments: [legacy, modern], attachmentLoadStatus: 'partial' });
  assert.match(html, /\/api\/legacy-attachment\?id=71/);
  assert.match(html, /\/api\/shift-log-files\?id=new-file-uuid/);
  assert.match(html, /확인 필요/);
});

test('authoritative complete empty lookup displays zero and a real empty state', () => {
  const html = detailHtml({ attachments: [], legacyAttachmentCount: 0, attachmentLoadStatus: 'complete', attachmentLoadError: false });
  assert.match(html, />\s*0개\s*</);
  assert.match(html, /첨부파일이 없습니다/);
  assert.doesNotMatch(html, /확인 필요/);
});

test('normalization preserves canonical URLs and modern numeric IDs, and keeps legacy read-only', () => {
  const { context } = uploadContext({});
  load(context, 'const SHIFT_LOG_FILE_API = "/api/shift-log-files";\n' + editorHelpers);
  for (const item of [modern, { id: 12, name: 'numeric-current.jpg', url: '/api/shift-log-files?id=12' }, { id: 13, storageType: 'shift-log-r2', name: 'typed-current.jpg' }]) {
    const normalized = context.normalizeShiftLogRealAttachment(item);
    assert.equal(normalized.storageType, 'shift-log-r2');
    assert.equal(normalized.url, item.url || `/api/shift-log-files?id=${item.id}`);
    assert.equal(context.isEditableShiftLogR2Attachment(normalized), true);
  }
  const normalizedLegacy = context.normalizeShiftLogRealAttachment(legacy);
  assert.equal(normalizedLegacy.url, legacy.url);
  assert.equal(normalizedLegacy.storageType, 'legacy');
  assert.equal(context.isEditableShiftLogR2Attachment(normalizedLegacy), false);
});

test('upload success retains merged legacy and modern attachments plus complete count', async () => {
  const { context, calls } = uploadContext({ ok: true, attachments: [legacy, modern], legacyAttachmentCount: 2, attachmentLoadStatus: 'complete', attachmentLoadError: false });
  const result = await context.uploadShiftLogRealAttachments('log-1', [new File(['image'], 'current.jpg')]);
  assert.equal(result.attachments.length, 2);
  assert.equal(result.attachments[0].url, legacy.url);
  assert.equal(result.legacyAttachmentCount, 2);
  assert.equal(result.attachmentLoadStatus, 'complete');
  assert.equal(result.attachmentLoadError, false);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-session');
  assert.equal(calls[0].options.method, 'POST');
});

test('upload/save roundtrip propagates partial lookup state without dropping known legacy files', async () => {
  const { context } = uploadContext({ ok: true, attachments: [legacy, modern], legacyAttachmentCount: 3, attachmentLoadStatus: 'partial', attachmentLoadError: true });
  const saved = { id: 'log-1', status: '결재완료', serverRevision: 7, attachments: [legacy], legacyAttachmentCount: 1 };
  const replaced = [];
  Object.assign(context, {
    elements: { logAttachments: { files: [new File(['image'], 'current.jpg')], value: 'pending' } },
    saveCurrentLog: null,
    saveCurrentLogBeforeRealAttachmentUpload: async () => saved,
    replaceSharedShiftLogInState: log => replaced.push(log),
    showToast: () => {}, renderSavedAttachments: () => {}, renderLogTable: () => {}, updateShiftMemberCardStates: () => {}
  });
  load(context, uploadSaveWrapper);
  const result = await context.saveCurrentLog('결재완료', { closeAfterSave: false });
  assert.equal(result.attachments.length, 2);
  assert.equal(result.attachments[0].url, legacy.url);
  assert.equal(result.legacyAttachmentCount, 3);
  assert.equal(result.attachmentLoadStatus, 'partial');
  assert.equal(result.attachmentLoadError, true);
  assert.equal(result.status, saved.status);
  assert.equal(result.serverRevision, saved.serverRevision);
  assert.equal(replaced[0], result);
});

test('deleting the last modern attachment clears the list and search counts to zero', async () => {
  const log = { id: 'log-1', attachments: [modern], legacyAttachmentCount: 1, attachmentLoadStatus: 'complete' };
  const { context, calls } = editorContext(log, [modern]);
  await context.deleteSavedShiftLogAttachment(modern.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'DELETE');
  assert.equal(context.appState.logs[0].attachments.length, 0);
  assert.equal(context.appState.logs[0].legacyAttachmentCount, 0);
  assert.equal(context.currentSearchResultLogs[0].legacyAttachmentCount, 0);
});

test('partial deletion only subtracts the known removed file from unresolved count', async () => {
  const log = { id: 'log-1', attachments: [modern], legacyAttachmentCount: 3, attachmentLoadStatus: 'partial', attachmentLoadError: true };
  const { context } = editorContext(log, [modern]);
  await context.deleteSavedShiftLogAttachment(modern.id);
  assert.equal(context.appState.logs[0].legacyAttachmentCount, 2);
  assert.equal(context.appState.logs[0].attachmentLoadError, true);
});

test('direct legacy deletion calls are rejected before confirmation or network access', async () => {
  const log = { id: 'log-1', attachments: [legacy], legacyAttachmentCount: 1, attachmentLoadStatus: 'complete' };
  const { context, calls, notices } = editorContext(log, [legacy]);
  let confirms = 0;
  context.showCompactConfirm = async () => { confirms++; return true; };
  await context.deleteSavedShiftLogAttachment(String(legacy.id));
  assert.equal(calls.length, 0);
  assert.equal(confirms, 0);
  assert.equal(context.appState.logs[0].attachments.length, 1);
  assert.match(notices[0], /과거 업무일지 첨부파일/);
});
