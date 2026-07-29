/* =========================================================
  GS Shift Log 브랜드 이미지 조회 API

  경로:
  functions/api/brand-assets.js

  API:
  GET /api/brand-assets?type=logo
  GET /api/brand-assets?type=background

  저장 위치:
  - R2 바인딩: ATTACHMENTS

  R2 키:
  - brand/company-logo
  - brand/login-background

  권한:
  - 로그인 화면에서도 필요하므로 공개 조회
========================================================= */


/* =========================================================
  R2 저장 키
========================================================= */

const BRAND_ASSET_KEYS = {
  logo:
    "brand/company-logo",

  background:
    "brand/login-background"
};


/* =========================================================
  기본 정리
========================================================= */

function normalizeText(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


/* =========================================================
  공통 JSON 응답
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
          "no-store",

        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}


/* =========================================================
  지원 이미지 MIME 형식 확인
========================================================= */

function normalizeImageContentType(
  value
) {
  const contentType =
    normalizeText(
      value
    ).toLowerCase();


  if (
    contentType ===
      "image/png" ||
    contentType ===
      "image/jpeg" ||
    contentType ===
      "image/webp"
  ) {
    return contentType;
  }


  return "application/octet-stream";
}


/* =========================================================
  요청한 이미지 종류 확인
========================================================= */

function getRequestedAssetType(
  request
) {
  const requestUrl =
    new URL(
      request.url
    );


  const requestedType =
    normalizeText(
      requestUrl.searchParams.get(
        "type"
      )
    ).toLowerCase();


  if (
    requestedType ===
      "logo"
  ) {
    return "logo";
  }


  if (
    requestedType ===
      "background"
  ) {
    return "background";
  }


  return "";
}


/* =========================================================
  GET /api/brand-assets?type=...
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    if (
      !context.env.ATTACHMENTS
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "R2 바인딩 ATTACHMENTS가 등록되지 않았습니다."
        },
        500
      );
    }


    const assetType =
      getRequestedAssetType(
        context.request
      );


    if (
      !assetType
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "브랜드 이미지 종류가 올바르지 않습니다."
        },
        400
      );
    }


    const r2Key =
      BRAND_ASSET_KEYS[
        assetType
      ];


    const object =
      await context.env.ATTACHMENTS
        .get(
          r2Key
        );


    if (
      !object
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            assetType ===
              "logo"
              ? "등록된 회사 로고가 없습니다."
              : "등록된 로그인 배경이 없습니다."
        },
        404
      );
    }


    const contentType =
      normalizeImageContentType(
        object.httpMetadata
          ?.contentType
      );


    const headers =
      new Headers();


    headers.set(
      "Content-Type",
      contentType
    );


    headers.set(
      "Content-Disposition",
      "inline"
    );


    /*
      brand-settings.js에서 URL에
      ?v=버전값을 붙이므로 장기 캐시가 가능하다.
    */
    headers.set(
      "Cache-Control",
      "public, max-age=31536000, immutable"
    );


    headers.set(
      "X-Content-Type-Options",
      "nosniff"
    );


    headers.set(
      "Cross-Origin-Resource-Policy",
      "same-origin"
    );


    const objectSize =
      Number(
        object.size ||
        0
      );


    if (
      objectSize >
      0
    ) {
      headers.set(
        "Content-Length",
        String(
          objectSize
        )
      );
    }


    if (
      object.httpEtag
    ) {
      headers.set(
        "ETag",
        object.httpEtag
      );
    }


    if (
      object.uploaded
    ) {
      const uploadedDate =
        new Date(
          object.uploaded
        );


      if (
        !Number.isNaN(
          uploadedDate.getTime()
        )
      ) {
        headers.set(
          "Last-Modified",
          uploadedDate.toUTCString()
        );
      }
    }


    return new Response(
      object.body,
      {
        status:
          200,

        headers
      }
    );

  } catch (
    error
  ) {
    console.error(
      "브랜드 이미지 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "브랜드 이미지를 불러오지 못했습니다."
      },
      500
    );
  }
}


/* =========================================================
  그 외 요청 차단
========================================================= */

export async function onRequest(
  context
) {
  if (
    context.request.method ===
      "GET"
  ) {
    return onRequestGet(
      context
    );
  }


  return jsonResponse(
    {
      ok: false,

      message:
        "허용되지 않은 요청 방식입니다."
    },
    405
  );
}