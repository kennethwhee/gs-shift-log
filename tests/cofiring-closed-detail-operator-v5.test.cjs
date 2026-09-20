'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.js', 'utf8');
const css = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('V5 hides the close-information branch entirely', () => {
  assert.match(js, /metaBranch\.classList\.add\("cfh-v5-meta-branch-hidden"\)/);
  assert.match(css, /\.cfh-v5-meta-branch-hidden\{\s*display:none!important/);
});

test('V5 renders only a one-line heating-value basis strip', () => {
  assert.match(js, /계산 발열량 근거/);
  assert.match(js, /Bio-SRF/);
  assert.match(js, /유기성 고형연료/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
});

test('V5 preserves unit differences when 1 and 2 differ', () => {
  assert.match(js, /1호기 \$\{item\.unit1Heat\} · 2호기 \$\{item\.unit2Heat\}/);
  assert.match(js, /item\.same/);
});

test('V5 remains compact', () => {
  assert.match(css, /min-height:42px!important/);
  assert.match(css, /padding:10px 12px!important/);
});

test('V5 cache versions exist exactly once', () => {
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.css\?v=20260920-operator-detail-v5/g) || []).length,
    1
  );
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.js\?v=20260920-operator-detail-v5/g) || []).length,
    1
  );
});
