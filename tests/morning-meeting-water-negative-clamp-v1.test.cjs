const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const overlayPath=path.join(
  __dirname,
  '..',
  'maintenance',
  'morning-meeting-water-negative-clamp-v1.js'
);

delete global.morningMeetingWaterNegativeClamp;
require(overlayPath);

const api=global.morningMeetingWaterNegativeClamp;

test('water negative clamp exposes its normalization API',()=>{
  assert.ok(api);
  assert.equal(api.version,'20261002-r7');
});

test('negative water values become zero while positive values and placeholders survive',()=>{
  assert.equal(api.normalizeText('1,668 / -10'),'1,668 / 0');
  assert.equal(api.normalizeText('-10'),'0');
  assert.equal(api.normalizeText('-0.47'),'0.00');
  assert.equal(api.normalizeText('-10.50%'),'0.00%');
  assert.equal(api.normalizeText('3,018.04 / 75.45%'),'3,018.04 / 75.45%');
  assert.equal(api.normalizeText('- / -%'),'- / -%');
});

test('scalar clamp only changes finite negative numbers',()=>{
  assert.equal(api.clampScalar(-10),0);
  assert.equal(api.clampScalar('-10'),0);
  assert.equal(api.clampScalar(0),0);
  assert.equal(api.clampScalar(12.5),12.5);
  assert.equal(api.clampScalar('-'),'-');
  assert.equal(api.clampScalar(null),null);
});

test('index loads the water clamp after the current-values helper',()=>{
  const html=fs.readFileSync(
    path.join(__dirname,'..','index.html'),
    'utf8'
  );

  const current=
    html.indexOf(
      '/maintenance/morning-meeting-workbook-current-values.js'
    );

  const clamp=
    html.indexOf(
      '/maintenance/morning-meeting-water-negative-clamp-v1.js'
    );

  assert.ok(current>=0);
  assert.ok(clamp>current);
});
