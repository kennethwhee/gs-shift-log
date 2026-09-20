'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.js', 'utf8');
const css = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('basis table ancestors are stretched to the full card width', () => {
  assert.match(js, /cfh-operator-basis-stretch/);
  assert.match(css, /\.cfh-operator-basis-card \.cfh-operator-basis-stretch/);
  assert.match(css, /width:100%!important/);
  assert.match(css, /grid-column:1 \/ -1!important/);
});

test('basis table uses compact fixed visual row heights', () => {
  assert.match(css, /tbody\s*tr\.cfh-operator-basis-row[\s\S]*height:44px!important/);
  assert.match(css, /thead\s*tr[\s\S]*height:40px!important/);
  assert.match(css, /height:auto!important/);
});

test('calculation link is normalized to one readable button', () => {
  assert.match(js, /text\.includes\("계산완료"\)/);
  assert.match(js, /element\.textContent = "계산 화면 보기"/);
  assert.match(js, /normalize\(node\.nodeValue\) === "이동"/);
  assert.match(css, /min-width:108px!important/);
});

test('V2 cache versions exist exactly once', () => {
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.css\?v=20260920-operator-detail-v2/g) || []).length,
    1
  );
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.js\?v=20260920-operator-detail-v2/g) || []).length,
    1
  );
});
