"use strict";

/*
  MORNING MEETING STEAM OIS PROBE V1

  The steam-card refresh button runs a dedicated steam_status request directly.
  It deliberately bypasses the legacy daily-data workbook loader so this first
  stage can validate OIS steam values without changing other morning-meeting cards.
*/
(function installMorningMeetingSteamOisProbeV1() {
  if (window.__morningMeetingSteamOisProbeV1Installed === true) {
    return;
  }

  window.__morningMeetingSteamOisProbeV1Installed = true;

  const API_URL = "/api/ois-data-requests";
  const BUTTON_ID = "efficiencyMorningMeetingAutoSteamRefreshButton";
  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const CARD_ID = "efficiencyMorningMeetingAutoSteamCard";
  const DATE_ID = "efficiencyMorningMeetingAutoSteamDate";
  const STATUS_ID = "efficiencyMorningMeetingAutoSteamStatus";
  const POLL_INTERVAL = 1500;
  const MAXIMUM_WAIT = 5 * 60 * 1000;

  const VALUE_IDS = {
    steamSalesLowPressure:
      "efficiencyMorningMeetingAutoDailySteamSalesLowPressure",
    steamSalesHighPressure:
      "efficiencyMorningMeetingAutoDailySteamSalesHighPressure",
    steamSales:
      "efficiencyMorningMeetingAutoSteamSales",
    unitOneProduction:
      "efficiencyMorningMeetingAutoSteamProductionUnitOne",
    unitTwoProduction:
      "efficiencyMorningMeetingAutoSteamProductionUnitTwo",
    totalProduction:
      "efficiencyMorningMeetingAutoSteamProductionTotal"
  };

  const text = value => String(value ?? "").trim();

  function isDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(text(value));
  }

  function dateFromText(value) {
    return text(value).match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
  }

  function resolveTargetDate() {
    const panel = document.getElementById(PANEL_ID);
    const cardDate = document.getElementById(DATE_ID);

    const candidates = [
      panel?.dataset?.morningMeetingAutoBaseDate,
      panel?.dataset?.steamStatusTargetDate,
      dateFromText(cardDate?.textContent),
      dateFromText(
        document.getElementById("efficiencyMorningMeetingWaterDate")
          ?.textContent
      ),
      dateFromText(
        document.getElementById("efficiencyMorningMeetingShiftDate")
          ?.textContent
      )
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

    return {
      Accept: "application/json",
      ...extra
    };
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
        data.message ||
        data.error ||
        fallback ||
        `OIS 증기 조회 요청에 실패했습니다. (HTTP ${response.status})`
      );
    }

    return data;
  }

  async function createRequest(targetDate) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: headers({
        "Content-Type": "application/json"
      }),
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
    const requestType = text(
      item.requestType || item.request_type
    )
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

    if (requestType && requestType !== "steam_status") {
      throw new Error(
        `증기 조회 요청이 ${requestType}(으)로 저장되었습니다. steam_status가 필요합니다.`
      );
    }

    const id = text(item.id || data.id);
    if (!id) {
      throw new Error("OIS 증기 조회 요청 ID를 확인하지 못했습니다.");
    }

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
    return new Promise(resolve => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function waitForCompletion(id) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < MAXIMUM_WAIT) {
      const data = await getRequest(id);
      const item = data.item;

      if (!item) {
        throw new Error("OIS 증기 조회 요청을 찾지 못했습니다.");
      }

      const status = text(item.status).toLowerCase();

      if (status === "complete") {
        return item;
      }

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
      item?.result &&
      typeof item.result === "object" &&
      !Array.isArray(item.result)
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
      steamSalesLowPressure: requireNumber(
        raw,
        "steamSalesLowPressure",
        "저압 증기 판매량"
      ),
      steamSalesHighPressure: requireNumber(
        raw,
        "steamSalesHighPressure",
        "고압 증기 판매량"
      ),
      steamSales: requireNumber(raw, "steamSales", "총 증기 판매량"),
      unitOneProduction: requireNumber(
        raw,
        "unitOneProduction",
        "1호기 증기 생산량"
      ),
      unitTwoProduction: requireNumber(
        raw,
        "unitTwoProduction",
        "2호기 증기 생산량"
      ),
      totalProduction: requireNumber(
        raw,
        "totalProduction",
        "총 증기 생산량"
      ),
      source: text(raw.source) || "OIS",
      requestId: text(item.id)
    };

    const round3 = value => Math.round(value * 1000) / 1000;

    if (
      Math.abs(
        round3(
          result.steamSalesLowPressure +
          result.steamSalesHighPressure
        ) - round3(result.steamSales)
      ) > 0.05
    ) {
      throw new Error("저압 + 고압과 총 증기 판매량이 일치하지 않습니다.");
    }

    if (
      Math.abs(
        round3(
          result.unitOneProduction +
          result.unitTwoProduction
        ) - round3(result.totalProduction)
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

  function setStatus(message, state) {
    const element = document.getElementById(STATUS_ID);
    if (!element) return;

    element.textContent = message;
    element.dataset.steamOisProbeStatus = state || "";
  }

  function renderResult(result) {
    for (const [key, id] of Object.entries(VALUE_IDS)) {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = formatTon(result[key]);
      }
    }

    const card = document.getElementById(CARD_ID);
    if (card) {
      card.dataset.steamSource = "ois";
      card.dataset.steamSourceDate = result.sourceDate;
      card.dataset.steamRequestId = result.requestId;
    }

    setStatus("OIS 조회 완료", "complete");

    window.__morningMeetingSteamOisProbeLastResult = result;

    document.dispatchEvent(
      new CustomEvent("morningMeetingSteamOisProbeLoaded", {
        detail: result
      })
    );

    console.log("오전회의 증기 생산·판매 OIS 확인 완료:", result);
  }

  async function run(button) {
    const targetDate = resolveTargetDate();

    if (!targetDate) {
      throw new Error("오전회의 증기 조회 기준일을 확인하지 못했습니다.");
    }

    setStatus("OIS 조회중", "loading");
    button.disabled = true;

    try {
      const id = await createRequest(targetDate);
      const item = await waitForCompletion(id);
      const result = normalizeResult(item, targetDate);
      renderResult(result);
    } catch (error) {
      setStatus("조회 실패", "error");
      console.error("오전회의 증기 생산·판매 OIS 조회 실패:", error);
      window.alert?.(
        error instanceof Error
          ? error.message
          : "OIS 증기 생산·판매 조회에 실패했습니다."
      );
    } finally {
      button.disabled = false;
    }
  }

  function prepareButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.title = "OIS에서 증기 생산·판매 재조회";
    button.dataset.steamSource = "ois";
  }

  document.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof Element
          ? event.target.closest(`#${BUTTON_ID}`)
          : null;

      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      void run(target);
    },
    true
  );

  const observer = new MutationObserver(prepareButton);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", prepareButton, {
      once: true
    });
  } else {
    prepareButton();
  }
})();