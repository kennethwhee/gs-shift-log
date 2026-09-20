'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.js', 'utf8');
const css = fs.readFileSync('maintenance/cofiring-closed-detail-operator-v1.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('V3 replaces the old detail body with new basis and meta hosts', () => {
  assert.match(js, /cfh-v3-basis-host/);
  assert.match(js, /cfh-v3-meta-host/);
  assert.match(js, /resetCard/);
  assert.match(js, /계산 화면 보기/);
});

test('V3 basis layout is a full-width 5-column grid instead of the old table look', () => {
  assert.match(css, /\.cfh-v3-basis-grid/);
  assert.match(css, /grid-template-columns:minmax\(86px,1\.05fr\) minmax\(0,1\.1fr\) minmax\(0,.85fr\) minmax\(0,1\.1fr\) minmax\(0,.85fr\)!important/);
  assert.match(css, /\.cfh-v3-cell--fuel/);
  assert.match(css, /\.cfh-v3-action-button/);
});

test('V3 cache versions exist exactly once', () => {
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.css\?v=20260920-operator-detail-v3/g) || []).length,
    1
  );
  assert.equal(
    (index.match(/cofiring-closed-detail-operator-v1\.js\?v=20260920-operator-detail-v3/g) || []).length,
    1
  );
});
