import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readStopMaintenanceDiary } from '../functions/api/blower-history.js';
import { blowerStopMaintenanceKind, loadBlowerStopMaintenance } from '../functions/_shared/blower-stop-maintenance.js';

const TAG = '204HHL60AP621';
const catalog = [
  { tag_number: '204HHL60AP611', blower_type: 'fbhe', unit_no: '2', position_label: '#A', enabled: 1 },
  { tag_number: TAG, blower_type: 'fbhe', unit_no: '2', position_label: '#B', enabled: 1 },
  { tag_number: '104HHL60AP621', blower_type: 'fbhe', unit_no: '1', position_label: '#B', enabled: 1 }
];
const pipeDiary = 'FBHE Blower #B Oil Leak 점검\n- FBHE Blower #B → #A 교체 운전\n- Oil 주입구 연결 파이프 교체 후 Tightening';
const fluidDiary = 'FBHE Blower #B 윤활유 교체 완료';
const observedAt = '2026-11-05T17:09:00.000Z';
const stoppedAsset = {
  tagNumber: TAG, unitNo: '2', lastReplacementAt: '2026-08-26T23:40:00.000Z',
  runRuntime: { verified: true, source: 'dataparc', state: 'stopped', measuredAt: observedAt },
  dataParcRuntimeBasis: { trailingStateStartedAt: '2026-10-30T04:37:56.000Z', observedAt }
};

function diary(content = pipeDiary, options = {}) {
  const { time = '13:27', role = 'BCO2', shift = 'DS', workDate = '2026-10-30', status = '결재완료' } = options;
  return { id: `${workDate}:${role}:${time}`, work_date: workDate, shift, role, status,
    log_json: JSON.stringify({ entries: [{ id: 'entry', content, time, category: '인계사항' }] }) };
}

const readFacts = row => readStopMaintenanceDiary(row, catalog);

async function loadNotes(rows, asset = stoppedAsset) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE shift_logs(id TEXT, work_date TEXT, shift TEXT, role TEXT, status TEXT, log_json TEXT);
    CREATE INDEX idx_shift_logs_work_date ON shift_logs(work_date);`);
  const insert = sqlite.prepare('INSERT INTO shift_logs VALUES (?, ?, ?, ?, ?, ?)');
  for (const row of rows) insert.run(row.id, row.work_date, row.shift, row.role, row.status, row.log_json);
  const reads = [];
  const database = { prepare(sql) {
    assert.match(sql, /^SELECT /);
    return { bind(...params) { reads.push(params); return { async all() { return { results: sqlite.prepare(sql).all(...params) }; } }; } };
  } };
  try {
    const notes = await loadBlowerStopMaintenance(database, [asset], readFacts);
    return { notes, reads };
  } finally {
    sqlite.close();
  }
}

test('the approved BCO2 oil leak entry identifies the stopped #B pipe work and its work clock', async () => {
  const expected = { kind: 'oil_fill_pipe', eventAt: '2026-10-30T04:27:00.000Z', workDate: '2026-10-30' };
  const { notes, reads } = await loadNotes([diary(), diary(pipeDiary, { role: 'BO2', time: '' }),
    diary(fluidDiary, { role: 'TGO' }), diary(fluidDiary, { status: '작성완료' }),
    diary(fluidDiary, { workDate: '2026-10-29' })]);
  assert.deepEqual(notes, new Map([[TAG, expected]]));
  assert.equal(reads.length, 1);
  assert.deepEqual(JSON.parse(reads[0][0]), ['2026-10-30']);
  assert.deepEqual(JSON.parse(reads[0][1]), ['BCO2', 'BO2']);
});

test('oil change is distinct from oil leak, oil filter, refill, and planned pipe jobs', () => {
  assert.equal(blowerStopMaintenanceKind(fluidDiary), 'oil_change');
  for (const text of ['Oil Leak 점검', '오일 필터 교체 완료', '오일 충유 완료', '오일 교체 예정',
    'Oil 주입구 연결 파이프 교체 완료 여부', '오일 교체 완료?']) assert.equal(blowerStopMaintenanceKind(text), '', text);
  assert.deepEqual(readFacts(diary(pipeDiary.replace('Oil 주입구 연결', 'FBHE Blower #A Oil 주입구 연결'))).maintenance, []);
});

test('unverified state, outside-window work, conflicting work, and belt replacement yield no note', async () => {
  const noTransition = { ...stoppedAsset, dataParcRuntimeBasis: { observedAt } };
  const { notes, reads } = await loadNotes([diary()], noTransition);
  assert.equal(notes.size, 0);
  assert.equal(reads.length, 0);
  assert.equal((await loadNotes([diary(pipeDiary, { time: '10:00' })])).notes.size, 0);
  assert.equal((await loadNotes([diary(), diary(fluidDiary, { time: '13:35' })])).notes.size, 0);
  assert.equal((await loadNotes([diary(), diary('FBHE Blower #B V-Belt 교체 완료', { time: '13:35' })])).notes.size, 0);
});

test('early NS work matches the prior work date, and a missing optional table leaves the dashboard undecorated', async () => {
  const asset = { ...stoppedAsset, dataParcRuntimeBasis: { ...stoppedAsset.dataParcRuntimeBasis,
    trailingStateStartedAt: '2026-10-30T17:37:56.000Z' } };
  const { notes, reads } = await loadNotes([diary(fluidDiary, { shift: 'NS', time: '02:27' })], asset);
  assert.deepEqual(notes.get(TAG), { kind: 'oil_change', eventAt: '2026-10-30T17:27:00.000Z', workDate: '2026-10-30' });
  assert.deepEqual(JSON.parse(reads[0][0]), ['2026-10-31', '2026-10-30']);
  const noTable = { prepare() { throw new Error('no such table: shift_logs'); } };
  assert.deepEqual(await loadBlowerStopMaintenance(noTable, [asset], readFacts), new Map());
});
