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

test('V3 R3 structurally installs complete-closing precedence', () => {
  assert.match(js, /MORNING_MEETING_ORGANIC_SAVED_FIRST_V3_R3/);
  assert.match(js, /function hasCompleteClosedOrganic\(item\)/);
  assert.match(js, /if \(!hasCompleteClosedOrganic\(closed\)\) \{\s*return true;/);
  assert.match(js, /return !explicitOrganicRequeryDates\.has\(date\);/);
});

test('explicit organic requery keeps the saved-date latch', () => {
  const start = js.indexOf('function beginExplicitOrganicRequery');
  const end = js.indexOf('\n  }', start);
  const body = js.slice(start, end + 4);
  assert.match(body, /explicitOrganicRequeryDates\.add\(date\)/);
  assert.doesNotMatch(body, /savedFirstOrganicDates\.delete\(date\)/);
});

test('workbook keeps complete existing organic values when the closing is partial', () => {
  assert.match(js, /hasCompleteExistingOrganicValues\(dailyData\)/);
  assert.match(js, /!hasCompleteClosedOrganic\(savedFirstV3Closed\)/);
  assert.match(js, /return \{\.\.\.\(dailyData/);
});

test('R4 saved-first hooks remain semantically present without the old proximity assumption', () => {
  assert.match(js, /MORNING_MEETING_ORGANIC_SAVED_FIRST_V2_R4/);
  assert.match(js, /function renderOrganic\(\)/);
  assert.match(js, /shouldPreserveExistingOrganic\(savedFirstDate\)/);
  assert.match(js, /function valuesForWorkbook\(/);
  assert.match(js, /hasCompleteExistingOrganicValues\(dailyData\)/);
  assert.match(js, /!hasCompleteClosedOrganic\(savedFirstV3Closed\)/);
});

test('Daily DATA Excel read remains retired and cache key ships', () => {
  assert.doesNotMatch(js, /daily_data_excel/);
  assert.match(
    html,
    /morning-meeting-closed-cofiring\.js\?[^"]*organicSavedFallback=20260928-v3-r3/
  );
});
