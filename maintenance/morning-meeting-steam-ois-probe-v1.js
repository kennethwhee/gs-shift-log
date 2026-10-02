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

  async function createRequest(targetDate, options = {}) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      cache: "no-store",
      body: JSON.stringify({
        requestType: "steam_status",
        targetDate,
        forceRefresh: options.forceRefresh === true
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
    /* MORNING_MEETING_STEAM_SPLIT_NORMALIZE_V14 */
    const raw =
      item?.result && typeof item.result === "object" && !Array.isArray(item.result)
        ? item.result
        : {};

    const sourceDate = text(
      raw.sourceDate || raw.targetDate || item.targetDate || item.target_date
    );
    if (sourceDate && sourceDate !== expectedDate) {
      throw new Error(
        "OIS 증기 조회 날짜가 다릅니다. 요청 " + expectedDate + " / 결과 " + sourceDate
      );
    }

    const readOptionalNumber = (...keys) => {
      for (const key of keys) {
        const candidate = raw?.[key];
        if (candidate === null || candidate === undefined || text(candidate) === "") continue;
        const value = Number(String(candidate).replaceAll(",", ""));
        if (Number.isFinite(value)) return value;
      }
      return null;
    };

    const steamSalesLowPressure = readOptionalNumber("steamSalesLowPressure", "steam_sales_low_pressure");
    const steamSalesHighPressure = readOptionalNumber("steamSalesHighPressure", "steam_sales_high_pressure");
    const steamSales = readOptionalNumber("steamSales", "steam_sales");
    const unitOneProduction = readOptionalNumber("unitOneProduction", "unit_one_production");
    const unitTwoProduction = readOptionalNumber("unitTwoProduction", "unit_two_production");
    const totalProduction = readOptionalNumber("totalProduction", "total_production");

    let productionComplete =
      raw.productionComplete === true ||
      [unitOneProduction, unitTwoProduction, totalProduction].every(value => value !== null);
    let salesComplete =
      raw.salesComplete === true ||
      [steamSalesLowPressure, steamSalesHighPressure, steamSales].every(value => value !== null);

    let productionError = text(raw.productionError || raw.production_error);
    let salesError = text(raw.salesError || raw.sales_error);
    const round3 = value => Math.round(Number(value) * 1000) / 1000;

    if (productionComplete) {
      if ([unitOneProduction, unitTwoProduction, totalProduction].some(value => value === null)) {
        productionComplete = false;
        productionError = productionError || "증기 생산량 일부 값을 확인하지 못했습니다.";
      } else if (Math.abs(round3(unitOneProduction + unitTwoProduction) - round3(totalProduction)) > 0.05) {
        productionComplete = false;
        productionError = productionError || "1호기 + 2호기와 총 증기 생산량이 일치하지 않습니다.";
      }
    }

    if (salesComplete) {
      if ([steamSalesLowPressure, steamSalesHighPressure, steamSales].some(value => value === null)) {
        salesComplete = false;
        salesError = salesError || "증기 판매량 일부 값을 확인하지 못했습니다.";
      } else if (Math.abs(round3(steamSalesLowPressure + steamSalesHighPressure) - round3(steamSales)) > 0.05) {
        salesComplete = false;
        salesError = salesError || "저압 + 고압과 총 증기 판매량이 일치하지 않습니다.";
      }
    }

    if (!productionComplete && !salesComplete) {
      throw new Error(
        [productionError, salesError].filter(Boolean).join(" / ") ||
        "증기 생산량과 판매량을 모두 확인하지 못했습니다."
      );
    }

    const salesRate =
      productionComplete && salesComplete && totalProduction > 0
        ? round3(steamSales / totalProduction * 100)
        : null;

    return {
      targetDate: expectedDate,
      sourceDate: sourceDate || expectedDate,
      steamSalesLowPressure,
      steamSalesHighPressure,
      steamSales,
      unitOneProduction,
      unitTwoProduction,
      totalProduction,
      salesRate,
      productionComplete,
      salesComplete,
      complete: productionComplete && salesComplete,
      productionError,
      salesError,
      productionSource: text(raw.productionSource || raw.production_source),
      salesSource: text(raw.salesSource || raw.sales_source),
      source: text(raw.source) || "OIS",
      requestId: text(item.id)
    };
  }

  /* MORNING_MEETING_STEAM_SAVED_REUSE_V4 */
  function isCompleteSteamResult(result) {
    return Boolean(
      result &&
      result.productionComplete === true &&
      result.salesComplete === true &&
      result.complete === true
    );
  }

  function hasAnyCompleteSteamSide(result) {
    return Boolean(
      result &&
      (result.productionComplete === true || result.salesComplete === true)
    );
  }

  function mergeSteamResults(preferred, fallback, targetDate) {
    const preferredProduction = preferred?.productionComplete === true ? preferred : null;
    const fallbackProduction = fallback?.productionComplete === true ? fallback : null;
    const preferredSales = preferred?.salesComplete === true ? preferred : null;
    const fallbackSales = fallback?.salesComplete === true ? fallback : null;
    const production = preferredProduction || fallbackProduction;
    const sales = preferredSales || fallbackSales;

    if (!production && !sales) return null;

    const round3 = value => Math.round(Number(value) * 1000) / 1000;
    const unitOneProduction = production?.unitOneProduction ?? null;
    const unitTwoProduction = production?.unitTwoProduction ?? null;
    const totalProduction = production?.totalProduction ?? null;
    const steamSalesLowPressure = sales?.steamSalesLowPressure ?? null;
    const steamSalesHighPressure = sales?.steamSalesHighPressure ?? null;
    const steamSales = sales?.steamSales ?? null;
    const productionComplete = Boolean(production);
    const salesComplete = Boolean(sales);
    const complete = productionComplete && salesComplete;

    return {
      targetDate,
      sourceDate: targetDate,
      steamSalesLowPressure,
      steamSalesHighPressure,
      steamSales,
      unitOneProduction,
      unitTwoProduction,
      totalProduction,
      salesRate:
        complete && Number(totalProduction) > 0
          ? round3(Number(steamSales) / Number(totalProduction) * 100)
          : null,
      productionComplete,
      salesComplete,
      complete,
      productionError: productionComplete ? "" : text(preferred?.productionError || fallback?.productionError),
      salesError: salesComplete ? "" : text(preferred?.salesError || fallback?.salesError),
      productionSource: text(production?.productionSource),
      salesSource: text(sales?.salesSource),
      source: complete ? "저장 기록 + OIS" : text(preferred?.source || fallback?.source) || "저장 기록 / OIS",
      requestId: text(preferred?.requestId || fallback?.requestId),
      restoredProduction: Boolean(!preferredProduction && fallbackProduction),
      restoredSales: Boolean(!preferredSales && fallbackSales)
    };
  }

  function steamHistoryTimestamp(item) {
    const candidates = [item?.completedAt, item?.updatedAt, item?.createdAt, item?.result?.collectedAt];
    for (const candidate of candidates) {
      const value = Date.parse(String(candidate || ""));
      if (Number.isFinite(value)) return value;
    }
    return 0;
  }

  async function loadStoredSteamResult(targetDate) {
    const url = new URL(API_URL, window.location.origin);
    url.searchParams.set("action", "completed_history");
    url.searchParams.set("startDate", targetDate);
    url.searchParams.set("endDate", targetDate);
    url.searchParams.set("_", String(Date.now()));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: headers(),
      cache: "no-store"
    });
    const data = await readResponse(response, "저장된 증기 조회 기록을 확인하지 못했습니다.");
    const items = Array.isArray(data.items) ? data.items : [];
    const steamItems = items
      .filter(item => {
        const requestType = text(item?.requestType || item?.sourceRequestType);
        const itemDate = text(item?.targetDate || item?.result?.targetDate || item?.result?.sourceDate);
        const status = text(item?.status).toLowerCase();
        return requestType === "steam_status" && itemDate === targetDate && status === "complete" &&
          item?.result && typeof item.result === "object" && !Array.isArray(item.result);
      })
      .sort((a,b) => steamHistoryTimestamp(b) - steamHistoryTimestamp(a));

    let merged = null;
    for (const item of steamItems) {
      let normalized = null;
      try {
        normalized = normalizeResult(item, targetDate);
      } catch (_) {
        continue;
      }
      merged = mergeSteamResults(merged, normalized, targetDate) || normalized;
      if (isCompleteSteamResult(merged)) break;
    }
    return merged;
  }

  function dispatchSteamLoaded(result) {
    window.__morningMeetingSteamOisProbeLastResult = result;
    document.dispatchEvent(
      new CustomEvent("morningMeetingSteamOisProbeLoaded", { detail: result })
    );
    document.dispatchEvent(
      new CustomEvent("efficiencyMorningMeetingSteamStatusLoaded", { detail: result })
    );
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
    /* MORNING_MEETING_STEAM_SPLIT_STATUS_V14 */
    if (phase === "loading") return "OIS 조회중";
    if (phase === "complete") return "조회 완료";
    if (phase === "partial") return "OIS 일부 완료";
    if (phase === "error") return "OIS 실패";
    return "OIS 대기";
  }

  /* MORNING_MEETING_STEAM_COMPLETE_BADGE_R8 */
  function applyStatusBadgeState(element) {
    if (!element) return;

    element.classList.add(
      "efficiency-morning-meeting-auto-card__badge"
    );

    element.classList.remove(
      "is-loading",
      "is-complete",
      "is-error"
    );

    if (phase === "loading") {
      element.classList.add("is-loading");
    } else if (phase === "complete") {
      element.classList.add("is-complete");
    } else if (phase === "error") {
      element.classList.add("is-error");
    }
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
    /* MORNING_MEETING_STEAM_SPLIT_RENDER_V14 */
    if (syncing) return;
    syncing = true;
    try {
      const card = document.getElementById(CARD_ID);
      if (!card) return;

      const targetDate = resolveTargetDate();
      if (lastResult && targetDate && lastResult.sourceDate !== targetDate) {
        lastResult = null;
        phase = "idle";
      }
      const selectedDateDeleted = Boolean(
        targetDate && (
          window.isMorningMeetingSelectedDateResetActive?.(targetDate) === true ||
          window.morningMeetingQuerySources?.resetState?.(targetDate)?.active === true
        )
      );
      if (selectedDateDeleted) {
        card.dataset.steamSource = "ois";
        if (targetDate) card.dataset.steamSourceDate = targetDate;
        const dateElement = document.getElementById(DATE_ID);
        setTextIfDifferent(dateElement, targetDate ? targetDate + " · OIS" : "OIS");
        const statusElement = document.getElementById(STATUS_ID);
        if (statusElement) {
          setTextIfDifferent(statusElement, "조회 대기");
          statusElement.classList.remove("is-loading", "is-complete", "is-error");
          statusElement.dataset.steamOisSource = "true";
          statusElement.dataset.steamOisPhase = "idle";
        }
        for (const id of Object.values(VALUE_IDS)) {
          setTextIfDifferent(document.getElementById(id), "-");
        }
        const button = document.getElementById(BUTTON_ID);
        if (button) {
          button.disabled = true;
          button.title = "자료삭제 상태입니다. 전체조회 또는 재조회로 다시 구성해 주세요.";
          button.setAttribute("aria-label", button.title);
        }
        card.title = targetDate + " 자료삭제 상태 · OIS 원본은 삭제되지 않았습니다.";
        return;
      }

      const currentOisOwns = Boolean(
        lastResult && (!targetDate || lastResult.sourceDate === targetDate)
      );
      if (!currentOisOwns && preserveLegacySavedSteamFallback(targetDate)) return;

      card.dataset.steamSource = "ois";
      if (targetDate) card.dataset.steamSourceDate = targetDate;
      if (lastResult) {
        card.dataset.steamProductionStatus = lastResult.productionComplete ? "complete" : "error";
        card.dataset.steamSalesStatus = lastResult.salesComplete ? "complete" : "error";
      } else {
        delete card.dataset.steamProductionStatus;
        delete card.dataset.steamSalesStatus;
      }

      const dateElement = document.getElementById(DATE_ID);
      setTextIfDifferent(dateElement, targetDate ? targetDate + " · OIS" : "OIS");

      const statusElement = document.getElementById(STATUS_ID);
      if (statusElement) {
        setTextIfDifferent(statusElement, statusText());
        applyStatusBadgeState(statusElement);
        statusElement.dataset.steamOisSource = "true";
        statusElement.dataset.steamOisPhase = phase;
      }

      const button = document.getElementById(BUTTON_ID);
      if (button) {
        button.title = phase === "partial"
          ? "OIS 일부 조회 완료 · 실패 항목 재조회"
          : "OIS에서 증기 생산량·판매량 재조회";
        button.setAttribute("aria-label", button.title);
        button.dataset.steamSource = "ois";
        button.disabled = phase === "loading";
      }

      const validNumber = value => {
        if (value === null || value === undefined || text(value) === "") return null;
        const numeric = Number(String(value).replaceAll(",", ""));
        return Number.isFinite(numeric) ? numeric : null;
      };
      const salesKeys = new Set([
        "steamSalesLowPressure",
        "steamSalesHighPressure",
        "steamSales"
      ]);
      const productionKeys = new Set([
        "unitOneProduction",
        "unitTwoProduction",
        "totalProduction"
      ]);

      for (const [key, id] of Object.entries(VALUE_IDS)) {
        const element = document.getElementById(id);
        if (!element) continue;
        const sideReady =
          salesKeys.has(key)
            ? lastResult?.salesComplete === true
            : productionKeys.has(key)
              ? lastResult?.productionComplete === true
              : false;
        const numeric = sideReady ? validNumber(lastResult?.[key]) : null;
        setTextIfDifferent(element, numeric === null ? "-" : formatTon(numeric));
      }

      const errors = [
        text(lastResult?.productionError),
        text(lastResult?.salesError)
      ].filter(Boolean);
      card.title = errors.length
        ? errors.join(" / ")
        : (targetDate ? targetDate + " OIS 증기 생산량·판매량 독립 조회" : "OIS 증기 생산량·판매량 독립 조회");
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
    /* MORNING_MEETING_STEAM_SPLIT_ADOPT_V14 */
    const targetDate = resolveTargetDate();
    const sourceType = text(detail?.requestType || detail?.sourceRequestType);
    const sourceDate = text(detail?.sourceDate || detail?.targetDate);
    if (sourceType !== "steam_status" || !targetDate || sourceDate !== targetDate) return false;
    try {
      const normalized = normalizeResult(
        { id: detail?.requestId, targetDate, result: detail },
        targetDate
      );
      commitOisState(normalized, normalized.complete ? "complete" : "partial");
      return true;
    } catch (error) {
      console.warn("저장된 증기 OIS 결과 복원 실패:", error);
      return false;
    }
  }


async function run(button, options = {}) {
    /* MORNING_MEETING_STEAM_SAVED_REUSE_V4 */
    if (activePromise) return await activePromise;

    activePromise = (async () => {
      const targetDate = resolveTargetDate();
      if (!targetDate) {
        throw new Error("오전회의 증기 조회 기준일을 확인하지 못했습니다.");
      }

      const forceRefresh = options.forceRefresh === true;
      const ignoreSaved = options.ignoreSaved === true;
      const silent = options.silent === true;
      let stored = null;

      if (!ignoreSaved) {
        const inMemory =
          lastResult && lastResult.sourceDate === targetDate && hasAnyCompleteSteamSide(lastResult)
            ? lastResult
            : sharedState().steamStatus;
        if (inMemory && text(inMemory.sourceDate || inMemory.targetDate) === targetDate) {
          try {
            stored = normalizeResult(
              { id: inMemory.requestId, targetDate, result: inMemory },
              targetDate
            );
          } catch (_) {
            stored = null;
          }
        }

        if (!isCompleteSteamResult(stored)) {
          try {
            const history = await loadStoredSteamResult(targetDate);
            stored = mergeSteamResults(stored, history, targetDate) || stored || history;
          } catch (error) {
            console.warn("저장된 증기 조회 기록 확인 실패:", error);
          }
        }

        if (hasAnyCompleteSteamSide(stored)) {
          commitOisState(stored, isCompleteSteamResult(stored) ? "complete" : "partial");
          dispatchSteamLoaded(lastResult);
        }

        if (isCompleteSteamResult(stored) && !forceRefresh) {
          console.log("오전회의 증기 저장 기록 사용 · 신규 OIS 조회 생략:", lastResult);
          return lastResult;
        }
      }

      if (!stored) commitOisState(null, "loading");
      else phase = "loading";
      applySourceOwnership();

      try {
        const id = await createRequest(targetDate, { forceRefresh: true });
        const item = await waitForCompletion(id);
        const fresh = normalizeResult(item, targetDate);
        const merged = ignoreSaved
          ? fresh
          : (mergeSteamResults(fresh, stored, targetDate) || fresh);
        const nextPhase = isCompleteSteamResult(merged) ? "complete" : "partial";
        commitOisState(merged, nextPhase);
        dispatchSteamLoaded(lastResult);

        console.log(
          isCompleteSteamResult(merged)
            ? "오전회의 증기 생산량·판매량 조회 완료:"
            : "오전회의 증기 일부 조회 완료 · 저장 기록과 병합:",
          lastResult
        );
        return lastResult;
      } catch (error) {
        if (!ignoreSaved && hasAnyCompleteSteamSide(stored)) {
          const partial = {
            ...stored,
            productionError:
              stored.productionComplete === true
                ? ""
                : (text(stored.productionError) || text(error?.message)),
            salesError:
              stored.salesComplete === true
                ? ""
                : (text(stored.salesError) || text(error?.message)),
            complete: false
          };
          commitOisState(partial, "partial");
          dispatchSteamLoaded(lastResult);
          console.warn("증기 신규 조회 실패 · 저장된 완료 항목 유지:", error);
          if (!silent) {
            window.alert?.(
              "저장된 증기 값은 유지했습니다.\n" +
              (error instanceof Error ? error.message : "미수신 항목 재조회에 실패했습니다.")
            );
          }
          return lastResult;
        }

        commitOisState(null, "error", error);
        console.error("오전회의 증기 생산량·판매량 OIS 조회 실패:", error);
        if (!silent) {
          window.alert?.(
            error instanceof Error
              ? error.message
              : "OIS 증기 생산량·판매량 조회에 실패했습니다."
          );
        }
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
      void run(target, {
        userInitiated: true,
        forceRefresh: true,
        ignoreSaved: false,
        silent: false,
        requireComplete: false
      }).catch(() => {});
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

  window.loadEfficiencyMorningMeetingSteamOis = async options => {
    const normalizedOptions = options && typeof options === "object" ? options : {};
    const result = await run(document.getElementById(BUTTON_ID), normalizedOptions);
    if (normalizedOptions.requireComplete === true && !isCompleteSteamResult(result)) {
      throw new Error("증기 생산량·판매량 중 미수신 항목이 남아 있습니다. 저장값은 유지하며 미수신 항목 재조회가 필요합니다.");
    }
    return result;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeOwnership, {
      once: true
    });
  } else {
    initializeOwnership();
  }
})();
