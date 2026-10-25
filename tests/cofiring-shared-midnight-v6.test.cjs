'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const defs=[['organicDaySilo','Day Silo','GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT'],
 ['organicStorageSiloA','Storage Silo A','GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT'],
 ['organicStorageSiloB','Storage Silo B','GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT']];
const day23={startLocal:'2026-10-23T00:00',endLocal:'2026-10-24T00:00',stepUnit:'minute',stepValue:1};
const day24={startLocal:'2026-10-24T00:00',endLocal:'2026-10-25T00:00',stepUnit:'minute',stepValue:1};
const iso=(local,seconds=5)=>`${local}:${String(seconds).padStart(2,'0')}+09:00`;
function source(spec,missingSide,delta=null){
  const bStart=missingSide==='start'?null:58.6328125,bEnd=missingSide==='end'?null:16;
  const rows=defs.map(([key,label,tag],i)=>{
    let startValue=i===2?bStart:10+i*5,endValue=i===2?bEnd:15+i*5;
    let isMissing=i===2;
    return {key,label,tag,startValue,endValue,startQuality:i===2&&missingSide==='start'?'Raw, Bad':'Raw, Good',
      endQuality:i===2&&missingSide==='end'?'Raw, Bad':'Raw, Good',
      startTime:iso(spec.startLocal,0),endTime:i===2&&missingSide==='end'?'2026-10-23T23:10:18+09:00':iso(spec.endLocal),
      min:i===2?16:startValue,max:i===2?58.8:endValue,delta:i===2?delta:5,
      durationGoodSeconds:i===2?83280:86400,durationBadSeconds:i===2?3120:0,
      durationCoverageValid:true,boundaryValid:i!==2,dataComplete:i!==2};
  });
  // For day24, good B end 16, delta=-14 -> inferred start 30t.
  if(missingSide==='start'){rows[2].endValue=16;rows[2].delta=-14;rows[2].min=16;rows[2].max=30;}
  return {kind:'cofiring_period_summary_v1',schemaVersion:1,...spec,organicInventoryReady:false,organicInventory:null,organicInventorySamples:rows};
}
const contract={
  good(q){return /^raw, good$/i.test(String(q||''));},
  period(spec){const startMs=Date.parse(spec.startLocal+':00+09:00'),endMs=Date.parse(spec.endLocal+':00+09:00');if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)throw Error('period');return {...spec,startMs,endMs,durationMinutes:(endMs-startMs)/60000};},
  periodKey(spec){return [spec.startLocal,spec.endLocal,spec.stepUnit,spec.stepValue].join('|');},
  uuid(id){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id||'');},
  periodResult(raw,id,period){if(raw?.kind!=='cofiring_period_live_result'||raw.requestId!==id||this.periodKey(raw.request)!==this.periodKey(period))throw Error('invalid signed result');return raw;},
  validateOrganicInventory(){throw Error('not expected');}
};
const env=vm.createContext({CofiringCore:{},CofiringLiveContract:contract,Date,console,URLSearchParams});
const folder=path.resolve(__dirname,'../maintenance');
for(const name of ['cofiring-inventory-correction.js','cofiring-shared-midnight-v6.js','cofiring-communication-warning-v2.js'])vm.runInContext(fs.readFileSync(path.join(folder,name),'utf8'),env);
const model=env.CofiringInventoryCorrection,shared=env.CofiringSharedMidnightV6,notice=env.CofiringCommunicationWarningV2;
function copy(x){return JSON.parse(JSON.stringify(x));}
function host(){return {hidden:false,dataset:{},title:'',textContent:''};}
const src23=source(day23,'end'),src24=source(day24,'start');
test('one physical midnight is the same identity and warning in 23 end and 24 start',()=>{
 const raw23=model.resolve(src23,[],day23,{enableAutoEstimate:true}),raw24=model.resolve(src24,[],day24,{enableAutoEstimate:true});
 assert.equal(raw23.code,'ORGANIC_BOUNDARY_CORRECTION_REQUIRED');assert.equal(raw24.ok,true);
 const a=host(),b=host();notice.render(a,src23,raw23);notice.render(b,src24,raw24);
 assert.equal(a.textContent,b.textContent);assert.match(a.textContent,/10월 24일 00:00.*원본 재고 계측 오류/);
 assert.ok(a.textContent.length<100);
 assert.equal(raw23.missing[0].boundaryLocal,raw24.missing[0].boundaryLocal);
});
test('next day validated provisional start can be reused only as provisional previous end',()=>{
 const ref23=copy(src23),ref24=copy(src24);
 const own24=model.resolve(ref24,[],day24,{enableAutoEstimate:true});assert.equal(own24.ok,true);assert.equal(own24.provisional,true);
 const linked23=model.resolve(ref23,[],day23,{enableAutoEstimate:true,adjacentReference:ref24});
 assert.equal(linked23.ok,true);assert.equal(linked23.provisional,true);assert.equal(linked23.inventory.end.organicStorageSiloB,own24.inventory.start.organicStorageSiloB);
 assert.ok(linked23.autoEstimates.some(x=>x.sharedBoundary===true));
 assert.deepEqual(ref23,src23);assert.deepEqual(ref24,src24);
 // No auto-derived amount may ever be persisted as confirmed.
 assert.equal(linked23.corrections.length,0);
});
test('missing Delta in 10/23 alone never becomes a fabricated inventory',()=>{
 const r=model.resolve(src23,[],day23,{enableAutoEstimate:true});assert.equal(r.ok,false);assert.equal(r.autoEstimates.length,0);
});
test('foreign dates, altered TAG, and implausible adjacent statistics never authorize sharing',()=>{
 const wrong=copy(src24);wrong.startLocal='2026-10-25T00:00';
 const wrongTag=copy(src24);wrongTag.organicInventorySamples[2].tag='FORGED';
 const noDelta=copy(src24);noDelta.organicInventorySamples[2].delta=null;
 const stale=copy(src24);stale.organicInventorySamples[2].startTime='2026-10-24T04:30:00+09:00';
 for(const peer of [wrong,wrongTag,noDelta,stale]){const r=model.resolve(src23,[],day23,{enableAutoEstimate:true,adjacentReference:peer});assert.equal(r.ok,false);}
});
test('opposing independently inferred boundary values raise conflict, not silent replacement',()=>{
 const both=copy(src23);const b=both.organicInventorySamples[2];b.delta=-20;b.endTime='2026-10-23T23:30:00+09:00';b.min=16;b.max=58.8;
 const linked=model.resolve(both,[],day23,{enableAutoEstimate:true,adjacentReference:src24});
 assert.equal(linked.ok,false);assert.equal(linked.code,'ORGANIC_SHARED_BOUNDARY_CONFLICT');
});
test('peer lookup is exact authorized GET of the adjacent saved result; no database or Agent writes',async()=>{
 const spec=day23,ref=src23,plan=shared.plan(spec,ref);assert.equal(plan.peerSpec.startLocal,day24.startLocal);
 const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',call=[];
 const result={kind:'cofiring_period_live_result',requestId:id,request:{...day24},report:{reference:src24}};
 const fetcher=async(url,init)=>{call.push({url,init});return {ok:true,json:async()=>({ok:true,bridgeVersion:2,periodKey:contract.periodKey(day24),saved:{id,status:'complete',requestType:'cofiring_period'},result})};};
 const r=await shared.read({spec,reference:ref,headers:{Authorization:'Bearer signed-user'},fetcher});
 assert.equal(r.adjacentReference,src24);assert.equal(call.length,1);assert.match(call[0].url,/start=2026-10-24T00%3A00/);assert.equal(call[0].init.method,'GET');assert.equal(call[0].init.cache,'no-store');
 assert.equal(await shared.read({spec,reference:ref,headers:{},fetcher}),null);
 assert.equal(call.length,1);
});
test('wrong reply period, absent saved result, forged identity or unresolved data do not cross dates',async()=>{
 const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',result={kind:'cofiring_period_live_result',requestId:id,request:{...day24},report:{reference:src24}};
 const cases=[{bridgeVersion:2,periodKey:'wrong',saved:{id,status:'complete',requestType:'cofiring_period'},result},
  {bridgeVersion:2,periodKey:contract.periodKey(day24),saved:null,result},
  {bridgeVersion:2,periodKey:contract.periodKey(day24),saved:{id:'bad',status:'complete',requestType:'cofiring_period'},result}];
 for(const c of cases){const r=await shared.read({spec:day23,reference:src23,headers:{Authorization:'Bearer X'},fetcher:async()=>({ok:true,json:async()=>({ok:true,...c})})});assert.equal(r,null);}
});
test('installed UI uses adjacentReference only for read-only provisional model, never snapshot save or close',()=>{
 const ui=fs.readFileSync(path.join(folder,'cofiring-inventory-correction-ui.js'),'utf8');
 const base=fs.readFileSync(path.join(folder,'cofiring-period-ui-v5.js'),'utf8');
 const index=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.match(ui,/model\.usage\(reference,receipt,spec,entries\(\),[\s\S]*?enableAutoEstimate:true,adjacentReference:peerReference/);
 assert.match(ui,/fetcher:options\.fetch\|\|root\.fetch\?\.bind\(root\)/);
 assert.match(index,/cofiring-shared-midnight-v6\.js\?v=20261026-v6/);
 assert.match(base,/if\(total\.provisional\)throw new Error\('추정 재고를 사용한 임시 계산은 저장·마감할 수 없습니다/);
 assert.match(base,/b\.disabled=!lastResult\|\|mobile\|\|organicUsageState\?\.ok!==true\|\|organicUsageState\?\.provisional===true/);
});
