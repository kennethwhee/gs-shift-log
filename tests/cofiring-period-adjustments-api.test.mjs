import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const api=await import('data:text/javascript;base64,'+fs.readFileSync(new URL('../functions/api/cofiring-period-adjustments.js',import.meta.url)).toString('base64'));
const token='period-adjustment-test',hash=createHash('sha256').update(token).digest('hex');
function db(){const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,is_active INTEGER); CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);');raw.prepare('INSERT INTO users VALUES(?,?,?)').run('tester','시험 사용자',1);raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(hash,'tester','2099-01-01T00:00:00Z','');return {raw,prepare(sql){let p=[];return {bind(...v){p=v;return this;},async first(){return raw.prepare(sql).get(...p)||null;},async run(){raw.prepare(sql).run(...p);return {success:true};}};}};}
const period={start:'2026-09-11T00:00',end:'2026-09-11T18:00'};
let seq=0;
const rid=()=>String(++seq).padStart(32,'0');
const adjustment=()=>({mode:'manual_transfer',fromUnit:1,bioTransferTons:12.5,finalBioUnit1:300,finalBioUnit2:280,maxBioTpd:361.74,excludedBioTons:0,note:'test'});
async function call(DB,{method='GET',start=period.start,end=period.end,body=null,auth=true,headers={}}={}){const url=`https://shift.test/api/cofiring-period-adjustments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;const request=new Request(url,{method,headers:{...(auth?{Authorization:'Bearer '+token}:{}),...(method==='POST'?{'Content-Type':'application/json','X-ShiftLog-Client':'desktop'}:{}),...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});const r=await api.onRequest({request,env:{DB}});return {status:r.status,data:await r.json()};}
const saveBody=(revision=0,adj=adjustment())=>({action:'save',...period,adjustment:adj,expectedRevision:revision,requestId:rid()});

test('period adjustment API rejects unauthenticated access before use',async()=>{const DB=db();assert.equal((await call(DB,{auth:false})).status,401);assert.equal((await call(DB,{method:'POST',auth:false,body:saveBody()})).status,401);});

test('first authenticated adjustment read returns empty exact period and default max Bio setting',async()=>{const DB=db(),r=await call(DB);assert.equal(r.status,200);assert.equal(r.data.revision,0);assert.equal(r.data.adjustment,null);assert.equal(r.data.setting.maxBioTpd,361.74);});

test('shared max Bio t/d setting saves on desktop and is returned on later reads',async()=>{const DB=db();let r=await call(DB,{method:'POST',body:{action:'save_setting',maxBioTpd:400}});assert.equal(r.status,200);assert.equal(r.data.setting.maxBioTpd,400);r=await call(DB);assert.equal(r.data.setting.maxBioTpd,400);});

test('period adjustment save persists exact period with revision and replay is idempotent',async()=>{const DB=db(),body=saveBody();let r=await call(DB,{method:'POST',body});assert.equal(r.status,200);assert.equal(r.data.entry.revision,1);assert.equal(r.data.adjustment.finalBioUnit1,300);r=await call(DB);assert.equal(r.data.revision,1);assert.equal(r.data.adjustment.bioTransferTons,12.5);const replay=await call(DB,{method:'POST',body});assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.entry.revision,1);const other=await call(DB,{end:'2026-09-11T17:59'});assert.equal(other.data.revision,0);assert.equal(other.data.adjustment,null);});

test('revision conflict is fail-closed and clear appends a tombstone without deleting history',async()=>{const DB=db();assert.equal((await call(DB,{method:'POST',body:saveBody()})).status,200);const stale=await call(DB,{method:'POST',body:saveBody(0)});assert.equal(stale.status,409);assert.equal(stale.data.code,'REVISION_CONFLICT');const clear=await call(DB,{method:'POST',body:{action:'clear',...period,expectedRevision:1,requestId:rid()}});assert.equal(clear.status,200);assert.equal(clear.data.entry.revision,2);assert.equal(clear.data.adjustment,null);const latest=await call(DB);assert.equal(latest.data.revision,2);assert.equal(latest.data.adjustment,null);assert.equal(latest.data.entry.cleared,true);assert.equal(DB.raw.prepare('SELECT COUNT(*) AS c FROM cofiring_period_adjustment_history').get().c,2);});

test('period adjustment writes reject mobile, invalid values and cross-origin requests',async()=>{const DB=db();assert.equal((await call(DB,{method:'POST',body:saveBody(),headers:{'User-Agent':'iPhone Mobile'}})).status,403);const bad=adjustment();bad.finalBioUnit1=-1;assert.equal((await call(DB,{method:'POST',body:saveBody(0,bad)})).status,400);assert.equal((await call(DB,{method:'POST',body:{action:'save_setting',maxBioTpd:0}})).status,400);assert.equal((await call(DB,{method:'POST',body:saveBody(),headers:{Origin:'https://evil.test'}})).status,403);});
