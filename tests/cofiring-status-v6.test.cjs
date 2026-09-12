'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPeriod}=require('../maintenance/cofiring-live.js');
const contract=require('../maintenance/cofiring-live-contract.js');
const {liveRequestPresentation}=require('../maintenance/cofiring-period-ui-v5.js');
const spec={startLocal:'2026-09-10T00:00',endLocal:'2026-09-10T12:00',stepUnit:'hour',stepValue:1};
const id='11111111-1111-4111-8111-111111111111';
function harness(){
  let status='pending',release=null,calls=0;
  const changes=[],timers=new Map();let timerId=0;
  const live=createPeriod({getHeaders:()=>({Authorization:'Bearer synthetic-test'}),canQuery:()=>true,
    setTimeout:(fn,ms)=>{const n=++timerId;timers.set(n,{fn,ms});return n;},clearTimeout:n=>timers.delete(n),
    onChange:s=>changes.push({active:s.item?.active?.status||null,...liveRequestPresentation(s)}),
    fetch:async(url,options)=>{
      assert.equal(options.method,undefined,'Polling must never register or restart a query');calls++;
      if(release)await new Promise(resolve=>{release=resolve;});
      const item={id,requestType:'cofiring_period',status,errorMessage:status==='failed'?'Exact Agent failure':''};
      return {ok:true,json:async()=>({ok:true,bridgeVersion:2,periodKey:contract.periodKey(spec),saved:null,result:null,active:status==='failed'?null:item,lastAttempt:item})};
    }});
  live.select(spec);
  return {live,changes,timers,getCalls:()=>calls,status:s=>{status=s;},hold:()=>{release=()=>{};},release:()=>{const resolve=release;release=null;resolve();}};
}
test('pending and processing background polls retain one stable label and keep the busy lock',async()=>{
  const h=harness();await h.live.load();
  for(const status of ['pending','processing']){
    h.status(status);h.hold();const loading=h.live.load();
    assert.equal(h.changes.at(-1).buttonText,'상태 확인');assert.equal(h.changes.at(-1).busy,true);
    h.release();assert.equal(await loading,true);
    assert.equal(h.changes.at(-1).buttonText,'상태 확인');assert.equal(h.changes.at(-1).busy,false);
  }
  assert.equal(h.getCalls(),3);h.live.dispose();
});
test('processing to failed exposes the Agent message and stops automatic status polling',async()=>{
  const h=harness();h.status('processing');await h.live.load();h.status('failed');await h.live.load();
  assert.equal(h.live.state().item.active,null);assert.equal(h.changes.at(-1).failureMessage,'Exact Agent failure');
  assert.equal(h.changes.at(-1).buttonText,'계산하기');assert.equal(h.changes.at(-1).busy,false);
  assert.equal(h.timers.size,0);assert.equal(h.getCalls(),2);h.live.dispose();
});
test('an older failure does not override a currently active request or a completed last attempt',()=>{
  const state={authenticated:true,item:{lastAttempt:{status:'failed',errorMessage:'old failure'}}};
  assert.equal(liveRequestPresentation(state).failureMessage,'old failure');
  state.item.active={status:'pending'};assert.equal(liveRequestPresentation(state).failureMessage,'');
  state.item.active=null;state.item.lastAttempt={status:'complete'};assert.equal(liveRequestPresentation(state).failureMessage,'');
});
test('initial loading, submission, conflict and expired sessions remain distinct and locked',()=>{
  const state={authenticated:true,item:{loading:true}};
  assert.equal(liveRequestPresentation(state).buttonText,'상태 확인 중...');assert.equal(liveRequestPresentation(state).busy,true);
  state.item.submitting=true;assert.equal(liveRequestPresentation(state).buttonText,'요청 등록 중...');
  assert.equal(liveRequestPresentation(state,{conflictRetrying:true}).buttonText,'이전 조회 대기...');
  state.authenticated=false;assert.equal(liveRequestPresentation(state).buttonText,'로그인 필요');
  state.item={lastAttempt:{status:'failed',errorMessage:'  '}};assert.equal(liveRequestPresentation(state).failureMessage,'DataPARC 조회에 실패했습니다.');
});
