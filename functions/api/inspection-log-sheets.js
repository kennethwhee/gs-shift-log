/* =========================================================
  Log Sheet 공용 저장 API

  GET  /api/inspection-log-sheets
  POST /api/inspection-log-sheets

  핵심 규칙:
  - 로그인한 사용자만 조회·저장
  - 템플릿·시트·일자·근무·팀별 1건
  - 수정 가능한 셀은 서버 화이트리스트로 제한
  - 한 번의 POST로 전체 sparse values 저장
  - revision 동시 수정 충돌 방지
  - 저장할 때마다 수정 이력 보관
  - 폴링·자동 저장 없음
========================================================= */

const MAX_VALUES_JSON_BYTES =
  500000;

const MAX_CELL_COUNT =
  5000;

const MAX_CELL_TEXT_LENGTH =
  4000;

const MAX_HISTORY_RESULTS =
  100;


const LOGGING_INTERVAL_SHEET_KEYS =
  new Set([
    "integrated-tgo",
    "integrated-bco1",
    "integrated-bco2"
  ]);

const LOGGING_INTERVAL_HOURS =
  new Set([
    2,
    3,
    4,
    6
  ]);



/*
  5개 원본 Excel의 12개 표시 시트.

  allowedRanges는 사용자가 입력할 수 있는 영역만 나열한다.
  제목·항목·단위·시간 등 양식 고정 셀은 포함하지 않는다.
*/
const SHEET_DEFINITIONS =
  Object.freeze({
    "integrated-tgo": {
      templateKey:
        "integrated-control",
      worksheetName:
        "TGO",
      allowedRanges: [
        "R3",
        "T3",
        "R4",
        "T4",
        "S5",
        "J7:U54",
        "J58:U103",
        "J108:J119",
        "P108:P119"
      ]
    },

    "integrated-bco1": {
      templateKey:
        "integrated-control",
      worksheetName:
        "BCO1",
      allowedRanges: [
        "R3",
        "T3",
        "R4",
        "T4",
        "R5",
        "J7:U37",
        "J41:U85"
      ]
    },

    "integrated-bco2": {
      templateKey:
        "integrated-control",
      worksheetName:
        "BCO2",
      allowedRanges: [
        "R3",
        "T3",
        "R4",
        "T4",
        "R5",
        "J7:U46",
        "J50:U85"
      ]
    },

    "field-night-leader-to": {
      templateKey:
        "field",
      worksheetName:
        "파트장&TO (야간)",
      allowedRanges: [
        "B4",
        "M2",
        "M3",
        "J7:M35",
        "J37:M69",
        "J71:M105",
        "G108:G112",
        "K108:K112",
        "M108:M112"
      ]
    },

    "field-night-bo12": {
      templateKey:
        "field",
      worksheetName:
        "BO1&2 Night",
      allowedRanges: [
        "B4",
        "N2",
        "P2",
        "N3",
        "P3",
        "J7:Q34",
        "J36:K40",
        "P36:Q40",
        "J42:Q68",
        "H70:H77",
        "O70:O77",
        "J79:Q118"
      ]
    },

    "field-day-to": {
      templateKey:
        "field",
      worksheetName:
        "TO (주간)",
      allowedRanges: [
        "B4",
        "M2",
        "M3",
        "J7:M35",
        "J37:M69",
        "J71:M105"
      ]
    },

    "field-day-bo1": {
      templateKey:
        "field",
      worksheetName:
        "BO1",
      allowedRanges: [
        "B4",
        "M2",
        "M3",
        "J7:M34",
        "J36:M73",
        "J75:M88"
      ]
    },

    "field-day-bo2": {
      templateKey:
        "field",
      worksheetName:
        "BO2",
      allowedRanges: [
        "B4",
        "M2",
        "M3",
        "J7:M32",
        "J34:M69",
        "J71:M83"
      ]
    },

    "electrical-main": {
      templateKey:
        "electrical",
      worksheetName:
        "전기 Sheet",
      allowedRanges: [
        "R2",
        "R3",
        "O5",
        "S5",
        "J10:J47",
        "M10:M47",
        "P10:P47",
        "S10:S47"
      ]
    },

    "electrical-patrol": {
      templateKey:
        "electrical",
      worksheetName:
        "야간 순찰 점검일지 양식",
      allowedRanges: [
        "P2",
        "G3",
        "H3",
        "G4",
        "G6:H28",
        "B30"
      ]
    },

    "aux-control-room": {
      templateKey:
        "aux-boiler-control-room",
      worksheetName:
        "고압보조보일러 제어실",
      allowedRanges: [
        "A6",
        "P4",
        "R4",
        "P5",
        "R5",
        "H10:S41",
        "H45:S85"
      ]
    },

    "aux-field": {
      templateKey:
        "aux-boiler-field",
      worksheetName:
        "Aux Local",
      allowedRanges: [
        "A4",
        "N2",
        "P2",
        "N3",
        "P3",
        "G8:N46",
        "P9:R46"
      ]
    }
  });

/* 구형/간소화 URL 키도 동일한 시트로 정규화한다. */
const SHEET_KEY_ALIASES =
  Object.freeze({
    tgo:
      "integrated-tgo",
    bco1:
      "integrated-bco1",
    bco2:
      "integrated-bco2",
    "field-night-chief-to":
      "field-night-leader-to",
    "field-night-part-leader-to":
      "field-night-leader-to",
    "field-night-bo1-bo2":
      "field-night-bo12",
    "field-day-boiler1":
      "field-day-bo1",
    "field-day-boiler2":
      "field-day-bo2",
    electrical:
      "electrical-main",
    "elec-main":
      "electrical-main",
    "elec-patrol":
      "electrical-patrol",
    "aux-control":
      "aux-control-room",
    "aux-boiler-control-room":
      "aux-control-room",
    "aux-boiler-field":
      "aux-field",
    "aux-field":
      "aux-field"
  });

/*
  전기 야간 순찰의 랜덤 선택 결과.

  해당 셀은 사용자 입력값과 분리한 generatedValues로만
  저장하여 일반 편집에서 랜덤 결과를 바꾸지 못하게 한다.
*/
const GENERATED_VALUE_RANGES =
  Object.freeze({
    "electrical-patrol": [
      "D6",
      "D12",
      "D18",
      "D24",
      "F6:F28"
    ]
  });

const ELECTRICAL_PATROL_GENERATED_CELLS =
  Object.freeze([
    "D6",
    "D12",
    "D18",
    "D24",
    ...Array.from(
      {
        length: 23
      },
      (
        _unused,
        index
      ) => {
        return `F${index + 6}`;
      }
    )
  ]);


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
  const database =
    context.env.DB;

  if (
    !database
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
    await database
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
    await database
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

  await database
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
      employeeNo:
        normalizeEmployeeNo(
          session.employee_no
        ),
      name:
        normalizeText(
          session.name
        ),
      role:
        normalizeText(
          session.role
        ),
      position:
        normalizeText(
          session.position
        )
    }
  };
}

async function ensureSchema(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        inspection_log_sheet_records (
          id TEXT PRIMARY KEY,
          template_key TEXT NOT NULL,
          sheet_key TEXT NOT NULL,
          log_date TEXT NOT NULL,
          shift TEXT NOT NULL DEFAULT 'ALL',
          team TEXT NOT NULL DEFAULT '',
          values_json TEXT NOT NULL DEFAULT '{}',
          generated_values_json TEXT NOT NULL DEFAULT '{}',
          template_version_id TEXT NOT NULL DEFAULT '',
          template_snapshot_json TEXT NOT NULL DEFAULT '',
          revision INTEGER NOT NULL DEFAULT 1,
          created_by_id TEXT NOT NULL,
          created_by_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_by_id TEXT NOT NULL,
          updated_by_name TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
    `)
    .run();


  /* =======================================================
    기존 inspection_log_sheet_records 마이그레이션
  ======================================================= */

  const tableInfoResult =
    await database
      .prepare(`
        PRAGMA table_info(
          inspection_log_sheet_records
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
          column =>
            normalizeText(
              column?.name
            )
        )
        .filter(
          Boolean
        )
    );


  const addColumnIfMissing =
    async (
      columnName,
      columnSql
    ) => {
      if (
        existingColumns.has(
          columnName
        )
      ) {
        return;
      }

      try {
        await database
          .prepare(`
            ALTER TABLE
              inspection_log_sheet_records
            ADD COLUMN
              ${columnSql}
          `)
          .run();

        existingColumns.add(
          columnName
        );

      } catch (
        error
      ) {
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
    };


  await addColumnIfMissing(
    "generated_values_json",
    "generated_values_json TEXT NOT NULL DEFAULT '{}'"
  );


  await addColumnIfMissing(
    "template_version_id",
    "template_version_id TEXT NOT NULL DEFAULT ''"
  );


  await addColumnIfMissing(
    "template_snapshot_json",
    "template_snapshot_json TEXT NOT NULL DEFAULT ''"
  );


  /* =======================================================
    날짜별 Log Sheet 인덱스
  ======================================================= */

  await database
    .prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        idx_inspection_log_sheet_identity
      ON inspection_log_sheet_records (
        template_key,
        sheet_key,
        log_date,
        shift,
        team
      )
    `)
    .run();


  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_inspection_log_sheet_date
      ON inspection_log_sheet_records (
        log_date DESC,
        sheet_key
      )
    `)
    .run();


  /* =======================================================
    날짜별 Log Sheet 수정 이력
  ======================================================= */

  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        inspection_log_sheet_history (
          history_id TEXT PRIMARY KEY,
          record_id TEXT NOT NULL,
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
        idx_inspection_log_sheet_history_record
      ON inspection_log_sheet_history (
        record_id,
        revision DESC
      )
    `)
    .run();


  /* =======================================================
    공용 Log Sheet 양식 버전

    저장할 때 기존 버전을 수정하지 않고
    새로운 version_number를 생성한다.
  ======================================================= */

  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        inspection_log_sheet_template_versions (
          id TEXT PRIMARY KEY,
          template_key TEXT NOT NULL,
          sheet_key TEXT NOT NULL,
          sheet_name TEXT NOT NULL DEFAULT '',
          version_number INTEGER NOT NULL,
          items_json TEXT NOT NULL DEFAULT '[]',
          settings_json TEXT NOT NULL DEFAULT '{}',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_by_id TEXT NOT NULL,
          created_by_name TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
    `)
    .run();


  /* =======================================================
    기존 공용 양식 버전 테이블 마이그레이션
  ======================================================= */

  const templateTableInfoResult =
    await database
      .prepare(`
        PRAGMA table_info(
          inspection_log_sheet_template_versions
        )
      `)
      .all();

  const templateColumns =
    new Set(
      (
        Array.isArray(
          templateTableInfoResult.results
        )
          ? templateTableInfoResult.results
          : []
      )
        .map(
          column =>
            normalizeText(
              column?.name
            )
        )
        .filter(
          Boolean
        )
    );

  if (
    !templateColumns.has(
      "settings_json"
    )
  ) {
    try {
      await database
        .prepare(`
          ALTER TABLE
            inspection_log_sheet_template_versions
          ADD COLUMN
            settings_json TEXT NOT NULL DEFAULT '{}'
        `)
        .run();

    } catch (
      error
    ) {
      const message =
        String(
          error?.message ||
          error ||
          ""
        ).toLowerCase();

      if (
        !message.includes(
          "duplicate column"
        )
      ) {
        throw error;
      }
    }
  }



  await database
    .prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        idx_inspection_log_sheet_template_version
      ON inspection_log_sheet_template_versions (
        template_key,
        sheet_key,
        version_number
      )
    `)
    .run();


  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_inspection_log_sheet_template_active
      ON inspection_log_sheet_template_versions (
        template_key,
        sheet_key,
        is_active,
        version_number DESC
      )
    `)
    .run();
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


function normalizeSheetKey(
  value
) {
  const rawKey =
    normalizeText(
      value
    ).toLowerCase();

  const sheetKey =
    SHEET_KEY_ALIASES[
      rawKey
    ] ||
    rawKey;

  return SHEET_DEFINITIONS[
    sheetKey
  ]
    ? sheetKey
    : "";
}


function normalizeIdentityPart(
  value,
  fallback = "",
  maximumLength = 30
) {
  const text =
    normalizeText(
      value
    ) ||
    fallback;

  if (
    text.length >
      maximumLength ||
    /[\u0000-\u001f\u007f]/.test(
      text
    )
  ) {
    return "";
  }

  return text;
}


function columnLettersToNumber(
  letters
) {
  return [
    ...letters
  ].reduce(
    (
      total,
      letter
    ) => {
      return (
        total *
          26 +
        letter.charCodeAt(
          0
        ) -
          64
      );
    },
    0
  );
}


function parseCellAddress(
  value
) {
  const address =
    normalizeText(
      value
    )
      .replace(
        /\$/g,
        ""
      )
      .toUpperCase();

  const match =
    address.match(
      /^([A-Z]{1,3})([1-9]\d{0,5})$/
    );

  if (
    !match
  ) {
    return null;
  }

  return {
    address,
    column:
      columnLettersToNumber(
        match[1]
      ),
    row:
      Number(
        match[2]
      )
  };
}


function parseRange(
  value
) {
  const [
    startText,
    endText
  ] =
    normalizeText(
      value
    ).split(":");

  const start =
    parseCellAddress(
      startText
    );

  const end =
    parseCellAddress(
      endText ||
      startText
    );

  if (
    !start ||
    !end
  ) {
    return null;
  }

  return {
    firstColumn:
      Math.min(
        start.column,
        end.column
      ),
    lastColumn:
      Math.max(
        start.column,
        end.column
      ),
    firstRow:
      Math.min(
        start.row,
        end.row
      ),
    lastRow:
      Math.max(
        start.row,
        end.row
      )
  };
}


function isAllowedCellAddress(
  sheetKey,
  address
) {
  const cell =
    parseCellAddress(
      address
    );

  const definition =
    SHEET_DEFINITIONS[
      sheetKey
    ];

  if (
    !cell ||
    !definition
  ) {
    return false;
  }

  return definition.allowedRanges.some(
    rangeText => {
      const range =
        parseRange(
          rangeText
        );

      return Boolean(
        range &&
        cell.column >=
          range.firstColumn &&
        cell.column <=
          range.lastColumn &&
        cell.row >=
          range.firstRow &&
        cell.row <=
          range.lastRow
      );
    }
  );
}


function normalizeCellValue(
  value
) {
  if (
    value ===
      null
  ) {
    return "";
  }

  if (
    typeof value ===
      "number"
  ) {
    return Number.isFinite(
      value
    )
      ? value
      : undefined;
  }

  if (
    typeof value ===
      "boolean"
  ) {
    return value;
  }

  if (
    typeof value !==
      "string" ||
    value.length >
      MAX_CELL_TEXT_LENGTH
  ) {
    return undefined;
  }

  return value
    .replace(
      /\r\n/g,
      "\n"
    )
    .replace(
      /\r/g,
      "\n"
    );
}


function validateValues(
  sheetKey,
  rawValues
) {
  if (
    !rawValues ||
    typeof rawValues !==
      "object" ||
    Array.isArray(
      rawValues
    )
  ) {
    return {
      error:
        "Log Sheet 셀 데이터 형식이 올바르지 않습니다."
    };
  }

  const entries =
    Object.entries(
      rawValues
    );

  if (
    entries.length >
      MAX_CELL_COUNT
  ) {
    return {
      error:
        `한 번에 저장할 수 있는 셀은 ${MAX_CELL_COUNT}개입니다.`
    };
  }

  const values = {};

  for (
    const [
      rawAddress,
      rawValue
    ] of entries
  ) {
    const cell =
      parseCellAddress(
        rawAddress
      );

    if (
      !cell ||
      !isAllowedCellAddress(
        sheetKey,
        cell.address
      )
    ) {
      return {
        error:
          `수정할 수 없는 셀입니다: ${normalizeText(rawAddress) || "(주소 없음)"}`
      };
    }

    const value =
      normalizeCellValue(
        rawValue
      );

    if (
      value ===
        undefined
    ) {
      return {
        error:
          `셀 값 형식을 확인해 주세요: ${cell.address}`
      };
    }

    values[
      cell.address
    ] =
      value;
  }

  const valuesJson =
    JSON.stringify(
      values
    );

  if (
    new TextEncoder()
      .encode(
        valuesJson
      )
      .byteLength >
      MAX_VALUES_JSON_BYTES
  ) {
    return {
      error:
        "Log Sheet 입력 데이터가 너무 큽니다."
    };
  }

  return {
    values,
    valuesJson
  };
}


function validateGeneratedValues(
  sheetKey,
  rawValues,
  provided
) {
  if (
    !provided
  ) {
    return {
      provided: false,
      values: {},
      valuesJson:
        "{}"
    };
  }

  if (
    !rawValues ||
    typeof rawValues !==
      "object" ||
    Array.isArray(
      rawValues
    )
  ) {
    return {
      error:
        "Log Sheet 자동 생성 값 형식이 올바르지 않습니다."
    };
  }

  const allowedRanges =
    GENERATED_VALUE_RANGES[
      sheetKey
    ] ||
    [];

  const entries =
    Object.entries(
      rawValues
    );

  if (
    sheetKey ===
      "electrical-patrol" &&
    entries.length !==
      ELECTRICAL_PATROL_GENERATED_CELLS.length
  ) {
    return {
      error:
        "전기 야간 순찰의 자동 선택 결과 27개를 모두 저장해 주세요."
    };
  }

  if (
    entries.length >
      MAX_CELL_COUNT
  ) {
    return {
      error:
        `한 번에 저장할 수 있는 자동 생성 셀은 ${MAX_CELL_COUNT}개입니다.`
    };
  }

  const values = {};

  for (
    const [
      rawAddress,
      rawValue
    ] of entries
  ) {
    const cell =
      parseCellAddress(
        rawAddress
      );

    const allowed =
      Boolean(
        cell &&
        allowedRanges.some(
          rangeText => {
            const range =
              parseRange(
                rangeText
              );

            return Boolean(
              range &&
              cell.column >=
                range.firstColumn &&
              cell.column <=
                range.lastColumn &&
              cell.row >=
                range.firstRow &&
              cell.row <=
                range.lastRow
            );
          }
        )
      );

    if (
      !allowed
    ) {
      return {
        error:
          `저장할 수 없는 자동 생성 셀입니다: ${normalizeText(rawAddress) || "(주소 없음)"}`
      };
    }

    const value =
      normalizeCellValue(
        rawValue
      );

    if (
      value ===
        undefined
    ) {
      return {
        error:
          `자동 생성 셀 값을 확인해 주세요: ${cell.address}`
      };
    }

    values[
      cell.address
    ] =
      value;
  }

  const valuesJson =
    JSON.stringify(
      values
    );

  if (
    new TextEncoder()
      .encode(
        valuesJson
      )
      .byteLength >
      MAX_VALUES_JSON_BYTES
  ) {
    return {
      error:
        "Log Sheet 자동 생성 데이터가 너무 큽니다."
    };
  }

  return {
    provided: true,
    values,
    valuesJson
  };
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

function convertRowToRecord(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  const revision =
    Number(
      row.revision
    ) ||
    1;


  const templateVersionId =
    normalizeText(
      row.template_version_id
    );


  let templateSnapshot =
    null;


  const templateSnapshotText =
    normalizeText(
      row.template_snapshot_json
    );


  if (
    templateSnapshotText
  ) {
    try {
      const parsed =
        JSON.parse(
          templateSnapshotText
        );


      if (
        parsed &&
        typeof parsed ===
          "object" &&
        !Array.isArray(
          parsed
        )
      ) {
        templateSnapshot =
          parsed;
      }

    } catch (
      error
    ) {
      console.warn(
        "Log Sheet 양식 스냅샷 파싱 실패:",
        error
      );
    }
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    templateKey:
      normalizeText(
        row.template_key
      ),

    sheetKey:
      normalizeText(
        row.sheet_key
      ),

    logDate:
      normalizeText(
        row.log_date
      ),

    shift:
      normalizeText(
        row.shift
      ),

    team:
      normalizeText(
        row.team
      ),

    values:
      parseJsonObject(
        row.values_json
      ),

    generatedValues:
      parseJsonObject(
        row.generated_values_json
      ),


    /* 양식 버전 */

    templateVersionId,

    templateSnapshot,


    revision,

    serverRevision:
      revision,

    createdById:
      normalizeEmployeeNo(
        row.created_by_id
      ),

    createdByName:
      normalizeText(
        row.created_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedById:
      normalizeEmployeeNo(
        row.updated_by_id
      ),

    updatedByName:
      normalizeText(
        row.updated_by_name
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    source:
      "shared-d1"
  };
}

function createSheetResponseDefinition(
  sheetKey
) {
  const definition =
    SHEET_DEFINITIONS[
      sheetKey
    ];

  return {
    key:
      sheetKey,
    templateKey:
      definition.templateKey,
    worksheetName:
      definition.worksheetName,
    allowedRanges: [
      ...definition.allowedRanges
    ],
    generatedSnapshotRanges: [
      ...(
        GENERATED_VALUE_RANGES[
          sheetKey
        ] ||
        []
      )
    ]
  };
}


async function findRecordById(
  database,
  id
) {
  const row =
    await database
      .prepare(`
        SELECT *
        FROM inspection_log_sheet_records
        WHERE id = ?
        LIMIT 1
      `)
      .bind(
        id
      )
      .first();

  return convertRowToRecord(
    row
  );
}


async function findRecordByIdentity(
  database,
  identity
) {
  const row =
    await database
      .prepare(`
        SELECT *
        FROM inspection_log_sheet_records
        WHERE
          template_key = ? AND
          sheet_key = ? AND
          log_date = ? AND
          shift = ? AND
          team = ?
        LIMIT 1
      `)
      .bind(
        identity.templateKey,
        identity.sheetKey,
        identity.logDate,
        identity.shift,
        identity.team
      )
      .first();

  return convertRowToRecord(
    row
  );
}


async function getHistory(
  database,
  recordId,
  includeSnapshots
) {
  if (
    !recordId
  ) {
    return [];
  }

  const snapshotColumn =
    includeSnapshots
      ? ", snapshot_json"
      : "";

  const result =
    await database
      .prepare(`
        SELECT
          history_id,
          record_id,
          revision,
          action,
          changed_by_id,
          changed_by_name,
          changed_at
          ${snapshotColumn}
        FROM inspection_log_sheet_history
        WHERE record_id = ?
        ORDER BY revision DESC
        LIMIT ${MAX_HISTORY_RESULTS}
      `)
      .bind(
        recordId
      )
      .all();

  return (
    Array.isArray(
      result.results
    )
      ? result.results
      : []
  ).map(
    row => {
      const historyItem = {
        historyId:
          normalizeText(
            row.history_id
          ),
        recordId:
          normalizeText(
            row.record_id
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
      };

      if (
        includeSnapshots
      ) {
        historyItem.snapshot =
          parseJsonObject(
            row.snapshot_json
          );
      }

      return historyItem;
    }
  );
}


async function appendHistory(
  database,
  record,
  action,
  user
) {
  await database
    .prepare(`
      INSERT INTO
        inspection_log_sheet_history (
          history_id,
          record_id,
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
      record.id,
      record.revision,
      action,
      JSON.stringify(
        record
      ),
      user.employeeNo,
      user.name,
      new Date().toISOString()
    )
    .run();
}


function createConflictResponse(
  currentRecord
) {
  return jsonResponse(
    {
      ok: false,
      conflict: true,
      message:
        "다른 사용자가 먼저 Log Sheet를 수정했습니다. 최신 내용을 다시 불러와 주세요.",
      currentRecord
    },
    409
  );
}


function validateIdentity(
  source
) {
  const sheetKey =
    normalizeSheetKey(
      source.sheetKey ||
      source.type
    );

  if (
    !sheetKey
  ) {
    return {
      error:
        "Log Sheet 종류를 확인해 주세요."
    };
  }

  const definition =
    SHEET_DEFINITIONS[
      sheetKey
    ];

  const suppliedTemplateKey =
    normalizeText(
      source.templateKey
    );

  if (
    suppliedTemplateKey &&
    suppliedTemplateKey !==
      definition.templateKey
  ) {
    return {
      error:
        "Log Sheet 템플릿과 시트 정보가 일치하지 않습니다."
    };
  }

  const logDate =
    normalizeText(
      source.logDate ||
      source.date
    );

  if (
    !isValidIsoDate(
      logDate
    )
  ) {
    return {
      error:
        "Log Sheet 작성일을 확인해 주세요."
    };
  }

  const shift =
    normalizeIdentityPart(
      source.shift,
      "ALL"
    );

  const team =
    normalizeIdentityPart(
      source.team,
      ""
    );

  if (
    !shift ||
    source.team &&
    !team
  ) {
    return {
      error:
        "Log Sheet 근무 또는 팀 정보를 확인해 주세요."
    };
  }

  return {
    identity: {
      templateKey:
        definition.templateKey,
      sheetKey,
      logDate,
      shift,
      team
    }
  };
}

function normalizeLoggingTemplateMerge(
  value
) {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return null;
  }


  const startRow =
    Number(
      value.startRow
    );


  const endRow =
    Number(
      value.endRow
    );


  if (
    !Number.isInteger(
      startRow
    ) ||
    !Number.isInteger(
      endRow
    ) ||
    startRow <=
      0 ||
    endRow <
      startRow
  ) {
    return null;
  }


  const column =
    normalizeText(
      value.column
    )
      .toUpperCase()
      .replace(
        /[^A-Z]/g,
        ""
      )
      .slice(
        0,
        4
      );


  return {
    column,

    startRow,

    endRow,

    rowSpan:
      endRow -
      startRow +
      1
  };
}


function normalizeLoggingTemplateTextArray(
  value
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }


  return value
    .slice(
      0,
      8
    )
    .map(
      item =>
        normalizeText(
          item
        ).slice(
          0,
          MAX_CELL_TEXT_LENGTH
        )
    )
    .filter(Boolean);
}


function parseTemplateSettingsJson(
  value
) {
  try {
    const parsed =
      JSON.parse(
        String(
          value ||
          "{}"
        )
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

  } catch (
    error
  ) {
    console.warn(
      "Log Sheet 양식 settings_json 파싱 실패:",
      error
    );

    return {};
  }
}


function normalizeLoggingTemplateSettings(
  sheetKey,
  source
) {
  if (
    !LOGGING_INTERVAL_SHEET_KEYS.has(
      sheetKey
    )
  ) {
    return {};
  }

  const rawInterval =
    Number(
      source?.loggingIntervalHours ??
      2
    );

  if (
    !LOGGING_INTERVAL_HOURS.has(
      rawInterval
    )
  ) {
    return null;
  }

  const rawStartHour =
    Number(
      source?.loggingStartHour ??
      8
    );

  if (
    !Number.isInteger(
      rawStartHour
    ) ||
    rawStartHour <
      0 ||
    rawStartHour >
      23
  ) {
    return null;
  }

  return {
    loggingIntervalHours:
      rawInterval,

    loggingStartHour:
      rawStartHour
  };
}


function parseTemplateItemsJson(
  value
) {
  try {
    const parsed =
      JSON.parse(
        String(
          value || "[]"
        )
      );

    return Array.isArray(
      parsed
    )
      ? parsed
      : [];

  } catch (
    error
  ) {
    console.warn(
      "Log Sheet 양식 items_json 파싱 실패:",
      error
    );

    return [];
  }
}


async function findActiveTemplateVersion(
  database,
  templateKey,
  sheetKey
) {
  const normalizedTemplateKey =
    normalizeText(
      templateKey
    );

  const normalizedSheetKey =
    normalizeText(
      sheetKey
    );


  if (
    !normalizedTemplateKey ||
    !normalizedSheetKey
  ) {
    return null;
  }


  const row =
    await database
      .prepare(`
        SELECT
          id,
          template_key,
          sheet_key,
          sheet_name,
          version_number,
          items_json,
          settings_json,
          is_active,
          created_by_id,
          created_by_name,
          created_at

        FROM
          inspection_log_sheet_template_versions

        WHERE
          template_key = ?
          AND sheet_key = ?
          AND is_active = 1

        ORDER BY
          version_number DESC

        LIMIT 1
      `)
      .bind(
        normalizedTemplateKey,
        normalizedSheetKey
      )
      .first();


  if (!row) {
    return null;
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    templateKey:
      normalizeText(
        row.template_key
      ),

    sheetKey:
      normalizeText(
        row.sheet_key
      ),

    sheetName:
      normalizeText(
        row.sheet_name
      ),

    versionNumber:
      Number(
        row.version_number
      ) || 1,

    items:
      parseTemplateItemsJson(
        row.items_json
      ),

    settings:
      parseTemplateSettingsJson(
        row.settings_json
      ),

    isActive:
      Number(
        row.is_active
      ) === 1,

    createdById:
      normalizeEmployeeNo(
        row.created_by_id
      ),

    createdByName:
      normalizeText(
        row.created_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      )
  };
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

    await ensureSchema(
      context.env.DB
    );

    const requestUrl =
      new URL(
        context.request.url
      );


    /* =====================================================
      공용 Log Sheet 양식 조회
    ===================================================== */

    const mode =
      normalizeText(
        requestUrl.searchParams.get(
          "mode"
        )
      ).toLowerCase();


    if (
      mode === "template"
    ) {
      const templateKey =
        normalizeText(
          requestUrl.searchParams.get(
            "templateKey"
          )
        );

      const sheetKey =
        normalizeSheetKey(
          requestUrl.searchParams.get(
            "sheetKey"
          ) ||
          requestUrl.searchParams.get(
            "type"
          )
        );


      if (
        !templateKey
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "templateKey가 필요합니다."
          },
          400
        );
      }


      if (
        !sheetKey
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "sheetKey가 필요합니다."
          },
          400
        );
      }


      const template =
        await findActiveTemplateVersion(
          context.env.DB,
          templateKey,
          sheetKey
        );


      return jsonResponse({
        ok: true,

        template,

        sheet:
          createSheetResponseDefinition(
            sheetKey
          )
      });
    }


    /* =====================================================
      기존 날짜별 Log Sheet 조회
    ===================================================== */

    const id =
      normalizeText(
        requestUrl.searchParams.get(
          "id"
        )
      );

    const historyRequested =
      requestUrl.searchParams.get(
        "history"
      ) ===
        "1";

    let record =
      null;

    let sheetKey =
      "";


    if (
      id
    ) {
      record =
        await findRecordById(
          context.env.DB,
          id
        );

      if (
        !record
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "저장된 Log Sheet를 찾을 수 없습니다."
          },
          404
        );
      }

      sheetKey =
        normalizeSheetKey(
          record.sheetKey
        );

    } else {
      const validation =
        validateIdentity({
          sheetKey:
            requestUrl.searchParams.get(
              "sheetKey"
            ) ||
            requestUrl.searchParams.get(
              "type"
            ),

          templateKey:
            requestUrl.searchParams.get(
              "templateKey"
            ),

          logDate:
            requestUrl.searchParams.get(
              "logDate"
            ) ||
            requestUrl.searchParams.get(
              "date"
            ),

          shift:
            requestUrl.searchParams.get(
              "shift"
            ),

          team:
            requestUrl.searchParams.get(
              "team"
            )
        });


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


      sheetKey =
        validation.identity.sheetKey;


      record =
        await findRecordByIdentity(
          context.env.DB,
          validation.identity
        );
    }


    const history =
      await getHistory(
        context.env.DB,
        record?.id,
        historyRequested
      );


    return jsonResponse({
      ok: true,

      record,

      history,

      sheet:
        createSheetResponseDefinition(
          sheetKey
        )
    });

  } catch (
    error
  ) {
    console.error(
      "Log Sheet 조회 오류:",
      error
    );

    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "Log Sheet를 불러오는 중 오류가 발생했습니다."
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
            "저장 요청 데이터 형식이 올바르지 않습니다."
        },
        400
      );
    }


    /* =====================================================
      공용 Log Sheet 양식 저장
    ===================================================== */

    const mode =
      normalizeText(
        body?.mode
      ).toLowerCase();


    if (
      mode === "template"
    ) {
      const templateSource =
        body?.template &&
        typeof body.template ===
          "object"
          ? body.template
          : body;


      const templateKey =
        normalizeText(
          templateSource.templateKey ||
          body?.templateKey
        );


      const sheetKey =
        normalizeSheetKey(
          templateSource.sheetKey ||
          templateSource.type ||
          body?.sheetKey
        );


      const sheetName =
        normalizeText(
          templateSource.sheetName
        );


      const templateSettings =
        normalizeLoggingTemplateSettings(
          sheetKey,
          templateSource.settings
        );


      if (
        templateSettings ===
          null
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "로깅 시간 주기는 2·3·4·6시간, 시작 시간은 00~23시 범위에서 선택해 주세요."
          },
          400
        );
      }


      if (
        !templateKey
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "templateKey가 필요합니다."
          },
          400
        );
      }


      if (
        !sheetKey
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "sheetKey가 필요합니다."
          },
          400
        );
      }


      const rawItems =
        Array.isArray(
          templateSource.items
        )
          ? templateSource.items
          : [];


      if (
        rawItems.length === 0
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "저장할 Logging 항목이 없습니다."
          },
          400
        );
      }


      if (
        rawItems.length >
          MAX_CELL_COUNT
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "Logging 항목 수가 너무 많습니다."
          },
          400
        );
      }


      const items =
        rawItems
          .map(
            (
              rawItem,
              index
            ) => {
              const item =
                rawItem &&
                typeof rawItem ===
                  "object"
                  ? rawItem
                  : {};


              const name =
                normalizeText(
                  item.name
                ).slice(
                  0,
                  MAX_CELL_TEXT_LENGTH
                );


              const tag =
                normalizeText(
                  item.tag
                ).slice(
                  0,
                  MAX_CELL_TEXT_LENGTH
                );


              const unit =
                normalizeText(
                  item.unit
                ).slice(
                  0,
                  200
                );
              const group =
                normalizeText(
                  item.group
                ).slice(
                  0,
                  MAX_CELL_TEXT_LENGTH
                );


              const subgroup =
                normalizeText(
                  item.subgroup
                ).slice(
                  0,
                  MAX_CELL_TEXT_LENGTH
                );


              const subgroupParts =
                normalizeLoggingTemplateTextArray(
                  item.subgroupParts
                );


              const itemName =
                normalizeText(
                  item.itemName
                ).slice(
                  0,
                  MAX_CELL_TEXT_LENGTH
                );


              const rating =
                normalizeText(
                  item.rating
                ).slice(
                  0,
                  MAX_CELL_TEXT_LENGTH
                );


              const groupMerge =
                normalizeLoggingTemplateMerge(
                  item.groupMerge
                );


              const subgroupMerges =
                (
                  Array.isArray(
                    item.subgroupMerges
                  )
                    ? item.subgroupMerges
                    : []
                )
                  .slice(
                    0,
                    8
                  )
                  .map(
                    merge =>
                      normalizeLoggingTemplateMerge(
                        merge
                      )
                  )
                  .filter(Boolean);


              const key =
                normalizeText(
                  item.key
                ).slice(
                  0,
                  300
                ) ||
                `${sheetKey}-item-${index + 1}`;


              const insertAfterKey =
                normalizeText(
                  item.insertAfterKey
                ).slice(
                  0,
                  300
                );


              const rawSourceRow =
                Number(
                  item.sourceRow
                );


              const sourceRow =
                Number.isInteger(
                  rawSourceRow
                ) &&
                rawSourceRow >
                  0
                  ? rawSourceRow
                  : null;


              const rawSourceColumn =
                Number(
                  item.sourceColumn
                );


              const sourceColumn =
                Number.isInteger(
                  rawSourceColumn
                ) &&
                rawSourceColumn >=
                  0
                  ? rawSourceColumn
                  : null;


              return {
                key,

                order:
                  index + 1,

                name,

                tag,

                unit,

                group,

                subgroup,

                subgroupParts,

                itemName,

                rating,

                groupMerge,

                subgroupMerges,


                isNew:
                  item.isNew === true,

                sourceRow,

                sourceColumn,

                insertAfterKey:
                  insertAfterKey ||
                  null
              };
            }
          )
          .filter(
            item =>
              Boolean(
                item.name
              )
          );


      if (
        items.length === 0
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "유효한 Logging 항목이 없습니다."
          },
          400
        );
      }


      const itemsJson =
        JSON.stringify(
          items
        );


      const settingsJson =
        JSON.stringify(
          templateSettings ||
          {}
        );


      const itemsJsonBytes =
        new TextEncoder()
          .encode(
            itemsJson
          )
          .byteLength;


      if (
        itemsJsonBytes >
          MAX_VALUES_JSON_BYTES
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "Log Sheet 양식 데이터가 너무 큽니다."
          },
          400
        );
      }


      /* ---------------------------------------------------
        현재 활성 버전 확인
      --------------------------------------------------- */

      const currentTemplate =
        await findActiveTemplateVersion(
          context.env.DB,
          templateKey,
          sheetKey
        );


      const expectedVersionInput =
        body?.expectedVersion ??
        templateSource.expectedVersion;


      if (
        expectedVersionInput !==
          undefined &&
        expectedVersionInput !==
          null &&
        expectedVersionInput !==
          ""
      ) {
        const expectedVersion =
          Number(
            expectedVersionInput
          );


        if (
          !Number.isInteger(
            expectedVersion
          ) ||
          expectedVersion <
            0
        ) {
          return jsonResponse(
            {
              ok: false,
              message:
                "양식 버전 정보가 올바르지 않습니다."
            },
            400
          );
        }


        const currentVersion =
          Number(
            currentTemplate
              ?.versionNumber ||
            0
          );


        if (
          expectedVersion !==
          currentVersion
        ) {
          return jsonResponse(
            {
              ok: false,

              conflict: true,

              message:
                "다른 사용자가 먼저 Log Sheet 양식을 수정했습니다. 최신 양식을 다시 불러와 주세요.",

              template:
                currentTemplate
            },
            409
          );
        }
      }


      /* ---------------------------------------------------
        전체 버전 중 다음 번호 계산
      --------------------------------------------------- */

      const versionRow =
        await context.env.DB
          .prepare(`
            SELECT
              COALESCE(
                MAX(version_number),
                0
              ) AS max_version

            FROM
              inspection_log_sheet_template_versions

            WHERE
              template_key = ?
              AND sheet_key = ?
          `)
          .bind(
            templateKey,
            sheetKey
          )
          .first();


      const nextVersionNumber =
        Number(
          versionRow?.max_version ||
          0
        ) +
        1;


      const templateId =
        `inspection-log-sheet-template-${crypto.randomUUID()}`;


      const now =
        new Date()
          .toISOString();


      try {
        await context.env.DB.batch([
          context.env.DB
            .prepare(`
              UPDATE
                inspection_log_sheet_template_versions

              SET
                is_active = 0

              WHERE
                template_key = ?
                AND sheet_key = ?
                AND is_active = 1
            `)
            .bind(
              templateKey,
              sheetKey
            ),


          context.env.DB
            .prepare(`
              INSERT INTO
                inspection_log_sheet_template_versions (
                  id,
                  template_key,
                  sheet_key,
                  sheet_name,
                  version_number,
                  items_json,
                  settings_json,
                  is_active,
                  created_by_id,
                  created_by_name,
                  created_at
                )

              VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,

                1,
                ?,
                ?,
                ?
              )
            `)
            .bind(
              templateId,
              templateKey,
              sheetKey,
              sheetName,
              nextVersionNumber,
              itemsJson,
              settingsJson,

              user.employeeNo,
              user.name,
              now
            )
        ]);

      } catch (
        error
      ) {
        if (
          /UNIQUE constraint failed/i.test(
            String(
              error
            )
          )
        ) {
          return jsonResponse(
            {
              ok: false,

              conflict: true,

              message:
                "다른 사용자가 먼저 Log Sheet 양식을 저장했습니다. 최신 양식을 다시 불러와 주세요.",

              template:
                await findActiveTemplateVersion(
                  context.env.DB,
                  templateKey,
                  sheetKey
                )
            },
            409
          );
        }

        throw error;
      }


      const savedTemplate =
        await findActiveTemplateVersion(
          context.env.DB,
          templateKey,
          sheetKey
        );


      return jsonResponse(
        {
          ok: true,

          created: true,

          template:
            savedTemplate,

          sheet:
            createSheetResponseDefinition(
              sheetKey
            )
        },
        201
      );
    }


    /* =====================================================
      기존 날짜별 Log Sheet 저장
    ===================================================== */

    const source =
      body?.record &&
      typeof body.record ===
        "object"
        ? {
            ...body,
            ...body.record
          }
        : body;


    const identityValidation =
      validateIdentity(
        source ||
        {}
      );


    if (
      identityValidation.error
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            identityValidation.error
        },
        400
      );
    }


    const identity =
      identityValidation.identity;


    const valuesValidation =
      validateValues(
        identity.sheetKey,
        source.values ||
        source.cells
      );


    if (
      valuesValidation.error
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            valuesValidation.error
        },
        400
      );
    }


    const generatedValuesProvided =
      Object.prototype
        .hasOwnProperty.call(
          source,
          "generatedValues"
        );


    const generatedValuesValidation =
      validateGeneratedValues(
        identity.sheetKey,
        source.generatedValues,
        generatedValuesProvided
      );


    if (
      generatedValuesValidation.error
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            generatedValuesValidation.error
        },
        400
      );
    }


    const expectedRevisionInput =
      body?.expectedRevision ??
      source.expectedRevision ??
      source.revision ??
      source.serverRevision ??
      0;


    const expectedRevision =
      Number(
        expectedRevisionInput
      );


    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision <
        0
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "Log Sheet revision을 확인해 주세요."
        },
        400
      );
    }


    const suppliedId =
      normalizeText(
        source.id
      );


    let existingRecord =
      suppliedId
        ? await findRecordById(
            context.env.DB,
            suppliedId
          )
        : null;


    if (
      existingRecord &&
      (
        existingRecord.templateKey !==
          identity.templateKey ||

        existingRecord.sheetKey !==
          identity.sheetKey ||

        existingRecord.logDate !==
          identity.logDate ||

        existingRecord.shift !==
          identity.shift ||

        existingRecord.team !==
          identity.team
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "저장된 Log Sheet의 날짜·근무·팀 정보는 변경할 수 없습니다."
        },
        400
      );
    }


    if (
      !existingRecord
    ) {
      existingRecord =
        await findRecordByIdentity(
          context.env.DB,
          identity
        );
    }


    /* =====================================================
      전기 일간 순찰 예외처리
    ===================================================== */

    if (
      identity.sheetKey ===
        "electrical-patrol"
    ) {
      if (
        !existingRecord &&
        !generatedValuesValidation.provided
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              "전기 일간 순찰은 자동 선택 결과를 함께 저장해 주세요."
          },
          400
        );
      }


      if (
        existingRecord
      ) {
        const previousPart =
          existingRecord.values?.P2 ??
          3;


        const incomingPart =
          valuesValidation.values.P2 ??
          3;


        if (
          String(
            previousPart
          ) !==
            String(
              incomingPart
            ) &&
          !generatedValuesValidation.provided
        ) {
          return jsonResponse(
            {
              ok: false,
              message:
                "파트를 변경하면 새로 선택된 순찰 결과를 함께 저장해야 합니다."
            },
            400
          );
        }
      }
    }


    const now =
      new Date()
        .toISOString();


/* =====================================================
  신규 날짜별 기록
===================================================== */

if (
  !existingRecord
) {
  if (
    Number.isFinite(
      expectedRevision
    ) &&
    expectedRevision >
      0
  ) {
    return createConflictResponse(
      null
    );
  }


  /* ===================================================
    현재 활성 공용 양식 고정
  =================================================== */

  const activeTemplate =
    await findActiveTemplateVersion(
      context.env.DB,
      identity.templateKey,
      identity.sheetKey
    );


  const templateVersionId =
    normalizeText(
      activeTemplate?.id
    );


  const templateSnapshotJson =
    activeTemplate
      ? JSON.stringify(
          activeTemplate
        )
      : "";


  /* ===================================================
    신규 Log Sheet 기록 생성
  =================================================== */

  const id =
    `inspection-log-sheet-${crypto.randomUUID()}`;


  try {
    await context.env.DB
      .prepare(`
        INSERT INTO
          inspection_log_sheet_records (
            id,
            template_key,
            sheet_key,
            log_date,
            shift,
            team,
            values_json,
            generated_values_json,
            template_version_id,
            template_snapshot_json,
            revision,
            created_by_id,
            created_by_name,
            created_at,
            updated_by_id,
            updated_by_name,
            updated_at
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
          1,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
      `)
      .bind(
        id,
        identity.templateKey,
        identity.sheetKey,
        identity.logDate,
        identity.shift,
        identity.team,
        valuesValidation.valuesJson,
        generatedValuesValidation.valuesJson,
        templateVersionId,
        templateSnapshotJson,
        user.employeeNo,
        user.name,
        now,
        user.employeeNo,
        user.name,
        now
      )
      .run();

  } catch (
    error
  ) {
    if (
      /UNIQUE constraint failed/i.test(
        String(
          error
        )
      )
    ) {
      const currentRecord =
        await findRecordByIdentity(
          context.env.DB,
          identity
        );

      return createConflictResponse(
        currentRecord
      );
    }

    throw error;
  }


  const savedRecord =
    await findRecordById(
      context.env.DB,
      id
    );


  await appendHistory(
    context.env.DB,
    savedRecord,
    "생성",
    user
  );


  return jsonResponse(
    {
      ok: true,

      created: true,

      record:
        savedRecord,

      history:
        await getHistory(
          context.env.DB,
          id,
          false
        ),

      sheet:
        createSheetResponseDefinition(
          identity.sheetKey
        )
    },
    201
  );
}

    /* =====================================================
      기존 날짜별 기록 수정
    ===================================================== */

    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision <
        1 ||
      expectedRevision !==
        existingRecord.revision
    ) {
      return createConflictResponse(
        existingRecord
      );
    }


    const updateResult =
      await context.env.DB
        .prepare(`
          UPDATE
            inspection_log_sheet_records

          SET
            values_json = ?,
            generated_values_json = ?,
            revision = revision + 1,
            updated_by_id = ?,
            updated_by_name = ?,
            updated_at = ?

          WHERE
            id = ?
            AND revision = ?
        `)
        .bind(
          valuesValidation.valuesJson,

          generatedValuesValidation.provided
            ? generatedValuesValidation.valuesJson
            : JSON.stringify(
                existingRecord.generatedValues ||
                {}
              ),

          user.employeeNo,
          user.name,
          now,
          existingRecord.id,
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
      return createConflictResponse(
        await findRecordById(
          context.env.DB,
          existingRecord.id
        )
      );
    }


    const savedRecord =
      await findRecordById(
        context.env.DB,
        existingRecord.id
      );


    await appendHistory(
      context.env.DB,
      savedRecord,
      "수정",
      user
    );


    return jsonResponse({
      ok: true,

      created: false,

      record:
        savedRecord,

      history:
        await getHistory(
          context.env.DB,
          savedRecord.id,
          false
        ),

      sheet:
        createSheetResponseDefinition(
          identity.sheetKey
        )
    });

  } catch (
    error
  ) {
    console.error(
      "Log Sheet 저장 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "Log Sheet를 저장하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}