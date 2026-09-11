'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const storage=require('../maintenance/cofiring-settings-storage.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const response=(body,status=200)=>({ok:status<400,status,json:async()=>clone(body)});
function harness(custom={}){
 let token='session',desktop=true,n=0;const calls=[];
 const store=storage.create({getHeaders:()=>token?{Authorization:'Bearer '+token}:{},canEdit:()=>desktop,requestId:()=>String(++n).padStart(32,'0'),
   fetch:async(url,opts)=>{calls.push({url,...opts});if(custom.fetch)return custom.fetch(url,opts);return response({ok:true,targetDate:'2026-09-08',source:'default',effectiveDate:null,settings:storage.defaults(),updatedById:'',updatedByName:'',updatedAt:''});}});
 store.select('2026-09-08');return {store,calls,setToken:v=>token=v,setDesktop:v=>desktop=v};
}
test('defaults contain four fuels for both units and positive assumptions',()=>{
 const d=storage.defaults();for(const unit of ['unit1','unit2'])for(const fuel of ['coal','bio','organic','manure']){assert.ok(d[unit][fuel].calorific>0);assert.ok(d[unit][fuel].coefficient>0);}assert.equal(d.unit1.coal.calorific,5868);assert.equal(d.unit1.manure.calorific,3487);
});
test('anonymous use keeps defaults locally without a network request',async()=>{const h=harness();h.setToken('');assert.equal(await h.store.load(),true);assert.equal(h.calls.length,0);assert.equal(h.store.state().source,'default');assert.equal(await h.store.save(storage.defaults()),false);});
test('authenticated GET adopts selected-day settings and POST saves the whole 1/2 unit matrix',async()=>{
 const custom=storage.defaults();custom.unit1.coal.calorific=6000;custom.unit2.bio.coefficient=.98;
 const h=harness({fetch:(url,o)=>o.method==='GET'?response({ok:true,targetDate:'2026-09-08',source:'saved',effectiveDate:'2026-09-01',settings:custom,updatedById:'a',updatedByName:'A',updatedAt:'2026-09-01T00:00:00.000Z'}):response({ok:true,entry:{effectiveDate:'2026-09-08',settings:custom,updatedById:'a',updatedByName:'A',updatedAt:'2026-09-08T00:00:00.000Z'}})});
 assert.equal(await h.store.load(),true);assert.equal(h.store.state().settings.unit1.coal.calorific,6000);assert.equal(await h.store.save(custom),true);const body=JSON.parse(h.calls[1].body);assert.equal(body.effectiveDate,'2026-09-08');assert.equal(body.settings.unit2.bio.coefficient,.98);assert.equal(h.calls[1].headers['X-ShiftLog-Client'],'desktop');
});
test('mobile can load but cannot save settings',async()=>{const h=harness();h.setDesktop(false);await h.store.load();assert.equal(await h.store.save(storage.defaults()),false);assert.equal(h.calls.length,1);});
test('invalid settings are rejected client-side',async()=>{const h=harness();await h.store.load();const bad=storage.defaults();bad.unit1.coal.coefficient=0;assert.equal(storage.validSettings(bad),false);assert.equal(await h.store.save(bad),false);});
