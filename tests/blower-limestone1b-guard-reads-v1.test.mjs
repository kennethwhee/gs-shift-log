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
function intercept(t,f,transform){
  const prepare=f.db.prepare.bind(f.db),calls=[];
  let writeAttempts=0;
  t.after(()=>assert.equal(writeAttempts,0,'proof reads, including failures, must never write'));
  // Strict proof loading must remain read-only, including its error paths.
  f.db.batch=async()=>{writeAttempts++;assert.fail('strict proof loading attempted a database batch')};
  f.db.prepare=query=>{
    const statement=prepare(query);
    statement.run=async()=>{writeAttempts++;assert.fail('strict proof loading attempted a database write')};
    if(/^SELECT [0-9]+ AS guard_index,CASE WHEN \(/.test(query)){
      const all=statement.all;
      statement.all=async function(){
        const call={sql:query,bindings:[...this.bindings]},index=calls.length;
        calls.push(call);
        // workerd's SQLITE_LIMIT_COMPOUND_SELECT is five, unlike SQLite's
        // ordinary 500-term default. The published unbounded query fails here.
        const terms=(query.match(/ AS guard_index,CASE WHEN /g)||[]).length;
        if(terms>5)throw new Error('too many terms in compound SELECT');
        const result=await all.call(this);call.rows=result.results;
        return transform?transform(result,index):result;
      };
    }
    return statement;
  };
  return calls;
}
const guardsOf=(kind,base)=>kind==='1B'?base.limestone1bSourceGuards:base.limestone2aSourceGuards;
for(const kind of ['1B','2A']){
  test(kind+' strict loading obeys the five-term compound limit and retains every transaction predicate',async t=>{
    const {f,signal}=await fixture(t,kind),before=await loadAppendBase(f.db,f.asset(),signal),calls=intercept(t,f);
    const base=await loadAppendBase(f.db,f.asset(),signal);
    assert.ok(base,'all read groups must pass the workerd compound limit');
    const guards=guardsOf(kind,base),prior=guardsOf(kind,before),readGuards=guards.slice(0,-1);
    assert.deepEqual(guards,prior,'the same complete conditions remain individual transaction guards');
    assert.ok(readGuards.length>5,'the fixture exercises the production regression boundary');
    assert.equal(calls.length,Math.ceil(readGuards.length/5));
    assert.equal(calls.flatMap(call=>call.rows).length,readGuards.length,'the event-set CAS remains attached for the later transaction');
    assert.deepEqual(calls.flatMap(call=>call.rows.map(row=>row.guard_index)),readGuards.map((_,index)=>index));
    for(const [groupIndex,call]of calls.entries()){
      const offset=groupIndex*5,group=readGuards.slice(offset,offset+5);
      assert.equal(call.sql,group.map((guard,index)=>`SELECT ${offset+index} AS guard_index,CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS valid`).join(' UNION ALL '));
      assert.deepEqual(call.bindings,group.flatMap(guard=>guard.values));
      assert.ok(call.rows.length>=1&&call.rows.length<=5);
      assert.ok(Buffer.byteLength(call.sql)<100000);assert.ok(call.bindings.length<=100);
    }
  });
  test(kind+' guard result indices may arrive in any order within each group',async t=>{
    const {f,signal}=await fixture(t,kind),calls=intercept(t,f,result=>({...result,results:[...result.results].reverse()}));
    const base=await loadAppendBase(f.db,f.asset(),signal);assert.ok(base);
    assert.equal(calls.length,Math.ceil((guardsOf(kind,base).length-1)/5));
  });
  const invalid=[
    ['missing row',result=>({...result,results:result.results.slice(1)})],
    ['extra row',result=>({...result,results:[...result.results,result.results[0]]})],
    ['duplicate index',result=>({...result,results:result.results.map((row,index)=>index===1?{...row,guard_index:result.results[0].guard_index}:row)})],
    ['out of group index',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,guard_index:result.results[0].guard_index+result.results.length}:row)})],
    ['string index',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,guard_index:String(row.guard_index)}:row)})],
    ['noninteger index',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,guard_index:row.guard_index+0.5}:row)})],
    ['false condition',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,valid:0}:row)})],
    ['boolean condition',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,valid:true}:row)})],
    ['provider failure',result=>({...result,success:false})],
    ['malformed rows',result=>({...result,results:null})]
  ];
  for(const [label,transform]of invalid)test(kind+' malformed first guard group with '+label+' fails closed',async t=>{
    const {f,signal}=await fixture(t,kind),calls=intercept(t,f,transform);
    assert.equal(await loadAppendBase(f.db,f.asset(),signal),null);assert.equal(calls.length,1);
  });
  const laterInvalid=[
    ['false condition',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,valid:0}:row)})],
    ['missing row',result=>({...result,results:result.results.slice(1)})],
    ['previous group index',result=>({...result,results:result.results.map((row,index)=>index===0?{...row,guard_index:0}:row)})],
    ['malformed row',result=>({...result,results:result.results.map((row,index)=>index===0?null:row)})],
    ['provider failure',result=>({...result,success:false})]
  ];
  for(const position of ['second','final'])for(const [label,transform]of laterInvalid)
    test(kind+' '+position+' guard group with '+label+' cannot pass on earlier successful groups',async t=>{
      const {f,signal}=await fixture(t,kind),before=await loadAppendBase(f.db,f.asset(),signal);
      const expectedGroups=Math.ceil((guardsOf(kind,before).length-1)/5),target=position==='second'?1:expectedGroups-1;
      assert.ok(target>=1);
      const calls=intercept(t,f,(result,index)=>index===target?transform(result):result);
      assert.equal(await loadAppendBase(f.db,f.asset(),signal),null);assert.equal(calls.length,target+1);
      assert.ok(calls.slice(0,target).every(call=>call.rows.every(row=>row.valid===1)));
    });
  test(kind+' a later group query exception cannot accept the earlier valid groups',async t=>{
    const {f,signal}=await fixture(t,kind),calls=intercept(t,f,(result,index)=>{if(index===1)throw new Error('provider query failure');return result});
    assert.equal(await loadAppendBase(f.db,f.asset(),signal),null);assert.equal(calls.length,2);
  });
}
