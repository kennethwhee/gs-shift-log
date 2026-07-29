/* =========================================================
  GS Shift Log 전체공지 첨부자료 다운로드 API

  경로:
  functions/api/global-notice-files.js

  API:
  GET /api/global-notice-files?id=첨부파일ID

  저장:
  - 첨부 메타데이터: D1 (DB)
  - 실제 파일: R2 (ATTACHMENTS)

  권한:
  - 로그인 사용자 전체 다운로드 가능
========================================================= */


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
          "no-store"
      }
    }
  );
}


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


function normalizeEmployeeNo(
  value
) {
  return normalizeText(
    value
  ).replace(
    /\s+/g,
    ""
  );
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


  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );


  return normalizeText(
    match?.[1]
  );
}


function bytesToHex(
  bytes
) {
  return [
    ...bytes
  ]
    .map(
      byte => {
        return byte
          .toString(
            16
          )
          .padStart(
            2,
            "0"
          );
      }
    )
    .join("");
}


async function hashSessionToken(
  token
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
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
            ok: false,

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
            ok: false,

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
          user.role,
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
            ok: false,

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
        normalizeEmployeeNo(
          session.employee_no
        ),

      name:
        normalizeText(
          session.name
        ),

      role:
        normalizeText(
          session.role
        )
    }
  };
}


/* =========================================================
  다운로드 파일명 처리
========================================================= */

function sanitizeAsciiFileName(
  fileName
) {
  return normalizeText(
    fileName
  )
    .replace(
      /[^\x20-\x7E]/g,
      "_"
    )
    .replace(
      /["\\]/g,
      "_"
    )
    .replace(
      /\s+/g,
      "_"
    ) ||
    "attachment";
}


function buildContentDisposition(
  fileName
) {
  const normalizedFileName =
    normalizeText(
      fileName
    ) ||
    "attachment";


  const asciiFileName =
    sanitizeAsciiFileName(
      normalizedFileName
    );


  return [
    `attachment; filename="${asciiFileName}"`,
    `filename*=UTF-8''${encodeURIComponent(
      normalizedFileName
    )}`
  ].join("; ");
}


/* =========================================================
  GET /api/global-notice-files?id=...
========================================================= */

export async function onRequestGet(
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


    const requestUrl =
      new URL(
        context.request.url
      );


    const attachmentId =
      normalizeText(
        requestUrl.searchParams.get(
          "id"
        )
      );


    if (
      !attachmentId
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "첨부자료 ID가 필요합니다."
        },
        400
      );
    }


    const attachment =
      await context.env.DB
        .prepare(`
          SELECT
            attachment.id,
            attachment.notice_id,
            attachment.r2_key,
            attachment.original_name,
            attachment.stored_name,
            attachment.content_type,
            attachment.file_size,
            attachment.created_at,

            notice.title AS notice_title,
            notice.start_date,
            notice.end_date

          FROM global_notice_attachments AS attachment

          INNER JOIN global_notices AS notice
            ON notice.id =
               attachment.notice_id

          WHERE attachment.id = ?

          LIMIT 1
        `)
        .bind(
          attachmentId
        )
        .first();


    if (
      !attachment
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "첨부자료를 찾을 수 없습니다."
        },
        404
      );
    }


    const r2Key =
      normalizeText(
        attachment.r2_key
      );


    if (
      !r2Key
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "첨부자료 저장 경로가 올바르지 않습니다."
        },
        500
      );
    }


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
            "R2에서 첨부자료를 찾을 수 없습니다."
        },
        404
      );
    }


    const fileName =
      normalizeText(
        attachment.original_name
      ) ||
      normalizeText(
        attachment.stored_name
      ) ||
      "attachment";


    const contentType =
      normalizeText(
        attachment.content_type
      ) ||
      normalizeText(
        object.httpMetadata
          ?.contentType
      ) ||
      "application/octet-stream";


    const headers =
      new Headers();


    headers.set(
      "Content-Type",
      contentType
    );


    headers.set(
      "Content-Disposition",
      buildContentDisposition(
        fileName
      )
    );


    headers.set(
      "Cache-Control",
      "private, no-store, max-age=0"
    );


    headers.set(
      "X-Content-Type-Options",
      "nosniff"
    );


    const fileSize =
      Number(
        attachment.file_size ||
        object.size ||
        0
      );


    if (
      fileSize >
      0
    ) {
      headers.set(
        "Content-Length",
        String(
          fileSize
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
      "전체공지 첨부자료 다운로드 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "첨부자료 다운로드 중 오류가 발생했습니다."
      },
      500
    );
  }
}


/* =========================================================
  그 외 메서드 차단
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
