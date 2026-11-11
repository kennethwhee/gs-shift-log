/* BLOWER_INCREMENTAL_REFRESH_V1
 * Server-owned append receipts. The Agent still reads a fixed [start,end] RUN
 * interval; only this server may attach that interval to a verified predecessor.
 * A request CAS revision and the existing atomic history guard prevent double-adds.
 */
export const BLOWER_LIMESTONE_INCREMENTAL_VERSION = 8;
// Keep pending signal-only cycles and verified automatic boundaries on the same
// exact asset allowlist. Limestone still requires an existing verified receipt;
// this does not supply a missing replacement time or create measured RUN hours.
const SUPPORTED_BINARY_RUN_ASSET = /^(?:(?:104|204)(?:HHL(?:60AP|10AN)(?:611|621|631)|ETG30AN60[12]|SDF01AN00[12])|104ETH03AN60[12]|204LMDF01AN001|(?:103|203)HRJ01AN60[12])$/;
const instant = v => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
const number = v => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v)) ? Number(v) : NaN;
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.000001;
export const SILO_BASIS_TAG='104ETH03AN602', SILO_BASIS_SIGNAL='GSPOGE.ABB_DCS.003ETH03AN602XB04';
export const SILO_BASIS_START='2025-10-23T09:17:00+09:00', SILO_BASIS_SEAM='2026-05-10T00:00:00+09:00';
export const SILO_BASIS_CYCLE_PREFIX='silo-prefix-basis-v1:', SILO_BASIS_SOURCE='dataparc_silo_basis_v1';
const siloParse=v=>{try{return JSON.parse(v)}catch{return null}};
const safeSeconds=v=>Number.isSafeInteger(v)&&v>=0;
/** Follow immutable ordinary receipts, including their exact integer additions. */
export function siloRawTailChain(asset,rows,headId) {
  if(!asset||asset.tag_number!==SILO_BASIS_TAG)return null;
  const byId=new Map((rows||[]).map(row=>[row.id,row])),seen=new Set(),chain=[];
  let row=byId.get(headId),next=null;
  while(row&&chain.length<2000){
    const s=siloParse(row.source_text),x=s?.incremental;
    if(seen.has(row.id)||row.tag_number!==SILO_BASIS_TAG||row.source_type!=='dataparc_runtime'||
      row.event_type!=='runtime_correction'||row.updated_at!==row.created_at||!s||s.schemaVersion!==1||s.requestType!=='blower_runtime_probe'||
      row.id!=='dataparc_runtime:'+s.requestId||row.source_log_id!==s.requestId||
      s.assetTag!==SILO_BASIS_TAG||s.dataParcTag!==SILO_BASIS_SIGNAL||s.manualOverride||s.replacementEdit||s.requiresRunRefresh||
      instant(s.expectedLastReplacementAt)!==instant(asset.last_replacement_at)||
      String(s.expectedCycleStartRevision||'')!==String(asset.cycle_start_revision||'')||
      s.expectedCycleStartState!=='legacy'||s.expectedCycleStartedAt||
      !safeSeconds(s.runningSeconds)||!['running','stopped'].includes(s.startState)||!['running','stopped'].includes(s.endState)||
      !Number.isFinite(instant(s.startAt))||instant(s.startAt)>=instant(s.endAt)||s.runningSeconds>(instant(s.endAt)-instant(s.startAt))/1000+2||instant(s.observedAt)!==instant(s.endAt)||
      instant(row.event_date)!==instant(s.observedAt))return null;
    const total=x?.totalRunningSeconds??s.runningSeconds;
    if(!safeSeconds(total)||!near(number(row.runtime_hours),total/3600)||
      next&&(next.incremental.baseRunningSeconds!==total||instant(next.startAt)!==instant(s.observedAt)||next.startState!==s.endState))return null;
    if(x&&(x.version!==1||x.deltaRunningSeconds!==s.runningSeconds||!safeSeconds(x.baseRunningSeconds)||
      x.totalRunningSeconds!==x.baseRunningSeconds+x.deltaRunningSeconds||instant(x.baseObservedAt)!==instant(s.startAt)||
      instant(x.coverageStartAt)!==instant(SILO_BASIS_SEAM)))return null;
    seen.add(row.id);chain.push({row,source:s,totalRunningSeconds:total});
    if(!x)return instant(s.startAt)===instant(SILO_BASIS_SEAM)?{chain,startState:s.startState,startAt:s.startAt,runningSeconds:chain[0].totalRunningSeconds}:null;
    next=s;row=byId.get(x.baseEventId);
  }return null;
}
/** Distinct composite proof; never reinterpret its prefix request as a full query.
 * Every later ordinary append must still reach this immutable certificate. */
export function siloCompositeAppendBase(asset,rows,signal,verifyOldTail=strictVerifiedAppendBase){
  if(asset?.tag_number!==SILO_BASIS_TAG||signal!==SILO_BASIS_SIGNAL||
    !String(asset.cycle_start_revision||'').startsWith(SILO_BASIS_CYCLE_PREFIX)||
    instant(asset.last_replacement_at)!==instant(SILO_BASIS_START)||asset.cycle_start_state!=='legacy'||asset.cycle_started_at)return null;
  const certificates=(rows||[]).filter(row=>row.tag_number===SILO_BASIS_TAG&&row.source_type===SILO_BASIS_SOURCE&&
    siloParse(row.source_text)?.cycleStartRevision===asset.cycle_start_revision);
  if(certificates.length!==1)return null;const cert=certificates[0],s=siloParse(cert.source_text),p=s?.prefix,t=s?.tail;
  if(!s||s.version!==1||s.assetTag!==SILO_BASIS_TAG||s.dataParcTag!==signal||
    cert.id!=='dataparc_silo_basis:'+p?.requestId||cert.source_log_id!==p?.requestId||cert.event_type!=='runtime_correction'||
    cert.updated_at!==cert.created_at||!s.auditId||!s.sourceProofHash||
    instant(p?.startAt)!==instant(SILO_BASIS_START)||instant(p?.endAt)!==instant(SILO_BASIS_SEAM)||
    !safeSeconds(p.runningSeconds)||p.runningSeconds>(instant(p.endAt)-instant(p.startAt))/1000||
    !['running','stopped'].includes(p.startState)||!['running','stopped'].includes(p.endState)||
    !/^[a-f0-9]{64}$/.test(p.rawResultSha256||'')||!s.tailAsset||s.tailAsset.tag_number!==SILO_BASIS_TAG||!t||
    !safeSeconds(t.runningSeconds)||!['running','stopped'].includes(t.endState))return null;
  const ownerRows=rows.filter(row=>row.tag_number===SILO_BASIS_TAG&&row.event_type==='replacement'&&instant(row.event_date)===instant(SILO_BASIS_START));
  if(ownerRows.length!==1||!s.owner||s.owner.id!=='v13:104ETH03AN602|2025-10-23'||
    Object.entries(s.owner).some(([k,v])=>ownerRows[0][k]!==v))return null;
  const oldRows=rows.filter(row=>row.source_type!==SILO_BASIS_SOURCE),old=verifyOldTail(s.tailAsset,oldRows,signal),chain=siloRawTailChain(s.tailAsset,oldRows,t?.eventId);
  if(!old||!chain||old.eventId!==t?.eventId||old.runningSeconds!==t.runningSeconds||
    instant(old.startAt)!==instant(SILO_BASIS_SEAM)||instant(old.observedAt)!==instant(t.observedAt)||
    p.endState!==chain.startState||old.state!==t.endState||
    s.totalRunningSeconds!==p.runningSeconds+t.runningSeconds||!safeSeconds(s.totalRunningSeconds)||
    !near(number(cert.runtime_hours),s.totalRunningSeconds/3600)||instant(cert.event_date)!==instant(t.observedAt))return null;
  const byId=new Map(rows.map(row=>[row.id,row]));
  const owners=rows.filter(row=>row.tag_number===SILO_BASIS_TAG&&['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type)&&instant(row.event_date)===instant(asset.cycle_runtime_anchor_at)).sort(eventOrder);
  let owner=owners[0],current=owner,seen=new Set(),currentSeconds=null,currentState=null;
  while(current&&seen.size<2000){
    if(current.id===cert.id){if(currentSeconds===null){currentSeconds=s.totalRunningSeconds;currentState=t.endState;}break;}
    if(seen.has(current.id)||current.source_type!=='dataparc_runtime'||current.updated_at!==current.created_at)return null;
    const raw=siloParse(current.source_text),x=raw?.incremental;
    if(!raw||!x||raw.schemaVersion!==1||raw.requestType!=='blower_runtime_probe'||x.version!==1||raw.assetTag!==SILO_BASIS_TAG||raw.dataParcTag!==signal||raw.requestId!==current.source_log_id||
      current.id!=='dataparc_runtime:'+raw.requestId||raw.manualOverride||raw.replacementEdit||raw.requiresRunRefresh||
      instant(raw.expectedLastReplacementAt)!==instant(SILO_BASIS_START)||raw.expectedCycleStartRevision!==asset.cycle_start_revision||
      raw.expectedCycleStartState!=='legacy'||raw.expectedCycleStartedAt||!safeSeconds(raw.runningSeconds)||!safeSeconds(x.baseRunningSeconds)||
      !safeSeconds(x.totalRunningSeconds)||x.deltaRunningSeconds!==raw.runningSeconds||x.totalRunningSeconds!==x.baseRunningSeconds+raw.runningSeconds||
      !near(number(current.runtime_hours),x.totalRunningSeconds/3600)||instant(x.coverageStartAt)!==instant(SILO_BASIS_START)||
      instant(x.baseObservedAt)!==instant(raw.startAt)||instant(raw.endAt)!==instant(raw.observedAt)||instant(raw.observedAt)!==instant(current.event_date)||
      instant(raw.endAt)<=instant(raw.startAt)||raw.runningSeconds>(instant(raw.endAt)-instant(raw.startAt))/1000+2||
      !['running','stopped'].includes(raw.startState)||!['running','stopped'].includes(raw.endState))return null;
    const predecessor=byId.get(x.baseEventId),prevSource=siloParse(predecessor?.source_text);
    const prevSeconds=predecessor?.id===cert.id?s.totalRunningSeconds:prevSource?.incremental?.totalRunningSeconds??prevSource?.runningSeconds;
    const prevState=predecessor?.id===cert.id?t.endState:prevSource?.endState;
    if(!predecessor||prevSeconds!==x.baseRunningSeconds||instant(predecessor.event_date)!==instant(raw.startAt)||raw.startState!==prevState)return null;
    if(currentSeconds===null){currentSeconds=x.totalRunningSeconds;currentState=raw.endState;}
    seen.add(current.id);current=predecessor;
  }
  if(current?.id!==cert.id||!owner||!safeSeconds(currentSeconds)||!near(number(asset.cycle_runtime_hours),currentSeconds/3600)||
    currentState!==asset.cycle_runtime_state)return null;
  const currentSource=siloParse(owner.source_text),requestId=owner.id===cert.id?p.requestId:currentSource.requestId;
  return {eventId:owner.id,requestId,startAt:SILO_BASIS_START,observedAt:asset.cycle_runtime_anchor_at,dataParcTag:signal,
    runningSeconds:currentSeconds,runtimeHours:currentSeconds/3600,coverageComplete:true,requiredStartAt:SILO_BASIS_START,
    missingLeadingSeconds:0,state:currentState,cycleRuntimeRevision:asset.cycle_runtime_revision,
    siloBasis:{version:1,certificateEventId:cert.id,prefixRequestId:p.requestId,auditId:s.auditId,approvedCompletionAt:SILO_BASIS_START,
      prefixRunningSeconds:p.runningSeconds,originalTailRunningSeconds:t.runningSeconds,sampleGoodCertified:false}};
}
function siloCompositeBoundaryBase(asset,rows,signal){
  const stored=number(asset.cycle_runtime_hours),anchor=instant(asset.cycle_runtime_anchor_at);
  if(!Number.isFinite(stored)||!Number.isFinite(anchor))return null;
  const relevant=(rows||[]).filter(row=>row.tag_number===SILO_BASIS_TAG&&['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type));
  const owners=relevant.filter(row=>instant(row.event_date)===anchor).sort(eventOrder),owner=owners[0];
  const manualState=owner?.source_type==='manual'?manualRuntimeOverlayState(owner):'',autoState=automaticBoundaryState(owner);
  if(!owner||(!manualState&&!autoState)||(manualState||autoState)!==asset.cycle_runtime_state||!near(number(owner.runtime_hours),stored))return null;
  const measured=relevant.filter(row=>row.source_type===SILO_BASIS_SOURCE||row.source_type==='dataparc_runtime'&&siloParse(row.source_text)?.expectedCycleStartRevision===asset.cycle_start_revision)
    .sort((a,b)=>instant(b.event_date)-instant(a.event_date)||eventOrder(a,b));
  const receipt=measured[0],source=siloParse(receipt?.source_text),observed=instant(receipt?.event_date);
  const state=receipt?.source_type===SILO_BASIS_SOURCE?source?.tail?.endState:source?.endState;
  if(!receipt||!Number.isFinite(observed)||observed>=anchor||!near(number(receipt.runtime_hours),stored))return null;
  const overlays=relevant.filter(row=>instant(row.event_date)>observed&&instant(row.event_date)<=anchor);
  if(!overlays.length||!overlays.some(row=>row.id===owner.id)||overlays.some(row=>!near(number(row.runtime_hours),stored)))return null;
  const manual=overlays.every(row=>row.source_type==='manual'&&Boolean(manualRuntimeOverlayState(row))),automatic=overlays.every(row=>Boolean(automaticBoundaryState(row)));
  if(!manual&&!automatic)return null;
  if(relevant.some(row=>!Number.isFinite(instant(row.event_date))||instant(row.event_date)>anchor))return null;
  const base=siloCompositeAppendBase({...asset,cycle_runtime_anchor_at:receipt.event_date,cycle_runtime_state:state,cycle_runtime_hours:receipt.runtime_hours},rows,signal);
  return base?{...base,cycleRuntimeRevision:asset.cycle_runtime_revision,preservedStateBoundary:true}:null;
}
/* A timestamp-owned measured range may continue from its immutable endpoint
 * even when it does not cover the whole recorded belt cycle. Keep that range
 * and its partial status; never rebuild or certify the unmeasured prefix. */
/* Certify the recorded range only, not a physical replacement instant or RUN
 * signal quality. A confirmed startup may bound a stopped prefix; legacy and
 * pending cycles must include their saved replacement baseline. Keep existing
 * measured values intact when their range omits an earlier part of the cycle.
 * This is necessary range evidence; existing stricter API guards still apply. */
export function cycleRuntimeCoverage(asset, startAt) {
  const state = asset?.cycle_start_state || 'legacy';
  const requiredStartAt = typeof (state === 'started' ? asset?.cycle_started_at : asset?.last_replacement_at) === 'string'
    ? (state === 'started' ? asset.cycle_started_at : asset.last_replacement_at) : '';
  const coverageStartAt = typeof startAt === 'string' ? startAt : '';
  const replacement = instant(asset?.last_replacement_at), required = instant(requiredStartAt), start = instant(coverageStartAt);
  const valid = ['legacy','pending','started'].includes(state) && Number.isFinite(replacement) &&
    Number.isFinite(required) && required >= replacement && Number.isFinite(start);
  return { complete: valid && start >= replacement && start <= required,
    requiredStartAt, coverageStartAt,
    missingLeadingSeconds: valid ? Math.max(0, (start - required) / 1000) : null };
}
export function incrementalEvidence(source) {
  const x = source?.incremental;
  if (!x) return null;
  const from = instant(x.coverageStartAt), baseAt = instant(x.baseObservedAt), end = instant(source.observedAt || source.endAt);
  if (x.version !== 1 || typeof x.baseEventId !== 'string' || !(x.baseEventId.startsWith('dataparc_runtime:') ||
      source.assetTag===SILO_BASIS_TAG&&x.baseEventId.startsWith('dataparc_silo_basis:')) ||
      !Number.isFinite(from) || !Number.isFinite(baseAt) || !Number.isFinite(end) || from >= baseAt || baseAt !== instant(source.startAt) || end <= baseAt ||
      !Number.isSafeInteger(x.baseRunningSeconds) || x.baseRunningSeconds < 0 ||
      !Number.isSafeInteger(x.deltaRunningSeconds) || x.deltaRunningSeconds < 0 ||
      x.deltaRunningSeconds !== source.runningSeconds || !Number.isSafeInteger(x.totalRunningSeconds) ||
      x.totalRunningSeconds !== x.baseRunningSeconds + x.deltaRunningSeconds) return null;
  return x;
}
function strictVerifiedAppendBase(asset, rows, dataParcTag) {
  if (!asset?.last_replacement_at) return null;
  const assetTag = String(asset.tag_number || '').trim().toUpperCase();
  const supportedBinaryRun = SUPPORTED_BINARY_RUN_ASSET.test(assetTag);
  if (asset.cycle_start_state === 'pending' && !supportedBinaryRun) return null;
  const stored = number(asset.cycle_runtime_hours), anchor = instant(asset.cycle_runtime_anchor_at);
  if (!Number.isFinite(stored) || stored < 0 || !Number.isFinite(anchor)) return null;
  // Latest timestamp-owned event, not just ANY historical row with equal hours.
  const matching = (rows || []).filter(r => r.tag_number === asset.tag_number &&
    ['runtime_correction','startup','operation_start','operation_stop'].includes(r.event_type) &&
    instant(r.event_date) === anchor)
    .sort((a,b) => (instant(b.updated_at || b.created_at || b.event_date) - instant(a.updated_at || a.created_at || a.event_date)) ||
      String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id)));
  const row = matching[0];
  if (!row || !near(number(row.runtime_hours), stored) ||
      row.source_type !== 'dataparc_runtime' || row.event_type !== 'runtime_correction') return null;
  let s; try { s = JSON.parse(row.source_text); } catch { return null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const actualCycleStartState = asset.cycle_start_state || 'legacy';
  const signalOnlyPending = supportedBinaryRun && actualCycleStartState === 'pending' &&
    s.expectedCycleStartState === 'legacy' && s.signalOnlyCycle === true && !String(s.expectedCycleStartedAt || '');
  if (s.schemaVersion !== 1 || s.assetTag !== asset.tag_number || s.dataParcTag !== dataParcTag ||
      s.requestType !== 'blower_runtime_probe' || s.requestId !== row.source_log_id || row.id !== `dataparc_runtime:${s.requestId}` ||
      instant(s.expectedLastReplacementAt) !== instant(asset.last_replacement_at) ||
      (s.expectedCycleStartState !== actualCycleStartState && !signalOnlyPending) ||
      String(s.expectedCycleStartRevision || '') !== String(asset.cycle_start_revision || '') ||
      (actualCycleStartState === 'started' && instant(s.expectedCycleStartedAt) !== instant(asset.cycle_started_at)) ||
      instant(s.observedAt || s.endAt) !== anchor || s.endState !== asset.cycle_runtime_state ||
      !['running','stopped'].includes(s.endState)) return null;
  const x = incrementalEvidence(s);
  if (s.incremental && !x) return null;
  const seconds = x ? x.totalRunningSeconds : s.runningSeconds;
  const startAt = x ? x.coverageStartAt : s.startAt;
  const start = instant(startAt);
  const coverage = cycleRuntimeCoverage(asset, startAt);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isFinite(start) || start < instant(asset.last_replacement_at) || start >= anchor ||
      coverage.missingLeadingSeconds === null ||
      // Compare raw stored hours, retaining exact integer seconds across appends.
      !near(seconds / 3600, stored)) return null;
  return { eventId: row.id, requestId: s.requestId, startAt, observedAt: s.observedAt || s.endAt,
    dataParcTag: s.dataParcTag, runningSeconds: seconds, runtimeHours: stored,
    coverageComplete: coverage.complete, requiredStartAt: coverage.requiredStartAt,
    missingLeadingSeconds: coverage.missingLeadingSeconds,
    state: s.endState, cycleRuntimeRevision: asset.cycle_runtime_revision };
}

function eventOrder(a, b) {
  return (instant(b.updated_at || b.created_at || b.event_date) - instant(a.updated_at || a.created_at || a.event_date)) ||
    String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
    String(b.id || '').localeCompare(String(a.id || ''));
}

const sameManualRuntime = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.000001;

function manualRuntimeOverlayState(row) {
  if (row?.event_type === 'operation_start') return 'running';
  if (row?.event_type === 'operation_stop') return 'stopped';
  if (row?.event_type !== 'runtime_correction' || row?.source_type !== 'manual') return '';
  const action = String(row.action_type || '').trim().toLowerCase();
  if (action === '운전중' || action === 'running') return 'running';
  if (action === '정지' || action === 'stopped') return 'stopped';
  return '';
}

/* BLOWER_INCREMENTAL_MANUAL_BOUNDARY_V2
 * A measured Blower may have a manual operation_start/operation_stop, or an
 * exact-state manual runtime_correction that leaves the cumulative value
 * unchanged, after the last successful DataPARC sample. Those boundaries change
 * the asset runtime revision/anchor but not the verified RUN seconds. Resume from
 * the last DataPARC observedAt only when every intervening runtime overlay is a
 * parseable manual boundary with the same cumulative value. A changed total,
 * startup, pending cycle, non-manual/unknown overlay, or cycle change fails closed.
 */
function verifiedManualBoundaryAppendBase(asset, rows, dataParcTag) {
  if (!asset?.last_replacement_at || asset.cycle_start_state === 'pending') return null;
  const replacement = instant(asset.last_replacement_at);
  const currentAnchor = instant(asset.cycle_runtime_anchor_at);
  const currentHours = number(asset.cycle_runtime_hours);
  if (!Number.isFinite(replacement) || !Number.isFinite(currentAnchor) ||
      !Number.isFinite(currentHours) || currentHours < 0 ||
      !['running','stopped'].includes(String(asset.cycle_runtime_state || ''))) return null;

  const relevant = (rows || []).filter(r => r.tag_number === asset.tag_number &&
    ['runtime_correction','startup','operation_start','operation_stop'].includes(r.event_type));
  const currentOwner = relevant.filter(r => instant(r.event_date) === currentAnchor)
    .sort(eventOrder)[0];
  const ownerState = manualRuntimeOverlayState(currentOwner);
  if (!currentOwner || !sameManualRuntime(number(currentOwner.runtime_hours), currentHours) ||
      currentOwner.source_type !== 'manual' || !ownerState || ownerState !== asset.cycle_runtime_state) return null;

  const candidates = relevant.filter(r => r.source_type === 'dataparc_runtime' && r.event_type === 'runtime_correction')
    .map(row => {
      let source; try { source = JSON.parse(row.source_text); } catch { return null; }
      const observedAt = source?.observedAt || source?.endAt || '';
      return { row, source, observed: instant(observedAt), observedAt };
    })
    .filter(Boolean)
    .sort((a, b) => b.observed - a.observed || eventOrder(a.row, b.row));

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.observed) || candidate.observed < replacement || candidate.observed >= currentAnchor) continue;
    const shadow = { ...asset,
      cycle_runtime_hours: candidate.row.runtime_hours,
      cycle_runtime_anchor_at: candidate.observedAt,
      cycle_runtime_state: candidate.source?.endState || ''
    };
    // Keep competing owners at the predecessor timestamp visible. Validating
    // one row alone could revive an older equal total after a newer correction.
    const base = strictVerifiedAppendBase(shadow, relevant, dataParcTag);
    if (!base || !sameManualRuntime(base.runtimeHours, currentHours)) continue;

    const overlays = relevant.filter(r => {
      const at = instant(r.event_date);
      return Number.isFinite(at) && at > candidate.observed && at <= currentAnchor;
    });
    if (!overlays.some(r => r.id === currentOwner.id)) continue;
    const manualOnly = overlays.every(r => r.source_type === 'manual' &&
      Boolean(manualRuntimeOverlayState(r)) && sameManualRuntime(number(r.runtime_hours), currentHours));
    if (!manualOnly) continue;

    return { ...base, cycleRuntimeRevision: asset.cycle_runtime_revision };
  }
  return null;
}

/* BLOWER_INCREMENTAL_AUTO_BOUNDARY_V1
 * Shift-log changeovers only move the state/anchor of measured Blowers. They do
 * not measure any additional RUN seconds. Recover the last immutable DataPARC
 * receipt only when the current owner and every later boundary are unchanged,
 * server-generated changeover events carrying exactly the same stored total.
 * Query from that receipt's observedAt, never from the changeover timestamp.
 * Keep the manual path separate: an unknown/mixed/edited history fails closed.
 */
function automaticBoundaryState(row) {
  if (row?.source_type !== 'shift_log_operation_auto') return '';
  const kind = row.event_type === 'operation_start' ? 'start'
    : row.event_type === 'operation_stop' ? 'stop' : '';
  if (!kind || !new RegExp(`^operation-auto:[0-9a-f]{8}:${kind}$`).test(String(row.id || '')) ||
      row.action_type !== (kind === 'start' ? '교체운전 자동 기동' : '교체운전 자동 정지') ||
      typeof row.source_log_id !== 'string' || !row.source_log_id.trim()) return '';
  const at = instant(row.event_date), created = instant(row.created_at);
  if (!Number.isFinite(at) || !Number.isFinite(created) || created < at ||
      row.updated_at !== row.created_at) return '';
  return kind === 'start' ? 'running' : 'stopped';
}

function verifiedAutomaticBoundaryAppendBase(asset, rows, dataParcTag) {
  const assetTag = String(asset?.tag_number || '');
  if (!SUPPORTED_BINARY_RUN_ASSET.test(assetTag) ||
      !['legacy','started'].includes(asset.cycle_start_state || 'legacy') ||
      typeof asset.cycle_runtime_revision !== 'string' || !asset.cycle_runtime_revision.trim()) return null;
  const rawNumber = value => typeof value === 'number' || (typeof value === 'string' && value.trim()) ? number(value) : NaN;
  const replacement = instant(asset.last_replacement_at), anchor = instant(asset.cycle_runtime_anchor_at);
  const stored = rawNumber(asset.cycle_runtime_hours);
  if (!Number.isFinite(replacement) || !Number.isFinite(anchor) || anchor <= replacement ||
      !Number.isFinite(stored) || stored < 0) return null;
  const relevant = (Array.isArray(rows) ? rows : []).filter(row => row?.tag_number === assetTag &&
    ['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type));
  // Unknown event times cannot establish a continuous, unmodified interval.
  if (relevant.some(row => !Number.isFinite(instant(row.event_date)))) return null;
  const cycleRows = relevant.filter(row => instant(row.event_date) >= replacement);
  if (cycleRows.some(row => instant(row.event_date) > anchor)) return null;
  const owner = cycleRows.filter(row => instant(row.event_date) === anchor).sort(eventOrder)[0];
  const state = automaticBoundaryState(owner);
  if (!state || state !== asset.cycle_runtime_state || rawNumber(owner.runtime_hours) !== stored) return null;

  // Do not skip a newer invalid DataPARC receipt and borrow an older equal total.
  const row = cycleRows.filter(item => item.source_type === 'dataparc_runtime' && item.event_type === 'runtime_correction')
    .sort((a,b) => instant(b.event_date) - instant(a.event_date) || eventOrder(a,b))[0];
  if (!row) return null;
  const observed = instant(row.event_date), created = instant(row.created_at);
  if (observed >= anchor || !Number.isFinite(created) || created < observed ||
      row.updated_at !== row.created_at || rawNumber(row.runtime_hours) !== stored) return null;
  let source; try { source = JSON.parse(row.source_text); } catch { return null; }
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      source.manualOverride === true || Boolean(source.manualOverride?.changedAt) ||
      source.replacementEdit || source.requiresRunRefresh ||
      instant(source.observedAt || source.endAt) !== observed) return null;
  const base = strictVerifiedAppendBase({ ...asset,
    cycle_runtime_hours: row.runtime_hours,
    cycle_runtime_anchor_at: row.event_date,
    cycle_runtime_state: source.endState
  }, [row], dataParcTag);
  if (!base || base.runtimeHours !== stored) return null;
  if (asset.cycle_start_state === 'started' &&
      (!Number.isFinite(instant(asset.cycle_started_at)) || instant(base.startAt) < instant(asset.cycle_started_at))) return null;
  // A newer edit of an earlier boundary or a competing base owner is ambiguous.
  if (cycleRows.some(item => {
    if (item.id === row.id || instant(item.event_date) > observed) return false;
    if (instant(item.event_date) === observed) return true;
    const itemCreated = instant(item.created_at), itemUpdated = instant(item.updated_at);
    return !Number.isFinite(itemCreated) || !Number.isFinite(itemUpdated) ||
      itemUpdated < itemCreated || Math.max(itemCreated, itemUpdated) > created;
  })) return null;
  const overlays = cycleRows.filter(item => instant(item.event_date) > observed);
  if (!overlays.length || !overlays.every(item => automaticBoundaryState(item) && rawNumber(item.runtime_hours) === stored)) return null;
  const statesByTime = new Map();
  for (const item of overlays) {
    const at = instant(item.event_date), boundaryState = automaticBoundaryState(item);
    if (statesByTime.has(at) && statesByTime.get(at) !== boundaryState) return null;
    statesByTime.set(at, boundaryState);
  }
  return { ...base, cycleRuntimeRevision: asset.cycle_runtime_revision };
}

export function verifiedAppendBase(asset, rows, dataParcTag) {
  if(asset?.tag_number===SILO_BASIS_TAG&&String(asset.cycle_start_revision||'').startsWith(SILO_BASIS_CYCLE_PREFIX))
    return siloCompositeAppendBase(asset,rows,dataParcTag)||siloCompositeBoundaryBase(asset,rows,dataParcTag);
  return strictVerifiedAppendBase(asset, rows, dataParcTag) ||
    verifiedManualBoundaryAppendBase(asset, rows, dataParcTag) ||
    verifiedAutomaticBoundaryAppendBase(asset, rows, dataParcTag);
}

export async function loadAppendBase(database, asset, dataParcTag) {
  // Read the current Cycle beyond its runtime anchor: an operation boundary can sit
  // after the last DataPARC success while preserving its RUN total. Older Cycles
  // are unrelated and can make this hot-path history scan grow without bound.
  // Keep malformed dates visible so automatic recovery cannot ignore a boundary.
  const types="'runtime_correction','startup','operation_start','operation_stop'"+
    (asset?.tag_number===SILO_BASIS_TAG&&String(asset.cycle_start_revision||'').startsWith(SILO_BASIS_CYCLE_PREFIX)?",'replacement'":'');
  const result = await database.prepare(`SELECT * FROM blower_history_events
    WHERE tag_number = ? AND event_type IN (${types})
      AND (datetime(event_date) >= datetime(?) OR datetime(event_date) IS NULL
        OR NOT (event_date GLOB '*Z' OR event_date GLOB '*[+-][0-9][0-9]:[0-9][0-9]'))
    ORDER BY event_date DESC, updated_at DESC, created_at DESC, id DESC`)
    .bind(asset.tag_number, asset.last_replacement_at).all();
  const rows=result.results||[],base=verifiedAppendBase(asset,rows,dataParcTag);
  if(base?.siloBasis){
    try{
      const {loadSiloApprovedCompletion}=await import('./blower-replacement-log-source-v3.js');
      const current=await loadSiloApprovedCompletion(database),cert=rows.find(row=>row.id===base.siloBasis.certificateEventId),source=siloParse(cert?.source_text);
      if(current.sourceProofHash!==source?.sourceProofHash)return null;
      const audit=await database.prepare('SELECT * FROM blower_history_asset_history WHERE id=? AND action_type=\'silo_prefix_basis_recovery\' AND tag_number=?').bind(source.auditId,SILO_BASIS_TAG).first();
      const before=siloParse(audit?.before_json),after=siloParse(audit?.after_json);
      if(!before||!after?.event||Object.entries(after.event).some(([k,v])=>cert[k]!==v)||
        after.prefixRawResultSha256!==source.prefix.rawResultSha256||!Array.isArray(before.requests))return null;
      const prefixRequest=await database.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(source.prefix.requestId).first();
      const rawSha=prefixRequest&&[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prefixRequest.result_json||'')))].map(v=>v.toString(16).padStart(2,'0')).join('');
      if(prefixRequest?.status!=='complete'||prefixRequest.request_type!=='blower_runtime_probe'||rawSha!==source.prefix.rawResultSha256||
        !after.prefixRequest||!after.prefixIntent||Object.entries(after.prefixRequest).some(([k,v])=>prefixRequest[k]!==v))return null;
      const auditRows=before.requests.map(q=>Object.fromEntries(Object.entries(q).filter(([key])=>key!=='intent_json'))),intentRows=before.requests.map(q=>siloParse(q.intent_json));
      const exactRows=(table,key,expected)=>({sql:`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN ${table} t ON t."${key}" IS json_extract(j.value,'$.${key}') WHERE t."${key}" IS NULL OR NOT(${Object.keys(expected[0]||{}).map(k=>`t."${k}" IS json_extract(j.value,'$.${k}')`).join(' AND ')}))`,values:[JSON.stringify(expected)]});
      const exactRow=(table,row)=>exactRows(table,table==='ois_data_requests'?'id':'id',[row]);
      const rawGuards=[exactRows('ois_data_requests','id',auditRows),exactRows('blower_runtime_probe_intents_v5','request_id',intentRows),exactRow('ois_data_requests',after.prefixRequest),exactRows('blower_runtime_probe_intents_v5','request_id',[after.prefixIntent]),exactRow('blower_history_asset_history',audit)];
      if(!(await database.prepare(`SELECT CASE WHEN ${rawGuards.map(g=>'('+g.sql+')').join(' AND ')} THEN 1 ELSE 0 END valid`).bind(...rawGuards.flatMap(g=>g.values)).first())?.valid)return null;
      const fields=Object.keys(rows[0]||{}),encoded=JSON.stringify(rows),where=`tag_number=? AND event_type IN ('runtime_correction','startup','operation_start','operation_stop','replacement') AND (datetime(event_date)>=datetime(?) OR datetime(event_date) IS NULL OR NOT(event_date GLOB '*Z' OR event_date GLOB '*[+-][0-9][0-9]:[0-9][0-9]'))`;
      const evidenceGuard={sql:`(SELECT COUNT(*) FROM blower_history_events WHERE ${where})=json_array_length(?) AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN blower_history_events t ON t.id=json_extract(j.value,'$.id') WHERE t.id IS NULL OR NOT(${fields.map(k=>`t."${k}" IS json_extract(j.value,'$.${k}')`).join(' AND ')}))`,values:[asset.tag_number,asset.last_replacement_at,encoded,encoded]};
      return {...base,siloSourceGuards:[...current.guards,...rawGuards,evidenceGuard]};
    }catch{return null;}
  }
  return base;
}
export async function ensureAppendSchema(database) {
  await database.prepare(`CREATE TABLE IF NOT EXISTS blower_runtime_append_v1 (
    request_id TEXT PRIMARY KEY, base_event_id TEXT NOT NULL, base_revision TEXT NOT NULL,
    base_observed_at TEXT NOT NULL, coverage_start_at TEXT NOT NULL,
    base_running_seconds INTEGER NOT NULL CHECK(base_running_seconds >= 0), created_at TEXT NOT NULL
  )`).run();
}
export function appendIntentStatement(database, requestId, base, createdAt) {
  return database.prepare(`INSERT INTO blower_runtime_append_v1
    (request_id, base_event_id, base_revision, base_observed_at, coverage_start_at, base_running_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(requestId, base.eventId, base.cycleRuntimeRevision, base.observedAt, base.startAt, base.runningSeconds, createdAt);
}
export async function loadAppendIntent(database, requestId) {
  try { return await database.prepare('SELECT * FROM blower_runtime_append_v1 WHERE request_id = ? LIMIT 1').bind(requestId).first(); }
  catch (e) { if (/no such table:.*blower_runtime_append_v1/i.test(String(e?.message || e))) return null; throw e; }
}
export function combineAppendProbe(probe, receipt) {
  if (!receipt) return { ...probe };
  const seconds = number(receipt.base_running_seconds);
  const from = instant(receipt.coverage_start_at), base = instant(receipt.base_observed_at);
  if (receipt.request_id !== probe.requestId || receipt.base_revision !== probe.expectedCycleRuntimeRevision ||
      base !== instant(probe.startAt) || !Number.isFinite(from) || from < instant(probe.expectedLastReplacementAt) || from >= base ||
      !Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(seconds + probe.runningSeconds)) {
    throw Object.assign(new Error('증분 조회의 마지막 성공 시각·누적 기준이 일치하지 않습니다. 기존 값은 유지합니다.'), {code:'DATAPARC_APPEND_INTENT_CONFLICT'});
  }
  const total = seconds + probe.runningSeconds;
  return { ...probe, runtimeHours: total / 3600,
    incremental: { version: 1, baseEventId: receipt.base_event_id, baseObservedAt: receipt.base_observed_at,
      coverageStartAt: receipt.coverage_start_at, baseRunningSeconds: seconds,
      deltaRunningSeconds: probe.runningSeconds, totalRunningSeconds: total } };
}
