/* R9 read-only daily DataPARC fnValTime RUN period evidence.
 * Period boundaries represent historian-returned RUN windows; do not present
 * window edges as actual start/stop transitions or infer belt completion.
 * No saved-hour, replacement-history or schema mutations.
 */
export const R9_MODE_PREFIX='r9_signal_v1:';
export const R9_SIGNAL_MAP=Object.freeze({
  "104HHL60AP611":Object.freeze({signal:"GSPOGE.ABB_DCS.104HHL60AP611XB04",type:"fbhe",unit:"1"}),
  "104HHL60AP621":Object.freeze({signal:"GSPOGE.ABB_DCS.104HHL60AP621XB04",type:"fbhe",unit:"1"}),
  "104HHL60AP631":Object.freeze({signal:"GSPOGE.ABB_DCS.104HHL60AP631XB04",type:"fbhe",unit:"1"}),
  "204HHL60AP611":Object.freeze({signal:"GSPOGE.ABB_DCS.204HHL60AP611XB04",type:"fbhe",unit:"2"}),
  "204HHL60AP621":Object.freeze({signal:"GSPOGE.ABB_DCS.204HHL60AP621XB04",type:"fbhe",unit:"2"}),
  "204HHL60AP631":Object.freeze({signal:"GSPOGE.ABB_DCS.204HHL60AP631XB04",type:"fbhe",unit:"2"}),
  "104HHL10AN611":Object.freeze({signal:"GSPOGE.ABB_DCS.104HHL10AN611XB04",type:"seal_pot",unit:"1"}),
  "104HHL10AN621":Object.freeze({signal:"GSPOGE.ABB_DCS.104HHL10AN621XB04",type:"seal_pot",unit:"1"}),
  "104HHL10AN631":Object.freeze({signal:"GSPOGE.ABB_DCS.104HHL10AN631XB04",type:"seal_pot",unit:"1"}),
  "204HHL10AN611":Object.freeze({signal:"GSPOGE.ABB_DCS.204HHL10AN611XB04",type:"seal_pot",unit:"2"}),
  "204HHL10AN621":Object.freeze({signal:"GSPOGE.ABB_DCS.204HHL10AN621XB04",type:"seal_pot",unit:"2"}),
  "204HHL10AN631":Object.freeze({signal:"GSPOGE.ABB_DCS.204HHL10AN631XB04",type:"seal_pot",unit:"2"}),
  "104SDF01AN001":Object.freeze({signal:"GSPOGE.ABB_DCS.104SDF01AN001XB04",type:"organic_fuel",unit:"1"}),
  "104SDF01AN002":Object.freeze({signal:"GSPOGE.ABB_DCS.104SDF01AN002XB04",type:"organic_fuel",unit:"1"}),
  "204SDF01AN001":Object.freeze({signal:"GSPOGE.ABB_DCS.204SDF01AN001XB04",type:"organic_fuel",unit:"2"}),
  "204SDF01AN002":Object.freeze({signal:"GSPOGE.ABB_DCS.204SDF01AN002XB04",type:"organic_fuel",unit:"2"}),
  "204LMDF01AN001":Object.freeze({signal:"GSPOGE.ABB_DCS.204LMDF01AN001XB04",type:"organic_fuel",unit:"2"}),
  "104ETG30AN601":Object.freeze({signal:"GSPOGE.ABB_DCS.104ETG30AN601XB04",type:"flyash_bag",unit:"1"}),
  "104ETG30AN602":Object.freeze({signal:"GSPOGE.ABB_DCS.104ETG30AN602XB04",type:"flyash_bag",unit:"1"}),
  "204ETG30AN601":Object.freeze({signal:"GSPOGE.ABB_DCS.204ETG30AN601XB04",type:"flyash_bag",unit:"2"}),
  "204ETG30AN602":Object.freeze({signal:"GSPOGE.ABB_DCS.204ETG30AN602XB04",type:"flyash_bag",unit:"2"}),
  "104ETH03AN601":Object.freeze({signal:"GSPOGE.ABB_DCS.104ETH03AN601XB04",type:"flyash_silo",unit:"shared"}),
  "104ETH03AN602":Object.freeze({signal:"GSPOGE.ABB_DCS.003ETH03AN602XB04",type:"flyash_silo",unit:"shared"}),
  "103HRJ01AN601":Object.freeze({signal:"GSPOGE.ABB_DCS.103HRJ01AN601XB04",type:"limestone",unit:"1"}),
  "103HRJ01AN602":Object.freeze({signal:"GSPOGE.ABB_DCS.103HRJ01AN602XB04",type:"limestone",unit:"1"}),
  "203HRJ01AN601":Object.freeze({signal:"GSPOGE.ABB_DCS.203HRJ01AN601XB04",type:"limestone",unit:"2"}),
  "203HRJ01AN602":Object.freeze({signal:"GSPOGE.ABB_DCS.203HRJ01AN602XB04",type:"limestone",unit:"2"})
});
const text=v=>String(v??'').trim();
const fail=(code,message)=>Object.assign(new Error(message),{code,status:409});
const dayValid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&
  new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const KST=9*3600000;
export function r9Window(mode,asset,now=new Date()){
  const m=typeof mode==='string'&&mode.length<72 ? /^r9_signal_v1:([0-9A-Z]{13,20}):(\d{8})$/.exec(mode) : null;
  if(!m)return null;
  const tag=m[1],identity=R9_SIGNAL_MAP[tag],day=m[2].slice(0,4)+'-'+m[2].slice(4,6)+'-'+m[2].slice(6);
  if(!identity||!dayValid(day)||!asset||text(asset.tag_number)!==tag||
      text(asset.blower_type)!==identity.type||text(asset.unit_no)!==identity.unit||
      Number(asset.enabled)!==1)return null;
  const start=Date.parse(day+'T00:00:00+09:00'),end=start+86400000,clock=now instanceof Date?now.getTime():NaN;
  if(!Number.isFinite(clock)||end>clock-300000||clock-start>366*86400000)return null;
  const stamp=t=>new Date(t+KST).toISOString().slice(0,19)+'+09:00';
  return Object.freeze({mode,tag,type:identity.type,unit:identity.unit,signal:identity.signal,
    startAt:stamp(start),endAt:stamp(end),readOnly:true,r9History:true,r8Historical:true,
    label:'R9 원본 RUN 구간 조사 · '+day});
}

// The static R9 signal catalog is an upper bound, not proof that the signal
// belongs to the current equipment. Demand the last genuine saved DataPARC
// runtime receipt (the same source used by the Blower screen) before queueing.
// Never infer signal names from a Blower asset tag.
export function r9VerifiedSavedSignal(rows,assetTag,expectedSignal){
  const chosen=R9_SIGNAL_MAP[assetTag];
  if(!chosen||expectedSignal!==chosen.signal||!Array.isArray(rows)||rows.length>50)
    return {ok:false,reason:'unsupported_signal'};
  for(const row of rows){
    if(row?.tag_number!==assetTag||row?.source_type!=='dataparc_runtime'||
       row?.event_type!=='runtime_correction'||row?.created_at!==row?.updated_at)continue;
    let event;
    try{event=JSON.parse(row.source_text)}catch{continue}
    if(event?.schemaVersion!==1||event?.requestType!=='blower_runtime_probe'||
       event?.assetTag!==assetTag||typeof event?.requestId!=='string'||
       !/^[0-9a-f-]{36}$/i.test(event.requestId)||
       row.source_log_id!==event.requestId||row.id!=='dataparc_runtime:'+event.requestId||
       typeof event.dataParcTag!=='string')continue;
    return event.dataParcTag===expectedSignal
      ? {ok:true,sourceRequestId:event.requestId}
      : {ok:false,reason:'saved_signal_mismatch'};
  }
  return {ok:false,reason:'saved_signal_unavailable'};
}

export function verifyR9Periods(result,requestId,assetTag,day){
  const target=R9_SIGNAL_MAP[assetTag];const error=message=>({ok:false,message});
  if(!target||!dayValid(day))return error('설비 또는 날짜가 올바르지 않습니다.');
  const start=Date.parse(day+'T00:00:00+09:00'),end=start+86400000;
  const t=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
  if(!result||result.schemaVersion!==1||result.ok!==true||result.readOnly!==true||
      result.requestId!==requestId||result.assetTag!==assetTag||result.dataParcTag!==target.signal||
      result.requestType!=='blower_runtime_probe'||
      !text(result.expectedCycleRuntimeRevision).startsWith('r7-evidence-only-v1:r9_signal_v1:')||
      t(result.startAt)!==start||t(result.endAt)!==end||t(result.observedAt)!==end||
      !Array.isArray(result.chunks)||result.chunks.length!==1||result.chunkCount!==1||
      result.completedChunkCount!==1)return error('R9 요청·설비·기간·결과 신원을 확인할 수 없습니다.');
  const chunk=result.chunks[0];
  if(!chunk||chunk.index!==1||t(chunk.startAt)!==start||t(chunk.endAt)!==end||
      !['running','stopped'].includes(chunk.startState)||!['running','stopped'].includes(chunk.endState)||
      chunk.startState!==result.startState||chunk.endState!==result.endState||
      !Number.isSafeInteger(chunk.runningSeconds)||chunk.runningSeconds<0||
      chunk.runningSeconds>86402||result.runningSeconds!==chunk.runningSeconds||
      !Array.isArray(chunk.runPeriods)||chunk.runPeriods.length>=200||
      chunk.eventSource!=='dataparc_fnValTime_intervals_v1')return error('Agent의 R9 운전구간 상세 검증이 누락되거나 다릅니다.');
  let previous=start,runMs=0;const periods=[];
  for(const p of chunk.runPeriods){
    const s=t(p?.startAt),e=t(p?.endAt);
    if(!Number.isFinite(s)||!Number.isFinite(e)||s<previous||s<start||e>end||e<=s||
       p?.startKind!==(s===start?'window_boundary':'start_signal')||
       p?.endKind!==(e===end?'window_boundary':'stop_signal'))return error('RUN 구간의 기동·정지 신호 또는 시간 순서가 잘못됐습니다.');
    periods.push({startAt:p.startAt,endAt:p.endAt,startKind:p.startKind,endKind:p.endKind,
      durationSeconds:(e-s)/1000});
    previous=e;runMs+=e-s;
  }
  if(Math.abs(runMs/1000-chunk.runningSeconds)>2||
      (chunk.startState==='running')!==(periods.length>0&&t(periods[0].startAt)===start)||
      (chunk.endState==='running')!==(periods.length>0&&t(periods.at(-1).endAt)===end))
    return error('RUN 상세구간 합계 또는 양끝 RUN 상태가 조회 결과와 일치하지 않습니다.');
  return {ok:true,periods,runSeconds:chunk.runningSeconds,startAt:result.startAt,
    endAt:result.endAt,startState:chunk.startState,endState:chunk.endState,
    note:'DataPARC fnValTime RUN 구간의 경계입니다. GOOD 품질 및 V-belt 교체 완료시각을 별도로 확정하지 않습니다.'};
}
