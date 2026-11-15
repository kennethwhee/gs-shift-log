'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Actual source section missing: ${start}`);
  return source.slice(first, last);
}

const getter = section('function getLimestoneData() {', '  function getGearPinionData()');
const renderer = section('function renderLimestonePreview(', '  function renderGearPinionPreview(');
const badge = section('  function setBadge(', '/* =====================================================\n  오전회의 자동자료 기준일');
const overall = section('function renderOverallStatus(', 'function renderPreview()');
const DATE = '2026-11-14';

function element(value = '') {
  const classes = new Set();
  return {
    value, textContent: value, dataset: {},
    classList: {add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)}
  };
}

function harness(rawStatus = 'complete') {
  const elements = {
    limestoneSourceDate: element(DATE),
    limestoneSourceView: element(),
    limestoneUnitOneStart: element('365.89'), limestoneUnitOneEnd: element('382.50'),
    limestoneUnitOneReceipt: element('61.24'), limestoneUnitOneUsage: element('44.62'),
    limestoneUnitTwoStart: element('383.25'), limestoneUnitTwoEnd: element('372.83'),
    limestoneUnitTwoReceipt: element('30.22'), limestoneUnitTwoUsage: element('40.63'),
    limestoneDate: element(), limestoneStatus: element(),
    limestoneUnitOneStock: element(), limestoneUnitTwoStock: element(),
    limestoneReceiptUnitOne: element(), limestoneReceiptUnitTwo: element(),
    limestoneUsageUnitOne: element(), limestoneUsageUnitTwo: element(),
    overallStatus: element(), preview: element()
  };
  elements.limestoneSourceView.dataset.limestoneUsageStatus = rawStatus;
  const context = vm.createContext({
    window: {}, getElements: () => elements, getExpectedPreviousDate: () => DATE,
    normalizeText: value => String(value ?? '').trim(),
    parseNumber: value => value == null || value === '' ? null : Number(value),
    formatLimestoneNumber: value => Number(value).toFixed(2),
    setText: (node, value) => {if (node) node.textContent = String(value ?? '-');}
  });
  vm.runInContext(getter + '\n' + badge + '\n' + renderer + '\n' + overall, context);
  const render = () => {
    const data = context.getLimestoneData();
    context.renderLimestonePreview(data);
    context.renderOverallStatus({status:'complete'}, data, {status:'complete'}, {status:'complete'});
    return data;
  };
  return {context, elements, render};
}

test('verified complete limestone values retain the normal green completion badge', () => {
  const h = harness(), data = h.render();
  assert.equal(data.status, 'complete');
  assert.equal(data.needsStatusCheck, false);
  assert.equal(h.elements.limestoneStatus.textContent, '계산 완료');
  assert.equal(h.elements.limestoneStatus.classList.contains('is-complete'), true);
  assert.equal(h.elements.overallStatus.classList.contains('is-complete'), true);
});

test('a failed fresh query followed by old saved values cannot become green completion', () => {
  const h = harness('complete');
  h.render();
  assert.equal(h.elements.limestoneStatus.classList.contains('is-complete'), true);
  h.elements.limestoneSourceView.dataset.limestoneUsageStatus = 'warning';
  h.elements.limestoneSourceView.dataset.title = '재계산 실패 · 기존 저장값 표시';
  const before = JSON.stringify(h.elements.limestoneSourceView.dataset);
  const data = h.render();
  assert.equal(data.status, 'error');
  assert.equal(data.needsStatusCheck, true);
  assert.equal(h.elements.limestoneStatus.textContent, '조회 확인 필요');
  assert.equal(h.elements.limestoneStatus.classList.contains('is-complete'), false);
  assert.equal(h.elements.limestoneStatus.classList.contains('is-error'), true);
  assert.equal(h.elements.overallStatus.textContent, '확인 필요');
  assert.equal(h.elements.preview.dataset.limestoneStatus, 'error');
  assert.equal(data.unitOneStart, 365.89);
  assert.equal(data.unitOneUsage, 44.62);
  assert.equal(data.unitTwoUsage, 40.63);
  assert.equal(h.elements.limestoneUsageUnitOne.textContent, '44.62 t');
  assert.equal(h.elements.limestoneUsageUnitTwo.textContent, '40.63 t');
  assert.equal(JSON.stringify(h.elements.limestoneSourceView.dataset), before);
});

test('a saved same-request result awaiting confirmation keeps an attention label without asserting failure', () => {
  const h = harness('warning');
  h.elements.limestoneSourceView.dataset.title = '사용량 저장 확인 · 요청 상태 확인 필요';
  h.render();
  assert.equal(h.elements.limestoneStatus.textContent, '조회 확인 필요');
  assert.equal(h.elements.limestoneSourceView.dataset.title, '사용량 저장 확인 · 요청 상태 확인 필요');
  assert.equal(h.elements.limestoneStatus.textContent.includes('실패'), false);
});

test('warning still needs confirmation when some old values are unavailable', () => {
  const h = harness('warning');
  h.elements.limestoneUnitTwoUsage.textContent = '';
  const data = h.render();
  assert.equal(data.status, 'error');
  assert.equal(data.unitTwoUsage, null);
  assert.equal(h.elements.limestoneStatus.textContent, '조회 확인 필요');
  assert.equal(h.elements.limestoneUsageUnitTwo.textContent, '-');
  assert.equal(h.elements.limestoneUsageUnitOne.textContent, '44.62 t');
});

test('ordinary errors retain the failure label even when saved values remain visible', () => {
  const h = harness('error'), data = h.render();
  assert.equal(data.status, 'error');
  assert.equal(data.needsStatusCheck, false);
  assert.equal(h.elements.limestoneStatus.textContent, '조회 실패');
  assert.equal(h.elements.limestoneUsageUnitOne.textContent, '44.62 t');
});

for (const [status, label] of [['loading', '조회 중'], ['restoring', '저장값 불러오는 중']]) {
  test(`${status} is not promoted by existing complete values`, () => {
    const h = harness(status), data = h.render();
    assert.equal(data.status, 'loading');
    assert.equal(h.elements.limestoneStatus.textContent, label);
    assert.equal(h.elements.limestoneStatus.classList.contains('is-complete'), false);
  });
}

test('incomplete idle data remain pending', () => {
  const h = harness('idle');
  h.elements.limestoneUnitOneStart.value = '';
  const data = h.render();
  assert.equal(data.status, 'idle');
  assert.equal(h.elements.limestoneStatus.textContent, '계산 대기');
});

test('a date mismatch retains priority over a source warning', () => {
  const h = harness('warning');
  h.elements.limestoneSourceDate.value = '2026-11-13';
  const data = h.render();
  assert.equal(data.status, 'error');
  assert.equal(data.hasDateMismatch, true);
  assert.equal(h.elements.limestoneStatus.textContent, '날짜 확인');
});

test('an active selected-date reset continues to mask saved limestone values', () => {
  const h = harness('warning');
  h.context.window.isMorningMeetingSelectedDateResetActive = () => true;
  const data = h.render();
  assert.equal(data.status, 'idle');
  assert.equal(data.unitOneUsage, null);
  assert.equal(data.unitTwoUsage, null);
  assert.equal(h.elements.limestoneStatus.textContent, '계산 대기');
});
