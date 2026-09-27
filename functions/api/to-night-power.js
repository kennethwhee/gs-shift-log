/* TO night-duty daily electricity. All four values are kWh, not kW/MWh.
 * Separate additive tables; no writes to shift logs, OIS results or closing data.
 * Duty ownership is checked against the saved NS/TO shift log, not a client role.
 */
const FIELDS = Object.freeze(['generatorEcmsGen1', 'ismartReception', 'epowerTransmission', 'solarDailyGeneration']);
const TABLE = 'to_night_power_daily';
const AUDIT = 'to_night_power_audit';
const MAX_VALUE = 1e12;
const response = (body, status = 200) => Response.json(body, {status, headers: {
  'Cache-Control': 'no-store, no-cache, must-revalidate', 'X-Content-Type-Options': 'nosniff'
}});
class InputError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') { super(message); this.status = status; this.code = code; }
}
const validDate = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validValues = value => isObject(value) && Object.keys(value).length === FIELDS.length &&
  FIELDS.every(key => Object.hasOwn(value, key) && typeof value[key] === 'number' &&
    Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= MAX_VALUE);
const validRevision = value => Number.isSafeInteger(value) && value >= 0;

async function authenticate(context) {
  if (!context?.env?.DB) throw new InputError('서버 DB 연결을 확인해 주세요.', 500, 'DATABASE_UNAVAILABLE');
  const match = (context.request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new InputError('로그인이 필요합니다.', 401, 'LOGIN_REQUIRED');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1]));
  const tokenHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const user = await context.env.DB.prepare(`SELECT session.employee_no, session.expires_at,
    user.name, user.role, user.is_active FROM shift_log_sessions AS session
    INNER JOIN users AS user ON user.employee_no = session.employee_no
    WHERE session.token_hash = ? LIMIT 1`).bind(tokenHash).first();
  if (!user || Number(user.is_active) !== 1 || !Number.isFinite(Date.parse(user.expires_at)) ||
      Date.parse(user.expires_at) <= Date.now()) {
    throw new InputError('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.', 401, 'SESSION_EXPIRED');
  }
  // No admin/super-admin exception: only the saved NS/TO author may write.
  return {...user, employee_no: String(user.employee_no).trim(), tokenHash};
}
async function latestDuty(db, date) {
  return db.prepare(`SELECT id, author, author_id, revision FROM shift_logs
    WHERE work_date = ? AND shift = 'NS' AND role = 'TO'
    ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1`).bind(date).first();
}
function ownsDuty(user, duty) { return Boolean(duty && String(duty.author_id || '').trim() === user.employee_no); }
function publicDuty(duty) {
  return duty ? {id: String(duty.id), revision: Number(duty.revision), author: String(duty.author || '')} : null;
}
function itemFromRow(row, date) {
  if (!row) return null;
  const values = JSON.parse(row.values_json);
  if (row.target_date !== date || !validValues(values) || !validRevision(row.revision) || row.revision < 1) {
    throw new Error('Invalid stored TO power record');
  }
  return {targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh', values, revision: row.revision,
    sourceLogId: row.source_log_id, updatedBy: row.updated_by_name, updatedAt: row.updated_at};
}
async function tableExists(db) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(TABLE).first());
}
async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      target_date TEXT PRIMARY KEY, values_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1), source_log_id TEXT NOT NULL,
      source_log_revision INTEGER NOT NULL, created_by_id TEXT NOT NULL, created_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_by_id TEXT NOT NULL, updated_by_name TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${AUDIT} (
      target_date TEXT NOT NULL, revision INTEGER NOT NULL, values_json TEXT NOT NULL,
      source_log_id TEXT NOT NULL, source_log_revision INTEGER NOT NULL,
      updated_by_id TEXT NOT NULL, updated_by_name TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (target_date, revision)
    )`)
  ]);
}
function handleError(error) {
  if (error instanceof InputError) return response({ok: false, code: error.code, message: error.message}, error.status);
  console.error('[to-night-power]', error?.name || 'Error', error?.message || 'Database error');
  return response({ok: false, code: 'POWER_SERVER_ERROR', message: '전력 자료를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'}, 500);
}
export async function onRequestGet(context) {
  try {
    const user = await authenticate(context), db = context.env.DB;
    const date = new URL(context.request.url).searchParams.get('date');
    if (!validDate(date)) throw new InputError('올바른 실적 기준일을 선택해 주세요.');
    const duty = await latestDuty(db, date);
    const row = await tableExists(db) ? await db.prepare(`SELECT * FROM ${TABLE} WHERE target_date = ?`).bind(date).first() : null;
    return response({ok: true, targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh',
      canEdit: ownsDuty(user, duty), sourceLog: publicDuty(duty), item: itemFromRow(row, date)});
  } catch (error) { return handleError(error); }
}
export async function onRequestPost(context) {
  try {
    const user = await authenticate(context), db = context.env.DB;
    const origin = context.request.headers.get('Origin');
    if (origin && origin !== new URL(context.request.url).origin) throw new InputError('같은 사이트에서 입력해 주세요.', 403);
    if (!(context.request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
      throw new InputError('JSON 입력 형식이 필요합니다.', 415);
    }
    const text = await context.request.text();
    if (new TextEncoder().encode(text).byteLength > 8192) throw new InputError('입력 내용이 너무 큽니다.', 413);
    let body;
    try { body = JSON.parse(text); } catch { throw new InputError('입력 내용을 읽지 못했습니다.'); }
    const allowed = ['targetDate', 'shift', 'role', 'values', 'expectedRevision', 'sourceLogId', 'sourceLogRevision'];
    if (!isObject(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new InputError('허용되지 않은 입력 항목입니다.');
    if (body.shift !== 'NS' || body.role !== 'TO') throw new InputError('야간(N/S) TO 담당자만 입력할 수 있습니다.', 403, 'NIGHT_TO_ONLY');
    if (!validDate(body.targetDate)) throw new InputError('실적 기준일을 확인해 주세요.');
    if (!validValues(body.values)) throw new InputError('네 항목을 모두 0 이상인 kWh 숫자로 입력해 주세요.');
    if (!validRevision(body.expectedRevision) || !validRevision(body.sourceLogRevision) ||
        body.sourceLogRevision < 1 || typeof body.sourceLogId !== 'string' || !body.sourceLogId) {
      throw new InputError('자료 버전을 확인해 주세요. 입력창을 다시 열어 주세요.');
    }
    const date = body.targetDate, duty = await latestDuty(db, date);
    if (!ownsDuty(user, duty)) throw new InputError('해당 날짜 N/S TO 업무일지를 저장한 담당자만 입력·수정할 수 있습니다.', 403, 'DUTY_AUTHOR_REQUIRED');
    if (String(duty.id) !== body.sourceLogId || Number(duty.revision) !== body.sourceLogRevision) {
      throw new InputError('TO 업무일지가 변경되었습니다. 입력값을 확인한 뒤 저장자료를 다시 불러와 주세요.', 409, 'DUTY_CHANGED');
    }
    const exists = await tableExists(db);
    const previous = exists ? await db.prepare(`SELECT revision FROM ${TABLE} WHERE target_date = ?`).bind(date).first() : null;
    if (Number(previous?.revision || 0) !== body.expectedRevision) {
      throw new InputError('다른 입력으로 자료가 변경되었습니다. 현재 입력값을 보관한 뒤 저장자료를 다시 불러와 주세요.', 409, 'POWER_REVISION_CONFLICT');
    }
    await ensureSchema(db);
    const now = new Date().toISOString(), json = JSON.stringify(Object.fromEntries(FIELDS.map(key => [key, body.values[key]])));
    // Recheck the author, source log revision, session, and power revision IN the
    // write transaction. Invalid JSON deliberately aborts/rolls back the batch.
    const guard = db.prepare(`SELECT json(CASE WHEN
      EXISTS (SELECT 1 FROM shift_logs WHERE id = ? AND author_id = ? AND revision = ?
        AND work_date = ? AND shift = 'NS' AND role = 'TO'
        AND id = (SELECT id FROM shift_logs WHERE work_date = ? AND shift = 'NS' AND role = 'TO'
          ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1))
      AND COALESCE((SELECT revision FROM ${TABLE} WHERE target_date = ?), 0) = ?
      AND EXISTS (SELECT 1 FROM shift_log_sessions AS s INNER JOIN users AS u ON u.employee_no = s.employee_no
        WHERE s.token_hash = ? AND s.employee_no = ? AND u.is_active = 1 AND julianday(s.expires_at) > julianday(?))
      THEN 'true' ELSE 'TO_POWER_CONFLICT' END) AS allowed`)
      .bind(String(duty.id), user.employee_no, Number(duty.revision), date, date, date, body.expectedRevision,
        user.tokenHash, user.employee_no, now);
    const upsert = db.prepare(`INSERT INTO ${TABLE}
      (target_date, values_json, revision, source_log_id, source_log_revision,
       created_by_id, created_by_name, created_at, updated_by_id, updated_by_name, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_date) DO UPDATE SET values_json = excluded.values_json,
        revision = ${TABLE}.revision + 1, source_log_id = excluded.source_log_id,
        source_log_revision = excluded.source_log_revision, updated_by_id = excluded.updated_by_id,
        updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at`)
      .bind(date, json, String(duty.id), Number(duty.revision), user.employee_no, String(user.name || ''), now,
        user.employee_no, String(user.name || ''), now);
    const audit = db.prepare(`INSERT INTO ${AUDIT}
      (target_date, revision, values_json, source_log_id, source_log_revision, updated_by_id, updated_by_name, updated_at)
      SELECT target_date, revision, values_json, source_log_id, source_log_revision, updated_by_id, updated_by_name, updated_at
      FROM ${TABLE} WHERE target_date = ?`).bind(date);
    let results;
    try { results = await db.batch([guard, upsert, audit, db.prepare(`SELECT * FROM ${TABLE} WHERE target_date = ?`).bind(date)]); }
    catch (error) {
      if (/malformed JSON/i.test(String(error?.message || '') + ' ' + String(error?.cause?.message || ''))) {
        throw new InputError('근무 담당자 또는 저장자료가 변경되었습니다. 입력값을 보관한 뒤 저장자료를 다시 불러와 주세요.', 409, 'POWER_WRITE_CONFLICT');
      }
      throw error;
    }
    const item = itemFromRow(results[3]?.results?.[0], date);
    if (!item) throw new Error('Saved power record missing');
    return response({ok: true, targetDate: date, shift: 'NS', role: 'TO', unit: 'kWh', canEdit: true,
      sourceLog: publicDuty(duty), item});
  } catch (error) { return handleError(error); }
}
