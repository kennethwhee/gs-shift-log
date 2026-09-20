'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('V6 enlarges the heating-basis title and subtitle', () => {
  assert.match(css, /\.cfh-v5-strip-title-main[\s\S]*font-size:16px!important/);
  assert.match(css, /\.cfh-v5-strip-title-sub[\s\S]*font-size:11px!important/);
});

test('V6 enlarges fuel labels, values and units', () => {
  assert.match(css, /\.cfh-v5-fuel-name[\s\S]*font-size:13px!important/);
  assert.match(css, /\.cfh-v5-fuel-value[\s\S]*font-size:19px!important/);
  assert.match(css, /\.cfh-v5-fuel-unit[\s\S]*font-size:10px!important/);
});

test('V6 keeps the row compact but more readable', () => {
  assert.match(css, /\.cfh-v5-fuel-item[\s\S]*min-height:52px!important/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
});

test('V6 CSS cache is bumped and JS remains on V5', () => {
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.css\?v=20260920-operator-detail-v6/g) || []).length,
    1
  );
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.js\?v=20260920-operator-detail-v5/g) || []).length,
    1
  );
});
