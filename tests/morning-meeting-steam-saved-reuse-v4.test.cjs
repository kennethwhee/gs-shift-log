'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const steam = fs.readFileSync(path.join(root, 'maintenance', 'morning-meeting-steam-ois-probe-v1.js'), 'utf8');
const query = fs.readFileSync(path.join(root, 'maintenance', 'morning-meeting-query-sources.js'), 'utf8');

test('steam loader reuses stored history and merges production/sales independently', () => {
  assert.match(steam, /MORNING_MEETING_STEAM_SAVED_REUSE_V4/);
  assert.match(steam, /url\.searchParams\.set\("action", "completed_history"\)/);
  assert.match(steam, /mergeSteamResults/);
  assert.match(steam, /저장 기록 사용 · 신규 OIS 조회 생략/);
  assert.match(steam, /return lastResult;\s*\n\s*}\s*\n\s*}\s*\n\s*if \(!stored\)/);
});

test('individual refresh remains fresh while saved fallback can be preserved', () => {
  assert.match(steam, /forceRefresh: true,\s*ignoreSaved: false/);
  assert.match(steam, /createRequest\(targetDate, \{ forceRefresh: true \}\)/);
});

test('all-data requests saved reuse normally and fresh-only after reset', () => {
  assert.match(query, /forceRefresh:\s*releaseAfterSuccess/);
  assert.match(query, /ignoreSaved:\s*releaseAfterSuccess/);
  assert.match(query, /silent:\s*true/);
  assert.match(query, /requireComplete:\s*true/);
});

test('all-data cannot treat a partial steam result as successful', () => {
  assert.match(steam, /normalizedOptions\.requireComplete === true/);
  assert.match(steam, /!isCompleteSteamResult\(result\)/);
  assert.match(steam, /증기 생산량·판매량 중 미수신 항목이 남아 있습니다/);
});
