import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../maintenance/blower-r9-signal-v1.js',import.meta.url),'utf8');
const tag='203HRJ01AN601';
function fake(){
 const names=['blowerR9Panel','blowerR9Status','blowerR9Result','blowerR9Start','blowerR9Check','blowerR9Date','blowerR9Asset'];
 const elements=new Map(),req=[],storage=new Map();
 function make(){return {listeners:{},children:[],hidden:true,disabled:false,textContent:'',value:'',max:'',className:'',
  addEventListener(type,fn){this.listeners[type]=fn;},appendChild(item){this.children.push(item);},async click(){return this.listeners.click?.();}};}
 for(const id of names)elements.set(id,make());
 const document={readyState:'loading',onload:null,addEventListener(type,fn){if(type==='DOMContentLoaded')this.onload=fn;},
  getElementById(id){return elements.get(id)||null;},createElement(){return make();}};
 const user={employeeNo:'REDACTED',sessionToken:'opaque'};
 const window={document,matchMedia:()=>({matches:false}),localStorage:{getItem:()=>JSON.stringify(user)},
  sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(k,v)=>storage.set(k,v)},
  fetch:async(url,opt)=>{req.push({url,...opt});if(url==='/api/blower-history')return {ok:true,json:async()=>({ok:true,
    permissions:{isSuperAdmin:true},assets:[{tagNumber:tag,displayName:'Limestone 2A',sortOrder:1,
    dataParcTag:'GSPOGE.ABB_DCS.203HRJ01AN601XB04',lastReplacementAt:'2026-09-20T00:00:00+09:00',cycleRuntimeRevision:'rev1',cycleStartRevision:'sr1',cycleStartState:'legacy',cycleStartedAt:''}]})};
  if(url==='/api/ois-data-requests'&&opt.method==='POST')return {ok:true,json:async()=>({ok:true,item:{id:'00000000-0000-4000-8000-000000000045'}})};
  return {ok:true,json:async()=>({ok:true,item:{id:'00000000-0000-4000-8000-000000000045',status:'pending'}})};}};
 runInNewContext(code,{window,globalThis:window,Intl,Date,JSON,Math,RegExp,Number,String,Object,Array});
 return {document,elements,req,window};
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
