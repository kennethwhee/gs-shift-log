import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { __oisDataRequestsTest } from '../functions/api/ois-data-requests.js';

const require = createRequire(import.meta.url);
const { ORGANIC_SILO_TAGS, normalizeOrganicSiloResult } = require('../local-tools/ois-agent/organic-silo-dataparc-agent.js');

test('reader report -> Agent -> API storage -> card/export preserves one dated inventory and unrelated fields', () => {
  // Synthetic controller documents shaped like the shipped PowerShell output.
  const date = '2026-08-01';
  const values = [10.216522216796875, 0.1611328125, 9.6826171875];
  const samples = ORGANIC_SILO_TAGS.map((definition, index) => ({
    ...definition, date, value: values[index], qualityText: 'Raw, Good', qualityGood: true,
    validNonNegativeValue: true, returnedTimeText: date + ' 00:00:00', statistic: 'End',
    periodStartKst: date + ' 00:00:00+09:00', periodEndKst: '2026-08-02 00:00:00+09:00'
  }));
  const raw = JSON.parse(JSON.stringify({
    schemaVersion: 1, source: 'dataparc_hidden_excel', mode: 'organic_silo_dataparc',
    runId: '7'.repeat(32), targetDate: date, aggregation: 'End', step: '1D',
    intervalStartKst: date + 'T00:00:00+09:00', intervalEndKst: '2026-08-02T00:00:00+09:00',
    allCellsReturned: true, allValuesValid: true, allQualitiesGood: true,
    qualityValidationVersion: '1.2', ok: true, cleanupVerified: true, databaseWritten: false,
    samples, targetValues: {
      ...Object.fromEntries(samples.map(sample => [sample.key, sample.value])),
      organicSiloTotal: values.reduce((sum, value) => sum + value, 0)
    }
  }));
  const report = {
    schemaVersion: 1, mode: raw.mode, runId: raw.runId, targetDate: date, ok: true,
    cleanupVerified: true, timedOut: false, workerExitCode: 0, resultReceived: true, resultOk: true,
    failure: null, cleanupErrors: [], databaseWritten: false,
    ownedExcel: { ProcessId: 5000, Path: 'C:\\Program Files\\Microsoft Office\\Office16\\EXCEL.EXE' }
  };
  const outgoing = normalizeOrganicSiloResult(raw, report, date);
  const storage = __oisDataRequestsTest.normalizeOrganicSiloDataParcResult(JSON.parse(JSON.stringify(outgoing)), date);
  assert.equal(storage.error, undefined);
  const saved = { id: 'contract-request', status: 'complete', requestType: raw.mode, targetDate: date,
    completedAt: '2026-09-08T12:00:00Z', result: JSON.parse(JSON.stringify(storage.result)) };
  const window = {};
  const context = vm.createContext({ window, Map, Set, Date, console,
    document: { readyState: 'loading', addEventListener() {}, getElementById(id) {
      return id === 'efficiencyMorningMeetingWaterPanel' ? { dataset: { morningMeetingAutoBaseDate: date } } : null;
    } }
  });
  vm.runInContext(readFileSync(new URL('../maintenance/morning-meeting-organic-silo-dataparc.js', import.meta.url), 'utf8'), context);
  assert.ok(window.organicSiloDataParc.validateResult(saved, date));
  assert.equal(window.organicSiloDataParc.restoreCompleted([saved], date), true);
  const daily = { targetDate: date, generatorEcmsGen1: 800, steamSales: 950, sludgeTotal: 30,
    sludgeTruckCount: 3, organicSiloTotal: 100 };
  const before = JSON.stringify(daily);
  const exported = window.organicSiloDataParc.valuesForWorkbook(daily);
  assert.equal(exported.organicSiloTotal, 20.060272216796875);
  assert.equal(exported.organicDaySilo, values[0]);
  assert.equal(exported.sludgeTotal, 30);
  assert.equal(exported.sludgeTruckCount, 3);
  assert.equal(exported.generatorEcmsGen1, 800);
  assert.equal(exported.steamSales, 950);
  assert.equal(JSON.stringify(daily), before);
});
