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
   EFFICIENCY DAILY WORK ROW HEIGHT DRAG V2

   Spreadsheet-like direct row resizing:
   - no toolbar button
   - no edit mode
   - drag bottom border of a work row
   - per-date local persistence
   - PDF clone keeps inline row height
   - no MutationObserver
========================================================= */
(() => {
  'use strict';

  const VERSION =
    'EFFICIENCY_DAILY_WORK_ROW_HEIGHT_DRAG_V2';

  const WINDOW_PARAM =
    'efficiencyDailyWorkWindow';

  /*
   * V1과 같은 저장 키를 사용하므로
   * 이미 조절했던 높이도 그대로 이어받는다.
   */
  const STORAGE_PREFIX =
    'gs-efficiency-daily-work-row-height-v1:';

  const MIN_HEIGHT = 32;
  const MAX_HEIGHT = 360;

  /*
   * 행 아래 경계선 기준 ±6px 안쪽을
   * 드래그 가능 영역으로 사용한다.
   */
  const EDGE_HOTSPOT = 6;

  if (
    window.__gsEfficiencyDailyWorkRowHeightDragV2
  ) {
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

  window.__gsEfficiencyDailyWorkRowHeightDragV2 =
    true;

  let hoverRow = null;
  let dragState = null;
  let lastDate = '';

  const getDateValue = () =>
    String(
      document.getElementById(
        'efficiencyDailyWorkDate'
      )?.value || ''
    ).trim();

  const getStorageKey = dateValue =>
    `${STORAGE_PREFIX}${dateValue || 'unknown'}`;

  const getRows = () => [
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
      // 로컬 저장 실패가 작업 자체를 막아서는 안 된다.
    }
  };

  const clearRowHeight = row => {
    if (!row) {
      return;
    }

    row.style.removeProperty(
      'height'
    );

    row.querySelectorAll(
      'td, th'
    ).forEach(cell => {
      cell.style.removeProperty(
        'height'
      );
    });

    row.querySelectorAll(
      'textarea'
    ).forEach(control => {
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

    row.querySelectorAll(
      'td, th'
    ).forEach(cell => {
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

    row.querySelectorAll(
      'textarea'
    ).forEach(control => {
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

    row.setAttribute(
      'data-row-height-v2-applied',
      '1'
    );
  };

  const applyStoredHeights = () => {
    if (dragState) {
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
          'data-row-height-v2-applied'
        )
      ) {
        clearRowHeight(row);

        row.removeAttribute(
          'data-row-height-v2-applied'
        );
      }
    });
  };

  const clearHoverRow = () => {
    if (hoverRow) {
      hoverRow.classList.remove(
        'is-row-resize-hover-v2'
      );
    }

    hoverRow = null;

    if (!dragState) {
      document.documentElement
        .classList.remove(
          'is-daily-work-row-resize-v2'
        );
    }
  };

  const setHoverRow = row => {
    if (hoverRow === row) {
      return;
    }

    clearHoverRow();

    if (!row) {
      return;
    }

    hoverRow = row;

    row.classList.add(
      'is-row-resize-hover-v2'
    );

    document.documentElement
      .classList.add(
        'is-daily-work-row-resize-v2'
      );
  };

  const findResizeRow = event => {
    const target =
      event.target instanceof Element
        ? event.target
        : null;

    if (!target) {
      return null;
    }

    const row =
      target.closest(
        '#efficiencyDailyWorkPaper ' +
        '[data-efficiency-daily-work-row-key]'
      );

    if (!row) {
      return null;
    }

    const rowKey =
      getRowKey(row);

    if (!rowKey) {
      return null;
    }

    const rect =
      row.getBoundingClientRect();

    /*
     * 현재 행의 아래쪽 테두리만 resize edge로 사용한다.
     */
    const distance =
      Math.abs(
        event.clientY -
        rect.bottom
      );

    return (
      distance <= EDGE_HOTSPOT
    )
      ? row
      : null;
  };

  const beginDrag = (
    event,
    row
  ) => {
    const rowKey =
      getRowKey(row);

    if (!rowKey) {
      return;
    }

    const startHeight =
      Math.round(
        row.getBoundingClientRect()
          .height
      );

    dragState = {
      row,
      rowKey,
      dateValue:
        getDateValue(),
      startY:
        event.clientY,
      startHeight,
      currentHeight:
        startHeight,
      pointerId:
        event.pointerId
    };

    row.classList.add(
      'is-row-resizing-v2'
    );

    document.documentElement
      .classList.add(
        'is-daily-work-row-resizing-v2'
      );

    try {
      row.setPointerCapture(
        event.pointerId
      );
    } catch (_) {
      // 브라우저가 capture를 제한해도 document listener로 계속 처리.
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const moveDrag = event => {
    if (!dragState) {
      return;
    }

    const delta =
      event.clientY -
      dragState.startY;

    const next =
      Math.max(
        MIN_HEIGHT,
        Math.min(
          MAX_HEIGHT,
          dragState.startHeight +
          delta
        )
      );

    dragState.currentHeight =
      Math.round(next);

    applyRowHeight(
      dragState.row,
      dragState.currentHeight
    );

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const finishDrag = event => {
    if (!dragState) {
      return;
    }

    const {
      row,
      rowKey,
      dateValue,
      currentHeight,
      pointerId
    } = dragState;

    const heights =
      loadHeights(
        dateValue
      );

    heights[rowKey] =
      currentHeight;

    saveHeights(
      dateValue,
      heights
    );

    row.classList.remove(
      'is-row-resizing-v2'
    );

    try {
      if (
        row.hasPointerCapture?.(
          pointerId
        )
      ) {
        row.releasePointerCapture(
          pointerId
        );
      }
    } catch (_) {
      // Ignore capture release failure.
    }

    dragState = null;

    document.documentElement
      .classList.remove(
        'is-daily-work-row-resizing-v2'
      );

    clearHoverRow();

    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };

  const installStyle = () => {
    if (
      document.getElementById(
        'efficiencyDailyWorkRowHeightDragStyleV2'
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'efficiencyDailyWorkRowHeightDragStyleV2';

    style.textContent = `
      /*
       * 버튼/패널 없음.
       * 행 경계선에 올렸을 때만 resize cursor를 표시한다.
       */
      html.is-daily-work-row-resize-v2,
      html.is-daily-work-row-resize-v2 * {
        cursor: ns-resize !important;
      }

      html.is-daily-work-row-resizing-v2,
      html.is-daily-work-row-resizing-v2 * {
        cursor: ns-resize !important;
        user-select: none !important;
      }

      #efficiencyDailyWorkPaper
      [data-efficiency-daily-work-row-key]
      > td,
      #efficiencyDailyWorkPaper
      [data-efficiency-daily-work-row-key]
      > th {
        transition:
          background-color .08s ease;
      }

      #efficiencyDailyWorkPaper
      .is-row-resize-hover-v2
      > td,
      #efficiencyDailyWorkPaper
      .is-row-resize-hover-v2
      > th {
        box-shadow:
          inset 0 -2px 0
          #2877d4 !important;
      }

      #efficiencyDailyWorkPaper
      .is-row-resizing-v2
      > td,
      #efficiencyDailyWorkPaper
      .is-row-resizing-v2
      > th {
        box-shadow:
          inset 0 -3px 0
          #1765ba !important;
      }
    `;

    document.head.append(
      style
    );
  };

  installStyle();

  /*
   * Hover: 행 아래쪽 테두리를 찾는다.
   */
  document.addEventListener(
    'pointermove',
    event => {
      if (dragState) {
        moveDrag(event);
        return;
      }

      const row =
        findResizeRow(event);

      setHoverRow(row);
    },
    {
      capture: true,
      passive: false
    }
  );

  /*
   * 행 아래 경계에서 누르면 바로 resize 시작.
   */
  document.addEventListener(
    'pointerdown',
    event => {
      if (
        event.button !== 0
      ) {
        return;
      }

      const row =
        findResizeRow(event);

      if (!row) {
        return;
      }

      beginDrag(
        event,
        row
      );
    },
    {
      capture: true,
      passive: false
    }
  );

  document.addEventListener(
    'pointerup',
    finishDrag,
    {
      capture: true,
      passive: false
    }
  );

  document.addEventListener(
    'pointercancel',
    finishDrag,
    {
      capture: true,
      passive: false
    }
  );

  /*
   * 표 밖으로 빠지면 hover만 제거한다.
   * drag 중이면 document pointermove가 계속 resize를 담당한다.
   */
  document.addEventListener(
    'pointerover',
    event => {
      if (dragState) {
        return;
      }

      const target =
        event.target instanceof Element
          ? event.target
          : null;

      if (
        !target?.closest(
          '#efficiencyDailyWorkPaper'
        )
      ) {
        clearHoverRow();
      }
    },
    true
  );

  /*
   * 초기 높이 및 날짜 변경 시 높이 복구.
   * MutationObserver는 사용하지 않는다.
   */
  let attempts = 0;

  const startupTimer =
    window.setInterval(
      () => {
        attempts += 1;

        const paper =
          document.getElementById(
            'efficiencyDailyWorkPaper'
          );

        if (
          paper ||
          attempts >= 150
        ) {
          window.clearInterval(
            startupTimer
          );

          lastDate =
            getDateValue();

          applyStoredHeights();
        }
      },
      100
    );

  const dateTimer =
    window.setInterval(
      () => {
        const currentDate =
          getDateValue();

        if (
          currentDate !==
          lastDate
        ) {
          clearHoverRow();

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
