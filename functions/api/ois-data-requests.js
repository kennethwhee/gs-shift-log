"use strict";


/* =========================================================
  OIS 사내자료 요청 대기열 API

  경로:
  functions/api/ois-data-requests.js

  업무일지 사용자:
  POST /api/ois-data-requests
  - 날짜별 OIS 자료 요청 생성

  GET /api/ois-data-requests?id=요청ID
  - 요청 처리 상태와 결과 확인

  회사 PC OIS 연동 프로그램:
  GET /api/ois-data-requests?action=next
  - 처리할 다음 요청 가져오기

  POST /api/ois-data-requests
  action: complete
  - 조회 결과 등록

  POST /api/ois-data-requests
  action: fail
  - 조회 실패 등록
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const DEFAULT_REQUEST_TYPE =
  "limestone_stock";


const REQUEST_TIMEOUT_MINUTES =
  10;

/*
  기간 일괄 계산:
  한 번에 최대 62일까지 허용한다.
*/
const MAXIMUM_LIMESTONE_USAGE_BATCH_DAYS =
  62;


/*
  기간 요청은 대기열에서 오래 기다릴 수 있으므로
  개별 요청 유효기간을 48시간으로 설정한다.
*/
const LIMESTONE_USAGE_BATCH_QUEUE_HOURS =
  48;  


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


function normalizeAccountRole(
  value
) {
  const normalizedRole =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );


  if (
    normalizedRole ===
      "super_admin" ||
    normalizedRole ===
      "superadmin"
  ) {
    return "super_admin";
  }


  if (
    normalizedRole ===
      "admin" ||
    normalizedRole ===
      "leader"
  ) {
    return "admin";
  }


  return "user";
}


/* =========================================================
  날짜 검증
========================================================= */

function isValidIsoDate(
  value
) {
  const normalizedDate =
    normalizeText(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalizedDate
    )
  ) {
    return false;
  }


  const parsedDate =
    new Date(
      `${normalizedDate}T00:00:00.000Z`
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
      normalizedDate
  );
}


/* =========================================================
  날짜 더하기
========================================================= */

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
    Number(
      dayCount ||
      0
    )
  );


  return parsedDate
    .toISOString()
    .slice(
      0,
      10
    );
}

/* =========================================================
  기간 일수 계산
========================================================= */

function getLimestoneUsageBatchDayCount(
  startDate,
  endDate
) {
  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    )
  ) {
    return 0;
  }


  const startTime =
    new Date(
      `${startDate}T00:00:00.000Z`
    ).getTime();


  const endTime =
    new Date(
      `${endDate}T00:00:00.000Z`
    ).getTime();


  if (
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
  시작일~종료일 날짜 배열 생성

  예:
  2026-08-01 ~ 2026-08-03

  결과:
  [
    "2026-08-01",
    "2026-08-02",
    "2026-08-03"
  ]
========================================================= */

function createLimestoneUsageBatchDates(
  startDate,
  endDate
) {
  const dayCount =
    getLimestoneUsageBatchDayCount(
      startDate,
      endDate
    );


  if (
    dayCount <
      1
  ) {
    return [];
  }


  const dates = [];


  for (
    let dayIndex = 0;
    dayIndex <
      dayCount;
    dayIndex +=
      1
  ) {
    dates.push(
      addIsoDateDays(
        startDate,
        dayIndex
      )
    );
  }


  return dates;
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


async function hashText(
  value
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",

      new TextEncoder()
        .encode(
          String(
            value ||
            ""
          )
        )
    );


  return bytesToHex(
    new Uint8Array(
      digest
    )
  );
}


/* =========================================================
  업무일지 로그인 사용자 확인
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
    await hashText(
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

      role
    }
  };
}


/* =========================================================
  OIS 연동 프로그램 인증

  회사 PC 프로그램은 다음 헤더를 사용한다.

  X-OIS-Agent-Key: 비밀키
========================================================= */

async function authenticateOisAgent(
  context
) {
  const savedAgentKey =
    normalizeText(
      context.env
        .OIS_AGENT_KEY
    );


  if (
    !savedAgentKey
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "Cloudflare 비밀변수 OIS_AGENT_KEY가 등록되지 않았습니다."
          },
          500
        )
    };
  }


  const requestedAgentKey =
    normalizeText(
      context.request.headers.get(
        "X-OIS-Agent-Key"
      )
    );


  if (
    !requestedAgentKey
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "OIS 연동 프로그램 인증키가 없습니다."
          },
          401
        )
    };
  }


  const [
    savedHash,
    requestedHash
  ] =
    await Promise.all([
      hashText(
        savedAgentKey
      ),

      hashText(
        requestedAgentKey
      )
    ]);


  if (
    savedHash !==
      requestedHash
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "OIS 연동 프로그램 인증키가 올바르지 않습니다."
          },
          403
        )
    };
  }


  return {
    agentId:
      normalizeText(
        context.request.headers.get(
          "X-OIS-Agent-Id"
        )
      ) ||
      "company-pc"
  };
}

/* =========================================================
  OIS 요청 유형 정리

  지원:
  - limestone_stock
  - water_environment
  - turbine_gear_pinion
========================================================= */

function normalizeRequestType(
  value
) {
  const requestType =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );


  return [
    "limestone_stock",
    "water_environment",
    "turbine_gear_pinion"
  ].includes(
    requestType
  )
    ? requestType
    : DEFAULT_REQUEST_TYPE;
}

/* =========================================================
  숫자 정리
========================================================= */

function normalizeOisNumber(
  value
) {
  const numericValue =
    Number(
      value
    );


  return Number.isFinite(
    numericValue
  )
    ? Math.round(
        numericValue *
        1000
      ) /
      1000
    : null;
}

/* =========================================================
  석회석 사용량 숫자 정리

  규칙:
  - 반올림하지 않음
  - 소수점 둘째 자리 아래 절삭
  - 부동소수점 오차 보정

  예:
  38.70400000000001 → 38.70
  33.89699999999999 → 33.89
========================================================= */

function normalizeLimestoneUsageNumber(
  value
) {
  const numericValue =
    Number(
      value
    );


  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return null;
  }


  /*
    33.89가 내부적으로
    33.889999999999처럼 표현되는 문제를 보정한다.
  */
  const floatingPointCorrection =
    Math.sign(
      numericValue
    ) *
    0.000000001;


  return (
    Math.trunc(
      (
        numericValue +
        floatingPointCorrection
      ) *
      100
    ) /
    100
  );
}

/* =========================================================
  사용량 DB 행 → API 응답
========================================================= */

function convertLimestoneUsageRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    usageDate:
      normalizeText(
        row.usage_date
      ),

    unitNo:
      Number(
        row.unit_no
      ),

    startStock:
      normalizeOisNumber(
        row.start_stock
      ),

    receiptQuantity:
      normalizeOisNumber(
        row.receipt_quantity
      ),

    endStock:
      normalizeOisNumber(
        row.end_stock
      ),

    usageQuantity:
      normalizeOisNumber(
        row.usage_quantity
      ),

    oisTag:
      normalizeText(
        row.ois_tag
      ),

    oisRequestId:
      normalizeText(
        row.ois_request_id
      ),

    oisCollectedAt:
      normalizeText(
        row.ois_collected_at
      ),

    agentId:
      normalizeText(
        row.agent_id
      ),

    calculationMode:
      normalizeText(
        row.calculation_mode
      ),

    batchId:
      normalizeText(
        row.batch_id
      ),

    createdById:
      normalizeText(
        row.created_by_id
      ),

    createdByName:
      normalizeText(
        row.created_by_name
      ),

    updatedById:
      normalizeText(
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
  날짜별 저장 사용량 조회
========================================================= */

async function findLimestoneUsageRecordsByDate(
  database,
  usageDate
) {
  const queryResult =
    await database
      .prepare(`
        SELECT
          *

        FROM limestone_usage_records

        WHERE usage_date = ?

        ORDER BY unit_no ASC
      `)
      .bind(
        usageDate
      )
      .all();


  return (
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : []
  )
    .map(
      convertLimestoneUsageRow
    )
    .filter(
      Boolean
    );
}


/* =========================================================
  날짜별 1·2호기 입고량 합계 조회

  입고기록이 없는 호기는 0 ton
========================================================= */

async function loadLimestoneReceiptQuantitiesByUnit(
  database,
  usageDate
) {
  const queryResult =
    await database
      .prepare(`
        SELECT
          unit_no,

          COALESCE(
            SUM(
              quantity_ton
            ),
            0
          ) AS total_quantity

        FROM limestone_receipts

        WHERE
          receipt_date = ?
          AND unit_no IN (
            1,
            2
          )

        GROUP BY unit_no
      `)
      .bind(
        usageDate
      )
      .all();


  const receiptByUnit = {
    1:
      0,

    2:
      0
  };


  const rows =
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : [];


  rows.forEach(
    row => {
      const unitNo =
        Number(
          row.unit_no
        );


      const quantity =
        normalizeLimestoneUsageNumber(
          row.total_quantity
        );


      if (
        [
          1,
          2
        ].includes(
          unitNo
        ) &&
        quantity !==
          null
      ) {
        receiptByUnit[
          unitNo
        ] =
          quantity;
      }
    }
  );


  return receiptByUnit;
}


/* =========================================================
  OIS 석회석 재고 결과 → 사용량 자동 계산·저장

  계산식:
  사용량 =
    전일 재고
    + 당일 입고량
    - 24시 재고

  같은 날짜·호기가 이미 있으면:
  신규 행을 만들지 않고 최신 값으로 갱신한다.
========================================================= */

async function saveLimestoneUsageRecords(
  database,
  options
) {
  const requestItem =
    options?.requestItem ||
    {};


  const normalizedResult =
    options?.normalizedResult ||
    {};


  const usageDate =
    normalizeText(
      normalizedResult.targetDate ||
      requestItem.targetDate
    );


  if (
    !isValidIsoDate(
      usageDate
    )
  ) {
    throw new Error(
      "석회석 사용량 저장 날짜가 올바르지 않습니다."
    );
  }


  const receiptByUnit =
    await loadLimestoneReceiptQuantitiesByUnit(
      database,
      usageDate
    );


  const agentId =
    normalizeText(
      options?.agentId ||
      requestItem.agentId
    );


  const calculationMode =
    normalizeText(
      options?.calculationMode
    ) ||
    "single";


  const batchId =
    normalizeText(
      options?.batchId
    );


  const requestedById =
    normalizeEmployeeNo(
      requestItem.requestedById
    );


  const requestedByName =
    normalizeText(
      requestItem.requestedByName
    );


  const oisCollectedAt =
    normalizeText(
      normalizedResult.collectedAt
    );


  const timestamp =
    new Date()
      .toISOString();


  const unitDefinitions = [
    {
      unitNo:
        1,

      defaultTag:
        "103HRJ01CW201XQ01",

      result:
        normalizedResult.unitOne ||
        {}
    },

    {
      unitNo:
        2,

      defaultTag:
        "203HRJ01CW201XQ01",

      result:
        normalizedResult.unitTwo ||
        {}
    }
  ];


  for (
    const unitDefinition of
    unitDefinitions
  ) {
    const unitNo =
      unitDefinition.unitNo;


    const startStock =
      normalizeOisNumber(
        unitDefinition
          .result
          .startStock
      );


    const endStock =
      normalizeOisNumber(
        unitDefinition
          .result
          .endStock
      );


    const receiptQuantity =
      normalizeLimestoneUsageNumber(
        receiptByUnit[
          unitNo
        ] ||
        0
      );


    if (
      startStock ===
        null ||
      endStock ===
        null ||
      receiptQuantity ===
        null
    ) {
      throw new Error(
        `${unitNo}호기 석회석 사용량 계산값을 확인할 수 없습니다.`
      );
    }


    const usageQuantity =
      normalizeLimestoneUsageNumber(
        startStock +
        receiptQuantity -
        endStock
      );


    if (
      usageQuantity ===
        null
    ) {
      throw new Error(
        `${unitNo}호기 석회석 사용량을 계산하지 못했습니다.`
      );
    }


    const oisTag =
      normalizeText(
        unitDefinition
          .result
          .tag
      ) ||
      unitDefinition
        .defaultTag;


    await database
      .prepare(`
        INSERT INTO limestone_usage_records (
          id,

          usage_date,
          unit_no,

          start_stock,
          receipt_quantity,
          end_stock,
          usage_quantity,

          ois_tag,
          ois_request_id,
          ois_collected_at,
          agent_id,

          calculation_mode,
          batch_id,

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

        ON CONFLICT (
          usage_date,
          unit_no
        )
        DO UPDATE SET
          start_stock =
            excluded.start_stock,

          receipt_quantity =
            excluded.receipt_quantity,

          end_stock =
            excluded.end_stock,

          usage_quantity =
            excluded.usage_quantity,

          ois_tag =
            excluded.ois_tag,

          ois_request_id =
            excluded.ois_request_id,

          ois_collected_at =
            excluded.ois_collected_at,

          agent_id =
            excluded.agent_id,

          calculation_mode =
            excluded.calculation_mode,

          batch_id =
            excluded.batch_id,

          updated_by_id =
            excluded.updated_by_id,

          updated_by_name =
            excluded.updated_by_name,

          updated_at =
            excluded.updated_at,

          revision =
            limestone_usage_records.revision +
            1
      `)
      .bind(
        crypto.randomUUID(),

        usageDate,
        unitNo,

        startStock,
        receiptQuantity,
        endStock,
        usageQuantity,

        oisTag,
        normalizeText(
          requestItem.id
        ),
        oisCollectedAt,
        agentId,

        calculationMode,
        batchId,

        requestedById,
        requestedByName,
        requestedById,
        requestedByName,

        timestamp,
        timestamp
      )
      .run();
  }


  return await findLimestoneUsageRecordsByDate(
    database,
    usageDate
  );
}


/* =========================================================
  석회석 OIS 결과 검증
========================================================= */

function normalizeLimestoneStockResult(
  rawResult,
  targetDate
) {
  const result =
    rawResult &&
    typeof rawResult ===
      "object" &&
    !Array.isArray(
      rawResult
    )
      ? rawResult
      : {};


  const unitOne =
    result.unitOne ||
    result.unit1 ||
    {};


  const unitTwo =
    result.unitTwo ||
    result.unit2 ||
    {};


  const unitOneStartStock =
    normalizeOisNumber(
      unitOne.startStock
    );


  const unitOneEndStock =
    normalizeOisNumber(
      unitOne.endStock
    );


  const unitTwoStartStock =
    normalizeOisNumber(
      unitTwo.startStock
    );


  const unitTwoEndStock =
    normalizeOisNumber(
      unitTwo.endStock
    );


  if (
    unitOneStartStock ===
      null ||
    unitOneEndStock ===
      null ||
    unitTwoStartStock ===
      null ||
    unitTwoEndStock ===
      null
  ) {
    return {
      error:
        "1호기와 2호기의 시작·종료 재고값을 모두 확인해 주세요."
    };
  }


  const nextDate =
    addIsoDateDays(
      targetDate,
      1
    );


  return {
    result: {
      targetDate,

      nextDate,

      unitOne: {
        tag:
          "103HRJ01CW201XQ01",

        startStock:
          unitOneStartStock,

        endStock:
          unitOneEndStock
      },

      unitTwo: {
        tag:
          "203HRJ01CW201XQ01",

        startStock:
          unitTwoStartStock,

        endStock:
          unitTwoEndStock
      },

      collectedAt:
        normalizeText(
          result.collectedAt
        ) ||
        new Date()
          .toISOString()
    }
  };
}


/* =========================================================
  DB 행 → 응답
========================================================= */

function convertRequestRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  let result =
    null;


  const resultJson =
    normalizeText(
      row.result_json
    );


  if (
    resultJson
  ) {
    try {
      result =
        JSON.parse(
          resultJson
        );

    } catch {
      result =
        null;
    }
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    requestType:
      normalizeText(
        row.request_type
      ),

    targetDate:
      normalizeText(
        row.target_date
      ),

    status:
      normalizeText(
        row.status
      ),

    requestedById:
      normalizeText(
        row.requested_by_id
      ),

    requestedByName:
      normalizeText(
        row.requested_by_name
      ),

    requestedAt:
      normalizeText(
        row.requested_at
      ),

    startedAt:
      normalizeText(
        row.started_at
      ),

    completedAt:
      normalizeText(
        row.completed_at
      ),

    agentId:
      normalizeText(
        row.agent_id
      ),

    result,

    errorMessage:
      normalizeText(
        row.error_message
      ),

    expiresAt:
      normalizeText(
        row.expires_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      )
  };
}


/* =========================================================
  요청 한 건 조회
========================================================= */

async function findRequestById(
  database,
  requestId
) {
  const row =
    await database
      .prepare(`
        SELECT
          *

        FROM ois_data_requests

        WHERE id = ?

        LIMIT 1
      `)
      .bind(
        requestId
      )
      .first();


  return convertRequestRow(
    row
  );
}

/* =========================================================
  기간 계산 DB 행 → API 응답
========================================================= */

function convertLimestoneUsageBatchRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    startDate:
      normalizeText(
        row.start_date
      ),

    endDate:
      normalizeText(
        row.end_date
      ),

    totalDays:
      Number(
        row.total_days
      ) ||
      0,

    status:
      normalizeText(
        row.status
      ),

    requestedById:
      normalizeText(
        row.requested_by_id
      ),

    requestedByName:
      normalizeText(
        row.requested_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    completedAt:
      normalizeText(
        row.completed_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    lastError:
      normalizeText(
        row.last_error
      )
  };
}


/* =========================================================
  기간 계산 작업 한 건 조회
========================================================= */

async function findLimestoneUsageBatchById(
  database,
  batchId
) {
  const row =
    await database
      .prepare(`
        SELECT
          *

        FROM limestone_usage_batches

        WHERE id = ?

        LIMIT 1
      `)
      .bind(
        batchId
      )
      .first();


  return convertLimestoneUsageBatchRow(
    row
  );
}


/* =========================================================
  OIS 요청이 속한 기간 계산 작업 조회
========================================================= */

async function findLimestoneUsageBatchLinkByRequestId(
  database,
  requestId
) {
  const row =
    await database
      .prepare(`
        SELECT
          batch_id,
          usage_date

        FROM limestone_usage_batch_items

        WHERE ois_request_id = ?

        LIMIT 1
      `)
      .bind(
        requestId
      )
      .first();


  if (
    !row
  ) {
    return null;
  }


  return {
    batchId:
      normalizeText(
        row.batch_id
      ),

    usageDate:
      normalizeText(
        row.usage_date
      )
  };
}


/* =========================================================
  기간 계산 진행 상태 갱신·조회
========================================================= */

async function refreshLimestoneUsageBatchStatus(
  database,
  batchId
) {
  const existingBatch =
    await findLimestoneUsageBatchById(
      database,
      batchId
    );


  if (
    !existingBatch
  ) {
    return null;
  }


  const queryResult =
    await database
      .prepare(`
        SELECT
          item.usage_date,
          item.ois_request_id,

          request.status,
          request.error_message,
          request.requested_at,
          request.started_at,
          request.completed_at,
          request.agent_id

        FROM limestone_usage_batch_items
          AS item

        INNER JOIN ois_data_requests
          AS request

          ON request.id =
             item.ois_request_id

        WHERE item.batch_id = ?

        ORDER BY
          item.usage_date ASC
      `)
      .bind(
        batchId
      )
      .all();


  const rows =
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : [];


  const items =
    rows.map(
      row => {
        return {
          usageDate:
            normalizeText(
              row.usage_date
            ),

          requestId:
            normalizeText(
              row.ois_request_id
            ),

          status:
            normalizeText(
              row.status
            ),

          errorMessage:
            normalizeText(
              row.error_message
            ),

          requestedAt:
            normalizeText(
              row.requested_at
            ),

          startedAt:
            normalizeText(
              row.started_at
            ),

          completedAt:
            normalizeText(
              row.completed_at
            ),

          agentId:
            normalizeText(
              row.agent_id
            )
        };
      }
    );


  const counts = {
    pending:
      0,

    processing:
      0,

    complete:
      0,

    failed:
      0
  };


  items.forEach(
    item => {
      if (
        Object.prototype
          .hasOwnProperty
          .call(
            counts,
            item.status
          )
      ) {
        counts[
          item.status
        ] +=
          1;
      }
    }
  );


  const completedCount =
    counts.complete;


  const failedCount =
    counts.failed;


  const processedCount =
    completedCount +
    failedCount;


  const remainingCount =
    counts.pending +
    counts.processing;


  let status =
    "pending";


  if (
    items.length <
      1
  ) {
    status =
      "failed";

  } else if (
    remainingCount >
      0
  ) {
    status =
      counts.processing >
        0 ||
      processedCount >
        0
        ? "processing"
        : "pending";

  } else if (
    completedCount ===
      items.length
  ) {
    status =
      "complete";

  } else if (
    failedCount ===
      items.length
  ) {
    status =
      "failed";

  } else {
    status =
      "partial_failed";
  }


  const isFinished =
    [
      "complete",
      "failed",
      "partial_failed"
    ].includes(
      status
    );


  const now =
    new Date()
      .toISOString();


  const completedAt =
    isFinished
      ? (
          existingBatch.completedAt ||
          now
        )
      : "";


  const failedItems =
    items.filter(
      item => {
        return item.status ===
          "failed";
      }
    );


  const lastError =
    failedItems.length >
      0
      ? normalizeText(
          failedItems[
            failedItems.length -
            1
          ].errorMessage
        )
      : "";


  await database
    .prepare(`
      UPDATE limestone_usage_batches

      SET
        status = ?,
        completed_at = ?,
        updated_at = ?,
        last_error = ?

      WHERE id = ?
    `)
    .bind(
      status,
      completedAt,
      now,
      lastError,
      batchId
    )
    .run();


  const updatedBatch =
    await findLimestoneUsageBatchById(
      database,
      batchId
    );


  const totalDays =
    Math.max(
      Number(
        updatedBatch?.totalDays ||
        items.length ||
        0
      ),
      0
    );


  const progressPercent =
    totalDays >
      0
      ? Math.min(
          100,

          Math.round(
            (
              processedCount /
              totalDays
            ) *
            100
          )
        )
      : 0;


  return {
    batch:
      updatedBatch,

    progress: {
      totalDays,

      processedCount,

      completedCount,

      failedCount,

      pendingCount:
        counts.pending,

      processingCount:
        counts.processing,

      remainingCount,

      percent:
        progressPercent
    },

    items
  };
}

/* =========================================================
  만료된 요청 정리
========================================================= */

async function expireOldRequests(
  database
) {
  const now =
    new Date()
      .toISOString();


  await database
    .prepare(`
      UPDATE ois_data_requests

      SET
        status = 'failed',
        error_message =
          'OIS 연동 프로그램의 응답 시간이 초과되었습니다.',
        completed_at = ?,
        updated_at = ?

      WHERE
        status IN (
          'pending',
          'processing'
        )
        AND expires_at < ?
    `)
    .bind(
      now,
      now,
      now
    )
    .run();
}

/* =========================================================
  저장된 석회석 사용량 조회

  GET:
  /api/ois-data-requests
    ?action=usage_records
    &targetDate=2026-08-06
========================================================= */

async function handleLimestoneUsageRecordsGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const targetDate =
    normalizeText(
      requestUrl.searchParams.get(
        "targetDate"
      ) ||
      requestUrl.searchParams.get(
        "date"
      )
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "불러올 석회석 사용량 날짜를 확인해 주세요."
      },
      400
    );
  }


  const items =
    await findLimestoneUsageRecordsByDate(
      context.env.DB,
      targetDate
    );


  const unitOne =
    items.find(
      item => {
        return Number(
          item.unitNo
        ) ===
          1;
      }
    ) ||
    null;


  const unitTwo =
    items.find(
      item => {
        return Number(
          item.unitNo
        ) ===
          2;
      }
    ) ||
    null;


  const unitOneUsage =
    Number(
      unitOne?.usageQuantity
    );


  const unitTwoUsage =
    Number(
      unitTwo?.usageQuantity
    );


  const hasCompleteResult =
    Boolean(
      unitOne &&
      unitTwo &&
      Number.isFinite(
        unitOneUsage
      ) &&
      Number.isFinite(
        unitTwoUsage
      )
    );


  return jsonResponse({
    ok:
      true,

    targetDate,

    hasSavedResult:
      hasCompleteResult,

    items,

    summary: {
      unitOneUsage:
        Number.isFinite(
          unitOneUsage
        )
          ? unitOneUsage
          : null,

      unitTwoUsage:
        Number.isFinite(
          unitTwoUsage
        )
          ? unitTwoUsage
          : null,

      totalUsage:
        hasCompleteResult
          ? unitOneUsage +
            unitTwoUsage
          : null
    }
  });
}

/* =========================================================
  기간 계산 진행 상태 조회

  GET:
  /api/ois-data-requests
    ?action=usage_batch
    &batchId=배치ID
========================================================= */

async function handleLimestoneUsageBatchGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  await expireOldRequests(
    context.env.DB
  );


  const batchId =
    normalizeText(
      requestUrl.searchParams.get(
        "batchId"
      ) ||
      requestUrl.searchParams.get(
        "id"
      )
    );


  if (
    !batchId
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "조회할 기간 계산 작업 ID가 없습니다."
      },
      400
    );
  }


  const progress =
    await refreshLimestoneUsageBatchStatus(
      context.env.DB,
      batchId
    );


  if (
    !progress
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "기간 계산 작업을 찾을 수 없습니다."
      },
      404
    );
  }


  return jsonResponse({
    ok:
      true,

    ...progress
  });
}

/* =========================================================
  석회석 사용량 숫자 확인
========================================================= */

function normalizeLimestoneUsageHistoryNumber(
  value
) {
  const numericValue =
    Number(
      value
    );


  return Number.isFinite(
    numericValue
  )
    ? numericValue
    : null;
}


/* =========================================================
  저장된 석회석 사용량 기간 조회

  GET:
  /api/ois-data-requests
    ?action=usage_history
    &startDate=2026-08-01
    &endDate=2026-08-31

  반환:
  - 날짜별 1호기 사용량
  - 날짜별 2호기 사용량
  - 날짜별 전체 사용량
  - 기간 합계
  - 미저장 날짜
========================================================= */

async function handleLimestoneUsageHistoryGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const startDate =
    normalizeText(
      requestUrl.searchParams.get(
        "startDate"
      )
    );


  const endDate =
    normalizeText(
      requestUrl.searchParams.get(
        "endDate"
      )
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
          "사용량 조회 시작일과 종료일을 확인해 주세요."
      },
      400
    );
  }


  const dayCount =
    getLimestoneUsageBatchDayCount(
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
          "사용량 조회 시작일은 종료일보다 늦을 수 없습니다."
      },
      400
    );
  }


  if (
    dayCount >
      366
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "석회석 사용량은 한 번에 최대 366일까지 조회할 수 있습니다."
      },
      400
    );
  }


  const queryResult =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM limestone_usage_records

        WHERE
          usage_date >= ?
          AND usage_date <= ?

        ORDER BY
          usage_date ASC,
          unit_no ASC
      `)
      .bind(
        startDate,
        endDate
      )
      .all();


  const savedRecords =
    (
      Array.isArray(
        queryResult.results
      )
        ? queryResult.results
        : []
    )
      .map(
        convertLimestoneUsageRow
      )
      .filter(
        Boolean
      );


  /*
    날짜별 기록 묶음
  */
  const dailyMap =
    new Map();


  createLimestoneUsageBatchDates(
    startDate,
    endDate
  ).forEach(
    usageDate => {
      dailyMap.set(
        usageDate,
        {
          usageDate,

          unitOne:
            null,

          unitTwo:
            null
        }
      );
    }
  );


  savedRecords.forEach(
    record => {
      const usageDate =
        normalizeText(
          record.usageDate
        );


      const unitNo =
        Number(
          record.unitNo
        );


      if (
        !dailyMap.has(
          usageDate
        )
      ) {
        return;
      }


      const dailyItem =
        dailyMap.get(
          usageDate
        );


      if (
        unitNo ===
          1
      ) {
        dailyItem.unitOne =
          record;

      } else if (
        unitNo ===
          2
      ) {
        dailyItem.unitTwo =
          record;
      }
    }
  );


  let unitOneTotal =
    0;


  let unitTwoTotal =
    0;


  let completeDays =
    0;


  let partialDays =
    0;


  let missingDays =
    0;


  const dailyItems = [
    ...dailyMap.values()
  ]
    .map(
      dailyItem => {
        const unitOneUsage =
          normalizeLimestoneUsageHistoryNumber(
            dailyItem
              .unitOne
              ?.usageQuantity
          );


        const unitTwoUsage =
          normalizeLimestoneUsageHistoryNumber(
            dailyItem
              .unitTwo
              ?.usageQuantity
          );


        const hasUnitOne =
          unitOneUsage !==
            null;


        const hasUnitTwo =
          unitTwoUsage !==
            null;


        let status =
          "missing";


        if (
          hasUnitOne &&
          hasUnitTwo
        ) {
          status =
            "complete";


          completeDays +=
            1;

        } else if (
          hasUnitOne ||
          hasUnitTwo
        ) {
          status =
            "partial";


          partialDays +=
            1;

        } else {
          missingDays +=
            1;
        }


        if (
          hasUnitOne
        ) {
          unitOneTotal +=
            unitOneUsage;
        }


        if (
          hasUnitTwo
        ) {
          unitTwoTotal +=
            unitTwoUsage;
        }


        const availableUsages = [
          unitOneUsage,
          unitTwoUsage
        ].filter(
          value => {
            return value !==
              null;
          }
        );


        const totalUsage =
          availableUsages.length >
            0
            ? availableUsages.reduce(
                (
                  total,
                  value
                ) => {
                  return total +
                    value;
                },
                0
              )
            : null;


        const updatedAtCandidates = [
          normalizeText(
            dailyItem
              .unitOne
              ?.updatedAt
          ),

          normalizeText(
            dailyItem
              .unitTwo
              ?.updatedAt
          )
        ]
          .filter(
            Boolean
          )
          .sort();


        return {
          usageDate:
            dailyItem.usageDate,

          status,

          unitOne:
            dailyItem.unitOne,

          unitTwo:
            dailyItem.unitTwo,

          unitOneUsage,

          unitTwoUsage,

          totalUsage,

          updatedAt:
            updatedAtCandidates[
              updatedAtCandidates.length -
              1
            ] ||
            ""
        };
      }
    )
    /*
      화면에서는 최신 날짜가 위로 오도록 정렬한다.
    */
    .sort(
      (
        firstItem,
        secondItem
      ) => {
        return secondItem
          .usageDate
          .localeCompare(
            firstItem.usageDate
          );
      }
    );


  return jsonResponse({
    ok:
      true,

    range: {
      startDate,
      endDate,
      dayCount
    },

    summary: {
      unitOneTotal,

      unitTwoTotal,

      totalUsage:
        unitOneTotal +
        unitTwoTotal,

      completeDays,

      partialDays,

      missingDays,

      savedDays:
        completeDays +
        partialDays
    },

    items:
      dailyItems
  });
}

/* =========================================================
  업무일지 사용자 상태 조회

  GET /api/ois-data-requests?id=...
========================================================= */

async function handleUserGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  await expireOldRequests(
    context.env.DB
  );


  const requestId =
    normalizeText(
      requestUrl.searchParams.get(
        "id"
      )
    );


  if (
    !requestId
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "조회할 OIS 요청 ID가 없습니다."
      },
      400
    );
  }


  const requestItem =
    await findRequestById(
      context.env.DB,
      requestId
    );


  if (
    !requestItem
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "OIS 요청을 찾을 수 없습니다."
      },
      404
    );
  }


  return jsonResponse({
    ok:
      true,

    item:
      requestItem
  });
}


/* =========================================================
  회사 PC가 다음 요청 가져오기
========================================================= */

async function handleAgentNextRequest(
  context,
  requestUrl
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  await expireOldRequests(
    context.env.DB
  );


  const requestType =
    normalizeRequestType(
      requestUrl.searchParams.get(
        "requestType"
      )
    );


  /*
    동시에 여러 PC가 요청을 가져가더라도
    한 대만 processing 상태로 바꾸도록 한다.
  */
  for (
    let attempt = 0;
    attempt <
      3;
    attempt +=
      1
  ) {
    const pendingRow =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM ois_data_requests

          WHERE
            status = 'pending'
            AND request_type = ?

          ORDER BY
            requested_at ASC

          LIMIT 1
        `)
        .bind(
          requestType
        )
        .first();


    if (
      !pendingRow
    ) {
      return jsonResponse({
        ok:
          true,

        item:
          null,

        message:
          "처리할 OIS 요청이 없습니다."
      });
    }


    const requestId =
      normalizeText(
        pendingRow.id
      );


    const now =
      new Date()
        .toISOString();


    const updateResult =
      await context.env.DB
        .prepare(`
          UPDATE ois_data_requests

          SET
            status = 'processing',
            started_at = ?,
            agent_id = ?,
            updated_at = ?

          WHERE
            id = ?
            AND status = 'pending'
        `)
        .bind(
          now,
          authentication.agentId,
          now,
          requestId
        )
        .run();


    if (
      Number(
        updateResult?.meta?.changes
      ) !==
        1
    ) {
      continue;
    }


    const claimedRequest =
      await findRequestById(
        context.env.DB,
        requestId
      );


    return jsonResponse({
      ok:
        true,

      item:
        claimedRequest
    });
  }


  return jsonResponse({
    ok:
      true,

    item:
      null,

    message:
      "다른 OIS 연동 프로그램이 요청을 먼저 처리했습니다."
  });
}


/* =========================================================
  GET 분기
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
          ok:
            false,

          message:
            "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      );
    }


    const requestUrl =
      new URL(
        context.request.url
      );


    const action =
      normalizeText(
        requestUrl.searchParams.get(
          "action"
        )
      )
        .toLowerCase()
        .replace(
          /[\s-]+/g,
          "_"
        );


    /*
      저장된 날짜별 사용량
    */
    if (
      action ===
        "usage_records"
    ) {
      return await handleLimestoneUsageRecordsGet(
        context,
        requestUrl
      );
    }

/*
  기간별 저장 사용량 조회
*/
if (
  action ===
    "usage_history"
) {
  return await handleLimestoneUsageHistoryGet(
    context,
    requestUrl
  );
}    

    /*
      기간 계산 진행률
    */
    if (
      action ===
        "usage_batch"
    ) {
      return await handleLimestoneUsageBatchGet(
        context,
        requestUrl
      );
    }


    /*
      회사 PC 다음 요청
    */
    if (
      action ===
        "next"
    ) {
      return await handleAgentNextRequest(
        context,
        requestUrl
      );
    }


    /*
      일반 OIS 요청 상태
    */
    return await handleUserGet(
      context,
      requestUrl
    );

  } catch (
    error
  ) {
    console.error(
      "OIS 요청 조회 오류:",
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
            : "OIS 요청을 조회하지 못했습니다."
      },
      500
    );
  }
}

/* =========================================================
  기간 전체 OIS 계산 요청 생성

  POST:
  {
    action: "create_usage_batch",
    startDate: "2026-08-01",
    endDate: "2026-08-31"
  }

  처리:
  - 날짜별 OIS 요청 생성
  - 날짜별 요청과 배치 작업 연결
  - 화면을 닫아도 회사 PC 에이전트가 계속 처리
========================================================= */

async function createLimestoneUsageBatchRequest(
  context,
  body
) {
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


  const startDate =
    normalizeText(
      body.startDate ||
      body.start_date
    );


  const endDate =
    normalizeText(
      body.endDate ||
      body.end_date
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
          "기간 계산 시작일과 종료일을 확인해 주세요."
      },
      400
    );
  }


  const dates =
    createLimestoneUsageBatchDates(
      startDate,
      endDate
    );


  if (
    dates.length <
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "시작일은 종료일보다 늦을 수 없습니다."
      },
      400
    );
  }


  if (
    dates.length >
      MAXIMUM_LIMESTONE_USAGE_BATCH_DAYS
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          `기간 사용량 계산은 한 번에 최대 ${MAXIMUM_LIMESTONE_USAGE_BATCH_DAYS}일까지 실행할 수 있습니다.`
      },
      400
    );
  }


  await expireOldRequests(
    context.env.DB
  );


  /*
    같은 사용자가 같은 기간을 이미 처리 중이면
    중복 작업을 만들지 않고 기존 작업을 반환한다.
  */
  const existingRow =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM limestone_usage_batches

        WHERE
          start_date = ?
          AND end_date = ?
          AND requested_by_id = ?
          AND status IN (
            'pending',
            'processing'
          )

        ORDER BY
          created_at DESC

        LIMIT 1
      `)
      .bind(
        startDate,
        endDate,
        user.employeeNo
      )
      .first();


  if (
    existingRow
  ) {
    const existingBatch =
      convertLimestoneUsageBatchRow(
        existingRow
      );


    const existingProgress =
      await refreshLimestoneUsageBatchStatus(
        context.env.DB,
        existingBatch.id
      );


    return jsonResponse({
      ok:
        true,

      reused:
        true,

      ...existingProgress,

      message:
        "같은 기간의 사용량 계산을 이미 진행하고 있습니다."
    });
  }


  const batchId =
    crypto.randomUUID();


  const baseTime =
    Date.now();


  const createdAt =
    new Date(
      baseTime
    ).toISOString();


  const statements = [];


  statements.push(
    context.env.DB
      .prepare(`
        INSERT INTO limestone_usage_batches (
          id,

          start_date,
          end_date,
          total_days,

          status,

          requested_by_id,
          requested_by_name,

          created_at,
          completed_at,
          updated_at,

          last_error
        )
        VALUES (
          ?,

          ?,
          ?,
          ?,

          'pending',

          ?,
          ?,

          ?,
          '',
          ?,

          ''
        )
      `)
      .bind(
        batchId,

        startDate,
        endDate,
        dates.length,

        user.employeeNo,
        user.name,

        createdAt,
        createdAt
      )
  );


  dates.forEach(
    (
      usageDate,
      dateIndex
    ) => {
      const requestId =
        crypto.randomUUID();


      /*
        날짜 순서대로 대기열에서 처리되도록
        요청 시각을 1ms씩 증가시킨다.
      */
      const requestedAt =
        new Date(
          baseTime +
          dateIndex
        ).toISOString();


      const expiresAt =
        new Date(
          baseTime +
          (
            LIMESTONE_USAGE_BATCH_QUEUE_HOURS *
            60 *
            60 *
            1000
          ) +
          dateIndex
        ).toISOString();


      statements.push(
        context.env.DB
          .prepare(`
            INSERT INTO ois_data_requests (
              id,

              request_type,
              target_date,
              status,

              requested_by_id,
              requested_by_name,

              requested_at,
              started_at,
              completed_at,

              agent_id,

              result_json,
              error_message,

              expires_at,
              updated_at
            )
            VALUES (
              ?,

              'limestone_stock',
              ?,
              'pending',

              ?,
              ?,

              ?,
              NULL,
              NULL,

              '',

              NULL,
              '',

              ?,
              ?
            )
          `)
          .bind(
            requestId,

            usageDate,

            user.employeeNo,
            user.name,

            requestedAt,

            expiresAt,
            requestedAt
          )
      );


      statements.push(
        context.env.DB
          .prepare(`
            INSERT INTO limestone_usage_batch_items (
              batch_id,
              usage_date,
              ois_request_id,
              created_at
            )
            VALUES (
              ?,
              ?,
              ?,
              ?
            )
          `)
          .bind(
            batchId,
            usageDate,
            requestId,
            requestedAt
          )
      );
    }
  );


  /*
    배치 작업과 날짜별 요청을
    하나의 D1 작업으로 저장한다.
  */
  await context.env.DB.batch(
    statements
  );


  const progress =
    await refreshLimestoneUsageBatchStatus(
      context.env.DB,
      batchId
    );


  return jsonResponse(
    {
      ok:
        true,

      reused:
        false,

      ...progress,

      message:
        `${dates.length}일의 석회석 사용량 계산 요청을 등록했습니다.`
    },
    201
  );
}

/* =========================================================
  업무일지에서 새 OIS 요청 생성
========================================================= */

async function createUserRequest(
  context,
  body
) {
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


  const targetDate =
    normalizeText(
      body.targetDate ||
      body.target_date
    );


  const requestType =
    normalizeRequestType(
      body.requestType ||
      body.request_type
    );


  const forceRefresh =
    body.forceRefresh ===
      true;


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "OIS 조회 날짜를 확인해 주세요."
      },
      400
    );
  }


  await expireOldRequests(
    context.env.DB
  );


  /*
    이미 처리 중인 같은 날짜 요청이 있으면
    새 요청을 만들지 않고 기존 요청을 반환한다.
  */
  const activeRow =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM ois_data_requests

        WHERE
          request_type = ?
          AND target_date = ?
          AND status IN (
            'pending',
            'processing'
          )

        ORDER BY
          requested_at DESC

        LIMIT 1
      `)
      .bind(
        requestType,
        targetDate
      )
      .first();


  if (
    activeRow
  ) {
    return jsonResponse({
      ok:
        true,

      reused:
        true,

      item:
        convertRequestRow(
          activeRow
        ),

      message:
        "같은 날짜의 OIS 자료를 이미 조회하고 있습니다."
    });
  }


  /*
    이미 완료된 결과가 있으면 재사용한다.

    강제 새로고침을 요청한 경우에는
    새 요청을 생성한다.
  */
  if (
    !forceRefresh
  ) {
    const completedRow =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM ois_data_requests

          WHERE
            request_type = ?
            AND target_date = ?
            AND status = 'complete'

          ORDER BY
            completed_at DESC,
            requested_at DESC

          LIMIT 1
        `)
        .bind(
          requestType,
          targetDate
        )
        .first();


    if (
      completedRow
    ) {
      return jsonResponse({
        ok:
          true,

        reused:
          true,

        item:
          convertRequestRow(
            completedRow
          ),

        message:
          "저장된 OIS 조회 결과를 불러왔습니다."
      });
    }
  }


  const requestId =
    crypto.randomUUID();


  const requestedAt =
    new Date();


  const expiresAt =
    new Date(
      requestedAt.getTime() +
      (
        REQUEST_TIMEOUT_MINUTES *
        60 *
        1000
      )
    );


  const requestedAtText =
    requestedAt.toISOString();


  const expiresAtText =
    expiresAt.toISOString();


  await context.env.DB
    .prepare(`
      INSERT INTO ois_data_requests (
        id,

        request_type,
        target_date,
        status,

        requested_by_id,
        requested_by_name,

        requested_at,
        started_at,
        completed_at,

        agent_id,

        result_json,
        error_message,

        expires_at,
        updated_at
      )
      VALUES (
        ?,

        ?,
        ?,
        'pending',

        ?,
        ?,

        ?,
        NULL,
        NULL,

        '',

        NULL,
        '',

        ?,
        ?
      )
    `)
    .bind(
      requestId,

      requestType,
      targetDate,

      user.employeeNo,
      user.name,

      requestedAtText,

      expiresAtText,
      requestedAtText
    )
    .run();


  const createdRequest =
    await findRequestById(
      context.env.DB,
      requestId
    );


  return jsonResponse(
    {
      ok:
        true,

      reused:
        false,

      item:
        createdRequest,

      message:
        "OIS 자료 조회를 요청했습니다."
    },
    201
  );
}



/* =========================================================
  회사 PC 처리 완료

  석회석 재고 조회인 경우:
  1. OIS 결과 검증
  2. 당일 입고량 조회
  3. 사용량 자동 계산
  4. limestone_usage_records 저장
  5. OIS 요청 완료 처리
========================================================= */

async function completeAgentRequest(
  context,
  body
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const requestId =
    normalizeText(
      body.requestId ||
      body.request_id
    );


  if (
    !requestId
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "완료할 OIS 요청 ID가 없습니다."
      },
      400
    );
  }


  const existingRequest =
    await findRequestById(
      context.env.DB,
      requestId
    );


  if (
    !existingRequest
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "완료할 OIS 요청을 찾을 수 없습니다."
      },
      404
    );
  }


  if (
    ![
      "pending",
      "processing"
    ].includes(
      existingRequest.status
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          `현재 상태가 ${existingRequest.status}이므로 완료 처리할 수 없습니다.`
      },
      409
    );
  }


  let normalizedResult;


  let limestoneUsageRecords = [];


  if (
    existingRequest.requestType ===
      "limestone_stock"
  ) {
    const validation =
      normalizeLimestoneStockResult(
        body.result,
        existingRequest.targetDate
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


    normalizedResult =
      validation.result;


    /*
      OIS 요청을 완료 처리하기 전에
      사용량 계산·저장을 먼저 실행한다.

      저장 실패 시 요청이 complete로 바뀌지 않으므로
      계산값 없는 완료 요청이 생기지 않는다.
    */

const batchLink =
  await findLimestoneUsageBatchLinkByRequestId(
    context.env.DB,
    requestId
  );


limestoneUsageRecords =
  await saveLimestoneUsageRecords(
    context.env.DB,
    {
      requestItem:
        existingRequest,

      normalizedResult,

      agentId:
        authentication.agentId,

      calculationMode:
        batchLink
          ? "batch"
          : "single",

      batchId:
        batchLink?.batchId ||
        ""
    }
  );      

  } else {
    normalizedResult =
      body.result &&
      typeof body.result ===
        "object"
        ? body.result
        : {};
  }


  const now =
    new Date()
      .toISOString();


  const updateResult =
    await context.env.DB
      .prepare(`
        UPDATE ois_data_requests

        SET
          status = 'complete',
          completed_at = ?,
          agent_id = ?,
          result_json = ?,
          error_message = '',
          updated_at = ?

        WHERE
          id = ?
          AND status IN (
            'pending',
            'processing'
          )
      `)
      .bind(
        now,
        authentication.agentId,
        JSON.stringify(
          normalizedResult
        ),
        now,
        requestId
      )
      .run();


  if (
    Number(
      updateResult?.meta?.changes
    ) !==
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "OIS 요청 상태가 변경되어 완료 처리하지 못했습니다."
      },
      409
    );
  }


  const completedRequest =
    await findRequestById(
      context.env.DB,
      requestId
    );


  return jsonResponse({
    ok:
      true,

    item: {
      ...completedRequest,

      usageRecords:
        limestoneUsageRecords
    },

    usageRecords:
      limestoneUsageRecords,

    message:
      existingRequest.requestType ===
        "limestone_stock"
        ? "OIS 조회 결과와 석회석 사용량을 저장했습니다."
        : "OIS 조회 결과를 저장했습니다."
  });
}

/* =========================================================
  회사 PC 처리 실패
========================================================= */

async function failAgentRequest(
  context,
  body
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const requestId =
    normalizeText(
      body.requestId ||
      body.request_id
    );


  const errorMessage =
    normalizeText(
      body.errorMessage ||
      body.error_message
    ).slice(
      0,
      1000
    ) ||
    "OIS 조회에 실패했습니다.";


  if (
    !requestId
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "실패 처리할 OIS 요청 ID가 없습니다."
      },
      400
    );
  }


  const now =
    new Date()
      .toISOString();


  const updateResult =
    await context.env.DB
      .prepare(`
        UPDATE ois_data_requests

        SET
          status = 'failed',
          completed_at = ?,
          agent_id = ?,
          error_message = ?,
          updated_at = ?

        WHERE
          id = ?
          AND status IN (
            'pending',
            'processing'
          )
      `)
      .bind(
        now,
        authentication.agentId,
        errorMessage,
        now,
        requestId
      )
      .run();


  if (
    Number(
      updateResult?.meta?.changes
    ) !==
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "실패 처리할 수 있는 OIS 요청이 없습니다."
      },
      409
    );
  }


  return jsonResponse({
    ok:
      true,

    item:
      await findRequestById(
        context.env.DB,
        requestId
      ),

    message:
      "OIS 조회 실패 내용을 저장했습니다."
  });
}


/* =========================================================
  POST 분기
========================================================= */

export async function onRequestPost(
  context
) {
  try {
    if (
      !context.env.DB
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      );
    }


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


    /*
      회사 PC 조회 완료
    */
    if (
      action ===
        "complete"
    ) {
      return await completeAgentRequest(
        context,
        body
      );
    }


    /*
      회사 PC 조회 실패
    */
    if (
      action ===
        "fail"
    ) {
      return await failAgentRequest(
        context,
        body
      );
    }


    /*
      기간 전체 사용량 계산
    */
    if (
      action ===
        "create_usage_batch"
    ) {
      return await createLimestoneUsageBatchRequest(
        context,
        body
      );
    }


    /*
      단일 날짜 OIS 조회
    */
    return await createUserRequest(
      context,
      body
    );

  } catch (
    error
  ) {
    console.error(
      "OIS 요청 저장 오류:",
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
            : "OIS 요청을 저장하지 못했습니다."
      },
      500
    );
  }
}