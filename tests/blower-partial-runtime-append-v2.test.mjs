import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
import { verifiedAppendBase, cycleRuntimeCoverage } from '../functions/_shared/blower-incremental.js';
import { REVIEWED_CYCLE_SOURCE_CASES } from '../functions/_shared/blower-cycle-source-review.js';

const BASE_END = '2026-11-02T15:00:25.000Z';
const NEXT_END = '2026-11-02T16:00:25.000Z';
const COLLECTED = '2026-11-02T16:00:30.000Z';
const NOW = new Date('2026-11-02T16:01:00.000Z');
const OWNER = { employeeNo: 'partial-owner', name: 'Partial Range Owner' };
const CASES = [
  ['104ETH03AN602','2026-05-04T00:00:00+09:00','2026-05-10T00:00:00+09:00','legacy'],
  ['104HHL10AN611','2026-08-03T00:00:00+09:00','2026-08-03T09:15:00+09:00','legacy'],
  ['104HHL60AP611','2026-09-04T00:00:00+09:00','2026-09-04T10:50:00+09:00','legacy'],
  ['104SDF01AN001','2026-08-20T00:00:00+09:00','2026-08-20T11:00:00+09:00','started'],
  ['204HHL10AN611','2026-05-11T00:00:00+09:00','2026-05-18T18:00:00+09:00','legacy'],
  ['204HHL10AN631','2026-05-11T00:00:00+09:00','2026-05-11T18:00:00+09:00','legacy'],
  ['204HHL60AP631','2026-09-16T00:00:00+09:00','2026-09-16T09:30:00+09:00','pending']
];
const signalFor = tag => tag === '104ETH03AN602' ? 'GSPOGE.ABB_DCS.003ETH03AN602XB04'
  : `GSPOGE.ABB_DCS.TEST_ONLY_BINARY_${tag}`;
function d1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = { sqlite, beforeBatch: null, prepare(text) { return { values: [], bind(...values) { this.values = values; return this; },
    async first() { return sqlite.prepare(text).get(...this.values) || null; },
    async all() { return { results: sqlite.prepare(text).all(...this.values) }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(text).run(...this.values).changes) } }; } }; },
    async batch(statements) { if (db.beforeBatch) { const hook = db.beforeBatch; db.beforeBatch = null; hook(sqlite); }
      sqlite.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  return db;
}
function insertEvent(sql, record) {
  const row = { issue_type: '', action_type: '', note: '', source_log_id: '', source_text: '',
    created_by_id: OWNER.employeeNo, created_by_name: OWNER.name, ...record };
  const keys = Object.keys(row);
  sql.prepare(`INSERT INTO blower_history_events(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(row));
}

async function fixture({ item = CASES[2], delta = 1799, endState = 'running', review = null } = {}) {
  const [tag, replacement, coverageStart, state] = item;
  const db = d1(), sql = db.sqlite;
  await api.ensureSchema(db);
  const signal = signalFor(tag), baseSeconds = 3601;
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state=?,cycle_started_at=?,
    cycle_start_revision='start-r1',cycle_runtime_revision='runtime-r2',cycle_runtime_hours=?,runtime_hours=?,
    cycle_runtime_anchor_at=?,cycle_runtime_state='running',runtime_anchor_at=?,is_running=1 WHERE tag_number=?`)
    .run(replacement,state,state === 'started' ? replacement : null,baseSeconds/3600,baseSeconds/3600,BASE_END,BASE_END,tag);
  const baseSource = { schemaVersion: 1, requestType: 'blower_runtime_probe', requestId: 'partial-base',
    assetTag: tag, dataParcTag: signal, startAt: coverageStart, endAt: BASE_END, observedAt: BASE_END,
    expectedLastReplacementAt: replacement, expectedCycleStartState: state === 'pending' ? 'legacy' : state,
    expectedCycleStartedAt: state === 'started' ? replacement : '', expectedCycleStartRevision: 'start-r1',
    expectedCycleRuntimeRevision: 'runtime-r1', startState: 'stopped', endState: 'running',
    runningSeconds: baseSeconds, totalRunningHours: baseSeconds/3600, chunkCount: 1, collectedAt: BASE_END,
    ...(state === 'pending' ? { signalOnlyCycle: true } : {}) };
  const baseEventId = 'dataparc_runtime:partial-base';
  insertEvent(sql, { id: baseEventId, tag_number: tag, event_type: 'runtime_correction', event_date: BASE_END,
    runtime_hours: baseSeconds/3600, source_type: 'dataparc_runtime', source_log_id: baseSource.requestId,
    source_text: JSON.stringify(baseSource), created_at: BASE_END, updated_at: BASE_END });
  if (review) insertEvent(sql, { id: review.replacementEventId, tag_number: tag, event_type: 'replacement',
    event_date: review.recordedReplacementAt, runtime_hours: 0, source_type: review.sourceType,
    source_log_id: review.sourceLogId, source_text: review.storedSourceText,
    created_at: review.recordedReplacementAt, updated_at: review.recordedReplacementAt });
  sql.exec(`CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,status TEXT,target_date TEXT,
      requested_by_id TEXT,result_json TEXT,completed_at TEXT);
    CREATE TABLE blower_runtime_probe_intents_v4(request_id TEXT PRIMARY KEY,schema_version INTEGER,asset_tag TEXT,
      dataparc_tag TEXT,window_start TEXT,window_end TEXT,chunk_days INTEGER,chunk_count INTEGER,
      expected_last_replacement_at TEXT,expected_cycle_start_state TEXT,expected_cycle_started_at TEXT,
      expected_cycle_start_revision TEXT,expected_cycle_runtime_revision TEXT);
    CREATE TABLE blower_runtime_append_v1(request_id TEXT PRIMARY KEY,base_event_id TEXT,base_revision TEXT,
      base_observed_at TEXT,coverage_start_at TEXT,base_running_seconds INTEGER,created_at TEXT)`);
  function store(requestId = 'partial-append', changes = {}) {
    const raw = { schemaVersion: 1, requestType: 'blower_runtime_probe', requestId, ok: true, readOnly: true,
      assetTag: tag, dataParcTag: signal, startAt: BASE_END, endAt: NEXT_END, observedAt: NEXT_END,
      expectedLastReplacementAt: replacement, expectedCycleStartState: state === 'pending' ? 'legacy' : state,
      expectedCycleStartedAt: state === 'started' ? replacement : '',
      expectedCycleStartRevision: state === 'pending' ? 'signal-only-v1:start-r1' : 'start-r1',
      expectedCycleRuntimeRevision: 'append-v1:runtime-r2', startState: 'running', endState,
      runningSeconds: delta, totalRunningHours: delta/3600, chunkDays: 31, chunkCount: 1, completedChunkCount: 1,
      collectedAt: COLLECTED, ...changes };
    raw.chunks = [{ index: 1, startAt: raw.startAt, endAt: raw.endAt, startState: raw.startState,
      endState: raw.endState, runningSeconds: raw.runningSeconds, totalRunningHours: raw.totalRunningHours }];
    sql.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?)').run(requestId,raw.requestType,'complete',
      `v1|${tag}|${raw.startAt}|${raw.endAt}`,OWNER.employeeNo,JSON.stringify(raw),raw.collectedAt);
    sql.prepare('INSERT INTO blower_runtime_probe_intents_v4 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId,1,tag,signal,
      raw.startAt,raw.endAt,31,1,replacement,raw.expectedCycleStartState,raw.expectedCycleStartedAt,
      raw.expectedCycleStartRevision,raw.expectedCycleRuntimeRevision);
    sql.prepare('INSERT INTO blower_runtime_append_v1 VALUES(?,?,?,?,?,?,?)').run(requestId,baseEventId,'runtime-r2',
      BASE_END,coverageStart,baseSeconds,BASE_END);
    return raw;
  }
  const raw = store();
  const asset = () => sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  const events = () => sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY created_at DESC,event_date DESC,id DESC').all(tag);
  const snapshot = () => JSON.stringify(['blower_history_assets','blower_history_events','blower_history_asset_history',
    'ois_data_requests','blower_runtime_probe_intents_v4','blower_runtime_append_v1'].map(table => sql.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
  const apply = async (requestId = raw.requestId) => { const response = await api.applyDataParcRuntimeSync(db,OWNER,{requestId},{now:NOW});
    return { status: response.status, body: await response.json() }; };
  const project = async () => (await api.loadAssetStates(db,{ [asset().blower_type]: { cycleDays:90,warningDays:7,criticalDays:3 } },
    { assetRows:[asset()],skipDecorations:true }))[0];
  return { db,sql,tag,signal,baseSeconds,baseEventId,baseSource,raw,store,asset,events,snapshot,apply,project,coverageStart,replacement };
}

for (const item of CASES) test(`${item[0]}: trusted partial range appends measured seconds once without promoting its belt basis`, async t => {
  const f = await fixture({item}); t.after(() => f.sql.close());
  const before = f.asset(), original = f.events();
  const base = verifiedAppendBase(before,original,f.signal);
  assert.equal(base.coverageComplete,false);
  const initial = await f.project();
  assert.equal(initial.dataParcRuntimeBasis.appendReady,true);
  assert.equal(initial.severity,'runtime_unknown');
  const applied = await f.apply();
  assert.equal(applied.status,200,JSON.stringify(applied.body));
  assert.equal(applied.body.incremental,true);
  assert.equal(applied.body.runtimeHours,(3601+1799)/3600);
  const after = f.asset();
  for (const key of ['last_replacement_at','cycle_started_at','cycle_start_state','cycle_start_revision']) assert.equal(after[key],before[key]);
  for (const event of original) assert.deepEqual(f.events().find(row => row.id===event.id),event);
  const saved = await f.project(), basis = saved.dataParcRuntimeBasis;
  assert.equal(basis.coverageComplete,false);
  assert.equal(basis.appendReady,true);
  assert.equal(basis.runningSeconds,5400);
  assert.equal(Date.parse(basis.startAt),Date.parse(f.coverageStart));
  assert.equal(Date.parse(basis.observedAt),Date.parse(NEXT_END));
  assert.equal(basis.missingLeadingSeconds,cycleRuntimeCoverage(before,f.coverageStart).missingLeadingSeconds);
  assert.equal(saved.runtimeHours,1.5);
  assert.equal(saved.cycleElapsedHours,1.5);
  assert.equal(saved.remainingHours,null);
  assert.equal(saved.progressPct,null);
  assert.equal(saved.severity,'runtime_unknown');
  const snapshot = f.snapshot(), changes=f.sql.prepare('SELECT total_changes() n').get().n;
  const replay = await f.apply();
  assert.equal(replay.status,200,JSON.stringify(replay.body));
  assert.equal(replay.body.replayed,true);
  assert.equal(f.snapshot(),snapshot);
  assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,changes);
});

test('a zero-RUN partial append advances its endpoint and state without erasing the tracked total', async t => {
  const f=await fixture({delta:0,endState:'stopped'});t.after(()=>f.sql.close());
  const out=await f.apply();assert.equal(out.status,200,JSON.stringify(out.body));
  assert.equal(f.asset().cycle_runtime_hours,f.baseSeconds/3600);
  assert.equal(f.asset().cycle_runtime_state,'stopped');
  assert.equal(f.asset().cycle_runtime_anchor_at,NEXT_END);
  assert.equal((await f.project()).dataParcRuntimeBasis.coverageComplete,false);
});

for (const [label, mutate] of [
  ['missing server receipt',f=>f.sql.prepare('DELETE FROM blower_runtime_append_v1').run()],
  ['invented cumulative seconds',f=>f.sql.prepare('UPDATE blower_runtime_append_v1 SET base_running_seconds=base_running_seconds+1').run()],
  ['widened coverage to midnight',f=>f.sql.prepare('UPDATE blower_runtime_append_v1 SET coverage_start_at=?').run(f.replacement)],
  ['different predecessor event',f=>f.sql.prepare("UPDATE blower_runtime_append_v1 SET base_event_id='dataparc_runtime:invented'").run()],
  ['different predecessor revision',f=>f.sql.prepare("UPDATE blower_runtime_append_v1 SET base_revision='changed'").run()],
  ['changed current revision',f=>f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='changed' WHERE tag_number=?").run(f.tag)],
  ['changed stored total',f=>f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=2,runtime_hours=2 WHERE tag_number=?').run(f.tag)],
  ['changed replacement',f=>f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run('2026-09-05T00:00:00+09:00',f.tag)],
  ['untrusted prior RUN signal',f=>{const s={...f.baseSource,dataParcTag:'GSPOGE.ABB_DCS.OTHER_SIGNAL'};f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(s),f.baseEventId);}]
]) test(`${label} cannot append or overwrite any preserved partial evidence`,async t=>{
  const f=await fixture();t.after(()=>f.sql.close());mutate(f);
  const before=f.snapshot(),changes=f.sql.prepare('SELECT total_changes() n').get().n;
  const out=await f.apply();assert.equal(out.status,409,JSON.stringify(out.body));
  assert.equal(f.snapshot(),before);
  assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,changes);
});

test('a client-supplied incremental object without a server receipt cannot authorize a fresh partial sync',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());
  const raw={...f.raw,startAt:'2026-11-02T14:00:25.000Z',expectedCycleRuntimeRevision:'runtime-r2',
    incremental:{version:1,coverageStartAt:f.coverageStart,totalRunningSeconds:999999}};
  raw.chunks=[{...f.raw.chunks[0],startAt:raw.startAt}];
  f.sql.prepare('UPDATE ois_data_requests SET target_date=?,result_json=?').run(`v1|${f.tag}|${raw.startAt}|${raw.endAt}`,JSON.stringify(raw));
  f.sql.prepare('UPDATE blower_runtime_probe_intents_v4 SET window_start=?,expected_cycle_runtime_revision=?').run(raw.startAt,'runtime-r2');
  f.sql.prepare('DELETE FROM blower_runtime_append_v1').run();
  const before=f.snapshot(),out=await f.apply();
  assert.equal(out.status,409,JSON.stringify(out.body));
  assert.equal(out.body.code,'DATAPARC_RUNTIME_FULL_CYCLE_REQUIRED');
  assert.equal(f.snapshot(),before);
});

test('a partial append with a different RUN boundary is rejected without adding its seconds',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());
  const raw={...f.raw,startState:'stopped',chunks:[{...f.raw.chunks[0],startState:'stopped'}]};
  f.sql.prepare('UPDATE ois_data_requests SET result_json=?').run(JSON.stringify(raw));
  const before=f.snapshot(),out=await f.apply();
  assert.equal(out.body.code,'DATAPARC_APPEND_BOUNDARY_CHANGED');
  assert.equal(f.snapshot(),before);
});

test('two completed requests pinned to the same partial predecessor cannot add twice',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());f.store('competing-append');
  assert.equal((await f.apply()).status,200);
  const before=f.snapshot(),out=await f.apply('competing-append');
  assert.equal(out.status,409,JSON.stringify(out.body));
  assert.equal(f.snapshot(),before);
  assert.equal(f.asset().cycle_runtime_hours,1.5);
});

test('a concurrent manual edit at the write boundary survives the partial-append CAS',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());
  f.db.beforeBatch=sql=>sql.prepare(`UPDATE blower_history_assets SET cycle_runtime_revision='concurrent',
    cycle_runtime_hours=99,runtime_hours=99 WHERE tag_number=?`).run(f.tag);
  const out=await f.apply();assert.equal(out.status,409,JSON.stringify(out.body));
  assert.equal(f.asset().cycle_runtime_hours,99);
  assert.equal(f.asset().cycle_runtime_revision,'concurrent');
  assert.equal(f.events().some(event=>event.source_log_id===f.raw.requestId),false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
});

for(const review of REVIEWED_CYCLE_SOURCE_CASES)for(const complete of [false,true])test(`${review.tagNumber}: reviewed wrong-source warning survives ${complete?'complete':'partial'} range append without mutating maintenance evidence`,async t=>{
  const start=complete?review.recordedReplacementAt:new Date(Date.parse(review.recordedReplacementAt)+3600000).toISOString();
  const f=await fixture({item:[review.tagNumber,review.recordedReplacementAt,start,'legacy'],review});t.after(()=>f.sql.close());
  const original=f.events().find(event=>event.id===review.replacementEventId),beforeAsset=f.asset();
  const first=await f.project();
  assert.equal(first.cycleSourceReview.code,'REVIEWED_REPLACEMENT_SOURCE_MISATTRIBUTED');
  assert.equal(first.actualLastReplacementAt,'');
  assert.equal(first.cycleBasisKind,'replacement_source_review');
  assert.equal(first.lastReplacementAt,beforeAsset.last_replacement_at);
  assert.equal(first.dataParcRuntimeBasis.cycleBasisConfirmed,false);
  assert.equal(first.dataParcRuntimeBasis.coverageComplete,complete);
  assert.equal(first.dataParcRuntimeBasis.appendReady,true);
  assert.equal(first.remainingHours,null);
  assert.equal(first.severity,'runtime_unknown');
  const out=await f.apply();assert.equal(out.status,200,JSON.stringify(out.body));
  const after=await f.project();
  assert.equal(after.runtimeHours,1.5);
  assert.equal(after.cycleSourceReview.code,first.cycleSourceReview.code);
  assert.equal(after.actualLastReplacementAt,'');
  assert.equal(after.cycleBasisKind,'replacement_source_review');
  assert.equal(after.lastReplacementAt,beforeAsset.last_replacement_at);
  assert.equal(after.dataParcRuntimeBasis.cycleBasisConfirmed,false);
  assert.equal(after.dataParcRuntimeBasis.coverageComplete,complete);
  assert.equal(after.dataParcRuntimeBasis.appendReady,true);
  assert.equal(after.remainingHours,null);
  assert.equal(after.progressPct,null);
  assert.equal(after.severity,'runtime_unknown');
  assert.equal(f.asset().last_replacement_at,beforeAsset.last_replacement_at);
  assert.equal(f.asset().cycle_start_revision,beforeAsset.cycle_start_revision);
  assert.deepEqual(f.events().find(event=>event.id===review.replacementEventId),original);
});
