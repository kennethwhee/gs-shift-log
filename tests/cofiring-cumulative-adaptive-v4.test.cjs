'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const repo=path.join(__dirname,'..');
const organic=fs.readFileSync(path.join(repo,'maintenance/cofiring-organic-excel-auto-v1.js'),'utf8');
const ui=fs.readFileSync(path.join(repo,'maintenance/cofiring-period-ui-v5.js'),'utf8');
test('organic auto-fill uses current daily/period controls and never the retired cfv5 start/end controls',()=>{
  assert.match(organic,/COFIRING_ORGANIC_CURRENT_SELECTORS_V4/);
  assert.doesNotMatch(organic,/data-cfv5-start|data-cfv5-end/);
  assert.match(organic,/data-cfv7-date/);
  assert.match(organic,/data-cfv8-mode/);
  assert.match(organic,/data-cfv8-start/);
  assert.match(organic,/data-cfv8-end/);
  assert.match(organic,/COFIRING_ORGANIC_AFTER_HOST_SUCCESS_V1_R1/);
});
test('UI has the cumulative-daily semantic marker',()=>{
  assert.match(ui,/COFIRING_DAILY_CUMULATIVE_V4/);
  assert.match(ui,/today=defaultCalculationDate\(now\)/);
  assert.match(ui,/return currentDaySpec\(now\)/);
});
