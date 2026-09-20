(() => {
  "use strict";

  const INSTALL_FLAG = "__cfhOperatorCloseDetailV4Installed";
  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const ROOT_SELECTOR = "#efficiencyCofiringDraftView";
  const BASIS_TITLES = ["마감 계산 기준값", "마감 당시 발열량 · 보정계수"];
  const META_TITLES = ["마감 정보"];
  const META_KEYS = ["마감자", "마감 시각", "Revision", "스냅샷 생성", "DataPARC 요청"];

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

  function smallestMetaItem(labelElement, metaCard) {
    let node = labelElement?.parentElement;
    for (let depth = 0; node && node !== metaCard && depth < 6; depth += 1, node = node.parentElement) {
      const text = normalize(node.textContent);
      const label = normalize(labelElement.textContent);
      if (text.includes(label) && text.length <= 280 && node.children.length <= 8) {
        return node;
      }
    }
    return labelElement?.parentElement || null;
  }

  function valueFromItem(item, label) {
    if (!item) return "";
    const full = normalize(item.textContent);
    return normalize(full.replace(label, ""));
  }

  function parseBasisData(basisCard) {
    const table = basisCard.querySelector("table");
    if (!table) return null;

    const defaultHeaders = ["연료", "1호기 발열량", "1호기 보정", "2호기 발열량", "2호기 보정"];
    const theadCells = Array.from(table.querySelectorAll("thead th"))
      .map((cell) => normalize(cell.textContent))
      .filter(Boolean);
    const headers = theadCells.length >= 5 ? theadCells.slice(0, 5) : defaultHeaders;

    const rows = Array.from(table.querySelectorAll("tbody tr"))
      .map((row) => Array.from(row.children).map((cell) => normalize(cell.textContent)))
      .filter((cells) => {
        if (cells.length < 5) return false;
        const first = normalize(cells[0]);
        if (!first || first === "연료") return false;
        const joined = cells.slice(0, 5).map(normalize);
        const isRepeatedHeader = joined.every((value, index) => value === headers[index]);
        return !isRepeatedHeader;
      })
      .map((cells) => ({
        fuel: cells[0],
        unit1Heat: cells[1],
        unit1Adj: cells[2],
        unit2Heat: cells[3],
        unit2Adj: cells[4],
      }));

    if (!rows.length) return null;
    return {
      headers: {
        fuel: headers[0] || defaultHeaders[0],
        unit1Heat: headers[1] || defaultHeaders[1],
        unit1Adj: headers[2] || defaultHeaders[2],
        unit2Heat: headers[3] || defaultHeaders[3],
        unit2Adj: headers[4] || defaultHeaders[4],
      },
      rows,
    };
  }

  function parseMetaData(metaCard) {
    const data = {};
    for (const key of META_KEYS) {
      const labelElement = exactTextElement(metaCard, [key]);
      if (!labelElement) continue;
      const item = smallestMetaItem(labelElement, metaCard);
      data[key] = valueFromItem(item, key);
    }

    const calcControl =
      Array.from(metaCard.querySelectorAll("button, a")).find((element) =>
        normalize(element.textContent).includes("계산")
      ) || null;

    return { data, calcControl };
  }

  function ensureGridLayout(basisCard, metaCard) {
    const common = lowestCommonAncestor(basisCard, metaCard);
    if (!common) return;
    const basisBranch = branchBelow(common, basisCard);
    const metaBranch = branchBelow(common, metaCard);
    if (!basisBranch || !metaBranch || basisBranch === metaBranch) return;

    common.classList.add("cfh-v4-detail-grid");
    basisBranch.classList.add("cfh-v4-detail-branch");
    metaBranch.classList.add("cfh-v4-detail-branch");
  }

  function prepareCard(card, titleElement, cardClass, title, subtitle) {
    card.classList.add("cfh-v4-card", cardClass);
    titleElement.classList.add("cfh-v4-title");
    titleElement.textContent = title;
    titleElement.dataset.cfhV4Subtitle = subtitle;

    for (const child of Array.from(card.children)) {
      if (child === titleElement) continue;
      if (child.classList.contains("cfh-v4-host")) continue;
      child.classList.add("cfh-v4-hide-original");
    }
  }

  function renderBasisCard(card, titleElement, basisData) {
    if (!basisData) return;
    prepareCard(
      card,
      titleElement,
      "cfh-v4-basis-card",
      "마감 계산 기준값",
      "혼소율 마감 시 적용값"
    );

    let host = card.querySelector(".cfh-v4-basis-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "cfh-v4-host cfh-v4-basis-host";
      card.appendChild(host);
    }

    const h = basisData.headers;
    const rowHtml = basisData.rows.map((row) => `
      <div class="cfh-v4-cell cfh-v4-cell--fuel">${row.fuel}</div>
      <div class="cfh-v4-cell cfh-v4-cell--value">${row.unit1Heat}</div>
      <div class="cfh-v4-cell cfh-v4-cell--value">${row.unit1Adj}</div>
      <div class="cfh-v4-cell cfh-v4-cell--value">${row.unit2Heat}</div>
      <div class="cfh-v4-cell cfh-v4-cell--value">${row.unit2Adj}</div>
    `).join("");

    host.innerHTML = `
      <div class="cfh-v4-basis-grid" role="table" aria-label="마감 계산 기준값">
        <div class="cfh-v4-cell cfh-v4-cell--head">${h.fuel}</div>
        <div class="cfh-v4-cell cfh-v4-cell--head">${h.unit1Heat}</div>
        <div class="cfh-v4-cell cfh-v4-cell--head">${h.unit1Adj}</div>
        <div class="cfh-v4-cell cfh-v4-cell--head">${h.unit2Heat}</div>
        <div class="cfh-v4-cell cfh-v4-cell--head">${h.unit2Adj}</div>
        ${rowHtml}
      </div>
    `;
  }

  function renderMetaCard(card, titleElement, metaData) {
    prepareCard(
      card,
      titleElement,
      "cfh-v4-meta-card",
      "마감 정보",
      "마감 이력 · 계산 추적"
    );

    let host = card.querySelector(".cfh-v4-meta-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "cfh-v4-host cfh-v4-meta-host";
      card.appendChild(host);
    }

    const rows = [
      ["마감자", metaData.data["마감자"] || "-"],
      ["마감 시각", metaData.data["마감 시각"] || "-"],
      ["Revision", metaData.data["Revision"] || "-"],
      ["스냅샷 생성", metaData.data["스냅샷 생성"] || "-"],
      ["DataPARC 요청", metaData.data["DataPARC 요청"] || "-"],
    ];

    host.innerHTML = `
      <div class="cfh-v4-summary">
        ${rows.map(([label, value]) => `
          <div class="cfh-v4-summary-row${label === "DataPARC 요청" ? " cfh-v4-summary-row--request" : ""}">
            <div class="cfh-v4-summary-label">${label}</div>
            <div class="cfh-v4-summary-value">${value}</div>
          </div>
        `).join("")}
      </div>
      <div class="cfh-v4-action-row"></div>
    `;

    const actionRow = host.querySelector(".cfh-v4-action-row");
    if (metaData.calcControl) {
      metaData.calcControl.textContent = "계산 화면 보기";
      metaData.calcControl.classList.add("cfh-v4-action-button");
      actionRow.appendChild(metaData.calcControl);
    }
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

    ensureGridLayout(basisCard, metaCard);
    renderBasisCard(basisCard, basisTitle, parseBasisData(basisCard));
    renderMetaCard(metaCard, metaTitle, parseMetaData(metaCard));
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
