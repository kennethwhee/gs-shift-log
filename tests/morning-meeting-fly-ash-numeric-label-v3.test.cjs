const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function between(startName, endName) {
  const start = source.indexOf(`function ${startName}(`);
  const end = source.indexOf(`function ${endName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `${startName} must exist`);
  return source.slice(start, end);
}

function loadParser() {
  const writes = new Map();
  const context = vm.createContext({
    getMorningMeetingWorkbookState: () => ({}),
    setMorningMeetingNumericCellValue: (_document, address, value) => {
      writes.set(address, value);
      return { found: true, written: value != null, cleared: value == null };
    }
  });
  vm.runInContext([
    between('getCellNumber', 'getCellEntries'),
    between('extractNumericValues', 'formatNumber'),
    between('applyMorningMeetingCoalNumericValues', 'getMorningMeetingPrimaryMergeEndColumnForRow')
  ].join('\n'), context);
  return { context, writes };
}

// Exact relevant cell values from the user's 업무일지 10.18.xlsx,
// sheet '연료설비 운전일지'. K47 is a vehicle-type label, not kg.
function october18Worksheet() {
  return {
    G46: { t: 's', v: '반출차량 / 대' },
    K46: { t: 'n', v: 3 },
    K47: { t: 's', v: 'Tank Lorry' },
    G48: { t: 's', v: '반출량 Scale / kg' },
    K48: { t: 'n', v: 104180 },
    K51: { t: 'n', v: 813 }
  };
}

test('uploaded October 18 layout reads 3 trucks and 104.18 tons from K48', () => {
  const { context } = loadParser();
  const values = context.extractNumericValues(october18Worksheet());
  assert.equal(values.flyAshDispatch.vehicles, 3);
  assert.equal(values.flyAshDispatch.quantityKg, 104180);
  assert.equal(values.flyAshDispatch.quantityTon, 104.18);
});

test('uploaded source values reach final workbook cells X21 and X22', () => {
  const { context, writes } = loadParser();
  context.applyMorningMeetingCoalNumericValues(
    {}, context.extractNumericValues(october18Worksheet())
  );
  assert.equal(writes.get('X21'), 3);
  assert.equal(writes.get('X22'), 104.18);
});

test('alternate layout with numeric K47 still uses its kg value', () => {
  const { context } = loadParser();
  const worksheet = october18Worksheet();
  worksheet.K47 = { t: 'n', v: 391410 };
  assert.equal(context.extractNumericValues(worksheet).flyAshDispatch.quantityTon, 391.41);
});

test('actual zero in K47 stays zero instead of falling back to a stale K48', () => {
  const { context } = loadParser();
  const worksheet = october18Worksheet();
  for (const value of [0, '0']) {
    worksheet.K47 = { v: value };
    assert.equal(context.extractNumericValues(worksheet).flyAshDispatch.quantityTon, 0);
  }
});

test('blank, text, boolean, and error cells are missing values rather than zero', () => {
  const { context } = loadParser();
  for (const cell of [
    undefined, {}, { v: null }, { v: '' }, { v: '  ' },
    { v: 'Tank Lorry' }, { v: '미입력' }, { v: '-' },
    { v: '\u00a0' }, { t: 'b', v: false }, { t: 'e', v: 7, w: '#DIV/0!' }
  ]) {
    assert.equal(context.getCellNumber({ K47: cell }, 'K47'), null, JSON.stringify(cell));
  }
});

test('formatted numeric quantities and actual numeric zero remain readable', () => {
  const { context } = loadParser();
  assert.equal(context.getCellNumber({ K48: { v: '104,180 kg' } }, 'K48'), 104180);
  assert.equal(context.getCellNumber({ K48: { v: 0, w: '-' } }, 'K48'), 0);
});

test('missing tonnage stays blank in the export while a known truck count survives', () => {
  const { context, writes } = loadParser();
  const worksheet = october18Worksheet();
  worksheet.K48 = { v: '' };
  const values = context.extractNumericValues(worksheet);
  assert.equal(values.flyAshDispatch.quantityKg, null);
  assert.equal(values.flyAshDispatch.quantityTon, null);
  context.applyMorningMeetingCoalNumericValues({}, values);
  assert.equal(writes.get('X21'), 3);
  assert.equal(writes.get('X22'), null);
});
