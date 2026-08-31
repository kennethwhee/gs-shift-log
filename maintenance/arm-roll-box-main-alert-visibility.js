(() => {
  "use strict";

  const ALERT_ID = "armRollBoxMainAlert";
  const COUNT_ID = "armRollBoxMainAlertCount";
  const ACTIVE_CLASS = "is-alert-active";

  let observer = null;
  let frame = 0;

  function parseAlertCount(value) {
    const match = String(value == null ? "" : value).match(/\d+/);
    const count = match ? Number(match[0]) : 0;
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  function getAlertCount() {
    const countNode = document.getElementById(COUNT_ID);
    return parseAlertCount(countNode ? countNode.textContent : "");
  }

  function syncAlertVisibility() {
    frame = 0;

    const alertButton = document.getElementById(ALERT_ID);
    if (!alertButton) return;

    const count = getAlertCount();
    const shouldShow = count > 0;

    if (shouldShow) {
      if (alertButton.hidden) alertButton.hidden = false;
      alertButton.style.removeProperty("display");
      alertButton.removeAttribute("aria-hidden");
      alertButton.classList.add(ACTIVE_CLASS);
      return;
    }

    if (!alertButton.hidden) alertButton.hidden = true;
    alertButton.style.setProperty("display", "none", "important");
    alertButton.setAttribute("aria-hidden", "true");
    alertButton.classList.remove(ACTIVE_CLASS);
  }

  function scheduleSync() {
    if (frame) return;
    frame = window.requestAnimationFrame(syncAlertVisibility);
  }

  function start() {
    syncAlertVisibility();

    if (observer) observer.disconnect();

    observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden", "style", "class"]
    });

    window.addEventListener("focus", scheduleSync, { passive: true });
    document.addEventListener("visibilitychange", scheduleSync, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
