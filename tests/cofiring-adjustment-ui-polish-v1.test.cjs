'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const modPath = path.resolve(__dirname, '..', 'maintenance', 'cofiring-period-adjustment-v56.js');
delete require.cache[modPath];
require(modPath);
const api = globalThis.CofiringPeriodAdjustmentV56;

test('modal html contains polished structure', () => {
  const html = api.modalHtml();
  assert.match(html, /cfv56-adjust-top-grid/);
  assert.match(html, /선택 기간/);
  assert.match(html, /적용될 최종 수치를 확인하세요/);
  assert.match(html, /placeholder="0.0"/);
});

test('css contains ui polish marker', () => {
  const cssPath = path.resolve(__dirname, '..', 'maintenance', 'cofiring-period-ui-v5.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /COFIRING ADJUSTMENT UI POLISH V1/);
  assert.match(css, /cfv56-adjust-top-grid/);
});
