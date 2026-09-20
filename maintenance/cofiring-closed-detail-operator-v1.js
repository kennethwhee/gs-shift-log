(() => {
  "use strict";

  const INSTALL_FLAG = "__cfhOperatorCloseDetailV1Installed";
  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const ROOT_SELECTOR = "#efficiencyCofiringDraftView";
  const BASIS_OLD_TITLE = "마감 당시 발열량 · 보정계수";
  const BASIS_NEW_TITLE = "마감 계산 기준값";
  const META_TITLE = "마감 정보";
  const META_LABELS = ["마감자", "마감 시각", "Revision", "스냅샷 생성", "DataPARC 요청"];

  const normalize = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  function visibleElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function exactTextElement(root, texts) {
    const accepted = new Set(texts.map(normalize));
    for (const element of root.querySelectorAll("*")) {
      if (!visibleElement(element)) continue;
      const text = normalize(element.textContent);
      if (!accepted.has(text)) continue;

      const childOwnsSameText = Array.from(element.children).some(
        (child) => normalize(child.textContent) === text
      );
      if (!childOwnsSameText) return element;
    }
    return null;
  }

  function includesAll(element, texts) {
    const text = normalize(element?.textContent);
    return texts.every((token) => text.includes(token));
  }

  function closestSemanticCard(seed, predicate, maxDepth = 9) {
    let node = seed;
    for (let depth = 0; node && depth <= maxDepth; depth += 1, node = node.parentElement) {
      if (predicate(node)) return node;
    }
    return null;
  }

  function lowestCommonAncestor(a, b) {
    if (!a || !b) return null;
    const seen = new Set();
    for (let node = a; node; node = node.parentElement) seen.add(node);
    for (let node = b; node; node = node.parentElement) {
      if (seen.has(node)) return node;
    }
    return null;
  }

  function branchBelow(ancestor, node) {
    if (!ancestor || !node || ancestor === node) return node;
    let current = node;
    while (current?.parentElement && current.parentElement !== ancestor) {
      current = current.parentElement;
    }
    return current?.parentElement === ancestor ? current : node;
  }

  function smallestMetaItem(labelElement, metaCard) {
    let node = labelElement?.parentElement;
    for (let depth = 0; node && node !== metaCard && depth < 5; depth += 1, node = node.parentElement) {
      const text = normalize(node.textContent);
      const label = normalize(labelElement.textContent);
      if (
        text.includes(label) &&
        text.length <= 260 &&
        node.children.length <= 6
      ) {
        return node;
      }
    }
    return labelElement?.parentElement || null;
  }

  function markMetaItems(metaCard) {
    for (const label of META_LABELS) {
      const labelElement = exactTextElement(metaCard, [label]);
      if (!labelElement) continue;

      labelElement.classList.add("cfh-operator-meta-label");

      const item = smallestMetaItem(labelElement, metaCard);
      if (!item) continue;

      item.classList.add("cfh-operator-meta-item");
      if (label === "DataPARC 요청") {
        item.classList.add("cfh-operator-meta-item--request");
      }
    }

    for (const element of metaCard.querySelectorAll("button, a")) {
      const text = normalize(element.textContent);
      if (
        text.includes("계산완료") ||
        text === "계산 화면 보기"
      ) {
        element.textContent = "계산 화면 보기";
        element.classList.add("cfh-operator-calc-link");

        const parent = element.parentElement;
        if (parent) {
          for (const node of Array.from(parent.childNodes)) {
            if (
              node !== element &&
              node.nodeType === Node.TEXT_NODE &&
              normalize(node.nodeValue) === "이동"
            ) {
              node.nodeValue = "";
            }
          }
        }
      }
    }
  }

  function markBasisTable(basisCard) {
    const table = basisCard.querySelector("table");
    if (!table) return;
    table.classList.add("cfh-operator-basis-table");

    for (
      let node = table.parentElement;
      node && node !== basisCard;
      node = node.parentElement
    ) {
      node.classList.add("cfh-operator-basis-stretch");
    }

    const rows = Array.from(table.querySelectorAll("tbody tr"));
    rows.forEach((row) => row.classList.add("cfh-operator-basis-row"));
  }

  function markTitle(element, kind) {
    if (!element) return;
    element.classList.add("cfh-operator-detail-title");
    element.classList.add(`cfh-operator-detail-title--${kind}`);

    if (kind === "basis") {
      element.textContent = BASIS_NEW_TITLE;
      element.dataset.cfhOperatorSubtitle = "혼소율 마감 시 적용된 발열량 · 보정계수";
    } else {
      element.dataset.cfhOperatorSubtitle = "마감 이력 · 계산 추적 정보";
    }
  }

  function enhance() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root || !visibleElement(root)) return false;

    const basisTitle = exactTextElement(root, [BASIS_OLD_TITLE, BASIS_NEW_TITLE]);
    const metaTitle = exactTextElement(root, [META_TITLE]);
    if (!basisTitle || !metaTitle) return false;

    const basisCard = closestSemanticCard(
      basisTitle,
      (node) =>
        node.querySelector?.("table") &&
        includesAll(node, ["Coal", "Bio", "유기성", "축분"])
    );

    const metaCard = closestSemanticCard(
      metaTitle,
      (node) =>
        includesAll(node, ["마감자", "마감 시각", "Revision", "DataPARC 요청"]) &&
        !node.querySelector?.(".cfh-operator-basis-table")
    );

    if (!basisCard || !metaCard || basisCard === metaCard) return false;

    basisCard.classList.add("cfh-operator-detail-card", "cfh-operator-basis-card");
    metaCard.classList.add("cfh-operator-detail-card", "cfh-operator-meta-card");

    markTitle(basisTitle, "basis");
    markTitle(metaTitle, "meta");
    markBasisTable(basisCard);
    markMetaItems(metaCard);

    const common = lowestCommonAncestor(basisCard, metaCard);
    if (common) {
      const basisBranch = branchBelow(common, basisCard);
      const metaBranch = branchBelow(common, metaCard);
      const directChildren = Array.from(common.children);

      if (
        basisBranch &&
        metaBranch &&
        basisBranch !== metaBranch &&
        directChildren.length <= 4
      ) {
        common.classList.add("cfh-operator-detail-grid");
        basisBranch.classList.add("cfh-operator-detail-branch");
        metaBranch.classList.add("cfh-operator-detail-branch");
      }
    }

    return true;
  }

  let scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target.closest("button,a") : null;
      if (!target) return;
      const text = normalize(target.textContent);
      if (text === "보기" || text === "상세" || text === "상세보기") {
        setTimeout(scheduleEnhance, 0);
        setTimeout(scheduleEnhance, 60);
        setTimeout(scheduleEnhance, 180);
      }
    },
    true
  );

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length)) {
      scheduleEnhance();
    }
  });

  function start() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) {
      setTimeout(start, 120);
      return;
    }
    observer.observe(root, { childList: true, subtree: true });
    enhance();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
