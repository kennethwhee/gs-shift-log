(() => {
  "use strict";

  const INSTALL_FLAG = "__mobileBlowerMainAlertV1Installed";

  if (window[INSTALL_FLAG] === true) {
    return;
  }

  window[INSTALL_FLAG] = true;

  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";
  const BLOWER_HISTORY_URL = "/maintenance/blower-history";
  const BLOWER_HISTORY_API_URL = "/api/blower-history?action=summary";
  const RETRY_INTERVAL_MS = 5000;
  const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

  let hasLoadedSummary = false;
  let requestInFlight = false;
  let lastSummary = null;

  function setHidden(node, shouldHide) {
    if (!node || node.hidden === shouldHide) {
      return;
    }

    node.hidden = shouldHide;
  }

  function getSessionToken() {
    if (typeof window.getShiftLogSessionToken === "function") {
      try {
        const token = String(window.getShiftLogSessionToken() || "").trim();

        if (token) {
          return token;
        }
      } catch {
        // The storage fallback below keeps first-load timing resilient.
      }
    }

    try {
      const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);

      if (!raw) {
        return "";
      }

      const user = JSON.parse(raw);

      return String(user?.sessionToken || user?.session_token || "").trim();
    } catch {
      return "";
    }
  }

  function openBlowerHistory() {
    if (typeof window.closeHeaderMoreMenu === "function") {
      window.closeHeaderMoreMenu();
    }

    if (
      window.GSShiftLogNavigation &&
      typeof window.GSShiftLogNavigation.navigate === "function" &&
      window.GSShiftLogNavigation.navigate(BLOWER_HISTORY_URL)
    ) {
      return;
    }

    window.location.assign(BLOWER_HISTORY_URL);
  }

  function ensureMenuBadgeStyle() {
    if (document.getElementById("mobileBlowerMainAlertStyle")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "mobileBlowerMainAlertStyle";
    style.textContent = `
      .blower-history-menu-badge {
        display: inline-flex;
        min-width: 20px;
        height: 20px;
        align-items: center;
        justify-content: center;
        padding: 0 6px;
        border-radius: 999px;
        background: #b42331;
        color: #fff;
        font-size: 11px;
        font-weight: 800;
      }

      .blower-history-menu-badge[hidden] {
        display: none !important;
      }
    `;

    document.head.append(style);
  }

  function getMainAlertMount() {
    return (
      document.getElementById("mainNotificationRailList") ||
      document.getElementById("mainNotificationRail")
    );
  }

  function mountMainAlert(alertButton) {
    const mount = getMainAlertMount();

    if (mount && alertButton.parentElement !== mount) {
      mount.append(alertButton);
    }
  }

  function ensureMainAlert() {
    let alertButton = document.getElementById("blowerHistoryMainAlert");

    if (alertButton) {
      mountMainAlert(alertButton);
      return alertButton;
    }

    alertButton = document.createElement("button");
    alertButton.type = "button";
    alertButton.className = "blower-history-main-alert";
    alertButton.id = "blowerHistoryMainAlert";
    alertButton.setAttribute("aria-live", "polite");
    alertButton.setAttribute("aria-label", "Blower 교체 알림 확인");
    alertButton.hidden = true;
    alertButton.innerHTML = `
      <span class="blower-history-main-alert__dot" aria-hidden="true"></span>
      <span class="blower-history-main-alert__content">
        <small id="blowerHistoryMainAlertLabel">Blower 교체 알림</small>
        <strong id="blowerHistoryMainAlertText">교체 예정 설비가 있습니다.</strong>
      </span>
      <span class="blower-history-main-alert__count" id="blowerHistoryMainAlertCount">0</span>
    `;

    // Bind only on creation. A pre-existing alert is owned by the full launcher.
    alertButton.addEventListener("click", openBlowerHistory);
    mountMainAlert(alertButton);

    return alertButton;
  }

  function setMainAlertVisibility(alertButton, isVisible) {
    if (
      !isVisible &&
      document.activeElement === alertButton
    ) {
      document.querySelector(".top-tab.is-active")?.focus({
        preventScroll: true
      });
    }

    setHidden(alertButton, !isVisible);

    const headingRight = document.querySelector(
      ".shift-status-section > .section-heading > .shift-heading-right"
    );

    if (
      headingRight &&
      headingRight.classList.contains("has-blower-history-main-alert") !==
        isVisible
    ) {
      headingRight.classList.toggle("has-blower-history-main-alert", isVisible);
    }
  }

  function formatRemaining(asset) {
    const remaining = Number(asset?.remainingHours);

    if (!Number.isFinite(remaining)) {
      return "";
    }

    if (remaining <= 0) {
      const hours = Math.abs(remaining);
      const days = Math.floor(hours / 24);
      const rest = Math.floor(hours % 24);

      return `${days}일 ${rest}시간 초과`;
    }

    const days = Math.floor(remaining / 24);
    const hours = Math.floor(remaining % 24);

    return `${days}일 ${hours}시간 남음`;
  }

  function buildMainAlertIdentity(summary) {
    const alerts = Array.isArray(summary?.alerts) ? summary.alerts : [];

    const identities = alerts
      .map(asset => {
        return String(
          asset?.tagNumber ||
            asset?.assetTag ||
            asset?.id ||
            [asset?.blowerType, asset?.unitNo, asset?.positionLabel]
              .filter(Boolean)
              .join(":") ||
            asset?.displayName ||
            ""
        ).trim();
      })
      .filter(Boolean)
      .sort();

    return JSON.stringify(identities);
  }

  function renderSummary(summary) {
    lastSummary = summary;

    const menuItem = document.getElementById("blowerHistoryHeaderButton");
    const badge = document.getElementById("blowerHistoryMenuBadge");
    const alertButton = ensureMainAlert();
    const alertCount = Math.max(0, Number(summary?.alertCount || 0));
    const floatingIdentity = buildMainAlertIdentity(summary);

    if (alertButton.dataset.mainFloatingIdentity !== floatingIdentity) {
      alertButton.dataset.mainFloatingIdentity = floatingIdentity;
    }

    if (menuItem) {
      menuItem.setAttribute(
        "aria-label",
        alertCount > 0
          ? `직접 제작 메뉴, Blower 교체이력 관리 열기, 알림 ${alertCount}건`
          : "직접 제작 메뉴, Blower 교체이력 관리 열기"
      );
    }

    if (badge) {
      setHidden(badge, alertCount === 0);
      badge.textContent = String(alertCount);
      badge.setAttribute("aria-label", `Blower 교체 알림 ${alertCount}건`);
    }

    if (alertCount === 0) {
      setMainAlertVisibility(alertButton, false);
      alertButton.classList.remove("is-warning", "is-critical", "is-overdue");
      return;
    }

    const severityValue = String(summary?.strongestSeverity || "warning");
    const strongest = ["warning", "critical", "overdue"].includes(
      severityValue
    )
      ? severityValue
      : "warning";
    const first = Array.isArray(summary?.alerts) ? summary.alerts[0] : null;
    const label = alertButton.querySelector("#blowerHistoryMainAlertLabel");
    const text = alertButton.querySelector("#blowerHistoryMainAlertText");
    const count = alertButton.querySelector("#blowerHistoryMainAlertCount");

    setMainAlertVisibility(alertButton, true);
    alertButton.classList.remove("is-warning", "is-critical", "is-overdue");
    alertButton.classList.add(`is-${strongest}`);

    const labelText =
      strongest === "overdue"
        ? "Blower 교체 초과"
        : strongest === "critical"
          ? "Blower 교체 임박"
          : "Blower 교체 예정";
    const detailText = first
      ? `${first.displayName} · ${formatRemaining(first)}`
      : `교체 확인이 필요한 Blower ${alertCount}대`;

    if (label && label.textContent !== labelText) {
      label.textContent = labelText;
    }

    if (text && text.textContent !== detailText) {
      text.textContent = detailText;
    }

    if (count && count.textContent !== String(alertCount)) {
      count.textContent = String(alertCount);
    }

    const accessibleText = `${labelText}. ${detailText}. 총 ${alertCount}대`;
    alertButton.title = accessibleText;
    alertButton.setAttribute("aria-label", accessibleText);
  }

  async function refreshSummary() {
    if (requestInFlight) {
      return;
    }

    const token = getSessionToken();

    if (!token) {
      hasLoadedSummary = false;
      return;
    }

    requestInFlight = true;

    try {
      const response = await fetch(BLOWER_HISTORY_API_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      if (!response.ok) {
        return;
      }

      const result = await response.json();

      if (result?.ok === false) {
        return;
      }

      if (getSessionToken() !== token) {
        return;
      }

      hasLoadedSummary = true;
      renderSummary(result);
    } catch (error) {
      console.warn("Blower 교체 알림 조회 실패:", error);
    } finally {
      requestInFlight = false;
    }
  }

  function syncSummaryController() {
    if (lastSummary) {
      renderSummary(lastSummary);
    }

    refreshSummary();
  }

  function initialize() {
    ensureMenuBadgeStyle();
    ensureMainAlert();
    refreshSummary();

    window.setInterval(() => {
      if (!hasLoadedSummary && getSessionToken()) {
        refreshSummary();
      }
    }, RETRY_INTERVAL_MS);

    window.setInterval(refreshSummary, REFRESH_INTERVAL_MS);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshSummary();
      }
    });

    window.addEventListener("storage", event => {
      if (event.key !== AUTH_STORAGE_KEY) {
        return;
      }

      hasLoadedSummary = false;

      if (!getSessionToken()) {
        renderSummary({ alertCount: 0 });
        return;
      }

      refreshSummary();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  window.GSMobileBlowerMainAlert = {
    sync: syncSummaryController
  };
})();
