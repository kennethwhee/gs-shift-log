'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('V7 makes each heating-value card narrower', () => {
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(145px,180px\)\)!important/);
  assert.match(css, /justify-content:start!important/);
});

test('V7 makes each heating-value card shorter', () => {
  assert.match(css, /\.cfh-v5-fuel-item[\s\S]*min-height:38px!important/);
  assert.match(css, /\.cfh-v5-fuel-item[\s\S]*padding:5px 9px!important/);
});

test('V7 slightly enlarges operator-facing text', () => {
  assert.match(css, /\.cfh-v5-strip-title-main[\s\S]*font-size:17px!important/);
  assert.match(css, /\.cfh-v5-strip-title-sub[\s\S]*font-size:12px!important/);
  assert.match(css, /\.cfh-v5-fuel-name[\s\S]*font-size:14px!important/);
  assert.match(css, /\.cfh-v5-fuel-value[\s\S]*font-size:20px!important/);
  assert.match(css, /\.cfh-v5-fuel-unit[\s\S]*font-size:11px!important/);
});

test('V7 bumps only the CSS cache while keeping V5 JS', () => {
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.css\?v=20260920-operator-detail-v7/g) || []).length,
    1
  );
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.js\?v=20260920-operator-detail-v5/g) || []).length,
    1
  );
});
