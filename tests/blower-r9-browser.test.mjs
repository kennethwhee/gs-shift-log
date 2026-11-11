import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../maintenance/blower-r9-signal-v1.js',import.meta.url),'utf8');
const tag='203HRJ01AN601';
function fake(){
 const names=['blowerR9Panel','blowerR9Status','blowerR9Result','blowerR9Start','blowerR9Check','blowerR9Date','blowerR9Asset'];
 const elements=new Map(),req=[],storage=new Map(),statuses=new Map(),hooks={};let nextId=45,historyReads=0;
 function make(){return {listeners:{},children:[],hidden:true,disabled:false,textContent:'',value:'',max:'',className:'',
  addEventListener(type,fn){this.listeners[type]=fn;},appendChild(item){this.children.push(item);},async click(){return this.listeners.click?.();}};}
 for(const id of names)elements.set(id,make());
 const document={readyState:'loading',onload:null,addEventListener(type,fn){if(type==='DOMContentLoaded')this.onload=fn;},
  getElementById(id){return elements.get(id)||null;},createElement(){return make();}};
 const user={employeeNo:'REDACTED',sessionToken:'opaque'};
 const asset={tagNumber:tag,displayName:'Limestone 2A',sortOrder:1,
  dataParcTag:'GSPOGE.ABB_DCS.203HRJ01AN601XB04',lastReplacementAt:'2026-09-20T00:00:00+09:00',
  cycleRuntimeRevision:'rev1',cycleStartRevision:'sr1',cycleStartState:'legacy',cycleStoredStartedAt:'',cycleStartedAt:''};
 const window={document,matchMedia:()=>({matches:false}),localStorage:{getItem:()=>JSON.stringify(user)},
  sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(k,v)=>storage.set(k,v),removeItem:key=>storage.delete(key)},
  fetch:async(url,opt)=>{req.push({url,...opt});if(url==='/api/blower-history'){
   const payload={ok:true,permissions:{isSuperAdmin:true},assets:[{...asset}]};
   historyReads++;await hooks.history?.(historyReads,payload);
   return {ok:true,json:async()=>payload};}
  if(url==='/api/ois-data-requests'&&opt.method==='POST'){
   const override=await hooks.post?.(JSON.parse(opt.body));if(override)return override;
   const id='00000000-0000-4000-8000-'+String(nextId++).padStart(12,'0');
   statuses.set(id,'pending');return {ok:true,json:async()=>({ok:true,item:{id}})};
  }
  const id=new URL(url,'https://unit.test').searchParams.get('id');
  return {ok:true,json:async()=>({ok:true,item:{id,status:statuses.get(id)||'pending',errorMessage:'R9 DataPARC RUN 상세구간이 누락됐습니다.'}})};}};
 runInNewContext(code,{window,globalThis:window,Intl,Date,JSON,Math,RegExp,Number,String,Object,Array});
 return {document,elements,req,window,statuses,storage,hooks,user,asset};
}
test('R9 browser opens read-only, no Agent work until click and exactly one manual request',async()=>{
 const app=fake();await app.document.onload();
 assert.equal(app.elements.get('blowerR9Panel').hidden,false);
 assert.equal(app.req.filter(r=>r.method==='POST').length,0);
 app.elements.get('blowerR9Asset').value=tag;
 app.elements.get('blowerR9Date').value='2026-09-19';
 await app.elements.get('blowerR9Start').click();
 const post=app.req.filter(r=>r.method==='POST');assert.equal(post.length,1);
 const body=JSON.parse(post[0].body);
 assert.equal(body.r7EvidenceMode,'r9_signal_v1:203HRJ01AN601:20260919');
 assert.equal(body.assetTag,tag);assert.equal(body.dataParcTag,'GSPOGE.ABB_DCS.203HRJ01AN601XB04');
 assert.equal(body.action,'create_blower_runtime_probe');assert.equal(body.unifiedRefresh,true);
 assert.equal(body.incrementalRefresh,false);assert.equal(body.requireIncrementalAppend,false);
 assert.equal(body.expectedCycleRuntimeRevision,'rev1');
 assert.equal(body.expectedLastReplacementAt,'2026-09-20T00:00:00+09:00');
 assert.ok(!app.req.some(r=>/api\/blower-history/.test(r.url)&&r.method!=='GET'));
 await app.elements.get('blowerR9Start').click();
 assert.equal(app.req.filter(r=>r.method==='POST').length,1,'persisted request should not duplicate');
 assert.match(app.elements.get('blowerR9Status').textContent,/기존 R9 요청/);
});
test('R9 browser refuses invalid current-day manual request rather than issuing a probe',async()=>{
 const app=fake();await app.document.onload();app.elements.get('blowerR9Asset').value=tag;
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 app.elements.get('blowerR9Date').value=today;
 await app.elements.get('blowerR9Start').click();
 assert.equal(app.req.filter(r=>r.method==='POST').length,0);
 assert.match(app.elements.get('blowerR9Status').textContent,/조회 요청 중단/);
});

test('R9 failure never retries automatically; result check clears only confirmed failed ID',async()=>{
 const app=fake();await app.document.onload();
 app.elements.get('blowerR9Asset').value=tag;app.elements.get('blowerR9Date').value='2026-09-19';
 await app.elements.get('blowerR9Start').click();const [first]=[...app.statuses.keys()];
 app.statuses.set(first,'failed');
 await app.elements.get('blowerR9Check').click();
 assert.equal(app.req.filter(r=>r.method==='POST').length,1,'a failed result must not auto-query');
 assert.match(app.elements.get('blowerR9Status').textContent,/수동 재시도 가능/);
 assert.equal(app.storage.size,0,'only confirmed failed ID is removed');
 await app.elements.get('blowerR9Start').click();
 assert.equal(app.req.filter(r=>r.method==='POST').length,2,'new deliberate click retries');
 assert.equal(app.storage.size,1);
});
test('R9 explicit retry verifies stale failed ID even when no result-check was pressed',async()=>{
 const app=fake();await app.document.onload();
 app.elements.get('blowerR9Asset').value=tag;app.elements.get('blowerR9Date').value='2026-09-19';
 await app.elements.get('blowerR9Start').click();
 const [first]=[...app.statuses.keys()];app.statuses.set(first,'failed');
 await app.elements.get('blowerR9Start').click();
 assert.equal(app.req.filter(r=>r.method==='POST').length,2);
 assert.ok(![...app.storage.values()].includes(first));
});
test('R9 explicit click does not requery completed existing request ID',async()=>{
 const app=fake();await app.document.onload();
 app.elements.get('blowerR9Asset').value=tag;app.elements.get('blowerR9Date').value='2026-09-19';
 await app.elements.get('blowerR9Start').click();
 const [first]=[...app.statuses.keys()];app.statuses.set(first,'complete');
 await app.elements.get('blowerR9Start').click();
 assert.equal(app.req.filter(r=>r.method==='POST').length,1);
 assert.equal(app.storage.size,1);
});

async function ready(){const app=fake();await app.document.onload();
 app.elements.get('blowerR9Asset').value=tag;app.elements.get('blowerR9Date').value='2026-09-19';return app;}
const posts=app=>app.req.filter(r=>r.method==='POST');
const historyReads=app=>app.req.filter(r=>r.url==='/api/blower-history');
test('R9 new request reads current snapshot once and uses all five fresh stored fields',async()=>{
 const app=await ready();
 app.hooks.history=(count,payload)=>{assert.equal(count,2);Object.assign(payload.assets[0],{
  lastReplacementAt:'2026-09-19T10:00:00+09:00',cycleStartState:'pending',cycleStoredStartedAt:'',
  cycleStartedAt:'2026-09-19T10:00:00+09:00',cycleStartRevision:'sr2',cycleRuntimeRevision:'rev2'});};
 await app.elements.get('blowerR9Start').click();
 assert.equal(historyReads(app).length,2,'one init read and one explicit creation read');
 assert.equal(posts(app).length,1);const body=JSON.parse(posts(app)[0].body);
 assert.equal(body.expectedLastReplacementAt,'2026-09-19T10:00:00+09:00');
 assert.equal(body.expectedCycleStartState,'pending');assert.equal(body.expectedCycleStartedAt,'');
 assert.equal(body.expectedCycleStartRevision,'sr2');assert.equal(body.expectedCycleRuntimeRevision,'rev2');
 assert.equal(body.startAt,'2026-09-19T00:00:00+09:00');
 assert.equal(body.incrementalRefresh,false);assert.equal(body.requireIncrementalAppend,false);
});
test('R9 fresh current asset, signal and revision failures never create an Agent request',async()=>{
 for(const mutate of [p=>{p.assets=[];},p=>{p.assets.push({...p.assets[0]});},
  p=>{p.assets[0].tagNumber='103HRJ01AN602';},p=>{p.assets[0].dataParcTag='GSPOGE.ABB_DCS.WRONG';},
  p=>{p.assets[0].cycleRuntimeRevision='';},p=>{p.assets[0].cycleStartRevision='';},
  p=>{p.assets[0].cycleStoredStartedAt=42;},p=>{p.assets[0].enabled=false;}]){
  const app=await ready();app.hooks.history=(_count,payload)=>mutate(payload);
  await app.elements.get('blowerR9Start').click();assert.equal(posts(app).length,0);
  assert.match(app.elements.get('blowerR9Status').textContent,/조회 요청 중단/);
 }
});
test('R9 revoked current administrator permission never creates an Agent request',async()=>{
 const app=await ready();app.hooks.history=(_count,payload)=>{payload.permissions.isSuperAdmin=false;};
 await app.elements.get('blowerR9Start').click();assert.equal(posts(app).length,0);
 assert.match(app.elements.get('blowerR9Status').textContent,/현재 최고관리자 권한/);
});
test('R9 login token or actor changing during the fresh read stops before POST',async()=>{
 for(const field of ['sessionToken','employeeNo']){
  const app=await ready();app.hooks.history=()=>{app.user[field]='changed';};
  await app.elements.get('blowerR9Start').click();assert.equal(posts(app).length,0);
  assert.match(app.elements.get('blowerR9Status').textContent,/로그인 상태가 변경/);
 }
});
test('R9 preserved pending, processing and complete IDs resume by GET without fresh creation read',async()=>{
 for(const status of ['pending','processing','complete']){
  const app=await ready();await app.elements.get('blowerR9Start').click();
  const [id]=[...app.statuses.keys()];app.statuses.set(id,status);
  const before=app.req.length;await app.elements.get('blowerR9Start').click();
  const later=app.req.slice(before);assert.equal(later.length,1);
  assert.equal(later[0].method,'GET');assert.match(later[0].url,/\/api\/ois-data-requests\?id=/);
  assert.equal(historyReads(app).length,2);assert.equal(posts(app).length,1);
  assert.equal([...app.storage.values()][0],id);
 }
});
test('R9 failed current snapshot read stops without POST and without automatic repeat',async()=>{
 const app=await ready();app.hooks.history=()=>{throw Error('current read unavailable');};
 await app.elements.get('blowerR9Start').click();assert.equal(historyReads(app).length,2);
 assert.equal(posts(app).length,0);assert.match(app.elements.get('blowerR9Status').textContent,/current read unavailable/);
});
test('R9 server 409 after a fresh read remains visible and never retries or relaxes request flags',async()=>{
 const app=await ready();app.hooks.history=(_count,payload)=>{payload.assets[0].cycleRuntimeRevision='rev2';};
 app.hooks.post=body=>{assert.equal(body.expectedCycleRuntimeRevision,'rev2');
  assert.equal(body.unifiedRefresh,true);assert.equal(body.incrementalRefresh,false);
  assert.equal(body.requireIncrementalAppend,false);return {ok:false,status:409,json:async()=>({ok:false,
   code:'R7_REQUEST_CONFLICT',message:'R7 검증 요청이 현재 저장된 설비 기준과 일치하지 않습니다.'})};};
 await app.elements.get('blowerR9Start').click();assert.equal(historyReads(app).length,2);
 assert.equal(posts(app).length,1);assert.equal(app.storage.size,0);
 assert.match(app.elements.get('blowerR9Status').textContent,/현재 저장된 설비 기준과 일치하지 않습니다/);
});
test('R9 session change while resolving a failed previous ID never starts a new request',async()=>{
 const app=await ready();await app.elements.get('blowerR9Start').click();
 const [id]=[...app.statuses.keys()];app.statuses.set(id,'failed');
 const originalFetch=app.window.fetch;app.window.fetch=async(url,options)=>{
  const response=await originalFetch(url,options);if(url.startsWith('/api/ois-data-requests?id='))app.user.sessionToken='changed';return response;};
 await app.elements.get('blowerR9Start').click();assert.equal(posts(app).length,1);
 assert.equal(historyReads(app).length,2);assert.equal([...app.storage.values()][0],id);
 assert.match(app.elements.get('blowerR9Status').textContent,/로그인 상태가 변경/);
});
