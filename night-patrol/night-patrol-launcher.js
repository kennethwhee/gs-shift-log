"use strict";

/* =========================================================
  GS Shift Log - 야간 순찰 점검일지 실행기

  원칙:
  - 기존 script.js와 완전히 분리
  - 상단 메뉴와 팝업만 자동 생성
  - 실제 순찰 기능은 iframe의 night-patrol.html에서 실행
========================================================= */

(function initializeNightPatrolLauncher() {
  if (window.__gsNightPatrolLauncherInstalled === true) {
    return;
  }

  window.__gsNightPatrolLauncherInstalled = true;

  const MODAL_ID = "nightPatrolModal";
  const BUTTON_ID = "nightPatrolButton";
  const FRAME_ID = "nightPatrolFrame";
  const PAGE_URL = "night-patrol.html";

  function getModal() {
    return document.getElementById(MODAL_ID);
  }

  function getFrame() {
    return document.getElementById(FRAME_ID);
  }

  function isAnotherModalOpen() {
    return [
      ...document.querySelectorAll(".modal-backdrop.is-open")
    ].some((modal) => modal.id !== MODAL_ID);
  }

  function openNightPatrolModal() {
    const modal = getModal();
    const frame = getFrame();

    if (!modal || !frame) {
      console.error("야간 순찰 팝업 요소를 찾을 수 없습니다.");
      return;
    }

    if (!frame.getAttribute("src")) {
      frame.setAttribute("src", PAGE_URL);
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    window.setTimeout(() => {
      document
        .getElementById("closeNightPatrolButton")
        ?.focus();
    }, 0);
  }

  function closeNightPatrolModal() {
    const modal = getModal();

    if (!modal) {
      return;
    }

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    if (!isAnotherModalOpen()) {
      document.body.classList.remove("modal-open");
    }
  }

  function createMenuButton() {
    const headerActions = document.querySelector(".header-actions");

    if (!headerActions) {
      return false;
    }

    if (document.getElementById(BUTTON_ID)) {
      return true;
    }

    const button = document.createElement("button");

    button.type = "button";
    button.id = BUTTON_ID;
    button.className = "header-action night-patrol-header-button";
    button.textContent = "야간순찰";
    button.setAttribute("aria-label", "야간 순찰 점검일지 열기");

    const noticeButton = document.getElementById("noticeButton");

    if (noticeButton?.parentElement === headerActions) {
      headerActions.insertBefore(button, noticeButton);
    } else {
      headerActions.prepend(button);
    }

    button.addEventListener("click", openNightPatrolModal);

    return true;
  }

  function createModal() {
    if (getModal()) {
      return true;
    }

    const modal = document.createElement("div");

    modal.id = MODAL_ID;
    modal.className = "modal-backdrop night-patrol-modal";
    modal.setAttribute("aria-hidden", "true");

    modal.innerHTML = `
      <section
        class="modal-panel night-patrol-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nightPatrolModalTitle"
      >
        <header class="modal-header night-patrol-modal__header">
          <div>
            <p class="modal-header__eyebrow">NIGHT PATROL</p>
            <h2
              class="modal-header__title"
              id="nightPatrolModalTitle"
            >
              야간 순찰 점검일지
            </h2>
          </div>

          <button
            type="button"
            class="modal-close-button"
            id="closeNightPatrolButton"
            aria-label="야간 순찰 점검일지 닫기"
          >
            ×
          </button>
        </header>

        <div class="night-patrol-modal__body">
          <iframe
            id="${FRAME_ID}"
            class="night-patrol-frame"
            title="야간 순찰 점검일지"
            loading="lazy"
          ></iframe>
        </div>
      </section>
    `;

    document.body.appendChild(modal);

    document
      .getElementById("closeNightPatrolButton")
      ?.addEventListener("click", closeNightPatrolModal);

    /*
      바깥 배경 클릭으로는 닫히지 않게 한다.
      현장 입력 중 실수로 닫히는 것을 방지한다.
    */
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    return true;
  }

  function install() {
    const menuReady = createMenuButton();
    const modalReady = createModal();

    return menuReady && modalReady;
  }

  function scheduleInstall() {
    if (install()) {
      return;
    }

    let attempts = 0;

    const timer = window.setInterval(() => {
      attempts += 1;

      if (install() || attempts >= 40) {
        window.clearInterval(timer);
      }
    }, 250);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (!getModal()?.classList.contains("is-open")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeNightPatrolModal();
  }, true);

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    if (event.data?.type === "gs-night-patrol:close") {
      closeNightPatrolModal();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleInstall, {
      once: true
    });
  } else {
    scheduleInstall();
  }
})();
