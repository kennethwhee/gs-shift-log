import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {sourceResult, packet, database, call, stored, expect, spec, core, clone, SOURCE_ID} from './helpers/cofiring-review-fixture.mjs';

test('organic usage requires the same-period three-silo balance and allocates its verified total equally',()=>{
  const reference=sourceResult().report.reference;
  const result=core.organicInventoryUsage(reference,115.39,spec);
  assert.equal(result.ok,true);
  assert.ok(Math.abs(result.usage-105.39)<1e-9);
  assert.equal(result.allocation.unit1,52.695);assert.equal(result.allocation.unit2,52.695);
  assert.equal(result.allocation.total,105.39);assert.ok(Math.abs(result.allocation.diff)<1e-9);
  assert.equal(core.organicInventoryUsage(reference,10,spec).usage,0);
  assert.equal(core.organicInventoryUsage(reference,30.12345,spec).allocation.unit1,10.0617);
});

test('missing, stale, inconsistent and invalid inventory or receipts never become organic zero',()=>{
  const reference=sourceResult().report.reference;
  const mutations=[r=>delete r.organicInventory,r=>r.organicInventoryReady=false,
    r=>r.organicInventory.endLocal='2026-09-12T00:00',r=>r.startLocal='2026-09-09T00:00',
    r=>r.organicInventory.start.organicDaySilo=null,r=>r.organicInventory.start.organicDaySilo='20',
    r=>r.organicInventory.end.total=159,r=>r.organicInventory.start.total=-1,
    r=>r.organicInventory.basis='daily_excel'];
  for(const mutate of mutations){const r=clone(reference);mutate(r);const out=core.organicInventoryUsage(r,30,spec);assert.equal(out.ok,false);assert.equal(out.usage,null);}
  for(const receipt of [null,undefined,'30',true,NaN,Infinity,-1])assert.equal(core.organicInventoryUsage(reference,receipt,spec).ok,false);
  assert.equal(core.organicInventoryUsage(reference,0,spec).code,'ORGANIC_BALANCE_NEGATIVE');
});

test('closing refuses old manual 10.42 quantities when inventory is unavailable',async t=>{
  const db=database(t,sourceResult({inventory:false})),p=packet();
  p.snapshot.manual.unit1.organic=10.42;p.snapshot.manual.unit2.organic=10.42;
  const response=await call(db,{body:p});assert.equal(response.status,400);assert.equal(db.writes,0);
  assert.match(response.payload.message,/유기성.*재고/);
});

test('closing rejects wrong allocations even when a matching client calculation is supplied',async t=>{
  for(const [one,two] of [[10.42,10.42],[9,11]]){
    const db=database(t),p=packet(),r=sourceResult().report.reference;
    p.snapshot.manual.unit1.organic=one;p.snapshot.manual.unit2.organic=two;
    p.snapshot.result=core.analyzePeriodSummary(r,{organic:{unit1:one,unit2:two},manure:{unit1:2,unit2:0}});
    assert.equal((await call(db,{body:p})).status,400);assert.equal(db.writes,0);
  }
});

test('valid closes record the balance and loss of source inventory cannot replace a previous close',async t=>{
  const db=database(t),first=await call(db);assert.equal(first.status,200);
  const original=stored(db),snap=JSON.parse(original.snapshot_json);
  assert.equal(snap.organicUsage.startTotal,150);assert.equal(snap.organicUsage.endTotal,160);
  assert.equal(snap.organicUsage.receipt,30);assert.equal(snap.organicUsage.usage,20);
  db.raw.prepare('UPDATE ois_data_requests SET result_json=?').run(JSON.stringify(sourceResult({inventory:false})));
  const response=await call(db,{body:{...packet(),...expect(first.payload.item)}});
  assert.equal(response.status,400);assert.deepEqual(stored(db),original);
});

// Model only the DOM selectors and remote transport; mount the shipped UI and
// use the actual core and validated DataPARC report. No browser/package install.
class Element {
  constructor(attributes={}){this.attributes=attributes;this.dataset={};this.value=attributes.value||'';this.hidden=Object.hasOwn(attributes,'hidden');this.disabled=Object.hasOwn(attributes,'disabled');this.textContent='';this.children=[];this.listeners={};this.classList={add(){},remove(){},toggle(){}};}
  set innerHTML(value){this.html=value;this.children=[];for(const tag of value.matchAll(/<[a-z][^>]*\bdata-cfv[^>]*>/g)){const attrs={};for(const a of tag[0].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]||'';this.children.push(new Element(attrs));}}
  get innerHTML(){return this.html||'';}
  querySelectorAll(selector){const selectors=selector.split(',').map(s=>/^\[([^=\]]+)(?:="([^\"]+)")?\]$/.exec(s.trim())),out=[];for(const child of this.children){if(selectors.some(m=>m&&Object.hasOwn(child.attributes,m[1])&&(m[2]===undefined||child.attributes[m[1]]===m[2])))out.push(child);out.push(...child.querySelectorAll(selector));}return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getAttribute(name){return Object.hasOwn(this.attributes,name)?this.attributes[name]:null;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  closest(){return null;}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  async fire(type){for(const fn of this.listeners[type]||[])await fn({target:this});}
}
async function flush(){for(let i=0;i<40;i++)await Promise.resolve();}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function mounted({inventory=true,receipt=115.39,receiptGate=null,receiptError=false,wrongReceiptRange=false,sourcePath=new URL('../maintenance/cofiring-period-ui-v5.js',import.meta.url)}={}){
  const h={saves:[],receiptCalls:[],receiptGate,receiptError,wrongReceiptRange,inventory,receipt};
  const container=new Element(),timers=new Map();let serial=0,liveOptions;
  const settings=packet().snapshot.settings;
  const blank=()=>({unit1:{organic:null,manure:null},unit2:{organic:null,manure:null},receipts:{organic:null,manure:null}});
  const saved=()=>({unit1:{organic:10.42,manure:0},unit2:{organic:10.42,manure:0},receipts:{organic:115.39,manure:0}});
  function store(kind,options){let selected;const state={loaded:false,loading:false,saving:false,error:'',canEdit:true,revision:3,settings,values:saved()};return {
    state:()=>state,defaults:()=>settings,select(...args){const key=JSON.stringify(args);if(key!==selected){selected=key;state.loaded=false;state.values=saved();}},
    async load(){state.loaded=true;options.onChange();return true;},async save(values){h.saves.push(clone(values));state.values=clone(values);return true;},dispose(){}};}
  const liveState={authenticated:true,canQuery:true,period:null,item:{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:''}};
  const live={state:()=>liveState,select(period){liveState.period={...period};},async load(){return true;},async readLatestDaily(){return null;},pause(){},dispose(){}};
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-09-24T13:11:00Z']));}static now(){return Date.parse('2026-09-24T13:11:00Z');}}
  const context=vm.createContext({Date:FixedDate,console,URLSearchParams,CofiringCore:core,
    CofiringLive:{createPeriod:options=>{liveOptions=options;return live;}},
    CofiringCalculationSettingsStorage:{create:options=>store('settings',options)},
    CofiringPeriodManualStorage:{blank,parseValue:v=>String(v).trim()===''?null:Number(v),create:options=>store('manual',options)},
    CofiringPeriodAdjustmentV56:{create:()=>null},getShiftLogAuthHeaders:()=>({Authorization:'Bearer synthetic'}),
    document:{readyState:'loading',addEventListener(){},getElementById:()=>null},navigator:{userAgent:'desktop'},location:{pathname:'/maintenance/',origin:'https://review.invalid'},
    setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id),confirm:()=>true,
    addEventListener(){},removeEventListener(){},async fetch(url){const params=new URL(url,'https://review.invalid').searchParams;
      const data={ok:true,receiptStart:params.get('receiptStart'),receiptEnd:params.get('receiptEnd'),source:'solid-fuel-unloading',basis:'completed-unloading-departure',receipts:{organic:h.receipt,manure:0},counts:{organic:4,manure:0}};
      h.receiptCalls.push(data);const gate=h.receiptGate;if(gate)await gate.promise;
      if(h.receiptError)throw Error('Synthetic receipt failure');if(h.wrongReceiptRange)data.receiptEnd='2026-09-23T00:00';
      return {ok:true,json:async()=>data};}});
  vm.runInContext(fs.readFileSync(sourcePath,'utf8'),context);
  h.controller=context.CofiringPeriodV5.mount(container);h.find=key=>container.querySelector(`[data-${key}]`);h.container=container;
  h.ready=flush;
  h.seed=()=>{const result=sourceResult({specification:h.controller.getSpec(),inventory:h.inventory});liveState.item={...liveState.item,saved:{id:SOURCE_ID,status:'complete'},result};liveOptions.onResult(result);liveOptions.onChange(liveState);return h.controller.getResult();};
  return h;
}

test('mounted UI discards saved 10.42 values without inventory, retains coal/bio and blocks both saves',async t=>{
  const h=mounted({inventory:false});t.after(()=>h.controller.dispose());await h.ready();const r=h.seed();
  for(const unit of ['unit1','unit2']){assert.equal(r.units[unit].organic.quantity,null);assert.equal(r.units[unit].fuelRatios.total,null);assert.ok(r.units[unit].coal.quantity>0);assert.ok(r.units[unit].bio.quantity>0);
    const input=h.container.querySelector(`[data-cfv5-manual="${unit}:organic"]`);assert.equal(input.value,'');assert.equal(input.readOnly,true);}
  assert.equal(h.find('cfv5-manual-save').disabled,true);assert.throws(()=>h.controller.getSnapshotInputs(),/유기성/);
  await h.find('cfv5-manual-save').fire('click');assert.equal(h.saves.length,0);
  assert.match(h.find('cfv11-status-line').textContent,/유기성 자료 확인 필요/);
});

test('mounted UI uses the confirmed inventory before calculating and keeps four-decimal allocation consistent',async t=>{
  const h=mounted({receipt:30.12345});t.after(()=>h.controller.dispose());await h.ready();const r=h.seed();
  for(const unit of ['unit1','unit2']){assert.equal(r.units[unit].organic.quantity,10.0617);assert.equal(h.container.querySelector(`[data-cfv5-manual="${unit}:organic"]`).value,'10.0617');}
  assert.equal(h.find('cfv5-manual-save').disabled,false);assert.equal(h.controller.getSnapshotInputs().manual.unit1.organic,10.0617);
  await h.find('cfv5-manual-save').fire('click');assert.equal(h.saves.length,1);assert.equal(h.saves[0].unit1.organic,10.0617);
});

test('receipt failure or wrong range cannot reuse the saved 115.39 receipt or organic quantities',async t=>{
  for(const options of [{receiptError:true},{wrongReceiptRange:true}]){
    const h=mounted(options);t.after(()=>h.controller.dispose());await h.ready();const r=h.seed();
    assert.equal(r.units.unit1.organic.quantity,null);assert.equal(h.find('cfv5-manual-save').disabled,true);
    assert.match(h.find('cfv14-receipt-source').textContent,/실패/);
  }
});

test('a delayed receipt response fills organic usage only after the current receipt is verified',async t=>{
  const gate=deferred(),h=mounted({receiptGate:gate});t.after(()=>h.controller.dispose());await h.ready();
  assert.equal(h.seed().units.unit1.organic.quantity,null);gate.resolve();await flush();
  assert.equal(h.controller.getResult().units.unit1.organic.quantity,52.695);
});

test('a delayed old-date receipt response cannot overwrite a newer selected date',async t=>{
  const gate=deferred(),h=mounted({receiptGate:gate});t.after(()=>h.controller.dispose());await h.ready();h.seed();
  h.receiptGate=null;h.receipt=30;h.find('cfv7-date').value='2026-09-23';await h.find('cfv7-date').fire('change');await flush();h.seed();
  assert.equal(h.controller.getResult().units.unit1.organic.quantity,10);gate.resolve();await flush();
  assert.equal(h.controller.getSpec().startLocal,'2026-09-23T00:00');assert.equal(h.controller.getResult().units.unit1.organic.quantity,10);
});
