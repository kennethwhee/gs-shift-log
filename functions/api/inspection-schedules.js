"use strict";


/* =========================================================
  점검 일정 관리 API

  경로:
  functions/api/inspection-schedules.js

  GET:
  - 일정 변경사항 조회
  - 모든 로그인 사용자 가능

  POST:
  - 일정 추가·수정·사용 중지
  - 최고관리자만 가능

  DELETE:
  - 기본 일정 변경사항 복원
  - 사용자 추가 일정 삭제
  - 최고관리자만 가능

  저장 구조:
  - 기본 일정은 inspection-logs.js에 유지
  - D1에는 관리자 변경사항만 저장
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const MAX_SCHEDULE_JSON_BYTES =
  50000;


const VALID_CATEGORIES =
  new Set([
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "other"
  ]);


const VALID_RULE_TYPES =
  new Set([
    "daily",
    "weekdays",
    "weekly",
    "monthlyDate",
    "monthlyWeek",
    "monthlyFloating",
    "adHoc"
  ]);


const INSPECTION_ASSIGNED_ROLE_ORDER =
  Object.freeze([
    "파트장",
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ]);


const VALID_ASSIGNED_ROLES =
  new Set(
    INSPECTION_ASSIGNED_ROLE_ORDER
  );


/* =========================================================
  공통 응답
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
          "no-store, no-cache, must-revalidate",

        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}


/* =========================================================
  기본값 정리
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
    [
      "super_admin",
      "superadmin"
    ].includes(
      role
    )
  ) {
    return "super_admin";
  }


  if (
    [
      "admin",
      "leader"
    ].includes(
      role
    )
  ) {
    return "admin";
  }


  return "user";
}


function normalizeBoolean(
  value,
  fallback = false
) {
  if (
    value === true ||
    value === 1
  ) {
    return true;
  }


  if (
    value === false ||
    value === 0
  ) {
    return false;
  }


  const text =
    normalizeText(
      value
    ).toLowerCase();


  if (
    [
      "true",
      "1",
      "yes",
      "y"
    ].includes(
      text
    )
  ) {
    return true;
  }


  if (
    [
      "false",
      "0",
      "no",
      "n"
    ].includes(
      text
    )
  ) {
    return false;
  }


  return fallback;
}


/* =========================================================
  로그인 토큰
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
    .join(
      ""
    );
}


async function hashSessionToken(
  token
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",

      new TextEncoder()
        .encode(
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
            ok:
              false,

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
            ok:
              false,

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
          user.is_active

        FROM shift_log_sessions AS session

        INNER JOIN users AS user
          ON user.employee_no =
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
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

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

      isSuperAdmin:
        role ===
          "super_admin"
    }
  };
}


/* =========================================================
  JSON 요청 읽기
========================================================= */

async function readJsonBody(
  request
) {
  try {
    const body =
      await request.json();


    return (
      body &&
      typeof body ===
        "object" &&
      !Array.isArray(
        body
      )
    )
      ? body
      : {};

  } catch {
    return {};
  }
}


/* =========================================================
  D1 테이블 생성

  일정 원본 전체가 아니라
  변경사항만 저장한다.
========================================================= */

async function ensureTable(
  database
) {
  await database.batch([
    database.prepare(`
      CREATE TABLE IF NOT EXISTS
        inspection_schedule_overrides
      (
        id TEXT PRIMARY KEY,

        schedule_json TEXT NOT NULL,

        is_active INTEGER NOT NULL DEFAULT 1,
        is_custom INTEGER NOT NULL DEFAULT 0,

        created_by_id TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',

        updated_by_id TEXT NOT NULL DEFAULT '',
        updated_by_name TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        revision INTEGER NOT NULL DEFAULT 1
      )
    `),


    database.prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_inspection_schedule_overrides_active

      ON inspection_schedule_overrides (
        is_active,
        updated_at DESC
      )
    `)
  ]);
}


/* =========================================================
  숫자 배열 정리
========================================================= */

function normalizeIntegerArray(
  value,
  minimum,
  maximum
) {
  const source =
    Array.isArray(
      value
    )
      ? value
      : [];


  return [
    ...new Set(
      source
        .map(
          item => {
            return Number(
              item
            );
          }
        )
        .filter(
          item => {
            return (
              Number.isInteger(
                item
              ) &&
              item >=
                minimum &&
              item <=
                maximum
            );
          }
        )
    )
  ].sort(
    (
      firstItem,
      secondItem
    ) => {
      return (
        firstItem -
        secondItem
      );
    }
  );
}


/* =========================================================
  근무 배열 정리

  저장 형식:
  - D/S
  - N/S
========================================================= */

function normalizeShiftArray(
  value
) {
  const source =
    Array.isArray(
      value
    )
      ? value
      : [];


  const normalized = [];


  source.forEach(
    item => {
      const shift =
        normalizeText(
          item
        )
          .toUpperCase()
          .replace(
            /[^A-Z]/g,
            ""
          );


      const displayValue =
        [
          "D",
          "DS"
        ].includes(
          shift
        )
          ? "D/S"
          : [
              "N",
              "NS"
            ].includes(
              shift
            )
            ? "N/S"
            : "";


      if (
        displayValue &&
        !normalized.includes(
          displayValue
        )
      ) {
        normalized.push(
          displayValue
        );
      }
    }
  );


  return normalized;
}

/* =========================================================
  담당 보직 배열 정리

  저장 순서:
  - 파트장
  - TGO
  - BCO1
  - BCO2
  - TO
  - BO1
  - BO2
========================================================= */

function normalizeAssignedRoleArray(
  value
) {
  const source =
    Array.isArray(
      value
    )
      ? value
      : [];


  const selectedRoles =
    new Set();


  source.forEach(
    item => {
      const rawRole =
        normalizeText(
          item
        );


      if (
        !rawRole
      ) {
        return;
      }


      if (
        rawRole ===
          "파트장"
      ) {
        selectedRoles.add(
          "파트장"
        );

        return;
      }


      const normalizedRole =
        rawRole
          .toUpperCase()
          .replace(
            /\s+/g,
            ""
          );


      if (
        VALID_ASSIGNED_ROLES.has(
          normalizedRole
        )
      ) {
        selectedRoles.add(
          normalizedRole
        );
      }
    }
  );


  return INSPECTION_ASSIGNED_ROLE_ORDER.filter(
    role => {
      return selectedRoles.has(
        role
      );
    }
  );
}


/* =========================================================
  일정 ID 정리
========================================================= */

function normalizeScheduleId(
  value
) {
  const id =
    normalizeText(
      value
    ).toLowerCase();


  return /^[a-z0-9][a-z0-9_-]{2,119}$/.test(
    id
  )
    ? id
    : "";
}


/* =========================================================
  일정 데이터 검증
========================================================= */

function validateScheduleItem(
  rawItem
) {
  const source =
    (
      rawItem &&
      typeof rawItem ===
        "object" &&
      !Array.isArray(
        rawItem
      )
    )
      ? rawItem
      : {};


  const id =
    normalizeScheduleId(
      source.id
    );


  const category =
    normalizeText(
      source.category
    ).toLowerCase();


  const title =
    normalizeText(
      source.title
    );


  const scheduleLabel =
    normalizeText(
      source.scheduleLabel
    );


  const position =
    normalizeText(
      source.position
    ).slice(
      0,
      200
    );


  const approval =
    normalizeText(
      source.approval
    ).slice(
      0,
      200
    );


  const share =
    normalizeText(
      source.share
    ).slice(
      0,
      200
    );


  const note =
    normalizeText(
      source.note
    ).slice(
      0,
      1000
    );


  const logKey =
    normalizeText(
      source.logKey
    ).slice(
      0,
      120
    );


  const titleKeyword =
    normalizeText(
      source.titleKeyword
    ).slice(
      0,
      120
    );


  const shifts =
    normalizeShiftArray(
      source.shifts
    );


  /*
    점검 담당 보직

    화면에서 전달된 assignedRoles를
    허용된 일곱 보직만 남기고 고정 순서로 저장한다.
  */
  const assignedRoles =
    normalizeAssignedRoleArray(
      source.assignedRoles
    );


  const rawRule =
    (
      source.rule &&
      typeof source.rule ===
        "object" &&
      !Array.isArray(
        source.rule
      )
    )
      ? source.rule
      : {};


  const ruleType =
    normalizeText(
      rawRule.type
    );


  if (
    !id
  ) {
    return {
      error:
        "점검 일정 ID는 영문 소문자·숫자·하이픈·밑줄로 3~120자까지 입력해 주세요."
    };
  }


  if (
    !VALID_CATEGORIES.has(
      category
    )
  ) {
    return {
      error:
        "점검 구분을 확인해 주세요."
    };
  }


  if (
    !title ||
    title.length >
      300
  ) {
    return {
      error:
        "점검명은 1~300자로 입력해 주세요."
    };
  }


  if (
    !scheduleLabel ||
    scheduleLabel.length >
      160
  ) {
    return {
      error:
        "점검 주기 표시는 1~160자로 입력해 주세요."
    };
  }


  if (
    !VALID_RULE_TYPES.has(
      ruleType
    )
  ) {
    return {
      error:
        "점검 주기 유형을 확인해 주세요."
    };
  }


  const days =
    normalizeIntegerArray(
      rawRule.days,
      0,
      6
    );


  const weeks =
    normalizeIntegerArray(
      rawRule.weeks,
      1,
      5
    );


  const months =
    normalizeIntegerArray(
      rawRule.months,
      1,
      12
    );


  const day =
    (
      rawRule.day ===
        "" ||
      rawRule.day ===
        null ||
      rawRule.day ===
        undefined
    )
      ? null
      : Number(
          rawRule.day
        );


  if (
    [
      "weekdays",
      "weekly"
    ].includes(
      ruleType
    ) &&
    days.length ===
      0
  ) {
    return {
      error:
        "주간 점검은 요일을 한 개 이상 선택해 주세요."
    };
  }


  if (
    ruleType ===
      "monthlyWeek" &&
    (
      weeks.length ===
        0 ||
      days.length ===
        0
    )
  ) {
    return {
      error:
        "월간 주차 점검은 주차와 요일을 각각 한 개 이상 선택해 주세요."
    };
  }


  if (
    ruleType ===
      "monthlyDate" &&
    (
      !Number.isInteger(
        day
      ) ||
      day <
        1 ||
      day >
        31
    )
  ) {
    return {
      error:
        "매월 지정일은 1~31일 범위로 입력해 주세요."
    };
  }


  const scheduleItem = {
    id,

    category,

    title,

    scheduleLabel,

    shifts,

    /*
      담당 보직은 schedule_json에 함께 저장한다.
      값이 없는 기존 일정은 빈 배열로 저장된다.
    */
    assignedRoles,

    position,

    approval,

    share,

    note,

    conditional:
      normalizeBoolean(
        source.conditional
      ),

    referenceOnly:
      normalizeBoolean(
        source.referenceOnly
      ),

    logKey,

    titleKeyword,

    rule: {
      type:
        ruleType,

      ...(
        days.length
          ? {
              days
            }
          : {}
      ),

      ...(
        weeks.length
          ? {
              weeks
            }
          : {}
      ),

      ...(
        months.length
          ? {
              months
            }
          : {}
      ),

      ...(
        day !==
          null
          ? {
              day
            }
          : {}
      )
    }
  };


  const jsonText =
    JSON.stringify(
      scheduleItem
    );


  const byteLength =
    new TextEncoder()
      .encode(
        jsonText
      )
      .byteLength;


  if (
    byteLength >
      MAX_SCHEDULE_JSON_BYTES
  ) {
    return {
      error:
        "점검 일정 데이터가 너무 큽니다."
    };
  }


  return {
    item:
      scheduleItem,

    jsonText
  };
}


/* =========================================================
  저장 JSON 읽기
========================================================= */

function parseScheduleJson(
  value
) {
  try {
    const parsed =
      JSON.parse(
        normalizeText(
          value
        ) ||
        "{}"
      );


    return (
      parsed &&
      typeof parsed ===
        "object" &&
      !Array.isArray(
        parsed
      )
    )
      ? parsed
      : {};

  } catch {
    return {};
  }
}


/* =========================================================
  DB 행 → 화면 데이터
========================================================= */

function convertRow(
  row
) {
  const scheduleItem =
    parseScheduleJson(
      row.schedule_json
    );


  return {
    ...scheduleItem,

    id:
      normalizeText(
        row.id
      ),

    /*
      기존 D1 데이터에 assignedRoles가 없더라도
      화면에는 항상 배열로 전달한다.
    */
    assignedRoles:
      normalizeAssignedRoleArray(
        scheduleItem.assignedRoles
      ),

    isActive:
      Number(
        row.is_active
      ) ===
        1,

    isCustom:
      Number(
        row.is_custom
      ) ===
        1,

    createdById:
      normalizeEmployeeNo(
        row.created_by_id
      ),

    createdByName:
      normalizeText(
        row.created_by_name
      ),

    updatedById:
      normalizeEmployeeNo(
        row.updated_by_id
      ),

    updatedByName:
      normalizeText(
        row.updated_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    revision:
      Number(
        row.revision
      ) ||
      1
  };
}


/* =========================================================
  변경사항 1건 조회
========================================================= */

async function findOverrideById(
  database,
  id
) {
  const row =
    await database
      .prepare(`
        SELECT
          *

        FROM inspection_schedule_overrides

        WHERE id = ?

        LIMIT 1
      `)
      .bind(
        id
      )
      .first();


  return row
    ? convertRow(
        row
      )
    : null;
}


/* =========================================================
  GET /api/inspection-schedules
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


    await ensureTable(
      context.env.DB
    );


    const result =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM inspection_schedule_overrides

          ORDER BY
            updated_at DESC,
            id ASC
        `)
        .all();


    const items =
      (
        Array.isArray(
          result.results
        )
          ? result.results
          : []
      ).map(
        convertRow
      );


    return jsonResponse({
      ok:
        true,

      canManage:
        authentication
          .user
          .isSuperAdmin,

      count:
        items.length,

      items
    });

  } catch (
    error
  ) {
    console.error(
      "점검 일정 설정 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "점검 일정 설정을 불러오지 못했습니다."
      },
      500
    );
  }
}


/* =========================================================
  POST /api/inspection-schedules
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


    if (
      !authentication
        .user
        .isSuperAdmin
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "최고관리자만 점검 일정을 수정할 수 있습니다."
        },
        403
      );
    }


    await ensureTable(
      context.env.DB
    );


    const body =
      await readJsonBody(
        context.request
      );


    const validation =
      validateScheduleItem(
        body.item ||
        body.schedule ||
        body
      );


    if (
      validation.error
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            validation.error
        },
        400
      );
    }


    const item =
      validation.item;


    const existing =
      await findOverrideById(
        context.env.DB,
        item.id
      );


    const requestedRevision =
      (
        body.expectedRevision ===
          "" ||
        body.expectedRevision ===
          null ||
        body.expectedRevision ===
          undefined
      )
        ? null
        : Number(
            body.expectedRevision
          );


    if (
      existing
    ) {
      if (
        !Number.isInteger(
          requestedRevision
        ) ||
        requestedRevision <
          1
      ) {
        return jsonResponse(
          {
            ok:
              false,

            currentItem:
              existing,

            message:
              "수정할 점검 일정 revision을 확인해 주세요."
          },
          400
        );
      }


      if (
        existing.revision !==
          requestedRevision
      ) {
        return jsonResponse(
          {
            ok:
              false,

            conflict:
              true,

            currentItem:
              existing,

            message:
              "다른 사용자가 먼저 점검 일정을 수정했습니다. 최신 내용을 다시 불러와 주세요."
          },
          409
        );
      }
    }


    const isActive =
      normalizeBoolean(
        body.isActive,
        true
      );


    const isCustom =
      normalizeBoolean(
        body.isCustom,
        existing?.isCustom ??
        false
      );


    const timestamp =
      new Date()
        .toISOString();


    const user =
      authentication.user;


    if (
      existing
    ) {
      const updateResult =
        await context.env.DB
          .prepare(`
            UPDATE inspection_schedule_overrides

            SET
              schedule_json = ?,
              is_active = ?,
              is_custom = ?,

              updated_by_id = ?,
              updated_by_name = ?,
              updated_at = ?,

              revision =
                revision + 1

            WHERE
              id = ?
              AND revision = ?
          `)
          .bind(
            validation.jsonText,

            isActive
              ? 1
              : 0,

            isCustom
              ? 1
              : 0,

            user.employeeNo,
            user.name,
            timestamp,

            item.id,
            requestedRevision
          )
          .run();


      if (
        Number(
          updateResult
            ?.meta
            ?.changes
        ) !==
          1
      ) {
        return jsonResponse(
          {
            ok:
              false,

            conflict:
              true,

            currentItem:
              await findOverrideById(
                context.env.DB,
                item.id
              ),

            message:
              "점검 일정 상태가 변경되었습니다. 다시 불러와 주세요."
          },
          409
        );
      }

    } else {
      await context.env.DB
        .prepare(`
          INSERT INTO inspection_schedule_overrides (
            id,
            schedule_json,
            is_active,
            is_custom,

            created_by_id,
            created_by_name,

            updated_by_id,
            updated_by_name,

            created_at,
            updated_at,

            revision
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,

            ?,
            ?,

            ?,
            ?,

            ?,
            ?,

            1
          )
        `)
        .bind(
          item.id,
          validation.jsonText,

          isActive
            ? 1
            : 0,

          isCustom
            ? 1
            : 0,

          user.employeeNo,
          user.name,

          user.employeeNo,
          user.name,

          timestamp,
          timestamp
        )
        .run();
    }


    const savedItem =
      await findOverrideById(
        context.env.DB,
        item.id
      );


    return jsonResponse(
      {
        ok:
          true,

        created:
          !existing,

        item:
          savedItem,

        message:
          existing
            ? "점검 일정을 수정했습니다."
            : "점검 일정을 등록했습니다."
      },

      existing
        ? 200
        : 201
    );

  } catch (
    error
  ) {
    console.error(
      "점검 일정 설정 저장 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "점검 일정 설정을 저장하지 못했습니다."
      },
      500
    );
  }
}


/* =========================================================
  DELETE /api/inspection-schedules

  기본 일정:
  - 관리자 변경사항 제거
  - JS 기본값으로 복원

  사용자 추가 일정:
  - 완전히 삭제
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


    if (
      !authentication
        .user
        .isSuperAdmin
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "최고관리자만 점검 일정 설정을 복원하거나 삭제할 수 있습니다."
        },
        403
      );
    }


    await ensureTable(
      context.env.DB
    );


    const requestUrl =
      new URL(
        context.request.url
      );


    const id =
      normalizeScheduleId(
        requestUrl
          .searchParams
          .get(
            "id"
          )
      );


    const requestedRevision =
      Number(
        requestUrl
          .searchParams
          .get(
            "revision"
          )
      );


    if (
      !id
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "복원하거나 삭제할 점검 일정 ID를 확인해 주세요."
        },
        400
      );
    }


    if (
      !Number.isInteger(
        requestedRevision
      ) ||
      requestedRevision <
        1
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "점검 일정 revision을 확인해 주세요."
        },
        400
      );
    }


    const existing =
      await findOverrideById(
        context.env.DB,
        id
      );


    if (
      !existing
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "저장된 점검 일정 변경사항이 없습니다."
        },
        404
      );
    }


    if (
      existing.revision !==
        requestedRevision
    ) {
      return jsonResponse(
        {
          ok:
            false,

          conflict:
            true,

          currentItem:
            existing,

          message:
            "다른 사용자가 먼저 점검 일정을 수정했습니다. 최신 내용을 다시 불러와 주세요."
        },
        409
      );
    }


    const result =
      await context.env.DB
        .prepare(`
          DELETE FROM inspection_schedule_overrides

          WHERE
            id = ?
            AND revision = ?
        `)
        .bind(
          id,
          requestedRevision
        )
        .run();


    if (
      Number(
        result
          ?.meta
          ?.changes
      ) !==
        1
    ) {
      return jsonResponse(
        {
          ok:
            false,

          conflict:
            true,

          message:
            "점검 일정 상태가 변경되었습니다. 다시 불러와 주세요."
        },
        409
      );
    }


    return jsonResponse({
      ok:
        true,

      deletedItem:
        existing,

      restoredDefault:
        !existing.isCustom,

      message:
        existing.isCustom
          ? "사용자 추가 점검 일정을 삭제했습니다."
          : "기본 점검 일정으로 복원했습니다."
    });

  } catch (
    error
  ) {
    console.error(
      "점검 일정 설정 삭제 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "점검 일정 설정을 삭제하지 못했습니다."
      },
      500
    );
  }
}