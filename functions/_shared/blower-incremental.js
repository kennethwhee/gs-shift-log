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
export const LIMESTONE2A_FIRST_RUN_TAG='203HRJ01AN601', LIMESTONE2A_FIRST_RUN_SIGNAL='GSPOGE.ABB_DCS.203HRJ01AN601XB04';
export const LIMESTONE2A_FIRST_RUN_CYCLE_PREFIX='lime2a-first-run-v1:', LIMESTONE2A_FIRST_RUN_SOURCE='dataparc_limestone2a_first_run_v1';
export const LIMESTONE2A_TAG=LIMESTONE2A_FIRST_RUN_TAG, LIMESTONE2A_SIGNAL=LIMESTONE2A_FIRST_RUN_SIGNAL;
export const LIMESTONE2A_START='2026-09-19T00:00:00+09:00', LIMESTONE2A_FIRST_RUN='2026-09-19T09:58:26+09:00', LIMESTONE2A_SEAM='2026-09-20T00:00:00+09:00';
export const LIMESTONE2A_CYCLE_PREFIX=LIMESTONE2A_FIRST_RUN_CYCLE_PREFIX, LIMESTONE2A_SOURCE=LIMESTONE2A_FIRST_RUN_SOURCE;
const LIMESTONE2A_OWNER='replacement-auto-v3:303f92e0db83b280551fdc45a570e371bad3d7a1e88a9b0265d0b8727cc6e05b';
const LIMESTONE2A_CERT_PREFIX='dataparc_limestone2a_first_run:';
export const LIMESTONE1B_FIRST_RUN_TAG='103HRJ01AN602', LIMESTONE1B_FIRST_RUN_SIGNAL='GSPOGE.ABB_DCS.103HRJ01AN602XB04';
export const LIMESTONE1B_FIRST_RUN_CYCLE_PREFIX='lime1b-first-run-v1:', LIMESTONE1B_FIRST_RUN_SOURCE='dataparc_limestone1b_first_run_v1';
export const LIMESTONE1B_TAG=LIMESTONE1B_FIRST_RUN_TAG, LIMESTONE1B_SIGNAL=LIMESTONE1B_FIRST_RUN_SIGNAL;
export const LIMESTONE1B_DAY_START='2026-09-22T00:00:00+09:00', LIMESTONE1B_STOP='2026-09-22T09:29:26+09:00';
export const LIMESTONE1B_FIRST_RUN='2026-09-22T09:50:26+09:00', LIMESTONE1B_DAY_END='2026-09-23T00:00:00+09:00';
export const LIMESTONE1B_CYCLE_PREFIX=LIMESTONE1B_FIRST_RUN_CYCLE_PREFIX, LIMESTONE1B_SOURCE=LIMESTONE1B_FIRST_RUN_SOURCE;
const LIMESTONE1B_OWNER='c9e685ca-a192-4a88-81ae-1d76314bdfb6', LIMESTONE1B_CERT_PREFIX='dataparc_limestone1b_first_run:';
export const FBHE1A_RUNTIME_TAG='104HHL60AP611', FBHE1A_RUNTIME_SIGNAL='GSPOGE.ABB_DCS.104HHL60AP611XB04';
export const FBHE1A_RUNTIME_CYCLE_PREFIX='fbhe1a-runtime-v1:', FBHE1A_RUNTIME_SOURCE='dataparc_fbhe1a_runtime_v1';
export const FBHE1A_TAG=FBHE1A_RUNTIME_TAG, FBHE1A_SIGNAL=FBHE1A_RUNTIME_SIGNAL;
export const FBHE1A_DAY_START='2026-09-04T00:00:00+09:00', FBHE1A_BASE_START='2026-09-04T10:50:00+09:00';
export const FBHE1A_STOP='2026-09-04T10:50:39+09:00', FBHE1A_MEASURED_START='2026-09-05T00:00:00+09:00';
export const FBHE1A_SEAM=FBHE1A_MEASURED_START, FBHE1A_DAY_END=FBHE1A_MEASURED_START;
export const FBHE1A_CYCLE_PREFIX=FBHE1A_RUNTIME_CYCLE_PREFIX, FBHE1A_SOURCE=FBHE1A_RUNTIME_SOURCE;
const FBHE1A_OWNER='a7b55255-c17a-4313-b783-c234a7172575', FBHE1A_CERT_PREFIX='dataparc_fbhe1a_runtime:';
const siloParse=v=>{try{return JSON.parse(v)}catch{return null}};
const safeSeconds=v=>Number.isSafeInteger(v)&&v>=0;
// Independent CASE predicates avoid a deep combined AND. workerd permits at
// most five compound SELECT terms, so keep every read group within that limit.
async function readGuardChecks(database,checks){
  if(!Array.isArray(checks)||!checks.length||checks.some(check=>typeof check?.sql!=='string'||!check.sql.trim()||!Array.isArray(check.values)))return false;
  const seen=new Set();
  for(let offset=0;offset<checks.length;offset+=5){
    const group=checks.slice(offset,offset+5);
    const sql=group.map((check,index)=>`SELECT ${offset+index} AS guard_index,CASE WHEN (${check.sql}) THEN 1 ELSE 0 END AS valid`).join(' UNION ALL ');
    const values=group.flatMap(check=>check.values);
    if(values.length>100||new TextEncoder().encode(sql).length>=100000)return false;
    const result=await database.prepare(sql).bind(...values).all(),rows=result?.results;
    if(result?.success===false||!Array.isArray(rows)||rows.length!==group.length)return false;
    for(const row of rows){
      const index=row?.guard_index;
      if(!Number.isSafeInteger(index)||index<offset||index>=offset+group.length||seen.has(index)||row.valid!==1)return false;
      seen.add(index);
    }
  }
  return seen.size===checks.length;
}
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

/** Closed Sep-19 RUN ownership proof. The date remains a date placeholder;
 * neither this certificate nor an append supplies a replacement clock. */
export function limestone2aRawTailChain(asset,rows,headId){
  if(asset?.tag_number!==LIMESTONE2A_TAG||asset.cycle_start_state!=='pending'||asset.cycle_started_at||
    instant(asset.last_replacement_at)!==instant(LIMESTONE2A_START))return null;
  const byId=new Map((rows||[]).map(row=>[row.id,row])),seen=new Set(),chain=[];
  let row=byId.get(headId),next=null;
  while(row&&chain.length<2000){
    const s=siloParse(row.source_text),x=s?.incremental;
    if(seen.has(row.id)||row.tag_number!==LIMESTONE2A_TAG||row.source_type!=='dataparc_runtime'||
      row.event_type!=='runtime_correction'||row.updated_at!==row.created_at||!s||s.schemaVersion!==1||s.requestType!=='blower_runtime_probe'||
      row.id!=='dataparc_runtime:'+s.requestId||row.source_log_id!==s.requestId||s.assetTag!==LIMESTONE2A_TAG||s.dataParcTag!==LIMESTONE2A_SIGNAL||
      s.manualOverride||s.replacementEdit||s.requiresRunRefresh||instant(s.expectedLastReplacementAt)!==instant(LIMESTONE2A_START)||
      String(s.expectedCycleStartRevision||'')!==String(asset.cycle_start_revision||'')||s.expectedCycleStartState!=='legacy'||
      s.signalOnlyCycle!==true||s.expectedCycleStartedAt||!safeSeconds(s.runningSeconds)||
      !['running','stopped'].includes(s.startState)||!['running','stopped'].includes(s.endState)||
      !Number.isFinite(instant(s.startAt))||instant(s.startAt)>=instant(s.endAt)||
      s.runningSeconds>(instant(s.endAt)-instant(s.startAt))/1000+2||instant(s.observedAt)!==instant(s.endAt)||
      instant(row.event_date)!==instant(s.observedAt))return null;
    const total=x?.totalRunningSeconds??s.runningSeconds;
    if(!safeSeconds(total)||!near(number(row.runtime_hours),total/3600)||
      next&&(next.incremental.baseRunningSeconds!==total||instant(next.startAt)!==instant(s.observedAt)||next.startState!==s.endState))return null;
    if(x&&(x.version!==1||x.deltaRunningSeconds!==s.runningSeconds||!safeSeconds(x.baseRunningSeconds)||
      x.totalRunningSeconds!==x.baseRunningSeconds+x.deltaRunningSeconds||instant(x.baseObservedAt)!==instant(s.startAt)||
      instant(x.coverageStartAt)!==instant(LIMESTONE2A_SEAM)))return null;
    seen.add(row.id);chain.push({row,source:s,totalRunningSeconds:total});
    if(!x)return instant(s.startAt)===instant(LIMESTONE2A_SEAM)?{chain,startState:s.startState,startAt:s.startAt,runningSeconds:chain[0].totalRunningSeconds}:null;
    next=s;row=byId.get(x.baseEventId);
  }return null;
}
export function limestone2aCompositeAppendBase(asset,rows,signal){
  const marker=String(asset?.cycle_start_revision||''),proofHash=marker.slice(LIMESTONE2A_CYCLE_PREFIX.length);
  if(asset?.tag_number!==LIMESTONE2A_TAG||signal!==LIMESTONE2A_SIGNAL||!marker.startsWith(LIMESTONE2A_CYCLE_PREFIX)||
    !/^[a-f0-9]{64}$/.test(proofHash)||instant(asset.last_replacement_at)!==instant(LIMESTONE2A_START)||
    asset.cycle_start_state!=='pending'||asset.cycle_started_at||!Array.isArray(rows))return null;
  const certificates=(rows||[]).filter(row=>row.tag_number===LIMESTONE2A_TAG&&row.source_type===LIMESTONE2A_SOURCE&&
    siloParse(row.source_text)?.cycleStartRevision===marker);
  if(certificates.length!==1)return null;
  const cert=certificates[0],s=siloParse(cert.source_text),p=s?.prefix,t=s?.tail,a=s?.attestation;
  if(!s||s.version!==1||s.assetTag!==LIMESTONE2A_TAG||s.dataParcTag!==signal||s.proofHash!==proofHash||
    cert.id!==LIMESTONE2A_CERT_PREFIX+p?.requestId||cert.source_log_id!==p?.requestId||cert.event_type!=='runtime_correction'||
    cert.updated_at!==cert.created_at||!Number.isFinite(instant(cert.created_at))||
    s.auditId!=='lime2a_first_run:'+p?.requestId||!/^[a-f0-9]{64}$/.test(s.sourceProofHash||'')||
    s.sampleGoodCertified!==false||s.completionClockKnown!==false||
    instant(p?.startAt)!==instant(LIMESTONE2A_START)||instant(p?.endAt)!==instant(LIMESTONE2A_SEAM)||
    p.runningSeconds!==50494||p.startState!=='stopped'||p.endState!=='running'||
    !Number.isFinite(instant(p.firstRunAt))||Math.floor(instant(p.firstRunAt)/1000)!==instant(LIMESTONE2A_FIRST_RUN)/1000||
    Math.abs((instant(LIMESTONE2A_SEAM)-instant(p.firstRunAt))/1000-p.runningSeconds)>2||
    !/^[a-f0-9]{64}$/.test(p.rawResultSha256||'')||!s.tailAsset||s.tailAsset.tag_number!==LIMESTONE2A_TAG||!t||
    !safeSeconds(t.runningSeconds)||!['running','stopped'].includes(t.endState)||!a||a.version!==1||
    typeof a.actorId!=='string'||!a.actorId.trim()||a.completionBeforeFirstRun!==true||a.noEarlierPostReplacementRun!==true||
    a.completionDay!=='2026-09-19'||a.firstRunAt!==p.firstRunAt||a.statementCode!=='BELT_COMPLETED_BEFORE_FIRST_RUN'||
    cert.created_by_id!==undefined&&cert.created_by_id!==a.actorId)return null;
  const ownerKeys=['id','tag_number','event_type','event_date','runtime_hours','issue_type','action_type','note','source_type','source_log_id','source_text','created_at','updated_at'];
  const ownerRows=rows.filter(row=>row.tag_number===LIMESTONE2A_TAG&&row.event_type==='replacement'&&instant(row.event_date)===instant(LIMESTONE2A_START));
  if(ownerRows.length!==1||!s.owner||s.owner.id!==LIMESTONE2A_OWNER||s.owner.source_type!=='shift_log_auto_v3'||
    ownerKeys.some(key=>!Object.hasOwn(s.owner,key))||Object.entries(s.owner).some(([key,value])=>ownerRows[0][key]!==value)||
    rows.some(row=>row.tag_number===LIMESTONE2A_TAG&&row.event_type==='replacement'&&row.id!==LIMESTONE2A_OWNER&&
      (!Number.isFinite(instant(row.event_date))||instant(row.event_date)>=instant(LIMESTONE2A_START))))return null;
  const oldRows=rows.filter(row=>row.source_type!==LIMESTONE2A_SOURCE),old=strictVerifiedAppendBase(s.tailAsset,oldRows,signal),chain=limestone2aRawTailChain(s.tailAsset,oldRows,t.eventId);
  if(!old||!chain||old.eventId!==t.eventId||old.runningSeconds!==t.runningSeconds||
    instant(old.startAt)!==instant(LIMESTONE2A_SEAM)||instant(old.observedAt)!==instant(t.observedAt)||
    chain.startState!=='running'||old.state!==t.endState||s.totalRunningSeconds!==50494+t.runningSeconds||
    !safeSeconds(s.totalRunningSeconds)||!near(number(cert.runtime_hours),s.totalRunningSeconds/3600)||
    instant(cert.event_date)!==instant(t.observedAt))return null;
  const byId=new Map(rows.map(row=>[row.id,row]));
  const relevant=rows.filter(row=>row.tag_number===LIMESTONE2A_TAG&&['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type));
  if(relevant.some(row=>!Number.isFinite(instant(row.event_date))||instant(row.event_date)>instant(asset.cycle_runtime_anchor_at)))return null;
  const owner=relevant.filter(row=>instant(row.event_date)===instant(asset.cycle_runtime_anchor_at)).sort(eventOrder)[0];
  let current=owner,seen=new Set(),currentSeconds=null,currentState=null;
  while(current&&seen.size<2000){
    if(current.id===cert.id){if(currentSeconds===null){currentSeconds=s.totalRunningSeconds;currentState=t.endState;}break;}
    if(seen.has(current.id)||current.source_type!=='dataparc_runtime'||current.updated_at!==current.created_at)return null;
    const raw=siloParse(current.source_text),x=raw?.incremental;
    if(!raw||!x||raw.schemaVersion!==1||raw.requestType!=='blower_runtime_probe'||x.version!==1||raw.assetTag!==LIMESTONE2A_TAG||raw.dataParcTag!==signal||
      raw.requestId!==current.source_log_id||current.id!=='dataparc_runtime:'+raw.requestId||raw.manualOverride||raw.replacementEdit||raw.requiresRunRefresh||
      instant(raw.expectedLastReplacementAt)!==instant(LIMESTONE2A_START)||raw.expectedCycleStartRevision!==marker||
      raw.expectedCycleStartState!=='legacy'||raw.signalOnlyCycle!==true||raw.expectedCycleStartedAt||
      !safeSeconds(raw.runningSeconds)||!safeSeconds(x.baseRunningSeconds)||!safeSeconds(x.totalRunningSeconds)||
      x.deltaRunningSeconds!==raw.runningSeconds||x.totalRunningSeconds!==x.baseRunningSeconds+raw.runningSeconds||
      !near(number(current.runtime_hours),x.totalRunningSeconds/3600)||instant(x.coverageStartAt)!==instant(LIMESTONE2A_START)||
      instant(x.baseObservedAt)!==instant(raw.startAt)||instant(raw.endAt)!==instant(raw.observedAt)||instant(raw.observedAt)!==instant(current.event_date)||
      instant(raw.endAt)<=instant(raw.startAt)||raw.runningSeconds>(instant(raw.endAt)-instant(raw.startAt))/1000+2||
      !['running','stopped'].includes(raw.startState)||!['running','stopped'].includes(raw.endState))return null;
    const predecessor=byId.get(x.baseEventId),previous=siloParse(predecessor?.source_text);
    const seconds=predecessor?.id===cert.id?s.totalRunningSeconds:previous?.incremental?.totalRunningSeconds??previous?.runningSeconds;
    const state=predecessor?.id===cert.id?t.endState:previous?.endState;
    if(!predecessor||seconds!==x.baseRunningSeconds||instant(predecessor.event_date)!==instant(raw.startAt)||raw.startState!==state)return null;
    if(currentSeconds===null){currentSeconds=x.totalRunningSeconds;currentState=raw.endState;}
    seen.add(current.id);current=predecessor;
  }
  if(current?.id!==cert.id||!owner||!safeSeconds(currentSeconds)||!near(number(asset.cycle_runtime_hours),currentSeconds/3600)||
    currentState!==asset.cycle_runtime_state)return null;
  const requestId=owner.id===cert.id?p.requestId:siloParse(owner.source_text)?.requestId;
  const metadata={version:1,certificateEventId:cert.id,prefixRequestId:p.requestId,auditId:s.auditId,proofHash,sourceProofHash:s.sourceProofHash,
    cycleStartRevision:marker,currentRuntimeRevision:asset.cycle_runtime_revision,currentRunningSeconds:currentSeconds,
    currentObservedAt:asset.cycle_runtime_anchor_at,currentAnchorAt:asset.cycle_runtime_anchor_at,currentState,measuredState:currentState,
    preservedStateBoundary:false,firstRunAt:p.firstRunAt,completionDay:'2026-09-19',completionClockKnown:false,
    completionBeforeFirstRun:true,noEarlierPostReplacementRun:true,durationEquivalent:true,prefixRunningSeconds:50494,
    originalTailRunningSeconds:t.runningSeconds,sampleGoodCertified:false};
  return {eventId:owner.id,requestId,startAt:LIMESTONE2A_START,observedAt:asset.cycle_runtime_anchor_at,dataParcTag:signal,
    runningSeconds:currentSeconds,runtimeHours:currentSeconds/3600,coverageComplete:true,requiredStartAt:LIMESTONE2A_START,
    missingLeadingSeconds:0,state:currentState,cycleRuntimeRevision:asset.cycle_runtime_revision,composite:true,appendReady:true,
    limestone2aFirstRun:metadata};
}
function limestone2aCompositeBoundaryBase(asset,rows,signal){
  const stored=number(asset.cycle_runtime_hours),anchor=instant(asset.cycle_runtime_anchor_at);
  if(!Number.isFinite(stored)||!Number.isFinite(anchor))return null;
  const relevant=(rows||[]).filter(row=>row.tag_number===LIMESTONE2A_TAG&&['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type));
  const owner=relevant.filter(row=>instant(row.event_date)===anchor).sort(eventOrder)[0];
  const manual=owner?.source_type==='manual'?manualRuntimeOverlayState(owner):'',automatic=automaticBoundaryState(owner);
  if(!owner||(!manual&&!automatic)||(manual||automatic)!==asset.cycle_runtime_state||!near(number(owner.runtime_hours),stored))return null;
  const measured=relevant.filter(row=>row.source_type===LIMESTONE2A_SOURCE||row.source_type==='dataparc_runtime'&&siloParse(row.source_text)?.expectedCycleStartRevision===asset.cycle_start_revision)
    .sort((a,b)=>instant(b.event_date)-instant(a.event_date)||eventOrder(a,b));
  const receipt=measured[0],source=siloParse(receipt?.source_text),observed=instant(receipt?.event_date);
  const state=receipt?.source_type===LIMESTONE2A_SOURCE?source?.tail?.endState:source?.endState;
  if(!receipt||!Number.isFinite(observed)||observed>=anchor||!near(number(receipt.runtime_hours),stored))return null;
  const overlays=relevant.filter(row=>instant(row.event_date)>observed&&instant(row.event_date)<=anchor);
  if(!overlays.length||!overlays.some(row=>row.id===owner.id)||overlays.some(row=>!near(number(row.runtime_hours),stored)))return null;
  if(!overlays.every(row=>row.source_type==='manual'&&Boolean(manualRuntimeOverlayState(row)))&&
    !overlays.every(row=>Boolean(automaticBoundaryState(row))))return null;
  if(relevant.some(row=>!Number.isFinite(instant(row.event_date))||instant(row.event_date)>anchor))return null;
  const measuredRows=rows.filter(row=>row.tag_number!==LIMESTONE2A_TAG||!['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type)||instant(row.event_date)<=observed);
  const base=limestone2aCompositeAppendBase({...asset,cycle_runtime_anchor_at:receipt.event_date,cycle_runtime_state:state,cycle_runtime_hours:receipt.runtime_hours},measuredRows,signal);
  return base?{...base,cycleRuntimeRevision:asset.cycle_runtime_revision,preservedStateBoundary:true,
    limestone2aFirstRun:{...base.limestone2aFirstRun,currentRuntimeRevision:asset.cycle_runtime_revision,
      currentAnchorAt:asset.cycle_runtime_anchor_at,currentState:asset.cycle_runtime_state,preservedStateBoundary:true}}:null;
}

/** The old day-based total is comparison evidence only. The replacement
 * counter is owned by a new immutable measurement beginning at the first RUN. */
export function limestone1bRawBaselineChain(asset,rows,headId){
  if(asset?.tag_number!==LIMESTONE1B_TAG||asset.blower_type!=='limestone'||String(asset.unit_no)!=='1'||Number(asset.enabled)!==1||asset.cycle_start_state!=='pending'||asset.cycle_started_at||
    instant(asset.last_replacement_at)!==instant(LIMESTONE1B_DAY_START))return null;
  const byId=new Map((rows||[]).map(row=>[row.id,row])),seen=new Set(),chain=[];
  let row=byId.get(headId),next=null,chunkCount=0;
  while(row&&chain.length<2000){
    const s=siloParse(row.source_text),x=s?.incremental;
    if(seen.has(row.id)||row.tag_number!==LIMESTONE1B_TAG||row.source_type!=='dataparc_runtime'||
      row.event_type!=='runtime_correction'||row.updated_at!==row.created_at||!s||s.schemaVersion!==1||s.requestType!=='blower_runtime_probe'||
      row.id!=='dataparc_runtime:'+s.requestId||row.source_log_id!==s.requestId||s.assetTag!==LIMESTONE1B_TAG||s.dataParcTag!==LIMESTONE1B_SIGNAL||
      s.manualOverride||s.replacementEdit||s.requiresRunRefresh||instant(s.expectedLastReplacementAt)!==instant(LIMESTONE1B_DAY_START)||
      String(s.expectedCycleStartRevision||'')!==String(asset.cycle_start_revision||'')||s.expectedCycleStartState!=='legacy'||
      s.signalOnlyCycle!==true||s.expectedCycleStartedAt||!safeSeconds(s.runningSeconds)||
      !Number.isSafeInteger(s.chunkCount)||s.chunkCount<1||s.chunkCount>12||
      !['running','stopped'].includes(s.startState)||!['running','stopped'].includes(s.endState)||
      !Number.isFinite(instant(s.startAt))||instant(s.startAt)>=instant(s.endAt)||s.runningSeconds>(instant(s.endAt)-instant(s.startAt))/1000+2||
      instant(s.observedAt)!==instant(s.endAt)||instant(row.event_date)!==instant(s.observedAt))return null;
    const total=x?.totalRunningSeconds??s.runningSeconds;
    if(!safeSeconds(total)||!near(number(row.runtime_hours),total/3600)||
      next&&(next.incremental.baseRunningSeconds!==total||instant(next.startAt)!==instant(s.observedAt)||next.startState!==s.endState))return null;
    if(x&&(x.version!==1||x.deltaRunningSeconds!==s.runningSeconds||!safeSeconds(x.baseRunningSeconds)||
      x.totalRunningSeconds!==x.baseRunningSeconds+x.deltaRunningSeconds||instant(x.baseObservedAt)!==instant(s.startAt)||
      instant(x.coverageStartAt)!==instant(LIMESTONE1B_DAY_START)))return null;
    seen.add(row.id);chain.push({row,source:s,totalRunningSeconds:total});chunkCount+=s.chunkCount;
    if(!x)return instant(s.startAt)===instant(LIMESTONE1B_DAY_START)&&s.startState==='running'
      ?{chain,startState:s.startState,startAt:s.startAt,runningSeconds:chain[0].totalRunningSeconds,chunkCount}:null;
    next=s;row=byId.get(x.baseEventId);
  }return null;
}
export function limestone1bFirstRunAppendBase(asset,rows,signal){
  const marker=String(asset?.cycle_start_revision||''),proofHash=marker.slice(LIMESTONE1B_CYCLE_PREFIX.length);
  if(asset?.tag_number!==LIMESTONE1B_TAG||asset.blower_type!=='limestone'||String(asset.unit_no)!=='1'||Number(asset.enabled)!==1||signal!==LIMESTONE1B_SIGNAL||!marker.startsWith(LIMESTONE1B_CYCLE_PREFIX)||
    !/^[a-f0-9]{64}$/.test(proofHash)||instant(asset.last_replacement_at)!==instant(LIMESTONE1B_DAY_START)||
    asset.cycle_start_state!=='pending'||asset.cycle_started_at||!Array.isArray(rows))return null;
  const certificates=rows.filter(row=>row.tag_number===LIMESTONE1B_TAG&&row.source_type===LIMESTONE1B_SOURCE&&siloParse(row.source_text)?.cycleStartRevision===marker);
  if(certificates.length!==1)return null;
  const cert=certificates[0],s=siloParse(cert.source_text),m=s?.measurement,r=s?.r9,b=s?.baseline,a=s?.attestation,c=s?.comparison;
  if(!s||s.version!==1||s.assetTag!==LIMESTONE1B_TAG||s.dataParcTag!==signal||s.proofHash!==proofHash||
    cert.id!==LIMESTONE1B_CERT_PREFIX+m?.requestId||cert.source_log_id!==m?.requestId||cert.event_type!=='runtime_correction'||
    cert.updated_at!==cert.created_at||!Number.isFinite(instant(cert.created_at))||s.auditId!=='lime1b_first_run:'+m?.requestId||
    !/^[a-f0-9]{64}$/.test(s.sourceProofHash||'')||s.sampleGoodCertified!==false||s.completionClockKnown!==false||
    !s.baselineAsset||s.baselineAsset.tag_number!==LIMESTONE1B_TAG||!b||!r||!m||!c||!a||
    !safeSeconds(m.runningSeconds)||!Number.isSafeInteger(m.chunkCount)||m.chunkCount<1||m.chunkCount>12||
    instant(m.startAt)!==instant(LIMESTONE1B_FIRST_RUN)||instant(m.endAt)!==instant(b.observedAt)||
    !['running','stopped'].includes(m.startState)||!['running','stopped'].includes(m.endState)||
    !/^[a-f0-9]{64}$/.test(m.rawResultSha256||'')||!r.requestId||!/^[a-f0-9]{64}$/.test(r.rawResultSha256||'')||
    Math.floor(instant(r.oldStopAt)/1000)!==instant(LIMESTONE1B_STOP)/1000||Math.floor(instant(r.firstRunAt)/1000)!==instant(LIMESTONE1B_FIRST_RUN)/1000||
    instant(r.firstRunAt)<instant(m.startAt)||instant(r.firstRunAt)>=instant(m.startAt)+1000||r.dailyRunningSeconds!==85140||
    r.excludedDurationMilliseconds!==instant(r.oldStopAt)-instant(LIMESTONE1B_DAY_START)||
    r.excludedRunningSeconds!==Math.round(r.excludedDurationMilliseconds/1000)||![34166,34167].includes(r.excludedRunningSeconds)||
    r.postRunningSeconds!==Math.round((instant(LIMESTONE1B_DAY_END)-instant(r.firstRunAt))/1000)||
    Math.abs(r.excludedRunningSeconds+r.postRunningSeconds-r.dailyRunningSeconds)>2||
    a.version!==1||typeof a.actorId!=='string'||!a.actorId.trim()||a.completionDay!=='2026-09-22'||
    a.firstRunAt!==r.firstRunAt||a.oldRunStoppedAt!==r.oldStopAt||a.priorRunBelongsToPreviousBelt!==true||
    a.noEarlierPostReplacementRun!==true||a.completedDuringStoppedWindow!==true||
    a.statementCode!=='BELT_COMPLETED_DURING_OBSERVED_STOP_BEFORE_FIRST_RUN'||cert.created_by_id!==undefined&&cert.created_by_id!==a.actorId)return null;
  const ownerKeys=['id','tag_number','event_type','event_date','runtime_hours','issue_type','action_type','note','source_type','source_log_id','source_text','created_at','updated_at'];
  const owners=rows.filter(row=>row.tag_number===LIMESTONE1B_TAG&&row.event_type==='replacement'&&instant(row.event_date)===instant(LIMESTONE1B_DAY_START));
  if(owners.length!==1||!s.owner||s.owner.id!==LIMESTONE1B_OWNER||s.owner.source_type!=='manual'||ownerKeys.some(key=>!Object.hasOwn(s.owner,key))||
    Object.entries(s.owner).some(([key,value])=>owners[0][key]!==value)||rows.some(row=>row.tag_number===LIMESTONE1B_TAG&&row.event_type==='replacement'&&row.id!==LIMESTONE1B_OWNER&&
      (!Number.isFinite(instant(row.event_date))||instant(row.event_date)>=instant(LIMESTONE1B_DAY_START))))return null;
  const role=s.roleOwner,roleRow=rows.find(row=>row.id===role?.id),roleSource=siloParse(role?.source_text),selection=roleSource?.rolePrioritySelection;
  if(!role||!roleRow||!String(role.id).startsWith('replacement-auto-v3:role-priority:')||role.event_type!=='cycle_source_reconcile'||
    role.source_type!=='shift_log_auto_v3'||role.source_log_id!=='legacy-POCHEON#20260922#DAY#BCO1'||ownerKeys.some(key=>!Object.hasOwn(role,key))||
    Object.entries(role).some(([key,value])=>roleRow[key]!==value)||roleSource?.schemaVersion!==3||roleSource.replacementAutoV3!==true||
    roleSource.sourceRevisionSuperseded===true||roleSource.rolePrioritySupersededBy||roleSource.replacementEventId!==LIMESTONE1B_OWNER||
    instant(roleSource.currentLastReplacementAt)!==instant(LIMESTONE1B_DAY_START)||roleSource.cycleStartRevision!==s.baselineAsset.cycle_start_revision||
    roleSource.timePrecision!=='day'||roleSource.recordDate!=='2026-09-22'||selection?.version!==1||selection.selectedRole!=='BCO1'||
    selection.timePrecision!=='day'||selection.selectedCompletionAt||selection.selectedWorkDate!=='2026-09-22'||selection.selectedShift!=='DS'||selection.requiredRebuild===true)return null;
  const oldRows=rows.filter(row=>row.source_type!==LIMESTONE1B_SOURCE),old=strictVerifiedAppendBase(s.baselineAsset,oldRows,signal),oldChain=limestone1bRawBaselineChain(s.baselineAsset,oldRows,b.eventId);
  if(!old||!oldChain||old.eventId!==b.eventId||old.runningSeconds!==b.runningSeconds||oldChain.chunkCount!==b.chunkCount||
    instant(old.startAt)!==instant(LIMESTONE1B_DAY_START)||instant(old.observedAt)!==instant(b.observedAt)||old.state!==m.endState||
    c.expectedRunningSeconds!==b.runningSeconds-r.excludedRunningSeconds||!safeSeconds(c.expectedRunningSeconds)||
    c.toleranceSeconds!==Math.ceil((oldChain.chunkCount+m.chunkCount+1)/2)+2||
    c.differenceSeconds!==m.runningSeconds-c.expectedRunningSeconds||Math.abs(c.differenceSeconds)>c.toleranceSeconds||
    m.runningSeconds>(instant(m.endAt)-instant(m.startAt))/1000+2||!near(number(cert.runtime_hours),m.runningSeconds/3600)||
    instant(cert.event_date)!==instant(m.endAt))return null;
  const byId=new Map(rows.map(row=>[row.id,row])),relevant=rows.filter(row=>row.tag_number===LIMESTONE1B_TAG&&['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type));
  if(relevant.some(row=>!Number.isFinite(instant(row.event_date))||instant(row.event_date)>instant(asset.cycle_runtime_anchor_at)))return null;
  const owner=relevant.filter(row=>instant(row.event_date)===instant(asset.cycle_runtime_anchor_at)).sort(eventOrder)[0];
  let current=owner,seen=new Set(),seconds=null,state=null;
  while(current&&seen.size<2000){
    if(current.id===cert.id){if(seconds===null){seconds=m.runningSeconds;state=m.endState;}break;}
    const raw=siloParse(current.source_text),x=raw?.incremental;
    if(seen.has(current.id)||current.source_type!=='dataparc_runtime'||current.updated_at!==current.created_at||!raw||!x||
      raw.schemaVersion!==1||raw.requestType!=='blower_runtime_probe'||x.version!==1||raw.assetTag!==LIMESTONE1B_TAG||raw.dataParcTag!==signal||
      raw.requestId!==current.source_log_id||current.id!=='dataparc_runtime:'+raw.requestId||raw.manualOverride||raw.replacementEdit||raw.requiresRunRefresh||
      instant(raw.expectedLastReplacementAt)!==instant(LIMESTONE1B_DAY_START)||raw.expectedCycleStartRevision!==marker||raw.expectedCycleStartState!=='legacy'||
      raw.signalOnlyCycle!==true||raw.expectedCycleStartedAt||!safeSeconds(raw.runningSeconds)||!safeSeconds(x.baseRunningSeconds)||!safeSeconds(x.totalRunningSeconds)||
      x.deltaRunningSeconds!==raw.runningSeconds||x.totalRunningSeconds!==x.baseRunningSeconds+raw.runningSeconds||!near(number(current.runtime_hours),x.totalRunningSeconds/3600)||
      instant(x.coverageStartAt)!==instant(LIMESTONE1B_FIRST_RUN)||instant(x.baseObservedAt)!==instant(raw.startAt)||instant(raw.endAt)!==instant(raw.observedAt)||
      instant(raw.observedAt)!==instant(current.event_date)||instant(raw.endAt)<=instant(raw.startAt)||raw.runningSeconds>(instant(raw.endAt)-instant(raw.startAt))/1000+2||
      !['running','stopped'].includes(raw.startState)||!['running','stopped'].includes(raw.endState))return null;
    const prev=byId.get(x.baseEventId),p=siloParse(prev?.source_text),total=prev?.id===cert.id?m.runningSeconds:p?.incremental?.totalRunningSeconds??p?.runningSeconds;
    if(!prev||total!==x.baseRunningSeconds||instant(prev.event_date)!==instant(raw.startAt)||raw.startState!==(prev.id===cert.id?m.endState:p?.endState))return null;
    if(seconds===null){seconds=x.totalRunningSeconds;state=raw.endState;}seen.add(current.id);current=prev;
  }
  if(current?.id!==cert.id||!owner||!safeSeconds(seconds)||!near(number(asset.cycle_runtime_hours),seconds/3600)||state!==asset.cycle_runtime_state)return null;
  const metadata={version:1,certificateEventId:cert.id,freshRequestId:m.requestId,r9RequestId:r.requestId,auditId:s.auditId,proofHash,sourceProofHash:s.sourceProofHash,
    cycleStartRevision:marker,currentRuntimeRevision:asset.cycle_runtime_revision,currentRunningSeconds:seconds,currentObservedAt:asset.cycle_runtime_anchor_at,
    currentAnchorAt:asset.cycle_runtime_anchor_at,currentState:state,measuredState:state,preservedStateBoundary:false,
    firstRunAt:r.firstRunAt,rawFirstRunAt:r.firstRunAt,rawOldStopAt:r.oldStopAt,measurementStartAt:m.startAt,completionDay:'2026-09-22',completionClockKnown:false,
    completionBeforeFirstRun:true,completionWithinStoppedWindow:true,completedDuringStoppedWindow:true,priorRunBelongsToPreviousBelt:true,
    noEarlierPostReplacementRun:true,durationEquivalent:true,
    excludedRunningSeconds:r.excludedRunningSeconds,comparisonToleranceSeconds:c.toleranceSeconds,comparisonDifferenceSeconds:c.differenceSeconds,
    originalRunningSeconds:b.runningSeconds,freshRunningSeconds:m.runningSeconds,sampleGoodCertified:false};
  return {eventId:owner.id,requestId:owner.id===cert.id?m.requestId:siloParse(owner.source_text)?.requestId,startAt:LIMESTONE1B_FIRST_RUN,
    observedAt:asset.cycle_runtime_anchor_at,dataParcTag:signal,runningSeconds:seconds,runtimeHours:seconds/3600,coverageComplete:true,
    requiredStartAt:LIMESTONE1B_FIRST_RUN,missingLeadingSeconds:0,state,cycleRuntimeRevision:asset.cycle_runtime_revision,composite:true,appendReady:true,limestone1bFirstRun:metadata};
}
function limestone1bFirstRunBoundaryBase(asset,rows,signal){
  const stored=number(asset.cycle_runtime_hours),anchor=instant(asset.cycle_runtime_anchor_at);
  if(!Number.isFinite(stored)||!Number.isFinite(anchor))return null;
  const relevant=(rows||[]).filter(row=>row.tag_number===LIMESTONE1B_TAG&&['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type));
  const owner=relevant.filter(row=>instant(row.event_date)===anchor).sort(eventOrder)[0],manual=owner?.source_type==='manual'?manualRuntimeOverlayState(owner):'',automatic=automaticBoundaryState(owner);
  if(!owner||(!manual&&!automatic)||(manual||automatic)!==asset.cycle_runtime_state||!near(number(owner.runtime_hours),stored))return null;
  const receipt=relevant.filter(row=>row.source_type===LIMESTONE1B_SOURCE||row.source_type==='dataparc_runtime'&&siloParse(row.source_text)?.expectedCycleStartRevision===asset.cycle_start_revision)
    .sort((a,b)=>instant(b.event_date)-instant(a.event_date)||eventOrder(a,b))[0],source=siloParse(receipt?.source_text),observed=instant(receipt?.event_date);
  const state=receipt?.source_type===LIMESTONE1B_SOURCE?source?.measurement?.endState:source?.endState;
  if(!receipt||!Number.isFinite(observed)||observed>=anchor||!near(number(receipt.runtime_hours),stored))return null;
  const overlays=relevant.filter(row=>instant(row.event_date)>observed&&instant(row.event_date)<=anchor);
  if(!overlays.length||!overlays.some(row=>row.id===owner.id)||overlays.some(row=>!near(number(row.runtime_hours),stored))||
    !overlays.every(row=>row.source_type==='manual'&&Boolean(manualRuntimeOverlayState(row)))&&!overlays.every(row=>Boolean(automaticBoundaryState(row)))||
    relevant.some(row=>!Number.isFinite(instant(row.event_date))||instant(row.event_date)>anchor))return null;
  const measuredRows=rows.filter(row=>row.tag_number!==LIMESTONE1B_TAG||!['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type)||instant(row.event_date)<=observed);
  const base=limestone1bFirstRunAppendBase({...asset,cycle_runtime_anchor_at:receipt.event_date,cycle_runtime_state:state,cycle_runtime_hours:receipt.runtime_hours},measuredRows,signal);
  return base?{...base,cycleRuntimeRevision:asset.cycle_runtime_revision,preservedStateBoundary:true,
    limestone1bFirstRun:{...base.limestone1bFirstRun,currentRuntimeRevision:asset.cycle_runtime_revision,currentAnchorAt:asset.cycle_runtime_anchor_at,
      currentState:asset.cycle_runtime_state,preservedStateBoundary:true}}:null;
}
/* A closed repair owns a fresh whole measurement after a proven zero envelope.
 * The old contaminated total remains immutable comparison evidence only. */
export function fbhe1aRawBaselineChain(asset,rows,headId){
  if(asset?.tag_number!==FBHE1A_TAG||asset.blower_type!=='fbhe'||String(asset.unit_no)!=='1'||Number(asset.enabled)!==1||asset.cycle_start_state!=='legacy'||asset.cycle_started_at||
    instant(asset.last_replacement_at)!==instant(FBHE1A_DAY_START))return null;
  const byId=new Map((rows||[]).map(row=>[row.id,row])),seen=new Set(),chain=[];
  let row=byId.get(headId),next=null,chunkCount=0;
  while(row&&chain.length<2000){
    const s=siloParse(row.source_text),x=s?.incremental;
    if(seen.has(row.id)||row.tag_number!==FBHE1A_TAG||row.source_type!=='dataparc_runtime'||
      row.event_type!=='runtime_correction'||row.updated_at!==row.created_at||!s||s.schemaVersion!==1||s.requestType!=='blower_runtime_probe'||
      row.id!=='dataparc_runtime:'+s.requestId||row.source_log_id!==s.requestId||s.assetTag!==FBHE1A_TAG||s.dataParcTag!==FBHE1A_SIGNAL||
      s.manualOverride||s.replacementEdit||s.requiresRunRefresh||instant(s.expectedLastReplacementAt)!==instant(FBHE1A_DAY_START)||
      String(s.expectedCycleStartRevision||'')!==String(asset.cycle_start_revision||'')||s.expectedCycleStartState!=='legacy'||
      (s.signalOnlyCycle!==undefined&&s.signalOnlyCycle!==false)||s.expectedCycleStartedAt||!safeSeconds(s.runningSeconds)||
      !Number.isSafeInteger(s.chunkCount)||s.chunkCount<1||s.chunkCount>12||
      !['running','stopped'].includes(s.startState)||!['running','stopped'].includes(s.endState)||
      !Number.isFinite(instant(s.startAt))||instant(s.startAt)>=instant(s.endAt)||s.runningSeconds>(instant(s.endAt)-instant(s.startAt))/1000+2||
      instant(s.observedAt)!==instant(s.endAt)||instant(row.event_date)!==instant(s.observedAt))return null;
    const total=x?.totalRunningSeconds??s.runningSeconds;
    if(!safeSeconds(total)||!near(number(row.runtime_hours),total/3600)||
      next&&(next.incremental.baseRunningSeconds!==total||instant(next.startAt)!==instant(s.observedAt)||next.startState!==s.endState))return null;
    if(x&&(x.version!==1||x.deltaRunningSeconds!==s.runningSeconds||!safeSeconds(x.baseRunningSeconds)||
      x.totalRunningSeconds!==x.baseRunningSeconds+x.deltaRunningSeconds||instant(x.baseObservedAt)!==instant(s.startAt)||
      instant(x.coverageStartAt)!==instant(FBHE1A_BASE_START)))return null;
    seen.add(row.id);chain.push({row,source:s,totalRunningSeconds:total});chunkCount+=s.chunkCount;
    if(!x)return instant(s.startAt)===instant(FBHE1A_BASE_START)&&s.startState==='running'
      ?{chain,startState:s.startState,startAt:s.startAt,runningSeconds:chain[0].totalRunningSeconds,chunkCount}:null;
    next=s;row=byId.get(x.baseEventId);
  }return null;
}
export function fbhe1aRuntimeAppendBase(asset,rows,signal){
  const marker=String(asset?.cycle_start_revision||''),proofHash=marker.slice(FBHE1A_CYCLE_PREFIX.length);
  if(asset?.tag_number!==FBHE1A_TAG||asset.blower_type!=='fbhe'||String(asset.unit_no)!=='1'||Number(asset.enabled)!==1||signal!==FBHE1A_SIGNAL||!marker.startsWith(FBHE1A_CYCLE_PREFIX)||
    !/^[a-f0-9]{64}$/.test(proofHash)||instant(asset.last_replacement_at)!==instant(FBHE1A_DAY_START)||
    asset.cycle_start_state!=='legacy'||asset.cycle_started_at||!Array.isArray(rows))return null;
  const certificates=rows.filter(row=>row.tag_number===FBHE1A_TAG&&row.source_type===FBHE1A_SOURCE&&siloParse(row.source_text)?.cycleStartRevision===marker);
  if(certificates.length!==1)return null;
  const cert=certificates[0],s=siloParse(cert.source_text),m=s?.measurement,r=s?.r9,b=s?.baseline,a=s?.attestation,c=s?.comparison;
  if(!s||s.version!==1||s.assetTag!==FBHE1A_TAG||s.dataParcTag!==signal||s.proofHash!==proofHash||
    cert.id!==FBHE1A_CERT_PREFIX+m?.requestId||cert.source_log_id!==m?.requestId||cert.event_type!=='runtime_correction'||
    cert.updated_at!==cert.created_at||!Number.isFinite(instant(cert.created_at))||s.auditId!=='fbhe1a_runtime:'+m?.requestId||
    !/^[a-f0-9]{64}$/.test(s.sourceProofHash||'')||s.sampleGoodCertified!==false||s.completionClockKnown!==false||
    !s.baselineAsset||s.baselineAsset.tag_number!==FBHE1A_TAG||!b||!r||!m||!c||!a||
    !safeSeconds(m.runningSeconds)||!Number.isSafeInteger(m.chunkCount)||m.chunkCount<1||m.chunkCount>12||
    instant(m.startAt)!==instant(FBHE1A_MEASURED_START)||instant(m.endAt)!==instant(b.observedAt)||
    m.startState!=='stopped'||!['running','stopped'].includes(m.endState)||
    !/^[a-f0-9]{64}$/.test(m.rawResultSha256||'')||!r.requestId||!/^[a-f0-9]{64}$/.test(r.rawResultSha256||'')||
    Math.floor(instant(r.lastRunStoppedAt)/1000)!==instant(FBHE1A_STOP)/1000||r.dailyRunningSeconds!==39040||
    instant(r.zeroWindowEndAt)!==instant(FBHE1A_MEASURED_START)||
    r.excludedDurationMilliseconds!==instant(r.lastRunStoppedAt)-instant(FBHE1A_BASE_START)||
    r.excludedRunningSeconds!==Math.round(r.excludedDurationMilliseconds/1000)||![39,40].includes(r.excludedRunningSeconds)||
    a.version!==1||typeof a.actorId!=='string'||!a.actorId.trim()||a.completionDay!=='2026-09-04'||
    a.lastRunStoppedAt!==r.lastRunStoppedAt||a.replacementCompletedAfterStop!==true||a.noRestartThroughWindowEnd!==true||
    instant(a.zeroWindowEndAt)!==instant(FBHE1A_MEASURED_START)||
    a.operatorReportedRestartDay!==undefined&&a.operatorReportedRestartDay!=='2026-10-08'||
    a.statementCode!=='BELT_COMPLETED_AFTER_LAST_STOP_AND_REMAINED_STANDBY_THROUGH_WINDOW_END'||cert.created_by_id!==undefined&&cert.created_by_id!==a.actorId)return null;
  const ownerKeys=['id','tag_number','event_type','event_date','runtime_hours','issue_type','action_type','note','source_type','source_log_id','source_text','created_at','updated_at'];
  const owners=rows.filter(row=>row.tag_number===FBHE1A_TAG&&row.event_type==='replacement'&&instant(row.event_date)===instant(FBHE1A_DAY_START));
  if(owners.length!==1||!s.owner||s.owner.id!==FBHE1A_OWNER||s.owner.source_type!=='manual'||ownerKeys.some(key=>!Object.hasOwn(s.owner,key))||
    Object.entries(s.owner).some(([key,value])=>owners[0][key]!==value)||rows.some(row=>row.tag_number===FBHE1A_TAG&&row.event_type==='replacement'&&row.id!==FBHE1A_OWNER&&
      (!Number.isFinite(instant(row.event_date))||instant(row.event_date)>=instant(FBHE1A_DAY_START))))return null;
  const role=s.roleOwner,roleRow=rows.find(row=>row.id===role?.id),roleSource=siloParse(role?.source_text),roleKey=siloParse(roleSource?.sourceKey);
  if(!role||!roleRow||role.event_type!=='cycle_source_reconcile'||role.source_type!=='shift_log_auto_v3'||
    role.source_log_id!=='legacy-POCHEON#20260904#DAY#BCO1'||ownerKeys.some(key=>!Object.hasOwn(role,key))||
    Object.entries(role).some(([key,value])=>roleRow[key]!==value)||roleSource?.schemaVersion!==3||roleSource.replacementAutoV3!==true||
    roleSource.currentCycle!==true||roleSource.normalizationVersion!==4||roleSource.sourceRevisionSuperseded===true||
    roleSource.rolePrioritySupersededBy||roleSource.rolePrioritySourceRevoked===true||roleSource.replacementEventId!==FBHE1A_OWNER||
    instant(roleSource.currentLastReplacementAt)!==instant(FBHE1A_DAY_START)||roleSource.cycleStartRevision!==s.baselineAsset.cycle_start_revision||
    roleSource.timePrecision!=='day'||roleSource.recordDate!=='2026-09-04'||roleSource.registeredRuntimeRange!==true||
    roleSource.rangeTrackingAllowed!==true||instant(roleSource.rangeStartAt)!==instant(FBHE1A_BASE_START)||
    !Array.isArray(roleKey)||roleKey.length!==4||roleKey[0]!==role.source_log_id||roleKey[1]!==FBHE1A_TAG||
    roleKey[2]!=='legacy-entry-POCHEON#20260904#DAY#BCO1-2-1')return null;
  const oldRows=rows.filter(row=>row.source_type!==FBHE1A_SOURCE),old=strictVerifiedAppendBase(s.baselineAsset,oldRows,signal),oldChain=fbhe1aRawBaselineChain(s.baselineAsset,oldRows,b.eventId);
  if(!old||!oldChain||old.eventId!==b.eventId||old.runningSeconds!==b.runningSeconds||oldChain.chunkCount!==b.chunkCount||
    instant(old.startAt)!==instant(FBHE1A_BASE_START)||instant(old.observedAt)!==instant(b.observedAt)||old.state!==m.endState||
    c.expectedRunningSeconds!==b.runningSeconds-r.excludedRunningSeconds||!safeSeconds(c.expectedRunningSeconds)||
    c.toleranceSeconds!==Math.ceil((oldChain.chunkCount+m.chunkCount+1)/2)+2||
    c.oldChunkCount!==oldChain.chunkCount||c.newChunkCount!==m.chunkCount||c.prefixRoundCount!==1||c.r9ContractMarginSeconds!==2||
    c.differenceSeconds!==m.runningSeconds-c.expectedRunningSeconds||Math.abs(c.differenceSeconds)>c.toleranceSeconds||
    m.runningSeconds>(instant(m.endAt)-instant(m.startAt))/1000+2||!near(number(cert.runtime_hours),m.runningSeconds/3600)||
    instant(cert.event_date)!==instant(m.endAt))return null;
  const byId=new Map(rows.map(row=>[row.id,row])),relevant=rows.filter(row=>row.tag_number===FBHE1A_TAG&&['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type));
  if(relevant.some(row=>!Number.isFinite(instant(row.event_date))||instant(row.event_date)>instant(asset.cycle_runtime_anchor_at)))return null;
  const owner=relevant.filter(row=>instant(row.event_date)===instant(asset.cycle_runtime_anchor_at)).sort(eventOrder)[0];
  let current=owner,seen=new Set(),seconds=null,state=null;
  while(current&&seen.size<2000){
    if(current.id===cert.id){if(seconds===null){seconds=m.runningSeconds;state=m.endState;}break;}
    const raw=siloParse(current.source_text),x=raw?.incremental;
    if(seen.has(current.id)||current.source_type!=='dataparc_runtime'||current.updated_at!==current.created_at||!raw||!x||
      raw.schemaVersion!==1||raw.requestType!=='blower_runtime_probe'||x.version!==1||raw.assetTag!==FBHE1A_TAG||raw.dataParcTag!==signal||
      raw.requestId!==current.source_log_id||current.id!=='dataparc_runtime:'+raw.requestId||raw.manualOverride||raw.replacementEdit||raw.requiresRunRefresh||
      instant(raw.expectedLastReplacementAt)!==instant(FBHE1A_DAY_START)||raw.expectedCycleStartRevision!==marker||raw.expectedCycleStartState!=='legacy'||
      (raw.signalOnlyCycle!==undefined&&raw.signalOnlyCycle!==false)||raw.expectedCycleStartedAt||!safeSeconds(raw.runningSeconds)||!safeSeconds(x.baseRunningSeconds)||!safeSeconds(x.totalRunningSeconds)||
      x.deltaRunningSeconds!==raw.runningSeconds||x.totalRunningSeconds!==x.baseRunningSeconds+raw.runningSeconds||!near(number(current.runtime_hours),x.totalRunningSeconds/3600)||
      instant(x.coverageStartAt)!==instant(FBHE1A_MEASURED_START)||instant(x.baseObservedAt)!==instant(raw.startAt)||instant(raw.endAt)!==instant(raw.observedAt)||
      instant(raw.observedAt)!==instant(current.event_date)||instant(raw.endAt)<=instant(raw.startAt)||raw.runningSeconds>(instant(raw.endAt)-instant(raw.startAt))/1000+2||
      !['running','stopped'].includes(raw.startState)||!['running','stopped'].includes(raw.endState))return null;
    const prev=byId.get(x.baseEventId),p=siloParse(prev?.source_text),total=prev?.id===cert.id?m.runningSeconds:p?.incremental?.totalRunningSeconds??p?.runningSeconds;
    if(!prev||total!==x.baseRunningSeconds||instant(prev.event_date)!==instant(raw.startAt)||raw.startState!==(prev.id===cert.id?m.endState:p?.endState))return null;
    if(seconds===null){seconds=x.totalRunningSeconds;state=raw.endState;}seen.add(current.id);current=prev;
  }
  if(current?.id!==cert.id||!owner||!safeSeconds(seconds)||!near(number(asset.cycle_runtime_hours),seconds/3600)||state!==asset.cycle_runtime_state)return null;
  const metadata={version:1,certificateEventId:cert.id,freshRequestId:m.requestId,witnessRequestId:r.requestId,auditId:s.auditId,proofHash,sourceProofHash:s.sourceProofHash,
    cycleStartRevision:marker,currentRuntimeRevision:asset.cycle_runtime_revision,currentRunningSeconds:seconds,currentObservedAt:asset.cycle_runtime_anchor_at,
    currentAnchorAt:asset.cycle_runtime_anchor_at,currentState:state,measuredState:state,preservedStateBoundary:false,
    lastRunStoppedAt:r.lastRunStoppedAt,zeroWindowEndAt:r.zeroWindowEndAt,measuredStartAt:m.startAt,completionDay:'2026-09-04',completionClockKnown:false,
    replacementCompletedAfterStop:true,noRestartThroughWindowEnd:true,durationEquivalent:true,
    ...(a.operatorReportedRestartDay?{operatorReportedRestartDay:a.operatorReportedRestartDay}:{}),
    excludedPreReplacementSeconds:r.excludedRunningSeconds,comparisonToleranceSeconds:c.toleranceSeconds,comparisonDifferenceSeconds:c.differenceSeconds,
    originalRunningSeconds:b.runningSeconds,measuredRunningSeconds:m.runningSeconds,sampleGoodCertified:false};
  return {eventId:owner.id,requestId:owner.id===cert.id?m.requestId:siloParse(owner.source_text)?.requestId,startAt:FBHE1A_MEASURED_START,
    observedAt:asset.cycle_runtime_anchor_at,dataParcTag:signal,runningSeconds:seconds,runtimeHours:seconds/3600,coverageComplete:true,
    requiredStartAt:FBHE1A_DAY_START,missingLeadingSeconds:0,state,cycleRuntimeRevision:asset.cycle_runtime_revision,composite:true,appendReady:true,fbhe1aRuntime:metadata};
}
function fbhe1aRuntimeBoundaryBase(asset,rows,signal){
  const stored=number(asset.cycle_runtime_hours),anchor=instant(asset.cycle_runtime_anchor_at);
  if(!Number.isFinite(stored)||!Number.isFinite(anchor))return null;
  const relevant=(rows||[]).filter(row=>row.tag_number===FBHE1A_TAG&&['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type));
  const owner=relevant.filter(row=>instant(row.event_date)===anchor).sort(eventOrder)[0],manual=owner?.source_type==='manual'?manualRuntimeOverlayState(owner):'',automatic=automaticBoundaryState(owner);
  if(!owner||(!manual&&!automatic)||(manual||automatic)!==asset.cycle_runtime_state||!near(number(owner.runtime_hours),stored))return null;
  const receipt=relevant.filter(row=>row.source_type===FBHE1A_SOURCE||row.source_type==='dataparc_runtime'&&siloParse(row.source_text)?.expectedCycleStartRevision===asset.cycle_start_revision)
    .sort((a,b)=>instant(b.event_date)-instant(a.event_date)||eventOrder(a,b))[0],source=siloParse(receipt?.source_text),observed=instant(receipt?.event_date);
  const state=receipt?.source_type===FBHE1A_SOURCE?source?.measurement?.endState:source?.endState;
  if(!receipt||!Number.isFinite(observed)||observed>=anchor||!near(number(receipt.runtime_hours),stored))return null;
  const overlays=relevant.filter(row=>instant(row.event_date)>observed&&instant(row.event_date)<=anchor);
  if(!overlays.length||!overlays.some(row=>row.id===owner.id)||overlays.some(row=>!near(number(row.runtime_hours),stored))||
    !overlays.every(row=>row.source_type==='manual'&&Boolean(manualRuntimeOverlayState(row)))&&!overlays.every(row=>Boolean(automaticBoundaryState(row)))||
    relevant.some(row=>!Number.isFinite(instant(row.event_date))||instant(row.event_date)>anchor))return null;
  const measuredRows=rows.filter(row=>row.tag_number!==FBHE1A_TAG||!['runtime_correction','startup','operation_start','operation_stop'].includes(row.event_type)||instant(row.event_date)<=observed);
  const base=fbhe1aRuntimeAppendBase({...asset,cycle_runtime_anchor_at:receipt.event_date,cycle_runtime_state:state,cycle_runtime_hours:receipt.runtime_hours},measuredRows,signal);
  return base?{...base,cycleRuntimeRevision:asset.cycle_runtime_revision,preservedStateBoundary:true,
    fbhe1aRuntime:{...base.fbhe1aRuntime,currentRuntimeRevision:asset.cycle_runtime_revision,currentAnchorAt:asset.cycle_runtime_anchor_at,
      currentState:asset.cycle_runtime_state,preservedStateBoundary:true}}:null;
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
      source.assetTag===SILO_BASIS_TAG&&x.baseEventId.startsWith('dataparc_silo_basis:') ||
      source.assetTag===LIMESTONE2A_TAG&&source.dataParcTag===LIMESTONE2A_SIGNAL&&
        String(source.expectedCycleStartRevision||'').startsWith(LIMESTONE2A_CYCLE_PREFIX)&&x.baseEventId.startsWith(LIMESTONE2A_CERT_PREFIX) ||
      source.assetTag===LIMESTONE1B_TAG&&source.dataParcTag===LIMESTONE1B_SIGNAL&&
        String(source.expectedCycleStartRevision||'').startsWith(LIMESTONE1B_CYCLE_PREFIX)&&x.baseEventId.startsWith(LIMESTONE1B_CERT_PREFIX) ||
      source.assetTag===FBHE1A_TAG&&source.dataParcTag===FBHE1A_SIGNAL&&
        String(source.expectedCycleStartRevision||'').startsWith(FBHE1A_CYCLE_PREFIX)&&x.baseEventId.startsWith(FBHE1A_CERT_PREFIX)) ||
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
  if(asset?.tag_number===LIMESTONE2A_TAG&&String(asset.cycle_start_revision||'').startsWith(LIMESTONE2A_CYCLE_PREFIX))
    return limestone2aCompositeAppendBase(asset,rows,dataParcTag)||limestone2aCompositeBoundaryBase(asset,rows,dataParcTag);
  if(asset?.tag_number===LIMESTONE1B_TAG&&String(asset.cycle_start_revision||'').startsWith(LIMESTONE1B_CYCLE_PREFIX))
    return limestone1bFirstRunAppendBase(asset,rows,dataParcTag)||limestone1bFirstRunBoundaryBase(asset,rows,dataParcTag);
  if(asset?.tag_number===FBHE1A_TAG&&String(asset.cycle_start_revision||'').startsWith(FBHE1A_CYCLE_PREFIX))
    return fbhe1aRuntimeAppendBase(asset,rows,dataParcTag)||fbhe1aRuntimeBoundaryBase(asset,rows,dataParcTag);
  return strictVerifiedAppendBase(asset, rows, dataParcTag) ||
    verifiedManualBoundaryAppendBase(asset, rows, dataParcTag) ||
    verifiedAutomaticBoundaryAppendBase(asset, rows, dataParcTag);
}

async function loadLimestone2aAppendDependencies(database,asset,rows,base){
  try{
    const {loadLimestone2aApprovedCompletion,validateLimestone2aPrefix,validateLimestone2aPrefixCycle,validateLimestone2aTailRequest}=await import('./blower-limestone2a-first-run-v1.js');
    const sameRow=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);
    const cert=rows.find(row=>row.id===base.limestone2aFirstRun.certificateEventId),source=siloParse(cert?.source_text);
    if(!source)return null;
    const current=await loadLimestone2aApprovedCompletion(database);
    if(current.sourceProofHash!==source.sourceProofHash)return null;
    const audit=await database.prepare("SELECT * FROM blower_history_asset_history WHERE id=? AND action_type='limestone2a_first_run_recovery' AND tag_number=?")
      .bind(source.auditId,LIMESTONE2A_TAG).first();
    const before=siloParse(audit?.before_json),after=siloParse(audit?.after_json),originalOwner=before?.events?.find(row=>row.id===LIMESTONE2A_OWNER);
    const actualOwner=rows.find(row=>row.id===LIMESTONE2A_OWNER),p=source.prefix;
    if(!before||!after||!sameRow(after.event,cert)||!sameRow(before.asset,source.tailAsset)||
      !sameRow(originalOwner,after.owner)||!sameRow(after.owner,actualOwner)||
      before.sourceProofHash!==source.sourceProofHash||after.sourceProofHash!==source.sourceProofHash||
      before.prefixRawResultSha256!==p.rawResultSha256||after.prefixRawResultSha256!==p.rawResultSha256||
      !sameRow(before.prefixRequest,after.prefixRequest)||!sameRow(before.prefixIntent,after.prefixIntent)||
      !sameRow(after.attestation,source.attestation)||audit.changed_by_id!==source.attestation.actorId||
      audit.changed_by_name!==source.attestation.actorName||audit.changed_at!==source.attestation.confirmedAt||
      cert.created_by_id!==audit.changed_by_id||cert.created_by_name!==audit.changed_by_name||cert.created_at!==audit.changed_at||
      !Array.isArray(before.events)||!Array.isArray(before.requests)||!before.requests.length||before.requests.length>2000)return null;
    const snapshotHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(audit.before_json)))].map(value=>value.toString(16).padStart(2,'0')).join('');
    if(snapshotHash!==source.proofHash)return null;
    const initial=verifiedAppendBase(after.asset,[...before.events,after.event],LIMESTONE2A_SIGNAL);
    if(!initial||initial.eventId!==cert.id||initial.runningSeconds!==source.totalRunningSeconds||
      !near(number(after.asset.runtime_hours),source.totalRunningSeconds/3600))return null;
    const prefixRequest=await database.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(p.requestId).first();
    const prefixIntent=await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(p.requestId).first();
    const prefix=validateLimestone2aPrefix(prefixRequest,prefixIntent);
    const rawSha=prefixRequest&&[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prefixRequest.result_json||'')))].map(value=>value.toString(16).padStart(2,'0')).join('');
    if(!sameRow(prefixRequest,after.prefixRequest)||!sameRow(prefixIntent,after.prefixIntent)||rawSha!==p.rawResultSha256||
      prefix.firstRunAt!==p.firstRunAt||prefix.runningSeconds!==p.runningSeconds||prefix.startState!==p.startState||prefix.endState!==p.endState||
      prefixRequest.requested_by_id!==source.attestation.actorId||
      String(prefixIntent.expected_cycle_start_revision||'').replace(/^signal-only-v1:/,'')!==source.tailAsset.cycle_start_revision)return null;
    const oldChain=limestone2aRawTailChain(source.tailAsset,before.events,source.tail.eventId);
    const requestRows=before.requests.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='intent_json')));
    const intentRows=before.requests.map(row=>siloParse(row.intent_json));
    if(!oldChain||oldChain.chain.length!==requestRows.length||new Set(requestRows.map(row=>row.id)).size!==requestRows.length||
      intentRows.some((row,index)=>!row||row.request_id!==requestRows[index].id))return null;
    validateLimestone2aPrefixCycle(prefixIntent,source.tailAsset,oldChain);
    if(oldChain.chain.some(node=>!sameRow(node.row,rows.find(row=>row.id===node.row.id))))return null;
    for(const node of oldChain.chain){
      const index=requestRows.findIndex(row=>row.id===node.source.requestId);
      validateLimestone2aTailRequest(requestRows[index],intentRows[index],node.source);
    }
    const descendants=[],byId=new Map(rows.map(row=>[row.id,row]));
    let cursor=byId.get(base.eventId);
    while(cursor&&cursor.id!==cert.id&&descendants.length<2000){
      const raw=siloParse(cursor.source_text);if(!raw?.incremental)return null;
      descendants.push({row:cursor,source:raw});cursor=byId.get(raw.incremental.baseEventId);
    }
    if(cursor?.id!==cert.id)return null;
    let descendantRequests=[],descendantIntents=[],descendantAppends=[];
    if(descendants.length){
      const ids=JSON.stringify(descendants.map(node=>node.source.requestId));
      descendantRequests=(await database.prepare('SELECT * FROM ois_data_requests WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(ids).all()).results||[];
      descendantIntents=(await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id IN (SELECT value FROM json_each(?)) ORDER BY request_id').bind(ids).all()).results||[];
      descendantAppends=(await database.prepare('SELECT * FROM blower_runtime_append_v1 WHERE request_id IN (SELECT value FROM json_each(?)) ORDER BY request_id').bind(ids).all()).results||[];
      if([descendantRequests,descendantIntents,descendantAppends].some(list=>list.length!==descendants.length))return null;
      for(const node of descendants){
        const s=node.source,x=s.incremental,q=descendantRequests.find(row=>row.id===s.requestId),intent=descendantIntents.find(row=>row.request_id===s.requestId),append=descendantAppends.find(row=>row.request_id===s.requestId);
        const normalized=validateLimestone2aTailRequest(q,intent,s);
        if(!append||normalized.expectedCycleStartState!=='legacy'||normalized.expectedCycleStartedAt||
          normalized.expectedCycleStartRevision!=='signal-only-v1:'+asset.cycle_start_revision||
          normalized.expectedCycleRuntimeRevision!=='append-v1:'+append.base_revision||append.base_revision!==s.expectedCycleRuntimeRevision||
          append.base_event_id!==x.baseEventId||Number(append.base_running_seconds)!==x.baseRunningSeconds||
          instant(append.base_observed_at)!==instant(s.startAt)||instant(append.coverage_start_at)!==instant(LIMESTONE2A_START))return null;
      }
    }
    const quote=value=>'"'+String(value).replace(/"/g,'""')+'"';
    const exactRows=(table,key,expected)=>{
      if(!Array.isArray(expected)||!expected.length||expected.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('Invalid immutable proof rows');
      const keys=Object.keys(expected[0]);
      if(!keys.length||keys.some(name=>!/^[a-z_][a-z0-9_]*$/.test(name))||expected.some(row=>Object.keys(row).length!==keys.length||keys.some(name=>!Object.hasOwn(row,name))))throw new Error('Invalid immutable proof fields');
      return {sql:`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN ${table} t ON t.${quote(key)} IS json_extract(j.value,'$.${key}') WHERE t.${quote(key)} IS NULL OR NOT(${keys.map(name=>`t.${quote(name)} IS json_extract(j.value,'$.${name}')`).join(' AND ')}))`,values:[JSON.stringify(expected)]};
    };
    const guards=[...current.guards,exactRows('ois_data_requests','id',requestRows),exactRows('blower_runtime_probe_intents_v5','request_id',intentRows),
      exactRows('ois_data_requests','id',[prefixRequest]),exactRows('blower_runtime_probe_intents_v5','request_id',[prefixIntent]),
      exactRows('blower_history_asset_history','id',[audit]),...(descendants.length?[
        exactRows('ois_data_requests','id',descendantRequests),exactRows('blower_runtime_probe_intents_v5','request_id',descendantIntents),
        exactRows('blower_runtime_append_v1','request_id',descendantAppends)]:[])];
    // Read every complete predicate without joining their expression trees.
    // The append transaction still executes each original guard separately.
    if(!await readGuardChecks(database,guards))return null;
    const fields=Object.keys(rows[0]||{}),encoded=JSON.stringify(rows),where=`tag_number=? AND event_type IN ('runtime_correction','startup','operation_start','operation_stop','replacement') AND (datetime(event_date)>=datetime(?) OR datetime(event_date) IS NULL OR NOT(event_date GLOB '*Z' OR event_date GLOB '*[+-][0-9][0-9]:[0-9][0-9]'))`;
    const evidenceGuard={sql:`(SELECT COUNT(*) FROM blower_history_events WHERE ${where})=json_array_length(?) AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN blower_history_events t ON t.id=json_extract(j.value,'$.id') WHERE t.id IS NULL OR NOT(${fields.map(key=>`t.${quote(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')}))`,values:[asset.tag_number,asset.last_replacement_at,encoded,encoded]};
    return {...base,limestone2aSourceGuards:[...guards,evidenceGuard]};
  }catch{return null;}
}

async function loadLimestone1bAppendDependencies(database,asset,rows,base){
  try{
    const {loadLimestone1bApprovedCompletion,validateLimestone1bWitness,validateLimestone1bBaselineRequest,validateLimestone1bMeasurement,validateLimestone1bCaseReceipt}=await import('./blower-limestone1b-first-run-v1.js');
    const sameRow=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);
    const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
    const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
    const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(value=>value.toString(16).padStart(2,'0')).join('');
    const cert=rows.find(row=>row.id===base.limestone1bFirstRun.certificateEventId),source=siloParse(cert?.source_text);
    if(!source)return null;
    const current=await loadLimestone1bApprovedCompletion(database);
    if(current.sourceProofHash!==source.sourceProofHash)return null;
    const audit=await database.prepare("SELECT * FROM blower_history_asset_history WHERE id=? AND action_type='limestone1b_first_run_recovery' AND tag_number=?")
      .bind(source.auditId,LIMESTONE1B_TAG).first();
    const before=siloParse(audit?.before_json),after=siloParse(audit?.after_json),m=source.measurement,r=source.r9;
    if(!before||!after||!sameRow(after.event,cert)||!sameRow(before.asset,source.baselineAsset)||
      !Array.isArray(before.events)||!Array.isArray(before.requests)||!before.requests.length||before.requests.length>2000||
      before.sourceProofHash!==source.sourceProofHash||after.sourceProofHash!==source.sourceProofHash||
      !sameRow(before.events.find(row=>row.id===LIMESTONE1B_OWNER),after.owner)||!sameRow(after.owner,rows.find(row=>row.id===LIMESTONE1B_OWNER))||
      before.roleOwnerId!==source.roleOwner.id||!sameRow(before.events.find(row=>row.id===source.roleOwner.id),after.roleOwner)||
      !sameRow(before.events.find(row=>row.id===source.roleOwner.id),rows.find(row=>row.id===source.roleOwner.id))||
      !sameRow(before.r9Request,after.r9Request)||!sameRow(before.r9Intent,after.r9Intent)||
      !sameRow(before.measurementRequest,after.measurementRequest)||!sameRow(before.measurementIntent,after.measurementIntent)||
      !sameRow(after.attestation,source.attestation)||audit.changed_by_id!==source.attestation.actorId||audit.changed_by_name!==source.attestation.actorName||
      audit.changed_at!==source.attestation.appliedAt||cert.created_by_id!==audit.changed_by_id||cert.created_by_name!==audit.changed_by_name||cert.created_at!==audit.changed_at||
      await digest(audit.before_json)!==source.proofHash)return null;
    const initial=verifiedAppendBase(after.asset,[...before.events,after.event],LIMESTONE1B_SIGNAL);
    if(!initial||initial.eventId!==cert.id||initial.runningSeconds!==m.runningSeconds||!near(number(after.asset.runtime_hours),m.runningSeconds/3600))return null;
    const witnessRequest=await database.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(r.requestId).first();
    const witnessIntent=await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(r.requestId).first();
    const measurementRequest=await database.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(m.requestId).first();
    const measurementIntent=await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(m.requestId).first();
    const witness=validateLimestone1bWitness(witnessRequest,witnessIntent);
    if(!sameRow(witnessRequest,after.r9Request)||!sameRow(witnessIntent,after.r9Intent)||
      !sameRow(measurementRequest,after.measurementRequest)||!sameRow(measurementIntent,after.measurementIntent)||
      await digest(witnessRequest.result_json)!==r.rawResultSha256||before.r9RawResultSha256!==r.rawResultSha256||
      await digest(measurementRequest.result_json)!==m.rawResultSha256||witness.firstRunAt!==r.firstRunAt||witness.oldStopAt!==r.oldStopAt||
      witness.excludedRunningSeconds!==r.excludedRunningSeconds||witness.excludedDurationMilliseconds!==r.excludedDurationMilliseconds||
      witness.postRunningSeconds!==r.postRunningSeconds)return null;
    const caseRow=await database.prepare('SELECT * FROM blower_limestone1b_first_run_intents_v1 WHERE request_id=?').bind(m.requestId).first();
    const caseBefore=caseRow&&Object.fromEntries(Object.entries(caseRow).filter(([key])=>key!=='applied_json'));
    if(!caseRow||caseRow.version!==1||!sameRow(before.caseReceipt,caseBefore)||!caseRow.applied_json||
      !equal(siloParse(caseRow.applied_json),after.outcome)||caseRow.actor_id!==source.attestation.actorId||
      caseRow.actor_id!==measurementRequest.requested_by_id||caseRow.actor_id!==witnessRequest.requested_by_id||caseRow.witness_request_id!==r.requestId||
      caseRow.created_at!==source.attestation.confirmedAt||await digest(caseRow.snapshot_json)!==caseRow.snapshot_sha256)return null;
    const receipt=await validateLimestone1bCaseReceipt(caseRow,measurementRequest,measurementIntent,{employeeNo:source.attestation.actorId,name:source.attestation.actorName,isSuperAdmin:true});
    const original=receipt.original,inputAttestation=receipt.attestation;
    if(!original||!sameRow(original.asset,before.asset)||!equal(original.events,before.events)||!equal(original.requests,before.requests)||
      !equal(original.baseline,before.baseline)||original.sourceProofHash!==source.sourceProofHash||
      !inputAttestation||Object.entries(inputAttestation).some(([key,value])=>source.attestation[key]!==value))return null;
    const measured=validateLimestone1bMeasurement(measurementRequest,measurementIntent,{...before,witness});
    if(!equal(measured.comparison,source.comparison)||measured.runningSeconds!==m.runningSeconds||measured.chunkCount!==m.chunkCount||measured.startState!==m.startState||measured.endState!==m.endState||
      instant(measured.startAt)!==instant(m.startAt)||instant(measured.endAt)!==instant(m.endAt))return null;
    const oldChain=limestone1bRawBaselineChain(source.baselineAsset,before.events,source.baseline.eventId);
    const requestRows=before.requests.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='intent_json'))),intentRows=before.requests.map(row=>siloParse(row.intent_json));
    if(!oldChain||oldChain.chunkCount!==source.baseline.chunkCount||oldChain.chain.length!==requestRows.length||
      new Set(requestRows.map(row=>row.id)).size!==requestRows.length||intentRows.some((row,index)=>!row||row.request_id!==requestRows[index].id)||
      oldChain.chain.some(node=>!sameRow(node.row,rows.find(row=>row.id===node.row.id))))return null;
    const witnessWire='r7-evidence-only-v1:r9_signal_v1:',witnessRevision=String(witnessIntent.expected_cycle_runtime_revision||'');
    if(String(witnessIntent.expected_cycle_start_revision||'').replace(/^signal-only-v1:/,'')!==source.baselineAsset.cycle_start_revision||
      !witnessRevision.startsWith(witnessWire)||![source.baselineAsset.cycle_runtime_revision,...oldChain.chain.map(node=>node.source.expectedCycleRuntimeRevision)].includes(witnessRevision.slice(witnessWire.length)))return null;
    for(const node of oldChain.chain){const index=requestRows.findIndex(row=>row.id===node.source.requestId);validateLimestone1bBaselineRequest(requestRows[index],intentRows[index],node.source);}
    const descendants=[],byId=new Map(rows.map(row=>[row.id,row]));let cursor=byId.get(base.eventId);
    while(cursor&&cursor.id!==cert.id&&descendants.length<2000){const raw=siloParse(cursor.source_text);if(!raw?.incremental)return null;descendants.push(raw);cursor=byId.get(raw.incremental.baseEventId);}
    if(cursor?.id!==cert.id)return null;
    let descendantRequests=[],descendantIntents=[],descendantAppends=[];
    if(descendants.length){
      const ids=JSON.stringify(descendants.map(raw=>raw.requestId));
      descendantRequests=(await database.prepare('SELECT * FROM ois_data_requests WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(ids).all()).results||[];
      descendantIntents=(await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id IN (SELECT value FROM json_each(?)) ORDER BY request_id').bind(ids).all()).results||[];
      descendantAppends=(await database.prepare('SELECT * FROM blower_runtime_append_v1 WHERE request_id IN (SELECT value FROM json_each(?)) ORDER BY request_id').bind(ids).all()).results||[];
      if([descendantRequests,descendantIntents,descendantAppends].some(list=>list.length!==descendants.length))return null;
      for(const raw of descendants){
        const q=descendantRequests.find(row=>row.id===raw.requestId),intent=descendantIntents.find(row=>row.request_id===raw.requestId),append=descendantAppends.find(row=>row.request_id===raw.requestId);
        const normalized=validateLimestone1bBaselineRequest(q,intent,raw),x=raw.incremental;
        if(!append||normalized.expectedCycleStartRevision!=='signal-only-v1:'+asset.cycle_start_revision||
          normalized.expectedCycleRuntimeRevision!=='append-v1:'+append.base_revision||append.base_revision!==raw.expectedCycleRuntimeRevision||
          append.base_event_id!==x.baseEventId||Number(append.base_running_seconds)!==x.baseRunningSeconds||
          instant(append.base_observed_at)!==instant(raw.startAt)||instant(append.coverage_start_at)!==instant(LIMESTONE1B_FIRST_RUN))return null;
      }
    }
    const quote=value=>'"'+String(value).replace(/"/g,'""')+'"';
    const exactRows=(table,key,expected)=>{
      if(!Array.isArray(expected)||!expected.length||expected.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('Invalid immutable proof rows');
      const keys=Object.keys(expected[0]);
      if(!keys.length||keys.some(name=>!/^[a-z_][a-z0-9_]*$/.test(name))||expected.some(row=>Object.keys(row).length!==keys.length||keys.some(name=>!Object.hasOwn(row,name))))throw new Error('Invalid immutable proof fields');
      return {sql:`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN ${table} t ON t.${quote(key)} IS json_extract(j.value,'$.${key}') WHERE t.${quote(key)} IS NULL OR NOT(${keys.map(name=>`t.${quote(name)} IS json_extract(j.value,'$.${name}')`).join(' AND ')}))`,values:[JSON.stringify(expected)]};
    };
    const guards=[...current.guards,exactRows('ois_data_requests','id',requestRows),exactRows('blower_runtime_probe_intents_v5','request_id',intentRows),
      exactRows('ois_data_requests','id',[witnessRequest]),exactRows('blower_runtime_probe_intents_v5','request_id',[witnessIntent]),
      exactRows('ois_data_requests','id',[measurementRequest]),exactRows('blower_runtime_probe_intents_v5','request_id',[measurementIntent]),
      exactRows('blower_limestone1b_first_run_intents_v1','request_id',[caseRow]),exactRows('blower_history_asset_history','id',[audit]),
      ...(descendants.length?[exactRows('ois_data_requests','id',descendantRequests),exactRows('blower_runtime_probe_intents_v5','request_id',descendantIntents),exactRows('blower_runtime_append_v1','request_id',descendantAppends)]:[])];
    if(!await readGuardChecks(database,guards))return null;
    const fields=Object.keys(rows[0]||{}),encoded=JSON.stringify(rows),where=`tag_number=? AND event_type IN ('runtime_correction','startup','operation_start','operation_stop','replacement','cycle_source_reconcile') AND (datetime(event_date)>=datetime(?) OR datetime(event_date) IS NULL OR NOT(event_date GLOB '*Z' OR event_date GLOB '*[+-][0-9][0-9]:[0-9][0-9]'))`;
    const evidenceGuard={sql:`(SELECT COUNT(*) FROM blower_history_events WHERE ${where})=json_array_length(?) AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN blower_history_events t ON t.id=json_extract(j.value,'$.id') WHERE t.id IS NULL OR NOT(${fields.map(key=>`t.${quote(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')}))`,values:[asset.tag_number,asset.last_replacement_at,encoded,encoded]};
    return {...base,limestone1bSourceGuards:[...guards,evidenceGuard]};
  }catch{return null;}
}

async function loadFbhe1aRuntimeAppendDependencies(database,asset,rows,base){
  try{
    const {loadFbhe1aRuntimeApprovedCompletion,validateFbhe1aRuntimeWitness,validateFbhe1aRuntimeBaselineRequest,validateFbhe1aRuntimeMeasurement,validateFbhe1aRuntimeCaseReceipt,validateFbhe1aRuntimeAppliedOutcome}=await import('./blower-fbhe1a-runtime-v1.js');
    const sameRow=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);
    const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
    const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
    const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(value=>value.toString(16).padStart(2,'0')).join('');
    const cert=rows.find(row=>row.id===base.fbhe1aRuntime.certificateEventId),source=siloParse(cert?.source_text);
    if(!source)return null;
    const current=await loadFbhe1aRuntimeApprovedCompletion(database);
    if(current.sourceProofHash!==source.sourceProofHash)return null;
    const audit=await database.prepare("SELECT * FROM blower_history_asset_history WHERE id=? AND action_type='fbhe1a_runtime_recovery' AND tag_number=?")
      .bind(source.auditId,FBHE1A_TAG).first();
    const before=siloParse(audit?.before_json),after=siloParse(audit?.after_json),m=source.measurement,r=source.r9;
    const afterKeys=['version','event','asset','owner','roleOwner','attestation','r9Request','r9Intent','measurementRequest','measurementIntent','sourceProofHash','outcome'];
    if(!after||after.version!==1||Object.keys(after).sort().join(',')!==afterKeys.sort().join(',')||
      !Number.isFinite(instant(source.attestation?.confirmedAt))||!Number.isFinite(instant(source.attestation?.appliedAt))||
      instant(source.attestation.appliedAt)<instant(source.attestation.confirmedAt)||instant(source.attestation.appliedAt)>Date.now()+300000||
      typeof source.attestation.actorName!=='string'||!source.attestation.actorName.trim()||typeof source.attestation.appliedByName!=='string'||!source.attestation.appliedByName.trim())return null;
    const afterRevision=after.asset?.cycle_runtime_revision;
    const expectedAfterAsset=before?.asset&&{...before.asset,cycle_start_revision:source.cycleStartRevision,cycle_runtime_revision:afterRevision,
      cycle_runtime_hours:m.runningSeconds/3600,runtime_hours:m.runningSeconds/3600,cycle_runtime_anchor_at:source.baseline.observedAt,
      cycle_runtime_state:m.endState,runtime_anchor_at:m.endState==='running'?source.baseline.observedAt:null,is_running:m.endState==='running'?1:0,
      last_modified_by_id:source.attestation.actorId,last_modified_by_name:source.attestation.appliedByName,updated_at:source.attestation.appliedAt};
    if(typeof afterRevision!=='string'||!afterRevision.trim()||!equal(after.asset,expectedAfterAsset))return null;
    if(!before||!after||!sameRow(after.event,cert)||!sameRow(before.asset,source.baselineAsset)||
      !Array.isArray(before.events)||!Array.isArray(before.requests)||!Array.isArray(before.appends)||!before.requests.length||before.requests.length>2000||
      before.sourceProofHash!==source.sourceProofHash||after.sourceProofHash!==source.sourceProofHash||
      !sameRow(before.events.find(row=>row.id===FBHE1A_OWNER),after.owner)||!sameRow(after.owner,rows.find(row=>row.id===FBHE1A_OWNER))||
      before.roleOwnerId!==source.roleOwner.id||!sameRow(before.events.find(row=>row.id===source.roleOwner.id),after.roleOwner)||
      !sameRow(before.events.find(row=>row.id===source.roleOwner.id),rows.find(row=>row.id===source.roleOwner.id))||
      !sameRow(before.r9Request,after.r9Request)||!sameRow(before.r9Intent,after.r9Intent)||
      !sameRow(before.measurementRequest,after.measurementRequest)||!sameRow(before.measurementIntent,after.measurementIntent)||
      !sameRow(after.attestation,source.attestation)||audit.changed_by_id!==source.attestation.actorId||audit.changed_by_name!==source.attestation.appliedByName||
      audit.changed_at!==source.attestation.appliedAt||cert.created_by_id!==audit.changed_by_id||cert.created_by_name!==audit.changed_by_name||cert.created_at!==audit.changed_at||
      await digest(audit.before_json)!==source.proofHash)return null;
    const initial=verifiedAppendBase(after.asset,[...before.events,after.event],FBHE1A_SIGNAL);
    if(!initial||initial.eventId!==cert.id||initial.runningSeconds!==m.runningSeconds||!near(number(after.asset.runtime_hours),m.runningSeconds/3600))return null;
    const witnessRequest=await database.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(r.requestId).first();
    const witnessIntent=await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(r.requestId).first();
    const measurementRequest=await database.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(m.requestId).first();
    const measurementIntent=await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(m.requestId).first();
    const witness=validateFbhe1aRuntimeWitness(witnessRequest,witnessIntent);
    if(!sameRow(witnessRequest,after.r9Request)||!sameRow(witnessIntent,after.r9Intent)||
      !sameRow(measurementRequest,after.measurementRequest)||!sameRow(measurementIntent,after.measurementIntent)||
      await digest(witnessRequest.result_json)!==r.rawResultSha256||before.r9RawResultSha256!==r.rawResultSha256||
      await digest(measurementRequest.result_json)!==m.rawResultSha256||witness.lastRunStoppedAt!==r.lastRunStoppedAt||
      witness.excludedRunningSeconds!==r.excludedRunningSeconds||witness.excludedDurationMilliseconds!==r.excludedDurationMilliseconds||
      instant(witness.zeroWindowEndAt)!==instant(r.zeroWindowEndAt))return null;
    const caseRow=await database.prepare('SELECT * FROM blower_fbhe1a_runtime_intents_v1 WHERE request_id=?').bind(m.requestId).first();
    const caseBefore=caseRow&&Object.fromEntries(Object.entries(caseRow).filter(([key])=>key!=='applied_json'));
    if(!caseRow||caseRow.version!==1||!sameRow(before.caseReceipt,caseBefore)||!caseRow.applied_json||
      !equal(siloParse(caseRow.applied_json),after.outcome)||caseRow.actor_id!==source.attestation.actorId||
      caseRow.actor_id!==measurementRequest.requested_by_id||caseRow.actor_id!==witnessRequest.requested_by_id||caseRow.witness_request_id!==r.requestId||
      caseRow.created_at!==source.attestation.confirmedAt||await digest(caseRow.snapshot_json)!==caseRow.snapshot_sha256)return null;
    const receipt=await validateFbhe1aRuntimeCaseReceipt(caseRow,measurementRequest,measurementIntent,{employeeNo:source.attestation.actorId,name:source.attestation.appliedByName,isSuperAdmin:true});
    const original=receipt.original,inputAttestation=receipt.attestation;
    if(!original||!sameRow(original.asset,before.asset)||!equal(original.events,before.events)||!equal(original.requests,before.requests)||
      !equal(original.baseline,before.baseline)||!equal(original.appends,before.appends)||original.sourceProofHash!==source.sourceProofHash||
      !inputAttestation||Object.entries(inputAttestation).some(([key,value])=>source.attestation[key]!==value))return null;
    if(!equal(before,{...original,measurementRequest,measurementIntent,caseReceipt:caseBefore}))return null;
    validateFbhe1aRuntimeAppliedOutcome(original,caseRow,measurementRequest,measurementIntent,source.attestation,source.proofHash,after.outcome);
    const measured=validateFbhe1aRuntimeMeasurement(measurementRequest,measurementIntent,{...before,witness});
    if(!equal(measured.comparison,source.comparison)||measured.runningSeconds!==m.runningSeconds||measured.chunkCount!==m.chunkCount||measured.startState!==m.startState||measured.endState!==m.endState||
      instant(measured.startAt)!==instant(m.startAt)||instant(measured.endAt)!==instant(m.endAt))return null;
    const oldChain=fbhe1aRawBaselineChain(source.baselineAsset,before.events,source.baseline.eventId);
    const requestRows=before.requests.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='intent_json'))),intentRows=before.requests.map(row=>siloParse(row.intent_json));
    if(!oldChain||oldChain.chunkCount!==source.baseline.chunkCount||oldChain.chain.length!==requestRows.length||
      new Set(requestRows.map(row=>row.id)).size!==requestRows.length||intentRows.some((row,index)=>!row||row.request_id!==requestRows[index].id)||
      oldChain.chain.some(node=>!sameRow(node.row,rows.find(row=>row.id===node.row.id))))return null;
    const witnessWire='r7-evidence-only-v1:r9_signal_v1:',witnessRevision=String(witnessIntent.expected_cycle_runtime_revision||'');
    if(String(witnessIntent.expected_cycle_start_revision||'')!==source.baselineAsset.cycle_start_revision||
      !witnessRevision.startsWith(witnessWire)||![source.baselineAsset.cycle_runtime_revision,...oldChain.chain.map(node=>node.source.expectedCycleRuntimeRevision)].includes(witnessRevision.slice(witnessWire.length)))return null;
    const oldAppendNodes=oldChain.chain.filter(node=>node.source.incremental),oldAppendIds=JSON.stringify(oldAppendNodes.map(node=>node.source.requestId));
    const oldAppends=oldAppendNodes.length?(await database.prepare('SELECT * FROM blower_runtime_append_v1 WHERE request_id IN (SELECT value FROM json_each(?)) ORDER BY request_id').bind(oldAppendIds).all()).results||[]:[];
    if(oldAppends.length!==oldAppendNodes.length||before.appends.length!==oldAppendNodes.length||
      new Set(before.appends.map(row=>row.request_id)).size!==before.appends.length||
      before.appends.some(saved=>!sameRow(saved,oldAppends.find(row=>row.request_id===saved.request_id))))return null;
    for(const node of oldChain.chain){
      const index=requestRows.findIndex(row=>row.id===node.source.requestId),normalized=validateFbhe1aRuntimeBaselineRequest(requestRows[index],intentRows[index],node.source),x=node.source.incremental;
      if(x){const append=oldAppends.find(row=>row.request_id===node.source.requestId);
        if(!append||normalized.expectedCycleStartRevision!==source.baselineAsset.cycle_start_revision||
          normalized.expectedCycleRuntimeRevision!=='append-v1:'+append.base_revision||append.base_revision!==node.source.expectedCycleRuntimeRevision||
          append.base_event_id!==x.baseEventId||Number(append.base_running_seconds)!==x.baseRunningSeconds||
          instant(append.base_observed_at)!==instant(node.source.startAt)||instant(append.coverage_start_at)!==instant(FBHE1A_BASE_START)||
          !Number.isFinite(instant(append.created_at))||instant(append.created_at)>Date.now()+300000)return null;
      }
    }
    const descendants=[],byId=new Map(rows.map(row=>[row.id,row]));let cursor=byId.get(base.eventId);
    while(cursor&&cursor.id!==cert.id&&descendants.length<2000){const raw=siloParse(cursor.source_text);if(!raw?.incremental)return null;descendants.push(raw);cursor=byId.get(raw.incremental.baseEventId);}
    if(cursor?.id!==cert.id)return null;
    let descendantRequests=[],descendantIntents=[],descendantAppends=[];
    if(descendants.length){
      const ids=JSON.stringify(descendants.map(raw=>raw.requestId));
      descendantRequests=(await database.prepare('SELECT * FROM ois_data_requests WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(ids).all()).results||[];
      descendantIntents=(await database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id IN (SELECT value FROM json_each(?)) ORDER BY request_id').bind(ids).all()).results||[];
      descendantAppends=(await database.prepare('SELECT * FROM blower_runtime_append_v1 WHERE request_id IN (SELECT value FROM json_each(?)) ORDER BY request_id').bind(ids).all()).results||[];
      if([descendantRequests,descendantIntents,descendantAppends].some(list=>list.length!==descendants.length))return null;
      for(const raw of descendants){
        const q=descendantRequests.find(row=>row.id===raw.requestId),intent=descendantIntents.find(row=>row.request_id===raw.requestId),append=descendantAppends.find(row=>row.request_id===raw.requestId);
        const normalized=validateFbhe1aRuntimeBaselineRequest(q,intent,raw),x=raw.incremental;
        if(!append||normalized.expectedCycleStartRevision!==asset.cycle_start_revision||
          normalized.expectedCycleRuntimeRevision!=='append-v1:'+append.base_revision||append.base_revision!==raw.expectedCycleRuntimeRevision||
          append.base_event_id!==x.baseEventId||Number(append.base_running_seconds)!==x.baseRunningSeconds||
          instant(append.base_observed_at)!==instant(raw.startAt)||instant(append.coverage_start_at)!==instant(FBHE1A_MEASURED_START))return null;
      }
    }
    const quote=value=>'"'+String(value).replace(/"/g,'""')+'"';
    const exactRows=(table,key,expected)=>{
      if(!Array.isArray(expected)||!expected.length||expected.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('Invalid immutable proof rows');
      const keys=Object.keys(expected[0]);
      if(!keys.length||keys.some(name=>!/^[a-z_][a-z0-9_]*$/.test(name))||expected.some(row=>Object.keys(row).length!==keys.length||keys.some(name=>!Object.hasOwn(row,name))))throw new Error('Invalid immutable proof fields');
      return {sql:`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN ${table} t ON t.${quote(key)} IS json_extract(j.value,'$.${key}') WHERE t.${quote(key)} IS NULL OR NOT(${keys.map(name=>`t.${quote(name)} IS json_extract(j.value,'$.${name}')`).join(' AND ')}))`,values:[JSON.stringify(expected)]};
    };
    const guards=[...current.guards,exactRows('ois_data_requests','id',requestRows),exactRows('blower_runtime_probe_intents_v5','request_id',intentRows),
      ...(oldAppends.length?[exactRows('blower_runtime_append_v1','request_id',oldAppends)]:[]),
      exactRows('ois_data_requests','id',[witnessRequest]),exactRows('blower_runtime_probe_intents_v5','request_id',[witnessIntent]),
      exactRows('ois_data_requests','id',[measurementRequest]),exactRows('blower_runtime_probe_intents_v5','request_id',[measurementIntent]),
      exactRows('blower_fbhe1a_runtime_intents_v1','request_id',[caseRow]),exactRows('blower_history_asset_history','id',[audit]),
      ...(descendants.length?[exactRows('ois_data_requests','id',descendantRequests),exactRows('blower_runtime_probe_intents_v5','request_id',descendantIntents),exactRows('blower_runtime_append_v1','request_id',descendantAppends)]:[])];
    if(!await readGuardChecks(database,guards))return null;
    const fields=Object.keys(rows[0]||{}),encoded=JSON.stringify(rows),where=`tag_number=? AND event_type IN ('runtime_correction','startup','operation_start','operation_stop','replacement','cycle_source_reconcile') AND (datetime(event_date)>=datetime(?) OR datetime(event_date) IS NULL OR NOT(event_date GLOB '*Z' OR event_date GLOB '*[+-][0-9][0-9]:[0-9][0-9]'))`;
    const evidenceGuard={sql:`(SELECT COUNT(*) FROM blower_history_events WHERE ${where})=json_array_length(?) AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN blower_history_events t ON t.id=json_extract(j.value,'$.id') WHERE t.id IS NULL OR NOT(${fields.map(key=>`t.${quote(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')}))`,values:[asset.tag_number,asset.last_replacement_at,encoded,encoded]};
    return {...base,fbhe1aSourceGuards:[...guards,evidenceGuard]};
  }catch{return null;}
}

export async function loadAppendBase(database, asset, dataParcTag) {
  // Read the current Cycle beyond its runtime anchor: an operation boundary can sit
  // after the last DataPARC success while preserving its RUN total. Older Cycles
  // are unrelated and can make this hot-path history scan grow without bound.
  // Keep malformed dates visible so automatic recovery cannot ignore a boundary.
  const types="'runtime_correction','startup','operation_start','operation_stop'"+
    ((asset?.tag_number===SILO_BASIS_TAG&&String(asset.cycle_start_revision||'').startsWith(SILO_BASIS_CYCLE_PREFIX)||
      asset?.tag_number===LIMESTONE2A_TAG&&String(asset.cycle_start_revision||'').startsWith(LIMESTONE2A_CYCLE_PREFIX)||
      asset?.tag_number===LIMESTONE1B_TAG&&String(asset.cycle_start_revision||'').startsWith(LIMESTONE1B_CYCLE_PREFIX)||
      asset?.tag_number===FBHE1A_TAG&&String(asset.cycle_start_revision||'').startsWith(FBHE1A_CYCLE_PREFIX))?",'replacement'":'')+
    ((asset?.tag_number===LIMESTONE1B_TAG&&String(asset.cycle_start_revision||'').startsWith(LIMESTONE1B_CYCLE_PREFIX)||
      asset?.tag_number===FBHE1A_TAG&&String(asset.cycle_start_revision||'').startsWith(FBHE1A_CYCLE_PREFIX))?",'cycle_source_reconcile'":'');
  const result = await database.prepare(`SELECT * FROM blower_history_events
    WHERE tag_number = ? AND event_type IN (${types})
      AND (datetime(event_date) >= datetime(?) OR datetime(event_date) IS NULL
        OR NOT (event_date GLOB '*Z' OR event_date GLOB '*[+-][0-9][0-9]:[0-9][0-9]'))
    ORDER BY event_date DESC, updated_at DESC, created_at DESC, id DESC`)
    .bind(asset.tag_number, asset.last_replacement_at).all();
  const rows=result.results||[],base=verifiedAppendBase(asset,rows,dataParcTag);
  if(base?.fbhe1aRuntime)return loadFbhe1aRuntimeAppendDependencies(database,asset,rows,base);
  if(base?.limestone1bFirstRun)return loadLimestone1bAppendDependencies(database,asset,rows,base);
  if(base?.limestone2aFirstRun)return loadLimestone2aAppendDependencies(database,asset,rows,base);
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
