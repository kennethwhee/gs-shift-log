'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('maintenance/solid-fuel-trouble.html', 'utf8');
const css = fs.readFileSync('maintenance/solid-fuel-silo-cell-align-v3.css', 'utf8');

test('V3 is loaded after V2 in the Solid Fuel iframe', () => {
  const v2 = html.indexOf('solid-fuel-silo-row-align-v2.css?v=20260920-silo-row-align-v2');
  const v3 = html.indexOf('solid-fuel-silo-cell-align-v3.css?v=20260920-silo-cell-align-v3');
  assert.ok(v2 >= 0);
  assert.ok(v3 > v2);
});

test('silo row is split into three equal cells', () => {
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
  assert.match(css, /min-height:28px!important/);
  assert.match(css, /height:28px!important/);
});

test('all three silo values are centered in both axes', () => {
  assert.match(css, /\.silo-summary__row > span,[\s\S]*align-items:center!important/);
  assert.match(css, /\.silo-summary__row > span,[\s\S]*justify-content:center!important/);
  assert.match(css, /\.silo-summary__row > span,[\s\S]*text-align:center!important/);
});

test('internal dividers make the row read like table cells', () => {
  assert.match(css, /border-right:1px solid #dbe4ed!important/);
  assert.match(css, /\.silo-summary__row > small\{\s*border-right:0!important/);
});
