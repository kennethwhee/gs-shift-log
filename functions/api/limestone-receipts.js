"use strict";


/* =========================================================
  효율팀 석회석 입고기록 공용 API

  경로:
  functions/api/limestone-receipts.js

  API:
  GET    /api/limestone-receipts
  POST   /api/limestone-receipts
  PUT    /api/limestone-receipts
  DELETE /api/limestone-receipts?id=기록ID

  권한:
  - 모든 로그인 사용자 조회 가능
  - 모든 로그인 사용자 신규 등록 가능
  - 모든 로그인 사용자 수정·삭제 가능

  집계:
  - 전체 입고량
  - 1호기 입고량
  - 2호기 입고량
  - 입고 횟수
  - 일자별·호기별 입고량
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const MAXIMUM_QUERY_DAYS =
  366;


const MAXIMUM_QUERY_ROWS =
  5000;


const MAXIMUM_BULK_IMPORT_ITEMS =
  200;


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
    role === "super_admin" ||
    role === "superadmin"
  ) {
    return "super_admin";
  }


  if (
    role === "admin" ||
    role === "leader"
  ) {
    return "admin";
  }


  return "user";
}


/* =========================================================
  로그인 세션 확인
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
    .join("");
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
  날짜·시간 검증
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


function isValidTime(
  value
) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(
    normalizeText(
      value
    )
  );
}


function addIsoDateDays(
  dateValue,
  dayCount
) {
  const parsedDate =
    new Date(
      `${dateValue}T00:00:00.000Z`
    );


  parsedDate.setUTCDate(
    parsedDate.getUTCDate() +
    dayCount
  );


  return parsedDate
    .toISOString()
    .slice(
      0,
      10
    );
}


function getKoreaToday() {
  const koreaTime =
    new Date(
      Date.now() +
      (
        9 *
        60 *
        60 *
        1000
      )
    );


  return koreaTime
    .toISOString()
    .slice(
      0,
      10
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


/* =========================================================
  호기·수량 정리
========================================================= */

function normalizeUnitNo(
  value,
  allowEmpty = false
) {
  if (
    allowEmpty &&
    (
      value === "" ||
      value === null ||
      value === undefined
    )
  ) {
    return null;
  }


  const unitNo =
    Number(
      value
    );


  return (
    Number.isInteger(
      unitNo
    ) &&
    [
      1,
      2
    ].includes(
      unitNo
    )
  )
    ? unitNo
    : null;
}


function normalizeQuantity(
  value
) {
  const quantity =
    Number(
      value
    );


  if (
    !Number.isFinite(
      quantity
    )
  ) {
    return null;
  }


  const roundedQuantity =
    Math.round(
      quantity *
      100
    ) /
    100;


  return (
    roundedQuantity >=
      0.01 &&
    roundedQuantity <=
      999.99
  )
    ? roundedQuantity
    : null;
}


function roundQuantity(
  value
) {
  return (
    Math.round(
      (
        Number(
          value
        ) ||
        0
      ) *
      100
    ) /
    100
  );
}


/* =========================================================
  업무일지 원본 보직 최종 정규화

  1호기:
  - BCO1
  - BO1

  2호기:
  - BCO2
  - BO2
========================================================= */

function normalizeSourceRole(
  value
) {
  const role =
    normalizeText(
      value
    )
      .toUpperCase()
      .replace(
        /\s+/g,
        ""
      );


  const validRoles = [
    "BCO1",
    "BO1",
    "BCO2",
    "BO2"
  ];


  return validRoles.includes(
    role
  )
    ? role
    : "";
}


/* =========================================================
  DB 행 → 화면 데이터
========================================================= */

function convertReceiptRow(
  row
) {
  return {
    id:
      normalizeText(
        row.id
      ),

    receiptDate:
      normalizeText(
        row.receipt_date
      ),

    receiptTime:
      normalizeText(
        row.receipt_time
      ),

    unitNo:
      Number(
        row.unit_no
      ),

    quantityTon:
      roundQuantity(
        row.quantity_ton
      ),

    note:
      normalizeText(
        row.note
      ),

    sourceType:
      normalizeText(
        row.source_type
      ),

    sourceLogId:
      normalizeText(
        row.source_log_id
      ),

    sourceEntryId:
      normalizeText(
        row.source_entry_id
      ),

    sourceKey:
      normalizeText(
        row.source_key
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
  기록 조회
========================================================= */

/* =========================================================
  입고 변경 → 저장된 Limestone 사용량 즉시 동기화

  대상:
  - limestone_usage_records
  - auxiliary_material_daily

  보호:
  - calculation_mode = manual 은 자동 덮어쓰기 금지
========================================================= */

function normalizeReceiptLinkedUsageNumber(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const correction =
    Math.sign(numericValue) * 0.000000001;

  return (
    Math.trunc(
      (numericValue + correction) * 100
    ) / 100
  );
}


async function synchronizeStoredLimestoneUsageAfterReceiptChange(
  database,
  receiptDate,
  unitNo,
  user
) {
  const normalizedDate =
    normalizeText(receiptDate);

  const normalizedUnitNo =
    normalizeUnitNo(unitNo);

  if (
    !database ||
    !isValidIsoDate(normalizedDate) ||
    normalizedUnitNo === null
  ) {
    return {
      ok: false,
      skipped: true,
      reason: "invalid_target"
    };
  }

  try {
    const usageRow =
      await database
        .prepare(`
          SELECT
            id,
            start_stock,
            receipt_quantity,
            end_stock,
            usage_quantity,
            calculation_mode

          FROM limestone_usage_records

          WHERE
            usage_date = ?
            AND unit_no = ?

          LIMIT 1
        `)
        .bind(
          normalizedDate,
          normalizedUnitNo
        )
        .first();

    /*
      아직 OIS 사용량 자체가 없는 날짜면
      입고기록만 저장하고 종료한다.
    */
    if (!usageRow) {
      return {
        ok: true,
        skipped: true,
        reason: "usage_record_missing"
      };
    }

    const calculationMode =
      normalizeText(
        usageRow.calculation_mode
      ).toLowerCase();

    /*
      사람이 부재료에서 직접 수정한 값 보호
    */
    if (calculationMode === "manual") {
      return {
        ok: true,
        skipped: true,
        reason: "manual_protected"
      };
    }

    const startStock =
      Number(usageRow.start_stock);

    const endStock =
      Number(usageRow.end_stock);

    if (
      !Number.isFinite(startStock) ||
      !Number.isFinite(endStock)
    ) {
      return {
        ok: true,
        skipped: true,
        reason: "stock_missing"
      };
    }

    const receiptRow =
      await database
        .prepare(`
          SELECT
            COALESCE(
              SUM(quantity_ton),
              0
            ) AS total_quantity

          FROM limestone_receipts

          WHERE
            receipt_date = ?
            AND unit_no = ?
        `)
        .bind(
          normalizedDate,
          normalizedUnitNo
        )
        .first();

    const receiptQuantity =
      normalizeReceiptLinkedUsageNumber(
        receiptRow?.total_quantity || 0
      );

    const usageQuantity =
      normalizeReceiptLinkedUsageNumber(
        startStock +
        receiptQuantity -
        endStock
      );

    if (
      receiptQuantity === null ||
      usageQuantity === null
    ) {
      return {
        ok: false,
        skipped: true,
        reason: "calculation_failed"
      };
    }

    const now =
      new Date().toISOString();

    const employeeNo =
      normalizeEmployeeNo(
        user?.employeeNo
      );

    const userName =
      normalizeText(
        user?.name
      );

    await database
      .prepare(`
        UPDATE limestone_usage_records

        SET
          receipt_quantity = ?,
          usage_quantity = ?,

          updated_by_id = ?,
          updated_by_name = ?,
          updated_at = ?,

          revision = revision + 1

        WHERE
          usage_date = ?
          AND unit_no = ?
          AND LOWER(
            COALESCE(calculation_mode, '')
          ) <> 'manual'
      `)
      .bind(
        receiptQuantity,
        usageQuantity,

        employeeNo,
        userName,
        now,

        normalizedDate,
        normalizedUnitNo
      )
      .run();

    /*
      부재료 행도 존재하면 같은 값으로 맞춘다.
      행을 새로 만들지는 않는다.
    */
    try {
      await database
        .prepare(`
          UPDATE auxiliary_material_daily

          SET
            limestone_receipt_ton = ?,
            limestone_usage_tpd = ?,

            updated_by_id = ?,
            updated_by_name = ?,
            updated_at = ?,

            revision = revision + 1

          WHERE
            record_date = ?
            AND unit_no = ?
        `)
        .bind(
          receiptQuantity,
          usageQuantity,

          employeeNo,
          userName,
          now,

          normalizedDate,
          normalizedUnitNo
        )
        .run();

    } catch (error) {
      const message =
        normalizeText(
          error instanceof Error
            ? error.message
            : error
        );

      /*
        부재료 테이블을 아직 만들지 않은 환경만 허용
      */
      if (!/no such table/i.test(message)) {
        throw error;
      }
    }

    return {
      ok: true,
      updated: true,
      receiptDate: normalizedDate,
      unitNo: normalizedUnitNo,
      receiptQuantity,
      usageQuantity,
      calculationMode
    };

  } catch (error) {
    console.error(
      "석회석 입고 변경 후 사용량 동기화 실패:",
      normalizedDate,
      normalizedUnitNo,
      error
    );

    return {
      ok: false,
      skipped: false,
      message:
        error instanceof Error
          ? error.message
          : "사용량 동기화 실패"
    };
  }
}

async function findReceiptById(
  database,
  receiptId
) {
  const row =
    await database
      .prepare(`
        SELECT
          *

        FROM limestone_receipts

        WHERE id = ?

        LIMIT 1
      `)
      .bind(
        receiptId
      )
      .first();


  return row
    ? convertReceiptRow(
        row
      )
    : null;
}


/* =========================================================
  수정·삭제 권한

  - 모든 로그인 사용자
  - 실제 로그인 세션은 각 PUT·DELETE 시작에서 검증
========================================================= */

function canManageReceipt(
  receipt,
  user
) {
  return Boolean(
    normalizeEmployeeNo(
      user?.employeeNo
    )
  );
}


/* =========================================================
  직접 입력값 검증
========================================================= */

function validateManualReceiptInput(
  body
) {
  const receiptDate =
    normalizeText(
      body.receiptDate ||
      body.receipt_date
    );


  const receiptTime =
    normalizeText(
      body.receiptTime ||
      body.receipt_time
    );


  const unitNo =
    normalizeUnitNo(
      body.unitNo ??
      body.unit_no
    );


  const quantityTon =
    normalizeQuantity(
      body.quantityTon ??
      body.quantity_ton
    );


  const note =
    normalizeText(
      body.note
    );


  if (
    !isValidIsoDate(
      receiptDate
    )
  ) {
    return {
      error:
        "입고일자를 확인해 주세요."
    };
  }


  if (
    !isValidTime(
      receiptTime
    )
  ) {
    return {
      error:
        "입고시간을 확인해 주세요."
    };
  }


  if (
    unitNo ===
      null
  ) {
    return {
      error:
        "1호기 또는 2호기를 선택해 주세요."
    };
  }


  if (
    quantityTon ===
      null
  ) {
    return {
      error:
        "입고량은 0.01~999.99 ton 범위로 입력해 주세요."
    };
  }


  if (
    note.length >
      200
  ) {
    return {
      error:
        "비고는 200자 이하로 입력해 주세요."
    };
  }


  return {
    receipt: {
      receiptDate,
      receiptTime,
      unitNo,
      quantityTon,
      note
    }
  };
}

/* =========================================================
  업무일지 가져오기 항목 검증 최종본

  허용 보직:
  - BCO1 → 1호기
  - BO1  → 1호기
  - BCO2 → 2호기
  - BO2  → 2호기

  호기는 화면에서 전달된 값보다
  원본 보직 기준을 우선한다.
========================================================= */

function validateImportedReceiptInput(
  rawItem
) {
  const manualValidation =
    validateManualReceiptInput(
      rawItem
    );


  if (
    manualValidation.error
  ) {
    return manualValidation;
  }


  const sourceRole =
    normalizeSourceRole(
      rawItem.sourceRole ||
      rawItem.source_role
    );


  if (
    !sourceRole
  ) {
    return {
      error:
        "업무일지 원본 보직은 BCO1·BO1·BCO2·BO2 중 하나여야 합니다."
    };
  }


  /* =====================================================
    원본 보직 → 호기

    1호기:
    BCO1, BO1

    2호기:
    BCO2, BO2
  ====================================================== */

  const unitNo =
    [
      "BCO1",
      "BO1"
    ].includes(
      sourceRole
    )
      ? 1
      : 2;


  const sourceLogId =
    normalizeText(
      rawItem.sourceLogId ||
      rawItem.source_log_id
    );


  const sourceEntryId =
    normalizeText(
      rawItem.sourceEntryId ||
      rawItem.source_entry_id
    );


  if (
    !sourceLogId ||
    !sourceEntryId
  ) {
    return {
      error:
        "업무일지 원본 ID 또는 항목 ID를 확인할 수 없습니다."
    };
  }


  const sourceKey =
    normalizeText(
      rawItem.sourceKey ||
      rawItem.source_key
    ) ||
    [
      sourceLogId,
      sourceEntryId
    ].join(
      "||"
    );


  if (
    sourceKey.length >
      500
  ) {
    return {
      error:
        "업무일지 중복 확인 키가 너무 깁니다."
    };
  }


  const sourceAuthor =
    normalizeText(
      rawItem.sourceAuthor ||
      rawItem.source_author
    ).slice(
      0,
      100
    );


  const sourceText =
    normalizeText(
      rawItem.sourceText ||
      rawItem.source_text
    ).slice(
      0,
      1000
    );


  return {
    receipt: {
      ...manualValidation.receipt,

      /*
        화면에서 잘못된 호기가 전달되어도
        원본 보직에 맞게 다시 지정한다.
      */
      unitNo,

      sourceRole,

      sourceLogId,

      sourceEntryId,

      sourceKey,

      sourceAuthor,

      sourceText
    }
  };
}


/* =========================================================
  조회 결과 집계
========================================================= */

function createReceiptSummary(
  receipts
) {
  const dailyMap =
    new Map();


  let unitOneQuantity =
    0;


  let unitTwoQuantity =
    0;


  receipts.forEach(
    receipt => {
      const quantity =
        Number(
          receipt.quantityTon
        ) ||
        0;


      if (
        receipt.unitNo ===
          1
      ) {
        unitOneQuantity +=
          quantity;

      } else if (
        receipt.unitNo ===
          2
      ) {
        unitTwoQuantity +=
          quantity;
      }


      if (
        !dailyMap.has(
          receipt.receiptDate
        )
      ) {
        dailyMap.set(
          receipt.receiptDate,
          {
            date:
              receipt.receiptDate,

            unitOneQuantity:
              0,

            unitTwoQuantity:
              0,

            totalQuantity:
              0,

            receiptCount:
              0
          }
        );
      }


      const dailyItem =
        dailyMap.get(
          receipt.receiptDate
        );


      if (
        receipt.unitNo ===
          1
      ) {
        dailyItem
          .unitOneQuantity +=
          quantity;

      } else {
        dailyItem
          .unitTwoQuantity +=
          quantity;
      }


      dailyItem.totalQuantity +=
        quantity;


      dailyItem.receiptCount +=
        1;
    }
  );


  const dailySummary = [
    ...dailyMap.values()
  ]
    .map(
      item => {
        return {
          ...item,

          unitOneQuantity:
            roundQuantity(
              item.unitOneQuantity
            ),

          unitTwoQuantity:
            roundQuantity(
              item.unitTwoQuantity
            ),

          totalQuantity:
            roundQuantity(
              item.totalQuantity
            )
        };
      }
    )
    .sort(
      (
        firstItem,
        secondItem
      ) => {
        return secondItem
          .date
          .localeCompare(
            firstItem.date
          );
      }
    );


  return {
    summary: {
      totalQuantity:
        roundQuantity(
          unitOneQuantity +
          unitTwoQuantity
        ),

      unitOneQuantity:
        roundQuantity(
          unitOneQuantity
        ),

      unitTwoQuantity:
        roundQuantity(
          unitTwoQuantity
        ),

      receiptCount:
        receipts.length
    },

    dailySummary
  };
}


/* =========================================================
  GET /api/limestone-receipts

  예:
  ?startDate=2026-08-01
  &endDate=2026-08-07
  &unitNo=1
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


    const today =
      getKoreaToday();


    const startDate =
      normalizeText(
        requestUrl
          .searchParams
          .get(
            "startDate"
          )
      ) ||
      addIsoDateDays(
        today,
        -6
      );


    const endDate =
      normalizeText(
        requestUrl
          .searchParams
          .get(
            "endDate"
          )
      ) ||
      today;


    const unitNo =
      normalizeUnitNo(
        requestUrl
          .searchParams
          .get(
            "unitNo"
          ),
        true
      );


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
        1
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "조회 시작일은 종료일보다 늦을 수 없습니다."
        },
        400
      );
    }


    if (
      dayCount >
        MAXIMUM_QUERY_DAYS
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            `석회석 입고기록은 한 번에 최대 ${MAXIMUM_QUERY_DAYS}일까지 조회할 수 있습니다.`
        },
        400
      );
    }


    const conditions = [
      "receipt_date >= ?",
      "receipt_date <= ?"
    ];


    const bindings = [
      startDate,
      endDate
    ];


    if (
      unitNo !==
        null
    ) {
      conditions.push(
        "unit_no = ?"
      );


      bindings.push(
        unitNo
      );
    }


    const query = `
      SELECT
        *

      FROM limestone_receipts

      WHERE
        ${conditions.join(
          "\n        AND "
        )}

      ORDER BY
        receipt_date DESC,
        receipt_time DESC,
        created_at DESC

      LIMIT ${MAXIMUM_QUERY_ROWS}
    `;


    const queryResult =
      await context.env.DB
        .prepare(
          query
        )
        .bind(
          ...bindings
        )
        .all();


    const receipts =
      (
        Array.isArray(
          queryResult.results
        )
          ? queryResult.results
          : []
      ).map(
        convertReceiptRow
      );


    const {
      summary,
      dailySummary
    } =
      createReceiptSummary(
        receipts
      );


    return jsonResponse({
      ok:
        true,

      range: {
        startDate,
        endDate,
        dayCount,
        unitNo
      },

      summary,

      dailySummary,

      items:
        receipts
    });

  } catch (
    error
  ) {
    console.error(
      "석회석 입고기록 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "석회석 입고기록을 조회하지 못했습니다."
      },
      500
    );
  }
}


/* =========================================================
  POST /api/limestone-receipts 최종본

  직접 등록:
  - 효율팀 석회석 메뉴에서 수기 등록

  업무일지 최신화:
  - BCO1·BO1 → 1호기
  - BCO2·BO2 → 2호기

  상·하위 우선순위:
  - BCO1 > BO1
  - BCO2 > BO2

  처리:
  - 저장된 업무일지라면 결재 상태와 관계없이 등록
  - 같은 실제 입고는 한 건만 유지
  - 하위 보직 기록이 먼저 있으면 상위 보직으로 교체
  - 수기 등록 기록은 자동 삭제·교체하지 않음
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


    const body =
      await readJsonBody(
        context.request
      );


    const action =
      normalizeText(
        body.action
      )
        .toLowerCase()
        .replace(
          /[\s-]+/g,
          "_"
        );


    /* =====================================================
      업무일지 → 효율팀 석회석 입고기록
      일괄 최신화
    ====================================================== */

    if (
      action ===
        "bulk_import"
    ) {
      const items =
        Array.isArray(
          body.items
        )
          ? body.items
          : [];


      if (
        items.length <
          1
      ) {
        return jsonResponse(
          {
            ok:
              false,

            message:
              "가져올 석회석 입고기록을 선택해 주세요."
          },
          400
        );
      }


      if (
        items.length >
          MAXIMUM_BULK_IMPORT_ITEMS
      ) {
        return jsonResponse(
          {
            ok:
              false,

            message:
              `한 번에 최대 ${MAXIMUM_BULK_IMPORT_ITEMS}건까지 가져올 수 있습니다.`
          },
          400
        );
      }


      /* ===================================================
        전달 항목 검증
      ==================================================== */

      const validatedItems = [];


      for (
        let itemIndex = 0;
        itemIndex <
          items.length;
        itemIndex +=
          1
      ) {
        const validation =
          validateImportedReceiptInput(
            items[
              itemIndex
            ]
          );


        if (
          validation.error
        ) {
          return jsonResponse(
            {
              ok:
                false,

              message:
                `${itemIndex + 1}번째 항목: ${validation.error}`
            },
            400
          );
        }


        validatedItems.push(
          validation.receipt
        );
      }


      /* ===================================================
        보직 우선순위

        1호기:
        BCO1 > BO1

        2호기:
        BCO2 > BO2
      ==================================================== */

      const rolePriorityMap = {
        BCO1:
          20,

        BO1:
          10,

        BCO2:
          20,

        BO2:
          10
      };


      const getSourceRolePriority = (
        role
      ) => {
        return Number(
          rolePriorityMap[
            normalizeSourceRole(
              role
            )
          ] ||
          0
        );
      };


      /* ===================================================
        같은 실제 입고 판정 키

        기준:
        - 입고일자
        - 입고시간
        - 호기
        - 입고량
      ==================================================== */

      const createBusinessKey = (
        receipt
      ) => {
        return [
          normalizeText(
            receipt.receiptDate
          ),

          normalizeText(
            receipt.receiptTime
          ),

          String(
            Number(
              receipt.unitNo
            ) ||
            ""
          ),

          Number(
            receipt.quantityTon
          ).toFixed(
            2
          )
        ].join(
          "||"
        );
      };


      /* ===================================================
        같은 요청 안의 중복 제거

        같은 입고에 BCO1과 BO1이 함께 있으면
        BCO1만 남긴다.

        같은 입고에 BCO2와 BO2가 함께 있으면
        BCO2만 남긴다.
      ==================================================== */

      const requestCandidateMap =
        new Map();


      validatedItems.forEach(
        receipt => {
          const businessKey =
            createBusinessKey(
              receipt
            );


          const currentReceipt =
            requestCandidateMap.get(
              businessKey
            );


          if (
            !currentReceipt ||
            getSourceRolePriority(
              receipt.sourceRole
            ) >
              getSourceRolePriority(
                currentReceipt.sourceRole
              )
          ) {
            requestCandidateMap.set(
              businessKey,
              receipt
            );
          }
        }
      );


      const effectiveItems = [
        ...requestCandidateMap.values()
      ];


      const timestamp =
        new Date()
          .toISOString();


      let createdCount =
        0;


      let updatedCount =
        0;


      let replacedCount =
        0;


      let removedCount =
        0;


      let manualProtectedCount =
        0;


      let duplicateCount =
        validatedItems.length -
        effectiveItems.length;


      /* ===================================================
        같은 업무일지 원본 항목 조회
      ==================================================== */

      const loadSameSourceReceipt =
        async receipt => {
          const row =
            await context.env.DB
              .prepare(`
                SELECT
                  *

                FROM limestone_receipts

                WHERE
                  source_type = 'shift_log'
                  AND source_key = ?

                ORDER BY
                  updated_at DESC,
                  created_at DESC

                LIMIT 1
              `)
              .bind(
                receipt.sourceKey
              )
              .first();


          return row
            ? convertReceiptRow(
                row
              )
            : null;
        };


      /* ===================================================
        같은 실제 입고기록 조회
      ==================================================== */

      const loadBusinessReceipts =
        async receipt => {
          const result =
            await context.env.DB
              .prepare(`
                SELECT
                  *

                FROM limestone_receipts

                WHERE
                  receipt_date = ?
                  AND receipt_time = ?
                  AND unit_no = ?
                  AND ABS(
                    quantity_ton - ?
                  ) < 0.005

                ORDER BY
                  CASE source_type
                    WHEN 'manual' THEN 1
                    WHEN 'shift_log' THEN 2
                    ELSE 9
                  END,

                  updated_at DESC,
                  created_at DESC
              `)
              .bind(
                receipt.receiptDate,
                receipt.receiptTime,
                receipt.unitNo,
                receipt.quantityTon
              )
              .all();


          return (
            Array.isArray(
              result.results
            )
              ? result.results
              : []
          ).map(
            convertReceiptRow
          );
        };


      /* ===================================================
        자동 연동 기록 삭제
      ==================================================== */

      const deleteReceiptById =
        async receiptId => {
          const deleteResult =
            await context.env.DB
              .prepare(`
                DELETE FROM limestone_receipts

                WHERE id = ?
              `)
              .bind(
                receiptId
              )
              .run();


          const changes =
            Number(
              deleteResult
                ?.meta
                ?.changes ||
              0
            );


          removedCount +=
            changes;


          return changes;
        };


      /* ===================================================
        기존 자동 연동 기록 갱신

        사용:
        - 같은 원본 내용 수정
        - BO1 → BCO1 교체
        - BO2 → BCO2 교체
      ==================================================== */

      const updateAutomaticReceipt =
        async (
          receiptId,
          receipt
        ) => {
          const updateResult =
            await context.env.DB
              .prepare(`
                UPDATE limestone_receipts

                SET
                  receipt_date = ?,
                  receipt_time = ?,
                  unit_no = ?,
                  quantity_ton = ?,
                  note = ?,

                  source_type = 'shift_log',
                  source_log_id = ?,
                  source_entry_id = ?,
                  source_key = ?,
                  source_role = ?,
                  source_author = ?,
                  source_text = ?,

                  updated_by_id = ?,
                  updated_by_name = ?,
                  updated_at = ?,

                  revision =
                    revision + 1

                WHERE id = ?
              `)
              .bind(
                receipt.receiptDate,
                receipt.receiptTime,
                receipt.unitNo,
                receipt.quantityTon,
                receipt.note,

                receipt.sourceLogId,
                receipt.sourceEntryId,
                receipt.sourceKey,
                receipt.sourceRole,
                receipt.sourceAuthor,
                receipt.sourceText,

                user.employeeNo,
                user.name,
                timestamp,

                receiptId
              )
              .run();


          return Number(
            updateResult
              ?.meta
              ?.changes ||
            0
          );
        };


      /* ===================================================
        신규 자동 연동 기록 등록
      ==================================================== */

      const insertAutomaticReceipt =
        async receipt => {
          const insertResult =
            await context.env.DB
              .prepare(`
                INSERT INTO limestone_receipts (
                  id,

                  receipt_date,
                  receipt_time,
                  unit_no,
                  quantity_ton,
                  note,

                  source_type,
                  source_log_id,
                  source_entry_id,
                  source_key,
                  source_role,
                  source_author,
                  source_text,

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

                  'shift_log',
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

                  ?,
                  ?,
                  1
                )
              `)
              .bind(
                crypto.randomUUID(),

                receipt.receiptDate,
                receipt.receiptTime,
                receipt.unitNo,
                receipt.quantityTon,
                receipt.note,

                receipt.sourceLogId,
                receipt.sourceEntryId,
                receipt.sourceKey,
                receipt.sourceRole,
                receipt.sourceAuthor,
                receipt.sourceText,

                user.employeeNo,
                user.name,
                user.employeeNo,
                user.name,

                timestamp,
                timestamp
              )
              .run();


          return Number(
            insertResult
              ?.meta
              ?.changes ||
            0
          );
        };


      /* ===================================================
        업무일지 후보별 등록·갱신·교체
      ==================================================== */

      for (
        const receipt of effectiveItems
      ) {
        const candidatePriority =
          getSourceRolePriority(
            receipt.sourceRole
          );


        /*
          같은 업무일지 항목으로
          이미 만들어진 기록
        */
        const sameSourceReceipt =
          await loadSameSourceReceipt(
            receipt
          );


        /*
          같은 날짜·시간·호기·수량 기록
        */
        const businessReceipts =
          await loadBusinessReceipts(
            receipt
          );


        /*
          사용자가 직접 등록한 기록
        */
        const manualReceipt =
          businessReceipts.find(
            item => {
              return (
                normalizeText(
                  item.sourceType
                )
                  .toLowerCase() ===
                "manual"
              );
            }
          ) ||
          null;


        /*
          업무일지 자동 연동 기록
        */
        const automaticReceipts =
          businessReceipts.filter(
            item => {
              return (
                normalizeText(
                  item.sourceType
                )
                  .toLowerCase() ===
                "shift_log"
              );
            }
          );


        /*
          같은 원본 항목을 제외한
          다른 자동 연동 기록
        */
        const competingAutomaticReceipts =
          automaticReceipts.filter(
            item => {
              return (
                !sameSourceReceipt ||
                item.id !==
                  sameSourceReceipt.id
              );
            }
          );


        const highestCompetingPriority =
          competingAutomaticReceipts.reduce(
            (
              highestPriority,
              item
            ) => {
              return Math.max(
                highestPriority,

                getSourceRolePriority(
                  item.sourceRole
                )
              );
            },
            0
          );


        /* ===============================================
          같은 업무일지 원본 항목이 이미 등록됨
        ================================================ */

        if (
          sameSourceReceipt
        ) {
          /*
            수기 기록이 있거나
            같은 입고에 동일·상위 보직 기록이 있으면
            현재 자동기록을 제거한다.
          */
          if (
            manualReceipt ||
            highestCompetingPriority >=
              candidatePriority
          ) {
            await deleteReceiptById(
              sameSourceReceipt.id
            );


            duplicateCount +=
              1;


            if (
              manualReceipt
            ) {
              manualProtectedCount +=
                1;
            }


            continue;
          }


          /*
            같은 원본 업무일지 항목은
            최신 내용으로 갱신한다.
          */
          const updated =
            await updateAutomaticReceipt(
              sameSourceReceipt.id,
              receipt
            );


          updatedCount +=
            updated;


          /*
            같은 실제 입고에 남아 있는
            낮은 우선순위 자동기록 제거
          */
          for (
            const duplicateReceipt of competingAutomaticReceipts
          ) {
            if (
              getSourceRolePriority(
                duplicateReceipt.sourceRole
              ) <=
                candidatePriority
            ) {
              await deleteReceiptById(
                duplicateReceipt.id
              );
            }
          }


          continue;
        }


        /* ===============================================
          수기 등록 기록 보호
        ================================================ */

        if (
          manualReceipt
        ) {
          manualProtectedCount +=
            1;


          duplicateCount +=
            1;


          continue;
        }


        /* ===============================================
          같은 실제 입고의 자동기록 존재
        ================================================ */

        if (
          automaticReceipts.length >
            0
        ) {
          /*
            가장 높은 보직 순서로 정렬
          */
          const orderedAutomaticReceipts = [
            ...automaticReceipts
          ].sort(
            (
              firstItem,
              secondItem
            ) => {
              const priorityDifference =
                getSourceRolePriority(
                  secondItem.sourceRole
                ) -
                getSourceRolePriority(
                  firstItem.sourceRole
                );


              if (
                priorityDifference !==
                  0
              ) {
                return priorityDifference;
              }


              return String(
                secondItem.updatedAt ||
                ""
              ).localeCompare(
                String(
                  firstItem.updatedAt ||
                  ""
                )
              );
            }
          );


          const primaryReceipt =
            orderedAutomaticReceipts[
              0
            ];


          const primaryPriority =
            getSourceRolePriority(
              primaryReceipt.sourceRole
            );


          /*
            기존 기록이 같은 보직 또는
            더 높은 보직이면 신규 후보를 제외한다.
          */
          if (
            primaryPriority >=
              candidatePriority
          ) {
            duplicateCount +=
              1;


            continue;
          }


          /*
            기존 하위 보직 기록을
            현재 상위 보직 기록으로 교체한다.

            BO1 → BCO1
            BO2 → BCO2
          */
          const replaced =
            await updateAutomaticReceipt(
              primaryReceipt.id,
              receipt
            );


          updatedCount +=
            replaced;


          replacedCount +=
            replaced;


          /*
            나머지 자동 중복기록 제거
          */
          for (
            const duplicateReceipt of orderedAutomaticReceipts.slice(
              1
            )
          ) {
            await deleteReceiptById(
              duplicateReceipt.id
            );
          }


          continue;
        }


        /* ===============================================
          신규 자동기록 등록
        ================================================ */

        createdCount +=
          await insertAutomaticReceipt(
            receipt
          );
      }


      /* ===================================================
        처리 결과
      ==================================================== */

      const messageParts = [
        `신규 ${createdCount}건`,
        `갱신 ${updatedCount}건`
      ];


      if (
        replacedCount >
          0
      ) {
        messageParts.push(
          `상위 보직 교체 ${replacedCount}건`
        );
      }


      if (
        duplicateCount >
          0
      ) {
        messageParts.push(
          `중복 제외 ${duplicateCount}건`
        );
      }


      if (
        manualProtectedCount >
          0
      ) {
        messageParts.push(
          `수기 기록 유지 ${manualProtectedCount}건`
        );
      }


      if (
        removedCount >
          0
      ) {
        messageParts.push(
          `자동 중복 정리 ${removedCount}건`
        );
      }


      return jsonResponse(
        {
          ok:
            true,

          requestedCount:
            validatedItems.length,

          effectiveCount:
            effectiveItems.length,

          createdCount,

          updatedCount,

          replacedCount,

          duplicateCount,

          manualProtectedCount,

          removedCount,

          message:
            `석회석 입고기록 최신화를 완료했습니다. ${messageParts.join(
              " / "
            )}`
        },
        201
      );
    }


    /* =====================================================
      효율팀 석회석 메뉴 직접 입력 등록
    ====================================================== */

    const validation =
      validateManualReceiptInput(
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


    const receipt =
      validation.receipt;


    const receiptId =
      crypto.randomUUID();


    const timestamp =
      new Date()
        .toISOString();


    await context.env.DB
      .prepare(`
        INSERT INTO limestone_receipts (
          id,

          receipt_date,
          receipt_time,
          unit_no,
          quantity_ton,
          note,

          source_type,
          source_log_id,
          source_entry_id,
          source_key,
          source_role,
          source_author,
          source_text,

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

          'manual',
          '',
          '',
          NULL,
          '',
          '',
          '',

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
        receiptId,

        receipt.receiptDate,
        receipt.receiptTime,
        receipt.unitNo,
        receipt.quantityTon,
        receipt.note,

        user.employeeNo,
        user.name,
        user.employeeNo,
        user.name,

        timestamp,
        timestamp
      )
      .run();


    const usageSync =
      await synchronizeStoredLimestoneUsageAfterReceiptChange(
        context.env.DB,
        receipt.receiptDate,
        receipt.unitNo,
        user
      );

    const createdReceipt =
      await findReceiptById(
        context.env.DB,
        receiptId
      );


    return jsonResponse(
      {
        ok:
          true,

        item:
          createdReceipt,

        message:
          "석회석 입고기록을 등록했습니다."
      },
      201
    );

  } catch (
    error
  ) {
    console.error(
      "석회석 입고기록 등록 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "석회석 입고기록을 등록하지 못했습니다."
      },
      500
    );
  }
}


/* =========================================================
  PUT /api/limestone-receipts
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


    const body =
      await readJsonBody(
        context.request
      );


    const receiptId =
      normalizeText(
        body.id
      );


    const requestedRevision =
      Number(
        body.revision
      );


    if (
      !receiptId
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "수정할 석회석 입고기록 ID가 없습니다."
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
            "석회석 입고기록 revision을 확인해 주세요."
        },
        400
      );
    }


    const existingReceipt =
      await findReceiptById(
        context.env.DB,
        receiptId
      );


    if (
      !existingReceipt
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "수정할 석회석 입고기록이 없습니다."
        },
        404
      );
    }


    if (
      !canManageReceipt(
        existingReceipt,
        user
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "로그인한 사용자만 기록을 수정할 수 있습니다."
        },
        403
      );
    }


    if (
      existingReceipt.revision !==
        requestedRevision
    ) {
      return jsonResponse(
        {
          ok:
            false,

          conflict:
            true,

          currentItem:
            existingReceipt,

          message:
            "다른 사용자가 먼저 기록을 수정했습니다. 최신 내용을 다시 불러와 주세요."
        },
        409
      );
    }


    const validation =
      validateManualReceiptInput(
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


    const receipt =
      validation.receipt;


    const timestamp =
      new Date()
        .toISOString();


    const updateResult =
      await context.env.DB
        .prepare(`
          UPDATE limestone_receipts

          SET
            receipt_date = ?,
            receipt_time = ?,
            unit_no = ?,
            quantity_ton = ?,
            note = ?,

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
          receipt.receiptDate,
          receipt.receiptTime,
          receipt.unitNo,
          receipt.quantityTon,
          receipt.note,

          user.employeeNo,
          user.name,
          timestamp,

          receiptId,
          requestedRevision
        )
        .run();


    if (
      Number(
        updateResult?.meta?.changes
      ) !==
      1
    ) {
      const currentReceipt =
        await findReceiptById(
          context.env.DB,
          receiptId
        );


      return jsonResponse(
        {
          ok:
            false,

          conflict:
            true,

          currentItem:
            currentReceipt,

          message:
            "다른 사용자가 먼저 기록을 수정했습니다. 최신 내용을 다시 불러와 주세요."
        },
        409
      );
    }


    const usageSyncResults = [];


    usageSyncResults.push(
      await synchronizeStoredLimestoneUsageAfterReceiptChange(
        context.env.DB,
        existingReceipt.receiptDate,
        existingReceipt.unitNo,
        user
      )
    );


    if (
      existingReceipt.receiptDate !==
        receipt.receiptDate ||
      Number(existingReceipt.unitNo) !==
        Number(receipt.unitNo)
    ) {
      usageSyncResults.push(
        await synchronizeStoredLimestoneUsageAfterReceiptChange(
          context.env.DB,
          receipt.receiptDate,
          receipt.unitNo,
          user
        )
      );
    }

    const updatedReceipt =
      await findReceiptById(
        context.env.DB,
        receiptId
      );


    return jsonResponse({
      ok:
        true,

      item:
        updatedReceipt,

      message:
        "석회석 입고기록을 수정했습니다."
    });

  } catch (
    error
  ) {
    console.error(
      "석회석 입고기록 수정 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "석회석 입고기록을 수정하지 못했습니다."
      },
      500
    );
  }
}


/* =========================================================
  DELETE /api/limestone-receipts?id=...
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


    const receiptId =
      normalizeText(
        requestUrl
          .searchParams
          .get(
            "id"
          )
      );


    const revisionText =
      normalizeText(
        requestUrl
          .searchParams
          .get(
            "revision"
          )
      );


    const requestedRevision =
      revisionText
        ? Number(
            revisionText
          )
        : null;


    if (
      !receiptId
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "삭제할 석회석 입고기록 ID가 없습니다."
        },
        400
      );
    }


    if (
      requestedRevision !==
        null &&
      (
        !Number.isInteger(
          requestedRevision
        ) ||
        requestedRevision <
          1
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "석회석 입고기록 revision을 확인해 주세요."
        },
        400
      );
    }


    const existingReceipt =
      await findReceiptById(
        context.env.DB,
        receiptId
      );


    if (
      !existingReceipt
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "이미 삭제되었거나 존재하지 않는 기록입니다."
        },
        404
      );
    }


    if (
      !canManageReceipt(
        existingReceipt,
        user
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "로그인한 사용자만 기록을 삭제할 수 있습니다."
        },
        403
      );
    }


    if (
      requestedRevision !==
        null &&
      existingReceipt.revision !==
        requestedRevision
    ) {
      return jsonResponse(
        {
          ok:
            false,

          conflict:
            true,

          currentItem:
            existingReceipt,

          message:
            "다른 사용자가 먼저 기록을 수정했습니다. 최신 내용을 다시 불러와 주세요."
        },
        409
      );
    }


    let deleteResult;


    if (
      requestedRevision ===
        null
    ) {
      deleteResult =
        await context.env.DB
          .prepare(`
            DELETE FROM limestone_receipts

            WHERE id = ?
          `)
          .bind(
            receiptId
          )
          .run();

    } else {
      deleteResult =
        await context.env.DB
          .prepare(`
            DELETE FROM limestone_receipts

            WHERE
              id = ?
              AND revision = ?
          `)
          .bind(
            receiptId,
            requestedRevision
          )
          .run();
    }


    if (
      Number(
        deleteResult?.meta?.changes
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
            "기록 상태가 변경되었습니다. 목록을 다시 불러와 주세요."
        },
        409
      );
    }


    const usageSync =
      await synchronizeStoredLimestoneUsageAfterReceiptChange(
        context.env.DB,
        existingReceipt.receiptDate,
        existingReceipt.unitNo,
        user
      );

    return jsonResponse({
      ok:
        true,

      deletedId:
        receiptId,

      message:
        "석회석 입고기록을 삭제했습니다."
    });

  } catch (
    error
  ) {
    console.error(
      "석회석 입고기록 삭제 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "석회석 입고기록을 삭제하지 못했습니다."
      },
      500
    );
  }
}
