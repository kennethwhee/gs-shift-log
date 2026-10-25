/* COFIRING_SHARED_SCENARIO_V7
 * 2026-10-24T00:00 Storage B is ONE disputed boundary.
 * An operator-facing what-if, NOT a replacement measured inventory.
 * Both dates use the SAME 10/23 observed period minimum AS AN ASSUMPTION.
 * A Bad observation and recorded unloading receipts are not certified facts.
 */
(function(root){
 'use strict';
 const B='organicStorageSiloB',SEAM='2026-10-24T00:00';
 // This exact, already operator-reviewed 19.143t is a *fixed historical WHAT-IF*,
 // not a dynamic DataPARC observation, correction, or certified stock. It must
 // not be generalized to other timestamps or survive different source identity.
 const OCT24_ACCEPTED_HYPOTHESIS=Object.freeze({tons:19.143,
   sourceStartBadTons:66.506,sourceStartAt:'2026-10-23T23:10:18+09:00'});
 const dates={prev:{startLocal:'2026-10-23T00:00',endLocal:SEAM},next:{startLocal:SEAM,endLocal:'2026-10-25T00:00'}};
 const definitions=[['organicDaySilo','GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT'],
   ['organicStorageSiloA','GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT'],
   [B,'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT']];
 const isTons=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e6;
 const qualityGood=x=>typeof x==='string'&&/^(?:good|raw\s*,\s*good|good\s*,\s*raw)$/i.test(x.trim());
 const clone=x=>JSON.parse(JSON.stringify(x));
 function side(reference,spec){
   if(!reference||!spec||reference.kind!=='cofiring_period_summary_v1'||reference.schemaVersion!==1||
     spec.stepUnit!=='minute'||spec.stepValue!==1||reference.stepUnit!=='minute'||reference.stepValue!==1||
     reference.startLocal!==spec.startLocal||reference.endLocal!==spec.endLocal||
     reference.organicInventoryReady!==false||reference.organicInventory!==null)return null;
   for(const [name,range] of Object.entries(dates))if(spec.startLocal===range.startLocal&&spec.endLocal===range.endLocal)return name;
   return null;
 }
 function samples(reference){
   const list=reference?.organicInventorySamples;
   if(!Array.isArray(list)||list.length!==3)return null;
   const map=new Map(list.map(s=>[s?.key,s]));
   if(map.size!==3||definitions.some(([key,tag])=>map.get(key)?.tag!==tag))return null;
   return map;
 }
 function observedMin23(ref){
   const map=samples(ref),b=map?.get(B);if(!map||!b)return null;
   if(qualityGood(b.endQuality)||b.endValue!==null||b.delta!==null||
     b.boundaryValid!==false||b.dataComplete!==false||!qualityGood(b.startQuality)||
     !isTons(b.startValue)||!isTons(b.min)||!isTons(b.max)||b.min>b.max||
     b.startValue<b.min-1||b.startValue>b.max+1||b.durationCoverageValid!==true||
     !isTons(b.durationBadSeconds)||b.durationBadSeconds<=0||b.durationBadSeconds>3600||
     !isTons(b.durationGoodSeconds)||Math.abs(b.durationGoodSeconds+b.durationBadSeconds-86400)>2)return null;
   const time=Date.parse(b.endTime||'');const midnight=Date.parse(SEAM+':00+09:00');
   if(!Number.isFinite(time)||time>midnight+60000||midnight-time>3600000)return null;
   return b.min;
 }
 // The 'good' A and Day values must be near each boundary; a last Bad B value
 // cannot be borrowed as a plausible midnight reading, even if numeric.
 function endpointValid(s,which,local){
   if(!s||!qualityGood(s[which+'Quality'])||!isTons(s[which+'Value']))return false;
   const t=Date.parse(s[which+'Time']||''),bound=Date.parse(local+':00+09:00');
   return Number.isFinite(t)&&Number.isFinite(bound)&&Math.abs(t-bound)<=300000;
 }
 function fixedWhatIf24(reference,b){
   // The adjacent 23rd report can be unavailable (e.g., read-only GET does not
   // deliver a complete saved result). The operator explicitly accepted the
   // 19.143t historical scenario. Permit it ONLY for this same Bad source row,
   // with a matching tag, timestamp and old Bad numeric - never treat as Good.
   if(reference?.startLocal!==dates.next.startLocal||reference?.endLocal!==dates.next.endLocal||
     b?.tag!==definitions[2][1]||qualityGood(b?.startQuality)||
     !/bad/i.test(String(b?.startQuality||''))||!isTons(b?.startValue)||
     Math.abs(b.startValue-OCT24_ACCEPTED_HYPOTHESIS.sourceStartBadTons)>0.25||
     typeof b?.startTime!=='string')return null;
   const t=Date.parse(b.startTime),expected=Date.parse(OCT24_ACCEPTED_HYPOTHESIS.sourceStartAt);
   if(!Number.isFinite(t)||Math.abs(t-expected)>60000)return null;
   return OCT24_ACCEPTED_HYPOTHESIS.tons;
 }
 function scenario(reference,receipt,spec,adjacentReference=null){
   const role=side(reference,spec);if(!role||!isTons(receipt))return null;
   const prior=role==='prev'?reference:adjacentReference;
   const map=samples(reference);if(!map)return null;
   const b=map.get(B);let assumption=null,assumptionSource='23일 DataPARC 원본 기간 최솟값';
   if(role==='prev')assumption=observedMin23(reference);
   else if(prior!==null&&prior!==undefined){
     // A provided peer is authoritative for cross-checking the historical
     // assumption; never quietly override a conflicting/invalid saved peer.
     if(side(prior,{...dates.prev,stepUnit:'minute',stepValue:1})!=='prev')return null;
     assumption=observedMin23(prior);
   }else{
     assumption=fixedWhatIf24(reference,b);
     assumptionSource='23일 관측 최솟값 19.143t을 적용한 고정 가정(인접자료 재조회 미완료)';
   }
   if(assumption===null)return null;
   if(role==='prev'){
      if(qualityGood(b.endQuality)||b.endValue!==null)return null;
   }else if(qualityGood(b.startQuality)||!endpointValid(b,'end',dates.next.endLocal))return null;
   let start=0,end=0;
   for(const [key] of definitions){
     const s=map.get(key);if(key===B){
       if(role==='prev'){
         if(!endpointValid(s,'start',dates.prev.startLocal))return null;
         start+=s.startValue;end+=assumption;
       }else{
         start+=assumption;end+=s.endValue;
       }
     }else{
       if(!endpointValid(s,'start',spec.startLocal)||!endpointValid(s,'end',spec.endLocal))return null;
       start+=s.startValue;end+=s.endValue;
     }
   }
   const total=Math.round((start+receipt-end)*1e6)/1e6;
   if(!Number.isFinite(total)||total<0||total>1e6)return null;
   return Object.freeze({kind:'cross-day-shared-what-if-v7',verified:false,provisional:true,
     assumptionBoundaryLocal:SEAM,assumedStorageBTons:assumption,
     assumption:'10/23 DataPARC 기간 최솟값 19.143t을 10/24 00:00 재고로 가정',
     assumptionSource,peerConfirmedForPreview:role==='prev'||!!prior,
     role,receipt,startTotal:start,endTotal:end,total,unitTons:total/2,
     receiptNeedsReview:role==='next',source:'DataPARC 기간 통계 + 해당일 입고기록 · 미검증 가정'});
 }
 function isScenario(s){return !!s&&s.kind==='cross-day-shared-what-if-v7'&&s.verified===false&&s.provisional===true&&
    s.assumptionBoundaryLocal===SEAM&&isTons(s.assumedStorageBTons)&&isTons(s.receipt)&&isTons(s.unitTons)&&isTons(s.total)&&
    Math.abs(s.unitTons*2-s.total)<0.00001&&['prev','next'].includes(s.role);}
 const valid=x=>typeof x==='number'&&Number.isFinite(x);
 function project(result){
   if(!result?.units?.unit1||!result?.units?.unit2||!result?.combined)return null;
   const scenario=result?.organicUsage?.scenario;
   const unresolved=result?.organicUsage?.sharedScenarioPending===true;
   if(!isScenario(scenario)&&!unresolved)return null;
   const out={...result,units:{...result.units},combined:{...result.combined}};
   const summaries={};let combined={coal:0,bio:0,organic:0,manure:0,total:0},complete=true;
   for(const unit of ['unit1','unit2']){
     const from=result.units[unit],heats=from?.heats||{},co=from?.organic?.coefficient,
       factor=from?.calorifics?.organic;
     const known=['coal','bio','manure'].every(f=>valid(heats[f])&&heats[f]>=0);
     const can=!!isScenario(scenario)&&known&&valid(co)&&co>0&&valid(factor)&&factor>0;
     const organicTons=can?scenario.unitTons*co:null;
     const orgHeat=can?organicTons*factor/1000:null;
     const total=can?heats.coal+heats.bio+heats.manure+orgHeat:null;
     const ratios=can&&total>0?{bio:heats.bio/total*100,
       organicGroup:(orgHeat+heats.manure)/total*100,
       total:(heats.bio+orgHeat+heats.manure)/total*100}: {bio:null,organicGroup:null,total:null};
     const fuelRatios={...from.fuelRatios,bio:ratios.bio,organic:total?orgHeat/total*100:null,
       organicGroup:ratios.organicGroup,total:ratios.total};
     out.units[unit]={...from,organic:{...from.organic,quantity:organicTons,complete:can,averageTonPerHour:can?organicTons/from.period?.durationHours||organicTons/24:null},
       heats:{...heats,organic:orgHeat,total},fuelRatios,ratios:{...from.ratios,...ratios}};
     if(can){for(const f of ['coal','bio','manure'])combined[f]+=heats[f];combined.organic+=orgHeat;combined.total+=total;}else complete=false;
   }
   const sums=complete&&combined.total>0?{
     bio:combined.bio/combined.total*100,organicGroup:(combined.organic+combined.manure)/combined.total*100,
     total:(combined.bio+combined.organic+combined.manure)/combined.total*100}: {bio:null,organicGroup:null,total:null};
   out.combined={...result.combined,heats:{...result.combined.heats,...(complete?combined:{total:null,organic:null})},
     ratios:{...result.combined.ratios,...sums},fuelRatios:{...result.combined.fuelRatios,...sums}};
   out.hypothesisDisplay=isScenario(scenario)?scenario:{kind:'pending',verified:false};
   return out;
 }
 const api=Object.freeze({SEAM,side,scenario,project,isScenario,observedMin23});
 root.CofiringSharedScenarioV7=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
