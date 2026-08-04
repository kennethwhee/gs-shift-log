/* =========================================================
  GS Shift Log 공지사항 댓글 API

  GET    /api/notice-comments
  POST   /api/notice-comments
  PUT    /api/notice-comments
  DELETE /api/notice-comments?id=...&revision=...

  권한
  - 조회/작성: 로그인 사용자 전체
  - 수정: 작성자 본인
  - 삭제: 작성자 본인 또는 최고관리자
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO = "2014081";

const VALID_NOTICE_TYPES = new Set([
  "global",
  "role"
]);

const VALID_POSITIONS = new Set([
  "파트장",
  "TGO",
  "BCO1",
  "BCO2",
  "TO",
  "BO1",
  "BO2"
]);

const MAX_COMMENT_LENGTH = 1000;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_CLIENT_REQUEST_ID_LENGTH = 160;

const COMMENT_COLUMNS = `
  id,
  notice_type,
  notice_id,
  content,
  created_by,
  created_by_name,
  created_by_position,
  created_at,
  updated_by,
  updated_by_name,
  updated_at,
  revision,
  client_request_id
`;


/* =========================================================
  공통 유틸
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


function normalizeText(
  value
) {
  return String(
    value ??
    ""
  ).trim();
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
    role ===
      "super_admin" ||
    role ===
      "superadmin"
  ) {
    return "super_admin";
  }


  if (
    role ===
      "admin" ||
    role ===
      "leader"
  ) {
    return "admin";
  }


  return "user";
}


function normalizePosition(
  value
) {
  const rawPosition =
    normalizeText(
      value
    ).replace(
      /\s+/g,
      ""
    );


  const position =
    rawPosition ===
      "파트장"
      ? rawPosition
      : rawPosition
          .toUpperCase();


  return VALID_POSITIONS.has(
    position
  )
    ? position
    : "";
}


function normalizeNoticeType(
  value
) {
  const noticeType =
    normalizeText(
      value
    ).toLowerCase();


  return VALID_NOTICE_TYPES.has(
    noticeType
  )
    ? noticeType
    : "";
}


function normalizeIdentifier(
  value,
  maxLength =
    MAX_IDENTIFIER_LENGTH
) {
  const identifier =
    normalizeText(
      value
    );


  if (
    !identifier ||
    identifier.length >
      maxLength ||
    /[\u0000-\u001F\u007F]/.test(
      identifier
    )
  ) {
    return "";
  }


  return identifier;
}


function parseExpectedRevision(
  value
) {
  const revision =
    Number(
      value
    );


  return (
    Number.isInteger(
      revision
    ) &&
    revision >=
      1
  )
    ? revision
    : 0;
}


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
      byte =>
        byte
          .toString(
            16
          )
          .padStart(
            2,
            "0"
          )
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


async function readJsonObject(
  request
) {
  try {
    const body =
      await request.json();


    if (
      !body ||
      typeof body !==
        "object" ||
      Array.isArray(
        body
      )
    ) {
      throw new Error(
        "INVALID_JSON_OBJECT"
      );
    }


    return {
      body
    };

  } catch {
    return {
      error:
        jsonResponse(
          {
            ok: false,

            message:
              "댓글 요청 형식이 올바르지 않습니다."
          },
          400
        )
    };
  }
}


/* =========================================================
  로그인 사용자 확인
========================================================= */

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
          user.is_active,

          employee.position

        FROM shift_log_sessions AS session

        INNER JOIN users AS user
          ON user.employee_no =
             session.employee_no

        LEFT JOIN employees AS employee
          ON employee.employee_no =
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
        ) ||
        employeeNo,

      role,

      position:
        normalizePosition(
          session.position
        ),

      isSuperAdmin:
        role ===
          "super_admin"
    }
  };
}


/* =========================================================
  댓글 데이터 처리
========================================================= */

function convertRowToComment(
  row,
  user = null
) {
  const createdBy =
    normalizeEmployeeNo(
      row.created_by
    );


  const isMine =
    Boolean(
      user
    ) &&
    createdBy ===
      normalizeEmployeeNo(
        user.employeeNo
      );


  const revision =
    Number(
      row.revision
    ) ||
    1;


  return {
    id:
      normalizeText(
        row.id
      ),

    noticeType:
      normalizeNoticeType(
        row.notice_type
      ),

    noticeId:
      normalizeText(
        row.notice_id
      ),

    content:
      normalizeLineText(
        row.content
      ),

    createdBy,

    createdByName:
      normalizeText(
        row.created_by_name
      ),

    createdByPosition:
      normalizePosition(
        row.created_by_position
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

    revision,

    isEdited:
      revision >
        1,

    isMine,

    canEdit:
      isMine,

    canDelete:
      isMine ||
      Boolean(
        user?.isSuperAdmin
      )
  };
}


async function findCommentById(
  database,
  id,
  user = null
) {
  const row =
    await database
      .prepare(`
        SELECT
          ${COMMENT_COLUMNS}

        FROM notice_comments

        WHERE id = ?

        LIMIT 1
      `)
      .bind(
        id
      )
      .first();


  return row
    ? convertRowToComment(
        row,
        user
      )
    : null;
}


async function findCommentByClientRequestId(
  database,
  employeeNo,
  clientRequestId,
  user = null
) {
  if (
    !clientRequestId
  ) {
    return null;
  }


  const row =
    await database
      .prepare(`
        SELECT
          ${COMMENT_COLUMNS}

        FROM notice_comments

        WHERE
          created_by = ?
          AND client_request_id = ?

        LIMIT 1
      `)
      .bind(
        employeeNo,
        clientRequestId
      )
      .first();


  return row
    ? convertRowToComment(
        row,
        user
      )
    : null;
}


async function noticeExists(
  database,
  noticeType,
  noticeId
) {
  if (
    noticeType ===
      "global"
  ) {
    const row =
      await database
        .prepare(`
          SELECT id

          FROM global_notices

          WHERE id = ?

          LIMIT 1
        `)
        .bind(
          noticeId
        )
        .first();


    return Boolean(
      row?.id
    );
  }


  if (
    noticeType ===
      "role"
  ) {
    const row =
      await database
        .prepare(`
          SELECT id

          FROM role_notices

          WHERE id = ?

          LIMIT 1
        `)
        .bind(
          noticeId
        )
        .first();


    return Boolean(
      row?.id
    );
  }


  return false;
}


async function getCommentCount(
  database,
  noticeType,
  noticeId
) {
  const row =
    await database
      .prepare(`
        SELECT
          COUNT(*) AS comment_count

        FROM notice_comments

        WHERE
          notice_type = ?
          AND notice_id = ?
      `)
      .bind(
        noticeType,
        noticeId
      )
      .first();


  return Number(
    row?.comment_count ||
    0
  );
}


function validateCommentTarget(
  source
) {
  const noticeType =
    normalizeNoticeType(
      source?.noticeType ??
      source?.notice_type
    );


  if (
    !noticeType
  ) {
    return {
      error:
        "공지 종류가 올바르지 않습니다."
    };
  }


  const noticeId =
    normalizeIdentifier(
      source?.noticeId ??
      source?.notice_id
    );


  if (
    !noticeId
  ) {
    return {
      error:
        "공지사항 ID가 올바르지 않습니다."
    };
  }


  return {
    noticeType,
    noticeId
  };
}


function validateCommentContent(
  value
) {
  const content =
    normalizeLineText(
      value
    );


  if (
    !content
  ) {
    return {
      error:
        "댓글 내용을 입력해 주세요."
    };
  }


  if (
    content.length >
      MAX_COMMENT_LENGTH
  ) {
    return {
      error:
        `댓글은 최대 ${MAX_COMMENT_LENGTH}자까지 입력할 수 있습니다.`
    };
  }


  return {
    content
  };
}


function createConflictResponse(
  message,
  currentComment = null
) {
  return jsonResponse(
    {
      ok: false,

      conflict: true,

      message,

      currentComment
    },
    409
  );
}


function isSameCreateRequest(
  comment,
  noticeType,
  noticeId,
  content
) {
  return (
    comment.noticeType ===
      noticeType &&
    comment.noticeId ===
      noticeId &&
    comment.content ===
      content
  );
}


/* =========================================================
  GET /api/notice-comments

  댓글 목록:
  ?noticeType=global&noticeId=...

  댓글 개수 일괄 조회:
  ?mode=counts
  ?mode=counts&noticeType=role
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


    const user =
      authentication.user;


    const requestUrl =
      new URL(
        context.request.url
      );


    const mode =
      normalizeText(
        requestUrl.searchParams.get(
          "mode"
        )
      ).toLowerCase();


    const rawNoticeType =
      normalizeText(
        requestUrl.searchParams.get(
          "noticeType"
        ) ??
        requestUrl.searchParams.get(
          "notice_type"
        )
      );


    const noticeType =
      normalizeNoticeType(
        rawNoticeType
      );


    if (
      rawNoticeType &&
      !noticeType
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "공지 종류가 올바르지 않습니다."
        },
        400
      );
    }


    if (
      mode ===
        "counts"
    ) {
      let queryText = `
        SELECT
          notice_type,
          notice_id,
          COUNT(*) AS comment_count

        FROM notice_comments
      `;


      const bindValues = [];


      if (
        noticeType
      ) {
        queryText += `
          WHERE notice_type = ?
        `;


        bindValues.push(
          noticeType
        );
      }


      queryText += `
        GROUP BY
          notice_type,
          notice_id

        ORDER BY
          notice_type,
          notice_id
      `;


      const statement =
        context.env.DB.prepare(
          queryText
        );


      const result =
        bindValues.length
          ? await statement
              .bind(
                ...bindValues
              )
              .all()
          : await statement
              .all();


      const counts =
        (
          Array.isArray(
            result.results
          )
            ? result.results
            : []
        ).map(
          row => {
            return {
              noticeType:
                normalizeNoticeType(
                  row.notice_type
                ),

              noticeId:
                normalizeText(
                  row.notice_id
                ),

              count:
                Number(
                  row.comment_count ||
                  0
                )
            };
          }
        );


      return jsonResponse({
        ok: true,

        counts,

        totalTargetCount:
          counts.length
      });
    }


    if (
      mode
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "댓글 조회 방식이 올바르지 않습니다."
        },
        400
      );
    }


    const targetValidation =
      validateCommentTarget({
        noticeType:
          rawNoticeType,

        noticeId:
          requestUrl.searchParams.get(
            "noticeId"
          ) ??
          requestUrl.searchParams.get(
            "notice_id"
          )
      });


    if (
      targetValidation.error
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            targetValidation.error
        },
        400
      );
    }


    const {
      noticeType:
        targetNoticeType,

      noticeId
    } = targetValidation;


    const hasNotice =
      await noticeExists(
        context.env.DB,
        targetNoticeType,
        noticeId
      );


    if (
      !hasNotice
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "댓글을 조회할 공지사항을 찾을 수 없습니다."
        },
        404
      );
    }


    const result =
      await context.env.DB
        .prepare(`
          SELECT
            ${COMMENT_COLUMNS}

          FROM notice_comments

          WHERE
            notice_type = ?
            AND notice_id = ?

          ORDER BY
            created_at ASC,
            id ASC
        `)
        .bind(
          targetNoticeType,
          noticeId
        )
        .all();


    const comments =
      (
        Array.isArray(
          result.results
        )
          ? result.results
          : []
      ).map(
        row => {
          return convertRowToComment(
            row,
            user
          );
        }
      );


    return jsonResponse({
      ok: true,

      noticeType:
        targetNoticeType,

      noticeId,

      comments,

      totalCount:
        comments.length
    });

  } catch (
    error
  ) {
    console.error(
      "공지사항 댓글 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          "댓글을 불러오는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


/* =========================================================
  POST /api/notice-comments
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


    const parsedBody =
      await readJsonObject(
        context.request
      );


    if (
      parsedBody.error
    ) {
      return parsedBody.error;
    }


    const body =
      parsedBody.body;


    const targetValidation =
      validateCommentTarget(
        body
      );


    const contentValidation =
      validateCommentContent(
        body.content
      );


    if (
      targetValidation.error ||
      contentValidation.error
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            targetValidation.error ||
            contentValidation.error
        },
        400
      );
    }


    const {
      noticeType,
      noticeId
    } = targetValidation;


    const {
      content
    } = contentValidation;


    const rawClientRequestId =
      normalizeText(
        body.clientRequestId ??
        body.client_request_id
      );


    const clientRequestId =
      rawClientRequestId
        ? normalizeIdentifier(
            rawClientRequestId,
            MAX_CLIENT_REQUEST_ID_LENGTH
          )
        : "";


    if (
      rawClientRequestId &&
      !clientRequestId
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "댓글 요청 ID가 올바르지 않습니다."
        },
        400
      );
    }


    const hasNotice =
      await noticeExists(
        context.env.DB,
        noticeType,
        noticeId
      );


    if (
      !hasNotice
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "댓글을 작성할 공지사항을 찾을 수 없습니다."
        },
        404
      );
    }


    if (
      clientRequestId
    ) {
      const existingComment =
        await findCommentByClientRequestId(
          context.env.DB,
          user.employeeNo,
          clientRequestId,
          user
        );


      if (
        existingComment
      ) {
        if (
          !isSameCreateRequest(
            existingComment,
            noticeType,
            noticeId,
            content
          )
        ) {
          return createConflictResponse(
            "이미 사용된 댓글 요청 ID입니다.",
            existingComment
          );
        }


        return jsonResponse({
          ok: true,

          created: false,

          duplicate: true,

          comment:
            existingComment,

          totalCount:
            await getCommentCount(
              context.env.DB,
              noticeType,
              noticeId
            )
        });
      }
    }


    const id =
      crypto.randomUUID();


    const now =
      new Date()
        .toISOString();


    try {
      await context.env.DB
        .prepare(`
          INSERT INTO notice_comments (
            id,
            notice_type,
            notice_id,
            content,
            created_by,
            created_by_name,
            created_by_position,
            created_at,
            updated_by,
            updated_by_name,
            updated_at,
            revision,
            client_request_id
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
          )
        `)
        .bind(
          id,
          noticeType,
          noticeId,
          content,
          user.employeeNo,
          user.name,
          user.position,
          now,
          user.employeeNo,
          user.name,
          now,
          clientRequestId ||
            null
        )
        .run();

    } catch (
      error
    ) {
      if (
        clientRequestId
      ) {
        const existingComment =
          await findCommentByClientRequestId(
            context.env.DB,
            user.employeeNo,
            clientRequestId,
            user
          );


        if (
          existingComment
        ) {
          if (
            isSameCreateRequest(
              existingComment,
              noticeType,
              noticeId,
              content
            )
          ) {
            return jsonResponse({
              ok: true,

              created: false,

              duplicate: true,

              comment:
                existingComment,

              totalCount:
                await getCommentCount(
                  context.env.DB,
                  noticeType,
                  noticeId
                )
            });
          }


          return createConflictResponse(
            "이미 사용된 댓글 요청 ID입니다.",
            existingComment
          );
        }
      }


      throw error;
    }


    const savedComment =
      await findCommentById(
        context.env.DB,
        id,
        user
      );


    return jsonResponse(
      {
        ok: true,

        created: true,

        comment:
          savedComment,

        totalCount:
          await getCommentCount(
            context.env.DB,
            noticeType,
            noticeId
          )
      },
      201
    );

  } catch (
    error
  ) {
    console.error(
      "공지사항 댓글 등록 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          "댓글을 등록하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


/* =========================================================
  PUT /api/notice-comments
========================================================= */

export async function onRequestPut(
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


    const parsedBody =
      await readJsonObject(
        context.request
      );


    if (
      parsedBody.error
    ) {
      return parsedBody.error;
    }


    const body =
      parsedBody.body;


    const id =
      normalizeIdentifier(
        body.id
      );


    const expectedRevision =
      parseExpectedRevision(
        body.expectedRevision ??
        body.revision
      );


    const contentValidation =
      validateCommentContent(
        body.content
      );


    if (
      !id ||
      !expectedRevision ||
      contentValidation.error
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            (
              !id &&
              "수정할 댓글 ID가 올바르지 않습니다."
            ) ||
            (
              !expectedRevision &&
              "댓글 수정 버전이 올바르지 않습니다."
            ) ||
            contentValidation.error
        },
        400
      );
    }


    const existingComment =
      await findCommentById(
        context.env.DB,
        id,
        user
      );


    if (
      !existingComment
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "수정할 댓글을 찾을 수 없습니다."
        },
        404
      );
    }


    if (
      !existingComment.isMine
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "본인이 작성한 댓글만 수정할 수 있습니다."
        },
        403
      );
    }


    if (
      expectedRevision !==
        existingComment.revision
    ) {
      return createConflictResponse(
        "다른 화면에서 댓글이 먼저 수정되었습니다. 최신 내용을 확인해 주세요.",
        existingComment
      );
    }


    const now =
      new Date()
        .toISOString();


    const updateResult =
      await context.env.DB
        .prepare(`
          UPDATE notice_comments

          SET
            content = ?,
            updated_by = ?,
            updated_by_name = ?,
            updated_at = ?,
            revision =
              revision + 1

          WHERE
            id = ?
            AND revision = ?
            AND created_by = ?
        `)
        .bind(
          contentValidation.content,
          user.employeeNo,
          user.name,
          now,
          id,
          expectedRevision,
          user.employeeNo
        )
        .run();


    if (
      Number(
        updateResult?.meta?.changes ||
        0
      ) !==
        1
    ) {
      return createConflictResponse(
        "댓글이 변경되었습니다. 최신 내용을 확인해 주세요.",

        await findCommentById(
          context.env.DB,
          id,
          user
        )
      );
    }


    return jsonResponse({
      ok: true,

      comment:
        await findCommentById(
          context.env.DB,
          id,
          user
        )
    });

  } catch (
    error
  ) {
    console.error(
      "공지사항 댓글 수정 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          "댓글을 수정하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


/* =========================================================
  DELETE /api/notice-comments?id=...&revision=...
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


    const id =
      normalizeIdentifier(
        requestUrl.searchParams.get(
          "id"
        )
      );


    const expectedRevision =
      parseExpectedRevision(
        requestUrl.searchParams.get(
          "revision"
        )
      );


    if (
      !id ||
      !expectedRevision
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            !id
              ? "삭제할 댓글 ID가 올바르지 않습니다."
              : "댓글 삭제 버전이 올바르지 않습니다."
        },
        400
      );
    }


    const existingComment =
      await findCommentById(
        context.env.DB,
        id,
        user
      );


    if (
      !existingComment
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "삭제할 댓글을 찾을 수 없습니다."
        },
        404
      );
    }


    if (
      !existingComment.canDelete
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "현재 계정으로는 이 댓글을 삭제할 수 없습니다."
        },
        403
      );
    }


    if (
      expectedRevision !==
        existingComment.revision
    ) {
      return createConflictResponse(
        "다른 화면에서 댓글이 먼저 수정되었습니다. 최신 내용을 확인해 주세요.",
        existingComment
      );
    }


    const deleteResult =
      await context.env.DB
        .prepare(`
          DELETE FROM notice_comments

          WHERE
            id = ?
            AND revision = ?
        `)
        .bind(
          id,
          expectedRevision
        )
        .run();


    if (
      Number(
        deleteResult?.meta?.changes ||
        0
      ) !==
        1
    ) {
      return createConflictResponse(
        "댓글이 변경되었습니다. 최신 내용을 확인해 주세요.",

        await findCommentById(
          context.env.DB,
          id,
          user
        )
      );
    }


    return jsonResponse({
      ok: true,

      deletedId:
        id,

      noticeType:
        existingComment.noticeType,

      noticeId:
        existingComment.noticeId,

      totalCount:
        await getCommentCount(
          context.env.DB,
          existingComment.noticeType,
          existingComment.noticeId
        )
    });

  } catch (
    error
  ) {
    console.error(
      "공지사항 댓글 삭제 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          "댓글을 삭제하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}