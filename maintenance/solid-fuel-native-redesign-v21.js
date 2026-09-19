"use strict";

/* ===== SOLID_FUEL_REAL_PAGE_REDESIGN_V21 ===== */
(() => {
  const P = "sfr21";

  const norm = value =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  const all = (root, selector = "*") =>
    root?.querySelectorAll
      ? Array.from(root.querySelectorAll(selector))
      : [];

  function exact(root, text, selector = "*") {
    return (
      all(root, selector)
        .filter(el => norm(el.textContent) === text)
        .sort(
          (a, b) =>
            a.querySelectorAll("*").length -
            b.querySelectorAll("*").length
        )[0] || null
    );
  }

  function starts(root, text, selector = "*") {
    return (
      all(root, selector)
        .filter(el => norm(el.textContent).startsWith(text))
        .sort(
          (a, b) =>
            a.querySelectorAll("*").length -
            b.querySelectorAll("*").length
        )[0] || null
    );
  }

  function climb(el, predicate, max = 14) {
    let node = el;

    for (let i = 0; node && i < max; i += 1) {
      if (predicate(node)) return node;
      node = node.parentElement;
    }

    return null;
  }

  function common(elements) {
    const list = elements.filter(el => el instanceof Element);

    if (!list.length) return null;

    let node = list[0];

    while (node && node !== document.documentElement) {
      if (
        list.every(
          el =>
            node === el ||
            node.contains(el)
        )
      ) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  function direct(parent, descendant) {
    if (!parent || !descendant) return null;

    let node = descendant;

    while (node && node.parentElement !== parent) {
      node = node.parentElement;
    }

    return node?.parentElement === parent
      ? node
      : null;
  }

  function decorateFilter() {
    const month = exact(document, "월별", "button");
    const period = exact(document, "기간 지정", "button");
    const allButton = exact(document, "전체", "button");

    if (!month || !period || !allButton) return;

    const box = climb(
      month,
      node => {
        const text = norm(node.textContent);

        return (
          text.includes("월별") &&
          text.includes("기간 지정") &&
          text.includes("조회 월") &&
          text.includes("업체명") &&
          text.includes("차량번호") &&
          text.includes("통합 검색") &&
          text.includes("정렬") &&
          node.querySelectorAll("input,select").length >= 4
        );
      },
      10
    );

    if (!box) return;

    box.classList.add(`${P}-filter`);

    [month, period, allButton].forEach(button => {
      button.classList.add(`${P}-mode-button`);
    });

    const fields = [
      ["조회 월", "month"],
      ["업체명", "company"],
      ["차량번호", "vehicle"],
      ["통합 검색", "search"],
      ["정렬", "sort"]
    ];

    fields.forEach(([text, key]) => {
      const label = exact(
        box,
        text,
        "label,span,strong,b,div"
      );

      if (!label) return;

      label.classList.add(`${P}-field-label`);

      const field = climb(
        label,
        node => {
          if (node === box) return false;
          return Boolean(
            node.querySelector?.("input,select")
          );
        },
        6
      );

      if (!field) return;

      field.classList.add(`${P}-field`);
      field.dataset.sfr21Field = key;
    });

    all(box, "button").forEach(button => {
      const text = norm(button.textContent);

      if (text === "조회") {
        button.classList.add(`${P}-search-button`);
      }

      if (text === "초기화") {
        button.classList.add(`${P}-reset-button`);
      }
    });
  }

  function decorateKpi() {
    const labels = [
      "하역",
      "평균 하역",
      "Trouble",
      "이상·막힘",
      "최장 하역"
    ];

    const nodes = labels.map(label =>
      exact(
        document,
        label,
        "span,strong,b,div"
      )
    );

    if (nodes.some(node => !node)) return;

    const group = climb(
      nodes[0],
      node => {
        const text = norm(node.textContent);

        return labels.every(
          label => text.includes(label)
        );
      },
      8
    );

    if (!group) return;

    const cards = [];

    nodes.forEach((node, index) => {
      const card = direct(group, node);

      if (!card || cards.includes(card)) return;

      cards.push(card);

      card.classList.add(`${P}-kpi-card`);
      card.dataset.sfr21Kpi = String(index + 1);

      node.classList.add(`${P}-kpi-label`);

      const leaves = all(
        card,
        "span,strong,b,small,div"
      ).filter(el => el.children.length === 0);

      const value = leaves.find(el => {
        const text = norm(el.textContent);

        return (
          /^-?\d+$/.test(text) ||
          /^\d+:\d+$/.test(text) ||
          text === "-"
        );
      });

      value?.classList.add(`${P}-kpi-value`);

      leaves.forEach(el => {
        const text = norm(el.textContent);

        if (
          text === "건" ||
          text === "평균" ||
          text === "최장"
        ) {
          el.classList.add(`${P}-kpi-unit`);
        }
      });
    });

    if (cards.length === 5) {
      group.classList.add(`${P}-kpi-grid`);
    }
  }

  function companyTable() {
    return (
      all(document, "table").find(table => {
        const text = norm(table.textContent);

        return (
          text.includes("업체") &&
          text.includes("건수") &&
          text.includes("평균") &&
          text.includes("최단") &&
          text.includes("최장") &&
          text.includes("이상")
        );
      }) || null
    );
  }

  function recordTable() {
    return (
      all(document, "table").find(table => {
        const text = norm(table.textContent);

        return (
          text.includes("No.") &&
          text.includes("날짜") &&
          text.includes("입고") &&
          text.includes("출고") &&
          text.includes("소요") &&
          text.includes("업체") &&
          text.includes("차량") &&
          text.includes("Silo") &&
          text.includes("비고") &&
          text.includes("관리")
        );
      }) || null
    );
  }

  function decorateReference() {
    const table = companyTable();

    if (table) {
      table.classList.add(`${P}-company-table`);
    }

    ["#A", "#B", "Day"].forEach(label => {
      const node = exact(
        document,
        label,
        "strong,b,span,div"
      );

      if (!node) return;

      const card = climb(
        node,
        el => {
          const text = norm(el.textContent);

          return (
            text.startsWith(label) &&
            text.length < 50
          );
        },
        5
      );

      card?.classList.add(`${P}-silo-card`);
    });
  }

  function decorateTabs() {
    const unload = starts(
      document,
      "하역 기록",
      "button"
    );

    const trouble = starts(
      document,
      "Trouble 내역",
      "button"
    );

    if (!unload || !trouble) return;

    unload.classList.add(`${P}-record-tab`);
    trouble.classList.add(`${P}-record-tab`);

    common([unload, trouble])
      ?.classList.add(`${P}-record-tabs`);
  }

  function decorateRecords() {
    const table = recordTable();

    if (!table) return;

    table.classList.add(`${P}-records-table`);

    Array.from(table.tBodies || []).forEach(tbody => {
      Array.from(tbody.rows || []).forEach(row => {
        if (!row.cells.length) return;

        const cell =
          row.cells[row.cells.length - 1];

        cell.classList.add(`${P}-action-cell`);

        const buttons = Array.from(
          cell.querySelectorAll("button")
        );

        buttons.forEach(button => {
          button.classList.add(`${P}-action-button`);
        });

        if (buttons.length >= 2) {
          const wrapper = common(buttons);

          if (
            wrapper &&
            wrapper !== cell &&
            cell.contains(wrapper)
          ) {
            wrapper.classList.add(`${P}-actions`);
          }
        }
      });
    });
  }

  function decorate() {
    document.body.classList.add(`${P}-ready`);
    document.body.dataset.sfr21Ready = "1";

    decorateFilter();
    decorateKpi();
    decorateReference();
    decorateTabs();
    decorateRecords();
  }

  let timer = 0;

  function queue() {
    clearTimeout(timer);
    timer = setTimeout(decorate, 50);
  }

  function start() {
    decorate();

    new MutationObserver(queue).observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
/* ===== /SOLID_FUEL_REAL_PAGE_REDESIGN_V21 ===== */
