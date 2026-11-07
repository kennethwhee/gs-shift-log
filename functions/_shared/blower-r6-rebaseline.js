/* GS SHIFT LOG / R6 — Targeted, four-read, administrator-approved rebaseline.
 * This module NEVER changes the saved RUN counter on begin, advance or status.
 * It reuses the existing read-only Agent request contract; only approve commits.
 * All writes are D1 batch transactions guarded against changes in any source row.
 * The existing Agent's wire proof checks chunk continuity/total but does not
 * expose per-sample GOOD quality; R6 does not claim to certify that metadata.
 */
import {BOUNDARY_RECOVERY_TAG,BOUNDARY_RECOVERY_SIGNAL,BOUNDARY_RECOVERY_PREFIX,
  loadBoundaryRecoveryProof,loadBoundaryRecoveryIntent,boundaryTotalAgreement} from './blower-boundary-recovery-v1.js';
import {evaluateVerifiedRebaseline} from './blower-r6-evaluator.mjs';
import {buildBlowerRuntimeProbeChunks,convertBlowerRuntimeProbeIntentRow,
  normalizeBlowerRuntimeProbeResult} from '../api/ois-data-requests.js';

const CASE_TABLE='blower_r6_rebaseline_cases_v1', READ_TABLE='blower_r6_rebaseline_reads_v1';
const WIRE_PREFIX='r6-rebaseline-v1:', ROLES=['fullA','fullB','prefix','suffix'];
// Narrow operator-authorized fallback: the original R5 full proof only, never an independent four-read claim.
const R6_APPROX_MAX_SECONDS=120;
const text=v=>String(v??'').trim(), iso=v=>typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const same=(a,b)=>Number.isFinite(iso(a))&&iso(a)===iso(b);
const parse=v=>{try{return JSON.parse(v)}catch{return null}};
const error=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
const unavailable=()=>error('R6_PROOF_CHANGED','R6 조회의 교체 기준·이력 또는 원본 근거가 바뀌었습니다. 기존 값을 유지합니다.');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=v=>JSON.stringify(canonical(v));
const sha=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),x=>x.toString(16).padStart(2,'0')).join('');
const col=v=>'"'+v.replace(/"/g,'""')+'"';
const insert=(db,table,row)=>db.prepare(`INSERT INTO ${table} (${Object.keys(row).map(col).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row));
const exists=(table,row)=>({sql:`EXISTS (SELECT 1 FROM ${table} t CROSS JOIN json_each(?) j WHERE j.key='row' AND ${Object.keys(row).map(k=>`t.${col(k)} IS json_extract(j.value,'$.${k}')`).join(' AND ')})`,values:[JSON.stringify({row})]});
const guard=(db,id,checks)=>db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES (?,CASE WHEN ${checks.map(c=>'('+c.sql+')').join(' AND ')} THEN 1 ELSE 0 END)`).bind(id,...checks.flatMap(c=>c.values));
const failUnknown=e=>{if(e?.code&&e?.status)throw e;throw unavailable()};
const nowIso=()=>new Date().toISOString();
// Agent wire contract stores the queried wall-clock range in fixed KST RFC3339.
// The R5 proof normalizer returns UTC ISO; do not copy its spelling into a new intent.
const kstInstant=value=>{const ms=iso(value);if(!Number.isFinite(ms))throw unavailable();
  return new Date(ms+9*3600000).toISOString().replace('Z','+09:00');};
const actor=user=>text(user?.employeeNo);

export async function ensureR6Schema(db){
  await db.prepare('CREATE TABLE IF NOT EXISTS blower_history_atomic_guard (id TEXT PRIMARY KEY NOT NULL,valid INTEGER NOT NULL CHECK(valid=1))').run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${CASE_TABLE} (
    id TEXT PRIMARY KEY NOT NULL,version INTEGER NOT NULL CHECK(version=1),tag TEXT NOT NULL,
    actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,status TEXT NOT NULL,
    failure_request_id TEXT NOT NULL,conflict_full_id TEXT NOT NULL,
    start_at TEXT NOT NULL,cutoff_at TEXT NOT NULL,end_at TEXT NOT NULL,
    baseline_snapshot TEXT NOT NULL,baseline_sha TEXT NOT NULL,
    original_seconds INTEGER NOT NULL,failed_delta_seconds INTEGER NOT NULL,conflicting_full_seconds INTEGER NOT NULL,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,approved_by TEXT,approved_name TEXT,approved_at TEXT,
    approval_note TEXT,event_id TEXT)`).run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_blower_r6_active_v1 ON ${CASE_TABLE}(tag)
    WHERE status IN ('collecting','ready')`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${READ_TABLE} (
    session_id TEXT NOT NULL,role TEXT NOT NULL,request_id TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,
    PRIMARY KEY(session_id,role))`).run();
}

function adapters(){return {
  loadRuntimeIntent:(db,id)=>db.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(id).first(),
  normalizeProbe(raw,id,now,_options,intent){
    const decoded=parse(raw),v=normalizeBlowerRuntimeProbeResult(decoded,convertBlowerRuntimeProbeIntentRow(intent),id,now);
    if(v.error||!v.result)return v;
    return {result:{...v.result,rawStartAt:v.result.startAt,rawEndAt:v.result.endAt,runtimeHours:v.result.runningSeconds/3600}};
  },
  matchesRuntimeIntent(intent,probe){return !!intent&&intent.request_id===probe.requestId&&Number(intent.schema_version)===1&&
    intent.asset_tag===probe.assetTag&&intent.dataparc_tag===probe.dataParcTag&&same(intent.window_start,probe.rawStartAt)&&
    same(intent.window_end,probe.rawEndAt)&&intent.expected_last_replacement_at===probe.expectedLastReplacementAt&&
    intent.expected_cycle_start_state===probe.expectedCycleStartState&&
    intent.expected_cycle_started_at===probe.expectedCycleStartedAt&&
    intent.expected_cycle_start_revision===probe.expectedCycleStartRevision&&
    intent.expected_cycle_runtime_revision===probe.expectedCycleRuntimeRevision}
};}

async function baseProof(db,user,failedId){
  const asset=await db.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').bind(BOUNDARY_RECOVERY_TAG).first();
  if(!asset)throw unavailable();
  return loadBoundaryRecoveryProof(db,asset,BOUNDARY_RECOVERY_SIGNAL,failedId,user,
    {...adapters(),revalidateAccepted:true});
}

async function latestConflict(db,user){
  let rows;
  try{rows=await db.prepare(`SELECT * FROM blower_boundary_recovery_intents_v1
    WHERE asset_tag=? ORDER BY created_at DESC,request_id DESC LIMIT 32`).bind(BOUNDARY_RECOVERY_TAG).all();}
  catch(e){if(/no such table/i.test(String(e)))throw error('R6_NO_CONFLICT','R5 전체 재조회 증거 테이블이 없습니다. 기존 값을 유지합니다.');throw e;}
  // This is a read-only eligibility scan. Rejected records never authorize a
  // change. Counters contain no request IDs, employee IDs or raw OIS data.
  const rejects={owner:0,appendKeyRetired:0,baseChanged:0,snapshotChanged:0,
    fullUnavailable:0,fullKeyChanged:0,rawInvalid:0,notAboveExpected:0};
  let examined=0;
  for(const boundary of rows.results||[]){
    if(boundary.recovery_mode!=='append_boundary_full')continue;
    examined++;
    const frozen=parse(boundary.snapshot_json);
    if(!frozen?.actorId||(user?.isSuperAdmin!==true&&frozen.actorId!==actor(user))){rejects.owner++;continue;}
    let proof;
    try{proof=await baseProof(db,{employeeNo:frozen.actorId,isSuperAdmin:user?.isSuperAdmin===true},boundary.failure_request_id);}
    catch(e){
      if(e?.code==='BLOWER_BOUNDARY_RECOVERY_FORBIDDEN')throw e;
      // Old R5 requests can lose their *reusable queue key* when later reads
      // supersede them. This is not proof that the immutable source was valid;
      // unlike a retired full key, a retired failed-append key still needs a
      // separately reviewed snapshot verifier before any R6 approval.
      const originalIntent=await db.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v5 WHERE request_id=?')
        .bind(boundary.failure_request_id).first();
      if(originalIntent && originalIntent.reuse_key===null &&
         typeof frozen?.runtimeIntent?.reuse_key==='string' &&
         frozen.runtimeIntent.reuse_key.startsWith('append-v1:')) rejects.appendKeyRetired++;
      else rejects.baseChanged++;
      continue;
    }
    if(boundary.snapshot_sha256!==proof.snapshotSha256||boundary.snapshot_json!==proof.snapshotJson){rejects.snapshotChanged++;continue;}
    const fullRequest=await db.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(boundary.request_id).first();
    const fullIntent=await db.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(boundary.request_id).first();
    if(!fullRequest||fullRequest.status!=='complete'||fullRequest.request_type!=='blower_runtime_probe'||
       !fullIntent||!fullRequest.requested_by_id){rejects.fullUnavailable++;continue;}
    // The R5 queue may clear reuse_key to NULL when a newer request supersedes
    // this *completed* request. This field only gates queue reuse, not the
    // original DataPARC measurement. Accept NULL ONLY when the original frozen
    // snapshot, request ownership, full wire revision, measurement window and
    // raw R5 result are all revalidated below. An unrelated non-null key fails.
    const fullKey=fullIntent.reuse_key;
    if(!(fullKey===null||(typeof fullKey==='string'&&fullKey.startsWith(BOUNDARY_RECOVERY_PREFIX)))||
       fullIntent.expected_cycle_runtime_revision!==BOUNDARY_RECOVERY_PREFIX+proof.asset.cycle_runtime_revision||
       fullRequest.requested_by_id!==frozen.actorId||
       fullRequest.target_date!==`v1|${BOUNDARY_RECOVERY_TAG}|${fullIntent.window_start}|${fullIntent.window_end}`||
       !same(fullIntent.window_start,proof.startAt)||
       fullIntent.asset_tag!==BOUNDARY_RECOVERY_TAG||fullIntent.dataparc_tag!==BOUNDARY_RECOVERY_SIGNAL||
       fullIntent.expected_last_replacement_at!==proof.asset.last_replacement_at||
       fullIntent.expected_cycle_start_state!==proof.asset.cycle_start_state||
       fullIntent.expected_cycle_started_at!==text(proof.asset.cycle_started_at)||
       fullIntent.expected_cycle_start_revision!==text(proof.asset.cycle_start_revision)){
      rejects.fullKeyChanged++;continue;
    }
    const norm=normalizeBlowerRuntimeProbeResult(parse(fullRequest.result_json),
      convertBlowerRuntimeProbeIntentRow(fullIntent),fullRequest.id,new Date());
    if(norm.error||!norm.result||!same(norm.result.startAt,proof.startAt)||
       !same(norm.result.endAt,fullIntent.window_end)) {rejects.rawInvalid++;continue;}
    const full=norm.result,cutoff=proof.base.observedAt;
    const gap=(iso(full.endAt)-iso(proof.failedProbe.observedAt))/1000;
    const comparison=boundaryTotalAgreement(proof.base.runningSeconds,proof.failedProbe.runningSeconds,
      full.runningSeconds,gap,(iso(full.endAt)-iso(full.startAt))/1000);
    if(comparison.valid||comparison.reason!=='new_full_above_expected'||
       !Number.isFinite(iso(cutoff))||!(iso(full.endAt)>iso(cutoff))||
       !same(full.startAt,proof.startAt)||!same(proof.failedProbe.startAt,cutoff)){
      rejects.notAboveExpected++;continue;
    }
    return {proof,fullRequest,fullIntent,boundary,full,comparison};
  }
  // Never collapse incompatible evidence into an unexplained "not found".
  // The diagnostic does not assert which specific live row is authoritative.
  if(rejects.appendKeyRetired)throw error('R6_APPEND_RECEIPT_RETIRED',
    `R6 원본 이어조회 재사용키가 후속 조회로 정리돼 검증을 보류했습니다 (${rejects.appendKeyRetired}건). 저장된 원본과 최신 자료의 독립 대조가 필요합니다. 기존 누적값 유지.`);
  if(rejects.baseChanged||rejects.snapshotChanged)throw error('R6_BASE_PROOF_CHANGED',
    `R6 고정 근거가 현재 저장값·조회 이력과 일치하지 않아 검증을 보류했습니다 (기준 ${rejects.baseChanged}건, 스냅샷 ${rejects.snapshotChanged}건). 기존 누적값 유지.`);
  if(rejects.fullKeyChanged||rejects.rawInvalid||rejects.fullUnavailable)throw error('R6_FULL_SOURCE_INVALID',
    `R6 전체 조회 원본을 재검증하지 못했습니다 (요청 ${rejects.fullUnavailable}건, 연결키 ${rejects.fullKeyChanged}건, 결과 ${rejects.rawInvalid}건). 기존 누적값 유지.`);
  if(rejects.owner)throw error('R6_OWNER_MISMATCH',
    'R5 조회 작성자와 현재 검증 시작 계정이 다릅니다. 해당 조회 작성자 또는 최고관리자 권한을 확인해 주세요. 기존 누적값 유지.');
  if(rejects.notAboveExpected)throw error('R6_CONFLICT_NOT_REPRODUCED',
    `R6 현재 근거에서 +109초 유형의 초과 불일치가 재현되지 않았습니다 (${rejects.notAboveExpected}건). 기존 누적값 유지.`);
  throw error('R6_NO_VERIFIED_CONFLICT',
    `검증 가능한 R5 전체 RUN 불일치 기록이 없습니다 (검토 ${examined}건). 기존 누적값 유지.`);
}

async function lookupCase(db,id,user){
  let row;
  try{row=id?await db.prepare(`SELECT * FROM ${CASE_TABLE} WHERE id=?`).bind(id).first():
    await db.prepare(`SELECT * FROM ${CASE_TABLE} WHERE tag=? ORDER BY created_at DESC LIMIT 1`).bind(BOUNDARY_RECOVERY_TAG).first();}
  catch(e){if(/no such table/i.test(String(e)))return null;throw e;}
  if(row&&row.actor_id!==actor(user)&&user?.isSuperAdmin!==true)throw error('R6_FORBIDDEN','본인이 접수한 검증 또는 최고관리자 승인만 확인할 수 있습니다.',403);
  return row;
}
const caseData=row=>({id:row.id,status:row.status,tag:row.tag,startAt:row.start_at,
  cutoffAt:row.cutoff_at,endAt:row.end_at,previousHours:row.original_seconds/3600,
  deltaHours:row.failed_delta_seconds/3600,conflictingFullHours:row.conflicting_full_seconds/3600,
  originalSeconds:row.original_seconds,createdAt:row.created_at,approvedAt:row.approved_at||null,
  eventId:row.event_id||null});

async function loadProofForCase(db,row,user){
  // Recompute the entire R5 frozen asset/event/failed-append proof on every transition.
  const originalOwner=parse(row.baseline_snapshot)?.actorId;
  if(!originalOwner||(originalOwner!==row.actor_id&&user?.isSuperAdmin!==true))throw unavailable();
  const proof=await baseProof(db,{employeeNo:originalOwner,isSuperAdmin:user?.isSuperAdmin===true},row.failure_request_id);
  if(proof.snapshotSha256!==row.baseline_sha||proof.snapshotJson!==row.baseline_snapshot||
     !same(proof.startAt,row.start_at)||!same(proof.base.observedAt,row.cutoff_at)||
     proof.base.runningSeconds!==row.original_seconds||proof.failedProbe.runningSeconds!==row.failed_delta_seconds)
    throw unavailable();
  const fullRequest=await db.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(row.conflict_full_id).first();
  const fullIntent=await db.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(row.conflict_full_id).first();
  const boundary=await loadBoundaryRecoveryIntent(db,row.conflict_full_id);
  if(!fullRequest||fullRequest.status!=='complete'||!fullIntent||!boundary||
     boundary.snapshot_json!==proof.snapshotJson||!same(fullIntent.window_start,row.start_at)||
     !same(fullIntent.window_end,row.end_at)||
     fullIntent.expected_cycle_runtime_revision!==BOUNDARY_RECOVERY_PREFIX+proof.asset.cycle_runtime_revision)
    throw unavailable();
  const norm=normalizeBlowerRuntimeProbeResult(parse(fullRequest.result_json),convertBlowerRuntimeProbeIntentRow(fullIntent),fullRequest.id,new Date());
  if(norm.error||!norm.result||norm.result.runningSeconds!==row.conflicting_full_seconds)throw unavailable();
  return {proof,fullRequest,fullIntent,boundary};
}

async function loadReads(db,row){
  const rs=await db.prepare(`SELECT * FROM ${READ_TABLE} WHERE session_id=? ORDER BY created_at,role`).bind(row.id).all();
  const found=new Map();
  for(const r of rs.results||[]){
    if(!ROLES.includes(r.role)||found.has(r.role))throw unavailable();
    const req=await db.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(r.request_id).first();
    const intent=await db.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(r.request_id).first();
    if(!req||!intent)throw unavailable();
    found.set(r.role,{row:r,request:req,intent});
  }
  return found;
}
const roleRange=(row,role)=>['fullA','fullB'].includes(role)?[row.start_at,row.end_at]:
  role==='prefix'?[row.start_at,row.cutoff_at]:[row.cutoff_at,row.end_at];

function validateRead(row,role,item){
  const {request:req,intent}=item, [begin,end]=roleRange(row,role);
  if(req.status!=='complete'||req.request_type!=='blower_runtime_probe'||req.requested_by_id!==row.actor_id||
     req.target_date!==`v1|${row.tag}|${intent.window_start}|${intent.window_end}`||
     req.id!==item.row.request_id||intent.request_id!==req.id||Number(intent.schema_version)!==1||
     intent.asset_tag!==row.tag||intent.dataparc_tag!==BOUNDARY_RECOVERY_SIGNAL||
     !same(intent.window_start,begin)||!same(intent.window_end,end)||
     intent.reuse_key!==WIRE_PREFIX+row.id+':'+role||
     intent.expected_cycle_runtime_revision!==WIRE_PREFIX+parse(row.baseline_snapshot)?.asset?.cycle_runtime_revision||
     !same(req.requested_at,item.row.created_at)||!Number.isFinite(iso(req.completed_at))||
     !(iso(req.completed_at)>iso(req.requested_at)))throw unavailable();
  const raw=parse(req.result_json),norm=normalizeBlowerRuntimeProbeResult(raw,convertBlowerRuntimeProbeIntentRow(intent),req.id,new Date());
  if(norm.error||!norm.result||!same(norm.result.startAt,begin)||!same(norm.result.endAt,end)||
     !same(norm.result.observedAt,end)||norm.result.assetTag!==row.tag||
     norm.result.dataParcTag!==BOUNDARY_RECOVERY_SIGNAL||
     !Number.isFinite(iso(norm.result.collectedAt))||iso(norm.result.collectedAt)<iso(req.requested_at)||
     iso(norm.result.collectedAt)>iso(req.completed_at)+300000||
     raw?.fromCachedResult===true||raw?.fromManualOverride===true||raw?.estimated===true||
     (raw?.missingSeconds!==undefined&&raw.missingSeconds!==0)||
     (raw?.badQualitySeconds!==undefined&&raw.badQualitySeconds!==0)||
     (raw?.estimatedSeconds!==undefined&&raw.estimatedSeconds!==0)||
     (Array.isArray(raw?.chunks)&&raw.chunks.some(chunk=>
       (chunk.missingSeconds!==undefined&&chunk.missingSeconds!==0)||
       (chunk.badQualitySeconds!==undefined&&chunk.badQualitySeconds!==0)||
       (chunk.estimatedSeconds!==undefined&&chunk.estimatedSeconds!==0)||
       chunk.fromCachedResult===true||chunk.estimated===true))||
     !['running','stopped'].includes(norm.result.startState)||
     !['running','stopped'].includes(norm.result.endState))throw error('R6_READ_INVALID',role+' 조회의 원본·기간·상태·수집시각이 일치하지 않습니다.');
  return {requestId:req.id,requestType:req.request_type,status:req.status,tag:row.tag,signal:BOUNDARY_RECOVERY_SIGNAL,
    startAt:norm.result.startAt,endAt:norm.result.endAt,observedAt:norm.result.observedAt,
    collectedAt:norm.result.collectedAt,runningSeconds:norm.result.runningSeconds,
    startState:norm.result.startState,endState:norm.result.endState,
    expectedRevision:parse(row.baseline_snapshot).asset.cycle_runtime_revision,
    expectedReplacementAt:parse(row.baseline_snapshot).asset.last_replacement_at,
    requestedBy:row.actor_id,requestCreatedAt:req.requested_at,completedAt:req.completed_at,
    coverageComplete:true,contractValidated:true,fromCachedResult:false,fromManualOverride:false};
}

async function evaluateCase(db,row,items){
  if(ROLES.some(role=>!items.has(role)||items.get(role).request.status!=='complete'))return null;
  const reads=Object.fromEntries(ROLES.map(role=>[role,validateRead(row,role,items.get(role))]));
  const proposal=evaluateVerifiedRebaseline({baseline:{tag:row.tag,signal:BOUNDARY_RECOVERY_SIGNAL,
    actorId:row.actor_id,cycleRevision:parse(row.baseline_snapshot).asset.cycle_runtime_revision,
    lastReplacementAt:parse(row.baseline_snapshot).asset.last_replacement_at,
    lastState:parse(row.baseline_snapshot).asset.cycle_runtime_state,
    savedSeconds:row.original_seconds,failedAppendSeconds:row.failed_delta_seconds,
    startAt:row.start_at,cutoffAt:row.cutoff_at,endAt:row.end_at,snapshotSha256:row.baseline_sha},
    reads,freshSnapshotSha256:row.baseline_sha});
  if(proposal.status==='blocked')throw error(proposal.code,proposal.message);
  return {proposal,reads};
}

// R6 approximate acceptance is NOT four-independent-read certification. It is a
// separate, explicit administrator-reviewed resolution of a prior *completed*
// R5 whole-range probe with a bounded discrepancy. All original source rows
// are snapshotted again at approval. Never translate a failed R6 read to success.
const explicitBadQuality=raw=>raw?.fromCachedResult===true||raw?.fromManualOverride===true||
  raw?.estimated===true||['missingSeconds','badQualitySeconds','estimatedSeconds'].some(k=>
    raw?.[k]!==undefined&&raw[k]!==0)||
  (Array.isArray(raw?.chunks)&&raw.chunks.some(ch=>ch.fromCachedResult===true||ch.estimated===true||
    ['missingSeconds','badQualitySeconds','estimatedSeconds'].some(k=>ch[k]!==undefined&&ch[k]!==0)));

async function approximateEvidence(db,row,user,items){
  if(row.status!=='collecting'||user?.isSuperAdmin!==true)return null;
  if(!items.get('fullA')||items.get('fullA').request.status!=='failed'||
     [...items.values()].some(x=>x.row.role!=='fullA'))return null;
  const expected=row.original_seconds+row.failed_delta_seconds;
  const difference=row.conflicting_full_seconds-expected;
  if(!Number.isSafeInteger(expected)||expected<=0||!Number.isSafeInteger(difference)||
     difference<=0||difference>R6_APPROX_MAX_SECONDS||
     difference*10000>row.conflicting_full_seconds)return null;
  const sources=await loadProofForCase(db,row,user);
  const {proof,fullRequest,fullIntent}=sources;
  const appendRequest=await db.prepare('SELECT * FROM ois_data_requests WHERE id=?')
    .bind(row.failure_request_id).first();
  if(!appendRequest||appendRequest.status!=='complete'||
     explicitBadQuality(parse(appendRequest.result_json))||explicitBadQuality(parse(fullRequest.result_json))||
     fullRequest.requested_by_id!==parse(row.baseline_snapshot)?.actorId)return null;
  const normalized=normalizeBlowerRuntimeProbeResult(parse(fullRequest.result_json),
    convertBlowerRuntimeProbeIntentRow(fullIntent),fullRequest.id,new Date());
  if(normalized.error||!normalized.result||normalized.result.runningSeconds!==row.conflicting_full_seconds||
    !same(normalized.result.startAt,row.start_at)||!same(normalized.result.endAt,row.end_at)||
    normalized.result.observedAt!==normalized.result.endAt||
    !['running','stopped'].includes(normalized.result.endState)||
    !Number.isSafeInteger(proof.base.runningSeconds)||
    !Number.isSafeInteger(proof.failedProbe.runningSeconds))return null;
  return {differenceSeconds:difference,maxDifferenceSeconds:R6_APPROX_MAX_SECONDS,
    previousHours:row.original_seconds/3600,remeasuredHours:row.conflicting_full_seconds/3600,
    expectedHours:expected/3600,limitPercent:0.01,
    mode:'approximate_r5_acceptance_not_four_read_certification',sources,full:normalized.result,appendRequest};
}

async function ensureStatus(db,row,user){
  const items=await loadReads(db,row);
  const result={ok:true,case:caseData(row),stage:ROLES.map(role=>({role,
    status:items.get(role)?.request.status||'not_requested',
    requestId:items.get(role)?.request.id||null}))};
  if(row.status==='ready'||row.status==='collecting'){
    if(ROLES.every(role=>items.get(role)?.request.status==='complete')){
      await loadProofForCase(db,row,user);
      result.proposal=(await evaluateCase(db,row,items))?.proposal||null;
    }
  }
  if(row.status==='collecting'&&user?.isSuperAdmin===true && items.get('fullA')?.request.status==='failed'){
    try{const approx=await approximateEvidence(db,row,user,items);
      if(approx)result.approxCandidate={differenceSeconds:approx.differenceSeconds,
        maxDifferenceSeconds:approx.maxDifferenceSeconds,previousHours:approx.previousHours,
        remeasuredHours:approx.remeasuredHours,expectedHours:approx.expectedHours,limitPercent:approx.limitPercent,
        mode:approx.mode};}
    catch{result.approxCandidate=null;}
  }
  return result;
}

export async function r6Status(db,user,id){
  const row=await lookupCase(db,text(id),user);
  return row?await ensureStatus(db,row,user):{ok:true,case:null,stage:[]};
}

export async function r6Begin(db,user){
  const who=actor(user);if(!who)throw error('R6_AUTH_REQUIRED','로그인이 필요합니다.',401);
  await ensureR6Schema(db);
  const current=await lookupCase(db,'',user);
  if(current&&['collecting','ready'].includes(current.status))return ensureStatus(db,current,user);
  const src=await latestConflict(db,user);
  const {proof,fullRequest,fullIntent,boundary,full}=src;
  const row={id:crypto.randomUUID(),version:1,tag:BOUNDARY_RECOVERY_TAG,actor_id:who,
    actor_name:text(user.name),status:'collecting',failure_request_id:proof.failureRequestId,
    conflict_full_id:fullRequest.id,start_at:kstInstant(proof.startAt),cutoff_at:kstInstant(proof.base.observedAt),
    end_at:kstInstant(full.endAt),baseline_snapshot:proof.snapshotJson,baseline_sha:proof.snapshotSha256,
    original_seconds:proof.base.runningSeconds,failed_delta_seconds:proof.failedProbe.runningSeconds,
    conflicting_full_seconds:full.runningSeconds,created_at:nowIso(),updated_at:nowIso(),
    approved_by:null,approved_name:null,approved_at:null,approval_note:null,event_id:null};
  const before=crypto.randomUUID(),checks=[...proof.guards,exists('ois_data_requests',fullRequest),
    exists('blower_runtime_probe_intents_v5',fullIntent),exists('blower_boundary_recovery_intents_v1',boundary)];
  try{await db.batch([guard(db,before,checks),insert(db,CASE_TABLE,row),
    db.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(before)]);}
  catch(e){if(/UNIQUE constraint failed/i.test(String(e))){const existing=await lookupCase(db,'',user);if(existing&&['collecting','ready'].includes(existing.status))return ensureStatus(db,existing,user);}throw e;}
  return ensureStatus(db,row,user);
}

export async function r6Advance(db,user,sessionId){
  const row=await lookupCase(db,text(sessionId),user);
  if(!row)throw error('R6_NOT_FOUND','R6 검증 요청을 찾을 수 없습니다.',404);
  if(row.actor_id!==actor(user))throw error('R6_FORBIDDEN','검증 요청 작성자만 새 조회를 접수할 수 있습니다.',403);
  if(!['collecting','ready'].includes(row.status))return ensureStatus(db,row,user);
  const {proof,fullRequest,fullIntent,boundary}=await loadProofForCase(db,row,user);
  const items=await loadReads(db,row);
  const missing=ROLES.find(role=>!items.has(role));
  if(!missing){
    const failed=ROLES.find(role=>items.get(role).request.status==='failed');
    if(failed)throw error('R6_READ_FAILED',failed+' 조회가 실패했습니다. 누적값은 유지되며 새 검증 시작이 필요합니다.');
    if(ROLES.some(role=>items.get(role).request.status!=='complete'))return ensureStatus(db,row,user);
    const evidence=await evaluateCase(db,row,items);
    if(row.status==='collecting')await db.prepare(`UPDATE ${CASE_TABLE} SET status=?,updated_at=? WHERE id=? AND status='collecting'`).bind(
      evidence.proposal.status==='no_correction_needed'?'no_change':'ready',nowIso(),row.id).run();
    const updated=await lookupCase(db,row.id,user);return ensureStatus(db,updated,user);
  }
  const prior=ROLES[ROLES.indexOf(missing)-1];
  if(prior){
    const prev=items.get(prior);
    if(!prev||prev.request.status!=='complete')return ensureStatus(db,row,user);
    validateRead(row,prior,prev);
  }
  const [startAt,endAt]=roleRange(row,missing);
  const chunks=buildBlowerRuntimeProbeChunks(startAt,endAt);
  if(!chunks.length||chunks.length>12||iso(endAt)>Date.now()||iso(startAt)<iso(proof.asset.last_replacement_at))
    throw error('R6_RANGE_INVALID','검증 기간·교체 기준이 허용 범위에 있지 않습니다.');
  const requestId=crypto.randomUUID(),requestedAt=nowIso(),expiresAt=new Date(Date.now()+2*60*60*1000).toISOString();
  if(prior&&iso(requestedAt)<=iso(items.get(prior).request.completed_at))throw error('R6_INDEPENDENCE_RETRY','독립 측정의 시작시각이 이전 완료시각보다 늦어야 합니다.');
  const request={id:requestId,request_type:'blower_runtime_probe',target_date:`v1|${row.tag}|${startAt}|${endAt}`,
    status:'pending',requested_by_id:row.actor_id,requested_by_name:row.actor_name,requested_at:requestedAt,
    started_at:null,completed_at:null,agent_id:'',result_json:null,error_message:'',expires_at:expiresAt,updated_at:requestedAt};
  const asset=proof.asset;
  const intent={request_id:requestId,reuse_key:WIRE_PREFIX+row.id+':'+missing,schema_version:1,
    asset_tag:row.tag,dataparc_tag:BOUNDARY_RECOVERY_SIGNAL,window_start:startAt,window_end:endAt,
    chunk_days:31,chunk_count:chunks.length,expected_last_replacement_at:asset.last_replacement_at,
    expected_cycle_start_state:asset.cycle_start_state,expected_cycle_started_at:text(asset.cycle_started_at),
    expected_cycle_start_revision:text(asset.cycle_start_revision),
    expected_cycle_runtime_revision:WIRE_PREFIX+asset.cycle_runtime_revision,
    created_at:requestedAt,updated_at:requestedAt};
  if(intent.expected_cycle_runtime_revision.length>200||!['legacy','started'].includes(asset.cycle_start_state))throw unavailable();
  const read={session_id:row.id,role:missing,request_id:requestId,created_at:requestedAt};
  const proofChecks=[...proof.guards,exists(CASE_TABLE,row),exists('ois_data_requests',fullRequest),
    exists('blower_runtime_probe_intents_v5',fullIntent),exists('blower_boundary_recovery_intents_v1',boundary),
    ...[...items.values()].flatMap(item=>[exists(READ_TABLE,item.row),exists('ois_data_requests',item.request),exists('blower_runtime_probe_intents_v5',item.intent)])];
  const guardId=crypto.randomUUID();
  await db.batch([guard(db,guardId,proofChecks),insert(db,'ois_data_requests',request),
    insert(db,'blower_runtime_probe_intents_v5',intent),insert(db,READ_TABLE,read),
    db.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(guardId)]);
  return ensureStatus(db,row,user);
}

export async function r6Apply(db,user,sessionId,confirmation,note){
  if(user?.isSuperAdmin!==true)throw error('R6_APPROVAL_FORBIDDEN','R6 누적 재기준화 승인은 최고관리자만 가능합니다.',403);
  if(confirmation!==BOUNDARY_RECOVERY_TAG||text(note).length<10||text(note).length>500)
    throw error('R6_APPROVAL_INCOMPLETE','대상 TAG와 정정 사유 10~500자를 입력해 주세요.',400);
  const row=await lookupCase(db,text(sessionId),user);
  if(!row)throw error('R6_NOT_FOUND','R6 검증 요청을 찾을 수 없습니다.',404);
  if(row.status==='applied')return ensureStatus(db,row,user);
  if(row.status!=='ready')throw error('R6_NOT_READY','독립 실측 4건이 모두 검증되기 전에는 누적값을 수정하지 않습니다.');
  const {proof,fullRequest,fullIntent,boundary}=await loadProofForCase(db,row,user);
  const items=await loadReads(db,row),data=await evaluateCase(db,row,items);
  if(!data||data.proposal.status!=='requires_authorized_review'||data.proposal.authorizedToWrite!==false)
    throw error('R6_EVIDENCE_REQUIRED','검증된 정정안이 없어 기존 누적값을 유지합니다.');
  const {proposal,reads}=data,full=reads.fullA,asset=proof.asset;
  const fullNorm=normalizeBlowerRuntimeProbeResult(parse(items.get('fullA').request.result_json),
    convertBlowerRuntimeProbeIntentRow(items.get('fullA').intent),full.requestId,new Date());
  if(fullNorm.error||!fullNorm.result||fullNorm.result.runningSeconds!==proposal.proposedSeconds)throw unavailable();
  const result=fullNorm.result;
  const requestHashes=await Promise.all(ROLES.map(async role=>[role,await sha(items.get(role).request.result_json)]));
  const id='dataparc_runtime:'+full.requestId,nextRev=crypto.randomUUID(),now=nowIso();
  const hours=proposal.proposedSeconds/3600,runState=result.endState;
  const sourceText=JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',requestId:full.requestId,
    assetTag:row.tag,dataParcTag:BOUNDARY_RECOVERY_SIGNAL,startAt:row.start_at,endAt:row.end_at,
    observedAt:row.end_at,expectedLastReplacementAt:asset.last_replacement_at,
    expectedCycleStartState:asset.cycle_start_state,expectedCycleStartedAt:text(asset.cycle_started_at),
    expectedCycleStartRevision:text(asset.cycle_start_revision),expectedCycleRuntimeRevision:asset.cycle_runtime_revision,
    startState:result.startState,endState:runState,totalRunningHours:hours,runningSeconds:proposal.proposedSeconds,
    chunkCount:result.chunkCount,collectedAt:result.collectedAt,
    r6VerifiedRebaseline:{version:1,caseId:row.id,baselineSha256:row.baseline_sha,
      previousSeconds:row.original_seconds,failedAppendSeconds:row.failed_delta_seconds,
      historicalDifferenceSeconds:proposal.historicalDifferenceSeconds,
      totalDifferenceSeconds:proposal.totalDifferenceSeconds,requests:Object.fromEntries(ROLES.map(r=>[r,items.get(r).request.id])),
      rawResultSha256:Object.fromEntries(requestHashes),approvedBy:actor(user),approvedAt:now,approvalNote:text(note)}});
  const display=`R6 검증형 누적 재기준화 · 이전 ${(row.original_seconds/3600).toFixed(3)}h → 검증 ${(hours).toFixed(3)}h · 4개 독립 DataPARC 요청 · ${text(note)}`;
  const event={id,tag_number:row.tag,event_type:'runtime_correction',event_date:row.end_at,
    runtime_hours:hours,issue_type:'DataPARC',action_type:'R6 검증형 누적 재기준화',note:display.slice(0,2000),
    source_type:'dataparc_runtime',source_log_id:full.requestId,source_text:sourceText,
    created_by_id:actor(user),created_by_name:text(user.name),created_at:now,updated_at:now};
  const checks=[...proof.guards,exists(CASE_TABLE,row),exists('ois_data_requests',fullRequest),
    exists('blower_runtime_probe_intents_v5',fullIntent),exists('blower_boundary_recovery_intents_v1',boundary),
    ...[...items.values()].flatMap(item=>[exists(READ_TABLE,item.row),exists('ois_data_requests',item.request),exists('blower_runtime_probe_intents_v5',item.intent)]),
    {sql:'NOT EXISTS (SELECT 1 FROM blower_history_events WHERE id=? OR (source_type=? AND source_log_id=?))',values:[id,'dataparc_runtime',full.requestId]}];
  const guardId=crypto.randomUUID(),postId=crypto.randomUUID();
  const post={sql:`EXISTS (SELECT 1 FROM blower_history_assets WHERE tag_number=? AND cycle_runtime_revision=? AND
      cycle_runtime_anchor_at=? AND cycle_runtime_state=? AND ABS(cycle_runtime_hours-?)<0.000001 AND
      ABS(runtime_hours-?)<0.000001 AND last_modified_by_id=? AND updated_at=?) AND
      EXISTS (SELECT 1 FROM blower_history_events WHERE id=? AND tag_number=? AND source_text=? AND
      source_type='dataparc_runtime' AND source_log_id=?) AND
      EXISTS (SELECT 1 FROM ${CASE_TABLE} WHERE id=? AND status='applied' AND event_id=?)`,
    values:[row.tag,nextRev,row.end_at,runState,hours,hours,actor(user),now,id,row.tag,sourceText,full.requestId,row.id,id]};
  await db.batch([guard(db,guardId,checks),
    db.prepare(`UPDATE blower_history_assets SET runtime_hours=?,runtime_anchor_at=?,is_running=?,
      cycle_runtime_hours=?,cycle_runtime_anchor_at=?,cycle_runtime_state=?,cycle_runtime_revision=?,
      last_modified_by_id=?,last_modified_by_name=?,updated_at=? WHERE tag_number=? AND enabled=1 AND
      cycle_runtime_revision=? AND cycle_runtime_anchor_at=? AND ABS(cycle_runtime_hours-?)<0.000001`)
      .bind(hours,runState==='running'?row.end_at:null,runState==='running'?1:0,hours,row.end_at,runState,nextRev,
        actor(user),text(user.name),now,row.tag,asset.cycle_runtime_revision,asset.cycle_runtime_anchor_at,Number(asset.cycle_runtime_hours)),
    db.prepare(`INSERT INTO blower_history_events (${Object.keys(event).map(col).join(',')})
      SELECT ${Object.keys(event).map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM blower_history_assets WHERE tag_number=? AND cycle_runtime_revision=?)`)
      .bind(...Object.values(event),row.tag,nextRev),
    db.prepare(`UPDATE ${CASE_TABLE} SET status='applied',updated_at=?,approved_by=?,approved_name=?,
      approved_at=?,approval_note=?,event_id=? WHERE id=? AND status='ready'`)
      .bind(now,actor(user),text(user.name),now,text(note),id,row.id),
    guard(db,postId,[post]),
    db.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(guardId),
    db.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(postId)]);
  return ensureStatus(db,await lookupCase(db,row.id,user),user);
}


export async function r6AcceptApprox(db,user,sessionId,confirmation,note){
  if(user?.isSuperAdmin!==true)throw error('R6_APPROVAL_FORBIDDEN','R6 누적 재기준화 승인은 최고관리자만 가능합니다.',403);
  if(confirmation!==BOUNDARY_RECOVERY_TAG||text(note).length<10||text(note).length>500)
    throw error('R6_APPROVAL_INCOMPLETE','대상 TAG와 정정 사유 10~500자를 입력해 주세요.',400);
  const row=await lookupCase(db,text(sessionId),user);
  if(!row)throw error('R6_NOT_FOUND','R6 검증 요청을 찾을 수 없습니다.',404);
  if(row.status==='applied_approx')return ensureStatus(db,row,user);
  if(row.status!=='collecting')throw error('R6_APPROX_NOT_ELIGIBLE','검증을 완료할 수 있는 기존 조회 기록이 없습니다.');
  const items=await loadReads(db,row);
  const approx=await approximateEvidence(db,row,user,items);
  if(!approx)throw error('R6_APPROX_NOT_ELIGIBLE',
    'R5 정상 전체 조회와 저장된 누적값의 차이가 120초 이내라는 근거가 없습니다. 기존 누적시간을 유지합니다.');
  const {proof,fullRequest,fullIntent,boundary}=approx.sources;
  const result=approx.full,asset=proof.asset;
  const id='dataparc_runtime:'+fullRequest.id,nextRev=crypto.randomUUID(),now=nowIso();
  const hours=result.runningSeconds/3600,runState=result.endState;
  const sourceText=JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',requestId:fullRequest.id,
    assetTag:row.tag,dataParcTag:BOUNDARY_RECOVERY_SIGNAL,startAt:row.start_at,endAt:row.end_at,
    observedAt:row.end_at,expectedLastReplacementAt:asset.last_replacement_at,
    expectedCycleStartState:asset.cycle_start_state,expectedCycleStartedAt:text(asset.cycle_started_at),
    expectedCycleStartRevision:text(asset.cycle_start_revision),expectedCycleRuntimeRevision:asset.cycle_runtime_revision,
    startState:result.startState,endState:runState,totalRunningHours:hours,runningSeconds:result.runningSeconds,
    chunkCount:result.chunkCount,collectedAt:result.collectedAt,
    r6ApproximateAcceptance:{version:1,notFourReadCertified:true,caseId:row.id,
      baselineSha256:row.baseline_sha,previousSeconds:row.original_seconds,
      failedAppendSeconds:row.failed_delta_seconds,wholeRangeSeconds:result.runningSeconds,
      differenceSeconds:approx.differenceSeconds,maxDifferenceSeconds:R6_APPROX_MAX_SECONDS,
      percentLimit:approx.limitPercent,proofRequestIds:[row.failure_request_id,fullRequest.id],
      proofRawSha256:{failedAppend:await sha(approx.appendRequest.result_json),whole:await sha(fullRequest.result_json)},
      rejectedIndependentReadId:items.get('fullA').request.id,
      approvedBy:actor(user),approvedAt:now,approvalNote:text(note)}});
  const display=`R6 근사 확인(독립 4회 미완료) · 이전 ${(row.original_seconds/3600).toFixed(3)}h → R5 전체 실측 ${(hours).toFixed(3)}h · 차이 ${approx.differenceSeconds}초/허용 120초 · ${text(note)}`;
  const event={id,tag_number:row.tag,event_type:'runtime_correction',event_date:row.end_at,
    runtime_hours:hours,issue_type:'DataPARC',action_type:'R6 근사 확인 누적 반영',note:display.slice(0,2000),
    source_type:'dataparc_runtime',source_log_id:fullRequest.id,source_text:sourceText,
    created_by_id:actor(user),created_by_name:text(user.name),created_at:now,updated_at:now};
  const checks=[...proof.guards,exists(CASE_TABLE,row),exists('ois_data_requests',fullRequest),
    exists('blower_runtime_probe_intents_v5',fullIntent),exists('blower_boundary_recovery_intents_v1',boundary),
    ...[...items.values()].flatMap(item=>[exists(READ_TABLE,item.row),exists('ois_data_requests',item.request),exists('blower_runtime_probe_intents_v5',item.intent)]),
    {sql:'NOT EXISTS (SELECT 1 FROM blower_history_events WHERE id=? OR (source_type=? AND source_log_id=?))',values:[id,'dataparc_runtime',fullRequest.id]}];
  const guardId=crypto.randomUUID(),postId=crypto.randomUUID();
  const post={sql:`EXISTS (SELECT 1 FROM blower_history_assets WHERE tag_number=? AND cycle_runtime_revision=? AND
      cycle_runtime_anchor_at=? AND cycle_runtime_state=? AND ABS(cycle_runtime_hours-?)<0.000001 AND
      ABS(runtime_hours-?)<0.000001 AND last_modified_by_id=? AND updated_at=?) AND
      EXISTS (SELECT 1 FROM blower_history_events WHERE id=? AND tag_number=? AND source_text=? AND
      source_type='dataparc_runtime' AND source_log_id=?) AND
      EXISTS (SELECT 1 FROM ${CASE_TABLE} WHERE id=? AND status='applied_approx' AND event_id=?)`,
    values:[row.tag,nextRev,row.end_at,runState,hours,hours,actor(user),now,id,row.tag,sourceText,fullRequest.id,row.id,id]};
  await db.batch([guard(db,guardId,checks),
    db.prepare(`UPDATE blower_history_assets SET runtime_hours=?,runtime_anchor_at=?,is_running=?,
      cycle_runtime_hours=?,cycle_runtime_anchor_at=?,cycle_runtime_state=?,cycle_runtime_revision=?,
      last_modified_by_id=?,last_modified_by_name=?,updated_at=? WHERE tag_number=? AND enabled=1 AND
      cycle_runtime_revision=? AND cycle_runtime_anchor_at=? AND ABS(cycle_runtime_hours-?)<0.000001`)
      .bind(hours,runState==='running'?row.end_at:null,runState==='running'?1:0,hours,row.end_at,runState,nextRev,
        actor(user),text(user.name),now,row.tag,asset.cycle_runtime_revision,asset.cycle_runtime_anchor_at,Number(asset.cycle_runtime_hours)),
    db.prepare(`INSERT INTO blower_history_events (${Object.keys(event).map(col).join(',')})
      SELECT ${Object.keys(event).map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM blower_history_assets WHERE tag_number=? AND cycle_runtime_revision=?)`)
      .bind(...Object.values(event),row.tag,nextRev),
    db.prepare(`UPDATE ${CASE_TABLE} SET status='applied_approx',updated_at=?,approved_by=?,approved_name=?,
      approved_at=?,approval_note=?,event_id=? WHERE id=? AND status='collecting'`)
      .bind(now,actor(user),text(user.name),now,text(note),id,row.id),
    guard(db,postId,[post]),
    db.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(guardId),
    db.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(postId)]);
  return ensureStatus(db,await lookupCase(db,row.id,user),user);
}


export async function r6Cancel(db,user,sessionId){
  const row=await lookupCase(db,text(sessionId),user);
  if(!row)throw error('R6_NOT_FOUND','R6 검증 요청을 찾을 수 없습니다.',404);
  if(row.actor_id!==actor(user)&&user?.isSuperAdmin!==true)throw error('R6_FORBIDDEN','검증 요청 취소 권한이 없습니다.',403);
  if(['collecting','ready'].includes(row.status))
    await db.prepare(`UPDATE ${CASE_TABLE} SET status='cancelled',updated_at=? WHERE id=? AND status IN ('collecting','ready')`)
      .bind(nowIso(),row.id).run();
  return ensureStatus(db,await lookupCase(db,row.id,user),user);
}
