/* =========================================================
  GS Shift Log 신규 업무일지 첨부파일 API

  경로:
  functions/api/shift-log-files.js

  API:
  GET
    /api/shift-log-files?logId=업무일지ID
    → 해당 업무일지 첨부목록

  GET
    /api/shift-log-files?id=첨부파일ID
    → 실제 파일 조회

  POST
    /api/shift-log-files
    → 실제 파일 업로드

  DELETE
    /api/shift-log-files?id=첨부파일ID
    → 첨부파일 삭제

  저장:
  - 메타데이터: D1 shift_log_attachments
  - 실제 파일: R2 ATTACHMENTS
========================================================= */


const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const MAX_FILE_COUNT =
  10;


const MAX_FILE_SIZE =
  20 *
  1024 *
  1024;


const MAX_TOTAL_FILE_SIZE =
  100 *
  1024 *
  1024;


const ALLOWED_EXTENSIONS =
  new Set([
    "pdf",

    "hwp",
    "hwpx",

    "doc",
    "docx",

    "xls",
    "xlsx",

    "ppt",
    "pptx",

    "txt",
    "csv",

    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "bmp",
    "heic",
    "heif",

    "zip"
  ]);


const BLOCKED_EXTENSIONS =
  new Set([
    "exe",
    "msi",
    "bat",
    "cmd",
    "com",
    "scr",
    "ps1",
    "vbs",
    "js",
    "jar",
    "apk",
    "dll",
    "sh"
  ]);


/* =========================================================
  JSON 응답
========================================================= */

function jsonResponse(
  data,
  status =
    200
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
  기본 문자열 정리
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
  계정 권한 정리
========================================================= */

function normalizeAccountRole(
  value
) {
  const role =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );


  if (
    [
      "super_admin",
      "superadmin"
    ].includes(
      role
    )
  ) {
    return "super_admin";
  }


  if (
    [
      "admin",
      "leader"
    ].includes(
      role
    )
  ) {
    return "admin";
  }


  return "user";
}


/* =========================================================
  로그인 세션
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
    .join(
      ""
    );
}


async function hashSessionToken(
  token
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",

      new TextEncoder()
        .encode(
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
            ok:
              false,

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
            ok:
              false,

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
            ok:
              false,

            message:
              "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
          },
          401
        )
    };
  }


  const employeeNo =
    normalizeEmployeeNo(
      session.employee_no
    );


  const role =
    employeeNo ===
      FORCED_SUPER_ADMIN_EMPLOYEE_NO
        ? "super_admin"
        : normalizeAccountRole(
            session.role
          );


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
      employeeNo,

      name:
        normalizeText(
          session.name
        ),

      role,

      isAdmin:
        role ===
          "admin" ||
        role ===
          "super_admin",

      isSuperAdmin:
        role ===
          "super_admin"
    }
  };
}


/* =========================================================
  확장자
========================================================= */

function getFileExtension(
  fileName
) {
  const normalizedName =
    normalizeText(
      fileName
    );


  const lastDotIndex =
    normalizedName.lastIndexOf(
      "."
    );


  if (
    lastDotIndex <
      0
  ) {
    return "";
  }


  return normalizedName
    .slice(
      lastDotIndex +
      1
    )
    .toLowerCase();
}


/* =========================================================
  파일명 안전 처리
========================================================= */

function sanitizeFileName(
  fileName
) {
  const normalized =
    normalizeText(
      fileName
    )
      .replace(
        /[\/\\:*?"<>|]/g,
        "_"
      )
      .replace(
        /\s+/g,
        "_"
      );


  return (
    normalized ||
    "attachment"
  );
}


/* =========================================================
  MIME 타입 보완
========================================================= */

function resolveContentType(
  fileName,
  suppliedType
) {
  const supplied =
    normalizeText(
      suppliedType
    )
      .toLowerCase();


  if (
    supplied &&
    supplied !==
      "application/octet-stream"
  ) {
    return supplied;
  }


  const extension =
    getFileExtension(
      fileName
    );


  const mimeMap = {
    jpg:
      "image/jpeg",

    jpeg:
      "image/jpeg",

    png:
      "image/png",

    webp:
      "image/webp",

    gif:
      "image/gif",

    bmp:
      "image/bmp",

    heic:
      "image/heic",

    heif:
      "image/heif",

    pdf:
      "application/pdf",

    txt:
      "text/plain",

    csv:
      "text/csv",

    zip:
      "application/zip"
  };


  return (
    mimeMap[
      extension
    ] ||
    "application/octet-stream"
  );
}


/* =========================================================
  R2 저장 KEY
========================================================= */

function buildR2Key(
  logId,
  fileName,
  now =
    new Date()
) {
  const year =
    String(
      now.getUTCFullYear()
    );


  const month =
    String(
      now.getUTCMonth() +
      1
    )
      .padStart(
        2,
        "0"
      );


  return [
    "shift-logs",

    year,

    month,

    logId,

    [
      crypto.randomUUID(),

      sanitizeFileName(
        fileName
      )
    ].join(
      "_"
    )
  ].join(
    "/"
  );
}


/* =========================================================
  업무일지 조회
========================================================= */

async function findShiftLogRow(
  database,
  logId
) {
  return database
    .prepare(`
      SELECT
        id,
        work_date,
        shift,
        role,
        author,
        author_id,
        author_role,
        status,
        revision

      FROM shift_logs

      WHERE id = ?

      LIMIT 1
    `)
    .bind(
      logId
    )
    .first();
}


/* =========================================================
  첨부 수정 가능 여부

  최고관리자:
  - 항상 가능

  일반 작성자:
  - 본인 임시저장
  - 본인 결재요청

  결재완료:
  - 먼저 결재취소 후 수정
========================================================= */

function canModifyShiftLogAttachments(
  logRow,
  user
) {
  if (
    !logRow ||
    !user
  ) {
    return false;
  }


  if (
    user.isSuperAdmin
  ) {
    return true;
  }


  const isAuthor =
    normalizeEmployeeNo(
      logRow.author_id
    ) ===
      normalizeEmployeeNo(
        user.employeeNo
      );


  if (
    !isAuthor
  ) {
    return false;
  }


  const status =
    normalizeText(
      logRow.status
    );


  return [
    "임시저장",
    "결재요청",
    "작성중",
    "작성완료"
  ].includes(
    status
  );
}


/* =========================================================
  파일 검증
========================================================= */

function validateFiles(
  files,
  existingAttachmentCount =
    0
) {
  if (
    existingAttachmentCount +
    files.length >
    MAX_FILE_COUNT
  ) {
    return {
      error:
        `첨부파일은 최대 ${MAX_FILE_COUNT}개까지 등록할 수 있습니다.`
    };
  }


  let totalSize =
    0;


  for (
    const file
    of files
  ) {
    const extension =
      getFileExtension(
        file.name
      );


    if (
      !extension ||

      BLOCKED_EXTENSIONS.has(
        extension
      ) ||

      !ALLOWED_EXTENSIONS.has(
        extension
      )
    ) {
      return {
        error:
          `${file.name} 파일 형식은 첨부할 수 없습니다.`
      };
    }


    const fileSize =
      Number(
        file.size ||
        0
      );


    if (
      fileSize >
        MAX_FILE_SIZE
    ) {
      return {
        error:
          `${file.name} 파일은 20MB를 초과합니다.`
      };
    }


    totalSize +=
      fileSize;
  }


  if (
    totalSize >
      MAX_TOTAL_FILE_SIZE
  ) {
    return {
      error:
        "새로 첨부하는 파일의 총 용량은 100MB를 초과할 수 없습니다."
    };
  }


  return {
    totalSize
  };
}


/* =========================================================
  첨부파일 DB 조회
========================================================= */

async function findAttachmentRow(
  database,
  attachmentId
) {
  return database
    .prepare(`
      SELECT
        attachment.*,

        log.role AS log_role,
        log.author_id AS log_author_id,
        log.status AS log_status

      FROM shift_log_attachments
        AS attachment

      INNER JOIN shift_logs
        AS log

        ON log.id =
           attachment.log_id

      WHERE attachment.id = ?

      LIMIT 1
    `)
    .bind(
      attachmentId
    )
    .first();
}


/* =========================================================
  첨부목록 조회
========================================================= */

async function getAttachmentRowsByLogId(
  database,
  logId
) {
  const result =
    await database
      .prepare(`
        SELECT
          *

        FROM shift_log_attachments

        WHERE log_id = ?

        ORDER BY
          created_at ASC,
          original_name ASC
      `)
      .bind(
        logId
      )
      .all();


  return Array.isArray(
    result.results
  )
    ? result.results
    : [];
}


/* =========================================================
  브라우저용 첨부정보 변환
========================================================= */

function convertAttachmentRow(
  row
) {
  const id =
    normalizeText(
      row.id
    );


  return {
    id,

    attachmentId:
      id,

    logId:
      normalizeText(
        row.log_id
      ),

    name:
      normalizeText(
        row.original_name
      ),

    fileName:
      normalizeText(
        row.original_name
      ),

    storedName:
      normalizeText(
        row.stored_name
      ),

    mimeType:
      normalizeText(
        row.content_type
      ),

    fileSize:
      Number(
        row.file_size ||
        0
      ),

    uploadedById:
      normalizeEmployeeNo(
        row.uploaded_by_id
      ),

    uploadedByName:
      normalizeText(
        row.uploaded_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    url:
      `/api/shift-log-files?id=${encodeURIComponent(
        id
      )}`,

    previewUrl:
      `/api/shift-log-files?id=${encodeURIComponent(
        id
      )}`,

    downloadUrl:
      `/api/shift-log-files?id=${encodeURIComponent(
        id
      )}&download=1`
  };
}


/* =========================================================
  Content-Disposition
========================================================= */

function buildContentDisposition(
  fileName,
  disposition =
    "inline"
) {
  const normalizedFileName =
    normalizeText(
      fileName
    ) ||
    "attachment";


  const asciiFileName =
    normalizedFileName
      .replace(
        /[^\x20-\x7E]/g,
        "_"
      )
      .replace(
        /["\\]/g,
        "_"
      );


  return [
    `${disposition}; filename="${asciiFileName}"`,

    `filename*=UTF-8''${encodeURIComponent(
      normalizedFileName
    )}`
  ].join(
    "; "
  );
}


/* =========================================================
  GET

  id:
  실제 파일

  logId:
  첨부목록
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


    const logId =
      normalizeText(
        requestUrl.searchParams.get(
          "logId"
        )
      );


    /* =====================================================
      실제 파일 조회
    ====================================================== */

    if (
      attachmentId
    ) {
      if (
        !context.env.ATTACHMENTS
      ) {
        return jsonResponse(
          {
            ok:
              false,

            message:
              "R2 바인딩 ATTACHMENTS가 등록되지 않았습니다."
          },
          500
        );
      }


      const attachment =
        await findAttachmentRow(
          context.env.DB,
          attachmentId
        );


      if (
        !attachment
      ) {
        return jsonResponse(
          {
            ok:
              false,

            message:
              "첨부파일을 찾을 수 없습니다."
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
            ok:
              false,

            message:
              "첨부파일 저장 위치를 확인할 수 없습니다."
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
            ok:
              false,

            message:
              "R2에서 실제 첨부파일을 찾을 수 없습니다."
          },
          404
        );
      }


      const fileName =
        normalizeText(
          attachment.original_name
        ) ||
        "attachment";


      const contentType =
        resolveContentType(
          fileName,

          attachment.content_type ||
          object.httpMetadata
            ?.contentType
        );


      const forceDownload =
        requestUrl.searchParams.get(
          "download"
        ) ===
          "1";


      const previewable =
        contentType.startsWith(
          "image/"
        ) ||
        contentType ===
          "application/pdf";


      const disposition =
        forceDownload ||
        !previewable
          ? "attachment"
          : "inline";


      const headers =
        new Headers();


      headers.set(
        "Content-Type",
        contentType
      );


      headers.set(
        "Content-Disposition",
        buildContentDisposition(
          fileName,
          disposition
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
    }


    /* =====================================================
      업무일지 첨부목록 조회
    ====================================================== */

    if (
      logId
    ) {
      const logRow =
        await findShiftLogRow(
          context.env.DB,
          logId
        );


      if (
        !logRow
      ) {
        return jsonResponse(
          {
            ok:
              false,

            message:
              "업무일지를 찾을 수 없습니다."
          },
          404
        );
      }


      const rows =
        await getAttachmentRowsByLogId(
          context.env.DB,
          logId
        );


      const attachments =
        rows.map(
          convertAttachmentRow
        );


      return jsonResponse({
        ok:
          true,

        logId,

        attachments,

        totalCount:
          attachments.length
      });
    }


    return jsonResponse(
      {
        ok:
          false,

        message:
          "첨부파일 ID 또는 업무일지 ID가 필요합니다."
      },
      400
    );

  } catch (
    error
  ) {
    console.error(
      "업무일지 첨부파일 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "첨부파일 조회 중 오류가 발생했습니다."
      },
      500
    );
  }
}


/* =========================================================
  POST
  신규 파일 업로드

  FormData:
  logId
  files
========================================================= */

export async function onRequestPost(
  context
) {
  const uploadedR2Keys =
    [];


  const insertedAttachmentIds =
    [];


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
          ok:
            false,

          message:
            "R2 바인딩 ATTACHMENTS가 등록되지 않았습니다."
        },
        500
      );
    }


    const user =
      authentication.user;


    const contentType =
      normalizeText(
        context.request.headers.get(
          "Content-Type"
        )
      )
        .toLowerCase();


    if (
      !contentType.includes(
        "multipart/form-data"
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "첨부파일 업로드 요청 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const formData =
      await context.request
        .formData();


    const logId =
      normalizeText(
        formData.get(
          "logId"
        )
      );


    if (
      !logId
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "업무일지 ID가 필요합니다."
        },
        400
      );
    }


    const logRow =
      await findShiftLogRow(
        context.env.DB,
        logId
      );


    if (
      !logRow
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "첨부파일을 저장할 업무일지를 찾을 수 없습니다."
        },
        404
      );
    }


    if (
      !canModifyShiftLogAttachments(
        logRow,
        user
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "현재 상태의 업무일지에는 첨부파일을 추가할 수 없습니다."
        },
        403
      );
    }


    const files =
      formData
        .getAll(
          "files"
        )
        .filter(
          item => {
            return (
              item instanceof
                File &&

              Number(
                item.size ||
                0
              ) >
                0
            );
          }
        );


    if (
      files.length ===
        0
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "업로드할 첨부파일을 선택해 주세요."
        },
        400
      );
    }


    const existingRows =
      await getAttachmentRowsByLogId(
        context.env.DB,
        logId
      );


    const validation =
      validateFiles(
        files,
        existingRows.length
      );


    if (
      validation.error
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            validation.error
        },
        400
      );
    }


    const now =
      new Date()
        .toISOString();


    for (
      const file
      of files
    ) {
      const attachmentId =
        crypto.randomUUID();


      const r2Key =
        buildR2Key(
          logId,
          file.name,
          new Date(
            now
          )
        );


      const storedName =
        r2Key
          .split(
            "/"
          )
          .pop() ||
        attachmentId;


      const resolvedContentType =
        resolveContentType(
          file.name,
          file.type
        );


      await context.env.ATTACHMENTS
        .put(
          r2Key,
          file.stream(),
          {
            httpMetadata: {
              contentType:
                resolvedContentType
            },

            customMetadata: {
              logId,

              attachmentId,

              uploadedBy:
                user.employeeNo
            }
          }
        );


      uploadedR2Keys.push(
        r2Key
      );


      await context.env.DB
        .prepare(`
          INSERT INTO shift_log_attachments (
            id,
            log_id,

            r2_key,

            original_name,
            stored_name,

            content_type,
            file_size,

            uploaded_by_id,
            uploaded_by_name,

            created_at,
            updated_at
          )

          VALUES (
            ?, ?,
            ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?
          )
        `)
        .bind(
          attachmentId,

          logId,

          r2Key,

          file.name,

          storedName,

          resolvedContentType,

          Number(
            file.size ||
            0
          ),

          user.employeeNo,

          user.name,

          now,

          now
        )
        .run();


      insertedAttachmentIds.push(
        attachmentId
      );
    }


    const savedRows =
      await getAttachmentRowsByLogId(
        context.env.DB,
        logId
      );


    const attachments =
      savedRows.map(
        convertAttachmentRow
      );


    return jsonResponse(
      {
        ok:
          true,

        logId,

        attachments,

        uploadedCount:
          files.length,

        totalCount:
          attachments.length
      },
      201
    );

  } catch (
    error
  ) {
    /*
      업로드 중간 실패 시
      만들어진 R2 객체와 DB 행을 정리한다.
    */

    for (
      const attachmentId
      of insertedAttachmentIds
    ) {
      try {
        await context.env.DB
          ?.prepare(`
            DELETE FROM shift_log_attachments

            WHERE id = ?
          `)
          .bind(
            attachmentId
          )
          .run();

      } catch {
        // 원래 오류를 유지한다.
      }
    }


    for (
      const r2Key
      of uploadedR2Keys
    ) {
      try {
        await context.env.ATTACHMENTS
          ?.delete(
            r2Key
          );

      } catch {
        // 원래 오류를 유지한다.
      }
    }


    console.error(
      "업무일지 첨부파일 업로드 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "첨부파일 업로드 중 오류가 발생했습니다."
      },
      Number(
        error?.status
      ) ||
      500
    );
  }
}


/* =========================================================
  DELETE
  첨부파일 삭제
========================================================= */

export async function onRequestDelete(
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


    const user =
      authentication.user;


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
          ok:
            false,

          message:
            "삭제할 첨부파일 ID가 필요합니다."
        },
        400
      );
    }


    const attachment =
      await findAttachmentRow(
        context.env.DB,
        attachmentId
      );


    if (
      !attachment
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "삭제할 첨부파일을 찾을 수 없습니다."
        },
        404
      );
    }


    const logRow = {
      id:
        attachment.log_id,

      role:
        attachment.log_role,

      author_id:
        attachment.log_author_id,

      status:
        attachment.log_status
    };


    if (
      !canModifyShiftLogAttachments(
        logRow,
        user
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "현재 상태의 업무일지에서는 첨부파일을 삭제할 수 없습니다."
        },
        403
      );
    }


    const r2Key =
      normalizeText(
        attachment.r2_key
      );


    if (
      r2Key &&
      context.env.ATTACHMENTS
    ) {
      await context.env.ATTACHMENTS
        .delete(
          r2Key
        );
    }


    const deleteResult =
      await context.env.DB
        .prepare(`
          DELETE FROM shift_log_attachments

          WHERE id = ?
        `)
        .bind(
          attachmentId
        )
        .run();


    if (
      Number(
        deleteResult
          ?.meta
          ?.changes ||
        0
      ) !==
        1
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "첨부파일 정보를 삭제하지 못했습니다."
        },
        409
      );
    }


    return jsonResponse({
      ok:
        true,

      deletedId:
        attachmentId
    });

  } catch (
    error
  ) {
    console.error(
      "업무일지 첨부파일 삭제 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "첨부파일 삭제 중 오류가 발생했습니다."
      },
      500
    );
  }
}