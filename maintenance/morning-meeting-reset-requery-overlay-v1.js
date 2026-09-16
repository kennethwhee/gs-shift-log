/* =========================================================
  MORNING MEETING RESET REQUERY OVERLAY V1 R5

  Purpose
  - A selected-date reset intentionally hides saved values.
  - During a fresh full re-query, those same reset guards used to keep
    freshly loading/completed values hidden as "조회 대기", so the
    query-source coordinator could never observe a successful refresh.
  - R5 temporarily bypasses only the UI/reset-suppression predicate for
    the selected reset date while the fresh operating/Excel query runs.
  - The query-source controller still owns the real reset marker and
    releases it only after both sources succeed.

  No API/DB schema changes. No Agent/Excel process changes.
========================================================= */
(function installMorningMeetingResetRequeryOverlayV1R5() {
  "use strict";

  if (window.__morningMeetingResetRequeryOverlayV1R5Installed === true) {
    return;
  }
  window.__morningMeetingResetRequeryOverlayV1R5Installed = true;

  const OVERLAY_MARKER = "MORNING_MEETING_RESET_REQUERY_OVERLAY_V1_R5";
  const OPERATIONS_TIMEOUT_MS = 4 * 60 * 1000;
  const WORKBOOK_TIMEOUT_MS = 5 * 60 * 1000;
  const BYPASS_GRACE_MS = 15 * 1000;

  let wrappedBulk = null;
  let wrappedWorkbook = null;
  let originalBulk = null;
  let originalWorkbook = null;
  let wrappedResetPredicate = null;
  let originalResetPredicate = null;

  const resetBypassByDate = new Map();

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

  function querySourceResetActive(date) {
    if (!isIsoDate(date)) return false;
    try {
      const apiState = window.morningMeetingQuerySources?.getResetState?.(date);
      if (apiState?.active === true) return true;
    } catch (error) {
      console.warn(`${OVERLAY_MARKER}: query-source reset state read failed`, error);
    }
    return false;
  }

  function underlyingResetActive(date) {
    if (!isIsoDate(date)) return false;
    try {
      const predicate = originalResetPredicate || window.isMorningMeetingSelectedDateResetActive;
      return typeof predicate === "function" && predicate(date) === true;
    } catch (error) {
      console.warn(`${OVERLAY_MARKER}: selected-date reset state read failed`, error);
      return false;
    }
  }

  function isResetActive(date) {
    return querySourceResetActive(date) || underlyingResetActive(date);
  }

  function isResetBypassActive(date) {
    const entry = resetBypassByDate.get(date);
    return Boolean(entry && (entry.pending > 0 || entry.holdUntil > Date.now()));
  }

  function currentBypassDate(argumentDate) {
    const explicit = normalizeText(argumentDate);
    if (isIsoDate(explicit)) return explicit;
    return selectedDate({});
  }

  function installResetPredicateWrapper() {
    const current = window.isMorningMeetingSelectedDateResetActive;
    if (typeof current !== "function") return false;
    if (current === wrappedResetPredicate) return true;

    const delegate = current;
    originalResetPredicate = delegate;
    wrappedResetPredicate = function morningMeetingResetRequeryVisiblePredicate(dateValue) {
      const date = currentBypassDate(dateValue);
      if (isIsoDate(date) && isResetBypassActive(date)) {
        return false;
      }
      return delegate.apply(this, arguments);
    };
    wrappedResetPredicate.__morningMeetingResetRequeryOverlayV1R5 = true;
    window.isMorningMeetingSelectedDateResetActive = wrappedResetPredicate;
    return true;
  }

  function rerenderSelectedDateAfterBypass(date) {
    if (selectedDate({}) !== date) return;
    try { window.renderEfficiencyMorningMeetingAutoPreview?.(); } catch {}
    try { window.renderEfficiencyMorningMeetingSiloLevelPreview?.(); } catch {}
    try { window.renderEfficiencyMorningMeetingDailyData?.(); } catch {}
    try { window.renderEfficiencyMorningMeetingSmpPrice?.(); } catch {}
    try { window.renderEfficiencyMorningMeetingWeather?.(); } catch {}
    try { window.refreshMorningMeetingCofiringCard?.(); } catch {}
    try { window.updateEfficiencyMorningMeetingCreateButton?.(); } catch {}
    try { window.morningMeetingQuerySources?.render?.(); } catch {}
  }

  function clearResetBypass(date, rerender = true) {
    const entry = resetBypassByDate.get(date);
    if (!entry) return;
    if (entry.timer !== null) window.clearTimeout(entry.timer);
    resetBypassByDate.delete(date);
    if (rerender) rerenderSelectedDateAfterBypass(date);
  }

  function scheduleResetBypassCleanup(date) {
    const entry = resetBypassByDate.get(date);
    if (!entry || entry.pending > 0) return;
    entry.holdUntil = Date.now() + BYPASS_GRACE_MS;
    if (entry.timer !== null) window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => {
      const latest = resetBypassByDate.get(date);
      if (!latest || latest.pending > 0) return;
      clearResetBypass(date, true);
    }, BYPASS_GRACE_MS);
  }

  function acquireResetBypass(date) {
    if (!isIsoDate(date)) return () => {};
    installResetPredicateWrapper();

    let entry = resetBypassByDate.get(date);
    if (!entry) {
      entry = { pending: 0, holdUntil: 0, timer: null };
      resetBypassByDate.set(date, entry);
    }
    if (entry.timer !== null) {
      window.clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.pending += 1;
    entry.holdUntil = Number.MAX_SAFE_INTEGER;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = resetBypassByDate.get(date);
      if (!current) return;
      current.pending = Math.max(0, current.pending - 1);
      scheduleResetBypassCleanup(date);
    };
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
          requireFresh: true,
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
    const releaseBypass = acquireResetBypass(date);
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
      releaseBypass();
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
    wrappedBulk.__morningMeetingResetRequeryOverlayV1R5 = true;
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

      if (!forceFreshReset) {
        return originalWorkbook.apply(this, arguments);
      }

      const releaseBypass = acquireResetBypass(date);
      let result;
      try {
        result = originalWorkbook.apply(this, arguments);
      } catch (error) {
        releaseBypass();
        throw error;
      }

      return withTimeout(result, "월간 일일 DATA", WORKBOOK_TIMEOUT_MS)
        .finally(releaseBypass);
    };
    wrappedWorkbook.__morningMeetingResetRequeryOverlayV1R5 = true;
    window.loadEfficiencyMorningMeetingDailyData = wrappedWorkbook;
    return true;
  }

  function handleResetStateEvent(event) {
    const date = normalizeText(event?.detail?.targetDate || event?.detail?.recordDate);
    if (!isIsoDate(date)) return;
    if (event?.detail?.active === false) {
      clearResetBypass(date, false);
    }
  }

  function installWrappers() {
    installResetPredicateWrapper();
    installBulkWrapper();
    installWorkbookWrapper();
  }

  document.addEventListener("morningMeetingSelectedDateResetStateChanged", handleResetStateEvent);
  document.addEventListener("morningMeetingResetStateChanged", handleResetStateEvent);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      window.setTimeout(installWrappers, 0);
    }, { once: true });
  } else {
    window.setTimeout(installWrappers, 0);
  }

  let retryCount = 0;
  const retryTimer = window.setInterval(() => {
    retryCount += 1;
    installWrappers();
    if (retryCount >= 20 && typeof window.runEfficiencyMorningMeetingBulkLookup === "function" &&
        typeof window.loadEfficiencyMorningMeetingDailyData === "function" &&
        typeof window.isMorningMeetingSelectedDateResetActive === "function") {
      window.clearInterval(retryTimer);
    } else if (retryCount >= 60) {
      window.clearInterval(retryTimer);
    }
  }, 250);
})();
