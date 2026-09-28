"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repo = path.resolve(__dirname, "..");
const parser = require(path.join(repo, "local-tools", "ois-agent", "steam-sales-api-v13.js"));

test("parses the target date 8Bar/34Bar use_ton values and subtotal", () => {
  const payload = {
    result: [
      { entry_date: "2026/09/27", product: "8Bar", use_ton: "400.000" },
      { entry_date: "2026/09/28", product: "8Bar", use_ton: "501.250" },
      { entry_date: "2026/09/28", product: "34Bar", use_ton: "111.750" },
      { entry_date: "2026/09/28", product: "소계", use_ton: "613.000" }
    ]
  };
  assert.deepEqual(
    parser.parseOisSteamSalesApiResponseV13(payload, "2026-09-28"),
    {
      steamSalesLowPressure: 501.25,
      steamSalesHighPressure: 111.75,
      steamSales: 613,
      sourceMode: "ajax-api-v13",
      targetDate: "2026/09/28",
      rows: [
        { entry_date: "2026/09/28", product: "8Bar", use_ton: "501.250" },
        { entry_date: "2026/09/28", product: "34Bar", use_ton: "111.750" },
        { entry_date: "2026/09/28", product: "소계", use_ton: "613.000" }
      ]
    }
  );
});

test("calculates total when subtotal is absent", () => {
  const payload = { result: [
    { entry_date: "2026/9/28", product: "8Bar", use_ton: "10.1" },
    { entry_date: "2026/9/28", product: "34Bar", use_ton: "2.2" }
  ]};
  const result = parser.parseOisSteamSalesApiResponseV13(payload, "2026-09-28");
  assert.equal(result.steamSales, 12.3);
});

test("returns null when the target date or both pressure rows are absent", () => {
  assert.equal(parser.parseOisSteamSalesApiResponseV13({ result: [] }, "2026-09-28"), null);
  assert.equal(parser.parseOisSteamSalesApiResponseV13({ result: [
    { entry_date: "2026/09/28", product: "8Bar", use_ton: "10" }
  ] }, "2026-09-28"), null);
});

test("rejects inconsistent subtotal", () => {
  assert.throws(() => parser.parseOisSteamSalesApiResponseV13({ result: [
    { entry_date: "2026/09/28", product: "8Bar", use_ton: "10" },
    { entry_date: "2026/09/28", product: "34Bar", use_ton: "2" },
    { entry_date: "2026/09/28", product: "소계", use_ton: "99" }
  ] }, "2026-09-28"), /합계가 일치하지 않습니다/);
});

test("ois-login integrates API direct read before DOM/grid fallback", () => {
  const source = fs.readFileSync(path.join(repo, "local-tools", "ois-agent", "ois-login.js"), "utf8");
  assert.match(source, /MORNING_MEETING_STEAM_OIS_API_DIRECT_V13/);
  assert.match(source, /oi\.LogSheetService\.listProcSteam/);
  assert.match(source, /schepow_stat_code:\s*"8000"/);
  assert.match(source, /yearmon:\s*targetYearMonth/);
  assert.match(source, /parseOisSteamSalesApiResponseV13/);
  assert.match(source, /readOisSteamDailySalesFromApiV13\(salesFrame, targetDate\)/);
  assert.match(source, /readOisSteamDailySalesBreakdown\(salesFrame, targetDate\)/);
  const direct = source.indexOf("readOisSteamDailySalesFromApiV13(salesFrame, targetDate)");
  const fallback = source.indexOf("readOisSteamDailySalesBreakdown(salesFrame, targetDate)", direct);
  assert.ok(direct >= 0 && fallback > direct, "API direct read must precede DOM/grid fallback");
});
