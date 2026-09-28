"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const sourcePath = path.resolve(__dirname, "..", "maintenance", "morning-meeting-workbook-current-values.js");
const source = fs.readFileSync(sourcePath, "utf8");

function element(textContent = "") {
  return { textContent, dataset: {} };
}

function installSandbox({ elements = {}, steam = null, power = null, closed = null } = {}) {
  const sandbox = {
    console,
    document: {
      getElementById(id) {
        return elements[id] || null;
      }
    },
    efficiencyMorningMeetingUploadState: {
      shiftPart: { reportDate: "2026-09-28" }
    },
    __morningMeetingSteamOisProbeLastResult: steam,
    toNightPower: power,
    morningMeetingClosedCofiring: closed
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  return sandbox;
}

function completeSteam() {
  return {
    sourceDate: "2026-09-28",
    unitOneProduction: 100,
    unitTwoProduction: 200,
    steamSalesLowPressure: 30,
    steamSalesHighPressure: 40
  };
}

function completePowerValues() {
  return {
    generatorEcmsGen1: 1000,
    ismartReception: 2000,
    epowerTransmission: 3000,
    solarDailyGeneration: 4000,
    solarMonthlyCumulative: 5000,
    solarYearlyCumulative: 6000
  };
}

function completeOrganicValues() {
  return {
    sludgeTruckCount: 5,
    sludgeTotal: 50,
    organicDaySilo: 10,
    organicStorageSiloA: 20,
    organicStorageSiloB: 30
  };
}

function canonicalOrganicProvider(values = completeOrganicValues()) {
  let loaded = false;
  return {
    targetDate: () => "2026-09-28",
    load: async date => {
      assert.equal(date, "2026-09-28");
      loaded = true;
    },
    valuesForWorkbook: value => loaded ? ({ ...value, ...values }) : value
  };
}

function canonicalPowerProvider(values = completePowerValues()) {
  return {
    targetDate: () => "2026-09-28",
    ensureForWorkbook: async date => assert.equal(date, "2026-09-28"),
    valuesForWorkbook: value => ({ ...value, ...values })
  };
}

test("collect uses current power, steam OIS and closing providers", async () => {
  const powerValues = completePowerValues();
  const organicValues = completeOrganicValues();
  let powerEnsured = false;
  let closedLoaded = false;
  let organicReady = false;

  const sandbox = installSandbox({
    steam: completeSteam(),
    power: {
      targetDate: () => "2026-09-28",
      ensureForWorkbook: async date => {
        assert.equal(date, "2026-09-28");
        powerEnsured = true;
      },
      valuesForWorkbook: value => ({ ...value, ...powerValues })
    },
    closed: {
      targetDate: () => "2026-09-28",
      load: async date => {
        assert.equal(date, "2026-09-28");
        closedLoaded = true;
        organicReady = true;
      },
      valuesForWorkbook: value => organicReady ? ({ ...value, ...organicValues }) : value
    }
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  assert.equal(powerEnsured, true);
  assert.equal(closedLoaded, true);
  for (const [key, value] of Object.entries({ ...powerValues, ...organicValues })) {
    assert.equal(bundle.values[key], value);
  }
  assert.equal(bundle.values.unitOneProduction, 100);
  assert.equal(bundle.values.unitTwoProduction, 200);
  assert.equal(bundle.values.steamSalesLowPressure, 30);
  assert.equal(bundle.values.steamSalesHighPressure, 40);
  assert.equal(bundle.missing.length, 0);
});

test("retained TO card and saved steam card are fallback after transient provider failure", async () => {
  const elements = {
    efficiencyMorningMeetingAutoDailyPowerDate: element("2026-09-28 · TO 저장자료"),
    efficiencyMorningMeetingAutoDailyPowerStatus: element("재조회 실패 · 마지막 저장값 유지"),
    efficiencyMorningMeetingAutoDailyGeneratorEcmsGen1: element("1,000 kWh"),
    efficiencyMorningMeetingAutoDailyIsmartReception: element("2,000 kWh"),
    efficiencyMorningMeetingAutoDailyEpowerTransmission: element("3,000 kWh"),
    efficiencyMorningMeetingAutoDailySolarGeneration: element("4,000 kWh"),
    efficiencyMorningMeetingAutoSolarMonthlyCumulative: element("5,000 kWh"),
    efficiencyMorningMeetingAutoSolarYearlyCumulative: element("6,000 kWh"),
    efficiencyMorningMeetingAutoSteamDate: element("2026-09-28 · 저장값"),
    efficiencyMorningMeetingAutoSteamStatus: element("기존 저장값"),
    efficiencyMorningMeetingAutoSteamProductionUnitOne: element("100 ton"),
    efficiencyMorningMeetingAutoSteamProductionUnitTwo: element("200 ton"),
    efficiencyMorningMeetingAutoDailySteamSalesLowPressure: element("30 ton"),
    efficiencyMorningMeetingAutoDailySteamSalesHighPressure: element("40 ton")
  };

  const sandbox = installSandbox({
    elements,
    power: {
      targetDate: () => "2026-09-28",
      ensureForWorkbook: async () => { throw new Error("network"); },
      valuesForWorkbook: value => value
    },
    closed: canonicalOrganicProvider()
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  assert.equal(bundle.missing.length, 0);
  assert.equal(bundle.values.generatorEcmsGen1, 1000);
  assert.equal(bundle.values.steamSalesLowPressure, 30);
  assert.equal(bundle.values.organicStorageSiloB, 30);
  assert.equal(bundle.sourceErrors.length, 1);
  assert.equal(bundle.sourceErrors[0].source, "power");
});

test("only genuinely missing fields are reported", async () => {
  const steam = completeSteam();
  delete steam.steamSalesLowPressure;

  const sandbox = installSandbox({
    steam,
    power: canonicalPowerProvider(),
    closed: canonicalOrganicProvider()
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  assert.deepEqual(Array.from(bundle.missing, item => item.label), ["증기 판매량(저압)"]);
});

test("stale displayed date is not used as steam fallback", async () => {
  const elements = {
    efficiencyMorningMeetingAutoSteamDate: element("2026-09-27 · OIS"),
    efficiencyMorningMeetingAutoSteamStatus: element("OIS 완료"),
    efficiencyMorningMeetingAutoSteamProductionUnitOne: element("999 ton"),
    efficiencyMorningMeetingAutoSteamProductionUnitTwo: element("999 ton"),
    efficiencyMorningMeetingAutoDailySteamSalesLowPressure: element("999 ton"),
    efficiencyMorningMeetingAutoDailySteamSalesHighPressure: element("999 ton")
  };

  const sandbox = installSandbox({
    elements,
    steam: { ...completeSteam(), sourceDate: "2026-09-27" },
    power: canonicalPowerProvider(),
    closed: canonicalOrganicProvider()
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  const missing = new Set(Array.from(bundle.missing, item => item.key));
  assert.equal(missing.has("unitOneProduction"), true);
  assert.equal(missing.has("steamSalesLowPressure"), true);
});

test("legacy Daily DATA power display is not accepted as TO workbook source", async () => {
  const elements = {
    efficiencyMorningMeetingAutoDailyPowerDate: element("2026-09-28 · 기존 저장값"),
    efficiencyMorningMeetingAutoDailyPowerStatus: element("TO 미입력 · 기존 저장값"),
    efficiencyMorningMeetingAutoDailyGeneratorEcmsGen1: element("1,000 kWh"),
    efficiencyMorningMeetingAutoDailyIsmartReception: element("2,000 kWh"),
    efficiencyMorningMeetingAutoDailyEpowerTransmission: element("3,000 kWh"),
    efficiencyMorningMeetingAutoDailySolarGeneration: element("4,000 kWh"),
    efficiencyMorningMeetingAutoSolarMonthlyCumulative: element("5,000 kWh"),
    efficiencyMorningMeetingAutoSolarYearlyCumulative: element("6,000 kWh")
  };

  const sandbox = installSandbox({
    elements,
    steam: completeSteam(),
    power: {
      targetDate: () => "2026-09-28",
      ensureForWorkbook: async () => {},
      valuesForWorkbook: value => value
    },
    closed: canonicalOrganicProvider()
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  const missing = new Set(Array.from(bundle.missing, item => item.key));
  for (const key of Object.keys(completePowerValues())) {
    assert.equal(missing.has(key), true, `${key} must remain missing`);
  }
  assert.equal(bundle.values.generatorEcmsGen1, undefined);
});

test("legacy Daily DATA organic display is not accepted as closing workbook source", async () => {
  const elements = {
    efficiencyMorningMeetingAutoDailySludgeDate: element("2026-09-28 · 기존 저장값"),
    efficiencyMorningMeetingAutoDailySludgeStatus: element("기존 저장값"),
    efficiencyMorningMeetingAutoDailySludgeTruckCount: element("5 건"),
    efficiencyMorningMeetingAutoDailySludgeTotal: element("50 t"),
    efficiencyMorningMeetingAutoDailyOrganicDaySilo: element("10 t"),
    efficiencyMorningMeetingAutoDailyOrganicStorageSiloA: element("20 t"),
    efficiencyMorningMeetingAutoDailyOrganicStorageSiloB: element("30 t")
  };

  const sandbox = installSandbox({
    elements,
    steam: completeSteam(),
    power: canonicalPowerProvider(),
    closed: {
      targetDate: () => "2026-09-28",
      load: async () => {},
      valuesForWorkbook: value => value
    }
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  const missing = new Set(Array.from(bundle.missing, item => item.key));
  for (const key of Object.keys(completeOrganicValues())) {
    assert.equal(missing.has(key), true, `${key} must remain missing`);
  }
  assert.equal(bundle.values.organicDaySilo, undefined);
});
