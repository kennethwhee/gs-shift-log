/* Explicit morning meeting actions: current operational sources only; no Daily DATA Excel. */
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
  const QUERY_BUTTONS = { all: "morningMeetingAllQueryButton", operations: "morningMeetingOperationsQueryButton" };
  const REQUERY_BUTTON_ID = "morningMeetingRequeryButton";
  // MORNING_MEETING_NEW_QUERY_LABEL_V3 · UI wording only
const BUTTON_LABELS = { all: "전체조회", operations: "운영정보조회", requery: "새로 조회" };
  const BUTTON_IDS = ["morningMeetingAllQueryButton", "morningMeetingOperationsQueryButton", "morningMeetingCofiringRefreshButton",
    "efficiencyMorningMeetingAutoDailyPowerRefreshButton", "efficiencyMorningMeetingAutoSteamRefreshButton",
    "efficiencyMorningMeetingAutoDailySludgeRefreshButton", "efficiencyMorningMeetingAutoRetry-water",
    "efficiencyMorningMeetingAutoRetry-limestone", "efficiencyMorningMeetingAutoRetry-gear-pinion",
    "efficiencyMorningMeetingAutoRetry-silo-level", "efficiencyMorningMeetingAutoSmpRefreshButton",
    "efficiencyMorningMeetingAutoWeatherRefreshButton"];
  // MORNING_ALL_STEAM_COORDINATOR_V2: explicit, awaited steam stage.
  /* MORNING_ALL_QUERY_ELAPSED_V1_START */
  let morningElapsedRun = null;
  let morningElapsedLast = null;
  let morningElapsedTimer = null;
  const morningElapsedNow = () => window.performance?.now?.() ?? Date.now();

  function renderMorningElapsed() {
    const date = targetDate();
    const toolbar = byId(TOOLBAR_ID);
    if (!toolbar) return;
    const run = morningElapsedRun?.started != null ? morningElapsedRun : morningElapsedLast;
    let badge = byId("morningMeetingElapsedTime");
    if (!badge) {
      const actions = toolbar.querySelector(".morning-meeting-workbook-query__actions");
      if (!actions) return;
      badge = makeElement("span", "morning-meeting-elapsed");
      badge.id = "morningMeetingElapsedTime";
      badge.setAttribute("role", "status");
      badge.setAttribute("aria-live", "off");
      actions.insertBefore(badge, actions.firstChild);
    }
    const visible = Boolean(run && run.date === date && canQuery());
    if (badge.hidden === visible) badge.hidden = !visible;
    if (!visible) return;
    const elapsed = run.status === "running"
      ? Math.max(0, morningElapsedNow() - run.started) : run.elapsed;
    const label = {
      running: "조회 중", complete: "조회 완료", partial: "일부 실패",
      failed: "조회 실패", ended: "조회 종료", interrupted: "측정 중단"
    }[run.status] || "조회 종료";
    setText(badge, `${run.kind === "requery" ? "새로 조회 · " : ""}${label} ${(elapsed / 1000).toFixed(1)}초`);
    if (badge.dataset.state !== run.status) badge.dataset.state = run.status;
    const title = `${run.date} · ${run.kind === "requery" ? "재조회 확인 후" : "전체조회 시작부터"} 전체 조회 처리 종료까지의 경과시간 (저장값 조회 포함)`;
    if (badge.title !== title) badge.title = title;
  }

  function clearMorningElapsedTick() {
    if (morningElapsedTimer !== null) window.clearTimeout(morningElapsedTimer);
    morningElapsedTimer = null;
  }

  function startMorningElapsed(kind, date) {
    const run = morningElapsedRun;
    if (!run || run.date !== date || run.kind !== kind || run.started !== null) return;
    run.started = morningElapsedNow();
    run.status = "running";
    function tick() {
      morningElapsedTimer = null;
      if (morningElapsedRun !== run || run.status !== "running") return;
      if (targetDate() !== run.date) {
        run.elapsed = Math.max(0, morningElapsedNow() - run.started);
        run.status = "interrupted";
        renderMorningElapsed();
        return;
      }
      renderMorningElapsed();
      morningElapsedTimer = window.setTimeout(tick, 200);
    }
    clearMorningElapsedTick();
    tick();
  }

  function morningElapsedOutcome(result, date) {
    if (!Array.isArray(result) || !result.length) return "ended";
    const failures = result.some(item => item?.status === "rejected" ||
      ["error", "failed", "partial"].includes(item?.status) ||
      item?.value === null || item?.value === false || item?.value?.ok === false ||
      ["error", "failed", "partial"].includes(item?.value?.status));
    const operations = operationsState(date);
    if (failures || ["error", "partial"].includes(operations?.status)) return "partial";
    // A settled request does not prove that every source had data.
    return "ended";
  }

  async function measureMorningAction(kind, options, action) {
    const date = targetDate();
    if (morningElapsedRun || options.userInitiated !== true || !canQuery() || !isDate(date) ||
        activeRequest || activeResetRequest || externalQueryBusy()) return action();
    const run = { kind, date, started: null, elapsed: 0, status: "pending" };
    morningElapsedRun = run;
    if (kind === "all") startMorningElapsed(kind, date);
    let outcome = "ended";
    try {
      const result = await action();
      outcome = morningElapsedOutcome(result, date);
      return result;
    } catch (error) {
      outcome = "failed";
      throw error;
    } finally {
      if (morningElapsedRun === run) {
        clearMorningElapsedTick();
        if (run.started !== null) {
          if (run.status !== "interrupted") {
            run.elapsed = Math.max(0, morningElapsedNow() - run.started);
            run.status = targetDate() === date ? outcome : "interrupted";
          }
          morningElapsedLast = run;
        }
        morningElapsedRun = null;
        renderMorningElapsed();
      }
    }
  }

  async function query(source, options = {}) {
    if (source !== "all") return queryWithoutElapsedV1(source, options);
    return measureMorningAction("all", options, () => queryWithoutElapsedV1(source, options));
  }

  async function requeryAll(options = {}) {
    return measureMorningAction("requery", options, () => requeryWithoutElapsedV1(options));
  }
  /* MORNING_ALL_QUERY_ELAPSED_V1_END */

  const localStates = new Map();
  const resetStates = new Map();
  const resetStatusRequests = new Map();
  let activeRequest = null;
  let activeResetRequest = null;
  let requeryBusyDate = "";
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

  function hasSession() {
    return typeof getShiftLogSessionToken === "function" && Boolean(text(getShiftLogSessionToken()));
  }

  function canQuery() {
    if (window.matchMedia?.("(max-width: 900px)").matches ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator?.userAgent || "") ||
        (window.navigator?.platform === "MacIntel" && Number(window.navigator?.maxTouchPoints) > 0)) return false;
    return hasSession();
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
      setSourceState(item.targetDate, "steam", { status: "idle", error: "" });
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
    // Saved-card readers may inspect reset status on mobile; only new company-PC queries require canQuery().
    if (!isDate(selectedDate) || !hasSession() || !requestFetch) return null;
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
        const payload = await readResetResponse(response, "선택일 자료삭제 상태를 확인하지 못했습니다.", selectedDate);
        return storeResetItem(payload.item, selectedDate, true);
      } catch (error) {
        const previous = resetStates.get(selectedDate) || {};
        if (!previous.loaded) resetStates.set(selectedDate, { ...previous, loaded: false, loading: false,
          error: text(error?.message) || "선택일 자료삭제 상태를 확인하지 못했습니다." });
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

  function operationsState(date) {
    return localStates.get(date)?.operations || { status: "idle", error: "" };
  }

  function isBusy() { return Boolean(activeRequest || activeResetRequest); }

  function externalQueryBusy() {
    return Boolean(window.__efficiencyMorningMeetingBulkLookupPromise) ||
      window.isEfficiencyMorningMeetingSteamOisBusy?.() === true ||
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
    /* GS_SELECTED_DATE_DELETE_V8_REQUIRED_OPERATION_OUTCOME */
    const outcomes = Array.isArray(result) ? result : [];
    let failed = 0;
    let complete = 0;
    const errors = [];

    for (const outcome of outcomes) {
      const item = outcome?.value;

      if (outcome?.status === "rejected") {
        failed += 1;
        errors.push(text(outcome.reason?.message) || "운영정보 필수 항목을 불러오지 못했습니다.");
        continue;
      }

      if (outcome?.status === "fulfilled" && ["skipped-complete", "waited-existing"].includes(item?.status)) {
        complete += 1;
        continue;
      }

      if (outcome?.status === "fulfilled" && item?.status === "fulfilled") {
        const optional =
          ["smp-price", "weather"].includes(text(item?.key)) ||
          Boolean(text(item?.optionalError));

        if (optional) {
          // SMP/weather are optional presentation sources. Their failure must not
          // keep an otherwise successful selected-date rebuild tombstoned.
          complete += 1;
          continue;
        }

        if (item.result === null || item.result === false) {
          failed += 1;
          errors.push("운영정보 필수 항목을 불러오지 못했습니다. 해당 카드의 상태를 확인해 주세요.");
        } else if (item.result !== undefined) {
          complete += 1;
        }
      }
    }

    if (targetDate() === date) {
      const statusIds = [
        "efficiencyMorningMeetingAutoWaterStatus",
        "efficiencyMorningMeetingAutoLimestoneStatus",
        "efficiencyMorningMeetingAutoGearPinionStatus",
        "efficiencyMorningMeetingAutoSiloStatus"
      ];
      if (statusIds.some(id => ["is-error", "is-failed"].some(name => byId(id)?.classList.contains(name))) && !failed) {
        failed = 1;
        errors.push("운영정보 필수 항목을 불러오지 못했습니다. 해당 카드의 상태를 확인해 주세요.");
      }
    }

    return {
      status: failed
        ? (complete ? "partial" : "error")
        : outcomes.length && complete === outcomes.length
          ? "complete"
          : "ended",
      error: [...new Set(errors)].join(" ")
    };
  }
  function recordAllSteamFlow(current, event, extra = {}) {
    if (current?.source !== "all") return;
    // Diagnostics only: no credentials, measurements, persistence, or network calls.
    const entry = { event, date: current.date, at: Date.now(), ...extra };
    current.flowEvents = [...(current.flowEvents || []), entry].slice(-12);
    window.__morningMeetingAllSteamLastRun = {
      date: current.date,
      startedAt: current.startedAt,
      stage: current.stage,
      events: current.flowEvents.map(item => ({ ...item }))
    };
    try { console.info?.("[MORNING ALL STEAM V2]", entry); } catch (_) {}
  }

  function validateAllSteamCompletion(value, date) {
    // A resolved object can be a valid partial result. Never require sales values
    // or complete=true: an upstream blank remains blank in the existing reader.
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("증기 OIS 조회가 완료 결과를 반환하지 않았습니다.");
    }
    const resultDate = text(value.sourceDate || value.targetDate);
    if (resultDate !== date || (value.targetDate && text(value.targetDate) !== date)) {
      throw new Error("증기 OIS 조회 기준일이 다릅니다. 선택일 " + date);
    }
    if (text(value.requestType || value.sourceRequestType) !== "steam_status" || !text(value.requestId)) {
      throw new Error("증기 OIS 조회 요청의 완료 결과를 확인하지 못했습니다.");
    }
    return value;
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
      const caption = makeElement("span", "morning-meeting-workbook-query__caption", "운영정보 · TO 전력 · 증기 OIS · 혼소/유기성 마감자료");
      caption.id = "morningMeetingWorkbookSource";
      const statuses = makeElement("div", "morning-meeting-workbook-query__statuses");
      for (const source of ["operations", "steam"]) {
        const group = makeElement("span", "morning-meeting-workbook-query__source-status");
        group.append(makeElement("span", "morning-meeting-workbook-query__source-label", source === "steam" ? "증기 OIS" : "운영정보"));
        const status = makeElement("span", "morning-meeting-workbook-query__status");
        status.id = `morningMeetingQuerySourceStatus-${source}`;
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        group.append(status);
        statuses.append(group);
      }
      const actions = makeElement("div", "morning-meeting-workbook-query__actions");
      for (const source of ["all", "operations"]) {
        const button = makeElement("button", `morning-meeting-workbook-query__button${source === "all" ? " is-primary" : ""}`, BUTTON_LABELS[source]);
        button.id = QUERY_BUTTONS[source];
        button.type = "button";
        if (source === "operations") {
          button.hidden = true;
          button.disabled = true;
          button.setAttribute("aria-hidden", "true");
          button.tabIndex = -1;
        }
        button.addEventListener("click", event => {
          event.preventDefault();
          void query(source, { userInitiated: true });
        });
        actions.append(button);
      }
      const requeryButton = makeElement(
        "button",
        "morning-meeting-workbook-query__button",
        BUTTON_LABELS.requery
      );
      requeryButton.id = REQUERY_BUTTON_ID;
      requeryButton.type = "button";
      requeryButton.addEventListener("click", event => {
        event.preventDefault();
        void requeryAll({ userInitiated: true });
      });
      actions.append(requeryButton);
      const resetButton = makeElement("button", "morning-meeting-workbook-query__button is-danger", "자료삭제");
      resetButton.id = RESET_BUTTON_ID;
      resetButton.type = "button";
      resetButton.addEventListener("click", event => {
        event.preventDefault();
        if (typeof window.deleteMorningMeetingSelectedDateData === "function") {
          void window.deleteMorningMeetingSelectedDateData();
        }
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
    renderMorningElapsed();
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
    const operations = operationsState(date);
    const busy = isBusy() || externalQueryBusy() || requeryBusyDate === date;
    toolbar.dataset.resetActive = resetActive ? "true" : "false";
    toolbar.dataset.resetTargetDate = date;

    const badge = byId("morningMeetingQuerySourceStatus-operations");
    if (badge) {
      setText(badge, operations.status === "loading" ? "조회 중" : operations.status === "error" ? "조회 실패" :
        operations.status === "partial" ? "일부 실패" : operations.status === "complete" ? "조회 완료" :
        operations.status === "ended" ? "조회 종료" : "조회 전");
      for (const status of ["loading", "error", "partial", "complete"]) {
        badge.classList.toggle(`is-${status}`, operations.status === status);
      }
      badge.title = operations.error || `${date} 운영정보 조회 상태`;
    }

    const steam = localStates.get(date)?.steam || { status: "idle", error: "" };
    const steamBadge = byId("morningMeetingQuerySourceStatus-steam");
    if (steamBadge) {
      setText(steamBadge, steam.status === "waiting" ? "순서 대기" :
        steam.status === "loading" ? "조회 중" : steam.status === "complete" ? "조회 완료" :
        steam.status === "error" ? "조회 실패" : "조회 전");
      steamBadge.classList.toggle("is-loading", ["waiting", "loading"].includes(steam.status));
      steamBadge.classList.toggle("is-complete", steam.status === "complete");
      steamBadge.classList.toggle("is-error", steam.status === "error");
      steamBadge.title = steam.error || `${date} 증기 조회 처리 상태 · 원본에 없는 수치는 기존 표시를 유지합니다.`;
    }

    const caption = byId("morningMeetingWorkbookSource");
    setText(caption, "운영정보 · TO 전력 · 증기 OIS · 혼소/유기성 마감자료");
    if (caption) caption.title = "오전회의 카드는 일일 DATA Excel을 조회하지 않습니다.";

    for (const id of BUTTON_IDS) {
      const control = byId(id);
      if (!control) continue;
      if (id === QUERY_BUTTONS.operations) {
        control.hidden = true;
        control.disabled = true;
        continue;
      }
      if (["morningMeetingCofiringRefreshButton", "efficiencyMorningMeetingAutoDailySludgeRefreshButton"].includes(id)) continue;
      control.hidden = !allowed;
      const isAllControl = id === QUERY_BUTTONS.all;
      control.disabled = !allowed || !isDate(date) || busy || reset.loading || resetStatusUnavailable ||
        (resetActive && !isAllControl) || control.dataset.morningBulkLocked === "true";
      const source = Object.keys(QUERY_BUTTONS).find(key => QUERY_BUTTONS[key] === id) || "current";
      control.title = !isDate(date) ? "자료 기준일을 선택해 주세요." : reset.loading ? "선택일 자료삭제 상태를 확인하고 있습니다." :
        resetStatusUnavailable ? (reset.error || "선택일의 초기화 상태를 확인하지 못했습니다.") :
        resetActive && source !== "all" ? "자료삭제된 날짜는 전체조회 또는 재조회를 사용해 주세요." :
        source === "all" ? (resetActive ? "운영정보·TO 전력·증기 OIS·마감자료에서 선택일 자료를 다시 구성합니다." :
          "저장된 선택일 자료를 우선 사용하고 없는 자료만 기존 조회 경로에서 보완합니다.") :
        source === "operations" ? "수처리·석회석·터빈·Silo·SMP·날씨를 조회합니다." : control.title;
    }
    for (const [source, id] of Object.entries(QUERY_BUTTONS)) {
      const selectedBusy = activeRequest?.date === date && activeRequest.source === source;
      const busyLabel = source === "all"
        ? activeRequest?.stage === "steam" ? "증기 조회 중…"
          : activeRequest?.stage === "finishing" ? "마무리 중…" : "전체조회 중…"
        : "조회 중…";
      setText(byId(id), selectedBusy ? busyLabel : BUTTON_LABELS[source]);
    }
    const requeryButton = byId(REQUERY_BUTTON_ID);
    if (requeryButton) {
      requeryButton.hidden = !allowed;
      requeryButton.disabled =
        !allowed ||
        !isDate(date) ||
        busy ||
        reset.loading ||
        resetStatusUnavailable;
      setText(
        requeryButton,
        requeryBusyDate === date ? "새로 조회 중…" : BUTTON_LABELS.requery
      );
      requeryButton.title = !isDate(date)
        ? "자료 기준일을 선택해 주세요."
        : reset.loading
          ? "선택일 자료삭제 상태를 확인하고 있습니다."
          : resetStatusUnavailable
            ? (reset.error || "선택일의 초기화 상태를 확인하지 못했습니다.")
            : "저장된 조회값을 재사용하지 않고 모든 현재 자료원을 처음부터 다시 조회합니다. 기존 값은 새 조회가 끝날 때까지 안전하게 유지합니다.";
    }
    const resetButton = byId(RESET_BUTTON_ID);
    if (resetButton) {
      resetButton.hidden = !allowed;
      resetButton.disabled = !allowed || !isDate(date) || busy || reset.loading || resetActive;
      resetButton.dataset.morningMeetingResetAction = "delete";
      resetButton.classList.remove("is-reset-active");
      resetButton.setAttribute("aria-pressed", "false");
      setText(resetButton, "자료삭제");
      resetButton.title = !isDate(date) ? "자료 기준일을 선택해 주세요." : reset.loading ? "선택일 자료삭제 상태를 확인하고 있습니다." :
        reset.error ? `${reset.error} 최신 상태를 확인한 뒤 다시 시도해 주세요.` : resetActive ?
        `${date} 자료가 삭제된 상태입니다. [전체조회] 또는 [새로 조회]로 다시 구성할 수 있습니다.` :
        `${date} 오전회의자료 및 자동적산 저장자료만 삭제합니다. TO 전력·혼소율 원본은 유지됩니다.`;
    }
    if (typeof window.runEfficiencyMorningMeetingBulkLookup === "function") {
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
      showResetMessage("선택일 자료삭제 상태를 확인하지 못했습니다.", "error");
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
        showResetMessage(state.error || "선택일 자료삭제 상태를 확인하지 못했습니다.", "error");
        return null;
      }
      state = resetState(date);
    }
    return state.active ? restoreReset(date, { ...options, expectedRevision: state.revision }) :
      resetSelectedDate(date, { ...options, expectedRevision: state.revision });
  }

  // GS_MORNING_REQUERY_NON_DESTRUCTIVE_R6
  async function requeryWithoutElapsedV1(options = {}) {
    const date = targetDate();

    if (
      options.userInitiated !== true ||
      !canQuery() ||
      !isDate(date) ||
      activeRequest ||
      activeResetRequest ||
      requeryBusyDate === date ||
      externalQueryBusy()
    ) {
      return null;
    }

    let state = resetState(date);

    if (!state.loaded || state.error) {
      const loaded =
        await loadResetStatus(
          date,
          { force: true }
        );

      if (!loaded) {
        showResetMessage(
          state.error ||
          "선택일 자료 상태를 확인하지 못했습니다.",
          "error"
        );

        return null;
      }

      state = resetState(date);
    }

    const message =
      date +
      " 저장된 조회값을 사용하지 않고 모든 자료를 처음부터 다시 조회하시겠습니까?\n\n" +
      "현재 화면의 기존 값은 새 조회가 끝날 때까지 유지하며, TO 원본 입력·혼소율 마감/조정·유기성 하역기록·OIS 원본과 다른 날짜 자료는 삭제하지 않습니다.";

    if (
      typeof window.confirm !== "function" ||
      window.confirm(message) !== true
    ) {
      return null;
    }

    requeryBusyDate = date;
    startMorningElapsed("requery", date);
    notifyQueryState();
    render();

    try {
      // Keep the selected-date blank tombstone active while a forced requery runs.
      // query("all") releases it only after every required source stage succeeds.
      return await query(
        "all",
        {
          userInitiated: true,
          forceRefresh: true,
          requery: true
        }
      );
    } catch (error) {
      showResetMessage(
        text(error?.message) ||
        "선택일 전체 새로 조회에 실패했습니다.",
        "error"
      );

      return null;
    } finally {
      if (requeryBusyDate === date) {
        requeryBusyDate = "";
      }

      notifyQueryState();
      render();
    }
  }

  async function queryWithoutElapsedV1(source, options = {}) {
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

    const releaseAfterSuccess = source === "all" && reset.active;
    const forceFresh = releaseAfterSuccess || options.forceRefresh === true;
    const resetRevision = reset.revision;
    const current = { date, source, stage: "operations", startedAt: Date.now(), timings: {} };
    activeRequest = current;
    setSourceState(date, "operations", { status: "loading", busy: true });
    if (source === "all") {
      setSourceState(date, "steam", { status: "waiting", error: "" });
      recordAllSteamFlow(current, "all-start");
    }
    notifyQueryState();
    render();

    let operationsSucceeded = false;
    let steamSucceeded = source !== "all";
    let powerSucceeded = source !== "all";
    let closedSucceeded = source !== "all";
    const results = [];

    try {
      const loader = window.runEfficiencyMorningMeetingBulkLookup;
      if (typeof loader !== "function") throw new Error("운영정보 조회 기능을 불러오지 못했습니다. 새로고침해 주세요.");
      /*
       * MORNING_MEETING_EARLY_NON_OIS_V1_R2B_V22
       *
       * Power and closing-data do not use the shared
       * operating OIS navigation lane.
       *
       * Start them immediately while operating OIS runs.
       */
      const settleCurrentSourceTask =
        (name, task) => {
          const startedAt = Date.now();
          current.timings[name] = { startedAt };
          return Promise
            .resolve()
            .then(task)
            .then(
              value => {
                const endedAt = Date.now();
                current.timings[name] = { startedAt, endedAt, durationMs: endedAt - startedAt, status: "fulfilled" };
                return { status: "fulfilled", value };
              },
              reason => {
                const endedAt = Date.now();
                current.timings[name] = { startedAt, endedAt, durationMs: endedAt - startedAt, status: "rejected", error: text(reason?.message) };
                return { status: "rejected", reason };
              }
            );
        };
      const earlyCurrentSourceTasks =
        source === "all"
          ? {
              power: settleCurrentSourceTask(
                "power",
                () => window.toNightPower?.refreshMeeting?.({
                  allowBlockedRebuild: releaseAfterSuccess || options.requery === true
                })
              ),
              closed: settleCurrentSourceTask(
                "closed",
                () => window.morningMeetingClosedCofiring?.refreshOrganicFromClosing?.({
                  userInitiated: true,
                  allowBlockedRebuild: releaseAfterSuccess || options.requery === true
                })
              ),
              steam: settleCurrentSourceTask(
                "steam",
                async () => {
                  setSourceState(date, "steam", { status: "loading", error: "" });
                  recordAllSteamFlow(current, "steam-start");
                  render();
                  try {
                    if (targetDate() !== date || !canQuery()) {
                      throw new Error("기준일 또는 로그인 상태가 변경되어 증기 조회를 시작하지 않았습니다.");
                    }
                    const steamLoader = window.loadEfficiencyMorningMeetingSteamOis;
                    if (typeof steamLoader !== "function") {
                      throw new Error("증기 OIS 조회 기능이 로드되지 않았습니다. 새로고침 후 전체조회를 다시 실행해 주세요.");
                    }
                    const pending = steamLoader.call(window, {
                      userInitiated: true,
                      targetDate: date,
                      forceRefresh: forceFresh,
                      ignoreSaved: forceFresh,
                      silent: true,
                      requireComplete: false
                    });
                    if (!pending || typeof pending.then !== "function") {
                      throw new Error("증기 OIS 조회의 완료 대기 연결을 확인하지 못했습니다.");
                    }
                    const value = validateAllSteamCompletion(await pending, date);
                    setSourceState(date, "steam", { status: "complete", error: "", requestId: value.requestId });
                    recordAllSteamFlow(current, "steam-complete", { requestId: value.requestId });
                    return value;
                  } catch (error) {
                    setSourceState(date, "steam", { status: "error", error: text(error?.message) || "증기 OIS 조회에 실패했습니다." });
                    recordAllSteamFlow(current, "steam-failed", { error: text(error?.message) });
                    if (targetDate() === date) showResetMessage(text(error?.message) || "증기 OIS 조회에 실패했습니다.", "error");
                    throw error;
                  }
                }
              )
            }
          : null;

      try {
        recordAllSteamFlow(current, "operations-start");
        current.timings.operations = { startedAt: Date.now() };
        const result = await loader({
          userInitiated: true,
          targetDate: date,
          ...(forceFresh ? { forceRefresh: true } : {})
        });
        results.push({ source: "operations", status: "fulfilled", value: result });
        if (targetDate() === date) {
          const outcome = operationsOutcome(result, date);
          setSourceState(date, "operations", outcome);
          operationsSucceeded = outcome.status === "complete";
        }
      } catch (error) {
        results.push({ source: "operations", status: "rejected", reason: error });
        setSourceState(date, "operations", { status: "error", error: text(error?.message) || "운영정보 조회에 실패했습니다." });
      }

      if (current.timings.operations?.startedAt) {
        const endedAt = Date.now();
        current.timings.operations = {
          ...current.timings.operations,
          endedAt,
          durationMs: endedAt - current.timings.operations.startedAt,
          status: operationsSucceeded ? "fulfilled" : "rejected"
        };
      }
      recordAllSteamFlow(current, "operations-settled", { operationsSucceeded });
      if (source === "all") {
        /*
          Steam remains OIS work.

          It starts only after the operating R2A
          serial lane has settled.
        */
        const currentSourceTasks = [
          ["power", earlyCurrentSourceTasks?.power],
          ["steam", earlyCurrentSourceTasks?.steam],
          ["closed", earlyCurrentSourceTasks?.closed]
        ];
        current.stage = "finishing";
        render();
        const currentResults =
          await Promise.all(
            currentSourceTasks.map(
              ([, task]) =>
                task
            )
          );
        currentResults.forEach((result, index) => {
          const name = currentSourceTasks[index][0];
          results.push({ source: name, ...result });
          if (name === "steam") steamSucceeded = result.status === "fulfilled";
          if (name === "power") powerSucceeded = result.status === "fulfilled";
          if (name === "closed") closedSucceeded = result.status === "fulfilled";
          // Steam fulfillment is possible only after the awaited provider result
          // has passed date/request validation, including legitimate partial data.
        });
      }

      if (releaseAfterSuccess && operationsSucceeded && steamSucceeded && powerSucceeded && closedSucceeded) {
        let releasedItem = null;
        try {
          releasedItem = await postResetAction(RESET_ACTIONS.release, date, resetRevision);
        } catch (error) {
          showResetMessage(`${date} 전체조회는 완료됐지만 초기화를 해제하지 못했습니다. ${text(error?.message)}`, "error");
        }
        if (releasedItem) {
          const followupErrors = [];
          let smpPersisted = false;
          try {
            smpPersisted = typeof window.persistEfficiencyMorningMeetingFreshSmpAfterReset === "function" &&
              await window.persistEfficiencyMorningMeetingFreshSmpAfterReset(date, releasedItem.revision) === true;
            if (!smpPersisted) throw new Error("SMP 저장을 완료하지 못했습니다.");
          } catch (error) {
            followupErrors.push(text(error?.message) || "SMP 저장을 완료하지 못했습니다.");
          }
          const latestReset = await loadResetStatus(date, { force: true });
          if (!latestReset) followupErrors.push("초기화 상태를 다시 확인하지 못했습니다.");
          if (smpPersisted) {
            try {
              const historyRefreshResult = await window.refreshEfficiencyMorningMeetingAutoHistory?.();
              if (historyRefreshResult === false) throw new Error("자동수치 기록을 다시 불러오지 못했습니다.");
            } catch (error) {
              followupErrors.push(text(error?.message) || "자동수치 기록을 다시 불러오지 못했습니다.");
            }
          }
          showResetMessage(followupErrors.length
            ? `${date} 초기화 해제는 완료됐지만 SMP 저장 또는 자동수치 기록 갱신을 완료하지 못했습니다. ${followupErrors.join(" ")}`
            : `${date} 현재 자료원을 다시 조회하고 초기화를 해제했습니다.`, followupErrors.length ? "error" : "");
        }
      } else if (releaseAfterSuccess && (!operationsSucceeded || !steamSucceeded || !powerSucceeded || !closedSucceeded)) {
        showResetMessage(`${date} 자료삭제 상태를 유지합니다. 운영정보·TO 전력·증기 OIS·혼소/유기성 마감자료 조회 상태를 확인해 주세요.`, "error");
      }

      return source === "all" ? results : results.find(item => item.source === "operations")?.value ?? null;
    } finally {
      if (source === "all") {
        const lastSteamState = localStates.get(date)?.steam;
        if (["waiting", "loading"].includes(lastSteamState?.status)) {
          setSourceState(date, "steam", { status: "error", error: "전체조회가 증기 처리 완료 전에 중단되었습니다." });
        }
        current.stage = "settled";
        recordAllSteamFlow(current, "all-settled", { operationsSucceeded, steamSucceeded });
        const endedAt = Date.now();
        const summary = {
          date,
          source,
          startedAt: current.startedAt,
          endedAt,
          totalMs: endedAt - current.startedAt,
          operationsSucceeded,
          steamSucceeded,
          powerSucceeded,
          closedSucceeded,
          sources: { ...current.timings }
        };
        window.__morningMeetingAllLastTiming = summary;
        console.info?.("[MORNING ALL PERF V12] SUMMARY", summary);
      }
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
    toggleReset,
    requeryAll
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
