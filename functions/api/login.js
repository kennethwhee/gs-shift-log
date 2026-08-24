/* =========================================================
  GS Shift Log 로그인 API

  POST   /api/login
  DELETE /api/login

  기능
  - 사번 및 비밀번호 확인
  - PBKDF2 비밀번호 검증
  - 비활성 계정 차단
  - D1 업무일지용 로그인 세션 발급
  - 로그아웃 시 현재 세션 삭제
========================================================= */


/* =========================================================
  공통 설정
========================================================= */

const MAX_PASSWORD_LENGTH =
  100;


const SESSION_DURATION_MS =
  24 * 60 * 60 * 1000;


const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


/* =========================================================
  공통 JSON 응답
========================================================= */

function jsonResponse(
  data,
  status = 200
) {
  return Response.json(
    data,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store"
      }
    }
  );
}


/* =========================================================
  응답을 막지 않는 유지보수 작업

  세션 만료 판정은 expires_at으로 끝난다. 만료 행 정리와
  last_used_at 기록은 인증 결과를 바꾸지 않으므로 모바일
  로그인/세션 확인 응답의 critical path에서 제외한다.
========================================================= */

function runSessionMaintenance(
  context,
  task,
  label
) {
  const guardedTask =
    Promise.resolve(
      task
    ).catch(
      error => {
        console.warn(
          `${label} 실패:`,
          error
        );
      }
    );


  if (
    typeof context.waitUntil ===
      "function"
  ) {
    context.waitUntil(
      guardedTask
    );
  }
}


/* =========================================================
  사번 정리
========================================================= */

function normalizeEmployeeNo(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .replace(
      /\s+/g,
      ""
    );
}


/* =========================================================
  권한 정리
========================================================= */

function normalizeRole(
  value,
  employeeNo = ""
) {
  /*
    고정 최고관리자 계정
  */
  if (
    normalizeEmployeeNo(
      employeeNo
    ) ===
      FORCED_SUPER_ADMIN_EMPLOYEE_NO
  ) {
    return "super_admin";
  }


  const role =
    String(
      value ||
      ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );


  /*
    최고관리자
  */
  if (
    [
      "super_admin",
      "superadmin",
      "최고관리자"
    ].includes(
      role
    )
  ) {
    return "super_admin";
  }


  /*
    팀장
  */
  if (
    [
      "team_manager",
      "teammanager",
      "팀장"
    ].includes(
      role
    )
  ) {
    return "team_manager";
  }


  /*
    파트장
  */
  if (
    [
      "admin",
      "leader",
      "파트장"
    ].includes(
      role
    )
  ) {
    return "admin";
  }


  return "user";
}


/* =========================================================
  로그인 최종 권한 결정

  우선순위:
  1. 최고관리자
  2. 팀장
  3. 파트장
  4. 일반

  users.role:
  - 기존 로그인 계정 권한

  employees.default_role:
  - 직원관리에서 선택한 실제 권한
========================================================= */

function resolveLoginRole(
  user
) {
  const source =
    user &&
    typeof user ===
      "object"
      ? user
      : {};


  const employeeNo =
    normalizeEmployeeNo(
      source.employee_no ||
      source.employeeNo
    );


  /*
    users 테이블에 저장된 계정 권한
  */
  const accountRole =
    normalizeRole(
      source.role,
      employeeNo
    );


  /*
    employees 테이블에 저장된 직원 권한
  */
  const employeeRole =
    normalizeRole(
      source.default_role ??
      source.defaultRole,
      employeeNo
    );


  /*
    최고관리자는 항상 가장 높은 우선순위
  */
  if (
    accountRole ===
      "super_admin" ||
    employeeRole ===
      "super_admin"
  ) {
    return "super_admin";
  }


  /*
    직원관리에서 팀장으로 지정된 경우
  */
  if (
    accountRole ===
      "team_manager" ||
    employeeRole ===
      "team_manager"
  ) {
    return "team_manager";
  }


  /*
    파트장 계정
  */
  if (
    accountRole ===
      "admin" ||
    employeeRole ===
      "admin"
  ) {
    return "admin";
  }


  return "user";
}


function getAdminLevel(
  role
) {
  if (
    role ===
      "super_admin"
  ) {
    return 2;
  }


  if (
    role ===
      "admin"
  ) {
    return 1;
  }


  /*
    팀장은 시스템 관리자가 아니다.

    업무일지 결재 권한은
    shift-logs.js에서 별도로 부여한다.
  */
  return 0;
}


/* =========================================================
  Base64 변환
========================================================= */

function base64ToBytes(
  base64
) {
  try {
    const binary =
      atob(
        String(
          base64 ||
          ""
        )
      );


    const bytes =
      new Uint8Array(
        binary.length
      );


    for (
      let index = 0;
      index <
        binary.length;
      index += 1
    ) {
      bytes[index] =
        binary.charCodeAt(
          index
        );
    }


    return bytes;

  } catch (
    error
  ) {
    console.error(
      "Base64 변환 오류:",
      error
    );


    return null;
  }
}


function bytesToBase64Url(
  bytes
) {
  let binary =
    "";


  for (
    const byte of
    bytes
  ) {
    binary +=
      String.fromCharCode(
        byte
      );
  }


  return btoa(
    binary
  )
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}


/* =========================================================
  안전한 바이트 비교
========================================================= */

function timingSafeEqual(
  first,
  second
) {
  if (
    !(
      first instanceof
        Uint8Array
    ) ||
    !(
      second instanceof
        Uint8Array
    )
  ) {
    return false;
  }


  if (
    first.length !==
      second.length
  ) {
    return false;
  }


  let difference =
    0;


  for (
    let index = 0;
    index <
      first.length;
    index += 1
  ) {
    difference |=
      first[index] ^
      second[index];
  }


  return (
    difference ===
    0
  );
}


/* =========================================================
  PBKDF2 비밀번호 검증

  저장 형식:
  pbkdf2$반복횟수$salt$passwordHash
========================================================= */

async function verifyPassword(
  password,
  storedPasswordHash
) {
  try {
    const hashParts =
      String(
        storedPasswordHash ||
        ""
      ).split(
        "$"
      );


    if (
      hashParts.length !==
        4
    ) {
      console.error(
        "저장된 비밀번호 형식이 올바르지 않습니다."
      );


      return false;
    }


    const [
      algorithm,
      iterationsText,
      saltBase64,
      passwordHashBase64
    ] =
      hashParts;


    if (
      algorithm !==
        "pbkdf2"
    ) {
      console.error(
        "지원하지 않는 비밀번호 알고리즘입니다."
      );


      return false;
    }


    const iterations =
      Number(
        iterationsText
      );


    if (
      !Number.isInteger(
        iterations
      ) ||
      iterations <
        100000 ||
      iterations >
        1000000
    ) {
      console.error(
        "PBKDF2 반복 횟수가 올바르지 않습니다."
      );


      return false;
    }


    const salt =
      base64ToBytes(
        saltBase64
      );


    const storedHash =
      base64ToBytes(
        passwordHashBase64
      );


    if (
      !salt ||
      !storedHash ||
      salt.length ===
        0 ||
      storedHash.length ===
        0
    ) {
      return false;
    }


    const encoder =
      new TextEncoder();


    const passwordKey =
      await crypto.subtle
        .importKey(
          "raw",
          encoder.encode(
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
      await crypto.subtle
        .deriveBits(
          {
            name:
              "PBKDF2",

            salt,

            iterations,

            hash:
              "SHA-256"
          },
          passwordKey,
          storedHash.length *
            8
        );


    const calculatedHash =
      new Uint8Array(
        derivedBits
      );


    return timingSafeEqual(
      calculatedHash,
      storedHash
    );

  } catch (
    error
  ) {
    console.error(
      "비밀번호 검증 오류:",
      error
    );


    return false;
  }
}


/* =========================================================
  로그인 세션 토큰 생성 및 해시
========================================================= */

function createSessionToken() {
  const tokenBytes =
    new Uint8Array(
      32
    );


  crypto.getRandomValues(
    tokenBytes
  );


  return bytesToBase64Url(
    tokenBytes
  );
}


async function hashSessionToken(
  sessionToken
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder()
        .encode(
          String(
            sessionToken ||
            ""
          )
        )
    );


  return Array.from(
    new Uint8Array(
      digest
    )
  )
    .map(
      byte =>
        byte
          .toString(
            16
          )
          .padStart(
            2,
            "0"
          )
    )
    .join(
      ""
    );
}


/* =========================================================
  Authorization Bearer 토큰 읽기
========================================================= */

function getBearerToken(
  request
) {
  const authorization =
    String(
      request.headers.get(
        "Authorization"
      ) ||
      ""
    ).trim();


  const matched =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );


  return String(
    matched?.[1] ||
    ""
  ).trim();
}


/* =========================================================
  POST /api/login
========================================================= */

export async function onRequestPost(
  context
) {
  try {
    let body;


    try {
      body =
        await context.request
          .json();

    } catch {
      return jsonResponse(
        {
          ok: false,

          message:
            "로그인 요청 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const employeeNo =
      normalizeEmployeeNo(
        body.employeeNo
      );


    const password =
      String(
        body.password ||
        ""
      );


    if (
      !employeeNo ||
      !password
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "사번과 비밀번호를 입력해주세요."
        },
        400
      );
    }


    if (
      !/^\d{6,10}$/.test(
        employeeNo
      )
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "사번 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }


    if (
      password.length <
        4 ||
      password.length >
        MAX_PASSWORD_LENGTH
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "사번 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }

/* =========================
  로그인 계정 + 직원 권한·보직 조회

  users:
  - 로그인 계정
  - 기존 계정 권한

  employees:
  - 팀장 포함 실제 권한 default_role
  - 실제 보직 position
========================= */

const user =
  await context.env.DB
    .prepare(`
      SELECT
        account.id,
        account.employee_no,
        account.name,
        account.password_hash,
        account.role,
        account.is_active,
        account.approved_at,
        account.approved_by,
        account.last_login_at,
        account.created_at,

        COALESCE(
          employee.default_role,
          ''
        ) AS default_role,

        COALESCE(
          employee.position,
          ''
        ) AS position

      FROM users AS account

      LEFT JOIN employees AS employee
        ON employee.employee_no =
           account.employee_no

      WHERE account.employee_no = ?

      LIMIT 1
    `)
    .bind(
      employeeNo
    )
    .first();




    if (
      !user
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "사번 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }


    if (
      Number(
        user.is_active
      ) !==
        1
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "현재 사용이 중지된 계정입니다. 관리자에게 문의해주세요."
        },
        403
      );
    }


    const passwordMatched =
      await verifyPassword(
        password,
        user.password_hash
      );


    if (
      !passwordMatched
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "사번 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }


    /*
      users.role과 employees.default_role을 함께 확인하여
      실제 로그인 권한을 결정한다.
    */
    const role =
      resolveLoginRole(
        user
      );


    /*
      직원 명단에 저장된 원래 권한
    */
    const employeeDefaultRole =
      normalizeRole(
        user.default_role,
        user.employee_no
      );


    /*
      기존 관리자 단계와 호환
    */
    const adminLevel =
      getAdminLevel(
        role
      );


    /*
      팀장 전용 판정값
    */
    const isTeamManager =
      role ===
        "team_manager";


    const sessionToken =
      createSessionToken();


    const tokenHash =
      await hashSessionToken(
        sessionToken
      );


    const currentTime =
      new Date();


    const currentTimeText =
      currentTime
        .toISOString();


    const expiresAt =
      new Date(
        currentTime.getTime() +
        SESSION_DURATION_MS
      ).toISOString();


    /*
      실제 토큰 원문은 브라우저에만 전달하고
      D1에는 SHA-256 해시만 저장한다.
    */
    await context.env.DB
      .prepare(`
        INSERT INTO shift_log_sessions (
          token_hash,
          employee_no,
          expires_at,
          created_at,
          last_used_at
        )
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(
        tokenHash,
        user.employee_no,
        expiresAt,
        currentTimeText,
        currentTimeText
      )
      .run();


    await context.env.DB
      .prepare(`
        UPDATE users
        SET last_login_at = ?
        WHERE id = ?
      `)
      .bind(
        currentTimeText,
        user.id
      )
      .run();


    /*
      만료 세션 정리는 새 세션 발급 성공 여부와 무관하다.
      전체 expires_at 범위 DELETE가 로그인 응답을 지연시키지
      않도록 필수 로그인 쓰기가 끝난 뒤 백그라운드에서 수행한다.
    */
    runSessionMaintenance(
      context,
      context.env.DB
        .prepare(`
          DELETE FROM shift_log_sessions
          WHERE expires_at <= ?
        `)
        .bind(
          currentTimeText
        )
        .run(),
      "만료 로그인 세션 정리"
    );


/* =========================
  프런트에 전달할 로그인 사용자

  role:
  - user
  - admin
  - team_manager
  - super_admin

  position:
  - 실제 근무 보직
========================= */

const position =
  String(
    user.position ||
    ""
  ).trim();


const responseUser = {
  id:
    Number(
      user.id
    ),

  employeeNo:
    String(
      user.employee_no ||
      ""
    ).trim(),

  employee_no:
    String(
      user.employee_no ||
      ""
    ).trim(),

  name:
    String(
      user.name ||
      ""
    ).trim(),

  /*
    실제 로그인 권한
  */
  role,

  /*
    직원 명단에 저장된 원래 권한
  */
  defaultRole:
    employeeDefaultRole,

  default_role:
    employeeDefaultRole,

  /*
    실제 근무 보직
  */
  position,

  /*
    기존 JavaScript와의 호환용 보직 필드
  */
  jobPosition:
    position,

  job_position:
    position,

  /*
    기존 관리자 단계

    최고관리자: 2
    파트장:     1
    팀장:       0
    일반:       0
  */
  adminLevel,

  /*
    파트장 또는 최고관리자 여부

    팀장은 직원·브랜드 관리자가 아니므로
    false로 유지한다.
  */
  isAdmin:
    role ===
      "admin" ||
    role ===
      "super_admin",

  /*
    팀장 전용 판정값
  */
  isTeamManager,

  is_team_manager:
    isTeamManager,

  /*
    최고관리자 전용 판정값
  */
  isSuperAdmin:
    role ===
      "super_admin",

  lastLoginAt:
    currentTimeText,

  sessionToken,

  sessionExpiresAt:
    expiresAt
};

    return jsonResponse({
      ok: true,

      message:
        `${user.name}님, 로그인되었습니다.`,

      /*
        최신 script.js는 result.user를 저장하므로
        세션 토큰을 user 안에 반드시 포함한다.
      */
      user:
        responseUser,

      /*
        API 직접 확인과 향후 호환성을 위해
        최상위에도 같은 토큰을 제공한다.
      */
      sessionToken,

      expiresAt
    });

  } catch (
    error
  ) {
    console.error(
      "로그인 처리 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          "로그인 처리 중 오류가 발생했습니다."
      },
      500
    );
  }
}


/* =========================================================
  DELETE /api/login

  현재 브라우저에서 사용한 세션만 삭제한다.
========================================================= */

export async function onRequestDelete(
  context
) {
  try {
    const sessionToken =
      getBearerToken(
        context.request
      );


    if (
      sessionToken
    ) {
      const tokenHash =
        await hashSessionToken(
          sessionToken
        );


      await context.env.DB
        .prepare(`
          DELETE FROM shift_log_sessions
          WHERE token_hash = ?
        `)
        .bind(
          tokenHash
        )
        .run();
    }


    return jsonResponse({
      ok: true,

      message:
        "로그아웃되었습니다."
    });

  } catch (
    error
  ) {
    console.error(
      "로그아웃 처리 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          "로그아웃 처리 중 오류가 발생했습니다."
      },
      500
    );
  }
}

/* =========================================================
  GET /api/login

  현재 Bearer 세션 유효성 확인
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    if (
      !context.env.DB
    ) {
      return jsonResponse(
        {
          ok: false,
          authenticated: false,
          message:
            "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      );
    }

    const sessionToken =
      getBearerToken(
        context.request
      );

    if (!sessionToken) {
      return jsonResponse(
        {
          ok: false,
          authenticated: false,
          message:
            "로그인이 필요합니다."
        },
        401
      );
    }

    const tokenHash =
      await hashSessionToken(
        sessionToken
      );

    const session =
      await context.env.DB
        .prepare(`
          SELECT
            session.employee_no,
            session.expires_at,
            user.name,
            user.role,
            user.is_active,
            COALESCE(
              employee.default_role,
              ''
            ) AS default_role,
            COALESCE(
              employee.position,
              ''
            ) AS position
          FROM shift_log_sessions AS session
          INNER JOIN users AS user
            ON user.employee_no =
               session.employee_no
          LEFT JOIN employees AS employee
            ON employee.employee_no =
               session.employee_no
          WHERE session.token_hash = ?
          LIMIT 1
        `)
        .bind(
          tokenHash
        )
        .first();

    const now =
      new Date();

    const expiresAt =
      new Date(
        session?.expires_at ||
        0
      );

    if (
      !session ||
      Number(
        session.is_active
      ) !==
        1 ||
      Number.isNaN(
        expiresAt.getTime()
      ) ||
      expiresAt <=
        now
    ) {
      runSessionMaintenance(
        context,
        context.env.DB
          .prepare(`
            DELETE FROM shift_log_sessions
            WHERE token_hash = ?
          `)
          .bind(
            tokenHash
          )
          .run(),
        "만료 로그인 세션 삭제"
      );

      return jsonResponse(
        {
          ok: false,
          authenticated: false,
          message:
            "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
        },
        401
      );
    }

    const role =
      resolveLoginRole({
        employee_no:
          session.employee_no,
        role:
          session.role,
        default_role:
          session.default_role
      });

    const position =
      String(
        session.position ||
        ""
      ).trim();

    runSessionMaintenance(
      context,
      context.env.DB
        .prepare(`
          UPDATE shift_log_sessions
          SET last_used_at = ?
          WHERE token_hash = ?
        `)
        .bind(
          now.toISOString(),
          tokenHash
        )
        .run(),
      "로그인 세션 사용시각 기록"
    );

    return jsonResponse({
      ok: true,
      authenticated: true,
      expiresAt:
        session.expires_at,
      user: {
        employeeNo:
          String(
            session.employee_no ||
            ""
          ).trim(),
        employee_no:
          String(
            session.employee_no ||
            ""
          ).trim(),
        name:
          String(
            session.name ||
            ""
          ).trim(),
        role,
        defaultRole:
          normalizeRole(
            session.default_role,
            session.employee_no
          ),
        default_role:
          normalizeRole(
            session.default_role,
            session.employee_no
          ),
        position,
        jobPosition:
          position,
        job_position:
          position,
        adminLevel:
          getAdminLevel(
            role
          ),
        isAdmin:
          role ===
            "admin" ||
          role ===
            "super_admin",
        isTeamManager:
          role ===
            "team_manager",
        is_team_manager:
          role ===
            "team_manager",
        isSuperAdmin:
          role ===
            "super_admin"
      }
    });

  } catch (
    error
  ) {
    console.error(
      "로그인 세션 확인 오류:",
      error
    );

    return jsonResponse(
      {
        ok: false,
        authenticated: false,
        message:
          "로그인 세션을 확인하지 못했습니다."
      },
      500
    );
  }
}
