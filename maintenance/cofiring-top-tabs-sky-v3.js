(() => {
  "use strict";

  /* COFIRING TOP TABS SKY V3 R2 LIVE PROXY
     - Keep every original tab button in its original DOM position.
     - Hide originals visually only.
     - The visible sky-blue navigation forwards clicks to the latest live
       original button for each label.
     - This is important for Solid Fuel Management because its real button
       can be injected/bound later than the base co-firing tabs.
  */

  const ROOT_ID = "efficiencyCofiringDraftView";
  const NAV_ID = "cofiringTopTabsSkyV3";
  const LABELS = [
    "혼소율 계산",
    "고형연료 관리",
    "마감 데이터",
    "발열량/보정계수"
  ];

  const preferredOriginal = new Map();
  let currentLabel = "";
  let retryTimer = 0;
  let retryStartedAt = 0;

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function root() {
    return document.getElementById(ROOT_ID);
  }

  function isCustomButton(button) {
    return Boolean(button?.closest(`#${NAV_ID}`));
  }

  function candidatesFor(label) {
    const scope = root();
    if (!scope) return [];

    return Array.from(scope.querySelectorAll("button")).filter((button) => {
      if (isCustomButton(button)) return false;
      return normalize(button.textContent) === label;
    });
  }

  function isSelected(button) {
    if (!button) return false;

    return (
      button.getAttribute("aria-selected") === "true" ||
      button.getAttribute("data-selected") === "true" ||
      button.classList.contains("is-active") ||
      button.classList.contains("active") ||
      button.classList.contains("selected")
    );
  }

  function hideOriginalButton(button, label) {
    button.dataset.cfSkyOriginal = "1";
    button.dataset.cfSkyOriginalLabel = label;
    button.hidden = true;
    button.setAttribute("aria-hidden", "true");
    button.tabIndex = -1;
    button.style.setProperty("display", "none", "important");
  }

  function scanOriginals() {
    const scope = root();
    if (!scope) return false;

    let foundAny = false;

    for (const label of LABELS) {
      const candidates = candidatesFor(label);

      if (!candidates.length) continue;

      foundAny = true;

      const live = candidates[candidates.length - 1];
      preferredOriginal.set(label, live);

      for (const button of candidates) {
        hideOriginalButton(button, label);
      }
    }

    return foundAny;
  }

  function selectedLabelFromOriginals() {
    for (const label of LABELS) {
      const candidates = candidatesFor(label);
      if (candidates.some(isSelected)) return label;
    }

    return "";
  }

  function syncVisibleSelection() {
    const nav = document.getElementById(NAV_ID);
    if (!nav) return;

    const detected = selectedLabelFromOriginals();

    if (detected) {
      currentLabel = detected;
    } else if (!currentLabel) {
      currentLabel = LABELS[0];
    }

    nav.querySelectorAll("[data-cf-sky-tab]").forEach((button) => {
      const selected = button.dataset.cfSkyLabel === currentLabel;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function clickLiveOriginal(label) {
    scanOriginals();

    let target = preferredOriginal.get(label);

    if (!target?.isConnected) {
      const candidates = candidatesFor(label);
      target = candidates[candidates.length - 1] || null;
    }

    if (!target) {
      return false;
    }

    target.click();
    return true;
  }

  function buildVisibleNav() {
    const scope = root();
    if (!scope) return null;

    const existing = document.getElementById(NAV_ID);
    if (existing) return existing;

    scanOriginals();

    const firstOriginal = LABELS
      .flatMap((label) => candidatesFor(label))
      .find(Boolean);

    if (!firstOriginal?.parentElement) return null;

    const nav = document.createElement("div");
    nav.id = NAV_ID;
    nav.className = "cf-sky-tabs-v3";
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "혼소율 분석 메뉴");

    LABELS.forEach((label, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cf-sky-tab-v3";
      button.dataset.cfSkyTab = "1";
      button.dataset.cfSkyIndex = String(index);
      button.dataset.cfSkyLabel = label;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", "false");

      const labelNode = document.createElement("span");
      labelNode.className = "cf-sky-tab__label";
      labelNode.textContent = label;
      button.append(labelNode);

      button.addEventListener("click", () => {
        currentLabel = label;
        syncVisibleSelection();

        const clicked = clickLiveOriginal(label);

        if (!clicked) {
          let attempts = 0;

          const retryClick = () => {
            attempts += 1;
            scanOriginals();

            if (clickLiveOriginal(label)) {
              for (const delay of [0, 60, 180, 450, 900]) {
                window.setTimeout(() => {
                  scanOriginals();
                  syncVisibleSelection();
                }, delay);
              }
              return;
            }

            if (attempts < 12) {
              window.setTimeout(retryClick, 100);
            }
          };

          window.setTimeout(retryClick, 100);
        }

        for (const delay of [0, 60, 180, 450, 900, 1500]) {
          window.setTimeout(() => {
            scanOriginals();
            syncVisibleSelection();
          }, delay);
        }
      });

      nav.append(button);
    });

    firstOriginal.parentElement.insertBefore(nav, firstOriginal);

    const initial = selectedLabelFromOriginals();
    currentLabel = initial || LABELS[0];

    scanOriginals();
    syncVisibleSelection();

    return nav;
  }

  function mount() {
    const scope = root();
    if (!scope) return false;

    scanOriginals();

    const nav = buildVisibleNav();
    if (!nav) return false;

    scanOriginals();
    syncVisibleSelection();

    return true;
  }

  function startBoundedRetry() {
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = 0;
    }

    retryStartedAt = Date.now();

    const tick = () => {
      mount();

      if (Date.now() - retryStartedAt >= 90000) {
        retryTimer = 0;
        return;
      }

      retryTimer = window.setTimeout(tick, 250);
    };

    tick();
  }

  function refreshSoon() {
    for (const delay of [0, 80, 220, 500, 900]) {
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

  // Login-safe: no MutationObserver.
})();
