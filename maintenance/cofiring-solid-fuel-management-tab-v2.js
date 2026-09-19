(() => {
  "use strict";

  /* COFIRING SOLID FUEL MANAGEMENT TAB V2 R5 MODE RESET */
  const ROOT_SELECTOR = "[data-cofiring-draft-root]";
  const TABS_SELECTOR = ".cfv12-tabs";
  const SHEET_SELECTOR = ".cfv5-sheet";
  const TOOLBAR_SELECTOR = ".cfv12-toolbar";
  const BUTTON_ID = "cfvSolidFuelManagementTab";
  const PANEL_ID = "cfvSolidFuelManagementPanel";
  const FRAME_ID = "cfvSolidFuelManagementFrame";
  const ROUTE = "/maintenance/solid-fuel-trouble?embed=cofiring";
  const HIDDEN_CLASS = "cfv-sfm-hidden-by-v2r2";

  function textOf(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function classifyTabs(tabs) {
    for (const item of Array.from(tabs.children)) {
      item.classList.add("cfv-top-tab-v2");
      const text = textOf(item);

      item.classList.toggle("is-calc", text.includes("혼소율 계산"));
      item.classList.toggle("is-history", text.includes("마감 데이터"));
      item.classList.toggle(
        "is-settings",
        text.includes("발열량/보정계수") ||
          text.includes("발열량 · 보정계수") ||
          text.includes("발열량 보정계수")
      );
      item.classList.toggle("is-management", text.includes("고형연료 관리"));
    }
  }

  function createButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className =
      "cfv12-tab cfv-top-tab-v2 cfv-solid-fuel-management-tab is-management";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.setAttribute("aria-controls", PANEL_ID);
    button.textContent = "고형연료 관리";
    return button;
  }

  function embeddedDocumentHeight(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc) return 0;
      const html = doc.documentElement;
      const body = doc.body;
      return Math.max(
        html?.scrollHeight || 0,
        html?.offsetHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0
      );
    } catch (_) {
      return 0;
    }
  }

  function resizeFrameToContent(frame) {
    if (!frame || frame.hidden) return;

    // First collapse the old explicit height so scrollHeight is measured
    // from document content rather than a previously oversized iframe.
    frame.style.height = "1px";

    window.requestAnimationFrame(() => {
      const measured = embeddedDocumentHeight(frame);
      const next = Math.max(720, measured + 8);
      frame.style.height = `${next}px`;
    });
  }

  function scheduleFrameResize(frame) {
    for (const delay of [0, 80, 220, 500, 1000]) {
      window.setTimeout(() => resizeFrameToContent(frame), delay);
    }
  }

  function findEmbeddedTab(doc, label) {
    return Array.from(doc.querySelectorAll("button,[role='tab'],a")).find((node) => {
      const text = textOf(node);
      return text === label || text.startsWith(`${label} `);
    }) || null;
  }

  function normalizeEmbeddedTabOrder(doc) {
    const unloadingTab = findEmbeddedTab(doc, "하역 기록");
    const troubleTab = findEmbeddedTab(doc, "Trouble 내역");

    if (
      unloadingTab &&
      troubleTab &&
      unloadingTab.parentElement &&
      unloadingTab.parentElement === troubleTab.parentElement &&
      unloadingTab.nextElementSibling !== troubleTab
    ) {
      troubleTab.parentElement.insertBefore(unloadingTab, troubleTab);
    }

    return { unloadingTab, troubleTab };
  }

  function activateDefaultUnloading(doc, frame) {
    if (!doc?.documentElement) return;

    const { unloadingTab } = normalizeEmbeddedTabOrder(doc);
    if (!unloadingTab) return;

    if (doc.documentElement.dataset.cfvDefaultUnloadingActivated !== "1") {
      doc.documentElement.dataset.cfvDefaultUnloadingActivated = "1";
      unloadingTab.click();
    }

    scheduleFrameResize(frame);
  }


  function prepareEmbeddedDocument(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc) return;

      doc.documentElement.classList.add("cfv-cofiring-embedded");
      doc.body?.classList.add("cfv-cofiring-embedded");

      for (const node of Array.from(doc.querySelectorAll("a,button"))) {
        const label = textOf(node);
        if (label === "업무일지로 돌아가기") {
          node.style.display = "none";
        }
      }

      for (const heading of Array.from(doc.querySelectorAll("h1,h2"))) {
        if (textOf(heading).includes("고형연료 Trouble")) {
          heading.textContent = "고형연료 관리";
        }
      }

      if (!doc.getElementById("cfvCofiringEmbeddedStyleR2")) {
        const style = doc.createElement("style");
        style.id = "cfvCofiringEmbeddedStyleR2";
        style.textContent = `
          html.cfv-cofiring-embedded,
          body.cfv-cofiring-embedded {
            min-width: 0 !important;
            width: 100% !important;
            max-width: none !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: hidden !important;
            background: #f7fafc !important;
          }

          body.cfv-cofiring-embedded {
            margin: 0 !important;
            padding: 9px !important;
            box-sizing: border-box !important;
            font-size: 11px !important;
            line-height: 1.28 !important;
          }

          body.cfv-cofiring-embedded > * {
            max-width: none !important;
          }

          body.cfv-cofiring-embedded h1 {
            margin: 0 0 4px !important;
            font-size: 25px !important;
            line-height: 1.05 !important;
            letter-spacing: -0.025em !important;
          }

          body.cfv-cofiring-embedded h2,
          body.cfv-cofiring-embedded h3 {
            margin-top: 0 !important;
            margin-bottom: 6px !important;
            font-size: 13px !important;
            line-height: 1.15 !important;
          }

          body.cfv-cofiring-embedded p {
            margin-top: 3px !important;
            margin-bottom: 6px !important;
            font-size: 10px !important;
            line-height: 1.3 !important;
          }

          body.cfv-cofiring-embedded button,
          body.cfv-cofiring-embedded input,
          body.cfv-cofiring-embedded select,
          body.cfv-cofiring-embedded textarea {
            min-height: 31px !important;
            padding: 5px 9px !important;
            font-size: 10.5px !important;
            line-height: 1.15 !important;
            box-sizing: border-box !important;
          }

          body.cfv-cofiring-embedded label {
            font-size: 9.5px !important;
            line-height: 1.15 !important;
          }

          body.cfv-cofiring-embedded table {
            width: 100% !important;
            font-size: 10.5px !important;
            line-height: 1.18 !important;
            border-collapse: collapse !important;
          }

          body.cfv-cofiring-embedded table th,
          body.cfv-cofiring-embedded table td {
            height: auto !important;
            padding: 6px 7px !important;
            font-size: 10.5px !important;
            line-height: 1.18 !important;
            vertical-align: middle !important;
          }

          body.cfv-cofiring-embedded [role="tab"] {
            min-height: 32px !important;
            padding: 5px 12px !important;
            font-size: 10.5px !important;
          }

          body.cfv-cofiring-embedded header,
          body.cfv-cofiring-embedded section {
            margin-top: 0 !important;
          }
        `;
        doc.head.append(style);
      }

      if (doc.documentElement.dataset.cfvOuterScrollBound !== "1") {
        doc.documentElement.dataset.cfvOuterScrollBound = "1";

        const resync = () => scheduleFrameResize(frame);
        doc.addEventListener("click", resync, true);
        doc.addEventListener("change", resync, true);
        doc.addEventListener("input", resync, true);
        doc.addEventListener("submit", resync, true);
      }

      for (const delay of [40, 160, 450, 900]) {
        window.setTimeout(() => activateDefaultUnloading(doc, frame), delay);
      }
      scheduleFrameResize(frame);
    } catch (_) {
      // Same-origin is expected. If access fails, the page still renders.
    }
  }

  function createPanel() {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "cfv-solid-fuel-management-panel";
    panel.hidden = true;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", BUTTON_ID);

    const frame = document.createElement("iframe");
    frame.id = FRAME_ID;
    frame.className = "cfv-solid-fuel-management-frame";
    frame.title = "고형연료 관리";
    frame.loading = "lazy";
    frame.scrolling = "no";
    frame.src = ROUTE;

    frame.addEventListener("load", () => {
      prepareEmbeddedDocument(frame);
      scheduleFrameResize(frame);
    });

    panel.append(frame);
    return panel;
  }

  function removeLegacyTroubleTab(tabs) {
    for (const node of Array.from(tabs.children)) {
      if (
        node.id === "cfvSolidFuelTroubleTab" ||
        textOf(node).includes("고형연료 Trouble")
      ) {
        node.remove();
      }
    }
  }

  function findCalcTab(tabs) {
    return (
      Array.from(tabs.children).find((node) =>
        textOf(node).includes("혼소율 계산")
      ) || null
    );
  }

  function isPersistentSheetChild(child, panel) {
    if (!child || child === panel) return true;
    if (child.matches?.(".cfv5-title-row")) return true;
    if (child.matches?.(TOOLBAR_SELECTOR)) return true;
    if (child.querySelector?.(`#${BUTTON_ID}`)) return true;
    return false;
  }

  function toggleSheetSections(sheet, panel, enabled) {
    for (const child of Array.from(sheet.children)) {
      if (isPersistentSheetChild(child, panel)) continue;
      child.classList.toggle(HIDDEN_CLASS, enabled);
    }
  }

  function clearForeignSheetModes(sheet) {
    if (!sheet) return;

    for (const className of Array.from(sheet.classList)) {
      if (className === "cfv-solid-fuel-management-mode") continue;

      if (
        className.endsWith("-mode") ||
        className.includes("history-mode") ||
        className.includes("settings-mode")
      ) {
        sheet.classList.remove(className);
      }
    }

    // Explicit compatibility with the currently deployed history/settings tabs.
    sheet.classList.remove(
      "cfv12-history-mode",
      "cfv12-settings-history-mode",
      "cfv-settings-history-mode",
      "cfv-settings-mode"
    );
  }

  function setManagementMode(root, sheet, tabs, button, panel, enabled) {
    if (enabled) {
      // History/settings tabs leave their own *-mode class on the sheet.
      // Those classes intentionally hide every non-owned panel, including
      // Solid Fuel Management. Clear them before enabling management.
      clearForeignSheetModes(sheet);
    }

    sheet.classList.toggle("cfv-solid-fuel-management-mode", enabled);
    root.classList.toggle("cfv-solid-fuel-management-mode-active", enabled);
    panel.hidden = !enabled;
    button.setAttribute("aria-selected", enabled ? "true" : "false");

    if (enabled) {
      for (const tab of Array.from(tabs.children)) {
        if (tab !== button && tab.matches?.("[aria-selected]")) {
          tab.setAttribute("aria-selected", "false");
        }
      }
    }

    toggleSheetSections(sheet, panel, enabled);

    const frame = panel.querySelector(`#${FRAME_ID}`);
    if (enabled && frame) {
      prepareEmbeddedDocument(frame);
      scheduleFrameResize(frame);

      // Re-assert after the current click stack in case an older delegated
      // tab handler finishes later in the same event cycle.
      window.setTimeout(() => {
        clearForeignSheetModes(sheet);
        sheet.classList.add("cfv-solid-fuel-management-mode");
        root.classList.add("cfv-solid-fuel-management-mode-active");
        panel.hidden = false;
        button.setAttribute("aria-selected", "true");
        toggleSheetSections(sheet, panel, true);
        scheduleFrameResize(frame);
      }, 0);
    }
  }

  function bind(root, sheet, tabs, button, panel) {
    if (tabs.dataset.cfvSolidFuelManagementBound === "1") return;
    tabs.dataset.cfvSolidFuelManagementBound = "1";

    tabs.addEventListener("click", (event) => {
      const clicked = event.target.closest(".cfv12-tab, .cfv-top-tab-v2");
      if (!clicked || !tabs.contains(clicked)) return;

      if (clicked === button) {
        event.preventDefault();
        setManagementMode(root, sheet, tabs, button, panel, true);
        return;
      }

      setManagementMode(root, sheet, tabs, button, panel, false);
    });

    window.addEventListener("resize", () => {
      if (!sheet.classList.contains("cfv-solid-fuel-management-mode")) return;
      const frame = panel.querySelector(`#${FRAME_ID}`);
      if (frame) scheduleFrameResize(frame);
    });
  }

  function enhance() {
    // Login-safe: no co-firing root means no work.
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return false;

    const tabs = root.querySelector(TABS_SELECTOR);
    if (!tabs) return false;

    const sheet = tabs.closest(SHEET_SELECTOR);
    if (!sheet) return false;

    tabs.classList.add("cfv-top-tabs-v2");
    removeLegacyTroubleTab(tabs);

    let button = tabs.querySelector(`#${BUTTON_ID}`);
    if (!button) button = createButton();

    // Required order: Calculation first, Solid Fuel Management second.
    const calc = findCalcTab(tabs);
    if (calc && tabs.firstElementChild !== calc) {
      tabs.insertBefore(calc, tabs.firstElementChild);
    }

    if (calc) {
      if (calc.nextElementSibling !== button) {
        calc.insertAdjacentElement("afterend", button);
      }
    } else if (!button.isConnected) {
      tabs.prepend(button);
    }

    let panel = sheet.querySelector(`:scope > #${PANEL_ID}`);
    if (!panel) {
      panel = createPanel();
      const toolbar = tabs.closest(TOOLBAR_SELECTOR);
      const anchor = toolbar || tabs;
      anchor.insertAdjacentElement("afterend", panel);
    }

    bind(root, sheet, tabs, button, panel);
    classifyTabs(tabs);

    if (!sheet.classList.contains("cfv-solid-fuel-management-mode")) {
      toggleSheetSections(sheet, panel, false);
    }

    return true;
  }

  function scheduleEnhance() {
    window.setTimeout(enhance, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }

  // Deliberately no MutationObserver: avoid startup/login feedback loops.
  document.addEventListener("click", scheduleEnhance, true);
  window.addEventListener("focus", scheduleEnhance);

  for (const delay of [120, 350, 800, 1500, 3000, 6000, 10000]) {
    window.setTimeout(enhance, delay);
  }
})();

/* ===== SOLID_FUEL_MANAGEMENT_READABILITY_V15 ===== */
(() => {
  'use strict';

  const MARK = 'sfux15';

  const normalize = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

  function exact(root, text, selector = '*') {
    if (!(root instanceof Element || root instanceof Document)) {
      return null;
    }

    return Array.from(
      root.querySelectorAll(selector)
    ).find(
      element =>
        normalize(element.textContent) === text
    ) || null;
  }

  function commonAncestor(elements) {
    const list = elements.filter(
      element => element instanceof Element
    );

    if (!list.length) {
      return null;
    }

    let node = list[0];

    while (node && node !== document.body) {
      if (
        list.every(
          element =>
            node === element ||
            node.contains(element)
        )
      ) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  function ancestorContaining(
    element,
    requiredTexts,
    maxDepth = 10
  ) {
    let node = element;

    for (
      let depth = 0;
      node && depth < maxDepth;
      depth += 1, node = node.parentElement
    ) {
      const value = normalize(node.textContent);

      if (
        requiredTexts.every(
          text => value.includes(text)
        )
      ) {
        return node;
      }
    }

    return null;
  }

  function findRoot() {
    const title =
      exact(
        document,
        '고형연료 관리',
        'h1,h2,h3,h4,strong,div'
      );

    if (!(title instanceof Element)) {
      return null;
    }

    return (
      ancestorContaining(
        title,
        [
          '하역시간 참고 데이터',
          '하역시간 기록'
        ],
        14
      ) ||
      title.closest('section,article,div')
    );
  }

  function decorateQuery(root) {
    const monthly =
      exact(root, '월별', 'button');

    const period =
      exact(root, '기간 지정', 'button');

    const all =
      exact(root, '전체', 'button');

    if (!monthly || !period || !all) {
      return;
    }

    const bar =
      commonAncestor([
        monthly,
        period,
        all
      ]);

    if (!(bar instanceof Element)) {
      return;
    }

    bar.classList.add(
      `${MARK}-query`
    );

    bar
      .querySelectorAll(
        'label,button,input,select'
      )
      .forEach(element => {
        element.classList.add(
          `${MARK}-query-control`
        );
      });
  }

  function decorateKpi(root) {
    const names = [
      '하역',
      '평균 하역',
      'Trouble',
      '이상·막힘',
      '최장 하역'
    ];

    const elements =
      names.map(
        name =>
          exact(
            root,
            name,
            'span,strong,b,div'
          )
      );

    if (elements.some(element => !element)) {
      return;
    }

    const group =
      commonAncestor(elements);

    if (!(group instanceof Element)) {
      return;
    }

    group.classList.add(
      `${MARK}-kpi`
    );

    Array.from(group.children)
      .forEach(child => {
        child.classList.add(
          `${MARK}-kpi-card`
        );
      });
  }

  function decorateReference(root) {
    const title =
      exact(
        root,
        '하역시간 참고 데이터',
        'h1,h2,h3,h4,strong,div'
      );

    if (!(title instanceof Element)) {
      return;
    }

    const section =
      ancestorContaining(
        title,
        [
          '업체별 하역시간',
          'Silo별 평균'
        ],
        10
      );

    if (!(section instanceof Element)) {
      return;
    }

    section.classList.add(
      `${MARK}-reference`
    );

    const companyTitle =
      exact(
        section,
        '업체별 하역시간',
        'h1,h2,h3,h4,strong,div'
      );

    const siloTitle =
      exact(
        section,
        'Silo별 평균',
        'h1,h2,h3,h4,strong,div'
      );

    const companyTable =
      companyTitle
        ?.parentElement
        ?.querySelector('table') ||
      section.querySelector('table');

    if (companyTable instanceof HTMLTableElement) {
      companyTable.classList.add(
        `${MARK}-company-table`
      );

      let panel =
        companyTable.parentElement;

      if (panel) {
        panel.classList.add(
          `${MARK}-company-panel`
        );
      }
    }

    if (siloTitle instanceof Element) {
      const siloPanel =
        ancestorContaining(
          siloTitle,
          ['#A', '#B', 'Day'],
          7
        );

      if (siloPanel instanceof Element) {
        siloPanel.classList.add(
          `${MARK}-silo-panel`
        );

        Array.from(
          siloPanel.querySelectorAll(
            'div'
          )
        ).forEach(element => {
          const text =
            normalize(element.textContent);

          if (
            (
              text.includes('#A') ||
              text.includes('#B') ||
              text.includes('Day')
            ) &&
            element.children.length <= 4
          ) {
            element.classList.add(
              `${MARK}-silo-card`
            );
          }
        });
      }
    }

    /*
      실제 좌/우 panel의 공통 부모를 찾아
      68 : 32 구조 적용
    */
    const companyPanel =
      section.querySelector(
        `.${MARK}-company-panel`
      );

    const siloPanel =
      section.querySelector(
        `.${MARK}-silo-panel`
      );

    if (companyPanel && siloPanel) {
      const pair =
        commonAncestor([
          companyPanel,
          siloPanel
        ]);

      if (pair instanceof Element) {
        pair.classList.add(
          `${MARK}-reference-grid`
        );
      }
    }
  }

  function decorateRecords(root) {
    const title =
      exact(
        root,
        '하역시간 기록',
        'h1,h2,h3,h4,strong,div'
      );

    if (!(title instanceof Element)) {
      return;
    }

    const section =
      ancestorContaining(
        title,
        [
          '날짜',
          '입고',
          '출고',
          '소요',
          '업체',
          '차량'
        ],
        10
      );

    if (!(section instanceof Element)) {
      return;
    }

    section.classList.add(
      `${MARK}-records`
    );

    const table =
      section.querySelector('table');

    if (table instanceof HTMLTableElement) {
      table.classList.add(
        `${MARK}-records-table`
      );
    }
  }

  function decorate() {
    const root = findRoot();

    if (!(root instanceof Element)) {
      return false;
    }

    root.classList.add(
      `${MARK}-root`
    );

    decorateQuery(root);
    decorateKpi(root);
    decorateReference(root);
    decorateRecords(root);

    return true;
  }

  let timer = 0;

  function queue() {
    clearTimeout(timer);

    timer = window.setTimeout(
      decorate,
      40
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        decorate();

        new MutationObserver(queue)
          .observe(
            document.body,
            {
              childList: true,
              subtree: true
            }
          );
      },
      { once: true }
    );
  }
  else {
    decorate();

    new MutationObserver(queue)
      .observe(
        document.body,
        {
          childList: true,
          subtree: true
        }
      );
  }
})();
/* ===== /SOLID_FUEL_MANAGEMENT_READABILITY_V15 ===== */

/* ===== SOLID_FUEL_NATIVE_REDESIGN_V20_R3 ===== */
(() => {
  'use strict';

  const PREFIX = 'sfm20';

  function normalize(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function exact(root, text, selector = '*') {
    if (!root?.querySelectorAll) return null;

    const matches = Array.from(
      root.querySelectorAll(selector)
    ).filter(
      element =>
        normalize(element.textContent) === text
    );

    matches.sort((a, b) => {
      const aChildren =
        a.querySelectorAll('*').length;

      const bChildren =
        b.querySelectorAll('*').length;

      return aChildren - bChildren;
    });

    return matches[0] || null;
  }

  function commonAncestor(elements) {
    const list = elements.filter(
      element => element instanceof Element
    );

    if (!list.length) return null;

    let node = list[0];

    while (
      node &&
      node !== document.documentElement
    ) {
      if (
        list.every(
          element =>
            node === element ||
            node.contains(element)
        )
      ) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  function climb(
    element,
    predicate,
    maxDepth = 14
  ) {
    let node = element;

    for (
      let i = 0;
      node && i < maxDepth;
      i += 1
    ) {
      if (predicate(node)) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  function childWithin(parent, element) {
    let node = element;

    while (
      node &&
      node.parentElement !== parent
    ) {
      node = node.parentElement;
    }

    return (
      node &&
      node.parentElement === parent
    )
      ? node
      : null;
  }

  function findRoot() {
    const titles = Array.from(
      document.querySelectorAll(
        'h1,h2,h3,h4,strong,b,span,div'
      )
    ).filter(
      element =>
        normalize(element.textContent) ===
        '고형연료 관리'
    );

    for (const title of titles) {
      const root = climb(
        title,
        node => {
          const text =
            normalize(node.textContent);

          return (
            text.includes(
              '하역시간 참고 데이터'
            ) &&
            (
              text.includes(
                '하역시간 기록'
              ) ||
              text.includes(
                'Trouble 내역'
              )
            )
          );
        },
        16
      );

      if (root) {
        return root;
      }
    }

    return null;
  }

  function decorateFilter(root) {
    const monthly =
      exact(root, '월별', 'button');

    const period =
      exact(root, '기간 지정', 'button');

    const all =
      exact(root, '전체', 'button');

    const labelTexts = [
      '조회 월',
      '업체명',
      '차량번호',
      '통합 검색',
      '정렬'
    ];

    const labelNodes =
      labelTexts
        .map(
          text =>
            exact(
              root,
              text,
              'label,span,b,strong,div'
            )
        )
        .filter(Boolean);

    if (
      !monthly ||
      !period ||
      !all ||
      labelNodes.length < 4
    ) {
      return;
    }

    const filter =
      commonAncestor([
        monthly,
        period,
        all,
        ...labelNodes
      ]);

    if (!(filter instanceof Element)) {
      return;
    }

    filter.classList.add(
      `${PREFIX}-filter`
    );

    [monthly, period, all]
      .forEach(button => {
        button.classList.add(
          `${PREFIX}-mode-button`
        );
      });

    labelTexts.forEach(
      (text, index) => {
        const titleNode =
          exact(
            filter,
            text,
            'label,span,b,strong,div'
          );

        if (!titleNode) return;

        const field =
          climb(
            titleNode,
            node => {
              if (
                node === filter
              ) {
                return false;
              }

              return Boolean(
                node.querySelector?.(
                  'input,select'
                )
              );
            },
            5
          );

        if (!(field instanceof Element)) {
          return;
        }

        field.classList.add(
          `${PREFIX}-field`
        );

        field.dataset.sfm20Field =
          [
            'month',
            'company',
            'vehicle',
            'search',
            'sort'
          ][index] || '';
      }
    );

    const buttons =
      Array.from(
        filter.querySelectorAll(
          'button'
        )
      );

    buttons.forEach(button => {
      const text =
        normalize(button.textContent);

      if (text === '조회') {
        button.classList.add(
          `${PREFIX}-search-button`
        );
      }

      if (text === '초기화') {
        button.classList.add(
          `${PREFIX}-reset-button`
        );
      }
    });
  }

  function decorateKpi(root) {
    const labels = [
      '하역',
      '평균 하역',
      'Trouble',
      '이상·막힘',
      '최장 하역'
    ];

    const nodes =
      labels.map(
        text =>
          exact(
            root,
            text,
            'span,b,strong,div'
          )
      );

    if (
      nodes.some(node => !node)
    ) {
      return;
    }

    const group =
      commonAncestor(nodes);

    if (!(group instanceof Element)) {
      return;
    }

    group.classList.add(
      `${PREFIX}-kpi`
    );

    nodes.forEach(
      (node, index) => {
        const card =
          childWithin(
            group,
            node
          );

        if (!card) return;

        card.classList.add(
          `${PREFIX}-kpi-card`
        );

        card.dataset.sfm20Kpi =
          String(index + 1);
      }
    );
  }

  function decorateReference(root) {
    const refTitle =
      exact(
        root,
        '하역시간 참고 데이터',
        'h1,h2,h3,h4,strong,b,div'
      );

    if (!refTitle) return;

    const section =
      climb(
        refTitle,
        node => {
          const text =
            normalize(node.textContent);

          return (
            text.includes(
              '업체별 하역시간'
            ) &&
            text.includes(
              'Silo별 평균'
            )
          );
        },
        10
      );

    if (!(section instanceof Element)) {
      return;
    }

    section.classList.add(
      `${PREFIX}-reference`
    );

    const companyTitle =
      exact(
        section,
        '업체별 하역시간',
        'h1,h2,h3,h4,strong,b,div'
      );

    const companyTable =
      companyTitle
        ? climb(
            companyTitle,
            node =>
              Boolean(
                node.querySelector?.(
                  'table'
                )
              ),
            6
          )?.querySelector('table')
        : section.querySelector(
            'table'
          );

    let companyPanel = null;

    if (
      companyTable instanceof
      HTMLTableElement
    ) {
      companyTable.classList.add(
        `${PREFIX}-company-table`
      );

      companyPanel =
        companyTable.parentElement;

      companyPanel?.classList.add(
        `${PREFIX}-company-panel`
      );
    }

    const siloTitle =
      exact(
        section,
        'Silo별 평균',
        'h1,h2,h3,h4,strong,b,div'
      );

    let siloPanel = null;

    if (siloTitle) {
      siloPanel =
        climb(
          siloTitle,
          node => {
            const text =
              normalize(node.textContent);

            return (
              text.includes('#A') &&
              text.includes('#B') &&
              text.includes('Day')
            );
          },
          7
        );

      siloPanel?.classList.add(
        `${PREFIX}-silo-panel`
      );
    }

    if (
      companyPanel &&
      siloPanel
    ) {
      const pair =
        commonAncestor([
          companyPanel,
          siloPanel
        ]);

      pair?.classList.add(
        `${PREFIX}-reference-grid`
      );
    }

    if (siloPanel) {
      const possible =
        Array.from(
          siloPanel.children
        );

      possible.forEach(child => {
        const text =
          normalize(child.textContent);

        if (
          text.includes('#A') ||
          text.includes('#B') ||
          /^Day\b/.test(text)
        ) {
          child.classList.add(
            `${PREFIX}-silo-card`
          );
        }
      });
    }
  }

  function decorateRecords(root) {
    const title =
      exact(
        root,
        '하역시간 기록',
        'h1,h2,h3,h4,strong,b,div'
      );

    if (!title) return;

    const section =
      climb(
        title,
        node => {
          const text =
            normalize(node.textContent);

          return (
            text.includes('날짜') &&
            text.includes('입고') &&
            text.includes('출고') &&
            text.includes('소요') &&
            text.includes('업체') &&
            text.includes('차량')
          );
        },
        10
      );

    if (!(section instanceof Element)) {
      return;
    }

    section.classList.add(
      `${PREFIX}-records`
    );

    const table =
      section.querySelector(
        'table'
      );

    if (!(table instanceof HTMLTableElement)) {
      return;
    }

    table.classList.add(
      `${PREFIX}-records-table`
    );

    Array.from(
      table.tBodies
    ).forEach(tbody => {
      Array.from(
        tbody.rows
      ).forEach(row => {
        const cell =
          row.cells[
            row.cells.length - 1
          ];

        if (!cell) return;

        const buttons =
          Array.from(
            cell.querySelectorAll(
              'button'
            )
          );

        if (buttons.length < 2) {
          return;
        }

        const actions =
          commonAncestor(buttons);

        if (
          actions &&
          cell.contains(actions)
        ) {
          actions.classList.add(
            `${PREFIX}-actions`
          );
        }
      });
    });
  }

  function decorateTabs(root) {
    const unload =
      exact(
        root,
        '하역 기록',
        'button'
      );

    const trouble =
      exact(
        root,
        'Trouble 내역',
        'button'
      );

    if (!unload || !trouble) {
      return;
    }

    unload.classList.add(
      `${PREFIX}-record-tab`
    );

    trouble.classList.add(
      `${PREFIX}-record-tab`
    );

    const tabs =
      commonAncestor([
        unload,
        trouble
      ]);

    tabs?.classList.add(
      `${PREFIX}-record-tabs`
    );
  }

  function decorate() {
    const root = findRoot();

    if (!(root instanceof Element)) {
      return false;
    }

    root.classList.add(
      `${PREFIX}-root`
    );

    decorateFilter(root);
    decorateKpi(root);
    decorateReference(root);
    decorateRecords(root);
    decorateTabs(root);

    return true;
  }

  let timer = 0;

  function queue() {
    clearTimeout(timer);

    timer = setTimeout(
      decorate,
      50
    );
  }

  function start() {
    decorate();

    const observer =
      new MutationObserver(queue);

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  }
  else {
    start();
  }
})();
/* ===== /SOLID_FUEL_NATIVE_REDESIGN_V20_R3 ===== */
