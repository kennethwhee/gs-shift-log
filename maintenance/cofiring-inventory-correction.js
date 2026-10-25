/* Operator inventory boundaries are a separate, auditable calculation input.
   They never change the stored DataPARC report or its quality classification. */
(function(root){
  'use strict';
  const core=root.CofiringCore||(typeof require==='function'?require('./cofiring-core.js'):null);
  const contract=root.CofiringLiveContract||(typeof require==='function'?require('./cofiring-live-contract.js'):null);
  const definitions=Object.freeze([
    Object.freeze({key:'organicDaySilo',label:'Day Silo',tag:'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT'}),
    Object.freeze({key:'organicStorageSiloA',label:'Storage Silo A',tag:'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT'}),
    Object.freeze({key:'organicStorageSiloB',label:'Storage Silo B',tag:'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'})
  ]);
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const tons=value=>finite(value)&&value>=0&&value<=1000000;
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const fail=(code,message,missing=[])=>({ok:false,code,message,inventory:null,corrections:[],provisional:false,missing});
  function localMinute(value){
    if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)||value<'2021-01-01T00:00')return null;
    const ms=Date.parse(value+':00+09:00');
    return Number.isFinite(ms)&&new Date(ms+32400000).toISOString().slice(0,16)===value?ms:null;
  }
  function boundaryKey(silo,boundaryLocal){return `${silo}|${boundaryLocal}`;}
  function validCorrection(entry){
    if(!object(entry)||!definitions.some(def=>def.key===entry.silo)||localMinute(entry.boundaryLocal)===null||
       !tons(entry.tons)||!['confirmed','estimated'].includes(entry.method)||
       typeof entry.reason!=='string'||entry.reason.trim().length<1||entry.reason.length>2000||
       !Number.isSafeInteger(entry.revision)||entry.revision<1||
       typeof entry.updatedById!=='string'||!entry.updatedById.trim()||entry.updatedById.length>100||
       typeof entry.updatedByName!=='string'||!entry.updatedByName.trim()||entry.updatedByName.length>200||
       typeof entry.updatedAt!=='string'||!Number.isFinite(Date.parse(entry.updatedAt))||
       !Array.isArray(entry.evidence)||entry.evidence.length>100)return false;
    const ids=new Set();
    for(const evidence of entry.evidence){
      if(!object(evidence)||typeof evidence.id!=='string'||!evidence.id.trim()||evidence.id.length>200||
         !Number.isSafeInteger(evidence.version)||evidence.version<1||ids.has(evidence.id))return false;
      ids.add(evidence.id);
    }
    return true;
  }
  function endpoint(sample,side,p){
    const value=sample[side+'Value'],quality=sample[side+'Quality'],returnedTime=sample[side+'Time'];
    // An offset is required: a browser's own timezone must never change a source instant.
    const time=typeof returnedTime==='string'&&/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(returnedTime)?Date.parse(returnedTime):NaN;
    let reason='';
    if(!tons(value))reason='재고값 없음 또는 범위 오류';
    else if(!contract.good(quality))reason='통신·품질 오류';
    else if(!Number.isFinite(time)||(side==='start'?(time<p.startMs-86400000||time>p.startMs):(time<p.startMs||time>=p.endMs+60000)))reason='경계 시각 확인 필요';
    return {ok:!reason,value:tons(value)?value:null,quality:typeof quality==='string'?quality:'',returnedTime:typeof returnedTime==='string'?returnedTime:'',reason};
  }
  // Read-only, provisional approximation from the existing DataPARC period statistics.
  // The FnTagStat Delta is the period change of the available good readings,
  // NOT a certified midnight boundary. Never write this into correction history.
  // Reject broad, stale, conflicting or insufficient evidence rather than filling zero.
  function estimateBoundary(sample,side,other,p){
    if(!other?.ok||!object(sample)||sample.durationCoverageValid!==true)return null;
    const expected=p.durationMinutes*60;
    if(!finite(expected)||expected<300||!finite(sample.durationGoodSeconds)||!finite(sample.durationBadSeconds)||
       sample.durationBadSeconds<0||sample.durationBadSeconds>3600||
       sample.durationGoodSeconds<expected*0.90||
       Math.abs(sample.durationGoodSeconds+sample.durationBadSeconds-expected)>2)return null;
    const {min,max,delta}=sample;
    if(!tons(min)||!tons(max)||max<min||!finite(delta)||Math.abs(delta)>(max-min)+1)return null;
    const rawTime=sample[side+'Time'];
    if(typeof rawTime!=='string'||!/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(rawTime))return null;
    const timestamp=Date.parse(rawTime),boundary=p[side+'Ms'];
    if(!finite(timestamp)||!finite(boundary)||timestamp>boundary+60000||boundary-timestamp>3600000)return null;
    const calculated=side==='end'?other.value+delta:other.value-delta;
    if(!tons(calculated)||calculated<min-0.5||calculated>max+0.5)return null;
    const estimate=Math.round(Math.max(min,Math.min(max,calculated))*1e6)/1e6;
    // Delta can bound an approximation, but cannot turn Bad/NODATA into Good.
    return {value:estimate,basis:'dataparc-period-delta-v2',sourceTime:rawTime,
      min,max,delta,durationBadSeconds:sample.durationBadSeconds};
  }
  function resolve(reference,corrections=[],spec=reference,options={}){
    if(!core||!contract)return fail('INVENTORY_CORRECTION_UNAVAILABLE','재고 보완 모듈을 불러오지 못했습니다. 화면을 새로고침해 주세요.');
    if(!object(reference)||!object(spec)||reference.startLocal!==spec.startLocal||reference.endLocal!==spec.endLocal||
       (reference.kind!==undefined&&reference.kind!=='cofiring_period_summary_v1')||(reference.schemaVersion!==undefined&&reference.schemaVersion!==1)||
       ['stepUnit','stepValue'].some(key=>reference[key]!==undefined&&spec[key]!==undefined&&reference[key]!==spec[key])||
       localMinute(spec.startLocal)===null||localMinute(spec.endLocal)===null)return fail('ORGANIC_PERIOD_MISMATCH','유기성 재고와 선택한 조회 기간이 다릅니다.');
    let p;
    try{p=contract.period({startLocal:spec.startLocal,endLocal:spec.endLocal,stepUnit:spec.stepUnit??reference.stepUnit??'minute',stepValue:spec.stepValue??reference.stepValue??1},Number.MAX_SAFE_INTEGER);}
    catch(_){return fail('ORGANIC_PERIOD_MISMATCH','유기성 재고와 선택한 조회 기간이 다릅니다.');}
    if(!Array.isArray(corrections)||corrections.length>6)return fail('ORGANIC_CORRECTION_INVALID','재고 보완 저장값을 다시 불러와 주세요.');
    const entries=new Map();
    for(const entry of corrections){
      const key=boundaryKey(entry?.silo,entry?.boundaryLocal);
      if(!validCorrection(entry)||![p.startLocal,p.endLocal].includes(entry.boundaryLocal)||entries.has(key))return fail('ORGANIC_CORRECTION_INVALID','재고 보완의 기간·중복·저장 이력을 확인해 주세요.');
      entries.set(key,entry);
    }
    if(reference.organicInventory&&reference.organicInventoryReady!==false){
      try{
        const inventory=contract.validateOrganicInventory(reference.organicInventory,p);
        return {ok:true,inventory,corrections:[],provisional:false,missing:[]};
      }catch(_){return fail('ORGANIC_INVENTORY_INVALID','유기성 원본 재고의 기간·TAG·품질을 확인해 주세요.');}
    }
    if(reference.organicInventory!=null)return fail('ORGANIC_INVENTORY_INVALID','유기성 원본 재고의 준비 상태가 일치하지 않습니다.');
    const samples=reference.organicInventorySamples;
    if(!Array.isArray(samples)||samples.length!==definitions.length)return fail('ORGANIC_INVENTORY_MISSING','유기성 3개 Silo의 원본 재고 경계 자료가 필요합니다. 재조회해 주세요.');
    const sampleMap=new Map(samples.map(sample=>[sample?.key,sample]));
    if(sampleMap.size!==definitions.length)return fail('ORGANIC_INVENTORY_INVALID','유기성 원본 재고 TAG가 중복되었습니다.');
    const start={},end={},boundaries={start:{},end:{}},used=[],missing=[],autoEstimates=[];
    let incomplete=false;
    for(const def of definitions){
      const sample=sampleMap.get(def.key);
      if(!object(sample)||sample.key!==def.key||sample.label!==def.label||sample.tag!==def.tag)return fail('ORGANIC_INVENTORY_INVALID','유기성 원본 재고 TAG가 일치하지 않습니다.');
      if(!finite(sample.durationGoodSeconds)||sample.durationGoodSeconds<0||!finite(sample.durationBadSeconds)||sample.durationBadSeconds<0||
         Math.abs(sample.durationGoodSeconds+sample.durationBadSeconds-p.durationMinutes*60)>2||sample.durationCoverageValid!==true)return fail('ORGANIC_INVENTORY_INVALID','유기성 원본 재고의 조회 기간·품질 지속시간을 확인해 주세요.');
      const sides={start:endpoint(sample,'start',p),end:endpoint(sample,'end',p)};
      // A false worker check without an unavailable endpoint is unexplained.
      if(sides.start.ok&&sides.end.ok&&(sample.boundaryValid!==true||sample.dataComplete!==true))return fail('ORGANIC_INVENTORY_INVALID','유기성 원본 재고의 경계 검증 결과가 일치하지 않습니다.');
      for(const side of ['start','end']){
        const raw=sides[side],boundaryLocal=p[side+'Local'],entry=entries.get(boundaryKey(def.key,boundaryLocal)),target=side==='start'?start:end;
        if(raw.ok){
          target[def.key]=raw.value;
          boundaries[side][def.key]={source:'dataparc',value:raw.value,boundaryLocal,returnedTime:raw.returnedTime,quality:raw.quality};
          continue;
        }
        missing.push({silo:def.key,label:def.label,side,boundaryLocal,value:raw.value,quality:raw.quality,returnedTime:raw.returnedTime,reason:raw.reason,correction:entry?clone(entry):null});
        if(!entry){
          const auto=options.enableAutoEstimate===true?estimateBoundary(sample,side,sides[side==='start'?'end':'start'],p):null;
          if(auto){
            target[def.key]=auto.value;
            const estimate={silo:def.key,label:def.label,side,boundaryLocal,tons:auto.value,
              basis:auto.basis,sourceTime:auto.sourceTime,min:auto.min,max:auto.max,delta:auto.delta,
              durationBadSeconds:auto.durationBadSeconds};
            autoEstimates.push(estimate);
            boundaries[side][def.key]={source:'dataparc-estimate',value:auto.value,boundaryLocal,estimate};
            continue;
          }
          incomplete=true;target[def.key]=null;continue;
        }
        const correction=clone(entry);used.push(correction);target[def.key]=entry.tons;
        boundaries[side][def.key]={source:'operator',value:entry.tons,boundaryLocal,correction};
      }
    }
    if(incomplete)return {...fail('ORGANIC_BOUNDARY_CORRECTION_REQUIRED','통신 오류로 확인되지 않은 재고 경계값을 확인해 주세요. 자동 추정 근거가 부족합니다.',missing),corrections:used,autoEstimates,provisional:used.some(entry=>entry.method==='estimated')||autoEstimates.length>0};
    start.total=definitions.reduce((total,def)=>total+start[def.key],0);
    end.total=definitions.reduce((total,def)=>total+end[def.key],0);
    if(!used.length&&!autoEstimates.length){
      try{
        const inventory=contract.validateOrganicInventory({schemaVersion:1,basis:'dataparc_period_boundary',startLocal:p.startLocal,endLocal:p.endLocal,start,end,samples},p);
        return {ok:true,inventory,corrections:[],provisional:false,missing};
      }catch(_){return fail('ORGANIC_INVENTORY_INVALID','유기성 원본 재고의 경계 검증을 통과하지 못했습니다.');}
    }
    const inventory={schemaVersion:1,basis:autoEstimates.length?'provisional_dataparc_period_boundary':'operator_corrected_period_boundary',startLocal:p.startLocal,endLocal:p.endLocal,start,end,samples:clone(samples),boundaries};
    return {ok:true,inventory,corrections:used,autoEstimates,provisional:autoEstimates.length>0||used.some(entry=>entry.method==='estimated'),missing};
  }
  function usage(reference,receipt,spec=reference,corrections=[],options={}){
    const resolved=resolve(reference,corrections,spec,options);
    if(!resolved.ok)return {...resolved,usage:null,allocation:null};
    if(!resolved.corrections.length&&!resolved.autoEstimates?.length){
      const result=core.organicInventoryUsage({...reference,organicInventoryReady:true,organicInventory:resolved.inventory},receipt,spec,options);
      return {...result,inventory:resolved.inventory,corrections:[],provisional:false,missing:resolved.missing};
    }
    const {inventory,provisional}=resolved;
    if(!finite(receipt)||receipt<0)return {...resolved,ok:false,code:'ORGANIC_RECEIPT_MISSING',message:'선택 기간의 유기성 입고량 확인이 필요합니다.',usage:null,allocation:null};
    const startTotal=inventory.start.total,endTotal=inventory.end.total,rawUsage=startTotal+receipt-endTotal;
    const provisionalZero=options.allowProvisionalZero===true&&rawUsage<0;
    const base={...resolved,basis:resolved.autoEstimates?.length?'dataparc-estimated-inventory-balance-v2':'operator-corrected-inventory-balance-v1',startLocal:spec.startLocal,endLocal:spec.endLocal,startTotal,endTotal,receipt,rawUsage,provisionalZero};
    if(rawUsage<-.05&&!provisionalZero)return {...base,ok:false,code:'ORGANIC_BALANCE_NEGATIVE',message:'시작재고 + 입고량보다 종료재고가 큽니다. 원본 값과 보완값을 확인해 주세요.',usage:null,allocation:null};
    const quantity=Math.max(0,rawUsage),half=Math.round(quantity/2*10000)/10000;
    return {...base,ok:true,usage:quantity,allocation:{unit1:half,unit2:half,total:half*2,diff:quantity-half*2,ok:true,mode:'equal-50-50'},
      ...(provisionalZero?{code:'ORGANIC_BALANCE_NEGATIVE',message:'원본 사용량 '+rawUsage.toFixed(2)+' t · 0.00 t 임시 표시 · 입고량·재고수지 확인 필요.'}:
        provisional?{message:'추정 재고로 계산한 임시 결과입니다. 확인값을 저장한 뒤 사용량 저장·마감할 수 있습니다.'}:{message:'확인한 재고 보완값으로 계산했습니다. 원본 DataPARC 품질은 변경하지 않습니다.'})};
  }
  const api=Object.freeze({definitions,localMinute,boundaryKey,validCorrection,estimateBoundary,resolve,usage});
  root.CofiringInventoryCorrection=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
