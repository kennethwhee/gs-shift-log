import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const js=readFileSync(new URL('../maintenance/blower-history.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../maintenance/blower-history.html',import.meta.url),'utf8');

test('every authenticated desktop history item gets generic edit/delete controls',()=>{
  assert.match(js,/function canEditAnyHistoryEvent\(asset, event\)/);
  assert.doesNotMatch(js.slice(js.indexOf('function canDeleteManualHistoryEvent'),js.indexOf('async function openHistoryDeleteDialog')),/sourceType\s*===\s*["']manual/);
  assert.match(js,/data-history-action="history_event_edit"/);
  assert.match(js,/data-history-action="history_event_delete"/);
});

test('generic edit dialog can change event type/date/runtime/content while retaining source as read-only context',()=>{
  for(const id of ['historyEventEditDialog','historyEventEditType','historyEventEditDate','historyEventEditRuntime','historyEventEditIssue','historyEventEditAction','historyEventEditNote','historyEventEditReason']) assert.ok(html.includes(`id="${id}"`),id);
  assert.match(js,/action:\s*"history_event_edit"/);
  assert.match(js,/historyEventEditSource\.textContent/);
});

test('delete preview still requires confirmation and communicates audit preservation',()=>{
  assert.match(html,/삭제 원본·삭제자·삭제시각은 변경 기록에 보존됩니다/);
  assert.match(js,/previewToken:\s*token,\s*confirmDelete:\s*true/);
});
