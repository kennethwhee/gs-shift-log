import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
const path=new URL('../functions/api/ois-data-requests.js',import.meta.url);
let source=fs.readFileSync(path,'utf8').replace('"../_shared/blower-incremental.js"',JSON.stringify(new URL('../functions/_shared/blower-incremental.js',import.meta.url).href));
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const fixtures=JSON.parse(gunzipSync(fs.readFileSync(process.env.COFIRING_V7_TEST_FIXTURE || new URL('fixtures/cofiring-live-v7.json.gz',import.meta.url))));
const clone=x=>JSON.parse(JSON.stringify(x)), token='local-test-only', key='local-agent-test-only';
function database(){
 const raw=new DatabaseSync(':memory:');
 raw.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
 CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
 CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT NOT NULL,target_date TEXT NOT NULL,status TEXT NOT NULL,requested_by_id TEXT,requested_by_name TEXT,requested_at TEXT,started_at TEXT,completed_at TEXT,agent_id TEXT,result_json TEXT,error_message TEXT,expires_at TEXT,updated_at TEXT);
 CREATE TABLE cofiring_organic_usage_history(target_date TEXT,unit TEXT,tons REAL);INSERT INTO cofiring_organic_usage_history VALUES('2026-09-08','unit1',59.84);
 CREATE TABLE unrelated(value TEXT);INSERT INTO unrelated VALUES('keep');`);
 raw.prepare('INSERT INTO users VALUES(?,?,?,?)').run('tester','시험 사용자','operator',1);
 raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),'tester','2099-01-01T00:00:00Z',new Date().toISOString());
 function prepare(sql){let params=[];return {bind(...args){params=args;return this;},async run(){const r=raw.prepare(sql).run(...params);return {success:true,meta:{changes:Number(r.changes)}};},async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)}}};}
 return {raw,db:{prepare,async batch(statements){raw.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());raw.exec('COMMIT');return r;}catch(e){raw.exec('ROLLBACK');throw e;}}}};
}
async function call(d,{get='',body,auth=true,agent=false,id='company-pc',headers={}}={}) {
 const method=body?'POST':'GET';
 const request=new Request('https://shift.test/api/ois-data-requests'+(get?'?'+get:''),{method,headers:{...(agent?{'X-OIS-Agent-Key':key,'X-OIS-Agent-Id':id}:auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop',...headers},...(body?{body:JSON.stringify(body)}:{})});
 const r=await api[body?'onRequestPost':'onRequestGet']({request,env:{DB:d.db,OIS_AGENT_KEY:key}});return {status:r.status,data:await r.json()};
}
function createBody(extra={}){return {action:'create',requestType:'cofiring_daily',targetDate:'2026-09-08',forceRefresh:false,clientRequestId:crypto.randomUUID(),expectedResultId:null,...extra};}
async function create(d,extra={}){const r=await call(d,{body:createBody(extra)});assert.ok([200,201].includes(r.status),JSON.stringify(r.data));return r.data.item;}
async function claim(d){const r=await call(d,{agent:true,get:'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=cofiring_daily'});assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.items?.excel,JSON.stringify(r.data));return r.data.items.excel;}
function result(item){const r=clone(fixtures[item.targetDate]);r.completedAtUtc=new Date().toISOString();return {kind:'cofiring_live_result',schemaVersion:1,requestId:item.id,targetDate:item.targetDate,report:r};}
async function complete(d,item,value=result(item)){const r=await call(d,{agent:true,body:{action:'complete',requestId:item.id,result:value}});assert.equal(r.status,200,JSON.stringify(r.data));return value;}
const get=(d,date='2026-09-08',known='')=>call(d,{get:'action=cofiring_daily&targetDate='+date+(known?'&knownResultId='+known:'')});
test('authenticated GET only reads results; no job or organic write, unentered day stays empty',async()=>{
 const d=database();assert.equal((await call(d,{get:'action=cofiring_daily&targetDate=2026-09-08',auth:false})).status,401);
 const r=await get(d);assert.equal(r.status,200);assert.equal(r.data.saved,null);assert.equal(r.data.active,null);assert.equal(d.raw.prepare('SELECT count(*) n FROM ois_data_requests').get().n,0);
 assert.equal(d.raw.prepare('SELECT tons FROM cofiring_organic_usage_history').get().tons,59.84);
});
test('new query is desktop explicit and one completed calendar day; no arbitrary tags/paths accepted',async()=>{
 for(const change of [{targetDate:'2026-02-29'},{targetDate:'2999-01-01'},{targetDate:new Date(Date.now()+32400000).toISOString().slice(0,10)},{startDate:'2026-09-01'}, {targetDate:'2026-09-07~08'},{tag:'malicious'}, {updatedById:'admin'}, {forceRefresh:'true'},{expectedResultId:'fake'},{clientRequestId:'not-uuid'}]){const d=database();const r=await call(d,{body:createBody(change)});assert.equal(r.status,400,JSON.stringify(change)+JSON.stringify(r.data));}
 for(const headers of [{'X-ShiftLog-Client':''},{'User-Agent':'iPhone Mobile'},{Origin:'https://other.test'},{'Content-Type':'text/plain'}]){const d=database();assert.ok([403,415].includes((await call(d,{body:createBody(),headers})).status));}
 assert.equal((await call(database(),{auth:false,body:createBody()})).status,401);
});
test('concurrent first requests and same request retry create exactly one active job',async()=>{
 const d=database(),body=createBody();const results=await Promise.all([call(d,{body}),call(d,{body:createBody()}),call(d,{body})]);assert.ok(results.every(r=>r.status===200||r.status===201));assert.equal(new Set(results.map(r=>r.data.item.id)).size,1);assert.equal(d.raw.prepare('SELECT count(*) n FROM ois_data_requests').get().n,1);
});
test('actual shared Excel lane claims cofiring and cannot double claim the same job',async()=>{
 const d=database(),created=await create(d),claimed=await claim(d);assert.equal(claimed.id,created.id);assert.equal(claimed.status,'processing');assert.equal(claimed.agentId,'company-pc');assert.ok(Date.parse(claimed.expiresAt)-Date.now()>29*60000);
 const other=await call(d,{agent:true,id:'other-pc',get:'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=cofiring_daily'});assert.equal(other.data.items.excel,null);
});
test('V7-format gaps saved after ownership validation, canonical report excludes workstation/manual fields',async()=>{
 const d=database();await create(d);const item=await claim(d);await complete(d,item);const read=await get(d);
 assert.equal(read.data.saved.status,'complete');assert.equal(read.data.result.report.noDataRows,54);assert.equal(read.data.result.report.status,'DATA_GAPS');
 assert.equal(read.data.result.report.reference.manualOrganic,undefined);assert.equal(read.data.result.report.baselineExcel,undefined);assert.equal(read.data.result.report.ownedExcel,undefined);
 assert.ok(Buffer.byteLength(JSON.stringify(read.data.result))<1500000);assert.equal(d.raw.prepare('SELECT tons FROM cofiring_organic_usage_history').get().tons,59.84);assert.equal(d.raw.prepare('SELECT value FROM unrelated').get().value,'keep');
 const unchanged=await get(d,item.targetDate,item.id);assert.equal(unchanged.data.result,null);assert.equal(unchanged.data.saved.id,item.id);
});
test('saved result reused without new query; explicit requery preserves previous result and organic on failure',async()=>{
 const d=database();await create(d);const old=await claim(d);await complete(d,old);assert.equal((await create(d)).id,old.id);
 const refresh=await create(d,{forceRefresh:true,expectedResultId:old.id});assert.notEqual(refresh.id,old.id);
 assert.equal((await get(d)).data.saved.id,old.id);const current=await claim(d);
 const failed=await call(d,{agent:true,body:{action:'fail',requestId:current.id,errorMessage:'test Excel failure'}});assert.equal(failed.status,200,JSON.stringify(failed.data));
 const read=await get(d);assert.equal(read.data.saved.id,old.id);assert.equal(read.data.lastAttempt.status,'failed');assert.equal(d.raw.prepare('SELECT tons FROM cofiring_organic_usage_history').get().tons,59.84);
});
test('complete requires actual claimed owner, lease, current request time; generic fail cannot bypass owner',async()=>{
 const d=database(),item=await create(d),body={action:'complete',requestId:item.id,result:result(item)};
 assert.equal((await call(d,{agent:true,body})).status,409);const claimed=await claim(d);
 assert.equal((await call(d,{agent:true,id:'other-pc',body})).status,409);
 assert.equal((await call(d,{agent:true,id:'other-pc',body:{action:'fail',requestId:item.id,errorMessage:'wrong owner'}})).status,409);
 const old=result(claimed);old.report.completedAtUtc='2021-01-01T00:00:00Z';assert.equal((await call(d,{agent:true,body:{...body,result:old}})).status,400);
 d.raw.prepare('UPDATE ois_data_requests SET expires_at=? WHERE id=?').run('2021-01-01',item.id);assert.equal((await call(d,{agent:true,body})).status,409);
});
test('idempotent upload replay does not duplicate; altered payload cannot overwrite completed request',async()=>{
 const d=database();await create(d);const item=await claim(d),value=await complete(d,item);const replay=await call(d,{agent:true,body:{action:'complete',requestId:item.id,result:value}});assert.equal(replay.data.replayed,true);
 const changed=clone(value);changed.report.reference.series[0].values[1]+=0.001;assert.equal((await call(d,{agent:true,body:{action:'complete',requestId:item.id,result:changed}})).status,409);assert.equal(d.raw.prepare('SELECT count(*) n FROM ois_data_requests').get().n,1);
});
test('processing progress never becomes a saved report and requires claimed Agent',async()=>{
 const d=database();await create(d);const item=await claim(d),p={action:'cofiring_progress',requestId:item.id,phase:'reading',completedTags:4};
 assert.equal((await call(d,{agent:true,id:'other-pc',body:p})).status,409);assert.equal((await call(d,{agent:true,body:p})).status,200);
 const r=await get(d);assert.equal(r.data.saved,null);assert.equal(r.data.active.progress.completedTags,4);assert.equal((await call(d,{agent:true,body:{...p,completedTags:11}})).status,400);
});
test('bad quality, reset, partial/pending arrays, report lies, swapped tags never saved',async()=>{
 const cases=[r=>r.cleanupVerified=false,r=>r.status='PASS',r=>r.response.noDataRows=0,r=>r.reference.series[0].qualities[0]='Bad',r=>r.reference.series[0].values[1]=0,r=>r.reference.series[0].returnedTimes[1]=r.reference.series[0].returnedTimes[0],r=>r.reference.series[0].queryTag='wrong',r=>r.reference.series.pop(),r=>r.reference.series[0].values.pop(),r=>r.completedTagCount=9,r=>r.reference.timestamps.pop(),r=>r.reference.manualOrganic={unit1:999}];
 for(const [i,change] of cases.entries()){const d=database();await create(d);const item=await claim(d),v=result(item);change(v.report);const r=await call(d,{agent:true,body:{action:'complete',requestId:item.id,result:v}});if(i===cases.length-1){assert.equal(r.status,200);assert.equal((await get(d)).data.result.report.reference.manualOrganic,undefined);}else{assert.equal(r.status,400,JSON.stringify(r.data));assert.equal((await get(d)).data.saved,null);}}
});
test('newer-result revision guard blocks stale explicit requery, mobile GET still works',async()=>{
 const d=database();await create(d);const item=await claim(d);await complete(d,item);
 assert.equal((await call(d,{body:createBody({forceRefresh:true,expectedResultId:crypto.randomUUID()})})).status,409);
 assert.equal((await call(d,{get:'action=cofiring_daily&targetDate=2026-09-08',headers:{'User-Agent':'iPhone'}})).status,200);
});
test('expired cofiring jobs are failed without deleting saved records or expiring other request types',async()=>{
 const d=database();const item=await create(d);d.raw.prepare('UPDATE ois_data_requests SET expires_at=? WHERE id=?').run('2021-01-01',item.id);
 const r=await get(d);assert.equal(r.data.active,null);assert.equal(r.data.lastAttempt.status,'failed');
});

test('restart guard atomically pauses same-Agent claims in both lanes; other Agent and completion remain available',async()=>{
 const d=database(),token=crypto.randomUUID();await create(d);
 const acquire=()=>call(d,{agent:true,body:{action:'cofiring_restart_guard',operation:'acquire',guardToken:token}});
 assert.equal((await acquire()).status,200);
 let r=await call(d,{agent:true,get:'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=cofiring_daily'});assert.equal(r.data.items.excel,null);
 r=await call(d,{agent:true,get:'action=next&requestTypes=cofiring_daily'});assert.equal(r.data.item,null);
 assert.equal((await call(d,{agent:true,body:{action:'cofiring_restart_guard',operation:'acquire',guardToken:crypto.randomUUID()}})).status,409);
 r=await call(d,{agent:true,get:'action=cofiring_agent_idle'});assert.equal(r.data.guard.token,token);assert.equal(r.data.busy,false);
 await call(d,{agent:true,body:{action:'cofiring_restart_guard',operation:'release',guardToken:crypto.randomUUID()}});
 assert.equal((await call(d,{agent:true,get:'action=cofiring_agent_idle'})).data.guard.token,token);
 await call(d,{agent:true,body:{action:'cofiring_restart_guard',operation:'release',guardToken:token}});
 const claimed=await claim(d);await acquire();assert.equal((await call(d,{agent:true,get:'action=cofiring_agent_idle'})).data.busy,true);await complete(d,claimed);
 await create(d,{targetDate:'2026-09-07'});
 r=await call(d,{agent:true,id:'other-pc',get:'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=cofiring_daily'});assert.equal(r.data.items.excel.targetDate,'2026-09-07');
 assert.equal((await call(d,{auth:true,body:{action:'cofiring_restart_guard',operation:'acquire',guardToken:token}})).status,401);
});
test('expired restart guard does not block a later Agent claim',async()=>{
 const d=database(),token=crypto.randomUUID();await create(d);await call(d,{agent:true,body:{action:'cofiring_restart_guard',operation:'acquire',guardToken:token}});
 d.raw.prepare("UPDATE ois_data_requests SET expires_at='2021-01-01' WHERE request_type='cofiring_restart_guard'").run();assert.ok((await claim(d)).id);
});
