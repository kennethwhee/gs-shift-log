import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as history } from '../functions/api/blower-history.js';
import { __oisDataRequestsTest as queue } from '../functions/api/ois-data-requests.js';
const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const EXTRA=['104HHL60AP611','104HHL60AP621','104HHL60AP631','204HHL60AP611','204HHL60AP621','204HHL60AP631','104HHL10AN611','104HHL10AN621','104HHL10AN631','204HHL10AN611','204HHL10AN621','204HHL10AN631'];
const OLD=['104ETH03AN601','104ETH03AN602','104ETG30AN601','104ETG30AN602','204ETG30AN601','204ETG30AN602','104SDF01AN001','104SDF01AN002','204SDF01AN001','204SDF01AN002','204LMDF01AN001'];
const NOW=new Date('2026-09-09T06:00:00Z'),FIXED='GSPOGE.ABB_DCS.003ETH03AN602XB04';
const asset=(tag,extra={})=>({tagNumber:tag,blowerType:tag.includes('HHL60')?'fbhe':'seal_pot',enabled:true,lastReplacementAt:'2026-08-01T00:00:00+09:00',cycleStartState:'legacy',cycleStoredStartedAt:'',cycleStartRevision:'s1',cycleRuntimeRevision:'r1',...extra});
const signal=(i)=>`GSPOGE.ABB_DCS.TEST_ONLY_FIELD_CONFIRMED_${i}`;

test('FBHE and Seal with missing RUN tags are explicit skips, never OIS tasks or inferred mappings',()=>{
 const p=core.plan(EXTRA.map(t=>asset(t)),NOW);
 assert.equal(p.tasks.length,0);assert.equal(p.skipped.length,12);
 assert.ok(p.skipped.every(x=>x.message.includes('RUN TAG')));
});
for(const [i,tag] of EXTRA.entries())test(`${tag}: exact confirmed RUN queue path replaces the OIS group`,async()=>{
 const p=core.plan([asset(tag,{dataParcTag:signal(i)})],NOW);assert.equal(p.tasks.length,1);assert.equal(p.tasks[0].kind,'dataparc');
 const calls=[];await core.executeDataParc(p.tasks[0],{api:async o=>{calls.push(o);return o.body.action==='create_blower_runtime_probe'?{item:{id:'q',status:'complete'}}:{message:'test'};}});
 assert.deepEqual(calls.map(o=>o.body.action),['create_blower_runtime_probe','dataparc_runtime_sync']);
 assert.equal(calls[0].body.dataParcTag,signal(i));assert.equal(calls[0].body.assetTag,tag);assert.equal(calls[0].body.expectedCycleRuntimeRevision,'r1');
});
for(const tag of [...OLD,...EXTRA])test(`${tag}: no wall-clock additions between successful binary queries`,()=>{
 const a={tag_number:tag,runtime_hours:42.5,is_running:1,runtime_anchor_at:'2026-09-08T06:00:00Z',cycle_runtime_hours:42.5,cycle_runtime_state:'running',cycle_runtime_anchor_at:'2026-09-08T06:00:00Z'};
 for(const fn of [history.currentRuntimeHours,history.runtimeHoursAt,history.cycleRuntimeHoursAt])assert.equal(fn(a,NOW),42.5);
});

test('persistent 503 after 296 logs keeps the exact failed page and enables confirmed-cycle runtime only',async()=>{
 const checkpoint={phase:'replacement',window:{fromDate:'2025-09-09',endDate:'2026-09-09',snapshotAt:NOW.toISOString()},cursor:{workDate:'2026-08-15',updatedAt:'',id:'row296'},limit:4,totals:{scannedReplacementLogs:296}};
 let current=checkpoint;const calls=[];
 const out=await core.refreshLogsForRuntime({assertWritable(){},checkpoint:c=>current=c,api:async o=>{calls.push(o);throw Object.assign(new Error('request failed'),{status:503,cfRay:'test-ray'});}},{resume:checkpoint,sleep:async()=>{}});
 assert.equal(out.complete,false);assert.equal(out.totals,null);assert.match(out.warning,/296건/);assert.match(out.warning,/2026-08-15/);assert.match(out.warning,/503/);assert.match(out.warning,/test-ray/);
 assert.equal(calls.length,5);assert.ok(calls.every(c=>c.body.cursor.id==='row296'));assert.equal(current.cursor.id,'row296');assert.equal(current.totals.scannedReplacementLogs,296);
 assert.ok(calls.every(c=>c.body.action==='latest_logs_step'));
});
for(const status of [400,401,403,409,422])test(`HTTP ${status} is not downgraded to partial success`,async()=>{
 let calls=0;await assert.rejects(()=>core.refreshLogsForRuntime({api:async()=>{calls++;throw Object.assign(new Error('stop'),{status});}},{sleep:async()=>{}}),e=>e.status===status);assert.equal(calls,1);
});
test('malformed bounded-page response cannot enable the runtime continuation',async()=>{
 await assert.rejects(()=>core.refreshLogsForRuntime({api:async()=>({ok:true,version:'wrong',done:true})},{sleep:async()=>{}}),e=>e.code==='INVALID_LOG_PAGE');
});
test('permissions lost during a retry still stop everything',async()=>{
 let allowed=true;await assert.rejects(()=>core.refreshLogsForRuntime({assertWritable(){if(!allowed)throw Object.assign(new Error('no access'),{code:'WRITE_ACCESS_CHANGED'});},api:async()=>{throw Object.assign(new Error('503'),{status:503});}},{sleep:async()=>{allowed=false;}}),e=>e.code==='WRITE_ACCESS_CHANGED');
});
test('successful log phase stays complete and clears its checkpoint',async()=>{
 let checkpoint='not-cleared';const calls=[];const out=await core.refreshLogsForRuntime({checkpoint:c=>checkpoint=c,api:async o=>{calls.push(o);return {ok:true,version:'bounded-logs-v1',phase:o.body.phase,done:true,window:{fromDate:'2025-09-09',endDate:'2026-09-09',snapshotAt:NOW.toISOString()},scannedLogCount:0,insertedCount:0,appliedStateChanges:0};}},{sleep:async()=>{}});
 assert.equal(out.complete,true);assert.equal(checkpoint,null);assert.equal(calls.length,2);assert.equal(out.totals.scannedReplacementLogs,0);
});
test('request-scoped fragment memoization reuses parsing without leaking across requests',()=>{
 const row={id:'same',status:'결재완료',role:'BCO1',work_date:'2026-09-08',log_json:JSON.stringify({entries:[{content:'#1 FBHE Blower #A V-Belt 교체 완료'}]})};
 const first=history.createLogFragmentReader([]),second=history.createLogFragmentReader([]);
 assert.equal(first(row),first(row));assert.notEqual(first(row),second(row));assert.deepEqual(first(row),second(row));
});
function d1(sql){return {prepare(text){return {args:[],bind(...args){this.args=args;return this;},async all(){return {results:sql.prepare(text).all(...this.args)};},async first(){return sql.prepare(text).get(...this.args)||null;},async run(){return {meta:{changes:Number(sql.prepare(text).run(...this.args).changes)}};}};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};}
test('additive V4 copies all eleven legacy intents intact and never restores retired reuse keys',async()=>{
 const sql=new DatabaseSync(':memory:');try{
  const source=readFileSync(new URL('../functions/api/ois-data-requests.js',import.meta.url),'utf8');
  const ddl=source.match(/CREATE TABLE IF NOT EXISTS blower_runtime_probe_intents_v3 \([\s\S]*?\n          \)/)[0];sql.exec(ddl);
  for(const [i,tag] of OLD.entries())sql.prepare('INSERT INTO blower_runtime_probe_intents_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('old'+i,'reuse'+i,1,tag,tag==='104ETH03AN602'?FIXED:signal(i),'2026-09-01T00:00:00+09:00','2026-09-09T00:00:00+09:00',31,1,'2026-08-01T00:00:00+09:00','legacy','','s1','r1','2026-09-09T00:00:00Z','2026-09-09T00:00:00Z');
  const before=sql.prepare('SELECT * FROM blower_runtime_probe_intents_v3 ORDER BY request_id').all();
  await queue.ensureBlowerRuntimeProbeSchema(d1(sql));
  assert.deepEqual(sql.prepare('SELECT * FROM blower_runtime_probe_intents_v4 ORDER BY request_id').all(),before);
  assert.deepEqual(sql.prepare('SELECT * FROM blower_runtime_probe_intents_v3 ORDER BY request_id').all(),before);
  sql.exec("UPDATE blower_runtime_probe_intents_v4 SET reuse_key=NULL WHERE request_id='old0'");
  await queue.ensureBlowerRuntimeProbeSchema(d1(sql));
  assert.equal(sql.prepare("SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id='old0'").get().reuse_key,null);
  assert.deepEqual(sql.prepare('SELECT * FROM blower_runtime_probe_intents_v3 ORDER BY request_id').all(),before);
  for(const tag of EXTRA) {sql.prepare("UPDATE blower_runtime_probe_intents_v4 SET asset_tag=? WHERE request_id='old0'").run(tag);assert.equal(sql.prepare("SELECT asset_tag FROM blower_runtime_probe_intents_v4 WHERE request_id='old0'").get().asset_tag,tag);}
  assert.throws(()=>sql.exec("UPDATE blower_runtime_probe_intents_v4 SET asset_tag='104HHL60AP612' WHERE request_id='old0'"),/CHECK constraint/);
  assert.throws(()=>sql.prepare("UPDATE blower_runtime_probe_intents_v4 SET dataparc_tag=? WHERE request_id='old0'").run(FIXED),/CHECK constraint/);
  assert.throws(()=>sql.exec("UPDATE blower_runtime_probe_intents_v3 SET asset_tag='104HHL60AP611' WHERE request_id='old0'"),/CHECK constraint/);
 }finally{sql.close();}
});
test('a failed log scan is visibly partial and refresh/history paths do not call OIS bridges',()=>{
 const s=readFileSync(new URL('../maintenance/blower-history.js',import.meta.url),'utf8');
 const refresh=s.slice(s.indexOf('  async function refreshAllBlowers()'),s.indexOf('  async function refreshFbheForUnified('));
 assert.match(refresh,/core\.refreshLogsForRuntime/);assert.match(refresh,/phase = "현황 확인";\s*await io.reload\(\);\s*const planned = core.plan/);
 assert.doesNotMatch(refresh,/executeOis|create_fbhe_vibration_batch|create_seal_pot_runtime_batch/);assert.match(refresh,/업무일지 확인 미완료/);assert.match(refresh,/partial \? "partial"/);
 const details=s.slice(s.indexOf('if (action === "runtime_query_settings")'),s.indexOf('if (action === "history_event_delete")'));
 assert.match(details,/openDataParcRuntimeDialog/);assert.doesNotMatch(details,/handleFbheVibrationQuery|BlowerSealPotDetails/);
});
