import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { collectWebAssets, RETIRED_ASSETS } from '../scripts/build-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const names = ['createImportedEntryUniqueKey', 'openFacilityNavigator', 'findSearchResultLogById',
  'getCurrentShiftLogPermissionType', 'updateLogEditorActionButtons', 'canCurrentUserEditShiftLog',
  'formatEfficiencyDailyWorkDisplayDate'];

// Exercise the hoisted base declarations. Later assignment-based UI wrappers are
// deliberately retained by the cleanup; these checks do not replace API authorization tests.
function harness(file, overrides = {}) {
  const source = read(file);
  const definitions = names.map(name => {
    const declarations = [...source.matchAll(new RegExp('\\bfunction\\s+' + name + '\\s*\\(', 'g'))]
      .filter(match => source.slice(0, match.index).trimEnd().at(-1) !== '=');
    assert.equal(declarations.length, 1, file + ': ambiguous declaration ' + name);
    const start = declarations[0].index;
    // V14 is compacted onto long lines; let Node identify the complete function
    // instead of assuming a particular indentation or a brace-free body.
    for (let end = source.indexOf('}', start); end !== -1; end = source.indexOf('}', end + 1)) {
      const definition = source.slice(start, end + 1);
      try { new vm.Script('(' + definition + '\n)'); return definition; }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    throw new Error('Incomplete declaration: ' + name);
  });
  const calls = [], buttons = { submit: {}, draft: {}, request: {} };
  const user = { employeeNo: '1001', name: '검증 사용자', role: 'member' };
  const sandbox = {
    user, buttons, currentSearchResultLogs: [], appState: { logs: [] },
    normalizeMemberLogRole: role => String(role || '').trim(),
    createLogEntryImportKey: entry => String(entry.content || '').trim(),
    getCurrentShiftLogUserIdentity: () => user,
    getShiftLogEditorSubmitButton: () => buttons.submit,
    elements: { saveDraftButton: buttons.draft, requestApprovalButton: buttons.request },
    document: { getElementById: () => null },
    isReadOnlyLegacyShiftLog: log => log.legacy === true,
    normalizeShiftLogApprovalStatus: value => value,
    isCurrentUserSuperAdmin: () => user.role === 'super_admin',
    isCurrentUserShiftLogAuthor: log => log.author === user.employeeNo,
    isCurrentShiftLogLeader: () => user.role === 'leader',
    parseEfficiencyDailyWorkDateValue: value => value ? new Date(value + 'T12:00:00') : null,
    FACILITY_NAVIGATOR_URL: 'https://navigator.invalid/', FACILITY_NAVIGATOR_WINDOW_NAME: 'navigator',
    showToast: message => calls.push({ toast: message }), console,
    window: { open: (...args) => { calls.push({ open: args }); return { focus: () => calls.push({ focus: true }) }; } },
    ...overrides
  };
  vm.createContext(sandbox);
  vm.runInContext(definitions.join('\n'), sandbox, { timeout: 1000 });
  return { api: sandbox, user, calls, buttons };
}

for (const file of ['script.js', 'mobile-app/mobile-runtime-v14.js']) {
  test(file + ': imported source index zero is stable; blank or invalid indices use content identity', () => {
    const { api } = harness(file);
    const entry = { importedFromRole: '파트장', importedFromLogId: ' log-1 ', importedFromEntryIndex: 0, content: '기록' };
    assert.equal(api.createImportedEntryUniqueKey(entry), 'SOURCE||파트장||log-1||0');
    for (const value of ['', null, undefined, -1, 'bad']) {
      assert.equal(api.createImportedEntryUniqueKey({ ...entry, importedFromEntryIndex: value }), 'CONTENT||파트장||기록');
    }
  });
  test(file + ': log search prefers the current search result and falls back to loaded records', () => {
    const { api } = harness(file);
    const found = { id: 'A', value: 'search' }, loaded = { id: 'B', value: 'loaded' };
    api.currentSearchResultLogs = [found]; api.appState.logs = [{ id: 'A' }, loaded];
    assert.equal(api.findSearchResultLogById(' A '), found);
    assert.equal(api.findSearchResultLogById('B'), loaded);
    assert.equal(api.findSearchResultLogById(''), null);
    api.currentSearchResultLogs = null; api.appState.logs = null;
    assert.equal(api.findSearchResultLogById('missing'), null);
  });
  test(file + ': base leader and member editor actions keep their role policy', () => {
    const { api, user, buttons } = harness(file);
    for (const role of ['member', 'leader', ' admin ', 'super_admin', '']) {
      user.role = role; const leader = ['leader', 'admin'].includes(role.trim());
      assert.equal(api.getCurrentShiftLogPermissionType(), leader ? 'leader' : 'member');
      api.updateLogEditorActionButtons();
      assert.equal(buttons.submit.hidden, !leader); assert.equal(buttons.submit.disabled, !leader);
      assert.equal(buttons.draft.hidden, leader); assert.equal(buttons.request.disabled, leader);
      assert.equal(buttons.draft.textContent, '임시저장'); assert.equal(buttons.request.textContent, '결재요청');
    }
  });
  test(file + ': base edit predicate keeps legacy records and unverified identities read-only', () => {
    const { api, user } = harness(file);
    user.role = 'super_admin';
    assert.equal(api.canCurrentUserEditShiftLog(null), false);
    assert.equal(api.canCurrentUserEditShiftLog({ legacy: true, status: '임시저장' }), false);
    user.employeeNo = '';
    assert.equal(api.canCurrentUserEditShiftLog({ status: '임시저장' }), false);
  });
  test(file + ': base draft, author and administrator edit predicates are preserved', () => {
    const { api, user } = harness(file);
    assert.equal(api.canCurrentUserEditShiftLog({ status: '임시저장', author: 'other' }), true);
    assert.equal(api.canCurrentUserEditShiftLog({ status: '저장완료', author: 'other' }), false);
    user.role = 'leader';
    assert.equal(api.canCurrentUserEditShiftLog({ status: '저장완료', role: '파트장', author: '1001' }), true);
    assert.equal(api.canCurrentUserEditShiftLog({ status: '저장완료', role: '파트장', author: 'other' }), false);
    user.role = 'super_admin';
    assert.equal(api.canCurrentUserEditShiftLog({ status: '저장완료', author: 'other' }), true);
  });
  test(file + ': Navigator normalizes and encodes tags, and reports blank or blocked navigation', () => {
    const { api, calls } = harness(file);
    api.openFacilityNavigator(''); assert.equal(calls.length, 1); assert.ok(calls[0].toast);
    api.openFacilityNavigator(' tag / 01 ');
    assert.equal(calls[1].open[0], 'https://navigator.invalid/?tag=TAG%20%2F%2001');
    assert.equal(calls[1].open[1], 'navigator'); assert.equal(calls[2].focus, true);
    api.window.open = () => null; api.openFacilityNavigator('TAG'); assert.ok(calls.at(-1).toast.includes('차단'));
  });
  test(file + ': daily work dates keep padded Korean dates and handle blank input', () => {
    const { api } = harness(file);
    assert.equal(api.formatEfficiencyDailyWorkDisplayDate('2026-09-25'), '2026년 09월 25일 금요일');
    assert.equal(api.formatEfficiencyDailyWorkDisplayDate(''), '');
  });
}

test('every retired asset remains excluded and cannot be referenced by published source', async () => {
  const files = await collectWebAssets(root);
  for (const retired of RETIRED_ASSETS) assert.ok(!files.includes(retired), retired);
  for (const file of files.filter(file => /\.(?:html|css|js)$/.test(file))) {
    const source = read(file);
    for (const retired of RETIRED_ASSETS) assert.ok(!source.includes(path.posix.basename(retired)), file + ' references ' + retired);
  }
});

test('PC script and mobile preload/execution URLs identify the cleaned runtime consistently', () => {
  assert.match(read('index.html'), /src="script\.js\?v=20260925-structure-v12&amp;limestone=20260925-v1"/);
  const mobile = read('mobile-app/index.html');
  const urls = [...mobile.matchAll(/(?:src|href)="(\/mobile-app\/mobile-runtime-v14\.js\?[^"\s]+)"/g)].map(m => m[1]);
  assert.equal(urls.length, 2); assert.equal(urls[0], urls[1]);
  assert.ok(urls[0].endsWith('?v=20260925-structure-v12'));
});
