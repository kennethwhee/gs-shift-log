"use strict";

/* =========================================================
  GS Shift Log 직원 계정 관리 API

  GET  /api/employees
  POST /api/employees

  POST 기능:
  - 직원 1명 등록
  - 엑셀 직원 여러 명 일괄 등록
  - 신규 직원 초기 비밀번호는 사번과 동일
  - 기존 사용자의 비밀번호는 유지
  - 기존 사번은 이름과 권한만 갱신
========================================================= */


/* =========================================================
  JSON 응답
========================================================= */

function createJsonResponse(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


/* =========================================================
  DB 확인
========================================================= */

function validateDatabase(env) {
  if (!env.DB) {
    throw new Error(
      "D1 바인딩 DB가 등록되지 않았습니다."
    );
  }
}


/* =========================================================
  문자열 정리
========================================================= */

function normalizeText(value) {
  return String(
    value ?? ""
  ).trim();
}


/* =========================================================
  사번 정리
========================================================= */

function normalizeEmployeeId(value) {
  return normalizeText(
    value
  ).replace(
    /[^0-9]/g,
    ""
  );
}


/* =========================================================
  권한 정리

  프런트에서 파트장을 admin으로 보내고 있으므로
  DB에는 leader로 변환하여 저장한다.
========================================================= */

function normalizeRole(value) {
  const role =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /\s+/g,
        "_"
      );

  if (
    role === "leader" ||
    role === "admin"
  ) {
    return "leader";
  }

  if (
    role === "super_admin" ||
    role === "superadmin"
  ) {
    return "super_admin";
  }

  return "user";
}


/* =========================================================
  엑셀 직원 데이터 정리
========================================================= */

function normalizeEmployee(employee) {
  const source =
    employee &&
    typeof employee === "object"
      ? employee
      : {};

  return {
    employeeId:
      normalizeEmployeeId(
        source.employeeNo ??
        source.employeeId
      ),

    employeeName:
      normalizeText(
        source.name ??
        source.employeeName
      ),

    role:
      normalizeRole(
        source.defaultRole ??
        source.role
      )
  };
}


/* =========================================================
  직원 데이터 검사
========================================================= */

function validateEmployee(
  employee,
  rowNumber
) {
  const rowText =
    rowNumber
      ? `${rowNumber}번째 직원: `
      : "";

  if (!employee.employeeId) {
    return (
      rowText +
      "사번이 없습니다."
    );
  }

  if (
    !/^\d{6,10}$/.test(
      employee.employeeId
    )
  ) {
    return (
      rowText +
      "사번은 숫자 6~10자리여야 합니다."
    );
  }

  if (!employee.employeeName) {
    return (
      rowText +
      "직원 이름이 없습니다."
    );
  }

  return "";
}


/* =========================================================
  Uint8Array → Base64
========================================================= */

function bytesToBase64(bytes) {
  let binaryText = "";

  bytes.forEach(
    byte => {
      binaryText +=
        String.fromCharCode(
          byte
        );
    }
  );

  return btoa(
    binaryText
  );
}


/* =========================================================
  랜덤 Salt 생성
========================================================= */

function createPasswordSalt() {
  const saltBytes =
    crypto.getRandomValues(
      new Uint8Array(16)
    );

  return bytesToBase64(
    saltBytes
  );
}


/* =========================================================
  문자열 인코딩
========================================================= */

function encodeText(value) {
  return new TextEncoder()
    .encode(
      String(
        value ?? ""
      )
    );
}


/* =========================================================
  PBKDF2 비밀번호 해시
========================================================= */

async function hashPassword(
  password,
  salt
) {
  const keyMaterial =
    await crypto.subtle.importKey(
      "raw",
      encodeText(
        password
      ),
      {
        name:
          "PBKDF2"
      },
      false,
      [
        "deriveBits"
      ]
    );

  const derivedBits =
    await crypto.subtle.deriveBits(
      {
        name:
          "PBKDF2",

        salt:
          encodeText(
            salt
          ),

        iterations:
          210000,

        hash:
          "SHA-256"
      },
      keyMaterial,
      256
    );

  return bytesToBase64(
    new Uint8Array(
      derivedBits
    )
  );
}


/* =========================================================
  직원 정보 등록 또는 수정
========================================================= */

async function upsertEmployee(
  database,
  employee
) {
  const existingEmployee =
    await database
      .prepare(
        `
          SELECT
            employee_id
          FROM employees
          WHERE employee_id = ?1
          LIMIT 1
        `
      )
      .bind(
        employee.employeeId
      )
      .first();


  if (existingEmployee) {
    await database
      .prepare(
        `
          UPDATE employees
          SET
            employee_name = ?1,
            role = ?2,
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE employee_id = ?3
        `
      )
      .bind(
        employee.employeeName,
        employee.role,
        employee.employeeId
      )
      .run();

    return {
      action:
        "updated",

      employeeId:
        employee.employeeId
    };
  }


  await database
    .prepare(
      `
        INSERT INTO employees (
          employee_id,
          employee_name,
          role,
          is_active,
          created_at,
          updated_at
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          1,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `
    )
    .bind(
      employee.employeeId,
      employee.employeeName,
      employee.role
    )
    .run();


  return {
    action:
      "created",

    employeeId:
      employee.employeeId
  };
}


/* =========================================================
  신규 로그인 계정 생성

  기존 계정은 비밀번호를 절대 변경하지 않는다.
========================================================= */

async function createInitialUser(
  database,
  employeeId
) {
  const existingUser =
    await database
      .prepare(
        `
          SELECT
            employee_id
          FROM users
          WHERE employee_id = ?1
          LIMIT 1
        `
      )
      .bind(
        employeeId
      )
      .first();


  if (existingUser) {
    return {
      created:
        false
    };
  }


  const passwordSalt =
    createPasswordSalt();


  const passwordHash =
    await hashPassword(
      employeeId,
      passwordSalt
    );


  await database
    .prepare(
      `
        INSERT INTO users (
          employee_id,
          password_hash,
          password_salt,
          must_change_password,
          failed_login_count,
          created_at,
          updated_at
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          1,
          0,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `
    )
    .bind(
      employeeId,
      passwordHash,
      passwordSalt
    )
    .run();


  return {
    created:
      true
  };
}


/* =========================================================
  GET /api/employees

  직원 계정 목록 조회
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    validateDatabase(
      context.env
    );


    const queryResult =
      await context.env.DB
        .prepare(
          `
            SELECT
              employee_id,
              employee_name,
              role,
              is_active,
              created_at,
              updated_at
            FROM employees
            ORDER BY
              employee_name ASC,
              employee_id ASC
          `
        )
        .all();


    const employees =
      Array.isArray(
        queryResult.results
      )
        ? queryResult.results
        : [];


    return createJsonResponse({
      ok:
        true,

      success:
        true,

      employees:
        employees.map(
          employee => {
            return {
              employeeNo:
                String(
                  employee.employee_id ||
                  ""
                ),

              employeeId:
                String(
                  employee.employee_id ||
                  ""
                ),

              name:
                String(
                  employee.employee_name ||
                  ""
                ),

              employeeName:
                String(
                  employee.employee_name ||
                  ""
                ),

              role:
                String(
                  employee.role ||
                  "user"
                ),

              defaultRole:
                String(
                  employee.role ||
                  "user"
                ),

              isActive:
                Number(
                  employee.is_active
                ) === 1,

              isAllowed:
                Number(
                  employee.is_active
                ) === 1,

              createdAt:
                employee.created_at ||
                "",

              updatedAt:
                employee.updated_at ||
                ""
            };
          }
        )
    });

  } catch (error) {
    console.error(
      "직원 목록 조회 오류:",
      error
    );


    return createJsonResponse(
      {
        ok:
          false,

        success:
          false,

        message:
          "직원 목록을 불러오는 중 오류가 발생했습니다.",

        error:
          error instanceof Error
            ? error.message
            : String(error)
      },
      500
    );
  }
}


/* =========================================================
  POST /api/employees

  직원 1명 또는 여러 명 저장
========================================================= */

export async function onRequestPost(
  context
) {
  try {
    validateDatabase(
      context.env
    );


    const body =
      await context.request.json();


    const sourceEmployees =
      Array.isArray(
        body?.employees
      )
        ? body.employees
        : [
            body
          ];


    if (
      sourceEmployees.length === 0
    ) {
      return createJsonResponse(
        {
          ok:
            false,

          success:
            false,

          message:
            "저장할 직원 정보가 없습니다."
        },
        400
      );
    }


    const employees =
      sourceEmployees.map(
        normalizeEmployee
      );


    const validationErrors =
      employees
        .map(
          (
            employee,
            index
          ) => {
            return validateEmployee(
              employee,
              index + 1
            );
          }
        )
        .filter(Boolean);


    if (
      validationErrors.length >
      0
    ) {
      return createJsonResponse(
        {
          ok:
            false,

          success:
            false,

          message:
            validationErrors[0],

          errors:
            validationErrors
        },
        400
      );
    }


    const employeeMap =
      new Map();


    employees.forEach(
      employee => {
        employeeMap.set(
          employee.employeeId,
          employee
        );
      }
    );


    const uniqueEmployees =
      Array.from(
        employeeMap.values()
      );


    let createdEmployeeCount =
      0;


    let updatedEmployeeCount =
      0;


    let createdUserCount =
      0;


    let existingUserCount =
      0;


    for (
      const employee of
      uniqueEmployees
    ) {
      const employeeResult =
        await upsertEmployee(
          context.env.DB,
          employee
        );


      if (
        employeeResult.action ===
        "created"
      ) {
        createdEmployeeCount +=
          1;
      } else {
        updatedEmployeeCount +=
          1;
      }


      const userResult =
        await createInitialUser(
          context.env.DB,
          employee.employeeId
        );


      if (
        userResult.created
      ) {
        createdUserCount +=
          1;
      } else {
        existingUserCount +=
          1;
      }
    }


    const leaderCount =
      uniqueEmployees.filter(
        employee => {
          return (
            employee.role ===
            "leader"
          );
        }
      ).length;


    return createJsonResponse({
      ok:
        true,

      success:
        true,

      message:
        [
          `직원 ${uniqueEmployees.length}명 저장 완료`,
          `신규 ${createdEmployeeCount}명`,
          `수정 ${updatedEmployeeCount}명`,
          `신규 로그인 계정 ${createdUserCount}명`
        ].join(" / "),

      totalEmployeeCount:
        uniqueEmployees.length,

      createdEmployeeCount,

      updatedEmployeeCount,

      createdUserCount,

      existingUserCount,

      leaderCount,

      initialPasswordNotice:
        "신규 계정의 초기 비밀번호는 사번과 동일합니다."
    });

  } catch (error) {

  console.error(error);

  return createJsonResponse(
    {
      ok: false,
      success: false,

      message:
        error instanceof Error
          ? error.message
          : String(error),

      stack:
        error instanceof Error
          ? error.stack
          : null
    },
    500
  );

}
}


/* =========================================================
  허용하지 않는 요청
========================================================= */

export function onRequestPut() {
  return createJsonResponse(
    {
      ok:
        false,

      success:
        false,

      message:
        "PUT 요청은 지원하지 않습니다."
    },
    405
  );
}


export function onRequestDelete() {
  return createJsonResponse(
    {
      ok:
        false,

      success:
        false,

      message:
        "DELETE 요청은 아직 지원하지 않습니다."
    },
    405
  );
}