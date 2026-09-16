'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sourcePath = process.env.COFIRING_TOAST_SOURCE || path.join(__dirname, '..', 'maintenance', 'cofiring-period-adjustment-v56.js');
const src = fs.readFileSync(sourcePath, 'utf8');
const message = '최대 혼소 조정 시, 1,2호기 석탄 사용량 검토 필요';

test('max co-firing adjustment includes the small coal review toast', () => {
  assert.equal((src.match(/COFIRING COAL REVIEW TOAST V1/g) || []).length, 1);
  assert.equal((src.match(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.match(src, /data-cfv56-coal-review-toast/);
  assert.match(src, /closeButton\.addEventListener\('click',hideCoalReviewToast\)/);
  assert.match(src, /setTimeout\?\.\(hideCoalReviewToast,3000\)/);
});

test('notice is triggered only after a successful autoMax result', () => {
  const start = src.indexOf("q('[data-cfv56-auto]').addEventListener('click',()=>{");
  assert.ok(start >= 0, 'max co-firing click handler missing');
  const slice = src.slice(start, start + 1800);
  assert.match(slice, /const\s+r\s*=\s*autoMax\s*\(/);
  assert.match(slice, /if\(r\?\.ok\)showCoalReviewToast\(\)/);
});

test('toast patch does not replace the existing preview path', () => {
  assert.match(src, /showPreview\(r,/);
  assert.match(src, /data-cfv56-auto/);
});
