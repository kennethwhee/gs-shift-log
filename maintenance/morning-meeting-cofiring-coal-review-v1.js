(() => {
  'use strict';

  const MODAL_SELECTOR = '[data-cfv56-adjust-modal], .cfv56-adjust-modal';
  const AUTO_BUTTON_SELECTOR = '[data-cfv56-auto]';
  const MESSAGE_SELECTOR = '[data-cfv56-msg]';
  const REVIEW_ATTRIBUTE = 'data-mm-cofiring-coal-review-v1';
  const REVIEW_TEXT = '1·2호기 석탄 사용량 검토 필요 · Bio 이동 후 Coal은 열량보정으로 자동 변경된 값이므로 적용 전 두 호기의 Coal 사용량을 확인해 주세요.';

  function isMorningMeetingContext() {
    const tab = document.getElementById('efficiencyMorningMeetingTab');
    const view = document.getElementById('efficiencyMorningMeetingView');

    return Boolean(
      tab?.getAttribute('aria-selected') === 'true' ||
      view?.classList.contains('is-active')
    );
  }

  function containsExplicitCoalReview(modal) {
    if (!modal) return false;

    // V1 scanned container DIV text. A parent DIV aggregates the entire modal text,
    // so unrelated "Coal", "1호기/2호기" and "확인" strings could be combined and
    // falsely classified as an existing warning. V2 inspects only text-bearing leaf
    // elements and requires an explicit coal-usage review phrase in the same node.
    const nodes = Array.from(
      modal.querySelectorAll('p,span,strong,small,[role="note"],[role="alert"]')
    );

    return nodes.some(node => {
      if (node.hasAttribute(REVIEW_ATTRIBUTE)) return false;

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
    if (!modal || !isMorningMeetingContext()) return;

    if (containsExplicitCoalReview(modal)) {
      modal.querySelector(`[${REVIEW_ATTRIBUTE}]`)?.remove();
      return;
    }

    const message = modal.querySelector(MESSAGE_SELECTOR);
    if (!message || message.dataset.bad === '1') return;

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
    if (!isMorningMeetingContext()) return;

    const modal = button?.closest(MODAL_SELECTOR);
    if (!modal) return;

    // The shared co-firing adjustment handler runs on the button first. Re-check on
    // the next tasks so its success/error message is settled before the warning is
    // added. The warning is limited to the active Morning Meeting tab only.
    [0, 60, 250].forEach(delay => {
      window.setTimeout(() => ensureCoalReviewWarning(modal), delay);
    });
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.(AUTO_BUTTON_SELECTOR);
    if (!button) return;
    afterMaximumAdjustment(button);
  });
})();
