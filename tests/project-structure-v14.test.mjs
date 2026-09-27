import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectWebAssets } from '../scripts/build-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const asset = 'maintenance/shift-log-search-matched-items.js';
const moduleSource = read(asset);
const mainSource = read('script.js');
const invocation = '(0, window.GSShiftLogSearchMatchedItems.install)();';

function createContext({ keyword = '', category = '', formData = true, form = true } = {}) {
  const values = { keyword, category };
  const calls = [];
  const control = selector => ({ value: values[selector.match(/name="(.*?)"/)[1]] ?? '' });
  const fixture = { values, calls, form: form ? { querySelector: control, values } : null };
  const context = vm.createContext({ fixture, console: { warn() {} }, document: { querySelector: control } });
  context.window = context;
  context.FormData = formData
    ? class { constructor(source) { this.values = source.values; } get(name) { return this.values[name] ?? null; } }
    : class { constructor() { throw new Error('FormData unavailable for this form'); } };
  return { context, fixture, values, calls };
}

const base = `
  'use strict';
  const elements = { searchForm: fixture.form };
  function createSearchLogText(log) { fixture.calls.push(['text', log]); return 'original text'; }
  function createSearchLogPreviewHtml(log) { fixture.calls.push(['html', log]); return '<b>original preview</b>'; }
  function createSearchLogPreviewText(log) { fixture.calls.push(['summary', log]); return 'original summary'; }
`;

function harness(options) {
  const state = createContext(options);
  vm.runInContext(moduleSource, state.context);
  vm.runInContext(base + invocation, state.context);
  return { ...state, api: state.context.__shiftLogSearchMatchedItemsV1 };
}

function frozenLog() {
  const entries = [
    { id: 'tm', category: 'TM 발행', time: '07:30', tag: '104HHL60AP611', content: 'Pump 점검 완료', importedFromRole: 'BCO1' },
    { id: 'bm', category: 'BM 발행', time: '08:00', content: '밸브 조치 완료' },
    { id: 'note', category: '비고', content: 'Pump 추가 확인' }
  ];
  entries.forEach(Object.freeze);
  return Object.freeze({ role: '파트장', author: '검색대상아님', entries: Object.freeze(entries), operationStatus: '발전량운전값' });
}

test('search module can load before main globals and installs only at the original call site', () => {
  const { context, fixture } = createContext({ keyword: 'pump' });
  vm.runInContext(moduleSource, context);
  assert.equal(context.__shiftLogSearchMatchedItemsV1Installed, undefined);
  assert.equal(context.createSearchLogText, undefined);
  assert.deepEqual(fixture.calls, []);
  assert.equal(Object.isFrozen(context.GSShiftLogSearchMatchedItems), true);
  vm.runInContext(base, context);
  const original = context.createSearchLogText;
  assert.equal(context.elements, undefined, 'main lexical variables must not be copied onto window');
  vm.runInContext(invocation, context);
  assert.notEqual(context.createSearchLogText, original);
  assert.equal(context.__shiftLogSearchMatchedItemsV1Installed, true);
  assert.match(context.createSearchLogText(frozenLog()), /pump/);
});

test('main installs search wrappers before microtasks queued by main initialization', async () => {
  const { context } = createContext({ keyword: 'pump' });
  vm.runInContext(moduleSource, context);
  vm.runInContext(base + `
    Promise.resolve().then(() => { window.observedSearch = createSearchLogText({ entries: [{ content: 'Pump ready' }] }); });
    ${invocation}
  `, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.observedSearch, 'pump ready');
});

test('module loading alone does not install search if main initialization stops first', () => {
  const { context } = createContext();
  vm.runInContext(moduleSource, context);
  assert.throws(() => vm.runInContext(base + 'throw new Error("main stopped");\n' + invocation, context), /main stopped/);
  assert.equal(context.__shiftLogSearchMatchedItemsV1Installed, undefined);
  assert.equal(context.createSearchLogText({}), 'original text');
});

test('blank keywords retain the original query, HTML and optional text summary functions', () => {
  const { context, calls } = harness({ keyword: '  ', category: 'operation' });
  const log = frozenLog();
  assert.equal(context.createSearchLogText(log), 'original text');
  assert.equal(context.createSearchLogPreviewHtml(log), '<b>original preview</b>');
  assert.equal(context.createSearchLogPreviewText(log), 'original summary');
  assert.deepEqual(calls.map(call => call[0]), ['text', 'html', 'summary']);
  assert.ok(calls.every(call => call[1] === log), 'fallbacks must receive the original log object');
});

test('keyword previews include only matched business entries and preserve the complete original log', () => {
  const { context, api } = harness({ keyword: 'PUMP' });
  const log = frozenLog();
  const before = JSON.stringify(log);
  assert.deepEqual(Array.from(api.getMatchedSearchEntries(log), x => x.id), ['tm', 'note']);
  const html = context.createSearchLogPreviewHtml(log);
  assert.match(html, /search-match-highlight">Pump<\/mark>/);
  assert.match(html, /BCO1 업무일지/);
  assert.match(html, /data-search-tag="104HHL60AP611"/);
  assert.doesNotMatch(html, /밸브 조치 완료|발전량운전값/);
  assert.match(html, /업무일지 전체 내용을 확인/);
  assert.doesNotMatch(context.createSearchLogText(log), /발전량운전값|검색대상아님/);
  assert.equal(JSON.stringify(log), before);
});

test('category filters, no matches and tag matching retain their existing meanings', () => {
  const { context, values, api } = harness({ keyword: 'pump', category: 'TM' });
  const log = frozenLog();
  assert.deepEqual(Array.from(api.getMatchedSearchEntries(log), x => x.id), ['tm']);
  values.category = 'note';
  assert.deepEqual(Array.from(api.getMatchedSearchEntries(log), x => x.id), ['note']);
  values.category = 'operation';
  assert.equal(api.getMatchedSearchEntries(log).length, 0);
  assert.match(context.createSearchLogPreviewHtml(log), /검색어와 일치하는 업무 항목이 없습니다/);
  values.category = '전체'; values.keyword = '104hhl60ap611';
  assert.deepEqual(Array.from(api.getMatchedSearchEntries(log), x => x.id), ['tm']);
  values.keyword = '없는검색어';
  assert.equal(context.createSearchLogPreviewText(log), '검색어와 일치하는 업무 항목이 없습니다.');
});

test('legacy arrays, separate notes and duplicate IDs remain normalized without changing input', () => {
  const { api } = harness({ keyword: 'pump' });
  const log = { entries: [null, { id: 'same', content: 'Pump A' }, { id: 'same', content: 'duplicate' }],
    tmEntries: ['Pump B'], handoverEntries: [{ text: 'Pump C', tag_id: ' tag-1 ' }],
    remarkEntries: [{ content: 'Pump note' }], note: 'Pump note' };
  const before = JSON.stringify(log);
  const found = Array.from(api.getMatchedSearchEntries(log));
  assert.deepEqual(found.map(x => x.content), ['Pump A', 'Pump B', 'Pump C', 'Pump note']);
  assert.equal(found[1].category, 'TM 발행');
  assert.equal(found[2].category, '인계사항');
  assert.equal(found[2].tag, 'TAG-1');
  assert.equal(JSON.stringify(log), before);
});

test('shared display normalization takes priority and failed helpers retain legacy fallback', () => {
  const { context, api } = harness({ keyword: 'pump', category: 'tm' });
  context.collectLogEntriesForDisplay = () => [{ content: 'Pump shared', category: 'TM 발행' }];
  assert.equal(api.getMatchedSearchEntries(frozenLog())[0].content, 'Pump shared');
  context.collectLogEntriesForDisplay = () => { throw new Error('legacy shape'); };
  context.getSearchEntryCategoryValue = () => { throw new Error('legacy category'); };
  assert.deepEqual(Array.from(api.getMatchedSearchEntries(frozenLog()), x => x.id), ['tm']);
});

test('FormData failure and missing form use the established DOM control fallback', () => {
  for (const options of [{ formData: false }, { form: false }]) {
    const { api } = harness({ ...options, keyword: 'pump', category: 'tm' });
    assert.deepEqual(Array.from(api.getMatchedSearchEntries(frozenLog()), x => x.id), ['tm']);
  }
});

test('matched HTML escapes content, role labels and tag attributes while retaining highlights and line breaks', () => {
  const { context } = harness({ keyword: 'pump' });
  const html = context.createSearchLogPreviewHtml({ role: '파트장', entries: [{
    category: 'TM 발행', content: 'Pump <img src=x onerror=1> & "quoted"\n다음 줄',
    tag: 'tag"<&', importedFromRole: '<b>BCO1</b>' }] });
  assert.doesNotMatch(html, /<img|<b>BCO1|data-search-tag="TAG"/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.match(html, /&lt;b&gt;BCO1&lt;\/b&gt;/);
  assert.match(html, /data-search-tag="TAG&quot;&lt;&amp;"/);
  assert.match(html, /&quot;quoted&quot;<br>다음 줄/);
  assert.match(html, /<mark class="search-match-highlight">Pump<\/mark>/);
});

test('repeated installation keeps one wrapper and missing optional functions remain absent', () => {
  const { context } = harness({ keyword: 'pump' });
  const text = context.createSearchLogText, html = context.createSearchLogPreviewHtml;
  vm.runInContext(moduleSource + '\n' + invocation, context);
  assert.equal(context.createSearchLogText, text);
  assert.equal(context.createSearchLogPreviewHtml, html);
  const isolated = createContext().context;
  vm.runInContext(moduleSource + '\n' + invocation, isolated);
  assert.equal(isolated.createSearchLogPreviewText, undefined);
  assert.equal(typeof isolated.__shiftLogSearchMatchedItemsV1.getMatchedSearchEntries, 'function');
});

test('published PC page loads the definition once before main with classic defer and ships the asset', async () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script\b([^>]*)>\s*<\/script>/gi)]
    .map(m => ({ attributes: m[1], url: m[1].match(/\bsrc="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&') }));
  const definitions = scripts.filter(s => s.url?.split('?')[0] === asset);
  const mains = scripts.filter(s => s.url?.split('?')[0] === 'script.js');
  assert.equal(definitions.length, 1); assert.equal(mains.length, 1);
  for (const script of [...definitions, ...mains]) {
    assert.match(script.attributes, /\bdefer\b/);
    assert.doesNotMatch(script.attributes, /\basync\b|\btype\s*=\s*["']module/i);
  }
  assert.equal(scripts.indexOf(definitions[0]) + 1, scripts.indexOf(mains[0]));
  assert.ok(definitions[0].url.split('?')[1], 'definition must have a cache version');
  assert.ok(new URL('https://example.invalid/' + mains[0].url).searchParams.has('limestone'));
  assert.equal(mainSource.split(invocation).length - 1, 1);
  assert.doesNotMatch(mainSource, /function installShiftLogSearchMatchedItemsV1/);
  assert.ok((await collectWebAssets(root)).includes(asset));
  assert.doesNotMatch(read('mobile-app/index.html'), /shift-log-search-matched-items\.js/);
});
