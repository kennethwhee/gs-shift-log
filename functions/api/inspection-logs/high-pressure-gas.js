/* =========================================================
  고압가스 저장시설 주간점검표 공용 저장 API

  경로:
  functions/api/inspection-logs/high-pressure-gas.js

  API:
  GET  /api/inspection-logs/high-pressure-gas
  POST /api/inspection-logs/high-pressure-gas

  핵심 규칙:
  - Cloudflare D1 공용 저장
  - 로그인 세션 확인
  - 최고관리자, TO, BO1, BO2만 사용 가능
  - 날짜별 1건 저장
  - revision으로 동시 수정 충돌 방지
  - 저장할 때마다 수정 이력 보관
  - 고정 점검항목/확인내용 수정은 최고관리자만 가능
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";

const ALLOWED_POSITIONS =
  new Set([
    "TO",
    "BO1",
    "BO2"
  ]);

const VALID_STATUSES =
  new Set([
    "임시저장",
    "저장완료"
  ]);

const MAX_LOG_JSON_BYTES =
  300000;

const MAX_RESULT_LENGTH =
  500;

const DEFAULT_TEMPLATE_ITEMS = [
  {
    number: 1,
    item: "안전거리",
    description:
      "화기와의 안전거리 유지상태는 적절한가."
  },
  {
    number: 2,
    item: "시설 등의 표시",
    description:
      "출입문 경계표지 및 위험표지 설치는 양호한가."
  },
  {
    number: 3,
    item: "가스누설경보장치",
    description:
      "경보기 작동상태 및 설치위치\n제독제 보유량 및 흡수중화설비 연결상태"
  },
  {
    number: 4,
    item: "저장탱크",
    description:
      "탱크실 내 강제통풍 장치 정상적 동작 여부"
  },
  {
    number: 5,
    item: "가스설비의 구조",
    description:
      "방폭기기 유지관리 상태\n위험장소에 따른 적합한 방폭구조 선정 여부"
  },
  {
    number: 6,
    item: "과충전 방지조치",
    description:
      "내용적의 90% 초과 충전방지 조치 여부"
  },
  {
    number: 7,
    item: "누설검사",
    description:
      "저장탱크 부속설비 및 배관설비 연결부 누설 여부"
  },
  {
    number: 8,
    item: "긴급차단장치",
    description:
      "긴급 시 신속하게 조작할 수 있는 위치 및 상태"
  },
  {
    number: 9,
    item: "안전밸브",
    description:
      "압력계, 온도계 지시상태는 양호한가.\n안전밸브 설치위치 및 작동압력 적합 여부"
  },
  {
    number: 10,
    item: "정전기 제거조치",
    description:
      "정전기 제거용 본딩선 및 접지연결 상태"
  },
  {
    number: 11,
    item: "기타사항",
    description:
      "각종 조작용 밸브의 정위치 Setting 상태 확인\n설비 자체 점검 실시 및 기술기준 준수 여부 등"
  },
  {
    number: 12,
    item: "기타시설",
    description:
      "경보장치 및 이송설비 적정한가.\n통신시설, 통행시설은 적정한가."
  }
];


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


function normalizeText(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function normalizeMultilineText(
  value
) {
  return String(
    value ??
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


function normalizePosition(
  value
) {
  const position =
    normalizeText(
      value
    )
      .replace(
        /\s+/g,
        ""
      )
      .toUpperCase();

  return ALLOWED_POSITIONS.has(
    position
  )
    ? position
    : "";
}


function normalizeStatus(
  value
) {
  const status =
    normalizeText(
      value
    );

  if (
    status ===
      "작성중"
  ) {
    return "임시저장";
  }

  return VALID_STATUSES.has(
    status
  )
    ? status
    : "저장완료";
}


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
    .join("");
}


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
    normalizePosition(
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
      isSuperAdmin:
        role ===
          "super_admin"
    }
  };
}


function canUseHighPressureGasLog(
  user
) {
  if (
    !user
  ) {
    return false;
  }

  return (
    user.isSuperAdmin ||
    ALLOWED_POSITIONS.has(
      normalizePosition(
        user.position
      )
    )
  );
}

/* =========================================================
  고압가스 점검일지 삭제 권한

  - 최고관리자: 모든 일지 삭제
  - 일반 사용자: 본인이 최초 작성한 일지만 삭제
========================================================= */

function canDeleteHighPressureGasLog(
  user,
  log
) {
  if (
    !user ||
    !log
  ) {
    return false;
  }


  if (
    user.isSuperAdmin
  ) {
    return true;
  }


  const currentEmployeeNo =
    normalizeEmployeeNo(
      user.employeeNo
    );


  const authorEmployeeNo =
    normalizeEmployeeNo(
      log.authorId
    );


  return Boolean(
    currentEmployeeNo &&
    authorEmployeeNo &&
    currentEmployeeNo ===
      authorEmployeeNo
  );
}


async function ensureSchema(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        inspection_high_pressure_gas_logs (
          id TEXT PRIMARY KEY,
          inspection_date TEXT NOT NULL,
          shift TEXT NOT NULL DEFAULT 'DS',
          status TEXT NOT NULL DEFAULT '저장완료',
          author_id TEXT NOT NULL,
          author_name TEXT NOT NULL,
          log_json TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_modified_by_id TEXT NOT NULL,
          last_modified_by_name TEXT NOT NULL
        )
    `)
    .run();

  await database
    .prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        idx_high_pressure_gas_date_shift
      ON inspection_high_pressure_gas_logs (
        inspection_date,
        shift
      )
    `)
    .run();

  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        inspection_high_pressure_gas_history (
          history_id TEXT PRIMARY KEY,
          log_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          action TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          changed_by_id TEXT NOT NULL,
          changed_by_name TEXT NOT NULL,
          changed_at TEXT NOT NULL
        )
    `)
    .run();

  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_high_pressure_gas_history_log
      ON inspection_high_pressure_gas_history (
        log_id,
        revision DESC
      )
    `)
    .run();
}


function parseJsonObject(
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


function cloneDefaultTemplateItems() {
  return DEFAULT_TEMPLATE_ITEMS.map(
    item => ({
      ...item
    })
  );
}


function normalizeTemplateItems(
  value
) {
  if (
    !Array.isArray(
      value
    ) ||
    value.length !==
      12
  ) {
    return null;
  }

  const normalizedItems =
    value.map(
      (
        item,
        index
      ) => {
        if (
          !item ||
          typeof item !==
            "object" ||
          Array.isArray(
            item
          )
        ) {
          return null;
        }

        const itemName =
          normalizeText(
            item.item ||
            item.title
          );

        const description =
          normalizeMultilineText(
            item.description ||
            item.content
          );

        if (
          !itemName ||
          itemName.length >
            100 ||
          !description ||
          description.length >
            800
        ) {
          return null;
        }

        return {
          number:
            index +
            1,
          item:
            itemName,
          description
        };
      }
    );

  return normalizedItems.every(
    Boolean
  )
    ? normalizedItems
    : null;
}


function normalizeResults(
  rawForm
) {
  const rawResults =
    Array.isArray(
      rawForm?.results
    )
      ? rawForm.results
      : Array.from(
          {
            length: 12
          },
          (
            _,
            index
          ) => {
            return rawForm?.[
              `gasResult${index + 1}`
            ];
          }
        );

  return Array.from(
    {
      length: 12
    },
    (
      _,
      index
    ) => {
      return normalizeMultilineText(
        rawResults[index]
      ).slice(
        0,
        MAX_RESULT_LENGTH
      );
    }
  );
}


function normalizeFormData(
  rawForm
) {
  const form =
    rawForm &&
    typeof rawForm ===
      "object" &&
    !Array.isArray(
      rawForm
    )
      ? rawForm
      : {};

  return {
    safetyManager:
      normalizeText(
        form.safetyManager ??
        form.gasSafetyManager
      ).slice(
        0,
        100
      ),

    safetyGeneralManager:
      normalizeText(
        form.safetyGeneralManager ??
        form.gasSafetyGeneralManager
      ).slice(
        0,
        100
      ),

    inspectorName:
      normalizeText(
        form.inspectorName ??
        form.gasInspectorName
      ).slice(
        0,
        100
      ),

    overallResult:
      normalizeMultilineText(
        form.overallResult ??
        form.gasOverallResult
      ).slice(
        0,
        500
      ),

    results:
      normalizeResults(
        form
      ),

    workplaceConfirmation:
      normalizeText(
        form.workplaceConfirmation ??
        form.gasWorkplaceConfirmation
      ).slice(
        0,
        100
      ),

    finalInspector:
      normalizeText(
        form.finalInspector ??
        form.gasFinalInspector
      ).slice(
        0,
        100
      )
  };
}


function validateIncomingLog(
  rawLog
) {
  if (
    !rawLog ||
    typeof rawLog !==
      "object" ||
    Array.isArray(
      rawLog
    )
  ) {
    return {
      error:
        "고압가스 점검일지 데이터 형식이 올바르지 않습니다."
    };
  }

  const inspectionDate =
    normalizeText(
      rawLog.inspectionDate ??
      rawLog.inspection_date ??
      rawLog.date
    );

  if (
    !isValidIsoDate(
      inspectionDate
    )
  ) {
    return {
      error:
        "점검일자를 확인해 주세요."
    };
  }

  const form =
    normalizeFormData(
      rawLog.form ||
      rawLog.formData ||
      rawLog
    );

  const templateItems =
    normalizeTemplateItems(
      rawLog.templateItems ||
      rawLog.items
    );

  const log = {
    id:
      normalizeText(
        rawLog.id
      ),
    inspectionDate,
    shift:
      "DS",
    status:
      normalizeStatus(
        rawLog.status
      ),
    form,
    templateItems
  };

  const jsonText =
    JSON.stringify(
      log
    );

  if (
    new TextEncoder()
      .encode(
        jsonText
      )
      .byteLength >
      MAX_LOG_JSON_BYTES
  ) {
    return {
      error:
        "고압가스 점검일지 데이터가 너무 큽니다."
    };
  }

  return {
    log
  };
}


function convertRowToLog(
  row
) {
  const storedLog =
    parseJsonObject(
      row.log_json
    );

  return {
    ...storedLog,
    id:
      normalizeText(
        row.id
      ),
    inspectionDate:
      normalizeText(
        row.inspection_date
      ),
    shift:
      "DS",
    status:
      normalizeStatus(
        row.status
      ),
    authorId:
      normalizeEmployeeNo(
        row.author_id
      ),
    authorName:
      normalizeText(
        row.author_name
      ),
    serverRevision:
      Number(
        row.revision
      ) ||
      1,
    createdAt:
      normalizeText(
        row.created_at
      ),
    updatedAt:
      normalizeText(
        row.updated_at
      ),
    lastModifiedById:
      normalizeEmployeeNo(
        row.last_modified_by_id
      ),
    lastModifiedByName:
      normalizeText(
        row.last_modified_by_name
      ),
    source:
      "shared-d1"
  };
}


async function findLogById(
  database,
  id
) {
  const row =
    await database
      .prepare(`
        SELECT *
        FROM inspection_high_pressure_gas_logs
        WHERE id = ?
        LIMIT 1
      `)
      .bind(
        id
      )
      .first();

  return row
    ? convertRowToLog(
        row
      )
    : null;
}


async function findLogByDate(
  database,
  inspectionDate
) {
  const row =
    await database
      .prepare(`
        SELECT *
        FROM inspection_high_pressure_gas_logs
        WHERE
          inspection_date = ? AND
          shift = 'DS'
        LIMIT 1
      `)
      .bind(
        inspectionDate
      )
      .first();

  return row
    ? convertRowToLog(
        row
      )
    : null;
}


async function appendHistory(
  database,
  log,
  action,
  user
) {
  await database
    .prepare(`
      INSERT INTO
        inspection_high_pressure_gas_history (
          history_id,
          log_id,
          revision,
          action,
          snapshot_json,
          changed_by_id,
          changed_by_name,
          changed_at
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      crypto.randomUUID(),
      log.id,
      log.serverRevision,
      action,
      JSON.stringify(
        log
      ),
      user.employeeNo,
      user.name,
      new Date().toISOString()
    )
    .run();
}


function createConflictResponse(
  currentLog
) {
  return jsonResponse(
    {
      ok: false,
      conflict: true,
      message:
        "다른 사용자가 먼저 점검일지를 수정했습니다. 최신 내용을 다시 불러와 주세요.",
      currentLog
    },
    409
  );
}


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

    const user =
      authentication.user;

    if (
      !canUseHighPressureGasLog(
        user
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "고압가스 점검일지를 조회할 권한이 없습니다."
        },
        403
      );
    }

    await ensureSchema(
      context.env.DB
    );

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

    const date =
      normalizeText(
        requestUrl.searchParams.get(
          "date"
        )
      );

    const from =
      normalizeText(
        requestUrl.searchParams.get(
          "from"
        )
      );

    const to =
      normalizeText(
        requestUrl.searchParams.get(
          "to"
        )
      );

    const historyRequested =
      requestUrl.searchParams.get(
        "history"
      ) ===
      "1";

    if (
      date &&
      !isValidIsoDate(
        date
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "조회할 점검일자가 올바르지 않습니다."
        },
        400
      );
    }

    if (
      from &&
      !isValidIsoDate(
        from
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "조회 시작일이 올바르지 않습니다."
        },
        400
      );
    }

    if (
      to &&
      !isValidIsoDate(
        to
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "조회 종료일이 올바르지 않습니다."
        },
        400
      );
    }

    if (
      historyRequested
    ) {
      if (
        !id
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "수정이력을 조회할 점검일지 ID가 필요합니다."
          },
          400
        );
      }

      const historyResult =
        await context.env.DB
          .prepare(`
            SELECT
              history_id,
              log_id,
              revision,
              action,
              snapshot_json,
              changed_by_id,
              changed_by_name,
              changed_at
            FROM inspection_high_pressure_gas_history
            WHERE log_id = ?
            ORDER BY revision DESC
            LIMIT 100
          `)
          .bind(
            id
          )
          .all();

      const history =
        (
          Array.isArray(
            historyResult.results
          )
            ? historyResult.results
            : []
        ).map(
          row => ({
            historyId:
              normalizeText(
                row.history_id
              ),
            logId:
              normalizeText(
                row.log_id
              ),
            revision:
              Number(
                row.revision
              ) ||
              1,
            action:
              normalizeText(
                row.action
              ),
            snapshot:
              parseJsonObject(
                row.snapshot_json
              ),
            changedById:
              normalizeEmployeeNo(
                row.changed_by_id
              ),
            changedByName:
              normalizeText(
                row.changed_by_name
              ),
            changedAt:
              normalizeText(
                row.changed_at
              )
          })
        );

      return jsonResponse({
        ok: true,
        history,
        totalCount:
          history.length,
        canEditTemplate:
          user.isSuperAdmin
      });
    }

    if (
      id
    ) {
      const log =
        await findLogById(
          context.env.DB,
          id
        );

      return jsonResponse({
        ok: true,
        log,
        canEditTemplate:
          user.isSuperAdmin
      });
    }

    if (
      date
    ) {
      const log =
        await findLogByDate(
          context.env.DB,
          date
        );

      return jsonResponse({
        ok: true,
        log,
        canEditTemplate:
          user.isSuperAdmin
      });
    }

    let queryText = `
      SELECT *
      FROM inspection_high_pressure_gas_logs
      WHERE 1 = 1
    `;

    const bindValues = [];

    if (
      from
    ) {
      queryText += `
        AND inspection_date >= ?
      `;

      bindValues.push(
        from
      );
    }

    if (
      to
    ) {
      queryText += `
        AND inspection_date <= ?
      `;

      bindValues.push(
        to
      );
    }

    queryText += `
      ORDER BY inspection_date DESC
      LIMIT 500
    `;

    const result =
      await context.env.DB
        .prepare(
          queryText
        )
        .bind(
          ...bindValues
        )
        .all();

    const logs =
      (
        Array.isArray(
          result.results
        )
          ? result.results
          : []
      ).map(
        convertRowToLog
      );

    return jsonResponse({
      ok: true,
      logs,
      totalCount:
        logs.length,
      canEditTemplate:
        user.isSuperAdmin
    });

  } catch (
    error
  ) {
    console.error(
      "고압가스 점검일지 조회 오류:",
      error
    );

    return jsonResponse(
      {
        ok: false,
        message:
          "고압가스 점검일지를 불러오는 중 오류가 발생했습니다.",
        error:
          String(
            error
          )
      },
      500
    );
  }
}


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

    if (
      !canUseHighPressureGasLog(
        user
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "고압가스 점검일지를 저장할 권한이 없습니다."
        },
        403
      );
    }

    await ensureSchema(
      context.env.DB
    );

    let body;

    try {
      body =
        await context.request.json();

    } catch {
      return jsonResponse(
        {
          ok: false,
          message:
            "요청 데이터 형식이 올바르지 않습니다."
        },
        400
      );
    }

    const validation =
      validateIncomingLog(
        body.log ||
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

    const incomingLog =
      validation.log;

    const expectedRevision =
      Number(
        body.expectedRevision ??
        incomingLog.serverRevision ??
        0
      );

    let existingLog =
      incomingLog.id
        ? await findLogById(
            context.env.DB,
            incomingLog.id
          )
        : null;

    if (
      !existingLog
    ) {
      existingLog =
        await findLogByDate(
          context.env.DB,
          incomingLog.inspectionDate
        );
    }

    const now =
      new Date().toISOString();

    if (
      !existingLog
    ) {
      const id =
        `high-pressure-gas-${incomingLog.inspectionDate}-${crypto.randomUUID()}`;

      const templateItems =
        user.isSuperAdmin &&
        incomingLog.templateItems
          ? incomingLog.templateItems
          : cloneDefaultTemplateItems();

      const newLog = {
        id,
        inspectionDate:
          incomingLog.inspectionDate,
        shift:
          "DS",
        schedule:
          "매주 일요일 D/S",
        status:
          incomingLog.status,
        form:
          incomingLog.form,
        templateItems,
        authorId:
          user.employeeNo,
        authorName:
          user.name,
        createdAt:
          now,
        updatedAt:
          now,
        lastModifiedById:
          user.employeeNo,
        lastModifiedByName:
          user.name,
        source:
          "shared-d1"
      };

      await context.env.DB
        .prepare(`
          INSERT INTO
            inspection_high_pressure_gas_logs (
              id,
              inspection_date,
              shift,
              status,
              author_id,
              author_name,
              log_json,
              revision,
              created_at,
              updated_at,
              last_modified_by_id,
              last_modified_by_name
            )
          VALUES (?, ?, 'DS', ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `)
        .bind(
          id,
          newLog.inspectionDate,
          newLog.status,
          user.employeeNo,
          user.name,
          JSON.stringify(
            newLog
          ),
          now,
          now,
          user.employeeNo,
          user.name
        )
        .run();

      const savedLog =
        await findLogById(
          context.env.DB,
          id
        );

      await appendHistory(
        context.env.DB,
        savedLog,
        "생성",
        user
      );

      return jsonResponse(
        {
          ok: true,
          created: true,
          log:
            savedLog,
          canEditTemplate:
            user.isSuperAdmin
        },
        201
      );
    }

    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision <
        1 ||
      expectedRevision !==
        existingLog.serverRevision
    ) {
      return createConflictResponse(
        existingLog
      );
    }

    const templateItems =
      user.isSuperAdmin &&
      incomingLog.templateItems
        ? incomingLog.templateItems
        : (
            Array.isArray(
              existingLog.templateItems
            ) &&
            existingLog.templateItems.length ===
              12
              ? existingLog.templateItems
              : cloneDefaultTemplateItems()
          );

    const updatedLog = {
      ...existingLog,
      inspectionDate:
        existingLog.inspectionDate,
      shift:
        "DS",
      schedule:
        "매주 일요일 D/S",
      status:
        incomingLog.status,
      form:
        incomingLog.form,
      templateItems,
      updatedAt:
        now,
      lastModifiedById:
        user.employeeNo,
      lastModifiedByName:
        user.name,
      source:
        "shared-d1"
    };

    delete updatedLog.serverRevision;

    const updateResult =
      await context.env.DB
        .prepare(`
          UPDATE
            inspection_high_pressure_gas_logs
          SET
            status = ?,
            log_json = ?,
            revision = revision + 1,
            updated_at = ?,
            last_modified_by_id = ?,
            last_modified_by_name = ?
          WHERE
            id = ? AND
            revision = ?
        `)
        .bind(
          updatedLog.status,
          JSON.stringify(
            updatedLog
          ),
          now,
          user.employeeNo,
          user.name,
          existingLog.id,
          expectedRevision
        )
        .run();

    if (
      Number(
        updateResult?.meta?.changes ||
        0
      ) !==
        1
    ) {
      const currentLog =
        await findLogById(
          context.env.DB,
          existingLog.id
        );

      return createConflictResponse(
        currentLog
      );
    }

    const savedLog =
      await findLogById(
        context.env.DB,
        existingLog.id
      );

    await appendHistory(
      context.env.DB,
      savedLog,
      "수정",
      user
    );

    return jsonResponse({
      ok: true,
      created: false,
      log:
        savedLog,
      canEditTemplate:
        user.isSuperAdmin
    });

  } catch (
    error
  ) {
    console.error(
      "고압가스 점검일지 저장 오류:",
      error
    );

    const isUniqueConflict =
      /UNIQUE constraint failed/i.test(
        String(
          error
        )
      );

    return jsonResponse(
      {
        ok: false,
        message:
          isUniqueConflict
            ? "같은 날짜의 고압가스 점검일지가 이미 저장되어 있습니다. 최신 내용을 다시 불러와 주세요."
            : (
                error instanceof Error
                  ? error.message
                  : "고압가스 점검일지 저장 중 오류가 발생했습니다."
              )
      },
      isUniqueConflict
        ? 409
        : 500
    );
  }
}

/* =========================================================
  고압가스 점검일지 삭제
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


    if (
      !canUseHighPressureGasLog(
        user
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "고압가스 점검일지를 삭제할 권한이 없습니다."
        },
        403
      );
    }


    await ensureSchema(
      context.env.DB
    );


    let body;


    try {
      body =
        await context.request.json();

    } catch {
      return jsonResponse(
        {
          ok: false,
          message:
            "삭제 요청 데이터 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const id =
      normalizeText(
        body?.id
      );


    const expectedRevision =
      Number(
        body?.expectedRevision
      );


    if (
      !id
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "삭제할 점검일지 ID가 없습니다."
        },
        400
      );
    }


    const existingLog =
      await findLogById(
        context.env.DB,
        id
      );


    if (
      !existingLog
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "이미 삭제되었거나 존재하지 않는 점검일지입니다."
        },
        404
      );
    }


    if (
      !canDeleteHighPressureGasLog(
        user,
        existingLog
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "본인이 작성한 일지 또는 최고관리자만 삭제할 수 있습니다."
        },
        403
      );
    }


    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision <
        1 ||
      expectedRevision !==
        existingLog.serverRevision
    ) {
      return createConflictResponse(
        existingLog
      );
    }


    const deleteResult =
      await context.env.DB
        .prepare(`
          DELETE FROM
            inspection_high_pressure_gas_logs
          WHERE
            id = ? AND
            revision = ?
        `)
        .bind(
          existingLog.id,
          expectedRevision
        )
        .run();


    if (
      Number(
        deleteResult?.meta?.changes ||
        0
      ) !==
        1
    ) {
      const currentLog =
        await findLogById(
          context.env.DB,
          existingLog.id
        );


      return createConflictResponse(
        currentLog
      );
    }


    /* 삭제 직전 내용을 이력으로 보존 */
    await appendHistory(
      context.env.DB,
      existingLog,
      "삭제",
      user
    );


    return jsonResponse({
      ok: true,

      deletedId:
        existingLog.id,

      inspectionDate:
        existingLog.inspectionDate,

      message:
        "고압가스 점검일지가 삭제되었습니다."
    });

  } catch (
    error
  ) {
    console.error(
      "고압가스 점검일지 삭제 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof
            Error
            ? error.message
            : "고압가스 점검일지 삭제 중 오류가 발생했습니다."
      },
      500
    );
  }
}
