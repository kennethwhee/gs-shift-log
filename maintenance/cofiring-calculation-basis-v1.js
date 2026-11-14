/* COFIRING_CALCULATION_BASIS_V1
   Read-only presentation metadata for a fully calculated, direct counter result.
   Calculation completion never rewrites the historian's quality or stored usage. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CofiringCalculationBasisV1=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const UNITS=['unit1','unit2'],FUELS=['coal','bio','organic','manure'];
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const equal=(a,b,tolerance=.001)=>finite(a)&&finite(b)&&Math.abs(a-b)<=tolerance;
  const good=value=>typeof value==='string'&&/^(?:good|raw\s*,\s*good|good\s*,\s*raw)$/i.test(value.trim());
  const clear=value=>value===undefined||value===false;
  const noIssues=value=>Array.isArray(value)&&value.length===0;
  const definitions=UNITS.flatMap((unit,index)=>['A1','A2','B1','B2'].map(feeder=>({
    id:unit+'Coal'+feeder,unit,fuel:'coal',
    tag:'GSPOGE.ABB_DCS.BLR'+(index+1)+' COAL FEEDER '+feeder[0]+'-'+feeder[1]+' REFERENSE'
  })).concat([{id:unit+'Bio',unit,fuel:'bio',tag:'GSPOGE.ABB_DCS.BLR'+(index+1)+' BIO SRF REFERENCE'}]));
  function periodBounds(period){
    if(!period||period.mode!=='period'||period.timeZone!=='Asia/Seoul'||
       !/^20\d\d-\d\d-\d\dT\d\d:\d\d$/.test(period.startLocal||'')||
       !/^20\d\d-\d\d-\d\dT\d\d:\d\d$/.test(period.endLocal||'')||
       !finite(period.durationMinutes)||period.durationMinutes<=0||
       !finite(period.durationHours)||period.durationHours!==period.durationMinutes/60)return null;
    const start=Date.parse(period.startLocal+':00+09:00'),end=Date.parse(period.endLocal+':00+09:00');
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||
       period.startMs!==start||period.endMs!==end||
       (end-start)/60000!==period.durationMinutes||Date.parse(period.start)!==start||Date.parse(period.end)!==end)return null;
    return {start,end,seconds:period.durationMinutes*60};
  }
  function validStateRead(item,side,target){
    const read=item[side+'BoundaryRead'];
    if(!read||read.schemaVersion!==1||read.sourceFunction!=='fnAtTimeArray'||
       !['State','Exact'].includes(read.method)||read.value!==item[side+'Value']||
       read.quality!==item[side+'Quality']||!good(read.quality)||Date.parse(read.asOfTime)!==target)return false;
    const source=Date.parse(read.sourceTime);
    return Number.isFinite(source)&&source===Date.parse(item[side+'Time'])&&
      (read.method==='Exact'?source===target:source<=target);
  }
  function inspectCounter(counter,definition,bounds){
    const item=counter?.summary;
    if(!counter||counter.id!==definition.id||counter.complete!==true||!noIssues(counter.issues)||
       !finite(counter.quantity)||counter.quantity<0||!finite(counter.referenceQuantity)||
       counter.startBoundaryRecovered!==false||counter.endBoundaryRecovered!==false||
       counter.constantCounterRecovered!==false||!item||item.key!==definition.id||
       item.unit!==definition.unit||item.fuel!==definition.fuel||item.tag!==definition.tag||
       counter.tag!==undefined&&counter.tag!==definition.tag+'/PLOT')return null;
    if(!clear(item.startBoundaryFallbackApplied)||!clear(item.endBoundaryFallbackApplied)||
       !clear(item.startBoundaryRecovered)||!clear(item.endBoundaryRecovered)||
       !clear(item.constantBioCounterBothNoDataFallbackApplied)||item.constantNoInteriorSamples===true||
       item.boundaryValid!==true||item.durationCoverageValid!==true||
       !good(item.startQuality)||!good(item.endQuality))return null;
    const state=item.usageBasis==='end_minus_start_totalizer_asof';
    if(state){
      if(counter.totalizerStateCounter!==true||item.totalizerStateVerified!==true||
         !validStateRead(item,'start',bounds.start)||!validStateRead(item,'end',bounds.end))return null;
      const first=Date.parse(item.startTime),last=Date.parse(item.endTime);
      if(last<first||last===first&&item.startValue!==item.endValue||last<=bounds.start&&first!==last)return null;
    }else{
      if(item.usageBasis!=='end_minus_start_boundary'||item.totalizerStateVerified===true)return null;
      const first=Date.parse(item.startTime),last=Date.parse(item.endTime);
      if(!Number.isFinite(first)||first<bounds.start||first>=bounds.start+60000||
         !Number.isFinite(last)||last<bounds.end||last>=bounds.end+60000)return null;
    }
    for(const key of ['startValue','endValue','effectiveStartValue','effectiveEndValue','min','max','delta','usageTon','durationGoodSeconds','durationBadSeconds']){
      if(!finite(item[key])||item[key]<0)return null;
    }
    const usage=item.endValue-item.startValue,spread=item.max-item.min,bad=item.durationBadSeconds;
    if(usage<0||spread<0||!equal(item.effectiveStartValue,item.startValue)||!equal(item.effectiveEndValue,item.endValue)||
       !equal(item.usageTon,usage)||!equal(counter.quantity,usage)||!equal(counter.referenceQuantity,usage)||
       !equal(item.delta,spread)||item.min+.001<item.startValue||item.max-.001>item.endValue||
       item.rangeSpread!==undefined&&item.rangeSpread!==null&&!equal(item.rangeSpread,spread)||
       Math.abs(item.durationGoodSeconds+bad-bounds.seconds)>2||
       !finite(counter.qualityGapSeconds)||!equal(counter.qualityGapSeconds,bad,.000001)||
       counter.qualityVerified!==(bad<=.001)||item.dataComplete!==(bad<=.001))return null;
    return {id:definition.id,unit:definition.unit,fuel:definition.fuel,gap:bad};
  }
  function describe(result){
    if(!result||result.sourceKind!=='dataparc-period-summary'||result.qualityVerified!==false||
       result.adjustment?.applied===true||result.hypothesisDisplay||result.error||
       !result.organicUsage||result.organicUsage.ok!==true||result.organicUsage.error||
       result.organicUsage.provisional===true||result.organicUsage.provisionalZero===true||
       result.organicUsage.estimated===true||result.organicUsage.scenario||result.organicUsage.sharedScenarioPending||
       Array.isArray(result.organicUsage.autoEstimates)&&result.organicUsage.autoEstimates.length||
       Array.isArray(result.organicUsage.corrections)&&result.organicUsage.corrections.some(item=>item?.method==='estimated'))return null;
    const bounds=periodBounds(result.period);if(!bounds)return null;
    const inspected=[];
    for(const unit of UNITS){
      const value=result.units?.[unit];
      if(!value||value.complete!==true||!finite(value.heats?.total)||value.heats.total<=0||
         !['bio','organic','total'].every(key=>finite(value.ratios?.[key]))||
         !['bio','organic','manure','organicGroup','total'].every(key=>finite(value.fuelRatios?.[key])))return null;
      for(const fuel of FUELS){
        const amount=value[fuel];
        if(!amount||amount.complete!==true||!finite(amount.quantity)||amount.quantity<0||!noIssues(amount.issues))return null;
      }
      for(const fuel of ['coal','bio']){
        const rows=value[fuel].counters,expected=definitions.filter(item=>item.unit===unit&&item.fuel===fuel);
        if(!Array.isArray(rows)||rows.length!==expected.length||new Set(rows.map(item=>item?.id)).size!==rows.length)return null;
        for(const definition of expected){
          const checked=inspectCounter(rows.find(item=>item?.id===definition.id),definition,bounds);
          if(!checked)return null;inspected.push(checked);
        }
      }
    }
    if(!finite(result.combined?.heats?.total)||result.combined.heats.total<=0||
       !['bio','organic','total'].every(key=>finite(result.combined?.ratios?.[key])))return null;
    const maxGapSeconds=Math.max(...inspected.map(item=>item.gap));
    if(maxGapSeconds<=.001)return null;
    const expectedWarning='DataPARC 중간 품질 공백이 최대 '+maxGapSeconds.toFixed(1)+'초 확인됐습니다. 시작·종료 누적 경계와 Min/Max가 정상인 TAG는 경계값 차이로 사용량을 표시합니다.';
    if(!Array.isArray(result.warnings)||result.warnings.length!==1||result.warnings[0]!==expectedWarning)return null;
    const affected=[];
    for(const unit of UNITS)for(const fuel of ['coal','bio']){
      const rows=inspected.filter(item=>item.unit===unit&&item.fuel===fuel&&item.gap>.001);
      if(rows.length)affected.push({unit,fuel,maxGapSeconds:Math.max(...rows.map(item=>item.gap)),tags:rows.map(item=>item.id)});
    }
    const qualityLabel='원본 품질 공백 최대 '+maxGapSeconds.toFixed(1)+'초';
    return {kind:'counter-boundary-quality-gap',calculationLabel:'계산 완료 · 누적계 기준',
      displayLabel:'계산 완료 · 누적계 기준 · 품질 공백 포함',qualityLabel,
      note:'누적계 기준 계산 완료 · 품질 공백 포함 · '+qualityLabel,
      maxGapSeconds,affected,estimated:false};
  }
  return Object.freeze({describe});
});
