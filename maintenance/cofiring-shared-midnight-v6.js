/* COFIRING_SHARED_MIDNIGHT_BOUNDARY_V6
 * Read the already saved, adjacent 24h DataPARC report only.
 * Authentication, exact period, and signed request identity are enforced.
 * Does not query live Agent, persist corrections, or certify estimates.
 */
(function(root){
 'use strict';
 const contract=root.CofiringLiveContract||(typeof require==='function'?require('./cofiring-live-contract.js'):null);
 function plan(spec,reference){
   if(!contract||!spec||!reference||reference.organicInventoryReady!==false||
      reference.organicInventory!==null||!Array.isArray(reference.organicInventorySamples))return null;
   let p;try{p=contract.period(spec,Number.MAX_SAFE_INTEGER);}catch(_){return null;}
   if(p.durationMinutes!==1440||p.stepUnit!=='minute'||p.stepValue!==1||
      !p.startLocal.endsWith('T00:00')||!p.endLocal.endsWith('T00:00')||
      reference.startLocal!==p.startLocal||reference.endLocal!==p.endLocal)return null;
   const b=reference.organicInventorySamples.find(x=>x?.key==='organicStorageSiloB');
   if(!b||b.tag!=='GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT')return null;
   const endMissing=!contract.good(b.endQuality)||typeof b.endValue!=='number'||!Number.isFinite(b.endValue);
   const startMissing=!contract.good(b.startQuality)||typeof b.startValue!=='number'||!Number.isFinite(b.startValue);
   if(startMissing===endMissing)return null;
   const missingSide=endMissing?'end':'start';
   const peerStart=missingSide==='end'?p.endLocal:new Date(p.startMs-86400000+32400000).toISOString().slice(0,16);
   const peerEnd=missingSide==='end'?new Date(p.endMs+86400000+32400000).toISOString().slice(0,16):p.startLocal;
   if(peerStart===p.startLocal||peerEnd===p.endLocal)return null;
   return {boundaryLocal:p[missingSide+'Local'],missingSide,peerSpec:{startLocal:peerStart,endLocal:peerEnd,stepUnit:'minute',stepValue:1}};
 }
 async function read({reference,spec,headers={},fetcher,signal}={}){
   const p=plan(spec,reference);
   if(!p||typeof fetcher!=='function')return null;
   const auth=String(headers.Authorization||headers.authorization||'');
   if(!/^Bearer\s+\S+$/i.test(auth))return null;
   const selected=contract.period(p.peerSpec,Number.MAX_SAFE_INTEGER);
   const q=new URLSearchParams({action:'cofiring_period',start:p.peerSpec.startLocal,end:p.peerSpec.endLocal,stepUnit:'minute',stepValue:'1'});
   const response=await fetcher('/api/ois-data-requests?'+q.toString(),{method:'GET',headers:{...headers,Accept:'application/json'},cache:'no-store',credentials:'same-origin',...(signal?{signal}:{})});
   if(!response?.ok)return null;
   const data=await response.json();
   if(data?.ok!==true||data.bridgeVersion!==2||data.periodKey!==contract.periodKey(selected)||
      data.saved?.status!=='complete'||data.saved?.requestType!=='cofiring_period'||
      !contract.uuid(data.saved?.id)||!data.result)return null;
   const checked=contract.periodResult(data.result,data.saved.id,selected);
   const report=checked?.report;
   const basis=report?.reference;
   // The saved DataPARC reference contains Coal/Bio; the three inventory
   // samples sit beside it in report.organicInventorySamples. Use the SAME
   // normalized object as the primary co-firing screen's onResult callback.
   // Preserve legacy reference identity only when the report has no organic
   // root fields (old API shape), so unrelated callers remain compatible.
   const hasInventoryRoot=!!report&&['organicInventoryReady','organicInventory','organicInventorySamples']
     .some(key=>Object.prototype.hasOwnProperty.call(report,key));
   const adjacent=!basis?null:!hasInventoryRoot?basis:{...basis,
     organicInventoryReady:report.organicInventoryReady===true,
     organicInventory:report.organicInventory||null,
     organicInventorySamples:Array.isArray(report.organicInventorySamples)?report.organicInventorySamples:null};
   if(!adjacent||adjacent.startLocal!==selected.startLocal||adjacent.endLocal!==selected.endLocal||
      adjacent.stepUnit!=='minute'||adjacent.stepValue!==1)return null;
   return Object.freeze({plan:p,adjacentReference:adjacent,sourceRequestId:data.saved.id});
 }
 const api=Object.freeze({plan,read});
 root.CofiringSharedMidnightV6=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
