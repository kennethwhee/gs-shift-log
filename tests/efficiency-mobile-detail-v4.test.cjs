const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../maintenance/efficiency-mobile-menu-v1.js');
const summary = {unit1: {coal: 483.809, bio: 522.141}, unit2: {coal: 755.539, bio: 0}, combined: {totalRatio: 25.84}};
const record = (item = {}) => ({item: {targetDate: '2026-10-29', ...item}, summary, estimated: false});

test('saved CLEAR/original state wins over stale adjusted snapshot and adjustment object', () => {
  const row = record({adjustmentApplied: false, adjustment: {}, snapshot: {result: {adjustment: {applied: true}}}});
  assert.equal(api.adjustmentState(row.item), false);
  for (const html of [api.recordMarkup(row), api.historyMarkup([row])]) {
    assert.match(html, /gsm-source-badge--original">원본/);
    assert.doesNotMatch(html, /gsm-source-badge--adjusted|gsm-history-adjusted/);
  }
});
test('saved adjustment is marked consistently without altering numeric values or record', () => {
  const row = record({adjustmentApplied: true});
  const before = JSON.stringify(row);
  const html = api.recordMarkup(row);
  assert.match(html, /gsm-source-badge--adjusted">조정/);
  assert.match(html, /25\.84%/); assert.match(html, /483\.809/); assert.match(html, /0\.000/);
  const history = api.historyMarkup([row]);
  assert.match(history, /gsm-history-adjusted/); assert.match(history, /gsm-source-badge--adjusted">조정/);
  assert.equal(JSON.stringify(row), before);
});
test('effective result metadata takes precedence and missing metadata is not guessed as original', () => {
  assert.equal(api.adjustmentState({effectiveResult: {adjustment: {applied: false}}, snapshot: {result: {adjustment: {applied: true}}}}), false);
  assert.equal(api.adjustmentState({effectiveResult: {}, snapshot: {result: {adjustment: {applied: true}}}}), null);
  assert.equal(api.adjustmentState({adjustment: {}}), null);
  assert.match(api.recordMarkup(record()), /상태 미확인/);
  assert.doesNotMatch(api.recordMarkup(record()), /gsm-source-badge--original/);
});
test('estimated data keeps its yellow approximation and is not labelled original', () => {
  const row = {...record(), estimated: true};
  const html = api.recordMarkup(row);
  assert.match(html, /gsm-estimated/); assert.match(html, /≈ 25\.84%/);
  assert.match(html, /추정 저장 · 미확정/);
  assert.doesNotMatch(html, /gsm-source-badge--original|상태 미확인/);
  assert.match(api.historyMarkup([row]), /추정 · 미확정/);
});
test('history labels cannot inject markup and empty history remains readable', () => {
  const html = api.historyMarkup([record({targetDate: '<img src=x onerror=alert(1)>'})]);
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
  assert.match(api.historyMarkup([]), /저장된 마감·추정 자료가 없습니다/);
});
