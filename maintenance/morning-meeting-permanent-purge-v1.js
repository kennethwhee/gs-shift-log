(() => {
  "use strict";

  const INSTALL_MARKER = "MORNING_MEETING_PERMANENT_PURGE_V1";
  const API_URL = "/api/morning-meeting-purge";
  const CACHE_KEYS = [
    "gsShiftLog.morningMeetingAutoDataCache.v1"
  ];

  if (window.__morningMeetingPermanentPurgeV1Installed === true) {
    return;
  }
  window.__morningMeetingPermanentPurgeV1Installed = true;

  let purgeButton = null;
  let busy = false;
  let observedResetButton = null;
  const purgedDates = new Set();

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
    const panel = document.getElementById("efficiencyMorningMeetingWaterPanel");
    const candidates = [
      panel?.dataset?.morningMeetingAutoBaseDate,
      panel?.dataset?.waterTargetDate,
      panel?.dataset?.oisTargetDate,
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

  function buttonLabel(button) {
    return text(button?.textContent).replace(/\s+/g, " ");
  }

  function findResetButton() {
    const roots = [
      document.getElementById("efficiencyMorningMeetingAutoPreview"),
      document.getElementById("efficiencyMorningMeetingView"),
      document
    ].filter(Boolean);
    for (const root of roots) {
      const buttons = root.querySelectorAll?.("button") || [];
      for (const button of buttons) {
        const label = buttonLabel(button);
        if (label === "초기화" || label === "초기화 취소") {
          return button;
        }
      }
    }
    return null;
  }

  function isResetActive() {
    return buttonLabel(findResetButton()) === "초기화 취소";
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
      window.showToast(message);
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
        throw new Error("완전삭제 서버 응답 형식이 올바르지 않습니다.");
      }
    }
    if (!response.ok || data.ok === false) {
      const error = new Error(
        data.message || data.error || `완전삭제 요청에 실패했습니다. (HTTP ${response.status})`
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
        "siloLevel",
        "limestoneValues",
        "limestone",
        "organicSilo"
      ]) {
        const item = state[key];
        if (!item || typeof item !== "object") continue;
        const itemDate = validDate(item.targetDate) || validDate(item.sourceDate);
        if (!itemDate || itemDate === date) {
          delete state[key];
        }
      }
    }
  }

  function confirmPermanentDelete(date) {
    const message = [
      `${date} 오전회의 서버 저장 조회값을 완전히 삭제합니다.`,
      "",
      "삭제 대상:",
      "수처리 · 석회석 · Turbine · Silo Level · 일일DATA Excel · 유기성 Silo",
      "",
      "삭제한 값은 [초기화 취소]로 복원할 수 없습니다.",
      "이 작업은 다른 PC에서 완전히 새 조회를 시험하기 위한 기능입니다.",
      "",
      "계속하시겠습니까?"
    ].join("\n");
    return window.confirm ? window.confirm(message) : false;
  }

  async function purgeSelectedDate() {
    if (busy) return;
    const date = selectedDate();
    if (!date) {
      notify("완전삭제할 오전회의 날짜를 확인하지 못했습니다.", "error");
      return;
    }
    if (!isResetActive()) {
      notify("먼저 [초기화]를 눌러 선택일을 비운 뒤 완전삭제해 주세요.", "error");
      return;
    }
    if (!confirmPermanentDelete(date)) return;

    busy = true;
    updateButton();
    try {
      notify(`${date} 서버 저장 조회값 완전삭제 중…`);
      const response = await fetch(API_URL, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({
          targetDate: date,
          confirmPermanentDelete: true,
          mode: "selected_date_morning_meeting"
        })
      });
      const data = await parseResponse(response);
      clearBrowserDateCaches(date);
      purgedDates.add(date);

      document.dispatchEvent(new CustomEvent("morningMeetingPermanentPurgeCompleted", {
        detail: {
          targetDate: date,
          deletedRows: Number(data.deletedRows || 0),
          deletedByType: data.deletedByType || {}
        }
      }));

      if (typeof window.renderEfficiencyMorningMeetingAutoPreview === "function") {
        window.renderEfficiencyMorningMeetingAutoPreview();
      }
      notify(
        `${date} 서버 저장 조회값 ${Number(data.deletedRows || 0)}건을 완전 삭제했습니다. 이제 다른 PC에서 새로 조회하세요.`
      );
    } catch (error) {
      const activeTypes = Array.isArray(error?.details?.activeRequestTypes)
        ? error.details.activeRequestTypes.join(", ")
        : "";
      notify(
        activeTypes
          ? `${error.message} (${activeTypes})`
          : (error?.message || "완전삭제 중 오류가 발생했습니다."),
        "error"
      );
    } finally {
      busy = false;
      updateButton();
    }
  }

  function ensureButton() {
    const resetButton = findResetButton();
    if (!resetButton) return null;
    if (purgeButton && purgeButton.isConnected) return purgeButton;

    purgeButton = document.createElement("button");
    purgeButton.type = "button";
    purgeButton.id = "morningMeetingPermanentPurgeButton";
    purgeButton.textContent = "완전삭제";
    purgeButton.title = "선택일의 서버 저장 오전회의 조회값을 완전히 삭제";
    purgeButton.hidden = true;
    purgeButton.style.cssText = [
      "margin-left:4px",
      "border:1px solid #dc2626",
      "background:#fff7f7",
      "color:#b91c1c",
      "font-weight:800"
    ].join(";");
    purgeButton.addEventListener("click", () => void purgeSelectedDate());
    resetButton.insertAdjacentElement("afterend", purgeButton);
    return purgeButton;
  }

  function updateButton() {
    const resetButton = findResetButton();
    if (!resetButton) {
      if (purgeButton) purgeButton.hidden = true;
      return;
    }
    const button = ensureButton();
    if (!button) return;
    const date = selectedDate();
    const active = buttonLabel(resetButton) === "초기화 취소";
    button.hidden = !active;
    button.disabled = busy || !active || !date || purgedDates.has(date);
    button.textContent = purgedDates.has(date) ? "삭제완료" : (busy ? "삭제 중…" : "완전삭제");

    if (observedResetButton !== resetButton) {
      observedResetButton = resetButton;
      const observer = new MutationObserver(updateButton);
      observer.observe(resetButton, { childList: true, subtree: true, characterData: true, attributes: true });
    }
  }

  function start() {
    updateButton();
    const observer = new MutationObserver(updateButton);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("click", event => {
      const target = event.target?.closest?.("button");
      if (!target) return;
      const label = buttonLabel(target);
      if (label === "초기화" || label === "초기화 취소") {
        window.setTimeout(updateButton, 0);
        window.setTimeout(updateButton, 500);
      }
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
