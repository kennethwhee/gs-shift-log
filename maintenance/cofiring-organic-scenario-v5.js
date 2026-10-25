/* OCT23_PROVISIONAL_SCENARIO_V5
 * Read-only what-if for a missing Storage B 00:00 end boundary.
 * Using the observed period MINIMUM as an assumed closing stock is not a
 * DataPARC midnight recovery. It may be wrong if silo transfer/loading occurs.
 * This never writes a field or participates in saved/official mixing ratios.
 */
(function(root){
  'use strict';
  const keys=['organicDaySilo','organicStorageSiloA','organicStorageSiloB'];
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000;
  const good=q=>typeof q==='string'&&/^(?:raw\s*,\s*good|good\s*,\s*raw|good)$/i.test(q.trim());
  const map=new Map(keys.map(x=>[x,true]));
  function scenario(reference,receipt,spec){
    // Fail closed unless exactly the report period and the authenticated
    // completed-unloading quantity are already available in this UI.
    if(!reference||!spec||reference.startLocal!==spec.startLocal||reference.endLocal!==spec.endLocal||
       reference.organicInventoryReady!==false||reference.organicInventory!==null||
       !positive(receipt)||!Array.isArray(reference.organicInventorySamples)||reference.organicInventorySamples.length!==3)return null;
    const samples=new Map(reference.organicInventorySamples.map(s=>[s?.key,s]));
    if(samples.size!==3||[...samples.keys()].some(key=>!map.has(key)))return null;
    const b=samples.get('organicStorageSiloB');
    if(!b||b.endValue!==null||positive(b.endValue)||good(b.endQuality)||
       b.delta!==null||b.boundaryValid!==false||b.dataComplete!==false||
       !positive(b.startValue)||!good(b.startQuality)||
       !positive(b.min)||!positive(b.max)||b.min>b.max||
       b.startValue<b.min-1||b.startValue>b.max+1||
       b.durationCoverageValid!==true||!positive(b.durationBadSeconds)||
       b.durationBadSeconds<=0||b.durationBadSeconds>3600)return null;
    const start=[],end=[];
    for(const key of keys){
      const s=samples.get(key);
      if(!s||!positive(s.startValue)||!good(s.startQuality))return null;
      start.push(s.startValue);
      if(key==='organicStorageSiloB'){end.push(b.min);continue;}
      if(!positive(s.endValue)||!good(s.endQuality)||s.boundaryValid!==true||s.dataComplete!==true)return null;
      end.push(s.endValue);
    }
    const assumedEnd=b.min;
    const total=start.reduce((a,v)=>a+v,0)+receipt-end.reduce((a,v)=>a+v,0);
    if(!Number.isFinite(total)||total<0||total>1000000)return null;
    return Object.freeze({kind:'what-if-not-measured',verified:false,assumption:'Storage B 기간 최솟값 = 종료 재고',
      assumedEnd,receipt,total,unitTons:total/2,qualityGapSeconds:b.durationBadSeconds});
  }
  const api=Object.freeze({scenario});
  root.CofiringOrganicScenarioV5=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
