"use strict";


/* =========================================================
  석회석 전표사진 OCR API

  경로:
  functions/api/limestone-slip-ocr.js

  API:
  POST /api/limestone-slip-ocr

  바인딩:
  - DB                    : 기존 D1
  - AI                    : Workers AI
  - LIMESTONE_SLIPS  : 비공개 R2
========================================================= */

const OCR_MODEL =
  "@cf/moondream/moondream3.1-9B-A2B";


const MAX_IMAGE_BYTES =
  4 * 1024 * 1024;


const MIN_QUANTITY_KG =
  1000;


const MAX_QUANTITY_KG =
  100000;


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


function normalizeText(
  value
) {
  return String(
    value ??
    ""
  ).trim();
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


  return normalizeText(
    authorization.match(
      /^Bearer\s+(.+)$/i
    )?.[1]
  );
}


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
  이미지 → base64 data URI
========================================================= */

function bytesToBase64(
  bytes
) {
  const chunkSize =
    0x8000;


  let binaryText =
    "";


  for (
    let offset = 0;
    offset < bytes.length;
    offset += chunkSize
  ) {
    binaryText +=
      String.fromCharCode(
        ...bytes.subarray(
          offset,

          Math.min(
            offset + chunkSize,
            bytes.length
          )
        )
      );
  }


  return btoa(
    binaryText
  );
}


/* =========================================================
  AI 응답 해석
========================================================= */

function parseNumericValue(
  value
) {
  if (
    typeof value ===
      "number"
  ) {
    return Number.isFinite(
      value
    )
      ? value
      : null;
  }


  const match =
    normalizeText(
      value
    )
      .replace(
        /,/g,
        ""
      )
      .replace(
        /\s+/g,
        ""
      )
      .match(
        /-?\d+(?:\.\d+)?/
      );


  if (
    !match
  ) {
    return null;
  }


  const number =
    Number(
      match[0]
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function normalizeQuantityKg(
  value
) {
  const number =
    parseNumericValue(
      value
    );


  if (
    number ===
      null
  ) {
    return null;
  }


  const quantityKg =
    Math.round(
      number
    );


  if (
    quantityKg <
      MIN_QUANTITY_KG ||
    quantityKg >
      MAX_QUANTITY_KG
  ) {
    return null;
  }


  return quantityKg;
}


function extractJsonObject(
  answerText
) {
  const cleaned =
    normalizeText(
      answerText
    )
      .replace(
        /^```(?:json)?\s*/i,
        ""
      )
      .replace(
        /\s*```$/,
        ""
      );


  const firstBrace =
    cleaned.indexOf(
      "{"
    );


  const lastBrace =
    cleaned.lastIndexOf(
      "}"
    );


  if (
    firstBrace <
      0 ||
    lastBrace <=
      firstBrace
  ) {
    return null;
  }


  try {
    return JSON.parse(
      cleaned.slice(
        firstBrace,
        lastBrace + 1
      )
    );

  } catch {
    return null;
  }
}


function extractQuantityKg(
  answerText,
  answerObject
) {
  let quantityKg =
    normalizeQuantityKg(
      answerObject?.quantityKg
    );


  if (
    quantityKg !==
      null
  ) {
    return quantityKg;
  }


  const quantityFieldMatch =
    normalizeText(
      answerText
    ).match(
      /["']?quantityKg["']?\s*[:=]\s*["']?([\d,.\s]+)/i
    );


  quantityKg =
    normalizeQuantityKg(
      quantityFieldMatch?.[1]
    );


  if (
    quantityKg !==
      null
  ) {
    return quantityKg;
  }


  const printedValue =
    normalizeText(
      answerObject?.printedValue
    );


  const printedMatch =
    printedValue.match(
      /([\d,.\s]+)\s*(?:kg|㎏)/i
    );


  quantityKg =
    normalizeQuantityKg(
      printedMatch?.[1]
    );


  if (
    quantityKg !==
      null
  ) {
    return quantityKg;
  }


  const labeledMatch =
    normalizeText(
      answerText
    ).match(
      /실\s*중\s*량(?:\s*\(\s*kg\s*\))?[^\d]{0,20}([\d,.\s]+)\s*(?:kg|㎏)/i
    );


  return normalizeQuantityKg(
    labeledMatch?.[1]
  );
}


function normalizeConfidence(
  value
) {
  const confidence =
    normalizeText(
      value
    ).toLowerCase();


  return [
    "high",
    "medium",
    "low"
  ].includes(
    confidence
  )
    ? confidence
    : "unknown";
}


function parseOcrAnswer(
  answerText
) {
  const answerObject =
    extractJsonObject(
      answerText
    );


  const quantityKg =
    extractQuantityKg(
      answerText,
      answerObject
    );


  return {
    quantityKg,

    quantityTon:
      quantityKg ===
        null
          ? null
          : Number(
              (
                quantityKg /
                1000
              ).toFixed(
                2
              )
            ),

    printedValue:
      normalizeText(
        answerObject?.printedValue
      ).slice(
        0,
        80
      ),

    confidence:
      normalizeConfidence(
        answerObject?.confidence
      )
  };
}


/* =========================================================
  비공개 R2 저장 키
========================================================= */

function getKoreaDateText(
  date
) {
  return new Date(
    date.getTime() +
    9 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(
      0,
      10
    );
}


function createObjectKey(
  uploadedAt
) {
  return [
    "limestone-slips",

    getKoreaDateText(
      uploadedAt
    ),

    `${crypto.randomUUID()}.jpg`
  ].join("/");
}


/* =========================================================
  POST /api/limestone-slip-ocr
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


    if (
      !context.env.AI
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "Workers AI 바인딩 AI가 등록되지 않았습니다."
        },
        500
      );
    }


    if (
      !context.env
        .LIMESTONE_SLIPS
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "전표사진 R2 바인딩 LIMESTONE_SLIPS이 등록되지 않았습니다."
        },
        500
      );
    }


    const requestType =
      normalizeText(
        context.request.headers.get(
          "Content-Type"
        )
      ).toLowerCase();


    if (
      !requestType.startsWith(
        "multipart/form-data"
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "전표사진 전송 형식이 올바르지 않습니다."
        },
        400
      );
    }


    let formData;


    try {
      formData =
        await context.request
          .formData();

    } catch {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "전표사진 요청을 읽지 못했습니다."
        },
        400
      );
    }


    const imageFile =
      formData.get(
        "image"
      );


    if (
      !imageFile ||
      typeof imageFile.arrayBuffer !==
        "function"
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "OCR로 분석할 전표사진이 없습니다."
        },
        400
      );
    }


    if (
      normalizeText(
        imageFile.type
      ).toLowerCase() !==
        "image/jpeg"
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "전표사진은 보정된 JPEG 형식만 사용할 수 있습니다."
        },
        400
      );
    }


    const imageBuffer =
      await imageFile.arrayBuffer();


    const imageBytes =
      new Uint8Array(
        imageBuffer
      );


    if (
      imageBytes.byteLength <
        1
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "전표사진 파일이 비어 있습니다."
        },
        400
      );
    }


    if (
      imageBytes.byteLength >
        MAX_IMAGE_BYTES
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "전표사진 용량은 4MB 이하만 사용할 수 있습니다."
        },
        413
      );
    }


    const imageDataUri =
      "data:image/jpeg;base64," +
      bytesToBase64(
        imageBytes
      );


    let aiResult;


    try {
      aiResult =
        await context.env.AI.run(
          OCR_MODEL,
          {
            task:
              "query",

            image:
              imageDataUri,

            question: `
이 이미지는 한국어 석회석 계근 전표입니다.

오직 "실중량", "실 중 량" 또는 "실중량(kg)"이라고 표시된 값만 읽으세요.
총중량, 공차중량, 차량번호, 전표번호, 날짜와 다른 모든 숫자는 무시하세요.

실중량은 kg 단위의 정수로 반환하세요.
쉼표는 제거하세요. 예: 30,920 kg는 30920입니다.
값이나 라벨이 선명하지 않으면 추측하지 말고 quantityKg를 null로 반환하세요.

설명이나 Markdown 없이 반드시 다음 한 줄 JSON 형식만 반환하세요.
{"quantityKg":30920,"printedValue":"30,920 kg","confidence":"high"}

confidence는 high, medium, low 중 하나만 사용하세요.
            `.trim(),

            reasoning:
              false,

            temperature:
              0,

            max_tokens:
              180,

            stream:
              false
          }
        );

    } catch (
      error
    ) {
      console.error(
        "[Limestone Slip OCR] Workers AI failed:",
        error
      );


      return jsonResponse(
        {
          ok:
            false,

          message:
            "전표 실중량 분석 서버가 응답하지 않았습니다. 잠시 후 다시 촬영해 주세요."
        },
        502
      );
    }


    const answerText =
      normalizeText(
        aiResult?.answer ??
        aiResult?.response ??
        ""
      );


    const recognition =
      parseOcrAnswer(
        answerText
      );


    const uploadedAt =
      new Date();


    const objectKey =
      createObjectKey(
        uploadedAt
      );


    await context.env
      .LIMESTONE_SLIPS
      .put(
        objectKey,
        imageBuffer,
        {
          httpMetadata: {
            contentType:
              "image/jpeg",

            cacheControl:
              "private, no-store"
          },

          customMetadata: {
            employeeNo:
              authentication.user
                .employeeNo,

            uploadedAt:
              uploadedAt.toISOString(),

            quantityKg:
              recognition.quantityKg ===
                null
                  ? ""
                  : String(
                      recognition.quantityKg
                    ),

            confidence:
              recognition.confidence
          }
        }
      );


    const recognized =
      recognition.quantityKg !==
        null;


    return jsonResponse(
      {
        ok:
          true,

        recognized,

        quantityKg:
          recognition.quantityKg,

        quantityTon:
          recognition.quantityTon,

        printedValue:
          recognition.printedValue,

        confidence:
          recognition.confidence,

        slipImageKey:
          objectKey,

        message:
          recognized
            ? "전표의 실중량을 인식했습니다."
            : "실중량을 정확히 인식하지 못했습니다. 전표를 확인해 직접 입력해 주세요."
      }
    );

  } catch (
    error
  ) {
    console.error(
      "[Limestone Slip OCR] Unexpected error:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          "전표사진을 처리하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}