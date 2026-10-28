'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {normalizeItem, matchingReceiptCount} = require('../maintenance/morning-meeting-closed-cofiring.js');
const code = fs.readFileSync(require.resolve('../maintenance/morning-meeting-closed-cofiring.js'),'utf8');
const DATE = '2026-09-25';
function item(date=DATE) {
  const next=new Date(date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);
  const period={startLocal:date+'T00:00',endLocal:next.toISOString().slice(0,10)+'T00:01'};
  const unit={coal:700,bio:300,organic:25,manure:0,bioRatio:21.23456,organicGroupRatio:3.45678,totalRatio:23.78901};
  const inventory={...period,start:{organicDaySilo:20,organicStorageSiloA:80,organicStorageSiloB:50,total:150},
    end:{organicDaySilo:0,organicStorageSiloA:40,organicStorageSiloB:90,total:130}};
  return {targetDate:date,revision:2,sourceRequestId:'closed-source',updatedAt:'2026-09-26T01:00:00Z',
    summary:{unit1:{...unit},unit2:{...unit,coal:0,bio:0,organic:0,bioRatio:null,organicGroupRatio:null,totalRatio:null},combined:{...unit}},
    snapshot:{schemaVersion:1,targetDate:date,sourceRequestId:'closed-source',period,manual:{receipts:{organic:30}},organicUsage:{startTotal:150,endTotal:130}},organicInventory:inventory};
}
function receipts(saved=item()) {return {ok:true,source:'solid-fuel-unloading',basis:'completed-unloading-departure',
  receiptStart:saved.snapshot.period.startLocal,receiptEnd:saved.snapshot.period.endLocal,receipts:{organic:30},counts:{organic:2}};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function harness(fetcher) {
 const nodes=new Map(),events=new Map(),rootEvents=new Map(),timers=new Map(),calls=[];let token='test-session',blocked=false,id=0;
 function node(name){if(!nodes.has(name))nodes.set(name,{id:name,textContent:'stale',dataset:{},setAttribute(){},querySelector(){return null;}});return nodes.get(name);}
 node('efficiencyMorningMeetingWaterPanel').dataset.morningMeetingAutoBaseDate=DATE;
 for(const suffix of ['SludgeCard','SludgeDate','SludgeStatus','SludgeRefreshButton','SludgeTotal','SludgeTruckCount','OrganicDaySilo','OrganicStorageSiloA','OrganicStorageSiloB','OrganicSiloTotal'])node('efficiencyMorningMeetingAutoDaily'+suffix);
 const document={readyState:'loading',getElementById:id=>nodes.get(id)||null,body:{},addEventListener(type,fn){events.set(type,[...(events.get(type)||[]),fn]);},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);}};
 const window={document,getShiftLogAuthHeaders:()=>new Headers(token?{Authorization:'Bearer '+token}:{}),isMorningMeetingSelectedDateResetActive:()=>blocked,
  setTimeout(fn,delay){const key=++id;timers.set(key,{fn,delay});return key;},clearTimeout(key){timers.delete(key);},
  addEventListener(type,fn){rootEvents.set(type,fn);},
  async fetch(url,options){calls.push({url:String(url),options});return fetcher?fetcher(String(url),options):{ok:true,json:async()=>String(url).startsWith('/api/cofiring-')?{ok:true,item:item()}:receipts()};}};
 const CustomEvent=class{constructor(type,options){this.type=type;this.detail=options.detail;}};
 vm.runInNewContext(code,{window,document,Headers,URLSearchParams,AbortController,CustomEvent,MutationObserver:class{observe(){}},console});
 return {api:window.morningMeetingClosedCofiring,window,document,nodes,calls,timers,node,
  date(value){node('efficiencyMorningMeetingWaterPanel').dataset.morningMeetingAutoBaseDate=value;},token(value){token=value;},block(value){blocked=value;},
  emit(type,detail){document.dispatchEvent(new CustomEvent(type,{detail}));},
  initialize(){for(const fn of events.get('DOMContentLoaded')||[])fn();},rootEvents};
}
test('saved quantities and distinct stored ratio definitions survive mapping; zero and null remain distinct',()=>{
 const result=normalizeItem(item(),DATE);assert.equal(result.unitOne.bio,300);assert.equal(result.unitOne.bioRatio,21.23456);
 assert.equal(result.unitOne.organicRatio,3.45678);assert.equal(result.unitTwo.coal,0);assert.equal(result.unitTwo.bioRatio,null);
 assert.equal(result.organic.organicDaySilo,0);assert.equal(result.organic.organicSiloTotal,130);assert.equal(result.organic.sludgeTotal,30);
});
test('wrong date/source, partial period, missing quantity and malformed ratios are rejected',()=>{
 for(const mutate of [x=>x.targetDate='2026-09-24',x=>x.snapshot.sourceRequestId='other',x=>x.snapshot.period.endLocal='2026-09-25T12:00',
  x=>delete x.summary.unit1.bio,x=>x.summary.unit1.bioRatio='21',x=>x.summary.unit1.organicGroupRatio=NaN]){
  const bad=item();mutate(bad);assert.throws(()=>normalizeItem(bad,DATE));
 }
});
test('missing or mismatched individual inventory never fabricates stock; stored aggregate stays usable',()=>{
 const saved=item();delete saved.organicInventory;assert.equal(normalizeItem(saved,DATE).organic.organicDaySilo,null);
 assert.equal(normalizeItem(saved,DATE).organic.organicSiloTotal,130);
 saved.organicInventory=item().organicInventory;saved.organicInventory.end.total=900;
 assert.equal(normalizeItem(saved,DATE).organic.organicStorageSiloA,null);
 delete saved.organicInventory;delete saved.snapshot.organicUsage.endTotal;
 assert.equal(normalizeItem(saved,DATE).organic.organicSiloTotal,null);
});
test('receipt count requires exact closing interval, completed record basis and same organic tonnage',()=>{
 const saved=normalizeItem(item(),DATE);assert.equal(matchingReceiptCount(receipts(),saved),2);
 for(const change of [x=>x.receiptEnd='2026-09-26T00:00',x=>x.receipts.organic=31,x=>x.counts.organic=-1,x=>x.basis='workDate']){
  const p=receipts();change(p);assert.equal(matchingReceiptCount(p,saved),null);
 }
});
test('both cards share a deduplicated authenticated GET and organic export overlays only its own fields',async()=>{
 const h=harness();const [a,b]=await Promise.all([h.api.load(DATE),h.api.load(DATE)]);
 assert.equal(a,b);assert.equal(h.calls.filter(x=>x.url.startsWith('/api/cofiring-')).length,1);
 assert.ok(h.calls.every(x=>x.options.method==='GET'&&x.options.headers.get('Authorization')==='Bearer test-session'));
 const original={sourceDate:DATE,powerGeneration:888,sludgeTotal:999,organicDaySiloLevel:777};
 const values=h.api.valuesForWorkbook(original);assert.equal(values.powerGeneration,888);assert.equal(values.sludgeTotal,30);assert.equal(values.organicDaySiloLevel,0);
 assert.equal(values.sludgeTruckCount,2);assert.equal(original.sludgeTotal,999);
 assert.equal(h.node('efficiencyMorningMeetingAutoDailyOrganicDaySilo').textContent,'0.00 t');
});
test('missing close protects workbook while checking independent saved data, without Agent/Excel work',async()=>{
 const h=harness(async()=>({ok:true,json:async()=>({ok:true,item:null})}));await h.api.load(DATE);
 assert.equal(h.api.state(DATE).status,'missing');assert.equal(h.calls.length,4);assert.ok(h.calls.some(x=>x.url.startsWith('/api/solid-fuel-trouble?')));assert.ok(h.calls.some(x=>x.url.includes('cofiring_period_source')));assert.ok(h.calls.some(x=>x.url.startsWith('/api/cofiring-provisional-v12?')));
 const result=h.api.valuesForWorkbook({sludgeTotal:7,sludgeTruckCount:8,organicTruckCount:44,organicReceivedAmount:555,organicDaySilo:9,organicDaySiloLevel:10,powerGeneration:111});
 assert.equal(result.sludgeTotal,undefined);assert.equal(result.organicTruckCount,undefined);assert.equal(result.organicReceivedAmount,undefined);assert.equal(result.organicDaySiloLevel,undefined);assert.equal(result.powerGeneration,111);
 assert.equal(h.node('efficiencyMorningMeetingAutoDailySludgeStatus').textContent,'마감자료 없음');
});
test('a late old-date result may be cached only for its own date and never repaints current day',async()=>{
 const gate=deferred();const h=harness(async url=>{if(url.startsWith('/api/cofiring-')){await gate.promise;return{ok:true,json:async()=>({ok:true,item:item()})};}return{ok:true,json:async()=>receipts()};});
 const promise=h.api.load(DATE);h.date('2026-09-26');gate.resolve();await promise;
 assert.equal(h.api.peek(DATE),null);assert.equal(h.node('efficiencyMorningMeetingAutoDailyOrganicDaySilo').textContent,'-');
});
test('reset or changed login invalidates in-flight data and prevents stale export',async()=>{
 for(const mode of ['reset','login']){
  const gate=deferred();const h=harness(async()=>{await gate.promise;return{ok:true,json:async()=>({ok:true,item:item()})};});
  const promise=h.api.load(DATE);if(mode==='reset')h.block(true);else h.token('different-session');gate.resolve();assert.equal(await promise,null);
  assert.equal(h.api.peek(DATE),null);assert.equal(h.api.valuesForWorkbook({sludgeTotal:999}).sludgeTotal,undefined);
 }
});
test('force refresh failure clears old values; receipt failure does not discard valid closing',async()=>{
 let failed=false;const h=harness(async url=>{if(url.startsWith('/api/cofiring-'))return{ok:!failed,json:async()=>failed?{ok:false,message:'cannot read'}:{ok:true,item:item()}};throw Error('receipt unavailable');});
 await h.api.load(DATE);assert.equal(h.api.peek(DATE).organic.sludgeTruckCount,null);assert.equal(h.api.peek(DATE).organic.sludgeTotal,30);
 failed=true;await assert.rejects(h.api.load(DATE,{force:true}),/cannot read/);assert.equal(h.api.peek(DATE),null);
 assert.equal(h.node('efficiencyMorningMeetingAutoDailySludgeTotal').textContent,'-');
});
test('save/delete notification invalidates saved cache and loads the new server state',async()=>{
 let missing=false;const h=harness(async url=>({ok:true,json:async()=>url.startsWith('/api/cofiring-')?{ok:true,item:missing?null:item()}:receipts()}));
 h.initialize();await h.api.load(DATE);assert.ok(h.api.peek(DATE));missing=true;
 h.rootEvents.get('cofiring:closed-history-changed')({detail:{targetDate:DATE}});await h.api.load(DATE);
 assert.equal(h.api.peek(DATE),null);assert.equal(h.api.state(DATE).status,'missing');
});
test('logged-out users send no requests and never retain old closing values',async()=>{
 const h=harness();h.token('');await assert.rejects(h.api.load(DATE),/로그인/);assert.equal(h.calls.length,0);assert.equal(h.api.peek(DATE),null);
});

test('unknown closed receipt count cannot fall back to legacy workbook aliases',async()=>{
 const h=harness(async url=>{if(url.startsWith('/api/cofiring-'))return{ok:true,json:async()=>({ok:true,item:item()})};throw Error('receipt unavailable');});
 await h.api.load(DATE);const result=h.api.valuesForWorkbook({organicTruckCount:88,organicReceivedAmount:999});
 assert.equal(result.sludgeTruckCount,null);assert.equal(result.organicTruckCount,undefined);assert.equal(result.organicReceivedAmount,undefined);
});
test('server-rejected persisted inventory cannot reenter via unvalidated snapshot fallback',()=>{
 const saved=item();saved.snapshot.organicInventory=saved.organicInventory;saved.organicInventory=null;
 assert.equal(normalizeItem(saved,DATE).organic.organicDaySilo,null);
});
test('captured workbook suppression or export date prevents closed values reappearing after reset release',async()=>{
 const h=harness();await h.api.load(DATE);
 for(const options of [{suppressClosedValues:true,targetDate:DATE},{targetDate:'2026-09-24'}]){
  const result=h.api.valuesForWorkbook({sludgeTotal:999,organicTruckCount:888,powerGeneration:50},options);
  assert.equal(result.sludgeTotal,undefined);assert.equal(result.organicTruckCount,undefined);assert.equal(result.powerGeneration,50);
 }
});

test('automatic receipt close refreshes amount and count from completed unloading; manual close remains authoritative',async()=>{
 const auto=harness(async url=>{
  if(url.startsWith('/api/cofiring-'))return{ok:true,json:async()=>({ok:true,item:item()})};
  const payload=receipts();
  payload.receipts.organic=230.99;
  payload.counts.organic=8;
  return{ok:true,json:async()=>payload};
 });

 await auto.api.load(DATE);

 assert.equal(auto.api.peek(DATE).organic.sludgeTotal,230.99);
 assert.equal(auto.api.peek(DATE).organic.sludgeTruckCount,8);

 const manualItem=item();
 manualItem.snapshot.manual.inputMode='manual';
 manualItem.snapshot.manual.receipts.organic=174.26;

 const manual=harness(async url=>{
  if(url.startsWith('/api/cofiring-'))return{ok:true,json:async()=>({ok:true,item:manualItem})};
  const payload=receipts(manualItem);
  payload.receipts.organic=230.99;
  payload.counts.organic=8;
  return{ok:true,json:async()=>payload};
 });

 await manual.api.load(DATE);

 assert.equal(manual.api.peek(DATE).organic.sludgeTotal,174.26);
 assert.equal(manual.api.peek(DATE).organic.sludgeTruckCount,null);
});

test('missing official close displays independent receipts and the 23 Oct 00:00 Storage B estimate', async () => {
  const date = '2026-10-23', next = '2026-10-24';
  const tags = {
    organicDaySilo: 'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT',
    organicStorageSiloA: 'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT',
    organicStorageSiloB: 'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'
  };
  const endpoint = async url => {
    const q = new URLSearchParams(url.split('?')[1]);
    const inventory = ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB'].map((key, i) => ({
      key, tag: tags[key], endValue: i === 2 ? null : i === 0 ? 10 : 20,
      endQuality: i === 2 ? 'Bad' : 'Raw, Good', endTime: next + 'T00:00:00+09:00'
    }));
    let data;
    if (url.startsWith('/api/cofiring-closed-history')) data = {ok: true, item: null};
    else if (url.startsWith('/api/solid-fuel-trouble')) {
      assert.equal(q.get('receiptStart'), date + 'T00:00');
      assert.equal(q.get('receiptEnd'), next + 'T00:00');
      data = {ok: true, source: 'solid-fuel-unloading', basis: 'completed-unloading-departure',
        receiptStart: date + 'T00:00', receiptEnd: next + 'T00:00', receipts: {organic: 55.25}, counts: {organic: 3}};
    } else if (q.get('action') === 'cofiring_period_source') data = {
      ok:true, targetDate:date, saved:{id:'22222222-2222-4222-8222-222222222222', status:'complete',requestType:'cofiring_period'},
      result:{kind:'cofiring_period_live_result',schemaVersion:1,requestId:'22222222-2222-4222-8222-222222222222',
        request:{startLocal:date+'T00:00',endLocal:next+'T00:00',stepUnit:'minute',stepValue:1},
        report:{startLocal:date+'T00:00',endLocal:next+'T00:00',organicInventoryReady:false,
          organicInventory:null,organicInventorySamples:inventory}}
    };
    else if (url.startsWith('/api/cofiring-provisional-v12')) data = {
      ok:true,item:{targetDate:date,recordKind:'hypothesis',verificationStatus:'unverified',officialClose:false,
        revision:2, sourceRequestId:'22222222-2222-4222-8222-222222222222', estimation:{boundaries:[{silo:'organicStorageSiloB',boundaryLocal:next+'T00:00',tons:19.143}]}}
    };
    else throw Error('Unrecognized GET ' + url);
    return {ok:true,json:async()=>data};
  };
  const h = harness(endpoint);h.date(date);
  await h.api.load(date);
  assert.equal(h.api.state(date).status, 'missing');
  const p = 'efficiencyMorningMeetingAutoDaily';
  assert.equal(h.node(p+'SludgeTotal').textContent, '55.25 t');
  assert.equal(h.node(p+'SludgeTruckCount').textContent, '3 건');
  assert.equal(h.node(p+'OrganicDaySilo').textContent, '10.00 t');
  assert.equal(h.node(p+'OrganicStorageSiloA').textContent, '20.00 t');
  assert.equal(h.node(p+'OrganicStorageSiloB').textContent, '≈19.143 t');
  assert.equal(h.node(p+'OrganicSiloTotal').textContent, '≈49.143 t');
  assert.equal(h.node(p+'SludgeStatus').textContent, '추정 포함 · 재확인');
});

const recoveryId = '33333333-3333-4333-8333-333333333333';
const currentRecoveryId = '22222222-2222-4222-8222-222222222222';
function recoveryEnvelope(date, amounts, id = currentRecoveryId) {
  const next = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const keys = ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB'];
  const tags = ['104SDF01CW001XQ01', '003SDF01CW001XQ01', '003SDF02CW001XQ01'];
  return {ok:true,targetDate:date,saved:{id,status:'complete',requestType:'cofiring_period'},
    result:{kind:'cofiring_period_live_result',schemaVersion:1,requestId:id,
      request:{startLocal:date+'T00:00',endLocal:next+'T00:00',stepUnit:'minute',stepValue:1},
      report:{startLocal:date+'T00:00',endLocal:next+'T00:00',organicInventoryReady:false,organicInventory:null,
        organicInventorySamples:keys.map((key,i)=>({key,tag:'GSPOGE.ABB_DCS.'+tags[i]+'/PLOT',
          endValue:amounts[i],endQuality:amounts[i]===null?'Bad':'Raw, Good',endTime:next+'T00:00:00+09:00'}))}}};
}
function recoveryProvisional(date, values = {}, id = recoveryId) {
  const next = new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  return {ok:true,item:{targetDate:date,sourceRequestId:id,recordKind:'hypothesis',verificationStatus:'unverified',
    officialClose:false,revision:1,estimation:{boundaries:Object.entries(values).map(([silo,tons])=>({
      silo,side:'end',boundaryLocal:next+'T00:00',tons}))}}};
}
function recoveryBrowserFetch(date, primary, provisional, pinned) {
  return async url => {
    const q=new URLSearchParams(url.split('?')[1]);let data;
    if(url.startsWith('/api/cofiring-closed-history'))data={ok:true,item:null};
    else if(url.startsWith('/api/solid-fuel-trouble'))data={ok:true,source:'solid-fuel-unloading',basis:'completed-unloading-departure',
      receiptStart:q.get('receiptStart'),receiptEnd:q.get('receiptEnd'),receipts:{organic:175.43},counts:{organic:6}};
    else if(url.startsWith('/api/cofiring-provisional-v12'))data=provisional;
    else if(q.get('sourceRequestId'))data=typeof pinned==='function'?await pinned():pinned;
    else if(q.get('action')==='cofiring_period_source')data=primary;
    else throw Error('Unexpected URL '+url);
    return {ok:true,json:async()=>data};
  };
}
test('browser fills missing Oct24 B from saved calculation source and displays measured total',async()=>{
  const date='2026-10-24',h=harness(recoveryBrowserFetch(date,recoveryEnvelope(date,[8.099,32.144,null]),
    recoveryProvisional(date),recoveryEnvelope(date,[8.099,32.144,57.839],recoveryId)));
  h.date(date);await h.api.load(date);
  const p='efficiencyMorningMeetingAutoDaily';
  assert.equal(h.node(p+'OrganicStorageSiloB').textContent,'57.84 t');
  assert.equal(h.node(p+'OrganicSiloTotal').textContent,'98.08 t');
  assert.match(h.node(p+'OrganicStorageSiloB').title,/저장된 혼소율 계산 원본/);
  assert.match(h.node(p+'SludgeCard').title,/2026-10-25 00:00/);
  assert.equal(h.calls.filter(x=>x.url.includes('sourceRequestId=')).length,1);
});
test('browser marks generic-date estimates for all three silos and total',async()=>{
  const date='2026-11-02',h=harness(recoveryBrowserFetch(date,recoveryEnvelope(date,[null,null,null]),
    recoveryProvisional(date,{organicDaySilo:1.25,organicStorageSiloA:2.5,organicStorageSiloB:3.75},currentRecoveryId),null));
  h.date(date);await h.api.load(date);
  const p='efficiencyMorningMeetingAutoDaily';
  assert.equal(h.node(p+'OrganicDaySilo').textContent,'≈1.250 t');
  assert.equal(h.node(p+'OrganicStorageSiloA').textContent,'≈2.500 t');
  assert.equal(h.node(p+'OrganicStorageSiloB').textContent,'≈3.750 t');
  assert.equal(h.node(p+'OrganicSiloTotal').textContent,'≈7.500 t');
  assert.equal(h.node(p+'SludgeStatus').textContent,'추정 포함 · 재확인');
  assert.ok(!h.node(p+'SludgeStatus').className.includes('is-complete'));
});
test('browser explains unresolved inventory without a fabricated zero or green completion',async()=>{
  const date='2026-11-02',h=harness(recoveryBrowserFetch(date,recoveryEnvelope(date,[1,2,null]),
    {ok:true,item:null},null));
  h.date(date);await h.api.load(date);
  const p='efficiencyMorningMeetingAutoDaily';
  assert.equal(h.node(p+'OrganicStorageSiloB').textContent,'-');
  assert.equal(h.node(p+'OrganicSiloTotal').textContent,'-');
  assert.equal(h.node(p+'SludgeStatus').textContent,'재고 확인 필요');
  assert.match(h.node(p+'OrganicStorageSiloB').title,/품질/);
  assert.ok(!h.node(p+'SludgeStatus').className.includes('is-complete'));
});
test('changing date during a pinned-source read cannot repaint the new day',async()=>{
  const date='2026-10-24',late=deferred(),started=deferred();
  const h=harness(recoveryBrowserFetch(date,recoveryEnvelope(date,[8.099,32.144,null]),
    recoveryProvisional(date),()=>{started.resolve();return late.promise;}));
  h.date(date);const loading=h.api.load(date);await started.promise;
  h.date('2026-10-25');h.api.renderOrganic();
  late.resolve(recoveryEnvelope(date,[8.099,32.144,57.839],recoveryId));await loading;
  const p='efficiencyMorningMeetingAutoDaily';
  assert.notEqual(h.node(p+'OrganicStorageSiloB').textContent,'57.84 t');
  assert.ok(!h.node(p+'SludgeDate').textContent.includes('2026-10-24'));
});
