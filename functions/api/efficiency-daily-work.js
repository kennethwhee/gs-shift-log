"use strict";


/* =========================================================
  효율팀 일일업무현황 공용 API

  경로:
  functions/api/efficiency-daily-work.js

  현재 단계:
  GET /api/efficiency-daily-work

  규칙:
  - 모든 로그인 사용자가 조회 가능
  - 날짜별 저장 기록은 1건만 유지
  - version은 동시 수정 방지용 번호
  - D1 테이블과 인덱스는 최초 요청 시 자동 생성
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const MAXIMUM_QUERY_ROWS =
  10000;


const CURRENT_SCHEMA_VERSION =
  1;


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
          "no-store, no-cache, must-revalidate",

        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}


/* =========================================================
  기본 값 정리
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


function normalizePositiveInteger(
  value,
  fallbackValue = 1
) {
  const numberValue =
    Number(
      value
    );


  return (
    Number.isInteger(
      numberValue
    ) &&
    numberValue >=
      1
  )
    ? numberValue
    : fallbackValue;
}


/* =========================================================
  로그인 세션 확인

  기존 GS Shift Log 로그인 API와 같은 방식이다.
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
  D1 테이블 및 인덱스 자동 생성

  work_date 고유 인덱스로
  같은 날짜의 중복 기록 생성을 DB에서도 막는다.
========================================================= */

async function ensureEfficiencyDailyWorkSchema(
  database
) {
  await database.batch([
    database.prepare(`
      CREATE TABLE IF NOT EXISTS efficiency_daily_work_records (
        id TEXT PRIMARY KEY NOT NULL,

        work_date TEXT NOT NULL,

        version INTEGER NOT NULL DEFAULT 1
          CHECK (
            version >= 1
          ),

        schema_version INTEGER NOT NULL DEFAULT 1
          CHECK (
            schema_version >= 1
          ),

        content_json TEXT NOT NULL DEFAULT '{}',

        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,

        last_modified_by_id TEXT NOT NULL,
        last_modified_by_name TEXT NOT NULL,

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),

    database.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        idx_efficiency_daily_work_records_work_date

      ON efficiency_daily_work_records (
        work_date
      )
    `)
  ]);
}


/* =========================================================
  저장된 JSON 본문 읽기

  잘못된 JSON 한 건이 있어도
  보관함 전체 조회는 중단하지 않는다.
========================================================= */

function parseEfficiencyDailyWorkContent(
  value
) {
  try {
    const parsedValue =
      JSON.parse(
        normalizeText(
          value
        ) ||
        "{}"
      );


    return (
      parsedValue &&
      typeof parsedValue ===
        "object" &&
      !Array.isArray(
        parsedValue
      )
    )
      ? parsedValue
      : {};

  } catch {
    return {};
  }
}


/* =========================================================
  D1 행을 프런트엔드 기록 형식으로 변환

  서버 메타데이터는 content_json보다 나중에 넣어
  저장된 JSON이 ID·날짜·version을 덮어쓰지 못하게 한다.
========================================================= */

function convertEfficiencyDailyWorkRow(
  row
) {
  const content =
    parseEfficiencyDailyWorkContent(
      row.content_json
    );


  const authorName =
    normalizeText(
      row.author_name
    );


  const authorId =
    normalizeEmployeeNo(
      row.author_id
    );


  const lastModifiedBy =
    normalizeText(
      row.last_modified_by_name
    ) ||
    authorName;


  const lastModifiedById =
    normalizeEmployeeNo(
      row.last_modified_by_id
    ) ||
    authorId;


  return {
    ...content,

    id:
      normalizeText(
        row.id
      ),

    recordId:
      normalizeText(
        row.id
      ),

    workDate:
      normalizeText(
        row.work_date
      ),

    version:
      normalizePositiveInteger(
        row.version
      ),

    schemaVersion:
      normalizePositiveInteger(
        row.schema_version,
        CURRENT_SCHEMA_VERSION
      ),

    author:
      authorName,

    authorId,

    authorName,

    createdById:
      authorId,

    createdByName:
      authorName,

    lastModifiedBy,

    lastModifiedById,

    updatedById:
      lastModifiedById,

    updatedByName:
      lastModifiedBy,

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    source:
      "shared-d1"
  };
}


/* =========================================================
  GET /api/efficiency-daily-work

  날짜별 보관함에 사용할 전체 저장 기록을
  최신 날짜부터 반환한다.
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


    await ensureEfficiencyDailyWorkSchema(
      context.env.DB
    );


    const queryResult =
      await context.env.DB
        .prepare(`
          SELECT
            id,
            work_date,
            version,
            schema_version,
            content_json,
            author_id,
            author_name,
            last_modified_by_id,
            last_modified_by_name,
            created_at,
            updated_at

          FROM efficiency_daily_work_records

          ORDER BY
            work_date DESC,
            version DESC,
            updated_at DESC

          LIMIT ${MAXIMUM_QUERY_ROWS}
        `)
        .all();


    const items =
      (
        Array.isArray(
          queryResult.results
        )
          ? queryResult.results
          : []
      ).map(
        convertEfficiencyDailyWorkRow
      );


    return jsonResponse({
      ok:
        true,

      items,

      totalCount:
        items.length
    });

  } catch (
    error
  ) {
    console.error(
      "일일업무현황 저장 기록 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          "일일업무현황 저장 기록을 불러오는 중 오류가 발생했습니다."
      },
      500
    );
  }
}

/* =========================================================
  효율팀 일일업무현황 공용 API

  10단계:
  POST 신규 저장 및 PUT 기존 기록 수정

  규칙:
  - 모든 로그인 사용자가 저장·수정 가능
  - 작성일별 기록은 1건만 생성
  - 수정할 때 최초 작성자는 유지
  - 최종 수정자와 수정 시각은 매번 갱신
  - version이 다르면 다른 사람의 저장 내용을 덮어쓰지 않음
========================================================= */

const EFFICIENCY_DAILY_WORK_ALLOWED_ROW_KEYS = Object.freeze([
  "efficiency-overall",
  "efficiency-1",
  "efficiency-2",
  "efficiency-3",
  "purchase-admin",
  "operation-day",
  "operation-night",
]);

const EFFICIENCY_DAILY_WORK_MAXIMUM_REQUEST_BYTES = 512 * 1024;

const EFFICIENCY_DAILY_WORK_MAXIMUM_SHORT_TEXT_LENGTH = 300;

const EFFICIENCY_DAILY_WORK_MAXIMUM_LONG_TEXT_LENGTH = 30000;

/* =========================================================
  저장 요청 오류
========================================================= */

function createEfficiencyDailyWorkApiError(
  message,
  status = 400,
  code = "INVALID_REQUEST"
) {
  const error =
    new Error(
      message
    );

  error.status =
    status;

  error.code =
    code;

  return error;
}

function respondEfficiencyDailyWorkWriteError(
  error,
  logLabel,
  fallbackMessage
) {
  const status =
    Number(
      error?.status
    );

  if (
    Number.isInteger(
      status
    ) &&
    status >= 400 &&
    status < 500
  ) {
    return jsonResponse(
      {
        ok:
          false,

        code:
          normalizeText(
            error.code
          ) ||
          "INVALID_REQUEST",

        message:
          normalizeText(
            error.message
          ) ||
          fallbackMessage,
      },
      status
    );
  }

  console.error(
    logLabel,
    error
  );

  return jsonResponse(
    {
      ok:
        false,

      code:
        "SERVER_ERROR",

      message:
        fallbackMessage,
    },
    500
  );
}

/* =========================================================
  JSON 요청 본문 읽기
========================================================= */

async function readEfficiencyDailyWorkRequestBody(
  request
) {
  const requestText =
    await request.text();

  const requestByteLength =
    new TextEncoder()
      .encode(
        requestText
      )
      .byteLength;

  if (
    requestByteLength >
    EFFICIENCY_DAILY_WORK_MAXIMUM_REQUEST_BYTES
  ) {
    throw createEfficiencyDailyWorkApiError(
      "일일업무현황 저장 내용이 너무 큽니다.",
      413,
      "REQUEST_TOO_LARGE"
    );
  }

  if (
    !requestText.trim()
  ) {
    throw createEfficiencyDailyWorkApiError(
      "저장할 일일업무현황 내용이 없습니다."
    );
  }

  let body;

  try {
    body =
      JSON.parse(
        requestText
      );
  } catch {
    throw createEfficiencyDailyWorkApiError(
      "일일업무현황 저장 요청 형식이 올바르지 않습니다."
    );
  }

  if (
    !body ||
    typeof body !==
      "object" ||
    Array.isArray(
      body
    )
  ) {
    throw createEfficiencyDailyWorkApiError(
      "일일업무현황 저장 요청 형식이 올바르지 않습니다."
    );
  }

  return body;
}

/* =========================================================
  저장 값 검증 및 정리
========================================================= */

function normalizeEfficiencyDailyWorkLimitedText(
  value,
  maximumLength,
  fieldLabel
) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  if (
    typeof value !==
      "string"
  ) {
    throw createEfficiencyDailyWorkApiError(
      `${fieldLabel} 값은 문자열이어야 합니다.`,
      400,
      "INVALID_TEXT"
    );
  }

  const normalizedValue =
    normalizeText(
      value
    );

  if (
    normalizedValue.length >
    maximumLength
  ) {
    throw createEfficiencyDailyWorkApiError(
      `${fieldLabel}은(는) ${maximumLength.toLocaleString("ko-KR")}자 이내로 입력해 주세요.`,
      400,
      "FIELD_TOO_LONG"
    );
  }

  return normalizedValue;
}

function normalizeEfficiencyDailyWorkBooleanValue(
  value
) {
  if (
    value === true ||
    value === 1
  ) {
    return true;
  }

  const normalizedValue =
    normalizeText(
      value
    ).toLowerCase();

  return (
    normalizedValue ===
      "true" ||
    normalizedValue ===
      "1" ||
    normalizedValue ===
      "yes" ||
    normalizedValue ===
      "on"
  );
}

function normalizeEfficiencyDailyWorkDate(
  value
) {
  const normalizedValue =
    normalizeText(
      value
    );

  const matchedDate =
    /^(\d{4})-(\d{2})-(\d{2})$/
      .exec(
        normalizedValue
      );

  if (
    !matchedDate
  ) {
    throw createEfficiencyDailyWorkApiError(
      "작성일을 올바르게 선택해 주세요.",
      400,
      "INVALID_WORK_DATE"
    );
  }

  const year =
    Number(
      matchedDate[1]
    );

  const month =
    Number(
      matchedDate[2]
    );

  const day =
    Number(
      matchedDate[3]
    );

  const parsedDate =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  if (
    parsedDate.getUTCFullYear() !==
      year ||
    parsedDate.getUTCMonth() !==
      month - 1 ||
    parsedDate.getUTCDate() !==
      day
  ) {
    throw createEfficiencyDailyWorkApiError(
      "작성일을 올바르게 선택해 주세요.",
      400,
      "INVALID_WORK_DATE"
    );
  }

  return normalizedValue;
}

function normalizeEfficiencyDailyWorkPartValue(
  value
) {
  const normalizedValue =
    normalizeText(
      value
    );

  if (
    normalizedValue ===
      ""
  ) {
    return "";
  }

  if (
    ![
      "1",
      "2",
      "3",
      "4",
    ].includes(
      normalizedValue
    )
  ) {
    throw createEfficiencyDailyWorkApiError(
      "근무 파트는 1~4파트 중에서 선택해 주세요.",
      400,
      "INVALID_PART"
    );
  }

  return normalizedValue;
}

function getEfficiencyDailyWorkSourceRowMap(
  value
) {
  const sourceRowMap =
    new Map();

  if (
    !Array.isArray(
      value
    )
  ) {
    throw createEfficiencyDailyWorkApiError(
      "업무 행 저장 형식이 올바르지 않습니다.",
      400,
      "INVALID_ROWS"
    );
  }

  if (
    value.length !==
    EFFICIENCY_DAILY_WORK_ALLOWED_ROW_KEYS
      .length
  ) {
    throw createEfficiencyDailyWorkApiError(
      "업무 행 개수가 올바르지 않습니다.",
      400,
      "INVALID_ROWS"
    );
  }

  value.forEach(
    sourceRow => {
      if (
        !sourceRow ||
        typeof sourceRow !==
          "object" ||
        Array.isArray(
          sourceRow
        )
      ) {
        throw createEfficiencyDailyWorkApiError(
          "업무 행 저장 형식이 올바르지 않습니다.",
          400,
          "INVALID_ROWS"
        );
      }

      const rowKey =
        normalizeText(
          sourceRow.rowKey ??
          sourceRow.row_key ??
          sourceRow.key
        ).toLowerCase();

      if (
        !EFFICIENCY_DAILY_WORK_ALLOWED_ROW_KEYS
          .includes(
            rowKey
          )
      ) {
        throw createEfficiencyDailyWorkApiError(
          "알 수 없는 업무 행이 포함되어 있습니다.",
          400,
          "INVALID_ROW_KEY"
        );
      }

      if (
        sourceRowMap.has(
          rowKey
        )
      ) {
        throw createEfficiencyDailyWorkApiError(
          "중복된 업무 행이 포함되어 있습니다.",
          400,
          "DUPLICATE_ROW_KEY"
        );
      }

      sourceRowMap.set(
        rowKey,
        sourceRow
      );
    }
  );

  return sourceRowMap;
}

function normalizeEfficiencyDailyWorkContent(
  body
) {
  const hasNestedContent =
    Object.prototype
      .hasOwnProperty
      .call(
        body,
        "content"
      );

  const sourceContent =
    hasNestedContent
      ? body.content
      : body;

  if (
    !sourceContent ||
    typeof sourceContent !==
      "object" ||
    Array.isArray(
      sourceContent
    )
  ) {
    throw createEfficiencyDailyWorkApiError(
      "일일업무현황 문서 내용 형식이 올바르지 않습니다.",
      400,
      "INVALID_CONTENT"
    );
  }

  const sourceRowMap =
    getEfficiencyDailyWorkSourceRowMap(
      sourceContent.rows
    );

  const generationReportCompleted =
    sourceContent
      .generationReportCompleted ??
    sourceContent
      .generation_report_completed;

  if (
    typeof generationReportCompleted !==
      "boolean"
  ) {
    throw createEfficiencyDailyWorkApiError(
      "발전일보 작성 완료 값이 올바르지 않습니다.",
      400,
      "INVALID_BOOLEAN"
    );
  }

  const rows =
    EFFICIENCY_DAILY_WORK_ALLOWED_ROW_KEYS
      .map(
        rowKey => {
          const sourceRow =
            sourceRowMap.get(
              rowKey
            ) ||
            {};

          return {
            rowKey,

            assignee:
              normalizeEfficiencyDailyWorkLimitedText(
                sourceRow.assignee,
                EFFICIENCY_DAILY_WORK_MAXIMUM_SHORT_TEXT_LENGTH,
                `${rowKey} 담당자`
              ),

            part:
              normalizeEfficiencyDailyWorkPartValue(
                sourceRow.part
              ),

            members:
              normalizeEfficiencyDailyWorkLimitedText(
                sourceRow.members,
                EFFICIENCY_DAILY_WORK_MAXIMUM_SHORT_TEXT_LENGTH,
                `${rowKey} 근무자`
              ),

            tasks:
              normalizeEfficiencyDailyWorkLimitedText(
                sourceRow.tasks,
                EFFICIENCY_DAILY_WORK_MAXIMUM_LONG_TEXT_LENGTH,
                `${rowKey} 주요 업무`
              ),

            remarks:
              normalizeEfficiencyDailyWorkLimitedText(
                sourceRow.remarks,
                EFFICIENCY_DAILY_WORK_MAXIMUM_LONG_TEXT_LENGTH,
                `${rowKey} 비고`
              ),
          };
        }
      );

  return {
    notice:
      normalizeEfficiencyDailyWorkLimitedText(
        sourceContent.notice,
        EFFICIENCY_DAILY_WORK_MAXIMUM_LONG_TEXT_LENGTH,
        "공지사항"
      ),

    tmMeeting:
      normalizeEfficiencyDailyWorkLimitedText(
        sourceContent.tmMeeting ??
        sourceContent.tm_meeting,
        EFFICIENCY_DAILY_WORK_MAXIMUM_LONG_TEXT_LENGTH,
        "TM 회의 내용"
      ),

    teamInstruction:
      normalizeEfficiencyDailyWorkLimitedText(
        sourceContent.teamInstruction ??
        sourceContent.team_instruction,
        EFFICIENCY_DAILY_WORK_MAXIMUM_LONG_TEXT_LENGTH,
        "설비운영팀 전달사항"
      ),

    generationReportCompleted:
      normalizeEfficiencyDailyWorkBooleanValue(
        generationReportCompleted
      ),

    rows,

    otherNotes:
      normalizeEfficiencyDailyWorkLimitedText(
        sourceContent.otherNotes ??
        sourceContent.other_notes,
        EFFICIENCY_DAILY_WORK_MAXIMUM_LONG_TEXT_LENGTH,
        "기타사항"
      ),
  };
}

function serializeEfficiencyDailyWorkContent(
  content
) {
  const contentJson =
    JSON.stringify(
      content
    );

  const contentByteLength =
    new TextEncoder()
      .encode(
        contentJson
      )
      .byteLength;

  if (
    contentByteLength >
    EFFICIENCY_DAILY_WORK_MAXIMUM_REQUEST_BYTES
  ) {
    throw createEfficiencyDailyWorkApiError(
      "일일업무현황 저장 내용이 너무 큽니다.",
      413,
      "CONTENT_TOO_LARGE"
    );
  }

  return contentJson;
}

function normalizeEfficiencyDailyWorkRecordId(
  value
) {
  if (
    typeof value !==
      "string"
  ) {
    throw createEfficiencyDailyWorkApiError(
      "수정할 일일업무현황 기록 정보가 올바르지 않습니다.",
      400,
      "INVALID_RECORD_ID"
    );
  }

  const recordId =
    normalizeText(
      value
    );

  if (
    !recordId ||
    recordId.length > 128
  ) {
    throw createEfficiencyDailyWorkApiError(
      "수정할 일일업무현황 기록 정보가 올바르지 않습니다.",
      400,
      "INVALID_RECORD_ID"
    );
  }

  return recordId;
}

function normalizeEfficiencyDailyWorkExpectedVersion(
  value
) {
  const version =
    Number(
      value
    );

  if (
    !Number.isInteger(
      version
    ) ||
    version < 1
  ) {
    throw createEfficiencyDailyWorkApiError(
      "수정할 기록의 version 정보가 올바르지 않습니다.",
      400,
      "INVALID_VERSION"
    );
  }

  return version;
}

function validateEfficiencyDailyWorkCreateVersion(
  value
) {
  if (
    !Number.isInteger(
      value
    ) ||
    value !== 0
  ) {
    throw createEfficiencyDailyWorkApiError(
      "새 일지의 version 정보가 올바르지 않습니다.",
      400,
      "INVALID_VERSION"
    );
  }

  return 0;
}

/* =========================================================
  저장 기록 1건 조회
========================================================= */

async function findEfficiencyDailyWorkRowById(
  database,
  recordId
) {
  return database
    .prepare(`
      SELECT
        id,
        work_date,
        version,
        schema_version,
        content_json,
        author_id,
        author_name,
        last_modified_by_id,
        last_modified_by_name,
        created_at,
        updated_at

      FROM efficiency_daily_work_records

      WHERE id = ?

      LIMIT 1
    `)
    .bind(
      recordId
    )
    .first();
}

function getEfficiencyDailyWorkDatabaseChanges(
  result
) {
  const changes =
    Number(
      result?.meta?.changes
    );

  if (
    result?.success !==
      true ||
    !Number.isInteger(
      changes
    ) ||
    changes < 0 ||
    changes > 1
  ) {
    throw new Error(
      "일일업무현황 D1 저장 결과가 올바르지 않습니다."
    );
  }

  return changes;
}

function getEfficiencyDailyWorkFirstBatchRow(
  result
) {
  return Array.isArray(
    result?.results
  )
    ? result.results[0] ||
      null
    : null;
}

/* =========================================================
  POST /api/efficiency-daily-work

  선택 날짜에 저장 기록이 없을 때만 신규 생성한다.
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

    await ensureEfficiencyDailyWorkSchema(
      context.env.DB
    );

    const body =
      await readEfficiencyDailyWorkRequestBody(
        context.request
      );

    const workDate =
      normalizeEfficiencyDailyWorkDate(
        body.workDate ??
        body.work_date
      );

    const requestedRecordId =
      body.recordId ??
      body.record_id ??
      body.id;

    if (
      requestedRecordId !==
        undefined &&
      requestedRecordId !==
        null &&
      normalizeText(
        requestedRecordId
      )
    ) {
      throw createEfficiencyDailyWorkApiError(
        "새 일지 저장 요청에는 기존 기록 ID를 넣을 수 없습니다.",
        400,
        "UNEXPECTED_RECORD_ID"
      );
    }

    validateEfficiencyDailyWorkCreateVersion(
      body.version
    );

    const content =
      normalizeEfficiencyDailyWorkContent(
        body
      );

    const contentJson =
      serializeEfficiencyDailyWorkContent(
        content
      );

    const recordId =
      crypto.randomUUID();

    const now =
      new Date()
        .toISOString();

    const user =
      authentication.user;

    const authorName =
      normalizeText(
        user.name
      ) ||
      user.employeeNo;

    const batchResults =
      await context.env.DB
        .batch([
          context.env.DB
            .prepare(`
              INSERT INTO efficiency_daily_work_records (
                id,
                work_date,
                version,
                schema_version,
                content_json,
                author_id,
                author_name,
                last_modified_by_id,
                last_modified_by_name,
                created_at,
                updated_at
              )

              VALUES (
                ?,
                ?,
                1,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?
              )

              ON CONFLICT(work_date)
              DO NOTHING
            `)
            .bind(
              recordId,
              workDate,
              CURRENT_SCHEMA_VERSION,
              contentJson,
              user.employeeNo,
              authorName,
              user.employeeNo,
              authorName,
              now,
              now
            ),

          context.env.DB
            .prepare(`
              SELECT
                id,
                work_date,
                version,
                schema_version,
                content_json,
                author_id,
                author_name,
                last_modified_by_id,
                last_modified_by_name,
                created_at,
                updated_at

              FROM efficiency_daily_work_records

              WHERE work_date = ?

              LIMIT 1
            `)
            .bind(
              workDate
            ),
        ]);

    const insertResult =
      batchResults[0];

    const storedRow =
      getEfficiencyDailyWorkFirstBatchRow(
        batchResults[1]
      );

    if (
      getEfficiencyDailyWorkDatabaseChanges(
        insertResult
      ) !== 1
    ) {
      return jsonResponse(
        {
          ok:
            false,

          code:
            "DATE_ALREADY_EXISTS",

          message:
            "해당 날짜의 일일업무현황이 이미 저장되어 있습니다. 최신 기록을 불러온 뒤 수정해 주세요.",

          currentVersion:
            storedRow
              ? normalizePositiveInteger(
                  storedRow.version
                )
              : null,

          item:
            storedRow
              ? convertEfficiencyDailyWorkRow(
                  storedRow
                )
              : null,
        },
        409
      );
    }

    if (
      !storedRow ||
      normalizeText(
        storedRow.id
      ) !==
        recordId
    ) {
      throw new Error(
        "신규 저장 직후 기록을 찾지 못했습니다."
      );
    }

    const item =
      convertEfficiencyDailyWorkRow(
        storedRow
      );

    return jsonResponse(
      {
        ok:
          true,

        created:
          true,

        item,
      },
      201
    );
  } catch (
    error
  ) {
    return respondEfficiencyDailyWorkWriteError(
      error,
      "일일업무현황 신규 저장 오류:",
      "일일업무현황을 저장하는 중 오류가 발생했습니다."
    );
  }
}

/* =========================================================
  PUT /api/efficiency-daily-work

  id와 version이 모두 일치할 때만 수정한다.
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

    await ensureEfficiencyDailyWorkSchema(
      context.env.DB
    );

    const body =
      await readEfficiencyDailyWorkRequestBody(
        context.request
      );

    const recordId =
      normalizeEfficiencyDailyWorkRecordId(
        body.recordId ??
        body.record_id ??
        body.id
      );

    const expectedVersion =
      normalizeEfficiencyDailyWorkExpectedVersion(
        body.version
      );

    const workDate =
      normalizeEfficiencyDailyWorkDate(
        body.workDate ??
        body.work_date
      );

    const content =
      normalizeEfficiencyDailyWorkContent(
        body
      );

    const contentJson =
      serializeEfficiencyDailyWorkContent(
        content
      );

    const currentRow =
      await findEfficiencyDailyWorkRowById(
        context.env.DB,
        recordId
      );

    if (
      !currentRow
    ) {
      return jsonResponse(
        {
          ok:
            false,

          code:
            "RECORD_NOT_FOUND",

          message:
            "수정할 일일업무현황 기록을 찾을 수 없습니다.",
        },
        404
      );
    }

    if (
      normalizeText(
        currentRow.work_date
      ) !==
        workDate
    ) {
      return jsonResponse(
        {
          ok:
            false,

          code:
            "WORK_DATE_MISMATCH",

          message:
            "현재 기록의 작성일이 서버와 다릅니다. 새로고침한 뒤 다시 수정해 주세요.",

          currentVersion:
            normalizePositiveInteger(
              currentRow.version
            ),

          item:
            convertEfficiencyDailyWorkRow(
              currentRow
            ),
        },
        409
      );
    }

    const now =
      new Date()
        .toISOString();

    const user =
      authentication.user;

    const modifierName =
      normalizeText(
        user.name
      ) ||
      user.employeeNo;

    const batchResults =
      await context.env.DB
        .batch([
          context.env.DB
            .prepare(`
              UPDATE efficiency_daily_work_records

              SET
                version =
                  version + 1,

                schema_version = ?,
                content_json = ?,
                last_modified_by_id = ?,
                last_modified_by_name = ?,
                updated_at = ?

              WHERE id = ?
                AND work_date = ?
                AND version = ?
            `)
            .bind(
              CURRENT_SCHEMA_VERSION,
              contentJson,
              user.employeeNo,
              modifierName,
              now,
              recordId,
              workDate,
              expectedVersion
            ),

          context.env.DB
            .prepare(`
              SELECT
                id,
                work_date,
                version,
                schema_version,
                content_json,
                author_id,
                author_name,
                last_modified_by_id,
                last_modified_by_name,
                created_at,
                updated_at

              FROM efficiency_daily_work_records

              WHERE id = ?

              LIMIT 1
            `)
            .bind(
              recordId
            ),
        ]);

    const updateResult =
      batchResults[0];

    const latestRow =
      getEfficiencyDailyWorkFirstBatchRow(
        batchResults[1]
      );

    if (
      getEfficiencyDailyWorkDatabaseChanges(
        updateResult
      ) !== 1
    ) {
      if (
        !latestRow
      ) {
        return jsonResponse(
          {
            ok:
              false,

            code:
              "RECORD_NOT_FOUND",

            message:
              "수정 중 기록이 삭제되었습니다. 목록을 새로고침해 주세요.",
          },
          404
        );
      }

      return jsonResponse(
        {
          ok:
            false,

          code:
            "VERSION_CONFLICT",

          message:
            "다른 사용자가 먼저 이 기록을 수정했습니다. 최신 기록을 불러온 뒤 다시 수정해 주세요.",

          currentVersion:
            normalizePositiveInteger(
              latestRow.version
            ),

          item:
            convertEfficiencyDailyWorkRow(
              latestRow
            ),
        },
        409
      );
    }

    if (
      !latestRow
    ) {
      throw new Error(
        "수정 직후 기록을 찾지 못했습니다."
      );
    }

    const item =
      convertEfficiencyDailyWorkRow(
        latestRow
      );

    return jsonResponse({
      ok:
        true,

      updated:
        true,

      item,
    });
  } catch (
    error
  ) {
    return respondEfficiencyDailyWorkWriteError(
      error,
      "일일업무현황 수정 저장 오류:",
      "일일업무현황을 수정하는 중 오류가 발생했습니다."
    );
  }
}

/* =========================================================
  효율팀 일일업무현황 공용 API

  12단계:
  DELETE 저장 기록 삭제

  규칙:
  - 모든 로그인 사용자가 삭제 가능
  - id, workDate, version이 모두 일치할 때만 삭제
  - 조건부 DELETE와 최신 기록 조회를 같은 D1 batch로 실행
  - 충돌 시 서버 최신 기록을 응답에 포함
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

    await ensureEfficiencyDailyWorkSchema(
      context.env.DB
    );

    const body =
      await readEfficiencyDailyWorkRequestBody(
        context.request
      );

    const recordId =
      normalizeEfficiencyDailyWorkRecordId(
        body.recordId ??
        body.record_id ??
        body.id
      );

    const workDate =
      normalizeEfficiencyDailyWorkDate(
        body.workDate ??
        body.work_date
      );

    const expectedVersion =
      normalizeEfficiencyDailyWorkExpectedVersion(
        body.version
      );

    const batchResults =
      await context.env.DB
        .batch([
          context.env.DB
            .prepare(`
              DELETE FROM efficiency_daily_work_records

              WHERE id = ?
                AND work_date = ?
                AND version = ?
            `)
            .bind(
              recordId,
              workDate,
              expectedVersion
            ),

          context.env.DB
            .prepare(`
              SELECT
                id,
                work_date,
                version,
                schema_version,
                content_json,
                author_id,
                author_name,
                last_modified_by_id,
                last_modified_by_name,
                created_at,
                updated_at

              FROM efficiency_daily_work_records

              WHERE id = ?
                 OR work_date = ?

              ORDER BY
                CASE
                  WHEN id = ? THEN 0
                  ELSE 1
                END

              LIMIT 1
            `)
            .bind(
              recordId,
              workDate,
              recordId
            ),
        ]);

    const deleteResult =
      batchResults[0];

    const latestRow =
      getEfficiencyDailyWorkFirstBatchRow(
        batchResults[1]
      );

    const deletedCount =
      getEfficiencyDailyWorkDatabaseChanges(
        deleteResult
      );

    if (
      deletedCount === 1
    ) {
      return jsonResponse({
        ok:
          true,

        deleted:
          true,

        recordId,

        workDate,

        deletedVersion:
          expectedVersion,
      });
    }

    if (
      !latestRow
    ) {
      return jsonResponse(
        {
          ok:
            false,

          code:
            "RECORD_NOT_FOUND",

          message:
            "삭제할 일일업무현황 기록을 찾을 수 없습니다.",

          currentVersion:
            null,

          item:
            null,
        },
        404
      );
    }

    const latestItem =
      convertEfficiencyDailyWorkRow(
        latestRow
      );

    const latestRecordId =
      normalizeText(
        latestRow.id
      );

    const latestWorkDate =
      normalizeText(
        latestRow.work_date
      );

    const currentVersion =
      normalizePositiveInteger(
        latestRow.version
      );

    if (
      latestRecordId !==
        recordId
    ) {
      return jsonResponse(
        {
          ok:
            false,

          code:
            "RECORD_REPLACED",

          message:
            "삭제하려던 기록은 이미 없어졌고 같은 날짜에 새 기록이 저장되어 있습니다. 최신 기록을 불러와 주세요.",

          currentVersion,

          item:
            latestItem,
        },
        409
      );
    }

    if (
      latestWorkDate !==
        workDate
    ) {
      return jsonResponse(
        {
          ok:
            false,

          code:
            "WORK_DATE_MISMATCH",

          message:
            "현재 기록의 작성일이 서버와 다릅니다. 최신 기록을 불러온 뒤 다시 시도해 주세요.",

          currentVersion,

          item:
            latestItem,
        },
        409
      );
    }

    if (
      currentVersion !==
        expectedVersion
    ) {
      return jsonResponse(
        {
          ok:
            false,

          code:
            "VERSION_CONFLICT",

          message:
            "다른 사용자가 먼저 이 기록을 수정했습니다. 최신 기록을 불러온 뒤 다시 삭제해 주세요.",

          currentVersion,

          item:
            latestItem,
        },
        409
      );
    }

    throw new Error(
      "삭제 조건과 일치하는 기록이 남아 있지만 D1 삭제 건수가 0입니다."
    );
  } catch (
    error
  ) {
    return respondEfficiencyDailyWorkWriteError(
      error,
      "일일업무현황 삭제 오류:",
      "일일업무현황을 삭제하는 중 오류가 발생했습니다."
    );
  }
}