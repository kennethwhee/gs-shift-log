/* =========================================================
  Morning Meeting Co-firing Adjustment API V1

  GET  /api/morning-meeting-cofiring-adjustments?targetDate=YYYY-MM-DD
  POST /api/morning-meeting-cofiring-adjustments

  Storage:
  - one adjustment per target date
  - from_unit 1 means Unit 1 -> Unit 2, 2 means Unit 2 -> Unit 1
  - bio_transfer_tons is an absolute transfer from original Daily DATA values
  - any active logged-in user can read/save/reset
========================================================= */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isValidIsoDate(value) {
  const normalizedValue = normalizeText(value);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return false;
  }
  const parsed = new Date(`${normalizedValue}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalizedValue;
}

function getBearerToken(request) {
  const authorization = normalizeText(request.headers.get("Authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authorization.slice(7).trim();
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizeText(token))
  );
  return bytesToHex(new Uint8Array(digest));
}

async function getAuthenticatedUser(context) {
  if (!context.env.DB) {
    return {
      error: jsonResponse({ ok: false, message: "D1 바인딩 DB가 등록되지 않았습니다." }, 500)
    };
  }
  const sessionToken = getBearerToken(context.request);
  if (!sessionToken) {
    return { error: jsonResponse({ ok: false, message: "로그인이 필요합니다." }, 401) };
  }
  const tokenHash = await hashSessionToken(sessionToken);
  const session = await context.env.DB
    .prepare(`
      SELECT
        session.employee_no,
        session.expires_at,
        user.name,
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
  const isExpired = Number.isNaN(expiresAt.getTime()) || expiresAt <= now;
  if (!session || Number(session.is_active) !== 1 || isExpired) {
    await context.env.DB
      .prepare("DELETE FROM shift_log_sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
    return {
      error: jsonResponse({ ok: false, message: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요." }, 401)
    };
  }
  await context.env.DB
    .prepare("UPDATE shift_log_sessions SET last_used_at = ? WHERE token_hash = ?")
    .bind(now.toISOString(), tokenHash)
    .run();
  return {
    user: {
      employeeNo: normalizeText(session.employee_no),
      name: normalizeText(session.name)
    }
  };
}

async function ensureTable(database) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS morning_meeting_cofiring_adjustments (
        target_date TEXT PRIMARY KEY,
        from_unit INTEGER NOT NULL,
        bio_transfer_tons REAL NOT NULL,
        updated_by_id TEXT NOT NULL DEFAULT '',
        updated_by_name TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )
    `)
    .run();
}

function normalizeFromUnit(value) {
  const numericValue = Number(value);
  return numericValue === 1 || numericValue === 2 ? numericValue : null;
}

function normalizeTransferTons(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > 2000) {
    return null;
  }
  return Math.round(numericValue * 100) / 100;
}

function convertRow(row) {
  if (!row) {
    return null;
  }
  return {
    targetDate: normalizeText(row.target_date),
    fromUnit: Number(row.from_unit),
    bioTransferTons: Number(row.bio_transfer_tons),
    updatedById: normalizeText(row.updated_by_id),
    updatedByName: normalizeText(row.updated_by_name),
    updatedAt: normalizeText(row.updated_at)
  };
}

async function readAdjustment(database, targetDate) {
  const row = await database
    .prepare(`
      SELECT
        target_date,
        from_unit,
        bio_transfer_tons,
        updated_by_id,
        updated_by_name,
        updated_at
      FROM morning_meeting_cofiring_adjustments
      WHERE target_date = ?
      LIMIT 1
    `)
    .bind(targetDate)
    .first();
  return convertRow(row);
}

export async function onRequestGet(context) {
  try {
    const authentication = await getAuthenticatedUser(context);
    if (authentication.error) {
      return authentication.error;
    }
    await ensureTable(context.env.DB);
    const requestUrl = new URL(context.request.url);
    const targetDate = normalizeText(requestUrl.searchParams.get("targetDate"));
    if (!isValidIsoDate(targetDate)) {
      return jsonResponse({ ok: false, message: "혼소 조정 기준일을 확인해 주세요." }, 400);
    }
    const adjustment = await readAdjustment(context.env.DB, targetDate);
    return jsonResponse({ ok: true, targetDate, adjustment });
  } catch (error) {
    console.error("혼소 조정 조회 오류:", error);
    return jsonResponse(
      { ok: false, message: error instanceof Error ? error.message : "혼소 조정값을 불러오지 못했습니다." },
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    const authentication = await getAuthenticatedUser(context);
    if (authentication.error) {
      return authentication.error;
    }
    await ensureTable(context.env.DB);
    let body;
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse({ ok: false, message: "혼소 조정 저장 요청 형식이 올바르지 않습니다." }, 400);
    }
    const targetDate = normalizeText(body?.targetDate);
    if (!isValidIsoDate(targetDate)) {
      return jsonResponse({ ok: false, message: "혼소 조정 기준일을 확인해 주세요." }, 400);
    }

    if (body?.clear === true) {
      await context.env.DB
        .prepare("DELETE FROM morning_meeting_cofiring_adjustments WHERE target_date = ?")
        .bind(targetDate)
        .run();
      return jsonResponse({ ok: true, targetDate, adjustment: null });
    }

    const fromUnit = normalizeFromUnit(body?.fromUnit);
    const bioTransferTons = normalizeTransferTons(body?.bioTransferTons);
    if (fromUnit === null || bioTransferTons === null) {
      return jsonResponse(
        { ok: false, message: "Bio 이동 방향과 이동량(t/d)을 확인해 주세요." },
        400
      );
    }

    const updatedAt = new Date().toISOString();
    await context.env.DB
      .prepare(`
        INSERT INTO morning_meeting_cofiring_adjustments (
          target_date,
          from_unit,
          bio_transfer_tons,
          updated_by_id,
          updated_by_name,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_date) DO UPDATE SET
          from_unit = excluded.from_unit,
          bio_transfer_tons = excluded.bio_transfer_tons,
          updated_by_id = excluded.updated_by_id,
          updated_by_name = excluded.updated_by_name,
          updated_at = excluded.updated_at
      `)
      .bind(
        targetDate,
        fromUnit,
        bioTransferTons,
        authentication.user.employeeNo,
        authentication.user.name,
        updatedAt
      )
      .run();

    const adjustment = await readAdjustment(context.env.DB, targetDate);
    return jsonResponse({ ok: true, targetDate, adjustment });
  } catch (error) {
    console.error("혼소 조정 저장 오류:", error);
    return jsonResponse(
      { ok: false, message: error instanceof Error ? error.message : "혼소 조정값을 저장하지 못했습니다." },
      500
    );
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") {
    return onRequestGet(context);
  }
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }
  return jsonResponse({ ok: false, message: "지원하지 않는 요청 방식입니다." }, 405);
}
