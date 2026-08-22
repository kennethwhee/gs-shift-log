"use strict";

const MAX_REQUEST_BYTES =
  512 * 1024;

const MAX_ROWS = 80;

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
            authenticated: false,
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
      .bind(tokenHash)
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
    Number(session.is_active) !== 1 ||
    Number.isNaN(
      expiresAt.getTime()
    ) ||
    expiresAt <= now
  ) {
    await context.env.DB
      .prepare(`
        DELETE FROM shift_log_sessions
        WHERE token_hash = ?
      `)
      .bind(tokenHash)
      .run();

    return {
      error:
        jsonResponse(
          {
            ok: false,
            authenticated: false,
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
          120
        ),
      name:
        normalizeText(
          session.name,
          200
        ),
      role:
        normalizeText(
          session.role,
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
      CREATE TABLE IF NOT EXISTS manhole_management_documents (
        id TEXT PRIMARY KEY NOT NULL,
        unit_no TEXT NOT NULL,
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
        idx_manhole_management_unit
      ON manhole_management_documents (
        unit_no
      )
    `)
  ]);
}

function normalizeUnit(
  value
) {
  const unit =
    normalizeText(
      value,
      5
    );

  return unit === "2"
    ? "2"
    : "1";
}

function normalizeStatus(
  value
) {
  const status =
    normalizeText(
      value,
      20
    ).toLowerCase();

  if (status === "open") {
    return "open";
  }

  if (status === "close") {
    return "close";
  }

  return "";
}

function normalizeDate(
  value
) {
  const text =
    normalizeText(
      value,
      10
    );

  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : "";
}

function sanitizeRows(
  rows
) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const seen =
    new Set();

  const result = [];

  for (
    const source of rows.slice(
      0,
      MAX_ROWS
    )
  ) {
    const no =
      Number(source?.no);

    if (
      !Number.isInteger(no) ||
      no < 1 ||
      no > 80 ||
      seen.has(no)
    ) {
      continue;
    }

    seen.add(no);

    result.push({
      no,
      status:
        normalizeStatus(
          source?.status
        ),
      changeDate:
        normalizeDate(
          source?.changeDate ||
          source?.change_date
        ),
      note:
        normalizeText(
          source?.note,
          1000
        )
    });
  }

  return result;
}

function parseStoredContent(
  raw
) {
  try {
    const parsed =
      JSON.parse(
        String(raw || "{}")
      );

    return {
      rows:
        sanitizeRows(
          parsed?.rows
        )
    };

  } catch {
    return {
      rows: []
    };
  }
}

function createDocumentId(
  unit
) {
  if (
    typeof crypto.randomUUID ===
      "function"
  ) {
    return (
      `manhole-${unit}-` +
      crypto.randomUUID()
    );
  }

  return (
    `manhole-${unit}-` +
    Date.now().toString(36)
  );
}

async function getDocument(
  database,
  unit
) {
  return database
    .prepare(`
      SELECT
        id,
        unit_no,
        version,
        content_json,
        author_id,
        author_name,
        last_modified_by_id,
        last_modified_by_name,
        created_at,
        updated_at
      FROM manhole_management_documents
      WHERE unit_no = ?
      LIMIT 1
    `)
    .bind(unit)
    .first();
}

async function handleGet(
  context,
  user
) {
  const url =
    new URL(
      context.request.url
    );

  const unit =
    normalizeUnit(
      url.searchParams.get(
        "unit"
      )
    );

  await ensureSchema(
    context.env.DB
  );

  const row =
    await getDocument(
      context.env.DB,
      unit
    );

  if (!row) {
    return jsonResponse({
      ok: true,
      authenticated: true,
      unit,
      version: 0,
      content: {
        rows: []
      },
      lastModifiedBy: "",
      updatedAt: "",
      currentUser: {
        name: user.name,
        employeeNo:
          user.employeeNo
      }
    });
  }

  return jsonResponse({
    ok: true,
    authenticated: true,
    unit,
    version:
      Number(row.version) || 0,
    content:
      parseStoredContent(
        row.content_json
      ),
    lastModifiedBy:
      normalizeText(
        row.last_modified_by_name,
        200
      ),
    updatedAt:
      normalizeText(
        row.updated_at,
        80
      ),
    currentUser: {
      name: user.name,
      employeeNo:
        user.employeeNo
    }
  });
}

async function readJsonBody(
  request
) {
  const contentLength =
    Number(
      request.headers.get(
        "Content-Length"
      )
    );

  if (
    Number.isFinite(contentLength) &&
    contentLength >
      MAX_REQUEST_BYTES
  ) {
    throw new Error(
      "REQUEST_TOO_LARGE"
    );
  }

  const text =
    await request.text();

  if (
    new TextEncoder()
      .encode(text)
      .byteLength >
    MAX_REQUEST_BYTES
  ) {
    throw new Error(
      "REQUEST_TOO_LARGE"
    );
  }

  try {
    return JSON.parse(
      text || "{}"
    );
  } catch {
    throw new Error(
      "INVALID_JSON"
    );
  }
}

async function handlePut(
  context,
  user
) {
  let body;

  try {
    body =
      await readJsonBody(
        context.request
      );
  } catch (error) {
    if (
      error?.message ===
      "REQUEST_TOO_LARGE"
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "저장 데이터가 너무 큽니다."
        },
        413
      );
    }

    return jsonResponse(
      {
        ok: false,
        message:
          "요청 데이터 형식이 올바르지 않습니다."
      },
      400
    );
  }

  const unit =
    normalizeUnit(
      body?.unit
    );

  const requestedVersion =
    Math.max(
      0,
      Number(
        body?.version
      ) || 0
    );

  const content = {
    rows:
      sanitizeRows(
        body?.content?.rows
      )
  };

  await ensureSchema(
    context.env.DB
  );

  const existing =
    await getDocument(
      context.env.DB,
      unit
    );

  const now =
    new Date().toISOString();

  if (!existing) {
    if (requestedVersion !== 0) {
      return jsonResponse(
        {
          ok: false,
          conflict: true,
          message:
            "최신 데이터와 버전이 다릅니다. 다시 불러와 주세요."
        },
        409
      );
    }

    const id =
      createDocumentId(
        unit
      );

    await context.env.DB
      .prepare(`
        INSERT INTO manhole_management_documents (
          id,
          unit_no,
          version,
          content_json,
          author_id,
          author_name,
          last_modified_by_id,
          last_modified_by_name,
          created_at,
          updated_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        unit,
        JSON.stringify(content),
        user.employeeNo,
        user.name,
        user.employeeNo,
        user.name,
        now,
        now
      )
      .run();

    return jsonResponse({
      ok: true,
      unit,
      version: 1,
      content,
      lastModifiedBy:
        user.name,
      updatedAt:
        now
    });
  }

  const currentVersion =
    Number(
      existing.version
    ) || 0;

  if (
    currentVersion !==
    requestedVersion
  ) {
    return jsonResponse(
      {
        ok: false,
        conflict: true,
        version:
          currentVersion,
        message:
          "다른 사용자가 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요."
      },
      409
    );
  }

  const nextVersion =
    currentVersion + 1;

  const result =
    await context.env.DB
      .prepare(`
        UPDATE manhole_management_documents
        SET
          version = ?,
          content_json = ?,
          last_modified_by_id = ?,
          last_modified_by_name = ?,
          updated_at = ?
        WHERE
          id = ?
          AND version = ?
      `)
      .bind(
        nextVersion,
        JSON.stringify(content),
        user.employeeNo,
        user.name,
        now,
        existing.id,
        currentVersion
      )
      .run();

  if (
    Number(
      result?.meta?.changes
    ) !== 1
  ) {
    return jsonResponse(
      {
        ok: false,
        conflict: true,
        message:
          "저장 중 데이터가 변경되었습니다. 다시 불러와 주세요."
      },
      409
    );
  }

  return jsonResponse({
    ok: true,
    unit,
    version:
      nextVersion,
    content,
    lastModifiedBy:
      user.name,
    updatedAt:
      now
  });
}

export async function onRequest(
  context
) {
  if (
    context.request.method ===
    "OPTIONS"
  ) {
    return new Response(
      null,
      {
        status: 204,
        headers: {
          Allow:
            "GET, PUT, OPTIONS"
        }
      }
    );
  }

  const auth =
    await getAuthenticatedUser(
      context
    );

  if (auth.error) {
    return auth.error;
  }

  if (
    context.request.method ===
    "GET"
  ) {
    return handleGet(
      context,
      auth.user
    );
  }

  if (
    context.request.method ===
    "PUT"
  ) {
    return handlePut(
      context,
      auth.user
    );
  }

  return jsonResponse(
    {
      ok: false,
      message:
        "지원하지 않는 요청 방식입니다."
    },
    405
  );
}
