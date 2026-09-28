const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tagName, namespaceURI = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main') {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this._text = '';
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    if (!before) this.children.push(child);
    else {
      const index = this.children.indexOf(before);
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
    }
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  get textContent() {
    if (this.children.length) return this.children.map((child) => child.textContent).join('');
    return this._text;
  }
  set textContent(value) {
    this._text = String(value ?? '');
    this.children = [];
  }
}

class Document {
  constructor() {
    this.documentElement = new Element('worksheet');
  }
  createElementNS(ns, name) { return new Element(name, ns); }
  getElementsByTagNameNS(ns, name) { return this._all().filter((item) => item.tagName === name); }
  getElementsByTagName(name) { return this._all().filter((item) => item.tagName === name); }
  _all() {
    const result = [];
    const visit = (node) => {
      result.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this.documentElement);
    return result;
  }
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function cellAddress(column, row) { return `${column}${row}`; }

function addInlineCell(document, row, column, text, style = '1') {
  const sheetData = document.getElementsByTagNameNS(NS, 'sheetData')[0];
  let rowElement = document.getElementsByTagNameNS(NS, 'row').find((item) => Number(item.getAttribute('r')) === row);
  if (!rowElement) {
    rowElement = document.createElementNS(NS, 'row');
    rowElement.setAttribute('r', row);
    const next = sheetData.children.find((item) => Number(item.getAttribute('r')) > row) || null;
    sheetData.insertBefore(rowElement, next);
  }
  const cell = document.createElementNS(NS, 'c');
  cell.setAttribute('r', cellAddress(column, row));
  cell.setAttribute('s', style);
  cell.setAttribute('t', 'inlineStr');
  const is = document.createElementNS(NS, 'is');
  const t = document.createElementNS(NS, 't');
  t.textContent = text;
  is.appendChild(t);
  cell.appendChild(is);
  rowElement.appendChild(cell);
  return cell;
}

function addMerge(document, ref) {
  const mergeCells = document.getElementsByTagNameNS(NS, 'mergeCells')[0];
  const merge = document.createElementNS(NS, 'mergeCell');
  merge.setAttribute('ref', ref);
  mergeCells.appendChild(merge);
  mergeCells.setAttribute('count', String(mergeCells.children.length));
  return merge;
}

function createWorksheet() {
  const document = new Document();
  const dimension = document.createElementNS(NS, 'dimension');
  dimension.setAttribute('ref', 'B1:AO40');
  const sheetData = document.createElementNS(NS, 'sheetData');
  const mergeCells = document.createElementNS(NS, 'mergeCells');
  mergeCells.setAttribute('count', '0');
  document.documentElement.appendChild(dimension);
  document.documentElement.appendChild(sheetData);
  document.documentElement.appendChild(mergeCells);

  // Title row: side-by-side Bio and power-price tables.
  addInlineCell(document, 25, 'B', 'Bio / 유기성 고형연료 혼소율(%)');
  addMerge(document, 'B25:AD25');
  addInlineCell(document, 25, 'AE', '전일 전력 단가 [원/KWh]');
  addMerge(document, 'AE25:AO25');

  // Bio currently wrong: 09/16 ~ 09/20.
  const bioColumns = ['E', 'J', 'O', 'T', 'Y'];
  ['09월 16일', '09월 17일', '09월 18일', '09월 19일', '09월 20일'].forEach((text, index) => {
    addInlineCell(document, 26, bioColumns[index], text);
  });

  // Power header is already correct and must stay in place.
  addInlineCell(document, 26, 'AE', 'Date');
  addInlineCell(document, 26, 'AH', '최대');
  addInlineCell(document, 26, 'AK', '최소');
  addInlineCell(document, 26, 'AN', '평균');
  addMerge(document, 'AE26:AG26');
  addMerge(document, 'AH26:AJ26');
  addMerge(document, 'AK26:AM26');
  addMerge(document, 'AN26:AO26');

  // Bio body has four rows.
  const body = [
    ['#1 BLR', 'OLD1'],
    ['#2 BLR', 'OLD2'],
    ['Average', 'OLD3'],
    ['Total', 'OLD4']
  ];
  body.forEach(([label, value], index) => {
    const row = 27 + index;
    addInlineCell(document, row, 'B', label);
    bioColumns.forEach((column) => addInlineCell(document, row, column, value));
  });

  // Power has five daily rows, 09/17 ~ 09/21.
  const powerDates = ['09/17', '09/18', '09/19', '09/20', '09/21'];
  powerDates.forEach((date, index) => {
    const row = 27 + index;
    addInlineCell(document, row, 'AE', date);
    addInlineCell(document, row, 'AH', String(117 + index));
    addInlineCell(document, row, 'AK', String(95 + index));
    addInlineCell(document, row, 'AN', String(103 + index));
  });

  // The fifth power row currently shares the row with the next operation section.
  addInlineCell(document, 31, 'B', '1. 설비 운영팀');
  addMerge(document, 'B31:AD31');
  addInlineCell(document, 32, 'B', '◇ 교대 파트');
  addMerge(document, 'B32:AO32');

  return { document, bioColumns };
}

function findCell(document, address) {
  return document.getElementsByTagNameNS(NS, 'c').find((cell) => cell.getAttribute('r') === address) || null;
}

function textOf(cell) {
  if (!cell) return '';
  const inline = cell.children.find((child) => child.tagName === 'is');
  if (inline) return inline.textContent;
  return cell.textContent || '';
}

function mergeRefs(document) {
  return document.getElementsByTagNameNS(NS, 'mergeCell').map((item) => item.getAttribute('ref'));
}

function loadHelper(windowObject) {
  const helperPath = path.join(__dirname, '..', 'maintenance', 'morning-meeting-final-history-alignment-v10.js');
  const code = fs.readFileSync(helperPath, 'utf8');
  vm.runInNewContext(code, { window: windowObject, console, Date, Number, String, Array, Object, Math, RegExp, Promise });
}

test('aligns Bio title to two rows and mirrors 09/17~09/21 from power-price dates', async () => {
  const { document, bioColumns } = createWorksheet();
  const loadedDates = [];
  const windowObject = {
    morningMeetingClosedCofiring: {
      targetDate: () => '2026-09-21',
      load: async (date) => {
        loadedDates.push(date);
        const day = Number(date.slice(-2));
        return {
          unitOne: { bioRatio: day, organicRatio: day / 10, totalRatio: day + 1 },
          unitTwo: { bioRatio: day + 2, organicRatio: day / 10 + 0.2, totalRatio: day + 3 }
        };
      }
    }
  };
  loadHelper(windowObject);

  const result = await windowObject.applyMorningMeetingFinalHistoryAlignmentV10(document, []);

  assert.equal(result.enabled, true);
  assert.equal(result.rowDelta, 1);
  assert.equal(result.layoutAligned, true);
  assert.deepEqual(Array.from(result.bioDates), [
    '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'
  ]);
  assert.deepEqual(loadedDates, [
    '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'
  ]);

  assert.ok(mergeRefs(document).includes('B25:AD26'), 'Bio title must be vertically merged across two rows');
  assert.equal(textOf(findCell(document, 'AE26')), 'Date', 'power header must stay on its existing row');
  assert.equal(textOf(findCell(document, 'AE27')), '09/17');
  assert.equal(textOf(findCell(document, 'AE31')), '09/21');
  assert.equal(textOf(findCell(document, 'B32')), '1. 설비 운영팀', 'operation section must shift down one row');

  const expectedBioLabels = ['09월 17일', '09월 18일', '09월 19일', '09월 20일', '09월 21일'];
  bioColumns.forEach((column, index) => {
    assert.equal(textOf(findCell(document, `${column}27`)), expectedBioLabels[index]);
  });

  assert.equal(textOf(findCell(document, 'E28')), '17.00 / 1.70');
  assert.equal(textOf(findCell(document, 'E29')), '19.00 / 1.90');
  assert.equal(textOf(findCell(document, 'E30')), '18.00 / 1.80');
  assert.equal(textOf(findCell(document, 'E31')), '19.00');
});

test('patched repository keeps V10 hook in the real final workbook owner and accounts for print-area row delta', () => {
  const repo = path.join(__dirname, '..');
  const script = fs.readFileSync(path.join(repo, 'script.js'), 'utf8');
  const index = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

  assert.equal((script.match(/MORNING MEETING FINAL HISTORY ALIGNMENT V10/g) || []).length, 1);
  assert.match(script, /await\s+window\.applyMorningMeetingFinalHistoryAlignmentV10\s*\(/);
  assert.match(script, /finalHistoryAlignmentResultV10\?\.rowDelta/);
  assert.equal((index.match(/morning-meeting-final-history-alignment-v10\.js/g) || []).length, 1);
  assert.match(index, /finalHistoryAlign=20260929-v10/);
});
