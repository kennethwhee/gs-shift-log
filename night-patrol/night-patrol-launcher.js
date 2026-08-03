"use strict";

/* =========================================================
  GS Shift Log - 야간 순찰 점검일지 실행기

  사용 조건:
  - PC 화면에서만 사용 가능
  - 로그인 사용자의 보직이 TO, BO1, BO2인 경우만 사용 가능

  원칙:
  - 기존 script.js와 완전히 분리
  - 권한이 없는 사용자에게는 메뉴 자체를 생성하지 않음
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
  const PAGE_URL =
    "night-patrol/night-patrol.html?v=20260803-4";

  const AUTH_STORAGE_KEY =
    "gsShiftLog.currentUser";

  const DESKTOP_MEDIA_QUERY =
    "(min-width: 769px)";

  const ALLOWED_POSITIONS =
    new Set([
      "TO",
      "BO1",
      "BO2"
    ]);

  const desktopMedia =
    window.matchMedia(
      DESKTOP_MEDIA_QUERY
    );


  /* =====================================================
    현재 로그인 사용자
  ====================================================== */

  function getCurrentUser() {
    if (
      typeof window.loadCurrentUser ===
        "function"
    ) {
      try {
        return window.loadCurrentUser();
      } catch (error) {
        console.warn(
          "야간순찰 로그인 사용자 확인 실패:",
          error
        );
      }
    }

    try {
      const savedUser =
        window.localStorage.getItem(
          AUTH_STORAGE_KEY
        );

      return savedUser
        ? JSON.parse(savedUser)
        : null;

    } catch (error) {
      console.warn(
        "야간순찰 로그인 정보 읽기 실패:",
        error
      );

      return null;
    }
  }


  /* =====================================================
    보직 정리
  ====================================================== */

  function normalizePosition(
    value
  ) {
    const normalizedValue =
      String(
        value ||
        ""
      )
        .trim()
        .toUpperCase()
        .replace(
          /[\s_-]+/g,
          ""
        );

    const positionMap = {
      TO:
        "TO",

      BO1:
        "BO1",

      BO2:
        "BO2"
    };

    return (
      positionMap[
        normalizedValue
      ] ||
      ""
    );
  }


  function getCurrentUserPosition() {
    if (
      typeof window.getCurrentUserRoleNoticePosition ===
        "function"
    ) {
      try {
        const currentPosition =
          normalizePosition(
            window.getCurrentUserRoleNoticePosition()
          );

        if (
          currentPosition
        ) {
          return currentPosition;
        }
      } catch (error) {
        console.warn(
          "야간순찰 보직 함수 확인 실패:",
          error
        );
      }
    }

    const currentUser =
      getCurrentUser();

    if (
      !currentUser
    ) {
      return "";
    }

    const positionCandidates = [
      currentUser.position,
      currentUser.jobPosition,
      currentUser.job_position,
      currentUser.duty,
      currentUser.dutyName,
      currentUser.duty_name,
      currentUser.defaultPosition,
      currentUser.default_position,
      currentUser.assignedPosition,
      currentUser.assigned_position,
      currentUser.memberPosition,
      currentUser.member_position
    ];

    for (
      const candidate of
      positionCandidates
    ) {
      const normalizedPosition =
        normalizePosition(
          candidate
        );

      if (
        normalizedPosition
      ) {
        return normalizedPosition;
      }
    }

    return "";
  }


  /* =====================================================
    최종 사용 권한
  ====================================================== */

  function canCurrentUserUseNightPatrol() {
    if (
      !desktopMedia.matches
    ) {
      return false;
    }

    const appShell =
      document.getElementById(
        "appShell"
      );

    if (
      appShell?.hidden ===
        true
    ) {
      return false;
    }

    return ALLOWED_POSITIONS.has(
      getCurrentUserPosition()
    );
  }


  function getModal() {
    return document.getElementById(
      MODAL_ID
    );
  }


  function getFrame() {
    return document.getElementById(
      FRAME_ID
    );
  }


  function isAnotherModalOpen() {
    return [
      ...document.querySelectorAll(
        ".modal-backdrop.is-open"
      )
    ].some(
      modal => {
        return (
          modal.id !==
          MODAL_ID
        );
      }
    );
  }


  function openNightPatrolModal() {
    if (
      !canCurrentUserUseNightPatrol()
    ) {
      syncNightPatrolAccess();

      return;
    }

    const modal =
      getModal();

    const frame =
      getFrame();

    if (
      !modal ||
      !frame
    ) {
      console.error(
        "야간 순찰 팝업 요소를 찾을 수 없습니다."
      );

      return;
    }

    if (
      frame.getAttribute(
        "src"
      ) !==
      PAGE_URL
    ) {
      frame.setAttribute(
        "src",
        PAGE_URL
      );
    }

    modal.classList.add(
      "is-open"
    );

    modal.setAttribute(
      "aria-hidden",
      "false"
    );

    document.body.classList.add(
      "modal-open"
    );

    window.setTimeout(
      () => {
        document
          .getElementById(
            "closeNightPatrolButton"
          )
          ?.focus();
      },
      0
    );
  }


  function closeNightPatrolModal() {
    const modal =
      getModal();

    if (
      !modal
    ) {
      return;
    }

    modal.classList.remove(
      "is-open"
    );

    modal.setAttribute(
      "aria-hidden",
      "true"
    );

    if (
      !isAnotherModalOpen()
    ) {
      document.body.classList.remove(
        "modal-open"
      );
    }
  }


  function removeNightPatrolElements() {
    closeNightPatrolModal();

    document
      .getElementById(
        BUTTON_ID
      )
      ?.remove();

    getModal()
      ?.remove();
  }


  function createMenuButton() {
    const headerActions =
      document.querySelector(
        ".header-actions"
      );

    if (
      !headerActions
    ) {
      return false;
    }

    if (
      document.getElementById(
        BUTTON_ID
      )
    ) {
      return true;
    }

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.id =
      BUTTON_ID;

    button.className =
      "header-action night-patrol-header-button";

    button.textContent =
      "야간순찰";

    button.setAttribute(
      "aria-label",
      "야간 순찰 점검일지 열기"
    );

    const noticeButton =
      document.getElementById(
        "noticeButton"
      );

    if (
      noticeButton?.parentElement ===
        headerActions
    ) {
      headerActions.insertBefore(
        button,
        noticeButton
      );

    } else {
      headerActions.prepend(
        button
      );
    }

    button.addEventListener(
      "click",
      openNightPatrolModal
    );

    return true;
  }


  function createModal() {
    if (
      getModal()
    ) {
      return true;
    }

    const modal =
      document.createElement(
        "div"
      );

    modal.id =
      MODAL_ID;

    modal.className =
      "modal-backdrop night-patrol-modal";

    modal.setAttribute(
      "aria-hidden",
      "true"
    );

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

    document.body.appendChild(
      modal
    );

    document
      .getElementById(
        "closeNightPatrolButton"
      )
      ?.addEventListener(
        "click",
        closeNightPatrolModal
      );

    /*
      바깥 배경 클릭으로는 닫히지 않게 한다.
      현장 입력 중 실수로 닫히는 것을 방지한다.
    */
    modal.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          modal
        ) {
          event.preventDefault();

          event.stopPropagation();
        }
      }
    );

    return true;
  }


  /* =====================================================
    화면·로그인·보직 상태에 맞춰 메뉴 동기화
  ====================================================== */

  function syncNightPatrolAccess() {
    if (
      !canCurrentUserUseNightPatrol()
    ) {
      removeNightPatrolElements();

      return false;
    }

    const menuReady =
      createMenuButton();

    const modalReady =
      createModal();

    return (
      menuReady &&
      modalReady
    );
  }


  function observeLoginState() {
    const appShell =
      document.getElementById(
        "appShell"
      );

    if (
      !appShell
    ) {
      return;
    }

    const observer =
      new MutationObserver(
        syncNightPatrolAccess
      );

    observer.observe(
      appShell,
      {
        attributes:
          true,

        attributeFilter: [
          "hidden"
        ]
      }
    );
  }


  function scheduleInstall() {
    syncNightPatrolAccess();

    observeLoginState();

    let attempts =
      0;

    const timer =
      window.setInterval(
        () => {
          attempts +=
            1;

          syncNightPatrolAccess();

          if (
            attempts >=
              40
          ) {
            window.clearInterval(
              timer
            );
          }
        },
        250
      );
  }


  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !==
        "Escape"
      ) {
        return;
      }

      if (
        !getModal()
          ?.classList
          .contains(
            "is-open"
          )
      ) {
        return;
      }

      event.preventDefault();

      event.stopPropagation();

      closeNightPatrolModal();
    },
    true
  );


  window.addEventListener(
    "message",
    event => {
      if (
        event.origin !==
        window.location.origin
      ) {
        return;
      }

      if (
        event.data?.type ===
        "gs-night-patrol:close"
      ) {
        closeNightPatrolModal();
      }
    }
  );


  window.addEventListener(
    "storage",
    event => {
      if (
        event.key ===
        AUTH_STORAGE_KEY
      ) {
        syncNightPatrolAccess();
      }
    }
  );


  window.addEventListener(
    "focus",
    syncNightPatrolAccess
  );


  desktopMedia.addEventListener(
    "change",
    syncNightPatrolAccess
  );


  if (
    document.readyState ===
      "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      scheduleInstall,
      {
        once:
          true
      }
    );

  } else {
    scheduleInstall();
  }
})();
