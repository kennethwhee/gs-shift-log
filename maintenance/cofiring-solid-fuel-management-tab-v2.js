(() => {
  "use strict";

  /* COFIRING SOLID FUEL MANAGEMENT TAB V2 */
  const ROOT_SELECTOR = "[data-cofiring-draft-root]";
  const TABS_SELECTOR = ".cfv12-tabs";
  const SHEET_SELECTOR = ".cfv5-sheet";
  const BUTTON_ID = "cfvSolidFuelManagementTab";
  const PANEL_ID = "cfvSolidFuelManagementPanel";
  const FRAME_ID = "cfvSolidFuelManagementFrame";
  const ROUTE = "/maintenance/solid-fuel-trouble?embed=cofiring";

  function textOf(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function classifyTabs(tabs) {
    for (const item of Array.from(tabs.children)) {
      item.classList.add("cfv-top-tab-v2");
      const text = textOf(item);

      item.classList.toggle("is-calc", text.includes("혼소율 계산"));
      item.classList.toggle("is-history", text.includes("마감 데이터"));
      item.classList.toggle(
        "is-settings",
        text.includes("발열량/보정계수") ||
        text.includes("발열량 · 보정계수") ||
        text.includes("발열량 보정계수")
      );
      item.classList.toggle("is-management", text.includes("고형연료 관리"));
    }
  }

  function createButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className =
      "cfv12-tab cfv-top-tab-v2 cfv-solid-fuel-management-tab is-management";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.setAttribute("aria-controls", PANEL_ID);
    button.textContent = "고형연료 관리";
    return button;
  }

  function createPanel() {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "cfv-solid-fuel-management-panel";
    panel.hidden = true;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", BUTTON_ID);

    const frame = document.createElement("iframe");
    frame.id = FRAME_ID;
    frame.className = "cfv-solid-fuel-management-frame";
    frame.title = "고형연료 관리";
    frame.loading = "lazy";
    frame.src = ROUTE;

    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument;
        if (!doc) return;

        doc.documentElement.classList.add("cfv-cofiring-embedded");
        doc.body?.classList.add("cfv-cofiring-embedded");

        // Embedded view keeps the management page in-place.
        // Remove only the standalone "return to shift log" action.
        for (const node of Array.from(doc.querySelectorAll("a,button"))) {
          const label = textOf(node);
          if (label === "업무일지로 돌아가기") {
            node.style.display = "none";
          }
        }

        // Keep standalone and embedded naming consistent.
        for (const heading of Array.from(doc.querySelectorAll("h1,h2"))) {
          if (textOf(heading).includes("고형연료 Trouble")) {
            heading.textContent = "고형연료 관리";
          }
        }

        if (!doc.getElementById("cfvCofiringEmbeddedStyle")) {
          const style = doc.createElement("style");
          style.id = "cfvCofiringEmbeddedStyle";
          style.textContent = `
            html.cfv-cofiring-embedded,
            body.cfv-cofiring-embedded {
              min-width: 0 !important;
              width: 100% !important;
              max-width: none !important;
              overflow-x: hidden !important;
              background: #f7fafc !important;
            }
            body.cfv-cofiring-embedded {
              margin: 0 !important;
              padding: 12px !important;
              box-sizing: border-box !important;
            }
            body.cfv-cofiring-embedded > * {
              max-width: none !important;
            }
          `;
          doc.head.append(style);
        }
      } catch (_) {
        // Same-origin is expected; if unavailable, the frame still works.
      }
    });

    panel.append(frame);
    return panel;
  }

  function findCalcTab(tabs) {
    return Array.from(tabs.children).find((node) =>
      textOf(node).includes("혼소율 계산")
    ) || null;
  }

  function removeLegacyTroubleTab(tabs) {
    for (const node of Array.from(tabs.children)) {
      if (
        node.id === "cfvSolidFuelTroubleTab" ||
        textOf(node).includes("고형연료 Trouble")
      ) {
        node.remove();
      }
    }
  }

  function setManagementMode(sheet, tabs, button, panel, enabled) {
    sheet.classList.toggle("cfv-solid-fuel-management-mode", enabled);
    panel.hidden = !enabled;
    button.setAttribute("aria-selected", enabled ? "true" : "false");

    if (enabled) {
      for (const tab of Array.from(tabs.children)) {
        if (tab !== button && tab.matches("[aria-selected]")) {
          tab.setAttribute("aria-selected", "false");
        }
      }
    }
  }

  function bind(tabs, sheet, button, panel) {
    if (tabs.dataset.cfvSolidFuelManagementBound === "1") return;
    tabs.dataset.cfvSolidFuelManagementBound = "1";

    tabs.addEventListener("click", (event) => {
      const clicked = event.target.closest(".cfv12-tab, .cfv-top-tab-v2");
      if (!clicked || !tabs.contains(clicked)) return;

      if (clicked === button) {
        event.preventDefault();
        setManagementMode(sheet, tabs, button, panel, true);
        return;
      }

      // Any existing tab returns control to its original handler.
      setManagementMode(sheet, tabs, button, panel, false);
    });
  }

  function enhance() {
    // Login-safe: do nothing until the co-firing UI actually exists.
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return false;

    const tabs = root.querySelector(TABS_SELECTOR);
    if (!tabs) return false;

    const sheet = tabs.closest(SHEET_SELECTOR);
    if (!sheet) return false;

    tabs.classList.add("cfv-top-tabs-v2");
    removeLegacyTroubleTab(tabs);

    let button = tabs.querySelector(`#${BUTTON_ID}`);
    if (!button) button = createButton();

    const calc = findCalcTab(tabs);
    if (calc && button.previousElementSibling !== calc) {
      calc.insertAdjacentElement("afterend", button);
    } else if (!button.isConnected) {
      tabs.prepend(button);
    }

    let panel = sheet.querySelector(`:scope > #${PANEL_ID}`);
    if (!panel) {
      panel = createPanel();
      const toolbar = tabs.closest(".cfv12-toolbar");
      const anchor = toolbar || tabs;
      anchor.insertAdjacentElement("afterend", panel);
    }

    bind(tabs, sheet, button, panel);
    classifyTabs(tabs);
    return true;
  }

  function scheduleEnhance() {
    window.setTimeout(enhance, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }

  // Deliberately no MutationObserver: avoid startup/login feedback loops.
  document.addEventListener("click", scheduleEnhance, true);
  window.addEventListener("focus", scheduleEnhance);

  for (const delay of [120, 350, 800, 1500, 3000, 6000, 10000]) {
    window.setTimeout(enhance, delay);
  }
})();
