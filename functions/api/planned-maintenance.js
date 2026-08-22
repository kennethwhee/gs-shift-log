"use strict";

const MAX_REQUEST_BYTES =
  1024 * 1024;

const MAX_ROWS =
  300;

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
          "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}

function normalizeText(
  value,
  maxLength = 30000
) {
  return String(
    value ?? ""
  )
    .trim()
    .slice(0, maxLength);
}

function getBearerToken(
  request
) {
  const authorization =
    normalizeText(
      request.headers.get(
        "Authorization"
      ),
      5000
    );

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );

  return normalizeText(
    match?.[1],
    5000
  );
}

function bytesToHex(
  bytes
) {
  return [...bytes]
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}

async function hashSessionToken(
  token
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder()
        .encode(token)
    );

  return bytesToHex(
    new Uint8Array(digest)
  );
}

async function getAuthenticatedUser(
  context
) {
  if (!context.env.DB) {
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

  if (!token) {
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
          ON user.employee_no = session.employee_no
        WHERE session.token_hash = ?
        LIMIT 1
      `)
      .bind(tokenHash)
      .first();

  const now =
    new Date();

  const expiresAt =
    new Date(
      session?.expires_at || 0
    );

  if (
    !session ||
    Number(session.is_active) !== 1 ||
    Number.isNaN(
      expiresAt.getTime()
    ) ||
    expiresAt <= now
  ) {
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
        normalizeText(
          session.employee_no,
          50
        ),
      name:
        normalizeText(
          session.name,
          100
        )
    }
  };
}

async function ensureSchema(
  database
) {
  await database.batch([
    database.prepare(`
      CREATE TABLE IF NOT EXISTS planned_maintenance_documents (
        id TEXT PRIMARY KEY NOT NULL,
        plan_year INTEGER NOT NULL,
        unit_no TEXT NOT NULL,
        document_type TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        content_json TEXT NOT NULL DEFAULT '{"rows":[]}',
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        last_modified_by_id TEXT NOT NULL,
        last_modified_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        idx_planned_maintenance_document_scope
      ON planned_maintenance_documents (
        plan_year,
        unit_no,
        document_type
      )
    `)
  ]);
}

function normalizeScope(
  source
) {
  const year =
    Number(
      source.year ??
      source.planYear ??
      source.plan_year
    );

  const unit =
    normalizeText(
      source.unit ??
      source.unitNo ??
      source.unit_no,
      10
    );

  const type =
    normalizeText(
      source.type ??
      source.documentType ??
      source.document_type,
      20
    ).toLowerCase();

  if (
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100
  ) {
    throw new Error(
      "계획연도가 올바르지 않습니다."
    );
  }

  if (
    unit !== "1" &&
    unit !== "2"
  ) {
    throw new Error(
      "호기 값이 올바르지 않습니다."
    );
  }

  if (
    type !== "logic" &&
    type !== "work"
  ) {
    throw new Error(
      "계획정비 구분이 올바르지 않습니다."
    );
  }

  return {
    year,
    unit,
    type
  };
}

function normalizeVersion(
  value
) {
  const version =
    Number(value ?? 0);

  if (
    !Number.isInteger(version) ||
    version < 0
  ) {
    throw new Error(
      "저장 버전 값이 올바르지 않습니다."
    );
  }

  return version;
}

function normalizeLogicRow(
  row
) {
  return {
    id:
      normalizeText(
        row?.id,
        120
      ) ||
      crypto.randomUUID(),
    createdDate:
      normalizeText(
        row?.createdDate,
        20
      ),
    equipmentName:
      normalizeText(
        row?.equipmentName,
        1000
      ),
    reason:
      normalizeText(
        row?.reason,
        30000
      ),
    targetEquipment:
      normalizeText(
        row?.targetEquipment,
        5000
      ),
    progress:
      normalizeText(
        row?.progress,
        10000
      ),
    author:
      normalizeText(
        row?.author,
        100
      ),
    controlReply1:
      normalizeText(
        row?.controlReply1,
        10000
      ),
    operationReply1:
      normalizeText(
        row?.operationReply1,
        10000
      ),
    controlReply2:
      normalizeText(
        row?.controlReply2,
        10000
      ),
    remark:
      normalizeText(
        row?.remark,
        10000
      )
  };
}

function normalizeWorkRow(
  row
) {
  const allowedCategories =
    new Set([
      "기계",
      "전기",
      "제어",
      "안전",
      "효율",
      "기타"
    ]);

  const category =
    normalizeText(
      row?.category,
      30
    );

  return {
    id:
      normalizeText(
        row?.id,
        120
      ) ||
      crypto.randomUUID(),
    category:
      allowedCategories.has(
        category
      )
        ? category
        : "기타",
    equipmentName:
      normalizeText(
        row?.equipmentName,
        1000
      ),
    tag:
      normalizeText(
        row?.tag,
        500
      ),
    reason:
      normalizeText(
        row?.reason,
        30000
      ),
    issueDate:
      normalizeText(
        row?.issueDate,
        20
      ),
    progress:
      normalizeText(
        row?.progress,
        10000
      ),
    author:
      normalizeText(
        row?.author,
        100
      ),
    remark:
      normalizeText(
        row?.remark,
        10000
      )
  };
}

function normalizeRows(
  rows,
  type
) {
  if (!Array.isArray(rows)) {
    throw new Error(
      "저장할 항목 목록 형식이 올바르지 않습니다."
    );
  }

  if (rows.length > MAX_ROWS) {
    throw new Error(
      `계획정비 항목은 최대 ${MAX_ROWS}건까지 저장할 수 있습니다.`
    );
  }

  return rows.map(
    row =>
      type === "work"
        ? normalizeWorkRow(row)
        : normalizeLogicRow(row)
  );
}

async function readRequestBody(
  request
) {
  const text =
    await request.text();

  const bytes =
    new TextEncoder()
      .encode(text)
      .byteLength;

  if (bytes > MAX_REQUEST_BYTES) {
    throw new Error(
      "저장 내용이 너무 큽니다."
    );
  }

  try {
    return JSON.parse(
      text || "{}"
    );
  } catch {
    throw new Error(
      "저장 요청 형식이 올바르지 않습니다."
    );
  }
}

function parseContent(
  value
) {
  try {
    const parsed =
      JSON.parse(
        normalizeText(
          value,
          MAX_REQUEST_BYTES
        ) ||
        "{}"
      );

    return (
      parsed &&
      typeof parsed === "object"
    )
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function rowToItem(
  row,
  fallbackScope
) {
  if (!row) {
    return {
      year:
        fallbackScope.year,
      unit:
        fallbackScope.unit,
      type:
        fallbackScope.type,
      version: 0,
      rows: [],
      id: "",
      lastModifiedBy: "",
      updatedAt: ""
    };
  }

  const content =
    parseContent(
      row.content_json
    );

  return {
    year:
      Number(row.plan_year),
    unit:
      normalizeText(
        row.unit_no,
        10
      ),
    type:
      normalizeText(
        row.document_type,
        20
      ),
    version:
      Number(row.version || 1),
    rows:
      Array.isArray(
        content.rows
      )
        ? content.rows
        : [],
    id:
      normalizeText(
        row.id,
        120
      ),
    author:
      normalizeText(
        row.author_name,
        100
      ),
    lastModifiedBy:
      normalizeText(
        row.last_modified_by_name,
        100
      ),
    createdAt:
      normalizeText(
        row.created_at,
        100
      ),
    updatedAt:
      normalizeText(
        row.updated_at,
        100
      )
  };
}

async function findRow(
  database,
  scope
) {
  return await database
    .prepare(`
      SELECT
        id,
        plan_year,
        unit_no,
        document_type,
        version,
        content_json,
        author_id,
        author_name,
        last_modified_by_id,
        last_modified_by_name,
        created_at,
        updated_at
      FROM planned_maintenance_documents
      WHERE plan_year = ?
        AND unit_no = ?
        AND document_type = ?
      LIMIT 1
    `)
    .bind(
      scope.year,
      scope.unit,
      scope.type
    )
    .first();
}

export async function onRequestGet(
  context
) {
  try {
    const authentication =
      await getAuthenticatedUser(
        context
      );

    if (authentication.error) {
      return authentication.error;
    }

    await ensureSchema(
      context.env.DB
    );

    const url =
      new URL(
        context.request.url
      );

    const scope =
      normalizeScope({
        year:
          url.searchParams.get(
            "year"
          ),
        unit:
          url.searchParams.get(
            "unit"
          ),
        type:
          url.searchParams.get(
            "type"
          )
      });

    const row =
      await findRow(
        context.env.DB,
        scope
      );

    return jsonResponse({
      ok: true,
      item:
        rowToItem(
          row,
          scope
        )
    });

  } catch (error) {
    console.error(
      "계획정비 조회 오류:",
      error
    );

    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "계획정비 기록 조회 중 오류가 발생했습니다."
      },
      400
    );
  }
}

export async function onRequestPut(
  context
) {
  try {
    const authentication =
      await getAuthenticatedUser(
        context
      );

    if (authentication.error) {
      return authentication.error;
    }

    await ensureSchema(
      context.env.DB
    );

    const body =
      await readRequestBody(
        context.request
      );

    const scope =
      normalizeScope(body);

    const expectedVersion =
      normalizeVersion(
        body.version
      );

    const rows =
      normalizeRows(
        body.rows,
        scope.type
      );

    const contentJson =
      JSON.stringify({
        rows
      });

    const current =
      await findRow(
        context.env.DB,
        scope
      );

    const now =
      new Date()
        .toISOString();

    const user =
      authentication.user;

    if (!current) {
      if (expectedVersion !== 0) {
        return jsonResponse(
          {
            ok: false,
            code:
              "VERSION_CONFLICT",
            message:
              "서버 기록 버전이 변경되었습니다. 다시 불러와 주세요."
          },
          409
        );
      }

      const id =
        crypto.randomUUID();

      await context.env.DB
        .prepare(`
          INSERT INTO planned_maintenance_documents (
            id,
            plan_year,
            unit_no,
            document_type,
            version,
            content_json,
            author_id,
            author_name,
            last_modified_by_id,
            last_modified_by_name,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          id,
          scope.year,
          scope.unit,
          scope.type,
          contentJson,
          user.employeeNo,
          user.name,
          user.employeeNo,
          user.name,
          now,
          now
        )
        .run();

    } else {
      if (
        Number(current.version) !==
        expectedVersion
      ) {
        return jsonResponse(
          {
            ok: false,
            code:
              "VERSION_CONFLICT",
            message:
              "다른 사용자가 먼저 수정했습니다. 다시 불러와 주세요.",
            item:
              rowToItem(
                current,
                scope
              )
          },
          409
        );
      }

      const result =
        await context.env.DB
          .prepare(`
            UPDATE planned_maintenance_documents
            SET
              content_json = ?,
              version = version + 1,
              last_modified_by_id = ?,
              last_modified_by_name = ?,
              updated_at = ?
            WHERE id = ?
              AND version = ?
          `)
          .bind(
            contentJson,
            user.employeeNo,
            user.name,
            now,
            current.id,
            expectedVersion
          )
          .run();

      if (
        Number(
          result.meta?.changes || 0
        ) !== 1
      ) {
        return jsonResponse(
          {
            ok: false,
            code:
              "VERSION_CONFLICT",
            message:
              "다른 사용자가 먼저 수정했습니다. 다시 불러와 주세요."
          },
          409
        );
      }
    }

    const saved =
      await findRow(
        context.env.DB,
        scope
      );

    return jsonResponse({
      ok: true,
      item:
        rowToItem(
          saved,
          scope
        )
    });

  } catch (error) {
    console.error(
      "계획정비 저장 오류:",
      error
    );

    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "계획정비 기록 저장 중 오류가 발생했습니다."
      },
      400
    );
  }
}
