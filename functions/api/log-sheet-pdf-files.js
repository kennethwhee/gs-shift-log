"use strict";


const LOG_SHEET_PDF_REQUEST_TYPE =
  "logsheet_pdf";


const MAXIMUM_XLSX_SIZE =
  20 *
  1024 *
  1024;


const MAXIMUM_PDF_SIZE =
  50 *
  1024 *
  1024;


/* =========================================================
  공통 응답
========================================================= */

function jsonResponse(
  data,
  status =
    200
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


/* =========================================================
  요청 ID 검사
========================================================= */

function normalizeRequestId(
  value
) {
  const requestId =
    normalizeText(
      value
    );


  if (
    !/^[A-Za-z0-9-]{8,100}$/.test(
      requestId
    )
  ) {
    return "";
  }


  return requestId;
}


/* =========================================================
  날짜 검사
========================================================= */

function isValidIsoDate(
  value
) {
  const text =
    normalizeText(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  ) {
    return false;
  }


  const date =
    new Date(
      `${text}T00:00:00.000Z`
    );


  return (
    !Number.isNaN(
      date.getTime()
    ) &&
    date
      .toISOString()
      .slice(
        0,
        10
      ) ===
      text
  );
}


/* =========================================================
  Excel 시트명 검사

  Excel 규칙:
  - 최대 31자
  - \ / ? * [ ] : 사용 금지
========================================================= */

function normalizeSheetName(
  value
) {
  const sheetName =
    normalizeText(
      value
    );


  if (
    !sheetName ||
    sheetName.length >
      31 ||
    /[\\/?*[\]:]/.test(
      sheetName
    )
  ) {
    return "";
  }


  return sheetName;
}


/* =========================================================
  SHA-256
========================================================= */

function bytesToHex(
  bytes
) {
  return [
    ...bytes
  ]
    .map(
      byte =>
        byte
          .toString(
            16
          )
          .padStart(
            2,
            "0"
          )
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
  로그인 사용자 인증
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


async function authenticateUser(
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
          user.is_active

        FROM shift_log_sessions
          AS session

        INNER JOIN users
          AS user

          ON user.employee_no =
             session.employee_no

        WHERE
          session.token_hash = ?

        LIMIT 1
      `)
      .bind(
        tokenHash
      )
      .first();


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
      new Date()
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "로그인 세션이 만료되었습니다."
          },
          401
        )
    };
  }


  return {
    user: {
      employeeNo:
        normalizeText(
          session.employee_no
        ),

      name:
        normalizeText(
          session.name
        )
    }
  };
}


/* =========================================================
  회사 Agent 인증
========================================================= */

async function authenticateAgent(
  context
) {
  const savedKey =
    normalizeText(
      context.env
        .OIS_AGENT_KEY
    );


  const requestedKey =
    normalizeText(
      context.request.headers.get(
        "X-OIS-Agent-Key"
      )
    );


  if (
    !savedKey
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "OIS_AGENT_KEY가 등록되지 않았습니다."
          },
          500
        )
    };
  }


  if (
    !requestedKey
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "Agent 인증키가 없습니다."
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
        savedKey
      ),

      hashText(
        requestedKey
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
              "Agent 인증키가 올바르지 않습니다."
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
  R2 확인
========================================================= */

function checkBindings(
  context
) {
  if (
    !context.env.DB
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "D1 DB 바인딩이 없습니다."
      },
      500
    );
  }


  if (
    !context.env.ATTACHMENTS
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "R2 ATTACHMENTS 바인딩이 없습니다."
      },
      500
    );
  }


  return null;
}


/* =========================================================
  R2 경로
========================================================= */

function getSourceKey(
  requestId
) {
  return (
    `log-sheet-pdf/${requestId}/source.xlsx`
  );
}


function getPdfKey(
  requestId
) {
  return (
    `log-sheet-pdf/${requestId}/preview.pdf`
  );
}


/* =========================================================
  요청 DB 조회
========================================================= */

async function findRequest(
  database,
  requestId
) {
  return await database
    .prepare(`
      SELECT
        id,
        request_type,
        target_date,
        status,
        requested_by_id,
        requested_by_name,
        agent_id,
        error_message

      FROM ois_data_requests

      WHERE id = ?

      LIMIT 1
    `)
    .bind(
      requestId
    )
    .first();
}


function isLogSheetPdfRequest(
  row
) {
  return (
    normalizeText(
      row?.request_type
    ) ===
      LOG_SHEET_PDF_REQUEST_TYPE
  );
}


/* =========================================================
  XLSX 검사
========================================================= */

function isXlsxBytes(
  bytes
) {
  return (
    bytes.length >=
      4 &&
    bytes[0] ===
      0x50 &&
    bytes[1] ===
      0x4b
  );
}


/* =========================================================
  PDF 검사
========================================================= */

function isPdfBytes(
  bytes
) {
  if (
    bytes.length <
      5
  ) {
    return false;
  }


  return (
    String.fromCharCode(
      bytes[0],
      bytes[1],
      bytes[2],
      bytes[3],
      bytes[4]
    ) ===
      "%PDF-"
  );
}


/* =========================================================
  사용자:
  XLSX 업로드 + PDF 변환 요청 생성

  POST
  ?action=create
  &sheetName=TGO
  &targetDate=2026-08-15
========================================================= */

async function createPdfRequest(
  context,
  requestUrl
) {
  const authentication =
    await authenticateUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const sheetName =
    normalizeSheetName(
      requestUrl.searchParams.get(
        "sheetName"
      )
    );


  if (
    !sheetName
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "Excel 시트명을 확인해 주세요."
      },
      400
    );
  }


  const targetDate =
    normalizeText(
      requestUrl.searchParams.get(
        "targetDate"
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
          "Log Sheet 작성일을 확인해 주세요."
      },
      400
    );
  }


  const sourceBuffer =
    await context.request
      .arrayBuffer();


  const bytes =
    new Uint8Array(
      sourceBuffer
    );


  if (
    bytes.byteLength <=
      0 ||
    bytes.byteLength >
      MAXIMUM_XLSX_SIZE
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "Log Sheet Excel 파일 크기를 확인해 주세요."
      },
      400
    );
  }


  if (
    !isXlsxBytes(
      bytes
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "올바른 XLSX 파일이 아닙니다."
      },
      400
    );
  }


  const requestId =
    crypto.randomUUID();


  const sourceKey =
    getSourceKey(
      requestId
    );


  const user =
    authentication.user;


  const now =
    new Date();


  const requestedAt =
    now.toISOString();


  const expiresAt =
    new Date(
      now.getTime() +
      60 *
      60 *
      1000
    ).toISOString();


  /*
    먼저 R2에 원본을 저장한다.

    Agent가 pending 요청을 가져간 순간에는
    반드시 XLSX가 이미 존재하도록 한다.
  */
  await context.env.ATTACHMENTS
    .put(
      sourceKey,
      sourceBuffer,
      {
        httpMetadata: {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

          contentDisposition:
            'inline; filename="log-sheet-source.xlsx"'
        },

        customMetadata: {
          requestId,

          /*
            [LOG-SHEET-PDF-UNICODE-SHEETNAME-V3]

            R2 custom metadata와 HTTP header는
            한글 시트명을 그대로 운반하지 않고 URI component로 저장한다.
          */
          sheetName:
            encodeURIComponent(
              sheetName
            ),

          targetDate,

          requestedById:
            user.employeeNo,

          requestedByName:
            user.name,

          createdAt:
            requestedAt
        }
      }
    );


  try {
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
        LOG_SHEET_PDF_REQUEST_TYPE,
        targetDate,

        user.employeeNo,
        user.name,

        requestedAt,

        expiresAt,
        requestedAt
      )
      .run();

  } catch (
    error
  ) {
    /*
      DB 요청 생성이 실패하면
      고아 XLSX를 남기지 않는다.
    */
    await context.env.ATTACHMENTS
      .delete(
        sourceKey
      )
      .catch(
        () => null
      );


    throw error;
  }


  return jsonResponse(
    {
      ok:
        true,

      item: {
        id:
          requestId,

        requestType:
          LOG_SHEET_PDF_REQUEST_TYPE,

        targetDate,

        sheetName,

        status:
          "pending"
      },

      sourceSize:
        bytes.byteLength
    },
    201
  );
}


/* =========================================================
  Agent:
  변환할 XLSX 다운로드
========================================================= */

async function getSourceWorkbook(
  context,
  requestUrl
) {
  const authentication =
    await authenticateAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const requestId =
    normalizeRequestId(
      requestUrl.searchParams.get(
        "id"
      ) ||
      requestUrl.searchParams.get(
        "requestId"
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
          "요청 ID가 없습니다."
      },
      400
    );
  }


  const requestItem =
    await findRequest(
      context.env.DB,
      requestId
    );


  if (
    !requestItem ||
    !isLogSheetPdfRequest(
      requestItem
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "Log Sheet PDF 요청을 찾을 수 없습니다."
      },
      404
    );
  }


  const object =
    await context.env.ATTACHMENTS
      .get(
        getSourceKey(
          requestId
        )
      );


  if (
    !object
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "변환할 XLSX 파일을 찾을 수 없습니다."
      },
      404
    );
  }


  const storedSheetName =
    normalizeText(
      object.customMetadata
        ?.sheetName
    );


  let decodedSheetName =
    storedSheetName;


  try {
    decodedSheetName =
      decodeURIComponent(
        storedSheetName
      );
  } catch (
    error
  ) {
    console.warn(
      "Log Sheet sheetName decode fallback:",
      error
    );
  }


  const sheetName =
    normalizeSheetName(
      decodedSheetName
    );


  if (
    !sheetName
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "XLSX의 대상 시트 정보를 확인할 수 없습니다."
      },
      500
    );
  }


  return new Response(
    object.body,
    {
      status:
        200,

      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

        "Content-Disposition":
          'inline; filename="log-sheet-source.xlsx"',

        "Cache-Control":
          "no-store",

        "X-Log-Sheet-Name":
          encodeURIComponent(
            sheetName
          ),

        "X-Log-Sheet-Name-Encoding":
          "uri-component",

        "X-Log-Sheet-Target-Date":
          normalizeText(
            requestItem.target_date
          ),

        "X-Log-Sheet-Request-Id":
          requestId
      }
    }
  );
}


/* =========================================================
  Agent:
  변환 완료 PDF 업로드

  POST
  ?action=upload_pdf
  &id=...
========================================================= */

async function uploadPdfResult(
  context,
  requestUrl
) {
  const authentication =
    await authenticateAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const requestId =
    normalizeRequestId(
      requestUrl.searchParams.get(
        "id"
      ) ||
      requestUrl.searchParams.get(
        "requestId"
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
          "요청 ID가 없습니다."
      },
      400
    );
  }


  const requestItem =
    await findRequest(
      context.env.DB,
      requestId
    );


  if (
    !requestItem ||
    !isLogSheetPdfRequest(
      requestItem
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "Log Sheet PDF 요청을 찾을 수 없습니다."
      },
      404
    );
  }


  if (
    normalizeText(
      requestItem.status
    ) !==
      "processing"
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "현재 처리 중인 PDF 요청이 아닙니다."
      },
      409
    );
  }


  const pdfBuffer =
    await context.request
      .arrayBuffer();


  const bytes =
    new Uint8Array(
      pdfBuffer
    );


  if (
    bytes.byteLength <=
      0 ||
    bytes.byteLength >
      MAXIMUM_PDF_SIZE
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "생성된 PDF 파일 크기를 확인해 주세요."
      },
      400
    );
  }


  if (
    !isPdfBytes(
      bytes
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "올바른 PDF 파일이 아닙니다."
      },
      400
    );
  }


  await context.env.ATTACHMENTS
    .put(
      getPdfKey(
        requestId
      ),
      pdfBuffer,
      {
        httpMetadata: {
          contentType:
            "application/pdf",

          contentDisposition:
            'inline; filename="log-sheet-preview.pdf"'
        },

        customMetadata: {
          requestId,

          targetDate:
            normalizeText(
              requestItem.target_date
            ),

          agentId:
            authentication.agentId,

          createdAt:
            new Date()
              .toISOString()
        }
      }
    );


  return jsonResponse({
    ok:
      true,

    requestId,

    pdfSize:
      bytes.byteLength,

    previewPath:
      `/api/log-sheet-pdf-files?action=preview&id=${encodeURIComponent(
        requestId
      )}`
  });
}


/* =========================================================
  사용자:
  변환 완료 PDF 열기
========================================================= */

async function getPdfPreview(
  context,
  requestUrl
) {
  const authentication =
    await authenticateUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const requestId =
    normalizeRequestId(
      requestUrl.searchParams.get(
        "id"
      ) ||
      requestUrl.searchParams.get(
        "requestId"
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
          "요청 ID가 없습니다."
      },
      400
    );
  }


  const requestItem =
    await findRequest(
      context.env.DB,
      requestId
    );


  if (
    !requestItem ||
    !isLogSheetPdfRequest(
      requestItem
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "Log Sheet PDF 요청을 찾을 수 없습니다."
      },
      404
    );
  }


  if (
    normalizeText(
      requestItem.requested_by_id
    ) !==
      authentication.user
        .employeeNo
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "이 PDF를 열 권한이 없습니다."
      },
      403
    );
  }


  const requestStatus =
    normalizeText(
      requestItem.status
    ).toLowerCase();


  if (
    requestStatus ===
      "failed"
  ) {
    return jsonResponse(
      {
        ok: false,

        status:
          requestStatus,

        message:
          normalizeText(
            requestItem.error_message
          ) ||
          "회사 PC에서 Log Sheet PDF 변환에 실패했습니다."
      },
      422
    );
  }


  if (
    requestStatus !==
      "complete"
  ) {
    return jsonResponse(
      {
        ok: false,

        status:
          requestStatus,

        message:
          "PDF 변환이 아직 완료되지 않았습니다."
      },
      409
    );
  }  const object =
    await context.env.ATTACHMENTS
      .get(
        getPdfKey(
          requestId
        )
      );


  if (
    !object
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "생성된 PDF 파일을 찾을 수 없습니다."
      },
      404
    );
  }


  return new Response(
    object.body,
    {
      status:
        200,

      headers: {
        "Content-Type":
          "application/pdf",

        "Content-Disposition":
          'inline; filename="log-sheet-preview.pdf"',

        "Cache-Control":
          "no-store, no-cache, must-revalidate",

        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}


/* =========================================================
  GET
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    const bindingError =
      checkBindings(
        context
      );


    if (
      bindingError
    ) {
      return bindingError;
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
        .toLowerCase();


    if (
      action ===
        "source"
    ) {
      return await getSourceWorkbook(
        context,
        requestUrl
      );
    }


    if (
      action ===
        "preview"
    ) {
      return await getPdfPreview(
        context,
        requestUrl
      );
    }


    return jsonResponse(
      {
        ok:
          false,

        message:
          "지원하지 않는 Log Sheet PDF GET 요청입니다."
      },
      400
    );

  } catch (
    error
  ) {
    console.error(
      "Log Sheet PDF GET 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "Log Sheet PDF 요청 처리 중 오류가 발생했습니다."
      },
      500
    );
  }
}


/* =========================================================
  POST
========================================================= */

export async function onRequestPost(
  context
) {
  try {
    const bindingError =
      checkBindings(
        context
      );


    if (
      bindingError
    ) {
      return bindingError;
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
        .toLowerCase();


    if (
      action ===
        "create"
    ) {
      return await createPdfRequest(
        context,
        requestUrl
      );
    }


    if (
      action ===
        "upload_pdf"
    ) {
      return await uploadPdfResult(
        context,
        requestUrl
      );
    }


    return jsonResponse(
      {
        ok:
          false,

        message:
          "지원하지 않는 Log Sheet PDF POST 요청입니다."
      },
      400
    );

  } catch (
    error
  ) {
    console.error(
      "Log Sheet PDF POST 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "Log Sheet PDF 요청 처리 중 오류가 발생했습니다."
      },
      500
    );
  }
}