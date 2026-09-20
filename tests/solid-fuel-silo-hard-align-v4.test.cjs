'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('maintenance/solid-fuel-trouble.html', 'utf8');

test('V4 hard-align style is present exactly once in the iframe HTML', () => {
  assert.equal((html.match(/id="sf-silo-cell-hard-align-v4"/g) || []).length, 1);
});

test('V4 forces exact 28px three-cell row', () => {
  assert.match(html, /#siloStats \.silo-summary__row\{[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
  assert.match(html, /#siloStats \.silo-summary__row\{[\s\S]*height:28px!important/);
  assert.match(html, /#siloStats \.silo-summary__row\{[\s\S]*max-height:28px!important/);
});

test('V4 centers each direct child in both axes and neutralizes positioning', () => {
  assert.match(html, /#siloStats \.silo-summary__row > span,[\s\S]*align-items:center!important/);
  assert.match(html, /#siloStats \.silo-summary__row > span,[\s\S]*justify-content:center!important/);
  assert.match(html, /#siloStats \.silo-summary__row > span,[\s\S]*position:static!important/);
  assert.match(html, /#siloStats \.silo-summary__row > span,[\s\S]*transform:none!important/);
});

test('V4 uses internal vertical separators like a table row', () => {
  assert.match(html, /border-right:1px solid #dbe4ed!important/);
  assert.match(html, /#siloStats \.silo-summary__row > small\{\s*border-right:0!important/);
});
