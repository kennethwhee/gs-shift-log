(() => {
  'use strict';

  const MARKER = 'MORNING-MEETING-COFIRING-COAL-REVIEW-POPUP-V4';
  const TITLE = '1·2호기 석탄 사용량 검토 필요';
  const BODY = '최대혼소 조정 시 Bio 이동량에 따라 Coal 사용량이 열량 보정식으로 함께 변경됩니다. 적용 전 1호기·2호기 Coal 사용량을 반드시 확인하세요.';
  const CONFIRM_LABEL = '확인 후 최대혼소 조정';
  const CANCEL_LABEL = '취소';
  const STYLE_ID = 'morningMeetingCofiringCoalReviewPopupV4Style';
  const MODAL_ID = 'morningMeetingCofiringCoalReviewPopupV4';
  const bypassButtons = new WeakSet();

  function hasClass(element, className) {
    return Boolean(
      element &&
      element.classList &&
      typeof element.classList.contains === 'function' &&
      element.classList.contains(className)
    );
  }

  function attr(element, name) {
    if (!element || typeof element.getAttribute !== 'function') {
      return '';
    }
    return String(element.getAttribute(name) || '').trim();
  }

  function isMorningMeetingActive(doc) {
    const tab = doc?.getElementById?.('efficiencyMorningMeetingTab') || null;
    const view = doc?.getElementById?.('efficiencyMorningMeetingView') || null;

    const tabActive =
      hasClass(tab, 'is-active') ||
      attr(tab, 'aria-selected').toLowerCase() === 'true';

    const viewActive =
      hasClass(view, 'is-active') ||
      (
        view &&
        view.hidden !== true &&
        attr(view, 'aria-hidden').toLowerCase() !== 'true'
      );

    return Boolean(tabActive || viewActive);
  }

  function findAutoButton(target) {
    if (!target) {
      return null;
    }

    if (typeof target.matches === 'function' && target.matches('[data-cfv56-auto]')) {
      return target;
    }

    return typeof target.closest === 'function'
      ? target.closest('[data-cfv56-auto]')
      : null;
  }

  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) {
      return;
    }

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID}[hidden] { display: none !important; }
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: grid;
        place-items: center;
        padding: 22px;
        background: rgba(25, 38, 52, 0.54);
        backdrop-filter: blur(1.5px);
      }
      #${MODAL_ID} .mm-cf-coal-review-dialog {
        width: min(460px, calc(100vw - 36px));
        overflow: hidden;
        border: 1px solid #ead7a7;
        border-radius: 15px;
        background: #fffdf7;
        box-shadow: 0 24px 70px rgba(26, 39, 53, 0.24);
        color: #3e4f5f;
        font-family: inherit;
      }
      #${MODAL_ID} .mm-cf-coal-review-head {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 20px 22px 12px;
      }
      #${MODAL_ID} .mm-cf-coal-review-icon {
        display: grid;
        flex: 0 0 auto;
        width: 34px;
        height: 34px;
        place-items: center;
        border-radius: 50%;
        background: #fff3cf;
        color: #a16e00;
        font-size: 18px;
        font-weight: 900;
      }
      #${MODAL_ID} h3 {
        margin: 0;
        color: #6d520e;
        font-size: 17px;
        line-height: 1.45;
        letter-spacing: -0.02em;
      }
      #${MODAL_ID} p {
        margin: 0;
        padding: 0 22px 20px 68px;
        color: #6f6650;
        font-size: 12px;
        line-height: 1.75;
        word-break: keep-all;
      }
      #${MODAL_ID} .mm-cf-coal-review-actions {
        display: flex;
        justify-content: flex-end;
        gap: 9px;
        padding: 14px 18px 18px;
        border-top: 1px solid #f0e6ca;
        background: #fffaf0;
      }
      #${MODAL_ID} button {
        min-height: 38px;
        padding: 0 15px;
        border: 1px solid #d8dee5;
        border-radius: 8px;
        background: #fff;
        color: #607284;
        font: inherit;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }
      #${MODAL_ID} button[data-mm-cf-coal-review-confirm] {
        border-color: #8e6a14;
        background: #8e6a14;
        color: #fff;
      }
      @media (max-width: 560px) {
        #${MODAL_ID} { padding: 14px; }
        #${MODAL_ID} .mm-cf-coal-review-head { padding: 18px 17px 10px; }
        #${MODAL_ID} p { padding: 0 17px 17px 63px; font-size: 11px; }
        #${MODAL_ID} .mm-cf-coal-review-actions { flex-direction: column-reverse; }
        #${MODAL_ID} button { width: 100%; }
      }
    `;
    doc.head.appendChild(style);
  }

  function createModal(doc) {
    let modal = doc.getElementById(MODAL_ID);
    if (modal) {
      return modal;
    }

    ensureStyle(doc);

    modal = doc.createElement('div');
    modal.id = MODAL_ID;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="mm-cf-coal-review-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mmCfCoalReviewTitle" aria-describedby="mmCfCoalReviewBody">
        <div class="mm-cf-coal-review-head">
          <span class="mm-cf-coal-review-icon" aria-hidden="true">!</span>
          <div><h3 id="mmCfCoalReviewTitle">${TITLE}</h3></div>
        </div>
        <p id="mmCfCoalReviewBody">${BODY}</p>
        <div class="mm-cf-coal-review-actions">
          <button type="button" data-mm-cf-coal-review-cancel>${CANCEL_LABEL}</button>
          <button type="button" data-mm-cf-coal-review-confirm>${CONFIRM_LABEL}</button>
        </div>
      </div>
    `;

    doc.body.appendChild(modal);
    return modal;
  }

  function closeModal(modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }

  function openReviewPopup(doc, button) {
    const modal = createModal(doc);
    const confirmButton = modal.querySelector('[data-mm-cf-coal-review-confirm]');
    const cancelButton = modal.querySelector('[data-mm-cf-coal-review-cancel]');

    const cleanup = () => {
      confirmButton.onclick = null;
      cancelButton.onclick = null;
      modal.onclick = null;
      doc.removeEventListener('keydown', onKeydown, true);
    };

    const cancel = () => {
      cleanup();
      closeModal(modal);
      button?.focus?.();
    };

    const confirm = () => {
      cleanup();
      closeModal(modal);
      bypassButtons.add(button);
      button.click();
      queueMicrotask(() => bypassButtons.delete(button));
    };

    const onKeydown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };

    confirmButton.onclick = confirm;
    cancelButton.onclick = cancel;
    modal.onclick = event => {
      if (event.target === modal) {
        cancel();
      }
    };
    doc.addEventListener('keydown', onKeydown, true);

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    confirmButton.focus();
  }

  function shouldIntercept(doc, button) {
    return Boolean(
      button &&
      !bypassButtons.has(button) &&
      isMorningMeetingActive(doc)
    );
  }

  function install(doc) {
    if (!doc || doc.documentElement?.dataset?.mmCofiringCoalReviewPopupV4 === '1') {
      return;
    }

    if (doc.documentElement?.dataset) {
      doc.documentElement.dataset.mmCofiringCoalReviewPopupV4 = '1';
    }

    doc.addEventListener(
      'click',
      event => {
        const button = findAutoButton(event.target);
        if (!shouldIntercept(doc, button)) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        openReviewPopup(doc, button);
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
    isMorningMeetingActive,
    findAutoButton
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof document !== 'undefined') {
    install(document);
  }
})();
