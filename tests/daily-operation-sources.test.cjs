const test = require('node:test');
const assert = require('node:assert/strict');
const source = require('../maintenance/daily-operation-sources.js');
const D = '2026-01-02', PREV = '2026-01-01';

function harness(overrides = {}) {
  const calls = [];
  const request = async (path, options = {}) => {
    const parsed = new URL(path, 'https://test.invalid'), action = parsed.searchParams.get('action'), day = parsed.searchParams.get('date') || parsed.searchParams.get('targetDate');
    const key = parsed.pathname + (action ? ':' + action : '');
    calls.push({key, path, options, day});
    if (overrides[key]) return overrides[key]({url: parsed, options, day, calls});
    if (options.method === 'POST') throw new Error('Unexpected Agent request');
    if (key.endsWith(':completed_history')) return {ok: true, items: [], overrides: [], resets: []};
    if (key.endsWith(':usage_records')) return {ok: true, targetDate: D, items: []};
    if (key.endsWith(':materials_history')) return {ok: true, items: []};
    if (key.endsWith(':daily_operation_data')) return {ok: true, targetDate: D, item: null};
    if (key === '/api/daily-operation-reports') return {ok: true, items: []};
    if (key === '/api/to-night-power') return {ok: true, targetDate: day, item: null};
    if (key === '/api/morning-meeting-card-overrides') return {ok: true, targetDate: day, items: {}};
    if (key === '/api/cofiring-closed-history') return {ok: true, item: null};
    if (key === '/api/limestone-receipts') return {ok: true, range: {startDate: D, endDate: D}, items: []};
    if (key === '/api/hydrated-lime-receipts') return {ok: true, month: D.slice(0, 7), items: []};
    if (key === '/api/bed-ash-discharge') return {ok: true, data: {range: {startDate: D, endDate: D}, events: [], unitCoverage: {}}};
    if (key === '/api/smp-price') return {ok: true, date: D, max: 100, min: 50, avg: 73};
    throw new Error('Unknown API ' + key);
  };
  return {request, calls};
}
function steam(day, values = {}) { return {id: 's-' + day, targetDate: day, status: 'complete', requestType: 'steam_status', result: {sourceDate: day, unitOneProduction: 6000, unitTwoProduction: 6100, steamSalesLowPressure: 100, steamSalesHighPressure: 200, ...values}}; }
function engine(values, day = D) { return {id: 'engine', targetDate: day, requestType: 'daily_operation_data', status: 'complete', result: {schemaVersion: 1, targetDate: day, source: 'dataparc_hidden_excel', cleanupVerified: true, startLocal: day + 'T00:00:00+09:00', endLocal: '2026-01-03T00:00:00+09:00', values, warnings: []}}; }
function closed(day = D) {
  const period = {startLocal: day + 'T00:00', endLocal: '2026-01-03T00:01'};
  const unit = (n, coal) => ({coal: {quantity: coal, counters: ['A1', 'A2', 'B1', 'B2'].map((s, i) => ({id: 'unit' + n + 'Coal' + s, complete: true, quantity: i + 1}))}, bio: {quantity: 20}, organic: {quantity: 15}});
  return {targetDate: day, sourceRequestId: 'closed', adjustmentApplied: true, snapshot: {schemaVersion: 1, targetDate: day, sourceRequestId: 'closed', period, result: {units: {unit1: unit(1, 10), unit2: unit(2, 10)}}}, effectiveResult: {period, units: {unit1: unit(1, 12), unit2: unit(2, 14)}}};
}

test('exact day source priority, TO kWh conversion, zero and editable inputs preserved', async () => {
  const h = harness({
    '/api/ois-data-requests:completed_history': () => ({ok: true, items: [steam(D), steam(PREV, {unitOneProduction: 999})], overrides: []}),
    '/api/to-night-power': ({day}) => ({ok: true, targetDate: day, item: {targetDate: day, unit: 'kWh', values: {generatorEcmsGen1: 4123456, epowerTransmission: 3500000, ismartReception: 0, solarDailyGeneration: 123.4}, updatedAt: '2026-01-03T01:02:03+09:00'}}),
    '/api/morning-meeting-card-overrides': ({day}) => ({ok: true, targetDate: day, items: {steam: {active: true, values: {unitOneProduction: 6123}}, power: {active: true, values: {epowerTransmission: 3550000}}}})
  });
  const out = await source.collect(D, {request: h.request, existingValues: {steam_u2_daily: 0}, missingFields: ['steam_u1_daily', 'steam_u2_daily', 'power_generation_daily', 'power_export_daily', 'power_import_daily', 'power_solar_daily']});
  assert.deepEqual(out.values, {steam_u1_daily: 6123, power_generation_daily: 4123.456, power_export_daily: 3550, power_import_daily: 0, power_solar_daily: 123.4});
  assert.equal(out.sources.power_generation_daily.updatedAt, '2026-01-02T16:02:03.000Z');
  assert.equal(out.sources.steam_u1_daily.updatedAt, undefined);
  assert.ok(h.calls.every(call => call.options.method !== 'POST'));
});

test('old workbook power and wrong-date steam never fill selected report', async () => {
  const h = harness({'/api/ois-data-requests:completed_history': () => ({ok: true, items: [
    {...steam(D), result: {...steam(D).result, sourceDate: PREV}},
    {id: 'old', targetDate: D, status: 'complete', requestType: 'daily_data_excel', result: {targetDate: D, generatorEcmsGen1: 4000000}}
  ]})});
  const out = await source.collect(D, {request: h.request, missingFields: ['steam_u1_daily', 'power_generation_daily']});
  assert.deepEqual(out.values, {});
});

test('deleted morning-history values stay excluded and ambiguous timestamps are omitted', async () => {
  const h = harness({
    '/api/ois-data-requests:completed_history': () => ({ok: true, items: [steam(D)], overrides: [{targetDate: D, values: {smpWeightedAverage: 999}}], resets: [{targetDate: D, active: true}]}),
    '/api/to-night-power': ({day}) => ({ok: true, targetDate: day, item: {targetDate: day, unit: 'kWh', values: {generatorEcmsGen1: 1000}, updatedAt: '2026-01-03 01:02:03'}})
  });
  const out = await source.collect(D, {request: h.request, missingFields: ['steam_u1_daily', 'smp_avg', 'power_generation_daily']});
  assert.equal(out.values.steam_u1_daily, undefined);
  assert.equal(out.values.smp_avg, 73);
  assert.equal(out.values.power_generation_daily, 1);
  assert.equal(out.sources.power_generation_daily.updatedAt, undefined);
});

test('closed effective adjustments own fuel while feeder splits retain raw meter totals', async () => {
  const h = harness({'/api/cofiring-closed-history': () => ({ok: true, item: closed()})});
  const out = await source.collect(D, {request: h.request, missingFields: ['coal_u1_daily', 'coal_u1_a_daily', 'coal_u1_b_daily', 'sludge_u2_daily']});
  assert.deepEqual(out.values, {coal_u1_daily: 12, coal_u1_a_daily: 3, coal_u1_b_daily: 7, sludge_u2_daily: 15});
  assert.ok(out.warnings.some(w => w.includes('원본 Feeder')));
});

test('monthly aggregates require all calendar days, never sum inventory or receipt values', async () => {
  const h = harness({
    '/api/daily-operation-reports': () => ({ok: true, items: [{workDate: PREV, values: {process_lp_daily: 50, sludge_u1_daily: 8}}]}),
    '/api/ois-data-requests:completed_history': () => ({ok: true, items: [steam(D)], overrides: []}),
    '/api/cofiring-closed-history': () => ({ok: true, item: closed()})
  });
  const out = await source.collect(D, {request: h.request, missingFields: ['process_lp_mtd', 'process_lp_max', 'process_lp_avg', 'sludge_u1_mtd', 'ng_main_mtd']});
  assert.equal(out.values.process_lp_mtd, 150);
  assert.equal(out.values.process_lp_max, 100);
  assert.equal(out.values.process_lp_avg, 75);
  assert.equal(out.values.sludge_u1_mtd, 23);
  assert.equal(out.values.ng_main_mtd, undefined);
  assert.ok(out.warnings.some(w => w.includes('자료가 부족')));
  assert.equal(out.sources.process_lp_mtd.sourceDate, D);
});

test('current edited daily value recalculates month fields without restoring stale current report totals', async () => {
  const h = harness({
    '/api/daily-operation-reports': () => ({ok: true, items: [
      {workDate: PREV, values: {process_lp_daily: 50}},
      {workDate: D, values: {process_lp_daily: 100, process_lp_mtd: 150, process_lp_max: 100, process_lp_avg: 75}}
    ]}),
    '/api/ois-data-requests:completed_history': () => ({ok: true, items: [steam(D)], overrides: []})
  });
  const out = await source.collect(D, {request: h.request, existingValues: {process_lp_daily: 130, process_lp_mtd: null, process_lp_max: null, process_lp_avg: null}, missingFields: ['process_lp_mtd', 'process_lp_max', 'process_lp_avg']});
  assert.deepEqual(out.values, {process_lp_mtd: 180, process_lp_max: 130, process_lp_avg: 90});
});

test('invalidated solar month excludes stale TO and card cumulatives after daily edit to zero', async () => {
  let hasPrior = true;
  const h = harness({
    '/api/daily-operation-reports': () => ({ok: true, items: hasPrior ? [{workDate: PREV, values: {power_solar_daily: 50}}] : []}),
    '/api/to-night-power': ({day}) => day !== D ? {ok: true, targetDate: day, item: null} : ({ok: true, targetDate: day, item: {targetDate: day, unit: 'kWh', values: {generatorEcmsGen1: 4000, solarDailyGeneration: 100}}, solarCumulative: {monthly: 150}}),
    '/api/morning-meeting-card-overrides': ({day}) => ({ok: true, targetDate: day, items: day === D ? {power: {active: true, values: {solarDailyGeneration: 125, solarMonthlyCumulative: 175}}} : {}})
  });
  const options = {request: h.request, existingValues: {power_solar_daily: 0, power_solar_mtd: null}, missingFields: ['power_solar_mtd', 'power_generation_daily'], invalidatedMonthly: ['power_solar_mtd']};
  const out = await source.collect(D, options);
  assert.equal(out.values.power_solar_mtd, 50);
  assert.equal(out.values.power_generation_daily, 4);
  assert.equal(out.sources.power_solar_mtd.source, 'month_daily_records');
  hasPrior = false;
  const incomplete = await source.collect(D, options);
  assert.equal(incomplete.values.power_solar_mtd, undefined);
  assert.ok(incomplete.warnings.some(w => w.includes('자료가 부족')));
});

test('deliberate manual blanks block source backfill and monthly aggregation for current and prior days', async () => {
  let blankPrior = false;
  const h = harness({
    '/api/daily-operation-reports': () => ({ok: true, items: [{workDate: PREV, values: {process_lp_daily: blankPrior ? null : 50}, sources: blankPrior ? {process_lp_daily: {source: 'manual', label: '직접 입력', date: PREV}} : {}}]}),
    '/api/ois-data-requests:completed_history': () => ({ok: true, items: [steam(D), steam(PREV)], overrides: []})
  });
  const currentBlank = await source.collect(D, {request: h.request, existingValues: {process_lp_daily: null}, preservedBlankFields: ['process_lp_daily'], missingFields: ['process_lp_mtd']});
  assert.equal(currentBlank.values.process_lp_mtd, undefined);
  blankPrior = true;
  const priorBlank = await source.collect(D, {request: h.request, existingValues: {process_lp_daily: 100}, missingFields: ['process_lp_mtd']});
  assert.equal(priorBlank.values.process_lp_mtd, undefined);
  assert.ok(priorBlank.warnings.some(w => w.includes('자료가 부족')));

  const solarHarness = harness({
    '/api/daily-operation-reports': () => ({ok: true, items: [{workDate: PREV, values: {power_solar_daily: null}, sources: {power_solar_daily: {source: 'manual'}}}]}),
    '/api/to-night-power': ({day}) => ({ok: true, targetDate: day, item: {targetDate: day, unit: 'kWh', values: {generatorEcmsGen1: 1000, solarDailyGeneration: 100}}, solarCumulative: {monthly: 150}})
  });
  const solarBlank = await source.collect(D, {request: solarHarness.request, existingValues: {power_solar_daily: 100}, missingFields: ['power_solar_mtd', 'power_generation_daily']});
  assert.equal(solarBlank.values.power_solar_mtd, undefined);
});

test('explicit query sends selected date only and validates completed engine interval', async () => {
  const h = harness({
    '/api/ois-data-requests': ({options}) => {
      assert.deepEqual(JSON.parse(options.body), {requestType: 'daily_operation_data', targetDate: D, forceRefresh: false});
      return {ok: true, item: engine({water_demi_avg: 80, coal_day_u1_a_end: 123})};
    }
  });
  const out = await source.collect(D, {request: h.request, queryMissing: true, missingFields: ['water_demi_avg', 'coal_day_u1_a_end']});
  assert.deepEqual(out.values, {water_demi_avg: 80, coal_day_u1_a_end: 123});
  assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 1);
});

test('saved engine uses verified full-day values, excludes unknown fields and reports unit conflicts', async () => {
  const item = engine({water_demi_avg: 0, power_max_daily: 180.5, ammonia_u1_daily: 100, power_uat_daily: 900});
  item.result.warnings = [{field: 'water_feed_u1_avg', message: '급수 품질 불량'}];
  const h = harness({'/api/ois-data-requests:daily_operation_data': () => ({ok: true, item})});
  const out = await source.collect(D, {request: h.request, missingFields: ['water_demi_avg', 'power_max_daily', 'ammonia_u1_daily', 'power_uat_daily']});
  assert.deepEqual(out.values, {water_demi_avg: 0, power_max_daily: 180.5});
  assert.ok(out.warnings.includes('급수 품질 불량'));
  assert.ok(out.warnings.some(w => w.includes('kg/hr')));
  assert.ok(out.warnings.some(w => w.includes('WATT')));
  item.result.endLocal = D + 'T23:59:00+09:00';
  const rejected = await source.collect(D, {request: h.request, missingFields: ['water_demi_avg']});
  assert.deepEqual(rejected.values, {});
});

test('only an explicit missing-field retry refreshes a previously partial engine request', async () => {
  let refresh;
  const h = harness({
    '/api/ois-data-requests:daily_operation_data': () => ({ok: true, item: engine({water_demi_avg: null})}),
    '/api/ois-data-requests': ({options}) => { refresh = JSON.parse(options.body).forceRefresh; return {ok: true, item: engine({water_demi_avg: 70})}; }
  });
  const saved = await source.collect(D, {request: h.request, missingFields: ['water_demi_avg']});
  assert.equal(refresh, undefined);
  assert.equal(saved.values.water_demi_avg, undefined);
  const retried = await source.collect(D, {request: h.request, queryMissing: true, missingFields: ['water_demi_avg']});
  assert.equal(refresh, true);
  assert.equal(retried.values.water_demi_avg, 70);
});

test('confirmed Bed Ash only; absent coverage is not zero; receipt ledger empty is zero', async () => {
  const h = harness({'/api/bed-ash-discharge': () => ({ok: true, data: {range: {startDate: D, endDate: D}, events: [
    {unitNo: 1, status: 'confirmed', confirmedTon: 45.5}, {unitNo: 1, status: 'pending', estimatedTon: 99}
  ], summary: {pendingCount: 1}, unitCoverage: {}}})});
  const out = await source.collect(D, {request: h.request, missingFields: ['bedash_u1_discharge', 'bedash_u2_discharge', 'limestone_u1_receipt', 'lime_receipt']});
  assert.equal(out.values.bedash_u1_discharge, 45.5);
  assert.equal(out.values.bedash_u2_discharge, undefined);
  assert.equal(out.values.limestone_u1_receipt, 0);
  assert.equal(out.values.lime_receipt, 0);
});

test('failed source reads stay distinct from missing, and cancellation prevents queue creation', async () => {
  const h = harness({'/api/to-night-power': () => { throw new Error('HTTP 503'); }});
  const out = await source.collect(D, {request: h.request, missingFields: ['power_generation_daily']});
  assert.deepEqual(out.values, {});
  assert.ok(out.warnings.some(w => w.includes('조회 실패') && w.includes('503')));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(source.collect(D, {request: h.request, queryMissing: true, signal: controller.signal}), {name: 'AbortError'});
  assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 0);
});

test('SMP weighted average uses exact selected-date API and geometry calculations preserve missing', async () => {
  const h = harness();
  const out = await source.collect(D, {request: h.request, missingFields: ['smp_avg']});
  assert.equal(out.values.smp_avg, 73);
  const values = source.recalculate({bio_storage_level: 12.1, coal_a_storage_level: 8.8, coal_b_storage_level: null});
  assert.ok(Math.abs(values.bio_storage_tonnes - ((64 * Math.PI * 12.1 - 2 * 2.752 ** 2 / 4 * Math.PI) * 0.2)) < 1e-9);
  assert.ok(Math.abs(values.coal_a_storage_tonnes - (81 * Math.PI / 4 * (2 / 3) * 8.8 * 0.8)) < 1e-9);
  assert.equal(values.coal_b_storage_tonnes, null);
  assert.equal(source.bioSiloTonnes(0), 0);
  assert.equal(source.coalSiloTonnes(-1), null);
});
