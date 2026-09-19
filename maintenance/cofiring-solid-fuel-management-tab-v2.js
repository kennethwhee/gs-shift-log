(() => {
  "use strict";

  /* COFIRING SOLID FUEL MANAGEMENT TAB V2 R2 OUTER SCROLL */
  const ROOT_SELECTOR = "[data-cofiring-draft-root]";
  const TABS_SELECTOR = ".cfv12-tabs";
  const SHEET_SELECTOR = ".cfv5-sheet";
  const TOOLBAR_SELECTOR = ".cfv12-toolbar";
  const BUTTON_ID = "cfvSolidFuelManagementTab";
  const PANEL_ID = "cfvSolidFuelManagementPanel";
  const FRAME_ID = "cfvSolidFuelManagementFrame";
  const ROUTE = "/maintenance/solid-fuel-trouble?embed=cofiring";
  const HIDDEN_CLASS = "cfv-sfm-hidden-by-v2r2";

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

  function embeddedDocumentHeight(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc) return 0;
      const html = doc.documentElement;
      const body = doc.body;
      return Math.max(
        html?.scrollHeight || 0,
        html?.offsetHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0
      );
    } catch (_) {
      return 0;
    }
  }

  function resizeFrameToContent(frame) {
    if (!frame || frame.hidden) return;

    // First collapse the old explicit height so scrollHeight is measured
    // from document content rather than a previously oversized iframe.
    frame.style.height = "1px";

    window.requestAnimationFrame(() => {
      const measured = embeddedDocumentHeight(frame);
      const next = Math.max(720, measured + 8);
      frame.style.height = `${next}px`;
    });
  }

  function scheduleFrameResize(frame) {
    for (const delay of [0, 80, 220, 500, 1000]) {
      window.setTimeout(() => resizeFrameToContent(frame), delay);
    }
  }

  function prepareEmbeddedDocument(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc) return;

      doc.documentElement.classList.add("cfv-cofiring-embedded");
      doc.body?.classList.add("cfv-cofiring-embedded");

      for (const node of Array.from(doc.querySelectorAll("a,button"))) {
        const label = textOf(node);
        if (label === "업무일지로 돌아가기") {
          node.style.display = "none";
        }
      }

      for (const heading of Array.from(doc.querySelectorAll("h1,h2"))) {
        if (textOf(heading).includes("고형연료 Trouble")) {
          heading.textContent = "고형연료 관리";
        }
      }

      if (!doc.getElementById("cfvCofiringEmbeddedStyleR2")) {
        const style = doc.createElement("style");
        style.id = "cfvCofiringEmbeddedStyleR2";
        style.textContent = `
          html.cfv-cofiring-embedded,
          body.cfv-cofiring-embedded {
            min-width: 0 !important;
            width: 100% !important;
            max-width: none !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: hidden !important;
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

      if (doc.documentElement.dataset.cfvOuterScrollBound !== "1") {
        doc.documentElement.dataset.cfvOuterScrollBound = "1";

        const resync = () => scheduleFrameResize(frame);
        doc.addEventListener("click", resync, true);
        doc.addEventListener("change", resync, true);
        doc.addEventListener("input", resync, true);
        doc.addEventListener("submit", resync, true);
      }

      scheduleFrameResize(frame);
    } catch (_) {
      // Same-origin is expected. If access fails, the page still renders.
    }
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
    frame.scrolling = "no";
    frame.src = ROUTE;

    frame.addEventListener("load", () => {
      prepareEmbeddedDocument(frame);
      scheduleFrameResize(frame);
    });

    panel.append(frame);
    return panel;
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

  function findCalcTab(tabs) {
    return (
      Array.from(tabs.children).find((node) =>
        textOf(node).includes("혼소율 계산")
      ) || null
    );
  }

  function isPersistentSheetChild(child, panel) {
    if (!child || child === panel) return true;
    if (child.matches?.(".cfv5-title-row")) return true;
    if (child.matches?.(TOOLBAR_SELECTOR)) return true;
    if (child.querySelector?.(`#${BUTTON_ID}`)) return true;
    return false;
  }

  function toggleSheetSections(sheet, panel, enabled) {
    for (const child of Array.from(sheet.children)) {
      if (isPersistentSheetChild(child, panel)) continue;
      child.classList.toggle(HIDDEN_CLASS, enabled);
    }
  }

  function setManagementMode(root, sheet, tabs, button, panel, enabled) {
    sheet.classList.toggle("cfv-solid-fuel-management-mode", enabled);
    root.classList.toggle("cfv-solid-fuel-management-mode-active", enabled);
    panel.hidden = !enabled;
    button.setAttribute("aria-selected", enabled ? "true" : "false");

    if (enabled) {
      for (const tab of Array.from(tabs.children)) {
        if (tab !== button && tab.matches?.("[aria-selected]")) {
          tab.setAttribute("aria-selected", "false");
        }
      }
    }

    toggleSheetSections(sheet, panel, enabled);

    const frame = panel.querySelector(`#${FRAME_ID}`);
    if (enabled && frame) {
      prepareEmbeddedDocument(frame);
      scheduleFrameResize(frame);
    }
  }

  function bind(root, sheet, tabs, button, panel) {
    if (tabs.dataset.cfvSolidFuelManagementBound === "1") return;
    tabs.dataset.cfvSolidFuelManagementBound = "1";

    tabs.addEventListener("click", (event) => {
      const clicked = event.target.closest(".cfv12-tab, .cfv-top-tab-v2");
      if (!clicked || !tabs.contains(clicked)) return;

      if (clicked === button) {
        event.preventDefault();
        setManagementMode(root, sheet, tabs, button, panel, true);
        return;
      }

      setManagementMode(root, sheet, tabs, button, panel, false);
    });

    window.addEventListener("resize", () => {
      if (!sheet.classList.contains("cfv-solid-fuel-management-mode")) return;
      const frame = panel.querySelector(`#${FRAME_ID}`);
      if (frame) scheduleFrameResize(frame);
    });
  }

  function enhance() {
    // Login-safe: no co-firing root means no work.
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
      const toolbar = tabs.closest(TOOLBAR_SELECTOR);
      const anchor = toolbar || tabs;
      anchor.insertAdjacentElement("afterend", panel);
    }

    bind(root, sheet, tabs, button, panel);
    classifyTabs(tabs);

    if (!sheet.classList.contains("cfv-solid-fuel-management-mode")) {
      toggleSheetSections(sheet, panel, false);
    }

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
