"use strict";

const TABLE = "morning_meeting_boiler_snapshots";
const MAX_ABS_TEMPERATURE = 2000;

const response = (body, status = 200) => Response.json(body, {
  status,
  headers: {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff"
  }
});

class InputError extends Error {
  constructor(message, status = 400, code = "INVALID_INPUT") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const text = value => String(value ?? "").trim();
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validDate = value => typeof value === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

async function authenticate(context) {
  if (!context?.env?.DB) throw new InputError("서버 DB 연결을 확인해 주세요.", 500, "DATABASE_UNAVAILABLE");
  const match = (context.request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new InputError("로그인이 필요합니다.", 401, "LOGIN_REQUIRED");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(match[1]));
  const tokenHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const user = await context.env.DB.prepare(`SELECT session.employee_no, session.expires_at,
    user.name, user.role, user.is_active
    FROM shift_log_sessions AS session
    INNER JOIN users AS user ON user.employee_no = session.employee_no
    WHERE session.token_hash = ? LIMIT 1`).bind(tokenHash).first();
  if (!user || Number(user.is_active) !== 1 || !Number.isFinite(Date.parse(user.expires_at)) ||
      Date.parse(user.expires_at) <= Date.now()) {
    throw new InputError("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.", 401, "SESSION_EXPIRED");
  }
  return {employeeNo: text(user.employee_no), name: text(user.name), role: text(user.role)};
}

async function tableExists(db) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(TABLE).first());
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    target_date TEXT PRIMARY KEY,
    values_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
}

function normalizeTemperature(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_ABS_TEMPERATURE) {
    throw new InputError("BO1·BO2 온도값을 확인해 주세요.");
  }
  return value;
}

function normalizeUnit(raw, role, label) {
  if (!isObject(raw)) throw new InputError(`${label} 온도값을 확인해 주세요.`);
  if (!isObject(raw.wallScrew)) throw new InputError(`${label} Wall 온도값을 확인해 주세요.`);
  return {
    role,
    label,
    fbheLeft: normalizeTemperature(raw.fbheLeft),
    fbheRight: normalizeTemperature(raw.fbheRight),
    wallScrew: {
      A: normalizeTemperature(raw.wallScrew.A),
      B: normalizeTemperature(raw.wallScrew.B),
      C: normalizeTemperature(raw.wallScrew.C),
      D: normalizeTemperature(raw.wallScrew.D)
    }
  };
}

function normalizeValues(raw, targetDate) {
  if (!isObject(raw)) throw new InputError("BO1·BO2 온도 저장값 형식을 확인해 주세요.");
  const reportDate = validDate(text(raw.reportDate)) ? text(raw.reportDate) : targetDate;
  return {
    snapshotTargetDate: targetDate,
    reportDate,
    sourceShift: text(raw.sourceShift) || "NS",
    unitOne: normalizeUnit(raw.unitOne, "BO1", "1호기"),
    unitTwo: normalizeUnit(raw.unitTwo, "BO2", "2호기"),
    missing: [],
    complete: true,
    userEdited: raw.userEdited === true,
    lastEditedAt: text(raw.lastEditedAt),
    savedToD1At: new Date().toISOString()
  };
}

function parseValues(row) {
  if (!row) return null;
  let parsed;
  try { parsed = JSON.parse(row.values_json || "{}"); }
  catch { throw new Error("Invalid boiler snapshot JSON"); }
  return normalizeValues(parsed, text(row.target_date));
}

function publicItem(row) {
  if (!row) return null;
  return {
    targetDate: text(row.target_date),
    revision: Number(row.revision || 0),
    values: parseValues(row),
    updatedBy: text(row.updated_by_name),
    updatedAt: text(row.updated_at)
  };
}

function sameOrigin(context) {
  const origin = context.request.headers.get("Origin");
  return !origin || origin === new URL(context.request.url).origin;
}

async function readJsonBody(context) {
  if (!(context.request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    throw new InputError("JSON 입력 형식이 필요합니다.", 415);
  }
  const raw = await context.request.text();
  if (new TextEncoder().encode(raw).byteLength > 16384) throw new InputError("입력 내용이 너무 큽니다.", 413);
  try { return JSON.parse(raw); }
  catch { throw new InputError("입력 내용을 읽지 못했습니다."); }
}

function handleError(error) {
  if (error instanceof InputError) {
    return response({ok: false, code: error.code, message: error.message}, error.status);
  }
  console.error("[morning-meeting-boiler-snapshot]", error?.name || "Error", error?.message || error);
  return response({ok: false, code: "BOILER_SNAPSHOT_SERVER_ERROR",
    message: "BO1·BO2 온도 Snapshot을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."}, 500);
}

export async function onRequestGet(context) {
  try {
    await authenticate(context);
    const date = text(new URL(context.request.url).searchParams.get("date"));
    if (!validDate(date)) throw new InputError("오전회의 기준일을 확인해 주세요.");
    const db = context.env.DB;
    if (!await tableExists(db)) return response({ok: true, targetDate: date, item: null});
    const row = await db.prepare(`SELECT target_date, values_json, revision, updated_by_name, updated_at
      FROM ${TABLE} WHERE target_date = ? LIMIT 1`).bind(date).first();
    return response({ok: true, targetDate: date, item: publicItem(row)});
  } catch (error) { return handleError(error); }
}

export async function onRequestPost(context) {
  try {
    const user = await authenticate(context);
    if (!sameOrigin(context)) throw new InputError("동일한 사이트에서 저장해 주세요.", 403, "ORIGIN_REQUIRED");
    const body = await readJsonBody(context);
    if (!isObject(body)) throw new InputError("BO1·BO2 온도 저장 요청 형식을 확인해 주세요.");
    const allowed = new Set(["targetDate", "values"]);
    if (Object.keys(body).some(key => !allowed.has(key))) throw new InputError("허용되지 않은 저장 항목이 포함되어 있습니다.");
    const date = text(body.targetDate);
    if (!validDate(date)) throw new InputError("오전회의 기준일을 확인해 주세요.");
    const values = normalizeValues(body.values, date);
    const db = context.env.DB;
    await ensureSchema(db);
    const now = new Date().toISOString();
    const json = JSON.stringify(values);
    await db.prepare(`INSERT INTO ${TABLE}
      (target_date, values_json, revision, updated_by_id, updated_by_name, updated_at)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(target_date) DO UPDATE SET
        values_json = excluded.values_json,
        revision = revision + 1,
        updated_by_id = excluded.updated_by_id,
        updated_by_name = excluded.updated_by_name,
        updated_at = excluded.updated_at`)
      .bind(date, json, user.employeeNo, user.name, now).run();
    const row = await db.prepare(`SELECT target_date, values_json, revision, updated_by_name, updated_at
      FROM ${TABLE} WHERE target_date = ? LIMIT 1`).bind(date).first();
    return response({ok: true, targetDate: date, item: publicItem(row)});
  } catch (error) { return handleError(error); }
}
