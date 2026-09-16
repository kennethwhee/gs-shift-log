(function () {
  "use strict";

  const MARKER =
    "MORNING-MEETING-COFIRING-COAL-REVIEW-POPUP-V6-WINDOW-CAPTURE";

  if (window.__mmCofiringCoalReviewPopupV6Installed) {
    return;
  }

  window.__mmCofiringCoalReviewPopupV6Installed = true;

  const replayButtons = new WeakSet();

  function isMorningMeetingActive() {
    const tab =
      document.querySelector(
        '[data-efficiency-tab="morning-meeting"]'
      ) ||
      document.getElementById(
        "efficiencyMorningMeetingTab"
      );

    if (!tab) {
      return false;
    }

    const tabActive =
      tab.classList.contains("is-active") ||
      tab.getAttribute("aria-selected") === "true";

    if (!tabActive) {
      return false;
    }

    const view =
      document.querySelector(
        '[data-efficiency-view="morning-meeting"]'
      ) ||
      document.getElementById(
        "efficiencyMorningMeetingView"
      );

    if (!view) {
      return true;
    }

    return (
      view.classList.contains("is-active") ||
      view.hidden === false ||
      view.getAttribute("aria-hidden") === "false"
    );
  }

  function ensureStyle() {
    if (
      document.getElementById(
        "mmCofiringCoalReviewPopupV6Style"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "mmCofiringCoalReviewPopupV6Style";

    style.textContent = `
      dialog[data-mm-cofiring-coal-review-v6] {
        width: min(520px, calc(100vw - 32px));
        max-width: 520px;
        margin: auto;
        padding: 0;
        border: 1px solid #e5d4a9;
        border-radius: 16px;
        background: #ffffff;
        color: #26394b;
        box-shadow: 0 28px 90px rgba(9, 25, 42, 0.34);
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

      dialog[data-mm-cofiring-coal-review-v6]::backdrop {
        background: rgba(8, 20, 33, 0.62);
        backdrop-filter: blur(1.5px);
      }

      dialog[data-mm-cofiring-coal-review-v6] * {
        box-sizing: border-box;
      }

      dialog[data-mm-cofiring-coal-review-v6] .mmcr-v6-head {
        display: flex;
        align-items: flex-start;
        gap: 13px;
        padding: 22px 23px 16px;
      }

      dialog[data-mm-cofiring-coal-review-v6] .mmcr-v6-icon {
        display: flex;
        flex: 0 0 38px;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        border-radius: 11px;
        background: #fff4cf;
        color: #9c6d00;
        font-size: 21px;
        font-weight: 900;
      }

      dialog[data-mm-cofiring-coal-review-v6] h3 {
        margin: 1px 0 7px;
        color: #24364a;
        font-size: 18px;
        line-height: 1.3;
        letter-spacing: -0.45px;
      }

      dialog[data-mm-cofiring-coal-review-v6] p {
        margin: 0;
        color: #657789;
        font-size: 12px;
        line-height: 1.75;
        word-break: keep-all;
      }

      dialog[data-mm-cofiring-coal-review-v6] .mmcr-v6-note {
        margin: 0 23px 18px;
        padding: 12px 14px;
        border: 1px solid #efdfb8;
        border-radius: 10px;
        background: #fffaf0;
        color: #7b622c;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.65;
        word-break: keep-all;
      }

      dialog[data-mm-cofiring-coal-review-v6] footer {
        display: flex;
        justify-content: flex-end;
        gap: 9px;
        padding: 15px 23px 19px;
        border-top: 1px solid #e9eef2;
        background: #fafcfd;
      }

      dialog[data-mm-cofiring-coal-review-v6] button {
        min-height: 38px;
        padding: 0 15px;
        border: 1px solid #d5e0e8;
        border-radius: 9px;
        background: #ffffff;
        color: #5e7386;
        font: inherit;
        font-size: 12px;
        font-weight: 750;
        cursor: pointer;
      }

      dialog[data-mm-cofiring-coal-review-v6]
      button[data-mmcr-v6-confirm] {
        border-color: #7c59b4;
        background: #7c59b4;
        color: #ffffff;
      }

      dialog[data-mm-cofiring-coal-review-v6]
      button:focus-visible {
        outline: 3px solid rgba(124, 89, 180, 0.28);
        outline-offset: 2px;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function showReviewDialog() {
    ensureStyle();

    return new Promise(
      resolve => {
        const existing =
          document.querySelector(
            "dialog[data-mm-cofiring-coal-review-v6]"
          );

        if (
          existing &&
          typeof existing.close === "function"
        ) {
          try {
            existing.close();
          } catch (_) {
          }

          existing.remove();
        }

        const dialog =
          document.createElement("dialog");

        dialog.setAttribute(
          "data-mm-cofiring-coal-review-v6",
          MARKER
        );

        dialog.innerHTML = `
          <div class="mmcr-v6-head">
            <div class="mmcr-v6-icon" aria-hidden="true">!</div>
            <div>
              <h3>1·2호기 석탄 사용량 검토 필요</h3>
              <p>
                최대혼소 조정 시 Bio 이동량에 따라
                Coal 사용량도 함께 보정됩니다.
                조정 결과를 적용하기 전에 1호기와 2호기의
                Coal 사용량을 반드시 확인해 주세요.
              </p>
            </div>
          </div>

          <div class="mmcr-v6-note">
            확인을 누르면 기존 최대혼소 조정을 1회 실행합니다.
            취소를 누르면 현재 값은 변경하지 않습니다.
          </div>

          <footer>
            <button
              type="button"
              data-mmcr-v6-cancel
            >
              취소
            </button>

            <button
              type="button"
              data-mmcr-v6-confirm
            >
              확인 후 최대혼소 조정
            </button>
          </footer>
        `;

        document.body.appendChild(
          dialog
        );

        let settled =
          false;

        const finish =
          value => {
            if (settled) {
              return;
            }

            settled =
              true;

            dialog.removeEventListener(
              "cancel",
              handleCancel
            );

            if (
              dialog.open &&
              typeof dialog.close === "function"
            ) {
              try {
                dialog.close();
              } catch (_) {
              }
            }

            dialog.remove();

            resolve(
              value
            );
          };

        const handleCancel =
          event => {
            event.preventDefault();
            event.stopPropagation();

            finish(
              false
            );
          };

        dialog.addEventListener(
          "cancel",
          handleCancel
        );

        dialog
          .querySelector(
            "[data-mmcr-v6-cancel]"
          )
          ?.addEventListener(
            "click",
            event => {
              event.preventDefault();
              event.stopPropagation();

              finish(
                false
              );
            }
          );

        const confirmButton =
          dialog.querySelector(
            "[data-mmcr-v6-confirm]"
          );

        confirmButton
          ?.addEventListener(
            "click",
            event => {
              event.preventDefault();
              event.stopPropagation();

              finish(
                true
              );
            }
          );

        if (
          typeof dialog.showModal !==
            "function"
        ) {
          dialog.remove();

          resolve(
            window.confirm(
              "1·2호기 석탄 사용량 검토 필요\n\n" +
              "최대혼소 조정 시 Bio 이동량에 따라 " +
              "Coal 사용량도 함께 보정됩니다.\n" +
              "적용 전 1호기·2호기 Coal 사용량을 확인해 주세요."
            )
          );

          return;
        }

        dialog.showModal();

        window.setTimeout(
          () => {
            confirmButton?.focus();
          },
          0
        );
      }
    );
  }

  async function interceptMaximumAdjustment(
    event
  ) {
    const eventTarget =
      event.target &&
      event.target.nodeType === 1
        ? event.target
        : event.target?.parentElement;

    const button =
      eventTarget?.closest?.(
        "[data-cfv56-auto]"
      ) ||
      null;

    if (!button) {
      return;
    }

    if (
      replayButtons.has(
        button
      )
    ) {
      replayButtons.delete(
        button
      );

      return;
    }

    if (
      !isMorningMeetingActive()
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const confirmed =
      await showReviewDialog();

    if (!confirmed) {
      return;
    }

    if (
      !button.isConnected ||
      button.disabled
    ) {
      return;
    }

    replayButtons.add(
      button
    );

    button.click();
  }

  /*
    Window capture is intentionally used.
    It runs before document/target click handlers, so the existing
    maximum-cofiring handler cannot run until the review dialog
    has been confirmed.
  */
  window.addEventListener(
    "click",
    interceptMaximumAdjustment,
    true
  );

  window.MorningMeetingCofiringCoalReviewPopupV6 =
    Object.freeze({
      marker:
        MARKER,

      isMorningMeetingActive
    });
}());
