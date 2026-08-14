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


/*
  에이전트가 요청을 가져가기 전
  대기열에서 기다릴 수 있는 시간
*/
const REQUEST_TIMEOUT_MINUTES =
  60;


/*
  에이전트가 요청을 가져간 뒤
  실제 OIS 조회를 완료할 수 있는 시간
*/
const REQUEST_PROCESSING_TIMEOUT_MINUTES =
  30;

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
  OIS 과거 업무일지 기간 가져오기

  한 번 요청:
  최대 62일

  대기열 보존:
  최대 72시간

  긴 과거 기간은 홈페이지에서
  62일씩 자동으로 나누어 등록한다.
========================================================= */

const MAXIMUM_OIS_LEGACY_BATCH_DAYS =
  62;


const OIS_LEGACY_BATCH_QUEUE_HOURS =
  72;  

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
  - auxiliary_materials
  - silo_level
  - daily_data_excel
  - steam_status
  - logsheet_approval
========================================================= */

const OIS_REQUEST_TYPES = [
  "limestone_stock",
  "water_environment",
  "turbine_gear_pinion",
  "auxiliary_materials",
  "silo_level",
  "daily_data_excel",
  "steam_status",
  "logsheet_approval"
];


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


  return OIS_REQUEST_TYPES.includes(
    requestType
  )
    ? requestType
    : DEFAULT_REQUEST_TYPE;
}


/* =========================================================
  에이전트 통합 조회용 요청 유형 목록 정리

  예:
  water_environment,limestone_stock,silo_level

  - 지원 유형만 허용
  - 중복 제거
  - 전달된 순서는 그대로 유지
========================================================= */

function normalizeRequestTypeList(
  value
) {
  const requestTypes = [];


  const seenRequestTypes =
    new Set();


  String(
    value ||
    ""
  )
    .split(
      ","
    )
    .forEach(
      rawRequestType => {
        const requestType =
          normalizeText(
            rawRequestType
          )
            .toLowerCase()
            .replace(
              /[\s-]+/g,
              "_"
            );


        if (
          !OIS_REQUEST_TYPES.includes(
            requestType
          ) ||
          seenRequestTypes.has(
            requestType
          )
        ) {
          return;
        }


        seenRequestTypes.add(
          requestType
        );


        requestTypes.push(
          requestType
        );
      }
    );


  return requestTypes;
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


  /*
    실제 석회석 입고기록 기준으로
    1·2호기 입고량을 다시 계산한다.
  */
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


  /*
    2026-08-10부터는
    석회석 관리와 부재료 관리가 연동된다.
  */
  const shouldSyncAuxiliaryMaterial =
    usageDate >=
      "2026-08-10";


  /*
    부재료 테이블이 없는 환경에서도
    안전하게 연동할 수 있도록 준비한다.
  */
  if (
    shouldSyncAuxiliaryMaterial
  ) {
    await ensureAuxiliaryMaterialDailyTable(
      database
    );
  }


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


    /*
      사용량 =
      전일 재고 + 당일 입고량 - 24시 재고
    */
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


    /* =====================================================
      1. 석회석 사용량 원본 저장
    ====================================================== */

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


    /* =====================================================
      2. 부재료 일별 현황 동기화

      중요:
      부재료 행이 이미 존재하는 경우에만 갱신한다.

      여기서 신규 부재료 행을 만들지는 않는다.

      동기화:
      - 시작 재고
      - 입고량
      - 종료 재고
      - Limestone 사용량

      그 외:
      - SOx
      - NOx
      - Slurry
      - Lime Powder
      - Ammonia

      기존 값을 그대로 유지한다.
    ====================================================== */

    if (
      shouldSyncAuxiliaryMaterial
    ) {
      await database
        .prepare(`
          UPDATE auxiliary_material_daily

          SET
            limestone_start_stock = ?,
            limestone_receipt_ton = ?,
            limestone_end_stock = ?,
            limestone_usage_tpd = ?,

            updated_by_id = ?,
            updated_by_name = ?,
            updated_at = ?,

            revision =
              revision + 1

          WHERE
            record_date = ?
            AND unit_no = ?
        `)
        .bind(
          startStock,
          receiptQuantity,
          endStock,
          usageQuantity,

          requestedById,
          requestedByName,
          timestamp,

          usageDate,
          unitNo
        )
        .run();
    }
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
  OIS 과거 LOG SHEET 업무일지 결과 정규화

  중요:
  - DAY / AFTER / NIGHT 원본을 그대로 보존
  - 이 단계에서는 DS / NS 변환하지 않음
  - 내용 없는 AFTER 행도 저장하여
    향후 2교대 전환시점 확인에 사용
========================================================= */

function normalizeOisLegacyApprovalResult(
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


  const allowedRoles =
    new Set([
      "TGO",
      "BCO1",
      "BCO2",
      "TO",
      "BO1",
      "BO2"
    ]);


  const allowedShifts =
    new Set([
      "DAY",
      "AFTER",
      "NIGHT"
    ]);


  const rawRecords =
    Array.isArray(
      result.records
    )
      ? result.records
      : [];


  const records =
    rawRecords
      .map(
        (
          rawRecord,
          recordIndex
        ) => {
          const source =
            rawRecord &&
            typeof rawRecord ===
              "object"
              ? rawRecord
              : {};


          const original =
            source.original &&
            typeof source.original ===
              "object"
              ? source.original
              : {};


          const role =
            normalizeText(
              source.role ||
              original.sheet_alias ||
              original.sheetAlias
            )
              .toUpperCase();


          const originalShift =
            normalizeText(
              source.originalShift ||
              source.original_shift ||
              original.time ||
              original.work_time
            )
              .toUpperCase();


          if (
            !allowedRoles.has(
              role
            ) ||
            !allowedShifts.has(
              originalShift
            )
          ) {
            return null;
          }


          /*
            업무내용은 줄바꿈을 보존한다.
          */

          const content =
            String(
              source.content ??
              original.rmk ??
              ""
            )
              .replace(
                /\r\n?/g,
                "\n"
              )
              .trim();


          return {
            workDate:
              targetDate,

            role,

            originalShift,

            worker:
              normalizeText(
                source.worker ||
                original.worker
              ),

            content,

            hasContent:
              Boolean(
                content
              ),

            workerApproval:
              normalizeText(
                source.workerApproval ||
                source.worker_approval ||
                original.work_state
              ),

            partApproval:
              normalizeText(
                source.partApproval ||
                source.part_approval ||
                original.part_state
              ),

            approvalState:
              normalizeText(
                source.approvalState ||
                source.approval_state ||
                original.aprv_state
              ),

            oisState:
              normalizeText(
                source.state ||
                original.state
              ),

            sheetCode:
              normalizeText(
                source.sheetCode ||
                source.sheet_code ||
                original.sheet_code ||
                original.sheet ||
                original.pos_info_code
              ),

            sourceRowIndex:
              Number(
                source.sourceRowIndex ??
                recordIndex
              ),

            original:
              Object.keys(
                original
              ).length
                ? original
                : source
          };
        }
      )
      .filter(
        Boolean
      );


  return {
    result: {
      ...result,

      targetDate,

      records
    }
  };
}


/* =========================================================
  OIS 과거 LOG SHEET 업무일지 D1 저장

  고유 기준:
  날짜 + 보직 + 원본 근무

  예:
  2022-09-22 + BCO1 + NIGHT

  같은 자료를 다시 가져오면
  신규 행을 만들지 않고 최신값으로 갱신한다.
========================================================= */

async function saveOisLegacyApprovalRecords(
  database,
  options
) {
  const requestItem =
    options?.requestItem ||
    {};


  const normalizedResult =
    options?.normalizedResult ||
    {};


  const agentId =
    normalizeText(
      options?.agentId
    );


  const targetDate =
    normalizeText(
      normalizedResult.targetDate ||
      requestItem.targetDate
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    throw new Error(
      "OIS 과거 업무일지 저장 날짜가 올바르지 않습니다."
    );
  }


  const records =
    Array.isArray(
      normalizedResult.records
    )
      ? normalizedResult.records
      : [];


  const now =
    new Date()
      .toISOString();


  const requestId =
    normalizeText(
      requestItem.id
    );


  const collectedAt =
    normalizeText(
      normalizedResult.collectedAt
    ) ||
    now;


  let createdCount =
    0;


  let updatedCount =
    0;


  for (
    const record of
    records
  ) {
    const role =
      normalizeText(
        record.role
      )
        .toUpperCase();


    const originalShift =
      normalizeText(
        record.originalShift
      )
        .toUpperCase();


    if (
      !role ||
      !originalShift
    ) {
      continue;
    }


    const existingRow =
      await database
        .prepare(`
          SELECT
            id

          FROM ois_legacy_logs

          WHERE
            work_date = ?
            AND role = ?
            AND original_shift = ?

          LIMIT 1
        `)
        .bind(
          targetDate,
          role,
          originalShift
        )
        .first();


    const recordId =
      normalizeText(
        existingRow?.id
      ) ||
      crypto.randomUUID();


    await database
      .prepare(`
        INSERT INTO ois_legacy_logs (
          id,

          work_date,
          role,
          original_shift,

          worker,
          content,
          has_content,

          worker_approval,
          part_approval,
          approval_state,
          ois_state,

          sheet_code,

          ois_request_id,
          collected_at,

          original_json,

          created_at,
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
          ?,

          ?,

          ?,
          ?,

          ?,

          ?,
          ?
        )

        ON CONFLICT (
          work_date,
          role,
          original_shift
        )
        DO UPDATE SET
          worker =
            excluded.worker,

          content =
            excluded.content,

          has_content =
            excluded.has_content,

          worker_approval =
            excluded.worker_approval,

          part_approval =
            excluded.part_approval,

          approval_state =
            excluded.approval_state,

          ois_state =
            excluded.ois_state,

          sheet_code =
            excluded.sheet_code,

          ois_request_id =
            excluded.ois_request_id,

          collected_at =
            excluded.collected_at,

          original_json =
            excluded.original_json,

          updated_at =
            excluded.updated_at
      `)
      .bind(
        recordId,

        targetDate,
        role,
        originalShift,

        normalizeText(
          record.worker
        ),

        String(
          record.content ||
          ""
        ),

        record.hasContent
          ? 1
          : 0,

        normalizeText(
          record.workerApproval
        ),

        normalizeText(
          record.partApproval
        ),

        normalizeText(
          record.approvalState
        ),

        normalizeText(
          record.oisState
        ),

        normalizeText(
          record.sheetCode
        ),

        requestId,

        collectedAt,

        JSON.stringify(
          record.original ||
          {}
        ),

        existingRow
          ? now
          : now,

        now
      )
      .run();


    if (
      existingRow
    ) {
      updatedCount +=
        1;

    } else {
      createdCount +=
        1;
    }
  }


  return {
    targetDate,

    totalCount:
      records.length,

    createdCount,

    updatedCount,

    agentId
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
  부재료 자료 적용 기준

  - 2026-08-09까지: 기존 엑셀 업로드 자료
  - 2026-08-10부터: OIS 자동수집 자료
========================================================= */

const AUXILIARY_MATERIAL_EXCEL_END_DATE =
  "2026-08-09";


const AUXILIARY_MATERIAL_OIS_START_DATE =
  "2026-08-10";


const MAXIMUM_AUXILIARY_MATERIAL_IMPORT_DAYS =
  40;


/* =========================================================
  기존 D1 테이블에 새 열을 안전하게 추가
========================================================= */

async function ensureAuxiliaryMaterialDailyColumn(
  database,
  columnName,
  columnDefinition
) {
  const tableInfo =
    await database
      .prepare(`
        PRAGMA table_info(
          auxiliary_material_daily
        )
      `)
      .all();


  const hasColumn =
    (
      Array.isArray(
        tableInfo.results
      )
        ? tableInfo.results
        : []
    ).some(
      column =>
        normalizeText(
          column.name
        ) ===
        columnName
    );


  if (
    hasColumn
  ) {
    return;
  }


  try {
    await database
      .prepare(`
        ALTER TABLE
          auxiliary_material_daily
        ADD COLUMN
          ${columnDefinition}
      `)
      .run();

  } catch (
    error
  ) {
    const message =
      normalizeText(
        error instanceof Error
          ? error.message
          : error
      );


    /*
      동시에 최초 접근한 요청이 먼저 열을 추가한 경우는
      정상 완료로 처리한다.
    */
    if (
      !/duplicate column name/i.test(
        message
      )
    ) {
      throw error;
    }
  }
}


/* =========================================================
  부재료 일별 자료 D1 테이블

  한 행:
  - 날짜 1일
  - 호기 1개

  저장 항목:
  - Limestone 입고·재고·사용량
  - Lime Slurry 합산 유량·밀도·Lime Powder
  - Ammonia
  - SOx / NOx
  - 비고
  - 자료 출처
========================================================= */

async function ensureAuxiliaryMaterialDailyTable(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS auxiliary_material_daily (
        id TEXT PRIMARY KEY,
        record_date TEXT NOT NULL,
        unit_no INTEGER NOT NULL,

        limestone_start_stock REAL,
        limestone_receipt_ton REAL,
        limestone_end_stock REAL,
        limestone_usage_tpd REAL,

        lime_slurry_flow_m3h REAL,
        lime_slurry_density_kgm3 REAL,
        lime_powder_tpd REAL,

        ammonia_flow_m3h REAL,
        ammonia_m3d REAL,

        sox_ppm REAL,
        nox_ppm REAL,

        remarks TEXT NOT NULL DEFAULT '',
        data_source TEXT NOT NULL DEFAULT 'ois',

        sample_count INTEGER NOT NULL DEFAULT 0,
        is_complete INTEGER NOT NULL DEFAULT 0,

        source_tags_json TEXT NOT NULL DEFAULT '{}',
        raw_result_json TEXT NOT NULL DEFAULT '{}',

        ois_request_id TEXT NOT NULL DEFAULT '',
        ois_collected_at TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL DEFAULT '',

        created_by_id TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        updated_by_id TEXT NOT NULL DEFAULT '',
        updated_by_name TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,

        UNIQUE(record_date, unit_no)
      )
    `)
    .run();


  /*
    이미 만들어진 운영 D1 테이블에도
    비고와 자료 출처 열을 추가한다.
  */
  await ensureAuxiliaryMaterialDailyColumn(
    database,
    "remarks",
    "remarks TEXT NOT NULL DEFAULT ''"
  );


  await ensureAuxiliaryMaterialDailyColumn(
    database,
    "data_source",
    "data_source TEXT NOT NULL DEFAULT 'ois'"
  );


  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_auxiliary_material_daily_date

      ON auxiliary_material_daily (
        record_date,
        unit_no
      )
    `)
    .run();


  await ensureAuxiliaryMaterialDensitySettingsTable(
    database
  );
}


/* =========================================================
  Slurry 밀도 고정값 D1 테이블

  - 1호기·2호기별 한 행
  - 적용 시작일 이후 OIS 저장자료에 고정값 우선 적용
========================================================= */

async function ensureAuxiliaryMaterialDensitySettingsTable(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS auxiliary_material_density_settings (
        unit_no INTEGER PRIMARY KEY,
        density_kgm3 REAL NOT NULL,
        effective_from TEXT NOT NULL,

        created_by_id TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        updated_by_id TEXT NOT NULL DEFAULT '',
        updated_by_name TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,

        CHECK (unit_no IN (1, 2))
      )
    `)
    .run();
}


function convertAuxiliaryMaterialDensitySetting(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  const unitNo =
    Number(
      row.unit_no
    );


  const densityKgm3 =
    normalizeAuxiliaryMaterialNumber(
      row.density_kgm3
    );


  const effectiveFrom =
    normalizeText(
      row.effective_from
    );


  if (
    !(
      unitNo ===
        1 ||
      unitNo ===
        2
    ) ||
    densityKgm3 ===
      null ||
    !isValidIsoDate(
      effectiveFrom
    )
  ) {
    return null;
  }


  return {
    unitNo,
    densityKgm3,
    effectiveFrom,

    updatedByName:
      normalizeText(
        row.updated_by_name
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


async function loadAuxiliaryMaterialDensitySettings(
  database
) {
  await ensureAuxiliaryMaterialDensitySettingsTable(
    database
  );


  const result =
    await database
      .prepare(`
        SELECT *
        FROM auxiliary_material_density_settings
        ORDER BY unit_no ASC
      `)
      .all();


  return (
    Array.isArray(
      result.results
    )
      ? result.results
      : []
  )
    .map(
      convertAuxiliaryMaterialDensitySetting
    )
    .filter(
      Boolean
    );
}

function normalizeAuxiliaryMaterialNumber(
  value,
  decimalPlaces = 6
) {
  if (
    value ===
      null ||
    value ===
      undefined ||
    String(
      value
    ).trim() ===
      ""
  ) {
    return null;
  }


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


  const multiplier =
    10 **
    decimalPlaces;


  return Math.round(
    numericValue *
    multiplier
  ) /
  multiplier;
}


function calculateLimePowderTonPerDay(
  totalSlurryFlow,
  density
) {
  const flowValue =
    normalizeAuxiliaryMaterialNumber(
      totalSlurryFlow
    );


  const densityValue =
    normalizeAuxiliaryMaterialNumber(
      density
    );


  if (
    flowValue ===
      null ||
    densityValue ===
      null ||
    flowValue <=
      0 ||
    densityValue <=
      1000
  ) {
    return null;
  }


  /*
    기존 부재료 엑셀과 같은 계산식

    (A+B+C) × 밀도
    × (밀도-1000)/(1102-1000)
    × 15% × 24시간 ÷ 1000
  */
  return normalizeAuxiliaryMaterialNumber(
    flowValue *
    densityValue *
    (
      densityValue -
      1000
    ) /
    (
      1102 -
      1000
    ) *
    0.15 *
    24 /
    1000
  );
}


function convertAuxiliaryMaterialRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  let sourceTags = {};


  try {
    sourceTags =
      JSON.parse(
        normalizeText(
          row.source_tags_json
        ) ||
        "{}"
      );

  } catch {
    sourceTags = {};
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    recordDate:
      normalizeText(
        row.record_date
      ),

    unitNo:
      Number(
        row.unit_no
      ),

    limestoneStartStock:
      normalizeAuxiliaryMaterialNumber(
        row.limestone_start_stock
      ),

    limestoneReceiptTon:
      normalizeAuxiliaryMaterialNumber(
        row.limestone_receipt_ton
      ),

    limestoneEndStock:
      normalizeAuxiliaryMaterialNumber(
        row.limestone_end_stock
      ),

    limestoneUsageTpd:
      normalizeAuxiliaryMaterialNumber(
        row.limestone_usage_tpd
      ),

    limeSlurryFlowM3h:
      normalizeAuxiliaryMaterialNumber(
        row.lime_slurry_flow_m3h
      ),

    limeSlurryDensityKgm3:
      normalizeAuxiliaryMaterialNumber(
        row.lime_slurry_density_kgm3
      ),

    limePowderTpd:
      normalizeAuxiliaryMaterialNumber(
        row.lime_powder_tpd
      ),

    ammoniaFlowM3h:
      normalizeAuxiliaryMaterialNumber(
        row.ammonia_flow_m3h
      ),

    ammoniaM3d:
      normalizeAuxiliaryMaterialNumber(
        row.ammonia_m3d
      ),

    soxPpm:
      normalizeAuxiliaryMaterialNumber(
        row.sox_ppm
      ),

    noxPpm:
      normalizeAuxiliaryMaterialNumber(
        row.nox_ppm
      ),

    sampleCount:
      Number(
        row.sample_count
      ) ||
      0,

    isComplete:
      Number(
        row.is_complete
      ) ===
      1,

    sourceTags,

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


async function saveAuxiliaryMaterialDailyRecords(
  database,
  options
) {
  await ensureAuxiliaryMaterialDailyTable(
    database
  );


  const requestItem =
    options?.requestItem ||
    {};


  const rawResult =
    options?.rawResult &&
    typeof options.rawResult ===
      "object" &&
    !Array.isArray(
      options.rawResult
    )
      ? options.rawResult
      : {};


  const recordDate =
    normalizeText(
      rawResult.targetDate ||
      requestItem.targetDate
    );


  if (
    !isValidIsoDate(
      recordDate
    )
  ) {
    throw new Error(
      "부재료 저장 날짜가 올바르지 않습니다."
    );
  }


  /*
    해당 날짜에 적용되는
    1·2호기 Slurry 고정 밀도
  */
  const fixedDensitySettings =
    await loadAuxiliaryMaterialDensitySettings(
      database
    );


  const fixedDensityByUnit =
    new Map(
      fixedDensitySettings
        .filter(
          setting =>
            recordDate >=
            setting.effectiveFrom
        )
        .map(
          setting => [
            setting.unitNo,
            setting.densityKgm3
          ]
        )
    );


  const receiptByUnit =
    await loadLimestoneReceiptQuantitiesByUnit(
      database,
      recordDate
    );


  const requestedById =
    normalizeEmployeeNo(
      requestItem.requestedById
    );


  const requestedByName =
    normalizeText(
      requestItem.requestedByName
    );


  const agentId =
    normalizeText(
      options?.agentId ||
      requestItem.agentId
    );


  const collectedAt =
    normalizeText(
      rawResult.collectedAt
    );


  const now =
    new Date()
      .toISOString();


  const unitDefinitions = [
    {
      unitNo:
        1,

      result:
        rawResult.unitOne ||
        rawResult.unit1 ||
        {}
    },

    {
      unitNo:
        2,

      result:
        rawResult.unitTwo ||
        rawResult.unit2 ||
        {}
    }
  ];


  const savedItems = [];


  for (
    const unitDefinition of
    unitDefinitions
  ) {
    const unitNo =
      unitDefinition.unitNo;


    const result =
      unitDefinition.result;


    const startStock =
      normalizeAuxiliaryMaterialNumber(
        result.startStock
      );


    const endStock =
      normalizeAuxiliaryMaterialNumber(
        result.endStock
      );


    const receiptQuantity =
      normalizeAuxiliaryMaterialNumber(
        receiptByUnit[
          unitNo
        ] ||
        0
      );


    const limestoneUsage =
      startStock !==
        null &&
      endStock !==
        null &&
      receiptQuantity !==
        null
        ? normalizeLimestoneUsageNumber(
            startStock +
            receiptQuantity -
            endStock
          )
        : null;


    const totalSlurryFlow =
      normalizeAuxiliaryMaterialNumber(
        result.limeSlurryFlowM3h
      );


    /*
      OIS에서 조회한 원래 밀도
    */
    const oisDensity =
      normalizeAuxiliaryMaterialNumber(
        result.limeSlurryDensityKgm3
      );


    /*
      적용 시작일 이후에는
      저장된 호기별 고정 밀도를 우선 사용한다.

      적용되는 고정값이 없으면
      OIS 조회 밀도를 그대로 사용한다.
    */
    const fixedDensity =
      normalizeAuxiliaryMaterialNumber(
        fixedDensityByUnit.has(
          unitNo
        )
          ? fixedDensityByUnit.get(
              unitNo
            )
          : null
      );


    const density =
      fixedDensity !==
        null
        ? fixedDensity
        : oisDensity;


    /*
      최종 적용된 밀도로
      Lime Powder를 다시 계산한다.
    */
    const limePowder =
      calculateLimePowderTonPerDay(
        totalSlurryFlow,
        density
      );


    const ammoniaFlow =
      normalizeAuxiliaryMaterialNumber(
        result.ammoniaFlowM3h
      );


    const ammoniaM3d =
      ammoniaFlow !==
        null
        ? normalizeAuxiliaryMaterialNumber(
            ammoniaFlow *
            24
          )
        : null;


    const soxPpm =
      normalizeAuxiliaryMaterialNumber(
        result.soxPpm
      );


    const noxPpm =
      normalizeAuxiliaryMaterialNumber(
        result.noxPpm
      );


    const sampleCount =
      Math.max(
        0,
        Math.min(
          24,
          Number(
            result.sampleCount
          ) ||
          0
        )
      );


    const isComplete =
      sampleCount >=
        24 &&
      limestoneUsage !==
        null &&
      limePowder !==
        null &&
      ammoniaM3d !==
        null &&
      soxPpm !==
        null &&
      noxPpm !==
        null;


    await database
      .prepare(`
        INSERT INTO auxiliary_material_daily (
          id,
          record_date,
          unit_no,

          limestone_start_stock,
          limestone_receipt_ton,
          limestone_end_stock,
          limestone_usage_tpd,

          lime_slurry_flow_m3h,
          lime_slurry_density_kgm3,
          lime_powder_tpd,

          ammonia_flow_m3h,
          ammonia_m3d,

          sox_ppm,
          nox_ppm,

          sample_count,
          is_complete,

          source_tags_json,
          raw_result_json,

          ois_request_id,
          ois_collected_at,
          agent_id,

          created_by_id,
          created_by_name,
          updated_by_id,
          updated_by_name,

          created_at,
          updated_at,
          revision
        )
        VALUES (
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, 1
        )

        ON CONFLICT (
          record_date,
          unit_no
        )
        DO UPDATE SET
          limestone_start_stock = excluded.limestone_start_stock,
          limestone_receipt_ton = excluded.limestone_receipt_ton,
          limestone_end_stock = excluded.limestone_end_stock,
          limestone_usage_tpd = excluded.limestone_usage_tpd,
          lime_slurry_flow_m3h = excluded.lime_slurry_flow_m3h,
          lime_slurry_density_kgm3 = excluded.lime_slurry_density_kgm3,
          lime_powder_tpd = excluded.lime_powder_tpd,
          ammonia_flow_m3h = excluded.ammonia_flow_m3h,
          ammonia_m3d = excluded.ammonia_m3d,
          sox_ppm = excluded.sox_ppm,
          nox_ppm = excluded.nox_ppm,
          sample_count = excluded.sample_count,
          is_complete = excluded.is_complete,
          source_tags_json = excluded.source_tags_json,
          raw_result_json = excluded.raw_result_json,
          ois_request_id = excluded.ois_request_id,
          ois_collected_at = excluded.ois_collected_at,
          agent_id = excluded.agent_id,
          updated_by_id = excluded.updated_by_id,
          updated_by_name = excluded.updated_by_name,
          updated_at = excluded.updated_at,
          revision = auxiliary_material_daily.revision + 1
      `)
      .bind(
        crypto.randomUUID(),
        recordDate,
        unitNo,

        startStock,
        receiptQuantity,
        endStock,
        limestoneUsage,

        totalSlurryFlow,
        density,
        limePowder,

        ammoniaFlow,
        ammoniaM3d,

        soxPpm,
        noxPpm,

        sampleCount,
        isComplete
          ? 1
          : 0,

        JSON.stringify(
          result.tags ||
          {}
        ),
        JSON.stringify(
          result
        ),

        normalizeText(
          requestItem.id
        ),
        collectedAt,
        agentId,

        requestedById,
        requestedByName,
        requestedById,
        requestedByName,

        now,
        now
      )
      .run();


    const savedRow =
      await database
        .prepare(`
          SELECT *
          FROM auxiliary_material_daily
          WHERE record_date = ?
            AND unit_no = ?
          LIMIT 1
        `)
        .bind(
          recordDate,
          unitNo
        )
        .first();


    savedItems.push(
      convertAuxiliaryMaterialRow(
        savedRow
      )
    );
  }


  return savedItems.filter(
    Boolean
  );
}

async function handleAuxiliaryMaterialHistoryGet(
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


  const dayCount =
    getLimestoneUsageBatchDayCount(
      startDate,
      endDate
    );


  if (
    dayCount <
      1 ||
    dayCount >
      366
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "부재료 조회 기간은 1일 이상 366일 이하로 선택해 주세요."
      },
      400
    );
  }


  await ensureAuxiliaryMaterialDailyTable(
    context.env.DB
  );


  const [
    queryResult,
    fixedDensitySettings
  ] =
    await Promise.all([
      context.env.DB
        .prepare(`
          SELECT *
          FROM auxiliary_material_daily
          WHERE record_date >= ?
            AND record_date <= ?
          ORDER BY record_date DESC,
                   unit_no ASC
        `)
        .bind(
          startDate,
          endDate
        )
        .all(),

      loadAuxiliaryMaterialDensitySettings(
        context.env.DB
      )
    ]);


  const records =
    (
      Array.isArray(
        queryResult.results
      )
        ? queryResult.results
        : []
    )
      .map(
        convertAuxiliaryMaterialRow
      )
      .filter(
        Boolean
      );


  const savedDateCount =
    new Set(
      records.map(
        item => item.recordDate
      )
    ).size;


  return jsonResponse({
    ok:
      true,

    range: {
      startDate,
      endDate,
      dayCount
    },

    summary: {
      savedDateCount,

      missingDateCount:
        Math.max(
          0,
          dayCount -
          savedDateCount
        ),

      completeRecordCount:
        records.filter(
          item => item.isComplete
        ).length,

      recordCount:
        records.length
    },

    items:
      records,

    fixedDensitySettings
  });
}

/* =========================================================
  부재료 수동 수정값 확인
========================================================= */

function normalizeAuxiliaryMaterialManualValue(
  value,
  label,
  options = {}
) {
  const normalizedText =
    normalizeText(
      value
    );


  if (
    value ===
      null ||
    value ===
      undefined ||
    normalizedText ===
      "" ||
    normalizedText ===
      "-" ||
    normalizedText ===
      "—"
  ) {
    return null;
  }


  const numericValue =
    Number(
      String(
        value
      ).replace(
        /,/g,
        ""
      )
    );


  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    throw new Error(
      `${label} 값을 숫자로 입력해 주세요.`
    );
  }


  const minimum =
    Number.isFinite(
      Number(
        options.minimum
      )
    )
      ? Number(
          options.minimum
        )
      : 0;


  const maximum =
    Number.isFinite(
      Number(
        options.maximum
      )
    )
      ? Number(
          options.maximum
        )
      : 1000000;


  const isMinimumExclusive =
    options.minimumExclusive ===
      true;


  if (
    (
      isMinimumExclusive
        ? numericValue <=
          minimum
        : numericValue <
          minimum
    ) ||
    numericValue >
      maximum
  ) {
    const minimumText =
      isMinimumExclusive
        ? `${minimum} 초과`
        : `${minimum} 이상`;


    throw new Error(
      `${label} 값은 ${minimumText} ${maximum} 이하로 입력해 주세요.`
    );
  }


  return normalizeAuxiliaryMaterialNumber(
    numericValue
  );
}

function normalizeAuxiliaryMaterialManualRecord(
  rawItem,
  itemIndex
) {
  const recordDate =
    normalizeText(
      rawItem?.recordDate
    );

  const unitNo =
    Number(
      rawItem?.unitNo
    );

  if (
    !isValidIsoDate(
      recordDate
    ) ||
    !(
      unitNo === 1 ||
      unitNo === 2
    )
  ) {
    throw new Error(
      `${itemIndex + 1}번째 부재료 수정자료의 날짜·호기를 확인해 주세요.`
    );
  }

  const prefix =
    `${recordDate} ${unitNo}호기`;

  const values =
    rawItem?.values &&
    typeof rawItem.values ===
      "object" &&
    !Array.isArray(
      rawItem.values
    )
      ? rawItem.values
      : {};

  /*
    비고 정리 및 길이 검증
  */
  const remarks =
    normalizeText(
      rawItem?.remarks
    );

  if (
    remarks.length > 1000
  ) {
    throw new Error(
      `${prefix} 비고는 1,000자 이하로 입력해 주세요.`
    );
  }

  return {
    recordDate,
    unitNo,

    expectedRevision:
      Math.max(
        0,
        Number(
          rawItem?.revision
        ) ||
        0
      ),

    remarks,

    values: {
      soxPpm:
        normalizeAuxiliaryMaterialManualValue(
          values.soxPpm,
          `${prefix} SOx`
        ),

      limestoneUsageTpd:
        normalizeAuxiliaryMaterialManualValue(
          values.limestoneUsageTpd,
          `${prefix} Limestone 사용량`
        ),

      limestoneReceiptTon:
        normalizeAuxiliaryMaterialManualValue(
          values.limestoneReceiptTon,
          `${prefix} Limestone 입고량`
        ),

      limeSlurryFlowM3h:
        normalizeAuxiliaryMaterialManualValue(
          values.limeSlurryFlowM3h,
          `${prefix} Lime Slurry 유량`
        ),

      limeSlurryDensityKgm3:
        normalizeAuxiliaryMaterialManualValue(
          values.limeSlurryDensityKgm3,
          `${prefix} Slurry 밀도`,
          {
            minimum:
              1000,

            minimumExclusive:
              true,

            maximum:
              2000
          }
        ),

      limePowderTpd:
        normalizeAuxiliaryMaterialManualValue(
          values.limePowderTpd,
          `${prefix} Lime Powder`
        ),

      noxPpm:
        normalizeAuxiliaryMaterialManualValue(
          values.noxPpm,
          `${prefix} NOx`
        ),

      ammoniaM3d:
        normalizeAuxiliaryMaterialManualValue(
          values.ammoniaM3d,
          `${prefix} Ammonia 일사용량`
        )
    }
  };
}

/* =========================================================
  날짜·호기별 부재료 수치 수동 수정
========================================================= */

async function updateAuxiliaryMaterialManualRecords(context, body) {
  const authentication = await getAuthenticatedUser(context);

  if (authentication.error) {
    return authentication.error;
  }

  const rawItems = Array.isArray(body.items)
    ? body.items
    : [];

  if (rawItems.length < 1 || rawItems.length > 732) {
    return jsonResponse(
      {
        ok: false,
        message:
          "부재료 수정자료는 한 번에 1건 이상 732건 이하로 저장해 주세요."
      },
      400
    );
  }

  let items;

  try {
    items = rawItems.map((rawItem, itemIndex) => {
      const normalizedItem =
        normalizeAuxiliaryMaterialManualRecord(
          rawItem,
          itemIndex
        );

      const remarks = normalizeText(rawItem?.remarks);

      if (remarks.length > 1000) {
        throw new Error(
          `${normalizedItem.recordDate} ${normalizedItem.unitNo}호기 비고는 1,000자 이하로 입력해 주세요.`
        );
      }

      return {
        ...normalizedItem,
        remarks,

        /*
          이전 화면처럼 remarks 자체를 보내지 않는 요청이면
          기존 비고를 보존하기 위한 구분값
        */
        remarksProvided:
          Object.prototype.hasOwnProperty.call(
            rawItem || {},
            "remarks"
          )
      };
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "부재료 수정값을 확인해 주세요."
      },
      400
    );
  }

  const targetKeys = new Set();

  for (const item of items) {
    const key = `${item.recordDate}:${item.unitNo}`;

    if (targetKeys.has(key)) {
      return jsonResponse(
        {
          ok: false,
          message:
            `${item.recordDate} ${item.unitNo}호기 수정자료가 중복되었습니다.`
        },
        400
      );
    }

    targetKeys.add(key);
  }

  const database = context.env.DB;

  await ensureAuxiliaryMaterialDailyTable(database);

  const dates = items
    .map(item => item.recordDate)
    .sort();

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const existingResult = await database
    .prepare(`
      SELECT *

      FROM auxiliary_material_daily

      WHERE
        record_date >= ?
        AND record_date <= ?
    `)
    .bind(
      firstDate,
      lastDate
    )
    .all();

  const existingRows = Array.isArray(
    existingResult.results
  )
    ? existingResult.results
    : [];

  const existingByKey = new Map(
    existingRows.map(row => [
      `${normalizeText(row.record_date)}:${Number(row.unit_no)}`,
      row
    ])
  );

  for (const item of items) {
    const key = `${item.recordDate}:${item.unitNo}`;
    const existing = existingByKey.get(key);

    if (!existing) {
      return jsonResponse(
        {
          ok: false,
          message:
            `${item.recordDate} ${item.unitNo}호기 저장자료가 없어 수정할 수 없습니다.`
        },
        404
      );
    }

    if (
      item.expectedRevision > 0 &&
      Number(existing.revision) !== item.expectedRevision
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            `${item.recordDate} ${item.unitNo}호기 자료가 다른 사용자에 의해 변경되었습니다. 다시 조회한 뒤 수정해 주세요.`
        },
        409
      );
    }

    /*
      구버전 화면이 비고를 보내지 않은 경우에는
      기존 비고를 그대로 유지
    */
    if (!item.remarksProvided) {
      item.remarks = normalizeText(existing.remarks);
    }
  }

  function normalizeComparableNumber(value) {
    if (
      value === null ||
      value === undefined ||
      String(value).trim() === ""
    ) {
      return null;
    }

    const numericValue = Number(value);

    return Number.isFinite(numericValue)
      ? numericValue
      : null;
  }

  function areComparableNumbersEqual(first, second) {
    const firstNumber =
      normalizeComparableNumber(first);

    const secondNumber =
      normalizeComparableNumber(second);

    if (
      firstNumber === null ||
      secondNumber === null
    ) {
      return firstNumber === secondNumber;
    }

    return Math.abs(firstNumber - secondNumber) <
      0.0000001;
  }

  const user = authentication.user;
  const now = new Date().toISOString();

  const statements = [];
  const limestoneSyncTargetKeys = new Set();

  for (const item of items) {
    const values = item.values;
    const key = `${item.recordDate}:${item.unitNo}`;
    const existing = existingByKey.get(key);

    const ammoniaFlowM3h =
      values.ammoniaM3d === null
        ? null
        : normalizeAuxiliaryMaterialNumber(
            values.ammoniaM3d / 24
          );

    const isComplete =
      values.limestoneUsageTpd !== null &&
      values.limePowderTpd !== null &&
      values.ammoniaM3d !== null &&
      values.soxPpm !== null &&
      values.noxPpm !== null;

    statements.push(
      database
        .prepare(`
          UPDATE auxiliary_material_daily

          SET
            limestone_receipt_ton = ?,
            limestone_usage_tpd = ?,

            lime_slurry_flow_m3h = ?,
            lime_slurry_density_kgm3 = ?,
            lime_powder_tpd = ?,

            ammonia_flow_m3h = ?,
            ammonia_m3d = ?,

            sox_ppm = ?,
            nox_ppm = ?,

            remarks = ?,
            is_complete = ?,

            updated_by_id = ?,
            updated_by_name = ?,
            updated_at = ?,

            revision = revision + 1

          WHERE
            record_date = ?
            AND unit_no = ?
        `)
        .bind(
          values.limestoneReceiptTon,
          values.limestoneUsageTpd,

          values.limeSlurryFlowM3h,
          values.limeSlurryDensityKgm3,
          values.limePowderTpd,

          ammoniaFlowM3h,
          values.ammoniaM3d,

          values.soxPpm,
          values.noxPpm,

          item.remarks,
          isComplete ? 1 : 0,

          user.employeeNo,
          user.name,
          now,

          item.recordDate,
          item.unitNo
        )
    );

    /*
      비고만 수정했을 때 Limestone 원본까지
      불필요하게 수정되지 않도록 실제 변경 여부 확인
    */
    const limestoneValuesChanged =
      !areComparableNumbersEqual(
        values.limestoneReceiptTon,
        existing?.limestone_receipt_ton
      ) ||
      !areComparableNumbersEqual(
        values.limestoneUsageTpd,
        existing?.limestone_usage_tpd
      );

    if (
      item.recordDate >=
        AUXILIARY_MATERIAL_OIS_START_DATE &&
      limestoneValuesChanged
    ) {
      limestoneSyncTargetKeys.add(key);

      statements.push(
        database
          .prepare(`
            UPDATE limestone_usage_records

            SET
              receipt_quantity = ?,
              usage_quantity = ?,

              calculation_mode = 'manual',

              updated_by_id = ?,
              updated_by_name = ?,
              updated_at = ?,

              revision = revision + 1

            WHERE
              usage_date = ?
              AND unit_no = ?
          `)
          .bind(
            values.limestoneReceiptTon,
            values.limestoneUsageTpd,

            user.employeeNo,
            user.name,
            now,

            item.recordDate,
            item.unitNo
          )
      );
    }
  }

  await database.batch(statements);

  const updatedResult = await database
    .prepare(`
      SELECT *

      FROM auxiliary_material_daily

      WHERE
        record_date >= ?
        AND record_date <= ?

      ORDER BY
        record_date DESC,
        unit_no ASC
    `)
    .bind(
      firstDate,
      lastDate
    )
    .all();

  const updatedItems = (
    Array.isArray(updatedResult.results)
      ? updatedResult.results
      : []
  )
    .filter(row => {
      const key =
        `${normalizeText(row.record_date)}:` +
        `${Number(row.unit_no)}`;

      return targetKeys.has(key);
    })
    .map(convertAuxiliaryMaterialRow)
    .filter(Boolean);

  let limestoneSyncedCount = 0;

  if (limestoneSyncTargetKeys.size > 0) {
    const limestoneResult = await database
      .prepare(`
        SELECT
          usage_date,
          unit_no

        FROM limestone_usage_records

        WHERE
          usage_date >= ?
          AND usage_date <= ?
      `)
      .bind(
        firstDate,
        lastDate
      )
      .all();

    limestoneSyncedCount = (
      Array.isArray(limestoneResult.results)
        ? limestoneResult.results
        : []
    ).filter(row => {
      const key =
        `${normalizeText(row.usage_date)}:` +
        `${Number(row.unit_no)}`;

      return limestoneSyncTargetKeys.has(key);
    }).length;
  }

  return jsonResponse({
    ok: true,

    items: updatedItems,
    updatedRecordCount: updatedItems.length,
    limestoneSyncedCount,

    message:
      limestoneSyncedCount > 0
        ? (
            `${updatedItems.length}건의 부재료 자료를 수정했습니다. ` +
            `Limestone ${limestoneSyncedCount}건도 동기화했습니다.`
          )
        : `${updatedItems.length}건의 부재료 자료를 수정했습니다.`
  });
}

/* =========================================================
  Slurry 밀도 고정값 저장
========================================================= */

async function saveAuxiliaryMaterialDensitySettings(
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


  const effectiveFrom =
    normalizeText(
      body.effectiveFrom
    );


  if (
    !isValidIsoDate(
      effectiveFrom
    ) ||
    effectiveFrom <
      "2026-08-10"
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "Slurry 밀도 적용 시작일을 확인해 주세요."
      },
      400
    );
  }


  let unitOneDensityKgm3;
  let unitTwoDensityKgm3;


  try {
    unitOneDensityKgm3 =
      normalizeAuxiliaryMaterialManualValue(
        body.unitOneDensityKgm3,
        "1호기 Slurry 밀도",
        {
          minimum:
            1000,

          minimumExclusive:
            true,

          maximum:
            2000
        }
      );


    unitTwoDensityKgm3 =
      normalizeAuxiliaryMaterialManualValue(
        body.unitTwoDensityKgm3,
        "2호기 Slurry 밀도",
        {
          minimum:
            1000,

          minimumExclusive:
            true,

          maximum:
            2000
        }
      );


    if (
      unitOneDensityKgm3 ===
        null ||
      unitTwoDensityKgm3 ===
        null
    ) {
      throw new Error(
        "1호기와 2호기 Slurry 밀도를 모두 입력해 주세요."
      );
    }

  } catch (
    error
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "Slurry 밀도 고정값을 확인해 주세요."
      },
      400
    );
  }


  const database =
    context.env.DB;


  await ensureAuxiliaryMaterialDensitySettingsTable(
    database
  );


  const user =
    authentication.user;


  const now =
    new Date()
      .toISOString();


  const settings = [
    {
      unitNo:
        1,

      densityKgm3:
        unitOneDensityKgm3
    },

    {
      unitNo:
        2,

      densityKgm3:
        unitTwoDensityKgm3
    }
  ];


  const statements =
    settings.map(
      setting =>
        database
          .prepare(`
            INSERT INTO auxiliary_material_density_settings (
              unit_no,
              density_kgm3,
              effective_from,

              created_by_id,
              created_by_name,
              updated_by_id,
              updated_by_name,

              created_at,
              updated_at,
              revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)

            ON CONFLICT(unit_no)
            DO UPDATE SET
              density_kgm3 =
                excluded.density_kgm3,

              effective_from =
                excluded.effective_from,

              updated_by_id =
                excluded.updated_by_id,

              updated_by_name =
                excluded.updated_by_name,

              updated_at =
                excluded.updated_at,

              revision =
                auxiliary_material_density_settings.revision + 1
          `)
          .bind(
            setting.unitNo,
            setting.densityKgm3,
            effectiveFrom,

            user.employeeNo,
            user.name,
            user.employeeNo,
            user.name,

            now,
            now
          )
    );


  await database.batch(
    statements
  );


  const fixedDensitySettings =
    await loadAuxiliaryMaterialDensitySettings(
      database
    );


  return jsonResponse({
    ok:
      true,

    effectiveFrom,

    fixedDensitySettings,

    message:
      `${effectiveFrom}부터 1·2호기 Slurry 밀도 고정값을 저장했습니다.`
  });
}

/* =========================================================
  기존 부재료 엑셀 A:R 값 정리

  - 숫자와 쉼표 포함 숫자 허용
  - 빈칸, -, — 는 빈 값으로 저장
  - 수식 문자열·오류값은 저장 차단
========================================================= */

function normalizeAuxiliaryMaterialExcelNumber(value, label) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue =
    typeof value === "string"
      ? normalizeText(value).replace(/,/g, "")
      : value;

  if (
    normalizedValue === "" ||
    normalizedValue === "-" ||
    normalizedValue === "—"
  ) {
    return null;
  }

  const numericValue = Number(normalizedValue);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${label} 값이 숫자가 아닙니다.`);
  }

  return normalizeAuxiliaryMaterialNumber(numericValue);
}


function normalizeAuxiliaryMaterialExcelUnit(
  rawUnit,
  recordDate,
  unitNo
) {
  if (
    !rawUnit ||
    typeof rawUnit !== "object" ||
    Array.isArray(rawUnit)
  ) {
    throw new Error(`${recordDate} ${unitNo}호기 자료가 없습니다.`);
  }

  const prefix = `${recordDate} ${unitNo}호기`;

  return {
    soxPpm:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.soxPpm,
        `${prefix} SOx`
      ),

    limestoneUsageTpd:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limestoneUsageTpd,
        `${prefix} Limestone 사용량`
      ),

    limestoneReceiptTon:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limestoneReceiptTon,
        `${prefix} Limestone 입고량`
      ),

    limeSlurryFlowM3h:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limeSlurryFlowM3h,
        `${prefix} Lime Slurry 유량`
      ),

    limeSlurryDensityKgm3:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limeSlurryDensityKgm3,
        `${prefix} Slurry 밀도`
      ),

    limePowderTpd:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limePowderTpd,
        `${prefix} Lime Powder`
      ),

    noxPpm:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.noxPpm,
        `${prefix} NOx`
      ),

    ammoniaM3d:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.ammoniaM3d,
        `${prefix} Ammonia 일사용량`
      )
  };
}


/* =========================================================
  기존 부재료 엑셀 40일 단위 D1 저장

  한 날짜:
  - unitOne: B:I
  - unitTwo: J:Q
  - remarks: R

  보호 규칙:
  - 관리자만 등록
  - 한 번에 최대 40일
  - 2026-08-09까지만 엑셀 자료로 저장
  - 2026-08-10 이후는 자동 제외
  - 같은 날짜·호기는 엑셀 값으로 교체
========================================================= */

async function importAuxiliaryMaterialExcelBatch(context, body) {
  const authentication = await getAuthenticatedUser(context);

  if (authentication.error) {
    return authentication.error;
  }

  const user = authentication.user;

  if (user.role !== "admin" && user.role !== "super_admin") {
    return jsonResponse(
      {
        ok: false,
        message: "부재료 기존 엑셀 자료는 관리자만 등록할 수 있습니다."
      },
      403
    );
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (
    rawItems.length < 1 ||
    rawItems.length > MAXIMUM_AUXILIARY_MATERIAL_IMPORT_DAYS
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          `부재료 엑셀 자료는 한 번에 1일 이상 ` +
          `${MAXIMUM_AUXILIARY_MATERIAL_IMPORT_DAYS}일 이하로 등록해 주세요.`
      },
      400
    );
  }

  const fileName =
    normalizeText(body.fileName).slice(0, 200) ||
    "부재료 기존자료.xlsx";

  const importId = crypto.randomUUID();
  const normalizedItems = [];
  const excludedDates = [];
  const receivedDates = new Set();

  try {
    for (let itemIndex = 0; itemIndex < rawItems.length; itemIndex += 1) {
      const rawItem = rawItems[itemIndex];

      if (
        !rawItem ||
        typeof rawItem !== "object" ||
        Array.isArray(rawItem)
      ) {
        throw new Error(
          `${itemIndex + 1}번째 엑셀 자료 형식이 올바르지 않습니다.`
        );
      }

      const recordDate = normalizeText(rawItem.recordDate);

      if (!isValidIsoDate(recordDate)) {
        throw new Error(
          `${itemIndex + 1}번째 엑셀 날짜가 올바르지 않습니다.`
        );
      }

      if (receivedDates.has(recordDate)) {
        throw new Error(
          `${recordDate} 자료가 한 요청에 두 번 포함되어 있습니다.`
        );
      }

      receivedDates.add(recordDate);

      if (
        recordDate > AUXILIARY_MATERIAL_EXCEL_END_DATE ||
        recordDate >= AUXILIARY_MATERIAL_OIS_START_DATE
      ) {
        excludedDates.push(recordDate);
        continue;
      }

      const remarks = normalizeText(rawItem.remarks);

      if (remarks.length > 1000) {
        throw new Error(
          `${recordDate} 비고는 1,000자 이하로 입력해 주세요.`
        );
      }

      normalizedItems.push({
        recordDate,
        sheetName: normalizeText(rawItem.sheetName).slice(0, 100),
        remarks,

        unitOne:
          normalizeAuxiliaryMaterialExcelUnit(
            rawItem.unitOne,
            recordDate,
            1
          ),

        unitTwo:
          normalizeAuxiliaryMaterialExcelUnit(
            rawItem.unitTwo,
            recordDate,
            2
          )
      });
    }

  } catch (error) {
    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "부재료 엑셀 자료를 확인하지 못했습니다."
      },
      400
    );
  }

  if (normalizedItems.length < 1) {
    return jsonResponse({
      ok: true,
      importId,
      fileName,

      summary: {
        receivedDateCount: rawItems.length,
        savedDateCount: 0,
        savedRecordCount: 0,
        newRecordCount: 0,
        replacedRecordCount: 0,
        excludedDateCount: excludedDates.length
      },

      excludedDates,

      message:
        "2026-08-10 이후 자료는 OIS 자동자료 보호를 위해 저장하지 않았습니다."
    });
  }

  const database = context.env.DB;

  await ensureAuxiliaryMaterialDailyTable(database);

  normalizedItems.sort((left, right) =>
    left.recordDate.localeCompare(right.recordDate)
  );

  const firstDate = normalizedItems[0].recordDate;

  const lastDate =
    normalizedItems[
      normalizedItems.length - 1
    ].recordDate;

  const targetDateSet =
    new Set(
      normalizedItems.map(
        item => item.recordDate
      )
    );

  const existingResult =
    await database
      .prepare(`
        SELECT record_date, unit_no
        FROM auxiliary_material_daily
        WHERE record_date >= ?
          AND record_date <= ?
      `)
      .bind(
        firstDate,
        lastDate
      )
      .all();

  const existingKeys =
    new Set(
      (
        Array.isArray(existingResult.results)
          ? existingResult.results
          : []
      )
        .filter(
          row =>
            targetDateSet.has(
              normalizeText(row.record_date)
            )
        )
        .map(
          row =>
            `${normalizeText(row.record_date)}:${Number(row.unit_no)}`
        )
    );

  const upsertSql = `
    INSERT INTO auxiliary_material_daily (
      id,
      record_date,
      unit_no,

      limestone_start_stock,
      limestone_receipt_ton,
      limestone_end_stock,
      limestone_usage_tpd,

      lime_slurry_flow_m3h,
      lime_slurry_density_kgm3,
      lime_powder_tpd,

      ammonia_flow_m3h,
      ammonia_m3d,

      sox_ppm,
      nox_ppm,

      remarks,
      data_source,

      sample_count,
      is_complete,

      source_tags_json,
      raw_result_json,

      ois_request_id,
      ois_collected_at,
      agent_id,

      created_by_id,
      created_by_name,
      updated_by_id,
      updated_by_name,

      created_at,
      updated_at,
      revision
    )

    VALUES (
      ?, ?, ?,
      NULL, ?, NULL, ?,
      ?, ?, ?,
      NULL, ?,
      ?, ?,
      ?, 'excel',
      24, 1,
      ?, ?,
      '', '', '',
      ?, ?, ?, ?,
      ?, ?, 1
    )

    ON CONFLICT (
      record_date,
      unit_no
    )

    DO UPDATE SET
      limestone_start_stock = NULL,
      limestone_receipt_ton = excluded.limestone_receipt_ton,
      limestone_end_stock = NULL,
      limestone_usage_tpd = excluded.limestone_usage_tpd,

      lime_slurry_flow_m3h = excluded.lime_slurry_flow_m3h,
      lime_slurry_density_kgm3 = excluded.lime_slurry_density_kgm3,
      lime_powder_tpd = excluded.lime_powder_tpd,

      ammonia_flow_m3h = NULL,
      ammonia_m3d = excluded.ammonia_m3d,

      sox_ppm = excluded.sox_ppm,
      nox_ppm = excluded.nox_ppm,

      remarks = excluded.remarks,
      data_source = 'excel',

      sample_count = 24,
      is_complete = 1,

      source_tags_json = excluded.source_tags_json,
      raw_result_json = excluded.raw_result_json,

      ois_request_id = '',
      ois_collected_at = '',
      agent_id = '',

      updated_by_id = excluded.updated_by_id,
      updated_by_name = excluded.updated_by_name,
      updated_at = excluded.updated_at,

      revision = auxiliary_material_daily.revision + 1
  `;

  const now =
    new Date()
      .toISOString();

  const statements = [];

  for (const item of normalizedItems) {
    const units = [
      {
        unitNo: 1,
        values: item.unitOne
      },
      {
        unitNo: 2,
        values: item.unitTwo
      }
    ];

    for (const unit of units) {
      const sourceInformation = {
        source: "excel",
        importId,
        fileName,
        sheetName: item.sheetName,
        recordDate: item.recordDate,
        unitNo: unit.unitNo
      };

      const rawImportRecord = {
        ...sourceInformation,
        values: unit.values,
        remarks: item.remarks
      };

      statements.push(
        database
          .prepare(upsertSql)
          .bind(
            crypto.randomUUID(),
            item.recordDate,
            unit.unitNo,

            unit.values.limestoneReceiptTon,
            unit.values.limestoneUsageTpd,

            unit.values.limeSlurryFlowM3h,
            unit.values.limeSlurryDensityKgm3,
            unit.values.limePowderTpd,

            unit.values.ammoniaM3d,

            unit.values.soxPpm,
            unit.values.noxPpm,

            item.remarks,

            JSON.stringify(
              sourceInformation
            ),

            JSON.stringify(
              rawImportRecord
            ),

            user.employeeNo,
            user.name,
            user.employeeNo,
            user.name,

            now,
            now
          )
      );
    }
  }

  await database.batch(
    statements
  );

  const savedRecordCount =
    normalizedItems.length * 2;

  const replacedRecordCount =
    existingKeys.size;

  const newRecordCount =
    Math.max(
      0,
      savedRecordCount - replacedRecordCount
    );

  const excludedMessage =
    excludedDates.length > 0
      ? `, ${excludedDates.length}일 제외`
      : "";

  return jsonResponse({
    ok: true,
    importId,
    fileName,

    range: {
      startDate: firstDate,
      endDate: lastDate
    },

    summary: {
      receivedDateCount: rawItems.length,
      savedDateCount: normalizedItems.length,
      savedRecordCount,
      newRecordCount,
      replacedRecordCount,
      excludedDateCount: excludedDates.length
    },

    excludedDates,

    message:
      `${normalizedItems.length}일의 부재료 엑셀 자료를 저장했습니다. ` +
      `(신규 ${newRecordCount}건, 교체 ${replacedRecordCount}건` +
      `${excludedMessage})`
  });
}

async function createAuxiliaryMaterialBatchRequest(
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


  const forceRefresh =
    body.forceRefresh ===
      true;


  const dates =
    createLimestoneUsageBatchDates(
      startDate,
      endDate
    );


  if (
    dates.length <
      1 ||
    dates.length >
      62
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "부재료 OIS 조회 기간은 한 번에 1일 이상 62일 이하로 선택해 주세요."
      },
      400
    );
  }


  await ensureAuxiliaryMaterialDailyTable(
    context.env.DB
  );


  await expireOldRequests(
    context.env.DB
  );


  const user =
    authentication.user;


  const items = [];


  let createdCount =
    0;


  let reusedCount =
    0;


  let savedCount =
    0;


  const baseTime =
    Date.now();


  for (
    let dateIndex = 0;
    dateIndex <
      dates.length;
    dateIndex +=
      1
  ) {
    const targetDate =
      dates[
        dateIndex
      ];


    const savedRow =
      await context.env.DB
        .prepare(`
          SELECT
            COUNT(*) AS record_count,
            COALESCE(
              SUM(is_complete),
              0
            ) AS complete_count
          FROM auxiliary_material_daily
          WHERE record_date = ?
        `)
        .bind(
          targetDate
        )
        .first();


    if (
      !forceRefresh &&
      Number(
        savedRow?.record_count
      ) >=
        2 &&
      Number(
        savedRow?.complete_count
      ) >=
        2
    ) {
      savedCount +=
        1;


      items.push({
        targetDate,
        disposition:
          "saved"
      });


      continue;
    }


    const activeRow =
      await context.env.DB
        .prepare(`
          SELECT *
          FROM ois_data_requests
          WHERE request_type = 'auxiliary_materials'
            AND target_date = ?
            AND status IN ('pending', 'processing')
          ORDER BY requested_at DESC
          LIMIT 1
        `)
        .bind(
          targetDate
        )
        .first();


    if (
      activeRow
    ) {
      reusedCount +=
        1;


      items.push({
        ...convertRequestRow(
          activeRow
        ),
        disposition:
          "reused"
      });


      continue;
    }


    const requestId =
      crypto.randomUUID();


    const requestedAt =
      new Date(
        baseTime +
        dateIndex
      ).toISOString();


    const expiresAt =
      new Date(
        baseTime +
        72 *
        60 *
        60 *
        1000 +
        dateIndex
      ).toISOString();


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
          'auxiliary_materials',
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
        targetDate,
        user.employeeNo,
        user.name,
        requestedAt,
        expiresAt,
        requestedAt
      )
      .run();


    createdCount +=
      1;


    items.push({
      id:
        requestId,
      requestType:
        "auxiliary_materials",
      targetDate,
      status:
        "pending",
      disposition:
        "created"
    });
  }


  return jsonResponse(
    {
      ok:
        true,

      range: {
        startDate,
        endDate,
        dayCount:
          dates.length
      },

      createdCount,
      reusedCount,
      savedCount,
      items,

      message:
        `${dates.length}일 중 ${createdCount}일의 부재료 OIS 조회를 등록했습니다.`
    },
    createdCount >
      0
      ? 201
      : 200
  );
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

  지원 방식:

  1) 새 통합 조회
     ?action=next
     &requestTypes=water_environment,limestone_stock,...

     → 한 번의 HTTP 요청으로
       전달된 순서대로 7개 유형의 대기열을 확인한다.

  2) 기존 단일 유형 조회
     ?action=next
     &requestType=limestone_stock

     → 구버전 에이전트와의 호환을 유지한다.
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


  const requestedTypeOrder =
    normalizeRequestTypeList(
      requestUrl.searchParams.get(
        "requestTypes"
      )
    );


  const legacyRequestTypeText =
    normalizeText(
      requestUrl.searchParams.get(
        "requestType"
      )
    );


  const requestTypes =
    requestedTypeOrder.length >
      0
      ? requestedTypeOrder
      : legacyRequestTypeText
        ? [
            normalizeRequestType(
              legacyRequestTypeText
            )
          ]
        : [
            ...OIS_REQUEST_TYPES
          ];


  /*
    requestTypes 순서를 문자열 위치로 사용한다.

    예:
    ,water_environment,limestone_stock,silo_level,

    SQLite instr() 결과가 작은 유형을 먼저 선택하므로
    에이전트가 보내 준 순환 우선순위를 그대로 보존할 수 있다.
  */
  const requestTypeOrderKey =
    `,${requestTypes.join(",")},`;


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

            AND instr(
              ?,
              ',' || request_type || ','
            ) >
              0

          ORDER BY
            instr(
              ?,
              ',' || request_type || ','
            ) ASC,

            requested_at ASC

          LIMIT 1
        `)
        .bind(
          requestTypeOrderKey,
          requestTypeOrderKey
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

        checkedRequestTypes:
          requestTypes,

        message:
          "처리할 OIS 요청이 없습니다."
      });
    }


    const requestId =
      normalizeText(
        pendingRow.id
      );


    /*
      요청을 실제로 가져온 시점부터
      처리 제한시간을 새로 계산한다.
    */
    const processingStartedAt =
      new Date();


    const processingStartedAtText =
      processingStartedAt.toISOString();


    const processingExpiresAtText =
      new Date(
        processingStartedAt.getTime() +
        (
          REQUEST_PROCESSING_TIMEOUT_MINUTES *
          60 *
          1000
        )
      )
        .toISOString();


    const updateResult =
      await context.env.DB
        .prepare(`
          UPDATE ois_data_requests

          SET
            status = 'processing',
            started_at = ?,
            agent_id = ?,
            expires_at = ?,
            updated_at = ?

          WHERE
            id = ?
            AND status = 'pending'
        `)
        .bind(
          processingStartedAtText,
          authentication.agentId,
          processingExpiresAtText,
          processingStartedAtText,
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
        claimedRequest,

      checkedRequestTypes:
        requestTypes
    });
  }


  return jsonResponse({
    ok:
      true,

    item:
      null,

    checkedRequestTypes:
      requestTypes,

    message:
      "다른 OIS 연동 프로그램이 요청을 먼저 처리했습니다."
  });
}

/* =========================================================
  오전회의 자동수치 수동 보정값 테이블

  - OIS 원본 자료는 변경하지 않는다.
  - 날짜별 수동 보정값만 JSON으로 저장한다.
  - revision으로 동시 수정 충돌을 방지한다.
========================================================= */

async function ensureMorningMeetingAutoHistoryOverridesTable(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        morning_meeting_auto_history_overrides (
          target_date TEXT PRIMARY KEY,

          values_json TEXT NOT NULL
            DEFAULT '{}',

          created_by_id TEXT NOT NULL
            DEFAULT '',

          created_by_name TEXT NOT NULL
            DEFAULT '',

          created_at TEXT NOT NULL,

          updated_by_id TEXT NOT NULL
            DEFAULT '',

          updated_by_name TEXT NOT NULL
            DEFAULT '',

          updated_at TEXT NOT NULL,

          revision INTEGER NOT NULL
            DEFAULT 1
        )
    `)
    .run();
}

/* =========================================================
  오전회의 자동수치 수동 보정값 정리

  - 허용된 19개 수치만 저장한다.
  - 빈칸은 null로 저장한다.
  - 쉼표가 포함된 숫자도 허용한다.
  - 음수나 비정상적으로 큰 값은 차단한다.
========================================================= */

function normalizeMorningMeetingAutoHistoryOverrideValues(
  rawValues
) {
  const allowedFieldNames = [
    "waterRawWaterInflow",
    "waterDemiProduction",
    "waterPureWaterUsage",

    "limestoneUnitOneUsage",
    "limestoneUnitTwoUsage",

    "gearWheel",
    "pinion",

    "flyAshSiloLevel",
    "bioStorageSiloLevel",

    "smpMinimum",
    "smpMaximum",
    "smpWeightedAverage",

    "steamSales",
    "steamProduction",

    "powerProduction",
    "powerSales",

    /*
      태양광
      - 일일 발전량
      - 월간 누적
      - 년간 누적
    */
    "powerSolar",
    "powerSolarMonthly",
    "powerSolarYearly",

    "organicReceivedAmount",
    "organicStoredAmount"
  ];

  const maximumNumber =
    1000000000000;

  const maximumTextLength =
    100;

  const plainNumberPattern =
    /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;

  const commaNumberPattern =
    /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

  if (
    rawValues === null ||
    typeof rawValues !==
      "object" ||
    Array.isArray(
      rawValues
    )
  ) {
    throw new Error(
      "자동수치 수정값 형식을 확인해 주세요."
    );
  }

  const normalizedValues =
    {};

  const normalizeNumber = (
    value,
    fieldName
  ) => {
    if (
      !Number.isFinite(
        value
      ) ||
      value < 0 ||
      value >
        maximumNumber
    ) {
      throw new Error(
        `${fieldName} 값은 0 이상 1조 이하의 숫자로 입력해 주세요.`
      );
    }

    /*
      -0은 일반 0으로 저장한다.
    */
    return Object.is(
      value,
      -0
    )
      ? 0
      : value;
  };

  allowedFieldNames.forEach(
    fieldName => {
      if (
        !Object.prototype
          .hasOwnProperty.call(
            rawValues,
            fieldName
          )
      ) {
        return;
      }

      const rawValue =
        rawValues[
          fieldName
        ];

      /*
        빈 입력은 명시적 null 수정값이다.
      */
      if (
        rawValue === null ||
        rawValue === undefined
      ) {
        normalizedValues[
          fieldName
        ] =
          null;

        return;
      }

      if (
        typeof rawValue ===
          "number"
      ) {
        normalizedValues[
          fieldName
        ] =
          normalizeNumber(
            rawValue,
            fieldName
          );

        return;
      }

      /*
        boolean, 객체, 배열은
        문자열로 강제 변환하지 않는다.
      */
      if (
        typeof rawValue !==
          "string"
      ) {
        throw new Error(
          `${fieldName} 수정값 형식을 확인해 주세요.`
        );
      }

      const text =
        rawValue.trim();

      if (
        text === ""
      ) {
        normalizedValues[
          fieldName
        ] =
          null;

        return;
      }

      if (
        text.length >
          maximumTextLength
      ) {
        throw new Error(
          `${fieldName} 수정값은 100자 이하로 입력해 주세요.`
        );
      }

      const isNumericText =
        plainNumberPattern.test(
          text
        ) ||
        commaNumberPattern.test(
          text
        );

      /*
        숫자 형식이 아니면
        "정비중", "조회불가" 같은 문구로 저장한다.
      */
      if (
        !isNumericText
      ) {
        normalizedValues[
          fieldName
        ] =
          text;

        return;
      }

      const numericValue =
        Number(
          text.replace(
            /,/g,
            ""
          )
        );

      normalizedValues[
        fieldName
      ] =
        normalizeNumber(
          numericValue,
          fieldName
        );
    }
  );

  return normalizedValues;
}

/* =========================================================
  오전회의 자동수치 수동 보정 DB 행 → API 응답

  - 손상된 날짜나 JSON 행은 제외한다.
  - 한 건의 오류가 월 전체 조회를 막지 않게 한다.
========================================================= */

function convertMorningMeetingAutoHistoryOverrideRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  const targetDate =
    normalizeText(
      row.target_date
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return null;
  }


  let rawValues;


  try {
    const valuesText =
      normalizeText(
        row.values_json
      );


    rawValues =
      valuesText
        ? JSON.parse(
            valuesText
          )
        : {};

  } catch {
    return null;
  }


  let values;


  try {
    values =
      normalizeMorningMeetingAutoHistoryOverrideValues(
        rawValues
      );

  } catch {
    return null;
  }


  const revisionValue =
    Number(
      row.revision
    );


  return {
    targetDate,

    values,

    createdById:
      normalizeText(
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
      normalizeText(
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

    revision:
      Number.isInteger(
        revisionValue
      ) &&
      revisionValue >
        0
        ? revisionValue
        : 1
  };
}



/* =========================================================
  오전회의 자동수치 수동 보정값 기간 조회

  - 기존 completed_history 요청 내부에서 사용한다.
  - 브라우저의 API 요청 횟수는 증가하지 않는다.
========================================================= */

async function findMorningMeetingAutoHistoryOverrides(
  database,
  startDate,
  endDate
) {
  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    ) ||
    startDate >
      endDate
  ) {
    return [];
  }


  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );


  const queryResult =
    await database
      .prepare(`
        SELECT
          *

        FROM
          morning_meeting_auto_history_overrides

        WHERE
          target_date >= ?
          AND target_date <= ?

        ORDER BY
          target_date DESC
      `)
      .bind(
        startDate,
        endDate
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
      convertMorningMeetingAutoHistoryOverrideRow
    )
    .filter(
      Boolean
    );
}

async function saveMorningMeetingAutoHistoryOverride(
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

  const targetDate =
    normalizeText(
      body.targetDate ||
      body.target_date
    );

  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "수정할 자동수치 날짜를 확인해 주세요."
      },
      400
    );
  }

  let normalizedValues;

  try {
    normalizedValues =
      normalizeMorningMeetingAutoHistoryOverrideValues(
        body.values
      );

  } catch (
    error
  ) {
    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "수정할 자동수치 값을 확인해 주세요."
      },
      400
    );
  }

  if (
    Object.keys(
      normalizedValues
    ).length < 1
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "변경된 자동수치가 없습니다."
      },
      400
    );
  }

  const expectedRevision =
    Number(
      body.expectedRevision ??
      body.revision ??
      0
    );

  if (
    !Number.isInteger(
      expectedRevision
    ) ||
    expectedRevision < 0
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 수정 버전을 확인해 주세요."
      },
      400
    );
  }

  const database =
    context.env.DB;

  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );

  const existingRow =
    await database
      .prepare(`
        SELECT
          *

        FROM morning_meeting_auto_history_overrides

        WHERE
          target_date = ?

        LIMIT 1
      `)
      .bind(
        targetDate
      )
      .first();

  const existingItem =
    convertMorningMeetingAutoHistoryOverrideRow(
      existingRow
    );

  const currentRevision =
    existingRow
      ? (
          Number.isInteger(
            Number(
              existingRow.revision
            )
          ) &&
          Number(
            existingRow.revision
          ) > 0
            ? Number(
                existingRow.revision
              )
            : 1
        )
      : 0;

  if (
    expectedRevision !==
      currentRevision
  ) {
    return jsonResponse(
      {
        ok: false,

        currentItem:
          existingItem,

        message:
          "다른 사용자가 먼저 수정했습니다. 최신 자료를 다시 확인해 주세요."
      },
      409
    );
  }

  /*
    기존에 수정했던 다른 항목은 유지하고
    이번에 바뀐 항목만 덮어쓴다.
  */
  const mergedValues = {
    ...(
      existingItem?.values &&
      typeof existingItem.values ===
        "object" &&
      !Array.isArray(
        existingItem.values
      )
        ? existingItem.values
        : {}
    ),

    ...normalizedValues
  };

  const valuesJson =
    JSON.stringify(
      mergedValues
    );

  const user =
    authentication.user;

  const now =
    new Date()
      .toISOString();

  let writeResult;

  if (
    existingRow
  ) {
    writeResult =
      await database
        .prepare(`
          UPDATE
            morning_meeting_auto_history_overrides

          SET
            values_json = ?,

            updated_by_id = ?,
            updated_by_name = ?,
            updated_at = ?,

            revision =
              revision + 1

          WHERE
            target_date = ?
            AND revision = ?
        `)
        .bind(
          valuesJson,

          user.employeeNo,
          user.name,
          now,

          targetDate,
          currentRevision
        )
        .run();

  } else {
    writeResult =
      await database
        .prepare(`
          INSERT OR IGNORE INTO
            morning_meeting_auto_history_overrides (
              target_date,
              values_json,

              created_by_id,
              created_by_name,
              created_at,

              updated_by_id,
              updated_by_name,
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

            1
          )
        `)
        .bind(
          targetDate,
          valuesJson,

          user.employeeNo,
          user.name,
          now,

          user.employeeNo,
          user.name,
          now
        )
        .run();
  }

  if (
    Number(
      writeResult?.meta?.changes
    ) !== 1
  ) {
    const latestRow =
      await database
        .prepare(`
          SELECT
            *

          FROM morning_meeting_auto_history_overrides

          WHERE
            target_date = ?

          LIMIT 1
        `)
        .bind(
          targetDate
        )
        .first();

    return jsonResponse(
      {
        ok: false,

        currentItem:
          convertMorningMeetingAutoHistoryOverrideRow(
            latestRow
          ),

        message:
          "다른 사용자가 먼저 수정했습니다. 최신 자료를 다시 확인해 주세요."
      },
      409
    );
  }

  const savedRow =
    await database
      .prepare(`
        SELECT
          *

        FROM morning_meeting_auto_history_overrides

        WHERE
          target_date = ?

        LIMIT 1
      `)
      .bind(
        targetDate
      )
      .first();

  const savedItem =
    convertMorningMeetingAutoHistoryOverrideRow(
      savedRow
    );

  if (
    !savedItem
  ) {
    throw new Error(
      "저장된 자동수치 수정값을 확인하지 못했습니다."
    );
  }

  return jsonResponse({
    ok: true,

    item:
      savedItem,

    message:
      `${targetDate} 자동수치 수정값을 저장했습니다.`
  });
}

/* =========================================================
  오전회의 자동수치 수정값 기간 조회

  GET:
  /api/ois-data-requests
    ?action=morning_meeting_auto_history_overrides
    &startDate=2026-08-01
    &endDate=2026-08-31

  저장된 수정값만 조회하며
  새로운 OIS 요청은 생성하지 않는다.
========================================================= */

async function handleMorningMeetingAutoHistoryOverridesGet(
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
          "자동수치 수정값 조회 시작일과 종료일을 확인해 주세요."
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
          "자동수치 수정값 조회 시작일은 종료일보다 늦을 수 없습니다."
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
          "자동수치 수정값은 한 번에 최대 366일까지 조회할 수 있습니다."
      },
      400
    );
  }


  await ensureMorningMeetingAutoHistoryOverridesTable(
    context.env.DB
  );


  const items =
    await findMorningMeetingAutoHistoryOverrides(
      context.env.DB,
      startDate,
      endDate
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
      savedDateCount:
        items.length
    },

    items
  });
}

/* =========================================================
  저장된 자동수치 기간 조회

  - 완료된 DB 자료만 조회한다.
  - 새로운 OIS 요청을 생성하지 않는다.
  - 같은 날짜와 자료 종류가 여러 개면 최신 자료만 반환한다.

  GET:
  /api/ois-data-requests
    ?action=completed_history
    &startDate=2026-08-01
    &endDate=2026-08-31
========================================================= */

async function handleCompletedHistoryGet(
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
        ok: false,
        message:
          "자동수치 조회 시작일과 종료일을 확인해 주세요."
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
    dayCount < 1
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 조회 시작일은 종료일보다 늦을 수 없습니다."
      },
      400
    );
  }

  if (
    dayCount > 366
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 이력은 한 번에 최대 366일까지 조회할 수 있습니다."
      },
      400
    );
  }

  /*
    저장이 완료된 기존 자동수치만 읽는다.

    새로운 OIS 요청 생성이나
    자동 재조회는 실행하지 않는다.
  */
  const queryResult =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM ois_data_requests

        WHERE
          target_date >= ?
          AND target_date <= ?
          AND status = 'complete'
          AND request_type IN (
            'water_environment',
            'turbine_gear_pinion',
            'silo_level',
            'daily_data_excel',
            'steam_status'
          )
          AND result_json IS NOT NULL
          AND TRIM(
            result_json
          ) <> ''

        ORDER BY
          target_date DESC,

          CASE request_type
            WHEN 'daily_data_excel' THEN 0
            WHEN 'steam_status' THEN 1
            ELSE 0
          END ASC,

          request_type ASC,

          COALESCE(
            completed_at,
            updated_at,
            requested_at,
            ''
          ) DESC,

          requested_at DESC,
          id DESC
      `)
      .bind(
        startDate,
        endDate
      )
      .all();

  const rows =
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : [];

  /*
    날짜와 자료 종류가 같은 자료는
    가장 최신 자료 하나만 남긴다.
  */
  const savedKeys =
    new Set();

  const savedDates =
    new Set();

  const items =
    [];

  rows.forEach(
    row => {
      const convertedItem =
        convertRequestRow(
          row
        );

      if (
        !convertedItem ||
        !isValidIsoDate(
          convertedItem.targetDate
        ) ||
        !convertedItem.result ||
        typeof convertedItem.result !==
          "object" ||
        Array.isArray(
          convertedItem.result
        )
      ) {
        return;
      }

      /*
        기존 steam_status 자료도
        현재 daily_data_excel 자료로 취급한다.
      */
      const requestType =
        convertedItem.requestType ===
          "steam_status"
          ? "daily_data_excel"
          : convertedItem.requestType;

      const savedKey =
        [
          convertedItem.targetDate,
          requestType
        ].join(
          ":"
        );

      if (
        savedKeys.has(
          savedKey
        )
      ) {
        return;
      }

      savedKeys.add(
        savedKey
      );

      savedDates.add(
        convertedItem.targetDate
      );

      items.push({
        id:
          convertedItem.id,

        requestType,

        sourceRequestType:
          convertedItem.requestType,

        targetDate:
          convertedItem.targetDate,

        status:
          "complete",

        result:
          convertedItem.result,

        completedAt:
          convertedItem.completedAt,

        updatedAt:
          convertedItem.updatedAt
      });
    }
  );

  /*
    날짜별 수동 수정값을 같은 응답에 포함한다.

    브라우저에서 별도의 조회 요청을
    추가로 보내지 않기 위한 구조다.
  */
  const overrides =
    await findMorningMeetingAutoHistoryOverrides(
      context.env.DB,
      startDate,
      endDate
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
      savedDateCount:
        savedDates.size,

      savedItemCount:
        items.length,

      overrideCount:
        overrides.length
    },

    items,

    overrides
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
  오전회의 자동수치 수정값 기간 조회
*/
if (
  action ===
    "morning_meeting_auto_history_overrides"
) {
  return await handleMorningMeetingAutoHistoryOverridesGet(
    context,
    requestUrl
  );
}

/*
  저장된 자동수치 기간 조회
*/
if (
  action ===
    "completed_history"
) {
  return await handleCompletedHistoryGet(
    context,
    requestUrl
  );
}

/*
  저장된 부재료 일별 자료
*/
if (
  action ===
    "materials_history"
) {
  return await handleAuxiliaryMaterialHistoryGet(
    context,
    requestUrl
  );
}

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
  OIS 과거 LOG SHEET 기간 요청 생성

  POST:
  {
    action: "create_logsheet_batch",
    startDate: "2022-09-01",
    endDate: "2022-10-31",
    forceRefresh: false
  }

  처리:
  - 날짜별 logsheet_approval 요청 생성
  - 이미 처리 중인 날짜는 기존 요청 재사용
  - forceRefresh=false:
      완료된 날짜도 기존 결과 재사용
  - forceRefresh=true:
      완료된 자료는 새로 조회
  - 최대 62일
========================================================= */

async function createOisLegacyLogBatchRequest(
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


  const forceRefresh =
    body.forceRefresh ===
      true;


  /* =====================================================
    날짜 검사
  ====================================================== */

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
          "OIS 과거 업무일지 시작일과 종료일을 확인해 주세요."
      },
      400
    );
  }


  /*
    기존 날짜 배열 생성 함수를 그대로 사용한다.

    함수 이름에는 Limestone이 들어 있지만
    실제 동작은 단순 YYYY-MM-DD 날짜 배열 생성이다.
  */

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
      MAXIMUM_OIS_LEGACY_BATCH_DAYS
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          `OIS 과거 업무일지는 한 번에 최대 ${MAXIMUM_OIS_LEGACY_BATCH_DAYS}일까지 요청할 수 있습니다.`
      },
      400
    );
  }


  await expireOldRequests(
    context.env.DB
  );


  const items = [];


  let createdCount =
    0;


  let reusedActiveCount =
    0;


  let reusedCompleteCount =
    0;


  const baseTime =
    Date.now();


  /* =====================================================
    날짜별 요청 생성
  ====================================================== */

  for (
    let dateIndex = 0;
    dateIndex <
      dates.length;
    dateIndex +=
      1
  ) {
    const targetDate =
      dates[
        dateIndex
      ];


    /* ===================================================
      1. 이미 pending / processing 상태가 있는지 확인

      forceRefresh 여부와 관계없이
      처리 중인 요청은 중복 생성하지 않는다.
    ==================================================== */

    const activeRow =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM ois_data_requests

          WHERE
            request_type =
              'logsheet_approval'

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
          targetDate
        )
        .first();


    if (
      activeRow
    ) {
      items.push({
        ...convertRequestRow(
          activeRow
        ),

        batchDisposition:
          "reused_active"
      });


      reusedActiveCount +=
        1;


      continue;
    }


    /* ===================================================
      2. 저장된 완료자료 재사용

      forceRefresh=true이면 건너뛰고
      새 요청을 생성한다.
    ==================================================== */

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
              request_type =
                'logsheet_approval'

              AND target_date = ?

              AND status =
                'complete'

            ORDER BY
              completed_at DESC,
              requested_at DESC

            LIMIT 1
          `)
          .bind(
            targetDate
          )
          .first();


      if (
        completedRow
      ) {
        items.push({
          ...convertRequestRow(
            completedRow
          ),

          batchDisposition:
            "reused_complete"
        });


        reusedCompleteCount +=
          1;


        continue;
      }
    }


    /* ===================================================
      3. 신규 요청 생성
    ==================================================== */

    const requestId =
      crypto.randomUUID();


    /*
      날짜순으로 처리되게 요청시각을
      1ms씩 증가시킨다.
    */

    const requestedAt =
      new Date(
        baseTime +
        dateIndex
      );


    const requestedAtText =
      requestedAt
        .toISOString();


    /*
      과거자료는 여러 날짜가 대기할 수 있으므로
      일반 10분 제한을 사용하지 않는다.

      최대 72시간 동안 대기 가능.
    */

    const expiresAt =
      new Date(
        requestedAt.getTime() +
        (
          OIS_LEGACY_BATCH_QUEUE_HOURS *
          60 *
          60 *
          1000
        )
      );


    const expiresAtText =
      expiresAt
        .toISOString();


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

          'logsheet_approval',
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

        targetDate,

        user.employeeNo,
        user.name,

        requestedAtText,

        expiresAtText,
        requestedAtText
      )
      .run();


    items.push({
      id:
        requestId,

      requestType:
        "logsheet_approval",

      targetDate,

      status:
        "pending",

      requestedById:
        user.employeeNo,

      requestedByName:
        user.name,

      requestedAt:
        requestedAtText,

      startedAt:
        "",

      completedAt:
        "",

      agentId:
        "",

      result:
        null,

      errorMessage:
        "",

      expiresAt:
        expiresAtText,

      updatedAt:
        requestedAtText,

      batchDisposition:
        "created"
    });


    createdCount +=
      1;
  }


  /* =====================================================
    결과
  ====================================================== */

  return jsonResponse(
    {
      ok:
        true,

      requestType:
        "logsheet_approval",

      range: {
        startDate,

        endDate,

        totalDays:
          dates.length
      },

      createdCount,

      reusedActiveCount,

      reusedCompleteCount,

      reusedCount:
        reusedActiveCount +
        reusedCompleteCount,

      totalCount:
        items.length,

      forceRefresh,

      items,

      message:
        [
          `OIS 과거 업무일지 ${dates.length}일을 확인했습니다.`,

          `신규 요청 ${createdCount}일`,

          `진행 중 재사용 ${reusedActiveCount}일`,

          `완료자료 재사용 ${reusedCompleteCount}일`
        ].join(
          " "
        )
    },

    createdCount >
      0
      ? 201
      : 200
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

let auxiliaryMaterialRecords = [];

let oisLegacySaveResult =
  null;


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

} else if (
  existingRequest.requestType ===
    "auxiliary_materials"
) {
  normalizedResult =
    body.result &&
    typeof body.result ===
      "object" &&
    !Array.isArray(
      body.result
    )
      ? body.result
      : {};


  auxiliaryMaterialRecords =
    await saveAuxiliaryMaterialDailyRecords(
      context.env.DB,
      {
        requestItem:
          existingRequest,

        rawResult:
          normalizedResult,

        agentId:
          authentication.agentId
      }
    );

} else if (
  existingRequest.requestType ===
    "logsheet_approval"
) {
  const validation =
    normalizeOisLegacyApprovalResult(
      body.result,
      existingRequest.targetDate
    );


  normalizedResult =
    validation.result;


  /*
    요청을 complete 처리하기 전에
    과거 업무일지 원본을 D1에 먼저 저장한다.

    저장에 실패하면 요청도 complete가 되지 않는다.
  */

  oisLegacySaveResult =
    await saveOisLegacyApprovalRecords(
      context.env.DB,
      {
        requestItem:
          existingRequest,

        normalizedResult,

        agentId:
          authentication.agentId
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
      limestoneUsageRecords,

    auxiliaryMaterialRecords,

    oisLegacySaveResult
  },

  usageRecords:
    limestoneUsageRecords,

  auxiliaryMaterialRecords,

  oisLegacySaveResult,

  message:
    existingRequest.requestType ===
      "limestone_stock"
      ? "OIS 조회 결과와 석회석 사용량을 저장했습니다."
      : existingRequest.requestType ===
          "auxiliary_materials"
        ? "OIS 부재료 일별 자료를 D1에 저장했습니다."
        : existingRequest.requestType ===
            "logsheet_approval"
          ? "OIS 과거 업무일지를 D1에 저장했습니다."
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
          ok: false,
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
  오전회의 자동수치 수동 수정값 저장

  - PC 수정 저장 버튼을 눌렀을 때만 실행
  - 새로운 OIS 조회는 생성하지 않음
*/
if (
  action ===
    "save_morning_meeting_auto_history_override"
) {
  return await saveMorningMeetingAutoHistoryOverride(
    context,
    body
  );
}

/*
  부재료 날짜·호기별 수치 수정
*/
if (
  action ===
    "update_auxiliary_material_rows"
) {
  return await updateAuxiliaryMaterialManualRecords(
    context,
    body
  );
}


/*
  Slurry 밀도 고정값 저장
*/
if (
  action ===
    "save_auxiliary_material_density_settings"
) {
  return await saveAuxiliaryMaterialDensitySettings(
    context,
    body
  );
}    

    /*
      기존 부재료 엑셀 자료 등록
    */
    if (
      action ===
        "import_auxiliary_material_excel"
    ) {
      return await importAuxiliaryMaterialExcelBatch(
        context,
        body
      );
    }


    /*
      부재료 기간 OIS 조회
    */
    if (
      action ===
        "create_materials_batch"
    ) {
      return await createAuxiliaryMaterialBatchRequest(
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
      OIS 과거 LOG SHEET 기간 가져오기
    */
    if (
      action ===
        "create_logsheet_batch"
    ) {
      return await createOisLegacyLogBatchRequest(
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
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "OIS 요청을 저장하지 못했습니다."
      },
      500
    );
  }
}
