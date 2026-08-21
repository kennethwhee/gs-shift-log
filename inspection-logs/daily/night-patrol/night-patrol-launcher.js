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
    [HEADER-NAVIGATOR-MOBILE]

    Mobile header:
    - hide/remove only the top inspection-log menu button
    - keep inspection modal and role inspection functions available

    PC header:
    - inspection button is placed immediately before Efficiency
  */
  const MOBILE_HEADER_MEDIA =
    window.matchMedia(
      "(max-width: 760px)"
    );

  /*
    [MOBILE-INSPECTION-HAMBURGER]

    Mobile:
    - Navigator / Efficiency remain direct buttons
    - Inspection Logs moves into the hamburger at the far right
  */
  const MOBILE_MENU_ID =
    "mobileHeaderMoreMenu";

  const MOBILE_MENU_BUTTON_ID =
    "mobileHeaderMoreButton";

  const MOBILE_MENU_DROPDOWN_ID =
    "mobileHeaderMoreDropdown";

  const MOBILE_INSPECTION_ITEM_ID =
    "mobileHeaderInspectionItem";
  const ROLE_MODAL_ID = "inspectionRoleTodayModal";
  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";
  const PAGE_URL =
    "inspection-logs/inspection-logs.html?v=20260814-log-sheet1";

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
    const dropdown =
      document.getElementById(
        MOBILE_MENU_DROPDOWN_ID
      );

    const button =
      document.getElementById(
        MOBILE_MENU_BUTTON_ID
      );

    if (dropdown) {
      dropdown.hidden = true;
    }

    if (button) {
      button.setAttribute(
        "aria-expanded",
        "false"
      );
    }
  }


  function createMobileInspectionMenu(
    headerActions
  ) {
    let menu =
      document.getElementById(
        MOBILE_MENU_ID
      );

    if (menu) {
      headerActions.append(menu);
      return true;
    }

    menu =
      document.createElement(
        "div"
      );

    menu.id =
      MOBILE_MENU_ID;

    menu.className =
      "mobile-header-more-menu";

    menu.innerHTML = `
      <button
        type="button"
        class="header-action mobile-header-more-button"
        id="${MOBILE_MENU_BUTTON_ID}"
        aria-label="더보기 메뉴 열기"
        aria-haspopup="menu"
        aria-expanded="false"
        title="더보기"
      >
        <span aria-hidden="true">☰</span>
      </button>

      <div
        class="mobile-header-more-dropdown"
        id="${MOBILE_MENU_DROPDOWN_ID}"
        role="menu"
        aria-label="모바일 더보기 메뉴"
        hidden
      >
        <button
          type="button"
          class="mobile-header-more-item"
          id="${MOBILE_INSPECTION_ITEM_ID}"
          role="menuitem"
        >
          점검일지
        </button>
      </div>
    `;

    headerActions.append(menu);

    const menuButton =
      document.getElementById(
        MOBILE_MENU_BUTTON_ID
      );

    const dropdown =
      document.getElementById(
        MOBILE_MENU_DROPDOWN_ID
      );

    const inspectionItem =
      document.getElementById(
        MOBILE_INSPECTION_ITEM_ID
      );

    menuButton?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        const nextOpen =
          Boolean(
            dropdown?.hidden
          );

        if (dropdown) {
          dropdown.hidden =
            !nextOpen;
        }

        menuButton.setAttribute(
          "aria-expanded",
          nextOpen
            ? "true"
            : "false"
        );
      }
    );

    inspectionItem?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        closeMobileInspectionMenu();
        openInspectionLogModal();
      }
    );

    if (
      window
        .__gsInspectionMobileMenuOutsideBound !==
      true
    ) {
      document.addEventListener(
        "click",
        event => {
          const currentMenu =
            document.getElementById(
              MOBILE_MENU_ID
            );

          if (
            !currentMenu ||
            currentMenu.contains(
              event.target
            )
          ) {
            return;
          }

          closeMobileInspectionMenu();
        }
      );

      window
        .__gsInspectionMobileMenuOutsideBound =
        true;
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

      if (existingFrame && existingFrame.getAttribute("src") !== PAGE_URL) {
        existingFrame.dataset.inspectionLoaded = "false";
        existingFrame.setAttribute("src", PAGE_URL);
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
            src="${PAGE_URL}"
            loading="eager"
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
