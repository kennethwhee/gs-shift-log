"use strict";


/* =========================================================
  기상청 날씨누리 · 신북면 오전회의 날씨 API

  실제 배치 경로:
  functions/api/weather-forecast.js

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


const D1_TABLE_NAME =
  "morning_meeting_weather_forecasts";


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
  D1 저장 테이블

  저장 규칙:
  - 조회에 성공한 날짜만 저장
  - 일반 조회는 D1 저장값 우선
  - 다시 조회는 날씨누리 재조회 후 같은 날짜 갱신
  - 과거 자료 자동 소급조회 없음
========================================================= */

async function ensureWeatherForecastTable(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS ${D1_TABLE_NAME} (
        forecast_date TEXT NOT NULL,
        forecast_hour TEXT NOT NULL,
        location_code TEXT NOT NULL,

        forecast_time TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        place_name TEXT NOT NULL DEFAULT '',
        latitude REAL,
        longitude REAL,

        condition TEXT NOT NULL,
        source_condition TEXT NOT NULL DEFAULT '',
        temperature REAL NOT NULL,
        minimum_temperature REAL NOT NULL,
        maximum_temperature REAL NOT NULL,
        humidity REAL NOT NULL,

        unit_json TEXT NOT NULL DEFAULT '{}',
        source TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        collected_at TEXT NOT NULL,
        raw_item_json TEXT NOT NULL DEFAULT '{}',

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,

        PRIMARY KEY (
          forecast_date,
          forecast_hour,
          location_code
        )
      )
    `)
    .run();


  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_morning_weather_forecast_date

      ON ${D1_TABLE_NAME} (
        forecast_date,
        forecast_hour
      )
    `)
    .run();
}


function parseJsonObject(
  value,
  fallbackValue =
    {}
) {
  try {
    const parsedValue =
      JSON.parse(
        normalizeText(
          value
        ) ||
        "{}"
      );


    return (
      parsedValue &&
      typeof parsedValue ===
        "object" &&
      !Array.isArray(
        parsedValue
      )
    )
      ? parsedValue
      : fallbackValue;

  } catch {
    return fallbackValue;
  }
}


function normalizeStoredWeatherForecast(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  const sourceDate =
    normalizeText(
      row.forecast_date
    );


  const condition =
    normalizeText(
      row.condition
    );


  const temperature =
    numberOrNull(
      row.temperature
    );


  const minimumTemperature =
    numberOrNull(
      row.minimum_temperature
    );


  const maximumTemperature =
    numberOrNull(
      row.maximum_temperature
    );


  const humidity =
    numberOrNull(
      row.humidity
    );


  if (
    !isValidIsoDate(
      sourceDate
    ) ||
    !condition ||
    temperature ===
      null ||
    minimumTemperature ===
      null ||
    maximumTemperature ===
      null ||
    humidity ===
      null
  ) {
    return null;
  }


  const rawItem =
    parseJsonObject(
      row.raw_item_json
    );


  return {
    ...rawItem,

    sourceDate,
    targetDate:
      sourceDate,

    forecastTime:
      normalizeText(
        row.forecast_time
      ) ||
      `${sourceDate}T${FORECAST_TIME}:00+09:00`,

    forecastHour:
      normalizeText(
        row.forecast_hour
      ) ||
      FORECAST_TIME,

    locationCode:
      normalizeText(
        row.location_code
      ) ||
      LOCATION_CODE,

    location:
      normalizeText(
        row.location
      ) ||
      "경기 포천시 신북면",

    placeName:
      normalizeText(
        row.place_name
      ) ||
      "포천아트밸리",

    latitude:
      numberOrNull(
        row.latitude
      ) ??
      Number(
        LATITUDE
      ),

    longitude:
      numberOrNull(
        row.longitude
      ) ??
      Number(
        LONGITUDE
      ),

    condition,

    sourceCondition:
      normalizeText(
        row.source_condition
      ) ||
      condition,

    temperature,
    minimumTemperature,
    maximumTemperature,
    humidity,

    unit:
      parseJsonObject(
        row.unit_json,
        {
          temperature:
            "℃",

          humidity:
            "%"
        }
      ),

    source:
      normalizeText(
        row.source
      ) ||
      "기상청 날씨누리",

    sourceUrl:
      normalizeText(
        row.source_url
      ) ||
      WEATHER_NURI_SOURCE_URL,

    collectedAt:
      normalizeText(
        row.collected_at
      ),

    storedAt:
      normalizeText(
        row.updated_at
      ),

    revision:
      Number(
        row.revision ||
        1
      )
  };
}


async function getStoredWeatherForecast(
  database,
  targetDate
) {
  const row =
    await database
      .prepare(`
        SELECT
          *

        FROM ${D1_TABLE_NAME}

        WHERE forecast_date = ?
          AND forecast_hour = ?
          AND location_code = ?

        LIMIT 1
      `)
      .bind(
        targetDate,
        FORECAST_TIME,
        LOCATION_CODE
      )
      .first();


  return normalizeStoredWeatherForecast(
    row
  );
}


async function saveWeatherForecast(
  database,
  item
) {
  const nowIso =
    new Date()
      .toISOString();


  const rawItemJson =
    JSON.stringify(
      item
    );


  const unitJson =
    JSON.stringify(
      item.unit &&
      typeof item.unit ===
        "object"
        ? item.unit
        : {
            temperature:
              "℃",

            humidity:
              "%"
          }
    );


  await database
    .prepare(`
      INSERT INTO ${D1_TABLE_NAME} (
        forecast_date,
        forecast_hour,
        location_code,
        forecast_time,
        location,
        place_name,
        latitude,
        longitude,
        condition,
        source_condition,
        temperature,
        minimum_temperature,
        maximum_temperature,
        humidity,
        unit_json,
        source,
        source_url,
        collected_at,
        raw_item_json,
        created_at,
        updated_at,
        revision
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, 1
      )

      ON CONFLICT (
        forecast_date,
        forecast_hour,
        location_code
      )

      DO UPDATE SET
        forecast_time =
          excluded.forecast_time,
        location =
          excluded.location,
        place_name =
          excluded.place_name,
        latitude =
          excluded.latitude,
        longitude =
          excluded.longitude,
        condition =
          excluded.condition,
        source_condition =
          excluded.source_condition,
        temperature =
          excluded.temperature,
        minimum_temperature =
          excluded.minimum_temperature,
        maximum_temperature =
          excluded.maximum_temperature,
        humidity =
          excluded.humidity,
        unit_json =
          excluded.unit_json,
        source =
          excluded.source,
        source_url =
          excluded.source_url,
        collected_at =
          excluded.collected_at,
        raw_item_json =
          excluded.raw_item_json,
        updated_at =
          excluded.updated_at,
        revision =
          ${D1_TABLE_NAME}.revision + 1
    `)
    .bind(
      item.sourceDate,
      item.forecastHour ||
        FORECAST_TIME,
      item.locationCode ||
        LOCATION_CODE,
      item.forecastTime ||
        `${item.sourceDate}T${FORECAST_TIME}:00+09:00`,
      item.location ||
        "경기 포천시 신북면",
      item.placeName ||
        "포천아트밸리",
      numberOrNull(
        item.latitude
      ),
      numberOrNull(
        item.longitude
      ),
      item.condition,
      item.sourceCondition ||
        item.condition,
      item.temperature,
      item.minimumTemperature,
      item.maximumTemperature,
      item.humidity,
      unitJson,
      item.source ||
        "기상청 날씨누리",
      item.sourceUrl ||
        WEATHER_NURI_SOURCE_URL,
      item.collectedAt ||
        nowIso,
      rawItemJson,
      nowIso,
      nowIso
    )
    .run();


  return await getStoredWeatherForecast(
    database,
    item.sourceDate
  );
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


  const refreshValue =
    normalizeText(
      requestUrl.searchParams.get(
        "refresh"
      )
    ).toLowerCase();


  /*
    기존 화면의 다시 조회 버튼은
    캐시 방지용 _ 값을 함께 보낸다.

    refresh=1 또는 _가 있으면
    D1 값을 반환하지 않고 날씨누리를 새로 조회한다.
  */

  const forceRefresh =
    [
      "1",
      "true",
      "yes"
    ].includes(
      refreshValue
    ) ||
    requestUrl.searchParams.has(
      "_"
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


  if (
    !context.env.DB
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "날씨 저장용 D1 바인딩 DB가 등록되지 않았습니다."
      },
      500
    );
  }


  try {
    await ensureWeatherForecastTable(
      context.env.DB
    );

  } catch (
    error
  ) {
    console.error(
      "신북 날씨 D1 테이블 준비 실패:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          "신북 날씨 D1 저장소를 준비하지 못했습니다."
      },
      500
    );
  }


  let storedItem =
    null;


  try {
    storedItem =
      await getStoredWeatherForecast(
        context.env.DB,
        targetDate
      );

  } catch (
    error
  ) {
    console.error(
      "신북 날씨 D1 조회 실패:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          "신북 날씨 D1 저장자료를 불러오지 못했습니다."
      },
      500
    );
  }


  if (
    storedItem &&
    !forceRefresh
  ) {
    return jsonResponse({
      ok:
        true,

      item:
        storedItem,

      storage:
        "d1",

      persisted:
        true,

      refreshed:
        false
    });
  }


  let fetchedItem =
    null;


  try {
    fetchedItem =
      await fetchWeatherNuriForecast(
        targetDate
      );


    if (
      !fetchedItem
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


  try {
    const savedItem =
      await saveWeatherForecast(
        context.env.DB,
        fetchedItem
      );


    if (
      !savedItem
    ) {
      throw new Error(
        "저장 후 날씨 자료를 다시 확인하지 못했습니다."
      );
    }


    return jsonResponse({
      ok:
        true,

      item:
        savedItem,

      storage:
        "weather_nuri",

      persisted:
        true,

      refreshed:
        forceRefresh
    });

  } catch (
    error
  ) {
    console.error(
      "신북 날씨 D1 저장 실패:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          "날씨는 조회했지만 D1에 저장하지 못했습니다. 잠시 후 다시 조회해 주세요."
      },
      500
    );
  }
}
