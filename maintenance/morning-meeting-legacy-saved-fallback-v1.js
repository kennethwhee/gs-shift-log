/*
 * Morning Meeting legacy saved-value fallback V13.
 *
 * Purpose:
 * - Reuse already-completed historical daily_data_excel results when the new
 *   source-owned card has no value yet.
 * - Never opens Excel, never starts Agent work, never creates an OIS request.
 * - Current sources always win: TO power / steam OIS / co-firing closed data.
 */
(function installMorningMeetingLegacySavedFallback(root) {
  "use strict";

  const VERSION = "20260928-v13";
  if (!root || !root.document) return;
  if (root.morningMeetingLegacySavedDailyData?.version === VERSION) return;

  const doc = root.document;
  const HISTORY_API = "/api/ois-data-requests";
  const SETTINGS_API = "/api/morning-meeting-cofiring-settings";
  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const POWER_PREFIX = "efficiencyMorningMeetingAutoDaily";

  const cache = new Map();
  const pending = new Map();
  const settingsCache = new Map();
  const settingsPending = new Map();
  let renderTimer = null;
  let loadTimer = null;
  let observedDate = "";
  let observer = null;

  const POWER_FIELDS = Object.freeze({
    generatorEcmsGen1: ["generatorEcmsGen1", "powerGeneration"],
    ismartReception: ["ismartReception", "electricityReceived"],
    epowerTransmission: ["epowerTransmission", "electricityTransmitted"],
    solarDailyGeneration: ["solarDailyGeneration", "solarDaily"],
    solarMonthlyCumulative: ["solarMonthlyCumulative", "solarCumulative.month.total"],
    solarYearlyCumulative: ["solarYearlyCumulative", "solarCumulative.year.total"]
  });

  const POWER_IDS = Object.freeze({
    generatorEcmsGen1: POWER_PREFIX + "GeneratorEcmsGen1",
    ismartReception: POWER_PREFIX + "IsmartReception",
    epowerTransmission: POWER_PREFIX + "EpowerTransmission",
    solarDailyGeneration: POWER_PREFIX + "SolarGeneration",
    solarMonthlyCumulative: "efficiencyMorningMeetingAutoSolarMonthlyCumulative",
    solarYearlyCumulative: "efficiencyMorningMeetingAutoSolarYearlyCumulative"
  });

  const STEAM_FIELDS = Object.freeze({
    steamSalesLowPressure: ["steamSalesLowPressure"],
    steamSalesHighPressure: ["steamSalesHighPressure"],
    steamSales: ["steamSales"],
    unitOneProduction: ["unitOneProduction"],
    unitTwoProduction: ["unitTwoProduction"],
    totalProduction: ["totalProduction"]
  });

  const STEAM_IDS = Object.freeze({
    steamSalesLowPressure: "efficiencyMorningMeetingAutoDailySteamSalesLowPressure",
    steamSalesHighPressure: "efficiencyMorningMeetingAutoDailySteamSalesHighPressure",
    steamSales: "efficiencyMorningMeetingAutoSteamSales",
    unitOneProduction: "efficiencyMorningMeetingAutoSteamProductionUnitOne",
    unitTwoProduction: "efficiencyMorningMeetingAutoSteamProductionUnitTwo",
    totalProduction: "efficiencyMorningMeetingAutoSteamProductionTotal"
  });

  const ORGANIC_IDS = Object.freeze({
    sludgeTruckCount: POWER_PREFIX + "SludgeTruckCount",
    sludgeTotal: POWER_PREFIX + "SludgeTotal",
    organicDaySilo: POWER_PREFIX + "OrganicDaySilo",
    organicStorageSiloA: POWER_PREFIX + "OrganicStorageSiloA",
    organicStorageSiloB: POWER_PREFIX + "OrganicStorageSiloB",
    organicSiloTotal: POWER_PREFIX + "OrganicSiloTotal"
  });

  const COFIRING_IDS = Object.freeze({
    unitOneCoal: "efficiencyMorningMeetingCofiringUnit1CoalUsage",
    unitOneBio: "efficiencyMorningMeetingCofiringUnit1BioUsage",
    unitOneBioRatio: "efficiencyMorningMeetingCofiringUnit1BioRatio",
    unitTwoCoal: "efficiencyMorningMeetingCofiringUnit2CoalUsage",
    unitTwoBio: "efficiencyMorningMeetingCofiringUnit2BioUsage",
    unitTwoBioRatio: "efficiencyMorningMeetingCofiringUnit2BioRatio",
    unitOneOrganic: "efficiencyMorningMeetingCofiringUnit1OrganicInput",
    unitOneOrganicRatio: "efficiencyMorningMeetingCofiringUnit1OrganicRatio",
    unitOneTotalRatio: "efficiencyMorningMeetingCofiringUnit1TotalRatio",
    unitTwoOrganic: "efficiencyMorningMeetingCofiringUnit2OrganicInput",
    unitTwoOrganicRatio: "efficiencyMorningMeetingCofiringUnit2OrganicRatio",
    unitTwoTotalRatio: "efficiencyMorningMeetingCofiringUnit2TotalRatio"
  });

  const byId = id => doc.getElementById(id);
  const text = value => String(value ?? "").trim();
  const number = value => {
    if (value === null || value === undefined || text(value) === "") return null;
    const numeric = Number(String(value).replaceAll(",", ""));
    return Number.isFinite(numeric) ? numeric : null;
  };

  function dateValid(value) {
    const date = text(value);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(date + "T00:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }

  function targetDate() {
    const closedDate = root.morningMeetingClosedCofiring?.targetDate?.();
    if (dateValid(closedDate)) return closedDate;
    const panelDate = byId(PANEL_ID)?.dataset?.morningMeetingAutoBaseDate;
    if (dateValid(panelDate)) return panelDate;
    const state = root.efficiencyMorningMeetingUploadState || {};
    const candidates = [state.shiftPart?.reportDate, state.shiftPart?.loadedDate];
    for (const candidate of candidates) if (dateValid(candidate)) return candidate;
    return "";
  }

  function blocked(date) {
    if (!dateValid(date)) return true;
    return root.isMorningMeetingSelectedDateResetActive?.(date) === true ||
      root.morningMeetingQuerySources?.resetState?.(date)?.active === true ||
      root.morningMeetingClosedCofiring?.isBlocked?.(date) === true;
  }

  function authHeaders() {
    const headers = new Headers(
      typeof root.getShiftLogAuthHeaders === "function"
        ? root.getShiftLogAuthHeaders()
        : {}
    );
    if (!headers.get("Authorization")) {
      const token = typeof root.getShiftLogSessionToken === "function"
        ? root.getShiftLogSessionToken()
        : typeof getShiftLogSessionToken === "function"
          ? getShiftLogSessionToken()
          : "";
      if (token) headers.set("Authorization", "Bearer " + token);
    }
    headers.set("Accept", "application/json");
    return headers;
  }

  function readPath(source, path) {
    return String(path).split(".").reduce((value, key) => value?.[key], source);
  }

  function firstNumber(source, paths) {
    for (const path of paths) {
      const value = number(readPath(source, path));
      if (value !== null) return value;
    }
    return null;
  }

  function strictLegacyItem(payload, date) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.find(item => {
      if (text(item?.targetDate) !== date) return false;
      // sourceRequestType is authoritative when the server also exposes the
      // compatibility-normalized requestType. This keeps steam_status separate.
      const actualType = text(item?.sourceRequestType || item?.requestType).toLowerCase();
      if (actualType !== "daily_data_excel") return false;
      return item?.result && typeof item.result === "object" && !Array.isArray(item.result);
    }) || null;
  }

  async function getJson(url, fallbackMessage) {
    const controller = new AbortController();
    const timeout = root.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await root.fetch(url, {
        method: "GET",
        headers: authHeaders(),
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(text(payload?.message || payload?.error) || fallbackMessage);
      }
      return payload;
    } finally {
      root.clearTimeout(timeout);
    }
  }

  function notify(date) {
    doc.dispatchEvent(new CustomEvent("morningMeetingLegacySavedDailyDataChanged", {
      detail: {targetDate: date, state: state(date)}
    }));
    scheduleRender();
  }

  function invalidate(date) {
    if (dateValid(date)) cache.delete(date);
  }

  function state(date = targetDate()) {
    if (!dateValid(date) || blocked(date)) return {status: "idle", item: null, result: null, error: ""};
    return cache.get(date) || {status: "idle", item: null, result: null, error: ""};
  }

  function peek(date = targetDate()) {
    const entry = state(date);
    return entry.status === "complete" ? entry.result : null;
  }

  async function load(date = targetDate(), options = {}) {
    if (!dateValid(date) || blocked(date) || typeof root.fetch !== "function") return null;
    const existing = cache.get(date);
    if (options.force !== true && existing && ["complete", "missing"].includes(existing.status)) {
      scheduleRender();
      return existing.result || null;
    }
    if (pending.has(date)) return pending.get(date);

    cache.set(date, {status: "loading", item: existing?.item || null, result: existing?.result || null, error: ""});
    notify(date);

    const promise = (async () => {
      try {
        const params = new URLSearchParams({
          action: "completed_history",
          startDate: date,
          endDate: date,
          _: String(Date.now())
        });
        const payload = await getJson(HISTORY_API + "?" + params, "저장된 자동수치를 불러오지 못했습니다.");
        if (blocked(date) || targetDate() !== date) return null;
        const item = strictLegacyItem(payload, date);
        const result = item?.result && typeof item.result === "object" ? item.result : null;
        cache.set(date, {status: result ? "complete" : "missing", item, result, error: ""});
        return result;
      } catch (error) {
        const previous = cache.get(date);
        cache.set(date, {
          status: previous?.result ? "complete" : "error",
          item: previous?.item || null,
          result: previous?.result || null,
          error: text(error?.message) || "기존 저장값 조회 실패"
        });
        if (!previous?.result) console.warn("오전회의 기존 저장값 조회 실패:", error);
        return previous?.result || null;
      } finally {
        pending.delete(date);
        notify(date);
      }
    })();
    pending.set(date, promise);
    return promise;
  }

  async function loadSettings(date) {
    if (!dateValid(date)) return null;
    if (settingsCache.has(date)) return settingsCache.get(date);
    if (settingsPending.has(date)) return settingsPending.get(date);
    const promise = (async () => {
      try {
        const params = new URLSearchParams({targetDate: date, _: String(Date.now())});
        const payload = await getJson(SETTINGS_API + "?" + params, "발열량 설정을 불러오지 못했습니다.");
        const setting = payload?.setting && typeof payload.setting === "object" ? payload.setting : null;
        settingsCache.set(date, setting);
        return setting;
      } catch {
        settingsCache.set(date, null);
        return null;
      } finally {
        settingsPending.delete(date);
        scheduleRender();
      }
    })();
    settingsPending.set(date, promise);
    return promise;
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function setDataset(element, key, value) {
    if (!element) return;
    if (value === null) {
      if (Object.hasOwn(element.dataset, key)) delete element.dataset[key];
      return;
    }
    if (element.dataset[key] !== value) element.dataset[key] = value;
  }

  function setFallbackBadge(element, label) {
    if (!element) return;
    setText(element, label);
    for (const stateName of ["loading", "error", "complete", "failed"]) {
      element.classList.toggle("is-" + stateName, stateName === "complete");
    }
    element.title = "새 자료가 없어서 이미 저장된 과거 조회값을 표시합니다. Excel을 다시 조회하지 않습니다.";
  }

  function markFallback(card, active, title) {
    if (!card) return;
    setDataset(card, "legacySavedFallback", active ? "true" : null);
    if (active && title && card.title !== title) card.title = title;
  }

  function format(value, unit, minimumFractionDigits = 0, maximumFractionDigits = 2) {
    const numeric = number(value);
    if (numeric === null) return "-";
    return numeric.toLocaleString("ko-KR", {minimumFractionDigits, maximumFractionDigits}) + (unit ? (unit === "%" ? "%" : " " + unit) : "");
  }

  function hasDigits(element) {
    return /\d/.test(text(element?.textContent));
  }

  function currentPowerOwns(date) {
    try {
      const current = root.toNightPower?.valuesForWorkbook?.({}, {targetDate: date});
      if (current && ["generatorEcmsGen1", "ismartReception", "epowerTransmission", "solarDailyGeneration"]
        .some(key => number(current[key]) !== null)) return true;
    } catch {
      // A pending current-source read is handled by the DOM status below.
    }
    const badge = text(byId(POWER_PREFIX + "PowerStatus")?.textContent);
    return /TO 입력 완료|마지막 저장값 유지/.test(badge) &&
      ["GeneratorEcmsGen1", "IsmartReception", "EpowerTransmission", "SolarGeneration"]
        .some(suffix => hasDigits(byId(POWER_PREFIX + suffix)));
  }

  function renderPower(date, result) {
    const card = byId(POWER_PREFIX + "PowerCard");
    if (!card) return;
    if (currentPowerOwns(date)) {
      markFallback(card, false);
      return;
    }
    const values = Object.fromEntries(Object.entries(POWER_FIELDS).map(([key, paths]) => [key, firstNumber(result, paths)]));
    if (![values.generatorEcmsGen1, values.ismartReception, values.epowerTransmission, values.solarDailyGeneration]
      .some(value => value !== null)) return;

    for (const [key, id] of Object.entries(POWER_IDS)) {
      setText(byId(id), format(values[key], "kWh", 0, 6));
    }
    setText(byId(POWER_PREFIX + "PowerDate"), date + " · 기존 저장값");
    setFallbackBadge(byId(POWER_PREFIX + "PowerStatus"), "TO 미입력 · 기존 저장값");
    markFallback(card, true, date + " 기존 자동수치 저장값 · Excel 재조회 없음");
  }

  function currentSteamOwns(date) {
    const probe = root.__morningMeetingSteamOisProbeLastResult;
    if (probe && text(probe.sourceDate || probe.targetDate) === date &&
        Object.keys(STEAM_FIELDS).some(key => number(probe[key]) !== null)) return true;
    const stateValue = root.efficiencyMorningMeetingUploadState?.steamStatus;
    const stateDate = text(stateValue?.sourceDate || stateValue?.targetDate);
    const badge = text(byId("efficiencyMorningMeetingAutoSteamStatus")?.textContent);
    return stateDate === date && /OIS 완료/.test(badge) &&
      Object.keys(STEAM_FIELDS).some(key => number(stateValue?.[key]) !== null);
  }

  function renderSteam(date, result) {
    const card = byId("efficiencyMorningMeetingAutoSteamCard");
    if (!card) return;
    if (currentSteamOwns(date)) {
      markFallback(card, false);
      return;
    }
    const values = Object.fromEntries(Object.entries(STEAM_FIELDS).map(([key, paths]) => [key, firstNumber(result, paths)]));
    if (values.steamSales === null && values.steamSalesLowPressure !== null && values.steamSalesHighPressure !== null) {
      values.steamSales = values.steamSalesLowPressure + values.steamSalesHighPressure;
    }
    if (values.totalProduction === null && values.unitOneProduction !== null && values.unitTwoProduction !== null) {
      values.totalProduction = values.unitOneProduction + values.unitTwoProduction;
    }
    if (!Object.values(values).some(value => value !== null)) return;

    for (const [key, id] of Object.entries(STEAM_IDS)) setText(byId(id), format(values[key], "ton", 0, 3));
    setText(byId("efficiencyMorningMeetingAutoSteamDate"), date + " · 기존 저장값");
    setFallbackBadge(byId("efficiencyMorningMeetingAutoSteamStatus"), "기존 저장값");
    markFallback(card, true, date + " 기존 자동수치 저장값 · OIS 신규값이 생기면 자동 우선");
  }

  function closedOwns(date) {
    const provider = root.morningMeetingClosedCofiring;
    if (!provider || provider.isBlocked?.(date) === true) return false;
    try {
      const item = provider.peek?.(date);
      return Boolean(item && item.targetDate === date);
    } catch {
      return false;
    }
  }

  function organicValues(result) {
    const day = firstNumber(result, ["organicDaySilo", "organicDaySiloLevel"]);
    const a = firstNumber(result, ["organicStorageSiloA", "organicStorageSiloALevel"]);
    const b = firstNumber(result, ["organicStorageSiloB", "organicStorageSiloBLevel"]);
    let total = firstNumber(result, ["organicSiloTotal"]);
    if (total === null && [day, a, b].every(value => value !== null)) total = day + a + b;
    return {
      sludgeTruckCount: firstNumber(result, ["sludgeTruckCount", "organicTruckCount"]),
      sludgeTotal: firstNumber(result, ["sludgeTotal", "organicReceivedAmount"]),
      organicDaySilo: day,
      organicStorageSiloA: a,
      organicStorageSiloB: b,
      organicSiloTotal: total
    };
  }

  function renderOrganic(date, result) {
    const card = byId(POWER_PREFIX + "SludgeCard");
    if (!card) return;
    if (closedOwns(date)) {
      markFallback(card, false);
      return;
    }
    const values = organicValues(result);
    if (!Object.values(values).some(value => value !== null)) return;
    for (const [key, id] of Object.entries(ORGANIC_IDS)) {
      const isCount = key === "sludgeTruckCount";
      setText(byId(id), format(values[key], isCount ? "건" : "t", isCount ? 0 : 2, isCount ? 0 : 2));
    }
    setText(byId(POWER_PREFIX + "SludgeDate"), date + " · 기존 저장값");
    setFallbackBadge(byId(POWER_PREFIX + "SludgeStatus"), "기존 저장값");
    markFallback(card, true, date + " 기존 자동수치 저장값 · 마감자료가 생기면 자동 우선");
  }

  function cofiringFuel(result) {
    return {
      unitOne: {
        coal: firstNumber(result, ["coalUsageUnitOne"]),
        bio: firstNumber(result, ["bioUsageUnitOne"]),
        organic: firstNumber(result, ["organicUsageUnitOne"])
      },
      unitTwo: {
        coal: firstNumber(result, ["coalUsageUnitTwo"]),
        bio: firstNumber(result, ["bioUsageUnitTwo"]),
        organic: firstNumber(result, ["organicUsageUnitTwo"])
      }
    };
  }

  function calculateRatio(unit, settings) {
    const coalHv = number(settings?.coalKcalPerKg);
    const bioHv = number(settings?.bioKcalPerKg);
    const organicHv = number(settings?.organicKcalPerKg);
    if ([unit.coal, unit.bio, unit.organic, coalHv, bioHv, organicHv].some(value => value === null) ||
        [unit.coal, unit.bio, unit.organic].some(value => value < 0) ||
        [coalHv, bioHv, organicHv].some(value => value <= 0)) return null;
    const coalHeat = unit.coal * coalHv;
    const bioHeat = unit.bio * bioHv;
    const organicHeat = unit.organic * organicHv;
    const totalHeat = coalHeat + bioHeat + organicHeat;
    if (!(totalHeat > 0)) return null;
    const bioRatio = bioHeat / totalHeat * 100;
    const organicRatio = organicHeat / totalHeat * 100;
    return {bioRatio, organicRatio, totalRatio: bioRatio + organicRatio};
  }

  function renderCofiring(date, result) {
    const card = byId("efficiencyMorningMeetingAutoCofiringCard");
    if (!card) return;
    if (closedOwns(date)) {
      markFallback(card, false);
      return;
    }
    const fuel = cofiringFuel(result);
    const allValues = [fuel.unitOne.coal, fuel.unitOne.bio, fuel.unitOne.organic,
      fuel.unitTwo.coal, fuel.unitTwo.bio, fuel.unitTwo.organic];
    if (!allValues.every(value => value !== null)) return;

    setText(byId(COFIRING_IDS.unitOneCoal), format(fuel.unitOne.coal, "t/d", 2, 2));
    setText(byId(COFIRING_IDS.unitOneBio), format(fuel.unitOne.bio, "t/d", 2, 2));
    setText(byId(COFIRING_IDS.unitOneOrganic), format(fuel.unitOne.organic, "t/d", 2, 2));
    setText(byId(COFIRING_IDS.unitTwoCoal), format(fuel.unitTwo.coal, "t/d", 2, 2));
    setText(byId(COFIRING_IDS.unitTwoBio), format(fuel.unitTwo.bio, "t/d", 2, 2));
    setText(byId(COFIRING_IDS.unitTwoOrganic), format(fuel.unitTwo.organic, "t/d", 2, 2));

    const settings = settingsCache.get(date);
    if (settings !== undefined) {
      const unitOne = calculateRatio(fuel.unitOne, settings);
      const unitTwo = calculateRatio(fuel.unitTwo, settings);
      for (const [ratios, prefix] of [[unitOne, "unitOne"], [unitTwo, "unitTwo"]]) {
        setText(byId(COFIRING_IDS[prefix + "BioRatio"]), ratios ? format(ratios.bioRatio, "%", 2, 2) : "-");
        setText(byId(COFIRING_IDS[prefix + "OrganicRatio"]), ratios ? format(ratios.organicRatio, "%", 2, 2) : "-");
        setText(byId(COFIRING_IDS[prefix + "TotalRatio"]), ratios ? format(ratios.totalRatio, "%", 2, 2) : "-");
      }
    } else {
      void loadSettings(date);
    }

    setText(byId("efficiencyMorningMeetingCofiringDate"), date + " · 기존 저장값");
    setFallbackBadge(byId("efficiencyMorningMeetingCofiringStatus"), "기존 저장값");
    markFallback(card, true, date + " 기존 자동수치 저장값 · 마감자료가 생기면 자동 우선");
  }

  function render(date = targetDate()) {
    if (!dateValid(date) || blocked(date)) return;
    const result = peek(date);
    if (!result) return;
    renderPower(date, result);
    renderSteam(date, result);
    renderOrganic(date, result);
    renderCofiring(date, result);
  }

  function scheduleRender() {
    if (renderTimer !== null) return;
    renderTimer = root.setTimeout(() => {
      renderTimer = null;
      render();
    }, 40);
  }

  function scheduleLoad(options = {}) {
    root.clearTimeout(loadTimer);
    loadTimer = root.setTimeout(() => {
      loadTimer = null;
      const date = targetDate();
      if (date !== observedDate) {
        observedDate = date;
        scheduleRender();
      }
      if (dateValid(date) && !blocked(date)) void load(date, options);
    }, 60);
  }

  function onReset(event) {
    const date = text(event?.detail?.targetDate);
    if (!dateValid(date)) return;
    if (event?.detail?.active === true) {
      invalidate(date);
      return;
    }
    if (date === targetDate()) scheduleLoad({force: true});
  }

  function initialize() {
    const panel = byId(PANEL_ID);
    if (panel && !observer) {
      observer = new MutationObserver(mutations => {
        const dateChanged = mutations.some(mutation =>
          mutation.type === "attributes" && mutation.attributeName === "data-morning-meeting-auto-base-date");
        // MORNING_MEETING_LEGACY_PASSIVE_DATE_V3
        // Main date navigation already performs the single completed_history
        // restore. This compatibility layer only repaints that restored state.
        if (dateChanged) observedDate = targetDate();
        scheduleRender();
      });
      observer.observe(panel, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["data-morning-meeting-auto-base-date", "class", "data-source", "data-steam-source"]
      });
    }

    for (const eventName of [
      "efficiencyMorningMeetingSteamStatusLoaded",
      "morningMeetingSteamOisProbeLoaded",
      "morningMeetingClosedCofiringChanged",
      "morningMeetingQueryModeStateChanged"
    ]) doc.addEventListener(eventName, scheduleRender);

    doc.addEventListener("morningMeetingSelectedDateResetStateChanged", onReset);
    doc.addEventListener("morningMeetingResetStateChanged", onReset);
    root.addEventListener("focus", scheduleRender);
    doc.addEventListener("visibilitychange", () => {
      if (!doc.hidden) scheduleRender();
    });

    scheduleLoad();
  }

  root.morningMeetingLegacySavedDailyData = Object.freeze({
    version: VERSION,
    targetDate,
    state,
    peek,
    load,
    refresh: date => load(date || targetDate(), {force: true}),
    render
  });

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", initialize, {once: true});
  else initialize();
})(typeof window === "object" ? window : null);
