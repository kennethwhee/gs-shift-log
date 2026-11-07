import { verifiedAppendBase, loadAppendIntent } from './blower-incremental.js';

/* A fresh, owned append whose original boundary changed may authorize one
 * independent full-range measurement. The failed delta never updates the
 * counter. The full result must agree with the saved total plus that delta,
 * allowing only measured end-time drift and the existing two-second tolerance.
 * This helper returns immutable guards; the history API owns the atomic write.
 */
export const BOUNDARY_RECOVERY_PREFIX = 'append-boundary-recovery-v1:';
export const BOUNDARY_RECOVERY_TAG = '204SDF01AN002';
export const BOUNDARY_RECOVERY_SIGNAL = 'GSPOGE.ABB_DCS.204SDF01AN002XB04';
const TABLE = 'blower_boundary_recovery_intents_v1';
const MODE = 'append_boundary_full';
const MAX_AGE = 15 * 60000, FUTURE_SKEW = 5 * 60000, MAX_SNAPSHOT_BYTES = 750000;
const EVENT_COLUMNS = ['id','tag_number','event_type','event_date','runtime_hours','issue_type','action_type','note','source_type','source_log_id','source_text','created_by_id','created_by_name','created_at','updated_at'];
const clean = value => typeof value === 'string' && value === value.trim() ? value : '';
const text = value => String(value ?? '').trim();
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const sameTime = (left,right) => Number.isFinite(instant(left)) && instant(left) === instant(right);
const seconds = value => Number.isSafeInteger(value) && value >= 0;
const hours = value => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) >= 0;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const encode = value => JSON.stringify(canonical(value));
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2,'0')).join('');
const col = value => '"' + value.replace(/"/g,'""') + '"';
const failure = (code,message,status=409) => Object.assign(new Error(message),{code,status});
const conflict = () => failure('BLOWER_BOUNDARY_RECOVERY_CONFLICT','조회 중 이전 RUN 결과·계산 기준·누적값이 변경되었습니다. 기존 값을 유지하며 새로 확인해 주세요.');
const required = () => failure('BLOWER_BOUNDARY_RECOVERY_PROOF_REQUIRED','현재 저장값과 연결된 새 이어조회 경계 불일치를 확인하지 못했습니다. 기존 누적값을 유지합니다.');

// A single JSON bind per row keeps combined D1 guards below its bind limit.
function exists(table,row) {
  return {sql:`EXISTS (SELECT 1 FROM ${table} t CROSS JOIN json_each(?) j WHERE j.key='row' AND ${
    Object.keys(row).map(key => `t.${col(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')})`,values:[JSON.stringify({row})]};
}
function eventsEqual(tag,rows) {
  const encoded = JSON.stringify(rows);
  return {sql:`(SELECT COUNT(*) FROM blower_history_events WHERE tag_number=?)=json_array_length(?) AND NOT EXISTS (
    SELECT 1 FROM blower_history_events e LEFT JOIN json_each(?) j ON e.id=json_extract(j.value,'$.id')
    WHERE e.tag_number=? AND (j.value IS NULL OR NOT (${EVENT_COLUMNS.map(key => `e.${col(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')})))`,values:[tag,encoded,encoded,tag]};
}
const insert = (db,table,row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).map(col).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
const guard = (db,id,checks) => db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES (?,CASE WHEN ${checks.map(check => '(' + check.sql + ')').join(' AND ')} THEN 1 ELSE 0 END)`).bind(id,...checks.flatMap(check => check.values));
const nowOf = options => {
  const now = options.now === undefined ? new Date() : options.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw required();
  return now;
};
function modeFlags(body) {
  if (!body || body.appendBoundaryRecovery !== true ||
      ['incrementalRefresh','requireIncrementalAppend','limestoneTrackingOnly','rolePriorityRecovery','confirmedGapRecovery',
        'requireFirstRunStart','registeredRangeRecovery','completionWindowRecovery'].some(key => body[key] !== undefined && body[key] !== false))
    throw failure('BLOWER_BOUNDARY_RECOVERY_MODE_INVALID','RUN 경계 보완의 전용 조회 조건이 일치하지 않습니다.',400);
}
function adaptersOf(options) {
  if (['normalizeProbe','loadRuntimeIntent','matchesRuntimeIntent'].some(key => typeof options[key] !== 'function'))
    throw failure('BLOWER_BOUNDARY_RECOVERY_UNAVAILABLE','RUN 경계 검증 경로가 준비되지 않아 기존 값을 유지합니다.',503);
  return options;
}

export async function loadBoundaryRecoveryProof(database,asset,dataParcTag,failureRequestId,user,options={}) {
  const now = nowOf(options), adapters = adaptersOf(options), actor = text(user?.employeeNo);
  if (!actor) throw failure('BLOWER_BOUNDARY_RECOVERY_LOGIN_REQUIRED','로그인이 필요합니다.',401);
  if (!asset || asset.tag_number !== BOUNDARY_RECOVERY_TAG || dataParcTag !== BOUNDARY_RECOVERY_SIGNAL ||
      asset.blower_type !== 'organic_fuel' || String(asset.unit_no) !== '2' || Number(asset.enabled) !== 1 ||
      !['legacy','started'].includes(asset.cycle_start_state) || !Number.isFinite(instant(asset.last_replacement_at)) ||
      !clean(asset.cycle_runtime_revision) || asset.cycle_runtime_revision.length + BOUNDARY_RECOVERY_PREFIX.length > 200 ||
      !hours(asset.runtime_hours) || !hours(asset.cycle_runtime_hours) || Number(asset.runtime_hours) !== Number(asset.cycle_runtime_hours) ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(clean(failureRequestId))) throw required();
  const request = await database.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(failureRequestId).first();
  if (!request || request.request_type !== 'blower_runtime_probe' || request.status !== 'complete') throw required();
  if (request.requested_by_id !== actor && user?.isSuperAdmin !== true)
    throw failure('BLOWER_BOUNDARY_RECOVERY_FORBIDDEN','본인이 요청한 RUN 경계 결과만 보완할 수 있습니다.',403);
  const runtimeIntent = await adapters.loadRuntimeIntent(database,failureRequestId);
  const v5 = await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(failureRequestId).first();
  const append = await loadAppendIntent(database,failureRequestId);
  if (!runtimeIntent || !v5 || encode(runtimeIntent) !== encode(v5) || !append ||
      !String(v5.reuse_key || '').startsWith('append-v1:') ||
      v5.expected_cycle_runtime_revision !== 'append-v1:' + asset.cycle_runtime_revision ||
      append.base_revision !== asset.cycle_runtime_revision) throw required();
  const validation = await adapters.normalizeProbe(request.result_json,failureRequestId,now,
    {skipFreshness:options.revalidateAccepted === true},v5);
  if (!validation || validation.error || !validation.result || !adapters.matchesRuntimeIntent(v5,validation.result)) throw required();
  const failedProbe = validation.result;
  if (failedProbe.assetTag !== BOUNDARY_RECOVERY_TAG || failedProbe.dataParcTag !== dataParcTag ||
      request.target_date !== `v1|${failedProbe.assetTag}|${failedProbe.rawStartAt ?? failedProbe.startAt}|${failedProbe.rawEndAt ?? failedProbe.endAt}` ||
      failedProbe.expectedLastReplacementAt !== asset.last_replacement_at ||
      failedProbe.expectedCycleStartState !== asset.cycle_start_state ||
      failedProbe.expectedCycleStartedAt !== text(asset.cycle_started_at) ||
      failedProbe.expectedCycleStartRevision !== text(asset.cycle_start_revision) ||
      failedProbe.expectedCycleRuntimeRevision !== 'append-v1:' + asset.cycle_runtime_revision ||
      !sameTime(failedProbe.endAt,failedProbe.observedAt) || !seconds(failedProbe.runningSeconds) ||
      !['running','stopped'].includes(failedProbe.startState) || !['running','stopped'].includes(failedProbe.endState) ||
      failedProbe.incremental || failedProbe.signalOnlyCycle) throw required();
  if (options.revalidateAccepted !== true && [failedProbe.observedAt,failedProbe.collectedAt,request.completed_at].some(value =>
      !Number.isFinite(instant(value)) || instant(value) < now.getTime()-MAX_AGE || instant(value) > now.getTime()+FUTURE_SKEW))
    throw failure('BLOWER_BOUNDARY_RECOVERY_STALE','경계 불일치 조회가 오래되어 새 이어조회로 다시 검증해야 합니다. 기존 값은 유지합니다.');
  const rows = await database.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id LIMIT 2001').bind(asset.tag_number).all();
  if (!Array.isArray(rows.results) || rows.results.length > 2000) throw required();
  const events = rows.results, base = verifiedAppendBase(asset,events,dataParcTag);
  const receipt = base && events.find(row => row.id === base.eventId), source = parse(receipt?.source_text);
  if (!base || !receipt || receipt.source_type !== 'dataparc_runtime' || receipt.event_type !== 'runtime_correction' ||
      receipt.updated_at !== receipt.created_at || source?.manualOverride || source?.replacementEdit || source?.requiresRunRefresh ||
      events.some(row => row.id === 'dataparc_runtime:' + failureRequestId || row.source_type === 'dataparc_runtime' && row.source_log_id === failureRequestId) ||
      base.coverageComplete !== true || !sameTime(base.startAt,base.requiredStartAt) || !sameTime(base.observedAt,asset.cycle_runtime_anchor_at) ||
      base.state !== asset.cycle_runtime_state || instant(base.observedAt) > now.getTime() ||
      !sameTime(base.observedAt,failedProbe.startAt) || !(instant(failedProbe.endAt) > instant(base.observedAt)) ||
      append.base_event_id !== base.eventId || append.base_revision !== base.cycleRuntimeRevision ||
      !sameTime(append.base_observed_at,base.observedAt) || !sameTime(append.coverage_start_at,base.startAt) ||
      Number(append.base_running_seconds) !== base.runningSeconds ||
      base.state === failedProbe.startState) throw required();
  const startAt = new Date(instant(base.startAt)).toISOString();
  const snapshot = {version:1,mode:MODE,actorId:actor,asset,events,startAt,dataParcTag,
    failureRequestId,request,runtimeIntent:v5,appendIntent:append,base};
  const snapshotJson = encode(snapshot);
  if (new TextEncoder().encode(snapshotJson).length > MAX_SNAPSHOT_BYTES) throw required();
  return {mode:MODE,asset,events,base,receipt,startAt,dataParcTag,failureRequestId,failedProbe,
    snapshot,snapshotJson,snapshotSha256:await digest(snapshotJson),
    guards:[exists('blower_history_assets',asset),eventsEqual(asset.tag_number,events),
      exists('ois_data_requests',request),exists('blower_runtime_probe_intents_v5',v5),exists('blower_runtime_append_v1',append)]};
}

export function validateBoundaryRecoveryView(body,proof) {
  modeFlags(body);
  const asset = proof.asset;
  if (body.unifiedRefresh !== true || body.incrementalRefresh !== false || body.requireIncrementalAppend !== false ||
      body.boundaryFailureRequestId !== proof.failureRequestId || body.assetTag !== asset.tag_number || body.dataParcTag !== proof.dataParcTag ||
      !sameTime(body.startAt,proof.startAt) ||
      Object.entries({expectedLastReplacementAt:asset.last_replacement_at,expectedCycleStartState:asset.cycle_start_state,
        expectedCycleStartedAt:text(asset.cycle_started_at),expectedCycleStartRevision:text(asset.cycle_start_revision),
        expectedCycleRuntimeRevision:asset.cycle_runtime_revision}).some(([key,value]) => body[key] !== value)) throw conflict();
}

export async function ensureBoundaryRecoverySchema(database) {
  await database.prepare('CREATE TABLE IF NOT EXISTS blower_history_atomic_guard (id TEXT PRIMARY KEY NOT NULL,valid INTEGER NOT NULL CHECK(valid=1))').run();
  await database.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    request_id TEXT PRIMARY KEY NOT NULL,version INTEGER NOT NULL CHECK(version=1),asset_tag TEXT NOT NULL,
    data_parc_tag TEXT NOT NULL,recovery_mode TEXT NOT NULL CHECK(recovery_mode='append_boundary_full'),
    failure_request_id TEXT NOT NULL,start_at TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL
  )`).run();
}
export async function loadBoundaryRecoveryIntent(database,requestId) {
  try { return await database.prepare(`SELECT * FROM ${TABLE} WHERE request_id=?`).bind(requestId).first(); }
  catch (error) { if (/no such table:.*blower_boundary_recovery_intents_v1/i.test(String(error?.message || error))) return null; throw error; }
}
export function boundaryRecoveryQueueStatements(database,proof,requestId,createdAt) {
  if (!/^[A-Za-z0-9:_-]{1,200}$/.test(clean(requestId)) || !Number.isFinite(instant(createdAt))) throw conflict();
  const id = crypto.randomUUID(), row = {request_id:requestId,version:1,asset_tag:proof.asset.tag_number,data_parc_tag:proof.dataParcTag,
    recovery_mode:MODE,failure_request_id:proof.failureRequestId,start_at:proof.startAt,
    snapshot_sha256:proof.snapshotSha256,snapshot_json:proof.snapshotJson,created_at:createdAt};
  return {before:[guard(database,id,proof.guards)],after:[insert(database,TABLE,row),database.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(id)]};
}
export async function validBoundaryRecoveryReuse(database,requestId,proof) {
  const row = await loadBoundaryRecoveryIntent(database,requestId);
  return !!row && row.version === 1 && row.recovery_mode === MODE && row.asset_tag === proof.asset.tag_number &&
    row.data_parc_tag === proof.dataParcTag && row.failure_request_id === proof.failureRequestId && row.start_at === proof.startAt &&
    row.snapshot_sha256 === proof.snapshotSha256 && row.snapshot_json === proof.snapshotJson;
}

// A lost create response is not permission to create again. Locate only the
// exact accepted full query linked to this authenticated failed append. The
// ordinary request detail endpoint remains responsible for its current status.
export async function findBoundaryRecoveryRequest(database,failureRequestId,user) {
  const actor = text(user?.employeeNo);
  if (!actor) throw failure('BLOWER_BOUNDARY_RECOVERY_LOGIN_REQUIRED','로그인이 필요합니다.',401);
  if (!/^[A-Za-z0-9:_-]{1,200}$/.test(clean(failureRequestId)))
    throw failure('BLOWER_BOUNDARY_RECOVERY_REQUEST_REQUIRED','확인할 이어조회 요청 ID가 필요합니다.',400);
  const original = await database.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(failureRequestId).first();
  if (!original) return null;
  if (original.requested_by_id !== actor && user?.isSuperAdmin !== true)
    throw failure('BLOWER_BOUNDARY_RECOVERY_FORBIDDEN','본인이 요청한 RUN 경계 결과만 확인할 수 있습니다.',403);
  if (original.request_type !== 'blower_runtime_probe' || original.status !== 'complete') throw required();
  let candidates;
  try {
    candidates = await database.prepare(`SELECT i.* FROM ${TABLE} i
      INNER JOIN ois_data_requests r ON r.id=i.request_id
      WHERE i.failure_request_id=? AND (r.requested_by_id=? OR ?=1) ORDER BY i.request_id LIMIT 2`)
      .bind(failureRequestId,actor,user?.isSuperAdmin === true ? 1 : 0).all();
  } catch (error) {
    if (/no such table:.*blower_boundary_recovery_intents_v1/i.test(String(error?.message || error))) return null;
    throw error;
  }
  if (!Array.isArray(candidates.results)) throw conflict();
  if (!candidates.results.length) return null;
  if (candidates.results.length !== 1) throw failure('BLOWER_BOUNDARY_RECOVERY_AMBIGUOUS',
    '같은 이어조회에 연결된 전체 조회가 둘 이상이어서 자동 선택하지 않습니다. 기존 요청과 누적값을 유지합니다.');
  const row = candidates.results[0], snapshot = parse(row.snapshot_json);
  const request = await database.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(row.request_id).first();
  const intent = await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(row.request_id).first();
  const expected = snapshot?.asset;
  if (row.version !== 1 || row.recovery_mode !== MODE || row.asset_tag !== BOUNDARY_RECOVERY_TAG ||
      row.data_parc_tag !== BOUNDARY_RECOVERY_SIGNAL || row.failure_request_id !== failureRequestId ||
      typeof row.snapshot_json !== 'string' || new TextEncoder().encode(row.snapshot_json).length > MAX_SNAPSHOT_BYTES ||
      row.snapshot_sha256 !== await digest(row.snapshot_json) || snapshot?.version !== 1 || snapshot.mode !== MODE ||
      snapshot.failureRequestId !== failureRequestId || snapshot.request?.id !== failureRequestId ||
      snapshot.request?.requested_by_id !== original.requested_by_id ||
      expected?.tag_number !== BOUNDARY_RECOVERY_TAG || snapshot.dataParcTag !== BOUNDARY_RECOVERY_SIGNAL ||
      snapshot.startAt !== row.start_at || !request || request.id !== row.request_id ||
      request.request_type !== 'blower_runtime_probe' || !['pending','processing','complete','failed'].includes(request.status) ||
      snapshot.actorId !== request.requested_by_id || (request.requested_by_id !== actor && user?.isSuperAdmin !== true) ||
      !intent || intent.request_id !== row.request_id || Number(intent.schema_version) !== 1 ||
      intent.asset_tag !== BOUNDARY_RECOVERY_TAG || intent.dataparc_tag !== BOUNDARY_RECOVERY_SIGNAL ||
      !new RegExp('^'+BOUNDARY_RECOVERY_PREFIX+'[a-f0-9]{64}$').test(clean(intent.reuse_key)) ||
      intent.expected_cycle_runtime_revision !== BOUNDARY_RECOVERY_PREFIX + expected.cycle_runtime_revision ||
      intent.expected_last_replacement_at !== expected.last_replacement_at ||
      intent.expected_cycle_start_state !== expected.cycle_start_state ||
      intent.expected_cycle_started_at !== text(expected.cycle_started_at) ||
      intent.expected_cycle_start_revision !== text(expected.cycle_start_revision) ||
      !sameTime(intent.window_start,row.start_at) || !Number.isFinite(instant(intent.window_end)) ||
      instant(intent.window_end) <= instant(intent.window_start) ||
      request.target_date !== `v1|${intent.asset_tag}|${intent.window_start}|${intent.window_end}`) throw conflict();
  return {requestId:row.request_id};
}

/**
 * Read-only diagnostics for a rejected full remeasurement. This preserves
 * every R4 acceptance condition, including measured end-time drift.
 * Never promotes the fresh full value into the stored counter.
 */
export function boundaryTotalAgreement(previousSeconds, deltaSeconds, fullSeconds, gapSeconds, elapsedSeconds) {
  const expected = previousSeconds + deltaSeconds;
  const allowedLaterSeconds = Number.isFinite(gapSeconds) ? Math.ceil(gapSeconds) + 2 : NaN;
  const valid = Number.isFinite(gapSeconds) && gapSeconds >= 0 && gapSeconds <= MAX_AGE / 1000 &&
    Number.isSafeInteger(expected) && fullSeconds >= expected - 2 &&
    fullSeconds <= expected + allowedLaterSeconds && fullSeconds >= previousSeconds - 2 &&
    fullSeconds <= elapsedSeconds + 2;
  const reason = !Number.isFinite(gapSeconds) || gapSeconds < 0 || gapSeconds > MAX_AGE / 1000
    ? 'measurement_end_time_invalid'
    : !Number.isSafeInteger(expected) ? 'total_not_safe_integer'
    : fullSeconds < expected - 2 ? 'new_full_below_expected'
    : fullSeconds > expected + allowedLaterSeconds ? 'new_full_above_expected'
    : fullSeconds < previousSeconds - 2 ? 'new_full_below_saved'
    : fullSeconds > elapsedSeconds + 2 ? 'new_full_exceeds_elapsed' : 'within_bounds';
  const hourText = value => Number.isFinite(value) ? (value / 3600).toFixed(3) : '?';
  const differenceText = Number.isSafeInteger(expected) && Number.isFinite(fullSeconds)
    ? String(fullSeconds - expected) : '?';
  // Values appear only in the already authenticated request's 409 error.
  // No request identifiers, operator identities, raw samples, or tokens.
  const message = `전체 ${hourText(fullSeconds)}h / 저장 ${hourText(previousSeconds)}h / 새 구간 ${hourText(deltaSeconds)}h` +
    ` / 차이 ${differenceText}초 (허용 -2~+${Number.isFinite(allowedLaterSeconds) ? allowedLaterSeconds : '?'}초). 기존 값 유지.`;
  return {valid, reason, message, expectedSeconds:expected, differenceSeconds:Number.isSafeInteger(expected) ? fullSeconds - expected : null};
}

export async function validateBoundaryRecoveryApply(database,intentRow,asset,probe,body,user,options={}) {
  modeFlags(body);
  const snapshot = parse(intentRow?.snapshot_json), now = nowOf(options);
  if (!intentRow || intentRow.version !== 1 || intentRow.recovery_mode !== MODE || !asset ||
      typeof intentRow.snapshot_json !== 'string' || new TextEncoder().encode(intentRow.snapshot_json).length > MAX_SNAPSHOT_BYTES ||
      intentRow.snapshot_sha256 !== await digest(intentRow.snapshot_json) || snapshot?.version !== 1 || snapshot.mode !== MODE ||
      snapshot.asset?.tag_number !== intentRow.asset_tag || snapshot.startAt !== intentRow.start_at ||
      snapshot.dataParcTag !== intentRow.data_parc_tag || snapshot.failureRequestId !== intentRow.failure_request_id ||
      intentRow.asset_tag !== asset.tag_number || probe?.requestId !== intentRow.request_id ||
      (body.boundaryFailureRequestId !== undefined && body.boundaryFailureRequestId !== intentRow.failure_request_id)) throw conflict();
  const proof = await loadBoundaryRecoveryProof(database,asset,intentRow.data_parc_tag,intentRow.failure_request_id,user,
    {...options,now,revalidateAccepted:true});
  if (proof.snapshotJson !== intentRow.snapshot_json || proof.snapshotSha256 !== intentRow.snapshot_sha256) throw conflict();
  // Caller validates the full raw response and v5 wire intent, then strips only
  // this mode's prefix. Full seconds remain absolute, without combineAppendProbe.
  if (probe.assetTag !== asset.tag_number || probe.dataParcTag !== proof.dataParcTag ||
      probe.expectedLastReplacementAt !== asset.last_replacement_at || probe.expectedCycleStartState !== asset.cycle_start_state ||
      probe.expectedCycleStartedAt !== text(asset.cycle_started_at) || probe.expectedCycleStartRevision !== text(asset.cycle_start_revision) ||
      probe.expectedCycleRuntimeRevision !== asset.cycle_runtime_revision || probe.incremental || probe.signalOnlyCycle ||
      !sameTime(probe.startAt,proof.startAt) || !sameTime(probe.observedAt,probe.endAt) ||
      !['running','stopped'].includes(probe.startState) || !['running','stopped'].includes(probe.endState) ||
      !seconds(probe.runningSeconds) || !Number.isFinite(probe.runtimeHours) || Math.abs(probe.runtimeHours*3600-probe.runningSeconds)>0.000001 ||
      [probe.observedAt,probe.collectedAt].some(value => !Number.isFinite(instant(value)) || instant(value)<now.getTime()-MAX_AGE || instant(value)>now.getTime()+FUTURE_SKEW)) throw conflict();
  const gapSeconds = (instant(probe.observedAt)-instant(proof.failedProbe.observedAt))/1000;
  const comparison = boundaryTotalAgreement(proof.base.runningSeconds,proof.failedProbe.runningSeconds,
    probe.runningSeconds,gapSeconds,(instant(probe.endAt)-instant(probe.startAt))/1000);
  if (!comparison.valid)
    throw failure('BLOWER_BOUNDARY_RECOVERY_TOTAL_CONFLICT',comparison.message);
  return {guards:[...proof.guards,exists(TABLE,intentRow)],comparison:{previousSeconds:proof.base.runningSeconds,
    deltaSeconds:proof.failedProbe.runningSeconds,fullSeconds:probe.runningSeconds,gapSeconds,
    failureRequestId:proof.failureRequestId,deltaEndAt:proof.failedProbe.observedAt,fullEndAt:probe.observedAt}};
}
