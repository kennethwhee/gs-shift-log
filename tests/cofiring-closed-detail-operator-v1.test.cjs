'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.js', 'utf8');
const css = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('operator detail enhancer targets only the closed detail semantics', () => {
  assert.match(js, /#efficiencyCofiringDraftView/);
  assert.match(js, /마감 당시 발열량 · 보정계수/);
  assert.match(js, /마감 계산 기준값/);
  assert.match(js, /마감 정보/);
  assert.match(js, /DataPARC 요청/);
  assert.match(js, /계산 화면 보기/);
});

test('detail cards are equal-width, equal-height and compact for operator review', () => {
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(css, /align-items:stretch!important/);
  assert.match(css, /\.cfh-operator-detail-card[\s\S]*height:100%!important/);
  assert.match(css, /\.cfh-operator-basis-table[\s\S]*table-layout:fixed!important/);
  assert.match(css, /height:44px!important/);
});

test('cache loaders exist exactly once', () => {
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.css\?v=20260920-operator-detail-v1/g) || []).length,
    1
  );
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.js\?v=20260920-operator-detail-v1/g) || []).length,
    1
  );
});
