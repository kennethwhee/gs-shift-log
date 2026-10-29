import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { onRequestGet as historyGet } from '../functions/api/blower-history.js';
import { fixture, browserCreate, agentClaim, agentComplete, callApi, agent, BROWSER_TOKEN,
  history, historyPost } from './helpers/blower-incremental-fixture.mjs';

const refresh = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const TAG = '204LMDF01AN001';
const SIGNAL = 'GSPOGE.ABB_DCS.204LMDF01AN001XB04';
const START = '2026-09-11T13:27:00+09:00';
const NOW = '2026-10-29T00:37:20.000Z';
const RealDate = Date;
const INITIALIZE = { action: 'initialize_manure_run', unifiedRefresh: true };

async function setup() {
  let clock = RealDate.parse(NOW);
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  // Initialize another fixture asset; manure retains its real pristine seed.
  const f = await fixture('104HHL60AP611', true);
  f.read = () => f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG);
  f.events = () => f.sqlite.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
  f.allRows = () => ({
    assets: f.sqlite.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all(),
    events: f.sqlite.prepare('SELECT * FROM blower_history_events ORDER BY id').all(),
    assetHistory: f.sqlite.prepare('SELECT * FROM blower_history_asset_history ORDER BY id').all()
  });
  f.post = (body = INITIALIZE, { token = BROWSER_TOKEN, mode = 'desktop', database = f.database } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'X-GS-Client-Mode': mode };
    if (token !== null) headers.Authorization = 'Bearer ' + token;
    return callApi(historyPost, database, new Request('https://example.test/api/blower-history', {
      method: 'POST', headers, body: JSON.stringify(body)
    }));
  };
  f.get = (query = 'action=refresh_state_page&limit=1&cursor=204LMDF01AN000') => callApi(historyGet,
    f.database, new Request('https://example.test/api/blower-history?' + query,
      { headers: { Authorization: 'Bearer ' + BROWSER_TOKEN, 'X-GS-Client-Mode': 'desktop' } }));
  f.view = async () => (await history.loadAssetStates(f.database, {}, { planning: true })).find(a => a.tagNumber === TAG);
  f.advance = milliseconds => { clock += milliseconds; };
  f.close = () => { f.database.close(); globalThis.Date = RealDate; };
  f.addEvent = (changes = {}) => {
    const row = { id: 'fixture-existing-event', tag_number: TAG, event_type: 'problem',
      event_date: START, runtime_hours: 0, source_type: 'manual', source_log_id: '', source_text: '',
      action_type: '확인', created_by_id: 'fixture', created_by_name: 'Fixture', created_at: NOW, updated_at: NOW, ...changes };
    const fields = Object.keys(row);
    f.sqlite.prepare(`INSERT INTO blower_history_events (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`)
      .run(...fields.map(k => row[k]));
    return row;
  };
  return f;
}

test('explicit initialization records the confirmed first startup, not a fabricated replacement or measured runtime', async () => {
  const f = await setup();
  try {
    const before = f.allRows(), old = f.read();
    assert.equal(old.last_replacement_at, null);
    assert.equal(old.cycle_start_state, 'pending');
    const response = await f.post();
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.disposition, 'initialized');
    const asset = f.read(), events = f.events();
    assert.equal(Date.parse(asset.last_replacement_at), Date.parse(START), 'legacy internal field is only a cycle baseline');
    assert.equal(Date.parse(asset.cycle_started_at), Date.parse(START));
    assert.equal(asset.cycle_start_state, 'started');
    assert.equal(asset.cycle_runtime_state, 'unknown');
    assert.equal(asset.cycle_runtime_hours, 0);
    assert.equal(asset.runtime_hours, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'startup');
    assert.equal(events[0].source_type, 'initial_startup_confirmed');
    assert.equal(Date.parse(events[0].event_date), Date.parse(START));
    assert.equal(events.filter(e => e.event_type === 'replacement').length, 0);
    const evidence = JSON.parse(events[0].source_text);
    assert.equal(evidence.kind, 'initial_startup');
    assert.equal(evidence.actualReplacementRecorded, false);
    assert.equal(evidence.operatorConfirmed, true);
    assert.equal(evidence.dataParcTag, SIGNAL);
    assert.equal(evidence.originalDisplayTag, SIGNAL + '/PLOT');
    assert.equal(f.allRows().assetHistory.filter(a => a.tag_number === TAG && a.action_type === 'initialize_manure_run').length, 1);
    assert.deepEqual(f.allRows().assets.filter(a => a.tag_number !== TAG), before.assets.filter(a => a.tag_number !== TAG));
    const view = await f.view();
    assert.equal(view.cycleBasisKind, 'initial_startup');
    assert.equal(view.initialStartupEvidenceValid, true);
    assert.equal(Date.parse(view.initialStartedAt), Date.parse(START));
    assert.equal(view.actualLastReplacementAt, '');
    assert.equal(view.dataParcTag, SIGNAL);
    assert.equal(view.measurementRequired, true);
    assert.equal(view.runtimeHours, null);
    assert.equal(view.cycleElapsedHours, null);
    assert.equal(view.dataParcRuntimeBasis, null);
  } finally { f.close(); }
});

test('repeating initialization is idempotent and leaves the saved initial evidence unchanged', async () => {
  const f = await setup();
  try {
    assert.equal((await f.post()).status, 200);
    const before = f.allRows();
    f.advance(1000);
    const response = await f.post();
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.disposition, 'already_initialized');
    assert.deepEqual(f.allRows(), before);
  } finally { f.close(); }
});

test('ordinary planning GET never initializes the pristine manure asset', async () => {
  const f = await setup();
  try {
    const before = f.allRows();
    const response = await f.get();
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.assets[0].tagNumber, TAG);
    assert.equal(f.read().last_replacement_at, null);
    assert.deepEqual(f.allRows(), before);
    const afterView = await f.view();
    assert.equal(afterView.lastReplacementAt, '');
    assert.deepEqual(f.allRows(), before);
  } finally { f.close(); }
});

test('explicit refresh intent is required before initialization', async () => {
  for (const unifiedRefresh of [undefined, false, 'true', 1]) {
    const f = await setup();
    try {
      const before = f.allRows();
      const response = await f.post({ action: INITIALIZE.action, unifiedRefresh });
      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.equal(response.body.code, 'MANURE_INITIAL_RUN_EXPLICIT_REFRESH_REQUIRED');
      assert.deepEqual(f.allRows(), before);
    } finally { f.close(); }
  }
});

for (const [label, options, status] of [
  ['anonymous', { token: null }, 401],
  ['invalid session', { token: 'not-an-authenticated-session' }, 401],
  ['mobile monitoring', { mode: 'mobile-monitoring' }, 403]
]) test(label + ' cannot initialize or mutate equipment history', async () => {
  const f = await setup();
  try {
    const before = f.allRows(), response = await f.post(INITIALIZE, options);
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.deepEqual(f.allRows(), before);
  } finally { f.close(); }
});

test('an existing replacement cycle is preserved and is not relabelled as initial startup', async () => {
  const f = await setup();
  try {
    const replacement = '2026-09-20T09:00:00+09:00';
    f.sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at=?, cycle_started_at=?, cycle_start_state='started',
      cycle_start_revision='fixture-replacement-revision', cycle_runtime_hours=72, cycle_runtime_anchor_at=?,
      cycle_runtime_state='running', cycle_runtime_revision='fixture-runtime-revision', runtime_hours=72,
      runtime_anchor_at=?, is_running=1 WHERE tag_number=?`).run(replacement, replacement, replacement, replacement, TAG);
    f.addEvent({ event_type: 'replacement', event_date: replacement, action_type: '교체', runtime_hours: 55 });
    const before = f.allRows(), response = await f.post();
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.disposition, 'existing_cycle');
    assert.deepEqual(f.allRows(), before);
    const view = await f.view();
    assert.notEqual(view.cycleBasisKind, 'initial_startup');
    assert.equal(Date.parse(view.actualLastReplacementAt), Date.parse(replacement));
  } finally { f.close(); }
});

for (const [label, change] of [
  ['existing history', f => { f.addEvent(); }],
  ['stored runtime', f => { f.sqlite.prepare('UPDATE blower_history_assets SET runtime_hours=3 WHERE tag_number=?').run(TAG); }],
  ['stored cycle runtime', f => { f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=3 WHERE tag_number=?').run(TAG); }],
  ['existing startup', f => { f.sqlite.prepare("UPDATE blower_history_assets SET cycle_started_at=?,cycle_start_state='started' WHERE tag_number=?").run(START, TAG); }],
  ['disabled asset', f => { f.sqlite.prepare('UPDATE blower_history_assets SET enabled=0 WHERE tag_number=?').run(TAG); }]
]) test(label + ' blocks initial setup instead of erasing preexisting data', async () => {
  const f = await setup();
  try {
    change(f);
    const before = f.allRows(), response = await f.post();
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.code, 'MANURE_INITIAL_RUN_CONFLICT');
    assert.deepEqual(f.allRows(), before);
  } finally { f.close(); }
});

test('an event insert failure rolls back the cycle baseline and permits a later complete retry', async () => {
  const f = await setup();
  try {
    const before = f.allRows();
    f.sqlite.exec(`CREATE TRIGGER reject_initial_event BEFORE INSERT ON blower_history_events
      WHEN NEW.source_type='initial_startup_confirmed' BEGIN SELECT RAISE(ABORT,'fixture insert failure'); END`);
    const errors = [], logError = console.error;
    let response;
    try { console.error = (...args) => errors.push(args); response = await f.post(); }
    finally { console.error = logError; }
    assert.ok(response.status >= 400, JSON.stringify(response.body));
    assert.equal(errors.length, 1, 'the expected server failure is logged once');
    assert.ok(!JSON.stringify(response.body).includes('fixture insert failure'), 'internal database error details stay out of the response');
    assert.deepEqual(f.allRows(), before);
    f.sqlite.exec('DROP TRIGGER reject_initial_event');
    const retried = await f.post();
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(f.events().filter(e => e.source_type === 'initial_startup_confirmed').length, 1);
  } finally { f.close(); }
});

test('concurrent initialization attempts cannot duplicate or partially initialize the asset', async () => {
  const f = await setup();
  try {
    const results = await Promise.all([f.post(), f.post()]);
    assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
    assert.equal(results.filter(r => r.body.disposition === 'initialized').length, 1);
    assert.equal(results.filter(r => r.body.disposition === 'already_initialized').length, 1);
    assert.equal(f.events().filter(e => e.source_type === 'initial_startup_confirmed').length, 1);
  } finally { f.close(); }
});

test('a runtime edit racing initialization is retained by the atomic precondition', async () => {
  const f = await setup();
  try {
    let injected = false;
    const racedDatabase = {
      prepare: (...args) => f.database.prepare(...args),
      async batch(statements) {
        if (!injected && statements.some(s => /UPDATE\s+blower_history_assets/i.test(s.sql))) {
          injected = true;
          f.sqlite.prepare("UPDATE blower_history_assets SET cycle_runtime_hours=9,runtime_hours=9,cycle_runtime_revision='fixture-concurrent' WHERE tag_number=?").run(TAG);
        }
        return f.database.batch(statements);
      }
    };
    const response = await f.post(INITIALIZE, { database: racedDatabase });
    assert.equal(injected, true);
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(f.read().runtime_hours, 9);
    assert.equal(f.read().cycle_runtime_hours, 9);
    assert.equal(f.read().last_replacement_at, null);
    assert.equal(f.events().length, 0);
  } finally { f.close(); }
});

test('a history-only insertion racing initialization is retained and blocks the pristine-state write', async () => {
  const f = await setup();
  try {
    let injected = false;
    const racedDatabase = {
      prepare: (...args) => f.database.prepare(...args),
      async batch(statements) {
        if (!injected && statements.some(s => /UPDATE\s+blower_history_assets/i.test(s.sql))) {
          injected = true;
          f.addEvent();
        }
        return f.database.batch(statements);
      }
    };
    const before = f.read(), response = await f.post(INITIALIZE, { database: racedDatabase });
    assert.equal(injected, true);
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.deepEqual(f.read(), before);
    assert.equal(f.events().length, 1);
    assert.equal(f.events()[0].id, 'fixture-existing-event');
    assert.equal(f.allRows().assetHistory.filter(a => a.tag_number === TAG).length, 0);
  } finally { f.close(); }
});

async function createProbe(f) {
  const a = f.read();
  return browserCreate(f.database, {
    action: 'create_blower_runtime_probe', assetTag: TAG, dataParcTag: SIGNAL, confirmRunSignal: true,
    startAt: START, unifiedRefresh: true, incrementalRefresh: true,
    expectedLastReplacementAt: a.last_replacement_at, expectedCycleStartState: a.cycle_start_state,
    expectedCycleStartedAt: a.cycle_started_at || '', expectedCycleStartRevision: a.cycle_start_revision,
    expectedCycleRuntimeRevision: a.cycle_runtime_revision
  });
}

async function completeProbe(f, item, seconds, startState = 'running', endState = 'running') {
  const claim = await agentClaim(f.database);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  const claimed = claim.body.items.excel;
  assert.equal(claimed.id, item.id);
  const chunks = [], end = Date.parse(claimed.probe.endAt);
  let cursor = Date.parse(claimed.probe.startAt);
  const kst = milliseconds => new Date(milliseconds + 9 * 3600000).toISOString().replace('.000Z', '+09:00');
  while (cursor < end) {
    const next = Math.min(end, cursor + claimed.probe.chunkDays * 86400000);
    const first = chunks.length === 0, runSeconds = first ? seconds : 0;
    chunks.push({ index: chunks.length + 1, startAt: kst(cursor), endAt: kst(next),
      startState: first ? startState : endState, endState, runningSeconds: runSeconds,
      totalRunningHours: runSeconds / 3600 });
    cursor = next;
  }
  const normalized = agent.normalizeResult({ ...claimed.probe, ok: true, observedAt: claimed.probe.endAt,
    collectedAt: new Date().toISOString(), completedChunkCount: chunks.length, startState, endState,
    runningSeconds: seconds, totalRunningHours: seconds / 3600, chunks }, agent.parseClaim(claimed));
  const complete = await agentComplete(f.database, item.id, normalized);
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  return f.post({ action: 'dataparc_runtime_sync', requestId: item.id });
}

test('first DataPARC query measures from confirmed startup; later queries append and replay cannot double-add', async () => {
  const f = await setup();
  try {
    assert.equal((await f.post()).status, 200);
    const initialEvent = f.events()[0], initialized = f.read(), initialView = await f.view();
    const planned = refresh.plan([initialView], new Date());
    assert.equal(planned.skipped.length, 0);
    assert.equal(planned.tasks.length, 1);
    assert.equal(planned.tasks[0].incremental, false);
    assert.equal(Date.parse(planned.tasks[0].queryStartAt), Date.parse(START));
    assert.equal(planned.tasks[0].dataParcTag, SIGNAL);
    const first = await createProbe(f);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(Date.parse(first.body.item.probe.startAt), Date.parse(START));
    assert.deepEqual(f.read(), initialized);
    const saved = await completeProbe(f, first.body.item, 36001);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.runtimeHours, 36001 / 3600);
    assert.notEqual(saved.body.incremental, true);
    const afterFirst = await f.view();
    assert.equal(afterFirst.measurementRequired, false);
    assert.equal(afterFirst.runtimeHours, 36001 / 3600);
    assert.equal(afterFirst.cycleElapsedHours, 36001 / 3600);
    assert.equal(afterFirst.dataParcRuntimeBasis.appendReady, true);
    assert.equal(afterFirst.dataParcRuntimeBasis.runningSeconds, 36001);
    assert.equal(afterFirst.cycleBasisKind, 'initial_startup');
    assert.equal(afterFirst.actualLastReplacementAt, '');
    f.advance(3600000);
    const second = await createProbe(f);
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(Date.parse(second.body.item.probe.startAt), Date.parse(first.body.item.probe.endAt));
    const appended = await completeProbe(f, second.body.item, 1555);
    assert.equal(appended.status, 200, JSON.stringify(appended.body));
    assert.equal(appended.body.incremental, true);
    assert.equal(appended.body.addedRunningSeconds, 1555);
    assert.equal(appended.body.runtimeHours, 37556 / 3600);
    assert.deepEqual(f.events().find(e => e.id === initialEvent.id), initialEvent);
    const beforeReplay = f.allRows();
    const replay = await f.post({ action: 'dataparc_runtime_sync', requestId: second.body.item.id });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(f.allRows(), beforeReplay);
  } finally { f.close(); }
});

test('a later actual V-Belt replacement takes over the cycle without rewriting the original startup evidence', async () => {
  const f = await setup();
  try {
    assert.equal((await f.post()).status, 200);
    const initialEvent = f.events()[0], replacement = '2026-10-28T13:00:00+09:00';
    const response = await f.post({ action: 'replacement', tagNumber: TAG, eventDate: replacement,
      issueType: '정기주기', actionType: '교체', note: 'Fixture actual replacement', startImmediately: false });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const view = await f.view();
    assert.equal(view.cycleBasisKind, 'replacement');
    assert.equal(Date.parse(view.actualLastReplacementAt), Date.parse(replacement));
    assert.equal(Date.parse(view.lastReplacementAt), Date.parse(replacement));
    assert.equal(view.dataParcTag, SIGNAL);
    const next = refresh.plan([view], new Date()).tasks[0];
    assert.equal(Date.parse(next.queryStartAt), Date.parse(replacement));
    assert.deepEqual(f.events().find(e => e.id === initialEvent.id), initialEvent);
    assert.equal(f.events().filter(e => e.event_type === 'replacement').length, 1);
    const before = f.allRows(), repeated = await f.post();
    assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
    assert.equal(repeated.body.disposition, 'existing_cycle');
    assert.deepEqual(f.allRows(), before);
  } finally { f.close(); }
});

function mutationIdentity(f, event) {
  const asset = f.read();
  return { tagNumber: TAG, eventId: event.id, expectedEventUpdatedAt: event.updated_at,
    expectedLastReplacementAt: asset.last_replacement_at || '',
    expectedCycleStartRevision: asset.cycle_start_revision, expectedCycleRuntimeRevision: asset.cycle_runtime_revision };
}

async function assertProtected(f, event, nextType = event.event_type) {
  const before = f.allRows(), identity = mutationIdentity(f, event);
  for (const body of [
    { action: 'history_event_delete_preview', ...identity },
    { action: 'history_event_delete', ...identity, confirmDelete: true, previewToken: 'a'.repeat(64), changeNote: 'Fixture delete' },
    { action: 'history_event_edit', ...identity, eventType: nextType, eventDate: event.event_date,
      runtimeHours: event.runtime_hours, issueType: event.issue_type || '', actionType: event.action_type,
      note: 'Fixture change', changeNote: 'Fixture edit' }
  ]) {
    const response = await f.post(body);
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.code, 'INITIAL_STARTUP_BASIS_PROTECTED');
    assert.deepEqual(f.allRows(), before);
  }
}

test('the initial startup evidence cannot be edited or deleted before or after a real replacement', async () => {
  const f = await setup();
  try {
    assert.equal((await f.post()).status, 200);
    const initial = f.events()[0];
    await assertProtected(f, initial, 'replacement');
    const replaced = await f.post({ action: 'replacement', tagNumber: TAG, eventDate: '2026-10-28T13:00:00+09:00' });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    await assertProtected(f, initial, 'problem');
  } finally { f.close(); }
});

test('generic edit and deletion cannot rebuild an active initial cycle from only replacement records', async () => {
  const f = await setup();
  try {
    assert.equal((await f.post()).status, 200);
    const request = await createProbe(f);
    assert.equal(request.status, 201, JSON.stringify(request.body));
    const measured = await completeProbe(f, request.body.item, 36001);
    assert.equal(measured.status, 200, JSON.stringify(measured.body));
    const runtime = f.events().find(e => e.source_type === 'dataparc_runtime');
    await assertProtected(f, runtime);
    assert.equal((await f.view()).cycleBasisKind, 'initial_startup');
    assert.equal(f.read().cycle_runtime_hours, 36001 / 3600);
  } finally { f.close(); }
});

test('deleting or retyping the sole real replacement cannot discard the retained initial baseline', async () => {
  const f = await setup();
  try {
    assert.equal((await f.post()).status, 200);
    const replaced = await f.post({ action: 'replacement', tagNumber: TAG, eventDate: '2026-10-28T13:00:00+09:00' });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    const actual = f.events().find(e => e.event_type === 'replacement');
    await assertProtected(f, actual, 'problem');
    assert.equal((await f.view()).cycleBasisKind, 'replacement');
  } finally { f.close(); }
});

test('problem history remains editable and deletable while the initial runtime basis is protected', async () => {
  const f = await setup();
  try {
    assert.equal((await f.post()).status, 200);
    const asset = f.read();
    f.addEvent();
    let event = f.events().find(e => e.id === 'fixture-existing-event');
    const edited = await f.post({ action: 'history_event_edit', ...mutationIdentity(f, event), eventType: 'problem',
      eventDate: START, runtimeHours: 0, issueType: '점검', actionType: '확인', note: 'Fixture revised issue', changeNote: 'Fixture edit' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.deepEqual(f.read(), asset);
    event = f.events().find(e => e.id === event.id);
    const preview = await f.post({ action: 'history_event_delete_preview', ...mutationIdentity(f, event) });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const deleted = await f.post({ action: 'history_event_delete', ...mutationIdentity(f, event),
      confirmDelete: true, previewToken: preview.body.previewToken, changeNote: 'Fixture delete' });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.deepEqual(f.read(), asset);
    assert.equal((await f.view()).cycleBasisKind, 'initial_startup');
  } finally { f.close(); }
});

for (const [label, sql] of [
  ['tampered source', "UPDATE blower_history_events SET source_text='{}' WHERE source_type='initial_startup_confirmed'"],
  ['soft-deleted event', "UPDATE blower_history_events SET event_type='_deleted' WHERE source_type='initial_startup_confirmed'"],
  ['changed event timestamp', "UPDATE blower_history_events SET updated_at='2026-10-29T00:37:21.000Z' WHERE source_type='initial_startup_confirmed'"],
  ['missing event with retained initialization audit', "DELETE FROM blower_history_events WHERE source_type='initial_startup_confirmed'"]
]) test(label + ' cannot silently reinitialize or relabel the initial basis as a replacement', async () => {
  const f = await setup();
  try {
    assert.equal((await f.post()).status, 200);
    f.sqlite.exec(sql);
    const before = f.allRows(), response = await f.post();
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.code, 'MANURE_INITIAL_RUN_CONFLICT');
    assert.deepEqual(f.allRows(), before);
    const read = await f.get();
    assert.equal(read.status, 200, JSON.stringify(read.body));
    const view = read.body.assets[0];
    assert.equal(view.tagNumber, TAG);
    assert.equal(view.cycleBasisKind, 'initial_startup');
    assert.equal(view.initialStartupEvidenceValid, false);
    assert.equal(view.actualLastReplacementAt, '');
    assert.equal(Date.parse(view.initialStartedAt), Date.parse(START));
    assert.deepEqual(f.allRows(), before, 'audit fallback is a read projection, never a recreation of the damaged event');
  } finally { f.close(); }
});
