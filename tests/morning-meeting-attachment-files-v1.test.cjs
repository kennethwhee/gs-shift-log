'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
function sourceBetween(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `Source is available: ${startText}`);
  return source.slice(start, end);
}
function uploadSource() {
  const start = source.indexOf('(function initializeEfficiencyMorningMeetingCoalLogUpload()');
  const end = source.indexOf('\n})();', start);
  assert.ok(start >= 0 && end > start, 'Coal upload module is available');
  return source.slice(start, end + '\n})();'.length);
}
class FakeNode {
  constructor(id) {
    this.id = id; this.dataset = {}; this.listeners = new Map(); this.attributes = new Map();
    this.textContent = ''; this.hidden = false; this.disabled = false; this.files = [];
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    };
    let value = '';
    Object.defineProperty(this, 'value', {
      get: () => value,
      set: next => { value = next; if (next === '') this.files = []; }
    });
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener); this.listeners.set(type, listeners);
  }
  emit(type, values = {}) {
    const event = {type, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; }, ...values};
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    return event;
  }
  dispatchEvent(event) { return this.emit(event.type, event); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
}
function file(name, size = 100, lastModified = 1) { return {name, size, lastModified}; }
function emptySelection() {
  return {analyzed: false, items: [], selectedIds: new Set(), selectedItems: [], selectedText: '',
    values: {coalSiloA: null, coalSiloB: null, coalInventoryTotal: null, coalReceipt: null,
      bioInventory: null, bioReceipt: null, flyAshDispatch: null}};
}
function setup({dataTransferFails = false, initialState} = {}) {
  const ids = ['efficiencyMorningMeetingCoalLogCard', 'efficiencyMorningMeetingCoalLogFile',
    'efficiencyMorningMeetingCoalLogStatus', 'efficiencyMorningMeetingCoalLogAction',
    'resetEfficiencyMorningMeetingButton', 'efficiencyMorningMeetingError'];
  const nodes = Object.fromEntries(ids.map(id => [id, new FakeNode(id)]));
  const document = new FakeNode('document'); document.readyState = 'complete';
  document.getElementById = id => nodes[id] || null;
  const events = [], errors = [], timers = [];
  document.addEventListener('efficiencyMorningMeetingCoalFilesChanged', event => events.push(event.detail));
  const calls = {selectionReset: 0, summary: 0, createButton: 0, renderValues: [], renderSelection: 0};
  class DataTransfer {
    constructor() {
      if (dataTransferFails) throw new Error('FileList assignment unsupported');
      this.files = []; this.items = {add: value => this.files.push(value)};
    }
  }
  const window = {
    efficiencyMorningMeetingUploadState: initialState,
    updateEfficiencyMorningMeetingUploadSummary() { calls.summary++; },
    updateEfficiencyMorningMeetingCreateButton() { calls.createButton++; },
    resetEfficiencyMorningMeetingCoalSelection() {
      calls.selectionReset++;
      window.efficiencyMorningMeetingUploadState.coalSelection = emptySelection();
    },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {}
  };
  const context = vm.createContext({window, document, DataTransfer, Set, Map, console: {log() {}, warn() {}, error() {}},
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }});
  vm.runInContext(uploadSource(), context);
  const input = nodes.efficiencyMorningMeetingCoalLogFile;
  return {
    context, window, document, nodes, events, errors, calls, timers, input,
    get state() { return window.efficiencyMorningMeetingUploadState; },
    files() { return Array.from(window.getEfficiencyMorningMeetingCoalLogFiles()); },
    removed() { return window.getEfficiencyMorningMeetingRemovedCoalLogCount(); },
    remove(value) { return window.removeEfficiencyMorningMeetingCoalLogFile(value); },
    undo() { return window.undoEfficiencyMorningMeetingCoalLogFiles(); },
    pick(files) { input.files = files; input.emit('change'); },
    drop(files) { return nodes.efficiencyMorningMeetingCoalLogCard.emit('drop', {dataTransfer: {files}}); },
    reset() { nodes.resetEfficiencyMorningMeetingButton.emit('click'); }
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return {promise, resolve, reject};
}
function analysisResult(sourceFile, index, workDate = '2026-11-01', value = 10) {
  return {file: sourceFile, fileIndex: index, fileName: sourceFile.name, sheetName: '운탄일지', workDate,
    items: [{id: `work-${index}`, content: sourceFile.name}], values: {coalInventoryTotal: value}};
}
function installAnalyzer(fixture, analyzeSingle) {
  const valueStatus = new FakeNode('valueStatus');
  Object.assign(fixture.context, {
    getState: () => fixture.state,
    getElements: () => ({valueStatus}),
    hideError: () => {}, showError: message => fixture.errors.push(message),
    XLSX: {}, createEmptySelection: emptySelection,
    analyzeSingleCoalLogFile: analyzeSingle,
    renderValues: values => fixture.calls.renderValues.push(values),
    renderSelection: () => fixture.calls.renderSelection++,
    resetSelection: fixture.window.resetEfficiencyMorningMeetingCoalSelection
  });
  vm.runInContext(sourceBetween('async function analyzeCoalLogFile()', '  function handleChange('), fixture.context);
  return {run: () => fixture.context.analyzeCoalLogFile(), valueStatus};
}
function installTmAnalyzer(fixture, extractItems) {
  const calls = {render: 0, reads: []};
  Object.assign(fixture.context, {
    getState: () => fixture.state,
    getSelection: () => fixture.state.coalSelection,
    hideError: () => {}, showError: message => fixture.errors.push(message),
    renderAll: () => calls.render++,
    extractCoalTmItems: sourceFile => { calls.reads.push(sourceFile); return extractItems(sourceFile); }
  });
  vm.runInContext(sourceBetween('  function waitForCoalAnalysis(', '  function scheduleRender()'), fixture.context);
  return {
    calls,
    run: () => fixture.context.refreshAfterAnalysis(
      Number(fixture.state.coalFilesRevision || 0), Number(fixture.state.coalAnalysisRunId || 0))
  };
}
function installFolderLoader(fixture, latestFile) {
  const coalConfig = {key: 'coal', label: '운탄일지', inputId: 'efficiencyMorningMeetingCoalLogFile'};
  const reads = [], readStarted = deferred();
  Object.assign(fixture.context, {
    loading: false, FILE_TYPES: [coalConfig], handles: new Map([['coal', {}]]), permissions: new Map(),
    hideError: () => {}, showError: message => fixture.errors.push(message), render: () => {},
    requestPermission: async () => true, queryPermission: async () => 'granted',
    latestXlsx: handle => { reads.push(handle); readStarted.resolve(); return latestFile(); },
    hasAttachedMorningMeetingFile: () => Boolean(fixture.state.templateFile || fixture.files().length),
    Event: class Event { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } }
  });
  vm.runInContext(sourceBetween('function prepareState(', 'async function handleAnalysisClickCapture('), fixture.context);
  return {reads, readStarted: readStarted.promise, run: () => fixture.context.loadFoldersBeforeAnalysis()};
}

test('excluding the last file clears every active source and invalidates previous analysis', () => {
  const fixture = setup(), onlyFile = file('운탄일지.xlsx');
  fixture.pick([onlyFile]);
  fixture.state.coalSelection = {analyzed: true, selectedItems: [{content: 'old'}], selectedTmItems: [{content: 'old TM'}], values: {coalInventoryTotal: 12}};
  fixture.state.coalAnalysisResults = [{file: onlyFile}];
  const revision = fixture.state.coalFilesRevision, runId = fixture.state.coalAnalysisRunId;
  assert.equal(fixture.remove(onlyFile), true);
  assert.deepEqual(fixture.files(), []);
  assert.equal(fixture.state.coalLogFile, null);
  assert.equal(fixture.input.files.length, 0);
  assert.equal(fixture.removed(), 1);
  assert.equal(fixture.state.coalSelection.analyzed, false);
  assert.deepEqual(Array.from(fixture.state.coalAnalysisResults), []);
  assert.deepEqual(Array.from(fixture.state.coalSelection.selectedItems), []);
  assert.equal(fixture.state.coalSelection.values.coalInventoryTotal, null);
  assert.ok(fixture.state.coalFilesRevision > revision);
  assert.ok(fixture.state.coalAnalysisRunId > runId);
  assert.equal(fixture.events.at(-1).count, 0);
  assert.equal(fixture.undo(), true);
  assert.deepEqual(fixture.files(), [onlyFile]);
  assert.equal(fixture.state.coalLogFile, onlyFile);
  assert.equal(fixture.removed(), 0);
  assert.equal(fixture.state.coalSelection.analyzed, false);
});

test('undo restores all removed files in original order and the legacy last-file alias', () => {
  const fixture = setup(), files = ['a', 'b', 'c', 'd'].map(name => file(`${name}.xlsx`));
  fixture.pick(files);
  assert.equal(fixture.remove(files[1]), true);
  assert.equal(fixture.remove(files[3]), true);
  assert.deepEqual(fixture.files(), [files[0], files[2]]);
  assert.equal(fixture.removed(), 2);
  assert.equal(fixture.undo(), true);
  assert.deepEqual(fixture.files(), files);
  assert.equal(fixture.state.coalLogFile, files[3]);
  assert.equal(fixture.removed(), 0);
  assert.equal(fixture.undo(), false);
});

test('same filename with different metadata remains distinct and stale file objects cannot remove an active file', () => {
  const fixture = setup();
  const first = file('동일이름.xlsx', 100, 1), second = file('동일이름.xlsx', 200, 2);
  fixture.pick([first, second]);
  assert.equal(fixture.remove({...first}), false);
  assert.deepEqual(fixture.files(), [first, second]);
  assert.equal(fixture.remove(first), true);
  assert.deepEqual(fixture.files(), [second]);
  const revision = fixture.state.coalFilesRevision;
  assert.equal(fixture.remove(first), false);
  assert.equal(fixture.remove(null), false);
  assert.equal(fixture.remove({}), false);
  assert.equal(fixture.state.coalFilesRevision, revision);
  assert.equal(fixture.removed(), 1);
});

test('replacing an identical file key cannot let an old rendered remove handle delete its replacement', () => {
  const fixture = setup(), first = file('same.xlsx'), replacement = file('same.xlsx');
  fixture.pick([first]); fixture.pick([replacement]);
  assert.deepEqual(fixture.files(), [replacement]);
  assert.equal(fixture.remove(first), false);
  assert.deepEqual(fixture.files(), [replacement]);
  assert.equal(fixture.remove(replacement), true);
});

test('mixed invalid upload and invalid or empty drop never change the analysis source set', () => {
  const fixture = setup(), first = file('valid.xlsx'), extra = file('extra.xlsx');
  fixture.pick([first]);
  const revision = fixture.state.coalFilesRevision;
  fixture.pick([extra, file('bad.csv')]);
  assert.deepEqual(fixture.files(), [first]);
  assert.equal(fixture.state.coalFilesRevision, revision);
  assert.equal(fixture.nodes.efficiencyMorningMeetingError.hidden, false);
  fixture.drop([file('bad.xls')]); fixture.drop([]);
  assert.deepEqual(fixture.files(), [first]);
  assert.equal(fixture.state.coalFilesRevision, revision);
  assert.equal(fixture.state.coalLogFile, first);
  const event = fixture.drop([extra]);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(fixture.files(), [first, extra]);
});

test('whole-form reset discards active and removed files and makes undo inert', () => {
  const fixture = setup(), first = file('first.xlsx'), second = file('second.xlsx');
  fixture.pick([first, second]); fixture.remove(first); fixture.reset();
  assert.deepEqual(fixture.files(), []);
  assert.equal(fixture.state.coalLogFile, null);
  assert.equal(fixture.input.files.length, 0);
  assert.equal(fixture.removed(), 0);
  assert.equal(fixture.undo(), false);
  assert.equal(fixture.state.coalSelection.analyzed, false);
  assert.equal(fixture.events.at(-1).count, 0);
});

test('DataTransfer failure still leaves removal and undo authoritative in application state', () => {
  const fixture = setup({dataTransferFails: true}), first = file('first.xlsx'), second = file('second.xlsx');
  fixture.pick([first, second]);
  assert.equal(fixture.remove(second), true);
  assert.deepEqual(fixture.files(), [first]);
  assert.equal(fixture.state.coalLogFile, first);
  assert.equal(fixture.remove(first), true);
  assert.deepEqual(fixture.files(), []);
  assert.equal(fixture.state.coalLogFile, null);
  assert.equal(fixture.undo(), true);
  assert.deepEqual(fixture.files(), [first, second]);
  assert.equal(fixture.state.coalLogFile, second);
  assert.equal(fixture.input.files.length, 0);
});

test('explicitly reattaching an excluded file clears only that matching exclusion and never duplicates it on undo', () => {
  const fixture = setup(), first = file('first.xlsx'), second = file('second.xlsx');
  fixture.pick([first, second]); fixture.remove(first); fixture.remove(second);
  assert.equal(fixture.window.isEfficiencyMorningMeetingCoalLogFileExcluded({...first}), true);
  assert.equal(fixture.window.isEfficiencyMorningMeetingCoalLogFileExcluded(file(first.name, first.size, 2)), false);
  const replacement = {...first};
  fixture.pick([replacement]);
  assert.equal(fixture.removed(), 1);
  assert.equal(fixture.window.isEfficiencyMorningMeetingCoalLogFileExcluded(first), false);
  fixture.undo();
  const active = fixture.files();
  assert.equal(active.length, 2);
  assert.ok(active.includes(replacement)); assert.ok(active.includes(second));
  assert.ok(!active.includes(first));
  assert.equal(fixture.removed(), 0);
});

test('export lock prevents both exclusion and undo without changing pending recovery state', () => {
  const fixture = setup(), first = file('first.xlsx'), second = file('second.xlsx');
  fixture.pick([first, second]); fixture.remove(first);
  const revision = fixture.state.coalFilesRevision;
  fixture.state.coalAttachmentExporting = true;
  assert.equal(fixture.remove(second), false); assert.equal(fixture.undo(), false);
  assert.deepEqual(fixture.files(), [second]); assert.equal(fixture.removed(), 1);
  assert.equal(fixture.state.coalFilesRevision, revision);
  fixture.state.coalAttachmentExporting = false;
  assert.equal(fixture.undo(), true);
  assert.deepEqual(fixture.files(), [first, second]);
});

test('the public file getter returns a copy instead of permitting untracked source mutations', () => {
  const fixture = setup(), first = file('first.xlsx');
  fixture.pick([first]);
  const exposed = fixture.window.getEfficiencyMorningMeetingCoalLogFiles();
  exposed.pop(); exposed.push(file('untracked.xlsx'));
  assert.deepEqual(fixture.files(), [first]);
});

test('analysis uses only active files for work items, source metadata and latest-day values', async () => {
  const fixture = setup(), files = ['one', 'two', 'three'].map(name => file(`${name}.xlsx`));
  fixture.pick(files); fixture.remove(files[1]);
  const seen = [];
  const analyzer = installAnalyzer(fixture, async (sourceFile, index) => {
    seen.push(sourceFile);
    return analysisResult(sourceFile, index, sourceFile === files[0] ? '2026-11-01' : '2026-11-03', index + 21);
  });
  await analyzer.run();
  assert.deepEqual(seen, [files[0], files[2]]);
  assert.deepEqual(Array.from(fixture.state.coalSelection.fileNames), ['one.xlsx', 'three.xlsx']);
  assert.deepEqual(Array.from(fixture.state.coalSelection.items, item => item.content), ['one.xlsx', 'three.xlsx']);
  assert.equal(fixture.state.coalSelection.numericWorkDate, '2026-11-03');
  assert.equal(fixture.state.coalSelection.values.coalInventoryTotal, 22);
});

test('zero active files analyzes as missing and never resurrects the removed last-file alias', async () => {
  const fixture = setup(), first = file('first.xlsx'); fixture.pick([first]); fixture.remove(first);
  let readCount = 0;
  const analyzer = installAnalyzer(fixture, async () => { readCount++; throw new Error('Must not read excluded source'); });
  await analyzer.run();
  assert.equal(readCount, 0);
  assert.equal(fixture.state.coalSelection.analyzed, true);
  assert.equal(fixture.state.coalSelection.missing, true);
  assert.deepEqual(Array.from(fixture.state.coalAnalysisResults), []);
});

for (const rejectRead of [false, true]) {
  test(`an in-flight ${rejectRead ? 'failed' : 'successful'} read cannot restore excluded sources or clear replacement state`, async () => {
    const fixture = setup(), first = file('first.xlsx'), pending = deferred();
    fixture.pick([first]);
    const analyzer = installAnalyzer(fixture, () => pending.promise);
    const run = analyzer.run();
    fixture.remove(first);
    const selectionAfterRemoval = fixture.state.coalSelection;
    if (rejectRead) pending.reject(new Error('late file error'));
    else pending.resolve(analysisResult(first, 0));
    await run;
    assert.equal(fixture.state.coalSelection, selectionAfterRemoval);
    assert.equal(fixture.state.coalSelection.analyzed, false);
    assert.deepEqual(Array.from(fixture.state.coalAnalysisResults), []);
    assert.deepEqual(fixture.errors, []);
  });
}

test('a newer analysis of the same sources wins even when the older read finishes last', async () => {
  const fixture = setup(), first = file('first.xlsx'), olderRead = deferred(), newerRead = deferred();
  fixture.pick([first]); let readCount = 0;
  const analyzer = installAnalyzer(fixture, () => ++readCount === 1 ? olderRead.promise : newerRead.promise);
  const olderRun = analyzer.run(), newerRun = analyzer.run();
  newerRead.resolve(analysisResult(first, 0, '2026-11-03', 30)); await newerRun;
  const newestSelection = fixture.state.coalSelection;
  olderRead.resolve(analysisResult(first, 0, '2026-11-01', 10)); await olderRun;
  assert.equal(fixture.state.coalSelection, newestSelection);
  assert.equal(fixture.state.coalSelection.values.coalInventoryTotal, 30);
  assert.equal(fixture.calls.renderValues.length, 1);
});

test('replacing the whole form state makes an earlier analysis inert even when counters match', async () => {
  const fixture = setup(), first = file('first.xlsx'), pending = deferred(); fixture.pick([first]);
  const analyzer = installAnalyzer(fixture, () => pending.promise);
  const run = analyzer.run(), previousState = fixture.state;
  const replacement = {...previousState, coalSelection: emptySelection(), coalAnalysisResults: []};
  fixture.window.efficiencyMorningMeetingUploadState = replacement;
  pending.resolve(analysisResult(first, 0)); await run;
  assert.equal(fixture.state, replacement);
  assert.equal(fixture.state.coalSelection.analyzed, false);
  assert.equal(previousState.coalSelection.analyzed, false);
  assert.equal(fixture.calls.renderValues.length, 0);
});

for (const rejectRead of [false, true]) {
  test(`an in-flight TM ${rejectRead ? 'failure' : 'result'} cannot restore excluded work or replace a new selection`, async () => {
    const fixture = setup(), first = file('first.xlsx'), pending = deferred();
    fixture.pick([first]);
    fixture.state.coalSelection.analyzed = true;
    fixture.state.coalAnalysisResults = [analysisResult(first, 0)];
    const tm = installTmAnalyzer(fixture, () => pending.promise);
    const run = tm.run();
    await Promise.resolve();
    assert.deepEqual(tm.calls.reads, [first]);
    fixture.remove(first);
    const selectionAfterRemoval = fixture.state.coalSelection;
    if (rejectRead) pending.reject(new Error('late TM error'));
    else pending.resolve([{number: 1, content: 'excluded TM'}]);
    await run;
    assert.equal(fixture.state.coalSelection, selectionAfterRemoval);
    assert.equal(fixture.state.coalSelection.analyzed, false);
    assert.deepEqual(fixture.errors, []);
    assert.equal(tm.calls.render, 0);
  });
}

test('TM polling cancels an obsolete analysis instead of attaching itself to a later completed selection', async () => {
  const fixture = setup(), first = file('first.xlsx'); fixture.pick([first]);
  const tm = installTmAnalyzer(fixture, async () => [{content: 'should not be read'}]);
  const run = tm.run();
  assert.equal(fixture.timers.length, 1);
  fixture.remove(first);
  fixture.state.coalSelection.analyzed = true;
  fixture.timers.shift()();
  await run;
  assert.deepEqual(tm.calls.reads, []);
  assert.deepEqual(fixture.errors, []);
  assert.equal(tm.calls.render, 0);
});

test('TM extraction also stops when a newer analysis starts with unchanged source files', async () => {
  const fixture = setup(), first = file('first.xlsx'), pending = deferred(); fixture.pick([first]);
  fixture.state.coalSelection.analyzed = true;
  fixture.state.coalAnalysisResults = [analysisResult(first, 0)];
  const tm = installTmAnalyzer(fixture, () => pending.promise), run = tm.run();
  await Promise.resolve();
  fixture.state.coalAnalysisRunId++;
  const newerSelection = {...emptySelection(), analyzed: true, coalTmItems: [{content: 'new TM'}]};
  fixture.state.coalSelection = newerSelection;
  pending.resolve([{content: 'old TM'}]); await run;
  assert.equal(fixture.state.coalSelection, newerSelection);
  assert.deepEqual(fixture.state.coalSelection.coalTmItems, [{content: 'new TM'}]);
  assert.equal(tm.calls.render, 0);
});

test('TM results do not mutate a replaced selection object even if its source counters are unchanged', async () => {
  const fixture = setup(), first = file('first.xlsx'), pending = deferred(); fixture.pick([first]);
  fixture.state.coalSelection.analyzed = true;
  fixture.state.coalAnalysisResults = [analysisResult(first, 0)];
  const oldSelection = fixture.state.coalSelection;
  const tm = installTmAnalyzer(fixture, () => pending.promise), run = tm.run();
  await Promise.resolve();
  const replacement = {...emptySelection(), coalTmItems: [{content: 'replacement'}]};
  fixture.state.coalSelection = replacement;
  pending.resolve([{content: 'late source TM'}]); await run;
  assert.equal(fixture.state.coalSelection, replacement);
  assert.equal(oldSelection.coalTmItems, undefined);
  assert.deepEqual(replacement.coalTmItems, [{content: 'replacement'}]);
  assert.equal(tm.calls.render, 0);
});

test('folder reload skips an excluded file even when File System Access returns a different File object', async () => {
  const fixture = setup(), first = file('first.xlsx'); fixture.pick([first]); fixture.remove(first);
  fixture.state.templateFile = file('template.xlsx');
  const folder = installFolderLoader(fixture, async () => ({...first}));
  const result = await folder.run();
  assert.equal(result.loadedCount, 0);
  assert.equal(result.canContinue, true);
  assert.deepEqual(fixture.files(), []);
  assert.equal(fixture.removed(), 1);
  assert.equal(fixture.context.loading, false);
});

test('folder loader still imports a non-excluded file through the real input change path', async () => {
  const fixture = setup(), first = file('first.xlsx');
  const folder = installFolderLoader(fixture, async () => first), result = await folder.run();
  assert.equal(result.loadedCount, 1);
  assert.equal(result.canContinue, true);
  assert.deepEqual(fixture.files(), [first]);
  assert.equal(fixture.state.coalLogFile, first);
  assert.ok(fixture.state.coalFilesRevision > 0);
});

for (const mutation of ['remove', 'undo', 'reset', 'state replacement']) {
  test(`a pending folder read cannot overwrite a later ${mutation}`, async () => {
    const fixture = setup(), first = file('first.xlsx'), folderFile = file('from-folder.xlsx'), pending = deferred();
    fixture.pick([first]);
    if (mutation === 'undo') fixture.remove(first);
    const folder = installFolderLoader(fixture, () => pending.promise), run = folder.run();
    await folder.readStarted;
    assert.equal(folder.reads.length, 1);
    if (mutation === 'remove') fixture.remove(first);
    else if (mutation === 'undo') fixture.undo();
    else if (mutation === 'reset') fixture.reset();
    else fixture.window.efficiencyMorningMeetingUploadState = {...fixture.state};
    const activeAfterMutation = fixture.files(), stateAfterMutation = fixture.state;
    pending.resolve(folderFile);
    const result = await run;
    assert.equal(result.loadedCount, 0); assert.equal(result.canContinue, false);
    assert.equal(fixture.state, stateAfterMutation);
    assert.deepEqual(fixture.files(), activeAfterMutation);
    assert.ok(!fixture.files().includes(folderFile));
    assert.equal(fixture.context.loading, false);
  });
}

test('updates during export keep the create button disabled and a second export cannot start', async () => {
  const fixture = setup(), createButton = new FakeNode('create');
  createButton.textContent = '엑셀 생성 중...'; fixture.state.coalAttachmentExporting = true;
  let unexpectedCalls = 0;
  Object.assign(fixture.context, {
    getMorningMeetingWorkbookState: () => fixture.state,
    getMorningMeetingWorkbookElements: () => ({createButton}),
    hideMorningMeetingWorkbookError: () => unexpectedCalls++,
    synchronizeMorningMeetingPreviewText: () => unexpectedCalls++
  });
  vm.runInContext(sourceBetween('function updateMorningMeetingCreateButton()', 'window.updateEfficiencyMorningMeetingCreateButton ='), fixture.context);
  vm.runInContext(sourceBetween('async function createMorningMeetingWorkbook()', 'function bindMorningMeetingTemplateUpload()'), fixture.context);
  fixture.context.updateMorningMeetingCreateButton();
  assert.equal(createButton.disabled, true);
  await fixture.context.createMorningMeetingWorkbook();
  assert.equal(unexpectedCalls, 0);
  assert.equal(createButton.disabled, true);
  assert.equal(createButton.textContent, '엑셀 생성 중...');
  assert.equal(fixture.state.coalAttachmentExporting, true);
});
