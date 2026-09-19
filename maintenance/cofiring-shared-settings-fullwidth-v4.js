(() => {
  "use strict";

  const ROOT = "[data-cofiring-draft-root]";
  const HOST_CLASS = "cfv6shared-v4-host";
  const SOURCE_HIDDEN = "cfv6shared-v4-source-hidden";

  const FUELS = [
    { key: "coal", label: "Coal", tone: "coal" },
    { key: "bio", label: "Bio", tone: "bio" },
    { key: "organic", label: "유기성", tone: "organic" },
    { key: "manure", label: "축분", tone: "manure" }
  ];

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function getInput(root, kind, fuel) {
    return root.querySelector(
      `[data-cfv5-${kind}="unit1:${fuel}"]`
    );
  }

  function formatCoefficient(input) {
    if (!input || document.activeElement === input) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    input.value = value.toFixed(2);
  }

  function configureInput(input, kind) {
    if (!input) return;

    input.classList.add("cfv6shared-v4-input", `is-${kind}`);
    input.setAttribute("inputmode", "decimal");

    if (kind === "coefficient") {
      input.setAttribute("step", "0.01");
      input.setAttribute("min", "0.01");

      if (input.dataset.cfv6SharedV4Bound !== "true") {
        input.dataset.cfv6SharedV4Bound = "true";
        input.addEventListener("blur", () => {
          const value = Number(input.value);
          if (!Number.isFinite(value)) return;
          input.value = value.toFixed(2);
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }

      formatCoefficient(input);
    }
  }

  function field(kind, input) {
    const box = make("div", `cfv6shared-v4-field is-${kind}`);
    const label = make("div", "cfv6shared-v4-field-label");

    if (kind === "calorific") {
      label.append(
        make("strong", "", "발열량"),
        make("small", "", "kcal/kg")
      );
    } else {
      label.append(make("strong", "", "보정계수"));
    }

    const control = make("div", "cfv6shared-v4-control");
    if (input) control.append(input);
    else control.append(make("span", "cfv6shared-v4-missing", "—"));

    box.append(label, control);
    return box;
  }

  function card(root, fuel) {
    const c = getInput(root, "calorific", fuel.key);
    const f = getInput(root, "coefficient", fuel.key);

    configureInput(c, "calorific");
    configureInput(f, "coefficient");

    const item = make("section", `cfv6shared-v4-card is-${fuel.tone}`);
    const head = make("div", "cfv6shared-v4-card-head");
    head.append(
      make("strong", "", fuel.label),
      make("small", "", "공통 기준")
    );

    const body = make("div", "cfv6shared-v4-card-body");
    body.append(
      field("calorific", c),
      field("coefficient", f)
    );

    item.append(head, body);
    return item;
  }

  function build(root, wrap, sourceTable) {
    for (const old of Array.from(
      wrap.querySelectorAll(
        ":scope > .cfv6shared-v2-host, :scope > .cfv6shared-v3-host, :scope > .cfv6shared-v4-host"
      )
    )) {
      old.remove();
    }

    const host = make("div", HOST_CLASS);

    const top = make("div", "cfv6shared-v4-top");
    const copy = make("div", "cfv6shared-v4-copy");
    copy.append(
      make("strong", "", "공통 연료 기준"),
      make("span", "", "발열량 · 보정계수")
    );

    top.append(
      copy,
      make("span", "cfv6shared-v4-badge", "1·2호기 동일 적용")
    );

    const cards = make("div", "cfv6shared-v4-cards");
    for (const fuel of FUELS) {
      cards.append(card(root, fuel));
    }

    host.append(top, cards);
    sourceTable.insertAdjacentElement("beforebegin", host);
    sourceTable.classList.add(SOURCE_HIDDEN);

    const oldTitle = wrap.querySelector(".cfv5-basis-title");
    if (oldTitle) oldTitle.classList.add(SOURCE_HIDDEN);
  }

  function enhance() {
    const root = document.querySelector(ROOT);
    if (!root) return;

    const wrap = root.querySelector(".cfv5-basis-wrap");
    const sourceTable = wrap?.querySelector(".cfv5-basis-table");
    if (!wrap || !sourceTable) return;

    const ready = FUELS.every(
      ({ key }) =>
        getInput(root, "calorific", key) &&
        getInput(root, "coefficient", key)
    );
    if (!ready) return;

    const host = wrap.querySelector(`:scope > .${HOST_CLASS}`);
    if (!host) {
      build(root, wrap, sourceTable);
    } else {
      sourceTable.classList.add(SOURCE_HIDDEN);
      const oldTitle = wrap.querySelector(".cfv5-basis-title");
      if (oldTitle) oldTitle.classList.add(SOURCE_HIDDEN);

      for (const fuel of FUELS) {
        formatCoefficient(getInput(root, "coefficient", fuel.key));
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }

  const observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  for (const delay of [100, 300, 700, 1500, 3000, 6000]) {
    setTimeout(enhance, delay);
  }
})();
