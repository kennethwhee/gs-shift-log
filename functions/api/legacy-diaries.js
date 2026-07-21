"use strict";

/* =========================================================
  기존 업무일지 조회 API

  사용 예시:
  /api/legacy-diaries?date=20260721&shift=DAY
  /api/legacy-diaries?date=20260721&shift=NIGHT
========================================================= */

const LEGACY_API_BASE =
  "https://cqggd7e15l.execute-api.ap-northeast-2.amazonaws.com/prod";


/* =========================================================
  JSON 응답
========================================================= */

function createJsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


/* =========================================================
  날짜 형식 확인

  허용 형식:
  20260721
========================================================= */

function isValidDateString(value) {
  return /^\d{8}$/.test(value);
}


/* =========================================================
  기존 업무일지 로그인 후 JWT 반환
========================================================= */

async function getLegacyAuthToken(env) {
  const accountId =
    String(
      env.LEGACY_ACCOUNT_ID || ""
    ).trim();

  const password =
    String(
      env.LEGACY_PASSWORD || ""
    ).trim();

  const plantUnit =
    String(
      env.LEGACY_PLANT_UNIT ||
      "POCHEON"
    ).trim();


  if (
    !accountId ||
    !password ||
    !plantUnit
  ) {
    throw new Error(
      "기존 업무일지 환경변수가 등록되지 않았습니다."
    );
  }


  const response = await fetch(
    `${LEGACY_API_BASE}/signin`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "Accept":
          "application/json"
      },

      body: JSON.stringify({
        account_id:
          accountId,

        password,

        plant_unit:
          plantUnit
      })
    }
  );


  const responseText =
    await response.text();

  let responseData = {};

  try {
    responseData =
      responseText
        ? JSON.parse(responseText)
        : {};
  } catch {
    responseData = {};
  }


  if (!response.ok) {
    throw new Error(
      `기존 업무일지 로그인 실패 (${response.status})`
    );
  }


  const token =
    responseData.jwt_token ||
    responseData.token ||
    responseData.access_token ||
    responseData.accessToken ||
    "";


  if (!token) {
    throw new Error(
      "로그인 응답에서 인증 토큰을 찾지 못했습니다."
    );
  }


  return String(token);
}


/* =========================================================
  기존 업무일지 조회
========================================================= */

async function fetchLegacyDiaries(
  token,
  date,
  shift
) {
  const requestUrl =
    new URL(
      `${LEGACY_API_BASE}/diaries`
    );

  requestUrl.searchParams.set(
    "date",
    date
  );

  requestUrl.searchParams.set(
    "shift",
    shift
  );


  const response = await fetch(
    requestUrl.toString(),
    {
      method: "GET",

      headers: {
        "Authorization":
          `Bearer ${token}`,

        "Accept":
          "application/json",

        "Content-Type":
          "application/json"
      }
    }
  );


  const responseText =
    await response.text();

  let responseData = {};

  try {
    responseData =
      responseText
        ? JSON.parse(responseText)
        : {};
  } catch {
    responseData = {
      rawResponse:
        responseText.slice(
          0,
          500
        )
    };
  }


  if (!response.ok) {
    throw new Error(
      `기존 업무일지 조회 실패 (${response.status})`
    );
  }


  const items =
    Array.isArray(
      responseData.items
    )
      ? responseData.items
      : [];


  return {
    items,

    rawData:
      responseData
  };
}


/* =========================================================
  GET /api/legacy-diaries
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    const url =
      new URL(
        context.request.url
      );

    const date =
      String(
        url.searchParams.get("date") ||
        ""
      ).trim();

    const shift =
      String(
        url.searchParams.get("shift") ||
        ""
      )
        .trim()
        .toUpperCase();


    /*
      날짜 확인
    */
    if (!isValidDateString(date)) {
      return createJsonResponse(
        {
          success: false,

          message:
            "date는 YYYYMMDD 형식으로 입력해야 합니다.",

          example:
            "/api/legacy-diaries?date=20260721&shift=DAY"
        },

        400
      );
    }


    /*
      근무조 확인
    */
    if (
      shift !== "DAY" &&
      shift !== "NIGHT"
    ) {
      return createJsonResponse(
        {
          success: false,

          message:
            "shift는 DAY 또는 NIGHT만 사용할 수 있습니다.",

          example:
            "/api/legacy-diaries?date=20260721&shift=NIGHT"
        },

        400
      );
    }


    /*
      로그인
    */
    const token =
      await getLegacyAuthToken(
        context.env
      );


    /*
      업무일지 조회
    */
    const result =
      await fetchLegacyDiaries(
        token,
        date,
        shift
      );


    return createJsonResponse(
      {
        success: true,

        message:
          "기존 업무일지를 정상적으로 불러왔습니다.",

        date,

        shift,

        count:
          result.items.length,

        items:
          result.items
      }
    );

  } catch (error) {
    console.error(
      "Legacy diaries error:",
      error
    );

    return createJsonResponse(
      {
        success: false,

        message:
          "기존 업무일지를 불러오지 못했습니다.",

        error:
          error instanceof Error
            ? error.message
            : String(error)
      },

      500
    );
  }
}


/* =========================================================
  지원하지 않는 요청
========================================================= */

export function onRequestPost() {
  return createJsonResponse(
    {
      success: false,

      message:
        "이 주소는 GET 요청만 지원합니다."
    },

    405
  );
}