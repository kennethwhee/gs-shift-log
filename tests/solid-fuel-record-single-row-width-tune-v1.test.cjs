'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('maintenance/solid-fuel-trouble.css', 'utf8');
const html = fs.readFileSync('maintenance/solid-fuel-trouble.html', 'utf8');

test('company is narrower and duration gets more room on desktop', () => {
  const block = css.slice(css.indexOf('SOLID_FUEL_RECORD_SINGLE_ROW_WIDTH_TUNE_V1'));
  assert.match(block, /minmax\(155px,1\.2fr\)/);
  assert.match(block, /minmax\(136px,1fr\)!important/);
  assert.match(block, /#recordDurationPreview\s*\{\s*min-width:0;\s*width:100%;/);
});

test('nine record fields remain in the same order', () => {
  const ids = [
    'recordDate',
    'recordFuelType',
    'recordReceiptTons',
    'recordCompany',
    'recordVehicle',
    'recordSilo',
    'recordArrival',
    'recordDeparture',
    'recordDurationPreview'
  ];
  let previous = -1;
  for (const id of ids) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > previous, `${id} must remain present and ordered`);
    previous = at;
  }
});

test('new cache version is present exactly once', () => {
  assert.equal(
    (html.match(/solid-fuel-trouble\.css\?v=20260920-record-single-row-width-tune-v1/g) || []).length,
    1
  );
});
