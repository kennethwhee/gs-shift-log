/* Shared estimate identity and reconstruction. Does not persist or certify data. */
(function(root){
 'use strict';
 const inventory=root.CofiringInventoryCorrection||(typeof require==='function'?require('./cofiring-inventory-correction.js'):null);
 const scenario=root.CofiringSharedScenarioV7||(typeof require==='function'?require('./cofiring-shared-scenario-v7.js'):null);
 const UNITS=['unit1','unit2'],FUELS=['coal','bio','organic','manure'],RATIOS=['bio','organicGroup','total'];
 const LABELS={organicDaySilo:'Day Silo',organicStorageSiloA:'Storage A',organicStorageSiloB:'Storage B'};
 const KINDS=['shared-scenario','inventory-balance'];
 const BASES=['shared-midnight-scenario-v7','dataparc-estimated-inventory-balance-v2','operator-corrected-inventory-balance-v1'];
 const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e6;
 const ratio=x=>number(x)&&x<=100.000001;
 const same=(a,b,tolerance=0.000001)=>number(a)&&number(b)&&Math.abs(a-b)<=tolerance;
 const sourceId=x=>typeof x==='string'&&/^[a-f0-9-]{30,48}$/i.test(x);
 function validDate(value){
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
  const ms=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;
 }
 function nextDate(date){return validDate(date)?new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10):'';}
 function isDailyPeriod(spec,date=spec?.startLocal?.slice(0,10)){
  return validDate(date)&&spec?.startLocal===date+'T00:00'&&spec.endLocal===nextDate(date)+'T00:00'&&
   spec.stepUnit==='minute'&&spec.stepValue===1;
 }
 function normalizeCorrectionRefs(entries=[]){
  if(!Array.isArray(entries)||entries.length>6)return null;
  const refs=[],seen=new Set();
  for(const item of entries){
   if(!object(item)||!Object.hasOwn(LABELS,item.silo)||typeof item.boundaryLocal!=='string'||
    !/^20\d{2}-\d{2}-\d{2}T00:00$/.test(item.boundaryLocal)||!validDate(item.boundaryLocal.slice(0,10))||
    !Number.isSafeInteger(item.revision)||item.revision<1)return null;
   const key=item.silo+'|'+item.boundaryLocal;if(seen.has(key))return null;seen.add(key);
   refs.push({silo:item.silo,boundaryLocal:item.boundaryLocal,revision:item.revision});
  }
  return refs.sort((a,b)=>(a.boundaryLocal+'|'+a.silo).localeCompare(b.boundaryLocal+'|'+b.silo));
 }
 function boundaryValid(item,date){
  return object(item)&&Object.hasOwn(LABELS,item.silo)&&['start','end'].includes(item.side)&&
   item.boundaryLocal===(item.side==='start'?date:nextDate(date))+'T00:00'&&number(item.tons)&&
   typeof item.basis==='string'&&item.basis.length>0&&item.basis.length<=160;
 }
 function validEstimation(value,date){
  if(!object(value)||value.version!==1||!KINDS.includes(value.kind)||!BASES.includes(value.basis)||
    !Array.isArray(value.boundaries)||!value.boundaries.length||value.boundaries.length>6||!Array.isArray(value.correctionRefs)||
    (value.kind==='shared-scenario')!==(value.basis==='shared-midnight-scenario-v7'))return false;
  if(!value.boundaries.every(row=>boundaryValid(row,date)))return false;
  const keys=value.boundaries.map(row=>row.silo+'|'+row.boundaryLocal);
  if(new Set(keys).size!==keys.length)return false;
  const refs=normalizeCorrectionRefs(value.correctionRefs);
  if(!refs||refs.some(row=>![date+'T00:00',nextDate(date)+'T00:00'].includes(row.boundaryLocal)))return false;
  if(value.kind==='shared-scenario'&&(!['2026-10-23','2026-10-24'].includes(date)||value.boundaries.length!==1||
    value.boundaries[0].silo!=='organicStorageSiloB'||value.boundaries[0].boundaryLocal!=='2026-10-24T00:00'||refs.length))return false;
  return value.peerSourceRequestId===undefined||sourceId(value.peerSourceRequestId);
 }
 function sharedMetadata(value,spec){
  if(!scenario?.isScenario?.(value)||!isDailyPeriod(spec))return null;
  const side=value.assumptionBoundaryLocal===spec.startLocal?'start':value.assumptionBoundaryLocal===spec.endLocal?'end':null;
  if(!side)return null;
  const basis=value.role==='prev'?'dataparc-observed-period-minimum-v7':'historical-shared-midnight-estimate-v7';
  return {version:1,kind:'shared-scenario',basis:'shared-midnight-scenario-v7',
   boundaries:[{silo:'organicStorageSiloB',side,boundaryLocal:value.assumptionBoundaryLocal,tons:value.assumedStorageBTons,basis}],correctionRefs:[]};
 }
 function inventoryMetadata(usage,spec){
  if(!isDailyPeriod(spec)||usage?.ok!==true||usage.provisional!==true||usage.provisionalZero===true||
    usage.sharedScenarioPending===true||!number(usage.usage)||!number(usage.receipt)||
    !same(usage.allocation?.unit1,usage.allocation?.unit2)||
    !['dataparc-estimated-inventory-balance-v2','operator-corrected-inventory-balance-v1'].includes(usage.basis))return null;
  const refs=normalizeCorrectionRefs(usage.corrections||[]);if(!refs)return null;
  const boundaries=[];
  for(const item of usage.autoEstimates||[]){
   boundaries.push({silo:item.silo,side:item.side,boundaryLocal:item.boundaryLocal,tons:item.tons,basis:item.basis});
  }
  for(const item of usage.corrections||[]){
   if(item.method!=='estimated')continue;
   const side=item.boundaryLocal===spec.startLocal?'start':item.boundaryLocal===spec.endLocal?'end':null;
   boundaries.push({silo:item.silo,side,boundaryLocal:item.boundaryLocal,tons:item.tons,basis:'operator-estimated-boundary-v1'});
  }
  boundaries.sort((a,b)=>(a.boundaryLocal+'|'+a.silo).localeCompare(b.boundaryLocal+'|'+b.silo));
  const result={version:1,kind:'inventory-balance',basis:usage.basis,boundaries,correctionRefs:refs};
  return validEstimation(result,spec.startLocal.slice(0,10))?result:null;
 }
 function completeResult(result){
  return object(result)&&isDailyPeriod(result.period)&&UNITS.every(unit=>{
   const row=result.units?.[unit];
   return row?.coal?.complete===true&&row?.bio?.complete===true&&
    FUELS.every(fuel=>number(row?.[fuel]?.quantity))&&RATIOS.every(key=>ratio(row?.fuelRatios?.[key]));
  })&&RATIOS.every(key=>ratio(result.combined?.fuelRatios?.[key]));
 }
 function projection(result){
  if(!result||!isDailyPeriod(result.period)||result.organicUsage?.estimateReady===false||result.organicUsage?.sharedScenarioPending===true)return null;
  const usage=result.organicUsage,shared=usage?.scenario;
  if(scenario?.isScenario?.(shared)){
   const shown=scenario.project(result),estimation=sharedMetadata(shared,result.period);
   if(!estimation||!completeResult(shown))return null;
   return {kind:'shared-scenario',result:shown,usage,receiptTons:shared.receipt,unitTons:shared.unitTons,correctionRefs:[],estimation};
  }
  const estimation=inventoryMetadata(usage,result.period);
  if(!estimation||!completeResult(result))return null;
  return {kind:'inventory-balance',result,usage,receiptTons:usage.receipt,unitTons:usage.allocation.unit1,correctionRefs:estimation.correctionRefs,estimation};
 }
 function deriveUsage(reference,receipt,spec,corrections=[],adjacentReference=null,kind){
  if(!isDailyPeriod(spec)||!number(receipt)||!inventory||!scenario||!Array.isArray(corrections)||
    kind!==undefined&&!KINDS.includes(kind))return null;
  if(kind===undefined||kind==='shared-scenario'){
   const candidate=scenario.displayScenario(reference,receipt,spec,adjacentReference);
   const estimation=sharedMetadata(candidate,spec);
   if(estimation){
    // A stored correction for this very boundary supersedes the historical what-if.
    if(corrections.some(item=>item.silo==='organicStorageSiloB'&&item.boundaryLocal===candidate.assumptionBoundaryLocal))return null;
    const first=estimation.boundaries[0];
    return {kind:'shared-scenario',usage:null,scenario:candidate,receiptTons:receipt,unitTons:candidate.unitTons,correctionRefs:[],estimation,
     assumption:{silo:first.silo,boundaryLocal:first.boundaryLocal,tons:first.tons,basis:first.basis,source:'estimate, not certified'}};
   }
   if(kind==='shared-scenario')return null;
  }
  const usage=inventory.usage(reference,receipt,spec,corrections,{enableAutoEstimate:true,adjacentReference});
  const estimation=inventoryMetadata(usage,spec);if(!estimation)return null;
  const first=estimation.boundaries[0];
  return {kind:'inventory-balance',usage,scenario:null,receiptTons:receipt,unitTons:usage.allocation.unit1,correctionRefs:estimation.correctionRefs,estimation,
   assumption:{silo:first.silo,boundaryLocal:first.boundaryLocal,tons:first.tons,basis:first.basis,source:'estimate, not certified'}};
 }
 function validItem(item,date=item?.targetDate){
  if(!validDate(date)||!object(item)||item.targetDate!==date||item.recordKind!=='hypothesis'||
    item.verificationStatus!=='unverified'||item.officialClose!==false||!Number.isSafeInteger(item.revision)||item.revision<1||
    !sourceId(item.sourceRequestId)||typeof item.savedAt!=='string'||!Number.isFinite(Date.parse(item.savedAt)))return false;
  if(!UNITS.every(unit=>FUELS.every(fuel=>number(item.summary?.[unit]?.[fuel]))&&
    ['bioRatio','organicGroupRatio','totalRatio'].every(key=>ratio(item.summary?.[unit]?.[key])))||
    !['bioRatio','organicGroupRatio','totalRatio'].every(key=>ratio(item.summary?.combined?.[key])))return false;
  if(item.estimation!==undefined)return validEstimation(item.estimation,date);
  // Historical rows keep their original schema and are read without a migration.
  return ['2026-10-23','2026-10-24'].includes(date)&&item.assumption?.silo==='organicStorageSiloB'&&
   item.assumption.boundaryLocal==='2026-10-24T00:00'&&same(item.assumption.tons,19.143,0.00001);
 }
 function description(item){
  if(!validItem(item))return '추정 계산 · 미확정 · 원본 재확인 필요';
  const boundaries=item.estimation?.boundaries||[{silo:item.assumption.silo,boundaryLocal:item.assumption.boundaryLocal,tons:item.assumption.tons}];
  const parts=boundaries.map(row=>row.boundaryLocal.replace('T',' ')+' '+LABELS[row.silo]+' 재고 '+
   row.tons.toLocaleString('ko-KR',{maximumFractionDigits:6})+'t 추정');
  return '계산일 '+item.targetDate+' · 추정값 저장 · 미확정'+(item.adjustment?' · Bio 조정':'')+' · '+parts.join(' / ')+' · 정확한 값이 아닐 수 있어 재확인 필요';
 }
 const api=Object.freeze({validDate,nextDate,isDailyPeriod,normalizeCorrectionRefs,validEstimation,projection,deriveUsage,
  validItem,validSavedItem:validItem,description,describeEstimation:description});
 root.CofiringEstimateV1=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
