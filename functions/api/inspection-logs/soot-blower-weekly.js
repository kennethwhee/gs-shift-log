/* =========================================================
  Soot Blower 주간 점검일지 공용 저장 API

  배포 경로:
  functions/api/inspection-logs/soot-blower-weekly.js

  API:
  GET    /api/inspection-logs/soot-blower-weekly
  POST   /api/inspection-logs/soot-blower-weekly
  DELETE /api/inspection-logs/soot-blower-weekly

  핵심 규칙:
  - Cloudflare D1 공용 저장
  - 로그인한 모든 사용자가 조회/저장 가능
  - 점검일자 + N/S 조합별 1건 저장
  - revision으로 동시 수정 충돌 방지
  - 저장 및 삭제 때마다 수정 이력 보관
  - 점검 항목은 34개 x 2개 호기의 고정 구조
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";

const SHIFT =
  "NS";

const SCHEDULE =
  "매주 월요일 N/S";

const FORM_VERSION =
  "soot-blower-weekly-v1";

const VALID_LOG_STATUSES =
  new Set([
    "임시저장",
    "저장완료"
  ]);

const MAX_LOG_JSON_BYTES =
  300000;

const MAX_NAME_LENGTH =
  100;

const MAX_REMARK_LENGTH =
  500;

const MAX_OCCURRENCE_DATE_LENGTH =
  30;

const SOOT_BLOWER_ITEMS = [
  ...Array.from(
    {
      length: 16
    },
    (
      _,
      index
    ) => ({
      key:
        `eco-${index + 11}`,
      type:
        "Eco Side S.B",
      number:
        String(
          index +
          11
        )
    })
  ),
  ...Array.from(
    {
      length: 10
    },
    (
      _,
      index
    ) => ({
      key:
        `super-heater-${index + 1}`,
      type:
        "Super Heater Side S.B",
      number:
        String(
          index +
          1
        )
    })
  ),
  ...[
    "A-1",
    "A-2",
    "A-3",
    "A-4",
    "B-1",
    "B-2",
    "B-3",
    "B-4"
  ].map(
    number => ({
      key:
        `acoustic-${number.toLowerCase()}`,
      type:
        "음파식 제매기",
      number
    })
  )
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
  return normalizeText(
    value
  )
    .replace(
      /\s+/g,
      ""
    )
    .toUpperCase();
}


function normalizeLogStatus(
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

  return VALID_LOG_STATUSES.has(
    status
  )
    ? status
    : "저장완료";
}


function normalizeCheckStatus(
  value
) {
  const status =
    normalizeText(
      value
    )
      .replace(
        /\s+/g,
        ""
      )
      .toUpperCase();

  if (
    !status
  ) {
    return "";
  }

  if (
    status ===
      "O" ||
    status ===
      "○" ||
    status ===
      "양호"
  ) {
    return "O";
  }

  if (
    status ===
      "X" ||
    status ===
      "×" ||
    status ===
      "✕" ||
    status ===
      "불량"
  ) {
    return "X";
  }

  return "";
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
      position:
        normalizePosition(
          session.position
        ),
      isSuperAdmin:
        role ===
          "super_admin"
    }
  };
}


function canDeleteSootBlowerLog(
  user,
  log
) {
  if (
    !user ||
    !log
  ) {
    return false;
  }

  return (
    user.isSuperAdmin ||
    normalizeEmployeeNo(
      log.authorId
    ) ===
      normalizeEmployeeNo(
        user.employeeNo
      )
  );
}


function attachLogPermissions(
  log,
  user
) {
  if (
    !log
  ) {
    return null;
  }

  return {
    ...log,
    canDelete:
      canDeleteSootBlowerLog(
        user,
        log
      )
  };
}


function getFormMetadata() {
  return {
    formVersion:
      FORM_VERSION,
    shift:
      SHIFT,
    schedule:
      SCHEDULE,
    unitCount:
      2,
    itemCountPerUnit:
      SOOT_BLOWER_ITEMS.length,
    totalCheckCount:
      SOOT_BLOWER_ITEMS.length *
      2
  };
}


async function ensureSchema(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        inspection_soot_blower_weekly_logs (
          id TEXT PRIMARY KEY,
          inspection_date TEXT NOT NULL,
          shift TEXT NOT NULL DEFAULT 'NS',
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
        idx_soot_blower_weekly_date_shift
      ON inspection_soot_blower_weekly_logs (
        inspection_date,
        shift
      )
    `)
    .run();

  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        inspection_soot_blower_weekly_history (
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
        idx_soot_blower_weekly_history_log
      ON inspection_soot_blower_weekly_history (
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


function getRawUnitItems(
  form,
  unitKey
) {
  const unitNumber =
    unitKey ===
      "unit1"
      ? "1"
      : "2";

  const candidates = [
    form?.units?.[
      unitKey
    ],
    form?.[
      unitKey
    ],
    form?.[
      `${unitKey}Items`
    ],
    form?.[
      `unit${unitNumber}Results`
    ]
  ];

  return candidates.find(
    Array.isArray
  );
}


function getRawUnitItem(
  form,
  unitKey,
  index
) {
  const unitNumber =
    unitKey ===
      "unit1"
      ? "1"
      : "2";

  const arrayItems =
    getRawUnitItems(
      form,
      unitKey
    );

  const arrayItem =
    arrayItems?.[
      index
    ];

  const item =
    arrayItem &&
    typeof arrayItem ===
      "object" &&
    !Array.isArray(
      arrayItem
    )
      ? arrayItem
      : {};

  const itemNumber =
    index +
    1;

  return {
    status:
      item.status ??
      item.result ??
      item.checkResult ??
      form?.[
        `sootUnit${unitNumber}Status${itemNumber}`
      ],

    remark:
      item.remark ??
      item.note ??
      item.specialNote ??
      form?.[
        `sootUnit${unitNumber}Remark${itemNumber}`
      ],

    occurrenceDate:
      item.occurrenceDate ??
      item.occurredAt ??
      item.date ??
      form?.[
        `sootUnit${unitNumber}OccurrenceDate${itemNumber}`
      ]
  };
}


function normalizeUnitItems(
  form,
  unitKey
) {
  const rawItems =
    getRawUnitItems(
      form,
      unitKey
    );

  if (
    rawItems &&
    rawItems.length !==
      SOOT_BLOWER_ITEMS.length
  ) {
    return {
      error:
        `${unitKey === "unit1" ? "1호기" : "2호기"} 점검항목은 ${SOOT_BLOWER_ITEMS.length}개여야 합니다.`
    };
  }

  const normalizedItems = [];

  for (
    let index = 0;
    index <
      SOOT_BLOWER_ITEMS.length;
    index +=
      1
  ) {
    const fixedItem =
      SOOT_BLOWER_ITEMS[
        index
      ];

    const rawItem =
      getRawUnitItem(
        form,
        unitKey,
        index
      );

    const rawStatus =
      normalizeText(
        rawItem.status
      );

    const status =
      normalizeCheckStatus(
        rawStatus
      );

    if (
      rawStatus &&
      !status
    ) {
      return {
        error:
          `${unitKey === "unit1" ? "1호기" : "2호기"} ${fixedItem.number}번 점검결과는 O 또는 X로 입력해 주세요.`
      };
    }

    normalizedItems.push({
      key:
        fixedItem.key,
      type:
        fixedItem.type,
      number:
        fixedItem.number,
      status,
      remark:
        normalizeMultilineText(
          rawItem.remark
        ).slice(
          0,
          MAX_REMARK_LENGTH
        ),
      occurrenceDate:
        normalizeText(
          rawItem.occurrenceDate
        ).slice(
          0,
          MAX_OCCURRENCE_DATE_LENGTH
        )
    });
  }

  return {
    items:
      normalizedItems
  };
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

  const unit1 =
    normalizeUnitItems(
      form,
      "unit1"
    );

  if (
    unit1.error
  ) {
    return unit1;
  }

  const unit2 =
    normalizeUnitItems(
      form,
      "unit2"
    );

  if (
    unit2.error
  ) {
    return unit2;
  }

  return {
    form: {
      partLeaderApproval:
        normalizeText(
          form.partLeaderApproval ??
          form.approval ??
          form.sootPartLeaderApproval
        ).slice(
          0,
          MAX_NAME_LENGTH
        ),

      unit1Inspector:
        normalizeText(
          form.unit1Inspector ??
          form.unit1InspectorName ??
          form.sootUnit1Inspector
        ).slice(
          0,
          MAX_NAME_LENGTH
        ),

      unit2Inspector:
        normalizeText(
          form.unit2Inspector ??
          form.unit2InspectorName ??
          form.sootUnit2Inspector
        ).slice(
          0,
          MAX_NAME_LENGTH
        ),

      units: {
        unit1:
          unit1.items,
        unit2:
          unit2.items
      }
    }
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
        "Soot Blower 점검일지 데이터 형식이 올바르지 않습니다."
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

  const normalizedForm =
    normalizeFormData(
      rawLog.form ||
      rawLog.formData ||
      rawLog
    );

  if (
    normalizedForm.error
  ) {
    return normalizedForm;
  }

  const log = {
    id:
      normalizeText(
        rawLog.id
      ),
    inspectionDate,
    shift:
      SHIFT,
    schedule:
      SCHEDULE,
    formVersion:
      FORM_VERSION,
    status:
      normalizeLogStatus(
        rawLog.status
      ),
    form:
      normalizedForm.form
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
        "Soot Blower 점검일지 데이터가 너무 큽니다."
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

  const normalizedForm =
    normalizeFormData(
      storedLog.form ||
      storedLog.formData ||
      storedLog
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
      SHIFT,
    schedule:
      SCHEDULE,
    formVersion:
      FORM_VERSION,
    status:
      normalizeLogStatus(
        row.status
      ),
    form:
      normalizedForm.form ||
      normalizeFormData({}).form,
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
        FROM inspection_soot_blower_weekly_logs
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
        FROM inspection_soot_blower_weekly_logs
        WHERE
          inspection_date = ? AND
          shift = 'NS'
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
        inspection_soot_blower_weekly_history (
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


function validateOptionalDateParameter(
  value,
  label
) {
  if (
    value &&
    !isValidIsoDate(
      value
    )
  ) {
    return `${label} 올바르지 않습니다.`;
  }

  return "";
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

    const dateError =
      validateOptionalDateParameter(
        date,
        "조회할 점검일자가"
      ) ||
      validateOptionalDateParameter(
        from,
        "조회 시작일이"
      ) ||
      validateOptionalDateParameter(
        to,
        "조회 종료일이"
      );

    if (
      dateError
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            dateError
        },
        400
      );
    }

    if (
      from &&
      to &&
      from >
        to
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "조회 시작일은 종료일보다 늦을 수 없습니다."
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
            FROM inspection_soot_blower_weekly_history
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
        metadata:
          getFormMetadata()
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
        log:
          attachLogPermissions(
            log,
            user
          ),
        metadata:
          getFormMetadata()
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
        log:
          attachLogPermissions(
            log,
            user
          ),
        metadata:
          getFormMetadata()
      });
    }

    let queryText = `
      SELECT *
      FROM inspection_soot_blower_weekly_logs
      WHERE shift = 'NS'
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
      )
        .map(
          convertRowToLog
        )
        .map(
          log => {
            return attachLogPermissions(
              log,
              user
            );
          }
        );

    return jsonResponse({
      ok: true,
      logs,
      totalCount:
        logs.length,
      metadata:
        getFormMetadata()
    });

  } catch (
    error
  ) {
    console.error(
      "Soot Blower 점검일지 조회 오류:",
      error
    );

    return jsonResponse(
      {
        ok: false,
        message:
          "Soot Blower 점검일지를 불러오는 중 오류가 발생했습니다."
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
      existingLog &&
      existingLog.inspectionDate !==
        incomingLog.inspectionDate
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "저장된 점검일지의 점검일자는 변경할 수 없습니다."
        },
        400
      );
    }

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
        `soot-blower-weekly-${incomingLog.inspectionDate}-${crypto.randomUUID()}`;

      const newLog = {
        id,
        inspectionDate:
          incomingLog.inspectionDate,
        shift:
          SHIFT,
        schedule:
          SCHEDULE,
        formVersion:
          FORM_VERSION,
        status:
          incomingLog.status,
        form:
          incomingLog.form,
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
            inspection_soot_blower_weekly_logs (
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
          VALUES (?, ?, 'NS', ?, ?, ?, ?, 1, ?, ?, ?, ?)
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
            attachLogPermissions(
              savedLog,
              user
            ),
          metadata:
            getFormMetadata()
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
        attachLogPermissions(
          existingLog,
          user
        )
      );
    }

    const updatedLog = {
      ...existingLog,
      inspectionDate:
        existingLog.inspectionDate,
      shift:
        SHIFT,
      schedule:
        SCHEDULE,
      formVersion:
        FORM_VERSION,
      status:
        incomingLog.status,
      form:
        incomingLog.form,
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
    delete updatedLog.canDelete;

    const updateResult =
      await context.env.DB
        .prepare(`
          UPDATE
            inspection_soot_blower_weekly_logs
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
        attachLogPermissions(
          currentLog,
          user
        )
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
        attachLogPermissions(
          savedLog,
          user
        ),
      metadata:
        getFormMetadata()
    });

  } catch (
    error
  ) {
    console.error(
      "Soot Blower 점검일지 저장 오류:",
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
            ? "같은 날짜의 Soot Blower 점검일지가 이미 저장되어 있습니다. 최신 내용을 다시 불러와 주세요."
            : "Soot Blower 점검일지 저장 중 오류가 발생했습니다."
      },
      isUniqueConflict
        ? 409
        : 500
    );
  }
}


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
            "삭제할 점검일지 ID가 필요합니다."
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
      !canDeleteSootBlowerLog(
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
        attachLogPermissions(
          existingLog,
          user
        )
      );
    }

    const deleteResult =
      await context.env.DB
        .prepare(`
          DELETE FROM
            inspection_soot_blower_weekly_logs
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
        attachLogPermissions(
          currentLog,
          user
        )
      );
    }

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
        "Soot Blower 점검일지가 삭제되었습니다.",
      metadata:
        getFormMetadata()
    });

  } catch (
    error
  ) {
    console.error(
      "Soot Blower 점검일지 삭제 오류:",
      error
    );

    return jsonResponse(
      {
        ok: false,
        message:
          "Soot Blower 점검일지 삭제 중 오류가 발생했습니다."
      },
      500
    );
  }
}
