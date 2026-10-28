'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const apiSource=fs.readFileSync(path.join(__dirname,'../functions/api/ois-data-requests.js'),'utf8')
  .replace(/^\uFEFF/,'').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const NOW=Date.parse('2026-10-29T08:30:00+09:00');
const DATE='2026-10-24';
const iso=value=>new Date(value).toISOString();
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup(t,{now=NOW,lastUsed=now}={}) {
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const context=vm.createContext({Date:Clock,TextEncoder,URL,Request,Response,Headers,crypto:webcrypto,console,
    fetch:()=>{throw new Error('saved source read cannot make an external request');}});
  vm.runInContext(apiSource+'\nglobalThis.api={get:onRequestGet,contract:COFIRING_LIVE};',context);
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  sql.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
    CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,
      requested_by_id TEXT,requested_by_name TEXT,requested_at TEXT,started_at TEXT,completed_at TEXT,
      agent_id TEXT,result_json TEXT,error_message TEXT,expires_at TEXT,updated_at TEXT);
    CREATE TABLE preserved_business_data(value TEXT);INSERT INTO preserved_business_data VALUES('keep');`);
  sql.prepare('INSERT INTO users VALUES(?,?,?,?)').run('2014081','운영자','super_admin',1);
  sql.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(createHash('sha256').update('source-test-token').digest('hex'),
    '2014081',iso(now+3600000),iso(lastUsed));
  const calls=[];
  const db={prepare(text){let args=[];const statement={bind(...values){args=values;return statement;},
    async first(){calls.push({text,args,kind:'first'});return sql.prepare(text).get(...args)||null;},
    async all(){calls.push({text,args,kind:'all'});return {results:sql.prepare(text).all(...args)};},
    async run(){calls.push({text,args,kind:'run'});const result=sql.prepare(text).run(...args);return {meta:{changes:result.changes}};}};return statement;}};
  const contract=context.api.contract;
  function record(n,options={}) {
    const date=options.date||DATE,next=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    const request={startLocal:options.start||date+'T00:00',endLocal:options.end||next+'T00:00',
      stepUnit:options.stepUnit||'minute',stepValue:options.stepValue||1};
    const p=contract.period(request,Number.MAX_SAFE_INTEGER),completed=iso(now-30000+n),requested=iso(now-90000+n);
    const summaries=contract.definitions.map((definition,i)=>({key:definition.id,unit:definition.unit,fuel:definition.fuel,
      tag:definition.queryTag,startValue:100,endValue:101+i,min:100,max:101+i,delta:1+i,usageTon:1+i,
      startQuality:'Raw, Good',endQuality:'Raw, Good',startTime:p.startLocal+':00+09:00',endTime:p.endLocal+':00+09:00',
      durationGoodSeconds:p.durationMinutes*60,durationBadSeconds:0,boundaryValid:true,durationCoverageValid:true}));
    const organicInventorySamples=contract.inventoryDefinitions.map((definition,i)=>({...definition,
      startValue:[15.71,43.862,66.506][i],endValue:[8.099,32.144,57.839][i],
      startQuality:i===2?'Raw, Bad':'Raw, Good',endQuality:'Raw, Good',
      startTime:iso(p.startMs-(i===2?2982000:10000)),endTime:iso(p.endMs-[12000,14000,9000][i]),
      durationGoodSeconds:p.durationMinutes*60-(i===2?3120:0),durationBadSeconds:i===2?3120:0,
      durationCoverageValid:true,boundaryValid:i!==2,dataComplete:i!==2}));
    const report={kind:'cofiring_dataparc_period_report',schemaVersion:1,status:'PERIOD_READY',executionSucceeded:true,
      cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],runId:'a'.repeat(32),
      ...request,queryEndLocal:p.queryEndLocal,summaries,completedAtUtc:completed,
      organicInventoryReady:false,organicInventory:null,organicInventorySamples};
    const raw={kind:'cofiring_period_live_result',schemaVersion:1,requestId:uid(n),request,report};
    if(options.mutate)options.mutate(raw);
    sql.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(n),options.type||'cofiring_period',
      options.targetDate||p.targetDate,options.status||'complete','2014081','운영자',requested,requested,completed,'agent',
      options.json===undefined?JSON.stringify(raw):options.json,'',options.expires||iso(now+3600000),completed);
    return raw;
  }
  async function get({date=DATE,id,token='source-test-token',action='cofiring_period_source'}={}) {
    const query=new URLSearchParams({action,targetDate:date});if(id!==undefined)query.set('sourceRequestId',id);
    const request=new Request('https://example.test/api/ois-data-requests?'+query,
      {headers:token?{Authorization:'Bearer '+token}:{}});
    const response=await context.api.get({request,env:{DB:db}});
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  const rows=()=>sql.prepare('SELECT * FROM ois_data_requests ORDER BY id').all();
  return {record,get,calls,sql,rows};
}
function sourceReads(s){return s.calls.filter(call=>/FROM ois_data_requests/.test(call.text));}
function noBusinessWrites(s){
  assert.ok(s.calls.every(call=>call.kind!=='run'||/^\s*UPDATE shift_log_sessions\b/.test(call.text)),JSON.stringify(s.calls));
  assert.ok(sourceReads(s).every(call=>/^SELECT\b/.test(call.text)));
  assert.equal(s.sql.prepare('SELECT value FROM preserved_business_data').get().value,'keep');
}

test('source dispatch requires authentication before any source lookup',async t=>{
  const s=setup(t);s.record(1);
  for(const token of ['', 'unknown'])assert.equal((await s.get({token})).status,401);
  assert.equal(sourceReads(s).length,0);noBusinessWrites(s);
});

test('source validates an exact completed date and any explicitly supplied UUID before reading records',async t=>{
  const s=setup(t);
  for(const date of ['', '2026-1-24','2026-02-30','2020-12-31','2026-10-29','2026-10-30'])
    assert.equal((await s.get({date})).status,400,date);
  for(const id of ['', 'not-a-uuid',uid(1)+"' OR 1=1",'../other'])assert.equal((await s.get({id})).status,400,id);
  assert.equal(sourceReads(s).length,0);noBusinessWrites(s);
});

test('full-day primary ignores newer partial-day, custom-period and different-interval saved results',async t=>{
  const s=setup(t);s.record(1);
  s.record(2,{end:DATE+'T23:00'});s.record(3,{start:DATE+'T01:00'});
  s.record(4,{stepUnit:'hour'});s.record(5,{stepValue:2});
  const before=s.rows(),result=await s.get();
  assert.equal(result.status,200);assert.equal(result.body.saved.id,uid(1));assert.equal(result.body.sourceRequestId,uid(1));
  assert.equal(result.body.periodKey,'2026-10-24T00:00|2026-10-25T00:00|minute|1');
  assert.deepEqual(result.body.period,{start:'2026-10-24T00:00',end:'2026-10-25T00:00',stepUnit:'minute',stepValue:1});
  assert.equal(result.body.result.report.queryEndLocal,'2026-10-25T00:01');
  assert.deepEqual(s.rows(),before);noBusinessWrites(s);
});

test('full-day discovery skips a corrupt exact-period result and returns the latest validated full-day source',async t=>{
  const s=setup(t);s.record(1);s.record(2);s.record(3,{mutate:raw=>raw.report.cleanupVerified=false});
  const result=await s.get();assert.equal(result.status,200);assert.equal(result.body.saved.id,uid(2));noBusinessWrites(s);
});

test('no complete full-day source returns explicit null without treating a prefix as midnight stock',async t=>{
  const s=setup(t);s.record(1,{end:DATE+'T12:00'});s.record(2,{status:'pending'});s.record(3,{status:'failed'});
  const result=await s.get();assert.equal(result.status,200);assert.equal(result.body.ok,true);
  for(const key of ['sourceRequestId','periodKey','period','saved','result'])assert.equal(result.body[key],null,key);
  noBusinessWrites(s);
});

test('exact source ID retains its original result despite newer full-day or partial-day records',async t=>{
  const s=setup(t);s.record(1);s.record(2,{mutate:raw=>raw.report.organicInventorySamples[2].endValue=null});
  s.record(3,{end:DATE+'T18:00'});
  const before=s.rows(),result=await s.get({id:uid(1)});
  assert.equal(result.status,200);assert.equal(result.body.sourceRequestId,uid(1));assert.equal(result.body.saved.id,uid(1));
  assert.equal(result.body.result.requestId,uid(1));assert.equal(result.body.saved.requestType,'cofiring_period');
  assert.equal(result.body.result.report.organicInventorySamples[2].endValue,57.839);
  assert.equal(sourceReads(s).length,1);assert.match(sourceReads(s)[0].text,/id=\?.*target_date=\?.*status='complete'.*LIMIT 1/);
  assert.deepEqual(s.rows(),before);noBusinessWrites(s);
});

test('BAD start remains BAD while independently GOOD day-end samples survive the validated response',async t=>{
  const s=setup(t);const raw=s.record(1),result=await s.get({id:uid(1)});
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
  assert.equal(result.body.result.report.organicInventoryReady,false);assert.equal(result.body.result.report.organicInventory,null);
  const samples=result.body.result.report.organicInventorySamples;
  assert.equal(samples[2].startQuality,'Raw, Bad');assert.equal(samples[2].startValue,66.506);
  assert.equal(samples[2].endQuality,'Raw, Good');assert.equal(samples[2].endValue,57.839);
  assert.equal(samples[2].endTime,raw.report.organicInventorySamples[2].endTime);
  assert.equal(result.body.saved.progress,null);assert.equal(result.body.saved.errorMessage,'');noBusinessWrites(s);
});

test('unknown, wrong-date, wrong-type, pending and failed exact IDs never fall back to another source',async t=>{
  const s=setup(t);s.record(1);s.record(2,{targetDate:'2026-10-23'});s.record(3,{type:'cofiring_daily'});
  s.record(4,{status:'pending'});s.record(5,{status:'failed'});
  for(const n of [2,3,4,5,999]){
    const result=await s.get({id:uid(n)});assert.equal(result.status,200);assert.equal(result.body.saved,null);assert.equal(result.body.result,null);
  }
  noBusinessWrites(s);
});

test('pinned corrupt JSON, request identity, period, interval and report validation errors fail closed',async t=>{
  const cases=[
    {json:'{broken'},
    {mutate:raw=>raw.requestId=uid(999)},
    {end:DATE+'T23:00'},
    {end:'2026-10-26T00:00'},
    {stepUnit:'hour'},
    {stepValue:2},
    {mutate:raw=>raw.report.endLocal='2026-10-26T00:00'},
    {mutate:raw=>raw.report.summaries[0].usageTon=999},
    {mutate:raw=>raw.report.cleanupVerified=false}
  ];
  for(const options of cases){
    const s=setup(t);s.record(1,options);s.record(2);const before=s.rows();
    const result=await s.get({id:uid(1)});
    assert.equal(result.status,409,JSON.stringify(options));assert.equal(result.body.ok,false);
    assert.equal(result.body.code,'COFIRING_SOURCE_RESULT_INVALID');assert.equal(result.body.saved,undefined);assert.equal(result.body.result,undefined);
    assert.deepEqual(s.rows(),before);noBusinessWrites(s);
  }
});

test('the read route preserves expired pending work and all saved bytes while retaining auth session touch',async t=>{
  const s=setup(t,{lastUsed:NOW-600000});s.record(1);s.record(2,{status:'pending',expires:'2020-01-01T00:00:00Z'});
  const before=s.rows();assert.equal((await s.get()).status,200);assert.equal((await s.get({id:uid(1)})).status,200);
  assert.deepEqual(s.rows(),before);
  assert.equal(s.calls.filter(call=>call.kind==='run'&&/^\s*UPDATE shift_log_sessions\b/.test(call.text)).length,1);
  noBusinessWrites(s);
});

test('full-day and pinned reads work for later dates without an October-specific condition',async t=>{
  const s=setup(t,{now:Date.parse('2028-03-02T10:00:00+09:00')});
  for(const [i,date] of ['2026-11-15','2027-01-01','2028-02-29'].entries()){
    s.record(i+1,{date});
    for(const id of [undefined,uid(i+1)]){
      const result=await s.get({date,id});assert.equal(result.status,200);assert.equal(result.body.targetDate,date);
      assert.equal(result.body.saved.id,uid(i+1));assert.equal(result.body.result.request.startLocal,date+'T00:00');
    }
  }
  noBusinessWrites(s);
});

test('existing latest-day route still selects a recent prefix while the new full-day route selects midnight',async t=>{
  const s=setup(t);s.record(1);s.record(2,{end:DATE+'T18:00'});
  const latest=await s.get({action:'cofiring_period_latest'}),daily=await s.get();
  assert.equal(latest.body.saved.id,uid(2));assert.equal(daily.body.saved.id,uid(1));noBusinessWrites(s);
});
