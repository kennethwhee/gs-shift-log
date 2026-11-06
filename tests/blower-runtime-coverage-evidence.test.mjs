import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
import { buildRuntimeCoverageEvidence, currentManualRuntimeMeasurement } from '../functions/_shared/blower-runtime-coverage-evidence.js';
import { replacementAutoCycleProof } from '../functions/_shared/blower-replacement-auto-v3.js';

const ORIGIN = '2026-08-01T00:00:00.000Z';
const START = '2026-08-01T01:00:00.000Z';
const END = '2026-11-06T00:00:00.000Z';
const NOW = new Date('2026-11-06T00:01:00.000Z');
const TAGS = ['104HHL60AP611','104HHL60AP621','104HHL60AP631','204HHL60AP611','204HHL60AP621','204HHL60AP631',
  '104HHL10AN611','104HHL10AN621','104HHL10AN631','204HHL10AN611','204HHL10AN621','204HHL10AN631',
  '104SDF01AN001','104SDF01AN002','204SDF01AN001','204SDF01AN002','204LMDF01AN001',
  '104ETG30AN601','104ETG30AN602','204ETG30AN601','204ETG30AN602','104ETH03AN601','104ETH03AN602',
  '103HRJ01AN601','103HRJ01AN602','203HRJ01AN601','203HRJ01AN602'];
const signalFor = tag => tag === '104ETH03AN602' ? 'GSPOGE.ABB_DCS.003ETH03AN602XB04'
  : /^(?:103|203)HRJ/.test(tag) ? `GSPOGE.ABB_DCS.${tag}XB04` : `GSPOGE.ABB_DCS.TEST_ONLY_BINARY_${tag}`;

function memoryD1() {
  const sqlite = new DatabaseSync(':memory:');
  return { sqlite, prepare(sql) { return { values: [], bind(...values) { this.values = values; return this; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...this.values).changes) } }; },
    async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
    async first() { return sqlite.prepare(sql).get(...this.values) || null; } }; },
    async batch(statements) { sqlite.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
}
function insert(sqlite, row) {
  const keys = Object.keys(row);
  sqlite.prepare(`INSERT INTO blower_history_events(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(row));
}
function rawAsset(tag = TAGS[0], hours = 1) {
  return { tag_number: tag, last_replacement_at: ORIGIN, cycle_start_state: 'legacy', cycle_started_at: null,
    cycle_start_revision: 'start-r1', cycle_runtime_revision: 'runtime-r2', cycle_runtime_hours: hours,
    runtime_hours: hours, cycle_runtime_anchor_at: END, cycle_runtime_state: hours ? 'running' : 'stopped' };
}
function replacement(tag = TAGS[0]) {
  const id = `replacement:${tag}`, sourceId = `approved-replacement:${tag}`;
  const source = { schemaVersion: 3, replacementAutoV3: true, currentCycle: true,
    replacementEventId: id, currentLastReplacementAt: ORIGIN, timePrecision: 'minute',
    recordDate: '2026-08-01', registeredBaseline: false, cycleStartRevision: 'start-r1',
    cycleRuntimeRevision: 'runtime-r1', sourceKey: JSON.stringify([sourceId, tag, `approved-entry:${tag}`, 0]),
    sourceSnapshotSha256: 'a'.repeat(64), sourceText: '승인 업무일지: 09:00 V-Belt 교체 완료' };
  return { id, tag_number: tag, event_type: 'replacement', event_date: ORIGIN,
    runtime_hours: 0, source_type: 'shift_log_auto_v3', source_log_id: sourceId, source_text: JSON.stringify(source),
    created_at: ORIGIN, updated_at: ORIGIN, created_by_id: 'test', created_by_name: 'Test' };
}
function runtime(tag = TAGS[0], hours = 1, startAt = ORIGIN) {
  const source = { schemaVersion: 1, requestType: 'blower_runtime_probe', requestId: `coverage-${tag}`,
    assetTag: tag, dataParcTag: signalFor(tag), startAt, endAt: END, observedAt: END,
    expectedLastReplacementAt: ORIGIN, expectedCycleStartState: 'legacy', expectedCycleStartedAt: '',
    expectedCycleStartRevision: 'start-r1', expectedCycleRuntimeRevision: 'runtime-r1',
    startState: 'stopped', endState: hours ? 'running' : 'stopped', runningSeconds: Math.round(hours * 3600),
    totalRunningHours: hours, chunkCount: 1, collectedAt: END };
  return { id: `dataparc_runtime:${source.requestId}`, tag_number: tag, event_type: 'runtime_correction', event_date: END,
    runtime_hours: hours, source_type: 'dataparc_runtime', source_log_id: source.requestId, source_text: JSON.stringify(source),
    issue_type: 'DataPARC', action_type: hours ? 'DataPARC 운전중 동기화' : 'DataPARC 정지중 동기화', note: '',
    created_at: END, updated_at: END, created_by_id: 'test', created_by_name: 'Test' };
}
function projection({ asset = rawAsset(), rows, basis, review = null, automatic, initialBasis = null } = {}) {
  const events = rows || [runtime(asset.tag_number, asset.cycle_runtime_hours), replacement(asset.tag_number)];
  return buildRuntimeCoverageEvidence({ asset, rows: events, measuredBasis: basis === undefined
    ? api.currentDataParcRuntimeBasis(asset, events) : basis,
    runRuntime: api.fbheSealRunProvenance(asset, events, NOW),
    replacementAutoCycle: automatic === undefined ? replacementAutoCycleProof(asset, events) : automatic,
    cycleSourceReview: review, initialBasis });
}

test('all 27 API projections retain the owned RUN value and make no database writes', async t => {
  const db = memoryD1(), sql = db.sqlite; t.after(() => sql.close());
  await api.ensureSchema(db);
  for (const tag of TAGS) {
    const hours = tag === '204HHL60AP621' ? 1060.2 : tag === '104HHL10AN611' ? 0 : 1;
    const asset = rawAsset(tag, hours);
    sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,
      cycle_start_revision='start-r1',cycle_runtime_revision='runtime-r2',cycle_runtime_hours=?,runtime_hours=?,
      cycle_runtime_anchor_at=?,cycle_runtime_state=?,runtime_anchor_at=?,is_running=? WHERE tag_number=?`)
      .run(ORIGIN, hours, hours, END, asset.cycle_runtime_state, END, hours ? 1 : 0, tag);
    insert(sql, replacement(tag)); insert(sql, runtime(tag, hours));
  }
  const before = sql.prepare('SELECT total_changes() n').get().n;
  const storedBefore = sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all();
  const assets = await api.loadAssetStates(db, {}, { skipDecorations: true });
  assert.equal(assets.length, 27);
  for (const item of assets) {
    const evidence = item.runtimeCoverageEvidence;
    assert.equal(evidence.source, 'dataparc', item.tagNumber);
    assert.equal(evidence.measurementVerified, true, item.tagNumber);
    assert.equal(evidence.hours, item.cycleElapsedHours, item.tagNumber);
    assert.equal(evidence.startAt, ORIGIN);
    assert.equal(evidence.observedAt, END);
    assert.equal(evidence.wholeCycleVerified, true, item.tagNumber);
  }
  assert.equal(assets.find(a => a.tagNumber === '204HHL60AP621').runtimeCoverageEvidence.hours, 1060.2);
  assert.equal(assets.find(a => a.tagNumber === '104HHL10AN611').runtimeCoverageEvidence.hours, 0);
  assert.equal(sql.prepare('SELECT total_changes() n').get().n, before);
  assert.deepEqual(sql.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all(), storedBefore);
});

test('manual date-only and unverified explicit-time replacements preserve registered RUN without certifying a physical clock', async t => {
  for (const [input, normalized] of [
    ['2026-08-01', '2026-08-01T00:00:00+09:00'],
    ['2026-08-01T09:30', '2026-08-01T00:30:00.000Z']
  ]) {
    await t.test(input, async t => {
      const db = memoryD1(), sql = db.sqlite; t.after(() => sql.close());
      await api.ensureSchema(db);
      const tag = '204HHL60AP621', hours = 1060.2;
      sql.prepare("UPDATE blower_history_assets SET last_replacement_at=NULL WHERE tag_number=?").run(tag);
      // The replacement dialog posts its date input directly. Exercise the real
      // server normalization instead of treating its midnight as a known clock.
      const response = await api.handlePost({ env: { DB: db }, request: new Request('https://test/api/blower-history') },
        { employeeNo: 'test', name: 'Test' }, { action: 'replacement', tagNumber: tag, eventDate: input });
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
      const manual = sql.prepare("SELECT * FROM blower_history_events WHERE tag_number=? AND event_type='replacement'").get(tag);
      assert.equal(manual.event_date, normalized);
      assert.equal(manual.source_type, 'manual');
      assert.equal(manual.source_text, '');

      // A later owned receipt covers the entire registered range. Its RUN value
      // remains valid, while the original manual completion clock is unproved.
      const asset = { ...rawAsset(tag, hours), last_replacement_at: normalized };
      const receipt = runtime(tag, hours, normalized);
      const source = JSON.parse(receipt.source_text);
      source.expectedLastReplacementAt = normalized;
      receipt.source_text = JSON.stringify(source);
      const rows = [receipt, manual];
      assert.equal(replacementAutoCycleProof(asset, rows), null);
      const before = JSON.stringify({ asset, rows });
      const evidence = projection({ asset, rows });
      assert.equal(evidence.measurementVerified, true);
      assert.equal(evidence.source, 'dataparc');
      assert.equal(evidence.hours, hours);
      assert.equal(evidence.coverageComplete, true);
      assert.equal(evidence.missingLeadingSeconds, 0);
      assert.equal(evidence.cycleBasisConfirmed, false);
      assert.equal(evidence.wholeCycleVerified, false);
      assert.equal(JSON.stringify({ asset, rows }), before);
    });
  }
});

test('complete measured interval with an unresolved physical basis stays a measured interval', () => {
  const asset = rawAsset();
  const rows = [runtime()];
  const basis = api.currentDataParcRuntimeBasis(asset, rows);
  const before = JSON.stringify({ asset, rows, basis });
  const evidence = projection({ asset, rows, basis, review: { code: 'VERIFIED_RUNTIME_RANGE', cycleBasisConfirmed: false },
    automatic: { schemaVersion: 3, registeredRuntimeRange: true, clockKnown: false } });
  assert.equal(evidence.measurementVerified, true);
  assert.equal(evidence.coverageComplete, true, 'source uncertainty must not invent missing measured time');
  assert.equal(evidence.missingLeadingSeconds, 0);
  assert.equal(evidence.cycleBasisConfirmed, false);
  assert.equal(evidence.wholeCycleVerified, false);
  assert.equal(JSON.stringify({ asset, rows, basis }), before);
});

test('a real leading gap and an unqueried prefix before a registered restart never certify the whole belt cycle', () => {
  const asset = rawAsset();
  let rows = [runtime(TAGS[0], 1, START), replacement()];
  let basis = api.currentDataParcRuntimeBasis(asset, rows);
  const partial = projection({ asset, rows, basis });
  assert.equal(partial.coverageComplete, false);
  assert.equal(partial.missingLeadingSeconds, 3600);
  assert.equal(partial.cycleBasisConfirmed, true);
  assert.equal(partial.wholeCycleVerified, false);
  const restarted = { ...asset, cycle_start_state: 'started', cycle_started_at: START };
  const source = JSON.parse(rows[0].source_text);
  source.expectedCycleStartState = 'started'; source.expectedCycleStartedAt = START;
  rows = [{ ...rows[0], source_text: JSON.stringify(source) }, rows[1]];
  basis = api.currentDataParcRuntimeBasis(restarted, rows);
  assert.equal(basis.coverageComplete, true, 'legacy registered-start coverage may be complete');
  assert.equal(projection({ asset: restarted, rows, basis }).wholeCycleVerified, false,
    'the replacement-to-restart prefix still has no measured STOP evidence');
});

test('replacing the owned value, pending replacement, or damaged commissioning evidence cannot certify hours', () => {
  const asset = rawAsset();
  const basis = api.currentDataParcRuntimeBasis(asset, [runtime()]);
  assert.equal(projection({ asset: { ...asset, cycle_runtime_hours: 7 }, basis }).measurementVerified, false);
  const pending = projection({ asset: rawAsset(TAGS[0], 0), automatic: { schemaVersion: 3, requiresRunRefresh: true } });
  assert.equal(pending.hours, null);
  assert.equal(pending.measurementVerified, false);
  const tag = '204LMDF01AN001', manure = rawAsset(tag);
  const rows = [runtime(tag)];
  const invalid = projection({ asset: manure, rows, initialBasis: {
    cycleBasisKind: 'initial_startup', initialStartedAt: ORIGIN, initialStartupEvidenceValid: false } });
  assert.equal(invalid.wholeCycleVerified, false);
});

function manualRow(asset, extra = {}) {
  return { id: 'manual-current', tag_number: asset.tag_number, event_type: 'runtime_correction', event_date: END,
    runtime_hours: asset.cycle_runtime_hours, source_type: 'manual', source_text: '{}',
    issue_type: '수동 입력', action_type: '누적시간 보정', note: '', created_at: END, updated_at: END, ...extra };
}
const stateForEvent = row => row.testState || 'running';

test('only the current manual numeric correction owns a manual measurement, never startup zero or an old equal value', () => {
  const asset = rawAsset('104SDF01AN001');
  const current = manualRow(asset);
  assert.equal(currentManualRuntimeMeasurement(asset, [current], { now: NOW, stateForEvent }), current);
  for (const change of [
    { event_date: START }, { event_type: 'startup' }, { source_text: '{"replacementEdit":true}' },
    { source_text: '{"requiresRunRefresh":true}' }, { note: '진동 누적 적용' }, { testState: 'stopped' },
    { runtime_hours: null }, { runtime_hours: false }, { runtime_hours: '' }, { runtime_hours: ' ' }
  ]) assert.equal(currentManualRuntimeMeasurement(asset, [{ ...current, ...change }], { now: NOW, stateForEvent }), null, JSON.stringify(change));
  const zero = rawAsset('104SDF01AN001', 0);
  const actualZero = manualRow(zero);
  assert.equal(currentManualRuntimeMeasurement(zero, [actualZero], { now: NOW, stateForEvent: () => 'stopped' }), actualZero);
  for (const value of [null, false, '', ' ', [], {}]) {
    assert.equal(currentManualRuntimeMeasurement({ ...zero, cycle_runtime_hours: value }, [{ ...actualZero, runtime_hours: value }],
      { now: NOW, stateForEvent: () => 'stopped' }), null);
  }
});

test('generic API no longer promotes an older equal manual row or startup placeholder into verified RUN', async t => {
  const db = memoryD1(), sql = db.sqlite; t.after(() => sql.close());
  await api.ensureSchema(db);
  const tag = '104SDF01AN001';
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',
    cycle_runtime_hours=0,runtime_hours=0,cycle_runtime_anchor_at=?,cycle_runtime_state='stopped' WHERE tag_number=?`).run(ORIGIN, END, tag);
  insert(sql, { ...manualRow(rawAsset(tag, 0), { id: 'old-equal', event_date: START, action_type: '정지' }), created_by_id: 'test', created_by_name: 'Test' });
  insert(sql, { ...manualRow(rawAsset(tag, 0), { id: 'current-startup', event_type: 'startup', action_type: '기동' }), created_by_id: 'test', created_by_name: 'Test' });
  const before = sql.prepare('SELECT total_changes() n').get().n;
  const [projected] = await api.loadAssetStates(db, {}, { skipDecorations: true,
    assetRows: [sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag)] });
  assert.equal(projected.runtimeCoverageEvidence.measurementVerified, false);
  assert.equal(projected.runtimeCoverageEvidence.hours, null);
  assert.equal(projected.runtimeCoverageEvidence.source, 'unverified');
  assert.equal(sql.prepare('SELECT cycle_runtime_hours FROM blower_history_assets WHERE tag_number=?').get(tag).cycle_runtime_hours, 0,
    'stored counter is preserved; only the false verification is removed');
  assert.equal(sql.prepare('SELECT total_changes() n').get().n, before);
});

test('a newer conflicting owner at the same observation never falls back to an older equal manual value', () => {
  for (const tag of ['104SDF01AN001', '204HHL60AP621']) {
    const asset = rawAsset(tag), old = manualRow(asset);
    const newer = { ...old, id: 'newer-owner', runtime_hours: 2, updated_at: '2026-11-06T00:00:01.000Z' };
    assert.equal(currentManualRuntimeMeasurement(asset, [old, newer], { now: NOW, stateForEvent }), null);
    if (tag === '204HHL60AP621') {
      assert.equal(api.fbheSealRunProvenance(asset, [old, newer], NOW).verified, false);
    }
  }
});

test('generic evidence rejects an older equal RUN receipt when the latest same-anchor owner conflicts', () => {
  const genericTags = ['104SDF01AN001', '104ETG30AN601', '104ETH03AN601', '103HRJ01AN601'];
  const changedAt = '2026-11-06T00:00:01.000Z';
  for (const tag of genericTags) {
    for (const sourceType of ['manual', 'shift_log_operation_auto', 'dataparc_runtime']) {
      const asset = rawAsset(tag), receipt = runtime(tag), replacementRow = replacement(tag);
      let newer;
      if (sourceType === 'dataparc_runtime') {
        newer = runtime(tag, 2);
        const source = JSON.parse(newer.source_text);
        source.requestId = `newer-coverage-${tag}`;
        newer.id = `dataparc_runtime:${source.requestId}`;
        newer.source_log_id = source.requestId;
        newer.source_text = JSON.stringify(source);
      } else {
        newer = manualRow(asset, { runtime_hours: 2, source_type: sourceType });
        if (sourceType === 'shift_log_operation_auto') Object.assign(newer, {
          id: 'operation-auto:abcdef01:start', event_type: 'operation_start',
          source_log_id: 'approved-operation', action_type: '교체운전 자동 기동'
        });
      }
      newer.created_at = changedAt; newer.updated_at = changedAt;
      const rows = [newer, receipt, replacementRow], before = JSON.stringify({ asset, rows });
      const basis = api.currentDataParcRuntimeBasis(asset, rows);
      if (sourceType !== 'dataparc_runtime') assert.equal(basis?.appendReady, true,
        'the read-only evidence guard must reject stale ownership without changing the legacy append selector');
      const evidence = projection({ asset, rows, basis });
      assert.equal(evidence.source, 'unverified', `${tag}/${sourceType}`);
      assert.equal(evidence.measurementVerified, false, `${tag}/${sourceType}`);
      assert.equal(evidence.wholeCycleVerified, false, `${tag}/${sourceType}`);
      assert.equal(evidence.hours, null, `${tag}/${sourceType}`);
      assert.equal(evidence.coverageComplete, null, `${tag}/${sourceType}`);
      assert.equal(JSON.stringify({ asset, rows }), before, 'stored counters, receipts and query metadata stay untouched');
    }
  }
});

test('a valid latest RUN owner preserves both nonzero and measured-zero evidence despite an older conflicting row', () => {
  for (const hours of [1, 0]) {
    const asset = rawAsset('104SDF01AN001', hours), receipt = runtime(asset.tag_number, hours);
    const older = manualRow(asset, { runtime_hours: 2, created_at: '2026-11-05T23:59:59.000Z',
      updated_at: '2026-11-05T23:59:59.000Z' });
    const rows = [receipt, older, replacement(asset.tag_number)], before = JSON.stringify({ asset, rows });
    const evidence = projection({ asset, rows });
    assert.equal(evidence.source, 'dataparc');
    assert.equal(evidence.measurementVerified, true);
    assert.equal(evidence.hours, hours);
    assert.equal(evidence.wholeCycleVerified, true);
    assert.equal(evidence.observedAt, END);
    assert.equal(JSON.stringify({ asset, rows }), before);
  }
});

test('a valid current manual correction keeps its value and manual provenance, including zero', () => {
  for (const hours of [1, 0]) {
    const asset = rawAsset('104SDF01AN001', hours), receipt = runtime(asset.tag_number, hours);
    const manual = manualRow(asset, { created_at: '2026-11-06T00:00:01.000Z',
      updated_at: '2026-11-06T00:00:01.000Z', action_type: hours ? '운전중' : '정지' });
    const rows = [manual, receipt, replacement(asset.tag_number)], before = JSON.stringify({ asset, rows });
    const manualMeasurement = currentManualRuntimeMeasurement(asset, rows,
      { now: NOW, stateForEvent: row => row.action_type === '정지' ? 'stopped' : 'running' });
    const evidence = buildRuntimeCoverageEvidence({ asset, rows, manualMeasurement,
      measuredBasis: api.currentDataParcRuntimeBasis(asset, rows),
      replacementAutoCycle: replacementAutoCycleProof(asset, rows) });
    assert.equal(evidence.source, 'manual');
    assert.equal(evidence.measurementVerified, true);
    assert.equal(evidence.hours, hours);
    assert.equal(evidence.wholeCycleVerified, false);
    assert.equal(evidence.coverageComplete, null);
    assert.equal(evidence.observedAt, END);
    assert.equal(JSON.stringify({ asset, rows }), before);
  }
});

test('equal-value manual and automatic state boundaries retain their proven RUN interval without extending it', () => {
  const boundaryAt = '2026-11-06T00:00:30.000Z';
  for (const sourceType of ['manual', 'shift_log_operation_auto']) {
    const tag = '104ETG30AN601', asset = { ...rawAsset(tag),
      cycle_runtime_anchor_at: boundaryAt, cycle_runtime_state: 'stopped' };
    const receipt = runtime(tag);
    const boundary = manualRow(asset, { event_type: 'operation_stop', event_date: boundaryAt,
      source_type: sourceType, action_type: '정지', created_at: boundaryAt, updated_at: boundaryAt });
    if (sourceType === 'shift_log_operation_auto') Object.assign(boundary, {
      id: 'operation-auto:abcdef01:stop', source_log_id: 'approved-operation',
      action_type: '교체운전 자동 정지'
    });
    const rows = [boundary, receipt, replacement(tag)], before = JSON.stringify({ asset, rows });
    const evidence = projection({ asset, rows });
    assert.equal(evidence.source, 'dataparc', sourceType);
    assert.equal(evidence.measurementVerified, true, sourceType);
    assert.equal(evidence.hours, 1, sourceType);
    assert.equal(evidence.wholeCycleVerified, true, sourceType);
    assert.equal(evidence.observedAt, END, 'a later state boundary adds no measured RUN time');
    assert.equal(evidence.startAt, ORIGIN);
    assert.equal(JSON.stringify({ asset, rows }), before);
  }
});
