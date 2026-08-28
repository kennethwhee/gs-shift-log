"use strict";

(() => {
  if (window.__gsShiftLogNavigationV1Installed === true) {
    return;
  }

  window.__gsShiftLogNavigationV1Installed = true;

  const PENDING_STORAGE_KEY = "gsShiftLog.navigation.pending.v1";
  const HISTORY_STATE_KEY = "gsShiftLogNavigation";
  const WINDOW_NAME_MARKER_PREFIX = "__GS_SHIFT_LOG_NAV_V1__";
  const PENDING_TTL_MS = 60 * 1000;

  const CLEAN_ROUTE_BY_PATH = new Map([
    ["/maintenance/solid-fuel-trouble.html", "/maintenance/solid-fuel-trouble"],
    ["/maintenance/blower-history.html", "/maintenance/blower-history"],
    ["/maintenance/planned-maintenance.html", "/maintenance/planned-maintenance"]
  ]);

  function currentTime() {
    return Date.now();
  }

  function isPlainPrimaryClick(event) {
    return Boolean(
      event &&
      event.button === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    );
  }

  function normalizeReturnPath(rawPath = window.location.pathname) {
    const path = String(rawPath || "").trim();

    if (
      path === "/" ||
      path === "/index.html"
    ) {
      return "/";
    }

    if (
      path === "/mobile-app" ||
      path === "/mobile-app/" ||
      path === "/mobile-app/index.html"
    ) {
      return "/mobile-app/";
    }

    return "";
  }

  function isAllowedReturnPath(rawPath) {
    return rawPath === "/" || rawPath === "/mobile-app/";
  }

  function resolveTarget(rawTarget) {
    let url;

    try {
      url = new URL(
        String(rawTarget || "").trim(),
        window.location.origin
      );
    } catch {
      return null;
    }

    if (url.origin !== window.location.origin) {
      return null;
    }

    url.pathname = CLEAN_ROUTE_BY_PATH.get(url.pathname) || url.pathname;
    url.hash = "";

    return {
      href: url.href,
      key: `${url.pathname}${url.search}`,
      pathname: url.pathname,
      search: url.search
    };
  }

  function readWindowNameMarker() {
    let rawName = "";

    try {
      rawName = String(window.name || "");
    } catch {
      return null;
    }

    if (!rawName.startsWith(WINDOW_NAME_MARKER_PREFIX)) {
      return null;
    }

    try {
      const marker = JSON.parse(
        rawName.slice(WINDOW_NAME_MARKER_PREFIX.length)
      );

      return marker?.version === 1 ? marker : null;
    } catch {
      return null;
    }
  }

  function restoreWindowNameMarker() {
    const marker = readWindowNameMarker();

    if (!marker) {
      return "";
    }

    try {
      window.name = String(marker.previousWindowName || "");
    } catch {
      // window.name 복원이 차단되어도 표식 검증은 계속한다.
    }

    return JSON.stringify(marker);
  }

  function clearPendingMarker() {
    try {
      window.sessionStorage.removeItem(PENDING_STORAGE_KEY);
    } catch {
      // sessionStorage를 사용할 수 없어도 일반 주소 이동은 계속한다.
    }

    restoreWindowNameMarker();
  }

  function writePendingMarker(target, returnTo) {
    clearPendingMarker();

    if (!target || !isAllowedReturnPath(returnTo)) {
      return false;
    }

    const marker = {
      version: 1,
      target: target.key,
      returnTo,
      createdAt: currentTime()
    };

    try {
      window.sessionStorage.setItem(
        PENDING_STORAGE_KEY,
        JSON.stringify(marker)
      );

      return true;
    } catch {
      try {
        window.name =
          WINDOW_NAME_MARKER_PREFIX +
          JSON.stringify({
            ...marker,
            previousWindowName: String(window.name || "")
          });

        return true;
      } catch {
        return false;
      }
    }
  }

  function consumePendingMarker() {
    let rawMarker = "";

    try {
      rawMarker = window.sessionStorage.getItem(PENDING_STORAGE_KEY) || "";
    } catch {
      rawMarker = "";
    }

    try {
      window.sessionStorage.removeItem(PENDING_STORAGE_KEY);
    } catch {
      // window.name fallback 검증을 계속한다.
    }

    if (!rawMarker) {
      rawMarker = restoreWindowNameMarker();
    }

    if (!rawMarker) {
      return null;
    }

    let marker;

    try {
      marker = JSON.parse(rawMarker);
    } catch {
      return null;
    }

    const target = resolveTarget(window.location.href);
    const createdAt = Number(marker?.createdAt || 0);
    const age = currentTime() - createdAt;
    const returnTo = String(marker?.returnTo || "");

    if (
      marker?.version !== 1 ||
      !target ||
      String(marker?.target || "") !== target.key ||
      !isAllowedReturnPath(returnTo) ||
      !Number.isFinite(createdAt) ||
      age < 0 ||
      age > PENDING_TTL_MS
    ) {
      return null;
    }

    const navigationState = {
      version: 1,
      returnTo,
      target: target.key,
      activatedAt: currentTime()
    };

    const existingState =
      window.history.state &&
      typeof window.history.state === "object"
        ? window.history.state
        : {};

    window.history.replaceState(
      {
        ...existingState,
        [HISTORY_STATE_KEY]: navigationState
      },
      "",
      window.location.href
    );

    return navigationState;
  }

  function clearInvalidHistoryState() {
    const existingState = window.history.state;

    if (
      !existingState ||
      typeof existingState !== "object" ||
      !(HISTORY_STATE_KEY in existingState)
    ) {
      return;
    }

    const nextState = { ...existingState };
    delete nextState[HISTORY_STATE_KEY];

    window.history.replaceState(
      Object.keys(nextState).length > 0 ? nextState : null,
      "",
      window.location.href
    );
  }

  function getReturnContext(options = {}) {
    const state = window.history.state;
    const navigationState =
      state && typeof state === "object"
        ? state[HISTORY_STATE_KEY]
        : null;
    const activatedAt = Number(navigationState?.activatedAt || 0);
    const returnTo = String(navigationState?.returnTo || "");

    const valid = Boolean(
      navigationState?.version === 1 &&
      isAllowedReturnPath(returnTo) &&
      Number.isFinite(activatedAt) &&
      activatedAt > 0
    );

    if (!valid) {
      if (options.clearInvalid === true) {
        clearInvalidHistoryState();
      }

      return null;
    }

    return {
      returnTo,
      target: String(navigationState.target || ""),
      activatedAt
    };
  }

  function navigate(rawTarget, options = {}) {
    const target = resolveTarget(rawTarget);

    if (!target) {
      return false;
    }

    const requestedReturnTo = String(options.returnTo || "");
    const returnTo = isAllowedReturnPath(requestedReturnTo)
      ? requestedReturnTo
      : normalizeReturnPath();

    writePendingMarker(target, returnTo);
    window.location.assign(target.key);
    return true;
  }

  function dispatchBeforeReturn(context, control) {
    const event = new CustomEvent(
      "gs-shift-log-before-return",
      {
        cancelable: true,
        detail: {
          returnTo: context.returnTo,
          target: context.target,
          activatedAt: context.activatedAt,
          control: control || null
        }
      }
    );

    return window.dispatchEvent(event);
  }

  function returnToShiftLog(control) {
    const context = getReturnContext({ clearInvalid: true });

    if (!context || !dispatchBeforeReturn(context, control)) {
      syncReturnControls();
      return false;
    }

    const startingHref = window.location.href;
    let pageWasHidden = false;

    const markPageHidden = () => {
      pageWasHidden = true;
    };

    window.addEventListener("pagehide", markPageHidden, { once: true });
    window.history.back();

    window.setTimeout(() => {
      window.removeEventListener("pagehide", markPageHidden);

      if (
        !pageWasHidden &&
        window.location.href === startingHref
      ) {
        window.location.assign(context.returnTo);
      }
    }, 900);

    return true;
  }

  function bindReturnControl(control) {
    if (
      !(control instanceof Element) ||
      control.dataset.shiftLogReturnBound === "true"
    ) {
      return;
    }

    control.dataset.shiftLogReturnBound = "true";
    control.addEventListener("click", event => {
      if (!isPlainPrimaryClick(event)) {
        return;
      }

      event.preventDefault();
      returnToShiftLog(control);
    });
  }

  function syncReturnControls() {
    const context = getReturnContext({ clearInvalid: true });

    document
      .querySelectorAll("[data-shift-log-return]")
      .forEach(control => {
        bindReturnControl(control);

        control.hidden = !context;
        control.setAttribute(
          "aria-hidden",
          context ? "false" : "true"
        );

        if (control instanceof HTMLAnchorElement) {
          control.href = context?.returnTo || "/";
        }
      });

    return context;
  }

  function handleTargetClick(event) {
    const eventTarget =
      event.target instanceof Element
        ? event.target
        : null;
    const control = eventTarget?.closest("[data-shift-log-target]");

    if (!control || event.button !== 0) {
      return;
    }

    const rawTarget =
      control.getAttribute("data-shift-log-target") ||
      control.getAttribute("href") ||
      "";
    const target = resolveTarget(rawTarget);

    if (!target) {
      return;
    }

    /*
      수정 키 클릭은 anchor의 기본 새 탭/새 창 동작을 유지하되,
      뒤에서 등록된 기존 팝업 핸들러까지 이벤트가 내려가지는 않게 한다.
    */
    event.stopImmediatePropagation();

    if (!isPlainPrimaryClick(event)) {
      clearPendingMarker();
      return;
    }

    event.preventDefault();

    if (typeof window.closeHeaderMoreMenu === "function") {
      window.closeHeaderMoreMenu();
    }

    navigate(target.key);
  }

  function initialize() {
    consumePendingMarker();
    syncReturnControls();
  }

  document.addEventListener("click", handleTargetClick, true);
  window.addEventListener("pageshow", syncReturnControls);
  window.addEventListener("popstate", syncReturnControls);

  window.GSShiftLogNavigation = Object.freeze({
    navigate,
    returnToShiftLog,
    getReturnContext,
    syncReturnControls,
    isPlainPrimaryClick,
    resolveTarget
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
