(() => {
  "use strict";

  if (window.__morningMeetingNoExcelQueryV1Installed === true) return;
  window.__morningMeetingNoExcelQueryV1Installed = true;

  const WORKBOOK_BUTTON_ID = "morningMeetingWorkbookQueryButton";
  const WORKBOOK_STATUS_ID = "morningMeetingQuerySourceStatus-workbook";
  const ALL_BUTTON_ID = "morningMeetingAllQueryButton";
  const CAPTION_ID = "morningMeetingWorkbookSource";
  const CAPTION_TEXT = "운영정보 · 혼소율 · TO 전력 · OIS · 마감자료";

  const byId = id => document.getElementById(id);

  function applyUi() {
    const workbookButton = byId(WORKBOOK_BUTTON_ID);
    if (workbookButton) workbookButton.remove();

    const workbookStatus = byId(WORKBOOK_STATUS_ID);
    const statusGroup = workbookStatus?.closest?.(".morning-meeting-workbook-query__source-status");
    if (statusGroup) {
      statusGroup.hidden = true;
      statusGroup.setAttribute("aria-hidden", "true");
    }

    const caption = byId(CAPTION_ID);
    if (caption && caption.textContent !== CAPTION_TEXT) caption.textContent = CAPTION_TEXT;
  }

  function installApiGuard() {
    const current = window.morningMeetingQuerySources;
    if (!current || current.__noExcelQueryV1 === true || typeof current.query !== "function") return;

    const guarded = {
      ...current,
      __noExcelQueryV1: true,
      query(source, options = {}) {
        if (source === "workbook") return Promise.resolve(null);
        return current.query(source === "all" ? "operations" : source, options);
      }
    };

    window.morningMeetingQuerySources = Object.freeze(guarded);
  }

  document.addEventListener(
    "click",
    event => {
      const target = event.target?.closest?.("button");
      if (!target) return;

      if (target.id === WORKBOOK_BUTTON_ID) {
        event.preventDefault();
        event.stopImmediatePropagation();
        applyUi();
        return;
      }

      if (target.id !== ALL_BUTTON_ID) return;

      const api = window.morningMeetingQuerySources;
      if (!api || typeof api.query !== "function") return;

      event.preventDefault();
      event.stopImmediatePropagation();
      void api.query("operations", { userInitiated: true });
    },
    true
  );

  document.addEventListener("morningMeetingQueryModeStateChanged", () => {
    installApiGuard();
    applyUi();
  });

  const observer = new MutationObserver(() => {
    installApiGuard();
    applyUi();
  });

  function initialize() {
    installApiGuard();
    applyUi();
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
