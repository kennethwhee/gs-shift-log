(() => {
  "use strict";

  /* COFIRING TOP TABS SKY V3 R1 ORIGINAL CLEANUP
     Rebuilds only the visible top navigation.
     Original buttons stay in the DOM (hidden) and keep all existing behavior.
  */

  const ROOT_ID = "efficiencyCofiringDraftView";
  const NAV_ID = "cofiringTopTabsSkyV3";
  const HIDDEN_HOST_ID = "cofiringTopTabsOriginalHostV3";
  const LABELS = [
    "혼소율 계산",
    "고형연료 관리",
    "마감 데이터",
    "발열량/보정계수"
  ];

  let retryTimer = 0;
  let retryStartedAt = 0;

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function root() {
    return document.getElementById(ROOT_ID);
  }

  function findOriginalButtons() {
    const scope = root();
    if (!scope) return [];

    const found = [];

    for (const label of LABELS) {
      const button = Array.from(scope.querySelectorAll("button")).find(
        (candidate) =>
          candidate.id !== NAV_ID &&
          !candidate.closest(`#${NAV_ID}`) &&
          normalize(candidate.textContent) === label
      );

      if (!button) return [];
      found.push(button);
    }

    return found;
  }

  function hiddenHost(scope) {
    let host = document.getElementById(HIDDEN_HOST_ID);

    if (!host) {
      host = document.createElement("div");
      host.id = HIDDEN_HOST_ID;
      host.hidden = true;
      host.setAttribute("aria-hidden", "true");
      host.style.setProperty("display", "none", "important");
      scope.append(host);
    }

    return host;
  }

  function removeOriginalTabsFromLayout(originals) {
    const scope = root();
    if (!scope || originals.length !== LABELS.length) return false;

    const host = hiddenHost(scope);

    for (const original of originals) {
      original.dataset.cfSkyOriginal = "1";
      original.hidden = true;
      original.setAttribute("aria-hidden", "true");
      original.tabIndex = -1;
      original.style.setProperty("display", "none", "important");

      if (original.parentElement !== host) {
        host.append(original);
      }
    }

    return true;
  }

  function originalIsSelected(button) {
    if (!button) return false;

    return (
      button.getAttribute("aria-selected") === "true" ||
      button.getAttribute("data-selected") === "true" ||
      button.classList.contains("is-active") ||
      button.classList.contains("active") ||
      button.classList.contains("selected")
    );
  }

  function selectedIndex(originals) {
    const index = originals.findIndex(originalIsSelected);
    if (index >= 0) return index;

    const nav = document.getElementById(NAV_ID);
    const current = nav?.querySelector("[data-cf-sky-tab].is-selected");
    const currentIndex = Number(current?.dataset.cfSkyIndex);

    if (Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < LABELS.length) {
      return currentIndex;
    }

    return 0;
  }

  function syncSelection(originals) {
    const nav = document.getElementById(NAV_ID);
    if (!nav) return;

    const activeIndex = selectedIndex(originals);

    nav.querySelectorAll("[data-cf-sky-tab]").forEach((button, index) => {
      const selected = index === activeIndex;

      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function copyButtonContent(original, custom, label) {
    const icon = original.querySelector(
      ".cfv12-tab-icon, .cofiring-tab-icon, .tab-icon, [aria-hidden='true']"
    );

    if (icon) {
      const clonedIcon = icon.cloneNode(true);
      clonedIcon.classList.add("cf-sky-tab__icon");
      custom.append(clonedIcon);
    }

    const labelNode = document.createElement("span");
    labelNode.className = "cf-sky-tab__label";
    labelNode.textContent = label;
    custom.append(labelNode);
  }

  function buildNav(originals) {
    const existing = document.getElementById(NAV_ID);
    if (existing) {
      removeOriginalTabsFromLayout(originals);
      syncSelection(originals);
      return existing;
    }

    const first = originals[0];
    const parent = first?.parentElement;
    if (!first || !parent) return null;

    const nav = document.createElement("div");
    nav.id = NAV_ID;
    nav.className = "cf-sky-tabs-v3";
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "혼소율 분석 메뉴");

    originals.forEach((original, index) => {
      const custom = document.createElement("button");
      custom.type = "button";
      custom.className = "cf-sky-tab-v3";
      custom.dataset.cfSkyTab = "1";
      custom.dataset.cfSkyIndex = String(index);
      custom.setAttribute("role", "tab");

      copyButtonContent(original, custom, LABELS[index]);

      custom.addEventListener("click", () => {
        nav.querySelectorAll("[data-cf-sky-tab]").forEach((button, buttonIndex) => {
          const selected = buttonIndex === index;
          button.classList.toggle("is-selected", selected);
          button.setAttribute("aria-selected", selected ? "true" : "false");
        });

        original.click();

        for (const delay of [0, 60, 180, 450, 900]) {
          window.setTimeout(() => syncSelection(originals), delay);
        }
      });

      nav.append(custom);
    });

    parent.insertBefore(nav, first);
    removeOriginalTabsFromLayout(originals);
    syncSelection(originals);

    return nav;
  }

  function mount() {
    const originals = findOriginalButtons();
    if (originals.length !== LABELS.length) return false;

    buildNav(originals);
    syncSelection(originals);
    return true;
  }

  function startBoundedRetry() {
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = 0;
    }

    retryStartedAt = Date.now();

    const tick = () => {
      const mounted = mount();

      if (mounted || Date.now() - retryStartedAt >= 30000) {
        retryTimer = 0;
        return;
      }

      retryTimer = window.setTimeout(tick, 250);
    };

    tick();
  }

  function refreshSoon() {
    for (const delay of [0, 80, 220, 500]) {
      window.setTimeout(mount, delay);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startBoundedRetry, { once: true });
  } else {
    startBoundedRetry();
  }

  document.addEventListener("click", refreshSoon, true);
  window.addEventListener("focus", refreshSoon);

  // Login-safe: no MutationObserver; only bounded retries and event refreshes.
})();
