"use strict";

/* =========================================================
  기존 업무일지 API 로그인 연결 테스트

  접속 주소:
  /api/legacy-login

  실제 계정정보는 코드에 작성하지 않고
  Cloudflare 환경변수에서 불러온다.
========================================================= */

const LEGACY_API_BASE =
  "https://cqggd7e15l.execute-api.ap-northeast-2.amazonaws.com/prod";


/* =========================================================
  JSON 응답 생성
========================================================= */

function createJsonResponse(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
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
  기존 업무일지 로그인
========================================================= */

async function requestLegacyLogin(
  env
) {
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


  /*
    환경변수 등록 여부 확인
  */
  const missingVariables = [];

  if (!accountId) {
    missingVariables.push(
      "LEGACY_ACCOUNT_ID"
    );
  }

  if (!password) {
    missingVariables.push(
      "LEGACY_PASSWORD"
    );
  }

  if (!plantUnit) {
    missingVariables.push(
      "LEGACY_PLANT_UNIT"
    );
  }

  if (missingVariables.length > 0) {
    return {
      success: false,

      status: 500,

      error:
        "환경변수가 등록되지 않았습니다.",

      missingVariables
    };
  }


  /*
    기존 업무일지 로그인 요청
  */
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


  /*
    응답 내용을 먼저 문자열로 받는다.
  */
  const responseText =
    await response.text();

  let responseData = {};

  try {
    responseData =
      responseText
        ? JSON.parse(
            responseText
          )
        : {};
  } catch {
    responseData = {
      rawResponse:
        responseText
          .slice(
            0,
            300
          )
    };
  }


  /*
    로그인 실패
  */
  if (!response.ok) {
    return {
      success: false,

      status:
        response.status,

      error:
        "기존 업무일지 로그인에 실패했습니다.",

      legacyStatus:
        response.status,

      legacyResponse:
        responseData
    };
  }


  /*
    서버마다 토큰 필드명이 다를 수 있으므로
    Python 코드와 동일하게 여러 이름을 확인한다.
  */
  const token =
    responseData.jwt_token ||
    responseData.token ||
    responseData.access_token ||
    responseData.accessToken ||
    "";


  if (!token) {
    return {
      success: false,

      status: 502,

      error:
        "로그인은 성공했지만 인증 토큰을 찾지 못했습니다.",

      responseKeys:
        Object.keys(
          responseData
        )
    };
  }


  /*
    보안상 JWT 원문은 브라우저로 보내지 않는다.
  */
  return {
    success: true,

    status: 200,

    message:
      "기존 업무일지 API 로그인에 성공했습니다.",

    tokenReceived:
      true,

    tokenLength:
      String(token).length
  };
}


/* =========================================================
  GET /api/legacy-login
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    const result =
      await requestLegacyLogin(
        context.env
      );

    return createJsonResponse(
      {
        success:
          result.success,

        message:
          result.message ||
          result.error,

        tokenReceived:
          result.tokenReceived ||
          false,

        tokenLength:
          result.tokenLength ||
          0,

        missingVariables:
          result.missingVariables ||
          undefined,

        legacyStatus:
          result.legacyStatus ||
          undefined,

        responseKeys:
          result.responseKeys ||
          undefined
      },

      result.status
    );
  } catch (error) {
    console.error(
      "Legacy login error:",
      error
    );

    return createJsonResponse(
      {
        success: false,

        message:
          "기존 업무일지 서버 연결 중 오류가 발생했습니다.",

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
  지원하지 않는 요청 방식
========================================================= */

export function onRequestPost() {
  return createJsonResponse(
    {
      success: false,

      message:
        "이 테스트 주소는 GET 요청만 지원합니다."
    },

    405
  );
}