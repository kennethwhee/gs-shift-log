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
  - 작성자는 본인 기록 수정·삭제 가능
  - 관리자·최고관리자는 전체 수정·삭제 가능

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
  업무일지 원본 보직
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


  return [
    "BCO1",
    "BCO2"
  ].includes(
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

  - 작성자 본인
  - 관리자
  - 최고관리자
========================================================= */

function canManageReceipt(
  receipt,
  user
) {
  return (
    user.isAdmin ===
      true ||
    normalizeEmployeeNo(
      receipt.createdById
    ) ===
      normalizeEmployeeNo(
        user.employeeNo
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
  업무일지 가져오기 항목 검증
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
        "업무일지 원본 보직은 BCO1 또는 BCO2여야 합니다."
    };
  }


  /*
    BCO1 → 1호기
    BCO2 → 2호기
  */
  const unitNo =
    sourceRole ===
      "BCO1"
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
  POST /api/limestone-receipts

  일반 등록:
  {
    receiptDate,
    receiptTime,
    unitNo,
    quantityTon,
    note
  }

  업무일지 일괄 등록:
  {
    action: "bulk_import",
    items: [...]
  }
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
      업무일지 일괄 가져오기
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


      const timestamp =
        new Date()
          .toISOString();


      const statements =
        validatedItems.map(
          receipt => {
            return context.env.DB
              .prepare(`
                INSERT OR IGNORE INTO limestone_receipts (
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
              );
          }
        );


      const batchResults =
        await context.env.DB
          .batch(
            statements
          );


      const createdCount =
        batchResults.reduce(
          (
            total,
            result
          ) => {
            return (
              total +
              (
                Number(
                  result?.meta?.changes
                ) ||
                0
              )
            );
          },
          0
        );


      return jsonResponse(
        {
          ok:
            true,

          requestedCount:
            validatedItems.length,

          createdCount,

          duplicateCount:
            validatedItems.length -
            createdCount,

          message:
            (
              `석회석 입고기록 ${createdCount}건을 등록했습니다.` +
              (
                createdCount <
                  validatedItems.length
                  ? ` 중복 ${validatedItems.length - createdCount}건은 제외했습니다.`
                  : ""
              )
            )
        },
        201
      );
    }


    /* =====================================================
      직접 입력 등록
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
            "본인이 등록한 기록만 수정할 수 있습니다."
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
            "본인이 등록한 기록만 삭제할 수 있습니다."
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