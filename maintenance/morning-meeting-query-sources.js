/* Explicit morning meeting actions: operations, open workbook, or both. */
(function installMorningMeetingQuerySources() {
  "use strict";
  if (window.morningMeetingQuerySources) return;

  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const PREVIEW_ID = "efficiencyMorningMeetingAutoPreview";
  const TOOLBAR_ID = "morningMeetingQuerySources";
  const CARD_IDS = ["efficiencyMorningMeetingAutoDailyPowerCard", "efficiencyMorningMeetingAutoSteamCard",
    "efficiencyMorningMeetingAutoCofiringCard", "efficiencyMorningMeetingAutoDailySludgeCard"];
  const QUERY_BUTTONS = { all: "morningMeetingAllQueryButton", operations: "morningMeetingOperationsQueryButton", workbook: "morningMeetingWorkbookQueryButton" };
  const BUTTON_LABELS = { all: "전체자료", operations: "운영정보조회", workbook: "엑셀 조회하기" };
  const BUTTON_IDS = ["morningMeetingAllQueryButton", "morningMeetingOperationsQueryButton", "morningMeetingWorkbookQueryButton", "morningMeetingCofiringRefreshButton",
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
    const local = localStates.get(date)?.workbook || {};
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

  function operationsState(date) {
    return localStates.get(date)?.operations || { status: "idle", error: "" };
  }

  function isBusy() { return Boolean(activeRequest); }

  function externalQueryBusy() {
    return Boolean(window.__efficiencyMorningMeetingBulkLookupPromise) ||
      ["loading", "pending", "processing"].includes(text(byId(PANEL_ID)?.dataset.steamStatusStatus));
  }

  function setSourceState(date, source, state) {
    const previous = localStates.get(date) || {};
    localStates.set(date, { ...previous, [source]: state });
  }

  function notifyQueryState() {
    if (typeof CustomEvent === "function" && typeof document.dispatchEvent === "function") {
      document.dispatchEvent(new CustomEvent("morningMeetingQueryModeStateChanged"));
    }
  }

  function operationsOutcome(result, date) {
    const outcomes = Array.isArray(result) ? result : [];
    let failed = 0;
    let complete = 0;
    const errors = [];
    for (const outcome of outcomes) {
      const item = outcome?.value;
      if (outcome?.status === "rejected") {
        failed += 1;
        errors.push(text(outcome.reason?.message) || "운영정보 일부 항목을 불러오지 못했습니다.");
      } else if (outcome?.status === "fulfilled" && ["skipped-complete", "waited-existing"].includes(item?.status)) {
        complete += 1;
      } else if (outcome?.status === "fulfilled" && item?.status === "fulfilled") {
        if (item.result === null || item.result === false) {
          failed += 1;
          errors.push("운영정보 일부 항목을 불러오지 못했습니다. 해당 카드의 상태를 확인해 주세요.");
        } else if (item.result !== undefined) complete += 1;
      }
    }
    if (targetDate() === date) {
      const statusIds = ["efficiencyMorningMeetingAutoWaterStatus", "efficiencyMorningMeetingAutoLimestoneStatus",
        "efficiencyMorningMeetingAutoGearPinionStatus", "efficiencyMorningMeetingAutoSiloStatus"];
      if (statusIds.some(id => ["is-error", "is-failed"].some(name => byId(id)?.classList.contains(name))) && !failed) {
        failed = 1;
        errors.push("운영정보 일부 항목을 불러오지 못했습니다. 해당 카드의 상태를 확인해 주세요.");
      }
    }
    return { status: failed ? (complete ? "partial" : "error") : outcomes.length && complete === outcomes.length ? "complete" : "ended",
      error: [...new Set(errors)].join(" ") };
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
      toolbar.setAttribute("aria-label", "오전회의 자료 조회");
      const caption = makeElement("span", "morning-meeting-workbook-query__caption", "열린 대상 월 파일에서 4개 카드 조회");
      caption.id = "morningMeetingWorkbookSource";
      const statuses = makeElement("div", "morning-meeting-workbook-query__statuses");
      for (const source of ["operations", "workbook"]) {
        const group = makeElement("span", "morning-meeting-workbook-query__source-status");
        group.append(makeElement("span", "morning-meeting-workbook-query__source-label", source === "operations" ? "운영정보" : "엑셀"));
        const status = makeElement("span", "morning-meeting-workbook-query__status");
        status.id = `morningMeetingQuerySourceStatus-${source}`;
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        group.append(status);
        statuses.append(group);
      }
      const actions = makeElement("div", "morning-meeting-workbook-query__actions");
      for (const source of ["all", "operations", "workbook"]) {
        const button = makeElement("button", `morning-meeting-workbook-query__button${source === "all" ? " is-primary" : ""}`, BUTTON_LABELS[source]);
        button.id = QUERY_BUTTONS[source];
        button.type = "button";
        button.addEventListener("click", event => {
          event.preventDefault();
          void query(source, { userInitiated: true });
        });
        actions.append(button);
      }
      toolbar.append(caption, statuses, actions);
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
    const operations = operationsState(date);
    const busy = isBusy() || externalQueryBusy();
    for (const [source, state] of [["operations", operations], ["workbook", view]]) {
      const badge = byId(`morningMeetingQuerySourceStatus-${source}`);
      setText(badge, state.status === "loading" ? "조회 중" : state.status === "error" ? "조회 실패" :
        state.status === "partial" ? "일부 실패" : state.status === "complete" ? "조회 완료" : state.status === "ended" ? "조회 종료" : "조회 전");
      for (const status of ["loading", "error", "partial", "complete"]) badge.classList.toggle(`is-${status}`, state.status === status);
      badge.title = state.error || (source === "workbook" ? (view.hasValues ? `${date} 엑셀 조회값` : "선택일에 저장된 엑셀 조회값이 없습니다.") : `${date} 운영정보 조회 상태`);
      if (source === "workbook" && state.status === "error" && view.hasValues) badge.title += " · 기존 저장값을 유지합니다.";
    }
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
      control.disabled = !allowed || !isDate(date) || busy || control.dataset.morningBulkLocked === "true";
      const source = Object.keys(QUERY_BUTTONS).find(key => QUERY_BUTTONS[key] === id) || "workbook";
      control.title = !isDate(date) ? "자료 기준일을 선택해 주세요." : source === "all" ? "운영정보와 열린 월간 엑셀을 함께 조회합니다." :
        source === "operations" ? "수처리·석회석·터빈·Silo·SMP·날씨를 조회합니다." : `${date.slice(0, 7)} 일일DATA관리 엑셀에서 혼소·전력·증기·유기성 값을 읽습니다.`;
    }
    for (const [source, id] of Object.entries(QUERY_BUTTONS)) {
      setText(byId(id), activeRequest?.date === date && activeRequest.source === source ? "조회 중…" : BUTTON_LABELS[source]);
    }
    if (typeof window.runEfficiencyMorningMeetingBulkLookup === "function" &&
        typeof window.loadEfficiencyMorningMeetingDailyData === "function") {
      for (const id of ["loadEfficiencyMorningMeetingWaterButton", "efficiencyMorningMeetingAutoPreviewStatus"]) {
        const legacyControl = byId(id);
        if (legacyControl) legacyControl.hidden = true;
      }
    }
  }

  async function query(source, options = {}) {
    const date = targetDate();
    if (!Object.hasOwn(QUERY_BUTTONS, source) || options.userInitiated !== true || !canQuery() || !isDate(date) ||
        activeRequest || externalQueryBusy()) return null;
    const sources = source === "all" ? ["operations", "workbook"] : [source];
    const current = { date, source };
    activeRequest = current;
    for (const selected of sources) setSourceState(date, selected, { status: "loading", busy: true });
    notifyQueryState();
    render();
    const run = async selected => {
      try {
        const loader = selected === "operations" ? window.runEfficiencyMorningMeetingBulkLookup : window.loadEfficiencyMorningMeetingDailyData;
        if (typeof loader !== "function") throw new Error(`${selected === "operations" ? "운영정보" : "엑셀"} 조회 기능을 불러오지 못했습니다. 새로고침해 주세요.`);
        const result = await loader(selected === "operations" ? { userInitiated: true, targetDate: date } :
          { userInitiated: true, forceRefresh: true, querySource: "daily_data_excel" });
        if (targetDate() !== date) {
          setSourceState(date, selected, { status: "idle" });
          return result;
        }
        if (selected === "operations") {
          setSourceState(date, selected, operationsOutcome(result, date));
        } else {
          const panel = byId(PANEL_ID);
          const failed = text(panel?.dataset.steamStatusTargetDate) === date && ["error", "failed"].includes(text(panel?.dataset.steamStatusStatus));
          if (result === null || result === false || failed) throw new Error(text(window.efficiencyMorningMeetingUploadState?.steamStatusError) || "엑셀 조회 결과를 가져오지 못했습니다.");
          setSourceState(date, selected, {});
        }
        return result;
      } catch (error) {
        setSourceState(date, selected, { status: "error", error: text(error?.message) || "자료 조회에 실패했습니다." });
        throw error;
      } finally {
        render();
      }
    };
    try {
      // Each async invocation catches a synchronous loader error so the other source still starts.
      const results = await Promise.allSettled(sources.map(run));
      return source === "all" ? results : results[0].status === "fulfilled" ? results[0].value : null;
    } finally {
      if (activeRequest === current) activeRequest = null;
      notifyQueryState();
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
      const relevantIds = [PREVIEW_ID, ...CARD_IDS, ...BUTTON_IDS.slice(3), "loadEfficiencyMorningMeetingWaterButton"];
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

  window.morningMeetingQuerySources = Object.freeze({ render, query, targetDate, isBusy });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
