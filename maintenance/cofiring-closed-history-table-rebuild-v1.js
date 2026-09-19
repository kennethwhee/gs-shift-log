(() => {
  "use strict";

  /* COFIRING CLOSED HISTORY TABLE REBUILD V1 */
  const ROOT = "#efficiencyCofiringDraftView";
  const TABLE = `${ROOT} .cfv12-history-panel .cfv15-history-table`;

  const FUEL_LABELS = ["Coal", "Bio", "유기성", "축분"];
  const RATIO_LABELS = ["Bio", "유·축", "종합"];

  function textOf(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function strongValues(container, expected) {
    const values = Array.from(container.querySelectorAll("strong"))
      .map((node) => textOf(node))
      .filter(Boolean);

    return values.slice(0, expected);
  }

  function rebuildFuelGrid(container) {
    if (!container) return false;

    const values = strongValues(container, 4);
    if (values.length !== 4) return false;

    container.classList.remove("cfv16-fuel-grid");
    container.classList.add("cfhr-fuel-grid-v1");
    container.dataset.cfhrRebuilt = "fuel";

    container.innerHTML = FUEL_LABELS.map(
      (label, index) => `
        <span class="cfhr-fuel-item-v1">
          <small>${escapeHtml(label)}</small>
          <strong>${escapeHtml(values[index])}</strong>
        </span>
      `
    ).join("");

    return true;
  }

  function rebuildRatioGrid(container, combined = false) {
    if (!container) return false;

    const values = strongValues(container, 3);
    if (values.length !== 3) return false;

    container.classList.remove("cfv16-ratio-grid", "cfv16-combined-grid");
    container.classList.add(
      combined ? "cfhr-combined-grid-v1" : "cfhr-ratio-grid-v1"
    );
    container.dataset.cfhrRebuilt = combined ? "combined" : "ratio";

    container.innerHTML = RATIO_LABELS.map(
      (label, index) => `
        <span class="${index === 2 ? "is-total" : ""}">
          <small>${escapeHtml(label)}</small>
          <strong>${escapeHtml(values[index])}</strong>
        </span>
      `
    ).join("");

    return true;
  }

  function rebuildHeader(table) {
    const headerCells = table.querySelectorAll(".cfv15-column-head th");

    if (headerCells.length >= 4) {
      for (const index of [0, 2]) {
        const small = headerCells[index]?.querySelector("small");
        if (small) {
          small.textContent = "Coal / Bio / 유기성 / 축분 · t";
          small.classList.add("cfhr-fuel-help-v1");
        }
      }
    }
  }

  function rebuildTable(table) {
    if (!table) return false;

    rebuildHeader(table);

    table.querySelectorAll(".cfv16-fuel-grid").forEach(rebuildFuelGrid);
    table.querySelectorAll(".cfv16-ratio-grid").forEach((grid) => {
      rebuildRatioGrid(grid, false);
    });
    table.querySelectorAll(".cfv16-combined-grid").forEach((grid) => {
      rebuildRatioGrid(grid, true);
    });

    table.dataset.cfhrTableRebuildV1 = "1";
    return true;
  }

  function enhance() {
    const table = document.querySelector(TABLE);
    if (!table) return false;
    return rebuildTable(table);
  }

  function scheduleEnhance() {
    for (const delay of [0, 70, 180, 420]) {
      window.setTimeout(enhance, delay);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleEnhance, { once: true });
  } else {
    scheduleEnhance();
  }

  document.addEventListener("click", scheduleEnhance, true);
  document.addEventListener("change", scheduleEnhance, true);
  window.addEventListener("focus", scheduleEnhance);

  // Bounded retries only. No MutationObserver.
  for (const delay of [300, 800, 1500, 3000, 6000, 10000]) {
    window.setTimeout(enhance, delay);
  }
})();
