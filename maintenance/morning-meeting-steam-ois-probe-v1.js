"use strict";

/*
  MORNING MEETING STEAM OIS SOURCE OWNER V2

  Steam card source ownership:
  - Sales: OIS > LOG SHEET > daily steam sales (8Bar / 34Bar / subtotal, TON)
  - Production: OIS > LOG SHEET query > BCO1/BCO2 MAIN STM FLOW 01~24 sum
  - New Daily DATA Excel reads are disabled; already-saved legacy values may remain visible until OIS succeeds.
*/
(function installMorningMeetingSteamOisSourceOwnerV2() {
  if (window.__morningMeetingSteamOisSourceOwnerV2Installed === true) return;
  window.__morningMeetingSteamOisSourceOwnerV2Installed = true;

  const API_URL = "/api/ois-data-requests";
  const BUTTON_ID = "efficiencyMorningMeetingAutoSteamRefreshButton";
  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const CARD_ID = "efficiencyMorningMeetingAutoSteamCard";
  const DATE_ID = "efficiencyMorningMeetingAutoSteamDate";
  const STATUS_ID = "efficiencyMorningMeetingAutoSteamStatus";
  const POLL_INTERVAL = 1500;
  const MAXIMUM_WAIT = 5 * 60 * 1000;

  const VALUE_IDS = {
    steamSalesLowPressure: "efficiencyMorningMeetingAutoDailySteamSalesLowPressure",
    steamSalesHighPressure: "efficiencyMorningMeetingAutoDailySteamSalesHighPressure",
    steamSales: "efficiencyMorningMeetingAutoSteamSales",
    unitOneProduction: "efficiencyMorningMeetingAutoSteamProductionUnitOne",
    unitTwoProduction: "efficiencyMorningMeetingAutoSteamProductionUnitTwo",
    totalProduction: "efficiencyMorningMeetingAutoSteamProductionTotal"
  };

  let phase = "idle";
  let lastResult = null;
  let syncing = false;
  let activePromise = null;

  const text = value => String(value ?? "").trim();

  function sharedState() {
    if (!window.efficiencyMorningMeetingUploadState ||
        typeof window.efficiencyMorningMeetingUploadState !== "object") {
      window.efficiencyMorningMeetingUploadState = {};
    }
    return window.efficiencyMorningMeetingUploadState;
  }

  function isDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(text(value));
  }

  function dateFromText(value) {
    return text(value).match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
  }

  function resolveTargetDate() {
    const panel = document.getElementById(PANEL_ID);
    const cardDate = document.getElementById(DATE_ID);
    const state =
      window.efficiencyMorningMeetingUploadState &&
      typeof window.efficiencyMorningMeetingUploadState === "object"
        ? window.efficiencyMorningMeetingUploadState
        : {};

    const candidates = [
      panel?.dataset?.morningMeetingAutoBaseDate,
      state?.shiftPart?.reportDate,
      state?.shiftPart?.loadedDate,
      panel?.dataset?.steamStatusTargetDate,
      dateFromText(cardDate?.textContent),
      dateFromText(document.getElementById("efficiencyMorningMeetingWaterDate")?.textContent),
      dateFromText(document.getElementById("efficiencyMorningMeetingShiftDate")?.textContent)
    ];

    return candidates.map(text).find(isDate) || "";
  }

  function headers(extra = {}) {
    if (typeof window.getShiftLogAuthHeaders === "function") {
      return window.getShiftLogAuthHeaders(extra);
    }
    if (typeof getShiftLogAuthHeaders === "function") {
      return getShiftLogAuthHeaders(extra);
    }
    return { Accept: "application/json", ...extra };
  }

  async function readResponse(response, fallback) {
    const responseText = await response.text();
    let data = {};
    if (responseText.trim()) {
      try {
        data = JSON.parse(responseText);
      } catch (_) {
        throw new Error("OIS 증기 조회 서버 응답 형식이 올바르지 않습니다.");
      }
    }
    if (!response.ok || data.ok === false) {
      throw new Error(
        data.message || data.error || fallback ||
        `OIS 증기 조회 요청에 실패했습니다. (HTTP ${response.status})`
      );
    }
    return data;
  }

  async function createRequest(targetDate) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      cache: "no-store",
      body: JSON.stringify({
        requestType: "steam_status",
        targetDate,
        forceRefresh: true
      })
    });

    const data = await readResponse(
      response,
      "OIS 증기 생산·판매 조회 요청을 만들지 못했습니다."
    );

    const item = data.item || {};
    const requestType = text(item.requestType || item.request_type)
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

    if (requestType && requestType !== "steam_status") {
      throw new Error(
        `증기 조회 요청이 ${requestType}(으)로 저장되었습니다. steam_status가 필요합니다.`
      );
    }

    const id = text(item.id || data.id);
    if (!id) throw new Error("OIS 증기 조회 요청 ID를 확인하지 못했습니다.");
    return id;
  }

  async function getRequest(id) {
    const url = new URL(API_URL, window.location.origin);
    url.searchParams.set("id", id);
    url.searchParams.set("_", String(Date.now()));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: headers(),
      cache: "no-store"
    });

    return await readResponse(
      response,
      "OIS 증기 조회 상태를 확인하지 못했습니다."
    );
  }

  function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  async function waitForCompletion(id) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < MAXIMUM_WAIT) {
      const data = await getRequest(id);
      const item = data.item;
      if (!item) throw new Error("OIS 증기 조회 요청을 찾지 못했습니다.");

      const status = text(item.status).toLowerCase();
      if (status === "complete") return item;
      if (status === "failed") {
        throw new Error(
          text(item.errorMessage || item.error_message) ||
          "OIS 증기 생산·판매 조회에 실패했습니다."
        );
      }
      await wait(POLL_INTERVAL);
    }
    throw new Error("OIS 증기 생산·판매 조회 응답 시간이 초과되었습니다.");
  }

  function requireNumber(result, key, label) {
    const value = Number(result?.[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`${label} 값을 확인하지 못했습니다.`);
    }
    return value;
  }

  function normalizeResult(item, expectedDate) {
    const raw =
      item?.result && typeof item.result === "object" && !Array.isArray(item.result)
        ? item.result
        : {};

    const sourceDate = text(
      raw.sourceDate || raw.targetDate || item.targetDate || item.target_date
    );

    if (sourceDate && sourceDate !== expectedDate) {
      throw new Error(
        `OIS 증기 조회 날짜가 다릅니다. 요청 ${expectedDate} / 결과 ${sourceDate}`
      );
    }

    const result = {
      targetDate: expectedDate,
      sourceDate: sourceDate || expectedDate,
      steamSalesLowPressure: requireNumber(raw, "steamSalesLowPressure", "저압 증기 판매량"),
      steamSalesHighPressure: requireNumber(raw, "steamSalesHighPressure", "고압 증기 판매량"),
      steamSales: requireNumber(raw, "steamSales", "총 증기 판매량"),
      unitOneProduction: requireNumber(raw, "unitOneProduction", "1호기 증기 생산량"),
      unitTwoProduction: requireNumber(raw, "unitTwoProduction", "2호기 증기 생산량"),
      totalProduction: requireNumber(raw, "totalProduction", "총 증기 생산량"),
      source: text(raw.source) || "OIS",
      requestId: text(item.id)
    };

    const round3 = value => Math.round(value * 1000) / 1000;

    if (
      Math.abs(
        round3(result.steamSalesLowPressure + result.steamSalesHighPressure) -
        round3(result.steamSales)
      ) > 0.05
    ) {
      throw new Error("저압 + 고압과 총 증기 판매량이 일치하지 않습니다.");
    }

    if (
      Math.abs(
        round3(result.unitOneProduction + result.unitTwoProduction) -
        round3(result.totalProduction)
      ) > 0.05
    ) {
      throw new Error("1호기 + 2호기와 총 증기 생산량이 일치하지 않습니다.");
    }

    return result;
  }

  function formatTon(value) {
    return `${Number(value).toLocaleString("ko-KR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3
    })} ton`;
  }

  function setTextIfDifferent(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function statusText() {
    if (phase === "loading") return "OIS 조회중";
    if (phase === "complete") return "OIS 완료";
    if (phase === "error") return "OIS 실패";
    return "OIS 대기";
  }

  function hasLegacySavedSteamValues(saved) {
    if (!saved || typeof saved !== "object") return false;
    return Object.keys(VALUE_IDS).some(key => {
      const raw = saved[key];
      if (raw === null || raw === undefined || text(raw) === "") return false;
      const numeric = Number(String(raw).replaceAll(",", ""));
      return Number.isFinite(numeric);
    });
  }

  function legacySavedSteamFallbackOwns(targetDate) {
    if (!targetDate) return false;
    const card = document.getElementById(CARD_ID);
    const dateElement = document.getElementById(DATE_ID);
    const shownDate = dateFromText(dateElement?.textContent);
    if (
      card?.dataset?.legacySavedFallback === "true" &&
      (!shownDate || shownDate === targetDate)
    ) {
      return true;
    }

    const fallback = window.morningMeetingLegacySavedDailyData;
    if (!fallback || typeof fallback.peek !== "function") return false;
    try {
      return hasLegacySavedSteamValues(fallback.peek(targetDate));
    } catch {
      return false;
    }
  }

  function preserveLegacySavedSteamFallback(targetDate) {
    if (!legacySavedSteamFallbackOwns(targetDate)) return false;

    const fallback = window.morningMeetingLegacySavedDailyData;
    try {
      fallback?.render?.(targetDate);
    } catch (error) {
      console.warn("오전회의 증기 기존 저장값 표시 유지 실패:", error);
    }

    const statusElement = document.getElementById(STATUS_ID);
    if (statusElement) {
      statusElement.dataset.steamOisSource = "true";
      statusElement.dataset.steamOisPhase = phase;
    }

    const button = document.getElementById(BUTTON_ID);
    if (button) {
      button.title = phase === "loading"
        ? "OIS 재조회 중 · 기존 저장값 유지"
        : "OIS에서 증기 생산·판매 재조회 · 기존 저장값 유지";
      button.setAttribute("aria-label", button.title);
      button.dataset.steamSource = "ois";
      button.disabled = phase === "loading";
    }

    return true;
  }

  function applySourceOwnership() {
    if (syncing) return;
    syncing = true;

    try {
      const card = document.getElementById(CARD_ID);
      if (!card) return;

      const targetDate = resolveTargetDate();
      if (
        lastResult &&
        targetDate &&
        lastResult.sourceDate !== targetDate
      ) {
        lastResult = null;
        phase = "idle";
      }

      const currentOisOwns = Boolean(
        lastResult &&
        (!targetDate || lastResult.sourceDate === targetDate)
      );
      if (!currentOisOwns && preserveLegacySavedSteamFallback(targetDate)) return;

      card.dataset.steamSource = "ois";
      if (targetDate) card.dataset.steamSourceDate = targetDate;

      const dateElement = document.getElementById(DATE_ID);
      setTextIfDifferent(
        dateElement,
        targetDate ? `${targetDate} · OIS` : "OIS"
      );

      const statusElement = document.getElementById(STATUS_ID);
      if (statusElement) {
        setTextIfDifferent(statusElement, statusText());
        statusElement.dataset.steamOisSource = "true";
        statusElement.dataset.steamOisPhase = phase;
      }

      const button = document.getElementById(BUTTON_ID);
      if (button) {
        button.title = "OIS에서 증기 생산·판매 재조회";
        button.setAttribute("aria-label", "OIS에서 증기 생산·판매 재조회");
        button.dataset.steamSource = "ois";
        button.disabled = phase === "loading";
      }

      for (const [key, id] of Object.entries(VALUE_IDS)) {
        const element = document.getElementById(id);
        if (!element) continue;

        const value =
          lastResult && (!targetDate || lastResult.sourceDate === targetDate)
            ? formatTon(lastResult[key])
            : "-";

        setTextIfDifferent(element, value);
      }
    } finally {
      syncing = false;
    }
  }



  function commitOisState(result, nextPhase, error = null) {
    const state = sharedState();
    const panel = document.getElementById(PANEL_ID);
    const targetDate = resolveTargetDate();
    phase = nextPhase;

    if (result && typeof result === "object") {
      lastResult = {
        ...result,
        requestType: "steam_status",
        sourceRequestType: "steam_status"
      };
      state.steamStatus = { ...lastResult };
      delete state.steamStatusError;
    } else if (nextPhase === "error") {
      lastResult = null;
      state.steamStatusError = error instanceof Error ? error.message : text(error);
    } else if (nextPhase === "loading") {
      lastResult = null;
      delete state.steamStatusError;
    }

    if (panel) {
      panel.dataset.steamStatusStatus = nextPhase;
      if (targetDate) panel.dataset.steamStatusTargetDate = targetDate;
      if (lastResult?.requestId) panel.dataset.steamStatusRequestId = lastResult.requestId;
    }
    applySourceOwnership();
  }

  function adoptStoredSteamResult(detail) {
    const targetDate = resolveTargetDate();
    const sourceType = text(detail?.requestType || detail?.sourceRequestType);
    const sourceDate = text(detail?.sourceDate || detail?.targetDate);
    if (sourceType !== "steam_status" || !targetDate || sourceDate !== targetDate) return false;
    try {
      const normalized = normalizeResult(
        { id: detail?.requestId, targetDate, result: detail },
        targetDate
      );
      commitOisState(normalized, "complete");
      return true;
    } catch (error) {
      console.warn("저장된 증기 OIS 결과 복원 실패:", error);
      return false;
    }
  }

  async function run(button) {
    if (activePromise) return await activePromise;

    activePromise = (async () => {
      const targetDate = resolveTargetDate();
      if (!targetDate) {
        throw new Error("오전회의 증기 조회 기준일을 확인하지 못했습니다.");
      }

      commitOisState(null, "loading");

      try {
        const id = await createRequest(targetDate);
        const item = await waitForCompletion(id);
        lastResult = normalizeResult(item, targetDate);
        phase = "complete";
        applySourceOwnership();

        window.__morningMeetingSteamOisProbeLastResult = lastResult;
        document.dispatchEvent(
          new CustomEvent("morningMeetingSteamOisProbeLoaded", { detail: lastResult })
        );
        document.dispatchEvent(
          new CustomEvent("efficiencyMorningMeetingSteamStatusLoaded", { detail: lastResult })
        );
        console.log("오전회의 증기 생산·판매 OIS 확인 완료:", lastResult);
        return lastResult;
      } catch (error) {
        commitOisState(null, "error", error);
        console.error("오전회의 증기 생산·판매 OIS 조회 실패:", error);
        window.alert?.(
          error instanceof Error
            ? error.message
            : "OIS 증기 생산·판매 조회에 실패했습니다."
        );
        throw error;
      } finally {
        if (button) button.disabled = false;
      }
    })();

    try {
      return await activePromise;
    } finally {
      activePromise = null;
      applySourceOwnership();
    }
  }

  function initializeOwnership() {
    const stored = sharedState().steamStatus;
    if (stored) adoptStoredSteamResult(stored);
    applySourceOwnership();
  }

  document.addEventListener(
    "efficiencyMorningMeetingSteamStatusLoaded",
    event => {
      if (event?.detail === lastResult) return;
      adoptStoredSteamResult(event?.detail);
    }
  );

  document.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof Element
          ? event.target.closest(`#${BUTTON_ID}`)
          : null;
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void run(target).catch(() => {});
    },
    true
  );

  const observer = new MutationObserver(() => {
    applySourceOwnership();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "data-morning-meeting-auto-base-date",
      "data-steam-status-target-date"
    ]
  });

  window.getEfficiencyMorningMeetingSteamOisValues = () => {
    const targetDate = resolveTargetDate();
    return lastResult && (!targetDate || lastResult.sourceDate === targetDate)
      ? { ...lastResult }
      : null;
  };
  window.isEfficiencyMorningMeetingSteamOisBusy = () => Boolean(activePromise);

  window.loadEfficiencyMorningMeetingSteamOis = options => {
    void options;
    return run(document.getElementById(BUTTON_ID));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeOwnership, {
      once: true
    });
  } else {
    initializeOwnership();
  }
})();
