(() => {
  "use strict";

  /* COFIRING TAB CONTENT TYPOGRAPHY V2 */
  const ROOT_SELECTOR = "[data-cofiring-draft-root]";
  const FRAME_ID = "cfvSolidFuelManagementFrame";
  const REF_TITLE = "고형연료 관리";
  const REF_SUBTITLE_KEY = "하역시간과 Trouble";
  const REF_EYEBROW_A = "GS SHIFT LOG";
  const REF_EYEBROW_B = "SOLID FUEL";

  function textOf(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function allTextNodes(doc) {
    return Array.from(
      doc.querySelectorAll("h1,h2,h3,h4,h5,strong,small,span,p,div")
    );
  }

  function exactText(doc, expected) {
    return (
      allTextNodes(doc).find((node) => textOf(node) === expected) || null
    );
  }

  function includesText(doc, a, b = "") {
    return (
      allTextNodes(doc).find((node) => {
        const text = textOf(node);
        return text.includes(a) && (!b || text.includes(b));
      }) || null
    );
  }

  function copyComputed(root, prefix, node) {
    if (!root || !node) return false;

    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    const values = {
      "font-family": style.fontFamily,
      "font-size": style.fontSize,
      "font-weight": style.fontWeight,
      "line-height": style.lineHeight,
      "letter-spacing": style.letterSpacing,
      color: style.color
    };

    for (const [name, value] of Object.entries(values)) {
      if (!value) continue;
      root.style.setProperty(`--cfv-ref-${prefix}-${name}`, value);
    }

    return true;
  }

  function syncReferenceTypography(root) {
    const frame = document.getElementById(FRAME_ID);
    if (!frame) return false;
    // Keep the existing parent CSS typography stable while the embedded tab loads.
    if (frame.dataset.cfvStableLayout === "1") return false;

    try {
      const doc = frame.contentDocument;
      if (!doc) return false;

      const eyebrow = includesText(doc, REF_EYEBROW_A, REF_EYEBROW_B);
      const title = exactText(doc, REF_TITLE);
      const subtitle = includesText(doc, REF_SUBTITLE_KEY);

      let copied = false;
      copied = copyComputed(root, "eyebrow", eyebrow) || copied;
      copied = copyComputed(root, "title", title) || copied;
      copied = copyComputed(root, "subtitle", subtitle) || copied;
      return copied;
    } catch (_) {
      return false;
    }
  }

  function decorateMainTitle(root) {
    const eyebrow = root.querySelector(".cfv5-title-copy .cfv5-eyebrow");
    const title = root.querySelector(".cfv5-title-copy h2");
    const subtitle = root.querySelector(".cfv5-title-copy p");

    eyebrow?.classList.add("cfv-ref-eyebrow-v2");
    title?.classList.add("cfv-ref-title-v2");
    subtitle?.classList.add("cfv-ref-subtitle-v2");
  }

  function decorateClosedHistory(root) {
    const head = root.querySelector(".cfv12-history-head");
    if (!head) return;

    const title = head.querySelector("strong");
    const subtitle =
      title?.parentElement?.querySelector(":scope > span") ||
      head.querySelector("span");

    title?.classList.add("cfv-ref-title-v2");
    subtitle?.classList.add("cfv-ref-subtitle-v2");
  }

  function decorateSettingsHistory(root) {
    const title = allTextNodes(root).find(
      (node) => textOf(node) === "발열량 저장 이력"
    );

    if (!title) return;

    title.classList.add("cfv-ref-title-v2");

    const parent = title.parentElement;
    if (!parent) return;

    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(title);

    for (let i = index + 1; i < siblings.length; i += 1) {
      const node = siblings[i];
      const text = textOf(node);

      if (!text) continue;
      if (node.matches("button")) continue;
      if (node.querySelector?.("button,input,select,table")) continue;

      node.classList.add("cfv-ref-subtitle-v2");
      break;
    }
  }

  function decorate(root) {
    if (!root) return false;

    decorateMainTitle(root);
    decorateClosedHistory(root);
    decorateSettingsHistory(root);
    syncReferenceTypography(root);

    return true;
  }

  function bindFrame(root) {
    const frame = document.getElementById(FRAME_ID);
    if (!frame || frame.dataset.cfvTypographyReferenceBound === "1") return;

    frame.dataset.cfvTypographyReferenceBound = "1";
    frame.addEventListener("load", () => {
      for (const delay of [0, 120, 450]) {
        window.setTimeout(() => decorate(root), delay);
      }
    });
  }

  function enhance() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return false;

    bindFrame(root);
    return decorate(root);
  }

  function scheduleEnhance() {
    window.setTimeout(enhance, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }

  // Deliberately no MutationObserver: keep login/startup safe.
  document.addEventListener("click", scheduleEnhance, true);
  window.addEventListener("focus", scheduleEnhance);

  for (const delay of [120, 350, 800, 1500, 3000, 6000]) {
    window.setTimeout(enhance, delay);
  }
})();
