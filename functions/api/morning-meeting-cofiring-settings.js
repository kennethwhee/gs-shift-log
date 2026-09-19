/*
  MORNING_COFIRING_SHARED_SETTINGS_BRIDGE_V1

  Morning Meeting compatibility API.

  Single source of truth:
    /api/cofiring-calculation-settings

  The Morning Meeting UI keeps its existing contract:
    GET  ?targetDate=YYYY-MM-DD
    POST { effectiveDate, coalKcalPerKg, bioKcalPerKg, organicKcalPerKg }

  Storage behavior:
  - Coal / Bio / Organic calorific values are shared with Co-firing.
  - Unit 1 / Unit 2 always use the same values.
  - Existing correction coefficients are preserved.
  - Existing manure calorific value and coefficient are preserved.
  - Saving from Morning Meeting therefore creates the same
    co-firing calculation-settings history used by the Co-firing menu.

  Legacy table morning_meeting_cofiring_calorific_values is intentionally
  not deleted. It is retained only as historical data and is no longer
  the active source of truth.
*/

import * as SharedSettingsApi
  from "./cofiring-calculation-settings.js";


const SHARED_PATH =
  "/api/cofiring-calculation-settings";


const DEFAULT_UNIT = Object.freeze({
  coal: Object.freeze({
    calorific: 5868,
    coefficient: 1
  }),

  bio: Object.freeze({
    calorific: 3237,
    coefficient: 1
  }),

  organic: Object.freeze({
    calorific: 3487,
    coefficient: 1
  }),

  manure: Object.freeze({
    calorific: 3487,
    coefficient: 1
  })
});


function jsonResponse(
  payload,
  status = 200
) {
  return new Response(
    JSON.stringify(payload),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


function normalizeText(
  value
) {
  return String(
    value ?? ""
  ).trim();
}


function isIsoDate(
  value
) {
  const text =
    normalizeText(value);

  return (
    /^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  );
}


function positiveNumber(
  value,
  fallback
) {
  const number =
    Number(value);

  return (
    Number.isFinite(number) &&
    number > 0
  )
    ? number
    : fallback;
}


function normalizeMorningCalorific(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number) ||
    number <= 0 ||
    number > 50000
  ) {
    return null;
  }

  return number;
}


function cloneUnit(
  source
) {
  const candidate =
    source &&
    typeof source === "object" &&
    !Array.isArray(source)
      ? source
      : {};

  const output =
    {};

  for (
    const fuel
    of [
      "coal",
      "bio",
      "organic",
      "manure"
    ]
  ) {
    const fallback =
      DEFAULT_UNIT[fuel];

    const item =
      candidate[fuel] &&
      typeof candidate[fuel] === "object" &&
      !Array.isArray(candidate[fuel])
        ? candidate[fuel]
        : {};

    output[fuel] = {
      calorific:
        positiveNumber(
          item.calorific,
          fallback.calorific
        ),

      coefficient:
        positiveNumber(
          item.coefficient,
          fallback.coefficient
        )
    };
  }

  return output;
}


function normalizeSharedSettings(
  source
) {
  const settings =
    source &&
    typeof source === "object" &&
    !Array.isArray(source)
      ? source
      : {};

  /*
    1·2호기 동일 기준.
    기존 공용 설정의 unit1을 우선 사용하고,
    없으면 unit2를 사용한다.
  */
  const canonical =
    cloneUnit(
      settings.unit1 ||
      settings.unit2 ||
      DEFAULT_UNIT
    );

  return {
    unit1:
      cloneUnit(canonical),

    unit2:
      cloneUnit(canonical)
  };
}


function extractSharedSettings(
  payload
) {
  return normalizeSharedSettings(
    payload?.entry?.settings ||
    payload?.settings ||
    null
  );
}


function buildMorningSetting(
  payload,
  requestedDate
) {
  const sharedSettings =
    extractSharedSettings(payload);

  const unit =
    sharedSettings.unit1;

  const entry =
    payload?.entry &&
    typeof payload.entry === "object"
      ? payload.entry
      : null;

  const effectiveDate =
    normalizeText(
      entry?.effectiveDate ||
      payload?.effectiveDate ||
      requestedDate
    );

  return {
    effectiveDate,

    coalKcalPerKg:
      unit.coal.calorific,

    bioKcalPerKg:
      unit.bio.calorific,

    organicKcalPerKg:
      unit.organic.calorific,

    manureKcalPerKg:
      unit.manure.calorific,

    updatedById:
      normalizeText(
        entry?.updatedById ||
        payload?.updatedById
      ),

    updatedByName:
      normalizeText(
        entry?.updatedByName ||
        payload?.updatedByName
      ),

    updatedAt:
      normalizeText(
        entry?.updatedAt ||
        payload?.updatedAt
      )
  };
}


function sharedUrlFrom(
  requestUrl,
  targetDate
) {
  const url =
    new URL(requestUrl);

  url.pathname =
    SHARED_PATH;

  url.search =
    "";

  if (
    targetDate
  ) {
    url.searchParams.set(
      "targetDate",
      targetDate
    );
  }

  return url;
}


function copyHeaders(
  sourceHeaders
) {
  const headers =
    new Headers(
      sourceHeaders || {}
    );

  headers.set(
    "Accept",
    "application/json"
  );

  return headers;
}


async function invokeSharedApi(
  context,
  request
) {
  const sharedContext = {
    ...context,
    request
  };

  const method =
    request.method
      .toUpperCase();

  if (
    typeof SharedSettingsApi.onRequest ===
    "function"
  ) {
    return await SharedSettingsApi.onRequest(
      sharedContext
    );
  }

  if (
    method === "GET" &&
    typeof SharedSettingsApi.onRequestGet ===
      "function"
  ) {
    return await SharedSettingsApi.onRequestGet(
      sharedContext
    );
  }

  if (
    method === "POST" &&
    typeof SharedSettingsApi.onRequestPost ===
      "function"
  ) {
    return await SharedSettingsApi.onRequestPost(
      sharedContext
    );
  }

  if (
    typeof SharedSettingsApi.default ===
    "function"
  ) {
    return await SharedSettingsApi.default(
      sharedContext
    );
  }

  throw new Error(
    "공용 혼소율 설정 API handler를 찾지 못했습니다."
  );
}


async function readSharedResponse(
  response
) {
  const text =
    await response.text();

  let payload =
    {};

  if (
    text.trim()
  ) {
    try {
      payload =
        JSON.parse(text);

    } catch {
      payload = {
        ok: false,
        message:
          "공용 발열량 설정 서버 응답 형식이 올바르지 않습니다."
      };
    }
  }

  return {
    response,
    payload
  };
}


function forwardSharedError(
  response,
  payload
) {
  return jsonResponse(
    {
      ...payload,

      ok:
        false,

      message:
        normalizeText(
          payload?.message ||
          payload?.error
        ) ||
        "공용 발열량 설정 요청에 실패했습니다."
    },

    Number(response?.status) ||
    500
  );
}


async function loadSharedSetting(
  context,
  targetDate
) {
  const url =
    sharedUrlFrom(
      context.request.url,
      targetDate
    );

  const request =
    new Request(
      url.toString(),
      {
        method:
          "GET",

        headers:
          copyHeaders(
            context.request.headers
          )
      }
    );

  const response =
    await invokeSharedApi(
      context,
      request
    );

  const result =
    await readSharedResponse(
      response
    );

  return result;
}


async function handleGet(
  context
) {
  const sourceUrl =
    new URL(
      context.request.url
    );

  const targetDate =
    normalizeText(
      sourceUrl.searchParams.get(
        "targetDate"
      )
    );

  if (
    !isIsoDate(targetDate)
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "발열량 조회 날짜를 확인해 주세요."
      },
      400
    );
  }

  const {
    response,
    payload
  } =
    await loadSharedSetting(
      context,
      targetDate
    );

  if (
    !response.ok ||
    payload?.ok === false
  ) {
    return forwardSharedError(
      response,
      payload
    );
  }

  const setting =
    buildMorningSetting(
      payload,
      targetDate
    );

  return jsonResponse({
    ok: true,

    targetDate:
      normalizeText(
        payload?.targetDate
      ) ||
      targetDate,

    source:
      normalizeText(
        payload?.source
      ) ||
      "shared",

    effectiveDate:
      setting.effectiveDate,

    /*
      기존 오전회의 프런트 호환.
      setting / settings / top-level 모두 제공한다.
    */
    setting,
    settings:
      setting,

    ...setting
  });
}


async function handlePost(
  context
) {
  let body =
    {};

  try {
    body =
      await context.request.json();

  } catch {
    return jsonResponse(
      {
        ok: false,
        message:
          "발열량 저장 요청 형식을 확인해 주세요."
      },
      400
    );
  }

  const effectiveDate =
    normalizeText(
      body?.effectiveDate
    );

  const coalKcalPerKg =
    normalizeMorningCalorific(
      body?.coalKcalPerKg
    );

  const bioKcalPerKg =
    normalizeMorningCalorific(
      body?.bioKcalPerKg
    );

  const organicKcalPerKg =
    normalizeMorningCalorific(
      body?.organicKcalPerKg
    );

  const manureKcalPerKg =
    normalizeMorningCalorific(
      body?.manureKcalPerKg
    );

  if (
    !isIsoDate(effectiveDate) ||
    coalKcalPerKg === null ||
    bioKcalPerKg === null ||
    organicKcalPerKg === null ||
    manureKcalPerKg === null
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "적용 시작일과 Coal · Bio · 유기성 · 축분 발열량을 확인해 주세요."
      },
      400
    );
  }

  /*
    먼저 해당 적용일의 공용 설정을 읽는다.

    오전회의 화면에는 보정계수와 축분 입력칸이 없으므로
    그것들은 현재 공용값을 절대 변경하지 않는다.
  */
  const loaded =
    await loadSharedSetting(
      context,
      effectiveDate
    );

  if (
    !loaded.response.ok ||
    loaded.payload?.ok === false
  ) {
    return forwardSharedError(
      loaded.response,
      loaded.payload
    );
  }

  const settings =
    extractSharedSettings(
      loaded.payload
    );

  settings.unit1.coal.calorific =
    coalKcalPerKg;

  settings.unit1.bio.calorific =
    bioKcalPerKg;

  settings.unit1.organic.calorific =
    organicKcalPerKg;

  settings.unit1.manure.calorific =
    manureKcalPerKg;

  /*
    사용자 운영 기준:
    1·2호기는 같은 연료 기준값을 사용한다.
  */
  settings.unit2 =
    cloneUnit(
      settings.unit1
    );

  const requestId =
    normalizeText(
      body?.requestId
    ) ||
    (
      globalThis.crypto?.randomUUID?.() ||
      `morning-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`
    );

  const url =
    sharedUrlFrom(
      context.request.url,
      ""
    );

  const headers =
    copyHeaders(
      context.request.headers
    );

  headers.set(
    "Content-Type",
    "application/json"
  );

  /*
    공용 설정 API의 기존 desktop 저장 보호조건 유지.
  */
  headers.set(
    "X-ShiftLog-Client",
    "desktop"
  );

  const request =
    new Request(
      url.toString(),
      {
        method:
          "POST",

        headers,

        body:
          JSON.stringify({
            effectiveDate,
            settings,
            requestId
          })
      }
    );

  const response =
    await invokeSharedApi(
      context,
      request
    );

  const result =
    await readSharedResponse(
      response
    );

  if (
    !response.ok ||
    result.payload?.ok === false
  ) {
    return forwardSharedError(
      response,
      result.payload
    );
  }

  const setting =
    buildMorningSetting(
      result.payload,
      effectiveDate
    );

  return jsonResponse({
    ok: true,

    message:
      "발열량을 공용 혼소율 계산 기준에 저장했습니다.",

    source:
      "shared",

    effectiveDate:
      setting.effectiveDate,

    setting,
    settings:
      setting,

    ...setting
  });
}


export async function onRequest(
  context
) {
  try {
    const method =
      context.request.method
        .toUpperCase();

    if (
      method === "GET"
    ) {
      return await handleGet(
        context
      );
    }

    if (
      method === "POST"
    ) {
      return await handlePost(
        context
      );
    }

    return jsonResponse(
      {
        ok: false,
        message:
          "지원하지 않는 요청 방식입니다."
      },
      405
    );

  } catch (
    error
  ) {
    console.error(
      "Morning Meeting shared calorific settings bridge failed:",
      error
    );

    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "공용 발열량 설정 처리 중 오류가 발생했습니다."
      },
      500
    );
  }
}