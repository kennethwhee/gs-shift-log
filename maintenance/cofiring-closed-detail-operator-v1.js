(() => {
  "use strict";

  const INSTALL_FLAG = "__cfhOperatorCloseDetailV3Installed";
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
    const headerCells = Array.from(table.querySelectorAll("thead th"))
      .map((cell) => normalize(cell.textContent))
      .filter(Boolean);

    const rows = Array.from(table.querySelectorAll("tbody tr"))
      .map((row) => {
        const cells = Array.from(row.children).map((cell) => normalize(cell.textContent)).filter(Boolean);
        if (cells.length < 5) return null;
        const [fuel, unit1Heat, unit1Adj, unit2Heat, unit2Adj] = cells;
        return { fuel, unit1Heat, unit1Adj, unit2Heat, unit2Adj };
      })
      .filter(Boolean);

    if (!headerCells.length || !rows.length) return null;
    return {
      headers: {
        fuel: headerCells[0] || "연료",
        unit1Heat: headerCells[1] || "1호기 발열량",
        unit1Adj: headerCells[2] || "1호기 보정",
        unit2Heat: headerCells[3] || "2호기 발열량",
        unit2Adj: headerCells[4] || "2호기 보정",
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

    const calcControl = Array.from(metaCard.querySelectorAll("button, a")).find((element) =>
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

    common.classList.add("cfh-v3-detail-grid");
    basisBranch.classList.add("cfh-v3-detail-branch");
    metaBranch.classList.add("cfh-v3-detail-branch");
  }

  function resetCard(card, titleElement, cardClass) {
    card.classList.add("cfh-v3-card", cardClass);
    titleElement.classList.add("cfh-v3-title");
    if (cardClass === "cfh-v3-basis-card") {
      titleElement.dataset.cfhV3Subtitle = "혼소율 마감 시 적용된 발열량 · 보정계수";
      titleElement.textContent = "마감 계산 기준값";
    } else {
      titleElement.dataset.cfhV3Subtitle = "마감 이력 · 계산 추적 정보";
      titleElement.textContent = "마감 정보";
    }

    for (const child of Array.from(card.children)) {
      if (child === titleElement) continue;
      child.classList.add("cfh-v3-hide-original");
    }
  }

  function renderBasisCard(card, titleElement, basisData) {
    if (!basisData) return;
    resetCard(card, titleElement, "cfh-v3-basis-card");

    let host = card.querySelector(".cfh-v3-basis-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "cfh-v3-basis-host";
      card.appendChild(host);
    }

    const h = basisData.headers;
    const rowHtml = basisData.rows.map((row) => `
      <div class="cfh-v3-cell cfh-v3-cell--fuel">${row.fuel}</div>
      <div class="cfh-v3-cell cfh-v3-cell--value">${row.unit1Heat}</div>
      <div class="cfh-v3-cell cfh-v3-cell--value">${row.unit1Adj}</div>
      <div class="cfh-v3-cell cfh-v3-cell--value">${row.unit2Heat}</div>
      <div class="cfh-v3-cell cfh-v3-cell--value">${row.unit2Adj}</div>
    `).join("");

    host.innerHTML = `
      <div class="cfh-v3-basis-grid" role="table" aria-label="마감 계산 기준값">
        <div class="cfh-v3-cell cfh-v3-cell--head">${h.fuel}</div>
        <div class="cfh-v3-cell cfh-v3-cell--head">${h.unit1Heat}</div>
        <div class="cfh-v3-cell cfh-v3-cell--head">${h.unit1Adj}</div>
        <div class="cfh-v3-cell cfh-v3-cell--head">${h.unit2Heat}</div>
        <div class="cfh-v3-cell cfh-v3-cell--head">${h.unit2Adj}</div>
        ${rowHtml}
      </div>
    `;
  }

  function renderMetaCard(card, titleElement, metaData) {
    resetCard(card, titleElement, "cfh-v3-meta-card");

    let host = card.querySelector(".cfh-v3-meta-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "cfh-v3-meta-host";
      card.appendChild(host);
    }

    host.innerHTML = `
      <div class="cfh-v3-meta-grid">
        <div class="cfh-v3-meta-tile">
          <div class="cfh-v3-meta-label">마감자</div>
          <div class="cfh-v3-meta-value">${metaData.data["마감자"] || "-"}</div>
        </div>
        <div class="cfh-v3-meta-tile">
          <div class="cfh-v3-meta-label">마감 시각</div>
          <div class="cfh-v3-meta-value">${metaData.data["마감 시각"] || "-"}</div>
        </div>
        <div class="cfh-v3-meta-tile">
          <div class="cfh-v3-meta-label">Revision</div>
          <div class="cfh-v3-meta-value">${metaData.data["Revision"] || "-"}</div>
        </div>
        <div class="cfh-v3-meta-tile">
          <div class="cfh-v3-meta-label">스냅샷 생성</div>
          <div class="cfh-v3-meta-value">${metaData.data["스냅샷 생성"] || "-"}</div>
        </div>
      </div>
      <div class="cfh-v3-request-panel">
        <div class="cfh-v3-meta-label">DataPARC 요청</div>
        <div class="cfh-v3-request-value">${metaData.data["DataPARC 요청"] || "-"}</div>
      </div>
      <div class="cfh-v3-action-row"></div>
    `;

    const actionRow = host.querySelector(".cfh-v3-action-row");
    let control = metaData.calcControl;
    if (control) {
      control.textContent = "계산 화면 보기";
      control.classList.add("cfh-v3-action-button");
      actionRow.appendChild(control);
    } else {
      const fallback = document.createElement("button");
      fallback.type = "button";
      fallback.className = "cfh-v3-action-button";
      fallback.textContent = "계산 화면 보기";
      actionRow.appendChild(fallback);
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

    const basisData = parseBasisData(basisCard);
    const metaData = parseMetaData(metaCard);

    renderBasisCard(basisCard, basisTitle, basisData);
    renderMetaCard(metaCard, metaTitle, metaData);
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
