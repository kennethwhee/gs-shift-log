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
  const maxInputText=value=>{const n=Number(value);return finite(n)&&n===round(n,2)?n.toFixed(2):String(n);};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // COFIRING_ADJUSTMENT_COMPACT_DELTA_V4
  const compactLocal=(local,omitYear=false)=>{const s=String(local||'');if(!s)return '—';const [d,t='']=s.split('T');const [y,m,day]=d.split('-');if(!y||!m||!day)return s.replace('T',' ');const hhmm=(t||'').slice(0,5);return omitYear?`${m}-${day} ${hhmm}`:`${String(y).slice(-2)}-${m}-${day} ${hhmm}`;};
  // COFIRING_ADJUSTMENT_POLISH_V7_R2
  const shiftLocalMinutes=(local,delta)=>{
    const s=String(local||'');if(!s)return s;
    const m=s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);if(!m)return s;
    const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),0,0);
    d.setMinutes(d.getMinutes()+Number(delta||0));
    const pad=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const compactPeriod=spec=>{
    const start=compactLocal(spec?.startLocal,true);
    const rawEnd=String(spec?.endLocal||'');
    const shownEnd=/T00:00(?::00)?$/.test(rawEnd)?shiftLocalMinutes(rawEnd,1):rawEnd;
    const end=compactLocal(shownEnd,true);
    return `${start} ~ ${end}`;
  };
  // COFIRING_BIO_DAILY_THRESHOLD_V1: an incomplete day keeps the full daily limit.
  // Longer selected periods retain the established proportional period limit.
  function periodCap(maxTpd,durationHours){const n=Number(maxTpd),h=Number(durationHours);return Number.isFinite(n)&&n>0&&Number.isFinite(h)&&h>0?(h<=24?n:round(n*h/24,3)):null;}
  function fingerprint(base,spec){const a=base?.units?.unit1,b=base?.units?.unit2;return JSON.stringify([spec?.startLocal,spec?.endLocal,round(a?.coal?.quantity,6),round(a?.bio?.quantity,6),round(b?.coal?.quantity,6),round(b?.bio?.quantity,6)]);}
  function recalcUnit(unit,settings,durationHours){
    if(!unit)return null;const h=unit.heats||(unit.heats={});const cals=settings||{};
    const coal=unit.coal?.quantity,bio=unit.bio?.quantity,organic=unit.organic?.quantity,manure=unit.manure?.quantity;
    const coalHv=Number(cals.coal?.calorific),bioHv=Number(cals.bio?.calorific),orgHv=Number(cals.organic?.calorific),manHv=Number(cals.manure?.calorific);
    if(![coal,bio,organic,manure,coalHv,bioHv,orgHv,manHv].every(Number.isFinite))return null;
    h.coal=coal*coalHv/1000;h.bio=bio*bioHv/1000;h.organic=organic*orgHv/1000;h.manure=manure*manHv/1000;h.total=h.coal+h.bio+h.organic+h.manure;
    const bioRatio=h.total>0?h.bio/h.total*100:null,orgRatio=h.total>0?h.organic/h.total*100:null,manRatio=h.total>0?h.manure/h.total*100:null;
    unit.ratios={bio:bioRatio,organic:h.total>0?(h.organic+h.manure)/h.total*100:null,total:h.total>0?(h.bio+h.organic+h.manure)/h.total*100:null};
    unit.fuelRatios={bio:bioRatio,organic:orgRatio,manure:manRatio,organicGroup:h.total>0?(h.organic+h.manure)/h.total*100:null,total:unit.ratios.total};
    if(unit.coal)unit.coal.averageTonPerHour=durationHours>0?unit.coal.quantity/durationHours:null;
    if(unit.bio)unit.bio.averageTonPerHour=durationHours>0?unit.bio.quantity/durationHours:null;
    return unit;
  }
  function recalcCombined(result){
    const one=result?.units?.unit1,two=result?.units?.unit2;if(!one||!two)return result;
    const heats={};for(const f of ['coal','bio','organic','manure','total']){const a=one.heats?.[f],b=two.heats?.[f];heats[f]=finite(a)&&finite(b)?a+b:null;}
    const total=heats.total;const ratios={bio:total>0?heats.bio/total*100:null,organic:total>0?(heats.organic+heats.manure)/total*100:null,total:total>0?(heats.bio+heats.organic+heats.manure)/total*100:null};
    result.combined={heats,ratios,fuelRatios:{bio:ratios.bio,organic:total>0?heats.organic/total*100:null,manure:total>0?heats.manure/total*100:null,organicGroup:total>0?(heats.organic+heats.manure)/total*100:null,total:ratios.total}};return result;
  }
  // COFIRING_BIO_ACTIVE_UNIT_ONLY_V1: eligibility follows original measured use.
  // A zero-use unit cannot receive Bio through automatic, manual or saved edits.
  function inactiveBioMessage(base,finalOne,finalTwo){
    for(const [unit,index,finalBio] of [['unit1',1,finalOne],['unit2',2,finalTwo]]){
      if(base?.units?.[unit]?.bio?.quantity===0&&finalBio!==0)return `${index}호기는 원본 Bio 사용량이 0톤이므로 Bio 사용량을 배정할 수 없습니다.`;
    }
    return '';
  }
  function adjustFinal(base,settings,finalOne,finalTwo,meta={}){
    if(!base?.units?.unit1||!base?.units?.unit2)return {ok:false,message:'먼저 기간 계산을 완료해 주세요.'};
    const b1=base.units.unit1.bio?.quantity,b2=base.units.unit2.bio?.quantity,f1=finalOne,f2=finalTwo;
    if(!UNITS.every(unit=>['coal','bio','organic','manure'].every(fuel=>finite(base.units[unit]?.[fuel]?.quantity)&&base.units[unit][fuel].quantity>=0)))return {ok:false,message:'누락된 연료 사용량이 있습니다. 조회 결과와 입력값을 확인해 주세요.'};
    if(![b1,b2,f1,f2].every(Number.isFinite)||f1<0||f2<0)return {ok:false,message:'최종 Bio 사용량을 0 이상으로 확인해 주세요.'};
    const inactiveMessage=inactiveBioMessage(base,f1,f2);if(inactiveMessage)return {ok:false,message:inactiveMessage};
    if(f1+f2>b1+b2+0.011)return {ok:false,message:'최종 Bio 합계는 실제 Bio 사용량 합계를 초과할 수 없습니다.'};
    const result=clone(base),hours=Number(result.period?.durationHours)||Number(meta.durationHours)||0,deltas={};
    for(const [unit,finalBio] of [['unit1',f1],['unit2',f2]]){
      const u=result.units[unit],raw=base.units[unit],s=settings?.[unit];const coalHv=Number(s?.coal?.calorific),bioHv=Number(s?.bio?.calorific);
      if(!Number.isFinite(coalHv)||coalHv<=0||!Number.isFinite(bioHv)||bioHv<=0)return {ok:false,message:'Coal/Bio 발열량을 확인해 주세요.'};
      const bioDelta=Number(raw.bio.quantity)-finalBio,coalDelta=bioDelta*bioHv/coalHv,finalCoal=Number(raw.coal.quantity)+coalDelta;
      if(!Number.isFinite(finalCoal)||finalCoal<0)return {ok:false,message:'조정 후 Coal 사용량이 0 미만이 됩니다.'};
      const unchangedAuto=meta.mode==='max_auto'&&finalBio===raw.bio.quantity;
      u.bio.quantity=unchangedAuto?raw.bio.quantity:round(finalBio,6);u.coal.quantity=raw.bio.quantity===0||unchangedAuto?raw.coal.quantity:round(finalCoal,6);deltas[unit]={bioDelta,coalDelta};
      if(!recalcUnit(u,s,hours))return {ok:false,message:'조정 후 열량/혼소율을 계산하지 못했습니다.'};
    }
    recalcCombined(result);
    result.adjustment={mode:meta.mode||'manual_final',fromUnit:meta.fromUnit||null,bioTransferTons:round(meta.bioTransferTons||0,3),maxBioTpd:finite(meta.maxBioTpd)?meta.maxBioTpd:null,periodCapTons:finite(meta.periodCapTons)?meta.periodCapTons:null,excludedBioTons:round(Math.max(0,b1+b2-f1-f2),3),deltas,applied:true};
    return {ok:true,result,adjustment:result.adjustment};
  }
  function manualTransfer(base,settings,fromUnit,tons){const t=Number(tons),dir=Number(fromUnit)===2?2:1,b1=base?.units?.unit1?.bio?.quantity,b2=base?.units?.unit2?.bio?.quantity;if(!Number.isFinite(t)||t<=0)return {ok:false,message:'Bio 이동량을 0보다 크게 입력해 주세요.'};if(![b1,b2].every(Number.isFinite))return {ok:false,message:'먼저 기간 계산을 완료해 주세요.'};if(b1===0||b2===0)return {ok:false,message:'원본 Bio 사용량이 0톤인 호기가 있어 호기 간 Bio 이동을 할 수 없습니다.'};const source=dir===1?b1:b2;if(t>source+1e-9)return {ok:false,message:`${dir}호기 Bio 사용량보다 많이 이동할 수 없습니다.`};return adjustFinal(base,settings,dir===1?b1-t:b1+t,dir===1?b2+t:b2-t,{mode:'manual_transfer',fromUnit:dir,bioTransferTons:t});}
  // COFIRING_TABLE_EDIT_ENGINE_V1: quantities are authoritative; ratios are derived.
  const TABLE_MAX_TONS=1000000;
  const tableValues=result=>({
    finalCoalUnit1:result?.units?.unit1?.coal?.quantity,
    finalCoalUnit2:result?.units?.unit2?.coal?.quantity,
    finalBioUnit1:result?.units?.unit1?.bio?.quantity,
    finalBioUnit2:result?.units?.unit2?.bio?.quantity
  });
  function adjustTable(base,settings,values){
    if(!base?.units?.unit1||!base?.units?.unit2)return {ok:false,message:'먼저 기간 계산을 완료해 주세요.'};
    if(!UNITS.every(unit=>['coal','bio','organic','manure'].every(fuel=>finite(base.units[unit]?.[fuel]?.quantity)&&base.units[unit][fuel].quantity>=0)))return {ok:false,message:'누락된 연료 사용량이 있습니다. 조회 결과와 입력값을 확인해 주세요.'};
    const fields=['finalCoalUnit1','finalCoalUnit2','finalBioUnit1','finalBioUnit2'];
    if(!values||!fields.every(key=>finite(values[key])&&values[key]>=0&&values[key]<=TABLE_MAX_TONS))return {ok:false,message:'Coal/Bio 사용량을 0 이상 1,000,000 t 이하의 숫자로 확인해 주세요.'};
    const inactiveMessage=inactiveBioMessage(base,values.finalBioUnit1,values.finalBioUnit2);if(inactiveMessage)return {ok:false,message:inactiveMessage};
    if(!UNITS.every(unit=>['coal','bio','organic','manure'].every(fuel=>{const hv=Number(settings?.[unit]?.[fuel]?.calorific);return Number.isFinite(hv)&&hv>0;})))return {ok:false,message:'연료별 발열량을 0보다 큰 값으로 확인해 주세요.'};
    const finals=Object.fromEntries(fields.map(key=>[key,round(values[key],6)]));
    const originalBio=base.units.unit1.bio.quantity+base.units.unit2.bio.quantity;
    const finalBio=finals.finalBioUnit1+finals.finalBioUnit2;
    if(finalBio>originalBio+0.011+1e-9)return {ok:false,message:'최종 Bio 합계는 실제 Bio 사용량 합계를 초과할 수 없습니다.'};
    const result=clone(base),hours=Number(result.period?.durationHours)||0,deltas={};
    for(const [unit,index] of [['unit1',1],['unit2',2]]){
      const value=result.units[unit],raw=base.units[unit];
      value.coal.quantity=finals['finalCoalUnit'+index];
      value.bio.quantity=finals['finalBioUnit'+index];
      deltas[unit]={bioDelta:raw.bio.quantity-value.bio.quantity,coalDelta:value.coal.quantity-raw.coal.quantity};
      if(!recalcUnit(value,settings[unit],hours))return {ok:false,message:'수정한 사용량의 열량과 혼소율을 계산하지 못했습니다.'};
      if(!['coal','bio','organic','manure','total'].every(fuel=>finite(value.heats[fuel])))return {ok:false,message:'계산 가능한 사용량과 발열량 범위를 확인해 주세요.'};
    }
    recalcCombined(result);
    result.adjustment={mode:'manual_table',fromUnit:null,bioTransferTons:0,maxBioTpd:null,periodCapTons:null,
      excludedBioTons:round(Math.max(0,originalBio-finalBio),3),deltas,applied:true};
    return {ok:true,result,adjustment:result.adjustment};
  }
  function editTableValue(base,settings,currentResult,unit,key,value){
    const labels={bioRatio:'바이오 혼소율',organicRatio:'유기성 및 축분 혼소율',totalRatio:'종합 혼소율'};
    if(!UNITS.includes(unit)||!['coal','bio',...Object.keys(labels)].includes(key))return {ok:false,message:'수정할 호기와 항목을 확인해 주세요.'};
    if(!finite(value)||value<0||(key==='coal'||key==='bio'?value>TABLE_MAX_TONS:value>100))return {ok:false,message:key==='coal'||key==='bio'?'사용량을 0 이상 1,000,000 t 이하로 입력해 주세요.':'혼소율을 0 이상 100% 이하로 입력해 주세요.'};
    const current=adjustTable(base,settings,tableValues(currentResult));
    if(!current.ok)return current;
    const values=tableValues(current.result),number=unit==='unit1'?1:2;
    const one=current.result.units[unit],cals=settings[unit];
    const coalHv=Number(cals.coal.calorific),bioHv=Number(cals.bio.calorific);
    if(key==='coal')values['finalCoalUnit'+number]=value;
    else if(key==='bio'){
      const coal=one.coal.quantity+(one.bio.quantity-value)*bioHv/coalHv;
      if(!Number.isFinite(coal)||coal < -1e-9)return {ok:false,message:'Bio 사용량을 조정하면 Coal이 0 미만이 됩니다. Bio 사용량을 낮춰 주세요.'};
      values['finalBioUnit'+number]=value;
      values['finalCoalUnit'+number]=Math.max(0,coal);
    }else{
      if(!(one.heats.total>0))return {ok:false,message:'총 투입열량이 0이어서 혼소율을 수정할 수 없습니다. 연료 사용량을 먼저 입력해 주세요.'};
      const organicHeat=one.heats.organic+one.heats.manure,nonCoalHeat=one.heats.bio+organicHeat;
      const numerator=key==='bioRatio'?one.heats.bio:key==='organicRatio'?organicHeat:nonCoalHeat;
      if(numerator===0){
        if(value!==0)return {ok:false,message:'해당 연료 사용량이 0이므로 0%만 가능합니다. 연료 사용량을 먼저 확인해 주세요.'};
        return current;
      }
      if(value===0)return {ok:false,message:'해당 연료 사용량이 있어 0%로 맞출 수 없습니다. 0보다 큰 혼소율을 입력해 주세요.'};
      const totalHeat=numerator/(value/100),coalHeat=totalHeat-nonCoalHeat;
      const tolerance=1e-9+Number.EPSILON*Math.max(1,totalHeat,nonCoalHeat)*16;
      if(!Number.isFinite(totalHeat)||!Number.isFinite(coalHeat))return {ok:false,message:'입력한 혼소율을 계산할 수 없습니다. 목표 혼소율을 확인해 주세요.'};
      if(coalHeat < -tolerance)return {ok:false,message:`${labels[key]}은 현재 연료 사용량에서 최대 ${fmt(numerator/nonCoalHeat*100)}%까지 가능합니다. 목표 혼소율을 낮춰 주세요.`};
      values['finalCoalUnit'+number]=Math.max(0,coalHeat)*1000/coalHv;
    }
    return adjustTable(base,settings,values);
  }
  function resolveAdjustment(base,settings,saved){
    if(!saved||typeof saved!=='object')return {ok:false,message:'저장된 혼소 조정값을 확인해 주세요.'};
    const meta=saved.meta||saved;
    if(meta.mode==='manual_table')return adjustTable(base,settings,saved);
    if(meta.mode&&!['manual_transfer','max_auto','manual_final'].includes(meta.mode))return {ok:false,message:'저장된 혼소 조정 방식을 확인해 주세요.'};
    if(meta.mode==='max_auto')return replayAutoMax(base,settings,meta.maxBioTpd,saved.finalBioUnit1,saved.finalBioUnit2);
    return adjustFinal(base,settings,saved.finalBioUnit1,saved.finalBioUnit2,meta);
  }
  // COFIRING_MAX_TARGET_BAND_V1: choose once for a preview; replay stored finals.
  const MAX_TARGET_BAND_TPD=0.10;
  function maxAutoInputs(base,maxTpd){
    const hours=Number(base?.period?.durationHours),cap=periodCap(maxTpd,hours),b1=base?.units?.unit1?.bio?.quantity,b2=base?.units?.unit2?.bio?.quantity;if(!Number.isFinite(cap)||cap<=0)return {ok:false,message:'호기당 Bio 최대량(t/d)을 확인해 주세요.'};if(![b1,b2].every(Number.isFinite))return {ok:false,message:'먼저 기간 계산을 완료해 주세요.'};
    if(b1<=cap&&b2<=cap)return {ok:false,message:`현재 1·2호기 Bio 사용량이 ${hours<=24?'일일':'선택기간 환산'} 최대 ${fmt(cap,2)} t 이하이므로 조정하지 않습니다.`};
    return {ok:true,hours,cap,b1,b2};
  }
  function maxAutoAtCaps(base,settings,maxTpd,input,target1,target2){
    const {cap,b1,b2}=input;
    let f1=b1<=cap?b1:Math.min(b1,target1),f2=b2<=cap?b2:Math.min(b2,target2),ex1=Math.max(0,b1-f1),ex2=Math.max(0,b2-f2),c1=b1>0?Math.max(0,target1-f1):0,c2=b2>0?Math.max(0,target2-f2):0;
    const move12=Math.min(ex1,c2);f2+=move12;ex1-=move12;c2-=move12;
    const move21=Math.min(ex2,c1);f1+=move21;ex2-=move21;c1-=move21;
    return adjustFinal(base,settings,f1,f2,{mode:'max_auto',maxBioTpd:Number(maxTpd),periodCapTons:cap,fromUnit:move12>0?1:move21>0?2:null,bioTransferTons:move12+move21,excludedBioTons:ex1+ex2});
  }
  function autoMax(base,settings,maxTpd,random=Math.random){
    const input=maxAutoInputs(base,maxTpd);if(!input.ok)return input;
    const max=Number(maxTpd),low=Math.max(0,max-MAX_TARGET_BAND_TPD);
    // Integer hundredths include both endpoints without rounding above the limit.
    const first=Math.ceil(low*100-1e-8),last=Math.floor(max*100+1e-8);
    const pick=()=>{const r=random();return finite(r)&&r>=0&&r<1?(first+Math.floor(r*(last-first+1)))/100:null;};
    const one=input.b1===0?0:pick(),two=input.b2===0?0:pick();
    if(!finite(one)||!finite(two))return {ok:false,message:'자동 조정 목표를 만들지 못했습니다. 다시 실행해 주세요.'};
    const toPeriod=value=>value===0?0:Math.min(input.cap,periodCap(value,input.hours));
    return maxAutoAtCaps(base,settings,maxTpd,input,toPeriod(one),toPeriod(two));
  }
  function replayAutoMax(base,settings,maxTpd,finalOne,finalTwo){
    const input=maxAutoInputs(base,maxTpd);if(!input.ok)return input;
    const lowerTpd=Math.max(0,Number(maxTpd)-MAX_TARGET_BAND_TPD);
    const lower=lowerTpd===0?0:periodCap(lowerTpd,input.hours),tolerance=0.000001;
    if(![finalOne,finalTwo].every(v=>finite(v)&&v>=0&&v<=input.cap+tolerance))return {ok:false,message:'저장된 최대혼소 조정값이 최대량 범위를 벗어났습니다.'};
    const inactiveMessage=inactiveBioMessage(base,finalOne,finalTwo);if(inactiveMessage)return {ok:false,message:inactiveMessage};
    // A capped unit retains its selected target; a recipient below the band
    // retains all available transferred Bio. No new random draw on save/read.
    const target=value=>value>=lower-tolerance?Math.min(value,input.cap):input.cap;
    const replay=maxAutoAtCaps(base,settings,maxTpd,input,target(finalOne),target(finalTwo));
    if(!replay.ok)return replay;
    if(Math.abs(replay.result.units.unit1.bio.quantity-finalOne)>tolerance||Math.abs(replay.result.units.unit2.bio.quantity-finalTwo)>tolerance)return {ok:false,message:'저장된 최대혼소 조정값의 목표 범위 또는 호기 간 이동량이 올바르지 않습니다.'};
    return replay;
  }
  function storageKey(spec){return STORAGE_PREFIX+encodeURIComponent(`${spec.startLocal}|${spec.endLocal}`);}
  function readStored(spec,base){try{const raw=root.localStorage?.getItem(storageKey(spec));if(!raw)return null;const data=JSON.parse(raw);if(data.fingerprint!==fingerprint(base,spec))return null;return data;}catch(_){return null;}}
  function saveStored(spec,base,adjustment){
    try{
      const key=storageKey(spec),value={fingerprint:fingerprint(base,spec),finalBioUnit1:adjustment.result.units.unit1.bio.quantity,finalBioUnit2:adjustment.result.units.unit2.bio.quantity,meta:adjustment.adjustment};
      if(adjustment.adjustment.mode==='manual_table'){
        value.finalCoalUnit1=adjustment.result.units.unit1.coal.quantity;
        value.finalCoalUnit2=adjustment.result.units.unit2.coal.quantity;
      }
      let previous=null;try{previous=JSON.parse(root.localStorage?.getItem(key)||'null');}catch(_){}
      if(previous){const {at,...stable}=previous;if(JSON.stringify(stable)===JSON.stringify(value))return;}
      // Identical server rereads must not cause an endless cross-tab storage loop.
      root.localStorage?.setItem(key,JSON.stringify({...value,at:new Date().toISOString()}));
    }catch(_){}
  }
  function clearStored(spec){try{root.localStorage?.removeItem(storageKey(spec));}catch(_){} }
  function storedMax(){try{const n=Number(root.localStorage?.getItem(MAX_SETTING_KEY));return Number.isFinite(n)&&n>0?n:DEFAULT_MAX_TPD;}catch(_){return DEFAULT_MAX_TPD;}}
  const API='/api/cofiring-period-adjustments';
  const requestId=()=>typeof root.crypto?.randomUUID==='function'?root.crypto.randomUUID():('00000000-0000-4000-8000-'+String(Date.now()).padStart(12,'0').slice(-12));
  async function loadBundle(spec,getHeaders){
    const ctrl=typeof root.AbortController==='function'?new root.AbortController():null;
    const timer=root.setTimeout?.(()=>ctrl?.abort(),10000);
    try{const q=new URLSearchParams({start:spec.startLocal,end:spec.endLocal}),r=await root.fetch(API+'?'+q.toString(),{headers:getHeaders?.()||{},cache:'no-store',credentials:'same-origin',...(ctrl?{signal:ctrl.signal}:{})}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'조회 실패');if(p.start!==spec.startLocal||p.end!==spec.endLocal||!Number.isSafeInteger(p.revision)||p.revision<0)throw new Error('공용 혼소조정 조회 기간·버전이 다릅니다.');return {loaded:true,adjustment:p.adjustment||null,revision:Number(p.revision)||0,setting:{maxBioTpd:Number(p.setting?.maxBioTpd)||storedMax()}};}catch(e){return {loaded:false,error:e.name==='AbortError'?'저장 상태 확인 시간이 초과됐습니다. 창을 닫고 다시 시도해 주세요.':e.message,adjustment:null,revision:0,setting:{maxBioTpd:storedMax()}};}finally{root.clearTimeout?.(timer);}
  }
  async function saveSharedMax(value,getHeaders){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>2000)throw new Error('호기당 Bio 최대량을 확인해 주세요.');try{root.localStorage?.setItem(MAX_SETTING_KEY,String(n));}catch(_){}try{const r=await root.fetch(API,{method:'POST',headers:{...(getHeaders?.()||{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},cache:'no-store',credentials:'same-origin',body:JSON.stringify({action:'save_setting',maxBioTpd:n})}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'설정 저장 실패');return {shared:true,value:Number(p?.setting?.maxBioTpd)||n};}catch(_){return {shared:false,value:n};}}
  async function saveServerAdjustment(spec,adjustment,expectedRevision,getHeaders){const body={action:'save',start:spec.startLocal,end:spec.endLocal,adjustment:{mode:adjustment.adjustment.mode,fromUnit:adjustment.adjustment.fromUnit,bioTransferTons:adjustment.adjustment.bioTransferTons,finalBioUnit1:adjustment.result.units.unit1.bio.quantity,finalBioUnit2:adjustment.result.units.unit2.bio.quantity,...(adjustment.adjustment.mode==='manual_table'?{finalCoalUnit1:adjustment.result.units.unit1.coal.quantity,finalCoalUnit2:adjustment.result.units.unit2.coal.quantity}:{}),maxBioTpd:adjustment.adjustment.maxBioTpd,excludedBioTons:adjustment.adjustment.excludedBioTons,note:''},expectedRevision,requestId:requestId()};const r=await root.fetch(API,{method:'POST',headers:{...(getHeaders?.()||{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},cache:'no-store',credentials:'same-origin',body:JSON.stringify(body)}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'혼소 조정 저장 실패');return p;}
  async function clearServerAdjustment(spec,expectedRevision,getHeaders){const r=await root.fetch(API,{method:'POST',headers:{...(getHeaders?.()||{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},cache:'no-store',credentials:'same-origin',body:JSON.stringify({action:'clear',start:spec.startLocal,end:spec.endLocal,expectedRevision,requestId:requestId()})}),p=await r.json();if(!r.ok||p?.ok!==true)throw new Error(p?.message||'혼소 조정 원복 저장 실패');return p;}
  function resolveStored(base,settings,spec){const saved=readStored(spec,base);if(!saved)return null;const r=resolveAdjustment(base,settings,saved);return r.ok?r:null;}
  // COFIRING_SERVER_ADJUSTMENT_RESOLVER_V2
  async function resolveServer(base,settings,spec,getHeaders,isCurrent=()=>true){
    const bundle=await loadBundle(spec,getHeaders);
    if(!isCurrent())return {loaded:false,stale:true};
    if(!bundle.loaded)return bundle;
    if(!bundle.adjustment){
      clearStored(spec);
      return {loaded:true,adjusted:false,result:base,revision:bundle.revision};
    }
    const saved=bundle.adjustment;
    const resolved=resolveAdjustment(base,settings,saved);
    if(!resolved?.ok)return {loaded:false,error:resolved?.message||'공용 혼소조정값을 원본에 적용하지 못했습니다.'};
    if(!isCurrent())return {loaded:false,stale:true};
    saveStored(spec,base,resolved);
    return {loaded:true,adjusted:true,result:resolved.result,revision:bundle.revision};
  }
  // COFIRING_TOTAL_HEAT_BASIS_V2_R3: adjustment preview displays Bio / total fuel heat.
  function ratioBio(unit){const direct=unit?.fuelRatios?.bio??unit?.ratios?.bio;if(finite(direct))return direct;const b=unit?.heats?.bio,t=unit?.heats?.total;return finite(b)&&finite(t)&&t>0?b/t*100:null;}
  // COFIRING_ADJUSTMENT_READABILITY_V15: one inline notice owned by this editor.
  let tableComparisonSequence=0;
  function tableEditHtml(){
    const fields=[['coal','Coal 사용량'],['bio','Bio 사용량'],['bioRatio','바이오 혼소율'],['organicRatio','유기성 및 축분 혼소율'],['totalRatio','종합 혼소율']];
    const comparisonPrefix='cfv56-edit-comparison-'+(++tableComparisonSequence);
    return `<div class="cfv56-final-edit cfv56-table-editor" data-cfv56-final-edit hidden><p class="cfv56-table-edit-help">Coal 변경 시 혼소율 재계산 · Bio 변경 시 Coal 열량 보정 · 혼소율 변경 시 Coal 역산</p><div class="cfv56-edit-scroll"><table class="cfv56-edit-table"><thead><tr><th>호기</th><th>Coal (t)</th><th>Bio (t)</th><th>바이오 혼소율 (%)</th><th>유기성·축분 (%)</th><th>종합 혼소율 (%)</th></tr></thead><tbody>${UNITS.map((unit,i)=>`<tr><th>${i+1}호기</th>${fields.map(([key,label])=>{const id=comparisonPrefix+'-'+unit+'-'+key;return `<td data-label="${label}"><input type="number" min="0" max="${key==='coal'||key==='bio'?1000000:100}" step="0.01" inputmode="decimal" data-cfv56-table-unit="${unit}" data-cfv56-table-field="${key}" ${key==='bio'?`data-cfv56-final${i+1}`:''} aria-label="${i+1}호기 ${label}" aria-describedby="${id}"><div class="cfv56-edit-comparison" id="${id}" data-cfv56-edit-comparison data-cfv56-table-unit="${unit}" data-cfv56-table-key="${key}"><div class="cfv56-metric-base">원본 —</div><div class="cfv56-metric-delta is-zero">—</div></div></td>`;}).join('')}</tr>`).join('')}</tbody></table></div><div class="cfv56-table-edit-actions"><button type="button" data-cfv56-cancel-edit>수정 취소</button><button type="button" data-cfv56-preview-final>수정값 미리보기</button></div></div>`;
  }
  // COFIRING_ADJUSTMENT_PREVIEW_DESIGN_V1: one compact control deck and a clear comparison table.
  let dialogSequence=0;
  function zeroUsageHtml(result){
    return UNITS.map((unit,index)=>{
      const fuels=[['bio','Bio'],['coal','Coal'],['organic','유기성']].filter(([fuel])=>{
        const value=result?.units?.[unit]?.[fuel];
        return value?.quantity===0&&value.complete!==false&&!(fuel==='organic'&&result?.organicUsage?.provisionalZero===true);
      });
      return fuels.length?`<div class="cfv56-zero-row"><strong>${index+1}호기</strong><span>${fuels.map(([,label])=>`${label} 사용량 0톤 입니다.`).join(' · ')}</span></div>`:'';
    }).join('');
  }
  function modalHtml(){
    const prefix='cfv56-control-'+(++dialogSequence);
    return `<div class="cfv56-adjust-modal cfv56-design-v15 cfv56-table-edit-v1 cfv56-preview-design-v1" data-cfv56-adjust-modal hidden aria-hidden="true">
      <div class="cfv56-adjust-dialog" role="dialog" aria-modal="true" aria-label="혼소 조정">
        <header><div><h3>혼소 조정</h3><p>조정 전후의 사용량과 혼소율을 확인하세요.</p></div><div class="cfv56-header-actions"><button type="button" class="cfv56-calorific-button" data-cfv56-calorific title="발열량 확인 및 수정">발열량 설정</button><button type="button" data-cfv56-close aria-label="닫기">×</button></div></header>
        <div class="cfv56-adjust-body">
          <section class="cfv56-period-inline cfv56-top-card-period"><span class="cfv56-period-label">선택 기간</span><span class="cfv56-inline-year" data-cfv56-year>2026년</span><strong data-cfv56-period>—</strong></section>
          <div class="cfv56-control-deck">
            <div class="cfv56-control-tabs" role="tablist" aria-label="조정 방법"><button type="button" id="${prefix}-auto-tab" role="tab" aria-selected="true" aria-controls="${prefix}-auto-panel" data-cfv56-tab="auto">최대혼소 조정</button><button type="button" id="${prefix}-manual-tab" role="tab" aria-selected="false" aria-controls="${prefix}-manual-panel" data-cfv56-tab="manual">수동 이동</button></div>
            <section class="cfv56-control-panel" id="${prefix}-auto-panel" role="tabpanel" aria-labelledby="${prefix}-auto-tab" data-cfv56-panel="auto">
              <section class="cfv56-top-card-cap"><div class="cfv56-top-card-label"><label for="${prefix}-max">호기당 Bio 최대량</label></div><div class="cfv56-cap-group"><input id="${prefix}-max" data-cfv56-max type="number" min="0.01" max="2000" step="0.01"><span class="cfv56-unit">t/d</span><button type="button" data-cfv56-save-max>설정 저장</button></div></section>
              <section class="cfv56-auto cfv56-auto-card"><p class="cfv56-cap-note" data-cfv56-cap>—</p><p class="cfv56-auto-copy-line">호기별 Bio 최대량 초과 시 조정</p><button type="button" data-cfv56-auto>최대혼소 미리보기 <span aria-hidden="true">→</span></button></section>
            </section>
            <section class="cfv56-control-panel" id="${prefix}-manual-panel" role="tabpanel" aria-labelledby="${prefix}-manual-tab" data-cfv56-panel="manual" hidden>
              <section class="cfv56-manual-card"><div class="cfv56-section-head"><div><h4>Bio 이동 방향</h4><p>호기 간 Bio 배분 조정</p></div></div><div class="cfv56-dir"><button type="button" class="is-selected" aria-pressed="true" data-cfv56-dir="1">1호기 → 2호기</button><button type="button" aria-pressed="false" data-cfv56-dir="2">2호기 → 1호기</button></div><label class="cfv56-transfer"><span class="cfv56-field-label">이동량</span><input data-cfv56-transfer aria-label="Bio 이동량" type="number" min="0" step="0.01" placeholder="0.0"><span>t</span><button type="button" data-cfv56-preview-transfer>미리보기</button><button type="button" class="cfv56-transfer-cancel" data-cfv56-cancel-transfer>초기화</button></label></section>
            </section>
          </div>
          <p class="cfv56-adjust-msg" data-cfv56-msg role="status" aria-live="polite" hidden></p>
          <section class="cfv56-section cfv56-result-section">
            <div class="cfv56-final-head"><div><h4><span data-cfv56-result-title>현재 계산값</span><span class="cfv56-preview-badge" data-cfv56-preview-badge hidden>미리보기</span></h4><p>현재 계산된 원본 수치입니다.</p></div><button type="button" data-cfv56-edit aria-pressed="false">직접 수정</button></div>
            <div class="cfv56-final-scroll" data-cfv56-readonly><table aria-label="호기별 혼소 조정 결과"><thead><tr><th scope="col">호기</th><th scope="col">Coal (t)</th><th scope="col">Bio (t)</th><th scope="col">바이오 혼소율</th><th scope="col">유기성 및 축분 혼소율</th><th scope="col">종합 혼소율</th></tr></thead><tbody data-cfv56-final></tbody></table></div>
            ${tableEditHtml()}
            <div class="cfv56-table-legend"><span><span class="cfv56-legend-up">↑ 증가</span><span class="cfv56-legend-down">↓ 감소</span><span>— 변동 없음</span></span><span>단위: t, % · %p = 퍼센트포인트</span></div>
            <div class="cfv56-zero-notices" data-cfv56-zero-notices role="note" aria-label="원본 연료 사용량 0톤 안내" hidden></div>
            <p class="cfv56-result-note" data-cfv56-result-note>조정 전 원본 수치입니다. 이동 또는 자동 조정으로 미리보기를 만드세요.</p>
            <p class="cfv56-coal-review-notice" data-cfv56-coal-review-notice role="note" hidden><span aria-hidden="true">ⓘ</span> 최대혼소 조정 후 1·2호기 석탄 사용량을 확인해 주세요.</p>
            <details class="cfv56-calculation"><summary>계산 기준</summary><p class="cfv56-formula">※ Bio 변경 시 Coal 보정량 = (변경 전 Bio − 변경 후 Bio) × Bio 발열량 ÷ Coal 발열량</p><p class="cfv56-formula">※ 혼소율은 전체 투입열량 기준입니다.</p></details>
          </section>
        </div>
        <footer><button type="button" data-cfv56-reset>원본으로</button><span class="cfv56-footer-hint" data-cfv56-footer-hint>아직 적용되지 않았습니다.</span><button type="button" data-cfv56-cancel>취소</button><button type="button" class="primary" data-cfv56-apply>조정값 적용</button></footer>
      </div>
    </div>`;
  }
  // COFIRING_ADJUSTMENT_MANUAL_AUTO_COMPACT_V8
  // COFIRING_ADJUSTMENT_AUTOCARD_ROLLBACK_V9
  function create(options){
    const container=options.container;if(!container)return null;
    const wrap=root.document.createElement('div');wrap.innerHTML=modalHtml();const modal=wrap.firstElementChild;root.document.body.appendChild(modal);
    let serverRevision=0,direction=1,preview=null,manualPreviewActive=false,base=null,settings=null,spec=null,epoch=0,ready=false,busy=false,disposed=false,returnFocus=null,contextSignature='';
    const q=s=>modal.querySelector(s),msg=(text,bad=false)=>{const e=q('[data-cfv56-msg]');e.textContent=text||'';e.dataset.bad=bad?'1':'0';e.hidden=!text;};
    // Tabs change the visible controls only; calculation drafts and previews are retained.
    function selectAdjustmentTab(name,focus=false){
      if(busy||!['auto','manual'].includes(name))return;
      for(const tab of modal.querySelectorAll('[data-cfv56-tab]')){
        const selected=tab.dataset.cfv56Tab===name;
        tab.setAttribute('aria-selected',String(selected));
        if(selected&&focus)tab.focus();
      }
      for(const panel of modal.querySelectorAll('[data-cfv56-panel]'))panel.hidden=panel.dataset.cfv56Panel!==name;
    }
    for(const tab of modal.querySelectorAll('[data-cfv56-tab]')){
      tab.addEventListener('click',()=>{if(ready&&!busy)selectAdjustmentTab(tab.dataset.cfv56Tab);});
      tab.addEventListener('keydown',event=>{
        if(!ready||busy||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        selectAdjustmentTab(event.key==='Home'?'auto':event.key==='End'?'manual':tab.dataset.cfv56Tab==='auto'?'manual':'auto',true);
      });
    }
    const signature=ctx=>JSON.stringify([ctx?.spec,ctx?.settings,ctx?.result?.units]);
    const currentContext=()=>{try{return options.getContext?.()?.result===base&&signature(options.getContext?.())===contextSignature;}catch(_){return false;}};
    let tableEditing=false,tableDraft=null,tableBefore=null,tableCustom=false;
    const tablePending=new Map();
    const tableFields=Array.from(modal.querySelectorAll('[data-cfv56-table-field]'));
    const tableComparisons=Array.from(modal.querySelectorAll('[data-cfv56-edit-comparison]'));
    const tableMetric=(result,unit,key)=>{
      const u=result?.units?.[unit];
      return key==='coal'?u?.coal?.quantity:key==='bio'?u?.bio?.quantity:key==='bioRatio'?ratioBio(u):key==='organicRatio'?u?.fuelRatios?.organicGroup:u?.fuelRatios?.total;
    };
    const tableValues=result=>({finalCoalUnit1:result.units.unit1.coal.quantity,finalCoalUnit2:result.units.unit2.coal.quantity,finalBioUnit1:result.units.unit1.bio.quantity,finalBioUnit2:result.units.unit2.bio.quantity});
    // COFIRING_EDIT_COMPARISON_V1: update labels without replacing input nodes.
    function renderTableComparisons(result,pending=false){
      for(const comparison of tableComparisons){
        const unit=comparison.dataset.cfv56TableUnit,key=comparison.dataset.cfv56TableKey;
        const original=tableMetric(base,unit,key),value=tableMetric(result,unit,key);
        const originalNode=comparison.querySelector('.cfv56-metric-base'),deltaNode=comparison.querySelector('.cfv56-metric-delta');
        if(originalNode)originalNode.textContent='원본 '+(key==='coal'||key==='bio'?fmt(original):pct(original));
        const pendingField=tablePending.get(unit+':'+key);
        const requested=pendingField?Number(pendingField.value):null;
        const differs=Boolean(!pending&&pendingField&&finite(requested)&&finite(value)&&round(requested,2)!==round(value,2));
        const ready=!pending&&!differs&&finite(original)&&finite(value),delta=ready?round(value-original,2):null;
        comparison.dataset.cfv56ComparisonState=ready?'ready':'pending';
        if(differs)comparison.setAttribute('title','다른 입력값과 함께 계산 중입니다. 미리보기에서 최종값을 확인해 주세요.');
        else comparison.removeAttribute('title');
        if(deltaNode){
          deltaNode.className='cfv56-metric-delta '+(!ready?'is-muted':delta>0?'is-pos':delta<0?'is-neg':'is-zero');
          deltaNode.textContent=!ready||delta===0?'—':`${delta>0?'▲ +':'▼ -'} ${fmt(Math.abs(delta))}${key==='coal'||key==='bio'?'':'%p'}`;
        }
      }
    }
    function fillTable(result){
      for(const field of tableFields){const value=tableMetric(result,field.dataset.cfv56TableUnit,field.dataset.cfv56TableField);field.value=finite(value)?String(round(value,2)):'';field.removeAttribute('aria-invalid');}
      renderTableComparisons(result);
    }
    function stopTableEdit(){tableEditing=false;tableDraft=null;tableBefore=null;tableCustom=false;tablePending.clear();}
    function calculateTableEdits(pending){
      if(!tableDraft)return {ok:false,message:'수정할 계산값을 확인해 주세요.'};
      for(const field of pending){const raw=String(field.value).trim(),n=Number(raw);if(raw===''||!Number.isFinite(n)||n<0)return {ok:false,message:'수정값을 0 이상의 숫자로 입력해 주세요.'};}
      let next=tableDraft;
      // Commit both Bio entries together, regardless of typing order.
      const bios=pending.filter(field=>field.dataset.cfv56TableField==='bio');
      if(bios.length){
        const values=tableValues(next);
        for(const field of bios){
          const unit=field.dataset.cfv56TableUnit,i=unit==='unit1'?1:2,n=Number(field.value),u=next.units[unit],cal=settings[unit];
          const explicitCoal=pending.find(other=>other.dataset.cfv56TableUnit===unit&&other.dataset.cfv56TableField==='coal');
          values['finalBioUnit'+i]=n;
          values['finalCoalUnit'+i]=explicitCoal?Number(explicitCoal.value):u.coal.quantity+(u.bio.quantity-n)*Number(cal.bio.calorific)/Number(cal.coal.calorific);
        }
        const r=adjustTable(base,settings,values);if(!r.ok)return r;next=r.result;
      }
      for(const field of pending){const key=field.dataset.cfv56TableField;if(key==='bio')continue;const r=editTableValue(base,settings,next,field.dataset.cfv56TableUnit,key,Number(field.value));if(!r.ok)return r;next=r.result;}
      return {ok:true,result:next};
    }
    function showTableCandidate(candidate){
      const shown=candidate.ok?candidate.result:tableDraft,pending=new Set(tablePending.values());
      // Preserve the active/pending text and caret. Other fields must agree with
      // the displayed candidate deltas, or revert to the committed draft.
      for(const field of tableFields){if(candidate.ok)field.removeAttribute('aria-invalid');if(pending.has(field))continue;const value=tableMetric(shown,field.dataset.cfv56TableUnit,field.dataset.cfv56TableField);field.value=finite(value)?String(round(value,2)):'';}
      renderTableComparisons(candidate.ok?candidate.result:null,!candidate.ok);
    }
    function commitTableDraft(){
      if(!tableEditing||!tableDraft)return false;
      if(!tablePending.size)return true;
      const pending=Array.from(tablePending.values()),candidate=calculateTableEdits(pending);
      if(!candidate.ok){for(const field of pending)field.setAttribute('aria-invalid','true');showTableCandidate(candidate);msg(candidate.message,true);controls();return false;}
      tableCustom=tableCustom||pending.some(field=>field.dataset.cfv56TableField!=='bio');
      tableDraft=candidate.result;tablePending.clear();fillTable(tableDraft);msg('');controls();return true;
    }
    function cancelTableEdit(){if(!validAction())return;const before=tableBefore;stopTableEdit();preview=before;render(preview);msg('수치 수정을 취소했습니다.');}
    // COFIRING_ADJUSTMENT_CALORIFIC_LINK_V1
  // COFIRING_CALORIFIC_BUTTON_EMPHASIS_V2
    const calorificSavedHandler=()=>{
      if(disposed||modal.hidden)return;
      try{
        const ctx=options.getContext?.();
        if(!ctx?.settings)return;
        settings=ctx.settings;
        contextSignature=signature(ctx);
        preview=null;
        manualPreviewActive=false;
        q('[data-cfv56-transfer]').value='';
        stopTableEdit();
        render(null);
        msg('발열량 저장값을 동기화했습니다. 혼소 조정 미리보기를 다시 실행해 주세요.');
      }catch(e){
        msg(e?.message||'발열량 저장값을 혼소 조정창에 반영하지 못했습니다.',true);
      }
    };
    root.addEventListener?.('cofiring:calorific-settings-saved',calorificSavedHandler);
    function controls(){
      const hasPreview=Boolean(preview?.ok);
      q('[data-cfv56-preview-badge]').hidden=!hasPreview||tableEditing;
      q('[data-cfv56-readonly]').hidden=tableEditing;
      q('[data-cfv56-final-edit]').hidden=!tableEditing;
      q('[data-cfv56-coal-review-notice]').hidden=tableEditing||!(hasPreview&&preview.adjustment?.mode==='max_auto');
      for(const e of modal.querySelectorAll('.cfv56-adjust-body input,.cfv56-adjust-body button,[data-cfv56-reset]'))e.disabled=!ready||busy;
      // COFIRING_ACTIVE_BIO_UNIT_UI_V1: use the original calculation to keep
      // unused units at zero in every preview, even after another adjustment.
      const inactiveUnits=UNITS.filter(unit=>base?.units?.[unit]?.bio?.quantity===0);
      const transferBlocked=inactiveUnits.length>0;
      const inactiveNames=inactiveUnits.map(unit=>unit==='unit1'?'1호기':'2호기').join('·');
      const inactiveReason=transferBlocked?`${inactiveNames} Bio 미사용 · 호기 간 이동 불가`:'';
      for(const e of modal.querySelectorAll('[data-cfv56-dir],[data-cfv56-transfer],[data-cfv56-preview-transfer],[data-cfv56-cancel-transfer]')){
        e.disabled=!ready||busy||transferBlocked;
        e.title=inactiveReason;
      }
      for(const field of tableFields){
        const locked=inactiveUnits.includes(field.dataset.cfv56TableUnit)&&['bio','bioRatio'].includes(field.dataset.cfv56TableField);
        field.disabled=!ready||busy||locked;
        field.title=locked?'Bio 미사용 호기는 0으로 유지합니다.':'';
      }
      const manualCopy=q('.cfv56-manual-card .cfv56-section-head p');
      if(manualCopy)manualCopy.textContent=inactiveReason||'호기 간 Bio 배분 조정';
      const autoCopy=q('.cfv56-auto-copy-line');
      if(autoCopy)autoCopy.textContent=inactiveUnits.length===1?`${inactiveUnits[0]==='unit1'?'2호기':'1호기'} Bio만 조정 · ${inactiveNames} 0t 유지`:inactiveUnits.length===2?'Bio 미사용 · 조정할 사용량이 없습니다.':'호기별 Bio 최대량 초과 시 조정';
      q('[data-cfv56-apply]').disabled=!ready||busy||tableEditing||!preview?.ok;
      q('[data-cfv56-edit]').disabled=!ready||busy||tableEditing;
      q('[data-cfv56-edit]').textContent=tableEditing?'수정 중':'직접 수정';
      q('[data-cfv56-edit]').setAttribute('aria-pressed',String(tableEditing));
      const zeroNotices=q('[data-cfv56-zero-notices]'),zeroHtml=ready?zeroUsageHtml(base):'';
      zeroNotices.innerHTML=zeroHtml;zeroNotices.hidden=!zeroHtml;
      q('[data-cfv56-footer-hint]').textContent=tableEditing?'미리보기 후 적용해 주세요.':hasPreview?'아직 적용되지 않았습니다.':'조정 전 원본 수치입니다.';
      if(tableEditing){q('[data-cfv56-result-title]').textContent='수치 수정';q('[data-cfv56-result-note]').hidden=true;}
      for(const sel of ['[data-cfv56-close]','[data-cfv56-cancel]'])q(sel).disabled=busy;
      const calorificButton=q('[data-cfv56-calorific]');
      if(calorificButton)calorificButton.disabled=!ready||busy;
      modal.setAttribute('aria-busy',(!ready||busy)?'true':'false');
    }
    // COFIRING_ADJUSTMENT_CLEAN_CURRENT_V6
    function render(r){const result=r?.result||base;if(!result)return;
      const hasPreview=Boolean(r?.ok);
      const signed=(value,p=2)=>{const n=Number(value);if(!Number.isFinite(n))return '—';const abs=Math.abs(n).toLocaleString('ko-KR',{minimumFractionDigits:p,maximumFractionDigits:p});return `${n>0?'+':n<0?'-':'±'} ${abs}`;};
      const metric=(finalValue,baseValue,type='ton')=>{
        const finalNum=Number(finalValue),baseNum=Number(baseValue),decimals=type==='pct'?2:2,main=type==='pct'?pct(finalNum):fmt(finalNum,decimals),baseText=type==='pct'?pct(baseNum):fmt(baseNum,decimals);
        if(!hasPreview)return `<div class="cfv56-metric cfv56-metric-current"><div class="cfv56-metric-main">${main}</div></div>`;
        const delta=(Number.isFinite(finalNum)&&Number.isFinite(baseNum))?round(finalNum-baseNum,decimals):null;
        const cls=delta>0?'is-pos':delta<0?'is-neg':'is-zero';
        const suffix=type==='pct'?'%p':'';
        const icon=delta>0?'▲':delta<0?'▼':'±';
        return `<div class="cfv56-metric"><div class="cfv56-metric-main">${main}</div><div class="cfv56-metric-base">원본 ${baseText}</div><div class="cfv56-metric-delta ${cls}">${delta===0?'—':`${icon} ${signed(delta,decimals)}${suffix}`}</div></div>`;
      };
      q('[data-cfv56-final]').innerHTML=UNITS.map((u,i)=>{const x=result.units[u],b=base.units[u];return `<tr><th>${i+1}호기</th><td data-label="Coal (t)">${metric(x.coal.quantity,b.coal.quantity,'ton')}</td><td data-label="Bio (t)">${metric(x.bio.quantity,b.bio.quantity,'ton')}</td><td data-label="바이오 혼소율">${metric(ratioBio(x),ratioBio(b),'pct')}</td><td data-label="유기성 및 축분 혼소율">${metric(x.fuelRatios?.organicGroup,b.fuelRatios?.organicGroup,'pct')}</td><td data-label="종합혼소율">${metric(x.fuelRatios?.total,b.fuelRatios?.total,'pct')}</td></tr>`;}).join('');
      const resultTitle=q('[data-cfv56-result-title]'),resultSubtitle=q('.cfv56-final-head p'),resultNote=q('[data-cfv56-result-note]');
      if(resultTitle)resultTitle.textContent=hasPreview?'조정 결과':'현재 계산값';
      if(resultSubtitle)resultSubtitle.textContent=hasPreview?'원본 수치 대비 조정된 결과와 변화를 확인하세요.':'현재 계산된 원본 수치입니다.';
      if(resultNote){
        resultNote.hidden=!hasPreview;
        if(hasPreview){
          const excluded=r.adjustment?.excludedBioTons||0;
          resultNote.textContent='원본 대비 변경량을 확인한 뒤 적용해 주세요.'+(excluded>0?` Bio ${fmt(excluded)} t를 혼소 계산에서 제외합니다.`:'');
        }
      }
      if(!tableEditing)fillTable(result);controls();
    }
    function cap(){
      const max=Number(q('[data-cfv56-max]').value),hours=base.period.durationHours,limit=periodCap(max,hours);
      q('[data-cfv56-cap]').textContent=hours<=24?`일일 최대: 호기당 ${fmt(limit,2)} t · 시간 비례 감액 없음`:`선택기간 ${hours.toFixed(2)}시간 환산 최대: 호기당 ${fmt(limit,2)} t`;
      const low=Math.max(0,max-MAX_TARGET_BAND_TPD),lower=low===0?0:periodCap(low,hours);
      q('[data-cfv56-auto]').title=`최대량 초과 시 자동 목표 ${fmt(lower)}~${fmt(limit)} t`+(hours>24?' · 선택기간 환산':'');
    }
    async function open(){
      if(busy||disposed)return;const ctx=options.getContext?.();base=ctx?.result;settings=ctx?.settings;spec=ctx?.spec;
      if(!base||!settings||!spec){options.onMessage?.('먼저 기간 계산을 완료해 주세요.');return;}
      const token=++epoch;contextSignature=signature(ctx);preview=resolveStored(base,settings,spec);manualPreviewActive=false;ready=false;direction=1;
      q('[data-cfv56-transfer]').value='';stopTableEdit();selectAdjustmentTab('auto');
      for(const b of modal.querySelectorAll('[data-cfv56-dir]')){const selected=b.dataset.cfv56Dir==='1';b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));}
      q('[data-cfv56-period]').textContent=compactPeriod(spec);
      const yearNode=q('[data-cfv56-year]');
      if(yearNode){const year=String(spec.startLocal||'').slice(0,4);yearNode.textContent=(/^\d{4}$/.test(year)?year:'2026')+'년';}
      q('[data-cfv56-max]').value=maxInputText(storedMax());cap();render(preview);msg('저장된 조정값을 확인하고 있습니다.');returnFocus=root.document.activeElement;modal.hidden=false;modal.setAttribute('aria-hidden','false');q('[data-cfv56-close]').focus();
      const bundle=await loadBundle(spec,options.getHeaders);
      if(disposed||token!==epoch||modal.hidden)return;
      if(!currentContext()){msg('계산값이 변경되었습니다. 창을 닫고 다시 열어 주세요.',true);return;}
      if(bundle.loaded===false){msg(bundle.error||'저장 상태를 확인하지 못했습니다. 창을 닫고 다시 시도해 주세요.',true);return;}
      serverRevision=bundle.revision||0;preview=null;
      if(bundle.adjustment){const saved=bundle.adjustment,r=resolveAdjustment(base,settings,saved);if(r.ok)preview=r;}
      // A successful server read is authoritative, including a cleared adjustment.
      if(!bundle.adjustment)clearStored(spec);
      ready=true;q('[data-cfv56-max]').value=maxInputText(Number(bundle.setting?.maxBioTpd)||storedMax());cap();render(preview);
      msg('');
    }
    function close(){if(busy)return;++epoch;modal.hidden=true;modal.setAttribute('aria-hidden','true');if(returnFocus?.isConnected)returnFocus.focus();}
    function validAction(){if(!ready||busy)return false;if(!currentContext()){ready=false;controls();msg('계산값이 변경되었습니다. 창을 닫고 다시 열어 주세요.',true);return false;}return true;}
    function showPreview(r){stopTableEdit();preview=r;render(preview);msg(preview.ok?'':preview.message,!preview.ok);}
    for(const b of modal.querySelectorAll('[data-cfv56-dir]'))b.addEventListener('click',()=>{if(!validAction())return;stopTableEdit();manualPreviewActive=false;direction=Number(b.dataset.cfv56Dir);for(const x of modal.querySelectorAll('[data-cfv56-dir]')){x.classList.toggle('is-selected',x===b);x.setAttribute('aria-pressed',String(x===b));}preview=null;render(null);msg('선택한 방향의 이동량을 입력하고 미리보기를 눌러 주세요.');});
    for(const el of modal.querySelectorAll('[data-cfv56-transfer],[data-cfv56-max]'))el.addEventListener('input',()=>{stopTableEdit();manualPreviewActive=false;if(el.hasAttribute('data-cfv56-max'))cap();preview=null;render(null);msg('입력값이 변경되었습니다. 미리보기 또는 최대혼소 조정을 다시 실행하세요.');});
    q('[data-cfv56-calorific]')?.addEventListener('click',()=>{
      if(!ready||busy)return;
      const api=root.CofiringCalorificHistoryAdjustV1;
      if(!api?.open){msg('발열량 설정창을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.',true);return;}
      const targetDate=String(spec?.startLocal||'').slice(0,10);
      Promise.resolve(api.open(targetDate)).catch(e=>msg(e?.message||'발열량 설정창을 열지 못했습니다.',true));
    });
    q('[data-cfv56-save-max]').addEventListener('click',async()=>{if(!validAction())return;busy=true;controls();try{const saved=await saveSharedMax(Number(q('[data-cfv56-max]').value),options.getHeaders);cap();msg(saved.shared?'Bio 최대량을 공용 설정으로 저장했습니다.':'서버 저장을 확인하지 못해 이 브라우저에만 저장했습니다.',!saved.shared);}catch(e){msg(e.message,true);}finally{busy=false;controls();}});
    q('[data-cfv56-preview-transfer]').addEventListener('click',()=>{  if(!validAction())return;  const r=manualTransfer(base,settings,direction,q('[data-cfv56-transfer]').value);  manualPreviewActive=Boolean(r?.ok);  showPreview(r);});q('[data-cfv56-cancel-transfer]').addEventListener('click',()=>{  if(!validAction())return;  q('[data-cfv56-transfer]').value='';  if(manualPreviewActive){    preview=null;    manualPreviewActive=false;    render(null);    msg('수동 이동 미리보기를 취소했습니다.');    return;  }  manualPreviewActive=false;  controls();  msg(preview?.ok?'수동 이동 입력을 취소했습니다. 현재 미리보기는 유지됩니다.':'수동 이동 입력을 취소했습니다.');});
    q('[data-cfv56-auto]').addEventListener('click',()=>{manualPreviewActive=false;if(!validAction())return;showPreview(autoMax(base,settings,Number(q('[data-cfv56-max]').value)));});
    q('[data-cfv56-edit]').addEventListener('click',()=>{
      if(!validAction())return;
      tableBefore=preview;tableDraft=clone(preview?.ok?preview.result:base);
      tableCustom=preview?.adjustment?.mode==='manual_table';tablePending.clear();tableEditing=true;
      fillTable(tableDraft);controls();msg('');tableFields[0]?.focus();
    });
    for(const field of tableFields){
      field.addEventListener('input',()=>{
        if(!tableEditing||!validAction())return;
        tablePending.set(field.dataset.cfv56TableUnit+':'+field.dataset.cfv56TableField,field);
        showTableCandidate(calculateTableEdits(Array.from(tablePending.values())));
        manualPreviewActive=false;preview=null;controls();msg('입력한 항목에 맞춰 관련 수치가 함께 계산됩니다. 미리보기로 결과를 확인하세요.');
      });
      field.addEventListener('change',()=>{if(validAction())commitTableDraft();});
      field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(validAction())commitTableDraft();}});
    }
    q('[data-cfv56-cancel-edit]').addEventListener('click',cancelTableEdit);
    q('[data-cfv56-preview-final]').addEventListener('click',()=>{
      manualPreviewActive=false;if(!validAction())return;
      if(tableEditing){
        if(!commitTableDraft())return;
        const values=tableValues(tableDraft);
        const r=tableCustom?adjustTable(base,settings,values):adjustFinal(base,settings,values.finalBioUnit1,values.finalBioUnit2,{mode:'manual_final'});
        if(!r.ok){msg(r.message,true);return;}showPreview(r);return;
      }
      // Retain the established Bio-only direct-preview entry contract.
      const v1=q('[data-cfv56-final1]').value,v2=q('[data-cfv56-final2]').value;
      if(v1.trim()===''||v2.trim()===''){preview=null;controls();msg('두 호기의 최종 Bio를 모두 입력해 주세요. 사용량이 없으면 0을 입력하세요.',true);return;}
      showPreview(adjustFinal(base,settings,Number(v1),Number(v2),{mode:'manual_final'}));
    });
            // COFIRING_ACTIVE_ADJUSTMENT_RESET_API_V1
        async function resetApplied(){
          if(busy||disposed)return false;
          const ctx=options.getContext?.();
          const currentBase=ctx?.result,currentSettings=ctx?.settings,currentSpec=ctx?.spec;
          if(!currentBase||!currentSettings||!currentSpec)throw new Error('먼저 기간 계산을 완료해 주세요.');
          busy=true;controls();
          try{
            const bundle=await loadBundle(currentSpec,options.getHeaders);
            if(bundle.loaded===false)throw new Error(bundle.error||'저장 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
            if(bundle.adjustment){
              const cleared=await clearServerAdjustment(currentSpec,bundle.revision||0,options.getHeaders);
              serverRevision=Number(cleared?.entry?.revision)||Number(bundle.revision||0)+1;
            }else{
              serverRevision=Number(bundle.revision)||serverRevision;
            }
            base=currentBase;settings=currentSettings;spec=currentSpec;
            clearStored(currentSpec);preview=null;
            options.onReset?.();
            return true;
          }catch(e){
            throw new Error(e?.message||'원복을 저장하지 못했습니다. 기존 조정값을 유지합니다.');
          }finally{
            busy=false;controls();
          }
        }
    q('[data-cfv56-apply]').addEventListener('click',async()=>{if(!validAction()||!preview?.ok)return;busy=true;controls();try{msg('혼소 조정값을 저장하고 있습니다.');const saved=await saveServerAdjustment(spec,preview,serverRevision,options.getHeaders);serverRevision=Number(saved?.entry?.revision)||serverRevision+1;saveStored(spec,base,preview);options.onApply?.(preview.result,preview.adjustment);busy=false;close();}catch(e){msg(e.message||'혼소 조정 저장을 완료하지 못했습니다.',true);}finally{busy=false;controls();}});
    q('[data-cfv56-reset]').addEventListener('click',async()=>{if(!validAction())return;busy=true;controls();try{await clearServerAdjustment(spec,serverRevision,options.getHeaders);serverRevision+=1;clearStored(spec);preview=null;options.onReset?.();busy=false;close();}catch(e){msg(e.message||'원복을 저장하지 못했습니다. 기존 조정값을 유지합니다.',true);}finally{busy=false;controls();}});
    for(const sel of ['[data-cfv56-close]','[data-cfv56-cancel]'])q(sel).addEventListener('click',close);
    modal.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=Array.from(modal.querySelectorAll('button:not(:disabled),input:not(:disabled)')).filter(x=>!x.closest('[hidden]'));if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&root.document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&root.document.activeElement===last){e.preventDefault();first.focus();}}});
    return {open,close,isOpen:()=>!modal.hidden,isBusy:()=>busy,resetApplied,resolve:(result,currentSettings,currentSpec)=>resolveStored(result,currentSettings,currentSpec),clear:()=>spec&&clearStored(spec),dispose(){root.removeEventListener?.('cofiring:calorific-settings-saved',calorificSavedHandler);disposed=true;++epoch;modal.remove();}};
  }
  root.CofiringPeriodAdjustmentV56={periodCap,adjustFinal,adjustTable,editTableValue,resolveAdjustment,manualTransfer,autoMax,replayAutoMax,resolveStored,resolveServer,create,modalHtml,DEFAULT_MAX_TPD,API};
  if(typeof module==='object'&&module.exports)module.exports=root.CofiringPeriodAdjustmentV56;
})(typeof globalThis==='object'?globalThis:this);
