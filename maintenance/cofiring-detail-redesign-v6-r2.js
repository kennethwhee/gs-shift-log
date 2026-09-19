(() => {
  "use strict";

  const ROOT_SELECTOR = ".cofiring-period-v5";
  const DETAIL_SELECTOR = ".cfv52-detail";
  const HOST_CLASS = "cfv6detail-host";
  const SOURCE_CLASS = "cfv6detail-source-hidden";
  const EVENT_NAME = "cfv6-detail-result";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function numberText(value, digits = 2) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return value.toLocaleString("ko-KR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function factorText(a, b) {
    if (
      typeof a === "number" &&
      Number.isFinite(a) &&
      typeof b === "number" &&
      Number.isFinite(b) &&
      Math.abs(a - b) < 1e-12
    ) {
      return a.toLocaleString("ko-KR", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4
      });
    }
    return "—";
  }

  function avg(value, hours) {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      typeof hours === "number" &&
      Number.isFinite(hours) &&
      hours > 0
    ) ? value / hours : null;
  }

  function sum(values) {
    const ready = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    return ready.length ? ready.reduce((total, value) => total + value, 0) : null;
  }

  function pair(period, average) {
    return {
      period: numberText(period, 2),
      average: numberText(average, 2)
    };
  }

  function fuelRow(unitLabel, fuel, measured, hours) {
    return {
      unit: unitLabel,
      measured: pair(measured, avg(measured, hours)),
      factor: numberText(fuel?.coefficient, 4),
      actual: pair(fuel?.quantity, fuel?.averageTonPerHour),
      heat: numberText(fuel?.heatValue, 1)
    };
  }

  function normalizePayload(payload) {
    const result = payload?.result;
    const manual = payload?.manualValues || {};
    if (!result?.units) return null;

    const hours = Number(result?.period?.durationHours) || 0;
    const one = result.units.unit1 || {};
    const two = result.units.unit2 || {};

    function mapped(unit, unitKey, leftKey, rightKey, manualLeft, manualRight) {
      const leftFuel = unit?.[leftKey] || {};
      const rightFuel = unit?.[rightKey] || {};
      const leftMeasured = manualLeft ? manual?.[unitKey]?.[leftKey] : leftFuel.measuredQuantity;
      const rightMeasured = manualRight ? manual?.[unitKey]?.[rightKey] : rightFuel.measuredQuantity;

      return {
        unit: unitKey === "unit1" ? "1호기" : "2호기",
        left: {
          measured: pair(leftMeasured, avg(leftMeasured, hours)),
          factor: numberText(leftFuel.coefficient, 4),
          actual: pair(leftFuel.quantity, leftFuel.averageTonPerHour),
          heat: numberText(unit?.heats?.[leftKey], 1)
        },
        right: {
          measured: pair(rightMeasured, avg(rightMeasured, hours)),
          factor: numberText(rightFuel.coefficient, 4),
          actual: pair(rightFuel.quantity, rightFuel.averageTonPerHour),
          heat: numberText(unit?.heats?.[rightKey], 1)
        }
      };
    }

    const coalBioRows = [
      mapped(one, "unit1", "coal", "bio", false, false),
      mapped(two, "unit2", "coal", "bio", false, false),
      {
        unit: "계",
        left: {
          measured: pair(
            sum([one?.coal?.measuredQuantity, two?.coal?.measuredQuantity]),
            sum([
              avg(one?.coal?.measuredQuantity, hours),
              avg(two?.coal?.measuredQuantity, hours)
            ])
          ),
          factor: factorText(one?.coal?.coefficient, two?.coal?.coefficient),
          actual: pair(
            sum([one?.coal?.quantity, two?.coal?.quantity]),
            sum([one?.coal?.averageTonPerHour, two?.coal?.averageTonPerHour])
          ),
          heat: numberText(result?.combined?.heats?.coal, 1)
        },
        right: {
          measured: pair(
            sum([one?.bio?.measuredQuantity, two?.bio?.measuredQuantity]),
            sum([
              avg(one?.bio?.measuredQuantity, hours),
              avg(two?.bio?.measuredQuantity, hours)
            ])
          ),
          factor: factorText(one?.bio?.coefficient, two?.bio?.coefficient),
          actual: pair(
            sum([one?.bio?.quantity, two?.bio?.quantity]),
            sum([one?.bio?.averageTonPerHour, two?.bio?.averageTonPerHour])
          ),
          heat: numberText(result?.combined?.heats?.bio, 1)
        }
      }
    ];

    const organicRows = [
      mapped(one, "unit1", "organic", "manure", true, true),
      mapped(two, "unit2", "organic", "manure", true, true),
      {
        unit: "계",
        left: {
          measured: pair(
            sum([manual?.unit1?.organic, manual?.unit2?.organic]),
            sum([
              avg(manual?.unit1?.organic, hours),
              avg(manual?.unit2?.organic, hours)
            ])
          ),
          factor: factorText(one?.organic?.coefficient, two?.organic?.coefficient),
          actual: pair(
            sum([one?.organic?.quantity, two?.organic?.quantity]),
            sum([one?.organic?.averageTonPerHour, two?.organic?.averageTonPerHour])
          ),
          heat: numberText(result?.combined?.heats?.organic, 1)
        },
        right: {
          measured: pair(
            sum([manual?.unit1?.manure, manual?.unit2?.manure]),
            sum([
              avg(manual?.unit1?.manure, hours),
              avg(manual?.unit2?.manure, hours)
            ])
          ),
          factor: factorText(one?.manure?.coefficient, two?.manure?.coefficient),
          actual: pair(
            sum([one?.manure?.quantity, two?.manure?.quantity]),
            sum([one?.manure?.averageTonPerHour, two?.manure?.averageTonPerHour])
          ),
          heat: numberText(result?.combined?.heats?.manure, 1)
        }
      }
    ];

    return { coalBioRows, organicRows };
  }

  function pairNode(value) {
    const wrap = el("span", "cfv6detail-pair");
    wrap.append(
      el("strong", "", value?.period ?? "—"),
      el("i", "", "/"),
      el("small", "", value?.average ?? "—")
    );
    return wrap;
  }

  function metricNode(value, kind) {
    const node = el("div", `cfv6detail-value cfv6detail-value-${kind}`);
    if (kind === "measured" || kind === "actual") {
      node.append(pairNode(value));
    } else {
      node.textContent = value ?? "—";
    }
    return node;
  }

  function groupHeader(name, tone, firstLabel) {
    const group = el("div", `cfv6detail-group-head is-${tone}`);
    group.append(el("strong", "", name));

    const labels = el("div", "cfv6detail-labels");
    for (const label of [firstLabel, "보정", "실사용량", "열량 Gcal"]) {
      labels.append(el("span", "", label));
    }
    group.append(labels);
    return group;
  }

  function valuesGroup(values, isSum) {
    const group = el("div", `cfv6detail-group-values${isSum ? " is-sum" : ""}`);
    group.append(
      metricNode(values.measured, "measured"),
      metricNode(values.factor, "factor"),
      metricNode(values.actual, "actual"),
      metricNode(values.heat, "heat")
    );
    return group;
  }

  function panel(title, left, right, rows) {
    const section = el("section", "cfv6detail-panel");
    const heading = el("div", "cfv6detail-panel-title");
    heading.append(el("strong", "", title), el("small", "", "기간 / 평균"));
    section.append(heading);

    const grid = el("div", "cfv6detail-grid");
    grid.append(
      el("div", "cfv6detail-corner", "설비"),
      groupHeader(left.name, left.tone, left.first),
      groupHeader(right.name, right.tone, right.first)
    );

    for (const row of rows) {
      const isSum = row.unit === "계";
      grid.append(
        el("div", `cfv6detail-unit${isSum ? " is-sum" : ""}`, row.unit),
        valuesGroup(row.left, isSum),
        valuesGroup(row.right, isSum)
      );
    }

    section.append(grid);
    return section;
  }

  function ensureHost(container) {
    const detail = container.querySelector(DETAIL_SELECTOR);
    if (!detail) return null;

    let host = detail.querySelector(`:scope > .${HOST_CLASS}`);
    if (!host) {
      host = el("div", HOST_CLASS);
      const summary = detail.querySelector(":scope > summary");
      if (summary?.nextSibling) detail.insertBefore(host, summary.nextSibling);
      else detail.append(host);
    }

    for (const child of Array.from(detail.children)) {
      if (child === host || child.tagName === "SUMMARY") continue;
      child.classList.add(SOURCE_CLASS);
    }

    return host;
  }

  function showWaiting(container) {
    const host = ensureHost(container);
    if (!host) return;
    host.replaceChildren();

    const configs = [
      ["Coal · Bio-SRF 상세", {name:"Coal",tone:"coal",first:"계측량"}, {name:"Bio-SRF",tone:"bio",first:"계측량"}],
      ["유기성 고형연료 · 축분 상세", {name:"유기성 고형연료",tone:"organic",first:"사용량"}, {name:"축분",tone:"manure",first:"사용량"}]
    ];

    for (const [title, left, right] of configs) {
      const section = el("section", "cfv6detail-panel");
      const heading = el("div", "cfv6detail-panel-title");
      heading.append(el("strong", "", title), el("small", "", "기간 / 평균"));
      section.append(heading);

      const grid = el("div", "cfv6detail-grid");
      grid.append(
        el("div", "cfv6detail-corner", "설비"),
        groupHeader(left.name, left.tone, left.first),
        groupHeader(right.name, right.tone, right.first)
      );
      const wait = el("div", "cfv6detail-empty", "계산값을 불러오는 중입니다.");
      wait.style.gridColumn = "1 / -1";
      grid.append(wait);
      section.append(grid);
      host.append(section);
    }
  }

  function renderPayload(container, payload) {
    const normalized = normalizePayload(payload);
    const host = ensureHost(container);
    if (!host) return;

    if (!normalized) {
      showWaiting(container);
      return;
    }

    host.replaceChildren(
      panel(
        "Coal · Bio-SRF 상세",
        {name:"Coal",tone:"coal",first:"계측량"},
        {name:"Bio-SRF",tone:"bio",first:"계측량"},
        normalized.coalBioRows
      ),
      panel(
        "유기성 고형연료 · 축분 상세",
        {name:"유기성 고형연료",tone:"organic",first:"사용량"},
        {name:"축분",tone:"manure",first:"사용량"},
        normalized.organicRows
      )
    );
  }

  function bind(container) {
    if (!container || container.dataset.cfv6DetailR2Bound === "true") return;
    container.dataset.cfv6DetailR2Bound = "true";

    ensureHost(container);

    container.addEventListener(EVENT_NAME, (event) => {
      renderPayload(container, event.detail);
    });

    if (container.__cfv6DetailPayload) {
      renderPayload(container, container.__cfv6DetailPayload);
    } else {
      showWaiting(container);
    }

    container.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-cfv5-query],[data-cfv5-requery]");
      if (!button) return;
      showWaiting(container);
    }, true);
  }

  function scan() {
    for (const container of document.querySelectorAll(ROOT_SELECTOR)) {
      bind(container);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  } else {
    scan();
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
