'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sourcePath = process.env.COFIRING_CENTER_SOURCE || path.join(__dirname,'..','maintenance','cofiring-period-adjustment-v56.js');
const src = fs.readFileSync(sourcePath,'utf8');

test('coal review notice is centered inside the adjustment body',()=>{
  assert.match(src,/COFIRING CENTERED COAL REVIEW V2/);
  assert.match(src,/textAlign:'center'/);
  assert.match(src,/autoSection\.insertAdjacentElement\('afterend',toast\)/);
  assert.match(src,/width:'100%'/);
});

test('coal review notice remains dismissible and auto-hides after three seconds',()=>{
  assert.match(src,/closeButton\.addEventListener\('click',hideCoalReviewToast\)/);
  assert.match(src,/setTimeout\?\.\(hideCoalReviewToast,3000\)/);
});

test('successful max co-firing adjustment still owns the notice trigger',()=>{
  assert.match(src,/if\(r\?\.ok\)showCoalReviewToast\(\)/);
  assert.match(src,/최대 혼소 조정 시, 1,2호기 석탄 사용량 검토 필요/);
});
