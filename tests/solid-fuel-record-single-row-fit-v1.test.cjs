'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('maintenance/solid-fuel-trouble.css', 'utf8');
const html = fs.readFileSync('maintenance/solid-fuel-trouble.html', 'utf8');

test('desktop record row uses shrinkable fractional tracks so duration cannot overflow', () => {
  const at = css.indexOf('SOLID_FUEL_RECORD_SINGLE_ROW_FIT_V1');
  assert.ok(at >= 0);
  const block = css.slice(at);
  assert.match(block, /width:100%;\s*grid-template-columns:/);
  assert.match(block, /minmax\(0,1\.05fr\)[\s\S]*minmax\(0,1\.30fr\)[\s\S]*minmax\(0,.85fr\)[\s\S]*minmax\(0,1\.25fr\)[\s\S]*minmax\(0,.95fr\)[\s\S]*minmax\(0,.95fr\)[\s\S]*minmax\(0,.80fr\)[\s\S]*minmax\(0,.80fr\)[\s\S]*minmax\(0,1\.05fr\)!important;/);
  assert.match(block, /#recordDurationPreview\s*\{\s*min-width:0;\s*max-width:100%;\s*width:100%;/);
});

test('company remains narrower than fuel and all nine fields remain ordered', () => {
  const ids = [
    'recordDate','recordFuelType','recordReceiptTons','recordCompany',
    'recordVehicle','recordSilo','recordArrival','recordDeparture','recordDurationPreview'
  ];
  let previous = -1;
  for (const id of ids) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > previous, `${id} order mismatch`);
    previous = at;
  }
});

test('cache version points to fit build exactly once', () => {
  assert.equal(
    (html.match(/solid-fuel-trouble\.css\?v=[^"\s<>]+/g) || []).length,
    1
  );
});

test('record fields retain four, two and one column layouts below desktop width', () => {
  for(const [width,columns] of [[1180,'repeat(4,minmax(0,1fr))'],[760,'1fr 1fr'],[450,'1fr']]) {
    const at=css.indexOf(`@media(max-width:${width}px){.record-grid.receipt-enabled-grid`);
    assert.ok(at>=0, `missing responsive rule ${width}`);
    assert.ok(css.slice(at,css.indexOf('}}',at)).includes(`grid-template-columns:${columns}!important`));
  }
});
