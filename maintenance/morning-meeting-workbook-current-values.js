/* MORNING MEETING FINAL WORKBOOK CURRENT SOURCES V7
 * Build the final-workbook automatic-value object from the current owners:
 * - Power + solar: N/S TO saved values (toNightPower)
 * - Steam: current OIS result, with a source-owned/saved rendered card fallback
 * - Organic: selected-day saved co-firing closing values
 *
 * Important:
 * - This module NEVER starts Daily DATA Excel lookup.
 * - Power DOM fallback is accepted only when the card proves TO ownership
 *   (TO input complete / retained last saved TO value).
 * - Organic values are accepted only from the selected-day closing provider;
 *   legacy Daily DATA saved display fallback is NOT a workbook source.
 */
(function installMorningMeetingWorkbookCurrentValues(root) {
  "use strict";

  if (!root || !root.document) return;
  if (root.morningMeetingWorkbookCurrentValues) return;

  const VERSION = "20260928-v7";
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
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

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
    const value = elementText(id);
    return value.match(/20\d{2}-\d{2}-\d{2}/)?.[0] || "";
  }

  function displayMatchesTarget(dateId, targetDate) {
    const sourceDate = displayedDate(dateId);
    return !targetDate || !sourceDate || sourceDate === targetDate;
  }

  function targetDate() {
    const candidates = [
      root.toNightPower?.targetDate?.(),
      root.morningMeetingClosedCofiring?.targetDate?.(),
      doc.getElementById("efficiencyMorningMeetingWaterPanel")?.dataset?.morningMeetingAutoBaseDate,
      root.efficiencyMorningMeetingUploadState?.shiftPart?.reportDate,
      root.efficiencyMorningMeetingUploadState?.shiftPart?.loadedDate,
      displayedDate(IDS.powerDate),
      displayedDate(IDS.steamDate),
      displayedDate(IDS.organicDate)
    ];

    return candidates.map(text).find(isDate) || "";
  }

  function hasAnyNumber(values, keys) {
    return keys.some(key => finiteNumber(values?.[key]) !== null);
  }

  function fillMissingFromDom(values, keys, dateId, date) {
    if (!displayMatchesTarget(dateId, date)) return values;

    for (const key of keys) {
      if (finiteNumber(values[key]) !== null) continue;
      const number = elementNumber(IDS[key]);
      if (number !== null) values[key] = number;
    }

    return values;
  }

  function powerCardProvesCurrentSource(date) {
    if (!displayMatchesTarget(IDS.powerDate, date)) return false;

    const status = elementText(IDS.powerStatus);

    /*
     * Allowed:
     * - TO 입력 완료
     * - 재조회 실패 · 마지막 저장값 유지
     * - 재확인 중 · 마지막 저장값 유지
     *
     * Intentionally NOT allowed:
     * - TO 미입력 · 기존 저장값
     *   (legacy Daily DATA saved display fallback)
     */
    return /TO\s*입력\s*완료|마지막\s*저장값\s*유지/.test(status);
  }

  function steamCardProvesUsableSource(date) {
    if (!displayMatchesTarget(IDS.steamDate, date)) return false;

    const status = elementText(IDS.steamStatus);

    /*
     * Steam policy is OIS / saved value.
     * "기존 저장값" is an already-saved, read-only fallback; this helper does
     * not launch the removed Daily DATA Excel lookup.
     */
    return /OIS\s*완료|기존\s*저장값|마지막\s*저장값\s*유지/.test(status);
  }

  async function mergePower(values, date, sourceErrors) {
    const power = root.toNightPower;
    let providerSucceeded = false;

    if (
      date &&
      power &&
      typeof power.ensureForWorkbook === "function" &&
      typeof power.valuesForWorkbook === "function"
    ) {
      try {
        await power.ensureForWorkbook(date);
        Object.assign(
          values,
          power.valuesForWorkbook(values, { targetDate: date }) || {}
        );
        providerSucceeded = true;
      } catch (error) {
        sourceErrors.push({
          source: "power",
          message: text(error?.message) || "TO 전력 저장자료 확인 실패"
        });
      }
    }

    /*
     * If the canonical provider answered successfully, its result is final.
     * Do not backfill missing TO fields from a legacy rendered value.
     */
    if (providerSucceeded) return values;

    /*
     * On a transient provider error, only retain values when the rendered card
     * explicitly proves it is a TO-owned last saved value.
     */
    if (powerCardProvesCurrentSource(date)) {
      fillMissingFromDom(values, POWER_KEYS, IDS.powerDate, date);
    }

    return values;
  }

  function mergeSteam(values, date) {
    const raw =
      root.__morningMeetingSteamOisProbeLastResult &&
      typeof root.__morningMeetingSteamOisProbeLastResult === "object"
        ? root.__morningMeetingSteamOisProbeLastResult
        : null;

    const rawDate = text(raw?.sourceDate || raw?.targetDate);
    const sameDate = Boolean(raw) && (!date || !rawDate || rawDate === date);

    if (sameDate) {
      for (const key of STEAM_KEYS) {
        const number = finiteNumber(raw[key]);
        if (number !== null) values[key] = number;
      }
    }

    if (hasAnyNumber(values, STEAM_KEYS) && STEAM_KEYS.every(key => finiteNumber(values[key]) !== null)) {
      return values;
    }

    if (steamCardProvesUsableSource(date)) {
      fillMissingFromDom(values, STEAM_KEYS, IDS.steamDate, date);
    }

    return values;
  }

  async function mergeOrganic(values, date, sourceErrors) {
    const closed = root.morningMeetingClosedCofiring;

    if (
      !date ||
      !closed ||
      typeof closed.valuesForWorkbook !== "function"
    ) {
      return values;
    }

    /*
     * Reuse an already-loaded selected-day closing value first. This avoids
     * throwing away a currently valid closing value merely because a refresh
     * endpoint is temporarily unavailable.
     */
    try {
      const existing = closed.valuesForWorkbook(values, { targetDate: date }) || {};
      Object.assign(values, existing);
      if (ORGANIC_KEYS.every(key => finiteNumber(values[key]) !== null)) {
        return values;
      }
    } catch (error) {
      /* Keep going: a load below may make the selected closing available. */
    }

    try {
      if (typeof closed.load === "function") {
        await closed.load(date);
      }

      Object.assign(
        values,
        closed.valuesForWorkbook(values, { targetDate: date }) || {}
      );
    } catch (error) {
      sourceErrors.push({
        source: "organic",
        message: text(error?.message) || "유기성 마감자료 확인 실패"
      });
    }

    /*
     * Deliberately NO DOM fallback here.
     * The organic card can be rendered from legacy Daily DATA saved fallback,
     * but final workbook organic values must come from the selected-day closing.
     */
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
