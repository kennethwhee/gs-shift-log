(() => {
  'use strict';

  const VERSION = 'EFFICIENCY_DAILY_WORK_POPUP_V1';
  const PARAM = 'efficiencyDailyWorkWindow';
  const WINDOW_NAME = 'gsEfficiencyDailyWorkStatus';
  const BOOT_CLASS = 'efficiency-daily-work-boot';

  if (window.__gsEfficiencyDailyWorkPopupV1) return;
  window.__gsEfficiencyDailyWorkPopupV1 = true;

  const normalizeText = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

  const elementText = (element) =>
    normalizeText(element?.innerText || element?.textContent || '');

  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;

    const style = window.getComputedStyle(element);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();

    return rect.width > 0 && rect.height > 0;
  };

  const isChildWindow = () => {
    try {
      return new URL(window.location.href)
        .searchParams
        .get(PARAM) === '1';
    } catch {
      return false;
    }
  };

  const getClickable = (target) => {
    if (!(target instanceof Element)) return null;

    return target.closest(
      'button, a, [role="button"], input[type="button"], input[type="submit"]'
    );
  };

  const looksLikeEfficiencyArea = (element) => {
    let current = element;

    for (let depth = 0; current && depth < 12; depth += 1) {
      const text = elementText(current);

      if (
        text.includes('효율팀') &&
        text.includes('오전회의자료') &&
        text.includes('혼소율')
      ) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  };

  const isDailyWorkButton = (element) => {
    if (!element) return false;

    const text = elementText(element);

    if (
      text !== '일일업무현황' &&
      !text.startsWith('일일업무현황 ')
    ) {
      return false;
    }

    return looksLikeEfficiencyArea(element);
  };

  const makePopupUrl = () => {
    const url = new URL(window.location.href);

    url.searchParams.set(PARAM, '1');
    url.hash = 'efficiency-daily-work';

    return url.href;
  };

  const openDailyWorkWindow = () => {
    const availableWidth =
      window.screen?.availWidth ||
      window.screen?.width ||
      1600;

    const availableHeight =
      window.screen?.availHeight ||
      window.screen?.height ||
      950;

    const width = Math.min(1600, Math.max(1200, availableWidth - 80));
    const height = Math.min(950, Math.max(760, availableHeight - 80));

    const left = Math.max(
      0,
      Math.round((availableWidth - width) / 2)
    );

    const top = Math.max(
      0,
      Math.round((availableHeight - height) / 2)
    );

    const features = [
      'popup=yes',
      'resizable=yes',
      'scrollbars=yes',
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`
    ].join(',');

    const popup = window.open(
      makePopupUrl(),
      WINDOW_NAME,
      features
    );

    if (!popup) {
      window.alert(
        '일일업무현황 새 창이 차단되었습니다.\n' +
        '브라우저 주소창의 팝업 차단 아이콘에서 이 사이트의 팝업을 허용해주세요.'
      );
      return;
    }

    try {
      popup.focus();
    } catch (_) {
      // Ignore focus restrictions.
    }
  };

  /*
   * Parent window
   * Efficiency Team > Daily Work Status only.
   */
  document.addEventListener(
    'click',
    (event) => {
      if (isChildWindow()) return;

      const clickable = getClickable(event.target);

      if (!isDailyWorkButton(clickable)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openDailyWorkWindow();
    },
    true
  );

  const findVisibleClickableByExactText = (wantedText) => {
    const candidates = document.querySelectorAll(
      'button, a, [role="button"]'
    );

    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;

      if (elementText(candidate) === wantedText) {
        return candidate;
      }
    }

    return null;
  };

  const findEfficiencyLauncher = () => {
    const candidates = document.querySelectorAll(
      'button, a, [role="button"]'
    );

    const matches = [];

    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      if (elementText(candidate) !== '효율팀') continue;

      matches.push(candidate);
    }

    if (!matches.length) return null;

    /*
     * Prefer header / navigation launcher if several "효율팀"
     * elements exist.
     */
    const navigationMatch = matches.find((candidate) =>
      candidate.closest(
        'header, nav, [class*="header"], [class*="nav"]'
      )
    );

    return navigationMatch || matches[0];
  };

  const findDailyWorkInsideEfficiency = () => {
    const candidates = document.querySelectorAll(
      'button, a, [role="button"]'
    );

    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      if (!isDailyWorkButton(candidate)) continue;

      return candidate;
    }

    return null;
  };

  const waitFor = (
    finder,
    timeoutMs = 12000,
    intervalMs = 80
  ) =>
    new Promise((resolve) => {
      const startedAt = Date.now();

      const check = () => {
        const found = finder();

        if (found) {
          resolve(found);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(null);
          return;
        }

        window.setTimeout(check, intervalMs);
      };

      check();
    });

  const installStandaloneStyles = () => {
    if (document.getElementById('efficiencyDailyWorkStandaloneV2Style')) {
      return;
    }

    const style = document.createElement('style');

    style.id = 'efficiencyDailyWorkStandaloneV2Style';

    style.textContent = `
      html[data-efficiency-daily-work-window="1"],
      html[data-efficiency-daily-work-window="1"] body {
        width: 100% !important;
        height: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        background: #eef3f8 !important;
      }

      html[data-efficiency-daily-work-window="1"] body * {
        visibility: hidden !important;
      }

      html[data-efficiency-daily-work-window="1"]
      [data-efficiency-daily-work-standalone="1"],
      html[data-efficiency-daily-work-window="1"]
      [data-efficiency-daily-work-standalone="1"] * {
        visibility: visible !important;
      }

      html[data-efficiency-daily-work-window="1"]
      [data-efficiency-daily-work-standalone="1"] {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;

        display: block !important;

        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        min-width: 0 !important;
        min-height: 0 !important;

        margin: 0 !important;
        padding: 12px !important;

        border: 0 !important;
        border-radius: 0 !important;

        box-sizing: border-box !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;

        background: #eef3f8 !important;
        box-shadow: none !important;
      }
    `;

    document.head.appendChild(style);
  };

  const findStandaloneWorkspace = () => {
    const requiredTexts = [
      '일일업무현황',
      '날짜별 보관함',
      'PDF 미리보기',
      '저장'
    ];

    const candidates = Array.from(
      document.querySelectorAll(
        'main, section, article, div'
      )
    ).filter((element) => {
      if (!isVisible(element)) return false;

      const text = elementText(element);

      return requiredTexts.every(
        (requiredText) => text.includes(requiredText)
      );
    });

    if (!candidates.length) return null;

    /*
     * The page root and the efficiency dialog also contain the same text.
     * Prefer the smallest visible container that contains every
     * Daily Work control. This resolves to the actual work area.
     */
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();

      return (ar.width * ar.height) - (br.width * br.height);
    });

    return candidates[0];
  };

  const installStandaloneWheelScroll = (workspace) => {
    if (window.__gsEfficiencyDailyWorkWheelGuardV6) {
      return;
    }

    window.__gsEfficiencyDailyWorkWheelGuardV6 = true;

    const canScrollElement = (element, deltaY) => {
      if (!(element instanceof HTMLElement)) return false;

      const maxScroll =
        element.scrollHeight - element.clientHeight;

      if (maxScroll <= 1) return false;

      if (deltaY < 0) {
        return element.scrollTop > 0;
      }

      if (deltaY > 0) {
        return element.scrollTop < maxScroll - 1;
      }

      return false;
    };

    const findNestedScrollable = (target, deltaY) => {
      let current =
        target instanceof Element
          ? target
          : null;

      while (
        current &&
        current !== workspace
      ) {
        if (current instanceof HTMLElement) {
          const style = window.getComputedStyle(current);

          const allowsVerticalScroll =
            style.overflowY === 'auto' ||
            style.overflowY === 'scroll';

          if (
            allowsVerticalScroll &&
            canScrollElement(current, deltaY)
          ) {
            return current;
          }
        }

        current = current.parentElement;
      }

      return null;
    };

    window.addEventListener(
      'wheel',
      (event) => {
        if (!isChildWindow()) return;

        /*
         * Keep Ctrl + wheel available for browser zoom.
         */
        if (event.ctrlKey) return;

        if (!workspace.isConnected) return;

        const deltaY = event.deltaY;

        if (!deltaY) return;

        /*
         * If the pointer is over a real nested scroll area,
         * let that element perform its native scroll.
         * Stop the original application wheel handlers from
         * cancelling the event.
         */
        const nestedScrollable =
          findNestedScrollable(
            event.target,
            deltaY
          );

        if (nestedScrollable) {
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }

        /*
         * Otherwise explicitly move the standalone workspace.
         * This bypasses legacy page/modal wheel handlers.
         */
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        let amount = deltaY;

        if (event.deltaMode === 1) {
          amount *= 18;
        } else if (event.deltaMode === 2) {
          amount *= workspace.clientHeight;
        }

        workspace.scrollTop += amount;
      },
      {
        capture: true,
        passive: false
      }
    );
  };
  const activateStandaloneWorkspace = async () => {
    const workspace = await waitFor(
      findStandaloneWorkspace,
      12000,
      80
    );

    if (!workspace) {
      console.warn(
        '[EFFICIENCY_DAILY_WORK_STANDALONE_V2] workspace not found.'
      );
      return;
    }

    workspace.setAttribute(
      'data-efficiency-daily-work-standalone',
      '1'
    );

    installStandaloneStyles();
    installStandaloneWheelScroll(workspace);

    document.documentElement.classList.remove(BOOT_CLASS);

    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;

    try {
      window.resizeTo(
        Math.min(screen.availWidth, 1700),
        Math.min(screen.availHeight, 1000)
      );
    } catch (_) {
      // Browser may restrict resizeTo.
    }
  };
  const installStandaloneEscapeGuard = () => {
    if (window.__gsEfficiencyDailyWorkEscapeGuardV5) {
      return;
    }

    window.__gsEfficiencyDailyWorkEscapeGuardV5 = true;

    /*
     * This page was opened by window.open(), so Escape should close
     * the standalone work window itself.
     *
     * Do not let the original Efficiency Team modal receive Escape.
     * Otherwise it removes the modal while standalone CSS keeps the
     * rest of the application hidden, leaving a blank page.
     */
    window.addEventListener(
      'keydown',
      (event) => {
        if (!isChildWindow()) return;
        if (event.key !== 'Escape') return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        /*
         * Standalone work window:
         * Escape must never close the window or the underlying
         * Efficiency Team modal. The operator may have unsaved work.
         *
         * Window closing is left to the browser window X control.
         */
        return;
      },
      true
    );
  };
  const initializeChildWindow = async () => {
    if (!isChildWindow()) return;

    installStandaloneEscapeGuard();

    /*
     * 정상적으로 일일업무현황이 준비되면 위에서 즉시 해제됩니다.
     * 인증/네트워크 오류 등으로 준비되지 않을 경우
     * 빈 화면에 갇히지 않도록 15초 뒤 원래 화면을 표시합니다.
     */
    window.setTimeout(() => {
      document.documentElement.classList.remove(BOOT_CLASS);
    }, 15000);

    document.documentElement.setAttribute(
      'data-efficiency-daily-work-window',
      '1'
    );

    /*
     * The efficiency dialog might already be open if the app restores UI.
     */
    let dailyButton = findDailyWorkInsideEfficiency();

    if (!dailyButton) {
      const efficiencyLauncher =
        await waitFor(findEfficiencyLauncher);

      if (!efficiencyLauncher) {
        console.warn(
          `[${VERSION}] Efficiency Team launcher not found.`
        );
        return;
      }

      efficiencyLauncher.click();

      dailyButton =
        await waitFor(findDailyWorkInsideEfficiency);
    }

    if (!dailyButton) {
      console.warn(
        `[${VERSION}] Daily Work Status button not found.`
      );
      return;
    }

    /*
     * Child window is excluded from the popup interception above,
     * so this performs the application's original tab action.
     */
    dailyButton.click();

    await activateStandaloneWorkspace();

    if (!document.title.startsWith('일일업무현황')) {
      document.title =
        `일일업무현황 | ${document.title}`;
    }
  };

  if (isChildWindow()) {
    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          window.setTimeout(initializeChildWindow, 80);
        },
        { once: true }
      );
    } else {
      window.setTimeout(initializeChildWindow, 80);
    }
  }
})();

/* =========================================================
   EFFICIENCY DAILY WORK ROW HEIGHT V1

   - Standalone Daily Work window only
   - No MutationObserver
   - No wrapping/replacing Daily Work save functions
   - No DB/API mutation
   - Per-date browser-local row height backup
========================================================= */
(() => {
  'use strict';

  const VERSION =
    'EFFICIENCY_DAILY_WORK_ROW_HEIGHT_V1';

  const WINDOW_PARAM =
    'efficiencyDailyWorkWindow';

  const STORAGE_PREFIX =
    'gs-efficiency-daily-work-row-height-v1:';

  const MIN_HEIGHT = 32;
  const MAX_HEIGHT = 360;
  const STEP = 12;

  if (window.__gsEfficiencyDailyWorkRowHeightV1) {
    return;
  }

  const isStandaloneWindow = () => {
    try {
      return (
        new URL(window.location.href)
          .searchParams
          .get(WINDOW_PARAM) === '1'
      );
    } catch {
      return false;
    }
  };

  if (!isStandaloneWindow()) {
    return;
  }

  window.__gsEfficiencyDailyWorkRowHeightV1 = true;

  let editMode = false;
  let selectedRow = null;
  let selectedRowKey = '';
  let lastDate = '';

  let toggleButton = null;
  let panel = null;
  let selectedText = null;

  const rowLabels = {
    'efficiency-overall': '효율업무 총괄',
    'efficiency-1': '효율업무1',
    'efficiency-2': '효율업무2',
    'efficiency-3': '효율업무3',
    'purchase-admin': '구매·행정업무',
    'operation-day': 'Day 근무조',
    'operation-night': 'Night 근무조'
  };

  const getDateValue = () =>
    String(
      document.getElementById(
        'efficiencyDailyWorkDate'
      )?.value || ''
    ).trim();

  const getStorageKey = dateValue =>
    `${STORAGE_PREFIX}${dateValue || 'unknown'}`;

  const loadHeights = dateValue => {
    if (!dateValue) {
      return {};
    }

    try {
      const raw =
        localStorage.getItem(
          getStorageKey(dateValue)
        );

      if (!raw) {
        return {};
      }

      const parsed =
        JSON.parse(raw);

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return {};
      }

      const result = {};

      Object.entries(parsed)
        .forEach(([rowKey, value]) => {
          const height =
            Number(value);

          if (
            /^[a-z0-9-]+$/i.test(rowKey) &&
            Number.isFinite(height)
          ) {
            result[rowKey] =
              Math.max(
                MIN_HEIGHT,
                Math.min(
                  MAX_HEIGHT,
                  Math.round(height)
                )
              );
          }
        });

      return result;

    } catch {
      return {};
    }
  };

  const saveHeights = (
    dateValue,
    heights
  ) => {
    if (!dateValue) {
      return;
    }

    try {
      localStorage.setItem(
        getStorageKey(dateValue),
        JSON.stringify(heights)
      );
    } catch (_) {
      // Local layout backup must never break the editor.
    }
  };

  const getRows = () =>
    [
      ...document.querySelectorAll(
        '#efficiencyDailyWorkPaper ' +
        '[data-efficiency-daily-work-row-key]'
      )
    ];

  const getRowKey = row =>
    String(
      row?.dataset
        ?.efficiencyDailyWorkRowKey ||
      ''
    ).trim();

  const clearRowHeight = row => {
    if (!row) {
      return;
    }

    row.style.removeProperty(
      'height'
    );

    row.querySelectorAll('td, th')
      .forEach(cell => {
        cell.style.removeProperty(
          'height'
        );
      });

    row.querySelectorAll('textarea')
      .forEach(control => {
        control.style.removeProperty(
          'height'
        );

        control.style.removeProperty(
          'min-height'
        );

        control.style.removeProperty(
          'max-height'
        );
      });
  };

  const applyRowHeight = (
    row,
    height
  ) => {
    if (!row) {
      return;
    }

    const normalized =
      Math.max(
        MIN_HEIGHT,
        Math.min(
          MAX_HEIGHT,
          Math.round(
            Number(height) ||
            MIN_HEIGHT
          )
        )
      );

    row.style.setProperty(
      'height',
      `${normalized}px`,
      'important'
    );

    row.querySelectorAll('td, th')
      .forEach(cell => {
        cell.style.setProperty(
          'height',
          `${normalized}px`,
          'important'
        );
      });

    const controlHeight =
      Math.max(
        24,
        normalized - 10
      );

    row.querySelectorAll('textarea')
      .forEach(control => {
        control.style.setProperty(
          'height',
          `${controlHeight}px`,
          'important'
        );

        control.style.setProperty(
          'min-height',
          '0',
          'important'
        );

        control.style.setProperty(
          'max-height',
          'none',
          'important'
        );
      });
  };

  const applyStoredHeights = () => {
    const dateValue =
      getDateValue();

    if (!dateValue) {
      return;
    }

    const heights =
      loadHeights(dateValue);

    getRows().forEach(row => {
      const rowKey =
        getRowKey(row);

      if (!rowKey) {
        return;
      }

      const storedHeight =
        Number(
          heights[rowKey]
        );

      if (
        Number.isFinite(storedHeight) &&
        storedHeight > 0
      ) {
        const expected =
          `${Math.round(storedHeight)}px`;

        if (
          row.style
            .getPropertyValue('height') !==
          expected
        ) {
          applyRowHeight(
            row,
            storedHeight
          );
        }

      } else if (
        row.hasAttribute(
          'data-row-height-v1-applied'
        )
      ) {
        clearRowHeight(row);

        row.removeAttribute(
          'data-row-height-v1-applied'
        );
      }

      if (
        Number.isFinite(storedHeight) &&
        storedHeight > 0
      ) {
        row.setAttribute(
          'data-row-height-v1-applied',
          '1'
        );
      }
    });
  };

  const clearSelection = () => {
    if (selectedRow) {
      selectedRow.classList.remove(
        'is-row-height-selected-v1'
      );
    }

    selectedRow = null;
    selectedRowKey = '';

    updatePanel();
  };

  const selectRow = row => {
    if (!row) {
      return;
    }

    if (
      selectedRow &&
      selectedRow !== row
    ) {
      selectedRow.classList.remove(
        'is-row-height-selected-v1'
      );
    }

    selectedRow = row;
    selectedRowKey =
      getRowKey(row);

    row.classList.add(
      'is-row-height-selected-v1'
    );

    updatePanel();
  };

  const getCurrentSelectedHeight = () => {
    if (
      !selectedRow ||
      !selectedRowKey
    ) {
      return 0;
    }

    const dateValue =
      getDateValue();

    const stored =
      Number(
        loadHeights(
          dateValue
        )[selectedRowKey]
      );

    if (
      Number.isFinite(stored) &&
      stored > 0
    ) {
      return stored;
    }

    return Math.round(
      selectedRow
        .getBoundingClientRect()
        .height || 0
    );
  };

  const changeSelectedHeight = delta => {
    if (
      !selectedRow ||
      !selectedRowKey
    ) {
      return;
    }

    const dateValue =
      getDateValue();

    if (!dateValue) {
      return;
    }

    const heights =
      loadHeights(
        dateValue
      );

    const current =
      getCurrentSelectedHeight();

    const next =
      Math.max(
        MIN_HEIGHT,
        Math.min(
          MAX_HEIGHT,
          current + delta
        )
      );

    heights[selectedRowKey] =
      next;

    saveHeights(
      dateValue,
      heights
    );

    applyRowHeight(
      selectedRow,
      next
    );

    selectedRow.setAttribute(
      'data-row-height-v1-applied',
      '1'
    );

    updatePanel();
  };

  const resetSelectedHeight = () => {
    if (
      !selectedRow ||
      !selectedRowKey
    ) {
      return;
    }

    const dateValue =
      getDateValue();

    const heights =
      loadHeights(
        dateValue
      );

    delete heights[
      selectedRowKey
    ];

    saveHeights(
      dateValue,
      heights
    );

    clearRowHeight(
      selectedRow
    );

    selectedRow.removeAttribute(
      'data-row-height-v1-applied'
    );

    updatePanel();
  };

  const resetAllHeights = () => {
    const dateValue =
      getDateValue();

    if (!dateValue) {
      return;
    }

    const confirmed =
      window.confirm(
        '현재 날짜의 행 높이를 모두 기본값으로 복원하시겠습니까?\n입력한 업무 내용은 삭제되지 않습니다.'
      );

    if (!confirmed) {
      return;
    }

    try {
      localStorage.removeItem(
        getStorageKey(dateValue)
      );
    } catch (_) {
      // Ignore local storage failure.
    }

    getRows().forEach(row => {
      clearRowHeight(row);

      row.removeAttribute(
        'data-row-height-v1-applied'
      );
    });

    updatePanel();
  };

  const createActionButton = (
    text,
    onClick
  ) => {
    const button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'daily-work-row-height-action-v1';

    button.textContent =
      text;

    button.addEventListener(
      'click',
      onClick
    );

    return button;
  };

  const updatePanel = () => {
    if (!panel) {
      return;
    }

    panel.hidden =
      !editMode;

    if (toggleButton) {
      toggleButton.textContent =
        editMode
          ? '행 높이 편집 종료'
          : '행 높이 조절';

      toggleButton.classList.toggle(
        'is-active',
        editMode
      );
    }

    if (!selectedText) {
      return;
    }

    if (
      !selectedRow ||
      !selectedRowKey
    ) {
      selectedText.textContent =
        '조절할 업무행을 클릭하세요.';

      panel
        .querySelectorAll(
          '[data-requires-row="1"]'
        )
        .forEach(button => {
          button.disabled =
            true;
        });

      return;
    }

    panel
      .querySelectorAll(
        '[data-requires-row="1"]'
      )
      .forEach(button => {
        button.disabled =
          false;
      });

    const label =
      rowLabels[
        selectedRowKey
      ] ||
      selectedRowKey;

    const height =
      getCurrentSelectedHeight();

    selectedText.textContent =
      `선택: ${label} · 약 ${height}px`;
  };

  const installUi = () => {
    if (
      document.getElementById(
        'efficiencyDailyWorkRowHeightButtonV1'
      )
    ) {
      return true;
    }

    const actions =
      document.querySelector(
        '#efficiencyDailyWorkView ' +
        '.efficiency-daily-work-heading-actions'
      ) ||
      document.querySelector(
        '.efficiency-daily-work-heading-actions'
      );

    if (
      !actions ||
      !document.getElementById(
        'efficiencyDailyWorkPaper'
      )
    ) {
      return false;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'efficiencyDailyWorkRowHeightStyleV1';

    style.textContent = `
      #efficiencyDailyWorkRowHeightButtonV1 {
        border-color: #7da8d7 !important;
      }

      #efficiencyDailyWorkRowHeightButtonV1.is-active {
        border-color: #2269b2 !important;
        background: #2269b2 !important;
        color: #fff !important;
      }

      #efficiencyDailyWorkPaper
      .is-row-height-selected-v1 > td,
      #efficiencyDailyWorkPaper
      .is-row-height-selected-v1 > th {
        box-shadow:
          inset 0 0 0 2px #2877d4 !important;
        background-color:
          rgba(40,119,212,.06) !important;
      }

      #efficiencyDailyWorkRowHeightPanelV1 {
        position: fixed;
        right: 26px;
        top: 178px;
        z-index: 2147483646;

        width: 240px;
        padding: 10px;

        border:
          1px solid #b9c9d9;
        border-radius: 9px;

        background:
          rgba(255,255,255,.98);

        box-shadow:
          0 10px 28px
          rgba(23,49,77,.18);
      }

      #efficiencyDailyWorkRowHeightPanelV1[hidden] {
        display: none !important;
      }

      #efficiencyDailyWorkRowHeightPanelV1
      .row-height-panel-title-v1 {
        margin-bottom: 7px;

        color: #193a5c;
        font-size: 11px;
        font-weight: 900;
      }

      #efficiencyDailyWorkRowHeightPanelV1
      .row-height-panel-selected-v1 {
        margin-bottom: 8px;
        padding: 7px 8px;

        border-radius: 6px;

        background: #edf5fd;

        color: #31506f;
        font-size: 10px;
        font-weight: 800;
      }

      #efficiencyDailyWorkRowHeightPanelV1
      .row-height-panel-actions-v1 {
        display: grid;
        grid-template-columns:
          repeat(2, 1fr);
        gap: 6px;
      }

      #efficiencyDailyWorkRowHeightPanelV1
      .daily-work-row-height-action-v1 {
        min-height: 31px;
        padding: 5px 7px;

        border:
          1px solid #c7d4e1;
        border-radius: 6px;

        background: #fff;
        color: #294660;

        font-size: 10px;
        font-weight: 800;

        cursor: pointer;
      }

      #efficiencyDailyWorkRowHeightPanelV1
      .daily-work-row-height-action-v1:hover:not(:disabled) {
        border-color: #6397ce;
        background: #f1f7fe;
      }

      #efficiencyDailyWorkRowHeightPanelV1
      .daily-work-row-height-action-v1:disabled {
        cursor: not-allowed;
        opacity: .4;
      }

      #efficiencyDailyWorkRowHeightPanelV1
      .is-wide-v1 {
        grid-column: span 2;
      }
    `;

    document.head.append(
      style
    );

    toggleButton =
      document.createElement(
        'button'
      );

    toggleButton.type =
      'button';

    toggleButton.id =
      'efficiencyDailyWorkRowHeightButtonV1';

    toggleButton.textContent =
      '행 높이 조절';

    toggleButton.addEventListener(
      'click',
      () => {
        editMode =
          !editMode;

        if (!editMode) {
          clearSelection();
        }

        updatePanel();
      }
    );

    actions.prepend(
      toggleButton
    );

    panel =
      document.createElement(
        'div'
      );

    panel.id =
      'efficiencyDailyWorkRowHeightPanelV1';

    panel.hidden =
      true;

    const title =
      document.createElement(
        'div'
      );

    title.className =
      'row-height-panel-title-v1';

    title.textContent =
      '업무행 높이 조절';

    selectedText =
      document.createElement(
        'div'
      );

    selectedText.className =
      'row-height-panel-selected-v1';

    const buttonArea =
      document.createElement(
        'div'
      );

    buttonArea.className =
      'row-height-panel-actions-v1';

    const minusButton =
      createActionButton(
        '− 12px',
        () =>
          changeSelectedHeight(
            -STEP
          )
      );

    minusButton.dataset
      .requiresRow =
      '1';

    const plusButton =
      createActionButton(
        '+ 12px',
        () =>
          changeSelectedHeight(
            STEP
          )
      );

    plusButton.dataset
      .requiresRow =
      '1';

    const resetRowButton =
      createActionButton(
        '선택 행 기본높이',
        resetSelectedHeight
      );

    resetRowButton.dataset
      .requiresRow =
      '1';

    resetRowButton.classList.add(
      'is-wide-v1'
    );

    const resetAllButton =
      createActionButton(
        '현재 날짜 전체 기본높이',
        resetAllHeights
      );

    resetAllButton.classList.add(
      'is-wide-v1'
    );

    buttonArea.append(
      minusButton,
      plusButton,
      resetRowButton,
      resetAllButton
    );

    panel.append(
      title,
      selectedText,
      buttonArea
    );

    document.body.append(
      panel
    );

    updatePanel();

    return true;
  };

  /*
   * Event delegation only.
   * No MutationObserver is used.
   */
  document.addEventListener(
    'click',
    event => {
      if (!editMode) {
        return;
      }

      const target =
        event.target instanceof Element
          ? event.target
          : null;

      if (!target) {
        return;
      }

      if (
        target.closest(
          '#efficiencyDailyWorkRowHeightPanelV1'
        ) ||
        target.closest(
          '#efficiencyDailyWorkRowHeightButtonV1'
        )
      ) {
        return;
      }

      const row =
        target.closest(
          '#efficiencyDailyWorkPaper ' +
          '[data-efficiency-daily-work-row-key]'
        );

      if (!row) {
        return;
      }

      /*
       * Selection only.
       * Do not preventDefault / stopPropagation:
       * existing text inputs remain usable.
       */
      selectRow(row);
    },
    true
  );

  let attempts = 0;

  const startupTimer =
    window.setInterval(
      () => {
        attempts += 1;

        if (
          installUi() ||
          attempts >= 150
        ) {
          window.clearInterval(
            startupTimer
          );

          applyStoredHeights();
        }
      },
      100
    );

  /*
   * Lightweight date/layout reconciliation.
   * 1 second interval only; no DOM mutation observer.
   */
  const dateTimer =
    window.setInterval(
      () => {
        const currentDate =
          getDateValue();

        if (
          currentDate !==
          lastDate
        ) {
          clearSelection();

          lastDate =
            currentDate;
        }

        applyStoredHeights();
      },
      1000
    );

  window.addEventListener(
    'beforeunload',
    () => {
      window.clearInterval(
        startupTimer
      );

      window.clearInterval(
        dateTimer
      );
    },
    { once: true }
  );

  console.info(
    `[${VERSION}] ready`
  );
})();
