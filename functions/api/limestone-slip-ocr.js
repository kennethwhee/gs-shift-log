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


/*
  실중량과
  총중량 - 공차중량의 허용 차이
*/
const WEIGHT_DIFFERENCE_TOLERANCE_KG =
  100;


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


function normalizeBoolean(
  value
) {
  if (
    value ===
      true ||
    value ===
      false
  ) {
    return value;
  }


  const normalized =
    normalizeText(
      value
    ).toLowerCase();


  if (
    [
      "true",
      "yes",
      "1"
    ].includes(
      normalized
    )
  ) {
    return true;
  }


  if (
    [
      "false",
      "no",
      "0"
    ].includes(
      normalized
    )
  ) {
    return false;
  }


  return null;
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


function getFirstObjectValue(
  source,
  propertyNames
) {
  if (
    !source ||
    typeof source !==
      "object"
  ) {
    return undefined;
  }


  for (
    const propertyName of propertyNames
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        source,
        propertyName
      ) &&
      source[
        propertyName
      ] !==
        null &&
      source[
        propertyName
      ] !==
        undefined &&
      normalizeText(
        source[
          propertyName
        ]
      ) !==
        ""
    ) {
      return source[
        propertyName
      ];
    }
  }


  return undefined;
}


function parseWeightNumber(
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


  const sourceText =
    normalizeText(
      value
    );


  if (
    !sourceText
  ) {
    return null;
  }


  const numericMatch =
    sourceText.match(
      /-?\d[\d\s,.]*/
    );


  if (
    !numericMatch
  ) {
    return null;
  }


  let numericText =
    numericMatch[0]
      .replace(
        /\s+/g,
        ""
      );


  /*
    30,920 또는 30.920처럼
    세 자리 구분자로 보이는 경우
  */
  if (
    /^-?\d{1,3}(?:[,.]\d{3})+$/.test(
      numericText
    )
  ) {
    numericText =
      numericText.replace(
        /[,.]/g,
        ""
      );

  } else {
    numericText =
      numericText.replace(
        /,/g,
        ""
      );
  }


  const numericValue =
    Number(
      numericText
    );


  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return null;
  }


  const isTonValue =
    /(?:\b(?:t|ton)\b|톤)/i.test(
      sourceText
    ) &&
    !/(?:kg|㎏)/i.test(
      sourceText
    );


  return isTonValue
    ? numericValue *
        1000
    : numericValue;
}


function normalizeWeightKg(
  value
) {
  const numericValue =
    parseWeightNumber(
      value
    );


  if (
    numericValue ===
      null
  ) {
    return null;
  }


  const quantityKg =
    Math.round(
      numericValue
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


function extractLabeledWeight(
  answerText,
  labelPattern
) {
  const match =
    normalizeText(
      answerText
    ).match(
      new RegExp(
        `${labelPattern}(?:\\s*\\(\\s*(?:kg|㎏)\\s*\\))?[^\\d-]{0,30}(-?\\d[\\d\\s,.]{0,18})\\s*(kg|㎏|t|ton|톤)?`,
        "i"
      )
    );


  if (
    !match
  ) {
    return null;
  }


  return normalizeWeightKg(
    [
      match[1],
      match[2] ||
        "kg"
    ].join(
      " "
    )
  );
}


function extractWeightField(
  answerText,
  answerObject,
  propertyNames,
  labelPattern,
  visiblePropertyNames = []
) {
  const visibleValue =
    getFirstObjectValue(
      answerObject,
      visiblePropertyNames
    );


  if (
    normalizeBoolean(
      visibleValue
    ) ===
      false
  ) {
    return null;
  }


  const objectValue =
    getFirstObjectValue(
      answerObject,
      propertyNames
    );


  const objectWeight =
    normalizeWeightKg(
      objectValue
    );


  if (
    objectWeight !==
      null
  ) {
    return objectWeight;
  }


  return extractLabeledWeight(
    answerText,
    labelPattern
  );
}


function getRecognitionMessage(
  recognition
) {
  if (
    recognition.recognized
  ) {
    if (
      recognition.recognitionSource ===
        "gross_minus_tare"
    ) {
      return "총중량과 공차중량의 차이로 실중량을 계산했습니다. 전표와 값이 같은지 확인해 주세요.";
    }


    return "전표의 실중량을 인식했습니다.";
  }


  switch (
    recognition.reasonCode
  ) {
    case "weight_mismatch":
      return "총중량·공차중량·실중량 값이 서로 맞지 않아 자동 확정하지 못했습니다. 전표를 확인해 직접 입력해 주세요.";

    case "invalid_weight_order":
      return "총중량과 공차중량의 순서를 정확히 읽지 못했습니다. 전표 전체를 다시 촬영하거나 직접 입력해 주세요.";

    case "invalid_weight_range":
      return "전표에서 읽은 중량이 정상 범위를 벗어났습니다. 전표를 확인해 직접 입력해 주세요.";

    case "low_confidence":
      return "전표 글자가 흐리거나 일부 가려져 실중량을 확정하지 못했습니다. 선명하게 다시 촬영하거나 직접 입력해 주세요.";

    case "net_weight_not_visible":
      return "사진에서 실중량 줄을 확인하지 못했습니다. 실중량까지 전표 전체가 나오도록 다시 촬영해 주세요.";

    case "insufficient_weight_fields":
      return "실중량 또는 총중량·공차중량을 모두 확인하지 못했습니다. 전표 전체를 다시 촬영하거나 직접 입력해 주세요.";

    default:
      return "실중량을 정확히 인식하지 못했습니다. 전표를 확인해 직접 입력해 주세요.";
  }
}


function parseOcrAnswer(
  answerText
) {
  const answerObject =
    extractJsonObject(
      answerText
    );


  const confidence =
    normalizeConfidence(
      getFirstObjectValue(
        answerObject,
        [
          "confidence",
          "overallConfidence"
        ]
      )
    );


  const fullSlipVisible =
    normalizeBoolean(
      getFirstObjectValue(
        answerObject,
        [
          "fullSlipVisible",
          "documentVisible"
        ]
      )
    );


  const grossKg =
    extractWeightField(
      answerText,
      answerObject,
      [
        "grossKg",
        "grossWeightKg",
        "totalWeightKg"
      ],
      "(?:총\\s*중\\s*량|gross(?:\\s*weight)?)",
      [
        "grossVisible",
        "grossWeightVisible"
      ]
    );


  const tareKg =
    extractWeightField(
      answerText,
      answerObject,
      [
        "tareKg",
        "tareWeightKg",
        "emptyWeightKg"
      ],
      "(?:공\\s*차\\s*중\\s*량|차\\s*중\\s*량|tare(?:\\s*weight)?)",
      [
        "tareVisible",
        "tareWeightVisible"
      ]
    );


  const netKg =
    extractWeightField(
      answerText,
      answerObject,
      [
        "netKg",
        "quantityKg",
        "netWeightKg"
      ],
      "(?:실\\s*중\\s*량|순\\s*중\\s*량|net(?:\\s*weight)?)",
      [
        "netVisible",
        "netWeightVisible"
      ]
    );


  const printedValue =
    normalizeText(
      getFirstObjectValue(
        answerObject,
        [
          "printedValue",
          "netPrintedValue"
        ]
      )
    ).slice(
      0,
      80
    );


  const hasGrossAndTare =
    grossKg !==
      null &&
    tareKg !==
      null;


  const differenceKg =
    hasGrossAndTare
      ? grossKg -
          tareKg
      : null;


  const differenceIsValid =
    differenceKg !==
      null &&
    differenceKg >=
      MIN_QUANTITY_KG &&
    differenceKg <=
      MAX_QUANTITY_KG;


  const confidenceIsUsable =
    confidence ===
      "high" ||
    confidence ===
      "medium";


  let quantityKg =
    null;


  let recognitionSource =
    null;


  let reasonCode =
    null;


  if (
    hasGrossAndTare &&
    grossKg <=
      tareKg
  ) {
    reasonCode =
      "invalid_weight_order";

  } else if (
    netKg !==
      null &&
    hasGrossAndTare &&
    Math.abs(
      netKg -
      differenceKg
    ) >
      WEIGHT_DIFFERENCE_TOLERANCE_KG
  ) {
    reasonCode =
      "weight_mismatch";

  } else if (
    !confidenceIsUsable &&
    (
      netKg !==
        null ||
      hasGrossAndTare
    )
  ) {
    reasonCode =
      "low_confidence";

  } else if (
    netKg !==
      null
  ) {
    quantityKg =
      netKg;

    recognitionSource =
      "printed_net";

  } else if (
    hasGrossAndTare &&
    differenceIsValid
  ) {
    quantityKg =
      differenceKg;

    recognitionSource =
      "gross_minus_tare";

  } else if (
    hasGrossAndTare
  ) {
    reasonCode =
      "invalid_weight_range";

  } else if (
    fullSlipVisible ===
      false ||
    (
      netKg ===
        null &&
      grossKg ===
        null &&
      tareKg ===
        null
    )
  ) {
    reasonCode =
      "net_weight_not_visible";

  } else {
    reasonCode =
      "insufficient_weight_fields";
  }


  const recognized =
    quantityKg !==
      null;


  const finalConfidence =
    recognitionSource ===
      "gross_minus_tare"
        ? "medium"
        : confidence;


  const recognition = {
    recognized,

    grossKg,

    tareKg,

    /*
      netKg는 전표에 직접 인쇄된 값이다.
      quantityKg는 검증 후 사용할 최종값이다.
    */
    netKg,

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

    printedValue,

    confidence:
      finalConfidence,

    fullSlipVisible,

    recognitionSource,

    reasonCode:
      recognized
        ? null
        : reasonCode
  };


  return {
    ...recognition,

    message:
      getRecognitionMessage(
        recognition
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


    /*
      기존 배포 환경과 새 이름을 모두 지원한다.
    */

    const slipBucket =
      context.env
        .LIMESTONE_SLIP_BUCKET ||
      context.env
        .LIMESTONE_SLIPS;


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
      !slipBucket
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "전표사진 R2 바인딩 LIMESTONE_SLIP_BUCKET 또는 LIMESTONE_SLIPS가 등록되지 않았습니다."
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

전표에서 아래 세 항목을 각각 읽으세요.
- 총중량 또는 총 중 량: grossKg
- 공차중량, 공차 중량 또는 차중량: tareKg
- 실중량, 실 중 량, 순중량 또는 NET WEIGHT: netKg

각 값은 반드시 해당 라벨과 같은 행 또는 바로 인접한 칸에 인쇄된 중량만 사용하세요.
날짜, 차량번호, 사업자번호, 전표번호 및 그 밖의 숫자는 절대 중량으로 사용하지 마세요.
값은 kg 단위 정수로 반환하고 쉼표는 제거하세요. 예: 30,920 kg는 30920입니다.
톤 단위로만 인쇄되어 있다면 kg으로 변환하세요.

netKg가 보이지 않더라도 계산하거나 추측하지 마세요.
총중량과 공차중량의 차이는 서버가 별도로 검증합니다.

라벨 또는 값이 흐리거나 사진 밖에 있으면 해당 값은 null로 반환하세요.
fullSlipVisible은 총중량·공차중량·실중량 영역이 사진 안에 보일 때만 true입니다.
confidence는 세 중량 항목의 판독 신뢰도를 high, medium, low 중 하나로 반환하세요.

설명이나 Markdown 없이 반드시 아래 키를 가진 JSON 한 줄만 반환하세요.
{"grossKg":52340,"tareKg":21420,"netKg":30920,"printedValue":"30,920 kg","grossVisible":true,"tareVisible":true,"netVisible":true,"fullSlipVisible":true,"confidence":"high"}
            `.trim(),

            reasoning:
              false,

            temperature:
              0,

            max_tokens:
              260,

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


    await slipBucket.put(
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

          grossKg:
            recognition.grossKg ===
              null
                ? ""
                : String(
                    recognition.grossKg
                  ),

          tareKg:
            recognition.tareKg ===
              null
                ? ""
                : String(
                    recognition.tareKg
                  ),

          netKg:
            recognition.netKg ===
              null
                ? ""
                : String(
                    recognition.netKg
                  ),

          quantityKg:
            recognition.quantityKg ===
              null
                ? ""
                : String(
                    recognition.quantityKg
                  ),

          confidence:
            recognition.confidence,

          recognitionSource:
            recognition.recognitionSource ||
            "",

          reasonCode:
            recognition.reasonCode ||
            ""
        }
      }
    );


    return jsonResponse(
      {
        ok:
          true,

        recognized:
          recognition.recognized,

        grossKg:
          recognition.grossKg,

        tareKg:
          recognition.tareKg,

        netKg:
          recognition.netKg,

        quantityKg:
          recognition.quantityKg,

        quantityTon:
          recognition.quantityTon,

        printedValue:
          recognition.printedValue,

        confidence:
          recognition.confidence,

        fullSlipVisible:
          recognition.fullSlipVisible,

        recognitionSource:
          recognition.recognitionSource,

        reasonCode:
          recognition.reasonCode,

        slipImageKey:
          objectKey,

        message:
          recognition.message
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