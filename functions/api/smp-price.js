"use strict";


/* =========================================================
  한국전력거래소 EPSIS 육지 SMP 단가 API

  GET /api/smp-price?date=2026-08-07

  EPSIS 원본 필드
  c25 = 최대 / c26 = 최소 / c27 = 가중평균
========================================================= */

const EPSIS_CHART_URL =
  "https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpShdChart.do?menuId=040202";


const EPSIS_DATA_URL =
  "https://epsis.kpx.or.kr/epsisnew/selectEkmaSmpShd.ajax";


const UPSTREAM_TIMEOUT_MS =
  15000;


const SUCCESS_CACHE_CONTROL =
  "public, max-age=600, s-maxage=600";


const FAILURE_CACHE_CONTROL =
  "no-store, no-cache, must-revalidate";


const BROWSER_HEADERS = {
  "Accept-Language":
    "ko-KR,ko;q=0.9,en;q=0.8",

  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36"
};


/* =========================================================
  공통 처리
========================================================= */

function jsonResponse(
  data,
  status = 200,
  cacheControl =
    FAILURE_CACHE_CONTROL
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


async function fetchWithTimeout(
  url,
  options = {}
) {
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
    return await fetch(
      url,
      {
        ...options,

        signal:
          controller.signal
      }
    );

  } finally {
    clearTimeout(
      timeoutId
    );
  }
}


/* =========================================================
  EPSIS 세션 쿠키
========================================================= */

function getEpsisCookieHeader(
  response
) {
  let setCookieValues =
    [];


  if (
    typeof response.headers
      .getSetCookie ===
      "function"
  ) {
    setCookieValues =
      response.headers
        .getSetCookie();

  } else {
    const setCookieValue =
      response.headers.get(
        "set-cookie"
      );


    if (
      setCookieValue
    ) {
      setCookieValues = [
        setCookieValue
      ];
    }
  }


  return setCookieValues
    .map(
      value => {
        return normalizeText(
          value
        ).split(
          ";"
        )[0];
      }
    )
    .filter(
      Boolean
    )
    .join(
      "; "
    );
}


async function createEpsisSession() {
  const response =
    await fetchWithTimeout(
      EPSIS_CHART_URL,
      {
        method:
          "GET",

        redirect:
          "follow",

        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          ...BROWSER_HEADERS
        }
      }
    );


  if (
    !response.ok
  ) {
    throw new Error(
      `EPSIS 화면 응답 오류 (${response.status})`
    );
  }


  const cookieHeader =
    getEpsisCookieHeader(
      response
    );


  await response.text();


  return cookieHeader;
}


/* =========================================================
  EPSIS 응답 추출
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
      `\\b${escapedFieldName}\\s*=\\s*` +
      `textFormmat\\(\\s*["']([^"']*)["']\\s*,`,

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
  ].join(
    "-"
  );
}


/* =========================================================
  EPSIS 단일 날짜 조회

  실제 EPSIS 화면과 동일하게
  POST + form 방식으로 조회
========================================================= */

async function fetchEpsisSmpPrice(
  targetDate
) {
  const compactDate =
    targetDate.replace(
      /-/g,
      ""
    );


  const cookieHeader =
    await createEpsisSession();


  const requestBody =
    new URLSearchParams(
      {
        beginDate:
          compactDate,

        endDate:
          compactDate,

        selYear:
          "",

        selMonth:
          "",

        selKind:
          "land",

        locale:
          ""
      }
    ).toString();


  const requestHeaders = {
    Accept:
      "text/plain, text/javascript, */*; q=0.01",

    "Content-Type":
      "application/x-www-form-urlencoded; charset=UTF-8",

    Origin:
      "https://epsis.kpx.or.kr",

    Referer:
      EPSIS_CHART_URL,

    "X-Requested-With":
      "XMLHttpRequest",

    ...BROWSER_HEADERS
  };


  if (
    cookieHeader
  ) {
    requestHeaders.Cookie =
      cookieHeader;
  }


  const response =
    await fetchWithTimeout(
      EPSIS_DATA_URL,
      {
        method:
          "POST",

        redirect:
          "follow",

        headers:
          requestHeaders,

        body:
          requestBody
      }
    );


  if (
    !response.ok
  ) {
    throw new Error(
      `EPSIS 자료 응답 오류 (${response.status})`
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
      EPSIS_CHART_URL,

    collectedAt:
      new Date()
        .toISOString()
  };
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

        date:
          item.targetDate,

        land:
          item.regionLabel,

        max:
          item.maximum,

        min:
          item.minimum,

        avg:
          item.weightedAverage,

        item
      },
      200,
      SUCCESS_CACHE_CONTROL
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