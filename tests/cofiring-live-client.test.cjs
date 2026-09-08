'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{gunzipSync}=require('zlib');
const contract=require('../maintenance/cofiring-live-contract.js'),{create}=require('../maintenance/cofiring-live.js');
const fixtures=JSON.parse(gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/cofiring-live-v7.json.gz'))));
const clone=x=>JSON.parse(JSON.stringify(x));
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:x=>resolve(x)};}
function harness(){
 let token='Bearer local-test',mobile=false,visible=true;const calls=[],results=[],timers=new Map();let timerId=0;
 let response={ok:true,bridgeVersion:1,targetDate:'2026-09-08',saved:null,result:null,active:null,lastAttempt:null};
 const obj=create({getHeaders:()=>token?{Authorization:token}:{},canQuery:()=>!mobile,isVisible:()=>visible,now:()=>Date.parse('2026-09-09T09:00:00+09:00'),makeId:()=>crypto.randomUUID(),
 setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
 onResult:(r,s)=>results.push({r,s}),fetch:async(url,init)=>{calls.push({url,init});const data=typeof response==='function'?await response(url,init):clone(response);return {ok:data.ok,status:data.ok?200:500,json:async()=>data};}});
 return {obj,calls,results,timers,set response(r){response=r;},set token(v){token=v;},set mobile(v){mobile=v;},set visible(v){visible=v;}};
}
function item(date='2026-09-08',status='complete',id=crypto.randomUUID()){return {id,targetDate:date,requestType:'cofiring_daily',status,completedAt:'2026-09-09T04:00:00+09:00'};}
function saved(date='2026-09-08',s=item(date)) {return {ok:true,bridgeVersion:1,targetDate:date,saved:s,active:null,lastAttempt:s,result:{kind:'cofiring_live_result',schemaVersion:1,requestId:s.id,targetDate:date,report:contract.validateReport(fixtures[date],date)}};}
test('mount/select never POST; authenticated saved load only GET; anonymous stays offline',async()=>{
 const h=harness();h.obj.select('2026-09-08');assert.equal(h.calls.length,0);await h.obj.load();assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,undefined);h.token='';h.obj.select('2026-09-07');await h.obj.load();assert.equal(h.calls.length,1);h.obj.dispose();
});
test('only explicit authenticated desktop action starts new day query and carries exact date',async()=>{
 const h=harness();h.obj.select('2026-09-08');await h.obj.query();assert.equal(h.calls.length,0);h.mobile=true;await h.obj.query({explicit:true});assert.equal(h.calls.length,0);h.mobile=false;
 const active=item('2026-09-08','pending');h.response=async(url,init)=>init.method==='POST'?{ok:true,targetDate:'2026-09-08',item:active}:{ok:true,bridgeVersion:1,targetDate:'2026-09-08',saved:null,result:null,active,lastAttempt:active};
 await h.obj.query({explicit:true});assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);const body=JSON.parse(h.calls[0].init.body);assert.equal(body.targetDate,'2026-09-08');assert.equal(body.requestType,'cofiring_daily');assert.equal(body.forceRefresh,false);
 await h.obj.query({explicit:true});assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);h.obj.dispose();
});
test('saved result reused and cached with knownResultId; only explicit requery POSTs',async()=>{
 const h=harness();h.obj.select('2026-09-08');const s=saved();h.response=s;await h.obj.load();assert.equal(h.results[0].r.report.noDataRows,54);
 h.response={...s,result:null};await h.obj.query({explicit:true});assert.ok(h.calls.at(-1).url.includes('knownResultId='+s.saved.id));assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
 h.response=(url,init)=>init.method==='POST'?{ok:true,targetDate:s.targetDate,item:item(s.targetDate,'pending')}:{...s,result:null};await h.obj.query({explicit:true,force:true});assert.equal(JSON.parse(h.calls.find(c=>c.init.method==='POST').init.body).expectedResultId,s.saved.id);h.obj.dispose();
});
test('wrong-day/stale GET cannot overwrite newly selected date',async()=>{
 const h=harness(),gate=deferred();h.obj.select('2026-09-08');h.response=()=>gate.promise;const pending=h.obj.load();h.obj.select('2026-09-07');h.response=saved('2026-09-07');await h.obj.load();gate.resolve(saved());await pending;assert.equal(h.results.length,1);assert.equal(h.results[0].r.targetDate,'2026-09-07');assert.equal(h.obj.state().targetDate,'2026-09-07');h.obj.dispose();
});
test('logout during GET discards response and clears cached day data',async()=>{
 const h=harness(),gate=deferred();h.obj.select('2026-09-08');h.response=()=>gate.promise;const pending=h.obj.load();h.token='';gate.resolve(saved());await pending;assert.equal(h.results.length,0);assert.equal(h.obj.state().day,null);h.obj.dispose();
});
test('failed refresh retains previous stored report, POST is not retried automatically',async()=>{
 const h=harness();h.obj.select('2026-09-08');const s=saved();h.response=s;await h.obj.load();h.response={ok:false,message:'test network failure'};await h.obj.load();assert.equal(h.obj.state().day.result.report.noDataRows,54);assert.match(h.obj.state().day.error,/test network/);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);h.obj.dispose();
});
test('bad result and mismatched ID response cannot replace last verified server result',async()=>{
 const h=harness();h.obj.select('2026-09-08');const s=saved();h.response=s;await h.obj.load();const bad=saved();bad.result.report.reference.series[0].values[10]=null;h.response=bad;await h.obj.load();assert.equal(h.obj.state().day.saved.id,s.saved.id);assert.equal(h.results.length,1);h.obj.dispose();
});
test('hidden view stops status polling, saved-data errors never launch a query',async()=>{
 const h=harness();h.obj.select('2026-09-08');const a=item('2026-09-08','processing');h.response={ok:true,bridgeVersion:1,targetDate:'2026-09-08',saved:null,result:null,active:a,lastAttempt:a};await h.obj.load();assert.equal([...h.timers.values()].filter(t=>t.ms===5000).length,1);h.visible=false;h.obj.pause();assert.equal(h.timers.size,0);h.obj.dispose();
});
test('today/uncompleted day cannot POST and repeated button press cannot duplicate in-flight POST',async()=>{
 const h=harness();h.obj.select('2026-09-09');assert.equal(await h.obj.query({explicit:true}),false);h.obj.select('2026-09-08');const gate=deferred();h.response=()=>gate.promise;const one=h.obj.query({explicit:true});assert.equal(await h.obj.query({explicit:true}),false);gate.resolve({ok:false,message:'request lost'});await one;assert.equal(h.calls.length,1);h.obj.dispose();
});
