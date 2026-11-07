/* GS SHIFT LOG R9: 27-asset, one-day, read-only fnValTime RUN window explorer.
 * No save endpoints, no belt cycle reset, no automatic probes. Explicit click.
 */
;(function(root){
'use strict';
const KEY='gsShiftLog.currentUser',API='/api/ois-data-requests',PREFIX='r9_signal_v1:';
const SIGNALS=Object.freeze({"104HHL60AP611":"GSPOGE.ABB_DCS.104HHL60AP611XB04","104HHL60AP621":"GSPOGE.ABB_DCS.104HHL60AP621XB04","104HHL60AP631":"GSPOGE.ABB_DCS.104HHL60AP631XB04","204HHL60AP611":"GSPOGE.ABB_DCS.204HHL60AP611XB04","204HHL60AP621":"GSPOGE.ABB_DCS.204HHL60AP621XB04","204HHL60AP631":"GSPOGE.ABB_DCS.204HHL60AP631XB04","104HHL10AN611":"GSPOGE.ABB_DCS.104HHL10AN611XB04","104HHL10AN621":"GSPOGE.ABB_DCS.104HHL10AN621XB04","104HHL10AN631":"GSPOGE.ABB_DCS.104HHL10AN631XB04","204HHL10AN611":"GSPOGE.ABB_DCS.204HHL10AN611XB04","204HHL10AN621":"GSPOGE.ABB_DCS.204HHL10AN621XB04","204HHL10AN631":"GSPOGE.ABB_DCS.204HHL10AN631XB04","104SDF01AN001":"GSPOGE.ABB_DCS.104SDF01AN001XB04","104SDF01AN002":"GSPOGE.ABB_DCS.104SDF01AN002XB04","204SDF01AN001":"GSPOGE.ABB_DCS.204SDF01AN001XB04","204SDF01AN002":"GSPOGE.ABB_DCS.204SDF01AN002XB04","204LMDF01AN001":"GSPOGE.ABB_DCS.204LMDF01AN001XB04","104ETG30AN601":"GSPOGE.ABB_DCS.104ETG30AN601XB04","104ETG30AN602":"GSPOGE.ABB_DCS.104ETG30AN602XB04","204ETG30AN601":"GSPOGE.ABB_DCS.204ETG30AN601XB04","204ETG30AN602":"GSPOGE.ABB_DCS.204ETG30AN602XB04","104ETH03AN601":"GSPOGE.ABB_DCS.104ETH03AN601XB04","104ETH03AN602":"GSPOGE.ABB_DCS.003ETH03AN602XB04","103HRJ01AN601":"GSPOGE.ABB_DCS.103HRJ01AN601XB04","103HRJ01AN602":"GSPOGE.ABB_DCS.103HRJ01AN602XB04","203HRJ01AN601":"GSPOGE.ABB_DCS.203HRJ01AN601XB04","203HRJ01AN602":"GSPOGE.ABB_DCS.203HRJ01AN602XB04"});
const el=id=>root.document.getElementById(id);
const text=v=>String(v??'').trim();
const stamp=v=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const validDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const latestDay=()=>new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10);
const fmt=v=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v));
let busy=false,active=null,verifiedAssets=[];
function user(){try{return JSON.parse(root.localStorage.getItem(KEY)||'null')}catch{return null}}
function actor(){const u=user();return text(u?.employeeNo||u?.employee_no||u?.user?.employeeNo)}
function token(){const u=user(),t=text(u?.sessionToken||u?.session_token);if(!t||t.length>8192)throw Error('로그인이 필요합니다.');return t;}
function status(s){if(el('blowerR9Status'))el('blowerR9Status').textContent=s;}
function setBusy(value){busy=value;for(const id of ['blowerR9Start','blowerR9Check','blowerR9Date','blowerR9Asset'])if(el(id))el(id).disabled=value;}
async function request(url,method='GET',body){const h={Authorization:'Bearer '+token(),Accept:'application/json','X-GS-Client-Mode':'desktop'};
 if(body)h['Content-Type']='application/json; charset=utf-8';
 const r=await root.fetch(url,{method,headers:h,cache:'no-store',credentials:'same-origin',...(body?{body:JSON.stringify(body)}:{})});
 const v=await r.json();if(!r.ok||v.ok!==true)throw Error(text(v?.message||'요청 실패').slice(0,220));return v;}
function selected(){const tag=text(el('blowerR9Asset')?.value),day=text(el('blowerR9Date')?.value),a=verifiedAssets.find(x=>x.tagNumber===tag);
 if(!SIGNALS[tag]||!a||!validDay(day)||day>latestDay())throw Error('검증된 27대 설비와 완료된 과거 날짜를 선택해 주세요.');
 return {tag,day,asset:a,mode:PREFIX+tag+':'+day.replace(/-/g,''),signal:SIGNALS[tag]};}
function key(x){return 'gs-blower-r9:'+actor()+':'+x.mode;}
function loadId(x){try{return text(root.sessionStorage.getItem(key(x)))}catch{return ''}}
function saveId(x,id){try{root.sessionStorage.setItem(key(x),id)}catch{}}
function clearFailedId(x,id){try{if(loadId(x)===id)root.sessionStorage.removeItem(key(x))}catch{}}
function empty(){if(el('blowerR9Result'))el('blowerR9Result').textContent='';}
function showResult(v,info){const zone=el('blowerR9Result');if(!zone)return;zone.textContent='';
 const title=root.document.createElement('p');title.className='blower-r9-total';title.textContent=info.asset.displayName+' · '+info.day+' · RUN '+v.runSeconds+'초 ('+(v.runSeconds/3600).toFixed(3)+'시간)';zone.appendChild(title);
 const note=root.document.createElement('p');note.className='blower-r9-help';note.textContent='DataPARC fnValTime 운전구간 기준. 날짜 경계는 실제 기동·정지시각이 아닙니다. GOOD 품질과 V-belt 교체 완료시각을 별도로 확인해야 합니다.';zone.appendChild(note);
 if(!v.periods.length){const no=root.document.createElement('p');no.textContent='이 날짜의 RUN 구간 0건 · 기동 신호 없음';zone.appendChild(no);return;}
 const table=root.document.createElement('table');table.className='blower-r9-table';
 const head=root.document.createElement('thead'),tr=root.document.createElement('tr');for(const label of ['RUN 시작','RUN 종료','운전시간']){const th=root.document.createElement('th');th.textContent=label;tr.appendChild(th);}head.appendChild(tr);table.appendChild(head);
 const body=root.document.createElement('tbody');for(const p of v.periods){const row=root.document.createElement('tr');for(const value of [fmt(p.startAt)+(p.startKind==='window_boundary'?' (이전부터 운전)':' (기동)'),fmt(p.endAt)+(p.endKind==='window_boundary'?' (이후에도 운전)':' (정지)'),(p.durationSeconds/3600).toFixed(3)+' h']){const td=root.document.createElement('td');td.textContent=value;row.appendChild(td);}body.appendChild(row);}table.appendChild(body);zone.appendChild(table);
}
function verifyResponse(info,raw,id){const item=raw?.item;const probe=item?.probe,result=item?.result;
 if(item?.id!==id||item?.status!=='complete'||item.requestType!=='blower_runtime_probe'||!probe||!result||
  probe.requestId!==id||probe.assetTag!==info.tag||probe.dataParcTag!==info.signal||result.requestId!==id||
  result.assetTag!==info.tag||result.dataParcTag!==info.signal||
  !text(probe.expectedCycleRuntimeRevision).startsWith('r7-evidence-only-v1:r9_signal_v1:')||
  result.expectedCycleRuntimeRevision!==probe.expectedCycleRuntimeRevision||
  stamp(probe.startAt)!==Date.parse(info.day+'T00:00:00+09:00')||
  stamp(probe.endAt)!==Date.parse(info.day+'T00:00:00+09:00')+86400000)return null;
 if(result.schemaVersion!==1||result.ok!==true||result.readOnly!==true||result.requestType!=='blower_runtime_probe'||
  stamp(result.startAt)!==stamp(probe.startAt)||stamp(result.endAt)!==stamp(probe.endAt)||stamp(result.observedAt)!==stamp(probe.endAt)||
  result.chunkCount!==1||result.completedChunkCount!==1||!Array.isArray(result.chunks)||result.chunks.length!==1)return null;
 const c=result.chunks[0],start=stamp(result.startAt),end=stamp(result.endAt);
 if(c?.index!==1||stamp(c.startAt)!==start||stamp(c.endAt)!==end||c.startState!==result.startState||c.endState!==result.endState||
  !['running','stopped'].includes(c.startState)||!['running','stopped'].includes(c.endState)||
  !Number.isSafeInteger(c.runningSeconds)||c.runningSeconds<0||c.runningSeconds>86402||result.runningSeconds!==c.runningSeconds||
  c.eventSource!=='dataparc_fnValTime_intervals_v1'||!Array.isArray(c.runPeriods)||c.runPeriods.length>198)return null;
 let last=start,sum=0;const periods=[];
 for(const p of c.runPeriods){const from=stamp(p?.startAt),to=stamp(p?.endAt);
  if(!Number.isFinite(from)||!Number.isFinite(to)||from<last||to<=from||to>end||
   p.startKind!==(from===start?'window_boundary':'start_signal')||
   p.endKind!==(to===end?'window_boundary':'stop_signal'))return null;
  periods.push({startAt:p.startAt,endAt:p.endAt,startKind:p.startKind,endKind:p.endKind,durationSeconds:(to-from)/1000});last=to;sum+=(to-from)/1000;
 }
 if(Math.abs(sum-c.runningSeconds)>2||
  (c.startState==='running')!==(periods.length>0&&stamp(periods[0].startAt)===start)||
  (c.endState==='running')!==(periods.length>0&&stamp(periods.at(-1).endAt)===end))return null;
 return {periods,runSeconds:c.runningSeconds};
}
async function begin(){if(busy)return;setBusy(true);empty();try{const info=selected(),old=loadId(info);
 if(old){
  // Only an explicitly confirmed failed R9 request may be retried, and only
  // after a new user click. Preserve pending/processing/complete IDs.
  const prior=await request(API+'?id='+encodeURIComponent(old)+'&_='+Date.now());
  if(prior?.item?.id!==old)throw Error('이전 R9 요청 ID가 일치하지 않습니다.');
  if(prior.item.status!=='failed'){
    active={...info,id:old};status('기존 R9 요청 '+old+' · 「결과 확인」을 눌러주세요. 중복 요청하지 않았습니다.');return;
  }
  clearFailedId(info,old);
 }
 const a=info.asset;const body={action:'create_blower_runtime_probe',r7EvidenceMode:info.mode,
  unifiedRefresh:true,incrementalRefresh:false,requireIncrementalAppend:false,
  assetTag:info.tag,dataParcTag:info.signal,confirmRunSignal:true,startAt:info.day+'T00:00:00+09:00',
  expectedLastReplacementAt:a.lastReplacementAt||'',expectedCycleStartState:a.cycleStartState||'legacy',
  expectedCycleStartedAt:a.cycleStoredStartedAt??a.cycleStartedAt??'',expectedCycleStartRevision:a.cycleStartRevision||'',
  expectedCycleRuntimeRevision:a.cycleRuntimeRevision||''};
 const reply=await request(API,'POST',body);const id=text(reply.item?.id||reply.items?.[0]?.id||reply.requestId);
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('요청 ID가 올바르지 않습니다.');
 active={...info,id};saveId(info,id);status('접수 완료 · '+id+' · 결과 확인을 눌러주세요. 기존 누적시간은 변경하지 않습니다.');
 }catch(e){status('조회 요청 중단 · '+text(e.message||e).slice(0,230));}finally{setBusy(false);}}
async function check(){if(busy)return;setBusy(true);try{const info=selected(),id=loadId(info);
 if(!id){status('조회 요청을 먼저 접수해 주세요.');return;}
 const response=await request(API+'?id='+encodeURIComponent(id)+'&_='+Date.now()),item=response.item;
 if(item?.id!==id)throw Error('조회 ID가 일치하지 않습니다.');
 if(item.status==='failed'){clearFailedId(info,id);active=null;status('조회 실패 · '+text(item.errorMessage||'Agent 응답 오류').slice(0,175)+' · Agent 재시작 상태 확인 후 「운전구간 조회」로 수동 재시도 가능');return;}
 if(item.status!=='complete'){status('조회 중 · '+text(item.status)+' · 기존 요청을 확인하고 있습니다.');return;}
 const outcome=verifyResponse(info,response,id);
 if(!outcome){status('R9 상세 데이터 검증 실패 또는 회사 PC Agent에 R9 기능이 반영되지 않았습니다. 누적시간은 유지됩니다.');return;}
 showResult(outcome,info);status('기동·정지 구간 '+outcome.periods.length+'건 검증 완료 · 누적시간·정비이력 저장값은 그대로 유지');
 }catch(e){status('결과 확인 중단 · '+text(e.message||e).slice(0,230));}finally{setBusy(false);}}
async function init(){const panel=el('blowerR9Panel');if(!panel||!actor()||!text(user()?.sessionToken||user()?.session_token))return;
 if(root.matchMedia?.('(max-width:700px), (max-width:1024px) and (hover:none) and (pointer:coarse)')?.matches)return;
 try{const data=await request('/api/blower-history');
  if(data.permissions?.isSuperAdmin!==true && data.user?.isSuperAdmin!==true)return;
  verifiedAssets=(data.assets||[]).filter(a=>SIGNALS[a.tagNumber]&&a.dataParcTag===SIGNALS[a.tagNumber]&&a.cycleRuntimeRevision&&a.cycleStartRevision);
  const select=el('blowerR9Asset');verifiedAssets.sort((a,b)=>Number(a.sortOrder)-Number(b.sortOrder));
  for(const a of verifiedAssets){const o=root.document.createElement('option');o.value=a.tagNumber;o.textContent=(a.displayName||a.tagNumber)+' · '+a.tagNumber;select.appendChild(o);}
  const dt=el('blowerR9Date');dt.value=latestDay();dt.max=latestDay();
  panel.hidden=false;el('blowerR9Start').addEventListener('click',begin);el('blowerR9Check').addEventListener('click',check);
  el('blowerR9Asset').addEventListener('change',()=>{empty();status('조회할 설비·날짜를 선택한 후 요청해 주세요.');});
  dt.addEventListener('change',()=>{empty();status('조회할 설비·날짜를 선택한 후 요청해 주세요.');});
  status('검증된 RUN 신호 '+verifiedAssets.length+'/27대 · 신호 불일치 설비는 조회 제외 · 누적 변경 없음');
 }catch(e){status('R9 설비 목록 확인 실패 · '+text(e.message||e).slice(0,200));}
}
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window!=='undefined'?window:globalThis);
