import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../efficiency/bed-ash-discharge.js', import.meta.url), 'utf8');
const DAY = '2026-08-07';
function client() {
  const ids = ['bedAshDischargeStatus', 'bedAshDischargeSourceDetails',
    'bedAshDischargeSourceDetailText', 'bedAshDischargeSourceStatusText'];
  const elements = new Map(ids.map(id => [id, { textContent: '', title: '', dataset: {}, hidden: true }]));
  const window = { location: { pathname: '/' }, addEventListener() {} };
  const document = { readyState: 'loading', getElementById: id => elements.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const context = vm.createContext({ window, document, Date, Intl, console, URLSearchParams,
    localStorage: { getItem: () => null }, MutationObserver: class { observe() {} } });
  const hook = '  window.__compactCopy = { state, setStatus, normalizeCoverage, coverageStatusMessage, compactCoverageStatusMessage, renderLatestLevel, renderSummaryCards };\n';
  vm.runInContext(source.replace('  window.openBedAshDischargeView =', hook + '  window.openBedAshDischargeView ='), context);
  const api = window.__compactCopy;
  api.state.anchorDate = DAY;
  return { api, elements, status: elements.get('bedAshDischargeStatus') };
}
function minuteCoverage(api, extra = {}) {
  return api.normalizeCoverage({ dates: [DAY], minuteDates: [DAY], completeDates: [], missingDates: [DAY], ...extra }, [DAY]);
}

test('routine sparse completion fits one short line while full source quality remains available in details and title', () => {
  const { api, elements, status } = client();
  api.state.summary.observedCount = 5; api.state.summary.observedGapCount = 5;
  api.state.summary.incompleteCount = 5;
  api.state.unitCoverage = { 1: { hasMinuteSource: true, validMinuteSampleCount: 494, hasGaps: true },
    2: { hasMinuteSource: true, validMinuteSampleCount: 697, hasGaps: true } };
  const coverage = minuteCoverage(api);
  const full = api.coverageStatusMessage(coverage, 5);
  const compact = api.compactCoverageStatusMessage(coverage);
  api.setStatus(full, 'warning', compact);
  assert.equal(status.textContent, '조회 완료 · 관측 5구간 · 자료 공백 있음');
  assert.equal(status.dataset.state, 'warning'); assert.equal(status.title, full);
  assert.match(full, /DataPARC 1분 자료 1일/); assert.match(full, /자료 확인 5구간/);
  assert.equal(elements.get('bedAshDischargeSourceStatusText').textContent, full);
  assert.equal(elements.get('bedAshDischargeSourceStatusText').hidden, false);
  assert.equal(elements.get('bedAshDischargeSourceDetails').hidden, false);
});

test('pending, failed, precision-fallback and hourly boundary messages are never collapsed into completion', () => {
  const { api, status } = client();
  for (const extra of [{ pendingDates: [DAY] }, { failedDates: [DAY] },
    { precisionFailures: [{ date: DAY }] }, { minuteDates: [], missingDates: [DAY] },
    { minuteDates: [], missingDates: [], completeDates: [DAY], hourlyDates: [DAY],
      lookahead: { date: '2026-08-08', available: false, complete: false } }]) {
    const coverage = minuteCoverage(api, extra);
    const full = api.coverageStatusMessage(coverage, 0);
    assert.equal(api.compactCoverageStatusMessage(coverage), '');
    api.setStatus(full, 'warning', api.compactCoverageStatusMessage(coverage));
    assert.equal(status.textContent, full);
  }
  const error = 'Bed Ash 반출 자료 조회 실패 · 연결 시간 초과';
  api.setStatus(error, 'error');
  assert.equal(status.textContent, error); assert.equal(status.dataset.state, 'error');
});

test('latest stock uses a short timestamp but preserves full dates, cross-midnight gaps and source date in touch-accessible details', () => {
  const { api, elements } = client(), amount = {}, timestamp = {};
  const latest = { levelTon: 18.4, sampledAt: `${DAY}T23:52:17+09:00`, sourceDate: DAY };
  const quality = { latestMinuteMissing: true, latestMinuteBucketAt: '2026-08-08T00:01:00+09:00', hasGaps: true };
  api.renderLatestLevel(latest, amount, timestamp, quality);
  assert.equal(amount.textContent, '18.4t'); assert.equal(timestamp.textContent, '23:52 기준 · 이후 미수신');
  assert.match(timestamp.title, /2026\.08\.07 23:52 마지막 유효값/);
  assert.match(timestamp.title, /원자료 2026-08-07/);
  assert.match(timestamp.title, /2026\.08\.08 00:01 자료 미수신/);
  api.state.latestLevels[1] = latest;
  api.state.unitCoverage[1] = { ...quality, hasMinuteSource: true, minuteSampleCount: 1440,
    validMinuteSampleCount: 494, missingMinuteSampleCount: 946 };
  api.renderSummaryCards();
  const detail = elements.get('bedAshDischargeSourceDetailText').textContent;
  assert.match(detail, /2026\.08\.07 23:52 마지막 유효값/);
  assert.match(detail, /원자료 2026-08-07/);
  assert.match(detail, /2026\.08\.08 00:01 자료 미수신/);
  assert.equal(elements.get('bedAshDischargeSourceDetails').hidden, false);
  api.state.period = 'weekly'; api.renderLatestLevel(latest, amount, timestamp, quality);
  assert.equal(timestamp.textContent, '08.07 23:52 기준 · 이후 미수신');
  api.state.period = 'daily'; api.state.anchorDate = '2026-08-08';
  api.renderLatestLevel(latest, amount, timestamp, quality);
  assert.equal(timestamp.textContent, '08.07 23:52 기준 · 이후 미수신');
});

test('missing stock remains absent, measured zero stays zero and a new status clears old collapsed evidence', () => {
  const { api, elements, status } = client(), amount = {}, timestamp = {};
  api.renderLatestLevel(null, amount, timestamp, { latestMinuteMissing: true, latestMinuteBucketAt: `${DAY}T23:59:00+09:00` });
  assert.equal(amount.textContent, '--.-t'); assert.equal(timestamp.textContent, '23:59 자료 미수신');
  api.renderLatestLevel({ levelTon: 0, sampledAt: `${DAY}T23:59:00+09:00` }, amount, timestamp, {});
  assert.equal(amount.textContent, '0.0t'); assert.equal(timestamp.textContent, '23:59 기준');
  api.setStatus('이전 날짜 전체 상세', 'warning', '이전 날짜 요약');
  api.setStatus('저장 자료 조회 중', 'loading');
  assert.equal(status.textContent, '저장 자료 조회 중'); assert.equal(status.title, '');
  assert.equal(elements.get('bedAshDischargeSourceStatusText').textContent, '');
  assert.equal(elements.get('bedAshDischargeSourceStatusText').hidden, true);
  assert.equal(elements.get('bedAshDischargeSourceDetails').hidden, true);
});
