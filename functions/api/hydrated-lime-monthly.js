"use strict";

/* HYDRATED LIME MONTHLY API V1
   GET    /api/hydrated-lime-monthly?year=YYYY
   POST   /api/hydrated-lime-monthly
   DELETE /api/hydrated-lime-monthly?month=YYYY-MM
*/

const FORCED_SUPER_ADMIN_EMPLOYEE_NO = "2014081";

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeEmployeeNo(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeAccountRole(value) {
  const role = normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (role === "super_admin" || role === "superadmin") {
    return "super_admin";
  }

  if (role === "admin" || role === "leader") {
    return "admin";
  }

  return "user";
}

function getBearerToken(request) {
  const authorization = normalizeText(
    request.headers.get("Authorization")
  );
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return normalizeText(match?.[1]);
}

function bytesToHex(bytes) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return bytesToHex(new Uint8Array(digest));
}

async function getAuthenticatedUser(context) {
  if (!context.env.DB) {
    return {
      error: jsonResponse(
        {
          ok: false,
          message: "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      )
    };
  }

  const token = getBearerToken(context.request);

  if (!token) {
    return {
      error: jsonResponse(
        {
          ok: false,
          message: "로그인이 필요합니다."
        },
        401
      )
    };
  }

  const tokenHash = await hashSessionToken(token);

  const session = await context.env.DB
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

  const now = new Date();
  const expiresAt = new Date(session?.expires_at || 0);

  if (
    !session ||
    Number(session.is_active) !== 1 ||
    Number.isNaN(expiresAt.getTime()) ||
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
      error: jsonResponse(
        {
          ok: false,
          message: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
        },
        401
      )
    };
  }

  const employeeNo = normalizeEmployeeNo(session.employee_no);
  const role =
    employeeNo === FORCED_SUPER_ADMIN_EMPLOYEE_NO
      ? "super_admin"
      : normalizeAccountRole(session.role);

  await context.env.DB
    .prepare(`
      UPDATE shift_log_sessions
      SET last_used_at = ?
      WHERE token_hash = ?
    `)
    .bind(now.toISOString(), tokenHash)
    .run();

  return {
    user: {
      employeeNo,
      name: normalizeText(session.name),
      role
    }
  };
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body
      : {};
  } catch (_) {
    return {};
  }
}

function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalizeText(value));
}

function validYear(value) {
  return /^(19|20)\d{2}$/.test(normalizeText(value));
}

function validateQuantity(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0 || number > 1000000) {
    return {
      ok: false,
      message: "소석회 월 입고량은 0 이상 1,000,000 이하의 숫자로 입력해 주세요."
    };
  }

  return {
    ok: true,
    value: Math.round(number * 1000) / 1000
  };
}

function normalizeNote(value) {
  const note = normalizeText(value);
  return note.length <= 500 ? note : null;
}

async function ensureTable(db) {
  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS hydrated_lime_monthly_records (
        record_month TEXT PRIMARY KEY,
        quantity_ton REAL NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_by_id TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        updated_by_id TEXT NOT NULL DEFAULT '',
        updated_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_hydrated_lime_monthly_updated
      ON hydrated_lime_monthly_records(updated_at DESC)
    `)
    .run();
}

function mapRow(row) {
  return {
    month: normalizeText(row?.record_month),
    quantityTon: Number(row?.quantity_ton || 0),
    note: normalizeText(row?.note),
    createdById: normalizeText(row?.created_by_id),
    createdByName: normalizeText(row?.created_by_name),
    updatedById: normalizeText(row?.updated_by_id),
    updatedByName: normalizeText(row?.updated_by_name),
    createdAt: normalizeText(row?.created_at),
    updatedAt: normalizeText(row?.updated_at),
    revision: Number(row?.revision || 1)
  };
}

export async function onRequestGet(context) {
  try {
    const authentication = await getAuthenticatedUser(context);
    if (authentication.error) return authentication.error;

    await ensureTable(context.env.DB);

    const url = new URL(context.request.url);
    const month = normalizeText(url.searchParams.get("month"));
    const year = normalizeText(url.searchParams.get("year"));

    if (month) {
      if (!validMonth(month)) {
        return jsonResponse(
          {
            ok: false,
            message: "조회 월 형식이 올바르지 않습니다. YYYY-MM 형식으로 선택해 주세요."
          },
          400
        );
      }

      const row = await context.env.DB
        .prepare(`
          SELECT *
          FROM hydrated_lime_monthly_records
          WHERE record_month = ?
          LIMIT 1
        `)
        .bind(month)
        .first();

      return jsonResponse({
        ok: true,
        item: row ? mapRow(row) : null
      });
    }

    const targetYear = year || String(new Date().getUTCFullYear());

    if (!validYear(targetYear)) {
      return jsonResponse(
        {
          ok: false,
          message: "조회 연도 형식이 올바르지 않습니다."
        },
        400
      );
    }

    const result = await context.env.DB
      .prepare(`
        SELECT *
        FROM hydrated_lime_monthly_records
        WHERE record_month >= ?
          AND record_month <= ?
        ORDER BY record_month DESC
      `)
      .bind(`${targetYear}-01`, `${targetYear}-12`)
      .all();

    const items = Array.isArray(result?.results)
      ? result.results.map(mapRow)
      : [];

    return jsonResponse({
      ok: true,
      year: targetYear,
      items
    });
  } catch (error) {
    console.error("hydrated-lime-monthly GET failed", error);

    return jsonResponse(
      {
        ok: false,
        message: "소석회 월별 기록을 불러오지 못했습니다."
      },
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    const authentication = await getAuthenticatedUser(context);
    if (authentication.error) return authentication.error;

    await ensureTable(context.env.DB);

    const body = await readJsonBody(context.request);
    const month = normalizeText(body.month);

    if (!validMonth(month)) {
      return jsonResponse(
        {
          ok: false,
          message: "기준 월을 YYYY-MM 형식으로 선택해 주세요."
        },
        400
      );
    }

    const quantity = validateQuantity(body.quantityTon);
    if (!quantity.ok) {
      return jsonResponse(
        {
          ok: false,
          message: quantity.message
        },
        400
      );
    }

    const note = normalizeNote(body.note);
    if (note === null) {
      return jsonResponse(
        {
          ok: false,
          message: "비고는 500자 이하로 입력해 주세요."
        },
        400
      );
    }

    const user = authentication.user;
    const now = new Date().toISOString();

    await context.env.DB
      .prepare(`
        INSERT INTO hydrated_lime_monthly_records (
          record_month,
          quantity_ton,
          note,
          created_by_id,
          created_by_name,
          updated_by_id,
          updated_by_name,
          created_at,
          updated_at,
          revision
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(record_month) DO UPDATE SET
          quantity_ton = excluded.quantity_ton,
          note = excluded.note,
          updated_by_id = excluded.updated_by_id,
          updated_by_name = excluded.updated_by_name,
          updated_at = excluded.updated_at,
          revision = hydrated_lime_monthly_records.revision + 1
      `)
      .bind(
        month,
        quantity.value,
        note,
        user.employeeNo,
        user.name,
        user.employeeNo,
        user.name,
        now,
        now
      )
      .run();

    const row = await context.env.DB
      .prepare(`
        SELECT *
        FROM hydrated_lime_monthly_records
        WHERE record_month = ?
        LIMIT 1
      `)
      .bind(month)
      .first();

    return jsonResponse({
      ok: true,
      item: row ? mapRow(row) : null,
      message: `${month} 소석회 월 기록을 저장했습니다.`
    });
  } catch (error) {
    console.error("hydrated-lime-monthly POST failed", error);

    return jsonResponse(
      {
        ok: false,
        message: "소석회 월 기록을 저장하지 못했습니다."
      },
      500
    );
  }
}

export async function onRequestDelete(context) {
  try {
    const authentication = await getAuthenticatedUser(context);
    if (authentication.error) return authentication.error;

    await ensureTable(context.env.DB);

    const url = new URL(context.request.url);
    const month = normalizeText(url.searchParams.get("month"));

    if (!validMonth(month)) {
      return jsonResponse(
        {
          ok: false,
          message: "삭제할 기준 월이 올바르지 않습니다."
        },
        400
      );
    }

    const result = await context.env.DB
      .prepare(`
        DELETE FROM hydrated_lime_monthly_records
        WHERE record_month = ?
      `)
      .bind(month)
      .run();

    if (Number(result?.meta?.changes || 0) !== 1) {
      return jsonResponse(
        {
          ok: false,
          message: "삭제할 소석회 월 기록을 찾을 수 없습니다."
        },
        404
      );
    }

    return jsonResponse({
      ok: true,
      month,
      message: `${month} 소석회 월 기록을 삭제했습니다.`
    });
  } catch (error) {
    console.error("hydrated-lime-monthly DELETE failed", error);

    return jsonResponse(
      {
        ok: false,
        message: "소석회 월 기록을 삭제하지 못했습니다."
      },
      500
    );
  }
}
