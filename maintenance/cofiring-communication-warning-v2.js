/* Read-only banner from the current DataPARC report and provisional balance.
   No calculations, saved records, or sensor quality codes are changed here. */
(function(root){
  'use strict';
  const fuelNames={coal:'Coal',bio:'Bio',organic:'유기성 고형연료',manure:'축분'};
  const siloNames={organicDaySilo:'Day Silo',organicStorageSiloA:'Storage A',organicStorageSiloB:'Storage B'};
  const dateLabel=local=>{
    const m=/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local||'');
    return m?`${Number(m[1])}월 ${Number(m[2])}일 ${m[3]}:${m[4]}`:'기준 시각 확인 필요';
  };
  function messages(reference,organicUsage){
    if(!reference)return [];
    const result=[],seen=new Set();
    const append=(key,value)=>{if(!seen.has(key)){seen.add(key);result.push(value);}};
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
      append(key,`${subject} ${suffix}`);
    }
    const good=value=>typeof root.CofiringLiveContract?.good==='function'?root.CofiringLiveContract.good(value):/Good/i.test(String(value||''))&&!/Bad/i.test(String(value||''));
    const summaries=Array.isArray(reference.summaries)?reference.summaries:[];
    for(const item of summaries){
      if(!['unit1','unit2'].includes(item?.unit)||!fuelNames[item.fuel])continue;
      const badStart=!good(item.startQuality)||item.startBoundaryRecovered===true;
      const badEnd=!good(item.endQuality)||item.endBoundaryRecovered===true;
      for(const side of ['start','end']){
        if(!(side==='start'?badStart:badEnd))continue;
        const time=reference[side+'Local'];
        append(`fuel:${item.unit}:${item.fuel}:${side}:${time}`,`${item.unit==='unit1'?'1호기':'2호기'} ${fuelNames[item.fuel]} · ${dateLabel(time)} 기준 통신·계측 품질 확인이 필요합니다.`);
      }
    }
    return result;
  }
  function render(host,reference,organicUsage){
    if(!host)return [];
    const lines=messages(reference,organicUsage);
    host.hidden=lines.length===0;
    host.textContent=lines.length?'⚠ '+lines.join(' / '):'';
    return lines;
  }
  const api=Object.freeze({dateLabel,messages,render});
  root.CofiringCommunicationWarningV2=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
