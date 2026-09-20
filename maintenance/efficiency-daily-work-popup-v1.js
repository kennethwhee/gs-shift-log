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
   EFFICIENCY DAILY WORK DIRECT RESIZE V3

   Direct border drag:
   1) Instruction box bottom border
   2) Daily work table row bottom borders

   No button / no edit mode / no MutationObserver
========================================================= */
(() => {
  'use strict';

  const VERSION =
    'EFFICIENCY_DAILY_WORK_DIRECT_RESIZE_V3';

  const WINDOW_PARAM =
    'efficiencyDailyWorkWindow';

  const ROW_STORAGE_PREFIX =
    'gs-efficiency-daily-work-row-height-v1:';

  const INSTRUCTION_STORAGE_PREFIX =
    'gs-efficiency-daily-work-instruction-height-v1:';

  const ROW_MIN_HEIGHT = 32;
  const ROW_MAX_HEIGHT = 360;

  const INSTRUCTION_MIN_HEIGHT = 130;
  const INSTRUCTION_MAX_HEIGHT = 560;

  const EDGE_HOTSPOT = 7;

  const ROW_SELECTOR =
    '#efficiencyDailyWorkPaper ' +
    '[data-efficiency-daily-work-row-key]';

  const INSTRUCTION_SELECTOR =
    '#efficiencyDailyWorkPaper ' +
    '.efficiency-daily-work-instruction-box';

  if (
    window.__gsEfficiencyDailyWorkDirectResizeV3
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

  window.__gsEfficiencyDailyWorkDirectResizeV3 =
    true;

  let hoverTarget = null;
  let dragState = null;
  let lastDate = '';

  const getDateValue = () =>
    String(
      document.getElementById(
        'efficiencyDailyWorkDate'
      )?.value || ''
    ).trim();

  const getRowStorageKey = dateValue =>
    `${ROW_STORAGE_PREFIX}${dateValue || 'unknown'}`;

  const getInstructionStorageKey = dateValue =>
    `${INSTRUCTION_STORAGE_PREFIX}${dateValue || 'unknown'}`;

  const getRowKey = row =>
    String(
      row?.dataset
        ?.efficiencyDailyWorkRowKey ||
      ''
    ).trim();

  const loadRowHeights = dateValue => {
    if (!dateValue) {
      return {};
    }

    try {
      const raw =
        localStorage.getItem(
          getRowStorageKey(dateValue)
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
                ROW_MIN_HEIGHT,
                Math.min(
                  ROW_MAX_HEIGHT,
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

  const saveRowHeights = (
    dateValue,
    heights
  ) => {
    if (!dateValue) {
      return;
    }

    try {
      localStorage.setItem(
        getRowStorageKey(dateValue),
        JSON.stringify(heights)
      );
    } catch (_) {
      // Local layout backup must not break work.
    }
  };

  const loadInstructionHeight = dateValue => {
    if (!dateValue) {
      return 0;
    }

    try {
      const value =
        Number(
          localStorage.getItem(
            getInstructionStorageKey(
              dateValue
            )
          )
        );

      return Number.isFinite(value) &&
        value > 0
        ? Math.max(
            INSTRUCTION_MIN_HEIGHT,
            Math.min(
              INSTRUCTION_MAX_HEIGHT,
              Math.round(value)
            )
          )
        : 0;

    } catch {
      return 0;
    }
  };

  const saveInstructionHeight = (
    dateValue,
    height
  ) => {
    if (!dateValue) {
      return;
    }

    try {
      localStorage.setItem(
        getInstructionStorageKey(
          dateValue
        ),
        String(
          Math.round(height)
        )
      );
    } catch (_) {
      // Ignore local storage failure.
    }
  };

  const clearRowHeight = row => {
    if (!row) {
      return;
    }

    row.style.removeProperty('height');

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
        ROW_MIN_HEIGHT,
        Math.min(
          ROW_MAX_HEIGHT,
          Math.round(height)
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
      'data-direct-resize-row-v3',
      '1'
    );
  };

  const clearInstructionHeight = box => {
    if (!box) {
      return;
    }

    [
      'height',
      'min-height',
      'max-height',
      'box-sizing',
      'display',
      'flex-direction',
      'overflow'
    ].forEach(property => {
      box.style.removeProperty(
        property
      );
    });

    box.querySelectorAll(
      '.efficiency-daily-work-instruction-field'
    ).forEach(field => {
      [
        'display',
        'flex-direction',
        'flex',
        'min-height'
      ].forEach(property => {
        field.style.removeProperty(
          property
        );
      });
    });

    box.querySelectorAll(
      'textarea'
    ).forEach(control => {
      [
        'height',
        'min-height',
        'max-height',
        'flex'
      ].forEach(property => {
        control.style.removeProperty(
          property
        );
      });
    });

    box.removeAttribute(
      'data-direct-resize-instruction-v3'
    );
  };

  const applyInstructionHeight = (
    box,
    height
  ) => {
    if (!box) {
      return;
    }

    const normalized =
      Math.max(
        INSTRUCTION_MIN_HEIGHT,
        Math.min(
          INSTRUCTION_MAX_HEIGHT,
          Math.round(height)
        )
      );

    box.style.setProperty(
      'height',
      `${normalized}px`,
      'important'
    );

    box.style.setProperty(
      'min-height',
      `${normalized}px`,
      'important'
    );

    box.style.setProperty(
      'max-height',
      `${normalized}px`,
      'important'
    );

    box.style.setProperty(
      'box-sizing',
      'border-box',
      'important'
    );

    box.style.setProperty(
      'display',
      'flex',
      'important'
    );

    box.style.setProperty(
      'flex-direction',
      'column',
      'important'
    );

    box.style.setProperty(
      'overflow',
      'hidden',
      'important'
    );

    const fields = [
      ...box.querySelectorAll(
        '.efficiency-daily-work-instruction-field'
      )
    ];

    fields.forEach(
      (field, index) => {
        field.style.setProperty(
          'display',
          'flex',
          'important'
        );

        field.style.setProperty(
          'flex-direction',
          'column',
          'important'
        );

        field.style.setProperty(
          'min-height',
          '0',
          'important'
        );

        /*
         * 공지사항은 원래 43px,
         * TM/설비운영팀은 65px이므로
         * 기존 비율을 대략 유지한다.
         */
        field.style.setProperty(
          'flex',
          index === 0
            ? '0.72 1 0'
            : '1 1 0',
          'important'
        );

        const textarea =
          field.querySelector(
            'textarea'
          );

        if (!textarea) {
          return;
        }

        textarea.style.setProperty(
          'height',
          'auto',
          'important'
        );

        textarea.style.setProperty(
          'min-height',
          '0',
          'important'
        );

        textarea.style.setProperty(
          'max-height',
          'none',
          'important'
        );

        textarea.style.setProperty(
          'flex',
          '1 1 auto',
          'important'
        );
      }
    );

    box.setAttribute(
      'data-direct-resize-instruction-v3',
      '1'
    );
  };

  const applyStoredSizes = () => {
    if (dragState) {
      return;
    }

    const dateValue =
      getDateValue();

    if (!dateValue) {
      return;
    }

    const rowHeights =
      loadRowHeights(
        dateValue
      );

    document.querySelectorAll(
      ROW_SELECTOR
    ).forEach(row => {
      const rowKey =
        getRowKey(row);

      const height =
        Number(
          rowHeights[rowKey]
        );

      if (
        Number.isFinite(height) &&
        height > 0
      ) {
        applyRowHeight(
          row,
          height
        );

      } else if (
        row.hasAttribute(
          'data-direct-resize-row-v3'
        )
      ) {
        clearRowHeight(row);

        row.removeAttribute(
          'data-direct-resize-row-v3'
        );
      }
    });

    const box =
      document.querySelector(
        INSTRUCTION_SELECTOR
      );

    const instructionHeight =
      loadInstructionHeight(
        dateValue
      );

    if (
      box &&
      instructionHeight > 0
    ) {
      applyInstructionHeight(
        box,
        instructionHeight
      );

    } else if (
      box?.hasAttribute(
        'data-direct-resize-instruction-v3'
      )
    ) {
      clearInstructionHeight(
        box
      );
    }
  };

  const targetEquals = (
    left,
    right
  ) =>
    Boolean(
      left &&
      right &&
      left.kind === right.kind &&
      left.element === right.element
    );

  const clearHoverTarget = () => {
    if (hoverTarget?.element) {
      hoverTarget.element
        .classList.remove(
          'is-direct-resize-hover-v3'
        );
    }

    hoverTarget = null;

    if (!dragState) {
      document.documentElement
        .classList.remove(
          'is-daily-work-direct-resize-v3'
        );
    }
  };

  const setHoverTarget = target => {
    if (
      targetEquals(
        hoverTarget,
        target
      )
    ) {
      return;
    }

    clearHoverTarget();

    if (!target) {
      return;
    }

    hoverTarget = target;

    target.element.classList.add(
      'is-direct-resize-hover-v3'
    );

    document.documentElement
      .classList.add(
        'is-daily-work-direct-resize-v3'
      );
  };

  const isNearBottomEdge = (
    element,
    event
  ) => {
    const rect =
      element.getBoundingClientRect();

    const horizontalMatch =
      event.clientX >=
        rect.left - EDGE_HOTSPOT &&
      event.clientX <=
        rect.right + EDGE_HOTSPOT;

    const verticalMatch =
      Math.abs(
        event.clientY -
        rect.bottom
      ) <= EDGE_HOTSPOT;

    return (
      horizontalMatch &&
      verticalMatch
    );
  };

  const findResizeTarget = event => {
    /*
     * 1. 주요 전달 및 지시사항 박스
     *
     * border 바로 아래 요소가 event.target이 되는 경우도
     * 있으므로 closest에 의존하지 않고 좌표로 검사한다.
     */
    const instructionBox =
      document.querySelector(
        INSTRUCTION_SELECTOR
      );

    if (
      instructionBox &&
      isNearBottomEdge(
        instructionBox,
        event
      )
    ) {
      return {
        kind: 'instruction',
        element:
          instructionBox,
        key:
          'instruction-box'
      };
    }

    /*
     * 2. 기존 업무표 행
     */
    const target =
      event.target instanceof Element
        ? event.target
        : null;

    const row =
      target?.closest(
        ROW_SELECTOR
      );

    if (
      row &&
      isNearBottomEdge(
        row,
        event
      )
    ) {
      const rowKey =
        getRowKey(row);

      if (rowKey) {
        return {
          kind: 'row',
          element: row,
          key: rowKey
        };
      }
    }

    return null;
  };

  const beginDrag = (
    event,
    target
  ) => {
    const startHeight =
      Math.round(
        target.element
          .getBoundingClientRect()
          .height
      );

    dragState = {
      ...target,
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

    target.element.classList.add(
      'is-direct-resizing-v3'
    );

    document.documentElement
      .classList.add(
        'is-daily-work-direct-resizing-v3'
      );

    try {
      target.element
        .setPointerCapture(
          event.pointerId
        );
    } catch (_) {
      // document listener still handles dragging.
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

    const minHeight =
      dragState.kind ===
      'instruction'
        ? INSTRUCTION_MIN_HEIGHT
        : ROW_MIN_HEIGHT;

    const maxHeight =
      dragState.kind ===
      'instruction'
        ? INSTRUCTION_MAX_HEIGHT
        : ROW_MAX_HEIGHT;

    const next =
      Math.max(
        minHeight,
        Math.min(
          maxHeight,
          dragState.startHeight +
          delta
        )
      );

    dragState.currentHeight =
      Math.round(next);

    if (
      dragState.kind ===
      'instruction'
    ) {
      applyInstructionHeight(
        dragState.element,
        dragState.currentHeight
      );

    } else {
      applyRowHeight(
        dragState.element,
        dragState.currentHeight
      );
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const finishDrag = event => {
    if (!dragState) {
      return;
    }

    const finished =
      dragState;

    if (
      finished.kind ===
      'instruction'
    ) {
      saveInstructionHeight(
        finished.dateValue,
        finished.currentHeight
      );

    } else {
      const heights =
        loadRowHeights(
          finished.dateValue
        );

      heights[
        finished.key
      ] =
        finished.currentHeight;

      saveRowHeights(
        finished.dateValue,
        heights
      );
    }

    finished.element
      .classList.remove(
        'is-direct-resizing-v3'
      );

    try {
      if (
        finished.element
          .hasPointerCapture?.(
            finished.pointerId
          )
      ) {
        finished.element
          .releasePointerCapture(
            finished.pointerId
          );
      }
    } catch (_) {
      // Ignore release failure.
    }

    dragState = null;

    document.documentElement
      .classList.remove(
        'is-daily-work-direct-resizing-v3'
      );

    clearHoverTarget();

    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };

  const installStyle = () => {
    if (
      document.getElementById(
        'efficiencyDailyWorkDirectResizeStyleV3'
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'efficiencyDailyWorkDirectResizeStyleV3';

    style.textContent = `
      html.is-daily-work-direct-resize-v3,
      html.is-daily-work-direct-resize-v3 * {
        cursor: ns-resize !important;
      }

      html.is-daily-work-direct-resizing-v3,
      html.is-daily-work-direct-resizing-v3 * {
        cursor: ns-resize !important;
        user-select: none !important;
      }

      #efficiencyDailyWorkPaper
      [data-efficiency-daily-work-row-key]
      .is-direct-resize-hover-v3 {
        box-shadow:
          inset 0 -2px 0
          #2877d4 !important;
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
      [data-efficiency-daily-work-row-key]
      .is-direct-resizing-v3 {
        box-shadow:
          inset 0 -3px 0
          #1765ba !important;
      }

      #efficiencyDailyWorkPaper
      [data-efficiency-daily-work-row-key]
      .is-direct-resize-hover-v3 {
        outline: none !important;
      }

      #efficiencyDailyWorkPaper
      [data-efficiency-daily-work-row-key]
      .is-direct-resizing-v3 {
        outline: none !important;
      }

      #efficiencyDailyWorkPaper
      tr.is-direct-resize-hover-v3
      > td,
      #efficiencyDailyWorkPaper
      tr.is-direct-resize-hover-v3
      > th {
        box-shadow:
          inset 0 -2px 0
          #2877d4 !important;
      }

      #efficiencyDailyWorkPaper
      tr.is-direct-resizing-v3
      > td,
      #efficiencyDailyWorkPaper
      tr.is-direct-resizing-v3
      > th {
        box-shadow:
          inset 0 -3px 0
          #1765ba !important;
      }

      #efficiencyDailyWorkPaper
      .efficiency-daily-work-instruction-box
      .efficiency-daily-work-instruction-field {
        box-sizing: border-box;
      }

      #efficiencyDailyWorkPaper
      .efficiency-daily-work-instruction-box
      textarea {
        box-sizing: border-box;
      }

      #efficiencyDailyWorkPaper
      .efficiency-daily-work-instruction-box
      .efficiency-daily-work-static-control {
        min-height: 0;
      }

      #efficiencyDailyWorkPaper
      .efficiency-daily-work-instruction-box
      .is-direct-resize-hover-v3 {
        outline: none !important;
      }

      #efficiencyDailyWorkPaper
      .efficiency-daily-work-instruction-box.is-direct-resize-hover-v3 {
        box-shadow:
          inset 0 -3px 0
          #2877d4 !important;
      }

      #efficiencyDailyWorkPaper
      .efficiency-daily-work-instruction-box.is-direct-resizing-v3 {
        box-shadow:
          inset 0 -4px 0
          #1765ba !important;
      }
    `;

    document.head.append(
      style
    );
  };

  installStyle();

  document.addEventListener(
    'pointermove',
    event => {
      if (dragState) {
        moveDrag(event);
        return;
      }

      setHoverTarget(
        findResizeTarget(event)
      );
    },
    {
      capture: true,
      passive: false
    }
  );

  document.addEventListener(
    'pointerdown',
    event => {
      if (event.button !== 0) {
        return;
      }

      const target =
        findResizeTarget(event);

      if (!target) {
        return;
      }

      beginDrag(
        event,
        target
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

          applyStoredSizes();
        }
      },
      100
    );

  /*
   * 날짜 변경만 가볍게 확인.
   * MutationObserver는 사용하지 않는다.
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
          clearHoverTarget();

          lastDate =
            currentDate;
        }

        applyStoredSizes();
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

/* =========================================================
   EFFICIENCY DAILY WORK COLUMN WIDTH DRAG V1

   Spreadsheet-like column resizing:
   - no button
   - no edit mode
   - drag inner vertical column borders
   - current row/instruction resize V3 remains untouched
   - per-date local persistence
   - cloned PDF keeps inline col widths
   - no MutationObserver
========================================================= */
(() => {
  'use strict';

  const VERSION =
    'EFFICIENCY_DAILY_WORK_COLUMN_WIDTH_DRAG_V1';

  const WINDOW_PARAM =
    'efficiencyDailyWorkWindow';

  const STORAGE_PREFIX =
    'gs-efficiency-daily-work-column-width-v1:';

  const TABLE_SELECTOR =
    '#efficiencyDailyWorkPaper ' +
    '.efficiency-daily-work-table';

  const EDGE_HOTSPOT = 6;

  const MIN_COLUMN_PX = 30;

  if (
    window.__gsEfficiencyDailyWorkColumnWidthDragV1
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

  window.__gsEfficiencyDailyWorkColumnWidthDragV1 =
    true;

  let hoverBoundary = null;
  let dragState = null;
  let lastDate = '';

  let guide = null;

  const getDateValue = () =>
    String(
      document.getElementById(
        'efficiencyDailyWorkDate'
      )?.value || ''
    ).trim();

  const getStorageKey = dateValue =>
    `${STORAGE_PREFIX}${dateValue || 'unknown'}`;

  const getTable = () =>
    document.querySelector(
      TABLE_SELECTOR
    );

  const getCols = table =>
    table
      ? [
          ...table.querySelectorAll(
            ':scope > colgroup > col'
          )
        ]
      : [];

  const getHeaderCells = table =>
    table
      ? [
          ...table.querySelectorAll(
            ':scope > thead > tr:first-child > th'
          )
        ]
      : [];

  const normalizeWidths = values => {
    if (!Array.isArray(values)) {
      return [];
    }

    const widths =
      values.map(Number);

    if (
      widths.length !== 4 ||
      widths.some(value =>
        !Number.isFinite(value) ||
        value <= 0
      )
    ) {
      return [];
    }

    const total =
      widths.reduce(
        (sum, value) =>
          sum + value,
        0
      );

    if (total <= 0) {
      return [];
    }

    return widths.map(
      value =>
        Math.round(
          (
            value /
            total *
            100
          ) * 1000
        ) / 1000
    );
  };

  const loadWidths = dateValue => {
    if (!dateValue) {
      return [];
    }

    try {
      const raw =
        localStorage.getItem(
          getStorageKey(dateValue)
        );

      if (!raw) {
        return [];
      }

      return normalizeWidths(
        JSON.parse(raw)
      );

    } catch {
      return [];
    }
  };

  const saveWidths = (
    dateValue,
    widths
  ) => {
    if (!dateValue) {
      return;
    }

    const normalized =
      normalizeWidths(widths);

    if (normalized.length !== 4) {
      return;
    }

    try {
      localStorage.setItem(
        getStorageKey(dateValue),
        JSON.stringify(normalized)
      );
    } catch (_) {
      // Layout backup failure must not break document work.
    }
  };

  const measureCurrentWidths = table => {
    const cells =
      getHeaderCells(table);

    if (cells.length !== 4) {
      return [];
    }

    const widths =
      cells.map(
        cell =>
          cell.getBoundingClientRect().width
      );

    const total =
      widths.reduce(
        (sum, value) =>
          sum + value,
        0
      );

    if (total <= 0) {
      return [];
    }

    return widths.map(
      value =>
        value / total * 100
    );
  };

  const clearColumnWidths = table => {
    if (!table) {
      return;
    }

    table.style.removeProperty(
      'table-layout'
    );

    table.style.removeProperty(
      'width'
    );

    getCols(table)
      .forEach(col => {
        col.style.removeProperty(
          'width'
        );

        col.style.removeProperty(
          'min-width'
        );

        col.style.removeProperty(
          'max-width'
        );
      });

    table.removeAttribute(
      'data-column-width-drag-v1-applied'
    );
  };

  const applyColumnWidths = (
    table,
    widths
  ) => {
    const normalized =
      normalizeWidths(widths);

    const cols =
      getCols(table);

    if (
      normalized.length !== 4 ||
      cols.length !== 4
    ) {
      return false;
    }

    table.style.setProperty(
      'table-layout',
      'fixed',
      'important'
    );

    table.style.setProperty(
      'width',
      '100%',
      'important'
    );

    cols.forEach(
      (col, index) => {
        col.style.setProperty(
          'width',
          `${normalized[index]}%`,
          'important'
        );
      }
    );

    table.setAttribute(
      'data-column-width-drag-v1-applied',
      '1'
    );

    return true;
  };

  const applyStoredWidths = () => {
    if (dragState) {
      return;
    }

    const table =
      getTable();

    const dateValue =
      getDateValue();

    if (
      !table ||
      !dateValue
    ) {
      return;
    }

    const widths =
      loadWidths(
        dateValue
      );

    if (widths.length === 4) {
      applyColumnWidths(
        table,
        widths
      );

    } else if (
      table.hasAttribute(
        'data-column-width-drag-v1-applied'
      )
    ) {
      clearColumnWidths(
        table
      );
    }
  };

  const ensureGuide = () => {
    if (guide?.isConnected) {
      return guide;
    }

    guide =
      document.createElement(
        'div'
      );

    guide.id =
      'efficiencyDailyWorkColumnResizeGuideV1';

    guide.setAttribute(
      'aria-hidden',
      'true'
    );

    document.body.append(
      guide
    );

    return guide;
  };

  const hideGuide = () => {
    if (guide) {
      guide.hidden = true;
    }
  };

  const showGuide = (
    x,
    table
  ) => {
    const line =
      ensureGuide();

    const rect =
      table.getBoundingClientRect();

    line.hidden = false;

    line.style.left =
      `${Math.round(x)}px`;

    line.style.top =
      `${Math.round(rect.top)}px`;

    line.style.height =
      `${Math.round(rect.height)}px`;
  };

  const findBoundary = event => {
    const table =
      getTable();

    if (!table) {
      return null;
    }

    const tableRect =
      table.getBoundingClientRect();

    if (
      event.clientX <
        tableRect.left - EDGE_HOTSPOT ||
      event.clientX >
        tableRect.right + EDGE_HOTSPOT ||
      event.clientY <
        tableRect.top ||
      event.clientY >
        tableRect.bottom
    ) {
      return null;
    }

    const cells =
      getHeaderCells(table);

    if (cells.length !== 4) {
      return null;
    }

    /*
     * Outer table borders are not resized.
     * Only the three internal column boundaries.
     */
    for (
      let index = 0;
      index < cells.length - 1;
      index += 1
    ) {
      const boundaryX =
        cells[index]
          .getBoundingClientRect()
          .right;

      if (
        Math.abs(
          event.clientX -
          boundaryX
        ) <= EDGE_HOTSPOT
      ) {
        return {
          table,
          boundaryIndex: index,
          x: boundaryX
        };
      }
    }

    return null;
  };

  const clearHover = () => {
    hoverBoundary = null;

    document.documentElement
      .classList.remove(
        'is-daily-work-column-resize-hover-v1'
      );

    if (!dragState) {
      hideGuide();
    }
  };

  const setHover = boundary => {
    if (!boundary) {
      clearHover();
      return;
    }

    hoverBoundary =
      boundary;

    document.documentElement
      .classList.add(
        'is-daily-work-column-resize-hover-v1'
      );

    showGuide(
      boundary.x,
      boundary.table
    );
  };

  const beginDrag = (
    event,
    boundary
  ) => {
    const table =
      boundary.table;

    const cells =
      getHeaderCells(table);

    if (cells.length !== 4) {
      return;
    }

    const widthsPx =
      cells.map(
        cell =>
          cell.getBoundingClientRect().width
      );

    const tableWidth =
      table.getBoundingClientRect().width;

    if (
      tableWidth <= 0 ||
      widthsPx.some(
        width =>
          !Number.isFinite(width) ||
          width <= 0
      )
    ) {
      return;
    }

    const leftIndex =
      boundary.boundaryIndex;

    const rightIndex =
      leftIndex + 1;

    dragState = {
      table,
      dateValue:
        getDateValue(),
      pointerId:
        event.pointerId,
      startX:
        event.clientX,
      tableWidth,
      startWidthsPx:
        [...widthsPx],
      leftIndex,
      rightIndex,
      currentWidths:
        normalizeWidths(
          widthsPx
        )
    };

    document.documentElement
      .classList.add(
        'is-daily-work-column-resizing-v1'
      );

    showGuide(
      event.clientX,
      table
    );

    try {
      table.setPointerCapture(
        event.pointerId
      );
    } catch (_) {
      // document pointer listeners still continue the drag.
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const moveDrag = event => {
    if (!dragState) {
      return;
    }

    const {
      table,
      startX,
      tableWidth,
      startWidthsPx,
      leftIndex,
      rightIndex
    } = dragState;

    const pairTotal =
      startWidthsPx[leftIndex] +
      startWidthsPx[rightIndex];

    let leftWidth =
      startWidthsPx[leftIndex] +
      (
        event.clientX -
        startX
      );

    leftWidth =
      Math.max(
        MIN_COLUMN_PX,
        Math.min(
          pairTotal -
          MIN_COLUMN_PX,
          leftWidth
        )
      );

    const rightWidth =
      pairTotal -
      leftWidth;

    const nextPx =
      [...startWidthsPx];

    nextPx[leftIndex] =
      leftWidth;

    nextPx[rightIndex] =
      rightWidth;

    const nextPercent =
      nextPx.map(
        width =>
          width /
          tableWidth *
          100
      );

    dragState.currentWidths =
      normalizeWidths(
        nextPercent
      );

    applyColumnWidths(
      table,
      dragState.currentWidths
    );

    const currentCells =
      getHeaderCells(table);

    const currentBoundaryX =
      currentCells[leftIndex]
        ?.getBoundingClientRect()
        .right;

    showGuide(
      Number.isFinite(
        currentBoundaryX
      )
        ? currentBoundaryX
        : event.clientX,
      table
    );

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const finishDrag = event => {
    if (!dragState) {
      return;
    }

    const finished =
      dragState;

    if (
      finished.currentWidths
        ?.length === 4
    ) {
      saveWidths(
        finished.dateValue,
        finished.currentWidths
      );
    }

    try {
      if (
        finished.table
          .hasPointerCapture?.(
            finished.pointerId
          )
      ) {
        finished.table
          .releasePointerCapture(
            finished.pointerId
          );
      }
    } catch (_) {
      // Ignore pointer capture release failure.
    }

    dragState = null;

    document.documentElement
      .classList.remove(
        'is-daily-work-column-resizing-v1'
      );

    clearHover();

    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };

  const installStyle = () => {
    if (
      document.getElementById(
        'efficiencyDailyWorkColumnWidthDragStyleV1'
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'efficiencyDailyWorkColumnWidthDragStyleV1';

    style.textContent = `
      html.is-daily-work-column-resize-hover-v1,
      html.is-daily-work-column-resize-hover-v1 * {
        cursor: ew-resize !important;
      }

      html.is-daily-work-column-resizing-v1,
      html.is-daily-work-column-resizing-v1 * {
        cursor: ew-resize !important;
        user-select: none !important;
      }

      #efficiencyDailyWorkColumnResizeGuideV1 {
        position: fixed;
        z-index: 2147483646;

        width: 2px;

        margin-left: -1px;

        pointer-events: none;

        background:
          #2877d4;

        box-shadow:
          0 0 0 1px
          rgba(40,119,212,.15);
      }

      #efficiencyDailyWorkColumnResizeGuideV1[hidden] {
        display: none !important;
      }
    `;

    document.head.append(
      style
    );
  };

  installStyle();

  document.addEventListener(
    'pointermove',
    event => {
      if (dragState) {
        moveDrag(event);
        return;
      }

      /*
       * The existing horizontal-row resize V3 gets priority
       * at exact row/column intersections.
       */
      if (
        document.documentElement
          .classList.contains(
            'is-daily-work-direct-resizing-v3'
          )
      ) {
        clearHover();
        return;
      }

      setHover(
        findBoundary(event)
      );
    },
    {
      capture: true,
      passive: false
    }
  );

  document.addEventListener(
    'pointerdown',
    event => {
      if (
        event.button !== 0 ||
        dragState
      ) {
        return;
      }

      if (
        document.documentElement
          .classList.contains(
            'is-daily-work-direct-resize-v3'
          ) ||
        document.documentElement
          .classList.contains(
            'is-daily-work-direct-resizing-v3'
          )
      ) {
        return;
      }

      const boundary =
        findBoundary(event);

      if (!boundary) {
        return;
      }

      beginDrag(
        event,
        boundary
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
   * Initial load + date changes.
   * No MutationObserver.
   */
  let attempts = 0;

  const startupTimer =
    window.setInterval(
      () => {
        attempts += 1;

        const table =
          getTable();

        if (
          table ||
          attempts >= 150
        ) {
          window.clearInterval(
            startupTimer
          );

          lastDate =
            getDateValue();

          applyStoredWidths();
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
          clearHover();

          lastDate =
            currentDate;
        }

        applyStoredWidths();
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

/* =========================================================
   EFFICIENCY DAILY WORK ROW HIDE V1

   - right click the role/title cell
   - hide row without deleting data
   - restore one / restore all
   - keeps rowspan group cells valid
   - per-date local persistence
   - PDF clone follows current hidden state
   - no MutationObserver
========================================================= */
(() => {
  'use strict';

  const VERSION =
    'EFFICIENCY_DAILY_WORK_ROW_HIDE_V1';

  const WINDOW_PARAM =
    'efficiencyDailyWorkWindow';

  const STORAGE_PREFIX =
    'gs-efficiency-daily-work-hidden-rows-v1:';

  const ROW_SELECTOR =
    '#efficiencyDailyWorkPaper ' +
    '[data-efficiency-daily-work-row-key]';

  const ROLE_CELL_SELECTOR =
    '.efficiency-daily-work-table__role-cell';

  const ROW_LABELS = {
    'efficiency-overall':
      '효율업무 총괄',

    'efficiency-1':
      '효율업무1',

    'efficiency-2':
      '효율업무2',

    'efficiency-3':
      '효율업무3',

    'purchase-admin':
      '구매·행정업무',

    'operation-day':
      'Day 근무조',

    'operation-night':
      'Night 근무조'
  };

  if (
    window.__gsEfficiencyDailyWorkRowHideV1
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

  window.__gsEfficiencyDailyWorkRowHideV1 =
    true;


  let lastDate = '';
  let menu = null;

  const groupStates = [];


  const getDateValue = () =>
    String(
      document.getElementById(
        'efficiencyDailyWorkDate'
      )?.value || ''
    ).trim();


  const getStorageKey = dateValue =>
    `${STORAGE_PREFIX}${dateValue || 'unknown'}`;


  const getRowKey = row =>
    String(
      row?.dataset
        ?.efficiencyDailyWorkRowKey ||
      ''
    ).trim();


  const getRowLabel = rowKey =>
    ROW_LABELS[rowKey] ||
    rowKey ||
    '업무행';


  const getRows = () =>
    [
      ...document.querySelectorAll(
        ROW_SELECTOR
      )
    ];


  const loadHiddenRows = dateValue => {

    if (!dateValue) {
      return [];
    }

    try {

      const raw =
        localStorage.getItem(
          getStorageKey(dateValue)
        );

      if (!raw) {
        return [];
      }

      const parsed =
        JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return [
        ...new Set(
          parsed
            .map(value =>
              String(
                value || ''
              ).trim()
            )
            .filter(value =>
              Object.prototype
                .hasOwnProperty.call(
                  ROW_LABELS,
                  value
                )
            )
        )
      ];

    } catch {
      return [];
    }
  };


  const saveHiddenRows = (
    dateValue,
    hiddenRows
  ) => {

    if (!dateValue) {
      return;
    }

    const normalized = [
      ...new Set(
        hiddenRows.filter(value =>
          Object.prototype
            .hasOwnProperty.call(
              ROW_LABELS,
              value
            )
        )
      )
    ];

    try {
      localStorage.setItem(
        getStorageKey(dateValue),
        JSON.stringify(normalized)
      );
    } catch (_) {
      // Layout preference failure must not affect document work.
    }
  };


  const showMessage = message => {

    if (
      typeof window.showToast ===
      'function'
    ) {
      window.showToast(message);
      return;
    }

    console.info(
      `[${VERSION}] ${message}`
    );
  };


  /*
   * rowspan 셀을 최초 한 번만 확보한다.
   *
   * 효율파트:
   *   efficiency-overall 행에 rowspan=5
   *
   * 운전파트:
   *   operation-day 행에 rowspan=2
   */
  const captureGroupStates = () => {

    if (groupStates.length) {
      return true;
    }

    const table =
      document.querySelector(
        '#efficiencyDailyWorkPaper ' +
        '.efficiency-daily-work-table'
      );

    if (!table) {
      return false;
    }

    const bodies = [
      table.querySelector(
        '.efficiency-daily-work-table__efficiency-body'
      ),

      table.querySelector(
        '.efficiency-daily-work-table__operation-body'
      )
    ].filter(Boolean);

    for (const body of bodies) {

      const rows = [
        ...body.querySelectorAll(
          ':scope > tr' +
          '[data-efficiency-daily-work-row-key]'
        )
      ];

      if (!rows.length) {
        continue;
      }

      const groupCell =
        body.querySelector(
          '.efficiency-daily-work-table__group-cell'
        );

      if (!groupCell) {
        continue;
      }

      groupStates.push({
        body,
        rows,
        groupCell,
        homeRow:
          groupCell.closest('tr')
      });
    }

    return (
      groupStates.length > 0
    );
  };


  /*
   * 숨김 후에도 효율파트/운전파트 셀을
   * 첫 번째 보이는 행으로 이동하고
   * rowspan을 보이는 행 개수로 조정한다.
   */
  const syncGroupCells = () => {

    if (!captureGroupStates()) {
      return;
    }

    groupStates.forEach(group => {

      const visibleRows =
        group.rows.filter(
          row => !row.hidden
        );

      if (!visibleRows.length) {
        return;
      }

      const targetRow =
        visibleRows[0];

      if (
        group.groupCell.parentElement !==
        targetRow
      ) {
        targetRow.insertBefore(
          group.groupCell,
          targetRow.firstElementChild
        );
      }

      group.groupCell.rowSpan =
        visibleRows.length;

      group.groupCell.hidden =
        false;
    });
  };


  const applyHiddenRows = () => {

    const dateValue =
      getDateValue();

    if (!dateValue) {
      return;
    }

    const hidden =
      new Set(
        loadHiddenRows(dateValue)
      );

    getRows().forEach(row => {

      const rowKey =
        getRowKey(row);

      row.hidden =
        hidden.has(rowKey);

      row.setAttribute(
        'data-row-hidden-v1',
        row.hidden
          ? '1'
          : '0'
      );
    });

    syncGroupCells();
  };


  const getGroupVisibleRows = row => {

    const body =
      row?.closest('tbody');

    if (!body) {
      return [];
    }

    return [
      ...body.querySelectorAll(
        ':scope > tr' +
        '[data-efficiency-daily-work-row-key]'
      )
    ].filter(
      item => !item.hidden
    );
  };


  const hideRow = row => {

    if (!row) {
      return;
    }

    const rowKey =
      getRowKey(row);

    if (!rowKey) {
      return;
    }

    /*
     * 그룹의 마지막 보이는 행은 남겨둔다.
     * 전체 그룹을 지우는 기능은 별도 기능으로 취급한다.
     */
    const visibleRows =
      getGroupVisibleRows(row);

    if (visibleRows.length <= 1) {

      showMessage(
        '각 파트에는 최소 1개의 업무행을 남겨야 합니다.'
      );

      closeMenu();

      return;
    }

    const dateValue =
      getDateValue();

    const hiddenRows =
      loadHiddenRows(
        dateValue
      );

    if (
      !hiddenRows.includes(rowKey)
    ) {
      hiddenRows.push(rowKey);
    }

    saveHiddenRows(
      dateValue,
      hiddenRows
    );

    applyHiddenRows();

    closeMenu();
  };


  const restoreRow = rowKey => {

    const dateValue =
      getDateValue();

    const hiddenRows =
      loadHiddenRows(
        dateValue
      ).filter(
        value =>
          value !== rowKey
      );

    saveHiddenRows(
      dateValue,
      hiddenRows
    );

    applyHiddenRows();

    closeMenu();
  };


  const restoreAll = () => {

    const dateValue =
      getDateValue();

    saveHiddenRows(
      dateValue,
      []
    );

    applyHiddenRows();

    closeMenu();
  };


  const closeMenu = () => {

    if (menu) {
      menu.hidden = true;
      menu.replaceChildren();
    }
  };


  const createMenuButton = (
    label,
    handler,
    options = {}
  ) => {

    const button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'daily-work-row-context-button-v1';

    if (options.danger) {
      button.classList.add(
        'is-danger'
      );
    }

    button.textContent =
      label;

    button.addEventListener(
      'click',
      event => {

        event.preventDefault();
        event.stopPropagation();

        handler();
      }
    );

    return button;
  };


  const ensureMenu = () => {

    if (menu?.isConnected) {
      return menu;
    }

    menu =
      document.createElement(
        'div'
      );

    menu.id =
      'efficiencyDailyWorkRowContextMenuV1';

    menu.hidden =
      true;

    /*
     * Standalone mode hides normal body children.
     * Put the menu inside the visible standalone workspace.
     */
    const host =
      document.querySelector(
        '[data-efficiency-daily-work-standalone="1"]'
      ) ||
      document.getElementById(
        'efficiencyDailyWorkView'
      ) ||
      document.body;

    host.append(
      menu
    );

    return menu;
  };


  const positionMenu = (
    menuElement,
    x,
    y
  ) => {

    menuElement.style.left =
      `${x}px`;

    menuElement.style.top =
      `${y}px`;

    const rect =
      menuElement
        .getBoundingClientRect();

    const margin = 10;

    if (
      rect.right >
      window.innerWidth - margin
    ) {
      menuElement.style.left =
        `${Math.max(
          margin,
          window.innerWidth -
          rect.width -
          margin
        )}px`;
    }

    if (
      rect.bottom >
      window.innerHeight - margin
    ) {
      menuElement.style.top =
        `${Math.max(
          margin,
          window.innerHeight -
          rect.height -
          margin
        )}px`;
    }
  };


  const openMenu = (
    row,
    x,
    y
  ) => {

    const menuElement =
      ensureMenu();

    menuElement.replaceChildren();

    const rowKey =
      getRowKey(row);

    const title =
      document.createElement(
        'div'
      );

    title.className =
      'daily-work-row-context-title-v1';

    title.textContent =
      getRowLabel(rowKey);

    menuElement.append(
      title
    );


    menuElement.append(
      createMenuButton(
        '이 행 숨기기',
        () =>
          hideRow(row),
        {
          danger: true
        }
      )
    );


    const hiddenRows =
      loadHiddenRows(
        getDateValue()
      );

    if (hiddenRows.length) {

      const divider =
        document.createElement(
          'div'
        );

      divider.className =
        'daily-work-row-context-divider-v1';

      menuElement.append(
        divider
      );


      const restoreTitle =
        document.createElement(
          'div'
        );

      restoreTitle.className =
        'daily-work-row-context-subtitle-v1';

      restoreTitle.textContent =
        '숨긴 행 복원';

      menuElement.append(
        restoreTitle
      );


      hiddenRows.forEach(
        hiddenRowKey => {

          menuElement.append(
            createMenuButton(
              `${getRowLabel(
                hiddenRowKey
              )} 복원`,
              () =>
                restoreRow(
                  hiddenRowKey
                )
            )
          );
        }
      );


      const divider2 =
        document.createElement(
          'div'
        );

      divider2.className =
        'daily-work-row-context-divider-v1';

      menuElement.append(
        divider2
      );


      menuElement.append(
        createMenuButton(
          '숨긴 행 모두 복원',
          restoreAll
        )
      );
    }


    menuElement.hidden =
      false;

    positionMenu(
      menuElement,
      x,
      y
    );
  };


  const installStyle = () => {

    if (
      document.getElementById(
        'efficiencyDailyWorkRowHideStyleV1'
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'efficiencyDailyWorkRowHideStyleV1';

    style.textContent = `
      #efficiencyDailyWorkRowContextMenuV1 {
        position: fixed;

        z-index: 2147483647;

        min-width: 180px;
        max-width: 260px;

        padding: 7px;

        border:
          1px solid #bdcad8;

        border-radius: 8px;

        background:
          rgba(255,255,255,.99);

        box-shadow:
          0 10px 28px
          rgba(27,48,71,.23);
      }

      #efficiencyDailyWorkRowContextMenuV1[hidden] {
        display: none !important;
      }

      .daily-work-row-context-title-v1 {
        padding:
          5px 7px 7px;

        color: #183754;

        font-size: 11px;
        font-weight: 900;
      }

      .daily-work-row-context-subtitle-v1 {
        padding:
          5px 7px 4px;

        color: #73859a;

        font-size: 9px;
        font-weight: 800;
      }

      .daily-work-row-context-divider-v1 {
        height: 1px;

        margin:
          5px 2px;

        background:
          #e1e7ee;
      }

      .daily-work-row-context-button-v1 {
        display: block;

        width: 100%;
        min-height: 30px;

        padding:
          5px 8px;

        border: 0;
        border-radius: 5px;

        background:
          transparent;

        color: #29455f;

        text-align: left;

        font-size: 10px;
        font-weight: 800;

        cursor: pointer;
      }

      .daily-work-row-context-button-v1:hover {
        background:
          #eef5fc;
      }

      .daily-work-row-context-button-v1.is-danger {
        color: #b14444;
      }

      .daily-work-row-context-button-v1.is-danger:hover {
        background:
          #fff0f0;
      }

      #efficiencyDailyWorkPaper
      .efficiency-daily-work-table__role-cell
      > span {
        cursor: context-menu;
      }

      @media print {
        #efficiencyDailyWorkRowContextMenuV1 {
          display: none !important;
        }
      }
    `;

    document.head.append(
      style
    );
  };


  installStyle();


  /*
   * 우클릭 대상:
   * 업무명/담당자 열의 빈 영역 또는 업무명 span.
   *
   * input / select 자체를 우클릭하면
   * 브라우저 기본 컨텍스트 메뉴를 유지한다.
   */
  document.addEventListener(
    'contextmenu',
    event => {

      const target =
        event.target instanceof Element
          ? event.target
          : null;

      if (!target) {
        return;
      }

      if (
        target.closest(
          'input, textarea, select'
        )
      ) {
        return;
      }

      const roleCell =
        target.closest(
          ROLE_CELL_SELECTOR
        );

      if (!roleCell) {
        return;
      }

      const row =
        roleCell.closest(
          ROW_SELECTOR
        );

      if (!row) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      openMenu(
        row,
        event.clientX,
        event.clientY
      );
    },
    true
  );


  /*
   * 메뉴 밖 클릭 시 닫기.
   */
  document.addEventListener(
    'pointerdown',
    event => {

      if (
        menu &&
        !menu.hidden &&
        event.target instanceof Node &&
        !menu.contains(
          event.target
        )
      ) {
        closeMenu();
      }
    },
    true
  );


  window.addEventListener(
    'resize',
    closeMenu
  );


  /*
   * Standalone workspace itself scrolls,
   * so close context menu while wheel scrolling.
   */
  document.addEventListener(
    'wheel',
    () => {
      if (
        menu &&
        !menu.hidden
      ) {
        closeMenu();
      }
    },
    {
      capture: true,
      passive: true
    }
  );


  /*
   * Initial DOM readiness.
   * No MutationObserver.
   */
  let attempts = 0;

  const startupTimer =
    window.setInterval(
      () => {

        attempts += 1;

        if (
          captureGroupStates() ||
          attempts >= 150
        ) {

          window.clearInterval(
            startupTimer
          );

          lastDate =
            getDateValue();

          applyHiddenRows();
        }
      },
      100
    );


  /*
   * Date switch reconciliation.
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

          closeMenu();

          lastDate =
            currentDate;

          applyHiddenRows();
        }
      },
      500
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
    {
      once: true
    }
  );


  console.info(
    `[${VERSION}] ready`
  );
})();

/* =========================================================
   EFFICIENCY DAILY WORK ROW DELETE V1

   Fixed-schema-safe destructive delete:
   - right click role row
   - clear row input values
   - hide row
   - normal Save persists blank values
   - session undo restores previous values
   - no DB/API/schema changes
   - no MutationObserver
========================================================= */
(() => {
  'use strict';

  const VERSION =
    'EFFICIENCY_DAILY_WORK_ROW_DELETE_V1';

  const WINDOW_PARAM =
    'efficiencyDailyWorkWindow';

  const HIDDEN_STORAGE_PREFIX =
    'gs-efficiency-daily-work-hidden-rows-v1:';

  const SNAPSHOT_PREFIX =
    'gs-efficiency-daily-work-row-delete-snapshot-v1:';

  const ROW_SELECTOR =
    '#efficiencyDailyWorkPaper ' +
    '[data-efficiency-daily-work-row-key]';

  const ROLE_CELL_SELECTOR =
    '.efficiency-daily-work-table__role-cell';

  const MENU_ID =
    'efficiencyDailyWorkRowContextMenuV1';

  const ROW_LABELS = {
    'efficiency-overall':
      '효율업무 총괄',

    'efficiency-1':
      '효율업무1',

    'efficiency-2':
      '효율업무2',

    'efficiency-3':
      '효율업무3',

    'purchase-admin':
      '구매·행정업무',

    'operation-day':
      'Day 근무조',

    'operation-night':
      'Night 근무조'
  };


  if (
    window.__gsEfficiencyDailyWorkRowDeleteV1
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


  window.__gsEfficiencyDailyWorkRowDeleteV1 =
    true;


  const getDateValue = () =>
    String(
      document.getElementById(
        'efficiencyDailyWorkDate'
      )?.value || ''
    ).trim();


  const getRowKey = row =>
    String(
      row?.dataset
        ?.efficiencyDailyWorkRowKey ||
      ''
    ).trim();


  const getRowLabel = rowKey =>
    ROW_LABELS[rowKey] ||
    rowKey ||
    '업무행';


  const getHiddenStorageKey = dateValue =>
    `${HIDDEN_STORAGE_PREFIX}${dateValue || 'unknown'}`;


  const getSnapshotKey = (
    dateValue,
    rowKey
  ) =>
    `${SNAPSHOT_PREFIX}${dateValue || 'unknown'}:${rowKey}`;


  const loadHiddenRows = dateValue => {

    try {

      const raw =
        localStorage.getItem(
          getHiddenStorageKey(dateValue)
        );

      if (!raw) {
        return [];
      }

      const parsed =
        JSON.parse(raw);

      return Array.isArray(parsed)
        ? [
            ...new Set(
              parsed
                .map(value =>
                  String(
                    value || ''
                  ).trim()
                )
                .filter(value =>
                  Object.prototype
                    .hasOwnProperty.call(
                      ROW_LABELS,
                      value
                    )
                )
            )
          ]
        : [];

    } catch {
      return [];
    }
  };


  const saveHiddenRows = (
    dateValue,
    rows
  ) => {

    const normalized = [
      ...new Set(
        rows.filter(value =>
          Object.prototype
            .hasOwnProperty.call(
              ROW_LABELS,
              value
            )
        )
      )
    ];

    try {
      localStorage.setItem(
        getHiddenStorageKey(dateValue),
        JSON.stringify(normalized)
      );
    } catch (_) {
      // Layout storage failure must not break document work.
    }
  };


  const collectRowSnapshot = row => {

    const controls = [
      ...row.querySelectorAll(
        'input, textarea, select'
      )
    ];

    return controls.map(control => ({
      tag:
        control.tagName,

      type:
        String(
          control.type || ''
        ),

      name:
        String(
          control.name || ''
        ),

      value:
        String(
          control.value ?? ''
        ),

      checked:
        Boolean(
          control.checked
        ),

      selectedIndex:
        control instanceof
        HTMLSelectElement
          ? control.selectedIndex
          : -1
    }));
  };


  const saveSnapshot = (
    dateValue,
    rowKey,
    snapshot
  ) => {

    try {
      sessionStorage.setItem(
        getSnapshotKey(
          dateValue,
          rowKey
        ),
        JSON.stringify(snapshot)
      );

      return true;

    } catch {
      return false;
    }
  };


  const loadSnapshot = (
    dateValue,
    rowKey
  ) => {

    try {

      const raw =
        sessionStorage.getItem(
          getSnapshotKey(
            dateValue,
            rowKey
          )
        );

      if (!raw) {
        return null;
      }

      const parsed =
        JSON.parse(raw);

      return Array.isArray(parsed)
        ? parsed
        : null;

    } catch {
      return null;
    }
  };


  const removeSnapshot = (
    dateValue,
    rowKey
  ) => {

    try {
      sessionStorage.removeItem(
        getSnapshotKey(
          dateValue,
          rowKey
        )
      );
    } catch (_) {
      // Ignore.
    }
  };


  const getDeletedRowKeys = dateValue =>
    Object.keys(
      ROW_LABELS
    ).filter(
      rowKey =>
        Array.isArray(
          loadSnapshot(
            dateValue,
            rowKey
          )
        )
    );


  const dispatchControlEvents = control => {

    try {
      control.dispatchEvent(
        new Event(
          'input',
          {
            bubbles: true
          }
        )
      );

      control.dispatchEvent(
        new Event(
          'change',
          {
            bubbles: true
          }
        )
      );
    } catch (_) {
      // Existing editor will still collect values on Save.
    }
  };


  const clearRowControls = row => {

    const controls = [
      ...row.querySelectorAll(
        'input, textarea, select'
      )
    ];

    controls.forEach(control => {

      if (
        control instanceof
        HTMLInputElement
      ) {

        if (
          control.type ===
            'checkbox' ||
          control.type ===
            'radio'
        ) {
          control.checked =
            false;
        }
        else {
          control.value =
            '';
        }

      }
      else if (
        control instanceof
        HTMLSelectElement
      ) {

        control.selectedIndex =
          0;

      }
      else if (
        control instanceof
        HTMLTextAreaElement
      ) {

        control.value =
          '';
      }

      dispatchControlEvents(
        control
      );
    });
  };


  const restoreRowControls = (
    row,
    snapshot
  ) => {

    const controls = [
      ...row.querySelectorAll(
        'input, textarea, select'
      )
    ];

    controls.forEach(
      (control, index) => {

        const saved =
          snapshot[index];

        if (!saved) {
          return;
        }

        if (
          control instanceof
          HTMLInputElement
        ) {

          if (
            control.type ===
              'checkbox' ||
            control.type ===
              'radio'
          ) {

            control.checked =
              Boolean(
                saved.checked
              );
          }
          else {

            control.value =
              String(
                saved.value ?? ''
              );
          }

        }
        else if (
          control instanceof
          HTMLSelectElement
        ) {

          const matchingValue =
            String(
              saved.value ?? ''
            );

          control.value =
            matchingValue;

          if (
            control.value !==
            matchingValue &&
            Number.isInteger(
              saved.selectedIndex
            )
          ) {
            control.selectedIndex =
              saved.selectedIndex;
          }

        }
        else if (
          control instanceof
          HTMLTextAreaElement
        ) {

          control.value =
            String(
              saved.value ?? ''
            );
        }

        dispatchControlEvents(
          control
        );
      }
    );
  };


  const syncGroupCells = () => {

    const table =
      document.querySelector(
        '#efficiencyDailyWorkPaper ' +
        '.efficiency-daily-work-table'
      );

    if (!table) {
      return;
    }

    [
      '.efficiency-daily-work-table__efficiency-body',
      '.efficiency-daily-work-table__operation-body'
    ].forEach(
      bodySelector => {

        const body =
          table.querySelector(
            bodySelector
          );

        if (!body) {
          return;
        }

        const rows = [
          ...body.querySelectorAll(
            ':scope > tr' +
            '[data-efficiency-daily-work-row-key]'
          )
        ];

        const visibleRows =
          rows.filter(
            row => !row.hidden
          );

        if (!visibleRows.length) {
          return;
        }

        const groupCell =
          body.querySelector(
            '.efficiency-daily-work-table__group-cell'
          );

        if (!groupCell) {
          return;
        }

        const firstVisible =
          visibleRows[0];

        if (
          groupCell.parentElement !==
          firstVisible
        ) {
          firstVisible.insertBefore(
            groupCell,
            firstVisible.firstElementChild
          );
        }

        groupCell.rowSpan =
          visibleRows.length;

        groupCell.hidden =
          false;
      }
    );
  };


  const getVisibleRowsInGroup = row => {

    const body =
      row?.closest('tbody');

    if (!body) {
      return [];
    }

    return [
      ...body.querySelectorAll(
        ':scope > tr' +
        '[data-efficiency-daily-work-row-key]'
      )
    ].filter(
      item =>
        !item.hidden
    );
  };


  const hideRowAfterDelete = (
    row,
    rowKey,
    dateValue
  ) => {

    const hiddenRows =
      loadHiddenRows(
        dateValue
      );

    if (
      !hiddenRows.includes(
        rowKey
      )
    ) {
      hiddenRows.push(
        rowKey
      );
    }

    saveHiddenRows(
      dateValue,
      hiddenRows
    );

    row.hidden =
      true;

    row.setAttribute(
      'data-row-hidden-v1',
      '1'
    );

    row.setAttribute(
      'data-row-deleted-v1',
      '1'
    );

    syncGroupCells();
  };


  const showMessage = message => {

    if (
      typeof window.showToast ===
      'function'
    ) {
      window.showToast(
        message
      );

      return;
    }

    console.info(
      `[${VERSION}] ${message}`
    );
  };


  const confirmDelete = (
    rowLabel,
    hasContent
  ) => {

    const message =
      hasContent
        ? (
          `${rowLabel} 행을 삭제하시겠습니까?\n\n` +
          `담당자 / 주요 업무 / 비고 등의 입력값이 모두 삭제되고 행이 숨겨집니다.\n` +
          `아직 [저장]을 누르기 전이라면 삭제 취소로 복구할 수 있습니다.`
        )
        : (
          `${rowLabel} 빈 행을 삭제하고 숨기시겠습니까?`
        );

    return window.confirm(
      message
    );
  };


  const rowHasContent = row =>
    [
      ...row.querySelectorAll(
        'input, textarea, select'
      )
    ].some(control => {

      if (
        control instanceof
        HTMLInputElement &&
        (
          control.type ===
            'checkbox' ||
          control.type ===
            'radio'
        )
      ) {
        return control.checked;
      }

      return Boolean(
        String(
          control.value || ''
        ).trim()
      );
    });


  const deleteRow = row => {

    if (!row) {
      return;
    }

    const rowKey =
      getRowKey(row);

    if (!rowKey) {
      return;
    }

    const visibleRows =
      getVisibleRowsInGroup(
        row
      );

    /*
     * 효율파트/운전파트가 통째로 사라지지 않도록
     * 각 그룹의 마지막 한 줄은 삭제 금지.
     */
    if (
      visibleRows.length <= 1
    ) {

      showMessage(
        '각 파트에는 최소 1개의 업무행을 남겨야 합니다.'
      );

      return;
    }

    const dateValue =
      getDateValue();

    if (!dateValue) {
      return;
    }

    const label =
      getRowLabel(
        rowKey
      );

    if (
      !confirmDelete(
        label,
        rowHasContent(row)
      )
    ) {
      return;
    }


    /*
     * 최초 삭제 전 값만 보존한다.
     * 삭제 -> 메뉴 다시 열기 같은 동작으로
     * 원본 snapshot이 덮이지 않게 한다.
     */
    if (
      !loadSnapshot(
        dateValue,
        rowKey
      )
    ) {

      const snapshot =
        collectRowSnapshot(
          row
        );

      if (
        !saveSnapshot(
          dateValue,
          rowKey,
          snapshot
        )
      ) {

        const continueWithoutUndo =
          window.confirm(
            '삭제 취소용 임시 백업을 만들지 못했습니다.\n그래도 삭제를 계속하시겠습니까?'
          );

        if (
          !continueWithoutUndo
        ) {
          return;
        }
      }
    }


    clearRowControls(
      row
    );

    hideRowAfterDelete(
      row,
      rowKey,
      dateValue
    );

    const menu =
      document.getElementById(
        MENU_ID
      );

    if (menu) {
      menu.hidden =
        true;
    }

    showMessage(
      `${label} 행을 삭제했습니다. 최종 반영은 [저장] 후 적용됩니다.`
    );
  };


  const undoDelete = rowKey => {

    const dateValue =
      getDateValue();

    const snapshot =
      loadSnapshot(
        dateValue,
        rowKey
      );

    if (!snapshot) {
      return;
    }

    const row =
      document.querySelector(
        `${ROW_SELECTOR}[data-efficiency-daily-work-row-key="${rowKey}"]`
      );

    if (!row) {
      return;
    }


    restoreRowControls(
      row,
      snapshot
    );


    const hiddenRows =
      loadHiddenRows(
        dateValue
      ).filter(
        value =>
          value !== rowKey
      );

    saveHiddenRows(
      dateValue,
      hiddenRows
    );


    row.hidden =
      false;

    row.setAttribute(
      'data-row-hidden-v1',
      '0'
    );

    row.removeAttribute(
      'data-row-deleted-v1'
    );


    syncGroupCells();

    removeSnapshot(
      dateValue,
      rowKey
    );


    const menu =
      document.getElementById(
        MENU_ID
      );

    if (menu) {
      menu.hidden =
        true;
    }


    showMessage(
      `${getRowLabel(rowKey)} 삭제를 취소했습니다.`
    );
  };


  const createDeleteButton = (
    text,
    clickHandler,
    className = ''
  ) => {

    const button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'daily-work-row-context-button-v1 ' +
      className;

    button.textContent =
      text;

    button.addEventListener(
      'click',
      event => {

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        clickHandler();
      }
    );

    return button;
  };


  const appendDeleteActions = row => {

    const menu =
      document.getElementById(
        MENU_ID
      );

    if (
      !menu ||
      menu.hidden
    ) {
      return;
    }


    /*
     * 같은 메뉴에 중복 삽입 방지.
     */
    menu.querySelectorAll(
      '[data-row-delete-v1-ui]'
    ).forEach(
      element =>
        element.remove()
    );


    const hideButton = [
      ...menu.querySelectorAll(
        'button'
      )
    ].find(
      button =>
        button.textContent
          ?.trim() ===
        '이 행 숨기기'
    );


    if (hideButton) {

      const divider =
        document.createElement(
          'div'
        );

      divider.className =
        'daily-work-row-context-divider-v1';

      divider.dataset
        .rowDeleteV1Ui =
        '1';


      const deleteButton =
        createDeleteButton(
          '이 행 삭제',
          () =>
            deleteRow(row),
          'is-delete-v1'
        );

      deleteButton.dataset
        .rowDeleteV1Ui =
        '1';


      const note =
        document.createElement(
          'div'
        );

      note.className =
        'daily-work-row-delete-note-v1';

      note.dataset
        .rowDeleteV1Ui =
        '1';

      note.textContent =
        '입력내용 삭제 + 행 숨김';


      hideButton.insertAdjacentElement(
        'afterend',
        divider
      );

      divider.insertAdjacentElement(
        'afterend',
        deleteButton
      );

      deleteButton.insertAdjacentElement(
        'afterend',
        note
      );
    }


    const dateValue =
      getDateValue();

    const deletedRows =
      getDeletedRowKeys(
        dateValue
      );


    if (deletedRows.length) {

      const divider =
        document.createElement(
          'div'
        );

      divider.className =
        'daily-work-row-context-divider-v1';

      divider.dataset
        .rowDeleteV1Ui =
        '1';


      const title =
        document.createElement(
          'div'
        );

      title.className =
        'daily-work-row-context-subtitle-v1';

      title.dataset
        .rowDeleteV1Ui =
        '1';

      title.textContent =
        '삭제 취소';


      menu.append(
        divider,
        title
      );


      deletedRows.forEach(
        deletedRowKey => {

          const button =
            createDeleteButton(
              `${getRowLabel(
                deletedRowKey
              )} 삭제 취소`,
              () =>
                undoDelete(
                  deletedRowKey
                )
            );

          button.dataset
            .rowDeleteV1Ui =
            '1';

          menu.append(
            button
          );
        }
      );
    }


    /*
     * 항목 추가로 메뉴 높이가 커진 경우
     * 화면 아래/오른쪽 밖으로 빠지지 않게 보정.
     */
    const rect =
      menu.getBoundingClientRect();

    const margin =
      10;

    if (
      rect.right >
      window.innerWidth -
      margin
    ) {
      menu.style.left =
        `${Math.max(
          margin,
          window.innerWidth -
          rect.width -
          margin
        )}px`;
    }

    if (
      rect.bottom >
      window.innerHeight -
      margin
    ) {
      menu.style.top =
        `${Math.max(
          margin,
          window.innerHeight -
          rect.height -
          margin
        )}px`;
    }
  };


  const installStyle = () => {

    if (
      document.getElementById(
        'efficiencyDailyWorkRowDeleteStyleV1'
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'efficiencyDailyWorkRowDeleteStyleV1';

    style.textContent = `
      #efficiencyDailyWorkRowContextMenuV1
      .daily-work-row-context-button-v1.is-delete-v1 {
        color: #b3261e !important;
        font-weight: 900 !important;
      }

      #efficiencyDailyWorkRowContextMenuV1
      .daily-work-row-context-button-v1.is-delete-v1:hover {
        background: #fff0ef !important;
      }

      #efficiencyDailyWorkRowContextMenuV1
      .daily-work-row-delete-note-v1 {
        padding:
          1px
          8px
          5px;

        color: #9a6a67;

        font-size: 8px;
        font-weight: 700;
      }
    `;

    document.head.append(
      style
    );
  };


  installStyle();


  /*
   * 기존 Row Hide V1 contextmenu listener가
   * 메뉴를 생성한 직후 동일 document에서 실행된다.
   *
   * 기존 함수를 override하지 않고
   * 열린 메뉴에 Delete 항목만 추가한다.
   */
  document.addEventListener(
    'contextmenu',
    event => {

      const target =
        event.target instanceof Element
          ? event.target
          : null;

      if (!target) {
        return;
      }


      if (
        target.closest(
          'input, textarea, select'
        )
      ) {
        return;
      }


      const roleCell =
        target.closest(
          ROLE_CELL_SELECTOR
        );

      if (!roleCell) {
        return;
      }


      const row =
        roleCell.closest(
          ROW_SELECTOR
        );

      if (!row) {
        return;
      }


      /*
       * Row Hide V1이 같은 이벤트에서 먼저 메뉴를 연다.
       * 같은 dispatch 종료 직후 확실하게 항목을 보강.
       */
      queueMicrotask(
        () =>
          appendDeleteActions(
            row
          )
      );
    },
    true
  );


  console.info(
    `[${VERSION}] ready`
  );
})();

/* =========================================================
   EFFICIENCY DAILY WORK SELECTED DELETE V2

   - selected table cell -> reuse existing ROW menu
   - selected Notice / TM / Team instruction -> delete item
   - selected Other Notes -> delete item
   - right click inside textarea works when its block is active
   - undo in current browser session
   - no DB/API/schema changes
========================================================= */
(() => {
  'use strict';

  const VERSION =
    'EFFICIENCY_DAILY_WORK_SELECTED_DELETE_V2';

  const WINDOW_PARAM =
    'efficiencyDailyWorkWindow';

  const MENU_ID =
    'efficiencyDailyWorkRowContextMenuV1';

  const DELETED_STORAGE_PREFIX =
    'gs-efficiency-daily-work-deleted-blocks-v2:';

  const SNAPSHOT_PREFIX =
    'gs-efficiency-daily-work-block-delete-snapshot-v2:';

  const ROW_SELECTOR =
    '#efficiencyDailyWorkPaper ' +
    '[data-efficiency-daily-work-row-key]';

  const ROLE_CELL_SELECTOR =
    '.efficiency-daily-work-table__role-cell';

  const ACTIVE_CLASS =
    'is-efficiency-spreadsheet-active';

  const BLOCK_SELECTOR =
    '.efficiency-daily-work-instruction-field,' +
    '.efficiency-daily-work-other-field';

  const BLOCKS = {
    notice: {
      controlId:
        'efficiencyDailyWorkNotice',
      label:
        '공지사항'
    },

    tmMeeting: {
      controlId:
        'efficiencyDailyWorkTmMeeting',
      label:
        'TM 회의'
    },

    teamInstruction: {
      controlId:
        'efficiencyDailyWorkTeamInstruction',
      label:
        '설비운영팀'
    },

    otherNotes: {
      controlId:
        'efficiencyDailyWorkOtherNotes',
      label:
        '기타사항'
    }
  };


  if (
    window.__gsEfficiencyDailyWorkSelectedDeleteV2
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


  window.__gsEfficiencyDailyWorkSelectedDeleteV2 =
    true;


  let lastDate = '';


  const getDateValue = () =>
    String(
      document.getElementById(
        'efficiencyDailyWorkDate'
      )?.value || ''
    ).trim();


  const getDeletedStorageKey = dateValue =>
    `${DELETED_STORAGE_PREFIX}${dateValue || 'unknown'}`;


  const getSnapshotKey = (
    dateValue,
    blockKey
  ) =>
    `${SNAPSHOT_PREFIX}${dateValue || 'unknown'}:${blockKey}`;


  const loadDeletedBlocks = dateValue => {

    if (!dateValue) {
      return [];
    }

    try {

      const raw =
        localStorage.getItem(
          getDeletedStorageKey(dateValue)
        );

      if (!raw) {
        return [];
      }

      const parsed =
        JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return [
        ...new Set(
          parsed.filter(
            key =>
              Object.prototype
                .hasOwnProperty.call(
                  BLOCKS,
                  key
                )
          )
        )
      ];

    } catch {
      return [];
    }
  };


  const saveDeletedBlocks = (
    dateValue,
    blockKeys
  ) => {

    if (!dateValue) {
      return;
    }

    const normalized = [
      ...new Set(
        blockKeys.filter(
          key =>
            Object.prototype
              .hasOwnProperty.call(
                BLOCKS,
                key
              )
        )
      )
    ];

    try {
      localStorage.setItem(
        getDeletedStorageKey(dateValue),
        JSON.stringify(normalized)
      );
    } catch (_) {
      // Layout preference failure must not break editor.
    }
  };


  const getBlockByKey = blockKey => {

    const definition =
      BLOCKS[blockKey];

    if (!definition) {
      return null;
    }

    const control =
      document.getElementById(
        definition.controlId
      );

    if (!control) {
      return null;
    }

    const block =
      control.closest(
        BLOCK_SELECTOR
      );

    if (!block) {
      return null;
    }

    return {
      blockKey,
      definition,
      control,
      block
    };
  };


  const findBlockInfo = block => {

    if (!block) {
      return null;
    }

    for (
      const [
        blockKey,
        definition
      ] of Object.entries(BLOCKS)
    ) {

      const control =
        document.getElementById(
          definition.controlId
        );

      if (
        control &&
        control.closest(
          BLOCK_SELECTOR
        ) === block
      ) {
        return {
          blockKey,
          definition,
          control,
          block
        };
      }
    }

    return null;
  };


  const saveSnapshot = (
    dateValue,
    blockKey,
    value
  ) => {

    try {

      if (
        sessionStorage.getItem(
          getSnapshotKey(
            dateValue,
            blockKey
          )
        ) !== null
      ) {
        return true;
      }

      sessionStorage.setItem(
        getSnapshotKey(
          dateValue,
          blockKey
        ),
        JSON.stringify({
          value:
            String(
              value ?? ''
            )
        })
      );

      return true;

    } catch {
      return false;
    }
  };


  const loadSnapshot = (
    dateValue,
    blockKey
  ) => {

    try {

      const raw =
        sessionStorage.getItem(
          getSnapshotKey(
            dateValue,
            blockKey
          )
        );

      if (!raw) {
        return null;
      }

      const parsed =
        JSON.parse(raw);

      return (
        parsed &&
        typeof parsed === 'object'
      )
        ? parsed
        : null;

    } catch {
      return null;
    }
  };


  const removeSnapshot = (
    dateValue,
    blockKey
  ) => {

    try {
      sessionStorage.removeItem(
        getSnapshotKey(
          dateValue,
          blockKey
        )
      );
    } catch (_) {
      // Ignore.
    }
  };


  const dispatchControlEvents = control => {

    try {

      control.dispatchEvent(
        new Event(
          'input',
          {
            bubbles: true
          }
        )
      );

      control.dispatchEvent(
        new Event(
          'change',
          {
            bubbles: true
          }
        )
      );

    } catch (_) {
      // Existing Save still reads the control value.
    }
  };


  const setBlockHidden = (
    block,
    hidden
  ) => {

    if (!block) {
      return;
    }

    if (hidden) {

      block.setAttribute(
        'data-selected-delete-v2-hidden',
        '1'
      );

      block.style.setProperty(
        'display',
        'none',
        'important'
      );

    } else {

      block.removeAttribute(
        'data-selected-delete-v2-hidden'
      );

      block.style.removeProperty(
        'display'
      );

      /*
       * Instruction resize V3 will restore its flex
       * display on the next reconciliation if necessary.
       */
    }
  };


  const countVisibleInstructionBlocks = (
    excludingBlock = null
  ) => {

    return [
      ...document.querySelectorAll(
        '#efficiencyDailyWorkPaper ' +
        '.efficiency-daily-work-instruction-field'
      )
    ].filter(
      block =>
        block !== excludingBlock &&
        block.getAttribute(
          'data-selected-delete-v2-hidden'
        ) !== '1'
    ).length;
  };


  const applyDeletedBlocks = () => {

    const dateValue =
      getDateValue();

    if (!dateValue) {
      return;
    }

    const deleted =
      new Set(
        loadDeletedBlocks(
          dateValue
        )
      );

    Object.keys(BLOCKS)
      .forEach(blockKey => {

        const info =
          getBlockByKey(
            blockKey
          );

        if (!info) {
          return;
        }

        setBlockHidden(
          info.block,
          deleted.has(blockKey)
        );
      });
  };


  const showMessage = message => {

    if (
      typeof window.showToast ===
      'function'
    ) {

      window.showToast(
        message
      );

      return;
    }

    console.info(
      `[${VERSION}] ${message}`
    );
  };


  const confirmDeleteBlock = (
    info
  ) => {

    const hasContent =
      Boolean(
        String(
          info.control.value ||
          ''
        ).trim()
      );

    const message =
      hasContent
        ? (
          `${info.definition.label} 항목을 삭제하시겠습니까?\n\n` +
          `입력된 내용이 삭제되고 화면에서도 숨겨집니다.\n` +
          `현재 창에서는 [삭제 취소]로 복원할 수 있습니다.`
        )
        : (
          `${info.definition.label} 빈 항목을 삭제하고 숨기시겠습니까?`
        );

    return window.confirm(
      message
    );
  };


  const deleteBlock = info => {

    if (!info) {
      return;
    }

    const dateValue =
      getDateValue();

    if (!dateValue) {
      return;
    }


    /*
     * 공지 / TM / 설비운영팀 3개를 전부 지우면
     * 상단 검은 박스 자체가 빈 구조가 되므로
     * 최소 한 항목은 남긴다.
     */
    if (
      info.block.matches(
        '.efficiency-daily-work-instruction-field'
      ) &&
      countVisibleInstructionBlocks(
        info.block
      ) < 1
    ) {

      showMessage(
        '주요 전달 및 지시사항에는 최소 1개의 항목을 남겨야 합니다.'
      );

      closeMenu();

      return;
    }


    if (
      !confirmDeleteBlock(
        info
      )
    ) {
      return;
    }


    if (
      !saveSnapshot(
        dateValue,
        info.blockKey,
        info.control.value
      )
    ) {

      const proceed =
        window.confirm(
          '삭제 취소용 임시 백업을 만들지 못했습니다.\n그래도 삭제를 계속하시겠습니까?'
        );

      if (!proceed) {
        return;
      }
    }


    info.control.value =
      '';

    dispatchControlEvents(
      info.control
    );


    const deleted =
      loadDeletedBlocks(
        dateValue
      );

    if (
      !deleted.includes(
        info.blockKey
      )
    ) {
      deleted.push(
        info.blockKey
      );
    }

    saveDeletedBlocks(
      dateValue,
      deleted
    );


    setBlockHidden(
      info.block,
      true
    );


    closeMenu();


    showMessage(
      `${info.definition.label} 항목을 삭제했습니다. 최종 반영은 [저장] 후 적용됩니다.`
    );
  };


  const restoreBlock = blockKey => {

    const dateValue =
      getDateValue();

    const info =
      getBlockByKey(
        blockKey
      );

    if (
      !dateValue ||
      !info
    ) {
      return;
    }


    const snapshot =
      loadSnapshot(
        dateValue,
        blockKey
      );


    if (snapshot) {

      info.control.value =
        String(
          snapshot.value ?? ''
        );

      dispatchControlEvents(
        info.control
      );
    }


    const deleted =
      loadDeletedBlocks(
        dateValue
      ).filter(
        key =>
          key !== blockKey
      );


    saveDeletedBlocks(
      dateValue,
      deleted
    );


    setBlockHidden(
      info.block,
      false
    );


    removeSnapshot(
      dateValue,
      blockKey
    );


    closeMenu();


    showMessage(
      `${info.definition.label} 항목을 복원했습니다.`
    );
  };


  const closeMenu = () => {

    const menu =
      document.getElementById(
        MENU_ID
      );

    if (menu) {
      menu.hidden =
        true;
    }
  };


  const createMenuButton = (
    label,
    handler,
    options = {}
  ) => {

    const button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'daily-work-row-context-button-v1';

    if (options.danger) {
      button.classList.add(
        'is-delete-v1'
      );
    }

    button.textContent =
      label;

    button.addEventListener(
      'click',
      event => {

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        handler();
      }
    );

    return button;
  };


  /*
   * Existing Row Hide V1 owns the context menu element.
   * Trigger it once on an existing row so we reuse
   * exactly the same menu/close behaviour.
   */
  const ensureExistingMenu = (
    x,
    y
  ) => {

    let menu =
      document.getElementById(
        MENU_ID
      );

    if (menu) {
      return menu;
    }


    const roleCell =
      document.querySelector(
        '#efficiencyDailyWorkPaper ' +
        'tr:not([hidden]) ' +
        ROLE_CELL_SELECTOR
      );

    if (!roleCell) {
      return null;
    }


    roleCell.dispatchEvent(
      new MouseEvent(
        'contextmenu',
        {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 2
        }
      )
    );


    return document.getElementById(
      MENU_ID
    );
  };


  const positionMenu = (
    menu,
    x,
    y
  ) => {

    menu.style.left =
      `${x}px`;

    menu.style.top =
      `${y}px`;

    menu.hidden =
      false;


    const rect =
      menu.getBoundingClientRect();

    const margin =
      10;


    if (
      rect.right >
      window.innerWidth -
      margin
    ) {

      menu.style.left =
        `${Math.max(
          margin,
          window.innerWidth -
          rect.width -
          margin
        )}px`;
    }


    if (
      rect.bottom >
      window.innerHeight -
      margin
    ) {

      menu.style.top =
        `${Math.max(
          margin,
          window.innerHeight -
          rect.height -
          margin
        )}px`;
    }
  };


  const populateBlockMenu = (
    info,
    x,
    y
  ) => {

    const menu =
      ensureExistingMenu(
        x,
        y
      );

    if (!menu) {
      return;
    }


    menu.replaceChildren();


    const title =
      document.createElement(
        'div'
      );

    title.className =
      'daily-work-row-context-title-v1';

    title.textContent =
      info.definition.label;


    const deleteButton =
      createMenuButton(
        '이 항목 삭제',
        () =>
          deleteBlock(info),
        {
          danger: true
        }
      );


    const note =
      document.createElement(
        'div'
      );

    note.className =
      'daily-work-row-delete-note-v1';

    note.textContent =
      '입력내용 삭제 + 화면에서 숨김';


    menu.append(
      title,
      deleteButton,
      note
    );


    const dateValue =
      getDateValue();

    const deletedBlocks =
      loadDeletedBlocks(
        dateValue
      );


    if (deletedBlocks.length) {

      const divider =
        document.createElement(
          'div'
        );

      divider.className =
        'daily-work-row-context-divider-v1';


      const restoreTitle =
        document.createElement(
          'div'
        );

      restoreTitle.className =
        'daily-work-row-context-subtitle-v1';

      restoreTitle.textContent =
        '삭제 취소';


      menu.append(
        divider,
        restoreTitle
      );


      deletedBlocks.forEach(
        blockKey => {

          const definition =
            BLOCKS[blockKey];

          if (!definition) {
            return;
          }

          menu.append(
            createMenuButton(
              `${definition.label} 삭제 취소`,
              () =>
                restoreBlock(
                  blockKey
                )
            )
          );
        }
      );
    }


    positionMenu(
      menu,
      x,
      y
    );
  };


  /*
   * Selected table cell:
   * reroute right click to the row's role cell.
   *
   * That means the already-installed:
   *   - 이 행 숨기기
   *   - 이 행 삭제
   *   - 삭제 취소
   * menu is reused unchanged.
   */
  const rerouteSelectedTableCell = (
    cell,
    event
  ) => {

    const row =
      cell.closest(
        ROW_SELECTOR
      );

    if (!row) {
      return false;
    }


    const roleCell =
      row.querySelector(
        ROLE_CELL_SELECTOR
      );

    if (!roleCell) {
      return false;
    }


    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();


    roleCell.dispatchEvent(
      new MouseEvent(
        'contextmenu',
        {
          bubbles: true,
          cancelable: true,
          clientX:
            event.clientX,
          clientY:
            event.clientY,
          button: 2
        }
      )
    );


    return true;
  };


  document.addEventListener(
    'contextmenu',
    event => {

      /*
       * Synthetic contextmenu is used above to invoke
       * the existing row menu. Do not process it again.
       */
      if (!event.isTrusted) {
        return;
      }


      const target =
        event.target instanceof Element
          ? event.target
          : null;

      if (!target) {
        return;
      }


      /*
       * 1) Table td/th selected in blue.
       *
       * User may right-click directly inside
       * textarea/input. That is intentionally supported.
       */
      const tableCell =
        target.closest(
          '#efficiencyDailyWorkPaper td,' +
          '#efficiencyDailyWorkPaper th'
        );

      if (
        tableCell &&
        tableCell.classList.contains(
          ACTIVE_CLASS
        )
      ) {

        if (
          rerouteSelectedTableCell(
            tableCell,
            event
          )
        ) {
          return;
        }
      }


      /*
       * 2) Notice / TM / Team / Other Notes selected.
       */
      const block =
        target.closest(
          BLOCK_SELECTOR
        );


      if (
        !block ||
        !block.classList.contains(
          ACTIVE_CLASS
        )
      ) {
        return;
      }


      const info =
        findBlockInfo(
          block
        );

      if (!info) {
        return;
      }


      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();


      /*
       * Existing row-delete addon uses queueMicrotask
       * when its menu opens.
       * Use a microtask after our synthetic menu creation
       * so our block menu becomes the final contents.
       */
      queueMicrotask(
        () =>
          populateBlockMenu(
            info,
            event.clientX,
            event.clientY
          )
      );
    },
    true
  );


  /*
   * Deleted blocks stay hidden when switching dates.
   */
  let attempts = 0;

  const startupTimer =
    window.setInterval(
      () => {

        attempts += 1;

        if (
          document.getElementById(
            'efficiencyDailyWorkPaper'
          ) ||
          attempts >= 150
        ) {

          window.clearInterval(
            startupTimer
          );

          lastDate =
            getDateValue();

          applyDeletedBlocks();
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

          lastDate =
            currentDate;

          closeMenu();

          applyDeletedBlocks();
        }
      },
      500
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
    {
      once: true
    }
  );


  console.info(
    `[${VERSION}] ready`
  );
})();

/* =========================================================
   EFFICIENCY DAILY WORK EXTRA ROW UI V1

   - right click any work row
   - add above / add below
   - persistent through script.js extraRows
   - delete extra row
   - height drag automatically works via row-key attribute
   - no MutationObserver
========================================================= */
(() => {
  'use strict';

  const VERSION =
    'EFFICIENCY_DAILY_WORK_EXTRA_ROW_UI_V1';

  const MENU_ID =
    'efficiencyDailyWorkRowContextMenuV1';

  const PAPER_SELECTOR =
    '#efficiencyDailyWorkPaper';

  const ROW_SELECTOR =
    `${PAPER_SELECTOR} [data-efficiency-daily-work-row-key]`;

  const EXTRA_SELECTOR =
    `${PAPER_SELECTOR} [data-efficiency-daily-work-extra-row="1"]`;

  const MAX_EXTRA_ROWS =
    30;


  if (
    window.__gsEfficiencyDailyWorkExtraRowUiV1
  ) {
    return;
  }


  window.__gsEfficiencyDailyWorkExtraRowUiV1 =
    true;


  const isStandaloneWindow = () => {
    try {
      return (
        new URL(
          window.location.href
        )
          .searchParams
          .get(
            'efficiencyDailyWorkWindow'
          ) ===
        '1'
      );
    } catch {
      return false;
    }
  };


  const getPaper = () =>
    document.querySelector(
      PAPER_SELECTOR
    );


  const getBody = group =>
    document.querySelector(
      group ===
        'operation'
        ? (
          `${PAPER_SELECTOR} ` +
          '.efficiency-daily-work-table__operation-body'
        )
        : (
          `${PAPER_SELECTOR} ` +
          '.efficiency-daily-work-table__efficiency-body'
        )
    );


  const getGroupFromRow = row =>
    row
      ?.closest(
        '.efficiency-daily-work-table__operation-body'
      )
      ? 'operation'
      : 'efficiency';


  const getExtraKey = row =>
    String(
      row?.dataset
        ?.efficiencyDailyWorkExtraRowKey ||
      ''
    ).trim();


  const generateExtraKey = () => {

    if (
      window.crypto
        ?.randomUUID
    ) {
      return (
        `extra-${window.crypto.randomUUID()}`
      );
    }

    return (
      `extra-${Date.now()}-` +
      Math.random()
        .toString(36)
        .slice(2, 10)
    );
  };


  const normalizeLocalRows = rows => {

    if (
      !Array.isArray(
        rows
      )
    ) {
      return [];
    }


    const seen =
      new Set();


    return rows
      .slice(
        0,
        MAX_EXTRA_ROWS
      )
      .map(
        (
          source,
          index
        ) => {

          if (
            !source ||
            typeof source !==
              'object'
          ) {
            return null;
          }


          let extraKey =
            String(
              source.extraKey ||
              ''
            )
              .replace(
                /[^a-zA-Z0-9:_-]/g,
                ''
              )
              .slice(
                0,
                80
              );


          if (
            !extraKey ||
            seen.has(
              extraKey
            )
          ) {
            extraKey =
              `extra-${index + 1}`;

            while (
              seen.has(
                extraKey
              )
            ) {
              extraKey +=
                '-x';
            }
          }


          seen.add(
            extraKey
          );


          return {
            extraKey,

            group:
              source.group ===
                'operation'
                ? 'operation'
                : 'efficiency',

            beforeRowKey:
              String(
                source.beforeRowKey ||
                ''
              ).trim(),

            title:
              String(
                source.title ||
                ''
              ),

            assignee:
              String(
                source.assignee ||
                ''
              ),

            part:
              String(
                source.part ||
                ''
              ),

            members:
              String(
                source.members ||
                ''
              ),

            tasks:
              String(
                source.tasks ||
                ''
              ),

            remarks:
              String(
                source.remarks ||
                ''
              )
          };
        }
      )
      .filter(
        Boolean
      );
  };


  const createInput = (
    field,
    placeholder,
    value = ''
  ) => {

    const input =
      document.createElement(
        'input'
      );

    input.type =
      'text';

    input.dataset
      .efficiencyDailyWorkExtraField =
      field;

    input.placeholder =
      placeholder;

    input.value =
      String(
        value || ''
      );

    return input;
  };


  const createTextarea = (
    field,
    value = ''
  ) => {

    const textarea =
      document.createElement(
        'textarea'
      );

    textarea.rows =
      4;

    textarea.dataset
      .efficiencyDailyWorkExtraField =
      field;

    textarea.value =
      String(
        value || ''
      );

    return textarea;
  };


  const createPartSelect = value => {

    const select =
      document.createElement(
        'select'
      );

    select.dataset
      .efficiencyDailyWorkExtraField =
      'part';


    [
      ['', '파트 선택'],
      ['1', '1파트'],
      ['2', '2파트'],
      ['3', '3파트'],
      ['4', '4파트']
    ].forEach(
      (
        [
          optionValue,
          label
        ]
      ) => {

        const option =
          document.createElement(
            'option'
          );

        option.value =
          optionValue;

        option.textContent =
          label;

        select.append(
          option
        );
      }
    );


    select.value =
      String(
        value || ''
      );


    return select;
  };


  const createExtraRow = data => {

    const row =
      document.createElement(
        'tr'
      );

    row.dataset
      .efficiencyDailyWorkExtraRow =
      '1';

    row.dataset
      .efficiencyDailyWorkExtraRowKey =
      data.extraKey;

    /*
     * 기존 행 높이 Drag 기능이
     * 그대로 이 행도 인식하도록 한다.
     */
    row.dataset
      .efficiencyDailyWorkRowKey =
      `extra:${data.extraKey}`;


    const roleCell =
      document.createElement(
        'th'
      );

    roleCell.scope =
      'row';

    roleCell.className =
      'efficiency-daily-work-table__role-cell ' +
      'efficiency-daily-work-extra-role-cell-v1';


    roleCell.append(
      createInput(
        'title',
        data.group ===
          'operation'
          ? '[근무조/업무명]'
          : '[업무명]',
        data.title
      )
    );


    if (
      data.group ===
      'operation'
    ) {

      roleCell.append(
        createPartSelect(
          data.part
        )
      );

      roleCell.append(
        createInput(
          'members',
          '[근무자]',
          data.members
        )
      );

    } else {

      roleCell.append(
        createInput(
          'assignee',
          '[담당자]',
          data.assignee
        )
      );
    }


    const taskCell =
      document.createElement(
        'td'
      );

    taskCell.append(
      createTextarea(
        'tasks',
        data.tasks
      )
    );


    const remarkCell =
      document.createElement(
        'td'
      );

    remarkCell.append(
      createTextarea(
        'remarks',
        data.remarks
      )
    );


    row.append(
      roleCell,
      taskCell,
      remarkCell
    );


    return row;
  };


  const moveGroupCellToFixedRow = body => {

    if (!body) {
      return;
    }

    const groupCell =
      body.querySelector(
        '.efficiency-daily-work-table__group-cell'
      );

    if (!groupCell) {
      return;
    }


    const fixedRow = [
      ...body.querySelectorAll(
        ':scope > tr'
      )
    ].find(
      row =>
        row.dataset
          .efficiencyDailyWorkExtraRow !==
        '1'
    );


    if (
      fixedRow &&
      groupCell.parentElement !==
        fixedRow
    ) {
      fixedRow.insertBefore(
        groupCell,
        fixedRow.firstElementChild
      );
    }
  };


  const syncGroupCells = () => {

    [
      getBody(
        'efficiency'
      ),
      getBody(
        'operation'
      )
    ]
      .filter(Boolean)
      .forEach(
        body => {

          const rows = [
            ...body.querySelectorAll(
              ':scope > tr'
            )
          ];


          const visibleRows =
            rows.filter(
              row =>
                !row.hidden
            );


          if (
            !visibleRows.length
          ) {
            return;
          }


          const groupCell =
            body.querySelector(
              '.efficiency-daily-work-table__group-cell'
            );


          if (!groupCell) {
            return;
          }


          const firstRow =
            visibleRows[0];


          if (
            groupCell.parentElement !==
              firstRow
          ) {
            firstRow.insertBefore(
              groupCell,
              firstRow.firstElementChild
            );
          }


          groupCell.rowSpan =
            visibleRows.length;

          groupCell.hidden =
            false;
        }
      );
  };


  const findFixedAnchor = (
    body,
    rowKey
  ) => {

    if (
      !body ||
      !rowKey
    ) {
      return null;
    }


    return [
      ...body.querySelectorAll(
        ':scope > tr'
      )
    ].find(
      row =>
        row.dataset
          .efficiencyDailyWorkExtraRow !==
          '1' &&
        String(
          row.dataset
            .efficiencyDailyWorkRowKey ||
          ''
        ) ===
          rowKey
    ) ||
      null;
  };


  const renderExtraRows = rows => {

    const normalized =
      normalizeLocalRows(
        rows
      );


    [
      getBody(
        'efficiency'
      ),
      getBody(
        'operation'
      )
    ]
      .filter(Boolean)
      .forEach(
        moveGroupCellToFixedRow
      );


    document
      .querySelectorAll(
        EXTRA_SELECTOR
      )
      .forEach(
        row =>
          row.remove()
      );


    normalized.forEach(
      data => {

        const body =
          getBody(
            data.group
          );

        if (!body) {
          return;
        }


        const row =
          createExtraRow(
            data
          );


        const anchor =
          findFixedAnchor(
            body,
            data.beforeRowKey
          );


        if (anchor) {
          body.insertBefore(
            row,
            anchor
          );
        } else {
          body.append(
            row
          );
        }
      }
    );


    syncGroupCells();
  };


  const getFieldValue = (
    row,
    field
  ) => {

    const control =
      row.querySelector(
        `[data-efficiency-daily-work-extra-field="${field}"]`
      );

    if (!control) {
      return '';
    }

    return String(
      control.value ||
      ''
    );
  };


  const getNextFixedRowKey = row => {

    let next =
      row.nextElementSibling;


    while (next) {

      if (
        next.dataset
          .efficiencyDailyWorkExtraRow !==
          '1'
      ) {
        return String(
          next.dataset
            .efficiencyDailyWorkRowKey ||
          ''
        );
      }


      next =
        next.nextElementSibling;
    }


    return '';
  };


  const collectExtraRows = () => {

    return [
      ...document.querySelectorAll(
        EXTRA_SELECTOR
      )
    ].map(
      row => {

        return {
          extraKey:
            getExtraKey(
              row
            ),

          group:
            getGroupFromRow(
              row
            ),

          beforeRowKey:
            getNextFixedRowKey(
              row
            ),

          title:
            getFieldValue(
              row,
              'title'
            ),

          assignee:
            getFieldValue(
              row,
              'assignee'
            ),

          part:
            getFieldValue(
              row,
              'part'
            ),

          members:
            getFieldValue(
              row,
              'members'
            ),

          tasks:
            getFieldValue(
              row,
              'tasks'
            ),

          remarks:
            getFieldValue(
              row,
              'remarks'
            )
        };
      }
    );
  };


  /*
   * script.js와 연결되는 공식 hook.
   * Standalone 여부와 관계없이 설치하여
   * 메인 모달에서 다시 저장해도 extraRows를 잃지 않는다.
   */
  window.collectEfficiencyDailyWorkExtraRows =
    collectExtraRows;

  window.renderEfficiencyDailyWorkExtraRows =
    renderExtraRows;


  const signalDocumentChanged = preferredControl => {

    const control =
      preferredControl ||
      getPaper()
        ?.querySelector(
          'textarea, input, select'
        );


    if (!control) {
      return;
    }


    control.dispatchEvent(
      new Event(
        'input',
        {
          bubbles: true
        }
      )
    );
  };


  const countExtraRows = () =>
    document.querySelectorAll(
      EXTRA_SELECTOR
    ).length;


  const insertExtraRow = (
    targetRow,
    placement
  ) => {

    if (!targetRow) {
      return;
    }


    if (
      countExtraRows() >=
      MAX_EXTRA_ROWS
    ) {
      window.alert(
        '추가 행은 최대 30개까지 만들 수 있습니다.'
      );

      return;
    }


    const group =
      getGroupFromRow(
        targetRow
      );


    const data = {
      extraKey:
        generateExtraKey(),

      group,

      beforeRowKey:
        '',

      title:
        '',

      assignee:
        '',

      part:
        '',

      members:
        '',

      tasks:
        '',

      remarks:
        ''
    };


    const row =
      createExtraRow(
        data
      );


    if (
      placement ===
      'above'
    ) {
      targetRow.parentElement
        ?.insertBefore(
          row,
          targetRow
        );

    } else {

      targetRow.parentElement
        ?.insertBefore(
          row,
          targetRow.nextElementSibling
        );
    }


    syncGroupCells();


    const titleInput =
      row.querySelector(
        '[data-efficiency-daily-work-extra-field="title"]'
      );


    signalDocumentChanged(
      titleInput
    );


    titleInput?.focus({
      preventScroll: true
    });


    titleInput?.scrollIntoView({
      block: 'nearest'
    });
  };


  const deleteExtraRow = row => {

    if (
      !row ||
      row.dataset
        .efficiencyDailyWorkExtraRow !==
        '1'
    ) {
      return;
    }


    if (
      !window.confirm(
        '이 추가 행을 삭제하시겠습니까?\n입력한 내용도 함께 삭제됩니다.'
      )
    ) {
      return;
    }


    const body =
      row.parentElement;


    const groupCell =
      row.querySelector(
        ':scope > .efficiency-daily-work-table__group-cell'
      );


    if (groupCell) {

      const nextVisible =
        [
          ...body.querySelectorAll(
            ':scope > tr'
          )
        ].find(
          candidate =>
            candidate !== row &&
            !candidate.hidden
        );


      if (nextVisible) {
        nextVisible.insertBefore(
          groupCell,
          nextVisible.firstElementChild
        );
      }
    }


    row.remove();

    syncGroupCells();

    signalDocumentChanged();
  };


  const createMenuButton = (
    text,
    handler,
    danger = false
  ) => {

    const button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'daily-work-row-context-button-v1';

    if (danger) {
      button.classList.add(
        'is-delete-v1'
      );
    }

    button.textContent =
      text;


    button.addEventListener(
      'click',
      event => {

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        handler();


        const menu =
          document.getElementById(
            MENU_ID
          );

        if (menu) {
          menu.hidden =
            true;
        }
      }
    );


    return button;
  };


  const augmentFixedRowMenu = (
    menu,
    row
  ) => {

    if (
      !menu ||
      !row ||
      menu.querySelector(
        '[data-extra-row-add-actions-v1]'
      )
    ) {
      return;
    }


    const title =
      menu.querySelector(
        '.daily-work-row-context-title-v1'
      );


    if (!title) {
      return;
    }


    const wrapper =
      document.createElement(
        'div'
      );

    wrapper.dataset
      .extraRowAddActionsV1 =
      '1';


    wrapper.append(
      createMenuButton(
        '위에 행 추가',
        () =>
          insertExtraRow(
            row,
            'above'
          )
      ),

      createMenuButton(
        '아래에 행 추가',
        () =>
          insertExtraRow(
            row,
            'below'
          )
      )
    );


    const divider =
      document.createElement(
        'div'
      );

    divider.className =
      'daily-work-row-context-divider-v1';


    wrapper.append(
      divider
    );


    title.insertAdjacentElement(
      'afterend',
      wrapper
    );
  };


  const replaceExtraRowMenu = (
    menu,
    row
  ) => {

    if (
      !menu ||
      !row
    ) {
      return;
    }


    menu.replaceChildren();


    const title =
      document.createElement(
        'div'
      );

    title.className =
      'daily-work-row-context-title-v1';

    title.textContent =
      '추가 행';


    const divider =
      document.createElement(
        'div'
      );

    divider.className =
      'daily-work-row-context-divider-v1';


    menu.append(
      title,

      createMenuButton(
        '위에 행 추가',
        () =>
          insertExtraRow(
            row,
            'above'
          )
      ),

      createMenuButton(
        '아래에 행 추가',
        () =>
          insertExtraRow(
            row,
            'below'
          )
      ),

      divider,

      createMenuButton(
        '이 추가 행 삭제',
        () =>
          deleteExtraRow(
            row
          ),
        true
      )
    );
  };


  const installStyle = () => {

    if (
      document.getElementById(
        'efficiencyDailyWorkExtraRowStyleV1'
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        'style'
      );

    style.id =
      'efficiencyDailyWorkExtraRowStyleV1';


    style.textContent = `
      #efficiencyDailyWorkPaper
      tr[data-efficiency-daily-work-extra-row="1"]
      .efficiency-daily-work-extra-role-cell-v1
      > input:first-child {
        font-weight: 900 !important;
        color: #24384c !important;
      }

      #efficiencyDailyWorkPaper
      tr[data-efficiency-daily-work-extra-row="1"]
      .efficiency-daily-work-extra-role-cell-v1
      > input:first-child::placeholder {
        color: #64788c !important;
        font-weight: 800 !important;
      }
    `;


    document.head.append(
      style
    );
  };


  installStyle();


  /*
   * 행 추가 메뉴는 standalone 새 창에서만 표시.
   * 데이터 collect/render hook은 위에서 이미
   * 모든 화면에 설치했다.
   */
  if (
    isStandaloneWindow()
  ) {

    document.addEventListener(
      'contextmenu',
      event => {

        const target =
          event.target instanceof Element
            ? event.target
            : null;


        if (!target) {
          return;
        }


        const row =
          target.closest(
            ROW_SELECTOR
          );


        if (!row) {
          return;
        }


        /*
         * 기존 Row Hide/Delete/Selected Delete가
         * 메뉴 구성을 마친 다음 마지막에 보강한다.
         */
        queueMicrotask(
          () => {

            const menu =
              document.getElementById(
                MENU_ID
              );


            if (
              !menu ||
              menu.hidden
            ) {
              return;
            }


            if (
              row.dataset
                .efficiencyDailyWorkExtraRow ===
              '1'
            ) {

              replaceExtraRowMenu(
                menu,
                row
              );

            } else {

              augmentFixedRowMenu(
                menu,
                row
              );
            }
          }
        );
      },
      true
    );
  }


  /*
   * 기존 hide/delete 기능이 rowspan을
   * 고정행 개수로 다시 계산하더라도
   * 추가행까지 포함해 바로 보정한다.
   *
   * MutationObserver는 사용하지 않는다.
   */
  const groupSyncTimer =
    window.setInterval(
      syncGroupCells,
      700
    );


  window.addEventListener(
    'beforeunload',
    () => {
      window.clearInterval(
        groupSyncTimer
      );
    },
    {
      once: true
    }
  );


  console.info(
    `[${VERSION}] ready`
  );
})();
