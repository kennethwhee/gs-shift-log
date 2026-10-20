'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const JSZip = require('../maintenance/vendor/auxiliary-jszip-3.10.1.min.js');

const repo = process.env.MECHANICAL_TABLE_REPO || path.resolve(__dirname, '..');
// Git for Windows may check out CRLF. Normalize only the in-memory test source
// so function-order checks validate the same code on Windows and Linux.
const source = fs.readFileSync(path.join(repo, 'script.js'), 'utf8').replace(/\r\n?/g, '\n');
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const start = source.indexOf('const MORNING_MEETING_DYNAMIC_TEAM_CONFIG =');
const end = source.indexOf('async function updateMorningMeetingWorkbookPrintArea(', start);
assert.ok(start >= 0 && end > start, 'production dynamic export function boundaries exist');

// This small XML DOM intentionally models mutations, not browser layout. Actual
// production functions and the vendored JSZip run unchanged on Windows/Node.
class Element {
  constructor(name, document = null, attrs = {}, children = []) {
    this.nodeType = 1;
    this.localName = name;
    this.tagName = name;
    this.namespaceURI = MAIN;
    this.ownerDocument = document;
    this.attributes = new Map(Object.entries(attrs));
    this.childNodes = [];
    this.parentNode = null;
    this._text = '';
    children.forEach(child => this.appendChild(child));
  }
  get children() { return this.childNodes; }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this._text + this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value ?? ''); this.childNodes.forEach(child => { child.parentNode = null; }); this.childNodes = []; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setAttributeNS(_namespace, name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    child.remove();
    const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    assert.ok(index >= 0, 'insertion reference belongs to parent');
    this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    const assignDocument = node => { node.ownerDocument = this.ownerDocument; node.childNodes.forEach(assignDocument); };
    assignDocument(child);
    return child;
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    assert.ok(index >= 0, 'removed node belongs to parent');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  cloneNode(deep = false) {
    const copy = new Element(this.localName, this.ownerDocument, Object.fromEntries(this.attributes));
    copy.namespaceURI = this.namespaceURI;
    copy._text = this._text;
    if (deep) this.childNodes.forEach(child => copy.appendChild(child.cloneNode(true)));
    return copy;
  }
  getElementsByTagNameNS(namespace, name) {
    return this.childNodes.flatMap(child => [
      ...(child.namespaceURI === namespace && (name === '*' || child.localName === name) ? [child] : []),
      ...child.getElementsByTagNameNS(namespace, name)
    ]);
  }
  getElementsByTagName(name) { return this.getElementsByTagNameNS(MAIN, name); }
}

class Document {
  constructor(rootName = 'worksheet') { this.documentElement = new Element(rootName, this); }
  createElementNS(namespace, name) { const element = new Element(name, this); element.namespaceURI = namespace; return element; }
  getElementsByTagNameNS(namespace, name) {
    return [
      ...(this.documentElement.namespaceURI === namespace && this.documentElement.localName === name ? [this.documentElement] : []),
      ...this.documentElement.getElementsByTagNameNS(namespace, name)
    ];
  }
  getElementsByTagName(name) { return this.getElementsByTagNameNS(MAIN, name); }
  clone() {
    const copy = new Document(this.documentElement.localName);
    copy.documentElement = this.documentElement.cloneNode(true);
    const assignDocument = node => { node.ownerDocument = copy; node.childNodes.forEach(assignDocument); };
    assignDocument(copy.documentElement);
    return copy;
  }
}

function element(document, name, attrs = {}, children = []) {
  const node = document.createElementNS(MAIN, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  children.forEach(child => node.appendChild(child));
  return node;
}
const direct = (node, name) => node.childNodes.filter(child => child.localName === name);
const numberOf = column => [...String(column)].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
function nameOf(number) {
  let value = number, result = '';
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}
function xmlOf(node) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attrs = [...node.attributes].map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
  return `<${node.localName}${attrs}>${escape(node._text)}${node.childNodes.map(xmlOf).join('')}</${node.localName}>`;
}
function textCell(document, row, column, text, style = '0') {
  const cell = element(document, 'c', { r: `${column}${row}`, s: style, t: 'inlineStr' });
  const value = element(document, 't'); value.textContent = text;
  cell.appendChild(element(document, 'is', {}, [value]));
  return cell;
}
function cellAt(document, address) { return document.getElementsByTagNameNS(MAIN, 'c').find(cell => cell.getAttribute('r') === address); }
function rowAt(document, number) { return document.getElementsByTagNameNS(MAIN, 'row').find(row => Number(row.getAttribute('r')) === number); }
function cellText(cell, strings = []) {
  if (!cell) return '';
  if (cell.getAttribute('t') === 's') return strings[Number(direct(cell, 'v')[0]?.textContent)] || '';
  return cell.getElementsByTagNameNS(MAIN, 't').map(node => node.textContent).join('');
}
function parseMerge(ref) {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  assert.ok(match, `valid merge reference: ${ref}`);
  return { left: numberOf(match[1]), top: Number(match[2]), right: numberOf(match[3]), bottom: Number(match[4]) };
}

const HEADERS = ['구분', '주요 작업명', '작업위치', '작업시간', '작업자', '비고'];
const JOBS = [
  ['외주', '반송기 체인 점검', 'A-101', '종일', '협력업체A', '일반(발주처)'],
  ['외주', '안전 방호 덮개 보강', '#2 BLR', '09:00~17:00', '협력업체B', '고소(발주처)']
];
const WIDTHS = [11.4, 57, 17.1, 11.4, 16.8, 22.4];

function fixture({ jobs = JOBS, electricalRow = 25, titleRow = 10, duplicateTitle = false, omitRow = null } = {}) {
  const registry = new Map();
  function serialize(document) {
    const xml = xmlOf(document.documentElement || document);
    if (document.documentElement) registry.set(xml, document.clone());
    return xml;
  }
  function parse(xml, description) {
    assert.ok(registry.has(xml), `${description}: XML must be an intact registered fixture`);
    return registry.get(xml).clone();
  }
  const worksheet = new Document();
  const cols = element(worksheet, 'cols');
  for (let col = 2; col <= 41; col += 1) cols.appendChild(element(worksheet, 'col', {
    min: col, max: col, width: col % 7 === 0 ? 3.5 : 2.0, customWidth: '1'
  }));
  const data = element(worksheet, 'sheetData');
  const merges = element(worksheet, 'mergeCells', { count: '30' });
  worksheet.documentElement.appendChild(element(worksheet, 'dimension', { ref: 'B1:AP30' }));
  worksheet.documentElement.appendChild(cols);
  worksheet.documentElement.appendChild(data);
  worksheet.documentElement.appendChild(merges);
  const values = new Map([[2, '보존할 상단 값'], [5, '4. 기계팀'], [8, '1) 예정 정비'], [titleRow, '◇ 외주공사'], [electricalRow, '5. 전기제어팀'], [28, '6. TM 사항']]);
  if (duplicateTitle) values.set(18, '◇ 외주공사');
  for (let row = 1; row <= 30; row += 1) {
    if (row === omitRow) continue;
    const rowElement = element(worksheet, 'row', { r: row, ht: '20.1', customHeight: '1' });
    rowElement.appendChild(textCell(worksheet, row, 'B', values.get(row) || ''));
    if (row >= titleRow && row <= titleRow + jobs.length + 2) {
      rowElement.appendChild(textCell(worksheet, row, 'C', '과거 병합 잔재'));
    }
    data.appendChild(rowElement);
    merges.appendChild(element(worksheet, 'mergeCell', { ref: `B${row}:AO${row}` }));
  }
  const protectedFormula = element(worksheet, 'c', { r: 'AP12', s: '1' }, [element(worksheet, 'f'), element(worksheet, 'v')]);
  direct(protectedFormula, 'f')[0].textContent = 'SUM(A1:A2)';
  direct(protectedFormula, 'v')[0].textContent = '123.5';
  rowAt(worksheet, 12)?.appendChild(protectedFormula);
  const styles = new Document('styleSheet');
  styles.documentElement.appendChild(element(styles, 'fonts', { count: '1' }, [
    element(styles, 'font', {}, [element(styles, 'sz', { val: '12' }), element(styles, 'name', { val: 'Batang' })])
  ]));
  styles.documentElement.appendChild(element(styles, 'fills', { count: '2' }, [
    element(styles, 'fill', {}, [element(styles, 'patternFill', { patternType: 'none' })]),
    element(styles, 'fill', {}, [element(styles, 'patternFill', { patternType: 'gray125' })])
  ]));
  styles.documentElement.appendChild(element(styles, 'borders', { count: '1' }, [element(styles, 'border')]));
  styles.documentElement.appendChild(element(styles, 'cellStyleXfs', { count: '1' }, [element(styles, 'xf', { numFmtId: '0', fontId: '0', fillId: '0', borderId: '0' })]));
  styles.documentElement.appendChild(element(styles, 'cellXfs', { count: '2' }, [
    element(styles, 'xf', { numFmtId: '0', fontId: '0', fillId: '0', borderId: '0', xfId: '0' }),
    element(styles, 'xf', { numFmtId: '2', fontId: '0', fillId: '0', borderId: '0', xfId: '0' })
  ]));
  const zip = new JSZip();
  zip.file('xl/styles.xml', serialize(styles));
  zip.file('xl/worksheets/sheet2.xml', '<worksheet>unrelated sheet byte content</worksheet>');
  zip.file('xl/workbook.xml', '<workbook>existing print area and views</workbook>');
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    MAIN_XML_NAMESPACE: MAIN,
    getMorningMeetingColumnNumber: numberOf,
    parseMorningMeetingXml: parse,
    XMLSerializer: class { serializeToString(document) { return serialize(document); } }
  });
  vm.runInContext(source.slice(start, end), context);
  return { worksheet, zip, context, serialize, parse,
    result: { outsourcedWork: { headers: [...HEADERS], rows: jobs.map(row => [...row]), columnWidths: [...WIDTHS] } },
    paint(result) { return context.applyMorningMeetingOutsourcedWorkTable(zip, worksheet, [], result === undefined ? this.result : result); },
    async styles() { return parse(await zip.file('xl/styles.xml').async('string'), 'updated styles'); }
  };
}

function styleFor(styles, cell) {
  const xfs = styles.getElementsByTagNameNS(MAIN, 'cellXfs')[0];
  return direct(xfs, 'xf')[Number(cell.getAttribute('s'))];
}
function fontFor(styles, cell) {
  const fonts = styles.getElementsByTagNameNS(MAIN, 'fonts')[0];
  return direct(fonts, 'font')[Number(styleFor(styles, cell).getAttribute('fontId'))];
}
function borderFor(styles, cell) {
  const borders = styles.getElementsByTagNameNS(MAIN, 'borders')[0];
  return direct(borders, 'border')[Number(styleFor(styles, cell).getAttribute('borderId'))];
}
function tableMerges(document, row) {
  return document.getElementsByTagNameNS(MAIN, 'mergeCell').map(node => ({ node, range: parseMerge(node.getAttribute('ref')) }))
    .filter(item => item.range.top <= row && item.range.bottom >= row);
}

test('table groups respect source proportions and leave destination column widths intact', () => {
  const f = fixture();
  const before = xmlOf(f.worksheet.getElementsByTagNameNS(MAIN, 'cols')[0]);
  const groups = f.context.getMorningMeetingOutsourcedTableGroups(f.worksheet, WIDTHS);
  assert.equal(groups.length, 6);
  assert.equal(groups[0].startColumn, 'B');
  assert.equal(groups.at(-1).endColumn, 'AO');
  for (let i = 0; i < groups.length; i += 1) {
    assert.ok(numberOf(groups[i].endColumn) >= numberOf(groups[i].startColumn));
    assert.ok(groups[i].width > 0);
    if (i) assert.equal(numberOf(groups[i].startColumn), numberOf(groups[i - 1].endColumn) + 1);
  }
  assert.ok(groups[1].width > groups[0].width * 3, 'work name retains its broad source column');
  assert.equal(xmlOf(f.worksheet.getElementsByTagNameNS(MAIN, 'cols')[0]), before);
});

test('final painter creates six bordered columns under a separate title without inserting rows', async () => {
  const f = fixture();
  const beforeRows = f.worksheet.getElementsByTagNameNS(MAIN, 'row').map(row => row.getAttribute('r'));
  const outside = ['B2', 'B5', 'B8', 'B25', 'B28', 'AP12'].map(address => [address, xmlOf(cellAt(f.worksheet, address))]);
  const oldStyles = await f.styles();
  const originalXfs = direct(oldStyles.getElementsByTagNameNS(MAIN, 'cellXfs')[0], 'xf').map(xmlOf);
  const applied = await f.paint();
  assert.equal(applied.applied, true);
  assert.deepEqual(f.worksheet.getElementsByTagNameNS(MAIN, 'row').map(row => row.getAttribute('r')), beforeRows);
  outside.forEach(([address, xml]) => assert.equal(xmlOf(cellAt(f.worksheet, address)), xml, `${address} unchanged`));
  assert.equal(await f.zip.file('xl/worksheets/sheet2.xml').async('string'), '<worksheet>unrelated sheet byte content</worksheet>');
  assert.equal(await f.zip.file('xl/workbook.xml').async('string'), '<workbook>existing print area and views</workbook>');
  const styles = await f.styles();
  assert.deepEqual(direct(styles.getElementsByTagNameNS(MAIN, 'cellXfs')[0], 'xf').slice(0, originalXfs.length).map(xmlOf), originalXfs);
  assert.equal(cellText(cellAt(f.worksheet, 'B10')), '◇ 외주공사');
  assert.equal(Number(rowAt(f.worksheet, 10).getAttribute('ht')), 15.6);
  assert.ok(Number(rowAt(f.worksheet, 11).getAttribute('ht')) >= 13.8, 'header keeps its baseline height and grows for narrow groups');
  const groups = f.context.getMorningMeetingOutsourcedTableGroups(f.worksheet, WIDTHS);
  for (const [row, expected] of [[11, HEADERS], [12, JOBS[0]], [13, JOBS[1]], [14, Array(6).fill('')]]) {
    assert.deepEqual(Array.from(groups, group => cellText(cellAt(f.worksheet, `${group.startColumn}${row}`))), expected);
    const merges = tableMerges(f.worksheet, row).map(item => item.range).sort((a, b) => a.left - b.left);
    assert.equal(merges.length, 6);
    assert.equal(merges[0].left, 2);
    assert.equal(merges.at(-1).right, 41);
    merges.forEach((range, index) => { assert.equal(range.top, row); assert.equal(range.bottom, row); if (index) assert.equal(range.left, merges[index - 1].right + 1); });
    for (const cell of direct(rowAt(f.worksheet, row), 'c')) {
      const column = numberOf(cell.getAttribute('r').replace(/\d+/g, ''));
      if (column < 2 || column > 41) continue;
      assert.equal(direct(cell, 'f').length, 0, 'table has no stale formulas');
      assert.doesNotMatch(cellText(cell), /\[외주공사\]|과거 병합 잔재/);
    }
  }
  assert.equal(tableMerges(f.worksheet, 10).length, 1);
  assert.equal(tableMerges(f.worksheet, 10)[0].node.getAttribute('ref'), 'B10:AO10');
  const count = f.worksheet.getElementsByTagNameNS(MAIN, 'mergeCells')[0].getAttribute('count');
  assert.equal(Number(count), f.worksheet.getElementsByTagNameNS(MAIN, 'mergeCell').length);
});

test('header blue, Arial 11 centered cells, title font and grid borders survive in saved styles', async () => {
  const f = fixture(); await f.paint();
  const styles = await f.styles();
  const groups = f.context.getMorningMeetingOutsourcedTableGroups(f.worksheet, WIDTHS);
  for (const group of groups) {
    for (const row of [11, 12, 13, 14]) {
      const cell = cellAt(f.worksheet, `${group.startColumn}${row}`);
      const font = fontFor(styles, cell);
      assert.equal(direct(font, 'name')[0].getAttribute('val'), 'Arial');
      assert.equal(Number(direct(font, 'sz')[0].getAttribute('val')), 11);
      const alignment = direct(styleFor(styles, cell), 'alignment')[0];
      assert.equal(alignment.getAttribute('horizontal'), 'center');
      assert.equal(alignment.getAttribute('vertical'), 'center');
      assert.equal(cell.getElementsByTagNameNS(MAIN, 'r').length, 0, 'no rich-run font overrides');
    }
    const style = styleFor(styles, cellAt(f.worksheet, `${group.startColumn}11`));
    const fill = direct(styles.getElementsByTagNameNS(MAIN, 'fills')[0], 'fill')[Number(style.getAttribute('fillId'))];
    const pattern = direct(fill, 'patternFill')[0];
    assert.equal(pattern.getAttribute('patternType'), 'solid');
    assert.equal(direct(pattern, 'fgColor')[0].getAttribute('rgb').slice(-6), '9DC3E6');
  }
  const titleFont = fontFor(styles, cellAt(f.worksheet, 'B10'));
  assert.equal(direct(titleFont, 'name')[0].getAttribute('val'), 'Times New Roman');
  assert.equal(Number(direct(titleFont, 'sz')[0].getAttribute('val')), 12);
  assert.equal(direct(titleFont, 'b').length, 1);
  assert.equal(direct(borderFor(styles, cellAt(f.worksheet, 'B12')), 'left')[0].getAttribute('style'), 'medium');
  assert.equal(direct(borderFor(styles, cellAt(f.worksheet, 'AO12')), 'right')[0].getAttribute('style'), 'medium');
  assert.equal(direct(borderFor(styles, cellAt(f.worksheet, 'B12')), 'bottom')[0].getAttribute('style'), 'hair');
  assert.equal(direct(borderFor(styles, cellAt(f.worksheet, 'B14')), 'bottom')[0].getAttribute('style'), 'medium');
});

test('an empty source table keeps its blue header and one bordered empty tail', async () => {
  const f = fixture({ jobs: [] }); await f.paint();
  const groups = f.context.getMorningMeetingOutsourcedTableGroups(f.worksheet, WIDTHS);
  assert.deepEqual(Array.from(groups, group => cellText(cellAt(f.worksheet, `${group.startColumn}11`))), HEADERS);
  assert.deepEqual(Array.from(groups, group => cellText(cellAt(f.worksheet, `${group.startColumn}12`))), Array(6).fill(''));
  assert.equal(tableMerges(f.worksheet, 12).length, 6);
});

test('repeated jobs remain separate table rows and multiline work raises row height', async () => {
  const job = ['외주', '점검 및 보강\n추가 작업\n마감 확인', '지하\n상부', '종일', '협력업체C', '일반'];
  const f = fixture({ jobs: [job, job] }); await f.paint();
  const groups = f.context.getMorningMeetingOutsourcedTableGroups(f.worksheet, WIDTHS);
  const nameColumn = groups[1].startColumn;
  assert.equal(cellText(cellAt(f.worksheet, `${nameColumn}12`)), job[1]);
  assert.equal(cellText(cellAt(f.worksheet, `${nameColumn}13`)), job[1]);
  assert.ok(Number(rowAt(f.worksheet, 12).getAttribute('ht')) > 14.25);
  const styles = await f.styles();
  assert.equal(direct(styleFor(styles, cellAt(f.worksheet, `${nameColumn}12`)), 'alignment')[0].getAttribute('wrapText'), '1');
});

test('long text receives adaptive body height without changing destination widths', async () => {
  const longJob = [...JOBS[0]]; longJob[1] = '긴 작업 내용과 세부 조치 '.repeat(30);
  const f = fixture({ jobs: [longJob] });
  const before = xmlOf(f.worksheet.getElementsByTagNameNS(MAIN, 'cols')[0]);
  await f.paint();
  assert.ok(Number(rowAt(f.worksheet, 12).getAttribute('ht')) > 14.25);
  assert.equal(xmlOf(f.worksheet.getElementsByTagNameNS(MAIN, 'cols')[0]), before);
});

test('multiline column headings grow the blue header without dropping any label text', async () => {
  const f = fixture();
  f.result.outsourcedWork.headers[3] = '작업\n시간\n(주간)';
  await f.paint();
  const groups = f.context.getMorningMeetingOutsourcedTableGroups(f.worksheet, WIDTHS);
  assert.equal(cellText(cellAt(f.worksheet, `${groups[3].startColumn}11`)), '작업\n시간\n(주간)');
  assert.ok(Number(rowAt(f.worksheet, 11).getAttribute('ht')) >= 3 * 13.8);
  const styles = await f.styles();
  assert.equal(direct(styleFor(styles, cellAt(f.worksheet, `${groups[3].startColumn}11`)), 'alignment')[0].getAttribute('wrapText'), '1');
});

test('the actual workbook capture and final hook use the same table snapshot across awaited style reads', async () => {
  const f = fixture();
  const analysis = Object.fromEntries(['safety', 'environment', 'mechanical', 'electrical'].map(key =>
    [key, { previousText: '', scheduleText: '' }]));
  analysis.mechanical = { previousText: '1) 완료 정비', scheduleText: '1) 캡처 시점 예정 정비', ...f.result };
  const templates = Object.fromEntries([
    'title', 'blankAfterTitle', 'previousHeading', 'previousContent',
    'separatorBlank', 'scheduleHeading', 'scheduleContent', 'finalBlank'
  ].map(key => [key, {}]));
  const sheetData = f.worksheet.getElementsByTagNameNS(MAIN, 'sheetData')[0];
  f.context.state = { analysis };
  f.context.layout = { safetyStartRow: 5, sheetData, teams: Object.fromEntries(
    ['safety', 'environment', 'mechanical', 'electrical'].map(key => [key, { templates }])
  ) };
  f.context.teamPreviousDate = '2026-10-19';
  f.context.teamScheduleDate = '2026-10-20';
  f.context.formatMorningMeetingShortDate = value => value.slice(5).replace('-', '.');
  f.context.cloneMorningMeetingDynamicRow = (document, _template, row, text) =>
    element(document, 'row', { r: row }, [textCell(document, row, 'B', text)]);
  const linesStart = source.indexOf('function normalizeMorningMeetingOutputLine(');
  const linesEnd = source.indexOf('function escapeMorningMeetingXml(', linesStart);
  const captureStart = source.indexOf('const teamAnalysisForWorkbook =');
  const captureEnd = source.indexOf('const dynamicResult =', captureStart);
  const hookStart = source.indexOf('await applyMorningMeetingOutsourcedWorkTable(', captureEnd);
  const hookEnd = source.indexOf(');', hookStart) + 2;
  assert.ok(linesStart >= 0 && linesEnd > linesStart && captureStart >= 0 && captureEnd > captureStart && hookEnd > hookStart);
  vm.runInContext(`${source.slice(linesStart, linesEnd)}\nfunction captureFixture() {\n${source.slice(captureStart, captureEnd)}\nreturn { teamAnalysisForWorkbook, buildResult };\n}\nasync function paintCapturedFixture() {\n${source.slice(hookStart, hookEnd)}\n}`, f.context);
  const captured = f.context.captureFixture();
  f.context.teamAnalysisForWorkbook = captured.teamAnalysisForWorkbook;
  f.context.zip = f.zip;
  f.context.worksheetDocument = f.worksheet;
  f.context.sharedStrings = [];
  sheetData.childNodes.slice().forEach(row => row.remove());
  const merges = f.worksheet.getElementsByTagNameNS(MAIN, 'mergeCells')[0];
  merges.childNodes.slice().forEach(merge => merge.remove());
  captured.buildResult.rows.forEach(({ element: row, rowNumber }) => {
    sheetData.appendChild(row);
    merges.appendChild(element(f.worksheet, 'mergeCell', { ref: `B${rowNumber}:AO${rowNumber}` }));
  });
  const titleRow = captured.buildResult.rows.find(item => cellText(direct(item.element, 'c')[0]) === '◇ 외주공사').rowNumber;
  const reservedRows = sheetData.childNodes.length;
  const styleFile = f.zip.file('xl/styles.xml');
  const readStyles = styleFile.async.bind(styleFile);
  let changesDuringAwait = 0;
  styleFile.async = async (...args) => {
    changesDuringAwait += 1;
    analysis.mechanical.scheduleText = '나중에 변경한 예정 정비';
    analysis.mechanical.outsourcedWork.headers[1] = '나중에 변경한 제목';
    analysis.mechanical.outsourcedWork.rows[0][1] = '나중에 변경한 작업';
    analysis.mechanical.outsourcedWork.rows.push(['외주', '나중에 추가한 작업', 'A-999', '오후', '협력업체C', '일반']);
    analysis.mechanical.outsourcedWork.columnWidths[1] = 1;
    return readStyles(...args);
  };
  await f.context.paintCapturedFixture();
  assert.equal(changesDuringAwait, 1, 'live UI analysis changes during the awaited styles read');
  assert.equal(analysis.mechanical.outsourcedWork.rows.length, 3);
  assert.equal(captured.teamAnalysisForWorkbook.mechanical.outsourcedWork.rows.length, 2);
  assert.equal(sheetData.childNodes.length, reservedRows, 'captured table keeps its reserved row count');
  const groups = f.context.getMorningMeetingOutsourcedTableGroups(f.worksheet, WIDTHS);
  assert.equal(cellText(cellAt(f.worksheet, `${groups[1].startColumn}${titleRow + 1}`)), HEADERS[1]);
  assert.equal(cellText(cellAt(f.worksheet, `${groups[1].startColumn}${titleRow + 2}`)), JOBS[0][1]);
  assert.equal(cellText(cellAt(f.worksheet, `${groups[1].startColumn}${titleRow + 3}`)), JOBS[1][1]);
  assert.equal(cellText(cellAt(f.worksheet, `${groups[1].startColumn}${titleRow + 4}`)), '');
  assert.ok(sheetData.childNodes.some(row => direct(row, 'c').some(cell => cellText(cell).includes('캡처 시점 예정 정비'))));
  assert.doesNotMatch(sheetData.textContent, /나중에 변경한|나중에 추가한/);
});

test('absent external data leaves workbook and worksheet untouched', async () => {
  const f = fixture();
  const before = xmlOf(f.worksheet.documentElement);
  const styles = await f.zip.file('xl/styles.xml').async('string');
  const result = await f.paint({});
  assert.equal(result.applied, false);
  assert.equal(xmlOf(f.worksheet.documentElement), before);
  assert.equal(await f.zip.file('xl/styles.xml').async('string'), styles);
});

test('cached V1 flattened work requires reanalysis instead of silently exporting the wrong layout', async () => {
  const f = fixture();
  const before = xmlOf(f.worksheet.documentElement);
  const styles = await f.zip.file('xl/styles.xml').async('string');
  await assert.rejects(f.paint({ scheduleText: '1) 예정 정비\n[외주공사] 이전에 합쳐진 작업' }));
  assert.equal(xmlOf(f.worksheet.documentElement), before);
  assert.equal(await f.zip.file('xl/styles.xml').async('string'), styles);
});

for (const [name, options] of [
  ['missing reserved row', { omitRow: 13 }],
  ['table crossing next team boundary', { electricalRow: 14 }],
  ['heading outside mechanical section', { titleRow: 3 }],
  ['duplicate mechanical table heading', { duplicateTitle: true }]
]) {
  test(`${name} aborts before modifying worksheet or styles`, async () => {
    const f = fixture(options);
    const before = xmlOf(f.worksheet.documentElement);
    const styles = await f.zip.file('xl/styles.xml').async('string');
    await assert.rejects(f.paint());
    assert.equal(xmlOf(f.worksheet.documentElement), before);
    assert.equal(await f.zip.file('xl/styles.xml').async('string'), styles);
  });
}

test('repainting is idempotent for cells, merges and style collection counts', async () => {
  const f = fixture(); await f.paint();
  const firstWorksheet = xmlOf(f.worksheet.documentElement);
  const firstStyles = await f.zip.file('xl/styles.xml').async('string');
  await f.paint();
  assert.equal(xmlOf(f.worksheet.documentElement), firstWorksheet);
  assert.equal(await f.zip.file('xl/styles.xml').async('string'), firstStyles);
});

test('final table hook follows final history and holiday saves, before worksheet serialization', () => {
  const finalHistory = source.indexOf('let finalHistoryAlignmentResultV10 =');
  const holidaySaved = source.indexOf('const holidayCofiringResult =', finalHistory);
  const hook = source.indexOf('await applyMorningMeetingOutsourcedWorkTable(', holidaySaved);
  const save = source.indexOf('zip.file(\n      worksheetPath,', holidaySaved);
  assert.ok(finalHistory >= 0 && holidaySaved > finalHistory && hook > holidaySaved && save > hook,
    'table formatting must be applied after all shifting and before worksheet serialization');
});
