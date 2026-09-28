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

function fullVisibleElements(date = "2026-09-21") {
  return {
    efficiencyMorningMeetingAutoDailyPowerDate: element(`${date} · 기존 저장값`),
    efficiencyMorningMeetingAutoDailyPowerStatus: element("TO 미입력 · 기존 저장값"),
    efficiencyMorningMeetingAutoDailyGeneratorEcmsGen1: element("4,062,287.3 kWh"),
    efficiencyMorningMeetingAutoDailyIsmartReception: element("366.3 kWh"),
    efficiencyMorningMeetingAutoDailyEpowerTransmission: element("3,547,320 kWh"),
    efficiencyMorningMeetingAutoDailySolarGeneration: element("495.9 kWh"),
    efficiencyMorningMeetingAutoSolarMonthlyCumulative: element("8,820.58 kWh"),
    efficiencyMorningMeetingAutoSolarYearlyCumulative: element("100,294.23 kWh"),

    efficiencyMorningMeetingAutoSteamDate: element(`${date} · 기존 저장값`),
    efficiencyMorningMeetingAutoSteamStatus: element("기존 저장값"),
    efficiencyMorningMeetingAutoSteamProductionUnitOne: element("6,441 ton"),
    efficiencyMorningMeetingAutoSteamProductionUnitTwo: element("6,416 ton"),
    efficiencyMorningMeetingAutoDailySteamSalesLowPressure: element("584.56 ton"),
    efficiencyMorningMeetingAutoDailySteamSalesHighPressure: element("99.03 ton"),

    efficiencyMorningMeetingAutoDailySludgeDate: element(`${date} · 기존 저장값`),
    efficiencyMorningMeetingAutoDailySludgeStatus: element("기존 저장값"),
    efficiencyMorningMeetingAutoDailySludgeTruckCount: element("5 건"),
    efficiencyMorningMeetingAutoDailySludgeTotal: element("145.36 t"),
    efficiencyMorningMeetingAutoDailyOrganicDaySilo: element("11.30 t"),
    efficiencyMorningMeetingAutoDailyOrganicStorageSiloA: element("20.24 t"),
    efficiencyMorningMeetingAutoDailyOrganicStorageSiloB: element("0.41 t")
  };
}

function installSandbox({ elements = {}, steam = null, power = null, closed = null, reportDate = "2026-09-22" } = {}) {
  const sandbox = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    document: {
      getElementById(id) {
        return elements[id] || null;
      }
    },
    efficiencyMorningMeetingUploadState: {
      shiftPart: { reportDate }
    },
    __morningMeetingSteamOisProbeLastResult: steam,
    toNightPower: power,
    morningMeetingClosedCofiring: closed
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  return sandbox;
}

function expectedVisibleValues() {
  return {
    generatorEcmsGen1: 4062287.3,
    ismartReception: 366.3,
    epowerTransmission: 3547320,
    solarDailyGeneration: 495.9,
    solarMonthlyCumulative: 8820.58,
    solarYearlyCumulative: 100294.23,
    unitOneProduction: 6441,
    unitTwoProduction: 6416,
    steamSalesLowPressure: 584.56,
    steamSalesHighPressure: 99.03,
    sludgeTruckCount: 5,
    sludgeTotal: 145.36,
    organicDaySilo: 11.3,
    organicStorageSiloA: 20.24,
    organicStorageSiloB: 0.41
  };
}

test("same-date rendered Morning Meeting cards populate all final-workbook values", async () => {
  const sandbox = installSandbox({
    elements: fullVisibleElements(),
    power: {
      targetDate: () => "2026-09-21",
      ensureForWorkbook: async () => {},
      valuesForWorkbook: value => value
    },
    closed: {
      targetDate: () => "2026-09-21",
      load: async () => null,
      valuesForWorkbook: value => value
    }
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  assert.equal(bundle.targetDate, "2026-09-21");
  assert.equal(bundle.missing.length, 0);
  for (const [key, value] of Object.entries(expectedVisibleValues())) {
    assert.equal(bundle.values[key], value, key);
  }
});

test("canonical providers overwrite rendered fallback only when they provide finite values", async () => {
  const elements = fullVisibleElements();
  const sandbox = installSandbox({
    elements,
    steam: {
      sourceDate: "2026-09-21",
      unitOneProduction: 7001,
      unitTwoProduction: 7002,
      steamSalesLowPressure: 701,
      steamSalesHighPressure: 702
    },
    power: {
      targetDate: () => "2026-09-21",
      ensureForWorkbook: async () => {},
      valuesForWorkbook: value => ({ ...value, generatorEcmsGen1: 9001 })
    },
    closed: {
      targetDate: () => "2026-09-21",
      load: async () => {},
      valuesForWorkbook: value => ({ ...value, organicDaySilo: 77.7 })
    }
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  assert.equal(bundle.values.generatorEcmsGen1, 9001);
  assert.equal(bundle.values.ismartReception, 366.3);
  assert.equal(bundle.values.unitOneProduction, 7001);
  assert.equal(bundle.values.steamSalesHighPressure, 702);
  assert.equal(bundle.values.organicDaySilo, 77.7);
  assert.equal(bundle.values.organicStorageSiloA, 20.24);
  assert.equal(bundle.missing.length, 0);
});

test("transient provider failures do not erase same-date visible values", async () => {
  const sandbox = installSandbox({
    elements: fullVisibleElements(),
    power: {
      targetDate: () => "2026-09-21",
      ensureForWorkbook: async () => { throw new Error("network"); },
      valuesForWorkbook: value => value
    },
    closed: {
      targetDate: () => "2026-09-21",
      load: async () => { throw new Error("network"); },
      valuesForWorkbook: value => value
    }
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  assert.equal(bundle.missing.length, 0);
  assert.equal(bundle.values.generatorEcmsGen1, 4062287.3);
  assert.equal(bundle.values.organicStorageSiloB, 0.41);
  assert.deepEqual(Array.from(bundle.sourceErrors, item => item.source).sort(), ["organic", "power"]);
});

test("stale rendered card values are not used for a different source date", async () => {
  const elements = fullVisibleElements("2026-09-20");
  const sandbox = installSandbox({
    elements,
    power: {
      targetDate: () => "2026-09-21",
      ensureForWorkbook: async () => {},
      valuesForWorkbook: value => value
    },
    closed: {
      targetDate: () => "2026-09-21",
      load: async () => null,
      valuesForWorkbook: value => value
    }
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect({ targetDate: "2026-09-21" });
  assert.equal(bundle.values.generatorEcmsGen1, undefined);
  assert.equal(bundle.values.unitOneProduction, undefined);
  assert.equal(bundle.values.organicDaySilo, undefined);
  assert.equal(bundle.missing.length, 15);
});

test("only genuinely blank visible fields remain missing", async () => {
  const elements = fullVisibleElements();
  elements.efficiencyMorningMeetingAutoDailySteamSalesLowPressure.textContent = "-";

  const sandbox = installSandbox({
    elements,
    power: {
      targetDate: () => "2026-09-21",
      ensureForWorkbook: async () => {},
      valuesForWorkbook: value => value
    },
    closed: {
      targetDate: () => "2026-09-21",
      load: async () => null,
      valuesForWorkbook: value => value
    }
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  assert.deepEqual(Array.from(bundle.missing, item => item.label), ["증기 판매량(저압)"]);
});

test("meeting date may be next day while rendered source date remains the workbook data date", async () => {
  const sandbox = installSandbox({
    elements: fullVisibleElements("2026-09-21"),
    reportDate: "2026-09-22",
    power: null,
    closed: null
  });

  const bundle = await sandbox.morningMeetingWorkbookCurrentValues.collect();
  assert.equal(bundle.targetDate, "2026-09-21");
  assert.equal(bundle.values.generatorEcmsGen1, 4062287.3);
  assert.equal(bundle.values.unitOneProduction, 6441);
  assert.equal(bundle.values.organicDaySilo, 11.3);
  assert.equal(bundle.missing.length, 0);
});
