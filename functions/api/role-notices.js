/* =========================================================
  GS Shift Log 보직별 공지사항 API

  GET    /api/role-notices
  POST   /api/role-notices
  PUT    /api/role-notices
  DELETE /api/role-notices?id=...

  권한
  - 조회: 로그인 사용자 전체
  - 등록/수정/삭제:
    · 최고관리자
    · 파트장 계정(admin)
    · 해당 보직 사용자

  대상 보직
  - TGO
  - BCO1
  - BCO2
  - TO
  - BO1
  - BO2
========================================================= */


/* =========================================================
  공통 설정
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const VALID_NOTICE_ROLES =
  new Set([
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ]);


const MAX_TITLE_LENGTH =
  80;


const MAX_CONTENT_LENGTH =
  2000;


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
  기본 문자열 정리
========================================================= */

function normalizeText(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function normalizeEmployeeNo(
  value
) {
  return normalizeText(
    value
  ).replace(
    /\s+/g,
    ""
  );
}


/* =========================================================
  계정 권한 정리
========================================================= */

function normalizeAccountRole(
  value
) {
  const role =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );


  if (
    role ===
      "super_admin" ||
    role ===
      "superadmin"
  ) {
    return "super_admin";
  }


  if (
    role ===
      "admin" ||
    role ===
      "leader"
  ) {
    return "admin";
  }


  return "user";
}


/* =========================================================
  보직 정리
========================================================= */

function normalizeNoticeRole(
  value
) {
  const role =
    normalizeText(
      value
    )
      .replace(
        /\s+/g,
        ""
      )
      .toUpperCase();


  return VALID_NOTICE_ROLES.has(
    role
  )
    ? role
    : "";
}


/* =========================================================
  중요 공지 값 정리
========================================================= */

function normalizeImportantValue(
  value
) {
  return (
    value ===
      true ||
    Number(
      value
    ) ===
      1
  )
    ? 1
    : 0;
}


/* =========================================================
  YYYY-MM-DD 날짜 검증
========================================================= */

function isValidIsoDate(
  value
) {
  const date =
    normalizeText(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date
    )
  ) {
    return false;
  }


  const parsedDate =
    new Date(
      `${date}T00:00:00.000Z`
    );


  return (
    !Number.isNaN(
      parsedDate.getTime()
    ) &&
    parsedDate
      .toISOString()
      .slice(
        0,
        10
      ) ===
      date
  );
}


/* =========================================================
  Authorization Bearer 토큰 읽기
========================================================= */

function getBearerToken(
  request
) {
  const authorization =
    normalizeText(
      request.headers.get(
        "Authorization"
      )
    );


  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );


  return normalizeText(
    match?.[1]
  );
}


/* =========================================================
  바이트 → 16진수
========================================================= */

function bytesToHex(
  bytes
) {
  return [
    ...bytes
  ]
    .map(
      byte => {
        return byte
          .toString(
            16
          )
          .padStart(
            2,
            "0"
          );
      }
    )
    .join("");
}


/* =========================================================
  세션 토큰 SHA-256 해시
========================================================= */

async function hashSessionToken(
  token
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        token
      )
    );


  return bytesToHex(
    new Uint8Array(
      digest
    )
  );
}


/* =========================================================
  로그인 사용자 확인

  users:
  - 계정 권한

  employees:
  - 실제 보직(position)

  employees 연결이 누락된 계정도
  관리자 권한으로는 공지 관리가 가능하다.
========================================================= */

async function getAuthenticatedUser(
  context
) {
  if (
    !context.env.DB
  ) {
    return {
      error:
        jsonResponse(
          {
            ok: false,

            message:
              "D1 바인딩 DB가 등록되지 않았습니다."
          },
          500
        )
    };
  }


  const token =
    getBearerToken(
      context.request
    );


  if (
    !token
  ) {
    return {
      error:
        jsonResponse(
          {
            ok: false,

            message:
              "로그인이 필요합니다."
          },
          401
        )
    };
  }


  const tokenHash =
    await hashSessionToken(
      token
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

          employee.position

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
    await context.env.DB
      .prepare(`
        DELETE FROM shift_log_sessions
        WHERE token_hash = ?
      `)
      .bind(
        tokenHash
      )
      .run();


    return {
      error:
        jsonResponse(
          {
            ok: false,

            message:
              "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
          },
          401
        )
    };
  }


  const employeeNo =
    normalizeEmployeeNo(
      session.employee_no
    );


  const role =
    employeeNo ===
      FORCED_SUPER_ADMIN_EMPLOYEE_NO
      ? "super_admin"
      : normalizeAccountRole(
          session.role
        );


  const position =
    normalizeNoticeRole(
      session.position
    );


  await context.env.DB
    .prepare(`
      UPDATE shift_log_sessions
      SET last_used_at = ?
      WHERE token_hash = ?
    `)
    .bind(
      now.toISOString(),
      tokenHash
    )
    .run();


  return {
    user: {
      employeeNo,

      name:
        normalizeText(
          session.name
        ),

      role,

      position,

      isAdmin:
        role ===
          "admin" ||
        role ===
          "super_admin",

      isSuperAdmin:
        role ===
          "super_admin"
    }
  };
}


/* =========================================================
  공지 관리 권한

  허용:
  - 최고관리자
  - 파트장 계정(admin)
  - 공지 대상과 동일한 보직 사용자
========================================================= */

function canManageRoleNotice(
  user,
  noticeRole
) {
  const role =
    normalizeNoticeRole(
      noticeRole
    );


  if (
    !user ||
    !role
  ) {
    return false;
  }


  if (
    user.isSuperAdmin ||
    user.role ===
      "admin"
  ) {
    return true;
  }


  return (
    normalizeNoticeRole(
      user.position
    ) ===
    role
  );
}


/* =========================================================
  DB 행 → 프런트엔드 공지 객체
========================================================= */

function convertRowToNotice(
  row
) {
  return {
    id:
      normalizeText(
        row.id
      ),

    role:
      normalizeNoticeRole(
        row.role
      ),

    title:
      normalizeText(
        row.title
      ),

    content:
      String(
        row.content ??
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
        .trim(),

    startDate:
      normalizeText(
        row.start_date
      ),

    endDate:
      normalizeText(
        row.end_date
      ),

    isImportant:
      Number(
        row.is_important
      ) ===
      1,

    createdBy:
      normalizeEmployeeNo(
        row.created_by
      ),

    createdByName:
      normalizeText(
        row.created_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      )
  };
}


/* =========================================================
  ID로 공지 조회
========================================================= */

async function findNoticeById(
  database,
  id
) {
  const row =
    await database
      .prepare(`
        SELECT
          id,
          role,
          title,
          content,
          start_date,
          end_date,
          is_important,
          created_by,
          created_by_name,
          created_at,
          updated_at

        FROM role_notices

        WHERE id = ?

        LIMIT 1
      `)
      .bind(
        id
      )
      .first();


  return row
    ? convertRowToNotice(
        row
      )
    : null;
}


/* =========================================================
  공지 입력값 검증
========================================================= */

function validateNoticeInput(
  body
) {
  if (
    !body ||
    typeof body !==
      "object" ||
    Array.isArray(
      body
    )
  ) {
    return {
      error:
        "공지사항 요청 형식이 올바르지 않습니다."
    };
  }


  const notice = {
    id:
      normalizeText(
        body.id
      ),

    role:
      normalizeNoticeRole(
        body.role
      ),

    title:
      normalizeText(
        body.title
      ),

    content:
      String(
        body.content ??
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
        .trim(),

    startDate:
      normalizeText(
        body.startDate ??
        body.start_date
      ),

    endDate:
      normalizeText(
        body.endDate ??
        body.end_date
      ),

    isImportant:
      normalizeImportantValue(
        body.isImportant ??
        body.is_important
      )
  };


  if (
    !notice.role
  ) {
    return {
      error:
        "공지 대상 보직이 올바르지 않습니다."
    };
  }


  if (
    !notice.title
  ) {
    return {
      error:
        "공지 제목을 입력해 주세요."
    };
  }


  if (
    notice.title.length >
      MAX_TITLE_LENGTH
  ) {
    return {
      error:
        `공지 제목은 최대 ${MAX_TITLE_LENGTH}자까지 입력할 수 있습니다.`
    };
  }


  if (
    !notice.content
  ) {
    return {
      error:
        "공지 내용을 입력해 주세요."
    };
  }


  if (
    notice.content.length >
      MAX_CONTENT_LENGTH
  ) {
    return {
      error:
        `공지 내용은 최대 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있습니다.`
    };
  }


  if (
    !isValidIsoDate(
      notice.startDate
    ) ||
    !isValidIsoDate(
      notice.endDate
    )
  ) {
    return {
      error:
        "공지 시작일과 종료일을 확인해 주세요."
    };
  }


  if (
    notice.endDate <
      notice.startDate
  ) {
    return {
      error:
        "종료일은 시작일보다 빠를 수 없습니다."
    };
  }


  return {
    notice
  };
}


/* =========================================================
  GET /api/role-notices

  선택 필터:
  - role=TGO
  - status=active | upcoming | expired | all

  status를 생략하면 전체 공지를 반환한다.
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    const authentication =
      await getAuthenticatedUser(
        context
      );


    if (
      authentication.error
    ) {
      return authentication.error;
    }


    const requestUrl =
      new URL(
        context.request.url
      );


    const role =
      normalizeNoticeRole(
        requestUrl.searchParams.get(
          "role"
        )
      );


    const rawRole =
      normalizeText(
        requestUrl.searchParams.get(
          "role"
        )
      );


    if (
      rawRole &&
      !role
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "조회할 보직이 올바르지 않습니다."
        },
        400
      );
    }


    const status =
      normalizeText(
        requestUrl.searchParams.get(
          "status"
        )
      ).toLowerCase();


    if (
      status &&
      ![
        "active",
        "upcoming",
        "expired",
        "all"
      ].includes(
        status
      )
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "공지 상태 필터가 올바르지 않습니다."
        },
        400
      );
    }


    const today =
      new Date()
        .toISOString()
        .slice(
          0,
          10
        );


    let queryText = `
      SELECT
        id,
        role,
        title,
        content,
        start_date,
        end_date,
        is_important,
        created_by,
        created_by_name,
        created_at,
        updated_at

      FROM role_notices

      WHERE 1 = 1
    `;


    const bindValues = [];


    if (
      role
    ) {
      queryText += `
        AND role = ?
      `;

      bindValues.push(
        role
      );
    }


    if (
      status ===
        "active"
    ) {
      queryText += `
        AND start_date <= ?
        AND end_date >= ?
      `;

      bindValues.push(
        today,
        today
      );

    } else if (
      status ===
        "upcoming"
    ) {
      queryText += `
        AND start_date > ?
      `;

      bindValues.push(
        today
      );

    } else if (
      status ===
        "expired"
    ) {
      queryText += `
        AND end_date < ?
      `;

      bindValues.push(
        today
      );
    }


    queryText += `
      ORDER BY
        is_important DESC,
        CASE
          WHEN start_date <= ? AND end_date >= ?
            THEN 1
          WHEN start_date > ?
            THEN 2
          ELSE 3
        END,
        updated_at DESC,
        created_at DESC
    `;


    bindValues.push(
      today,
      today,
      today
    );


    const queryResult =
      await context.env.DB
        .prepare(
          queryText
        )
        .bind(
          ...bindValues
        )
        .all();


    const notices =
      (
        Array.isArray(
          queryResult.results
        )
          ? queryResult.results
          : []
      )
        .map(
          convertRowToNotice
        )
        .filter(
          notice =>
            Boolean(
              notice.role
            )
        );


    return jsonResponse({
      ok: true,

      notices,

      totalCount:
        notices.length,

      today
    });

  } catch (
    error
  ) {
    console.error(
      "보직별 공지사항 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          "보직별 공지사항을 불러오는 중 오류가 발생했습니다.",

        error:
          String(
            error
          )
      },
      500
    );
  }
}


/* =========================================================
  POST /api/role-notices

  새 공지 등록
========================================================= */

export async function onRequestPost(
  context
) {
  try {
    const authentication =
      await getAuthenticatedUser(
        context
      );


    if (
      authentication.error
    ) {
      return authentication.error;
    }


    const user =
      authentication.user;


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
            "공지사항 요청 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const validation =
      validateNoticeInput(
        body
      );


    if (
      validation.error
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            validation.error
        },
        400
      );
    }


    const notice =
      validation.notice;


    if (
      !canManageRoleNotice(
        user,
        notice.role
      )
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "해당 보직 공지를 등록할 권한이 없습니다."
        },
        403
      );
    }


    const id =
      crypto.randomUUID();


    const now =
      new Date()
        .toISOString();


    await context.env.DB
      .prepare(`
        INSERT INTO role_notices (
          id,
          role,
          title,
          content,
          start_date,
          end_date,
          is_important,
          created_by,
          created_by_name,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)
      .bind(
        id,
        notice.role,
        notice.title,
        notice.content,
        notice.startDate,
        notice.endDate,
        notice.isImportant,
        user.employeeNo,
        user.name,
        now,
        now
      )
      .run();


    const savedNotice =
      await findNoticeById(
        context.env.DB,
        id
      );


    return jsonResponse(
      {
        ok: true,

        created: true,

        notice:
          savedNotice
      },
      201
    );

  } catch (
    error
  ) {
    console.error(
      "보직별 공지사항 등록 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "공지사항 등록 중 오류가 발생했습니다."
      },
      Number(
        error?.status
      ) ||
      500
    );
  }
}


/* =========================================================
  PUT /api/role-notices

  기존 공지 수정
========================================================= */

export async function onRequestPut(
  context
) {
  try {
    const authentication =
      await getAuthenticatedUser(
        context
      );


    if (
      authentication.error
    ) {
      return authentication.error;
    }


    const user =
      authentication.user;


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
            "공지사항 요청 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const id =
      normalizeText(
        body.id
      );


    if (
      !id
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "수정할 공지사항 ID가 필요합니다."
        },
        400
      );
    }


    const existingNotice =
      await findNoticeById(
        context.env.DB,
        id
      );


    if (
      !existingNotice
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "수정할 공지사항을 찾을 수 없습니다."
        },
        404
      );
    }


    if (
      !canManageRoleNotice(
        user,
        existingNotice.role
      )
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "해당 공지를 수정할 권한이 없습니다."
        },
        403
      );
    }


    const validation =
      validateNoticeInput(
        {
          ...body,

          /*
            공지 대상 보직은 수정으로 변경하지 못하게 한다.
          */
          role:
            existingNotice.role
        }
      );


    if (
      validation.error
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            validation.error
        },
        400
      );
    }


    const notice =
      validation.notice;


    const now =
      new Date()
        .toISOString();


    const updateResult =
      await context.env.DB
        .prepare(`
          UPDATE role_notices

          SET
            title = ?,
            content = ?,
            start_date = ?,
            end_date = ?,
            is_important = ?,
            updated_at = ?

          WHERE id = ?
        `)
        .bind(
          notice.title,
          notice.content,
          notice.startDate,
          notice.endDate,
          notice.isImportant,
          now,
          id
        )
        .run();


    if (
      Number(
        updateResult?.meta?.changes ||
        0
      ) !==
        1
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "공지사항을 수정하지 못했습니다."
        },
        409
      );
    }


    const savedNotice =
      await findNoticeById(
        context.env.DB,
        id
      );


    return jsonResponse({
      ok: true,

      created: false,

      notice:
        savedNotice
    });

  } catch (
    error
  ) {
    console.error(
      "보직별 공지사항 수정 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "공지사항 수정 중 오류가 발생했습니다."
      },
      Number(
        error?.status
      ) ||
      500
    );
  }
}


/* =========================================================
  DELETE /api/role-notices?id=...

  기존 공지 삭제
========================================================= */

export async function onRequestDelete(
  context
) {
  try {
    const authentication =
      await getAuthenticatedUser(
        context
      );


    if (
      authentication.error
    ) {
      return authentication.error;
    }


    const user =
      authentication.user;


    const requestUrl =
      new URL(
        context.request.url
      );


    const id =
      normalizeText(
        requestUrl.searchParams.get(
          "id"
        )
      );


    if (
      !id
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "삭제할 공지사항 ID가 필요합니다."
        },
        400
      );
    }


    const existingNotice =
      await findNoticeById(
        context.env.DB,
        id
      );


    if (
      !existingNotice
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "삭제할 공지사항을 찾을 수 없습니다."
        },
        404
      );
    }


    if (
      !canManageRoleNotice(
        user,
        existingNotice.role
      )
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "해당 공지를 삭제할 권한이 없습니다."
        },
        403
      );
    }


    const deleteResult =
      await context.env.DB
        .prepare(`
          DELETE FROM role_notices
          WHERE id = ?
        `)
        .bind(
          id
        )
        .run();


    if (
      Number(
        deleteResult?.meta?.changes ||
        0
      ) !==
        1
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "공지사항을 삭제하지 못했습니다."
        },
        409
      );
    }


    return jsonResponse({
      ok: true,

      deletedId:
        id
    });

  } catch (
    error
  ) {
    console.error(
      "보직별 공지사항 삭제 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "공지사항 삭제 중 오류가 발생했습니다."
      },
      Number(
        error?.status
      ) ||
      500
    );
  }
}
