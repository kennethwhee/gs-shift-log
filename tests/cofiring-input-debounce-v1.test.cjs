'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('maintenance/cofiring-period-ui-v5.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('cofiring numeric inputs debounce expensive recalculation', () => {
  assert.match(ui, /COFIRING_INPUT_RECALC_DEBOUNCE_V1/);
  assert.match(ui, /function scheduleInputRecalc\(\)/);
  assert.match(ui, /},250\)\?\?null;/);
  assert.match(ui, /function flushInputRecalc\(\)/);
  assert.match(ui, /label\.textContent='수정됨 · 미저장';scheduleInputRecalc\(\);/);
  assert.match(ui, /settingsDirty=true;paintSettings\(\);scheduleInputRecalc\(\);/);
  assert.match(ui, /el\.addEventListener\('change',\(\)=>\{flushInputRecalc\(\);\}\)/);
  assert.match(ui, /event\.key==='Enter'\)flushInputRecalc\(\)/);
});

test('pending input recalculation is cancelled when the period changes or the view is disposed', () => {
  assert.match(
    ui,
    /async function periodChanged\(\{deferReads=false,draft=null,capturedAt=Date\.now\(\)\}=\{\}\)\{\s*clearInputRecalc\(\);restoringSaved=false;/
  );
  assert.match(
    ui,
    /receiptSyncGeneration\+\+;clearInputRecalc\(\);clearDayBoundary\(\)/
  );
});

test('manual programmatic recalculation cancels a pending typing timer first', () => {
  assert.match(
    ui,
    /cofiring:manual-recalculate',\(\)=>\{clearInputRecalc\(\);if\(reference\)calculate\(\);\}/
  );
});

test('web loads exactly one versioned cofiring period UI build', () => {
  const loaders = [
    ...index.matchAll(
      /<script\s+src="\/maintenance\/cofiring-period-ui-v5\.js\?v=([^"]+)"\s+defer><\/script>/g
    )
  ];

  assert.equal(
    loaders.length,
    1
  );

  assert.ok(
    loaders[0][1]
  );
});
