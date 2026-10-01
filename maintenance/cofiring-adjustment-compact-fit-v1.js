/* COFIRING_ADJUSTMENT_COMPACT_FIT_V1
 *
 * Goal:
 * Make the cofiring adjustment modal compact enough to be readable
 * on one screen without excessive scrolling.
 *
 * UI only. No calculation / apply logic changes.
 */
(function installCofiringAdjustmentCompactFit(root) {
  "use strict";

  if (!root || !root.document) return;

  const VERSION = "20261002-r10";
  const STYLE_ID = "cofiring-adjustment-compact-fit-v1-style";
  const ROOT_ATTR = "data-cofiring-adjustment-compact-root";
  const CARD_ATTR = "data-cofiring-adjustment-compact-card";
  const TOPGRID_ATTR = "data-cofiring-adjustment-compact-topgrid";
  const FOOTER_ATTR = "data-cofiring-adjustment-compact-footer";
  const TITLE_ATTR = "data-cofiring-adjustment-compact-title";
  const SUBTITLE_ATTR = "data-cofiring-adjustment-compact-subtitle";

  function normalize(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function containsText(element, needle) {
    return normalize(element?.textContent).includes(needle);
  }

  function matchesAnyText(element, needles) {
    return needles.some(needle => containsText(element, needle));
  }

  function queryTextNodes() {
    return Array.from(
      root.document.querySelectorAll(
        "h1,h2,h3,h4,p,strong,span,div,button,label"
      )
    );
  }

  function closestDialog(node) {
    return node?.closest?.(
      '[role="dialog"], dialog, .modal, .modal__content, .modal-content, .MuiDialog-paper'
    ) || null;
  }

  function bestCard(node, modal) {
    let current = node;
    let candidate = null;

    while (current && current !== modal && current !== root.document.body) {
      const rect = current.getBoundingClientRect();
      if (rect.width >= 180 && rect.height >= 60) {
        candidate = current;
      }
      current = current.parentElement;
    }

    return candidate || node?.parentElement || null;
  }

  function commonAncestor(a, b, stop) {
    if (!a || !b) return null;
    const seen = new Set();
    let x = a;
    while (x) {
      seen.add(x);
      if (x === stop) break;
      x = x.parentElement;
    }
    let y = b;
    while (y) {
      if (seen.has(y)) return y;
      if (y === stop) break;
      y = y.parentElement;
    }
    return null;
  }

  function findNodeByText(needles) {
    return queryTextNodes().find(node => matchesAnyText(node, needles)) || null;
  }

  function markIfPresent(element, attr) {
    if (element) element.setAttribute(attr, "true");
  }

  function injectStyle() {
    if (root.document.getElementById(STYLE_ID)) return;

    const style = root.document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
[${ROOT_ATTR}="true"]{
  width:min(1120px, calc(100vw - 24px)) !important;
  max-width:min(1120px, calc(100vw - 24px)) !important;
  max-height:calc(100vh - 24px) !important;
  min-height:unset !important;
  height:auto !important;
  padding:16px 18px 14px !important;
  overflow:auto !important;
  border-radius:24px !important;
  box-sizing:border-box !important;
}

[${ROOT_ATTR}="true"] *{
  box-sizing:border-box;
}

[${ROOT_ATTR}="true"] [${TITLE_ATTR}="true"]{
  font-size:clamp(34px, 4.8vw, 58px) !important;
  line-height:1.02 !important;
  letter-spacing:-0.02em !important;
  margin:0 0 8px !important;
}

[${ROOT_ATTR}="true"] [${SUBTITLE_ATTR}="true"]{
  font-size:14px !important;
  line-height:1.45 !important;
  margin:0 0 10px !important;
}

[${ROOT_ATTR}="true"] [${TOPGRID_ATTR}="true"]{
  display:grid !important;
  grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) !important;
  gap:12px !important;
  align-items:stretch !important;
  margin-bottom:10px !important;
}

[${ROOT_ATTR}="true"] [${CARD_ATTR}="true"]{
  padding:14px 16px !important;
  border-radius:18px !important;
  min-height:auto !important;
  margin:0 !important;
}

[${ROOT_ATTR}="true"] h2,
[${ROOT_ATTR}="true"] h3{
  font-size:18px !important;
  line-height:1.2 !important;
  margin:0 0 8px !important;
}

[${ROOT_ATTR}="true"] p,
[${ROOT_ATTR}="true"] li,
[${ROOT_ATTR}="true"] label,
[${ROOT_ATTR}="true"] small{
  font-size:14px !important;
  line-height:1.45 !important;
}

[${ROOT_ATTR}="true"] button{
  min-height:42px !important;
  height:42px !important;
  padding:0 16px !important;
  border-radius:14px !important;
  font-size:16px !important;
}

[${ROOT_ATTR}="true"] input,
[${ROOT_ATTR}="true"] select,
[${ROOT_ATTR}="true"] textarea{
  min-height:42px !important;
  height:42px !important;
  padding:0 12px !important;
  font-size:16px !important;
  border-radius:14px !important;
}

[${ROOT_ATTR}="true"] table{
  font-size:15px !important;
}

[${ROOT_ATTR}="true"] th,
[${ROOT_ATTR}="true"] td{
  padding:10px 12px !important;
  line-height:1.35 !important;
}

[${ROOT_ATTR}="true"] [${FOOTER_ATTR}="true"]{
  display:flex !important;
  align-items:center !important;
  justify-content:space-between !important;
  gap:12px !important;
  padding-top:8px !important;
  margin-top:10px !important;
}

[${ROOT_ATTR}="true"] [${FOOTER_ATTR}="true"] > *{
  flex:0 0 auto !important;
}

[${ROOT_ATTR}="true"] [${FOOTER_ATTR}="true"] > :last-child{
  margin-left:auto !important;
}

[${ROOT_ATTR}="true"] [${FOOTER_ATTR}="true"] button{
  min-width:112px !important;
}

[${ROOT_ATTR}="true"] .cofiring-adjustment-compact-hide-overflow{
  overflow:hidden !important;
}

[${ROOT_ATTR}="true"] [data-cofiring-adjustment-inline-actions="true"]{
  display:grid !important;
  grid-template-columns:1fr 1fr !important;
  gap:10px !important;
}

[${ROOT_ATTR}="true"] [data-cofiring-adjustment-inline-actions="true"] button{
  width:100% !important;
}

@media (max-height: 860px){
  [${ROOT_ATTR}="true"]{
    padding:12px 14px 12px !important;
    max-height:calc(100vh - 16px) !important;
  }

  [${ROOT_ATTR}="true"] [${TITLE_ATTR}="true"]{
    font-size:clamp(28px, 4vw, 44px) !important;
    margin-bottom:6px !important;
  }

  [${ROOT_ATTR}="true"] [${CARD_ATTR}="true"]{
    padding:12px 14px !important;
  }

  [${ROOT_ATTR}="true"] button,
  [${ROOT_ATTR}="true"] input,
  [${ROOT_ATTR}="true"] select{
    min-height:38px !important;
    height:38px !important;
    font-size:15px !important;
  }

  [${ROOT_ATTR}="true"] th,
  [${ROOT_ATTR}="true"] td{
    padding:8px 10px !important;
  }
}

@media (max-width: 980px){
  [${ROOT_ATTR}="true"] [${TOPGRID_ATTR}="true"]{
    grid-template-columns:1fr !important;
  }
}
`;

    root.document.head.appendChild(style);
  }

  function markModal() {
    const titleNode = findNodeByText(["혼소 조정", "CO-FIRING ADJUSTMENT"]);
    if (!titleNode) return false;

    const modal = closestDialog(titleNode) || bestCard(titleNode, root.document.body);
    if (!modal) return false;

    modal.setAttribute(ROOT_ATTR, "true");

    markIfPresent(titleNode, TITLE_ATTR);

    const subtitleNode = queryTextNodes().find(node =>
      containsText(node, "Bio 이동과 최대혼소 조정 결과를 적용 전에 확인합니다.")
    );
    if (subtitleNode && modal.contains(subtitleNode)) {
      markIfPresent(subtitleNode, SUBTITLE_ATTR);
    }

    const periodNode = findNodeByText(["선택 기간"]);
    const maxNode = findNodeByText(["호기당 Bio 최대량"]);
    const periodCard = periodNode && modal.contains(periodNode) ? bestCard(periodNode, modal) : null;
    const maxCard = maxNode && modal.contains(maxNode) ? bestCard(maxNode, modal) : null;

    if (periodCard) markIfPresent(periodCard, CARD_ATTR);
    if (maxCard) markIfPresent(maxCard, CARD_ATTR);

    const topGrid = commonAncestor(periodCard, maxCard, modal);
    if (topGrid && topGrid !== modal) {
      topGrid.setAttribute(TOPGRID_ATTR, "true");
    }

    const manualNode = findNodeByText(["수동 이동"]);
    const autoNode = findNodeByText(["최대혼소 자동 조정"]);
    const noticeNode = findNodeByText(["조정 전 계산값입니다."]);
    const finalNode = findNodeByText(["최종 조정값"]);

    [manualNode, autoNode, noticeNode, finalNode].forEach(node => {
      if (node && modal.contains(node)) {
        const card = bestCard(node, modal);
        markIfPresent(card, CARD_ATTR);
      }
    });

    const moveBtnA = queryTextNodes().find(node =>
      containsText(node, "1호기 → 2호기")
    )?.closest("button");
    const moveBtnB = queryTextNodes().find(node =>
      containsText(node, "2호기 → 1호기")
    )?.closest("button");
    const actionsWrap = commonAncestor(moveBtnA, moveBtnB, modal);
    if (actionsWrap && actionsWrap !== modal) {
      actionsWrap.setAttribute("data-cofiring-adjustment-inline-actions", "true");
    }

    const footerButtons = Array.from(modal.querySelectorAll("button")).filter(button => {
      const text = normalize(button.textContent);
      return text === "원복" || text === "취소" || text === "적용";
    });

    if (footerButtons.length >= 2) {
      const footer = footerButtons
        .map(button => button.parentElement)
        .find(parent => parent && footerButtons.every(btn => parent.contains(btn)))
        || commonAncestor(footerButtons[0], footerButtons[footerButtons.length - 1], modal);

      markIfPresent(footer, FOOTER_ATTR);
    }

    return true;
  }

  function apply() {
    injectStyle();
    return markModal();
  }

  const api = Object.freeze({
    version: VERSION,
    apply
  });

  root.cofiringAdjustmentCompactFit = api;

  function boot() {
    apply();

    if (typeof root.MutationObserver === "function") {
      const observer = new root.MutationObserver(() => {
        apply();
      });

      observer.observe(root.document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  if (root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(
  typeof window === "object" ? window : globalThis
);
