import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../maintenance/blower-r8-timeline.js',import.meta.url),'utf8');
function fake(){
 const ids=['blowerR8Panel','blowerR8Status','blowerR8Fbhe','blowerR8Limestone','blowerR8Check','blowerR8FbheRows','blowerR8LimestoneRows'];
 const elements=new Map();
 function make(){return {listeners:{},children:[],hidden:true,disabled:false,textContent:'',className:'',
  addEventListener(ev,cb){this.listeners[ev]=cb;},appendChild(item){this.children.push(item);},
  async click(){return this.listeners.click?.()},};}
 for(const id of ids)elements.set(id,make());
 const document={readyState:'complete',getElementById(id){return elements.get(id)||null;},createElement(){return make();}};
 const ss=new Map(),ls=new Map([['gsShiftLog.currentUser',JSON.stringify({employeeNo:'REDACTED',sessionToken:'opaque-token'})]]);
 const requests=[];let number=0;
 const window={document,matchMedia:()=>({matches:false}),localStorage:{getItem:key=>ls.get(key)||null},
  sessionStorage:{getItem:key=>ss.get(key)||null,setItem:(key,val)=>ss.set(key,val)},
  async fetch(url,opt){requests.push({url,...opt});if(url==='/api/blower-history')return {ok:true,json:async()=>({ok:true,permissions:{isSuperAdmin:true},assets:[
   {tagNumber:'104HHL60AP621',lastReplacementAt:'2026-10-08',cycleRuntimeRevision:'rev2',cycleStartRevision:'rev1',cycleStartState:'pending',cycleStartedAt:''},
   {tagNumber:'203HRJ01AN601',lastReplacementAt:'2026-09-20',cycleRuntimeRevision:'revL',cycleStartRevision:'revL1',cycleStartState:'pending',cycleStartedAt:''}]})};
   if(url==='/api/ois-data-requests'&&opt.method==='POST'){number++;return {ok:true,json:async()=>({ok:true,item:{id:`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`}})};}
   return {ok:true,json:async()=>({ok:true,item:null})};
  }
 };
 runInNewContext(code,{window,globalThis:window,Date,JSON,Array,Object,Map,RegExp,String,Number,Math});
 return {window,elements,requests,ss};
}
test('R8 UI stays idle on open, queues only bounded read-only probes on manual click',async()=>{
 const env=fake();assert.equal(env.requests.length,0);
 assert.equal(env.elements.get('blowerR8Panel').hidden,false);
 await env.elements.get('blowerR8Limestone').click();
 const posts=env.requests.filter(r=>r.method==='POST');assert.equal(posts.length,2);
 for(const req of posts){const b=JSON.parse(req.body);
  assert.equal(b.assetTag,'203HRJ01AN601');assert.equal(b.confirmRunSignal,true);
  assert.equal(b.unifiedRefresh,true);assert.equal(b.incrementalRefresh,false);
  assert.equal(b.requireIncrementalAppend,false);assert.match(b.r7EvidenceMode,/^r8_timeline_v1:limestone_day:[01]$/);
  assert.equal(b.expectedCycleRuntimeRevision,'revL');assert.ok(b.startAt.startsWith('2026-09-19'));
  assert.equal(b.action,'create_blower_runtime_probe');
 }
 await env.elements.get('blowerR8Limestone').click();
 assert.equal(env.requests.filter(r=>r.method==='POST').length,2,'repeat should use saved request IDs');
 assert.match(env.elements.get('blowerR8Status').textContent,/요청 접수 완료/);
});
test('R8 FBHE queues only four anchored slices and never updates saved runtime',async()=>{
 const env=fake();await env.elements.get('blowerR8Fbhe').click();
 const posts=env.requests.filter(r=>r.method==='POST').map(r=>JSON.parse(r.body));
 assert.equal(posts.length,4);
 assert.deepEqual(posts.map(x=>x.r7EvidenceMode),[
  'r8_timeline_v1:fbhe_workday:0','r8_timeline_v1:fbhe_workday:1',
  'r8_timeline_v1:fbhe_after:0','r8_timeline_v1:fbhe_after:1']);
 assert.ok(posts.every(x=>x.assetTag==='104HHL60AP621'));
 assert.ok(env.requests.every(r=>!(/api\/blower-history/.test(r.url)&&r.method!=='GET')));
});
