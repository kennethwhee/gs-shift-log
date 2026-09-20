'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('V8 substantially reduces outer vertical padding', () => {
  assert.match(css, /\.cfh-v5-basis-card[\s\S]*padding:3px 8px!important/);
});

test('V8 substantially reduces heating-value card height', () => {
  assert.match(css, /\.cfh-v5-fuel-item[\s\S]*min-height:30px!important/);
  assert.match(css, /\.cfh-v5-fuel-item[\s\S]*padding:2px 8px!important/);
});

test('V8 keeps the larger V7 typography', () => {
  assert.match(css, /\.cfh-v5-strip-title-main[\s\S]*font-size:17px!important/);
  assert.match(css, /\.cfh-v5-fuel-name[\s\S]*font-size:14px!important/);
  assert.match(css, /\.cfh-v5-fuel-value[\s\S]*font-size:20px!important/);
  assert.match(css, /\.cfh-v5-fuel-unit[\s\S]*font-size:11px!important/);
});

test('V8 bumps only CSS cache while keeping V5 JS', () => {
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.css\?v=20260920-operator-detail-v8/g) || []).length,
    1
  );
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.js\?v=20260920-operator-detail-v5/g) || []).length,
    1
  );
});
