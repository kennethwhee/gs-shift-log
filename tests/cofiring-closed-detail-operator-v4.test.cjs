'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.js', 'utf8');
const css = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('V4 filters the duplicated tbody header row from basis data', () => {
  assert.match(js, /if \(!first \|\| first === "연료"\) return false/);
  assert.match(js, /isRepeatedHeader/);
});

test('V4 uses a compact one-header calculation grid', () => {
  assert.match(css, /\.cfh-v4-basis-grid/);
  assert.match(css, /\.cfh-v4-cell--head[\s\S]*height:34px!important/);
  assert.match(css, /\.cfh-v4-cell[\s\S]*height:39px!important/);
});

test('V4 replaces large metadata tiles with a vertical summary', () => {
  assert.match(js, /cfh-v4-summary-row/);
  assert.match(css, /grid-template-columns:112px minmax\(0,1fr\)!important/);
  assert.match(css, /min-height:37px!important/);
});

test('V4 keeps calculation navigation as one compact control', () => {
  assert.match(js, /metaData\.calcControl\.textContent = "계산 화면 보기"/);
  assert.match(css, /min-height:32px!important/);
  assert.match(css, /justify-content:flex-end!important/);
});

test('V4 cache versions exist exactly once', () => {
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.css\?v=20260920-operator-detail-v4/g) || []).length,
    1
  );
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.js\?v=20260920-operator-detail-v4/g) || []).length,
    1
  );
});
