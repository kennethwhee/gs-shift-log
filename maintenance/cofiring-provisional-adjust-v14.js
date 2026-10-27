/* GS COFIRING PROVISIONAL ADJUST V14
   Operator-confirmed WHAT-IF adjustment ONLY; never posts official period adjustments.
   Uses the existing tested Bio transfer and max-cofiring math.
*/
(function(root){
'use strict';
if(root.CofiringProvisionalAdjustV14)return;
const ALLOWED=new Set(['2026-10-23','2026-10-24']),FUELS=['coal','bio','organic','manure'],UNITS=['unit1','unit2'];
const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const fmt=x=>num(x)?x.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const adj=()=>root.CofiringPeriodAdjustmentV56;
const scenarioApi=()=>root.CofiringSharedScenarioV7;
const state={active:null,resetPending:false,preview:null,ctx:null,hydratedKey:'',loadingKey:'',dialog:null,focus:null};
function context(){
 const shell=root.document?.querySelector('.cofiring-period-v5'),ctrl=root.__cofiringPeriodV5Controller;
 const date=shell?.querySelector('[data-cfv7-date]')?.value,mode=shell?.querySelector('[data-cfv8-mode]')?.value;
 const spec=ctrl?.getSpec?.(),original=ctrl?.getResult?.(),sourceId=ctrl?.live?.state?.()?.item?.saved?.id;
 const base=scenarioApi()?.project?.(original),h=base?.hypothesisDisplay;
 if(!shell||!ctrl||!ALLOWED.has(date)||mode!=='daily'||!sourceId||!spec||spec.startLocal!==date+'T00:00'||!scenarioApi()?.isScenario?.(h)||
   !UNITS.every(u=>FUELS.every(f=>num(base?.units?.[u]?.[f]?.quantity))))return null;
 const settings=root.CofiringPeriodV5?.readSettings?.(shell);
 if(!settings)return null;
 const key=JSON.stringify([date,sourceId,UNITS.map(u=>FUELS.map(f=>[base.units[u][f].quantity,settings[u]?.[f]?.calorific,settings[u]?.[f]?.coefficient]))]);
 return {shell,ctrl,date,spec,sourceId,original,base,settings,key};
}
function getActive(c){
 const ctx=c&&c.date&&c.sourceId&&c.projected?c:context();
 if(!ctx||!state.active||state.active.key!==(ctx.key||context()?.key))return null;
 return {result:state.active.result,adjustment:state.active.adjustment};
}
function getAdjusted(){const c=context();return c&&state.active?.key===c.key?state.active.result:null;}
function resetRequested(){return state.resetPending;}
function paintSaveStatus(label,error=false){
 // Compact save notice V1: display failures must never interrupt saving.
 try{
  const shell=context()?.shell;if(!shell)return;
  const statusMessage=label,statusTone=error?'error':'info';
  try{
   const presenter=root.GSCofiringSaveNoticeCompactV1?.show;
   if(typeof presenter==='function'){presenter(shell,statusMessage,statusTone);return;}
  }catch(error){root.console?.warn?.('추정 저장 안내 표시 오류:',error);}
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
 }catch(error){root.console?.warn?.('추정 저장 안내를 표시하지 못했습니다:',error);}
}
function onSaved(){
 const hadReset=state.resetPending;state.resetPending=false;
 if(state.active?.key===context()?.key)paintSaveStatus('추정 조정 저장됨 · 미확정');
 else if(hadReset)paintSaveStatus('추정 조정 원복 기록됨 · 미확정');
}
function onSaveError(message){if(state.active?.key===context()?.key||state.resetPending)paintSaveStatus('추정 조정 저장 실패 · '+String(message||'다시 확인 필요'),true);}

function notice(message,bad=false){const n=state.dialog?.querySelector('[data-v14-message]');if(n){n.textContent=message||'';n.dataset.error=bad?'1':'0';}}
const html=`<div class="gsv14-overlay" data-v14-overlay hidden>
 <div class="gsv14-sheet" role="dialog" aria-modal="true" aria-label="추정 혼소조정">
  <div class="gsv14-confirm" data-v14-confirm>
   <h3>추정 계산 확인</h3>
   <p><strong>추정 계산된 유기성 고형연료가 통신 오류로 인해 가계산되었습니다.</strong><br>그래도 혼소조정을 진행하시겠습니까?</p>
   <p class="gsv14-caption">원본 재고는 미확정입니다. 조정 결과도 ‘추정 계산’으로만 저장·표시되며 공식 확정 마감에 반영되지 않습니다.</p>
   <div class="gsv14-actions"><button type="button" data-v14-no>아니오</button><button type="button" data-v14-yes class="gsv14-main">예</button></div>
  </div>
  <div data-v14-editor hidden>
   <div class="gsv14-title"><h3>혼소조정 <span>추정 계산</span></h3><button data-v14-close type="button" aria-label="닫기">×</button></div>
   <p class="gsv14-caption">추정된 유기성 사용량을 포함한 혼소율입니다. 실제 계측값을 확인하기 전에는 공식 마감할 수 없습니다.</p>
   <div class="gsv14-tabs"><button type="button" data-v14-tab="auto" aria-selected="true">최대혼소조정</button><button type="button" data-v14-tab="manual" aria-selected="false">Bio 사용량 이동</button></div>
   <div class="gsv14-control" data-v14-panel="auto"><label>호기당 Bio 최대량 (t/d)<input data-v14-max type="number" min="0.01" max="2000" step="0.01" value="361.4"></label><button type="button" data-v14-auto-preview>최대혼소조정 미리보기</button></div>
   <div class="gsv14-control" data-v14-panel="manual" hidden><label>이동 방향<select data-v14-direction><option value="1">1호기 → 2호기</option><option value="2">2호기 → 1호기</option></select></label><label>Bio 이동량 (t)<input data-v14-transfer type="number" min="0.001" step="0.01" placeholder="이동량 입력"></label><button data-v14-manual-preview type="button">Bio 이동 미리보기</button></div>
   <div class="gsv14-table" data-v14-result></div>
   <p data-v14-message role="status" aria-live="polite"></p>
   <div class="gsv14-actions"><button type="button" data-v14-reset>추정 조정 원복</button><button type="button" data-v14-cancel>취소</button><button type="button" class="gsv14-main" data-v14-apply disabled>추정 조정 적용</button></div>
  </div>
 </div>
</div>`;
const css=`
.gsv14-overlay[hidden]{display:none!important}.gsv14-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(16,32,46,.48);display:flex;align-items:center;justify-content:center;padding:12px}
.gsv14-sheet{background:#fff;color:#213547;width:min(690px,96vw);max-height:90vh;overflow:auto;border-radius:13px;box-shadow:0 18px 60px #14263544;padding:20px;font-size:13px}
.gsv14-sheet h3{margin:0 0 12px;font-size:17px}.gsv14-confirm p{margin:0 0 10px;line-height:1.7}
.gsv14-caption{font-size:12px;color:#826018;background:#fff8e5;border:1px solid #f3de9a;border-radius:7px;padding:9px;line-height:1.5}
.gsv14-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}.gsv14-sheet button{cursor:pointer;border:1px solid #bed0dd;border-radius:7px;background:#fff;color:#253b52;padding:9px 13px;font-weight:600;font:inherit}
.gsv14-sheet button.gsv14-main{background:#087e70;color:#fff;border-color:#087e70}.gsv14-sheet button:disabled{opacity:.45;cursor:default}
.gsv14-title{display:flex;align-items:center;justify-content:space-between}.gsv14-title h3 span{font-size:11px;color:#a16508;background:#fff4d3;border-radius:5px;padding:3px 7px;vertical-align:middle}
.gsv14-tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:12px 0}.gsv14-tabs button[aria-selected="true"]{background:#e8f5f2;border-color:#168e7e;color:#087e70}
.gsv14-control{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin:10px 0}.gsv14-control[hidden]{display:none}.gsv14-control label{font-size:12px;color:#506475;display:flex;flex-direction:column;gap:4px;flex:1;min-width:130px}
.gsv14-control input,.gsv14-control select{width:100%;border:1px solid #c9d6e1;border-radius:7px;padding:9px;font:inherit;color:#263849;background:#fff}
.gsv14-table{border:1px solid #d9e2ea;border-radius:7px;padding:10px;overflow:auto}.gsv14-table table{width:100%;border-collapse:collapse;white-space:nowrap;font-variant-numeric:tabular-nums}.gsv14-table td,.gsv14-table th{border-bottom:1px solid #edf1f4;padding:8px;text-align:right}.gsv14-table th:first-child,.gsv14-table td:first-child{text-align:left}
[data-v14-message]{font-size:12px;color:#087e70;line-height:1.5}[data-v14-message][data-error="1"]{color:#a63520}
`;
function ensure(){
 if(state.dialog||!root.document?.body)return;
 const wrap=root.document.createElement('div');wrap.innerHTML=html;
 const modal=wrap.firstElementChild;root.document.body.append(modal);state.dialog=modal;
 const style=root.document.createElement('style');style.id='gs-cofiring-provisional-adjust-v14-css';style.textContent=css;root.document.head?.append(style);
 const q=s=>modal.querySelector(s);
 function showEditor(){q('[data-v14-confirm]').hidden=true;q('[data-v14-editor]').hidden=false;state.preview=null;renderPreview(null);q('[data-v14-tab="auto"]').focus();}
 q('[data-v14-no]').addEventListener('click',close);
 q('[data-v14-yes]').addEventListener('click',()=>{const ctx=context();if(!ctx||ctx.key!==state.ctx?.key){close();return;}showEditor();});
 q('[data-v14-close]').addEventListener('click',close);q('[data-v14-cancel]').addEventListener('click',close);
 for(const b of modal.querySelectorAll('[data-v14-tab]'))b.addEventListener('click',()=>{
  const name=b.dataset.v14Tab;
  for(const x of modal.querySelectorAll('[data-v14-tab]'))x.setAttribute('aria-selected',String(x.dataset.v14Tab===name));
  for(const x of modal.querySelectorAll('[data-v14-panel]'))x.hidden=x.dataset.v14Panel!==name;
  state.preview=null;renderPreview(null);notice('');
 });
 q('[data-v14-auto-preview]').addEventListener('click',()=>preview(()=>adj().autoMax(state.ctx.base,state.ctx.settings,Number(q('[data-v14-max]').value))));
 q('[data-v14-manual-preview]').addEventListener('click',()=>preview(()=>adj().manualTransfer(state.ctx.base,state.ctx.settings,Number(q('[data-v14-direction]').value),q('[data-v14-transfer]').value)));
 q('[data-v14-apply]').addEventListener('click',apply);
 q('[data-v14-reset]').addEventListener('click',reset);
 modal.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();close();}
  if(e.key==='Tab'){
   const nodes=[...modal.querySelectorAll('button:not([disabled]),input,select')].filter(x=>!x.closest('[hidden]'));
   if(!nodes.length)return;const index=nodes.indexOf(root.document.activeElement);
   if(e.shiftKey&&index===0){e.preventDefault();nodes[nodes.length-1].focus()}
   else if(!e.shiftKey&&index===nodes.length-1){e.preventDefault();nodes[0].focus()}
  }
 });
}
function show(ctx){ensure();if(!state.dialog||!ctx)return;
 state.ctx=ctx;state.preview=null;state.focus=root.document.activeElement;
 state.dialog.hidden=false;state.dialog.querySelector('[data-v14-confirm]').hidden=false;state.dialog.querySelector('[data-v14-editor]').hidden=true;
 state.dialog.querySelector('[data-v14-no]').focus();
}
function close(){if(!state.dialog)return;state.dialog.hidden=true;state.ctx=null;state.preview=null;if(state.focus?.isConnected)state.focus.focus();}
function preview(fn){const c=context();if(!c||state.ctx?.key!==c.key){close();return;}
 try{const r=fn();state.preview=r?.ok?r:null;renderPreview(r);notice(r?.ok?'원본 대비 조정 미리보기입니다. [추정 조정 적용]을 눌러야 반영됩니다.':r?.message||'미리보기 실패',!r?.ok)}catch(e){state.preview=null;renderPreview(null);notice(e?.message||'조정값을 확인해 주세요.',true)}
}
function renderPreview(r){const host=state.dialog?.querySelector('[data-v14-result]');if(!host)return;
 const c=state.ctx,base=c?.base,result=r?.ok?r.result:(getActive(c)?.result||base);
 if(!base||!result)return;
 const tbl=root.document.createElement('table'),head=root.document.createElement('tr');
 ['호기','Coal (t)','Bio (t)','바이오 혼소율','유기성 혼소율','종합혼소율'].forEach(label=>{const th=root.document.createElement('th');th.textContent=label;head.append(th)});
 tbl.append(head);
 for(const [u,label] of [['unit1','1호기'],['unit2','2호기']]){
  const row=root.document.createElement('tr'),x=result.units[u];
  [label,fmt(x.coal.quantity),fmt(x.bio.quantity),fmt(x.fuelRatios.bio)+'%',fmt(x.fuelRatios.organicGroup)+'%',fmt(x.fuelRatios.total)+'%'].forEach(value=>{const td=root.document.createElement('td');td.textContent=value;row.append(td)});
  tbl.append(row);
 }
 host.replaceChildren(tbl);
 state.dialog.querySelector('[data-v14-apply]').disabled=!r?.ok;
}
function adjustmentPayload(r){const m=r.adjustment||{},mode=m.mode;
 if(!['max_auto','manual_transfer'].includes(mode))throw Error('최대혼소조정 또는 Bio 사용량 이동만 허용합니다.');
 return {mode,finalBioUnit1:r.result.units.unit1.bio.quantity,finalBioUnit2:r.result.units.unit2.bio.quantity,
  fromUnit:m.fromUnit===1||m.fromUnit===2?m.fromUnit:null,
  bioTransferTons:Number(m.bioTransferTons)||0,maxBioTpd:mode==='max_auto'?Number(m.maxBioTpd):null};
}
function apply(){const c=context(),r=state.preview;if(!c||c.key!==state.ctx?.key||!r?.ok){notice('계산 결과가 변경되었습니다. 다시 열어 주세요.',true);return;}
 const adjustment=adjustmentPayload(r),next={key:c.key,result:r.result,adjustment};
 if(c.ctrl.applyProvisionalAdjustment?.(r.result)!==true){notice('추정 조정 표시 기능이 준비되지 않았습니다. 새로고침 후 다시 시도해 주세요.',true);return;}
 state.active=next;state.resetPending=false;state.hydratedKey=c.key;
 paintSaveStatus('추정 조정 저장 확인 중 · 공식 마감 아님');
 close();root.CofiringProvisionalV12?.autoSave?.();
 root.setTimeout?.(()=>root.CofiringProvisionalV12?.autoSave?.(),1700);
}
function reset(){const c=context();if(!c||state.ctx?.key!==c.key){close();return;}
 state.active=null;state.resetPending=true;state.hydratedKey=c.key;
 paintSaveStatus('추정 조정 원복 저장 확인 중');
 c.ctrl.applyProvisionalAdjustment?.(c.base);close();root.CofiringProvisionalV12?.autoSave?.();
 root.setTimeout?.(()=>root.CofiringProvisionalV12?.autoSave?.(),1700);
}
async function maybeHydrate(c){
 if(!c||state.active?.key===c.key||state.resetPending||state.hydratedKey===c.key||state.loadingKey===c.key)return;
 state.loadingKey=c.key;
 try{const item=(await root.CofiringProvisionalV12?.request?.('?targetDate='+encodeURIComponent(c.date)))?.item;
  if(state.loadingKey!==c.key||context()?.key!==c.key)return;
  state.hydratedKey=c.key;
  const m=item?.adjustment;
  if(item?.sourceRequestId!==c.sourceId||!m||!['max_auto','manual_transfer'].includes(m.mode))return;
  const r=adj()?.adjustFinal?.(c.base,c.settings,m.finalBioUnit1,m.finalBioUnit2,
    {mode:m.mode,fromUnit:m.fromUnit,bioTransferTons:m.bioTransferTons,maxBioTpd:m.maxBioTpd});
  if(!r?.ok)return;
  state.active={key:c.key,result:r.result,adjustment:m};
  c.ctrl.applyProvisionalAdjustment?.(r.result);paintSaveStatus('추정 조정 복원 · 미확정');
 }catch(_){}finally{if(state.loadingKey===c.key)state.loadingKey='';}
}
function refreshButton(){
 const c=context(),button=c?.shell?.querySelector('[data-cfv56-adjust]');
 if(!c)return;
 if(button&&button.disabled)button.disabled=false;
 void maybeHydrate(c);
}
function captured(event){const button=event.target?.closest?.('[data-cfv56-adjust]');if(!button)return;
 const c=context();if(!c||!c.shell.contains(button))return;
 event.preventDefault();event.stopImmediatePropagation();show(c);
}
function boot(){root.document.addEventListener('click',captured,true);
 // Original calculation may repaint and disable the button; restore only for a verified WHAT-IF.
 const observer=root.MutationObserver&&new root.MutationObserver(changes=>{
  if(changes.some(m=>m.attributeName==='disabled'||m.type==='childList'))refreshButton();
 });
 observer?.observe(root.document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
 root.setInterval?.(()=>{if(!root.document.hidden)refreshButton()},1400);refreshButton();
}
if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot()}
root.CofiringProvisionalAdjustV14={getActive,resetRequested,onSaved,onSaveError,getAdjusted,context,adjustmentPayload,refreshButton};
})(typeof globalThis==='object'?globalThis:this);
