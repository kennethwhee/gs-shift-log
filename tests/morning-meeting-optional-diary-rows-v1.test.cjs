'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('../maintenance/vendor/auxiliary-jszip-3.10.1.min.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const keys = ['safety', 'environment', 'mechanical', 'electrical'];
const labels = ['안전팀', '환경팀', '기계팀', '전기제어팀'];

// Browser DOM subset: production row inspection, cloning, values, merges and
// replacement functions below run unchanged. The final ZIP uses real JSZip.
class Element {
  constructor(document, name) {
    this.ownerDocument = document; this.localName = name;
    this.namespaceURI = NS; this.nodeType = 1;
    this.attrs = new Map(); this.childNodes = []; this.parentNode = null;
    this._text = '';
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  setAttributeNS(ns, name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    assert.ok(index >= 0, 'valid insertion reference');
    this.childNodes.splice(index, 0, child); child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    assert.ok(index >= 0, 'only remove owned child');
    this.childNodes.splice(index, 1); child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get textContent() {
    return this.childNodes.length ? this.childNodes.map(c => c.textContent).join('') : this._text;
  }
  set textContent(text) {
    this.childNodes.forEach(child => { child.parentNode = null; });
    this.childNodes = []; this._text = String(text);
  }
  getElementsByTagNameNS(ns, name) {
    return this.childNodes.flatMap(child => [
      ...(child.namespaceURI === ns && child.localName === name ? [child] : []),
      ...child.getElementsByTagNameNS(ns, name)
    ]);
  }
  cloneNode(deep) {
    const clone = new Element(this.ownerDocument, this.localName);
    clone.attrs = new Map(this.attrs); clone._text = this._text;
    if (deep) this.childNodes.forEach(child => clone.appendChild(child.cloneNode(true)));
    return clone;
  }
}
class Document {
  constructor(root = 'worksheet') {
    this.documentElement = new Element(this, root);
    this.documentElement.setAttribute('xmlns', NS);
  }
  createElementNS(ns, name) { return new Element(this, name); }
  getElementsByTagNameNS(ns, name) {
    const root = this.documentElement;
    return [...(root.localName === name ? [root] : []), ...root.getElementsByTagNameNS(ns, name)];
  }
}
function xml(node) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const attrs = [...node.attrs].map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
  return `<${node.localName}${attrs}>${escape(node._text)}${node.childNodes.map(xml).join('')}</${node.localName}>`;
}
function declaration(name) {
  const match = new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\(', 'm').exec(source);
  if (!match && name === 'resolveMorningMeetingOptionalRowTemplate') return '';
  assert.ok(match, `production function ${name} exists`);
  let cursor = match.index;
  for (;;) {
    const end = source.indexOf('\n' + match[1] + '}\n', cursor);
    assert.ok(end > cursor, `function boundary ${name}`);
    const snippet = source.slice(match.index, end + match[1].length + 2);
    try { new vm.Script(snippet); return snippet; } catch { cursor = end + 1; }
  }
}
const functions = [
  'getMorningMeetingDirectXmlChildren', 'getMorningMeetingRowNumber',
  'getMorningMeetingCellColumn', 'getMorningMeetingColumnNumber',
  'normalizeMorningMeetingTemplateText', 'getMorningMeetingCellTextFromXml',
  'getMorningMeetingRowColumnBText', 'findMorningMeetingRowRecord',
  'findMorningMeetingBlankRowRecord', 'findMorningMeetingContentRowRecord',
  'resolveMorningMeetingOptionalRowTemplate', 'inspectMorningMeetingDynamicLayout',
  'inspectMorningMeetingShiftPartLayout', 'inspectMorningMeetingFuelAreaLayout',
  'inspectMorningMeetingTmAreaLayout', 'getMorningMeetingTmMergeEndColumnForRow',
  'getMorningMeetingPrimaryMergeEndColumnForRow', 'parseMorningMeetingMergeReference',
  'formatMorningMeetingMergeReference', 'isMorningMeetingDynamicHangulCharacter',
  'splitMorningMeetingDynamicFontRuns', 'createMorningMeetingSharedStringRun',
  'appendMorningMeetingSharedString', 'setMorningMeetingDynamicCellText',
  'calculateMorningMeetingDynamicTextUnits', 'calculateMorningMeetingDynamicRowHeight',
  'cloneMorningMeetingDynamicRow', 'normalizeMorningMeetingOutputLine',
  'splitMorningMeetingOutputLines', 'formatMorningMeetingShortDate',
  'buildMorningMeetingDynamicRows', 'shiftMorningMeetingExistingRow',
  'updateMorningMeetingDynamicMerges', 'updateMorningMeetingDynamicDimension',
  'updateMorningMeetingDynamicPageBreak', 'replaceMorningMeetingDynamicTeamArea',
  'classifyMorningMeetingTmItems', 'formatMorningMeetingTmItemText',
  'buildMorningMeetingTmAreaRows', 'updateMorningMeetingTmAreaMerges',
  'updateMorningMeetingWorksheetActualDimension', 'replaceMorningMeetingTmArea',
  'buildMorningMeetingShiftPartRows', 'replaceMorningMeetingShiftPartArea',
  'updateMorningMeetingShiftPartMerges', 'updateMorningMeetingRowsDimensionAfter',
  'updateMorningMeetingRowBreaksAfter', 'buildMorningMeetingFuelAreaRows',
  'replaceMorningMeetingFuelArea', 'updateMorningMeetingFuelAreaMerges',
  'analyzeAllMorningMeetingFiles'
];
const productionFunctions = functions.map(declaration).join('\n');
function harness() {
  const strings = [], sharedDocument = new Document('sst');
  const context = vm.createContext({
    console: {warn() {}, log() {}, error() {}}, Date, window: {},
    MAIN_XML_NAMESPACE: NS,
    MORNING_MEETING_DYNAMIC_TEAM_CONFIG: keys.map((key, i) => ({
      key, teamName: labels[i], sectionNumber: i + 2,
      titlePattern: new RegExp('^' + (i + 2) + '\\s*\\.\\s*' + labels[i] + '$', 'i')
    })),
    activeMorningMeetingSharedStringsContext: {
      document: sharedDocument, root: sharedDocument.documentElement,
      values: strings, phoneticTemplate: null, appendedCount: 0
    }
  });
  vm.runInContext(productionFunctions, context);
  return {c: context, strings, sharedDocument};
}
function fixture({empty = [], sparse = false, tmOperation = 'operation', tmFuel = 'fuel'} = {}) {
  const h = harness(), doc = new Document();
  const create = (name, attrs = {}, text = '') => {
    const e = doc.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, value);
    if (text) e.textContent = text;
    return e;
  };
  const dimension = create('dimension', {ref: 'A1:AO100'});
  const data = create('sheetData'), merges = create('mergeCells', {count: 0});
  doc.documentElement.appendChild(dimension);
  doc.documentElement.appendChild(data); doc.documentElement.appendChild(merges);
  let rowNumber = 0;
  const add = (text, style = '2') => {
    rowNumber++;
    if (sparse && !text) return null;
    const row = create('row', {r: rowNumber, ht: '20.1', customHeight: 1});
    const cell = create('c', {r: `B${rowNumber}`, s: style});
    if (text) {
      cell.setAttribute('t', 's');
      const index = h.strings.push(text) - 1;
      const si = h.sharedDocument.createElementNS(NS, 'si');
      const t = h.sharedDocument.createElementNS(NS, 't'); t.textContent = text;
      si.appendChild(t); h.sharedDocument.documentElement.appendChild(si);
      cell.appendChild(create('v', {}, String(index)));
    }
    row.appendChild(cell); data.appendChild(row);
    // Excel does not retain a merge for a physically omitted sparse row.
    merges.appendChild(create('mergeCell', {ref: `B${rowNumber}:AO${rowNumber}`}));
    merges.setAttribute('count', merges.childNodes.length);
    return row;
  };
  add('TOP DATA SENTINEL', '3');
  add('◇ 교대 파트', '1'); add(empty.includes('shift') ? '' : 'old shift'); add('');
  add('◇ 연료 설비', '1'); add(empty.includes('coal') ? '' : 'old coal'); add('');
  keys.forEach((key, i) => {
    add(`${i + 2}. ${labels[i]}`, '1'); add('');
    add('◇ 전일 특이사항(11/02)', '1'); add(empty.includes(key) ? '' : `old ${key} previous`);
    add(''); add('◇ 예정사항(11/03)', '1'); add(empty.includes(key) ? '' : `old ${key} schedule`); add('');
  });
  add('6. TM 사항', '1');
  add('◇ 설비 운영', '1'); add(tmOperation); add('');
  add('◇ 연료 설비', '1'); add(tmFuel); add('');
  dimension.setAttribute('ref', `A1:AO${rowNumber}`);
  return {...h, doc, data, merges};
}
function records(f) {
  return f.data.childNodes.map(row => ({row, number: Number(row.getAttribute('r')),
    text: f.c.getMorningMeetingRowColumnBText(row, f.strings)}));
}
function analysis({missing = []} = {}) {
  return Object.fromEntries(keys.map(key => [key, {
    missing: missing.includes(key), reportDate: missing.includes(key) ? '' : '2026-11-03',
    previousText: missing.includes(key) ? '' : `new ${key} previous`,
    scheduleText: missing.includes(key) ? '' : `new ${key} schedule`
  }]));
}
function applyTeams(f, results) {
  const layout = f.c.inspectMorningMeetingDynamicLayout(f.doc, f.strings);
  const build = f.c.buildMorningMeetingDynamicRows(layout, results,
    new Date('2026-11-03T00:00:00Z'), new Date('2026-11-04T00:00:00Z'));
  f.c.replaceMorningMeetingDynamicTeamArea(f.doc, layout, build);
  return build;
}
function validateRowsAndMerges(f) {
  const rows = records(f).map(r => r.number);
  assert.equal(new Set(rows).size, rows.length, 'unique worksheet row numbers');
  assert.deepEqual(rows, [...rows].sort((a, b) => a - b), 'ascending worksheet rows');
  for (const record of records(f)) {
    for (const cell of record.row.childNodes) {
      assert.equal(Number(cell.getAttribute('r').match(/\d+$/)[0]), record.number);
    }
  }
  const ranges = f.merges.childNodes.map(e => e.getAttribute('ref'));
  assert.equal(new Set(ranges).size, ranges.length, 'no duplicate merges');
  assert.equal(Number(f.merges.getAttribute('count')), ranges.length);
  for (const range of ranges) {
    const parsed = f.c.parseMorningMeetingMergeReference(range);
    assert.equal(parsed.startColumn, 'B'); assert.equal(parsed.endColumn, 'AO');
    assert.equal(parsed.startRow, parsed.endRow); assert.ok(rows.includes(parsed.startRow));
  }
  assert.equal(f.doc.getElementsByTagNameNS(NS, 'dimension')[0].getAttribute('ref'),
    `A1:AO${Math.max(...rows)}`);
  assert.equal(records(f)[0].text, 'TOP DATA SENTINEL');
}

test('screenshot: blank TM fuel content retains its own body style and can be rebuilt', () => {
  const f = fixture({tmFuel: ''}); const before = xml(f.doc.documentElement);
  const layout = f.c.inspectMorningMeetingTmAreaLayout(f.doc, f.strings);
  assert.equal(layout.templates.fuelContent.element.childNodes[0].getAttribute('s'), '2');
  assert.equal(layout.templates.fuelContent.mergeEndColumn, 'AO');
  assert.equal(xml(f.doc.documentElement), before, 'inspection never mutates template');
  const result = f.c.replaceMorningMeetingTmArea(f.doc, f.strings, []);
  assert.equal(result.fuelCount, 0); assert.equal(result.operationCount, 0);
  const tm = records(f).slice(records(f).findIndex(r => r.text === '6. TM 사항'));
  assert.deepEqual(tm.map(r => r.text), ['6. TM 사항', '◇ 설비 운영', '', '', '◇ 연료 설비', '', '']);
  validateRowsAndMerges(f);
});

test('both TM groups can be empty, including a template that omitted every empty row', () => {
  for (const sparse of [false, true]) {
    const f = fixture({sparse, tmFuel: '', tmOperation: ''});
    f.c.replaceMorningMeetingTmArea(f.doc, f.strings, []);
    f.c.replaceMorningMeetingTmArea(f.doc, f.strings, []);
    validateRowsAndMerges(f);
  }
});

test('normal TM templates retain their original nonempty row references and styles', () => {
  const f = fixture();
  const operation = records(f).find(r => r.text === 'operation').row;
  const fuel = records(f).find(r => r.text === 'fuel').row;
  const layout = f.c.inspectMorningMeetingTmAreaLayout(f.doc, f.strings);
  assert.equal(layout.templates.operationContent.element, operation);
  assert.equal(layout.templates.fuelContent.element, fuel);
});

test('missing structural TM headings still stop export', () => {
  const f = fixture();
  const heading = records(f).find(r => r.text === '◇ 설비 운영').row;
  f.data.removeChild(heading);
  assert.throws(() => f.c.inspectMorningMeetingTmAreaLayout(f.doc, f.strings), /설비 운영/);
});

test('fallback copies row/cell styles and clears every value, formula and inline/shared string', () => {
  const f = fixture(); const original = records(f).find(r => r.text === 'operation').row;
  const extra = f.doc.createElementNS(NS, 'c'); extra.setAttribute('r', 'C42');
  extra.setAttribute('s', '3'); extra.setAttribute('t', 'str');
  for (const name of ['f', 'v', 'is']) {
    const child = f.doc.createElementNS(NS, name); child.textContent = 'STALE'; extra.appendChild(child);
  }
  original.appendChild(extra); const before = xml(original);
  const record = {element: original, rowNumber: 42, text: 'old'};
  const fallback = f.c.resolveMorningMeetingOptionalRowTemplate(null, record);
  assert.notEqual(fallback.element, original); assert.equal(xml(original), before);
  assert.equal(fallback.element.parentNode, null);
  assert.equal(fallback.element.getAttribute('ht'), original.getAttribute('ht'));
  assert.equal(fallback.element.childNodes[1].getAttribute('s'), '3');
  for (const cell of fallback.element.childNodes) {
    assert.equal(cell.childNodes.length, 0); assert.equal(cell.getAttribute('t'), null);
  }
  assert.equal(f.c.resolveMorningMeetingOptionalRowTemplate(record), record);
});

test('an empty fallback row without B keeps the nearest cell style when B is recreated', () => {
  const f = fixture({tmFuel: ''});
  const layout = f.c.inspectMorningMeetingTmAreaLayout(f.doc, f.strings);
  const bodyNumber = Number(layout.templates.fuelHeading.element.getAttribute('r')) + 1;
  const row = records(f).find(record => record.number === bodyNumber).row;
  row.removeChild(row.firstChild);
  const cell = f.doc.createElementNS(NS, 'c');
  cell.setAttribute('r', `C${bodyNumber}`); cell.setAttribute('s', '3'); row.appendChild(cell);
  const before = xml(row);
  const resolved = f.c.resolveMorningMeetingOptionalRowTemplate(null,
    {element: row, rowNumber: bodyNumber, text: ''});
  assert.equal(resolved.element.firstChild.getAttribute('r'), `B${bodyNumber}`);
  assert.equal(resolved.element.firstChild.getAttribute('s'), '3');
  assert.equal(xml(row), before);
});

for (const key of keys) test(`previous exported ${key} section can be blank and accept today's content`, () => {
  for (const sparse of [false, true]) {
    const f = fixture({empty: [key], sparse});
    const build = applyTeams(f, analysis());
    const range = build.teamRanges[key];
    const texts = records(f).filter(r => r.number >= range.startRow && r.number <= range.endRow).map(r => r.text);
    assert.ok(texts.includes(`new ${key} previous`));
    assert.ok(texts.includes(`new ${key} schedule`));
    f.c.replaceMorningMeetingTmArea(f.doc, f.strings, []);
    validateRowsAndMerges(f);
  }
});

test('real no-safety upload analysis flows through blank safety and blank fuel TM export', async () => {
  const f = fixture({empty: ['safety'], tmFuel: ''});
  const uploadState = {files: Object.fromEntries(keys.filter(k => k !== 'safety').map(k => [k, {name: k + '.xlsx'}]))};
  const analyzed = [], errors = [];
  const elements = {analyzeButton: {textContent: '자료 분석'}, createButton: {}, message: {}};
  let updated = 0;
  Object.assign(f.c, {
    XLSX: {}, TEAM_CONFIG: Object.fromEntries(keys.map((k, i) => [k, {name: labels[i]}])),
    getMorningMeetingAnalyzerElements: () => elements,
    getMorningMeetingUploadState: () => uploadState,
    hideMorningMeetingAnalysisError() {}, showMorningMeetingAnalysisError: message => errors.push(message),
    analyzeMorningMeetingTeamFile: async key => {
      analyzed.push(key);
      return {teamKey: key, teamName: labels[keys.indexOf(key)], ...analysis()[key]};
    },
    renderMorningMeetingAnalysisPreview() {}
  });
  f.c.window.setTimeout = () => 1;
  f.c.window.updateEfficiencyMorningMeetingCreateButton = () => { updated++; };
  await f.c.analyzeAllMorningMeetingFiles();
  assert.deepEqual(errors, []); assert.deepEqual(analyzed, keys.slice(1));
  assert.equal(uploadState.analysis.safety.missing, true);
  assert.equal(uploadState.analysis.safety.previousText, '');
  assert.equal(uploadState.analysis.safety.scheduleText, '');
  assert.equal(updated, 1); assert.match(elements.message.textContent, /빈칸 처리: 안전팀/);
  const build = applyTeams(f, uploadState.analysis);
  const range = build.teamRanges.safety;
  const safetyTexts = records(f).filter(r => r.number >= range.startRow && r.number <= range.endRow).map(r => r.text);
  assert.ok(safetyTexts.every(text => !/old |new /.test(text)));
  assert.ok(records(f).some(r => r.text === 'new environment previous'));
  f.c.replaceMorningMeetingTmArea(f.doc, f.strings, []);
  validateRowsAndMerges(f);
});

test('entire optional source set can be blank, reused, then refilled without stale data or row/merge drift', () => {
  for (const sparse of [false, true]) {
    const f = fixture({empty: [...keys, 'shift', 'coal'], tmFuel: '', tmOperation: '', sparse});
    for (let round = 0; round < 2; round++) {
      f.c.replaceMorningMeetingShiftPartArea(f.doc, f.strings, '');
      f.c.replaceMorningMeetingFuelArea(f.doc, f.strings, {selectedItems: []});
      applyTeams(f, analysis({missing: keys}));
      f.c.replaceMorningMeetingTmArea(f.doc, f.strings, []);
      validateRowsAndMerges(f);
      assert.ok(records(f).every(r => !/^old |^new /.test(r.text)));
    }
    applyTeams(f, analysis());
    const result = f.c.replaceMorningMeetingTmArea(f.doc, f.strings, [
      {sourceType: 'shift', content: 'new operation TM'},
      {sourceType: 'coal', content: 'new fuel TM'}
    ]);
    assert.equal(result.operationCount, 1); assert.equal(result.fuelCount, 1);
    assert.ok(records(f).some(r => r.text === '1) new operation TM'));
    assert.ok(records(f).some(r => r.text === '1) new fuel TM'));
    validateRowsAndMerges(f);
  }
});

async function workbookFixture() {
  const f = fixture({empty: ['safety', 'shift', 'coal'], tmFuel: '', tmOperation: ''});
  f.c.replaceMorningMeetingShiftPartArea(f.doc, f.strings, '');
  f.c.replaceMorningMeetingFuelArea(f.doc, f.strings, {selectedItems: []});
  applyTeams(f, analysis({missing: ['safety']}));
  f.c.replaceMorningMeetingTmArea(f.doc, f.strings, []);
  validateRowsAndMerges(f);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const rels = entries => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${rel}${type}" Target="${target}"/>`).join('') + '</Relationships>';
  zip.file('_rels/.rels', rels([['rId1', 'officeDocument', 'xl/workbook.xml']]));
  zip.file('xl/_rels/workbook.xml.rels', rels([
    ['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'styles', 'styles.xml'], ['rId3', 'sharedStrings', 'sharedStrings.xml']
  ]));
  zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="${rel.slice(0, -1)}"><sheets>` +
    '<sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/styles.xml', `<styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="12"/><name val="Arial"/></font></fonts>` +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'.repeat(4) +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  f.sharedDocument.documentElement.setAttribute('uniqueCount', f.strings.length);
  f.sharedDocument.documentElement.setAttribute('count', f.doc.getElementsByTagNameNS(NS, 'c').filter(c => c.getAttribute('t') === 's').length);
  zip.file('xl/sharedStrings.xml', xml(f.sharedDocument.documentElement));
  zip.file('xl/worksheets/sheet1.xml', xml(f.doc.documentElement));
  return zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'});
}
test('generated blank-safety/blank-TM workbook survives a real XLSX ZIP round trip', async () => {
  const bytes = await workbookFixture();
  const reopened = await JSZip.loadAsync(bytes, {checkCRC32: true});
  const sheet = await reopened.file('xl/worksheets/sheet1.xml').async('string');
  const strings = await reopened.file('xl/sharedStrings.xml').async('string');
  assert.match(sheet, /<sheetData>/); assert.match(strings, /new environment previous/);
  assert.ok(!sheet.includes('undefined')); assert.ok(!sheet.includes('NaN'));
  assert.equal((sheet.match(/<mergeCell /g) || []).length, (sheet.match(/<row /g) || []).length);
});

module.exports = {workbookFixture, fixture, applyTeams, analysis, records, validateRowsAndMerges};
