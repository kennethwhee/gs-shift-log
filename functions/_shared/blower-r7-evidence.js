import { r8TimelineEntry } from './blower-r8-timeline.js';
import { r9Window } from './blower-r9-signal-v1.js';
/* R7 exact read-only measurement windows. No V-belt completion clock is inferred.
 * The first window may support zero-duration equivalence ONLY after independent
 * accepted-work-order review; the second window measures pre-registered RUN
 * but NEVER attributes all of it to a replacement of unknown completion time.
 */
export const R7_EVIDENCE_PREFIX = 'r7-evidence-only-v1:';
export const R7_WINDOWS = Object.freeze({
  fbhe1b_zero: Object.freeze({tag:'104HHL60AP621',type:'fbhe',unit:'1',
    signal:'GSPOGE.ABB_DCS.104HHL60AP621XB04',startAt:'2026-10-08T13:04:00+09:00',endAt:null,
    replacementDate:'2026-10-08'}),
  limestone2a_leading: Object.freeze({tag:'203HRJ01AN601',type:'limestone',unit:'2',
    signal:'GSPOGE.ABB_DCS.203HRJ01AN601XB04',startAt:'2026-09-19T00:00:00+09:00',
    endAt:'2026-09-20T00:00:00+09:00',replacementDate:'2026-09-20'})
});
const text = value => String(value ?? '').trim();
const clock = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;
// Date-only replacement records denote a known work DATE, not a completion minute.
// Compare the literal date without inventing 00:00; normalize exact RFC3339
// instants to Korea-local day only when the original row has an explicit zone.
const kstDay = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) :
  Number.isFinite(clock(value)) ? new Date(clock(value)+9*3600000).toISOString().slice(0,10) : '';
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value>=0;
const fail = (code,message) => Object.assign(new Error(message),{code,status:409});
function currentAssetValue(asset,field) {return asset?.[field] ?? null;}
export function r7EvidencePlan(mode,asset,user,now=new Date()) {
  const entry = R7_WINDOWS[mode] || r8TimelineEntry(mode) || r9Window(mode,asset,now);
  if(!entry)throw fail('R7_UNSUPPORTED_MODE','R7 검증 종류가 올바르지 않습니다.');
  if(user?.role!=='super_admin' && !(user?.role==null && user?.isSuperAdmin===true))throw Object.assign(new Error('R7 과거 RUN 검증은 최고관리자만 실행할 수 있습니다.'),{code:'R7_FORBIDDEN',status:403});
  // Exact catalog identity and saved revisions are mandatory for both R7 modes.
  // Historical Limestone reading is not a replacement-date assertion: an
  // independently registered cycle date may differ from the Sep 19 evidence
  // window. We pin the CURRENT date/revisions in validateR7RequestBody and
  // never mutate runtime or belt history from this read-only probe.
  if(!asset || asset.tag_number!==entry.tag || asset.blower_type!==entry.type || String(asset.unit_no)!==entry.unit)
    throw fail('R7_ASSET_STATE_CHANGED','등록된 설비 TAG·호기·종류가 R7 대상과 다릅니다. 기존값을 유지합니다.');
  if(Number(asset.enabled)!==1)
    throw fail('R7_ASSET_DISABLED','R7 대상 설비가 활성 상태가 아닙니다. 기존값을 유지합니다.');
  if(!text(asset.last_replacement_at))
    throw fail('R7_REPLACEMENT_BASIS_MISSING','등록된 교체·조회 기준이 없어 과거 조회를 진행할 수 없습니다.');
  if((mode==='fbhe1b_zero' || entry.r8Root?.startsWith('fbhe_')) && kstDay(asset.last_replacement_at)!==entry.replacementDate)
    throw fail('R7_FHBE_DATE_CHANGED','FBHE 1B의 교체일이 예상과 다릅니다. 기존값을 유지합니다.');
  if(!text(asset.cycle_runtime_revision) || !text(asset.cycle_start_revision))
    throw fail('R7_CYCLE_REVISION_MISSING','R7 대상의 저장 운전·기동 버전이 확인되지 않습니다. 기존값을 유지합니다.');
  if(!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.getTime() <= clock(entry.endAt||entry.startAt))
    throw fail('R7_INVALID_NOW','조회 종료시간을 확인할 수 없습니다.');
  if(mode==='fbhe1b_zero') {
    const saved=Number(asset.cycle_runtime_hours),run=Number(asset.runtime_hours);
    if(!Number.isFinite(saved)||saved!==0||!Number.isFinite(run)||run!==0 || asset.cycle_runtime_state!=='stopped')
      throw fail('R7_FBESTOP_NOT_ZERO','FBHE 1B의 기존 저장 운전시간 또는 정지 상태가 변경됐습니다.');
  }
  return {...entry,mode,readOnly:true,expiresAt:now.toISOString()};
}
export function validateR7RequestBody(body,plan,asset) {
  if(!body || body.r7EvidenceMode!==plan.mode || body.unifiedRefresh!==true ||
    body.incrementalRefresh!==false || body.requireIncrementalAppend!==false ||
    body.assetTag!==plan.tag || body.dataParcTag!==plan.signal || body.confirmRunSignal!==true ||
    ['rolePriorityRecovery','confirmedGapRecovery','requireFirstRunStart','completionWindowRecovery','registeredRangeRecovery',
      'appendBoundaryRecovery','limestoneTrackingOnly','replacementAutoFresh','replacementAutoRange','partialTracking'].some(key=>body[key]===true) ||
    body.startAt!==plan.startAt ||
    ['expectedLastReplacementAt','expectedCycleStartState','expectedCycleStartedAt','expectedCycleStartRevision','expectedCycleRuntimeRevision']
      .some((key,i)=>body[key]!== (i===1 ? (text(currentAssetValue(asset,'cycle_start_state'))||'legacy') : text(currentAssetValue(asset,
        ['last_replacement_at','cycle_start_state','cycle_started_at','cycle_start_revision','cycle_runtime_revision'][i])))))
    throw fail('R7_REQUEST_CONFLICT','R7 검증 요청이 현재 저장된 설비 기준과 일치하지 않습니다.');
  return true;
}
export function evaluateR7MeasuredResult(kind,item) {
  const plan=R7_WINDOWS[kind] || r8TimelineEntry(kind),probe=item?.probe,raw=item?.result;
  const mismatch=message=>({ok:false,kind,code:'R7_PROOF_INCOMPLETE',message});
  if(!plan || item?.status!=='complete'||item?.requestType!=='blower_runtime_probe'||
    typeof item.id!=='string'||!item.id||!probe||!raw || probe.assetTag!==plan.tag||probe.dataParcTag!==plan.signal||
    raw.requestId!==item.id||probe.requestId!==item.id||raw.schemaVersion!==1||raw.ok!==true||raw.readOnly!==true||
    raw.requestType!=='blower_runtime_probe'||raw.assetTag!==plan.tag||raw.dataParcTag!==plan.signal||
    clock(probe.startAt)!==clock(plan.startAt)||clock(raw.startAt)!==clock(probe.startAt)||
    clock(raw.endAt)!==clock(probe.endAt)||clock(raw.observedAt)!==clock(probe.endAt)||
    (plan.endAt&&clock(raw.endAt)!==clock(plan.endAt))||
    !text(probe.expectedCycleRuntimeRevision).startsWith(R7_EVIDENCE_PREFIX)||
    probe.expectedCycleRuntimeRevision!==raw.expectedCycleRuntimeRevision)
    return mismatch('조회 요청·신호·고정 기간·읽기 전용 결과가 일치하지 않습니다.');
  if(!Array.isArray(raw.chunks)||raw.chunks.length!==raw.chunkCount||raw.chunkCount!==probe.chunkCount||
    raw.chunkCount!==raw.completedChunkCount||raw.chunks.length===0||
    !['running','stopped'].includes(raw.startState)||!['running','stopped'].includes(raw.endState))
    return mismatch('분할 조회 일부가 누락되었거나 시작·종료 상태를 알 수 없습니다.');
  let seconds=0,prevEnd=clock(raw.startAt),prevState=raw.startState;
  for(let i=0;i<raw.chunks.length;i++){
    const c=raw.chunks[i],s=clock(c?.startAt),e=clock(c?.endAt);
    if(c?.index!==i+1||s!==prevEnd||!Number.isFinite(e)||e<=s||
      !['running','stopped'].includes(c?.startState)||!['running','stopped'].includes(c?.endState)||
      c.startState!==prevState||!Number.isSafeInteger(c.runningSeconds)||c.runningSeconds<0||
      c.runningSeconds>(e-s)/1000+2||!validNumber(c.totalRunningHours)||
      Math.abs(c.totalRunningHours*3600-c.runningSeconds)>2)
      return mismatch('조회 구간의 RUN 상태·시간 합계가 연속되지 않습니다.');
    prevEnd=e;prevState=c.endState;seconds+=c.runningSeconds;
  }
  if(prevEnd!==clock(raw.endAt)||prevState!==raw.endState||!Number.isSafeInteger(raw.runningSeconds)||
    raw.runningSeconds!==seconds||!validNumber(raw.totalRunningHours)||
    Math.abs(raw.totalRunningHours*3600-seconds)>2)
    return mismatch('전체 운전시간과 분할 구간 합계가 일치하지 않습니다.');
  const zero=seconds===0 && raw.startState==='stopped' && raw.endState==='stopped';
  return {ok:true,kind,tag:plan.tag,requestId:item.id,startAt:raw.startAt,endAt:raw.endAt,
    runningSeconds:seconds,runningHours:seconds/3600,zero,
    startState:raw.startState,endState:raw.endState,
    status:kind==='fbhe1b_zero' ? zero?'zero_candidate':'run_observed' : 'leading_window_measured',
    message:kind==='fbhe1b_zero' ? zero
      ? '0초 RUN 측정 후보 · 작업 완료 근거 및 측정 품질을 검토한 후에만 확정 가능합니다.'
      : '교체 후 추정 구간에 RUN이 존재합니다. 교체 완료시각 확인이 필요합니다.'
      : seconds===0
        ? '9월 19일 전체 RUN 0초 · 업무일지의 기동 기록과 모순되는지 검토해야 합니다.'
        : '9월 19일 전체 RUN 측정 완료 · 완료시각 이전의 운전과 이후 운전을 구분해야 합니다.'};
}
