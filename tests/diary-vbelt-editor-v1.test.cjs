'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'maintenance/diary-vbelt-core-v1.js'), 'utf8').replace(/export function /g, 'function ');
const ui = fs.readFileSync(path.join(root, 'maintenance/diary-vbelt-confirm-v1.js'), 'utf8').replace(/^import .*\n/, '');
const content = 'FBHE Blower #A V-Belt 교체 완료';
const annotation = {version:1, confirmed:true, content, targets:[{tagNumber:'104HHL60AP611', replacedOn:'2026-11-03', completedTime:''}]};
const plain = value => JSON.parse(JSON.stringify(value));
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
class Control {
  constructor(value = '') { this.value = value; this.checked = false; this.hidden = false; this.listeners = {}; this.textContent = ''; this.disabled = false; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  fire(type) { this.listeners[type]?.({target:this}); }
  focus() { this.focused = true; }
}
function environment() {
  const controls = new Map();
  const tags = {tagNumber:'104HHL60AP611',equipmentName:'FBHE Blower',unitNo:1,positionLabel:'#A'};
  const calls = [];
  const context = vm.createContext({ console, window:{}, document:{getElementById:id => id==='logDate' ? {value:'2026-11-03'} : null}, Element:Control,
    AbortController, setTimeout, clearTimeout,
    getShiftLogAuthHeaders:() => ({Authorization:'Bearer test'}),
    fetch:async (url, options) => { calls.push({url,options}); return {ok:true,json:async()=>({ok:true,assets:[tags]})}; }
  });
  vm.runInContext(core+'\n'+ui,context);
  return {context,api:context.window.GSDiaryVBeltConfirm,calls,controls};
}
function fakeEditor(env, value) {
  const rootNode = new Control(); rootNode.isConnected = true;
  const textarea = new Control(value);
  const selectors = ['.diary-vbelt-confirm__checkbox','.diary-vbelt-confirm__check','.diary-vbelt-confirm__details','.diary-vbelt-confirm__notice','.diary-vbelt-confirm__error','.diary-vbelt-confirm__add','.diary-vbelt-confirm__retry'];
  const nodes = new Map(selectors.map(selector=>[selector,new Control()]));
  const host = {};
  let rows = [];
  Object.defineProperty(host,'innerHTML',{set(html) {
    rows = [...html.matchAll(/<div class="diary-vbelt-confirm__target">([\s\S]*?)<\/div>/g)].map(match=>{
      const selected = /<option value="([^"]*)" selected>/.exec(match[1]);
      const date = /data-vbelt-date[^>]*value="([^"]*)"/.exec(match[1]);
      const time = /data-vbelt-time[^>]*value="([^"]*)"/.exec(match[1]);
      const fields = {'[data-vbelt-tag]':new Control(selected?.[1]||''),'[data-vbelt-date]':new Control(date?.[1]||''),'[data-vbelt-time]':new Control(time?.[1]||'')};
      return {querySelector:selector=>fields[selector]};
    });
  }});
  nodes.set('.diary-vbelt-confirm__targets',host);
  rootNode.querySelector = selector => nodes.get(selector) || rows[0]?.querySelector(selector);
  rootNode.querySelectorAll = selector => selector === '.diary-vbelt-confirm__target' ? rows : [];
  const editor = {querySelector:selector=>selector==='.diary-vbelt-confirm'?rootNode:selector==='.section-context-entry-content'?textarea:null};
  return {editor,root:rootNode,input:textarea,checkbox:nodes.get('.diary-vbelt-confirm__checkbox'),rows:()=>rows};
}
const flush = () => new Promise(resolve=>setImmediate(resolve));

function installSectionComposer(env, showToast = () => {}) {
  Object.assign(env.context, {
    getCurrentRole: () => 'BCO1',
    getCurrentAuthor: () => '작성자',
    normalizeRole: value => value,
    createEntryId: () => 'new',
    SECTION_TYPES: { ISSUE: 'issue', HANDOVER: 'handover', INSTRUCTION: 'instruction', REMARK: 'remark' },
    ISSUE_CATEGORIES: [{ value: 'BM 발행' }],
    HANDOVER_CATEGORIES: [{ value: '인계사항' }],
    showToast
  });
  vm.runInContext(between('function normalizeContentTimeToken(', 'function extractTimesFromLogEntryContent('), env.context);
  const composer = between('(function installSectionContextEntryV3()', '(function installSectionContextEntryV4Compatibility()');
  const helpers = composer.slice(
    composer.indexOf('  function normalizeContent('),
    composer.indexOf('  function getCurrentTimeText()')
  );
  const save = between('  function createNewEntry(', '  function saveContextEntry(');
  vm.runInContext('(() => {\n' + helpers + save + '\nObject.assign(globalThis, { createNewEntry, splitContextEntryText });\n})();', env.context);
}

test('manual confirmation preserves all targets, false is authoritative, stale text becomes false',()=>{
  const {api}=environment();
  assert.deepEqual(plain(api.copyAnnotation({content,vBeltReplacement:annotation})),annotation);
  assert.deepEqual(plain(api.copyAnnotation({content,vBeltReplacement:{...annotation,confirmed:false}})),{version:1,confirmed:false,content,targets:[]});
  assert.equal(api.copyAnnotation({content}),undefined);
  const changed = api.copyAnnotation({content:'V-Belt Tension 조정',vBeltReplacement:annotation});
  assert.equal(changed.confirmed,false); assert.equal(changed.content,'V-Belt Tension 조정');
  assert.equal(api.badgeHtml({content,vBeltReplacement:annotation}).includes('V-belt 교체 확인'),true);
  assert.equal(api.badgeHtml({content:'Belt 장력 조정',vBeltReplacement:annotation}),'');
});

test('previous-shift copies cannot create a new confirmation, including old unannotated text',()=>{
  const {api}=environment();
  assert.equal(api.resetCopiedAnnotation({content,vBeltReplacement:annotation}).confirmed,false);
  assert.equal(api.resetCopiedAnnotation({content}).confirmed,false);
  assert.equal(api.resetCopiedAnnotation({content:'순찰 실시'}),undefined);
});

test('new candidate is unchecked and pure tension has no checkbox; text change requires manual reconfirmation',()=>{
  const env=environment(), item=fakeEditor(env,content);
  env.api.mountEditor(item.editor);
  assert.equal(item.root.hidden,false); assert.equal(item.checkbox.checked,false);
  assert.equal(env.api.readEditor(item.editor,content).annotation.confirmed,false);
  item.input.value='FBHE Blower #A V-Belt Tension 조정 완료';item.input.fire('input');
  assert.equal(item.root.querySelector('.diary-vbelt-confirm__check').hidden,true);
  item.input.value=content;item.input.fire('input');
  item.checkbox.checked=true;item.checkbox.fire('change');
  item.input.value=content+' 후 기동';item.input.fire('input');
  assert.equal(item.checkbox.checked,false);
  assert.match(item.root.querySelector('.diary-vbelt-confirm__notice').textContent,/다시 해주세요/);
  assert.equal(env.api.readEditor(item.editor,item.input.value).annotation.confirmed,false);
});

test('checked row needs explicit catalog selection and date; blank completion time stays blank',async()=>{
  const env=environment(), item=fakeEditor(env,content);
  env.api.mountEditor(item.editor);item.checkbox.checked=true;item.checkbox.fire('change');
  await flush();
  assert.equal(env.calls.length,1);assert.equal(env.calls[0].options.method,'GET');
  assert.equal(env.calls[0].options.headers.Authorization,'Bearer test');
  assert.equal(env.api.readEditor(item.editor,content).ok,false);
  item.rows()[0].querySelector('[data-vbelt-tag]').value='104HHL60AP611';
  item.rows()[0].querySelector('[data-vbelt-date]').value='';
  assert.equal(env.api.readEditor(item.editor,content).ok,false);
  item.rows()[0].querySelector('[data-vbelt-date]').value='2026-11-02';
  const result=env.api.readEditor(item.editor,content);
  assert.equal(result.ok,true);assert.equal(result.annotation.targets[0].replacedOn,'2026-11-02');
  assert.equal(result.annotation.targets[0].completedTime,'');
  item.checkbox.checked=false;item.checkbox.fire('change');
  assert.equal(env.api.readEditor(item.editor,content).annotation.confirmed,false);
});

test('existing check restores, programmatic content edit clears it, cancel does not mutate original',async()=>{
  const env=environment(), original={id:'a',content,vBeltReplacement:structuredClone(annotation)}, item=fakeEditor(env,content);
  env.api.mountEditor(item.editor,original);await flush();
  assert.equal(item.checkbox.checked,true);
  item.input.value='FBHE Blower #B V-Belt 교체 완료';
  assert.equal(env.api.readEditor(item.editor,item.input.value,original).annotation.confirmed,false);
  assert.deepEqual(original.vBeltReplacement,annotation);
});

test('team import transports explicit false and original source identity',()=>{
  const env=environment();
  Object.assign(env.context,{normalizeMemberLogRole:value=>value,resolveLogEntryId:entry=>entry.id});
  vm.runInContext(between('function createMemberImportedEntry(','function getMemberLogEntriesForImport('),env.context);
  const imported=env.context.createMemberImportedEntry({id:'member-log',author:'작성자'},'BCO1', {id:'entry-1',content,category:'TM 작업',vBeltReplacement:{...annotation,confirmed:false},importedFromLogId:'original-log',importedFromEntryIndex:2},0);
  assert.equal(imported.vBeltReplacement.confirmed,false);
  assert.equal(imported.importedFromLogId,'original-log');assert.equal(imported.importedFromEntryIndex,2);
});

test('editor re-open normalizer preserves confirmation and explicit uncheck',()=>{
  const env=environment();
  Object.assign(env.context,{normalizeExistingLogEntryTime:entry=>entry,normalizedRole:'BCO1',normalizeMemberLogRole:value=>value,log:{}});
  vm.runInContext(between('  const normalizeEditorEntry = (','  /*\n    1단계에서 추가한 정리 함수를 사용하여')+'\nglobalThis.normalizeForTest=normalizeEditorEntry;',env.context);
  assert.deepEqual(plain(env.context.normalizeForTest({content,vBeltReplacement:annotation},'인계사항').vBeltReplacement),annotation);
  assert.equal(env.context.normalizeForTest({content,vBeltReplacement:{...annotation,confirmed:false}},'인계사항').vBeltReplacement.confirmed,false);
});

test('actual section create/save uses manual state and explicit false overwrites previous true',()=>{
  const env=environment();
  installSectionComposer(env);
  const item=fakeEditor(env,content), original={id:'old',content,vBeltReplacement:annotation,importedFromRole:'BCO1',importedFromLogId:'member-log'};
  env.api.mountEditor(item.editor,original);item.checkbox.checked=false;item.checkbox.fire('change');
  const saved=env.context.createNewEntry({type:'handover'},item.editor,original);
  assert.equal(saved.id,'old');assert.equal(saved.vBeltReplacement.confirmed,false);
  assert.equal(original.vBeltReplacement.confirmed,true);
  assert.equal(saved.importedFromLogId,'member-log');
});

test('timed section extracts the work clock while preserving body text and TAG', () => {
  const env = environment();
  const messages = [];
  installSectionComposer(env, message => messages.push(message));
  const issue = { type: 'issue' };
  const create = (text, definition = issue, previousEntry = null) => {
    const { editor } = fakeEditor(env, text);
    const query = editor.querySelector;
    editor.querySelector = selector => {
      if (selector === '.section-context-entry-issue-type') return new Control('BM 발행');
      if (selector === '.section-context-entry-tag') return new Control('204hhl60ap611');
      return query(selector);
    };
    return env.context.createNewEntry(definition, editor, previousEntry);
  };

  for (const [text, time, body] of [
    ['0857 204HHL60AP611 점검', '08:57', '204HHL60AP611 점검'],
    ['08:57 [참고] 점검', '08:57', '[참고] 점검'],
    ['08:57 [104HHL60AP611] 점검', '08:57', '[104HHL60AP611] 점검'],
    ['857, 09:15~10:00 점검', '08:57, 09:15~10:00', '점검'],
    ['2026-11-06 점검', '', '2026-11-06 점검'],
    ['08:700 점검', '', '08:700 점검'],
    ['08:590 점검', '', '08:590 점검'],
    ['081500 점검', '', '081500 점검'],
    ['0815HHL 점검', '', '0815HHL 점검'],
    ['0857 9999 점검', '08:57', '9999 점검']
  ]) {
    const entry = create(text);
    assert.equal(entry.time, time, text);
    assert.equal(entry.content, body, text);
    assert.equal(entry.category, 'BM 발행', text);
    assert.equal(entry.tag, '204HHL60AP611', text);
  }
  assert.equal(create('수시 설비 점검', issue, { time: '수시' }).time, '수시');
  assert.equal(create('08:00~09:00 설비 점검', issue, { time: '08:00~09:00' }).content, '설비 점검');
  assert.equal(create('0857 설비 점검', { type: 'remark' }).content, '0857 설비 점검');
  assert.equal(create('08:57'), null);
  assert.equal(create('0857'), null);
  assert.equal(messages.length, 2);
});

test('time-only edits retain the existing V-Belt confirmation and its own completion clock', async () => {
  const env = environment();
  installSectionComposer(env);
  const original = {
    id: 'timed-replacement',
    time: '08:00',
    content,
    vBeltReplacement: { ...annotation, targets: [{ ...annotation.targets[0], completedTime: '06:25' }] }
  };
  const item = fakeEditor(env, '08:00 ' + content);
  env.api.mountEditor(item.editor, original, undefined, value => env.context.splitContextEntryText(value, original.time).content);
  await flush();
  assert.equal(item.checkbox.checked, true);

  item.input.value = '0935 ' + content;
  item.input.fire('input');
  const saved = env.context.createNewEntry({ type: 'handover' }, item.editor, original);
  assert.equal(saved.time, '09:35');
  assert.equal(saved.content, content);
  assert.deepEqual(plain(saved.vBeltReplacement), original.vBeltReplacement);

  item.input.value = '09:35 ' + content + ' 후 재기동';
  item.input.fire('input');
  assert.equal(item.checkbox.checked, false);
  assert.equal(env.context.createNewEntry({ type: 'handover' }, item.editor, original).vBeltReplacement.confirmed, false);
});

test('collect/save JSON preserves one annotation consistently in both entry collections',async()=>{
  const env=environment();
  const entry={id:'entry-confirmed',content,category:'TM 작업',vBeltReplacement:annotation,importedFromLogId:'member-log',importedFromEntryIndex:3};
  const uncheckedEntry={id:'entry-unchecked',content:content+' 후 기동',category:'TM 발행',vBeltReplacement:{version:1,confirmed:false,content:content+' 후 기동',targets:[]}};
  Object.assign(env.context,{
    appState:{editorEntries:[entry,uncheckedEntry],logs:[],currentOperationStatus:{}},
    elements:{logDate:{value:'2026-11-03'},logShift:{value:'DS'},logRole:{value:'BCO1'},logAuthor:{value:'작성자'},logEditorForm:{dataset:{editingId:'log-1'}}},
    normalizeMemberLogRole:value=>value,normalizeTeamName:value=>value,resolveLogEntryId:entry=>entry.id,
    isIssueEntryCategory:value=>value==='TM 발행',getOperationStatusItems:()=>[],normalizeOperationStatusItem:value=>value,createId:()=> 'log-1',
    getInspectionScheduleOccurrencesForShiftLog:()=>null,refreshInspectionScheduleAfterShiftLogChange:()=>{},normalizeSharedShiftLog:value=>value
  });
  vm.runInContext(between('function collectEditorData(\n','function saveCurrentLog(\n'),env.context);
  const result=env.context.collectEditorData('작성중');
  assert.deepEqual(plain(result.entries[0].vBeltReplacement),annotation);
  assert.deepEqual(plain(result.handoverEntries[0].vBeltReplacement),annotation);
  assert.equal(result.entries[1].vBeltReplacement.confirmed,false);assert.equal(result.tmEntries[0].vBeltReplacement.confirmed,false);
  let request;
  env.context.requestShiftLogApi=async(url,options)=>{request=JSON.parse(JSON.stringify(options.body));return {log:request.log};};
  vm.runInContext(between('async function saveShiftLogToServer(','async function deleteShiftLogFromServer('),env.context);
  await env.context.saveShiftLogToServer(result,{expectedRevision:4});
  assert.deepEqual(request.log.entries[0].vBeltReplacement,annotation);
  assert.equal(request.log.tmEntries[0].vBeltReplacement.confirmed,false);
  assert.equal(request.expectedRevision,4);
});

test('old fixed editor fallback never invents confirmation and invalidates changed old true',()=>{
  const env=environment();
  assert.equal(env.api.legacyInputAnnotation({},content).confirmed,false);
  assert.equal(env.api.legacyInputAnnotation({content,vBeltReplacement:annotation},content).confirmed,true);
  assert.equal(env.api.legacyInputAnnotation({content,vBeltReplacement:annotation},'V-Belt Tension 조정 완료').confirmed,false);
  assert.equal(env.api.readEditor({},content).annotation.confirmed,false);
});

test('existing section numbering cleanup does not invalidate a fresh manual confirmation',async()=>{
  const env=environment(), item=fakeEditor(env,'1. '+content);
  env.api.mountEditor(item.editor);item.checkbox.checked=true;item.checkbox.fire('change');await flush();
  item.rows()[0].querySelector('[data-vbelt-tag]').value='104HHL60AP611';
  const result=env.api.readEditor(item.editor,content);
  assert.equal(result.ok,true);assert.equal(result.annotation.confirmed,true);assert.equal(result.annotation.content,content);
});

test('validated mechanical leading-time normalization preserves confirmation without borrowing completion time',async()=>{
  const env=environment();
  Object.assign(env.context,{
    extractLegacyTagFromContent:content=>({tag:'',content}),
    normalizedRole:'BCO1',normalizeMemberLogRole:value=>value,log:{}
  });
  vm.runInContext(between('function normalizeExistingLogEntryTime(','function normalizeExistingLogEntries('),env.context);
  vm.runInContext(between('function normalizeContentTimeToken(','function extractTimesFromLogEntryContent('),env.context);
  vm.runInContext(between('  const normalizeEditorEntry = (','  /*\n    1단계에서 추가한 정리 함수를 사용하여')+'\nglobalThis.normalizeForTest=normalizeEditorEntry;',env.context);
  const item=fakeEditor(env,'1. 10:00 '+content);
  env.api.mountEditor(item.editor);item.checkbox.checked=true;item.checkbox.fire('change');await flush();
  item.rows()[0].querySelector('[data-vbelt-tag]').value='104HHL60AP611';
  // Existing section editor strips only the item number at creation.
  const storedContent='10:00 '+content;
  const result=env.api.readEditor(item.editor,storedContent);
  const saved={content:storedContent,time:'',category:'인계사항',vBeltReplacement:plain(result.annotation)};
  const reopened=env.context.normalizeForTest(saved,'인계사항');
  assert.equal(reopened.content,content);assert.equal(reopened.time,'10:00');
  assert.equal(reopened.vBeltReplacement.confirmed,true);
  assert.equal(reopened.vBeltReplacement.content,content);
  assert.equal(reopened.vBeltReplacement.targets[0].completedTime,'');
  const stale=env.context.normalizeForTest({...saved,content:'10:00 FBHE Blower #B V-Belt 교체 완료'},'인계사항');
  assert.equal(stale.vBeltReplacement.confirmed,false);
  const uncheckedSaved={...saved,vBeltReplacement:{...saved.vBeltReplacement,confirmed:false,targets:[]}};
  assert.equal(env.context.normalizeForTest(uncheckedSaved,'인계사항').vBeltReplacement.confirmed,false);
});

test('leader role quick-add has the same explicit manual confirmation transport',async()=>{
  const env=environment();
  const item=fakeEditor(env,content), originalSelector=item.editor.querySelector;
  item.editor.dataset={leaderRole:'BCO1'};
  item.editor.querySelector=selector=>selector==='.leader-role-quick-add-content' ? item.input : selector==='.leader-role-quick-add-time'?{value:'10:00'}:originalSelector(selector);
  Object.assign(env.context,{appState:{editorEntries:[]},normalizeLeaderQuickAddRole:value=>value,LEADER_ROLE_QUICK_ADD_ROLES:['BCO1'],LEADER_ROLE_MANUAL_SOURCE:'leader-role-manual',createId:()=> 'quick-new',showToast:()=>{}});
  vm.runInContext(between('  function saveLeaderRoleQuickAdd(','  /* =====================================================\n    버튼 클릭'),env.context);
  env.api.mountEditor(item.editor,null,'.leader-role-quick-add-content');
  item.checkbox.checked=true;item.checkbox.fire('change');await flush();
  env.context.saveLeaderRoleQuickAdd(item.editor);
  assert.equal(env.context.appState.editorEntries.length,0);
  item.rows()[0].querySelector('[data-vbelt-tag]').value='104HHL60AP611';
  env.context.saveLeaderRoleQuickAdd(item.editor);
  const saved=env.context.appState.editorEntries[0];
  assert.equal(saved.vBeltReplacement.confirmed,true);assert.equal(saved.importedFromRole,'BCO1');
  assert.equal(saved.importedFromLogId,'');assert.equal(saved.source,'leader-role-manual');
  assert.equal(saved.time,'10:00');assert.equal(saved.vBeltReplacement.targets[0].completedTime,'');
});

test('actual display collector and row badge retain leading-time confirmation without changing completion time',()=>{
  const env=environment();
  Object.assign(env.context,{
    extractLegacyTagFromContent:content=>({tag:'',content}),normalizeMemberLogRole:value=>value,
    getMemberLogEntriesForImport:log=>log.entries,normalizeMemberImportContent:value=>value,
    isIssueEntryCategory:category=>String(category).includes('발행'),normalizeLogEntryCategory:value=>value,
    escapeHtml:value=>String(value),createTagHtml:()=>'',createLogEntryCategoryBadgeHtml:()=>''
  });
  vm.runInContext(between('function normalizeExistingLogEntryTime(','function normalizeExistingLogEntries('),env.context);
  vm.runInContext(between('function normalizeContentTimeToken(','function extractTimesFromLogEntryContent('),env.context);
  vm.runInContext(between('function collectLogEntriesForDisplay(','function createLogRowHtml('),env.context);
  vm.runInContext(between('const createCompactLineHtml = (','function setLogEntryEditMode(')+'\nglobalThis.compactForTest=createCompactLineHtml;',env.context);
  const sourceContent='10:00 '+content;
  const raw={id:'with-clock',content:sourceContent,category:'TM 작업',vBeltReplacement:{...annotation,content:sourceContent}};
  const [display]=env.context.collectLogEntriesForDisplay({id:'log-1',role:'BCO1',entries:[raw]});
  assert.equal(display.time,'10:00');assert.equal(display.content,content);
  assert.equal(display.vBeltReplacement.confirmed,true);assert.equal(display.vBeltReplacement.content,content);
  assert.equal(display.vBeltReplacement.targets[0].completedTime,'');
  assert.match(env.context.compactForTest(display,0,1),/V-belt 교체 확인/);
  assert.equal(raw.content,sourceContent);assert.equal(raw.vBeltReplacement.content,sourceContent);
  const [uncheckedDisplay]=env.context.collectLogEntriesForDisplay({id:'log-1',role:'BCO1',entries:[{...raw,vBeltReplacement:{...raw.vBeltReplacement,confirmed:false,targets:[]}}]});
  assert.equal(uncheckedDisplay.vBeltReplacement.confirmed,false);
  assert.doesNotMatch(env.context.compactForTest(uncheckedDisplay,0,1),/V-belt 교체 확인/);
  const [staleDisplay]=env.context.collectLogEntriesForDisplay({id:'log-1',role:'BCO1',entries:[{...raw,content:'10:00 FBHE Blower #B V-Belt 교체 완료'}]});
  assert.equal(staleDisplay.vBeltReplacement.confirmed,false);
});

test('leader saved snapshot retains only valid confirmation through its real display normalization',()=>{
  const env=environment();
  Object.assign(env.context,{
    extractLegacyTagFromContent:content=>({tag:'',content}),normalizeRole:value=>value,
    normalizeCategory:(value,fallback)=>value||fallback,isIssueCategory:value=>String(value).includes('발행'),
    ISSUE_ONLY_ROLES:['TO','BO1','BO2']
  });
  vm.runInContext(between('function normalizeExistingLogEntryTime(','function normalizeExistingLogEntries('),env.context);
  vm.runInContext(between('function normalizeContentTimeToken(','function extractTimesFromLogEntryContent('),env.context);
  vm.runInContext(between('  function collectSavedLeaderEntries(log) {','  const collectEditorDataBeforeLeaderSnapshot ='),env.context);
  const sourceContent='10:00 '+content;
  const raw={id:'source-1',content:sourceContent,category:'TM 작업',importedFromRole:'BCO1',importedFromLogId:'member-log',vBeltReplacement:{...annotation,content:sourceContent}};
  const snapshot=entry=>env.context.collectSavedLeaderEntries({role:'파트장',leaderEntrySnapshotVersion:1,handoverEntries:[entry],entries:[entry]});
  const [display]=snapshot(raw);
  assert.equal(snapshot(raw).length,1);
  assert.equal(display.content,content);assert.equal(display.time,'10:00');
  assert.equal(display.vBeltReplacement.confirmed,true);
  assert.equal(display.vBeltReplacement.targets[0].completedTime,'');
  assert.match(env.api.badgeHtml(display),/V-belt 교체 확인/);
  assert.equal(snapshot({...raw,vBeltReplacement:{...raw.vBeltReplacement,confirmed:false,targets:[]}})[0].vBeltReplacement.confirmed,false);
  assert.equal(snapshot({...raw,content:'10:00 FBHE Blower #B V-Belt 교체 완료'})[0].vBeltReplacement.confirmed,false);
  assert.equal(raw.content,sourceContent);assert.equal(raw.vBeltReplacement.content,sourceContent);
});
