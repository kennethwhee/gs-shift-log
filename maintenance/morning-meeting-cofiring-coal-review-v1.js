(() => {
  'use strict';

  const MODAL_SELECTOR = '[data-cfv56-adjust-modal], .cfv56-adjust-modal';
  const AUTO_BUTTON_SELECTOR = '[data-cfv56-auto]';
  const MESSAGE_SELECTOR = '[data-cfv56-msg]';
  const REVIEW_ATTRIBUTE = 'data-mm-cofiring-coal-review-v1';
  const CONTEXT_ATTRIBUTE = 'data-mm-cofiring-coal-review-context';
  const REVIEW_TEXT = '1·2호기 석탄 사용량 검토 필요 · Bio 이동 후 Coal은 열량보정으로 자동 변경된 값이므로 적용 전 두 호기의 Coal 사용량을 확인해 주세요.';

  function hasActiveClass(element) {
    return Boolean(element?.classList?.contains?.('is-active'));
  }

  function isElementVisible(element) {
    if (!element || element.hidden === true) return false;
    if (element.getAttribute?.('aria-hidden') === 'true') return false;

    try {
      const style = window.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        return false;
      }
    } catch (_) {
      // Visibility remains best-effort; explicit active markers below are authoritative.
    }

    return true;
  }

  function isMorningMeetingContext() {
    const tab = document.getElementById('efficiencyMorningMeetingTab');
    const view = document.getElementById('efficiencyMorningMeetingView');
    const activeTab = document.querySelector?.('.efficiency-team-tab.is-active, [data-efficiency-tab].is-active');

    return Boolean(
      tab?.getAttribute?.('aria-selected') === 'true' ||
      hasActiveClass(tab) ||
      hasActiveClass(view) ||
      activeTab?.id === 'efficiencyMorningMeetingTab' ||
      activeTab?.getAttribute?.('data-efficiency-tab') === 'morning-meeting' ||
      (
        tab &&
        view &&
        isElementVisible(tab) &&
        isElementVisible(view) &&
        tab.getAttribute?.('data-efficiency-tab') === 'morning-meeting'
      )
    );
  }

  function containsExplicitCoalReview(modal) {
    if (!modal) return false;

    const nodes = Array.from(
      modal.querySelectorAll('p,span,strong,small,[role="note"],[role="alert"]')
    );

    return nodes.some(node => {
      if (node.hasAttribute?.(REVIEW_ATTRIBUTE)) return false;

      const text = String(node.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) return false;

      const mentionsCoalUsage = /(?:석탄\s*사용량|Coal\s*사용량)/i.test(text);
      const mentionsUnitOne = /1\s*호기/.test(text);
      const mentionsUnitTwo = /2\s*호기/.test(text);
      const asksReview = /(?:검토|확인)/.test(text);

      return mentionsCoalUsage && mentionsUnitOne && mentionsUnitTwo && asksReview;
    });
  }

  function ensureCoalReviewWarning(modal) {
    if (!modal || modal.getAttribute?.(CONTEXT_ATTRIBUTE) !== 'morning-meeting') return;

    if (containsExplicitCoalReview(modal)) return;

    const message = modal.querySelector(MESSAGE_SELECTOR);
    if (!message || message.dataset?.bad === '1') return;

    let warning = modal.querySelector(`[${REVIEW_ATTRIBUTE}]`);

    if (!warning) {
      warning = document.createElement('p');
      warning.setAttribute(REVIEW_ATTRIBUTE, '');
      warning.setAttribute('role', 'note');
      warning.style.margin = '10px 0 0';
      warning.style.padding = '9px 12px';
      warning.style.border = '1px solid #ead49c';
      warning.style.borderRadius = '8px';
      warning.style.background = '#fff8e6';
      warning.style.color = '#7e5d12';
      warning.style.fontSize = '11px';
      warning.style.fontWeight = '700';
      warning.style.lineHeight = '1.55';
      warning.style.wordBreak = 'keep-all';
      message.insertAdjacentElement('afterend', warning);
    }

    warning.textContent = `⚠ ${REVIEW_TEXT}`;
  }

  function scheduleWarning(modal) {
    const run = () => ensureCoalReviewWarning(modal);

    try {
      window.requestAnimationFrame?.(run);
    } catch (_) {}

    [0, 80, 300, 800].forEach(delay => {
      window.setTimeout(run, delay);
    });
  }

  // Capture phase intentionally records the origin BEFORE the shared adjustment
  // handler can stop propagation or mutate modal state. V2 listened only in the
  // bubble phase and also missed the actual menu's `.is-active` state.
  document.addEventListener(
    'click',
    event => {
      const button = event.target?.closest?.(AUTO_BUTTON_SELECTOR);
      if (!button) return;

      const modal = button.closest?.(MODAL_SELECTOR);
      if (!modal) return;

      if (isMorningMeetingContext()) {
        modal.setAttribute(CONTEXT_ATTRIBUTE, 'morning-meeting');
        scheduleWarning(modal);
      } else {
        modal.removeAttribute?.(CONTEXT_ATTRIBUTE);
        modal.querySelector?.(`[${REVIEW_ATTRIBUTE}]`)?.remove?.();
      }
    },
    true
  );
})();
