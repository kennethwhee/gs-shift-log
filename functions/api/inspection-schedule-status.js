"use strict";

/* =========================================================
  점검 일정 완료 상태 공용 API

  배포 경로:
  functions/api/inspection-schedule-status.js

  API:
  GET    /api/inspection-schedule-status
  POST   /api/inspection-schedule-status
  DELETE /api/inspection-schedule-status

  저장 원칙:
  - 완료 기록만 D1에 저장
  - 미완료·지연은 일정과 완료 기록을 비교하여 계산
  - 일정 ID + 예정일 + 근무별 1건 유지
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";

const MAX_QUERY_DAYS =
  400;


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
  문자열 정리
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


function normalizeRole(
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


/* =========================================================
  근무 정리

  저장값:
  - DS
  - NS
  - 빈 값
========================================================= */

function normalizeShift(
  value,
  allowEmpty = true
) {
  const shift =
    normalizeText(
      value
    )
      .toUpperCase()
      .replace(
        /[^A-Z]/g,
        ""
      );


  if (
    !shift &&
    allowEmpty
  ) {
    return "";
  }


  if (
    [
      "D",
      "DS"
    ].includes(
      shift
    )
  ) {
    return "DS";
  }


  if (
    [
      "N",
      "NS"
    ].includes(
      shift
    )
  ) {
    return "NS";
  }


  return null;
}


/* =========================================================
  날짜 검사
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


function getDateRangeDayCount(
  startDate,
  endDate
) {
  const startTime =
    new Date(
      `${startDate}T00:00:00.000Z`
    ).getTime();


  const endTime =
    new Date(
      `${endDate}T00:00:00.000Z`
    ).getTime();


  if (
    !Number.isFinite(
      startTime
    ) ||
    !Number.isFinite(
      endTime
    ) ||
    startTime >
      endTime
  ) {
    return 0;
  }


  return (
    Math.floor(
      (
        endTime -
        startTime
      ) /
      86400000
    ) +
    1
  );
}


function getKoreaToday() {
  return new Date(
    Date.now() +
    9 *
    60 *
    60 *
    1000
  )
    .toISOString()
    .slice(
      0,
      10
    );
}


/* =========================================================
  로그인 세션 토큰
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


  const matchedToken =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );


  return normalizeText(
    matchedToken?.[1]
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


async function hashToken(
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
    await hashToken(
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
        : normalizeRole(
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

      role
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
  D1 완료 상태 테이블 생성·업그레이드

  completion_source:
  - manual    : 사용자가 완료 버튼을 눌러 완료
  - shift_log : 업무일지 내용 자동인식으로 완료

  기존 완료 자료:
  - 자동으로 manual로 유지
  - 삭제하거나 초기화하지 않음
========================================================= */

async function ensureTable(
  database
) {
  /*
    신규 D1에서는 자동완료 출처 칸까지
    처음부터 포함하여 생성한다.
  */
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS inspection_schedule_status (
        id TEXT PRIMARY KEY,

        schedule_id TEXT NOT NULL,
        due_date TEXT NOT NULL,
        shift TEXT NOT NULL DEFAULT '',
        schedule_title TEXT NOT NULL DEFAULT '',

        status TEXT NOT NULL DEFAULT '완료',
        note TEXT NOT NULL DEFAULT '',

        completed_by_id TEXT NOT NULL DEFAULT '',
        completed_by_name TEXT NOT NULL DEFAULT '',
        completed_at TEXT NOT NULL DEFAULT '',

        completion_source TEXT NOT NULL DEFAULT 'manual',

        source_log_id TEXT NOT NULL DEFAULT '',
        source_entry_key TEXT NOT NULL DEFAULT '',
        source_role TEXT NOT NULL DEFAULT '',
        source_author TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        revision INTEGER NOT NULL DEFAULT 1,

        UNIQUE (
          schedule_id,
          due_date,
          shift
        )
      )
    `)
    .run();


  /*
    기존 테이블에 새 칸이 없는 경우
    필요한 칸만 추가한다.
  */
  const tableInfoResult =
    await database
      .prepare(`
        PRAGMA table_info(
          inspection_schedule_status
        )
      `)
      .all();


  const existingColumns =
    new Set(
      (
        Array.isArray(
          tableInfoResult.results
        )
          ? tableInfoResult.results
          : []
      )
        .map(
          column => {
            return normalizeText(
              column?.name
            );
          }
        )
        .filter(
          Boolean
        )
    );


  const requiredColumns = [
    {
      name:
        "completion_source",

      definition:
        "TEXT NOT NULL DEFAULT 'manual'"
    },

    {
      name:
        "source_log_id",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    },

    {
      name:
        "source_entry_key",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    },

    {
      name:
        "source_role",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    },

    {
      name:
        "source_author",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    },

    {
      name:
        "source_text",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    }
  ];


  for (
    const column of
    requiredColumns
  ) {
    if (
      existingColumns.has(
        column.name
      )
    ) {
      continue;
    }


    try {
      await database
        .prepare(`
          ALTER TABLE
            inspection_schedule_status

          ADD COLUMN
            ${column.name}
            ${column.definition}
        `)
        .run();

    } catch (
      error
    ) {
      /*
        동시에 두 요청이 실행되어
        다른 요청이 먼저 칸을 만든 경우는 무시한다.
      */
      const errorMessage =
        String(
          error?.message ||
          error ||
          ""
        ).toLowerCase();


      if (
        !errorMessage.includes(
          "duplicate column"
        )
      ) {
        throw error;
      }
    }
  }


  /*
    기존 완료 자료는 모두 사용자가 직접 완료한
    수동 완료 자료로 보존한다.
  */
  await database
    .prepare(`
      UPDATE inspection_schedule_status

      SET completion_source =
        'manual'

      WHERE
        completion_source IS NULL
        OR TRIM(
          completion_source
        ) = ''
        OR completion_source NOT IN (
          'manual',
          'shift_log'
        )
    `)
    .run();


  /*
    조회·자동동기화용 인덱스
  */
  await database.batch([
    database.prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_inspection_schedule_status_due_date

      ON inspection_schedule_status (
        due_date DESC
      )
    `),


    database.prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_inspection_schedule_status_source

      ON inspection_schedule_status (
        completion_source,
        source_log_id
      )
    `)
  ]);
}

/* =========================================================
  DB 행 → 화면 데이터

  수동·업무일지 자동완료 출처를
  화면에서도 확인할 수 있게 전달한다.
========================================================= */

function convertRow(
  row
) {
  const completionSource =
    normalizeText(
      row.completion_source
    ).toLowerCase() ===
      "shift_log"
        ? "shift_log"
        : "manual";


  return {
    id:
      normalizeText(
        row.id
      ),

    scheduleId:
      normalizeText(
        row.schedule_id
      ),

    dueDate:
      normalizeText(
        row.due_date
      ),

    shift:
      normalizeShift(
        row.shift,
        true
      ) ||
      "",

    scheduleTitle:
      normalizeText(
        row.schedule_title
      ),

    status:
      normalizeText(
        row.status
      ) ||
      "완료",

    note:
      normalizeText(
        row.note
      ),

    completedById:
      normalizeEmployeeNo(
        row.completed_by_id
      ),

    completedByName:
      normalizeText(
        row.completed_by_name
      ),

    completedAt:
      normalizeText(
        row.completed_at
      ),


    /*
      완료 출처
    */

    completionSource,

    isAutomatic:
      completionSource ===
      "shift_log",


    /*
      업무일지 자동완료 출처
    */

    sourceLogId:
      normalizeText(
        row.source_log_id
      ),

    sourceEntryKey:
      normalizeText(
        row.source_entry_key
      ),

    sourceRole:
      normalizeText(
        row.source_role
      ),

    sourceAuthor:
      normalizeText(
        row.source_author
      ),

    sourceText:
      normalizeText(
        row.source_text
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
  완료 대상 입력 검사
========================================================= */

function validateTarget(
  raw
) {
  const scheduleId =
    normalizeText(
      raw.scheduleId ||
      raw.schedule_id
    );


  const dueDate =
    normalizeText(
      raw.dueDate ||
      raw.due_date
    );


  const shift =
    normalizeShift(
      raw.shift,
      true
    );


  const scheduleTitle =
    normalizeText(
      raw.scheduleTitle ||
      raw.schedule_title ||
      scheduleId
    );


  const note =
    normalizeText(
      raw.note
    );


  if (
    !scheduleId ||
    scheduleId.length >
      120
  ) {
    return {
      error:
        "점검 일정 ID를 확인해 주세요."
    };
  }


  if (
    !isValidIsoDate(
      dueDate
    )
  ) {
    return {
      error:
        "점검 예정일을 확인해 주세요."
    };
  }


  if (
    shift ===
      null
  ) {
    return {
      error:
        "점검 근무는 D/S 또는 N/S로 입력해 주세요."
    };
  }


  if (
    !scheduleTitle ||
    scheduleTitle.length >
      300
  ) {
    return {
      error:
        "점검명은 300자 이하로 입력해 주세요."
    };
  }


  if (
    note.length >
      1000
  ) {
    return {
      error:
        "완료 메모는 1000자 이하로 입력해 주세요."
    };
  }


  return {
    item: {
      scheduleId,
      dueDate,
      shift,
      scheduleTitle,
      note
    }
  };
}


/* =========================================================
  완료 기록 1건 조회
========================================================= */

async function findRecord(
  database,
  target
) {
  const row =
    await database
      .prepare(`
        SELECT
          *

        FROM inspection_schedule_status

        WHERE
          schedule_id = ?
          AND due_date = ?
          AND shift = ?

        LIMIT 1
      `)
      .bind(
        target.scheduleId,
        target.dueDate,
        target.shift
      )
      .first();


  return row
    ? convertRow(
        row
      )
    : null;
}


/* =========================================================
  GET /api/inspection-schedule-status

  완료 기록 조회
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


    const requestUrl =
      new URL(
        context.request.url
      );


    const today =
      getKoreaToday();


    const startDate =
      normalizeText(
        requestUrl.searchParams.get(
          "startDate"
        )
      ) ||
      today;


    const endDate =
      normalizeText(
        requestUrl.searchParams.get(
          "endDate"
        )
      ) ||
      startDate;


    if (
      !isValidIsoDate(
        startDate
      ) ||
      !isValidIsoDate(
        endDate
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "조회 시작일과 종료일을 확인해 주세요."
        },
        400
      );
    }


    const dayCount =
      getDateRangeDayCount(
        startDate,
        endDate
      );


    if (
      dayCount <
        1 ||
      dayCount >
        MAX_QUERY_DAYS
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            `점검 완료 기록은 한 번에 최대 ${MAX_QUERY_DAYS}일까지 조회할 수 있습니다.`
        },
        400
      );
    }


    const result =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM inspection_schedule_status

          WHERE
            due_date >= ?
            AND due_date <= ?

          ORDER BY
            due_date DESC,
            schedule_title ASC,
            shift ASC
        `)
        .bind(
          startDate,
          endDate
        )
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

      count:
        items.length,

      items
    });

  } catch (
    error
  ) {
    console.error(
      "점검 완료 기록 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "점검 완료 기록을 불러오지 못했습니다."
      },
      500
    );
  }
}

/* =========================================================
  업무일지 점검 자동완료 동기화

  처리 원칙:
  - 같은 날짜·근무의 모든 보직 업무일지를 검사한 결과를 받는다.
  - 점검 일정별 가장 적합한 근거 문구 한 건을 저장한다.
  - 기존 수동 완료 기록은 절대로 수정하거나 삭제하지 않는다.
  - 업무일지 수정·삭제로 근거가 사라지면 자동완료만 삭제한다.
========================================================= */

function createShiftLogCompletionKey(
  target
) {
  return [
    normalizeText(
      target?.scheduleId ||
      target?.schedule_id
    ),

    normalizeText(
      target?.dueDate ||
      target?.due_date
    ),

    normalizeShift(
      target?.shift,
      true
    ) ||
    ""
  ].join(
    "||"
  );
}


/* =========================================================
  자동완료 후보 1건 정리
========================================================= */

function normalizeShiftLogCompletionMatch(
  rawMatch,
  context
) {
  const source =
    rawMatch &&
    typeof rawMatch ===
      "object" &&
    !Array.isArray(
      rawMatch
    )
      ? rawMatch
      : {};


  const scheduleId =
    normalizeText(
      source.scheduleId ||
      source.schedule_id
    );


  const dueDate =
    normalizeText(
      source.dueDate ||
      source.due_date ||
      context.workDate
    );


  const shift =
    normalizeShift(
      source.shift,
      true
    );


  const scheduleTitle =
    normalizeText(
      source.scheduleTitle ||
      source.schedule_title
    );


  const sourceLogId =
    normalizeText(
      source.sourceLogId ||
      source.source_log_id
    );


  const sourceEntryKey =
    normalizeText(
      source.sourceEntryKey ||
      source.source_entry_key
    ) ||
    [
      sourceLogId,
      scheduleId
    ].join(
      "||"
    );


  const sourceRole =
    normalizeText(
      source.sourceRole ||
      source.source_role
    );


  const sourceAuthor =
    normalizeText(
      source.sourceAuthor ||
      source.source_author
    );


  const sourceAuthorId =
    normalizeEmployeeNo(
      source.sourceAuthorId ||
      source.source_author_id
    );


  const sourceText =
    normalizeText(
      source.sourceText ||
      source.source_text
    );


  if (
    !scheduleId ||
    scheduleId.length >
      120
  ) {
    return {
      error:
        "자동완료할 점검 일정 ID를 확인해 주세요."
    };
  }


  if (
    dueDate !==
      context.workDate ||
    !isValidIsoDate(
      dueDate
    )
  ) {
    return {
      error:
        "자동완료 점검일은 업무일지 날짜와 같아야 합니다."
    };
  }


  if (
    shift ===
    null
  ) {
    return {
      error:
        "자동완료 점검 근무값이 올바르지 않습니다."
    };
  }


  /*
    근무가 지정된 점검은
    현재 업무일지 근무와 일치해야 한다.

    shift가 빈 값인 일정은
    근무 공통 일정으로 허용한다.
  */
  if (
    shift &&
    shift !==
      context.shift
  ) {
    return {
      error:
        "자동완료 점검 근무가 업무일지 근무와 다릅니다."
    };
  }


  if (
    !scheduleTitle ||
    scheduleTitle.length >
      300
  ) {
    return {
      error:
        "자동완료 점검명을 확인해 주세요."
    };
  }


  if (
    !sourceLogId ||
    sourceLogId.length >
      120
  ) {
    return {
      error:
        "자동완료 근거 업무일지 ID를 확인해 주세요."
    };
  }


  if (
    !sourceText
  ) {
    return {
      error:
        "자동완료 근거가 되는 업무일지 문구가 없습니다."
    };
  }


  return {
    item: {
      scheduleId,

      dueDate,

      shift:
        shift ||
        "",

      scheduleTitle,

      sourceLogId,

      sourceEntryKey:
        sourceEntryKey.slice(
          0,
          300
        ),

      sourceRole:
        sourceRole.slice(
          0,
          60
        ),

      sourceAuthor:
        sourceAuthor.slice(
          0,
          100
        ),

      sourceAuthorId:
        sourceAuthorId.slice(
          0,
          60
        ),

      sourceText:
        sourceText.slice(
          0,
          1000
        )
    }
  };
}


/* =========================================================
  업무일지 자동완료 D1 동기화
========================================================= */

async function synchronizeShiftLogInspectionCompletions(
  database,
  rawBody,
  currentUser
) {
  const workDate =
    normalizeText(
      rawBody?.workDate ||
      rawBody?.work_date
    );


  const shift =
    normalizeShift(
      rawBody?.shift,
      false
    );


  if (
    !isValidIsoDate(
      workDate
    )
  ) {
    return {
      ok:
        false,

      status:
        400,

      message:
        "업무일지 점검 자동완료 날짜를 확인해 주세요."
    };
  }


  if (
    !shift
  ) {
    return {
      ok:
        false,

      status:
        400,

      message:
        "업무일지 점검 자동완료 근무를 확인해 주세요."
    };
  }


  const context = {
    workDate,

    shift
  };


  const rawMatches =
    Array.isArray(
      rawBody?.matches
    )
      ? rawBody.matches
      : [];


  if (
    rawMatches.length >
    300
  ) {
    return {
      ok:
        false,

      status:
        400,

      message:
        "한 번에 동기화할 수 있는 점검 건수를 초과했습니다."
    };
  }


  /*
    관리 대상 업무일지 ID

    current:
    현재 같은 날짜·근무에 남아 있는 업무일지

    removed:
    방금 삭제된 업무일지
  */
  const managedSourceLogIds =
    new Set(
      [
        ...(
          Array.isArray(
            rawBody?.managedSourceLogIds
          )
            ? rawBody.managedSourceLogIds
            : []
        ),

        ...(
          Array.isArray(
            rawBody?.removedSourceLogIds
          )
            ? rawBody.removedSourceLogIds
            : []
        )
      ]
        .map(
          normalizeText
        )
        .filter(
          Boolean
        )
    );


  /*
    후보 정규화 및 점검별 중복 제거

    호출 측에서 점수가 높은 근거부터 보내므로
    같은 점검은 첫 번째 근거를 사용한다.
  */
  const matchMap =
    new Map();


  for (
    const rawMatch of
    rawMatches
  ) {
    const normalized =
      normalizeShiftLogCompletionMatch(
        rawMatch,
        context
      );


    if (
      normalized.error
    ) {
      return {
        ok:
          false,

        status:
          400,

        message:
          normalized.error
      };
    }


    const candidate =
      normalized.item;


    const key =
      createShiftLogCompletionKey(
        candidate
      );


    managedSourceLogIds.add(
      candidate.sourceLogId
    );


    if (
      !matchMap.has(
        key
      )
    ) {
      matchMap.set(
        key,
        candidate
      );
    }
  }


  if (
    managedSourceLogIds.size ===
      0
  ) {
    return {
      ok:
        true,

      skipped:
        true,

      workDate,

      shift,

      matchedCount:
        0,

      createdCount:
        0,

      updatedCount:
        0,

      deletedCount:
        0,

      manualProtectedCount:
        0
    };
  }


  const timestamp =
    new Date()
      .toISOString();


  let createdCount =
    0;


  let updatedCount =
    0;


  let deletedCount =
    0;


  let manualProtectedCount =
    0;


  /* =====================================================
    자동완료 생성·수정

    기존 수동 완료:
    - 그대로 유지
    - 자동완료로 바꾸지 않음
  ====================================================== */

  for (
    const candidate of
    matchMap.values()
  ) {
    const existing =
      await findRecord(
        database,
        candidate
      );


    if (
      existing?.completionSource ===
        "manual"
    ) {
      manualProtectedCount +=
        1;


      continue;
    }


    const completedById =
      candidate.sourceAuthorId ||
      normalizeEmployeeNo(
        currentUser?.employeeNo
      );


    const completedByName =
      candidate.sourceAuthor ||
      normalizeText(
        currentUser?.name
      ) ||
      "업무일지 자동인식";


    if (
      existing
    ) {
      const updateResult =
        await database
          .prepare(`
            UPDATE inspection_schedule_status

            SET
              schedule_title = ?,
              status = '완료',
              note = '업무일지 자동인식',

              completed_by_id = ?,
              completed_by_name = ?,
              completed_at = ?,

              completion_source = 'shift_log',

              source_log_id = ?,
              source_entry_key = ?,
              source_role = ?,
              source_author = ?,
              source_text = ?,

              updated_at = ?,

              revision =
                revision + 1

            WHERE
              id = ?
              AND completion_source = 'shift_log'
          `)
          .bind(
            candidate.scheduleTitle,

            completedById,
            completedByName,
            timestamp,

            candidate.sourceLogId,
            candidate.sourceEntryKey,
            candidate.sourceRole,
            candidate.sourceAuthor,
            candidate.sourceText,

            timestamp,

            existing.id
          )
          .run();


      if (
        Number(
          updateResult?.meta?.changes ||
          0
        ) ===
          1
      ) {
        updatedCount +=
          1;
      }


      continue;
    }


    await database
      .prepare(`
        INSERT INTO inspection_schedule_status (
          id,

          schedule_id,
          due_date,
          shift,
          schedule_title,

          status,
          note,

          completed_by_id,
          completed_by_name,
          completed_at,

          completion_source,

          source_log_id,
          source_entry_key,
          source_role,
          source_author,
          source_text,

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

          '완료',
          '업무일지 자동인식',

          ?,
          ?,
          ?,

          'shift_log',

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
        crypto.randomUUID(),

        candidate.scheduleId,
        candidate.dueDate,
        candidate.shift,
        candidate.scheduleTitle,

        completedById,
        completedByName,
        timestamp,

        candidate.sourceLogId,
        candidate.sourceEntryKey,
        candidate.sourceRole,
        candidate.sourceAuthor,
        candidate.sourceText,

        timestamp,
        timestamp
      )
      .run();


    createdCount +=
      1;
  }


  /* =====================================================
    근거가 사라진 자동완료 삭제

    삭제 조건:
    - 업무일지 자동완료 기록
    - 이번 재검사 대상 업무일지에서 만들어진 기록
    - 현재 매칭 결과에는 없는 점검

    수동 완료는 조회·삭제 대상에 포함하지 않는다.
  ====================================================== */

  const automaticResult =
    await database
      .prepare(`
        SELECT
          *

        FROM inspection_schedule_status

        WHERE
          due_date = ?
          AND completion_source = 'shift_log'
      `)
      .bind(
        workDate
      )
      .all();


  const automaticRows =
    Array.isArray(
      automaticResult.results
    )
      ? automaticResult.results
      : [];


  for (
    const row of
    automaticRows
  ) {
    const sourceLogId =
      normalizeText(
        row.source_log_id
      );


    if (
      !managedSourceLogIds.has(
        sourceLogId
      )
    ) {
      continue;
    }


    const rowKey =
      createShiftLogCompletionKey({
        scheduleId:
          row.schedule_id,

        dueDate:
          row.due_date,

        shift:
          row.shift
      });


    if (
      matchMap.has(
        rowKey
      )
    ) {
      continue;
    }


    const deleteResult =
      await database
        .prepare(`
          DELETE FROM inspection_schedule_status

          WHERE
            id = ?
            AND completion_source = 'shift_log'
        `)
        .bind(
          normalizeText(
            row.id
          )
        )
        .run();


    if (
      Number(
        deleteResult?.meta?.changes ||
        0
      ) ===
        1
    ) {
      deletedCount +=
        1;
    }
  }


  return {
    ok:
      true,

    skipped:
      false,

    automatic:
      true,

    workDate,

    shift,

    matchedCount:
      matchMap.size,

    createdCount,

    updatedCount,

    deletedCount,

    manualProtectedCount
  };
}

/* =========================================================
  POST /api/inspection-schedule-status

  사용자가 직접 완료 처리

  처리:
  - 신규 수동 완료 저장
  - 기존 수동 완료 갱신
  - 자동 완료를 사용자가 다시 완료하면 수동 완료로 전환
  - 자동완료 출처 정보 초기화
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


    await ensureTable(
      context.env.DB
    );


    const body =
      await readJsonBody(
        context.request
      );

    /* =====================================================
      업무일지 내용 자동인식 동기화

      수동 완료 처리와 분리하여 실행한다.
    ====================================================== */

    const requestedAction =
      normalizeText(
        body.action
      ).toLowerCase();


    if (
      requestedAction ===
        "sync-shift-log"
    ) {
      const syncResult =
        await synchronizeShiftLogInspectionCompletions(
          context.env.DB,
          body,
          authentication.user
        );


      return jsonResponse(
        syncResult,

        syncResult.ok
          ? 200
          : (
              Number(
                syncResult.status
              ) ||
              400
            )
      );
    }
      

    const validation =
      validateTarget(
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


    const user =
      authentication.user;


    const existing =
      await findRecord(
        context.env.DB,
        item
      );


    const convertedFromAutomatic =
      existing?.completionSource ===
      "shift_log";


    const timestamp =
      new Date()
        .toISOString();


    if (
      existing
    ) {
      await context.env.DB
        .prepare(`
          UPDATE inspection_schedule_status

          SET
            schedule_title = ?,
            status = '완료',
            note = ?,

            completed_by_id = ?,
            completed_by_name = ?,
            completed_at = ?,

            completion_source = 'manual',

            source_log_id = '',
            source_entry_key = '',
            source_role = '',
            source_author = '',
            source_text = '',

            updated_at = ?,

            revision =
              revision + 1

          WHERE id = ?
        `)
        .bind(
          item.scheduleTitle,
          item.note,

          user.employeeNo,
          user.name,
          timestamp,

          timestamp,

          existing.id
        )
        .run();

    } else {
      await context.env.DB
        .prepare(`
          INSERT INTO inspection_schedule_status (
            id,

            schedule_id,
            due_date,
            shift,
            schedule_title,

            status,
            note,

            completed_by_id,
            completed_by_name,
            completed_at,

            completion_source,

            source_log_id,
            source_entry_key,
            source_role,
            source_author,
            source_text,

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

            '완료',
            ?,

            ?,
            ?,
            ?,

            'manual',

            '',
            '',
            '',
            '',
            '',

            ?,
            ?,

            1
          )
        `)
        .bind(
          crypto.randomUUID(),

          item.scheduleId,
          item.dueDate,
          item.shift,
          item.scheduleTitle,

          item.note,

          user.employeeNo,
          user.name,
          timestamp,

          timestamp,
          timestamp
        )
        .run();
    }


    const savedItem =
      await findRecord(
        context.env.DB,
        item
      );


    return jsonResponse(
      {
        ok:
          true,

        created:
          !existing,

        convertedFromAutomatic,

        item:
          savedItem,

        message:
          convertedFromAutomatic
            ? "업무일지 자동완료 기록을 수동 완료로 전환했습니다."
            : "점검을 완료 처리했습니다."
      },

      existing
        ? 200
        : 201
    );

  } catch (
    error
  ) {
    console.error(
      "점검 완료 처리 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "점검을 완료 처리하지 못했습니다."
      },
      500
    );
  }
}

/* =========================================================
  DELETE /api/inspection-schedule-status

  수동 완료 취소:
  - 완료 기록 삭제 가능

  업무일지 자동 완료:
  - 화면에서 직접 취소 불가
  - 원본 업무일지를 수정·삭제하면 자동 재계산
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


    await ensureTable(
      context.env.DB
    );


    const requestUrl =
      new URL(
        context.request.url
      );


    const validation =
      validateTarget({
        scheduleId:
          requestUrl.searchParams.get(
            "scheduleId"
          ),

        dueDate:
          requestUrl.searchParams.get(
            "dueDate"
          ),

        shift:
          requestUrl.searchParams.get(
            "shift"
          ),

        scheduleTitle:
          "완료 취소"
      });


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
      await findRecord(
        context.env.DB,
        item
      );


    if (
      !existing
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "이미 완료 취소되었거나 완료 기록이 없습니다."
        },
        404
      );
    }


    /*
      업무일지 자동완료 기록 보호

      자동완료 근거가 되는 업무일지 문구를
      수정하거나 삭제해야 자동완료가 해제된다.
    */
    if (
      existing.completionSource ===
      "shift_log"
    ) {
      return jsonResponse(
        {
          ok:
            false,

          automatic:
            true,

          item:
            existing,

          message:
            "업무일지에서 자동 완료된 점검입니다. 원본 업무일지의 점검 내용을 수정하거나 삭제하면 자동으로 다시 반영됩니다."
        },
        409
      );
    }


    const result =
      await context.env.DB
        .prepare(`
          DELETE FROM inspection_schedule_status

          WHERE
            id = ?
            AND completion_source = 'manual'
        `)
        .bind(
          existing.id
        )
        .run();


    if (
      Number(
        result?.meta?.changes
      ) !==
      1
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "점검 완료 상태가 변경되었습니다. 다시 조회해 주세요."
        },
        409
      );
    }


    return jsonResponse({
      ok:
        true,

      deletedItem:
        existing,

      message:
        "점검 완료를 취소했습니다."
    });

  } catch (
    error
  ) {
    console.error(
      "점검 완료 취소 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "점검 완료를 취소하지 못했습니다."
      },
      500
    );
  }
}