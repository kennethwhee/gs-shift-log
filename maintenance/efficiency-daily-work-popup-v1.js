(() => {
  'use strict';

  const VERSION = 'EFFICIENCY_DAILY_WORK_POPUP_V1';
  const PARAM = 'efficiencyDailyWorkWindow';
  const WINDOW_NAME = 'gsEfficiencyDailyWorkStatus';

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

  const initializeChildWindow = async () => {
    if (!isChildWindow()) return;

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