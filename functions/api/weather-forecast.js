"use strict";


/* =========================================================
  기상청 날씨누리 · 신북면 오전회의 날씨 API

  호출:
  GET /api/weather-forecast?date=2026-08-10

  조회 기준:
  경기 포천시 신북면 · 포천아트밸리 좌표
  해당 날짜 오전 09:00
========================================================= */

const WEATHER_NURI_FORECAST_URL =
  "https://www.weather.go.kr/w/wnuri-fct2021/main/digital-forecast.do";


const WEATHER_NURI_SOURCE_URL =
  "https://www.weather.go.kr/w/index.do#dong/4165034000/37.92317414931059/127.23724560487442/%EA%B2%BD%EA%B8%B0%20%ED%8F%AC%EC%B2%9C%EC%8B%9C%20%EC%8B%A0%EB%B6%81%EB%A9%B4/SCH/%ED%8F%AC%EC%B2%9C%EC%95%84%ED%8A%B8%EB%B0%B8%EB%A6%AC";


const LOCATION_CODE =
  "4165034000";


const LATITUDE =
  "37.92317414931059";


const LONGITUDE =
  "127.23724560487442";


const FORECAST_TIME =
  "09:00";


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
  공통 문자열·날짜 처리
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


function escapeRegExp(
  value
) {
  return normalizeText(
    value
  ).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


function decodeHtmlEntities(
  value
) {
  return normalizeText(
    value
  )
    .replace(
      /&#(\d+);/g,
      (
        _,
        decimalValue
      ) =>
        String.fromCodePoint(
          Number(
            decimalValue
          )
        )
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (
        _,
        hexadecimalValue
      ) =>
        String.fromCodePoint(
          Number.parseInt(
            hexadecimalValue,
            16
          )
        )
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      "\""
    )
    .replace(
      /&#39;|&apos;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    );
}


function getHtmlAttribute(
  attributeSource,
  attributeName
) {
  const escapedName =
    escapeRegExp(
      attributeName
    );


  const match =
    normalizeText(
      attributeSource
    ).match(
      new RegExp(
        `(?:^|\\s)${escapedName}` +
        "\\s*=\\s*" +
        "([\"'])" +
        "([\\s\\S]*?)" +
        "\\1",
        "i"
      )
    );


  return decodeHtmlEntities(
    match?.[2]
  );
}


function numberOrNull(
  value
) {
  const normalizedValue =
    normalizeText(
      value
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


/* =========================================================
  날씨누리 HTML 추출
========================================================= */

function extractHourlyBlock(
  sourceHtml,
  targetDate
) {
  const itemPattern =
    /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi;


  let match =
    null;


  while (
    (
      match =
        itemPattern.exec(
          sourceHtml
        )
    ) !==
      null
  ) {
    const attributes =
      match[1];


    if (
      getHtmlAttribute(
        attributes,
        "data-date"
      ) ===
        targetDate &&

      getHtmlAttribute(
        attributes,
        "data-time"
      ) ===
        FORECAST_TIME
    ) {
      return match[2];
    }
  }


  return "";
}


function extractDailyHeadBlock(
  sourceHtml,
  targetDate
) {
  const openingTagPattern =
    /<div\b([^>]*)>/gi;


  let match =
    null;


  while (
    (
      match =
        openingTagPattern.exec(
          sourceHtml
        )
    ) !==
      null
  ) {
    const attributes =
      match[1];


    const classNames =
      getHtmlAttribute(
        attributes,
        "class"
      )
        .split(
          /\s+/
        )
        .filter(
          Boolean
        );


    if (
      !classNames.includes(
        "daily"
      ) ||

      getHtmlAttribute(
        attributes,
        "data-date"
      ) !==
        targetDate
    ) {
      continue;
    }


    const remainingHtml =
      sourceHtml.slice(
        openingTagPattern.lastIndex
      );


    const itemWrapMatch =
      /<div\b[^>]*\bclass=["'][^"']*\bitem-wrap\b[^"']*["'][^>]*>/i.exec(
        remainingHtml
      );


    if (
      !itemWrapMatch
    ) {
      return "";
    }


    return normalizeText(
      remainingHtml.slice(
        0,
        itemWrapMatch.index
      )
    );
  }


  return "";
}


function extractClassNumber(
  sourceHtml,
  className
) {
  const escapedClassName =
    escapeRegExp(
      className
    );


  const match =
    sourceHtml.match(
      new RegExp(
        "<span\\b" +
        "(?=[^>]*\\bclass=[\"'][^\"']*" +
        `\\b${escapedClassName}\\b` +
        "[^\"']*[\"'])" +
        "[^>]*>\\s*" +
        "(-?\\d+(?:\\.\\d+)?)\\s*℃",
        "i"
      )
    );


  return numberOrNull(
    match?.[1]
  );
}


function extractWeatherTitle(
  hourlyBlock
) {
  const tagMatch =
    hourlyBlock.match(
      /<span\b([^>]*\bclass=["'][^"']*\bwic\b[^"']*["'][^>]*)>/i
    );


  return getHtmlAttribute(
    tagMatch?.[1],
    "title"
  );
}


function extractTemperature(
  hourlyBlock
) {
  const match =
    hourlyBlock.match(
      /<span\b(?=[^>]*\bclass=["'][^"']*\bfeel\b[^"']*["'])[^>]*>\s*(-?\d+(?:\.\d+)?)\s*℃/i
    );


  return numberOrNull(
    match?.[1]
  );
}


function extractHumidity(
  hourlyBlock
) {
  const match =
    hourlyBlock.match(
      /습도\s*:\s*<\/span>\s*<span[^>]*>\s*(\d+(?:\.\d+)?)\s*%/i
    );


  return numberOrNull(
    match?.[1]
  );
}


/*
  화면에는 사용자가 요청한
  비 / 흐림 / 맑음 세 종류로 정리한다.
*/

function normalizeWeatherCondition(
  sourceCondition
) {
  const condition =
    decodeHtmlEntities(
      sourceCondition
    ).replace(
      /\s+/g,
      " "
    );


  if (
    /(비|소나기|빗방울|눈|진눈깨비)/.test(
      condition
    )
  ) {
    return "비";
  }


  if (
    /(흐림|구름|안개|박무|연무|황사)/.test(
      condition
    )
  ) {
    return "흐림";
  }


  if (
    /맑/.test(
      condition
    )
  ) {
    return "맑음";
  }


  return condition ||
    "-";
}


function parseWeatherForecast(
  sourceHtml,
  targetDate
) {
  const hourlyBlock =
    extractHourlyBlock(
      sourceHtml,
      targetDate
    );


  const dailyHeadBlock =
    extractDailyHeadBlock(
      sourceHtml,
      targetDate
    );


  if (
    !hourlyBlock ||
    !dailyHeadBlock
  ) {
    return null;
  }


  const sourceCondition =
    extractWeatherTitle(
      hourlyBlock
    );


  const temperature =
    extractTemperature(
      hourlyBlock
    );


  const humidity =
    extractHumidity(
      hourlyBlock
    );


  const minimumTemperature =
    extractClassNumber(
      dailyHeadBlock,
      "minval"
    );


  const maximumTemperature =
    extractClassNumber(
      dailyHeadBlock,
      "maxval"
    );


  if (
    !sourceCondition ||
    temperature ===
      null ||
    humidity ===
      null ||
    minimumTemperature ===
      null ||
    maximumTemperature ===
      null
  ) {
    return null;
  }


  return {
    sourceDate:
      targetDate,

    targetDate,

    forecastTime:
      `${targetDate}T${FORECAST_TIME}:00+09:00`,

    forecastHour:
      FORECAST_TIME,

    locationCode:
      LOCATION_CODE,

    location:
      "경기 포천시 신북면",

    placeName:
      "포천아트밸리",

    latitude:
      Number(
        LATITUDE
      ),

    longitude:
      Number(
        LONGITUDE
      ),

    condition:
      normalizeWeatherCondition(
        sourceCondition
      ),

    sourceCondition,

    temperature,
    minimumTemperature,
    maximumTemperature,
    humidity,

    unit: {
      temperature:
        "℃",

      humidity:
        "%"
    },

    source:
      "기상청 날씨누리",

    sourceUrl:
      WEATHER_NURI_SOURCE_URL,

    collectedAt:
      new Date()
        .toISOString()
  };
}


/* =========================================================
  날씨누리 단일 날짜 조회
========================================================= */

async function fetchWeatherNuriForecast(
  targetDate
) {
  const requestUrl =
    new URL(
      WEATHER_NURI_FORECAST_URL
    );


  requestUrl.searchParams.set(
    "code",
    LOCATION_CODE
  );


  requestUrl.searchParams.set(
    "hr1",
    "Y"
  );


  requestUrl.searchParams.set(
    "lat",
    LATITUDE
  );


  requestUrl.searchParams.set(
    "lon",
    LONGITUDE
  );


  requestUrl.searchParams.set(
    "ts",
    ""
  );


  requestUrl.searchParams.set(
    "unit",
    "m/s"
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
              "text/html, */*; q=0.1",

            "User-Agent":
              "Mozilla/5.0 (compatible; GS-Shift-Log/1.0)"
          },

          signal:
            controller.signal
        }
      );


    if (
      !response.ok
    ) {
      throw new Error(
        `날씨누리 응답 오류 (${response.status})`
      );
    }


    const sourceHtml =
      await response.text();


    return parseWeatherForecast(
      sourceHtml,
      targetDate
    );

  } finally {
    clearTimeout(
      timeoutId
    );
  }
}


/* =========================================================
  GET /api/weather-forecast?date=YYYY-MM-DD
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
          "날씨 조회 날짜를 YYYY-MM-DD 형식으로 입력해 주세요."
      },
      400
    );
  }


  try {
    const item =
      await fetchWeatherNuriForecast(
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
            `${targetDate} 09:00 신북면 날씨 자료가 아직 없거나 날씨누리 응답 형식이 올바르지 않습니다.`
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
      "public, max-age=300, s-maxage=900"
    );

  } catch (
    error
  ) {
    const isTimeout =
      error?.name ===
        "AbortError";


    console.error(
      "기상청 날씨누리 조회 실패:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          isTimeout
            ? "기상청 날씨누리 응답 시간이 초과되었습니다. 잠시 후 다시 조회해 주세요."
            : "기상청 날씨누리 자료를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요."
      },
      502
    );
  }
}