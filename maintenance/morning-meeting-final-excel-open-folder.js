(() => {
  "use strict";

  if (window.__morningMeetingFinalExcelOpenFolderV21Installed === true) {
    return;
  }

  window.__morningMeetingFinalExcelOpenFolderV21Installed = true;

  const CREATE_BUTTON_ID = "createEfficiencyMorningMeetingWorkbookButton";
  const MESSAGE_ID = "efficiencyMorningMeetingMessage";
  const TOAST_ID = "appToast";
  const OUTPUT_FOLDER_STATUS_ID = "efficiencyMorningMeetingOutputFolderStatus";
  const COFIRING_DATE_ID = "efficiencyMorningMeetingCofiringDate";
  const MODAL_ID = "morningMeetingFinalExcelOpenFolderModal";
  const STYLE_ID = "morningMeetingFinalExcelOpenFolderStyle";
  const REQUEST_TYPE = "open_final_excel_folder";
  const REQUEST_API = "/api/ois-data-requests";
  const REQUEST_TIMEOUT_MS = 30000;
  const POLL_INTERVAL_MS = 500;

  let armed = false;
  let startedAt = 0;
  let sawNonSuccessAfterStart = false;
  let sawBusy = false;
  let initialSuccess = false;
  let promptShownForRun = false;
  let requestPending = false;

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

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function addOneDay(isoDate) {
    const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return "";
    }

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  function getFinalExcelTargetDate() {
    const combinedText = [
      textOf(OUTPUT_FOLDER_STATUS_ID),
      textOf(MESSAGE_ID),
      textOf(TOAST_ID)
    ].join(" ");

    const yearMonthMatch = combinedText.match(/(20\d{2})년\s*(\d{1,2})월/);
    if (yearMonthMatch) {
      return `${yearMonthMatch[1]}-${pad2(yearMonthMatch[2])}-01`;
    }

    const filenameDateMatch = combinedText.match(/_(\d{1,2})\.(\d{1,2})(?:\s*\(\d+\))?\.xlsx/i);
    const cofiringDateMatch = textOf(COFIRING_DATE_ID).match(/(20\d{2})-(\d{2})-(\d{2})/);

    if (filenameDateMatch && cofiringDateMatch) {
      let year = Number(cofiringDateMatch[1]);
      const sourceMonth = Number(cofiringDateMatch[2]);
      const targetMonth = Number(filenameDateMatch[1]);

      if (sourceMonth === 12 && targetMonth === 1) {
        year += 1;
      }

      return `${year}-${pad2(targetMonth)}-${pad2(filenameDateMatch[2])}`;
    }

    if (cofiringDateMatch) {
      return addOneDay(cofiringDateMatch[0]);
    }

    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  }

  function getAuthHeaders(jsonRequest = false) {
    const baseHeaders =
      typeof window.getShiftLogAuthHeaders === "function"
        ? window.getShiftLogAuthHeaders()
        : {};

    return {
      ...baseHeaders,
      Accept: "application/json",
      ...(jsonRequest ? { "Content-Type": "application/json" } : {})
    };
  }

  async function readJsonResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(
        String(payload?.message || payload?.error || `요청 실패 (${response.status})`).trim()
      );
    }
    return payload;
  }

  async function waitForRequestCompletion(requestId) {
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS));

      const response = await fetch(
        `${REQUEST_API}?id=${encodeURIComponent(requestId)}&_=${Date.now()}`,
        {
          method: "GET",
          headers: getAuthHeaders(false),
          cache: "no-store"
        }
      );

      const payload = await readJsonResponse(response);
      const item = payload?.item || {};
      const status = String(item.status || "").toLowerCase();

      if (status === "complete") {
        return item;
      }

      if (status === "failed") {
        throw new Error(
          String(item.errorMessage || item.error_message || "탐색기 열기 요청이 실패했습니다.").trim()
        );
      }
    }

    throw new Error("탐색기 열기 응답 시간이 초과되었습니다. OIS Agent 실행 상태를 확인해 주세요.");
  }

  async function requestOpenFinalExcelFolder() {
    const targetDate = getFinalExcelTargetDate();
    const response = await fetch(REQUEST_API, {
      method: "POST",
      headers: getAuthHeaders(true),
      cache: "no-store",
      body: JSON.stringify({
        requestType: REQUEST_TYPE,
        targetDate,
        forceRefresh: true
      })
    });

    const payload = await readJsonResponse(response);
    const requestId = String(payload?.item?.id || "").trim();

    if (!requestId) {
      throw new Error("탐색기 열기 요청 ID를 받지 못했습니다.");
    }

    return await waitForRequestCompletion(requestId);
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
      #${MODAL_ID} .mm-final-folder-status {
        min-height: 16px;
        margin-top: 8px;
        color: #2f78c9;
        font-size: 10px;
        font-weight: 800;
      }
      #${MODAL_ID} .mm-final-folder-status.is-error {
        color: #c54848;
      }
      #${MODAL_ID} .mm-final-folder-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 14px;
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
      #${MODAL_ID} button:disabled {
        opacity: 0.55;
        cursor: default;
      }
    `;
    document.head.appendChild(style);
  }

  function setModalBusy(modal, busy, message = "", error = false) {
    const yesButton = modal.querySelector("[data-open-folder-yes]");
    const noButton = modal.querySelector("[data-open-folder-no]");
    const status = modal.querySelector(".mm-final-folder-status");

    if (yesButton) {
      yesButton.disabled = busy;
      yesButton.textContent = busy ? "여는 중..." : "예";
    }

    if (noButton) {
      noButton.disabled = busy;
    }

    if (status) {
      status.textContent = message;
      status.classList.toggle("is-error", error === true);
    }
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
        <p>저장된 폴더를 탐색기로 여시겠습니까?</p>
        <div class="mm-final-folder-status" aria-live="polite"></div>
        <div class="mm-final-folder-actions">
          <button type="button" data-open-folder-no>아니요</button>
          <button type="button" data-open-folder-yes>예</button>
        </div>
      </section>
    `;

    modal.addEventListener("click", async event => {
      if (event.target === modal || event.target.closest("[data-open-folder-no]")) {
        if (!requestPending) {
          modal.hidden = true;
        }
        return;
      }

      if (!event.target.closest("[data-open-folder-yes]") || requestPending) {
        return;
      }

      requestPending = true;
      setModalBusy(modal, true, "Windows 탐색기를 여는 중입니다...");

      try {
        await requestOpenFinalExcelFolder();
        setModalBusy(modal, false, "저장 폴더를 탐색기로 열었습니다.");
        window.setTimeout(() => {
          modal.hidden = true;
        }, 650);
      } catch (error) {
        console.error("최종 Excel 저장 폴더 탐색기 열기 실패:", error);
        setModalBusy(
          modal,
          false,
          String(error?.message || "탐색기를 열지 못했습니다."),
          true
        );
      } finally {
        requestPending = false;
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
    setModalBusy(modal, false, "");
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

    if (elapsed >= 150 && (returnedAfterClear || newSuccess || completedBusyCycle)) {
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

    window.__morningMeetingFinalExcelOpenFolderV2Observer = observer;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
