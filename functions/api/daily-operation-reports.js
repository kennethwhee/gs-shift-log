"use strict";

/* Independent daily-operation snapshots. Existing source tables are read-only.
 * A deleted day retains its monotonically increasing version, preventing an
 * old editor (including one opened before the first save) from recreating it.
 * The efficiency-team menu's existing policy allows every active login to edit.
 */
const TABLE = "daily_operation_reports_v1";
const SCHEMA_VERSION = 1;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_FIELDS = 200;
const encoder = new TextEncoder();
// Recheck login in the write statement itself, including requests whose body
// took time to arrive or whose account was revoked after the initial lookup.
const ACTIVE_SESSION_SQL = `EXISTS (
  SELECT 1 FROM shift_log_sessions AS session
  INNER JOIN users AS user ON user.employee_no = session.employee_no
  WHERE session.token_hash = ? AND session.employee_no = ?
    AND user.is_active = 1 AND julianday(session.expires_at) > julianday('now')
)`;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const dateValid = value => typeof value === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

class InputError extends Error {
  constructor(message, status = 400, code = "INVALID_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const response = (body, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "X-Content-Type-Options": "nosniff" }
});

function fail(message, code = "INVALID_REQUEST") { throw new InputError(message, 400, code); }
function onlyKeys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    fail(`${label} 형식을 확인해 주세요.`);
  }
}
function validDate(value, label = "작성일") {
  if (!dateValid(value)) fail(`${label}을 올바르게 선택해 주세요.`, "INVALID_WORK_DATE");
  return value;
}
function limitedText(value, limit, label, fallback = "") {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > limit || /\u0000/.test(value)) {
    fail(`${label}은(는) ${limit}자 이내의 문자열이어야 합니다.`, "INVALID_TEXT");
  }
  return value;
}
function expectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    fail("저장 버전을 확인해 주세요. 날짜를 다시 불러온 뒤 저장해 주세요.", "INVALID_VERSION");
  }
  return value;
}

async function authenticate(context) {
  if (!context?.env?.DB) throw new InputError("서버 DB 연결을 확인해 주세요.", 503, "DATABASE_UNAVAILABLE");
  const match = (context.request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i);
  if (!match || match[1].length > 4096) throw new InputError("로그인이 필요합니다.", 401, "LOGIN_REQUIRED");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(match[1])))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  const user = await context.env.DB.prepare(`SELECT s.employee_no, s.expires_at, u.name, u.is_active
    FROM shift_log_sessions AS s INNER JOIN users AS u ON u.employee_no = s.employee_no
    WHERE s.token_hash = ? LIMIT 1`).bind(hash).first();
  const expiry = Date.parse(user?.expires_at || "");
  if (!user || Number(user.is_active) !== 1 || !Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new InputError("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.", 401, "SESSION_EXPIRED");
  }
  // No session updates or deletions here: this feature only writes its own table.
  return { id: String(user.employee_no), name: String(user.name || user.employee_no), tokenHash: hash };
}

async function tableExists(db) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(TABLE).first());
}
async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    work_date TEXT PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    values_json TEXT NOT NULL DEFAULT '{}',
    sources_json TEXT NOT NULL DEFAULT '{}',
    note TEXT NOT NULL DEFAULT '',
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`).run();
}

async function readBody(request) {
  const origin = request.headers.get("Origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new InputError("동일한 사이트에서 저장해 주세요.", 403, "ORIGIN_REQUIRED");
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
    throw new InputError("JSON 입력 형식이 필요합니다.", 415, "JSON_REQUIRED");
  }
  const reader = request.body?.getReader();
  if (!reader) fail("요청 내용을 입력해 주세요.");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InputError("저장 내용이 너무 큽니다.", 413, "REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!object(result)) fail("저장 요청 형식을 확인해 주세요.");
    return result;
  } catch (error) {
    if (error instanceof InputError) throw error;
    fail("저장 요청 형식을 확인해 주세요.");
  } finally { reader.releaseLock(); }
}

function normalizeContent(body, workDate) {
  if ((body.schemaVersion ?? SCHEMA_VERSION) !== SCHEMA_VERSION) {
    fail("지원하지 않는 문서 양식 버전입니다.", "INVALID_SCHEMA_VERSION");
  }
  if (!object(body.values) || Object.keys(body.values).length > MAX_FIELDS) fail("수치 입력 항목을 확인해 주세요.", "INVALID_VALUES");
  const values = {};
  for (const [key, value] of Object.entries(body.values)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(key) || ["constructor", "prototype"].includes(key)) {
      fail("알 수 없는 수치 항목입니다.", "INVALID_FIELD");
    }
    if (value !== null && !(typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e15) &&
        !(typeof value === "string" && value.length <= 2000 && !/\u0000/.test(value))) {
      fail("수치는 유한한 숫자, 문자열 또는 빈 값이어야 합니다.", "INVALID_VALUES");
    }
    values[key] = value;
  }
  const rawSources = body.sources ?? {};
  if (!object(rawSources) || Object.keys(rawSources).length > MAX_FIELDS) fail("출처 형식을 확인해 주세요.", "INVALID_SOURCES");
  const sources = {};
  for (const [key, raw] of Object.entries(rawSources)) {
    if (!own(values, key)) fail("수치가 없는 항목에 출처를 저장할 수 없습니다.", "INVALID_SOURCES");
    onlyKeys(raw, ["source", "label", "date", "sourceDate", "requestId", "updatedAt", "note"], "출처");
    const source = limitedText(raw.source, 80, "출처").trim();
    if (!source) fail("항목별 출처를 확인해 주세요.", "INVALID_SOURCES");
    const normalized = { source };
    for (const [field, limit] of [["label", 200], ["requestId", 160], ["note", 2000]]) {
      if (own(raw, field)) normalized[field] = limitedText(raw[field], limit, "출처 정보");
    }
    for (const field of ["date", "sourceDate"]) {
      if (own(raw, field)) normalized[field] = validDate(raw[field], "출처 날짜");
    }
    if (own(normalized, "date") && normalized.date !== workDate) {
      fail("출처의 작성일이 선택 날짜와 다릅니다.", "SOURCE_DATE_MISMATCH");
    }
    if (own(raw, "updatedAt")) {
      const updatedAt = limitedText(raw.updatedAt, 40, "출처 시각");
      if (!/^\d{4}-\d{2}-\d{2}T/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) {
        fail("출처 시각을 확인해 주세요.", "INVALID_SOURCES");
      }
      normalized.updatedAt = updatedAt;
    }
    sources[key] = normalized;
  }
  return { values, sources, note: limitedText(body.note, 10000, "비고") };
}

function publicItem(row, metadataOnly = false) {
  if (!row || row.deleted_at) return null;
  const values = JSON.parse(row.values_json);
  const sources = JSON.parse(row.sources_json);
  if (!object(values) || !object(sources)) throw new Error("Invalid saved daily-operation report");
  const item = {
    workDate: row.work_date, version: Number(row.version), schemaVersion: Number(row.schema_version),
    authorId: row.author_id, authorName: row.author_name, createdAt: row.created_at,
    updatedById: row.updated_by_id, updatedByName: row.updated_by_name, updatedAt: row.updated_at
  };
  if (metadataOnly) {
    return { ...item, notePreview: row.note.slice(0, 100),
      filledCount: Object.values(values).filter(value => value !== null && value !== "").length };
  }
  return { ...item, values, sources, note: row.note };
}
async function findRow(db, date) {
  return db.prepare(`SELECT * FROM ${TABLE} WHERE work_date = ? LIMIT 1`).bind(date).first();
}
function versionState(row) {
  return { version: Number(row?.version || 0), deleted: Boolean(row?.deleted_at), item: publicItem(row) };
}
async function conflict(db, workDate) {
  const row = await findRow(db, workDate);
  const state = versionState(row);
  return response({ ok: false, code: "VERSION_CONFLICT", workDate,
    message: "다른 사용자가 저장하거나 삭제한 기록입니다. 최신 기록을 불러온 뒤 다시 시도해 주세요.",
    currentVersion: state.version, ...state }, 409);
}
function handleError(error) {
  if (error instanceof InputError) return response({ ok: false, code: error.code, message: error.message }, error.status);
  console.error("[daily-operation-reports]", error?.name || "Error");
  return response({ ok: false, code: "SERVER_ERROR", message: "일일운전현황을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500);
}

export async function onRequestGet(context) {
  try {
    await authenticate(context);
    const query = new URL(context.request.url).searchParams;
    const db = context.env.DB;
    if (query.has("date")) {
      const workDate = validDate(query.get("date"));
      const row = await tableExists(db) ? await findRow(db, workDate) : null;
      return response({ ok: true, workDate, ...versionState(row) });
    }
    const month = query.get("month");
    if (month !== null && (!/^20\d{2}-\d{2}$/.test(month) || !dateValid(month + "-01"))) {
      fail("조회 월을 확인해 주세요.", "INVALID_MONTH");
    }
    const includeValues = query.get("includeValues") === "1";
    if (query.has("includeValues") && (!["0", "1"].includes(query.get("includeValues")) || (includeValues && !month))) {
      fail("상세 목록은 조회 월을 지정해 주세요.", "INVALID_QUERY");
    }
    const rawLimit = query.get("limit") ?? "100";
    if (!/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 200) fail("목록 개수는 1~200이어야 합니다.", "INVALID_LIMIT");
    const limit = Number(rawLimit);
    const before = query.has("before") ? validDate(query.get("before"), "목록 기준일") : null;
    if (!await tableExists(db)) return response({ ok: true, items: [], nextBefore: null });
    const conditions = ["deleted_at IS NULL"];
    const bindings = [];
    if (month) { conditions.push("work_date LIKE ?"); bindings.push(month + "-%"); }
    if (before) { conditions.push("work_date < ?"); bindings.push(before); }
    const { results = [] } = await db.prepare(`SELECT * FROM ${TABLE}
      WHERE ${conditions.join(" AND ")} ORDER BY work_date DESC LIMIT ?`).bind(...bindings, limit + 1).all();
    const items = results.slice(0, limit).map(row => publicItem(row, !includeValues));
    return response({ ok: true, items, nextBefore: results.length > limit ? items.at(-1).workDate : null });
  } catch (error) { return handleError(error); }
}

async function save(context, create) {
  try {
    const user = await authenticate(context);
    const body = await readBody(context.request);
    onlyKeys(body, ["workDate", "schemaVersion", "version", "values", "sources", "note"], "저장 요청");
    const workDate = validDate(body.workDate);
    const version = expectedVersion(body.version);
    if ((create && version !== 0) || (!create && version < 1)) fail("저장 방식과 버전이 맞지 않습니다.", "INVALID_VERSION");
    const content = normalizeContent(body, workDate);
    const db = context.env.DB;
    await ensureSchema(db);
    const now = new Date().toISOString();
    let result;
    if (create) {
      result = await db.prepare(`INSERT INTO ${TABLE}
        (work_date, version, schema_version, values_json, sources_json, note,
         author_id, author_name, created_at, updated_by_id, updated_by_name, updated_at, deleted_at)
        SELECT ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL WHERE ${ACTIVE_SESSION_SQL}
        ON CONFLICT(work_date) DO NOTHING RETURNING *`)
        .bind(workDate, JSON.stringify(content.values), JSON.stringify(content.sources), content.note,
          user.id, user.name, now, user.id, user.name, now, user.tokenHash, user.id).all();
    } else {
      result = await db.prepare(`UPDATE ${TABLE} SET
        version = version + 1, values_json = ?, sources_json = ?, note = ?,
        author_id = CASE WHEN deleted_at IS NOT NULL THEN ? ELSE author_id END,
        author_name = CASE WHEN deleted_at IS NOT NULL THEN ? ELSE author_name END,
        created_at = CASE WHEN deleted_at IS NOT NULL THEN ? ELSE created_at END,
        updated_by_id = ?, updated_by_name = ?, updated_at = ?, deleted_at = NULL
        WHERE work_date = ? AND version = ? AND ${ACTIVE_SESSION_SQL} RETURNING *`)
        .bind(JSON.stringify(content.values), JSON.stringify(content.sources), content.note,
          user.id, user.name, now, user.id, user.name, now, workDate, version, user.tokenHash, user.id).all();
    }
    const row = result.results?.[0];
    if (!row) { await authenticate(context); return await conflict(db, workDate); }
    return response({ ok: true, workDate, created: create, ...versionState(row) });
  } catch (error) { return handleError(error); }
}

export async function onRequestPost(context) { return save(context, true); }
export async function onRequestPut(context) { return save(context, false); }

export async function onRequestDelete(context) {
  try {
    const user = await authenticate(context);
    const body = await readBody(context.request);
    onlyKeys(body, ["workDate", "version"], "삭제 요청");
    const workDate = validDate(body.workDate);
    const version = expectedVersion(body.version);
    if (version < 1) fail("삭제할 저장 기록이 없습니다.", "INVALID_VERSION");
    const db = context.env.DB;
    if (!await tableExists(db)) return response({ ok: false, code: "VERSION_CONFLICT", workDate,
      message: "삭제할 기록이 없습니다. 날짜를 다시 불러와 주세요.", currentVersion: 0, version: 0, deleted: false, item: null }, 409);
    const now = new Date().toISOString();
    const result = await db.prepare(`UPDATE ${TABLE} SET version = version + 1,
      values_json = '{}', sources_json = '{}', note = '', deleted_at = ?,
      updated_by_id = ?, updated_by_name = ?, updated_at = ?
      WHERE work_date = ? AND version = ? AND deleted_at IS NULL AND ${ACTIVE_SESSION_SQL} RETURNING *`)
      .bind(now, user.id, user.name, now, workDate, version, user.tokenHash, user.id).all();
    const row = result.results?.[0];
    if (!row) { await authenticate(context); return await conflict(db, workDate); }
    return response({ ok: true, workDate, ...versionState(row) });
  } catch (error) { return handleError(error); }
}
