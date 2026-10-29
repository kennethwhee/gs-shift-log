'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  organicRecoveryReceipt, organicRecoverySilos, organicRecoveryEstimatedBoundary,
  organicRecoveryEstimatedSilos, recoverOrganicForDate
} = require('../maintenance/morning-meeting-closed-cofiring.js');

const CURRENT_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const KEYS = ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB'];
const TAGS = [
  'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT',
  'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT',
  'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'
];
const clone = value => structuredClone(value);
const next = date => new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const period = date => ({startLocal: date + 'T00:00', endLocal: next(date) + 'T00:00', stepUnit: 'minute', stepValue: 1});
function receipt(date, tons = 45.5, count = 2) {
  return {ok: true, source: 'solid-fuel-unloading', basis: 'completed-unloading-departure',
    receiptStart: date + 'T00:00', receiptEnd: next(date) + 'T00:00',
    receipts: {organic: tons}, counts: {organic: count}};
}
function raw(date, values = [10, 20, null], id = CURRENT_ID) {
  const spec = period(date);
  const samples = KEYS.map((key, i) => ({key, tag: TAGS[i],
    startValue: 5, startQuality: 'Raw, Good', startTime: date + 'T00:00:00+09:00',
    endValue: values[i], endQuality: values[i] === null ? 'Bad' : 'Raw, Good',
    endTime: next(date) + 'T00:00:00+09:00', boundaryValid: values[i] !== null,
    dataComplete: values[i] !== null, durationGoodSeconds: 86400,
    durationBadSeconds: 0, durationCoverageValid: true}));
  return {ok: true, targetDate: date,
    saved: {id, targetDate: date, requestType: 'cofiring_period', status: 'complete', request: {...spec}},
    result: {kind: 'cofiring_period_live_result', schemaVersion: 1, requestId: id,
      request: {...spec}, report: {kind: 'cofiring_dataparc_period_report', schemaVersion: 1,
        ...spec, organicInventoryReady: false, organicInventory: null, organicInventorySamples: samples}}};
}
function readyRaw(date, values = [10, 20, 30], id = CURRENT_ID) {
  const value = raw(date, values, id), r = value.result.report;
  r.organicInventoryReady = true;
  r.organicInventory = {schemaVersion: 1, basis: 'dataparc_period_boundary', ...period(date),
    end: Object.fromEntries([...KEYS.map((key, i) => [key, values[i]]), ['total', values.reduce((a, b) => a + b, 0)]]),
    samples: clone(r.organicInventorySamples)};
  delete r.organicInventorySamples;
  return value;
}
function saved(date, values = {organicStorageSiloB: 19.143}, sourceId = SOURCE_ID) {
  const unit = {coal: 100, bio: 25, organic: 10, manure: 0, bioRatio: 20, organicGroupRatio: 5, totalRatio: 25};
  const boundaries = Object.entries(values).map(([silo, tons]) => ({
    silo, side: 'end', boundaryLocal: next(date) + 'T00:00', tons, basis: 'saved-boundary-estimate'
  }));
  // A real saved provisional row can contain only a start-boundary estimate.
  if (!boundaries.length) boundaries.push({silo: 'organicStorageSiloB', side: 'start',
    boundaryLocal: date + 'T00:00', tons: 19.143, basis: 'saved-start-boundary-estimate'});
  return {ok: true, item: {targetDate: date, sourceRequestId: sourceId, revision: 3,
    recordKind: 'hypothesis', verificationStatus: 'unverified', officialClose: false,
    savedAt: date + 'T03:00:00Z', summary: {unit1: {...unit}, unit2: {...unit},
      combined: {bioRatio: 20, organicGroupRatio: 5, totalRatio: 25}},
    estimation: {version: 1, kind: 'inventory-balance', basis: 'dataparc-estimated-inventory-balance-v2',
      correctionRefs: [], boundaries}}};
}
const fullRecord = (date, sourceId = SOURCE_ID) => ({schemaVersion: 12, targetDate: date,
  sourceRequestId: sourceId, recordKind: 'hypothesis', verificationStatus: 'unverified',
  officialClose: false, period: period(date)});
function harness(date, options = {}) {
  const data = {logs: receipt(date), current: raw(date), provisional: saved(date), source: null, ...options};
  const calls = [];
  const fetch = async (url, headers) => {
    const parsed = new URL(url, 'https://example.invalid');
    calls.push({url, headers, params: parsed.searchParams});
    assert.equal(parsed.searchParams.get('targetDate') || date, date);
    let value;
    if (parsed.pathname === '/api/solid-fuel-trouble') value = data.logs;
    else if (parsed.pathname === '/api/cofiring-provisional-v12') value = data.provisional;
    else if (parsed.pathname === '/api/ois-data-requests' && parsed.searchParams.get('action') === 'cofiring_period_source') {
      value = parsed.searchParams.has('sourceRequestId') ? data.source : data.current;
    } else throw new Error('Unexpected endpoint: ' + url);
    if (value instanceof Error) throw value;
    return typeof value === 'function' ? value(parsed.searchParams) : value;
  };
  return {fetch, calls, fallbacks: () => calls.filter(c => c.params.has('sourceRequestId'))};
}
async function recover(date, options, closed = null) {
  const h = harness(date, options), headers = {Authorization: 'Bearer fixture-only'};
  return {value: await recoverOrganicForDate(date, headers, closed, h.fetch), h, headers};
}

test('primary saved-data request selects exact full day without a source ID', async () => {
  const date = '2026-10-24';
  const {h, headers} = await recover(date, {current: raw(date, [7, 11, 34])});
  const primary = h.calls.filter(c => c.params.get('action') === 'cofiring_period_source');
  assert.equal(primary.length, 1);
  assert.equal(primary[0].params.has('sourceRequestId'), false);
  assert.equal(primary[0].params.get('targetDate'), date);
  assert.ok(h.calls.every(c => c.headers === headers));
});

test('Oct24 source GOOD ending B fills gap and produces a measured total', async () => {
  const date = '2026-10-24';
  const p = saved(date); p.item.estimation.boundaries[0].boundaryLocal = date + 'T00:00';
  const {value, h} = await recover(date, {current: raw(date, [7, 11, null]), provisional: p,
    source: raw(date, [70, 110, 34], SOURCE_ID)});
  assert.equal(value.organic.organicDaySilo, 7);
  assert.equal(value.organic.organicStorageSiloA, 11);
  assert.equal(value.organic.organicStorageSiloB, 34);
  assert.equal(value.organic.organicSiloTotal, 52);
  assert.deepEqual(value.estimatedKeys, []);
  assert.deepEqual(value.missingKeys, []);
  assert.equal(h.fallbacks().length, 1);
  assert.equal(h.fallbacks()[0].params.get('sourceRequestId'), SOURCE_ID);
  assert.equal(value.sourceRefs.organicDaySilo, CURRENT_ID);
  assert.equal(value.sourceRefs.organicStorageSiloA, CURRENT_ID);
  assert.equal(value.sourceRefs.organicStorageSiloB, SOURCE_ID);
  assert.match(value.fieldNotes.organicStorageSiloB, /저장|원본/);
  assert.match(value.fieldNotes.organicStorageSiloB, /2026-10-25 00:00/);
});

test('current GOOD zero wins and prevents needless saved-source lookup', async () => {
  const date = '2026-10-23';
  const {value, h} = await recover(date, {current: raw(date, [7, 11, 0]), source: raw(date, [70, 110, 34], SOURCE_ID)});
  assert.equal(value.organic.organicStorageSiloB, 0);
  assert.deepEqual(value.estimatedKeys, []);
  assert.deepEqual(value.boundaryApproximateKeys, []);
  assert.deepEqual(value.approximateKeys, []);
  assert.equal(h.fallbacks().length, 0);
});

test('official individual silo values win over current, source, and estimates', async () => {
  const date = '2026-10-24', closed = {organic: {organicDaySilo: 88, organicStorageSiloA: 0, organicStorageSiloB: 9, organicSiloTotal: 97}};
  const current = raw(date, [1, 2, 3]);
  current.result.report.organicInventorySamples.forEach(sample => {sample.endTime = '2026-10-24T23:56:12+09:00';});
  const {value, h} = await recover(date, {current, source: raw(date, [1, 2, 3], SOURCE_ID)}, closed);
  assert.equal(value.organic.organicDaySilo, 88);
  assert.equal(value.organic.organicStorageSiloA, 0);
  assert.equal(value.organic.organicStorageSiloB, 9);
  assert.equal(value.organic.organicSiloTotal, 97);
  assert.deepEqual(value.estimatedKeys, []);
  assert.deepEqual(value.boundaryApproximateKeys, []);
  assert.deepEqual(value.approximateKeys, []);
  assert.equal(h.fallbacks().length, 0);
});

test('source identical to primary request ID is not fetched twice', async () => {
  const date = '2026-10-24';
  const {h} = await recover(date, {provisional: saved(date, {}, CURRENT_ID)});
  assert.equal(h.fallbacks().length, 0);
});

for (const [name, mutate] of [
  ['wrong target date', p => { p.item.targetDate = '2026-10-23'; }],
  ['official close flag', p => { p.item.officialClose = true; }],
  ['verified instead of unverified', p => { p.item.verificationStatus = 'verified'; }],
  ['invalid revision', p => { p.item.revision = 0; }],
  ['non-hypothesis kind', p => { p.item.recordKind = 'official'; }],
  ['unsafe source ID', p => { p.item.sourceRequestId = '../other?targetDate=2026-10-23'; }]
]) test('invalid provisional ' + name + ' cannot trigger source lookup', async () => {
  const date = '2026-10-24', p = saved(date, {}); mutate(p);
  const {h, value} = await recover(date, {provisional: p, source: raw(date, [1, 2, 3], SOURCE_ID)});
  assert.equal(h.fallbacks().length, 0);
  assert.equal(value.organic.organicStorageSiloB, null);
});

test('source result must match requested source ID even when its internal IDs agree', async () => {
  const date = '2026-10-24';
  const {value} = await recover(date, {provisional: saved(date, {}), source: raw(date, [1, 2, 3], OTHER_ID)});
  assert.equal(value.organic.organicStorageSiloB, null);
  assert.equal(value.organic.organicSiloTotal, null);
});

for (const [name, mutate] of [
  ['cross-date envelope', x => { x.targetDate = '2026-10-23'; }],
  ['incomplete status', x => { x.saved.status = 'processing'; }],
  ['wrong request type', x => { x.saved.requestType = 'cofiring_daily'; }],
  ['wrong result schema', x => { x.result.schemaVersion = 2; }],
  ['mismatched result ID', x => { x.result.requestId = OTHER_ID; }],
  ['partial-day end', x => { x.result.request.endLocal = '2026-10-24T23:00'; }],
  ['00:01 padded end', x => { x.result.request.endLocal = '2026-10-25T00:01'; x.result.report.endLocal = '2026-10-25T00:01'; }],
  ['wrong minute step', x => { x.result.request.stepValue = 5; }],
  ['wrong result kind', x => { x.result.kind = 'cofiring_period_request'; }]
]) test('source rejects ' + name, async () => {
  const date = '2026-10-24', source = raw(date, [1, 2, 3], SOURCE_ID); mutate(source);
  const {value} = await recover(date, {provisional: saved(date, {}), source});
  assert.equal(value.organic.organicStorageSiloB, null);
  assert.equal(value.organic.organicSiloTotal, null);
});

test('failed exact-source fetch preserves receipts and independent current silos', async () => {
  const date = '2026-10-24';
  const {value, h} = await recover(date, {provisional: saved(date, {}), source: new Error('offline')});
  assert.equal(value.organic.sludgeTotal, 45.5);
  assert.equal(value.organic.sludgeTruckCount, 2);
  assert.equal(value.organic.organicDaySilo, 10);
  assert.equal(value.organic.organicStorageSiloB, null);
  assert.ok(value.missingKeys.includes('organicStorageSiloB'));
  assert.match(value.note, /미확인|누락|없|부족|확인되지/);
  assert.equal(h.fallbacks().length, 1);
});

test('source total alone never supplies a fabricated missing B', async () => {
  const date = '2026-10-24', source = readyRaw(date, [1, 2, 100], SOURCE_ID);
  delete source.result.report.organicInventory.samples;
  const {value} = await recover(date, {provisional: saved(date, {}), source});
  assert.equal(value.organic.organicStorageSiloB, null);
  assert.equal(value.organic.organicSiloTotal, null);
});

test('ready inventory supports embedded samples with strict midnight quality', () => {
  assert.deepEqual(organicRecoverySilos('2026-10-24', readyRaw('2026-10-24', [4, 5, 0])),
    {organicDaySilo: 4, organicStorageSiloA: 5, organicStorageSiloB: 0});
});

for (const [name, mutate] of [
  ['stale noon timestamp', s => { s.endTime = '2026-10-24T12:00:00+09:00'; }],
  ['missing timestamp', s => { delete s.endTime; }],
  ['timezone-free timestamp', s => { s.endTime = '2026-10-25T00:00:00'; }],
  ['BAD quality', s => { s.endQuality = 'Bad'; }],
  ['wrong tag', s => { s.tag = TAGS[0]; }],
  ['negative number', s => { s.endValue = -1; }],
  ['nonfinite number', s => { s.endValue = Infinity; }]
]) test('ready=true cannot bypass ' + name, () => {
  const date = '2026-10-24', value = readyRaw(date); mutate(value.result.report.organicInventory.samples[2]);
  const measured = organicRecoverySilos(date, value);
  assert.equal(measured.organicStorageSiloB, undefined);
  assert.equal(measured.organicDaySilo, 10);
});

test('sample time accepts five minutes preceding midnight and retains the exclusive one-minute upper bound', () => {
  const date = '2026-10-24', value = raw(date, [1, 2, 3]), b = value.result.report.organicInventorySamples[2];
  for (const [time, expected] of [
    ['2026-10-24T23:56:12+09:00', 3],
    ['2026-10-24T23:55:00+09:00', 3],
    ['2026-10-24T23:54:59.999+09:00', undefined],
    ['2026-10-24T23:58:00+09:00', 3],
    ['2026-10-24T14:56:12Z', 3],
    ['2026-10-24T15:00:00Z', 3],
    ['2026-10-25T00:00:59.999+09:00', 3],
    ['2026-10-25T00:01:00+09:00', undefined],
    ['2026-10-25T00:01:01+09:00', undefined],
    ['2026-10-24T23:56:12', undefined],
    ['2026-10-24T23:56:12Z', undefined]
  ]) {
    b.endTime = time;
    assert.equal(organicRecoverySilos(date, value).organicStorageSiloB, expected, time);
  }
});

test('Oct24 recent Day and A remain plain while B recovered 228 seconds before midnight is approximate', async () => {
  const date = '2026-10-24', current = raw(date, [8.099, 32.144, 57.83935546875]);
  const samples = current.result.report.organicInventorySamples;
  samples[0].endTime = '2026-10-24T23:59:48+09:00';
  samples[1].endTime = '2026-10-24T23:59:46+09:00';
  samples[2].endTime = '2026-10-24T23:56:12+09:00';
  const before = clone(current), provisional = saved(date, {}, CURRENT_ID);
  provisional.item.record = {...fullRecord(date, CURRENT_ID), scenario: {endTotal: 999}};
  const {value, h} = await recover(date, {current, provisional});
  assert.equal(value.organic.organicStorageSiloB, 57.83935546875);
  assert.equal(value.organic.organicSiloTotal, 8.099 + 32.144 + 57.83935546875);
  assert.notEqual(value.organic.organicSiloTotal, 999);
  assert.deepEqual(value.estimatedKeys, []);
  assert.deepEqual(value.boundaryApproximateKeys, ['organicStorageSiloB', 'organicSiloTotal']);
  assert.deepEqual(value.approximateKeys, ['organicStorageSiloB', 'organicSiloTotal']);
  assert.deepEqual(value.missingKeys, []);
  assert.equal(value.sourceRefs.organicStorageSiloB, CURRENT_ID);
  assert.equal(h.fallbacks().length, 0);
  assert.match(value.fieldNotes.organicStorageSiloB, /2026-10-25 00:00/);
  assert.match(value.fieldNotes.organicStorageSiloB, /2026-10-24 23:56:12 KST/);
  assert.match(value.fieldNotes.organicStorageSiloB, /근사|대체/);
  assert.match(value.fieldNotes.organicStorageSiloB, /최근 1분 내 종료 계측 미확인/);
  for (const key of KEYS.slice(0, 2)) assert.doesNotMatch(value.fieldNotes[key], /근사|대체|≈/);
  assert.deepEqual(current, before);
});

test('228-second window retains GOOD zero but never accepts BAD, null, or a different silo tag', () => {
  const date = '2026-10-24', value = raw(date, [1, 2, 0]);
  const b = value.result.report.organicInventorySamples[2];
  b.endTime = '2026-10-24T23:56:12+09:00';
  assert.equal(organicRecoverySilos(date, value).organicStorageSiloB, 0);
  b.endQuality = 'Raw, Bad';
  assert.equal(organicRecoverySilos(date, value).organicStorageSiloB, undefined);
  b.endQuality = 'Raw, Good'; b.endValue = null;
  assert.equal(organicRecoverySilos(date, value).organicStorageSiloB, undefined);
  b.endValue = 0; b.tag = TAGS[0];
  assert.equal(organicRecoverySilos(date, value).organicStorageSiloB, undefined);
});

test('ready inventory uses the same five-minute sample checks without trusting its aggregate', () => {
  const date = '2026-10-24', value = readyRaw(date, [1, 2, 3]);
  const b = value.result.report.organicInventory.samples[2];
  b.endTime = '2026-10-24T23:56:12+09:00';
  assert.equal(organicRecoverySilos(date, value).organicStorageSiloB, 3);
  b.endTime = '2026-10-24T23:54:59.999+09:00';
  assert.equal(organicRecoverySilos(date, value).organicStorageSiloB, undefined);
});

test('five-minute preceding rule and actual-time notes apply to all three silos on another date', async () => {
  const date = '2027-02-09', current = raw(date, [0, 12.5, 26.75]);
  const times = ['2027-02-09T23:56:12+09:00', '2027-02-09T23:55:00+09:00', '2027-02-09T23:57:00+09:00'];
  current.result.report.organicInventorySamples.forEach((sample, i) => {sample.endTime = times[i];});
  const {value} = await recover(date, {current, provisional: saved(date, {}, CURRENT_ID)});
  for (const [i, key] of KEYS.entries()) {
    assert.equal(value.organic[key], [0, 12.5, 26.75][i]);
    assert.match(value.fieldNotes[key], /2027-02-10 00:00/);
    assert.ok(value.fieldNotes[key].includes(times[i].slice(0, 19).replace('T', ' ')));
  }
  assert.equal(value.organic.organicSiloTotal, 39.25);
  assert.deepEqual(value.estimatedKeys, []);
  assert.deepEqual(value.boundaryApproximateKeys, [...KEYS, 'organicSiloTotal']);
  assert.deepEqual(value.approximateKeys, [...KEYS, 'organicSiloTotal']);
  assert.deepEqual(value.missingKeys, []);
});

test('normal one-minute window stays plain including UTC and GOOD zero while earlier recovered samples are approximate', async () => {
  const date = '2026-10-24';
  for (const [time, approximate] of [
    ['2026-10-25T00:00:00+09:00', false],
    ['2026-10-24T15:00:00Z', false],
    ['2026-10-25T00:00:00.000+09:00', false],
    ['2026-10-24T23:59:59.999+09:00', false],
    ['2026-10-25T00:00:00.001+09:00', false],
    ['2026-10-25T00:00:59.999+09:00', false],
    ['2026-10-24T23:59:00+09:00', false],
    ['2026-10-24T14:59:00Z', false],
    ['2026-10-24T23:58:59.999+09:00', true],
    ['2026-10-24T14:58:59.999Z', true],
    ['2026-10-24T23:55:00+09:00', true]
  ]) {
    const current = raw(date, [1, 2, 0]);
    current.result.report.organicInventorySamples[2].endTime = time;
    const {value} = await recover(date, {current});
    assert.equal(value.organic.organicStorageSiloB, 0, time);
    assert.equal(value.organic.organicSiloTotal, 3, time);
    assert.deepEqual(value.estimatedKeys, [], time);
    assert.deepEqual(value.boundaryApproximateKeys, approximate ? ['organicStorageSiloB', 'organicSiloTotal'] : [], time);
    assert.deepEqual(value.approximateKeys, value.boundaryApproximateKeys, time);
  }
});

test('ready inventory and pinned-source readings use the same normal and recovered-sample classification', async () => {
  const date = '2026-10-24';
  for (const mode of ['ready', 'pinned']) for (const [time, approximate] of [
    ['2026-10-24T23:59:48+09:00', false],
    ['2026-10-24T23:59:00+09:00', false],
    ['2026-10-24T23:58:59.999+09:00', true],
    ['2026-10-24T23:56:12+09:00', true]
  ]) {
    const source = mode === 'ready' ? readyRaw(date, [1, 2, 3]) : raw(date, [1, 2, 3], SOURCE_ID);
    const samples = mode === 'ready' ? source.result.report.organicInventory.samples : source.result.report.organicInventorySamples;
    samples[2].endTime = time;
    const {value} = await recover(date, mode === 'ready' ? {current: source} :
      {current: raw(date, [1, 2, null]), provisional: saved(date, {}), source});
    assert.equal(value.organic.organicStorageSiloB, 3, mode);
    assert.equal(value.organic.organicSiloTotal, 6, mode);
    assert.deepEqual(value.estimatedKeys, [], mode);
    const expected = approximate ? ['organicStorageSiloB', 'organicSiloTotal'] : [];
    assert.deepEqual(value.boundaryApproximateKeys, expected, mode + ' ' + time);
    assert.deepEqual(value.approximateKeys, expected, mode + ' ' + time);
  }
});

test('stored estimate and earlier recovered sample remain distinct while both make a derived total approximate', async () => {
  const date = '2026-10-23', current = raw(date, [10, 20, null]);
  current.result.report.organicInventorySamples[0].endTime = '2026-10-23T23:58:00+09:00';
  const {value} = await recover(date, {current, provisional: saved(date, {organicStorageSiloB: 19.143}, CURRENT_ID)});
  assert.equal(value.organic.organicSiloTotal, 49.143);
  assert.deepEqual(value.estimatedKeys, ['organicStorageSiloB', 'organicSiloTotal']);
  assert.deepEqual(value.boundaryApproximateKeys, ['organicDaySilo', 'organicSiloTotal']);
  assert.deepEqual(new Set(value.approximateKeys), new Set(['organicDaySilo', 'organicStorageSiloB', 'organicSiloTotal']));
  assert.equal(value.approximateKeys.length, 3);
});

test('Oct23 normal Day and A remain plain beside a stored B estimate', async () => {
  const date = '2026-10-23', current = raw(date, [10, 20, null]);
  current.result.report.organicInventorySamples[0].endTime = '2026-10-23T23:59:48+09:00';
  current.result.report.organicInventorySamples[1].endTime = '2026-10-23T23:59:46+09:00';
  const {value} = await recover(date, {current, provisional: saved(date, {organicStorageSiloB: 19.143}, CURRENT_ID)});
  assert.equal(value.organic.organicSiloTotal, 49.143);
  assert.deepEqual(value.estimatedKeys, ['organicStorageSiloB', 'organicSiloTotal']);
  assert.deepEqual(value.boundaryApproximateKeys, []);
  assert.deepEqual(value.approximateKeys, ['organicStorageSiloB', 'organicSiloTotal']);
});

test('each silo uses the same normal versus recovery threshold on a generic date', async () => {
  const date = '2027-02-09';
  for (const [i, key] of KEYS.entries()) for (const [time, approximate] of [
    ['2027-02-09T23:59:00+09:00', false],
    ['2027-02-09T23:58:59.999+09:00', true]
  ]) {
    const current = raw(date, [0, 12.5, 26.75]);
    current.result.report.organicInventorySamples[i].endTime = time;
    const {value} = await recover(date, {current});
    assert.equal(value.organic[key], [0, 12.5, 26.75][i]);
    assert.equal(value.organic.organicSiloTotal, 39.25);
    const expected = approximate ? [key, 'organicSiloTotal'] : [];
    assert.deepEqual(value.approximateKeys, expected, key + ' ' + time);
    assert.deepEqual(value.boundaryApproximateKeys, expected, key + ' ' + time);
    assert.deepEqual(value.estimatedKeys, []);
  }
});

test('normal ending readings stay plain despite unavailable start or incomplete whole-day coverage', async () => {
  const date = '2027-02-09', current = raw(date, [0, 12.5, 26.75]);
  current.result.report.organicInventorySamples.forEach((sample, i) => Object.assign(sample, {
    endTime: ['2027-02-09T23:59:48+09:00', '2027-02-09T23:59:46+09:00', '2027-02-09T15:00:59.999Z'][i],
    startValue: null, startQuality: 'Bad', startTime: null, boundaryValid: false,
    dataComplete: false, durationGoodSeconds: 600, durationBadSeconds: 85800, durationCoverageValid: false
  }));
  const {value} = await recover(date, {current, provisional: saved(date, {}, CURRENT_ID)});
  assert.equal(value.organic.organicSiloTotal, 39.25);
  assert.deepEqual(value.estimatedKeys, []);
  assert.deepEqual(value.boundaryApproximateKeys, []);
  assert.deepEqual(value.approximateKeys, []);
  assert.deepEqual(value.missingKeys, []);
  for (const key of KEYS) assert.doesNotMatch(value.fieldNotes[key], /근사|대체|≈/);
});

test('an existing official total remains unmarked when an individual missing silo uses an approximate boundary sample', async () => {
  const date = '2026-10-24', current = raw(date, [1, 2, 3]);
  current.result.report.organicInventorySamples[2].endTime = '2026-10-24T23:56:12+09:00';
  const {value} = await recover(date, {current}, {organic: {organicDaySilo: 1, organicStorageSiloA: 2, organicStorageSiloB: null, organicSiloTotal: 100}});
  assert.equal(value.organic.organicSiloTotal, 100);
  assert.equal(value.organic.organicStorageSiloB, 3);
  assert.deepEqual(value.boundaryApproximateKeys, ['organicStorageSiloB']);
  assert.deepEqual(value.approximateKeys, ['organicStorageSiloB']);
  assert.match(value.fieldNotes.organicSiloTotal, /다릅니다/);
});

test('outside five minutes cannot reuse the Oct24 start estimate as Oct25 ending stock', async () => {
  const date = '2026-10-24', current = raw(date, [8.099, 32.144, 57.83935546875]);
  current.result.report.organicInventorySamples[2].endTime = '2026-10-24T23:54:59.999+09:00';
  const {value, h} = await recover(date, {current, provisional: saved(date, {}, CURRENT_ID)});
  assert.equal(value.organic.organicStorageSiloB, null);
  assert.equal(value.organic.organicSiloTotal, null);
  assert.deepEqual(value.estimatedKeys, []);
  assert.ok(value.missingKeys.includes('organicStorageSiloB'));
  assert.equal(h.fallbacks().length, 0);
});

test('duplicate sample identity rejects its affected silo without suppressing independent silos', () => {
  const date = '2026-10-24', value = raw(date, [1, 2, 3]);
  value.result.report.organicInventorySamples.push({...value.result.report.organicInventorySamples[2], endValue: 99});
  assert.deepEqual(organicRecoverySilos(date, value), {organicDaySilo: 1, organicStorageSiloA: 2});
});

test('generic future-like day supports saved end estimates for all three silos', async () => {
  const date = '2026-11-02', p = saved(date, {organicDaySilo: 1.25, organicStorageSiloA: 2.5, organicStorageSiloB: 3.75});
  assert.deepEqual(organicRecoveryEstimatedSilos(date, p), {organicDaySilo: 1.25, organicStorageSiloA: 2.5, organicStorageSiloB: 3.75});
  const {value} = await recover(date, {current: null, provisional: p});
  assert.equal(value.organic.organicSiloTotal, 7.5);
  for (const key of KEYS) {
    assert.ok(value.estimatedKeys.includes(key));
    assert.match(value.fieldNotes[key], /추정/);
    assert.match(value.fieldNotes[key], /2026-11-03 00:00/);
  }
  assert.ok(value.estimatedKeys.includes('organicSiloTotal'));
  assert.deepEqual(value.missingKeys, []);
});

test('all-silo source measurements take precedence over available estimates', async () => {
  const date = '2026-11-02';
  const {value, h} = await recover(date, {current: null,
    provisional: saved(date, {organicDaySilo: 11, organicStorageSiloA: 22, organicStorageSiloB: 33}),
    source: raw(date, [1, 2, 3], SOURCE_ID)});
  assert.equal(value.organic.organicSiloTotal, 6);
  assert.deepEqual(value.estimatedKeys, []);
  assert.equal(h.fallbacks().length, 1);
});

test('source fills available measurements then estimates fill remaining silos', async () => {
  const date = '2026-11-02';
  const {value} = await recover(date, {current: raw(date, [0, null, null]),
    provisional: saved(date, {organicDaySilo: 11, organicStorageSiloA: 22, organicStorageSiloB: 33}),
    source: raw(date, [5, 2, null], SOURCE_ID)});
  assert.equal(value.organic.organicDaySilo, 0);
  assert.equal(value.organic.organicStorageSiloA, 2);
  assert.equal(value.organic.organicStorageSiloB, 33);
  assert.equal(value.organic.organicSiloTotal, 35);
  assert.deepEqual(value.estimatedKeys, ['organicStorageSiloB', 'organicSiloTotal']);
});

test('Oct24 start estimate is never reused for Oct25 ending B', async () => {
  const date = '2026-10-24', p = saved(date);
  p.item.estimation.boundaries[0] = {silo: 'organicStorageSiloB', side: 'start', boundaryLocal: date + 'T00:00', tons: 19.143};
  assert.equal(organicRecoveryEstimatedBoundary(date, p), null);
  assert.deepEqual(organicRecoveryEstimatedSilos(date, p), {});
  const {value} = await recover(date, {provisional: p});
  assert.equal(value.organic.organicStorageSiloB, null);
  assert.equal(value.organic.organicSiloTotal, null);
});

test('explicit start-side row remains rejected even with ending boundary text', () => {
  const date = '2026-11-02', p = saved(date); p.item.estimation.boundaries[0].side = 'start';
  assert.deepEqual(organicRecoveryEstimatedSilos(date, p), {});
});

test('legacy boundary without side is accepted only at matching end', () => {
  const date = '2026-10-23', p = saved(date);
  p.item.assumption = {silo: 'organicStorageSiloB', boundaryLocal: '2026-10-24T00:00', tons: 19.143};
  delete p.item.estimation;
  assert.equal(organicRecoveryEstimatedBoundary(date, p), 19.143);
  assert.equal(organicRecoveryEstimatedBoundary('2026-10-24', p), null);
});

test('conflicting duplicate estimate invalidates only its own silo', () => {
  const date = '2026-11-02', p = saved(date, {organicDaySilo: 1, organicStorageSiloA: 2, organicStorageSiloB: 3});
  p.item.estimation.boundaries.push({...p.item.estimation.boundaries[2], tons: 99});
  assert.deepEqual(organicRecoveryEstimatedSilos(date, p), {organicDaySilo: 1, organicStorageSiloA: 2});
});

test('identical duplicate estimate is malformed and omitted for its silo', () => {
  const date = '2026-11-02', p = saved(date, {organicStorageSiloB: 3});
  p.item.estimation.boundaries.push({...p.item.estimation.boundaries[0]});
  assert.deepEqual(organicRecoveryEstimatedSilos(date, p), {});
});

test('optional full record period must agree with requested date', async () => {
  const date = '2026-11-02', p = saved(date);
  p.item.record = {...fullRecord(date), period: period('2026-11-01')};
  assert.deepEqual(organicRecoveryEstimatedSilos(date, p), {});
  const {h} = await recover(date, {provisional: p});
  assert.equal(h.fallbacks().length, 0);
});

test('optional full record source ID must agree with outer source ID', async () => {
  const date = '2026-11-02', p = saved(date);
  p.item.record = fullRecord(date, OTHER_ID);
  assert.deepEqual(organicRecoveryEstimatedSilos(date, p), {});
  const {h} = await recover(date, {provisional: p});
  assert.equal(h.fallbacks().length, 0);
});

test('valid optional full record retains end estimates', () => {
  const date = '2026-11-02', p = saved(date, {organicDaySilo: 0});
  p.item.record = fullRecord(date);
  assert.deepEqual(organicRecoveryEstimatedSilos(date, p), {organicDaySilo: 0});
});

test('optional record cannot elevate estimate to official close', () => {
  const date = '2026-11-02', p = saved(date);
  p.item.record = {...fullRecord(date), officialClose: true};
  assert.deepEqual(organicRecoveryEstimatedSilos(date, p), {});
});

test('partial estimates never manufacture total; missing keys and note remain', async () => {
  const date = '2026-11-02';
  const {value} = await recover(date, {current: null, provisional: saved(date, {organicDaySilo: 1})});
  assert.equal(value.organic.organicDaySilo, 1);
  assert.equal(value.organic.organicSiloTotal, null);
  assert.deepEqual(value.missingKeys, ['organicStorageSiloA', 'organicStorageSiloB']);
  assert.match(value.note, /미확인|누락|없|부족|확인되지/);
});

test('independent zero receipt count is valid and exact daily interval excludes 00:01', () => {
  const date = '2026-10-24';
  assert.deepEqual(organicRecoveryReceipt(date, receipt(date, 0, 0)), {tons: 0, count: 0});
  const padded = receipt(date); padded.receiptEnd = next(date) + 'T00:01';
  assert.equal(organicRecoveryReceipt(date, padded), null);
});

test('manual official receipts stay while actual unloading count is independent', async () => {
  const date = '2026-10-24';
  const {value} = await recover(date, {}, {receiptInputMode: 'manual', organic: {sludgeTotal: 99, sludgeTruckCount: null}});
  assert.equal(value.organic.sludgeTotal, 99);
  assert.equal(value.organic.sludgeTruckCount, 2);
});

test('official total is preserved and cannot be used to infer missing silo', async () => {
  const date = '2026-10-24';
  const {value} = await recover(date, {provisional: saved(date, {})}, {organic: {organicSiloTotal: 100}});
  assert.equal(value.organic.organicSiloTotal, 100);
  assert.equal(value.organic.organicStorageSiloB, null);
});

test('all source failures retain legacy fallback signal', async () => {
  assert.equal(await recoverOrganicForDate('2026-10-24', {}, null, async () => {throw new Error('offline');}), null);
});

test('bad calendar date causes no fetch', async () => {
  let calls = 0;
  assert.equal(await recoverOrganicForDate('2026-02-30', {}, null, async () => {calls++;}), null);
  assert.equal(calls, 0);
});
