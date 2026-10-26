/* V13: automatic, separately-audited provisional values in existing calculation,
   closed-data and morning-meeting surfaces. No new save/query widgets.
   Official close records, measured DataPARC and Excel remain untouched. */
(function(root){
'use strict';
if(root.CofiringProvisionalV13Installed)return;
root.CofiringProvisionalV13Installed=true;
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
function projectionContext(){
 const c=calcContext(),scenarioApi=root.CofiringSharedScenarioV7;
 if(!c.shell||!c.ctrl||!dateAllowed(c.date)||c.mode!=='daily'||!c.spec||c.spec.startLocal!==c.date+'T00:00'||!scenarioApi)return null;
 const raw=c.ctrl.getResult?.();if(!raw)return null;
 const projected=scenarioApi.project?.(raw),scenario=projected?.hypothesisDisplay;
 if(!scenarioApi.isScenario?.(scenario)||!near(scenario.assumedStorageBTons,19.143,0.00001))return null;
 const live=c.ctrl.live?.state?.()?.item,saved=live?.saved;
 if(!saved||saved.status!=='complete'||live.active||live.loading||live.submitting)return null;
 return {...c,raw,projected,scenario,saved};
}
function buildPayload(){
 const c=projectionContext();if(!c)throw Error('가정 계산이 완료된 일별 자료를 확인해 주세요.');
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
 const shell=calcContext().shell;if(!shell)return;
 const host=shell.querySelector('.cfv56-summary-actions')||shell.querySelector('.cfv11-status-row');
 if(!host)return;
 let node=host.querySelector('[data-gs-v14-save-status]');
 if(!node){node=root.document.createElement('span');node.dataset.gsV14SaveStatus='';node.setAttribute('role','status');node.setAttribute('aria-live','polite');host.append(node);}
 setText(node,message);node.dataset.tone=tone;
}
function sameSaved(item,data){
 if(!validItem(item,data.targetDate)||item.sourceRequestId!==data.sourceRequestId||!near(item.summary?.unit1?.organic,data.unitTons,0.0001)||!near(item.summary?.unit2?.organic,data.unitTons,0.0001))return false;
 if(JSON.stringify(item.adjustment||null)!==JSON.stringify(data.adjustment||null))return false;
 for(const u of UNITS){for(const f of FUELS)if(!near(item.summary[u][f],data.preview.units[u][f],0.0001))return false;
  if(!near(item.summary[u].totalRatio,data.preview.units[u].ratios.total,0.0001))return false;
 }
 return near(item.summary.combined.totalRatio,data.preview.combined.total,0.0001);
}
function inlineUpdateEvent(date){
 if(typeof root.CustomEvent==='function')root.dispatchEvent?.(new root.CustomEvent('cofiring:provisional-inline-updated',{detail:{targetDate:date}}));
}
async function autoSave(){
 if(state.saveBusy)return;
 let data;try{data=buildPayload()}catch(e){
  if(calcContext().shell?.querySelector('.cfv17-hypothesis-card'))saveStatus('가정 저장 대기 · '+(e?.message||'계산 준비 중'),'warn');
  return;
 }
 const auth=getToken();if(!auth){saveStatus('가정 저장 대기 · 로그인 필요','warn');return;}
 const key=JSON.stringify([auth,data.targetDate,data.sourceRequestId,data.receiptTons,data.unitTons,data.preview.combined.total,data.adjustment||null,root.CofiringProvisionalAdjustV14?.resetRequested?.()===true]);
 if(state.saveKey===key){saveStatus('가정 계산 별도 저장 완료 · 미확정','success');return;}
 if(state.failKey===key&&Date.now()<state.failUntil)return;
 state.saveBusy=true;saveStatus('가정 계산 별도 저장 중…','working');
 try{
  const before=await request('?targetDate='+encodeURIComponent(data.targetDate));
  if(getToken()!==auth||calcContext().date!==data.targetDate)return;
  if(sameSaved(before.item,data)){state.saveKey=key;root.CofiringProvisionalAdjustV14?.onSaved?.();saveStatus('가정 계산 별도 저장 완료 · 미확정','success');inlineUpdateEvent(data.targetDate);return;}
  // Existing operator-consented hypothetical transfer must not be overwritten
  // on a periodic repaint by an unadjusted result without a reset request.
  if(!data.adjustment&&before.item?.adjustment&&!root.CofiringProvisionalAdjustV14?.resetRequested?.()){
   state.saveKey=key;return;
  }
  if(!root.crypto?.randomUUID)throw Error('안전한 기록 ID를 만들 수 없습니다.');
  const response=await request('',{method:'POST',headers:{'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},
    body:JSON.stringify({...data,expectedRevision:before.item?.revision||0,requestId:root.crypto.randomUUID()})});
  if(getToken()!==auth)return;
  if(!validItem(response.item,data.targetDate))throw Error('저장된 가정 계산의 구분 정보를 확인하지 못했습니다.');
  state.saveKey=key;state.failKey='';root.CofiringProvisionalAdjustV14?.onSaved?.();saveStatus('가정 계산 별도 저장 완료 · 미확정','success');state.morningCheckAt=0;state.historyCheckAt=0;inlineUpdateEvent(data.targetDate);
 }catch(e){
  if(data.adjustment||root.CofiringProvisionalAdjustV14?.resetRequested?.())root.CofiringProvisionalAdjustV14?.onSaveError?.(e?.message||'서버 확인 필요');
  state.failKey=key;state.failUntil=Date.now()+30000;
  saveStatus('가정 기록 저장 실패 · '+(e?.message||'재조회 필요'),'error');
  // Never pretend an unsaved provisional projection was officially stored.
  root.console?.warn?.('미확정 가정 계산 자동 기록 실패 (원본 계산/공식 마감 보존):',e?.message||e);
 }finally{state.saveBusy=false;}
}
function clearLegacyExtras(){
 const doc=root.document;if(!doc)return;
 // V12 used three extraneous surfaces. V13 deliberately shows no such widgets.
 for(const s of ['[data-gs-v12-morning]','[data-gs-v12-history]','[data-gs-v12-save]','[data-gs-v12-save-status]']){
  doc.querySelectorAll(s).forEach(el=>el.remove());
 }
}
function setText(el,value){if(el&&el.textContent!==value)el.textContent=value;}
function clearMorning(){
 const doc=root.document;if(!doc)return;
 const card=doc.getElementById(MEETING_ID);if(!card)return;
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
 // Historical seam only: if no October 24 record exists, the October 23
 // calculation may be displayed in the next morning's card, EXPLICITLY dated.
 if(!card||!validItem(item,sourceDate)||!(sourceDate===date||date==='2026-10-24'&&sourceDate==='2026-10-23')||morningDate()!==date||hasOfficialMorning(date)||morningBlocked(date))return false;
 if(card.dataset.gsV13ProvisionalDate&&card.dataset.gsV13ProvisionalDate!==date)clearMorning();
 card.dataset.gsV13ProvisionalDate=date;card.classList.add('gs-v13-morning-hypothesis');
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
 let marker=card.querySelector('[data-gs-v13-note]');if(!marker){marker=doc.createElement('span');marker.dataset.gsV13Note='';marker.className='gs-v13-note';
  const header=card.querySelector('.efficiency-morning-meeting-auto-card__header')||card.querySelector('h3')||card;
  header.append(marker);
 }
 setText(marker,(sourceDate!==date?sourceDate+' 계산분 · ':'')+(item.adjustment?'유기성 추정 계산 · Bio 조정 · 미확정':'유기성 추정 계산 · 미확정'));
 marker.title='계산일 '+sourceDate+' · Storage B 2026-10-24 00:00 재고 19.143t 가정 · 실측 마감값 아님 · 재확인 필요';
 state.morningItem=item;state.morningSourceDate=sourceDate;return true;
}
async function refreshMorning({force=false}={}){
 const date=morningDate(),auth=getToken(),card=root.document?.getElementById(MEETING_ID);
 if(!card)return;
 if(state.morningDate!==date){clearMorning();state.morningDate=date;state.morningCheckAt=0}
 if(!dateAllowed(date)||!auth||morningBlocked(date)||hasOfficialMorning(date)){if(card.dataset.gsV13ProvisionalDate)clearMorning();return;}
 if(state.morningItem&&validItem(state.morningItem,state.morningSourceDate))applyMorning(state.morningItem,date,state.morningSourceDate);
 if(!force&&Date.now()-state.morningCheckAt<60000)return;
 if(state.morningPending===auth+'|'+date)return;
 const key=auth+'|'+date;state.morningPending=key;state.morningCheckAt=Date.now();
 try{
  const dates=date==='2026-10-24'?[date,'2026-10-23']:[date];
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
 const panel=body?.closest('.cfv12-history-panel');if(!body||!panel||panel.hidden)return;
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
.gs-v13-morning-hypothesis .gs-v13-cell-box{background:#fff7db!important;border-radius:6px;box-shadow:inset 0 0 0 1px #f0dd9d}
.gs-v13-morning-hypothesis .gs-v13-cell{color:#8c5a07!important;font-weight:700!important}
.gs-v13-note{display:inline-block;margin-left:6px;padding:2px 6px;background:#fff7db;border:1px solid #eedba5;border-radius:5px;color:#885902;font-size:10px;font-weight:650;line-height:1.4}
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
 const date=morningDate();if(!dateAllowed(date)){if(state.morningDate!==date){clearMorning();state.morningDate=date}}else void refreshMorning();
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
  if(event.detail?.targetDate===morningDate())void refreshMorning({force:true});
  state.historyCheckAt=0;void refreshHistory({force:true});
 });
 root.addEventListener?.('cofiring:closed-history-changed',()=>{clearMorning();state.morningCheckAt=0;state.historyCheckAt=0;schedule()});
 // Bounded polling handles silently updated date selections and completed async reports.
 root.setInterval?.(()=>{if(!root.document.hidden)tick()},2500);schedule();
}
if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot()}
root.CofiringProvisionalV12={buildPayload,request,validItem,sameSaved,applyMorning,decorateHistory,autoSave};
})(typeof globalThis==='object'?globalThis:this);
