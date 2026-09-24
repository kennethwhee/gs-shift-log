import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {webcrypto,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const api=await import('data:text/javascript;base64,'+fs.readFileSync(new URL('../functions/api/cofiring-period-manual-usage.js',import.meta.url)).toString('base64'));
const token='period-manual-test',hash=createHash('sha256').update(token).digest('hex');
function db(){const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,is_active INTEGER); CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);');raw.prepare('INSERT INTO users VALUES(?,?,?)').run('tester','시험 사용자',1);raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(hash,'tester','2099-01-01T00:00:00Z','');return {raw,prepare(sql){let p=[];return {bind(...v){p=v;return this;},async first(){return raw.prepare(sql).get(...p)||null;},async run(){raw.prepare(sql).run(...p);return {success:true};}};}};}
let n=0;const period={start:'2026-09-10T00:00',end:'2026-09-10T13:00'};const values=()=>({unit1:{organic:45.89,manure:0},unit2:{organic:45.89,manure:null}});
async function call(DB,{method='GET',start=period.start,end=period.end,body=null,auth=true,headers={}}={}){const url=`https://shift.test/api/cofiring-period-manual-usage?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;const request=new Request(url,{method,headers:{...(auth?{Authorization:'Bearer '+token}:{}),...(method==='POST'?{'Content-Type':'application/json','X-ShiftLog-Client':'desktop'}:{}),...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});const r=await (method==='POST'?api.onRequestPost:api.onRequestGet)({request,env:{DB}});return {status:r.status,data:await r.json()};}
function body(v=values(),revision=0){return {...period,values:v,expectedRevision:revision,requestId:String(++n).padStart(32,'0')};}
test('period manual storage starts blank and never invents zero',async()=>{const DB=db(),r=await call(DB);assert.equal(r.status,200);assert.equal(r.data.revision,0);assert.deepEqual(r.data.values,{unit1:{organic:null,manure:null},unit2:{organic:null,manure:null},receipts:{organic:null,manure:null}});});
test('period manual storage preserves explicit zero, blank and exact period identity',async()=>{const DB=db();let r=await call(DB,{method:'POST',body:body()});assert.equal(r.status,200);assert.equal(r.data.entry.values.unit1.manure,0);assert.equal(r.data.entry.values.unit2.manure,null);r=await call(DB);assert.equal(r.data.values.unit1.organic,45.89);assert.equal(r.data.values.unit2.manure,null);const other=await call(DB,{end:'2026-09-10T12:59'});assert.equal(other.data.revision,0);assert.equal(other.data.values.unit1.organic,null);});
test('revision and idempotency protect period manual values',async()=>{const DB=db(),first=body();assert.equal((await call(DB,{method:'POST',body:first})).status,200);const replay=await call(DB,{method:'POST',body:first});assert.equal(replay.data.replayed,true);const stale=body(values(),0);assert.equal((await call(DB,{method:'POST',body:stale})).status,409);const updated=values();updated.unit2.manure=7.5;const ok=await call(DB,{method:'POST',body:body(updated,1)});assert.equal(ok.status,200);assert.equal(ok.data.entry.revision,2);assert.equal(ok.data.entry.values.unit2.manure,7.5);});
test('period manual API rejects invalid/mobile/unauthenticated writes',async()=>{const DB=db();assert.equal((await call(DB,{auth:false})).status,401);assert.equal((await call(DB,{method:'POST',body:{...body(),end:'2026-10-20T00:00'}})).status,400);assert.equal((await call(DB,{method:'POST',body:body(),headers:{'User-Agent':'iPhone Mobile'}})).status,403);const bad=values();bad.unit1.organic=-1;assert.equal((await call(DB,{method:'POST',body:body(bad)})).status,400);});

test('edited usage and receipts persist with manual mode, including unequal units and zero',async t=>{
  const DB=db();t.after(()=>DB.raw.close());
  const edited={inputMode:'manual',unit1:{organic:20.123456,manure:1.5},unit2:{organic:34,manure:0},receipts:{organic:60.5,manure:0}};
  const first=body(edited),saved=await call(DB,{method:'POST',body:first});
  assert.equal(saved.status,200);assert.deepEqual(saved.data.entry.values,edited);
  assert.deepEqual((await call(DB)).data.values,edited);
  assert.equal((await call(DB,{method:'POST',body:first})).data.replayed,true);
  assert.equal((await call(DB,{method:'POST',body:body({...edited,unit1:{organic:1,manure:0}},0)})).status,409);
  assert.deepEqual((await call(DB)).data.values,edited);
  const automatic={...edited,inputMode:'auto'};
  assert.equal((await call(DB,{method:'POST',body:body(automatic,1)})).status,200);
  assert.equal((await call(DB)).data.values.inputMode,undefined);
  assert.equal((await call(DB,{end:'2026-09-10T12:59'})).data.values.unit1.organic,null);
});
test('manual mode rejects invalid, missing and excessive quantities without saving',async t=>{
  const DB=db();t.after(()=>DB.raw.close());
  const edited={inputMode:'manual',unit1:{organic:20,manure:0},unit2:{organic:30,manure:null},receipts:{organic:60,manure:0}};
  for(const change of [v=>v.inputMode='unknown',v=>v.inputMode=null,v=>delete v.receipts,
    v=>v.receipts.organic=null,v=>v.unit1.organic=null,v=>v.unit2.organic=-1,
    v=>v.unit1.organic=1000001,v=>v.unit2.organic=0.1234567,v=>v.receipts.manure=true]){
    const value=structuredClone(edited);change(value);
    assert.equal((await call(DB,{method:'POST',body:body(value)})).status,400,JSON.stringify(value));
  }
  assert.equal((await call(DB)).data.revision,0);
});
test('the real client store reloads explicit edits and preserves failed-save input',async t=>{
  const {createRequire}=await import('node:module');
  const storage=createRequire(import.meta.url)('../maintenance/cofiring-period-manual-storage.js');
  const DB=db();t.after(()=>DB.raw.close());let fail=false;
  const store=storage.create({getHeaders:()=>({Authorization:'Bearer '+token}),fetch:async(url,init)=>{
    if(fail&&init.method==='POST')return Response.json({ok:false,message:'시험 저장 실패'},{status:503});
    const request=new Request('https://shift.test'+url,init);
    return (init.method==='POST'?api.onRequestPost:api.onRequestGet)({request,env:{DB}});
  }});
  t.after(()=>store.dispose());store.select(period.start,period.end);await store.load();
  const value={inputMode:'manual',unit1:{organic:0,manure:null},unit2:{organic:35.5,manure:2},receipts:{organic:57.8,manure:0}};
  assert.equal(await store.save(value),true);store.select(period.start,period.end);await store.load();
  assert.deepEqual(store.state().values,value);
  fail=true;const changed=structuredClone(value);changed.unit1.organic=9;
  assert.equal(await store.save(changed),false);assert.equal(changed.unit1.organic,9);
  assert.deepEqual(store.state().values,value);assert.match(store.state().error,/실패/);
  fail=false;assert.equal(await store.save(changed),true);assert.deepEqual((await call(DB)).data.values,changed);
});
