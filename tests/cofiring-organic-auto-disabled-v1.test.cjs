'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const repo=path.join(__dirname,'..');
const index=fs.readFileSync(path.join(repo,'index.html'),'utf8');
const ui=fs.readFileSync(path.join(repo,'maintenance/cofiring-period-ui-v5.js'),'utf8');

test('organic Daily DATA auto-fill client is not loaded by index',()=>{
  assert.doesNotMatch(index,/cofiring-organic-excel-auto-v1\.js/);
});

test('organic and manure manual entry contract remains in UI source',()=>{
  assert.equal(ui.includes("const FUEL_KEYS=['coal','bio','organic','manure']"),true);
  assert.equal(ui.includes("for(const fuel of ['organic','manure'])"),true);
  assert.equal(ui.includes("data-cfv5-manual="),true);
  assert.equal(ui.includes("data-cfv5-manual-save"),true);
  assert.equal(ui.includes("사용량 저장"),true);
});
