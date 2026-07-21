"use strict";

/* =========================================================
  로그인 시스템
========================================================= */

const AUTH_STORAGE_KEY =
  "gsShiftLog.currentUser";


function getLoginElements() {
  return {
    loginScreen:
      document.getElementById(
        "loginScreen"
      ),

    appShell:
      document.getElementById(
        "appShell"
      ),

    loginForm:
      document.getElementById(
        "loginForm"
      ),

    loginEmployeeId:
      document.getElementById(
        "loginEmployeeId"
      ),

    loginPassword:
      document.getElementById(
        "loginPassword"
      ),

    loginError:
      document.getElementById(
        "loginError"
      ),

    headerUserName:
      document.getElementById(
        "headerUserName"
      ),

    logoutButton:
      document.getElementById(
        "logoutButton"
      )
  };
}


function showLoginError(message) {
  const {
    loginError
  } =
    getLoginElements();

  if (!loginError) {
    return;
  }

  loginError.textContent =
    String(
      message ||
      "로그인에 실패했습니다."
    );

  loginError.hidden =
    false;
}


function hideLoginError() {
  const {
    loginError
  } =
    getLoginElements();

  if (!loginError) {
    return;
  }

  loginError.textContent =
    "";

  loginError.hidden =
    true;
}


function saveCurrentUser(user) {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify(user)
  );
}


function loadCurrentUser() {
  const savedUser =
    localStorage.getItem(
      AUTH_STORAGE_KEY
    );

  if (!savedUser) {
    return null;
  }

  try {
    return JSON.parse(
      savedUser
    );
  } catch (error) {
    localStorage.removeItem(
      AUTH_STORAGE_KEY
    );

    return null;
  }
}


function clearCurrentUser() {
  localStorage.removeItem(
    AUTH_STORAGE_KEY
  );
}


function openShiftLogApp(user) {
  const {
    loginScreen,
    appShell,
    headerUserName
  } =
    getLoginElements();

  if (loginScreen) {
    loginScreen.hidden =
      true;
  }

  if (appShell) {
    appShell.hidden =
      false;
  }

  if (headerUserName) {
    headerUserName.textContent =
      user?.name ||
      user?.employeeName ||
      user?.employeeId ||
      "사용자";
  }
}


function openLoginScreen() {
  const {
    loginScreen,
    appShell,
    loginEmployeeId,
    loginPassword
  } =
    getLoginElements();

  if (loginScreen) {
    loginScreen.hidden =
      false;
  }

  if (appShell) {
    appShell.hidden =
      true;
  }

  if (loginPassword) {
    loginPassword.value =
      "";
  }

  window.setTimeout(
    () => {
      loginEmployeeId?.focus();
    },
    0
  );
}


async function requestShiftLogLogin(
  employeeId,
  password
) {
  const response =
    await fetch(
      "/api/login",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          Accept:
            "application/json"
        },

        body:
          JSON.stringify({
            employeeNo: employeeId,
            password
          })
      }
    );

  let result = {};

  try {
    result =
      await response.json();
  } catch (error) {
    throw new Error(
      "로그인 서버 응답을 확인할 수 없습니다."
    );
  }

  if (
    !response.ok ||
    !result.success
  ) {
    throw new Error(
      result.message ||
      "사번 또는 비밀번호를 확인해 주세요."
    );
  }

  return (
    result.user ||
    result.member ||
    result.data ||
    {
      employeeId
    }
  );
}


async function handleShiftLogLogin(
  event
) {
  event.preventDefault();

  const {
    loginEmployeeId,
    loginPassword,
    loginForm
  } =
    getLoginElements();

  const employeeId =
    String(
      loginEmployeeId?.value ||
      ""
    ).trim();

  const password =
    String(
      loginPassword?.value ||
      ""
    );

  hideLoginError();

  if (!employeeId) {
    showLoginError(
      "사번을 입력해 주세요."
    );

    loginEmployeeId?.focus();

    return;
  }

  if (!password) {
    showLoginError(
      "비밀번호를 입력해 주세요."
    );

    loginPassword?.focus();

    return;
  }

  const submitButton =
    loginForm?.querySelector(
      'button[type="submit"]'
    );

  if (submitButton) {
    submitButton.disabled =
      true;

    submitButton.textContent =
      "로그인 중...";
  }

  try {
    const user =
      await requestShiftLogLogin(
        employeeId,
        password
      );

    saveCurrentUser(user);

    openShiftLogApp(user);

  } catch (error) {
    console.error(
      "로그인 실패:",
      error
    );

    showLoginError(
      error.message ||
      "로그인에 실패했습니다."
    );

  } finally {
    if (submitButton) {
      submitButton.disabled =
        false;

      submitButton.textContent =
        "로그인";
    }
  }
}


function handleShiftLogLogout() {
  clearCurrentUser();

  openLoginScreen();
}


function initializeShiftLogLogin() {
  const {
    loginForm,
    logoutButton
  } =
    getLoginElements();

  loginForm?.addEventListener(
    "submit",
    handleShiftLogLogin
  );

  logoutButton?.addEventListener(
    "click",
    handleShiftLogLogout
  );

  const currentUser =
    loadCurrentUser();

  if (currentUser) {
    openShiftLogApp(
      currentUser
    );

    return;
  }

  openLoginScreen();
}


document.addEventListener(
  "DOMContentLoaded",
  initializeShiftLogLogin
);

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
  logs:
    "gsShiftLog.logs",

  draft:
    "gsShiftLog.draft",

  operationStatus:
    "gsShiftLog.operationStatus",

  memberWorkStatuses:
    "gsShiftLog.memberWorkStatuses"
};


/* =========================================================
  현재 근무일자·근무구분 계산

  D/S : 07:00 ~ 19:00
  N/S : 19:00 ~ 다음 날 07:00

  00:00 ~ 06:59는 전날 N/S로 처리한다.
========================================================= */

function getCurrentShiftContext(now = new Date()) {
  const currentDate =
    new Date(now);

  const hour =
    currentDate.getHours();

  if (hour >= 7 && hour < 19) {
    return {
      date:
        new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          currentDate.getDate()
        ),

      shift:
        "DS"
    };
  }

  if (hour < 7) {
    currentDate.setDate(
      currentDate.getDate() - 1
    );
  }

  return {
    date:
      new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate()
      ),

    shift:
      "NS"
  };
}


function getShiftDisplayName(shift) {
  return (
    String(shift || "")
      .trim()
      .toUpperCase() === "DS"
      ? "D/S"
      : "N/S"
  );
}


async function toggleSelectedShift() {
  appState.selectedShift =
    appState.selectedShift === "DS"
      ? "NS"
      : "DS";

  renderSelectedDate();

  await loadLegacyLogsForSelectedDate();

  renderLogTable();
  updateShiftMemberCardStates();
}

const initialShiftContext =
  getCurrentShiftContext();

const appState = {
  selectedDate:
    initialShiftContext.date,

  selectedShift:
    initialShiftContext.shift,

  currentDetailLogId:
    null,

  logs: [],

  editorEntries: [],

  editingEntryIndex:
    -1,

  /*
    날짜·근무·보직별 근무 상태

    예:
    2026-07-21||DS||TGO : 출근
    2026-07-21||DS||BCO1 : 휴가
  */
  memberWorkStatuses: {}
};

/* =========================================================
  근무자 출근·부재 상태 관리

  상태 종류:
  - 출근
  - 교육
  - 휴가
  - 출장
  - 결원
========================================================= */

function getMemberWorkStatusKey(
  date,
  shift,
  role
) {
  const normalizedDate =
    String(
      date || ""
    ).trim();

  const normalizedShift =
    String(
      shift || ""
    )
      .trim()
      .toUpperCase();

  const normalizedRole =
    normalizeMemberLogRole(
      role
    );

  return [
    normalizedDate,
    normalizedShift,
    normalizedRole
  ].join("||");
}


function loadMemberWorkStatuses() {
  const savedStatuses =
    localStorage.getItem(
      STORAGE_KEYS.memberWorkStatuses
    );

  if (!savedStatuses) {
    appState.memberWorkStatuses = {};
    return;
  }

  try {
    const parsedStatuses =
      JSON.parse(
        savedStatuses
      );

    appState.memberWorkStatuses =
      parsedStatuses &&
      typeof parsedStatuses ===
        "object" &&
      !Array.isArray(
        parsedStatuses
      )
        ? parsedStatuses
        : {};
  } catch (error) {
    console.error(
      "근무자 상태 불러오기 실패:",
      error
    );

    appState.memberWorkStatuses = {};

    localStorage.removeItem(
      STORAGE_KEYS.memberWorkStatuses
    );
  }
}


function persistMemberWorkStatuses() {
  localStorage.setItem(
    STORAGE_KEYS.memberWorkStatuses,
    JSON.stringify(
      appState.memberWorkStatuses
    )
  );
}


function getMemberWorkStatus(
  date,
  shift,
  role
) {
  const statusKey =
    getMemberWorkStatusKey(
      date,
      shift,
      role
    );

  const savedStatus =
    String(
      appState
        .memberWorkStatuses[
          statusKey
        ] ||
      ""
    ).trim();

  const validStatuses = [
    "출근",
    "교육",
    "휴가",
    "출장",
    "결원"
  ];

  return validStatuses.includes(
    savedStatus
  )
    ? savedStatus
    : "출근";
}


function setMemberWorkStatus(
  date,
  shift,
  role,
  status
) {
  const validStatuses = [
    "출근",
    "교육",
    "휴가",
    "출장",
    "결원"
  ];

  const normalizedStatus =
    String(
      status || ""
    ).trim();

  if (
    !validStatuses.includes(
      normalizedStatus
    )
  ) {
    return false;
  }

  const statusKey =
    getMemberWorkStatusKey(
      date,
      shift,
      role
    );

  /*
    기본값인 출근은 저장소에서 제거하여
    불필요한 데이터가 쌓이지 않게 한다.
  */
  if (
    normalizedStatus ===
    "출근"
  ) {
    delete appState
      .memberWorkStatuses[
        statusKey
      ];
  } else {
    appState
      .memberWorkStatuses[
        statusKey
      ] =
      normalizedStatus;
  }

  persistMemberWorkStatuses();

  return true;
}

/* =========================================================
  초기 실행
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    cacheElements();
    cacheMemberLogImportElements();

    bindShiftMemberCards();

    /*
      먼저 브라우저에 저장된 신규 업무일지를 불러온다.
    */
    loadLogs();

    loadMemberWorkStatuses();

    bindEvents();
    bindMemberLogImportEvents();
    bindLogEntryEditModeEvents();

    loadOperationStatus();
    renderOperationStatusCard();

    /*
      기존 업무일지 서버의 현재 선택 날짜 데이터를
      appState.logs 형식으로 변환하여 합친다.
    */
    await loadLegacyLogsForSelectedDate();

    renderSelectedDate();
    renderLogTable();
    updateShiftMemberCardStates();

    setEditorDateFromSelectedDate();

    resetLogEntryInput();
    updateTagFieldVisibility();
    renderLogEntryTable();

    /*
      최초에는 편집 모드를 끈 상태로 시작한다.
    */
    setLogEntryEditMode(
      false
    );

    updateMemberLogImportSection();
  }
);

let elements = {};

function cacheElements() {
  elements = {
    /* =====================================================
      상단 탭과 화면
    ====================================================== */

    topTabs: [
      ...document.querySelectorAll(
        ".top-tab"
      )
    ],

    pageViews: [
      ...document.querySelectorAll(
        ".page-view"
      )
    ],


    /* =====================================================
      근무 현황과 날짜
    ====================================================== */

    shiftMemberGrid:
      document.getElementById(
        "shiftMemberGrid"
      ),

    currentShiftLabel:
      document.getElementById(
        "currentShiftLabel"
      ),

    selectedDateText:
      document.getElementById(
        "selectedDateText"
      ),

    selectedShiftBadge:
      document.getElementById(
        "selectedShiftBadge"
      ),

    previousDateButton:
      document.getElementById(
        "previousDateButton"
      ),

    nextDateButton:
      document.getElementById(
        "nextDateButton"
      ),

    todayButton:
      document.getElementById(
        "todayButton"
      ),


    /* =====================================================
      업무일지 작성 모달
    ====================================================== */

    openLogEditorButton:
      document.getElementById(
        "openLogEditorButton"
      ),

    closeLogEditorButton:
      document.getElementById(
        "closeLogEditorButton"
      ),

    cancelLogButton:
      document.getElementById(
        "cancelLogButton"
      ),

    logEditorModal:
      document.getElementById(
        "logEditorModal"
      ),

    logEditorForm:
      document.getElementById(
        "logEditorForm"
      ),

    logEditorTitle:
      document.getElementById(
        "logEditorTitle"
      ),


    /* =====================================================
      기본 정보
    ====================================================== */

    logDate:
      document.getElementById(
        "logDate"
      ),

    logShift:
      document.getElementById(
        "logShift"
      ),

    logTeam:
      document.getElementById(
        "logTeam"
      ),

    logRole:
      document.getElementById(
        "logRole"
      ),

    logAuthor:
      document.getElementById(
        "logAuthor"
      ),

    logIsSubstitute:
      document.getElementById(
        "logIsSubstitute"
      ),


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


    /* =====================================================
      인수인계사항 전체 패널
    ====================================================== */

    logEntryListPanel:
      document.getElementById(
        "logEntryListPanel"
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
      TM 발행 내역
    ====================================================== */

    tmIssueEntryTableBody:
      document.getElementById(
        "tmIssueEntryTableBody"
      ),

    tmIssueEntryCount:
      document.getElementById(
        "tmIssueEntryCount"
      ),

    selectAllTmEntriesCheckbox:
      document.getElementById(
        "selectAllTmEntriesCheckbox"
      ),


    /* =====================================================
      인계사항 내역
    ====================================================== */

    logEntryTableBody:
      document.getElementById(
        "logEntryTableBody"
      ),

    handoverEntryCount:
      document.getElementById(
        "handoverEntryCount"
      ),

    selectAllLogEntriesCheckbox:
      document.getElementById(
        "selectAllLogEntriesCheckbox"
      ),


    /* =====================================================
      인수인계사항 편집 모드
    ====================================================== */

    openLogEntryEditModeButton:
      document.getElementById(
        "openLogEntryEditModeButton"
      ),

    cancelLogEntryEditModeButton:
      document.getElementById(
        "cancelLogEntryEditModeButton"
      ),

    selectedLogEntryCount:
      document.getElementById(
        "selectedLogEntryCount"
      ),

    deleteSelectedLogEntriesButton:
      document.getElementById(
        "deleteSelectedLogEntriesButton"
      ),


    /* =====================================================
      비고와 첨부파일
    ====================================================== */

    logNote:
      document.getElementById(
        "logNote"
      ),

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

      approveFromDetailButton:
      document.getElementById(
        "approveFromDetailButton"
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
  기존 업무일지 불러오기
========================================================= */

async function loadLegacyLogsForSelectedDate() {
  const selectedDate =
    formatInputDate(
      appState.selectedDate
    );

  const legacyDate =
    selectedDate.replace(
      /-/g,
      ""
    );

  /*
    날짜를 선택하면 기존 서버의 주간·야간 업무일지를
    모두 불러온다.

    기존 시스템:
    DAY   = D/S
    NIGHT = N/S

    이렇게 해야 처음 화면이 N/S로 열리더라도
    같은 날짜의 D/S 업무일지도 함께 메모리에 저장되고,
    근무 배지를 눌러 전환했을 때 즉시 표시된다.
  */
  const legacyShiftDefinitions = [
    {
      legacyShift: "DAY",
      currentShift: "DS"
    },
    {
      legacyShift: "NIGHT",
      currentShift: "NS"
    }
  ];

  try {
    const requestResults =
      await Promise.all(
        legacyShiftDefinitions.map(
          async (shiftDefinition) => {
            const requestUrl =
              new URL(
                "/api/legacy-diaries",
                window.location.origin
              );

            requestUrl.searchParams.set(
              "date",
              legacyDate
            );

            requestUrl.searchParams.set(
              "shift",
              shiftDefinition.legacyShift
            );

            const response =
              await fetch(
                requestUrl.toString(),
                {
                  method: "GET",

                  headers: {
                    Accept:
                      "application/json"
                  },

                  cache:
                    "no-store"
                }
              );

            const result =
              await response.json();

            if (
              !response.ok ||
              !result.success
            ) {
              throw new Error(
                result.message ||
                `${shiftDefinition.legacyShift} 기존 업무일지를 불러오지 못했습니다.`
              );
            }

            return {
              currentShift:
                shiftDefinition.currentShift,

              items:
                Array.isArray(
                  result.items
                )
                  ? result.items
                  : []
            };
          }
        )
      );

    /*
      선택 날짜에 전에 불러온 기존 서버 일지를
      D/S·N/S 모두 제거한 뒤 최신 응답으로 교체한다.

      새 GS Shift Log에서 직접 작성한 일지는 유지한다.
    */
    appState.logs =
      appState.logs.filter(
        (log) => {
          const isSameDate =
            String(
              log.date || ""
            ).trim() ===
            selectedDate;

          const isLegacyShift =
            ["DS", "NS"].includes(
              String(
                log.shift || ""
              ).trim()
            );

          const isLegacyLog =
            log.source ===
            "legacy";

          return !(
            isSameDate &&
            isLegacyShift &&
            isLegacyLog
          );
        }
      );

    const convertedLogs = [];

    requestResults.forEach(
      (requestResult) => {
        const convertedShiftLogs =
          requestResult.items
            .map(
              (
                item,
                itemIndex
              ) => {
                return convertLegacyDiaryToLog(
                  item,
                  itemIndex,
                  selectedDate,
                  requestResult.currentShift
                );
              }
            )
            .filter(Boolean);

        /*
          2026년 7월 21일까지의 과거 파트장 일지는
          D/S와 N/S를 각각 분리하여 재구성한다.
        */
        if (
          selectedDate <=
          "2026-07-21"
        ) {
          rebuildLegacyLeaderLogFromMemberLogs(
            convertedShiftLogs
          );
        }

        convertedLogs.push(
          ...convertedShiftLogs
        );
      }
    );

    appState.logs = [
      ...convertedLogs,
      ...appState.logs
    ];

    const dsCount =
      convertedLogs.filter(
        (log) => {
          return log.shift === "DS";
        }
      ).length;

    const nsCount =
      convertedLogs.filter(
        (log) => {
          return log.shift === "NS";
        }
      ).length;

    console.log(
      `기존 업무일지 D/S ${dsCount}건, N/S ${nsCount}건을 불러왔습니다.`
    );

  } catch (error) {
    console.error(
      "기존 업무일지 불러오기 실패:",
      error
    );

    /*
      기존 서버 연결에 실패해도
      새 GS Shift Log 기능은 계속 작동한다.
    */
  }
}

/* =========================================================
  과거 파트장 업무일지 재구성

  2026-07-21까지는
  같은 날짜·근무의 팀원 업무일지를
  파트장 업무일지에 그대로 취합한다.
========================================================= */

function rebuildLegacyLeaderLogFromMemberLogs(
  convertedLogs
) {
  if (
    !Array.isArray(
      convertedLogs
    ) ||
    !convertedLogs.length
  ) {
    return;
  }


  /*
    일반 업무 자동 취합 대상
  */
  const ordinaryWorkRoles = [
    "TGO",
    "BCO1",
    "BCO2"
  ];


  /*
    TM 발행 내역 취합 대상

    TM은 모든 보직에서 가져온다.
  */
  const tmSourceRoles = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ];


  const leaderLog =
    convertedLogs.find(
      (log) => {
        return (
          normalizeMemberLogRole(
            log.role
          ) ===
          "파트장"
        );
      }
    );

  if (!leaderLog) {
    return;
  }


  /*
    기존 파트장 업무일지에서
    파트장이 직접 작성한 TM 이외 업무만 유지한다.

    TM 발행 내역은 모든 팀원 일지에서
    다시 취합하여 중복을 정리한다.
  */
  const leaderOwnEntries =
    Array.isArray(
      leaderLog.entries
    )
      ? leaderLog.entries
          .filter(
            (entry) => {
              const sourceRole =
                normalizeMemberLogRole(
                  entry.importedFromRole
                );

              const legacyBodyIndex =
                Number(
                  entry.legacyBodyIndex
                );

              const isTmIssue =
                String(
                  entry.category || ""
                ).trim() ===
                "TM 발행";

              if (isTmIssue) {
                return false;
              }

              return (
                sourceRole ===
                  "파트장" ||
                legacyBodyIndex ===
                  8
              );
            }
          )
          .map(
            (
              entry,
              entryIndex
            ) => {
              return {
                ...entry,

                importedFromRole:
                  "파트장",

                importedFromAuthor:
                  String(
                    leaderLog.author ||
                    ""
                  ).trim(),

                importedFromLogId:
                  String(
                    leaderLog.id ||
                    ""
                  ).trim(),

                importedFromEntryIndex:
                  entryIndex
              };
            }
          )
      : [];


  const combinedMemberEntries =
    [];


  /*
    모든 팀원 업무일지를 순회한다.

    TGO·BCO1·BCO2:
    - 일반 업무
    - TM 발행 내역

    TO·BO1·BO2:
    - TM 발행 내역만
  */
  tmSourceRoles.forEach(
    (memberRole) => {
      const memberLog =
        convertedLogs.find(
          (log) => {
            return (
              normalizeMemberLogRole(
                log.role
              ) ===
              memberRole
            );
          }
        );

      if (!memberLog) {
        return;
      }

      const memberEntries =
        Array.isArray(
          memberLog.entries
        )
          ? memberLog.entries
          : [];

      memberEntries.forEach(
        (
          entry,
          entryIndex
        ) => {
          const category =
            String(
              entry.category || ""
            ).trim();

          const isTmIssue =
            category ===
            "TM 발행";

          const canImportOrdinaryWork =
            ordinaryWorkRoles.includes(
              memberRole
            );


          /*
            TM 발행은 모든 보직에서 가져온다.

            TM이 아닌 일반 업무는
            TGO·BCO1·BCO2만 가져온다.
          */
          if (
            !isTmIssue &&
            !canImportOrdinaryWork
          ) {
            return;
          }

          combinedMemberEntries.push({
            ...entry,

            importedFromRole:
              memberRole,

            importedFromAuthor:
              String(
                memberLog.author ||
                ""
              ).trim(),

            importedFromLogId:
              String(
                memberLog.id ||
                ""
              ).trim(),

            importedFromEntryIndex:
              entryIndex,

            source:
              "legacy-member-copy"
          });
        }
      );
    }
  );


  /*
    상위·하위 보직 TM 중복 정리

    TGO  ↔ TO
    BCO1 ↔ BO1
    BCO2 ↔ BO2

    문장 유사도 70% 이상:
    - 상위 보직 TM 유지
    - 하위 보직 TM 제외

    문장 유사도 70% 미만:
    - 상위·하위 TM 모두 유지
  */
  const filteredMemberEntries =
    filterLeaderTmEntriesByRoleHierarchy(
      combinedMemberEntries
    );


  leaderLog.entries = [
    ...filteredMemberEntries,
    ...leaderOwnEntries
  ];

  leaderLog.legacyRebuiltFromMembers =
    true;
}

/* =========================================================
  파트장 TM 발행 내역 중복 정리

  상위 보직:
  TGO, BCO1, BCO2

  하위 보직:
  TO, BO1, BO2

  상위·하위 보직의 TM 내용이
  70% 이상 유사하면 상위 보직 항목만 유지한다.
========================================================= */

function getUpperRoleForTmRole(
  role
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );

  const upperRoleMap = {
    TO:
      "TGO",

    BO1:
      "BCO1",

    BO2:
      "BCO2"
  };

  return (
    upperRoleMap[
      normalizedRole
    ] ||
    ""
  );
}


function filterLeaderTmEntriesByRoleHierarchy(
  entries
) {
  const sourceEntries =
    Array.isArray(
      entries
    )
      ? entries
      : [];

  const similarityThreshold =
    0.7;

  const upperRoles = [
    "TGO",
    "BCO1",
    "BCO2"
  ];

  const lowerRoles = [
    "TO",
    "BO1",
    "BO2"
  ];


  /*
    TM 발행이 아닌 항목은
    중복 비교 대상에서 제외하고 그대로 유지한다.
  */
  const nonTmEntries =
    sourceEntries.filter(
      (entry) => {
        return (
          String(
            entry.category || ""
          ).trim() !==
          "TM 발행"
        );
      }
    );


  /*
    TM 발행 항목만 분리한다.
  */
  const tmEntries =
    sourceEntries.filter(
      (entry) => {
        return (
          String(
            entry.category || ""
          ).trim() ===
          "TM 발행"
        );
      }
    );


  /*
    상위 보직의 TM은 먼저 모두 유지한다.
  */
  const upperTmEntries =
    tmEntries.filter(
      (entry) => {
        const sourceRole =
          normalizeMemberLogRole(
            entry.importedFromRole
          );

        return upperRoles.includes(
          sourceRole
        );
      }
    );


  /*
    하위 보직 TM 중에서
    대응하는 상위 보직 TM과 70% 이상 유사한 것은 제외한다.
  */
  const filteredLowerTmEntries =
    tmEntries.filter(
      (entry) => {
        const lowerRole =
          normalizeMemberLogRole(
            entry.importedFromRole
          );

        if (
          !lowerRoles.includes(
            lowerRole
          )
        ) {
          return false;
        }

        const upperRole =
          getUpperRoleForTmRole(
            lowerRole
          );

        const lowerContent =
          String(
            entry.content || ""
          ).trim();

        const hasSimilarUpperEntry =
          upperTmEntries.some(
            (upperEntry) => {
              const upperEntryRole =
                normalizeMemberLogRole(
                  upperEntry.importedFromRole
                );

              if (
                upperEntryRole !==
                upperRole
              ) {
                return false;
              }

              const upperContent =
                String(
                  upperEntry.content ||
                  ""
                ).trim();

              const similarity =
                calculateLegacyContentSimilarity(
                  upperContent,
                  lowerContent
                );

              return (
                similarity >=
                similarityThreshold
              );
            }
          );

        return !hasSimilarUpperEntry;
      }
    );


  /*
    출처 보직이 없는 기존 TM이나
    파트장이 직접 작성한 TM은 그대로 유지한다.
  */
  const otherTmEntries =
    tmEntries.filter(
      (entry) => {
        const sourceRole =
          normalizeMemberLogRole(
            entry.importedFromRole
          );

        return (
          !upperRoles.includes(
            sourceRole
          ) &&
          !lowerRoles.includes(
            sourceRole
          )
        );
      }
    );


  return [
    ...upperTmEntries,
    ...filteredLowerTmEntries,
    ...otherTmEntries,
    ...nonTmEntries
  ];
}

function calculateLegacyContentSimilarity(
  firstContent,
  secondContent
) {
  const firstText =
    normalizeLegacyContentForComparison(
      firstContent
    );

  const secondText =
    normalizeLegacyContentForComparison(
      secondContent
    );

  if (
    !firstText ||
    !secondText
  ) {
    return 0;
  }

  if (
    firstText ===
    secondText
  ) {
    return 1;
  }

  /*
    한쪽 문장이 다른 문장을 포함하는 경우
  */
  const shorterText =
    firstText.length <=
    secondText.length
      ? firstText
      : secondText;

  const longerText =
    firstText.length >
    secondText.length
      ? firstText
      : secondText;

  const containmentScore =
    longerText.includes(
      shorterText
    )
      ? Math.min(
          1,
          shorterText.length /
          Math.max(
            longerText.length,
            1
          ) +
          0.2
        )
      : 0;


  /*
    글자 두 개 단위 유사도
  */
  const diceScore =
    calculateDiceSimilarity(
      firstText,
      secondText
    );


  /*
    단어 및 설비 핵심어 유사도

    영문 설비명, TAG, 숫자, 한글 단어가
    얼마나 겹치는지 추가로 비교한다.
  */
  const firstTokens =
    createLegacyComparisonTokens(
      firstContent
    );

  const secondTokens =
    createLegacyComparisonTokens(
      secondContent
    );

  const tokenScore =
    calculateLegacyTokenSimilarity(
      firstTokens,
      secondTokens
    );


  /*
    문장 길이가 다르더라도
    주요 단어가 동일하면 높은 점수를 준다.
  */
  const combinedScore =
    (
      diceScore *
      0.45
    ) +
    (
      tokenScore *
      0.55
    );

  return Math.max(
    containmentScore,
    diceScore,
    tokenScore,
    combinedScore
  );
}

function createLegacyComparisonTokens(
  content
) {
  const ignoredTokens =
    new Set([
      "실시",
      "확인",
      "점검",
      "운전",
      "작업",
      "완료",
      "정상",
      "양호",
      "관련",
      "및",
      "후",
      "중",
      "전",
      "업무",
      "인계사항"
    ]);

  return String(
    content || ""
  )
    .toLowerCase()

    /*
      수기 번호 제거
    */
    .replace(
      /^\s*\d+\s*[.)\-:]\s*/,
      ""
    )

    /*
      시간 표현은 비교에서 제외
    */
    .replace(
      /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g,
      " "
    )

    /*
      한글·영문·숫자만 남긴다.
    */
    .replace(
      /[^a-z0-9가-힣]+/g,
      " "
    )
    .trim()
    .split(/\s+/)
    .map((token) => {
      return token.trim();
    })
    .filter((token) => {
      return (
        token.length >= 2 &&
        !ignoredTokens.has(
          token
        )
      );
    });
}


function calculateLegacyTokenSimilarity(
  firstTokens,
  secondTokens
) {
  if (
    !Array.isArray(
      firstTokens
    ) ||
    !Array.isArray(
      secondTokens
    ) ||
    !firstTokens.length ||
    !secondTokens.length
  ) {
    return 0;
  }

  const firstSet =
    new Set(
      firstTokens
    );

  const secondSet =
    new Set(
      secondTokens
    );

  const matchedTokens = [
    ...firstSet
  ].filter((token) => {
    return secondSet.has(
      token
    );
  });

  if (
    !matchedTokens.length
  ) {
    return 0;
  }

  const smallerTokenCount =
    Math.min(
      firstSet.size,
      secondSet.size
    );

  const largerTokenCount =
    Math.max(
      firstSet.size,
      secondSet.size
    );

  const coverageScore =
    matchedTokens.length /
    smallerTokenCount;

  const balanceScore =
    matchedTokens.length /
    largerTokenCount;

  return (
    coverageScore *
    0.7
  ) +
  (
    balanceScore *
    0.3
  );
}


function normalizeLegacyContentForComparison(
  content
) {
  return String(
    content || ""
  )
    .toLowerCase()

    /*
      줄 앞의 수기 번호 제거
    */
    .replace(
      /^\s*\d+\s*[.)\-:]\s*/,
      ""
    )

    /*
      문장 앞 시간 제거
    */
    .replace(
      /^\s*(?:[01]?\d|2[0-3]):[0-5]\d\s*/,
      ""
    )

    /*
      비교에 방해되는 기호와 공백 제거
    */
    .replace(
      /[^a-z0-9가-힣]/g,
      ""
    )
    .trim();
}


function calculateDiceSimilarity(
  firstText,
  secondText
) {
  if (
    firstText.length < 2 ||
    secondText.length < 2
  ) {
    return (
      firstText ===
      secondText
        ? 1
        : 0
    );
  }

  const firstBigrams =
    [];

  const secondBigrams =
    [];

  for (
    let index = 0;
    index <
    firstText.length - 1;
    index += 1
  ) {
    firstBigrams.push(
      firstText.slice(
        index,
        index + 2
      )
    );
  }

  for (
    let index = 0;
    index <
    secondText.length - 1;
    index += 1
  ) {
    secondBigrams.push(
      secondText.slice(
        index,
        index + 2
      )
    );
  }

  const remainingBigrams =
    [...secondBigrams];

  let matchCount = 0;

  firstBigrams.forEach(
    (bigram) => {
      const matchedIndex =
        remainingBigrams.indexOf(
          bigram
        );

      if (
        matchedIndex === -1
      ) {
        return;
      }

      matchCount += 1;

      remainingBigrams.splice(
        matchedIndex,
        1
      );
    }
  );

  return (
    2 *
    matchCount /
    (
      firstBigrams.length +
      secondBigrams.length
    )
  );
}

/* =========================================================
  기존 파트장 일지 body index → 담당 보직
========================================================= */

function convertLegacyBodyIndexToRole(
  bodyIndex,
  diaryRole
) {
  const normalizedDiaryRole =
    normalizeMemberLogRole(
      diaryRole
    );

  /*
    일반 근무자 업무일지는
    모든 항목을 해당 근무자의 업무로 처리한다.
  */
  if (
    normalizedDiaryRole !==
    "파트장"
  ) {
    return normalizedDiaryRole;
  }

  /*
    기존 파트장 업무일지 구조

    index 0 : 운전현황
    index 1 : TM 발행 내역
    index 2 : TGO 업무
    index 3 : BCO1 업무
    index 4 : BCO2 업무
    index 5 : TO 업무
    index 6 : BO1 업무
    index 7 : BO2 업무
    index 8 : 파트장 직접 작성 업무
  */
  const roleMap = {
    2: "TGO",
    3: "BCO1",
    4: "BCO2",
    5: "TO",
    6: "BO1",
    7: "BO2",
    8: "파트장"
  };

  return (
    roleMap[
      Number(bodyIndex)
    ] ||
    "파트장"
  );
}

/* =========================================================
  기존 업무일지 1건을 현재 구조로 변환
========================================================= */

function convertLegacyDiaryToLog(
  legacyItem,
  itemIndex,
  selectedDate,
  selectedShift
) {
  if (
    !legacyItem ||
    typeof legacyItem !==
      "object"
  ) {
    return null;
  }

  const bodyEntries =
    Array.isArray(
      legacyItem.body
    )
      ? legacyItem.body
      : [];

  const role =
    convertLegacyPositionToRole(
      legacyItem.position
    );

  const author =
    String(
      legacyItem.writer_name ||
      legacyItem.writerName ||
      legacyItem.writer_id ||
      "기존 업무일지"
    ).trim();

  const operationStatus =
    getLegacyBodyContent(
      bodyEntries,
      0
    );

  const entries = [];

  bodyEntries.forEach(
    (
      bodyItem,
      bodyIndex
    ) => {
      const index =
        Number(
          bodyItem?.index ??
          bodyIndex
        );

      const rawContent =
        String(
          bodyItem?.content ||
          ""
        );

      /*
        빈 내용과 운전현황은
        작업 내역에서 제외한다.
      */
      if (
        !rawContent.trim() ||
        index === 0
      ) {
        return;
      }

      const category =
        index === 1
          ? "TM 발행"
          : "인계사항";

      /*
        파트장 업무일지의 body index를
        실제 담당 보직으로 변환한다.
      */
      const sourceRole =
        index === 1
          ? ""
          : convertLegacyBodyIndexToRole(
              index,
              role
            );

      const parsedLines =
        parseLegacyDiaryContentLines(
          rawContent
        );

      parsedLines.forEach(
        (
          parsedLine,
          lineIndex
        ) => {
          const separatedTmContent =
            category === "TM 발행"
              ? extractLegacyTagFromContent(
                  parsedLine.content
                )
              : {
                  tag: "",
                  content:
                    parsedLine.content
                };

          entries.push({
            id: [
              "legacy-entry",
              legacyItem.diary_id ||
                itemIndex,
              index,
              lineIndex
            ].join("-"),

            category,

            time:
              parsedLine.time,

            tag:
              separatedTmContent.tag,

            content:
              separatedTmContent.content,

            attachmentName: "",

            /*
              파트장 일지에서 보직별 구분에 사용한다.
            */
            importedFromRole:
              sourceRole,

            importedFromAuthor: "",

            importedFromLogId:
              `legacy-${
                legacyItem.diary_id ||
                itemIndex
              }`,

            importedFromEntryIndex:
              lineIndex,

            legacyBodyIndex:
              index,

            legacyLineIndex:
              lineIndex,

            source:
              "legacy"
          });
        }
      );
    }
  );

  const legacyId =
    String(
      legacyItem.diary_id ||
      [
        selectedDate,
        selectedShift,
        role,
        itemIndex
      ].join("-")
    );

  return {
    id:
      `legacy-${legacyId}`,

    date:
      selectedDate,

    shift:
      selectedShift,

    role,

    author,

    writerId:
      String(
        legacyItem.writer_id ||
        ""
      ).trim(),

    team:
      getScheduledPart(
        selectedDate,
        selectedShift
      ),

    /*
      기존 GROUP_1, GROUP_2 값은 화면에서 사용하지 않는다.
    */
    group: "",

    operationStatus,

    entries,

    status:
      convertLegacyDiaryStatus(
        legacyItem.diary_status
      ),

    source:
      "legacy",

    legacyDiaryId:
      String(
        legacyItem.diary_id ||
        ""
      ),

    legacyPosition:
      String(
        legacyItem.position ||
        ""
      ),

    legacyVersion:
      legacyItem.version ?? 0,

    createdAt:
      legacyItem.created_at ||
      legacyItem.createdAt ||
      `${selectedDate}T00:00:00`,

    updatedAt:
      legacyItem.updated_at ||
      legacyItem.updatedAt ||
      `${selectedDate}T00:00:00`
  };
}

function parseLegacyDiaryContentLines(
  rawContent
) {
  const sourceLines =
    String(
      rawContent || ""
    )
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");

  const parsedEntries = [];

  sourceLines.forEach(
    (sourceLine) => {
      /*
        줄 앞뒤의 불필요한 공백을 제거한다.

        첫 번째 줄이 오른쪽으로 밀려 있던 문제도
        여기서 함께 해결된다.
      */
      let line =
        String(
          sourceLine || ""
        ).trim();

      if (!line) {
        return;
      }

      /*
        사용자가 직접 입력한 번호를 제거한다.

        예:
        1. 내용
        2) 내용
        3 - 내용
        ④ 내용
      */
      line = line.replace(
        /^(?:\d+\s*[.)\-:]\s*|[①②③④⑤⑥⑦⑧⑨⑩]\s*)/,
        ""
      );

      line = line.trim();

      if (!line) {
        return;
      }

      /*
        줄의 맨 앞에 있는 시간을 찾는다.

        예:
        19:10 Spiess Valve 동작 Test
        19:30 / 21:30 / 02:30 Bed Ash 배출
      */
      const timeMatch =
        line.match(
          /^([01]?\d|2[0-3]):([0-5]\d)\s*(.*)$/
        );

      if (timeMatch) {
        const hour =
          String(
            Number(
              timeMatch[1]
            )
          ).padStart(
            2,
            "0"
          );

        const minute =
          timeMatch[2];

        const content =
          String(
            timeMatch[3] ||
            ""
          ).trim();

        if (!content) {
          return;
        }

        parsedEntries.push({
          time:
            `${hour}:${minute}`,

          content
        });

        return;
      }

      /*
        시간 없이 시작하는 줄 중에서
        -, ·, ※ 등으로 시작하는 보충 설명은
        바로 위 항목에 이어 붙인다.
      */
      const isContinuationLine =
        /^[-–—·※▶▷→]/.test(
          line
        );

      if (
        isContinuationLine &&
        parsedEntries.length
      ) {
        const previousEntry =
          parsedEntries[
            parsedEntries.length - 1
          ];

        previousEntry.content = [
          previousEntry.content,
          line
        ]
          .filter(Boolean)
          .join("\n");

        return;
      }

      /*
        시간 없는 일반 문장은
        별도의 인계사항으로 등록한다.
      */
      parsedEntries.push({
        time: "",
        content: line
      });
    }
  );

  return parsedEntries;
}

/* =========================================================
  기존 body index 내용 가져오기
========================================================= */

function getLegacyBodyContent(
  bodyEntries,
  targetIndex
) {
  const target =
    bodyEntries.find(
      (
        bodyItem,
        bodyIndex
      ) => {
        return (
          Number(
            bodyItem?.index ??
            bodyIndex
          ) ===
          Number(
            targetIndex
          )
        );
      }
    );

  return String(
    target?.content ||
    ""
  ).trim();
}


/* =========================================================
  기존 보직명을 현재 보직명으로 변환
========================================================= */

function convertLegacyPositionToRole(
  position
) {
  const normalizedPosition =
    String(
      position || ""
    )
      .trim()
      .toUpperCase();

  const roleMap = {
    GROUP_LEADER:
      "파트장",

    TGO:
      "TGO",

    BCO1:
      "BCO1",

    BCO2:
      "BCO2",

    TO:
      "TO",

    BO1:
      "BO1",

    BO2:
      "BO2"
  };

  return (
    roleMap[
      normalizedPosition
    ] ||
    normalizedPosition ||
    "미지정"
  );
}


/* =========================================================
  기존 결재 상태를 현재 상태로 변환
========================================================= */

function convertLegacyDiaryStatus(
  legacyStatus
) {
  const normalizedStatus =
    String(
      legacyStatus || ""
    )
      .trim()
      .toUpperCase();

  const statusMap = {
    /*
      파트장이 이미 승인한 과거 업무일지
    */
    APPROVED:
      "결재완료",

    /*
      결재 요청까지 마친 업무일지
    */
    SUBMITTED:
      "작성완료",

    REQUESTED:
      "작성완료",

    /*
      저장만 한 업무일지
    */
    DRAFT:
      "작성중",

    WRITING:
      "작성중",

    /*
      반려된 경우 다시 작성 중으로 처리
    */
    REJECTED:
      "작성중"
  };

  return (
    statusMap[
      normalizedStatus
    ] ||
    "작성중"
  );
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

  elements.importAllMemberLogsButton =
    document.getElementById(
      "importAllMemberLogsButton"
    );

  /*
    HTML에 존재하는 버튼만 자동으로 연결한다.

    현재 화면에 TGO, BCO1, BCO2만 있어도 작동하고,
    추후 TO, BO1, BO2 버튼을 추가해도
    script.js를 다시 수정할 필요가 없다.
  */
  const importDefinitions = [
    {
      role: "TGO",
      buttonId:
        "importTgoLogButton",
      statusId:
        "importTgoLogStatus"
    },
    {
      role: "BCO1",
      buttonId:
        "importBco1LogButton",
      statusId:
        "importBco1LogStatus"
    },
    {
      role: "BCO2",
      buttonId:
        "importBco2LogButton",
      statusId:
        "importBco2LogStatus"
    },
    {
      role: "TO",
      buttonId:
        "importToLogButton",
      statusId:
        "importToLogStatus"
    },
    {
      role: "BO1",
      buttonId:
        "importBo1LogButton",
      statusId:
        "importBo1LogStatus"
    },
    {
      role: "BO2",
      buttonId:
        "importBo2LogButton",
      statusId:
        "importBo2LogStatus"
    }
  ];

  elements.memberLogImportItems =
    importDefinitions.map(
      (definition) => {
        return {
          role:
            definition.role,

          button:
            document.getElementById(
              definition.buttonId
            ),

          status:
            document.getElementById(
              definition.statusId
            )
        };
      }
    );

  /*
    기존 코드나 다른 함수에서 직접 접근할 수 있도록
    개별 요소 이름도 유지한다.
  */
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

  elements.importToLogButton =
    document.getElementById(
      "importToLogButton"
    );

  elements.importBo1LogButton =
    document.getElementById(
      "importBo1LogButton"
    );

  elements.importBo2LogButton =
    document.getElementById(
      "importBo2LogButton"
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

  elements.importToLogStatus =
    document.getElementById(
      "importToLogStatus"
    );

  elements.importBo1LogStatus =
    document.getElementById(
      "importBo1LogStatus"
    );

  elements.importBo2LogStatus =
    document.getElementById(
      "importBo2LogStatus"
    );
}


/* =========================================================
  파트장 업무일지 가져오기 이벤트
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
    elements
      .importAllMemberLogsButton
      .addEventListener(
        "click",
        importAllMemberLogs
      );
  }
}


/* =========================================================
  파트장 가져오기 영역 표시
========================================================= */

function updateMemberLogImportSection() {
  if (
    !elements.memberLogImportSection
  ) {
    return;
  }

  const selectedRole =
    normalizeMemberLogRole(
      elements.logRole?.value
    );

  const isLeader =
    selectedRole === "파트장";

  elements.memberLogImportSection.hidden =
    !isLeader;

  if (!isLeader) {
    return;
  }

  updateMemberLogImportStatus();
}


/* =========================================================
  각 보직 업무일지 가져오기 상태 표시
========================================================= */

function updateMemberLogImportStatus() {
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

    const memberLog =
      findMemberLogByRole(
        item.role
      );

    item.button.classList.remove(
      "is-imported",
      "is-missing",
      "has-new-entries"
    );

    if (!memberLog) {
      item.button.classList.add(
        "is-missing"
      );

      if (item.status) {
        item.status.textContent =
          "작성된 업무일지 없음";
      }

      item.button.disabled =
        false;

      return;
    }

    const importableEntryCount =
      getImportableMemberEntries(
        memberLog,
        item.role
      ).length;

    const author =
      String(
        memberLog.author ||
        item.role
      ).trim();

    const syncStatus =
      getMemberLogSyncStatus(
        memberLog,
        item.role
      );

    if (
      syncStatus.newEntryCount > 0
    ) {
      item.button.classList.add(
        "has-new-entries"
      );

      if (item.status) {
        item.status.textContent =
          `${author} · 신규 ${syncStatus.newEntryCount}건`;
      }

      item.button.disabled =
        false;

      return;
    }

    if (
      importableEntryCount > 0 &&
      syncStatus.importedEntryCount > 0
    ) {
      item.button.classList.add(
        "is-imported"
      );

      if (item.status) {
        item.status.textContent =
          `${author} · 동기화 완료`;
      }

      item.button.disabled =
        false;

      return;
    }

    if (item.status) {
      item.status.textContent =
        `${author} · ${importableEntryCount}건 확인`;
    }

    item.button.disabled =
      false;
  });

  updateMemberLogImportCount();
}


/* =========================================================
  날짜·근무·보직에 맞는 업무일지 찾기
========================================================= */

function findMemberLogByRole(role) {
  const selectedDate =
    elements.logDate?.value ||
    formatInputDate(
      appState.selectedDate
    );

  const selectedShift =
    elements.logShift?.value ||
    appState.selectedShift ||
    "";

  const targetRole =
    normalizeMemberLogRole(role);

  const matchedLogs =
    appState.logs.filter((log) => {
      const logDate =
        String(
          log.date || ""
        ).trim();

      const logShift =
        String(
          log.shift || ""
        ).trim();

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
    과거 중복 저장 데이터가 존재하면
    가장 최근에 수정된 업무일지를 사용한다.
  */
  matchedLogs.sort((logA, logB) => {
    const timeA =
      new Date(
        logA.updatedAt ||
        logA.createdAt ||
        0
      ).getTime();

    const timeB =
      new Date(
        logB.updatedAt ||
        logB.createdAt ||
        0
      ).getTime();

    return timeB - timeA;
  });

  return matchedLogs[0];
}


/* =========================================================
  보직명 정규화
========================================================= */

function normalizeMemberLogRole(role) {
  const rawRole =
    String(role || "").trim();

  if (rawRole === "파트장") {
    return "파트장";
  }

  const normalizedRole =
    rawRole
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

  return normalizedRole;
}


/* =========================================================
  원본 항목 식별 키
========================================================= */

function createSourceEntryKey(
  memberLog,
  sourceRole,
  entry,
  entryIndex
) {
  const normalizedRole =
    normalizeMemberLogRole(
      sourceRole
    );

  const sourceLogId =
    String(
      memberLog?.id || ""
    ).trim();

  const sourceIndex =
    Number.isInteger(entryIndex)
      ? entryIndex
      : Number(entryIndex);

  /*
    원본 업무일지 ID와 원본 항목 번호가 있으면
    가장 우선적으로 사용한다.
  */
  if (
    normalizedRole &&
    sourceLogId &&
    Number.isInteger(sourceIndex) &&
    sourceIndex >= 0
  ) {
    return [
      "SOURCE",
      normalizedRole,
      sourceLogId,
      sourceIndex
    ].join("||");
  }

  /*
    과거 데이터 호환용 키
  */
  return [
    "CONTENT",
    normalizedRole,
    createLogEntryImportKey(entry)
  ].join("||");
}


/* =========================================================
  현재 파트장 일지에 저장된 원본 식별 키
========================================================= */

function createImportedEntryUniqueKey(
  entry
) {
  const sourceRole =
    normalizeMemberLogRole(
      entry.importedFromRole
    );

  const sourceLogId =
    String(
      entry.importedFromLogId || ""
    ).trim();

  const rawSourceIndex =
    entry.importedFromEntryIndex;

  const sourceIndex =
    rawSourceIndex === "" ||
    rawSourceIndex === null ||
    rawSourceIndex === undefined
      ? null
      : Number(rawSourceIndex);

  if (
    sourceRole &&
    sourceLogId &&
    Number.isInteger(sourceIndex) &&
    sourceIndex >= 0
  ) {
    return [
      "SOURCE",
      sourceRole,
      sourceLogId,
      sourceIndex
    ].join("||");
  }

  return [
    "CONTENT",
    sourceRole,
    createLogEntryImportKey(entry)
  ].join("||");
}


/* =========================================================
  일반 내용 비교 키
========================================================= */

function createLogEntryImportKey(entry) {
  const time =
    String(
      entry?.time || ""
    ).trim();

  const category =
    String(
      entry?.category || ""
    ).trim();

  const tag =
    String(
      entry?.tag || ""
    )
      .trim()
      .toUpperCase();

  const content =
    String(
      entry?.content || ""
    )
      .trim()
      .replace(/\s+/g, " ");

  return [
    time,
    category,
    tag,
    content
  ].join("||");
}


/* =========================================================
  파트장 일지로 가져올 수 있는 보직별 항목

  TGO, BCO1, BCO2:
  - 일반 업무
  - TM 발행

  TO, BO1, BO2:
  - TM 발행만
========================================================= */

function getImportableMemberEntries(
  memberLog,
  requestedRole
) {
  const normalizedRole =
    normalizeMemberLogRole(
      requestedRole
    );

  const memberEntries =
    Array.isArray(
      memberLog?.entries
    )
      ? memberLog.entries
      : [];

  const ordinaryWorkRoles = [
    "TGO",
    "BCO1",
    "BCO2"
  ];

  if (
    ordinaryWorkRoles.includes(
      normalizedRole
    )
  ) {
    return memberEntries.map(
      (entry, entryIndex) => {
        return {
          entry,
          entryIndex
        };
      }
    );
  }

  return memberEntries
    .map(
      (entry, entryIndex) => {
        return {
          entry,
          entryIndex
        };
      }
    )
    .filter(({ entry }) => {
      return (
        String(
          entry.category || ""
        ).trim() ===
        "TM 발행"
      );
    });
}


/* =========================================================
  보직별 가져오기 동기화 상태 계산
========================================================= */

function getMemberLogSyncStatus(
  memberLog,
  requestedRole
) {
  const normalizedRole =
    normalizeMemberLogRole(
      requestedRole
    );

  const importableItems =
    getImportableMemberEntries(
      memberLog,
      normalizedRole
    );

  const currentImportedKeys =
    new Set(
      appState.editorEntries
        .filter((entry) => {
          return (
            normalizeMemberLogRole(
              entry.importedFromRole
            ) === normalizedRole
          );
        })
        .map((entry) => {
          return createImportedEntryUniqueKey(
            entry
          );
        })
    );

  let importedEntryCount = 0;
  let newEntryCount = 0;

  importableItems.forEach(
    ({
      entry,
      entryIndex
    }) => {
      const sourceKey =
        createSourceEntryKey(
          memberLog,
          normalizedRole,
          entry,
          entryIndex
        );

      if (
        currentImportedKeys.has(
          sourceKey
        )
      ) {
        importedEntryCount += 1;
      } else {
        newEntryCount += 1;
      }
    }
  );

  return {
    totalEntryCount:
      importableItems.length,

    importedEntryCount,

    newEntryCount
  };
}

/* =========================================================
  특정 보직의 가져온 내역 존재 여부
========================================================= */

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


/* =========================================================
  가져온 전체 건수 표시
========================================================= */

function updateMemberLogImportCount() {
  if (
    !elements.memberLogImportCount
  ) {
    return;
  }

  const importedCount =
    appState.editorEntries.filter(
      (entry) => {
        return Boolean(
          entry.importedFromRole
        );
      }
    ).length;

  elements.memberLogImportCount.textContent =
    `가져온 내역 ${importedCount}건`;
}


/* =========================================================
  보직별 신규 내역 가져오기
========================================================= */

function importMemberLogByRole(
  requestedRole,
  options = {}
) {
  const {
    silent = false,
    deferRender = false
  } = options;

  const normalizedRole =
    normalizeMemberLogRole(
      requestedRole
    );

  const memberLog =
    findMemberLogByRole(
      normalizedRole
    );

  if (!memberLog) {
    if (!silent) {
      showToast(
        `${normalizedRole} 업무일지가 아직 작성되지 않았습니다.`
      );
    }

    return {
      role:
        normalizedRole,

      found:
        false,

      totalCount:
        0,

      addedCount:
        0,

      skippedCount:
        0
    };
  }

  const importableItems =
    getImportableMemberEntries(
      memberLog,
      normalizedRole
    );

  if (!importableItems.length) {
    if (!silent) {
      const tmOnlyRoles = [
        "TO",
        "BO1",
        "BO2"
      ];

      showToast(
        tmOnlyRoles.includes(
          normalizedRole
        )
          ? `${normalizedRole} 업무일지에 가져올 TM 발행 내역이 없습니다.`
          : `${normalizedRole} 업무일지에 가져올 내역이 없습니다.`
      );
    }

    return {
      role:
        normalizedRole,

      found:
        true,

      totalCount:
        0,

      addedCount:
        0,

      skippedCount:
        0
    };
  }

  const existingKeys =
    new Set(
      appState.editorEntries.map(
        (entry) => {
          return createImportedEntryUniqueKey(
            entry
          );
        }
      )
    );

  let addedCount = 0;
  let skippedCount = 0;

  importableItems.forEach(
    ({
      entry,
      entryIndex
    }) => {
      const sourceKey =
        createSourceEntryKey(
          memberLog,
          normalizedRole,
          entry,
          entryIndex
        );

      if (
        existingKeys.has(
          sourceKey
        )
      ) {
        skippedCount += 1;
        return;
      }

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
          String(
            entry.tag || ""
          )
            .trim()
            .toUpperCase(),

        content:
          String(
            entry.content || ""
          ).trim(),

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

      appState.editorEntries.push(
        importedEntry
      );

      existingKeys.add(
        sourceKey
      );

      addedCount += 1;
    }
  );

  if (!deferRender) {
    sortImportedLogEntries();
    renderLogEntryTable();
    updateMemberLogImportStatus();
  }

  if (!silent) {
    if (addedCount > 0) {
      const tmOnlyRoles = [
        "TO",
        "BO1",
        "BO2"
      ];

      showToast(
        tmOnlyRoles.includes(
          normalizedRole
        )
          ? `${normalizedRole} 업무일지에서 TM 발행 신규 내역 ${addedCount}건을 가져왔습니다.`
          : `${normalizedRole} 업무일지에서 신규 내역 ${addedCount}건을 가져왔습니다.`
      );
    } else {
      showToast(
        `${normalizedRole} 업무일지의 신규 내역이 없습니다.`
      );
    }
  }

  return {
    role:
      normalizedRole,

    found:
      true,

    totalCount:
      importableItems.length,

    addedCount,

    skippedCount
  };
}

/* =========================================================
  전체 보직 신규 내역 가져오기
========================================================= */

function importAllMemberLogs() {
  /*
    파트장 업무일지 일괄 취합 규칙

    TGO, BCO1, BCO2
    - 일반 업무
    - TM 발행 내역

    TO, BO1, BO2
    - TM 발행 내역만

    상위·하위 보직 TM이 70% 이상 유사하면
    상위 보직 TM만 유지한다.
  */
  const importOrder = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ];

  const upperRoles = [
    "TGO",
    "BCO1",
    "BCO2"
  ];

  const lowerRoles = [
    "TO",
    "BO1",
    "BO2"
  ];

  let foundRoleCount = 0;
  let addedCount = 0;
  let skippedCount = 0;

  const missingUpperRoles = [];
  const missingLowerRoles = [];


  /*
    중복 정리 전 항목 수를 기록한다.
  */
  const entryCountBeforeImport =
    appState.editorEntries.length;


  /*
    6개 보직을 모두 확인한다.

    importMemberLogByRole()의 기존 규칙에 따라:

    TGO·BCO1·BCO2는 전체 내역,
    TO·BO1·BO2는 TM 발행 내역만 가져온다.
  */
  importOrder.forEach(
    (role) => {
      const result =
        importMemberLogByRole(
          role,
          {
            silent:
              true,

            deferRender:
              true
          }
        );

      if (result.found) {
        foundRoleCount += 1;
      } else if (
        upperRoles.includes(
          role
        )
      ) {
        missingUpperRoles.push(
          role
        );
      } else if (
        lowerRoles.includes(
          role
        )
      ) {
        missingLowerRoles.push(
          role
        );
      }

      addedCount +=
        result.addedCount;

      skippedCount +=
        result.skippedCount;
    }
  );


  /*
    TM 중복 정리

    TGO  ↔ TO
    BCO1 ↔ BO1
    BCO2 ↔ BO2

    70% 이상 유사:
    - 상위 보직 TM 유지
    - 하위 보직 TM 제거

    70% 미만:
    - 두 항목 모두 유지
  */
  appState.editorEntries =
    filterLeaderTmEntriesByRoleHierarchy(
      appState.editorEntries
    );


  /*
    최종 순서 정렬
  */
  sortImportedLogEntries();


  /*
    화면 갱신
  */
  renderLogEntryTable();
  updateMemberLogImportStatus();


  /*
    중복 정리로 제외된 항목 수
  */
  const entryCountAfterImport =
    appState.editorEntries.length;

  const actualAddedCount =
    Math.max(
      0,
      entryCountAfterImport -
      entryCountBeforeImport
    );

  const duplicateRemovedCount =
    Math.max(
      0,
      addedCount -
      actualAddedCount
    );


  /*
    같은 날짜·근무에
    팀원 업무일지가 하나도 없는 경우
  */
  if (
    foundRoleCount === 0
  ) {
    showToast(
      "같은 날짜와 근무에 작성된 팀원 업무일지가 없습니다."
    );

    return;
  }


  /*
    실제 추가된 신규 내역이 없는 경우
  */
  if (
    actualAddedCount === 0
  ) {
    if (
      duplicateRemovedCount > 0
    ) {
      showToast(
        `신규 TM ${duplicateRemovedCount}건이 상위 보직 내역과 중복되어 제외되었습니다.`
      );

      return;
    }

    if (
      missingUpperRoles.length > 0
    ) {
      showToast(
        `신규 내역이 없습니다. 미작성: ${missingUpperRoles.join(", ")}`
      );

      return;
    }

    showToast(
      "가져올 신규 업무일지가 없습니다."
    );

    return;
  }


  /*
    상위 보직 미작성 안내
  */
  if (
    missingUpperRoles.length > 0
  ) {
    const duplicateMessage =
      duplicateRemovedCount > 0
        ? ` 중복 TM ${duplicateRemovedCount}건 제외.`
        : "";

    showToast(
      `신규 내역 ${actualAddedCount}건을 가져왔습니다. 미작성: ${missingUpperRoles.join(", ")}.${duplicateMessage}`
    );

    return;
  }


  /*
    정상 완료 안내
  */
  if (
    duplicateRemovedCount > 0
  ) {
    showToast(
      `신규 내역 ${actualAddedCount}건을 가져왔습니다. 중복 TM ${duplicateRemovedCount}건은 제외했습니다.`
    );

    return;
  }

  showToast(
    `팀원 업무일지에서 신규 내역 총 ${actualAddedCount}건을 가져왔습니다.`
  );
}


/* =========================================================
  가져온 내역 정렬
========================================================= */

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
          roleOrder[roleA] ||
          99
        ) -
        (
          roleOrder[roleB] ||
          99
        );

      if (
        roleDifference !== 0
      ) {
        return roleDifference;
      }

      const timeDifference =
        String(
          entryA.time || ""
        ).localeCompare(
          String(
            entryB.time || ""
          )
        );

      if (
        timeDifference !== 0
      ) {
        return timeDifference;
      }

      return String(
        entryA.content || ""
      ).localeCompare(
        String(
          entryB.content || ""
        )
      );
    }
  );
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
    일부 HTML 요소가 없더라도
    나머지 기능이 중단되지 않도록 한다.
  */

  const bindClick = (
    element,
    handler
  ) => {
    if (!element) {
      return;
    }

    element.addEventListener(
      "click",
      handler
    );
  };

  const bindChange = (
    element,
    handler
  ) => {
    if (!element) {
      return;
    }

    element.addEventListener(
      "change",
      handler
    );
  };

  const bindInput = (
    element,
    handler
  ) => {
    if (!element) {
      return;
    }

    element.addEventListener(
      "input",
      handler
    );
  };

  const bindKeydown = (
    element,
    handler
  ) => {
    if (!element) {
      return;
    }

    element.addEventListener(
      "keydown",
      handler
    );
  };


  /* =======================================================
    선택된 작업 내역 상태 갱신
  ======================================================== */

  const updateSelectedEntryControls =
    () => {
      if (
        !elements.logEntryTableBody
      ) {
        return;
      }

      const checkboxes = [
        ...elements.logEntryTableBody
          .querySelectorAll(
            ".log-entry-select-checkbox"
          )
      ];

      const selectedCheckboxes =
        checkboxes.filter(
          (checkbox) =>
            checkbox.checked
        );

      const selectedCount =
        selectedCheckboxes.length;

      if (
        elements.selectedLogEntryCount
      ) {
        elements
          .selectedLogEntryCount
          .textContent =
          `선택 ${selectedCount}건`;

        elements
          .selectedLogEntryCount
          .hidden =
          selectedCount === 0;
      }

      if (
        elements
          .deleteSelectedLogEntriesButton
      ) {
        elements
          .deleteSelectedLogEntriesButton
          .disabled =
          selectedCount === 0;
      }

      if (
        elements
          .selectAllLogEntriesCheckbox
      ) {
        const hasEntries =
          checkboxes.length > 0;

        const isAllSelected =
          hasEntries &&
          selectedCount ===
            checkboxes.length;

        const isPartiallySelected =
          selectedCount > 0 &&
          selectedCount <
            checkboxes.length;

        elements
          .selectAllLogEntriesCheckbox
          .checked =
          isAllSelected;

        elements
          .selectAllLogEntriesCheckbox
          .indeterminate =
          isPartiallySelected;

        elements
          .selectAllLogEntriesCheckbox
          .disabled =
          !hasEntries;
      }
    };


  /* =======================================================
    상단 탭
  ======================================================== */

  elements.topTabs.forEach(
    (tab) => {
      bindClick(
        tab,
        () => {
          switchView(
            tab.dataset.view
          );
        }
      );
    }
  );


  /* =======================================================
    날짜 이동
  ======================================================== */

  bindClick(
    elements.previousDateButton,
    () => {
      moveSelectedDate(-1);
    }
  );

  bindClick(
    elements.nextDateButton,
    () => {
      moveSelectedDate(1);
    }
  );

  bindClick(
    elements.todayButton,
    moveSelectedDateToToday
  );

  /* =======================================================
    업무일지 작성창
  ======================================================== */

  bindClick(
    elements.openLogEditorButton,
    () => {
      openLogEditor();
    }
  );

  bindClick(
    elements.closeLogEditorButton,
    closeLogEditor
  );

  bindClick(
    elements.cancelLogButton,
    closeLogEditor
  );

  if (elements.logEditorModal) {
    elements.logEditorModal
      .addEventListener(
        "click",
        (event) => {
          if (
            event.target ===
            elements.logEditorModal
          ) {
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
        elements.logEntryTag
          ?.value || ""
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
        !elements
          .useCurrentTimeCheckbox
          .checked
      ) {
        return;
      }

      elements.logEntryTime.value =
        getCurrentTimeValue();

      elements.logEntryTime
        .classList.add(
          "is-current-time-applied"
        );

      window.setTimeout(
        () => {
          elements.logEntryTime
            .classList.remove(
              "is-current-time-applied"
            );
        },
        500
      );

      elements.logEntryContent
        ?.focus();
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
    elements.logEntryTime
      .addEventListener(
        "blur",
        () => {
          if (
            !elements.logEntryTime
              .value
              .trim()
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
      if (
        event.key !== "Enter"
      ) {
        return;
      }

      event.preventDefault();

      const normalizedTime =
        normalizeLogEntryTime();

      if (!normalizedTime) {
        return;
      }

      elements.logEntryCategory
        ?.focus();
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

  if (
    elements.logEntryTableBody
  ) {
    /*
      수정·삭제·TAG 이동 버튼
    */
    elements.logEntryTableBody
      .addEventListener(
        "click",
        handleLogEntryTableClick
      );

    /*
      개별 작업 내역 체크
    */
    elements.logEntryTableBody
      .addEventListener(
        "change",
        (event) => {
          const checkbox =
            event.target.closest(
              ".log-entry-select-checkbox"
            );

          if (!checkbox) {
            return;
          }

          updateSelectedEntryControls();
        }
      );
  }

  bindKeydown(
    elements.logEntryContent,
    (event) => {
      if (
        event.key === "Enter" &&
        (
          event.ctrlKey ||
          event.metaKey
        )
      ) {
        event.preventDefault();

        addOrUpdateLogEntry();
      }
    }
  );


  /* =======================================================
    전체 작업 내역 선택
  ======================================================== */

  bindChange(
    elements
      .selectAllLogEntriesCheckbox,
    () => {
      if (
        !elements
          .logEntryTableBody ||
        !elements
          .selectAllLogEntriesCheckbox
      ) {
        return;
      }

      const shouldSelectAll =
        elements
          .selectAllLogEntriesCheckbox
          .checked;

      elements.logEntryTableBody
        .querySelectorAll(
          ".log-entry-select-checkbox"
        )
        .forEach(
          (checkbox) => {
            checkbox.checked =
              shouldSelectAll;
          }
        );

      updateSelectedEntryControls();
    }
  );


  /* =======================================================
    선택한 작업 내역 일괄 삭제
  ======================================================== */

  bindClick(
    elements
      .deleteSelectedLogEntriesButton,
    () => {
      if (
        !elements
          .logEntryTableBody
      ) {
        return;
      }

      const selectedIndexes = [
        ...elements.logEntryTableBody
          .querySelectorAll(
            ".log-entry-select-checkbox:checked"
          )
      ]
        .map((checkbox) => {
          return Number(
            checkbox.dataset
              .entrySelectIndex
          );
        })
        .filter((index) => {
          return (
            Number.isInteger(index) &&
            appState.editorEntries[
              index
            ]
          );
        });

      if (
        !selectedIndexes.length
      ) {
        showToast(
          "삭제할 작업 내역을 선택해 주세요."
        );

        return;
      }

      const shouldDelete =
        window.confirm(
          `선택한 작업 내역 ${selectedIndexes.length}건을 삭제하시겠습니까?`
        );

      if (!shouldDelete) {
        return;
      }

      /*
        큰 인덱스부터 삭제해야
        앞 항목의 인덱스가 변하지 않는다.
      */
      selectedIndexes
        .sort(
          (indexA, indexB) =>
            indexB - indexA
        )
        .forEach((index) => {
          appState.editorEntries
            .splice(
              index,
              1
            );
        });

      appState.editingEntryIndex =
        -1;

      resetLogEntryInput({
        keepCategory: false,
        keepTag: false
      });

      renderLogEntryTable();
      updateMemberLogImportStatus();

      showToast(
        `작업 내역 ${selectedIndexes.length}건을 삭제했습니다.`
      );
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
    elements.fileDropzone
      .addEventListener(
        "dragover",
        (event) => {
          event.preventDefault();

          elements.fileDropzone
            .classList.add(
              "is-dragging"
            );
        }
      );

    elements.fileDropzone
      .addEventListener(
        "dragleave",
        () => {
          elements.fileDropzone
            .classList.remove(
              "is-dragging"
            );
        }
      );

    elements.fileDropzone
      .addEventListener(
        "drop",
        (event) => {
          event.preventDefault();

          elements.fileDropzone
            .classList.remove(
              "is-dragging"
            );

          if (
            !event.dataTransfer
              .files.length
          ) {
            return;
          }

          try {
            elements
              .logAttachments
              .files =
              event.dataTransfer
                .files;
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
    elements.logEditorForm
      .addEventListener(
        "submit",
        (event) => {
          event.preventDefault();

          saveCurrentLog(
            "작성중"
          );
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
      saveCurrentLog(
        "작성완료"
      );
    }
  );


  /* =======================================================
    업무일지 목록
  ======================================================== */

  if (elements.logTableBody) {
    elements.logTableBody
      .addEventListener(
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
    elements
      .closeLogDetailFooterButton,
    closeLogDetail
  );

  if (elements.logDetailModal) {
    elements.logDetailModal
      .addEventListener(
        "click",
        (event) => {
          if (
            event.target ===
            elements.logDetailModal
          ) {
            closeLogDetail();
          }
        }
      );
  }

  bindClick(
    elements.approveFromDetailButton,
    approveCurrentDetailLog
  );

  bindClick(
    elements.editFromDetailButton,
    () => {
      const log =
        appState.logs.find(
          (item) => {
            return (
              item.id ===
              appState
                .currentDetailLogId
            );
          }
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
    elements.searchForm
      .addEventListener(
        "submit",
        (event) => {
          event.preventDefault();
          runSearch();
        }
      );

    elements.searchForm
      .addEventListener(
        "reset",
        () => {
          window.setTimeout(
            () => {
              if (
                elements
                  .searchResultBody
              ) {
                elements
                  .searchResultBody
                  .innerHTML = "";
              }

              if (
                elements
                  .searchResultCount
              ) {
                elements
                  .searchResultCount
                  .textContent =
                  "0";
              }

              if (
                elements
                  .searchEmptyState
              ) {
                elements
                  .searchEmptyState
                  .hidden =
                  false;

                const title =
                  elements
                    .searchEmptyState
                    .querySelector(
                      "strong"
                    );

                const description =
                  elements
                    .searchEmptyState
                    .querySelector(
                      "p"
                    );

                if (title) {
                  title.textContent =
                    "조회 조건을 선택해 주세요.";
                }

                if (description) {
                  description
                    .textContent =
                    "기간, TAG 또는 업무 내용을 기준으로 검색할 수 있습니다.";
                }
              }
            },
            0
          );
        }
      );
  }


  /* =======================================================
    ESC 키
  ======================================================== */

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key !== "Escape"
      ) {
        return;
      }

      if (
        elements
          .operationStatusEditor &&
        !elements
          .operationStatusEditor
          .hidden
      ) {
        closeOperationStatusEditor();
        return;
      }

      if (
        appState
          .editingEntryIndex >= 0
      ) {
        cancelLogEntryEdit();
        return;
      }

      if (
        elements.logDetailModal
          ?.classList.contains(
            "is-open"
          )
      ) {
        closeLogDetail();
        return;
      }

      if (
        elements.logEditorModal
          ?.classList.contains(
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
async function moveSelectedDate(
  direction
) {
  const previousDateText =
    formatInputDate(
      appState.selectedDate
    );


  /* =====================================================
    다음 이동 순서

    17일 D/S
    → 17일 N/S
    → 18일 D/S
    → 18일 N/S
  ====================================================== */

  if (direction > 0) {
    if (
      appState.selectedShift ===
      "DS"
    ) {
      /*
        같은 날짜의 D/S 다음은 N/S
      */
      appState.selectedShift =
        "NS";
    } else {
      /*
        같은 날짜의 N/S 다음은
        다음 날짜 D/S
      */
      const nextDate =
        new Date(
          appState.selectedDate
        );

      nextDate.setDate(
        nextDate.getDate() + 1
      );

      appState.selectedDate =
        nextDate;

      appState.selectedShift =
        "DS";
    }
  }


  /* =====================================================
    이전 이동 순서

    18일 N/S
    → 18일 D/S
    → 17일 N/S
    → 17일 D/S
  ====================================================== */

  if (direction < 0) {
    if (
      appState.selectedShift ===
      "NS"
    ) {
      /*
        같은 날짜의 N/S 이전은 D/S
      */
      appState.selectedShift =
        "DS";
    } else {
      /*
        같은 날짜의 D/S 이전은
        이전 날짜 N/S
      */
      const previousDate =
        new Date(
          appState.selectedDate
        );

      previousDate.setDate(
        previousDate.getDate() - 1
      );

      appState.selectedDate =
        previousDate;

      appState.selectedShift =
        "NS";
    }
  }


  renderSelectedDate();


  const nextDateText =
    formatInputDate(
      appState.selectedDate
    );


  /*
    날짜가 바뀐 경우에만
    해당 날짜의 D/S와 N/S를 다시 불러온다.

    같은 날짜에서 D/S와 N/S만 전환되면
    이미 불러온 데이터를 바로 표시한다.
  */
  if (
    previousDateText !==
    nextDateText
  ) {
    await loadLegacyLogsForSelectedDate();
  }


  renderLogTable();
  updateShiftMemberCardStates();
}

async function moveSelectedDateToToday() {
  const currentShiftContext =
    getCurrentShiftContext();

  appState.selectedDate =
    currentShiftContext.date;

  appState.selectedShift =
    currentShiftContext.shift;

  renderSelectedDate();

  await loadLegacyLogsForSelectedDate();

  renderLogTable();
  updateShiftMemberCardStates();
}

function renderSelectedDate() {
  const dateText =
    formatKoreanDate(
      appState.selectedDate
    );

  const shiftDisplayName =
    getShiftDisplayName(
      appState.selectedShift
    );

  const scheduledPart =
    getScheduledPart(
      appState.selectedDate,
      appState.selectedShift
    );


  /*
    날짜 이동 영역
  */
  if (
    elements.selectedDateText
  ) {
    elements.selectedDateText.textContent =
      dateText;
  }

  if (
    elements.selectedShiftBadge
  ) {
    elements.selectedShiftBadge.textContent =
      shiftDisplayName;
  }


  /*
    오른쪽 현재 근무 표시
  */
  if (
    elements.currentShiftLabel
  ) {
    elements.currentShiftLabel.textContent =
      [
        dateText,
        shiftDisplayName,
        scheduledPart
      ]
        .filter(Boolean)
        .join(" · ");
  }


  /*
    근무자 현황 제목 옆에
    현재 파트를 표시한다.

    예:
    근무자 현황 (2파트)
  */
  const shiftSectionTitle =
    document.querySelector(
      ".shift-member-grid"
    )
      ?.closest(
        ".content-section"
      )
      ?.querySelector(
        ".section-heading__title"
      );

  if (shiftSectionTitle) {
    shiftSectionTitle.innerHTML = `
      근무자 현황

      ${
        scheduledPart
          ? `
            <span
              class="shift-section-part"
            >
              (${escapeHtml(
                scheduledPart
              )})
            </span>
          `
          : ""
      }
    `;
  }


  setEditorDateFromSelectedDate();
}


function setEditorDateFromSelectedDate() {
  if (!elements.logDate) {
    return;
  }

  elements.logDate.value =
    formatInputDate(
      appState.selectedDate
    );

  elements.logShift.value =
    appState.selectedShift;

  const scheduledPart =
    getScheduledPart(
      appState.selectedDate,
      appState.selectedShift
    );

  if (
    scheduledPart &&
    elements.logTeam &&
    [
      ...elements.logTeam.options
    ].some((option) => {
      return (
        option.value ===
        scheduledPart
      );
    })
  ) {
    elements.logTeam.value =
      scheduledPart;
  }
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
  4파트 교대근무표 계산

  기준 근무표:
  2026-07-15
  - D/S : 2파트
  - N/S : 1파트

  8일 주기로 반복:
  1~2일  : D/S 2파트, N/S 1파트
  3~4일  : D/S 3파트, N/S 4파트
  5~6일  : D/S 1파트, N/S 2파트
  7~8일  : D/S 4파트, N/S 3파트
========================================================= */

function getScheduledPart(
  date,
  shift
) {
  const targetDate =
    date instanceof Date
      ? new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate()
        )
      : new Date(
          `${String(date || "")}T00:00:00`
        );

  if (
    Number.isNaN(
      targetDate.getTime()
    )
  ) {
    return "";
  }

  const anchorDate =
    new Date(
      2026,
      6,
      15
    );

  const dayDifference =
    Math.round(
      (
        targetDate.getTime() -
        anchorDate.getTime()
      ) /
      86400000
    );

  const cycleDay =
    (
      (
        dayDifference %
        8
      ) +
      8
    ) %
    8;

  const cycleIndex =
    Math.floor(
      cycleDay / 2
    );

  const normalizedShift =
    String(
      shift || ""
    )
      .trim()
      .toUpperCase();

  const scheduleMap = {
    DS: [
      "2파트",
      "3파트",
      "1파트",
      "4파트"
    ],

    NS: [
      "1파트",
      "4파트",
      "2파트",
      "3파트"
    ]
  };

  return (
    scheduleMap[
      normalizedShift
    ]?.[
      cycleIndex
    ] ||
    ""
  );
}


/* =========================================================
  기존 TM 내용에서 TAG 분리

  예:
  [10HFB10AF001] Bio Rotary Feeder 점검
  → tag     : 10HFB10AF001
  → content : Bio Rotary Feeder 점검
========================================================= */

function extractLegacyTagFromContent(
  rawContent
) {
  const sourceText =
    String(
      rawContent || ""
    ).trim();

  if (!sourceText) {
    return {
      tag: "",
      content: ""
    };
  }

  const tagMatch =
    sourceText.match(
      /^\s*[\[【]\s*([A-Za-z0-9_.\-\/]+)\s*[\]】]\s*(.*)$/
    );

  if (!tagMatch) {
    return {
      tag: "",
      content:
        sourceText
    };
  }

  return {
    tag:
      String(
        tagMatch[1] || ""
      )
        .trim()
        .toUpperCase(),

    content:
      String(
        tagMatch[2] || ""
      ).trim()
  };
}

function normalizeTeamName(teamName) {
  const rawTeamName =
    String(teamName || "")
      .trim();

  if (!rawTeamName) {
    return "";
  }

  /*
    기존 저장 데이터의 과거 조 표기도
    1파트~4파트로 자동 변환한다.
  */
  if (/^[1-4]조$/.test(rawTeamName)) {
    return rawTeamName.replace(
      /조$/,
      "파트"
    );
  }

  if (/^[1-4]$/.test(rawTeamName)) {
    return `${rawTeamName}파트`;
  }

  return rawTeamName;
}


function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
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
    formatInputDate(
      appState.selectedDate
    );

  const shiftMemberCards = [
    ...document.querySelectorAll(
      ".shift-member-card"
    )
  ];

  shiftMemberCards.forEach(
    (card) => {
      const role =
        normalizeMemberLogRole(
          card.dataset.role
        );

      const nameElement =
        card.querySelector(
          ".shift-member-card__name"
        );

      const nameWrapElement =
        card.querySelector(
          ".shift-member-card__name-wrap"
        );

      const teamElement =
        card.querySelector(
          ".shift-member-card__team"
        );

      const statusElement =
        card.querySelector(
          ".shift-member-card__status"
        );


      /*
        근무자 카드에서는
        근무파트를 표시하지 않는다.
      */
      if (teamElement) {
        teamElement.textContent =
          "";

        teamElement.hidden =
          true;
      }


      /*
        이전 렌더링에서 생성된
        대근 배지를 먼저 제거한다.
      */
      card
        .querySelectorAll(
          ".shift-member-card__substitute"
        )
        .forEach(
          (badge) => {
            badge.remove();
          }
        );


      /*
        현재 날짜·근무·보직에 해당하는
        가장 최근 업무일지를 찾는다.
      */
      const matchedLogs =
        appState.logs
          .filter(
            (log) => {
              return (
                String(
                  log.date || ""
                ).trim() ===
                  selectedDate &&

                String(
                  log.shift || ""
                ).trim() ===
                  String(
                    appState.selectedShift ||
                    ""
                  ).trim() &&

                normalizeMemberLogRole(
                  log.role
                ) ===
                  role
              );
            }
          )
          .sort(
            (
              logA,
              logB
            ) => {
              const timeA =
                new Date(
                  logA.updatedAt ||
                  logA.createdAt ||
                  0
                ).getTime();

              const timeB =
                new Date(
                  logB.updatedAt ||
                  logB.createdAt ||
                  0
                ).getTime();

              return timeB - timeA;
            }
          );

      const existingLog =
        matchedLogs[0] ||
        null;


      /*
        업무일지가 없으면
        이름을 비우고 미작성 표시
      */
      if (!existingLog) {
        if (nameElement) {
          nameElement.textContent =
            "";
        }

        card.dataset.logState =
          "empty";

        if (statusElement) {
          statusElement.textContent =
            "미작성";

          statusElement.className =
            "shift-member-card__status is-empty";
        }

        return;
      }


      /*
        업무일지가 있으면
        실제 작성자를 표시한다.
      */
      const authorName =
        String(
          existingLog.author ||
          ""
        ).trim();

      if (nameElement) {
        nameElement.textContent =
          authorName;
      }


      /*
        대근 체크된 업무일지만
        대근 배지를 표시한다.
      */
      if (
        existingLog.isSubstitute ===
        true
      ) {
        const substituteBadge =
          document.createElement(
            "span"
          );

        substituteBadge.className =
          "shift-member-card__substitute";

        substituteBadge.textContent =
          "대근";

        if (nameWrapElement) {
          nameWrapElement.appendChild(
            substituteBadge
          );
        } else if (
          nameElement?.parentElement
        ) {
          nameElement
            .parentElement
            .appendChild(
              substituteBadge
            );
        }
      }


      card.dataset.logState =
        "existing";

      if (!statusElement) {
        return;
      }


      /*
        결재완료
      */
      if (
        existingLog.status ===
        "결재완료"
      ) {
        statusElement.textContent =
          "결재완료";

        statusElement.className =
          "shift-member-card__status is-approved";

        return;
      }


      /*
        결재요청까지 완료한 상태
      */
      if (
        existingLog.status ===
        "작성완료"
      ) {
        statusElement.textContent =
          "작성완료";

        statusElement.className =
          "shift-member-card__status is-complete";

        return;
      }


      /*
        저장만 한 상태
      */
      statusElement.textContent =
        "작성중";

      statusElement.className =
        "shift-member-card__status is-writing";
    }
  );
}


function closeLogEditor() {
  closeModal(elements.logEditorModal);
}


function resetLogEditor() {
  elements.logEditorForm.reset();

  setEditorDateFromSelectedDate();

  elements.logAuthor.value =
    "이휘근";

  const scheduledPart =
    getScheduledPart(
      appState.selectedDate,
      appState.selectedShift
    );

  elements.logTeam.value =
    scheduledPart ||
    "3파트";

  elements.logShift.value =
    appState.selectedShift;

  /*
    새 업무일지 작성 시
    대근 여부는 기본적으로 해제한다.
  */
  if (
    elements.logIsSubstitute
  ) {
    elements.logIsSubstitute.checked =
      false;
  }

  elements.operationStatus.value =
    "";

  elements.logNote.value =
    "";

  elements.logEditorForm.dataset.editingId =
    "";

  appState.editorEntries = [];

  appState.editingEntryIndex =
    -1;

  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  renderLogEntryTable();

  elements.logAttachments.value =
    "";

  elements.attachmentList.innerHTML =
    "";
}


function fillLogEditor(log) {
  if (
    !log ||
    !elements.logEditorForm
  ) {
    return;
  }

  elements.logEditorForm.dataset.editingId =
    String(
      log.id || ""
    ).trim();

  elements.logDate.value =
    log.date || "";

  elements.logShift.value =
    log.shift ||
    appState.selectedShift;

  elements.logTeam.value =
    normalizeTeamName(
      log.team || "3파트"
    );

  elements.logRole.value =
    log.role || "";

  elements.logAuthor.value =
    log.author || "";

  /*
    저장된 대근 여부 복원
  */
  if (
    elements.logIsSubstitute
  ) {
    elements.logIsSubstitute.checked =
      Boolean(
        log.isSubstitute
      );
  }

  elements.operationStatus.value =
    log.operationStatus || "";

  if (
    elements.operationStatusSnapshot
  ) {
    elements.operationStatusSnapshot.value =
      log.operationStatus || "";
  }

  elements.logNote.value =
    log.note || "";

  appState.editorEntries =
    Array.isArray(
      log.entries
    )
      ? log.entries.map(
          (entry) => {
            const rawSourceIndex =
              entry.importedFromEntryIndex;

            const sourceIndex =
              rawSourceIndex === "" ||
              rawSourceIndex === null ||
              rawSourceIndex === undefined
                ? ""
                : Number(
                    rawSourceIndex
                  );

            return {
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
                String(
                  entry.tag || ""
                )
                  .trim()
                  .toUpperCase(),

              content:
                String(
                  entry.content || ""
                ).trim(),

              importedFromRole:
                String(
                  entry.importedFromRole ||
                  ""
                ).trim(),

              importedFromAuthor:
                String(
                  entry.importedFromAuthor ||
                  ""
                ).trim(),

              importedFromLogId:
                String(
                  entry.importedFromLogId ||
                  ""
                ).trim(),

              importedFromEntryIndex:
                Number.isInteger(
                  sourceIndex
                )
                  ? sourceIndex
                  : ""
            };
          }
        )
      : [];

  appState.editingEntryIndex =
    -1;

  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  renderLogEntryTable();

  renderSavedAttachments(
    Array.isArray(
      log.attachments
    )
      ? log.attachments
      : []
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
  const category =
    String(
      elements.logEntryCategory
        ?.value ||
      "인계사항"
    ).trim();

  const isHandover =
    category === "인계사항";

  const needsTag =
    category.startsWith("TM") ||
    category.startsWith("BM") ||
    category.startsWith("CM");

  let normalizedTime = "";

  /*
    시간은 인계사항에서만 입력하고 검사한다.
  */
  if (isHandover) {
    normalizedTime =
      normalizeLogEntryTime();

    if (!normalizedTime) {
      showToast(
        "인계사항 시간을 직접 입력하거나 현재시간을 체크해 주세요."
      );

      elements.logEntryTime
        ?.focus();

      return;
    }
  }

  const tag =
    needsTag
      ? String(
          elements.logEntryTag
            ?.value ||
          ""
        )
          .trim()
          .toUpperCase()
      : "";

  const content =
    String(
      elements.logEntryContent
        ?.value ||
      ""
    ).trim();

  if (!category) {
    showToast(
      "구분을 선택해 주세요."
    );

    elements.logEntryCategory
      ?.focus();

    return;
  }

  if (
    needsTag &&
    !tag
  ) {
    showToast(
      `${category} 내역은 TAG를 입력해 주세요.`
    );

    elements.logEntryTag
      ?.focus();

    return;
  }

  if (!content) {
    showToast(
      "작업 내용을 입력해 주세요."
    );

    elements.logEntryContent
      ?.focus();

    return;
  }

  const isEditing =
    appState.editingEntryIndex >= 0;

  const previousEntry =
    isEditing
      ? appState.editorEntries[
          appState.editingEntryIndex
        ]
      : null;

  const rawSourceIndex =
    previousEntry
      ?.importedFromEntryIndex;

  const importedFromEntryIndex =
    rawSourceIndex === "" ||
    rawSourceIndex === null ||
    rawSourceIndex === undefined
      ? null
      : Number(rawSourceIndex);

  const entry = {
    time:
      isHandover
        ? normalizedTime
        : "",

    category,

    tag,

    content,

    importedFromRole:
      String(
        previousEntry
          ?.importedFromRole ||
        ""
      ).trim(),

    importedFromAuthor:
      String(
        previousEntry
          ?.importedFromAuthor ||
        ""
      ).trim(),

    importedFromLogId:
      String(
        previousEntry
          ?.importedFromLogId ||
        ""
      ).trim(),

    importedFromEntryIndex:
      Number.isInteger(
        importedFromEntryIndex
      ) &&
      importedFromEntryIndex >= 0
        ? importedFromEntryIndex
        : null
  };

  if (isEditing) {
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

  sortImportedLogEntries();
  renderLogEntryTable();

  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  updateMemberLogImportStatus();

  elements.logEntryContent
    ?.focus();
}

function renderLogEntryTable() {
  const entries =
    Array.isArray(
      appState.editorEntries
    )
      ? appState.editorEntries
      : [];

  const isLeaderLog =
    normalizeMemberLogRole(
      elements.logRole?.value
    ) ===
    "파트장";


  /*
    화면에서 정렬하더라도
    수정·삭제는 실제 배열 인덱스를 사용한다.
  */
  const indexedEntries =
    entries.map(
      (
        entry,
        originalIndex
      ) => {
        return {
          entry,
          originalIndex
        };
      }
    );


  /* =====================================================
    TM 발행 내역
  ====================================================== */

  const tmIssueEntries =
    indexedEntries
      .filter(
        ({ entry }) => {
          return (
            String(
              entry.category || ""
            ).trim() ===
            "TM 발행"
          );
        }
      )
      .sort(
        (
          itemA,
          itemB
        ) => {
          const timeA =
            String(
              itemA.entry.time || ""
            ).trim();

          const timeB =
            String(
              itemB.entry.time || ""
            ).trim();

          if (
            timeA &&
            !timeB
          ) {
            return -1;
          }

          if (
            !timeA &&
            timeB
          ) {
            return 1;
          }

          if (
            timeA &&
            timeB
          ) {
            const timeDifference =
              timeA.localeCompare(
                timeB
              );

            if (
              timeDifference !== 0
            ) {
              return timeDifference;
            }
          }

          return (
            itemA.originalIndex -
            itemB.originalIndex
          );
        }
      );


  /* =====================================================
    TM을 제외한 일반 업무
  ====================================================== */

  const ordinaryEntries =
    indexedEntries.filter(
      ({ entry }) => {
        return (
          String(
            entry.category || ""
          ).trim() !==
          "TM 발행"
        );
      }
    );


  /* =====================================================
    보직별 순서
  ====================================================== */

  const roleOrder = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2",
    "파트장"
  ];


  /*
    보직별 업무 묶기

    가져온 팀원 업무는 importedFromRole을 사용하고,
    직접 작성한 내용은 현재 업무일지 보직을 사용한다.
  */
  const groupedEntries = {};

  ordinaryEntries.forEach(
    (item) => {
      const sourceRole =
        normalizeMemberLogRole(
          item.entry
            .importedFromRole ||
          elements.logRole?.value ||
          "파트장"
        );

      if (
        !groupedEntries[
          sourceRole
        ]
      ) {
        groupedEntries[
          sourceRole
        ] = [];
      }

      groupedEntries[
        sourceRole
      ].push(
        item
      );
    }
  );


  /*
    각 보직 내부에서는
    시간순으로 정렬한다.
  */
  Object.keys(
    groupedEntries
  ).forEach(
    (role) => {
      groupedEntries[
        role
      ].sort(
        (
          itemA,
          itemB
        ) => {
          const timeA =
            String(
              itemA.entry.time || ""
            ).trim();

          const timeB =
            String(
              itemB.entry.time || ""
            ).trim();

          if (
            timeA &&
            !timeB
          ) {
            return -1;
          }

          if (
            !timeA &&
            timeB
          ) {
            return 1;
          }

          if (
            timeA &&
            timeB
          ) {
            const timeDifference =
              timeA.localeCompare(
                timeB
              );

            if (
              timeDifference !== 0
            ) {
              return timeDifference;
            }
          }

          return (
            itemA.originalIndex -
            itemB.originalIndex
          );
        }
      );
    }
  );


  const orderedRoles = [
    ...roleOrder.filter(
      (role) => {
        return Boolean(
          groupedEntries[
            role
          ]?.length
        );
      }
    ),

    ...Object.keys(
      groupedEntries
    ).filter(
      (role) => {
        return (
          !roleOrder.includes(
            role
          )
        );
      }
    )
  ];


  /* =====================================================
    건수 표시
  ====================================================== */

  if (
    elements.logEntryCount
  ) {
    elements.logEntryCount.textContent =
      `총 ${entries.length}건`;
  }

  if (
    elements.tmIssueEntryCount
  ) {
    elements.tmIssueEntryCount.textContent =
      `${tmIssueEntries.length}건`;
  }

  if (
    elements.handoverEntryCount
  ) {
    elements.handoverEntryCount.textContent =
      `${ordinaryEntries.length}건`;
  }


  /* =====================================================
    저장용 JSON
  ====================================================== */

  if (
    elements.logEntriesJson
  ) {
    elements.logEntriesJson.value =
      JSON.stringify(
        entries
      );
  }


  /* =====================================================
    선택 상태 초기화
  ====================================================== */

  if (
    elements.selectAllTmEntriesCheckbox
  ) {
    elements
      .selectAllTmEntriesCheckbox
      .checked =
      false;

    elements
      .selectAllTmEntriesCheckbox
      .indeterminate =
      false;

    elements
      .selectAllTmEntriesCheckbox
      .disabled =
      tmIssueEntries.length ===
      0;
  }

  if (
    elements.selectAllLogEntriesCheckbox
  ) {
    elements
      .selectAllLogEntriesCheckbox
      .checked =
      false;

    elements
      .selectAllLogEntriesCheckbox
      .indeterminate =
      false;

    elements
      .selectAllLogEntriesCheckbox
      .disabled =
      ordinaryEntries.length ===
      0;
  }

  if (
    elements.selectedLogEntryCount
  ) {
    elements
      .selectedLogEntryCount
      .textContent =
      "선택 0건";

    elements
      .selectedLogEntryCount
      .hidden =
      true;
  }

  if (
    elements
      .deleteSelectedLogEntriesButton
  ) {
    elements
      .deleteSelectedLogEntriesButton
      .disabled =
      true;
  }


  /* =====================================================
    구분 배지 클래스
  ====================================================== */

  const getCategoryBadgeClass = (
    category
  ) => {
    const categoryText =
      String(
        category || ""
      ).trim();

    if (
      categoryText ===
      "인계사항"
    ) {
      return "is-handover";
    }

    if (
      categoryText ===
        "TM 발행" ||
      categoryText ===
        "TM 작업" ||
      categoryText.startsWith(
        "TM "
      )
    ) {
      return "is-tm-work";
    }

    if (
      categoryText.includes(
        "점검"
      )
    ) {
      return "is-inspection";
    }

    if (
      categoryText.includes(
        "작업"
      )
    ) {
      return "is-work";
    }

    return "is-default";
  };


  const createCategoryBadgeHtml = (
    entry
  ) => {
    const categoryText =
      String(
        entry.category ||
        "인계사항"
      ).trim();

    return `
      <span
        class="
          log-entry-category-badge
          ${getCategoryBadgeClass(
            categoryText
          )}
        "
      >
        ${escapeHtml(
          categoryText
        )}
      </span>
    `;
  };


  const createTagHtml = (
    entry,
    originalIndex
  ) => {
    const tagText =
      String(
        entry.tag || ""
      )
        .trim()
        .toUpperCase();

    if (!tagText) {
      return "";
    }

    return `
      <button
        type="button"
        class="log-entry-inline-tag"
        data-entry-action="navigator"
        data-entry-index="${originalIndex}"
        title="Facility Navigator에서 설비 보기"
      >
        [${escapeHtml(
          tagText
        )}]
      </button>
    `;
  };


  const createSelectCellHtml = (
    entry,
    originalIndex
  ) => {
    const categoryText =
      String(
        entry.category ||
        "인계사항"
      ).trim();

    return `
      <td
        class="
          log-entry-select-cell
          log-entry-edit-only-cell
        "
        hidden
      >
        <input
          type="checkbox"
          class="log-entry-select-checkbox"
          data-entry-select-index="${originalIndex}"
          aria-label="${escapeHtml(
            categoryText
          )} 항목 선택"
        />
      </td>
    `;
  };


  const createActionCellHtml = (
    originalIndex
  ) => {
    return `
      <td
        class="
          log-entry-actions-cell
          log-entry-edit-only-cell
        "
        hidden
      >
        <div class="log-entry-row-actions">

          <button
            type="button"
            class="log-entry-edit-button"
            data-entry-action="edit"
            data-entry-index="${originalIndex}"
          >
            수정
          </button>

          <button
            type="button"
            class="log-entry-delete-button"
            data-entry-action="delete"
            data-entry-index="${originalIndex}"
          >
            삭제
          </button>

        </div>
      </td>
    `;
  };


  /* =====================================================
    TM 발행 내역 출력
  ====================================================== */

  if (
    elements.tmIssueEntryTableBody
  ) {
    if (
      !tmIssueEntries.length
    ) {
      elements
        .tmIssueEntryTableBody
        .innerHTML = `
          <tr class="log-entry-empty-row">
            <td colspan="4">
              등록된 TM 발행 내역이 없습니다.
            </td>
          </tr>
        `;
    } else {
      elements
        .tmIssueEntryTableBody
        .innerHTML =
        tmIssueEntries
          .map(
            (
              {
                entry,
                originalIndex
              },
              tmIndex
            ) => {
              const contentText =
                String(
                  entry.content || "-"
                ).trim();

              const isEditing =
                originalIndex ===
                appState
                  .editingEntryIndex;

              return `
                <tr
                  data-entry-index="${originalIndex}"
                  class="${
                    isEditing
                      ? "is-editing"
                      : ""
                  }"
                >
                  ${createSelectCellHtml(
                    entry,
                    originalIndex
                  )}

                  <td class="log-entry-category-cell-wrap">
                    <div class="log-entry-category-cell">
                      ${createCategoryBadgeHtml(
                        entry
                      )}
                    </div>
                  </td>

                  <td class="log-entry-content-cell">

                    <span
                      class="
                        log-entry-handover-line
                        log-entry-tm-line
                      "
                    >
                      <strong
                        class="
                          log-entry-handover-number
                          log-entry-tm-number
                        "
                      >
                        ${tmIndex + 1}.
                      </strong>

                      <span
                        class="
                          log-entry-handover-text
                          log-entry-tm-text
                        "
                      >
                        ${escapeHtml(
                          contentText
                        )}
                      </span>

                      ${createTagHtml(
                        entry,
                        originalIndex
                      )}

                    </span>

                  </td>

                  ${createActionCellHtml(
                    originalIndex
                  )}
                </tr>
              `;
            }
          )
          .join("");
    }
  }


  /* =====================================================
    일반 업무 출력
  ====================================================== */

  if (
    elements.logEntryTableBody
  ) {
    if (
      !ordinaryEntries.length
    ) {
      elements
        .logEntryTableBody
        .innerHTML = `
          <tr class="log-entry-empty-row">
            <td colspan="5">
              등록된 인계사항이 없습니다.
            </td>
          </tr>
        `;
    } else {
      let overallNumber = 0;

      const createEntryRowHtml = (
        item,
        roleNumber
      ) => {
        const {
          entry,
          originalIndex
        } = item;

        overallNumber += 1;

        const contentText =
          String(
            entry.content || "-"
          ).trim();

        const timeText =
          String(
            entry.time || ""
          ).trim();

        const isEditing =
          originalIndex ===
            appState
              .editingEntryIndex;

        return `
          <tr
            data-entry-index="${originalIndex}"
            class="${
              isEditing
                ? "is-editing"
                : ""
            }"
          >
            ${createSelectCellHtml(
              entry,
              originalIndex
            )}

            <td class="log-entry-category-cell-wrap">
              <div class="log-entry-category-cell">
                ${createCategoryBadgeHtml(
                  entry
                )}
              </div>
            </td>

            <td class="log-entry-time-cell">
              <span class="log-entry-time-group-label">
                ${escapeHtml(
                  timeText ||
                  "시간 없음"
                )}
              </span>
            </td>

            <td class="log-entry-content-cell">

              <span class="log-entry-handover-line">

                <strong class="log-entry-handover-number">
                  ${
                    isLeaderLog
                      ? roleNumber
                      : overallNumber
                  }.
                </strong>

                <span class="log-entry-handover-text">
                  ${escapeHtml(
                    contentText
                  )}
                </span>

                ${createTagHtml(
                  entry,
                  originalIndex
                )}

              </span>

            </td>

            ${createActionCellHtml(
              originalIndex
            )}
          </tr>
        `;
      };


      /*
        파트장 업무일지는 보직별 구분 출력
      */
      if (
        isLeaderLog
      ) {
        elements
          .logEntryTableBody
          .innerHTML =
          orderedRoles
            .map(
              (
                role,
                roleIndex
              ) => {
                const roleEntries =
                  groupedEntries[
                    role
                  ];

                const roleClass =
                  getLogEntrySourceClass(
                    role
                  );

                return `
                  <tr
                    class="
                      log-entry-role-divider-row
                      ${
                        roleIndex === 0
                          ? "is-first-role"
                          : ""
                      }
                    "
                  >
                    <td colspan="5">

                      <div class="log-entry-role-divider">

                        <span
                          class="
                            log-entry-role-divider__badge
                            ${roleClass}
                          "
                        >
                          ${escapeHtml(
                            role
                          )}
                        </span>

                        <strong>
                          ${escapeHtml(
                            role
                          )} 업무일지
                        </strong>

                        <span class="log-entry-role-divider__count">
                          ${roleEntries.length}건
                        </span>

                      </div>

                    </td>
                  </tr>

                  ${roleEntries
                    .map(
                      (
                        item,
                        index
                      ) => {
                        return createEntryRowHtml(
                          item,
                          index + 1
                        );
                      }
                    )
                    .join("")}
                `;
              }
            )
            .join("");
      } else {
        /*
          일반 보직 업무일지는 기존 표 형태 유지
        */
        const sortedEntries =
          [...ordinaryEntries]
            .sort(
              (
                itemA,
                itemB
              ) => {
                const timeA =
                  String(
                    itemA.entry.time ||
                    ""
                  ).trim();

                const timeB =
                  String(
                    itemB.entry.time ||
                    ""
                  ).trim();

                if (
                  timeA &&
                  !timeB
                ) {
                  return -1;
                }

                if (
                  !timeA &&
                  timeB
                ) {
                  return 1;
                }

                if (
                  timeA &&
                  timeB
                ) {
                  const difference =
                    timeA.localeCompare(
                      timeB
                    );

                  if (
                    difference !== 0
                  ) {
                    return difference;
                  }
                }

                return (
                  itemA.originalIndex -
                  itemB.originalIndex
                );
              }
            );

        elements
          .logEntryTableBody
          .innerHTML =
          sortedEntries
            .map(
              (
                item,
                index
              ) => {
                return createEntryRowHtml(
                  item,
                  index + 1
                );
              }
            )
            .join("");
      }
    }
  }


  updateMemberLogImportCount();
}

/* =========================================================
  인수인계사항 편집 모드
========================================================= */

function setLogEntryEditMode(
  isEditing
) {
  if (
    elements.logEntryListPanel
  ) {
    elements.logEntryListPanel
      .classList.toggle(
        "is-edit-mode",
        isEditing
      );
  }

  if (
    elements.openLogEntryEditModeButton
  ) {
    elements
      .openLogEntryEditModeButton
      .hidden =
      isEditing;
  }

  if (
    elements.cancelLogEntryEditModeButton
  ) {
    elements
      .cancelLogEntryEditModeButton
      .hidden =
      !isEditing;
  }

  if (
    elements.deleteSelectedLogEntriesButton
  ) {
    elements
      .deleteSelectedLogEntriesButton
      .hidden =
      !isEditing;

    elements
      .deleteSelectedLogEntriesButton
      .disabled =
      true;
  }

  document
    .querySelectorAll(
      ".log-entry-edit-only-column"
    )
    .forEach((element) => {
      element.hidden =
        !isEditing;
    });

  document
    .querySelectorAll(
      ".log-entry-edit-only-cell"
    )
    .forEach((element) => {
      element.hidden =
        !isEditing;
    });

  if (!isEditing) {
    clearLogEntrySelections();

    if (
      appState.editingEntryIndex >= 0
    ) {
      cancelLogEntryEdit();
    }
  }
}


/* =========================================================
  선택 상태 초기화
========================================================= */

function clearLogEntrySelections() {
  document
    .querySelectorAll(
      ".log-entry-select-checkbox"
    )
    .forEach((checkbox) => {
      checkbox.checked =
        false;

      checkbox.indeterminate =
        false;
    });

  if (
    elements.selectedLogEntryCount
  ) {
    elements
      .selectedLogEntryCount
      .textContent =
      "선택 0건";

    elements
      .selectedLogEntryCount
      .hidden =
      true;
  }

  if (
    elements.deleteSelectedLogEntriesButton
  ) {
    elements
      .deleteSelectedLogEntriesButton
      .disabled =
      true;
  }
}


/* =========================================================
  선택된 인수인계 항목 상태 갱신
========================================================= */

function updateLogEntrySelectionState() {
  const itemCheckboxes = [
    ...document.querySelectorAll(
      [
        "#tmIssueEntryTableBody",
        "#logEntryTableBody"
      ].join(" ") +
      " .log-entry-select-checkbox"
    )
  ];

  const selectedCheckboxes =
    itemCheckboxes.filter(
      (checkbox) => {
        return checkbox.checked;
      }
    );

  const selectedCount =
    selectedCheckboxes.length;

  if (
    elements.selectedLogEntryCount
  ) {
    elements
      .selectedLogEntryCount
      .textContent =
      `선택 ${selectedCount}건`;

    elements
      .selectedLogEntryCount
      .hidden =
      selectedCount === 0;
  }

  if (
    elements.deleteSelectedLogEntriesButton
  ) {
    elements
      .deleteSelectedLogEntriesButton
      .disabled =
      selectedCount === 0;
  }


  /*
    TM 발행 내역 전체 선택 상태
  */
  const tmCheckboxes = [
    ...document.querySelectorAll(
      "#tmIssueEntryTableBody " +
      ".log-entry-select-checkbox"
    )
  ];

  const selectedTmCount =
    tmCheckboxes.filter(
      (checkbox) => {
        return checkbox.checked;
      }
    ).length;

  if (
    elements.selectAllTmEntriesCheckbox
  ) {
    elements
      .selectAllTmEntriesCheckbox
      .checked =
      tmCheckboxes.length > 0 &&
      selectedTmCount ===
        tmCheckboxes.length;

    elements
      .selectAllTmEntriesCheckbox
      .indeterminate =
      selectedTmCount > 0 &&
      selectedTmCount <
        tmCheckboxes.length;

    elements
      .selectAllTmEntriesCheckbox
      .disabled =
      tmCheckboxes.length === 0;
  }


  /*
    인계사항 전체 선택 상태
  */
  const handoverCheckboxes = [
    ...document.querySelectorAll(
      "#logEntryTableBody " +
      ".log-entry-select-checkbox"
    )
  ];

  const selectedHandoverCount =
    handoverCheckboxes.filter(
      (checkbox) => {
        return checkbox.checked;
      }
    ).length;

  if (
    elements.selectAllLogEntriesCheckbox
  ) {
    elements
      .selectAllLogEntriesCheckbox
      .checked =
      handoverCheckboxes.length > 0 &&
      selectedHandoverCount ===
        handoverCheckboxes.length;

    elements
      .selectAllLogEntriesCheckbox
      .indeterminate =
      selectedHandoverCount > 0 &&
      selectedHandoverCount <
        handoverCheckboxes.length;

    elements
      .selectAllLogEntriesCheckbox
      .disabled =
      handoverCheckboxes.length === 0;
  }
}

/* =========================================================
  인수인계사항 편집 모드 이벤트
========================================================= */

function bindLogEntryEditModeEvents() {
  /*
    편집 모드 시작
  */
  if (
    elements.openLogEntryEditModeButton
  ) {
    elements
      .openLogEntryEditModeButton
      .addEventListener(
        "click",
        () => {
          setLogEntryEditMode(
            true
          );
        }
      );
  }


  /*
    편집 모드 종료
  */
  if (
    elements.cancelLogEntryEditModeButton
  ) {
    elements
      .cancelLogEntryEditModeButton
      .addEventListener(
        "click",
        () => {
          setLogEntryEditMode(
            false
          );
        }
      );
  }


  /*
    TM 발행 목록의
    수정·삭제·TAG 이동
  */
  if (
    elements.tmIssueEntryTableBody
  ) {
    elements
      .tmIssueEntryTableBody
      .addEventListener(
        "click",
        handleLogEntryTableClick
      );

    elements
      .tmIssueEntryTableBody
      .addEventListener(
        "change",
        (event) => {
          const checkbox =
            event.target.closest(
              ".log-entry-select-checkbox"
            );

          if (!checkbox) {
            return;
          }

          updateLogEntrySelectionState();
        }
      );
  }


  /*
    인계사항 개별 체크 상태

    기존 bindEvents()에서 선택 상태를 먼저 처리하므로,
    해당 처리가 끝난 직후 전체 목록 기준으로 다시 계산한다.
  */
  if (
    elements.logEntryTableBody
  ) {
    elements
      .logEntryTableBody
      .addEventListener(
        "change",
        (event) => {
          const checkbox =
            event.target.closest(
              ".log-entry-select-checkbox"
            );

          if (!checkbox) {
            return;
          }

          window.setTimeout(
            updateLogEntrySelectionState,
            0
          );
        }
      );
  }


  /*
    TM 발행 내역 전체 선택
  */
  if (
    elements.selectAllTmEntriesCheckbox
  ) {
    elements
      .selectAllTmEntriesCheckbox
      .addEventListener(
        "change",
        () => {
          const shouldSelect =
            elements
              .selectAllTmEntriesCheckbox
              .checked;

          elements
            .tmIssueEntryTableBody
            ?.querySelectorAll(
              ".log-entry-select-checkbox"
            )
            .forEach(
              (checkbox) => {
                checkbox.checked =
                  shouldSelect;
              }
            );

          updateLogEntrySelectionState();
        }
      );
  }


  /*
    인계사항 전체 선택 후
    TM 목록까지 포함하여 선택 건수를 다시 계산한다.
  */
  if (
    elements.selectAllLogEntriesCheckbox
  ) {
    elements
      .selectAllLogEntriesCheckbox
      .addEventListener(
        "change",
        () => {
          window.setTimeout(
            updateLogEntrySelectionState,
            0
          );
        }
      );
  }


  /*
    TM 발행과 인계사항에서 선택한 항목을
    한 번에 삭제한다.

    capture 단계에서 실행하여
    이전 선택 삭제 이벤트와 충돌하지 않도록 한다.
  */
  if (
    elements.deleteSelectedLogEntriesButton
  ) {
    elements
      .deleteSelectedLogEntriesButton
      .addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();

          const selectedIndexes = [
            ...document.querySelectorAll(
              [
                "#tmIssueEntryTableBody",
                "#logEntryTableBody"
              ].join(
                " .log-entry-select-checkbox:checked, "
              ) +
              " .log-entry-select-checkbox:checked"
            )
          ]
            .map((checkbox) => {
              return Number(
                checkbox.dataset
                  .entrySelectIndex
              );
            })
            .filter((index) => {
              return (
                Number.isInteger(
                  index
                ) &&
                Boolean(
                  appState
                    .editorEntries[
                      index
                    ]
                )
              );
            });

          const uniqueIndexes = [
            ...new Set(
              selectedIndexes
            )
          ];

          if (!uniqueIndexes.length) {
            showToast(
              "삭제할 인수인계사항을 선택해 주세요."
            );

            return;
          }

          const shouldDelete =
            window.confirm(
              `선택한 인수인계사항 ${uniqueIndexes.length}건을 삭제하시겠습니까?`
            );

          if (!shouldDelete) {
            return;
          }

          /*
            큰 인덱스부터 삭제해야
            나머지 항목 인덱스가 바뀌지 않는다.
          */
          uniqueIndexes
            .sort(
              (
                indexA,
                indexB
              ) => {
                return (
                  indexB -
                  indexA
                );
              }
            )
            .forEach((index) => {
              appState
                .editorEntries
                .splice(
                  index,
                  1
                );
            });

          appState.editingEntryIndex =
            -1;

          resetLogEntryInput({
            keepCategory:
              false,

            keepTag:
              false
          });

          renderLogEntryTable();

          /*
            목록을 다시 그리면 편집 전용 칸이
            hidden 상태로 생성되므로 편집 모드를 다시 적용한다.
          */
          setLogEntryEditMode(
            true
          );

          updateMemberLogImportStatus();

          showToast(
            `인수인계사항 ${uniqueIndexes.length}건을 삭제했습니다.`
          );
        },
        true
      );
  }
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
  const category =
    String(
      elements.logEntryCategory?.value ||
      "인계사항"
    ).trim();

  const isHandover =
    category === "인계사항";

  const needsTag =
    category.startsWith("TM") ||
    category.startsWith("BM") ||
    category.startsWith("CM");

  const timeField =
    document.getElementById(
      "logEntryTimeField"
    );

  /*
    시간은 인계사항에서만 입력한다.
  */
  if (timeField) {
    timeField.hidden =
      !isHandover;
  }

  if (!isHandover) {
    if (elements.logEntryTime) {
      elements.logEntryTime.value =
        "";
    }

    if (
      elements.useCurrentTimeCheckbox
    ) {
      elements
        .useCurrentTimeCheckbox
        .checked =
        false;
    }
  }

  /*
    TM·BM·CM 관련 구분에서는
    TAG 입력창을 표시한다.
  */
  if (elements.logEntryTagField) {
    elements.logEntryTagField.hidden =
      !needsTag;
  }

  if (
    !needsTag &&
    elements.logEntryTag
  ) {
    elements.logEntryTag.value =
      "";
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
        const rawSourceIndex =
          entry
            .importedFromEntryIndex;

        const importedFromEntryIndex =
          rawSourceIndex === "" ||
          rawSourceIndex === null ||
          rawSourceIndex === undefined
            ? null
            : Number(
                rawSourceIndex
              );

        return {
          time:
            String(
              entry.time || ""
            ).trim(),

          category:
            String(
              entry.category || ""
            ).trim(),

          tag:
            String(
              entry.tag || ""
            )
              .trim()
              .toUpperCase(),

          content:
            String(
              entry.content || ""
            ).trim(),

          importedFromRole:
            String(
              entry
                .importedFromRole ||
              ""
            ).trim(),

          importedFromAuthor:
            String(
              entry
                .importedFromAuthor ||
              ""
            ).trim(),

          importedFromLogId:
            String(
              entry
                .importedFromLogId ||
              ""
            ).trim(),

          importedFromEntryIndex:
            Number.isInteger(
              importedFromEntryIndex
            ) &&
            importedFromEntryIndex >= 0
              ? importedFromEntryIndex
              : null
        };
      }
    );

  const newAttachmentNames =
    elements.logAttachments
      ? [
          ...elements
            .logAttachments
            .files
        ].map(
          (file) => {
            return file.name;
          }
        )
      : [];

  const savedAttachmentNames =
    elements.attachmentList
      ? [
          ...elements
            .attachmentList
            .querySelectorAll(
              ".attachment-chip"
            )
        ].map(
          (chip) => {
            return chip
              .textContent
              .trim();
          }
        )
      : [];

  const attachmentNames = [
    ...new Set(
      [
        ...savedAttachmentNames,
        ...newAttachmentNames
      ].filter(Boolean)
    )
  ];

  const editingId =
    String(
      elements
        .logEditorForm
        .dataset
        .editingId ||
      ""
    ).trim();

  const currentOperationStatus =
    elements
      .operationStatusSnapshot
      ?.value
      ?.trim() ||
    elements
      .operationStatus
      ?.value
      ?.trim() ||
    appState
      .currentOperationStatus
      ?.content ||
    "";

  const now =
    new Date().toISOString();

  return {
    id:
      editingId ||
      createId(),

    date:
      elements.logDate.value,

    shift:
      elements.logShift.value,

    team:
      normalizeTeamName(
        elements.logTeam.value
      ),

    role:
      elements.logRole.value,

    author:
      elements.logAuthor.value
        .trim(),

    isSubstitute:
      Boolean(
        elements.logIsSubstitute
          ?.checked
      ),

    operationStatus:
      currentOperationStatus,

    entries,

    note:
      elements.logNote.value
        .trim(),

    attachments:
      attachmentNames,

    status,

    createdAt:
      now,

    updatedAt:
      now
  };
}


function saveCurrentLog(status) {
  if (
    !elements
      .logEditorForm
      .reportValidity()
  ) {
    return;
  }

  const log =
    collectEditorData(status);

  const hasEntryContent =
    log.entries.some((entry) => {
      return Boolean(
        String(
          entry.content || ""
        ).trim()
      );
    });

  if (
    !log.operationStatus &&
    !hasEntryContent &&
    !log.note
  ) {
    showToast(
      "운전 현황 또는 업무 내용을 입력해 주세요."
    );

    return;
  }

  const normalizedRole =
    normalizeMemberLogRole(
      log.role
    );

  /*
    현재 저장하려는 업무일지와 같은
    날짜·근무·보직의 기존 업무일지를 모두 찾는다.
  */
  const matchingLogs =
    appState.logs
      .map((item, index) => {
        return {
          item,
          index
        };
      })
      .filter(({ item }) => {
        return (
          String(
            item.date || ""
          ).trim() ===
            String(
              log.date || ""
            ).trim() &&

          String(
            item.shift || ""
          ).trim() ===
            String(
              log.shift || ""
            ).trim() &&

          normalizeMemberLogRole(
            item.role
          ) === normalizedRole
        );
      })
      .sort(
        (
          resultA,
          resultB
        ) => {
          const timeA =
            new Date(
              resultA.item
                .updatedAt ||
              resultA.item
                .createdAt ||
              0
            ).getTime();

          const timeB =
            new Date(
              resultB.item
                .updatedAt ||
              resultB.item
                .createdAt ||
              0
            ).getTime();

          return timeB - timeA;
        }
      );

  /*
    편집 중인 업무일지 ID가 있으면
    해당 일지를 우선 기준으로 삼는다.
  */
  const editingId =
    String(
      elements
        .logEditorForm
        .dataset
        .editingId ||
      ""
    ).trim();

  let baseLog =
    matchingLogs.find(
      ({ item }) => {
        return (
          String(
            item.id || ""
          ).trim() ===
          editingId
        );
      }
    )?.item || null;

  /*
    편집 ID를 찾지 못하면
    가장 최근에 수정된 업무일지를 기준으로 삼는다.
  */
  if (
    !baseLog &&
    matchingLogs.length
  ) {
    baseLog =
      matchingLogs[0].item;
  }

  if (baseLog) {
    log.id =
      baseLog.id;

    log.createdAt =
      baseLog.createdAt ||
      log.createdAt;
  }

  log.updatedAt =
    new Date().toISOString();

  /*
    같은 날짜·근무·보직의 기존 일지를
    모두 제거한 후 새 일지 하나만 저장한다.
  */
  appState.logs =
    appState.logs.filter((item) => {
      const isSameLogGroup =
        String(
          item.date || ""
        ).trim() ===
          String(
            log.date || ""
          ).trim() &&

        String(
          item.shift || ""
        ).trim() ===
          String(
            log.shift || ""
          ).trim() &&

        normalizeMemberLogRole(
          item.role
        ) === normalizedRole;

      return !isSameLogGroup;
    });

  appState.logs.unshift(
    log
  );

  persistLogs();

  localStorage.removeItem(
    STORAGE_KEYS.draft
  );

  elements
    .logEditorForm
    .dataset
    .editingId =
    log.id;

  appState.selectedDate =
    new Date(
      `${log.date}T00:00:00`
    );

  appState.selectedShift =
    log.shift;

  renderSelectedDate();
  renderLogTable();
  updateShiftMemberCardStates();

  closeLogEditor();

  showToast(
    status === "작성완료"
      ? "업무일지 작성을 완료하고 결재를 요청했습니다."
      : "업무일지를 작성 중 상태로 저장했습니다."
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
  const savedLogs =
    localStorage.getItem(
      STORAGE_KEYS.logs
    );

  let loadedLogs = [];

  if (savedLogs) {
    try {
      const parsedLogs =
        JSON.parse(savedLogs);

      loadedLogs =
        Array.isArray(parsedLogs)
          ? parsedLogs
          : [];
    } catch {
      localStorage.removeItem(
        STORAGE_KEYS.logs
      );

      loadedLogs = [];
    }
  }

  if (!loadedLogs.length) {
    loadedLogs =
      createSampleLogs();
  }

  /*
    같은 날짜·근무·보직의 업무일지가
    여러 개 존재하는 경우 가장 최근 일지 하나만 남긴다.
  */
  const sortedLogs = [
    ...loadedLogs
  ].sort((logA, logB) => {
    const timeA =
      new Date(
        logA.updatedAt ||
        logA.createdAt ||
        0
      ).getTime();

    const timeB =
      new Date(
        logB.updatedAt ||
        logB.createdAt ||
        0
      ).getTime();

    return timeB - timeA;
  });

  const uniqueLogMap =
    new Map();

  sortedLogs.forEach((log) => {
    const date =
      String(
        log.date || ""
      ).trim();

    const shift =
      String(
        log.shift || ""
      ).trim();

    const role =
      normalizeMemberLogRole(
        log.role
      );

    const uniqueKey = [
      date,
      shift,
      role
    ].join("||");

    /*
      최신순으로 정렬했기 때문에
      가장 먼저 들어온 업무일지가 최신본이다.
    */
    if (
      !uniqueLogMap.has(
        uniqueKey
      )
    ) {
      uniqueLogMap.set(
        uniqueKey,
        log
      );
    }
  });

  appState.logs = [
    ...uniqueLogMap.values()
  ].sort((logA, logB) => {
    const dateDifference =
      String(
        logB.date || ""
      ).localeCompare(
        String(
          logA.date || ""
        )
      );

    if (dateDifference !== 0) {
      return dateDifference;
    }

    const timeA =
      new Date(
        logA.updatedAt ||
        logA.createdAt ||
        0
      ).getTime();

    const timeB =
      new Date(
        logB.updatedAt ||
        logB.createdAt ||
        0
      ).getTime();

    return timeB - timeA;
  });

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

  const normalizedLogRole =
    normalizeMemberLogRole(
      log.role
    );

  const isLeaderLog =
    normalizedLogRole ===
    "파트장";


  /* =====================================================
    1. 운전현황
  ====================================================== */

  if (
    String(
      log.operationStatus || ""
    ).trim()
  ) {
    previewGroups.push({
      type:
        "normal",

      title:
        "운전현황",

      text:
        firstMeaningfulLine(
          log.operationStatus
        ),

      tag:
        "",

      categoryClass:
        "is-operation is-section-start"
    });
  }


  const entries =
    Array.isArray(
      log.entries
    )
      ? log.entries
      : [];


  /* =====================================================
    2. TM 발행 내역
  ====================================================== */

  const tmEntries =
    sortDetailEntriesByTime(
      entries.filter((entry) => {
        return (
          String(
            entry.category || ""
          ).trim() ===
          "TM 발행"
        );
      })
    );

  tmEntries.forEach(
    (
      entry,
      index
    ) => {
      const tagText =
        String(
          entry.tag || ""
        )
          .trim()
          .toUpperCase();

      const contentText =
        firstMeaningfulLine(
          entry.content
        ) || "-";

      previewGroups.push({
        type:
          "normal",

        title:
          index === 0
            ? "TM 발행 내역"
            : "",

        tag:
          tagText
            ? `[${tagText}]`
            : "",

        text:
          `${index + 1}. ${contentText}`,

        categoryClass: [
          "is-maintenance",

          index === 0
            ? "is-section-start"
            : ""
        ]
          .filter(Boolean)
          .join(" ")
      });
    }
  );


  /* =====================================================
    3. 인계사항 및 보직별 업무
  ====================================================== */

  const handoverEntries =
    entries.filter((entry) => {
      return (
        String(
          entry.category || ""
        ).trim() !==
        "TM 발행"
      );
    });

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

  handoverEntries.forEach(
    (entry) => {
      const sourceRole =
        normalizeMemberLogRole(
          entry.importedFromRole ||
          log.role ||
          "파트장"
        );

      if (
        !groupedEntries[
          sourceRole
        ]
      ) {
        groupedEntries[
          sourceRole
        ] = [];
      }

      groupedEntries[
        sourceRole
      ].push(
        entry
      );
    }
  );

  const orderedRoles = [
    ...roleOrder.filter(
      (role) => {
        return Boolean(
          groupedEntries[
            role
          ]?.length
        );
      }
    ),

    ...Object.keys(
      groupedEntries
    ).filter((role) => {
      return (
        !roleOrder.includes(
          role
        )
      );
    })
  ];


  orderedRoles.forEach(
    (
      role,
      roleIndex
    ) => {
      const roleEntries =
        sortDetailEntriesByTime(
          groupedEntries[
            role
          ]
        );


      /*
        파트장 업무일지에서는
        TGO부터 보직별 제목을 표시한다.

        첫 번째 보직 제목에는
        파트장 업무 시작 경계선 클래스를 추가한다.
      */
      if (
        isLeaderLog &&
        roleEntries.length
      ) {
        previewGroups.push({
          type:
            "role-section",

          title:
            `${role} 업무일지`,

          isFirstRole:
            roleIndex === 0,

          categoryClass: [
            "is-handover",

            getLogEntrySourceClass(
              role
            )
          ]
            .filter(Boolean)
            .join(" ")
        });
      }


      roleEntries.forEach(
        (
          entry,
          index
        ) => {
          const tagText =
            String(
              entry.tag || ""
            )
              .trim()
              .toUpperCase();

          const timeText =
            String(
              entry.time || ""
            ).trim();

          const contentText =
            firstMeaningfulLine(
              entry.content
            ) || "-";

          const displayText = [
            `${index + 1}.`,
            timeText,
            contentText
          ]
            .filter(Boolean)
            .join(" ");

          previewGroups.push({
            type:
              "normal",

            title:
              !isLeaderLog &&
              index === 0
                ? "인계"
                : "",

            tag:
              tagText
                ? `[${tagText}]`
                : "",

            text:
              displayText,

            categoryClass: [
              "is-handover",

              getLogEntrySourceClass(
                role
              ),

              !isLeaderLog &&
              roleIndex === 0 &&
              index === 0
                ? "is-section-start"
                : ""
            ]
              .filter(Boolean)
              .join(" ")
          });
        }
      );
    }
  );


  /* =====================================================
    4. 비고
  ====================================================== */

  if (
    String(
      log.note || ""
    ).trim()
  ) {
    previewGroups.push({
      type:
        "normal",

      title:
        "비고",

      text:
        firstMeaningfulLine(
          log.note
        ),

      tag:
        "",

      categoryClass:
        "is-note is-section-start"
    });
  }


  const attachmentCount =
    Array.isArray(
      log.attachments
    )
      ? log.attachments.length
      : 0;


  return `
    <tr class="log-row">

      <td class="log-row__role">
        ${escapeHtml(
          log.role || "-"
        )}
      </td>


      <td class="log-row__author-cell">

        <div class="log-row__author-wrap">

          <strong class="log-row__author">
            ${escapeHtml(
              log.author || "-"
            )}
          </strong>

          ${
            log.isSubstitute === true
              ? `
                <span class="substitute-work-badge">
                  대근
                </span>
              `
              : ""
          }

        </div>

      </td>


      <td class="log-row__status-cell">

        <span
          class="status-badge ${getStatusClass(
            log.status
          )}"
        >
          ${escapeHtml(
            log.status || "-"
          )}
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
          data-log-id="${escapeHtml(
            log.id
          )}"
          title="업무일지 상세보기"
        >

          ${
            previewGroups.length
              ? previewGroups
                  .map((group) => {

                    /*
                      파트장 보직별 업무 구분 제목
                    */
                    if (
                      group.type ===
                      "role-section"
                    ) {
                      return `
                        <span
                          class="
                            log-preview__role-section
                            ${
                              group.isFirstRole
                                ? "is-first-role"
                                : ""
                            }
                          "
                        >
                          <span
                            class="
                              log-preview__role-divider
                              ${group.categoryClass}
                            "
                          >
                            ${escapeHtml(
                              group.title
                            )}
                          </span>
                        </span>
                      `;
                    }


                    /*
                      일반 업무 내용
                    */
                    return `
                      <span
                        class="
                          log-preview__group
                          ${group.categoryClass}

                          ${
                            group.title
                              ? ""
                              : "has-no-title"
                          }
                        "
                      >

                        ${
                          group.title
                            ? `
                              <strong
                                class="log-preview__title"
                              >
                                ${escapeHtml(
                                  group.title
                                )}
                              </strong>
                            `
                            : ""
                        }

                        <span
                          class="log-preview__content"
                        >

                          <span
                            class="log-preview__text"
                          >
                            ${escapeHtml(
                              group.text || "-"
                            )}
                          </span>

                          ${
                            group.tag
                              ? `
                                <span
                                  class="log-preview__tag"
                                >
                                  ${escapeHtml(
                                    group.tag
                                  )}
                                </span>
                              `
                              : ""
                          }

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
            data-action="edit"
            data-log-id="${escapeHtml(
              log.id
            )}"
          >
            ${
              log.status ===
                "작성중" ||
              log.status ===
                "임시저장"
                ? "이어쓰기"
                : "수정"
            }
          </button>

          <button
            type="button"
            class="
              table-action-button
              is-delete
            "
            data-action="delete"
            data-log-id="${escapeHtml(
              log.id
            )}"
          >
            삭제
          </button>

        </div>

      </td>

    </tr>
  `;
}

function handleLogTableClick(
  event
) {
  const actionElement =
    event.target.closest(
      "[data-action][data-log-id]"
    );

  if (
    !actionElement ||
    !elements.logTableBody?.contains(
      actionElement
    )
  ) {
    return;
  }

  const logId =
    String(
      actionElement.dataset.logId ||
      ""
    ).trim();

  const action =
    String(
      actionElement.dataset.action ||
      ""
    ).trim();

  if (!logId) {
    showToast(
      "업무일지 정보를 확인할 수 없습니다."
    );

    return;
  }

  const log =
    appState.logs.find(
      (item) => {
        return (
          String(
            item.id || ""
          ) === logId
        );
      }
    );

  if (!log) {
    showToast(
      "업무일지를 찾을 수 없습니다."
    );

    return;
  }


  /*
    수정
  */
  if (action === "edit") {
    openLogEditor(log);
    return;
  }


  /*
    상세보기
  */
  if (action === "view") {
    openLogDetail(log);
    return;
  }


  /*
    삭제
  */
  if (action === "delete") {
    deleteLogById(
      log.id
    );
  }
}

function deleteLogById(
  logId
) {
  const targetLog =
    appState.logs.find(
      (log) => {
        return (
          String(
            log.id || ""
          ) ===
          String(
            logId || ""
          )
        );
      }
    );

  if (!targetLog) {
    showToast(
      "삭제할 업무일지를 찾을 수 없습니다."
    );

    return;
  }

  const shouldDelete =
    window.confirm(
      [
        "이 업무일지를 삭제하시겠습니까?",
        "",
        `날짜: ${targetLog.date || "-"}`,
        `근무: ${targetLog.shift || "-"}`,
        `보직: ${targetLog.role || "-"}`,
        `작성자: ${targetLog.author || "-"}`
      ].join("\n")
    );

  if (!shouldDelete) {
    return;
  }

  appState.logs =
    appState.logs.filter(
      (log) => {
        return (
          String(
            log.id || ""
          ) !==
          String(
            logId || ""
          )
        );
      }
    );


  /*
    새 시스템에서 작성한 업무일지만
    브라우저 저장소에 반영한다.

    기존 서버에서 불러온 업무일지는
    새로고침하거나 날짜를 다시 열면
    서버에서 다시 나타난다.
  */
  persistLogs();

  renderLogTable();
  updateShiftMemberCardStates();

  showToast(
    "업무일지를 삭제했습니다."
  );
}

function getStatusClass(
  status
) {
  const normalizedStatus =
    String(
      status || ""
    ).trim();

  if (
    normalizedStatus ===
    "결재완료"
  ) {
    return "is-approved";
  }

  if (
    normalizedStatus ===
    "작성완료"
  ) {
    return "is-saved";
  }

  return "is-writing";
}

function sortDetailEntriesByTime(
  entries
) {
  return [...entries].sort(
    (entryA, entryB) => {
      const timeA =
        String(
          entryA.time || ""
        ).trim();

      const timeB =
        String(
          entryB.time || ""
        ).trim();

      const hasTimeA =
        Boolean(timeA);

      const hasTimeB =
        Boolean(timeB);

      /*
        시간이 있는 항목을 먼저 배치한다.
      */
      if (
        hasTimeA &&
        !hasTimeB
      ) {
        return -1;
      }

      if (
        !hasTimeA &&
        hasTimeB
      ) {
        return 1;
      }

      /*
        둘 다 시간이 있으면
        오래된 시간부터 정렬한다.
      */
      if (
        hasTimeA &&
        hasTimeB
      ) {
        const timeDifference =
          timeA.localeCompare(
            timeB
          );

        if (
          timeDifference !== 0
        ) {
          return timeDifference;
        }
      }

      /*
        시간이 없거나 같은 시간이면
        원래 등록 순서를 유지한다.
      */
      return 0;
    }
  );
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

    groupedEntries[role].push(
      entry
    );
  });

  Object.keys(
    groupedEntries
  ).forEach((role) => {
    groupedEntries[role] =
      sortDetailEntriesByTime(
        groupedEntries[role]
      );
  });

  const orderedRoles = [
    ...roleOrder.filter(
      (role) => {
        return Boolean(
          groupedEntries[role]
            ?.length
        );
      }
    ),

    ...Object.keys(
      groupedEntries
    ).filter((role) => {
      return (
        !roleOrder.includes(
          role
        )
      );
    })
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
              .map(
                (
                  entry,
                  index
                ) => {
                  return createGroupedEntryLineHtml(
                    entry,
                    index
                  );
                }
              )
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
    String(
      entry.time || ""
    ).trim();

  const tagText =
    String(
      entry.tag || ""
    )
      .trim()
      .toUpperCase();

  const contentText =
    String(
      entry.content || "-"
    ).trim();

  return `
    <div class="detail-grouped-entry-line">

      <span
        class="detail-grouped-entry-line__number"
      >
        ${index + 1}.
      </span>

      ${
        timeText
          ? `
            <span
              class="detail-grouped-entry-line__time"
            >
              ${escapeHtml(
                timeText
              )}
            </span>
          `
          : ""
      }

      <span
        class="detail-grouped-entry-line__content"
      >
        <span
          class="detail-grouped-entry-line__content-text"
        >
          ${escapeHtml(
            contentText
          )}
        </span>

        ${
          tagText
            ? `
              <button
                type="button"
                class="detail-inline-tag"
                data-detail-tag="${escapeHtml(
                  tagText
                )}"
                title="Facility Navigator에서 설비 보기"
              >
                [${escapeHtml(
                  tagText
                )}]
              </button>
            `
            : ""
        }
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

  const sortedEntries =
    sortDetailEntriesByTime(
      entries
    );

  return sortedEntries
    .map((entry, index) => {
      return createGroupedEntryLineHtml(
        entry,
        index
      );
    })
    .join("");
}

/* =========================================================
  업무일지 결재 확인

  작성완료 상태의 업무일지를
  파트장이 확인하면 결재완료로 변경한다.
========================================================= */

function approveCurrentDetailLog() {
  const currentLogId =
    String(
      appState.currentDetailLogId ||
      ""
    ).trim();

  if (!currentLogId) {
    showToast(
      "결재할 업무일지를 찾을 수 없습니다."
    );

    return;
  }

  const targetLog =
    appState.logs.find(
      (log) => {
        return (
          String(
            log.id || ""
          ).trim() ===
          currentLogId
        );
      }
    );

  if (!targetLog) {
    showToast(
      "결재할 업무일지를 찾을 수 없습니다."
    );

    return;
  }

  /*
    작성완료 상태에서만 결재할 수 있다.
  */
  if (
    targetLog.status !==
    "작성완료"
  ) {
    showToast(
      targetLog.status ===
        "결재완료"
        ? "이미 결재가 완료된 업무일지입니다."
        : "작성완료 상태의 업무일지만 결재할 수 있습니다."
    );

    return;
  }

  const shouldApprove =
    window.confirm(
      [
        "이 업무일지를 결재완료 처리하시겠습니까?",
        "",
        `작성일: ${targetLog.date || "-"}`,
        `근무: ${getShiftDisplayName(targetLog.shift)}`,
        `보직: ${targetLog.role || "-"}`,
        `작성자: ${targetLog.author || "-"}`
      ].join("\n")
    );

  if (!shouldApprove) {
    return;
  }

  targetLog.status =
    "결재완료";

  targetLog.approvedAt =
    new Date().toISOString();

  /*
    현재는 로그인 권한 연결 전이므로
    화면의 로그인 사용자 이름을 결재자로 저장한다.
  */
  targetLog.approvedBy =
    String(
      document.getElementById(
        "headerUserName"
      )?.textContent ||
      ""
    ).trim();

  targetLog.updatedAt =
    new Date().toISOString();

  persistLogs();

  renderLogTable();
  updateShiftMemberCardStates();

  /*
    변경된 상태를 상세화면에 즉시 다시 표시한다.
  */
  openLogDetail(
    targetLog
  );

  showToast(
    "업무일지 결재가 완료되었습니다."
  );
}

function openLogDetail(log) {
  if (
    !log ||
    !elements.logDetailContent
  ) {
    showToast(
      "업무일지 정보를 확인할 수 없습니다."
    );

    return;
  }

  appState.currentDetailLogId =
    log.id;


  /* =====================================================
    기본 정보
  ====================================================== */

  const dateText =
    String(
      log.date || "-"
    ).trim();

  const shiftText =
    getShiftDisplayName(
      log.shift
    );

  const teamText =
    normalizeTeamName(
      log.team || "-"
    );

  const roleText =
    String(
      log.role || "-"
    ).trim();

  const authorText =
    String(
      log.author || "-"
    ).trim();

  const statusText =
    String(
      log.status || "-"
    ).trim();

  const isSubstitute =
    log.isSubstitute === true;

  const normalizedRole =
    normalizeMemberLogRole(
      log.role
    );

  const isLeaderLog =
    normalizedRole ===
    "파트장";


  /* =====================================================
    운전현황
  ====================================================== */

const operationStatusText =
  String(
    log.operationStatus || ""
  )
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .filter(Boolean)
    .join("\n");

  const operationStatusHtml =
    operationStatusText
      ? `
        <div class="detail-document-text">
          ${escapeHtml(
            operationStatusText
          )}
        </div>
      `
      : `
        <div class="detail-document-empty">
          등록된 운전현황이 없습니다.
        </div>
      `;


  /* =====================================================
    전체 작업 내역
  ====================================================== */

  const entries =
    Array.isArray(
      log.entries
    )
      ? log.entries
      : [];


  /* =====================================================
    TM 발행 내역
  ====================================================== */

  const tmEntries =
    sortDetailEntriesByTime(
      entries.filter(
        (entry) => {
          return (
            String(
              entry.category || ""
            ).trim() ===
            "TM 발행"
          );
        }
      )
    );

  const tmHtml =
    tmEntries.length
      ? tmEntries
          .map(
            (
              entry,
              index
            ) => {
              const contentText =
                String(
                  entry.content || "-"
                ).trim();

              const tagText =
                String(
                  entry.tag || ""
                )
                  .trim()
                  .toUpperCase();

              return `
                <div class="detail-document-line">

                  <span class="detail-document-number">
                    ${index + 1}.
                  </span>

                  <span class="detail-document-line__content">

                    <span class="detail-document-content-text">
                      ${escapeHtml(
                        contentText
                      )}
                    </span>

                    ${
                      tagText
                        ? `
                          <button
                            type="button"
                            class="detail-document-tag"
                            data-detail-tag="${escapeHtml(
                              tagText
                            )}"
                            title="Facility Navigator에서 설비 보기"
                          >
                            [${escapeHtml(
                              tagText
                            )}]
                          </button>
                        `
                        : ""
                    }

                  </span>

                </div>
              `;
            }
          )
          .join("")
      : `
        <div class="detail-document-empty">
          등록된 TM 발행 내역이 없습니다.
        </div>
      `;


  /* =====================================================
    TM 발행을 제외한 업무 내역
  ====================================================== */

  const ordinaryEntries =
    entries.filter(
      (entry) => {
        return (
          String(
            entry.category || ""
          ).trim() !==
          "TM 발행"
        );
      }
    );


  /* =====================================================
    보직별 업무 묶기
  ====================================================== */

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

  ordinaryEntries.forEach(
    (entry) => {
      const sourceRole =
        normalizeMemberLogRole(
          entry.importedFromRole ||
          log.role ||
          "파트장"
        );

      if (
        !groupedEntries[
          sourceRole
        ]
      ) {
        groupedEntries[
          sourceRole
        ] = [];
      }

      groupedEntries[
        sourceRole
      ].push(
        entry
      );
    }
  );

  const orderedRoles = [
    ...roleOrder.filter(
      (role) => {
        return Boolean(
          groupedEntries[
            role
          ]?.length
        );
      }
    ),

    ...Object.keys(
      groupedEntries
    ).filter(
      (role) => {
        return (
          !roleOrder.includes(
            role
          )
        );
      }
    )
  ];


  /* =====================================================
    업무 항목 한 줄 생성
  ====================================================== */

  const createDetailEntryLineHtml = (
    entry,
    index
  ) => {
    const timeText =
      String(
        entry.time || ""
      ).trim();

    const categoryText =
      String(
        entry.category ||
        "인계사항"
      ).trim();

    const contentText =
      String(
        entry.content || "-"
      ).trim();

    const tagText =
      String(
        entry.tag || ""
      )
        .trim()
        .toUpperCase();

    return `
      <div class="detail-document-line">

        <span class="detail-document-number">
          ${index + 1}.
        </span>

        <span class="detail-document-line__content">

          ${
            timeText
              ? `
                <strong class="detail-document-time">
                  ${escapeHtml(
                    timeText
                  )}
                </strong>
              `
              : ""
          }

          ${
            categoryText !==
            "인계사항"
              ? `
                <span class="detail-document-category">
                  ${escapeHtml(
                    categoryText
                  )}
                </span>
              `
              : ""
          }

          <span class="detail-document-content-text">
            ${escapeHtml(
              contentText
            )}
          </span>

          ${
            tagText
              ? `
                <button
                  type="button"
                  class="detail-document-tag"
                  data-detail-tag="${escapeHtml(
                    tagText
                  )}"
                  title="Facility Navigator에서 설비 보기"
                >
                  [${escapeHtml(
                    tagText
                  )}]
                </button>
              `
              : ""
          }

        </span>

      </div>
    `;
  };


  /* =====================================================
    업무 내역 HTML
  ====================================================== */

  let ordinaryEntriesHtml = "";

  if (
    !ordinaryEntries.length
  ) {
    ordinaryEntriesHtml = `
      <div class="detail-document-empty">
        등록된 인계 및 작업 내역이 없습니다.
      </div>
    `;
  } else if (
    isLeaderLog
  ) {
    ordinaryEntriesHtml =
      orderedRoles
        .map(
          (
            role,
            roleIndex
          ) => {
            const roleEntries =
              sortDetailEntriesByTime(
                groupedEntries[
                  role
                ]
              );

            return `
              <section
                class="
                  detail-role-section
                  ${
                    roleIndex === 0
                      ? "is-first-role"
                      : ""
                  }
                "
              >

                <div class="detail-role-section__heading">

                  <span
                    class="
                      detail-role-badge
                      ${getLogEntrySourceClass(
                        role
                      )}
                    "
                  >
                    ${escapeHtml(
                      role
                    )}
                  </span>

                  <strong>
                    ${escapeHtml(
                      role
                    )} 업무일지
                  </strong>

                  <span class="detail-role-section__count">
                    ${roleEntries.length}건
                  </span>

                </div>

                <div class="detail-role-section__entries">

                  ${roleEntries
                    .map(
                      (
                        entry,
                        index
                      ) => {
                        return createDetailEntryLineHtml(
                          entry,
                          index
                        );
                      }
                    )
                    .join("")}

                </div>

              </section>
            `;
          }
        )
        .join("");
  } else {
    const sortedEntries =
      sortDetailEntriesByTime(
        ordinaryEntries
      );

    ordinaryEntriesHtml =
      sortedEntries
        .map(
          (
            entry,
            index
          ) => {
            return createDetailEntryLineHtml(
              entry,
              index
            );
          }
        )
        .join("");
  }


  /* =====================================================
    비고
  ====================================================== */

  const noteText =
    String(
      log.note || ""
    ).trim();

  const noteHtml =
    noteText
      ? `
        <div class="detail-document-text">
          ${escapeHtml(
            noteText
          )}
        </div>
      `
      : `
        <div class="detail-document-empty">
          등록된 비고가 없습니다.
        </div>
      `;


  /* =====================================================
    첨부파일
  ====================================================== */

  const attachments =
    Array.isArray(
      log.attachments
    )
      ? log.attachments.filter(
          Boolean
        )
      : [];

  const attachmentHtml =
    attachments.length
      ? `
        <div class="detail-document-attachments">

          ${attachments
            .map(
              (
                fileName,
                index
              ) => {
                return `
                  <div class="detail-document-attachment">

                    <span class="detail-document-attachment__icon">
                      📎
                    </span>

                    <span class="detail-document-attachment__name">
                      ${escapeHtml(
                        fileName
                      )}
                    </span>

                    <span class="detail-document-attachment__number">
                      ${index + 1}
                    </span>

                  </div>
                `;
              }
            )
            .join("")}

        </div>
      `
      : `
        <div class="detail-document-empty">
          첨부파일이 없습니다.
        </div>
      `;


  /* =====================================================
    상세보기 전체 출력
  ====================================================== */

  elements.logDetailContent.innerHTML = `
    <div class="detail-document">


      <!-- 기본 정보 -->
      <section class="detail-document-summary">

        <div class="detail-document-summary__header">

          <div>
            <span class="detail-document-eyebrow">
              SHIFT LOG DETAIL
            </span>

            <h2>
              ${escapeHtml(
                dateText
              )} 업무일지
            </h2>
          </div>

          <span
            class="
              status-badge
              ${getStatusClass(
                statusText
              )}
            "
          >
            ${escapeHtml(
              statusText
            )}
          </span>

        </div>


        <div class="detail-document-summary__grid">

          <div class="detail-document-summary__item">
            <span>작성일</span>

            <strong>
              ${escapeHtml(
                dateText
              )}
            </strong>
          </div>


          <div class="detail-document-summary__item">
            <span>근무</span>

            <strong>
              ${escapeHtml(
                shiftText
              )}
            </strong>
          </div>


          <div class="detail-document-summary__item">
            <span>근무파트</span>

            <strong>
              ${escapeHtml(
                teamText
              )}
            </strong>
          </div>


          <div class="detail-document-summary__item">
            <span>보직</span>

            <strong>
              ${escapeHtml(
                roleText
              )}
            </strong>
          </div>


          <div class="detail-document-summary__item">
            <span>작성자</span>

            <strong class="detail-document-author">

              ${escapeHtml(
                authorText
              )}

              ${
                isSubstitute
                  ? `
                    <span class="substitute-work-badge">
                      대근
                    </span>
                  `
                  : ""
              }

            </strong>
          </div>


          <div class="detail-document-summary__item">
            <span>등록 내역</span>

            <strong>
              총 ${entries.length}건
            </strong>
          </div>

        </div>

      </section>


      <!-- 운전현황 -->
      <section class="detail-document-section">

        <div class="detail-document-section__header">

          <div>
            <span class="detail-document-eyebrow">
              OPERATION STATUS
            </span>

            <h3>운전현황</h3>
          </div>

        </div>

        <div class="detail-document-section__body">
          ${operationStatusHtml}
        </div>

      </section>


      <!-- TM 발행 내역 -->
      <section class="detail-document-section">

        <div class="detail-document-section__header">

          <div>
            <span class="detail-document-eyebrow">
              TM ISSUE
            </span>

            <h3>TM 발행 내역</h3>
          </div>

          <span class="detail-document-count">
            ${tmEntries.length}건
          </span>

        </div>

        <div class="detail-document-section__body">
          ${tmHtml}
        </div>

      </section>


      <!-- 인계 및 작업 내역 -->
      <section class="detail-document-section">

        <div class="detail-document-section__header">

          <div>
            <span class="detail-document-eyebrow">
              HANDOVER
            </span>

            <h3>
              ${
                isLeaderLog
                  ? "팀원 업무일지"
                  : "인계 및 작업 내역"
              }
            </h3>
          </div>

          <span class="detail-document-count">
            ${ordinaryEntries.length}건
          </span>

        </div>

        <div class="detail-document-section__body">
          ${ordinaryEntriesHtml}
        </div>

      </section>


      <!-- 비고 및 첨부 -->
      <div class="detail-document-bottom-grid">

        <section class="detail-document-section">

          <div class="detail-document-section__header">

            <div>
              <span class="detail-document-eyebrow">
                NOTE
              </span>

              <h3>비고</h3>
            </div>

          </div>

          <div class="detail-document-section__body">
            ${noteHtml}
          </div>

        </section>


        <section class="detail-document-section">

          <div class="detail-document-section__header">

            <div>
              <span class="detail-document-eyebrow">
                ATTACHMENT
              </span>

              <h3>첨부파일</h3>
            </div>

            <span class="detail-document-count">
              ${attachments.length}개
            </span>

          </div>

          <div class="detail-document-section__body">
            ${attachmentHtml}
          </div>

        </section>

      </div>


    </div>
  `;


  /* =====================================================
    TAG 버튼 이벤트
  ====================================================== */

  elements.logDetailContent
    .querySelectorAll(
      "[data-detail-tag]"
    )
    .forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            openFacilityNavigator(
              button.dataset
                .detailTag
            );
          }
        );
      }
    );


/*
  작성완료 상태에서만
  결재확인 버튼을 표시한다.
*/
if (
  elements.approveFromDetailButton
) {
  const canApprove =
    statusText ===
    "작성완료";

  elements
    .approveFromDetailButton
    .hidden =
    !canApprove;
}


/*
  결재완료된 업무일지는
  수정하지 못하도록 수정 버튼을 숨긴다.
*/
if (
  elements.editFromDetailButton
) {
  elements
    .editFromDetailButton
    .hidden =
    statusText ===
    "결재완료";
}


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
      team: "3파트",
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
      team: "3파트",
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
      team: "3파트",
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
