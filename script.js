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

    adminButton:
      document.getElementById(
        "adminButton"
      ),

    logoutButton:
      document.getElementById(
        "logoutButton"
      ),

    employeeManagementModal:
      document.getElementById(
        "employeeManagementModal"
      ),

    closeEmployeeManagementButton:
      document.getElementById(
        "closeEmployeeManagementButton"
      ),

    closeEmployeeManagementFooterButton:
      document.getElementById(
        "closeEmployeeManagementFooterButton"
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
    headerUserName,
    adminButton
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
      user?.employeeNo ||
      "사용자";
  }


  /*
    최고관리자만 관리자 버튼 표시

    허용 권한:
    super_admin

    과거 계정 호환:
    superadmin
  */
  const userRole =
    String(
      user?.role ||
      ""
    )
      .trim()
      .toLowerCase();


  const isSuperAdmin =
    userRole ===
      "super_admin" ||
    userRole ===
      "superadmin";


  if (adminButton) {
    adminButton.hidden =
      !isSuperAdmin;

    adminButton.disabled =
      !isSuperAdmin;
  }
}

function openLoginScreen() {
  const {
    loginScreen,
    appShell,
    loginEmployeeId,
    loginPassword,
    adminButton,
    employeeManagementModal
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


  if (adminButton) {
    adminButton.hidden =
      true;

    adminButton.disabled =
      true;
  }


  if (employeeManagementModal) {
    employeeManagementModal
      .classList
      .remove(
        "is-open"
      );

    employeeManagementModal
      .setAttribute(
        "aria-hidden",
        "true"
      );
  }


  document.body.classList.remove(
    "modal-open"
  );


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
    !result.ok
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

/* =========================================================
  최고관리자 권한 확인
========================================================= */

function isCurrentUserSuperAdmin() {
  const currentUser =
    loadCurrentUser();


  const currentRole =
    String(
      currentUser?.role ||
      ""
    )
      .trim()
      .toLowerCase();


  return (
    currentRole ===
      "super_admin" ||
    currentRole ===
      "superadmin"
  );
}

/* =========================================================
  가입 완료 직원 목록 원본
========================================================= */

let employeeManagementUsers = [];


/* =========================================================
  HTML 특수문자 처리
========================================================= */

function escapeEmployeeManagementHtml(
  value
) {
  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* =========================================================
  직원 권한 표시 이름
========================================================= */

function getEmployeeManagementRoleLabel(
  role
) {
  const normalizedRole =
    String(
      role || ""
    )
      .trim()
      .toLowerCase();

  if (
    normalizedRole ===
      "super_admin" ||
    normalizedRole ===
      "superadmin"
  ) {
    return "최고관리자";
  }

  if (
    normalizedRole ===
      "admin" ||
    normalizedRole ===
      "leader"
  ) {
    return "파트장";
  }

  return "일반";
}


/* =========================================================
  가입 완료 직원 목록 화면 출력
========================================================= */

function renderEmployeeManagementUsers(
  users
) {
  const list =
    document.getElementById(
      "employeeManagementList"
    );

  const count =
    document.getElementById(
      "employeeManagementCount"
    );

  if (!list) {
    console.error(
      "가입 완료 직원 목록 영역을 찾을 수 없습니다."
    );

    return;
  }

  const safeUsers =
    Array.isArray(
      users
    )
      ? users
      : [];

  if (count) {
    count.textContent =
      `${safeUsers.length}명`;
  }

  if (
    safeUsers.length === 0
  ) {
    list.innerHTML = `
      <div class="employee-management-empty">
        가입 완료 직원이 없습니다.
      </div>
    `;

    return;
  }

  list.innerHTML =
    safeUsers
      .map(
        user => {
          const employeeNo =
            escapeEmployeeManagementHtml(
              user.employeeNo ||
              user.employee_no ||
              ""
            );

          const name =
            escapeEmployeeManagementHtml(
              user.name ||
              ""
            );

          const role =
            String(
              user.role ||
              "user"
            )
              .trim()
              .toLowerCase();

          const roleLabel =
            escapeEmployeeManagementHtml(
              getEmployeeManagementRoleLabel(
                role
              )
            );

          const isActive =
            user.isActive === true ||
            Number(
              user.isActive ??
              user.is_active
            ) === 1;

          return `
            <article
              class="employee-management-item"
              data-employee-no="${employeeNo}"
            >

              <div class="employee-management-item__person">

                <strong>
                  ${name}
                </strong>

                <span>
                  ${employeeNo}
                </span>

              </div>


              <span
                class="
                  employee-management-role-badge
                  is-${escapeEmployeeManagementHtml(
                    role
                  )}
                "
              >
                ${roleLabel}
              </span>


              <span
                class="
                  employee-management-status-badge
                  ${
                    isActive
                      ? "is-active"
                      : "is-inactive"
                  }
                "
              >
                ${
                  isActive
                    ? "사용중"
                    : "중지"
                }
              </span>

            </article>
          `;
        }
      )
      .join("");
}


/* =========================================================
  가입 완료 직원 검색
========================================================= */

function filterEmployeeManagementUsers() {
  const searchInput =
    document.getElementById(
      "employeeManagementSearch"
    );

  const keyword =
    String(
      searchInput?.value ||
      ""
    )
      .trim()
      .replace(
        /\s+/g,
        ""
      )
      .toLowerCase();

  if (!keyword) {
    renderEmployeeManagementUsers(
      employeeManagementUsers
    );

    return;
  }

  const filteredUsers =
    employeeManagementUsers.filter(
      user => {
        const employeeNo =
          String(
            user.employeeNo ||
            user.employee_no ||
            ""
          )
            .replace(
              /\s+/g,
              ""
            )
            .toLowerCase();

        const name =
          String(
            user.name ||
            ""
          )
            .replace(
              /\s+/g,
              ""
            )
            .toLowerCase();

        return (
          employeeNo.includes(
            keyword
          ) ||
          name.includes(
            keyword
          )
        );
      }
    );

  renderEmployeeManagementUsers(
    filteredUsers
  );
}


/* =========================================================
  가입 완료 직원 목록 불러오기
========================================================= */

async function loadEmployeeManagement() {
  const list =
    document.getElementById(
      "employeeManagementList"
    );

  const count =
    document.getElementById(
      "employeeManagementCount"
    );

  if (!list) {
    return;
  }

  list.innerHTML = `
    <div class="employee-management-empty">
      가입 완료 직원 목록을 불러오는 중입니다.
    </div>
  `;

  if (count) {
    count.textContent =
      "0명";
  }

  try {
    const response =
      await fetch(
        "/api/employees?type=users",
        {
          method:
            "GET",

          headers: {
            Accept:
              "application/json"
          },

          cache:
            "no-store"
        }
      );

    const responseText =
      await response.text();

    let result = {};

    if (
      responseText.trim()
    ) {
      try {
        result =
          JSON.parse(
            responseText
          );

      } catch {
        throw new Error(
          "가입 완료 직원 서버 응답 형식이 올바르지 않습니다."
        );
      }
    }

    if (
      !response.ok ||
      result.ok === false
    ) {
      throw new Error(
        result.message ||
        result.error ||
        `가입 완료 직원 조회 실패 (HTTP ${response.status})`
      );
    }

    const approvedUsers =
      Array.isArray(
        result.approvedUsers
      )
        ? result.approvedUsers
        : [];

    employeeManagementUsers =
      approvedUsers.map(
        user => {
          return {
            employeeNo:
              String(
                user.employeeNo ||
                user.employee_no ||
                ""
              ),

            name:
              String(
                user.name ||
                ""
              ),

            role:
              String(
                user.role ||
                "user"
              ),

            isActive:
              Number(
                user.isActive ??
                user.is_active
              ) === 1,

            createdAt:
              user.createdAt ||
              user.created_at ||
              ""
          };
        }
      );

    filterEmployeeManagementUsers();

    console.log(
      `가입 완료 직원 ${employeeManagementUsers.length}명을 불러왔습니다.`
    );

  } catch (error) {
    console.error(
      "가입 완료 직원 조회 오류:",
      error
    );

    employeeManagementUsers =
      [];

    list.innerHTML = `
      <div class="employee-management-empty">
        ${escapeEmployeeManagementHtml(
          error.message ||
          "가입 완료 직원 목록을 불러오지 못했습니다."
        )}
      </div>
    `;

    if (count) {
      count.textContent =
        "0명";
    }
  }
}

/* =========================================================
  직원관리 모달 열기
========================================================= */

async function openEmployeeManagementModal() {
  const {
    employeeManagementModal
  } =
    getLoginElements();

  if (
    !isCurrentUserSuperAdmin()
  ) {
    showToast(
      "최고관리자만 사용할 수 있습니다."
    );

    return;
  }

  if (
    !employeeManagementModal
  ) {
    console.error(
      "직원관리 모달을 찾을 수 없습니다."
    );

    return;
  }

  employeeManagementModal
    .classList
    .add(
      "is-open"
    );

  employeeManagementModal
    .setAttribute(
      "aria-hidden",
      "false"
    );

  document.body.classList.add(
    "modal-open"
  );

  /*
    모달을 열 때마다 최신 가입 완료 직원 조회
  */
  await loadEmployeeManagement();
}


/* =========================================================
  직원관리 모달 닫기
========================================================= */

function closeEmployeeManagementModal() {
  const {
    employeeManagementModal
  } =
    getLoginElements();


  if (
    !employeeManagementModal
  ) {
    return;
  }


  employeeManagementModal
    .classList
    .remove(
      "is-open"
    );


  employeeManagementModal
    .setAttribute(
      "aria-hidden",
      "true"
    );


  document.body.classList.remove(
    "modal-open"
  );
}


/* =========================================================
  로그인 및 관리자 기능 초기화
========================================================= */

function initializeShiftLogLogin() {
  const {
  loginForm,
  logoutButton,
  adminButton,
  employeeManagementModal,
  closeEmployeeManagementButton,
  closeEmployeeManagementFooterButton
  } =
  getLoginElements();

  const refreshEmployeeManagementButton =
  document.getElementById(
    "refreshEmployeeManagementButton"
  );

  const employeeManagementSearch =
  document.getElementById(
    "employeeManagementSearch"
  );




  /*
    로그인 폼
  */
  loginForm?.addEventListener(
    "submit",
    handleShiftLogLogin
  );


  /*
    로그아웃
  */
  logoutButton?.addEventListener(
    "click",
    handleShiftLogLogout
  );


  /*
    최고관리자 직원관리 열기
  */
  adminButton?.addEventListener(
    "click",
    openEmployeeManagementModal
  );


  /*
    직원관리 상단 닫기
  */
  closeEmployeeManagementButton
    ?.addEventListener(
      "click",
      closeEmployeeManagementModal
    );


  /*
    직원관리 하단 닫기
  */
  closeEmployeeManagementFooterButton
    ?.addEventListener(
      "click",
      closeEmployeeManagementModal
    );

refreshEmployeeManagementButton?.addEventListener(
  "click",
  loadEmployeeManagement
);

employeeManagementSearch?.addEventListener(
  "input",
  filterEmployeeManagementUsers
);

  /*
    모달 바깥 배경을 누르면 닫기
  */
  employeeManagementModal
    ?.addEventListener(
      "click",
      (
        event
      ) => {
        if (
          event.target ===
          employeeManagementModal
        ) {
          closeEmployeeManagementModal();
        }
      }
    );


  /*
    저장된 로그인 사용자 복원
  */
  const currentUser =
    loadCurrentUser();


  if (
    currentUser
  ) {
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
  조회 기본 기간 설정

  종료일:
  오늘

  시작일:
  오늘 기준 7일 전

  예:
  오늘이 2026-07-23이면
  시작일 2026-07-16
  종료일 2026-07-23
========================================================= */

function setDefaultSearchDateRange() {
  const searchStartDate =
    document.getElementById(
      "searchStartDate"
    );

  const searchEndDate =
    document.getElementById(
      "searchEndDate"
    );


  if (
    !searchStartDate ||
    !searchEndDate
  ) {
    return;
  }


  const today =
    new Date();


  const sevenDaysAgo =
    new Date(today);


  sevenDaysAgo.setDate(
    sevenDaysAgo.getDate() - 7
  );


  searchStartDate.value =
    formatInputDate(
      sevenDaysAgo
    );


  searchEndDate.value =
    formatInputDate(
      today
    );
}

/* =========================================================
  초기 실행
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    /*
      모든 HTML 요소를 먼저 연결한다.
    */
    cacheElements();

    cacheMemberLogImportElements();

    /*
  조회 화면 기본 기간:
  오늘부터 이전 7일까지
*/
    setDefaultSearchDateRange();

    /*
      근무자 카드 이벤트
    */
    bindShiftMemberCards();


    /*
      저장된 신규 업무일지 및 근무 상태
    */
    loadLogs();

    loadMemberWorkStatuses();


    /*
      공통 이벤트
    */
    bindEvents();

    bindMemberLogImportEvents();

    bindLogEntryEditModeEvents();


    /*
      보직별 운전현황 이벤트

      상태 버튼 및 날짜·근무·보직 변경 이벤트를
      여기에서 연결한다.
    */
    bindOperationStatusEvents();


    /*
      최초 운전현황 표시

      현재 logRole 값을 기준으로
      해당 보직의 운전현황을 불러온다.
    */
    refreshOperationStatusForCurrentRole();


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
      최초에는 인수인계사항 편집 모드를 끈다.
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
  보직별 현재 운전현황
===================================================== */

operationStatusSection:
  document.getElementById(
    "operationStatusSection"
  ),

operationStatus:
  document.getElementById(
    "operationStatus"
  ),

operationStatusSnapshot:
  document.getElementById(
    "operationStatusSnapshot"
  ),

operationStatusRole:
  document.getElementById(
    "operationStatusRole"
  ),

operationStatusRoleTitle:
  document.getElementById(
    "operationStatusRoleTitle"
  ),

operationStatusEditorTitle:
  document.getElementById(
    "operationStatusEditorTitle"
  ),

operationStatusEditorTime:
  document.getElementById(
    "operationStatusEditorTime"
  ),

operationStatusCurrentCard:
  document.getElementById(
    "operationStatusCurrentCard"
  ),

/*
  일반 보직 표시 전체 영역
*/
operationStatusSingleView:
  document.getElementById(
    "operationStatusSingleView"
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

/*
  파트장 전용 간단 표시 영역
*/
leaderOperationStatusList:
  document.getElementById(
    "leaderOperationStatusList"
  ),

operationStatusEditor:
  document.getElementById(
    "operationStatusEditor"
  ),

operationStatusType:
  document.getElementById(
    "operationStatusType"
  ),

operationStatusTypeButtons: [
  ...document.querySelectorAll(
    "[data-operation-status-type]"
  )
],

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
  조회 전용 과거 업무일지 1일 불러오기

  조회 화면에서 지정한 날짜의
  D/S와 N/S 기존 업무일지를 모두 가져온다.

  기존 현황 화면의 appState.logs는 직접 변경하지 않고
  조회용 배열만 반환한다.
========================================================= */

async function loadLegacyLogsForSearchDate(
  searchDate
) {
  const normalizedDate =
    String(
      searchDate || ""
    ).trim();


  if (!normalizedDate) {
    return [];
  }


  const legacyDate =
    normalizedDate.replace(
      /-/g,
      ""
    );


  const shiftDefinitions = [
    {
      legacyShift:
        "DAY",

      currentShift:
        "DS"
    },

    {
      legacyShift:
        "NIGHT",

      currentShift:
        "NS"
    }
  ];


  const requestResults =
    await Promise.all(
      shiftDefinitions.map(
        async (
          shiftDefinition
        ) => {
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
            shiftDefinition
              .legacyShift
          );


          const response =
            await fetch(
              requestUrl.toString(),
              {
                method:
                  "GET",

                headers: {
                  Accept:
                    "application/json"
                },

                cache:
                  "no-store"
              }
            );


          let result = {};


          try {
            result =
              await response.json();
          } catch (error) {
            throw new Error(
              `${normalizedDate} 과거 업무일지 응답을 읽을 수 없습니다.`
            );
          }


          if (
            !response.ok ||
            !result.success
          ) {
            throw new Error(
              result.message ||
              `${normalizedDate} ${shiftDefinition.legacyShift} 업무일지를 불러오지 못했습니다.`
            );
          }


          return {
            currentShift:
              shiftDefinition
                .currentShift,

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


  const convertedLogs = [];


  requestResults.forEach(
    (
      requestResult
    ) => {
      const convertedShiftLogs =
        requestResult.items
          .map(
            (
              legacyItem,
              itemIndex
            ) => {
              return convertLegacyDiaryToLog(
                legacyItem,
                itemIndex,
                normalizedDate,
                requestResult.currentShift
              );
            }
          )
          .filter(Boolean);


      /*
        2026년 7월 21일까지의 과거 데이터는
        기존 파트장 취합 구조를 동일하게 적용한다.
      */
      if (
        normalizedDate <=
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


  return convertedLogs;
}

/* =========================================================
  시작일 ~ 종료일 날짜 배열 생성

  예:
  2026-07-20 ~ 2026-07-22

  결과:
  [
    "2026-07-20",
    "2026-07-21",
    "2026-07-22"
  ]
========================================================= */

function createSearchDateRange(
  startDate,
  endDate
) {
  const normalizedStartDate =
    String(
      startDate || ""
    ).trim();


  const normalizedEndDate =
    String(
      endDate || ""
    ).trim();


  if (
    !normalizedStartDate ||
    !normalizedEndDate
  ) {
    return [];
  }


  const start =
    new Date(
      `${normalizedStartDate}T00:00:00`
    );


  const end =
    new Date(
      `${normalizedEndDate}T00:00:00`
    );


  if (
    Number.isNaN(
      start.getTime()
    ) ||
    Number.isNaN(
      end.getTime()
    ) ||
    start > end
  ) {
    return [];
  }


  const dateList = [];

  const currentDate =
    new Date(start);


  while (
    currentDate <= end
  ) {
    dateList.push(
      formatInputDate(
        currentDate
      )
    );


    currentDate.setDate(
      currentDate.getDate() + 1
    );
  }


  return dateList;
}


/* =========================================================
  조회 기간 전체의 과거 업무일지 불러오기

  각 날짜마다:
  - D/S
  - N/S

  과거 업무일지를 불러온 뒤
  하나의 배열로 합쳐서 반환한다.
========================================================= */

async function loadLegacyLogsForSearchRange(
  startDate,
  endDate
) {
  const searchDates =
    createSearchDateRange(
      startDate,
      endDate
    );


  if (!searchDates.length) {
    return [];
  }


  /*
    한 번에 너무 많은 서버 요청을 보내지 않도록
    날짜별로 순서대로 불러온다.

    날짜 1개당:
    DAY 1회
    NIGHT 1회
  */
  const allLegacyLogs = [];


  for (
    const searchDate
    of searchDates
  ) {
    try {
      const dateLogs =
        await loadLegacyLogsForSearchDate(
          searchDate
        );


      allLegacyLogs.push(
        ...dateLogs
      );

    } catch (error) {
      console.error(
        `${searchDate} 조회용 과거 업무일지 불러오기 실패:`,
        error
      );


      /*
        특정 날짜를 불러오지 못하더라도
        나머지 날짜 조회는 계속 진행한다.
      */
    }
  }


  return allLegacyLogs;
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

/* =========================================================
  기존 업무일지 내용 줄 분석

  신규 업무 입력과 동일하게 지원:

  09:06, 14:19, 16:15 내용
  08:37~09:46 내용
  0837~0946 내용
========================================================= */

function parseLegacyDiaryContentLines(
  rawContent
) {
  const sourceLines =
    String(
      rawContent || ""
    )
      .replace(
        /\r\n/g,
        "\n"
      )
      .replace(
        /\r/g,
        "\n"
      )
      .split(
        "\n"
      );


  const parsedEntries = [];


  sourceLines.forEach(
    (sourceLine) => {
      let line =
        String(
          sourceLine || ""
        ).trim();


      if (!line) {
        return;
      }


      /*
        사용자가 직접 입력한 줄 번호 제거

        1. 내용
        2) 내용
        3 - 내용
        ④ 내용
      */
      line =
        line.replace(
          /^(?:\d+\s*[.)\-:]\s*|[①②③④⑤⑥⑦⑧⑨⑩]\s*)/,
          ""
        )
        .trim();


      if (!line) {
        return;
      }


      /*
        시간 없는 보충 설명인지 먼저 확인한다.

        - 현장 확인 후 재기동
        → 바로 위 업무 내용에 이어 붙임
      */
      const isContinuationLine =
        /^[-–—·※▶▷→>]/.test(
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
        신규 업무 입력과 같은 공통 분석 함수 사용
      */
      const parsedTimeExpression =
        parseLeadingLogTimeExpression(
          line
        );


      /*
        시간과 실제 내용이 모두 있는 경우
      */
      if (
        parsedTimeExpression.timeText &&
        parsedTimeExpression.content
      ) {
        parsedEntries.push({
          time:
            parsedTimeExpression.timeText,

          content:
            parsedTimeExpression.content
        });


        return;
      }


      /*
        시간만 있고 내용이 없는 줄은
        독립 업무로 등록하지 않는다.
      */
      if (
        parsedTimeExpression.timeText &&
        !parsedTimeExpression.content
      ) {
        return;
      }


      /*
        시간 없는 일반 문장
      */
      parsedEntries.push({
        time: "",
        content:
          line
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


  importItems.forEach(
    (item) => {
      if (
        !item.button
      ) {
        return;
      }


      const normalizedRole =
        normalizeMemberLogRole(
          item.role
        );


      const memberLog =
        findMemberLogByRole(
          normalizedRole
        );


      item.button.classList.remove(
        "is-imported",
        "is-missing",
        "has-new-entries"
      );


      /*
        해당 보직 업무일지가 없는 경우
      */
      if (
        !memberLog
      ) {
        item.button.classList.add(
          "is-missing"
        );


        if (
          item.status
        ) {
          item.status.textContent =
            "작성된 업무일지 없음";
        }


        item.button.disabled =
          false;

        return;
      }


      /*
        개별 버튼은 모든 보직의 전체 업무를 대상으로 한다.
      */
      const syncStatus =
        getMemberLogSyncStatus(
          memberLog,
          normalizedRole,
          {
            mode:
              "individual"
          }
        );


      const author =
        String(
          memberLog.author ||
          normalizedRole
        ).trim();


      /*
        신규 내역이 생긴 경우
      */
      if (
        syncStatus.newEntryCount >
        0
      ) {
        item.button.classList.add(
          "has-new-entries"
        );


        if (
          item.status
        ) {
          item.status.textContent =
            `${author} · 신규 ${syncStatus.newEntryCount}건`;
        }


        item.button.disabled =
          false;

        return;
      }


      /*
        가져올 대상이 있고
        전부 가져온 경우
      */
      if (
        syncStatus.totalEntryCount >
          0 &&
        syncStatus.importedEntryCount ===
          syncStatus.totalEntryCount
      ) {
        item.button.classList.add(
          "is-imported"
        );


        if (
          item.status
        ) {
          item.status.textContent =
            `${author} · 동기화 완료`;
        }


        item.button.disabled =
          false;

        return;
      }


      /*
        작성된 항목이 없는 경우
      */
      if (
        syncStatus.totalEntryCount ===
        0
      ) {
        if (
          item.status
        ) {
          item.status.textContent =
            `${author} · 등록된 내역 없음`;
        }


        item.button.disabled =
          false;

        return;
      }


      /*
        아직 한 번도 가져오지 않은 경우
      */
      if (
        item.status
      ) {
        item.status.textContent =
          `${author} · 가져오기 가능 ${syncStatus.totalEntryCount}건`;
      }


      item.button.disabled =
        false;
    }
  );


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
  가져오기용 내용 정규화
========================================================= */

function normalizeMemberImportContent(
  content
) {
  return String(
    content || ""
  )
    .toLowerCase()
    .replace(
      /^\s*\d+\s*[.)\-:]\s*/,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .replace(
      /[()[\]{}<>.,!?'"`~:;_|/\\-]/g,
      ""
    )
    .trim();
}


/* =========================================================
  동일·유사 항목 판정

  90% 이상 유사하면 같은 업무로 판단한다.
========================================================= */

function isSameOrSimilarMemberEntry(
  firstEntry,
  secondEntry,
  threshold = 0.9
) {
  const firstCategory =
    String(
      firstEntry?.category ||
      ""
    ).trim();


  const secondCategory =
    String(
      secondEntry?.category ||
      ""
    ).trim();


  /*
    서로 구분이 다르면
    동일 항목으로 처리하지 않는다.
  */
  if (
    firstCategory !==
    secondCategory
  ) {
    return false;
  }


  const firstContent =
    normalizeMemberImportContent(
      firstEntry?.content
    );


  const secondContent =
    normalizeMemberImportContent(
      secondEntry?.content
    );


  if (
    !firstContent ||
    !secondContent
  ) {
    return false;
  }


  if (
    firstContent ===
    secondContent
  ) {
    return true;
  }


  const similarity =
    calculateLegacyContentSimilarity(
      firstEntry?.content,
      secondEntry?.content
    );


  return (
    similarity >=
    threshold
  );
}


/* =========================================================
  원본 항목이 이미 가져와졌는지 확인
========================================================= */

function hasImportedMemberSourceEntry(
  memberLog,
  role,
  entry,
  entryIndex
) {
  const sourceKey =
    createSourceEntryKey(
      memberLog,
      role,
      entry,
      entryIndex
    );


  return appState.editorEntries.some(
    (currentEntry) => {
      return (
        createImportedEntryUniqueKey(
          currentEntry
        ) ===
        sourceKey
      );
    }
  );
}


/* =========================================================
  가져오기용 항목 생성
========================================================= */

function createMemberImportedEntry(
  memberLog,
  role,
  entry,
  entryIndex
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );


  return {
    time:
      String(
        entry?.time ||
        ""
      ).trim(),

    category:
      String(
        entry?.category ||
        "인계사항"
      ).trim(),

    tag:
      String(
        entry?.tag ||
        ""
      )
        .trim()
        .toUpperCase(),

    content:
      String(
        entry?.content ||
        ""
      ).trim(),

    importedFromRole:
      normalizedRole,

    importedFromAuthor:
      String(
        memberLog?.author ||
        ""
      ).trim(),

    importedFromLogId:
      String(
        memberLog?.id ||
        ""
      ).trim(),

    importedFromEntryIndex:
      entryIndex
  };
}

function getImportableMemberEntries(
  memberLog,
  requestedRole,
  options = {}
) {
  const {
    mode =
      "individual"
  } = options;


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


  const mappedEntries =
    memberEntries.map(
      (
        entry,
        entryIndex
      ) => {
        return {
          entry,
          entryIndex
        };
      }
    );


  /*
    개별 버튼

    TGO, BCO1, BCO2,
    TO, BO1, BO2 모두
    해당 보직의 전체 업무를 가져온다.
  */
  if (
    mode ===
    "individual"
  ) {
    return mappedEntries;
  }


  /*
    일괄 취합

    TGO, BCO1, BCO2:
    전체 업무

    TO, BO1, BO2:
    TM 발행만
  */
  const fullImportRoles = [
    "TGO",
    "BCO1",
    "BCO2"
  ];


  if (
    fullImportRoles.includes(
      normalizedRole
    )
  ) {
    return mappedEntries;
  }


  return mappedEntries.filter(
    ({
      entry
    }) => {
      return (
        String(
          entry.category ||
          ""
        ).trim() ===
        "TM 발행"
      );
    }
  );
}


/* =========================================================
  보직별 가져오기 동기화 상태 계산
========================================================= */

function getMemberLogSyncStatus(
  memberLog,
  requestedRole,
  options = {}
) {
  const {
    mode =
      "individual"
  } = options;


  const normalizedRole =
    normalizeMemberLogRole(
      requestedRole
    );


  const importableItems =
    getImportableMemberEntries(
      memberLog,
      normalizedRole,
      {
        mode
      }
    );


  let importedEntryCount =
    0;

  let newEntryCount =
    0;


  importableItems.forEach(
    ({
      entry,
      entryIndex
    }) => {
      const isImportedBySource =
        hasImportedMemberSourceEntry(
          memberLog,
          normalizedRole,
          entry,
          entryIndex
        );


      /*
        원본 식별자가 없던 과거 데이터는
        내용 유사도까지 함께 확인한다.
      */
      const isImportedByContent =
        appState.editorEntries.some(
          (currentEntry) => {
            return (
              normalizeMemberLogRole(
                currentEntry
                  .importedFromRole
              ) ===
                normalizedRole &&
              isSameOrSimilarMemberEntry(
                currentEntry,
                entry,
                0.9
              )
            );
          }
        );


      if (
        isImportedBySource ||
        isImportedByContent
      ) {
        importedEntryCount +=
          1;

        return;
      }


      newEntryCount +=
        1;
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
  특정 팀원 업무일지의 기존 가져오기 항목 제거

  같은 원본 업무일지에서 가져온 항목을 먼저 제거한 뒤
  최신 원본을 다시 가져와 보직 오분류를 바로잡는다.

  파트장이 직접 입력한 항목과
  다른 보직에서 가져온 항목은 유지한다.
========================================================= */

function removeImportedEntriesForMemberLog(
  memberLog,
  requestedRole
) {
  const normalizedRole =
    normalizeMemberLogRole(
      requestedRole
    );


  const sourceLogId =
    String(
      memberLog?.id ||
      ""
    ).trim();


  const previousCount =
    appState.editorEntries.length;


  appState.editorEntries =
    appState.editorEntries.filter(
      (currentEntry) => {
        const currentSourceRole =
          normalizeMemberLogRole(
            currentEntry
              .importedFromRole
          );


        const currentSourceLogId =
          String(
            currentEntry
              .importedFromLogId ||
            ""
          ).trim();


        /*
          파트장이 직접 입력한 내역은 유지한다.
        */
        if (
          !currentSourceRole &&
          !currentSourceLogId
        ) {
          return true;
        }


        /*
          같은 원본 업무일지 ID에서 가져온 항목은 제거한다.

          기존에 importedFromRole이 잘못 저장됐더라도
          원본 ID 기준으로 찾아서 제거할 수 있다.
        */
        if (
          sourceLogId &&
          currentSourceLogId ===
            sourceLogId
        ) {
          return false;
        }


        /*
          과거 데이터 중 원본 업무일지 ID가 없었던 경우에는
          보직 정보로 제거한다.
        */
        if (
          !currentSourceLogId &&
          currentSourceRole ===
            normalizedRole
        ) {
          return false;
        }


        return true;
      }
    );


  return (
    previousCount -
    appState.editorEntries.length
  );
}

/* =========================================================
  보직별 업무일지 가져오기 토글

  첫 번째 클릭:
  해당 보직 업무일지 전체 가져오기

  동기화 완료 상태에서 다시 클릭:
  해당 보직에서 가져온 업무 전체 제거

  개별 버튼:
  TGO·BCO1·BCO2·TO·BO1·BO2 전체 업무

  일괄 취합:
  별도의 importAllMemberLogs() 규칙 사용
========================================================= */

function importMemberLogByRole(
  requestedRole,
  options = {}
) {
  const {
    silent = false,
    deferRender = false,
    mode = "individual"
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

      toggledOff:
        false,

      totalCount:
        0,

      addedCount:
        0,

      removedCount:
        0,

      skippedCount:
        0
    };
  }


  const importableItems =
    getImportableMemberEntries(
      memberLog,
      normalizedRole,
      {
        mode
      }
    );


  /*
    현재 해당 보직의 동기화 상태를
    기존 항목을 제거하기 전에 먼저 확인한다.
  */
  const syncStatus =
    getMemberLogSyncStatus(
      memberLog,
      normalizedRole,
      {
        mode
      }
    );


  /*
    개별 가져오기 버튼에서만
    다시 클릭하여 취소하는 기능을 사용한다.

    모든 원본 항목이 이미 가져와진 상태일 때만
    선택 해제로 판단한다.

    신규 항목이 생겼거나 일부만 가져온 상태에서는
    취소가 아니라 최신 상태로 동기화한다.
  */
  const shouldToggleOff =
    mode ===
      "individual" &&

    syncStatus.totalEntryCount >
      0 &&

    syncStatus.importedEntryCount ===
      syncStatus.totalEntryCount &&

    syncStatus.newEntryCount ===
      0;


  if (
    shouldToggleOff
  ) {
    const removedCount =
      removeImportedEntriesForMemberLog(
        memberLog,
        normalizedRole
      );


    if (
      !deferRender
    ) {
      sortImportedLogEntries();

      renderLogEntryTable();

      updateMemberLogImportStatus();
    }


    if (!silent) {
      showToast(
        `${normalizedRole} 업무일지 가져오기를 취소했습니다.`
      );
    }


    return {
      role:
        normalizedRole,

      found:
        true,

      toggledOff:
        true,

      totalCount:
        importableItems.length,

      addedCount:
        0,

      removedCount,

      skippedCount:
        0
    };
  }


  /*
    취소 상태가 아니면
    기존 해당 보직 내역을 제거한 뒤
    최신 원본 전체를 다시 가져온다.
  */
  const removedCount =
    removeImportedEntriesForMemberLog(
      memberLog,
      normalizedRole
    );


  if (
    !importableItems.length
  ) {
    if (
      !deferRender
    ) {
      sortImportedLogEntries();

      renderLogEntryTable();

      updateMemberLogImportStatus();
    }


    if (!silent) {
      showToast(
        `${normalizedRole} 업무일지에 가져올 내역이 없습니다.`
      );
    }


    return {
      role:
        normalizedRole,

      found:
        true,

      toggledOff:
        false,

      totalCount:
        0,

      addedCount:
        0,

      removedCount,

      skippedCount:
        0
    };
  }


  let addedCount =
    0;

  let skippedCount =
    0;


  importableItems.forEach(
    ({
      entry,
      entryIndex
    }) => {
      const importedEntry =
        createMemberImportedEntry(
          memberLog,
          normalizedRole,
          entry,
          entryIndex
        );


      /*
        현재 요청한 보직을 강제로 기록한다.

        원본 항목에 과거의 잘못된
        importedFromRole 값이 있어도 복사하지 않는다.
      */
      importedEntry.importedFromRole =
        normalizedRole;


      importedEntry.importedFromAuthor =
        String(
          memberLog.author ||
          ""
        ).trim();


      importedEntry.importedFromLogId =
        String(
          memberLog.id ||
          ""
        ).trim();


      importedEntry.importedFromEntryIndex =
        entryIndex;


      /*
        같은 보직 내부에서만 중복 검사한다.
      */
      const isDuplicate =
        appState.editorEntries.some(
          (currentEntry) => {
            const currentRole =
              normalizeMemberLogRole(
                currentEntry
                  .importedFromRole
              );


            if (
              currentRole !==
              normalizedRole
            ) {
              return false;
            }


            const currentSourceLogId =
              String(
                currentEntry
                  .importedFromLogId ||
                ""
              ).trim();


            const currentSourceIndex =
              Number(
                currentEntry
                  .importedFromEntryIndex
              );


            /*
              원본 일지 ID와 항목 번호가 같으면
              같은 항목이다.
            */
            if (
              currentSourceLogId &&
              currentSourceLogId ===
                importedEntry
                  .importedFromLogId &&

              Number.isInteger(
                currentSourceIndex
              ) &&

              currentSourceIndex ===
                Number(
                  entryIndex
                )
            ) {
              return true;
            }


            return isSameOrSimilarMemberEntry(
              currentEntry,
              importedEntry,
              0.9
            );
          }
        );


      if (
        isDuplicate
      ) {
        skippedCount +=
          1;

        return;
      }


      appState.editorEntries.push(
        importedEntry
      );


      addedCount +=
        1;
    }
  );


  /*
    혹시 일괄 취합 과정에서 호출된 경우
    TM 상·하위 보직 중복 규칙을 적용한다.
  */
  if (
    mode ===
    "all"
  ) {
    appState.editorEntries =
      filterLeaderTmEntriesByRoleHierarchy(
        appState.editorEntries
      );
  }


  if (
    !deferRender
  ) {
    sortImportedLogEntries();

    renderLogEntryTable();

    updateMemberLogImportStatus();
  }


  if (!silent) {
    if (
      addedCount >
      0
    ) {
      showToast(
        `${normalizedRole} 업무일지 ${addedCount}건을 가져왔습니다.`
      );

    } else {
      showToast(
        `${normalizedRole} 업무일지가 최신 상태입니다.`
      );
    }
  }


  return {
    role:
      normalizedRole,

    found:
      true,

    toggledOff:
      false,

    totalCount:
      importableItems.length,

    addedCount,

    removedCount,

    skippedCount
  };
}

/* =========================================================
  파트장 업무일지 일괄 취합 최종본

  기존 취합 내역을 깨끗하게 비운 후
  원본 업무일지 기준으로 다시 구성한다.

  일괄 취합 범위:
  - TGO  : 전체 업무
  - BCO1 : 전체 업무
  - BCO2 : 전체 업무
  - TO   : TM 발행만
  - BO1  : TM 발행만
  - BO2  : TM 발행만

  중요:
  기존 TM은 출처 보직이 없어도 모두 제거한다.
  그래야 과거 TM과 새 TM이 중복되지 않는다.
========================================================= */

function importAllMemberLogs() {
  const fullImportRoles = [
    "TGO",
    "BCO1",
    "BCO2"
  ];


  const tmOnlyRoles = [
    "TO",
    "BO1",
    "BO2"
  ];


  const allMemberRoles = [
    ...fullImportRoles,
    ...tmOnlyRoles
  ];


  /* =====================================================
    1. 파트장 직접 작성 일반 업무만 보존

    제거 대상:
    - 기존 TM 발행 내역 전체
    - TGO·BCO1·BCO2·TO·BO1·BO2 취합 내역
    - 출처 ID가 있는 과거 취합 내역

    유지 대상:
    - 파트장이 직접 입력한 TM 이외 일반 업무
  ====================================================== */

  const leaderOwnEntries =
    appState.editorEntries.filter(
      (entry) => {
        const category =
          String(
            entry.category || ""
          ).trim();


        const sourceRole =
          normalizeMemberLogRole(
            entry.importedFromRole
          );


        const sourceLogId =
          String(
            entry.importedFromLogId ||
            ""
          ).trim();


        /*
          기존 TM은 출처 보직과 상관없이
          전부 제거한 뒤 원본에서 다시 취합한다.
        */
        if (
          category ===
          "TM 발행"
        ) {
          return false;
        }


        /*
          팀원 보직에서 가져온 일반 업무는 제거한다.
        */
        if (
          allMemberRoles.includes(
            sourceRole
          )
        ) {
          return false;
        }


        /*
          원본 업무일지 ID가 존재하는 항목은
          과거 취합 항목일 가능성이 높으므로 제거한다.

          단, 파트장 직접 작성으로 명확히 저장된 것은 유지한다.
        */
        if (
          sourceLogId &&
          sourceRole !==
            "파트장"
        ) {
          return false;
        }


        /*
          출처가 없거나 파트장으로 표시된
          TM 이외 항목은 파트장 직접 업무로 유지한다.
        */
        return true;
      }
    );


  const rebuiltImportedEntries =
    [];


  let foundLogCount =
    0;

  let rawImportedCount =
    0;


  /* =====================================================
    2. 보직별 원본 업무일지 가져오기
  ====================================================== */

  const appendMemberLogEntries = (
    requestedRole,
    importMode
  ) => {
    const normalizedRole =
      normalizeMemberLogRole(
        requestedRole
      );


    const memberLog =
      findMemberLogByRole(
        normalizedRole
      );


    if (!memberLog) {
      return;
    }


    foundLogCount +=
      1;


    const memberEntries =
      Array.isArray(
        memberLog.entries
      )
        ? memberLog.entries
        : [];


    /*
      TGO·BCO1·BCO2는 전체 업무

      TO·BO1·BO2는 TM 발행만
    */
    const importableEntries =
      importMode ===
      "full"
        ? memberEntries
        : memberEntries.filter(
            (entry) => {
              return (
                String(
                  entry.category ||
                  ""
                ).trim() ===
                "TM 발행"
              );
            }
          );


    importableEntries.forEach(
      (
        sourceEntry,
        sourceIndex
      ) => {
        const category =
          String(
            sourceEntry.category ||
            "인계사항"
          ).trim();


        /*
          일괄 취합 범위 재확인

          하위 보직은 혹시 데이터가 잘못 들어 있어도
          TM 발행 이외 항목을 절대로 가져오지 않는다.
        */
        if (
          importMode ===
            "tm-only" &&
          category !==
            "TM 발행"
        ) {
          return;
        }


        const importedEntry =
          createMemberImportedEntry(
            memberLog,
            normalizedRole,
            sourceEntry,
            sourceIndex
          );


        importedEntry.importedFromRole =
          normalizedRole;


        importedEntry.importedFromAuthor =
          String(
            memberLog.author ||
            ""
          ).trim();


        importedEntry.importedFromLogId =
          String(
            memberLog.id ||
            ""
          ).trim();


        importedEntry.importedFromEntryIndex =
          sourceIndex;


        /*
          같은 보직 안에서만 중복 검사한다.

          다른 보직에 같은 업무 문장이 있어도
          서로 다른 업무이므로 유지한다.
        */
        const isDuplicate =
          rebuiltImportedEntries.some(
            (currentEntry) => {
              const currentRole =
                normalizeMemberLogRole(
                  currentEntry
                    .importedFromRole
                );


              if (
                currentRole !==
                normalizedRole
              ) {
                return false;
              }


              const currentSourceLogId =
                String(
                  currentEntry
                    .importedFromLogId ||
                  ""
                ).trim();


              const currentSourceIndex =
                Number(
                  currentEntry
                    .importedFromEntryIndex
                );


              if (
                currentSourceLogId &&
                currentSourceLogId ===
                  importedEntry
                    .importedFromLogId &&
                Number.isInteger(
                  currentSourceIndex
                ) &&
                currentSourceIndex ===
                  sourceIndex
              ) {
                return true;
              }


              return isSameOrSimilarMemberEntry(
                currentEntry,
                importedEntry,
                0.9
              );
            }
          );


        if (
          isDuplicate
        ) {
          return;
        }


        rebuiltImportedEntries.push(
          importedEntry
        );


        rawImportedCount +=
          1;
      }
    );
  };


  /* =====================================================
    3. 정해진 순서로 취합
  ====================================================== */

  fullImportRoles.forEach(
    (role) => {
      appendMemberLogEntries(
        role,
        "full"
      );
    }
  );


  tmOnlyRoles.forEach(
    (role) => {
      appendMemberLogEntries(
        role,
        "tm-only"
      );
    }
  );


  /* =====================================================
    4. TM 상·하위 보직 중복 제거

    TGO  > TO
    BCO1 > BO1
    BCO2 > BO2

    유사도 70% 이상이면 상위 보직 TM만 유지한다.
  ====================================================== */

  const filteredImportedEntries =
    filterLeaderTmEntriesByRoleHierarchy(
      rebuiltImportedEntries
    );


  /* =====================================================
    5. 파트장 직접 업무와 새 취합 결과 결합
  ====================================================== */

  appState.editorEntries = [
    ...filteredImportedEntries,
    ...leaderOwnEntries
  ];


  sortImportedLogEntries();

  renderLogEntryTable();

  updateMemberLogImportStatus();


  /* =====================================================
    6. 결과 안내
  ====================================================== */

  if (
    foundLogCount ===
    0
  ) {
    showToast(
      "취합할 팀원 업무일지가 아직 작성되지 않았습니다."
    );

    return;
  }


  if (
    rawImportedCount ===
    0
  ) {
    showToast(
      "취합할 팀원 업무내역이 없습니다."
    );

    return;
  }


  const finalTmCount =
    filteredImportedEntries.filter(
      (entry) => {
        return (
          String(
            entry.category ||
            ""
          ).trim() ===
          "TM 발행"
        );
      }
    ).length;


  const finalOrdinaryCount =
    filteredImportedEntries.length -
    finalTmCount;


  showToast(
    `TM ${finalTmCount}건, 업무 ${finalOrdinaryCount}건을 보직별로 다시 취합했습니다.`
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
  보직별 운전현황 관리 최종본

  저장 기준:
  날짜 + 근무 + 보직

  예:
  gsShiftLog.operationStatus
  ||2026-07-22
  ||DS
  ||BCO2

  파트장:
  TGO → BCO1 → BCO2 순서로 자동 취합
  취합 이후 파트장이 직접 수정·저장 가능
========================================================= */

const OPERATION_STATUS_MEMBER_ROLES = [
  "TGO",
  "BCO1",
  "BCO2"
];


const OPERATION_STATUS_TYPES = [
  "normal",
  "starting",
  "stopped",
  "abnormal",
  "emergency"
];


/* =========================================================
  현재 업무일지 보직
========================================================= */

function getCurrentOperationStatusRole() {
  const role =
    normalizeMemberLogRole(
      elements.logRole?.value ||
      elements.operationStatusRole?.value ||
      ""
    );

  return role || "TGO";
}


/* =========================================================
  상태 이름
========================================================= */

function getOperationStatusLabel(
  type
) {
  const labelMap = {
    normal:
      "정상운전",

    starting:
      "기동",

    stopped:
      "정지",

    abnormal:
      "이상",

    emergency:
      "비상"
  };

  return (
    labelMap[
      String(type || "")
    ] ||
    "정상운전"
  );
}


/* =========================================================
  상태값 검증
========================================================= */

function normalizeOperationStatusType(
  type
) {
  const normalizedType =
    String(
      type || ""
    ).trim();

  return OPERATION_STATUS_TYPES.includes(
    normalizedType
  )
    ? normalizedType
    : "normal";
}


/* =========================================================
  보직별 기본 운전현황

  새 보직 운전현황이 아직 저장되지 않았을 때만 표시
========================================================= */

function getDefaultOperationStatusContent(
  role
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );

  const defaultContentMap = {
    TGO:
      "#1 TBN 정상 운전 중",

    BCO1:
      "#1 BLR 정상 운전 중",

    BCO2:
      "#2 BLR 정상 운전 중",

    TO:
      "TBN 보조설비 정상 운전 중",

    BO1:
      "#1 BLR 보조설비 정상 운전 중",

    BO2:
      "#2 BLR 보조설비 정상 운전 중",

    파트장:
      ""
  };

  return (
    defaultContentMap[
      normalizedRole
    ] ||
    "등록된 운전현황이 없습니다."
  );
}


/* =========================================================
  기본 운전현황 객체
========================================================= */

function createDefaultOperationStatus(
  role =
    getCurrentOperationStatusRole()
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );

  return {
    role:
      normalizedRole,

    type:
      "normal",

    content:
      getDefaultOperationStatusContent(
        normalizedRole
      ),

    updatedAt:
      "",

    updatedBy:
      ""
  };
}


/* =========================================================
  현재 선택 날짜
========================================================= */

function getOperationStatusDate() {
  return String(
    elements.logDate?.value ||
    formatInputDate(
      appState.selectedDate
    )
  ).trim();
}


/* =========================================================
  현재 선택 근무
========================================================= */

function getOperationStatusShift() {
  return String(
    elements.logShift?.value ||
    appState.selectedShift ||
    "DS"
  )
    .trim()
    .toUpperCase();
}


/* =========================================================
  날짜 + 근무 + 보직별 저장 키
========================================================= */

function getOperationStatusStorageKey(
  role =
    getCurrentOperationStatusRole()
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );

  return [
    STORAGE_KEYS.operationStatus,
    getOperationStatusDate(),
    getOperationStatusShift(),
    normalizedRole
  ].join("||");
}


/* =========================================================
  이전 공통 운전현황 마이그레이션

  과거:
  gsShiftLog.operationStatus

  새 방식:
  gsShiftLog.operationStatus||날짜||근무||보직

  기존 공통값은 처음 불러오는 보직의 초기값으로만 사용하고,
  이후에는 각 보직별 저장값으로 완전히 분리한다.
========================================================= */

function getLegacySharedOperationStatus() {
  const savedValue =
    localStorage.getItem(
      STORAGE_KEYS.operationStatus
    );

  if (!savedValue) {
    return null;
  }

  try {
    const parsedValue =
      JSON.parse(
        savedValue
      );

    if (
      !parsedValue ||
      typeof parsedValue !==
        "object"
    ) {
      return null;
    }

    return {
      type:
        normalizeOperationStatusType(
          parsedValue.type
        ),

      content:
        String(
          parsedValue.content ||
          ""
        ).trim(),

      updatedAt:
        String(
          parsedValue.updatedAt ||
          ""
        ),

      updatedBy:
        String(
          parsedValue.updatedBy ||
          ""
        )
    };

  } catch (error) {
    console.error(
      "기존 공통 운전현황 분석 실패:",
      error
    );

    return null;
  }
}


/* =========================================================
  특정 보직의 저장된 운전현황 불러오기
========================================================= */

function loadOperationStatusByRole(
  role,
  options = {}
) {
  const {
    allowLegacyFallback =
      false
  } = options;

  const normalizedRole =
    normalizeMemberLogRole(
      role
    );

  const storageKey =
    getOperationStatusStorageKey(
      normalizedRole
    );

  const savedValue =
    localStorage.getItem(
      storageKey
    );

  if (savedValue) {
    try {
      const parsedValue =
        JSON.parse(
          savedValue
        );

      return {
        role:
          normalizedRole,

        type:
          normalizeOperationStatusType(
            parsedValue.type
          ),

        content:
          String(
            parsedValue.content ||
            getDefaultOperationStatusContent(
              normalizedRole
            )
          ).trim(),

        updatedAt:
          String(
            parsedValue.updatedAt ||
            ""
          ),

        updatedBy:
          String(
            parsedValue.updatedBy ||
            ""
          )
      };

    } catch (error) {
      console.error(
        `${normalizedRole} 운전현황 불러오기 실패:`,
        error
      );
    }
  }


  /*
    기존 공통 저장값은 요청한 경우에만 사용한다.

    새 구조 적용 직후 기존 내용이 갑자기 사라지는 것을
    방지하기 위한 호환 처리다.
  */
  if (
    allowLegacyFallback
  ) {
    const legacyStatus =
      getLegacySharedOperationStatus();

    if (
      legacyStatus?.content
    ) {
      return {
        role:
          normalizedRole,

        type:
          legacyStatus.type,

        content:
          legacyStatus.content,

        updatedAt:
          legacyStatus.updatedAt,

        updatedBy:
          legacyStatus.updatedBy
      };
    }
  }


  return createDefaultOperationStatus(
    normalizedRole
  );
}


/* =========================================================
  특정 보직 운전현황 저장
========================================================= */

function saveOperationStatusByRole(
  role,
  status
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );

  const safeStatus = {
    role:
      normalizedRole,

    type:
      normalizeOperationStatusType(
        status?.type
      ),

    content:
      String(
        status?.content ||
        ""
      ).trim(),

    updatedAt:
      String(
        status?.updatedAt ||
        new Date().toISOString()
      ),

    updatedBy:
      String(
        status?.updatedBy ||
        ""
      ).trim()
  };

  localStorage.setItem(
    getOperationStatusStorageKey(
      normalizedRole
    ),

    JSON.stringify(
      safeStatus
    )
  );

  return safeStatus;
}

/* =========================================================
  파트장 운전현황 자동 취합 최종본

  TGO → BCO1 → BCO2 순서 유지

  각 보직별로 다음 정보를 모두 저장한다.
  - 보직
  - 운전 상태
  - 운전현황 내용
  - 마지막 수정시간
  - 작성자
========================================================= */

function createLeaderCombinedOperationStatus() {
  const memberStatuses =
    OPERATION_STATUS_MEMBER_ROLES
      .map(
        (role) => {
          const memberStatus =
            loadOperationStatusByRole(
              role,
              {
                allowLegacyFallback:
                  role === "TGO"
              }
            );


          return {
            role,

            type:
              normalizeOperationStatusType(
                memberStatus.type
              ),

            content:
              String(
                memberStatus.content ||
                "등록된 운전현황이 없습니다."
              ).trim(),

            updatedAt:
              String(
                memberStatus.updatedAt ||
                ""
              ),

            updatedBy:
              String(
                memberStatus.updatedBy ||
                ""
              ).trim()
          };
        }
      );


  /*
    업무일지 저장용 문자열

    기존 상세보기와 업무일지 저장 구조는
    그대로 유지하기 위해 문자열도 함께 만든다.
  */
  const combinedContent =
    memberStatuses
      .map(
        (memberStatus) => {
          return [
            `[${memberStatus.role}]`,
            memberStatus.content
          ].join("\n");
        }
      )
      .join("\n\n");


  return {
    role:
      "파트장",

    /*
      파트장 전체 상태는 별도로 판단하지 않고
      화면에서 각 보직 상태를 개별 표시한다.
    */
    type:
      "normal",

    content:
      combinedContent,

    memberStatuses,

    updatedAt:
      "",

    updatedBy:
      ""
  };
}


/* =========================================================
  파트장 저장 운전현황 확인
========================================================= */

function loadLeaderOperationStatus() {
  const leaderStorageKey =
    getOperationStatusStorageKey(
      "파트장"
    );

  const savedLeaderStatus =
    localStorage.getItem(
      leaderStorageKey
    );

  /*
    파트장이 직접 저장한 내용이 있으면
    자동 취합보다 저장 내용을 우선한다.
  */
  if (
    savedLeaderStatus
  ) {
    return loadOperationStatusByRole(
      "파트장",
      {
        allowLegacyFallback:
          false
      }
    );
  }

  return createLeaderCombinedOperationStatus();
}


/* =========================================================
  현재 업무일지 보직의 운전현황 불러오기
========================================================= */

function loadOperationStatus() {
  const currentRole =
    getCurrentOperationStatusRole();

  if (
    currentRole ===
    "파트장"
  ) {
    appState.currentOperationStatus =
      loadLeaderOperationStatus();

    return appState.currentOperationStatus;
  }

  appState.currentOperationStatus =
    loadOperationStatusByRole(
      currentRole,
      {
        /*
          기존 공통 운전현황은 TGO에만 초기 호환 적용한다.

          BCO1·BCO2가 TGO 운전현황을 그대로 표시하는
          기존 문제를 차단하기 위함이다.
        */
        allowLegacyFallback:
          currentRole ===
          "TGO"
      }
    );

  return appState.currentOperationStatus;
}


/* =========================================================
  현재 운전현황 저장
========================================================= */

function saveOperationStatusToStorage() {
  const currentRole =
    getCurrentOperationStatusRole();

  appState.currentOperationStatus =
    saveOperationStatusByRole(
      currentRole,
      appState.currentOperationStatus
    );
}


/* =========================================================
  운전현황 제목 변경

  BCO2 업무일지:
  BCO2 운전현황
  BCO2 운전현황 수정
========================================================= */

function updateOperationStatusRoleTitles() {
  const currentRole =
    getCurrentOperationStatusRole();

  if (
    elements.operationStatusRole
  ) {
    elements.operationStatusRole.value =
      currentRole;
  }

  if (
    elements.operationStatusRoleTitle
  ) {
    elements.operationStatusRoleTitle.textContent =
      `${currentRole} 운전현황`;
  }

  if (
    elements.operationStatusEditorTitle
  ) {
    elements.operationStatusEditorTitle.textContent =
      `${currentRole} 운전현황 수정`;
  }
}


/* =========================================================
  상태 버튼 선택 표시
========================================================= */

function renderOperationStatusTypeButtons(
  selectedType
) {
  const normalizedType =
    normalizeOperationStatusType(
      selectedType
    );

  const buttons =
    Array.isArray(
      elements.operationStatusTypeButtons
    )
      ? elements.operationStatusTypeButtons
      : [];

  buttons.forEach(
    (button) => {
      const buttonType =
        normalizeOperationStatusType(
          button.dataset
            .operationStatusType
        );

      const isSelected =
        buttonType ===
        normalizedType;

      button.classList.toggle(
        "is-selected",
        isSelected
      );

      button.setAttribute(
        "aria-pressed",
        String(
          isSelected
        )
      );
    }
  );

  if (
    elements.operationStatusType
  ) {
    elements.operationStatusType.value =
      normalizedType;
  }
}


/* =========================================================
  상태에 따라 카드·편집창 색상 변경
========================================================= */

function applyOperationStatusTheme(
  selectedType
) {
  const normalizedType =
    normalizeOperationStatusType(
      selectedType
    );

  const typeClassNames =
    OPERATION_STATUS_TYPES.map(
      (type) => {
        return `is-type-${type}`;
      }
    );

  [
    elements.operationStatusSection,
    elements.operationStatusCurrentCard,
    elements.operationStatusEditor
  ].forEach(
    (targetElement) => {
      if (!targetElement) {
        return;
      }

      targetElement.classList.remove(
        ...typeClassNames
      );

      targetElement.classList.add(
        `is-type-${normalizedType}`
      );
    }
  );
}


/* =========================================================
  운전상태 배지 표시
========================================================= */

function renderOperationStatusBadge(
  selectedType
) {
  if (
    !elements.operationStatusStateBadge
  ) {
    return;
  }

  const normalizedType =
    normalizeOperationStatusType(
      selectedType
    );

  elements.operationStatusStateBadge.textContent =
    getOperationStatusLabel(
      normalizedType
    );

  elements.operationStatusStateBadge.className =
    [
      "operation-status-state-badge",
      `is-${normalizedType}`
    ].join(" ");
}

/* =========================================================
  파트장 보직별 운전현황 한 줄 생성

  표시:
  TGO  정상운전  |  #1 TBN 정상 운전 중  수정시간
========================================================= */

function createLeaderOperationStatusRowHtml(
  memberStatus
) {
  const role =
    normalizeMemberLogRole(
      memberStatus?.role
    );


  const type =
    normalizeOperationStatusType(
      memberStatus?.type
    );


  const typeLabel =
    getOperationStatusLabel(
      type
    );


  const content =
    String(
      memberStatus?.content ||
      "등록된 운전현황이 없습니다."
    ).trim();


  const updatedAt =
    String(
      memberStatus?.updatedAt ||
      ""
    ).trim();


  const updatedAtText =
    updatedAt
      ? `${formatDateTime(
          updatedAt
        )} 수정`
      : "";


  return `
    <div
      class="
        leader-operation-line
        is-${escapeHtml(type)}
      "
    >

      <strong
        class="leader-operation-line__role"
      >
        ${escapeHtml(role)}
      </strong>


      <span
        class="
          leader-operation-line__status
          is-${escapeHtml(type)}
        "
      >
        ${escapeHtml(typeLabel)}
      </span>


      <span
        class="leader-operation-line__divider"
        aria-hidden="true"
      >
        |
      </span>


      <span
        class="leader-operation-line__content"
      >
        ${escapeHtml(content)}
      </span>


      <span
        class="leader-operation-line__time"
      >
        ${escapeHtml(updatedAtText)}
      </span>

    </div>
  `;
}

/* =========================================================
  운전현황 카드 렌더링 최종본

  일반 보직:
  상태 배지 + 내용 + 수정시간

  파트장:
  TGO·BCO1·BCO2를 카드 없이 세 줄로 표시
========================================================= */

function renderOperationStatusCard() {
  const currentRole =
    getCurrentOperationStatusRole();


  const status =
    appState.currentOperationStatus ||
    createDefaultOperationStatus(
      currentRole
    );


  const selectedType =
    normalizeOperationStatusType(
      status.type
    );


  const content =
    String(
      status.content ||
      "등록된 운전현황이 없습니다."
    ).trim();


  updateOperationStatusRoleTitles();


  /* =====================================================
    파트장 표시
  ====================================================== */

  if (
    currentRole ===
    "파트장"
  ) {
    /*
      파트장 화면은 항상 저장소에서
      TGO·BCO1·BCO2 최신 상태를 다시 읽는다.
    */
    const memberStatuses =
      OPERATION_STATUS_MEMBER_ROLES.map(
        (role) => {
          const memberStatus =
            loadOperationStatusByRole(
              role,
              {
                allowLegacyFallback:
                  role === "TGO"
              }
            );


          return {
            role,

            type:
              normalizeOperationStatusType(
                memberStatus.type
              ),

            content:
              String(
                memberStatus.content ||
                "등록된 운전현황이 없습니다."
              ).trim(),

            updatedAt:
              String(
                memberStatus.updatedAt ||
                ""
              ),

            updatedBy:
              String(
                memberStatus.updatedBy ||
                ""
              )
          };
        }
      );


    /*
      일반 보직 표시 영역을 숨기고
      파트장 전용 영역만 표시한다.
    */
    if (
      elements.operationStatusSingleView
    ) {
      elements.operationStatusSingleView.hidden =
        true;
    }


    if (
      elements.leaderOperationStatusList
    ) {
      elements.leaderOperationStatusList.hidden =
        false;


      elements.leaderOperationStatusList.innerHTML =
        memberStatuses
          .map(
            createLeaderOperationStatusRowHtml
          )
          .join("");
    }


    /*
      업무일지에 저장할 통합 운전현황 원문
    */
    const combinedContent =
      memberStatuses
        .map(
          (memberStatus) => {
            return [
              `[${memberStatus.role}]`,
              memberStatus.content
            ].join("\n");
          }
        )
        .join("\n\n");


    if (
      elements.operationStatus
    ) {
      elements.operationStatus.value =
        combinedContent;
    }


    if (
      elements.operationStatusSnapshot
    ) {
      elements.operationStatusSnapshot.value =
        combinedContent;
    }


    if (
      elements.operationStatusType
    ) {
      elements.operationStatusType.value =
        "normal";
    }


    elements.operationStatusSection
      ?.classList.add(
        "is-leader-operation-status"
      );


    /*
      파트장 전체 카드에는 한 가지 상태색을
      강제로 적용하지 않는다.
    */
    OPERATION_STATUS_TYPES.forEach(
      (type) => {
        elements.operationStatusSection
          ?.classList.remove(
            `is-type-${type}`
          );


        elements.operationStatusCurrentCard
          ?.classList.remove(
            `is-type-${type}`
          );
      }
    );


    return;
  }


  /* =====================================================
    일반 보직 표시
  ====================================================== */

  elements.operationStatusSection
    ?.classList.remove(
      "is-leader-operation-status"
    );


  if (
    elements.leaderOperationStatusList
  ) {
    elements.leaderOperationStatusList.hidden =
      true;

    elements.leaderOperationStatusList.innerHTML =
      "";
  }


  if (
    elements.operationStatusSingleView
  ) {
    elements.operationStatusSingleView.hidden =
      false;
  }


  if (
    elements.operationStatusCurrentContent
  ) {
    elements.operationStatusCurrentContent.textContent =
      content;
  }


  if (
    elements.operationStatus
  ) {
    elements.operationStatus.value =
      content;
  }


  if (
    elements.operationStatusSnapshot
  ) {
    elements.operationStatusSnapshot.value =
      content;
  }


  if (
    elements.operationStatusType
  ) {
    elements.operationStatusType.value =
      selectedType;
  }


  if (
    elements.operationStatusUpdatedAt
  ) {
    elements.operationStatusUpdatedAt.textContent =
      status.updatedAt
        ? `${formatDateTime(
            status.updatedAt
          )} 수정`
        : "";
  }


  if (
    elements.operationStatusUpdatedBy
  ) {
    elements.operationStatusUpdatedBy.textContent =
      "";

    elements.operationStatusUpdatedBy.hidden =
      true;
  }


  if (
    elements.operationStatusEditorTime
  ) {
    elements.operationStatusEditorTime.textContent =
      status.updatedAt
        ? `${formatDateTime(
            status.updatedAt
          )} 수정`
        : "";
  }


  renderOperationStatusBadge(
    selectedType
  );


  renderOperationStatusTypeButtons(
    selectedType
  );


  applyOperationStatusTheme(
    selectedType
  );
}


/* =========================================================
  현재 보직 운전현황 새로고침
========================================================= */

function refreshOperationStatusForCurrentRole() {
  closeOperationStatusEditor();

  loadOperationStatus();

  renderOperationStatusCard();

  updateOperationStatusRoleTitles();
}

/* =========================================================
  운전현황 편집창 열기 최종본

  파트장은 수정창을 열기 직전에
  TGO·BCO1·BCO2 최신 운전현황을 다시 취합한다.
========================================================= */

function openOperationStatusEditor() {
  if (
    !elements.operationStatusEditor ||
    !elements.operationStatus
  ) {
    return;
  }


  const currentRole =
    getCurrentOperationStatusRole();


  /*
    파트장은 수정창을 열기 직전에
    최신 팀원 상태를 다시 취합한다.

    단, 파트장이 이미 직접 저장한 운전현황이 있으면
    저장한 수정본을 우선한다.
  */
  if (
    currentRole ===
    "파트장"
  ) {
    appState.currentOperationStatus =
      loadLeaderOperationStatus();

    renderOperationStatusCard();
  }


  const status =
    appState.currentOperationStatus ||
    createDefaultOperationStatus(
      currentRole
    );


  updateOperationStatusRoleTitles();


  elements.operationStatus.value =
    String(
      status.content ||
      ""
    );


  const selectedType =
    normalizeOperationStatusType(
      status.type
    );


  if (
    elements.operationStatusType
  ) {
    elements.operationStatusType.value =
      selectedType;
  }


  renderOperationStatusTypeButtons(
    selectedType
  );


  applyOperationStatusTheme(
    selectedType
  );


  elements.operationStatusEditor.hidden =
    false;


  elements.operationStatusSection
    ?.classList.add(
      "is-editing"
    );


  window.setTimeout(
    () => {
      elements.operationStatus
        ?.focus();
    },
    0
  );
}

/* =========================================================
  운전현황 편집창 닫기
========================================================= */

function closeOperationStatusEditor() {
  if (
    elements.operationStatusEditor
  ) {
    elements.operationStatusEditor.hidden =
      true;
  }

  elements.operationStatusSection
    ?.classList.remove(
      "is-editing"
    );


  /*
    저장하지 않고 닫은 경우
    카드의 기존 상태색으로 복구한다.
  */
  const savedType =
    normalizeOperationStatusType(
      appState.currentOperationStatus
        ?.type
    );

  renderOperationStatusTypeButtons(
    savedType
  );

  renderOperationStatusBadge(
    savedType
  );

  applyOperationStatusTheme(
    savedType
  );
}


/* =========================================================
  운전 상태 버튼 클릭
========================================================= */

function selectOperationStatusType(
  selectedType
) {
  const normalizedType =
    normalizeOperationStatusType(
      selectedType
    );

  if (
    elements.operationStatusType
  ) {
    elements.operationStatusType.value =
      normalizedType;
  }


  renderOperationStatusTypeButtons(
    normalizedType
  );


  renderOperationStatusBadge(
    normalizedType
  );


  applyOperationStatusTheme(
    normalizedType
  );
}


/* =========================================================
  운전현황 저장
========================================================= */

function saveOperationStatus() {
  if (
    !elements.operationStatus
  ) {
    return;
  }

  const currentRole =
    getCurrentOperationStatusRole();

  const content =
    String(
      elements.operationStatus.value ||
      ""
    ).trim();

  if (!content) {
    showToast(
      "운전현황을 입력하세요."
    );

    elements.operationStatus.focus();

    return;
  }


  const selectedType =
    normalizeOperationStatusType(
      elements.operationStatusType
        ?.value
    );


  appState.currentOperationStatus = {
    role:
      currentRole,

    type:
      selectedType,

    content,

    updatedAt:
      new Date().toISOString(),

    updatedBy:
      String(
        elements.logAuthor?.value ||
        ""
      ).trim()
  };


  saveOperationStatusToStorage();


  renderOperationStatusCard();


  closeOperationStatusEditor();


  showToast(
    `${currentRole} 운전현황이 저장되었습니다.`
  );
}


/* =========================================================
  운전현황 전용 이벤트 연결

  bindEvents()에 이미 존재하는
  수정·닫기·저장 버튼 이벤트는 그대로 사용한다.

  여기서는 다음 기능만 추가한다.

  - 상태 버튼
  - 보직 변경
  - 작성일 변경
  - 근무 변경
========================================================= */

function bindOperationStatusEvents() {
  /*
    상태 선택 버튼
  */
  elements.operationStatusTypeButtons
    ?.forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            selectOperationStatusType(
              button.dataset
                .operationStatusType
            );
          }
        );
      }
    );


  /*
    보직을 바꾸면 해당 보직의 운전현황 표시
  */
  elements.logRole?.addEventListener(
    "change",
    refreshOperationStatusForCurrentRole
  );


  /*
    날짜별 운전현황 분리
  */
  elements.logDate?.addEventListener(
    "change",
    refreshOperationStatusForCurrentRole
  );


  /*
    D/S·N/S 운전현황 분리
  */
  elements.logShift?.addEventListener(
    "change",
    refreshOperationStatusForCurrentRole
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


  if (
    elements.logEditorModal
  ) {
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
        /*
          현재시간 체크를 해제하면
          숨겨진 시간값도 초기화한다.
        */
        if (
          elements.logEntryTime
        ) {
          elements.logEntryTime
            .value = "";
        }

        return;
      }


      if (
        elements.logEntryTime
      ) {
        elements.logEntryTime.value =
          getCurrentTimeValue();

        elements.logEntryTime
          .classList.add(
            "is-current-time-applied"
          );


        window.setTimeout(
          () => {
            elements.logEntryTime
              ?.classList.remove(
                "is-current-time-applied"
              );
          },
          500
        );
      }


      elements.logEntryContent
        ?.focus();
    }
  );


  /* =======================================================
    숨겨진 시간값 자동 정리

    기존 스크립트 호환을 위해 유지한다.
    시간 입력칸이 hidden이어도 오류 없이 동작한다.
  ======================================================== */

  bindInput(
    elements.logEntryTime,
    handleLogEntryTimeInput
  );


  if (
    elements.logEntryTime
  ) {
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


  /* =======================================================
    내용 입력창 Enter 동작

    Enter:
    추가 또는 수정 확인창

    Shift + Enter:
    줄바꿈

    한글 조합 중 Enter:
    글자 확정만 처리
  ======================================================== */

  bindKeydown(
    elements.logEntryContent,
    (event) => {
      if (
        event.key !== "Enter"
      ) {
        return;
      }


      /*
        한글 조합 중 Enter는
        추가 동작으로 처리하지 않는다.
      */
      if (
        event.isComposing ||
        event.keyCode === 229
      ) {
        return;
      }


      /*
        Shift + Enter는
        내용 입력창 줄바꿈으로 유지한다.
      */
      if (
        event.shiftKey
      ) {
        return;
      }


      /*
        일반 Enter,
        Ctrl + Enter,
        Cmd + Enter 모두
        확인창을 거쳐 추가한다.
      */
      event.preventDefault();


      confirmAndAddLogEntry();
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
        .map(
          (checkbox) => {
            return Number(
              checkbox.dataset
                .entrySelectIndex
            );
          }
        )
        .filter(
          (index) => {
            return (
              Number.isInteger(
                index
              ) &&
              appState.editorEntries[
                index
              ]
            );
          }
        );


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
          (
            indexA,
            indexB
          ) =>
            indexB - indexA
        )
        .forEach(
          (index) => {
            appState.editorEntries
              .splice(
                index,
                1
              );
          }
        );


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


  if (
    elements.fileDropzone
  ) {
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

  if (
    elements.logEditorForm
  ) {
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

  if (
    elements.logTableBody
  ) {
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


  if (
    elements.logDetailModal
  ) {
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

      openLogEditor(
        log
      );
    }
  );


  /* =======================================================
    조회
  ======================================================== */

  if (
    elements.searchForm
  ) {
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

              setDefaultSearchDateRange();

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


                if (
                  title
                ) {
                  title.textContent =
                    "조회 조건을 선택해 주세요.";
                }


                if (
                  description
                ) {
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
  업무일지 작성·수정창 열기 최종본

  핵심:
  보직·날짜·근무값을 먼저 설정한 다음
  마지막에 해당 보직 운전현황을 불러온다.
========================================================= */

function openLogEditor(
  log = null,
  preset = null
) {
  /*
    이전 입력 상태를 먼저 초기화한다.
  */
  resetLogEditor();


  /* =====================================================
    기존 업무일지 수정
  ====================================================== */

  if (
    log
  ) {
    fillLogEditor(
      log
    );


    if (
      elements.logEditorTitle
    ) {
      elements.logEditorTitle.textContent =
        `${log.role || ""} 업무일지 수정`;
    }


    /*
      fillLogEditor()에서 날짜·근무·보직을 설정한 뒤
      그 보직 전용 운전현황을 불러온다.
    */
    refreshOperationStatusForCurrentRole();


    updateMemberLogImportSection();


    openModal(
      elements.logEditorModal
    );


    return;
  }


  /* =====================================================
    근무자 카드에서 새 업무일지 작성
  ====================================================== */

  if (
    preset
  ) {
    const presetRole =
      normalizeMemberLogRole(
        preset.role
      );


    const presetAuthor =
      String(
        preset.author ||
        ""
      ).trim();


    const presetTeam =
      normalizeTeamName(
        preset.team
      );


    /*
      보직 적용
    */
    if (
      presetRole &&
      elements.logRole &&
      [
        ...elements.logRole.options
      ].some(
        (option) => {
          return (
            normalizeMemberLogRole(
              option.value
            ) ===
            presetRole
          );
        }
      )
    ) {
      elements.logRole.value =
        presetRole;
    }


    /*
      작성자 적용
    */
    if (
      presetAuthor &&
      elements.logAuthor
    ) {
      elements.logAuthor.value =
        presetAuthor;
    }


    /*
      근무파트 적용
    */
    if (
      presetTeam &&
      elements.logTeam &&
      [
        ...elements.logTeam.options
      ].some(
        (option) => {
          return (
            normalizeTeamName(
              option.value
            ) ===
            presetTeam
          );
        }
      )
    ) {
      elements.logTeam.value =
        presetTeam;
    }


    if (
      elements.logEditorTitle
    ) {
      elements.logEditorTitle.textContent =
        `${presetRole || ""} 업무일지 작성`;
    }


    /*
      BCO2 카드를 눌렀으면
      여기에서 BCO2 운전현황을 불러온다.

      TGO 운전현황이 남는 문제를 해결한다.
    */
    refreshOperationStatusForCurrentRole();


    updateMemberLogImportSection();


    openModal(
      elements.logEditorModal
    );


    return;
  }


  /* =====================================================
    일반 신규 업무일지 작성
  ====================================================== */

  if (
    elements.logEditorTitle
  ) {
    elements.logEditorTitle.textContent =
      "업무일지 작성";
  }


  restoreDraftIfAvailable();


  /*
    임시저장 복원 또는 기본 보직 기준으로
    운전현황을 다시 불러온다.
  */
  refreshOperationStatusForCurrentRole();


  updateMemberLogImportSection();


  openModal(
    elements.logEditorModal
  );
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

/* =========================================================
  근무자 카드 → 업무일지 작성·수정

  날짜·근무·보직이 같은 가장 최근 업무일지를 찾아
  있으면 수정창, 없으면 작성창을 연다.
========================================================= */

function openShiftMemberLogFromCard(
  card
) {
  if (!card) {
    showToast(
      "선택한 근무자 정보를 확인할 수 없습니다."
    );

    return;
  }


  const role =
    normalizeMemberLogRole(
      card.dataset.role
    );


  if (!role) {
    showToast(
      "선택한 근무자의 보직을 확인할 수 없습니다."
    );

    return;
  }


  const author =
    String(
      card.querySelector(
        ".shift-member-card__name"
      )?.textContent ||
      ""
    ).trim();


  const team =
    getScheduledPart(
      appState.selectedDate,
      appState.selectedShift
    );


  const selectedDate =
    formatInputDate(
      appState.selectedDate
    );


  /*
    날짜·근무·보직이 일치하는 업무일지를 찾고,
    중복 데이터가 있으면 가장 최근 수정본을 사용한다.
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


          return (
            timeB -
            timeA
          );
        }
      );


  const existingLog =
    matchedLogs[0] ||
    null;


  /*
    작성된 업무일지가 있으면 수정창
  */
  if (existingLog) {
    openLogEditor(
      existingLog
    );

    return;
  }


  /*
    업무일지가 없으면 새 작성창
  */
  openLogEditor(
    null,
    {
      role,
      author,
      team
    }
  );
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

/* =========================================================
  기존 저장 업무내역 시간 재분석

  지원 형식:
  08:00 내용
  08:00, 09:00, 10:00 내용
  08:00~09:30 내용
  08:00 ~ 09:30 내용
  0800~0930 내용

  기존 entry.time 값이 있더라도
  content 앞에 시간이 다시 들어 있으면 제거하고 정리한다.
========================================================= */

function normalizeExistingLogEntryTime(
  entry
) {
  const sourceEntry =
    entry &&
    typeof entry ===
      "object"
      ? entry
      : {};


  const originalTime =
    String(
      sourceEntry.time ||
      ""
    ).trim();


  const originalContent =
    String(
      sourceEntry.content ||
      ""
    )
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();


  /*
    내용이 없으면 기존 값을 그대로 유지한다.
  */
  if (!originalContent) {
    return {
      ...sourceEntry,

      time:
        originalTime,

      content:
        ""
    };
  }


  /*
    내용 맨 앞에 입력된 시간 표현을 분석한다.
  */
  const parsedTime =
    parseLeadingLogTimeExpression(
      originalContent
    );


  /*
    내용 앞에서 시간 표현을 찾은 경우

    예:
    content = "08:37~09:46 작업"
    →
    time    = "08:37~09:46"
    content = "작업"
  */
  if (
    parsedTime.timeText &&
    parsedTime.content
  ) {
    return {
      ...sourceEntry,

      /*
        내용에 적혀 있던 시간을 우선한다.

        과거 데이터의 time 값이 비어 있거나
        잘못 들어 있어도 새로 분석한 값으로 교체한다.
      */
      time:
        parsedTime.timeText,

      content:
        parsedTime.content
    };
  }


  /*
    시간만 있고 실제 내용이 없는 경우에는
    데이터 유실을 막기 위해 원문을 유지한다.
  */
  return {
    ...sourceEntry,

    time:
      originalTime,

    content:
      originalContent
  };
}


/* =========================================================
  기존 업무일지의 전체 항목 시간 재분석
========================================================= */

function normalizeExistingLogEntries(
  entries
) {
  const sourceEntries =
    Array.isArray(
      entries
    )
      ? entries
      : [];


  return sourceEntries.map(
    (entry) => {
      return normalizeExistingLogEntryTime(
        entry
      );
    }
  );
}

/* =========================================================
  기존 업무일지 수정창 채우기 최종본

  기존에 입력된 내용도 다시 분석하여

  08:00, 09:00 작업
  08:00~09:00 작업

  형식의 시간을 시간 영역으로 분리한다.
========================================================= */

function fillLogEditor(log) {
  if (
    !log ||
    !elements.logEditorForm
  ) {
    return;
  }


  elements.logEditorForm.dataset.editingId =
    String(
      log.id ||
      ""
    ).trim();


  elements.logDate.value =
    log.date ||
    "";


  elements.logShift.value =
    log.shift ||
    appState.selectedShift;


  elements.logTeam.value =
    normalizeTeamName(
      log.team ||
      "3파트"
    );


  elements.logRole.value =
    log.role ||
    "";


  elements.logAuthor.value =
    log.author ||
    "";


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
    log.operationStatus ||
    "";


  if (
    elements.operationStatusSnapshot
  ) {
    elements.operationStatusSnapshot.value =
      log.operationStatus ||
      "";
  }


  elements.logNote.value =
    log.note ||
    "";


  /*
    기존 저장 항목 전체를 먼저 시간 재분석한다.
  */
  const normalizedEntries =
    normalizeExistingLogEntries(
      log.entries
    );


  appState.editorEntries =
    normalizedEntries.map(
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
          id:
            String(
              entry.id ||
              ""
            ).trim(),

          time:
            String(
              entry.time ||
              ""
            ).trim(),

          category:
            String(
              entry.category ||
              "인계사항"
            ).trim(),

          tag:
            String(
              entry.tag ||
              ""
            )
              .trim()
              .toUpperCase(),

          content:
            String(
              entry.content ||
              ""
            ).trim(),

          attachmentName:
            String(
              entry.attachmentName ||
              ""
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
              : "",

          legacyBodyIndex:
            entry.legacyBodyIndex,

          legacyLineIndex:
            entry.legacyLineIndex,

          source:
            String(
              entry.source ||
              ""
            ).trim()
        };
      }
    );


  /*
    메모리의 현재 업무일지 데이터에도
    정리된 값을 반영한다.

    수정창에서 다시 저장하지 않아도
    현재 화면과 상세보기에서 즉시 사용할 수 있다.
  */
  log.entries =
    appState.editorEntries.map(
      (entry) => {
        return {
          ...entry
        };
      }
    );


  appState.editingEntryIndex =
    -1;


  resetLogEntryInput({
    keepCategory:
      false,

    keepTag:
      false
  });


  renderLogEntryTable();


  renderSavedAttachments(
    Array.isArray(
      log.attachments
    )
      ? log.attachments
      : []
  );
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

/* =========================================================
  작업내역 내용 앞 시간 자동 분석

  지원 예시:
  08:00 설비 점검
  0800 설비 점검
  08:00, 10:00 설비 점검
  0800 1000 설비 점검
  08:00 / 10:00 설비 점검
========================================================= */


/*
  시간 하나를 HH:MM 형식으로 변환한다.

  입력 예:
  0800  → 08:00
  800   → 08:00
  08:00 → 08:00
*/
function normalizeContentTimeToken(
  rawTime
) {
  const source =
    String(
      rawTime || ""
    )
      .trim()
      .replace(
        /[^0-9:]/g,
        ""
      );

  if (!source) {
    return "";
  }


  let hourText = "";
  let minuteText = "";


  /*
    08:00 형식
  */
  if (
    source.includes(":")
  ) {
    const parts =
      source.split(":");

    hourText =
      String(
        parts[0] || ""
      );

    minuteText =
      String(
        parts[1] || ""
      );

  } else {
    /*
      숫자만 입력한 형식

      0800 → 08:00
      800  → 08:00
    */
    const digits =
      source.replace(
        /\D/g,
        ""
      );

    if (
      digits.length === 3
    ) {
      hourText =
        digits.slice(
          0,
          1
        );

      minuteText =
        digits.slice(
          1,
          3
        );

    } else if (
      digits.length === 4
    ) {
      hourText =
        digits.slice(
          0,
          2
        );

      minuteText =
        digits.slice(
          2,
          4
        );

    } else {
      return "";
    }
  }


  const hour =
    Number(
      hourText
    );

  const minute =
    Number(
      minuteText
    );


  if (
    !Number.isInteger(
      hour
    ) ||
    !Number.isInteger(
      minute
    ) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return "";
  }


  return [
    String(
      hour
    ).padStart(
      2,
      "0"
    ),

    String(
      minute
    ).padStart(
      2,
      "0"
    )
  ].join(":");
}

/* =========================================================
  내용 앞 시간 표현 분석 최종본

  지원 형식

  단일 시간
  08:00 작업
  800 작업
  0800 작업

  여러 시간
  08:00, 10:00, 13:00 작업
  08:00 / 10:00 / 13:00 작업
  08:00 · 10:00 · 13:00 작업
  08:00 10:00 13:00 작업
  0800, 1000, 1300 작업

  시간 범위
  08:00~09:30 작업
  08:00 ~ 09:30 작업
  08:00-09:30 작업
  0800~0930 작업

  여러 범위 및 혼합
  08:00~09:30, 13:00~14:00 작업
  08:00, 10:00~11:00, 13:00 작업
========================================================= */

function parseLeadingLogTimeExpression(
  rawContent
) {
  const originalContent =
    String(
      rawContent || ""
    )
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();


  const emptyResult = {
    times: [],
    timeText: "",
    content:
      originalContent,
    matchedText: ""
  };


  if (!originalContent) {
    return {
      ...emptyResult,
      content: ""
    };
  }


  /*
    시간 토큰

    08:00
    8:00
    0800
    800
  */
  const timeTokenPattern =
    "(?:(?:[01]?\\d|2[0-3]):[0-5]\\d|\\d{3,4})";


  /*
    시간 사이에서 허용할 구분자

    목록:
    쉼표, 슬래시, 가운데점, 공백

    범위:
    ~, ～, -, –, —
  */
  const separatorPattern =
    "(?:\\s*(?:,|\\/|·|~|～|-|–|—)\\s*|\\s+)";


  /*
    문장 맨 앞의 시간 표현 전체를 추출한다.

    예:
    08:00, 09:00, 10:00 내용
    08:00~09:00 내용
  */
  const leadingTimePattern =
    new RegExp(
      "^(" +
      timeTokenPattern +
      "(?:" +
      separatorPattern +
      timeTokenPattern +
      ")*)"
    );


  const prefixMatch =
    originalContent.match(
      leadingTimePattern
    );


  if (!prefixMatch) {
    return emptyResult;
  }


  const rawTimeExpression =
    String(
      prefixMatch[1] || ""
    ).trim();


  /*
    시간 표현 안의 실제 시간 토큰 추출
  */
  const rawTimeTokens =
    rawTimeExpression.match(
      /(?:[01]?\d|2[0-3]):[0-5]\d|\d{3,4}/g
    ) || [];


  const normalizedTimes =
    rawTimeTokens
      .map(
        normalizeContentTimeToken
      )
      .filter(Boolean);


  /*
    앞부분이 숫자처럼 보였지만
    유효한 시간이 아니면 일반 내용으로 유지한다.
  */
  if (!normalizedTimes.length) {
    return emptyResult;
  }


  /*
    유효하지 않은 시간이 하나라도 있으면
    잘못 잘라내지 않고 일반 내용으로 유지한다.

    예:
    25:70 설비 점검
  */
  if (
    normalizedTimes.length !==
    rawTimeTokens.length
  ) {
    return emptyResult;
  }


  let tokenIndex = 0;


  /*
    각 시간 토큰을 HH:MM 형식으로 변환한다.

    800  → 08:00
    0800 → 08:00
  */
  let normalizedExpression =
    rawTimeExpression.replace(
      /(?:[01]?\d|2[0-3]):[0-5]\d|\d{3,4}/g,
      () => {
        const normalizedTime =
          normalizedTimes[
            tokenIndex
          ] || "";

        tokenIndex += 1;

        return normalizedTime;
      }
    );


  /*
    모든 시간 범위 기호를 ~로 통일한다.

    08:00 - 09:00
    08:00–09:00
    08:00～09:00

    모두

    08:00~09:00
  */
  normalizedExpression =
    normalizedExpression.replace(
      /\s*(?:~|～|-|–|—)\s*/g,
      "~"
    );


  /*
    시간 목록 구분자는 쉼표+공백으로 통일한다.

    08:00 / 09:00
    08:00 · 09:00

    모두

    08:00, 09:00
  */
  normalizedExpression =
    normalizedExpression.replace(
      /\s*(?:,|\/|·)\s*/g,
      ", "
    );


  /*
    시간을 공백으로만 나열한 경우

    08:00 09:00 10:00

    →

    08:00, 09:00, 10:00
  */
  normalizedExpression =
    normalizedExpression.replace(
      /(\d{2}:\d{2})\s+(?=\d{2}:\d{2})/g,
      "$1, "
    );


  /*
    중복 쉼표와 불필요한 공백 정리
  */
  normalizedExpression =
    normalizedExpression
      .replace(
        /\s*,\s*/g,
        ", "
      )
      .replace(
        /\s*~\s*/g,
        "~"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  /*
    시간 표현을 제외한 실제 업무내용
  */
  const remainingContent =
    originalContent
      .slice(
        prefixMatch[0].length
      )
      .replace(
        /^[\s,/·:~～\-–—]+/,
        ""
      )
      .trim();


  return {
    times: [
      ...new Set(
        normalizedTimes
      )
    ],

    timeText:
      normalizedExpression,

    content:
      remainingContent,

    matchedText:
      prefixMatch[0]
  };
}

/* =========================================================
  신규 업무 내용 앞 시간 분석

  공통 시간 분석 함수를 사용하여
  다중 시간과 시간 범위를 모두 지원한다.
========================================================= */

function extractTimesFromLogEntryContent(
  rawContent
) {
  return parseLeadingLogTimeExpression(
    rawContent
  );
}


/*
  현재시간 체크 또는 내용 앞 시간을 기준으로
  최종 저장 시간과 내용을 결정한다.
*/
function resolveLogEntryTimeAndContent() {
  const rawContent =
    String(
      elements.logEntryContent
        ?.value ||
      ""
    ).trim();


  const parsedContent =
    extractTimesFromLogEntryContent(
      rawContent
    );


  const currentTimeValue =
    String(
      elements.logEntryTime
        ?.value ||
      ""
    ).trim();


  /*
    내용 앞에 시간이 있다면
    내용에 적은 시간을 가장 우선한다.
  */
  if (
    parsedContent.timeText
  ) {
    if (
      elements.logEntryTime
    ) {
      elements.logEntryTime.value =
        parsedContent.timeText;
    }

    if (
      elements
        .useCurrentTimeCheckbox
    ) {
      elements
        .useCurrentTimeCheckbox
        .checked =
        false;
    }

    return {
      time:
        parsedContent.timeText,

      content:
        parsedContent.content
    };
  }


  /*
    내용 앞 시간은 없고
    현재시간 체크만 한 경우
  */
  if (
    currentTimeValue
  ) {
    return {
      time:
        currentTimeValue,

      content:
        rawContent
    };
  }


  /*
    시간 없이 저장하는 경우
  */
  return {
    time: "",
    content:
      rawContent
  };
}

/* =========================================================
  작업내역 Enter 추가 확인

  내용 입력창에서 Enter를 누르면:
  1. 기본 줄바꿈을 막는다.
  2. 추가 여부를 확인한다.
  3. 확인을 누르면 작업내역을 추가한다.

  Shift + Enter:
  줄바꿈 입력
========================================================= */

function confirmAndAddLogEntry() {
  const rawContent =
    String(
      elements.logEntryContent
        ?.value ||
      ""
    ).trim();


  if (!rawContent) {
    showToast(
      "작업 내용을 입력해 주세요."
    );

    elements.logEntryContent
      ?.focus();

    return;
  }


  const isEditing =
    appState.editingEntryIndex >= 0;


  const confirmMessage =
    isEditing
      ? "내역을 수정하시겠습니까?"
      : "내역을 추가하시겠습니까?";


  const shouldContinue =
    window.confirm(
      confirmMessage
    );


  if (!shouldContinue) {
    elements.logEntryContent
      ?.focus();

    return;
  }


  addOrUpdateLogEntry();
}

function addOrUpdateLogEntry() {
  const category =
    String(
      elements.logEntryCategory
        ?.value ||
      "인계사항"
    ).trim();


  const needsTag =
    category.startsWith(
      "TM"
    ) ||
    category.startsWith(
      "BM"
    ) ||
    category.startsWith(
      "CM"
    );


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


  /*
    내용 앞의 시간을 자동 분석한다.

    예:
    08:00 설비 점검
    → time: 08:00
    → content: 설비 점검

    0800 1000 설비 점검
    → time: 08:00, 10:00
    → content: 설비 점검
  */
  const resolvedInput =
    resolveLogEntryTimeAndContent();


  const normalizedTime =
    String(
      resolvedInput.time ||
      ""
    ).trim();


  const content =
    String(
      resolvedInput.content ||
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
    /*
      시간만 입력하고 실제 내용이 없는 경우
    */
    if (
      normalizedTime
    ) {
      showToast(
        "시간 뒤에 작업 내용을 입력해 주세요."
      );
    } else {
      showToast(
        "작업 내용을 입력해 주세요."
      );
    }

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
      : Number(
          rawSourceIndex
        );


  /*
    기존 가져오기 출처 데이터를 유지한다.

    파트장이 팀원 업무일지를 가져온 뒤
    항목을 수정해도 출처 보직 정보가 사라지지 않는다.
  */
  const entry = {
    time:
      normalizedTime,

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
      normalizedTime
        ? `${normalizedTime} 작업 내역을 추가했습니다.`
        : "시간 없이 작업 내역을 추가했습니다."
    );
  }


  sortImportedLogEntries();

  renderLogEntryTable();


  resetLogEntryInput({
    keepCategory:
      false,

    keepTag:
      false
  });


  updateMemberLogImportStatus();


  elements.logEntryContent
    ?.focus();
}

/* =========================================================
  업무 항목 TAG 버튼 생성
========================================================= */

function createTagHtml(
  entry,
  originalIndex
) {
  const tagText =
    String(
      entry?.tag || ""
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
}

/* =========================================================
  인수인계사항 목록 렌더링 최종본

  핵심 변경:
  1. 보직 표시는 [TGO 업무일지] 한 개만 표시
  2. 데이터 행은 항상 TD 한 개만 생성
  3. 선택·내용·관리 버튼은 TD 내부 GRID로 배치
  4. 편집 전후 테이블 열 구조가 변하지 않음
  5. 보직별 전체 선택 유지
========================================================= */

function renderLogEntryTable() {
  const entries =
    Array.isArray(
      appState.editorEntries
    )
      ? appState.editorEntries
      : [];


  const isEditMode =
    Boolean(
      elements.logEntryListPanel
        ?.classList.contains(
          "is-edit-mode"
        )
    );


  const currentRole =
    normalizeMemberLogRole(
      elements.logRole?.value
    );


  const isLeaderLog =
    currentRole ===
    "파트장";


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
    현재 테이블의 실제 열 개수 확인

    HTML에서 열 개수가 달라져도
    데이터 행은 전체 열을 정확히 합친다.
  ====================================================== */

  const getTableColumnCount = (
    tableBody,
    defaultCount = 4
  ) => {
    const table =
      tableBody?.closest(
        "table"
      );


    const headerCells =
      table?.querySelectorAll(
        "thead tr:last-child th"
      );


    const count =
      Number(
        headerCells?.length ||
        0
      );


    return count > 0
      ? count
      : defaultCount;
  };


  const tmColumnCount =
    getTableColumnCount(
      elements.tmIssueEntryTableBody,
      4
    );


  const handoverColumnCount =
    getTableColumnCount(
      elements.logEntryTableBody,
      4
    );


  /* =====================================================
    시간순 정렬
  ====================================================== */

  const sortEntries = (
    itemA,
    itemB
  ) => {
    const timeA =
      String(
        itemA.entry?.time ||
        ""
      ).trim();


    const timeB =
      String(
        itemB.entry?.time ||
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
      const timeDifference =
        timeA.localeCompare(
          timeB
        );


      if (
        timeDifference !==
        0
      ) {
        return timeDifference;
      }
    }


    return (
      itemA.originalIndex -
      itemB.originalIndex
    );
  };


  /* =====================================================
    TM / 일반 업무 분리
  ====================================================== */

  const tmEntries =
    indexedEntries
      .filter(
        ({
          entry
        }) => {
          return (
            String(
              entry?.category ||
              ""
            ).trim() ===
            "TM 발행"
          );
        }
      )
      .sort(
        sortEntries
      );


  const ordinaryEntries =
    indexedEntries.filter(
      ({
        entry
      }) => {
        return (
          String(
            entry?.category ||
            ""
          ).trim() !==
          "TM 발행"
        );
      }
    );


  /* =====================================================
    건수 및 저장용 값
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
      `${tmEntries.length}건`;
  }


  if (
    elements.handoverEntryCount
  ) {
    elements.handoverEntryCount.textContent =
      `${ordinaryEntries.length}건`;
  }


  if (
    elements.logEntriesJson
  ) {
    elements.logEntriesJson.value =
      JSON.stringify(
        entries
      );
  }


  /* =====================================================
    한 항목 행 생성

    실제 테이블에는 TD 하나만 생성한다.

    TD 내부:
    체크박스 | 내용 | 수정·삭제
  ====================================================== */

  const createEntryRowHtml = (
    item,
    displayNumber,
    options = {}
  ) => {
    const {
      showTime = true,
      sourceRole = "",
      columnCount = 4
    } = options;


    const {
      entry,
      originalIndex
    } = item;


    const normalizedSourceRole =
      normalizeMemberLogRole(
        sourceRole
      );


    const isEditingEntry =
      originalIndex ===
      appState.editingEntryIndex;


    return `
      <tr
        data-entry-index="${originalIndex}"
        data-entry-source-role="${escapeHtml(
          normalizedSourceRole
        )}"
        class="${
          isEditingEntry
            ? "is-editing"
            : ""
        }"
      >

        <td
          colspan="${columnCount}"
          class="log-entry-unified-cell"
          style="
            width:100% !important;
            min-width:0 !important;

            padding:0 !important;

            text-align:left !important;
            vertical-align:top !important;
          "
        >

          <div
            class="log-entry-row-shell"
            data-entry-row-shell
            style="
              display:grid !important;

              width:100% !important;
              min-width:0 !important;

              grid-template-columns:${
                isEditMode
                  ? "32px minmax(0, 1fr) 78px"
                  : "minmax(0, 1fr)"
              } !important;

              align-items:start !important;

              column-gap:6px !important;

              margin:0 !important;
              padding:7px 10px !important;
            "
          >

            <div
              class="log-entry-row-select"
              ${
                isEditMode
                  ? ""
                  : "hidden"
              }
              style="
                width:32px !important;
                min-width:32px !important;

                padding-top:1px !important;

                text-align:center !important;
              "
            >
              <input
                type="checkbox"
                class="log-entry-select-checkbox"
                data-entry-select-index="${originalIndex}"
                data-source-role="${escapeHtml(
                  normalizedSourceRole
                )}"
                aria-label="업무 항목 선택"
              />
            </div>


            <div
              class="log-entry-row-content"
              style="
                width:100% !important;
                min-width:0 !important;

                margin:0 !important;
                padding:0 !important;

                text-align:left !important;
              "
            >
              ${createCompactLineHtml(
                entry,
                originalIndex,
                displayNumber,
                {
                  showTime
                }
              )}
            </div>


            <div
              class="log-entry-row-actions"
              ${
                isEditMode
                  ? ""
                  : "hidden"
              }
              style="
                display:flex;

                width:78px !important;
                min-width:78px !important;

                align-items:center !important;
                justify-content:flex-end !important;

                gap:4px !important;
              "
            >
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

          </div>

        </td>

      </tr>
    `;
  };


  /* =====================================================
    TM 발행 내역 출력
  ====================================================== */

  if (
    elements.tmIssueEntryTableBody
  ) {
    if (
      !tmEntries.length
    ) {
      elements
        .tmIssueEntryTableBody
        .innerHTML = `
          <tr class="log-entry-empty-row">
            <td colspan="${tmColumnCount}">
              등록된 TM 발행 내역이 없습니다.
            </td>
          </tr>
        `;

    } else {
      elements
        .tmIssueEntryTableBody
        .innerHTML =
        tmEntries
          .map(
            (
              item,
              index
            ) => {
              const sourceRole =
                normalizeMemberLogRole(
                  item.entry
                    ?.importedFromRole ||
                  currentRole ||
                  "파트장"
                );


              return createEntryRowHtml(
                item,
                index + 1,
                {
                  showTime:
                    false,

                  sourceRole,

                  columnCount:
                    tmColumnCount
                }
              );
            }
          )
          .join("");
    }
  }


  /* =====================================================
    일반 업무 보직별 묶기
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
    (item) => {
      const sourceRole =
        normalizeMemberLogRole(
          item.entry
            ?.importedFromRole ||
          currentRole ||
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


  Object.keys(
    groupedEntries
  ).forEach(
    (role) => {
      groupedEntries[
        role
      ].sort(
        sortEntries
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
    인계사항 출력
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
            <td colspan="${handoverColumnCount}">
              등록된 인계사항이 없습니다.
            </td>
          </tr>
        `;

    } else if (
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
                  data-role-group="${escapeHtml(
                    role
                  )}"
                >
                  <td
                    colspan="${handoverColumnCount}"
                    style="
                      width:100% !important;
                      padding:0 !important;
                    "
                  >

                    <div
                      class="log-entry-role-divider"
                      style="
                        display:flex !important;

                        width:100% !important;

                        align-items:center !important;

                        gap:6px !important;

                        padding:7px 10px !important;
                      "
                    >

                      <label
                        class="log-entry-role-select"
                        ${
                          isEditMode
                            ? ""
                            : "hidden"
                        }
                        title="${escapeHtml(
                          role
                        )} 업무 전체 선택"
                        style="
                          display:${
                            isEditMode
                              ? "inline-flex"
                              : "none"
                          } !important;

                          width:18px !important;
                          height:18px !important;

                          align-items:center !important;
                          justify-content:center !important;
                        "
                      >
                        <input
                          type="checkbox"
                          class="log-entry-role-select-checkbox"
                          data-role-select="${escapeHtml(
                            role
                          )}"
                          aria-label="${escapeHtml(
                            role
                          )} 업무 전체 선택"
                        />
                      </label>


                      <!--
                        보직명과 업무일지를 하나의 배지로 표시

                        기존:
                        [TGO] TGO 업무일지

                        변경:
                        [TGO 업무일지]
                      -->
                      <span
                        class="
                          log-entry-role-divider__badge
                          ${getLogEntrySourceClass(
                            role
                          )}
                        "
                      >
                        ${escapeHtml(
                          role
                        )} 업무일지
                      </span>


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
                        index + 1,
                        {
                          showTime:
                            true,

                          sourceRole:
                            role,

                          columnCount:
                            handoverColumnCount
                        }
                      );
                    }
                  )
                  .join("")}
              `;
            }
          )
          .join("");

    } else {
      const sortedEntries = [
        ...ordinaryEntries
      ].sort(
        sortEntries
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
                index + 1,
                {
                  showTime:
                    true,

                  sourceRole:
                    currentRole,

                  columnCount:
                    handoverColumnCount
                }
              );
            }
          )
          .join("");
    }
  }


  /* =====================================================
    전체 선택 초기 상태
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
      tmEntries.length ===
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
    elements.deleteSelectedLogEntriesButton
  ) {
    elements
      .deleteSelectedLogEntriesButton
      .disabled =
      true;
  }


  updateMemberLogImportCount();
}

/* =====================================================
  인수인계 한 줄 출력

  인계사항:
  1. 07:15 내용
  2. 07:15, 10:55 내용

  시간 없는 인계사항:
  1. 내용

  TM 발행:
  1. 내용

  중요:
  템플릿 문자열 내부 공백이 화면에 출력되지 않도록
  시간과 내용을 하나의 연속된 HTML 문자열로 만든다.
===================================================== */

const createCompactLineHtml = (
  entry,
  originalIndex,
  displayNumber,
  options = {}
) => {
  const {
    showTime = true
  } = options;


  const timeText =
    String(
      entry.time || ""
    )
      .trim()
      .replace(
        /\s*,\s*/g,
        ", "
      );


  const contentText =
    String(
      entry.content || "-"
    ).trim();


  const hasTime =
    showTime &&
    Boolean(
      timeText
    );


  const timeHtml =
    hasTime
      ? `<strong class="log-entry-document-time">${escapeHtml(
          timeText
        )}</strong>`
      : "";


  const contentHtml =
    `<span class="log-entry-document-content-text">${escapeHtml(
      contentText
    )}</span>`;


  const tagHtml =
    createTagHtml(
      entry,
      originalIndex
    );


  /*
    timeHtml + contentHtml 사이에는
    CSS margin으로만 간격을 준다.

    템플릿 문자열의 줄바꿈·들여쓰기를
    실제 출력 공백으로 사용하지 않는다.
  */
  const bodyHtml =
    `${timeHtml}${contentHtml}${tagHtml}`;


  return `
    <div class="log-entry-document-line">

      <strong class="log-entry-document-number">
        ${displayNumber}.
      </strong>

      <div class="log-entry-document-body">${bodyHtml}</div>

    </div>
  `;
};

/* =========================================================
  인수인계사항 편집 모드 최종본

  테이블 TD를 숨기거나 다시 표시하지 않는다.

  각 행 내부 GRID만 변경한다.

  일반:
  내용

  편집:
  체크 | 내용 | 수정·삭제
========================================================= */

function setLogEntryEditMode(
  isEditing
) {
  const panel =
    elements.logEntryListPanel;


  if (
    panel
  ) {
    panel.classList.toggle(
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


    if (
      !isEditing
    ) {
      elements
        .deleteSelectedLogEntriesButton
        .disabled =
        true;
    }
  }


  /* =====================================================
    각 업무 행 내부 구조만 변경
  ====================================================== */

  panel
    ?.querySelectorAll(
      ".log-entry-row-shell"
    )
    .forEach(
      (rowShell) => {
        rowShell.style
          .setProperty(
            "grid-template-columns",

            isEditing
              ? "32px minmax(0, 1fr) 78px"
              : "minmax(0, 1fr)",

            "important"
          );


        const selectArea =
          rowShell.querySelector(
            ".log-entry-row-select"
          );


        const actionArea =
          rowShell.querySelector(
            ".log-entry-row-actions"
          );


        if (
          selectArea
        ) {
          selectArea.hidden =
            !isEditing;
        }


        if (
          actionArea
        ) {
          actionArea.hidden =
            !isEditing;

          actionArea.style
            .setProperty(
              "display",

              isEditing
                ? "flex"
                : "none",

              "important"
            );
        }
      }
    );


  /* =====================================================
    보직별 전체 체크박스 표시
  ====================================================== */

  panel
    ?.querySelectorAll(
      ".log-entry-role-select"
    )
    .forEach(
      (roleSelect) => {
        roleSelect.hidden =
          !isEditing;


        roleSelect.style
          .setProperty(
            "display",

            isEditing
              ? "inline-flex"
              : "none",

            "important"
          );
      }
    );


  if (
    !isEditing
  ) {
    clearLogEntrySelections();


    if (
      appState.editingEntryIndex >=
      0
    ) {
      cancelLogEntryEdit();
    }
  }


  updateLogEntrySelectionState();
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
  선택 상태 갱신

  - TM 전체 선택
  - 인계사항 전체 선택
  - 보직별 전체 선택
  - 선택 건수
  - 선택 항목 삭제 버튼
========================================================= */

function updateLogEntrySelectionState() {
  const itemCheckboxes = [
    ...document.querySelectorAll(
      "#tmIssueEntryTableBody " +
      ".log-entry-select-checkbox, " +

      "#logEntryTableBody " +
      ".log-entry-select-checkbox"
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


  /* =====================================================
    선택 건수 및 삭제 버튼
  ====================================================== */

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


  /* =====================================================
    TM 전체 선택 상태
  ====================================================== */

  const tmCheckboxes = [
    ...elements.tmIssueEntryTableBody
      ?.querySelectorAll(
        ".log-entry-select-checkbox"
      ) ||
    []
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


  /* =====================================================
    인계사항 전체 선택 상태
  ====================================================== */

  const handoverCheckboxes = [
    ...elements.logEntryTableBody
      ?.querySelectorAll(
        ".log-entry-select-checkbox"
      ) ||
    []
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
      handoverCheckboxes.length >
        0 &&
      selectedHandoverCount ===
        handoverCheckboxes.length;

    elements
      .selectAllLogEntriesCheckbox
      .indeterminate =
      selectedHandoverCount >
        0 &&
      selectedHandoverCount <
        handoverCheckboxes.length;

    elements
      .selectAllLogEntriesCheckbox
      .disabled =
      handoverCheckboxes.length ===
      0;
  }


  /* =====================================================
    보직별 전체 선택 상태
  ====================================================== */

  elements.logEntryTableBody
    ?.querySelectorAll(
      ".log-entry-role-select-checkbox"
    )
    .forEach(
      (roleCheckbox) => {
        const role =
          normalizeMemberLogRole(
            roleCheckbox.dataset
              .roleSelect
          );


        const roleItemCheckboxes = [
          ...elements.logEntryTableBody
            .querySelectorAll(
              ".log-entry-select-checkbox"
            )
        ].filter(
          (checkbox) => {
            return (
              normalizeMemberLogRole(
                checkbox.dataset
                  .sourceRole
              ) ===
              role
            );
          }
        );


        const selectedRoleCount =
          roleItemCheckboxes.filter(
            (checkbox) => {
              return checkbox.checked;
            }
          ).length;


        roleCheckbox.checked =
          roleItemCheckboxes.length >
            0 &&
          selectedRoleCount ===
            roleItemCheckboxes.length;


        roleCheckbox.indeterminate =
          selectedRoleCount >
            0 &&
          selectedRoleCount <
            roleItemCheckboxes.length;


        roleCheckbox.disabled =
          roleItemCheckboxes.length ===
          0;
      }
    );
}

/* =========================================================
  인수인계사항 편집 모드 이벤트
========================================================= */

function bindLogEntryEditModeEvents() {
  /* =====================================================
    편집 모드 시작·종료
  ====================================================== */

  elements.openLogEntryEditModeButton
    ?.addEventListener(
      "click",
      () => {
        setLogEntryEditMode(
          true
        );
      }
    );


  elements.cancelLogEntryEditModeButton
    ?.addEventListener(
      "click",
      () => {
        setLogEntryEditMode(
          false
        );
      }
    );


  /* =====================================================
    TM 목록 버튼 및 개별 체크
  ====================================================== */

  elements.tmIssueEntryTableBody
    ?.addEventListener(
      "click",
      handleLogEntryTableClick
    );


  elements.tmIssueEntryTableBody
    ?.addEventListener(
      "change",
      (event) => {
        if (
          !event.target.closest(
            ".log-entry-select-checkbox"
          )
        ) {
          return;
        }


        updateLogEntrySelectionState();
      }
    );


  /* =====================================================
    인계사항 개별 체크 및 보직별 전체 체크
  ====================================================== */

  elements.logEntryTableBody
    ?.addEventListener(
      "change",
      (event) => {
        const roleCheckbox =
          event.target.closest(
            ".log-entry-role-select-checkbox"
          );


        /*
          보직 전체 체크
        */
        if (
          roleCheckbox
        ) {
          const role =
            normalizeMemberLogRole(
              roleCheckbox.dataset
                .roleSelect
            );


          const shouldSelect =
            roleCheckbox.checked;


          elements.logEntryTableBody
            .querySelectorAll(
              ".log-entry-select-checkbox"
            )
            .forEach(
              (checkbox) => {
                if (
                  normalizeMemberLogRole(
                    checkbox.dataset
                      .sourceRole
                  ) !==
                  role
                ) {
                  return;
                }


                checkbox.checked =
                  shouldSelect;
              }
            );


          updateLogEntrySelectionState();

          return;
        }


        /*
          개별 항목 체크
        */
        if (
          event.target.closest(
            ".log-entry-select-checkbox"
          )
        ) {
          updateLogEntrySelectionState();
        }
      }
    );


  /* =====================================================
    TM 전체 선택
  ====================================================== */

  elements.selectAllTmEntriesCheckbox
    ?.addEventListener(
      "change",
      () => {
        const shouldSelect =
          elements
            .selectAllTmEntriesCheckbox
            .checked;


        elements.tmIssueEntryTableBody
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


  /* =====================================================
    인계사항 전체 선택
  ====================================================== */

  elements.selectAllLogEntriesCheckbox
    ?.addEventListener(
      "change",
      () => {
        const shouldSelect =
          elements
            .selectAllLogEntriesCheckbox
            .checked;


        elements.logEntryTableBody
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


  /* =====================================================
    선택 항목 일괄 삭제

    기존 bindEvents()의 삭제 이벤트보다 먼저 실행해서
    중복 처리를 차단한다.
  ====================================================== */

  elements.deleteSelectedLogEntriesButton
    ?.addEventListener(
      "click",
      (event) => {
        event.preventDefault();

        event.stopImmediatePropagation();


        const selectedIndexes = [
          ...document.querySelectorAll(
            "#tmIssueEntryTableBody " +
            ".log-entry-select-checkbox:checked, " +

            "#logEntryTableBody " +
            ".log-entry-select-checkbox:checked"
          )
        ]
          .map(
            (checkbox) => {
              return Number(
                checkbox.dataset
                  .entrySelectIndex
              );
            }
          )
          .filter(
            (index) => {
              return (
                Number.isInteger(
                  index
                ) &&
                Boolean(
                  appState.editorEntries[
                    index
                  ]
                )
              );
            }
          );


        const uniqueIndexes = [
          ...new Set(
            selectedIndexes
          )
        ];


        if (
          !uniqueIndexes.length
        ) {
          showToast(
            "삭제할 항목을 선택해 주세요."
          );

          return;
        }


        const shouldDelete =
          window.confirm(
            `선택한 항목 ${uniqueIndexes.length}건을 삭제하시겠습니까?`
          );


        if (
          !shouldDelete
        ) {
          return;
        }


        /*
          큰 인덱스부터 삭제한다.
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
          .forEach(
            (index) => {
              appState.editorEntries
                .splice(
                  index,
                  1
                );
            }
          );


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
          삭제 후에도 편집 모드 유지
        */
        setLogEntryEditMode(
          true
        );


        updateMemberLogImportStatus();


        showToast(
          `선택한 항목 ${uniqueIndexes.length}건을 삭제했습니다.`
        );
      },
      true
    );
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


function saveCurrentLog(
  status,
  options = {}
) {
  const {
    closeAfterSave = true
  } = options;

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

  if (
   closeAfterSave
  ) {
   closeLogEditor();
  }

  showToast(
    status === "작성완료"
      ? "업무일지 작성을 완료하고 결재를 요청했습니다."
      : "업무일지를 작성 중 상태로 저장했습니다."
  );
}


/* =========================================================
  업무일지 임시저장

  저장만 수행하고 수정창은 닫지 않는다.
========================================================= */

function saveDraft() {
  if (
    !elements.logEditorForm ||
    !elements.logEditorForm.reportValidity()
  ) {
    return;
  }


  const hasEntryContent =
    appState.editorEntries.some(
      (entry) => {
        return Boolean(
          String(
            entry.content || ""
          ).trim()
        );
      }
    );


  const hasOperationStatus =
    Boolean(
      String(
        elements.operationStatusSnapshot
          ?.value ||
        elements.operationStatus
          ?.value ||
        appState.currentOperationStatus
          ?.content ||
        ""
      ).trim()
    );


  const hasNote =
    Boolean(
      String(
        elements.logNote
          ?.value ||
        ""
      ).trim()
    );


  if (
    !hasEntryContent &&
    !hasOperationStatus &&
    !hasNote
  ) {
    showToast(
      "운전 현황 또는 업무 내용을 입력해 주세요."
    );

    return;
  }


  saveCurrentLog(
    "작성중",
    {
      closeAfterSave:
        false
    }
  );
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

/* =========================================================
  업무일지 메인 목록 한 행 생성 최종본

  색상 기준:
  - TM 발행 번호: 주황색
  - 인계사항 번호: 파란색
  - 모든 시간: 파란색
  - 실제 내용: 기존 진한 본문색
========================================================= */

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

    일반 보직:
    TGO·BCO1·BCO2·TO·BO1·BO2는
    업무일지 목록에서 운전현황을 표시하지 않는다.

    파트장:
    저장된 운전현황 전체 내용을
    줄별로 모두 표시한다.
  ====================================================== */

  if (
    isLeaderLog
  ) {
    const operationStatusLines =
      String(
        log.operationStatus ||
        ""
      )
        .replace(
          /\r\n/g,
          "\n"
        )
        .replace(
          /\r/g,
          "\n"
        )
        .split(
          "\n"
        )
        .map(
          (line) => {
            return String(
              line || ""
            ).trim();
          }
        )
        .filter(Boolean);


    operationStatusLines.forEach(
      (
        line,
        index
      ) => {
        previewGroups.push({
          type:
            "normal",

          title:
            index === 0
              ? "운전현황"
              : "",

          number:
            `${index + 1}.`,

          time:
            "",

          content:
            line,

          tag:
            "",

          numberClass:
            "is-handover-number",

          categoryClass: [
            "is-operation",

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
      entries.filter(
        (entry) => {
          return (
            String(
              entry.category ||
              ""
            ).trim() ===
            "TM 발행"
          );
        }
      )
    );


  tmEntries.forEach(
    (
      entry,
      index
    ) => {
      const tagText =
        String(
          entry.tag ||
          ""
        )
          .trim()
          .toUpperCase();


      const timeText =
        String(
          entry.time ||
          ""
        ).trim();


      const contentText =
        firstMeaningfulLine(
          entry.content
        ) ||
        "-";


      previewGroups.push({
        type:
          "normal",

        title:
          index === 0
            ? "TM 발행 내역"
            : "",

        /*
          TM 번호는 주황색
        */
        number:
          `${index + 1}.`,

        numberClass:
          "is-tm-number",

        /*
          시간이 있는 TM은 파란색 시간으로 표시
        */
        time:
          timeText,

        content:
          contentText,

        tag:
          tagText
            ? `[${tagText}]`
            : "",

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
    entries.filter(
      (entry) => {
        return (
          String(
            entry.category ||
            ""
          ).trim() !==
          "TM 발행"
        );
      }
    );


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
        파트장 업무일지는
        TGO → BCO1 → BCO2 순서로
        보직 제목을 표시한다.
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
              entry.tag ||
              ""
            )
              .trim()
              .toUpperCase();


          const timeText =
            String(
              entry.time ||
              ""
            ).trim();


          const contentText =
            firstMeaningfulLine(
              entry.content
            ) ||
            "-";


          previewGroups.push({
            type:
              "normal",

            title:
              !isLeaderLog &&
              index === 0
                ? "인계 사항"
                : "",

            /*
              인계 번호는 파란색
            */
            number:
              `${index + 1}.`,

            numberClass:
              "is-handover-number",

            /*
              시간도 파란색
            */
            time:
              timeText,

            content:
              contentText,

            tag:
              tagText
                ? `[${tagText}]`
                : "",

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
      log.note ||
      ""
    ).trim()
  ) {
    previewGroups.push({
      type:
        "normal",

      title:
        "비고",

      number:
        "",

      numberClass:
        "",

      time:
        "",

      content:
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
          log.role ||
          "-"
        )}
      </td>


      <td class="log-row__author-cell">

        <div class="log-row__author-wrap">

          <strong class="log-row__author">
            ${escapeHtml(
              log.author ||
              "-"
            )}
          </strong>

          ${
            log.isSubstitute ===
            true
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
            log.status ||
            "-"
          )}
        </span>

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
                  .map(
                    (group) => {

                      /*
                        파트장 보직별 제목
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
                        일반 업무내용

                        표시 순서:
                        번호 → 시간 → 내용 → TAG
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

                            ${
                              group.number
                                ? `
                                  <span
                                    class="
                                      log-preview__entry-number
                                      ${group.numberClass || ""}
                                    "
                                  >
                                    ${escapeHtml(
                                      group.number
                                    )}
                                  </span>
                                `
                                : ""
                            }


                            ${
                              group.time
                                ? `
                                  <span
                                    class="log-preview__entry-time"
                                  >
                                    ${escapeHtml(
                                      group.time
                                    )}
                                  </span>
                                `
                                : ""
                            }


                            <span
                              class="log-preview__text"
                            >
                              ${escapeHtml(
                                group.content ||
                                "-"
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
                    }
                  )
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


      <td class="log-row__attachment-cell">

        ${
          attachmentCount >
          0
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

/* =========================================================
  업무일지 상세보기 최종본

  핵심 구조

  운전현황
  1. #1 주보일러 : 정상운전 중

  TM 발행
  1. TM 내용

  인계사항
  1. 08:37~09:46 업무 내용

  번호·시간·내용을 별도 칸으로 나누지 않고
  하나의 문장 줄 안에 연속해서 표시한다.
========================================================= */

function openLogDetail(
  log
) {
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
    String(
      log.id ||
      ""
    ).trim();


  /* =====================================================
    기본 정보
  ====================================================== */

  const dateText =
    String(
      log.date ||
      "-"
    ).trim();


  const shiftText =
    getShiftDisplayName(
      log.shift
    );


  const teamText =
    normalizeTeamName(
      log.team ||
      "-"
    );


  const roleText =
    String(
      log.role ||
      "-"
    ).trim();


  const authorText =
    String(
      log.author ||
      "-"
    ).trim();


  const statusText =
    String(
      log.status ||
      "-"
    ).trim();


  const isSubstitute =
    log.isSubstitute ===
    true;


  const normalizedRole =
    normalizeMemberLogRole(
      log.role
    );


  const isLeaderLog =
    normalizedRole ===
    "파트장";


  const detailStatusClass =
    getStatusClass(
      statusText
    );


  /* =====================================================
    기존 업무내역 시간 재분석
  ====================================================== */

  const entries =
    normalizeExistingLogEntries(
      Array.isArray(
        log.entries
      )
        ? log.entries
        : []
    );


  log.entries =
    entries.map(
      (entry) => {
        return {
          ...entry
        };
      }
    );


  /* =====================================================
    상세 업무 한 줄 생성

    결과 예시

    1. TM 내용
    1. 08:37~09:46 업무 내용
  ====================================================== */

  function createDetailWorkRowHtml(
    entry,
    index,
    options = {}
  ) {
    const {
      numberType =
        "handover"
    } = options;


    const timeText =
      String(
        entry?.time ||
        ""
      ).trim();


    const tagText =
      String(
        entry?.tag ||
        ""
      )
        .trim()
        .toUpperCase();


    const contentText =
      String(
        entry?.content ||
        "-"
      )
        .replace(
          /\r\n/g,
          "\n"
        )
        .replace(
          /\r/g,
          "\n"
        )
        .trim();


    const contentLines =
      contentText
        .split(
          "\n"
        )
        .map(
          (line) => {
            return line.trim();
          }
        )
        .filter(Boolean);


    const firstLine =
      contentLines.shift() ||
      "-";


    const continuationHtml =
      contentLines.length
        ? `
          <span
            class="detail-work-row__continuation"
          >
            ${contentLines
              .map(
                (line) => {
                  return escapeHtml(
                    line
                  );
                }
              )
              .join("<br>")}
          </span>
        `
        : "";


    return `
      <div
        class="
          detail-work-row
          detail-work-row--${escapeHtml(
            numberType
          )}
        "
      >

        <span
          class="
            detail-work-row__number
            is-${escapeHtml(
              numberType
            )}
          "
        >
          ${index + 1}.
        </span>


        <span
          class="detail-work-row__main"
        >

          ${
            timeText
              ? `
                <span
                  class="detail-work-row__time"
                >
                  ${escapeHtml(
                    timeText
                  )}
                </span>
              `
              : ""
          }


          ${
            tagText
              ? `
                <button
                  type="button"
                  class="detail-work-row__tag"
                  data-detail-tag="${escapeHtml(
                    tagText
                  )}"
                >
                  [${escapeHtml(
                    tagText
                  )}]
                </button>
              `
              : ""
          }


          <span
            class="detail-work-row__text"
          >
            ${escapeHtml(
              firstLine
            )}
          </span>


          ${continuationHtml}

        </span>

      </div>
    `;
  }


  /* =====================================================
    운전현황

    각 줄의 앞뒤 공백과 기존 수기 번호를 정리하고
    1번부터 다시 번호를 표시한다.
  ====================================================== */

  const operationStatusLines =
    String(
      log.operationStatus ||
      ""
    )
      .replace(
        /\r\n/g,
        "\n"
      )
      .replace(
        /\r/g,
        "\n"
      )
      .split(
        "\n"
      )
      .map(
        (line) => {
          return String(
            line || ""
          )
            .trim()
            .replace(
              /^(?:\d+\s*[.)\-:]\s*)/,
              ""
            )
            .trim();
        }
      )
      .filter(Boolean);


  const operationStatusHtml =
    operationStatusLines.length
      ? `
        <div class="detail-operation-list">

          ${operationStatusLines
            .map(
              (
                line,
                index
              ) => {
                return `
                  <div class="detail-operation-row">

                    <span
                      class="detail-operation-row__number"
                    >
                      ${index + 1}.
                    </span>

                    <span
                      class="detail-operation-row__text"
                    >
                      ${escapeHtml(
                        line
                      )}
                    </span>

                  </div>
                `;
              }
            )
            .join("")}

        </div>
      `
      : `
        <div class="detail-empty-message">
          등록된 운전현황이 없습니다.
        </div>
      `;


  /* =====================================================
    TM 발행 내역
  ====================================================== */

  const tmEntries =
    sortDetailEntriesByTime(
      entries.filter(
        (entry) => {
          return (
            String(
              entry.category ||
              ""
            ).trim() ===
            "TM 발행"
          );
        }
      )
    );


  const tmHtml =
    tmEntries.length
      ? `
        <div class="detail-work-list">

          ${tmEntries
            .map(
              (
                entry,
                index
              ) => {
                return createDetailWorkRowHtml(
                  entry,
                  index,
                  {
                    numberType:
                      "tm"
                  }
                );
              }
            )
            .join("")}

        </div>
      `
      : `
        <div class="detail-empty-message">
          등록된 TM 발행 내역이 없습니다.
        </div>
      `;


  /* =====================================================
    인계 및 작업 내역
  ====================================================== */

  const ordinaryEntries =
    entries.filter(
      (entry) => {
        return (
          String(
            entry.category ||
            ""
          ).trim() !==
          "TM 발행"
        );
      }
    );


  const detailRoleOrder = [
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
    ...detailRoleOrder.filter(
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
          !detailRoleOrder.includes(
            role
          )
        );
      }
    )
  ];


  const ordinaryEntriesHtml =
    orderedRoles.length
      ? orderedRoles
          .map(
            (role) => {
              const roleEntries =
                sortDetailEntriesByTime(
                  groupedEntries[
                    role
                  ]
                );


              const roleTitle =
                isLeaderLog
                  ? `${role} 업무일지`
                  : "인계사항";


              const roleClass =
                getLogEntrySourceClass(
                  role
                );


              return `
                <section class="detail-role-block">

                  <div
                    class="detail-role-block__heading"
                  >

                    <span
                      class="
                        detail-role-block__badge
                        ${escapeHtml(
                          roleClass
                        )}
                      "
                    >
                      ${escapeHtml(
                        roleTitle
                      )}
                    </span>


                    <span
                      class="detail-role-block__count"
                    >
                      ${roleEntries.length}건
                    </span>

                  </div>


                  <div class="detail-work-list">

                    ${roleEntries
                      .map(
                        (
                          entry,
                          index
                        ) => {
                          return createDetailWorkRowHtml(
                            entry,
                            index,
                            {
                              numberType:
                                "handover"
                            }
                          );
                        }
                      )
                      .join("")}

                  </div>

                </section>
              `;
            }
          )
          .join("")
      : `
        <div class="detail-empty-message">
          등록된 인계 및 작업 내역이 없습니다.
        </div>
      `;


  /* =====================================================
    비고
  ====================================================== */

  const noteText =
    String(
      log.note ||
      ""
    ).trim();


  const noteHtml =
    noteText
      ? `
        <div class="detail-note-content">
          ${escapeHtml(
            noteText
          )}
        </div>
      `
      : `
        <div class="detail-empty-message">
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
      ? log.attachments
      : [];


  const attachmentHtml =
    attachments.length
      ? `
        <div class="detail-attachment-list">

          ${attachments
            .map(
              (
                attachment,
                index
              ) => {
                const fileName =
                  typeof attachment ===
                  "string"
                    ? attachment
                    : String(
                        attachment?.name ||
                        `첨부파일 ${index + 1}`
                      );


                return `
                  <span class="detail-attachment-chip">
                    <span aria-hidden="true">
                      📎
                    </span>

                    ${escapeHtml(
                      fileName
                    )}
                  </span>
                `;
              }
            )
            .join("")}

        </div>
      `
      : `
        <div class="detail-empty-message">
          첨부파일이 없습니다.
        </div>
      `;


  /* =====================================================
    최종 상세 HTML
  ====================================================== */

  elements.logDetailContent.innerHTML =
    `
      <div class="shift-log-detail-document">

        <section class="shift-log-detail-summary">

          <div class="shift-log-detail-summary__header">

            <div>
              <span class="shift-log-detail-eyebrow">
                SHIFT LOG DETAIL
              </span>

              <h3>
                ${escapeHtml(
                  dateText
                )} 업무일지
              </h3>
            </div>


            <span
              class="
                status-badge
                ${escapeHtml(
                  detailStatusClass
                )}
              "
            >
              ${escapeHtml(
                statusText
              )}
            </span>

          </div>


          <div class="shift-log-detail-summary__grid">

            <div class="shift-log-detail-summary__item">
              <span>작성일</span>
              <strong>
                ${escapeHtml(
                  dateText
                )}
              </strong>
            </div>


            <div class="shift-log-detail-summary__item">
              <span>근무</span>
              <strong>
                ${escapeHtml(
                  shiftText
                )}
              </strong>
            </div>


            <div class="shift-log-detail-summary__item">
              <span>근무파트</span>
              <strong>
                ${escapeHtml(
                  teamText
                )}
              </strong>
            </div>


            <div class="shift-log-detail-summary__item">
              <span>보직</span>

              <strong>
                ${escapeHtml(
                  roleText
                )}

                ${
                  isSubstitute
                    ? `
                      <span class="detail-substitute-badge">
                        대근
                      </span>
                    `
                    : ""
                }
              </strong>
            </div>


            <div class="shift-log-detail-summary__item">
              <span>작성자</span>
              <strong>
                ${escapeHtml(
                  authorText
                )}
              </strong>
            </div>


            <div class="shift-log-detail-summary__item">
              <span>등록 내역</span>
              <strong>
                총 ${entries.length}건
              </strong>
            </div>

          </div>

        </section>


        <section class="shift-log-detail-section">

          <div class="shift-log-detail-section__header">

            <div>
              <span class="shift-log-detail-eyebrow">
                OPERATION STATUS
              </span>

              <h3>운전현황</h3>
            </div>

          </div>


          <div class="shift-log-detail-section__body">
            ${operationStatusHtml}
          </div>

        </section>


        <section class="shift-log-detail-section">

          <div class="shift-log-detail-section__header">

            <div>
              <span class="shift-log-detail-eyebrow">
                TM ISSUE
              </span>

              <h3>TM 발행 내역</h3>
            </div>


            <span class="shift-log-detail-count">
              ${tmEntries.length}건
            </span>

          </div>


          <div class="shift-log-detail-section__body">
            ${tmHtml}
          </div>

        </section>


        <section class="shift-log-detail-section">

          <div class="shift-log-detail-section__header">

            <div>
              <span class="shift-log-detail-eyebrow">
                HANDOVER
              </span>

              <h3>인계 및 작업 내역</h3>
            </div>


            <span class="shift-log-detail-count">
              ${ordinaryEntries.length}건
            </span>

          </div>


          <div
            class="
              shift-log-detail-section__body
              shift-log-detail-section__body--roles
            "
          >
            ${ordinaryEntriesHtml}
          </div>

        </section>


        <div class="shift-log-detail-bottom-grid">

          <section class="shift-log-detail-section">

            <div class="shift-log-detail-section__header">

              <div>
                <span class="shift-log-detail-eyebrow">
                  NOTE
                </span>

                <h3>비고</h3>
              </div>

            </div>


            <div class="shift-log-detail-section__body">
              ${noteHtml}
            </div>

          </section>


          <section class="shift-log-detail-section">

            <div class="shift-log-detail-section__header">

              <div>
                <span class="shift-log-detail-eyebrow">
                  ATTACHMENT
                </span>

                <h3>첨부파일</h3>
              </div>


              <span class="shift-log-detail-count">
                ${attachments.length}개
              </span>

            </div>


            <div class="shift-log-detail-section__body">
              ${attachmentHtml}
            </div>

          </section>

        </div>

      </div>
    `;


  /* =====================================================
    TAG 이동 이벤트
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


  /* =====================================================
    결재확인 버튼
  ====================================================== */

  if (
    elements.approveFromDetailButton
  ) {
    elements.approveFromDetailButton.hidden =
      statusText !==
      "작성완료";
  }


  /* =====================================================
    수정 버튼
  ====================================================== */

  if (
    elements.editFromDetailButton
  ) {
    elements.editFromDetailButton.hidden =
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
  조회용 업무일지 중복 제거

  우선순위:
  1. 업무일지 고유 ID
  2. 날짜 + 근무 + 보직 + 작성자 + 출처

  조회 기간의 과거 데이터를 다시 불러오더라도
  같은 업무일지가 두 번 표시되지 않게 한다.
========================================================= */

function removeDuplicateSearchLogs(
  logs
) {
  const sourceLogs =
    Array.isArray(
      logs
    )
      ? logs
      : [];


  const uniqueLogMap =
    new Map();


  sourceLogs.forEach(
    (
      log,
      logIndex
    ) => {
      if (
        !log ||
        typeof log !==
          "object"
      ) {
        return;
      }


      const logId =
        String(
          log.id ||
          ""
        ).trim();


      const uniqueKey =
        logId
          ? `ID||${logId}`
          : [
              "LOG",
              String(
                log.date ||
                ""
              ).trim(),
              String(
                log.shift ||
                ""
              ).trim(),
              normalizeMemberLogRole(
                log.role
              ),
              String(
                log.author ||
                ""
              ).trim(),
              String(
                log.source ||
                ""
              ).trim(),
              logIndex
            ].join("||");


      /*
        동일한 ID가 다시 들어오면
        마지막으로 불러온 데이터를 사용한다.
      */
      uniqueLogMap.set(
        uniqueKey,
        log
      );
    }
  );


  return [
    ...uniqueLogMap.values()
  ];
}

/* =========================================================
  조회 결과에 표시 중인 업무일지

  과거 조회 데이터는 appState.logs에 없을 수 있으므로
  조회 결과 배열 자체를 별도로 보관한다.
========================================================= */

let currentSearchResultLogs = [];


/* =========================================================
  업무일지 전체 검색 문자열 생성

  검색 대상:
  - 날짜
  - 근무
  - 보직
  - 작성자
  - 운전현황
  - TM·인계사항의 구분
  - 시간
  - TAG
  - 업무내용
  - 비고
========================================================= */

function createSearchLogText(
  log
) {
  const entries =
    Array.isArray(
      log?.entries
    )
      ? log.entries
      : [];


  const entryText =
    entries
      .map(
        (entry) => {
          return [
            entry?.category,
            entry?.time,
            entry?.tag,
            entry?.content
          ]
            .filter(Boolean)
            .join(" ");
        }
      )
      .join(" ");


  return [
    log?.date,
    log?.shift,
    log?.team,
    log?.role,
    log?.author,
    log?.status,
    log?.operationStatus,
    entryText,
    log?.note
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}


/* =========================================================
  조회 구분 정규화

  HTML select 값:
  operation
  tm
  bm
  cm
  handover
  note
========================================================= */

function getSearchEntryCategoryValue(
  entry
) {
  const category =
    String(
      entry?.category ||
      ""
    )
      .trim()
      .toUpperCase();


  if (
    category.startsWith(
      "TM"
    )
  ) {
    return "tm";
  }


  if (
    category.startsWith(
      "BM"
    )
  ) {
    return "bm";
  }


  if (
    category.startsWith(
      "CM"
    )
  ) {
    return "cm";
  }


  if (
    category ===
      "인계사항" ||
    category ===
      "인계 사항"
  ) {
    return "handover";
  }


  if (
    category ===
    "비고"
  ) {
    return "note";
  }


  return "";
}


/* =========================================================
  선택한 구분이 업무일지에 존재하는지 확인
========================================================= */

function doesLogMatchSearchCategory(
  log,
  selectedCategory
) {
  const category =
    String(
      selectedCategory ||
      ""
    ).trim();


  /*
    전체
  */
  if (!category) {
    return true;
  }


  /*
    운전현황
  */
  if (
    category ===
    "operation"
  ) {
    return Boolean(
      String(
        log?.operationStatus ||
        ""
      ).trim()
    );
  }


  /*
    비고
  */
  if (
    category ===
    "note"
  ) {
    const hasLogNote =
      Boolean(
        String(
          log?.note ||
          ""
        ).trim()
      );


    const hasNoteEntry =
      Array.isArray(
        log?.entries
      ) &&
      log.entries.some(
        (entry) => {
          return (
            getSearchEntryCategoryValue(
              entry
            ) ===
            "note"
          );
        }
      );


    return (
      hasLogNote ||
      hasNoteEntry
    );
  }


  const entries =
    Array.isArray(
      log?.entries
    )
      ? log.entries
      : [];


  return entries.some(
    (entry) => {
      return (
        getSearchEntryCategoryValue(
          entry
        ) ===
        category
      );
    }
  );
}

/* =========================================================
  조회 목록 업무내용 미리보기

  출력 규칙
  1. 일반 보직은 운전현황을 표시하지 않음
  2. 파트장은 운전현황 전체 줄 표시
  3. 번호 → 시간 → 내용 → TAG
  4. TAG는 내용 뒤에 한 번만 표시
  5. 과거 content 앞의 중복 TAG 제거
  6. 조회 버튼 안에 button을 중첩하지 않음
  7. 파트장 일지는 보직별로 분리
========================================================= */

function createSearchLogPreviewHtml(
  log
) {
  const normalizedLogRole =
    normalizeMemberLogRole(
      log?.role ||
      ""
    );


  const isLeaderLog =
    normalizedLogRole ===
    "파트장";


  const operationStatus =
    String(
      log?.operationStatus ||
      ""
    ).trim();


  const entries =
    Array.isArray(
      log?.entries
    )
      ? log.entries
      : [];


  const note =
    String(
      log?.note ||
      ""
    ).trim();


  const tmEntries = [];

  const ordinaryEntries = [];


  /*
    content 앞에 이미 포함된 TAG 제거

    예:
    [00E6LAB40AA101] Feed Water Heater 점검

    결과:
    Feed Water Heater 점검
  */
  const removeLeadingDuplicateTag = (
    content,
    tag
  ) => {
    let normalizedContent =
      String(
        content ||
        ""
      ).trim();


    const normalizedTag =
      String(
        tag ||
        ""
      )
        .trim()
        .toUpperCase();


    if (
      !normalizedContent ||
      !normalizedTag
    ) {
      return normalizedContent;
    }


    const escapedTag =
      normalizedTag.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );


    const leadingTagPattern =
      new RegExp(
        `^\\s*[\\[【]\\s*${escapedTag}\\s*[\\]】]\\s*`,
        "i"
      );


    return normalizedContent
      .replace(
        leadingTagPattern,
        ""
      )
      .trim();
  };


  /*
    원본 항목 정리
  */
  entries.forEach(
    (
      entry,
      originalIndex
    ) => {
      const categoryValue =
        getSearchEntryCategoryValue(
          entry
        );


      if (
        !categoryValue
      ) {
        return;
      }


      const normalizedTag =
        String(
          entry?.tag ||
          ""
        )
          .trim()
          .toUpperCase();


      const normalizedContent =
        removeLeadingDuplicateTag(
          entry?.content,
          normalizedTag
        );


      const normalizedEntry = {
        originalIndex,

        time:
          String(
            entry?.time ||
            ""
          ).trim(),

        tag:
          normalizedTag,

        content:
          normalizedContent,

        importedFromRole:
          normalizeMemberLogRole(
            entry?.importedFromRole ||
            ""
          )
      };


      if (
        !normalizedEntry.content &&
        !normalizedEntry.tag
      ) {
        return;
      }


      if (
        categoryValue ===
        "tm"
      ) {
        tmEntries.push(
          normalizedEntry
        );

        return;
      }


      if (
        categoryValue ===
          "handover" ||
        categoryValue ===
          "bm" ||
        categoryValue ===
          "cm"
      ) {
        ordinaryEntries.push(
          normalizedEntry
        );
      }
    }
  );


  /*
    조회 목록 한 항목

    번호 → 시간 → 내용 → TAG

    TAG는 span으로 출력한다.
  */
  const createSearchEntryHtml = (
    entry,
    displayNumber,
    type
  ) => {
    const numberClass =
      type === "tm"
        ? "is-tm"
        : "is-handover";


    const timeHtml =
      entry.time
        ? `<strong class="search-preview-entry__time">${escapeHtml(
            entry.time
          )}</strong>`
        : "";


    const contentHtml =
      `<span class="search-preview-entry__text">${escapeHtml(
        entry.content ||
        "-"
      )}</span>`;


    const tagHtml =
      entry.tag
        ? `<span
            class="search-preview-entry__tag"
            data-search-preview-tag="${escapeHtml(
              entry.tag
            )}"
            role="button"
            tabindex="0"
            title="Facility Navigator에서 설비 보기"
          >[${escapeHtml(
            entry.tag
          )}]</span>`
        : "";


    const bodyHtml =
      `${timeHtml}${contentHtml}${tagHtml}`;


    return `
      <span
        class="
          search-preview-entry
          ${numberClass}
        "
      >
        <strong
          class="search-preview-entry__number"
        >
          ${displayNumber}.
        </strong>

        <span
          class="search-preview-entry__body"
        >${bodyHtml}</span>
      </span>
    `;
  };


  /*
    보직별 일반 업무 묶기
  */
  const roleOrder = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2",
    "파트장"
  ];


  const groupedOrdinaryEntries = {};


  ordinaryEntries.forEach(
    (entry) => {
      const sourceRole =
        entry.importedFromRole ||
        normalizedLogRole ||
        "파트장";


      if (
        !groupedOrdinaryEntries[
          sourceRole
        ]
      ) {
        groupedOrdinaryEntries[
          sourceRole
        ] = [];
      }


      groupedOrdinaryEntries[
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
          groupedOrdinaryEntries[
            role
          ]?.length
        );
      }
    ),

    ...Object.keys(
      groupedOrdinaryEntries
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


  const roleClassMap = {
    TGO:
      "is-tgo",

    BCO1:
      "is-bco1",

    BCO2:
      "is-bco2",

    TO:
      "is-to",

    BO1:
      "is-bo1",

    BO2:
      "is-bo2",

    파트장:
      "is-leader"
  };


  const sections = [];


  /* =====================================================
    운전현황

    일반 보직:
    조회 목록에서 표시하지 않음

    파트장:
    저장된 전체 운전현황을 줄별로 모두 표시
  ====================================================== */

  if (
    isLeaderLog &&
    operationStatus
  ) {
    const operationStatusLines =
      operationStatus
        .replace(
          /\r\n/g,
          "\n"
        )
        .replace(
          /\r/g,
          "\n"
        )
        .split(
          "\n"
        )
        .map(
          (line) => {
            return String(
              line ||
              ""
            ).trim();
          }
        )
        .filter(Boolean);


    if (
      operationStatusLines.length
    ) {
      sections.push(`
        <span
          class="
            search-preview-section
            is-operation
          "
        >
          <strong
            class="search-preview-section__title"
          >
            운전현황
          </strong>

          <span
            class="search-preview-section__content"
          >
            ${operationStatusLines
              .map(
                (
                  line,
                  index
                ) => {
                  return `
                    <span
                      class="
                        search-preview-entry
                        is-handover
                        is-operation
                      "
                    >
                      <strong
                        class="search-preview-entry__number"
                      >
                        ${index + 1}.
                      </strong>

                      <span
                        class="search-preview-entry__body"
                      >
                        <span
                          class="search-preview-entry__text"
                        >
                          ${escapeHtml(
                            line
                          )}
                        </span>
                      </span>
                    </span>
                  `;
                }
              )
              .join("")}
          </span>
        </span>
      `);
    }
  }


  /* =====================================================
    TM 발행 내역
  ====================================================== */

  if (
    tmEntries.length
  ) {
    sections.push(`
      <span
        class="
          search-preview-section
          is-tm
        "
      >
        <strong
          class="search-preview-section__title"
        >
          TM 발행 내역
        </strong>

        <span
          class="search-preview-section__content"
        >
          ${tmEntries
            .map(
              (
                entry,
                index
              ) => {
                return createSearchEntryHtml(
                  entry,
                  index + 1,
                  "tm"
                );
              }
            )
            .join("")}
        </span>
      </span>
    `);
  }


  /* =====================================================
    일반 업무
  ====================================================== */

  if (
    ordinaryEntries.length
  ) {
    /*
      파트장:
      보직별 업무일지 제목 표시
    */
    if (
      isLeaderLog
    ) {
      orderedRoles.forEach(
        (role) => {
          const roleEntries =
            groupedOrdinaryEntries[
              role
            ] || [];


          sections.push(`
            <span
              class="
                search-preview-role-section
                ${roleClassMap[role] || "is-default"}
              "
            >
              <strong
                class="
                  search-preview-role-title
                  ${roleClassMap[role] || "is-default"}
                "
              >
                ${escapeHtml(
                  role
                )} 업무일지
              </strong>

              <span
                class="search-preview-role-content"
              >
                ${roleEntries
                  .map(
                    (
                      entry,
                      index
                    ) => {
                      return createSearchEntryHtml(
                        entry,
                        index + 1,
                        "handover"
                      );
                    }
                  )
                  .join("")}
              </span>
            </span>
          `);
        }
      );

    } else {
      /*
        일반 보직:
        인계 제목 한 개만 표시
      */
      sections.push(`
        <span
          class="
            search-preview-section
            is-handover
          "
        >
          <strong
            class="search-preview-section__title"
          >
            인계 사항
          </strong>

          <span
            class="search-preview-section__content"
          >
            ${ordinaryEntries
              .map(
                (
                  entry,
                  index
                ) => {
                  return createSearchEntryHtml(
                    entry,
                    index + 1,
                    "handover"
                  );
                }
              )
              .join("")}
          </span>
        </span>
      `);
    }
  }


  /* =====================================================
    비고
  ====================================================== */

  if (
    note
  ) {
    sections.push(`
      <span
        class="
          search-preview-section
          is-note
        "
      >
        <strong
          class="search-preview-section__title"
        >
          비고
        </strong>

        <span
          class="search-preview-section__content"
        >
          <span
            class="search-preview-note"
          >
            ${escapeHtml(
              firstMeaningfulLine(
                note
              )
            )}
          </span>
        </span>
      </span>
    `);
  }


  /*
    표시할 내용 없음
  */
  if (
    !sections.length
  ) {
    return `
      <span class="search-preview-empty">
        등록된 업무 내용이 없습니다.
      </span>
    `;
  }


  return `
    <span class="search-preview-document">
      ${sections.join("")}
    </span>
  `;
}

/* =========================================================
  첨부파일 개수
========================================================= */

function getSearchLogAttachmentCount(
  log
) {
  if (
    Array.isArray(
      log?.attachments
    )
  ) {
    return log.attachments.length;
  }


  return 0;
}


/* =========================================================
  상태 배지 클래스
========================================================= */

function getSearchLogStatusClass(
  status
) {
  const normalizedStatus =
    String(
      status ||
      ""
    ).trim();


  if (
    normalizedStatus ===
      "결재완료" ||
    normalizedStatus ===
      "승인완료"
  ) {
    return "is-approved";
  }


  if (
    normalizedStatus ===
      "작성완료" ||
    normalizedStatus ===
      "저장완료"
  ) {
    return "is-saved";
  }


  return "is-writing";
}


/* =========================================================
  업무일지 조회 실행

  결과 단위:
  업무 항목 1건이 아니라
  업무일지 1건
========================================================= */

async function runSearch() {
  if (
    !elements.searchForm
  ) {
    return;
  }


  const formData =
    new FormData(
      elements.searchForm
    );


  const startDate =
    String(
      formData.get(
        "startDate"
      ) ||
      ""
    ).trim();


  const endDate =
    String(
      formData.get(
        "endDate"
      ) ||
      ""
    ).trim();


  const shift =
    String(
      formData.get(
        "shift"
      ) ||
      ""
    )
      .trim()
      .toUpperCase();


  const role =
    normalizeMemberLogRole(
      formData.get(
        "role"
      )
    );


  const category =
    String(
      formData.get(
        "category"
      ) ||
      ""
    ).trim();


  const keyword =
    String(
      formData.get(
        "keyword"
      ) ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    !startDate ||
    !endDate
  ) {
    showToast(
      "조회 시작일과 종료일을 선택해 주세요."
    );

    return;
  }


  if (
    startDate >
    endDate
  ) {
    showToast(
      "종료일은 시작일보다 빠를 수 없습니다."
    );

    return;
  }


  const searchDates =
    createSearchDateRange(
      startDate,
      endDate
    );


  if (
    !searchDates.length
  ) {
    showToast(
      "조회 기간을 확인해 주세요."
    );

    return;
  }


  if (
    searchDates.length >
    31
  ) {
    showToast(
      "조회 기간은 최대 31일까지 선택할 수 있습니다."
    );

    return;
  }


  const submitButton =
    elements.searchForm
      .querySelector(
        'button[type="submit"]'
      );


  const originalButtonText =
    submitButton?.textContent ||
    "조회";


  if (
    submitButton
  ) {
    submitButton.disabled =
      true;

    submitButton.textContent =
      "조회 중...";
  }


  if (
    elements.searchResultBody
  ) {
    elements.searchResultBody
      .innerHTML =
      "";
  }


  if (
    elements.searchResultCount
  ) {
    elements.searchResultCount
      .textContent =
      "0";
  }


  if (
    elements.searchEmptyState
  ) {
    elements.searchEmptyState.hidden =
      false;


    const loadingTitle =
      elements.searchEmptyState
        .querySelector(
          "strong"
        );


    const loadingDescription =
      elements.searchEmptyState
        .querySelector(
          "p"
        );


    if (
      loadingTitle
    ) {
      loadingTitle.textContent =
        "과거 업무일지를 불러오는 중입니다.";
    }


    if (
      loadingDescription
    ) {
      loadingDescription.textContent =
        "선택한 기간의 업무일지를 확인하고 있습니다.";
    }
  }


  try {
    /*
      조회 기간의 과거 업무일지를 모두 불러온다.
    */
    const legacySearchLogs =
      await loadLegacyLogsForSearchRange(
        startDate,
        endDate
      );


    /*
      신규 업무일지와 과거 업무일지를 합친다.
    */
    const combinedLogs =
      removeDuplicateSearchLogs([
        ...appState.logs,
        ...legacySearchLogs
      ]);


    const matchedLogs =
      combinedLogs.filter(
        (log) => {
          const logDate =
            String(
              log?.date ||
              ""
            ).trim();


          const logShift =
            String(
              log?.shift ||
              ""
            )
              .trim()
              .toUpperCase();


          const logRole =
            normalizeMemberLogRole(
              log?.role
            );


          /*
            날짜
          */
          if (
            logDate <
              startDate ||
            logDate >
              endDate
          ) {
            return false;
          }


          /*
            근무
          */
          if (
            shift &&
            logShift !==
              shift
          ) {
            return false;
          }


          /*
            보직
          */
          if (
            role &&
            logRole !==
              role
          ) {
            return false;
          }


          /*
            구분
          */
          if (
            !doesLogMatchSearchCategory(
              log,
              category
            )
          ) {
            return false;
          }


          /*
            검색어

            검색어와 일치하는 항목이 하나라도 있으면
            업무일지 전체를 결과에 표시한다.
          */
          if (
            keyword
          ) {
            const searchableText =
              createSearchLogText(
                log
              );


            if (
              !searchableText.includes(
                keyword
              )
            ) {
              return false;
            }
          }


          return true;
        }
      );


    /*
      최신 날짜 우선

      같은 날짜:
      D/S → N/S

      같은 근무:
      파트장 → TGO → BCO1 → BCO2 → TO → BO1 → BO2
    */
    const roleOrder = {
      파트장:
        1,

      TGO:
        2,

      BCO1:
        3,

      BCO2:
        4,

      TO:
        5,

      BO1:
        6,

      BO2:
        7
    };


    matchedLogs.sort(
      (
        logA,
        logB
      ) => {
        const dateDifference =
          String(
            logB.date ||
            ""
          ).localeCompare(
            String(
              logA.date ||
              ""
            )
          );


        if (
          dateDifference !==
          0
        ) {
          return dateDifference;
        }


        const shiftOrder = {
          DS:
            1,

          NS:
            2
        };


        const shiftDifference =
          (
            shiftOrder[
              String(
                logA.shift ||
                ""
              ).toUpperCase()
            ] ||
            99
          ) -
          (
            shiftOrder[
              String(
                logB.shift ||
                ""
              ).toUpperCase()
            ] ||
            99
          );


        if (
          shiftDifference !==
          0
        ) {
          return shiftDifference;
        }


        return (
          roleOrder[
            normalizeMemberLogRole(
              logA.role
            )
          ] ||
          99
        ) -
        (
          roleOrder[
            normalizeMemberLogRole(
              logB.role
            )
          ] ||
          99
        );
      }
    );


    renderSearchResults(
      matchedLogs
    );

  } catch (error) {
    console.error(
      "업무일지 조회 실패:",
      error
    );


    currentSearchResultLogs =
      [];


    if (
      elements.searchResultBody
    ) {
      elements.searchResultBody
        .innerHTML =
        "";
    }


    if (
      elements.searchResultCount
    ) {
      elements.searchResultCount
        .textContent =
        "0";
    }


    if (
      elements.searchEmptyState
    ) {
      elements.searchEmptyState.hidden =
        false;


      const errorTitle =
        elements.searchEmptyState
          .querySelector(
            "strong"
          );


      const errorDescription =
        elements.searchEmptyState
          .querySelector(
            "p"
          );


      if (
        errorTitle
      ) {
        errorTitle.textContent =
          "업무일지를 불러오지 못했습니다.";
      }


      if (
        errorDescription
      ) {
        errorDescription.textContent =
          error.message ||
          "잠시 후 다시 조회해 주세요.";
      }
    }


    showToast(
      error.message ||
      "업무일지 조회 중 오류가 발생했습니다."
    );

  } finally {
    if (
      submitButton
    ) {
      submitButton.disabled =
        false;

      submitButton.textContent =
        originalButtonText;
    }
  }
}

/* =========================================================
  업무일지 1건당 조회 결과 1줄 출력

  열 순서:
  일자 | 근무 | 보직 | 작성자 | 업무 내용 | 보기 | 첨부
========================================================= */

function renderSearchResults(
  logs
) {
  const resultLogs =
    Array.isArray(
      logs
    )
      ? logs
      : [];


  currentSearchResultLogs =
    resultLogs;


  elements.searchResultBody.innerHTML =
    "";


  elements.searchResultCount.textContent =
    String(
      resultLogs.length
    );


  elements.searchEmptyState.hidden =
    resultLogs.length > 0;


  if (
    !resultLogs.length
  ) {
    const emptyTitle =
      elements.searchEmptyState
        .querySelector(
          "strong"
        );


    const emptyDescription =
      elements.searchEmptyState
        .querySelector(
          "p"
        );


    if (
      emptyTitle
    ) {
      emptyTitle.textContent =
        "조회 결과가 없습니다.";
    }


    if (
      emptyDescription
    ) {
      emptyDescription.textContent =
        "검색 조건을 변경하여 다시 조회해 주세요.";
    }


    return;
  }


  resultLogs.forEach(
    (
      log,
      resultIndex
    ) => {
      const attachmentCount =
        getSearchLogAttachmentCount(
          log
        );


      elements.searchResultBody
        .insertAdjacentHTML(
          "beforeend",
          `
            <tr
              class="search-log-row"
              data-search-result-index="${resultIndex}"
            >

              <td class="search-log-date-cell">
                ${escapeHtml(
                  log.date ||
                  "-"
                )}
              </td>


              <td class="search-log-shift-cell">
                ${escapeHtml(
                  getShiftDisplayName(
                    log.shift
                  )
                )}
              </td>


              <td class="search-log-role-cell">
                ${escapeHtml(
                  log.role ||
                  "-"
                )}
              </td>


              <td class="search-log-author-cell">
                <strong>
                  ${escapeHtml(
                    log.author ||
                    "-"
                  )}
                </strong>
              </td>


              <td class="search-log-preview-cell">

                <button
                  type="button"
                  class="
                    log-preview
                    search-log-preview
                  "
                  data-search-view-index="${resultIndex}"
                  aria-label="${escapeHtml(
                    log.author ||
                    ""
                  )} 업무일지 상세보기"
                >

                  ${createSearchLogPreviewHtml(
                    log
                  )}

                </button>

              </td>


              <td class="search-log-view-cell">

                <button
                  type="button"
                  class="table-action-button"
                  data-search-view-index="${resultIndex}"
                >
                  보기
                </button>

              </td>


              <td class="search-log-attachment-cell">

                ${
                  attachmentCount > 0
                    ? `
                      <span
                        class="attachment-indicator"
                        title="첨부파일 ${attachmentCount}개"
                        aria-label="첨부파일 ${attachmentCount}개"
                      >
                        ${attachmentCount}
                      </span>
                    `
                    : `
                      <span
                        class="
                          attachment-indicator
                          is-empty
                        "
                        aria-label="첨부파일 없음"
                      >
                        -
                      </span>
                    `
                }

              </td>

            </tr>
          `
        );
    }
  );


  /*
    TAG 클릭:
    상세창 대신 설비 네비게이터 이동
  */
  elements.searchResultBody
    .querySelectorAll(
      "[data-search-preview-tag]"
    )
    .forEach(
      (tagButton) => {
        tagButton.addEventListener(
          "click",
          (event) => {
            event.stopPropagation();


            const tag =
              String(
                tagButton.dataset
                  .searchPreviewTag ||
                ""
              ).trim();


            if (
              tag
            ) {
              openFacilityNavigator(
                tag
              );
            }
          }
        );
      }
    );


  /*
    업무내용 또는 보기 버튼 클릭:
    해당 업무일지 상세창 열기
  */
  elements.searchResultBody
    .querySelectorAll(
      "[data-search-view-index]"
    )
    .forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const resultIndex =
              Number(
                button.dataset
                  .searchViewIndex
              );


            const log =
              currentSearchResultLogs[
                resultIndex
              ];


            if (
              !log
            ) {
              showToast(
                "업무일지를 찾을 수 없습니다."
              );

              return;
            }


            openLogDetail(
              log
            );
          }
        );
      }
    );
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

/* =========================================================
  직원 엑셀 업로드 알림
========================================================= */

function showEmployeeUploadMessage(message) {
  if (
    typeof showToast === "function"
  ) {
    showToast(message);
    return;
  }

  alert(message);
}


/* =========================================================
  직원 엑셀 파일 선택창 열기
========================================================= */

function openEmployeeExcelUpload() {
  const fileInput =
    document.getElementById(
      "employeeExcelFileInput"
    );

  if (!fileInput) {
    console.error(
      "employeeExcelFileInput 요소를 찾을 수 없습니다."
    );

    showEmployeeUploadMessage(
      "엑셀 파일 선택창을 찾을 수 없습니다."
    );

    return;
  }

  /*
    같은 파일을 연속으로 선택해도
    change 이벤트가 다시 실행되도록 초기화
  */
  fileInput.value = "";

  fileInput.click();
}


/* =========================================================
  직원 엑셀 파일 읽기

  현재 단계:
  - 직원명단 시트 읽기
  - 사번 / 이름 / 파트장 / 비고 변환
  - 유효하지 않은 행 제거
  - 중복 사번 제거
  - 아직 서버에는 저장하지 않음
========================================================= */

async function handleEmployeeExcelUpload(event) {
  const file =
    event.target.files?.[0];

  if (!file) {
    return;
  }

  if (
    typeof XLSX === "undefined"
  ) {
    console.error(
      "SheetJS XLSX 라이브러리가 연결되지 않았습니다."
    );

    showEmployeeUploadMessage(
      "엑셀 라이브러리를 불러오지 못했습니다."
    );

    event.target.value = "";

    return;
  }

  try {
    const arrayBuffer =
      await file.arrayBuffer();

    const workbook =
      XLSX.read(
        arrayBuffer,
        {
          type: "array"
        }
      );

    const sheetName =
      workbook.SheetNames.includes(
        "직원명단"
      )
        ? "직원명단"
        : workbook.SheetNames[0];

    const worksheet =
      workbook.Sheets[
        sheetName
      ];

    if (!worksheet) {
      throw new Error(
        "직원명단 시트를 찾을 수 없습니다."
      );
    }

    const rawRows =
      XLSX.utils.sheet_to_json(
        worksheet,
        {
          defval: "",
          raw: false
        }
      );

    const parsedEmployees =
      rawRows
        .map(
          (
            row,
            index
          ) => {
            const employeeNo =
              String(
                row["사번"] ?? ""
              )
                .trim()
                .replace(
                  /[^0-9]/g,
                  ""
                );

            const name =
              String(
                row["이름"] ?? ""
              ).trim();

            const leaderValue =
              String(
                row["파트장"] ?? ""
              ).trim();

            const note =
              String(
                row["비고"] ?? ""
              ).trim();

            return {
              rowNumber:
                index + 2,

              employeeNo,

              name,

              isLeader:
                leaderValue ===
                "파트장",

              note
            };
          }
        )
        .filter(
          employee => {
            return (
              employee.employeeNo ||
              employee.name
            );
          }
        );

    const invalidEmployees =
      parsedEmployees.filter(
        employee => {
          return (
            !employee.employeeNo ||
            !employee.name
          );
        }
      );

    if (
      invalidEmployees.length >
      0
    ) {
      const invalidRows =
        invalidEmployees
          .map(
            employee =>
              employee.rowNumber
          )
          .join(", ");

      throw new Error(
        `사번 또는 이름이 비어 있는 행이 있습니다. 행 번호: ${invalidRows}`
      );
    }

    const employeeMap =
      new Map();

    const duplicateEmployeeNumbers =
      [];

    parsedEmployees.forEach(
      employee => {
        if (
          employeeMap.has(
            employee.employeeNo
          )
        ) {
          duplicateEmployeeNumbers.push(
            employee.employeeNo
          );

          return;
        }

        employeeMap.set(
          employee.employeeNo,
          employee
        );
      }
    );

    const employees =
      Array.from(
        employeeMap.values()
      ).map(
        employee => {
          return {
            employeeNo:
              employee.employeeNo,

            name:
              employee.name,

            /*
              파트장은 관리자 권한으로 저장한다.
              추후 leader 권한을 만들면 여기만 변경하면 된다.
            */
            defaultRole:
              employee.isLeader
                ? "admin"
                : "user",

            /*
              엑셀 등록 직원은 모두 가입 허용
            */
            isAllowed:
              true
          };
        }
      );

    if (
      employees.length === 0
    ) {
      throw new Error(
        "등록할 직원 정보가 없습니다."
      );
    }

    const leaderCount =
      employees.filter(
        employee => {
          return (
            employee.defaultRole ===
            "admin"
          );
        }
      ).length;

    const shouldSave =
      window.confirm(
        [
          `직원 ${employees.length}명을 저장하시겠습니까?`,
          "",
          `파트장 ${leaderCount}명`,
          "기존 사번은 이름과 권한만 갱신됩니다."
        ].join("\n")
      );

    if (!shouldSave) {
      showEmployeeUploadMessage(
        "직원 명단 저장을 취소했습니다."
      );

      return;
    }

    showEmployeeUploadMessage(
      "직원 명단을 저장하고 있습니다."
    );

    const response =
      await fetch(
        "/api/employees",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          cache:
            "no-store",

          body:
            JSON.stringify({
              employees
            })
        }
      );

    let result = {};

    try {
      result =
        await response.json();
    } catch (error) {
      throw new Error(
        "직원 저장 서버의 응답을 확인할 수 없습니다."
      );
    }

    if (
      !response.ok ||
      !result.ok
    ) {
      throw new Error(
        result.message ||
        "직원 명단 저장에 실패했습니다."
      );
    }

    window.pendingEmployeeExcelData =
      [];

    const successMessage =
      result.message ||
      `직원 ${employees.length}명 저장을 완료했습니다.`;

    showEmployeeUploadMessage(
      successMessage
    );

    /*
      최신 직원 목록 다시 불러오기
    */
    if (
      typeof loadEmployeeManagement ===
      "function"
    ) {
      await loadEmployeeManagement();
    }

    if (
      typeof loadEmployeeDirectory ===
      "function"
    ) {
      await loadEmployeeDirectory();
    }

    console.log(
      "직원 엑셀 저장 완료:",
      result
    );

    if (
      duplicateEmployeeNumbers.length >
      0
    ) {
      console.warn(
        "엑셀 내부 중복으로 제외된 사번:",
        duplicateEmployeeNumbers
      );
    }

  } catch (error) {
    console.error(
      "직원 엑셀 업로드 오류:",
      error
    );

    showEmployeeUploadMessage(
      error.message ||
      "직원 엑셀 파일을 처리하지 못했습니다."
    );

  } finally {
    event.target.value =
      "";
  }
}
