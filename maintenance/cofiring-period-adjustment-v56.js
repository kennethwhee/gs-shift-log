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
  async function loadBundle(spec,getHeaders){const fallback={adjustment:null,revision:0,setting:{maxBioTpd:storedMax()}};try{const q=new URLSearchParams({start:spec.startLocal,end:spec.endLocal}),r=await root.fetch(API+'?'+q.toString(),{headers:getHeaders?.()||{},cache:'no-store',credentials:'same-origin'}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'조회 실패');return {adjustment:p.adjustment||null,revision:Number(p.revision)||0,setting:{maxBioTpd:Number(p.setting?.maxBioTpd)||storedMax()}};}catch(_){return fallback;}}
  async function saveSharedMax(value,getHeaders){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>2000)throw new Error('호기당 Bio 최대량을 확인해 주세요.');try{root.localStorage?.setItem(MAX_SETTING_KEY,String(n));}catch(_){}try{const r=await root.fetch(API,{method:'POST',headers:{...(getHeaders?.()||{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},cache:'no-store',credentials:'same-origin',body:JSON.stringify({action:'save_setting',maxBioTpd:n})}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'설정 저장 실패');return {shared:true,value:Number(p?.setting?.maxBioTpd)||n};}catch(_){return {shared:false,value:n};}}
  async function saveServerAdjustment(spec,adjustment,expectedRevision,getHeaders){const body={action:'save',start:spec.startLocal,end:spec.endLocal,adjustment:{mode:adjustment.adjustment.mode,fromUnit:adjustment.adjustment.fromUnit,bioTransferTons:adjustment.adjustment.bioTransferTons,finalBioUnit1:adjustment.result.units.unit1.bio.quantity,finalBioUnit2:adjustment.result.units.unit2.bio.quantity,maxBioTpd:adjustment.adjustment.maxBioTpd,excludedBioTons:adjustment.adjustment.excludedBioTons,note:''},expectedRevision,requestId:requestId()};const r=await root.fetch(API,{method:'POST',headers:{...(getHeaders?.()||{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},cache:'no-store',credentials:'same-origin',body:JSON.stringify(body)}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'혼소 조정 저장 실패');return p;}
  async function clearServerAdjustment(spec,expectedRevision,getHeaders){const r=await root.fetch(API,{method:'POST',headers:{...(getHeaders?.()||{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},cache:'no-store',credentials:'same-origin',body:JSON.stringify({action:'clear',start:spec.startLocal,end:spec.endLocal,expectedRevision,requestId:requestId()})}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'혼소 조정 원복 저장 실패');return p;}
  function resolveStored(base,settings,spec){const saved=readStored(spec,base);if(!saved)return null;const r=adjustFinal(base,settings,saved.finalBioUnit1,saved.finalBioUnit2,saved.meta||{});return r.ok?r:null;}
  function ratioBio(unit){const c=unit?.heats?.coal,b=unit?.heats?.bio,t=Number(c)+Number(b);return Number.isFinite(t)&&t>0?Number(b)/t*100:null;}
  function modalHtml(){return `<div class="cfv56-adjust-modal" data-cfv56-adjust-modal hidden aria-hidden="true"><div class="cfv56-adjust-dialog" role="dialog" aria-modal="true" aria-label="혼소 조정"><header><div><span>CO-FIRING ADJUSTMENT</span><h3>혼소 조정</h3><p>수동 이동, 최대혼소 자동 조정, 최종 Bio 수정을 선택기간 결과에 적용합니다.</p></div><button type="button" data-cfv56-close aria-label="닫기">×</button></header><div class="cfv56-adjust-body"><div class="cfv56-adjust-top"><strong data-cfv56-period>—</strong><label>호기당 Bio 최대량<input data-cfv56-max type="number" min="0.01" max="2000" step="0.01"><span>t/d</span></label><button data-cfv56-save-max>설정 저장</button></div><p class="cfv56-cap-note" data-cfv56-cap>—</p><section><h4>수동 이동 <small>현재 혼수 이동 기능</small></h4><div class="cfv56-dir"><button class="is-selected" data-cfv56-dir="1">1호기 → 2호기</button><button data-cfv56-dir="2">2호기 → 1호기</button></div><label class="cfv56-transfer">Bio 이동량<input data-cfv56-transfer type="number" min="0" step="0.01"><span>t / 선택기간</span><button data-cfv56-preview-transfer>미리보기</button></label></section><section class="cfv56-auto"><div><h4>최대혼소 자동 조정</h4><p>호기당 일 최대량을 선택기간으로 환산해 초과분을 반대 호기로 우선 이동하고, 양쪽이 초과하면 최대 범위 안에서 결정적으로 조정합니다.</p></div><button data-cfv56-auto>최대혼소 조정</button></section><p class="cfv56-adjust-msg" data-cfv56-msg></p><section><div class="cfv56-final-head"><h4>최종 조정값</h4><button data-cfv56-edit>수정</button></div><table><thead><tr><th>호기</th><th>Coal</th><th>Bio</th><th>Bio 혼소율</th><th>종합 혼소율</th></tr></thead><tbody data-cfv56-final></tbody></table><div class="cfv56-final-edit" data-cfv56-final-edit hidden><label>1호기 최종 Bio<input data-cfv56-final1 type="number" min="0" step="0.01"></label><label>2호기 최종 Bio<input data-cfv56-final2 type="number" min="0" step="0.01"></label><button data-cfv56-preview-final>직접수정 미리보기</button></div><p class="cfv56-formula">Coal 자동 보정 = (실제 Bio − 최종 Bio) × Bio 발열량 ÷ Coal 발열량</p></section></div><footer><button data-cfv56-reset>원복</button><span></span><button data-cfv56-cancel>취소</button><button class="primary" data-cfv56-apply>적용</button></footer></div></div>`;}
  function create(options){
    const container=options.container;if(!container)return null;let serverRevision=0,serverAdjustment=null;let modal=root.document?.querySelector('[data-cfv56-adjust-modal]');if(!modal){const wrap=root.document.createElement('div');wrap.innerHTML=modalHtml();modal=wrap.firstElementChild;root.document.body.appendChild(modal);}let direction=1,preview=null,base=null,settings=null,spec=null;
    const q=s=>modal.querySelector(s),msg=(t,bad=false)=>{const e=q('[data-cfv56-msg]');if(e){e.textContent=t||'';e.dataset.bad=bad?'1':'0';}},render=r=>{const result=r?.result||base;if(!result)return;q('[data-cfv56-final]').innerHTML=UNITS.map((u,i)=>`<tr><th>${i+1}호기</th><td>${fmt(result.units[u].coal.quantity)} t</td><td>${fmt(result.units[u].bio.quantity)} t</td><td>${pct(ratioBio(result.units[u]))}</td><td>${pct(result.units[u].fuelRatios?.total)}</td></tr>`).join('');q('[data-cfv56-final1]').value=String(round(result.units.unit1.bio.quantity,2));q('[data-cfv56-final2]').value=String(round(result.units.unit2.bio.quantity,2));};
    async function open(){const ctx=options.getContext?.();base=ctx?.result;settings=ctx?.settings;spec=ctx?.spec;if(!base||!settings||!spec){options.onMessage?.('먼저 기간 계산을 완료해 주세요.');return;}const bundle=await loadBundle(spec,options.getHeaders);serverRevision=bundle.revision||0;serverAdjustment=bundle.adjustment||null;preview=null;if(serverAdjustment){const restored=adjustFinal(base,settings,serverAdjustment.finalBioUnit1,serverAdjustment.finalBioUnit2,serverAdjustment);if(restored.ok)preview=restored;}if(!preview)preview=resolveStored(base,settings,spec);q('[data-cfv56-period]').textContent=`${spec.startLocal.replace('T',' ')} ~ ${spec.endLocal.replace('T',' ')}`;const max=Number(bundle.setting?.maxBioTpd)||storedMax();q('[data-cfv56-max]').value=String(max);q('[data-cfv56-cap]').textContent=`선택기간 ${base.period.durationHours.toFixed(2)}시간 환산 최대: 호기당 ${fmt(periodCap(max,base.period.durationHours),2)} t`;render(preview);msg(preview?(serverAdjustment?'서버에 저장된 선택기간 조정값을 불러왔습니다.':'이 브라우저의 선택기간 조정값을 불러왔습니다.'):'');modal.hidden=false;modal.setAttribute('aria-hidden','false');}
    function close(){modal.hidden=true;modal.setAttribute('aria-hidden','true');}
    for(const b of modal.querySelectorAll('[data-cfv56-dir]'))b.addEventListener('click',()=>{direction=Number(b.dataset.cfv56Dir);for(const x of modal.querySelectorAll('[data-cfv56-dir]'))x.classList.toggle('is-selected',x===b);});
    q('[data-cfv56-save-max]').addEventListener('click',async()=>{try{const n=Number(q('[data-cfv56-max]').value),saved=await saveSharedMax(n,options.getHeaders);q('[data-cfv56-cap]').textContent=`선택기간 ${base.period.durationHours.toFixed(2)}시간 환산 최대: 호기당 ${fmt(periodCap(saved.value,base.period.durationHours),2)} t`;msg(saved.shared?'Bio 최대량을 공용 설정으로 저장했습니다.':'서버 저장을 확인하지 못해 이 브라우저에만 저장했습니다.');}catch(e){msg(e.message,true);}});
    q('[data-cfv56-preview-transfer]').addEventListener('click',()=>{preview=manualTransfer(base,settings,direction,q('[data-cfv56-transfer]').value);render(preview);msg(preview.ok?'수동 이동 결과를 미리보기 중입니다.':preview.message,!preview.ok);});
    q('[data-cfv56-auto]').addEventListener('click',()=>{preview=autoMax(base,settings,Number(q('[data-cfv56-max]').value));render(preview);msg(preview.ok?(preview.adjustment.excludedBioTons>0?`최대 범위 초과 ${fmt(preview.adjustment.excludedBioTons)} t는 혼소 계산에서 제외됩니다.`:'최대혼소 자동 조정 결과입니다.') : preview.message,!preview.ok);});
    q('[data-cfv56-edit]').addEventListener('click',()=>{const e=q('[data-cfv56-final-edit]');e.hidden=!e.hidden;});
    q('[data-cfv56-preview-final]').addEventListener('click',()=>{preview=adjustFinal(base,settings,Number(q('[data-cfv56-final1]').value),Number(q('[data-cfv56-final2]').value),{mode:'manual_final'});render(preview);msg(preview.ok?'최종 Bio 직접수정 결과를 미리보기 중입니다.':preview.message,!preview.ok);});
    q('[data-cfv56-apply]').addEventListener('click',async()=>{if(!preview?.ok){msg('적용할 조정 결과를 먼저 만들어 주세요.',true);return;}try{msg('혼소 조정값을 저장하고 있습니다.');const saved=await saveServerAdjustment(spec,preview,serverRevision,options.getHeaders);serverRevision=Number(saved?.entry?.revision)||serverRevision+1;saveStored(spec,base,preview);options.onApply?.(preview.result,preview.adjustment);close();}catch(e){msg(e.message||'혼소 조정 저장을 완료하지 못했습니다.',true);}});
    q('[data-cfv56-reset]').addEventListener('click',async()=>{try{await clearServerAdjustment(spec,serverRevision,options.getHeaders);serverRevision+=1;}catch(_){ }clearStored(spec);preview=null;options.onReset?.();close();});
    for(const sel of ['[data-cfv56-close]','[data-cfv56-cancel]'])q(sel).addEventListener('click',close);
    return {open,close,resolve:(result,currentSettings,currentSpec)=>resolveStored(result,currentSettings,currentSpec),clear:()=>spec&&clearStored(spec)};
  }
  root.CofiringPeriodAdjustmentV56={periodCap,adjustFinal,manualTransfer,autoMax,resolveStored,create,DEFAULT_MAX_TPD,API};
  if(typeof module==='object'&&module.exports)module.exports=root.CofiringPeriodAdjustmentV56;
})(typeof globalThis==='object'?globalThis:this);
