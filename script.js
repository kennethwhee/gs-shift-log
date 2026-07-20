"use strict";

/* =========================================================
   GS SHIFT LOG
   Frontend Base Controller
========================================================= */


/* =========================================================
   기본 설정
========================================================= */

const APP_CONFIG = {
  appName: "GS Shift Log",
  version: "0.1.0",

  navigatorBaseUrl:
    "https://gs-facility-navigator-2mg.pages.dev/",

  draftStorageKey:
    "gsShiftLogDraftV1",

  workEntryTypes: {
    TM_ISSUE: {
      label: "TM 발행",
      group: "TM",
      status: "ISSUED"
    },

    TM_WORK: {
      label: "TM 작업",
      group: "TM",
      status: "WORKING"
    },

    TM_CLOSE: {
      label: "TM 종결",
      group: "TM",
      status: "CLOSED"
    },

    BM_ISSUE: {
      label: "BM 발행",
      group: "BM",
      status: "ISSUED"
    },

    BM_CLOSE: {
      label: "BM 종결",
      group: "BM",
      status: "CLOSED"
    },

    CM_ISSUE: {
      label: "CM 발행",
      group: "CM",
      status: "ISSUED"
    },

    HANDOVER: {
      label: "인계사항",
      group: "HANDOVER",
      status: "OPEN"
    },

    NOTE: {
      label: "비고",
      group: "NOTE",
      status: "OPEN"
    }
  }
};


/* =========================================================
   앱 상태
========================================================= */

const appState = {
  currentView: "dashboard",

  currentUser: {
    id: null,
    employeeNo: "",
    name: "이휘근",
    role: "super_admin",
    roleLabel: "최고관리자",
    team: "2파트",
    position: "TO"
  },

  draft: {
    id: null,
    date: "",
    shift: "",
    team: "",
    position: "",
    author: "",
    operationEntries: [],
    workEntries: [],
    attachments: [],
    updatedAt: null
  },

  confirmAction: null,

  bulkPastePreview: []
};


/* =========================================================
   DOM 요소
========================================================= */

const elements = {};


/* =========================================================
   초기 실행
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  initializeApp
);


function initializeApp() {
  cacheElements();
  bindEvents();

  updateHeaderDate();
  applyCurrentUser();
  setInitialLogFormValues();

  loadDraftFromStorage();
  renderOperationEntries();
  renderWorkEntries();
  renderAttachments();

  openViewFromHash();
}


/* =========================================================
   DOM 캐시
========================================================= */

function cacheElements() {
  elements.appSidebar =
    document.getElementById("appSidebar");

  elements.sidebarBackdrop =
    document.getElementById("sidebarBackdrop");

  elements.sidebarOpenButton =
    document.getElementById("sidebarOpenButton");

  elements.sidebarCloseButton =
    document.getElementById("sidebarCloseButton");

  elements.currentPageTitle =
    document.getElementById("currentPageTitle");

  elements.headerCurrentDate =
    document.getElementById("headerCurrentDate");

  elements.headerCurrentShift =
    document.getElementById("headerCurrentShift");

  elements.headerUserAvatar =
    document.getElementById("headerUserAvatar");

  elements.headerUserName =
    document.getElementById("headerUserName");

  elements.headerUserRole =
    document.getElementById("headerUserRole");

  elements.userMenuButton =
    document.getElementById("userMenuButton");

  elements.userDropdown =
    document.getElementById("userDropdown");

  elements.dailyLogForm =
    document.getElementById("dailyLogForm");

  elements.logDate =
    document.getElementById("logDate");

  elements.logShift =
    document.getElementById("logShift");

  elements.logTeam =
    document.getElementById("logTeam");

  elements.logPosition =
    document.getElementById("logPosition");

  elements.logAuthor =
    document.getElementById("logAuthor");

  elements.operationEntryList =
    document.getElementById("operationEntryList");

  elements.addOperationEntryButton =
    document.getElementById("addOperationEntryButton");

  elements.workEntryTime =
    document.getElementById("workEntryTime");

  elements.workEntryType =
    document.getElementById("workEntryType");

  elements.workEntryTag =
    document.getElementById("workEntryTag");

  elements.workEntryContent =
    document.getElementById("workEntryContent");

  elements.setCurrentTimeButton =
    document.getElementById("setCurrentTimeButton");

  elements.searchNavigatorTagButton =
    document.getElementById("searchNavigatorTagButton");

  elements.addWorkEntryButton =
    document.getElementById("addWorkEntryButton");

  elements.workEntryList =
    document.getElementById("workEntryList");

  elements.autosaveStatus =
    document.getElementById("autosaveStatus");

  elements.loadPreviousLogButton =
    document.getElementById("loadPreviousLogButton");

  elements.copyLogButton =
    document.getElementById("copyLogButton");

  elements.printLogButton =
    document.getElementById("printLogButton");

  elements.saveDraftButton =
    document.getElementById("saveDraftButton");

  elements.saveLogButton =
    document.getElementById("saveLogButton");

  elements.requestApprovalButton =
    document.getElementById("requestApprovalButton");

  elements.deleteDraftButton =
    document.getElementById("deleteDraftButton");

  elements.bulkPasteInput =
    document.getElementById("bulkPasteInput");

  elements.previewBulkPasteButton =
    document.getElementById("previewBulkPasteButton");

  elements.clearBulkPasteButton =
    document.getElementById("clearBulkPasteButton");

  elements.bulkPastePreviewList =
    document.getElementById("bulkPastePreviewList");

  elements.applyBulkPasteButton =
    document.getElementById("applyBulkPasteButton");

  elements.attachmentInput =
    document.getElementById("attachmentInput");

  elements.attachmentDropzone =
    document.getElementById("attachmentDropzone");

  elements.attachmentList =
    document.getElementById("attachmentList");

  elements.previousLogModal =
    document.getElementById("previousLogModal");

  elements.bulkPasteModal =
    document.getElementById("bulkPasteModal");

  elements.confirmModal =
    document.getElementById("confirmModal");

  elements.confirmModalTitle =
    document.getElementById("confirmModalTitle");

  elements.confirmModalMessage =
    document.getElementById("confirmModalMessage");

  elements.confirmModalConfirmButton =
    document.getElementById(
      "confirmModalConfirmButton"
    );

  elements.toastContainer =
    document.getElementById("toastContainer");
}


/* =========================================================
   이벤트 연결
========================================================= */

function bindEvents() {
  document.addEventListener(
    "click",
    handleDocumentClick
  );

  window.addEventListener(
    "hashchange",
    openViewFromHash
  );

  window.addEventListener(
    "beforeunload",
    handleBeforeUnload
  );

  elements.sidebarOpenButton?.addEventListener(
    "click",
    openSidebar
  );

  elements.sidebarCloseButton?.addEventListener(
    "click",
    closeSidebar
  );

  elements.sidebarBackdrop?.addEventListener(
    "click",
    closeSidebar
  );

  elements.userMenuButton?.addEventListener(
    "click",
    toggleUserDropdown
  );

  elements.addOperationEntryButton?.addEventListener(
    "click",
    addOperationEntry
  );

  elements.setCurrentTimeButton?.addEventListener(
    "click",
    setCurrentWorkEntryTime
  );

  elements.searchNavigatorTagButton?.addEventListener(
    "click",
    openNavigatorFromComposer
  );

  elements.addWorkEntryButton?.addEventListener(
    "click",
    addWorkEntry
  );

  elements.dailyLogForm?.addEventListener(
    "input",
    handleFormInput
  );

  elements.dailyLogForm?.addEventListener(
    "change",
    handleFormInput
  );

  elements.dailyLogForm?.addEventListener(
    "submit",
    handleDailyLogSubmit
  );

  elements.saveDraftButton?.addEventListener(
    "click",
    saveDraftManually
  );

  elements.copyLogButton?.addEventListener(
    "click",
    copyReportText
  );

  elements.printLogButton?.addEventListener(
    "click",
    printCurrentLog
  );

  elements.loadPreviousLogButton?.addEventListener(
    "click",
    () => openModal("previousLogModal")
  );

  elements.requestApprovalButton?.addEventListener(
    "click",
    requestApproval
  );

  elements.deleteDraftButton?.addEventListener(
    "click",
    confirmDeleteDraft
  );

  elements.previewBulkPasteButton?.addEventListener(
    "click",
    previewBulkPaste
  );

  elements.clearBulkPasteButton?.addEventListener(
    "click",
    clearBulkPasteInput
  );

  elements.applyBulkPasteButton?.addEventListener(
    "click",
    applyBulkPasteEntries
  );

  elements.attachmentInput?.addEventListener(
    "change",
    handleAttachmentSelection
  );

  elements.attachmentDropzone?.addEventListener(
    "dragover",
    handleAttachmentDragOver
  );

  elements.attachmentDropzone?.addEventListener(
    "dragleave",
    handleAttachmentDragLeave
  );

  elements.attachmentDropzone?.addEventListener(
    "drop",
    handleAttachmentDrop
  );

  elements.confirmModalConfirmButton?.addEventListener(
    "click",
    executeConfirmAction
  );
}


/* =========================================================
   공통 클릭 처리
========================================================= */

function handleDocumentClick(event) {
  const viewButton =
    event.target.closest("[data-view-target]");

  if (viewButton) {
    const targetView =
      viewButton.dataset.viewTarget;

    navigateToView(targetView);
    return;
  }

  const modalCloseButton =
    event.target.closest("[data-modal-close]");

  if (modalCloseButton) {
    closeModal(
      modalCloseButton.dataset.modalClose
    );
    return;
  }

  const operationDeleteButton =
    event.target.closest(
      "[data-operation-delete]"
    );

  if (operationDeleteButton) {
    const index =
      Number(
        operationDeleteButton.dataset
          .operationDelete
      );

    removeOperationEntry(index);
    return;
  }

  const workDeleteButton =
    event.target.closest("[data-work-delete]");

  if (workDeleteButton) {
    const id =
      workDeleteButton.dataset.workDelete;

    removeWorkEntry(id);
    return;
  }

  const workEditButton =
    event.target.closest("[data-work-edit]");

  if (workEditButton) {
    const id =
      workEditButton.dataset.workEdit;

    editWorkEntry(id);
    return;
  }

  const navigatorTagButton =
    event.target.closest("[data-navigator-tag]");

  if (navigatorTagButton) {
    openNavigatorByTag(
      navigatorTagButton.dataset.navigatorTag
    );
    return;
  }

  const attachmentDeleteButton =
    event.target.closest(
      "[data-attachment-delete]"
    );

  if (attachmentDeleteButton) {
    removeAttachment(
      attachmentDeleteButton.dataset
        .attachmentDelete
    );
    return;
  }

  if (
    elements.userDropdown &&
    !elements.userDropdown.hidden &&
    !event.target.closest("#userDropdown") &&
    !event.target.closest("#userMenuButton")
  ) {
    closeUserDropdown();
  }
}


/* =========================================================
   화면 전환
========================================================= */

function navigateToView(viewName) {
  if (!viewName) {
    return;
  }

  window.location.hash = viewName;
}


function openViewFromHash() {
  const hashView =
    window.location.hash.replace("#", "");

  const viewName =
    hashView || "dashboard";

  showView(viewName);
}


function showView(viewName) {
  const targetView =
    document.querySelector(
      `[data-view="${viewName}"]`
    );

  if (!targetView) {
    showView("dashboard");
    return;
  }

  document
    .querySelectorAll(".app-view")
    .forEach((view) => {
      const isTarget =
        view.dataset.view === viewName;

      view.hidden = !isTarget;
      view.classList.toggle(
        "is-active",
        isTarget
      );
    });

  document
    .querySelectorAll(".sidebar-nav-button")
    .forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.dataset.viewTarget === viewName
      );
    });

  appState.currentView = viewName;

  updateCurrentPageTitle(viewName);
  closeSidebar();
  closeUserDropdown();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


function updateCurrentPageTitle(viewName) {
  const titles = {
    dashboard: "현황",
    "daily-log": "업무일지 작성",
    "log-search": "업무일지 조회",
    "work-orders": "TM · BM · CM",
    handover: "인수인계",
    approval: "결재관리",
    statistics: "통계",
    admin: "관리자"
  };

  if (elements.currentPageTitle) {
    elements.currentPageTitle.textContent =
      titles[viewName] || "GS Shift Log";
  }
}


/* =========================================================
   사이드바
========================================================= */

function openSidebar() {
  elements.appSidebar?.classList.add(
    "is-open"
  );

  if (elements.sidebarBackdrop) {
    elements.sidebarBackdrop.hidden = false;
  }
}


function closeSidebar() {
  elements.appSidebar?.classList.remove(
    "is-open"
  );

  if (elements.sidebarBackdrop) {
    elements.sidebarBackdrop.hidden = true;
  }
}


/* =========================================================
   사용자 메뉴
========================================================= */

function toggleUserDropdown() {
  if (!elements.userDropdown) {
    return;
  }

  const willOpen =
    elements.userDropdown.hidden;

  elements.userDropdown.hidden = !willOpen;

  elements.userMenuButton?.setAttribute(
    "aria-expanded",
    String(willOpen)
  );
}


function closeUserDropdown() {
  if (!elements.userDropdown) {
    return;
  }

  elements.userDropdown.hidden = true;

  elements.userMenuButton?.setAttribute(
    "aria-expanded",
    "false"
  );
}


/* =========================================================
   날짜 및 사용자 정보
========================================================= */

function updateHeaderDate() {
  const now = new Date();

  const dateText =
    new Intl.DateTimeFormat(
      "ko-KR",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short"
      }
    ).format(now);

  if (elements.headerCurrentDate) {
    elements.headerCurrentDate.textContent =
      dateText;
  }

  const shift =
    calculateCurrentShift(now);

  if (elements.headerCurrentShift) {
    elements.headerCurrentShift.textContent =
      `${shift} · ${appState.currentUser.team}`;
  }
}


function calculateCurrentShift(date) {
  const hour = date.getHours();

  return hour >= 7 && hour < 19
    ? "DS"
    : "NS";
}


function applyCurrentUser() {
  const user = appState.currentUser;

  if (elements.headerUserName) {
    elements.headerUserName.textContent =
      user.name;
  }

  if (elements.headerUserRole) {
    elements.headerUserRole.textContent =
      user.roleLabel;
  }

  if (elements.headerUserAvatar) {
    elements.headerUserAvatar.textContent =
      user.name.slice(0, 1);
  }
}


/* =========================================================
   기본 폼 값
========================================================= */

function setInitialLogFormValues() {
  const now = new Date();

  const today =
    formatDateInputValue(now);

  if (!appState.draft.date) {
    appState.draft.date = today;
  }

  if (!appState.draft.shift) {
    appState.draft.shift =
      calculateCurrentShift(now);
  }

  if (!appState.draft.team) {
    appState.draft.team =
      appState.currentUser.team;
  }

  if (!appState.draft.position) {
    appState.draft.position =
      appState.currentUser.position;
  }

  if (!appState.draft.author) {
    appState.draft.author =
      appState.currentUser.name;
  }

  if (
    appState.draft.operationEntries.length === 0
  ) {
    appState.draft.operationEntries.push(
      createEmptyOperationEntry(true)
    );
  }

  syncDraftToForm();
}


function syncDraftToForm() {
  if (elements.logDate) {
    elements.logDate.value =
      appState.draft.date || "";
  }

  if (elements.logShift) {
    elements.logShift.value =
      appState.draft.shift || "";
  }

  if (elements.logTeam) {
    elements.logTeam.value =
      appState.draft.team || "";
  }

  if (elements.logPosition) {
    elements.logPosition.value =
      appState.draft.position || "";
  }

  if (elements.logAuthor) {
    elements.logAuthor.value =
      appState.draft.author || "";
  }
}


/* =========================================================
   운전 현황
========================================================= */

function createEmptyOperationEntry(isFirst = false) {
  return {
    id: createId("operation"),
    status: "",
    time: "",
    content: "",
    isFirst
  };
}


function addOperationEntry() {
  syncFormToDraft();

  appState.draft.operationEntries.push(
    createEmptyOperationEntry(false)
  );

  renderOperationEntries();
  markDraftChanged();
}


function removeOperationEntry(index) {
  if (
    index === 0 ||
    appState.draft.operationEntries.length <= 1
  ) {
    showToast(
      "첫 번째 운전 현황 항목은 삭제할 수 없습니다.",
      "error"
    );

    return;
  }

  syncOperationEntriesFromDom();

  appState.draft.operationEntries.splice(
    index,
    1
  );

  renderOperationEntries();
  markDraftChanged();
}


function renderOperationEntries() {
  if (!elements.operationEntryList) {
    return;
  }

  elements.operationEntryList.innerHTML =
    appState.draft.operationEntries
      .map(
        (entry, index) =>
          createOperationEntryHtml(
            entry,
            index
          )
      )
      .join("");
}


function createOperationEntryHtml(
  entry,
  index
) {
  const firstEntry = index === 0;

  return `
    <article
      class="entry-editor operation-entry"
      data-entry-index="${index}"
    >
      <div
        class="entry-editor-grid operation-entry-grid"
      >
        <label class="form-field">
          <span class="form-label">
            ${
              firstEntry
                ? "운전상태"
                : "구분"
            }
          </span>

          ${
            firstEntry
              ? `
                <select
                  name="operationStatus"
                  required
                >
                  <option value="">
                    상태 선택
                  </option>

                  ${createOperationStatusOptions(
                    entry.status
                  )}
                </select>
              `
              : `
                <input
                  name="operationStatus"
                  type="text"
                  value="추가 현황"
                  disabled
                >
              `
          }
        </label>

        <label class="form-field">
          <span class="form-label">
            시간
          </span>

          <input
            name="operationTime"
            type="time"
            value="${escapeHtml(
              entry.time
            )}"
          >
        </label>

        <label
          class="form-field form-field-grow"
        >
          <span class="form-label">
            내용
          </span>

          <textarea
            name="operationContent"
            rows="2"
            placeholder="${
              firstEntry
                ? "예: #1 BLR 정상운전 중"
                : "추가 운전 현황을 입력하세요."
            }"
            required
          >${escapeHtml(
            entry.content
          )}</textarea>
        </label>

        ${
          firstEntry
            ? ""
            : `
              <div class="form-field">
                <span class="form-label">
                  관리
                </span>

                <button
                  class="button button-danger-outline button-small"
                  type="button"
                  data-operation-delete="${index}"
                >
                  삭제
                </button>
              </div>
            `
        }
      </div>
    </article>
  `;
}


function createOperationStatusOptions(
  selectedStatus
) {
  const statuses = [
    "정상운전",
    "점검중",
    "계획정비",
    "정지",
    "비상운전"
  ];

  return statuses
    .map((status) => {
      const selected =
        selectedStatus === status
          ? "selected"
          : "";

      const label =
        status === "점검중"
          ? "점검 중"
          : status;

      return `
        <option
          value="${status}"
          ${selected}
        >
          ${label}
        </option>
      `;
    })
    .join("");
}


function syncOperationEntriesFromDom() {
  const entryElements =
    elements.operationEntryList?.querySelectorAll(
      ".operation-entry"
    );

  if (!entryElements) {
    return;
  }

  appState.draft.operationEntries =
    Array.from(entryElements).map(
      (entryElement, index) => {
        const previous =
          appState.draft.operationEntries[
            index
          ] ||
          createEmptyOperationEntry(
            index === 0
          );

        const statusElement =
          entryElement.querySelector(
            '[name="operationStatus"]'
          );

        const timeElement =
          entryElement.querySelector(
            '[name="operationTime"]'
          );

        const contentElement =
          entryElement.querySelector(
            '[name="operationContent"]'
          );

        return {
          ...previous,
          status:
            index === 0
              ? statusElement?.value || ""
              : "",
          time:
            timeElement?.value || "",
          content:
            contentElement?.value.trim() ||
            "",
          isFirst: index === 0
        };
      }
    );
}


/* =========================================================
   작업 · 인계 기록
========================================================= */

function setCurrentWorkEntryTime() {
  if (!elements.workEntryTime) {
    return;
  }

  elements.workEntryTime.value =
    formatTimeInputValue(new Date());
}


function addWorkEntry() {
  const time =
    elements.workEntryTime?.value || "";

  const type =
    elements.workEntryType?.value || "";

  const tag =
    normalizeTag(
      elements.workEntryTag?.value || ""
    );

  const content =
    elements.workEntryContent?.value.trim() ||
    "";

  if (!type) {
    showToast(
      "작업 구분을 선택해 주세요.",
      "error"
    );

    elements.workEntryType?.focus();
    return;
  }

  if (!content) {
    showToast(
      "작업 또는 인계 내용을 입력해 주세요.",
      "error"
    );

    elements.workEntryContent?.focus();
    return;
  }

  const entry = {
    id: createId("work"),
    time,
    type,
    tag,
    content,
    createdAt:
      new Date().toISOString(),
    source: "manual"
  };

  appState.draft.workEntries.push(entry);

  clearWorkEntryComposer();
  renderWorkEntries();
  markDraftChanged();

  showToast(
    "작업·인계 기록을 추가했습니다.",
    "success"
  );
}


function clearWorkEntryComposer() {
  if (elements.workEntryTime) {
    elements.workEntryTime.value = "";
  }

  if (elements.workEntryType) {
    elements.workEntryType.value = "";
  }

  if (elements.workEntryTag) {
    elements.workEntryTag.value = "";
  }

  if (elements.workEntryContent) {
    elements.workEntryContent.value = "";
  }
}


function removeWorkEntry(id) {
  appState.draft.workEntries =
    appState.draft.workEntries.filter(
      (entry) => entry.id !== id
    );

  renderWorkEntries();
  markDraftChanged();

  showToast(
    "기록을 삭제했습니다.",
    "info"
  );
}


function editWorkEntry(id) {
  const entry =
    appState.draft.workEntries.find(
      (item) => item.id === id
    );

  if (!entry) {
    return;
  }

  if (elements.workEntryTime) {
    elements.workEntryTime.value =
      entry.time;
  }

  if (elements.workEntryType) {
    elements.workEntryType.value =
      entry.type;
  }

  if (elements.workEntryTag) {
    elements.workEntryTag.value =
      entry.tag;
  }

  if (elements.workEntryContent) {
    elements.workEntryContent.value =
      entry.content;
  }

  appState.draft.workEntries =
    appState.draft.workEntries.filter(
      (item) => item.id !== id
    );

  renderWorkEntries();
  markDraftChanged();

  elements.workEntryContent?.focus();

  showToast(
    "수정할 내용을 위 입력창으로 불러왔습니다.",
    "info"
  );
}


function renderWorkEntries() {
  if (!elements.workEntryList) {
    return;
  }

  if (
    appState.draft.workEntries.length === 0
  ) {
    elements.workEntryList.innerHTML = `
      <div class="empty-state">
        <strong>
          등록된 작업·인계 기록이 없습니다.
        </strong>

        <p>
          위 입력창에서 시간, 구분과 내용을 입력해 주세요.
        </p>
      </div>
    `;

    return;
  }

  const sortedEntries =
    [...appState.draft.workEntries].sort(
      compareWorkEntries
    );

  elements.workEntryList.innerHTML =
    sortedEntries
      .map(createWorkEntryHtml)
      .join("");
}


function compareWorkEntries(a, b) {
  if (a.time && b.time) {
    return a.time.localeCompare(b.time);
  }

  if (a.time) {
    return -1;
  }

  if (b.time) {
    return 1;
  }

  return a.createdAt.localeCompare(
    b.createdAt
  );
}


function createWorkEntryHtml(entry) {
  const typeInfo =
    APP_CONFIG.workEntryTypes[
      entry.type
    ] || {
      label: entry.type,
      group: "ETC"
    };

  const tagHtml =
    entry.tag
      ? `
        <button
          class="button button-secondary button-small"
          type="button"
          data-navigator-tag="${escapeHtml(
            entry.tag
          )}"
          title="Facility Navigator에서 열기"
        >
          ${escapeHtml(entry.tag)}
          ↗
        </button>
      `
      : `
        <span class="form-help">
          TAG 없음
        </span>
      `;

  return `
    <article
      class="work-entry-item"
      data-work-entry-id="${escapeHtml(
        entry.id
      )}"
    >
      <div>
        <strong>
          ${escapeHtml(entry.time || "--:--")}
        </strong>
      </div>

      <div>
        <span
          class="status-badge ${getWorkTypeBadgeClass(
            typeInfo.group
          )}"
        >
          ${escapeHtml(typeInfo.label)}
        </span>
      </div>

      <div>
        ${tagHtml}
      </div>

      <div>
        <strong>
          ${escapeHtml(entry.content)}
        </strong>
      </div>

      <div>
        <button
          class="button button-ghost button-small"
          type="button"
          data-work-edit="${escapeHtml(
            entry.id
          )}"
        >
          수정
        </button>

        <button
          class="button button-danger-outline button-small"
          type="button"
          data-work-delete="${escapeHtml(
            entry.id
          )}"
        >
          삭제
        </button>
      </div>
    </article>
  `;
}


function getWorkTypeBadgeClass(group) {
  if (group === "TM") {
    return "status-writing";
  }

  if (group === "BM") {
    return "status-approval";
  }

  if (group === "CM") {
    return "status-complete";
  }

  return "status-empty";
}


/* =========================================================
   Navigator 연동
========================================================= */

function openNavigatorFromComposer() {
  const tag =
    normalizeTag(
      elements.workEntryTag?.value || ""
    );

  if (!tag) {
    showToast(
      "먼저 TAG 번호를 입력해 주세요.",
      "error"
    );

    elements.workEntryTag?.focus();
    return;
  }

  openNavigatorByTag(tag);
}


function openNavigatorByTag(tag) {
  const normalizedTag =
    normalizeTag(tag);

  if (!normalizedTag) {
    return;
  }

  const url =
    new URL(
      APP_CONFIG.navigatorBaseUrl
    );

  url.searchParams.set(
    "tag",
    normalizedTag
  );

  window.open(
    url.toString(),
    "_blank",
    "noopener,noreferrer"
  );
}


function normalizeTag(tag) {
  return String(tag)
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}


/* =========================================================
   폼 동기화
========================================================= */

function handleFormInput() {
  syncFormToDraft();
  markDraftChanged();
}


function syncFormToDraft() {
  appState.draft.date =
    elements.logDate?.value || "";

  appState.draft.shift =
    elements.logShift?.value || "";

  appState.draft.team =
    elements.logTeam?.value || "";

  appState.draft.position =
    elements.logPosition?.value || "";

  appState.draft.author =
    elements.logAuthor?.value.trim() ||
    "";

  syncOperationEntriesFromDom();
}


/* =========================================================
   임시저장
========================================================= */

function markDraftChanged() {
  appState.draft.updatedAt =
    new Date().toISOString();

  setAutosaveStatus("변경사항 있음");

  scheduleDraftSave();
}


let draftSaveTimer = null;


function scheduleDraftSave() {
  window.clearTimeout(draftSaveTimer);

  draftSaveTimer =
    window.setTimeout(() => {
      saveDraftToStorage(false);
    }, 900);
}


function saveDraftManually() {
  syncFormToDraft();
  saveDraftToStorage(true);
}


function saveDraftToStorage(showMessage) {
  syncFormToDraft();

  appState.draft.updatedAt =
    new Date().toISOString();

  try {
    localStorage.setItem(
      APP_CONFIG.draftStorageKey,
      JSON.stringify(appState.draft)
    );

    setAutosaveStatus(
      `임시저장 ${formatTimeDisplay(
        new Date()
      )}`
    );

    if (showMessage) {
      showToast(
        "업무일지를 임시저장했습니다.",
        "success"
      );
    }
  } catch (error) {
    console.error(
      "임시저장 실패:",
      error
    );

    setAutosaveStatus("저장 실패");

    showToast(
      "임시저장에 실패했습니다.",
      "error"
    );
  }
}


function loadDraftFromStorage() {
  const savedDraft =
    localStorage.getItem(
      APP_CONFIG.draftStorageKey
    );

  if (!savedDraft) {
    return;
  }

  try {
    const parsedDraft =
      JSON.parse(savedDraft);

    appState.draft = {
      ...appState.draft,
      ...parsedDraft,
      operationEntries:
        Array.isArray(
          parsedDraft.operationEntries
        )
          ? parsedDraft.operationEntries
          : [],
      workEntries:
        Array.isArray(
          parsedDraft.workEntries
        )
          ? parsedDraft.workEntries
          : [],
      attachments:
        Array.isArray(
          parsedDraft.attachments
        )
          ? parsedDraft.attachments
          : []
    };

    if (
      appState.draft.operationEntries
        .length === 0
    ) {
      appState.draft.operationEntries.push(
        createEmptyOperationEntry(true)
      );
    }

    syncDraftToForm();

    setAutosaveStatus("임시저장 복원됨");

    showToast(
      "이전에 작성하던 임시 일지를 불러왔습니다.",
      "info"
    );
  } catch (error) {
    console.error(
      "임시저장 복원 실패:",
      error
    );
  }
}


function setAutosaveStatus(text) {
  if (elements.autosaveStatus) {
    elements.autosaveStatus.textContent =
      text;
  }
}


/* =========================================================
   업무일지 저장
========================================================= */

function handleDailyLogSubmit(event) {
  event.preventDefault();

  syncFormToDraft();

  const validation =
    validateDailyLog();

  if (!validation.valid) {
    showToast(
      validation.message,
      "error"
    );

    validation.element?.focus();
    return;
  }

  saveDraftToStorage(false);

  showToast(
    "화면 입력 검사가 완료되었습니다. 다음 단계에서 D1 저장을 연결합니다.",
    "success"
  );
}


function validateDailyLog() {
  if (!appState.draft.date) {
    return {
      valid: false,
      message: "작성일을 선택해 주세요.",
      element: elements.logDate
    };
  }

  if (!appState.draft.shift) {
    return {
      valid: false,
      message: "시프트를 선택해 주세요.",
      element: elements.logShift
    };
  }

  if (!appState.draft.team) {
    return {
      valid: false,
      message: "근무조를 선택해 주세요.",
      element: elements.logTeam
    };
  }

  if (!appState.draft.position) {
    return {
      valid: false,
      message: "보직을 선택해 주세요.",
      element: elements.logPosition
    };
  }

  if (!appState.draft.author) {
    return {
      valid: false,
      message: "작성자를 입력해 주세요.",
      element: elements.logAuthor
    };
  }

  const firstOperation =
    appState.draft.operationEntries[0];

  if (!firstOperation?.status) {
    return {
      valid: false,
      message:
        "첫 번째 운전 현황의 운전상태를 선택해 주세요.",
      element:
        elements.operationEntryList?.querySelector(
          '[name="operationStatus"]'
        )
    };
  }

  if (!firstOperation?.content) {
    return {
      valid: false,
      message:
        "첫 번째 운전 현황 내용을 입력해 주세요.",
      element:
        elements.operationEntryList?.querySelector(
          '[name="operationContent"]'
        )
    };
  }

  return {
    valid: true
  };
}


/* =========================================================
   결재 요청
========================================================= */

function requestApproval() {
  syncFormToDraft();

  const validation =
    validateDailyLog();

  if (!validation.valid) {
    showToast(
      validation.message,
      "error"
    );

    validation.element?.focus();
    return;
  }

  openConfirmModal({
    title: "결재 요청",
    message:
      "현재 업무일지를 결재 요청 상태로 전환하시겠습니까?",
    confirmText: "결재 요청",
    onConfirm: () => {
      saveDraftToStorage(false);

      showToast(
        "결재 기능은 다음 데이터베이스 단계에서 연결됩니다.",
        "info"
      );
    }
  });
}


/* =========================================================
   임시 일지 삭제
========================================================= */

function confirmDeleteDraft() {
  openConfirmModal({
    title: "임시 일지 삭제",
    message:
      "현재 작성 중인 모든 내용을 삭제하시겠습니까?",
    confirmText: "삭제",
    onConfirm: deleteDraft
  });
}


function deleteDraft() {
  localStorage.removeItem(
    APP_CONFIG.draftStorageKey
  );

  appState.draft = {
    id: null,
    date: formatDateInputValue(
      new Date()
    ),
    shift: calculateCurrentShift(
      new Date()
    ),
    team: appState.currentUser.team,
    position:
      appState.currentUser.position,
    author: appState.currentUser.name,
    operationEntries: [
      createEmptyOperationEntry(true)
    ],
    workEntries: [],
    attachments: [],
    updatedAt: null
  };

  syncDraftToForm();
  renderOperationEntries();
  renderWorkEntries();
  renderAttachments();

  setAutosaveStatus("저장 전");

  showToast(
    "임시 일지를 삭제했습니다.",
    "success"
  );
}


/* =========================================================
   보고용 복사
========================================================= */

async function copyReportText() {
  syncFormToDraft();

  const reportText =
    createReportText();

  try {
    await navigator.clipboard.writeText(
      reportText
    );

    showToast(
      "보고용 업무일지 내용을 복사했습니다.",
      "success"
    );
  } catch (error) {
    fallbackCopyText(reportText);
  }
}


function createReportText() {
  const lines = [];

  lines.push(
    `${appState.draft.date} ${appState.draft.shift} / ${appState.draft.team} / ${appState.draft.position} ${appState.draft.author}`
  );

  lines.push("");

  lines.push("[운전 현황]");

  appState.draft.operationEntries
    .filter((entry) => entry.content)
    .forEach((entry, index) => {
      const statusText =
        index === 0 && entry.status
          ? `[${entry.status}] `
          : "";

      const timeText =
        entry.time
          ? `${entry.time} `
          : "";

      lines.push(
        `${index + 1}. ${timeText}${statusText}${entry.content}`
      );
    });

  const groupedEntries =
    groupWorkEntriesByType(
      appState.draft.workEntries
    );

  Object.entries(groupedEntries)
    .forEach(([type, entries]) => {
      const typeInfo =
        APP_CONFIG.workEntryTypes[type];

      lines.push("");
      lines.push(
        `[${typeInfo?.label || type}]`
      );

      entries.forEach(
        (entry, index) => {
          const timeText =
            entry.time
              ? `${entry.time} `
              : "";

          const tagText =
            entry.tag
              ? `[${entry.tag}] `
              : "";

          lines.push(
            `${index + 1}. ${timeText}${tagText}${entry.content}`
          );
        }
      );
    });

  return lines.join("\n");
}


function groupWorkEntriesByType(entries) {
  return entries.reduce(
    (groups, entry) => {
      if (!groups[entry.type]) {
        groups[entry.type] = [];
      }

      groups[entry.type].push(entry);

      return groups;
    },
    {}
  );
}


function fallbackCopyText(text) {
  const textarea =
    document.createElement("textarea");

  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);

  textarea.select();

  const copied =
    document.execCommand("copy");

  textarea.remove();

  showToast(
    copied
      ? "보고용 업무일지 내용을 복사했습니다."
      : "복사에 실패했습니다.",
    copied
      ? "success"
      : "error"
  );
}


/* =========================================================
   인쇄
========================================================= */

function printCurrentLog() {
  syncFormToDraft();
  window.print();
}


/* =========================================================
   일괄 붙여넣기
========================================================= */

function previewBulkPaste() {
  const text =
    elements.bulkPasteInput?.value.trim() ||
    "";

  if (!text) {
    showToast(
      "붙여넣을 내용을 입력해 주세요.",
      "error"
    );

    return;
  }

  const lines =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  appState.bulkPastePreview =
    lines.map(parseBulkPasteLine);

  renderBulkPastePreview();
  openModal("bulkPasteModal");
}


function parseBulkPasteLine(line) {
  const timeMatch =
    line.match(
      /^(\d{1,2}:\d{2})\s*/
    );

  const time =
    timeMatch
      ? timeMatch[1].padStart(5, "0")
      : "";

  let cleanedLine =
    timeMatch
      ? line.slice(timeMatch[0].length)
      : line;

  const type =
    detectWorkEntryType(cleanedLine);

  cleanedLine =
    removeDetectedTypeText(
      cleanedLine,
      type
    );

  const tagMatch =
    cleanedLine.match(
      /\b[A-Z0-9]{5,20}\b/i
    );

  return {
    id: createId("bulk"),
    checked: true,
    time,
    type: type || "NOTE",
    tag: tagMatch
      ? normalizeTag(tagMatch[0])
      : "",
    content: cleanedLine.trim()
  };
}


function detectWorkEntryType(text) {
  const normalized =
    text.replace(/\s+/g, "");

  if (normalized.includes("TM발행")) {
    return "TM_ISSUE";
  }

  if (normalized.includes("TM작업")) {
    return "TM_WORK";
  }

  if (normalized.includes("TM종결")) {
    return "TM_CLOSE";
  }

  if (normalized.includes("BM발행")) {
    return "BM_ISSUE";
  }

  if (normalized.includes("BM종결")) {
    return "BM_CLOSE";
  }

  if (normalized.includes("CM발행")) {
    return "CM_ISSUE";
  }

  if (
    normalized.includes("인계") ||
    normalized.includes("전달")
  ) {
    return "HANDOVER";
  }

  return "";
}


function removeDetectedTypeText(
  text,
  type
) {
  const labels = {
    TM_ISSUE: /TM\s*발행/gi,
    TM_WORK: /TM\s*작업/gi,
    TM_CLOSE: /TM\s*종결/gi,
    BM_ISSUE: /BM\s*발행/gi,
    BM_CLOSE: /BM\s*종결/gi,
    CM_ISSUE: /CM\s*발행/gi,
    HANDOVER: /인계사항|인계|전달사항/gi
  };

  const pattern = labels[type];

  return pattern
    ? text.replace(pattern, "").trim()
    : text;
}


function renderBulkPastePreview() {
  if (!elements.bulkPastePreviewList) {
    return;
  }

  elements.bulkPastePreviewList.innerHTML =
    appState.bulkPastePreview
      .map(
        (entry, index) => `
          <article class="entry-editor">
            <div
              class="entry-editor-grid operation-entry-grid"
            >
              <label class="form-field">
                <span class="form-label">
                  등록
                </span>

                <input
                  type="checkbox"
                  data-bulk-check="${index}"
                  ${
                    entry.checked
                      ? "checked"
                      : ""
                  }
                >
              </label>

              <label class="form-field">
                <span class="form-label">
                  시간
                </span>

                <input
                  type="time"
                  value="${escapeHtml(
                    entry.time
                  )}"
                  data-bulk-time="${index}"
                >
              </label>

              <label class="form-field">
                <span class="form-label">
                  구분
                </span>

                <select
                  data-bulk-type="${index}"
                >
                  ${createWorkTypeOptions(
                    entry.type
                  )}
                </select>
              </label>

              <label class="form-field">
                <span class="form-label">
                  TAG
                </span>

                <input
                  type="text"
                  value="${escapeHtml(
                    entry.tag
                  )}"
                  data-bulk-tag="${index}"
                >
              </label>

              <label
                class="form-field form-field-grow"
              >
                <span class="form-label">
                  내용
                </span>

                <textarea
                  rows="2"
                  data-bulk-content="${index}"
                >${escapeHtml(
                  entry.content
                )}</textarea>
              </label>
            </div>
          </article>
        `
      )
      .join("");
}


function createWorkTypeOptions(
  selectedType
) {
  return Object.entries(
    APP_CONFIG.workEntryTypes
  )
    .map(([value, info]) => {
      const selected =
        value === selectedType
          ? "selected"
          : "";

      return `
        <option
          value="${value}"
          ${selected}
        >
          ${info.label}
        </option>
      `;
    })
    .join("");
}


function applyBulkPasteEntries() {
  const previewItems =
    elements.bulkPastePreviewList
      ?.querySelectorAll(
        ".entry-editor"
      );

  if (!previewItems) {
    return;
  }

  const newEntries = [];

  previewItems.forEach(
    (item, index) => {
      const checked =
        item.querySelector(
          `[data-bulk-check="${index}"]`
        )?.checked;

      if (!checked) {
        return;
      }

      const time =
        item.querySelector(
          `[data-bulk-time="${index}"]`
        )?.value || "";

      const type =
        item.querySelector(
          `[data-bulk-type="${index}"]`
        )?.value || "NOTE";

      const tag =
        normalizeTag(
          item.querySelector(
            `[data-bulk-tag="${index}"]`
          )?.value || ""
        );

      const content =
        item.querySelector(
          `[data-bulk-content="${index}"]`
        )?.value.trim() || "";

      if (!content) {
        return;
      }

      newEntries.push({
        id: createId("work"),
        time,
        type,
        tag,
        content,
        createdAt:
          new Date().toISOString(),
        source: "bulk"
      });
    }
  );

  appState.draft.workEntries.push(
    ...newEntries
  );

  renderWorkEntries();
  markDraftChanged();

  closeModal("bulkPasteModal");

  if (elements.bulkPasteInput) {
    elements.bulkPasteInput.value = "";
  }

  showToast(
    `${newEntries.length}개 항목을 등록했습니다.`,
    "success"
  );
}


function clearBulkPasteInput() {
  if (elements.bulkPasteInput) {
    elements.bulkPasteInput.value = "";
  }
}


/* =========================================================
   첨부파일
========================================================= */

function handleAttachmentSelection(event) {
  const files =
    Array.from(
      event.target.files || []
    );

  addAttachments(files);

  event.target.value = "";
}


function handleAttachmentDragOver(event) {
  event.preventDefault();

  elements.attachmentDropzone
    ?.classList.add("is-dragover");
}


function handleAttachmentDragLeave() {
  elements.attachmentDropzone
    ?.classList.remove("is-dragover");
}


function handleAttachmentDrop(event) {
  event.preventDefault();

  elements.attachmentDropzone
    ?.classList.remove("is-dragover");

  const files =
    Array.from(
      event.dataTransfer.files || []
    );

  addAttachments(files);
}


function addAttachments(files) {
  if (files.length === 0) {
    return;
  }

  files.forEach((file) => {
    appState.draft.attachments.push({
      id: createId("attachment"),
      name: file.name,
      size: file.size,
      type:
        file.type ||
        "application/octet-stream",
      lastModified:
        file.lastModified,
      pendingUpload: true
    });
  });

  renderAttachments();
  markDraftChanged();

  showToast(
    `${files.length}개 파일을 첨부 목록에 추가했습니다.`,
    "success"
  );
}


function removeAttachment(id) {
  appState.draft.attachments =
    appState.draft.attachments.filter(
      (file) => file.id !== id
    );

  renderAttachments();
  markDraftChanged();
}


function renderAttachments() {
  if (!elements.attachmentList) {
    return;
  }

  if (
    appState.draft.attachments.length === 0
  ) {
    elements.attachmentList.innerHTML = "";
    return;
  }

  elements.attachmentList.innerHTML =
    appState.draft.attachments
      .map(
        (file) => `
          <article class="entry-editor">
            <strong>
              ${escapeHtml(file.name)}
            </strong>

            <p class="form-help">
              ${formatFileSize(file.size)}
              · 업로드 대기
            </p>

            <button
              class="button button-danger-outline button-small"
              type="button"
              data-attachment-delete="${escapeHtml(
                file.id
              )}"
            >
              삭제
            </button>
          </article>
        `
      )
      .join("");
}


/* =========================================================
   모달
========================================================= */

function openModal(modalId) {
  const modal =
    document.getElementById(modalId);

  if (!modal) {
    return;
  }

  modal.hidden = false;
  document.body.style.overflow =
    "hidden";
}


function closeModal(modalId) {
  const modal =
    document.getElementById(modalId);

  if (!modal) {
    return;
  }

  modal.hidden = true;

  const anyOpenModal =
    Array.from(
      document.querySelectorAll(
        ".modal"
      )
    ).some(
      (item) => !item.hidden
    );

  if (!anyOpenModal) {
    document.body.style.overflow = "";
  }

  if (modalId === "confirmModal") {
    appState.confirmAction = null;
  }
}


function openConfirmModal({
  title,
  message,
  confirmText = "확인",
  onConfirm
}) {
  appState.confirmAction =
    typeof onConfirm === "function"
      ? onConfirm
      : null;

  if (elements.confirmModalTitle) {
    elements.confirmModalTitle.textContent =
      title;
  }

  if (elements.confirmModalMessage) {
    elements.confirmModalMessage.textContent =
      message;
  }

  if (
    elements.confirmModalConfirmButton
  ) {
    elements.confirmModalConfirmButton.textContent =
      confirmText;
  }

  openModal("confirmModal");
}


function executeConfirmAction() {
  const action =
    appState.confirmAction;

  closeModal("confirmModal");

  if (typeof action === "function") {
    action();
  }
}


/* =========================================================
   Toast
========================================================= */

function showToast(
  message,
  type = "info",
  duration = 2600
) {
  if (!elements.toastContainer) {
    return;
  }

  const toast =
    document.createElement("div");

  toast.className =
    `toast toast-${type}`;

  toast.textContent = message;

  elements.toastContainer.appendChild(
    toast
  );

  window.setTimeout(() => {
    toast.remove();
  }, duration);
}


/* =========================================================
   페이지 종료 경고
========================================================= */

function handleBeforeUnload(event) {
  if (!appState.draft.updatedAt) {
    return;
  }

  saveDraftToStorage(false);

  event.preventDefault();
}


/* =========================================================
   유틸리티
========================================================= */

function createId(prefix = "id") {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
}


function formatDateInputValue(date) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function formatTimeInputValue(date) {
  const hours =
    String(
      date.getHours()
    ).padStart(2, "0");

  const minutes =
    String(
      date.getMinutes()
    ).padStart(2, "0");

  return `${hours}:${minutes}`;
}


function formatTimeDisplay(date) {
  return new Intl.DateTimeFormat(
    "ko-KR",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  ).format(date);
}


function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(
      bytes / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}