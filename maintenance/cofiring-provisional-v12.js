/* V17: stable DataPARC evidence binding and correct next-morning source date.
   V13: automatic, separately-audited provisional values in existing calculation,
   closed-data and morning-meeting surfaces. No new save/query widgets.
   Official close records, measured DataPARC and Excel remain untouched. */
(function(root){
'use strict';
if(root.CofiringProvisionalV13Installed)return;
root.CofiringProvisionalV13Installed=true;
const GS_V17_CONTEXT_BINDING = true; // V17 guard marker
const GS_V20_COMPLETED_SOURCE_WHILE_REFRESHING = true; // V20 guard marker
const API='/api/cofiring-provisional-v12';
const MEETING_ID='efficiencyMorningMeetingAutoCofiringCard';
const APPROVED=new Set(['2026-10-23','2026-10-24']);
const UNITS=['unit1','unit2'];
const FUELS=['coal','bio','organic','manure'];
const RATIO_KEYS=['bio','organicGroup','total'];
const FIELD_IDS={
  unit1:{coal:'efficiencyMorningMeetingCofiringUnit1CoalUsage',bio:'efficiencyMorningMeetingCofiringUnit1BioUsage',organic:'efficiencyMorningMeetingCofiringUnit1OrganicInput',
    ratios:{bio:'efficiencyMorningMeetingCofiringUnit1BioRatio',organicGroup:'efficiencyMorningMeetingCofiringUnit1OrganicRatio',total:'efficiencyMorningMeetingCofiringUnit1TotalRatio'}},
  unit2:{coal:'efficiencyMorningMeetingCofiringUnit2CoalUsage',bio:'efficiencyMorningMeetingCofiringUnit2BioUsage',organic:'efficiencyMorningMeetingCofiringUnit2OrganicInput',
    ratios:{bio:'efficiencyMorningMeetingCofiringUnit2BioRatio',organicGroup:'efficiencyMorningMeetingCofiringUnit2OrganicRatio',total:'efficiencyMorningMeetingCofiringUnit2TotalRatio'}}
};
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const near=(a,b,tol=0.001)=>finite(a)&&finite(b)&&Math.abs(a-b)<=tol;
const fmt=n=>finite(n)?n.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const fmtPct=n=>finite(n)?n.toFixed(2)+'%':'—';
const validDate=s=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s);
const getToken=()=>{try{const h=root.getShiftLogAuthHeaders?.()||{};return String(h.Authorization||h.authorization||'')}catch{return ''}};
const headers=()=>({...root.getShiftLogAuthHeaders?.(),Accept:'application/json'});
const dateAllowed=d=>APPROVED.has(d);
const state={saveKey:'',saveBusy:false,failKey:'',failUntil:0,morningDate:'',morningItem:null,morningSourceDate:'',morningPending:'',morningCheckAt:0,historyCheckAt:0,historyItems:null,historyPending:false,historyKey:'',tickTimer:null};
async function request(suffix='',opts={}){
 const r=await root.fetch(API+suffix,{credentials:'same-origin',cache:'no-store',...opts,headers:{...headers(),...(opts.headers||{})}});
 let data;try{data=await r.json()}catch{throw Error('가정 계산 기록의 서버 응답을 확인하지 못했습니다.')}
 if(!r.ok||data?.ok!==true)throw Error(data?.message||'가정 계산 자료 조회에 실패했습니다.');
 return data;
}
function validItem(item,date){
 if(!dateAllowed(date))return false;
 if(!item||item.targetDate!==date||item.recordKind!=='hypothesis'||item.verificationStatus!=='unverified'||item.officialClose!==false)return false;
 if(item.assumption?.silo!=='organicStorageSiloB'||item.assumption?.boundaryLocal!=='2026-10-24T00:00'||!near(item.assumption?.tons,19.143,0.00001))return false;
 return UNITS.every(u=>FUELS.every(f=>finite(item.summary?.[u]?.[f]))&&
 ['bioRatio','organicGroupRatio','totalRatio'].every(k=>finite(item.summary?.[u]?.[k])))&&finite(item.summary?.combined?.totalRatio);
}
function calcContext(){
 const shell=root.document?.querySelector('.cofiring-period-v5');const ctrl=root.__cofiringPeriodV5Controller;
 const spec=ctrl?.getSpec?.(),date=shell?.querySelector('[data-cfv7-date]')?.value,mode=shell?.querySelector('[data-cfv8-mode]')?.value;
 return {shell,ctrl,spec,date,mode};
}
function nextDate(value){
 if(!validDate(value))return '';
 const ms=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(ms)?new Date(ms+86400000).toISOString().slice(0,10):'';
}
function morningSourceDate(date){
 // targetDate() already supplies the data date printed on the morning card.
 return dateAllowed(date)?date:'';
}
function projectionContext(){
 const c=calcContext(),scenarioApi=root.CofiringSharedScenarioV7;
 if(!c.shell||!c.ctrl)throw Error('혼소율 계산 화면이 준비되지 않았습니다. 혼소율 메뉴를 다시 열어 주세요.');
 if(!dateAllowed(c.date))throw Error('가정 저장은 10월 23·24일의 승인된 재고 가정에만 사용할 수 있습니다.');
 if(c.mode!=='daily')throw Error('계산 방식을 일별 계산으로 선택해 주세요.');
 if(!c.spec||c.spec.startLocal!==c.date+'T00:00'||c.spec.endLocal!==nextDate(c.date)+'T00:00'||
   (c.spec.stepUnit&&c.spec.stepUnit!=='minute')||(c.spec.stepValue!=null&&c.spec.stepValue!==1))
   throw Error('선택일 00:00~다음 날 00:00의 완료된 일별 계산인지 확인해 주세요.');
 if(!scenarioApi?.project||!scenarioApi?.isScenario)throw Error('유기성 가정 계산 모듈을 불러오지 못했습니다. 새로고침해 주세요.');
 // Read the authoritative controller result, not the text or rounded values
 // from the cards. A render may have completed before the async controller
 // has published its last result; try only other controller-owned snapshots.
 const candidates=[c.ctrl.getResult?.(),c.ctrl.getDisplayResult?.(),c.shell.__cfv6DetailPayload?.result];
 let raw=null,projected=null,scenario=null;
 for(const candidate of candidates){
   if(!candidate)continue;
   const projection=scenarioApi.project(candidate),assumption=projection?.hypothesisDisplay;
   if(scenarioApi.isScenario(assumption)&&near(assumption.assumedStorageBTons,19.143,0.00001)){
     raw=candidate;projected=projection;scenario=assumption;break;
   }
 }
 if(!raw)throw Error('계산 카드의 가정값과 원본 계산 연결이 확인되지 않았습니다. 일별 [계산하기]를 다시 실행해 주세요.');
 const live=c.ctrl.live?.state?.(),item=live?.item,saved=item?.saved;
 if(!item)throw Error('DataPARC 조회 상태를 불러오지 못했습니다. [계산하기]로 저장된 결과를 확인해 주세요.');
 // A newer DataPARC request may be running while the exact old daily result
 // remains complete and visible. Never treat background refreshing of that
 // newer request as loss of the independently persisted old source evidence.
 // The API will REVALIDATE the completed original and all displayed numbers.
 const currentId=item.result?.requestId;
 if(saved){
  if(saved.status!=='complete'||saved.requestType&&saved.requestType!=='cofiring_period'||saved.targetDate&&saved.targetDate!==c.date)
    throw Error('완료된 DataPARC 원본의 저장 상태 또는 날짜를 다시 확인해 주세요.');
  if(typeof saved.id!=='string'||!/^[a-f0-9-]{30,48}$/i.test(saved.id))
    throw Error('저장된 DataPARC 원본 ID가 유효하지 않습니다.');
  if(currentId&&currentId!==saved.id)
    throw Error('화면 계산과 완료된 DataPARC 원본 조회 ID가 다릅니다. [계산하기]를 다시 눌러 주세요.');
  if((item.active||item.loading||item.submitting)&&!currentId)
    throw Error('최신 조회 중에는 화면의 완료 원본 ID가 필요합니다. 원본 조회 완료 후 다시 확인합니다.');
  // A completed result is only valid for the exact currently selected period.
  if(live.period&&['startLocal','endLocal','stepUnit','stepValue'].some(key=>live.period[key]!==c.spec[key]))
    throw Error('화면의 조회 기간과 저장된 원본의 조회 기간이 다릅니다. [계산하기]를 다시 실행해 주세요.');
 }else if(item.active||item.loading||item.submitting){
  throw Error('완료된 DataPARC 원본이 아직 없습니다. 현재 조회가 끝나면 가정 저장을 다시 확인합니다.');
 }
 // Legacy cached results without saved metadata remain read-only candidates:
 // the server independently requires a matching completed saved source ID.
 const id=saved?.id||currentId;
 if(typeof id!=='string'||!/^[a-f0-9-]{30,48}$/i.test(id))throw Error('DataPARC 원본 요청 ID를 확인하지 못했습니다. 저장된 결과를 다시 불러와 주세요.');
 return {...c,raw,projected,scenario,saved:{id}};
}
function buildPayload(){
 const c=projectionContext();
 const module=root.CofiringPeriodV5,settings=module?.readSettings?.(c.shell),manual=module?.readManual?.(c.shell);
 if(!settings||!manual)throw Error('가정 계산 발열량과 연료 사용량 자료를 기다리고 있습니다.');
 const active=root.CofiringProvisionalAdjustV14?.getActive?.(c)||null;
 const adjusted=active?.result||c.projected;
 const preview={units:{},combined:{}};
 for(const u of UNITS){const src=adjusted.units?.[u];preview.units[u]={ratios:{}};
  for(const fuel of FUELS)preview.units[u][fuel]=src?.[fuel]?.quantity;
  for(const k of RATIO_KEYS)preview.units[u].ratios[k]=src?.fuelRatios?.[k];
 }
 for(const k of RATIO_KEYS)preview.combined[k]=adjusted?.combined?.fuelRatios?.[k];
 const data={targetDate:c.date,sourceRequestId:String(c.saved.id),receiptTons:c.scenario.receipt,unitTons:c.scenario.unitTons,
  settings,manure:{unit1:manual.unit1?.manure??0,unit2:manual.unit2?.manure??0},preview,
  ...(active?.adjustment?{adjustment:active.adjustment,confirmProvisionalAdjustment:true}:{}),acknowledgeUnverified:true};
 if(!finite(data.receiptTons)||!finite(data.unitTons)||!UNITS.every(u=>FUELS.every(f=>finite(preview.units[u][f]))&&RATIO_KEYS.every(k=>finite(preview.units[u].ratios[k])))||!RATIO_KEYS.every(k=>finite(preview.combined[k])))throw Error('가정값 및 원본 계산값 검증을 완료하지 못했습니다.');
 return data;
}
// V14: Status is attached to the existing results toolbar. This does not
// enable the official closing button or change any DataPARC source reading.
function saveStatus(message,tone=''){
 // Compact save notice V1: display failures must never interrupt saving.
 try{
  const shell=calcContext().shell;if(!shell)return;
  const statusMessage=message,statusTone=tone;
  try{
   const presenter=root.GSCofiringSaveNoticeCompactV1?.show;
   if(typeof presenter==='function'){presenter(shell,statusMessage,statusTone);return;}
  }catch(error){root.console?.warn?.('가정 저장 안내 표시 오류:',error);}
  const host=shell.querySelector('.cfv-results-dark');if(!host)return;
  let node=host.querySelector('[data-cfv-save-notice-fallback-v1]');
  if(!node){
   node=root.document.createElement('div');node.dataset.cfvSaveNoticeFallbackV1='';
   node.dataset.gsV14SaveStatus='';node.dataset.v14SaveStatus='';
   node.setAttribute('role','status');node.setAttribute('aria-live','polite');
   node.style.cssText='display:block;max-width:100%;margin:7px 0 0;padding:0;border:0;background:transparent;font-size:12px;line-height:1.5;white-space:normal;overflow-wrap:anywhere';
   host.append(node);
  }
  for(const previous of shell.querySelectorAll('[data-gs-v14-save-status],[data-v14-save-status]'))if(previous!==node)previous.remove();
  const date=shell.querySelector('[data-cfv7-date]')?.value||'';
  node.dataset.gsV14Date=date;node.dataset.v14Date=date;
  if(node.textContent!==String(statusMessage||''))node.textContent=String(statusMessage||'');
  node.dataset.tone=statusTone;node.style.color=statusTone==='error'?'#a33b27':'#64748b';
 }catch(error){root.console?.warn?.('가정 저장 안내를 표시하지 못했습니다:',error);}
}
function sameSaved(item,data){
 if(!validItem(item,data.targetDate)||item.sourceRequestId!==data.sourceRequestId)return false;
 if(JSON.stringify(item.adjustment||null)!==JSON.stringify(data.adjustment||null))return false;
 for(const u of UNITS){
  for(const f of FUELS)if(!near(item.summary[u][f],data.preview.units[u][f],0.0001))return false;
  for(const k of RATIO_KEYS){const key=k==='organicGroup'?'organicGroupRatio':k==='total'?'totalRatio':'bioRatio';
   if(!near(item.summary[u][key],data.preview.units[u].ratios[k],0.0001))return false;
  }
 }
 for(const k of RATIO_KEYS){const key=k==='organicGroup'?'organicGroupRatio':k==='total'?'totalRatio':'bioRatio';
  if(!near(item.summary.combined[key],data.preview.combined[k],0.0001))return false;
 }
 // Full GET responses also carry the exact settings used for the saved values.
 if(item.record&&(JSON.stringify(item.record.settings)!==JSON.stringify(data.settings)||
    JSON.stringify(item.record.manure)!==JSON.stringify(data.manure)))return false;
 return true;
}
function inlineUpdateEvent(date){
 if(typeof root.CustomEvent==='function')root.dispatchEvent?.(new root.CustomEvent('cofiring:provisional-inline-updated',{detail:{targetDate:date}}));
}
function isCurrentHypothesis(){
 const c=calcContext();if(!dateAllowed(c.date)||c.mode!=='daily'||!c.shell)return false;
 try{
  const projected=root.CofiringSharedScenarioV7?.project?.(c.ctrl?.getResult?.());
  return root.CofiringSharedScenarioV7?.isScenario?.(projected?.hypothesisDisplay)===true||
   !!c.shell.querySelector('.cfv17-hypothesis-card');
 }catch{return !!c.shell.querySelector('.cfv17-hypothesis-card')}
}
function currentSaveContext(auth,data){
 if(getToken()!==auth||calcContext().date!==data.targetDate||calcContext().mode!=='daily')return false;
 try{return JSON.stringify(buildPayload())===JSON.stringify(data)}catch{return false}
}
function saveNotice(message,tone){try{saveStatus(message,tone)}catch(error){root.console?.warn?.('가정 저장 안내 표시 오류:',error)}}
function publishSaved(item,data,key){
 state.saveKey=key;state.savedItem=item;state.failKey='';state.failUntil=0;
 state.pendingKey='';state.pendingUntil=0;state.pendingMessage='';
 state.morningCheckAt=0;state.historyCheckAt=0;
 try{root.CofiringProvisionalAdjustV14?.onSaved?.()}catch(error){root.console?.warn?.('가정 조정 저장 표시 오류:',error)}
 saveNotice('가정 계산 저장 완료 · 미확정','success');
 try{inlineUpdateEvent(data.targetDate)}catch(error){root.console?.warn?.('가정 저장 화면 갱신 오류:',error)}
}
async function autoSave(options={}){
 const force=options?.force===true;
 let data;try{data=buildPayload()}catch(error){
  const message=error?.message||'계산 준비 중';
  if(isCurrentHypothesis())saveNotice('가정 저장 대기 · '+message,'warn');
  return {ok:false,pending:true,message};
 }
 const auth=getToken();if(!auth){saveNotice('가정 저장 대기 · 로그인 필요','warn');return {ok:false,message:'로그인이 필요합니다.'}}
 const key=JSON.stringify([auth,data]);
 const cancelled=()=>({ok:false,cancelled:true,targetDate:data.targetDate,message:'선택 날짜 또는 계산값이 변경되었습니다. 현재 결과에서 다시 저장해 주세요.'});
 if(state.saveTask){
  if(state.saveTask.key===key)return state.saveTask.promise;
  if(!force)return {ok:false,pending:true,targetDate:data.targetDate,message:'이전 계산의 저장 확인이 끝나면 현재 결과를 저장합니다.'};
  await state.saveTask.promise;
  if(!currentSaveContext(auth,data))return cancelled();
  if(state.saveTask)return {ok:false,pending:true,targetDate:data.targetDate,message:'저장이 진행 중입니다. 잠시 뒤 다시 확인해 주세요.'};
 }
 if(!force&&state.saveKey===key&&sameSaved(state.savedItem,data)){
  // A quick adjustment/reset may return to the already-persisted base values.
  // Acknowledge that reset without emitting another history/morning event.
  if(root.CofiringProvisionalAdjustV14?.resetRequested?.()){
   try{root.CofiringProvisionalAdjustV14?.onSaved?.()}catch(error){root.console?.warn?.('가정 원복 저장 표시 오류:',error)}
  }
  saveNotice('가정 계산 저장 완료 · 미확정','success');
  return {ok:true,item:state.savedItem,targetDate:data.targetDate,cached:true};
 }
 if(!force&&state.failKey===key&&Date.now()<state.failUntil)
  return {ok:false,targetDate:data.targetDate,message:state.saveError||'가정 계산 저장을 다시 확인해 주세요.'};
 // Rendering ticks must not repeatedly refetch an adjustment that cannot yet
 // be restored. An explicit reset or a changed payload can proceed at once.
 if(!force&&state.pendingKey===key&&Date.now()<state.pendingUntil&&
    !root.CofiringProvisionalAdjustV14?.resetRequested?.())
  return {ok:false,pending:true,targetDate:data.targetDate,message:state.pendingMessage};
 state.saveBusy=true;
 saveNotice('가정 계산 저장 중…','working');
 const task={key,promise:null};
 task.promise=Promise.resolve().then(async()=>{
  try{
   if(!currentSaveContext(auth,data))return cancelled();
   const before=await request('?targetDate='+encodeURIComponent(data.targetDate));
   if(!currentSaveContext(auth,data))return cancelled();
   if(before.item&&(!validItem(before.item,data.targetDate)||!Number.isSafeInteger(before.item.revision)||before.item.revision<1))
    throw Error('기존 가정 저장 기록의 날짜 또는 버전을 확인하지 못했습니다.');
   if(sameSaved(before.item,data)){
    publishSaved(before.item,data,key);return {ok:true,item:before.item,targetDate:data.targetDate};
   }
   // Let the existing adjustment module restore its saved transfer first.
   if(!data.adjustment&&before.item?.adjustment&&!root.CofiringProvisionalAdjustV14?.resetRequested?.()){
    const message=before.item.sourceRequestId===data.sourceRequestId
     ?'저장된 가정 혼소조정을 불러오는 중입니다. 조정값이 표시된 뒤 다시 저장해 주세요.'
     :'이전 조회 원본에 저장된 가정 혼소조정이 있습니다. 현재 결과에서 혼소조정을 다시 적용하거나 [가정 조정 원복]을 눌러 주세요.';
    state.pendingKey=key;state.pendingUntil=Date.now()+30000;state.pendingMessage=message;
    saveNotice('가정 저장 대기 · '+message,'warn');
    return {ok:false,pending:true,targetDate:data.targetDate,message};
   }
   if(!root.crypto?.randomUUID)throw Error('안전한 기록 ID를 만들 수 없습니다.');
   const response=await request('',{method:'POST',headers:{'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},
    body:JSON.stringify({...data,expectedRevision:before.item?.revision||0,requestId:root.crypto.randomUUID()})});
   if(!validItem(response.item,data.targetDate)||!sameSaved(response.item,data)||
      !Number.isSafeInteger(response.item.revision)||response.item.revision<1)
    throw Error('서버가 저장한 가정값과 현재 계산값이 일치하는지 확인하지 못했습니다.');
   if(!currentSaveContext(auth,data))return {...cancelled(),stored:true};
   publishSaved(response.item,data,key);
   return {ok:true,item:response.item,targetDate:data.targetDate};
  }catch(error){
   const message=error?.message||'가정 계산 저장을 확인하지 못했습니다.';
   state.failKey=key;state.failUntil=Date.now()+30000;state.saveError=message;
   if(currentSaveContext(auth,data)){
    try{if(data.adjustment||root.CofiringProvisionalAdjustV14?.resetRequested?.())root.CofiringProvisionalAdjustV14?.onSaveError?.(message)}catch{}
    saveNotice('가정 기록 저장 실패 · '+message,'error');
   }
   root.console?.warn?.('가정 계산 저장 실패:',message);
   return {ok:false,targetDate:data.targetDate,message};
  }finally{
   if(state.saveTask===task){state.saveTask=null;state.saveBusy=false;}
  }
 });
 state.saveTask=task;
 return task.promise;
}
function clearLegacyExtras(){
 const doc=root.document;if(!doc)return;
 // V12 used three extraneous surfaces. V13 deliberately shows no such widgets.
 for(const s of ['[data-gs-v12-morning]','[data-gs-v12-history]','[data-gs-v12-save]','[data-gs-v12-save-status]']){
  doc.querySelectorAll(s).forEach(el=>el.remove());
 }
}
function setText(el,value){if(el&&el.textContent!==value)el.textContent=value;}
function setMorningSavedBadge(card,item,sourceDate){
 const badge=root.document?.getElementById('efficiencyMorningMeetingCofiringStatus');
 if(!badge||!card.contains(badge))return;
 if(!badge.hasAttribute('data-gs-v24-badge')){
  badge.dataset.gsV24Badge='';badge.dataset.gsV24Previous=badge.textContent||'';
  badge.dataset.gsV24PreviousTitle=badge.getAttribute('title')||'';
  badge.dataset.gsV24PreviousAria=badge.getAttribute('aria-label')||'';
  badge.dataset.gsV24HadAria=badge.hasAttribute('aria-label')?'1':'0';
 }
 const detail='계산일 '+sourceDate+' · 가정값 저장 · 미확정'+(item?.adjustment?' · Bio 조정':'')+
  ' · 2026-10-24 00:00 통신 오류로 Storage B 재고 19.143t 가정 · 정확한 값이 아닐 수 있어 재확인 필요';
 setText(badge,'가정값');badge.dataset.gsV24Written='가정값';
 if(badge.title!==detail)badge.title=detail;
 if(badge.getAttribute('aria-label')!==detail)badge.setAttribute('aria-label',detail);
 badge.dataset.gsV24WrittenTitle=detail;badge.dataset.gsV24WrittenAria=detail;
 badge.classList.add('gs-v24-saved-badge');
}
function clearMorningSavedBadge(card){
 const badge=card.querySelector('[data-gs-v24-badge]');if(!badge)return;
 if(badge.textContent===badge.dataset.gsV24Written)setText(badge,badge.dataset.gsV24Previous||'마감자료 없음');
 // Restore only attributes still owned by this status; keep newer native paints.
 if(badge.title===badge.dataset.gsV24WrittenTitle)badge.title=badge.dataset.gsV24PreviousTitle||'';
 if(badge.getAttribute('aria-label')===badge.dataset.gsV24WrittenAria){
  if(badge.dataset.gsV24HadAria==='1')badge.setAttribute('aria-label',badge.dataset.gsV24PreviousAria||'');
  else badge.removeAttribute('aria-label');
 }
 badge.classList.remove('gs-v24-saved-badge');
 for(const key of ['gsV24Badge','gsV24Previous','gsV24PreviousTitle','gsV24PreviousAria','gsV24HadAria','gsV24Written','gsV24WrittenTitle','gsV24WrittenAria'])delete badge.dataset[key];
}
function clearMorning(){
 const doc=root.document;if(!doc)return;
 const card=doc.getElementById(MEETING_ID);if(!card)return;
 clearMorningSavedBadge(card);
 card.classList.remove('gs-v13-morning-hypothesis');delete card.dataset.gsV13ProvisionalDate;
 card.querySelector('[data-gs-v13-note]')?.remove();
 for(const field of card.querySelectorAll('[data-gs-v13-field]')){
  // Clear only data this module wrote; never overwrite a newer official repaint.
  if(field.textContent===field.dataset.gsV13Written)setText(field,'-');
  field.classList.remove('gs-v13-cell');field.parentElement?.classList.remove('gs-v13-cell-box');
  delete field.dataset.gsV13Written;delete field.dataset.gsV13Field;
 }
 state.morningItem=null;state.morningSourceDate='';
}
function morningDate(){try{return root.morningMeetingClosedCofiring?.targetDate?.()||''}catch{return ''}}
function morningBlocked(date){try{return root.morningMeetingClosedCofiring?.isBlocked?.(date)===true}catch{return true}}
function hasOfficialMorning(date){try{return !!root.morningMeetingClosedCofiring?.peek?.(date)}catch{return true}}
function applyMorning(item,date,sourceDate=date){
 const doc=root.document,card=doc?.getElementById(MEETING_ID);
 // Use only the saved hypothesis for the exact data date shown by the card.
 if(!card||!validItem(item,sourceDate)||!(morningSourceDate(date)===sourceDate||sourceDate===date)||morningDate()!==date||hasOfficialMorning(date)||morningBlocked(date))return false;
 if(card.dataset.gsV13ProvisionalDate&&card.dataset.gsV13ProvisionalDate!==date)clearMorning();
 card.dataset.gsV13ProvisionalDate=date;card.classList.add('gs-v13-morning-hypothesis');
 setMorningSavedBadge(card,item,sourceDate);
 for(const u of UNITS){const values=item.summary[u],ids=FIELD_IDS[u];
  for(const f of ['coal','bio','organic']){
   const el=doc.getElementById(ids[f]);if(!el||!card.contains(el))continue;
   const label=(f==='organic'?'≈':'')+fmt(values[f])+' t/d';setText(el,label);
   el.dataset.gsV13Written=label;el.dataset.gsV13Field=f;
   if(f==='organic'){el.classList.add('gs-v13-cell');el.parentElement?.classList.add('gs-v13-cell-box')}
  }
  for(const key of ['bio','organicGroup','total']){
   const el=doc.getElementById(ids.ratios[key]);if(!el||!card.contains(el))continue;
   const value=values[key==='organicGroup'?'organicGroupRatio':key==='total'?'totalRatio':'bioRatio'];const label=fmtPct(value);
   setText(el,label);el.dataset.gsV13Written=label;el.dataset.gsV13Field=key;
   // All three heat ratios depend on the assumed organic quantity.
   el.classList.add('gs-v13-cell');el.parentElement?.classList.add('gs-v13-cell-box');
  }
 }
 // A single status pill owns the hypothesis notice; no extra header row.
 card.querySelector('[data-gs-v13-note]')?.remove();
 state.morningItem=item;state.morningSourceDate=sourceDate;return true;
}
async function refreshMorning({force=false}={}){
 const date=morningDate(),auth=getToken(),card=root.document?.getElementById(MEETING_ID);
 if(!card)return;
 if(state.morningDate!==date){clearMorning();state.morningDate=date;state.morningCheckAt=0}
 if(!morningSourceDate(date)||!auth||morningBlocked(date)||hasOfficialMorning(date)){if(card.dataset.gsV13ProvisionalDate)clearMorning();return;}
 if(state.morningItem&&validItem(state.morningItem,state.morningSourceDate))applyMorning(state.morningItem,date,state.morningSourceDate);
 if(!force&&Date.now()-state.morningCheckAt<60000)return;
 if(state.morningPending===auth+'|'+date)return;
 const key=auth+'|'+date;state.morningPending=key;state.morningCheckAt=Date.now();
 try{
  const dates=[morningSourceDate(date)];
  let found=false;
  for(const sourceDate of dates){
   const {item}=await request('?targetDate='+encodeURIComponent(sourceDate));
   if(state.morningPending!==key||auth!==getToken()||morningDate()!==date||hasOfficialMorning(date)||morningBlocked(date))return;
   if(validItem(item,sourceDate)){found=applyMorning(item,date,sourceDate);if(found)break;}
  }
  if(!found&&card.dataset.gsV13ProvisionalDate)clearMorning();
 }catch(e){root.console?.warn?.('오전회의 가정 자료 조회 대기:',e.message)}
 finally{if(state.morningPending===key)state.morningPending=''}
}
function officialDates(table){return new Set([...table.querySelectorAll('tbody tr')].filter(r=>!r.hasAttribute('data-gs-v13-row')).map(r=>(r.cells?.[0]?.textContent||'').match(/20\d\d-\d\d-\d\d/)?.[0]).filter(Boolean))}
function addCell(row,text){const el=root.document.createElement('td');el.textContent=text;row.append(el);return el}
function decorateHistory(body,items){
 const panel=body?.closest('.cfv12-history-panel');if(!body||!panel||panel.hidden||panel.dataset.cfv15Mounted==='1')return;
 let table=body.querySelector('table');const filtered=(items||[]).filter(item=>dateAllowed(item?.targetDate)&&validItem(item,item.targetDate));
 const existing=table?officialDates(table):new Set();
 // Remove only obsolete provisional rows; never delete or recolor official rows.
 body.querySelectorAll('[data-gs-v13-row]').forEach(row=>{const d=row.dataset.gsV13Row;
  if(existing.has(d)||!filtered.some(item=>item.targetDate===d))row.remove();
 });
 const displayed=new Set([...body.querySelectorAll('[data-gs-v13-row]')].map(n=>n.dataset.gsV13Row));
 const missing=filtered.filter(x=>!existing.has(x.targetDate)&&!displayed.has(x.targetDate));if(!missing.length)return;
 if(!table){
  body.textContent='';table=root.document.createElement('table');table.className='cfv12-history-table gs-v13-inline-history-table';
  const thead=root.document.createElement('thead'),head=root.document.createElement('tr');
  ['날짜','1호기 Bio 혼소율','2호기 Bio 혼소율','종합 혼소율','상태','저장 시각',''].forEach(x=>{const th=root.document.createElement('th');th.textContent=x;head.append(th)});
  thead.append(head);table.append(thead,root.document.createElement('tbody'));body.append(table);
 }
 const tbody=table.querySelector('tbody')||table.appendChild(root.document.createElement('tbody'));
 for(const item of missing.sort((a,b)=>b.targetDate.localeCompare(a.targetDate))){
  const row=root.document.createElement('tr');row.dataset.gsV13Row=item.targetDate;row.className='gs-v13-history-hypothesis';
  addCell(row,item.targetDate+' · 유기성 (가정)');addCell(row,fmtPct(item.summary.unit1.bioRatio));addCell(row,fmtPct(item.summary.unit2.bioRatio));
  addCell(row,fmtPct(item.summary.combined.totalRatio));addCell(row,item.adjustment?'가정 계산 · Bio 조정 · 미확정':'가정 계산 · 미확정');
  addCell(row,'참고 기록');addCell(row,'');
  row.title='유기성 Storage B 00:00 재고 가정 포함 · 실측 마감값이 아닙니다.';tbody.append(row);
 }
}
async function refreshHistory({force=false}={}){
 const panel=root.document?.querySelector('.cfv12-history-panel');const body=panel?.querySelector('[data-cfv12-body]');
 if(!body||panel.hidden||!getToken()||panel.querySelector('[data-cfv15-host]'))return;
 const key=getToken();if(state.historyItems)decorateHistory(body,state.historyItems);
 if(state.historyPending||!force&&Date.now()-state.historyCheckAt<60000)return;
 state.historyPending=true;state.historyCheckAt=Date.now();state.historyKey=key;
 try{const {items}=await request('?limit=180');if(key!==getToken()||panel.hidden)return;
  state.historyItems=Array.isArray(items)?items:[];decorateHistory(body,state.historyItems);
 }catch(e){root.console?.warn?.('마감 데이터 가정값 조회 대기:',e.message)}
 finally{state.historyPending=false}
}
const css=`
/* GS_COFIRING_HYPOTHESIS_COMPACT_UI_V1: compact status, native value cells. */
#efficiencyMorningMeetingCofiringStatus.gs-v24-saved-badge{background:#fff7db!important;border-color:#e3c379!important;color:#885902!important;white-space:nowrap!important}
.gs-v13-morning-hypothesis .gs-v13-cell-box{background:transparent!important;box-shadow:none!important}
.gs-v13-morning-hypothesis .gs-v13-cell{color:#8c5a07!important;font-weight:700!important}
.gs-v13-inline-history-table{width:100%;border-collapse:collapse}
.gs-v13-history-hypothesis{background:#fff9e5!important;color:#805408}
.gs-v13-history-hypothesis td{border-bottom:1px solid #f0e1b9;padding:8px 9px;font-size:12px}
.gs-v13-history-hypothesis td:nth-child(5){font-weight:700}
[data-gs-v14-save-status]{display:inline-flex;max-width:min(440px,70vw);align-items:center;line-height:1.5;padding:3px 8px;border:1px solid #e6d8ad;border-radius:6px;background:#fff8e7;color:#845b13;font-size:11px;white-space:normal}
[data-gs-v14-save-status][data-tone=success]{border-color:#a7dec8;background:#eefaf4;color:#00705c}
[data-gs-v14-save-status][data-tone=error]{border-color:#e6b9b2;background:#fff1ef;color:#a03528}
`;
function mountCss(){const doc=root.document;if(!doc||doc.getElementById('gs-v13-inline-style'))return;
 const node=doc.createElement('style');node.id='gs-v13-inline-style';node.textContent=css;doc.head?.append(node)}
let scheduled=null;
function tick(){clearLegacyExtras();
 // Auto-persist ONLY the server-revalidated hypothesis; no confirmed close writes.
 if(root.document?.querySelector('.cofiring-period-v5'))void autoSave();
 const date=morningDate();if(!morningSourceDate(date)){if(state.morningDate!==date){clearMorning();state.morningDate=date}}else void refreshMorning();
 const panel=root.document?.querySelector('.cfv12-history-panel');if(panel&&!panel.hidden)void refreshHistory();
}
function schedule(){if(scheduled!==null)return;scheduled=root.setTimeout?.(()=>{scheduled=null;tick()},90)??null}
function clickCapture(event){const target=event.target?.closest?.('button');if(!target)return;
 const text=String(target.textContent||'').replace(/\s+/g,' ').trim();
 if(text==='마감 데이터'||target.hasAttribute('data-cfv12-refresh'))root.setTimeout?.(()=>void refreshHistory({force:true}),350);
 if(text.includes('오전회의자료')||text==='전체자료'||text==='새로 조회')root.setTimeout?.(()=>void refreshMorning({force:true}),350);
}
function boot(){if(!root.document)return;mountCss();clearLegacyExtras();root.document.addEventListener('click',clickCapture,true);
 if(root.MutationObserver){const mo=new root.MutationObserver(mutations=>{
  if(mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1)||m.type==='attributes'&&['hidden','value'].includes(m.attributeName)))schedule();
  // Native card writes are normally text-only mutations; apply inline values again without network.
  if(mutations.some(m=>m.type==='characterData'||m.type==='childList')){
   const d=morningDate();if(state.morningItem&&d===state.morningDate)root.setTimeout?.(()=>applyMorning(state.morningItem,d,state.morningSourceDate),40);
  }
 });mo.observe(root.document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','value'],characterData:true});}
 root.addEventListener?.('cofiring:provisional-inline-updated',event=>{
  if(event.detail?.targetDate===morningSourceDate(morningDate()))void refreshMorning({force:true});
  state.historyCheckAt=0;void refreshHistory({force:true});
 });
 root.addEventListener?.('cofiring:closed-history-changed',()=>{clearMorning();state.morningCheckAt=0;state.historyCheckAt=0;schedule()});
 // Bounded polling handles silently updated date selections and completed async reports.
 root.setInterval?.(()=>{if(!root.document.hidden)tick()},2500);schedule();
}
if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot()}
root.CofiringProvisionalV12={buildPayload,request,validItem,sameSaved,applyMorning,decorateHistory,autoSave,morningSourceDate,projectionContext,isCurrentHypothesis};
})(typeof globalThis==='object'?globalThis:this);
