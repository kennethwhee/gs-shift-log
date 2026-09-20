'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('maintenance/cofiring-bio-target-label-emphasis-v1.js', 'utf8');
const css = fs.readFileSync('maintenance/cofiring-bio-target-label-emphasis-v1.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('runtime targets only the Bio remaining-input target label semantically', () => {
  assert.match(js, /마감까지 Bio 필요 투입량/);
  assert.match(js, /text\.includes\("목표"\)/);
  assert.match(js, /cf-bio-target-label-emphasis-v1/);
});

test('label typography is enlarged and emphasized', () => {
  assert.match(css, /font-size:13px!important/);
  assert.match(css, /font-weight:850!important/);
  assert.match(css, /line-height:1\.25!important/);
});

test('V1 loaders exist exactly once', () => {
  assert.equal(
    (index.match(/cofiring-bio-target-label-emphasis-v1\.css\?v=20260920-bio-target-label-v1/g) || []).length,
    1
  );
  assert.equal(
    (index.match(/cofiring-bio-target-label-emphasis-v1\.js\?v=20260920-bio-target-label-v1/g) || []).length,
    1
  );
});
