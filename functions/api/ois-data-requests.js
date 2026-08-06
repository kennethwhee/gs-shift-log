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
  요청 형식 정리
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
    "water_environment"
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


    if (
      action ===
        "next"
    ) {
      return await handleAgentNextRequest(
        context,
        requestUrl
      );
    }


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

      WHERE id = ?
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


  return jsonResponse({
    ok:
      true,

    item:
      await findRequestById(
        context.env.DB,
        requestId
      ),

    message:
      "OIS 조회 결과를 저장했습니다."
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


    if (
      action ===
        "complete"
    ) {
      return await completeAgentRequest(
        context,
        body
      );
    }


    if (
      action ===
        "fail"
    ) {
      return await failAgentRequest(
        context,
        body
      );
    }


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