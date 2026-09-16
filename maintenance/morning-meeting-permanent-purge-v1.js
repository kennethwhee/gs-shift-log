(() => {
  "use strict";

  const INSTALL_MARKER = "MORNING_MEETING_RESET_DELETE_V2";
  const API_URL = "/api/morning-meeting-purge";
  const RESET_BUTTON_ID = "morningMeetingResetButton";
  const RESET_LABELS = new Set(["초기화", "초기화 취소", "선택일 자료 초기화"]);
  const CACHE_KEYS = ["gsShiftLog.morningMeetingAutoDataCache.v1"];

  if (window.__morningMeetingResetDeleteV2Installed === true) return;
  window.__morningMeetingResetDeleteV2Installed = true;

  let busy = false;
  let buttonObserver = null;

  function text(value) {
    return String(value ?? "").trim();
  }

  function validDate(value) {
    const date = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10) === date ? date : "";
  }

  function dateFromText(value) {
    const match = text(value).match(/\d{4}-\d{2}-\d{2}/);
    return validDate(match?.[0]);
  }

  function selectedDate() {
    const queryApi = window.morningMeetingQuerySources;
    const panel = document.getElementById("efficiencyMorningMeetingWaterPanel");
    const candidates = [
      typeof queryApi?.targetDate === "function" ? queryApi.targetDate() : "",
      panel?.dataset?.morningMeetingAutoBaseDate,
      panel?.dataset?.waterTargetDate,
      panel?.dataset?.oisTargetDate,
      document.getElementById("efficiencyMorningMeetingAutoDatePicker")?.value,
      document.getElementById("efficiencyMorningMeetingWorkDatePicker")?.value,
      document.getElementById("efficiencyMorningMeetingAutoWaterDate")?.textContent,
      document.getElementById("efficiencyMorningMeetingWaterDate")?.textContent
    ];
    for (const candidate of candidates) {
      const exact = validDate(candidate) || dateFromText(candidate);
      if (exact) return exact;
    }
    return "";
  }

  function isMorningMeetingResetButton(button) {
    if (!button || String(button.tagName || "").toUpperCase() !== "BUTTON") return false;
    if (button.dataset?.morningMeetingResetDeleteV2 === "true") return true;

    const id = text(button.id);
    const label = text(button.textContent);
    if (id === RESET_BUTTON_ID) return true;
    if (!RESET_LABELS.has(label)) return false;

    const view = button.closest?.(
      '#efficiencyMorningMeetingView, [data-efficiency-view="morning-meeting"]'
    );
    if (!view) return false;

    // The selected-date reset lives in the compact source toolbar beside these
    // three query-mode controls.  Match by stable neighbouring labels instead
    // of depending on one historical button id.
    const groupText = text(button.parentElement?.textContent);
    if (
      groupText.includes("전체자료") &&
      groupText.includes("운영정보조회") &&
      groupText.includes("엑셀 조회하기")
    ) {
      return true;
    }

    // Compatibility fallback for renamed ids/classes shipped by the original
    // selected-date reset implementation.  Exact Korean label remains required.
    const identity = `${id} ${text(button.className)} ${text(button.getAttribute?.("data-action"))}`.toLowerCase();
    return identity.includes("morning") && identity.includes("reset");
  }

  function resetButtons() {
    const exact = document.getElementById(RESET_BUTTON_ID);
    const buttons = [];
    if (isMorningMeetingResetButton(exact)) buttons.push(exact);

    const view = document.getElementById("efficiencyMorningMeetingView") ||
      document.querySelector?.('[data-efficiency-view="morning-meeting"]');
    for (const button of view?.querySelectorAll?.("button") || []) {
      if (isMorningMeetingResetButton(button) && !buttons.includes(button)) {
        buttons.push(button);
      }
    }
    return buttons;
  }

  function authHeaders(extra = {}) {
    if (typeof window.getShiftLogAuthHeaders === "function") {
      return window.getShiftLogAuthHeaders(extra);
    }
    let token = "";
    for (const key of ["gsShiftLog.currentUser", "gsShiftLog.auth", "shiftLogUser"]) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        token = text(parsed?.sessionToken || parsed?.session_token || parsed?.token);
        if (token) break;
      } catch (_) {}
    }
    return {
      Accept: "application/json",
      ...extra,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  function notify(message, tone = "") {
    if (typeof window.showToast === "function") {
      window.showToast(message, tone);
      return;
    }
    const status = document.querySelector(
      ".morning-meeting-query-sources-status, [data-morning-meeting-query-status]"
    );
    if (status) {
      status.textContent = message;
      if (tone) status.dataset.tone = tone;
      return;
    }
    console[tone === "error" ? "error" : "log"](message);
  }

  async function parseResponse(response) {
    const raw = await response.text();
    let data = {};
    if (raw.trim()) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        throw new Error("초기화 서버 응답 형식이 올바르지 않습니다.");
      }
    }
    if (!response.ok || data.ok === false) {
      const error = new Error(
        data.message || data.error || `초기화 요청에 실패했습니다. (HTTP ${response.status})`
      );
      error.code = data.code || "";
      error.details = data;
      throw error;
    }
    return data;
  }

  function clearDateFromCacheObject(cache, date) {
    let changed = false;
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) return false;
    for (const value of Object.values(cache)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (Object.prototype.hasOwnProperty.call(value, date)) {
        delete value[date];
        changed = true;
      }
    }
    return changed;
  }

  function clearBrowserDateCaches(date) {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      if (!storage) continue;
      for (const key of CACHE_KEYS) {
        try {
          const raw = storage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (clearDateFromCacheObject(parsed, date)) {
            storage.setItem(key, JSON.stringify(parsed));
          }
        } catch (error) {
          console.warn(`[${INSTALL_MARKER}] cache cleanup skipped`, error);
        }
      }
    }

    const state = window.efficiencyMorningMeetingUploadState;
    if (state && typeof state === "object") {
      for (const key of [
        "waterTreatment",
        "gearPinion",
        "dailyData",
        "steamStatus",
        "siloLevel",
        "limestoneValues",
        "limestone",
        "organicSilo"
      ]) {
        const item = state[key];
        if (!item || typeof item !== "object") continue;
        const itemDate = validDate(item.targetDate) || validDate(item.sourceDate);
        if (!itemDate || itemDate === date) delete state[key];
      }
    }
  }

  function rerender() {
    try { window.renderEfficiencyMorningMeetingAutoPreview?.(); } catch (_) {}
    try { window.renderEfficiencyMorningMeetingSiloLevelPreview?.(); } catch (_) {}
    try { window.renderEfficiencyMorningMeetingDailyData?.(); } catch (_) {}
    try { window.renderEfficiencyMorningMeetingSmpPrice?.(); } catch (_) {}
    try { window.renderEfficiencyMorningMeetingWeather?.(); } catch (_) {}
    try { window.refreshMorningMeetingCofiringCard?.(); } catch (_) {}
    try { window.updateEfficiencyMorningMeetingCreateButton?.(); } catch (_) {}
    try { window.morningMeetingQuerySources?.render?.(); } catch (_) {}
  }

  function normalizeButton(button) {
    if (!isMorningMeetingResetButton(button)) return;
    button.dataset.morningMeetingResetDeleteV2 = "true";
    const nextText = busy ? "삭제 중…" : "초기화";
    const nextTitle = busy
      ? "선택일 저장자료를 삭제하고 있습니다."
      : "선택일의 저장된 오전회의 조회자료를 삭제합니다. 삭제 후에는 복원할 수 없습니다.";

    if (text(button.textContent) !== nextText) button.textContent = nextText;
    if (button.title !== nextTitle) button.title = nextTitle;
    if (button.dataset.morningMeetingResetAction !== "delete") {
      button.dataset.morningMeetingResetAction = "delete";
    }
    if (button.classList?.contains("is-reset-active")) {
      button.classList.remove("is-reset-active");
    }
    if (button.getAttribute("aria-pressed") !== "false") {
      button.setAttribute("aria-pressed", "false");
    }
    if (busy && !button.disabled) button.disabled = true;
  }

  function normalizeButtons() {
    for (const button of resetButtons()) normalizeButton(button);
  }

  function scheduleNormalizeButtons() {
    if (scheduleNormalizeButtons.pending) return;
    scheduleNormalizeButtons.pending = true;
    window.setTimeout(() => {
      scheduleNormalizeButtons.pending = false;
      normalizeButtons();
    }, 0);
  }
  scheduleNormalizeButtons.pending = false;

  function watchButtons() {
    normalizeButtons();
    if (buttonObserver) buttonObserver.disconnect();
    buttonObserver = new MutationObserver(scheduleNormalizeButtons);
    buttonObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "class",
        "aria-pressed",
        "data-morning-meeting-reset-action",
        "data-action",
        "id"
      ]
    });
  }

  function confirmDelete(date) {
    const message = [
      `${date} 오전회의 조회 데이터를 삭제하시겠습니까?`,
      "",
      "[확인]을 누르면 선택일의 저장된 조회 결과를 삭제합니다.",
      "수처리 · 석회석 · Turbine · Silo Level · 일일DATA Excel · 유기성 Silo",
      "",
      "삭제 후에는 기존 값을 복원할 수 없습니다. 취소하려면 [취소]를 눌러주세요.",
      "다른 날짜와 혼소율 기간 계산 이력은 삭제하지 않습니다."
    ].join("\n");
    return typeof window.confirm === "function" && window.confirm(message) === true;
  }

  async function getResetRevision(date) {
    const api = window.morningMeetingQuerySources;
    if (!api) return 0;
    try {
      if (typeof api.loadResetStatus === "function") {
        await api.loadResetStatus(date, { force: true });
      }
      const state = typeof api.getResetState === "function" ? api.getResetState(date) : null;
      const revision = Number(state?.revision);
      return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
    } catch (error) {
      console.warn(`[${INSTALL_MARKER}] reset revision read failed`, error);
      return 0;
    }
  }

  function applyTemporaryBlankMask(date, revision) {
    const item = {
      targetDate: date,
      active: true,
      resetAt: new Date().toISOString(),
      resetById: "",
      resetByName: "",
      restoredAt: "",
      revision
    };
    try { window.morningMeetingQuerySources?.applyResetState?.(item); } catch (_) {}
    try { window.applyMorningMeetingSelectedDateResetState?.(item); } catch (_) {}
    rerender();
  }

  async function refreshResetState(date) {
    try {
      await window.morningMeetingQuerySources?.loadResetStatus?.(date, { force: true });
    } catch (_) {}
    rerender();
    normalizeButtons();
  }

  async function deleteSelectedDate() {
    if (busy) return;
    const date = selectedDate();
    if (!date) {
      notify("초기화할 오전회의 날짜를 확인하지 못했습니다.", "error");
      return;
    }
    if (!confirmDelete(date)) return;

    busy = true;
    normalizeButtons();
    try {
      const expectedRevision = await getResetRevision(date);
      applyTemporaryBlankMask(date, expectedRevision);
      notify(`${date} 저장된 오전회의 조회자료 삭제 중…`);

      const response = await fetch(API_URL, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({
          targetDate: date,
          expectedRevision,
          confirmPermanentDelete: true,
          mode: "selected_date_reset_delete_v2"
        })
      });
      const data = await parseResponse(response);

      clearBrowserDateCaches(date);
      await refreshResetState(date);

      document.dispatchEvent(new CustomEvent("morningMeetingPermanentPurgeCompleted", {
        detail: {
          targetDate: date,
          deletedRows: Number(data.deletedRows || 0),
          deletedByType: data.deletedByType || {},
          source: "reset_button_v2"
        }
      }));

      notify(
        `${date} 오전회의 저장자료 ${Number(data.deletedRows || 0)}건을 삭제했습니다. 이제 [전체자료] 또는 [엑셀 조회하기]로 새로 조회할 수 있습니다.`
      );
    } catch (error) {
      await refreshResetState(date);
      const activeTypes = Array.isArray(error?.details?.activeRequestTypes)
        ? error.details.activeRequestTypes.join(", ")
        : "";
      notify(
        activeTypes
          ? `${error.message} (${activeTypes})`
          : (error?.message || "초기화 중 오류가 발생했습니다."),
        "error"
      );
    } finally {
      busy = false;
      normalizeButtons();
    }
  }

  function onClickCapture(event) {
    const target = event.target?.closest?.("button");
    if (!isMorningMeetingResetButton(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void deleteSelectedDate();
  }

  function start() {
    watchButtons();
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("morningMeetingResetStateChanged", scheduleNormalizeButtons);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
