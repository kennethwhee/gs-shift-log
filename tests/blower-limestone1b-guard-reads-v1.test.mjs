import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAppendBase} from '../functions/_shared/blower-incremental.js';
import {createLimestone1bFixture,SIGNAL as SIGNAL1B} from './helpers/blower-limestone1b-fixture-v1.mjs';
import {createLimestone2aFixture,SIGNAL as SIGNAL2A} from './helpers/blower-limestone2a-fixture-v1.mjs';

async function fixture(t,kind){
  const f=kind==='1B'?await createLimestone1bFixture(t):await createLimestone2aFixture(t);
  await f.apply(kind==='1B'?await f.ready():await f.status());
  return {f,signal:kind==='1B'?SIGNAL1B:SIGNAL2A};
}
function intercept(f,transform){
  const prepare=f.db.prepare.bind(f.db),calls=[];
  f.db.prepare=query=>{
    const statement=prepare(query);
    if(query.startsWith('SELECT 0 AS guard_index,CASE WHEN (')){
      const all=statement.all;
      statement.all=async function(){
        const result=await all.call(this);
        calls.push({sql:query,bindings:[...this.bindings],rows:result.results});
        return transform?transform(result):result;
      };
    }
    return statement;
  };
  return calls;
}
for(const kind of ['1B','2A']){
  test(kind+' strict loading reads every guard in one bounded UNION without changing returned transaction guards',async t=>{
    const {f,signal}=await fixture(t,kind),before=await loadAppendBase(f.db,f.asset(),signal),calls=intercept(f);
    const base=await loadAppendBase(f.db,f.asset(),signal);
    assert.ok(base);assert.equal(calls.length,1);
    const guards=kind==='1B'?base.limestone1bSourceGuards:base.limestone2aSourceGuards;
    const prior=kind==='1B'?before.limestone1bSourceGuards:before.limestone2aSourceGuards;
    assert.deepEqual(guards,prior,'the same conditions are still returned for individual transaction guards');
    assert.equal(calls[0].rows.length,guards.length-1,'the event-set CAS is attached for the later transaction');
    assert.equal((calls[0].sql.match(/ AS guard_index,CASE WHEN /g)||[]).length,calls[0].rows.length);
    assert.equal((calls[0].sql.match(/ UNION ALL SELECT [0-9]+ AS guard_index/g)||[]).length,calls[0].rows.length-1);
    assert.ok(Buffer.byteLength(calls[0].sql)<100000);assert.ok(calls[0].bindings.length<=100);
  });
  test(kind+' guard result indices can arrive in any order without dropping a condition',async t=>{
    const {f,signal}=await fixture(t,kind),calls=intercept(f,result=>({...result,results:[...result.results].reverse()}));
    assert.ok(await loadAppendBase(f.db,f.asset(),signal));assert.equal(calls.length,1);
  });
  const invalid=[
    ['missing row',result=>({...result,results:result.results.slice(1)})],
    ['extra row',result=>({...result,results:[...result.results,result.results[0]]})],
    ['duplicate index',result=>({...result,results:result.results.map((row,index)=>index===1?{...row,guard_index:0}:row)})],
    ['out of range index',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,guard_index:result.results.length}:row)})],
    ['string index',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,guard_index:'0'}:row)})],
    ['noninteger index',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,guard_index:0.5}:row)})],
    ['false condition',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,valid:0}:row)})],
    ['boolean condition',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,valid:true}:row)})],
    ['provider failure',result=>({...result,success:false})],
    ['malformed rows',result=>({...result,results:null})]
  ];
  for(const [label,transform]of invalid)test(kind+' malformed guard read with '+label+' fails closed',async t=>{
    const {f,signal}=await fixture(t,kind),calls=intercept(f,transform);
    assert.equal(await loadAppendBase(f.db,f.asset(),signal),null);assert.equal(calls.length,1);
  });
}
