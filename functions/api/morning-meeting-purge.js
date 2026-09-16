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
      return jsonResponse({ ok: false, message: "초기화 요청 내용을 확인해 주세요." }, 400);
    }

    const targetDate = normalizeText(body.targetDate);
    if (!isValidIsoDate(targetDate)) {
      return jsonResponse({ ok: false, message: "초기화할 날짜를 확인해 주세요." }, 400);
    }
    if (
      body.confirmPermanentDelete !== true ||
      normalizeText(body.mode) !== "selected_date_reset_delete_v2"
    ) {
      return jsonResponse({
        ok: false,
        code: "PERMANENT_DELETE_CONFIRMATION_REQUIRED",
        message: "선택일 초기화 확인값이 없습니다. 화면의 [초기화] 버튼을 사용해 주세요."
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
    const expectedRevision = Number(body.expectedRevision);
    if (
      Number.isSafeInteger(expectedRevision) &&
      expectedRevision >= 0 &&
      expectedRevision !== serverRevision
    ) {
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
    const countResult = await database.prepare(`
      SELECT request_type, COUNT(*) AS row_count
      FROM ois_data_requests
      WHERE target_date = ?
        AND request_type IN (${marks})
      GROUP BY request_type
      ORDER BY request_type ASC
    `).bind(targetDate, ...PURGE_REQUEST_TYPES).all();
    const deletedByType = requestTypeMap(countResult.results);

    const deleteResult = await database.prepare(`
      DELETE FROM ois_data_requests
      WHERE target_date = ?
        AND request_type IN (${marks})
        AND NOT EXISTS (
          SELECT 1
          FROM ois_data_requests AS active
          WHERE active.target_date = ?
            AND active.request_type IN (${marks})
            AND active.status IN ('pending', 'processing')
            AND (active.expires_at IS NULL OR active.expires_at >= ?)
        )
    `).bind(
      targetDate,
      ...PURGE_REQUEST_TYPES,
      targetDate,
      ...PURGE_REQUEST_TYPES,
      now
    ).run();

    const afterDeleteActive = await activeRows(database, targetDate, now);
    if (afterDeleteActive.length > 0) {
      const activeRequestTypes = [...new Set(afterDeleteActive.map(row => normalizeText(row.request_type)).filter(Boolean))];
      return jsonResponse({
        ok: false,
        code: "MORNING_MEETING_PURGE_QUERY_ACTIVE",
        activeRequestTypes,
        message: "초기화와 동시에 새 조회가 시작되었습니다. 조회가 끝난 뒤 다시 초기화해 주세요."
      }, 409);
    }

    let overrideChanges = 0;
    let nextRevision = serverRevision;
    if (resetRow) {
      const user = authentication.user;
      const updateResult = await database.prepare(`
        UPDATE morning_meeting_auto_history_overrides
        SET
          values_json = '{}',
          reset_active = 0,
          reset_at = NULL,
          reset_by_id = '',
          reset_by_name = '',
          reset_snapshot_values_json = '{}',
          reset_restored_at = ?,
          updated_by_id = ?,
          updated_by_name = ?,
          updated_at = ?,
          revision = revision + 1
        WHERE target_date = ?
          AND revision = ?
      `).bind(
        now,
        user.employeeNo,
        user.name,
        now,
        targetDate,
        serverRevision
      ).run();
      overrideChanges = Number(updateResult?.meta?.changes || 0);
      if (overrideChanges !== 1) {
        return jsonResponse({
          ok: false,
          code: "MORNING_MEETING_PURGE_REVISION_CONFLICT",
          message: "선택일 조회자료는 삭제했지만 초기화 상태 정리에 충돌이 발생했습니다. 새로고침해 주세요."
        }, 409);
      }
      nextRevision = serverRevision + 1;
    }

    const remaining = await database.prepare(`
      SELECT COUNT(*) AS row_count
      FROM ois_data_requests
      WHERE target_date = ?
        AND request_type IN (${marks})
    `).bind(targetDate, ...PURGE_REQUEST_TYPES).first();

    return jsonResponse({
      ok: true,
      targetDate,
      deletedRows: Number(deleteResult?.meta?.changes || 0),
      deletedByType,
      remainingRows: Number(remaining?.row_count || 0),
      overrideChanges,
      resetActive: false,
      revision: nextRevision,
      message: `${targetDate} 오전회의 저장 조회자료를 삭제했습니다.`
    });
  } catch (error) {
    console.error("Morning meeting reset-delete failed", error);
    return jsonResponse({
      ok: false,
      message: error?.message || "오전회의 초기화 중 서버 오류가 발생했습니다."
    }, 500);
  }
}
