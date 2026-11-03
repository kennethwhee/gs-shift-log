import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { cycleRuntimeCoverage, verifiedAppendBase, incrementalEvidence } from '../functions/_shared/blower-incremental.js';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';

const TAGS = ['103HRJ01AN601','103HRJ01AN602','104ETG30AN601','104ETG30AN602',
  '104ETH03AN601','104ETH03AN602','104HHL10AN611','104HHL10AN621','104HHL10AN631',
  '104HHL60AP611','104HHL60AP621','104HHL60AP631','104SDF01AN001','104SDF01AN002',
  '203HRJ01AN601','203HRJ01AN602','204ETG30AN601','204ETG30AN602','204HHL10AN611',
  '204HHL10AN621','204HHL10AN631','204HHL60AP611','204HHL60AP621','204HHL60AP631',
  '204LMDF01AN001','204SDF01AN001','204SDF01AN002'];
const REPLACEMENT = '2026-10-01T00:00:00.000Z';
const STARTUP = '2026-10-01T01:00:00.000Z';
const END = '2026-10-02T00:00:00.000Z';
const NOW = new Date('2026-10-02T00:01:00.000Z');
const signalFor = tag => tag === '104ETH03AN602' ? 'GSPOGE.ABB_DCS.003ETH03AN602XB04'
  : /^(?:103|203)HRJ/.test(tag) ? `GSPOGE.ABB_DCS.${tag}XB04` : `GSPOGE.ABB_DCS.TEST_ONLY_BINARY_${tag}`;

function measured(tag, { state = 'legacy', replacement = REPLACEMENT, startup = STARTUP,
  coverageStart = state === 'started' ? startup : replacement, end = END } = {}) {
  const asset = { tag_number: tag, last_replacement_at: replacement,
    cycle_start_state: state, cycle_started_at: state === 'started' ? startup : null,
    cycle_start_revision: 'start-r1', cycle_runtime_revision: 'runtime-r2',
    cycle_runtime_hours: 3601 / 3600, runtime_hours: 3601 / 3600,
    cycle_runtime_anchor_at: end, cycle_runtime_state: 'running' };
  const source = { schemaVersion: 1, requestType: 'blower_runtime_probe', requestId: 'coverage-seed',
    assetTag: tag, dataParcTag: signalFor(tag), startAt: coverageStart, endAt: end, observedAt: end,
    expectedLastReplacementAt: replacement, expectedCycleStartState: state === 'pending' ? 'legacy' : state,
    expectedCycleStartedAt: state === 'started' ? startup : '', expectedCycleStartRevision: 'start-r1',
    expectedCycleRuntimeRevision: 'runtime-r1', startState: 'stopped', endState: 'running',
    runningSeconds: 3601, totalRunningHours: 3601 / 3600, chunkCount: 1, collectedAt: end,
    ...(state === 'pending' ? { signalOnlyCycle: true } : {}) };
  const row = { id: 'dataparc_runtime:coverage-seed', tag_number: tag, event_type: 'runtime_correction',
    event_date: end, runtime_hours: asset.cycle_runtime_hours, source_type: 'dataparc_runtime',
    source_log_id: source.requestId, source_text: JSON.stringify(source), issue_type: 'DataPARC',
    action_type: 'DataPARC 운전중 동기화', note: '', created_at: end, updated_at: end };
  return { asset, source, row };
}

// These timestamp relationships reproduce the seven leading-range omissions in
// the read-only audit. Their test totals are synthetic; no RUN time is inferred.
// Historical case names stay stable for baseline comparison. V2 permits only
// server-owned tracked-range appends; these receipts remain partial, never a
// certificate of the complete V-Belt cycle or permission for a fresh partial sync.
const GAPS = [
  ['104ETH03AN602','2026-05-04T00:00:00+09:00','2026-05-09T15:00:00.000Z',144 * 3600],
  ['104HHL10AN611','2026-08-03T00:00:00+09:00','2026-08-03T00:15:00.000Z',9.25 * 3600],
  ['104HHL60AP611','2026-09-04T00:00:00+09:00','2026-09-04T01:50:00.000Z',(10 + 50 / 60) * 3600],
  ['104SDF01AN001','2026-08-20T00:00:00+09:00','2026-08-20T02:00:00.000Z',11 * 3600,'started'],
  ['204HHL10AN611','2026-05-11T00:00:00+09:00','2026-05-18T09:00:00.000Z',186 * 3600],
  ['204HHL10AN631','2026-05-11T00:00:00+09:00','2026-05-11T09:00:00.000Z',18 * 3600],
  ['204HHL60AP631','2026-09-16T00:00:00+09:00','2026-09-16T00:30:00.000Z',9.5 * 3600]
];

for (const [tag, replacement, start, gap, state = 'legacy'] of GAPS) {
  test(`${tag}: a leading gap remains visible and cannot become an append base`, () => {
    const f = measured(tag, { replacement, coverageStart: start, state, startup: replacement,
      end: '2026-11-02T15:00:25.000Z' });
    const before = JSON.stringify(f);
    assert.deepEqual(cycleRuntimeCoverage(f.asset, start), { complete: false,
      requiredStartAt: replacement, coverageStartAt: start, missingLeadingSeconds: gap });
    const base = verifiedAppendBase(f.asset, [f.row], f.source.dataParcTag);
    assert.equal(base.coverageComplete, false);
    assert.equal(base.startAt, start);
    assert.equal(base.missingLeadingSeconds, gap);
    const basis = api.currentDataParcRuntimeBasis(f.asset, [f.row]);
    assert.equal(basis.runtimeHours, f.asset.cycle_runtime_hours);
    assert.equal(basis.startAt, start);
    assert.equal(basis.observedAt, f.source.observedAt);
    assert.equal(basis.coverageComplete, false);
    assert.equal(basis.requiredStartAt, replacement);
    assert.equal(basis.missingLeadingSeconds, gap);
    assert.equal(basis.appendReady, true);
    assert.equal(JSON.stringify(f), before, 'projection and append checks preserve stored evidence');
  });
}

test('all 27 Blowers retain full recorded-baseline append behavior, including pending signal-only cycles', () => {
  for (const tag of TAGS) for (const state of ['legacy','pending','started']) {
    const f = measured(tag, { state });
    assert.equal(cycleRuntimeCoverage(f.asset, f.source.startAt).complete, true, `${tag}/${state}`);
    assert.equal(verifiedAppendBase(f.asset, [f.row], f.source.dataParcTag)?.runningSeconds, 3601, `${tag}/${state}`);
    const basis = api.currentDataParcRuntimeBasis(f.asset, [f.row]);
    assert.equal(basis.coverageComplete, true, `${tag}/${state}`);
    assert.equal(basis.appendReady, true, `${tag}/${state}`);
  }
});

test('a confirmed startup permits complete earlier coverage after replacement without inventing startup or resetting hours', () => {
  const f = measured('104SDF01AN001', { state: 'started' });
  for (const start of [REPLACEMENT, '2026-10-01T00:30:00.000Z', STARTUP]) {
    assert.equal(cycleRuntimeCoverage(f.asset, start).complete, true);
  }
  assert.equal(cycleRuntimeCoverage(f.asset, '2026-10-01T01:00:01.000Z').missingLeadingSeconds, 1);
  assert.equal(cycleRuntimeCoverage(f.asset, '2026-10-01T01:00:01.000Z').complete, false);
  assert.equal(cycleRuntimeCoverage(f.asset, '2026-09-30T23:59:59.000Z').complete, false);
  const initial = measured('204LMDF01AN001', { state: 'started', startup: REPLACEMENT });
  assert.equal(cycleRuntimeCoverage(initial.asset, REPLACEMENT).complete, true);
  assert.equal(initial.asset.cycle_runtime_hours, 3601 / 3600);
});

test('invalid starts and startup-before-replacement cannot certify a full range', () => {
  const f = measured(TAGS[0], { state: 'started' });
  for (const start of [null, '', '2026-10-01T00:00:00', 'bad']) assert.equal(cycleRuntimeCoverage(f.asset, start).complete, false);
  for (const delta of [{ last_replacement_at: '' }, { cycle_started_at: null },
    { cycle_started_at: '2026-09-30T23:00:00Z' }, { cycle_start_state: 'unknown' }]) {
    assert.equal(cycleRuntimeCoverage({ ...f.asset, ...delta }, STARTUP).complete, false);
  }
});

for (const mode of ['manual','automatic']) test(`${mode} boundaries cannot restore a partial range as an append base`, () => {
  for (const complete of [true, false]) {
    const f = measured('104SDF01AN001', { coverageStart: complete ? REPLACEMENT : STARTUP });
    const boundary = '2026-10-02T00:10:00.000Z';
    const overlay = { ...f.row, id: mode === 'manual' ? 'manual-stop' : 'operation-auto:1234abcd:stop',
      source_type: mode === 'manual' ? 'manual' : 'shift_log_operation_auto', event_type: 'operation_stop',
      source_log_id: mode === 'manual' ? '' : 'work-log-1', source_text: '', event_date: boundary,
      created_at: boundary, updated_at: boundary, action_type: mode === 'manual' ? '정지' : '교체운전 자동 정지' };
    f.asset.cycle_runtime_anchor_at = boundary;
    f.asset.cycle_runtime_state = 'stopped';
    const base = verifiedAppendBase(f.asset, [overlay, f.row], f.source.dataParcTag);
    assert.ok(base);
    assert.equal(base.coverageComplete, complete);
    if (base) assert.equal(base.observedAt, END, 'resume from measured observation, not the later boundary');
  }
});

test('a mathematically valid incremental receipt cannot conceal its leading gap', () => {
  const f = measured('104HHL60AP611', { coverageStart: STARTUP });
  f.source.startAt = '2026-10-01T23:00:00.000Z';
  f.source.runningSeconds = 1;
  f.source.totalRunningHours = 1 / 3600;
  f.source.incremental = { version: 1, baseEventId: 'dataparc_runtime:earlier',
    baseObservedAt: f.source.startAt, coverageStartAt: STARTUP, baseRunningSeconds: 3600,
    deltaRunningSeconds: 1, totalRunningSeconds: 3601 };
  f.row.source_text = JSON.stringify(f.source);
  assert.ok(incrementalEvidence(f.source));
  const base = verifiedAppendBase(f.asset, [f.row], f.source.dataParcTag);
  assert.equal(base.coverageComplete, false);
  assert.equal(base.startAt, STARTUP);
  const basis = api.currentDataParcRuntimeBasis(f.asset, [f.row]);
  assert.equal(basis.coverageComplete, false);
  assert.equal(basis.appendReady, true);
});

function memoryD1() {
  const sqlite = new DatabaseSync(':memory:');
  return { sqlite, prepare(text) { return { values: [], bind(...values) { this.values = values; return this; },
    async run() { return { meta: { changes: Number(sqlite.prepare(text).run(...this.values).changes) } }; },
    async all() { return { results: sqlite.prepare(text).all(...this.values) }; },
    async first() { return sqlite.prepare(text).get(...this.values) || null; } }; },
    async batch(statements) { sqlite.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
}

for (const tag of ['104HHL60AP611','104HHL10AN611','104ETG30AN601','104ETH03AN601','104SDF01AN001','103HRJ01AN601']) {
  test(`${tag}: partial-range projection preserves measured hours and state but suppresses whole-cycle forecasts`, async t => {
    const db = memoryD1(), sql = db.sqlite; t.after(() => sql.close());
    await api.ensureSchema(db);
    const f = measured(tag, { coverageStart: STARTUP });
    sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',
      cycle_started_at=NULL,cycle_start_revision='start-r1',cycle_runtime_revision='runtime-r2',
      cycle_runtime_hours=?,runtime_hours=?,cycle_runtime_anchor_at=?,cycle_runtime_state='running',
      runtime_anchor_at=?,is_running=1 WHERE tag_number=?`).run(REPLACEMENT,
      f.asset.cycle_runtime_hours,f.asset.runtime_hours,END,END,tag);
    const record = { ...f.row, created_by_id: 'coverage-owner', created_by_name: 'Coverage Owner' };
    const keys = Object.keys(record);
    sql.prepare(`INSERT INTO blower_history_events(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
      .run(...Object.values(record));
    const stored = () => sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
    const before = JSON.stringify(stored()), changes = sql.prepare('SELECT total_changes() n').get().n;
    const asset = stored();
    const [projected] = await api.loadAssetStates(db,
      { [asset.blower_type]: { cycleDays: 90, warningDays: 7, criticalDays: 3 } },
      { assetRows: [asset], skipDecorations: true });
    assert.equal(projected.dataParcRuntimeBasis.coverageComplete, false);
    assert.equal(projected.dataParcRuntimeBasis.runtimeHours, f.asset.cycle_runtime_hours);
    assert.equal(projected.dataParcRuntimeBasis.startAt, STARTUP);
    assert.equal(projected.dataParcRuntimeBasis.observedAt, END);
    assert.equal(projected.runtimeHours, f.asset.runtime_hours);
    assert.equal(projected.cycleElapsedHours, f.asset.cycle_runtime_hours);
    assert.equal(projected.cycleRuntimeState, 'running');
    assert.equal(projected.operationState, 'running');
    assert.equal(projected.isRunning, true);
    assert.equal(projected.remainingHours, null);
    assert.equal(projected.progressPct, null);
    assert.equal(projected.severity, 'runtime_unknown');
    assert.equal(JSON.stringify(stored()), before);
    assert.equal(sql.prepare('SELECT total_changes() n').get().n, changes);
    if (tag === '104HHL60AP611') {
      const summary = await api.handleGet({ env: { DB: db }, request: new Request('https://example.test/api/blower-history?action=summary') },
        { employeeNo: 'coverage-owner', name: 'Coverage Owner' });
      const body = await summary.json();
      assert.equal(body.counts.runtime_unknown, 1);
      assert.equal(body.alertCount, 0);
      assert.equal(sql.prepare('SELECT total_changes() n').get().n, changes);
    }
    // A manual-only correction has no partial DataPARC basis to invalidate.
    sql.prepare(`UPDATE blower_history_events SET source_type='manual',source_log_id='',source_text='',
      issue_type='',action_type='운전중',note='직접 확인한 누적시간' WHERE id=?`).run(f.row.id);
    const [manual] = await api.loadAssetStates(db,
      { [asset.blower_type]: { cycleDays: 90, warningDays: 7, criticalDays: 3 } },
      { assetRows: [stored()], skipDecorations: true });
    assert.equal(manual.dataParcRuntimeBasis, null);
    assert.equal(manual.runtimeHours, f.asset.runtime_hours);
    assert.equal(manual.severity, 'normal');
    assert.ok(manual.remainingHours > 0);
    assert.ok(manual.progressPct >= 0);
  });
}

for (const tag of ['104HHL60AP611', '104SDF01AN001']) {
  test(`${tag}: a later two-hour manual correction keeps precedence over an older one-hour partial result`, async t => {
    const db = memoryD1(), sql = db.sqlite; t.after(() => sql.close());
    await api.ensureSchema(db);
    const f = measured(tag, { coverageStart: STARTUP });
    f.row.runtime_hours = 1;
    f.source.runningSeconds = 3600;
    f.source.totalRunningHours = 1;
    f.row.source_text = JSON.stringify(f.source);
    const manualAt = '2026-10-02T00:10:00.000Z';
    sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',
      cycle_started_at=NULL,cycle_start_revision='start-r1',cycle_runtime_revision='manual-runtime-r3',
      cycle_runtime_hours=2,runtime_hours=2,cycle_runtime_anchor_at=?,cycle_runtime_state='running',
      runtime_anchor_at=?,is_running=1 WHERE tag_number=?`).run(REPLACEMENT,manualAt,manualAt,tag);
    const manual = { ...f.row, id: 'manual-new-total', runtime_hours: 2, event_date: manualAt,
      source_type: 'manual', source_log_id: '', source_text: '', issue_type: '', action_type: '운전중',
      note: '직접 확인한 누적시간', created_at: manualAt, updated_at: manualAt };
    for (const event of [f.row, manual]) {
      const record = { ...event, created_by_id: 'coverage-owner', created_by_name: 'Coverage Owner' };
      const keys = Object.keys(record);
      sql.prepare(`INSERT INTO blower_history_events(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
        .run(...Object.values(record));
    }
    const snapshot = () => JSON.stringify([sql.prepare('SELECT * FROM blower_history_assets').all(),
      sql.prepare('SELECT * FROM blower_history_events ORDER BY id').all()]);
    const before = snapshot(), changes = sql.prepare('SELECT total_changes() n').get().n;
    const stored = sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
    assert.equal(api.currentDataParcRuntimeBasis(stored, [manual, f.row]), null);
    const [projected] = await api.loadAssetStates(db,
      { [stored.blower_type]: { cycleDays: 90, warningDays: 7, criticalDays: 3 } },
      { assetRows: [stored], skipDecorations: true });
    assert.equal(projected.dataParcRuntimeBasis, null);
    assert.equal(projected.runtimeHours, 2);
    assert.equal(projected.cycleElapsedHours, 2);
    assert.equal(projected.remainingHours, 2158);
    assert.equal(projected.severity, 'normal');
    assert.equal(projected.cycleRuntimeState, 'running');
    if (tag === '104HHL60AP611') assert.equal(projected.runRuntime.source, 'manual');
    assert.equal(snapshot(), before);
    assert.equal(sql.prepare('SELECT total_changes() n').get().n, changes);
  });
}

test('a newer mismatched DataPARC total cannot borrow an older equal-value basis', () => {
  const f = measured('104HHL60AP611', { coverageStart: STARTUP });
  f.asset.cycle_runtime_hours = f.asset.runtime_hours = 2;
  const older = measured('104HHL60AP611');
  older.row.runtime_hours = 2;
  older.source.requestId = 'older-equal';
  older.row.id = 'dataparc_runtime:older-equal';
  older.row.source_log_id = 'older-equal';
  older.source.endAt = older.source.observedAt = '2026-10-01T23:00:00.000Z';
  older.row.event_date = older.row.created_at = older.row.updated_at = older.source.observedAt;
  older.source.runningSeconds = 7200;
  older.source.totalRunningHours = 2;
  older.row.source_text = JSON.stringify(older.source);
  assert.equal(api.currentDataParcRuntimeBasis(f.asset, [f.row, older.row]), null);
});

async function savedProbe(tag, startAt) {
  const db = memoryD1(), sql = db.sqlite;
  await api.ensureSchema(db);
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',
    cycle_started_at=NULL,cycle_start_revision='start-r1',cycle_runtime_revision='runtime-r1',
    cycle_runtime_hours=9.25,runtime_hours=9.25,cycle_runtime_state='running',cycle_runtime_anchor_at=? WHERE tag_number=?`)
    .run(REPLACEMENT, '2026-10-01T23:00:00.000Z', tag);
  sql.exec(`CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,status TEXT,target_date TEXT,
      requested_by_id TEXT,result_json TEXT,completed_at TEXT);
    CREATE TABLE blower_runtime_probe_intents_v4(request_id TEXT PRIMARY KEY,schema_version INTEGER,
      asset_tag TEXT,dataparc_tag TEXT,window_start TEXT,window_end TEXT,chunk_days INTEGER,chunk_count INTEGER,
      expected_last_replacement_at TEXT,expected_cycle_start_state TEXT,expected_cycle_started_at TEXT,
      expected_cycle_start_revision TEXT,expected_cycle_runtime_revision TEXT)`);
  const requestId = 'new-range-' + tag;
  const raw = { schemaVersion: 1, requestType: 'blower_runtime_probe', requestId, ok: true, readOnly: true,
    assetTag: tag, dataParcTag: signalFor(tag), startAt, endAt: END, observedAt: END,
    expectedLastReplacementAt: REPLACEMENT, expectedCycleStartState: 'legacy', expectedCycleStartedAt: '',
    expectedCycleStartRevision: 'start-r1', expectedCycleRuntimeRevision: 'runtime-r1',
    startState: 'stopped', endState: 'running', totalRunningHours: 0.5, runningSeconds: 1800,
    chunkDays: 31, chunkCount: 1, completedChunkCount: 1, collectedAt: '2026-10-02T00:00:05.000Z',
    chunks: [{ index: 1, startAt, endAt: END, startState: 'stopped', endState: 'running',
      totalRunningHours: 0.5, runningSeconds: 1800 }] };
  sql.prepare('INSERT INTO ois_data_requests VALUES (?,?,?,?,?,?,?)').run(requestId, raw.requestType, 'complete',
    `v1|${tag}|${startAt}|${END}`, 'coverage-owner', JSON.stringify(raw), raw.collectedAt);
  sql.prepare('INSERT INTO blower_runtime_probe_intents_v4 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId,1,tag,raw.dataParcTag,
    startAt,END,31,1,REPLACEMENT,'legacy','','start-r1','runtime-r1');
  const snapshot = () => JSON.stringify(['blower_history_assets','blower_history_events','blower_history_asset_history',
    'ois_data_requests','blower_runtime_probe_intents_v4'].map(table => sql.prepare(`SELECT * FROM ${table}`).all()));
  return { db, sql, raw, snapshot, apply: () => api.applyDataParcRuntimeSync(db,
    { employeeNo: 'coverage-owner', name: 'Coverage Owner' }, { requestId }, { now: NOW }) };
}

for (const tag of ['104HHL60AP611','104HHL10AN611','104ETG30AN601','104ETH03AN601','104SDF01AN001','103HRJ01AN601']) {
  test(`${tag}: a new partial full-result apply returns 409 and preserves all saved rows`, async t => {
    const f = await savedProbe(tag, STARTUP); t.after(() => f.sql.close());
    const before = f.snapshot(), changes = f.sql.prepare('SELECT total_changes() n').get().n;
    const response = await f.apply(), body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(body.code, 'DATAPARC_RUNTIME_FULL_CYCLE_REQUIRED');
    assert.equal(body.requiredStartAt, REPLACEMENT);
    assert.equal(body.missingLeadingSeconds, 3600);
    assert.equal(f.snapshot(), before);
    assert.equal(f.sql.prepare('SELECT total_changes() n').get().n, changes);
  });
}

test('an explicit complete remeasurement still applies once and replays without changing the total', async t => {
  const f = await savedProbe('104ETG30AN601', REPLACEMENT); t.after(() => f.sql.close());
  const first = await f.apply(), body = await first.json();
  assert.equal(first.status, 200, JSON.stringify(body));
  assert.equal(body.runtimeHours, 0.5);
  const before = f.snapshot(), changes = f.sql.prepare('SELECT total_changes() n').get().n;
  const replay = await f.apply(), replayBody = await replay.json();
  assert.equal(replay.status, 200, JSON.stringify(replayBody));
  assert.equal(replayBody.replayed, true);
  assert.equal(f.snapshot(), before);
  assert.equal(f.sql.prepare('SELECT total_changes() n').get().n, changes);
});

test('an immutable historical partial-result replay remains readable without certifying or rewriting the cycle', async t => {
  const f = await savedProbe('104HHL60AP611', STARTUP); t.after(() => f.sql.close());
  const { result: p } = api.normalizeDataParcRuntimeProbeResult(f.raw, f.raw.requestId, NOW);
  const source = Object.fromEntries(['schemaVersion','requestType','requestId','assetTag','dataParcTag','startAt','endAt','observedAt',
    'expectedLastReplacementAt','expectedCycleStartState','expectedCycleStartedAt','expectedCycleStartRevision',
    'expectedCycleRuntimeRevision','startState','endState','totalRunningHours','runningSeconds','chunkCount','collectedAt'].map(k => [k,p[k]]));
  f.sql.prepare(`INSERT INTO blower_history_events(id,tag_number,event_type,event_date,runtime_hours,issue_type,
    action_type,note,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('dataparc_runtime:'+p.requestId,p.assetTag,'runtime_correction',p.observedAt,
    p.runtimeHours,'DataPARC','DataPARC 운전중 동기화',`DataPARC RUN 조회 ${p.startAt} ~ ${p.observedAt} · 누적 ${p.runtimeHours}시간`,
    'dataparc_runtime',p.requestId,JSON.stringify(source),'coverage-owner','Coverage Owner',p.collectedAt,p.collectedAt);
  const before = f.snapshot(), changes = f.sql.prepare('SELECT total_changes() n').get().n;
  const replay = await f.apply(), body = await replay.json();
  assert.equal(replay.status, 200, JSON.stringify(body));
  assert.equal(body.replayed, true);
  assert.equal(f.snapshot(), before);
  assert.equal(f.sql.prepare('SELECT total_changes() n').get().n, changes);
});
