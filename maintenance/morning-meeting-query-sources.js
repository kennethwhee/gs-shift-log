/* Morning meeting source controls. Rendering and saved-result restoration never start a query. */
(function installMorningMeetingQuerySources() {
  "use strict";
  if (window.morningMeetingQuerySources) return;

  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const PREVIEW_ID = "efficiencyMorningMeetingAutoPreview";
  const TOOLBAR_ID = "morningMeetingQuerySources";
  const SOURCE_META = {
    dataparc: { title: "DataPARC", detail: "유기성 Silo 재고", buttonId: "morningMeetingDataParcQueryButton" },
    workbook: { title: "일일 DATA 엑셀", detail: "전력·증기·혼소율·유기성 입고", buttonId: "morningMeetingWorkbookQueryButton" }
  };
  const WORKBOOK_CARDS = [
    ["efficiencyMorningMeetingAutoDailyPowerCard", "일일 DATA 엑셀"],
    ["efficiencyMorningMeetingAutoSteamCard", "일일 DATA 엑셀"],
    ["efficiencyMorningMeetingAutoCofiringCard", "일일 DATA 엑셀"],
    ["efficiencyMorningMeetingAutoDailySludgeCard", "일일 DATA 엑셀 · 입고"]
  ];
  const WORKBOOK_VALUE_KEYS = ["generatorEcmsGen1", "powerGeneration", "ismartReception", "electricityReceived",
    "epowerTransmission", "electricityTransmitted", "solarDailyGeneration", "solarDaily",
    "solarMonthlyCumulative", "solarYearlyCumulative", "steamSalesLowPressure", "steamSalesHighPressure",
    "steamSales", "unitOneProduction", "unitTwoProduction", "sludgeTotal", "sludgeTruckCount"];
  const localStates = new Map();
  let activeRequest = null;
  let renderTimer = null;
  let observer = null;
  const byId = id => document.getElementById(id);
  const text = value => String(value ?? "").trim();
  const stateKey = (source, date) => `${source}:${date}`;
  const setText = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };

  function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function targetDate() {
    const state = window.efficiencyMorningMeetingUploadState || {};
    return [byId(PANEL_ID)?.dataset.morningMeetingAutoBaseDate,
      state.shiftPart?.reportDate, state.shiftPart?.loadedDate]
      .map(text).find(isDate) || "";
  }

  function canQuery() {
    if (window.matchMedia?.("(max-width: 900px)").matches ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator?.userAgent || "") ||
        (window.navigator?.platform === "MacIntel" && Number(window.navigator?.maxTouchPoints) > 0)) return false;
    return typeof getShiftLogSessionToken === "function" && Boolean(text(getShiftLogSessionToken()));
  }

  function dateAllowed(source, date) {
    if (!isDate(date)) return false;
    if (source !== "dataparc") return true;
    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return date >= "2021-01-01" && date < todayKst;
  }

  function sourceState(source, date) {
    const local = localStates.get(stateKey(source, date)) || {};
    const state = window.efficiencyMorningMeetingUploadState || {};
    const panel = byId(PANEL_ID);
    let status = "";
    let error = "";
    let hasValues = false;
    if (source === "dataparc") {
      const inventory = window.organicSiloDataParc?.valuesForWorkbook({});
      hasValues = typeof inventory?.organicSiloTotal === "number" && Number.isFinite(inventory.organicSiloTotal);
      const badge = byId("organicSiloDataParcStatus");
      if (text(badge?.dataset.queryTargetDate) === date) {
        if (badge.classList.contains("is-loading")) status = "loading";
        else if (badge.classList.contains("is-error")) { status = "error"; error = text(badge.title); }
      }
    } else {
      const result = state.steamStatus;
      const resultDate = text(result?.sourceDate || result?.targetDate);
      const requestDate = text(panel?.dataset.steamStatusTargetDate);
      hasValues = resultDate === date && WORKBOOK_VALUE_KEYS.some(key =>
        typeof result?.[key] === "number" && Number.isFinite(result[key]));
      if (requestDate === date) {
        status = text(panel?.dataset.steamStatusStatus);
        error = text(state.steamStatusError);
      }
    }
    const loading = local.busy || ["loading", "pending", "processing"].includes(status);
    const failed = !loading && (status === "error" || status === "failed" || local.status === "error");
    return { status: loading ? "loading" : failed ? "error" : hasValues ? "complete" : "idle",
      hasValues, error: error || local.error || "" };
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
      toolbar = makeElement("div", "morning-meeting-query-sources");
      toolbar.id = TOOLBAR_ID;
      toolbar.setAttribute("aria-label", "자료 출처별 조회");
      for (const [source, meta] of Object.entries(SOURCE_META)) {
        const group = makeElement("div", `morning-meeting-query-source is-${source}`);
        group.dataset.querySource = source;
        const description = makeElement("div", "morning-meeting-query-source__description");
        description.append(makeElement("strong", "", meta.title), makeElement("span", "", meta.detail));
        const status = makeElement("span", "morning-meeting-query-source__status");
        status.id = `morningMeetingQuerySourceStatus-${source}`;
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        const button = makeElement("button", "morning-meeting-query-source__button", "조회하기");
        button.id = meta.buttonId;
        button.type = "button";
        button.setAttribute("aria-label", `${meta.title} 조회하기`);
        button.addEventListener("click", event => {
          event.preventDefault();
          void query(source, { userInitiated: true });
        });
        group.append(description, status, button);
        toolbar.append(group);
      }
    }
    if (toolbar.parentElement !== grid) {
      const dateBar = grid.querySelector(".efficiency-morning-meeting-auto-common-date");
      grid.insertBefore(toolbar, dateBar?.parentElement === grid ? dateBar.nextSibling : grid.firstChild);
    }
    if (preview.dataset.querySourcesReady !== "true") preview.dataset.querySourcesReady = "true";
    return toolbar;
  }

  function ensureCardLabels() {
    for (const [cardId, label] of WORKBOOK_CARDS) {
      const body = byId(cardId)?.querySelector(".efficiency-morning-meeting-auto-card__body");
      if (!body) continue;
      let strip = body.querySelector(".morning-meeting-workbook-source");
      if (!strip) {
        strip = makeElement("div", "morning-meeting-workbook-source", label);
        strip.title = "월간 일일DATA관리 엑셀에 저장된 값을 읽습니다.";
        body.insertBefore(strip, body.firstChild);
      }
    }
  }

  function render() {
    if (!ensureToolbar()) return;
    ensureCardLabels();
    const date = targetDate();
    const allowed = canQuery();
    for (const [source, meta] of Object.entries(SOURCE_META)) {
      const view = sourceState(source, date);
      const badge = byId(`morningMeetingQuerySourceStatus-${source}`);
      const button = byId(meta.buttonId);
      setText(badge, view.status === "loading" ? "조회 중" : view.status === "error" ? "조회 실패" :
        view.status === "complete" ? "조회 완료" : "조회 전");
      badge.classList.toggle("is-loading", view.status === "loading");
      badge.classList.toggle("is-error", view.status === "error");
      badge.classList.toggle("is-complete", view.status === "complete");
      badge.title = view.error || (view.hasValues ? `${date} 저장값` : "선택일에 저장된 값이 없습니다.");
      if (view.status === "error" && view.hasValues) badge.title += " · 기존 저장값을 유지합니다.";
      button.hidden = !allowed;
      button.disabled = !allowed || !dateAllowed(source, date) || Boolean(activeRequest) || view.status === "loading";
      setText(button, view.status === "loading" ? "조회 중…" : "조회하기");
      button.title = !dateAllowed(source, date)
        ? source === "dataparc" ? "어제까지의 자료 기준일을 선택해 주세요." : "자료 기준일을 선택해 주세요."
        : source === "dataparc" ? "선택일의 유기성 Silo 3개와 총 재고량을 DataPARC에서 조회합니다."
        : "선택일의 월간 일일DATA관리 엑셀을 읽어 전력·증기·혼소율·유기성 입고를 갱신합니다.";
    }
  }

  async function query(source, options = {}) {
    const date = targetDate();
    if (!Object.hasOwn(SOURCE_META, source) || options.userInitiated !== true || !canQuery() ||
        !dateAllowed(source, date) || activeRequest || sourceState(source, date).status === "loading") return null;
    const current = { source, date };
    activeRequest = current;
    localStates.set(stateKey(source, date), { busy: true });
    render();
    try {
      const loader = source === "dataparc" ? window.organicSiloDataParc?.load : window.loadEfficiencyMorningMeetingDailyData;
      if (typeof loader !== "function") throw new Error(`${SOURCE_META[source].title} 조회 기능을 불러오지 못했습니다. 새로고침해 주세요.`);
      const result = await loader({ userInitiated: true, forceRefresh: true,
        ...(source === "workbook" ? { querySource: "daily_data_excel" } : {}) });
      localStates.delete(stateKey(source, date));
      return result;
    } catch (error) {
      localStates.set(stateKey(source, date), { status: "error", error: text(error?.message) || "자료 조회에 실패했습니다." });
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
      const relevantIds = [PREVIEW_ID, ...WORKBOOK_CARDS.map(([id]) => id)];
      observer = new MutationObserver(mutations => {
        const changed = mutations.some(mutation => mutation.type === "attributes" ||
          [...mutation.addedNodes].some(node => relevantIds.includes(node.id) ||
            relevantIds.some(id => node.querySelector?.(`#${id}`))));
        if (changed) scheduleRender();
      });
      observer.observe(panel, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["data-morning-meeting-auto-base-date", "data-steam-status-status", "data-steam-status-target-date"] });
    }
    document.addEventListener("efficiencyMorningMeetingSteamStatusLoaded", scheduleRender);
    document.addEventListener("efficiencyMorningMeetingOrganicSiloLoaded", scheduleRender);
    byId("resetEfficiencyMorningMeetingButton")?.addEventListener("click", () => { localStates.clear(); scheduleRender(); });
    window.addEventListener("resize", scheduleRender);
    render();
  }

  window.morningMeetingQuerySources = Object.freeze({ render, query, targetDate });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
