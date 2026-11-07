import { verifiedAppendBase } from './blower-incremental.js';
import { replacementAutoCycleProof } from './blower-replacement-auto-v3.js';
import { loadCurrentReplacementRoleContext, replacementSourceHashes, replacementSourceGuard } from './blower-replacement-log-source-v3.js';
import { shiftKey } from './blower-role-priority-v5.js';

/* Full RUN repair keeps the saved value until an unchanged owner, immutable
 * measured tail and complete new result commit together. This helper supplies
 * guards only: it never changes a belt date, source, counter or raw request.
 * Bag 1B has an independently confirmed completion clock. Seal 2A/2C retain
 * their registered May11 origin. The original first-RUN mode still requires
 * validated transition evidence. Seal 2C also has a separately requested
 * registered-range mode: a complete integral does not require a transition or
 * establish a physical belt-completion/first-start clock.
 */
export const COVERAGE_RECOVERY_PREFIX = 'coverage-recovery-v1:';
const TABLE = 'blower_coverage_recovery_intents_v1';
// The deployed v1 table has a CHECK containing only the original two modes.
// Keep it intact; CREATE IF NOT EXISTS cannot extend that constraint.
const REGISTERED_TABLE = 'blower_registered_range_recovery_intents_v1';
const SEAL_ORIGIN = Date.parse('2026-05-11T00:00:00+09:00');
const MAX_SNAPSHOT_BYTES = 750000;
const MODES = new Set(['confirmed_gap', 'seal_first_run', 'seal_registered_range']);
const tableForMode = mode => mode === 'seal_registered_range' ? REGISTERED_TABLE : TABLE;
const SIGNALS = {
  '104ETG30AN602': 'GSPOGE.ABB_DCS.103ETG30AN602XJ04',
  '204HHL10AN611': 'GSPOGE.ABB_DCS.204HHL10AN611XB04',
  '204HHL10AN631': 'GSPOGE.ABB_DCS.204HHL10AN631XB04'
};
const EVENT_COLUMNS = ['id','tag_number','event_type','event_date','runtime_hours','issue_type','action_type','note','source_type','source_log_id','source_text','created_by_id','created_by_name','created_at','updated_at'];
const text = value => String(value ?? '').trim();
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const sameTime = (left, right) => Number.isFinite(instant(left)) && instant(left) === instant(right);
const day = value => Number.isFinite(instant(value)) ? new Date(instant(value) + 9 * 3600000).toISOString().slice(0,10) : '';
const finiteHours = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) && Number(value) >= 0;
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2,'0')).join('');
const col = key => '"' + key.replace(/"/g,'""') + '"';
const condition = row => Object.keys(row).map(key => `${col(key)} IS ?`).join(' AND ');
const exists = (table, row) => ({sql:`EXISTS (SELECT 1 FROM ${table} WHERE ${condition(row)})`,values:Object.values(row)});
const insert = (db, table, row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).map(col).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
const guard = (db, id, checks) => db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES (?,CASE WHEN ${checks.map(check => '(' + check.sql + ')').join(' AND ')} THEN 1 ELSE 0 END)`).bind(id,...checks.flatMap(check => check.values));
const failure = (code, message, status = 409) => Object.assign(new Error(message),{code,status});
const conflict = () => failure('BLOWER_COVERAGE_RECOVERY_CONFLICT','조회 중 교체 근거·누적값·이력이 변경되었습니다. 기존 값은 유지하며 새로 확인해 주세요.');
const proofRequired = () => failure('BLOWER_COVERAGE_RECOVERY_PROOF_REQUIRED','현재 저장값과 연결된 정확한 RUN 보완 근거를 확인하지 못했습니다. 기존 값은 유지합니다.');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;

function eventsEqual(tag, rows) {
  const encoded = JSON.stringify(rows);
  return {sql:`(SELECT COUNT(*) FROM blower_history_events WHERE tag_number=?)=json_array_length(?) AND NOT EXISTS (
    SELECT 1 FROM blower_history_events e LEFT JOIN json_each(?) j ON e.id=json_extract(j.value,'$.id')
    WHERE e.tag_number=? AND (j.value IS NULL OR NOT (${EVENT_COLUMNS.map(key => `e.${col(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')})))`,values:[tag,encoded,encoded,tag]};
}

function modeFlags(body, mode) {
  const flags = {confirmedGapRecovery:mode === 'confirmed_gap', requireFirstRunStart:mode === 'seal_first_run',
    registeredRangeRecovery:mode === 'seal_registered_range'};
  if (!body || !MODES.has(mode) || Object.entries(flags).some(([key,required]) => required
    ? body[key] !== true : body[key] !== undefined && body[key] !== false) ||
      [body.incrementalRefresh,body.requireIncrementalAppend,body.limestoneTrackingOnly,body.rolePriorityRecovery,
        body.completionWindowRecovery,body.appendBoundaryRecovery].some(value=>value !== undefined && value !== false)) {
    throw failure('BLOWER_COVERAGE_RECOVERY_MODE_INVALID','RUN 보완 조회의 종류와 전체 조회 조건이 일치하지 않습니다.',400);
  }
}

function immutableMeasuredTail(asset, events, signal, now) {
  const base = verifiedAppendBase(asset, events, signal);
  const receipt = base && events.find(row => row.id === base.eventId);
  const source = parse(receipt?.source_text);
  // Overlay-owned values need their own proof. This repair starts with the
  // exact current DataPARC owner, never an older equal-valued measurement.
  if (!base || !receipt || receipt.source_type !== 'dataparc_runtime' || receipt.event_type !== 'runtime_correction' ||
      receipt.updated_at !== receipt.created_at || !sameTime(receipt.event_date,asset.cycle_runtime_anchor_at) ||
      !sameTime(base.observedAt,asset.cycle_runtime_anchor_at) || base.state !== asset.cycle_runtime_state ||
      instant(base.observedAt) > now.getTime() ||
      source?.manualOverride === true || source?.manualOverride?.changedAt || source?.replacementEdit || source?.requiresRunRefresh ||
      !finiteHours(asset.runtime_hours) || Number(asset.runtime_hours) !== Number(asset.cycle_runtime_hours)) throw proofRequired();
  return {base,receipt,source};
}

function currentReplacementOwner(asset, events) {
  const active = events.filter(row => row.tag_number === asset.tag_number && row.event_type === 'replacement');
  if (active.some(row => !Number.isFinite(instant(row.event_date)) || instant(row.event_date) > instant(asset.last_replacement_at))) throw proofRequired();
  const owners = active.filter(row => sameTime(row.event_date,asset.last_replacement_at));
  if (owners.length !== 1) throw proofRequired();
  return owners[0];
}

async function confirmedBagSource(database, asset, events, owner, options) {
  const automatic = replacementAutoCycleProof(asset, events);
  const selected = automatic?.rolePrioritySelection;
  const certificate = events.find(row => row.id === automatic?.confirmedClockEventId);
  const source = parse(certificate?.source_text);
  const key = parse(source?.sourceKey);
  if (asset.blower_type !== 'flyash_bag' || automatic?.normalizationVersion !== 4 || automatic.clockKnown !== true ||
      automatic.timePrecision !== 'minute' || automatic.completionClockReconciled !== true || automatic.completionClockConflict === true ||
      automatic.rolePrioritySourceRevoked === true || automatic.requiresRunRefresh === true ||
      !sameTime(automatic.confirmedReplacementAt,asset.last_replacement_at) || automatic.replacementEventId !== owner.id ||
      selected?.version !== 1 || selected.timePrecision !== 'minute' || selected.requiredRebuild !== false || selected.selectedRole !== 'BCO1' ||
      !sameTime(selected.selectedCompletionAt,asset.last_replacement_at) || selected.selectedWorkDate !== day(asset.last_replacement_at) ||
      shiftKey(selected.selectedShift) !== 'DS' ||
      certificate?.source_type !== 'shift_log_auto_v3' || certificate.event_type !== 'cycle_source_reconcile' ||
      source?.schemaVersion !== 3 || source.replacementAutoV3 !== true || source.currentCycle !== true ||
      source.sourceRevisionSuperseded === true || source.rolePrioritySupersededBy || source.rolePrioritySourceRevoked === true ||
      source.replacementEventId !== owner.id || source.currentLastReplacementAt !== asset.last_replacement_at ||
      source.cycleStartRevision !== asset.cycle_start_revision || source.timePrecision !== 'minute' ||
      certificate.source_log_id !== automatic.confirmedClockSourceLogId || certificate.source_log_id !== selected.selectedSourceLogId ||
      source.sourceSnapshotSha256 !== automatic.confirmedClockSourceSnapshotSha256 ||
      source.sourceSnapshotSha256 !== selected.selectedSourceSnapshotSha256 ||
      !/^[a-f0-9]{64}$/.test(text(source.sourceSnapshotSha256)) ||
      !Array.isArray(key) || key.length !== 4 || key[1] !== asset.tag_number ||
      text(key[0]).replace(/^legacy-/,'') !== text(certificate.source_log_id).replace(/^legacy-/,'') ||
      source.sourceKey !== selected.selectedSourceKey) throw proofRequired();
  // The current Bag gap starts at an imported changeover. A manual startup
  // cannot be silently superseded by a query beginning at an earlier belt.
  const starts = events.filter(row => ['startup','operation_start'].includes(row.event_type) &&
    sameTime(row.event_date,asset.cycle_started_at));
  if (asset.cycle_start_state !== 'started' || !(instant(asset.cycle_started_at) > instant(asset.last_replacement_at)) ||
      !starts.length || !starts.every(row => row.source_type === 'shift_log_operation_auto' &&
        String(row.id || '').startsWith('operation-auto:') && text(row.source_log_id) && text(row.source_text) &&
        row.updated_at === row.created_at)) throw proofRequired();
  const {logs,coverageIssues} = await loadCurrentReplacementRoleContext(database,
    {workDate:selected.selectedWorkDate,shift:selected.selectedShift},options);
  if (coverageIssues.length) throw failure('BLOWER_COVERAGE_RECOVERY_SOURCE_COVERAGE','현재 승인 원문과 삭제 여부를 모두 확인할 수 없어 기존 값을 유지합니다.');
  const matching = logs.filter(row => [row.id,...(row.sourceAliases || [])].includes(certificate.source_log_id));
  if (matching.length !== 1 || (await replacementSourceHashes(matching[0])).sourceSnapshotSha256 !== source.sourceSnapshotSha256)
    throw failure('BLOWER_COVERAGE_RECOVERY_SOURCE_CHANGED','교체 완료 원문 또는 같은 작업의 승인 업무일지가 변경되었습니다. 최신화 후 다시 확인해 주세요.');
  const sourceRow = matching[0];
  const aliases = [...new Set(logs.flatMap(row => [row.id,...(row.sourceAliases || [])]))].sort();
  const excluded = {sql:`NOT EXISTS (SELECT 1 FROM blower_history_candidates WHERE tag_number=? AND status='excluded' AND detected_type='replacement' AND source_log_id IN (SELECT value FROM json_each(?)))`,values:[asset.tag_number,JSON.stringify(aliases)]};
  if (!(await database.prepare(`SELECT CASE WHEN ${excluded.sql} THEN 1 ELSE 0 END AS valid`).bind(...excluded.values).first())?.valid)
    throw failure('BLOWER_COVERAGE_RECOVERY_SOURCE_EXCLUDED','같은 교체 작업에 제외 처리한 근거가 있어 기존 값을 유지합니다.');
  return {certificate,sourceRow,sourceSnapshotSha256:source.sourceSnapshotSha256,
    guards:[replacementSourceGuard(sourceRow),excluded]};
}

export async function loadCoverageRecoveryProof(database, asset, dataParcTag, mode, options = {}) {
  const now = options.now === undefined ? new Date() : options.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !MODES.has(mode) || !asset || Number(asset.enabled) !== 1 ||
      (mode === 'confirmed_gap' ? asset.tag_number !== '104ETG30AN602'
        : mode === 'seal_registered_range' ? asset.tag_number !== '204HHL10AN631'
          : !['204HHL10AN611','204HHL10AN631'].includes(asset.tag_number)) ||
      dataParcTag !== SIGNALS[asset.tag_number] || !Number.isFinite(instant(asset.last_replacement_at)) ||
      !text(asset.cycle_start_revision) || !text(asset.cycle_runtime_revision) ||
      text(asset.cycle_runtime_revision).length + COVERAGE_RECOVERY_PREFIX.length > 200 ||
      !finiteHours(asset.cycle_runtime_hours)) throw proofRequired();
  const result = await database.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id LIMIT 2001').bind(asset.tag_number).all();
  if (!Array.isArray(result.results) || result.results.length > 2000)
    throw failure('BLOWER_COVERAGE_RECOVERY_HISTORY_LIMIT','RUN 보완 이력이 허용 범위를 초과하여 기존 값을 유지합니다.');
  const events = result.results;
  const owner = currentReplacementOwner(asset,events);
  const {base,receipt} = immutableMeasuredTail(asset,events,dataParcTag,now);
  const startAt = new Date(instant(asset.last_replacement_at)).toISOString();
  if (!(instant(base.startAt) > instant(startAt)) || !(instant(base.observedAt) > instant(base.startAt))) throw proofRequired();
  let source = null;
  if (mode === 'confirmed_gap') source = await confirmedBagSource(database,asset,events,owner,{...options,now});
  else if (asset.blower_type !== 'seal_pot' || instant(asset.last_replacement_at) !== SEAL_ORIGIN ||
      asset.cycle_start_state !== 'legacy' || text(asset.cycle_started_at) || owner.source_type !== 'manual' ||
      base.coverageComplete !== false || !(base.missingLeadingSeconds > 0) ||
      events.some(row => row.event_type === 'startup' && (!Number.isFinite(instant(row.event_date)) || instant(row.event_date) >= SEAL_ORIGIN))) throw proofRequired();
  const snapshot = {version:1,mode,asset,events,startAt,dataParcTag,
    baseEventId:base.eventId,baseRequestId:base.requestId,baseStartAt:base.startAt,
    baseObservedAt:base.observedAt,baseRunningSeconds:base.runningSeconds,
    ...(source ? {certificateEventId:source.certificate.id,sourceReceiptId:source.sourceRow.receiptId,
      sourceSnapshotSha256:source.sourceSnapshotSha256} : {})};
  const snapshotJson = JSON.stringify(canonical(snapshot));
  if (new TextEncoder().encode(snapshotJson).length > MAX_SNAPSHOT_BYTES)
    throw failure('BLOWER_COVERAGE_RECOVERY_HISTORY_LIMIT','RUN 보완 감사자료가 허용 크기를 초과하여 기존 값을 유지합니다.');
  return {mode,asset,events,owner,base,receipt,startAt,dataParcTag,snapshot,snapshotJson,snapshotSha256:await digest(snapshotJson),
    guards:[exists('blower_history_assets',asset),eventsEqual(asset.tag_number,events),...(source?.guards || [])]};
}

export function validateCoverageRecoveryView(body, proof) {
  modeFlags(body,proof.mode);
  const asset = proof.asset;
  const expected = {expectedLastReplacementAt:text(asset.last_replacement_at),expectedCycleStartState:text(asset.cycle_start_state),
    expectedCycleStartedAt:text(asset.cycle_started_at),expectedCycleStartRevision:text(asset.cycle_start_revision),
    expectedCycleRuntimeRevision:text(asset.cycle_runtime_revision)};
  if (body.assetTag !== asset.tag_number || body.dataParcTag !== proof.dataParcTag ||
      Object.entries(expected).some(([key,value]) => typeof body[key] !== 'string' || body[key] !== value) ||
      (body.startAt !== undefined && !sameTime(body.startAt,proof.startAt))) throw conflict();
}

export async function ensureCoverageRecoverySchema(database) {
  await database.prepare('CREATE TABLE IF NOT EXISTS blower_history_atomic_guard (id TEXT PRIMARY KEY NOT NULL,valid INTEGER NOT NULL CHECK(valid=1))').run();
  await database.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    request_id TEXT PRIMARY KEY NOT NULL,version INTEGER NOT NULL CHECK(version=1),asset_tag TEXT NOT NULL,
    data_parc_tag TEXT NOT NULL,recovery_mode TEXT NOT NULL CHECK(recovery_mode IN ('confirmed_gap','seal_first_run')),
    start_at TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL
  )`).run();
  await database.prepare(`CREATE TABLE IF NOT EXISTS ${REGISTERED_TABLE} (
    request_id TEXT PRIMARY KEY NOT NULL,version INTEGER NOT NULL CHECK(version=1),asset_tag TEXT NOT NULL,
    data_parc_tag TEXT NOT NULL,recovery_mode TEXT NOT NULL CHECK(recovery_mode='seal_registered_range'),
    start_at TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL
  )`).run();
}

export async function loadCoverageRecoveryIntent(database, requestId) {
  const matches = [];
  for (const table of [TABLE,REGISTERED_TABLE]) {
    try { const row = await database.prepare(`SELECT * FROM ${table} WHERE request_id=?`).bind(requestId).first(); if(row) matches.push(row); }
    catch (error) { if (!/no such table:.*blower_(?:coverage|registered_range)_recovery_intents_v1/i.test(String(error?.message || error))) throw error; }
  }
  // A damaged duplicate across mode tables cannot silently pick an authority.
  return matches.length === 1 ? matches[0] : null;
}

export function coverageRecoveryQueueStatements(database, proof, requestId, createdAt) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200 || !Number.isFinite(instant(createdAt))) throw conflict();
  const id = crypto.randomUUID();
  const row = {request_id:requestId,version:1,asset_tag:proof.asset.tag_number,data_parc_tag:proof.dataParcTag,
    recovery_mode:proof.mode,start_at:proof.startAt,snapshot_sha256:proof.snapshotSha256,snapshot_json:proof.snapshotJson,created_at:createdAt};
  return {before:[guard(database,id,proof.guards)],after:[insert(database,tableForMode(proof.mode),row),database.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(id)]};
}

export async function validCoverageRecoveryReuse(database, requestId, proof) {
  const row = await loadCoverageRecoveryIntent(database,requestId);
  return !!row && row.version === 1 && row.asset_tag === proof.asset.tag_number && row.data_parc_tag === proof.dataParcTag &&
    row.recovery_mode === proof.mode && row.start_at === proof.startAt &&
    row.snapshot_sha256 === proof.snapshotSha256 && row.snapshot_json === proof.snapshotJson;
}

export async function validateCoverageRecoveryApply(database, intentRow, asset, probe, body, options = {}) {
  const snapshot = parse(intentRow?.snapshot_json);
  if (!intentRow || intentRow.version !== 1 || !MODES.has(intentRow.recovery_mode) || !asset ||
      typeof intentRow.snapshot_json !== 'string' || new TextEncoder().encode(intentRow.snapshot_json).length > MAX_SNAPSHOT_BYTES ||
      intentRow.snapshot_sha256 !== await digest(intentRow.snapshot_json) || snapshot?.version !== 1 ||
      snapshot.mode !== intentRow.recovery_mode || snapshot.asset?.tag_number !== intentRow.asset_tag ||
      snapshot.startAt !== intentRow.start_at || snapshot.dataParcTag !== intentRow.data_parc_tag ||
      intentRow.asset_tag !== asset.tag_number || probe?.requestId !== intentRow.request_id) throw conflict();
  modeFlags(body,intentRow.recovery_mode);
  const proof = await loadCoverageRecoveryProof(database,asset,intentRow.data_parc_tag,intentRow.recovery_mode,options);
  if (proof.snapshotJson !== intentRow.snapshot_json || proof.snapshotSha256 !== intentRow.snapshot_sha256) throw conflict();
  // The caller first validates the immutable raw result against its queued
  // runtime intent and COVERAGE_RECOVERY_PREFIX, then removes that wire prefix.
  // Full totals replace the saved total; they are never an append to it.
  if (probe.assetTag !== asset.tag_number || probe.dataParcTag !== proof.dataParcTag ||
      probe.expectedLastReplacementAt !== asset.last_replacement_at || probe.expectedCycleStartState !== asset.cycle_start_state ||
      probe.expectedCycleStartedAt !== text(asset.cycle_started_at) || probe.expectedCycleStartRevision !== asset.cycle_start_revision ||
      probe.expectedCycleRuntimeRevision !== asset.cycle_runtime_revision || probe.incremental || probe.signalOnlyCycle ||
      !sameTime(probe.startAt,proof.startAt) || !sameTime(probe.observedAt,probe.endAt) ||
      !['running','stopped'].includes(probe.startState) || !['running','stopped'].includes(probe.endState) ||
      !Number.isSafeInteger(probe.runningSeconds) || probe.runningSeconds < 0 ||
      !Number.isFinite(probe.runtimeHours) || Math.abs(probe.runtimeHours * 3600 - probe.runningSeconds) > 0.000001) throw conflict();
  const prefix = (instant(proof.base.startAt) - instant(proof.startAt)) / 1000;
  const suffix = (instant(probe.observedAt) - instant(proof.base.observedAt)) / 1000;
  if (!Number.isSafeInteger(prefix) || prefix <= 0 || !Number.isSafeInteger(suffix) || suffix < 0 ||
      probe.runningSeconds < proof.base.runningSeconds || probe.runningSeconds > proof.base.runningSeconds + prefix + suffix ||
      suffix === 0 && probe.endState !== proof.base.state)
    throw failure('BLOWER_COVERAGE_RECOVERY_TOTAL_CONFLICT','새 전체 RUN 결과가 기존 검증 구간과 물리적으로 맞지 않아 기존 값을 유지합니다.');
  if (proof.mode === 'seal_first_run') {
    const first = instant(probe.firstRunStartedAt), end = instant(probe.observedAt);
    const previous = parse(proof.receipt.source_text);
    const priorAvailable = Math.max(0,(instant(proof.base.observedAt) - Math.max(first,instant(proof.base.startAt))) / 1000);
    if (!Number.isFinite(first) || probe.firstRunStartedAt !== new Date(first).toISOString() ||
        !(SEAL_ORIGIN < first && first < end) || probe.startState !== 'stopped' || probe.runningSeconds <= 0 ||
        probe.runningSeconds > Math.round((end-first)/1000) || proof.base.runningSeconds > priorAvailable ||
        previous?.startState === 'running' && instant(previous.startAt) < first ||
        proof.base.state === 'running' && instant(proof.base.observedAt) < first)
      throw failure('BLOWER_COVERAGE_RECOVERY_FIRST_RUN_REQUIRED','등록 기준부터 확인된 첫 RUN 근거가 없어 기존 값을 유지합니다.');
  }
  return {guards:[...proof.guards,exists(tableForMode(proof.mode),intentRow)]};
}
