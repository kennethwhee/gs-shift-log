'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {recordMarkup} = require('../maintenance/efficiency-mobile-menu-v1.js');

test('combined ratio appears before detailed rows without changing zero, missing or estimated values', () => {
  for (const [totalRatio, estimated, expected] of [[25.84, false, '25.84%'], [0, false, '0.00%'], [null, false, '—'], [25.84, true, '≈ 25.84%']]) {
    const record = {
      item: {targetDate: '2026-10-29', updatedAt: '2026-10-30T00:00:00Z'},
      summary: {combined: {totalRatio}, unit1: {coal: 483.809}, unit2: {coal: 755.539}},
      estimated
    };
    const before = JSON.stringify(record);
    const markup = recordMarkup(record);
    const total = markup.match(/^<div class="gsm-total([^"]*)"><span>종합 혼소율<\/span><strong>(.*?)<\/strong><\/div>/);
    assert.ok(total, 'summary is first in document order');
    assert.equal(total[2], expected);
    assert.equal(total[1].includes('gsm-estimated'), estimated);
    assert.ok(markup.indexOf('<table>') > total[0].length);
    assert.ok(markup.includes('483.809') && markup.includes('755.539'));
    assert.equal(JSON.stringify(record), before, 'stored record unchanged');
  }
});
