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
  - LIMESTONE_SLIP_BUCKET 또는 LIMESTONE_SLIPS : 비공개 R2
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
  계근대 표시 단위와 OCR 반올림 오차를 고려한 허용값.
  인쇄된 실중량과 총중량 - 공차중량의 차이가 이 값을
  초과하면 자동 확정하지 않는다.
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


function getAiAnswerText(
  aiResult
) {
  if (
    typeof aiResult ===
      "string"
  ) {
    return normalizeText(
      aiResult
    );
  }


  const directCandidates = [
    aiResult?.answer,
    aiResult?.response,
    aiResult?.output_text,
    aiResult?.text,
    aiResult?.result?.answer,
    aiResult?.result?.response,
    aiResult?.result?.output_text,
    aiResult?.result?.text
  ];


  for (
    const candidate of directCandidates
  ) {
    if (
      typeof candidate !==
        "string"
    ) {
      continue;
    }


    const answerText =
      normalizeText(
        candidate
      );


    if (
      answerText
    ) {
      return answerText;
    }
  }


  const contentItems =
    Array.isArray(
      aiResult?.content
    )
      ? aiResult.content
      : Array.isArray(
          aiResult?.result?.content
        )
        ? aiResult.result.content
        : [];


  return contentItems
    .map(
      item =>
        normalizeText(
          typeof item ===
            "string"
              ? item
              : item?.text
        )
    )
    .filter(
      Boolean
    )
    .join(
      "\n"
    )
    .trim();
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


/* =========================================================
  비엄격 AI 응답에서 중량 필드 복구

  작은 Vision 모델은 JSON을 요청해도 다음처럼 반환할 수 있다.

  - { "row1Kg": 44,300 }
  - ROW1=44300
  - grossKg: "44.300"

  첫 번째 형식은 유효한 JSON이 아니므로 JSON.parse만 사용하면
  화면에 보이는 숫자까지 모두 null로 버려진다. 키 뒤의 값만
  제한적으로 복구하고 최종 확정은 기존 중량 산식 검증에 맡긴다.
========================================================= */

function extractLooseOcrWeightField(
  answerText,
  aliases
) {
  const aliasPattern =
    aliases.join(
      "|"
    );

  const match =
    normalizeText(
      answerText
    ).match(
      new RegExp(
        `(?:["']?)(?:${aliasPattern})(?:["']?)\\s*(?::|=|\\||-{1,2}|→)\\s*(?:["'*_~]\\s*)*(-?\\d{1,3}(?:[\\s,.]\\d{3})+|-?\\d{4,6})(?:\\s*(?:kg|㎏))?`,
        "i"
      )
    );


  return match?.[1] ||
    undefined;
}


function extractLooseOcrObject(
  answerText
) {
  const looseObject = {};

  const fieldDefinitions = [
    {
      name:
        "grossKg",

      aliases: [
        "grossKg",
        "grossWeightKg",
        "totalWeightKg",
        "gross",
        "row1Kg",
        "row1",
        "gross[\\s_-]*kg",
        "gross[\\s_-]*weight",
        "row[\\s_-]*1(?:[\\s_-]*kg)?"
      ]
    },
    {
      name:
        "tareKg",

      aliases: [
        "tareKg",
        "tareWeightKg",
        "emptyWeightKg",
        "tare",
        "row2Kg",
        "row2",
        "tare[\\s_-]*kg",
        "tare[\\s_-]*weight",
        "row[\\s_-]*2(?:[\\s_-]*kg)?"
      ]
    },
    {
      name:
        "netKg",

      aliases: [
        "netKg",
        "netWeightKg",
        "quantityKg",
        "net",
        "row3Kg",
        "row3",
        "net[\\s_-]*kg",
        "net[\\s_-]*weight",
        "row[\\s_-]*3(?:[\\s_-]*kg)?"
      ]
    }
  ];


  for (
    const fieldDefinition of fieldDefinitions
  ) {
    const value =
      extractLooseOcrWeightField(
        answerText,
        fieldDefinition.aliases
      );


    if (
      value !==
        undefined
    ) {
      looseObject[
        fieldDefinition.name
      ] = value;
    }
  }


  const confidenceMatch =
    normalizeText(
      answerText
    ).match(
      /(?:["']?confidence["']?)\s*[:=]\s*(?:["']?)(high|medium|low)/i
    );


  if (
    confidenceMatch
  ) {
    looseObject.confidence =
      confidenceMatch[1]
        .toLowerCase();
  }


  return Object.keys(
    looseObject
  ).length
    ? looseObject
    : null;
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


function getFirstObjectValueDeep(
  source,
  propertyNames,
  depth = 0
) {
  const directValue =
    getFirstObjectValue(
      source,
      propertyNames
    );


  if (
    directValue !==
      undefined
  ) {
    return directValue;
  }


  if (
    !source ||
    typeof source !==
      "object" ||
    depth >=
      3
  ) {
    return undefined;
  }


  for (
    const nestedValue of Object.values(
      source
    )
  ) {
    if (
      !nestedValue ||
      typeof nestedValue !==
        "object"
    ) {
      continue;
    }


    const foundValue =
      getFirstObjectValueDeep(
        nestedValue,
        propertyNames,
        depth +
          1
      );


    if (
      foundValue !==
        undefined
    ) {
      return foundValue;
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
    30,920 또는 30.920처럼 세 자리 구분자로 보이는 경우는
    구분자를 제거한다. 그 밖의 마침표는 소수점으로 유지한다.
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


function normalizeWeightSequence(
  source
) {
  if (
    !Array.isArray(
      source
    )
  ) {
    return [];
  }


  return source
    .map(
      item => {
        if (
          item &&
          typeof item ===
            "object"
        ) {
          return normalizeWeightKg(
            getFirstObjectValueDeep(
              item,
              [
                "kg",
                "valueKg",
                "weightKg",
                "value",
                "weight",
                "printedValue"
              ]
            )
          );
        }


        return normalizeWeightKg(
          item
        );
      }
    )
    .filter(
      weightKg =>
        weightKg !==
          null
    );
}


function extractRawKgWeightSequence(
  answerText
) {
  const weights = [];

  const normalizedAnswer =
    normalizeText(
      answerText
    );

  const weightPattern =
    /(-?\d{1,3}(?:[,.]\d{3})+|-?\d{4,6})\s*(?:kg|㎏)/gi;


  for (
    const match of normalizedAnswer.matchAll(
      weightPattern
    )
  ) {
    const weightKg =
      normalizeWeightKg(
        `${match[1]} kg`
      );


    if (
      weightKg !==
        null
    ) {
      weights.push(
        weightKg
      );
    }
  }


  return weights;
}


function extractRawWeightCandidateSequence(
  answerText
) {
  const weights = [];

  const normalizedAnswer =
    normalizeText(
      answerText
    );

  /*
    모델이 kg나 ROW 라벨 없이 숫자 세 줄, 문장, Markdown 표로
    반환해도 4~6자리 중량 후보를 복구한다. 날짜·시간 등이 함께
    섞여도 최종 확정은 gross - tare ≈ net 산식 검증을 반드시
    통과해야 한다.
  */
  const weightPattern =
    /(?:^|[^\d])(-?\d{1,3}(?:[,.]\d{3})+|-?\d{4,6})(?!\d)/g;


  for (
    const match of normalizedAnswer.matchAll(
      weightPattern
    )
  ) {
    const weightKg =
      normalizeWeightKg(
        match[1]
      );


    if (
      weightKg !==
        null
    ) {
      weights.push(
        weightKg
      );
    }
  }


  return weights;
}


function describeOcrAnswerFormat(
  answerText
) {
  const normalizedAnswer =
    normalizeText(
      answerText
    );


  if (
    !normalizedAnswer
  ) {
    return "empty";
  }


  if (
    extractJsonObject(
      normalizedAnswer
    )
  ) {
    return "json";
  }


  if (
    /row[\s_-]*[123]/i.test(
      normalizedAnswer
    )
  ) {
    return /\|/.test(
      normalizedAnswer
    )
      ? "row_table"
      : "row_text";
  }


  if (
    /(?:kg|㎏)/i.test(
      normalizedAnswer
    )
  ) {
    return "kg_text";
  }


  if (
    extractRawWeightCandidateSequence(
      normalizedAnswer
    ).length
  ) {
    return "numeric_text";
  }


  return "other";
}


function hasSafeUnlabeledWeightContext(
  answerText
) {
  const normalizedAnswer =
    normalizeText(
      answerText
    );


  if (
    /(?:\b(?:gross|tare|net|weight)\b|\brow[\s_-]*[123]\b|총\s*중\s*량|공\s*차\s*중\s*량|실\s*중\s*량|순\s*중\s*량|kg|㎏)/i.test(
      normalizedAnswer
    )
  ) {
    return true;
  }


  const lines =
    normalizedAnswer
      .split(
        /\r?\n/
      )
      .map(
        line =>
          line.trim()
      )
      .filter(
        Boolean
      );

  const bareWeightLinePattern =
    /^\s*(?:[-*•|]\s*)?(?:[*_~]\s*)*(-?\d{1,3}(?:[,.]\d{3})+|-?\d{4,6})(?:\s*(?:kg|㎏))?(?:\s*[*_~|])*\s*$/i;

  const bareWeightLineCount =
    lines.filter(
      line =>
        bareWeightLinePattern.test(
          line
        )
    ).length;

  const otherLinesAreMetadata =
    lines.every(
      line =>
        bareWeightLinePattern.test(
          line
        ) ||
        /^(?:```(?:text)?|```|confidence\s*[:=].*)$/i.test(
          line
        )
    );


  return bareWeightLineCount ===
    3 &&
    otherLinesAreMetadata;
}


function findValidatedWeightTriple(
  weights
) {
  for (
    let index = 0;
    index <=
      weights.length -
        3;
    index +=
      1
  ) {
    const grossKg =
      weights[index];

    const tareKg =
      weights[index +
        1];

    const netKg =
      weights[index +
        2];

    const calculatedNetKg =
      grossKg -
      tareKg;


    if (
      grossKg >
        tareKg &&
      calculatedNetKg >=
        MIN_QUANTITY_KG &&
      calculatedNetKg <=
        MAX_QUANTITY_KG &&
      Math.abs(
        calculatedNetKg -
        netKg
      ) <=
        WEIGHT_DIFFERENCE_TOLERANCE_KG
    ) {
      return {
        grossKg,
        tareKg,
        netKg
      };
    }
  }


  return null;
}


function extractValidatedWeightTriple(
  answerText,
  answerObject
) {
  const objectSequence =
    normalizeWeightSequence(
      getFirstObjectValueDeep(
        answerObject,
        [
          "weightsTopToBottomKg",
          "weightsKg",
          "weightValuesKg",
          "weightRows",
          "weights"
        ]
      )
    );

  const objectTriple =
    findValidatedWeightTriple(
      objectSequence
    );


  if (
    objectTriple
  ) {
    return objectTriple;
  }


  const rawKgTriple =
    findValidatedWeightTriple(
      extractRawKgWeightSequence(
        answerText
      )
    );


  if (
    rawKgTriple
  ) {
    return rawKgTriple;
  }


  const rawWeightCandidates =
    extractRawWeightCandidateSequence(
      answerText
    );


  if (
    rawWeightCandidates.length !==
      3 ||
    !hasSafeUnlabeledWeightContext(
      answerText
    )
  ) {
    return null;
  }


  return findValidatedWeightTriple(
    rawWeightCandidates
  );
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
    ].join(" ")
  );
}


function extractWeightField(
  answerText,
  answerObject,
  propertyNames,
  labelPattern,
  visiblePropertyNames = []
) {
  const objectValue =
    getFirstObjectValueDeep(
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


  /*
    모델이 숫자는 정확히 반환하면서 visible 플래그만 false로
    잘못 표시하는 경우가 있다. 유효한 숫자를 먼저 사용하고,
    숫자가 없을 때만 visible=false를 적용한다.
  */

  const visibleValue =
    getFirstObjectValueDeep(
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

    case "no_weight_candidates":
      return "사진은 정상적으로 전송됐지만 AI가 중량 숫자를 읽지 못했습니다. 아래 분석코드를 확인해 주세요.";

    case "ocr_conflict":
      return "두 번의 AI 판독값이 서로 달라 실중량을 자동 확정하지 않았습니다. 전표와 분석코드를 확인해 주세요.";

    case "insufficient_weight_fields":
      return "실중량 또는 총중량·공차중량을 모두 확인하지 못했습니다. 전표 전체를 다시 촬영하거나 직접 입력해 주세요.";

    default:
      return "실중량을 정확히 인식하지 못했습니다. 전표를 확인해 직접 입력해 주세요.";
  }
}


function parseOcrAnswer(
  answerText
) {
  const strictAnswerObject =
    extractJsonObject(
      answerText
    );

  const looseAnswerObject =
    extractLooseOcrObject(
      answerText
    );

  const answerObject =
    strictAnswerObject ||
    looseAnswerObject
      ? {
          ...(
            strictAnswerObject ||
            {}
          ),

          ...(
            looseAnswerObject ||
            {}
          )
        }
      : null;


  const confidence =
    normalizeConfidence(
      getFirstObjectValueDeep(
        answerObject,
        [
          "confidence",
          "overallConfidence"
        ]
      )
    );


  const fullSlipVisible =
    normalizeBoolean(
      getFirstObjectValueDeep(
        answerObject,
        [
          "fullSlipVisible",
          "documentVisible"
        ]
      )
    );


  const validatedTriple =
    extractValidatedWeightTriple(
      answerText,
      answerObject
    );


  let grossKg =
    extractWeightField(
      answerText,
      answerObject,
      [
        "grossKg",
        "grossWeightKg",
        "totalWeightKg",
        "row1Kg",
        "firstRowKg",
        "weightRow1Kg"
      ],
      "(?:총\\s*중\\s*량|gross(?:\\s*weight)?)",
      [
        "grossVisible",
        "grossWeightVisible"
      ]
    );


  let tareKg =
    extractWeightField(
      answerText,
      answerObject,
      [
        "tareKg",
        "tareWeightKg",
        "emptyWeightKg",
        "row2Kg",
        "secondRowKg",
        "weightRow2Kg"
      ],
      "(?:공\\s*차\\s*중\\s*량|차\\s*중\\s*량|tare(?:\\s*weight)?)",
      [
        "tareVisible",
        "tareWeightVisible"
      ]
    );


  let netKg =
    extractWeightField(
      answerText,
      answerObject,
      [
        "netKg",
        "quantityKg",
        "netWeightKg",
        "printedValue",
        "netPrintedValue",
        "row3Kg",
        "thirdRowKg",
        "weightRow3Kg"
      ],
      "(?:실\\s*중\\s*량|순\\s*중\\s*량|net(?:\\s*weight)?)",
      [
        "netVisible",
        "netWeightVisible"
      ]
    );


  if (
    validatedTriple
  ) {
    grossKg =
      validatedTriple.grossKg;

    tareKg =
      validatedTriple.tareKg;

    netKg =
      validatedTriple.netKg;
  }


  const printedValue =
    normalizeText(
      getFirstObjectValueDeep(
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


  const allWeightsAgree =
    netKg !==
      null &&
    hasGrossAndTare &&
    Math.abs(
      netKg -
      differenceKg
    ) <=
      WEIGHT_DIFFERENCE_TOLERANCE_KG;


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
    allWeightsAgree
  ) {
    /*
      세 값이 산식으로 서로 검증되면 모델의 confidence 누락이나
      low 표기만으로 정확한 실중량을 버리지 않는다.
    */

    quantityKg =
      netKg;

    recognitionSource =
      "validated_three_rows";

  } else if (
    netKg !==
      null &&
    confidenceIsUsable
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
    netKg !==
      null
  ) {
    reasonCode =
      "low_confidence";

  } else if (
    fullSlipVisible ===
      false
  ) {
    reasonCode =
      "net_weight_not_visible";

  } else if (
    netKg ===
      null &&
    grossKg ===
      null &&
    tareKg ===
      null
  ) {
    reasonCode =
      "no_weight_candidates";

  } else {
    reasonCode =
      "insufficient_weight_fields";
  }


  const recognized =
    quantityKg !==
      null;


  const finalConfidence =
    recognized &&
    !confidenceIsUsable &&
    (
      recognitionSource ===
        "gross_minus_tare" ||
      allWeightsAgree
    )
        ? "medium"
        : confidence;


  const recognition = {
    recognized,

    grossKg,

    tareKg,

    /*
      netKg는 전표에 직접 인쇄되어 AI가 읽은 값이다.
      quantityKg는 검증 후 실제로 사용할 최종값이며,
      총중량 - 공차중량으로 계산된 값일 수도 있다.
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


function getRecognitionEvidenceScore(
  recognition
) {
  let score =
    recognition.recognized
      ? 100
      : 0;


  for (
    const fieldName of [
      "grossKg",
      "tareKg",
      "netKg"
    ]
  ) {
    if (
      recognition[fieldName] !==
        null
    ) {
      score +=
        10;
    }
  }


  if (
    recognition.recognitionSource ===
      "validated_three_rows"
  ) {
    score +=
      40;

  } else if (
    recognition.recognitionSource ===
      "gross_minus_tare"
  ) {
    score +=
      25;

  } else if (
    recognition.recognitionSource ===
      "printed_net"
  ) {
    score +=
      15;
  }


  if (
    recognition.confidence ===
      "high"
  ) {
    score +=
      3;

  } else if (
    recognition.confidence ===
      "medium"
  ) {
    score +=
      2;
  }


  return score;
}


function createMergedOcrRecognition(
  preferredRecognition,
  secondaryRecognition
) {
  const mergedObject = {
    grossKg:
      preferredRecognition.grossKg ??
      secondaryRecognition.grossKg,

    tareKg:
      preferredRecognition.tareKg ??
      secondaryRecognition.tareKg,

    netKg:
      preferredRecognition.netKg ??
      secondaryRecognition.netKg,

    printedValue:
      preferredRecognition.printedValue ||
      secondaryRecognition.printedValue ||
      "",

    confidence:
      [
        preferredRecognition.confidence,
        secondaryRecognition.confidence
      ].includes(
        "high"
      )
        ? "high"
        : [
            preferredRecognition.confidence,
            secondaryRecognition.confidence
          ].includes(
            "medium"
          )
          ? "medium"
          : "low"
  };


  return parseOcrAnswer(
    JSON.stringify(
      mergedObject
    )
  );
}


function mergeOcrRecognitions(
  primaryRecognition,
  fallbackRecognition
) {
  const primaryEvidenceKg =
    normalizeWeightKg(
      primaryRecognition.netKg ??
      primaryRecognition.quantityKg
    );

  const fallbackEvidenceKg =
    normalizeWeightKg(
      fallbackRecognition.netKg ??
      fallbackRecognition.quantityKg
    );


  if (
    primaryEvidenceKg !==
      null &&
    fallbackEvidenceKg !==
      null &&
    Math.abs(
      primaryEvidenceKg -
      fallbackEvidenceKg
    ) >
      WEIGHT_DIFFERENCE_TOLERANCE_KG
  ) {
    const primaryHasValidatedTriple =
      primaryRecognition.recognitionSource ===
        "validated_three_rows";

    const fallbackHasValidatedTriple =
      fallbackRecognition.recognitionSource ===
        "validated_three_rows";


    /*
      한쪽만 세 중량 산식 검증을 통과했다면 그 판독을 사용한다.
      두 쪽의 증거 수준이 같거나 둘 다 단일 실중량이면 어느 한쪽도
      임의 선택하지 않고 충돌로 차단한다.
    */
    if (
      primaryHasValidatedTriple !==
        fallbackHasValidatedTriple
    ) {
      return primaryHasValidatedTriple
        ? primaryRecognition
        : fallbackRecognition;
    }


    const conflictRecognition = {
      recognized:
        false,

      grossKg:
        primaryRecognition.grossKg ===
          fallbackRecognition.grossKg
            ? primaryRecognition.grossKg
            : null,

      tareKg:
        primaryRecognition.tareKg ===
          fallbackRecognition.tareKg
            ? primaryRecognition.tareKg
            : null,

      netKg:
        null,

      quantityKg:
        null,

      quantityTon:
        null,

      printedValue:
        "",

      confidence:
        "low",

      fullSlipVisible:
        null,

      recognitionSource:
        null,

      reasonCode:
        "ocr_conflict"
    };


    return {
      ...conflictRecognition,

      message:
        getRecognitionMessage(
          conflictRecognition
        )
    };
  }


  const candidates = [
    primaryRecognition,
    fallbackRecognition,
    createMergedOcrRecognition(
      primaryRecognition,
      fallbackRecognition
    ),
    createMergedOcrRecognition(
      fallbackRecognition,
      primaryRecognition
    )
  ];


  if (
    primaryRecognition.netKg !==
      null &&
    fallbackRecognition.netKg !==
      null &&
    Math.abs(
      primaryRecognition.netKg -
      fallbackRecognition.netKg
    ) <=
      WEIGHT_DIFFERENCE_TOLERANCE_KG
  ) {
    candidates.push(
      parseOcrAnswer(
        JSON.stringify({
          netKg:
            primaryRecognition.netKg,

          confidence:
            "medium"
        })
      )
    );
  }


  return candidates
    .sort(
      (
        left,
        right
      ) =>
        getRecognitionEvidenceScore(
          right
        ) -
        getRecognitionEvidenceScore(
          left
        )
    )[0];
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
      Cloudflare 대시보드의 R2 바인딩 이름이 어느 쪽이든
      별도 설정 변경 없이 같은 버킷을 사용할 수 있다.
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

    const ocrImageCandidate =
      formData.get(
        "ocrImage"
      );

    const ocrTightImageCandidate =
      formData.get(
        "ocrImageTight"
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


    const ocrImageFile =
      ocrImageCandidate &&
      typeof ocrImageCandidate.arrayBuffer ===
        "function"
        ? ocrImageCandidate
        : imageFile;

    const ocrTightImageFile =
      ocrTightImageCandidate &&
      typeof ocrTightImageCandidate.arrayBuffer ===
        "function"
        ? ocrTightImageCandidate
        : ocrImageFile;


    if (
      normalizeText(
        imageFile.type
      ).toLowerCase() !==
        "image/jpeg" ||
      normalizeText(
        ocrImageFile.type
      ).toLowerCase() !==
        "image/jpeg" ||
      normalizeText(
        ocrTightImageFile.type
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

    const ocrImageBuffer =
      ocrImageFile ===
        imageFile
        ? imageBuffer
        : await ocrImageFile.arrayBuffer();

    const ocrTightImageBuffer =
      ocrTightImageFile ===
        imageFile
        ? imageBuffer
        : ocrTightImageFile ===
            ocrImageFile
          ? ocrImageBuffer
          : await ocrTightImageFile.arrayBuffer();


    const imageBytes =
      new Uint8Array(
        imageBuffer
      );

    const ocrImageBytes =
      ocrImageBuffer ===
        imageBuffer
        ? imageBytes
        : new Uint8Array(
            ocrImageBuffer
          );

    const ocrTightImageBytes =
      ocrTightImageBuffer ===
        imageBuffer
        ? imageBytes
        : ocrTightImageBuffer ===
            ocrImageBuffer
          ? ocrImageBytes
          : new Uint8Array(
              ocrTightImageBuffer
            );


    if (
      imageBytes.byteLength <
        1 ||
      ocrImageBytes.byteLength <
        1 ||
      ocrTightImageBytes.byteLength <
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
        MAX_IMAGE_BYTES ||
      ocrImageBytes.byteLength >
        MAX_IMAGE_BYTES ||
      ocrTightImageBytes.byteLength >
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


    const ocrImageDataUri =
      "data:image/jpeg;base64," +
      bytesToBase64(
        ocrImageBytes
      );

    const ocrTightImageDataUri =
      ocrTightImageBytes ===
        ocrImageBytes
        ? ocrImageDataUri
        : "data:image/jpeg;base64," +
          bytesToBase64(
            ocrTightImageBytes
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
              ocrTightImageDataUri,

            question: `
This image is a tight crop of the weight-table band on a Korean weighing receipt.
Read the three consecutive printed weight values ending in kg, from top to bottom.
They are normally gross weight, tare weight, and net/actual weight in that order.

Copy the digits that are visibly printed. Do not require the Korean labels to be readable.
Ignore dates, times, vehicle numbers, phone numbers, registration numbers, handwritten numbers, and numbers on background papers.
  Comma and dot can both be thousands separators in the image.
  In the JSON response use plain integer digits without separators.
Do not copy example values and do not guess an unreadable digit.

Return one JSON object only, with these exact keys:
grossKg, tareKg, netKg, confidence

Each weight must be an integer in kg copied from the image, or null when unreadable.
confidence must be high, medium, or low.
            `.trim(),

            reasoning:
              false,

            temperature:
              0,

            max_tokens:
              220,

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
      getAiAnswerText(
        aiResult
      );

    const primaryAnswerFormat =
      describeOcrAnswerFormat(
        answerText
      );


    let recognition =
      parseOcrAnswer(
        answerText
      );

    const primaryRecognition =
      recognition;

    const primaryFinishReason =
      normalizeText(
        aiResult?.finish_reason ??
        aiResult?.finishReason
      );


    let fallbackAnswerText =
      "";

    let fallbackFinishReason =
      "";

    let fallbackRecognition =
      null;


    /*
      첫 질문에서 세 중량을 모두 확정하지 못했거나 실중량 한 값만
      읽은 경우, 넓은 크롭을 숫자 전사 방식으로 한 번 더 읽는다.
      두 시도에서 각각 읽은 일부 값도 버리지 않고 합친 뒤 산식으로
      최종 검증한다.
    */

    if (
      !recognition.recognized ||
      recognition.recognitionSource ===
        "printed_net"
    ) {
      try {
        const fallbackAiResult =
          await context.env.AI.run(
            OCR_MODEL,
            {
              task:
                "query",

              image:
                ocrImageDataUri,

              question: `
Read the three printed weight rows on this wider crop of a Korean weighing receipt by position, from top to bottom.
The Korean labels do not need to be readable. Copy digits only from the receipt. Ignore all other numbers, dates, times, handwriting, vehicle numbers, phone numbers, and background papers.
Comma and dot can both be thousands separators.
Do not calculate missing values and do not guess unreadable digits.

Return exactly four plain-text lines and nothing else.
Use the labels ROW1, ROW2, ROW3, and CONFIDENCE in that order.
After each ROW label write an equals sign followed only by the visible integer digits without separators, or NULL when that row is unreadable.
After CONFIDENCE write an equals sign followed by high, medium, or low.
Do not include any sample or placeholder numbers.
              `.trim(),

              reasoning:
                false,

              temperature:
                0,

              max_tokens:
                220,

              stream:
                false
            }
          );


        fallbackAnswerText =
          getAiAnswerText(
            fallbackAiResult
          );


        fallbackFinishReason =
          normalizeText(
            fallbackAiResult?.finish_reason ??
            fallbackAiResult?.finishReason
          );


        fallbackRecognition =
          parseOcrAnswer(
            fallbackAnswerText
          );


        recognition =
          mergeOcrRecognitions(
            recognition,
            fallbackRecognition
          );

      } catch (
        fallbackError
      ) {
        console.warn(
          "[Limestone Slip OCR] fallback query failed:",
          fallbackError
        );
      }
    }


    const fallbackAnswerFormat =
      describeOcrAnswerFormat(
        fallbackAnswerText
      );

    const diagnosticCode = [
      `P-${primaryAnswerFormat}-${Math.min(answerText.length, 9999)}`,
      `F-${fallbackAnswerFormat}-${Math.min(fallbackAnswerText.length, 9999)}`
    ].join(
      "/"
    );


    if (
      !recognition.recognized
    ) {
      console.warn(
        "[Limestone Slip OCR] weight not recognized:",
        JSON.stringify({
          reasonCode:
            recognition.reasonCode,

          confidence:
            recognition.confidence,

          primary: {
            finishReason:
              primaryFinishReason,

            answerLength:
              answerText.length,

            answerFormat:
              primaryAnswerFormat,

            candidateWeightsKg:
              extractRawWeightCandidateSequence(
                answerText
              ).slice(
                0,
                10
              ),

            grossKg:
              primaryRecognition.grossKg,

            tareKg:
              primaryRecognition.tareKg,

            netKg:
              primaryRecognition.netKg,

            reasonCode:
              primaryRecognition.reasonCode
          },

          fallback:
            fallbackRecognition
              ? {
                  finishReason:
                    fallbackFinishReason,

                  answerLength:
                    fallbackAnswerText.length,

                  answerFormat:
                    fallbackAnswerFormat,

                  candidateWeightsKg:
                    extractRawWeightCandidateSequence(
                      fallbackAnswerText
                    ).slice(
                      0,
                      10
                    ),

                  grossKg:
                    fallbackRecognition.grossKg,

                  tareKg:
                    fallbackRecognition.tareKg,

                  netKg:
                    fallbackRecognition.netKg,

                  reasonCode:
                    fallbackRecognition.reasonCode
                }
              : null
        })
      );
    }


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

        diagnosticCode:
          recognition.recognized
            ? ""
            : diagnosticCode,

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
