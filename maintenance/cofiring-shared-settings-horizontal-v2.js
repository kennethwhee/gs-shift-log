(() => {
  "use strict";

  const ROOT = "[data-cofiring-draft-root]";
  const HOST_CLASS = "cfv6shared-v2-host";
  const SOURCE_HIDDEN = "cfv6shared-v2-source-hidden";

  const FUELS = [
    { key: "coal", label: "Coal" },
    { key: "bio", label: "Bio" },
    { key: "organic", label: "유기성" },
    { key: "manure", label: "축분" }
  ];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function coefficientInput(root, fuel) {
    return root.querySelector(
      `[data-cfv5-coefficient="unit1:${fuel}"]`
    );
  }

  function calorificInput(root, fuel) {
    return root.querySelector(
      `[data-cfv5-calorific="unit1:${fuel}"]`
    );
  }

  function formatCoefficient(input) {
    if (!input || document.activeElement === input) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    input.value = value.toFixed(2);
  }

  function configureCalorific(input) {
    if (!input) return;
    input.classList.add("cfv6shared-v2-input", "is-calorific");
    input.setAttribute("inputmode", "decimal");
    input.setAttribute("step", "1");
  }

  function configureCoefficient(input) {
    if (!input) return;
    input.classList.add("cfv6shared-v2-input", "is-coefficient");
    input.setAttribute("inputmode", "decimal");
    input.setAttribute("step", "0.01");
    input.setAttribute("min", "0.01");
    input.setAttribute("max", "100");

    if (input.dataset.cfv6SharedV2Bound !== "true") {
      input.dataset.cfv6SharedV2Bound = "true";

      input.addEventListener("blur", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        input.value = value.toFixed(2);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    formatCoefficient(input);
  }

  function build(root, wrap, sourceTable) {
    let host = wrap.querySelector(`:scope > .${HOST_CLASS}`);
    if (host) host.remove();

    host = el("div", HOST_CLASS);

    const title = el("div", "cfv6shared-v2-title");
    const titleLeft = el("div", "cfv6shared-v2-title-copy");
    titleLeft.append(
      el("strong", "", "공통 기준"),
      el("span", "", "연료별 발열량 · 보정계수")
    );
    title.append(
      titleLeft,
      el("small", "", "1·2호기 동일 적용")
    );
    host.append(title);

    const table = el("table", "cfv6shared-v2-grid");
    const thead = document.createElement("thead");

    const fuelRow = document.createElement("tr");
    for (const fuel of FUELS) {
      const th = el("th", `is-fuel is-${fuel.key}`, fuel.label);
      th.colSpan = 2;
      fuelRow.append(th);
    }

    const labelRow = document.createElement("tr");
    for (const fuel of FUELS) {
      const calorific = el("th", "is-sub");
      calorific.append(
        el("strong", "", "발열량"),
        el("small", "", "kcal/kg")
      );
      labelRow.append(
        calorific,
        el("th", "is-sub is-coefficient", "보정계수")
      );
    }

    thead.append(fuelRow, labelRow);

    const tbody = document.createElement("tbody");
    const valueRow = document.createElement("tr");

    for (const fuel of FUELS) {
      const c = calorificInput(root, fuel.key);
      const f = coefficientInput(root, fuel.key);

      configureCalorific(c);
      configureCoefficient(f);

      const cCell = el("td", "is-calorific-cell");
      const fCell = el("td", "is-coefficient-cell");

      if (c) cCell.append(c);
      else cCell.append(el("span", "cfv6shared-v2-missing", "—"));

      if (f) fCell.append(f);
      else fCell.append(el("span", "cfv6shared-v2-missing", "—"));

      valueRow.append(cCell, fCell);
    }

    tbody.append(valueRow);
    table.append(thead, tbody);
    host.append(table);

    sourceTable.classList.add(SOURCE_HIDDEN);
    sourceTable.insertAdjacentElement("beforebegin", host);
  }

  function enhance() {
    const root = document.querySelector(ROOT);
    if (!root) return;

    const wrap = root.querySelector(".cfv5-basis-wrap");
    const sourceTable = wrap?.querySelector(".cfv5-basis-table");
    if (!wrap || !sourceTable) return;

    const controlsReady = FUELS.every(
      ({ key }) => calorificInput(root, key) && coefficientInput(root, key)
    );
    if (!controlsReady) return;

    if (!wrap.querySelector(`:scope > .${HOST_CLASS}`)) {
      build(root, wrap, sourceTable);
    } else {
      for (const { key } of FUELS) {
        formatCoefficient(coefficientInput(root, key));
      }
      sourceTable.classList.add(SOURCE_HIDDEN);
    }
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

  // Async settings loads assign input.value programmatically.
  // A short bounded refresh keeps the visible coefficient format at 2 decimals.
  for (const delay of [100, 300, 700, 1500, 3000, 6000]) {
    setTimeout(enhance, delay);
  }
})();
