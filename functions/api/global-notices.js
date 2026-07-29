/* =========================================================
  GS Shift Log 전체공지 API

  경로:
  functions/api/global-notices.js

  API:
  GET    /api/global-notices
  POST   /api/global-notices
  DELETE /api/global-notices?id=...

  저장:
  - 공지 본문/첨부 메타데이터: D1 (DB)
  - 실제 첨부파일: R2 (ATTACHMENTS)

  권한:
  - 조회/등록/수정/삭제: 로그인 사용자 전체
========================================================= */

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 5000;
const MAX_FILE_COUNT = 10;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TOTAL_FILE_SIZE = 100 * 1024 * 1024;

const VALID_PRIORITIES = new Set([
  "normal",
  "important",
  "urgent"
]);

const ALLOWED_EXTENSIONS = new Set([
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
  "zip"
]);

const BLOCKED_EXTENSIONS = new Set([
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


function normalizePriority(
  value
) {
  const priority =
    normalizeText(
      value
    ).toLowerCase();


  return VALID_PRIORITIES.has(
    priority
  )
    ? priority
    : "";
}


function normalizeLineText(
  value
) {
  return String(
    value ??
    ""
  )
    .replace(
      /\r\n/g,
      "\n"
    )
    .replace(
      /\r/g,
      "\n"
    )
    .trim();
}


function isValidIsoDate(
  value
) {
  const date =
    normalizeText(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date
    )
  ) {
    return false;
  }


  const parsedDate =
    new Date(
      `${date}T00:00:00.000Z`
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
      date
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
  첨부파일 유틸
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
    lastDotIndex < 0
  ) {
    return "";
  }


  return normalizedName
    .slice(
      lastDotIndex + 1
    )
    .toLowerCase();
}


function sanitizeFileName(
  fileName
) {
  const normalizedName =
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


  return normalizedName ||
    "attachment";
}


function buildR2Key(
  noticeId,
  fileName,
  now = new Date()
) {
  const year =
    String(
      now.getUTCFullYear()
    );


  const month =
    String(
      now.getUTCMonth() + 1
    ).padStart(
      2,
      "0"
    );


  return [
    "global-notices",
    year,
    month,
    noticeId,
    `${crypto.randomUUID()}_${sanitizeFileName(
      fileName
    )}`
  ].join("/");
}


function validateFiles(
  files,
  existingAttachmentCount = 0
) {
  if (
    existingAttachmentCount +
      files.length >
    MAX_FILE_COUNT
  ) {
    return {
      error:
        `첨부자료는 최대 ${MAX_FILE_COUNT}개까지 등록할 수 있습니다.`
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


    if (
      Number(
        file.size
      ) >
      MAX_FILE_SIZE
    ) {
      return {
        error:
          `${file.name} 파일은 20MB를 초과합니다.`
      };
    }


    totalSize +=
      Number(
        file.size ||
        0
      );
  }


  if (
    totalSize >
    MAX_TOTAL_FILE_SIZE
  ) {
    return {
      error:
        "새로 첨부한 파일의 총 용량은 100MB를 초과할 수 없습니다."
    };
  }


  return {
    totalSize
  };
}


/* =========================================================
  공지 입력값 검증
========================================================= */

function validateNoticeInput(
  formData
) {
  const notice = {
    id:
      normalizeText(
        formData.get(
          "id"
        )
      ),

    priority:
      normalizePriority(
        formData.get(
          "priority"
        )
      ),

    title:
      normalizeText(
        formData.get(
          "title"
        )
      ),

    content:
      normalizeLineText(
        formData.get(
          "content"
        )
      ),

    startDate:
      normalizeText(
        formData.get(
          "startDate"
        ) ??
        formData.get(
          "start_date"
        )
      ),

    endDate:
      normalizeText(
        formData.get(
          "endDate"
        ) ??
        formData.get(
          "end_date"
        )
      )
  };


  if (
    !notice.priority
  ) {
    return {
      error:
        "공지 중요도가 올바르지 않습니다."
    };
  }


  if (
    !notice.title
  ) {
    return {
      error:
        "공지 제목을 입력해 주세요."
    };
  }


  if (
    notice.title.length >
      MAX_TITLE_LENGTH
  ) {
    return {
      error:
        `공지 제목은 최대 ${MAX_TITLE_LENGTH}자까지 입력할 수 있습니다.`
    };
  }


  if (
    !notice.content
  ) {
    return {
      error:
        "공지 내용을 입력해 주세요."
    };
  }


  if (
    notice.content.length >
      MAX_CONTENT_LENGTH
  ) {
    return {
      error:
        `공지 내용은 최대 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있습니다.`
    };
  }


  if (
    !isValidIsoDate(
      notice.startDate
    ) ||
    !isValidIsoDate(
      notice.endDate
    )
  ) {
    return {
      error:
        "공지 시작일과 종료일을 확인해 주세요."
    };
  }


  if (
    notice.endDate <
      notice.startDate
  ) {
    return {
      error:
        "종료일은 시작일보다 빠를 수 없습니다."
    };
  }


  return {
    notice
  };
}


/* =========================================================
  DB 조회
========================================================= */

async function findNoticeRowById(
  database,
  noticeId
) {
  return database
    .prepare(`
      SELECT
        *

      FROM global_notices

      WHERE id = ?

      LIMIT 1
    `)
    .bind(
      noticeId
    )
    .first();
}


async function getAttachmentRows(
  database,
  noticeIds
) {
  if (
    !noticeIds.length
  ) {
    return [];
  }


  const placeholders =
    noticeIds
      .map(
        () => "?"
      )
      .join(", ");


  const result =
    await database
      .prepare(`
        SELECT
          id,
          notice_id,
          r2_key,
          original_name,
          stored_name,
          content_type,
          file_size,
          uploaded_by,
          uploaded_by_name,
          created_at

        FROM global_notice_attachments

        WHERE notice_id IN (
          ${placeholders}
        )

        ORDER BY
          created_at ASC,
          original_name ASC
      `)
      .bind(
        ...noticeIds
      )
      .all();


  return Array.isArray(
    result.results
  )
    ? result.results
    : [];
}


function convertAttachmentRow(
  row
) {
  const id =
    normalizeText(
      row.id
    );


  return {
    id,

    noticeId:
      normalizeText(
        row.notice_id
      ),

    fileName:
      normalizeText(
        row.original_name
      ),

    storedName:
      normalizeText(
        row.stored_name
      ),

    fileSize:
      Number(
        row.file_size ||
        0
      ),

    mimeType:
      normalizeText(
        row.content_type
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    url:
      `/api/global-notice-files?id=${encodeURIComponent(
        id
      )}`
  };
}


function convertNoticeRow(
  row,
  attachments = []
) {
  return {
    id:
      normalizeText(
        row.id
      ),

    title:
      normalizeText(
        row.title
      ),

    content:
      normalizeLineText(
        row.content
      ),

    priority:
      normalizePriority(
        row.priority
      ) ||
      "normal",

    startDate:
      normalizeText(
        row.start_date
      ),

    endDate:
      normalizeText(
        row.end_date
      ),

    createdBy:
      normalizeEmployeeNo(
        row.created_by
      ),

    createdByName:
      normalizeText(
        row.created_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedBy:
      normalizeEmployeeNo(
        row.updated_by
      ),

    updatedByName:
      normalizeText(
        row.updated_by_name
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    revision:
      Number(
        row.revision ||
        1
      ),

    attachments
  };
}


async function findNoticeById(
  database,
  noticeId
) {
  const row =
    await findNoticeRowById(
      database,
      noticeId
    );


  if (
    !row
  ) {
    return null;
  }


  const attachmentRows =
    await getAttachmentRows(
      database,
      [
        noticeId
      ]
    );


  return convertNoticeRow(
    row,
    attachmentRows.map(
      convertAttachmentRow
    )
  );
}


/* =========================================================
  첨부파일 삭제
========================================================= */

async function deleteAttachments(
  context,
  attachmentRows
) {
  for (
    const attachment
    of attachmentRows
  ) {
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


    await context.env.DB
      .prepare(`
        DELETE FROM global_notice_attachments
        WHERE id = ?
      `)
      .bind(
        attachment.id
      )
      .run();
  }
}


/* =========================================================
  첨부파일 업로드
========================================================= */

async function uploadFiles(
  context,
  noticeId,
  files,
  user,
  now
) {
  if (
    !files.length
  ) {
    return;
  }


  if (
    !context.env.ATTACHMENTS
  ) {
    const error =
      new Error(
        "R2 바인딩 ATTACHMENTS가 등록되지 않았습니다."
      );

    error.status =
      500;

    throw error;
  }


  const uploadedObjects =
    [];


  try {
    for (
      const file
      of files
    ) {
      const attachmentId =
        crypto.randomUUID();


      const r2Key =
        buildR2Key(
          noticeId,
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
          .pop();


      await context.env.ATTACHMENTS
        .put(
          r2Key,
          file.stream(),
          {
            httpMetadata: {
              contentType:
                file.type ||
                "application/octet-stream",

              contentDisposition:
                `attachment; filename*=UTF-8''${encodeURIComponent(
                  file.name
                )}`
            },

            customMetadata: {
              noticeId,
              attachmentId,
              uploadedBy:
                user.employeeNo,
              originalName:
                file.name
            }
          }
        );


      uploadedObjects.push(
        r2Key
      );


      await context.env.DB
        .prepare(`
          INSERT INTO global_notice_attachments (
            id,
            notice_id,
            r2_key,
            original_name,
            stored_name,
            content_type,
            file_size,
            uploaded_by,
            uploaded_by_name,
            created_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `)
        .bind(
          attachmentId,
          noticeId,
          r2Key,
          file.name,
          storedName,
          file.type ||
            "application/octet-stream",
          Number(
            file.size ||
            0
          ),
          user.employeeNo,
          user.name,
          now
        )
        .run();
    }

  } catch (
    error
  ) {
    for (
      const r2Key
      of uploadedObjects
    ) {
      try {
        await context.env.ATTACHMENTS
          .delete(
            r2Key
          );

      } catch {
        // 업로드 롤백 실패는 원래 오류를 덮지 않는다.
      }
    }


    throw error;
  }
}


/* =========================================================
  GET /api/global-notices
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


    const result =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM global_notices

          ORDER BY
            CASE priority
              WHEN 'urgent' THEN 1
              WHEN 'important' THEN 2
              ELSE 3
            END,
            updated_at DESC,
            created_at DESC
        `)
        .all();


    const rows =
      Array.isArray(
        result.results
      )
        ? result.results
        : [];


    const noticeIds =
      rows
        .map(
          row =>
            normalizeText(
              row.id
            )
        )
        .filter(
          Boolean
        );


    const attachmentRows =
      await getAttachmentRows(
        context.env.DB,
        noticeIds
      );


    const attachmentMap =
      new Map();


    attachmentRows.forEach(
      row => {
        const noticeId =
          normalizeText(
            row.notice_id
          );


        if (
          !attachmentMap.has(
            noticeId
          )
        ) {
          attachmentMap.set(
            noticeId,
            []
          );
        }


        attachmentMap
          .get(
            noticeId
          )
          .push(
            convertAttachmentRow(
              row
            )
          );
      }
    );


    const notices =
      rows.map(
        row =>
          convertNoticeRow(
            row,
            attachmentMap.get(
              normalizeText(
                row.id
              )
            ) ||
            []
          )
      );


    return jsonResponse({
      ok: true,

      notices,

      totalCount:
        notices.length
    });

  } catch (
    error
  ) {
    console.error(
      "전체공지 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          "전체공지를 불러오는 중 오류가 발생했습니다.",

        error:
          String(
            error
          )
      },
      500
    );
  }
}


/* =========================================================
  POST /api/global-notices

  id 없음:
  - 신규 등록

  id 있음:
  - 기존 공지 수정
========================================================= */

export async function onRequestPost(
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


    const contentType =
      normalizeText(
        context.request.headers.get(
          "Content-Type"
        )
      ).toLowerCase();


    if (
      !contentType.includes(
        "multipart/form-data"
      )
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "전체공지 저장 요청 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const formData =
      await context.request
        .formData();


    const validation =
      validateNoticeInput(
        formData
      );


    if (
      validation.error
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            validation.error
        },
        400
      );
    }


    const notice =
      validation.notice;


    const files =
      formData
        .getAll(
          "files"
        )
        .filter(
          item =>
            item instanceof File &&
            item.size >
              0
        );


    let deletedAttachmentIds = [];


    try {
      const parsedIds =
        JSON.parse(
          normalizeText(
            formData.get(
              "deletedAttachmentIds"
            )
          ) ||
          "[]"
        );


      deletedAttachmentIds =
        Array.isArray(
          parsedIds
        )
          ? [
              ...new Set(
                parsedIds
                  .map(
                    normalizeText
                  )
                  .filter(
                    Boolean
                  )
              )
            ]
          : [];

    } catch {
      return jsonResponse(
        {
          ok: false,

          message:
            "삭제할 첨부자료 정보가 올바르지 않습니다."
        },
        400
      );
    }


    const now =
      new Date()
        .toISOString();


    let noticeId =
      notice.id;


    let created =
      false;


    if (
      noticeId
    ) {
      const existingNotice =
        await findNoticeRowById(
          context.env.DB,
          noticeId
        );


      if (
        !existingNotice
      ) {
        return jsonResponse(
          {
            ok: false,

            message:
              "수정할 전체공지를 찾을 수 없습니다."
          },
          404
        );
      }


      const existingAttachmentsResult =
        await context.env.DB
          .prepare(`
            SELECT
              *

            FROM global_notice_attachments

            WHERE notice_id = ?
          `)
          .bind(
            noticeId
          )
          .all();


      const existingAttachmentRows =
        Array.isArray(
          existingAttachmentsResult.results
        )
          ? existingAttachmentsResult.results
          : [];


      const validDeleteRows =
        existingAttachmentRows.filter(
          row =>
            deletedAttachmentIds.includes(
              normalizeText(
                row.id
              )
            )
        );


      const remainingAttachmentCount =
        existingAttachmentRows.length -
        validDeleteRows.length;


      const fileValidation =
        validateFiles(
          files,
          remainingAttachmentCount
        );


      if (
        fileValidation.error
      ) {
        return jsonResponse(
          {
            ok: false,

            message:
              fileValidation.error
          },
          400
        );
      }


      await context.env.DB
        .prepare(`
          UPDATE global_notices

          SET
            title = ?,
            content = ?,
            priority = ?,
            start_date = ?,
            end_date = ?,
            updated_by = ?,
            updated_by_name = ?,
            updated_at = ?,
            revision =
              revision + 1

          WHERE id = ?
        `)
        .bind(
          notice.title,
          notice.content,
          notice.priority,
          notice.startDate,
          notice.endDate,
          user.employeeNo,
          user.name,
          now,
          noticeId
        )
        .run();


      await deleteAttachments(
        context,
        validDeleteRows
      );


      await uploadFiles(
        context,
        noticeId,
        files,
        user,
        now
      );

    } else {
      const fileValidation =
        validateFiles(
          files,
          0
        );


      if (
        fileValidation.error
      ) {
        return jsonResponse(
          {
            ok: false,

            message:
              fileValidation.error
          },
          400
        );
      }


      noticeId =
        crypto.randomUUID();


      created =
        true;


      await context.env.DB
        .prepare(`
          INSERT INTO global_notices (
            id,
            title,
            content,
            priority,
            start_date,
            end_date,
            created_by,
            created_by_name,
            created_at,
            updated_by,
            updated_by_name,
            updated_at,
            revision
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
          )
        `)
        .bind(
          noticeId,
          notice.title,
          notice.content,
          notice.priority,
          notice.startDate,
          notice.endDate,
          user.employeeNo,
          user.name,
          now,
          user.employeeNo,
          user.name,
          now
        )
        .run();


      try {
        await uploadFiles(
          context,
          noticeId,
          files,
          user,
          now
        );

      } catch (
        error
      ) {
        await context.env.DB
          .prepare(`
            DELETE FROM global_notices
            WHERE id = ?
          `)
          .bind(
            noticeId
          )
          .run();


        throw error;
      }
    }


    const savedNotice =
      await findNoticeById(
        context.env.DB,
        noticeId
      );


    return jsonResponse(
      {
        ok: true,

        created,

        notice:
          savedNotice
      },
      created
        ? 201
        : 200
    );

  } catch (
    error
  ) {
    console.error(
      "전체공지 저장 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "전체공지 저장 중 오류가 발생했습니다."
      },
      Number(
        error?.status
      ) ||
      500
    );
  }
}


/* =========================================================
  DELETE /api/global-notices?id=...
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


    const requestUrl =
      new URL(
        context.request.url
      );


    const noticeId =
      normalizeText(
        requestUrl.searchParams.get(
          "id"
        )
      );


    if (
      !noticeId
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "삭제할 전체공지 ID가 필요합니다."
        },
        400
      );
    }


    const existingNotice =
      await findNoticeRowById(
        context.env.DB,
        noticeId
      );


    if (
      !existingNotice
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "삭제할 전체공지를 찾을 수 없습니다."
        },
        404
      );
    }


    const attachmentResult =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM global_notice_attachments

          WHERE notice_id = ?
        `)
        .bind(
          noticeId
        )
        .all();


    const attachmentRows =
      Array.isArray(
        attachmentResult.results
      )
        ? attachmentResult.results
        : [];


    await deleteAttachments(
      context,
      attachmentRows
    );


    const deleteResult =
      await context.env.DB
        .prepare(`
          DELETE FROM global_notices
          WHERE id = ?
        `)
        .bind(
          noticeId
        )
        .run();


    if (
      Number(
        deleteResult?.meta?.changes ||
        0
      ) !==
        1
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "전체공지를 삭제하지 못했습니다."
        },
        409
      );
    }


    return jsonResponse({
      ok: true,

      deletedId:
        noticeId
    });

  } catch (
    error
  ) {
    console.error(
      "전체공지 삭제 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "전체공지 삭제 중 오류가 발생했습니다."
      },
      Number(
        error?.status
      ) ||
      500
    );
  }
}
