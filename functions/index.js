/* =========================================================
  GS Shift Log 루트 모바일 진입 V23

  경로:
  - GET /  (functions/index.js)

  동작:
  - 모바일 요청: 서버에서 /mobile/ 로그인 화면으로 즉시 이동
  - PC 요청: 기존 정적 index.html을 그대로 제공
  - /api/*, /mobile/* 및 다른 정적 파일에는 이 함수가 매칭되지 않음
========================================================= */


const MOBILE_BUILD =
  "20260826-mobile-entry-v23";


const MOBILE_USER_AGENT_PATTERN =
  /iPhone|iPad|iPod|Android|Windows Phone|IEMobile|BlackBerry|BB10|webOS|Opera Mini|Opera Mobi/i;


function appendVaryHeader(
  headers
) {
  const values =
    new Map();

  String(
    headers.get(
      "Vary"
    ) ||
    ""
  )
    .split(
      ","
    )
    .map(
      value =>
        value.trim()
    )
    .filter(Boolean)
    .forEach(
      value => {
        values.set(
          value.toLowerCase(),
          value
        );
      }
    );

  [
    "User-Agent",
    "Sec-CH-UA-Mobile"
  ].forEach(
    value => {
      values.set(
        value.toLowerCase(),
        value
      );
    }
  );

  headers.set(
    "Vary",
    [
      ...values.values()
    ].join(
      ", "
    )
  );
}


export function isMobileEntryRequest(
  request
) {
  const clientHintMobile =
    String(
      request.headers.get(
        "Sec-CH-UA-Mobile"
      ) ||
      ""
    ).trim() === "?1";

  const userAgent =
    String(
      request.headers.get(
        "User-Agent"
      ) ||
      ""
    );

  const isIpadDesktopUserAgent =
    /Macintosh/i.test(
      userAgent
    ) &&
    /Mobile\/[A-Za-z0-9._-]+/i.test(
      userAgent
    );

  return (
    clientHintMobile ||
    MOBILE_USER_AGENT_PATTERN.test(
      userAgent
    ) ||
    isIpadDesktopUserAgent
  );
}


export function createMobileDestination(
  request
) {
  const requestUrl =
    new URL(
      request.url
    );

  const destination =
    new URL(
      "/mobile/",
      requestUrl.origin
    );

  const requestedBuild =
    requestUrl.searchParams.get(
      "build"
    );

  const build =
    requestedBuild &&
    /^[A-Za-z0-9._-]{1,80}$/.test(
      requestedBuild
    )
      ? requestedBuild
      : MOBILE_BUILD;

  destination.searchParams.set(
    "build",
    build
  );

  return destination;
}


export async function onRequest(
  context
) {
  const request =
    context.request;

  const requestUrl =
    new URL(
      request.url
    );

  const method =
    String(
      request.method ||
      "GET"
    ).toUpperCase();

  const isSafeEntryRequest =
    (
      method === "GET" ||
      method === "HEAD"
    ) &&
    requestUrl.pathname === "/";

  if (
    !isSafeEntryRequest
  ) {
    return context.next();
  }

  if (
    !isMobileEntryRequest(
      request
    )
  ) {
    const assetResponse =
      await context.next();

    const assetHeaders =
      new Headers(
        assetResponse.headers
      );

    appendVaryHeader(
      assetHeaders
    );

    assetHeaders.set(
      "X-GS-Entry-Mode",
      "desktop"
    );

    return new Response(
      method === "HEAD"
        ? null
        : assetResponse.body,
      {
        status:
          assetResponse.status,

        statusText:
          assetResponse.statusText,

        headers:
          assetHeaders
      }
    );
  }

  const headers =
    new Headers({
      "Location":
        createMobileDestination(
          request
        ).toString(),

      "Cache-Control":
        "private, no-store, no-cache, max-age=0, must-revalidate",

      "Pragma":
        "no-cache",

      "Expires":
        "0",

      "X-GS-Entry-Mode":
        "mobile-redirect-v23"
    });

  appendVaryHeader(
    headers
  );

  return new Response(
    null,
    {
      status: 302,

      headers
    }
  );
}
