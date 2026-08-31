(() => {
  "use strict";

  if (window.__morningMeetingFinalExcelOpenFolderV1Installed === true) {
    return;
  }
  window.__morningMeetingFinalExcelOpenFolderV1Installed = true;

  const CREATE_BUTTON_ID = "createEfficiencyMorningMeetingWorkbookButton";
  const FOLDER_BUTTON_ID = "selectEfficiencyMorningMeetingOutputFolderButton";
  const MESSAGE_ID = "efficiencyMorningMeetingMessage";
  const TOAST_ID = "appToast";
  const MODAL_ID = "morningMeetingFinalExcelOpenFolderModal";
  const STYLE_ID = "morningMeetingFinalExcelOpenFolderStyle";

  let armed = false;
  let startedAt = 0;
  let sawNonSuccessAfterStart = false;
  let sawBusy = false;
  let initialSuccess = false;
  let promptShownForRun = false;

  function textOf(id) {
    return String(document.getElementById(id)?.textContent || "").trim();
  }

  function isSuccessText(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return (
      /최종\s*엑셀\s*생성\s*완료/.test(value) ||
      /파일이\s*생성되었습니다/.test(value)
    );
  }

  function hasSuccessSignal() {
    return isSuccessText(textOf(MESSAGE_ID)) || isSuccessText(textOf(TOAST_ID));
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID}[hidden] { display: none !important; }
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 12050;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(26, 38, 54, 0.34);
      }
      #${MODAL_ID} .mm-final-folder-dialog {
        width: min(390px, calc(100vw - 36px));
        box-sizing: border-box;
        padding: 22px 22px 18px;
        border: 1px solid #d7e0ea;
        border-radius: 15px;
        background: #fff;
        box-shadow: 0 22px 60px rgba(25, 39, 58, 0.22);
        text-align: center;
      }
      #${MODAL_ID} .mm-final-folder-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        margin: 0 auto 11px;
        border-radius: 50%;
        background: #eaf8ef;
        color: #26a260;
        font-size: 26px;
        font-weight: 900;
      }
      #${MODAL_ID} h4 {
        margin: 0;
        color: #22364f;
        font-size: 16px;
        font-weight: 900;
      }
      #${MODAL_ID} p {
        margin: 8px 0 0;
        color: #66778b;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.45;
      }
      #${MODAL_ID} .mm-final-folder-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 18px;
      }
      #${MODAL_ID} button {
        height: 36px;
        border: 1px solid #ccd7e3;
        border-radius: 8px;
        background: #fff;
        color: #52657a;
        font: inherit;
        font-size: 11px;
        font-weight: 850;
        cursor: pointer;
      }
      #${MODAL_ID} button[data-open-folder-yes] {
        border-color: #2f78c9;
        background: #2f78c9;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) {
      return modal;
    }

    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.hidden = true;
    modal.setAttribute("role", "presentation");
    modal.innerHTML = `
      <section class="mm-final-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="mmFinalFolderTitle">
        <div class="mm-final-folder-icon" aria-hidden="true">✓</div>
        <h4 id="mmFinalFolderTitle">최종 엑셀 생성 완료</h4>
        <p>폴더를 여시겠습니까?</p>
        <div class="mm-final-folder-actions">
          <button type="button" data-open-folder-no>아니요</button>
          <button type="button" data-open-folder-yes>예</button>
        </div>
      </section>
    `;

    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-open-folder-no]")) {
        modal.hidden = true;
        return;
      }

      if (event.target.closest("[data-open-folder-yes]")) {
        const folderButton = document.getElementById(FOLDER_BUTTON_ID);
        modal.hidden = true;

        if (!folderButton || folderButton.disabled) {
          console.warn("최종 Excel 저장 폴더 버튼을 찾지 못했습니다.");
          return;
        }

        // Keep the native user gesture: the existing folder control owns the
        // File System Access handle and reopens the system folder window at
        // the currently configured save location.
        folderButton.click();
      }
    });

    document.body.appendChild(modal);
    return modal;
  }

  function showPrompt() {
    if (promptShownForRun) {
      return;
    }

    promptShownForRun = true;
    armed = false;
    const modal = ensureModal();
    modal.hidden = false;

    const yesButton = modal.querySelector("[data-open-folder-yes]");
    if (yesButton) {
      window.setTimeout(() => yesButton.focus(), 0);
    }
  }

  function evaluateGenerationState() {
    if (!armed || promptShownForRun) {
      return;
    }

    const createButton = document.getElementById(CREATE_BUTTON_ID);
    if (createButton?.disabled) {
      sawBusy = true;
    }

    const success = hasSuccessSignal();
    if (!success) {
      sawNonSuccessAfterStart = true;
      return;
    }

    const elapsed = Date.now() - startedAt;
    const returnedAfterClear = sawNonSuccessAfterStart;
    const newSuccess = !initialSuccess;
    const completedBusyCycle = sawBusy && createButton && !createButton.disabled;

    if (
      elapsed >= 150 &&
      (returnedAfterClear || newSuccess || completedBusyCycle)
    ) {
      showPrompt();
    }
  }

  function armForGeneration(event) {
    const button = event.target.closest(`#${CREATE_BUTTON_ID}`);
    if (!button || button.disabled) {
      return;
    }

    armed = true;
    startedAt = Date.now();
    initialSuccess = hasSuccessSignal();
    sawNonSuccessAfterStart = !initialSuccess;
    sawBusy = button.disabled === true;
    promptShownForRun = false;

    window.setTimeout(evaluateGenerationState, 200);
  }

  function install() {
    installStyles();
    ensureModal();

    document.addEventListener("click", armForGeneration, true);

    const observer = new MutationObserver(() => {
      evaluateGenerationState();
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "disabled"]
    });

    window.__morningMeetingFinalExcelOpenFolderV1Observer = observer;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
