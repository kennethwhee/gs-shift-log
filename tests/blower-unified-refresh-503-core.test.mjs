import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const WINDOW={fromDate:'2025-09-09',endDate:'2026-09-09',snapshotAt:'2026-09-09T01:00:00.000Z'};
const cursor=id=>({workDate:'2026-09-08',updatedAt:'2026-09-08T10:00:00Z',id});
function page(phase,overrides={}){return {ok:true,version:'bounded-logs-v1',phase,window:WINDOW,limit:4,done:true,nextCursor:null,scannedLogCount:0,insertedCount:0,appliedStateChanges:0,...overrides};}
function fixture(fn){const calls=[],sleeps=[],progress=[],checkpoints=[];const io={assertWritable(){},progress:s=>progress.push(s),checkpoint:s=>checkpoints.push(s),api:async o=>{calls.push(structuredClone(o));return fn(o,calls.length);}};return {io,calls,sleeps,progress,checkpoints,options:{sleep:async n=>{sleeps.push(n);}}};}

test('replacement pages complete before chronological operation pages; totals and fixed window survive',async()=>{
 const f=fixture((o,n)=>[page('replacement',{done:false,scannedLogCount:4,nextCursor:cursor('a'),insertedCount:2}),page('replacement',{scannedLogCount:1}),page('operation',{done:false,scannedLogCount:4,nextCursor:cursor('a'),appliedStateChanges:2}),page('operation',{scannedLogCount:1})][n-1]);
 const out=await core.refreshLogs(f.io,f.options);
 assert.deepEqual(out,{scannedReplacementLogs:5,scannedOperationLogs:5,insertedCount:2,appliedStateChanges:2});
 assert.deepEqual(f.calls.map(c=>c.body.phase),['replacement','replacement','operation','operation']);
 assert.equal(f.calls[0].body.window,null);assert.equal(f.calls[2].body.cursor,null);
 assert.ok(f.calls.every(x=>x.body.action==='latest_logs_step'&&x.timeoutMs===30000));
 assert.equal(f.checkpoints.at(-1),null);
});

test('503 reduces only the failing page 4→2→1, preserves cursor, then proceeds',async()=>{
 const f=fixture((o,n)=>{
  if(n===1)return page('replacement',{done:false,scannedLogCount:4,nextCursor:cursor('a')});
  if(n===2||n===3)throw Object.assign(new Error('요청 실패 (HTTP 503)'),{status:503,cfRay:'test-ray'});
  return page(o.body.phase,{scannedLogCount:1});
 });
 await core.refreshLogs(f.io,f.options);
 assert.deepEqual(f.calls.slice(1,4).map(x=>x.body.limit),[4,2,1]);
 assert.deepEqual(f.calls[1].body.cursor,f.calls[3].body.cursor);
 assert.ok(f.progress.some(t=>t.includes('503')&&t.includes('재시도')));
 assert.ok(f.progress.some(t=>t.includes('test-ray')));
 assert.ok(f.calls.every(c=>c.body.action==='latest_logs_step'));
});

test('persistent 503 is finite and a second click can resume the failed operation page',async()=>{
 let failing=true;
 const f=fixture(o=>{
  if(o.body.phase==='replacement')return page('replacement',{scannedLogCount:1});
  if(failing)throw Object.assign(new Error('HTML service unavailable'),{status:503});
  return page('operation',{scannedLogCount:1});
 });
 await assert.rejects(()=>core.refreshLogs(f.io,f.options),e=>e.status===503&&/교체운전 확인/.test(e.message));
 assert.equal(f.calls.length,6);assert.equal(f.checkpoints.at(-1).phase,'operation');
 const resume=f.checkpoints.at(-1);failing=false;
 const out=await core.refreshLogs(f.io,{...f.options,resume});
 assert.equal(f.calls.at(-1).body.phase,'operation');assert.equal(f.calls.length,7);
 assert.equal(out.scannedReplacementLogs,1);assert.equal(out.scannedOperationLogs,1);
 assert.equal(f.checkpoints.at(-1),null);
});

for(const status of [400,401,403,409,500])test(`${status} is not silently retried or turned into success`,async()=>{
 const f=fixture(()=>{throw Object.assign(new Error('failure'),{status});});
 await assert.rejects(()=>core.refreshLogs(f.io,f.options),e=>e.status===status);
 assert.equal(f.calls.length,1);assert.equal(f.checkpoints.at(-1).phase,'replacement');
});

test('Retry-After is honored within a finite maximum',async()=>{
 const f=fixture((o,n)=>{if(n===1)throw Object.assign(new Error('rate limit'),{status:429,retryAfterMs:12000});return page(o.body.phase);});
 await core.refreshLogs(f.io,f.options);assert.equal(f.sleeps[0],12000);
});

test('authorization loss during retry delay cannot send a second request',async()=>{
 let allowed=true;
 const f=fixture(()=>{throw Object.assign(new Error('busy'),{status:503});});
 f.io.assertWritable=()=>{if(!allowed)throw Object.assign(new Error('로그인 변경'),{status:403});};
 await assert.rejects(()=>core.refreshLogs(f.io,{sleep:async()=>{allowed=false;}}),e=>e.status===403);
 assert.equal(f.calls.length,1);
});

for(const bad of [null,{},page('wrong'),page('replacement',{version:'old'}),page('replacement',{scannedLogCount:5}),
 page('replacement',{done:false,nextCursor:null}),page('replacement',{done:false,nextCursor:cursor('a'),scannedLogCount:0}),
 page('replacement',{done:'false'}),page('replacement',{window:null})])
 test(`invalid page fails closed: ${JSON.stringify(bad)}`,async()=>{
 const f=fixture(()=>bad);await assert.rejects(()=>core.refreshLogs(f.io,f.options),e=>e.code==='INVALID_LOG_PAGE');assert.equal(f.calls.length,1);
 });

test('changed snapshot and repeated cursors stop before runtime creation',async()=>{
 for(const bad of [page('replacement',{window:{...WINDOW,snapshotAt:'later'}}),page('replacement',{done:false,nextCursor:cursor('a'),scannedLogCount:1})]){
  const f=fixture((o,n)=>n===1?page('replacement',{done:false,nextCursor:cursor('a'),scannedLogCount:1}):bad);
  await assert.rejects(()=>core.refreshLogs(f.io,f.options),e=>e.code==='INVALID_LOG_PAGE');assert.equal(f.calls.length,2);
 }
});

test('GET read-back retries transient failures but never suppresses auth errors',async()=>{
 const f=fixture(()=>null);let tries=0;
 const out=await core.readWithRetry(async()=>{if(tries++<2)throw Object.assign(new Error('busy'),{status:503});return 'fresh';},f.io,'현황',f.options);
 assert.equal(out,'fresh');assert.equal(tries,3);
 tries=0;await assert.rejects(()=>core.readWithRetry(async()=>{tries++;throw Object.assign(new Error('auth'),{status:401});},f.io,'현황',f.options),e=>e.status===401);assert.equal(tries,1);
});

test('error details retain stage diagnostics without HTML response text',()=>{
 const text=core.errorLabel({message:'요청 실패',status:503,code:'HTTP_ERROR',cfRay:'test-ray'});
 assert.equal(text,'요청 실패 · HTTP 503 · Ray test-ray');
});

test('UI calls bounded refresh rather than the monolithic scan and never auto-launches at page load',()=>{
 const text=readFileSync(new URL('../maintenance/blower-history.js',import.meta.url),'utf8');
 const refresh=text.slice(text.indexOf('  async function refreshAllBlowers()'),text.indexOf('  async function refreshFbheForUnified('));
 assert.match(refresh,/core\.refreshLogsForRuntime\(io/);assert.doesNotMatch(refresh,/action:\s*"(?:scan|operation_sync)"/);
 assert.match(refresh,/최신화 중단 · \$\{phase\}/);assert.match(refresh,/unifiedLogResumeOwner/);
 assert.match(refresh,/isMobileMonitoringView\(\) \|\| !hasAuthenticatedWriteAccess\(\)/);
 const request=text.slice(text.indexOf('  async function apiRequest('),text.indexOf('  async function apiRequest(')+4000);
 assert.ok(request.indexOf('text = await response.text()')<request.indexOf('finally'));
 const html=readFileSync(new URL('../maintenance/blower-history.html',import.meta.url),'utf8');
 assert.match(html,/blower-unified-refresh\.js\?v=20260909-fbhe-seal-run-reconcile-v1/);
 assert.match(html,/blower-history\.js\?v=20260909-fbhe-seal-run-reconcile-v1/);
});
