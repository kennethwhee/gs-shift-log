'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,parseTons}=require('../maintenance/cofiring-manure-storage.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function row(date='2026-09-08',unit='unit1',tons=50,revision=1){return {targetDate:date,unit,tons,revision,source:'manual',updatedById:'test-user',updatedByName:'시험 사용자',updatedAt:'2026-09-08T18:00:00.000Z'};}
const response=(body,status=200)=>({ok:status<400,status,json:async()=>clone(body)});
function harness(custom={}){
 let token='test-session',desktop=true,n=0;const calls=[];
 const store=create({getHeaders:()=>token?{Authorization:'Bearer '+token}:{},canEdit:()=>desktop,requestId:()=>String(++n).padStart(32,'0'),
   fetch:async(url,opts)=>{calls.push({url,...opts});if(custom.fetch)return custom.fetch(url,opts);return response({ok:true,targetDate:'2026-09-08',entries:{unit1:null,unit2:null}});}});
 store.select('2026-09-08');return {store,calls,setToken:v=>token=v,setDesktop:v=>desktop=v};
}
test('blank is missing; zero and precision are preserved without silent coercion',()=>{
 for(const value of ['',null,undefined,true,[],{},'-1','1e2','1,000','NaN','Infinity','1.2345678','1000001'])assert.throws(()=>parseTons(value));
 for(const [v,expected]of [['0',0],[' 59.84 ',59.84],['1.234567',1.234567],[0,0]])assert.equal(parseTons(v),expected);
});
test('selecting alone never starts a request and anonymous state cannot load or save',async()=>{
 const h=harness();assert.equal(h.calls.length,0);h.setToken('');assert.equal(await h.store.load(),false);assert.equal(await h.store.save('unit1'),false);assert.equal(h.calls.length,0);
});
test('one calendar date is required; invalid dates cannot start a request',async()=>{
 const h=harness();for(const d of ['2026-02-29','2026-09-08T00:00','2026-09-08~09','',null]){h.store.select(d);assert.equal(await h.store.load(),false);}assert.equal(h.calls.length,0);
});
test('a zero save is explicit, per-unit, authenticated, and only adopted after success',async()=>{
 const wait=deferred(),h=harness({fetch:(url,o)=>o.method==='GET'?response({ok:true,targetDate:'2026-09-08',entries:{unit1:null,unit2:null}}):wait.promise});
 await h.store.load();h.store.setDraft('unit1','0');assert.deepEqual(h.store.values(),{unit1:null,unit2:null});
 const pending=h.store.save('unit1');assert.equal(h.store.state().day.units.unit1.saving,true);assert.equal(await h.store.save('unit1'),false);assert.equal(h.calls.length,2);
 const payload=JSON.parse(h.calls[1].body);assert.equal(payload.tons,0);assert.equal(payload.expectedRevision,0);assert.equal(payload.unit,'unit1');assert.equal(h.calls[1].headers['X-ShiftLog-Client'],'desktop');
 wait.resolve(response({ok:true,targetDate:'2026-09-08',unit:'unit1',entry:row('2026-09-08','unit1',0)}));assert.equal(await pending,true);assert.deepEqual(h.store.values(),{unit1:0,unit2:null});assert.equal(h.store.state().day.units.unit1.editing,false);
});
test('save failure preserves typed text and retries the same idempotent request',async()=>{
 const h=harness({fetch:(url,o)=>o.method==='GET'?response({ok:true,targetDate:'2026-09-08',entries:{unit1:null,unit2:null}}):response({ok:false,message:'offline'},500)});
 await h.store.load();h.store.setDraft('unit1','59.840001');assert.equal(await h.store.save('unit1'),false);assert.equal(await h.store.save('unit1'),false);
 assert.equal(h.calls[1].body,h.calls[2].body);assert.equal(h.store.state().day.units.unit1.draft,'59.840001');assert.equal(h.store.values().unit1,null);
});
test('different date does not inherit manure usage; return and same-day reload preserve saved entries',async()=>{
 const h=harness({fetch:url=>{const d=new URL(url,'https://local').searchParams.get('targetDate');return response({ok:true,targetDate:d,entries:{unit1:d==='2026-09-08'?row():null,unit2:null}});}});
 await h.store.load();assert.equal(h.store.values().unit1,50);h.store.select('2026-09-09');assert.equal(h.store.values().unit1,null);await h.store.load();assert.equal(h.store.values().unit1,null);
 h.store.select('2026-09-08');await h.store.load();assert.equal(h.store.values().unit1,50);assert.equal(h.calls.length,2);
});
test('slow previous-date GET cannot contaminate the current date',async()=>{
 const wait=deferred();const h=harness({fetch:url=>url.includes('2026-09-08')?wait.promise:response({ok:true,targetDate:'2026-09-09',entries:{unit1:null,unit2:null}})});
 const first=h.store.load();h.store.select('2026-09-09');await h.store.load();wait.resolve(response({ok:true,targetDate:'2026-09-08',entries:{unit1:row(),unit2:null}}));await first;assert.deepEqual(h.store.values(),{unit1:null,unit2:null});
});
test('old-date save can finish but never writes its value into a newly selected date',async()=>{
 const wait=deferred();const h=harness({fetch:(url,o)=>o.method==='POST'?wait.promise:response({ok:true,targetDate:new URL(url,'https://local').searchParams.get('targetDate'),entries:{unit1:null,unit2:null}})});
 await h.store.load();h.store.setDraft('unit1','5');const save=h.store.save('unit1');h.store.select('2026-09-09');await h.store.load();wait.resolve(response({ok:true,targetDate:'2026-09-08',unit:'unit1',entry:row('2026-09-08','unit1',5)}));assert.equal(await save,true);assert.equal(h.store.values().unit1,null);h.store.select('2026-09-08');assert.equal(h.store.values().unit1,5);
});
test('load deduplicates and fails closed on a wrong-day response',async()=>{
 const wait=deferred();const h=harness({fetch:()=>wait.promise});const a=h.store.load(),b=h.store.load();assert.equal(h.calls.length,1);wait.resolve(response({ok:true,targetDate:'2026-09-09',entries:{unit1:null,unit2:null}}));await Promise.all([a,b]);assert.equal(h.store.state().day.loaded,false);assert.equal(await h.store.save('unit1'),false);
});
test('signed-out or changed-identity responses are discarded and cached values are cleared',async()=>{
 const wait=deferred();const h=harness({fetch:()=>wait.promise});const pending=h.store.load();h.setToken('another-user');h.store.state();wait.resolve(response({ok:true,targetDate:'2026-09-08',entries:{unit1:row(),unit2:null}}));assert.equal(await pending,false);assert.equal(h.store.values().unit1,null);
});
test('mobile can read saved values but cannot edit or POST',async()=>{
 const h=harness({fetch:()=>response({ok:true,targetDate:'2026-09-08',entries:{unit1:row(),unit2:null}})});h.setDesktop(false);await h.store.load();assert.equal(h.store.values().unit1,50);assert.equal(h.store.edit('unit1'),false);assert.equal(h.store.setDraft('unit1','5'),false);assert.equal(await h.store.save('unit1'),false);assert.equal(h.calls.length,1);
});
test('a stale editor must review conflict, not silently overwrite the new server revision',async()=>{
 const h=harness({fetch:(url,o)=>o.method==='GET'?response({ok:true,targetDate:'2026-09-08',entries:{unit1:row(),unit2:null}}):response({ok:false,code:'REVISION_CONFLICT',message:'conflict',current:row('2026-09-08','unit1',60,2)},409)});
 await h.store.load();h.store.edit('unit1');h.store.setDraft('unit1','55');assert.equal(await h.store.save('unit1'),false);assert.equal(h.store.state().day.units.unit1.draft,'55');assert.equal(h.store.values().unit1,50);assert.equal(await h.store.save('unit1'),false);assert.equal(h.calls.length,2);h.store.useLatest('unit1');assert.equal(h.store.values().unit1,60);assert.equal(h.store.state().day.units.unit1.editing,false);
});
test('forced reload does not replace an unsaved draft or silently advance its revision',async()=>{
 let rev=1;const h=harness({fetch:()=>response({ok:true,targetDate:'2026-09-08',entries:{unit1:row('2026-09-08','unit1',50*rev,rev),unit2:null}})});
 await h.store.load();h.store.edit('unit1');h.store.setDraft('unit1','55');rev=2;await h.store.load({force:true});assert.equal(h.store.state().day.units.unit1.draft,'55');assert.equal(h.store.state().day.units.unit1.hasConflict,true);assert.equal(h.store.values().unit1,50);
});
test('a slow GET started during saving cannot roll back a newer confirmed save',async()=>{
 let get=0;const waitGet=deferred(),waitSave=deferred();const h=harness({fetch:(url,o)=>o.method==='POST'?waitSave.promise:++get===1?response({ok:true,targetDate:'2026-09-08',entries:{unit1:row(),unit2:null}}):waitGet.promise});
 await h.store.load();h.store.edit('unit1');h.store.setDraft('unit1','70');const save=h.store.save('unit1');const read=h.store.load({force:true});waitSave.resolve(response({ok:true,targetDate:'2026-09-08',unit:'unit1',entry:row('2026-09-08','unit1',70,2)}));await save;waitGet.resolve(response({ok:true,targetDate:'2026-09-08',entries:{unit1:row(),unit2:null}}));await read;assert.equal(h.store.values().unit1,70);
});
test('cancel restores saved number; explicit clear sends null, never zero',async()=>{
 const h=harness({fetch:(url,o)=>o.method==='GET'?response({ok:true,targetDate:'2026-09-08',entries:{unit1:row(),unit2:null}}):response({ok:true,targetDate:'2026-09-08',unit:'unit1',entry:row('2026-09-08','unit1',null,2)})});
 await h.store.load();h.store.edit('unit1');h.store.setDraft('unit1','100');h.store.cancel('unit1');assert.equal(h.store.state().day.units.unit1.draft,'50');h.store.edit('unit1');assert.equal(await h.store.save('unit1',{clear:true}),true);assert.equal(JSON.parse(h.calls[1].body).tons,null);assert.equal(JSON.parse(h.calls[1].body).action,'clear');assert.equal(h.store.values().unit1,null);
});
test('wrong-unit or wrong-amount save response is never treated as confirmed',async()=>{
 const h=harness({fetch:(url,o)=>o.method==='GET'?response({ok:true,targetDate:'2026-09-08',entries:{unit1:null,unit2:null}}):response({ok:true,targetDate:'2026-09-08',unit:'unit2',entry:row('2026-09-08','unit2',6)})});
 await h.store.load();h.store.setDraft('unit1','5');assert.equal(await h.store.save('unit1'),false);assert.equal(h.store.values().unit1,null);assert.equal(h.store.state().day.units.unit1.draft,'5');
});
