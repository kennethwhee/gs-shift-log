'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('maintenance/solid-fuel-trouble.css', 'utf8');
const html = fs.readFileSync('maintenance/solid-fuel-trouble.html', 'utf8');

test('desktop record form uses one 9-field grid row', () => {
  assert.match(css, /SOLID_FUEL_RECORD_SINGLE_ROW_V1/);
  const block = css.slice(css.indexOf('SOLID_FUEL_RECORD_SINGLE_ROW_V1'));
  assert.match(block, /@media \(min-width:1181px\)/);
  assert.match(block, /\.record-editor-card\s*\{\s*width:min\(1280px,calc\(100vw - 40px\)\);/);
  assert.match(block, /\.record-grid\.receipt-enabled-grid\s*\{/);
  assert.match(block, /minmax\(110px,.85fr\)[\s\S]*minmax\(145px,1.1fr\)[\s\S]*minmax\(105px,.8fr\)[\s\S]*minmax\(180px,1.45fr\)[\s\S]*minmax\(100px,.85fr\)[\s\S]*minmax\(105px,.85fr\)[\s\S]*minmax\(88px,.7fr\)[\s\S]*minmax\(88px,.7fr\)[\s\S]*minmax\(118px,.9fr\)!important;/);
});

test('all nine existing fields remain in source order', () => {
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
    assert.ok(at > previous, `${id} must remain present and in order`);
    previous = at;
  }
});

test('narrow-screen responsive fallbacks remain available', () => {
  assert.match(css, /@media\(max-width:1180px\)\{\.record-grid\.receipt-enabled-grid,.unload-editor-grid\.receipt-enabled-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important\}\}/);
  assert.match(css, /@media\(max-width:760px\)\{\.record-grid\.receipt-enabled-grid,.unload-editor-grid\.receipt-enabled-grid\{grid-template-columns:1fr 1fr!important\}\}/);
  assert.match(css, /@media\(max-width:450px\)\{\.record-grid\.receipt-enabled-grid,.unload-editor-grid\.receipt-enabled-grid\{grid-template-columns:1fr!important\}\}/);
});

test('HTML cache version points to the single-row build', () => {
  assert.equal(
    (html.match(/solid-fuel-trouble\.css\?v=20260920-record-single-row-v1/g) || []).length,
    1
  );
});
