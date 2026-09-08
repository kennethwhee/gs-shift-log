/* Four morning meeting cards read the selected month's open Daily DATA workbook. */
(function installMorningMeetingQuerySources() {
  "use strict";
  if (window.morningMeetingQuerySources) return;

  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const PREVIEW_ID = "efficiencyMorningMeetingAutoPreview";
  const TOOLBAR_ID = "morningMeetingQuerySources";
  const CARD_IDS = ["efficiencyMorningMeetingAutoDailyPowerCard", "efficiencyMorningMeetingAutoSteamCard",
    "efficiencyMorningMeetingAutoCofiringCard", "efficiencyMorningMeetingAutoDailySludgeCard"];
  const BUTTON_IDS = ["morningMeetingWorkbookQueryButton", "morningMeetingCofiringRefreshButton",
    "efficiencyMorningMeetingAutoDailyPowerRefreshButton", "efficiencyMorningMeetingAutoSteamRefreshButton",
    "efficiencyMorningMeetingAutoDailySludgeRefreshButton"];
  const VALUE_KEYS = ["generatorEcmsGen1", "powerGeneration", "ismartReception", "electricityReceived",
    "epowerTransmission", "electricityTransmitted", "solarDailyGeneration", "solarDaily",
    "solarMonthlyCumulative", "solarYearlyCumulative", "steamSalesLowPressure", "steamSalesHighPressure",
    "steamSales", "unitOneProduction", "unitTwoProduction", "sludgeTotal", "sludgeTruckCount",
    "organicDaySilo", "organicStorageSiloA", "organicStorageSiloB", "organicSiloTotal",
    "coalUsageUnitOne", "coalUsageUnitTwo", "bioUsageUnitOne", "bioUsageUnitTwo", "organicUsageUnitOne", "organicUsageUnitTwo"];
  const localStates = new Map();
  let activeRequest = null;
  let renderTimer = null;
  let observer = null;
  const byId = id => document.getElementById(id);
  const text = value => String(value ?? "").trim();
  const setText = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };

  function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function targetDate() {
    const state = window.efficiencyMorningMeetingUploadState || {};
    return [byId(PANEL_ID)?.dataset.morningMeetingAutoBaseDate, state.shiftPart?.reportDate, state.shiftPart?.loadedDate]
      .map(text).find(isDate) || "";
  }

  function canQuery() {
    if (window.matchMedia?.("(max-width: 900px)").matches ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator?.userAgent || "") ||
        (window.navigator?.platform === "MacIntel" && Number(window.navigator?.maxTouchPoints) > 0)) return false;
    return typeof getShiftLogSessionToken === "function" && Boolean(text(getShiftLogSessionToken()));
  }

  function workbookState(date) {
    const local = localStates.get(date) || {};
    const state = window.efficiencyMorningMeetingUploadState || {};
    const panel = byId(PANEL_ID);
    const result = state.steamStatus;
    const resultDate = text(result?.sourceDate || result?.targetDate);
    const hasValues = resultDate === date && VALUE_KEYS.some(key =>
      typeof result?.[key] === "number" && Number.isFinite(result[key]));
    const status = text(panel?.dataset.steamStatusTargetDate) === date ? text(panel?.dataset.steamStatusStatus) : "";
    const error = text(panel?.dataset.steamStatusTargetDate) === date ? text(state.steamStatusError) : "";
    const loading = local.busy || ["loading", "pending", "processing"].includes(status);
    const failed = !loading && (["error", "failed"].includes(status) || local.status === "error");
    return { status: loading ? "loading" : failed ? "error" : hasValues ? "complete" : "idle",
      hasValues, error: error || local.error || "", result: resultDate === date ? result : null };
  }

  function makeElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content) element.textContent = content;
    return element;
  }

  function ensureToolbar() {
    const preview = byId(PREVIEW_ID);
    const grid = preview?.querySelector(".efficiency-morning-meeting-auto-preview__grid");
    if (!grid) return null;
    let toolbar = byId(TOOLBAR_ID);
    if (!toolbar) {
      toolbar = makeElement("div", "morning-meeting-workbook-query");
      toolbar.id = TOOLBAR_ID;
      toolbar.setAttribute("aria-label", "일일 DATA 엑셀 조회");
      const caption = makeElement("span", "morning-meeting-workbook-query__caption", "열린 대상 월 파일에서 4개 카드 조회");
      caption.id = "morningMeetingWorkbookSource";
      const status = makeElement("span", "morning-meeting-workbook-query__status");
      status.id = "morningMeetingQuerySourceStatus-workbook";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      const button = makeElement("button", "morning-meeting-workbook-query__button", "엑셀 조회하기");
      button.id = "morningMeetingWorkbookQueryButton";
      button.type = "button";
      button.addEventListener("click", event => {
        event.preventDefault();
        void query("workbook", { userInitiated: true });
      });
      toolbar.append(caption, status, button);
    }
    if (toolbar.parentElement !== grid) {
      const dateBar = grid.querySelector(".efficiency-morning-meeting-auto-common-date");
      grid.insertBefore(toolbar, dateBar?.parentElement === grid ? dateBar.nextSibling : grid.firstChild);
    }
    return toolbar;
  }

  function render() {
    if (!ensureToolbar()) return;
    const date = targetDate();
    const allowed = canQuery();
    const view = workbookState(date);
    const badge = byId("morningMeetingQuerySourceStatus-workbook");
    const button = byId("morningMeetingWorkbookQueryButton");
    setText(badge, view.status === "loading" ? "조회 중" : view.status === "error" ? "조회 실패" :
      view.status === "complete" ? "조회 완료" : "조회 전");
    for (const status of ["loading", "error", "complete"]) badge.classList.toggle(`is-${status}`, view.status === status);
    badge.title = view.error || (view.hasValues ? `${date} 엑셀 조회값` : "선택일에 저장된 엑셀 조회값이 없습니다.");
    if (view.status === "error" && view.hasValues) badge.title += " · 기존 저장값을 유지합니다.";
    const file = text(view.result?.workbook).split(/[\\/]/).pop();
    const caption = byId("morningMeetingWorkbookSource");
    setText(caption, file ? `${file}${view.result?.workbookSource === "open_workbook" ? " · 열린 파일에서 조회" : ""}`
      : "열린 대상 월 파일에서 4개 카드 조회");
    caption.title = [text(view.result?.workbookFullName), text(view.result?.collectedAt)].filter(Boolean).join(" · ") ||
      "조회할 날짜에 해당하는 일일DATA관리 엑셀을 회사 PC에서 열어 주세요.";
    for (const id of BUTTON_IDS) {
      const control = byId(id);
      if (!control) continue;
      control.hidden = !allowed;
      control.disabled = !allowed || !isDate(date) || Boolean(activeRequest) || view.status === "loading";
      control.title = isDate(date) ? `${date.slice(0, 7)} 일일DATA관리 엑셀에서 혼소·전력·증기·유기성 값을 읽습니다.` : "자료 기준일을 선택해 주세요.";
    }
    setText(button, view.status === "loading" ? "조회 중…" : "엑셀 조회하기");
  }

  async function query(source, options = {}) {
    const date = targetDate();
    if (source !== "workbook" || options.userInitiated !== true || !canQuery() || !isDate(date) ||
        activeRequest || workbookState(date).status === "loading") return null;
    const current = { date };
    activeRequest = current;
    localStates.set(date, { busy: true });
    render();
    try {
      const loader = window.loadEfficiencyMorningMeetingDailyData;
      if (typeof loader !== "function") throw new Error("엑셀 조회 기능을 불러오지 못했습니다. 새로고침해 주세요.");
      const result = await loader({ userInitiated: true, forceRefresh: true, querySource: "daily_data_excel" });
      localStates.delete(date);
      return result;
    } catch (error) {
      localStates.set(date, { status: "error", error: text(error?.message) || "엑셀 조회에 실패했습니다." });
      return null;
    } finally {
      if (activeRequest === current) activeRequest = null;
      render();
    }
  }

  function scheduleRender() {
    if (renderTimer !== null) return;
    renderTimer = window.setTimeout(() => { renderTimer = null; render(); }, 0);
  }

  function initialize() {
    const panel = byId(PANEL_ID);
    if (panel && !observer) {
      const relevantIds = [PREVIEW_ID, ...CARD_IDS, ...BUTTON_IDS.slice(1)];
      observer = new MutationObserver(mutations => {
        if (mutations.some(mutation => mutation.type === "attributes" || [...mutation.addedNodes].some(node =>
          relevantIds.includes(node.id) || relevantIds.some(id => node.querySelector?.(`#${id}`))))) scheduleRender();
      });
      observer.observe(panel, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["data-morning-meeting-auto-base-date", "data-steam-status-status", "data-steam-status-target-date"] });
    }
    document.addEventListener("efficiencyMorningMeetingSteamStatusLoaded", scheduleRender);
    byId("resetEfficiencyMorningMeetingButton")?.addEventListener("click", () => { localStates.clear(); scheduleRender(); });
    window.addEventListener("resize", scheduleRender);
    render();
  }

  window.morningMeetingQuerySources = Object.freeze({ render, query, targetDate });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
