(() => {
  "use strict";

  const PATCH_CLASS = "cfv6shared-host";
  const HIDDEN_CLASS = "cfv6shared-source-hidden";
  const FUELS = ["Coal", "Bio", "유기성", "축분"];

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function rowFuelName(row) {
    const labelCell =
      row.querySelector("th") ||
      row.querySelector("td") ||
      row.cells?.[0];
    return cleanText(labelCell?.textContent || "");
  }

  function findSection() {
    const details = Array.from(document.querySelectorAll("details, section, div"));
    for (const node of details) {
      const text = cleanText(node.textContent || "");
      if (!text.includes("발열량") || !text.includes("보정계수")) continue;
      const table = node.querySelector("table");
      if (!table) continue;
      const rows = Array.from(table.querySelectorAll("tr"));
      const names = rows.map(rowFuelName);
      if (FUELS.every((fuel) => names.includes(fuel))) {
        return { section: node, table };
      }
    }
    return null;
  }

  function findFuelRows(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    const map = new Map();
    for (const row of rows) {
      const name = rowFuelName(row);
      if (FUELS.includes(name)) {
        map.set(name, row);
      }
    }
    return FUELS.map((fuel) => map.get(fuel)).filter(Boolean);
  }

  function findValueControls(row) {
    const controls = Array.from(
      row.querySelectorAll("input, select, textarea")
    ).filter((el) => !el.closest(`.${PATCH_CLASS}`));
    return controls.slice(0, 2);
  }

  function labelForControl(index) {
    if (index === 0) return { title: "발열량", sub: "kcal/kg" };
    return { title: "보정계수", sub: "" };
  }

  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function buildHost(section, table, rows) {
    let host = section.querySelector(`:scope > .${PATCH_CLASS}`);
    if (!host) {
      host = make("div", PATCH_CLASS);
      table.insertAdjacentElement("beforebegin", host);
    } else {
      host.replaceChildren();
    }

    const title = make("div", "cfv6shared-title");
    title.append(
      make("strong", "", "공통 기준"),
      make("small", "", "1·2호기 동일 적용")
    );
    host.append(title);

    const grid = make("table", "cfv6shared-grid");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.append(make("th", "is-label", "구분"));
    for (const fuel of FUELS) {
      headRow.append(make("th", "", fuel));
    }
    thead.append(headRow);

    const tbody = document.createElement("tbody");

    for (let controlIndex = 0; controlIndex < 2; controlIndex += 1) {
      const row = document.createElement("tr");
      const label = labelForControl(controlIndex);
      const th = make("th", "is-label");
      th.append(
        make("strong", "", label.title),
        label.sub ? make("small", "", label.sub) : document.createTextNode("")
      );
      row.append(th);

      for (const sourceRow of rows) {
        const cell = make("td", "");
        const controls = findValueControls(sourceRow);
        const control = controls[controlIndex];

        const wrap = make("div", "cfv6shared-control");
        if (control) {
          wrap.append(control);
        } else {
          wrap.textContent = "—";
        }
        cell.append(wrap);
        row.append(cell);
      }

      tbody.append(row);
    }

    grid.append(thead, tbody);
    host.append(grid);
    table.classList.add(HIDDEN_CLASS);
  }

  function enhance() {
    const found = findSection();
    if (!found) return;
    const { section, table } = found;

    const rows = findFuelRows(table);
    if (rows.length !== 4) return;

    const existing = section.querySelector(`:scope > .${PATCH_CLASS}`);
    if (existing) {
      const hasAnyInput = existing.querySelector("input, select, textarea");
      if (hasAnyInput) {
        table.classList.add(HIDDEN_CLASS);
        return;
      }
    }

    buildHost(section, table, rows);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }

  const observer = new MutationObserver(() => enhance());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
