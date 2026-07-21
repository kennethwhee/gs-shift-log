"use strict";

/* =========================================================
  GS Shift Log 직원 계정 최초 등록 API

  POST /api/employees-seed

  기능:
  - 직원 33명 등록
  - 초기 비밀번호는 사번과 동일
  - 비밀번호 원문은 저장하지 않음
  - PBKDF2 해시 적용
  - 파트장 4명은 leader 권한 부여

  보안:
  - Cloudflare 환경변수 SEED_SECRET 필요
  - 요청 헤더 x-seed-secret 값이 일치해야 실행
========================================================= */


/* =========================================================
  등록할 직원 명단

  role:
  - user   : 일반 직원
  - leader : 파트장
========================================================= */

const EMPLOYEE_SEED_DATA = [
  {
    employeeId: "2014100",
    employeeName: "형준영",
    role: "user"
  },
  {
    employeeId: "2014101",
    employeeName: "양영균",
    role: "user"
  },
  {
    employeeId: "2014107",
    employeeName: "김민중",
    role: "user"
  },
  {
    employeeId: "2022003",
    employeeName: "송관석",
    role: "user"
  },
  {
    employeeId: "2014078",
    employeeName: "이성진",
    role: "user"
  },
  {
    employeeId: "2014086",
    employeeName: "한동혁",
    role: "user"
  },
  {
    employeeId: "2014073",
    employeeName: "조용환",
    role: "leader"
  },
  {
    employeeId: "2014083",
    employeeName: "김현상",
    role: "user"
  },
  {
    employeeId: "2014062",
    employeeName: "최혜민",
    role: "user"
  },
  {
    employeeId: "2014074",
    employeeName: "김광표",
    role: "leader"
  },
  {
    employeeId: "2014076",
    employeeName: "한만석",
    role: "leader"
  },
  {
    employeeId: "2014055",
    employeeName: "남정현",
    role: "leader"
  },
  {
    employeeId: "2014087",
    employeeName: "하태곤",
    role: "user"
  },
  {
    employeeId: "2014081",
    employeeName: "이휘근",
    role: "user"
  },
  {
    employeeId: "2014082",
    employeeName: "권훈",
    role: "user"
  },
  {
    employeeId: "2014060",
    employeeName: "박일남",
    role: "user"
  },
  {
    employeeId: "2014070",
    employeeName: "김형준",
    role: "user"
  },
  {
    employeeId: "2014056",
    employeeName: "박문수",
    role: "user"
  },
  {
    employeeId: "2004007",
    employeeName: "박수원",
    role: "user"
  },
  {
    employeeId: "2014102",
    employeeName: "고석훈",
    role: "user"
  },
  {
    employeeId: "2014072",
    employeeName: "이규현",
    role: "user"
  },
  {
    employeeId: "2014095",
    employeeName: "서동인",
    role: "user"
  },
  {
    employeeId: "2025003",
    employeeName: "김덕용",
    role: "user"
  },
  {
    employeeId: "2025005",
    employeeName: "박태준",
    role: "user"
  },
  {
    employeeId: "2025006",
    employeeName: "차병석",
    role: "user"
  },
  {
    employeeId: "2026004",
    employeeName: "전민정",
    role: "user"
  },
  {
    employeeId: "2022011",
    employeeName: "최수민",
    role: "user"
  },
  {
    employeeId: "2022008",
    employeeName: "이용수",
    role: "user"
  },
  {
    employeeId: "2024004",
    employeeName: "최연호",
    role: "user"
  },
  {
    employeeId: "2025004",
    employeeName: "박건",
    role: "user"
  },
  {
    employeeId: "2022009",
    employeeName: "변정률",
    role: "user"
  },
  {
    employeeId: "2023008",
    employeeName: "곽기영",
    role: "user"
  },
  {
    employeeId: "2023007",
    employeeName: "방덕윤",
    role: "user"
  }
];


/* =========================================================
  JSON 응답 생성
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
  Uint8Array → Base64
========================================================= */

function bytesToBase64(
  bytes
) {
  let binaryText = "";

  bytes.forEach(
    (byte) => {
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
  안전한 랜덤 Salt 생성
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
  문자열 → ArrayBuffer
========================================================= */

function encodeText(
  value
) {
  return new TextEncoder()
    .encode(
      String(
        value || ""
      )
    );
}


/* =========================================================
  PBKDF2 비밀번호 해시

  초기 비밀번호:
  사번과 동일

  저장:
  - password_hash
  - password_salt
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
  요청 인증 확인
========================================================= */

function verifySeedSecret(
  request,
  env
) {
  const savedSecret =
    String(
      env.SEED_SECRET ||
      ""
    ).trim();

  const requestSecret =
    String(
      request.headers.get(
        "x-seed-secret"
      ) ||
      ""
    ).trim();

  if (!savedSecret) {
    return {
      success: false,

      message:
        "Cloudflare 환경변수 SEED_SECRET이 등록되지 않았습니다."
    };
  }

  if (
    !requestSecret ||
    requestSecret !==
      savedSecret
  ) {
    return {
      success: false,

      message:
        "직원 초기 등록 권한이 없습니다."
    };
  }

  return {
    success: true
  };
}


/* =========================================================
  DB 바인딩 확인
========================================================= */

function validateDatabase(
  env
) {
  if (!env.DB) {
    throw new Error(
      "D1 바인딩 DB가 등록되지 않았습니다."
    );
  }
}


/* =========================================================
  직원 1명 등록 또는 업데이트
========================================================= */

async function upsertEmployee(
  db,
  employee
) {
  const employeeId =
    String(
      employee.employeeId ||
      ""
    ).trim();

  const employeeName =
    String(
      employee.employeeName ||
      ""
    ).trim();

  const role =
    employee.role ===
    "leader"
      ? "leader"
      : "user";

  if (
    !employeeId ||
    !employeeName
  ) {
    throw new Error(
      "직원 사번 또는 이름이 비어 있습니다."
    );
  }

  await db
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

        ON CONFLICT (
          employee_id
        )
        DO UPDATE SET
          employee_name =
            excluded.employee_name,

          role =
            excluded.role,

          is_active =
            1,

          updated_at =
            CURRENT_TIMESTAMP
      `
    )
    .bind(
      employeeId,
      employeeName,
      role
    )
    .run();

  return {
    employeeId,
    employeeName,
    role
  };
}


/* =========================================================
  초기 로그인 계정 생성

  기존 계정이 이미 있으면
  비밀번호는 변경하지 않는다.
========================================================= */

async function createInitialUser(
  db,
  employeeId
) {
  const existingUser =
    await db
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
        false,

      employeeId
    };
  }

  const passwordSalt =
    createPasswordSalt();

  const passwordHash =
    await hashPassword(
      employeeId,
      passwordSalt
    );

  await db
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
      true,

    employeeId
  };
}


/* =========================================================
  직원 명단 전체 등록
========================================================= */

async function seedEmployees(
  db
) {
  const registeredEmployees =
    [];

  const createdUsers =
    [];

  const existingUsers =
    [];

  for (
    const employee of
    EMPLOYEE_SEED_DATA
  ) {
    const registeredEmployee =
      await upsertEmployee(
        db,
        employee
      );

    registeredEmployees.push(
      registeredEmployee
    );

    const userResult =
      await createInitialUser(
        db,
        employee.employeeId
      );

    if (
      userResult.created
    ) {
      createdUsers.push(
        userResult.employeeId
      );
    } else {
      existingUsers.push(
        userResult.employeeId
      );
    }
  }

  return {
    registeredEmployees,
    createdUsers,
    existingUsers
  };
}


/* =========================================================
  POST /api/employees-seed
========================================================= */

export async function onRequestPost(
  context
) {
  try {
    validateDatabase(
      context.env
    );

    const secretResult =
      verifySeedSecret(
        context.request,
        context.env
      );

    if (
      !secretResult.success
    ) {
      return createJsonResponse(
        {
          success: false,

          message:
            secretResult.message
        },
        403
      );
    }

    const seedResult =
      await seedEmployees(
        context.env.DB
      );

    const leaderEmployees =
      seedResult
        .registeredEmployees
        .filter(
          (employee) => {
            return (
              employee.role ===
              "leader"
            );
          }
        );

    return createJsonResponse(
      {
        success: true,

        message:
          "직원 계정 초기 등록이 완료되었습니다.",

        totalEmployeeCount:
          seedResult
            .registeredEmployees
            .length,

        newUserCount:
          seedResult
            .createdUsers
            .length,

        existingUserCount:
          seedResult
            .existingUsers
            .length,

        leaderCount:
          leaderEmployees.length,

        leaders:
          leaderEmployees.map(
            (employee) => {
              return {
                employeeId:
                  employee.employeeId,

                employeeName:
                  employee.employeeName
              };
            }
          ),

        initialPasswordNotice:
          "신규 계정의 초기 비밀번호는 사번과 동일합니다."
      }
    );

  } catch (error) {
    console.error(
      "Employee seed error:",
      error
    );

    return createJsonResponse(
      {
        success: false,

        message:
          "직원 계정 초기 등록 중 오류가 발생했습니다.",

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
  허용하지 않는 요청 방식
========================================================= */

export function onRequestGet() {
  return createJsonResponse(
    {
      success: false,

      message:
        "이 주소는 POST 요청만 지원합니다."
    },
    405
  );
}