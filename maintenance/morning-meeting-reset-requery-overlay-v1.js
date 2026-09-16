/* =========================================================
  MORNING MEETING RESET REQUERY OVERLAY V1

  Purpose
  - When selected-date reset is active, the existing query-source
    controller already calls runEfficiencyMorningMeetingBulkLookup
    with forceRefresh:true.
  - Some later script.js revisions no longer forward that option into
    the individual operating-data loaders.
  - This overlay replaces only the global bulk entry point for that
    reset-active fresh-query case. Normal queries still use the
    original implementation.

  No API/DB schema changes. No Agent/Excel process changes.
========================================================= */
(function installMorningMeetingResetRequeryOverlayV1() {
  "use strict";

  if (window.__morningMeetingResetRequeryOverlayV1Installed === true) {
    return;
  }
  window.__morningMeetingResetRequeryOverlayV1Installed = true;

  const OVERLAY_MARKER = "MORNING_MEETING_RESET_REQUERY_OVERLAY_V1";
  const OPERATIONS_TIMEOUT_MS = 4 * 60 * 1000;
  const WORKBOOK_TIMEOUT_MS = 5 * 60 * 1000;
  let wrappedBulk = null;
  let wrappedWorkbook = null;
  let originalBulk = null;
  let originalWorkbook = null;

  function normalizeText(value) {
    return String(value == null ? "" : value).trim();
  }

  function isIsoDate(value) {
    const text = normalizeText(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const parsed = new Date(`${text}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
  }

  function selectedDate(options) {
    const api = window.morningMeetingQuerySources;
    const candidates = [
      options && options.targetDate,
      typeof api?.targetDate === "function" ? api.targetDate() : "",
      document.getElementById("efficiencyMorningMeetingWaterPanel")?.dataset?.morningMeetingAutoBaseDate,
      document.getElementById("efficiencyMorningMeetingAutoDatePicker")?.value
    ];
    return candidates.map(normalizeText).find(isIsoDate) || "";
  }

  function isResetActive(date) {
    if (!isIsoDate(date)) return false;
    try {
      const apiState = window.morningMeetingQuerySources?.getResetState?.(date);
      if (apiState?.active === true) return true;
    } catch (error) {
      console.warn(`${OVERLAY_MARKER}: query-source reset state read failed`, error);
    }
    try {
      return window.isMorningMeetingSelectedDateResetActive?.(date) === true;
    } catch (error) {
      console.warn(`${OVERLAY_MARKER}: selected-date reset state read failed`, error);
      return false;
    }
  }

  function timeoutError(label, timeoutMs) {
    const seconds = Math.round(timeoutMs / 1000);
    const error = new Error(`${label} 조회가 ${seconds}초 안에 완료되지 않았습니다. 다시 조회해 주세요.`);
    error.code = "MORNING_MEETING_RESET_REQUERY_TIMEOUT";
    return error;
  }

  function withTimeout(value, label, timeoutMs) {
    let timer = null;
    return Promise.race([
      Promise.resolve(value),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
      })
    ]).finally(() => {
      if (timer !== null) window.clearTimeout(timer);
    });
  }

  function requireLoader(name, label) {
    const loader = window[name];
    if (typeof loader !== "function") {
      throw new Error(`${label} 조회 기능을 불러오지 못했습니다. 새로고침해 주세요.`);
    }
    return loader;
  }

  async function runFreshItem(item, date) {
    try {
      const loader = requireLoader(item.loader, item.label);
      const result = await withTimeout(
        loader({
          forceRefresh: true,
          userInitiated: true,
          targetDate: date,
          cacheFirst: false
        }),
        item.label,
        OPERATIONS_TIMEOUT_MS
      );
      return {
        key: item.key,
        status: "fulfilled",
        result
      };
    } catch (error) {
      if (item.required !== true) {
        console.warn(`${OVERLAY_MARKER}: optional ${item.label} query failed`, error);
        return {
          key: item.key,
          status: "fulfilled",
          result: null,
          optionalError: normalizeText(error?.message)
        };
      }
      throw error;
    }
  }

  function runFreshOperations(date) {
    const items = [
      { key: "water", label: "수처리 현황", loader: "loadEfficiencyMorningMeetingWaterTreatment", required: true },
      { key: "limestone", label: "석회석 현황", loader: "loadLimestoneOisStock", required: true },
      { key: "gear-pinion", label: "Gear Wheel / Pinion", loader: "loadEfficiencyMorningMeetingGearPinion", required: true },
      { key: "silo-level", label: "Silo Level", loader: "loadEfficiencyMorningMeetingSiloLevel", required: true },
      { key: "smp-price", label: "SMP 단가", loader: "loadEfficiencyMorningMeetingSmpPrice", required: false },
      { key: "weather", label: "신북 날씨", loader: "loadEfficiencyMorningMeetingWeather", required: false }
    ];

    const operationPromise = Promise.allSettled(
      items.map(item => runFreshItem(item, date))
    );

    window.__efficiencyMorningMeetingBulkLookupPromise = operationPromise;

    return operationPromise.finally(() => {
      if (window.__efficiencyMorningMeetingBulkLookupPromise === operationPromise) {
        delete window.__efficiencyMorningMeetingBulkLookupPromise;
      }
    });
  }

  function installBulkWrapper() {
    const current = window.runEfficiencyMorningMeetingBulkLookup;
    if (typeof current !== "function") return false;
    if (current === wrappedBulk) return true;

    originalBulk = current;
    wrappedBulk = function morningMeetingResetAwareBulkLookup(options) {
      const normalizedOptions = options && typeof options === "object" ? options : {};
      const date = selectedDate(normalizedOptions);
      const forceFreshReset = normalizedOptions.forceRefresh === true && isResetActive(date);

      if (!forceFreshReset) {
        return originalBulk.apply(this, arguments);
      }

      console.log(`${OVERLAY_MARKER}: fresh operating query`, date);
      return runFreshOperations(date);
    };
    wrappedBulk.__morningMeetingResetRequeryOverlayV1 = true;
    window.runEfficiencyMorningMeetingBulkLookup = wrappedBulk;
    return true;
  }

  function installWorkbookWrapper() {
    const current = window.loadEfficiencyMorningMeetingDailyData;
    if (typeof current !== "function") return false;
    if (current === wrappedWorkbook) return true;

    originalWorkbook = current;
    wrappedWorkbook = function morningMeetingResetAwareWorkbookQuery(options) {
      const normalizedOptions = options && typeof options === "object" ? options : {};
      const date = selectedDate(normalizedOptions);
      const forceFreshReset = normalizedOptions.forceRefresh === true &&
        normalizedOptions.userInitiated === true && isResetActive(date);

      const result = originalWorkbook.apply(this, arguments);
      return forceFreshReset
        ? withTimeout(result, "월간 일일 DATA", WORKBOOK_TIMEOUT_MS)
        : result;
    };
    wrappedWorkbook.__morningMeetingResetRequeryOverlayV1 = true;
    window.loadEfficiencyMorningMeetingDailyData = wrappedWorkbook;
    return true;
  }

  function installWrappers() {
    installBulkWrapper();
    installWorkbookWrapper();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      // Earlier deferred scripts register their DOMContentLoaded callbacks first.
      // Defer one macrotask so their global entry points are finalized before wrapping.
      window.setTimeout(installWrappers, 0);
    }, { once: true });
  } else {
    window.setTimeout(installWrappers, 0);
  }

  // A later maintenance adapter may replace one of the globals after DOM ready.
  // Re-check briefly without keeping a permanent timer alive.
  let retryCount = 0;
  const retryTimer = window.setInterval(() => {
    retryCount += 1;
    installWrappers();
    if (retryCount >= 20 && typeof window.runEfficiencyMorningMeetingBulkLookup === "function" &&
        typeof window.loadEfficiencyMorningMeetingDailyData === "function") {
      window.clearInterval(retryTimer);
    } else if (retryCount >= 60) {
      window.clearInterval(retryTimer);
    }
  }, 250);
})();
