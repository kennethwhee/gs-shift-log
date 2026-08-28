"use strict";

/* =========================================================
  GS Shift Log - 점검일지 실행기

  기능:
  - 로그인한 모든 사용자에게 점검일지 메뉴 표시
  - 점검일지 팝업 생성
  - 각 보직 카드에 오늘 점검 현황 표시
  - 모든 사용자가 모든 보직의 오늘 점검 확인 가능
========================================================= */

(function initializeInspectionLogLauncher() {
  if (window.__gsNightPatrolLauncherInstalled === true) {
    return;
  }

  window.__gsNightPatrolLauncherInstalled = true;

  const MODAL_ID = "nightPatrolModal";
  const BUTTON_ID = "nightPatrolButton";
  const FRAME_ID = "nightPatrolFrame";

  /*
    [HEADER-MORE-MENU]

    PC header:
    - Inspection Logs remains a direct top menu
    - Navigator is inside the common hamburger

    Mobile header:
    - remove only the direct Inspection Logs button
    - add Inspection Logs to the common hamburger
    - keep inspection modal and role inspection functions available
  */
  const MOBILE_HEADER_MEDIA =
    window.matchMedia(
      "(max-width: 760px)"
    );

  /*
    Legacy mobile menu IDs are retained only so that
    previously generated standalone menus can be removed safely.
  */
  const MOBILE_MENU_ID =
    "mobileHeaderMoreMenu";

  const MOBILE_MENU_BUTTON_ID =
    "mobileHeaderMoreButton";

  const MOBILE_MENU_DROPDOWN_ID =
    "mobileHeaderMoreDropdown";

  const HEADER_MORE_MENU_ID =
    "headerMoreMenu";

  const HEADER_MORE_BUTTON_ID =
    "headerMoreButton";

  const HEADER_MORE_DROPDOWN_ID =
    "headerMoreDropdown";

  const HEADER_NAVIGATOR_ITEM_ID =
    "facilityNavigatorHeaderButton";

  const MOBILE_INSPECTION_ITEM_ID =
    "mobileHeaderInspectionItem";
  const ROLE_MODAL_ID = "inspectionRoleTodayModal";
  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";
  const PAGE_URL =
    "inspection-logs/inspection-logs.html?v=20260826-mobile-layout-v17";

  const deferInitialFrameLoad =
    window.__GS_MOBILE_RUNTIME_V14 === true;

  const mobileMenuLazyV15 =
    window.__GS_MOBILE_MENU_LAZY_V15 === true;

  const ROLE_ORDER = [
    "파트장",
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ];

  let roleTodaySummary = {
    available: false,
    workDate: "",
    shift: "",
    shiftLabel: "",
    errorMessage: "",
    roles: []
  };

  let shiftMemberObserver = null;
  let observedShiftMemberGrid = null;
  let renderQueued = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getCurrentUser() {
    if (typeof window.loadCurrentUser === "function") {
      try {
        return window.loadCurrentUser();
      } catch (error) {
        console.warn("점검일지 로그인 사용자 확인 실패:", error);
      }
    }

    try {
      const savedUser = window.localStorage.getItem(AUTH_STORAGE_KEY);
      return savedUser ? JSON.parse(savedUser) : null;
    } catch (error) {
      console.warn("점검일지 로그인 정보 읽기 실패:", error);
      return null;
    }
  }

  function canCurrentUserUseInspectionLogs() {
    const appShell = document.getElementById("appShell");
    const currentUser = getCurrentUser();

    return Boolean(
      currentUser &&
      appShell &&
      appShell.hidden !== true
    );
  }

  function normalizeRole(value) {
    const originalValue = String(value || "").trim();
    const comparableValue = originalValue
      .toUpperCase()
      .replace(/[\s_\-/]+/g, "");

    const roleMap = {
      "파트장": "파트장",
      PARTLEADER: "파트장",
      SHIFTLEADER: "파트장",
      LEADER: "파트장",
      TGO: "TGO",
      BCO1: "BCO1",
      BCO2: "BCO2",
      TO: "TO",
      BO1: "BO1",
      BO2: "BO2"
    };

    return roleMap[originalValue] || roleMap[comparableValue] || "";
  }

  function getMainModal() {
    return document.getElementById(MODAL_ID);
  }

  function getFrame() {
    return document.getElementById(FRAME_ID);
  }

  function getRoleModal() {
    return document.getElementById(ROLE_MODAL_ID);
  }

  function syncBodyModalState() {
    const hasOpenModal = [
      ...document.querySelectorAll(".modal-backdrop.is-open")
    ].some(modal => modal instanceof HTMLElement);

    document.body.classList.toggle("modal-open", hasOpenModal);
  }

  function openInspectionLogModal() {
    if (!canCurrentUserUseInspectionLogs()) {
      syncInspectionLogAccess();
      return;
    }

    const modal = getMainModal();
    const frame = getFrame();

    if (!modal || !frame) {
      console.error("점검일지 팝업 요소를 찾을 수 없습니다.");
      return;
    }

    if (frame.getAttribute("src") !== PAGE_URL) {
      frame.dataset.inspectionLoaded = "false";
      frame.setAttribute("src", PAGE_URL);
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    syncBodyModalState();

    window.setTimeout(() => {
      document.getElementById("closeNightPatrolButton")?.focus();
    }, 0);
  }

  function closeInspectionLogModal() {
    const modal = getMainModal();

    if (!modal) {
      return;
    }

    modal.classList.remove("is-open", "is-inspection-expanded");
    modal.setAttribute("aria-hidden", "true");
    syncBodyModalState();
  }

  function closeRoleTodayModal() {
    const modal = getRoleModal();

    if (!modal) {
      return;
    }

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    syncBodyModalState();
  }

  function closeMobileInspectionMenu() {
    if (
      typeof window
        .closeHeaderMoreMenu ===
      "function"
    ) {
      window.closeHeaderMoreMenu();
      return;
    }


    const dropdown =
      document.getElementById(
        HEADER_MORE_DROPDOWN_ID
      );

    const button =
      document.getElementById(
        HEADER_MORE_BUTTON_ID
      );


    if (dropdown) {
      dropdown.hidden =
        true;
    }


    if (button) {
      button.setAttribute(
        "aria-expanded",
        "false"
      );

      button.setAttribute(
        "aria-label",
        "더보기 메뉴 열기"
      );
    }
  }


  function createMobileInspectionMenu(
    headerActions
  ) {
    const menu =
      document.getElementById(
        HEADER_MORE_MENU_ID
      );

    const dropdown =
      document.getElementById(
        HEADER_MORE_DROPDOWN_ID
      );

    const navigatorItem =
      document.getElementById(
        HEADER_NAVIGATOR_ITEM_ID
      );

    const manholeManagementItem =
      document.getElementById(
        "manholeManagementHeaderButton"
      );

    const adminButton =
      document.getElementById(
        "adminButton"
      );


    if (
      !menu ||
      !dropdown ||
      !navigatorItem
    ) {
      return false;
    }


    /*
      공통 메뉴가 다른 위치로 이동한 경우에도
      사용자 영역 바로 앞의 기존 네비게이터 위치로 복원한다.
    */
    if (
      menu.parentElement !==
      headerActions
    ) {
      const directAdminButton =
        document.getElementById(
          "adminButton"
        );

      const headerUser =
        headerActions.querySelector(
          ".header-user"
        );

      const referenceElement =
        directAdminButton?.parentElement ===
        headerActions
          ? directAdminButton
          : headerUser;


      headerActions.insertBefore(
        menu,
        referenceElement ||
          null
      );
    }


    let inspectionItem =
      document.getElementById(
        MOBILE_INSPECTION_ITEM_ID
      );


    if (!inspectionItem) {
      inspectionItem =
        document.createElement(
          "button"
        );

      inspectionItem.id =
        MOBILE_INSPECTION_ITEM_ID;

      inspectionItem.type =
        "button";

      inspectionItem.innerHTML = `
        <span class="header-more-item__label">점검일지</span>
      `;
    }


    inspectionItem.className =
      mobileMenuLazyV15
        ? "header-more-item header-more-item--owned header-more-item--group-start"
        : "header-more-item header-more-item--owned header-more-item--mobile-only header-more-item--group-start";

    inspectionItem.setAttribute(
      "role",
      "menuitem"
    );

    inspectionItem.setAttribute(
      "aria-label",
      "직접 제작 메뉴, 점검일지 열기"
    );


    /*
      요청된 8개 공통 메뉴 다음에 모바일 점검일지를 두고,
      관리자는 PC / 모바일 모두 항상 마지막에 둔다.
    */
    const inspectionReference =
      adminButton?.parentElement ===
        dropdown
        ? adminButton
        : null;

    if (
      inspectionItem.parentElement !==
        dropdown ||
      inspectionItem.nextElementSibling !==
        inspectionReference
    ) {
      dropdown.insertBefore(
        inspectionItem,
        inspectionReference
      );
    }


    if (
      adminButton &&
      (
        adminButton.parentElement !==
          dropdown ||
        dropdown.lastElementChild !==
          adminButton
      )
    ) {
      dropdown.append(
        adminButton
      );
    }


    if (
      inspectionItem.dataset
        .inspectionMenuBound !==
      "true"
    ) {
      inspectionItem.dataset
        .inspectionMenuBound =
        "true";

      inspectionItem.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          closeMobileInspectionMenu();
          openInspectionLogModal();
        }
      );
    }


    return true;
  }

  function createMenuButton() {
    const headerActions =
      document.querySelector(
        ".header-actions"
      );

    if (!headerActions) {
      return false;
    }

    const existingButton =
      document.getElementById(
        BUTTON_ID
      );

    if (
      mobileMenuLazyV15 ||
      MOBILE_HEADER_MEDIA.matches
    ) {
      existingButton?.remove();

      return createMobileInspectionMenu(
        headerActions
      );
    }

    document
      .getElementById(
        MOBILE_MENU_ID
      )
      ?.remove();

    if (existingButton) {
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

    const efficiencyButton =
      document.getElementById(
        "efficiencyTeamButton"
      );

    if (
      efficiencyButton
        ?.parentElement ===
      headerActions
    ) {
      headerActions.insertBefore(
        button,
        efficiencyButton
      );

    } else {
      headerActions.prepend(
        button
      );
    }

    button.addEventListener(
      "click",
      openInspectionLogModal
    );

    return true;
  }

  function createInspectionLogModal() {
    const existingModal = getMainModal();

    if (existingModal) {
      const existingFrame = getFrame();

      if (
        existingFrame &&
        !existingFrame.getAttribute(
          "src"
        )
      ) {
        existingFrame.dataset.inspectionLoaded = "false";
        existingFrame.setAttribute(
          "src",
          deferInitialFrameLoad
            ? "about:blank"
            : PAGE_URL
        );
      }

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
            <p class="modal-header__eyebrow">INSPECTION LOGS</p>
            <h2 class="modal-header__title" id="nightPatrolModalTitle">
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
            src="${deferInitialFrameLoad ? "about:blank" : PAGE_URL}"
            loading="${deferInitialFrameLoad ? "lazy" : "eager"}"
            allow="fullscreen"
            allowfullscreen
          ></iframe>
        </div>
      </section>
    `;

    document.body.appendChild(modal);

    const frame = getFrame();

    frame?.addEventListener("load", () => {
      frame.dataset.inspectionLoaded = "true";
    });

    document
      .getElementById("closeNightPatrolButton")
      ?.addEventListener("click", closeInspectionLogModal);

    modal.addEventListener("click", event => {
      if (event.target === modal) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    return true;
  }

  function createRoleTodayModal() {
    if (getRoleModal()) {
      return true;
    }

    const modal = document.createElement("div");
    modal.id = ROLE_MODAL_ID;
    modal.className = "modal-backdrop inspection-role-today-modal";
    modal.setAttribute("aria-hidden", "true");

    modal.innerHTML = `
      <section
        class="inspection-role-today-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspectionRoleTodayTitle"
      >
        <header class="inspection-role-today-header">
          <div>
            <p>TODAY'S INSPECTION</p>
            <h2 id="inspectionRoleTodayTitle">오늘 점검</h2>
            <span id="inspectionRoleTodayContext"></span>
          </div>

          <button
            type="button"
            class="inspection-role-today-close"
            id="inspectionRoleTodayCloseButton"
            aria-label="오늘 점검 닫기"
          >
            ×
          </button>
        </header>

        <div class="inspection-role-today-summary" id="inspectionRoleTodaySummary">
        </div>

        <div class="inspection-role-today-list" id="inspectionRoleTodayList">
        </div>

        <footer class="inspection-role-today-footer">
          <button
            type="button"
            class="inspection-role-today-all-button"
            id="inspectionRoleTodayAllButton"
          >
            점검일지 전체 보기
          </button>

          <button
            type="button"
            class="inspection-role-today-done-button"
            id="inspectionRoleTodayDoneButton"
          >
            닫기
          </button>
        </footer>
      </section>
    `;

    document.body.appendChild(modal);

    document
      .getElementById("inspectionRoleTodayCloseButton")
      ?.addEventListener("click", closeRoleTodayModal);

    document
      .getElementById("inspectionRoleTodayDoneButton")
      ?.addEventListener("click", closeRoleTodayModal);

    document
      .getElementById("inspectionRoleTodayAllButton")
      ?.addEventListener("click", () => {
        closeRoleTodayModal();
        openInspectionLogModal();
      });

    modal.addEventListener("click", event => {
      if (event.target === modal) {
        closeRoleTodayModal();
      }
    });

    modal.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target : null;
      const openButton = target?.closest(
        "[data-open-role-inspection-schedule]"
      );

      if (!openButton) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const scheduleId = String(
        openButton.dataset.openRoleInspectionSchedule || ""
      ).trim();

      if (!scheduleId) {
        return;
      }

      closeRoleTodayModal();
      openInspectionSchedule(scheduleId);
    });

    return true;
  }

  function findDirectChild(element, predicate) {
    return [...element.children].find(predicate) || null;
  }

  function ensureRoleTopActions(roleWrap) {
    let actions = findDirectChild(roleWrap, child => {
      return child.classList.contains("role-card-top-actions");
    });

    if (!actions) {
      actions = document.createElement("div");
      actions.className = "role-card-top-actions";
      roleWrap.insertBefore(actions, roleWrap.firstElementChild);
    }

    const directNoticeControl = findDirectChild(roleWrap, child => {
      return (
        child.matches("[data-role-notice-button]") ||
        child.classList.contains("role-notice-placeholder")
      );
    });

    if (directNoticeControl) {
      actions.appendChild(directNoticeControl);
    }

    let todayButton = actions.querySelector(
      ":scope > [data-role-today-inspection]"
    );

    if (!todayButton) {
      const role = normalizeRole(roleWrap.dataset.roleCardWrap);

      todayButton = document.createElement("button");
      todayButton.type = "button";
      todayButton.className = "role-today-inspection-button";
      todayButton.dataset.roleTodayInspection = role;
      todayButton.hidden = true;
      todayButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openRoleTodayModal(role);
      });

      actions.appendChild(todayButton);
    }

    return todayButton;
  }

  function queueRoleButtonRender() {
    if (renderQueued) {
      return;
    }

    renderQueued = true;

    window.requestAnimationFrame(() => {
      renderQueued = false;
      renderRoleInspectionButtons();
    });
  }

  function getRoleSummary(role) {
    return roleTodaySummary.roles.find(item => {
      return normalizeRole(item?.role) === role;
    }) || null;
  }

  function renderRoleInspectionButtons() {
    if (!canCurrentUserUseInspectionLogs()) {
      return;
    }

    const roleWraps = [
      ...document.querySelectorAll("[data-role-card-wrap]")
    ];

    roleWraps.forEach(roleWrap => {
      const role = normalizeRole(roleWrap.dataset.roleCardWrap);
      const button = ensureRoleTopActions(roleWrap);
      const summary = getRoleSummary(role);
      const totalCount = Number(summary?.totalCount || 0);
      const completedCount = Number(summary?.completedCount || 0);
      const pendingCount = Math.max(
        0,
        Number(summary?.pendingCount ?? totalCount - completedCount)
      );

      button.classList.remove(
        "is-pending",
        "is-partial",
        "is-complete"
      );

      if (
        roleTodaySummary.available !== true ||
        !summary ||
        totalCount < 1
      ) {
        if (button.dataset.renderKey !== "hidden") {
          button.hidden = true;
          button.textContent = "";
          button.removeAttribute("aria-label");
          button.dataset.renderKey = "hidden";
        }

        return;
      }

      let labelHtml = "";
      let ariaLabel = "";
      let stateKey = "pending";

      if (completedCount >= totalCount) {
        stateKey = "complete";
        button.classList.add("is-complete");
        labelHtml = `
          <span class="role-today-inspection-button__prefix">오늘 </span>
          <span>점검</span>
          <b>✓</b>
        `;
        ariaLabel = `${role} 오늘 점검 ${totalCount}건 모두 완료`;
      } else if (completedCount > 0) {
        stateKey = "partial";
        button.classList.add("is-partial");
        labelHtml = `
          <span class="role-today-inspection-button__prefix">오늘 </span>
          <span>점검</span>
          <b>${completedCount}/${totalCount}</b>
        `;
        ariaLabel = `${role} 오늘 점검 ${totalCount}건 중 ${completedCount}건 완료`;
      } else {
        stateKey = "pending";
        button.classList.add("is-pending");
        labelHtml = `
          <span class="role-today-inspection-button__prefix">오늘 </span>
          <span>점검</span>
          <b>${pendingCount}</b>
        `;
        ariaLabel = `${role} 오늘 미완료 점검 ${pendingCount}건`;
      }

      const renderKey = [
        stateKey,
        completedCount,
        pendingCount,
        totalCount,
        roleTodaySummary.workDate,
        roleTodaySummary.shift
      ].join("|");

      if (button.dataset.renderKey !== renderKey) {
        button.innerHTML = labelHtml;
        button.dataset.renderKey = renderKey;
      }

      button.hidden = false;
      button.setAttribute("aria-label", ariaLabel);
      button.title = ariaLabel;
    });
  }

  function formatCompletedAt(value) {
    const date = new Date(value || 0);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function createRoleInspectionItemHtml(item) {
    const completed = item.completed === true;
    const conditional = item.conditional === true;
    const stateClass = completed
      ? "is-complete"
      : conditional
        ? "is-conditional"
        : "is-pending";
    const stateLabel = completed
      ? "완료"
      : conditional
        ? "조건 확인"
        : "미완료";
    const completedAt = formatCompletedAt(item.completedAt);

    return `
      <article class="inspection-role-today-item ${stateClass}">
        <span class="inspection-role-today-item__mark" aria-hidden="true">
          ${completed ? "✓" : conditional ? "?" : "!"}
        </span>

        <div class="inspection-role-today-item__content">
          <div class="inspection-role-today-item__badges">
            <span>${escapeHtml(stateLabel)}</span>
            <em>${escapeHtml(item.categoryLabel || "점검")}</em>
          </div>

          <strong>${escapeHtml(item.title || "점검 일정")}</strong>

          <span class="inspection-role-today-item__meta">
            ${escapeHtml(item.shiftLabel || roleTodaySummary.shiftLabel || "")}
            ${item.position ? ` · ${escapeHtml(item.position)}` : ""}
            ${item.scheduleLabel ? ` · ${escapeHtml(item.scheduleLabel)}` : ""}
          </span>

          ${item.note ? `
            <small>${escapeHtml(item.note)}</small>
          ` : ""}

          ${completed && item.completedByName ? `
            <small class="is-completion">
              ${escapeHtml(item.completedByName)} 완료
              ${completedAt ? ` · ${escapeHtml(completedAt)}` : ""}
            </small>
          ` : ""}
        </div>

        <div class="inspection-role-today-item__actions">
          ${item.canOpenLog ? `
            <button
              type="button"
              data-open-role-inspection-schedule="${escapeHtml(item.scheduleId)}"
            >
              점검일지 열기
            </button>
          ` : ""}
        </div>
      </article>
    `;
  }

  function openRoleTodayModal(roleValue) {
    const role = normalizeRole(roleValue);
    const summary = getRoleSummary(role);

    if (
      roleTodaySummary.available !== true ||
      !summary ||
      Number(summary.totalCount || 0) < 1
    ) {
      return;
    }

    createRoleTodayModal();

    const modal = getRoleModal();
    const titleElement = document.getElementById("inspectionRoleTodayTitle");
    const contextElement = document.getElementById("inspectionRoleTodayContext");
    const summaryElement = document.getElementById("inspectionRoleTodaySummary");
    const listElement = document.getElementById("inspectionRoleTodayList");

    const totalCount = Number(summary.totalCount || 0);
    const completedCount = Number(summary.completedCount || 0);
    const pendingCount = Math.max(0, totalCount - completedCount);

    if (titleElement) {
      titleElement.textContent = `${role} 오늘 점검`;
    }

    if (contextElement) {
      contextElement.textContent = [
        roleTodaySummary.workDate,
        roleTodaySummary.shiftLabel
      ].filter(Boolean).join(" · ");
    }

    if (summaryElement) {
      summaryElement.innerHTML = `
        <span>전체 <b>${totalCount}</b>건</span>
        <span>완료 <b>${completedCount}</b>건</span>
        <span>미완료 <b>${pendingCount}</b>건</span>
      `;
    }

    if (listElement) {
      listElement.innerHTML = Array.isArray(summary.items) && summary.items.length
        ? summary.items.map(createRoleInspectionItemHtml).join("")
        : `
            <div class="inspection-role-today-empty">
              오늘 예정된 점검이 없습니다.
            </div>
          `;
    }

    modal?.classList.add("is-open");
    modal?.setAttribute("aria-hidden", "false");
    syncBodyModalState();

    window.setTimeout(() => {
      document.getElementById("inspectionRoleTodayCloseButton")?.focus();
    }, 0);
  }

  function postOpenScheduleMessage(scheduleId) {
    const frame = getFrame();

    frame?.contentWindow?.postMessage(
      {
        type: "gs-shift-log:open-inspection-schedule",
        scheduleId
      },
      window.location.origin
    );
  }

  function openInspectionSchedule(scheduleId) {
    createInspectionLogModal();

    const frame = getFrame();

    if (!frame) {
      return;
    }

    if (frame.getAttribute("src") !== PAGE_URL) {
      frame.dataset.inspectionLoaded = "false";
      frame.setAttribute("src", PAGE_URL);
    }

    if (frame.dataset.inspectionLoaded === "true") {
      openInspectionLogModal();
      window.setTimeout(() => {
        postOpenScheduleMessage(scheduleId);
      }, 50);
      return;
    }

    frame.addEventListener(
      "load",
      () => {
        postOpenScheduleMessage(scheduleId);
      },
      { once: true }
    );

    openInspectionLogModal();
  }

  function normalizeRoleTodaySummary(rawData) {
    const rawRoles = Array.isArray(rawData?.roles) ? rawData.roles : [];

    const roles = ROLE_ORDER.map(role => {
      const rawRole = rawRoles.find(item => {
        return normalizeRole(item?.role) === role;
      }) || {};

      const items = (Array.isArray(rawRole.items) ? rawRole.items : [])
        .map(item => {
          const category = String(item?.category || "other").trim();
          const categoryLabels = {
            daily: "일일",
            weekly: "주간",
            monthly: "월간",
            quarterly: "분기",
            other: "기타"
          };

          return {
            scheduleId: String(item?.scheduleId || "").trim(),
            title: String(item?.title || "점검 일정").trim(),
            category,
            categoryLabel: categoryLabels[category] || "기타",
            scheduleLabel: String(item?.scheduleLabel || "").trim(),
            dueDate: String(item?.dueDate || "").trim(),
            shift: String(item?.shift || "").trim(),
            shiftLabel: String(item?.shiftLabel || "").trim(),
            position: String(item?.position || "").trim(),
            note: String(item?.note || "").trim(),
            conditional: item?.conditional === true,
            completed: item?.completed === true,
            completedByName: String(item?.completedByName || "").trim(),
            completedAt: String(item?.completedAt || "").trim(),
            canOpenLog: item?.canOpenLog === true
          };
        })
        .filter(item => item.scheduleId && item.title);

      const completedCount = items.filter(item => item.completed).length;

      return {
        role,
        totalCount: items.length,
        completedCount,
        pendingCount: items.length - completedCount,
        items
      };
    });

    return {
      available: rawData?.available === true,
      workDate: String(rawData?.workDate || "").trim(),
      shift: String(rawData?.shift || "").trim(),
      shiftLabel: String(rawData?.shiftLabel || "").trim(),
      errorMessage: String(rawData?.errorMessage || "").trim(),
      roles
    };
  }

  function handleInspectionLauncherMessage(event) {
    if (event.origin !== window.location.origin) {
      return;
    }

    const frame = getFrame();

    if (!frame?.contentWindow || event.source !== frame.contentWindow) {
      return;
    }

    const messageType = String(event.data?.type || "").trim();

    if (messageType === "gs-night-patrol:close") {
      closeInspectionLogModal();
      return;
    }

    if (messageType === "gs-shift-log:inspection-role-today-summary") {
      roleTodaySummary = normalizeRoleTodaySummary(event.data);
      queueRoleButtonRender();
      return;
    }

    if (messageType === "gs-shift-log:inspection-view-mode") {
      getMainModal()?.classList.toggle(
        "is-inspection-expanded",
        event.data?.expanded === true
      );
    }
  }

  function unwrapRoleTopActions() {
    document.querySelectorAll(".role-card-top-actions").forEach(actions => {
      const roleWrap = actions.parentElement;

      if (!roleWrap) {
        actions.remove();
        return;
      }

      const noticeControl = [...actions.children].find(child => {
        return (
          child.matches("[data-role-notice-button]") ||
          child.classList.contains("role-notice-placeholder")
        );
      });

      if (noticeControl) {
        roleWrap.insertBefore(noticeControl, actions);
      }

      actions.remove();
    });
  }

  function removeInspectionLogElements() {
    closeRoleTodayModal();
    closeInspectionLogModal();

    document.getElementById(BUTTON_ID)?.remove();
    document.getElementById(MOBILE_MENU_ID)?.remove();
    getMainModal()?.remove();
    getRoleModal()?.remove();
    unwrapRoleTopActions();

    roleTodaySummary = {
      available: false,
      workDate: "",
      shift: "",
      shiftLabel: "",
      errorMessage: "",
      roles: []
    };
  }

  function observeLoginState() {
    const appShell = document.getElementById("appShell");

    if (!appShell || appShell.dataset.inspectionAccessObserved === "true") {
      return;
    }

    appShell.dataset.inspectionAccessObserved = "true";

    const observer = new MutationObserver(syncInspectionLogAccess);
    observer.observe(appShell, {
      attributes: true,
      attributeFilter: ["hidden"]
    });
  }

  function observeShiftMemberGrid() {
    const grid = document.getElementById("shiftMemberGrid");

    if (!grid) {
      return;
    }

    if (
      shiftMemberObserver &&
      observedShiftMemberGrid === grid
    ) {
      return;
    }

    shiftMemberObserver?.disconnect();
    shiftMemberObserver = new MutationObserver(queueRoleButtonRender);
    observedShiftMemberGrid = grid;

    shiftMemberObserver.observe(grid, {
      childList: true,
      subtree: true
    });
  }

  function syncInspectionLogAccess() {
    if (!canCurrentUserUseInspectionLogs()) {
      removeInspectionLogElements();
      return false;
    }

    const menuReady = createMenuButton();
    const modalReady = createInspectionLogModal();
    const roleModalReady = createRoleTodayModal();

    observeShiftMemberGrid();
    queueRoleButtonRender();

    return menuReady && modalReady && roleModalReady;
  }

  function scheduleInstall() {
    syncInspectionLogAccess();
    observeLoginState();


    /*
      PC ↔ 모바일 폭 변경 시
      점검일지 상단 버튼을 즉시 추가/제거한다.
    */
    if (
      window
        .__gsInspectionHeaderMediaBound !==
      true
    ) {
      const handleHeaderMediaChange =
        () => {
          syncInspectionLogAccess();
        };


      if (
        typeof MOBILE_HEADER_MEDIA
          .addEventListener ===
        "function"
      ) {
        MOBILE_HEADER_MEDIA
          .addEventListener(
            "change",
            handleHeaderMediaChange
          );

      } else if (
        typeof MOBILE_HEADER_MEDIA
          .addListener ===
        "function"
      ) {
        MOBILE_HEADER_MEDIA
          .addListener(
            handleHeaderMediaChange
          );
      }


      window
        .__gsInspectionHeaderMediaBound =
        true;
    }


    if (window.__gsInspectionScheduleMessageBound !== true) {
      window.addEventListener("message", handleInspectionLauncherMessage);
      window.__gsInspectionScheduleMessageBound = true;
    }


    if (mobileMenuLazyV15) {
      return;
    }


    let attempts = 0;

    const timer =
      window.setInterval(
        () => {
          attempts += 1;

          syncInspectionLogAccess();

          if (attempts >= 40) {
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
      if (event.key !== "Escape") {
        return;
      }

      const mobileDropdown =
        document.getElementById(
          MOBILE_MENU_DROPDOWN_ID
        );

      if (
        mobileDropdown &&
        !mobileDropdown.hidden
      ) {
        event.preventDefault();
        event.stopPropagation();
        closeMobileInspectionMenu();
        return;
      }

      if (getRoleModal()?.classList.contains("is-open")) {
        event.preventDefault();
        event.stopPropagation();
        closeRoleTodayModal();
        return;
      }

      if (getMainModal()?.classList.contains("is-open")) {
        event.preventDefault();
        event.stopPropagation();
        closeInspectionLogModal();
      }
    },
    true
  );

  window.addEventListener("storage", event => {
    if (event.key === AUTH_STORAGE_KEY) {
      syncInspectionLogAccess();
    }
  });

  window.addEventListener("focus", syncInspectionLogAccess);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleInstall, {
      once: true
    });
  } else {
    scheduleInstall();
  }
})();

/* =========================================================
  [HEADER-VACATION-REPLACEMENT-MENU-V1]

  운전파트 휴가·대근 관리

  PC / 모바일 공통 햄버거 메뉴에서
  보이소 다음, 모바일 점검일지 또는 관리자 앞에 표시한다.
========================================================= */

(() => {

  const VACATION_REPLACEMENT_ITEM_ID =
    "vacationReplacementHeaderButton";

  const VACATION_REPLACEMENT_URL =
    "https://gs-vacation-gateway.wheekeun-lee.workers.dev/__sso";

  const VACATION_REPLACEMENT_WINDOW_NAME =
    "_blank";


  function closeVacationReplacementHeaderMenu() {

    const dropdown =
      document.getElementById(
        "headerMoreDropdown"
      );

    const toggle =
      document.getElementById(
        "headerMoreButton"
      );


    if (dropdown) {
      dropdown.hidden = true;
    }


    if (toggle) {

      toggle.setAttribute(
        "aria-expanded",
        "false"
      );
    }
  }


  /* =========================================================
    [VACATION-GATEWAY-SSO-V1]

    GS Shift Log 로그인 세션을
    Vacation Gateway로 안전하게 전달한다.

    PIN은 브라우저에 저장하지 않는다.
  ========================================================= */

  function getVacationReplacementSessionToken() {

    if (
      typeof getShiftLogSessionToken ===
      "function"
    ) {

      return String(
        getShiftLogSessionToken() ||
        ""
      ).trim();
    }


    try {

      const savedUser =
        JSON.parse(
          window.localStorage.getItem(
            "gsShiftLog.currentUser"
          ) ||
          "null"
        );


      return String(
        savedUser?.sessionToken ||
        savedUser?.session_token ||
        ""
      ).trim();

    } catch (error) {

      return "";
    }
  }


  function showVacationReplacementMessage(
    message
  ) {

    if (
      typeof showToast ===
      "function"
    ) {

      showToast(
        message
      );

      return;
    }


    window.alert(
      message
    );
  }


  function openVacationReplacementManagement() {

    closeVacationReplacementHeaderMenu();


    const sessionToken =
      getVacationReplacementSessionToken();


    if (!sessionToken) {

      showVacationReplacementMessage(
        "업무일지 로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요."
      );

      return;
    }


    const gatewayOrigin =
      new URL(
        VACATION_REPLACEMENT_URL
      ).origin;


    const targetWindow =
      window.open(
        VACATION_REPLACEMENT_URL,
        VACATION_REPLACEMENT_WINDOW_NAME
      );


    if (!targetWindow) {

      showVacationReplacementMessage(
        "휴가·대근 관리 창이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요."
      );

      return;
    }


    let authenticationSent =
      false;

    let timeoutId =
      0;


    const cleanup =
      () => {

        window.removeEventListener(
          "message",
          handleGatewayMessage
        );


        if (timeoutId) {

          window.clearTimeout(
            timeoutId
          );

          timeoutId =
            0;
        }
      };


    const handleGatewayMessage =
      event => {

        if (
          event.origin !==
            gatewayOrigin ||
          event.source !==
            targetWindow
        ) {
          return;
        }


        const message =
          event.data;


        if (
          !message ||
          message.type !==
            "GS_VACATION_READY" ||
          authenticationSent
        ) {
          return;
        }


        authenticationSent =
          true;


        try {

          targetWindow.postMessage(
            {
              type:
                "GS_VACATION_AUTH",

              sessionToken
            },
            gatewayOrigin
          );


          cleanup();

        } catch (error) {

          console.error(
            "휴가·대근 Gateway 인증 전달 실패:",
            error
          );


          cleanup();


          showVacationReplacementMessage(
            "휴가·대근 관리 자동 로그인 연결에 실패했습니다."
          );
        }
      };


    window.addEventListener(
      "message",
      handleGatewayMessage
    );


    timeoutId =
      window.setTimeout(
        () => {

          cleanup();


          if (
            !authenticationSent &&
            !targetWindow.closed
          ) {

            showVacationReplacementMessage(
              "휴가·대근 관리 서버 연결 시간이 초과되었습니다. 다시 시도해 주세요."
            );
          }

        },
        12000
      );


    try {

      targetWindow.focus();

    } catch (error) {

      console.warn(
        "휴가·대근 관리 창 포커스 처리 실패:",
        error
      );
    }
  }


  function ensureVacationReplacementHeaderItem() {

    const dropdown =
      document.getElementById(
        "headerMoreDropdown"
      );


    if (!dropdown) {
      return false;
    }


    let item =
      document.getElementById(
        VACATION_REPLACEMENT_ITEM_ID
      );


    if (!item) {

      item =
        document.createElement(
          "button"
        );

      item.id =
        VACATION_REPLACEMENT_ITEM_ID;

      item.type =
        "button";

      item.innerHTML = `
        <span class="header-more-item__label">휴가·대근 관리</span>
        <span
          class="header-menu-kind-badge header-menu-kind-badge--connected"
          aria-hidden="true"
        >연결</span>
      `;
    }


    item.className =
      "header-more-item";

    item.setAttribute(
      "role",
      "menuitem"
    );

    item.setAttribute(
      "aria-label",
      "다른 제작자가 만든 연결 사이트, 운전파트 휴가·대근 관리 열기"
    );

    item.title =
      "운전파트 휴가·대근 관리";


    if (
      item.dataset
        .vacationReplacementBound !==
      "true"
    ) {

      item.dataset
        .vacationReplacementBound =
        "true";


      item.addEventListener(
        "click",
        event => {

          event.preventDefault();
          event.stopPropagation();

          openVacationReplacementManagement();
        }
      );
    }


    const mobileInspectionItem =
      document.getElementById(
        "mobileHeaderInspectionItem"
      );

    const adminButton =
      document.getElementById(
        "adminButton"
      );


    /*
      공통 메뉴의 마지막 항목으로 유지한다.
      모바일 점검일지가 있으면 그 앞, 아니면 관리자 앞이다.
    */
    const referenceElement =
      mobileInspectionItem?.parentElement ===
        dropdown
        ? mobileInspectionItem
        : adminButton?.parentElement ===
            dropdown
          ? adminButton
          : null;


    if (referenceElement) {

      if (
        item.parentElement !==
          dropdown ||
        item.nextElementSibling !==
          referenceElement
      ) {

        dropdown.insertBefore(
          item,
          referenceElement
        );
      }

    } else if (
      item.parentElement !==
      dropdown
    ) {

      dropdown.append(
        item
      );
    }


    /*
      기존 정책대로 관리자는 항상 마지막.
    */

    if (
      adminButton?.parentElement ===
        dropdown &&
      dropdown.lastElementChild !==
        adminButton
    ) {

      dropdown.append(
        adminButton
      );
    }


    return true;
  }


  function initializeVacationReplacementHeaderItem() {

    if (
      ensureVacationReplacementHeaderItem()
    ) {
      return;
    }


    let attemptCount =
      0;


    const retryTimer =
      window.setInterval(
        () => {

          attemptCount +=
            1;


          if (
            ensureVacationReplacementHeaderItem() ||
            attemptCount >= 20
          ) {

            window.clearInterval(
              retryTimer
            );
          }
        },
        250
      );
  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      initializeVacationReplacementHeaderItem,
      {
        once: true
      }
    );

  } else {

    initializeVacationReplacementHeaderItem();
  }

})();
/* =========================================================
  BLOWER_HISTORY_MANAGEMENT_V1

  - 햄버거 메뉴에 Blower 교체 이력 관리 추가
  - 관리자 메뉴는 기존 로직대로 항상 최하단 유지
  - D-7 / D-3 / 초과 경고를 업무일지 메인에도 표시
  - 실제 관리 화면과 D1 API는 독립 파일 사용
========================================================= */

(() => {
  if (window.__blowerHistoryManagementLauncherV1Installed === true) {
    return;
  }

  window.__blowerHistoryManagementLauncherV1Installed = true;

  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";
  const BLOWER_HISTORY_URL = "/maintenance/blower-history.html";
  const BLOWER_HISTORY_API_URL = "/api/blower-history?action=summary";
  const WINDOW_NAME = "GS_BLOWER_HISTORY";

  let hasLoadedSummary = false;
  let pendingRetryTimer = null;

  function getSessionToken() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return "";

      const user = JSON.parse(raw);
      return String(user?.sessionToken || user?.session_token || "").trim();
    } catch {
      return "";
    }
  }

  function openBlowerHistory() {
    if (typeof window.closeHeaderMoreMenu === "function") {
      window.closeHeaderMoreMenu();
    }

    const target = window.open(BLOWER_HISTORY_URL, WINDOW_NAME);

    if (!target) {
      window.location.assign(BLOWER_HISTORY_URL);
      return;
    }

    try {
      target.focus();
    } catch {
      // 창 포커스 실패는 기능에 영향을 주지 않는다.
    }
  }

  function ensureLauncherStyle() {
    if (document.getElementById("blowerHistoryLauncherStyle")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "blowerHistoryLauncherStyle";
    style.textContent = `
      #blowerHistoryHeaderButton {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .blower-history-menu-badge {
        display: inline-flex;
        min-width: 20px;
        height: 20px;
        align-items: center;
        justify-content: center;
        padding: 0 6px;
        border-radius: 999px;
        background: #c63c45;
        color: #fff;
        font-size: 11px;
        font-weight: 800;
      }

      .blower-history-main-alert {
        display: inline-flex;
        align-items: center;
        flex: 0 1 auto;
        gap: 7px;
        width: auto;
        max-width: min(470px, 42vw);
        min-height: 34px;
        margin: 0;
        padding: 0 6px 0 10px;
        border: 1px solid #e6cc78;
        border-radius: 999px;
        background: #fffdf7;
        color: #76570f;
        cursor: pointer;
        text-align: left;
        white-space: nowrap;
      }

      .blower-history-main-alert:hover {
        background: #fff8e3;
      }

      .blower-history-main-alert[hidden] {
        display: none !important;
      }

      .blower-history-main-alert.is-critical,
      .blower-history-main-alert.is-overdue {
        border-color: #e8a7ad;
        background: #fff8f8;
        color: #9f2632;
      }

      .blower-history-main-alert.is-critical:hover,
      .blower-history-main-alert.is-overdue:hover {
        background: #fff0f1;
      }

      .blower-history-main-alert__dot {
        flex: 0 0 auto;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
      }

      .blower-history-main-alert__content {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .blower-history-main-alert__content small,
      .blower-history-main-alert__content strong {
        display: inline-block;
      }

      .blower-history-main-alert__content small {
        flex: 0 0 auto;
        margin: 0;
        font-size: 11px;
        font-weight: 850;
        letter-spacing: -.02em;
      }

      .blower-history-main-alert__content strong {
        min-width: 0;
        max-width: 270px;
        overflow: hidden;
        color: #6a5a32;
        font-size: 10.5px;
        font-weight: 750;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .blower-history-main-alert.is-critical .blower-history-main-alert__content strong,
      .blower-history-main-alert.is-overdue .blower-history-main-alert__content strong {
        color: #7f3b43;
      }

      .blower-history-main-alert__count {
        flex: 0 0 auto;
        min-width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 7px;
        border-radius: 999px;
        background: #a87906;
        color: #fff;
        font-size: 10.5px;
        font-weight: 900;
      }

      .blower-history-main-alert.is-critical .blower-history-main-alert__count,
      .blower-history-main-alert.is-overdue .blower-history-main-alert__count {
        background: #b42331;
        color: #fff;
      }

      @media (min-width: 1151px) {
        #statusView
        .shift-status-section
        > .section-heading {
          position: relative;
        }

        #statusView
        .shift-status-section
        > .section-heading
        > .shift-heading-right.has-blower-history-main-alert {
          padding-top: 40px;
        }

        #statusView
        .shift-status-section
        > .section-heading
        > .shift-heading-right.has-blower-history-main-alert
        > .blower-history-main-alert {
          position: absolute;
          top: 0;
          right: 0;
          z-index: 2;
        }
      }

      @media (max-width: 1100px) {
        .blower-history-main-alert {
          max-width: none;
        }

        .blower-history-main-alert__content strong {
          display: none;
        }
      }

      @media (max-width: 768px) {
        .blower-history-main-alert {
          min-height: 34px;
          padding: 0 5px 0 8px;
        }

        .blower-history-main-alert__content small {
          font-size: 10px;
        }
      }
    `;

    document.head.append(style);
  }

  function ensureMenuItem() {
    const dropdown = document.getElementById("headerMoreDropdown");
    const plannedMaintenanceButton = document.getElementById(
      "plannedMaintenanceHeaderButton"
    );
    const vacationReplacementButton = document.getElementById(
      "vacationReplacementHeaderButton"
    );
    const mobileInspectionButton = document.getElementById(
      "mobileHeaderInspectionItem"
    );
    const adminButton = document.getElementById("adminButton");

    if (!dropdown) {
      return null;
    }

    let button = document.getElementById("blowerHistoryHeaderButton");

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "header-more-item header-more-item--owned";
      button.id = "blowerHistoryHeaderButton";
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", "Blower 교체 이력 관리 열기");
      button.title = "Blower 교체 이력 관리";
      button.innerHTML = `
        <span class="header-more-item__label">Blower 교체이력</span>
        <span class="header-more-item__meta">
          <span
            class="blower-history-menu-badge"
            id="blowerHistoryMenuBadge"
            aria-label="Blower 교체 알림 0건"
            hidden
          >0</span>
        </span>
      `;
    }

    button.classList.add("header-more-item", "header-more-item--owned");
    button.setAttribute("role", "menuitem");
    button.setAttribute(
      "aria-label",
      "직접 제작 메뉴, Blower 교체이력 관리 열기"
    );
    button.title = "Blower 교체이력 관리";

    if (button.dataset.blowerHistoryBound !== "true") {
      button.dataset.blowerHistoryBound = "true";
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openBlowerHistory();
      });
    }

    const referenceButton =
      plannedMaintenanceButton?.parentElement === dropdown
        ? plannedMaintenanceButton
        : vacationReplacementButton?.parentElement === dropdown
          ? vacationReplacementButton
          : mobileInspectionButton?.parentElement === dropdown
            ? mobileInspectionButton
            : adminButton?.parentElement === dropdown
              ? adminButton
              : null;

    if (referenceButton) {
      if (
        button.parentElement !== dropdown ||
        button.nextElementSibling !== referenceButton
      ) {
        dropdown.insertBefore(button, referenceButton);
      }
    } else if (button.parentElement !== dropdown) {
      dropdown.append(button);
    }

    return button;
  }

  function mountMainAlert(alertButton, section) {
    const heading = section.querySelector(":scope > .section-heading");
    const headingRight = heading?.querySelector(":scope > .shift-heading-right");

    if (headingRight) {
      const currentShiftGroup = Array.from(headingRight.children).find(
        child => child.classList?.contains("shift-heading-right")
      );
      headingRight.insertBefore(alertButton, currentShiftGroup || null);
      headingRight.classList.toggle(
        "has-blower-history-main-alert",
        !alertButton.hidden
      );
      return;
    }

    if (heading?.nextSibling) {
      section.insertBefore(alertButton, heading.nextSibling);
    } else if (heading) {
      heading.insertAdjacentElement("afterend", alertButton);
    } else {
      section.prepend(alertButton);
    }
  }

  function setMainAlertVisibility(alertButton, isVisible) {
    alertButton.hidden = !isVisible;

    const headingRight = alertButton.parentElement;

    if (headingRight?.classList.contains("shift-heading-right")) {
      headingRight.classList.toggle(
        "has-blower-history-main-alert",
        isVisible
      );
    }
  }

  function ensureMainAlert() {
    const section = document.querySelector(".shift-status-section");

    if (!section) {
      return null;
    }

    let alertButton = document.getElementById("blowerHistoryMainAlert");

    if (alertButton) {
      mountMainAlert(alertButton, section);
      return alertButton;
    }

    alertButton = document.createElement("button");
    alertButton.type = "button";
    alertButton.className = "blower-history-main-alert";
    alertButton.id = "blowerHistoryMainAlert";
    alertButton.setAttribute("aria-live", "polite");
    alertButton.setAttribute("aria-label", "Blower 교체 알림 확인");
    alertButton.hidden = true;
    alertButton.innerHTML = `
      <span class="blower-history-main-alert__dot" aria-hidden="true"></span>
      <span class="blower-history-main-alert__content">
        <small id="blowerHistoryMainAlertLabel">Blower 교체 알림</small>
        <strong id="blowerHistoryMainAlertText">교체 예정 설비가 있습니다.</strong>
      </span>
      <span class="blower-history-main-alert__count" id="blowerHistoryMainAlertCount">0</span>
    `;

    alertButton.addEventListener("click", openBlowerHistory);
    mountMainAlert(alertButton, section);

    return alertButton;
  }

  function formatRemaining(asset) {
    const remaining = Number(asset?.remainingHours);

    if (!Number.isFinite(remaining)) {
      return "";
    }

    if (remaining <= 0) {
      const hours = Math.abs(remaining);
      const days = Math.floor(hours / 24);
      const rest = Math.floor(hours % 24);
      return `${days}일 ${rest}시간 초과`;
    }

    const days = Math.floor(remaining / 24);
    const hours = Math.floor(remaining % 24);
    return `${days}일 ${hours}시간 남음`;
  }

  function renderSummary(summary) {
    const menuItem = ensureMenuItem();
    const alertButton = ensureMainAlert();
    const badge = document.getElementById("blowerHistoryMenuBadge");
    const alertCount = Math.max(0, Number(summary?.alertCount || 0));

    if (menuItem) {
      menuItem.setAttribute(
        "aria-label",
        alertCount > 0
          ? `직접 제작 메뉴, Blower 교체이력 관리 열기, 알림 ${alertCount}건`
          : "직접 제작 메뉴, Blower 교체이력 관리 열기"
      );
    }

    if (badge) {
      badge.hidden = alertCount === 0;
      badge.textContent = String(alertCount);
      badge.setAttribute(
        "aria-label",
        `Blower 교체 알림 ${alertCount}건`
      );
    }

    if (!alertButton) {
      return;
    }

    if (alertCount === 0) {
      setMainAlertVisibility(alertButton, false);
      alertButton.classList.remove("is-warning", "is-critical", "is-overdue");
      return;
    }

    const strongest = String(summary?.strongestSeverity || "warning");
    const first = Array.isArray(summary?.alerts) ? summary.alerts[0] : null;
    const label = document.getElementById("blowerHistoryMainAlertLabel");
    const text = document.getElementById("blowerHistoryMainAlertText");
    const count = document.getElementById("blowerHistoryMainAlertCount");

    setMainAlertVisibility(alertButton, true);
    alertButton.classList.remove("is-warning", "is-critical", "is-overdue");
    alertButton.classList.add(`is-${strongest}`);

    const labelText = strongest === "overdue"
      ? "Blower 교체 초과"
      : strongest === "critical"
        ? "Blower 교체 임박"
        : "Blower 교체 예정";
    const detailText = first
      ? `${first.displayName} · ${formatRemaining(first)}`
      : `교체 확인이 필요한 Blower ${alertCount}대`;

    if (label) label.textContent = labelText;
    if (text) text.textContent = detailText;

    if (count) {
      count.textContent = String(alertCount);
    }

    const accessibleText = `${labelText}. ${detailText}. 총 ${alertCount}대`;
    alertButton.title = accessibleText;
    alertButton.setAttribute("aria-label", accessibleText);
  }

  async function refreshSummary() {
    const token = getSessionToken();

    if (!token) {
      hasLoadedSummary = false;
      return;
    }

    try {
      const response = await fetch(BLOWER_HISTORY_API_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      if (!response.ok) {
        return;
      }

      const result = await response.json();

      if (result?.ok === false) {
        return;
      }

      hasLoadedSummary = true;
      renderSummary(result);
    } catch (error) {
      console.warn("Blower 교체 알림 조회 실패:", error);
    }
  }

  function initialize() {
    ensureLauncherStyle();
    ensureMenuItem();
    ensureMainAlert();
    refreshSummary();

    pendingRetryTimer = window.setInterval(() => {
      ensureMenuItem();

      if (!hasLoadedSummary && getSessionToken()) {
        refreshSummary();
      }
    }, 5000);

    window.setInterval(refreshSummary, 10 * 60 * 1000);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshSummary();
      }
    });

    window.addEventListener("storage", event => {
      if (event.key === AUTH_STORAGE_KEY) {
        hasLoadedSummary = false;
        refreshSummary();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
