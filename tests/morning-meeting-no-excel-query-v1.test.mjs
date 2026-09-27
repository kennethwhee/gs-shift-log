import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const overlay = read("maintenance/morning-meeting-no-excel-query-v1.js");
const script = read("script.js");
const index = read("index.html");
const purge = (() => {
  try { return read("maintenance/morning-meeting-permanent-purge-v1.js"); }
  catch { return ""; }
})();

test("Excel query mode is retired while operations/all remain available", () => {
  assert.match(overlay, /WORKBOOK_BUTTON_ID\s*=\s*"morningMeetingWorkbookQueryButton"/);
  assert.match(overlay, /workbookButton\.remove\(\)/);
  assert.match(overlay, /source === "workbook"\) return Promise\.resolve\(null\)/);
  assert.match(overlay, /source === "all" \? "operations" : source/);
  assert.match(overlay, /api\.query\("operations", \{ userInitiated: true \}\)/);
  assert.match(overlay, /운영정보 · 혼소율 · TO 전력 · OIS · 마감자료/);
});

test("morning meeting analysis no longer starts the Daily DATA Excel reader automatically", () => {
  const start = script.indexOf("async function analyzeAllMorningMeetingFiles");
  assert.ok(start >= 0, "analyzeAllMorningMeetingFiles must exist");
  const end = script.indexOf("const availableResults", start);
  assert.ok(end > start, "analysis result section must exist");
  const block = script.slice(start, end);
  assert.doesNotMatch(block, /loadEfficiencyMorningMeetingDailyData/);
  assert.doesNotMatch(block, /const dailyDataLoader/);
  assert.match(block, /loadEfficiencyMorningMeetingWeather/);
});

test("final Excel creation remains intact; only Excel-as-a-data-source is retired", () => {
  assert.match(script, /applyMorningMeetingDailyDataValues/);
  assert.match(script, /findMorningMeetingWorksheetPath/);
  assert.match(index, /morning-meeting-no-excel-query-v1\.js\?v=20260927-v1/);
});

test("reset guidance no longer points to the removed Excel query action", () => {
  if (!purge) return;
  assert.doesNotMatch(purge, /\[엑셀 조회하기\]/);
});
