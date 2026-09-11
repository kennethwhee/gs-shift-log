import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
if (!globalThis.crypto)globalThis.crypto=webcrypto;
const api=await import('data:text/javascript;base64,'+fs.readFileSync(new URL('../functions/api/cofiring-manure-usage.js',import.meta.url)).toString('base64'));
let DatabaseSync=null;try {({DatabaseSync}=await import('node:sqlite'));}catch(_){/* Node 18/20: interface tests still run; local release validation used actual SQLite. */}
console.log('API test DB: '+(DatabaseSync?'actual local SQLite (not production D1)':'in-memory D1 interface model; SQL engine validation not available in this Node version'));
const TABLE='cofiring_manure_usage_history';
const token='local-test-session',hash=createHash('sha256').update(token).digest('hex');
class ModelDB {
 constructor(){this.history=[];this.created=false;this.user={employee_no:'tester',name:'시험 사용자',is_active:1};this.session={token_hash:hash,employee_no:'tester',expires_at:'2099-01-01T00:00:00Z'};}
 prepare(sql){let params=[];const that=this;return {bind(...p){params=p;return this;},async first(){
   if(sql.includes('INNER JOIN users'))return params[0]===that.session?.token_hash?{...that.session,...that.user}:null;
   if(sql.includes('request_id = ?'))return that.history.find(r=>r.request_id===params[0])||null;
   if(sql.includes('ORDER BY revision'))return that.history.filter(r=>r.target_date===params[0]&&r.unit===params[1]).sort((a,b)=>b.revision-a.revision)[0]||null;
   throw new Error('Unexpected modeled query');
 },async run(){
   if(sql.startsWith('DELETE FROM shift_log_sessions')){that.session=null;return {success:true};}
   if(sql.startsWith('UPDATE shift_log_sessions'))return {success:true};
   if(sql.startsWith('CREATE TABLE')){that.created=true;return {success:true};}
   if(sql.startsWith('INSERT INTO '+TABLE)){
     assert.match(sql,/WHERE COALESCE\(\(SELECT MAX\(revision\)/);assert.match(sql,/ON CONFLICT DO NOTHING/);
     const [target_date,unit,revision,tons,request_id,updated_by_id,updated_by_name,updated_at,d,u,expected]=params;
     const current=Math.max(0,...that.history.filter(r=>r.target_date===d&&r.unit===u).map(r=>r.revision));
     if(expected===current&&!that.history.some(r=>r.request_id===request_id))that.history.push({target_date,unit,revision,tons,request_id,updated_by_id,updated_by_name,updated_at});
     return {success:true};
   }
   throw new Error('Unexpected modeled statement');
 }};}
}
function database({active=1,expired=false}={}){
 if(!DatabaseSync){const d=new ModelDB();d.user.is_active=active;if(expired)d.session.expires_at='2000-01-01';return {db:d,history:()=>d.history,exists:()=>d.created};}
 const raw=new DatabaseSync(':memory:');
 raw.exec('CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,is_active INTEGER); CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT); CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES(\'keep\');');
 raw.prepare('INSERT INTO users VALUES(?,?,?)').run('tester','시험 사용자',active);
 raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(hash,'tester',expired?'2000-01-01':'2099-01-01T00:00:00Z','');
 const db={prepare(sql){let params=[];return {bind(...p){params=p;return this;},async first(){return raw.prepare(sql).get(...params)||null;},async run(){const r=raw.prepare(sql).run(...params);return {success:true,meta:{changes:Number(r.changes)}};}};}};
 return {db,raw,history:()=>raw.prepare('SELECT * FROM '+TABLE+' ORDER BY target_date,unit,revision').all().map(r=>({...r})),exists:()=>!!raw.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(TABLE)};
}
let ids=0;
function body(extra={}){return {targetDate:'2026-09-08',unit:'unit1',action:'save',tons:59.84,expectedRevision:0,requestId:String(++ids).padStart(32,'0'),...extra};}
async function call(d,{method='GET',payload=null,headers={},query='2026-09-08',auth=true,raw=null}={}){
 const r=new Request('https://shift.test/api/cofiring-manure-usage?targetDate='+encodeURIComponent(query),{method,headers:{...(auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json','X-ShiftLog-Client':'desktop',...headers},...(['GET','HEAD'].includes(method)?{}:{body:raw??JSON.stringify(payload)})});
 const response=await api.onRequest({request:r,env:{DB:d.db}});return {status:response.status,data:await response.json(),headers:response.headers};
}
test('unauthenticated GET/POST rejected before creating the storage table',async()=>{const d=database();for(const method of ['GET','POST'])assert.equal((await call(d,{method,payload:body(),auth:false})).status,401);assert.equal(d.exists(),false);});
test('expired/inactive sessions cannot read or write manual usage',async()=>{for(const opt of [{active:0},{expired:true}]){const d=database(opt);assert.equal((await call(d,{method:'POST',payload:body()})).status,401);assert.equal(d.exists(),false);}});
test('a new date is unentered, not implicitly zero; GET never imports reference or Daily DATA',async()=>{const d=database(),r=await call(d);assert.equal(r.status,200);assert.deepEqual(r.data.entries,{unit1:null,unit2:null});assert.equal(d.history().length,0);assert.equal(r.headers.get('cache-control'),'no-store');});
test('explicit zero is saved with authenticated actor and isolated from the other unit/day',async()=>{
 const d=database(),b=body({tons:0}),r=await call(d,{method:'POST',payload:b});assert.equal(r.status,200);assert.equal(r.data.entry.tons,0);assert.equal(r.data.entry.updatedById,'tester');assert.equal(r.data.entry.source,'manual');assert.equal(r.data.entry.revision,1);
 const read=await call(d);assert.equal(read.data.entries.unit1.tons,0);assert.equal(read.data.entries.unit2,null);assert.deepEqual((await call(d,{query:'2026-09-09'})).data.entries,{unit1:null,unit2:null});
 if(d.raw)assert.equal(d.raw.prepare('SELECT value FROM unrelated').get().value,'keep');
});
test('modify creates a new audit version and leaves original history intact',async()=>{const d=database();await call(d,{method:'POST',payload:body()});const r=await call(d,{method:'POST',payload:body({tons:'60.123456',expectedRevision:1})});assert.equal(r.data.entry.tons,60.123456);assert.deepEqual(d.history().map(r=>r.tons),[59.84,60.123456]);assert.equal((await call(d)).data.entries.unit1.revision,2);});
test('null/blank/booleans/coercible objects/negative/non-finite/too-precise values rejected',async()=>{const d=database();for(const tons of ['',null,true,false,[],{},'-1','Infinity','NaN','1e2','1.2345678',1000001]){assert.equal((await call(d,{method:'POST',payload:body({tons})})).status,400);}assert.equal(d.exists(),false);});
test('invalid day, multi-day, unknown unit or falsified actor rejected',async()=>{const d=database();for(const change of [{targetDate:'2026-02-29'},{targetDate:'2026-09-08T00:00'},{targetDate:'2026-09-08~09'},{unit:'unit3'},{updatedById:'admin'},{expectedRevision:'0'},{expectedRevision:-1},{requestId:'sql\' injection'}])assert.equal((await call(d,{method:'POST',payload:body(change)})).status,400);assert.equal(d.exists(),false);});
test('method/content-type/malformed/oversized/cross-origin policies fail closed',async()=>{const d=database();assert.equal((await call(d,{method:'DELETE',payload:body()})).status,405);assert.equal((await call(d,{method:'POST',payload:body(),headers:{'Content-Type':'text/plain'}})).status,415);assert.equal((await call(d,{method:'POST',raw:'{'})).status,400);assert.equal((await call(d,{method:'POST',raw:'x'.repeat(4097)})).status,413);assert.equal((await call(d,{method:'POST',payload:body(),headers:{Origin:'https://other.test'}})).status,403);assert.equal(d.exists(),false);});
test('mobile and missing desktop intent cannot POST but authenticated GET remains allowed',async()=>{const d=database();for(const headers of [{'User-Agent':'iPhone Mobile'},{'X-ShiftLog-Client':'mobile'},{'X-ShiftLog-Client':''}])assert.equal((await call(d,{method:'POST',payload:body(),headers})).status,403);assert.equal(d.exists(),false);assert.equal((await call(d,{headers:{'User-Agent':'iPhone'}})).status,200);});
test('same request retry creates only one row; reused request with changed data is rejected',async()=>{const d=database(),b=body();await call(d,{method:'POST',payload:b});const r=await call(d,{method:'POST',payload:b});assert.equal(r.status,200);assert.equal(r.data.replayed,true);assert.equal(d.history().length,1);assert.equal((await call(d,{method:'POST',payload:{...b,tons:100}})).status,409);assert.equal(d.history().length,1);});
test('stale revision cannot overwrite and returns the latest stored value',async()=>{const d=database();await call(d,{method:'POST',payload:body()});const r=await call(d,{method:'POST',payload:body({tons:70})});assert.equal(r.status,409);assert.equal(r.data.code,'REVISION_CONFLICT');assert.equal(r.data.current.tons,59.84);assert.equal(d.history().length,1);});
test('parallel first writes have exactly one winner for the same date/unit',async()=>{const d=database();const results=await Promise.all([call(d,{method:'POST',payload:body({tons:10})}),call(d,{method:'POST',payload:body({tons:20})})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(d.history().length,1);});
test('parallel unit writes are independent and both survive',async()=>{const d=database();const r=await Promise.all([call(d,{method:'POST',payload:body({tons:10})}),call(d,{method:'POST',payload:body({unit:'unit2',tons:20})})]);assert.ok(r.every(x=>x.status===200));const read=await call(d);assert.equal(read.data.entries.unit1.tons,10);assert.equal(read.data.entries.unit2.tons,20);});
test('explicit clear appends a null tombstone with history, not a destructive delete or zero',async()=>{const d=database();await call(d,{method:'POST',payload:body()});const r=await call(d,{method:'POST',payload:body({action:'clear',tons:null,expectedRevision:1})});assert.equal(r.status,200);assert.equal(r.data.entry.tons,null);assert.deepEqual(d.history().map(x=>x.tons),[59.84,null]);assert.equal((await call(d)).data.entries.unit1.revision,2);assert.equal((await call(d,{method:'POST',payload:body({action:'clear',tons:0,expectedRevision:2})})).status,400);});
test('missing binding returns service failure without pretending that save succeeded',async()=>{assert.equal((await call({db:null},{method:'POST',payload:body()})).status,503);});
