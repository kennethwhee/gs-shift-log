/* BLOWER_SCHEDULE_V1
 * A browser explicitly designated as the physical BCO1 PC may claim one KST
 * four-hour slot. Receipts survive logout, replacement and disable/re-enable.
 * This module never creates or changes a DataPARC request or a Blower result.
 */
const VERSION = 'blower-schedule-v1';
const PERIOD_MS = 4 * 60 * 60 * 1000;
const KST_MS = 9 * 60 * 60 * 1000;
const CLAIM_WINDOW_MS = 2 * 60 * 1000;
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;
const KEY = /^[a-f0-9]{64}$/;
const TERMINAL = ['complete', 'partial', 'failed', 'interrupted'];
const isKey = value => typeof value === 'string' && KEY.test(value);
const clockValue = value => typeof value === 'string' ? Date.parse(value) :
  value instanceof Date ? value.getTime() : Number(value);

function slotStart(now) {
  return Math.floor((now + KST_MS) / PERIOD_MS) * PERIOD_MS - KST_MS;
}
function slotSummary(row) {
  if (!row) return null;
  return {
    slotKey: row.slot_key, state: row.state, claimedAt: row.claimed_at,
    updatedAt: row.updated_at, targetCount: row.target_count,
    completedCount: row.completed_count, failedCount: row.failed_count
  };
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function changes(result) {
  return Number(result?.meta?.changes || 0);
}
function sameDevice(config, deviceHash) {
  return Boolean(deviceHash && config?.device_hash === deviceHash);
}
function owns(row, owner, deviceHash, runHash) {
  return Boolean(row && row.owner_id === owner && row.device_hash === deviceHash && row.run_hash === runHash);
}
async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS blower_schedule_config_v1 (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    device_hash TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0),
    registered_by TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS blower_schedule_slots_v1 (
    slot_key TEXT PRIMARY KEY, device_hash TEXT NOT NULL, owner_id TEXT NOT NULL,
    run_hash TEXT NOT NULL, config_revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running','complete','partial','failed','interrupted')),
    claimed_at TEXT NOT NULL, updated_at TEXT NOT NULL, batch_receipt TEXT,
    target_count INTEGER NOT NULL DEFAULT 0 CHECK (target_count BETWEEN 0 AND 1000),
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count BETWEEN 0 AND 1000),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count BETWEEN 0 AND 1000),
    CHECK (completed_count + failed_count <= target_count)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS blower_schedule_assertions_v1 (
    required INTEGER NOT NULL
  )`).run();
}
function loadConfig(db) {
  return db.prepare('SELECT * FROM blower_schedule_config_v1 WHERE singleton = 1').first();
}
function loadSlot(db, key) {
  return db.prepare('SELECT * FROM blower_schedule_slots_v1 WHERE slot_key = ?').bind(key).first();
}
function error(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}
function validMetadata(metadata) {
  return Boolean(metadata && typeof metadata === 'object' && !Array.isArray(metadata) &&
    Object.keys(metadata).length === 3 && ['deviceKey', 'runToken', 'slotKey'].every(key => Object.hasOwn(metadata, key)) &&
    isKey(metadata.deviceKey) && isKey(metadata.runToken) &&
    typeof metadata.slotKey === 'string' && Number.isFinite(Date.parse(metadata.slotKey)) &&
    new Date(metadata.slotKey).toISOString() === metadata.slotKey);
}
function receiptValue(receipt) {
  if (!receipt || receipt.version !== 1 || !Number.isSafeInteger(receipt.requestedCount) ||
      receipt.requestedCount < 0 || receipt.requestedCount > 24 || !Array.isArray(receipt.items) ||
      !Array.isArray(receipt.upToDateTags) || receipt.items.length + receipt.upToDateTags.length !== receipt.requestedCount) {
    throw error('invalid_batch_receipt', '자동조회 요청 기록이 올바르지 않습니다.', 400);
  }
  const tags = new Set(), ids = new Set();
  const tag = value => typeof value === 'string' && /^[A-Z0-9]{1,40}$/.test(value) && !tags.has(value) && Boolean(tags.add(value));
  const items = receipt.items.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(item.id) || ids.has(item.id) || !tag(item.assetTag)) {
      throw error('invalid_batch_receipt', '자동조회 요청 기록이 올바르지 않습니다.', 400);
    }
    ids.add(item.id);
    return { id: item.id, assetTag: item.assetTag };
  });
  const upToDateTags = receipt.upToDateTags.map(value => {
    if (!tag(value)) throw error('invalid_batch_receipt', '자동조회 요청 기록이 올바르지 않습니다.', 400);
    return value;
  });
  return { version: 1, requestedCount: receipt.requestedCount, items, upToDateTags };
}
function readReceipt(row) {
  return row?.batch_receipt ? receiptValue(JSON.parse(row.batch_receipt)) : null;
}

// The caller must append these statements to the SAME database.batch as all
// corresponding request inserts/reuses. A successful pre-read is not a lock.
export async function prepareScheduledBatch(database, user, metadata, now = Date.now()) {
  const owner = typeof user?.employeeNo === 'string' ? user.employeeNo.trim() : '';
  if (!owner || owner.length > 100) throw error('authentication_required', '로그인이 필요합니다.', 401);
  if (!validMetadata(metadata)) throw error('invalid_run', '자동조회 실행 정보가 올바르지 않습니다.', 400);
  await ensureSchema(database);
  const deviceHash = await digest(metadata.deviceKey), runHash = await digest(metadata.runToken);
  const config = await loadConfig(database), row = await loadSlot(database, metadata.slotKey);
  if (!config?.enabled || !sameDevice(config, deviceHash) || !owns(row, owner, deviceHash, runHash)) {
    throw error('run_not_owned', '이 로그인에서 시작한 자동조회가 아닙니다.', 403);
  }
  const clock = clockValue(now);
  const age = clock - Date.parse(row.claimed_at);
  if (!Number.isFinite(age) || age < 0 || age > CREATE_WINDOW_MS || row.state !== 'running' ||
      row.config_revision !== config.revision || row.batch_receipt !== null) {
    throw error('run_not_creatable', '이 자동조회에서 새 요청을 시작할 수 없습니다. 기존 요청 기록을 확인해 주세요.');
  }
  return Object.freeze({ slotKey: metadata.slotKey, deviceHash, runHash, owner,
    revision: config.revision, claimedAt: row.claimed_at });
}

export function scheduledBatchStatements(database, guard, receipt, now = Date.now()) {
  const value = JSON.stringify(receiptValue(receipt));
  const clock = clockValue(now);
  if (!Number.isFinite(clock)) throw error('invalid_clock', '자동조회 시각을 확인할 수 없습니다.');
  const timestamp = new Date(clock).toISOString();
  const earliestClaim = new Date(clock - CREATE_WINDOW_MS).toISOString();
  const predicate = `slot_key = ? AND owner_id = ? AND device_hash = ? AND run_hash = ?
    AND config_revision = ? AND state = 'running' AND batch_receipt IS NULL
    AND claimed_at = ? AND claimed_at >= ? AND claimed_at <= ?
    AND EXISTS (SELECT 1 FROM blower_schedule_config_v1 AS config WHERE singleton = 1
      AND enabled = 1 AND config.device_hash = blower_schedule_slots_v1.device_hash
      AND revision = blower_schedule_slots_v1.config_revision)`;
  const bindings = [guard.slotKey, guard.owner, guard.deviceHash, guard.runHash, guard.revision,
    guard.claimedAt, earliestClaim, timestamp];
  return [
    // Valid batches insert zero rows; an invalid guard violates NOT NULL and
    // aborts the entire transaction before any request or receipt mutation.
    database.prepare(`/* BLOWER_SCHEDULE_BATCH_CAS_V1 */
      INSERT INTO blower_schedule_assertions_v1 (required)
      SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM blower_schedule_slots_v1 WHERE ${predicate})`).bind(...bindings),
    database.prepare(`UPDATE blower_schedule_slots_v1 SET batch_receipt = ?, updated_at = ?
      WHERE ${predicate}`).bind(value, timestamp, ...bindings)
  ];
}

export function isScheduledBatchConflict(cause) {
  return /NOT NULL constraint failed:\s*blower_schedule_assertions_v1\.required/i.test(String(cause?.message || cause));
}
async function statusData(db, config, deviceHash, now) {
  const latest = await db.prepare('SELECT * FROM blower_schedule_slots_v1 ORDER BY slot_key DESC LIMIT 1').first();
  return {
    enabled: config?.enabled === 1, revision: config?.revision || 0,
    thisDevice: sameDevice(config, deviceHash),
    nextSlotAt: new Date(slotStart(now) + PERIOD_MS).toISOString(),
    latestSlot: slotSummary(latest)
  };
}

export async function handleBlowerSchedule(context, user, body) {
  const now = Date.now();
  const serverNow = new Date(now).toISOString();
  const reply = (data, status = 200) => new Response(JSON.stringify({ version: VERSION, serverNow, ...data }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  const fail = (code, message, status = 400) => reply({ ok: false, code, message }, status);
  const owner = typeof user?.employeeNo === 'string' ? user.employeeNo.trim() : '';
  if (!owner || owner.length > 100) return fail('authentication_required', '로그인이 필요합니다.', 401);
  if (String(context.request?.headers?.get('X-GS-Client-Mode') || '').trim().toLowerCase() === 'mobile-monitoring') {
    return fail('mobile_read_only', '자동조회 설정은 PC에서만 사용할 수 있습니다.', 403);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid_body', '요청 형식이 올바르지 않습니다.');
  const operation = body.operation;
  if (!['status', 'register', 'disable', 'claim', 'check', 'finish'].includes(operation)) {
    return fail('invalid_operation', '자동조회 작업이 올바르지 않습니다.');
  }
  if ((operation !== 'status' || body.deviceKey !== undefined) && !isKey(body.deviceKey)) {
    return fail('invalid_device_key', '이 PC의 자동조회 등록 정보가 올바르지 않습니다.');
  }
  if (['register', 'disable'].includes(operation) &&
      (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= Number.MAX_SAFE_INTEGER)) {
    return fail('invalid_revision', '자동조회 설정 버전을 다시 확인해 주세요.');
  }
  if (operation === 'register' && body.confirmedPhysicalBco1 !== true) {
    return fail('physical_bco1_confirmation_required', '현재 PC가 BCO1 컴퓨터인지 확인해 주세요.');
  }
  if (['claim', 'check', 'finish'].includes(operation) &&
      (!isKey(body.runToken) || typeof body.slotKey !== 'string' ||
       !Number.isFinite(Date.parse(body.slotKey)) || new Date(body.slotKey).toISOString() !== body.slotKey)) {
    return fail('invalid_run', '자동조회 실행 정보가 올바르지 않습니다.');
  }
  if (operation === 'check' && !['create', 'resume'].includes(body.purpose)) {
    return fail('invalid_purpose', '자동조회 확인 목적이 올바르지 않습니다.');
  }
  if (operation === 'finish') {
    const counts = [body.targetCount, body.completedCount, body.failedCount];
    if (!TERMINAL.includes(body.status) || counts.some(v => !Number.isSafeInteger(v) || v < 0 || v > 1000) ||
        body.completedCount + body.failedCount > body.targetCount ||
        (body.status === 'complete' && (body.completedCount !== body.targetCount || body.failedCount !== 0))) {
      return fail('invalid_result', '자동조회 완료 건수가 올바르지 않습니다.');
    }
  }

  try {
    const db = context.env?.DB;
    if (!db) return fail('storage_unavailable', '자동조회 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.', 503);
    const deviceHash = body.deviceKey ? await digest(body.deviceKey) : '';
    const runHash = body.runToken ? await digest(body.runToken) : '';
    await ensureSchema(db);
    let config = await loadConfig(db);
    if (operation === 'status') return reply({ ok: true, ...await statusData(db, config, deviceHash, now) });

    if (operation === 'register' || operation === 'disable') {
      if (operation === 'disable' && !sameDevice(config, deviceHash) && user.isSuperAdmin !== true) {
        return fail('device_not_designated', '등록된 BCO1 PC에서 자동조회를 해제해 주세요.', 403);
      }
      let result;
      if (operation === 'register' && body.expectedRevision === 0) {
        result = await db.prepare(`INSERT INTO blower_schedule_config_v1
          (singleton, enabled, device_hash, revision, registered_by, updated_at)
          VALUES (1, 1, ?, 1, ?, ?) ON CONFLICT(singleton) DO NOTHING`)
          .bind(deviceHash, owner, serverNow).run();
      } else if (operation === 'register') {
        result = await db.prepare(`UPDATE blower_schedule_config_v1 SET enabled = 1, device_hash = ?,
          revision = revision + 1, registered_by = ?, updated_at = ?
          WHERE singleton = 1 AND revision = ?`)
          .bind(deviceHash, owner, serverNow, body.expectedRevision).run();
      } else {
        result = await db.prepare(`UPDATE blower_schedule_config_v1 SET enabled = 0, revision = revision + 1,
          updated_at = ? WHERE singleton = 1 AND revision = ? AND (device_hash = ? OR ? = 1)`)
          .bind(serverNow, body.expectedRevision, deviceHash, user.isSuperAdmin === true ? 1 : 0).run();
      }
      if (changes(result) !== 1) return fail('configuration_changed', '자동조회 설정이 변경됐습니다. 현재 설정을 다시 확인해 주세요.', 409);
      config = await loadConfig(db);
      return reply({ ok: true, ...await statusData(db, config, deviceHash, now) });
    }

    // Finishing an already authorized request is allowed after the scheduler is
    // disabled/replaced. It cannot authorize another query or alter query data.
    if (operation !== 'finish' && (!config?.enabled || !sameDevice(config, deviceHash))) {
      return fail('device_not_designated', '이 PC는 자동조회가 켜진 BCO1 PC가 아닙니다.', 403);
    }
    if (operation === 'claim') {
      const start = slotStart(now);
      if (body.slotKey !== new Date(start).toISOString() || now < start || now >= start + CLAIM_WINDOW_MS) {
        return fail('outside_slot_window', '지정된 자동조회 시작 시간이 아닙니다.', 409);
      }
      // A single SQL statement checks the current designation, revision, main
      // request queue and durable slot uniqueness at the insertion boundary.
      // Missing/inaccessible request storage is an error, never an idle queue.
      const result = await db.prepare(`INSERT INTO blower_schedule_slots_v1
        (slot_key, device_hash, owner_id, run_hash, config_revision, state, claimed_at, updated_at)
        SELECT ?, ?, ?, ?, revision, 'running', ?, ? FROM blower_schedule_config_v1
        WHERE singleton = 1 AND enabled = 1 AND device_hash = ? AND revision = ?
          AND NOT EXISTS (SELECT 1 FROM ois_data_requests
            WHERE request_type = 'blower_runtime_probe' AND status IN ('pending', 'processing'))
        ON CONFLICT(slot_key) DO NOTHING`)
        .bind(body.slotKey, deviceHash, owner, runHash, serverNow, serverNow, deviceHash, config.revision).run();
      if (changes(result) === 1) return reply({ ok: true, acquired: true, slotKey: body.slotKey, claimedAt: serverNow });
      const current = await loadConfig(db);
      if (!current?.enabled || !sameDevice(current, deviceHash) || current.revision !== config.revision) {
        return fail('configuration_changed', '자동조회 설정이 변경됐습니다. 현재 설정을 다시 확인해 주세요.', 409);
      }
      const existing = await loadSlot(db, body.slotKey);
      if (existing) return reply({ ok: true, acquired: false, code: 'slot_already_claimed', slotKey: body.slotKey });
      return fail('blower_busy', 'Blower 조회가 진행 중이어서 이번 자동조회 시작을 보류합니다.', 409);
    }

    let row = await loadSlot(db, body.slotKey);
    if (!row && operation === 'check') return fail('run_not_found', '이 자동조회 실행 기록이 없습니다.', 404);
    if (!owns(row, owner, deviceHash, runHash)) return fail('run_not_owned', '이 로그인에서 시작한 자동조회가 아닙니다.', 403);
    if (operation === 'check') {
      const age = now - Date.parse(row.claimed_at);
      const maxAge = body.purpose === 'create' ? CREATE_WINDOW_MS : RESUME_WINDOW_MS;
      if (!Number.isFinite(age) || age < 0 || age > maxAge) return fail('run_expired', '자동조회 실행 확인 시간이 지났습니다.', 409);
      if (body.purpose === 'create' && (row.state !== 'running' || row.config_revision !== config.revision || row.batch_receipt !== null)) {
        return fail('run_not_creatable', '이 자동조회에서 새 요청을 시작할 수 없습니다.', 409);
      }
      return reply({ ok: true, allowed: true, purpose: body.purpose, ...slotSummary(row), batchReceipt: readReceipt(row) });
    }

    if (row.state === 'running') {
      await db.prepare(`UPDATE blower_schedule_slots_v1 SET state = ?, target_count = ?, completed_count = ?,
        failed_count = ?, updated_at = ? WHERE slot_key = ? AND owner_id = ? AND device_hash = ?
        AND run_hash = ? AND state = 'running'`)
        .bind(body.status, body.targetCount, body.completedCount, body.failedCount, serverNow,
          body.slotKey, owner, deviceHash, runHash).run();
      row = await loadSlot(db, body.slotKey);
    }
    if (!owns(row, owner, deviceHash, runHash) || row.state !== body.status || row.target_count !== body.targetCount ||
        row.completed_count !== body.completedCount || row.failed_count !== body.failedCount) {
      return fail('result_already_recorded', '이미 기록된 자동조회 완료 상태와 다릅니다.', 409);
    }
    return reply({ ok: true, ...slotSummary(row) });
  } catch {
    return fail('storage_unavailable', '자동조회 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.', 503);
  }
}

export const __blowerScheduleTest = Object.freeze({ slotStart, CLAIM_WINDOW_MS, CREATE_WINDOW_MS, RESUME_WINDOW_MS });
