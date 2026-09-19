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
        overflow: hidden !important;

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
  const initializeChildWindow = async () => {
    if (!isChildWindow()) return;

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