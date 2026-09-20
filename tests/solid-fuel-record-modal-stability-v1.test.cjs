'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const src = fs.readFileSync(
  'maintenance/cofiring-solid-fuel-management-tab-v2.js',
  'utf8'
);
const index = fs.readFileSync('index.html', 'utf8');

test('open Solid Fuel modal blocks iframe collapse/resizing', () => {
  assert.match(src, /SOLID_FUEL_RECORD_MODAL_STABILITY_V1/);
  assert.match(
    src,
    /function embeddedModalOpen\(frame\)[\s\S]*?querySelector\("\.modal:not\(\[hidden\]\)"\)/
  );
  assert.match(
    src,
    /if \(!frame \|\| frame\.hidden \|\| embeddedModalOpen\(frame\)\) return;/
  );
  assert.match(src, /frame\.style\.height = "1px";/);
});

test('modal interactions no longer schedule outer iframe resizing', () => {
  assert.match(
    src,
    /const resync = \(event\) => \{[\s\S]*?event\?\.target\?\.closest\?\.\("\.modal"\)[\s\S]*?return;[\s\S]*?scheduleFrameResize\(frame\);/
  );
  assert.doesNotMatch(
    src,
    /doc\.addEventListener\("input",\s*resync,\s*true\)/
  );
  assert.match(src, /doc\.addEventListener\("click", resync, true\)/);
  assert.match(src, /doc\.addEventListener\("change", resync, true\)/);
  assert.match(src, /doc\.addEventListener\("submit", resync, true\)/);
});

test('cache loader points to modal stability build exactly once', () => {
  const matches = index.match(
    /\/maintenance\/cofiring-solid-fuel-management-tab-v2\.js\?v=20260920-record-modal-stability-v1/g
  ) || [];
  assert.equal(matches.length, 1);
});
