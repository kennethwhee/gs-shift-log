import { verifiedAppendBase, incrementalEvidence } from './blower-incremental.js';
import { replacementAutoCycleProof } from './blower-replacement-auto-v3.js';
import { loadCurrentReplacementRoleContext, replacementSourceHashes, replacementSourceGuard } from './blower-replacement-log-source-v3.js';

/* One historical completion window, not an invented completion clock.
 * The approved September 16 DS entries place the #C belt completion after
 * the 09:23 changeover and within that work day. An entirely measured zero
 * window through the next midnight makes every possible completion instant
 * equivalent for RUN integration. The current 09:30 measured tail, all dates,
 * counters and revisions remain unchanged. This is deliberately not a generic
 * authority to treat another date-only job as zero.
 */
export const COMPLETION_WINDOW_PREFIX = 'completion-window-recovery-v1:';
export const COMPLETION_WINDOW_TAG = '204HHL60AP631';
export const COMPLETION_WINDOW_SIGNAL = 'GSPOGE.ABB_DCS.204HHL60AP631XB04';
export const COMPLETION_WINDOW_START = '2026-09-16T00:23:00.000Z';
export const COMPLETION_WINDOW_END = '2026-09-16T15:00:00.000Z';
const RANGE_START = '2026-09-16T00:30:00.000Z';
const ORIGIN = '2026-09-15T15:00:00.000Z';
const TABLE = 'blower_completion_window_intents_v1';
const CERT_TYPE = 'dataparc_completion_window_v1';
const ACTION = 'completion_window_runtime_recovery';
const MAX_SNAPSHOT_BYTES = 750000;
const EVENT_COLUMNS = ['id','tag_number','event_type','event_date','runtime_hours','issue_type','action_type','note','source_type','source_log_id','source_text','created_by_id','created_by_name','created_at','updated_at'];
const IDENTITY_COLUMNS = EVENT_COLUMNS.filter(key => !['created_by_id','created_by_name'].includes(key));
const SOURCE_CASES = Object.freeze([
  {role:'BCO2',id:'legacy-POCHEON#20260916#DAY#BCO2',entryId:'legacy-entry-POCHEON#20260916#DAY#BCO2-2-0',time:'09:23',
    content:'FBHE Blower #C->#B 교체운전 실시\n- FBHE Blower #C V-Belt 교체 완료(동일->TR)\n- FBHE Left Damper 조정 실시'},
  {role:'BO2',id:'legacy-POCHEON#20260916#DAY#BO2',entryId:'legacy-entry-POCHEON#20260916#DAY#BO2-2-0',time:'',
    content:'[TM] 09:23 FBHE Blower #C V-Blet 전체 교체 실시\n- 교체운전 실시 (#C 정지, #B 기동)\n- V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)\n- FBHE Left Damper 조정 실시'}
]);
const text = value => String(value ?? '').trim();
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const sameTime = (a,b) => Number.isFinite(instant(a)) && instant(a) === instant(b);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const encode = value => JSON.stringify(canonical(value));
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2,'0')).join('');
const col = key => '"' + key.replace(/"/g,'""') + '"';
const condition = row => Object.keys(row).map(key => `${col(key)} IS ?`).join(' AND ');
const exists = (table,row) => ({sql:`EXISTS (SELECT 1 FROM ${table} WHERE ${condition(row)})`,values:Object.values(row)});
const insert = (db,table,row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).map(col).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
const guard = (db,id,checks) => db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES (?,CASE WHEN ${checks.map(check => '('+check.sql+')').join(' AND ')} THEN 1 ELSE 0 END)`).bind(id,...checks.flatMap(check => check.values));
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failure = (code,message,status=409) => Object.assign(new Error(message),{code,status});
const conflict = () => failure('BLOWER_COMPLETION_WINDOW_CONFLICT','검증 중 교체 근거·누적값·이력이 변경되었습니다. 기존 값은 유지합니다.');
const unavailable = () => failure('BLOWER_COMPLETION_WINDOW_PROOF_REQUIRED','현재 교체 원문과 보존된 RUN 구간을 연결할 수 없어 기존 값을 유지합니다.');
const errorResponse = error => json({ok:false,code:error.code || 'BLOWER_COMPLETION_WINDOW_UNAVAILABLE',message:error.message},error.status || 409);
const identity = row => Object.fromEntries(IDENTITY_COLUMNS.map(key => [key,row[key] ?? null]));
const contentText = value => text(value).replace(/\r\n?/g,'\n');

function eventsEqual(tag,rows) {
  const encoded = JSON.stringify(rows);
  return {sql:`(SELECT COUNT(*) FROM blower_history_events WHERE tag_number=?)=json_array_length(?) AND NOT EXISTS (
    SELECT 1 FROM blower_history_events e LEFT JOIN json_each(?) j ON e.id=json_extract(j.value,'$.id')
    WHERE e.tag_number=? AND (j.value IS NULL OR NOT (${EVENT_COLUMNS.map(key => `e.${col(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')})))`,values:[tag,encoded,encoded,tag]};
}

function sameCurrentOwner(asset,events,automatic) {
  if (!asset || asset.tag_number !== COMPLETION_WINDOW_TAG || asset.blower_type !== 'fbhe' || Number(asset.enabled) !== 1 ||
      asset.cycle_start_state !== 'pending' || text(asset.cycle_started_at) ||
      !sameTime(asset.last_replacement_at,ORIGIN) || !text(asset.cycle_start_revision) || !text(asset.cycle_runtime_revision) ||
      text(asset.cycle_runtime_revision).length + COMPLETION_WINDOW_PREFIX.length > 200 ||
      automatic?.normalizationVersion !== 4 || automatic.timePrecision !== 'day' || automatic.clockKnown !== false ||
      automatic.registeredRuntimeRange !== true || automatic.rangeTrackingAllowed !== true ||
      !sameTime(automatic.rangeStartAt,RANGE_START) || automatic.completionClockConflict === true ||
      automatic.rolePrioritySourceRevoked === true || automatic.requiresRunRefresh === true ||
      !SOURCE_CASES.some(item => item.id === automatic.sourceLogId) ||
      !/^[a-f0-9]{64}$/.test(text(automatic.sourceSnapshotSha256))) return null;
  const active = events.filter(row => row.tag_number === asset.tag_number && row.event_type === 'replacement');
  if (active.some(row => !Number.isFinite(instant(row.event_date)) || instant(row.event_date) > instant(ORIGIN))) return null;
  const owners = active.filter(row => sameTime(row.event_date,asset.last_replacement_at));
  const owner = owners[0], sourceEvent = events.find(row => row.id === automatic.eventId);
  const source = parse(sourceEvent?.source_text), key = parse(source?.sourceKey);
  if (owners.length !== 1 || owner.id !== automatic.replacementEventId ||
      sourceEvent?.source_type !== 'shift_log_auto_v3' || sourceEvent.event_type !== 'cycle_source_reconcile' ||
      sourceEvent.created_at !== sourceEvent.updated_at || source?.schemaVersion !== 3 || source.replacementAutoV3 !== true ||
      source.normalizationVersion !== 4 || source.currentCycle !== true || source.sourceRevisionSuperseded === true ||
      source.rolePrioritySupersededBy || source.rolePrioritySourceRevoked === true ||
      source.currentLastReplacementAt !== asset.last_replacement_at || source.cycleStartRevision !== asset.cycle_start_revision ||
      source.replacementEventId !== owner.id || source.timePrecision !== 'day' ||
      source.sourceSnapshotSha256 !== automatic.sourceSnapshotSha256 || sourceEvent.source_log_id !== automatic.sourceLogId ||
      !Array.isArray(key) || key.length !== 4 || key[0] !== sourceEvent.source_log_id || key[1] !== COMPLETION_WINDOW_TAG ||
      !SOURCE_CASES.some(item => item.id === key[0] && item.entryId === key[2])) return null;
  const base = verifiedAppendBase(asset,events,COMPLETION_WINDOW_SIGNAL);
  const receipt = base && events.find(row => row.id === base.eventId), raw = parse(receipt?.source_text);
  if (!base || !sameTime(base.startAt,RANGE_START) || instant(base.observedAt) < instant(COMPLETION_WINDOW_END) ||
      receipt?.created_at !== receipt?.updated_at || raw?.manualOverride || raw?.replacementEdit || raw?.requiresRunRefresh ||
      raw?.signalOnlyCycle !== true || raw.expectedCycleStartState !== 'legacy' || text(raw.expectedCycleStartedAt) ||
      Number(asset.runtime_hours) !== Number(asset.cycle_runtime_hours) ||
      !sameTime(base.observedAt,asset.cycle_runtime_anchor_at) || base.state !== asset.cycle_runtime_state) return null;
  return {asset,events,automatic,owner,sourceEvent,source,base,receipt};
}

/** Eligibility advertises a specific measurement; it is not a certificate. */
export function completionWindowRecoveryCandidate(asset,events,automatic = replacementAutoCycleProof(asset,events)) {
  const proof = sameCurrentOwner(asset,events,automatic);
  return proof ? {version:1,eligible:true,certificateOnly:true,startAt:COMPLETION_WINDOW_START,endAt:COMPLETION_WINDOW_END,
    windowStartAt:COMPLETION_WINDOW_START,windowEndAt:COMPLETION_WINDOW_END,dataParcTag:COMPLETION_WINDOW_SIGNAL} : null;
}

async function currentSources(database,proof,options) {
  const {logs,coverageIssues} = await loadCurrentReplacementRoleContext(database,{workDate:'2026-09-16',shift:'DS'},options);
  if (coverageIssues.length) throw failure('BLOWER_COMPLETION_WINDOW_SOURCE_COVERAGE','승인 원문과 삭제 여부를 모두 확인할 수 없어 기존 값을 유지합니다.');
  const selected = [];
  for (const spec of SOURCE_CASES) {
    const rows = logs.filter(row => [row.id,...(row.sourceAliases || [])].includes(spec.id));
    if (rows.length !== 1) throw failure('BLOWER_COMPLETION_WINDOW_SOURCE_CHANGED','9월 16일의 승인 교체 원문이 변경되었거나 확인되지 않습니다.');
    const row = rows[0], log = parse(row.log_json);
    const entries = Array.isArray(log?.entries) ? log.entries.filter(entry => entry?.id === spec.entryId) : [];
    if (row.sourceTable !== 'shift_logs' || row.id !== spec.id || row.role !== spec.role || row.work_date !== '2026-09-16' ||
        !['DS','DAY'].includes(row.shift) || entries.length !== 1 || text(entries[0].time) !== spec.time ||
        contentText(entries[0].content) !== spec.content || Object.hasOwn(entries[0],'vBeltReplacement'))
      throw failure('BLOWER_COMPLETION_WINDOW_SOURCE_CHANGED','승인 교체 기록의 설비·작업 순서·날짜가 검토한 근거와 달라 기존 값을 유지합니다.');
    const hashes = await replacementSourceHashes(row);
    selected.push({row,hash:hashes.sourceSnapshotSha256});
  }
  const ownerSource = selected.find(item => item.row.id === proof.automatic.sourceLogId);
  if (!ownerSource || ownerSource.hash !== proof.automatic.sourceSnapshotSha256)
    throw failure('BLOWER_COMPLETION_WINDOW_SOURCE_CHANGED','현재 교체 기준에 연결된 승인 원문과 보직 문맥이 변경되었습니다. 전체 최신화로 근거를 먼저 반영해 주세요.');
  const aliases = [...new Set(logs.flatMap(row => [row.id,...(row.sourceAliases || [])]))].sort();
  const excluded = {sql:`NOT EXISTS (SELECT 1 FROM blower_history_candidates WHERE tag_number=? AND status='excluded' AND detected_type='replacement' AND source_log_id IN (SELECT value FROM json_each(?)))`,values:[COMPLETION_WINDOW_TAG,JSON.stringify(aliases)]};
  if (!(await database.prepare(`SELECT CASE WHEN ${excluded.sql} THEN 1 ELSE 0 END AS valid`).bind(...excluded.values).first())?.valid)
    throw failure('BLOWER_COMPLETION_WINDOW_SOURCE_EXCLUDED','해당 교체 작업에 제외 처리한 근거가 있어 자동 검증하지 않았습니다.');
  return {identities:selected.map(item => ({sourceLogId:item.row.id,sourceReceiptId:item.row.receiptId,sourceSnapshotSha256:item.hash})),
    guards:[...selected.map(item => replacementSourceGuard(item.row)),excluded]};
}

export async function loadCompletionWindowRecoveryProof(database,asset,options={}) {
  const now = options.now === undefined ? new Date() : options.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
  const loaded = await database.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id LIMIT 2001').bind(COMPLETION_WINDOW_TAG).all();
  const events = loaded.results;
  if (!Array.isArray(events) || events.length > 2000) throw failure('BLOWER_COMPLETION_WINDOW_HISTORY_LIMIT','검증할 이력이 허용 범위를 초과하여 기존 값을 유지합니다.');
  const proof = sameCurrentOwner(asset,events,replacementAutoCycleProof(asset,events));
  if (!proof || instant(proof.base.observedAt) > now.getTime()) throw unavailable();
  const sources = await currentSources(database,proof,{...options,now});
  const snapshot = {version:1,asset,events,startAt:COMPLETION_WINDOW_START,endAt:COMPLETION_WINDOW_END,
    dataParcTag:COMPLETION_WINDOW_SIGNAL,baseEventId:proof.base.eventId,sourceEventId:proof.sourceEvent.id,
    replacementEventId:proof.owner.id,sources:sources.identities};
  const snapshotJson = encode(snapshot);
  if (new TextEncoder().encode(snapshotJson).length > MAX_SNAPSHOT_BYTES) throw failure('BLOWER_COMPLETION_WINDOW_HISTORY_LIMIT','검증 감사자료가 허용 크기를 초과하여 기존 값을 유지합니다.');
  return {...proof,startAt:COMPLETION_WINDOW_START,endAt:COMPLETION_WINDOW_END,dataParcTag:COMPLETION_WINDOW_SIGNAL,
    windowStartAt:COMPLETION_WINDOW_START,windowEndAt:COMPLETION_WINDOW_END,sources,snapshot,snapshotJson,snapshotSha256:await digest(snapshotJson),
    guards:[exists('blower_history_assets',asset),eventsEqual(COMPLETION_WINDOW_TAG,events),...sources.guards]};
}

export function validateCompletionWindowRecoveryView(body,proof) {
  if (!body || body.completionWindowRecovery !== true ||
      [body.incrementalRefresh,body.requireIncrementalAppend,body.limestoneTrackingOnly,body.rolePriorityRecovery,
        body.confirmedGapRecovery,body.requireFirstRunStart].some(value => value !== undefined && value !== false))
    throw failure('BLOWER_COMPLETION_WINDOW_MODE_INVALID','교체 작업 구간 검증의 조회 종류가 일치하지 않습니다.',400);
  const asset = proof.asset;
  const expected = {expectedLastReplacementAt:text(asset.last_replacement_at),expectedCycleStartState:text(asset.cycle_start_state),
    expectedCycleStartedAt:text(asset.cycle_started_at),expectedCycleStartRevision:text(asset.cycle_start_revision),expectedCycleRuntimeRevision:text(asset.cycle_runtime_revision)};
  if (body.assetTag !== COMPLETION_WINDOW_TAG || body.dataParcTag !== COMPLETION_WINDOW_SIGNAL ||
      Object.entries(expected).some(([key,value]) => typeof body[key] !== 'string' || body[key] !== value) ||
      body.startAt !== undefined && !sameTime(body.startAt,proof.startAt) ||
      body.endAt !== undefined && !sameTime(body.endAt,proof.endAt)) throw conflict();
}

export async function ensureCompletionWindowSchema(database) {
  await database.prepare('CREATE TABLE IF NOT EXISTS blower_history_atomic_guard (id TEXT PRIMARY KEY NOT NULL,valid INTEGER NOT NULL CHECK(valid=1))').run();
  await database.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    request_id TEXT PRIMARY KEY NOT NULL,version INTEGER NOT NULL CHECK(version=1),asset_tag TEXT NOT NULL,
    start_at TEXT NOT NULL,end_at TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL
  )`).run();
}
export async function loadCompletionWindowIntent(database,requestId) {
  try { return await database.prepare(`SELECT * FROM ${TABLE} WHERE request_id=?`).bind(requestId).first(); }
  catch(error) { if (/no such table:.*blower_completion_window_intents_v1/i.test(String(error?.message || error))) return null; throw error; }
}
export function completionWindowQueueStatements(database,proof,requestId,createdAt) {
  if (!text(requestId) || requestId.length > 200 || !Number.isFinite(instant(createdAt))) throw conflict();
  const id = crypto.randomUUID();
  const row = {request_id:requestId,version:1,asset_tag:COMPLETION_WINDOW_TAG,start_at:proof.startAt,end_at:proof.endAt,
    snapshot_sha256:proof.snapshotSha256,snapshot_json:proof.snapshotJson,created_at:createdAt};
  return {before:[guard(database,id,proof.guards)],after:[insert(database,TABLE,row),database.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(id)]};
}
export async function validCompletionWindowReuse(database,requestId,proof) {
  const row = await loadCompletionWindowIntent(database,requestId);
  return !!row && row.version === 1 && row.asset_tag === COMPLETION_WINDOW_TAG && row.start_at === proof.startAt && row.end_at === proof.endAt &&
    row.snapshot_sha256 === proof.snapshotSha256 && row.snapshot_json === proof.snapshotJson;
}

function zeroWindow(probe,raw) {
  return probe?.assetTag === COMPLETION_WINDOW_TAG && probe.dataParcTag === COMPLETION_WINDOW_SIGNAL &&
    sameTime(probe.startAt,COMPLETION_WINDOW_START) && sameTime(probe.endAt,COMPLETION_WINDOW_END) &&
    sameTime(probe.observedAt,COMPLETION_WINDOW_END) && probe.startState === 'stopped' && probe.endState === 'stopped' &&
    probe.runningSeconds === 0 && probe.runtimeHours === 0 && raw.totalRunningHours === 0 && !raw.incremental &&
    raw.chunkCount === 1 && raw.completedChunkCount === 1 && Array.isArray(raw.chunks) && raw.chunks.length === 1 &&
    raw.chunks.every(chunk => sameTime(chunk.startAt,COMPLETION_WINDOW_START) && sameTime(chunk.endAt,COMPLETION_WINDOW_END) &&
      chunk.startState === 'stopped' && chunk.endState === 'stopped' && chunk.runningSeconds === 0 && chunk.totalRunningHours === 0);
}

function success(requestId,asset,replayed) {
  return json({ok:true,applied:!replayed,replayed,completionWindowRecovery:true,certificateOnly:true,requestId,
    assetTag:COMPLETION_WINDOW_TAG,dataParcTag:COMPLETION_WINDOW_SIGNAL,runtimeHours:Number(asset.cycle_runtime_hours),
    observedAt:asset.cycle_runtime_anchor_at,verifiedWindowStartAt:COMPLETION_WINDOW_START,verifiedWindowEndAt:COMPLETION_WINDOW_END,
    message:replayed ? '이미 반영한 정지 구간 검증입니다. 현재 누적값은 그대로 유지합니다.'
      : '교체 작업의 불확실 구간 전체가 RUN 0임을 확인했습니다. 기존 누적시간과 실제 교체시각 미기록 상태를 보존했습니다.'});
}

async function replayState(database,requestId,rawHash) {
  const auditId = COMPLETION_WINDOW_PREFIX + requestId, eventId = 'completion-window-v1:' + requestId;
  const result = await database.prepare(`SELECT r.request_type,r.status,r.result_json,a.id AS audit_id,a.action_type AS audit_action,
    a.tag_number AS audit_tag,a.after_json AS after_json,
    ${EVENT_COLUMNS.map(key => `e.${col(key)} AS ${col('event_'+key)}`).join(',')}
    FROM ois_data_requests r LEFT JOIN blower_history_asset_history a ON a.id=?
    LEFT JOIN blower_history_events e ON e.id=? OR (e.source_type=? AND e.source_log_id=r.id) WHERE r.id=?`)
    .bind(auditId,eventId,CERT_TYPE,requestId).all();
  const rows = result.results || [], row = rows[0];
  const events = rows.filter(item => item.event_id).map(item => Object.fromEntries(EVENT_COLUMNS.map(key => [key,item['event_'+key]])));
  const after = parse(row?.after_json);
  if (!row?.audit_id && !events.length) return {present:false,valid:false};
  return {present:true,valid:row?.request_type === 'blower_runtime_probe' && row.status === 'complete' &&
    typeof row.result_json === 'string' && await digest(row.result_json) === rawHash && row.audit_action === ACTION &&
    row.audit_tag === COMPLETION_WINDOW_TAG && after?.version === 1 && after.rawResultSha256 === rawHash &&
    after.requestId === requestId && events.length === 1 && EVENT_COLUMNS.every(key => events[0][key] === after.certificate?.[key])};
}

export async function applyCompletionWindowRecovery(database,user,body,adapters={}) {
  const requestId = text(body?.requestId), actor = text(user?.employeeNo);
  if (!actor) return json({ok:false,code:'BLOWER_COMPLETION_WINDOW_LOGIN_REQUIRED',message:'로그인이 필요합니다.'},401);
  if (!requestId || requestId.length > 200) return json({ok:false,code:'BLOWER_COMPLETION_WINDOW_REQUEST_REQUIRED',message:'검증할 조회 요청을 확인해 주세요.'},400);
  const request = await database.prepare('SELECT id,request_type,status,target_date,requested_by_id,result_json,completed_at FROM ois_data_requests WHERE id=?').bind(requestId).first();
  if (!request) return json({ok:false,code:'BLOWER_COMPLETION_WINDOW_REQUEST_NOT_FOUND',message:'정지 구간 조회를 찾지 못했습니다.'},404);
  if (request.requested_by_id !== actor && user.isSuperAdmin !== true) return json({ok:false,code:'BLOWER_COMPLETION_WINDOW_FORBIDDEN',message:'본인이 요청한 조회만 반영할 수 있습니다.'},403);
  if (request.request_type !== 'blower_runtime_probe' || request.status !== 'complete')
    return json({ok:false,code:'BLOWER_COMPLETION_WINDOW_NOT_COMPLETE',message:'정지 구간 조회가 완료된 뒤 검증할 수 있습니다.'},409);
  try {
    const intent = await adapters.loadRuntimeIntent(database,requestId), recovery = await loadCompletionWindowIntent(database,requestId);
    const snapshot = parse(recovery?.snapshot_json), original = snapshot?.asset, raw = parse(request.result_json);
    if (!recovery || recovery.version !== 1 || recovery.asset_tag !== COMPLETION_WINDOW_TAG ||
        typeof recovery.snapshot_json !== 'string' || new TextEncoder().encode(recovery.snapshot_json).length > MAX_SNAPSHOT_BYTES ||
        recovery.snapshot_sha256 !== await digest(recovery.snapshot_json) || snapshot?.version !== 1 ||
        original?.tag_number !== COMPLETION_WINDOW_TAG || original.cycle_start_state !== 'pending' || text(original.cycle_started_at) ||
        recovery.start_at !== COMPLETION_WINDOW_START || recovery.end_at !== COMPLETION_WINDOW_END ||
        snapshot.startAt !== recovery.start_at || snapshot.endAt !== recovery.end_at || snapshot.dataParcTag !== COMPLETION_WINDOW_SIGNAL ||
        !intent || !String(intent.reuse_key || '').startsWith(COMPLETION_WINDOW_PREFIX) || !raw ||
        raw.assetTag !== COMPLETION_WINDOW_TAG || raw.dataParcTag !== COMPLETION_WINDOW_SIGNAL ||
        !sameTime(raw.startAt,recovery.start_at) || !sameTime(raw.endAt,recovery.end_at) ||
        raw.expectedLastReplacementAt !== original.last_replacement_at || raw.expectedCycleStartState !== 'legacy' || raw.expectedCycleStartedAt ||
        raw.expectedCycleStartRevision !== 'signal-only-v1:'+original.cycle_start_revision ||
        raw.expectedCycleRuntimeRevision !== COMPLETION_WINDOW_PREFIX+original.cycle_runtime_revision ||
        request.target_date !== `v1|${COMPLETION_WINDOW_TAG}|${raw.startAt}|${raw.endAt}`) throw conflict();
    // The historical observation endpoint is intentional and fixed by the
    // source-pinned request. Only the historical age check is omitted. Raw
    // protocol/chunk validation and a separate fresh collection check remain.
    const validation = adapters.normalizeProbe(request.result_json,requestId,adapters.now,{skipFreshness:true});
    if (validation.error) return json({ok:false,code:validation.code,message:validation.error},400);
    const probe = validation.result;
    if (!adapters.matchesRuntimeIntent(intent,probe)) throw conflict();
    const rawHash = await digest(request.result_json);
    const replay = await replayState(database,requestId,rawHash);
    if (replay.present) {
      if (!replay.valid) throw failure('BLOWER_COMPLETION_WINDOW_IDEMPOTENCY_CONFLICT','같은 검증 요청의 반영 근거가 변경되어 다시 처리하지 않았습니다.');
      const current = await database.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').bind(COMPLETION_WINDOW_TAG).first();
      return success(requestId,current || original,true);
    }
    const nowDate = adapters.now instanceof Date ? adapters.now : new Date(), nowMs = nowDate.getTime();
    if (!Number.isFinite(nowMs) || [probe.collectedAt,request.completed_at,recovery.created_at].some(stamp =>
      !Number.isFinite(instant(stamp)) || instant(stamp) > nowMs+5*60000) ||
      [probe.collectedAt,request.completed_at].some(stamp => instant(stamp) < nowMs-15*60000) ||
      instant(probe.collectedAt) < instant(recovery.created_at)-5*60000 ||
      instant(request.completed_at) < instant(probe.collectedAt)-5*60000)
      throw failure('BLOWER_COMPLETION_WINDOW_COLLECTION_STALE','새로 수집한 정지 구간 결과의 시각을 확인할 수 없습니다. 기존 값을 유지합니다.');
    const asset = await database.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').bind(COMPLETION_WINDOW_TAG).first();
    const proof = await loadCompletionWindowRecoveryProof(database,asset,{now:nowDate});
    if (proof.snapshotJson !== recovery.snapshot_json || proof.snapshotSha256 !== recovery.snapshot_sha256) throw conflict();
    if (!zeroWindow(probe,raw)) throw failure('BLOWER_COMPLETION_WINDOW_NOT_ZERO',
      '교체 작업의 불확실 구간에서 RUN이 확인되었거나 연속 정지를 입증하지 못했습니다. 누적값은 유지하며 실제 교체 완료시각 확인이 필요합니다.');
    const now = nowDate.toISOString(), auditId = COMPLETION_WINDOW_PREFIX+requestId;
    const metadata = {version:1,kind:'completion_window_zero',requestId,auditId,completionClockKnown:false,
      durationEquivalent:true,windowStartAt:COMPLETION_WINDOW_START,windowEndAt:COMPLETION_WINDOW_END,
      runningSeconds:0,tagNumber:COMPLETION_WINDOW_TAG,dataParcTag:COMPLETION_WINDOW_SIGNAL,
      lastReplacementAt:asset.last_replacement_at,cycleStartRevision:asset.cycle_start_revision,
      baseEventId:proof.base.eventId,baseEventSha256:await digest(encode(identity(proof.receipt))),
      replacementEventId:proof.owner.id,replacementEventSha256:await digest(encode(identity(proof.owner))),
      sourceEventId:proof.sourceEvent.id,sourceEventSha256:await digest(encode(identity(proof.sourceEvent))),
      sources:proof.sources.identities,rawResultSha256:rawHash,
      sourceText:'교체 완료시각은 미기록입니다. 작업 구간 전체의 RUN 0을 검증하여 보존된 누적시간이 교체 이후 누적과 같음을 확인했습니다.'};
    const sourceText = JSON.stringify(metadata);
    if (sourceText.length > 2000) throw failure('BLOWER_COMPLETION_WINDOW_EVIDENCE_LIMIT','정지 구간 감사자료가 허용 길이를 초과하여 기존 값을 유지합니다.');
    const certificate = {id:'completion-window-v1:'+requestId,tag_number:COMPLETION_WINDOW_TAG,event_type:'cycle_source_reconcile',event_date:now,
      runtime_hours:0,issue_type:'교체 작업 구간 검증',action_type:'RUN 0 구간 확인',note:metadata.sourceText,
      source_type:CERT_TYPE,source_log_id:requestId,source_text:sourceText,created_by_id:actor,created_by_name:text(user.name),created_at:now,updated_at:now};
    const audit = {id:auditId,action_type:ACTION,tag_number:COMPLETION_WINDOW_TAG,before_json:recovery.snapshot_json,
      after_json:JSON.stringify({version:1,requestId,rawResultSha256:rawHash,certificateOnly:true,asset,certificate,
        zeroEvidence:{startAt:probe.startAt,endAt:probe.endAt,startState:probe.startState,endState:probe.endState,
          runningSeconds:0,collectedAt:probe.collectedAt,completedAt:request.completed_at}}),
      change_note:'교체 작업 구간 RUN 0 검증 · 교체 완료시각 미상 유지 · 기존 날짜/누적/원본 이력 보존',
      changed_by_id:actor,changed_by_name:text(user.name),changed_at:now};
    const ids = [crypto.randomUUID(),crypto.randomUUID()];
    try {
      await database.batch([
        guard(database,ids[0],[...proof.guards,exists('ois_data_requests',request),exists('blower_runtime_probe_intents_v5',intent),exists(TABLE,recovery)]),
        insert(database,'blower_history_asset_history',audit),insert(database,'blower_history_events',certificate),
        guard(database,ids[1],[exists('blower_history_assets',asset),eventsEqual(COMPLETION_WINDOW_TAG,[...proof.events,certificate]),exists('blower_history_asset_history',audit)]),
        database.prepare('DELETE FROM blower_history_atomic_guard WHERE id IN (?,?)').bind(...ids)
      ]);
    } catch(error) {
      if (!/CHECK constraint failed|UNIQUE constraint failed/i.test(String(error?.message || error))) throw error;
      const concurrent = await replayState(database,requestId,rawHash);
      if (concurrent.valid) return success(requestId,asset,true);
      if (concurrent.present) throw failure('BLOWER_COMPLETION_WINDOW_IDEMPOTENCY_CONFLICT','같은 검증 요청의 반영 근거가 변경되어 다시 처리하지 않았습니다.');
      throw conflict();
    }
    return success(requestId,asset,false);
  } catch(error) { if (error?.code && error?.status) return errorResponse(error); throw error; }
}

/* Every descendant must be a real immutable, contiguous append. An equal
 * counter, a new full query or a manual boundary cannot borrow this proof. */
function descendantOf(proof,baseEventId) {
  const byId = new Map(proof.events.map(row => [row.id,row]));
  let row = proof.receipt;
  const seen = new Set();
  // Rows are already loaded for normal append provenance. Bound the walk by
  // their unique IDs rather than expiring a valid certificate after N appends.
  while (row && !seen.has(row.id)) {
    seen.add(row.id);
    if (row.id === baseEventId) return row;
    const source = parse(row.source_text), link = incrementalEvidence(source);
    const previous = link && byId.get(link.baseEventId), old = parse(previous?.source_text);
    if (!source || !link || !previous || source.schemaVersion !== 1 || source.requestType !== 'blower_runtime_probe' ||
        old?.schemaVersion !== 1 || old.requestType !== 'blower_runtime_probe' ||
        row.id !== 'dataparc_runtime:'+source.requestId || row.source_log_id !== source.requestId ||
        previous.tag_number !== COMPLETION_WINDOW_TAG ||
        previous.event_type !== 'runtime_correction' || previous.source_type !== 'dataparc_runtime' ||
        previous.created_at !== previous.updated_at || row.created_at !== row.updated_at ||
        source.manualOverride || old?.manualOverride || source.replacementEdit || old?.replacementEdit ||
        source.requiresRunRefresh || old?.requiresRunRefresh || source.assetTag !== COMPLETION_WINDOW_TAG ||
        source.dataParcTag !== COMPLETION_WINDOW_SIGNAL || old?.assetTag !== source.assetTag || old.dataParcTag !== source.dataParcTag ||
        previous.id !== 'dataparc_runtime:'+old.requestId || previous.source_log_id !== old.requestId ||
        old.expectedLastReplacementAt !== source.expectedLastReplacementAt || old.expectedCycleStartRevision !== source.expectedCycleStartRevision ||
        old.expectedCycleStartState !== 'legacy' || old.expectedCycleStartedAt || old.signalOnlyCycle !== true ||
        !sameTime(previous.event_date,link.baseObservedAt) || !sameTime(old.observedAt || old.endAt,link.baseObservedAt) ||
        old.endState !== source.startState || !sameTime(link.coverageStartAt,RANGE_START)) return null;
    const oldLink = incrementalEvidence(old);
    const oldSeconds = oldLink?.totalRunningSeconds ?? old.runningSeconds;
    if (old.incremental && !oldLink || !sameTime(oldLink?.coverageStartAt || old.startAt,RANGE_START) ||
        !Number.isSafeInteger(oldSeconds) || oldSeconds !== link.baseRunningSeconds ||
        Math.abs(Number(previous.runtime_hours)-oldSeconds/3600) > 0.000001 ||
        Math.abs(Number(row.runtime_hours)-link.totalRunningSeconds/3600) > 0.000001 ||
        !Number.isSafeInteger(source.runningSeconds) || source.runningSeconds < 0 ||
        source.runningSeconds > (instant(source.observedAt || source.endAt)-instant(source.startAt))/1000) return null;
    row = previous;
  }
  return null;
}

/** Current source revalidation is read-only, including after ordinary appends. */
export async function loadCompletionWindowProjection(database,asset,events,options={}) {
  if (asset?.tag_number !== COMPLETION_WINDOW_TAG) return null;
  const certificates = events.filter(row => row.tag_number === COMPLETION_WINDOW_TAG && row.source_type === CERT_TYPE && row.event_type === 'cycle_source_reconcile');
  if (!certificates.length) return null;
  const proof = sameCurrentOwner(asset,events,replacementAutoCycleProof(asset,events));
  const now = options.now === undefined ? new Date() : options.now;
  if (!proof || !(now instanceof Date) || !Number.isFinite(now.getTime()) || instant(proof.base.observedAt) > now.getTime()) return null;
  const certificate = certificates.sort((a,b) => text(b.created_at).localeCompare(text(a.created_at)) || text(b.id).localeCompare(text(a.id)))[0];
  const meta = parse(certificate.source_text);
  if (certificate.created_at !== certificate.updated_at || meta?.version !== 1 || meta.kind !== 'completion_window_zero' ||
      meta.completionClockKnown !== false || meta.durationEquivalent !== true || meta.runningSeconds !== 0 ||
      meta.tagNumber !== COMPLETION_WINDOW_TAG || meta.dataParcTag !== COMPLETION_WINDOW_SIGNAL ||
      meta.lastReplacementAt !== asset.last_replacement_at || meta.cycleStartRevision !== asset.cycle_start_revision ||
      meta.windowStartAt !== COMPLETION_WINDOW_START || meta.windowEndAt !== COMPLETION_WINDOW_END ||
      certificate.id !== 'completion-window-v1:'+meta.requestId || certificate.source_log_id !== meta.requestId ||
      meta.auditId !== COMPLETION_WINDOW_PREFIX+meta.requestId || meta.replacementEventId !== proof.owner.id ||
      meta.sourceEventId !== proof.sourceEvent.id) return null;
  const base = descendantOf(proof,meta.baseEventId);
  if (!base || meta.baseEventSha256 !== await digest(encode(identity(base))) ||
      meta.replacementEventSha256 !== await digest(encode(identity(proof.owner))) ||
      meta.sourceEventSha256 !== await digest(encode(identity(proof.sourceEvent)))) return null;
  const audit = await database.prepare('SELECT * FROM blower_history_asset_history WHERE id=?').bind(meta.auditId).first();
  const after = parse(audit?.after_json), zero = after?.zeroEvidence;
  if (audit?.action_type !== ACTION || audit.tag_number !== COMPLETION_WINDOW_TAG || after?.version !== 1 ||
      after.requestId !== meta.requestId || after.rawResultSha256 !== meta.rawResultSha256 ||
      after.certificateOnly !== true || !zero || zero.runningSeconds !== 0 || zero.startState !== 'stopped' || zero.endState !== 'stopped' ||
      !sameTime(zero.startAt,COMPLETION_WINDOW_START) || !sameTime(zero.endAt,COMPLETION_WINDOW_END) ||
      IDENTITY_COLUMNS.some(key => certificate[key] !== after.certificate?.[key])) return null;
  try {
    const sources = await currentSources(database,proof,options);
    if (encode(meta.sources) !== encode(sources.identities)) return null;
  } catch(error) { if (error?.code && error?.status) return null; throw error; }
  return {version:1,kind:'completion_window_zero',durationVerified:true,completionClockKnown:false,certificateOnly:true,
    windowStartAt:COMPLETION_WINDOW_START,windowEndAt:COMPLETION_WINDOW_END,certificateEventId:certificate.id,
    requestId:meta.requestId,runtimeRequestId:proof.base.requestId,runtimeRevision:asset.cycle_runtime_revision,
    baseEventId:meta.baseEventId,cycleStartRevision:asset.cycle_start_revision,dataParcTag:COMPLETION_WINDOW_SIGNAL,
    sourceLogId:proof.automatic.sourceLogId,sourceSnapshotSha256:proof.automatic.sourceSnapshotSha256,
    verifiedAt:certificate.created_at};
}
