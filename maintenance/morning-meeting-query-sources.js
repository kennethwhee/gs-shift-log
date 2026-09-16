/* Explicit morning meeting actions: operations, open workbook, or both. */
(function installMorningMeetingQuerySources() {
  "use strict";
  if (window.morningMeetingQuerySources) return;

  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const PREVIEW_ID = "efficiencyMorningMeetingAutoPreview";
  const TOOLBAR_ID = "morningMeetingQuerySources";
  const RESET_BUTTON_ID = "morningMeetingResetButton";
  const REQUEST_API_URL = "/api/ois-data-requests";
  const RESET_STATUS_ACTION = "morning_meeting_auto_history_reset_status";
  const RESET_ACTIONS = Object.freeze({
    reset: "reset_morning_meeting_auto_history",
    restore: "restore_morning_meeting_auto_history_reset",
    release: "release_morning_meeting_auto_history_reset"
  });
  const CARD_IDS = ["efficiencyMorningMeetingAutoDailyPowerCard", "efficiencyMorningMeetingAutoSteamCard",
    "efficiencyMorningMeetingAutoCofiringCard", "efficiencyMorningMeetingAutoDailySludgeCard"];
  const QUERY_BUTTONS = { all: "morningMeetingAllQueryButton", operations: "morningMeetingOperationsQueryButton", workbook: "morningMeetingWorkbookQueryButton" };
  const BUTTON_LABELS = { all: "전체자료", operations: "운영정보조회", workbook: "엑셀 조회하기" };
  const BUTTON_IDS = ["morningMeetingAllQueryButton", "morningMeetingOperationsQueryButton", "morningMeetingWorkbookQueryButton", "morningMeetingCofiringRefreshButton",
    "efficiencyMorningMeetingAutoDailyPowerRefreshButton", "efficiencyMorningMeetingAutoSteamRefreshButton",
    "efficiencyMorningMeetingAutoDailySludgeRefreshButton", "efficiencyMorningMeetingAutoRetry-water",
    "efficiencyMorningMeetingAutoRetry-limestone", "efficiencyMorningMeetingAutoRetry-gear-pinion",
    "efficiencyMorningMeetingAutoRetry-silo-level", "efficiencyMorningMeetingAutoSmpRefreshButton",
    "efficiencyMorningMeetingAutoWeatherRefreshButton"];
  const VALUE_KEYS = ["generatorEcmsGen1", "powerGeneration", "ismartReception", "electricityReceived",
    "epowerTransmission", "electricityTransmitted", "solarDailyGeneration", "solarDaily",
    "solarMonthlyCumulative", "solarYearlyCumulative", "steamSalesLowPressure", "steamSalesHighPressure",
    "steamSales", "unitOneProduction", "unitTwoProduction", "sludgeTotal", "sludgeTruckCount",
    "organicDaySilo", "organicStorageSiloA", "organicStorageSiloB", "organicSiloTotal",
    "coalUsageUnitOne", "coalUsageUnitTwo", "bioUsageUnitOne", "bioUsageUnitTwo", "organicUsageUnitOne", "organicUsageUnitTwo"];
  const localStates = new Map();
  const resetStates = new Map();
  const resetStatusRequests = new Map();
  let activeRequest = null;
  let activeResetRequest = null;
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

  function fetcher() {
    if (typeof window.fetch === "function") return window.fetch.bind(window);
    if (typeof fetch === "function") return fetch;
    return null;
  }

  function authHeaders(jsonRequest = false) {
    const headers = typeof window.getShiftLogAuthHeaders === "function" ? window.getShiftLogAuthHeaders() : {};
    const token = typeof getShiftLogSessionToken === "function" ? text(getShiftLogSessionToken()) : "";
    return {
      ...headers,
      Accept: "application/json",
      ...(token && !headers.Authorization ? { Authorization: `Bearer ${token}` } : {}),
      ...(jsonRequest ? { "Content-Type": "application/json" } : {})
    };
  }

  function normalizeResetItem(value, fallbackDate = "") {
    const item = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const date = isDate(text(item.targetDate)) ? text(item.targetDate) : fallbackDate;
    const revision = Number(item.revision);
    return {
      targetDate: date,
      active: item.active === true,
      resetAt: text(item.resetAt),
      resetById: text(item.resetById),
      resetByName: text(item.resetByName),
      restoredAt: text(item.restoredAt),
      revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0
    };
  }

  function resetState(date = targetDate()) {
    const entry = resetStates.get(date);
    const item = normalizeResetItem(entry?.item, date);
    return { ...item, loaded: entry?.loaded === true, loading: entry?.loading === true, error: text(entry?.error) };
  }

  function notifyResetState(item) {
    if (typeof CustomEvent === "function" && typeof document.dispatchEvent === "function") {
      document.dispatchEvent(new CustomEvent("morningMeetingResetStateChanged", { detail: item }));
    }
  }

  function isSameResetItem(left, right) {
    return ["targetDate", "active", "resetAt", "resetById", "resetByName", "restoredAt", "revision"]
      .every(key => left?.[key] === right?.[key]);
  }

  function storeResetItem(value, fallbackDate = "", applySelectedState = false) {
    const item = normalizeResetItem(value, fallbackDate);
    if (!isDate(item.targetDate)) return null;
    const existingEntry = resetStates.get(item.targetDate);
    const hasExistingItem = Boolean(existingEntry?.item && typeof existingEntry.item === "object");
    const existingItem = hasExistingItem ? normalizeResetItem(existingEntry.item, item.targetDate) : null;
    if (existingItem && (item.revision < existingItem.revision ||
        (item.revision === existingItem.revision && !isSameResetItem(item, existingItem)))) {
      if (existingEntry.loading) {
        resetStates.set(item.targetDate, { ...existingEntry, loaded: true, loading: false, item: existingItem });
        render();
      }
      return existingItem;
    }
    resetStates.set(item.targetDate, { loaded: true, loading: false, error: "", item });
    if (item.active) {
      setSourceState(item.targetDate, "operations", { status: "idle", error: "" });
      setSourceState(item.targetDate, "workbook", { status: "idle", error: "" });
    }
    if (applySelectedState && typeof window.applyMorningMeetingSelectedDateResetState === "function") {
      try { window.applyMorningMeetingSelectedDateResetState(item); } catch (error) { console.error(error); }
    }
    notifyResetState(item);
    render();
    return item;
  }

  function showResetMessage(message, type = "") {
    if (typeof window.showToast === "function") window.showToast(message, type);
  }

  async function readResetResponse(response, fallbackMessage, fallbackDate) {
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok || payload?.ok === false) {
      const error = new Error(text(payload?.message || payload?.error) || fallbackMessage || `요청에 실패했습니다. (HTTP ${response.status})`);
      error.status = response.status;
      error.payload = payload;
      if (response.status === 409 && (payload?.currentItem || payload?.item)) {
        storeResetItem(payload.currentItem || payload.item, fallbackDate, true);
      }
      throw error;
    }
    if (!payload?.item || typeof payload.item !== "object") throw new Error("초기화 상태 응답을 확인하지 못했습니다.");
    return payload;
  }

  async function loadResetStatus(date = targetDate(), options = {}) {
    const selectedDate = text(date);
    const requestFetch = fetcher();
    if (!isDate(selectedDate) || !canQuery() || !requestFetch) return null;
    const current = resetStates.get(selectedDate);
    if (current?.loaded && options.force !== true) return normalizeResetItem(current.item, selectedDate);
    if (resetStatusRequests.has(selectedDate)) return resetStatusRequests.get(selectedDate);
    resetStates.set(selectedDate, { ...current, loaded: false, loading: true, error: "" });
    render();
    const request = (async () => {
      try {
        const response = await requestFetch(`${REQUEST_API_URL}?action=${encodeURIComponent(RESET_STATUS_ACTION)}&targetDate=${encodeURIComponent(selectedDate)}&_=${Date.now()}`, {
          method: "GET", headers: authHeaders(false), credentials: "same-origin", cache: "no-store"
        });
        const payload = await readResetResponse(response, "선택일 자료 초기화 상태를 확인하지 못했습니다.", selectedDate);
        return storeResetItem(payload.item, selectedDate, true);
      } catch (error) {
        const previous = resetStates.get(selectedDate) || {};
        if (!previous.loaded) resetStates.set(selectedDate, { ...previous, loaded: false, loading: false,
          error: text(error?.message) || "선택일 자료 초기화 상태를 확인하지 못했습니다." });
        render();
        return null;
      } finally {
        resetStatusRequests.delete(selectedDate);
      }
    })();
    resetStatusRequests.set(selectedDate, request);
    return request;
  }

  async function postResetAction(action, date, expectedRevision) {
    const requestFetch = fetcher();
    if (!requestFetch) throw new Error("초기화 요청 기능을 불러오지 못했습니다. 새로고침해 주세요.");
    const response = await requestFetch(REQUEST_API_URL, {
      method: "POST", headers: authHeaders(true), credentials: "same-origin", cache: "no-store",
      body: JSON.stringify({ action, targetDate: date, expectedRevision })
    });
    const payload = await readResetResponse(response, "선택일 자료 초기화 요청을 처리하지 못했습니다.", date);
    return storeResetItem(payload.item, date, true);
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

  function isBusy() { return Boolean(activeRequest || activeResetRequest); }

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
      const resetButton = makeElement("button", "morning-meeting-workbook-query__button is-danger", "초기화");
      resetButton.id = RESET_BUTTON_ID;
      resetButton.type = "button";
      resetButton.addEventListener("click", event => {
        event.preventDefault();
        void toggleReset({ userInitiated: true });
      });
      actions.append(resetButton);
      toolbar.append(caption, statuses, actions);
    }
    if (toolbar.parentElement !== grid) {
      const dateBar = grid.querySelector(".efficiency-morning-meeting-auto-common-date");
      grid.insertBefore(toolbar, dateBar?.parentElement === grid ? dateBar.nextSibling : grid.firstChild);
    }
    return toolbar;
  }

  function render() {
    const toolbar = ensureToolbar();
    if (!toolbar) return;
    const date = targetDate();
    const allowed = canQuery();
    const requestFetch = fetcher();
    const currentReset = resetState(date);
    if (allowed && requestFetch && isDate(date) && !currentReset.loaded && !currentReset.loading && !currentReset.error) {
      void loadResetStatus(date);
    }
    const reset = resetState(date);
    const resetActive = reset.active === true;
    const resetStatusUnavailable = Boolean(requestFetch && (!reset.loaded || reset.error));
    const storedView = workbookState(date);
    const view = resetActive && localStates.get(date)?.workbook?.status === "idle"
      ? { status: "idle", hasValues: false, error: "", result: null }
      : storedView;
    const operations = operationsState(date);
    const busy = isBusy() || externalQueryBusy();
    toolbar.dataset.resetActive = resetActive ? "true" : "false";
    toolbar.dataset.resetTargetDate = date;
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
      const isAllControl = id === QUERY_BUTTONS.all;
      control.disabled = !allowed || !isDate(date) || busy || reset.loading || resetStatusUnavailable ||
        (resetActive && !isAllControl) || control.dataset.morningBulkLocked === "true";
      const source = Object.keys(QUERY_BUTTONS).find(key => QUERY_BUTTONS[key] === id) || "workbook";
      control.title = !isDate(date) ? "자료 기준일을 선택해 주세요." : reset.loading ? "선택일의 초기화 상태를 확인하고 있습니다." :
        resetStatusUnavailable ? (reset.error || "선택일의 초기화 상태를 확인하지 못했습니다.") :
        resetActive && source !== "all" ? "초기화된 날짜는 전체자료로 운영정보와 엑셀을 함께 다시 조회해 주세요." :
        source === "all" ? (resetActive ? "운영정보와 열린 월간 엑셀을 강제로 다시 조회한 뒤 초기화를 해제합니다." : "운영정보와 열린 월간 엑셀을 함께 조회합니다.") :
        source === "operations" ? "수처리·석회석·터빈·Silo·SMP·날씨를 조회합니다." : `${date.slice(0, 7)} 일일DATA관리 엑셀에서 혼소·전력·증기·유기성 값을 읽습니다.`;
    }
    for (const [source, id] of Object.entries(QUERY_BUTTONS)) {
      setText(byId(id), activeRequest?.date === date && activeRequest.source === source ? "조회 중…" : BUTTON_LABELS[source]);
    }
    const resetButton = byId(RESET_BUTTON_ID);
    if (resetButton) {
      resetButton.hidden = !allowed;
      resetButton.disabled = !allowed || !isDate(date) || busy || reset.loading;
      resetButton.dataset.morningMeetingResetAction = resetActive ? "restore" : "reset";
      resetButton.classList.toggle("is-reset-active", resetActive);
      resetButton.setAttribute("aria-pressed", resetActive ? "true" : "false");
      setText(resetButton, activeResetRequest?.date === date ? "처리 중…" : resetActive ? "초기화 취소" : "초기화");
      resetButton.title = !isDate(date) ? "자료 기준일을 선택해 주세요." : reset.loading ? "선택일의 초기화 상태를 확인하고 있습니다." :
        reset.error ? `${reset.error} 버튼을 누르면 상태를 다시 확인합니다.` : resetActive ? `${date} 자료 초기화를 취소하고 저장된 원본을 다시 표시합니다.` :
        `${date} 조회 자료를 비웁니다. 원본 자료와 다른 날짜는 삭제하지 않습니다.`;
    }
    if (typeof window.runEfficiencyMorningMeetingBulkLookup === "function" &&
        typeof window.loadEfficiencyMorningMeetingDailyData === "function") {
      for (const id of ["loadEfficiencyMorningMeetingWaterButton", "efficiencyMorningMeetingAutoPreviewStatus"]) {
        const legacyControl = byId(id);
        if (legacyControl) legacyControl.hidden = true;
      }
    }
  }

  async function ensureResetStateForAction(date, expectedRevision) {
    const known = resetState(date);
    if (known.loaded || Number.isSafeInteger(expectedRevision)) return known;
    const loaded = await loadResetStatus(date, { force: true });
    return loaded ? resetState(date) : null;
  }

  async function runResetMutation(kind, date, options = {}) {
    const selectedDate = text(date);
    if (!Object.hasOwn(RESET_ACTIONS, kind) || options.userInitiated !== true || !canQuery() || !isDate(selectedDate) ||
        activeRequest || activeResetRequest || externalQueryBusy()) return null;
    const requestedRevision = Number(options.expectedRevision);
    const state = await ensureResetStateForAction(selectedDate,
      Number.isSafeInteger(requestedRevision) && requestedRevision >= 0 ? requestedRevision : undefined);
    if (!state) {
      showResetMessage("선택일 자료 초기화 상태를 확인하지 못했습니다.", "error");
      return null;
    }
    if (activeRequest || activeResetRequest || externalQueryBusy()) return null;
    const expectedRevision = Number.isSafeInteger(requestedRevision) && requestedRevision >= 0 ? requestedRevision : state.revision;
    if ((kind === "restore" || kind === "release") && expectedRevision < 1) return null;
    const message = kind === "reset"
      ? `${selectedDate} 오전회의 조회 자료를 모두 초기화하시겠습니까?\n\n선택일 화면만 비우며 원본 자료와 다른 날짜는 삭제하지 않습니다. 자동 재조회도 실행하지 않습니다.`
      : `${selectedDate} 자료 초기화를 취소하고 저장된 원본 조회값을 다시 표시하시겠습니까?`;
    if (kind !== "release" && (typeof window.confirm !== "function" || window.confirm(message) !== true)) return null;
    const request = { kind, date: selectedDate };
    activeResetRequest = request;
    notifyQueryState();
    render();
    try {
      const item = await postResetAction(RESET_ACTIONS[kind], selectedDate, expectedRevision);
      if (kind === "reset") {
        showResetMessage(`${selectedDate} 조회 자료를 초기화했습니다.`);
      } else if (kind === "restore") {
        try {
          if (targetDate() === selectedDate &&
              typeof window.restoreMorningMeetingSavedCompletedHistoryForDate === "function") {
            const restored = await window.restoreMorningMeetingSavedCompletedHistoryForDate(selectedDate);
            if (restored === false) throw new Error("저장 원본 화면 갱신 실패");
          }
          showResetMessage(`${selectedDate} 자료 초기화를 취소하고 저장된 원본을 복원했습니다.`);
        } catch (error) {
          showResetMessage(`${selectedDate} 자료 초기화 취소는 완료됐지만 화면을 갱신하지 못했습니다. 새로고침해 주세요.`, "error");
        }
      }
      return item;
    } catch (error) {
      showResetMessage(text(error?.message) || "선택일 자료 초기화 요청을 처리하지 못했습니다.", "error");
      return null;
    } finally {
      if (activeResetRequest === request) activeResetRequest = null;
      notifyQueryState();
      render();
    }
  }

  async function resetSelectedDate(date = targetDate(), options = {}) {
    return runResetMutation("reset", date, options);
  }

  async function restoreReset(date, options = {}) {
    return runResetMutation("restore", date, options);
  }

  async function toggleReset(options = {}) {
    const date = targetDate();
    if (options.userInitiated !== true || !canQuery() || !isDate(date)) return null;
    let state = resetState(date);
    if (!state.loaded || state.error) {
      const loaded = await loadResetStatus(date, { force: true });
      if (!loaded) {
        showResetMessage(state.error || "선택일 자료 초기화 상태를 확인하지 못했습니다.", "error");
        return null;
      }
      state = resetState(date);
    }
    return state.active ? restoreReset(date, { ...options, expectedRevision: state.revision }) :
      resetSelectedDate(date, { ...options, expectedRevision: state.revision });
  }

  async function query(source, options = {}) {
    const date = targetDate();
    if (!Object.hasOwn(QUERY_BUTTONS, source) || options.userInitiated !== true || !canQuery() || !isDate(date) ||
        activeRequest || activeResetRequest || externalQueryBusy()) return null;
    let reset = resetState(date);
    if (fetcher() && (!reset.loaded || reset.error)) {
      const loaded = await loadResetStatus(date, { force: true });
      if (!loaded) return null;
      reset = resetState(date);
    }
    if (activeRequest || activeResetRequest || externalQueryBusy() || (reset.active && source !== "all")) return null;
    const sources = source === "all" ? ["operations", "workbook"] : [source];
    const releaseAfterSuccess = source === "all" && reset.active;
    const resetRevision = reset.revision;
    const sourceSucceeded = new Map();
    const current = { date, source };
    activeRequest = current;
    for (const selected of sources) setSourceState(date, selected, { status: "loading", busy: true });
    notifyQueryState();
    render();
    const run = async selected => {
      try {
        const loader = selected === "operations" ? window.runEfficiencyMorningMeetingBulkLookup : window.loadEfficiencyMorningMeetingDailyData;
        if (typeof loader !== "function") throw new Error(`${selected === "operations" ? "운영정보" : "엑셀"} 조회 기능을 불러오지 못했습니다. 새로고침해 주세요.`);
        const result = await loader(selected === "operations" ? { userInitiated: true, targetDate: date,
          ...(releaseAfterSuccess ? { forceRefresh: true } : {}) } :
          { userInitiated: true, forceRefresh: true, querySource: "daily_data_excel" });
        if (targetDate() !== date) {
          setSourceState(date, selected, { status: "idle" });
          return result;
        }
        if (selected === "operations") {
          const outcome = operationsOutcome(result, date);
          setSourceState(date, selected, outcome);
          sourceSucceeded.set(selected, outcome.status === "complete");
        } else {
          const panel = byId(PANEL_ID);
          const failed = text(panel?.dataset.steamStatusTargetDate) === date && ["error", "failed"].includes(text(panel?.dataset.steamStatusStatus));
          if (result === null || result === false || failed) throw new Error(text(window.efficiencyMorningMeetingUploadState?.steamStatusError) || "엑셀 조회 결과를 가져오지 못했습니다.");
          setSourceState(date, selected, {});
          sourceSucceeded.set(selected, true);
        }
        return result;
      } catch (error) {
        sourceSucceeded.set(selected, false);
        setSourceState(date, selected, { status: "error", error: text(error?.message) || "자료 조회에 실패했습니다." });
        throw error;
      } finally {
        render();
      }
    };
    try {
      // Each async invocation catches a synchronous loader error so the other source still starts.
      const results = await Promise.allSettled(sources.map(run));
      if (releaseAfterSuccess && results.every(result => result.status === "fulfilled") &&
          sourceSucceeded.get("operations") === true && sourceSucceeded.get("workbook") === true) {
        let releasedItem = null;
        try {
          releasedItem = await postResetAction(RESET_ACTIONS.release, date, resetRevision);
        } catch (error) {
          showResetMessage(`${date} 전체자료 조회는 완료됐지만 초기화를 해제하지 못했습니다. ${text(error?.message)}`, "error");
        }
        if (releasedItem) {
          const followupErrors = [];
          let smpPersisted = false;
          try {
            smpPersisted = typeof window.persistEfficiencyMorningMeetingFreshSmpAfterReset === "function" &&
              await window.persistEfficiencyMorningMeetingFreshSmpAfterReset(date, releasedItem.revision) === true;
            if (!smpPersisted) {
              throw new Error("SMP 저장을 완료하지 못했습니다.");
            }
          } catch (error) {
            followupErrors.push(text(error?.message) || "SMP 저장을 완료하지 못했습니다.");
          }

          const latestReset = await loadResetStatus(date, { force: true });
          if (!latestReset) followupErrors.push("초기화 상태를 다시 확인하지 못했습니다.");

          if (smpPersisted) {
            try {
              const historyRefreshResult = await window.refreshEfficiencyMorningMeetingAutoHistory?.();
              if (historyRefreshResult === false) {
                throw new Error("자동수치 기록을 다시 불러오지 못했습니다.");
              }
            } catch (error) {
              followupErrors.push(text(error?.message) || "자동수치 기록을 다시 불러오지 못했습니다.");
            }
          }
          showResetMessage(followupErrors.length
            ? `${date} 초기화 해제는 완료됐지만 SMP 저장 또는 자동수치 기록 갱신을 완료하지 못했습니다. ${followupErrors.join(" ")}`
            : `${date} 전체자료를 다시 조회하고 초기화를 해제했습니다.`, followupErrors.length ? "error" : "");
        }
      }
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
    byId("resetEfficiencyMorningMeetingButton")?.addEventListener("click", () => {
      localStates.clear();
      resetStates.clear();
      scheduleRender();
    });
    window.addEventListener("resize", scheduleRender);
    render();
  }

  window.morningMeetingQuerySources = Object.freeze({
    render,
    query,
    targetDate,
    isBusy,
    resetState,
    getResetState: resetState,
    applyResetState: item => storeResetItem(item, text(item?.targetDate), false),
    loadResetStatus,
    resetSelectedDate,
    restoreReset,
    toggleReset
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
