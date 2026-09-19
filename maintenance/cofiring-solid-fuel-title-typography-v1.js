(() => {
  "use strict";

  /* COFIRING SOLID FUEL TITLE TYPOGRAPHY V1 */
  const STYLE_ID = "cfvSolidFuelTitleTypographyStyleV1";
  const FRAME_ID = "cfvSolidFuelManagementFrame";
  const TITLE_TEXT = "고형연료 관리";
  const SUBTITLE_KEY = "하역시간과 Trouble";
  const EYEBROW_KEY_A = "GS SHIFT LOG";
  const EYEBROW_KEY_B = "SOLID FUEL";

  function textOf(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function ensureStyle(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .cfv-sfm-eyebrow-v1 {
        display: block !important;
        margin: 0 0 8px !important;
        color: #607e96 !important;
        font-size: 11px !important;
        line-height: 1.2 !important;
        font-weight: 900 !important;
        letter-spacing: 0.16em !important;
        text-transform: uppercase !important;
      }

      .cfv-sfm-title-v1 {
        display: block !important;
        margin: 0 !important;
        color: #153654 !important;
        font-size: 26px !important;
        line-height: 1.08 !important;
        font-weight: 900 !important;
        letter-spacing: -0.03em !important;
      }

      .cfv-sfm-subtitle-v1 {
        display: block !important;
        margin: 8px 0 0 !important;
        color: #678095 !important;
        font-size: 12.5px !important;
        line-height: 1.5 !important;
        font-weight: 700 !important;
        letter-spacing: -0.01em !important;
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function queryAllTextNodes(doc) {
    return Array.from(doc.querySelectorAll('h1,h2,h3,h4,strong,small,span,div,p'));
  }

  function findByExactText(doc, expected) {
    return queryAllTextNodes(doc).find((node) => textOf(node) === expected) || null;
  }

  function findByIncludes(doc, a, b) {
    return queryAllTextNodes(doc).find((node) => {
      const text = textOf(node);
      return text.includes(a) && (!b || text.includes(b));
    }) || null;
  }

  function decorateDocument(doc) {
    if (!doc) return false;
    ensureStyle(doc);

    const title = findByExactText(doc, TITLE_TEXT);
    if (!title) return false;
    title.classList.add('cfv-sfm-title-v1');

    const subtitle = findByIncludes(doc, SUBTITLE_KEY);
    if (subtitle) subtitle.classList.add('cfv-sfm-subtitle-v1');

    const eyebrow = findByIncludes(doc, EYEBROW_KEY_A, EYEBROW_KEY_B);
    if (eyebrow) eyebrow.classList.add('cfv-sfm-eyebrow-v1');

    return true;
  }

  function decorateEmbeddedFrame() {
    const frame = document.getElementById(FRAME_ID);
    if (!frame) return false;
    try {
      const doc = frame.contentDocument;
      if (!doc) return false;
      return decorateDocument(doc);
    } catch (_) {
      return false;
    }
  }

  function enhance() {
    let changed = false;
    changed = decorateDocument(document) || changed;
    changed = decorateEmbeddedFrame() || changed;
    return changed;
  }

  function bindFrame() {
    const frame = document.getElementById(FRAME_ID);
    if (!frame || frame.dataset.cfvTitleTypographyBound === '1') return;
    frame.dataset.cfvTitleTypographyBound = '1';
    frame.addEventListener('load', () => {
      window.setTimeout(enhance, 0);
      window.setTimeout(enhance, 120);
      window.setTimeout(enhance, 500);
    });
  }

  function scheduleEnhance() {
    bindFrame();
    window.setTimeout(enhance, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleEnhance, { once: true });
  } else {
    scheduleEnhance();
  }

  document.addEventListener('click', scheduleEnhance, true);
  window.addEventListener('focus', scheduleEnhance);
  [120, 350, 800, 1500, 3000, 6000].forEach((delay) => window.setTimeout(scheduleEnhance, delay));
})();
