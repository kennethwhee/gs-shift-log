(function installMorningMeetingBoilerD1Snapshot(root) {
  "use strict";

  const VERSION = "20261003-v3";
  const API_URL = "/api/morning-meeting-boiler-snapshot";
  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const STORAGE_KEY = "gsShiftLog.morningMeetingAutoDataCache.v1";
  const SAVE_DELAY_MS = 240;

  if (!root || !root.document) return;
  if (root.morningMeetingBoilerD1Snapshot?.version === VERSION) return;

  const doc = root.document;
  let panel = null;
  let activeDate = "";
  let loadingDate = "";
  let saveTimer = null;
  let saveGeneration = 0;
  let lastSavedSignature = new Map();
  let initialized = false;

  const text = value => String(value ?? "").trim();
  const dateValid = value => {
    const date = text(value);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(date + "T00:00:00.000Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  const numberOrNull = value => {
    if (value === null || value === undefined || text(value) === "") return null;
    const number = Number(String(value).replaceAll(",", "").replace(/℃|°C/gi, "").trim());
    return Number.isFinite(number) ? number : null;
  };

  function state() {
    if (!root.efficiencyMorningMeetingUploadState || typeof root.efficiencyMorningMeetingUploadState !== "object") {
      root.efficiencyMorningMeetingUploadState = {files: {}, analysis: {}};
    }
    return root.efficiencyMorningMeetingUploadState;
  }

  function targetDate() {
    let queryDate = "";
    try { queryDate = root.morningMeetingQuerySources?.targetDate?.() || ""; } catch {}
    const current = state();
    const choices = [
      queryDate,
      panel?.dataset?.morningMeetingAutoBaseDate,
      doc.getElementById("efficiencyMorningMeetingAutoDatePicker")?.value,
      doc.getElementById("efficiencyMorningMeetingWorkDatePicker")?.value,
      current.shiftPart?.reportDate,
      current.shiftPart?.loadedDate
    ];
    return choices.map(text).find(dateValid) || "";
  }

  function resetActive(date) {
    if (!dateValid(date)) return false;
    try {
      if (root.isMorningMeetingSelectedDateResetActive?.(date) === true) return true;
    } catch {}
    try {
      if (root.morningMeetingQuerySources?.resetState?.(date)?.active === true) return true;
    } catch {}
    return false;
  }

  function authHeaders(extra = {}) {
    if (typeof root.getShiftLogAuthHeaders === "function") return root.getShiftLogAuthHeaders(extra);
    let token = "";
    for (const key of ["gsShiftLog.currentUser", "gsShiftLog.auth", "shiftLogUser"]) {
      try {
        const raw = root.localStorage?.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        token = text(parsed?.sessionToken || parsed?.session_token || parsed?.token);
        if (token) break;
      } catch {}
    }
    return {Accept: "application/json", ...extra, ...(token ? {Authorization: `Bearer ${token}`} : {})};
  }

  async function jsonResponse(response) {
    const raw = await response.text();
    let data = {};
    if (raw.trim()) {
      try { data = JSON.parse(raw); }
      catch { throw new Error("BO1·BO2 온도 저장 서버 응답을 읽지 못했습니다."); }
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || data.error || `BO1·BO2 온도 저장 요청 실패 (HTTP ${response.status})`);
    }
    return data;
  }

  function sanitizedUnit(unit, role, label) {
    const source = unit && typeof unit === "object" ? unit : {};
    return {
      role,
      label,
      fbheLeft: numberOrNull(source.fbheLeft),
      fbheRight: numberOrNull(source.fbheRight),
      wallScrew: {
        A: numberOrNull(source.wallScrew?.A),
        B: numberOrNull(source.wallScrew?.B),
        C: numberOrNull(source.wallScrew?.C),
        D: numberOrNull(source.wallScrew?.D)
      }
    };
  }

  function temperatureArray(snapshot) {
    return [
      snapshot?.unitOne?.fbheLeft,
      snapshot?.unitOne?.fbheRight,
      snapshot?.unitOne?.wallScrew?.A,
      snapshot?.unitOne?.wallScrew?.B,
      snapshot?.unitOne?.wallScrew?.C,
      snapshot?.unitOne?.wallScrew?.D,
      snapshot?.unitTwo?.fbheLeft,
      snapshot?.unitTwo?.fbheRight,
      snapshot?.unitTwo?.wallScrew?.A,
      snapshot?.unitTwo?.wallScrew?.B,
      snapshot?.unitTwo?.wallScrew?.C,
      snapshot?.unitTwo?.wallScrew?.D
    ];
  }

  function snapshotBelongsToDate(source, date) {
    if (!source || typeof source !== "object" || !dateValid(date)) return false;
    const explicit = text(source.snapshotTargetDate);
    if (dateValid(explicit)) return explicit === date;
    const current = state();
    const shiftDate = text(current.shiftPart?.reportDate || current.shiftPart?.loadedDate);
    if (dateValid(shiftDate)) return shiftDate === date;
    const reportDate = text(source.reportDate);
    return dateValid(reportDate) && reportDate === date;
  }

  function snapshotFromState(date = targetDate()) {
    if (!dateValid(date) || resetActive(date)) return null;
    const source = state().boilerTemperatures;
    if (!source || typeof source !== "object" || !snapshotBelongsToDate(source, date)) return null;
    const snapshot = {
      snapshotTargetDate: date,
      reportDate: dateValid(text(source.reportDate)) ? text(source.reportDate) : date,
      sourceShift: text(source.sourceShift) || "NS",
      unitOne: sanitizedUnit(source.unitOne, "BO1", "1호기"),
      unitTwo: sanitizedUnit(source.unitTwo, "BO2", "2호기"),
      missing: [],
      complete: true,
      userEdited: source.userEdited === true,
      lastEditedAt: text(source.lastEditedAt),
      savedToD1At: new Date().toISOString()
    };
    if (!temperatureArray(snapshot).every(value => typeof value === "number" && Number.isFinite(value))) return null;
    return snapshot;
  }

  function signature(snapshot) {
    if (!snapshot) return "";
    return JSON.stringify({
      targetDate: snapshot.snapshotTargetDate,
      reportDate: snapshot.reportDate,
      sourceShift: snapshot.sourceShift,
      unitOne: snapshot.unitOne,
      unitTwo: snapshot.unitTwo,
      userEdited: snapshot.userEdited,
      lastEditedAt: snapshot.lastEditedAt
    });
  }

  function loadLocalCache() {
    try {
      const raw = root.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return {water: {}, gearPinion: {}, boiler: {}};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function saveLocalCache(cache) {
    try {
      root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cache));
      return true;
    } catch { return false; }
  }

  function mirrorLocal(date, snapshot) {
    if (!snapshot || !dateValid(date)) return false;
    const cache = loadLocalCache();
    if (!cache.boiler || typeof cache.boiler !== "object" || Array.isArray(cache.boiler)) cache.boiler = {};
    const stored = JSON.parse(JSON.stringify(snapshot));
    delete stored.snapshotTargetDate;
    cache.boiler[date] = stored;
    if (dateValid(snapshot.reportDate)) cache.boiler[snapshot.reportDate] = stored;
    return saveLocalCache(cache);
  }

  function clearLocal(date) {
    const cache = loadLocalCache();
    if (!cache.boiler || typeof cache.boiler !== "object") return false;
    const currentReportDate = text(state().boilerTemperatures?.reportDate);
    delete cache.boiler[date];
    if (dateValid(currentReportDate)) delete cache.boiler[currentReportDate];
    saveLocalCache(cache);
    return true;
  }

  function renderRestored() {
    try { root.renderEfficiencyMorningMeetingBoilerTemperatures?.(); } catch {}
    try { root.renderEfficiencyMorningMeetingAutoPreview?.(); } catch {}
    try { root.updateEfficiencyMorningMeetingCreateButton?.(); } catch {}
  }

  async function load(date = targetDate(), options = {}) {
    const requestedDate = text(date);
    if (!dateValid(requestedDate) || resetActive(requestedDate)) return false;
    if (loadingDate === requestedDate && options.force !== true) return false;

    const current = snapshotFromState(requestedDate);
    if (current && options.force !== true) {
      lastSavedSignature.set(requestedDate, signature(current));
      mirrorLocal(requestedDate, current);
      return true;
    }

    loadingDate = requestedDate;
    try {
      const response = await root.fetch(`${API_URL}?date=${encodeURIComponent(requestedDate)}`, {
        method: "GET",
        headers: authHeaders({Accept: "application/json"}),
        cache: "no-store"
      });
      const data = await jsonResponse(response);
      if (targetDate() !== requestedDate || resetActive(requestedDate)) return false;
      const item = data?.item;
      if (!item?.values || typeof item.values !== "object") return false;
      const values = item.values;
      if (!temperatureArray(values).every(value => typeof value === "number" && Number.isFinite(value))) return false;

      const restored = JSON.parse(JSON.stringify(values));
      restored.snapshotTargetDate = requestedDate;
      restored.complete = true;
      restored.missing = [];
      restored.restoredFromD1 = true;
      state().boilerTemperatures = restored;
      lastSavedSignature.set(requestedDate, signature(restored));
      mirrorLocal(requestedDate, restored);
      renderRestored();
      console.log(`[Morning Meeting] BO1·BO2 온도 ${requestedDate} D1 Snapshot 복원`);
      return true;
    } catch (error) {
      console.warn("[Morning Meeting] BO1·BO2 온도 D1 Snapshot 복원 실패:", error);
      return false;
    } finally {
      if (loadingDate === requestedDate) loadingDate = "";
    }
  }

  async function save(date = targetDate()) {
    const requestedDate = text(date);
    const snapshot = snapshotFromState(requestedDate);
    if (!snapshot) return false;
    const nextSignature = signature(snapshot);
    if (nextSignature && lastSavedSignature.get(requestedDate) === nextSignature) return true;
    try {
      const response = await root.fetch(API_URL, {
        method: "POST",
        headers: authHeaders({"Content-Type": "application/json", Accept: "application/json"}),
        cache: "no-store",
        body: JSON.stringify({targetDate: requestedDate, values: snapshot})
      });
      const data = await jsonResponse(response);
      if (data?.item?.values && typeof data.item.values === "object") {
        lastSavedSignature.set(requestedDate, nextSignature);
        mirrorLocal(requestedDate, snapshot);
      }
      console.log(`[Morning Meeting] BO1·BO2 온도 ${requestedDate} D1 Snapshot 저장 완료`);
      return true;
    } catch (error) {
      console.warn("[Morning Meeting] BO1·BO2 온도 D1 Snapshot 저장 실패:", error);
      return false;
    }
  }

  function scheduleSave(delay = SAVE_DELAY_MS) {
    const generation = ++saveGeneration;
    root.clearTimeout(saveTimer);
    saveTimer = root.setTimeout(() => {
      if (generation !== saveGeneration) return;
      void save(targetDate());
    }, delay);
  }

  function clearCurrent(date) {
    const selected = text(date);
    if (!dateValid(selected)) return;
    clearLocal(selected);
    lastSavedSignature.delete(selected);
    if (targetDate() === selected) {
      delete state().boilerTemperatures;
      renderRestored();
    }
  }

  function handleReset(event) {
    const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
    const date = text(detail.targetDate || detail.recordDate);
    if (!dateValid(date)) return;
    if (detail.active === true) clearCurrent(date);
  }

  function handleDateChange() {
    const date = targetDate();
    if (!dateValid(date)) return;
    if (date === activeDate) return;
    activeDate = date;
    void load(date);
  }

  function bind() {
    panel = doc.getElementById(PANEL_ID);
    if (!panel) return false;

    new MutationObserver(handleDateChange).observe(panel, {
      attributes: true,
      attributeFilter: ["data-morning-meeting-auto-base-date"]
    });

    doc.addEventListener("efficiencyMorningMeetingShiftLogsLoaded", () => {
      scheduleSave(180);
      root.setTimeout(() => scheduleSave(0), 650);
    });
    doc.addEventListener("efficiencyMorningMeetingBoilerTemperaturesChanged", () => scheduleSave(420));
    doc.addEventListener("morningMeetingSelectedDateResetStateChanged", handleReset);
    doc.addEventListener("morningMeetingResetStateChanged", handleReset);

    const analyzeButton = doc.getElementById("analyzeEfficiencyMorningMeetingButton");
    analyzeButton?.addEventListener("click", () => {
      root.setTimeout(() => scheduleSave(0), 1200);
      root.setTimeout(() => scheduleSave(0), 4000);
    });

    root.addEventListener("beforeunload", () => {
      const snapshot = snapshotFromState(targetDate());
      if (snapshot) mirrorLocal(targetDate(), snapshot);
    });
    doc.addEventListener("visibilitychange", () => {
      if (doc.hidden) scheduleSave(0);
      else void load(targetDate());
    });

    return true;
  }

  function initialize() {
    if (initialized) return;
    if (!bind()) {
      root.setTimeout(initialize, 100);
      return;
    }
    initialized = true;
    activeDate = targetDate();
    if (dateValid(activeDate)) void load(activeDate);
    root.setTimeout(() => {
      const date = targetDate();
      if (dateValid(date)) {
        activeDate = date;
        void load(date);
      }
    }, 450);
  }

  root.morningMeetingBoilerD1Snapshot = Object.freeze({
    version: VERSION,
    targetDate,
    load: date => load(date || targetDate(), {force: true}),
    save: date => save(date || targetDate()),
    clearCurrent,
    state: () => ({activeDate, loadingDate, targetDate: targetDate()})
  });

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", initialize, {once: true});
  else initialize();
})(typeof window === "object" ? window : null);
