'use strict';
// The historical toast contract is superseded by the editor-owned V15 note.
// Interaction coverage lives in cofiring-adjustment-readability-v15.test.cjs.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const sourcePath = process.env.COFIRING_TOAST_SOURCE || path.join(__dirname, '..', 'maintenance', 'cofiring-period-adjustment-v56.js');
const src = fs.readFileSync(sourcePath, 'utf8');
const api = require(sourcePath);

test('the former toast path owns one initially hidden nonblocking coal-review note', () => {
  const html = api.modalHtml();
  assert.equal((html.match(/data-cfv56-coal-review-notice\b/g) || []).length, 1);
  assert.match(html, /<p\b[^>]*data-cfv56-coal-review-notice[^>]*role="note"[^>]*hidden/);
  assert.match(html, /최대혼소 조정 후 1·2호기 석탄 사용량을 확인해 주세요\./);
});

test('the former timed toast cannot create a second overlay or transient inline warning', () => {
  assert.doesNotMatch(src, /showCoalReviewToast|hideCoalReviewToast|coalReviewToastTimer/);
  assert.doesNotMatch(src, /data-cfv56-coal-review-toast|data-cfv56-coal-review-center-close/);
  assert.doesNotMatch(src, /cfv56CoalReviewInlineV14R1|cfv56-coal-review-center-box/);
});

test('the maximum button still uses the shared calculation and preview validation path', () => {
  const start = src.indexOf("q('[data-cfv56-auto]').addEventListener('click',");
  const end = src.indexOf("q('[data-cfv56-edit]').addEventListener", start);
  assert.ok(start >= 0 && end > start, 'The operator maximum button handler must remain present');
  const handler = src.slice(start, end);
  assert.match(handler, /if\s*\(\s*!validAction\(\)\s*\)\s*return/);
  assert.match(handler, /showPreview\(autoMax\(base,settings,/);
  assert.doesNotMatch(handler, /fetch\(|saveServerAdjustment\(|\.appendChild\(/);
});
