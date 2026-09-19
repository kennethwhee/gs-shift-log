(() => {
  "use strict";

  /* MORNING MEETING BOILER AUTO RESTORE V1
     Restore already-cached BO1/BO2 temperatures when an existing
     Morning Meeting date is reopened and the 12 temperature inputs are blank.

     Safety:
     - Never overwrite any non-empty temperature input.
     - Never force a network re-query.
     - Uses the existing public cache restore function only.
     - No MutationObserver.
  */

  const VIEW_ID = "efficiencyMorningMeetingView";

  const INPUT_IDS = [
    "efficiencyMorningMeetingBoiler1FbheLeft",
    "efficiencyMorningMeetingBoiler1FbheRight",
    "efficiencyMorningMeetingBoiler1WallA",
    "efficiencyMorningMeetingBoiler1WallB",
    "efficiencyMorningMeetingBoiler1WallC",
    "efficiencyMorningMeetingBoiler1WallD",
    "efficiencyMorningMeetingBoiler2FbheLeft",
    "efficiencyMorningMeetingBoiler2FbheRight",
    "efficiencyMorningMeetingBoiler2WallA",
    "efficiencyMorningMeetingBoiler2WallB",
    "efficiencyMorningMeetingBoiler2WallC",
    "efficiencyMorningMeetingBoiler2WallD"
  ];

  let retryGeneration = 0;
  let retryTimer = 0;

  function normalizeDate(value) {
    const text = String(value || "").trim();
    const exact = text.match(/^(\d{4}-\d{2}-\d{2})$/);

    if (exact) return exact[1];

    const embedded = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    return embedded ? embedded[1] : "";
  }

  function getView() {
    return document.getElementById(VIEW_ID);
  }

  function isVisible(element) {
    if (!element || element.hidden) return false;

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;

    return true;
  }

  function getInputs() {
    return INPUT_IDS
      .map((id) => document.getElementById(id))
      .filter(Boolean);
  }

  function allTemperatureInputsBlank() {
    const inputs = getInputs();

    if (inputs.length !== INPUT_IDS.length) {
      return false;
    }

    return inputs.every((input) => String(input.value || "").trim() === "");
  }

  function stateDateCandidates() {
    const state = window.efficiencyMorningMeetingUploadState || {};

    return [
      state.boilerTemperatures?.reportDate,
      state.shiftPart?.reportDate,
      state.shiftPart?.loadedDate,
      document.getElementById("efficiencyMorningMeetingAutoBoilerDate")?.textContent
    ];
  }

  function visibleDateCandidates() {
    const view = getView();
    if (!view) return [];

    const candidates = [];

    for (const element of view.querySelectorAll("small, time, [data-date], [data-report-date]")) {
      if (!isVisible(element)) continue;

      candidates.push(
        element.getAttribute("data-report-date"),
        element.getAttribute("data-date"),
        element.textContent
      );
    }

    candidates.push(view.textContent);
    return candidates;
  }

  function resolveReportDate() {
    const direct = stateDateCandidates()
      .map(normalizeDate)
      .find(Boolean);

    if (direct) return direct;

    const dates = [];

    for (const candidate of visibleDateCandidates()) {
      const text = String(candidate || "");
      const matches = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
      dates.push(...matches);
    }

    if (!dates.length) return "";

    const counts = new Map();

    for (const date of dates) {
      counts.set(date, (counts.get(date) || 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }

  function renderExistingState() {
    if (
      typeof window.renderEfficiencyMorningMeetingBoilerTemperatures === "function"
    ) {
      window.renderEfficiencyMorningMeetingBoilerTemperatures();
    }
  }

  function tryRestore() {
    const view = getView();

    if (!view || !isVisible(view)) {
      return false;
    }

    if (!allTemperatureInputsBlank()) {
      return true;
    }

    const reportDate = resolveReportDate();

    if (!reportDate) {
      return false;
    }

    const state = window.efficiencyMorningMeetingUploadState || {};
    const memoryDate = normalizeDate(state.boilerTemperatures?.reportDate);

    if (memoryDate === reportDate) {
      renderExistingState();

      if (!allTemperatureInputsBlank()) {
        return true;
      }
    }

    const restore = window.restoreEfficiencyMorningMeetingBoilerCache;

    if (typeof restore !== "function") {
      return false;
    }

    const restored = restore(reportDate);

    if (restored === true) {
      renderExistingState();
      return true;
    }

    return false;
  }

  function startBoundedRestore() {
    retryGeneration += 1;
    const generation = retryGeneration;
    const startedAt = Date.now();

    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = 0;
    }

    const tick = () => {
      if (generation !== retryGeneration) return;

      const view = getView();

      if (!view || !isVisible(view)) {
        if (Date.now() - startedAt < 12000) {
          retryTimer = window.setTimeout(tick, 250);
        }
        return;
      }

      if (!allTemperatureInputsBlank()) {
        retryTimer = 0;
        return;
      }

      if (tryRestore()) {
        retryTimer = 0;
        return;
      }

      if (Date.now() - startedAt >= 12000) {
        retryTimer = 0;
        return;
      }

      retryTimer = window.setTimeout(tick, 250);
    };

    tick();
  }

  function scheduleRestore() {
    for (const delay of [0, 80, 220, 500, 1000]) {
      window.setTimeout(startBoundedRestore, delay);
    }
  }

  function onDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const text = String(target.closest("button, a, [role='button']")?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    if (
      text.includes("오전회의") ||
      text.includes("오늘") ||
      text.includes("전날") ||
      text.includes("다음날") ||
      text.includes("자료 분석") ||
      text.includes("재조회")
    ) {
      scheduleRestore();
      return;
    }

    const view = getView();
    if (view && view.contains(target)) {
      window.setTimeout(tryRestore, 120);
    }
  }

  function onTemperatureLoaded() {
    window.setTimeout(renderExistingState, 0);
    window.setTimeout(renderExistingState, 120);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRestore, { once: true });
  } else {
    scheduleRestore();
  }

  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener(
    "efficiencyMorningMeetingShiftLogsLoaded",
    onTemperatureLoaded
  );

  window.addEventListener("focus", scheduleRestore);

  // No MutationObserver: bounded retries only.
})();
