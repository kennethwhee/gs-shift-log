/* COFIRING_QUALITY_NOTICE_V3
   Status is derived from the validated DataPARC report, not the presence of a raw
   Good label alone. A verified statistical boundary fallback is informational.
   Genuine quality gaps, unsupported fallbacks and unknown quality remain warnings.
   Read-only presentation: never changes usage, raw reference, storage or closure. */
(function(root){
  'use strict';
  const fuelNames={coal:'Coal',bio:'Bio',organic:'유기성 고형연료',manure:'축분'};
  const siloNames={organicDaySilo:'Day Silo',organicStorageSiloA:'Storage A',organicStorageSiloB:'Storage B'};
  const dateLabel=local=>{
    const m=/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local||'');
    return m?`${Number(m[1])}월 ${Number(m[2])}일 ${m[3]}:${m[4]}`:'기준 시각 확인 필요';
  };
  const good=q=>typeof root.CofiringLiveContract?.good==='function'
    ?root.CofiringLiveContract.good(q)
    :typeof q==='string'&&/^(?:good|raw\s*,\s*good|good\s*,\s*raw)$/i.test(q.trim());
  const noData=q=>typeof q==='string'&&/^(?:no\s*data\s*,\s*bad|bad\s*,\s*no\s*data)$/i.test(q.trim());
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const equal=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=0.001;
  function verifiedRecovery(item,side){
    // These requirements mirror the actual validated live-contract fallback lane.
    // A bare startBoundaryRecovered flag is NOT sufficient evidence of success.
    if(item?.fuel!=='bio'||item.boundaryValid!==true||item.durationCoverageValid!==true||item.dataComplete!==true||
       !finite(item.durationBadSeconds)||item.durationBadSeconds>0.001||
       !finite(item.usageTon)||item.usageTon<0||
       !finite(item.effectiveStartValue)||!finite(item.effectiveEndValue)||
       !equal(item.effectiveEndValue-item.effectiveStartValue,item.usageTon))return false;
    const both=item.usageBasis==='constant_bio_counter_full_good_both_nodata_fallback'
      &&item.startBoundaryFallbackApplied===true&&item.endBoundaryFallbackApplied===true
      &&item.startBoundaryRecovered===true&&item.endBoundaryRecovered===true
      &&item.startValue===null&&item.endValue===null
      &&noData(item.startQuality)&&noData(item.endQuality)
      &&finite(item.min)&&finite(item.max)&&equal(item.min,item.max)
      &&item.delta===0&&item.usageTon===0
      &&equal(item.startBoundaryFallbackValue,item.min)&&equal(item.endBoundaryFallbackValue,item.max);
    if(both)return true;
    if(side==='start')return item.startBoundaryFallbackApplied===true&&item.endBoundaryFallbackApplied===false
      &&item.startBoundaryRecovered===true&&item.endBoundaryRecovered!==true
      &&item.usageBasis==='end_minus_period_min_start_nodata_fallback'
      &&item.startValue===null&&noData(item.startQuality)&&good(item.endQuality)
      &&finite(item.endValue)&&equal(item.effectiveEndValue,item.endValue)
      &&equal(item.startBoundaryFallbackValue,item.min)
      &&equal(item.effectiveStartValue,item.startBoundaryFallbackValue);
    if(side==='end')return item.endBoundaryFallbackApplied===true&&item.startBoundaryFallbackApplied===false
      &&item.endBoundaryRecovered===true&&item.startBoundaryRecovered!==true
      &&item.usageBasis==='period_max_end_nodata_fallback_minus_start_boundary'
      &&item.endValue===null&&noData(item.endQuality)&&good(item.startQuality)
      &&finite(item.startValue)&&equal(item.effectiveStartValue,item.startValue)
      &&equal(item.endBoundaryFallbackValue,item.max)
      &&equal(item.effectiveEndValue,item.endBoundaryFallbackValue);
    return false;
  }
  function notices(reference,organicUsage){
    if(!reference)return [];
    const result=[],seen=new Set();
    function add(key,level,text){
      if(!seen.has(key)){seen.add(key);result.push({level,text});}
    }
    const missing=Array.isArray(organicUsage?.missing)?organicUsage.missing:[];
    const auto=Array.isArray(organicUsage?.autoEstimates)?organicUsage.autoEstimates:[];
    const saved=Array.isArray(organicUsage?.corrections)?organicUsage.corrections:[];
    for(const item of missing){
      if(!siloNames[item?.silo])continue;
      const key=`${item.silo}|${item.boundaryLocal}`;
      const automatic=auto.some(row=>`${row.silo}|${row.boundaryLocal}`===key);
      const correction=saved.find(row=>`${row.silo}|${row.boundaryLocal}`===key);
      const subject=`1·2호기 유기성 고형연료(${siloNames[item.silo]}) · ${dateLabel(item.boundaryLocal)}`;
      const suffix=automatic?(organicUsage?.ok?'기준 통신 오류로 재고 추정값이 적용되었습니다. 정확한 값이 아닐 수 있으므로 재확인이 필요합니다.':'기준 통신 오류 재고를 자동 추정했지만 수지 확인에 실패했습니다. 값의 재확인이 필요합니다.') :
        correction?.method==='estimated'?'기준 통신 오류로 추정 재고가 적용되었습니다. 정확한 값이 아닐 수 있으므로 재확인이 필요합니다.':
        correction?.method==='confirmed'?'기준 통신 오류의 확인 재고가 적용되었습니다. 원본 계측 자료는 재확인이 필요합니다.':
        '기준 통신 오류로 재고를 확인할 수 없습니다. 재조회 및 재확인이 필요합니다.';
      add(key,'warning',`${subject} ${suffix}`);
    }
    for(const item of Array.isArray(reference.summaries)?reference.summaries:[]){
      if(!['unit1','unit2'].includes(item?.unit)||!fuelNames[item.fuel])continue;
      const subject=`${item.unit==='unit1'?'1호기':'2호기'} ${fuelNames[item.fuel]}`;
      // Internal quality gaps are real evidence even when boundary subtraction succeeds.
      // Do not falsely attribute an internal gap to the 00:00 boundary.
      const gap=finite(item.durationBadSeconds)&&item.durationBadSeconds>0.001;
      if(gap||item.dataComplete===false){
        const amount=gap?` ${item.durationBadSeconds.toFixed(1)}초`:'';
        add(`fuel:${item.unit}:${item.fuel}:gap`,'warning',`${subject} · 조회 기간 중 계측 품질 공백${amount}이 확인되었습니다. 시작·종료 누적값으로 사용량을 계산했더라도 원본 확인이 필요합니다.`);
      }
      for(const side of ['start','end']){
        const recovered=item[side+'BoundaryRecovered']===true;
        const qualityGood=good(item[side+'Quality']);
        if(qualityGood&&!recovered)continue;
        const time=reference[side+'Local'];
        if(verifiedRecovery(item,side)){
          const both=item.startBoundaryRecovered===true&&item.endBoundaryRecovered===true;
          if(both&&side==='end')continue; // Show one informational row for both verified boundaries.
          const label=both?'전체 기간 동일 누적계 값 검증 후 Bio 0t':side==='start'?'검증된 DataPARC 기간 최솟값':'검증된 DataPARC 기간 최댓값';
          add(`fuel:${item.unit}:${item.fuel}:${both?'both':side}:${time}`,'info',
            `${subject} · ${dateLabel(time)} 원본 누적 경계값이 조회되지 않아 ${label}으로 사용량 계산을 완료했습니다. (대체 기준 사용)`);
        }else{
          add(`fuel:${item.unit}:${item.fuel}:${side}:${time}`,'warning',
            `${subject} · ${dateLabel(time)} 원본 누적 경계값의 품질 또는 복원 근거가 확인되지 않았습니다. 재확인이 필요합니다.`);
        }
      }
    }
    return result;
  }
  function messages(reference,organicUsage){return notices(reference,organicUsage).map(item=>item.text);}
  function render(host,reference,organicUsage){
    if(!host)return [];
    const entries=notices(reference,organicUsage),lines=entries.map(entry=>entry.text);
    host.hidden=lines.length===0;
    if(host.dataset)host.dataset.tone=entries.some(x=>x.level==='warning')?'warning':'info';
    // A long list of per-counter quality details is available in the separate
    // "자료 확인 내용" fold, but must not flood the primary calculation header.
    // Only the *display* is shortened; notices(), warnings and raw report stay intact.
    const missing=Array.isArray(organicUsage?.missing)?organicUsage.missing:[];
    const stock=missing.find(x=>x?.silo==='organicStorageSiloB'&&
      ['start','end'].includes(x?.side)&&typeof x.boundaryLocal==='string'&&x.boundaryLocal.endsWith('T00:00'));
    // Preserve the original V3 detailed-warning contract for external clients.
    const compact=stock&&(organicUsage?.code==='ORGANIC_BOUNDARY_CORRECTION_REQUIRED'||
      organicUsage?.code==='ORGANIC_SHARED_BOUNDARY_CONFLICT'||organicUsage?.provisional===true||
      (Array.isArray(organicUsage?.corrections)&&organicUsage.corrections.some(x=>x.silo==='organicStorageSiloB'&&x.boundaryLocal===stock.boundaryLocal)));
    if(compact){
      host.textContent='⚠ 1·2호기 유기성(Storage B) · '+dateLabel(stock.boundaryLocal)+' 원본 재고 계측 오류 · 재확인 필요';
      host.title=lines.join(' / ');
    }else{
      host.textContent=lines.length?(entries.some(x=>x.level==='warning')?'⚠ ':'ℹ ')+lines.join(' / '):'';
      host.title='';
    }
    return lines;
  }
  const api=Object.freeze({dateLabel,verifiedRecovery,notices,messages,render});
  root.CofiringCommunicationWarningV2=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
