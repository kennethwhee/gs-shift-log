"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "script.js"), "utf8");
const collectorSource = fs.readFileSync(path.join(root, "maintenance/morning-meeting-workbook-current-values.js"), "utf8");
const day = "2026-10-18";
const complete = {generatorEcmsGen1: 1200000, ismartReception: 10, epowerTransmission: 1000000, solarDailyGeneration: 200};
const partial = {...complete, ismartReception: null};

function section(start, end) {
  const left = main.indexOf(start);
  const right = main.indexOf(end, left + start.length);
  assert.ok(left >= 0 && right > left, start);
  return main.slice(left, right);
}

function payload(values = partial) {
  return {ok: true, targetDate: day, shift: "NS", role: "TO", unit: "kWh",
    item: {targetDate: day, shift: "NS", role: "TO", unit: "kWh", values},
    solarCumulative: {monthly: 3500, yearly: 40000}};
}

function normalizer() {
  const context = vm.createContext({});
  vm.runInContext(section("function autoHistoryCurrentFiniteNonNegative(", "async function autoHistoryCurrentMapLimit("), context);
  vm.runInContext(section("function normalizeAutoHistoryCurrentPower(", "function normalizeAutoHistoryCurrentOrganic("), context);
  return context.normalizeAutoHistoryCurrentPower;
}

function exportValues(values) {
  const cells = new Map();
  const context = vm.createContext({window: {}, setMorningMeetingNumericCellValue: (_document, address, value) => {
    cells.set(address, value); return {found: true, written: true};
  }});
  vm.runInContext(section("function applyMorningMeetingDailyDataValues(", "async function createMorningMeetingWorkbook("), context);
  context.applyMorningMeetingDailyDataValues({}, values, {targetDate: day, useSavedSnapshot: true});
  return cells;
}

test("automatic history accepts partial TO values and keeps complete rows unchanged", () => {
  const normalize = normalizer();
  const result = normalize(payload(), day);
  assert.equal(result.values.generatorEcmsGen1, 1200000);
  assert.equal(result.values.ismartReception, null);
  assert.equal(result.values.electricityReceived, null);
  assert.equal(result.values.solarMonthlyCumulative, 3500);
  assert.deepEqual(JSON.parse(JSON.stringify(normalize(payload(complete), day).values)), {
    ...complete, solarMonthlyCumulative: 3500, solarYearlyCumulative: 40000
  });
});

test("automatic history requires all four nullable keys and at least one actual number", () => {
  const normalize = normalizer();
  const blanks = Object.fromEntries(Object.keys(complete).map(key => [key, null]));
  assert.equal(normalize(payload(blanks), day), null);
  assert.equal(normalize(payload({...blanks, ismartReception: 0}), day).values.ismartReception, 0);
  const omitted = {...partial}; delete omitted.ismartReception;
  for (const values of [omitted, {...partial, ismartReception: ""}, {...partial, ismartReception: -1}, {...partial, solarDailyGeneration: Infinity}]) {
    assert.equal(normalize(payload(values), day), null);
  }
  assert.equal(normalize(payload(), "2026-10-17"), null);
  assert.equal(normalize({...payload(), item: {...payload().item, unit: "MWh"}}, day), null);
});

test("automatic history overlay and actual workbook leave missing reception blank despite a legacy alias", () => {
  const result = normalizer()(payload(), day);
  const old = {...complete, electricityReceived: 999, unitOneProduction: 123, sludgeTotal: 45};
  const cells = exportValues({...old, ...result.values});
  assert.equal(cells.get("AK7"), 1200);
  assert.equal(cells.get("AK8"), 1000);
  assert.equal(cells.get("AK9"), null);
  assert.equal(cells.get("H18"), 200);
  assert.equal(cells.get("E7"), 123);
  assert.equal(cells.get("AH14"), 45);
});

test("missing TO solar cannot restore legacy daily or cumulative solar values", () => {
  const result = normalizer()(payload({...partial, solarDailyGeneration: null}), day);
  const cells = exportValues({solarDaily: 900, solarMonthlyCumulative: 12345, solarYearlyCumulative: 54321,
    solarCumulative: {month: {total: 12345}, year: {total: 54321}}, ...result.values});
  for (const address of ["H18", "M18", "V18"]) assert.equal(cells.get(address), null, address);
});

function snapshot({values = {...partial, solarMonthlyCumulative: 3500, solarYearlyCumulative: 40000},
  receptionOverride, renderedDate = day, reset = false, providerError = false} = {}) {
  const element = textContent => ({textContent, dataset: {}});
  const elements = {
    efficiencyMorningMeetingAutoDailyPowerDate: element(renderedDate),
    efficiencyMorningMeetingAutoDailyGeneratorEcmsGen1: element("1,200,000 kWh"),
    efficiencyMorningMeetingAutoDailyIsmartReception: element("미입력"),
    efficiencyMorningMeetingAutoDailyEpowerTransmission: element("1,000,000 kWh"),
    efficiencyMorningMeetingAutoDailySolarGeneration: element(values.solarDailyGeneration === null ? "미입력" : "200 kWh")
  };
  const context = {
    document: {getElementById: id => elements[id] || null},
    isMorningMeetingSelectedDateResetActive: () => reset,
    toNightPower: {targetDate: () => day, valuesForWorkbook: () => {
      if (providerError) throw new Error("Wrong date");
      return values;
    }},
    morningMeetingCardOverrides: {overrideValues: () => receptionOverride === undefined ? {} : {ismartReception: receptionOverride}},
    morningMeetingLegacySavedDailyData: {peek: date => date === day ? {
      ...complete, electricityReceived: 999, solarMonthlyCumulative: 8888, solarYearlyCumulative: 99999,
      unitOneProduction: 123, sludgeTotal: 45
    } : null}
  };
  context.window = context;
  vm.runInNewContext(collectorSource, context);
  return context;
}

test("saved-card export does not fill a TO blank with older same-date data", () => {
  const bundle = snapshot().morningMeetingWorkbookCurrentValues.capture({targetDate: day});
  assert.equal(bundle.values.ismartReception, undefined);
  assert.ok(bundle.missing.some(item => item.key === "ismartReception"));
  assert.equal(bundle.values.generatorEcmsGen1, 1200000);
  assert.equal(bundle.values.solarMonthlyCumulative, 3500);
  assert.equal(bundle.values.unitOneProduction, 123);
  assert.equal(bundle.values.sludgeTotal, 45);
  assert.equal(exportValues(bundle.values).get("AK9"), null);
});

test("an explicit card override and a genuinely entered zero remain valid", () => {
  const override = snapshot({receptionOverride: 0}).morningMeetingWorkbookCurrentValues.capture({targetDate: day});
  assert.equal(override.values.ismartReception, 0);
  assert.equal(exportValues(override.values).get("AK9"), 0);
  const entered = snapshot({values: {...partial, ismartReception: 0}}).morningMeetingWorkbookCurrentValues.capture({targetDate: day});
  assert.equal(entered.values.ismartReception, 0);
});

test("saved-card export keeps solar and its cumulative fields missing together", () => {
  const values = {...partial, solarDailyGeneration: null, solarMonthlyCumulative: null, solarYearlyCumulative: null};
  const bundle = snapshot({values}).morningMeetingWorkbookCurrentValues.capture({targetDate: day});
  for (const key of ["solarDailyGeneration", "solarMonthlyCumulative", "solarYearlyCumulative"]) {
    assert.equal(bundle.values[key], undefined, key);
    assert.ok(bundle.missing.some(item => item.key === key), key);
  }
});

test("date and deletion guards still prevent cached partial values from leaking", () => {
  const cleared = snapshot({reset: true}).morningMeetingWorkbookCurrentValues.capture({targetDate: day});
  assert.equal(Object.keys(cleared.values).length, 0);
  const wrong = snapshot({providerError: true}).morningMeetingWorkbookCurrentValues.capture({targetDate: "2026-10-17"});
  assert.equal(Object.keys(wrong.values).length, 0);
  assert.equal(wrong.sourceErrors[0].source, "power");
});

test("daily-operation imports the three known TO fields without manufacturing zero reception", async () => {
  const source = require("../maintenance/daily-operation-sources.js");
  const requests = [];
  const request = async (url, options) => {
    requests.push(options.method);
    const parsed = new URL(url, "https://test.invalid");
    if (parsed.pathname === "/api/to-night-power") return payload();
    if (parsed.pathname === "/api/morning-meeting-card-overrides") return {ok: true, targetDate: day, items: {}};
    if (parsed.pathname === "/api/ois-data-requests" && parsed.searchParams.get("action") === "completed_history") {
      return {ok: true, items: [{targetDate: day, status: "complete", requestType: "daily_data_excel", result: {
        targetDate: day, ...complete, ismartReception: 999
      }}], overrides: [], resets: []};
    }
    throw new Error("Unexpected request: " + parsed.pathname);
  };
  const out = await source.collect(day, {request, missingFields: ["power_generation_daily", "power_export_daily", "power_import_daily", "power_solar_daily"]});
  assert.deepEqual(out.values, {power_generation_daily: 1200, power_export_daily: 1000, power_solar_daily: 200});
  assert.equal(out.values.power_import_daily, undefined);
  assert.ok(requests.every(method => method === "GET"));
});
