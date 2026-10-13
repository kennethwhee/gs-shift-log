'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const contract = require('../efficiency/bed-ash-minute-contract.js');
const { normalizeMinuteBedAshResult: normalize } = contract;

const MINUTE = 60000;
const NOW = Date.parse('2026-10-13T08:10:00+09:00');
function minute(start, offset) {
  return new Date(start + offset * MINUTE + 9 * 60 * MINUTE).toISOString().slice(0, 19) + '+09:00';
}
function fixture(endMinute = 5, date = '2026-10-13', collectedAt = '2026-10-13T08:00:00+09:00') {
  const start = Date.parse(date + 'T00:00:00+09:00');
  return {
    schemaVersion: 2, sourceKind: 'dataparc_bed_ash_minute', sampleIntervalSeconds: 60,
    targetDate: date, collectedAt, intervalStart: minute(start, 0), intervalEnd: minute(start, endMinute),
    units: contract.UNIT_DEFINITIONS.map((definition) => ({
      ...definition,
      samples: Array.from({ length: endMinute + 1 }, (_, index) => ({
        sampledAt: minute(start, index), levelTon: 300.125 - index * 0.75,
        quality: 'Raw, Good', returnedAt: minute(start, index).replace(':00+09:00', ':27+09:00'),
      })),
    })),
  };
}
function rejects(raw, expression = /Bed Ash 1분 자료/) {
  assert.throws(() => normalize(raw, raw.targetDate, NOW), expression);
}
function courierNormalizer() {
  const sourcePath = process.env.BED_ASH_OIS_API_SOURCE || path.join(__dirname, '../functions/api/ois-data-requests.js');
  const source = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '') + '\n;globalThis.normalizeCourierResult = normalizeBedAshLevelResult;';
  const context = { bedAshMinuteContract: contract, console };
  vm.runInNewContext(source, context, { timeout: 3000 });
  return context.normalizeCourierResult;
}

test('minute buckets and actual seconds survive without invented hour fields or readiness', () => {
  const raw = fixture();
  raw.ready = true;
  raw.allQualitiesGood = true;
  raw.source = 'invented hourly source';
  raw.units[0].samples[1].hour = 1;
  const result = normalize(raw, raw.targetDate, NOW);
  assert.equal(result.sourceKind, 'dataparc_bed_ash_minute');
  assert.equal(result.source, 'DataPARC Bed Ash 1분 중량');
  assert.equal(result.collectedAt, '2026-10-12T23:00:00.000Z');
  assert.deepEqual(result.units[0].samples[1], {
    sampledAt: '2026-10-13T00:01:00+09:00', levelTon: 299.375,
    quality: 'Raw, Good', returnedAt: '2026-10-13T00:01:27+09:00',
  });
  assert.equal('ready' in result, false);
  assert.equal('hour' in result.units[0].samples[1], false);
  assert.equal(raw.units[0].samples[1].hour, 1, 'normalizer must not mutate the source');
});

test('the complete previous day includes the next midnight boundary exactly once', () => {
  const raw = fixture(1440, '2026-10-12', '2026-10-13T00:06:00+09:00');
  // The test fixture uses a descending curve; keep the full day physically nonnegative.
  raw.units.forEach(unit => unit.samples.forEach((sample, index) => { sample.levelTon = 1800 - index; }));
  const result = normalize(raw, raw.targetDate, NOW);
  assert.equal(result.units[0].samples.length, 1441);
  assert.equal(result.intervalStart, '2026-10-12T00:00:00+09:00');
  assert.equal(result.intervalEnd, '2026-10-13T00:00:00+09:00');
  assert.equal(result.units[0].samples[1440].sampledAt, result.intervalEnd);
});

test('the current day accepts an immutable earlier cutoff, but forbids buckets newer than five minutes', () => {
  const raw = fixture(475);
  raw.units.forEach(unit => unit.samples.forEach((sample, index) => { sample.levelTon = 800 - index; }));
  assert.equal(normalize(raw, raw.targetDate, NOW).intervalEnd, '2026-10-13T07:55:00+09:00');
  assert.equal(normalize(fixture(5), '2026-10-13', NOW).intervalEnd, '2026-10-13T00:05:00+09:00');
  raw.intervalEnd = '2026-10-13T07:56:00+09:00';
  rejects(raw, /5분 이전/);
});

test('bad and missing rows are preserved as null, including Good with unavailable numeric data', () => {
  const raw = fixture();
  raw.units[0].samples[2] = { sampledAt: raw.units[0].samples[2].sampledAt, levelTon: null, quality: 'NoData', returnedAt: null };
  raw.units[1].samples[3].levelTon = null;
  raw.units[1].samples[3].quality = 'Bad';
  raw.units[1].samples[3].returnedAt = '2026-10-12T23:40:07+09:00';
  raw.units[1].samples[4].levelTon = null;
  raw.units[1].samples[4].quality = 'Good';
  raw.units[1].samples[4].returnedAt = null;
  const result = normalize(raw, raw.targetDate, NOW);
  assert.deepEqual(result.units[0].samples[2], raw.units[0].samples[2]);
  assert.deepEqual(result.units[1].samples[3], raw.units[1].samples[3]);
  assert.equal(result.units[1].samples[4].levelTon, null);
  assert.equal(result.units[1].samples[4].quality, 'Good');
});

test('only exact Good quality tokens can carry numeric values', () => {
  for (const quality of ['Good', ' raw, good ', 'Good, Raw', 'RAW , GOOD']) {
    const raw = fixture();
    raw.units[0].samples[0].quality = quality;
    assert.equal(normalize(raw, raw.targetDate, NOW).units[0].samples[0].quality, quality.trim());
  }
  for (const quality of ['Bad', 'Uncertain', 'Not Good', 'Good, Uncertain', 'RawGood', 'GoodRaw', 'Raw', 'NoData']) {
    const raw = fixture();
    raw.units[0].samples[0].quality = quality;
    rejects(raw, /품질 중량은 null/);
  }
});

test('the source refuses malformed schema, date, step and tag identities', () => {
  for (const mutate of [
    raw => { raw.schemaVersion = 1; },
    raw => { raw.schemaVersion = '2'; },
    raw => { raw.sourceKind = 'dataparc_hidden_excel'; },
    raw => { raw.sampleIntervalSeconds = 3600; },
    raw => { raw.units[0].tagNumber = '204HDC01CW101XQ01'; },
    raw => { raw.units[0].tagNumber = 'GSPOGE.ABB_DCS.104HDC01CW101XQ01'; },
    raw => { raw.units[0].unitNo = '1'; },
    raw => { raw.units[1] = structuredClone(raw.units[0]); },
    raw => { raw.units.push(structuredClone(raw.units[0])); },
    raw => { raw.units[0].itemName = ''; },
  ]) {
    const raw = fixture();
    mutate(raw);
    rejects(raw);
  }
  assert.throws(() => normalize(fixture(), '2026-02-30', NOW), /유효한 날짜/);
  rejects(fixture(5, '2026-10-14', '2026-10-14T08:00:00+09:00'), /미래 날짜/);
  assert.throws(() => normalize(fixture(), '2026-10-12', NOW), /날짜가 요청 날짜/);
});

test('collection, sample and actual timestamps are strict and timezones are explicit', () => {
  for (const mutate of [
    raw => { raw.collectedAt = '2026-10-13T08:00:00'; },
    raw => { raw.collectedAt = '2026-02-30T08:00:00+09:00'; },
    raw => { raw.collectedAt = '2026-10-13T08:11:00+09:00'; },
    raw => { raw.intervalStart = '2026-10-13T00:01:00+09:00'; },
    raw => { raw.units[0].samples[0].sampledAt = '2026-10-12T15:00:00Z'; },
    raw => { raw.units[0].samples[0].sampledAt = '2026-10-13T00:00:01+09:00'; },
    raw => { raw.units[0].samples[0].returnedAt = '2026-10-13T00:00:01'; },
    raw => { raw.units[0].samples[0].returnedAt = null; },
    raw => { raw.units[0].samples[0].returnedAt = '2026-10-12T23:59:59+09:00'; },
    raw => { raw.units[0].samples[0].returnedAt = '2026-10-13T00:01:00+09:00'; },
  ]) {
    const raw = fixture();
    mutate(raw);
    rejects(raw);
  }
  const raw = fixture();
  raw.units[0].samples[0].returnedAt = '2026-10-12T15:00:59.999Z';
  assert.equal(normalize(raw, raw.targetDate, NOW).units[0].samples[0].returnedAt, '2026-10-12T15:00:59.999Z');
  raw.units[0].samples[0].returnedAt = '2026-10-13T00:00:59.9999999+09:00';
  assert.equal(normalize(raw, raw.targetDate, NOW).units[0].samples[0].returnedAt, '2026-10-13T00:00:59.9999999+09:00');
  raw.units[0].samples[0].levelTon = null;
  raw.units[0].samples[0].quality = 'Bad';
  raw.units[0].samples[0].returnedAt = '2026-10-13T08:01:00+09:00';
  rejects(raw, /수집 시각보다 미래/);
});

test('duplicate, missing, unordered and oversized structural minute rows are rejected', () => {
  for (const mutate of [
    raw => { raw.units[0].samples[2] = structuredClone(raw.units[0].samples[1]); },
    raw => { raw.units[0].samples.splice(2, 1); },
    raw => { raw.units[0].samples.reverse(); },
    raw => { raw.units[0].samples.push(structuredClone(raw.units[0].samples[5])); },
    raw => { raw.units[0].samples = Array.from({ length: 1442 }, () => raw.units[0].samples[0]); },
    raw => { raw.intervalEnd = '2026-10-14T00:01:00+09:00'; },
  ]) {
    const raw = fixture();
    mutate(raw);
    rejects(raw);
  }
});

test('nonfinite, negative, string and absent numeric fields cannot become zero', () => {
  for (const levelTon of [NaN, Infinity, -Infinity, -0.01, '12.3', undefined, '', false]) {
    const raw = fixture();
    raw.units[0].samples[0].levelTon = levelTon;
    rejects(raw, /0 이상 숫자 또는 null/);
  }
  const raw = fixture();
  raw.units[0].samples[0].levelTon = 0;
  assert.equal(normalize(raw, raw.targetDate, NOW).units[0].samples[0].levelTon, 0);
});

test('the real courier branch uses the same contract and does not downgrade malformed schema 2', () => {
  const normalizeCourierResult = courierNormalizer();
  const raw = fixture(5, '2026-01-01', '2026-01-02T00:10:00+09:00');
  const valid = normalizeCourierResult(raw, raw.targetDate);
  assert.equal(valid.result.schemaVersion, 2);
  assert.equal(valid.result.units[0].samples[1].sampledAt, '2026-01-01T00:01:00+09:00');
  assert.equal(valid.result.units[0].samples[1].returnedAt, '2026-01-01T00:01:27+09:00');
  const persisted = JSON.parse(JSON.stringify(valid.result));
  assert.equal(persisted.sourceKind, 'dataparc_bed_ash_minute');
  assert.equal(persisted.sampleIntervalSeconds, 60);
  assert.equal(persisted.intervalEnd, '2026-01-01T00:05:00+09:00');
  raw.sourceKind = 'invented';
  raw.units.forEach(unit => unit.samples.forEach(sample => { sample.hour = 1; }));
  assert.match(normalizeCourierResult(raw, raw.targetDate).error, /DataPARC 1분 원본/);
  raw.schemaVersion = '2';
  raw.sampleIntervalSeconds = 3600;
  assert.match(normalizeCourierResult(raw, raw.targetDate).error, /DataPARC 1분 원본/);
});

test('the real courier preserves only allowlisted hourly fallback metadata and never upgrades its precision', () => {
  const normalizeCourierResult = courierNormalizer();
  function hourly() {
    return {
      source: 'OIS 시간별 자료 (1분 원본 조회 실패)', targetDate: '2026-01-01', collectedAt: '2026-01-02T00:10:00+09:00',
      sourceKind: 'ois_hourly_fallback', sampleIntervalSeconds: 3600,
      precisionFailure: 'BED_ASH_MINUTE_QUERY_FAILED',
      units: contract.UNIT_DEFINITIONS.map(definition => ({
        ...definition, samples: [{ hour: 1, sampledAt: '2026-01-01T01:00:00+09:00', levelTon: 250 }],
      })),
    };
  }
  for (const reason of ['BED_ASH_MINUTE_DATE_INVALID', 'BED_ASH_MINUTE_READER_UNAVAILABLE', 'BED_ASH_MINUTE_QUERY_FAILED']) {
    const raw = hourly();
    raw.precisionFailure = reason;
    const outcome = normalizeCourierResult(raw, raw.targetDate);
    assert.equal(outcome.error, undefined);
    const persisted = JSON.parse(JSON.stringify(outcome.result));
    assert.equal(persisted.sourceKind, 'ois_hourly_fallback');
    assert.equal(persisted.sampleIntervalSeconds, 3600);
    assert.equal(persisted.precisionFailure, reason);
    assert.equal(persisted.schemaVersion, undefined);
    assert.equal(persisted.units[0].samples[0].hour, 1);
    assert.equal(persisted.units[0].samples[0].sampledAt, '2026-01-01T01:00:00+09:00');
  }
  for (const mutate of [
    raw => { raw.precisionFailure = 'C:\\Users\\Employee\\private-reader-error.txt'; },
    raw => { raw.precisionFailure = { message: 'arbitrary raw error and path' }; },
    raw => { raw.precisionFailure = 'BED_ASH_MINUTE_QUERY_FAILED '; },
    raw => { raw.sampleIntervalSeconds = '3600'; },
    raw => { raw.sourceKind = 'ois_hourly'; },
  ]) {
    const raw = hourly();
    mutate(raw);
    const result = normalizeCourierResult(raw, raw.targetDate).result;
    assert.equal(result.sourceKind, undefined);
    assert.equal(result.sampleIntervalSeconds, undefined);
    assert.equal(result.precisionFailure, undefined);
    assert.equal(result.units[0].samples[0].hour, 1);
  }
  for (const mutate of [
    raw => { raw.precisionFailure = 'BED_ASH_MINUTE_CLEANUP_UNVERIFIED'; },
    raw => { raw.cleanupVerified = false; },
  ]) {
    const raw = hourly();
    mutate(raw);
    assert.match(normalizeCourierResult(raw, raw.targetDate).error, /프로세스 정리/);
  }
  const legacy = hourly();
  delete legacy.sourceKind;
  delete legacy.sampleIntervalSeconds;
  delete legacy.precisionFailure;
  assert.equal(normalizeCourierResult(legacy, legacy.targetDate).result.sourceKind, undefined);
});

test('UMD works in a browser and provides the default CommonJS export used by the server bundler', async () => {
  const browser = {};
  const filename = path.join(__dirname, '../efficiency/bed-ash-minute-contract.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), browser);
  assert.equal(typeof browser.BedAshMinuteContract.normalizeMinuteBedAshResult, 'function');
  const imported = await import('../efficiency/bed-ash-minute-contract.js');
  assert.equal(imported.default.normalizeMinuteBedAshResult, normalize);
});
