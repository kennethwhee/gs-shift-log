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
 function provisionalBadReason24(reference,b){
   if(b?.tag!==definitions[2][1])return 'Storage B 계측 TAG가 확인된 설비와 일치하지 않습니다';
   if(qualityGood(b?.startQuality))return 'Storage B 시작 계측값이 Good이므로 이전 추정을 적용하지 않았습니다';
   if(typeof b?.startQuality!=='string'||!/\bbad\b/i.test(b.startQuality))
     return 'Storage B 시작 계측값의 Bad 품질 상태를 확인하지 못했습니다';
   if(b.startValue!==null&&b.startValue!==undefined&&!isTons(b.startValue))
     return 'Storage B 원본 누적값 형식이 올바르지 않습니다';
   const sampled=Date.parse(b.startTime||''),seam=Date.parse(SEAM+':00+09:00');
   if(!Number.isFinite(sampled)||sampled<seam-3*3600000||sampled>seam+5*60000)
     return 'Storage B 오류 기록 시각이 10월 24일 00:00 근처에서 확인되지 않았습니다';
   return 'Storage B 공통 추정 근거가 일치하지 않습니다';
 }
 // Raw, Bad is not a measured midnight inventory. For the labelled WHAT-IF
 // ONLY, permit a Bad boundary observation from the 00:00 outage window
 // even when the unreliable numeric value or exact returned timestamp changes.
 // This helper never confirms a stock, changes a source value, or unlocks close.
 function provisionalBadBoundary24(reference,b){
   if(reference?.startLocal!==dates.next.startLocal||reference?.endLocal!==dates.next.endLocal||
     b?.tag!==definitions[2][1]||typeof b?.startQuality!=='string'||
     qualityGood(b.startQuality)||!/\bbad\b/i.test(b.startQuality)||
     (b.startValue!==null&&b.startValue!==undefined&&!isTons(b.startValue)))return null;
   const sampled=Date.parse(b.startTime||''),boundary=Date.parse(SEAM+':00+09:00');
   // A timestamp from an unrelated shift must not be confused with this seam.
   if(!Number.isFinite(sampled)||sampled<boundary-3*3600000||sampled>boundary+5*60000)return null;
   return OCT24_ACCEPTED_HYPOTHESIS.tons;
 }
 // A present *saved* adjacent report is not necessarily a fully checked
 // midnight reading. Distinguish an explicit, credible contradiction from an
 // incomplete adjacent result. Only a contradiction blocks the historical
 // WHAT-IF; neither case ever authorizes persistence of a projected quantity.
 function peerForOct24(prior){
   if(prior===null||prior===undefined)return {status:'unavailable'};
   if(!prior||typeof prior!=='object'||Array.isArray(prior))return {status:'foreign'};
   // The adjacent GET already checks the saved request/period identity. A
   // missing optional quality field must not turn that exact-period report
   // into a different period. Only an EXPLICIT date mismatch is foreign.
   if(prior.startLocal!==dates.prev.startLocal||prior.endLocal!==dates.prev.endLocal)
     return {status:'foreign'};
   // If a separate verified or confirmed corrected midnight stock exists,
   // do not bypass it with the historic WHAT-IF, even if its daily metadata
   // does not fit the current scenario parser.
   const confirmed=prior.organicInventory?.end?.[B];
   if(prior.organicInventoryReady===true&&isTons(confirmed))
     return {status:'confirmed-source',tons:confirmed};
   const rows=prior.organicInventorySamples;
   if(!Array.isArray(rows)||!rows.length)return {status:'incomplete'};
   const peerB=rows.find(s=>s?.key===B);
   if(peerB&&peerB.tag!==definitions[2][1])return {status:'contradictory-record'};
   const map=samples(prior);
   if(!map)return {status:'incomplete'};
   if(endpointValid(peerB,'end',SEAM))return {status:'confirmed-source',tons:peerB.endValue};
   const observed=observedMin23(prior);
   if(observed!==null)return {status:'measured-min',tons:observed};
   // A missing/null statistic is UNKNOWN; a measured contradiction is not.
   // The real 23rd has a Bad end and an absent Delta; null != actual zero.
   if((peerB.min===null||(peerB.min!==undefined&&(!isTons(peerB.min)||Math.abs(peerB.min-OCT24_ACCEPTED_HYPOTHESIS.tons)>0.001)))||
     (peerB.delta!=null)||
     (peerB.endValue!=null)||
     qualityGood(peerB.endQuality)||
     (peerB.durationBadSeconds===null||(peerB.durationBadSeconds!==undefined&&(!isTons(peerB.durationBadSeconds)||peerB.durationBadSeconds<=0||peerB.durationBadSeconds>3600)))||
     (peerB.startQuality!=null&&!qualityGood(peerB.startQuality))||
     (peerB.endTime&&(!Number.isFinite(Date.parse(peerB.endTime))||
       Date.parse(peerB.endTime)>Date.parse(SEAM+':00+09:00')+60000||
       Date.parse(SEAM+':00+09:00')-Date.parse(peerB.endTime)>3600000)))
     return {status:'contradictory-record'};
   return {status:'incomplete'};
 }
 function scenarioReason(reference,receipt,spec,prior=null){
   if(side(reference,spec)!=='next')return '';
   if(!isTons(receipt))return '10월 24일 유기성 입고량 확인 필요';
   const map=samples(reference);if(!map){
     const b=reference?.organicInventorySamples?.find?.(s=>s?.key===B);
     if(b&&b.tag!==definitions[2][1])return 'Storage B 계측 TAG가 확인된 설비와 일치하지 않습니다';
     return '10월 24일 저장된 3개 사일로 원본 기록 확인 필요';
   }
   if(fixedWhatIf24(reference,map.get(B))===null && provisionalBadBoundary24(reference,map.get(B))===null)
     return provisionalBadReason24(reference,map.get(B));
   const check=peerForOct24(prior);
   if(check.status==='foreign')return '인접 날짜 DataPARC 보고서의 기간·원본 검증 불일치';
   if(check.status==='confirmed-source')return '같은 자정에 검증된 계측값이 있어 기존 추정을 적용하지 않았습니다';
   if(check.status==='contradictory-record')return '10월 23일 원본 데이터가 기존 추정 근거와 일치하지 않습니다';
   if(check.status==='measured-min'&&Math.abs(check.tons-OCT24_ACCEPTED_HYPOTHESIS.tons)>0.001)
     return '10월 23일 기간 최솟값과 19.143t 추정이 일치하지 않습니다';
   for(const [key] of definitions){
     const sample=map.get(key);
     if(key===B){if(!endpointValid(sample,'end',dates.next.endLocal))return '10월 25일 00:00 Storage B 종료 재고 확인 필요';}
     else if(!endpointValid(sample,'start',spec.startLocal)||!endpointValid(sample,'end',spec.endLocal))
       return '10월 24일 정상 사일로 원본 경계값 확인 필요';
   }
   return '유기성 입고량 또는 재고수지 추정 계산 검증 불가';
 }
 function scenario(reference,receipt,spec,adjacentReference=null,previewMode='strict'){
   const role=side(reference,spec);if(!role||!isTons(receipt))return null;
   const prior=role==='prev'?reference:adjacentReference;
   const map=samples(reference);if(!map)return null;
   const b=map.get(B);let assumption=null,assumptionSource='23일 DataPARC 원본 기간 최솟값';
   let peerConfirmed=false;
   if(role==='prev')assumption=observedMin23(reference);
   else{
     const original=fixedWhatIf24(reference,b);
     // Unverified Bad rows may differ between the 23rd's end and the 24th's
     // start, because a Bad value is not a trustworthy reference. This looser
     // fallback is ONLY callable from the nonpersistent display projection.
     const previewBad=original===null&&previewMode==='display-only';
     const approved=original!==null?original:(previewBad?provisionalBadBoundary24(reference,b):null);
     if(approved===null)return null;
     if(previewBad)assumptionSource='Bad 품질 재고 계측값은 사용하지 않은 참고 추정';
     const peer=peerForOct24(prior);
     // A wrong period, a verified contradictory minimum, or an authentic
     // Good midnight source never gets overridden by the assumed 19.143t.
     if(peer.status==='foreign'||peer.status==='confirmed-source'||peer.status==='contradictory-record'||
       (peer.status==='measured-min'&&Math.abs(peer.tons-approved)>0.001))return null;
     assumption=approved;peerConfirmed=peer.status==='measured-min';
     if(!previewBad)assumptionSource=peerConfirmed?'10/23 DataPARC 기간 최솟값과 일치하는 공통 추정':
       '23일 관측 최솟값 19.143t을 적용한 고정 추정(인접자료 품질 미확인)';
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
     assumption:'10/23 DataPARC 기간 최솟값 19.143t을 10/24 00:00 재고로 추정',
     assumptionSource,peerConfirmedForPreview:role==='prev'||peerConfirmed,
     badBoundarySourceIgnoredForPreview:role==='next'&&previewMode==='display-only'&&fixedWhatIf24(reference,b)===null,
     role,receipt,startTotal:start,endTotal:end,total,unitTons:total/2,
     receiptNeedsReview:role==='next',source:'DataPARC 기간 통계 + 해당일 입고기록 · 미검증 추정'});
 }
 function displayScenario(reference,receipt,spec,adjacentReference=null){
   // All quantities returned here are projected for display only. Native
   // adjustment, confirmed-correction and close paths use the strict model.
   return scenario(reference,receipt,spec,adjacentReference,'display-only');
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
 const api=Object.freeze({SEAM,side,scenario,displayScenario,project,isScenario,observedMin23,scenarioReason,peerForOct24});
 root.CofiringSharedScenarioV7=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
