import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { verifiedAppendBase, loadAppendBase } from '../functions/_shared/blower-incremental.js';
import { __blowerHistoryTest as history } from '../functions/api/blower-history.js';
import { fixture, browserCreate, agentClaim, agentComplete, callApi, agent, BROWSER_TOKEN, historyPost } from './helpers/blower-incremental-fixture.mjs';

const refresh = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const OBSERVED = '2026-09-24T15:10:39.000Z';
const OVERLAY_AT = '2026-10-08T04:04:00.000Z';
const OVERLAY_CREATED = '2026-10-22T09:33:42.000Z';
const NOW = '2026-10-29T00:37:20.000Z';
const CASES = [
  { tag: '104HHL60AP611', seconds: 40, delta: 0, replacement: '2026-09-04T00:00:00+09:00',
    coverage: '2026-09-04T01:50:00.000Z', startRevision: 'fixture-cycle-a', oldState: 'stopped', newState: 'running' },
  { tag: '104HHL60AP631', seconds: 1776665, delta: 1932, replacement: '2026-08-27T00:00:00+09:00',
    coverage: '2026-08-26T15:00:00.000Z', startRevision: '', oldState: 'running', newState: 'stopped' }
];

// Synthetic fixtures preserve the reported A/C boundary shapes and integer RUN
// seconds. Request IDs, revision IDs, log IDs and log text are test-only values.
function sample(item = CASES[0]) {
  const signal = 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_' + item.tag;
  const hours = item.seconds / 3600;
  const requestId = 'fixture-dataparc-' + item.tag;
  const source = {
    schemaVersion: 1, requestType: 'blower_runtime_probe', requestId, assetTag: item.tag,
    dataParcTag: signal, startAt: '2026-09-24T14:38:27.000Z', endAt: OBSERVED, observedAt: OBSERVED,
    expectedLastReplacementAt: item.replacement, expectedCycleStartState: 'legacy',
    expectedCycleStartedAt: '', expectedCycleStartRevision: item.startRevision,
    expectedCycleRuntimeRevision: 'fixture-before-query', startState: item.oldState, endState: item.oldState,
    runningSeconds: item.delta, totalRunningHours: item.delta / 3600,
    incremental: { version: 1, baseEventId: 'dataparc_runtime:fixture-earlier-query',
      baseObservedAt: '2026-09-24T14:38:27.000Z', coverageStartAt: item.coverage,
      baseRunningSeconds: item.seconds - item.delta, deltaRunningSeconds: item.delta,
      totalRunningSeconds: item.seconds }
  };
  const dp = {
    id: 'dataparc_runtime:' + requestId, tag_number: item.tag, event_type: 'runtime_correction',
    event_date: OBSERVED, runtime_hours: hours, source_type: 'dataparc_runtime', source_log_id: requestId,
    source_text: JSON.stringify(source), action_type: item.oldState === 'running' ? 'DataPARC 운전중 동기화' : 'DataPARC 정지 동기화',
    created_at: '2026-09-24T15:11:24.000Z', updated_at: '2026-09-24T15:11:24.000Z'
  };
  const starts = item.newState === 'running';
  const overlay = {
    id: 'operation-auto:1234abcd:' + (starts ? 'start' : 'stop'), tag_number: item.tag,
    event_type: starts ? 'operation_start' : 'operation_stop', event_date: OVERLAY_AT,
    runtime_hours: hours, source_type: 'shift_log_operation_auto', source_log_id: 'fixture-log-20261008',
    source_text: 'Fixture operation changeover text', action_type: starts ? '교체운전 자동 기동' : '교체운전 자동 정지',
    created_at: OVERLAY_CREATED, updated_at: OVERLAY_CREATED
  };
  const asset = {
    tag_number: item.tag, last_replacement_at: item.replacement, cycle_start_state: 'legacy',
    cycle_started_at: null, cycle_start_revision: item.startRevision, cycle_runtime_hours: hours,
    cycle_runtime_anchor_at: OVERLAY_AT, cycle_runtime_state: item.newState,
    cycle_runtime_revision: 'fixture-auto-revision-' + item.tag
  };
  return { item, signal, asset, dp, overlay, source, rows: [overlay, dp] };
}

function checkBase(f) {
  const base = verifiedAppendBase(f.asset, f.rows, f.signal);
  assert.ok(base, f.item.tag);
  assert.equal(base.eventId, f.dp.id);
  assert.equal(base.requestId, f.dp.source_log_id);
  assert.equal(base.observedAt, OBSERVED, 'resume from measured endpoint, never the later operation boundary');
  assert.equal(base.startAt, f.item.coverage, 'retain original coverage');
  assert.equal(base.runningSeconds, f.item.seconds, 'retain exact integer RUN seconds');
  assert.equal(base.runtimeHours, f.item.seconds / 3600);
  assert.equal(base.state, f.item.oldState, 'query boundary state comes from the measured predecessor');
  assert.equal(base.cycleRuntimeRevision, f.asset.cycle_runtime_revision, 'CAS protects the current operation revision');
  return base;
}

for (const item of CASES) test(item.tag + ': automatic operation preserves the measured append base without changing input records', () => {
  const f = sample(item), before = structuredClone(f);
  checkBase(f);
  assert.deepEqual(f, before);
});

test('A/C server planning becomes append-ready and the integrated plan retains the old coverage', () => {
  const assets = CASES.map(item => {
    const f = sample(item), basis = history.currentDataParcRuntimeBasis(f.asset, f.rows);
    assert.ok(basis);
    assert.equal(basis.appendReady, true);
    assert.equal(basis.runningSeconds, item.seconds);
    return { tagNumber: item.tag, enabled: true, lastReplacementAt: item.replacement,
      cycleStartState: 'legacy', cycleStartedAt: item.replacement, cycleStoredStartedAt: '',
      cycleStartRevision: item.startRevision, cycleRuntimeRevision: f.asset.cycle_runtime_revision,
      dataParcTag: f.signal, dataParcRuntimeBasis: basis };
  });
  const plan = refresh.plan(assets, new Date(NOW));
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.tasks.length, 2);
  for (const task of plan.tasks) {
    assert.equal(task.incremental, true);
    assert.equal(task.queryStartAt, OBSERVED);
    assert.equal(task.startAt, CASES.find(x => x.tag === task.asset.tagNumber).coverage);
    assert.equal(task.snapshot.cycleStartedAt, '');
  }
});

test('operation evidence alone does not mark historical RUN data as freshly measured', () => {
  for (const item of CASES) {
    const f = sample(item), provenance = history.fbheSealRunProvenance(f.asset, f.rows, new Date(NOW));
    assert.equal(provenance.verified, false);
    assert.equal(provenance.needsQuery, true);
    assert.equal(provenance.legacyStoredHours, item.seconds / 3600);
  }
});

test('actual SQLite loader recovers the predecessor without rewriting either event or asset', async () => {
  const f = sample(CASES[1]), sql = new DatabaseSync(':memory:');
  try {
    sql.exec(`CREATE TABLE blower_history_events (id TEXT PRIMARY KEY, tag_number TEXT,
      event_type TEXT, event_date TEXT, runtime_hours REAL, source_type TEXT, source_log_id TEXT,
      source_text TEXT, action_type TEXT, created_at TEXT, updated_at TEXT)`);
    const fields = Object.keys(f.dp), insert = sql.prepare(`INSERT INTO blower_history_events
      (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`);
    for (const row of f.rows) insert.run(...fields.map(k => row[k]));
    const before = sql.prepare('SELECT * FROM blower_history_events ORDER BY id').all();
    const db = { prepare(text) { return { values: [], bind(...values) { this.values = values; return this; },
      async all() { return { results: sql.prepare(text).all(...this.values) }; } }; } };
    const base = await loadAppendBase(db, f.asset, f.signal);
    assert.equal(base.observedAt, OBSERVED);
    assert.equal(base.runningSeconds, f.item.seconds);
    assert.deepEqual(sql.prepare('SELECT * FROM blower_history_events ORDER BY id').all(), before);
    const invalid = { ...f.overlay, id: 'operation-auto:5678abcd:stop', event_date: 'not-a-date' };
    insert.run(...fields.map(k => invalid[k]));
    assert.equal(await loadAppendBase(db, f.asset, f.signal), null,
      'the SQL loader must surface invalid event dates instead of silently filtering them out');
  } finally { sql.close(); }
});

test('SQLite loader and planner both refuse timezone-less older dates while valid old UTC rows stay excluded', async () => {
  const f = sample(), sql = new DatabaseSync(':memory:');
  try {
    sql.exec(`CREATE TABLE blower_history_events (id TEXT PRIMARY KEY, tag_number TEXT,
      event_type TEXT, event_date TEXT, runtime_hours REAL, source_type TEXT, source_log_id TEXT,
      source_text TEXT, action_type TEXT, created_at TEXT, updated_at TEXT)`);
    const fields = Object.keys(f.dp), insert = sql.prepare(`INSERT INTO blower_history_events
      (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`);
    const older = { ...f.overlay, id: 'operation-auto:5678abcd:start', event_date: '2020-01-01 00:00:00',
      created_at: '2020-01-01T00:01:00Z', updated_at: '2020-01-01T00:01:00Z' };
    for (const row of [...f.rows, older]) insert.run(...fields.map(k => row[k]));
    let selectedIds = [];
    const db = { prepare(text) { return { values: [], bind(...values) { this.values = values; return this; },
      async all() { const results = sql.prepare(text).all(...this.values); selectedIds = results.map(r => r.id); return { results }; } }; } };
    assert.equal(verifiedAppendBase(f.asset, [...f.rows, older], f.signal), null);
    assert.equal(history.currentDataParcRuntimeBasis(f.asset, [...f.rows, older]).appendReady, false);
    assert.equal(await loadAppendBase(db, f.asset, f.signal), null);
    assert.ok(selectedIds.includes(older.id), 'timezone-less dates cannot silently disappear during SQL filtering');
    sql.prepare('UPDATE blower_history_events SET event_date=? WHERE id=?').run('2020-01-01T00:00:00Z', older.id);
    const base = await loadAppendBase(db, f.asset, f.signal);
    assert.equal(base.observedAt, OBSERVED);
    assert.ok(!selectedIds.includes(older.id), 'valid dates from old cycles remain outside the bounded history query');
  } finally { sql.close(); }
});

const badOverlay = [
  ['unknown source', r => { r.source_type = 'import'; }],
  ['deleted source', r => { r.source_type = 'shift_log_operation_auto_deleted'; }],
  ['startup event', r => { r.event_type = 'startup'; }],
  ['runtime correction event', r => { r.event_type = 'runtime_correction'; }],
  ['malformed auto ID', r => { r.id = 'operation-auto:bad:start'; }],
  ['wrong ID suffix', r => { r.id = 'operation-auto:1234abcd:stop'; }],
  ['missing source log', r => { r.source_log_id = ''; }],
  ['blank source log', r => { r.source_log_id = '  '; }],
  ['wrong action state', r => { r.action_type = '교체운전 자동 정지'; }],
  ['unrecognized action', r => { r.action_type = '교체운전 자동 기동 확인'; }],
  ['edited auto event', r => { r.updated_at = '2026-10-23T00:00:00Z'; }],
  ['invalid creation time', r => { r.created_at = r.updated_at = 'invalid'; }],
  ['creation before operation', r => { r.created_at = r.updated_at = '2026-10-01T00:00:00Z'; }],
  ['missing update time', r => { r.updated_at = ''; }],
  ['different asset', r => { r.tag_number = '104HHL60AP621'; }],
  ['changed cumulative hours', r => { r.runtime_hours += 1; }],
  ['null cumulative hours', r => { r.runtime_hours = null; }],
  ['empty cumulative hours', r => { r.runtime_hours = ''; }],
  ['blank cumulative hours', r => { r.runtime_hours = ' '; }],
  ['boolean cumulative hours', r => { r.runtime_hours = false; }]
];
for (const [label, mutate] of badOverlay) test('refuses auto boundary with ' + label, () => {
  const f = sample(); mutate(f.overlay);
  assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
});

for (const [label, mutate] of [
  ['changed current total', f => { f.asset.cycle_runtime_hours += 1; f.overlay.runtime_hours += 1; }],
  ['pending cycle', f => { f.asset.cycle_start_state = 'pending'; }],
  ['changed replacement', f => { f.asset.last_replacement_at = '2026-09-05T00:00:00+09:00'; }],
  ['changed cycle revision', f => { f.asset.cycle_start_revision = 'another-cycle'; }],
  ['different current state', f => { f.asset.cycle_runtime_state = 'stopped'; }],
  ['empty current revision', f => { f.asset.cycle_runtime_revision = ''; }],
  ['unknown cycle state', f => { f.asset.cycle_start_state = 'unknown'; }],
  ['unowned current anchor', f => { f.asset.cycle_runtime_anchor_at = '2026-10-09T00:00:00Z'; }],
  ['different configured signal', f => { f.signal += '_OTHER'; }],
  ['edited DataPARC row', f => { f.dp.updated_at = '2026-09-25T00:00:00Z'; }],
  ['manual DataPARC override', f => { f.source.manualOverride = true; f.dp.source_text = JSON.stringify(f.source); }],
  ['recorded DataPARC override', f => { f.source.manualOverride = { changedAt: '2026-09-25T00:00:00Z' }; f.dp.source_text = JSON.stringify(f.source); }],
  ['DataPARC replacement edit', f => { f.source.replacementEdit = true; f.dp.source_text = JSON.stringify(f.source); }],
  ['DataPARC refresh-required flag', f => { f.source.requiresRunRefresh = true; f.dp.source_text = JSON.stringify(f.source); }],
  ['wrong DataPARC request identity', f => { f.source.requestId = 'another-request'; f.dp.source_text = JSON.stringify(f.source); }],
  ['wrong DataPARC exact seconds', f => { f.source.incremental.totalRunningSeconds++; f.dp.source_text = JSON.stringify(f.source); }],
  ['non-integer DataPARC total', f => { f.source.incremental.totalRunningSeconds += 0.5; f.dp.source_text = JSON.stringify(f.source); }]
]) test('refuses recovery after ' + label, () => {
  const f = sample(); mutate(f);
  assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
});

test('an intervening unrecognized boundary or changed total blocks recovery', () => {
  for (const change of [
    r => { r.source_type = 'unknown'; },
    r => { r.runtime_hours += 10; },
    r => { r.event_type = 'startup'; },
    r => { r.updated_at = '2026-10-07T01:00:00Z'; }
  ]) {
    const f = sample();
    const extra = { ...f.overlay, id: 'operation-auto:5678abcd:start', event_date: '2026-10-07T00:00:00Z',
      created_at: '2026-10-07T00:01:00Z', updated_at: '2026-10-07T00:01:00Z' };
    change(extra); f.rows.splice(1, 0, extra);
    assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
  }
});

test('an absent DataPARC predecessor never falls back to the automatic event hours', () => {
  const f = sample();
  assert.equal(verifiedAppendBase(f.asset, [f.overlay], f.signal), null);
});

test('the new automatic path refuses mixed manual boundaries even with unchanged totals', () => {
  const f = sample();
  f.rows.splice(1, 0, { ...f.overlay, id: 'fixture-manual-boundary', source_type: 'manual',
    source_log_id: '', action_type: '기동', event_date: '2026-10-07T00:00:00Z',
    created_at: '2026-10-07T00:01:00Z', updated_at: '2026-10-07T00:01:00Z' });
  assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
});

test('multiple valid automatic boundaries preserve the same predecessor', () => {
  const f = sample();
  f.rows.splice(1, 0, { ...f.overlay, id: 'operation-auto:5678abcd:stop', event_type: 'operation_stop',
    action_type: '교체운전 자동 정지', event_date: '2026-10-07T00:00:00Z',
    created_at: '2026-10-07T00:01:00Z', updated_at: '2026-10-07T00:01:00Z' });
  checkBase(f);
});

test('numeric SQLite representations retain exact cumulative equality; rounded values do not', () => {
  const f = sample(CASES[1]);
  f.asset.cycle_runtime_hours = String(f.asset.cycle_runtime_hours);
  f.overlay.runtime_hours = String(f.overlay.runtime_hours);
  checkBase(f);
  f.overlay.runtime_hours = (f.item.seconds / 3600).toFixed(6);
  assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
});

test('invalid or future current-cycle runtime dates block automatic recovery', () => {
  for (const date of ['not-a-date', '2026-10-09T00:00:00Z']) {
    const f = sample();
    f.rows.push({ ...f.overlay, id: 'operation-auto:5678abcd:start', event_date: date });
    assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
  }
});

test('a newer invalid DataPARC result cannot be skipped in favor of an older matching total', () => {
  const f = sample();
  const bad = { ...f.dp, id: 'dataparc_runtime:fixture-newer-invalid', source_log_id: 'fixture-newer-invalid',
    event_date: '2026-09-25T00:00:00Z', created_at: '2026-09-25T00:01:00Z', updated_at: '2026-09-25T00:01:00Z',
    source_text: 'invalid' };
  f.rows.splice(1, 0, bad);
  assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
});

test('unsupported asset cannot use the automatic boundary path', () => {
  const f = sample();
  f.asset.tag_number = f.dp.tag_number = f.overlay.tag_number = f.source.assetTag = 'CUSTOM';
  f.dp.source_text = JSON.stringify(f.source);
  assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
});

test('started cycles require matching startup evidence and coverage at or after startup', () => {
  const f = sample();
  f.asset.cycle_start_state = f.source.expectedCycleStartState = 'started';
  f.asset.cycle_started_at = f.source.expectedCycleStartedAt = f.item.coverage;
  f.dp.source_text = JSON.stringify(f.source);
  checkBase(f);
  f.asset.cycle_started_at = f.source.expectedCycleStartedAt = '2026-09-05T00:00:00Z';
  f.dp.source_text = JSON.stringify(f.source);
  assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
});

test('conflicting same-time automatic states and a competing predecessor owner remain blocked', () => {
  const f = sample();
  const opposite = { ...f.overlay, id: 'operation-auto:5678abcd:stop', event_type: 'operation_stop',
    action_type: '교체운전 자동 정지', created_at: '2026-10-22T09:33:41.000Z', updated_at: '2026-10-22T09:33:41.000Z' };
  assert.equal(verifiedAppendBase(f.asset, [...f.rows, opposite], f.signal), null);
  const competing = { ...f.dp, id: 'fixture-competing-boundary', event_type: 'operation_stop',
    source_type: 'manual', source_text: '', created_at: OBSERVED, updated_at: OBSERVED };
  assert.equal(verifiedAppendBase(f.asset, [...f.rows, competing], f.signal), null);
});

test('an older runtime event edited after the selected receipt cannot be silently ignored', () => {
  const f = sample();
  const older = { ...f.overlay, id: 'fixture-backdated-edit', event_date: '2026-09-20T00:00:00Z',
    source_type: 'manual', created_at: '2026-09-20T00:01:00Z', updated_at: '2026-09-25T00:00:00Z' };
  assert.equal(verifiedAppendBase(f.asset, [...f.rows, older], f.signal), null);
});

test('a backdated earlier event cannot hide its later creation behind an older update timestamp', () => {
  const f = sample();
  const older = { ...f.overlay, id: 'fixture-backdated-creation', event_date: '2026-09-20T00:00:00Z',
    source_type: 'manual', created_at: '2026-10-22T00:01:00Z', updated_at: '2026-09-20T00:01:00Z' };
  assert.equal(verifiedAppendBase(f.asset, [...f.rows, older], f.signal), null);
  for (const field of ['created_at', 'updated_at']) {
    const malformed = { ...older, created_at: '2026-09-20T00:01:00Z', updated_at: '2026-09-20T00:01:00Z', [field]: 'invalid' };
    assert.equal(verifiedAppendBase(f.asset, [...f.rows, malformed], f.signal), null);
  }
});

test('a measured zero-second predecessor is valid, but a changed value within display tolerance is not', () => {
  const f = sample({ ...CASES[0], seconds: 0 });
  checkBase(f);
  f.asset.cycle_runtime_hours = f.overlay.runtime_hours = 0.0000001;
  assert.equal(verifiedAppendBase(f.asset, f.rows, f.signal), null);
});

const RealDate = Date;
for (const item of CASES) test(item.tag + ': real queue, Agent result and sync append once after an automatic boundary', async () => {
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [RealDate.parse(NOW)])); }
    static now() { return RealDate.parse(NOW); }
  };
  let database;
  try {
    const f = sample(item), initialized = await fixture(item.tag, true);
    database = initialized.database;
    const sql = initialized.sqlite;
    sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?, cycle_start_state=?, cycle_started_at=?,
      cycle_start_revision=?, cycle_runtime_hours=?, cycle_runtime_anchor_at=?, cycle_runtime_state=?,
      cycle_runtime_revision=?, runtime_hours=?, is_running=? WHERE tag_number=?`).run(
      f.asset.last_replacement_at, f.asset.cycle_start_state, f.asset.cycle_started_at,
      f.asset.cycle_start_revision, f.asset.cycle_runtime_hours, f.asset.cycle_runtime_anchor_at,
      f.asset.cycle_runtime_state, f.asset.cycle_runtime_revision, f.asset.cycle_runtime_hours,
      Number(f.asset.cycle_runtime_state === 'running'), item.tag);
    const fields = Object.keys(f.dp);
    const insert = sql.prepare(`INSERT INTO blower_history_events (${fields.join(',')},created_by_id,created_by_name)
      VALUES (${fields.map(() => '?').join(',')},'fixture','Fixture')`);
    for (const row of f.rows) insert.run(...fields.map(k => row[k]));
    const read = () => sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(item.tag);
    const events = () => sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(item.tag);
    const before = read(), beforeEvents = events();
    const created = await browserCreate(database, {
      action: 'create_blower_runtime_probe', assetTag: item.tag, dataParcTag: f.signal,
      confirmRunSignal: true, startAt: item.coverage, unifiedRefresh: true, incrementalRefresh: true,
      expectedLastReplacementAt: f.asset.last_replacement_at, expectedCycleStartState: f.asset.cycle_start_state,
      expectedCycleStartedAt: '', expectedCycleStartRevision: f.asset.cycle_start_revision,
      expectedCycleRuntimeRevision: f.asset.cycle_runtime_revision
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(Date.parse(created.body.item.probe.startAt), Date.parse(OBSERVED));
    assert.equal(created.body.item.probe.expectedCycleRuntimeRevision, 'append-v1:' + f.asset.cycle_runtime_revision);
    assert.deepEqual(read(), before);
    const claim = await agentClaim(database);
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    const claimed = claim.body.items.excel;
    assert.equal(claimed.id, created.body.item.id);
    const seconds = 12345, hours = seconds / 3600;
    const chunks = [];
    let cursor = Date.parse(claimed.probe.startAt), end = Date.parse(claimed.probe.endAt);
    while (cursor < end) {
      const next = Math.min(end, cursor + claimed.probe.chunkDays * 86400000);
      const first = chunks.length === 0, chunkSeconds = first ? seconds : 0;
      chunks.push({ index: chunks.length + 1,
        startAt: first ? claimed.probe.startAt : new Date(cursor + 9 * 3600000).toISOString().replace('.000Z', '+09:00'),
        endAt: next === end ? claimed.probe.endAt : new Date(next + 9 * 3600000).toISOString().replace('.000Z', '+09:00'),
        startState: first ? item.oldState : item.newState, endState: item.newState,
        runningSeconds: chunkSeconds, totalRunningHours: chunkSeconds / 3600 });
      cursor = next;
    }
    const normalized = agent.normalizeResult({ ...claimed.probe, ok: true, observedAt: claimed.probe.endAt,
      collectedAt: NOW, completedChunkCount: chunks.length, startState: item.oldState, endState: item.newState,
      runningSeconds: seconds, totalRunningHours: hours,
      chunks
    }, agent.parseClaim(claimed));
    const completed = await agentComplete(database, claimed.id, normalized);
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.deepEqual(read(), before, 'completion alone cannot rewrite the saved total');
    const sync = () => callApi(historyPost, database, new Request('https://example.test/api/blower-history', {
      method: 'POST', headers: { Authorization: 'Bearer ' + BROWSER_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dataparc_runtime_sync', requestId: claimed.id })
    }));
    const applied = await sync();
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.incremental, true);
    assert.equal(applied.body.addedRunningSeconds, seconds);
    assert.equal(applied.body.runtimeHours, (item.seconds + seconds) / 3600);
    const saved = read(), savedEvents = events();
    for (const row of beforeEvents) assert.deepEqual(savedEvents.find(x => x.id === row.id), row);
    const basis = history.currentDataParcRuntimeBasis(saved, savedEvents.slice().sort((a,b) => b.created_at.localeCompare(a.created_at)));
    assert.equal(basis.appendReady, true);
    assert.equal(basis.runningSeconds, item.seconds + seconds);
    assert.equal(basis.startAt, item.coverage);
    assert.equal(history.fbheSealRunProvenance(saved, savedEvents, new Date(NOW)).verified, true);
    const replay = await sync();
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(read(), saved);
    assert.deepEqual(events(), savedEvents);
  } finally { database?.close(); globalThis.Date = RealDate; }
});
