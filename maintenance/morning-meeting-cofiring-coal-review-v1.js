(() => {
  'use strict';

  const MODAL_SELECTOR = '[data-cfv56-adjust-modal], .cfv56-adjust-modal';
  const AUTO_BUTTON_SELECTOR = '[data-cfv56-auto]';
  const MESSAGE_SELECTOR = '[data-cfv56-msg]';
  const REVIEW_ATTRIBUTE = 'data-mm-cofiring-coal-review-v1';
  const REVIEW_TEXT = '1·2호기 석탄 사용량 검토 필요 · Bio 이동 후 Coal은 열량보정으로 자동 변경된 값이므로 적용 전 두 호기의 Coal 사용량을 확인해 주세요.';

  function containsNativeCoalReview(modal) {
    if (!modal) return false;

    const nodes = Array.from(modal.querySelectorAll('p,div,span,strong,small'));
    return nodes.some(node => {
      if (node.hasAttribute(REVIEW_ATTRIBUTE)) return false;
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return false;

      const mentionsCoal = /(?:석탄|Coal)/i.test(text);
      const mentionsBothUnits = /(?:1\s*[·,\/＆&]?\s*2\s*호기|1호기[\s\S]{0,50}2호기|2호기[\s\S]{0,50}1호기)/i.test(text);
      const asksReview = /(?:검토|확인)\s*(?:필요|해\s*주세요|하세요)?/i.test(text);
      return mentionsCoal && mentionsBothUnits && asksReview;
    });
  }

  function removeShimWarningIfNativeExists(modal) {
    if (!modal || !containsNativeCoalReview(modal)) return;
    modal.querySelector(`[${REVIEW_ATTRIBUTE}]`)?.remove();
  }

  function ensureCoalReviewWarning(modal) {
    if (!modal || containsNativeCoalReview(modal)) {
      removeShimWarningIfNativeExists(modal);
      return;
    }

    const message = modal.querySelector(MESSAGE_SELECTOR);
    if (!message) return;

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

  function afterMaximumAdjustment(button) {
    const modal = button?.closest(MODAL_SELECTOR);
    if (!modal) return;

    // The existing adjustment handler runs synchronously first. Check again on the
    // next tasks so a native/main-menu warning always wins and this shim never duplicates it.
    [0, 60, 250].forEach(delay => {
      window.setTimeout(() => ensureCoalReviewWarning(modal), delay);
    });
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.(AUTO_BUTTON_SELECTOR);
    if (!button) return;
    afterMaximumAdjustment(button);
  });

  const observer = new MutationObserver(records => {
    for (const record of records) {
      const modal = record.target?.nodeType === 1
        ? record.target.closest?.(MODAL_SELECTOR)
        : record.target?.parentElement?.closest?.(MODAL_SELECTOR);
      if (modal) removeShimWarningIfNativeExists(modal);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
