"use strict";

const TABLE = "morning_meeting_card_overrides";
const AUDIT = "morning_meeting_card_overrides_audit";
const RESET_TABLE = "morning_meeting_auto_history_overrides";
const MAX_VALUE = 1e12;

const CARD_FIELDS = Object.freeze({
  power: Object.freeze([
    "generatorEcmsGen1",
    "ismartReception",
    "epowerTransmission",
    "solarDailyGeneration",
    "solarMonthlyCumulative",
    "solarYearlyCumulative"
  ]),
  steam: Object.freeze([
    "steamSalesLowPressure",
    "steamSalesHighPressure",
    "steamSales",
    "unitOneProduction",
    "unitTwoProduction",
    "totalProduction"
  ]),
  organic: Object.freeze([
    "sludgeTotal",
    "sludgeTruckCount",
    "organicDaySilo",
    "organicStorageSiloA",
    "organicStorageSiloB",
    "organicSiloTotal"
  ])
});

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
const validRevision = value => Number.isSafeInteger(value) && value >= 0;

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
  return {
    employeeNo: text(user.employee_no),
    name: text(user.name),
    role: text(user.role)
  };
}

async function tableExists(db, name) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first());
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      target_date TEXT NOT NULL,
      card_key TEXT NOT NULL,
      values_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      created_by_id TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_by_id TEXT NOT NULL,
      updated_by_name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (target_date, card_key)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${AUDIT} (
      target_date TEXT NOT NULL,
      card_key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      values_json TEXT NOT NULL,
      is_active INTEGER NOT NULL CHECK (is_active IN (0,1)),
      action TEXT NOT NULL,
      updated_by_id TEXT NOT NULL,
      updated_by_name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (target_date, card_key, revision)
    )`)
  ]);
}

async function resetState(db, date) {
  if (!await tableExists(db, RESET_TABLE)) return {active: false, at: ""};
  const row = await db.prepare(`SELECT reset_active, reset_at FROM ${RESET_TABLE} WHERE target_date = ? LIMIT 1`)
    .bind(date).first();
  return {
    active: Number(row?.reset_active || 0) === 1,
    at: text(row?.reset_at)
  };
}

function normalizeCardKey(value) {
  const key = text(value).toLowerCase();
  if (!Object.hasOwn(CARD_FIELDS, key)) throw new InputError("수정할 오전회의 카드를 확인해 주세요.");
  return key;
}

function normalizeValues(cardKey, raw) {
  if (!isObject(raw)) throw new InputError("수정값 형식을 확인해 주세요.");
  const allowed = new Set(CARD_FIELDS[cardKey]);
  const keys = Object.keys(raw);
  if (!keys.length || keys.some(key => !allowed.has(key))) {
    throw new InputError("허용되지 않은 수정 항목이 포함되어 있습니다.");
  }
  const result = {};
  for (const key of keys) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_VALUE) {
      throw new InputError("수정값은 0 이상의 숫자로 입력해 주세요.");
    }
    if (cardKey === "organic" && key === "sludgeTruckCount" && !Number.isSafeInteger(value)) {
      throw new InputError("입고 건수는 0 이상의 정수로 입력해 주세요.");
    }
    result[key] = value;
  }
  return result;
}

function parseStoredValues(row, cardKey) {
  if (!row) return {};
  let value;
  try { value = JSON.parse(row.values_json || "{}"); }
  catch { throw new Error("Invalid Morning Meeting override JSON"); }
  if (!isObject(value)) throw new Error("Invalid Morning Meeting override values");
  const allowed = new Set(CARD_FIELDS[cardKey]);
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key) || typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > MAX_VALUE) {
      throw new Error("Invalid Morning Meeting override field");
    }
    result[key] = raw;
  }
  return result;
}

function publicItem(row, cardKey, reset) {
  if (!row) return {cardKey, revision: 0, active: false, staleByDelete: false, values: {}};
  const revision = Number(row.revision || 0);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid Morning Meeting override revision");
  const storedActive = Number(row.is_active || 0) === 1;
  const updatedAt = text(row.updated_at);
  const staleByDelete = Boolean(storedActive && reset.at && (!updatedAt || updatedAt <= reset.at));
  const active = storedActive && !reset.active && !staleByDelete;
  return {
    cardKey,
    revision,
    active,
    staleByDelete,
    values: active ? parseStoredValues(row, cardKey) : {},
    updatedBy: text(row.updated_by_name),
    updatedAt
  };
}

async function readRows(db, date) {
  if (!await tableExists(db, TABLE)) return [];
  const result = await db.prepare(`SELECT target_date, card_key, values_json, is_active, revision,
    updated_by_name, updated_at FROM ${TABLE} WHERE target_date = ? ORDER BY card_key ASC`)
    .bind(date).all();
  return Array.isArray(result.results) ? result.results : [];
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

async function currentRow(db, date, cardKey) {
  if (!await tableExists(db, TABLE)) return null;
  return await db.prepare(`SELECT * FROM ${TABLE} WHERE target_date = ? AND card_key = ? LIMIT 1`)
    .bind(date, cardKey).first();
}

async function appendAudit(db, date, cardKey, action) {
  await db.prepare(`INSERT OR REPLACE INTO ${AUDIT}
    (target_date, card_key, revision, values_json, is_active, action,
     updated_by_id, updated_by_name, updated_at)
    SELECT target_date, card_key, revision, values_json, is_active, ?,
      updated_by_id, updated_by_name, updated_at
    FROM ${TABLE} WHERE target_date = ? AND card_key = ?`)
    .bind(action, date, cardKey).run();
}

function handleError(error) {
  if (error instanceof InputError) {
    return response({ok: false, code: error.code, message: error.message}, error.status);
  }
  console.error("[morning-meeting-card-overrides]", error?.name || "Error", error?.message || error);
  return response({ok: false, code: "MORNING_CARD_OVERRIDE_SERVER_ERROR",
    message: "오전회의 카드 수정값을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."}, 500);
}

export async function onRequestGet(context) {
  try {
    await authenticate(context);
    const db = context.env.DB;
    const date = new URL(context.request.url).searchParams.get("date");
    if (!validDate(date)) throw new InputError("오전회의 기준일을 확인해 주세요.");
    const reset = await resetState(db, date);
    const rows = await readRows(db, date);
    const rowMap = new Map(rows.map(row => [text(row.card_key), row]));
    const items = {};
    for (const cardKey of Object.keys(CARD_FIELDS)) {
      items[cardKey] = publicItem(rowMap.get(cardKey) || null, cardKey, reset);
    }
    return response({ok: true, targetDate: date, resetActive: reset.active, resetAt: reset.at, items});
  } catch (error) { return handleError(error); }
}

export async function onRequestPost(context) {
  try {
    const user = await authenticate(context);
    if (!sameOrigin(context)) throw new InputError("동일한 사이트에서 수정해 주세요.", 403, "ORIGIN_REQUIRED");
    const body = await readJsonBody(context);
    if (!isObject(body)) throw new InputError("수정 요청 형식을 확인해 주세요.");
    const allowed = new Set(["targetDate", "cardKey", "values", "expectedRevision"]);
    if (Object.keys(body).some(key => !allowed.has(key))) throw new InputError("허용되지 않은 요청 항목입니다.");
    const date = text(body.targetDate);
    if (!validDate(date)) throw new InputError("오전회의 기준일을 확인해 주세요.");
    const cardKey = normalizeCardKey(body.cardKey);
    const values = normalizeValues(cardKey, body.values);
    if (!validRevision(body.expectedRevision)) throw new InputError("수정자료 버전을 확인해 주세요.");
    const db = context.env.DB;
    const reset = await resetState(db, date);
    if (reset.active) throw new InputError("자료삭제 상태에서는 카드 값을 수정할 수 없습니다. 전체조회 또는 새로 조회 후 수정해 주세요.", 409, "MORNING_CARD_DATE_DELETED");
    await ensureSchema(db);
    const previous = await currentRow(db, date, cardKey);
    const revision = previous ? Number(previous.revision || 0) : 0;
    if (revision !== body.expectedRevision) {
      throw new InputError("다른 사용자가 이 카드의 수정값을 변경했습니다. 최신 값을 불러온 뒤 다시 수정해 주세요.", 409, "MORNING_CARD_OVERRIDE_CONFLICT");
    }
    const now = new Date().toISOString();
    const json = JSON.stringify(values);
    let result;
    if (previous) {
      result = await db.prepare(`UPDATE ${TABLE} SET values_json = ?, is_active = 1,
        revision = revision + 1, updated_by_id = ?, updated_by_name = ?, updated_at = ?
        WHERE target_date = ? AND card_key = ? AND revision = ?`)
        .bind(json, user.employeeNo, user.name, now, date, cardKey, revision).run();
    } else {
      result = await db.prepare(`INSERT OR IGNORE INTO ${TABLE}
        (target_date, card_key, values_json, is_active, revision,
         created_by_id, created_by_name, created_at, updated_by_id, updated_by_name, updated_at)
        VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)`)
        .bind(date, cardKey, json, user.employeeNo, user.name, now,
          user.employeeNo, user.name, now).run();
    }
    if (Number(result?.meta?.changes || 0) !== 1) {
      throw new InputError("다른 사용자가 이 카드의 수정값을 변경했습니다. 최신 값을 불러온 뒤 다시 수정해 주세요.", 409, "MORNING_CARD_OVERRIDE_CONFLICT");
    }
    await appendAudit(db, date, cardKey, "save");
    const row = await currentRow(db, date, cardKey);
    return response({ok: true, targetDate: date, item: publicItem(row, cardKey, await resetState(db, date))});
  } catch (error) { return handleError(error); }
}

export async function onRequestDelete(context) {
  try {
    const user = await authenticate(context);
    if (!sameOrigin(context)) throw new InputError("동일한 사이트에서 원본 복원을 실행해 주세요.", 403, "ORIGIN_REQUIRED");
    const body = await readJsonBody(context);
    if (!isObject(body)) throw new InputError("원본 복원 요청 형식을 확인해 주세요.");
    const allowed = new Set(["targetDate", "cardKey", "expectedRevision"]);
    if (Object.keys(body).some(key => !allowed.has(key))) throw new InputError("허용되지 않은 요청 항목입니다.");
    const date = text(body.targetDate);
    if (!validDate(date)) throw new InputError("오전회의 기준일을 확인해 주세요.");
    const cardKey = normalizeCardKey(body.cardKey);
    if (!validRevision(body.expectedRevision)) throw new InputError("수정자료 버전을 확인해 주세요.");
    const db = context.env.DB;
    const reset = await resetState(db, date);
    if (reset.active) throw new InputError("자료삭제 상태에서는 원본 복원을 실행할 수 없습니다.", 409, "MORNING_CARD_DATE_DELETED");
    const exists = await tableExists(db, TABLE);
    if (!exists) {
      if (body.expectedRevision !== 0) throw new InputError("수정자료가 변경되었습니다. 다시 확인해 주세요.", 409, "MORNING_CARD_OVERRIDE_CONFLICT");
      return response({ok: true, targetDate: date, item: {cardKey, revision: 0, active: false, staleByDelete: false, values: {}}});
    }
    const previous = await currentRow(db, date, cardKey);
    const revision = previous ? Number(previous.revision || 0) : 0;
    if (revision !== body.expectedRevision) {
      throw new InputError("다른 사용자가 이 카드의 수정값을 변경했습니다. 최신 값을 불러온 뒤 다시 원본 복원해 주세요.", 409, "MORNING_CARD_OVERRIDE_CONFLICT");
    }
    if (!previous) {
      return response({ok: true, targetDate: date, item: {cardKey, revision: 0, active: false, staleByDelete: false, values: {}}});
    }
    const now = new Date().toISOString();
    const result = await db.prepare(`UPDATE ${TABLE} SET values_json = '{}', is_active = 0,
      revision = revision + 1, updated_by_id = ?, updated_by_name = ?, updated_at = ?
      WHERE target_date = ? AND card_key = ? AND revision = ?`)
      .bind(user.employeeNo, user.name, now, date, cardKey, revision).run();
    if (Number(result?.meta?.changes || 0) !== 1) {
      throw new InputError("다른 사용자가 이 카드의 수정값을 변경했습니다. 최신 값을 불러온 뒤 다시 원본 복원해 주세요.", 409, "MORNING_CARD_OVERRIDE_CONFLICT");
    }
    await appendAudit(db, date, cardKey, "restore");
    const row = await currentRow(db, date, cardKey);
    return response({ok: true, targetDate: date, item: publicItem(row, cardKey, await resetState(db, date))});
  } catch (error) { return handleError(error); }
}
