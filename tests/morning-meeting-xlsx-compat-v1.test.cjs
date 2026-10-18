const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('../maintenance/vendor/auxiliary-jszip-3.10.1.min.js');

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const start = source.indexOf('async function removeMorningMeetingWorkbookCalcChain(');
const end = source.indexOf('function getMorningMeetingTmMergeEndColumnForRow(', start);
assert.ok(start >= 0 && end > start);

// Small DOM fixtures keep the Windows installer dependency-free. The actual
// application supplies DOMParser/XMLSerializer; JSZip below is the real vendor.
class Element {
  constructor(namespaceURI, localName, attributes = {}, children = []) {
    this.namespaceURI = namespaceURI;
    this.localName = localName;
    this.nodeType = 1;
    this.attributes = new Map(Object.entries(attributes));
    this.childNodes = [];
    this.parentNode = null;
    children.forEach(child => this.appendChild(child));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    child.remove();
    const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    assert.ok(index >= 0, 'insertion reference must belong to the parent');
    this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    const children = this.parentNode.childNodes;
    children.splice(children.indexOf(this), 1);
    this.parentNode = null;
  }
  clone() {
    return new Element(this.namespaceURI, this.localName,
      Object.fromEntries(this.attributes), this.childNodes.map(child => child.clone()));
  }
}
class Document {
  constructor(root) { this.documentElement = root; }
  createElementNS(namespaceURI, name) { return new Element(namespaceURI, name); }
  getElementsByTagNameNS(namespaceURI, name) {
    const results = [];
    function visit(node) {
      if (node.namespaceURI === namespaceURI && node.localName === name) results.push(node);
      node.childNodes.forEach(visit);
    }
    visit(this.documentElement);
    return results;
  }
  clone() { return new Document(this.documentElement.clone()); }
}
const element = (namespace, name, attributes, children) =>
  new Element(namespace, name, attributes, children);
function xmlOf(node) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const attributes = [...node.attributes].map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
  return `<${node.localName} xmlns="${node.namespaceURI}"${attributes}>${node.childNodes.map(xmlOf).join('')}</${node.localName}>`;
}

function harness({ chain = true, registrations = chain, calcPr = true, following = [] } = {}) {
  const registry = new Map();
  const serialize = document => {
    const xml = xmlOf(document.documentElement);
    registry.set(xml, document.clone());
    return xml;
  };
  const parse = (xml, description) => {
    assert.ok(registry.has(xml), `${description}: unknown/malformed fixture XML`);
    return registry.get(xml).clone();
  };
  const workbookChildren = [
    element(MAIN, 'bookViews', {}, [element(MAIN, 'workbookView', { activeTab: '0' })]),
    element(MAIN, 'sheets', {}, [element(MAIN, 'sheet', { name: 'Report', sheetId: '4' })]),
    element(MAIN, 'definedNames', {}, [element(MAIN, 'definedName', { name: '_xlnm.Print_Area', localSheetId: '0' })])
  ];
  if (calcPr) workbookChildren.push(element(MAIN, 'calcPr', {
    calcMode: 'manual', calcId: '123', iterate: '1', iterateCount: '77', fullPrecision: '0'
  }));
  workbookChildren.push(...following.map(name => element(MAIN, name)));
  const relationships = [
    element(REL, 'Relationship', { Id: 'rId1', Type: `${REL_TYPE}worksheet`, Target: 'worksheets/sheet1.xml' }),
    element(REL, 'Relationship', { Id: 'rId2', Type: `${REL_TYPE}styles`, Target: 'styles.xml' })
  ];
  const overrides = [
    element(TYPE, 'Override', { PartName: '/xl/workbook.xml', ContentType: 'workbook-type' }),
    element(TYPE, 'Override', { PartName: '/xl/worksheets/sheet1.xml', ContentType: 'worksheet-type' })
  ];
  if (registrations) {
    relationships.push(element(REL, 'Relationship', {
      Id: 'rId7', Type: `${REL_TYPE}calcChain`, Target: 'calcChain.xml'
    }));
    overrides.push(element(TYPE, 'Override', {
      PartName: '/xl/calcChain.xml', ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml'
    }));
  }
  const zip = new JSZip();
  const add = (filename, root) => zip.file(filename, serialize(new Document(root)));
  add('xl/workbook.xml', element(MAIN, 'workbook', {}, workbookChildren));
  add('xl/_rels/workbook.xml.rels', element(REL, 'Relationships', {}, relationships));
  add('[Content_Types].xml', element(TYPE, 'Types', {}, overrides));
  if (chain) zip.file('xl/calcChain.xml', `<calcChain xmlns="${MAIN}"><c r="AE15" i="4"/><c r="J13"/></calcChain>`);
  // AE15 was a formula in the template; this represents the exported values.
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${MAIN}"><sheetData><row r="13"><c r="J13" s="7"><f>F13+F14</f><v>900</v></c></row><row r="15"><c r="AE15" s="2"><v>32.85</v></c></row></sheetData></worksheet>`);
  zip.file('xl/worksheets/sheet2.xml', '<worksheet>unchanged second worksheet</worksheet>');
  zip.file('xl/styles.xml', '<styleSheet>unchanged styles</styleSheet>');
  zip.file('xl/sharedStrings.xml', '<sst>unchanged report text</sst>');
  zip.file('xl/printerSettings/printerSettings1.bin', new Uint8Array([0, 255, 17, 34]));
  const context = vm.createContext({
    MAIN_XML_NAMESPACE: MAIN,
    parseMorningMeetingXml: parse,
    XMLSerializer: class { serializeToString(document) { return serialize(document); } }
  });
  vm.runInContext(source.slice(start, end), context);
  return { zip, context, parse, serialize, add };
}
async function readDocument(h, filename) {
  return h.parse(await h.zip.file(filename).async('string'), filename);
}
async function contents(zip) {
  const files = {};
  for (const name of Object.keys(zip.files).filter(name => !zip.files[name].dir)) {
    files[name] = await zip.file(name).async('nodebuffer');
  }
  return files;
}

test('final export removes the stale chain, relationship, and override together', async () => {
  const h = harness();
  const before = await contents(h.zip);
  await h.context.forceMorningMeetingWorkbookRecalculation(h.zip);
  assert.equal(h.zip.file('xl/calcChain.xml'), null);
  const rel = await readDocument(h, 'xl/_rels/workbook.xml.rels');
  assert.deepEqual(rel.documentElement.childNodes.map(node => node.getAttribute('Id')), ['rId1', 'rId2']);
  const types = await readDocument(h, '[Content_Types].xml');
  assert.deepEqual(types.documentElement.childNodes.map(node => node.getAttribute('PartName')),
    ['/xl/workbook.xml', '/xl/worksheets/sheet1.xml']);
  const reopened = await JSZip.loadAsync(await h.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), { checkCRC32: true });
  for (const [name, value] of Object.entries(before)) {
    if (['xl/calcChain.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml'].includes(name)) continue;
    assert.deepEqual(await reopened.file(name).async('nodebuffer'), value, `${name} must stay byte-identical`);
  }
});

test('full recalculation preserves other calculation settings, views, and print definitions', async () => {
  const h = harness();
  const before = await readDocument(h, 'xl/workbook.xml');
  await h.context.forceMorningMeetingWorkbookRecalculation(h.zip);
  const after = await readDocument(h, 'xl/workbook.xml');
  const calc = after.getElementsByTagNameNS(MAIN, 'calcPr')[0];
  assert.deepEqual(Object.fromEntries(calc.attributes), {
    calcMode: 'auto', calcId: '0', iterate: '1', iterateCount: '77', fullPrecision: '0',
    fullCalcOnLoad: '1', forceFullCalc: '1'
  });
  for (const name of ['bookViews', 'sheets', 'definedNames']) {
    assert.equal(xmlOf(after.getElementsByTagNameNS(MAIN, name)[0]), xmlOf(before.getElementsByTagNameNS(MAIN, name)[0]));
  }
});

test('repeated finalization is idempotent', async () => {
  const h = harness();
  await h.context.forceMorningMeetingWorkbookRecalculation(h.zip);
  const once = await contents(h.zip);
  await h.context.forceMorningMeetingWorkbookRecalculation(h.zip);
  assert.deepEqual(await contents(h.zip), once);
});

test('a chain-free workbook keeps relationships and content types byte-identical', async () => {
  const h = harness({ chain: false });
  const before = await contents(h.zip);
  await h.context.forceMorningMeetingWorkbookRecalculation(h.zip);
  for (const name of ['xl/_rels/workbook.xml.rels', '[Content_Types].xml']) {
    assert.deepEqual(await h.zip.file(name).async('nodebuffer'), before[name]);
  }
});

test('stale package registrations are removed even if the chain part is already absent', async () => {
  const h = harness({ chain: false, registrations: true });
  await h.context.forceMorningMeetingWorkbookRecalculation(h.zip);
  assert.equal((await readDocument(h, 'xl/_rels/workbook.xml.rels')).documentElement.childNodes.length, 2);
  assert.equal((await readDocument(h, '[Content_Types].xml')).documentElement.childNodes.length, 2);
});

test('an unregistered chain part is removed without changing unrelated registrations', async () => {
  const h = harness({ chain: true, registrations: false });
  const before = await contents(h.zip);
  await h.context.forceMorningMeetingWorkbookRecalculation(h.zip);
  assert.equal(h.zip.file('xl/calcChain.xml'), null);
  for (const name of ['xl/_rels/workbook.xml.rels', '[Content_Types].xml']) {
    assert.deepEqual(await h.zip.file(name).async('nodebuffer'), before[name]);
  }
});

for (const following of ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr',
  'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']) {
  test(`missing calcPr is inserted before ${following} without moving other elements`, async () => {
    const h = harness({ calcPr: false, following: [following] });
    await h.context.forceMorningMeetingWorkbookRecalculation(h.zip);
    const document = await readDocument(h, 'xl/workbook.xml');
    assert.deepEqual(document.documentElement.childNodes.map(node => node.localName),
      ['bookViews', 'sheets', 'definedNames', 'calcPr', following]);
  });
}

test('missing calcPr is appended after defined names when no later schema element exists', async () => {
  const h = harness({ calcPr: false });
  await h.context.forceMorningMeetingWorkbookRecalculation(h.zip);
  assert.deepEqual((await readDocument(h, 'xl/workbook.xml')).documentElement.childNodes.map(node => node.localName),
    ['bookViews', 'sheets', 'definedNames', 'calcPr']);
});

test('missing workbook metadata aborts rather than claiming successful finalization', async () => {
  const h = harness();
  h.zip.remove('xl/workbook.xml');
  await assert.rejects(h.context.forceMorningMeetingWorkbookRecalculation(h.zip), /workbook\.xml/);
});

test('malformed relationship metadata aborts the export', async () => {
  const h = harness();
  h.zip.file('xl/_rels/workbook.xml.rels', '<bad XML');
  await assert.rejects(h.context.forceMorningMeetingWorkbookRecalculation(h.zip), /malformed fixture XML/);
});

test('the production finalizer is awaited before ZIP generation in the export flow', () => {
  const exportStart = source.indexOf('async function createMorningMeetingWorkbook(');
  const finalizer = source.indexOf('await forceMorningMeetingWorkbookRecalculation(', exportStart);
  const generate = source.indexOf('await zip.generateAsync(', exportStart);
  assert.ok(exportStart >= 0 && finalizer > exportStart && generate > finalizer);
  assert.match(source.slice(start, end), /await removeMorningMeetingWorkbookCalcChain\(zip\)/);
});
