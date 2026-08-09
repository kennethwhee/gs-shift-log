"use strict";


/* =========================================================
  한국전력거래소 EPSIS 육지 SMP 단가 API

  경로:
  functions/api/smp-price.js

  호출:
  GET /api/smp-price?date=2026-08-07

  EPSIS 원본 필드:
  c25 = 최대
  c26 = 최소
  c27 = 가중평균
========================================================= */

const EPSIS_DATA_URL =
  "https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpShd.ajax";


const EPSIS_SOURCE_URL =
  "https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpShdChart.do?menuId=040202";


const UPSTREAM_TIMEOUT_MS =
  15000;


/* =========================================================
  JSON 응답
========================================================= */

function jsonResponse(
  data,
  status = 200,
  cacheControl =
    "no-store, no-cache, must-revalidate"
) {
  return Response.json(
    data,
    {
      status,

      headers: {
        "Cache-Control":
          cacheControl,

        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}


/* =========================================================
  날짜 확인
========================================================= */

function normalizeText(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function isValidIsoDate(
  value
) {
  const normalizedValue =
    normalizeText(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalizedValue
    )
  ) {
    return false;
  }


  const parsedDate =
    new Date(
      `${normalizedValue}T00:00:00.000Z`
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
      normalizedValue
  );
}


/* =========================================================
  EPSIS 응답 숫자 추출

  실제 응답:
  c25 = textFormmat("183.55",count);
  c26 = textFormmat("110.92",count);
  c27 = textFormmat("155.79",count);
========================================================= */

function extractEpsisNumber(
  sourceText,
  fieldName
) {
  const escapedFieldName =
    fieldName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );


  const pattern =
    new RegExp(
      `\\b${escapedFieldName}` +
      "\\s*=\\s*" +
      "textFormmat\\(" +
      "\\s*[\"']" +
      "([^\"']*)" +
      "[\"']\\s*,",

      "i"
    );


  const match =
    sourceText.match(
      pattern
    );


  const normalizedValue =
    normalizeText(
      match?.[1]
    ).replace(
      /,/g,
      ""
    );


  if (
    !normalizedValue
  ) {
    return null;
  }


  const numericValue =
    Number(
      normalizedValue
    );


  return Number.isFinite(
    numericValue
  )
    ? numericValue
    : null;
}


function extractEpsisSourceDate(
  sourceText
) {
  const match =
    sourceText.match(
      /["']Date["']\s*:\s*["'](\d{4})\/(\d{2})\/(\d{2})["']/i
    );


  if (
    !match
  ) {
    return "";
  }


  return [
    match[1],
    match[2],
    match[3]
  ].join("-");
}


/* =========================================================
  EPSIS 단일 날짜 조회
========================================================= */

async function fetchEpsisSmpPrice(
  targetDate
) {
  const compactDate =
    targetDate.replace(
      /-/g,
      ""
    );


  const requestUrl =
    new URL(
      EPSIS_DATA_URL
    );


  requestUrl.searchParams.set(
    "beginDate",
    compactDate
  );


  requestUrl.searchParams.set(
    "endDate",
    compactDate
  );


  requestUrl.searchParams.set(
    "selYear",
    ""
  );


  requestUrl.searchParams.set(
    "selMonth",
    ""
  );


  requestUrl.searchParams.set(
    "selKind",
    "land"
  );


  requestUrl.searchParams.set(
    "locale",
    ""
  );


  const controller =
    new AbortController();


  const timeoutId =
    setTimeout(
      () => {
        controller.abort();
      },
      UPSTREAM_TIMEOUT_MS
    );


  try {
    const response =
      await fetch(
        requestUrl.toString(),
        {
          method:
            "GET",

          headers: {
            Accept:
              "text/plain, text/javascript, */*; q=0.01"
          },

          signal:
            controller.signal
        }
      );


    if (
      !response.ok
    ) {
      throw new Error(
        `EPSIS 응답 오류 (${response.status})`
      );
    }


    const sourceText =
      await response.text();


    const sourceDate =
      extractEpsisSourceDate(
        sourceText
      );


    const maximum =
      extractEpsisNumber(
        sourceText,
        "c25"
      );


    const minimum =
      extractEpsisNumber(
        sourceText,
        "c26"
      );


    const weightedAverage =
      extractEpsisNumber(
        sourceText,
        "c27"
      );


    if (
      sourceDate !==
        targetDate ||
      maximum ===
        null ||
      minimum ===
        null ||
      weightedAverage ===
        null
    ) {
      return null;
    }


    return {
      sourceDate,

      targetDate:
        sourceDate,

      region:
        "land",

      regionLabel:
        "육지",

      maximum,
      minimum,
      weightedAverage,

      unit:
        "원/kWh",

      source:
        "한국전력거래소 EPSIS",

      sourceUrl:
        EPSIS_SOURCE_URL,

      collectedAt:
        new Date()
          .toISOString()
    };

  } finally {
    clearTimeout(
      timeoutId
    );
  }
}


/* =========================================================
  GET /api/smp-price?date=YYYY-MM-DD
========================================================= */

export async function onRequestGet(
  context
) {
  const requestUrl =
    new URL(
      context.request.url
    );


  const targetDate =
    normalizeText(
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
          "SMP 조회 날짜를 YYYY-MM-DD 형식으로 입력해 주세요."
      },
      400
    );
  }


  try {
    const item =
      await fetchEpsisSmpPrice(
        targetDate
      );


    if (
      !item
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            `${targetDate} 육지 SMP 자료가 아직 없거나 EPSIS 응답 형식이 올바르지 않습니다.`
        },
        404
      );
    }


    return jsonResponse(
      {
        ok:
          true,

        item
      },
      200,
      "public, max-age=300, s-maxage=3600"
    );

  } catch (
    error
  ) {
    const isTimeout =
      error?.name ===
        "AbortError";


    console.error(
      "EPSIS SMP 조회 실패:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          isTimeout
            ? "EPSIS 응답 시간이 초과되었습니다. 잠시 후 다시 조회해 주세요."
            : "EPSIS SMP 자료를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요."
      },
      502
    );
  }
}