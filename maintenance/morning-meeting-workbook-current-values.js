/* MORNING MEETING FINAL WORKBOOK CURRENT SOURCES V8
 * Final workbook should mirror the values currently shown on the Morning Meeting cards.
 *
 * Current-source policy:
 * - First preserve same-date rendered card values that the operator can actually see.
 * - Then let canonical providers (TO / OIS / closing) overwrite only with finite values.
 * - Never start the removed Daily DATA Excel lookup.
 * - Never use a rendered value from a different date.
 */
(function installMorningMeetingWorkbookCurrentValues(root) {
  "use strict";

  if (!root || !root.document) return;

  const VERSION = "20260928-v8";
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
    /*
     * The Morning Meeting card date is the operational/source date.
     * Prefer an actually rendered card date over meeting/header dates.
     */
    const rendered = [
      displayedDate(IDS.powerDate),
      displayedDate(IDS.steamDate),
      displayedDate(IDS.organicDate)
    ].find(isDate);

    if (rendered) return rendered;

    const candidates = [
      root.morningMeetingClosedCofiring?.targetDate?.(),
      root.toNightPower?.targetDate?.(),
      doc.getElementById("efficiencyMorningMeetingWaterPanel")?.dataset?.morningMeetingAutoBaseDate,
      root.efficiencyMorningMeetingUploadState?.shiftPart?.reportDate,
      root.efficiencyMorningMeetingUploadState?.shiftPart?.loadedDate
    ];

    return candidates.map(text).find(isDate) || "";
  }

  function displayMatchesTarget(dateId, date) {
    const sourceDate = displayedDate(dateId);
    return !date || !sourceDate || sourceDate === date;
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

  async function mergePower(values, date, sourceErrors) {
    /* Visible same-date card values are retained even when TO row is not yet saved. */
    copyRenderedCard(values, POWER_KEYS, IDS.powerDate, date);

    const power = root.toNightPower;
    if (
      !date ||
      !power ||
      typeof power.ensureForWorkbook !== "function" ||
      typeof power.valuesForWorkbook !== "function"
    ) {
      return values;
    }

    try {
      await power.ensureForWorkbook(date);
      const provided = power.valuesForWorkbook({ ...values }, { targetDate: date }) || {};
      copyFiniteKeys(values, provided, POWER_KEYS, { overwrite: true });
    } catch (error) {
      sourceErrors.push({
        source: "power",
        message: text(error?.message) || "TO 전력 저장자료 확인 실패"
      });
    }

    return values;
  }

  function mergeSteam(values, date) {
    /* Preserve what is visibly shown first. */
    copyRenderedCard(values, STEAM_KEYS, IDS.steamDate, date);

    const raw =
      root.__morningMeetingSteamOisProbeLastResult &&
      typeof root.__morningMeetingSteamOisProbeLastResult === "object"
        ? root.__morningMeetingSteamOisProbeLastResult
        : null;

    const rawDate = text(raw?.sourceDate || raw?.targetDate);
    const sameDate = Boolean(raw) && (!date || !rawDate || rawDate === date);

    if (sameDate) {
      copyFiniteKeys(values, raw, STEAM_KEYS, { overwrite: true });
    }

    return values;
  }

  async function mergeOrganic(values, date, sourceErrors) {
    /*
     * Mirror the current card first. This does not start Daily DATA Excel lookup;
     * it only reads values already rendered on the Morning Meeting screen.
     */
    copyRenderedCard(values, ORGANIC_KEYS, IDS.organicDate, date);

    const closed = root.morningMeetingClosedCofiring;
    if (!date || !closed || typeof closed.valuesForWorkbook !== "function") {
      return values;
    }

    try {
      let provided = closed.valuesForWorkbook({ ...values }, { targetDate: date }) || {};
      copyFiniteKeys(values, provided, ORGANIC_KEYS, { overwrite: true });

      if (typeof closed.load === "function") {
        await closed.load(date);
        provided = closed.valuesForWorkbook({ ...values }, { targetDate: date }) || {};
        copyFiniteKeys(values, provided, ORGANIC_KEYS, { overwrite: true });
      }
    } catch (error) {
      sourceErrors.push({
        source: "organic",
        message: text(error?.message) || "유기성 마감자료 확인 실패"
      });
    }

    return values;
  }

  function getMissing(values) {
    return REQUIRED
      .filter(([key]) => finiteNumber(values?.[key]) === null)
      .map(([key, label]) => ({ key, label }));
  }

  async function collect(options = {}) {
    const date = isDate(options.targetDate) ? options.targetDate : targetDate();
    const values = {};
    const sourceErrors = [];

    await mergePower(values, date, sourceErrors);
    mergeSteam(values, date);
    await mergeOrganic(values, date, sourceErrors);

    const missing = getMissing(values);

    console.info("[MorningMeetingWorkbookCurrentValues V8]", {
      targetDate: date,
      values: { ...values },
      missing: missing.map(item => item.key),
      sourceErrors: sourceErrors.map(item => item.source)
    });

    return {
      version: VERSION,
      targetDate: date,
      values,
      missing,
      sourceErrors
    };
  }

  root.morningMeetingWorkbookCurrentValues = Object.freeze({
    version: VERSION,
    targetDate,
    collect,
    getMissing,
    finiteNumber
  });
})(typeof window === "object" ? window : null);
