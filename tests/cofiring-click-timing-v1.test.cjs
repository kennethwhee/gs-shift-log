'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../maintenance/cofiring-click-timing-v1.js');
const PERIOD={startLocal:'2026-09-15T00:00',endLocal:'2026-09-15T22:11',stepUnit:'hour',stepValue:1};
function fixture(extra={}){
  let monotonic=100,wall='2026-09-15T13:00:00.000Z',next=0;
  const timers=new Map(),frames=new Map(),changes=[];
  const options={now:()=>monotonic,utcNow:()=>wall,onChange:s=>changes.push(s),setTimeout:(f,ms)=>{const id=++next;timers.set(id,{f,ms});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:f=>{const id=++next;frames.set(id,f);return id;},cancelAnimationFrame:id=>frames.delete(id),...extra};
  const timing=create(options);
  return {timing,changes,timers,frames,advance:ms=>{monotonic+=ms;},wall:v=>{wall=v;},frame(){const entry=frames.entries().next().value;assert.ok(entry,'a frame is scheduled');frames.delete(entry[0]);entry[1]();},tick(){const entry=[...timers].find(([,v])=>v.ms===200);assert.ok(entry,'a timer is scheduled');timers.delete(entry[0]);entry[1].f();}};
}
test('elapsed uses monotonic time while wall clock changes, then stops after two frames',()=>{
  const f=fixture(),t=f.timing.start({mode:'saved_recalculate',period:PERIOD});
  f.advance(50);f.wall('2020-01-01T00:00:00.000Z');f.tick();assert.equal(f.timing.state().elapsedMs,50);
  assert.equal(f.timing.finish(t,{requestId:'saved',source:'saved_recalculate',querySeconds:6.374}),true);
  f.advance(16);f.frame();assert.equal(f.timing.state().status,'finishing');
  f.advance(16);f.frame();const s=f.timing.state();assert.equal(s.status,'complete');assert.equal(s.elapsedMs,82);assert.equal(s.querySeconds,6.374);assert.equal(s.startedAt,'2026-09-15T13:00:00.000Z');assert.equal(s.finishedAt,'2020-01-01T00:00:00.000Z');assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
test('pending and exact request identity prevent old or mismatched result completion',()=>{
  const f=fixture(),t=f.timing.start({mode:'new_query',period:PERIOD,previousRequestId:'old'});
  assert.equal(f.timing.finish(t,{requestId:'old'}),false);
  assert.equal(f.timing.acceptRequest(t,'new'),true);assert.equal(f.timing.acceptRequest(t,'other'),false);
  assert.equal(f.timing.finish(t,{requestId:'old'}),false);assert.equal(f.timing.finish(t,{requestId:'other'}),false);
  assert.equal(f.timing.finish(t,{requestId:'new',source:'new_query'}),true);f.frame();f.frame();assert.equal(f.timing.state().requestId,'new');assert.equal(f.timing.state().status,'complete');assert.equal(f.timers.size,0);
});
test('forced refresh cannot complete with previous saved ID even if accepted as expected',()=>{
  const f=fixture(),t=f.timing.start({mode:'forced_requery',previousRequestId:'old'});
  assert.equal(f.timing.acceptRequest(t,'old'),true);assert.equal(f.timing.finish(t,{requestId:'old'}),false);
  assert.equal(f.timing.requireRequest(t),true);assert.equal(f.timing.state().expectedRequestId,null);assert.equal(f.timing.finish(t,{requestId:'new'}),false);
  assert.equal(f.timing.acceptRequest(t,'new'),true);assert.equal(f.timing.finish(t,{requestId:'new'}),true);f.frame();f.frame();assert.equal(f.timing.state().status,'complete');
});
test('resumed active request completes only with its accepted ID',()=>{
  const f=fixture(),t=f.timing.start({mode:'resume_existing',activeRequestId:'active',previousRequestId:'old'});
  assert.equal(f.timing.state().pendingRequest,false);assert.equal(f.timing.finish(t,{requestId:'old'}),false);assert.equal(f.timing.finish(t,{requestId:'active'}),true);f.frame();f.frame();assert.equal(f.timing.state().requestId,'active');
});
test('new sessions reject old token, queued frames and timer callbacks',()=>{
  const f=fixture(),old=f.timing.start({mode:'saved_recalculate'}),staleTick=[...f.timers.values()][0].f;
  f.timing.finish(old,{requestId:'old'});const staleFrame=[...f.frames.values()][0];
  const fresh=f.timing.start({mode:'new_query'});const before=f.timing.state();
  staleTick();staleFrame();assert.deepEqual(f.timing.state(),before);assert.equal(f.frames.size,0);
  assert.equal(f.timing.phase(old,'bad'),false);assert.equal(f.timing.acceptRequest(old,'old'),false);assert.equal(f.timing.fail(old,'bad'),false);assert.equal(f.timing.finish(old,{requestId:'old'}),false);
  assert.equal(f.timing.phase(fresh,'Agent 대기'),true);assert.equal(f.timing.state().phase,'Agent 대기');f.timing.dispose();assert.equal(f.timers.size,0);
});
test('cancel and fail preserve elapsed but cannot report success from queued frames',()=>{
  const f=fixture(),t=f.timing.start({mode:'saved_recalculate'});f.advance(123);f.timing.finish(t,{requestId:'saved'});const stale=[...f.frames.values()][0];
  assert.equal(f.timing.cancel('hidden'),true);stale();assert.equal(f.timing.state().status,'cancelled');assert.equal(f.timing.state().elapsedMs,123);assert.equal(f.timing.state().reason,'hidden');assert.equal(f.timers.size,0);
  const failed=f.timing.start({mode:'new_query'});f.advance(321);assert.equal(f.timing.fail(failed,'server_failed'),true);assert.equal(f.timing.state().status,'failed');assert.equal(f.timing.state().elapsedMs,321);assert.equal(f.timing.finish(failed,{requestId:'new'}),false);assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);
});
test('current context cancels when auth, period or visibility changes',()=>{
  let valid=true;const f=fixture({isCurrent:()=>valid}),t=f.timing.start({mode:'new_query'});f.timing.acceptRequest(t,'new');f.advance(200);valid=false;f.tick();assert.equal(f.timing.state().status,'cancelled');assert.equal(f.timing.state().reason,'context_changed');assert.equal(f.timing.finish(t,{requestId:'new'}),false);assert.equal(f.timers.size,0);
});
test('result guard is checked before scheduling and again after two frames',()=>{
  let valid=false;const f=fixture(),t=f.timing.start({mode:'saved_recalculate'}),guard=()=>valid;
  assert.equal(f.timing.finish(t,{requestId:'saved'},guard),false);assert.equal(f.frames.size,0);
  valid=true;assert.equal(f.timing.finish(t,{requestId:'saved'},guard),true);f.frame();valid=false;f.frame();assert.equal(f.timing.state().status,'cancelled');assert.equal(f.timers.size,0);
});
test('state is a filtered snapshot and dispose rejects future work',()=>{
  const f=fixture(),t=f.timing.start({mode:'saved_recalculate',period:{...PERIOD,authorization:'do not expose'}}),s=f.timing.state();assert.deepEqual(s.period,PERIOD);assert.equal('token' in s,false);s.period.startLocal='changed';assert.equal(f.timing.state().period.startLocal,PERIOD.startLocal);f.timing.dispose();assert.equal(f.timing.start({}),null);assert.equal(f.timing.phase(t,'late'),false);assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);
});
test('zero-delay timer fallback also needs two scheduled opportunities',()=>{
  const f=fixture({requestAnimationFrame:null,cancelAnimationFrame:null}),t=f.timing.start({mode:'saved_recalculate'});assert.equal(f.timing.finish(t,{requestId:'saved'}),true);
  for(let n=0;n<2;n++){const entry=[...f.timers].find(([,v])=>v.ms===0);assert.ok(entry);f.timers.delete(entry[0]);entry[1].f();if(n===0)assert.equal(f.timing.state().status,'finishing');}
  assert.equal(f.timing.state().status,'complete');assert.equal(f.timers.size,0);
});

test('phase1 stage timings separate monotonic browser observations and same-server queue time',()=>{
  const f=fixture(),t=f.timing.start({mode:'new_query'});
  f.advance(1000);f.timing.acceptRequest(t,'new');f.timing.mark(t,'request_accepted','new');
  f.advance(2000);f.timing.mark(t,'processing_seen','new');
  f.advance(47000);f.timing.mark(t,'complete_seen','new');
  f.advance(1000);f.timing.mark(t,'result_received','new');
  assert.equal(f.timing.mark(t,'result_received','foreign'),false);
  f.timing.finish(t,{requestId:'new',source:'new_query',controllerSeconds:40,querySeconds:12,saved:{requestedAt:'2026-10-04T22:07:00Z',startedAt:'2026-10-04T22:07:03Z'},reportTiming:{agent:{workerStages:{preparationSeconds:20,cleanupSeconds:5},progressDrainSeconds:0.2},worker:{workerPhases:[{name:'setupComAttach',outcome:'complete',elapsedSeconds:10},{name:'cleanupCloseQuit',outcome:'complete',elapsedSeconds:3}]}}});
  f.advance(20);f.frame();f.advance(20);f.frame();
  const s=f.timing.state(),row=label=>s.details.find(x=>x.label===label)?.seconds;
  assert.equal(row('서버 접수 → Agent 배정'),3);assert.equal(row('클릭 → 요청 확인'),1);assert.equal(row('결과 수신 → 화면 반영'),0.04);assert.equal(row('Excel 준비'),20);assert.equal(row('  Excel 연결 (준비에 포함)'),10);
  assert.ok(Math.abs(row('PC 실행 전후·통신·화면 처리 (잔여)')-11.04)<1e-8);
  s.marks.request_accepted=999;s.details[0].seconds=999;assert.equal(f.timing.state().marks.request_accepted,1000);assert.equal(f.timing.state().details[0].seconds,1);
});

test('phase1 missing timing is omitted and saved recalculation cannot show historical backend durations',()=>{
  const f=fixture(),t=f.timing.start({mode:'saved_recalculate'});f.timing.finish(t,{requestId:'old',source:'saved_recalculate',querySeconds:99,reportTiming:{agent:{workerStages:{preparationSeconds:20}}}});f.frame();f.frame();assert.deepEqual(f.timing.state().details,[]);
  const n=f.timing.start({mode:'new_query'});f.timing.acceptRequest(n,'new');f.timing.finish(n,{requestId:'new',source:'new_query',querySeconds:NaN,controllerSeconds:Infinity,saved:{requestedAt:'2026-10-05',startedAt:'2026-10-01'},reportTiming:{agent:{workerStages:{preparationSeconds:-1}}}});f.frame();f.frame();assert.deepEqual(f.timing.state().details,[]);
});
