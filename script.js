"use strict";

/* =========================================================
  GS Shift Log
  - 현황 / 조회 탭
  - 날짜 이동
  - 업무일지 작성 모달
  - 작업 항목 추가 / 삭제
  - 첨부파일 표시
  - 임시저장 / 저장 / 결재요청
  - 상세보기
  - TAG → Facility Navigator 이동
========================================================= */

const FACILITY_NAVIGATOR_URL =
  "https://gs-facility-navigator-2mg.pages.dev/";

const STORAGE_KEYS = {
  logs: "gsShiftLog.logs",
  draft: "gsShiftLog.draft"
};

const appState = {
  selectedDate: new Date(2026, 6, 20),
  selectedShift: "NS",
  currentDetailLogId: null,
  logs: [],

  editorEntries: [],
  editingEntryIndex: -1
};


/* =========================================================
  초기 실행
========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  cacheMemberLogImportElements();

  bindShiftMemberCards();
  loadLogs();
  bindEvents();
  bindMemberLogImportEvents();

  loadOperationStatus();
  renderOperationStatusCard();

  renderSelectedDate();
  renderLogTable();
  updateShiftMemberCardStates();

  setEditorDateFromSelectedDate();

  resetLogEntryInput();
  updateTagFieldVisibility();
  renderLogEntryTable();

  updateMemberLogImportSection();
});

let elements = {};

function cacheElements() {
  elements = {
    /* =====================================================
      상단 탭과 화면
    ====================================================== */

    topTabs: [
      ...document.querySelectorAll(".top-tab")
    ],

    pageViews: [
      ...document.querySelectorAll(".page-view")
    ],


    /* =====================================================
      근무 현황과 날짜
    ====================================================== */

    shiftMemberGrid:
      document.getElementById("shiftMemberGrid"),

    currentShiftLabel:
      document.getElementById("currentShiftLabel"),

    selectedDateText:
      document.getElementById("selectedDateText"),

    selectedShiftBadge:
      document.getElementById("selectedShiftBadge"),

    previousDateButton:
      document.getElementById("previousDateButton"),

    nextDateButton:
      document.getElementById("nextDateButton"),

    todayButton:
      document.getElementById("todayButton"),


    /* =====================================================
      업무일지 작성 모달
    ====================================================== */

    openLogEditorButton:
      document.getElementById("openLogEditorButton"),

    closeLogEditorButton:
      document.getElementById("closeLogEditorButton"),

    cancelLogButton:
      document.getElementById("cancelLogButton"),

    logEditorModal:
      document.getElementById("logEditorModal"),

    logEditorForm:
      document.getElementById("logEditorForm"),

    logEditorTitle:
      document.getElementById("logEditorTitle"),


    /* =====================================================
      기본 정보
    ====================================================== */

    logDate:
      document.getElementById("logDate"),

    logShift:
      document.getElementById("logShift"),

    logTeam:
      document.getElementById("logTeam"),

    logRole:
      document.getElementById("logRole"),

    logAuthor:
      document.getElementById("logAuthor"),


    /* =====================================================
      현재 운전현황
    ====================================================== */

    operationStatusSection:
      document.querySelector(
        ".operation-status-section"
      ),

    operationStatus:
      document.getElementById(
        "operationStatus"
      ),

    operationStatusSnapshot:
      document.getElementById(
        "operationStatusSnapshot"
      ),

    operationStatusCurrentCard:
      document.getElementById(
        "operationStatusCurrentCard"
      ),

    operationStatusCurrentContent:
      document.getElementById(
        "operationStatusCurrentContent"
      ),

    operationStatusStateBadge:
      document.getElementById(
        "operationStatusStateBadge"
      ),

    operationStatusUpdatedAt:
      document.getElementById(
        "operationStatusUpdatedAt"
      ),

    operationStatusUpdatedBy:
      document.getElementById(
        "operationStatusUpdatedBy"
      ),

    operationStatusEditor:
      document.getElementById(
        "operationStatusEditor"
      ),

    operationStatusType:
      document.getElementById(
        "operationStatusType"
      ),

    editOperationStatusButton:
      document.getElementById(
        "editOperationStatusButton"
      ),

    cancelOperationStatusButton:
      document.getElementById(
        "cancelOperationStatusButton"
      ),

    saveOperationStatusButton:
      document.getElementById(
        "saveOperationStatusButton"
      ),


    /* =====================================================
      작업 · 정비 · 인계 입력
    ====================================================== */

    logEntryTime:
      document.getElementById(
        "logEntryTime"
      ),

    useCurrentTimeCheckbox:
      document.getElementById(
        "useCurrentTimeCheckbox"
      ),

    logEntryCategory:
      document.getElementById(
        "logEntryCategory"
      ),

    logEntryTag:
      document.getElementById(
        "logEntryTag"
      ),

    logEntryContent:
      document.getElementById(
        "logEntryContent"
      ),

    addLogEntryButton:
      document.getElementById(
        "addLogEntryButton"
      ),

    cancelLogEntryEditButton:
      document.getElementById(
        "cancelLogEntryEditButton"
      ),

    logEntryNavigatorButton:
      document.getElementById(
        "logEntryNavigatorButton"
      ),

    logEntryTagField:
      document.getElementById(
        "logEntryTagField"
      ),

    logEntryInputPanel:
      document.getElementById(
        "logEntryInputPanel"
      ),

    logEntryTableBody:
      document.getElementById(
        "logEntryTableBody"
      ),

    logEntryCount:
      document.getElementById(
        "logEntryCount"
      ),

    logEntriesJson:
      document.getElementById(
        "logEntriesJson"
      ),


    /* =====================================================
      비고와 첨부파일
    ====================================================== */

    logNote:
      document.getElementById("logNote"),

    logAttachments:
      document.getElementById(
        "logAttachments"
      ),

    fileDropzone:
      document.getElementById(
        "fileDropzone"
      ),

    attachmentList:
      document.getElementById(
        "attachmentList"
      ),


    /* =====================================================
      하단 버튼
    ====================================================== */

    saveDraftButton:
      document.getElementById(
        "saveDraftButton"
      ),

    printLogButton:
      document.getElementById(
        "printLogButton"
      ),

    requestApprovalButton:
      document.getElementById(
        "requestApprovalButton"
      ),


    /* =====================================================
      업무일지 목록
    ====================================================== */

    logTableBody:
      document.getElementById(
        "logTableBody"
      ),

    logEmptyState:
      document.getElementById(
        "logEmptyState"
      ),


    /* =====================================================
      상세보기 모달
    ====================================================== */

    logDetailModal:
      document.getElementById(
        "logDetailModal"
      ),

    closeLogDetailButton:
      document.getElementById(
        "closeLogDetailButton"
      ),

    closeLogDetailFooterButton:
      document.getElementById(
        "closeLogDetailFooterButton"
      ),

    logDetailContent:
      document.getElementById(
        "logDetailContent"
      ),

    editFromDetailButton:
      document.getElementById(
        "editFromDetailButton"
      ),


    /* =====================================================
      조회
    ====================================================== */

    searchForm:
      document.getElementById(
        "searchForm"
      ),

    searchResultBody:
      document.getElementById(
        "searchResultBody"
      ),

    searchResultCount:
      document.getElementById(
        "searchResultCount"
      ),

    searchEmptyState:
      document.getElementById(
        "searchEmptyState"
      ),


    /* =====================================================
      공통 알림
    ====================================================== */

    appToast:
      document.getElementById(
        "appToast"
      )
  };
}

/* =========================================================
  파트장 업무일지 가져오기 요소
========================================================= */

function cacheMemberLogImportElements() {
  elements.memberLogImportSection =
    document.getElementById(
      "memberLogImportSection"
    );

  elements.memberLogImportCount =
    document.getElementById(
      "memberLogImportCount"
    );

  elements.importTgoLogButton =
    document.getElementById(
      "importTgoLogButton"
    );

  elements.importBco1LogButton =
    document.getElementById(
      "importBco1LogButton"
    );

  elements.importBco2LogButton =
    document.getElementById(
      "importBco2LogButton"
    );

  elements.importAllMemberLogsButton =
    document.getElementById(
      "importAllMemberLogsButton"
    );

  elements.importTgoLogStatus =
    document.getElementById(
      "importTgoLogStatus"
    );

  elements.importBco1LogStatus =
    document.getElementById(
      "importBco1LogStatus"
    );

  elements.importBco2LogStatus =
    document.getElementById(
      "importBco2LogStatus"
    );
}

/* =========================================================
  파트장 업무일지 가져오기 표시
========================================================= */

function bindMemberLogImportEvents() {
  if (elements.logRole) {
    elements.logRole.addEventListener(
      "change",
      updateMemberLogImportSection
    );
  }

  if (elements.logDate) {
    elements.logDate.addEventListener(
      "change",
      updateMemberLogImportSection
    );
  }

  if (elements.logShift) {
    elements.logShift.addEventListener(
      "change",
      updateMemberLogImportSection
    );
  }

  const importItems =
    Array.isArray(
      elements.memberLogImportItems
    )
      ? elements.memberLogImportItems
      : [];

  importItems.forEach((item) => {
    if (!item.button) {
      return;
    }

    item.button.addEventListener(
      "click",
      () => {
        importMemberLogByRole(
          item.role
        );
      }
    );
  });

  if (
    elements.importAllMemberLogsButton
  ) {
    elements.importAllMemberLogsButton.addEventListener(
      "click",
      importAllMemberLogs
    );
  }
}


function updateMemberLogImportSection() {
  if (!elements.memberLogImportSection) {
    return;
  }

  const selectedRole =
    String(elements.logRole?.value || "").trim();

  const isLeader =
    selectedRole === "파트장";

  elements.memberLogImportSection.hidden =
    !isLeader;

  if (!isLeader) {
    return;
  }

  updateMemberLogImportStatus();
}


function updateMemberLogImportStatus() {
  const importItems =
    Array.isArray(
      elements.memberLogImportItems
    )
      ? elements.memberLogImportItems
      : [];

  importItems.forEach((item) => {
    if (
      !item.button ||
      !item.status
    ) {
      return;
    }

    const memberLog =
      findMemberLogByRole(
        item.role
      );

    item.button.classList.remove(
      "is-imported",
      "is-missing"
    );

    if (!memberLog) {
      item.button.classList.add(
        "is-missing"
      );

      item.status.textContent =
        "작성된 업무일지 없음";

      return;
    }

    const entryCount =
      Array.isArray(memberLog.entries)
        ? memberLog.entries.length
        : 0;

    const author =
      String(
        memberLog.author ||
        item.role
      ).trim();

    if (
      hasImportedEntriesFromRole(
        item.role
      )
    ) {
      item.button.classList.add(
        "is-imported"
      );

      item.status.textContent =
        `${author} · 가져오기 완료`;

      return;
    }

    item.status.textContent =
      `${author} · ${entryCount}건 확인`;
  });

  updateMemberLogImportCount();
}


function findMemberLogByRole(role) {
  const selectedDate =
    elements.logDate?.value ||
    formatInputDate(appState.selectedDate);

  const selectedShift =
    elements.logShift?.value ||
    appState.selectedShift ||
    "";

  const targetRole =
    normalizeMemberLogRole(role);

  /*
    같은 날짜와 같은 근무에 작성된 업무일지 중에서
    해당 보직의 업무일지를 찾는다.

    BCO1과 BO1,
    BCO2와 BO2는 같은 보직으로 인식한다.
  */
  const matchedLogs =
    appState.logs.filter((log) => {
      const logDate =
        String(log.date || "").trim();

      const logShift =
        String(log.shift || "").trim();

      const logRole =
        normalizeMemberLogRole(
          log.role
        );

      return (
        logDate === selectedDate &&
        logShift === selectedShift &&
        logRole === targetRole
      );
    });

  if (!matchedLogs.length) {
    return null;
  }

  /*
    같은 보직의 일지가 여러 개라면
    가장 최근에 수정된 업무일지를 사용한다.
  */
  matchedLogs.sort((a, b) => {
    const timeA =
      new Date(
        a.updatedAt ||
        a.createdAt ||
        0
      ).getTime();

    const timeB =
      new Date(
        b.updatedAt ||
        b.createdAt ||
        0
      ).getTime();

    return timeB - timeA;
  });

  return matchedLogs[0];
}

function normalizeMemberLogRole(role) {
  const normalizedRole =
    String(role || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");

  const validRoles = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ];

  if (
    validRoles.includes(
      normalizedRole
    )
  ) {
    return normalizedRole;
  }

  if (
    String(role || "").trim() ===
    "파트장"
  ) {
    return "파트장";
  }

  return normalizedRole;
}


function hasImportedEntriesFromRole(
  role
) {
  const targetRole =
    normalizeMemberLogRole(role);

  return appState.editorEntries.some(
    (entry) => {
      return (
        normalizeMemberLogRole(
          entry.importedFromRole
        ) === targetRole
      );
    }
  );
}


function updateMemberLogImportCount() {
  if (!elements.memberLogImportCount) {
    return;
  }

  const importedCount =
    appState.editorEntries.filter(
      (entry) => entry.importedFromRole
    ).length;

  elements.memberLogImportCount.textContent =
    `가져온 내역 ${importedCount}건`;
}

function importMemberLogByRole(
  requestedRole,
  options = {}
) {
  const {
    silent = false
  } = options;

  const normalizedRole =
    normalizeMemberLogRole(
      requestedRole
    );

  const displayRole =
    normalizedRole === "BCO2"
      ? "BCO2"
      : normalizedRole;

  const memberLog =
    findMemberLogByRole(
      normalizedRole
    );

  if (!memberLog) {
    if (!silent) {
      showToast(
        `${displayRole} 업무일지가 아직 작성되지 않았습니다.`
      );
    }

    return {
      role: normalizedRole,
      found: false,
      addedCount: 0,
      duplicateCount: 0
    };
  }

  const memberEntries =
    Array.isArray(memberLog.entries)
      ? memberLog.entries
      : [];

  if (!memberEntries.length) {
    if (!silent) {
      showToast(
        `${displayRole} 업무일지에 가져올 내역이 없습니다.`
      );
    }

    return {
      role: normalizedRole,
      found: true,
      addedCount: 0,
      duplicateCount: 0
    };
  }

  let addedCount = 0;
  let duplicateCount = 0;

  memberEntries.forEach(
    (entry, entryIndex) => {
      const importedEntry = {
        time:
          String(
            entry.time || ""
          ).trim(),

        category:
          String(
            entry.category ||
            "인계사항"
          ).trim(),

        tag:
          String(entry.tag || "")
            .trim()
            .toUpperCase(),

        content:
          String(
            entry.content || ""
          ).trim(),

        /*
          파트장 업무일지에서
          어느 보직의 내역인지 구분하기 위한 정보
        */
        importedFromRole:
          normalizedRole,

        importedFromAuthor:
          String(
            memberLog.author || ""
          ).trim(),

        importedFromLogId:
          String(
            memberLog.id || ""
          ).trim(),

        importedFromEntryIndex:
          entryIndex
      };

      const importKey =
        createImportedEntryUniqueKey(
          importedEntry
        );

      const alreadyImported =
        appState.editorEntries.some(
          (currentEntry) => {
            return (
              createImportedEntryUniqueKey(
                currentEntry
              ) === importKey
            );
          }
        );

      if (alreadyImported) {
        duplicateCount += 1;
        return;
      }

      appState.editorEntries.push(
        importedEntry
      );

      addedCount += 1;
    }
  );

  sortImportedLogEntries();
  renderLogEntryTable();
  updateMemberLogImportStatus();

  if (!silent) {
    if (addedCount > 0) {
      showToast(
        `${displayRole} 업무일지에서 ${addedCount}건을 가져왔습니다.`
      );
    } else {
      showToast(
        `${displayRole} 업무일지는 이미 모두 가져온 상태입니다.`
      );
    }
  }

  return {
    role: normalizedRole,
    found: true,
    addedCount,
    duplicateCount
  };
}

function importAllMemberLogs() {
  const importOrder = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ];

  let foundRoleCount = 0;
  let addedCount = 0;
  let duplicateCount = 0;

  const missingRoles = [];

  importOrder.forEach((role) => {
    const result =
      importMemberLogByRole(
        role,
        {
          silent: true
        }
      );

    if (result.found) {
      foundRoleCount += 1;
    } else {
      missingRoles.push(role);
    }

    addedCount +=
      result.addedCount;

    duplicateCount +=
      result.duplicateCount;
  });

  sortImportedLogEntries();
  renderLogEntryTable();
  updateMemberLogImportStatus();

  if (foundRoleCount === 0) {
    showToast(
      "같은 날짜와 근무에 작성된 팀원 업무일지가 없습니다."
    );

    return;
  }

  if (addedCount === 0) {
    if (missingRoles.length) {
      showToast(
        `작성된 업무일지는 이미 가져왔습니다. 미작성: ${missingRoles.join(", ")}`
      );

      return;
    }

    showToast(
      "6개 보직 업무일지를 이미 모두 가져온 상태입니다."
    );

    return;
  }

  if (missingRoles.length) {
    showToast(
      `총 ${addedCount}건을 가져왔습니다. 미작성: ${missingRoles.join(", ")}`
    );

    return;
  }

  showToast(
    `6개 보직 업무일지에서 총 ${addedCount}건을 가져왔습니다.`
  );
}

function sortImportedLogEntries() {
  const roleOrder = {
    TGO: 1,
    BCO1: 2,
    BCO2: 3,
    TO: 4,
    BO1: 5,
    BO2: 6,
    파트장: 7
  };

  appState.editorEntries.sort(
    (entryA, entryB) => {
      const roleA =
        normalizeMemberLogRole(
          entryA.importedFromRole ||
          "파트장"
        );

      const roleB =
        normalizeMemberLogRole(
          entryB.importedFromRole ||
          "파트장"
        );

      const roleDifference =
        (
          roleOrder[roleA] || 99
        ) -
        (
          roleOrder[roleB] || 99
        );

      if (roleDifference !== 0) {
        return roleDifference;
      }

      return String(
        entryA.time || ""
      ).localeCompare(
        String(entryB.time || "")
      );
    }
  );
}

function createLogEntryImportKey(entry) {
  const time =
    String(entry.time || "")
      .trim();

  const category =
    String(entry.category || "")
      .trim();

  const tag =
    String(entry.tag || "")
      .trim()
      .toUpperCase();

  const content =
    String(entry.content || "")
      .trim()
      .replace(/\s+/g, " ");

  return [
    time,
    category,
    tag,
    content
  ].join("||");
}

function createImportedEntryUniqueKey(
  entry
) {
  const sourceRole =
    normalizeMemberLogRole(
      entry.importedFromRole || ""
    );

  const sourceLogId =
    String(
      entry.importedFromLogId || ""
    ).trim();

  const sourceEntryIndex =
    String(
      entry.importedFromEntryIndex ?? ""
    );

  /*
    가져온 내역은 원본 업무일지 ID와
    원본 항목 위치를 이용해 중복을 판단한다.
  */
  if (
    sourceRole &&
    sourceLogId &&
    sourceEntryIndex !== ""
  ) {
    return [
      "IMPORTED",
      sourceRole,
      sourceLogId,
      sourceEntryIndex
    ].join("||");
  }

  /*
    과거에 저장된 데이터처럼
    원본 항목 번호가 없는 경우에는
    시간·구분·TAG·내용으로 비교한다.
  */
  return [
    "CONTENT",
    sourceRole,
    String(entry.time || "").trim(),
    String(entry.category || "").trim(),
    String(entry.tag || "")
      .trim()
      .toUpperCase(),
    String(entry.content || "")
      .trim()
      .replace(/\s+/g, " ")
  ].join("||");
}

/* =========================================================
   운전현황 관리
========================================================= */

function createDefaultOperationStatus() {
  return {
    type: "normal",
    content:
      "#1 주보일러 정상운전\n" +
      "#2 주보일러 정상운전\n" +
      "GT / ST 정상운전",
    updatedAt: new Date().toISOString(),
    updatedBy: ""
  };
}

function loadOperationStatus() {
  const saved = localStorage.getItem(
    STORAGE_KEYS.operationStatus
  );

  if (!saved) {
    appState.currentOperationStatus =
      createDefaultOperationStatus();
    return;
  }

  try {
    appState.currentOperationStatus =
      JSON.parse(saved);
  } catch (e) {
    appState.currentOperationStatus =
      createDefaultOperationStatus();
  }
}

function saveOperationStatusToStorage() {
  localStorage.setItem(
    STORAGE_KEYS.operationStatus,
    JSON.stringify(
      appState.currentOperationStatus
    )
  );
}

function renderOperationStatusCard() {
  if (
    !elements.operationStatusCurrentContent
  ) {
    return;
  }

  const status =
    appState.currentOperationStatus ||
    createDefaultOperationStatus();

  elements.operationStatusCurrentContent.textContent =
    status.content || "등록된 운전현황이 없습니다.";

  if (elements.operationStatus) {
    elements.operationStatus.value =
      status.content || "";
  }

  if (elements.operationStatusSnapshot) {
    elements.operationStatusSnapshot.value =
      status.content || "";
  }

  if (elements.operationStatusType) {
    elements.operationStatusType.value =
      status.type || "normal";
  }

  if (elements.operationStatusUpdatedAt) {
    elements.operationStatusUpdatedAt.textContent =
      status.updatedAt
        ? `마지막 수정 ${formatDateTime(status.updatedAt)}`
        : "";
  }

  /*
    마지막 저장 작성자는 화면에 표시하지 않는다.
  */
  if (elements.operationStatusUpdatedBy) {
    elements.operationStatusUpdatedBy.textContent = "";
    elements.operationStatusUpdatedBy.hidden = true;
  }
}

function openOperationStatusEditor() {
  if (
    !elements.operationStatusEditor
  ) {
    return;
  }

  elements.operationStatusEditor.hidden =
    false;

  elements.operationStatusSection?.classList.add(
    "is-editing"
  );

  elements.operationStatus?.focus();
}

function closeOperationStatusEditor() {
  if (
    !elements.operationStatusEditor
  ) {
    return;
  }

  elements.operationStatusEditor.hidden =
    true;

  elements.operationStatusSection?.classList.remove(
    "is-editing"
  );
}

function saveOperationStatus() {
  if (!elements.operationStatus) {
    return;
  }

  const content =
    elements.operationStatus.value.trim();

  if (!content) {
    showToast(
      "운전현황을 입력하세요."
    );
    return;
  }

  appState.currentOperationStatus = {
    type:
      elements.operationStatusType?.value ||
      "normal",

    content,

    updatedAt:
      new Date().toISOString(),

    updatedBy:
      elements.logAuthor?.value ||
      ""
  };

  saveOperationStatusToStorage();

  renderOperationStatusCard();

  closeOperationStatusEditor();

  showToast(
    "운전현황이 저장되었습니다."
  );
}

function bindEvents() {
  /*
    요소가 존재할 때만 이벤트를 연결한다.
    일부 HTML 요소가 없더라도 나머지 기능이 중단되지 않는다.
  */
  const bindClick = (element, handler) => {
    if (!element) {
      return;
    }

    element.addEventListener("click", handler);
  };

  const bindChange = (element, handler) => {
    if (!element) {
      return;
    }

    element.addEventListener("change", handler);
  };

  const bindInput = (element, handler) => {
    if (!element) {
      return;
    }

    element.addEventListener("input", handler);
  };

  const bindKeydown = (element, handler) => {
    if (!element) {
      return;
    }

    element.addEventListener("keydown", handler);
  };


  /* =======================================================
    상단 탭
  ======================================================== */

  elements.topTabs.forEach((tab) => {
    bindClick(tab, () => {
      switchView(tab.dataset.view);
    });
  });


  /* =======================================================
    날짜 이동
  ======================================================== */

  bindClick(elements.previousDateButton, () => {
    moveSelectedDate(-1);
  });

  bindClick(elements.nextDateButton, () => {
    moveSelectedDate(1);
  });

  bindClick(elements.todayButton, () => {
    appState.selectedDate = new Date();

    renderSelectedDate();
    renderLogTable();
  });


  /* =======================================================
    업무일지 작성창
  ======================================================== */

  bindClick(elements.openLogEditorButton, () => {
    openLogEditor();
  });

  bindClick(
    elements.closeLogEditorButton,
    closeLogEditor
  );

  bindClick(
    elements.cancelLogButton,
    closeLogEditor
  );

  if (elements.logEditorModal) {
    elements.logEditorModal.addEventListener(
      "click",
      (event) => {
        if (event.target === elements.logEditorModal) {
          closeLogEditor();
        }
      }
    );
  }


  /* =======================================================
    현재 운전현황
  ======================================================== */

  bindClick(
    elements.editOperationStatusButton,
    openOperationStatusEditor
  );

  bindClick(
    elements.cancelOperationStatusButton,
    closeOperationStatusEditor
  );

  bindClick(
    elements.saveOperationStatusButton,
    saveOperationStatus
  );


  /* =======================================================
    작업 구분 및 TAG
  ======================================================== */

  bindChange(
    elements.logEntryCategory,
    updateTagFieldVisibility
  );

  bindClick(
    elements.logEntryNavigatorButton,
    () => {
      openFacilityNavigator(
        elements.logEntryTag?.value || ""
      );
    }
  );


  /* =======================================================
    현재시간
  ======================================================== */

  bindChange(
    elements.useCurrentTimeCheckbox,
    () => {
      if (
        !elements.useCurrentTimeCheckbox.checked
      ) {
        return;
      }

      elements.logEntryTime.value =
        getCurrentTimeValue();

      elements.logEntryTime.classList.add(
        "is-current-time-applied"
      );

      window.setTimeout(() => {
        elements.logEntryTime.classList.remove(
          "is-current-time-applied"
        );
      }, 500);

      elements.logEntryContent?.focus();
    }
  );


  /* =======================================================
    시간 자동 입력
  ======================================================== */

  bindInput(
    elements.logEntryTime,
    handleLogEntryTimeInput
  );

  if (elements.logEntryTime) {
    elements.logEntryTime.addEventListener(
      "blur",
      () => {
        if (
          !elements.logEntryTime.value.trim()
        ) {
          return;
        }

        normalizeLogEntryTime();
      }
    );
  }

  bindKeydown(
    elements.logEntryTime,
    (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();

      const normalizedTime =
        normalizeLogEntryTime();

      if (!normalizedTime) {
        return;
      }

      elements.logEntryCategory?.focus();
    }
  );


  /* =======================================================
    작업내역 추가·수정·삭제
  ======================================================== */

  bindClick(
    elements.addLogEntryButton,
    addOrUpdateLogEntry
  );

  bindClick(
    elements.cancelLogEntryEditButton,
    cancelLogEntryEdit
  );

  if (elements.logEntryTableBody) {
    elements.logEntryTableBody.addEventListener(
      "click",
      handleLogEntryTableClick
    );
  }

  bindKeydown(
    elements.logEntryContent,
    (event) => {
      if (
        event.key === "Enter" &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        addOrUpdateLogEntry();
      }
    }
  );


  /* =======================================================
    첨부파일
  ======================================================== */

  bindChange(
    elements.logAttachments,
    renderAttachmentList
  );

  if (elements.fileDropzone) {
    elements.fileDropzone.addEventListener(
      "dragover",
      (event) => {
        event.preventDefault();

        elements.fileDropzone.classList.add(
          "is-dragging"
        );
      }
    );

    elements.fileDropzone.addEventListener(
      "dragleave",
      () => {
        elements.fileDropzone.classList.remove(
          "is-dragging"
        );
      }
    );

    elements.fileDropzone.addEventListener(
      "drop",
      (event) => {
        event.preventDefault();

        elements.fileDropzone.classList.remove(
          "is-dragging"
        );

        if (!event.dataTransfer.files.length) {
          return;
        }

        try {
          elements.logAttachments.files =
            event.dataTransfer.files;
        } catch {
          showToast(
            "파일을 직접 선택해 주세요."
          );

          return;
        }

        renderAttachmentList();
      }
    );
  }


  /* =======================================================
    업무일지 저장
  ======================================================== */

  if (elements.logEditorForm) {
    elements.logEditorForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        saveCurrentLog("저장완료");
      }
    );
  }

  bindClick(
    elements.saveDraftButton,
    saveDraft
  );

  bindClick(
    elements.printLogButton,
    () => {
      window.print();
    }
  );

  bindClick(
    elements.requestApprovalButton,
    () => {
      saveCurrentLog("결재요청");
    }
  );


  /* =======================================================
    업무일지 목록
  ======================================================== */

  if (elements.logTableBody) {
    elements.logTableBody.addEventListener(
      "click",
      handleLogTableClick
    );
  }


  /* =======================================================
    상세보기
  ======================================================== */

  bindClick(
    elements.closeLogDetailButton,
    closeLogDetail
  );

  bindClick(
    elements.closeLogDetailFooterButton,
    closeLogDetail
  );

  if (elements.logDetailModal) {
    elements.logDetailModal.addEventListener(
      "click",
      (event) => {
        if (event.target === elements.logDetailModal) {
          closeLogDetail();
        }
      }
    );
  }

  bindClick(
    elements.editFromDetailButton,
    () => {
      const log = appState.logs.find(
        (item) =>
          item.id ===
          appState.currentDetailLogId
      );

      if (!log) {
        showToast(
          "업무일지를 찾을 수 없습니다."
        );

        return;
      }

      closeLogDetail();
      openLogEditor(log);
    }
  );


  /* =======================================================
    조회
  ======================================================== */

  if (elements.searchForm) {
    elements.searchForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        runSearch();
      }
    );

    elements.searchForm.addEventListener(
      "reset",
      () => {
        window.setTimeout(() => {
          if (elements.searchResultBody) {
            elements.searchResultBody.innerHTML = "";
          }

          if (elements.searchResultCount) {
            elements.searchResultCount.textContent =
              "0";
          }

          if (elements.searchEmptyState) {
            elements.searchEmptyState.hidden =
              false;

            const title =
              elements.searchEmptyState.querySelector(
                "strong"
              );

            const description =
              elements.searchEmptyState.querySelector(
                "p"
              );

            if (title) {
              title.textContent =
                "조회 조건을 선택해 주세요.";
            }

            if (description) {
              description.textContent =
                "기간, TAG 또는 업무 내용을 기준으로 검색할 수 있습니다.";
            }
          }
        }, 0);
      }
    );
  }


  /* =======================================================
    ESC 키
  ======================================================== */

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (
        elements.operationStatusEditor &&
        !elements.operationStatusEditor.hidden
      ) {
        closeOperationStatusEditor();
        return;
      }

      if (appState.editingEntryIndex >= 0) {
        cancelLogEntryEdit();
        return;
      }

      if (
        elements.logDetailModal?.classList.contains(
          "is-open"
        )
      ) {
        closeLogDetail();
        return;
      }

      if (
        elements.logEditorModal?.classList.contains(
          "is-open"
        )
      ) {
        closeLogEditor();
      }
    }
  );
}

/* =========================================================
  화면 탭
========================================================= */
function switchView(viewName) {
  elements.topTabs.forEach((tab) => {
    const isActive = tab.dataset.view === viewName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  elements.pageViews.forEach((view) => {
    const isActive = view.dataset.pageView === viewName;
    view.classList.toggle("is-active", isActive);
    view.hidden = !isActive;
  });
}


/* =========================================================
  날짜
========================================================= */
function moveSelectedDate(dayOffset) {
  const nextDate = new Date(appState.selectedDate);
  nextDate.setDate(nextDate.getDate() + dayOffset);

  appState.selectedDate = nextDate;
  renderSelectedDate();
  renderLogTable();
}


function renderSelectedDate() {
  const dateText = formatKoreanDate(appState.selectedDate);

  elements.selectedDateText.textContent = dateText;
  elements.selectedShiftBadge.textContent = appState.selectedShift;
  elements.currentShiftLabel.textContent =
    `${dateText} ${appState.selectedShift}`;

  setEditorDateFromSelectedDate();
}


function setEditorDateFromSelectedDate() {
  if (!elements.logDate) {
    return;
  }

  elements.logDate.value = formatInputDate(appState.selectedDate);
  elements.logShift.value = appState.selectedShift;
}


function formatKoreanDate(date) {
  const weekdays = [
    "일요일",
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일"
  ];

  return [
    date.getFullYear(),
    "년 ",
    String(date.getMonth() + 1).padStart(2, "0"),
    "월 ",
    String(date.getDate()).padStart(2, "0"),
    "일 ",
    weekdays[date.getDay()]
  ].join("");
}


function formatInputDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}


/* =========================================================
  업무일지 모달
========================================================= */
function openLogEditor(log = null, preset = null) {
  resetLogEditor();

  if (log) {
    fillLogEditor(log);

    elements.logEditorTitle.textContent =
      `${log.role || ""} 업무일지 수정`;

    updateMemberLogImportSection();

    openModal(elements.logEditorModal);
    return;
  }

  if (preset) {
    if (
      preset.role &&
      [...elements.logRole.options].some(
        (option) =>
          option.value === preset.role
      )
    ) {
      elements.logRole.value =
        preset.role;
    }

    if (preset.author) {
      elements.logAuthor.value =
        preset.author;
    }

    if (
      preset.team &&
      [...elements.logTeam.options].some(
        (option) =>
          option.value === preset.team
      )
    ) {
      elements.logTeam.value =
        preset.team;
    }

    elements.logEditorTitle.textContent =
      `${preset.role || ""} 업무일지 작성`;
  } else {
    elements.logEditorTitle.textContent =
      "업무일지 작성";

    restoreDraftIfAvailable();
  }

  updateMemberLogImportSection();

  openModal(elements.logEditorModal);
}

/* =========================================================
  근무자 카드 → 업무일지 작성·수정
========================================================= */

function bindShiftMemberCards() {
  const shiftMemberGrid =
    document.getElementById("shiftMemberGrid");

  if (!shiftMemberGrid) {
    console.error(
      "shiftMemberGrid 요소를 찾을 수 없습니다."
    );

    return;
  }

  const shiftMemberCards = [
    ...shiftMemberGrid.querySelectorAll(
      ".shift-member-card"
    )
  ];

  shiftMemberCards.forEach((card) => {
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    const role =
      card.dataset.role || "근무자";

    card.setAttribute(
      "aria-label",
      `${role} 업무일지 작성 또는 수정`
    );
  });

  shiftMemberGrid.addEventListener(
    "click",
    (event) => {
      const card = event.target.closest(
        ".shift-member-card"
      );

      if (
        !card ||
        !shiftMemberGrid.contains(card)
      ) {
        return;
      }

      openShiftMemberLogFromCard(card);
    }
  );

  shiftMemberGrid.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }

      const card = event.target.closest(
        ".shift-member-card"
      );

      if (
        !card ||
        !shiftMemberGrid.contains(card)
      ) {
        return;
      }

      event.preventDefault();

      openShiftMemberLogFromCard(card);
    }
  );
}


function openShiftMemberLogFromCard(card) {
  if (!card) {
    showToast(
      "선택한 근무자 정보를 확인할 수 없습니다."
    );

    return;
  }

  const role = String(
    card.dataset.role || ""
  ).trim();

  const author = String(
    card.querySelector(
      ".shift-member-card__name"
    )?.textContent || ""
  ).trim();

  const team = String(
    card.querySelector(
      ".shift-member-card__team"
    )?.textContent || ""
  ).trim();

  if (!role) {
    showToast(
      "선택한 근무자의 보직을 확인할 수 없습니다."
    );

    return;
  }

  const selectedDate =
    formatInputDate(appState.selectedDate);

  const existingLog =
    appState.logs.find((log) => {
      return (
        log.date === selectedDate &&
        log.shift === appState.selectedShift &&
        log.role === role
      );
    });

  if (existingLog) {
    openLogEditor(existingLog);
    return;
  }

  openLogEditor(null, {
    role,
    author,
    team
  });
}


function updateShiftMemberCardStates() {
  const selectedDate =
    formatInputDate(appState.selectedDate);

  const shiftMemberCards = [
    ...document.querySelectorAll(".shift-member-card")
  ];

  shiftMemberCards.forEach((card) => {
    const role =
      String(card.dataset.role || "").trim();

    const statusElement =
      card.querySelector(
        ".shift-member-card__status"
      );

    const existingLog =
      appState.logs.find((log) => {
        return (
          log.date === selectedDate &&
          log.shift === appState.selectedShift &&
          log.role === role
        );
      });

    if (!existingLog) {
      card.dataset.logState = "empty";

      if (statusElement) {
        statusElement.textContent = "미작성";

        statusElement.className =
          "shift-member-card__status is-empty";
      }

      return;
    }

    card.dataset.logState = "existing";

    if (!statusElement) {
      return;
    }

    if (
      existingLog.status === "결재완료" ||
      existingLog.status === "결재요청"
    ) {
      statusElement.textContent =
        existingLog.status === "결재완료"
          ? "작성완료"
          : "결재요청";

      statusElement.className =
        "shift-member-card__status is-complete";

      return;
    }

    if (
      existingLog.status === "임시저장" ||
      existingLog.status === "작성중"
    ) {
      statusElement.textContent = "작성중";

      statusElement.className =
        "shift-member-card__status is-writing";

      return;
    }

    statusElement.textContent = "작성완료";

    statusElement.className =
      "shift-member-card__status is-complete";
  });
}


function closeLogEditor() {
  closeModal(elements.logEditorModal);
}


function resetLogEditor() {
  elements.logEditorForm.reset();

  setEditorDateFromSelectedDate();

  elements.logAuthor.value = "이휘근";
  elements.logTeam.value = "3조";
  elements.logShift.value = appState.selectedShift;
  elements.operationStatus.value = "";
  elements.logNote.value = "";

  elements.logEditorForm.dataset.editingId = "";

  appState.editorEntries = [];
  appState.editingEntryIndex = -1;

  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  renderLogEntryTable();

  elements.logAttachments.value = "";
  elements.attachmentList.innerHTML = "";
}


function fillLogEditor(log) {
  elements.logEditorForm.dataset.editingId =
    log.id || "";

  elements.logDate.value =
    log.date || "";

  elements.logShift.value =
    log.shift || appState.selectedShift;

  elements.logTeam.value =
    log.team || "3조";

  elements.logRole.value =
    log.role || "";

  elements.logAuthor.value =
    log.author || "";

  elements.operationStatus.value =
    log.operationStatus || "";

  if (elements.operationStatusSnapshot) {
    elements.operationStatusSnapshot.value =
      log.operationStatus || "";
  }

  elements.logNote.value =
    log.note || "";

  appState.editorEntries =
    Array.isArray(log.entries)
      ? log.entries.map((entry) => {
          return {
            time:
              entry.time || "",

            category:
              entry.category ||
              "인계사항",

            tag:
              String(entry.tag || "")
                .trim()
                .toUpperCase(),

            content:
              entry.content || "",

            importedFromRole:
              entry.importedFromRole ||
              "",

            importedFromAuthor:
              entry.importedFromAuthor ||
              "",

            importedFromLogId:
              entry.importedFromLogId ||
              ""
          };
        })
      : [];

  appState.editingEntryIndex = -1;

  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  renderLogEntryTable();
  renderSavedAttachments(
    log.attachments || []
  );

  updateMemberLogImportSection();
}


/* =========================================================
  작업 · 정비 · 인계 내역
  단일 입력창 + 누적 테이블
========================================================= */

function resetLogEntryInput(options = {}) {
  const {
    keepCategory = false,
    keepTag = false
  } = options;

  const previousCategory =
    elements.logEntryCategory?.value || "인계사항";

  const previousTag =
    elements.logEntryTag?.value || "";

  /*
    시간은 기본적으로 비워둔다.
    현재시간 체크박스를 누르면 현재 시간이 입력된다.
  */
  elements.logEntryTime.value = "";

  if (elements.useCurrentTimeCheckbox) {
    elements.useCurrentTimeCheckbox.checked = false;
  }

  /*
    새 입력을 시작할 때는 인계사항이 기본이다.
    수정 취소 등 일부 상황에서만 기존 구분을 유지한다.
  */
  elements.logEntryCategory.value = keepCategory
    ? previousCategory
    : "인계사항";

  elements.logEntryTag.value = keepTag
    ? previousTag
    : "";

  elements.logEntryContent.value = "";

  appState.editingEntryIndex = -1;

  elements.addLogEntryButton.textContent = "＋ 추가";
  elements.cancelLogEntryEditButton.hidden = true;

  elements.logEntryInputPanel.classList.remove(
    "is-editing"
  );

  elements.logEntryTableBody
    .querySelectorAll("tr.is-editing")
    .forEach((row) => {
      row.classList.remove("is-editing");
    });

  updateTagFieldVisibility();
}


function addOrUpdateLogEntry() {
  const normalizedTime =
    normalizeLogEntryTime();

  if (!normalizedTime) {
    showToast(
      "시간을 직접 입력하거나 현재시간을 체크해 주세요."
    );

    elements.logEntryTime.focus();
    return;
  }

  const category =
    elements.logEntryCategory.value ||
    "인계사항";

  const needsTag =
    category.startsWith("TM") ||
    category.startsWith("BM") ||
    category.startsWith("CM");

  const tag = needsTag
    ? elements.logEntryTag.value
        .trim()
        .toUpperCase()
    : "";

  const content =
    elements.logEntryContent.value.trim();

  if (!category) {
    showToast(
      "구분을 선택해 주세요."
    );

    elements.logEntryCategory.focus();
    return;
  }

  if (needsTag && !tag) {
    showToast(
      `${category} 내역은 TAG를 입력해 주세요.`
    );

    elements.logEntryTag.focus();
    return;
  }

  if (!content) {
    showToast(
      "작업 내용을 입력해 주세요."
    );

    elements.logEntryContent.focus();
    return;
  }

  const previousEntry =
    appState.editingEntryIndex >= 0
      ? appState.editorEntries[
          appState.editingEntryIndex
        ]
      : null;

  const entry = {
    time:
      normalizedTime,

    category,

    tag,

    content,

    importedFromRole:
      previousEntry
        ?.importedFromRole || "",

    importedFromAuthor:
      previousEntry
        ?.importedFromAuthor || "",

    importedFromLogId:
      previousEntry
        ?.importedFromLogId || ""
  };

  if (
    appState.editingEntryIndex >= 0
  ) {
    appState.editorEntries.splice(
      appState.editingEntryIndex,
      1,
      entry
    );

    showToast(
      "작업 내역을 수정했습니다."
    );
  } else {
    appState.editorEntries.push(
      entry
    );

    showToast(
      "작업 내역을 추가했습니다."
    );
  }

  renderLogEntryTable();

  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  updateMemberLogImportStatus();

  elements.logEntryContent.focus();
}


function renderLogEntryTable() {
  const entries = appState.editorEntries;

  if (elements.logEntryCount) {
    elements.logEntryCount.textContent =
      `총 ${entries.length}건`;
  }

  if (elements.logEntriesJson) {
    elements.logEntriesJson.value =
      JSON.stringify(entries);
  }

  if (!elements.logEntryTableBody) {
    return;
  }

  if (!entries.length) {
    elements.logEntryTableBody.innerHTML = `
      <tr class="log-entry-empty-row">
        <td colspan="4">
          등록된 작업 내역이 없습니다.
        </td>
      </tr>
    `;

    updateMemberLogImportCount();
    return;
  }

  elements.logEntryTableBody.innerHTML = entries
    .map((entry, index) => {
      const isEditing =
        index === appState.editingEntryIndex;

      const sourceRole =
        String(
          entry.importedFromRole ||
          (
            elements.logRole?.value === "파트장"
              ? "파트장"
              : elements.logRole?.value || ""
          )
        ).trim();

      const sourceAuthor =
        String(
          entry.importedFromAuthor || ""
        ).trim();

      const sourceClass =
        getLogEntrySourceClass(sourceRole);

      const sourceTitle = sourceAuthor
        ? `${sourceRole} · ${sourceAuthor}`
        : sourceRole;

      const sourceBadgeHtml = sourceRole
        ? `
          <span
            class="
              log-entry-source-badge
              ${sourceClass}
            "
            title="${escapeHtml(sourceTitle)}"
          >
            ${escapeHtml(sourceRole)}
          </span>
        `
        : "";

      const tagHtml = entry.tag
        ? `
          <button
            type="button"
            class="log-entry-inline-tag"
            data-entry-action="navigator"
            data-entry-index="${index}"
            title="Facility Navigator에서 설비 보기"
          >
            [${escapeHtml(entry.tag)}]
          </button>
        `
        : "";

      return `
        <tr
          data-entry-index="${index}"
          class="${isEditing ? "is-editing" : ""}"
        >
          <td>
            ${escapeHtml(entry.time || "-")}
          </td>

          <td>
            <div class="log-entry-category-cell">
              ${sourceBadgeHtml}

              <span class="log-entry-category-text">
                ${escapeHtml(entry.category || "-")}
              </span>
            </div>
          </td>

          <td>
            <div class="log-entry-inline-content">
              ${tagHtml}

              <span class="log-entry-inline-content__text">
                ${escapeHtml(entry.content || "-")}
              </span>
            </div>
          </td>

          <td>
            <div class="log-entry-row-actions">
              <button
                type="button"
                class="log-entry-edit-button"
                data-entry-action="edit"
                data-entry-index="${index}"
              >
                수정
              </button>

              <button
                type="button"
                class="log-entry-delete-button"
                data-entry-action="delete"
                data-entry-index="${index}"
              >
                삭제
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  updateMemberLogImportCount();
}

function getLogEntrySourceClass(role) {
  const normalizedRole =
    String(role || "")
      .trim()
      .toUpperCase();

  if (normalizedRole === "TGO") {
    return "is-tgo";
  }

  if (normalizedRole === "BCO1") {
    return "is-bco1";
  }

  if (
    normalizedRole === "BCO2" ||
    normalizedRole === "BO2"
  ) {
    return "is-bco2";
  }

  if (
    normalizedRole === "파트장"
  ) {
    return "is-leader";
  }

  return "is-default";
}

function handleLogEntryTableClick(event) {
  const actionButton = event.target.closest(
    "[data-entry-action]"
  );

  if (!actionButton) {
    return;
  }

  const entryIndex = Number(
    actionButton.dataset.entryIndex
  );

  if (
    !Number.isInteger(entryIndex) ||
    !appState.editorEntries[entryIndex]
  ) {
    showToast("작업 내역을 찾을 수 없습니다.");
    return;
  }

  const action = actionButton.dataset.entryAction;

  if (action === "edit") {
    startLogEntryEdit(entryIndex);
    return;
  }

  if (action === "delete") {
    deleteLogEntry(entryIndex);
    return;
  }

  if (action === "navigator") {
    openFacilityNavigator(
      appState.editorEntries[entryIndex].tag
    );
  }
}


function startLogEntryEdit(entryIndex) {
  const entry = appState.editorEntries[entryIndex];

  if (!entry) {
    return;
  }

  appState.editingEntryIndex = entryIndex;

  elements.logEntryTime.value =
    entry.time || "";

  if (elements.useCurrentTimeCheckbox) {
    elements.useCurrentTimeCheckbox.checked = false;
  }

  elements.logEntryCategory.value =
    entry.category || "인계사항";

  elements.logEntryTag.value =
    entry.tag || "";

  elements.logEntryContent.value =
    entry.content || "";

  elements.addLogEntryButton.textContent =
    "수정 완료";

  elements.cancelLogEntryEditButton.hidden = false;

  elements.logEntryInputPanel.classList.add(
    "is-editing"
  );

  updateTagFieldVisibility();
  renderLogEntryTable();

  elements.logEntryInputPanel.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  elements.logEntryContent.focus();
}


function cancelLogEntryEdit() {
  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  renderLogEntryTable();
}


function deleteLogEntry(entryIndex) {
  const entry = appState.editorEntries[entryIndex];

  if (!entry) {
    return;
  }

  const shouldDelete = window.confirm(
    [
      "이 작업 내역을 삭제하시겠습니까?",
      "",
      `${entry.time || "-"} / ${entry.category || "-"}`,
      entry.tag || "",
      entry.content || ""
    ]
      .filter(Boolean)
      .join("\n")
  );

  if (!shouldDelete) {
    return;
  }

  appState.editorEntries.splice(entryIndex, 1);

  if (appState.editingEntryIndex === entryIndex) {
    resetLogEntryInput({
      keepCategory: true,
      keepTag: true
    });
  } else if (appState.editingEntryIndex > entryIndex) {
    appState.editingEntryIndex -= 1;
  }

  renderLogEntryTable();
  showToast("작업 내역을 삭제했습니다.");
}

/* =========================================================
  작업 시간 자동 입력
========================================================= */

function handleLogEntryTimeInput(event) {
  const input = event?.target || elements.logEntryTime;

  if (!input) {
    return;
  }

  const cursorPosition =
    typeof input.selectionStart === "number"
      ? input.selectionStart
      : 0;

  const previousValue = input.value;

  let digits = previousValue.replace(/\D/g, "");

  /*
    HHMM까지만 입력 가능
  */
  digits = digits.slice(0, 4);

  let formattedValue = "";

  if (digits.length <= 2) {
    formattedValue = digits;
  } else {
    formattedValue =
      `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }

  input.value = formattedValue;

  /*
    현재시간 체크 후 사용자가 직접 수정하면
    체크 상태를 해제한다.
  */
  if (
    elements.useCurrentTimeCheckbox &&
    elements.useCurrentTimeCheckbox.checked
  ) {
    elements.useCurrentTimeCheckbox.checked = false;
  }

  /*
    입력 도중 커서가 어색하게 이동하지 않도록 처리
  */
  if (
    document.activeElement === input &&
    typeof input.setSelectionRange === "function"
  ) {
    let nextCursorPosition = cursorPosition;

    if (
      previousValue.length < formattedValue.length &&
      formattedValue.includes(":") &&
      cursorPosition >= 2
    ) {
      nextCursorPosition = cursorPosition + 1;
    }

    window.requestAnimationFrame(() => {
      const safeCursorPosition = Math.min(
        nextCursorPosition,
        input.value.length
      );

      input.setSelectionRange(
        safeCursorPosition,
        safeCursorPosition
      );
    });
  }
}

function normalizeLogEntryTime() {
  const rawValue = String(elements.logEntryTime.value || "").trim();

  if (!rawValue) {
    return "";
  }

  const normalizedValue = rawValue
    .replace(/[.\s]/g, ":")
    .replace(/[^0-9:]/g, "");

  let hour = "";
  let minute = "";

  if (normalizedValue.includes(":")) {
    const parts = normalizedValue.split(":");

    hour = parts[0] || "";
    minute = parts[1] || "";
  } else {
    const digits = normalizedValue.replace(/\D/g, "");

    if (digits.length <= 2) {
      hour = digits;
      minute = "00";
    } else if (digits.length === 3) {
      hour = digits.slice(0, 1);
      minute = digits.slice(1);
    } else {
      hour = digits.slice(0, 2);
      minute = digits.slice(2, 4);
    }
  }

  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);

  if (
    !Number.isInteger(hourNumber) ||
    !Number.isInteger(minuteNumber) ||
    hourNumber < 0 ||
    hourNumber > 23 ||
    minuteNumber < 0 ||
    minuteNumber > 59
  ) {
    showToast("시간을 00:00부터 23:59 사이로 입력해 주세요.");
    elements.logEntryTime.focus();
    elements.logEntryTime.select();
    return "";
  }

  const formattedTime = [
    String(hourNumber).padStart(2, "0"),
    String(minuteNumber).padStart(2, "0")
  ].join(":");

  elements.logEntryTime.value = formattedTime;

  return formattedTime;
}

function updateTagFieldVisibility() {

    const value =
        elements.logEntryCategory.value;

    const needTag =
        value.startsWith("TM") ||
        value.startsWith("BM") ||
        value.startsWith("CM");

    elements.logEntryTagField.hidden =
        !needTag;

    if (!needTag) {
        elements.logEntryTag.value = "";
    }

}

function getCurrentTimeValue() {
  const now = new Date();

  return [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0")
  ].join(":");
}


/* =========================================================
  TAG / Facility Navigator
========================================================= */
function openFacilityNavigator(rawTag) {
  const tag = String(rawTag || "").trim().toUpperCase();

  if (!tag) {
    showToast("먼저 TAG를 입력해 주세요.");
    return;
  }

  const targetUrl =
    `${FACILITY_NAVIGATOR_URL}?tag=${encodeURIComponent(tag)}`;

  window.open(targetUrl, "_blank", "noopener,noreferrer");
}


/* =========================================================
  첨부파일
========================================================= */
function renderAttachmentList() {
  const files = [...elements.logAttachments.files];

  if (!files.length) {
    elements.attachmentList.innerHTML = "";
    return;
  }

  elements.attachmentList.innerHTML = files
    .map((file) => {
      return `
        <span class="attachment-chip">
          ${escapeHtml(file.name)}
        </span>
      `;
    })
    .join("");
}


function renderSavedAttachments(attachments) {
  if (!attachments.length) {
    elements.attachmentList.innerHTML = "";
    return;
  }

  elements.attachmentList.innerHTML = attachments
    .map((fileName) => {
      return `
        <span class="attachment-chip">
          ${escapeHtml(fileName)}
        </span>
      `;
    })
    .join("");
}


/* =========================================================
  저장
========================================================= */
function collectEditorData(status) {
  const entries =
    appState.editorEntries.map(
      (entry) => {
        return {
          time:
            entry.time || "",

          category:
            entry.category || "",

          tag:
            String(entry.tag || "")
              .trim()
              .toUpperCase(),

          content:
            String(entry.content || "")
              .trim(),

          importedFromRole:
            entry.importedFromRole ||
            "",

          importedFromAuthor:
            entry.importedFromAuthor ||
            "",

          importedFromLogId:
            entry.importedFromLogId ||
            ""
        };
      }
    );

  const newAttachmentNames =
    elements.logAttachments
      ? [
          ...elements.logAttachments.files
        ].map((file) => file.name)
      : [];

  const savedAttachmentNames =
    elements.attachmentList
      ? [
          ...elements.attachmentList.querySelectorAll(
            ".attachment-chip"
          )
        ].map((chip) =>
          chip.textContent.trim()
        )
      : [];

  const attachmentNames = [
    ...new Set([
      ...savedAttachmentNames,
      ...newAttachmentNames
    ])
  ];

  const editingId =
    elements.logEditorForm
      .dataset.editingId;

  const currentOperationStatus =
    elements.operationStatusSnapshot
      ?.value?.trim() ||
    elements.operationStatus
      ?.value?.trim() ||
    appState.currentOperationStatus
      ?.content ||
    "";

  return {
    id:
      editingId || createId(),

    date:
      elements.logDate.value,

    shift:
      elements.logShift.value,

    team:
      elements.logTeam.value,

    role:
      elements.logRole.value,

    author:
      elements.logAuthor.value.trim(),

    operationStatus:
      currentOperationStatus,

    entries,

    note:
      elements.logNote.value.trim(),

    attachments:
      attachmentNames,

    status,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()
  };
}


function saveCurrentLog(status) {
  if (!elements.logEditorForm.reportValidity()) {
    return;
  }

  const log = collectEditorData(status);

  if (
    !log.operationStatus &&
    !log.entries.some((entry) => entry.content) &&
    !log.note
  ) {
    showToast("운전 현황 또는 업무 내용을 입력해 주세요.");
    return;
  }

  const existingIndex = appState.logs.findIndex(
    (item) => item.id === log.id
  );

  if (existingIndex >= 0) {
    log.createdAt = appState.logs[existingIndex].createdAt;
    appState.logs.splice(existingIndex, 1, log);
  } else {
    appState.logs.unshift(log);
  }

  persistLogs();
  localStorage.removeItem(STORAGE_KEYS.draft);

  appState.selectedDate = new Date(`${log.date}T00:00:00`);
  appState.selectedShift = log.shift;

  renderSelectedDate();
  renderLogTable();
  closeLogEditor();

  showToast(
    status === "결재요청"
      ? "업무일지를 저장하고 결재를 요청했습니다."
      : "업무일지를 저장했습니다."
  );
}


function saveDraft() {
  const draft = collectEditorData("임시저장");

  localStorage.setItem(
    STORAGE_KEYS.draft,
    JSON.stringify(draft)
  );

  showToast("작성 중인 업무일지를 임시저장했습니다.");
}


function restoreDraftIfAvailable() {
  const rawDraft = localStorage.getItem(STORAGE_KEYS.draft);

  if (!rawDraft) {
    return;
  }

  let draft;

  try {
    draft = JSON.parse(rawDraft);
  } catch {
    localStorage.removeItem(STORAGE_KEYS.draft);
    return;
  }

  const shouldRestore = window.confirm(
    "임시저장된 업무일지가 있습니다.\n불러오시겠습니까?"
  );

  if (!shouldRestore) {
    return;
  }

  fillLogEditor(draft);
  elements.logEditorForm.dataset.editingId = "";
  elements.logEditorTitle.textContent = "업무일지 작성";
}


function persistLogs() {
  localStorage.setItem(
    STORAGE_KEYS.logs,
    JSON.stringify(appState.logs)
  );
}


function loadLogs() {
  const savedLogs = localStorage.getItem(STORAGE_KEYS.logs);

  if (savedLogs) {
    try {
      appState.logs = JSON.parse(savedLogs);
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEYS.logs);
    }
  }

  appState.logs = createSampleLogs();
  persistLogs();
}


/* =========================================================
  업무일지 목록
========================================================= */
function renderLogTable() {
  const selectedDateText =
    formatInputDate(appState.selectedDate);

  const filteredLogs =
    appState.logs.filter((log) => {
      return (
        log.date === selectedDateText &&
        log.shift === appState.selectedShift
      );
    });

  elements.logTableBody.innerHTML = "";

  elements.logEmptyState.hidden =
    filteredLogs.length > 0;

  if (!filteredLogs.length) {
    updateShiftMemberCardStates();
    return;
  }

  filteredLogs.forEach((log) => {
    elements.logTableBody.insertAdjacentHTML(
      "beforeend",
      createLogRowHtml(log)
    );
  });

  updateShiftMemberCardStates();
}


function createLogRowHtml(log) {
  const previewGroups = [];

  if (log.operationStatus) {
    previewGroups.push({
      title: "운전현황",
      text: firstMeaningfulLine(log.operationStatus),
      categoryClass: "is-operation"
    });
  }

  const firstEntry = log.entries?.find(
    (entry) => entry.content
  );

  if (firstEntry) {
    const mainCategory = getMainCategory(
      firstEntry.category
    );

    const tagText = firstEntry.tag
      ? `[${firstEntry.tag}]`
      : "";

    previewGroups.push({
      title: mainCategory,
      tag: tagText,
      text: firstMeaningfulLine(firstEntry.content),
      categoryClass:
        mainCategory === "인계사항"
          ? "is-handover"
          : "is-maintenance"
    });
  }

  if (log.note && previewGroups.length < 3) {
    previewGroups.push({
      title: "비고",
      text: firstMeaningfulLine(log.note),
      categoryClass: "is-note"
    });
  }

  const attachmentCount = Array.isArray(log.attachments)
    ? log.attachments.length
    : 0;

  return `
    <tr class="log-row">
      <td class="log-row__role">
        ${escapeHtml(log.role || "-")}
      </td>

      <td class="log-row__author-cell">
        <strong class="log-row__author">
          ${escapeHtml(log.author || "-")}
        </strong>
      </td>

      <td class="log-row__status-cell">
        <span
          class="status-badge ${getStatusClass(log.status)}"
        >
          ${escapeHtml(log.status || "-")}
        </span>
      </td>

      <td class="log-row__attachment-cell">
        ${
          attachmentCount > 0
            ? `
              <span
                class="attachment-indicator"
                title="첨부파일 ${attachmentCount}개"
                aria-label="첨부파일 ${attachmentCount}개"
              >
                📎
              </span>
            `
            : `
              <span
                class="attachment-indicator is-empty"
                aria-label="첨부파일 없음"
              >
                -
              </span>
            `
        }
      </td>

      <td class="log-row__preview-cell">
        <button
          type="button"
          class="log-preview"
          data-action="view"
          data-log-id="${escapeHtml(log.id)}"
          aria-label="${escapeHtml(log.author || "")} 업무일지 상세보기"
        >
          ${
            previewGroups.length
              ? previewGroups
                  .map((group) => {
                    return `
                      <span
                        class="
                          log-preview__group
                          ${group.categoryClass}
                        "
                      >
                        <strong
                          class="log-preview__title"
                        >
                          ${escapeHtml(group.title)}
                        </strong>

                        <span
                          class="log-preview__content"
                        >
                          ${
                            group.tag
                              ? `
                                <span
                                  class="log-preview__tag"
                                >
                                  ${escapeHtml(group.tag)}
                                </span>
                              `
                              : ""
                          }

                          <span
                            class="log-preview__text"
                          >
                            ${escapeHtml(group.text || "-")}
                          </span>
                        </span>
                      </span>
                    `;
                  })
                  .join("")
              : `
                <span class="log-preview__empty">
                  등록된 업무 내용이 없습니다.
                </span>
              `
          }
        </button>
      </td>

      <td class="log-row__actions-cell">
        <div class="row-actions">
          <button
            type="button"
            class="table-action-button"
            data-action="view"
            data-log-id="${escapeHtml(log.id)}"
          >
            보기
          </button>

          <button
            type="button"
            class="table-action-button"
            data-action="edit"
            data-log-id="${escapeHtml(log.id)}"
          >
            수정
          </button>
        </div>
      </td>
    </tr>
  `;
}


function handleLogTableClick(event) {
  const actionButton = event.target.closest("[data-action]");

  if (!actionButton) {
    return;
  }

  const log = appState.logs.find(
    (item) => item.id === actionButton.dataset.logId
  );

  if (!log) {
    showToast("업무일지를 찾을 수 없습니다.");
    return;
  }

  if (actionButton.dataset.action === "edit") {
    openLogEditor(log);
    return;
  }

  openLogDetail(log);
}


function getStatusClass(status) {
  if (status === "결재완료" || status === "결재요청") {
    return "is-approved";
  }

  if (status === "작성중" || status === "임시저장") {
    return "is-writing";
  }

  return "is-saved";
}

function createRoleGroupedEntriesHtml(
  entries,
  log,
  groupTitle
) {
  if (
    !Array.isArray(entries) ||
    !entries.length
  ) {
    return `
      <p class="detail-empty">
        등록된 내역이 없습니다.
      </p>
    `;
  }

  const roleOrder = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2",
    "파트장"
  ];

  const groupedEntries = {};

  entries.forEach((entry) => {
    const role =
      normalizeMemberLogRole(
        entry.importedFromRole ||
        log.role ||
        "파트장"
      );

    if (!groupedEntries[role]) {
      groupedEntries[role] = [];
    }

    groupedEntries[role].push(entry);
  });

  Object.values(
    groupedEntries
  ).forEach((roleEntries) => {
    roleEntries.sort((entryA, entryB) => {
      return String(
        entryA.time || ""
      ).localeCompare(
        String(entryB.time || "")
      );
    });
  });

  const orderedRoles = [
    ...roleOrder.filter(
      (role) =>
        groupedEntries[role]?.length
    ),

    ...Object.keys(groupedEntries).filter(
      (role) =>
        !roleOrder.includes(role)
    )
  ];

  return orderedRoles
    .map((role) => {
      const roleEntries =
        groupedEntries[role];

      return `
        <section class="detail-role-group">
          <h4 class="detail-role-group__title">
            ※ ${escapeHtml(role)}
            ${escapeHtml(groupTitle)}
          </h4>

          <div class="detail-role-group__entries">
            ${roleEntries
              .map((entry, index) => {
                return createGroupedEntryLineHtml(
                  entry,
                  index
                );
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
}


function createGroupedEntryLineHtml(
  entry,
  index
) {
  const timeText =
    String(entry.time || "").trim();

  const tagText =
    String(entry.tag || "")
      .trim()
      .toUpperCase();

  const contentText =
    String(entry.content || "-")
      .trim();

  return `
    <div class="detail-grouped-entry-line">
      <span class="detail-grouped-entry-line__number">
        ${index + 1}.
      </span>

      ${
        timeText
          ? `
            <span class="detail-grouped-entry-line__time">
              ${escapeHtml(timeText)}
            </span>
          `
          : ""
      }

      <span class="detail-grouped-entry-line__content">
        ${
          tagText
            ? `
              <button
                type="button"
                class="detail-inline-tag"
                data-detail-tag="${escapeHtml(tagText)}"
                title="Facility Navigator에서 설비 보기"
              >[${escapeHtml(tagText)}]</button>
            `
            : ""
        }${
          tagText
            ? " "
            : ""
        }<span class="detail-grouped-entry-line__content-text">${escapeHtml(contentText)}</span>
      </span>
    </div>
  `;
}

function createNormalDetailEntriesHtml(
  entries
) {
  if (
    !Array.isArray(entries) ||
    !entries.length
  ) {
    return `
      <p class="detail-empty">
        등록된 내역이 없습니다.
      </p>
    `;
  }

  const sortedEntries = [
    ...entries
  ].sort((entryA, entryB) => {
    return String(
      entryA.time || ""
    ).localeCompare(
      String(entryB.time || "")
    );
  });

  return sortedEntries
    .map((entry, index) => {
      return createGroupedEntryLineHtml(
        entry,
        index
      );
    })
    .join("");
}

function openLogDetail(log) {
  appState.currentDetailLogId = log.id;

  const isLeaderLog =
    normalizeMemberLogRole(
      log.role
    ) === "파트장";

  const allEntries =
    Array.isArray(log.entries)
      ? log.entries
      : [];

  const maintenanceEntries =
    allEntries.filter((entry) => {
      const mainCategory =
        getMainCategory(
          entry.category
        );

      return [
        "TM",
        "BM",
        "CM"
      ].includes(mainCategory);
    });

  const handoverEntries =
    allEntries.filter((entry) => {
      return (
        getMainCategory(
          entry.category
        ) === "인계사항"
      );
    });

  const maintenanceHtml =
    isLeaderLog
      ? createRoleGroupedEntriesHtml(
          maintenanceEntries,
          log,
          "정비 및 작업사항"
        )
      : createNormalDetailEntriesHtml(
          maintenanceEntries
        );

  const handoverHtml =
    isLeaderLog
      ? createRoleGroupedEntriesHtml(
          handoverEntries,
          log,
          "운전 및 작업사항"
        )
      : createNormalDetailEntriesHtml(
          handoverEntries
        );

  const operationStatusText =
    String(
      log.operationStatus || ""
    ).trim();

  const operationStatusHtml =
    operationStatusText
      ? `
        <div class="detail-operation-status-text">
          ${escapeHtml(
            operationStatusText
          )}
        </div>
      `
      : `
        <p class="detail-empty">
          등록된 내용이 없습니다.
        </p>
      `;

  elements.logDetailContent.innerHTML = `
    <section class="detail-summary-grid">
      <div>
        <span>작성일</span>
        <strong>
          ${escapeHtml(log.date || "-")}
        </strong>
      </div>

      <div>
        <span>근무</span>
        <strong>
          ${escapeHtml(log.shift || "-")}
        </strong>
      </div>

      <div>
        <span>근무조</span>
        <strong>
          ${escapeHtml(log.team || "-")}
        </strong>
      </div>

      <div>
        <span>보직</span>
        <strong>
          ${escapeHtml(log.role || "-")}
        </strong>
      </div>

      <div>
        <span>작성자</span>
        <strong>
          ${escapeHtml(log.author || "-")}
        </strong>
      </div>

      <div>
        <span>상태</span>
        <strong>
          ${escapeHtml(log.status || "-")}
        </strong>
      </div>
    </section>

    <section class="detail-section">
      <h3>운전 현황</h3>

      <div class="detail-operation-status">
        ${operationStatusHtml}
      </div>
    </section>

    <section class="detail-section">
      <h3>TM 내역</h3>

      <div class="detail-role-entry-list">
        ${maintenanceHtml}
      </div>
    </section>

    <section class="detail-section">
      <h3>인계사항</h3>

      <div class="detail-role-entry-list">
        ${handoverHtml}
      </div>
    </section>

    <section class="detail-section">
      <h3>비고</h3>

      <p class="detail-multiline">
        ${escapeHtml(
          log.note ||
          "등록된 내용이 없습니다."
        )}
      </p>
    </section>

    <section class="detail-section">
      <h3>첨부파일</h3>

      <div class="attachment-list">
        ${
          Array.isArray(log.attachments) &&
          log.attachments.length
            ? log.attachments
                .map((fileName) => {
                  return `
                    <span class="attachment-chip">
                      ${escapeHtml(fileName)}
                    </span>
                  `;
                })
                .join("")
            : `
              <span class="detail-empty">
                첨부파일 없음
              </span>
            `
        }
      </div>
    </section>
  `;

  elements.logDetailContent
    .querySelectorAll(
      "[data-detail-tag]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          openFacilityNavigator(
            button.dataset.detailTag
          );
        }
      );
    });

  openModal(
    elements.logDetailModal
  );
}


function closeLogDetail() {
  appState.currentDetailLogId = null;
  closeModal(elements.logDetailModal);
}


/* =========================================================
  조회
========================================================= */
function runSearch() {
  const formData = new FormData(elements.searchForm);

  const startDate = String(formData.get("startDate") || "");
  const endDate = String(formData.get("endDate") || "");
  const shift = String(formData.get("shift") || "");
  const role = String(formData.get("role") || "");
  const category = String(formData.get("category") || "");
  const keyword = String(formData.get("keyword") || "")
    .trim()
    .toLowerCase();

  const results = [];

  appState.logs.forEach((log) => {
    if (startDate && log.date < startDate) {
      return;
    }

    if (endDate && log.date > endDate) {
      return;
    }

    if (shift && log.shift !== shift) {
      return;
    }

    if (role && log.role !== role) {
      return;
    }

    if (
      !category ||
      category === "operation" ||
      category === "note"
    ) {
      if (
        (!category || category === "operation") &&
        matchesKeyword(log.operationStatus, keyword)
      ) {
        results.push({
          log,
          category: "운전현황",
          tag: "",
          content: log.operationStatus
        });
      }

      if (
        (!category || category === "note") &&
        matchesKeyword(log.note, keyword)
      ) {
        results.push({
          log,
          category: "비고",
          tag: "",
          content: log.note
        });
      }
    }

    log.entries.forEach((entry) => {
      const mainCategory = getMainCategory(entry.category);
      const normalizedCategory = mainCategory.toLowerCase();

      if (
        category &&
        category !== normalizedCategory &&
        !(category === "handover" && mainCategory === "인계사항")
      ) {
        return;
      }

      const combinedText =
        `${entry.tag} ${entry.content} ${entry.category}`.toLowerCase();

      if (keyword && !combinedText.includes(keyword)) {
        return;
      }

      results.push({
        log,
        category: entry.category,
        tag: entry.tag,
        content: entry.content
      });
    });
  });

  renderSearchResults(results);
}


function renderSearchResults(results) {
  elements.searchResultBody.innerHTML = "";
  elements.searchResultCount.textContent = String(results.length);
  elements.searchEmptyState.hidden = results.length > 0;

  if (!results.length) {
    elements.searchEmptyState.querySelector("strong").textContent =
      "조회 결과가 없습니다.";
    elements.searchEmptyState.querySelector("p").textContent =
      "검색 조건을 변경하여 다시 조회해 주세요.";
    return;
  }

  results.forEach((result) => {
    const { log } = result;

    elements.searchResultBody.insertAdjacentHTML(
      "beforeend",
      `
        <tr>
          <td>${escapeHtml(log.date)}</td>
          <td>${escapeHtml(log.shift)}</td>
          <td>${escapeHtml(log.role)}</td>
          <td>${escapeHtml(log.author)}</td>
          <td>${escapeHtml(result.category)}</td>
          <td>
            ${
              result.tag
                ? `
                  <button
                    type="button"
                    class="detail-tag-button"
                    data-search-tag="${escapeHtml(result.tag)}"
                  >
                    ${escapeHtml(result.tag)}
                  </button>
                `
                : "-"
            }
          </td>
          <td>${escapeHtml(firstMeaningfulLine(result.content || "-"))}</td>
          <td>
            <button
              type="button"
              class="table-action-button"
              data-search-view="${escapeHtml(log.id)}"
            >
              보기
            </button>
          </td>
        </tr>
      `
    );
  });

  elements.searchResultBody
    .querySelectorAll("[data-search-tag]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openFacilityNavigator(button.dataset.searchTag);
      });
    });

  elements.searchResultBody
    .querySelectorAll("[data-search-view]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const log = appState.logs.find(
          (item) => item.id === button.dataset.searchView
        );

        if (log) {
          openLogDetail(log);
        }
      });
    });
}


function matchesKeyword(text, keyword) {
  if (!text) {
    return false;
  }

  if (!keyword) {
    return true;
  }

  return String(text).toLowerCase().includes(keyword);
}


/* =========================================================
  모달 / 토스트
========================================================= */
function openModal(modalElement) {
  modalElement.classList.add("is-open");
  modalElement.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}


function closeModal(modalElement) {
  modalElement.classList.remove("is-open");
  modalElement.setAttribute("aria-hidden", "true");

  const anyOpenModal = document.querySelector(
    ".modal-backdrop.is-open"
  );

  if (!anyOpenModal) {
    document.body.classList.remove("modal-open");
  }
}


let toastTimer = null;

function showToast(message) {
  window.clearTimeout(toastTimer);

  elements.appToast.textContent = message;
  elements.appToast.classList.add("is-visible");

  toastTimer = window.setTimeout(() => {
    elements.appToast.classList.remove("is-visible");
  }, 2600);
}


/* =========================================================
  공통
========================================================= */
function firstMeaningfulLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}


function getMainCategory(category) {
  const value = String(category || "");

  if (value.startsWith("TM")) {
    return "TM";
  }

  if (value.startsWith("BM")) {
    return "BM";
  }

  if (value.startsWith("CM")) {
    return "CM";
  }

  if (value === "인계사항") {
    return "인계사항";
  }

  return "비고";
}


function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `log-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
  샘플 데이터
========================================================= */
function createSampleLogs() {
  return [
    {
      id: "sample-1",
      date: "2026-07-20",
      shift: "NS",
      team: "3조",
      role: "파트장",
      author: "홍길동",
      operationStatus:
        "#1 주보일러 정상운전\n#2 주보일러 정상운전\nGT / ST 정상운전",
      entries: [
        {
          time: "09:50",
          category: "TM 작업",
          tag: "10HFB10AF001",
          content: "Bio Rotary Feeder Bearing 점검"
        },
        {
          time: "18:20",
          category: "인계사항",
          tag: "",
          content: "주간근무 시 #1 석회석 공급계통 확인"
        }
      ],
      note: "특이사항 없음",
      attachments: [
        "TM_Bio_Rotary_Feeder.pdf",
        "현장사진.jpg"
      ],
      status: "결재완료",
      createdAt: "2026-07-20T09:00:00.000Z",
      updatedAt: "2026-07-20T13:00:00.000Z"
    },
    {
      id: "sample-2",
      date: "2026-07-20",
      shift: "NS",
      team: "3조",
      role: "TGO",
      author: "김철수",
      operationStatus: "GT / ST 정상운전",
      entries: [
        {
          time: "11:20",
          category: "BM 작업",
          tag: "10LBA10AA001",
          content: "Main Steam TCV 동작 상태 확인"
        }
      ],
      note: "",
      attachments: [],
      status: "작성중",
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T11:30:00.000Z"
    },
    {
      id: "sample-3",
      date: "2026-07-20",
      shift: "NS",
      team: "3조",
      role: "BCO1",
      author: "이영희",
      operationStatus: "#1, #2 보일러 정상운전",
      entries: [
        {
          time: "14:10",
          category: "CM 작업",
          tag: "10HFB10AF001",
          content: "진동 상태 확인"
        }
      ],
      note: "특이사항 없음",
      attachments: ["진동측정.jpg"],
      status: "저장완료",
      createdAt: "2026-07-20T13:10:00.000Z",
      updatedAt: "2026-07-20T14:20:00.000Z"
    }
  ];
}
