"use strict";

/* =========================================================
  GS Shift Log - 점검일지 실행기

  사용 조건:
  - PC 화면에서만 사용 가능
  - 최고관리자 또는 로그인 사용자의 보직이 TO, BO1, BO2인 경우 사용 가능

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

  const MODAL_ID =
    "nightPatrolModal";

  const BUTTON_ID =
    "nightPatrolButton";

  const FRAME_ID =
    "nightPatrolFrame";

  const PAGE_URL =
    "inspection-logs/inspection-logs.html?v=20260804-final1";

  const AUTH_STORAGE_KEY =
    "gsShiftLog.currentUser";

  const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
    "2014081";

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
    /*
      업무일지 본체가 이미 사용하는 보직 판정 함수를
      가장 먼저 사용한다.
    */
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

    /*
      서버·이전 버전별 보직 필드명을 모두 지원한다.
      role은 일반적으로 user/admin/super_admin이지만,
      TO·BO1·BO2가 직접 들어오는 예외도 함께 확인한다.
    */
    const positionCandidates = [
      currentUser.position,
      currentUser.jobPosition,
      currentUser.job_position,
      currentUser.jobRole,
      currentUser.job_role,
      currentUser.duty,
      currentUser.dutyName,
      currentUser.duty_name,
      currentUser.workPosition,
      currentUser.work_position,
      currentUser.workRole,
      currentUser.work_role,
      currentUser.shiftPosition,
      currentUser.shift_position,
      currentUser.shiftRole,
      currentUser.shift_role,
      currentUser.logRole,
      currentUser.log_role,
      currentUser.defaultPosition,
      currentUser.default_position,
      currentUser.assignedPosition,
      currentUser.assigned_position,
      currentUser.memberPosition,
      currentUser.member_position,
      currentUser.memberRole,
      currentUser.member_role,
      currentUser.role
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
    최고관리자 판정

    지원:
    - 업무일지 본체의 isCurrentUserSuperAdmin()
    - 사번 2014081
    - adminLevel 2 이상
    - isSuperAdmin 플래그
    - role 계열 필드의 super_admin
  ====================================================== */

  function isCurrentUserNightPatrolSuperAdmin() {
    if (
      typeof window.isCurrentUserSuperAdmin ===
        "function"
    ) {
      try {
        if (
          window.isCurrentUserSuperAdmin()
        ) {
          return true;
        }
      } catch (error) {
        console.warn(
          "야간순찰 최고관리자 함수 확인 실패:",
          error
        );
      }
    }

    const currentUser =
      getCurrentUser();

    if (
      !currentUser
    ) {
      return false;
    }

    const employeeNo =
      String(
        currentUser.employeeNo ||
        currentUser.employee_no ||
        currentUser.employeeId ||
        currentUser.employee_id ||
        ""
      ).trim();

    if (
      employeeNo ===
      FORCED_SUPER_ADMIN_EMPLOYEE_NO
    ) {
      return true;
    }

    if (
      Number(
        currentUser.adminLevel ??
        currentUser.admin_level ??
        0
      ) >= 2
    ) {
      return true;
    }

    const superAdminFlag =
      currentUser.isSuperAdmin ??
      currentUser.is_super_admin ??
      false;

    if (
      superAdminFlag === true ||
      Number(superAdminFlag) === 1 ||
      String(superAdminFlag)
        .trim()
        .toLowerCase() === "true"
    ) {
      return true;
    }

    const accountRoleCandidates = [
      currentUser.role,
      currentUser.userRole,
      currentUser.user_role,
      currentUser.defaultRole,
      currentUser.default_role,
      currentUser.permission,
      currentUser.authority,
      currentUser.accessRole,
      currentUser.access_role
    ];

    return accountRoleCandidates.some(
      value => {
        const role =
          String(
            value ||
            ""
          )
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_");

        return [
          "super_admin",
          "superadmin",
          "최고관리자"
        ].includes(role);
      }
    );
  }


/* =====================================================
  점검일지 최종 사용 권한

  허용:
  - GS Shift Log에 로그인한 모든 사용자
  - 모든 보직
  - PC·모바일

  차단:
  - 로그인하지 않은 사용자
===================================================== */

function canCurrentUserUseNightPatrol() {
  const appShell =
    document.getElementById(
      "appShell"
    );


  const currentUser =
    getCurrentUser();


  return Boolean(
    currentUser &&
    appShell &&
    appShell.hidden !==
      true
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
      "is-open",
      "is-inspection-expanded"
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

  /* =====================================================
    점검일지 상단 메뉴 생성

    표시:
    - 숫자 배지 없이 메뉴명만 표시
  ====================================================== */

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


    const existingButton =
      document.getElementById(
        BUTTON_ID
      );


    if (
      existingButton
    ) {
      existingButton.classList.remove(
        "has-inspection-alerts",
        "has-overdue-inspections"
      );


      existingButton.removeAttribute(
        "data-inspection-pending-count"
      );


      existingButton.removeAttribute(
        "data-inspection-overdue-count"
      );


      existingButton.setAttribute(
        "aria-label",
        "점검일지 열기"
      );


      existingButton.title =
        "점검일지";


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


    button.innerHTML = `
      <span class="night-patrol-header-button__label">
        점검일지
      </span>
    `;


    button.setAttribute(
      "aria-label",
      "점검일지 열기"
    );


    button.title =
      "점검일지";


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

/* =====================================================
  점검일지 팝업 생성

  iframe은 메뉴 생성 시 미리 불러온다.

  이유:
  점검일지 창을 열지 않아도
  오늘 미완료·지연 건수를 받아야 하기 때문이다.
====================================================== */

function createModal() {
  const existingModal =
    getModal();


  if (
    existingModal
  ) {
    const existingFrame =
      getFrame();


    if (
      existingFrame &&
      existingFrame.getAttribute(
        "src"
      ) !==
        PAGE_URL
    ) {
      existingFrame.setAttribute(
        "src",
        PAGE_URL
      );
    }


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

          <p class="modal-header__eyebrow">
            INSPECTION LOGS
          </p>

          <h2
            class="modal-header__title"
            id="nightPatrolModalTitle"
          >
            점검일지
          </h2>

        </div>


        <button
          type="button"
          class="modal-close-button"
          id="closeNightPatrolButton"
          aria-label="점검일지 닫기"
        >
          ×
        </button>

      </header>


      <div class="night-patrol-modal__body">

        <iframe
          id="${FRAME_ID}"
          class="night-patrol-frame"
          title="점검일지"
          src="${PAGE_URL}"
          loading="eager"
          allow="fullscreen"
          allowfullscreen
        >
        </iframe>

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
    현장 입력 중 배경을 잘못 눌러도
    팝업이 닫히지 않게 한다.
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

  /* =====================================================
  점검일지 iframe 메시지 처리

  지원:
  - 점검일지 팝업 닫기
  - 오늘 미완료·지연 건수 갱신
====================================================== */

function handleNightPatrolLauncherMessage(
  event
) {
  if (
    event.origin !==
      window.location.origin
  ) {
    return;
  }


  const frame =
    getFrame();


  if (
    !frame?.contentWindow ||
    event.source !==
      frame.contentWindow
  ) {
    return;
  }


  const messageType =
    String(
      event.data?.type ||
      ""
    ).trim();


  if (
    messageType ===
      "gs-night-patrol:close"
  ) {
    closeNightPatrolModal();

    return;
  }


  if (
    messageType !==
      "gs-shift-log:inspection-view-mode"
  ) {
    return;
  }


  const modal =
    getModal();


  modal?.classList.toggle(
    "is-inspection-expanded",
    event.data?.expanded ===
      true
  );
}

/* =====================================================
  점검일지 실행기 설치

  처리:
  - 로그인·권한 상태에 맞춰 메뉴 생성
  - 로그인 화면 변경 감시
  - 점검일지 iframe 메시지 연결
  - 초기 로딩 지연에 대비해 재확인
====================================================== */

function scheduleInstall() {
  syncNightPatrolAccess();


  observeLoginState();


  /*
    점검일지 iframe 메시지는 한 번만 연결한다.
  */
  if (
    window
      .__gsInspectionScheduleMessageBound !==
      true
  ) {
    window.addEventListener(
      "message",
      handleNightPatrolLauncherMessage
    );


    window
      .__gsInspectionScheduleMessageBound =
      true;
  }


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
