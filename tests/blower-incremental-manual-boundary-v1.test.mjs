import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedAppendBase, loadAppendBase } from '../functions/_shared/blower-incremental.js';

const TAG = '104HHL60AP611';
const SIGNAL = 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_104HHL60AP611';
const REPLACEMENT = '2026-09-04T00:00:00+09:00';
const DP_END = '2026-09-11T07:33:00+09:00';
const MANUAL_STOP = '2026-09-11T08:00:00+09:00';

function dpRow({runningSeconds = 0, endState = 'running'} = {}) {
  const requestId = 'q-before-manual-stop';
  const runtimeHours = runningSeconds / 3600;
  return {
    id: `dataparc_runtime:${requestId}`,
    tag_number: TAG,
    event_type: 'runtime_correction',
    event_date: DP_END,
    runtime_hours: runtimeHours,
    source_type: 'dataparc_runtime',
    source_log_id: requestId,
    source_text: JSON.stringify({
      schemaVersion: 1,
      requestType: 'blower_runtime_probe',
      requestId,
      assetTag: TAG,
      dataParcTag: SIGNAL,
      startAt: REPLACEMENT,
      endAt: DP_END,
      observedAt: DP_END,
      expectedLastReplacementAt: REPLACEMENT,
      expectedCycleStartState: 'legacy',
      expectedCycleStartedAt: '',
      expectedCycleStartRevision: 'start-r1',
      expectedCycleRuntimeRevision: 'runtime-dp-r1',
      startState: 'stopped',
      endState,
      runningSeconds,
      totalRunningHours: runtimeHours
    }),
    created_at: DP_END,
    updated_at: DP_END
  };
}

function manualStopRow(runtimeHours = 0) {
  return {
    id: 'manual-stop-1',
    tag_number: TAG,
    event_type: 'operation_stop',
    event_date: MANUAL_STOP,
    runtime_hours: runtimeHours,
    source_type: 'manual',
    source_log_id: '',
    source_text: '',
    created_at: MANUAL_STOP,
    updated_at: MANUAL_STOP
  };
}

function asset(runtimeHours = 0) {
  return {
    tag_number: TAG,
    last_replacement_at: REPLACEMENT,
    cycle_start_state: 'legacy',
    cycle_started_at: null,
    cycle_start_revision: 'start-r1',
    cycle_runtime_hours: runtimeHours,
    cycle_runtime_anchor_at: MANUAL_STOP,
    cycle_runtime_state: 'stopped',
    cycle_runtime_revision: 'runtime-manual-stop-r2'
  };
}

test('manual stop after a successful DataPARC result preserves the prior result as an append base', () => {
  const base = verifiedAppendBase(asset(0), [manualStopRow(0), dpRow({runningSeconds: 0, endState: 'running'})], SIGNAL);
  assert.ok(base);
  assert.equal(base.requestId, 'q-before-manual-stop');
  assert.equal(base.observedAt, DP_END);
  assert.equal(base.startAt, REPLACEMENT);
  assert.equal(base.runningSeconds, 0);
  assert.equal(base.state, 'running');
  assert.equal(base.cycleRuntimeRevision, 'runtime-manual-stop-r2');
});

test('loadAppendBase reads history beyond the current manual anchor and returns the DataPARC predecessor', async () => {
  const rows = [manualStopRow(0), dpRow({runningSeconds: 0, endState: 'running'})];
  let sql = '', params = [];
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
  const base = await loadAppendBase(database, asset(0), SIGNAL);
  assert.ok(base);
  assert.equal(base.requestId, 'q-before-manual-stop');
  assert.match(sql, /WHERE tag_number = \? AND event_type IN/);
  assert.doesNotMatch(sql, /AND event_date = \?/);
  assert.deepEqual(params, [TAG]);
});

test('manual runtime correction or changed cumulative value still fails closed', () => {
  const dp = dpRow({runningSeconds: 0, endState: 'running'});
  const correction = {
    ...manualStopRow(1),
    id: 'manual-runtime-correction',
    event_type: 'runtime_correction',
    action_type: '누적시간 수정'
  };
  assert.equal(verifiedAppendBase(asset(1), [correction, dp], SIGNAL), null);

  // Even a stop marker is not allowed to borrow a DataPARC base when the stored total differs.
  assert.equal(verifiedAppendBase(asset(1), [manualStopRow(1), dp], SIGNAL), null);
});

test('an arbitrary anchor/state mutation without a real manual boundary event remains unverified', () => {
  const dp = dpRow({runningSeconds: 0, endState: 'running'});
  assert.equal(verifiedAppendBase(asset(0), [dp], SIGNAL), null);
});
