(() => {
  "use strict";

  const INSTALL_FLAG = "__cfhOperatorCloseDetailV5Installed";
  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const ROOT_SELECTOR = "#efficiencyCofiringDraftView";
  const BASIS_TITLES = ["마감 계산 기준값", "마감 당시 발열량 · 보정계수", "계산 발열량 근거"];
  const META_TITLES = ["마감 정보"];

  const normalize = (value) =>
    String(value ?? "")
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

  function closestSemanticCard(seed, predicate, maxDepth = 10) {
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

  function parseHeatingValues(basisCard) {
    const table = basisCard.querySelector("table");
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll("tbody tr"))
      .map((row) => Array.from(row.children).map((cell) => normalize(cell.textContent)))
      .filter((cells) => cells.length >= 5)
      .filter((cells) => normalize(cells[0]) && normalize(cells[0]) !== "연료")
      .map((cells) => ({
        fuel: normalize(cells[0]),
        unit1Heat: normalize(cells[1]),
        unit2Heat: normalize(cells[3]),
      }));

    const wanted = [
      ["Coal", "Coal"],
      ["Bio", "Bio-SRF"],
      ["유기성", "유기성 고형연료"],
      ["축분", "축분"],
    ];

    return wanted.map(([sourceFuel, displayFuel]) => {
      const row = rows.find((item) => item.fuel === sourceFuel);
      if (!row) return null;

      const same = row.unit1Heat === row.unit2Heat;
      return {
        fuel: displayFuel,
        same,
        value: same ? row.unit1Heat : "",
        unit1Heat: row.unit1Heat,
        unit2Heat: row.unit2Heat,
      };
    }).filter(Boolean);
  }

  function renderHeatingStrip(basisCard, values) {
    for (const child of Array.from(basisCard.children)) {
      if (child.classList.contains("cfh-v5-strip-host")) continue;
      child.classList.add("cfh-v5-hide-original");
    }

    basisCard.classList.add("cfh-v5-basis-card");

    let host = basisCard.querySelector(".cfh-v5-strip-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "cfh-v5-strip-host";
      basisCard.appendChild(host);
    }

    host.innerHTML = `
      <div class="cfh-v5-strip-title">
        <span class="cfh-v5-strip-title-main">계산 발열량 근거</span>
        <span class="cfh-v5-strip-title-sub">마감 계산 적용값</span>
      </div>
      <div class="cfh-v5-fuel-row">
        ${values.map((item) => `
          <div class="cfh-v5-fuel-item">
            <span class="cfh-v5-fuel-name">${item.fuel}</span>
            ${
              item.same
                ? `<span class="cfh-v5-fuel-value">${item.value}</span><span class="cfh-v5-fuel-unit">kcal/kg</span>`
                : `<span class="cfh-v5-fuel-split">1호기 ${item.unit1Heat} · 2호기 ${item.unit2Heat}</span><span class="cfh-v5-fuel-unit">kcal/kg</span>`
            }
          </div>
        `).join("")}
      </div>
    `;
  }

  function enhance() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root || !visibleElement(root)) return false;

    const basisTitle = exactTextElement(root, BASIS_TITLES);
    const metaTitle = exactTextElement(root, META_TITLES);
    if (!basisTitle || !metaTitle) return false;

    const basisCard = closestSemanticCard(
      basisTitle,
      (node) => node.querySelector?.("table") && includesAll(node, ["Coal", "Bio", "유기성", "축분"])
    );
    const metaCard = closestSemanticCard(
      metaTitle,
      (node) => includesAll(node, ["마감자", "마감 시각", "Revision", "DataPARC 요청"])
    );
    if (!basisCard || !metaCard || basisCard === metaCard) return false;

    const common = lowestCommonAncestor(basisCard, metaCard);
    if (!common) return false;

    const basisBranch = branchBelow(common, basisCard);
    const metaBranch = branchBelow(common, metaCard);
    if (!basisBranch || !metaBranch || basisBranch === metaBranch) return false;

    common.classList.add("cfh-v5-detail-wrap");
    basisBranch.classList.add("cfh-v5-basis-branch");
    metaBranch.classList.add("cfh-v5-meta-branch-hidden");

    const values = parseHeatingValues(basisCard);
    if (!values.length) return false;

    renderHeatingStrip(basisCard, values);
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

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button,a") : null;
    if (!target) return;
    const text = normalize(target.textContent);
    if (text === "보기" || text === "상세" || text === "상세보기") {
      setTimeout(scheduleEnhance, 0);
      setTimeout(scheduleEnhance, 80);
      setTimeout(scheduleEnhance, 220);
    }
  }, true);

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
