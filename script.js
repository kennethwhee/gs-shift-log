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

/* =========================================================
  로그인 사용자 권한 통합 판정

  지원 필드:
  - role
  - userRole
  - user_role
  - defaultRole
  - default_role
  - permission
  - authority
  - accessRole
  - access_role

  최고관리자 표기:
  - super_admin
  - superadmin
  - 최고관리자
========================================================= */

function getShiftLogUserAccountRole(
  user
) {
  if (
    !user ||
    typeof user !==
      "object"
  ) {
    return "";
  }


  /*
    서버에서 boolean 형태로
    최고관리자 여부를 보내는 경우
  */
  const hasSuperAdminFlag =
    user.isSuperAdmin ===
      true ||
    user.is_super_admin ===
      true ||
    Number(
      user.isSuperAdmin ??
      user.is_super_admin ??
      0
    ) ===
      1;


  if (
    hasSuperAdminFlag
  ) {
    return "super_admin";
  }


  /*
    로그인 API 또는 직원 API마다
    권한 필드명이 다를 수 있으므로
    모든 후보값을 확인한다.
  */
  const roleCandidates = [
    user.role,
    user.userRole,
    user.user_role,
    user.defaultRole,
    user.default_role,
    user.permission,
    user.authority,
    user.accessRole,
    user.access_role
  ]
    .map(
      value => {
        return String(
          value ||
          ""
        )
          .trim()
          .toLowerCase()
          .replace(
            /[\s-]+/g,
            "_"
          );
      }
    )
    .filter(Boolean);


  /*
    후보 중 하나라도 최고관리자이면
    다른 필드가 user로 되어 있어도
    최고관리자를 우선 적용한다.
  */
  if (
    roleCandidates.some(
      role => {
        return [
          "super_admin",
          "superadmin",
          "최고관리자"
        ].includes(
          role
        );
      }
    )
  ) {
    return "super_admin";
  }


  /*
    파트장 권한
  */
  if (
    roleCandidates.some(
      role => {
        return [
          "admin",
          "leader",
          "파트장"
        ].includes(
          role
        );
      }
    )
  ) {
    return "admin";
  }


  if (
    roleCandidates.includes(
      "user"
    )
  ) {
    return "user";
  }


  return (
    roleCandidates[0] ||
    ""
  );
}


function isShiftLogSuperAdminUser(
  user
) {
  return (
    getShiftLogUserAccountRole(
      user
    ) ===
    "super_admin"
  );
}

/* =========================================================
  로그인 완료 후 앱 열기 최종본

  최고관리자:
  관리자 메뉴 표시

  일반·파트장:
  관리자 메뉴 숨김
========================================================= */

function openShiftLogApp(
  user
) {
  const {
    loginScreen,
    appShell,
    headerUserName,
    adminButton
  } =
    getLoginElements();


  if (
    loginScreen
  ) {
    loginScreen.hidden =
      true;
  }


  if (
    appShell
  ) {
    appShell.hidden =
      false;
  }


  const employeeNo =
    String(
      user?.employeeNo ||
      user?.employee_no ||
      user?.employeeId ||
      user?.employee_id ||
      ""
    ).trim();


  const employeeName =
    String(
      user?.name ||
      user?.employeeName ||
      user?.employee_name ||
      ""
    ).trim();


  if (
    headerUserName
  ) {
    headerUserName.textContent =
      employeeName ||
      employeeNo ||
      "사용자";
  }


  const normalizedRole =
    getShiftLogUserAccountRole(
      user
    );


  const isSuperAdmin =
    normalizedRole ===
    "super_admin";


  /*
    권한값을 현재 저장 구조로 통일해서
    다음 새로고침에서도 동일하게 사용한다.
  */
  const normalizedUser = {
    ...user,

    employeeNo:
      employeeNo ||
      user?.employeeNo ||
      "",

    name:
      employeeName ||
      user?.name ||
      "",

    role:
      normalizedRole ||
      user?.role ||
      ""
  };


  saveCurrentUser(
    normalizedUser
  );


  if (
    adminButton
  ) {
    adminButton.hidden =
      !isSuperAdmin;

    adminButton.disabled =
      !isSuperAdmin;


    /*
      hidden 속성과 기존 CSS 상태를 함께 정리한다.
    */
    adminButton.style.display =
      isSuperAdmin
        ? ""
        : "none";
  }


  console.log(
    "로그인 사용자 권한 확인:",
    {
      employeeNo,
      employeeName,
      normalizedRole,
      isSuperAdmin,
      originalUser:
        user
    }
  );
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
  현재 로그인 사용자의 최고관리자 권한 확인
========================================================= */

function isCurrentUserSuperAdmin() {
  const currentUser =
    loadCurrentUser();


  return isShiftLogSuperAdminUser(
    currentUser
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


              <button
                type="button"
                class="employee-management-edit-button"
                data-employee-edit="${employeeNo}"
                onclick="openEmployeeEditModal('${employeeNo}')"
              >
                수정
              </button>

            </article>
          `;
        }
      )
      .join("");
}

/* =========================================================
  직원 수정 대상 찾기
========================================================= */

function findEmployeeManagementUser(
  employeeNo
) {
  const normalizedEmployeeNo =
    String(
      employeeNo ||
      ""
    ).trim();

  const users =
    Array.isArray(
      employeeManagementUsers
    )
      ? employeeManagementUsers
      : [];

  return (
    users.find(
      user => {
        const userEmployeeNo =
          String(
            user.employeeNo ||
            user.employee_no ||
            ""
          ).trim();

        return (
          userEmployeeNo ===
          normalizedEmployeeNo
        );
      }
    ) ||
    null
  );
}


/* =========================================================
  직원 권한값 정리
========================================================= */

function normalizeEmployeeEditRole(
  value
) {
  const role =
    String(
      value ||
      "user"
    )
      .trim()
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );

  if (
    role === "super_admin" ||
    role === "superadmin"
  ) {
    return "super_admin";
  }

  if (
    role === "admin" ||
    role === "leader"
  ) {
    return "admin";
  }

  return "user";
}


/* =========================================================
  직원 수정 모달 열기
========================================================= */

function openEmployeeEditModal(
  employeeNo
) {
  const modal =
    document.getElementById(
      "employeeEditModal"
    );

  if (!modal) {
    showToast(
      "직원 수정창을 찾을 수 없습니다."
    );

    return;
  }

  const targetUser =
    findEmployeeManagementUser(
      employeeNo
    );

  if (!targetUser) {
    showToast(
      "수정할 직원 정보를 찾을 수 없습니다."
    );

    return;
  }

  const originalEmployeeNoInput =
    document.getElementById(
      "employeeEditOriginalEmployeeNo"
    );

  const employeeNoInput =
    document.getElementById(
      "employeeEditEmployeeNo"
    );

  const nameInput =
    document.getElementById(
      "employeeEditName"
    );

  const roleSelect =
    document.getElementById(
      "employeeEditRole"
    );

  const positionSelect =
    document.getElementById(
      "employeeEditPosition"
    );

  const message =
    document.getElementById(
      "employeeEditMessage"
    );


  const targetEmployeeNo =
    String(
      targetUser.employeeNo ||
      targetUser.employee_no ||
      ""
    ).trim();

  const targetName =
    String(
      targetUser.name ||
      ""
    ).trim();

  const targetRole =
    normalizeEmployeeEditRole(
      targetUser.role
    );

  const targetPosition =
    String(
      targetUser.position ||
      targetUser.jobPosition ||
      targetUser.job_position ||
      targetUser.duty ||
      ""
    ).trim();


  if (
    originalEmployeeNoInput
  ) {
    originalEmployeeNoInput.value =
      targetEmployeeNo;
  }

  if (employeeNoInput) {
    employeeNoInput.value =
      targetEmployeeNo;
  }

  if (nameInput) {
    nameInput.value =
      targetName;
  }

  if (roleSelect) {
    roleSelect.value =
      targetRole;
  }

  if (positionSelect) {
    const positionExists =
      Array.from(
        positionSelect.options
      ).some(
        option => {
          return (
            option.value ===
            targetPosition
          );
        }
      );

    positionSelect.value =
      positionExists
        ? targetPosition
        : "";
  }

  if (message) {
    message.hidden = true;
    message.textContent = "";
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
      nameInput?.focus();
      nameInput?.select();
    },
    50
  );
}


/* =========================================================
  직원 수정 모달 닫기
========================================================= */

function closeEmployeeEditModal() {
  const modal =
    document.getElementById(
      "employeeEditModal"
    );

  if (!modal) {
    return;
  }

  modal.classList.remove(
    "is-open"
  );

  modal.setAttribute(
    "aria-hidden",
    "true"
  );


  const employeeManagementModal =
    document.getElementById(
      "employeeManagementModal"
    );

  const managementModalIsOpen =
    employeeManagementModal &&
    employeeManagementModal.classList.contains(
      "is-open"
    );

  if (!managementModalIsOpen) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}

/* =========================================================
  직원 정보 실제 저장

  저장 대상:
  - employees.name
  - employees.default_role
  - employees.position
  - employees.is_allowed

  연동 대상:
  - users.name
  - users.role
  - users.is_active
========================================================= */

async function saveEmployeeEdit() {
  const employeeNoInput =
    document.getElementById(
      "employeeEditEmployeeNo"
    );

  const nameInput =
    document.getElementById(
      "employeeEditName"
    );

  const roleSelect =
    document.getElementById(
      "employeeEditRole"
    );

  const positionSelect =
    document.getElementById(
      "employeeEditPosition"
    );

  const message =
    document.getElementById(
      "employeeEditMessage"
    );

  const saveButton =
    document.getElementById(
      "saveEmployeeEditButton"
    );


  const employeeNo =
    String(
      employeeNoInput?.value ||
      ""
    ).trim();

  const name =
    String(
      nameInput?.value ||
      ""
    ).trim();

  const selectedRole =
    String(
      roleSelect?.value ||
      "user"
    )
      .trim()
      .toLowerCase();

  const position =
    String(
      positionSelect?.value ||
      ""
    ).trim();


  /* ==================================================
     입력값 검사
  ================================================== */

  if (!employeeNo) {
    if (message) {
      message.textContent =
        "직원 사번을 확인할 수 없습니다.";

      message.hidden =
        false;
    }

    return;
  }


  if (!name) {
    if (message) {
      message.textContent =
        "직원 이름을 입력해 주세요.";

      message.hidden =
        false;
    }

    nameInput?.focus();

    return;
  }


  if (
    name.length < 2 ||
    name.length > 30
  ) {
    if (message) {
      message.textContent =
        "직원 이름은 2~30자로 입력해 주세요.";

      message.hidden =
        false;
    }

    nameInput?.focus();

    return;
  }


  /* ==================================================
     화면 권한 → employees.default_role 변환

     화면:
     user
     admin
     super_admin

     employees:
     user
     leader
     super_admin
  ================================================== */

  let defaultRole =
    "user";


  if (
    selectedRole ===
    "super_admin"
  ) {
    defaultRole =
      "super_admin";

  } else if (
    selectedRole ===
      "admin" ||
    selectedRole ===
      "leader"
  ) {
    defaultRole =
      "leader";
  }


  const validPositions = [
    "",
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2",
    "파트장"
  ];


  if (
    !validPositions.includes(
      position
    )
  ) {
    if (message) {
      message.textContent =
        "선택한 보직을 확인해 주세요.";

      message.hidden =
        false;
    }

    return;
  }


  if (message) {
    message.textContent =
      "직원 정보를 저장하고 있습니다.";

    message.hidden =
      false;
  }


  if (saveButton) {
    saveButton.disabled =
      true;

    saveButton.textContent =
      "저장 중...";
  }


  try {
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
              employeeNo,

              name,

              defaultRole,

              position,

              /*
                가입 완료 계정이므로
                활성 상태를 유지한다.
              */
              isAllowed:
                true
            })
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
          "직원 저장 서버 응답 형식이 올바르지 않습니다."
        );
      }
    }


    if (
      !response.ok ||
      result.ok === false ||
      result.success === false
    ) {
      const detailErrors =
        Array.isArray(
          result.errors
        )
          ? result.errors.join(
              "\n"
            )
          : "";


      throw new Error(
        detailErrors ||
        result.message ||
        result.error ||
        `직원 정보 저장 실패 (HTTP ${response.status})`
      );
    }


    /*
      직원 목록을 서버에서 다시 조회한다.
    */
    await loadEmployeeManagement();


    closeEmployeeEditModal();


    showToast(
      `${name} 직원 정보가 저장되었습니다.`
    );

  } catch (error) {
    console.error(
      "직원 정보 저장 오류:",
      error
    );


    if (message) {
      message.textContent =
        error.message ||
        "직원 정보를 저장하지 못했습니다.";

      message.hidden =
        false;
    }


    showToast(
      error.message ||
      "직원 정보를 저장하지 못했습니다."
    );

  } finally {
    if (saveButton) {
      saveButton.disabled =
        false;

      saveButton.textContent =
        "저장";
    }
  }
} 

/* =========================================================
  직원 수정 모달 바깥 영역 클릭 닫기
========================================================= */

document.addEventListener(
  "click",
  event => {
    const modal =
      event.target.closest(
        "#employeeEditModal"
      );

    if (
      !modal ||
      event.target !== modal
    ) {
      return;
    }

    closeEmployeeEditModal();
  }
);


/* =========================================================
  ESC 키로 직원 수정 모달 닫기
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    if (
      event.key !==
      "Escape"
    ) {
      return;
    }

    const modal =
      document.getElementById(
        "employeeEditModal"
      );

    if (
      !modal ||
      !modal.classList.contains(
        "is-open"
      )
    ) {
      return;
    }

    closeEmployeeEditModal();
  }
);

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
  과거 업무일지 동기화 관리
========================================================= */

const LEGACY_SYNC_STORAGE_KEY =
  "gsShiftLog.legacySyncLastResult";


/* =========================================================
  날짜 입력값 → YYYYMMDD
========================================================= */

function convertLegacySyncDateToApiFormat(
  dateValue
) {
  return String(
    dateValue || ""
  ).replace(
    /-/g,
    ""
  );
}


/* =========================================================
  날짜를 YYYY-MM-DD 형식으로 반환
========================================================= */

function formatLegacySyncDate(
  date
) {
  return [
    date.getFullYear(),

    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    ),

    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    )
  ].join("-");
}


/* =========================================================
  기간을 최대 31일 단위로 나누기
========================================================= */

function createLegacySyncDateChunks(
  startDateValue,
  endDateValue
) {
  const startDate =
    new Date(
      `${startDateValue}T00:00:00`
    );

  const endDate =
    new Date(
      `${endDateValue}T00:00:00`
    );


  if (
    Number.isNaN(
      startDate.getTime()
    ) ||
    Number.isNaN(
      endDate.getTime()
    ) ||
    startDate > endDate
  ) {
    return [];
  }


  const chunks = [];

  const currentStart =
    new Date(
      startDate
    );


  while (
    currentStart <= endDate
  ) {
    const currentEnd =
      new Date(
        currentStart
      );


    /*
      시작일 포함 최대 31일
    */
    currentEnd.setDate(
      currentEnd.getDate() + 30
    );


    if (
      currentEnd > endDate
    ) {
      currentEnd.setTime(
        endDate.getTime()
      );
    }


    chunks.push({
      startDate:
        formatLegacySyncDate(
          currentStart
        ),

      endDate:
        formatLegacySyncDate(
          currentEnd
        )
    });


    currentStart.setTime(
      currentEnd.getTime()
    );


    currentStart.setDate(
      currentStart.getDate() + 1
    );
  }


  return chunks;
}


/* =========================================================
  동기화 메시지 표시
========================================================= */

function showLegacySyncMessage(
  message,
  type = "info"
) {
  const messageElement =
    document.getElementById(
      "legacySyncMessage"
    );


  if (!messageElement) {
    return;
  }


  messageElement.textContent =
    String(
      message || ""
    );


  messageElement.hidden =
    !message;


  messageElement.dataset.type =
    type;
}


/* =========================================================
  동기화 상태 표시
========================================================= */

function setLegacySyncStatus(
  status,
  label
) {
  const statusBadge =
    document.getElementById(
      "legacySyncStatusBadge"
    );


  if (!statusBadge) {
    return;
  }


  statusBadge.textContent =
    label;


  statusBadge.dataset.status =
    status;
}


/* =========================================================
  동기화 진행률 표시
========================================================= */

function updateLegacySyncProgress(
  current,
  total,
  text
) {
  const progressElement =
    document.getElementById(
      "legacySyncProgress"
    );

  const progressBar =
    document.getElementById(
      "legacySyncProgressBar"
    );

  const progressText =
    document.getElementById(
      "legacySyncProgressText"
    );

  const progressPercent =
    document.getElementById(
      "legacySyncProgressPercent"
    );


  const safeTotal =
    Math.max(
      Number(total) || 1,
      1
    );


  const safeCurrent =
    Math.min(
      Math.max(
        Number(current) || 0,
        0
      ),
      safeTotal
    );


  const percent =
    Math.round(
      (
        safeCurrent /
        safeTotal
      ) *
      100
    );


  if (progressElement) {
    progressElement.hidden =
      false;
  }


  if (progressBar) {
    progressBar.style.width =
      `${percent}%`;
  }


  if (progressText) {
    progressText.textContent =
      String(
        text ||
        "동기화 중입니다."
      );
  }


  if (progressPercent) {
    progressPercent.textContent =
      `${percent}%`;
  }
}


/* =========================================================
  마지막 동기화 결과 저장
========================================================= */

function saveLegacySyncLastResult(
  syncResult
) {
  localStorage.setItem(
    LEGACY_SYNC_STORAGE_KEY,
    JSON.stringify(
      syncResult
    )
  );
}


/* =========================================================
  마지막 동기화 결과 화면 표시
========================================================= */

function renderLegacySyncLastResult(
  syncResult = null
) {
  const lastRunElement =
    document.getElementById(
      "legacySyncLastRun"
    );

  const lastRangeElement =
    document.getElementById(
      "legacySyncLastRange"
    );

  const lastResultElement =
    document.getElementById(
      "legacySyncLastResult"
    );


  let result =
    syncResult;


  if (!result) {
    const savedResult =
      localStorage.getItem(
        LEGACY_SYNC_STORAGE_KEY
      );


    if (savedResult) {
      try {
        result =
          JSON.parse(
            savedResult
          );
      } catch {
        localStorage.removeItem(
          LEGACY_SYNC_STORAGE_KEY
        );
      }
    }
  }


  if (!result) {
    if (lastRunElement) {
      lastRunElement.textContent =
        "기록 없음";
    }

    if (lastRangeElement) {
      lastRangeElement.textContent =
        "-";
    }

    if (lastResultElement) {
      lastResultElement.textContent =
        "-";
    }

    return;
  }


  if (lastRunElement) {
    lastRunElement.textContent =
      formatDateTime(
        result.completedAt
      );
  }


  if (lastRangeElement) {
    lastRangeElement.textContent =
      `${result.startDate} ~ ${result.endDate}`;
  }


  if (lastResultElement) {
    lastResultElement.textContent =
      [
        `조회 ${result.fetchedCount}건`,
        `신규 ${result.createdCount}건`,
        `갱신 ${result.updatedCount}건`,
        `실패 ${result.failedDateCount}일`
      ].join(" / ");
  }
}


/* =========================================================
  동기화 기간 기본값

  시작일:
  오늘 기준 30일 전

  종료일:
  오늘
========================================================= */

function setDefaultLegacySyncDateRange() {
  const startDateInput =
    document.getElementById(
      "legacySyncStartDate"
    );

  const endDateInput =
    document.getElementById(
      "legacySyncEndDate"
    );


  if (
    !startDateInput ||
    !endDateInput
  ) {
    return;
  }


  const today =
    new Date();


  const thirtyDaysAgo =
    new Date(
      today
    );


  thirtyDaysAgo.setDate(
    thirtyDaysAgo.getDate() - 30
  );


  if (
    !startDateInput.value
  ) {
    startDateInput.value =
      formatLegacySyncDate(
        thirtyDaysAgo
      );
  }


  if (
    !endDateInput.value
  ) {
    endDateInput.value =
      formatLegacySyncDate(
        today
      );
  }
}


/* =========================================================
  과거 업무일지 동기화 실행
========================================================= */

async function runLegacyLogSync() {
  const startDateInput =
    document.getElementById(
      "legacySyncStartDate"
    );

  const endDateInput =
    document.getElementById(
      "legacySyncEndDate"
    );

  const runButton =
    document.getElementById(
      "runLegacySyncButton"
    );


  const startDate =
    String(
      startDateInput?.value ||
      ""
    ).trim();


  const endDate =
    String(
      endDateInput?.value ||
      ""
    ).trim();


  if (
    !startDate ||
    !endDate
  ) {
    showLegacySyncMessage(
      "시작일과 종료일을 선택해 주세요.",
      "error"
    );

    return;
  }


  const chunks =
    createLegacySyncDateChunks(
      startDate,
      endDate
    );


  if (
    !chunks.length
  ) {
    showLegacySyncMessage(
      "동기화 기간을 확인해 주세요.",
      "error"
    );

    return;
  }


  const shouldRun =
    window.confirm(
      [
        "과거 업무일지를 동기화하시겠습니까?",
        "",
        `${startDate} ~ ${endDate}`,
        `총 ${chunks.length}회로 나누어 처리합니다.`,
        "",
        "이미 저장된 자료는 최신 내용으로 갱신됩니다."
      ].join("\n")
    );


  if (!shouldRun) {
    return;
  }


  if (runButton) {
    runButton.disabled =
      true;

    runButton.textContent =
      "동기화 중...";
  }


  setLegacySyncStatus(
    "running",
    "진행 중"
  );


  showLegacySyncMessage(
    "과거 업무일지를 동기화하고 있습니다.",
    "info"
  );


  updateLegacySyncProgress(
    0,
    chunks.length,
    "동기화를 준비하고 있습니다."
  );


  let fetchedCount = 0;

  let createdCount = 0;

  let updatedCount = 0;

  let failedDateCount = 0;


  try {
    for (
      let chunkIndex = 0;
      chunkIndex <
        chunks.length;
      chunkIndex += 1
    ) {
      const chunk =
        chunks[
          chunkIndex
        ];


      updateLegacySyncProgress(
        chunkIndex,
        chunks.length,
        `${chunk.startDate} ~ ${chunk.endDate} 동기화 중`
      );


      const response =
        await fetch(
          "/api/legacy-import",
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
                startDate:
                  convertLegacySyncDateToApiFormat(
                    chunk.startDate
                  ),

                endDate:
                  convertLegacySyncDateToApiFormat(
                    chunk.endDate
                  ),

                shift:
                  "ALL"
              })
          }
        );


      const responseText =
        await response.text();


      let result = {};


      try {
        result =
          responseText
            ? JSON.parse(
                responseText
              )
            : {};

      } catch {
        throw new Error(
          `${chunk.startDate} ~ ${chunk.endDate} 서버 응답을 확인할 수 없습니다.`
        );
      }


      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.message ||
          `${chunk.startDate} ~ ${chunk.endDate} 동기화에 실패했습니다.`
        );
      }


      fetchedCount +=
        Number(
          result.fetchedCount ||
          0
        );


      createdCount +=
        Number(
          result.createdCount ||
          0
        );


      updatedCount +=
        Number(
          result.updatedCount ||
          0
        );


      failedDateCount +=
        Number(
          result.failedDateCount ||
          0
        );


      updateLegacySyncProgress(
        chunkIndex + 1,
        chunks.length,
        `${chunk.startDate} ~ ${chunk.endDate} 완료`
      );
    }


    const completedAt =
      new Date()
        .toISOString();


    const finalResult = {
      startDate,

      endDate,

      fetchedCount,

      createdCount,

      updatedCount,

      failedDateCount,

      completedAt
    };


    saveLegacySyncLastResult(
      finalResult
    );


    renderLegacySyncLastResult(
      finalResult
    );


    setLegacySyncStatus(
      failedDateCount > 0
        ? "warning"
        : "complete",

      failedDateCount > 0
        ? "일부 완료"
        : "완료"
    );


    showLegacySyncMessage(
      [
        "과거 업무일지 동기화가 완료되었습니다.",
        `조회 ${fetchedCount}건`,
        `신규 ${createdCount}건`,
        `갱신 ${updatedCount}건`,
        `실패 날짜 ${failedDateCount}일`
      ].join(" / "),
      failedDateCount > 0
        ? "warning"
        : "success"
    );


    updateLegacySyncProgress(
      chunks.length,
      chunks.length,
      "모든 동기화 작업이 완료되었습니다."
    );


    /*
      현재 화면의 선택 날짜 자료를 다시 불러온다.
    */
    if (
      typeof loadLegacyLogsForSelectedDate ===
      "function"
    ) {
      await loadLegacyLogsForSelectedDate();

      renderLogTable();

      updateShiftMemberCardStates();
    }

  } catch (error) {
    console.error(
      "과거 업무일지 동기화 오류:",
      error
    );


    setLegacySyncStatus(
      "error",
      "실패"
    );


    showLegacySyncMessage(
      error.message ||
      "과거 업무일지 동기화에 실패했습니다.",
      "error"
    );

  } finally {
    if (runButton) {
      runButton.disabled =
        false;

      runButton.textContent =
        "과거 업무일지 동기화";
    }
  }
}


/* =========================================================
  과거 업무일지 동기화 초기화
========================================================= */

function initializeLegacySyncPanel() {
  const runButton =
    document.getElementById(
      "runLegacySyncButton"
    );


  if (!runButton) {
    return;
  }


  setDefaultLegacySyncDateRange();


  renderLegacySyncLastResult();


  setLegacySyncStatus(
    "ready",
    "대기"
  );


  runButton.addEventListener(
    "click",
    runLegacyLogSync
  );
}


document.addEventListener(
  "DOMContentLoaded",
  initializeLegacySyncPanel
);

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
      비고 내역
    ====================================================== */

    noteEntryTableBody:
      document.getElementById(
        "noteEntryTableBody"
      ),

    noteEntryCount:
      document.getElementById(
        "noteEntryCount"
      ),

    selectAllNoteEntriesCheckbox:
      document.getElementById(
        "selectAllNoteEntriesCheckbox"
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
      업무일지 메인 목록
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
===================================================== */

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

printLogDetailButton:
  document.getElementById(
    "printLogDetailButton"
  ),

cancelApprovalFromDetailButton:
  document.getElementById(
    "cancelApprovalFromDetailButton"
  ),

approveFromDetailButton:
  document.getElementById(
    "approveFromDetailButton"
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
  D1에 보관된 과거 업무일지 1일 불러오기

  조회 화면에서 지정한 날짜의
  D/S와 N/S 저장 자료를 모두 가져온다.

  과거 서버는 호출하지 않는다.
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


  const requestUrl =
    new URL(
      "/api/legacy-logs",
      window.location.origin
    );


  /*
    shift를 지정하지 않으면
    해당 날짜의 D/S와 N/S를 모두 반환한다.
  */
  requestUrl.searchParams.set(
    "date",
    normalizedDate
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
      `${normalizedDate} D1 과거 업무일지 응답을 읽을 수 없습니다.`
    );
  }


  if (
    !response.ok ||
    !result.success
  ) {
    throw new Error(
      result.message ||
      `${normalizedDate} 저장된 과거 업무일지를 불러오지 못했습니다.`
    );
  }


  const storedItems =
    Array.isArray(
      result.items
    )
      ? result.items
      : [];


  /*
    D1에는 화면용 정보와 함께
    과거 서버 원본이 original에 보관되어 있다.

    기존 변환 함수가 원본 구조를 사용하므로
    original을 다시 전달한다.
  */
  const convertedLogs =
    storedItems
      .map(
        (
          storedItem,
          itemIndex
        ) => {
          const originalItem =
            storedItem?.original &&
            typeof storedItem.original ===
              "object"
              ? storedItem.original
              : null;


          if (!originalItem) {
            console.warn(
              "과거 업무일지 원본이 없어 제외했습니다.",
              storedItem
            );

            return null;
          }


          const storedShift =
            String(
              storedItem.shift ||
              ""
            )
              .trim()
              .toUpperCase();


          return convertLegacyDiaryToLog(
            originalItem,
            itemIndex,
            normalizedDate,
            storedShift
          );
        }
      )
      .filter(Boolean);


  /*
    2026-07-21까지의 과거 자료는
    기존 파트장 취합 구조를 동일하게 적용한다.

    D/S와 N/S가 섞이지 않도록
    근무별로 따로 재구성한다.
  */
  if (
    normalizedDate <=
    "2026-07-21"
  ) {
    const dsLogs =
      convertedLogs.filter(
        log => {
          return (
            log.shift ===
            "DS"
          );
        }
      );


    const nsLogs =
      convertedLogs.filter(
        log => {
          return (
            log.shift ===
            "NS"
          );
        }
      );


    rebuildLegacyLeaderLogFromMemberLogs(
      dsLogs
    );


    rebuildLegacyLeaderLogFromMemberLogs(
      nsLogs
    );
  }


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
  TO · BO1 · BO2 전 근무자 운전현황 가져오기
  1단계

  현재 근무 기준 직전 근무:
  DS → 전날 NS
  NS → 같은 날 DS
========================================================= */


/* =========================================================
  전 근무 날짜·근무 계산
========================================================= */

function getPreviousShiftContext(
  dateValue,
  shiftValue
) {
  const normalizedDate =
    String(
      dateValue ||
      ""
    ).trim();


  const normalizedShift =
    String(
      shiftValue ||
      ""
    )
      .trim()
      .toUpperCase();


  const currentDate =
    new Date(
      `${normalizedDate}T00:00:00`
    );


  if (
    Number.isNaN(
      currentDate.getTime()
    )
  ) {
    return null;
  }


  /*
    현재 N/S 작성 중이면
    바로 전 근무는 같은 날짜 D/S
  */
  if (
    normalizedShift ===
    "NS"
  ) {
    return {
      date:
        formatInputDate(
          currentDate
        ),

      shift:
        "DS"
    };
  }


  /*
    현재 D/S 작성 중이면
    바로 전 근무는 전날 N/S
  */
  if (
    normalizedShift ===
    "DS"
  ) {
    currentDate.setDate(
      currentDate.getDate() - 1
    );


    return {
      date:
        formatInputDate(
          currentDate
        ),

      shift:
        "NS"
    };
  }


  return null;
}


/* =========================================================
  지정 날짜의 D1 업무일지 조회
========================================================= */

async function loadLegacyLogsForOperationStatusDate(
  dateValue
) {
  const normalizedDate =
    String(
      dateValue ||
      ""
    ).trim();


  if (!normalizedDate) {
    return [];
  }


  const requestUrl =
    new URL(
      "/api/legacy-logs",
      window.location.origin
    );


  requestUrl.searchParams.set(
    "date",
    normalizedDate
  );


  requestUrl.searchParams.set(
    "_",
    String(
      Date.now()
    )
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

  } catch {
    throw new Error(
      "전 근무자 업무일지 응답을 읽을 수 없습니다."
    );
  }


  if (
    !response.ok ||
    !result.success
  ) {
    throw new Error(
      result.message ||
      "전 근무자 업무일지를 불러오지 못했습니다."
    );
  }


  const storedItems =
    Array.isArray(
      result.items
    )
      ? result.items
      : [];


  return storedItems
    .map(
      (
        storedItem,
        itemIndex
      ) => {
        const originalItem =
          storedItem?.original &&
          typeof storedItem.original ===
            "object"
            ? storedItem.original
            : null;


        if (!originalItem) {
          return null;
        }


        const storedShift =
          String(
            storedItem.shift ||
            ""
          )
            .trim()
            .toUpperCase();


        return convertLegacyDiaryToLog(
          originalItem,
          itemIndex,
          normalizedDate,
          storedShift
        );
      }
    )
    .filter(
      Boolean
    );
}


/* =========================================================
  TO · BO1 · BO2 이전 근무 운전현황 찾기

  조회 순서:
  1. 현재 화면에 불러온 신규 업무일지
  2. D1에 저장된 과거 업무일지

  대상:
  - TO
  - BO1
  - BO2

  이전 근무:
  - 현재 N/S → 같은 날짜 D/S
  - 현재 D/S → 전날 N/S
========================================================= */

async function getPreviousShiftOperationStatus(
  roleValue,
  dateValue,
  shiftValue
) {
  const normalizedRole =
    normalizeMemberLogRole(
      roleValue
    );


  const allowedRoles = [
    "TO",
    "BO1",
    "BO2"
  ];


  if (
    !allowedRoles.includes(
      normalizedRole
    )
  ) {
    return null;
  }


  const previousContext =
    getPreviousShiftContext(
      dateValue,
      shiftValue
    );


  if (
    !previousContext
  ) {
    return null;
  }


  /* =====================================================
    업무일지 배열에서 조건에 맞는 최신 자료 찾기
  ====================================================== */

  const findLatestOperationStatus =
    (
      sourceLogs
    ) => {
      const safeLogs =
        Array.isArray(
          sourceLogs
        )
          ? sourceLogs
          : [];


      const matchedLogs =
        safeLogs
          .filter(
            (
              log
            ) => {
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


              const operationStatus =
                String(
                  log?.operationStatus ||
                  ""
                ).trim();


              return (
                logDate ===
                  previousContext.date &&

                logShift ===
                  previousContext.shift &&

                logRole ===
                  normalizedRole &&

                Boolean(
                  operationStatus
                )
              );
            }
          )
          .sort(
            (
              firstLog,
              secondLog
            ) => {
              const firstTime =
                new Date(
                  firstLog?.updatedAt ||
                  firstLog?.createdAt ||
                  0
                ).getTime();


              const secondTime =
                new Date(
                  secondLog?.updatedAt ||
                  secondLog?.createdAt ||
                  0
                ).getTime();


              return (
                secondTime -
                firstTime
              );
            }
          );


      return (
        matchedLogs[0] ||
        null
      );
    };


  /* =====================================================
    1. 신규 GS Shift Log 자료 우선 확인
  ====================================================== */

  const currentAppLog =
    findLatestOperationStatus(
      appState.logs
    );


  if (
    currentAppLog
  ) {
    return {
      role:
        normalizedRole,

      date:
        previousContext.date,

      shift:
        previousContext.shift,

      author:
        String(
          currentAppLog.author ||
          ""
        ).trim(),

      content:
        String(
          currentAppLog.operationStatus ||
          ""
        ).trim(),

      type:
        normalizeOperationStatusType(
          currentAppLog.operationStatusType ||
          "normal"
        ),

      source:
        "current-log",

      sourceLog:
        currentAppLog
    };
  }


  /* =====================================================
    2. D1 과거 업무일지 확인
  ====================================================== */

  const previousLogs =
    await loadLegacyLogsForOperationStatusDate(
      previousContext.date
    );


  const previousLog =
    findLatestOperationStatus(
      previousLogs
    );


  if (
    !previousLog
  ) {
    return null;
  }


  return {
    role:
      normalizedRole,

    date:
      previousContext.date,

    shift:
      previousContext.shift,

    author:
      String(
        previousLog.author ||
        ""
      ).trim(),

    content:
      String(
        previousLog.operationStatus ||
        ""
      ).trim(),

    type:
      normalizeOperationStatusType(
        previousLog.operationStatusType ||
        "normal"
      ),

    source:
      "legacy-log",

    sourceLog:
      previousLog
  };
}

/* =========================================================
  선택 날짜의 D1 과거 업무일지 불러오기

  과거 서버를 직접 호출하지 않고
  legacy_logs 테이블에 보관된 자료만 사용한다.
========================================================= */

async function loadLegacyLogsForSelectedDate() {
  const selectedDate =
    formatInputDate(
      appState.selectedDate
    );


  try {
    const requestUrl =
      new URL(
        "/api/legacy-logs",
        window.location.origin
      );


    /*
      근무값을 지정하지 않아
      선택 날짜의 D/S와 N/S를 한 번에 불러온다.
    */
    requestUrl.searchParams.set(
      "date",
      selectedDate
    );


    /*
      이전 응답이나 브라우저 캐시를 피한다.
    */
    requestUrl.searchParams.set(
      "_",
      String(
        Date.now()
      )
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

    } catch {
      throw new Error(
        "D1 과거 업무일지 응답을 읽을 수 없습니다."
      );
    }


    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.message ||
        "저장된 과거 업무일지를 불러오지 못했습니다."
      );
    }


    /*
      이전에 메모리에 불러온 같은 날짜의
      과거 자료만 제거한다.

      GS Shift Log에서 직접 작성한 신규 업무일지는 유지한다.
    */
    appState.logs =
      appState.logs.filter(
        log => {
          const isSameDate =
            String(
              log.date ||
              ""
            ).trim() ===
            selectedDate;


          const isLegacyLog =
            String(
              log.source ||
              ""
            ).startsWith(
              "legacy"
            );


          return !(
            isSameDate &&
            isLegacyLog
          );
        }
      );


    const storedItems =
      Array.isArray(
        result.items
      )
        ? result.items
        : [];


    const convertedLogs =
      storedItems
        .map(
          (
            storedItem,
            itemIndex
          ) => {
            const originalItem =
              storedItem?.original &&
              typeof storedItem.original ===
                "object"
                ? storedItem.original
                : null;


            if (!originalItem) {
              console.warn(
                "과거 업무일지 원본이 없어 제외했습니다.",
                storedItem
              );

              return null;
            }


            const storedShift =
              String(
                storedItem.shift ||
                ""
              )
                .trim()
                .toUpperCase();


            const convertedLog =
              convertLegacyDiaryToLog(
                originalItem,
                itemIndex,
                selectedDate,
                storedShift
              );


            if (!convertedLog) {
              return null;
            }


            /*
              legacy-logs API에서 반환한 첨부파일을
              변환된 업무일지에 그대로 연결한다.

              기존 코드에서는 original만 넘기면서
              storedItem.attachments가 유실되고 있었다.
            */
            convertedLog.attachments =
              Array.isArray(
                storedItem.attachments
              )
                ? storedItem.attachments
                    .map(
                      attachment => {
                        const attachmentId =
                          Number(
                            attachment?.id ||
                            0
                          );


                        const fileName =
                          String(
                            attachment?.fileName ||
                            attachment?.name ||
                            ""
                          ).trim();


                        const attachmentUrl =
                          String(
                            attachment?.url ||
                            (
                              attachmentId
                                ? `/api/legacy-attachment?id=${encodeURIComponent(
                                    attachmentId
                                  )}`
                                : ""
                            )
                          ).trim();


                        return {
                          id:
                            attachmentId,

                          name:
                            fileName,

                          fileName,

                          mimeType:
                            String(
                              attachment?.mimeType ||
                              ""
                            ).trim(),

                          fileSize:
                            Number(
                              attachment?.fileSize ||
                              0
                            ),

                          r2Key:
                            String(
                              attachment?.r2Key ||
                              ""
                            ).trim(),

                          originalUrl:
                            String(
                              attachment?.originalUrl ||
                              ""
                            ).trim(),

                          uploadedAt:
                            String(
                              attachment?.uploadedAt ||
                              ""
                            ).trim(),

                          url:
                            attachmentUrl
                        };
                      }
                    )
                    .filter(
                      attachment => {
                        return Boolean(
                          attachment.url
                        );
                      }
                    )
                : [];


            convertedLog.legacyAttachmentCount =
              convertedLog
                .attachments
                .length;


            return convertedLog;
          }
        )
        .filter(Boolean);


    /*
      과거 파트장 업무일지는
      D/S와 N/S별로 분리하여 재구성한다.
    */
    if (
      selectedDate <=
      "2026-07-21"
    ) {
      const dsLogs =
        convertedLogs.filter(
          log => {
            return (
              log.shift ===
              "DS"
            );
          }
        );


      const nsLogs =
        convertedLogs.filter(
          log => {
            return (
              log.shift ===
              "NS"
            );
          }
        );


      rebuildLegacyLeaderLogFromMemberLogs(
        dsLogs
      );


      rebuildLegacyLeaderLogFromMemberLogs(
        nsLogs
      );
    }


    /*
      D1 과거 자료를 먼저 넣고
      신규 GS Shift Log 자료는 그대로 유지한다.
    */
    appState.logs = [
      ...convertedLogs,
      ...appState.logs
    ];


    const dsCount =
      convertedLogs.filter(
        log => {
          return (
            log.shift ===
            "DS"
          );
        }
      ).length;


    const nsCount =
      convertedLogs.filter(
        log => {
          return (
            log.shift ===
            "NS"
          );
        }
      ).length;


    const attachmentCount =
      convertedLogs.reduce(
        (
          total,
          log
        ) => {
          return (
            total +
            (
              Array.isArray(
                log.attachments
              )
                ? log.attachments.length
                : 0
            )
          );
        },
        0
      );


    console.log(
      [
        `D1 과거 업무일지 D/S ${dsCount}건`,
        `N/S ${nsCount}건`,
        `첨부파일 ${attachmentCount}건을 불러왔습니다.`
      ].join(", ")
    );

  } catch (error) {
    console.error(
      "D1 과거 업무일지 불러오기 실패:",
      error
    );


    /*
      D1 조회에 실패해도
      신규 GS Shift Log 기능은 계속 작동한다.
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

/* =========================================================
  기존 업무일지 1건을 현재 구조로 변환 최종본

  이전 시스템 원본 body index 기준

  일반 보직:
  index 0 : 운전현황
  index 1 : TM 발행 내역
  index 2 : 인계 및 작업 내역
  index 3 : 비고

  현재 파트장 통합 구조:
  index 0 : 운전현황
  index 1 : TM 발행 내역
  index 2 : 통합 인계 및 작업 내역
  index 4 : 비고

  과거 파트장 보직별 구조:
  index 2 : TGO
  index 3 : BCO1
  index 4 : BCO2
  index 5 : TO
  index 6 : BO1
  index 7 : BO2
  index 8 : 파트장

  기존 호환:
  - entries 단일 배열 유지
  - note 문자열 유지

  주의:
  과거 파트장 재구성 함수와 충돌하지 않도록
  legacy 변환 단계에서는 분리 배열을 직접 만들지 않고
  entries의 category로 정확히 구분한다.
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


  const normalizedRole =
    normalizeMemberLogRole(
      role
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


  const importedFromLogId =
    `legacy-${legacyId}`;


  /* =====================================================
    body index별 원문 확인
  ====================================================== */

  const getBodyContent = (
    targetIndex
  ) => {
    return getLegacyBodyContent(
      bodyEntries,
      targetIndex
    );
  };


  const index2Content =
    getBodyContent(
      2
    );


  const index3Content =
    getBodyContent(
      3
    );


  const index4Content =
    getBodyContent(
      4
    );


  const index5Content =
    getBodyContent(
      5
    );


  const index6Content =
    getBodyContent(
      6
    );


  const index7Content =
    getBodyContent(
      7
    );


  const index8Content =
    getBodyContent(
      8
    );


  const index9Content =
    getBodyContent(
      9
    );


  /* =====================================================
    파트장 자료 구조 판별

    현재 통합 구조 예:
    index 2 : 전체 운전 및 작업사항
    index 3 : 빈칸
    index 4 : 비고
    index 5~9 : 빈칸

    과거 보직별 구조 예:
    index 2~8에 각 보직별 업무가 저장됨
  ====================================================== */

  const hasLeaderRoleSeparatedContent =
    normalizedRole ===
      "파트장" &&
    Boolean(
      index3Content ||
      index5Content ||
      index6Content ||
      index7Content ||
      index8Content
    );


  const isLeaderCombinedStructure =
    normalizedRole ===
      "파트장" &&
    !hasLeaderRoleSeparatedContent &&
    Boolean(
      index2Content ||
      index4Content
    );


  /* =====================================================
    body index → category 판정
  ====================================================== */

  const getLegacyCategory = (
    bodyIndex
  ) => {
    const index =
      Number(
        bodyIndex
      );


    /*
      운전현황
    */
    if (
      index ===
      0
    ) {
      return "";
    }


    /*
      TM 발행 내역
    */
    if (
      index ===
      1
    ) {
      return "TM 발행";
    }


    /*
      일반 보직

      index 2 : 인계사항
      index 3 : 비고
    */
    if (
      normalizedRole !==
      "파트장"
    ) {
      if (
        index ===
        3
      ) {
        return "비고";
      }


      if (
        index ===
        2
      ) {
        return "인계사항";
      }


      /*
        예상하지 못한 추가 영역은
        데이터 유실 방지를 위해 인계사항으로 유지한다.
      */
      return "인계사항";
    }


    /*
      현재 파트장 통합 구조

      index 2 : 인계 및 작업 내역
      index 4 : 비고
    */
    if (
      isLeaderCombinedStructure
    ) {
      if (
        index ===
        4
      ) {
        return "비고";
      }


      if (
        index ===
        2
      ) {
        return "인계사항";
      }


      return "인계사항";
    }


    /*
      과거 파트장 보직별 구조

      index 2~8 : 보직별 업무
      index 9   : 비고가 존재하는 자료 호환
    */
    if (
      index ===
      9
    ) {
      return "비고";
    }


    return "인계사항";
  };


  /* =====================================================
    항목의 출처 보직 판정
  ====================================================== */

  const getLegacySourceRole = (
    bodyIndex,
    category
  ) => {
    const index =
      Number(
        bodyIndex
      );


    if (
      category ===
      "TM 발행"
    ) {
      return "";
    }


    if (
      category ===
      "비고"
    ) {
      return normalizedRole;
    }


    /*
      일반 보직의 업무는 본인 보직
    */
    if (
      normalizedRole !==
      "파트장"
    ) {
      return normalizedRole;
    }


    /*
      현재 파트장 통합 구조는
      파트장 업무일지 본문으로 처리한다.
    */
    if (
      isLeaderCombinedStructure
    ) {
      return "파트장";
    }


    /*
      과거 파트장 보직별 구조
    */
    return convertLegacyBodyIndexToRole(
      index,
      normalizedRole
    );
  };


  /* =====================================================
    변환 결과
  ====================================================== */

  const entries = [];


  bodyEntries.forEach(
    (
      bodyItem,
      bodyArrayIndex
    ) => {
      const bodyIndex =
        Number(
          bodyItem?.index ??
          bodyArrayIndex
        );


      const rawContent =
        String(
          bodyItem?.content ||
          ""
        );


      /*
        빈 영역과 운전현황 제외
      */
      if (
        !rawContent.trim() ||
        bodyIndex ===
        0
      ) {
        return;
      }


      const category =
        getLegacyCategory(
          bodyIndex
        );


      if (
        !category
      ) {
        return;
      }


      const sourceRole =
        getLegacySourceRole(
          bodyIndex,
          category
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
          const parsedContent =
            category ===
            "TM 발행"
              ? extractLegacyTagFromContent(
                  parsedLine.content
                )
              : {
                  tag:
                    "",

                  content:
                    parsedLine.content
                };


          const content =
            String(
              parsedContent.content ||
              ""
            ).trim();


          if (
            !content
          ) {
            return;
          }


          entries.push({
            id: [
              "legacy-entry",
              legacyId,
              bodyIndex,
              lineIndex
            ].join("-"),

            category,

            time:
              String(
                parsedLine.time ||
                ""
              ).trim(),

            tag:
              String(
                parsedContent.tag ||
                ""
              )
                .trim()
                .toUpperCase(),

            content,

            attachmentName:
              "",

            /*
              파트장 취합 및 상세보기의
              보직별 구분에 사용한다.
            */
            importedFromRole:
              sourceRole,

            importedFromAuthor:
              author,

            importedFromLogId,

            importedFromEntryIndex:
              lineIndex,

            legacyBodyIndex:
              bodyIndex,

            legacyLineIndex:
              lineIndex,

            source:
              category ===
                "비고"
                ? "legacy-remark"
                : "legacy"
          });
        }
      );
    }
  );


  /* =====================================================
    기존 note 문자열 호환

    비고 항목을 줄 단위 문자열로도 보관한다.
    새 화면에서는 entries의 category === 비고를 사용한다.
  ====================================================== */

  const remarkEntries =
    entries.filter(
      (
        entry
      ) => {
        return (
          String(
            entry.category ||
            ""
          ).trim() ===
          "비고"
        );
      }
    );


  const note =
    remarkEntries
      .map(
        (
          entry,
          remarkIndex
        ) => {
          const content =
            String(
              entry.content ||
              ""
            ).trim();


          return content
            ? `${remarkIndex + 1}. ${content}`
            : "";
        }
      )
      .filter(Boolean)
      .join("\n");


  return {
    id:
      importedFromLogId,

    date:
      selectedDate,

    shift:
      String(
        selectedShift ||
        ""
      )
        .trim()
        .toUpperCase(),

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
      기존 GROUP_1, GROUP_2 값은
      현재 화면에서 사용하지 않는다.
    */
    group:
      "",

    operationStatus,

    /*
      기존 호환 단일 배열

      category 값으로 다음을 구분한다.
      - TM 발행
      - 인계사항
      - 비고
    */
    entries,

    /*
      기존 note 필드 호환
    */
    note,

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
      legacyItem.version ??
      0,

    legacyStructure:
      normalizedRole !==
        "파트장"
        ? "member"
        : (
            isLeaderCombinedStructure
              ? "leader-combined"
              : "leader-role-separated"
          ),

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
  기존 업무일지 내용 줄 분석 최종본

  핵심 규칙:
  - 번호가 있는 줄만 새로운 항목으로 시작한다.
  - 번호가 없는 줄은 바로 위 항목의 후속 내용으로 붙인다.
  - 14:10, 17:52 같은 시간은 번호로 인식하지 않는다.
  - 원본에 저장된 항목 순서를 그대로 유지한다.

  지원 번호:
  1. 내용
  2) 내용
  3 - 내용
  ① 내용

  지원하지 않는 번호:
  14: 내용

  이유:
  14:10 같은 시간을 항목 번호로 잘못 판단할 수 있기 때문이다.
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


  /*
    숫자 뒤에는 다음 기호만 번호로 인정한다.

    .
    )
    -

    콜론(:)은 절대 포함하지 않는다.
  */
  const numberedLinePattern =
    /^\s*(?:\d+\s*(?:[.)]|-\s+)\s*|[①②③④⑤⑥⑦⑧⑨⑩]\s*)(.*)$/;


  sourceLines.forEach(
    (
      sourceLine
    ) => {
      const originalLine =
        String(
          sourceLine || ""
        )
          .replace(
            /\t/g,
            " "
          )
          .trim();


      /*
        빈 줄은 건너뛴다.
      */
      if (
        !originalLine
      ) {
        return;
      }


      const numberedMatch =
        originalLine.match(
          numberedLinePattern
        );


      /* ===================================================
        번호가 있는 줄

        새로운 항목 시작
      ==================================================== */

      if (
        numberedMatch
      ) {
        const numberedContent =
          String(
            numberedMatch[1] ||
            ""
          ).trim();


        if (
          !numberedContent
        ) {
          return;
        }


        const parsedTimeExpression =
          parseLeadingLogTimeExpression(
            numberedContent
          );


        /*
          번호 다음에 시간과 내용이 모두 있는 경우

          4. 08:30 작업 내용
        */
        if (
          parsedTimeExpression.timeText &&
          parsedTimeExpression.content
        ) {
          parsedEntries.push({
            time:
              String(
                parsedTimeExpression.timeText ||
                ""
              ).trim(),

            content:
              String(
                parsedTimeExpression.content ||
                ""
              ).trim()
          });


          return;
        }


        /*
          시간 표현이 없는 번호 항목
        */
        parsedEntries.push({
          time:
            "",

          content:
            numberedContent
        });


        return;
      }


      /* ===================================================
        번호가 없는 줄

        무조건 바로 위 항목의 후속 내용으로 연결한다.

        예:
        4. 08:30 하역 라인 막힘 발생
           14:10 Booster Air Line 점검

        결과:
        하나의 4번 항목으로 유지
      ==================================================== */

      if (
        parsedEntries.length >
        0
      ) {
        const previousEntry =
          parsedEntries[
            parsedEntries.length - 1
          ];


        previousEntry.content = [
          String(
            previousEntry.content ||
            ""
          ).trim(),

          originalLine
        ]
          .filter(Boolean)
          .join("\n");


        return;
      }


      /* ===================================================
        첫 번째 줄부터 번호가 없는 예외 자료

        데이터 유실 방지를 위해 첫 항목으로 생성한다.
      ==================================================== */

      const parsedTimeExpression =
        parseLeadingLogTimeExpression(
          originalLine
        );


      if (
        parsedTimeExpression.timeText &&
        parsedTimeExpression.content
      ) {
        parsedEntries.push({
          time:
            String(
              parsedTimeExpression.timeText ||
              ""
            ).trim(),

          content:
            String(
              parsedTimeExpression.content ||
              ""
            ).trim()
        });


        return;
      }


      parsedEntries.push({
        time:
          "",

        content:
          originalLine
      });
    }
  );


  return parsedEntries.filter(
    (
      entry
    ) => {
      return Boolean(
        String(
          entry.content ||
          ""
        ).trim()
      );
    }
  );
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
  운전현황 상태값 정규화

  지원 상태:
  - normal
  - starting
  - stopped
  - abnormal
  - emergency

  한글 상태명과 과거 저장값도
  현재 영문 상태값으로 변환한다.
========================================================= */

function normalizeOperationStatusType(
  type
) {
  const normalizedType =
    String(
      type || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /\s+/g,
        ""
      );


  const typeMap = {
    /*
      정상운전
    */
    normal:
      "normal",

    정상:
      "normal",

    정상운전:
      "normal",

    running:
      "normal",

    run:
      "normal",


    /*
      기동
    */
    starting:
      "starting",

    start:
      "starting",

    startup:
      "starting",

    기동:
      "starting",

    기동중:
      "starting",


    /*
      정지
    */
    stopped:
      "stopped",

    stop:
      "stopped",

    shutdown:
      "stopped",

    정지:
      "stopped",

    정지중:
      "stopped",

    만수보존:
      "stopped",

    보존중:
      "stopped",

    대기:
      "stopped",


    /*
      이상
    */
    abnormal:
      "abnormal",

    warning:
      "abnormal",

    이상:
      "abnormal",

    고장:
      "abnormal",

    불량:
      "abnormal",


    /*
      비상
    */
    emergency:
      "emergency",

    trip:
      "emergency",

    비상:
      "emergency",

    트립:
      "emergency",

    긴급:
      "emergency"
  };


  const convertedType =
    typeMap[
      normalizedType
    ];


  /*
    정상적으로 변환된 상태값
  */
  if (
    convertedType
  ) {
    return convertedType;
  }


  /*
    이미 허용된 영문 상태라면 그대로 사용
  */
  if (
    typeof OPERATION_STATUS_TYPES !==
      "undefined" &&
    Array.isArray(
      OPERATION_STATUS_TYPES
    ) &&
    OPERATION_STATUS_TYPES.includes(
      normalizedType
    )
  ) {
    return normalizedType;
  }


  /*
    알 수 없는 값은 정상운전으로 처리
  */
  return "normal";
}


/* =========================================================
  운전현황 상태 표시 이름

  내부 저장값 abnormal은 기존 자료 호환을 위해 유지하고,
  화면에는 "보존"으로 표시한다.
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
      "보존",

    emergency:
      "비상"
  };


  return (
    labelMap[
      normalizeOperationStatusType(
        type
      )
    ] ||
    "정상운전"
  );
}


/* =========================================================
  설비별 운전현황 항목 구조

  새 저장 구조:

  operationItems: [
    {
      id: "operation-item-...",
      name: "터빈",
      type: "normal",
      content: "정상 운전 중"
    },
    {
      id: "operation-item-...",
      name: "#3호기 보조 보일러",
      type: "stopped",
      content: "만수 보존 중"
    }
  ]

  기존 type + content 구조도 계속 유지하여
  과거 업무일지와 호환한다.
========================================================= */


/* =========================================================
  운전현황 항목 ID 생성
========================================================= */

function createOperationStatusItemId() {
  return [
    "operation-item",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2, 9)
  ].join("-");
}


/* =========================================================
  운전현황 내용으로 상태 자동 판정

  정상운전:
  정상, 정상운전, 정상 운전

  기동:
  기동, 기동 중, Startup

  정지:
  정지, 만수보존, 만수 보존,
  보존 중, 장기정지, 대기

  이상:
  이상, 고장, 불량, 점검 필요

  비상:
  비상, Trip, 트립, 긴급
========================================================= */

function inferOperationStatusTypeFromText(
  text
) {
  const normalizedText =
    String(
      text || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /\s+/g,
        ""
      );


  if (
    !normalizedText
  ) {
    return "normal";
  }


  /*
    비상 상태를 가장 먼저 확인한다.
  */
  if (
    normalizedText.includes(
      "비상"
    ) ||
    normalizedText.includes(
      "trip"
    ) ||
    normalizedText.includes(
      "트립"
    ) ||
    normalizedText.includes(
      "긴급"
    )
  ) {
    return "emergency";
  }


  /*
    이상 상태
  */
  if (
    normalizedText.includes(
      "이상"
    ) ||
    normalizedText.includes(
      "고장"
    ) ||
    normalizedText.includes(
      "불량"
    ) ||
    normalizedText.includes(
      "점검필요"
    )
  ) {
    return "abnormal";
  }


  /*
    정지 또는 보존 상태

    만수보존은 실제 운전 중이 아니므로
    정지 상태로 분류한다.
  */
  if (
    normalizedText.includes(
      "만수보존"
    ) ||
    normalizedText.includes(
      "보존중"
    ) ||
    normalizedText.includes(
      "정지"
    ) ||
    normalizedText.includes(
      "장기정지"
    ) ||
    normalizedText.includes(
      "대기"
    )
  ) {
    return "stopped";
  }


  /*
    기동 상태
  */
  if (
    normalizedText.includes(
      "기동"
    ) ||
    normalizedText.includes(
      "startup"
    ) ||
    normalizedText.includes(
      "start-up"
    )
  ) {
    return "starting";
  }


  return "normal";
}

/* =========================================================
  설비별 운전현황 항목 정규화 최종본

  주요 처리:
  - 기존 필드명 호환
  - 상태값 자동 추론
  - BCO1·BCO2 기존 설비명 자동 보정
  - 기존 저장자료의 "설비 1"도 보직에 맞게 변경

  BCO1:
  설비 1 / #1 BLR / BLR1
  → 1호기 주보일러

  BCO2:
  설비 1 / #2 BLR / BLR2
  → 2호기 주보일러
========================================================= */

function normalizeOperationStatusItem(
  item,
  fallbackIndex = 0
) {
  const sourceItem =
    item &&
    typeof item ===
      "object"
      ? item
      : {};


  /* =====================================================
    현재 항목의 보직 확인

    항목 자체의 role·sourceRole을 우선하고,
    없으면 현재 운전현황 보직을 사용한다.
  ====================================================== */

  let itemRole =
    String(
      sourceItem.role ||
      sourceItem.sourceRole ||
      sourceItem.operationRole ||
      ""
    ).trim();


  if (
    !itemRole &&
    typeof getCurrentOperationStatusRole ===
      "function"
  ) {
    itemRole =
      String(
        getCurrentOperationStatusRole() ||
        ""
      ).trim();
  }


  if (
    typeof normalizeMemberLogRole ===
      "function"
  ) {
    itemRole =
      normalizeMemberLogRole(
        itemRole
      );
  }


  /* =====================================================
    설비명
  ====================================================== */

  let name =
    String(
      sourceItem.name ||
      sourceItem.equipmentName ||
      sourceItem.title ||
      ""
    ).trim();


  /*
    비교용 설비명

    공백·특수문자·대소문자 차이를 줄여
    과거 여러 표기법을 함께 보정한다.
  */
  const comparableName =
    name
      .toLowerCase()
      .replace(
        /\s+/g,
        ""
      )
      .replace(
        /[_-]/g,
        ""
      );


  /* =====================================================
    BCO1 기존 설비명 자동 보정
  ====================================================== */

  if (
    itemRole ===
    "BCO1"
  ) {
    const bco1LegacyNames = [
      "",
      "설비1",
      "#1blr",
      "1blr",
      "blr1",
      "#1boiler",
      "1boiler",
      "boiler1",
      "#1주보일러",
      "1주보일러"
    ];


    if (
      bco1LegacyNames.includes(
        comparableName
      )
    ) {
      name =
        "1호기 주보일러";
    }
  }


  /* =====================================================
    BCO2 기존 설비명 자동 보정
  ====================================================== */

  if (
    itemRole ===
    "BCO2"
  ) {
    const bco2LegacyNames = [
      "",
      "설비1",
      "#2blr",
      "2blr",
      "blr2",
      "#2boiler",
      "2boiler",
      "boiler2",
      "#2주보일러",
      "2주보일러"
    ];


    if (
      bco2LegacyNames.includes(
        comparableName
      )
    ) {
      name =
        "2호기 주보일러";
    }
  }


  /* =====================================================
    TGO 기본 설비명 보정

    빈 값이나 설비 1이면 터빈으로 처리한다.
  ====================================================== */

  if (
    itemRole ===
      "TGO" &&
    (
      !name ||
      comparableName ===
        "설비1"
    )
  ) {
    name =
      "터빈";
  }


  /* =====================================================
    운전현황 내용
  ====================================================== */

  const content =
    String(
      sourceItem.content ||
      sourceItem.description ||
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
      .trim();


  /* =====================================================
    운전 상태
  ====================================================== */

  const rawType =
    String(
      sourceItem.type ||
      sourceItem.statusType ||
      sourceItem.operationType ||
      ""
    ).trim();


  const inferredType =
    inferOperationStatusTypeFromText(
      [
        name,
        content
      ].join(" ")
    );


  /* =====================================================
    최종 항목
  ====================================================== */

  return {
    id:
      String(
        sourceItem.id ||
        ""
      ).trim() ||
      [
        "operation-item",
        fallbackIndex,
        Math.random()
          .toString(36)
          .slice(2, 8)
      ].join("-"),


    role:
      itemRole,


    sourceRole:
      String(
        sourceItem.sourceRole ||
        itemRole ||
        ""
      ).trim(),


    name:
      name ||
      `설비 ${fallbackIndex + 1}`,


    type:
      rawType
        ? normalizeOperationStatusType(
            rawType
          )
        : inferredType,


    content:
      content ||
      "상태 내용 없음",


    updatedAt:
      String(
        sourceItem.updatedAt ||
        ""
      ),


    updatedBy:
      String(
        sourceItem.updatedBy ||
        ""
      ).trim()
  };
}


/* =========================================================
  기존 운전현황 문자열 → 설비별 항목 배열

  지원 예시:

  1. 터빈 : 정상 운전 중
  2. #3호기 보조 보일러 : 만수 보존 중
  3. #4호기 보조 보일러 : 만수 보존 중

  또는:

  터빈 정상 운전 중
  #3호기 보조 보일러 만수 보존 중
========================================================= */

function parseOperationStatusContentToItems(
  rawContent
) {
  const normalizedContent =
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
      .trim();


  if (
    !normalizedContent
  ) {
    return [];
  }


  const sourceLines =
    normalizedContent
      .split(
        "\n"
      )
      .map(
        (
          line
        ) => {
          return String(
            line ||
            ""
          ).trim();
        }
      )
      .filter(Boolean);


  const parsedItems = [];


  sourceLines.forEach(
    (
      sourceLine,
      lineIndex
    ) => {
      /*
        앞 번호 제거

        1. 내용
        2) 내용
        3 - 내용
      */
      const line =
        sourceLine
          .replace(
            /^\s*\d+\s*(?:[.)]|-\s+)\s*/,
            ""
          )
          .trim();


      if (
        !line
      ) {
        return;
      }


      /*
        [TGO], [BCO1] 같은 보직 구분 줄은
        설비 항목으로 만들지 않는다.
      */
      if (
        /^\[\s*(?:TGO|BCO1|BCO2|TO|BO1|BO2|파트장)\s*\]$/i
          .test(
            line
          )
      ) {
        return;
      }


      /*
        설비명과 상태 내용을 구분한다.

        지원 구분자:
        :
        ：
        |
      */
      const separatorMatch =
        line.match(
          /^(.+?)\s*(?:[:：|])\s*(.+)$/
        );


      let equipmentName = "";

      let statusContent = "";


      if (
        separatorMatch
      ) {
        equipmentName =
          String(
            separatorMatch[1] ||
            ""
          ).trim();

        statusContent =
          String(
            separatorMatch[2] ||
            ""
          ).trim();

      } else {
        /*
          구분자가 없는 기존 자료는
          전체 문장을 내용으로 보존한다.

          설비명은 임시 이름을 사용하며,
          다음 단계의 편집창에서 사용자가 변경할 수 있다.
        */
        equipmentName =
          `설비 ${lineIndex + 1}`;

        statusContent =
          line;
      }


      if (
        !statusContent
      ) {
        return;
      }


      parsedItems.push(
        normalizeOperationStatusItem(
          {
            id:
              createOperationStatusItemId(),

            name:
              equipmentName,

            type:
              inferOperationStatusTypeFromText(
                [
                  equipmentName,
                  statusContent
                ].join(" ")
              ),

            content:
              statusContent
          },
          parsedItems.length
        )
      );
    }
  );


  return parsedItems;
}


/* =========================================================
  저장된 운전현황 객체 → 설비별 항목 배열

  우선순위:

  1. operationItems
  2. items
  3. 기존 content 문자열 자동 변환
========================================================= */

function getOperationStatusItems(
  status
) {
  const sourceStatus =
    status &&
    typeof status ===
      "object"
      ? status
      : {};


  const savedItems =
    Array.isArray(
      sourceStatus.operationItems
    )
      ? sourceStatus.operationItems
      : (
          Array.isArray(
            sourceStatus.items
          )
            ? sourceStatus.items
            : []
        );


  if (
    savedItems.length
  ) {
    return savedItems
      .map(
        (
          item,
          itemIndex
        ) => {
          return normalizeOperationStatusItem(
            item,
            itemIndex
          );
        }
      )
      .filter(
        (
          item
        ) => {
          return Boolean(
            item.name ||
            item.content
          );
        }
      );
  }


  return parseOperationStatusContentToItems(
    sourceStatus.content
  );
}


/* =========================================================
  설비별 항목 배열 → 기존 문자열 생성

  기존 상세보기, 검색, 과거 코드 호환을 위해
  operationStatus 문자열도 계속 함께 저장한다.

  결과:

  1. 터빈 : 정상 운전 중
  2. #3호기 보조 보일러 : 만수 보존 중
========================================================= */

function serializeOperationStatusItems(
  items
) {
  const normalizedItems =
    (
      Array.isArray(
        items
      )
        ? items
        : []
    )
      .map(
        (
          item,
          itemIndex
        ) => {
          return normalizeOperationStatusItem(
            item,
            itemIndex
          );
        }
      )
      .filter(
        (
          item
        ) => {
          return Boolean(
            item.name ||
            item.content
          );
        }
      );


  return normalizedItems
    .map(
      (
        item,
        itemIndex
      ) => {
        const name =
          String(
            item.name ||
            `설비 ${itemIndex + 1}`
          ).trim();


        const content =
          String(
            item.content ||
            ""
          ).trim();


        return [
          `${itemIndex + 1}.`,
          name,
          ":",
          content
        ].join(" ");
      }
    )
    .join("\n");
}


/* =========================================================
  운전현황 항목 전체 상태 계산

  기존 operationStatusType 호환용 대표 상태다.

  우선순위:
  비상 > 이상 > 기동 > 정지 > 정상

  실제 화면에서는 각 설비 상태를 개별 표시한다.
========================================================= */

function getRepresentativeOperationStatusType(
  items
) {
  const normalizedItems =
    Array.isArray(
      items
    )
      ? items
      : [];


  const priorityMap = {
    emergency:
      5,

    abnormal:
      4,

    starting:
      3,

    stopped:
      2,

    normal:
      1
  };


  let representativeType =
    "normal";


  normalizedItems.forEach(
    (
      item
    ) => {
      const itemType =
        normalizeOperationStatusType(
          item?.type
        );


      if (
        (
          priorityMap[
            itemType
          ] ||
          0
        ) >
        (
          priorityMap[
            representativeType
          ] ||
          0
        )
      ) {
        representativeType =
          itemType;
      }
    }
  );


  return representativeType;
}


/* =========================================================
  보직별 기본 운전현황

  아직 저장된 운전현황이 없는 경우에만 사용한다.

  설비별 기본 이름:
  - TGO  : 터빈
  - BCO1 : 1호기 주보일러
  - BCO2 : 2호기 주보일러
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
      "터빈 : 정상 운전 중",

    BCO1:
      "1호기 주보일러 : 정상 운전 중",

    BCO2:
      "2호기 주보일러 : 정상 운전 중",

    TO:
      "TBN 보조설비 정상 운전 중",

    BO1:
      "1호기 주보일러 보조설비 정상 운전 중",

    BO2:
      "2호기 주보일러 보조설비 정상 운전 중",

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

  신규 구조:
  - operationItems
  - items

  기존 구조:
  - type
  - content

  기존 문자열 자료도 설비별 배열로 자동 변환한다.
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


  if (
    savedValue
  ) {
    try {
      const parsedValue =
        JSON.parse(
          savedValue
        );


      const operationItems =
        getOperationStatusItems(
          parsedValue
        );


      const content =
        operationItems.length
          ? serializeOperationStatusItems(
              operationItems
            )
          : String(
              parsedValue.content ||
              getDefaultOperationStatusContent(
                normalizedRole
              )
            ).trim();


      const representativeType =
        operationItems.length
          ? getRepresentativeOperationStatusType(
              operationItems
            )
          : normalizeOperationStatusType(
              parsedValue.type
            );


      return {
        role:
          normalizedRole,


        type:
          representativeType,


        content,


        operationItems,

        items:
          operationItems,


        updatedAt:
          String(
            parsedValue.updatedAt ||
            ""
          ),


        updatedBy:
          String(
            parsedValue.updatedBy ||
            ""
          ).trim()
      };

    } catch (error) {
      console.error(
        `${normalizedRole} 운전현황 불러오기 실패:`,
        error
      );
    }
  }


  /*
    기존 공통 저장값 호환
  */
  if (
    allowLegacyFallback
  ) {
    const legacyStatus =
      getLegacySharedOperationStatus();


    if (
      legacyStatus?.content
    ) {
      const operationItems =
        getOperationStatusItems(
          legacyStatus
        );


      const content =
        operationItems.length
          ? serializeOperationStatusItems(
              operationItems
            )
          : String(
              legacyStatus.content ||
              ""
            ).trim();


      const representativeType =
        operationItems.length
          ? getRepresentativeOperationStatusType(
              operationItems
            )
          : normalizeOperationStatusType(
              legacyStatus.type
            );


      return {
        role:
          normalizedRole,


        type:
          representativeType,


        content,


        operationItems,

        items:
          operationItems,


        updatedAt:
          String(
            legacyStatus.updatedAt ||
            ""
          ),


        updatedBy:
          String(
            legacyStatus.updatedBy ||
            ""
          ).trim()
      };
    }
  }


  const defaultStatus =
    createDefaultOperationStatus(
      normalizedRole
    );


  const defaultItems =
    getOperationStatusItems(
      defaultStatus
    );


  return {
    ...defaultStatus,

    operationItems:
      defaultItems,

    items:
      defaultItems
  };
}


/* =========================================================
  특정 보직 운전현황 저장

  저장 항목:
  - 대표 상태
  - 기존 문자열
  - 설비별 운전현황 배열
  - 수정시간
  - 작성자

  operationItems와 items를 함께 저장하여
  신규 구조와 기존 호환 구조를 모두 유지한다.
========================================================= */

function saveOperationStatusByRole(
  role,
  status
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );


  const operationItems =
    getOperationStatusItems(
      status
    ).map(
      (
        item,
        itemIndex
      ) => {
        return normalizeOperationStatusItem(
          item,
          itemIndex
        );
      }
    );


  const serializedContent =
    operationItems.length
      ? serializeOperationStatusItems(
          operationItems
        )
      : String(
          status?.content ||
          ""
        ).trim();


  const representativeType =
    operationItems.length
      ? getRepresentativeOperationStatusType(
          operationItems
        )
      : normalizeOperationStatusType(
          status?.type
        );


  const safeStatus = {
    role:
      normalizedRole,


    /*
      기존 코드 호환용 대표 상태
    */
    type:
      representativeType,


    /*
      기존 상세보기·검색 호환 문자열
    */
    content:
      serializedContent,


    /*
      신규 설비별 운전현황 구조
    */
    operationItems,

    items:
      operationItems,


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
  파트장 운전현황 최신 자동 취합

  TGO → BCO1 → BCO2 순서로 불러오며
  각 설비의 상태 배열을 그대로 보존한다.

  파트장 취합 결과의 updatedAt은
  팀원 운전현황 중 가장 최근 수정시간으로 설정한다.
========================================================= */

function createLeaderCombinedOperationStatus() {
  const memberStatuses =
    OPERATION_STATUS_MEMBER_ROLES.map(
      (
        role
      ) => {
        const memberStatus =
          loadOperationStatusByRole(
            role,
            {
              allowLegacyFallback:
                role === "TGO"
            }
          );


        const operationItems =
          getOperationStatusItems(
            memberStatus
          ).map(
            (
              item,
              itemIndex
            ) => {
              return normalizeOperationStatusItem(
                item,
                itemIndex
              );
            }
          );


        const content =
          operationItems.length
            ? serializeOperationStatusItems(
                operationItems
              )
            : String(
                memberStatus?.content ||
                "등록된 운전현황이 없습니다."
              ).trim();


        const representativeType =
          operationItems.length
            ? getRepresentativeOperationStatusType(
                operationItems
              )
            : normalizeOperationStatusType(
                memberStatus?.type
              );


        return {
          role,

          type:
            representativeType,

          content,

          operationItems,

          items:
            operationItems,

          updatedAt:
            String(
              memberStatus?.updatedAt ||
              ""
            ),

          updatedBy:
            String(
              memberStatus?.updatedBy ||
              ""
            ).trim()
        };
      }
    );


  /*
    파트장 전체 설비 배열

    TGO·BCO1·BCO2 설비를 순서대로 합친다.
  */
  const combinedOperationItems =
    memberStatuses.flatMap(
      (
        memberStatus
      ) => {
        return memberStatus.operationItems.map(
          (
            item,
            itemIndex
          ) => {
            return {
              ...normalizeOperationStatusItem(
                item,
                itemIndex
              ),

              sourceRole:
                memberStatus.role
            };
          }
        );
      }
    );


  /*
    기존 업무일지 및 상세보기 호환용 문자열
  */
  const combinedContent =
    memberStatuses
      .map(
        (
          memberStatus
        ) => {
          return [
            `[${memberStatus.role}]`,
            memberStatus.content
          ].join("\n");
        }
      )
      .join("\n\n");


  /*
    팀원 운전현황 중 가장 최근 수정시간
  */
  const latestUpdatedAt =
    memberStatuses
      .map(
        (
          memberStatus
        ) => {
          return String(
            memberStatus.updatedAt ||
            ""
          );
        }
      )
      .filter(
        Boolean
      )
      .sort(
        (
          valueA,
          valueB
        ) => {
          return (
            new Date(
              valueB
            ).getTime() -
            new Date(
              valueA
            ).getTime()
          );
        }
      )[0] ||
    "";


  const latestMemberStatus =
    memberStatuses.find(
      (
        memberStatus
      ) => {
        return (
          memberStatus.updatedAt ===
          latestUpdatedAt
        );
      }
    );


  return {
    role:
      "파트장",

    type:
      combinedOperationItems.length
        ? getRepresentativeOperationStatusType(
            combinedOperationItems
          )
        : "normal",

    content:
      combinedContent,

    operationItems:
      combinedOperationItems,

    items:
      combinedOperationItems,

    memberStatuses,

    updatedAt:
      latestUpdatedAt,

    updatedBy:
      String(
        latestMemberStatus?.updatedBy ||
        ""
      ).trim()
  };
}

/* =========================================================
  파트장 운전현황 불러오기 최종본

  파트장 운전현황은 별도 저장본을 사용하지 않고
  항상 TGO·BCO1·BCO2의 최신 운전현황을 취합한다.

  따라서 팀원의 운전현황이 변경되면
  파트장 업무일지를 다시 열었을 때 즉시 반영된다.
========================================================= */

function loadLeaderOperationStatus() {
  /*
    과거에 저장된 파트장 전용 운전현황이 있으면
    최신 팀원 상태를 막으므로 제거한다.
  */
  const leaderStorageKey =
    getOperationStatusStorageKey(
      "파트장"
    );


  if (
    localStorage.getItem(
      leaderStorageKey
    )
  ) {
    localStorage.removeItem(
      leaderStorageKey
    );
  }


  /*
    TGO·BCO1·BCO2 최신 운전현황을
    항상 새로 취합한다.
  */
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
  파트장 운전현황 설비 고정 순서

  항상 다음 순서로 표시한다.

  1. 터빈
  2. 1호기 주보일러
  3. 2호기 주보일러
  4. 3호기 보조보일러
  5. 4호기 보조보일러
========================================================= */

function getLeaderOperationEquipmentOrder(
  equipmentName
) {
  const normalizedName =
    String(
      equipmentName || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /\s+/g,
        ""
      )
      .replace(
        /#/g,
        ""
      );


  if (
    normalizedName ===
      "터빈" ||
    normalizedName.includes(
      "tbn"
    ) ||
    normalizedName.includes(
      "turbine"
    )
  ) {
    return 1;
  }


  if (
    normalizedName.includes(
      "1호기주보일러"
    ) ||
    normalizedName.includes(
      "1주보일러"
    ) ||
    normalizedName.includes(
      "1blr"
    )
  ) {
    return 2;
  }


  if (
    normalizedName.includes(
      "2호기주보일러"
    ) ||
    normalizedName.includes(
      "2주보일러"
    ) ||
    normalizedName.includes(
      "2blr"
    )
  ) {
    return 3;
  }


  if (
    normalizedName.includes(
      "3호기보조보일러"
    ) ||
    normalizedName.includes(
      "3보조보일러"
    ) ||
    normalizedName.includes(
      "3aux"
    )
  ) {
    return 4;
  }


  if (
    normalizedName.includes(
      "4호기보조보일러"
    ) ||
    normalizedName.includes(
      "4보조보일러"
    ) ||
    normalizedName.includes(
      "4aux"
    )
  ) {
    return 5;
  }


  /*
    미지정 설비는 고정 설비 다음에 표시
  */
  return 99;
}

/* =========================================================
  파트장 설비별 운전현황 생성

  TGO·BCO1·BCO2의 운전현황을
  보직 단위가 아니라 설비 단위로 다시 분리한다.

  표시:
  상태 | 설비명 : 내용

  화면에는 보직명을 표시하지 않는다.
========================================================= */

function createLeaderOperationStatusRowHtml(
  memberStatus
) {
  /*
    신규 설비별 배열 우선,
    없으면 기존 content 문자열을 자동 분석한다.
  */
  let operationItems =
    getOperationStatusItems(
      memberStatus
    );


  /*
    기존 자료를 설비별로 분석하지 못한 경우에만
    하나의 예외 항목으로 표시한다.
  */
  if (
    !operationItems.length
  ) {
    const fallbackContent =
      String(
        memberStatus?.content ||
        "등록된 운전현황이 없습니다."
      ).trim();


    operationItems = [
      {
        name:
          "",

        type:
          normalizeOperationStatusType(
            memberStatus?.type
          ),

        content:
          fallbackContent
      }
    ];
  }


  return operationItems
    .map(
      (
        item,
        itemIndex
      ) => {
        const normalizedItem =
          normalizeOperationStatusItem(
            item,
            itemIndex
          );


        const itemType =
          normalizeOperationStatusType(
            normalizedItem.type
          );


        const typeLabel =
          getOperationStatusLabel(
            itemType
          );


        const itemName =
          String(
            normalizedItem.name ||
            ""
          ).trim();


        const itemContent =
          String(
            normalizedItem.content ||
            "등록된 운전현황이 없습니다."
          ).trim();


        /*
          설비명이 없는 과거 자료는
          내용만 표시한다.
        */
        const equipmentHtml =
          itemName
            ? `
              <strong
                class="leader-operation-line__name"
              >
                ${escapeHtml(
                  itemName
                )}
              </strong>

              <span
                class="leader-operation-line__colon"
                aria-hidden="true"
              >
                :
              </span>
            `
            : "";


        return `
          <div
            class="
              leader-operation-line
              is-${escapeHtml(
                itemType
              )}
            "
          >

            <span
              class="
                leader-operation-line__status
                is-${escapeHtml(
                  itemType
                )}
              "
            >
              ${escapeHtml(
                typeLabel
              )}
            </span>


            <span
              class="leader-operation-line__divider"
              aria-hidden="true"
            >
              |
            </span>


            ${equipmentHtml}


            <span
              class="leader-operation-line__content"
            >
              ${escapeHtml(
                itemContent
              )}
            </span>

          </div>
        `;
      }
    )
    .join("");
}

/* =========================================================
  현재 운전현황 설비별 한 줄 생성

  표시:
  상태 | 설비명 : 내용
========================================================= */

function createOperationStatusDisplayRowHtml(
  item,
  itemIndex
) {
  const normalizedItem =
    normalizeOperationStatusItem(
      item,
      itemIndex
    );


  const itemType =
    normalizeOperationStatusType(
      normalizedItem.type
    );


  const itemName =
    String(
      normalizedItem.name ||
      `설비 ${itemIndex + 1}`
    ).trim();


  const itemContent =
    String(
      normalizedItem.content ||
      "등록된 내용 없음"
    ).trim();


  return `
    <div
      class="
        operation-status-compact-line
        is-${escapeHtml(
          itemType
        )}
      "
    >

      <span
        class="
          operation-status-compact-line__badge
          is-${escapeHtml(
            itemType
          )}
        "
      >
        ${escapeHtml(
          getOperationStatusLabel(
            itemType
          )
        )}
      </span>


      <span
        class="operation-status-compact-line__divider"
        aria-hidden="true"
      >
        |
      </span>


      <strong
        class="operation-status-compact-line__name"
      >
        ${escapeHtml(
          itemName
        )}
      </strong>


      <span
        class="operation-status-compact-line__colon"
        aria-hidden="true"
      >
        :
      </span>


      <span
        class="operation-status-compact-line__content"
      >
        ${escapeHtml(
          itemContent
        )}
      </span>

    </div>
  `;
}

/* =========================================================
  운전현황 카드 렌더링 최종본

  TGO·BCO1·BCO2:
  - 설비별 운전현황 표시

  TO·BO1·BO2:
  - 자유 텍스트 표시

  파트장:
  - 전용 컴팩트 영역 사용
  - TGO·BCO1·BCO2 최신 운전현황 자동 취합
========================================================= */

function renderOperationStatusCard() {
  const currentRole =
    getCurrentOperationStatusRole();


  /* =====================================================
    파트장 최신 자동 취합
  ====================================================== */

  if (
    currentRole ===
    "파트장"
  ) {
    appState.currentOperationStatus =
      createLeaderCombinedOperationStatus();
  }


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


  const updatedAt =
    String(
      status.updatedAt ||
      ""
    ).trim();


  const updatedBy =
    String(
      status.updatedBy ||
      ""
    ).trim();


  /* =====================================================
    파트장 전용 컴팩트 표시
  ====================================================== */

  if (
    currentRole ===
    "파트장"
  ) {
    const memberStatuses =
      Array.isArray(
        status.memberStatuses
      )
        ? status.memberStatuses
        : [];


    const orderedRoles = [
      "TGO",
      "BCO1",
      "BCO2"
    ];


    const orderedStatuses =
      orderedRoles.map(
        (
          role
        ) => {
          const matchedStatus =
            memberStatuses.find(
              (
                memberStatus
              ) => {
                return (
                  normalizeMemberLogRole(
                    memberStatus?.role
                  ) ===
                  role
                );
              }
            );


          return (
            matchedStatus ||
            createDefaultOperationStatus(
              role
            )
          );
        }
      );


    /*
      파트장 전용 스타일 활성화
    */
    elements.operationStatusSection
      ?.classList.add(
        "is-leader-operation-status"
      );


    /*
      일반 보직 표시 영역은 숨긴다.

      파트장 자료를 일반 영역에 넣으면
      일반 카드의 큰 행 간격이 적용되어 높이가 넓어진다.
    */
    if (
      elements.operationStatusSingleView
    ) {
      elements.operationStatusSingleView.hidden =
        true;
    }


    /*
      파트장 전용 컴팩트 목록 표시
    */
    if (
      elements.leaderOperationStatusList
    ) {
      elements.leaderOperationStatusList.hidden =
        false;


/* =====================================================
  모든 보직의 설비를 하나의 배열로 합친 후
  설비 고정 순서로 정렬한다.
===================================================== */

const leaderOperationItems =
  orderedStatuses
    .flatMap(
      (
        memberStatus
      ) => {
        const memberRole =
          normalizeMemberLogRole(
            memberStatus?.role
          );


        return getOperationStatusItems(
          memberStatus
        ).map(
          (
            item,
            itemIndex
          ) => {
            return normalizeOperationStatusItem(
              {
                ...item,

                role:
                  memberRole,

                sourceRole:
                  memberRole
              },
              itemIndex
            );
          }
        );
      }
    )
    .sort(
      (
        itemA,
        itemB
      ) => {
        const orderDifference =
          getLeaderOperationEquipmentOrder(
            itemA.name
          ) -
          getLeaderOperationEquipmentOrder(
            itemB.name
          );


        if (
          orderDifference !==
          0
        ) {
          return orderDifference;
        }


        /*
          고정 순서에 없는 추가 설비는
          설비명 가나다순으로 표시한다.
        */
        return String(
          itemA.name || ""
        ).localeCompare(
          String(
            itemB.name || ""
          ),
          "ko"
        );
      }
    );


elements.leaderOperationStatusList.innerHTML =
  leaderOperationItems
    .map(
      (
        item
      ) => {
        return createLeaderOperationStatusRowHtml({
          role:
            item.sourceRole ||
            item.role ||
            "",

          type:
            item.type,

          content:
            item.content,

          operationItems: [
            item
          ],

          items: [
            item
          ]
        });
      }
    )
    .join("");
    }


    /*
      이전 일반 보직 내용 제거
    */
    if (
      elements.operationStatusCurrentContent
    ) {
      elements.operationStatusCurrentContent.innerHTML =
        "";
    }


    /*
      파트장은 공통 상태 배지를 사용하지 않는다.
    */
    if (
      elements.operationStatusStateBadge
    ) {
      elements.operationStatusStateBadge.hidden =
        true;
    }


    /*
      파트장 자동 취합이므로 수정 버튼 숨김
    */
    if (
      elements.editOperationStatusButton
    ) {
      elements.editOperationStatusButton.hidden =
        true;

      elements.editOperationStatusButton.disabled =
        true;

      elements.editOperationStatusButton.textContent =
        "수정";
    }


    /*
      공통 상태색 제거

      파트장 목록은 각 설비별 상태색을 사용한다.
    */
    OPERATION_STATUS_TYPES.forEach(
      (
        type
      ) => {
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


    /*
      업무일지 저장용 값 유지
    */
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
        "";
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
        "";
    }


    return;
  }


  /* =====================================================
    일반 보직 화면 복원
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
    elements.editOperationStatusButton
  ) {
    elements.editOperationStatusButton.hidden =
      false;

    elements.editOperationStatusButton.disabled =
      false;

    elements.editOperationStatusButton.textContent =
      "수정";
  }


  /* =====================================================
    TO·BO1·BO2 자유 텍스트 표시
  ====================================================== */

  if (
    !usesEquipmentOperationStatusEditor(
      currentRole
    )
  ) {
    if (
      elements.operationStatusCurrentContent
    ) {
      elements.operationStatusCurrentContent.textContent =
        content;


      elements.operationStatusCurrentContent.classList.add(
        "is-plain-text"
      );


      elements.operationStatusCurrentContent.classList.remove(
        "is-equipment-status"
      );
    }


    if (
      elements.operationStatusStateBadge
    ) {
      elements.operationStatusStateBadge.hidden =
        true;
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
        "normal";
    }


    if (
      elements.operationStatusUpdatedAt
    ) {
      elements.operationStatusUpdatedAt.textContent =
        updatedAt
          ? `${formatDateTime(
              updatedAt
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
        updatedAt
          ? `${formatDateTime(
              updatedAt
            )} 수정`
          : "";
    }


    applyOperationStatusTheme(
      "normal"
    );


    return;
  }


  /* =====================================================
    TGO·BCO1·BCO2 설비별 표시
  ====================================================== */

  const operationItems =
    getOperationStatusItems(
      status
    ).map(
      (
        item,
        itemIndex
      ) => {
        return normalizeOperationStatusItem(
          {
            ...item,

            role:
              currentRole,

            sourceRole:
              item?.sourceRole ||
              currentRole
          },
          itemIndex
        );
      }
    );


  if (
    elements.operationStatusCurrentContent
  ) {
    if (
      operationItems.length
    ) {
      elements.operationStatusCurrentContent.innerHTML =
        operationItems
          .map(
            (
              item,
              itemIndex
            ) => {
              return createOperationStatusDisplayRowHtml(
                item,
                itemIndex
              );
            }
          )
          .join("");

    } else {
      elements.operationStatusCurrentContent.textContent =
        content;
    }


    elements.operationStatusCurrentContent.classList.remove(
      "is-plain-text"
    );


    elements.operationStatusCurrentContent.classList.add(
      "is-equipment-status"
    );
  }


  /*
    설비별 행 안에 상태 배지가 있으므로
    카드 상단 공통 상태 배지는 숨긴다.
  */
  if (
    elements.operationStatusStateBadge
  ) {
    elements.operationStatusStateBadge.hidden =
      true;
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
      updatedAt
        ? `${formatDateTime(
            updatedAt
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
      updatedAt
        ? `${formatDateTime(
            updatedAt
          )} 수정`
        : "";
  }


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
  설비별 운전현황 편집 UI

  HTML을 직접 수정하지 않고
  operationStatusEditor 내부에 편집 목록을 자동 생성한다.
========================================================= */


/* =========================================================
  현재 편집 중인 설비별 운전현황 항목
========================================================= */

let editingOperationStatusItems = [];


/* =========================================================
  운전현황 편집 UI 요소 생성 최종본
========================================================= */

function ensureOperationStatusItemsEditor() {
  if (
    !elements.operationStatusEditor
  ) {
    return null;
  }


  let editorContainer =
    document.getElementById(
      "operationStatusItemsEditor"
    );


  if (
    editorContainer
  ) {
    return editorContainer;
  }


  editorContainer =
    document.createElement(
      "div"
    );


  editorContainer.id =
    "operationStatusItemsEditor";


  editorContainer.className =
    "operation-status-items-editor";


  editorContainer.innerHTML = `
    <div
      class="operation-status-items-editor__header"
    >
      <div>
        <strong>
          설비별 운전현황
        </strong>

        <p>
          설비를 선택하고 현재 운전 상태를 입력하세요.
        </p>
      </div>

      <button
        type="button"
        id="addOperationStatusItemButton"
        class="operation-status-item-add-button"
      >
        ＋ 설비 추가
      </button>
    </div>


    <div
      id="operationStatusItemsList"
      class="operation-status-items-list"
    ></div>
  `;


  const firstEditableElement =
    elements.operationStatusEditor
      .querySelector(
        "#operationStatusType"
      )
      ?.closest(
        "label, .field-group, div"
      ) ||
    elements.operationStatus
      ?.closest(
        "label, .field-group, div"
      );


  if (
    firstEditableElement &&
    firstEditableElement.parentElement ===
      elements.operationStatusEditor
  ) {
    elements.operationStatusEditor.insertBefore(
      editorContainer,
      firstEditableElement
    );

  } else {
    elements.operationStatusEditor.prepend(
      editorContainer
    );
  }


  /*
    기존 공통 상태 UI는 숨김 처리한다.
  */
  if (
    elements.operationStatusType
  ) {
    const typeField =
      elements.operationStatusType.closest(
        "label, .field-group"
      ) ||
      elements.operationStatusType.parentElement;


    if (
      typeField
    ) {
      typeField.hidden =
        true;
    }
  }


  if (
    elements.operationStatus
  ) {
    const contentField =
      elements.operationStatus.closest(
        "label, .field-group"
      ) ||
      elements.operationStatus.parentElement;


    if (
      contentField
    ) {
      contentField.hidden =
        true;
    }
  }


  editorContainer
    .querySelector(
      "#addOperationStatusItemButton"
    )
    ?.addEventListener(
      "click",
      addOperationStatusEditorItem
    );


  /*
    상태 버튼·삭제
  */
  editorContainer.addEventListener(
    "click",
    handleOperationStatusItemsEditorClick
  );


  /*
    내용 입력
  */
  editorContainer.addEventListener(
    "input",
    handleOperationStatusItemsEditorInput
  );


  /*
    설비 선택 변경
  */
  editorContainer.addEventListener(
    "change",
    handleOperationStatusItemsEditorChange
  );


  return editorContainer;
}

/* =========================================================
  보직별 운전현황 설비 선택 목록

  TGO:
  - 터빈
  - 3호기 보조보일러
  - 4호기 보조보일러
  - 직접입력

  BCO1:
  - 1호기 주보일러
  - 직접입력

  BCO2:
  - 2호기 주보일러
  - 직접입력
========================================================= */

function getOperationStatusEquipmentOptions(
  role
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );


  const equipmentMap = {
    TGO: [
      "터빈",
      "3호기 보조보일러",
      "4호기 보조보일러"
    ],

    BCO1: [
      "1호기 주보일러"
    ],

    BCO2: [
      "2호기 주보일러"
    ]
  };


  return (
    equipmentMap[
      normalizedRole
    ] ||
    []
  );
}

/* =========================================================
  직접입력 설비 항목 여부

  직접입력 항목은:
  - 상태 선택 버튼을 표시하지 않는다.
  - 자유입력 내용만 사용한다.
========================================================= */

function isCustomOperationStatusItem(
  item
) {
  return (
    item?.isCustom === true ||
    String(
      item?.equipmentMode ||
      ""
    ).trim() ===
      "custom"
  );
}

/* =========================================================
  설비별 운전현황 편집 행 최종본

  고정 설비:
  설비 선택 | 상태 선택 | 운전현황 내용 | 삭제

  직접입력:
  설비 선택 | 자유 내용 | 삭제
  - 상태 버튼 없음
  - 별도 설비명 입력칸 없음
========================================================= */

function createOperationStatusEditorItemHtml(
  item,
  itemIndex
) {
  const currentRole =
    getCurrentOperationStatusRole();


  const normalizedItem =
    normalizeOperationStatusItem(
      {
        ...item,

        role:
          item?.role ||
          currentRole,

        sourceRole:
          item?.sourceRole ||
          currentRole
      },
      itemIndex
    );


  const equipmentOptions =
    getOperationStatusEquipmentOptions(
      currentRole
    );


  const currentName =
    String(
      item?.name ||
      normalizedItem.name ||
      ""
    ).trim();


  const isCustom =
    currentName ===
      "직접입력" ||
    item?.equipmentMode ===
      "custom";


  const statusTypes = [
    {
      type:
        "normal",

      label:
        "정상운전"
    },
    {
      type:
        "starting",

      label:
        "기동"
    },
    {
      type:
        "stopped",

      label:
        "정지"
    },
    {
      type:
        "abnormal",

      label:
        "보존"
    },
    {
      type:
        "emergency",

      label:
        "비상"
    }
  ];


  return `
    <article
      class="
        operation-status-item-editor
        is-${escapeHtml(
          normalizedItem.type
        )}
        ${
          isCustom
            ? "is-custom-entry"
            : ""
        }
      "
      data-operation-item-index="${itemIndex}"
    >

      <span
        class="operation-status-item-editor__number"
        aria-hidden="true"
      >
        ${itemIndex + 1}.
      </span>


      <label
        class="
          operation-status-item-field
          operation-status-item-field--name
        "
      >
        <span
          class="operation-status-item-field__label"
        >
          설비명
        </span>


        <select
          class="operation-status-item-equipment-select"
          data-operation-item-index="${itemIndex}"
          aria-label="${itemIndex + 1}번 설비 선택"
        >
          ${equipmentOptions
            .map(
              equipmentName => {
                return `
                  <option
                    value="${escapeHtml(
                      equipmentName
                    )}"
                    ${
                      !isCustom &&
                      currentName ===
                        equipmentName
                        ? "selected"
                        : ""
                    }
                  >
                    ${escapeHtml(
                      equipmentName
                    )}
                  </option>
                `;
              }
            )
            .join("")}


          <option
            value="직접입력"
            ${
              isCustom
                ? "selected"
                : ""
            }
          >
            직접입력
          </option>
        </select>
      </label>


      ${
        isCustom
          ? ""
          : `
            <div
              class="
                operation-status-item-field
                operation-status-item-field--status
              "
            >
              <span
                class="operation-status-item-field__label"
              >
                운전 상태
              </span>


              <div
                class="operation-status-item-type-buttons"
                role="group"
                aria-label="${itemIndex + 1}번 운전 상태"
              >
                ${statusTypes
                  .map(
                    statusOption => {
                      const isSelected =
                        normalizedItem.type ===
                        statusOption.type;


                      return `
                        <button
                          type="button"
                          class="
                            operation-status-item-type-button
                            is-${escapeHtml(
                              statusOption.type
                            )}
                            ${
                              isSelected
                                ? "is-selected"
                                : ""
                            }
                          "
                          data-operation-item-type="${escapeHtml(
                            statusOption.type
                          )}"
                          data-operation-item-index="${itemIndex}"
                          aria-pressed="${String(
                            isSelected
                          )}"
                        >
                          ${escapeHtml(
                            statusOption.label
                          )}
                        </button>
                      `;
                    }
                  )
                  .join("")}
              </div>
            </div>
          `
      }


      <label
        class="
          operation-status-item-field
          operation-status-item-field--content
        "
      >
        <span
          class="operation-status-item-field__label"
        >
          ${
            isCustom
              ? "직접 입력"
              : "운전현황 내용"
          }
        </span>


        <textarea
          class="operation-status-item-content-input"
          rows="1"
          placeholder="${
            isCustom
              ? "내용을 자유롭게 입력하세요."
              : "현재 설비 상태 입력"
          }"
          data-operation-item-index="${itemIndex}"
          aria-label="${itemIndex + 1}번 운전현황 내용"
        >${escapeHtml(
          normalizedItem.content ===
            "상태 내용 없음"
            ? ""
            : normalizedItem.content
        )}</textarea>
      </label>


      <button
        type="button"
        class="operation-status-item-delete-button"
        data-operation-item-delete="${itemIndex}"
        aria-label="${itemIndex + 1}번 항목 삭제"
      >
        삭제
      </button>

    </article>
  `;
}


/* =========================================================
  설비별 운전현황 편집 목록 출력
========================================================= */

function renderOperationStatusItemsEditor() {
  ensureOperationStatusItemsEditor();


  const list =
    document.getElementById(
      "operationStatusItemsList"
    );


  if (
    !list
  ) {
    return;
  }


  if (
    !editingOperationStatusItems.length
  ) {
    list.innerHTML = `
      <div
        class="operation-status-items-empty"
      >
        등록된 설비 운전현황이 없습니다.
        상태 추가 버튼을 눌러 설비를 등록하세요.
      </div>
    `;

    return;
  }


  list.innerHTML =
    editingOperationStatusItems
      .map(
        (
          item,
          itemIndex
        ) => {
          return createOperationStatusEditorItemHtml(
            item,
            itemIndex
          );
        }
      )
      .join("");
}

/* =========================================================
  다음 추가 설비 자동 추천

  TGO:
  터빈 → 3호기 보조보일러 → 4호기 보조보일러 → 직접입력

  BCO1:
  1호기 주보일러 → 직접입력

  BCO2:
  2호기 주보일러 → 직접입력
========================================================= */

function getNextOperationStatusEquipmentName(
  role
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );


  const equipmentOptions =
    getOperationStatusEquipmentOptions(
      normalizedRole
    );


  const usedEquipmentNames =
    editingOperationStatusItems
      .map(
        item => {
          return String(
            item?.name ||
            ""
          ).trim();
        }
      );


  const nextEquipmentName =
    equipmentOptions.find(
      equipmentName => {
        return !usedEquipmentNames.includes(
          equipmentName
        );
      }
    );


  /*
    지정된 설비를 모두 사용했으면
    직접입력 항목으로 추가한다.
  */
  return (
    nextEquipmentName ||
    "직접입력"
  );
}

/* =========================================================
  설비 운전현황 항목 추가

  사용하지 않은 다음 설비를 자동 선택한다.
========================================================= */

function addOperationStatusEditorItem() {
  const currentRole =
    getCurrentOperationStatusRole();


  const nextEquipmentName =
    getNextOperationStatusEquipmentName(
      currentRole
    );


  const isCustom =
    nextEquipmentName ===
    "직접입력";


  editingOperationStatusItems.push({
    id:
      createOperationStatusItemId(),

    role:
      currentRole,

    sourceRole:
      currentRole,

    name:
      nextEquipmentName,

    equipmentMode:
      isCustom
        ? "custom"
        : "equipment",

    type:
      "normal",

    content:
      "",

    updatedAt:
      "",

    updatedBy:
      ""
  });


  renderOperationStatusItemsEditor();


  const newItemIndex =
    editingOperationStatusItems.length -
    1;


  window.setTimeout(
    () => {
      if (
        isCustom
      ) {
        document.querySelector(
          `.operation-status-item-content-input[data-operation-item-index="${newItemIndex}"]`
        )?.focus();

        return;
      }


      document.querySelector(
        `.operation-status-item-equipment-select[data-operation-item-index="${newItemIndex}"]`
      )?.focus();
    },
    0
  );
}


/* =========================================================
  설비별 상태 버튼 및 삭제 처리

  상태 선택:
  - 전체 목록을 다시 그리지 않는다.
  - 현재 행의 버튼과 색상만 즉시 변경한다.
  - 포커스 삭제로 발생하던 접근성 경고를 방지한다.

  삭제:
  - 확인 후 배열에서 제거
  - 삭제할 때만 목록을 다시 그린다.
========================================================= */

function handleOperationStatusItemsEditorClick(
  event
) {
  const typeButton =
    event.target.closest(
      "[data-operation-item-type]"
    );


  /* =====================================================
    설비별 운전 상태 선택
  ====================================================== */

  if (
    typeButton
  ) {
    event.preventDefault();


    const itemIndex =
      Number(
        typeButton.dataset
          .operationItemIndex
      );


    const selectedType =
      normalizeOperationStatusType(
        typeButton.dataset
          .operationItemType
      );


    if (
      !Number.isInteger(
        itemIndex
      ) ||
      !editingOperationStatusItems[
        itemIndex
      ]
    ) {
      return;
    }


    /*
      편집 데이터 변경
    */
    editingOperationStatusItems[
      itemIndex
    ].type =
      selectedType;


    /*
      해당 설비 편집 행 찾기
    */
    const editorItem =
      typeButton.closest(
        ".operation-status-item-editor"
      );


    if (
      !editorItem
    ) {
      return;
    }


    /*
      행 전체 상태색 변경
    */
    OPERATION_STATUS_TYPES.forEach(
      (
        statusType
      ) => {
        editorItem.classList.remove(
          `is-${statusType}`
        );
      }
    );


    editorItem.classList.add(
      `is-${selectedType}`
    );


    /*
      같은 행의 상태 버튼 선택 표시 변경
    */
    editorItem
      .querySelectorAll(
        "[data-operation-item-type]"
      )
      .forEach(
        (
          button
        ) => {
          const buttonType =
            normalizeOperationStatusType(
              button.dataset
                .operationItemType
            );


          const isSelected =
            buttonType ===
            selectedType;


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


    return;
  }


  /* =====================================================
    설비별 운전현황 삭제
  ====================================================== */

  const deleteButton =
    event.target.closest(
      "[data-operation-item-delete]"
    );


  if (
    !deleteButton
  ) {
    return;
  }


  event.preventDefault();


  const itemIndex =
    Number(
      deleteButton.dataset
        .operationItemDelete
    );


  if (
    !Number.isInteger(
      itemIndex
    ) ||
    !editingOperationStatusItems[
      itemIndex
    ]
  ) {
    return;
  }


  const itemName =
    String(
      editingOperationStatusItems[
        itemIndex
      ].name ||
      `설비 ${itemIndex + 1}`
    ).trim();


  const shouldDelete =
    window.confirm(
      `${itemName} 운전현황을 삭제하시겠습니까?`
    );


  if (
    !shouldDelete
  ) {
    return;
  }


  editingOperationStatusItems.splice(
    itemIndex,
    1
  );


  /*
    삭제한 경우에만 목록을 다시 그린다.
  */
  renderOperationStatusItemsEditor();


  showToast(
    `${itemName} 운전현황을 삭제했습니다.`
  );
}

/* =========================================================
  설비 선택 변경 처리

  직접입력 선택:
  - 상태 버튼 제거
  - 내용 입력칸만 표시

  고정 설비 선택:
  - 상태 버튼 표시
========================================================= */

function handleOperationStatusItemsEditorChange(
  event
) {
  const select =
    event.target.closest(
      ".operation-status-item-equipment-select"
    );


  if (
    !select
  ) {
    return;
  }


  const itemIndex =
    Number(
      select.dataset
        .operationItemIndex
    );


  if (
    !Number.isInteger(
      itemIndex
    ) ||
    !editingOperationStatusItems[
      itemIndex
    ]
  ) {
    return;
  }


  const selectedEquipmentName =
    String(
      select.value ||
      ""
    ).trim();


  const isCustom =
    selectedEquipmentName ===
    "직접입력";


  editingOperationStatusItems[
    itemIndex
  ] = {
    ...editingOperationStatusItems[
      itemIndex
    ],

    name:
      selectedEquipmentName,

    equipmentMode:
      isCustom
        ? "custom"
        : "equipment",

    /*
      직접입력은 운전 상태를 사용하지 않지만
      기존 대표 상태 계산 오류 방지를 위해 normal로 저장한다.
    */
    type:
      isCustom
        ? "normal"
        : normalizeOperationStatusType(
            editingOperationStatusItems[
              itemIndex
            ].type
          )
  };


  /*
    해당 행의 상태 영역을 즉시 바꾸기 위해
    목록 전체를 다시 그린다.
  */
  renderOperationStatusItemsEditor();


  window.setTimeout(
    () => {
      document.querySelector(
        `.operation-status-item-content-input[data-operation-item-index="${itemIndex}"]`
      )?.focus();
    },
    0
  );
}

/* =========================================================
  운전현황 내용 입력 동기화

  설비명은 select change 이벤트에서 처리한다.
========================================================= */

function handleOperationStatusItemsEditorInput(
  event
) {
  const input =
    event.target;


  const itemIndex =
    Number(
      input.dataset
        ?.operationItemIndex
    );


  if (
    !Number.isInteger(
      itemIndex
    ) ||
    !editingOperationStatusItems[
      itemIndex
    ]
  ) {
    return;
  }


  if (
    input.classList.contains(
      "operation-status-item-content-input"
    )
  ) {
    editingOperationStatusItems[
      itemIndex
    ].content =
      input.value;
  }
}


/* =========================================================
  편집 항목 입력값 검증
========================================================= */

function validateOperationStatusEditorItems() {
  if (
    !editingOperationStatusItems.length
  ) {
    showToast(
      "운전현황을 한 건 이상 추가해 주세요."
    );

    return false;
  }


  for (
    let itemIndex = 0;
    itemIndex <
      editingOperationStatusItems.length;
    itemIndex += 1
  ) {
    const item =
      editingOperationStatusItems[
        itemIndex
      ];


    const name =
      String(
        item.name ||
        ""
      ).trim();


    const content =
      String(
        item.content ||
        ""
      ).trim();


    if (
      !name
    ) {
      showToast(
        `${itemIndex + 1}번 설비명을 입력해 주세요.`
      );


      document.querySelector(
        `.operation-status-item-name-input[data-operation-item-index="${itemIndex}"]`
      )?.focus();


      return false;
    }


    if (
      !content
    ) {
      showToast(
        `${itemIndex + 1}번 운전현황 내용을 입력해 주세요.`
      );


      document.querySelector(
        `.operation-status-item-content-input[data-operation-item-index="${itemIndex}"]`
      )?.focus();


      return false;
    }
  }


  return true;
}

/* =========================================================
  설비별 운전현황을 사용하는 보직인지 확인

  설비별 방식:
  - TGO
  - BCO1
  - BCO2

  자유 텍스트 방식:
  - TO
  - BO1
  - BO2
========================================================= */

function usesEquipmentOperationStatusEditor(
  role
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );


  return [
    "TGO",
    "BCO1",
    "BCO2"
  ].includes(
    normalizedRole
  );
}

/* =========================================================
  운전현황 편집창 열기 최종본

  TGO·BCO1·BCO2:
  - 설비별 상태 편집
  - 자동 이어쓰기 사용 안 함

  TO·BO1·BO2:
  - 자유 텍스트 입력
  - 현재 근무에 저장된 운전현황이 없으면
    같은 보직의 직전 근무 운전현황 자동 적용
  - 사용자는 변경된 내용만 수정

  파트장:
  - 직접 수정하지 않고 자동 취합

  중요:
  - 자동 적용만 수행
  - 업무일지는 자동 저장하지 않음
  - 운전현황 저장 버튼을 눌러야 현재 작성창에 확정됨
========================================================= */

async function openOperationStatusEditor() {
  if (
    !elements.operationStatusEditor ||
    !elements.operationStatus
  ) {
    showToast(
      "운전현황 수정 영역을 찾을 수 없습니다."
    );

    return;
  }


  const currentRole =
    getCurrentOperationStatusRole();


  /* =====================================================
    기존 가져오기 버튼은 항상 숨긴다.
  ====================================================== */

  const previousOperationStatusWrap =
    document.getElementById(
      "previousOperationStatusWrap"
    );


  if (
    previousOperationStatusWrap
  ) {
    previousOperationStatusWrap.hidden =
      true;
  }


  /* =====================================================
    파트장은 직접 수정하지 않는다.
  ====================================================== */

  if (
    currentRole ===
    "파트장"
  ) {
    showToast(
      "파트장 운전현황은 TGO·BCO1·BCO2 운전현황을 자동 취합합니다."
    );

    return;
  }


  let currentStatus =
    appState.currentOperationStatus ||
    createDefaultOperationStatus(
      currentRole
    );


  const itemEditor =
    document.getElementById(
      "operationStatusItemsEditor"
    );


  const typeField =
    elements.operationStatusType
      ?.closest(
        ".operation-status-field, label, .field-group"
      ) ||
    elements.operationStatusType
      ?.parentElement;


  const contentField =
    elements.operationStatus
      ?.closest(
        ".operation-status-field, label, .field-group"
      ) ||
    elements.operationStatus
      ?.parentElement;


  /* =====================================================
    TGO · BCO1 · BCO2 설비별 편집
  ====================================================== */

  if (
    usesEquipmentOperationStatusEditor(
      currentRole
    )
  ) {
    const editorContainer =
      ensureOperationStatusItemsEditor();


    if (
      editorContainer
    ) {
      editorContainer.hidden =
        false;
    }


    if (
      typeField
    ) {
      typeField.hidden =
        true;
    }


    if (
      contentField
    ) {
      contentField.hidden =
        true;
    }


    editingOperationStatusItems =
      getOperationStatusItems(
        currentStatus
      ).map(
        (
          item,
          itemIndex
        ) => {
          return normalizeOperationStatusItem(
            {
              ...item,

              role:
                currentRole,

              sourceRole:
                item?.sourceRole ||
                currentRole
            },
            itemIndex
          );
        }
      );


    /*
      저장된 자료가 없으면
      보직별 기본 설비 한 건 생성한다.
    */
    if (
      !editingOperationStatusItems.length
    ) {
      const defaultNameMap = {
        TGO:
          "터빈",

        BCO1:
          "1호기 주보일러",

        BCO2:
          "2호기 주보일러"
      };


      editingOperationStatusItems = [
        {
          id:
            createOperationStatusItemId(),

          role:
            currentRole,

          sourceRole:
            currentRole,

          name:
            defaultNameMap[
              currentRole
            ] ||
            "설비",

          type:
            normalizeOperationStatusType(
              currentStatus.type
            ),

          content:
            String(
              currentStatus.content ||
              "정상 운전 중"
            ).trim(),

          updatedAt:
            String(
              currentStatus.updatedAt ||
              ""
            ),

          updatedBy:
            String(
              currentStatus.updatedBy ||
              ""
            ).trim()
        }
      ];
    }


    renderOperationStatusItemsEditor();


    window.setTimeout(
      () => {
        document.querySelector(
          '.operation-status-item-content-input[data-operation-item-index="0"]'
        )?.focus();
      },
      0
    );

  } else {
    /* ===================================================
      TO · BO1 · BO2 자유 텍스트 자동 이어쓰기
    ==================================================== */

    if (
      itemEditor
    ) {
      itemEditor.hidden =
        true;
    }


    if (
      typeField
    ) {
      typeField.hidden =
        true;
    }


    if (
      contentField
    ) {
      contentField.hidden =
        false;
    }


    const automaticRoles = [
      "TO",
      "BO1",
      "BO2"
    ];


    /*
      updatedAt이 있으면 현재 날짜·근무에서
      이미 수정 또는 저장된 운전현황이 있다는 뜻이다.

      이 경우 전 근무 내용으로 다시 덮어쓰지 않는다.
    */
    const hasCurrentSavedStatus =
      Boolean(
        String(
          currentStatus.updatedAt ||
          ""
        ).trim()
      );


    if (
      automaticRoles.includes(
        currentRole
      ) &&
      !hasCurrentSavedStatus
    ) {
      const currentDate =
        String(
          elements.logDate?.value ||
          ""
        ).trim();


      const currentShift =
        String(
          elements.logShift?.value ||
          ""
        )
          .trim()
          .toUpperCase();


      if (
        currentDate &&
        currentShift
      ) {
        try {
          const previousStatus =
            await getPreviousShiftOperationStatus(
              currentRole,
              currentDate,
              currentShift
            );


          if (
            previousStatus?.content
          ) {
            currentStatus = {
              role:
                currentRole,

              type:
                normalizeOperationStatusType(
                  previousStatus.type ||
                  "normal"
                ),

              content:
                String(
                  previousStatus.content ||
                  ""
                ).trim(),

              /*
                아직 현재 근무에서 저장한 것은 아니므로
                수정시간은 비워둔다.
              */
              updatedAt:
                "",

              updatedBy:
                "",

              inheritedFromDate:
                previousStatus.date,

              inheritedFromShift:
                previousStatus.shift,

              inheritedFromAuthor:
                previousStatus.author
            };


            /*
              편집창에만 자동 적용한다.
              이 시점에는 localStorage나 업무일지를 저장하지 않는다.
            */
            appState.currentOperationStatus =
              currentStatus;
          }

        } catch (error) {
          console.error(
            `${currentRole} 이전 근무 운전현황 자동 적용 실패:`,
            error
          );


          /*
            이전 자료 조회 실패가 업무일지 작성을
            막지 않도록 현재 기본 내용으로 계속 진행한다.
          */
        }
      }
    }


    elements.operationStatus.value =
      String(
        currentStatus.content ||
        ""
      ).trim();


    if (
      elements.operationStatusType
    ) {
      elements.operationStatusType.value =
        "normal";
    }


    window.setTimeout(
      () => {
        elements.operationStatus
          ?.focus();
      },
      0
    );
  }


  /* =====================================================
    운전현황 편집창 열기
  ====================================================== */

  elements.operationStatusEditor.hidden =
    false;


  elements.operationStatusSection
    ?.classList.add(
      "is-editing"
    );


  elements.editOperationStatusButton
    ?.classList.add(
      "is-active"
    );


  if (
    elements.editOperationStatusButton
  ) {
    elements.editOperationStatusButton.textContent =
      "수정 중";
  }


  if (
    elements.operationStatusEditorTime
  ) {
    elements.operationStatusEditorTime.textContent =
      currentStatus.updatedAt
        ? `${formatDateTime(
            currentStatus.updatedAt
          )} 수정`
        : "";
  }
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
  운전현황 저장 최종본

  TGO · BCO1 · BCO2:
  - 설비별 운전현황 배열 저장
  - 설비명·상태·내용 검증

  TO · BO1 · BO2:
  - 자유 텍스트 저장
  - 설비별 항목 검증 사용하지 않음

  파트장:
  - 직접 저장하지 않음
  - TGO·BCO1·BCO2 운전현황 자동 취합
========================================================= */

function saveOperationStatus() {
  const currentRole =
    getCurrentOperationStatusRole();


  /*
    파트장은 운전현황을 직접 저장하지 않는다.
  */
  if (
    currentRole ===
    "파트장"
  ) {
    showToast(
      "파트장 운전현황은 TGO·BCO1·BCO2 운전현황을 자동 취합합니다."
    );

    return;
  }


  const author =
    String(
      elements.logAuthor?.value ||
      ""
    ).trim();


  const updatedAt =
    new Date()
      .toISOString();


  /* =====================================================
    TGO · BCO1 · BCO2 설비별 운전현황 저장
  ====================================================== */

  if (
    usesEquipmentOperationStatusEditor(
      currentRole
    )
  ) {
    /*
      설비별 편집 보직에서만
      설비 항목 검증을 실행한다.
    */
    if (
      !validateOperationStatusEditorItems()
    ) {
      return;
    }


    const normalizedItems =
      editingOperationStatusItems.map(
        (
          item,
          itemIndex
        ) => {
          const normalizedItem =
            normalizeOperationStatusItem(
              {
                ...item,

                role:
                  currentRole,

                sourceRole:
                  item?.sourceRole ||
                  currentRole
              },
              itemIndex
            );


          return {
            ...normalizedItem,

            role:
              currentRole,

            sourceRole:
              normalizedItem.sourceRole ||
              currentRole,

            name:
              String(
                normalizedItem.name ||
                ""
              ).trim(),

            content:
              String(
                normalizedItem.content ||
                ""
              ).trim(),

            updatedAt,

            updatedBy:
              author
          };
        }
      );


    const serializedContent =
      serializeOperationStatusItems(
        normalizedItems
      );


    const representativeType =
      getRepresentativeOperationStatusType(
        normalizedItems
      );


    appState.currentOperationStatus = {
      role:
        currentRole,

      type:
        representativeType,

      content:
        serializedContent,

      operationItems:
        normalizedItems,

      items:
        normalizedItems,

      updatedAt,

      updatedBy:
        author
    };


    if (
      elements.operationStatus
    ) {
      elements.operationStatus.value =
        serializedContent;
    }


    if (
      elements.operationStatusSnapshot
    ) {
      elements.operationStatusSnapshot.value =
        serializedContent;
    }


    if (
      elements.operationStatusType
    ) {
      elements.operationStatusType.value =
        representativeType;
    }


    saveOperationStatusToStorage();


    renderOperationStatusCard();


    closeOperationStatusEditor();


    showToast(
      `${currentRole} 설비별 운전현황 ${normalizedItems.length}건을 저장했습니다.`
    );


    return;
  }


  /* =====================================================
    TO · BO1 · BO2 자유 텍스트 운전현황 저장
  ====================================================== */

  if (
    ![
      "TO",
      "BO1",
      "BO2"
    ].includes(
      currentRole
    )
  ) {
    showToast(
      "현재 보직의 운전현황 저장 방식을 확인할 수 없습니다."
    );

    return;
  }


  const content =
    String(
      elements.operationStatus?.value ||
      ""
    ).trim();


  if (
    !content
  ) {
    showToast(
      "현재 운전현황 내용을 입력해 주세요."
    );


    elements.operationStatus
      ?.focus();


    return;
  }


  appState.currentOperationStatus = {
    role:
      currentRole,

    /*
      TO·BO1·BO2는 자유 텍스트 방식이므로
      대표 상태를 normal로 유지한다.
    */
    type:
      "normal",

    content,

    /*
      설비별 항목 배열은 사용하지 않는다.
    */
    operationItems:
      [],

    items:
      [],

    updatedAt,

    updatedBy:
      author
  };


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
      "normal";
  }


  saveOperationStatusToStorage();


  renderOperationStatusCard();


  closeOperationStatusEditor();


  showToast(
    `${currentRole} 운전현황을 저장했습니다.`
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

/*
  전 근무자 운전현황 가져오기
*/
bindClick(
  document.getElementById(
    "loadPreviousOperationStatusBtn"
  ),
  handleLoadPreviousOperationStatus
);

/* =======================================================
  작업 구분 및 TAG
======================================================= */

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
  elements.closeLogDetailFooterButton,
  closeLogDetail
);


/*
  상세 업무일지 인쇄
*/
bindClick(
  elements.printLogDetailButton,
  () => {
    window.print();
  }
);


if (
  elements.logDetailModal
) {
  elements.logDetailModal
    .addEventListener(
      "click",
      (
        event
      ) => {
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

  기존 업무일지 수정:
  - 해당 일지에 저장된 운전현황 스냅샷 유지
  - 현재 localStorage 운전현황으로 덮어쓰지 않음

  신규 업무일지 작성:
  - 현재 날짜·근무·보직의 최신 운전현황 사용
========================================================= */

function openLogEditor(
  log = null,
  preset = null
) {
  /*
    이전 입력 상태 초기화
  */
  resetLogEditor();


  /* =====================================================
    기존 업무일지 수정
  ====================================================== */

  if (
    log
  ) {
    /*
      해당 업무일지에 저장된 값으로
      날짜·근무·보직·운전현황·업무내역을 채운다.
    */
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
      중요:

      기존에는 여기서
      refreshOperationStatusForCurrentRole()를 실행해
      해당 일지의 운전현황을 현재 localStorage 값으로
      덮어쓰고 있었다.

      수정창에서는 과거 업무일지에 저장된
      운전현황 스냅샷을 그대로 렌더링한다.
    */
    renderOperationStatusCard();


    updateOperationStatusRoleTitles();


    closeOperationStatusEditor();


    updateMemberLogImportSection();


    openModal(
      elements.logEditorModal
    );


    return;
  }


  /* =====================================================
    근무자 카드에서 신규 업무일지 작성
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
        (
          option
        ) => {
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
        (
          option
        ) => {
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
      신규 작성은 현재 날짜·근무·보직의
      최신 운전현황을 불러온다.
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
    현재 운전현황을 불러온다.
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
  근무자 카드 → 업무일지 상세보기 또는 신규 작성

  기존 업무일지가 있으면:
  - 작성자·보직·권한과 관계없이 상세창을 연다.
  - 수정 가능 여부는 상세창의 수정 버튼에서 따로 처리한다.

  기존 업무일지가 없으면:
  - 해당 보직의 신규 업무일지 작성창을 연다.
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
      card.dataset.role ||
      ""
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


  const selectedDate =
    formatInputDate(
      appState.selectedDate
    );


  const selectedShift =
    String(
      appState.selectedShift ||
      ""
    )
      .trim()
      .toUpperCase();


  const team =
    getScheduledPart(
      appState.selectedDate,
      selectedShift
    );


  /* =====================================================
    날짜·근무·보직이 일치하는 업무일지 검색

    같은 조건의 자료가 여러 개 있으면
    가장 최근 수정된 일지를 사용한다.
  ====================================================== */

  const matchedLogs =
    appState.logs
      .filter(
        log => {
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


          return (
            logDate ===
              selectedDate &&

            logShift ===
              selectedShift &&

            logRole ===
              role
          );
        }
      )
      .sort(
        (
          firstLog,
          secondLog
        ) => {
          const firstTime =
            new Date(
              firstLog?.updatedAt ||
              firstLog?.createdAt ||
              0
            ).getTime();


          const secondTime =
            new Date(
              secondLog?.updatedAt ||
              secondLog?.createdAt ||
              0
            ).getTime();


          return (
            secondTime -
            firstTime
          );
        }
      );


  const existingLog =
    matchedLogs[0] ||
    null;


  /* =====================================================
    기존 업무일지가 있으면 무조건 상세보기

    수정 가능 여부와 관계없이
    모든 보직의 일지를 조회할 수 있다.
  ====================================================== */

  if (
    existingLog
  ) {
    openLogDetail(
      existingLog
    );

    return;
  }


  /* =====================================================
    기존 업무일지가 없으면 신규 작성

    기존 신규 작성 기능을 그대로 사용한다.
  ====================================================== */

  openLogEditor(
    null,
    {
      role,

      author,

      team,

      date:
        selectedDate,

      shift:
        selectedShift
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
  기존 비고 문자열 → 비고 항목 배열

  지원 형식:

  특이사항 없음

  1. 첫 번째 비고
  2. 두 번째 비고

  첫 번째 비고
  두 번째 비고

  결과:
  [
    {
      category: "비고",
      content: "첫 번째 비고"
    },
    {
      category: "비고",
      content: "두 번째 비고"
    }
  ]
========================================================= */

function convertSavedNoteToEntries(
  noteValue,
  log = null
) {
  const normalizedNote =
    String(
      noteValue ||
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
      .trim();


  if (
    !normalizedNote
  ) {
    return [];
  }


  const sourceLines =
    normalizedNote
      .split(
        "\n"
      )
      .map(
        (
          line
        ) => {
          return String(
            line ||
            ""
          ).trim();
        }
      )
      .filter(Boolean);


  const noteEntries = [];


  sourceLines.forEach(
    (
      sourceLine,
      lineIndex
    ) => {
      /*
        기존 비고 앞 번호 제거

        1. 내용
        2) 내용
        3 - 내용
        ④ 내용
      */
      const content =
        sourceLine
          .replace(
            /^(?:\d+\s*[.)\-:]\s*|[①②③④⑤⑥⑦⑧⑨⑩]\s*)/,
            ""
          )
          .trim();


      if (
        !content
      ) {
        return;
      }


      noteEntries.push({
        id: [
          "note-entry",

          String(
            log?.id ||
            "saved"
          ),

          lineIndex
        ].join("-"),

        time:
          "",

        category:
          "비고",

        tag:
          "",

        content,

        attachmentName:
          "",

        importedFromRole:
          String(
            log?.role ||
            ""
          ).trim(),

        importedFromAuthor:
          String(
            log?.author ||
            ""
          ).trim(),

        importedFromLogId:
          String(
            log?.id ||
            ""
          ).trim(),

        importedFromEntryIndex:
          null,

        source:
          "saved-note"
      });
    }
  );


  return noteEntries;
}

/* =========================================================
  기존 업무일지 수정창 채우기 최종본

  운전현황:
  - 업무일지에 저장된 설비별 배열이 있으면 그대로 복원
  - 배열이 없으면 기존 문자열을 설비별 항목으로 변환
  - 현재 날짜·근무·보직 저장값이 더 최신이면 최신값 사용

  업무내역:
  - tmEntries
  - handoverEntries
  - remarkEntries
  - 기존 entries / note 호환
========================================================= */

function fillLogEditor(
  log
) {
  if (
    !log ||
    !elements.logEditorForm
  ) {
    return;
  }


  /* =====================================================
    기본 정보
  ====================================================== */

  elements.logEditorForm.dataset.editingId =
    String(
      log.id ||
      ""
    ).trim();


  if (
    elements.logDate
  ) {
    elements.logDate.value =
      String(
        log.date ||
        ""
      ).trim();
  }


  if (
    elements.logShift
  ) {
    elements.logShift.value =
      String(
        log.shift ||
        appState.selectedShift ||
        "DS"
      )
        .trim()
        .toUpperCase();
  }


  if (
    elements.logTeam
  ) {
    const normalizedTeam =
      normalizeTeamName(
        log.team ||
        ""
      );


    const matchedTeamOption = [
      ...elements.logTeam.options
    ].find(
      (
        option
      ) => {
        return (
          normalizeTeamName(
            option.value
          ) ===
          normalizedTeam
        );
      }
    );


    if (
      matchedTeamOption
    ) {
      elements.logTeam.value =
        matchedTeamOption.value;
    }
  }


  const normalizedRole =
    normalizeMemberLogRole(
      log.role
    );


  if (
    elements.logRole
  ) {
    const matchedRoleOption = [
      ...elements.logRole.options
    ].find(
      (
        option
      ) => {
        return (
          normalizeMemberLogRole(
            option.value
          ) ===
          normalizedRole
        );
      }
    );


    if (
      matchedRoleOption
    ) {
      elements.logRole.value =
        matchedRoleOption.value;
    }
  }


  if (
    elements.logAuthor
  ) {
    elements.logAuthor.value =
      String(
        log.author ||
        ""
      ).trim();
  }


  if (
    elements.logIsSubstitute
  ) {
    elements.logIsSubstitute.checked =
      Boolean(
        log.isSubstitute
      );
  }


  /* =====================================================
    운전현황

    업무일지 저장값과 보직별 최신 저장값 중
    수정시간이 더 최신인 값을 사용한다.
  ====================================================== */

  const logOperationItems =
    getOperationStatusItems({
      operationItems:
        Array.isArray(
          log.operationItems
        )
          ? log.operationItems
          : (
              Array.isArray(
                log.operationStatusItems
              )
                ? log.operationStatusItems
                : (
                    Array.isArray(
                      log.items
                    )
                      ? log.items
                      : []
                  )
            ),

      content:
        String(
          log.operationStatus ||
          ""
        ).trim(),

      type:
        log.operationStatusType
    });


  const logOperationStatus = {
    role:
      normalizedRole,

    type:
      logOperationItems.length
        ? getRepresentativeOperationStatusType(
            logOperationItems
          )
        : normalizeOperationStatusType(
            log.operationStatusType ||
            "normal"
          ),

    content:
      logOperationItems.length
        ? serializeOperationStatusItems(
            logOperationItems
          )
        : String(
            log.operationStatus ||
            ""
          ).trim(),

    operationItems:
      logOperationItems,

    items:
      logOperationItems,

    updatedAt:
      String(
        log.operationStatusUpdatedAt ||
        log.updatedAt ||
        ""
      ),

    updatedBy:
      String(
        log.operationStatusUpdatedBy ||
        log.author ||
        ""
      ).trim()
  };


  const latestStoredStatus =
    normalizedRole ===
      "파트장"
      ? loadLeaderOperationStatus()
      : loadOperationStatusByRole(
          normalizedRole,
          {
            allowLegacyFallback:
              normalizedRole ===
              "TGO"
          }
        );


  const logStatusTime =
    new Date(
      logOperationStatus.updatedAt ||
      0
    ).getTime();


  const latestStatusTime =
    new Date(
      latestStoredStatus?.updatedAt ||
      0
    ).getTime();


  const shouldUseLatestStoredStatus =
    latestStoredStatus &&
    (
      latestStatusTime >
      logStatusTime
    );


  appState.currentOperationStatus =
    shouldUseLatestStoredStatus
      ? latestStoredStatus
      : logOperationStatus;


  const finalOperationItems =
    getOperationStatusItems(
      appState.currentOperationStatus
    );


  const finalOperationContent =
    finalOperationItems.length
      ? serializeOperationStatusItems(
          finalOperationItems
        )
      : String(
          appState.currentOperationStatus
            ?.content ||
          ""
        ).trim();


  appState.currentOperationStatus = {
    ...appState.currentOperationStatus,

    role:
      normalizedRole,

    content:
      finalOperationContent,

    operationItems:
      finalOperationItems,

    items:
      finalOperationItems
  };


  if (
    elements.operationStatus
  ) {
    elements.operationStatus.value =
      finalOperationContent;
  }


  if (
    elements.operationStatusSnapshot
  ) {
    elements.operationStatusSnapshot.value =
      finalOperationContent;
  }


  if (
    elements.operationStatusRole
  ) {
    elements.operationStatusRole.value =
      normalizedRole;
  }


  if (
    elements.operationStatusType
  ) {
    elements.operationStatusType.value =
      appState.currentOperationStatus.type;
  }


  renderOperationStatusCard();


  /* =====================================================
    업무 항목 정규화
  ====================================================== */

  const normalizeEditorEntry = (
    entry,
    fallbackCategory
  ) => {
    const normalizedEntry =
      normalizeExistingLogEntryTime({
        ...entry,

        category:
          String(
            entry?.category ||
            fallbackCategory ||
            "인계사항"
          ).trim()
      });


    const rawImportedIndex =
      normalizedEntry
        ?.importedFromEntryIndex;


    const importedIndex =
      rawImportedIndex === "" ||
      rawImportedIndex === null ||
      rawImportedIndex === undefined
        ? ""
        : Number(
            rawImportedIndex
          );


    return {
      id:
        String(
          normalizedEntry?.id ||
          ""
        ).trim(),

      time:
        String(
          normalizedEntry?.time ||
          ""
        ).trim(),

      category:
        String(
          normalizedEntry?.category ||
          fallbackCategory ||
          "인계사항"
        ).trim(),

      tag:
        String(
          normalizedEntry?.tag ||
          ""
        )
          .trim()
          .toUpperCase(),

      content:
        String(
          normalizedEntry?.content ||
          ""
        ).trim(),

      attachmentName:
        String(
          normalizedEntry?.attachmentName ||
          ""
        ).trim(),

      importedFromRole:
        String(
          normalizedEntry?.importedFromRole ||
          ""
        ).trim(),

      importedFromAuthor:
        String(
          normalizedEntry?.importedFromAuthor ||
          ""
        ).trim(),

      importedFromLogId:
        String(
          normalizedEntry?.importedFromLogId ||
          ""
        ).trim(),

      importedFromEntryIndex:
        Number.isInteger(
          importedIndex
        )
          ? importedIndex
          : ""
    };
  };


  const legacyEntries =
    Array.isArray(
      log.entries
    )
      ? log.entries
      : [];


  const tmEntries =
    Array.isArray(
      log.tmEntries
    )
      ? log.tmEntries
      : legacyEntries.filter(
          (
            entry
          ) => {
            return (
              String(
                entry?.category ||
                ""
              ).trim() ===
              "TM 발행"
            );
          }
        );


  const handoverEntries =
    Array.isArray(
      log.handoverEntries
    )
      ? log.handoverEntries
      : legacyEntries.filter(
          (
            entry
          ) => {
            const category =
              String(
                entry?.category ||
                ""
              ).trim();

            return (
              category !==
                "TM 발행" &&
              category !==
                "비고"
            );
          }
        );


  let remarkEntries =
    Array.isArray(
      log.remarkEntries
    )
      ? log.remarkEntries
      : legacyEntries.filter(
          (
            entry
          ) => {
            return (
              String(
                entry?.category ||
                ""
              ).trim() ===
              "비고"
            );
          }
        );


  if (
    !remarkEntries.length &&
    String(
      log.note ||
      ""
    ).trim()
  ) {
    remarkEntries = [
      {
        time:
          "",

        category:
          "비고",

        tag:
          "",

        content:
          String(
            log.note ||
            ""
          ).trim()
      }
    ];
  }


  appState.editorEntries = [
    ...tmEntries.map(
      (
        entry
      ) => {
        return normalizeEditorEntry(
          entry,
          "TM 발행"
        );
      }
    ),

    ...handoverEntries.map(
      (
        entry
      ) => {
        return normalizeEditorEntry(
          entry,
          "인계사항"
        );
      }
    ),

    ...remarkEntries.map(
      (
        entry
      ) => {
        return normalizeEditorEntry(
          entry,
          "비고"
        );
      }
    )
  ];


  appState.editingEntryIndex =
    -1;


  resetLogEntryInput({
    keepCategory:
      false,

    keepTag:
      false
  });


  renderLogEntryTable();


  if (
    elements.logNote
  ) {
    elements.logNote.value =
      String(
        log.note ||
        ""
      ).trim();
  }


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
    테이블의 실제 열 개수
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


  const noteColumnCount =
    getTableColumnCount(
      elements.noteEntryTableBody,
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
    TM / 인계 및 일반 업무 / 비고 분리
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


  const noteEntries =
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
            "비고"
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
        const category =
          String(
            entry?.category ||
            ""
          ).trim();


        return (
          category !==
            "TM 발행" &&
          category !==
            "비고"
        );
      }
    );


  /* =====================================================
    건수와 저장용 JSON
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
    elements.noteEntryCount
  ) {
    elements.noteEntryCount.textContent =
      `${noteEntries.length}건`;
  }


  if (
    elements.logEntriesJson
  ) {
    elements.logEntriesJson.value =
      JSON.stringify(
        entries
      );
  }


  /*
    기존 log.note 필드는 더 이상 직접 입력하지 않는다.

    비고 항목 내용을 줄바꿈 문자열로도 동기화하여
    이전 저장 방식과의 호환성을 유지한다.
  */
  if (
    elements.logNote
  ) {
    elements.logNote.value =
      noteEntries
        .map(
          ({
            entry
          }) => {
            return String(
              entry?.content ||
              ""
            ).trim();
          }
        )
        .filter(Boolean)
        .join("\n");
  }


  /* =====================================================
    공통 항목 행 생성
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
                display:${
                  isEditMode
                    ? "flex"
                    : "none"
                } !important;

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
    TM 발행 내역
    번호는 TM 안에서 1부터 시작
  ====================================================== */

  if (
    elements.tmIssueEntryTableBody
  ) {
    if (
      !tmEntries.length
    ) {
      elements.tmIssueEntryTableBody.innerHTML = `
        <tr class="log-entry-empty-row">
          <td colspan="${tmColumnCount}">
            등록된 TM 발행 내역이 없습니다.
          </td>
        </tr>
      `;

    } else {
      elements.tmIssueEntryTableBody.innerHTML =
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
    인계 및 일반 업무를 보직별로 묶기
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
    인계 및 일반 업무 출력
  ====================================================== */

  if (
    elements.logEntryTableBody
  ) {
    if (
      !ordinaryEntries.length
    ) {
      elements.logEntryTableBody.innerHTML = `
        <tr class="log-entry-empty-row">
          <td colspan="${handoverColumnCount}">
            등록된 인계사항이 없습니다.
          </td>
        </tr>
      `;

    } else if (
      isLeaderLog
    ) {
      elements.logEntryTableBody.innerHTML =
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


      elements.logEntryTableBody.innerHTML =
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
    비고 출력
    인계사항과 분리하고 번호를 다시 1부터 시작
  ====================================================== */

  if (
    elements.noteEntryTableBody
  ) {
    if (
      !noteEntries.length
    ) {
      elements.noteEntryTableBody.innerHTML = `
        <tr class="log-entry-empty-row">
          <td colspan="${noteColumnCount}">
            등록된 비고가 없습니다.
          </td>
        </tr>
      `;

    } else {
      elements.noteEntryTableBody.innerHTML =
        noteEntries
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
                    noteColumnCount
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
    elements.selectAllTmEntriesCheckbox.checked =
      false;

    elements.selectAllTmEntriesCheckbox.indeterminate =
      false;

    elements.selectAllTmEntriesCheckbox.disabled =
      tmEntries.length ===
      0;
  }


  if (
    elements.selectAllLogEntriesCheckbox
  ) {
    elements.selectAllLogEntriesCheckbox.checked =
      false;

    elements.selectAllLogEntriesCheckbox.indeterminate =
      false;

    elements.selectAllLogEntriesCheckbox.disabled =
      ordinaryEntries.length ===
      0;
  }


  if (
    elements.selectAllNoteEntriesCheckbox
  ) {
    elements.selectAllNoteEntriesCheckbox.checked =
      false;

    elements.selectAllNoteEntriesCheckbox.indeterminate =
      false;

    elements.selectAllNoteEntriesCheckbox.disabled =
      noteEntries.length ===
      0;
  }


  if (
    elements.selectedLogEntryCount
  ) {
    elements.selectedLogEntryCount.textContent =
      "선택 0건";

    elements.selectedLogEntryCount.hidden =
      true;
  }


  if (
    elements.deleteSelectedLogEntriesButton
  ) {
    elements.deleteSelectedLogEntriesButton.disabled =
      true;
  }


  updateMemberLogImportCount();
}

/* =====================================================
  업무일지 한 줄 출력 최종본

  TM 발행:
  1. 내용

  인계사항:
  1. 07:15 내용
  2. 07:15, 10:55 내용

  비고:
  1. 내용

  비고는 시간값이 저장되어 있더라도
  화면에는 시간을 별도 칸으로 표시하지 않는다.

  여러 줄 내용은 같은 번호 안에서 줄바꿈을 유지한다.
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


  const category =
    String(
      entry?.category ||
      ""
    ).trim();


  const isRemark =
    category ===
    "비고";


  const timeText =
    String(
      entry?.time ||
      ""
    )
      .trim()
      .replace(
        /\s*,\s*/g,
        ", "
      );


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


  /*
    비고에는 시간 표시를 사용하지 않는다.
  */
  const hasTime =
    !isRemark &&
    showTime &&
    Boolean(
      timeText
    );


  const timeHtml =
    hasTime
      ? `
        <strong
          class="log-entry-document-time"
        >${escapeHtml(
          timeText
        )}</strong>
      `
      : "";


  const contentHtml = `
    <span
      class="
        log-entry-document-content-text
        ${
          isRemark
            ? "is-remark-content"
            : ""
        }
      "
    >${escapeHtml(
      contentText
    )}</span>
  `;


  /*
    비고에서는 TAG를 출력하지 않는다.
  */
  const tagHtml =
    isRemark
      ? ""
      : createTagHtml(
          entry,
          originalIndex
        );


  return `
    <div
      class="
        log-entry-document-line
        ${
          isRemark
            ? "is-remark-line"
            : ""
        }
      "
    >

      <strong
        class="log-entry-document-number"
      >
        ${displayNumber}.
      </strong>


      <div
        class="log-entry-document-body"
      >
        ${timeHtml}${contentHtml}${tagHtml}
      </div>

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


function renderSavedAttachments(
  attachments
) {
  if (
    !elements.attachmentList
  ) {
    return;
  }


  const safeAttachments =
    Array.isArray(
      attachments
    )
      ? attachments.filter(
          Boolean
        )
      : [];


  if (
    safeAttachments.length === 0
  ) {
    elements.attachmentList.innerHTML =
      "";

    return;
  }


  elements.attachmentList.innerHTML =
    safeAttachments
      .map(
        (
          attachment,
          index
        ) => {
          /*
            신규 업무일지:
            첨부파일이 문자열로 저장될 수 있음

            과거 업무일지:
            {
              id,
              fileName,
              name,
              url,
              mimeType
            }
            형태의 객체로 저장됨
          */
          const fileName =
            typeof attachment ===
              "string"
              ? attachment.trim()
              : String(
                  attachment?.fileName ||
                  attachment?.file_name ||
                  attachment?.name ||
                  attachment?.originalName ||
                  attachment?.original_name ||
                  `첨부파일 ${index + 1}`
                ).trim();


          return `
            <span
              class="attachment-chip"
              title="${escapeHtml(
                fileName
              )}"
            >
              ${escapeHtml(
                fileName
              )}
            </span>
          `;
        }
      )
      .join("");
}

/* =========================================================
  업무일지 작성 데이터 수집 최종본

  저장 구조:
  - tmEntries       : TM 발행 내역
  - handoverEntries : 인계사항 및 일반 업무
  - remarkEntries   : 비고

  기존 기능 호환:
  - entries 배열도 계속 저장
  - note 문자열도 계속 저장

  따라서 기존 목록·상세보기·과거 데이터 기능을
  깨뜨리지 않고 새 분리 구조를 함께 사용할 수 있다.
========================================================= */

function collectEditorData(
  status
) {
  /* =====================================================
    공통 업무 항목 정규화
  ====================================================== */

  const normalizedEntries =
    (
      Array.isArray(
        appState.editorEntries
      )
        ? appState.editorEntries
        : []
    )
      .map(
        (
          entry
        ) => {
          const rawImportedIndex =
            entry
              ?.importedFromEntryIndex;


          const importedFromEntryIndex =
            rawImportedIndex === "" ||
            rawImportedIndex === null ||
            rawImportedIndex === undefined
              ? null
              : Number(
                  rawImportedIndex
                );


          return {
            /*
              기존 항목 ID가 있으면 유지한다.
            */
            id:
              String(
                entry?.id ||
                ""
              ).trim(),

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

            attachmentName:
              String(
                entry?.attachmentName ||
                ""
              ).trim(),

            importedFromRole:
              String(
                entry
                  ?.importedFromRole ||
                ""
              ).trim(),

            importedFromAuthor:
              String(
                entry
                  ?.importedFromAuthor ||
                ""
              ).trim(),

            importedFromLogId:
              String(
                entry
                  ?.importedFromLogId ||
                ""
              ).trim(),

            importedFromEntryIndex:
              Number.isInteger(
                importedFromEntryIndex
              ) &&
              importedFromEntryIndex >=
                0
                ? importedFromEntryIndex
                : null,

            legacyBodyIndex:
              entry
                ?.legacyBodyIndex ??
              null,

            legacyLineIndex:
              entry
                ?.legacyLineIndex ??
              null,

            source:
              String(
                entry?.source ||
                ""
              ).trim()
          };
        }
      )
      .filter(
        (
          entry
        ) => {
          /*
            내용이 없는 빈 항목은 저장하지 않는다.
          */
          return Boolean(
            entry.content
          );
        }
      );


  /* =====================================================
    TM 발행 내역 분리
  ====================================================== */

  const tmEntries =
    normalizedEntries.filter(
      (
        entry
      ) => {
        return (
          entry.category ===
          "TM 발행"
        );
      }
    );


  /* =====================================================
    비고 내역 분리
  ====================================================== */

  const remarkEntries =
    normalizedEntries.filter(
      (
        entry
      ) => {
        return (
          entry.category ===
          "비고"
        );
      }
    );


  /* =====================================================
    인계사항 및 일반 업무 분리

    TM과 비고를 제외한 나머지 모든 구분은
    handoverEntries에 저장한다.

    예:
    인계사항
    BM 작업
    CM 작업
    일반 업무
  ====================================================== */

  const handoverEntries =
    normalizedEntries.filter(
      (
        entry
      ) => {
        return (
          entry.category !==
            "TM 발행" &&
          entry.category !==
            "비고"
        );
      }
    );


  /* =====================================================
    기존 note 문자열 호환

    새 비고 목록 내용을 줄바꿈 문자열로 저장한다.

    예:
    비고 1
    비고 2
  ====================================================== */

  const noteText =
    remarkEntries
      .map(
        (
          entry
        ) => {
          return String(
            entry.content ||
            ""
          ).trim();
        }
      )
      .filter(Boolean)
      .join("\n");


  /* =====================================================
    첨부파일
  ====================================================== */

  const newAttachmentNames =
    elements.logAttachments
      ? [
          ...elements
            .logAttachments
            .files
        ]
          .map(
            (
              file
            ) => {
              return String(
                file?.name ||
                ""
              ).trim();
            }
          )
          .filter(Boolean)
      : [];


  const savedAttachmentNames =
    elements.attachmentList
      ? [
          ...elements
            .attachmentList
            .querySelectorAll(
              ".attachment-chip"
            )
        ]
          .map(
            (
              chip
            ) => {
              return String(
                chip.textContent ||
                ""
              ).trim();
            }
          )
          .filter(Boolean)
      : [];


  const attachmentNames = [
    ...new Set(
      [
        ...savedAttachmentNames,
        ...newAttachmentNames
      ]
    )
  ];


  /* =====================================================
    기존 업무일지 ID
  ====================================================== */

  const editingId =
    String(
      elements
        .logEditorForm
        ?.dataset
        ?.editingId ||
      ""
    ).trim();


  /* =====================================================
    운전현황
  ====================================================== */

  const currentOperationStatus =
    String(
      elements
        .operationStatusSnapshot
        ?.value ||
      elements
        .operationStatus
        ?.value ||
      appState
        .currentOperationStatus
        ?.content ||
      ""
    ).trim();


  const now =
    new Date()
      .toISOString();


  /* =====================================================
    최종 저장 객체
  ====================================================== */

  return {
    id:
      editingId ||
      createId(),

    date:
      String(
        elements.logDate
          ?.value ||
        ""
      ).trim(),

    shift:
      String(
        elements.logShift
          ?.value ||
        ""
      )
        .trim()
        .toUpperCase(),

    team:
      normalizeTeamName(
        elements.logTeam
          ?.value ||
        ""
      ),

    role:
      normalizeMemberLogRole(
        elements.logRole
          ?.value ||
        ""
      ),

    author:
      String(
        elements.logAuthor
          ?.value ||
        ""
      ).trim(),

    isSubstitute:
      Boolean(
        elements.logIsSubstitute
          ?.checked
      ),


    /* ===================================================
      운전현황
    ==================================================== */

    operationStatus:
      currentOperationStatus,

    operationStatusType:
      String(
        appState
          .currentOperationStatus
          ?.type ||
        elements
          .operationStatusType
          ?.value ||
        "normal"
      ).trim(),

    operationStatusUpdatedAt:
      String(
        appState
          .currentOperationStatus
          ?.updatedAt ||
        ""
      ).trim(),

    operationStatusUpdatedBy:
      String(
        appState
          .currentOperationStatus
          ?.updatedBy ||
        ""
      ).trim(),

      operationItems:
  getOperationStatusItems(
    appState.currentOperationStatus
  ).map(
    (
      item,
      itemIndex
    ) => {
      return normalizeOperationStatusItem(
        item,
        itemIndex
      );
    }
  ),

operationStatusItems:
  getOperationStatusItems(
    appState.currentOperationStatus
  ).map(
    (
      item,
      itemIndex
    ) => {
      return normalizeOperationStatusItem(
        item,
        itemIndex
      );
    }
  ),

    /* ===================================================
      새 분리 저장 구조
    ==================================================== */

    tmEntries,

    handoverEntries,

    remarkEntries,


    /* ===================================================
      기존 구조 호환

      현재 목록·조회·상세·가져오기 기능이
      entries를 사용하므로 당장은 유지한다.
    ==================================================== */

    entries:
      normalizedEntries,

    note:
      noteText,


    /* ===================================================
      첨부파일 및 상태
    ==================================================== */

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


/* =========================================================
  저장된 신규 업무일지 불러오기 최종본

  처리 내용:
  1. localStorage에 저장된 업무일지만 불러온다.
  2. 홍길동·김철수·이영희 샘플 자료를 자동 제거한다.
  3. 저장 자료가 없어도 샘플 데이터를 생성하지 않는다.
  4. 같은 날짜·근무·보직의 중복 일지는 최신본만 유지한다.
========================================================= */

function loadLogs() {
  const savedLogs =
    localStorage.getItem(
      STORAGE_KEYS.logs
    );


  let loadedLogs = [];


  /* =====================================================
    1. 저장된 업무일지 읽기
  ====================================================== */

  if (
    savedLogs
  ) {
    try {
      const parsedLogs =
        JSON.parse(
          savedLogs
        );


      loadedLogs =
        Array.isArray(
          parsedLogs
        )
          ? parsedLogs
          : [];

    } catch (error) {
      console.error(
        "저장된 업무일지 분석 실패:",
        error
      );


      localStorage.removeItem(
        STORAGE_KEYS.logs
      );


      loadedLogs = [];
    }
  }


  /* =====================================================
    2. 예전 테스트용 샘플 자료 제거

    제거 대상:
    - sample-1
    - sample-2
    - sample-3
    - 홍길동
    - 김철수
    - 이영희

    실제 업무일지와 이름이 우연히 같을 가능성을 고려해
    sample ID를 가장 우선적으로 확인한다.
  ====================================================== */

  const sampleLogIds =
    new Set([
      "sample-1",
      "sample-2",
      "sample-3"
    ]);


  loadedLogs =
    loadedLogs.filter(
      (
        log
      ) => {
        const logId =
          String(
            log?.id ||
            ""
          ).trim();


        const logAuthor =
          String(
            log?.author ||
            ""
          ).trim();


        const isSampleId =
          sampleLogIds.has(
            logId
          );


        const isOldSampleAuthor =
          [
            "홍길동",
            "김철수",
            "이영희"
          ].includes(
            logAuthor
          ) &&
          logId.startsWith(
            "sample-"
          );


        return !(
          isSampleId ||
          isOldSampleAuthor
        );
      }
    );


  /* =====================================================
    3. 같은 날짜·근무·보직 중복 정리

    가장 최근 수정된 업무일지 하나만 유지한다.
  ====================================================== */

  const sortedLogs = [
    ...loadedLogs
  ].sort(
    (
      logA,
      logB
    ) => {
      const timeA =
        new Date(
          logA?.updatedAt ||
          logA?.createdAt ||
          0
        ).getTime();


      const timeB =
        new Date(
          logB?.updatedAt ||
          logB?.createdAt ||
          0
        ).getTime();


      return (
        timeB -
        timeA
      );
    }
  );


  const uniqueLogMap =
    new Map();


  sortedLogs.forEach(
    (
      log
    ) => {
      const date =
        String(
          log?.date ||
          ""
        ).trim();


      const shift =
        String(
          log?.shift ||
          ""
        )
          .trim()
          .toUpperCase();


      const role =
        normalizeMemberLogRole(
          log?.role
        );


      /*
        날짜·근무·보직이 없는 손상 자료는 제외한다.
      */
      if (
        !date ||
        !shift ||
        !role
      ) {
        return;
      }


      const uniqueKey = [
        date,
        shift,
        role
      ].join(
        "||"
      );


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
    }
  );


  /* =====================================================
    4. 최종 업무일지 배열 저장
  ====================================================== */

  appState.logs = [
    ...uniqueLogMap.values()
  ].sort(
    (
      logA,
      logB
    ) => {
      const dateDifference =
        String(
          logB?.date ||
          ""
        ).localeCompare(
          String(
            logA?.date ||
            ""
          )
        );


      if (
        dateDifference !==
        0
      ) {
        return dateDifference;
      }


      const timeA =
        new Date(
          logA?.updatedAt ||
          logA?.createdAt ||
          0
        ).getTime();


      const timeB =
        new Date(
          logB?.updatedAt ||
          logB?.createdAt ||
          0
        ).getTime();


      return (
        timeB -
        timeA
      );
    }
  );


  /*
    샘플 제거 및 중복 정리 결과를
    localStorage에 다시 저장한다.
  */
  persistLogs();


  console.log(
    `저장된 신규 업무일지 ${appState.logs.length}건을 불러왔습니다.`
  );
}

/* =========================================================
  업무일지 목록 렌더링 최종본

  첨부파일:
  - 0개: -
  - 1개 이상: 🖼 개수 버튼
  - 버튼 클릭 시 openAttachmentSelector() 실행
========================================================= */

function renderLogTable() {
  const selectedDateText =
    formatInputDate(
      appState.selectedDate
    );


  const filteredLogs =
    appState.logs.filter(
      (log) => {
        return (
          String(
            log.date ||
            ""
          ).trim() ===
            selectedDateText &&

          String(
            log.shift ||
            ""
          ).trim() ===
            String(
              appState.selectedShift ||
              ""
            ).trim()
        );
      }
    );


  if (
    !elements.logTableBody ||
    !elements.logEmptyState
  ) {
    return;
  }


  elements.logTableBody.innerHTML =
    "";


  elements.logEmptyState.hidden =
    filteredLogs.length > 0;


  if (
    !filteredLogs.length
  ) {
    updateShiftMemberCardStates();

    return;
  }


  filteredLogs.forEach(
    (log) => {
      elements.logTableBody
        .insertAdjacentHTML(
          "beforeend",
          createLogRowHtml(
            log
          )
        );
    }
  );


  /*
    createLogRowHtml()에서 생성한 각 행과
    filteredLogs의 순서가 동일하므로,
    행별 첨부파일 셀을 안전하게 다시 구성한다.
  */
  const renderedRows = [
    ...elements.logTableBody
      .querySelectorAll(
        ".log-row"
      )
  ];


  renderedRows.forEach(
    (
      row,
      rowIndex
    ) => {
      const log =
        filteredLogs[
          rowIndex
        ];


      const attachmentCell =
        row.querySelector(
          ".log-row__attachment-cell"
        );


      if (
        !log ||
        !attachmentCell
      ) {
        return;
      }


      const attachments =
        Array.isArray(
          log.attachments
        )
          ? log.attachments
              .filter(
                Boolean
              )
          : [];


      const attachmentCount =
        attachments.length;


      /*
        첨부파일 없음
      */
      if (
        attachmentCount === 0
      ) {
        attachmentCell.innerHTML = `
          <span
            class="
              attachment-indicator
              is-empty
            "
            aria-label="첨부파일 없음"
          >
            -
          </span>
        `;

        return;
      }


      /*
        첨부파일 있음

        클릭 이벤트는
        handleLogTableClick()에서 처리한다.
      */
      attachmentCell.innerHTML = `
        <button
          type="button"
          class="
            attachment-indicator
            diary-attachment-button
          "
          data-action="attachment"
          data-log-id="${escapeHtml(
            log.id
          )}"
          title="첨부파일 ${attachmentCount}개 보기"
          aria-label="첨부파일 ${attachmentCount}개 보기"
        >
          <span
            class="diary-attachment-button__icon"
            aria-hidden="true"
          >
            🖼
          </span>

          <span
            class="diary-attachment-button__count"
          >
            ${attachmentCount}
          </span>
        </button>
      `;
    }
  );


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

/* =========================================================
  업무일지 목록 클릭 처리 최종본

  업무내용·행 클릭:
  - 항상 상세보기

  수정 버튼:
  - 수정 가능하면 수정창
  - 수정 불가능하면 상세보기

  삭제 버튼:
  - 기존 삭제 권한 검사 사용
========================================================= */

function handleLogTableClick(
  event
) {
  if (
    !elements.logTableBody
  ) {
    return;
  }


  const actionElement =
    event.target.closest(
      "[data-action][data-log-id]"
    );


  const previewElement =
    event.target.closest(
      ".log-preview[data-log-id]"
    );


  const rowElement =
    event.target.closest(
      "tr[data-log-id]"
    );


  const clickedElement =
    actionElement ||
    previewElement ||
    rowElement;


  if (
    !clickedElement ||
    !elements.logTableBody.contains(
      clickedElement
    )
  ) {
    return;
  }


  const logId =
    String(
      clickedElement.dataset.logId ||
      rowElement?.dataset.logId ||
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
      item => {
        return (
          String(
            item?.id ||
            ""
          ).trim() ===
          logId
        );
      }
    );


  if (!log) {
    showToast(
      "업무일지를 찾을 수 없습니다."
    );

    return;
  }


  const action =
    String(
      actionElement?.dataset.action ||
      ""
    ).trim();


  /* =====================================================
    삭제
  ====================================================== */

  if (
    action ===
    "delete"
  ) {
    deleteLogById(
      log.id
    );

    return;
  }


  /* =====================================================
    수정

    수정할 수 없으면 토스트만 띄우는 대신
    상세창을 열어 조회할 수 있게 한다.
  ====================================================== */

  if (
    action ===
    "edit"
  ) {
    if (
      canCurrentUserEditShiftLog(
        log
      )
    ) {
      openLogEditor(
        log
      );

      return;
    }


    openLogDetail(
      log
    );

    return;
  }


  /* =====================================================
    업무내용·행·보기 클릭

    권한이나 과거 자료 여부와 관계없이
    무조건 상세창을 연다.
  ====================================================== */

  openLogDetail(
    log
  );
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
  첨부 이미지 팝업 상태
========================================================= */

const attachmentPreviewState = {
  items: [],
  currentIndex: 0
};


/* =========================================================
  첨부파일 정보 정규화
========================================================= */

function normalizeDetailAttachment(
  attachment,
  index
) {
  if (
    typeof attachment ===
    "string"
  ) {
    return {
      id: 0,

      name:
        attachment,

      url:
        ""
    };
  }


  const attachmentId =
    Number(
      attachment?.id ||
      0
    );


  const fileName =
    String(
      attachment?.fileName ||
      attachment?.name ||
      `첨부파일 ${index + 1}`
    ).trim();


  const url =
    String(
      attachment?.url ||
      (
        attachmentId
          ? `/api/legacy-attachment?id=${encodeURIComponent(
              attachmentId
            )}`
          : ""
      )
    ).trim();


  return {
    id:
      attachmentId,

    name:
      fileName,

    url
  };
}


/* =========================================================
  첨부 이미지 팝업 요소 생성

  index.html을 수정하지 않고
  최초 실행 시 JavaScript에서 한 번만 생성한다.
========================================================= */

function ensureAttachmentPreviewModal() {
  const existingModal =
    document.getElementById(
      "attachmentPreviewModal"
    );


  if (
    existingModal
  ) {
    return existingModal;
  }


  const modal =
    document.createElement(
      "div"
    );


  modal.id =
    "attachmentPreviewModal";


  modal.setAttribute(
    "aria-hidden",
    "true"
  );


  /*
    CSS 파일과 관계없이
    팝업이 반드시 화면 중앙에 표시되도록
    기본 스타일을 직접 적용한다.
  */
  Object.assign(
    modal.style,
    {
      position:
        "fixed",

      inset:
        "0",

      zIndex:
        "99999",

      display:
        "none",

      alignItems:
        "center",

      justifyContent:
        "center",

      padding:
        "24px",

      background:
        "rgba(9, 18, 32, 0.82)",

      boxSizing:
        "border-box"
    }
  );


  modal.innerHTML = `
    <div
      data-attachment-preview-close
      style="
        position:absolute;
        inset:0;
        cursor:zoom-out;
      "
    ></div>


    <section
      role="dialog"
      aria-modal="true"
      aria-label="첨부 이미지 보기"
      style="
        position:relative;
        z-index:1;

        display:flex;
        flex-direction:column;

        width:min(1100px, 94vw);
        height:min(850px, 90vh);

        overflow:hidden;

        background:#111827;
        border:1px solid rgba(255,255,255,0.18);
        border-radius:18px;

        box-shadow:
          0 30px 90px
          rgba(0,0,0,0.55);
      "
    >

      <header
        style="
          display:flex;
          flex:0 0 auto;

          align-items:center;
          justify-content:space-between;

          min-height:58px;
          padding:0 18px;

          color:#ffffff;
          background:#172033;

          border-bottom:
            1px solid
            rgba(255,255,255,0.12);
        "
      >

        <div
          style="
            display:flex;
            min-width:0;

            align-items:center;
            gap:10px;
          "
        >

          <strong
            id="attachmentPreviewTitle"
            style="
              overflow:hidden;

              font-size:15px;
              line-height:1.4;

              text-overflow:ellipsis;
              white-space:nowrap;
            "
          >
            첨부 이미지
          </strong>


          <span
            id="attachmentPreviewCounter"
            style="
              flex:0 0 auto;

              padding:4px 9px;

              color:#dbeafe;
              background:#263552;

              border-radius:999px;

              font-size:12px;
              font-weight:800;
            "
          >
          </span>

        </div>


        <button
          type="button"
          data-attachment-preview-close
          aria-label="첨부 이미지 닫기"
          style="
            display:flex;

            width:36px;
            height:36px;

            align-items:center;
            justify-content:center;

            padding:0;

            color:#ffffff;
            background:rgba(255,255,255,0.08);

            border:1px solid
              rgba(255,255,255,0.14);
            border-radius:10px;

            font-size:26px;
            line-height:1;

            cursor:pointer;
          "
        >
          ×
        </button>

      </header>


      <div
        style="
          position:relative;

          display:flex;
          flex:1 1 auto;

          min-width:0;
          min-height:0;

          align-items:center;
          justify-content:center;

          overflow:hidden;

          background:#0b0f17;
        "
      >

        <button
          type="button"
          id="attachmentPreviewPreviousButton"
          aria-label="이전 이미지"
          style="
            position:absolute;
            left:16px;
            top:50%;
            z-index:3;

            display:flex;

            width:48px;
            height:64px;

            align-items:center;
            justify-content:center;

            padding:0;

            color:#ffffff;
            background:rgba(15,23,42,0.76);

            border:1px solid
              rgba(255,255,255,0.18);
            border-radius:14px;

            font-size:40px;
            line-height:1;

            cursor:pointer;

            transform:translateY(-50%);
          "
        >
          ‹
        </button>


        <div
          style="
            position:relative;

            display:flex;

            width:100%;
            height:100%;

            min-width:0;
            min-height:0;

            align-items:center;
            justify-content:center;

            padding:24px 80px;

            box-sizing:border-box;
          "
        >

          <img
            id="attachmentPreviewImage"
            alt=""
            style="
              display:block;

              max-width:100%;
              max-height:100%;

              width:auto;
              height:auto;

              object-fit:contain;

              border-radius:8px;

              box-shadow:
                0 10px 35px
                rgba(0,0,0,0.4);
            "
          >


          <div
            id="attachmentPreviewLoading"
            style="
              position:absolute;
              left:50%;
              top:50%;

              color:#ffffff;

              font-size:14px;
              font-weight:700;

              transform:
                translate(-50%, -50%);
            "
          >
            이미지를 불러오는 중입니다.
          </div>

        </div>


        <button
          type="button"
          id="attachmentPreviewNextButton"
          aria-label="다음 이미지"
          style="
            position:absolute;
            right:16px;
            top:50%;
            z-index:3;

            display:flex;

            width:48px;
            height:64px;

            align-items:center;
            justify-content:center;

            padding:0;

            color:#ffffff;
            background:rgba(15,23,42,0.76);

            border:1px solid
              rgba(255,255,255,0.18);
            border-radius:14px;

            font-size:40px;
            line-height:1;

            cursor:pointer;

            transform:translateY(-50%);
          "
        >
          ›
        </button>

      </div>


      <footer
        style="
          display:flex;
          flex:0 0 auto;

          min-height:48px;

          align-items:center;
          justify-content:center;

          padding:0 18px;

          color:#d9e4f4;
          background:#172033;

          border-top:
            1px solid
            rgba(255,255,255,0.12);

          font-size:13px;
          font-weight:700;
        "
      >

        <span
          id="attachmentPreviewFileName"
          style="
            display:block;

            max-width:100%;

            overflow:hidden;

            text-overflow:ellipsis;
            white-space:nowrap;
          "
        >
        </span>

      </footer>

    </section>
  `;


  document.body.appendChild(
    modal
  );


  modal
    .querySelectorAll(
      "[data-attachment-preview-close]"
    )
    .forEach(
      closeElement => {
        closeElement.addEventListener(
          "click",
          closeAttachmentPreview
        );
      }
    );


  document
    .getElementById(
      "attachmentPreviewPreviousButton"
    )
    ?.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        moveAttachmentPreview(
          -1
        );
      }
    );


  document
    .getElementById(
      "attachmentPreviewNextButton"
    )
    ?.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        moveAttachmentPreview(
          1
        );
      }
    );


  const previewImage =
    document.getElementById(
      "attachmentPreviewImage"
    );


  previewImage?.addEventListener(
    "load",
    () => {
      const loadingElement =
        document.getElementById(
          "attachmentPreviewLoading"
        );


      if (
        loadingElement
      ) {
        loadingElement.style.display =
          "none";
      }


      previewImage.style.display =
        "block";
    }
  );


  previewImage?.addEventListener(
    "error",
    () => {
      const loadingElement =
        document.getElementById(
          "attachmentPreviewLoading"
        );


      if (
        loadingElement
      ) {
        loadingElement.style.display =
          "block";

        loadingElement.textContent =
          "이미지를 불러오지 못했습니다.";
      }


      previewImage.style.display =
        "none";
    }
  );


  return modal;
}


/* =========================================================
  현재 첨부 이미지 표시
========================================================= */

function renderCurrentAttachmentPreview() {
  const items =
    Array.isArray(
      attachmentPreviewState.items
    )
      ? attachmentPreviewState.items
      : [];


  if (
    !items.length
  ) {
    return;
  }


  const safeIndex =
    Math.min(
      Math.max(
        attachmentPreviewState.currentIndex,
        0
      ),
      items.length - 1
    );


  attachmentPreviewState.currentIndex =
    safeIndex;


  const currentItem =
    items[
      safeIndex
    ];


  const previewImage =
    document.getElementById(
      "attachmentPreviewImage"
    );


  const titleElement =
    document.getElementById(
      "attachmentPreviewTitle"
    );


  const counterElement =
    document.getElementById(
      "attachmentPreviewCounter"
    );


  const fileNameElement =
    document.getElementById(
      "attachmentPreviewFileName"
    );


  const loadingElement =
    document.getElementById(
      "attachmentPreviewLoading"
    );


  const previousButton =
    document.getElementById(
      "attachmentPreviewPreviousButton"
    );


  const nextButton =
    document.getElementById(
      "attachmentPreviewNextButton"
    );


  if (
    titleElement
  ) {
    titleElement.textContent =
      "첨부 이미지";
  }


  if (
    counterElement
  ) {
    counterElement.textContent =
      `${safeIndex + 1} / ${items.length}`;
  }


  if (
    fileNameElement
  ) {
    fileNameElement.textContent =
      currentItem.name ||
      `첨부파일 ${safeIndex + 1}`;
  }


  if (
    loadingElement
  ) {
    loadingElement.hidden =
      false;

    loadingElement.style.display =
      "block";

    loadingElement.textContent =
      "이미지를 불러오는 중입니다.";
  }


  if (
    previewImage
  ) {
    previewImage.hidden =
      false;

    previewImage.style.display =
      "none";

    previewImage.alt =
      currentItem.name ||
      "첨부 이미지";


    previewImage.onload =
      () => {
        previewImage.hidden =
          false;

        previewImage.style.display =
          "block";


        if (
          loadingElement
        ) {
          loadingElement.hidden =
            true;

          loadingElement.style.display =
            "none";
        }
      };


    previewImage.onerror =
      () => {
        previewImage.hidden =
          true;

        previewImage.style.display =
          "none";


        if (
          loadingElement
        ) {
          loadingElement.hidden =
            false;

          loadingElement.style.display =
            "block";

          loadingElement.textContent =
            "이미지를 불러오지 못했습니다.";
        }
      };


    previewImage.removeAttribute(
      "src"
    );


    window.setTimeout(
      () => {
        previewImage.src =
          currentItem.url;
      },
      0
    );
  }


  const hasMultipleItems =
    items.length > 1;


  if (
    previousButton
  ) {
    previousButton.hidden =
      !hasMultipleItems;

    previousButton.style.display =
      hasMultipleItems
        ? "flex"
        : "none";
  }


  if (
    nextButton
  ) {
    nextButton.hidden =
      !hasMultipleItems;

    nextButton.style.display =
      hasMultipleItems
        ? "flex"
        : "none";
  }
}

/* =========================================================
  첨부 이미지 팝업 열기
========================================================= */

function openAttachmentPreview(
  attachments,
  startIndex = 0
) {
  const normalizedAttachments =
    (
      Array.isArray(
        attachments
      )
        ? attachments
        : []
    )
      .map(
        normalizeDetailAttachment
      )
      .filter(
        attachment => {
          return Boolean(
            attachment.url
          );
        }
      );


  if (
    !normalizedAttachments.length
  ) {
    showToast(
      "열 수 있는 첨부 이미지가 없습니다."
    );

    return;
  }


  attachmentPreviewState.items =
    normalizedAttachments;


  attachmentPreviewState.currentIndex =
    Math.min(
      Math.max(
        Number(
          startIndex
        ) || 0,
        0
      ),
      normalizedAttachments.length - 1
    );


  const modal =
    ensureAttachmentPreviewModal();


  /*
    인라인 display:none을 반드시 해제한다.
  */
  modal.style.display =
    "flex";


  modal.style.visibility =
    "visible";


  modal.style.opacity =
    "1";


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


  renderCurrentAttachmentPreview();
}


/* =========================================================
  첨부 이미지 이전·다음
========================================================= */

function moveAttachmentPreview(
  direction
) {
  const itemCount =
    attachmentPreviewState
      .items
      .length;


  if (
    itemCount <= 1
  ) {
    return;
  }


  attachmentPreviewState.currentIndex =
    (
      attachmentPreviewState.currentIndex +
      direction +
      itemCount
    ) %
    itemCount;


  renderCurrentAttachmentPreview();
}


/* =========================================================
  첨부 이미지 팝업 닫기
========================================================= */

function closeAttachmentPreview() {
  const modal =
    document.getElementById(
      "attachmentPreviewModal"
    );


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


  modal.style.display =
    "none";


  modal.style.visibility =
    "hidden";


  modal.style.opacity =
    "0";


  const previewImage =
    document.getElementById(
      "attachmentPreviewImage"
    );


  if (
    previewImage
  ) {
    previewImage.removeAttribute(
      "src"
    );

    previewImage.style.display =
      "none";
  }


  attachmentPreviewState.items =
    [];


  attachmentPreviewState.currentIndex =
    0;


  const hasOtherOpenModal =
    Boolean(
      elements.logDetailModal
        ?.classList.contains(
          "is-open"
        ) ||
      elements.logEditorModal
        ?.classList.contains(
          "is-open"
        )
    );


  if (
    !hasOtherOpenModal
  ) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}

/* =========================================================
  첨부파일 선택 팝업 상태
========================================================= */

const attachmentSelectorState = {
  items: [],
  sourceLogId: null
};


/* =========================================================
  첨부파일 이름 가져오기
========================================================= */

function getAttachmentSelectorFileName(
  attachment,
  index
) {
  if (
    typeof attachment ===
    "string"
  ) {
    return (
      attachment.trim() ||
      `첨부파일 ${index + 1}`
    );
  }


  return String(
    attachment?.fileName ||
    attachment?.file_name ||
    attachment?.name ||
    attachment?.originalName ||
    attachment?.original_name ||
    `첨부파일 ${index + 1}`
  ).trim();
}


/* =========================================================
  첨부파일 미리보기 주소 가져오기
========================================================= */

function getAttachmentSelectorPreviewUrl(
  attachment
) {
  if (
    !attachment
  ) {
    return "";
  }


  /*
    과거 업무일지 첨부파일

    D1의 첨부파일 ID를 이용해
    R2 이미지 제공 API를 호출한다.
  */
  const attachmentId =
    attachment?.id ||
    attachment?.attachmentId ||
    attachment?.attachment_id;


  if (
    attachmentId !== undefined &&
    attachmentId !== null &&
    String(
      attachmentId
    ).trim()
  ) {
    return (
      `/api/legacy-attachment?id=` +
      encodeURIComponent(
        attachmentId
      )
    );
  }


  /*
    이미 URL이 포함된 첨부파일
  */
  const directUrl =
    attachment?.previewUrl ||
    attachment?.preview_url ||
    attachment?.url ||
    attachment?.downloadUrl ||
    attachment?.download_url ||
    attachment?.originalUrl ||
    attachment?.original_url;


  if (
    directUrl
  ) {
    return String(
      directUrl
    );
  }


  /*
    문자열 자체가 URL인 경우
  */
  if (
    typeof attachment ===
      "string" &&
    (
      attachment.startsWith(
        "http://"
      ) ||
      attachment.startsWith(
        "https://"
      ) ||
      attachment.startsWith(
        "/"
      )
    )
  ) {
    return attachment;
  }


  return "";
}


/* =========================================================
  이미지 파일 여부 확인
========================================================= */

function isAttachmentSelectorImage(
  attachment
) {
  const mimeType =
    String(
      attachment?.mimeType ||
      attachment?.mime_type ||
      attachment?.type ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    mimeType.startsWith(
      "image/"
    )
  ) {
    return true;
  }


  const fileName =
    getAttachmentSelectorFileName(
      attachment,
      0
    )
      .toLowerCase()
      .split("?")[0]
      .split("#")[0];


  return (
    /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif)$/i
      .test(
        fileName
      )
  );
}


/* =========================================================
  첨부파일 선택 목록 출력
========================================================= */

function renderAttachmentSelectorList() {
  const list =
    document.getElementById(
      "attachmentSelectorList"
    );

  const count =
    document.getElementById(
      "attachmentSelectorCount"
    );


  if (
    !list
  ) {
    return;
  }


  const attachments =
    Array.isArray(
      attachmentSelectorState.items
    )
      ? attachmentSelectorState.items
      : [];


  if (
    count
  ) {
    count.textContent =
      `${attachments.length}개`;
  }


  if (
    attachments.length === 0
  ) {
    list.innerHTML = `
      <div class="attachment-selector-empty">
        첨부파일이 없습니다.
      </div>
    `;

    return;
  }


  list.innerHTML =
    attachments
      .map(
        (
          attachment,
          index
        ) => {
          const fileName =
            getAttachmentSelectorFileName(
              attachment,
              index
            );

          const previewUrl =
            getAttachmentSelectorPreviewUrl(
              attachment
            );

          const isImage =
            isAttachmentSelectorImage(
              attachment
            );


          return `
            <button
              type="button"
              class="attachment-selector-card"
              data-attachment-selector-index="${index}"
              aria-label="${escapeHtml(
                fileName
              )} 미리보기"
            >

              ${
                isImage &&
                previewUrl
                  ? `
                    <img
                      class="attachment-selector-thumbnail"
                      src="${escapeHtml(
                        previewUrl
                      )}"
                      alt=""
                      loading="lazy"
                    />
                  `
                  : `
                    <span
                      class="
                        attachment-selector-thumbnail
                        attachment-selector-thumbnail--file
                      "
                      aria-hidden="true"
                    >
                      📎
                    </span>
                  `
              }


              <span
                class="attachment-selector-info"
              >

                <strong
                  class="attachment-selector-name"
                >
                  ${escapeHtml(
                    fileName
                  )}
                </strong>

                <span
                  class="attachment-selector-sub"
                >
                  ${
                    isImage
                      ? "이미지 미리보기"
                      : "첨부파일 열기"
                  }
                </span>

              </span>

            </button>
          `;
        }
      )
      .join("");
}


/* =========================================================
  첨부파일 선택 팝업 열기

  첨부파일이 1개면:
  선택창 없이 기존 이미지 뷰어를 바로 연다.

  첨부파일이 2개 이상이면:
  첨부파일 선택 팝업을 연다.
========================================================= */

function openAttachmentSelector(
  attachments,
  sourceLogId = null
) {
  const safeAttachments =
    Array.isArray(
      attachments
    )
      ? attachments.filter(
          Boolean
        )
      : [];


  if (
    safeAttachments.length === 0
  ) {
    showToast(
      "등록된 첨부파일이 없습니다."
    );

    return;
  }


  /*
    첨부파일이 하나면 바로 큰 이미지 뷰어 실행
  */
  if (
    safeAttachments.length === 1
  ) {
    openAttachmentPreview(
      safeAttachments,
      0
    );

    return;
  }


  const modal =
    document.getElementById(
      "attachmentSelectorModal"
    );


  if (
    !modal
  ) {
    console.error(
      "첨부파일 선택 팝업을 찾을 수 없습니다."
    );

    return;
  }


  attachmentSelectorState.items =
    safeAttachments;


  attachmentSelectorState.sourceLogId =
    sourceLogId;


  renderAttachmentSelectorList();


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
}


/* =========================================================
  첨부파일 선택 팝업 닫기
========================================================= */

function closeAttachmentSelector() {
  const modal =
    document.getElementById(
      "attachmentSelectorModal"
    );


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


  attachmentSelectorState.items =
    [];


  attachmentSelectorState.sourceLogId =
    null;


  const hasOtherOpenModal =
    document.querySelector(
      [
        ".modal-backdrop.is-open",
        "#attachmentPreviewModal.is-open"
      ].join(",")
    );


  if (
    !hasOtherOpenModal
  ) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}


/* =========================================================
  첨부파일 선택 처리
========================================================= */

function handleAttachmentSelectorClick(
  event
) {
  const closeButton =
    event.target.closest(
      "[data-attachment-selector-close]"
    );


  if (
    closeButton
  ) {
    closeAttachmentSelector();

    return;
  }


  const attachmentButton =
    event.target.closest(
      "[data-attachment-selector-index]"
    );


  if (
    !attachmentButton
  ) {
    return;
  }


  const attachmentIndex =
    Number(
      attachmentButton.dataset
        .attachmentSelectorIndex
    );


  if (
    !Number.isInteger(
      attachmentIndex
    ) ||
    !attachmentSelectorState
      .items[
        attachmentIndex
      ]
  ) {
    return;
  }


  const attachments =
    [
      ...attachmentSelectorState.items
    ];


  /*
    선택창을 먼저 닫고,
    선택한 위치부터 기존 이미지 뷰어를 연다.
  */
  closeAttachmentSelector();


  openAttachmentPreview(
    attachments,
    attachmentIndex
  );
}


/* =========================================================
  첨부파일 선택 팝업 초기화
========================================================= */

function initializeAttachmentSelector() {
  const modal =
    document.getElementById(
      "attachmentSelectorModal"
    );


  if (
    !modal
  ) {
    return;
  }


  modal.addEventListener(
    "click",
    handleAttachmentSelectorClick
  );
}


document.addEventListener(
  "DOMContentLoaded",
  initializeAttachmentSelector
);


/* =========================================================
  첨부파일 선택창 키보드 제어
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    const modal =
      document.getElementById(
        "attachmentSelectorModal"
      );


    if (
      !modal?.classList.contains(
        "is-open"
      )
    ) {
      return;
    }


    if (
      event.key ===
      "Escape"
    ) {
      event.preventDefault();

      closeAttachmentSelector();
    }
  }
);

/* =========================================================
  첨부 이미지 키보드 제어
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    const modal =
      document.getElementById(
        "attachmentPreviewModal"
      );


    if (
      !modal?.classList.contains(
        "is-open"
      )
    ) {
      return;
    }


    if (
      event.key ===
      "Escape"
    ) {
      event.preventDefault();

      closeAttachmentPreview();

      return;
    }


    if (
      event.key ===
      "ArrowLeft"
    ) {
      event.preventDefault();

      moveAttachmentPreview(
        -1
      );

      return;
    }


    if (
      event.key ===
      "ArrowRight"
    ) {
      event.preventDefault();

      moveAttachmentPreview(
        1
      );
    }
  }
);

/* =========================================================
  업무일지 상세 첨부파일 클릭 이벤트
========================================================= */

function bindDetailAttachmentPreviewEvents(
  log,
  normalizedAttachments
) {
  if (
    !elements.logDetailContent
  ) {
    return;
  }


  const attachments =
    Array.isArray(
      normalizedAttachments
    )
      ? normalizedAttachments
      : [];


  elements.logDetailContent
    .querySelectorAll(
      "[data-detail-attachment-index]"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          event => {
            event.preventDefault();

            event.stopPropagation();


            const attachmentIndex =
              Number(
                button.dataset
                  .detailAttachmentIndex
              );


            if (
              !Number.isInteger(
                attachmentIndex
              ) ||
              !attachments[
                attachmentIndex
              ]
            ) {
              showToast(
                "첨부파일 정보를 확인할 수 없습니다."
              );

              return;
            }


            openAttachmentPreview(
              attachments,
              attachmentIndex
            );
          }
        );
      }
    );
}

/* =========================================================
  저장된 운전현황 → 상세보기 행 분석 최종본

  표시 규칙:

  TGO · BCO1 · BCO2
  - 설비별 운전현황
  - 각 설비를 한 행씩 표시

  파트장
  - [TGO], [BCO1], [BCO2] 구분을 분석
  - 설비별로 한 행씩 표시

  TO · BO1 · BO2
  - 자유 텍스트 운전현황
  - 줄마다 분리하지 않음
  - 전체 내용을 한 행으로 유지
========================================================= */

function parseOperationStatusRowsForDisplay(
  log
) {
  const normalizedLogRole =
    normalizeMemberLogRole(
      log?.role ||
      ""
    );


  const sourceText =
    String(
      log?.operationStatus ||
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
      .trim();


  if (
    !sourceText
  ) {
    return [];
  }


  const freeTextRoles = [
    "TO",
    "BO1",
    "BO2"
  ];


  /* =====================================================
    TO · BO1 · BO2

    자유 텍스트 전체를 하나의 행으로 표시한다.

    기존처럼 줄 단위로 분리하지 않는다.
  ====================================================== */

  if (
    freeTextRoles.includes(
      normalizedLogRole
    )
  ) {
    return [
      {
        role:
          normalizedLogRole,

        type:
          getSavedOperationStatusTypeForDisplay(
            log,
            normalizedLogRole
          ),

        content:
          sourceText,

        isFreeText:
          true
      }
    ];
  }


  /* =====================================================
    신규 설비별 배열이 저장된 경우

    TGO · BCO1 · BCO2 업무일지는
    operationItems를 가장 우선 사용한다.
  ====================================================== */

  const savedOperationItems =
    Array.isArray(
      log?.operationItems
    )
      ? log.operationItems
      : (
          Array.isArray(
            log?.items
          )
            ? log.items
            : []
        );


  if (
    savedOperationItems.length &&
    normalizedLogRole !==
      "파트장"
  ) {
    return savedOperationItems
      .map(
        (
          item,
          itemIndex
        ) => {
          const normalizedItem =
            normalizeOperationStatusItem(
              {
                ...item,

                role:
                  normalizedLogRole,

                sourceRole:
                  item?.sourceRole ||
                  normalizedLogRole
              },
              itemIndex
            );


          const equipmentName =
            String(
              normalizedItem.name ||
              ""
            ).trim();


          const operationContent =
            String(
              normalizedItem.content ||
              ""
            ).trim();


          const combinedContent =
            equipmentName
              ? [
                  equipmentName,
                  operationContent
                ]
                  .filter(Boolean)
                  .join(" : ")
              : operationContent;


          return {
            role:
              normalizedLogRole,

            type:
              normalizeOperationStatusType(
                normalizedItem.type
              ),

            content:
              combinedContent,

            equipmentName,

            operationContent,

            isEquipment:
              true
          };
        }
      )
      .filter(
        (
          row
        ) => {
          return Boolean(
            String(
              row.content ||
              ""
            ).trim()
          );
        }
      );
  }


  const sourceLines =
    sourceText
      .split(
        "\n"
      )
      .map(
        (
          line
        ) => {
          return String(
            line ||
            ""
          ).trim();
        }
      )
      .filter(Boolean);


  const rows = [];


  let currentRole =
    normalizedLogRole ===
      "파트장"
      ? ""
      : normalizedLogRole;


  /* =====================================================
    한 줄 내용을 설비명과 내용으로 구분
  ====================================================== */

  const createOperationRow =
    (
      role,
      rawLine
    ) => {
      const normalizedRole =
        normalizeMemberLogRole(
          role ||
          normalizedLogRole
        );


      const contentWithoutNumber =
        String(
          rawLine ||
          ""
        )
          .replace(
            /^\s*\d+\s*(?:[.)]|-\s+)\s*/,
            ""
          )
          .trim();


      if (
        !contentWithoutNumber
      ) {
        return null;
      }


      const separatorMatch =
        contentWithoutNumber.match(
          /^(.+?)\s*(?:[:：|])\s*(.+)$/
        );


      let equipmentName =
        "";


      let operationContent =
        contentWithoutNumber;


      if (
        separatorMatch
      ) {
        equipmentName =
          String(
            separatorMatch[1] ||
            ""
          ).trim();


        operationContent =
          String(
            separatorMatch[2] ||
            ""
          ).trim();
      }


      return {
        role:
          normalizedRole,

        type:
          getSavedOperationStatusTypeForDisplay(
            log,
            normalizedRole
          ),

        content:
          equipmentName
            ? `${equipmentName} : ${operationContent}`
            : operationContent,

        equipmentName,

        operationContent,

        isEquipment:
          true
      };
    };


  /* =====================================================
    파트장 및 기존 설비형 자료 분석
  ====================================================== */

  sourceLines.forEach(
    (
      sourceLine
    ) => {
      const roleMatch =
        sourceLine.match(
          /^\[\s*(TGO|BCO1|BCO2|TO|BO1|BO2|파트장)\s*\]$/i
        );


      if (
        roleMatch
      ) {
        currentRole =
          normalizeMemberLogRole(
            roleMatch[1]
          );


        return;
      }


      const targetRole =
        currentRole ||
        normalizedLogRole;


      const createdRow =
        createOperationRow(
          targetRole,
          sourceLine
        );


      if (
        !createdRow
      ) {
        return;
      }


      rows.push(
        createdRow
      );
    }
  );


  /* =====================================================
    분석 결과가 없는 예외 자료

    원문 전체를 하나의 행으로 유지한다.
  ====================================================== */

  if (
    !rows.length
  ) {
    return [
      {
        role:
          normalizedLogRole,

        type:
          getSavedOperationStatusTypeForDisplay(
            log,
            normalizedLogRole
          ),

        content:
          sourceText,

        isFreeText:
          true
      }
    ];
  }


  return rows;
}

/* =========================================================
  표시용 운전 상태 확인

  저장된 보직별 상태가 있으면 우선 사용한다.
  없으면 정상운전으로 표시한다.
========================================================= */

function getSavedOperationStatusTypeForDisplay(
  log,
  role
) {
  const normalizedRole =
    normalizeMemberLogRole(
      role
    );


  /*
    업무일지 안에 보직별 운전현황 배열이
    함께 저장된 경우
  */
  const memberStatuses =
    Array.isArray(
      log?.operationStatusMembers
    )
      ? log.operationStatusMembers
      : (
          Array.isArray(
            log?.memberOperationStatuses
          )
            ? log.memberOperationStatuses
            : []
        );


  const matchedStatus =
    memberStatuses.find(
      (
        item
      ) => {
        return (
          normalizeMemberLogRole(
            item?.role
          ) ===
          normalizedRole
        );
      }
    );


  if (
    matchedStatus
  ) {
    return normalizeOperationStatusType(
      matchedStatus.type
    );
  }


  /*
    일반 보직 업무일지의 단일 상태
  */
  if (
    normalizeMemberLogRole(
      log?.role
    ) ===
    normalizedRole
  ) {
    return normalizeOperationStatusType(
      log?.operationStatusType ||
      "normal"
    );
  }


  return "normal";
}


/* =========================================================
  운전 상태 배지 이름
========================================================= */

function getOperationStatusDisplayLabel(
  type
) {
  return getOperationStatusLabel(
    normalizeOperationStatusType(
      type
    )
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

/* =========================================================
  업무일지 상세보기 최종본

  분리 구조:
  - tmEntries
  - handoverEntries
  - remarkEntries

  기존 호환:
  - entries
  - note

  번호:
  - TM 발행 내역 1번부터
  - 인계사항 보직별 1번부터
  - 비고 1번부터
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
    항목 한 개 정규화
  ====================================================== */

const normalizeDetailEntry = (
  entry,
  fallbackCategory
) => {
  const sourceEntry =
    entry &&
    typeof entry ===
      "object" &&
    !Array.isArray(
      entry
    )
      ? entry
      : {
          content:
            String(
              entry ||
              ""
            ).trim()
        };


  return normalizeExistingLogEntryTime({
    ...sourceEntry,

    category:
      String(
        sourceEntry.category ||
        fallbackCategory ||
        "인계사항"
      ).trim(),

    time:
      String(
        sourceEntry.time ||
        ""
      ).trim(),

    tag:
      String(
        sourceEntry.tag ||
        ""
      )
        .trim()
        .toUpperCase(),

    content:
      String(
        sourceEntry.content ||
        ""
      ).trim()
  });
};


  /* =====================================================
    새 분리 구조 존재 여부
  ====================================================== */

const hasSeparatedStructure =
  (
    Array.isArray(
      log.tmEntries
    ) &&
    log.tmEntries.length > 0
  ) ||
  (
    Array.isArray(
      log.handoverEntries
    ) &&
    log.handoverEntries.length > 0
  ) ||
  (
    Array.isArray(
      log.remarkEntries
    ) &&
    log.remarkEntries.length > 0
  );


  const legacyEntries =
    normalizeExistingLogEntries(
      Array.isArray(
        log.entries
      )
        ? log.entries
        : []
    );


  /* =====================================================
    TM 발행 내역
  ====================================================== */

  const tmEntries =
    sortDetailEntriesByTime(
      (
        hasSeparatedStructure
          ? (
              Array.isArray(
                log.tmEntries
              )
                ? log.tmEntries
                : []
            )
          : legacyEntries.filter(
              (
                entry
              ) => {
                return (
                  String(
                    entry.category ||
                    ""
                  ).trim() ===
                  "TM 발행"
                );
              }
            )
      )
        .map(
          (
            entry
          ) => {
            return normalizeDetailEntry(
              entry,
              "TM 발행"
            );
          }
        )
        .filter(
          (
            entry
          ) => {
            return Boolean(
              String(
                entry.content ||
                ""
              ).trim()
            );
          }
        )
    );


  /* =====================================================
    인계 및 일반 작업 내역
  ====================================================== */

  const handoverEntries =
    (
      hasSeparatedStructure
        ? (
            Array.isArray(
              log.handoverEntries
            )
              ? log.handoverEntries
              : []
          )
        : legacyEntries.filter(
            (
              entry
            ) => {
              const category =
                String(
                  entry.category ||
                  ""
                ).trim();

              return (
                category !==
                  "TM 발행" &&
                category !==
                  "비고"
              );
            }
          )
    )
      .map(
        (
          entry
        ) => {
          return normalizeDetailEntry(
            entry,
            "인계사항"
          );
        }
      )
      .filter(
        (
          entry
        ) => {
          return Boolean(
            String(
              entry.content ||
              ""
            ).trim()
          );
        }
      );


  /* =====================================================
    비고 내역

    우선순위:
    1. remarkEntries
    2. 기존 entries 중 category === 비고
    3. 기존 note 문자열
  ====================================================== */

  let remarkEntries =
    (
      hasSeparatedStructure
        ? (
            Array.isArray(
              log.remarkEntries
            )
              ? log.remarkEntries
              : []
          )
        : legacyEntries.filter(
            (
              entry
            ) => {
              return (
                String(
                  entry.category ||
                  ""
                ).trim() ===
                "비고"
              );
            }
          )
    )
      .map(
        (
          entry
        ) => {
          return normalizeDetailEntry(
            entry,
            "비고"
          );
        }
      )
      .filter(
        (
          entry
        ) => {
          return Boolean(
            String(
              entry.content ||
              ""
            ).trim()
          );
        }
      );


  /*
    비고 배열이 없을 때만
    기존 note 문자열을 변환한다.
  */
  if (
    remarkEntries.length ===
    0
  ) {
    remarkEntries =
      convertSavedNoteToEntries(
        log.note,
        log
      )
        .map(
          (
            entry
          ) => {
            return normalizeDetailEntry(
              entry,
              "비고"
            );
          }
        )
        .filter(
          (
            entry
          ) => {
            return Boolean(
              String(
                entry.content ||
                ""
              ).trim()
            );
          }
        );
  }


  /*
    상세보기와 이후 수정 기능의 호환을 위해
    기존 entries에도 전체 내역을 동기화한다.
  */
  const combinedEntries = [
    ...tmEntries,
    ...handoverEntries,
    ...remarkEntries
  ];


  /* =====================================================
    상세 업무 한 줄 생성

    예:
    1. 08:37~09:46 [TAG] 업무 내용
  ====================================================== */

  function createDetailWorkRowHtml(
    entry,
    index,
    options = {}
  ) {
    const {
      numberType =
        "handover",

      showTime =
        true,

      showTag =
        true
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
          (
            line
          ) => {
            return String(
              line ||
              ""
            ).trim();
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
                (
                  line
                ) => {
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
            showTime &&
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
            showTag &&
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

    업무일지 수정창과 동일한 구조:

    보직 | 상태 배지 | 구분선 | 운전현황
  ====================================================== */

  const operationStatusRows =
    parseOperationStatusRowsForDisplay(
      log
    );


  const operationStatusHtml =
    operationStatusRows.length
      ? `
        <div
          class="detail-operation-dashboard"
        >

          <div
            class="detail-operation-dashboard__heading"
          >
            <span
              class="detail-operation-dashboard__dot"
              aria-hidden="true"
            ></span>

            <strong>
              ${escapeHtml(
                normalizeMemberLogRole(
                  log.role
                ) ===
                "파트장"
                  ? "파트장 운전현황"
                  : `${normalizeMemberLogRole(
                      log.role
                    )} 운전현황`
              )}
            </strong>
          </div>


          <div
            class="detail-operation-dashboard__list"
          >

            ${operationStatusRows
              .map(
                (
                  statusRow
                ) => {
                  const statusType =
                    normalizeOperationStatusType(
                      statusRow.type
                    );


                  return `
                    <div
                      class="
                        detail-operation-dashboard__row
                        is-${escapeHtml(
                          statusType
                        )}
                      "
                    >

                      <strong
                        class="detail-operation-dashboard__role"
                      >
                        ${escapeHtml(
                          statusRow.role ||
                          log.role ||
                          "-"
                        )}
                      </strong>


                      <span
                        class="
                          detail-operation-dashboard__badge
                          is-${escapeHtml(
                            statusType
                          )}
                        "
                      >
                        ${escapeHtml(
                          getOperationStatusDisplayLabel(
                            statusType
                          )
                        )}
                      </span>


                      <span
                        class="detail-operation-dashboard__divider"
                        aria-hidden="true"
                      >
                        |
                      </span>


                      <span
                        class="detail-operation-dashboard__content"
                      >
                        ${escapeHtml(
                          statusRow.content ||
                          "등록된 운전현황이 없습니다."
                        )}
                      </span>

                    </div>
                  `;
                }
              )
              .join("")}

          </div>

        </div>
      `
      : `
        <div class="detail-empty-message">
          등록된 운전현황이 없습니다.
        </div>
      `;

  /* =====================================================
    TM 발행 HTML
  ====================================================== */

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
                      "tm",

                    showTime:
                      true,

                    showTag:
                      true
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
    인계사항 보직별 그룹
  ====================================================== */

  const detailRoleOrder = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2",
    "파트장"
  ];


  const groupedHandoverEntries = {};


  handoverEntries.forEach(
    (
      entry
    ) => {
      const sourceRole =
        normalizeMemberLogRole(
          entry.importedFromRole ||
          log.role ||
          "파트장"
        );


      const safeRole =
        sourceRole ||
        normalizedRole ||
        "파트장";


      if (
        !groupedHandoverEntries[
          safeRole
        ]
      ) {
        groupedHandoverEntries[
          safeRole
        ] = [];
      }


      groupedHandoverEntries[
        safeRole
      ].push(
        entry
      );
    }
  );


  const orderedRoles = [
    ...detailRoleOrder.filter(
      (
        role
      ) => {
        return Boolean(
          groupedHandoverEntries[
            role
          ]?.length
        );
      }
    ),

    ...Object.keys(
      groupedHandoverEntries
    ).filter(
      (
        role
      ) => {
        return (
          !detailRoleOrder.includes(
            role
          )
        );
      }
    )
  ];


  const handoverHtml =
    orderedRoles.length
      ? orderedRoles
          .map(
            (
              role
            ) => {
              const roleEntries =
                sortDetailEntriesByTime(
                  groupedHandoverEntries[
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
                                "handover",

                              showTime:
                                true,

                              showTag:
                                true
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
    비고 HTML

    인계사항과 섞지 않고
    비고 영역에서 1번부터 다시 시작한다.
  ====================================================== */

  const remarkHtml =
    remarkEntries.length
      ? `
        <div class="detail-work-list detail-work-list--remark">

          ${remarkEntries
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
                      "remark",

                    showTime:
                      true,

                    showTag:
                      false
                  }
                );
              }
            )
            .join("")}

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


  const normalizedAttachments =
    attachments.map(
      normalizeDetailAttachment
    );


  const attachmentHtml =
    normalizedAttachments.length
      ? `
        <div class="detail-attachment-list">

          ${normalizedAttachments
            .map(
              (
                attachment,
                index
              ) => {
                const canOpen =
                  Boolean(
                    attachment.url
                  );


                return `
                  <button
                    type="button"
                    class="
                      detail-attachment-chip
                      ${
                        canOpen
                          ? "is-clickable"
                          : "is-disabled"
                      }
                    "
                    data-detail-attachment-index="${index}"
                    ${
                      canOpen
                        ? ""
                        : "disabled"
                    }
                    title="${
                      canOpen
                        ? "첨부 이미지 보기"
                        : "열 수 없는 첨부파일"
                    }"
                  >
                    <span
                      aria-hidden="true"
                    >
                      📎
                    </span>

                    <span>
                      ${escapeHtml(
                        attachment.name
                      )}
                    </span>
                  </button>
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
                총 ${combinedEntries.length}건
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
              ${handoverEntries.length}건
            </span>

          </div>


          <div
            class="
              shift-log-detail-section__body
              shift-log-detail-section__body--roles
            "
          >
            ${handoverHtml}
          </div>

        </section>

        <!-- =================================================
          비고
        ================================================== -->
        <section
          class="
            shift-log-detail-section
            shift-log-detail-section--remark
          "
        >

          <div class="shift-log-detail-section__header">

            <div>
              <span class="shift-log-detail-eyebrow">
                NOTE
              </span>

              <h3>비고</h3>
            </div>

          </div>


          <div class="shift-log-detail-section__body">
            ${remarkHtml}
          </div>

        </section>


        <!-- =================================================
          첨부파일
        ================================================== -->
        <section
          class="
            shift-log-detail-section
            shift-log-detail-section--attachment
          "
        >

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
    `;


  /* =====================================================
    TAG 이동 이벤트
  ====================================================== */

  elements.logDetailContent
    .querySelectorAll(
      "[data-detail-tag]"
    )
    .forEach(
      (
        button
      ) => {
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
    첨부파일 버튼 이벤트
  ====================================================== */

  bindDetailAttachmentPreviewEvents(
    log,
    normalizedAttachments
  );


  /* =====================================================
    결재 버튼
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
    파트장 운전현황 미리보기

    업무일지 수정창과 동일하게:

    보직 | 상태 | 운전현황

    구조로 표시한다.
  ====================================================== */

  if (
    isLeaderLog &&
    operationStatus
  ) {
    const operationStatusRows =
      parseOperationStatusRowsForDisplay(
        log
      );


    if (
      operationStatusRows.length
    ) {
      sections.push(`
        <span
          class="
            search-preview-section
            is-operation
            is-operation-dashboard
          "
        >

          <strong
            class="search-preview-section__title"
          >
            운전현황
          </strong>


          <span
            class="search-preview-operation-list"
          >

            ${operationStatusRows
              .map(
                (
                  statusRow
                ) => {
                  const statusType =
                    normalizeOperationStatusType(
                      statusRow.type
                    );


                  return `
                    <span
                      class="
                        search-preview-operation-row
                        is-${escapeHtml(
                          statusType
                        )}
                      "
                    >

                      <strong
                        class="search-preview-operation-role"
                      >
                        ${escapeHtml(
                          statusRow.role ||
                          "-"
                        )}
                      </strong>


                      <span
                        class="
                          search-preview-operation-badge
                          is-${escapeHtml(
                            statusType
                          )}
                        "
                      >
                        ${escapeHtml(
                          getOperationStatusDisplayLabel(
                            statusType
                          )
                        )}
                      </span>


                      <span
                        class="search-preview-operation-divider"
                        aria-hidden="true"
                      >
                        |
                      </span>


                      <span
                        class="search-preview-operation-content"
                      >
                        ${escapeHtml(
                          statusRow.content ||
                          "등록된 운전현황이 없습니다."
                        )}
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
  조회 결과 출력 최종본

  핵심:
  - 조회 결과 전용 배열에 업무일지를 저장한다.
  - 클릭 시 appState.logs가 아니라
    currentSearchResultLogs에서 찾는다.
  - 조회 결과 행 전체를 클릭할 수 있다.
  - 과거 업무일지도 수정 권한과 관계없이 상세보기 가능
========================================================= */

function renderSearchResults(
  results
) {
  if (
    !elements.searchResultBody ||
    !elements.searchResultCount ||
    !elements.searchEmptyState
  ) {
    return;
  }


  const safeResults =
    Array.isArray(
      results
    )
      ? results.filter(
          log => {
            return Boolean(
              log &&
              log.id
            );
          }
        )
      : [];


  /*
    중요:

    조회 기간에서 새로 불러온 과거 업무일지는
    appState.logs에 없을 수 있다.

    클릭할 때 찾을 수 있도록
    조회 결과 전용 배열에 반드시 저장한다.
  */
  currentSearchResultLogs = [
    ...safeResults
  ];


  elements.searchResultBody.innerHTML =
    "";


  elements.searchResultCount.textContent =
    String(
      safeResults.length
    );


  elements.searchEmptyState.hidden =
    safeResults.length > 0;


  if (
    !safeResults.length
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


  safeResults.forEach(
    log => {
      const previewText =
        typeof createSearchLogPreviewText ===
          "function"
          ? createSearchLogPreviewText(
              log
            )
          : firstMeaningfulLine(
              createSearchLogText(
                log
              ) ||
              "-"
            );


      const attachmentCount =
        Array.isArray(
          log.attachments
        )
          ? log.attachments.length
          : Number(
              log.legacyAttachmentCount ||
              0
            );


      elements.searchResultBody
        .insertAdjacentHTML(
          "beforeend",
          `
            <tr
              data-search-log-id="${escapeHtml(
                log.id
              )}"
              tabindex="0"
              role="button"
              title="업무일지 상세보기"
            >

              <td
                class="search-result-table__date"
              >
                ${escapeHtml(
                  log.date ||
                  "-"
                )}
              </td>


              <td
                class="search-result-table__shift"
              >
                ${escapeHtml(
                  getShiftDisplayName(
                    log.shift
                  )
                )}
              </td>


              <td
                class="search-result-table__role"
              >
                ${escapeHtml(
                  log.role ||
                  "-"
                )}
              </td>


              <td
                class="search-result-table__author"
              >
                ${escapeHtml(
                  log.author ||
                  "-"
                )}
              </td>


              <td
                class="
                  search-result-table__content
                  search-log-preview-cell
                "
                data-search-view="${escapeHtml(
                  log.id
                )}"
              >
                ${escapeHtml(
                  previewText ||
                  "등록된 업무 내용이 없습니다."
                )}
              </td>


              <td
                class="search-result-table__view"
              >
                <button
                  type="button"
                  class="table-action-button"
                  data-search-view="${escapeHtml(
                    log.id
                  )}"
                >
                  보기
                </button>
              </td>


              <td
                class="search-result-table__attachment"
              >
                ${
                  attachmentCount > 0
                    ? `
                      <span
                        class="attachment-count"
                        title="첨부파일 ${attachmentCount}개"
                      >
                        ${attachmentCount}
                      </span>
                    `
                    : `
                      <span
                        class="
                          attachment-count
                          is-empty
                        "
                      >
                        0
                      </span>
                    `
                }
              </td>

            </tr>
          `
        );
    }
  );


  /* =====================================================
    조회 결과 클릭

    행·업무 내용·보기 버튼 모두 상세창을 연다.
  ====================================================== */

  elements.searchResultBody.onclick =
    function handleSearchResultClick(
      event
    ) {
      const tagButton =
        event.target.closest(
          "[data-search-tag]"
        );


      if (
        tagButton &&
        elements.searchResultBody.contains(
          tagButton
        )
      ) {
        event.preventDefault();

        event.stopPropagation();


        openFacilityNavigator(
          tagButton.dataset.searchTag
        );


        return;
      }


      const clickedElement =
        event.target.closest(
          `
            [data-search-view],
            tr[data-search-log-id]
          `
        );


      if (
        !clickedElement ||
        !elements.searchResultBody.contains(
          clickedElement
        )
      ) {
        return;
      }


      const row =
        clickedElement.closest(
          "tr[data-search-log-id]"
        );


      const logId =
        String(
          clickedElement.dataset.searchView ||
          row?.dataset.searchLogId ||
          ""
        ).trim();


      if (
        !logId
      ) {
        showToast(
          "업무일지 정보를 확인할 수 없습니다."
        );

        return;
      }


      /*
        조회 결과 전용 배열에서 먼저 찾는다.

        그래야 조회 기간에서 방금 불러온
        과거 업무일지도 상세보기가 가능하다.
      */
      const log =
        currentSearchResultLogs.find(
          item => {
            return (
              String(
                item?.id ||
                ""
              ).trim() ===
              logId
            );
          }
        ) ||
        appState.logs.find(
          item => {
            return (
              String(
                item?.id ||
                ""
              ).trim() ===
              logId
            );
          }
        );


      if (
        !log
      ) {
        showToast(
          "조회한 업무일지를 찾을 수 없습니다."
        );

        return;
      }


      openLogDetail(
        log
      );
    };


  /* =====================================================
    키보드 상세보기

    Enter 또는 Space
  ====================================================== */

  elements.searchResultBody.onkeydown =
    function handleSearchResultKeydown(
      event
    ) {
      if (
        event.key !==
          "Enter" &&
        event.key !==
          " "
      ) {
        return;
      }


      const row =
        event.target.closest(
          "tr[data-search-log-id]"
        );


      if (
        !row ||
        !elements.searchResultBody.contains(
          row
        )
      ) {
        return;
      }


      event.preventDefault();


      const logId =
        String(
          row.dataset.searchLogId ||
          ""
        ).trim();


      const log =
        currentSearchResultLogs.find(
          item => {
            return (
              String(
                item?.id ||
                ""
              ).trim() ===
              logId
            );
          }
        ) ||
        appState.logs.find(
          item => {
            return (
              String(
                item?.id ||
                ""
              ).trim() ===
              logId
            );
          }
        );


      if (
        !log
      ) {
        showToast(
          "조회한 업무일지를 찾을 수 없습니다."
        );

        return;
      }


      openLogDetail(
        log
      );
    };
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

/* =========================================================
  전 근무자 운전현황 가져오기
========================================================= */

async function handleLoadPreviousOperationStatus() {
  const loadButton =
    document.getElementById(
      "loadPreviousOperationStatusBtn"
    );


  const currentRole =
    normalizeMemberLogRole(
      elements.logRole?.value ||
      ""
    );


  /*
    TO · BO1 · BO2만 사용 가능
  */
  const allowedRoles = [
    "TO",
    "BO1",
    "BO2"
  ];


  if (
    !allowedRoles.includes(
      currentRole
    )
  ) {
    showToast(
      "TO·BO1·BO2 업무일지에서만 사용할 수 있습니다."
    );

    return;
  }


  if (
    !elements.operationStatus
  ) {
    showToast(
      "운전현황 입력창을 찾을 수 없습니다."
    );

    return;
  }


  const currentDate =
    String(
      elements.logDate?.value ||
      ""
    ).trim();


  const currentShift =
    String(
      elements.logShift?.value ||
      ""
    )
      .trim()
      .toUpperCase();


  if (
    !currentDate ||
    !currentShift
  ) {
    showToast(
      "업무일지 날짜와 근무를 확인해 주세요."
    );

    return;
  }


  /*
    현재 입력된 내용이 있으면
    조회 전에 덮어쓰기 여부 확인
  */
  const currentContent =
    String(
      elements.operationStatus.value ||
      ""
    ).trim();


  if (currentContent) {
    const shouldOverwrite =
      window.confirm(
        [
          "현재 작성된 운전현황이 있습니다.",
          "",
          "전 근무자 운전현황으로 덮어쓰시겠습니까?",
          "",
          "아직 업무일지는 저장되지 않습니다."
        ].join("\n")
      );


    if (!shouldOverwrite) {
      return;
    }
  }


  if (loadButton) {
    loadButton.disabled =
      true;

    loadButton.textContent =
      "불러오는 중...";
  }


  try {
    const previousStatus =
      await getPreviousShiftOperationStatus(
        currentRole,
        currentDate,
        currentShift
      );


    if (
      !previousStatus ||
      !previousStatus.content
    ) {
      showToast(
        "같은 보직의 전 근무자 운전현황을 찾을 수 없습니다."
      );

      return;
    }


    /*
      입력창에만 적용한다.
      저장 버튼을 누르기 전까지
      업무일지에는 저장되지 않는다.
    */
    elements.operationStatus.value =
      previousStatus.content;


    elements.operationStatus
      .dispatchEvent(
        new Event(
          "input",
          {
            bubbles: true
          }
        )
      );


    elements.operationStatus
      .focus();


    const previousShiftName =
      getShiftDisplayName(
        previousStatus.shift
      );


    showToast(
      [
        previousStatus.date,
        previousShiftName,
        currentRole,
        "운전현황을 가져왔습니다."
      ].join(" ")
    );

  } catch (error) {
    console.error(
      "전 근무자 운전현황 조회 오류:",
      error
    );


    showToast(
      error.message ||
      "전 근무자 운전현황을 불러오지 못했습니다."
    );

  } finally {
    if (loadButton) {
      loadButton.disabled =
        false;

      loadButton.textContent =
        "전 근무자 운전현황 가져오기";
    }
  }
}

/* =========================================================
  로그인 사용자 → 업무일지 작성자 자동 연결

  적용 규칙:
  - 작성자는 현재 로그인한 사용자 이름
  - 작성자 입력창 직접 수정 불가
  - 임시저장 또는 기존 자료를 불러와도
    현재 로그인 사용자 이름으로 다시 고정
========================================================= */

function getCurrentShiftLogUserIdentity() {
  const currentUser =
    loadCurrentUser();


  if (
    !currentUser
  ) {
    return {
      employeeNo:
        "",

      name:
        "",

      role:
        ""
    };
  }


  const employeeNo =
    String(
      currentUser.employeeNo ||
      currentUser.employee_no ||
      currentUser.employeeId ||
      currentUser.employee_id ||
      ""
    ).trim();


  const name =
    String(
      currentUser.name ||
      currentUser.employeeName ||
      currentUser.employee_name ||
      ""
    ).trim();


  const role =
    String(
      currentUser.role ||
      ""
    )
      .trim()
      .toLowerCase();


  return {
    employeeNo,

    name,

    role
  };
}


/* =========================================================
  작성자 입력창 잠금
========================================================= */

function applyCurrentUserToLogAuthor() {
  const authorInput =
    document.getElementById(
      "logAuthor"
    );


  if (
    !authorInput
  ) {
    return;
  }


  const currentUser =
    getCurrentShiftLogUserIdentity();


  /*
    로그인 사용자 이름이 정상적으로 있을 때만 적용
  */
  if (
    currentUser.name
  ) {
    authorInput.value =
      currentUser.name;
  }


  /*
    작성자 직접 수정 금지
  */
  authorInput.readOnly =
    true;


  authorInput.setAttribute(
    "aria-readonly",
    "true"
  );


  authorInput.setAttribute(
    "tabindex",
    "-1"
  );


  authorInput.setAttribute(
    "title",
    "작성자는 현재 로그인한 사용자로 자동 지정됩니다."
  );


  /*
    브라우저 자동완성 방지
  */
  authorInput.setAttribute(
    "autocomplete",
    "off"
  );
}


/* =========================================================
  업무일지 작성창이 열릴 때마다 작성자 재적용

  fillLogEditor()
  restoreDraftIfAvailable()
  resetLogEditor()

  위 함수들이 작성자 값을 바꾸더라도
  모달이 열리는 순간 현재 로그인 사용자로 다시 고정한다.
========================================================= */

function initializeCurrentUserLogAuthorLock() {
  const logEditorModal =
    document.getElementById(
      "logEditorModal"
    );


  /*
    최초 한 번 적용
  */
  applyCurrentUserToLogAuthor();


  if (
    !logEditorModal
  ) {
    return;
  }


  const observer =
    new MutationObserver(
      () => {
        const isOpen =
          logEditorModal
            .classList
            .contains(
              "is-open"
            ) ||

          logEditorModal.getAttribute(
            "aria-hidden"
          ) ===
            "false";


        if (
          !isOpen
        ) {
          return;
        }


        /*
          기존 함수들의 입력 처리가 끝난 다음
          로그인 사용자 이름을 최종 적용한다.
        */
        window.requestAnimationFrame(
          () => {
            applyCurrentUserToLogAuthor();
          }
        );
      }
    );


  observer.observe(
    logEditorModal,
    {
      attributes:
        true,

      attributeFilter: [
        "class",
        "aria-hidden"
      ]
    }
  );


  /*
    사용자가 개발자 도구 등으로 값을 변경하거나
    브라우저 자동완성이 값을 덮어쓰는 경우도 방지한다.
  */
  const authorInput =
    document.getElementById(
      "logAuthor"
    );


  authorInput
    ?.addEventListener(
      "input",
      () => {
        const currentUser =
          getCurrentShiftLogUserIdentity();


        if (
          currentUser.name &&
          authorInput.value !==
            currentUser.name
        ) {
          authorInput.value =
            currentUser.name;
        }
      }
    );
}


document.addEventListener(
  "DOMContentLoaded",
  initializeCurrentUserLogAuthorLock
);

/* =========================================================
  업무일지 작성자 정보 로그인 계정 강제 연결

  저장되는 값:
  - author     : 로그인 사용자 이름
  - authorId   : 로그인 사용자 사번
  - authorRole : 로그인 사용자 권한

  상태 기본 규칙:
  - 파트장 본인 업무일지 → 저장완료
  - 일반 파트원 업무일지 → 임시저장
  - 결재요청은 요청된 경우 그대로 유지

  기존 collectEditorData()의
  TM·인계사항·비고·첨부파일 수집 구조는 그대로 유지한다.
========================================================= */

function normalizeShiftLogAccountRole(
  role
) {
  return String(
    role || ""
  )
    .trim()
    .toLowerCase();
}


/* =========================================================
  현재 로그인 사용자가 파트장인지 확인
========================================================= */

function isCurrentShiftLogLeader() {
  const currentUser =
    getCurrentShiftLogUserIdentity();


  const accountRole =
    normalizeShiftLogAccountRole(
      currentUser.role
    );


  return (
    accountRole ===
      "admin" ||
    accountRole ===
      "leader"
  );
}


/* =========================================================
  저장 요청 상태 정규화
========================================================= */

function resolveShiftLogSaveStatus(
  requestedStatus
) {
  const normalizedStatus =
    String(
      requestedStatus ||
      ""
    ).trim();


  /*
    파트장 본인 업무일지는
    일반 저장 시 바로 저장완료
  */
  if (
    isCurrentShiftLogLeader()
  ) {
    return "저장완료";
  }


  /*
    파트원이 결재요청 버튼을 누른 경우
  */
  if (
    normalizedStatus ===
      "결재요청" ||
    normalizedStatus ===
      "작성완료"
  ) {
    return "결재요청";
  }


  /*
    파트원 일반 저장은 임시저장
  */
  return "임시저장";
}


/* =========================================================
  기존 업무일지 데이터 수집 함수 보존
========================================================= */

const collectEditorDataBeforeAccountLink =
  collectEditorData;


/* =========================================================
  로그인 계정 연결이 적용된 최종 데이터 수집 함수
========================================================= */

collectEditorData =
  function collectEditorData(
    requestedStatus
  ) {
    const log =
      collectEditorDataBeforeAccountLink(
        requestedStatus
      );


    const currentUser =
      getCurrentShiftLogUserIdentity();


    if (
      !currentUser.employeeNo ||
      !currentUser.name
    ) {
      showToast(
        "로그인 사용자 정보를 확인할 수 없습니다. 다시 로그인해 주세요."
      );


      return {
        ...log,

        author:
          "",

        authorId:
          "",

        authorRole:
          "",

        status:
          "임시저장"
      };
    }


    const editingId =
      String(
        elements.logEditorForm
          ?.dataset.editingId ||
        log?.id ||
        ""
      ).trim();


    const existingLog =
      editingId
        ? appState.logs.find(
            (currentLog) => {
              return (
                String(
                  currentLog?.id ||
                  ""
                ).trim() ===
                editingId
              );
            }
          ) || null
        : null;


    const now =
      new Date()
        .toISOString();


    /*
      최고관리자가 기존 업무일지를 수정할 때는
      원 작성자와 결재 상태를 그대로 유지한다.
    */
    if (
      isCurrentUserSuperAdmin() &&
      existingLog
    ) {
      return {
        ...log,

        author:
          String(
            existingLog.author ||
            log.author ||
            ""
          ).trim(),

        authorId:
          String(
            existingLog.authorId ||
            existingLog.writerId ||
            existingLog.employeeNo ||
            log.authorId ||
            ""
          ).trim(),

        authorRole:
          String(
            existingLog.authorRole ||
            log.authorRole ||
            ""
          ).trim(),

        status:
          normalizeShiftLogApprovalStatus(
            existingLog.status
          ),

        createdAt:
          existingLog.createdAt ||
          log.createdAt ||
          now,

        lastModifiedBy:
          currentUser.name,

        lastModifiedById:
          currentUser.employeeNo,

        lastModifiedByRole:
          normalizeShiftLogAccountRole(
            currentUser.role
          ),

        updatedAt:
          now
      };
    }


    const resolvedStatus =
      resolveShiftLogSaveStatus(
        requestedStatus
      );


    return {
      ...log,

      author:
        currentUser.name,

      authorId:
        currentUser.employeeNo,

      authorRole:
        normalizeShiftLogAccountRole(
          currentUser.role
        ),

      status:
        resolvedStatus,

      lastModifiedBy:
        currentUser.name,

      lastModifiedById:
        currentUser.employeeNo,

      lastModifiedByRole:
        normalizeShiftLogAccountRole(
          currentUser.role
        ),

      updatedAt:
        now
    };
  };

  /* =========================================================
  업무일지 작성창 버튼 권한 분리

  파트장:
  - 저장 버튼만 표시
  - 저장 시 저장완료
  - 임시저장 / 결재요청 숨김

  파트원:
  - 임시저장 표시
  - 결재요청 표시
  - 일반 저장 버튼 숨김
========================================================= */

function getShiftLogEditorSubmitButton() {
  return (
    elements.logEditorForm
      ?.querySelector(
        'button[type="submit"]'
      ) ||
    document.querySelector(
      '#logEditorForm button[type="submit"]'
    )
  );
}


/* =========================================================
  현재 로그인 사용자의 업무일지 권한 구분
========================================================= */

function getCurrentShiftLogPermissionType() {
  const currentUser =
    getCurrentShiftLogUserIdentity();


  const accountRole =
    String(
      currentUser.role ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    accountRole ===
      "admin" ||
    accountRole ===
      "leader"
  ) {
    return "leader";
  }


  return "member";
}


/* =========================================================
  작성창 하단 버튼 표시 갱신
========================================================= */

function updateLogEditorActionButtons() {
  const permissionType =
    getCurrentShiftLogPermissionType();


  const submitButton =
    getShiftLogEditorSubmitButton();


  const saveDraftButton =
    elements.saveDraftButton ||
    document.getElementById(
      "saveDraftButton"
    );


  const requestApprovalButton =
    elements.requestApprovalButton ||
    document.getElementById(
      "requestApprovalButton"
    );


  const isLeader =
    permissionType ===
      "leader";


  /*
    파트장 저장 버튼
  */
  if (
    submitButton
  ) {
    submitButton.hidden =
      !isLeader;

    submitButton.disabled =
      !isLeader;

    submitButton.textContent =
      "저장";

    submitButton.title =
      isLeader
        ? "파트장 업무일지를 저장완료 상태로 저장합니다."
        : "";
  }


  /*
    파트원 임시저장 버튼
  */
  if (
    saveDraftButton
  ) {
    saveDraftButton.hidden =
      isLeader;

    saveDraftButton.disabled =
      isLeader;

    saveDraftButton.textContent =
      "임시저장";
  }


  /*
    파트원 결재요청 버튼
  */
  if (
    requestApprovalButton
  ) {
    requestApprovalButton.hidden =
      isLeader;

    requestApprovalButton.disabled =
      isLeader;

    requestApprovalButton.textContent =
      "결재요청";
  }
}


/* =========================================================
  작성창이 열릴 때마다 버튼 권한 적용
========================================================= */

function initializeLogEditorActionButtonPermissions() {
  const logEditorModal =
    elements.logEditorModal ||
    document.getElementById(
      "logEditorModal"
    );


  /*
    최초 한 번 적용
  */
  updateLogEditorActionButtons();


  if (
    !logEditorModal
  ) {
    return;
  }


  const observer =
    new MutationObserver(
      () => {
        const isOpen =
          logEditorModal
            .classList
            .contains(
              "is-open"
            ) ||

          logEditorModal.getAttribute(
            "aria-hidden"
          ) ===
            "false";


        if (
          !isOpen
        ) {
          return;
        }


        window.requestAnimationFrame(
          () => {
            updateLogEditorActionButtons();
          }
        );
      }
    );


  observer.observe(
    logEditorModal,
    {
      attributes:
        true,

      attributeFilter: [
        "class",
        "aria-hidden"
      ]
    }
  );


  /*
    보직값이 화면 처리 과정에서 변경되더라도
    로그인 계정 권한 기준으로 버튼을 다시 맞춘다.
  */
  elements.logRole
    ?.addEventListener(
      "change",
      updateLogEditorActionButtons
    );
}


document.addEventListener(
  "DOMContentLoaded",
  initializeLogEditorActionButtonPermissions
);

/* =========================================================
  업무일지 수정 권한 및 결재 상태 잠금

  파트원:
  - 임시저장: 본인 수정 가능
  - 결재요청: 수정 불가
  - 결재완료: 수정 불가

  파트장:
  - 본인 저장완료 업무일지 수정 가능
  - 다른 사람 업무일지 직접 수정 불가
  - 결재는 상세보기의 결재 버튼으로만 처리

  과거 업무일지:
  - 수정 및 삭제 불가
========================================================= */


/* =========================================================
  업무일지 상태 정규화

  기존 상태값도 새 상태값으로 호환한다.
========================================================= */

function normalizeShiftLogApprovalStatus(
  status
) {
  const normalizedStatus =
    String(
      status ||
      ""
    ).trim();


  const statusMap = {
    작성중:
      "임시저장",

    임시저장:
      "임시저장",

    작성완료:
      "결재요청",

    결재요청:
      "결재요청",

    결재완료:
      "결재완료",

    저장완료:
      "저장완료"
  };


  return (
    statusMap[
      normalizedStatus
    ] ||
    normalizedStatus ||
    "임시저장"
  );
}


/* =========================================================
  현재 로그인 사용자가 해당 업무일지 작성자인지 확인

  신규 업무일지:
  - authorId 사용

  기존 신규 업무일지:
  - writerId 사용

  authorId가 없던 과거 저장자료:
  - 작성자 이름으로 보조 비교
========================================================= */

function isCurrentUserShiftLogAuthor(
  log
) {
  if (
    !log ||
    typeof log !==
      "object"
  ) {
    return false;
  }


  const currentUser =
    getCurrentShiftLogUserIdentity();


  const currentEmployeeNo =
    String(
      currentUser.employeeNo ||
      ""
    ).trim();


  const currentUserName =
    String(
      currentUser.name ||
      ""
    ).trim();


  const logAuthorId =
    String(
      log.authorId ||
      log.writerId ||
      log.employeeNo ||
      ""
    ).trim();


  const logAuthorName =
    String(
      log.author ||
      ""
    ).trim();


  /*
    사번이 양쪽에 존재하면
    반드시 사번으로 비교한다.
  */
  if (
    currentEmployeeNo &&
    logAuthorId
  ) {
    return (
      currentEmployeeNo ===
      logAuthorId
    );
  }


  /*
    authorId가 저장되기 전 자료만
    이름을 보조 기준으로 사용한다.
  */
  if (
    currentUserName &&
    logAuthorName
  ) {
    return (
      currentUserName ===
      logAuthorName
    );
  }


  return false;
}


/* =========================================================
  과거 업무일지 여부 확인
========================================================= */

function isReadOnlyLegacyShiftLog(
  log
) {
  const source =
    String(
      log?.source ||
      ""
    )
      .trim()
      .toLowerCase();


  return (
    source ===
      "legacy" ||
    source.startsWith(
      "legacy-"
    )
  );
}


/* =========================================================
  업무일지 수정 가능 여부
========================================================= */

function canCurrentUserEditShiftLog(
  log
) {
  if (
    !log ||
    typeof log !==
      "object"
  ) {
    return false;
  }


  /*
    과거 시스템 업무일지는 조회 전용
  */
  if (
    isReadOnlyLegacyShiftLog(
      log
    )
  ) {
    return false;
  }


  /*
    최고관리자는 작성자와 결재 상태에 관계없이
    모든 신규 업무일지를 수정·삭제할 수 있다.
  */
  if (
    isCurrentUserSuperAdmin()
  ) {
    return true;
  }


  /*
    다른 사람이 작성한 업무일지는
    파트장이라도 직접 수정하지 않는다.
  */
  if (
    !isCurrentUserShiftLogAuthor(
      log
    )
  ) {
    return false;
  }


  const normalizedStatus =
    normalizeShiftLogApprovalStatus(
      log.status
    );


  const isLeader =
    isCurrentShiftLogLeader();


  /*
    파트장 본인 업무일지

    저장완료 상태에서도
    본인이 다시 열어 수정할 수 있다.
  */
  if (
    isLeader &&
    normalizeMemberLogRole(
      log.role
    ) ===
      "파트장"
  ) {
    return [
      "임시저장",
      "저장완료"
    ].includes(
      normalizedStatus
    );
  }


  /*
    파트원 본인 업무일지

    임시저장 상태에서만 수정 가능
  */
  return (
    normalizedStatus ===
    "임시저장"
  );
}


/* =========================================================
  수정 불가 사유 표시
========================================================= */

function showShiftLogEditDeniedMessage(
  log
) {
  if (
    isReadOnlyLegacyShiftLog(
      log
    )
  ) {
    showToast(
      "과거 업무일지는 조회만 가능하며 수정할 수 없습니다."
    );

    return;
  }


  if (
    !isCurrentUserShiftLogAuthor(
      log
    )
  ) {
    showToast(
      "본인이 작성한 업무일지만 수정할 수 있습니다."
    );

    return;
  }


  const normalizedStatus =
    normalizeShiftLogApprovalStatus(
      log?.status
    );


  if (
    normalizedStatus ===
      "결재요청"
  ) {
    showToast(
      "결재요청 중인 업무일지입니다. 결재요청을 취소한 후 수정해 주세요."
    );

    return;
  }


  if (
    normalizedStatus ===
      "결재완료"
  ) {
    showToast(
      "결재가 완료된 업무일지입니다. 파트장이 결재를 취소해야 다시 수정할 수 있습니다."
    );

    return;
  }


  showToast(
    "현재 상태에서는 업무일지를 수정할 수 없습니다."
  );
}


/* =========================================================
  기존 업무일지 작성창 열기 함수 보존
========================================================= */

const openLogEditorBeforeApprovalLock =
  openLogEditor;


/* =========================================================
  결재 잠금이 적용된 업무일지 작성창 열기

  기존 업무일지 수정:
  - 권한과 상태를 먼저 검사

  신규 업무일지 작성:
  - 기존 openLogEditor 기능 그대로 실행
========================================================= */

openLogEditor =
  function openLogEditor(
    log = null,
    preset = null
  ) {
    /*
      기존 업무일지 수정 요청일 때만
      수정 권한을 검사한다.
    */
    if (
      log &&
      !canCurrentUserEditShiftLog(
        log
      )
    ) {
      showShiftLogEditDeniedMessage(
        log
      );

      /*
        수정창 대신 상세보기로 이동한다.
      */
      openLogDetail(
        log
      );

      return;
    }


    openLogEditorBeforeApprovalLock(
      log,
      preset
    );
  };


/* =========================================================
  기존 업무일지 삭제 함수 보존
========================================================= */

const deleteLogByIdBeforeApprovalLock =
  deleteLogById;


/* =========================================================
  결재 잠금이 적용된 업무일지 삭제
========================================================= */

deleteLogById =
  function deleteLogById(
    logId
  ) {
    const targetLog =
      appState.logs.find(
        (
          log
        ) => {
          return (
            String(
              log?.id ||
              ""
            ).trim() ===
            String(
              logId ||
              ""
            ).trim()
          );
        }
      );


    if (
      !targetLog
    ) {
      showToast(
        "삭제할 업무일지를 찾을 수 없습니다."
      );

      return;
    }


    if (
      !canCurrentUserEditShiftLog(
        targetLog
      )
    ) {
      showShiftLogEditDeniedMessage(
        targetLog
      );

      return;
    }


    deleteLogByIdBeforeApprovalLock(
      logId
    );
  };

  /* =========================================================
  상세보기 결재 버튼 권한 및 상태 제어

  파트원 본인:
  - 임시저장: 수정
  - 결재요청: 결재취소
  - 결재완료: 버튼 없음

  파트장:
  - 결재요청: 결재완료 + 결재취소
  - 결재완료: 결재취소
  - 파트장 본인 저장완료: 수정

  과거 업무일지:
  - 조회만 가능
========================================================= */


/* =========================================================
  현재 상세보기 업무일지 찾기
========================================================= */

function getCurrentDetailShiftLog() {
  const currentLogId =
    String(
      appState.currentDetailLogId ||
      ""
    ).trim();


  if (
    !currentLogId
  ) {
    return null;
  }


  return (
    appState.logs.find(
      (
        log
      ) => {
        return (
          String(
            log?.id ||
            ""
          ).trim() ===
          currentLogId
        );
      }
    ) ||
    null
  );
}


/* =========================================================
  결재취소 버튼 생성

  HTML 수정 없이 기존 상세보기 하단에 자동으로 추가한다.
========================================================= */

function ensureCancelApprovalDetailButton() {
  let cancelButton =
    document.getElementById(
      "cancelApprovalFromDetailButton"
    );


  if (
    cancelButton
  ) {
    return cancelButton;
  }


  const approveButton =
    elements.approveFromDetailButton ||
    document.getElementById(
      "approveFromDetailButton"
    );


  if (
    !approveButton
  ) {
    return null;
  }


  cancelButton =
    document.createElement(
      "button"
    );


  cancelButton.type =
    "button";


  cancelButton.id =
    "cancelApprovalFromDetailButton";


  cancelButton.className =
    "secondary-button";


  cancelButton.textContent =
    "결재취소";


  cancelButton.hidden =
    true;


  approveButton.insertAdjacentElement(
    "afterend",
    cancelButton
  );


  return cancelButton;
}


/* =========================================================
  상세보기 결재 버튼 표시 규칙
========================================================= */

function updateShiftLogDetailActionButtons(
  log
) {
  const approveButton =
    elements.approveFromDetailButton ||
    document.getElementById(
      "approveFromDetailButton"
    );


  const cancelApprovalButton =
    ensureCancelApprovalDetailButton();


  const editButton =
    elements.editFromDetailButton ||
    document.getElementById(
      "editFromDetailButton"
    );


  /*
    기본적으로 모든 작업 버튼을 숨긴다.
  */
  if (
    approveButton
  ) {
    approveButton.hidden =
      true;

    approveButton.disabled =
      true;

    approveButton.textContent =
      "결재완료";
  }


  if (
    cancelApprovalButton
  ) {
    cancelApprovalButton.hidden =
      true;

    cancelApprovalButton.disabled =
      true;

    cancelApprovalButton.textContent =
      "결재취소";
  }


  if (
    editButton
  ) {
    editButton.hidden =
      true;

    editButton.disabled =
      true;

    editButton.textContent =
      "수정";
  }


  if (
    !log ||
    isReadOnlyLegacyShiftLog(
      log
    )
  ) {
    return;
  }


  const normalizedStatus =
    normalizeShiftLogApprovalStatus(
      log.status
    );


  const isLeader =
    isCurrentShiftLogLeader() ||
    isCurrentUserSuperAdmin();


  const isAuthor =
    isCurrentUserShiftLogAuthor(
      log
    );


  const isLeaderLog =
    normalizeMemberLogRole(
      log.role
    ) ===
      "파트장";


  /* =====================================================
    수정 버튼

    앞 단계에서 만든 수정 가능 여부 함수를 그대로 사용한다.
  ====================================================== */

  if (
    editButton &&
    canCurrentUserEditShiftLog(
      log
    )
  ) {
    editButton.hidden =
      false;

    editButton.disabled =
      false;
  }


  /* =====================================================
    파트장 본인 업무일지

    승인 대상이 아니므로 결재 버튼을 표시하지 않는다.
  ====================================================== */

  if (
    isLeaderLog
  ) {
    return;
  }


  /* =====================================================
    파트장 권한

    결재요청:
    - 결재완료
    - 결재취소

    결재완료:
    - 결재취소
  ====================================================== */

  if (
    isLeader
  ) {
    if (
      normalizedStatus ===
        "결재요청"
    ) {
      if (
        approveButton
      ) {
        approveButton.hidden =
          false;

        approveButton.disabled =
          false;
      }


      if (
        cancelApprovalButton
      ) {
        cancelApprovalButton.hidden =
          false;

        cancelApprovalButton.disabled =
          false;
      }


      return;
    }


    if (
      normalizedStatus ===
        "결재완료"
    ) {
      if (
        cancelApprovalButton
      ) {
        cancelApprovalButton.hidden =
          false;

        cancelApprovalButton.disabled =
          false;
      }


      return;
    }


    return;
  }


  /* =====================================================
    파트원 본인

    결재요청 상태에서만 결재취소 가능
  ====================================================== */

  if (
    isAuthor &&
    normalizedStatus ===
      "결재요청"
  ) {
    if (
      cancelApprovalButton
    ) {
      cancelApprovalButton.hidden =
        false;

      cancelApprovalButton.disabled =
        false;
    }
  }
}


/* =========================================================
  파트장 결재완료 처리
========================================================= */

function completeCurrentDetailShiftLogApproval() {
  const targetLog =
    getCurrentDetailShiftLog();


  if (
    !targetLog
  ) {
    showToast(
      "결재할 업무일지를 찾을 수 없습니다."
    );

    return;
  }


  if (
    !(
      isCurrentShiftLogLeader() ||
      isCurrentUserSuperAdmin()
    )
  ) {
    showToast(
      "파트장 또는 최고관리자만 업무일지를 결재할 수 있습니다."
    );

    return;
  }


  if (
    isReadOnlyLegacyShiftLog(
      targetLog
    )
  ) {
    showToast(
      "과거 업무일지는 결재 상태를 변경할 수 없습니다."
    );

    return;
  }


  if (
    normalizeMemberLogRole(
      targetLog.role
    ) ===
      "파트장"
  ) {
    showToast(
      "파트장 업무일지는 결재 대상이 아닙니다."
    );

    return;
  }


  const currentStatus =
    normalizeShiftLogApprovalStatus(
      targetLog.status
    );


  if (
    currentStatus !==
      "결재요청"
  ) {
    showToast(
      currentStatus ===
        "결재완료"
        ? "이미 결재가 완료된 업무일지입니다."
        : "결재요청 상태의 업무일지만 결재할 수 있습니다."
    );

    return;
  }


  const shouldApprove =
    window.confirm(
      [
        "이 업무일지를 결재완료 처리하시겠습니까?",
        "",
        `작성일: ${targetLog.date || "-"}`,
        `근무: ${getShiftDisplayName(
          targetLog.shift
        )}`,
        `보직: ${targetLog.role || "-"}`,
        `작성자: ${targetLog.author || "-"}`
      ].join("\n")
    );


  if (
    !shouldApprove
  ) {
    return;
  }


  const currentUser =
    getCurrentShiftLogUserIdentity();


  const now =
    new Date()
      .toISOString();


  targetLog.status =
    "결재완료";


  targetLog.approvedAt =
    now;


  targetLog.approvedBy =
    currentUser.name;


  targetLog.approvedById =
    currentUser.employeeNo;


  targetLog.approvedByRole =
    normalizeShiftLogAccountRole(
      currentUser.role
    );


  targetLog.lastModifiedBy =
    currentUser.name;


  targetLog.lastModifiedById =
    currentUser.employeeNo;


  targetLog.updatedAt =
    now;


  persistLogs();


  renderLogTable();

  updateShiftMemberCardStates();


  openLogDetail(
    targetLog
  );


  showToast(
    "업무일지 결재가 완료되었습니다."
  );
}


/* =========================================================
  결재취소 가능 여부

  파트원:
  - 본인의 결재요청 상태만 가능

  파트장:
  - 결재요청
  - 결재완료
========================================================= */

function canCurrentUserCancelShiftLogApproval(
  log
) {
  if (
    !log ||
    isReadOnlyLegacyShiftLog(
      log
    )
  ) {
    return false;
  }


  if (
    normalizeMemberLogRole(
      log.role
    ) ===
      "파트장"
  ) {
    return false;
  }


  const normalizedStatus =
    normalizeShiftLogApprovalStatus(
      log.status
    );


  if (
    isCurrentShiftLogLeader() ||
    isCurrentUserSuperAdmin()
  ) {
    return [
      "결재요청",
      "결재완료"
    ].includes(
      normalizedStatus
    );
  }


  return (
    isCurrentUserShiftLogAuthor(
      log
    ) &&
    normalizedStatus ===
      "결재요청"
  );
}


/* =========================================================
  결재취소 처리

  결재요청 또는 결재완료
  → 임시저장

  다시 작성자 본인이 수정할 수 있게 된다.
========================================================= */

function cancelCurrentDetailShiftLogApproval() {
  const targetLog =
    getCurrentDetailShiftLog();


  if (
    !targetLog
  ) {
    showToast(
      "결재취소할 업무일지를 찾을 수 없습니다."
    );

    return;
  }


  if (
    !canCurrentUserCancelShiftLogApproval(
      targetLog
    )
  ) {
    showToast(
      "현재 계정으로는 이 업무일지의 결재를 취소할 수 없습니다."
    );

    return;
  }


  const previousStatus =
    normalizeShiftLogApprovalStatus(
      targetLog.status
    );


  const shouldCancel =
    window.confirm(
      previousStatus ===
        "결재완료"
        ? [
            "완료된 결재를 취소하시겠습니까?",
            "",
            "업무일지는 임시저장 상태로 돌아가며",
            "작성자가 다시 수정할 수 있게 됩니다."
          ].join("\n")
        : [
            "결재요청을 취소하시겠습니까?",
            "",
            "업무일지는 임시저장 상태로 돌아가며",
            "작성자가 다시 수정할 수 있게 됩니다."
          ].join("\n")
    );


  if (
    !shouldCancel
  ) {
    return;
  }


  const currentUser =
    getCurrentShiftLogUserIdentity();


  const now =
    new Date()
      .toISOString();


  targetLog.status =
    "임시저장";


  /*
    기존 결재완료 정보 제거
  */
  delete targetLog.approvedAt;

  delete targetLog.approvedBy;

  delete targetLog.approvedById;

  delete targetLog.approvedByRole;


  /*
    취소 이력 기록
  */
  targetLog.approvalCancelledAt =
    now;


  targetLog.approvalCancelledBy =
    currentUser.name;


  targetLog.approvalCancelledById =
    currentUser.employeeNo;


  targetLog.approvalCancelledFrom =
    previousStatus;


  targetLog.lastModifiedBy =
    currentUser.name;


  targetLog.lastModifiedById =
    currentUser.employeeNo;


  targetLog.updatedAt =
    now;


  persistLogs();


  renderLogTable();

  updateShiftMemberCardStates();


  openLogDetail(
    targetLog
  );


  showToast(
    previousStatus ===
      "결재완료"
      ? "완료된 결재를 취소했습니다. 작성자가 다시 수정할 수 있습니다."
      : "결재요청을 취소했습니다. 업무일지를 다시 수정할 수 있습니다."
  );
}


/* =========================================================
  기존 상세보기 함수 보존
========================================================= */

const openLogDetailBeforeApprovalActions =
  openLogDetail;


/* =========================================================
  결재 버튼 표시가 적용된 상세보기
========================================================= */

openLogDetail =
  function openLogDetail(
    log
  ) {
    openLogDetailBeforeApprovalActions(
      log
    );


    updateShiftLogDetailActionButtons(
      log
    );
  };


/* =========================================================
  상세보기 결재 버튼 이벤트 초기화

  기존 결재확인 버튼을 복제하여
  이전 클릭 이벤트를 완전히 제거한 뒤 새 기능을 연결한다.
========================================================= */

function initializeShiftLogDetailApprovalActions() {
  const oldApproveButton =
    document.getElementById(
      "approveFromDetailButton"
    );


  if (
    !oldApproveButton
  ) {
    return;
  }


  /*
    기존 approveCurrentDetailLog 이벤트 제거
  */
  const newApproveButton =
    oldApproveButton.cloneNode(
      true
    );


  oldApproveButton.replaceWith(
    newApproveButton
  );


  /*
    elements 참조도 새 버튼으로 갱신한다.
  */
  elements.approveFromDetailButton =
    newApproveButton;


  newApproveButton.textContent =
    "결재완료";


  newApproveButton.hidden =
    true;


  newApproveButton.disabled =
    true;


  newApproveButton.addEventListener(
    "click",
    completeCurrentDetailShiftLogApproval
  );


  const cancelApprovalButton =
    ensureCancelApprovalDetailButton();


  cancelApprovalButton
    ?.addEventListener(
      "click",
      cancelCurrentDetailShiftLogApproval
    );
}


document.addEventListener(
  "DOMContentLoaded",
  initializeShiftLogDetailApprovalActions
);

/* =========================================================
  업무일지 상태 표시 통일

  신규 상태:
  - 임시저장
  - 결재요청
  - 결재완료
  - 저장완료

  기존 상태 호환:
  - 작성중   → 임시저장
  - 작성완료 → 결재요청
========================================================= */


/* =========================================================
  화면에 표시할 상태명
========================================================= */

function getShiftLogStatusDisplayName(
  status
) {
  const normalizedStatus =
    normalizeShiftLogApprovalStatus(
      status
    );


  const displayNameMap = {
    임시저장:
      "임시저장",

    결재요청:
      "결재요청",

    결재완료:
      "결재완료",

    저장완료:
      "저장완료"
  };


  return (
    displayNameMap[
      normalizedStatus
    ] ||
    normalizedStatus ||
    "임시저장"
  );
}


/* =========================================================
  상태별 공통 CSS 클래스

  기존 CSS 클래스 이름을 최대한 재사용한다.
========================================================= */

getStatusClass =
  function getStatusClass(
    status
  ) {
    const normalizedStatus =
      normalizeShiftLogApprovalStatus(
        status
      );


    const statusClassMap = {
      임시저장:
        "is-writing",

      결재요청:
        "is-requested",

      결재완료:
        "is-approved",

      저장완료:
        "is-complete"
    };


    return (
      statusClassMap[
        normalizedStatus
      ] ||
      "is-writing"
    );
  };


/* =========================================================
  기존 목록 행 생성 함수 보존
========================================================= */

const createLogRowHtmlBeforeStatusDisplay =
  createLogRowHtml;


/* =========================================================
  목록 상태명을 통일한 행 생성 함수

  실제 원본 데이터는 변경하지 않고
  화면에 전달하는 복사본의 상태만 정규화한다.
========================================================= */

createLogRowHtml =
  function createLogRowHtml(
    log
  ) {
    const displayLog = {
      ...log,

      status:
        getShiftLogStatusDisplayName(
          log?.status
        )
    };


    return createLogRowHtmlBeforeStatusDisplay(
      displayLog
    );
  };


/* =========================================================
  같은 날짜·근무·보직의 최신 업무일지 찾기

  과거 자료가 여러 건 존재해도
  가장 최근 수정된 업무일지 한 건을 사용한다.
========================================================= */

function findLatestShiftMemberLog(
  date,
  shift,
  role
) {
  const normalizedDate =
    String(
      date ||
      ""
    ).trim();


  const normalizedShift =
    String(
      shift ||
      ""
    )
      .trim()
      .toUpperCase();


  const normalizedRole =
    normalizeMemberLogRole(
      role
    );


  const matchedLogs =
    appState.logs
      .filter(
        (
          log
        ) => {
          return (
            String(
              log?.date ||
              ""
            ).trim() ===
              normalizedDate &&

            String(
              log?.shift ||
              ""
            )
              .trim()
              .toUpperCase() ===
              normalizedShift &&

            normalizeMemberLogRole(
              log?.role
            ) ===
              normalizedRole
          );
        }
      )
      .sort(
        (
          firstLog,
          secondLog
        ) => {
          const firstTime =
            new Date(
              firstLog?.updatedAt ||
              firstLog?.createdAt ||
              0
            ).getTime();


          const secondTime =
            new Date(
              secondLog?.updatedAt ||
              secondLog?.createdAt ||
              0
            ).getTime();


          return (
            secondTime -
            firstTime
          );
        }
      );


  return (
    matchedLogs[0] ||
    null
  );
}


/* =========================================================
  근무자 카드 상태 설정
========================================================= */

function applyShiftMemberCardLogStatus(
  card,
  statusElement,
  log
) {
  if (
    !card ||
    !statusElement
  ) {
    return;
  }


  /*
    작성된 업무일지가 없는 경우
  */
  if (
    !log
  ) {
    card.dataset.logState =
      "empty";


    card.dataset.approvalStatus =
      "empty";


    statusElement.textContent =
      "미작성";


    statusElement.className =
      "shift-member-card__status is-empty";


    return;
  }


  const normalizedStatus =
    normalizeShiftLogApprovalStatus(
      log.status
    );


  const displayName =
    getShiftLogStatusDisplayName(
      normalizedStatus
    );


  card.dataset.logState =
    "existing";


  card.dataset.approvalStatus =
    normalizedStatus;


  statusElement.textContent =
    displayName;


  const statusClassMap = {
    임시저장:
      "is-writing",

    결재요청:
      "is-requested",

    결재완료:
      "is-approved",

    저장완료:
      "is-complete"
  };


  const statusClass =
    statusClassMap[
      normalizedStatus
    ] ||
    "is-writing";


  statusElement.className = [
    "shift-member-card__status",
    statusClass
  ].join(" ");
}


/* =========================================================
  근무자 카드 상태 전체 갱신 최종본

  표시 항목:
  - 보직
  - 작성자 이름
  - 대근 배지
  - 결재 상태

  결재 상태:
  - 미작성
  - 임시저장
  - 결재요청
  - 결재완료
  - 저장완료
========================================================= */

updateShiftMemberCardStates =
  function updateShiftMemberCardStates() {
    const selectedDate =
      formatInputDate(
        appState.selectedDate
      );


    const selectedShift =
      String(
        appState.selectedShift ||
        ""
      )
        .trim()
        .toUpperCase();


    const shiftMemberCards = [
      ...document.querySelectorAll(
        ".shift-member-card"
      )
    ];


    shiftMemberCards.forEach(
      (
        card
      ) => {
        const role =
          normalizeMemberLogRole(
            card.dataset.role ||
            ""
          );


        const roleElement =
          card.querySelector(
            ".shift-member-card__role"
          );


        const nameElement =
          card.querySelector(
            ".shift-member-card__name"
          );


        const nameWrapElement =
          card.querySelector(
            ".shift-member-card__name-wrap"
          ) ||
          nameElement?.parentElement ||
          null;


        const teamElement =
          card.querySelector(
            ".shift-member-card__team"
          );


        const statusElement =
          card.querySelector(
            ".shift-member-card__status"
          );


        /*
          보직명 복원

          HTML 내용이 비워졌거나 다른 코드에서
          변경되어도 data-role 값을 기준으로 다시 표시한다.
        */
        if (
          roleElement
        ) {
          roleElement.textContent =
            role;
        }


        /*
          근무파트는 카드 내부에서 표시하지 않는다.

          현재 파트는 근무자 현황 제목 옆에서만 표시한다.
        */
        if (
          teamElement
        ) {
          teamElement.textContent =
            "";

          teamElement.hidden =
            true;
        }


        /*
          이전 렌더링에서 생성한 대근 배지 제거
        */
        card
          .querySelectorAll(
            ".shift-member-card__substitute"
          )
          .forEach(
            (
              badge
            ) => {
              badge.remove();
            }
          );


        /*
          날짜·근무·보직이 같은
          가장 최근 업무일지 찾기
        */
        const existingLog =
          findLatestShiftMemberLog(
            selectedDate,
            selectedShift,
            role
          );


        /*
          작성된 업무일지가 없는 경우
        */
        if (
          !existingLog
        ) {
          if (
            nameElement
          ) {
            nameElement.textContent =
              "";
          }


          card.dataset.logState =
            "empty";


          card.dataset.approvalStatus =
            "empty";


          if (
            statusElement
          ) {
            statusElement.textContent =
              "미작성";


            statusElement.className =
              "shift-member-card__status is-empty";
          }


          card.setAttribute(
            "aria-label",
            `${role} 업무일지 작성`
          );


          return;
        }


        /*
          업무일지 작성자 이름 표시
        */
        const authorName =
          String(
            existingLog.author ||
            existingLog.authorName ||
            existingLog.writerName ||
            existingLog.writer_name ||
            ""
          ).trim();


        if (
          nameElement
        ) {
          nameElement.textContent =
            authorName;
        }


        /*
          대근 업무일지 표시
        */
        const isSubstitute =
          existingLog.isSubstitute ===
            true ||
          existingLog.isSubstitute ===
            "true" ||
          existingLog.is_substitute ===
            true ||
          Number(
            existingLog.isSubstitute ??
            existingLog.is_substitute ??
            0
          ) ===
            1;


        if (
          isSubstitute &&
          nameWrapElement
        ) {
          const substituteBadge =
            document.createElement(
              "span"
            );


          substituteBadge.className =
            "shift-member-card__substitute";


          substituteBadge.textContent =
            "대근";


          nameWrapElement.appendChild(
            substituteBadge
          );
        }


        /*
          결재 상태 표시
        */
        if (
          statusElement
        ) {
          applyShiftMemberCardLogStatus(
            card,
            statusElement,
            existingLog
          );
        }


        card.setAttribute(
          "aria-label",
          [
            role,
            authorName,
            getShiftLogStatusDisplayName(
              existingLog.status
            ),
            "업무일지 열기"
          ]
            .filter(Boolean)
            .join(" ")
        );
      }
    );
  };


/* =========================================================
  현재 화면 상태 즉시 갱신
========================================================= */

function refreshShiftLogStatusDisplays() {
  if (
    typeof renderLogTable ===
      "function"
  ) {
    renderLogTable();
  }


  updateShiftMemberCardStates();


  const currentDetailLog =
    typeof getCurrentDetailShiftLog ===
      "function"
      ? getCurrentDetailShiftLog()
      : null;


  if (
    currentDetailLog &&
    typeof updateShiftLogDetailActionButtons ===
      "function"
  ) {
    updateShiftLogDetailActionButtons(
      currentDetailLog
    );
  }
}


document.addEventListener(
  "DOMContentLoaded",
  () => {
    window.requestAnimationFrame(
      refreshShiftLogStatusDisplays
    );
  }
);

/* =========================================================
  업무일지 결재 이력

  기록 대상:
  - 임시저장
  - 결재요청
  - 저장완료
  - 결재완료
  - 결재취소

  저장 위치:
  log.approvalHistory
========================================================= */


/* =========================================================
  결재 이력 배열 정규화
========================================================= */

function normalizeShiftLogApprovalHistory(
  history
) {
  if (
    !Array.isArray(
      history
    )
  ) {
    return [];
  }


  return history
    .map(
      (
        historyItem
      ) => {
        if (
          !historyItem ||
          typeof historyItem !==
            "object"
        ) {
          return null;
        }


        const action =
          String(
            historyItem.action ||
            ""
          ).trim();


        const at =
          String(
            historyItem.at ||
            historyItem.createdAt ||
            ""
          ).trim();


        if (
          !action
        ) {
          return null;
        }


        return {
          id:
            String(
              historyItem.id ||
              ""
            ).trim() ||
            [
              "approval-history",
              Date.now(),
              Math.random()
                .toString(36)
                .slice(2, 9)
            ].join("-"),

          action,

          previousStatus:
            String(
              historyItem.previousStatus ||
              ""
            ).trim(),

          nextStatus:
            String(
              historyItem.nextStatus ||
              ""
            ).trim(),

          userId:
            String(
              historyItem.userId ||
              historyItem.employeeNo ||
              ""
            ).trim(),

          userName:
            String(
              historyItem.userName ||
              historyItem.name ||
              ""
            ).trim(),

          accountRole:
            String(
              historyItem.accountRole ||
              historyItem.role ||
              ""
            ).trim(),

          at:
            at ||
            new Date()
              .toISOString()
        };
      }
    )
    .filter(Boolean);
}


/* =========================================================
  결재 이력 한 건 생성
========================================================= */

function createShiftLogApprovalHistoryItem(
  action,
  options = {}
) {
  const {
    previousStatus = "",
    nextStatus = ""
  } = options;


  const currentUser =
    getCurrentShiftLogUserIdentity();


  return {
    id: [
      "approval-history",
      Date.now(),
      Math.random()
        .toString(36)
        .slice(2, 9)
    ].join("-"),

    action:
      String(
        action ||
        ""
      ).trim(),

    previousStatus:
      previousStatus
        ? normalizeShiftLogApprovalStatus(
            previousStatus
          )
        : "",

    nextStatus:
      nextStatus
        ? normalizeShiftLogApprovalStatus(
            nextStatus
          )
        : "",

    userId:
      String(
        currentUser.employeeNo ||
        ""
      ).trim(),

    userName:
      String(
        currentUser.name ||
        ""
      ).trim(),

    accountRole:
      normalizeShiftLogAccountRole(
        currentUser.role
      ),

    at:
      new Date()
        .toISOString()
  };
}


/* =========================================================
  중복 이력 방지

  같은 사용자·행동·상태가 매우 짧은 시간 안에
  반복 저장되면 한 건만 유지한다.
========================================================= */

function isDuplicateShiftLogApprovalHistory(
  history,
  newHistoryItem
) {
  const safeHistory =
    normalizeShiftLogApprovalHistory(
      history
    );


  const latestItem =
    safeHistory[
      safeHistory.length - 1
    ];


  if (
    !latestItem
  ) {
    return false;
  }


  const latestTime =
    new Date(
      latestItem.at
    ).getTime();


  const newTime =
    new Date(
      newHistoryItem.at
    ).getTime();


  const timeDifference =
    Math.abs(
      newTime -
      latestTime
    );


  return (
    latestItem.action ===
      newHistoryItem.action &&

    latestItem.userId ===
      newHistoryItem.userId &&

    latestItem.previousStatus ===
      newHistoryItem.previousStatus &&

    latestItem.nextStatus ===
      newHistoryItem.nextStatus &&

    timeDifference <
      2000
  );
}


/* =========================================================
  업무일지에 결재 이력 추가
========================================================= */

function appendShiftLogApprovalHistory(
  log,
  action,
  options = {}
) {
  if (
    !log ||
    typeof log !==
      "object"
  ) {
    return log;
  }


  const previousHistory =
    normalizeShiftLogApprovalHistory(
      log.approvalHistory
    );


  const newHistoryItem =
    createShiftLogApprovalHistoryItem(
      action,
      options
    );


  if (
    isDuplicateShiftLogApprovalHistory(
      previousHistory,
      newHistoryItem
    )
  ) {
    log.approvalHistory =
      previousHistory;

    return log;
  }


  log.approvalHistory = [
    ...previousHistory,
    newHistoryItem
  ];


  return log;
}


/* =========================================================
  저장 직전 기존 업무일지 찾기
========================================================= */

function getEditingShiftLogBeforeSave() {
  const editingId =
    String(
      elements.logEditorForm
        ?.dataset
        ?.editingId ||
      ""
    ).trim();


  if (
    !editingId
  ) {
    return null;
  }


  return (
    appState.logs.find(
      (
        log
      ) => {
        return (
          String(
            log?.id ||
            ""
          ).trim() ===
          editingId
        );
      }
    ) ||
    null
  );
}


/* =========================================================
  기존 최종 데이터 수집 함수 보존
========================================================= */

const collectEditorDataBeforeApprovalHistory =
  collectEditorData;


/* =========================================================
  결재 이력이 적용된 최종 데이터 수집 함수

  신규 작성:
  첫 저장 행동을 기록한다.

  기존 수정:
  이전 이력을 그대로 유지하고,
  상태가 변경된 경우에만 새 이력을 추가한다.
========================================================= */

collectEditorData =
  function collectEditorData(
    requestedStatus
  ) {
    const previousLog =
      getEditingShiftLogBeforeSave();


    const collectedLog =
      collectEditorDataBeforeApprovalHistory(
        requestedStatus
      );


    if (
      !collectedLog ||
      typeof collectedLog !==
        "object"
    ) {
      return collectedLog;
    }


    const previousStatus =
      previousLog
        ? normalizeShiftLogApprovalStatus(
            previousLog.status
          )
        : "";


    const nextStatus =
      normalizeShiftLogApprovalStatus(
        collectedLog.status
      );


    collectedLog.approvalHistory =
      normalizeShiftLogApprovalHistory(
        previousLog?.approvalHistory ||
        collectedLog.approvalHistory
      );


    /*
      신규 업무일지

      첫 저장 행동은 반드시 기록한다.
    */
    if (
      !previousLog
    ) {
      appendShiftLogApprovalHistory(
        collectedLog,
        nextStatus,
        {
          previousStatus:
            "",

          nextStatus
        }
      );


      return collectedLog;
    }


    /*
      기존 업무일지 상태가 바뀐 경우
    */
    if (
      previousStatus !==
      nextStatus
    ) {
      appendShiftLogApprovalHistory(
        collectedLog,
        nextStatus,
        {
          previousStatus,

          nextStatus
        }
      );


      return collectedLog;
    }


    /*
      같은 상태에서 내용만 수정한 경우

      이력을 과도하게 늘리지 않도록
      별도의 결재 이력은 추가하지 않는다.
    */
    return collectedLog;
  };


/* =========================================================
  파트장 결재완료 함수 보존
========================================================= */

const completeCurrentDetailShiftLogApprovalBeforeHistory =
  completeCurrentDetailShiftLogApproval;


/* =========================================================
  결재완료 이력 추가

  기존 결재완료 함수 실행 후
  실제 상태가 결재완료로 바뀐 경우에만 기록한다.
========================================================= */

completeCurrentDetailShiftLogApproval =
  function completeCurrentDetailShiftLogApproval() {
    const targetLogBefore =
      getCurrentDetailShiftLog();


    const previousStatus =
      normalizeShiftLogApprovalStatus(
        targetLogBefore?.status
      );


    completeCurrentDetailShiftLogApprovalBeforeHistory();


    const targetLogAfter =
      getCurrentDetailShiftLog();


    if (
      !targetLogAfter
    ) {
      return;
    }


    const nextStatus =
      normalizeShiftLogApprovalStatus(
        targetLogAfter.status
      );


    if (
      previousStatus ===
        nextStatus ||
      nextStatus !==
        "결재완료"
    ) {
      return;
    }


    appendShiftLogApprovalHistory(
      targetLogAfter,
      "결재완료",
      {
        previousStatus,

        nextStatus
      }
    );


    persistLogs();

    renderLogTable();

    updateShiftMemberCardStates();

    openLogDetail(
      targetLogAfter
    );
  };


/* =========================================================
  결재취소 함수 보존
========================================================= */

const cancelCurrentDetailShiftLogApprovalBeforeHistory =
  cancelCurrentDetailShiftLogApproval;


/* =========================================================
  결재취소 이력 추가

  결재취소 후 상태는 임시저장이지만
  이력 action은 "결재취소"로 기록한다.
========================================================= */

cancelCurrentDetailShiftLogApproval =
  function cancelCurrentDetailShiftLogApproval() {
    const targetLogBefore =
      getCurrentDetailShiftLog();


    const previousStatus =
      normalizeShiftLogApprovalStatus(
        targetLogBefore?.status
      );


    cancelCurrentDetailShiftLogApprovalBeforeHistory();


    const targetLogAfter =
      getCurrentDetailShiftLog();


    if (
      !targetLogAfter
    ) {
      return;
    }


    const nextStatus =
      normalizeShiftLogApprovalStatus(
        targetLogAfter.status
      );


    if (
      previousStatus ===
        nextStatus ||
      nextStatus !==
        "임시저장"
    ) {
      return;
    }


    appendShiftLogApprovalHistory(
      targetLogAfter,
      "결재취소",
      {
        previousStatus,

        nextStatus
      }
    );


    persistLogs();

    renderLogTable();

    updateShiftMemberCardStates();

    openLogDetail(
      targetLogAfter
    );
  };


/* =========================================================
  결재 행동 표시 이름
========================================================= */

function getShiftLogApprovalHistoryActionLabel(
  historyItem
) {
  const action =
    String(
      historyItem?.action ||
      ""
    ).trim();


  if (
    action ===
      "결재취소"
  ) {
    const previousStatus =
      normalizeShiftLogApprovalStatus(
        historyItem.previousStatus
      );


    return (
      previousStatus ===
        "결재완료"
        ? "완료된 결재 취소"
        : "결재요청 취소"
    );
  }


  return getShiftLogStatusDisplayName(
    action
  );
}


/* =========================================================
  결재 이력 역할 표시
========================================================= */

function getShiftLogApprovalHistoryRoleLabel(
  accountRole
) {
  const normalizedRole =
    String(
      accountRole ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    normalizedRole ===
      "leader" ||
    normalizedRole ===
      "admin"
  ) {
    return "파트장";
  }


  if (
    normalizedRole ===
      "super_admin" ||
    normalizedRole ===
      "superadmin"
  ) {
    return "최고관리자";
  }


  return "파트원";
}


/* =========================================================
  상세보기 결재 이력 HTML
========================================================= */

function createShiftLogApprovalHistoryHtml(
  log
) {
  const history =
    normalizeShiftLogApprovalHistory(
      log?.approvalHistory
    );


  /*
    과거 업무일지 또는 아직 이력이 없는 기존 자료
  */
  if (
    !history.length
  ) {
    return `
      <section
        class="detail-section shift-log-approval-history"
        data-shift-log-approval-history
      >
        <div class="detail-section__header">
          <h3>
            결재 이력
          </h3>

          <span class="detail-count">
            0건
          </span>
        </div>

        <div class="shift-log-approval-history__empty">
          저장된 결재 이력이 없습니다.
        </div>
      </section>
    `;
  }


  const orderedHistory = [
    ...history
  ].sort(
    (
      firstItem,
      secondItem
    ) => {
      return (
        new Date(
          secondItem.at
        ).getTime() -
        new Date(
          firstItem.at
        ).getTime()
      );
    }
  );


  return `
    <section
      class="detail-section shift-log-approval-history"
      data-shift-log-approval-history
    >
      <div class="detail-section__header">
        <h3>
          결재 이력
        </h3>

        <span class="detail-count">
          ${orderedHistory.length}건
        </span>
      </div>


      <div class="shift-log-approval-history__list">
        ${orderedHistory
          .map(
            (
              historyItem
            ) => {
              const actionLabel =
                getShiftLogApprovalHistoryActionLabel(
                  historyItem
                );


              const userName =
                String(
                  historyItem.userName ||
                  "사용자"
                ).trim();


              const userId =
                String(
                  historyItem.userId ||
                  ""
                ).trim();


              const roleLabel =
                getShiftLogApprovalHistoryRoleLabel(
                  historyItem.accountRole
                );


              const userText =
                userId
                  ? `${userName} (${userId})`
                  : userName;


              return `
                <article
                  class="shift-log-approval-history__item"
                >
                  <div
                    class="shift-log-approval-history__action"
                  >
                    ${escapeHtml(
                      actionLabel
                    )}
                  </div>


                  <div
                    class="shift-log-approval-history__person"
                  >
                    <strong>
                      ${escapeHtml(
                        userText
                      )}
                    </strong>

                    <span>
                      ${escapeHtml(
                        roleLabel
                      )}
                    </span>
                  </div>


                  <time
                    class="shift-log-approval-history__time"
                    datetime="${escapeHtml(
                      historyItem.at
                    )}"
                  >
                    ${escapeHtml(
                      formatDateTime(
                        historyItem.at
                      )
                    )}
                  </time>
                </article>
              `;
            }
          )
          .join("")}
      </div>
    </section>
  `;
}


/* =========================================================
  상세보기 결재 이력 숨김

  결재 이력 데이터 저장과
  결재 기능은 그대로 유지하고,
  상세 화면에만 표시하지 않는다.
========================================================= */

function renderShiftLogApprovalHistoryInDetail(
  log
) {
  const detailContent =
    elements.logDetailContent ||
    document.getElementById(
      "logDetailContent"
    );


  if (!detailContent) {
    return;
  }


  detailContent
    .querySelectorAll(
      "[data-shift-log-approval-history]"
    )
    .forEach(
      historyElement => {
        historyElement.remove();
      }
    );
}


/* =========================================================
  기존 최종 상세보기 함수 보존
========================================================= */

const openLogDetailBeforeApprovalHistory =
  openLogDetail;


/* =========================================================
  결재 이력이 포함된 최종 상세보기
========================================================= */

openLogDetail =
  function openLogDetail(
    log
  ) {
    openLogDetailBeforeApprovalHistory(
      log
    );


    renderShiftLogApprovalHistoryInDetail(
      log
    );
  };

  /* =========================================================
  결재 버튼 이벤트를 결재 이력 포함 함수로 재연결
========================================================= */

function reconnectShiftLogApprovalHistoryEvents() {

  const approveButton =
    document.getElementById(
      "approveFromDetailButton"
    );

  if (approveButton) {

    const newApproveButton =
      approveButton.cloneNode(true);

    approveButton.replaceWith(
      newApproveButton
    );

    elements.approveFromDetailButton =
      newApproveButton;

    newApproveButton.addEventListener(
      "click",
      completeCurrentDetailShiftLogApproval
    );
  }


  const cancelButton =
    document.getElementById(
      "cancelApprovalFromDetailButton"
    );

  if (cancelButton) {

    const newCancelButton =
      cancelButton.cloneNode(true);

    cancelButton.replaceWith(
      newCancelButton
    );

    elements.cancelApprovalFromDetailButton =
      newCancelButton;

    newCancelButton.addEventListener(
      "click",
      cancelCurrentDetailShiftLogApproval
    );
  }


  const printButton =
    document.getElementById(
      "printLogDetailButton"
    );

  if (printButton) {

    const newPrintButton =
      printButton.cloneNode(true);

    printButton.replaceWith(
      newPrintButton
    );

    elements.printLogDetailButton =
      newPrintButton;

    newPrintButton.addEventListener(
      "click",
      () => {
        window.print();
      }
    );
  }
}


document.addEventListener(
  "DOMContentLoaded",
  reconnectShiftLogApprovalHistoryEvents
);