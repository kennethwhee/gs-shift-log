"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");

const repo = process.env.TEAM_DATE_RANGE_REPO || path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repo, "script.js"), "utf8");
const start = source.indexOf("function extractMorningMeetingReportDate(");
const end = source.indexOf("function findMorningMeetingRowIndex(", start);
assert.ok(start >= 0 && end > start);

function harness() {
  const context = vm.createContext({
    window: {efficiencyMorningMeetingUploadState: {workDate: "2026-10-18", weekendMode: {
      enabled: true, startDate: "2026-10-16", endDate: "2026-10-18"
    }}},
    document: {getElementById: () => null},
    console: {log() {}, warn() {}, error() {}},
    TEAM_CONFIG: {electrical: {name: "전기제어팀"}},
    normalizeMorningMeetingSearchText: value => String(value ?? "").replace(/\s+/g, " ").trim(),
    convertMorningMeetingSheetToRows: worksheet => worksheet.rows
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    extract: rows => context.extractMorningMeetingReportDate(Array.isArray(rows) ? rows : [rows]),
    select: (rows, sheetName = "Sheet1") => context.selectMorningMeetingSourceSheet({
      SheetNames: [sheetName, "Sheet2"], Sheets: {[sheetName]: {rows}, Sheet2: {rows: []}}
    }, "electrical")
  };
}

test("observed electrical report header closes October 16; its October 19 plan is separate", () => {
  const rows = ["일일업무_2026.10.15~16", "5. 전기제어팀", "1) 완료 업무", "◇ 예정사항(26.10.19)", "1) 예정 업무"];
  const h = harness();
  assert.equal(h.extract(rows), "2026.10.16");
  const selected = h.select(rows);
  assert.equal(selected.sheetName, "Sheet1");
  assert.equal(selected.reportDate, "2026.10.16");
  assert.equal(selected.normalizedReportDate, "2026-10-16");
  assert.deepEqual(selected.rows, rows);
});

for (const [header, expected] of [
  ["일일업무_2026.10.16", "2026.10.16"],
  ["일일업무 2026/10/16 (금)", "2026.10.16"],
  ["일일업무-2026-10-16", "2026.10.16"],
  ["일일업무_2026.10.15~16", "2026.10.16"],
  ["일일업무_2026.10.15 ~ 10.16", "2026.10.16"],
  ["일일업무_2026.10.15 ～ 2026.10.16 (금)", "2026.10.16"],
  ["일일업무_2026/10/15~2026/10/16", "2026.10.16"],
  ["일일업무_2026-10-15 ~ 2026-10-16", "2026.10.16"],
  ["일일업무_2026.10.31~11.02", "2026.11.02"],
  ["일일업무_2026.12.31~2027.01.01", "2027.01.01"],
  ["일일업무_2028.02.28~29", "2028.02.29"],
  ["일일업무_2026.10.16~16", "2026.10.16"]
]) {
  test("calendar report date: " + header, () => assert.equal(harness().extract(header), expected));
}

for (const header of [
  "일일업무_2026.10.16~15", "일일업무_2026.10.16~2026.10.15",
  "일일업무_2026.12.31~01.01", "일일업무_2026.10.31~02",
  "일일업무_2026.02.30~03.01", "일일업무_2026.02.28~29",
  "일일업무_2026.10.15~32", "일일업무_2026.10.15~13.01",
  "일일업무_2026.10.15~", "일일업무_2026.10.15~xx",
  "일일업무_2026.10.15~16~17", "일일업무_2026.10.15~16 ~17",
  "일일업무_2026.10.15~16.99", "일일업무_2026.10.15~166",
  "일일업무_2026.10.166", "일일업무_2026.13.16"
]) {
  test("malformed or reversed report cannot fall back to a matching sheet name: " + header, () => {
    const h = harness();
    assert.throws(() => h.extract(header), /제목의 날짜 또는 기간/);
    assert.throws(() => h.select([header, "5. 전기제어팀"], "2026-10-16"), /제목의 날짜 또는 기간/);
  });
}

test("a genuinely earlier or later report is still rejected for the Friday collection", () => {
  for (const header of ["일일업무_2026.10.15", "일일업무_2026.10.14~15", "일일업무_2026.10.16~17"]) {
    assert.throws(() => harness().select([header, "5. 전기제어팀"], "2026-10-16"), /주말 시작 전 기준일\(2026-10-16\)/);
  }
});

test("an undated legacy report retains date-in-sheet-name compatibility", () => {
  const h = harness();
  assert.equal(h.extract(["일일업무", "5. 전기제어팀"]), "");
  assert.equal(h.select(["5. 전기제어팀", "1) 완료 업무"], "2026-10-16").normalizedReportDate, "2026-10-16");
});
