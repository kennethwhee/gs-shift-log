(() => {
  "use strict";

  /* COFIRING SOLID FUEL SCROLL STABILITY V1
     Prevent small iframe-height recalculations from causing visible scroll jumps
     while the user is wheeling, clicking, typing, or switching embedded tabs.

     No MutationObserver. Same-origin iframe only.
  */

  const ROOT_ID = "efficiencyCofiringDraftView";
  const FRAME_SELECTOR =
    'iframe[title="고형연료 관리"], iframe[src*="/maintenance/solid-fuel-trouble"]';

  const MIN_HEIGHT_DELTA = 8;
  const WHEEL_IDLE_MS = 260;
  const ACTION_IDLE_MS = 1100;
  const INPUT_IDLE_MS = 700;

  const states = new WeakMap();
  let attachTimer = 0;
  let attachStartedAt = 0;

  function root() {
    return document.getElementById(ROOT_ID);
  }

  function frame() {
    return root()?.querySelector(FRAME_SELECTOR) || null;
  }

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function scrollParent(element) {
    let node = element?.parentElement || null;

    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;

      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight + 2
      ) {
        return node;
      }

      node = node.parentElement;
    }

    return document.scrollingElement || document.documentElement;
  }

  function innerHeight(target) {
    try {
      const doc = target.contentDocument;
      if (!doc) return 0;

      const body = doc.body;
      const html = doc.documentElement;

      return Math.ceil(
        Math.max(
          body?.scrollHeight || 0,
          body?.offsetHeight || 0,
          html?.scrollHeight || 0,
          html?.offsetHeight || 0
        )
      );
    } catch (_) {
      return 0;
    }
  }

  function stateFor(target) {
    let state = states.get(target);

    if (!state) {
      state = {
        timer: 0,
        frozenHeight: 0,
        outer: null,
        outerScrollTop: 0,
        innerBoundDocument: null,
      };
      states.set(target, state);
    }

    return state;
  }

  function preserveScroll(state) {
    const outer = state.outer;
    const scrollTop = state.outerScrollTop;

    if (!outer || !Number.isFinite(scrollTop)) return;

    const restore = () => {
      if (!outer?.isConnected && outer !== document.documentElement && outer !== document.body) {
        return;
      }

      if (Math.abs((outer.scrollTop || 0) - scrollTop) > 1) {
        outer.scrollTop = scrollTop;
      }
    };

    restore();
    window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
  }

  function freeze(target) {
    if (!visible(target)) return null;

    const state = stateFor(target);
    const renderedHeight = Math.ceil(target.getBoundingClientRect().height);

    if (renderedHeight <= 0) return state;

    state.frozenHeight = renderedHeight;
    state.outer = scrollParent(target);
    state.outerScrollTop = state.outer?.scrollTop || 0;

    target.style.setProperty("--cf-solid-stable-height", `${renderedHeight}px`);
    target.classList.add("cf-solid-frame-stability-v1");

    return state;
  }

  function settle(target) {
    if (!target?.isConnected) return;

    const state = stateFor(target);
    const oldHeight =
      state.frozenHeight ||
      Math.ceil(target.getBoundingClientRect().height) ||
      parseFloat(target.style.height) ||
      0;

    const desiredHeight = innerHeight(target);

    // Ignore tiny layout noise. It is the main cause of the visible "nudge".
    if (
      desiredHeight > 0 &&
      oldHeight > 0 &&
      Math.abs(desiredHeight - oldHeight) >= MIN_HEIGHT_DELTA
    ) {
      target.style.height = `${desiredHeight}px`;
      state.frozenHeight = desiredHeight;
    }

    target.classList.remove("cf-solid-frame-stability-v1");
    target.style.removeProperty("--cf-solid-stable-height");

    preserveScroll(state);
  }

  function hold(target, idleMs) {
    if (!target) return;

    const state = freeze(target);
    if (!state) return;

    if (state.timer) {
      window.clearTimeout(state.timer);
    }

    state.timer = window.setTimeout(() => {
      state.timer = 0;
      settle(target);
    }, idleMs);
  }

  function bindInner(target) {
    try {
      const doc = target.contentDocument;
      if (!doc) return false;

      const state = stateFor(target);
      if (state.innerBoundDocument === doc) return true;

      state.innerBoundDocument = doc;

      doc.addEventListener(
        "wheel",
        () => hold(target, WHEEL_IDLE_MS),
        { capture: true, passive: true }
      );

      doc.addEventListener(
        "pointerdown",
        () => hold(target, ACTION_IDLE_MS),
        true
      );

      doc.addEventListener(
        "click",
        () => hold(target, ACTION_IDLE_MS),
        true
      );

      doc.addEventListener(
        "change",
        () => hold(target, ACTION_IDLE_MS),
        true
      );

      doc.addEventListener(
        "submit",
        () => hold(target, ACTION_IDLE_MS),
        true
      );

      doc.addEventListener(
        "input",
        () => hold(target, INPUT_IDLE_MS),
        true
      );

      return true;
    } catch (_) {
      return false;
    }
  }

  function bindFrame(target) {
    if (!target || target.dataset.cfSolidScrollStability === "1") {
      if (target) bindInner(target);
      return Boolean(target);
    }

    target.dataset.cfSolidScrollStability = "1";
    target.setAttribute("scrolling", "no");

    target.addEventListener("load", () => {
      bindInner(target);

      // Let the embedded page finish its own first render, then settle once.
      for (const delay of [80, 250, 700]) {
        window.setTimeout(() => {
          if (!visible(target)) return;
          const state = freeze(target);
          if (state) {
            if (state.timer) window.clearTimeout(state.timer);
            state.timer = window.setTimeout(() => {
              state.timer = 0;
              settle(target);
            }, 120);
          }
        }, delay);
      }
    });

    bindInner(target);
    return true;
  }

  function attach() {
    const target = frame();
    if (!target) return false;

    bindFrame(target);
    return true;
  }

  function startBoundedAttach() {
    if (attachTimer) {
      window.clearTimeout(attachTimer);
      attachTimer = 0;
    }

    attachStartedAt = Date.now();

    const tick = () => {
      attach();

      if (Date.now() - attachStartedAt >= 60000) {
        attachTimer = 0;
        return;
      }

      attachTimer = window.setTimeout(tick, 300);
    };

    tick();
  }

  // Freeze before parent-level clicks that may cause the embedded page to be
  // remeasured by the existing management runtime.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const view = root();
      if (!view || !view.contains(event.target)) return;
      const target = frame();
      if (target && visible(target)) hold(target, ACTION_IDLE_MS);
    },
    true
  );

  document.addEventListener(
    "wheel",
    () => {
      const target = frame();
      if (target && visible(target)) hold(target, WHEEL_IDLE_MS);
    },
    { capture: true, passive: true }
  );

  window.addEventListener("focus", attach);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startBoundedAttach, { once: true });
  } else {
    startBoundedAttach();
  }

  // No MutationObserver: bounded attachment only.
})();
