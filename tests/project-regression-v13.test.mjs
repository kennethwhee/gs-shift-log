import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { onRequestPost } from '../functions/api/morning-meeting-purge.js';

const date = '2026-09-20';
const otherDate = '2026-09-19';
const hash = value => createHash('sha256').update(value).digest('hex');
const body = () => ({ targetDate: date, expectedRevision: 4,
  confirmPermanentDelete: true, mode: 'selected_date_reset_delete_v2' });

// Real SQLite statements with D1's batch transaction semantics, including
// failures after DELETE. Hooks simulate another request before the transaction.
function database(t) {
  const raw = new DatabaseSync(':memory:');
  t.after(() => raw.close());
  raw.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY, name TEXT, role TEXT, is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT);
    CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY, target_date TEXT, request_type TEXT,
      status TEXT, expires_at TEXT, requested_at TEXT, result_json TEXT);
    CREATE TABLE morning_meeting_auto_history_overrides(target_date TEXT PRIMARY KEY,
      revision INTEGER, values_json TEXT, reset_active INTEGER, reset_at TEXT, reset_by_id TEXT,
      reset_by_name TEXT, reset_snapshot_values_json TEXT, reset_restored_at TEXT,
      updated_by_id TEXT, updated_by_name TEXT, updated_at TEXT);
    INSERT INTO users VALUES('test-user','검토 사용자','user',1),('disabled','중지 사용자','user',0);`);
  for (const [token, id, expiry] of [['valid', 'test-user', '2099-01-01'], ['disabled', 'disabled', '2099-01-01'],
    ['expired', 'test-user', '2000-01-01'], ['bad-date', 'test-user', 'invalid']]) {
    raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?)').run(hash(token), id, expiry);
  }
  for (const d of [date, otherDate]) raw.prepare(`INSERT INTO morning_meeting_auto_history_overrides
    VALUES(?,4,'{"water":123}',1,'before','owner','작성자','{"water":456}',NULL,'owner','작성자','before')`).run(d);
  for (const [id, d, type] of [['selected',date,'daily_data_excel'], ['selected-water',date,'water_environment'],
    ['other-day',otherDate,'daily_data_excel'], ['other-feature',date,'cofiring_period']]) {
    raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,\'completed\',NULL,\'before\',\'{"value":123}\')').run(id,d,type);
  }
  const db = { raw, writes: 0, beforeBatch: null, failSql: null,
    prepare(sql) { return { sql, args: [], bind(...args) { this.args=args; return this; },
      async first() { return raw.prepare(sql).get(...this.args) || null; },
      async all() { return { results: raw.prepare(sql).all(...this.args) }; },
      async run() { return execute(this); } }; },
    async batch(statements) {
      if (db.beforeBatch) { const hook=db.beforeBatch; db.beforeBatch=null; hook(); }
      raw.exec('BEGIN');
      try { const results=statements.map(execute); raw.exec('COMMIT'); return results; }
      catch(error) { raw.exec('ROLLBACK'); throw error; }
    }
  };
  function execute(statement) {
    if (db.failSql?.test(statement.sql)) throw new Error('SQL internal secret / injected write failure');
    if (/^\s*(UPDATE|INSERT|DELETE)\b/i.test(statement.sql)) {
      db.writes++;
      const result=raw.prepare(statement.sql).run(...statement.args);
      return {success:true,results:[],meta:{changes:Number(result.changes)}};
    }
    return {success:true,results:raw.prepare(statement.sql).all(...statement.args),meta:{changes:0}};
  }
  return db;
}
function snapshot(db) {
  return JSON.stringify({requests:db.raw.prepare('SELECT * FROM ois_data_requests ORDER BY id').all(),
    overrides:db.raw.prepare('SELECT * FROM morning_meeting_auto_history_overrides ORDER BY target_date').all()});
}
async function call(db,{payload=body(),token='valid',origin='https://review.invalid'}={}) {
  const request=new Request('https://review.invalid/api/morning-meeting-purge',{method:'POST',
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),Origin:origin},
    body:typeof payload==='string'?payload:JSON.stringify(payload)});
  const response=await onRequestPost({request,env:{DB:db}});
  return {status:response.status,payload:await response.json()};
}

test('selected-date purge authenticates and rejects malformed requests before any business writes',async t=>{
  const db=database(t), before=snapshot(db);
  for (const token of ['', 'unknown', 'disabled', 'expired', 'bad-date']) {
    assert.equal((await call(db,{token})).status,401);
  }
  for (const payload of ['{',null,[],{}, {...body(),confirmPermanentDelete:false},
    {...body(),targetDate:'2026-02-30'}, ...[undefined,null,'4','wrong',-1,0.5,Number.MAX_SAFE_INTEGER+1].map(expectedRevision=>({...body(),expectedRevision}))]) {
    assert.equal((await call(db,{payload})).status,400,JSON.stringify(payload));
  }
  assert.equal((await call(db,{origin:'https://other.invalid'})).status,403);
  assert.equal((await call(db,{payload:{...body(),expectedRevision:3}})).status,409);
  assert.equal(db.writes,0); assert.equal(snapshot(db),before);
});

test('confirmed purge deletes only selected-date meeting sources and clears reset state atomically',async t=>{
  const db=database(t);
  const other=db.raw.prepare('SELECT * FROM morning_meeting_auto_history_overrides WHERE target_date=?').get(otherDate);
  const response=await call(db);
  assert.equal(response.status,200); assert.equal(response.payload.deletedRows,2);
  assert.deepEqual(response.payload.deletedByType,{daily_data_excel:1,water_environment:1});
  assert.equal(response.payload.remainingRows,0); assert.equal(response.payload.revision,5);
  assert.deepEqual(db.raw.prepare('SELECT id FROM ois_data_requests ORDER BY id').all().map(x=>x.id),['other-day','other-feature']);
  assert.deepEqual(db.raw.prepare('SELECT * FROM morning_meeting_auto_history_overrides WHERE target_date=?').get(otherDate),other);
  const saved=db.raw.prepare('SELECT * FROM morning_meeting_auto_history_overrides WHERE target_date=?').get(date);
  assert.equal(saved.values_json,'{}'); assert.equal(saved.reset_snapshot_values_json,'{}');
  assert.equal(saved.reset_active,0); assert.equal(saved.revision,5); assert.equal(saved.updated_by_id,'test-user');
  assert.equal((await call(db)).status,409,'an old revision cannot repeat the purge');
});

test('a failure after DELETE rolls back both saved sources and reset state without SQL disclosure',async t=>{
  const db=database(t),before=snapshot(db);
  t.mock.method(console,'error',()=>{});
  db.failSql=/UPDATE morning_meeting_auto_history_overrides/;
  const response=await call(db);
  assert.equal(response.status,500); assert.equal(db.writes,1,'DELETE was reached before the injected failure');
  assert.equal(snapshot(db),before); assert.doesNotMatch(JSON.stringify(response.payload),/SQL|secret|injected|SELECT|UPDATE/);
});

test('a revision change immediately before the transaction preserves all rows and the newer edit',async t=>{
  const db=database(t); let current;
  db.beforeBatch=()=>{db.raw.prepare("UPDATE morning_meeting_auto_history_overrides SET revision=5,values_json='newer' WHERE target_date=?").run(date);current=snapshot(db);};
  const response=await call(db);
  assert.equal(response.status,409); assert.equal(response.payload.code,'MORNING_MEETING_PURGE_REVISION_CONFLICT');
  assert.equal(db.writes,0); assert.equal(snapshot(db),current);
});

test('a query starting immediately before the transaction blocks deletion of both old and new results',async t=>{
  const db=database(t);let current;
  db.beforeBatch=()=>{db.raw.prepare("INSERT INTO ois_data_requests VALUES('new-query',?,'daily_data_excel','processing',NULL,'now',NULL)").run(date);current=snapshot(db);};
  const response=await call(db);
  assert.equal(response.status,409);assert.equal(response.payload.code,'MORNING_MEETING_PURGE_QUERY_ACTIVE');
  assert.equal(snapshot(db),current);assert.equal(db.writes,0);
});

test('active selected-date queries block purge; active other dates and unrelated features remain untouched',async t=>{
  const db=database(t);
  db.raw.exec("UPDATE ois_data_requests SET status='processing',expires_at='2099-01-01'");
  const before=snapshot(db);
  assert.equal((await call(db)).status,409);assert.equal(snapshot(db),before);
  db.raw.prepare("UPDATE ois_data_requests SET expires_at='2000-01-01' WHERE target_date=? AND request_type!='cofiring_period'").run(date);
  assert.equal((await call(db)).status,200);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ois_data_requests').get().n,2);
});

test('appearance of an initially absent reset row is a conflict, while an unchanged absent row can be purged',async t=>{
  const db=database(t);
  db.raw.prepare('DELETE FROM morning_meeting_auto_history_overrides WHERE target_date=?').run(date);
  let current;
  db.beforeBatch=()=>{db.raw.prepare('INSERT INTO morning_meeting_auto_history_overrides(target_date,revision,values_json) VALUES(?,0,?)').run(date,'new value');current=snapshot(db);};
  assert.equal((await call(db,{payload:{...body(),expectedRevision:0}})).status,409);
  assert.equal(snapshot(db),current);
  db.raw.prepare('DELETE FROM morning_meeting_auto_history_overrides WHERE target_date=?').run(date);
  const response=await call(db,{payload:{...body(),expectedRevision:0}});
  assert.equal(response.status,200);assert.equal(response.payload.deletedRows,2);assert.equal(response.payload.overrideChanges,0);
});

test('concurrent purges from one saved revision yield one success and one conflict',async t=>{
  const db=database(t);
  const responses=await Promise.all([call(db),call(db)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal(db.raw.prepare('SELECT revision FROM morning_meeting_auto_history_overrides WHERE target_date=?').get(date).revision,5);
});

test('reviewed current browser helpers are loaded once with a cache key and an existing source file',()=>{
  const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for (const asset of ['maintenance/cofiring-period-ui-v5.js',
    'maintenance/morning-meeting-query-sources.js','maintenance/morning-meeting-permanent-purge-v1.js']) {
    const scripts=[...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(m=>m[1]);
    const matches=scripts.filter(src=>src.split('?')[0].replace(/^\//,'')===asset);
    assert.equal(matches.length,1,asset);assert.match(matches[0],/\?v=[^\s<>]+$/);
    assert.ok(existsSync(new URL('../'+asset,import.meta.url)),asset);
  }
});
