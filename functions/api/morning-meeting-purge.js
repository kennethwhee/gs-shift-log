"use strict";

const FORCED_SUPER_ADMIN_EMPLOYEE_NO = "2014081";

const PURGE_REQUEST_TYPES = Object.freeze([
  "water_environment",
  "limestone_stock",
  "turbine_gear_pinion",
  "silo_level",
  "daily_data_excel",
  "steam_status",
  "organic_silo_dataparc"
]);

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

function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["super_admin", "superadmin"].includes(role)) return "super_admin";
  if (["admin", "leader"].includes(role)) return "admin";
  return "user";
}

function isValidIsoDate(value) {
  const date = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function getBearerToken(request) {
  const authorization = normalizeText(request.headers.get("Authorization"));
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return normalizeText(match?.[1]);
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return bytesToHex(new Uint8Array(digest));
}

async function getAuthenticatedUser(context) {
  const database = context?.env?.DB;
  if (!database) {
    return { error: jsonResponse({ ok: false, message: "D1 바인딩 DB가 등록되지 않았습니다." }, 500) };
  }
  const token = getBearerToken(context.request);
  if (!token) {
    return { error: jsonResponse({ ok: false, message: "로그인이 필요합니다." }, 401) };
  }
  const tokenHash = await hashSessionToken(token);
  const session = await database.prepare(`
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
  `).bind(tokenHash).first();

  const expiresAt = new Date(session?.expires_at || 0);
  if (
    !session ||
    Number(session.is_active) !== 1 ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt <= new Date()
  ) {
    return { error: jsonResponse({ ok: false, message: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요." }, 401) };
  }

  const employeeNo = normalizeEmployeeNo(session.employee_no);
  const role = employeeNo === FORCED_SUPER_ADMIN_EMPLOYEE_NO
    ? "super_admin"
    : normalizeRole(session.role);
  return {
    user: {
      employeeNo,
      name: normalizeText(session.name),
      role
    }
  };
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function requestTypeMap(rows) {
  const result = {};
  for (const row of rows || []) {
    const type = normalizeText(row.request_type);
    if (!type) continue;
    result[type] = Number(row.row_count || 0);
  }
  return result;
}

async function activeRows(database, targetDate, now) {
  const marks = placeholders(PURGE_REQUEST_TYPES.length);
  const result = await database.prepare(`
    SELECT id, request_type, status, expires_at
    FROM ois_data_requests
    WHERE target_date = ?
      AND request_type IN (${marks})
      AND status IN ('pending', 'processing')
      AND (expires_at IS NULL OR expires_at >= ?)
    ORDER BY request_type ASC, requested_at ASC, id ASC
    LIMIT 50
  `).bind(targetDate, ...PURGE_REQUEST_TYPES, now).all();
  return Array.isArray(result.results) ? result.results : [];
}

export async function onRequestPost(context) {
  try {
    const authentication = await getAuthenticatedUser(context);
    if (authentication.error) return authentication.error;

    let body = {};
    try {
      body = await context.request.json();
    } catch (_) {
      return jsonResponse({ ok: false, message: "자료삭제 요청 내용을 확인해 주세요." }, 400);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse({ ok: false, message: '초기화 요청 내용을 확인해 주세요.' }, 400);
    }
    const origin = context.request.headers.get('Origin');
    if (origin && origin !== new URL(context.request.url).origin) {
      return jsonResponse({ ok: false, message: '동일한 사이트에서 요청해 주세요.' }, 403);
    }
    const targetDate = normalizeText(body.targetDate);
    if (!isValidIsoDate(targetDate)) {
      return jsonResponse({ ok: false, message: "자료삭제할 날짜를 확인해 주세요." }, 400);
    }
    const deleteMode = normalizeText(body.mode);
    if (
      body.confirmPermanentDelete !== true ||
      ![
        "selected_date_data_delete_v4",
        "selected_date_reset_delete_v2"
      ].includes(deleteMode)
    ) {
      return jsonResponse({
        ok: false,
        code: "PERMANENT_DELETE_CONFIRMATION_REQUIRED",
        message: "선택일 자료삭제 확인값이 없습니다. 화면의 [자료삭제] 버튼을 사용해 주세요."
      }, 400);
    }

    const database = context.env.DB;
    const resetRow = await database.prepare(`
      SELECT target_date, revision
      FROM morning_meeting_auto_history_overrides
      WHERE target_date = ?
      LIMIT 1
    `).bind(targetDate).first();

    const serverRevision = resetRow ? Number(resetRow.revision || 0) : 0;
    const expectedRevision = body.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return jsonResponse({ok:false,message:'초기화할 자료 버전을 확인해 주세요.'},400);
    }
    if (expectedRevision !== serverRevision) {
      return jsonResponse({
        ok: false,
        code: "MORNING_MEETING_PURGE_REVISION_CONFLICT",
        currentRevision: serverRevision,
        message: "다른 사용자가 선택일 자료 상태를 변경했습니다. 화면을 새로고침한 뒤 다시 초기화해 주세요."
      }, 409);
    }

    const now = new Date().toISOString();
    const beforeActive = await activeRows(database, targetDate, now);
    if (beforeActive.length > 0) {
      const activeRequestTypes = [...new Set(beforeActive.map(row => normalizeText(row.request_type)).filter(Boolean))];
      return jsonResponse({
        ok: false,
        code: "MORNING_MEETING_PURGE_QUERY_ACTIVE",
        activeRequestTypes,
        message: "선택일 자료를 실제 조회 중입니다. 조회가 끝난 뒤 초기화해 주세요."
      }, 409);
    }

    const marks = placeholders(PURGE_REQUEST_TYPES.length);
    const user = authentication.user;
    // Selected-date delete removes only Morning Meeting copies/results.
    // TO power originals, co-firing Closed data/adjustments/settings,
    // solid-fuel unloading records and every other date are out of scope.
    // Keep an active blank tombstone until explicit All/Requery succeeds.
    const revisionValue = resetRow ? serverRevision : 0;
    const statements = [
      database.prepare(`SELECT json(CASE WHEN
        COALESCE((SELECT revision FROM morning_meeting_auto_history_overrides WHERE target_date = ?), 0) = ?
        AND NOT EXISTS (SELECT 1 FROM ois_data_requests
          WHERE target_date = ? AND request_type IN (${marks})
            AND status IN ('pending','processing') AND (expires_at IS NULL OR expires_at >= ?))
        THEN 'true' ELSE 'PURGE_CONFLICT' END) AS allowed`)
        .bind(targetDate, revisionValue, targetDate, ...PURGE_REQUEST_TYPES, now),
      database.prepare(`SELECT request_type, COUNT(*) AS row_count FROM ois_data_requests
        WHERE target_date = ? AND request_type IN (${marks}) GROUP BY request_type ORDER BY request_type`)
        .bind(targetDate, ...PURGE_REQUEST_TYPES),
      database.prepare(`DELETE FROM ois_data_requests WHERE target_date = ? AND request_type IN (${marks})`)
        .bind(targetDate, ...PURGE_REQUEST_TYPES),
      database.prepare(`INSERT INTO morning_meeting_auto_history_overrides (
          target_date, values_json,
          created_by_id, created_by_name, created_at,
          updated_by_id, updated_by_name, updated_at, revision,
          reset_active, reset_at, reset_by_id, reset_by_name,
          reset_snapshot_values_json, reset_restored_at
        ) VALUES (?, '{}', ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, '{}', '')
        ON CONFLICT(target_date) DO UPDATE SET
          values_json = '{}',
          reset_active = 1,
          reset_at = excluded.reset_at,
          reset_by_id = excluded.reset_by_id,
          reset_by_name = excluded.reset_by_name,
          reset_snapshot_values_json = '{}',
          reset_restored_at = '',
          updated_by_id = excluded.updated_by_id,
          updated_by_name = excluded.updated_by_name,
          updated_at = excluded.updated_at,
          revision = morning_meeting_auto_history_overrides.revision + 1
        WHERE morning_meeting_auto_history_overrides.revision = ?`)
        .bind(
          targetDate,
          user.employeeNo, user.name, now,
          user.employeeNo, user.name, now,
          now, user.employeeNo, user.name,
          revisionValue
        ),
      database.prepare(`SELECT revision, reset_active, reset_at
        FROM morning_meeting_auto_history_overrides WHERE target_date = ? LIMIT 1`)
        .bind(targetDate),
      database.prepare(`SELECT COUNT(*) AS row_count FROM ois_data_requests
        WHERE target_date = ? AND request_type IN (${marks})`).bind(targetDate, ...PURGE_REQUEST_TYPES)
    ];
    let results;
    try {
      results = await database.batch(statements);
    } catch (error) {
      // D1 batch is transactional: a failed guard rolls back deletion + tombstone.
      const current = await database.prepare('SELECT revision FROM morning_meeting_auto_history_overrides WHERE target_date = ?').bind(targetDate).first();
      if ((current ? Number(current.revision) : 0) !== revisionValue) {
        return jsonResponse({ok:false,code:'MORNING_MEETING_PURGE_REVISION_CONFLICT',
          message:'다른 사용자가 선택일 자료를 변경했습니다. 최신 상태를 확인해 주세요.'},409);
      }
      if ((await activeRows(database, targetDate, new Date().toISOString())).length) {
        return jsonResponse({ok:false,code:'MORNING_MEETING_PURGE_QUERY_ACTIVE',
          message:'자료삭제 직전에 새 조회가 시작되었습니다. 조회가 끝난 뒤 다시 시도해 주세요.'},409);
      }
      throw error;
    }
    const deletedByType = requestTypeMap(results[1].results);
    const deleteResult = results[2];
    const tombstoneChanges = Number(results[3].meta?.changes || 0);
    const tombstoneRow = results[4].results?.[0] || null;
    const remaining = results[5].results?.[0];
    if (tombstoneChanges !== 1 || Number(tombstoneRow?.reset_active || 0) !== 1) {
      return jsonResponse({
        ok: false,
        code: 'MORNING_MEETING_PURGE_TOMBSTONE_CONFLICT',
        message: '선택일 자료삭제 상태를 확정하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.'
      }, 409);
    }
    return jsonResponse({
      ok: true,
      targetDate,
      deletedRows: Number(deleteResult?.meta?.changes || 0),
      deletedByType,
      remainingRows: Number(remaining?.row_count || 0),
      overrideChanges: tombstoneChanges,
      resetActive: true,
      revision: Number(tombstoneRow?.revision || (serverRevision + 1)),
      resetAt: normalizeText(tombstoneRow?.reset_at),
      message: `${targetDate} 오전회의자료 및 자동적산 저장자료를 삭제했습니다.`
    });
  } catch (error) {
    console.error("Morning meeting reset-delete failed", error);
    return jsonResponse({
      ok: false,
      message: "오전회의 자료삭제 중 서버 오류가 발생했습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요."
    }, 500);
  }
}
