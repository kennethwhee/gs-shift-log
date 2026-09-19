(() => {
  "use strict";

  const DETAIL_SELECTOR = ".cofiring-period-v5 .cfv52-detail";
  const SOURCE_CLASS = "cfv6detail-source-hidden";
  const HOST_CLASS = "cfv6detail-host";

  const TABLE_CONFIG = [
    {
      selector: "table.cfv5-grid.cfv5-coal-bio",
      title: "Coal · Bio-SRF 상세",
      left: { name: "Coal", tone: "coal", measured: "계측량" },
      right: { name: "Bio-SRF", tone: "bio", measured: "계측량" }
    },
    {
      selector: "table.cfv5-grid.cfv5-organic",
      title: "유기성 고형연료 · 축분 상세",
      left: { name: "유기성 고형연료", tone: "organic", measured: "사용량" },
      right: { name: "축분", tone: "manure", measured: "사용량" }
    }
  ];

  function cleanText(node) {
    const raw = node?.textContent ?? "";
    const text = String(raw).replace(/\s+/g, " ").trim();
    return text || "—";
  }

  function splitCompactPair(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized || normalized === "—") {
      return { period: "—", average: "—" };
    }

    const slashIndex = normalized.indexOf("/");
    if (slashIndex < 0) {
      return { period: normalized, average: "—" };
    }

    const period = normalized.slice(0, slashIndex).trim() || "—";
    const average = normalized.slice(slashIndex + 1).trim() || "—";
    return { period, average };
  }

  function pair(periodCell, averageCell) {
    return {
      period: cleanText(periodCell),
      average: cleanText(averageCell)
    };
  }

  function parse15(cells) {
    return {
      unit: cleanText(cells[0]),
      left: {
        measured: pair(cells[1], cells[2]),
        factor: cleanText(cells[3]),
        actual: pair(cells[4], cells[5]),
        heat: cleanText(cells[6])
      },
      right: {
        measured: pair(cells[7], cells[8]),
        factor: cleanText(cells[9]),
        actual: pair(cells[10], cells[11]),
        heat: cleanText(cells[12])
      }
    };
  }

  function parse9(cells) {
    return {
      unit: cleanText(cells[0]),
      left: {
        measured: splitCompactPair(cleanText(cells[1])),
        factor: cleanText(cells[2]),
        actual: splitCompactPair(cleanText(cells[3])),
        heat: cleanText(cells[4])
      },
      right: {
        measured: splitCompactPair(cleanText(cells[5])),
        factor: cleanText(cells[6]),
        actual: splitCompactPair(cleanText(cells[7])),
        heat: cleanText(cells[8])
      }
    };
  }

  function parseSourceTable(table) {
    const body = table?.tBodies?.[0];
    if (!body) return [];

    const rows = [];
    for (const row of Array.from(body.rows)) {
      const cells = Array.from(row.children);

      if (cells.length >= 15) {
        rows.push(parse15(cells));
        continue;
      }

      if (cells.length === 9) {
        rows.push(parse9(cells));
      }
    }
    return rows;
  }

  function signatureFor(detail) {
    return TABLE_CONFIG.map((config) => {
      const table = detail.querySelector(config.selector);
      if (!table) return "missing";
      return Array.from(table.tBodies?.[0]?.rows || [])
        .map((row) => {
          const cells = Array.from(row.children);
          return `${cells.length}:` + cells.map(cleanText).join("\u241f");
        })
        .join("\u241e");
    }).join("\u241d");
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function pairValue(value) {
    const wrap = el("span", "cfv6detail-pair");
    wrap.append(
      el("strong", "", value.period),
      el("i", "", "/"),
      el("small", "", value.average)
    );
    return wrap;
  }

  function metricValue(value, kind) {
    const cell = el("div", `cfv6detail-value cfv6detail-value-${kind}`);
    if (kind === "measured" || kind === "actual") {
      cell.append(pairValue(value));
    } else {
      cell.textContent = value;
    }
    return cell;
  }

  function groupHeader(config) {
    const group = el("div", `cfv6detail-group-head is-${config.tone}`);
    group.append(el("strong", "", config.name));

    const labels = el("div", "cfv6detail-labels");
    labels.append(
      el("span", "", config.measured),
      el("span", "", "보정"),
      el("span", "", "실사용량"),
      el("span", "", "열량 Gcal")
    );
    group.append(labels);
    return group;
  }

  function groupValues(values) {
    const group = el("div", "cfv6detail-group-values");
    group.append(
      metricValue(values.measured, "measured"),
      metricValue(values.factor, "factor"),
      metricValue(values.actual, "actual"),
      metricValue(values.heat, "heat")
    );
    return group;
  }

  function buildPanel(config, rows) {
    const section = el("section", "cfv6detail-panel");

    const title = el("div", "cfv6detail-panel-title");
    title.append(
      el("strong", "", config.title),
      el("small", "", "기간 / 평균")
    );
    section.append(title);

    const grid = el("div", "cfv6detail-grid");
    grid.append(
      el("div", "cfv6detail-corner", "설비"),
      groupHeader(config.left),
      groupHeader(config.right)
    );

    if (!rows.length) {
      const empty = el("div", "cfv6detail-empty", "계산값을 불러오는 중입니다.");
      empty.style.gridColumn = "1 / -1";
      grid.append(empty);
    } else {
      for (const row of rows) {
        const unit = el(
          "div",
          `cfv6detail-unit${row.unit === "계" ? " is-sum" : ""}`,
          row.unit
        );
        const left = groupValues(row.left);
        const right = groupValues(row.right);

        if (row.unit === "계") {
          left.classList.add("is-sum");
          right.classList.add("is-sum");
        }

        grid.append(unit, left, right);
      }
    }

    section.append(grid);
    return section;
  }

  function ensureSourceHidden(detail, host) {
    for (const child of Array.from(detail.children)) {
      if (child.tagName === "SUMMARY" || child === host) continue;
      child.classList.add(SOURCE_CLASS);
    }
  }

  function renderDetail(detail, force = false) {
    const tables = TABLE_CONFIG.map((config) => detail.querySelector(config.selector));
    if (tables.some((table) => !table)) return;

    let host = detail.querySelector(`:scope > .${HOST_CLASS}`);
    if (!host) {
      host = el("div", HOST_CLASS);
      const summary = detail.querySelector(":scope > summary");
      if (summary?.nextSibling) {
        detail.insertBefore(host, summary.nextSibling);
      } else {
        detail.append(host);
      }
    }

    ensureSourceHidden(detail, host);

    const signature = signatureFor(detail);
    if (!force && host.dataset.signature === signature && host.childElementCount) return;

    host.dataset.signature = signature;
    host.replaceChildren();

    for (let i = 0; i < TABLE_CONFIG.length; i += 1) {
      host.append(buildPanel(TABLE_CONFIG[i], parseSourceTable(tables[i])));
    }
  }

  function scan(force = false) {
    for (const detail of document.querySelectorAll(DETAIL_SELECTOR)) {
      renderDetail(detail, force);
    }
  }

  let queued = false;
  function queueScan(force = false) {
    if (queued && !force) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan(force);
    });
  }

  function refreshBurst() {
    // Covers async calculation/render completion without touching calculation logic.
    for (const delay of [0, 100, 300, 700, 1500, 3000, 6000]) {
      setTimeout(() => scan(true), delay);
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target?.closest?.(".cofiring-period-v5 button");
      if (!button) return;
      refreshBurst();
    },
    true
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      scan(true);
      refreshBurst();
    }, { once: true });
  } else {
    scan(true);
    refreshBurst();
  }

  const observer = new MutationObserver(() => queueScan(false));
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
