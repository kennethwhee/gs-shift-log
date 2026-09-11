'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {cachedReference}=require('../maintenance/cofiring-period-ui-v5.js');
const spec={startLocal:'2026-09-10T00:00',endLocal:'2026-09-11T00:00',stepUnit:'hour',stepValue:1};
function ready(){const id='11111111-1111-4111-8111-111111111111';return {authenticated:true,canQuery:true,period:{...spec},item:{saved:{id},result:{requestId:id,report:{reference:{kind:'cofiring_period_summary_v1',...spec}}},active:null,loading:false,submitting:false,error:''}};}
test('ready saved result exposes the same validated reference for immediate recalculation',()=>{const s=ready();assert.equal(cachedReference(s,spec),s.item.result.report.reference);});
test('in-flight, failed and unavailable sessions cannot take the immediate calculation shortcut',()=>{
  for(const field of ['active','loading','submitting','error']){const s=ready();s.item[field]=field==='active'?{status:'processing'}:field==='error'?'조회 오류':true;assert.equal(cachedReference(s,spec),null,field);}
  for(const field of ['authenticated','canQuery']){const s=ready();s[field]=false;assert.equal(cachedReference(s,spec),null,field);}
});
test('date, end boundary and sampling-step changes never reuse another selected result',()=>{
  for(const [key,value] of [['startLocal','2026-09-09T00:00'],['endLocal','2026-09-11T00:01'],['stepUnit','minute'],['stepValue',2]]){
    const s=ready();assert.equal(cachedReference(s,{...spec,[key]:value}),null,key);
    s.item.result.report.reference[key]=value;assert.equal(cachedReference(s,spec),null,'reference '+key);
  }
});
test('a saved request ID must match its result and missing references stay unavailable',()=>{
  const s=ready();s.item.result.requestId='22222222-2222-4222-8222-222222222222';assert.equal(cachedReference(s,spec),null);
  assert.equal(cachedReference(null,spec),null);assert.equal(cachedReference({...ready(),item:{}},spec),null);
  const other=ready();other.item.result.report.reference.kind='cofiring_daily_summary';assert.equal(cachedReference(other,spec),null);
});
