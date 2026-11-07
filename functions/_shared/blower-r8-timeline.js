/**
 * R8 bounded, read-only binary RUN time-window probes.
 * A time bucket is a measured aggregate, NOT a DataPARC transition event.
 * No V-belt completion timestamp, saved runtime, or status is changed here.
 */
export const R8_MODE_PREFIX = 'r8_timeline_v1:';
export const R8_ROOTS = Object.freeze({
  fbhe_workday:Object.freeze({
    tag:'104HHL60AP621',type:'fbhe',unit:'1',
    signal:'GSPOGE.ABB_DCS.104HHL60AP621XB04',replacementDate:'2026-10-08',
    startAt:'2026-10-08T13:04:00+09:00',endAt:'2026-10-09T00:00:00+09:00',
    label:'FBHE 1호기 B · 10월 8일 교체 작업일',r8Historical:false
  }),
  fbhe_after:Object.freeze({
    tag:'104HHL60AP621',type:'fbhe',unit:'1',
    signal:'GSPOGE.ABB_DCS.104HHL60AP621XB04',replacementDate:'2026-10-08',
    startAt:'2026-10-09T00:00:00+09:00',endAt:'2026-11-07T14:00:00+09:00',
    label:'FBHE 1호기 B · 작업일 이후 기준 구간',r8Historical:false
  }),
  limestone_day:Object.freeze({
    tag:'203HRJ01AN601',type:'limestone',unit:'2',
    signal:'GSPOGE.ABB_DCS.203HRJ01AN601XB04',replacementDate:'2026-09-20',
    startAt:'2026-09-19T00:00:00+09:00',endAt:'2026-09-20T00:00:00+09:00',
    label:'Limestone 2호기 A · 9월 19일',r8Historical:true
  })
});
const KST=9*3600000, MINUTE=60000;
const pad=n=>String(n).padStart(2,'0');
const ts=iso=>typeof iso==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(iso)?Date.parse(iso):NaN;
export function r8KstAt(t){
  if(!Number.isFinite(t))throw new Error('R8_INVALID_TIME');
  const d=new Date(t+KST);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`;
}
export function r8TimelineEntry(mode){
  if(typeof mode!=='string'||mode.length>90||!mode.startsWith(R8_MODE_PREFIX))return null;
  const m=/^r8_timeline_v1:(fbhe_workday|fbhe_after|limestone_day):([01]{0,16})$/.exec(mode);
  if(!m)return null;
  const root=R8_ROOTS[m[1]];
  let start=ts(root.startAt),end=ts(root.endAt);
  if(!Number.isFinite(start)||!Number.isFinite(end))return null;
  for(const bit of m[2]){
    if(end-start<2*MINUTE)return null;
    const half=Math.floor(((start+end)/2)/MINUTE)*MINUTE;
    if(half<=start||half>=end)return null;
    if(bit==='0')end=half;else start=half;
  }
  if(start>=end)return null;
  return Object.freeze({...root,mode,r8Root:m[1],r8Path:m[2],r8Historical:root.r8Historical,
    startAt:r8KstAt(start),endAt:r8KstAt(end),readOnly:true});
}
export function r8ClassifySlice(proof){
  if(!proof||!Number.isSafeInteger(proof.runningSeconds)||proof.runningSeconds<0||
      !['stopped','running'].includes(proof.startState)||!['stopped','running'].includes(proof.endState))
    return {kind:'unknown',detail:'조회 품질·상태 미확인'};
  const begin=ts(proof.startAt),end=ts(proof.endAt);
  if(!Number.isFinite(begin)||!Number.isFinite(end)||end<=begin)return {kind:'unknown',detail:'기간 미확인'};
  const duration=(end-begin)/1000;
  if(proof.runningSeconds>duration+2)return {kind:'unknown',detail:'기간 대비 RUN 합계 초과'};
  if(proof.runningSeconds===0&&proof.startState==='stopped'&&proof.endState==='stopped')
    return {kind:'stopped',detail:'해당 시간 구간 RUN 0초(기존 샘플 품질 한계 유지)'};
  if(Math.abs(proof.runningSeconds-duration)<=2&&proof.startState==='running'&&proof.endState==='running')
    return {kind:'running',detail:'구간 대부분 RUN(정확한 절체시각 아님)'};
  return {kind:'mixed',detail:'RUN·정지 혼재 또는 경계 시각 미확정 · 추가 분할 조회 권장'};
}
export function r8CompareChildren(parent,left,right){
  if(!parent||!left||!right)return {ok:false,reason:'두 하위 조회가 모두 필요합니다.'};
  if(ts(parent.startAt)!==ts(left.startAt)||ts(left.endAt)!==ts(right.startAt)||
      ts(right.endAt)!==ts(parent.endAt))return {ok:false,reason:'하위 구간이 원래 기간을 연속해서 덮지 않습니다.'};
  if(!['stopped','running'].includes(parent.startState)||!['stopped','running'].includes(parent.endState)||
      parent.startState!==left.startState||parent.endState!==right.endState||left.endState!==right.startState)
    return {ok:false,reason:'상위·하위 구간의 경계 RUN 상태가 일치하지 않습니다.'};
  const delta=left.runningSeconds+right.runningSeconds-parent.runningSeconds;
  if(!Number.isSafeInteger(delta)||Math.abs(delta)>2)return {ok:false,reason:`RUN 합계 차이 ${delta}초 · 교차검증 불일치`,delta};
  return {ok:true,delta,reason:'분할 시간 합계와 경계 RUN 상태 교차검증 통과'};
}
