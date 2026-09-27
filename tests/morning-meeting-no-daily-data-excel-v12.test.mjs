import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('morning meeting cards have no Daily DATA Excel read path', () => {
  const script = read('script.js');
  const query = read('maintenance/morning-meeting-query-sources.js');
  const cofire = read('maintenance/morning-meeting-cofiring-card.js');
  const steam = read('maintenance/morning-meeting-steam-ois-probe-v1.js');
  const html = read('index.html');

  for (const value of ['installEfficiencyMorningMeetingSteamStatusClient', 'loadEfficiencyMorningMeetingDailyData', 'refreshEfficiencyMorningMeetingDailyDataSection']) {
    assert.equal(script.includes(value), false, 'script.js still contains ' + value);
  }
  assert.doesNotMatch(script, /findCompletedItem\s*\(\s*\[\s*["']daily_data_excel["']/, 'script.js still hydrates morning cards from Daily DATA Excel');
  for (const value of ['morningMeetingWorkbookQueryButton', '엑셀 조회하기', 'loadEfficiencyMorningMeetingDailyData', 'querySource: "daily_data_excel"', '"workbook"']) {
    assert.equal(query.includes(value), false, 'query source still contains ' + value);
  }
  for (const value of ['daily_data_excel', 'fetchDailyData(', 'query("workbook"', 'waitForDailyDataRequest']) {
    assert.equal(cofire.includes(value), false, 'co-firing card still contains ' + value);
  }
  assert.equal(steam.includes('daily_data_excel'), false);
  assert.equal(steam.includes('refreshEfficiencyMorningMeetingDailyDataSection'), false);
  assert.match(steam, /requestType:\s*["']steam_status["']/);
  assert.equal(html.includes('morning-meeting-no-excel-query-v1.js'), false);

  assert.match(script, /function applyMorningMeetingDailyDataValues\(/);
  assert.match(script, /function createMorningMeetingWorkbook\(/);
});

test('morning meeting history keeps steam_status distinct from legacy Daily DATA Excel', () => {
  const api = read('functions/api/ois-data-requests.js');
  assert.doesNotMatch(api, /convertedItem\.requestType ===\s*["']steam_status["']\s*\?\s*["']daily_data_excel["']/);
});
