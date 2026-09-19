(() => {
  "use strict";

  const ROOT = ".cofiring-period-v5 .cfv52-detail";
  const TABLES = [
    {
      selector: "table.cfv5-grid.cfv5-coal-bio",
      groups: [
        { label: "Coal", className: "cfv5-head-coal", first: "계측량" },
        { label: "Bio-SRF", className: "cfv5-head-bio", first: "계측량" }
      ]
    },
    {
      selector: "table.cfv5-grid.cfv5-organic",
      groups: [
        { label: "유기성 고형연료", className: "cfv5-head-organic", first: "사용량" },
        { label: "축분", className: "cfv5-head-manure", first: "사용량" }
      ]
    }
  ];

  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function copyUsefulClasses(target, ...sources) {
    const allowed = ["cfv5-measured", "cfv5-factor", "cfv5-actual", "cfv5-sum"];
    for (const source of sources) {
      if (!source) continue;
      for (const name of allowed) {
        if (source.classList.contains(name)) target.classList.add(name);
      }
    }
  }

  function compactPair(first, second) {
    const td = make("td", "cfv5-compact-pair");
    copyUsefulClasses(td, first, second);

    const period = make("b", "", (first?.textContent || "—").trim() || "—");
    const slash = make("span", "", "/");
    const average = make("small", "", (second?.textContent || "—").trim() || "—");

    td.append(period, slash, average);
    return td;
  }

  function cloneCell(cell) {
    return cell ? cell.cloneNode(true) : make("td", "", "—");
  }

  function compactBodyRow(row) {
    const cells = Array.from(row.children);

    // Original detail rows: 1 unit header + 14 data cells = 15 cells.
    if (cells.length !== 15) return;

    const data = cells.slice(1);
    const unit = cloneCell(cells[0]);

    row.replaceChildren(
      unit,
      compactPair(data[0], data[1]),
      cloneCell(data[2]),
      compactPair(data[3], data[4]),
      cloneCell(data[5]),
      compactPair(data[6], data[7]),
      cloneCell(data[8]),
      compactPair(data[9], data[10]),
      cloneCell(data[11])
    );
  }

  function installColgroup(table) {
    for (const old of Array.from(table.querySelectorAll(":scope > colgroup"))) {
      old.remove();
    }

    const group = document.createElement("colgroup");
    const classes = [
      "cfv5-v5-unit",
      "cfv5-v5-pair",
      "cfv5-v5-factor",
      "cfv5-v5-pair",
      "cfv5-v5-heat",
      "cfv5-v5-pair",
      "cfv5-v5-factor",
      "cfv5-v5-pair",
      "cfv5-v5-heat"
    ];

    for (const className of classes) {
      group.append(make("col", className));
    }
    table.insertBefore(group, table.firstChild);
  }

  function installHeader(table, config) {
    let thead = table.tHead;
    if (!thead) {
      thead = document.createElement("thead");
      table.insertBefore(thead, table.tBodies[0] || null);
    }

    const firstRow = document.createElement("tr");
    const unit = make("th", "", "설비");
    unit.rowSpan = 2;
    firstRow.append(unit);

    for (const group of config.groups) {
      const th = make("th", group.className, group.label);
      th.colSpan = 4;
      firstRow.append(th);
    }

    const secondRow = document.createElement("tr");
    for (const group of config.groups) {
      const labels = [
        { title: group.first, sub: "기간 / 평균" },
        { title: "보정", sub: "" },
        { title: "실사용량", sub: "기간 / 평균" },
        { title: "열량", sub: "Gcal" }
      ];

      for (const item of labels) {
        const th = make("th", "", item.title);
        if (item.sub) th.append(make("small", "", item.sub));
        secondRow.append(th);
      }
    }

    thead.replaceChildren(firstRow, secondRow);
    table.classList.add("cfv5-detail-compact-v5r1");
    table.dataset.cfv5CompactHeader = "v5r1";
    installColgroup(table);
  }

  function compactTable(table, config) {
    if (
      table.dataset.cfv5CompactHeader !== "v5r1" ||
      !table.tHead ||
      table.tHead.rows.length !== 2
    ) {
      installHeader(table, config);
    }

    for (const tbody of Array.from(table.tBodies)) {
      for (const row of Array.from(tbody.rows)) {
        compactBodyRow(row);
      }
    }
  }

  function scan() {
    for (const config of TABLES) {
      for (const table of document.querySelectorAll(`${ROOT} ${config.selector}`)) {
        compactTable(table, config);
      }
    }
  }

  let queued = false;
  function queueScan() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      scan();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  } else {
    scan();
  }

  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
