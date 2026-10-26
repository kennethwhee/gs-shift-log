 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const m=require('../maintenance/cofiring-shared-scenario-v7.js');
const S='2026-10-24T00:00';
const next={kind:'cofiring_period_summary_v1',schemaVersion:1,startLocal:S,endLocal:'2026-10-25T00:00',stepUnit:'minute',stepValue:1,organicInventoryReady:false,organicInventory:null,organicInventorySamples:[
 {key:'organicDaySilo',label:'Day Silo',tag:'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT',startQuality:'Good',endQuality:'Good',startValue:15.710,endValue:8.099,startTime:'2026-10-23T23:59:49+09:00',endTime:'2026-10-24T23:59:48+09:00'},
 {key:'organicStorageSiloA',label:'Storage Silo A',tag:'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT',startQuality:'Good',endQuality:'Good',startValue:43.862,endValue:32.144,startTime:'2026-10-23T23:59:52+09:00',endTime:'2026-10-24T23:59:46+09:00'},
 {key:'organicStorageSiloB',label:'Storage Silo B',tag:'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT',startQuality:'Raw, Bad',endQuality:'Good',startValue:66.506,endValue:57.839,startTime:'2026-10-23T23:10:18+09:00',endTime:'2026-10-24T23:59:51+09:00'}]};
const prev={kind:'cofiring_period_summary_v1',schemaVersion:1,startLocal:'2026-10-23T00:00',endLocal:S,stepUnit:'minute',stepValue:1,organicInventoryReady:false,organicInventory:null,organicInventorySamples:[
 {key:'organicDaySilo',tag:next.organicInventorySamples[0].tag,startQuality:'Good',endQuality:'Good',startValue:19.102,endValue:15.710,startTime:'2026-10-23T00:00:00+09:00',endTime:'2026-10-23T23:59:49+09:00'},
 {key:'organicStorageSiloA',tag:next.organicInventorySamples[1].tag,startQuality:'Good',endQuality:'Good',startValue:45.15,endValue:43.862,startTime:'2026-10-23T00:00:00+09:00',endTime:'2026-10-23T23:59:52+09:00'},
 {key:'organicStorageSiloB',tag:next.organicInventorySamples[2].tag,startQuality:'Raw, Good',endQuality:'Raw, Bad',startValue:58.6328125,endValue:null,startTime:'2026-10-23T00:00:00+09:00',endTime:'2026-10-23T23:10:18+09:00',min:19.143,max:58.9,delta:null,durationCoverageValid:true,durationBadSeconds:3120,durationGoodSeconds:83280,boundaryValid:false,dataComplete:false}]};
const copy=x=>JSON.parse(JSON.stringify(x));
const calc=(peer)=>m.scenario(next,175.430,next,peer);
test('exact 24th is displayed despite structurally-correct adjacent report with incomplete quality statistics',()=>{
 const p=copy(prev);p.organicInventorySamples[2].durationGoodSeconds=null;
 const out=calc(p);assert.ok(out);assert.equal(out.unitTons,78.0315);assert.equal(out.assumedStorageBTons,19.143);
 assert.equal(out.peerConfirmedForPreview,false);assert.match(out.assumptionSource,/고정 가정/);
});
test('exact 24th is displayed if adjacent saved report lacks the B summary, but original remains a preview',()=>{
 const p=copy(prev);p.organicInventorySamples=[];
 const out=calc(p);assert.ok(out);assert.equal(out.unitTons,78.0315);assert.equal(out.verified,false);
 assert.equal(out.peerConfirmedForPreview,false);assert.equal(out.receiptNeedsReview,true);
});
test('trusted same-midnight 23rd min is cross-checked, never silently overridden',()=>{
 const o=calc(prev);assert.ok(o);assert.equal(o.peerConfirmedForPreview,true);assert.equal(o.assumedStorageBTons,19.143);
 const bad=copy(prev);bad.organicInventorySamples[2].min=19.753;
 assert.equal(calc(bad),null);assert.match(m.scenarioReason(next,175.43,next,bad),/일치하지/);
});
test('authentic Good peer midnight boundary blocks the scenario even if the old cached estimate exists',()=>{
 const p=copy(prev);p.organicInventorySamples[2].endValue=66.6;p.organicInventorySamples[2].endQuality='Raw, Good';
 p.organicInventorySamples[2].endTime='2026-10-24T00:00:05+09:00';
 assert.equal(calc(p),null);assert.match(m.scenarioReason(next,175.43,next,p),/계측값/);
});
test('foreign peer or changed current bad-source identity is rejected',()=>{
 assert.equal(calc({}),null);assert.equal(calc({...prev,startLocal:'2026-10-22T00:00'}),null);
 for(const change of [r=>r.organicInventorySamples[2].startValue=78,
 r=>r.organicInventorySamples[2].startQuality='Good',
 r=>r.organicInventorySamples[2].startTime='2026-10-24T03:00:00+09:00']){
  const now=copy(next);change(now);
  assert.equal(m.scenario(now,175.43,now,prev),null);
 }
});
test('real correction UI reprojects after incomplete peer arrives and preserves official quantities',async()=>{
 const seed=copy(prev);seed.organicInventorySamples=[];
 const h={resolved:null,callbacks:0};
 const context=vm.createContext({Promise,Date,console,
   CofiringInventoryCorrection:{localMinute:x=>Date.parse(String(x)+':00+09:00'),resolve:()=>({ok:true,provisional:true,missing:[{silo:'organicStorageSiloB',boundaryLocal:S,side:'start'}]}),usage:()=>({ok:true,provisional:true,allocation:{unit1:101.713,unit2:101.713}}),validCorrection:()=>true},
   CofiringSharedMidnightV6:{plan:()=>({peer:true}),read:async()=>({adjacentReference:seed})},
   CofiringSharedScenarioV7:m
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-inventory-correction-ui.js'),'utf8'),context);
 const widget=context.CofiringInventoryCorrectionUI.create({host:null,getHeaders:()=>({Authorization:'Bearer test'}),canEdit:()=>false,onChange:()=>h.callbacks++});
 widget.setContext(next,next);for(let i=0;i<20;i++)await Promise.resolve();
 const result=widget.usage(175.43);
 assert.ok(result.scenario);assert.equal(result.scenario.unitTons,78.0315);
 assert.equal(result.allocation.unit1,101.713);assert.equal(result.sharedScenarioPending,undefined);
 assert.ok(h.callbacks>0);widget.dispose();
});
test('adjacent API reconstructs the same organic inventory samples as the main onResult callback',async()=>{
 const env=vm.createContext({Date,Promise,URLSearchParams,console,
  CofiringLiveContract:{
    good:q=>/good/i.test(String(q||'')),uuid:x=>x==='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    period:s=>({...s,startMs:Date.parse(s.startLocal+':00+09:00'),endMs:Date.parse(s.endLocal+':00+09:00'),durationMinutes:1440}),
    periodKey:s=>[s.startLocal,s.endLocal,s.stepUnit,s.stepValue].join('|'),
    periodResult:r=>r
  }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-shared-midnight-v6.js'),'utf8'),env);
 const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',request={startLocal:prev.startLocal,endLocal:prev.endLocal,stepUnit:'minute',stepValue:1},get=[];
 const fetcher=async(url,init)=>{get.push({url,init});return {ok:true,json:async()=>({ok:true,bridgeVersion:2,periodKey:env.CofiringLiveContract.periodKey(request),saved:{status:'complete',requestType:'cofiring_period',id},result:{report:{reference:{kind:prev.kind,schemaVersion:1,...request},organicInventoryReady:false,organicInventory:null,organicInventorySamples:prev.organicInventorySamples}}})}};
 const read=await env.CofiringSharedMidnightV6.read({spec:next,reference:next,headers:{Authorization:'Bearer test'},fetcher});
 assert.ok(read);assert.equal(read.adjacentReference.organicInventorySamples.length,3);
 assert.equal(read.adjacentReference.organicInventoryReady,false);
 assert.equal(read.adjacentReference.organicInventory,null);
 assert.equal(m.scenario(next,175.43,next,read.adjacentReference).unitTons,78.0315);
 assert.equal(get.length,1);assert.equal(get[0].init.method,'GET');
});
test('unavailable case is never indefinitely labelled as loading, nor automatically saved',()=>{
 const model=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');
 assert.match(model,/prepLabel\('가정 계산 보류'/);assert.match(model,/total\.sharedScenarioReason/);
 assert.match(model,/if\(total\.scenario\|\|total\.sharedScenarioPending\)throw new Error/);
 const correction=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-inventory-correction-ui.js'),'utf8');
 assert.match(correction,/scenarioReason/);
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 for(const asset of ['cofiring-shared-scenario-v7.js','cofiring-inventory-correction-ui.js','cofiring-period-ui-v5.js']){
  assert.equal((html.match(new RegExp('\\/maintenance\\/'+asset.replaceAll('.','\\.')+'\\?','g'))||[]).length,1);
 }
 assert.match(html,/peerQuality=20261026-v9/);
});
