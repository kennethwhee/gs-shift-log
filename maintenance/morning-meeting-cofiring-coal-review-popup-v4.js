(function (root) {
  "use strict";

  const MARKER =
    "COFIRING-COAL-REVIEW-V12-MAX-TOAST-UNCONDITIONAL";

  if (
    root.__cofiringCoalReviewV12Installed
  ) {
    return;
  }

  root.__cofiringCoalReviewV12Installed =
    true;

  const doc =
    root.document;

  if (!doc) {
    return;
  }

  const STYLE_ID =
    "cofiringCoalReviewV12Style";

  const TOAST_ID =
    "cofiringCoalReviewV12Toast";

  let autoDismissTimer =
    null;

  let removeTimer =
    null;

  function normalizeText(
    value
  ) {
    return String(
      value ||
      ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }

  function eventButton(
    event
  ) {
    const path =
      typeof event.composedPath ===
        "function"
        ? event.composedPath()
        : [];

    const fromPath =
      path.find?.(
        node =>
          node &&
          node.nodeType === 1 &&
          String(
            node.tagName ||
            ""
          ).toUpperCase() ===
            "BUTTON"
      );

    if (fromPath) {
      return fromPath;
    }

    const target =
      event.target &&
      event.target.nodeType === 1
        ? event.target
        : event.target?.parentElement;

    return (
      target?.closest?.(
        "button"
      ) ||
      null
    );
  }

  function isMaximumAdjustment(
    button
  ) {
    if (
      !button ||
      !button.matches?.(
        "[data-cfv56-auto]"
      )
    ) {
      return false;
    }

    const modal =
      button.closest?.(
        "[data-cfv56-adjust-modal], .cfv56-adjust-modal"
      );

    if (!modal) {
      return false;
    }

    if (
      modal.hidden ||
      modal.getAttribute(
        "aria-hidden"
      ) ===
        "true"
    ) {
      return false;
    }

    return true;
  }

  function closesAdjustment(
    button
  ) {
    return !!(
      button &&
      button.matches?.(
        [
          "[data-cfv56-close]",
          "[data-cfv56-cancel]",
          "[data-cfv56-apply]",
          "[data-cfv56-reset]"
        ].join(",")
      )
    );
  }

  function ensureStyle() {
    if (
      doc.getElementById(
        STYLE_ID
      )
    ) {
      return;
    }

    const style =
      doc.createElement(
        "style"
      );

    style.id =
      STYLE_ID;

    style.textContent = `
      #${TOAST_ID} {
        position: fixed;
        top: 24px;
        left: 50%;
        z-index: 20000;
        width: min(470px, calc(100vw - 32px));
        transform: translate(-50%, 0);
        opacity: 1;
        transition:
          opacity 160ms ease,
          transform 160ms ease;
        font-family:
          Inter,
          "Pretendard Variable",
          Pretendard,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          "Malgun Gothic",
          "Noto Sans CJK KR",
          sans-serif;
      }

      #${TOAST_ID}.is-leaving {
        opacity: 0;
        transform: translate(-50%, -8px);
      }

      #${TOAST_ID} .cfcr12-card {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) 28px;
        gap: 11px;
        align-items: start;
        padding: 15px 15px 14px;
        border: 1px solid #ead9ac;
        border-radius: 13px;
        background: #fffdf7;
        box-shadow:
          0 14px 42px rgba(24, 35, 47, 0.22);
        color: #26394b;
      }

      #${TOAST_ID} .cfcr12-icon {
        display: flex;
        width: 34px;
        height: 34px;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: #fff0bf;
        color: #916500;
        font-size: 19px;
        font-weight: 900;
      }

      #${TOAST_ID} .cfcr12-copy {
        min-width: 0;
        padding-top: 1px;
      }

      #${TOAST_ID} strong {
        display: block;
        margin: 0 0 5px;
        color: #24364a;
        font-size: 14px;
        line-height: 1.35;
        letter-spacing: -0.25px;
      }

      #${TOAST_ID} p {
        margin: 0;
        color: #67798b;
        font-size: 11px;
        line-height: 1.55;
        word-break: keep-all;
      }

      #${TOAST_ID} button {
        display: flex;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        margin: -4px -4px 0 0;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #7b8b99;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
      }

      #${TOAST_ID} button:hover {
        background: rgba(74, 91, 106, 0.08);
        color: #394b5d;
      }

      #${TOAST_ID} button:focus-visible {
        outline: 3px solid rgba(124, 89, 180, 0.25);
        outline-offset: 1px;
      }
    `;

    doc.head.appendChild(
      style
    );
  }

  function clearTimers() {
    if (
      autoDismissTimer !==
        null
    ) {
      root.clearTimeout?.(
        autoDismissTimer
      );

      autoDismissTimer =
        null;
    }

    if (
      removeTimer !==
        null
    ) {
      root.clearTimeout?.(
        removeTimer
      );

      removeTimer =
        null;
    }
  }

  function dismissToast(
    immediate =
      false
  ) {
    clearTimers();

    const toast =
      doc.getElementById(
        TOAST_ID
      );

    if (!toast) {
      return;
    }

    if (immediate) {
      toast.remove();
      return;
    }

    toast.classList.add(
      "is-leaving"
    );

    removeTimer =
      root.setTimeout?.(
        () => {
          removeTimer =
            null;

          toast.remove();
        },
        180
      ) ??
      null;
  }

  function showCoalReviewToast() {
    ensureStyle();

    dismissToast(
      true
    );

    const toast =
      doc.createElement(
        "div"
      );

    toast.id =
      TOAST_ID;

    toast.setAttribute(
      "role",
      "status"
    );

    toast.setAttribute(
      "aria-live",
      "polite"
    );

    toast.innerHTML = `
      <div class="cfcr12-card">
        <span class="cfcr12-icon" aria-hidden="true">!</span>

        <div class="cfcr12-copy">
          <strong>1·2호기 석탄 사용량 검토 필요</strong>
          <p>
            최대혼소 조정으로 Bio 배분이 바뀌면 Coal 사용량도 함께 보정됩니다.
            조정 후 1호기와 2호기의 Coal 사용량을 확인해 주세요.
          </p>
        </div>

        <button
          type="button"
          data-cfcr12-close
          aria-label="안내 닫기"
          title="닫기"
        >×</button>
      </div>
    `;

    doc.body.appendChild(
      toast
    );

    toast
      .querySelector(
        "[data-cfcr12-close]"
      )
      ?.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          dismissToast();
        }
      );

    autoDismissTimer =
      root.setTimeout?.(
        () => {
          autoDismissTimer =
            null;

          dismissToast();
        },
        3000
      ) ??
      null;
  }

  function onClick(
    event
  ) {
    const button =
      eventButton(
        event
      );

    if (!button) {
      return;
    }

    if (
      isMaximumAdjustment(
        button
      )
    ) {
      showCoalReviewToast();

      return;
    }

    if (
      closesAdjustment(
        button
      )
    ) {
      dismissToast();
    }
  }

  /*
    Non-blocking behavior:
    - Every visible "최대혼소 조정" click keeps its original calculation handler.
    - This listener only shows a 3-second notice and never cancels that click.
    - The toast can also be closed immediately with X.
  */
  root.addEventListener(
    "click",
    onClick,
    true
  );

  root.CofiringCoalReviewV12 =
    Object.freeze({
      marker:
        MARKER,

      showCoalReviewToast,

      isMaximumAdjustment
    });
}(
  typeof globalThis ===
    "object"
    ? globalThis
    : this
));
