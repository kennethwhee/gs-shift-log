import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const api=await import('data:text/javascript;base64,'+fs.readFileSync(new URL('../functions/api/cofiring-calculation-settings.js',import.meta.url)).toString('base64'));
const token='settings-test',hash=createHash('sha256').update(token).digest('hex');
function db(){
 const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,is_active INTEGER); CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);');
 raw.prepare('INSERT INTO users VALUES(?,?,?)').run('tester','시험 사용자',1);raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(hash,'tester','2099-01-01T00:00:00Z','');
 return {raw,prepare(sql){let p=[];return {bind(...v){p=v;return this;},async first(){return raw.prepare(sql).get(...p)||null;},async run(){raw.prepare(sql).run(...p);return {success:true};}};}};
}
const defaults=()=>({unit1:{coal:{calorific:5868,coefficient:1},bio:{calorific:3237,coefficient:1},organic:{calorific:3487,coefficient:1},manure:{calorific:3487,coefficient:1}},unit2:{coal:{calorific:5868,coefficient:1},bio:{calorific:3237,coefficient:1},organic:{calorific:3487,coefficient:1},manure:{calorific:3487,coefficient:1}}});
let id=0;
async function call(DB,{method='GET',day='2026-09-08',body=null,auth=true,headers={}}={}){
 const request=new Request('https://shift.test/api/cofiring-calculation-settings?targetDate='+day,{method,headers:{...(auth?{Authorization:'Bearer '+token}:{}),...(method==='POST'?{'Content-Type':'application/json','X-ShiftLog-Client':'desktop'}:{}),...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 const res=await api.onRequest({request,env:{DB}});return {status:res.status,data:await res.json()};
}
function saveBody(day='2026-09-08',settings=defaults()){return {effectiveDate:day,settings,requestId:String(++id).padStart(32,'0')};}
test('settings API rejects unauthenticated requests before creating its table',async()=>{const DB=db();assert.equal((await call(DB,{auth:false})).status,401);assert.equal(DB.raw.prepare("SELECT 1 FROM sqlite_master WHERE name='cofiring_calculation_settings_history'").get(),undefined);});
test('first authenticated read returns explicit Excel-compatible defaults',async()=>{const DB=db(),r=await call(DB);assert.equal(r.status,200);assert.equal(r.data.source,'default');assert.equal(r.data.settings.unit1.coal.calorific,5868);assert.equal(r.data.settings.unit2.manure.calorific,3487);assert.equal(r.data.settings.unit1.bio.coefficient,1);});
test('saved settings apply from their effective date and preserve prior dates',async()=>{const DB=db(),s=defaults();s.unit1.coal.calorific=6000;s.unit2.bio.coefficient=.975;let r=await call(DB,{method:'POST',body:saveBody('2026-09-08',s)});assert.equal(r.status,200);assert.equal(r.data.entry.settings.unit1.coal.calorific,6000);r=await call(DB,{day:'2026-09-09'});assert.equal(r.data.source,'saved');assert.equal(r.data.settings.unit2.bio.coefficient,.975);r=await call(DB,{day:'2026-09-07'});assert.equal(r.data.source,'default');assert.equal(r.data.settings.unit1.coal.calorific,5868);});
test('later effective settings supersede only later calculation days',async()=>{const DB=db(),a=defaults(),b=defaults();a.unit1.bio.calorific=3000;b.unit1.bio.calorific=3100;await call(DB,{method:'POST',body:saveBody('2026-09-01',a)});await call(DB,{method:'POST',body:saveBody('2026-09-10',b)});assert.equal((await call(DB,{day:'2026-09-09'})).data.settings.unit1.bio.calorific,3000);assert.equal((await call(DB,{day:'2026-09-10'})).data.settings.unit1.bio.calorific,3100);});
test('invalid factors and mobile POST fail closed',async()=>{const DB=db(),bad=defaults();bad.unit1.coal.coefficient=0;assert.equal((await call(DB,{method:'POST',body:saveBody('2026-09-08',bad)})).status,400);assert.equal((await call(DB,{method:'POST',body:saveBody(),headers:{'User-Agent':'iPhone Mobile'}})).status,403);});
test('same request id is idempotent',async()=>{const DB=db(),body=saveBody();assert.equal((await call(DB,{method:'POST',body})).status,200);const second=await call(DB,{method:'POST',body});assert.equal(second.status,200);assert.equal(second.data.replayed,true);assert.equal(DB.raw.prepare('SELECT COUNT(*) n FROM cofiring_calculation_settings_history').get().n,1);});
