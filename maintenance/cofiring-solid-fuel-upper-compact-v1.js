(() => {
  "use strict";

  /* COFIRING SOLID FUEL UPPER COMPACT V1 */
  const FRAME_ID = "cfvSolidFuelManagementFrame";
  const STYLE_ID = "cfvSolidFuelUpperCompactStyleV1";

  function textOf(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function all(doc, selector = "body *") {
    return Array.from(doc.querySelectorAll(selector));
  }

  function findExact(doc, expected) {
    return (
      all(doc, "h1,h2,h3,h4,strong,span,p,label,button,div").find(
        (node) => textOf(node) === expected
      ) || null
    );
  }

  function findIncludes(doc, expected) {
    return (
      all(doc, "h1,h2,h3,h4,strong,span,p,label,button,div").find(
        (node) => textOf(node).includes(expected)
      ) || null
    );
  }

  function containsAll(node, parts) {
    const text = textOf(node);
    return parts.every((part) => text.includes(part));
  }

  function smallestAncestor(node, parts, maxDepth = 7) {
    let current = node;
    let best = null;

    for (let depth = 0; current && depth <= maxDepth; depth += 1) {
      if (
        current.nodeType === 1 &&
        current.tagName !== "BODY" &&
        containsAll(current, parts)
      ) {
        best = current;
      }

      current = current.parentElement;
    }

    return best;
  }

  function addClass(node, className) {
    if (!node) return false;
    node.classList.add(className);
    return true;
  }

  function ensureStyle(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;

    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.cfv-cofiring-embedded body.cfv-cofiring-embedded {
        padding-top: 6px !important;
      }

      .cfv-sfm-upper-header-v1 {
        min-height: 0 !important;
        margin: 0 0 8px !important;
        padding: 6px 8px 7px !important;
        gap: 4px !important;
      }

      .cfv-sfm-upper-header-v1 h1,
      .cfv-sfm-upper-header-v1 h2 {
        margin: 0 0 2px !important;
        font-size: 22px !important;
        line-height: 1.02 !important;
      }

      .cfv-sfm-upper-header-v1 p,
      .cfv-sfm-upper-header-v1 small,
      .cfv-sfm-upper-header-v1 span {
        margin-top: 1px !important;
        margin-bottom: 1px !important;
        line-height: 1.2 !important;
      }

      .cfv-sfm-filter-panel-v1 {
        min-height: 0 !important;
        margin: 0 0 8px !important;
        padding: 8px 10px !important;
        gap: 6px 8px !important;
        border-radius: 9px !important;
      }

      .cfv-sfm-filter-panel-v1 label {
        margin: 0 !important;
        gap: 2px !important;
        font-size: 9px !important;
        line-height: 1.1 !important;
      }

      .cfv-sfm-filter-panel-v1 input,
      .cfv-sfm-filter-panel-v1 select,
      .cfv-sfm-filter-panel-v1 button {
        min-height: 28px !important;
        height: 28px !important;
        padding: 3px 7px !important;
        font-size: 9.5px !important;
        line-height: 1 !important;
        border-radius: 6px !important;
      }

      .cfv-sfm-filter-panel-v1 [role="group"] {
        gap: 4px !important;
      }

      .cfv-sfm-filter-panel-v1 > *,
      .cfv-sfm-filter-panel-v1 > * > * {
        margin-top: 0 !important;
        margin-bottom: 0 !important;
      }

      .cfv-sfm-kpi-panel-v1 {
        min-height: 0 !important;
        margin: 0 0 8px !important;
        padding: 0 !important;
        border-radius: 9px !important;
      }

      .cfv-sfm-kpi-panel-v1 > * {
        min-height: 44px !important;
        padding: 7px 10px !important;
      }

      .cfv-sfm-kpi-panel-v1 strong {
        line-height: 1.05 !important;
      }

      .cfv-sfm-kpi-panel-v1 span,
      .cfv-sfm-kpi-panel-v1 small {
        line-height: 1.1 !important;
      }

      .cfv-sfm-reference-panel-v1 {
        min-height: 0 !important;
        margin: 0 0 7px !important;
        padding: 0 !important;
        border-radius: 9px !important;
      }

      .cfv-sfm-reference-panel-v1 > header,
      .cfv-sfm-reference-panel-v1 > div:first-child {
        min-height: 0 !important;
        padding: 7px 10px !important;
        margin: 0 !important;
      }

      .cfv-sfm-reference-panel-v1 h2,
      .cfv-sfm-reference-panel-v1 h3,
      .cfv-sfm-reference-panel-v1 strong {
        margin-top: 0 !important;
        margin-bottom: 2px !important;
        line-height: 1.1 !important;
      }

      .cfv-sfm-reference-panel-v1 p,
      .cfv-sfm-reference-panel-v1 small,
      .cfv-sfm-reference-panel-v1 span {
        line-height: 1.15 !important;
      }

      .cfv-sfm-reference-panel-v1 > *:not(header):not(:first-child) {
        min-height: 0 !important;
      }

      .cfv-sfm-reference-panel-v1 [class*="grid"],
      .cfv-sfm-reference-panel-v1 [class*="body"],
      .cfv-sfm-reference-panel-v1 [class*="content"] {
        gap: 7px !important;
        padding: 7px 10px !important;
      }

      .cfv-sfm-reference-panel-v1 [class*="chart"],
      .cfv-sfm-reference-panel-v1 [class*="empty"],
      .cfv-sfm-reference-panel-v1 [class*="card"] {
        min-height: 42px !important;
        padding: 7px 9px !important;
      }

      .cfv-sfm-record-tabs-v1 {
        min-height: 0 !important;
        margin: 0 0 5px !important;
        gap: 4px !important;
      }

      .cfv-sfm-record-tabs-v1 button,
      .cfv-sfm-record-tabs-v1 [role="tab"] {
        min-height: 27px !important;
        height: 27px !important;
        padding: 3px 9px !important;
        font-size: 9.5px !important;
        line-height: 1 !important;
        border-radius: 6px !important;
      }
    `;

    (doc.head || doc.documentElement).appendChild(style);
  }

  function markSections(doc) {
    ensureStyle(doc);

    const title = findExact(doc, "고형연료 관리");
    const subtitle = findIncludes(
      doc,
      "하역시간과 Trouble을 같은 기준으로 기록하고 월·기간별로 조회합니다."
    );

    const headerSeed = title || subtitle;
    if (headerSeed) {
      const header =
        headerSeed.closest("header") ||
        smallestAncestor(headerSeed, ["고형연료 관리", "Trouble"], 5);
      addClass(header, "cfv-sfm-upper-header-v1");
    }

    const month = findExact(doc, "조회 월");
    if (month) {
      const filter = smallestAncestor(
        month,
        ["조회 월", "업체명", "차량번호", "통합 검색", "정렬"],
        7
      );
      addClass(filter, "cfv-sfm-filter-panel-v1");
    }

    const average = findExact(doc, "평균 하역");
    if (average) {
      const kpi = smallestAncestor(
        average,
        ["하역", "평균 하역", "Trouble", "이상·막힘", "최장 하역"],
        7
      );
      addClass(kpi, "cfv-sfm-kpi-panel-v1");
    }

    const referenceTitle = findIncludes(doc, "하역시간 참고 데이터");
    if (referenceTitle) {
      const reference = smallestAncestor(
        referenceTitle,
        ["하역시간 참고 데이터", "업체별 하역시간", "Silo별 평균"],
        7
      );
      addClass(reference, "cfv-sfm-reference-panel-v1");
    }

    const unloadTab = findExact(doc, "하역 기록");
    if (unloadTab) {
      const tabs = smallestAncestor(
        unloadTab,
        ["하역 기록", "Trouble 내역"],
        5
      );
      addClass(tabs, "cfv-sfm-record-tabs-v1");
    }

    return true;
  }

  function enhanceFrame() {
    const frame = document.getElementById(FRAME_ID);
    if (!frame) return false;

    try {
      const doc = frame.contentDocument;
      if (!doc) return false;
      return markSections(doc);
    } catch (_) {
      return false;
    }
  }

  // The embedded host applies these styles synchronously before revealing it.
  window.CofiringSolidFuelCompact = { prepare: markSections };

  function bindFrame() {
    const frame = document.getElementById(FRAME_ID);
    if (!frame || frame.dataset.cfvUpperCompactBound === "1") return;

    frame.dataset.cfvUpperCompactBound = "1";
    frame.addEventListener("load", () => {
      if (frame.dataset.cfvStableLayout === "1") return;
      for (const delay of [0, 80, 220, 500, 1000]) {
        window.setTimeout(enhanceFrame, delay);
      }
    });
  }

  function enhance() {
    bindFrame();
    return enhanceFrame();
  }

  function scheduleEnhance() {
    window.setTimeout(enhance, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }

  // No MutationObserver: keep login/startup behavior safe.
  document.addEventListener("click", scheduleEnhance, true);
  window.addEventListener("focus", scheduleEnhance);

  for (const delay of [120, 350, 800, 1500, 3000, 6000]) {
    window.setTimeout(enhance, delay);
  }
})();
