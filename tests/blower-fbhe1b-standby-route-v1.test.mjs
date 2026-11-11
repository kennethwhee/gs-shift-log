import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/blower-history.js';

function context(role,token='fixture-session',expired=false){
  const queries=[];
  const db={prepare(query){
    assert.match(query.trim(),/^SELECT\b/i,'status must not update sessions, schema, queue, certificates or counters');
    queries.push(query);
    return {bind(){return this;},async first(){
      if(/FROM shift_log_sessions/.test(query))return {employee_no:'fixture-reviewer',name:'Fixture',role,
        is_active:1,expires_at:expired?'2000-01-01T00:00:00Z':new Date(Date.now()+3600000).toISOString(),
        last_used_at:'2000-01-01T00:00:00Z'};
      return null;
    },async all(){return {results:[]};}};
  },batch(){assert.fail('a status read must never mutate');}};
  return {queries,env:{DB:db},request:new Request(
    'https://fixture.test/api/blower-history?action=fbhe1b_standby_status',
    {headers:token?{Authorization:'Bearer '+token}:{}})};
}

test('FBHE 1B standby preview uses read-only authentication and does not bootstrap missing schema',async()=>{
  const ctx=context('super_admin'),response=await onRequestGet(ctx),body=await response.json();
  assert.ok(response.status>=400&&response.status<500,JSON.stringify(body));
  assert.ok(ctx.queries.length>=2);
  assert.ok(!body.applied);
});
test('FBHE 1B standby preview requires super admin before reading saved requests or assets',async()=>{
  for(const ctx of [context('admin'),context('user'),context('super_admin',''),context('super_admin','fixture',true)]){
    const response=await onRequestGet(ctx),body=await response.json();
    assert.equal(response.status,403,JSON.stringify(body));
    assert.ok(ctx.queries.length<=1);
    assert.ok(!body.applied);
  }
});
