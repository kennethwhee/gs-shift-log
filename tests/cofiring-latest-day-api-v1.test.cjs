'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const apiPath=path.join(__dirname,'../functions/api/ois-data-requests.js');
const source=fs.readFileSync(apiPath,'utf8').replace(/^\uFEFF/,'').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const NOW=Date.parse('2026-09-16T03:15:00+09:00');
const iso=v=>new Date(v).toISOString();
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup(t,{now=NOW,lastUsed=NOW}={}) {
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const context=vm.createContext({Date:Clock,TextEncoder,URL,Request,Response,Headers,crypto:webcrypto,
    fetch:()=>{throw new Error('read route must not make external requests');},console});
  vm.runInContext(source+'\nglobalThis.api={get:onRequestGet,contract:COFIRING_LIVE};',context);
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  sql.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
    CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,
      requested_by_id TEXT,requested_by_name TEXT,requested_at TEXT,started_at TEXT,completed_at TEXT,
      agent_id TEXT,result_json TEXT,error_message TEXT,expires_at TEXT,updated_at TEXT);
    CREATE INDEX idx_cofiring_period_history_v1 ON ois_data_requests(target_date,status,requested_at DESC) WHERE request_type='cofiring_period';`);
  sql.prepare('INSERT INTO users VALUES(?,?,?,?)').run('2014081','운영자','super_admin',1);
  sql.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(createHash('sha256').update('session-token').digest('hex'),'2014081',iso(now+3600000),iso(lastUsed));
  const calls=[];
  const db={prepare(text){let args=[];const stmt={bind(...values){args=values;return stmt;},async first(){calls.push({text,args,kind:'first'});return sql.prepare(text).get(...args)||null;},async all(){calls.push({text,args,kind:'all'});return {results:sql.prepare(text).all(...args)};},async run(){calls.push({text,args,kind:'run'});const r=sql.prepare(text).run(...args);return {meta:{changes:r.changes}};}};return stmt;}};
  const contract=context.api.contract;
  function record(n,opts={}) {
    const request={startLocal:opts.start||'2026-09-16T00:00',endLocal:opts.end||'2026-09-16T03:08',stepUnit:opts.stepUnit||'minute',stepValue:opts.stepValue||1};
    const p=contract.period(request,Number.MAX_SAFE_INTEGER),completedAt=opts.completed||iso(now-30000+n),requestedAt=opts.requested||iso(now-90000+n);
    const summaries=contract.definitions.map((d,i)=>({key:d.id,unit:d.unit,fuel:d.fuel,tag:d.queryTag,startValue:100,endValue:101+i,min:100,max:101+i,delta:1+i,usageTon:1+i,
      startQuality:'Raw, Good',endQuality:'Raw, Good',startTime:p.startLocal+':00+09:00',endTime:p.endLocal+':00+09:00',durationGoodSeconds:p.durationMinutes*60,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}));
    const report={kind:'cofiring_dataparc_period_report',schemaVersion:1,status:'PERIOD_READY',executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],runId:'a'.repeat(32),...request,queryEndLocal:p.queryEndLocal,summaries,completedAtUtc:completedAt};
    const raw={kind:'cofiring_period_live_result',schemaVersion:1,requestId:uid(n),request,report};
    if(opts.mutate)opts.mutate(raw);
    sql.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(n),opts.type||'cofiring_period',opts.targetDate||p.targetDate,opts.status||'complete','2014081','운영자',requestedAt,requestedAt,completedAt,'agent',opts.json===undefined?JSON.stringify(raw):opts.json,'',iso(now+3600000),completedAt);
    return raw;
  }
  async function get(date='2026-09-16',{token='session-token'}={}) {
    const headers=token?{Authorization:'Bearer '+token}:{};
    const req=new Request('https://example.test/api/ois-data-requests?action=cofiring_period_latest&targetDate='+encodeURIComponent(date),{headers});
    const response=await context.api.get({request:req,env:{DB:db}});
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  async function getExact(period) {
    const query=new URLSearchParams({action:'cofiring_period',...period});
    const req=new Request('https://example.test/api/ois-data-requests?'+query,{headers:{Authorization:'Bearer session-token'}});
    const response=await context.api.get({request:req,env:{DB:db}});
    return {status:response.status,body:await response.json()};
  }
  return {record,get,getExact,calls,sql,contract};
}
function candidateReads(s){return s.calls.filter(c=>c.kind==='all'&&/FROM ois_data_requests/.test(c.text));}
function assertNoWorkMutation(s){assert.equal(s.calls.filter(c=>c.kind==='run'&&!/UPDATE shift_log_sessions/.test(c.text)).length,0);}

test('latest-day dispatch requires real authentication before reading saved results',async t=>{
  const s=setup(t);s.record(1);
  assert.equal((await s.get(undefined,{token:''})).status,401);
  assert.equal((await s.get(undefined,{token:'unknown'})).status,401);
  assert.equal(candidateReads(s).length,0);assertNoWorkMutation(s);
});

test('latest-day date validation rejects malformed, impossible, pre-2021 and future KST dates',async t=>{
  const s=setup(t);
  for(const date of ['', '2026-9-16','2026-02-30','2020-12-31','2026-09-17'])assert.equal((await s.get(date)).status,400,date);
  assert.equal(candidateReads(s).length,0);assertNoWorkMutation(s);
});

test('reopening returns exact saved 03:09 query boundary and validated canonical usage without new work',async t=>{
  const s=setup(t);s.record(1,{mutate:r=>{r.request.unknown='not returned';}});
  const r=await s.get();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.deepEqual(r.body.period,{start:'2026-09-16T00:00',end:'2026-09-16T03:08',stepUnit:'minute',stepValue:1});
  assert.equal(r.body.periodKey,'2026-09-16T00:00|2026-09-16T03:08|minute|1');
  assert.equal(r.body.result.report.queryEndLocal,'2026-09-16T03:09');
  assert.equal(r.body.result.report.summaries[9].usageTon,10);
  assert.equal(r.body.saved.requestType,'cofiring_period');assert.equal(r.body.saved.id,uid(1));
  assert.equal(r.body.saved.request.unknown,undefined);assert.equal(r.body.result.request.unknown,undefined);
  assertNoWorkMutation(s);
});

test('complete timestamp then request timestamp then ID deterministically select the latest valid completion',async t=>{
  const s=setup(t),completed=iso(NOW-20000),requested=iso(NOW-30000);
  s.record(1,{completed:iso(NOW-30000),requested:iso(NOW-10000),end:'2026-09-16T03:10'});
  s.record(2,{completed,requested:iso(NOW-40000)});
  s.record(3,{completed,requested});s.record(4,{completed,requested,end:'2026-09-16T03:06'});
  assert.equal((await s.get()).body.saved.id,uid(4));assertNoWorkMutation(s);
});

test('more than twenty newer unrelated periods, failed work and malformed JSON cannot hide a saved cumulative result',async t=>{
  const s=setup(t);s.record(1);
  for(let n=2;n<=45;n++)s.record(n,{start:'2026-09-16T01:00',end:'2026-09-16T03:00'});
  s.record(46,{stepUnit:'hour'});s.record(47,{stepValue:2});s.record(48,{end:'2026-09-17T00:10'});
  s.record(49,{status:'pending'});s.record(50,{status:'failed'});s.record(51,{json:'{invalid json'});
  s.record(52,{type:'cofiring_daily'});s.record(53,{targetDate:'2026-09-15'});
  s.record(54,{mutate:r=>r.report.summaries[0].usageTon=999});
  const r=await s.get();assert.equal(r.status,200);assert.equal(r.body.saved.id,uid(1));
  assert.equal(candidateReads(s).length,1);assertNoWorkMutation(s);
});

test('keyset discovery continues past corrupt prefix reports using real SQLite and keeps reads bounded',async t=>{
  const s=setup(t);s.record(1);
  for(let n=2;n<=46;n++)s.record(n,{mutate:r=>r.report.cleanupVerified=false});
  assert.equal((await s.get()).body.saved.id,uid(1));assert.equal(candidateReads(s).length,3);
  assert.ok(candidateReads(s).slice(1).every(c=>/id<\?/.test(c.text)));assertNoWorkMutation(s);
});

test('scan exhaustion is an explicit incomplete error instead of falsely reporting no saved result',async t=>{
  const s=setup(t);s.record(1);
  for(let n=2;n<=202;n++)s.record(n,{mutate:r=>r.report.summaries.pop()});
  const r=await s.get();assert.equal(r.status,503);assert.equal(r.body.code,'COFIRING_LATEST_SCAN_LIMIT');
  assert.equal(r.body.ok,false);assert.equal(candidateReads(s).length,10);assertNoWorkMutation(s);
});

test('query boundary must actually be complete despite the shared period validator clock tolerance',async t=>{
  const s=setup(t);s.record(1,{end:'2026-09-16T03:14'});s.record(2,{end:'2026-09-16T03:15'});
  assert.equal((await s.get()).body.saved.id,uid(1));assertNoWorkMutation(s);
});

test('completed full days and prior-day cumulative prefixes can be read, while no result is explicit null',async t=>{
  const s=setup(t);s.record(1,{start:'2026-09-15T00:00',end:'2026-09-16T00:00'});
  assert.equal((await s.get('2026-09-15')).body.result.report.queryEndLocal,'2026-09-16T00:01');
  s.record(2,{start:'2026-09-14T00:00',end:'2026-09-14T13:00'});
  assert.equal((await s.get('2026-09-14')).body.saved.id,uid(2));
  const empty=(await s.get('2026-09-13')).body;
  for(const key of ['periodKey','period','saved','result'])assert.equal(empty[key],null,key);
  assertNoWorkMutation(s);
});

test('existing authentication session refresh remains intact and cannot update requests or results',async t=>{
  const s=setup(t,{lastUsed:NOW-600000});s.record(1);
  assert.equal((await s.get()).status,200);
  assert.equal(s.calls.filter(c=>c.kind==='run'&&/UPDATE shift_log_sessions/.test(c.text)).length,1);
  assertNoWorkMutation(s);
});


test('latest-day discovery followed by exact-period reload preserves an older saved prefix behind 45 unrelated periods',async t=>{
  const s=setup(t);s.record(1);
  for(let n=2;n<=46;n++)s.record(n,{start:'2026-09-16T01:00',end:'2026-09-16T03:00'});
  s.record(47,{json:'{malformed json'});
  const latest=await s.get();assert.equal(latest.status,200);assert.equal(latest.body.saved.id,uid(1));
  assertNoWorkMutation(s);
  const exact=await s.getExact(latest.body.period);assert.equal(exact.status,200);
  assert.equal(exact.body.saved.id,uid(1));assert.equal(exact.body.result.requestId,uid(1));
  assert.equal(exact.body.periodKey,latest.body.periodKey);
  assert.equal(exact.body.result.report.queryEndLocal,'2026-09-16T03:09');
  assert.deepEqual(exact.body.result.report.summaries,latest.body.result.report.summaries);
});
