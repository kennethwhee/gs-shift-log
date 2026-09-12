import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { verifiedAppendBase, loadAppendBase } from '../functions/_shared/blower-incremental.js';
import { __blowerHistoryTest as history } from '../functions/api/blower-history.js';

const refresh = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');

const CASES = [
  {
    tag: '104HHL60AP611',
    signal: 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_104HHL60AP611',
    replacement: '2026-09-04T00:00:00+09:00',
    observedAt: '2026-09-11T07:33:00+09:00',
    manualAt: '2026-09-11T07:34:00+09:00'
  },
  {
    tag: '204HHL60AP621',
    signal: 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_204HHL60AP621',
    replacement: '2026-08-27T00:00:00+09:00',
    observedAt: '2026-09-11T07:36:00+09:00',
    manualAt: '2026-09-11T07:37:00+09:00'
  }
];

function dataParcRow(item, { runningSeconds = 0, endState = 'running', cycleStartRevision = 'start-r1' } = {}) {
  const requestId = `query-${item.tag}`;
  const runtimeHours = runningSeconds / 3600;
  return {
    id: `dataparc_runtime:${requestId}`,
    tag_number: item.tag,
    event_type: 'runtime_correction',
    event_date: item.observedAt,
    runtime_hours: runtimeHours,
    source_type: 'dataparc_runtime',
    source_log_id: requestId,
    source_text: JSON.stringify({
      schemaVersion: 1,
      requestType: 'blower_runtime_probe',
      requestId,
      assetTag: item.tag,
      dataParcTag: item.signal,
      startAt: item.replacement,
      endAt: item.observedAt,
      observedAt: item.observedAt,
      expectedLastReplacementAt: item.replacement,
      expectedCycleStartState: 'legacy',
      expectedCycleStartedAt: '',
      expectedCycleStartRevision: cycleStartRevision,
      expectedCycleRuntimeRevision: 'runtime-dataparc-r1',
      startState: 'stopped',
      endState,
      runningSeconds,
      totalRunningHours: runtimeHours
    }),
    created_at: item.observedAt,
    updated_at: item.observedAt
  };
}

function asset(item, {
  runtimeHours = 0,
  state = 'stopped',
  anchorAt = item.manualAt,
  startState = 'legacy',
  startRevision = 'start-r1'
} = {}) {
  return {
    tag_number: item.tag,
    last_replacement_at: item.replacement,
    cycle_start_state: startState,
    cycle_started_at: null,
    cycle_start_revision: startRevision,
    cycle_runtime_hours: runtimeHours,
    cycle_runtime_anchor_at: anchorAt,
    cycle_runtime_state: state,
    cycle_runtime_revision: `runtime-manual-${item.tag}`
  };
}

function manualCorrection(item, {
  id = `manual-correction-${item.tag}`,
  eventDate = item.manualAt,
  runtimeHours = 0,
  actionType = '정지',
  sourceType = 'manual',
  createdAt = eventDate
} = {}) {
  return {
    id,
    tag_number: item.tag,
    event_type: 'runtime_correction',
    event_date: eventDate,
    runtime_hours: runtimeHours,
    action_type: actionType,
    source_type: sourceType,
    source_log_id: '',
    source_text: '',
    created_at: createdAt,
    updated_at: createdAt
  };
}

function manualOperation(item, eventType, {
  id = `${eventType}-${item.tag}`,
  eventDate = item.manualAt,
  runtimeHours = 0,
  sourceType = 'manual'
} = {}) {
  return {
    id,
    tag_number: item.tag,
    event_type: eventType,
    event_date: eventDate,
    runtime_hours: runtimeHours,
    action_type: '',
    source_type: sourceType,
    source_log_id: '',
    source_text: '',
    created_at: eventDate,
    updated_at: eventDate
  };
}

test('FBHE #1-A and #2-B keep a verified DataPARC append base after an equal zero-hour manual stop correction', () => {
  for (const item of CASES) {
    const current = asset(item);
    const correction = manualCorrection(item);
    const dataParc = dataParcRow(item);
    const base = verifiedAppendBase(current, [correction, dataParc], item.signal);

    assert.ok(base, item.tag);
    assert.equal(base.eventId, dataParc.id, item.tag);
    assert.equal(base.requestId, dataParc.source_log_id, item.tag);
    assert.equal(base.startAt, item.replacement, item.tag);
    assert.equal(base.observedAt, item.observedAt, item.tag);
    assert.equal(base.runningSeconds, 0, item.tag);
    assert.equal(base.runtimeHours, 0, item.tag);
    assert.equal(base.state, 'running', item.tag);
    assert.equal(base.cycleRuntimeRevision, current.cycle_runtime_revision, item.tag);
  }
});

test('the real #1-A and #2-B cards are planned from their last DataPARC endpoints instead of being skipped', () => {
  for (const item of CASES) {
    const current = asset(item);
    const rows = [manualCorrection(item), dataParcRow(item)];
    const basis = history.currentDataParcRuntimeBasis(current, rows);
    assert.ok(basis, item.tag);
    assert.equal(basis.appendReady, true, item.tag);

    const planned = refresh.plan([{
      tagNumber: item.tag,
      displayName: item.tag === '104HHL60AP611' ? '#1호기 · #A' : '#2호기 · #B',
      enabled: true,
      lastReplacementAt: item.replacement,
      cycleStartState: 'legacy',
      cycleStartedAt: '',
      cycleStartRevision: current.cycle_start_revision,
      cycleRuntimeRevision: current.cycle_runtime_revision,
      dataParcTag: item.signal,
      dataParcRuntimeBasis: basis
    }], new Date('2026-09-11T03:00:00.000Z'));

    assert.equal(planned.skipped.length, 0, item.tag);
    assert.equal(planned.tasks.length, 1, item.tag);
    assert.equal(planned.tasks[0].incremental, true, item.tag);
    assert.equal(planned.tasks[0].queryStartAt, item.observedAt, item.tag);
  }
});

test('loadAppendBase reads past the current manual runtime correction and returns the DataPARC predecessor', async () => {
  const item = CASES[0];
  const rows = [manualCorrection(item), dataParcRow(item)];
  let sql = '';
  let params = [];
  const database = {
    prepare(text) {
      sql = text;
      return {
        bind(...values) {
          params = values;
          return { async all() { return { results: rows }; } };
        }
      };
    }
  };

  const base = await loadAppendBase(database, asset(item), item.signal);
  assert.ok(base);
  assert.equal(base.observedAt, item.observedAt);
  assert.match(sql, /event_type IN \('runtime_correction','startup','operation_start','operation_stop'\)/);
  assert.match(sql, /datetime\(event_date\) >= datetime\(\?\)/);
  assert.deepEqual(params, [item.tag, item.replacement]);
});

test('loadAppendBase excludes pre-replacement rows using absolute SQLite datetime comparison', async () => {
  const item = CASES[0];
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(`CREATE TABLE blower_history_events (
      id TEXT PRIMARY KEY,
      tag_number TEXT,
      event_type TEXT,
      event_date TEXT,
      runtime_hours REAL,
      action_type TEXT,
      source_type TEXT,
      source_log_id TEXT,
      source_text TEXT,
      created_at TEXT,
      updated_at TEXT
    )`);
    const insert = sql.prepare(`INSERT INTO blower_history_events
      (id, tag_number, event_type, event_date, runtime_hours, action_type, source_type,
       source_log_id, source_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const rows = [
      {
        ...manualCorrection(item),
        id: 'old-cycle-row',
        // This looks later lexically than 00:00 +09:00, but is 4.5 hours earlier in UTC.
        event_date: '2026-09-04T00:30:00+14:00',
        created_at: '2026-09-04T00:30:00+14:00',
        updated_at: '2026-09-04T00:30:00+14:00'
      },
      dataParcRow(item),
      manualCorrection(item)
    ];
    for (const row of rows) {
      insert.run(
        row.id, row.tag_number, row.event_type, row.event_date, row.runtime_hours,
        row.action_type || '', row.source_type, row.source_log_id || '', row.source_text || '',
        row.created_at, row.updated_at
      );
    }

    let selectedIds = [];
    const database = {
      prepare(text) {
        let values = [];
        return {
          bind(...next) {
            values = next;
            return this;
          },
          async all() {
            const results = sql.prepare(text).all(...values);
            selectedIds = results.map(row => row.id);
            return { results };
          }
        };
      }
    };

    const base = await loadAppendBase(database, asset(item), item.signal);
    assert.ok(base);
    assert.equal(base.observedAt, item.observedAt);
    assert.ok(selectedIds.includes(`manual-correction-${item.tag}`));
    assert.ok(selectedIds.includes(`dataparc_runtime:query-${item.tag}`));
    assert.ok(!selectedIds.includes('old-cycle-row'));
  } finally {
    sql.close();
  }
});

test('exact English running/stopped actions are accepted case-insensitively and must match the asset state', () => {
  const item = CASES[0];
  const dataParc = dataParcRow(item, { endState: 'stopped' });
  const running = manualCorrection(item, { actionType: 'RUNNING' });
  assert.ok(verifiedAppendBase(asset(item, { state: 'running' }), [running, dataParc], item.signal));

  const stopped = manualCorrection(item, { actionType: 'Stopped' });
  assert.ok(verifiedAppendBase(asset(item), [stopped, dataParc], item.signal));
  assert.equal(verifiedAppendBase(asset(item, { state: 'running' }), [stopped, dataParc], item.signal), null);
});

test('the existing manual operation_start/operation_stop append path remains valid', () => {
  const item = CASES[0];
  const dataParc = dataParcRow(item, { endState: 'running' });
  const stopped = manualOperation(item, 'operation_stop');
  assert.ok(verifiedAppendBase(asset(item), [stopped, dataParc], item.signal));

  const started = manualOperation(item, 'operation_start');
  assert.ok(verifiedAppendBase(asset(item, { state: 'running' }), [started, dataParc], item.signal));
});

test('all overlays through the current anchor must be manual, parseable, and keep the same cumulative value', () => {
  const item = { ...CASES[0], manualAt: '2026-09-11T08:10:00+09:00' };
  const dataParc = dataParcRow(item, { endState: 'stopped' });
  const intermediate = manualOperation(item, 'operation_start', {
    id: 'manual-start-between',
    eventDate: '2026-09-11T08:00:00+09:00'
  });
  const current = manualCorrection(item);
  assert.ok(verifiedAppendBase(asset(item), [current, intermediate, dataParc], item.signal));

  const nonManual = { ...intermediate, id: 'automatic-overlay', source_type: 'shift_log_operation_auto' };
  assert.equal(verifiedAppendBase(asset(item), [current, nonManual, dataParc], item.signal), null);

  const unknown = manualCorrection(item, {
    id: 'unknown-overlay',
    eventDate: '2026-09-11T08:00:00+09:00',
    actionType: '정지 확인'
  });
  assert.equal(verifiedAppendBase(asset(item), [current, unknown, dataParc], item.signal), null);

  const changed = manualOperation(item, 'operation_start', {
    id: 'changed-overlay',
    eventDate: '2026-09-11T08:00:00+09:00',
    runtimeHours: 0.1
  });
  assert.equal(verifiedAppendBase(asset(item), [current, changed, dataParc], item.signal), null);
});

test('different totals, unknown actions, startup, pending cycles, and cycle mismatches fail closed', () => {
  const item = CASES[1];
  const dataParc = dataParcRow(item);

  assert.equal(verifiedAppendBase(
    asset(item, { runtimeHours: 1 }),
    [manualCorrection(item, { runtimeHours: 1 }), dataParc],
    item.signal
  ), null);

  assert.equal(verifiedAppendBase(
    asset(item),
    [manualCorrection(item, { actionType: '수동 정지' }), dataParc],
    item.signal
  ), null);

  assert.equal(verifiedAppendBase(
    asset(item),
    [manualOperation(item, 'startup'), dataParc],
    item.signal
  ), null);

  assert.equal(verifiedAppendBase(
    asset(item, { startState: 'pending' }),
    [manualCorrection(item), dataParc],
    item.signal
  ), null);

  assert.equal(verifiedAppendBase(
    asset(item, { startRevision: 'changed-cycle' }),
    [manualCorrection(item), dataParc],
    item.signal
  ), null);
});

test('manual runtime equality uses an inclusive 1e-6 tolerance and rejects anything larger', () => {
  const item = CASES[0];
  const dataParc = dataParcRow(item, { endState: 'stopped' });
  const within = 0.000001;
  assert.ok(verifiedAppendBase(
    asset(item, { runtimeHours: within }),
    [manualCorrection(item, { runtimeHours: within }), dataParc],
    item.signal
  ));

  const outside = 0.0000011;
  assert.equal(verifiedAppendBase(
    asset(item, { runtimeHours: outside }),
    [manualCorrection(item, { runtimeHours: outside }), dataParc],
    item.signal
  ), null);
});

test('a correction at or before the last DataPARC observedAt is not treated as a later overlay', () => {
  const baseItem = CASES[0];
  const item = { ...baseItem, manualAt: baseItem.observedAt };
  const correction = manualCorrection(item, { createdAt: '2026-09-11T07:34:00+09:00' });
  assert.equal(verifiedAppendBase(asset(item), [correction, dataParcRow(item)], item.signal), null);
});
