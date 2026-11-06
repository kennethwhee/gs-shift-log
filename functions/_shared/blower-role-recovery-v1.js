import { replacementAutoCycleProof } from './blower-replacement-auto-v3.js';
import { verifiedAppendBase } from './blower-incremental.js';
import { loadCurrentReplacementRoleContext, replacementSourceHashes, replacementSourceGuard } from './blower-replacement-log-source-v3.js';
import { shiftKey } from './blower-role-priority-v5.js';

/* A selected completion clock is evidence, not permission to discard a saved
 * total. This explicit recovery keeps the old cycle intact until a complete
 * RUN result, unchanged approved sources and both old revisions commit together.
 * The first repair is deliberately limited to the verified Limestone 1A legacy
 * owner. Earlier boundaries and startup-owned cycles need different proofs.
 */
export const ROLE_RECOVERY_PREFIX = 'role-priority-recovery-v1:';
export const ROLE_RECOVERY_TAG = '103HRJ01AN601';
export const ROLE_RECOVERY_SIGNAL = 'GSPOGE.ABB_DCS.103HRJ01AN601XB04';
const TABLE = 'blower_role_recovery_intents_v1';
const EVENT_COLUMNS = ['id','tag_number','event_type','event_date','runtime_hours','issue_type','action_type','note','source_type','source_log_id','source_text','created_by_id','created_by_name','created_at','updated_at'];
const text = value => String(value ?? '').trim();
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const sameTime = (left,right) => Number.isFinite(instant(left)) && instant(left) === instant(right);
const day = value => Number.isFinite(instant(value)) ? new Date(instant(value) + 9 * 3600000).toISOString().slice(0,10) : '';
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(value => value.toString(16).padStart(2,'0')).join('');
const col = key => '"' + key.replace(/"/g,'""') + '"';
const condition = row => Object.keys(row).map(key => `${col(key)} IS ?`).join(' AND ');
const exists = (table,row) => ({sql:`EXISTS (SELECT 1 FROM ${table} WHERE ${condition(row)})`,values:Object.values(row)});
const insert = (db,table,row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).map(col).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
const update = (db,table,before,patch) => db.prepare(`UPDATE ${table} SET ${Object.keys(patch).map(key => `${col(key)}=?`).join(',')} WHERE ${condition(before)}`).bind(...Object.values(patch),...Object.values(before));
const guard = (db,id,checks) => db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES (?,CASE WHEN ${checks.map(check => '('+check.sql+')').join(' AND ')} THEN 1 ELSE 0 END)`).bind(id,...checks.flatMap(check => check.values));
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failure = (code,message,status=409) => Object.assign(new Error(message),{code,status});
const conflict = () => failure('BLOWER_ROLE_RECOVERY_CONFLICT','조회 중 교체 근거·누적값·이력이 변경되었습니다. 기존 값은 유지하며 새로 확인해 주세요.');
export const roleRecoveryErrorResponse = error => json({ok:false,code:error.code || 'BLOWER_ROLE_RECOVERY_UNAVAILABLE',message:error.message},error.status || 409);

function eventsEqual(tag,rows) {
  const encoded = JSON.stringify(rows);
  return {sql:`(SELECT COUNT(*) FROM blower_history_events WHERE tag_number=?)=json_array_length(?) AND NOT EXISTS (
    SELECT 1 FROM blower_history_events e LEFT JOIN json_each(?) j ON e.id=json_extract(j.value,'$.id')
    WHERE e.tag_number=? AND (j.value IS NULL OR NOT (${EVENT_COLUMNS.map(key => `e.${col(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')})))`,values:[tag,encoded,encoded,tag]};
}

/** Read projection only. The queue/apply additionally re-read original approved
 * sources, exclusions and their exact R5 context hashes before authorizing work. */
export function rolePriorityRecoveryProof(asset,events,proof = replacementAutoCycleProof(asset,events)) {
  if (!asset || asset.tag_number !== ROLE_RECOVERY_TAG || asset.blower_type !== 'limestone' ||
      Number(asset.enabled) !== 1 || asset.cycle_start_state !== 'legacy' || text(asset.cycle_started_at) ||
      !text(asset.cycle_start_revision) || !text(asset.cycle_runtime_revision) ||
      text(asset.cycle_runtime_revision).length + ROLE_RECOVERY_PREFIX.length > 200) return null;
  const selected = proof?.rolePrioritySelection;
  const replacement = instant(asset.last_replacement_at), target = instant(selected?.selectedCompletionAt);
  if (proof?.normalizationVersion !== 4 || selected?.version !== 1 || selected.timePrecision !== 'minute' ||
      selected.requiredRebuild !== true || !['BCO1','BCO2','TGO'].includes(selected.selectedRole) ||
      !Number.isFinite(replacement) || !Number.isFinite(target) || target <= replacement || target % 60000 !== 0 ||
      day(selected.selectedCompletionAt) !== day(asset.last_replacement_at) ||
      selected.selectedWorkDate !== day(selected.selectedCompletionAt) ||
      !['DS','NS'].includes(shiftKey(selected.selectedShift)) ||
      !/^[a-f0-9]{64}$/.test(text(selected.selectedSourceSnapshotSha256))) return null;
  const owners = events.filter(row => row.tag_number === asset.tag_number && row.event_type === 'replacement' && sameTime(row.event_date,asset.last_replacement_at));
  const owner = owners[0], certificate = events.find(row => row.id === proof.eventId);
  const source = parse(certificate?.source_text);
  if (owners.length !== 1 || !owner || owner.id !== proof.replacementEventId || owner.source_type !== 'manual' ||
      certificate?.source_type !== 'shift_log_auto_v3' || certificate.event_type !== 'cycle_source_reconcile' ||
      source?.schemaVersion !== 3 || source.replacementAutoV3 !== true || source.normalizationVersion !== 4 ||
      source.currentCycle !== true || source.sourceRevisionSuperseded === true || source.rolePrioritySupersededBy ||
      source.rolePrioritySourceRevoked === true || source.replacementEventId !== owner.id ||
      source.currentLastReplacementAt !== asset.last_replacement_at || source.cycleStartRevision !== asset.cycle_start_revision ||
      source.sourceSnapshotSha256 !== selected.selectedSourceSnapshotSha256 ||
      source.sourceKey !== selected.selectedSourceKey || certificate.source_log_id !== selected.selectedSourceLogId) return null;
  const key = parse(source.sourceKey);
  if (!Array.isArray(key) || key.length !== 4 || key[1] !== asset.tag_number ||
      text(key[0]).replace(/^legacy-/,'') !== text(certificate.source_log_id).replace(/^legacy-/,'')) return null;
  const base = verifiedAppendBase(asset,events,ROLE_RECOVERY_SIGNAL);
  const receipt = base && events.find(row => row.id === base.eventId), raw = parse(receipt?.source_text);
  if (!base || !base.coverageComplete || !sameTime(base.startAt,asset.last_replacement_at) ||
      target >= instant(base.observedAt) || receipt.updated_at !== receipt.created_at ||
      raw?.manualOverride === true || raw?.manualOverride?.changedAt || raw?.replacementEdit || raw?.requiresRunRefresh ||
      Number(asset.runtime_hours) !== Number(asset.cycle_runtime_hours)) return null;
  return {asset,owner,certificate,base,selected,source,selectedCompletionAt:new Date(target).toISOString()};
}

export async function loadRolePriorityRecoveryProof(database,asset,options={}) {
  const result = await database.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id LIMIT 2001').bind(asset.tag_number).all();
  const events = result.results || [];
  if (events.length > 2000) throw failure('BLOWER_ROLE_RECOVERY_HISTORY_LIMIT','교체 근거 이력이 많아 안전하게 범위를 확인하지 못했습니다. 기존 값은 유지합니다.');
  const proof = rolePriorityRecoveryProof(asset,events);
  if (!proof) throw failure('BLOWER_ROLE_RECOVERY_PROOF_REQUIRED','현재 누적값과 연결된 정확한 선택 교체시각을 확인하지 못했습니다. 기존 값은 유지합니다.');
  const {logs,coverageIssues} = await loadCurrentReplacementRoleContext(database,
    {workDate:proof.selected.selectedWorkDate,shift:proof.selected.selectedShift},options);
  if (coverageIssues.length) throw failure('BLOWER_ROLE_RECOVERY_SOURCE_COVERAGE','현재 승인 원문과 삭제 여부를 모두 확인할 수 없어 교체 기준을 변경하지 않았습니다.');
  const matching = logs.filter(row => [row.id,...(row.sourceAliases || [])].includes(proof.selected.selectedSourceLogId));
  if (matching.length !== 1 || (await replacementSourceHashes(matching[0])).sourceSnapshotSha256 !== proof.selected.selectedSourceSnapshotSha256)
    throw failure('BLOWER_ROLE_RECOVERY_SOURCE_CHANGED','선택된 교체 근거 또는 같은 작업의 승인 업무일지가 변경되었습니다. 최신화 후 다시 확인해 주세요.');
  const sourceRow = matching[0];
  const aliases = [...new Set(logs.flatMap(row => [row.id,...(row.sourceAliases || [])]))].sort();
  const excludedGuard = {sql:`NOT EXISTS (SELECT 1 FROM blower_history_candidates WHERE tag_number=? AND status='excluded' AND detected_type='replacement' AND source_log_id IN (SELECT value FROM json_each(?)))`,values:[asset.tag_number,JSON.stringify(aliases)]};
  if (!(await database.prepare(`SELECT CASE WHEN ${excludedGuard.sql} THEN 1 ELSE 0 END AS valid`).bind(...excludedGuard.values).first())?.valid)
    throw failure('BLOWER_ROLE_RECOVERY_SOURCE_EXCLUDED','선택 작업에 제외 처리한 교체 근거가 있어 기준을 자동으로 변경하지 않았습니다.');
  const snapshot = {version:1,asset,events,selectedCompletionAt:proof.selectedCompletionAt,
    certificateEventId:proof.certificate.id,sourceSnapshotSha256:proof.selected.selectedSourceSnapshotSha256,
    sourceReceiptId:sourceRow.receiptId};
  const snapshotJson = JSON.stringify(snapshot);
  if (new TextEncoder().encode(snapshotJson).length > 750000) throw failure('BLOWER_ROLE_RECOVERY_HISTORY_LIMIT','교체 근거 감사자료가 허용 범위를 초과하여 기존 값을 유지합니다.');
  return {...proof,events,snapshot,snapshotJson,snapshotSha256:await digest(snapshotJson),
    guards:[exists('blower_history_assets',asset),eventsEqual(asset.tag_number,events),replacementSourceGuard(sourceRow),excludedGuard]};
}

export function validateRoleRecoveryView(body,proof) {
  const asset = proof.asset;
  if (body.dataParcTag !== ROLE_RECOVERY_SIGNAL || proof.base.dataParcTag !== ROLE_RECOVERY_SIGNAL)
    throw failure('BLOWER_ROLE_RECOVERY_SIGNAL_MISMATCH','보존된 RUN 근거와 동일한 확인 신호로만 선택 교체시각을 조회할 수 있습니다.',400);
  const expected = {expectedLastReplacementAt:text(asset.last_replacement_at),expectedCycleStartState:text(asset.cycle_start_state),
    expectedCycleStartedAt:text(asset.cycle_started_at),expectedCycleStartRevision:text(asset.cycle_start_revision),expectedCycleRuntimeRevision:text(asset.cycle_runtime_revision)};
  if (Object.entries(expected).some(([key,value]) => typeof body[key] !== 'string' || body[key] !== value) ||
      !sameTime(body.selectedCompletionAt,proof.selectedCompletionAt) ||
      (body.startAt !== undefined && !sameTime(body.startAt,proof.selectedCompletionAt))) throw conflict();
  if (body.incrementalRefresh === true || body.requireIncrementalAppend === true || body.limestoneTrackingOnly === true)
    throw failure('BLOWER_ROLE_RECOVERY_MODE_INVALID','선택 교체시각 보완은 해당 시각부터 전체 RUN 조회가 필요합니다.',400);
}

export async function ensureRoleRecoverySchema(database) {
  await database.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    request_id TEXT PRIMARY KEY NOT NULL,version INTEGER NOT NULL CHECK(version=1),asset_tag TEXT NOT NULL,
    selected_completion_at TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL
  )`).run();
}
export async function loadRoleRecoveryIntent(database,requestId) {
  try { return await database.prepare(`SELECT * FROM ${TABLE} WHERE request_id=?`).bind(requestId).first(); }
  catch(error) { if (/no such table:.*blower_role_recovery_intents_v1/i.test(String(error?.message || error))) return null; throw error; }
}
export function roleRecoveryQueueStatements(database,proof,requestId,createdAt) {
  const id = crypto.randomUUID();
  const row = {request_id:requestId,version:1,asset_tag:proof.asset.tag_number,selected_completion_at:proof.selectedCompletionAt,
    snapshot_sha256:proof.snapshotSha256,snapshot_json:proof.snapshotJson,created_at:createdAt};
  return {before:[guard(database,id,proof.guards)],after:[insert(database,TABLE,row),database.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(id)]};
}
export async function validRoleRecoveryReuse(database,requestId,proof) {
  const row = await loadRoleRecoveryIntent(database,requestId);
  return !!row && row.version === 1 && row.asset_tag === proof.asset.tag_number && row.selected_completion_at === proof.selectedCompletionAt &&
    row.snapshot_sha256 === proof.snapshotSha256 && row.snapshot_json === proof.snapshotJson;
}

function encodeEvidence(metadata,sourceText='') {
  const row = {...metadata,sourceText:text(sourceText).slice(0,800)};
  while (JSON.stringify(row).length > 2000 && row.sourceText.length) row.sourceText=row.sourceText.slice(0,-100);
  const out = JSON.stringify(row);
  if (out.length > 2000) throw failure('BLOWER_ROLE_RECOVERY_EVIDENCE_LIMIT','교체 기준 감사자료가 허용 길이를 초과하여 기존 값을 유지합니다.');
  return out;
}
function success(probe,selected,replayed) {
  return json({ok:true,applied:!replayed,replayed,rolePriorityRecovery:true,requestId:probe.requestId,assetTag:probe.assetTag,
    selectedCompletionAt:selected,runtimeHours:probe.runtimeHours,observedAt:probe.observedAt,
    message:replayed ? '이미 반영된 선택 교체시각 보완입니다. 현재 값은 그대로 유지합니다.' : '승인 업무일지의 선택 교체시각과 그 이후 전체 RUN 누적을 함께 반영했습니다.'});
}

async function recoveryReplayState(database,auditId,requestId,rawResultSha256,selectedCompletionAt) {
  // One SELECT snapshot cannot mix an absent pre-commit audit with a newly
  // committed receipt. A concurrent commit after this read is handled by the
  // existing revision guard and its subsequent verified replay check.
  const result = await database.prepare(`SELECT request.request_type,request.status,request.result_json,
    audit.id AS audit_id,audit.action_type AS audit_action_type,audit.tag_number AS audit_tag_number,audit.after_json AS audit_after_json,
    ${EVENT_COLUMNS.map(key => `event.${col(key)} AS ${col('event_'+key)}`).join(',')}
    FROM ois_data_requests request
    LEFT JOIN blower_history_asset_history audit ON audit.id=?
    LEFT JOIN blower_history_events event ON event.id=? OR (event.source_type=? AND event.source_log_id=request.id)
    WHERE request.id=?`).bind(auditId,'dataparc_runtime:'+requestId,'dataparc_runtime',requestId).all();
  const rows = result.results || [], current = rows[0];
  const events = rows.filter(row => row.event_id).map(row => Object.fromEntries(EVENT_COLUMNS.map(key => [key,row['event_'+key]])));
  const after = parse(current?.audit_after_json), hasAudit = Boolean(current?.audit_id);
  if (!hasAudit && !events.length) return {present:false,valid:false};
  const rawUnchanged = current?.request_type === 'blower_runtime_probe' && current.status === 'complete' &&
    typeof current.result_json === 'string' && await digest(current.result_json) === rawResultSha256;
  return {present:hasAudit || events.length > 0,
    valid:rawUnchanged && current?.audit_action_type === 'role_priority_runtime_recovery' && current.audit_tag_number === ROLE_RECOVERY_TAG &&
      after?.rawResultSha256 === rawResultSha256 && after.selectedCompletionAt === selectedCompletionAt &&
      after.requestId === requestId && events.length === 1 && EVENT_COLUMNS.every(key => events[0][key] === after.runtimeEvent?.[key])};
}

export async function applyRolePriorityRecovery(database,user,body,adapters={}) {
  const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
  if (!text(user?.employeeNo)) return json({ok:false,code:'BLOWER_ROLE_RECOVERY_LOGIN_REQUIRED',message:'로그인이 필요합니다.'},401);
  if (!requestId || requestId.length > 200) return json({ok:false,code:'BLOWER_ROLE_RECOVERY_REQUEST_REQUIRED',message:'반영할 조회 요청을 확인해 주세요.'},400);
  const request = await database.prepare('SELECT id,request_type,status,target_date,requested_by_id,result_json,completed_at FROM ois_data_requests WHERE id=?').bind(requestId).first();
  if (!request) return json({ok:false,code:'BLOWER_ROLE_RECOVERY_REQUEST_NOT_FOUND',message:'교체 기준 보완 조회를 찾지 못했습니다.'},404);
  if (request.requested_by_id !== text(user.employeeNo) && user.isSuperAdmin !== true) return json({ok:false,code:'BLOWER_ROLE_RECOVERY_FORBIDDEN',message:'본인이 요청한 조회만 반영할 수 있습니다.'},403);
  if (request.request_type !== 'blower_runtime_probe' || request.status !== 'complete') return json({ok:false,code:'BLOWER_ROLE_RECOVERY_NOT_COMPLETE',message:'전체 RUN 조회가 완료된 뒤 반영할 수 있습니다.'},409);
  let validation = adapters.normalizeProbe(request.result_json,requestId,adapters.now);
  const stale = validation.code === 'DATAPARC_RUNTIME_PROBE_STALE' ? validation : null;
  if (stale) validation=adapters.normalizeProbe(request.result_json,requestId,adapters.now,{skipFreshness:true});
  if (validation.error) return json({ok:false,code:validation.code,message:validation.error},400);
  const probe = validation.result;
  const intent = await adapters.loadRuntimeIntent(database,requestId);
  const recovery = await loadRoleRecoveryIntent(database,requestId);
  const snapshot = parse(recovery?.snapshot_json), original = snapshot?.asset;
  if (!recovery || recovery.version !== 1 || recovery.asset_tag !== ROLE_RECOVERY_TAG || probe.assetTag !== ROLE_RECOVERY_TAG ||
      probe.dataParcTag !== ROLE_RECOVERY_SIGNAL || !original || original.tag_number !== ROLE_RECOVERY_TAG ||
      recovery.snapshot_sha256 !== await digest(recovery.snapshot_json) || snapshot.version !== 1 ||
      recovery.selected_completion_at !== snapshot.selectedCompletionAt ||
      !adapters.matchesRuntimeIntent(intent,probe) || !String(intent.reuse_key || '').startsWith(ROLE_RECOVERY_PREFIX) ||
      probe.expectedLastReplacementAt !== original.last_replacement_at || probe.expectedCycleStartState !== 'legacy' || probe.expectedCycleStartedAt ||
      probe.expectedCycleStartRevision !== original.cycle_start_revision ||
      probe.expectedCycleRuntimeRevision !== ROLE_RECOVERY_PREFIX + original.cycle_runtime_revision ||
      !sameTime(probe.startAt,recovery.selected_completion_at) ||
      request.target_date !== `v1|${probe.assetTag}|${probe.rawStartAt}|${probe.rawEndAt}` ||
      parse(request.result_json)?.incremental) return roleRecoveryErrorResponse(failure('BLOWER_ROLE_RECOVERY_INTENT_CONFLICT','선택 교체시각·고정 조회기간·기존 Cycle 근거가 일치하지 않아 기존 값을 유지했습니다.'));
  const auditId = ROLE_RECOVERY_PREFIX + requestId;
  const rawResultSha256 = await digest(request.result_json);
  const replay = await recoveryReplayState(database,auditId,requestId,rawResultSha256,recovery.selected_completion_at);
  if (replay.present) {
    if (replay.valid) return success(probe,recovery.selected_completion_at,true);
    return roleRecoveryErrorResponse(failure('BLOWER_ROLE_RECOVERY_IDEMPOTENCY_CONFLICT','같은 조회 요청의 반영 이력이 변경되어 다시 덮어쓰지 않았습니다.'));
  }
  if (stale) return json({ok:false,code:stale.code,message:stale.error},409);
  try {
    const asset = await database.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').bind(ROLE_RECOVERY_TAG).first();
    if (!asset) throw conflict();
    const proof = await loadRolePriorityRecoveryProof(database,asset,{now:adapters.now});
    if (proof.snapshotJson !== recovery.snapshot_json || proof.snapshotSha256 !== recovery.snapshot_sha256) throw conflict();
    const removedMaximum = (instant(proof.selectedCompletionAt) - instant(asset.last_replacement_at)) / 1000;
    const addedMaximum = (instant(probe.observedAt) - instant(proof.base.observedAt)) / 1000;
    if (!Number.isSafeInteger(removedMaximum) || !Number.isSafeInteger(addedMaximum) || addedMaximum < 0 ||
        probe.runningSeconds < Math.max(0,proof.base.runningSeconds-removedMaximum) ||
        probe.runningSeconds > proof.base.runningSeconds+addedMaximum)
      throw failure('BLOWER_ROLE_RECOVERY_TOTAL_CONFLICT','새 전체 RUN 결과가 보존된 구간과 물리적으로 맞지 않아 기존 누적값을 유지했습니다. 조회 근거를 확인해 주세요.');
    const nowDate = adapters.now instanceof Date ? adapters.now : new Date();
    const now = nowDate.toISOString(), nextStart = 'replacement-auto-v3:'+crypto.randomUUID(), nextRuntime = crypto.randomUUID();
    const patch = {last_replacement_at:proof.selectedCompletionAt,cycle_start_revision:nextStart,
      cycle_runtime_hours:probe.runtimeHours,cycle_runtime_anchor_at:probe.observedAt,cycle_runtime_state:probe.endState,cycle_runtime_revision:nextRuntime,
      runtime_hours:probe.runtimeHours,runtime_anchor_at:probe.isRunning?probe.observedAt:null,is_running:probe.isRunning?1:0,
      last_modified_by_id:text(user.employeeNo),last_modified_by_name:text(user.name),updated_at:now};
    const afterAsset = {...asset,...patch};
    const afterOwner = {...proof.owner,event_date:proof.selectedCompletionAt,updated_at:now};
    const effectiveProbe = {...probe,expectedLastReplacementAt:proof.selectedCompletionAt,expectedCycleStartRevision:nextStart,
      expectedCycleRuntimeRevision:original.cycle_runtime_revision};
    // This is an explicitly derived receipt for the newly adopted owner. The
    // immutable raw request result still carries the OLD comparison baseline
    // and wire revisions. Never rewrite result_json to pretend otherwise.
    const runtimeSource = JSON.parse(adapters.runtimeSourceText(effectiveProbe));
    runtimeSource.basisRecovery = {version:1,auditId,queryExpectedLastReplacementAt:probe.expectedLastReplacementAt,
      queryExpectedCycleStartRevision:probe.expectedCycleStartRevision,queryExpectedCycleRuntimeRevision:probe.expectedCycleRuntimeRevision};
    const runtimeSourceText = JSON.stringify(runtimeSource);
    if (runtimeSourceText.length > 2000) throw failure('BLOWER_ROLE_RECOVERY_EVIDENCE_LIMIT','RUN 감사자료가 허용 길이를 초과하여 기존 값을 유지합니다.');
    const runtimeEvent = {id:'dataparc_runtime:'+requestId,tag_number:asset.tag_number,event_type:'runtime_correction',event_date:probe.observedAt,
      runtime_hours:probe.runtimeHours,issue_type:'DataPARC',action_type:adapters.runtimeActionType(probe),note:adapters.runtimeNote(probe),
      source_type:'dataparc_runtime',source_log_id:requestId,source_text:runtimeSourceText,
      created_by_id:text(user.employeeNo),created_by_name:text(user.name),created_at:now,updated_at:now};
    const selected = {...proof.source.rolePrioritySelection,requiredRebuild:false};
    const certificate = {id:'replacement-auto-v3:role-recovery:'+requestId,tag_number:asset.tag_number,event_type:'cycle_source_reconcile',event_date:now,
      runtime_hours:0,issue_type:'업무일지 교체완료',action_type:'선택 교체시각 RUN 보완',note:'승인 원문 선택시각과 전체 RUN을 함께 반영했습니다. 이전 등록·누적값은 변경 감사자료에 보존합니다.',
      source_type:'shift_log_auto_v3',source_log_id:proof.certificate.source_log_id,
      source_text:encodeEvidence({schemaVersion:3,replacementAutoV3:true,normalizationVersion:4,currentCycle:true,confirmationOnly:true,
        replacementEventId:proof.owner.id,currentLastReplacementAt:proof.selectedCompletionAt,timePrecision:'minute',recordDate:proof.selected.selectedWorkDate,
        registeredBaseline:false,cycleStartRevision:nextStart,cycleRuntimeRevision:nextRuntime,sourceKey:proof.source.sourceKey,
        sourcePhysicalId:proof.source.sourcePhysicalId,sourceSnapshotSha256:proof.source.sourceSnapshotSha256,rolePrioritySelection:selected,
        rolePriorityRecovery:{version:1,requestId,auditId}},proof.source.sourceText),
      created_by_id:text(user.employeeNo),created_by_name:text(user.name),created_at:now,updated_at:now};
    const afterEvents = proof.events.map(row => row.id===proof.owner.id?afterOwner:row).concat(certificate,runtimeEvent);
    const audit = {id:auditId,action_type:'role_priority_runtime_recovery',tag_number:asset.tag_number,
      before_json:recovery.snapshot_json,after_json:JSON.stringify({version:1,selectedCompletionAt:proof.selectedCompletionAt,rawResultSha256,
        requestId,asset:afterAsset,replacementOwner:afterOwner,certificate,runtimeEvent,
        receiptDerivation:'Raw query compares the preserved old cycle. This atomic recovery adopts the selected approved boundary and binds its full RUN total to new cycle revisions; basisRecovery retains the original query comparison fields.'}),
      change_note:'선택 교체 완료시각과 전체 RUN 동시 반영 · 이전 교체 이력과 누적값 보존 · 원본 조회 결과 유지',
      changed_by_id:text(user.employeeNo),changed_by_name:text(user.name),changed_at:now};
    const guardIds = [crypto.randomUUID(),crypto.randomUUID()];
    await database.batch([
      guard(database,guardIds[0],[...proof.guards,exists('ois_data_requests',request),exists('blower_runtime_probe_intents_v5',intent),exists(TABLE,recovery)]),
      // Immutable audit is inserted before the owner correction, in the same
      // transaction. Any race/insert/guard failure rolls back the entire batch.
      insert(database,'blower_history_asset_history',audit),
      update(database,'blower_history_events',proof.owner,{event_date:afterOwner.event_date,updated_at:now}),
      update(database,'blower_history_assets',asset,patch),
      insert(database,'blower_history_events',certificate),insert(database,'blower_history_events',runtimeEvent),
      guard(database,guardIds[1],[exists('blower_history_assets',afterAsset),eventsEqual(asset.tag_number,afterEvents),exists('blower_history_asset_history',audit)]),
      database.prepare('DELETE FROM blower_history_atomic_guard WHERE id IN (?,?)').bind(...guardIds)
    ]);
    return success(probe,proof.selectedCompletionAt,false);
  } catch(error) {
    const transactionConflict = /CHECK constraint failed|UNIQUE constraint failed/i.test(String(error?.message || error));
    if (transactionConflict || (error?.code && error?.status)) {
      // Another caller may have committed this exact immutable request between
      // our read and CAS. A constraint failure alone is never replay evidence.
      const concurrent = await recoveryReplayState(database,auditId,requestId,rawResultSha256,recovery.selected_completion_at);
      if (concurrent.valid) return success(probe,recovery.selected_completion_at,true);
      if (concurrent.present) return roleRecoveryErrorResponse(failure('BLOWER_ROLE_RECOVERY_IDEMPOTENCY_CONFLICT','같은 조회 요청의 반영 이력이 변경되어 다시 덮어쓰지 않았습니다.'));
      return roleRecoveryErrorResponse(transactionConflict ? conflict() : error);
    }
    throw error;
  }
}
