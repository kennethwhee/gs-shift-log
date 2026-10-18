import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {onRequestGet,onRequestPost} from '../functions/api/ois-data-requests.js';
import contract from '../daily-operation/daily-operation-query-contract.js';
const {DatabaseSync} = await import('node:sqlite');
const TYPE='daily_operation_data', DAY='2026-09-01';
function result() {
 const range=contract.interval(DAY);
 return {requestType:TYPE,schemaVersion:1,targetDate:DAY,source:'dataparc_hidden_excel',step:'1D',...range,cleanupVerified:true,
 samples:contract.definitions.map((d,i)=>({...d,date:DAY,value:i+0.123,qualityText:'Good',returnedTimeText:DAY+' 12:00:00',periodStartKst:range.startLocal.replace('T',' '),periodEndKst:range.endLocal.replace('T',' ')}))};
}
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (employee_no TEXT PRIMARY KEY, name TEXT, role TEXT, is_active INTEGER);
    CREATE TABLE shift_log_sessions (token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT, last_used_at TEXT);
    CREATE TABLE ois_data_requests (id TEXT PRIMARY KEY, request_type TEXT, target_date TEXT, status TEXT,
      requested_by_id TEXT, requested_by_name TEXT, requested_at TEXT, started_at TEXT, completed_at TEXT,
      agent_id TEXT, result_json TEXT, error_message TEXT, expires_at TEXT, updated_at TEXT);`);
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO users VALUES ('user1', 'Test', 'user', 1)").run();
  sqlite.prepare("INSERT INTO shift_log_sessions VALUES (?, 'user1', ?, ?)").run(
    createHash('sha256').update('browser-token').digest('hex'), new Date(Date.now() + 86400000).toISOString(), now);
  const db = {
    prepare(sql) {
      return { bindings: [], bind(...values) { this.bindings = values; return this; },
        async first() { return sqlite.prepare(sql).get(...this.bindings) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.bindings) }; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...this.bindings).changes) } }; } };
    },
    async batch(statements) { return await Promise.all(statements.map(s => s.run())); }
  };
  async function api(method, body, query = '', headers = { Authorization: 'Bearer browser-token' }) {
    const request = new Request(`https://example.test/api/ois-data-requests${query}`, { method, headers: {
      'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
    const response = await (method === 'POST' ? onRequestPost : onRequestGet)({ request, env: { DB: db, OIS_AGENT_KEY: 'agent-key' } });
    return { status: response.status, body: await response.json() };
  }
  const agentHeaders = owner => ({ 'X-OIS-Agent-Key': 'agent-key', 'X-OIS-Agent-Id': owner || 'excel1' });
  return { sqlite, api, agentHeaders, close: () => sqlite.close() };
}


test('read-only saved lookup requires login and does not create a request',async t=>{
 const f=fixture();t.after(f.close);
 assert.equal((await f.api('GET',null,`?action=${TYPE}&targetDate=${DAY}`,{})).status,401);
 const empty=await f.api('GET',null,`?action=${TYPE}&targetDate=${DAY}`);
 assert.equal(empty.status,200);assert.equal(empty.body.item,null);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ois_data_requests').get().n,0);
});
test('fixed date-only request is past-only, deduplicates active jobs and claims only Excel lane',async t=>{
 const f=fixture();t.after(f.close);
 for(const targetDate of ['2026-02-30','2020-12-31',new Date(Date.now()+9*3600000).toISOString().slice(0,10)])assert.equal((await f.api('POST',{requestType:TYPE,targetDate})).status,400);
 assert.equal((await f.api('POST',{requestType:TYPE,targetDate:DAY,tag:'untrusted'})).status,400);
 assert.equal((await f.api('POST',{requestType:TYPE,targetDate:DAY,forceRefresh:'true'})).status,400);
 const create=await f.api('POST',{requestType:TYPE,targetDate:DAY});assert.equal(create.status,201,JSON.stringify(create));
 const duplicate=await f.api('POST',{requestType:TYPE,targetDate:DAY,forceRefresh:true});assert.equal(duplicate.body.item.id,create.body.item.id);
 const wrong=await f.api('GET',null,`?action=next_lanes&oisRequestTypes=${TYPE}&excelRequestTypes=daily_data_excel`,f.agentHeaders());assert.equal(wrong.status,400);
 const claim=await f.api('GET',null,`?action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=${TYPE}`,f.agentHeaders());
 assert.equal(claim.status,200,JSON.stringify(claim));assert.equal(claim.body.items.excel.id,create.body.item.id);assert.equal(claim.body.items.ois,null);
});
test('owner/lease enforced, partial values persist as null, replay immutable, force refresh preserves previous result',async t=>{
 const f=fixture();t.after(f.close);
 const created=await f.api('POST',{requestType:TYPE,targetDate:DAY});const id=created.body.item.id;
 const complete=(r,owner='excel1')=>f.api('POST',{action:'complete',requestId:id,result:r},'',f.agentHeaders(owner));
 assert.equal((await complete(result())).status,409);
 await f.api('GET',null,`?action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=${TYPE}`,f.agentHeaders());
 assert.equal((await complete(result(),'excel2')).status,409);
 const bad=result();bad.samples[0].unit='t/day';assert.equal((await complete(bad)).status,400);
 const partial=result();partial.samples[0].qualityText='Bad';const success=await complete(partial);assert.equal(success.status,200,JSON.stringify(success));
 assert.equal(success.body.item.result.values.water_demi_avg,null);assert.equal(success.body.item.result.values.water_condensate_avg,1.123);
 const replay=await complete(partial);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
 assert.equal((await complete(result())).status,409);
 const get=await f.api('GET',null,`?action=${TYPE}&targetDate=${DAY}`);assert.equal(get.body.item.id,id);assert.equal(get.body.item.result.values.water_demi_avg,null);
 const reused=await f.api('POST',{requestType:TYPE,targetDate:DAY});assert.equal(reused.body.item.id,id);
 const fresh=await f.api('POST',{requestType:TYPE,targetDate:DAY,forceRefresh:true});assert.equal(fresh.status,201);assert.notEqual(fresh.body.item.id,id);
 assert.equal((await f.api('GET',null,`?action=${TYPE}&targetDate=${DAY}`)).body.item.id,id);
});
