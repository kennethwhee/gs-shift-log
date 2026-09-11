(function(root){
  'use strict';
  const STORAGE_PREFIX='gspo:cofiring-period-adjust:v56:';
  const MAX_SETTING_KEY='gspo:cofiring-period-max-bio-tpd:v56';
  const DEFAULT_MAX_TPD=361.74;
  const UNITS=['unit1','unit2'];
  const round=(v,p=2)=>{const n=Number(v),m=10**p;return Number.isFinite(n)?Math.round((n+Number.EPSILON)*m)/m:null;};
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const fmt=(v,p=2)=>finite(v)?v.toLocaleString('ko-KR',{minimumFractionDigits:p,maximumFractionDigits:p}):'—';
  const pct=v=>finite(v)?v.toFixed(2)+'%':'—';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function periodCap(maxTpd,durationHours){const n=Number(maxTpd),h=Number(durationHours);return Number.isFinite(n)&&n>0&&Number.isFinite(h)&&h>0?round(n*h/24,3):null;}
  function fingerprint(base,spec){const a=base?.units?.unit1,b=base?.units?.unit2;return JSON.stringify([spec?.startLocal,spec?.endLocal,round(a?.coal?.quantity,6),round(a?.bio?.quantity,6),round(b?.coal?.quantity,6),round(b?.bio?.quantity,6)]);}
  function recalcUnit(unit,settings,durationHours){
    if(!unit)return null;const h=unit.heats||(unit.heats={});const cals=settings||{};
    const coal=unit.coal?.quantity,bio=unit.bio?.quantity,organic=unit.organic?.quantity,manure=unit.manure?.quantity;
    const coalHv=Number(cals.coal?.calorific),bioHv=Number(cals.bio?.calorific),orgHv=Number(cals.organic?.calorific),manHv=Number(cals.manure?.calorific);
    if(![coal,bio,organic,manure,coalHv,bioHv,orgHv,manHv].every(Number.isFinite))return null;
    h.coal=coal*coalHv/1000;h.bio=bio*bioHv/1000;h.organic=organic*orgHv/1000;h.manure=manure*manHv/1000;h.total=h.coal+h.bio+h.organic+h.manure;
    const bioRatio=h.total>0?h.bio/h.total*100:null,orgRatio=h.total>0?h.organic/h.total*100:null,manRatio=h.total>0?h.manure/h.total*100:null;
    unit.ratios={bio:bioRatio,organic:orgRatio,total:h.total>0?(h.bio+h.organic+h.manure)/h.total*100:null};
    unit.fuelRatios={bio:bioRatio,organic:orgRatio,manure:manRatio,organicGroup:h.total>0?(h.organic+h.manure)/h.total*100:null,total:unit.ratios.total};
    if(unit.coal)unit.coal.averageTonPerHour=durationHours>0?unit.coal.quantity/durationHours:null;
    if(unit.bio)unit.bio.averageTonPerHour=durationHours>0?unit.bio.quantity/durationHours:null;
    return unit;
  }
  function recalcCombined(result){
    const one=result?.units?.unit1,two=result?.units?.unit2;if(!one||!two)return result;
    const heats={};for(const f of ['coal','bio','organic','manure','total'])heats[f]=(Number(one.heats?.[f])||0)+(Number(two.heats?.[f])||0);
    const total=heats.total;const ratios={bio:total>0?heats.bio/total*100:null,organic:total>0?heats.organic/total*100:null,total:total>0?(heats.bio+heats.organic+heats.manure)/total*100:null};
    result.combined={heats,ratios,fuelRatios:{bio:ratios.bio,organic:ratios.organic,manure:total>0?heats.manure/total*100:null,organicGroup:total>0?(heats.organic+heats.manure)/total*100:null,total:ratios.total}};return result;
  }
  function adjustFinal(base,settings,finalOne,finalTwo,meta={}){
    if(!base?.units?.unit1||!base?.units?.unit2)return {ok:false,message:'먼저 기간 계산을 완료해 주세요.'};
    const b1=Number(base.units.unit1.bio?.quantity),b2=Number(base.units.unit2.bio?.quantity),f1=Number(finalOne),f2=Number(finalTwo);
    if(![b1,b2,f1,f2].every(Number.isFinite)||f1<0||f2<0)return {ok:false,message:'최종 Bio 사용량을 0 이상으로 확인해 주세요.'};
    if(f1+f2>b1+b2+0.011)return {ok:false,message:'최종 Bio 합계는 실제 Bio 사용량 합계를 초과할 수 없습니다.'};
    const result=clone(base),hours=Number(result.period?.durationHours)||Number(meta.durationHours)||0,deltas={};
    for(const [unit,finalBio] of [['unit1',f1],['unit2',f2]]){
      const u=result.units[unit],raw=base.units[unit],s=settings?.[unit];const coalHv=Number(s?.coal?.calorific),bioHv=Number(s?.bio?.calorific);
      if(!Number.isFinite(coalHv)||coalHv<=0||!Number.isFinite(bioHv)||bioHv<=0)return {ok:false,message:'Coal/Bio 발열량을 확인해 주세요.'};
      const bioDelta=Number(raw.bio.quantity)-finalBio,coalDelta=bioDelta*bioHv/coalHv,finalCoal=Number(raw.coal.quantity)+coalDelta;
      if(!Number.isFinite(finalCoal)||finalCoal<0)return {ok:false,message:'조정 후 Coal 사용량이 0 미만이 됩니다.'};
      u.bio.quantity=round(finalBio,6);u.coal.quantity=round(finalCoal,6);deltas[unit]={bioDelta,coalDelta};
      if(!recalcUnit(u,s,hours))return {ok:false,message:'조정 후 열량/혼소율을 계산하지 못했습니다.'};
    }
    recalcCombined(result);
    result.adjustment={mode:meta.mode||'manual_final',fromUnit:meta.fromUnit||null,bioTransferTons:round(meta.bioTransferTons||0,3),maxBioTpd:finite(meta.maxBioTpd)?meta.maxBioTpd:null,periodCapTons:finite(meta.periodCapTons)?meta.periodCapTons:null,excludedBioTons:round(Math.max(0,b1+b2-f1-f2),3),deltas,applied:true};
    return {ok:true,result,adjustment:result.adjustment};
  }
  function manualTransfer(base,settings,fromUnit,tons){const t=Number(tons),dir=Number(fromUnit)===2?2:1,b1=Number(base?.units?.unit1?.bio?.quantity),b2=Number(base?.units?.unit2?.bio?.quantity);if(!Number.isFinite(t)||t<=0)return {ok:false,message:'Bio 이동량을 0보다 크게 입력해 주세요.'};if(![b1,b2].every(Number.isFinite))return {ok:false,message:'먼저 기간 계산을 완료해 주세요.'};const source=dir===1?b1:b2;if(t>source+1e-9)return {ok:false,message:`${dir}호기 Bio 사용량보다 많이 이동할 수 없습니다.`};return adjustFinal(base,settings,dir===1?b1-t:b1+t,dir===1?b2+t:b2-t,{mode:'manual_transfer',fromUnit:dir,bioTransferTons:t});}
  function autoMax(base,settings,maxTpd){
    const hours=Number(base?.period?.durationHours),cap=periodCap(maxTpd,hours),b1=Number(base?.units?.unit1?.bio?.quantity),b2=Number(base?.units?.unit2?.bio?.quantity);if(!Number.isFinite(cap)||cap<=0)return {ok:false,message:'호기당 Bio 최대량(t/d)을 확인해 주세요.'};if(![b1,b2].every(Number.isFinite))return {ok:false,message:'먼저 기간 계산을 완료해 주세요.'};
    let f1=Math.min(b1,cap),f2=Math.min(b2,cap),ex1=Math.max(0,b1-f1),ex2=Math.max(0,b2-f2),c1=Math.max(0,cap-f1),c2=Math.max(0,cap-f2);
    const move12=Math.min(ex1,c2);f2+=move12;ex1-=move12;c2-=move12;
    const move21=Math.min(ex2,c1);f1+=move21;ex2-=move21;c1-=move21;
    if(Math.abs(f1-b1)<1e-9&&Math.abs(f2-b2)<1e-9)return {ok:false,message:`현재 1·2호기 Bio 사용량이 선택기간 환산 최대 ${fmt(cap,2)} t 이하입니다.`};
    return adjustFinal(base,settings,f1,f2,{mode:'max_auto',maxBioTpd:Number(maxTpd),periodCapTons:cap,fromUnit:move12>0?1:move21>0?2:null,bioTransferTons:move12+move21,excludedBioTons:ex1+ex2});
  }
  function storageKey(spec){return STORAGE_PREFIX+encodeURIComponent(`${spec.startLocal}|${spec.endLocal}`);}
  function readStored(spec,base){try{const raw=root.localStorage?.getItem(storageKey(spec));if(!raw)return null;const data=JSON.parse(raw);if(data.fingerprint!==fingerprint(base,spec))return null;return data;}catch(_){return null;}}
  function saveStored(spec,base,adjustment){try{root.localStorage?.setItem(storageKey(spec),JSON.stringify({fingerprint:fingerprint(base,spec),finalBioUnit1:adjustment.result.units.unit1.bio.quantity,finalBioUnit2:adjustment.result.units.unit2.bio.quantity,meta:adjustment.adjustment,at:new Date().toISOString()}));}catch(_){} }
  function clearStored(spec){try{root.localStorage?.removeItem(storageKey(spec));}catch(_){} }
  function storedMax(){try{const n=Number(root.localStorage?.getItem(MAX_SETTING_KEY));return Number.isFinite(n)&&n>0?n:DEFAULT_MAX_TPD;}catch(_){return DEFAULT_MAX_TPD;}}
  const API='/api/cofiring-period-adjustments';
  const requestId=()=>typeof root.crypto?.randomUUID==='function'?root.crypto.randomUUID():('00000000-0000-4000-8000-'+String(Date.now()).padStart(12,'0').slice(-12));
  async function loadBundle(spec,getHeaders){
    const ctrl=typeof root.AbortController==='function'?new root.AbortController():null;
    const timer=root.setTimeout?.(()=>ctrl?.abort(),10000);
    try{const q=new URLSearchParams({start:spec.startLocal,end:spec.endLocal}),r=await root.fetch(API+'?'+q.toString(),{headers:getHeaders?.()||{},cache:'no-store',credentials:'same-origin',...(ctrl?{signal:ctrl.signal}:{})}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'조회 실패');return {loaded:true,adjustment:p.adjustment||null,revision:Number(p.revision)||0,setting:{maxBioTpd:Number(p.setting?.maxBioTpd)||storedMax()}};}catch(e){return {loaded:false,error:e.name==='AbortError'?'저장 상태 확인 시간이 초과됐습니다. 창을 닫고 다시 시도해 주세요.':e.message,adjustment:null,revision:0,setting:{maxBioTpd:storedMax()}};}finally{root.clearTimeout?.(timer);}
  }
  async function saveSharedMax(value,getHeaders){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>2000)throw new Error('호기당 Bio 최대량을 확인해 주세요.');try{root.localStorage?.setItem(MAX_SETTING_KEY,String(n));}catch(_){}try{const r=await root.fetch(API,{method:'POST',headers:{...(getHeaders?.()||{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},cache:'no-store',credentials:'same-origin',body:JSON.stringify({action:'save_setting',maxBioTpd:n})}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'설정 저장 실패');return {shared:true,value:Number(p?.setting?.maxBioTpd)||n};}catch(_){return {shared:false,value:n};}}
  async function saveServerAdjustment(spec,adjustment,expectedRevision,getHeaders){const body={action:'save',start:spec.startLocal,end:spec.endLocal,adjustment:{mode:adjustment.adjustment.mode,fromUnit:adjustment.adjustment.fromUnit,bioTransferTons:adjustment.adjustment.bioTransferTons,finalBioUnit1:adjustment.result.units.unit1.bio.quantity,finalBioUnit2:adjustment.result.units.unit2.bio.quantity,maxBioTpd:adjustment.adjustment.maxBioTpd,excludedBioTons:adjustment.adjustment.excludedBioTons,note:''},expectedRevision,requestId:requestId()};const r=await root.fetch(API,{method:'POST',headers:{...(getHeaders?.()||{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},cache:'no-store',credentials:'same-origin',body:JSON.stringify(body)}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'혼소 조정 저장 실패');return p;}
  async function clearServerAdjustment(spec,expectedRevision,getHeaders){const r=await root.fetch(API,{method:'POST',headers:{...(getHeaders?.()||{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},cache:'no-store',credentials:'same-origin',body:JSON.stringify({action:'clear',start:spec.startLocal,end:spec.endLocal,expectedRevision,requestId:requestId()})}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'혼소 조정 원복 저장 실패');return p;}
  function resolveStored(base,settings,spec){const saved=readStored(spec,base);if(!saved)return null;const r=adjustFinal(base,settings,saved.finalBioUnit1,saved.finalBioUnit2,saved.meta||{});return r.ok?r:null;}
  function ratioBio(unit){const c=unit?.heats?.coal,b=unit?.heats?.bio,t=Number(c)+Number(b);return Number.isFinite(t)&&t>0?Number(b)/t*100:null;}
  function modalHtml(){return `<div class="cfv56-adjust-modal" data-cfv56-adjust-modal hidden aria-hidden="true"><div class="cfv56-adjust-dialog" role="dialog" aria-modal="true" aria-label="혼소 조정"><header><div><span>CO-FIRING ADJUSTMENT</span><h3>혼소 조정</h3><p>Bio 이동과 최대혼소 조정 결과를 적용 전에 확인합니다.</p></div><button type="button" data-cfv56-close aria-label="닫기">×</button></header><div class="cfv56-adjust-body"><div class="cfv56-adjust-top"><strong data-cfv56-period>—</strong><label>호기당 Bio 최대량<input data-cfv56-max type="number" min="0.01" max="2000" step="0.01"><span>t/d</span></label><button type="button" data-cfv56-save-max>설정 저장</button></div><p class="cfv56-cap-note" data-cfv56-cap>—</p><section><h4>수동 이동 <small>호기 간 Bio 배분</small></h4><div class="cfv56-dir"><button type="button" class="is-selected" aria-pressed="true" data-cfv56-dir="1">1호기 → 2호기</button><button type="button" aria-pressed="false" data-cfv56-dir="2">2호기 → 1호기</button></div><label class="cfv56-transfer">Bio 이동량<input data-cfv56-transfer type="number" min="0" step="0.01"><span>t / 선택기간</span><button type="button" data-cfv56-preview-transfer>미리보기</button></label></section><section class="cfv56-auto"><div><h4>최대혼소 자동 조정</h4><p>일 최대량을 선택기간으로 환산해 초과분을 반대 호기로 이동합니다. 양쪽이 초과하면 최대량에 맞춰 조정합니다.</p></div><button type="button" data-cfv56-auto>최대혼소 조정</button></section><p class="cfv56-adjust-msg" data-cfv56-msg role="status" aria-live="polite"></p><section><div class="cfv56-final-head"><h4>최종 조정값</h4><button type="button" data-cfv56-edit>수정</button></div><div class="cfv56-final-scroll"><table><thead><tr><th>호기</th><th>Coal (t)</th><th>Bio (t)</th><th>바이오 혼소율</th><th>유기성 및 축분 혼소율</th><th>종합혼소율</th></tr></thead><tbody data-cfv56-final></tbody></table></div><div class="cfv56-final-edit" data-cfv56-final-edit hidden><label>1호기 최종 Bio (t)<input data-cfv56-final1 type="number" min="0" step="0.01"></label><label>2호기 최종 Bio (t)<input data-cfv56-final2 type="number" min="0" step="0.01"></label><button type="button" data-cfv56-preview-final>직접수정 미리보기</button></div><p class="cfv56-formula">Coal 자동 보정 = (실제 Bio − 최종 Bio) × Bio 발열량 ÷ Coal 발열량</p><p class="cfv56-formula">바이오: Coal+Bio 열량 기준 · 유기성 및 축분 / 종합: 전체 투입열량 기준</p></section></div><footer><button type="button" data-cfv56-reset>원복</button><span></span><button type="button" data-cfv56-cancel>취소</button><button type="button" class="primary" data-cfv56-apply>적용</button></footer></div></div>`;}
  function create(options){
    const container=options.container;if(!container)return null;
    const wrap=root.document.createElement('div');wrap.innerHTML=modalHtml();const modal=wrap.firstElementChild;root.document.body.appendChild(modal);
    let serverRevision=0,direction=1,preview=null,base=null,settings=null,spec=null,epoch=0,ready=false,busy=false,disposed=false,returnFocus=null,contextSignature='';
    const q=s=>modal.querySelector(s),msg=(text,bad=false)=>{const e=q('[data-cfv56-msg]');e.textContent=text||'';e.dataset.bad=bad?'1':'0';};
    const signature=ctx=>JSON.stringify([ctx?.spec,ctx?.settings,ctx?.result?.units]);
    const currentContext=()=>{try{return options.getContext?.()?.result===base&&signature(options.getContext?.())===contextSignature;}catch(_){return false;}};
    function controls(){
      for(const e of modal.querySelectorAll('.cfv56-adjust-body input,.cfv56-adjust-body button,[data-cfv56-reset]'))e.disabled=!ready||busy;
      q('[data-cfv56-apply]').disabled=!ready||busy||!preview?.ok;
      for(const sel of ['[data-cfv56-close]','[data-cfv56-cancel]'])q(sel).disabled=busy;
      modal.setAttribute('aria-busy',(!ready||busy)?'true':'false');
    }
    function render(r){const result=r?.result||base;if(!result)return;
      q('[data-cfv56-final]').innerHTML=UNITS.map((u,i)=>{const x=result.units[u];return `<tr><th>${i+1}호기</th><td data-label="Coal (t)">${fmt(x.coal.quantity)}</td><td data-label="Bio (t)">${fmt(x.bio.quantity)}</td><td data-label="바이오 혼소율">${pct(ratioBio(x))}</td><td data-label="유기성 및 축분 혼소율">${pct(x.fuelRatios?.organicGroup)}</td><td data-label="종합혼소율">${pct(x.fuelRatios?.total)}</td></tr>`;}).join('');
      q('[data-cfv56-final1]').value=String(round(result.units.unit1.bio.quantity,2));q('[data-cfv56-final2]').value=String(round(result.units.unit2.bio.quantity,2));controls();
    }
    function cap(){q('[data-cfv56-cap]').textContent=`선택기간 ${base.period.durationHours.toFixed(2)}시간 환산 최대: 호기당 ${fmt(periodCap(Number(q('[data-cfv56-max]').value),base.period.durationHours),2)} t`;}
    async function open(){
      if(busy||disposed)return;const ctx=options.getContext?.();base=ctx?.result;settings=ctx?.settings;spec=ctx?.spec;
      if(!base||!settings||!spec){options.onMessage?.('먼저 기간 계산을 완료해 주세요.');return;}
      const token=++epoch;contextSignature=signature(ctx);preview=resolveStored(base,settings,spec);ready=false;direction=1;
      q('[data-cfv56-transfer]').value='';q('[data-cfv56-final-edit]').hidden=true;
      for(const b of modal.querySelectorAll('[data-cfv56-dir]')){const selected=b.dataset.cfv56Dir==='1';b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));}
      q('[data-cfv56-period]').textContent=`${spec.startLocal.replace('T',' ')} ~ ${spec.endLocal.replace('T',' ')}`;
      q('[data-cfv56-max]').value=String(storedMax());cap();render(preview);msg('저장된 조정값을 확인하고 있습니다.');returnFocus=root.document.activeElement;modal.hidden=false;modal.setAttribute('aria-hidden','false');q('[data-cfv56-close]').focus();
      const bundle=await loadBundle(spec,options.getHeaders);
      if(disposed||token!==epoch||modal.hidden)return;
      if(!currentContext()){msg('계산값이 변경되었습니다. 창을 닫고 다시 열어 주세요.',true);return;}
      if(bundle.loaded===false){msg(bundle.error||'저장 상태를 확인하지 못했습니다. 창을 닫고 다시 시도해 주세요.',true);return;}
      serverRevision=bundle.revision||0;preview=null;
      if(bundle.adjustment){const saved=bundle.adjustment,r=adjustFinal(base,settings,saved.finalBioUnit1,saved.finalBioUnit2,saved);if(r.ok)preview=r;}
      // A successful server read is authoritative, including a cleared adjustment.
      if(!bundle.adjustment)clearStored(spec);
      ready=true;q('[data-cfv56-max]').value=String(Number(bundle.setting?.maxBioTpd)||storedMax());cap();render(preview);
      msg(preview?'저장된 조정값입니다. 변경 후 미리보기를 확인하고 적용하세요.':'조정 전 계산값입니다. 이동 또는 자동 조정으로 미리보기를 만드세요.');
    }
    function close(){if(busy)return;++epoch;modal.hidden=true;modal.setAttribute('aria-hidden','true');if(returnFocus?.isConnected)returnFocus.focus();}
    function validAction(){if(!ready||busy)return false;if(!currentContext()){ready=false;controls();msg('계산값이 변경되었습니다. 창을 닫고 다시 열어 주세요.',true);return false;}return true;}
    function showPreview(r,success){preview=r;render(preview);msg(preview.ok?success:preview.message,!preview.ok);}
    for(const b of modal.querySelectorAll('[data-cfv56-dir]'))b.addEventListener('click',()=>{if(!validAction())return;direction=Number(b.dataset.cfv56Dir);for(const x of modal.querySelectorAll('[data-cfv56-dir]')){x.classList.toggle('is-selected',x===b);x.setAttribute('aria-pressed',String(x===b));}preview=null;render(null);msg('선택한 방향의 이동량을 입력하고 미리보기를 눌러 주세요.');});
    for(const el of modal.querySelectorAll('[data-cfv56-transfer],[data-cfv56-max],[data-cfv56-final1],[data-cfv56-final2]'))el.addEventListener('input',()=>{if(el.hasAttribute('data-cfv56-max'))cap();preview=null;controls();msg('입력값이 변경되었습니다. 미리보기 또는 최대혼소 조정을 다시 실행하세요.');});
    q('[data-cfv56-save-max]').addEventListener('click',async()=>{if(!validAction())return;busy=true;controls();try{const saved=await saveSharedMax(Number(q('[data-cfv56-max]').value),options.getHeaders);cap();msg(saved.shared?'Bio 최대량을 공용 설정으로 저장했습니다.':'서버 저장을 확인하지 못해 이 브라우저에만 저장했습니다.',!saved.shared);}catch(e){msg(e.message,true);}finally{busy=false;controls();}});
    q('[data-cfv56-preview-transfer]').addEventListener('click',()=>{if(validAction())showPreview(manualTransfer(base,settings,direction,q('[data-cfv56-transfer]').value),'수동 이동 미리보기입니다. 적용하면 계산 화면에 반영됩니다.');});
    q('[data-cfv56-auto]').addEventListener('click',()=>{if(!validAction())return;const r=autoMax(base,settings,Number(q('[data-cfv56-max]').value));showPreview(r,r.ok&&r.adjustment.excludedBioTons>0?`최대량 초과 ${fmt(r.adjustment.excludedBioTons)} t를 혼소 계산에서 제외하는 미리보기입니다.`:'최대혼소 자동 조정 미리보기입니다.');});
    q('[data-cfv56-edit]').addEventListener('click',()=>{if(!validAction())return;const e=q('[data-cfv56-final-edit]');e.hidden=!e.hidden;if(!e.hidden)q('[data-cfv56-final1]').focus();});
    q('[data-cfv56-preview-final]').addEventListener('click',()=>{if(!validAction())return;const v1=q('[data-cfv56-final1]').value,v2=q('[data-cfv56-final2]').value;if(v1.trim()===''||v2.trim()===''){preview=null;controls();msg('두 호기의 최종 Bio를 모두 입력해 주세요. 사용량이 없으면 0을 입력하세요.',true);return;}showPreview(adjustFinal(base,settings,Number(v1),Number(v2),{mode:'manual_final'}),'최종 Bio 직접수정 미리보기입니다.');});
    q('[data-cfv56-apply]').addEventListener('click',async()=>{if(!validAction()||!preview?.ok)return;busy=true;controls();try{msg('혼소 조정값을 저장하고 있습니다.');const saved=await saveServerAdjustment(spec,preview,serverRevision,options.getHeaders);serverRevision=Number(saved?.entry?.revision)||serverRevision+1;saveStored(spec,base,preview);options.onApply?.(preview.result,preview.adjustment);busy=false;close();}catch(e){msg(e.message||'혼소 조정 저장을 완료하지 못했습니다.',true);}finally{busy=false;controls();}});
    q('[data-cfv56-reset]').addEventListener('click',async()=>{if(!validAction())return;busy=true;controls();try{await clearServerAdjustment(spec,serverRevision,options.getHeaders);serverRevision+=1;clearStored(spec);preview=null;options.onReset?.();busy=false;close();}catch(e){msg(e.message||'원복을 저장하지 못했습니다. 기존 조정값을 유지합니다.',true);}finally{busy=false;controls();}});
    for(const sel of ['[data-cfv56-close]','[data-cfv56-cancel]'])q(sel).addEventListener('click',close);
    modal.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=Array.from(modal.querySelectorAll('button:not(:disabled),input:not(:disabled)')).filter(x=>!x.closest('[hidden]'));if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&root.document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&root.document.activeElement===last){e.preventDefault();first.focus();}}});
    return {open,close,resolve:(result,currentSettings,currentSpec)=>resolveStored(result,currentSettings,currentSpec),clear:()=>spec&&clearStored(spec),dispose(){disposed=true;++epoch;modal.remove();}};
  }
  root.CofiringPeriodAdjustmentV56={periodCap,adjustFinal,manualTransfer,autoMax,resolveStored,create,modalHtml,DEFAULT_MAX_TPD,API};
  if(typeof module==='object'&&module.exports)module.exports=root.CofiringPeriodAdjustmentV56;
})(typeof globalThis==='object'?globalThis:this);
