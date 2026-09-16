(() => {
  'use strict';

  const MARKER = 'MORNING-MEETING-COFIRING-COAL-REVIEW-POPUP-V5-TOP-LAYER';
  const TITLE = '1·2호기 석탄 사용량 검토 필요';
  const BODY = '최대혼소 조정 시 Bio 이동량에 따라 Coal 사용량이 열량 보정식으로 함께 변경됩니다. 적용 전 1호기·2호기 Coal 사용량을 반드시 확인하세요.';
  const CONFIRM_LABEL = '확인 후 최대혼소 조정';
  const CANCEL_LABEL = '취소';
  const DIALOG_ID = 'morningMeetingCofiringCoalReviewPopupV5';
  const STYLE_ID = 'morningMeetingCofiringCoalReviewPopupV5Style';
  const V3_CONTEXT_ATTRIBUTE = 'data-mm-cofiring-coal-review-context';
  const bypassButtons = new WeakSet();

  function attr(element, name) {
    if (!element || typeof element.getAttribute !== 'function') return '';
    return String(element.getAttribute(name) || '').trim();
  }

  function hasClass(element, className) {
    return Boolean(element?.classList?.contains?.(className));
  }

  function textIncludesMorningMeeting(element) {
    return /오전\s*회의\s*자료/.test(String(element?.textContent || '').replace(/\s+/g, ' '));
  }

  function isRendered(element, root = globalThis) {
    if (!element || element.hidden === true || attr(element, 'aria-hidden').toLowerCase() === 'true') {
      return false;
    }

    try {
      const style = root.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    } catch (_) {}

    try {
      if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) {
        return false;
      }
    } catch (_) {}

    return true;
  }

  function isMorningMeetingContext(doc, root = globalThis) {
    const tab = doc?.getElementById?.('efficiencyMorningMeetingTab') || null;
    const view = doc?.getElementById?.('efficiencyMorningMeetingView') || null;

    if (
      hasClass(tab, 'is-active') ||
      attr(tab, 'aria-selected').toLowerCase() === 'true' ||
      hasClass(view, 'is-active')
    ) {
      return true;
    }

    const activeCandidates = Array.from(
      doc?.querySelectorAll?.(
        '.efficiency-team-tab.is-active, [data-efficiency-tab].is-active, [aria-selected="true"]'
      ) || []
    );

    if (
      activeCandidates.some(element =>
        attr(element, 'data-efficiency-tab') === 'morning-meeting' ||
        element.id === 'efficiencyMorningMeetingTab' ||
        textIncludesMorningMeeting(element)
      )
    ) {
      return true;
    }

    return Boolean(
      view &&
      isRendered(view, root) &&
      tab &&
      isRendered(tab, root) &&
      attr(tab, 'data-efficiency-tab') === 'morning-meeting'
    );
  }

  function findAutoButton(target) {
    if (!target) return null;
    if (typeof target.matches === 'function' && target.matches('[data-cfv56-auto]')) return target;
    return typeof target.closest === 'function' ? target.closest('[data-cfv56-auto]') : null;
  }

  function findAdjustmentModal(button) {
    return button?.closest?.('[data-cfv56-adjust-modal], .cfv56-adjust-modal') || null;
  }

  function isMorningMeetingOrigin(doc, button, root = globalThis) {
    const modal = findAdjustmentModal(button);
    if (attr(modal, V3_CONTEXT_ATTRIBUTE) === 'morning-meeting') return true;
    return isMorningMeetingContext(doc, root);
  }

  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${DIALOG_ID} {
        width: min(470px, calc(100vw - 34px));
        max-width: 470px;
        margin: auto;
        padding: 0;
        overflow: hidden;
        border: 1px solid #ead7a7;
        border-radius: 16px;
        background: #fffdf7;
        box-shadow: 0 28px 90px rgba(15, 27, 39, 0.34);
        color: #3e4f5f;
        font-family: inherit;
      }
      #${DIALOG_ID}::backdrop {
        background: rgba(18, 29, 41, 0.62);
        backdrop-filter: blur(2px);
      }
      #${DIALOG_ID} .mm-cf-coal-review-head {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 21px 22px 12px;
      }
      #${DIALOG_ID} .mm-cf-coal-review-icon {
        display: grid;
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        place-items: center;
        border-radius: 50%;
        background: #fff0c5;
        color: #986800;
        font-size: 19px;
        font-weight: 900;
      }
      #${DIALOG_ID} h3 {
        margin: 2px 0 0;
        color: #6c5008;
        font-size: 18px;
        line-height: 1.4;
        letter-spacing: -0.03em;
      }
      #${DIALOG_ID} p {
        margin: 0;
        padding: 0 22px 21px 70px;
        color: #685f4c;
        font-size: 12px;
        line-height: 1.75;
        word-break: keep-all;
      }
      #${DIALOG_ID} .mm-cf-coal-review-actions {
        display: flex;
        justify-content: flex-end;
        gap: 9px;
        padding: 14px 18px 18px;
        border-top: 1px solid #f0e6ca;
        background: #fffaf0;
      }
      #${DIALOG_ID} button {
        min-height: 39px;
        padding: 0 15px;
        border: 1px solid #d6dee5;
        border-radius: 8px;
        background: #fff;
        color: #5d7182;
        font: inherit;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }
      #${DIALOG_ID} button[data-mm-cf-coal-review-confirm] {
        border-color: #8b6815;
        background: #8b6815;
        color: #fff;
      }
      @media (max-width: 560px) {
        #${DIALOG_ID} { width: calc(100vw - 24px); }
        #${DIALOG_ID} .mm-cf-coal-review-head { padding: 18px 17px 10px; }
        #${DIALOG_ID} p { padding: 0 17px 17px 64px; font-size: 11px; }
        #${DIALOG_ID} .mm-cf-coal-review-actions { flex-direction: column-reverse; }
        #${DIALOG_ID} button { width: 100%; }
      }
    `;
    doc.head.appendChild(style);
  }

  function createDialog(doc) {
    let dialog = doc.getElementById(DIALOG_ID);
    if (dialog) return dialog;

    ensureStyle(doc);
    dialog = doc.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.setAttribute('aria-labelledby', 'mmCfCoalReviewTitleV5');
    dialog.setAttribute('aria-describedby', 'mmCfCoalReviewBodyV5');
    dialog.innerHTML = `
      <div class="mm-cf-coal-review-head">
        <span class="mm-cf-coal-review-icon" aria-hidden="true">!</span>
        <div><h3 id="mmCfCoalReviewTitleV5">${TITLE}</h3></div>
      </div>
      <p id="mmCfCoalReviewBodyV5">${BODY}</p>
      <div class="mm-cf-coal-review-actions">
        <button type="button" data-mm-cf-coal-review-cancel>${CANCEL_LABEL}</button>
        <button type="button" data-mm-cf-coal-review-confirm>${CONFIRM_LABEL}</button>
      </div>
    `;
    doc.body.appendChild(dialog);
    return dialog;
  }

  function replayOriginalClick(button) {
    bypassButtons.add(button);
    globalThis.setTimeout(() => {
      try {
        button.click();
      } finally {
        queueMicrotask(() => bypassButtons.delete(button));
      }
    }, 0);
  }

  function openTopLayerReview(doc, button) {
    const dialog = createDialog(doc);

    // <dialog>.showModal() moves the element into the browser top layer,
    // which is above every ordinary z-index/stacking context.
    if (typeof dialog.showModal !== 'function') {
      const approved = globalThis.confirm(`${TITLE}\n\n${BODY}`);
      if (approved) replayOriginalClick(button);
      return;
    }

    if (dialog.open) return;

    const confirmButton = dialog.querySelector('[data-mm-cf-coal-review-confirm]');
    const cancelButton = dialog.querySelector('[data-mm-cf-coal-review-cancel]');

    const cleanup = () => {
      confirmButton.onclick = null;
      cancelButton.onclick = null;
      dialog.onclick = null;
      dialog.oncancel = null;
    };

    const close = approved => {
      cleanup();
      dialog.close();
      if (approved) replayOriginalClick(button);
      else button?.focus?.();
    };

    confirmButton.onclick = () => close(true);
    cancelButton.onclick = () => close(false);
    dialog.oncancel = event => {
      event.preventDefault();
      close(false);
    };
    dialog.onclick = event => {
      if (event.target === dialog) close(false);
    };

    dialog.showModal();
    confirmButton?.focus?.();
  }

  function install(doc) {
    if (!doc || doc.documentElement?.dataset?.mmCofiringCoalReviewPopupV5 === '1') return;
    if (doc.documentElement?.dataset) doc.documentElement.dataset.mmCofiringCoalReviewPopupV5 = '1';

    doc.addEventListener(
      'click',
      event => {
        const button = findAutoButton(event.target);
        if (!button || bypassButtons.has(button)) return;
        if (!isMorningMeetingOrigin(doc, button, globalThis)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        openTopLayerReview(doc, button);
      },
      true
    );
  }

  const api = {
    MARKER,
    TITLE,
    BODY,
    CONFIRM_LABEL,
    CANCEL_LABEL,
    V3_CONTEXT_ATTRIBUTE,
    isRendered,
    isMorningMeetingContext,
    isMorningMeetingOrigin,
    findAutoButton
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') install(document);
})();
