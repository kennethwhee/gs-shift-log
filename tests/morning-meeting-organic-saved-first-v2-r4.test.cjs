'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..');
const js = fs.readFileSync(
  path.join(repo, 'maintenance', 'morning-meeting-closed-cofiring.js'),
  'utf8'
);
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

test('saved-first policy is installed without restoring Daily DATA Excel reads', () => {
  assert.match(js, /MORNING_MEETING_ORGANIC_SAVED_FIRST_V2_R4/);
  assert.match(js, /hasExistingSavedOrganicCard/);
  assert.match(js, /기존 저장값/);
  assert.match(js, /shouldPreserveExistingOrganic/);
  assert.doesNotMatch(js, /daily_data_excel/);
});

test('render and workbook preserve the existing saved organic record', () => {
  assert.match(
    js,
    /function renderOrganic\(\)\s*\{[\s\S]{0,220}?shouldPreserveExistingOrganic\(savedFirstDate\)[\s\S]{0,80}?return;/
  );
  assert.match(
    js,
    /function valuesForWorkbook\([^)]*\)\s*\{[\s\S]{0,520}?shouldPreserveExistingOrganic\(savedFirstDate\)[\s\S]{0,160}?return \{\.\.\.\(dailyData/
  );
});

test('only explicit organic mini refresh or 전체자료 unlocks replacement', () => {
  assert.match(js, /button\.id === PREFIX \+ 'SludgeRefreshButton'/);
  assert.match(js, /organicSavedText\(button\) === '전체자료'/);
  assert.match(js, /beginExplicitOrganicRequery\(targetDate\(\)\)/);
  assert.match(js, /const explicit = explicitOrganicRequeryDates\.has\(date\)/);
  assert.match(js, /if \(!explicit && shouldPreserveExistingOrganic\(date\)\) return null;/);
});

test('background force callers cannot bypass saved-first on their own', () => {
  assert.match(js, /root\.addEventListener\('focus',[\s\S]{0,180}?refresh\(\{force: true\}\)/);
  assert.match(js, /visibilitychange[\s\S]{0,220}?refresh\(\{force: true\}\)/);
  assert.match(js, /onClosedChange[\s\S]{0,300}?refresh\(\{force: true\}\)/);
  assert.match(js, /if \(!explicit && shouldPreserveExistingOrganic\(date\)\) return null;/);
});

test('cache key ships with the policy', () => {
  assert.match(
    html,
    /morning-meeting-closed-cofiring\.js\?[^"]*organicSavedFirst=20260928-v2-r4/
  );
});
