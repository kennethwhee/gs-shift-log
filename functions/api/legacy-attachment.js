"use strict";

/* =========================================================
  GS Shift Log 과거 업무일지 첨부파일 조회 API

  GET /api/legacy-attachment?id=1

  처리 순서:
  1. D1 legacy_attachments 테이블에서 첨부파일 정보 조회
  2. r2_key를 이용해 R2 ATTACHMENTS 버킷에서 파일 조회
  3. 이미지 또는 파일 원본 반환
========================================================= */


/* =========================================================
  JSON 응답
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
  문자열 정리
========================================================= */

function normalizeText(value) {
  return String(
    value ?? ""
  ).trim();
}


/* =========================================================
  첨부파일 ID 확인
========================================================= */

function normalizeAttachmentId(value) {
  const normalizedValue =
    normalizeText(
      value
    );

  if (
    !/^\d+$/.test(
      normalizedValue
    )
  ) {
    return 0;
  }

  const attachmentId =
    Number(
      normalizedValue
    );

  if (
    !Number.isSafeInteger(
      attachmentId
    ) ||
    attachmentId <= 0
  ) {
    return 0;
  }

  return attachmentId;
}


/* =========================================================
  Content-Type 결정
========================================================= */

function getMimeType(
  fileName,
  storedMimeType
) {
  const normalizedMimeType =
    normalizeText(
      storedMimeType
    );

  if (
    normalizedMimeType
  ) {
    return normalizedMimeType;
  }

  const normalizedFileName =
    normalizeText(
      fileName
    )
      .toLowerCase();

  if (
    normalizedFileName.endsWith(
      ".jpg"
    ) ||
    normalizedFileName.endsWith(
      ".jpeg"
    )
  ) {
    return "image/jpeg";
  }

  if (
    normalizedFileName.endsWith(
      ".png"
    )
  ) {
    return "image/png";
  }

  if (
    normalizedFileName.endsWith(
      ".gif"
    )
  ) {
    return "image/gif";
  }

  if (
    normalizedFileName.endsWith(
      ".webp"
    )
  ) {
    return "image/webp";
  }

  if (
    normalizedFileName.endsWith(
      ".svg"
    )
  ) {
    return "image/svg+xml";
  }

  if (
    normalizedFileName.endsWith(
      ".pdf"
    )
  ) {
    return "application/pdf";
  }

  return "application/octet-stream";
}


/* =========================================================
  파일명 안전하게 정리
========================================================= */

function sanitizeFileName(value) {
  const fileName =
    normalizeText(
      value
    );

  if (
    !fileName
  ) {
    return "attachment";
  }

  return fileName
    .replace(
      /[\r\n"]/g,
      ""
    )
    .replace(
      /[\\/]/g,
      "_"
    );
}


/* =========================================================
  GET /api/legacy-attachment
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    if (
      !context.env.DB
    ) {
      throw new Error(
        "D1 바인딩 DB가 등록되지 않았습니다."
      );
    }

    if (
      !context.env.ATTACHMENTS
    ) {
      throw new Error(
        "R2 바인딩 ATTACHMENTS가 등록되지 않았습니다."
      );
    }


    const requestUrl =
      new URL(
        context.request.url
      );


    const attachmentId =
      normalizeAttachmentId(
        requestUrl.searchParams.get(
          "id"
        )
      );


    if (
      !attachmentId
    ) {
      return createJsonResponse(
        {
          success:
            false,

          message:
            "올바른 첨부파일 id 값을 입력해야 합니다.",

          example:
            "/api/legacy-attachment?id=1"
        },
        400
      );
    }


    /*
      D1에서 첨부파일 정보 조회
    */
    const attachment =
      await context.env.DB
        .prepare(
          `
            SELECT
              id,
              legacy_diary_id,
              file_name,
              original_url,
              r2_key,
              mime_type,
              file_size,
              uploaded_at
            FROM legacy_attachments
            WHERE id = ?1
            LIMIT 1
          `
        )
        .bind(
          attachmentId
        )
        .first();


    if (
      !attachment
    ) {
      return createJsonResponse(
        {
          success:
            false,

          message:
            "첨부파일 정보를 찾을 수 없습니다.",

          id:
            attachmentId
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
      return createJsonResponse(
        {
          success:
            false,

          message:
            "첨부파일의 R2 경로가 등록되지 않았습니다.",

          id:
            attachmentId
        },
        404
      );
    }


    /*
      R2에서 실제 파일 조회
    */
    const object =
      await context.env.ATTACHMENTS.get(
        r2Key
      );


    if (
      !object
    ) {
      return createJsonResponse(
        {
          success:
            false,

          message:
            "R2 버킷에서 첨부파일을 찾을 수 없습니다.",

          id:
            attachmentId,

          r2Key
        },
        404
      );
    }


    const fileName =
      sanitizeFileName(
        attachment.file_name
      );


    /*
      DB에 multipart/form-data가 잘못 저장된 경우
      파일 확장자를 기준으로 MIME 타입을 다시 판단한다.
    */
    const storedMimeType =
      normalizeText(
        attachment.mime_type
      )
        .toLowerCase();


    const isInvalidStoredMimeType =
      !storedMimeType ||
      storedMimeType.includes(
        "multipart/form-data"
      ) ||
      storedMimeType.includes(
        "application/octet-stream"
      ) ||
      storedMimeType.includes(
        "text/plain"
      );


    const contentType =
      getMimeType(
        fileName,
        isInvalidStoredMimeType
          ? ""
          : storedMimeType
      );


    const headers =
      new Headers();


    /*
      R2에 저장된 메타데이터를 먼저 반영한다.
    */
    if (
      object.httpMetadata
    ) {
      object.writeHttpMetadata(
        headers
      );
    }


    /*
      잘못된 R2 메타데이터보다
      파일 확장자 및 DB 값을 기준으로 마지막에 강제 지정한다.
    */
    headers.set(
      "Content-Type",
      contentType
    );


    headers.set(
      "Content-Disposition",
      `inline; filename="${fileName}"`
    );


    headers.set(
      "Cache-Control",
      "public, max-age=3600"
    );


    headers.set(
      "X-Content-Type-Options",
      "nosniff"
    );


    if (
      object.size !==
      undefined &&
      object.size !==
      null
    ) {
      headers.set(
        "Content-Length",
        String(
          object.size
        )
      );
    }


    if (
      object.etag
    ) {
      headers.set(
        "ETag",
        object.etag
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

  } catch (error) {
    console.error(
      "과거 업무일지 첨부파일 조회 오류:",
      error
    );


    return createJsonResponse(
      {
        success:
          false,

        message:
          error instanceof Error
            ? error.message
            : String(error),

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
      success:
        false,

      message:
        "이 주소는 GET 요청만 지원합니다."
    },
    405
  );
}