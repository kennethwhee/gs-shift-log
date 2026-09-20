'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('maintenance/cofiring-solid-fuel-management-tab-v2.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('silo reference alignment override exists exactly once', () => {
  assert.equal((css.match(/SOLID FUEL SILO REFERENCE ALIGN V1 START/g) || []).length, 1);
  assert.match(css, /\.sfux15-silo-panel \.silo-summary__row,[\s\S]*min-height:\s*27px !important/);
  assert.match(css, /grid-template-columns:\s*22% 1fr auto !important/);
});

test('index cache version points to the silo align build exactly once', () => {
  assert.equal(
    (index.match(/cofiring-solid-fuel-management-tab-v2\.css\?v=20260920-silo-row-align-v1/g) || []).length,
    1
  );
});
