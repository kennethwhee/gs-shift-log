/*
 * MORNING_MEETING_INSTANT_RESTORE_V1
 *
 * Display-only stale-while-revalidate snapshot for Morning Meeting cards.
 *
 * Goals:
 * - When a date was already rendered successfully in this browser, restore the
 *   visible saved values before the next paint instead of briefly showing '-'
 *   or '조회 대기'.
 * - Keep server/DB/current-source providers authoritative. This module never
 *   fetches, recalculates, writes business data, or starts an OIS/Excel query.
 * - On a cold browser snapshot, mask the false empty-card state briefly while
 *   the existing saved-value providers hydrate from the server.
 * - Invalidate only the selected date snapshot when the existing data-delete
 *   reset marker becomes active.
 */
(function installMorningMeetingInstantRestore(root) {
  "use strict";

  const VERSION = "20261009-power-date-sync-v1";
  const STORAGE_KEY = "gsShiftLog.morningMeetingDisplaySnapshot.v1";
  const PREVIEW_ID = "efficiencyMorningMeetingAutoPreview";
  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const COLD_CLASS = "is-mm-instant-restore-cold";
  const COLD_TIMEOUT_MS = 2500;
  const GUARD_MS = 3500;
  const SAVE_DELAY_MS = 320;
  const MAX_DATES = 45;
  const MIN_COLD_READY_VALUES = 18;
  const MIN_NEW_SNAPSHOT_VALUES = 18;
  // TO provider and strict D1 fallback own power by source date. Do not replay
  // old generic display copies that may have been captured after relabelling.
  const POWER_IDS = new Set([
    "efficiencyMorningMeetingAutoDailyPowerDate",
    "efficiencyMorningMeetingAutoDailyPowerStatus",
    "efficiencyMorningMeetingAutoDailyGeneratorEcmsGen1",
    "efficiencyMorningMeetingAutoDailyIsmartReception",
    "efficiencyMorningMeetingAutoDailyEpowerTransmission",
    "efficiencyMorningMeetingAutoDailySolarGeneration",
    "efficiencyMorningMeetingAutoSolarMonthlyCumulative",
    "efficiencyMorningMeetingAutoSolarYearlyCumulative"
  ]);
  const STATE_CLASSES = Object.freeze([
    "is-loading",
    "is-complete",
    "is-error",
    "is-failed",
    "is-idle",
    "is-success"
  ]);

  if (!root || !root.document) return;
  if (root.morningMeetingInstantRestore?.version === VERSION) return;

  const doc = root.document;
  let preview = null;
  let panel = null;
  let previewObserver = null;
  let panelObserver = null;
  let activeDate = "";
  let activeEntry = null;
  let guardUntil = 0;
  let saveTimer = null;
  let coldTimer = null;
  let applying = false;
  let initialized = false;

  const text = value => String(value ?? "").replace(/\s+/g, " ").trim();

  function dateValid(value) {
    const date = text(value);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(date + "T00:00:00.000Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }

  function targetDate() {
    const state = root.efficiencyMorningMeetingUploadState || {};
    let closed = "";
    try { closed = root.morningMeetingClosedCofiring?.targetDate?.() || ""; } catch {}
    const choices = [
      panel?.dataset?.morningMeetingAutoBaseDate,
      closed,
      state.shiftPart?.reportDate,
      state.shiftPart?.loadedDate
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

  function emptyStore() {
    return {version: 1, entries: {}};
  }

  function loadStore() {
    try {
      const raw = root.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore();
      const entries = parsed.entries && typeof parsed.entries === "object" && !Array.isArray(parsed.entries)
        ? parsed.entries
        : {};
      return {version: 1, entries};
    } catch (error) {
      console.warn("[Morning Meeting] display snapshot read failed:", error);
      return emptyStore();
    }
  }

  function saveStore(store) {
    try {
      const entries = Object.entries(store?.entries || {})
        .filter(([date, entry]) => dateValid(date) && entry && typeof entry === "object")
        .sort((left, right) => Number(right[1]?.savedAt || 0) - Number(left[1]?.savedAt || 0))
        .slice(0, MAX_DATES);
      root.localStorage?.setItem(STORAGE_KEY, JSON.stringify({version: 1, entries: Object.fromEntries(entries)}));
      return true;
    } catch (error) {
      console.warn("[Morning Meeting] display snapshot save failed:", error);
      return false;
    }
  }

  function getEntry(date) {
    if (!dateValid(date)) return null;
    const entry = loadStore().entries[date];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    if (entry.date !== date || !entry.elements || typeof entry.elements !== "object") return null;
    return entry;
  }

  function invalidate(date) {
    if (!dateValid(date)) return false;
    const store = loadStore();
    const existed = Object.hasOwn(store.entries, date);
    if (existed) {
      delete store.entries[date];
      saveStore(store);
    }
    if (activeDate === date) {
      activeEntry = null;
      guardUntil = 0;
      releaseCold();
    }
    return existed;
  }

  function isEligibleElement(element) {
    if (!(element instanceof root.HTMLElement)) return false;
    if (POWER_IDS.has(element.id)) return false;
    if (!element.id || !preview?.contains(element)) return false;
    if (["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A", "SCRIPT", "STYLE", "SVG", "PATH"].includes(element.tagName)) {
      return false;
    }
    return element.childElementCount === 0;
  }

  function placeholderQuality(value) {
    const valueText = text(value);
    if (!valueText) return 0;
    if (/^(?:-|—|–|·|\/|%|℃|t|ton|kWh|원)+$/i.test(valueText.replace(/\s+/g, ""))) return 0;
    if (/^(?:-|—|–)\s*(?:\/|→)\s*(?:-|—|–)(?:\s*%|\s*t|\s*ton|\s*kWh)?$/i.test(valueText)) return 0;
    if (/^(?:-|—|–)\s*\/\s*(?:-|—|–)%$/i.test(valueText)) return 0;
    if (/조회\s*대기|불러오는\s*중|확인\s*중|준비\s*중/.test(valueText)) return 1;
    if (/조회\s*중|조회중|처리\s*중|재조회\s*중|새로\s*조회\s*중/.test(valueText)) return 1;
    return 2;
  }

  function stateClasses(element) {
    return STATE_CLASSES.filter(name => element.classList.contains(name));
  }

  function captureElement(element) {
    if (!isEligibleElement(element)) return null;
    const value = text(element.textContent);
    if (placeholderQuality(value) < 2) return null;
    return {
      text: value,
      stateClasses: stateClasses(element),
      title: text(element.getAttribute("title"))
    };
  }

  function currentMeaningfulCount() {
    if (!preview) return 0;
    let count = 0;
    for (const element of preview.querySelectorAll("[id]")) {
      if (!isEligibleElement(element)) continue;
      if (placeholderQuality(element.textContent) >= 2) count += 1;
    }
    return count;
  }

  function capture(date = activeDate) {
    if (!preview || !dateValid(date) || resetActive(date)) return false;
    if (targetDate() !== date) return false;

    const store = loadStore();
    const previous = store.entries[date] && typeof store.entries[date] === "object"
      ? store.entries[date]
      : {date, savedAt: 0, elements: {}};
    const elements = Object.fromEntries(Object.entries(previous.elements || {}).filter(([id]) => !POWER_IDS.has(id)));
    let changed = Object.keys(elements).length !== Object.keys(previous.elements || {}).length;

    for (const element of preview.querySelectorAll("[id]")) {
      const item = captureElement(element);
      if (!item) continue;
      const old = elements[element.id];
      if (!old || old.text !== item.text || JSON.stringify(old.stateClasses || []) !== JSON.stringify(item.stateClasses || []) || old.title !== item.title) {
        elements[element.id] = item;
        changed = true;
      }
    }

    const richness = Object.keys(elements).length;
    const hadPrevious = Boolean(previous.savedAt);
    if (richness < 4 || (!hadPrevious && richness < MIN_NEW_SNAPSHOT_VALUES)) return false;

    const next = {
      date,
      savedAt: Date.now(),
      richness,
      elements
    };

    if (changed || !previous.savedAt || previous.richness !== richness) {
      store.entries[date] = next;
      saveStore(store);
    }

    activeEntry = next;
    maybeReleaseCold();
    return true;
  }

  function applySavedElement(element, saved, force = false) {
    if (!isEligibleElement(element) || !saved || placeholderQuality(saved.text) < 2) return false;
    const currentQuality = placeholderQuality(element.textContent);
    if (!force && currentQuality >= 2) return false;

    let changed = false;
    if (text(element.textContent) !== saved.text) {
      element.textContent = saved.text;
      changed = true;
    }

    if (Array.isArray(saved.stateClasses)) {
      for (const className of STATE_CLASSES) {
        const wanted = saved.stateClasses.includes(className);
        if (element.classList.contains(className) !== wanted) {
          element.classList.toggle(className, wanted);
          changed = true;
        }
      }
    }

    if (saved.title && !text(element.getAttribute("title"))) {
      element.setAttribute("title", saved.title);
      changed = true;
    }

    return changed;
  }

  function restore(date = activeDate, options = {}) {
    if (!preview || !dateValid(date) || resetActive(date)) return false;
    const entry = getEntry(date);
    if (!entry) return false;

    applying = true;
    let applied = 0;
    try {
      for (const [id, saved] of Object.entries(entry.elements || {})) {
        const element = doc.getElementById(id);
        if (!element || !preview.contains(element)) continue;
        if (applySavedElement(element, saved, options.force === true)) applied += 1;
      }
    } finally {
      applying = false;
    }

    activeEntry = entry;
    guardUntil = Date.now() + GUARD_MS;
    if (applied > 0) releaseCold();
    return applied > 0;
  }

  function guardRestore() {
    if (!preview || !activeEntry || Date.now() > guardUntil || resetActive(activeDate)) return false;
    let changed = false;
    applying = true;
    try {
      for (const [id, saved] of Object.entries(activeEntry.elements || {})) {
        const element = doc.getElementById(id);
        if (!element || !preview.contains(element)) continue;
        if (applySavedElement(element, saved, false)) changed = true;
      }
    } finally {
      applying = false;
    }
    return changed;
  }

  function installStyle() {
    if (doc.getElementById("morningMeetingInstantRestoreStyle")) return;
    const style = doc.createElement("style");
    style.id = "morningMeetingInstantRestoreStyle";
    style.textContent = `
#${PREVIEW_ID}.${COLD_CLASS} { position: relative; }
#${PREVIEW_ID}.${COLD_CLASS} > .efficiency-morning-meeting-auto-preview__grid { visibility: hidden !important; }
#${PREVIEW_ID}.${COLD_CLASS}::after {
  content: "저장된 값을 불러오는 중…";
  position: absolute;
  z-index: 30;
  left: 0;
  right: 0;
  top: 76px;
  bottom: 0;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.96);
  color: #58708f;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
  pointer-events: none;
}
`;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function startCold() {
    if (!preview || activeEntry || !dateValid(activeDate) || resetActive(activeDate)) return;
    installStyle();
    preview.classList.add(COLD_CLASS);
    root.clearTimeout(coldTimer);
    coldTimer = root.setTimeout(() => releaseCold(), COLD_TIMEOUT_MS);
  }

  function releaseCold() {
    root.clearTimeout(coldTimer);
    coldTimer = null;
    preview?.classList.remove(COLD_CLASS);
  }

  function maybeReleaseCold() {
    if (!preview?.classList.contains(COLD_CLASS)) return;
    if (activeEntry || currentMeaningfulCount() >= MIN_COLD_READY_VALUES) releaseCold();
  }

  function scheduleCapture(delay = SAVE_DELAY_MS) {
    root.clearTimeout(saveTimer);
    saveTimer = root.setTimeout(() => {
      saveTimer = null;
      capture(activeDate);
    }, delay);
  }

  function activate(date = targetDate()) {
    const nextDate = text(date);
    if (!dateValid(nextDate)) return false;
    if (nextDate === activeDate && activeEntry) {
      guardRestore();
      return true;
    }

    activeDate = nextDate;
    activeEntry = null;
    guardUntil = 0;
    releaseCold();

    if (resetActive(nextDate)) {
      invalidate(nextDate);
      return false;
    }

    const entry = getEntry(nextDate);
    if (entry) {
      activeEntry = entry;
      restore(nextDate);
    } else {
      startCold();
    }
    scheduleCapture(500);
    return Boolean(entry);
  }

  function handlePreviewMutations() {
    if (applying) return;
    const date = targetDate();
    if (dateValid(date) && date !== activeDate) activate(date);
    if (activeEntry && Date.now() <= guardUntil) guardRestore();
    maybeReleaseCold();
    scheduleCapture();
  }

  function handleReset(event) {
    const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
    const date = text(detail.targetDate || detail.recordDate);
    if (!dateValid(date)) return;
    if (detail.active === true) {
      invalidate(date);
      if (date === activeDate) releaseCold();
      return;
    }
    if (date === targetDate() && date !== activeDate) activate(date);
  }

  function onSourceSignal() {
    const date = targetDate();
    if (dateValid(date) && date !== activeDate) activate(date);
    maybeReleaseCold();
    scheduleCapture(120);
  }

  function bind() {
    preview = doc.getElementById(PREVIEW_ID);
    panel = doc.getElementById(PANEL_ID);
    if (!preview || !panel) return false;

    previewObserver = new MutationObserver(handlePreviewMutations);
    previewObserver.observe(preview, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "title"]
    });

    panelObserver = new MutationObserver(() => {
      const date = targetDate();
      if (dateValid(date)) activate(date);
    });
    panelObserver.observe(panel, {
      attributes: true,
      attributeFilter: ["data-morning-meeting-auto-base-date"]
    });

    for (const eventName of [
      "efficiencyMorningMeetingWaterLoaded",
      "efficiencyMorningMeetingGearPinionLoaded",
      "efficiencyMorningMeetingSiloLevelLoaded",
      "efficiencyMorningMeetingSteamStatusLoaded",
      "morningMeetingSteamOisProbeLoaded",
      "morningMeetingClosedCofiringChanged",
      "morningMeetingLegacySavedDailyDataChanged",
      "morningMeetingQueryModeStateChanged"
    ]) {
      doc.addEventListener(eventName, onSourceSignal);
    }

    doc.addEventListener("morningMeetingSelectedDateResetStateChanged", handleReset);
    doc.addEventListener("morningMeetingResetStateChanged", handleReset);

    root.addEventListener("beforeunload", () => capture(activeDate));
    doc.addEventListener("visibilitychange", () => {
      if (doc.hidden) capture(activeDate);
      else activate(targetDate());
    });

    return true;
  }

  function initialize() {
    if (initialized) return;
    if (!bind()) {
      root.setTimeout(initialize, 80);
      return;
    }
    initialized = true;
    installStyle();
    activate(targetDate());
    root.setTimeout(() => activate(targetDate()), 0);
    root.setTimeout(() => {
      maybeReleaseCold();
      scheduleCapture(0);
    }, 700);
  }

  root.morningMeetingInstantRestore = Object.freeze({
    version: VERSION,
    storageKey: STORAGE_KEY,
    targetDate,
    restore: date => restore(date || targetDate()),
    capture: date => capture(date || targetDate()),
    invalidate,
    state: date => {
      const selected = dateValid(text(date)) ? text(date) : targetDate();
      const entry = getEntry(selected);
      return {
        targetDate: selected,
        cached: Boolean(entry),
        richness: Number(entry?.richness || 0),
        savedAt: Number(entry?.savedAt || 0),
        resetActive: resetActive(selected)
      };
    }
  });

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", initialize, {once: true});
  else initialize();
})(typeof window === "object" ? window : null);
