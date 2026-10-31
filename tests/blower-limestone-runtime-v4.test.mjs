import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const core=require('../maintenance/blower-unified-refresh.js');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const history=read('functions/api/blower-history.js');
const queue=read('functions/api/ois-data-requests.js');
const agent=read('local-tools/ois-agent/ois-login.js');
const ui=read('maintenance/blower-history.js');
const schedule=read('maintenance/blower-schedule-v1.js');
const scheduleApi=read('functions/_shared/blower-schedule-v1.js');
const html=read('maintenance/blower-history.html');
const tags=['103HRJ01AN601','103HRJ01AN602','203HRJ01AN601','203HRJ01AN602'];
const signals=Object.fromEntries(tags.map(t=>[t,`GSPOGE.ABB_DCS.${t}XB04`]));
const current=(tag,at)=>({tagNumber:tag,blowerType:'limestone',displayName:tag,enabled:true,
 lastReplacementAt:at,cycleStartState:'pending',cycleStartedAt:'',cycleStoredStartedAt:'',
 cycleStartRevision:'s1',cycleRuntimeRevision:'r1',dataParcTag:'',limestoneSignalCandidate:signals[tag]});
const now=new Date('2026-10-29T04:00:00Z');
test('Limestone equipment -> DataPARC source is exact, four unique pairs and never /PLOT',()=>{
 for(const t of tags){assert.match(history,new RegExp(`"${t}": "GSPOGE\\.ABB_DCS\\.${t}XB04"`));
   assert.match(queue,new RegExp(`'${t}':'GSPOGE\\.ABB_DCS\\.${t}XB04'`));
   assert.match(agent,new RegExp(`"${t}"`));}
 assert.equal(new Set(Object.values(signals)).size,4);
 for(const v of Object.values(signals))assert.doesNotMatch(v,/\/PLOT/);
});
test('D1 request schema V5 is additive, retained historical V4 and 27-device bounds are aligned',()=>{
 assert.match(queue,/CREATE TABLE IF NOT EXISTS blower_runtime_probe_intents_v4/);
 assert.match(queue,/CREATE TABLE IF NOT EXISTS blower_runtime_probe_intents_v5/);
 assert.match(queue,/INSERT OR IGNORE INTO blower_runtime_probe_intents_v5\s+SELECT \* FROM blower_runtime_probe_intents_v4/);
 assert.match(queue,/const MAXIMUM_STATUS_BATCH_IDS =\s*27;/);
 assert.match(queue,/const MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_CLAIMS =\s*26;/);
 assert.match(queue,/function isValidBlowerRuntimeProbeMapping\(assetTag, dataParcTag\)/);
 assert.match(queue,/dataParcTag !== LIMESTONE_RUNTIME_EXACT_PAIR_V4\[assetTag\]/);
 assert.match(history,/dataParcTag !== LIMESTONE_RUN_SIGNAL_CANDIDATES\[assetTag\]/);
});
test('V5 accepted intent is reconciled first, older V4/V3/V2 receipts remain readable',()=>{
 const expected='for (const table of ["blower_runtime_probe_intents_v5", "blower_runtime_probe_intents_v4", "blower_runtime_probe_intents_v3", "blower_runtime_probe_intents_v2"])';
 assert.ok(history.includes(expected),'new V5 completions must be matched against V5 persisted intent');
 assert.ok(history.indexOf('blower_runtime_probe_intents_v5',history.indexOf('async function loadDataParcRuntimeSyncIntent')) > 0);
});
test('cold D1 schema keeps historical tables and real index, without redundant archived index bootstrap',()=>{
 for(const v of [2,3,4]) {
   assert.match(queue,new RegExp('CREATE TABLE IF NOT EXISTS blower_runtime_probe_intents_v'+v));
   assert.doesNotMatch(queue,new RegExp('CREATE INDEX IF NOT EXISTS\\s+idx_blower_runtime_probe_intents_v'+v+'_asset_revision'));
 }
 assert.match(queue,/CREATE INDEX IF NOT EXISTS idx_blower_runtime_probe_intents_v5_asset_revision/);
 assert.doesNotMatch(queue,/DROP\s+(?:INDEX|TABLE)/i);
});
test('Agent keeps its existing poll value and 27 read-only Excel request contract',()=>{
 assert.match(agent,/const BLOWER_RUNTIME_PROBE_BATCH_MAX_REQUESTS =\s*27;/);
 assert.match(agent,/\$rawProbes\.Count -gt 27/);
 assert.equal((agent.match(/"103HRJ01AN601"/g)||[]).length,3);
 assert.match(agent,/(?:const\s+OIS_AGENT_POLL_INTERVAL\s*=\s*\d+|pollInterval)/i);
});
test('disputed 9/22 and 9/19 cycles only allow a bounded preview while 1A retains normal sync',()=>{
 const plan=core.plan([
  current('103HRJ01AN601','2026-09-18T14:20:00+09:00'),
  current('103HRJ01AN602','2026-09-22T00:00:00+09:00'),
  current('203HRJ01AN601','2026-02-24T13:45:00+09:00'),
  current('203HRJ01AN602','2026-09-22T00:00:00+09:00')],now);
 assert.equal(plan.targetCount,4);
 assert.deepEqual(plan.tasks.map(t=>t.asset.tagNumber),tags);
 assert.equal(plan.tasks[0].dataParcTag,signals['103HRJ01AN601']);
 assert.equal(plan.tasks[0].previewOnly,undefined);
 assert.equal(plan.skipped.length,0);
 for(const task of plan.tasks.slice(1)) {
   assert.equal(task.previewOnly,true);
   assert.equal(task.incremental,false);
   assert.equal(Date.parse(task.startAt),now.getTime()-86400000);
 }
});
test('once actual replacement moment is corrected, original A/B identities may become eligible',()=>{
 const plan=core.plan([
  current('103HRJ01AN602','2026-09-22T10:15:00+09:00'),
  current('203HRJ01AN601','2026-09-19T14:20:00+09:00'),
  current('203HRJ01AN602','2026-09-22T09:15:00+09:00')],now);
 assert.deepEqual(plan.tasks.map(t=>t.asset.tagNumber),tags.slice(1));
 assert.equal(plan.skipped.length,0);
});
test('current 23-device baseline remains an independent valid plan',()=>{
 const valid={tagNumber:'104HHL60AP611',blowerType:'fbhe',displayName:'original',enabled:true,
 lastReplacementAt:'2026-09-01T00:00:00+09:00',cycleStartState:'legacy',
 cycleStartedAt:'',cycleStartRevision:'x',cycleRuntimeRevision:'y',
 dataParcTag:'GSPOGE.ABB_DCS.104HHL60AP611XB04'};
 const p=core.plan([valid],now);assert.equal(p.tasks.length,1);assert.equal(p.skipped.length,0);
});
test('27 device receipts and browser checkpoint can be re-read',()=>{
 assert.match(schedule,/value\.requestedCount > 27/);
 assert.match(scheduleApi,/receipt\.requestedCount > 27/);
 assert.match(ui,/value\.tasks\.length > 27/);
 assert.match(ui,/"103HRJ01AN601"/);
 assert.match(html,/blower-unified-refresh\.js\?v=20261031-limestone-preview-v3f/);
});
test('status reads remain paged at 24 IDs: no increased single HTTP status payload',()=>{
 assert.match(read('maintenance/blower-unified-refresh.js'),/ids\.length; index \+= 24/);
});
test('SQLite V5 migration preserves historical V4 intent rows without rewriting them',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 const ddl=version=>{
  const from=queue.indexOf('CREATE TABLE IF NOT EXISTS blower_runtime_probe_intents_v'+version+' (');
  assert.ok(from>0);
  const end=queue.indexOf('`),',from);
  assert.ok(end>from);
  return queue.slice(from,end);
 };
 try{
   db.exec(ddl(4)); db.exec(ddl(5));
   const source=(await db.prepare('PRAGMA table_info(blower_runtime_probe_intents_v4)').all());
   assert.ok(source.length>=10);
   const columns=source.map(v=>v.name);
   const row=Object.fromEntries(columns.map(k=>[k,'']));
   Object.assign(row,{
     request_id:'before-v5',schema_version:1,asset_tag:'104HHL60AP611',
     dataparc_tag:'GSPOGE.ABB_DCS.104HHL60AP611XB04',chunk_days:31,chunk_count:1,
     expected_cycle_start_state:'legacy',reuse_key:null
   });
   const values=columns.map(k=>row[k]);
   db.prepare(`INSERT INTO blower_runtime_probe_intents_v4 (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...values);
   db.exec('INSERT OR IGNORE INTO blower_runtime_probe_intents_v5 SELECT * FROM blower_runtime_probe_intents_v4');
   const existing=db.prepare('SELECT request_id,asset_tag FROM blower_runtime_probe_intents_v5').get();
   assert.equal(existing.request_id,'before-v5'); assert.equal(existing.asset_tag,'104HHL60AP611');
   const insertNew=db.prepare(`INSERT INTO blower_runtime_probe_intents_v5 (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
   insertNew.run(...columns.map(k=>k==='request_id'?'new-limestone':k==='asset_tag'?'103HRJ01AN601':row[k]));
   assert.equal(db.prepare('SELECT count(*) AS n FROM blower_runtime_probe_intents_v5').get().n,2);
   assert.equal(db.prepare('SELECT count(*) AS n FROM blower_runtime_probe_intents_v4').get().n,1);
 } finally {db.close();}
});
