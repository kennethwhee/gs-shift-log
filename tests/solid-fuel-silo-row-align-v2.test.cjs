'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('maintenance/solid-fuel-trouble.html', 'utf8');
const css = fs.readFileSync('maintenance/solid-fuel-silo-row-align-v2.css', 'utf8');

test('iframe loads the silo-row alignment stylesheet after native redesign', () => {
  const nativePos = html.indexOf('solid-fuel-native-redesign-v21.css');
  const alignPos = html.indexOf('solid-fuel-silo-row-align-v2.css?v=20260920-silo-row-align-v2');
  assert.ok(nativePos >= 0);
  assert.ok(alignPos > nativePos);
});

test('silo row matches the compact company row height', () => {
  assert.match(css, /\.silo-summary__row[\s\S]*min-height:28px!important/);
  assert.match(css, /\.silo-summary__row[\s\S]*height:28px!important/);
  assert.match(css, /\.silo-summary__row[\s\S]*padding:3px 9px!important/);
});

test('silo row uses compact three-column alignment', () => {
  assert.match(css, /grid-template-columns:22% 1fr auto!important/);
  assert.match(css, /\.silo-summary__row strong[\s\S]*font-size:12px!important/);
});
