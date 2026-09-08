import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../local-tools/ois-agent/ois-login.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function parseDailyDataWorkbookNumber("), source.indexOf("async function collectDailyDataWorkbookValues("));
const start = source.indexOf("async function collectDailyDataWorkbookValues(");
const collector = source.slice(start, source.indexOf("/* =========================================================", start + 1));
const marker = "__DAILY_DATA_WORKBOOK_RESULT__";

function fixture(date = "2026-09-01") {
  return {
    schemaVersion: 2, targetDate: date, sourceDate: date,
    workbook: `${date.slice(2, 4)}.${date.slice(5, 7)}-일일DATA관리.xlsx`,
    workbookFullName: `W:\\2026\\${date.slice(2, 4)}.${date.slice(5, 7)}-일일DATA관리.xlsx`,
    workbookSaved: false, workbookReadOnly: false, workbookSource: "open_workbook",
    readerVersion: "monthly-open-v1", workbookProcessId: 3210,
    targetColumn: "F", monthCell: "Plant!F4", monthText: "2026년 09월", dayCell: "Plant!F5",
    coalUsageUnitOne: 101.123456789, coalUsageUnitTwo: 102,
    bioUsageUnitOne: 11.1, bioUsageUnitTwo: 12.2,
    organicUsageUnitOne: 3.14159265, organicUsageUnitTwo: 4.5,
    unitOneProduction: 1000.123456789, unitTwoProduction: 2000.987654321,
    steamSalesLowPressure: 700.123456789, steamSalesHighPressure: 800.987654321,
    generatorEcmsGen1: 1100.456789, ismartReception: 0, epowerTransmission: 1090.321456,
    solarDailyGeneration: 391.3, solarWeeklyCumulative: null, solarMonthlyCumulative: 391.3,
    solarYearlyCumulative: null, solarCumulative: { month: { complete: true, startDate: date, endDate: date } },
    organicDaySilo: 5.829712345, organicStorageSiloA: 0.099812345, organicStorageSiloB: 0.832912345,
    organicSiloTotal: 6.762, organicSiloMetadata: { organicSiloTotal: { valueCell: "Plant!F287" } },
    sludgeEntries: [{ amount: 10.123456789, cell: "Plant!F288" }, { amount: 0, cell: "Plant!F289" }],
    sludgeTruckCount: 1, sludgeTotal: 10.123456789,
    fieldWarnings: [], collectedAt: "2026-09-08T12:00:00.1234567Z"
  };
}

function emptyDayFixture() {
  const raw = fixture();
  for (const key of [
    "coalUsageUnitOne", "coalUsageUnitTwo", "bioUsageUnitOne", "bioUsageUnitTwo",
    "organicUsageUnitOne", "organicUsageUnitTwo", "generatorEcmsGen1", "ismartReception",
    "epowerTransmission", "solarDailyGeneration", "unitOneProduction", "unitTwoProduction",
    "steamSalesLowPressure", "steamSalesHighPressure", "organicDaySilo", "organicStorageSiloA",
    "organicStorageSiloB", "organicSiloTotal", "sludgeTruckCount", "sludgeTotal"
  ]) raw[key] = null;
  raw.sludgeEntries = [];
  // Historical cumulative values intentionally remain present.
  raw.solarMonthlyCumulative = 391.3;
  raw.solarYearlyCumulative = 12345;
  raw.fieldWarnings = ["unitOneProduction / Plant!F51 / #N/A", "generatorEcmsGen1 / Plant!F56 / 빈 셀"];
  return raw;
}

function harness(reply) {
  const calls = [];
  const context = vm.createContext({
    console: { log() {} }, path: path.win32, __dirname: "C:\\project\\local-tools\\ois-agent",
    normalizeOisAgentText: value => value == null ? "" : String(value).trim(),
    isValidOisAgentDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    DAILY_DATA_WORKBOOK_RESULT_MARKER: marker,
    DAILY_DATA_WORKBOOK_FIELD_DEFINITIONS: [], DAILY_DATA_WORKBOOK_SLUDGE_DEFINITIONS: [], DAILY_DATA_WORKBOOK_ORGANIC_SILO_DEFINITIONS: [],
    runDataParcSteamPowerShell: async env => {
      calls.push(env);
      const result = typeof reply === "function" ? reply(env) : reply;
      return `${marker}${JSON.stringify(result)}\n`;
    }
  });
  vm.runInContext(`${helpers}\n${collector}\nthis.collect = collectDailyDataWorkbookValues;`, context);
  return { calls, collect: context.collect };
}

test("open workbook result preserves exact Plant cell values, workbook total, and source evidence", async () => {
  const raw = fixture();
  const { collect, calls } = harness(raw);
  const result = await collect(raw.targetDate);
  for (const key of ["coalUsageUnitOne", "organicUsageUnitOne", "unitOneProduction", "unitTwoProduction", "steamSalesLowPressure", "generatorEcmsGen1", "organicDaySilo", "organicStorageSiloA", "organicStorageSiloB", "organicSiloTotal", "sludgeTotal"]) {
    assert.equal(result[key], raw[key], key);
  }
  assert.notEqual(result.organicSiloTotal, result.organicDaySilo + result.organicStorageSiloA + result.organicStorageSiloB);
  assert.equal(result.totalProduction, raw.unitOneProduction + raw.unitTwoProduction);
  assert.equal(result.steamSales, raw.steamSalesLowPressure + raw.steamSalesHighPressure);
  assert.equal(result.workbookSource, "open_workbook");
  assert.equal(result.readerVersion, "monthly-open-v1");
  assert.equal(result.workbookProcessId, 3210);
  assert.equal(result.workbookSaved, false);
  assert.equal(result.organicSiloSource, "Plant 수기·계산 완료값");
  assert.equal(result.dataParcWorksheet, "");
  assert.equal(result.dataParcDateCell, "");
  assert.equal(result.dataParcHost, false);
  assert.equal(calls[0].GS_DAILY_OPEN_WORKBOOK_HELPER, "C:\\project\\local-tools\\ois-agent\\daily-data-open-workbook.ps1");
});

test("a stopped plant with zero production and zero sales is a valid daily workbook result", async () => {
  const raw = fixture();
  raw.unitOneProduction = raw.unitTwoProduction = raw.steamSalesLowPressure = raw.steamSalesHighPressure = 0;
  const result = await harness(raw).collect(raw.targetDate);
  assert.equal(result.totalProduction, 0);
  assert.equal(result.steamSales, 0);
  assert.equal(result.averageSteamSales, 0);
  assert.equal(result.salesRate, null);
  assert.equal(result.productionComplete, true);
  assert.equal(result.salesComplete, true);
  assert.equal(result.generatorEcmsGen1, raw.generatorEcmsGen1);
});

test("missing cells remain null while other cards and workbook Plant287 remain available", async () => {
  const raw = fixture();
  Object.assign(raw, {
    unitOneProduction: null, steamSalesHighPressure: "", generatorEcmsGen1: null,
    ismartReception: null, solarDailyGeneration: null, organicDaySilo: null,
    coalUsageUnitOne: null, organicUsageUnitOne: "  ",
    fieldWarnings: [{ field: "unitOneProduction", cell: "Plant!F51", message: "빈 셀" }]
  });
  const result = await harness(raw).collect(raw.targetDate);
  for (const key of ["unitOneProduction", "steamSalesHighPressure", "generatorEcmsGen1", "ismartReception", "solarDailyGeneration", "organicDaySilo", "coalUsageUnitOne", "organicUsageUnitOne", "totalProduction", "steamSales", "averageSteamSales", "salesRate"]) assert.equal(result[key], null, key);
  assert.equal(result.unitTwoProduction, raw.unitTwoProduction);
  assert.equal(result.steamSalesLowPressure, raw.steamSalesLowPressure);
  assert.equal(result.epowerTransmission, raw.epowerTransmission);
  assert.equal(result.organicStorageSiloA, raw.organicStorageSiloA);
  assert.equal(result.organicSiloTotal, raw.organicSiloTotal);
  assert.equal(result.productionComplete, false);
  assert.equal(result.salesComplete, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.fieldWarnings)), raw.fieldWarnings);
});

test("missing Plant287 cannot be manufactured from complete Silo component values", async () => {
  const raw = fixture();
  raw.organicSiloTotal = null;
  const result = await harness(raw).collect(raw.targetDate);
  assert.equal(result.organicSiloTotal, null);
  assert.equal(result.organicDaySilo, raw.organicDaySilo);
});

test("an all-blank or Excel-error day cannot complete using only historical cumulative values", async () => {
  const raw = emptyDayFixture();
  await assert.rejects(harness(raw).collect(raw.targetDate), error => {
    assert.match(error.message, /선택일 2026-09-01/);
    assert.match(error.message, /26\.09-일일DATA관리\.xlsx/);
    assert.match(error.message, /기입된 숫자값이 없습니다/);
    assert.match(error.message, /Plant!F51 \/ #N\/A/);
    return true;
  });
});

test("a partial day containing only one Silo value, Plant287 or receipt amount can complete including zero", async () => {
  for (const key of ["organicDaySilo", "organicStorageSiloA", "organicStorageSiloB", "organicSiloTotal"]) {
    const raw = emptyDayFixture();
    raw[key] = 0;
    const result = await harness(raw).collect(raw.targetDate);
    assert.equal(result[key], 0, key);
    assert.equal(result.generatorEcmsGen1, null);
    assert.equal(result.unitOneProduction, null);
  }
  for (const amount of [0, 10.12345]) {
    const raw = emptyDayFixture();
    raw.sludgeEntries = [{ amount, cell: "Plant!F288" }];
    raw.sludgeTotal = amount;
    raw.sludgeTruckCount = amount > 0 ? 1 : 0;
    const result = await harness(raw).collect(raw.targetDate);
    assert.equal(result.sludgeEntries[0].amount, amount);
    assert.equal(result.sludgeTotal, amount);
    assert.equal(result.organicSiloTotal, null);
    assert.equal(result.totalProduction, null);
  }
});

test("month rollover requests the selected date each time and rejects August data for September", async () => {
  const { collect, calls } = harness(env => fixture(env.GS_STEAM_TARGET_DATE));
  for (const date of ["2026-08-31", "2026-09-01", "2026-08-31", "2027-01-01"]) {
    const result = await collect(date);
    assert.equal(result.sourceDate, date);
    assert.equal(result.workbook, `${date.slice(2, 4)}.${date.slice(5, 7)}-일일DATA관리.xlsx`);
  }
  assert.deepEqual(calls.map(call => call.GS_STEAM_TARGET_DATE), ["2026-08-31", "2026-09-01", "2026-08-31", "2027-01-01"]);
  await assert.rejects(harness({ ...fixture(), workbook: "26.08-일일DATA관리.xlsx" }).collect("2026-09-01"), /통합문서가 다릅니다/);
  await assert.rejects(harness({ ...fixture(), sourceDate: "2026-08-31" }).collect("2026-09-01"), /결과 날짜가 일치하지/);
});

test("malformed nonnumeric and negative payload cells cannot be accepted as workbook values", async () => {
  for (const key of ["unitOneProduction", "generatorEcmsGen1", "coalUsageUnitOne", "organicDaySilo", "organicSiloTotal"]) {
    for (const value of [true, -1, "#VALUE!", "123.4"]) {
      await assert.rejects(harness({ ...fixture(), [key]: value }).collect("2026-09-01"), /Excel 숫자/);
    }
  }
});

test("solar cumulative range and history correction metadata retain their existing contracts", async () => {
  const raw = fixture();
  raw.solarWeeklyCumulative = 800;
  raw.solarMonthlyCumulative = 391.3;
  raw.solarYearlyCumulative = 10000;
  raw.solarCumulative = {
    source: "Plant!55 태양광 일일 발전량",
    week: { complete: true, startDate: "2026-08-31", endDate: raw.targetDate },
    month: { complete: true, startDate: raw.targetDate, endDate: raw.targetDate },
    year: { complete: true, startDate: "2026-01-01", endDate: raw.targetDate },
    historyRows: [{ date: raw.targetDate, daily: 391.3, monthly: 391.3, yearly: 10000 }],
    sourceWorkbooks: [raw.workbookFullName], missingWorkbooks: [], errors: []
  };
  const result = await harness(raw).collect(raw.targetDate);
  assert.equal(result.solarCumulative.week.total, 800);
  assert.equal(result.solarCumulative.month.total, 391.3);
  assert.equal(result.solarCumulative.year.total, 10000);
  assert.equal(result.solarCumulative.year.complete, true);
  assert.equal(result.solarCumulative.year.startDate, "2026-01-01");
  assert.deepEqual(JSON.parse(JSON.stringify(result.solarHistoryRows)), raw.solarCumulative.historyRows);
});
