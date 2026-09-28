const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const scriptPath = path.join(ROOT, 'script.js');
const indexPath = path.join(ROOT, 'index.html');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('long-holiday Bio/SMP final layout hook is installed after values/styles and before worksheet serialization', () => {
  const source = read(scriptPath);
  const functionIndex = source.indexOf('function applyMorningMeetingLongHolidaySideBySideLayoutV2(');
  const manualFillIndex = source.indexOf('const manualInputFillResult =');
  const hookIndex = source.indexOf('const longHolidaySideBySideLayoutResult =');
  const serializeIndex = source.indexOf('worksheetPath', hookIndex);

  assert.ok(functionIndex >= 0, 'layout function missing');
  assert.ok(manualFillIndex >= 0, 'manual fill stage missing');
  assert.ok(hookIndex > manualFillIndex, 'layout hook must run after manual fill');
  assert.ok(serializeIndex > hookIndex, 'layout hook must run before worksheet serialization');
});

test('5-day layout keeps one Bio title row and aligns SMP top with Bio top', () => {
  const source = read(scriptPath);
  assert.match(source, /holidayCount\s*-\s*5/);
  assert.match(source, /targetPowerTitleRow\s*=\s*bioTitleRow/);
  assert.match(source, /targetPowerLastRow\s*!==\s*targetOperationHeadingRow/);
});

test('6+ day layout grows only the Bio title and contributes its row delta to print-area movement', () => {
  const source = read(scriptPath);
  assert.match(source, /extraTitleRows[\s\S]{0,120}Math\.max\([\s\S]{0,120}holidayCount[\s\S]{0,80}5/);
  assert.match(source, /addMerge\([\s\S]{0,120}bioTitleRow[\s\S]{0,120}bioTitleRow\s*\+[\s\S]{0,80}extraTitleRows/);
  assert.match(source, /longHolidaySideBySideLayoutResult\?\.rowDelta/);
});

test('Bio date columns are repartitioned using actual worksheet column widths', () => {
  const source = read(scriptPath);
  assert.match(source, /partitionColumnsByVisualWidth/);
  assert.match(source, /columnElement\.getAttribute\([\s\S]{0,40}"width"/);
  assert.match(source, /relativeError\s*\*[\s\S]{0,40}relativeError/);
  assert.match(source, /visualGroups\.forEach/);
});

test('script cache key is bumped for the final long-holiday alignment release', () => {
  const html = read(indexPath);
  assert.match(html, /script\.js\?[^"']*longHolidayLayout=20260928-v3/);
});
