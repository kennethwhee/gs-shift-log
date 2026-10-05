/* MORNING MEETING SAVED WORKBOOK SNAPSHOT V1
 * Capture selected-date saved card values once. Export never refreshes sources.
 * Fill only missing fields from already-loaded, same-date saved providers.
 * Zero is a saved value. Reset/deleted dates and other dates never leak in.
 */
(function installMorningMeetingWorkbookCurrentValues(root) {
  "use strict";

  if (!root || !root.document) return;

  const VERSION = "20261005-saved-snapshot-v2";
  const doc = root.document;

  const IDS = Object.freeze({
    powerDate: "efficiencyMorningMeetingAutoDailyPowerDate",
    powerStatus: "efficiencyMorningMeetingAutoDailyPowerStatus",
    generatorEcmsGen1: "efficiencyMorningMeetingAutoDailyGeneratorEcmsGen1",
    ismartReception: "efficiencyMorningMeetingAutoDailyIsmartReception",
    epowerTransmission: "efficiencyMorningMeetingAutoDailyEpowerTransmission",
    solarDailyGeneration: "efficiencyMorningMeetingAutoDailySolarGeneration",
    solarMonthlyCumulative: "efficiencyMorningMeetingAutoSolarMonthlyCumulative",
    solarYearlyCumulative: "efficiencyMorningMeetingAutoSolarYearlyCumulative",

    steamDate: "efficiencyMorningMeetingAutoSteamDate",
    steamStatus: "efficiencyMorningMeetingAutoSteamStatus",
    steamSalesLowPressure: "efficiencyMorningMeetingAutoDailySteamSalesLowPressure",
    steamSalesHighPressure: "efficiencyMorningMeetingAutoDailySteamSalesHighPressure",
    unitOneProduction: "efficiencyMorningMeetingAutoSteamProductionUnitOne",
    unitTwoProduction: "efficiencyMorningMeetingAutoSteamProductionUnitTwo",

    organicDate: "efficiencyMorningMeetingAutoDailySludgeDate",
    organicStatus: "efficiencyMorningMeetingAutoDailySludgeStatus",
    sludgeTruckCount: "efficiencyMorningMeetingAutoDailySludgeTruckCount",
    sludgeTotal: "efficiencyMorningMeetingAutoDailySludgeTotal",
    organicDaySilo: "efficiencyMorningMeetingAutoDailyOrganicDaySilo",
    organicStorageSiloA: "efficiencyMorningMeetingAutoDailyOrganicStorageSiloA",
    organicStorageSiloB: "efficiencyMorningMeetingAutoDailyOrganicStorageSiloB"
  });

  const POWER_KEYS = Object.freeze([
    "generatorEcmsGen1",
    "ismartReception",
    "epowerTransmission",
    "solarDailyGeneration",
    "solarMonthlyCumulative",
    "solarYearlyCumulative"
  ]);

  const STEAM_KEYS = Object.freeze([
    "unitOneProduction",
    "unitTwoProduction",
    "steamSalesLowPressure",
    "steamSalesHighPressure"
  ]);

  const ORGANIC_KEYS = Object.freeze([
    "sludgeTruckCount",
    "sludgeTotal",
    "organicDaySilo",
    "organicStorageSiloA",
    "organicStorageSiloB"
  ]);

  const REQUIRED = Object.freeze([
    ["generatorEcmsGen1", "전력 발전량"],
    ["ismartReception", "전력 수전량"],
    ["epowerTransmission", "전력 송전량"],
    ["solarDailyGeneration", "태양광 일일 발전량"],
    ["solarMonthlyCumulative", "태양광 월간 누적"],
    ["solarYearlyCumulative", "태양광 년간 누적"],
    ["unitOneProduction", "증기 생산량 1호기"],
    ["unitTwoProduction", "증기 생산량 2호기"],
    ["steamSalesLowPressure", "증기 판매량(저압)"],
    ["steamSalesHighPressure", "증기 판매량(고압)"],
    ["sludgeTruckCount", "유기성 고형연료 입고 건수"],
    ["sludgeTotal", "유기성 고형연료 총 입고량"],
    ["organicDaySilo", "유기성 고형연료 Day Silo"],
    ["organicStorageSiloA", "유기성 고형연료 Storage A"],
    ["organicStorageSiloB", "유기성 고형연료 Storage B"]
  ]);

  function text(value) {
    return String(value ?? "").trim();
  }

  function isDate(value) {
    return /^20\d{2}-\d{2}-\d{2}$/.test(text(value));
  }

  function finiteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;

    const normalized = text(value).replaceAll(",", "");
    if (!normalized || normalized === "-") return null;

    const match = normalized.match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)/);
    if (!match) return null;

    const number = Number(match[0]);
    return Number.isFinite(number) ? number : null;
  }

  function elementText(id) {
    return text(doc.getElementById(id)?.textContent);
  }

  function elementNumber(id) {
    const element = doc.getElementById(id);
    if (!element) return null;

    const raw =
      element.dataset?.rawValue ??
      ("value" in element ? element.value : undefined) ??
      element.textContent;

    return finiteNumber(raw);
  }

  function displayedDate(id) {
    return elementText(id).match(/20\d{2}-\d{2}-\d{2}/)?.[0] || "";
  }

  function targetDate() {
    const candidates = [
      doc.getElementById("efficiencyMorningMeetingWaterPanel")?.dataset?.morningMeetingAutoBaseDate,
      root.morningMeetingClosedCofiring?.targetDate?.(),
      root.toNightPower?.targetDate?.(),
      displayedDate(IDS.powerDate),
      displayedDate(IDS.steamDate),
      displayedDate(IDS.organicDate),
      root.efficiencyMorningMeetingUploadState?.shiftPart?.reportDate,
      root.efficiencyMorningMeetingUploadState?.shiftPart?.loadedDate
    ];
    return candidates.map(text).find(isDate) || "";
  }

  function blocked(date) {
    return !isDate(date) ||
      root.isMorningMeetingSelectedDateResetActive?.(date) === true ||
      root.morningMeetingQuerySources?.resetState?.(date)?.active === true ||
      root.morningMeetingClosedCofiring?.isBlocked?.(date) === true;
  }

  function displayMatchesTarget(dateId, date) {
    return isDate(date) && displayedDate(dateId) === date;
  }

  function copyFiniteKeys(target, source, keys, { overwrite = true } = {}) {
    for (const key of keys) {
      const number = finiteNumber(source?.[key]);
      if (number === null) continue;
      if (!overwrite && finiteNumber(target[key]) !== null) continue;
      target[key] = number;
    }
    return target;
  }

  function copyRenderedCard(target, keys, dateId, date) {
    if (!displayMatchesTarget(dateId, date)) return target;

    for (const key of keys) {
      const number = elementNumber(IDS[key]);
      if (number !== null) target[key] = number;
    }

    return target;
  }

  function fillSaved(values, keys, sourceName, read, sourceErrors) {
    if (keys.every(key => finiteNumber(values[key]) !== null)) return;
    try { copyFiniteKeys(values, read(), keys, {overwrite: false}); }
    catch (error) {
      sourceErrors.push({source: sourceName, message: text(error?.message) || "저장값 확인 실패"});
    }
  }

  function legacyValues(date) {
    const saved = root.morningMeetingLegacySavedDailyData?.peek?.(date);
    if (!saved || typeof saved !== "object") return {};
    return {
      ...saved,
      generatorEcmsGen1: saved.generatorEcmsGen1 ?? saved.powerGeneration,
      ismartReception: saved.ismartReception ?? saved.electricityReceived,
      epowerTransmission: saved.epowerTransmission ?? saved.electricityTransmitted,
      solarDailyGeneration: saved.solarDailyGeneration ?? saved.solarDaily,
      solarMonthlyCumulative: saved.solarMonthlyCumulative ?? saved.solarCumulative?.month?.total,
      solarYearlyCumulative: saved.solarYearlyCumulative ?? saved.solarCumulative?.year?.total,
      sludgeTruckCount: saved.sludgeTruckCount ?? saved.organicTruckCount,
      sludgeTotal: saved.sludgeTotal ?? saved.organicReceivedAmount,
      organicDaySilo: saved.organicDaySilo ?? saved.organicDaySiloLevel,
      organicStorageSiloA: saved.organicStorageSiloA ?? saved.organicStorageSiloALevel,
      organicStorageSiloB: saved.organicStorageSiloB ?? saved.organicStorageSiloBLevel
    };
  }

  function getMissing(values) {
    return REQUIRED
      .filter(([key]) => finiteNumber(values?.[key]) === null)
      .map(([key, label]) => ({ key, label }));
  }

  function capture(options = {}) {
    const date = isDate(options.targetDate) ? options.targetDate : targetDate();
    const values = {};
    const sourceErrors = [];
    const cofiringValues = root.captureMorningMeetingCofiringExcelValues?.({targetDate: date}) || null;
    if (!blocked(date)) {
      // All cards are read synchronously before any provider or asynchronous work.
      copyRenderedCard(values, POWER_KEYS, IDS.powerDate, date);
      copyRenderedCard(values, STEAM_KEYS, IDS.steamDate, date);
      copyRenderedCard(values, ORGANIC_KEYS, IDS.organicDate, date);
      const allKeys = [...POWER_KEYS, ...STEAM_KEYS, ...ORGANIC_KEYS];
      fillSaved(values, allKeys, "cardOverrides", () =>
        root.morningMeetingCardOverrides?.overrideValues?.({}, date), sourceErrors);
      fillSaved(values, POWER_KEYS, "power", () =>
        root.toNightPower?.valuesForWorkbook?.({}, {targetDate: date}), sourceErrors);
      const steam = root.__morningMeetingSteamOisProbeLastResult;
      if (text(steam?.sourceDate || steam?.targetDate) === date) {
        copyFiniteKeys(values, steam, STEAM_KEYS, {overwrite: false});
      }
      fillSaved(values, ORGANIC_KEYS, "organic", () =>
        root.morningMeetingClosedCofiring?.valuesForWorkbook?.({}, {targetDate: date}), sourceErrors);
      fillSaved(values, allKeys, "legacy", () => legacyValues(date), sourceErrors);
    }
    return Object.freeze({
      version: VERSION, targetDate: date, savedSnapshot: true, cofiringValues,
      values: Object.freeze(values), missing: Object.freeze(getMissing(values)),
      sourceErrors: Object.freeze(sourceErrors)
    });
  }

  async function collect(options = {}) {
    return capture(options);
  }

  root.morningMeetingWorkbookCurrentValues = Object.freeze({
    version: VERSION,
    targetDate,
    collect,
    capture,
    getMissing,
    finiteNumber
  });
})(typeof window === "object" ? window : null);
