'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const repo = process.env.WEEKEND_TEAM_REPO || path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(repo, 'script.js'), 'utf8');
function part(start, end) {
  const a = script.indexOf(start), b = script.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'actual production function boundaries');
  return script.slice(a, b);
}
const selection = part('function extractMorningMeetingReportDate(', 'function findMorningMeetingRowIndex(');
const dates = part('function parseMorningMeetingReportDate(', 'function formatMorningMeetingShortDate(');
const finalDateMarker = script.indexOf('const rawTeamReportDateText =');
const finalDateStart = script.lastIndexOf('let weekendMode =', finalDateMarker);
const finalDateEnd = script.indexOf('const closedValuesTargetDate =', finalDateMarker);
assert.ok(finalDateStart >= 0 && finalDateEnd > finalDateMarker, 'actual final Excel date validation boundaries');
const finalDateValidation = script.slice(finalDateStart, finalDateEnd);
const silent = { log() {}, warn() {}, error() {} };
function harness({ enabled = true, startDate = '2026-10-16', endDate = '2026-10-18', workDate = '2026-10-18', modeHook } = {}) {
  const state = { workDate, weekendMode: { enabled, startDate, endDate } };
  const errors = [];
  const window = { efficiencyMorningMeetingUploadState: state };
  if (modeHook !== undefined) window.getEfficiencyMorningMeetingWeekendMode = modeHook;
  const context = vm.createContext({
    window, state, console: silent, document: { getElementById: () => null },
    TEAM_CONFIG: { electric: { name: '전기제어팀' }, mechanical: { name: '기계팀' } },
    normalizeMorningMeetingSearchText: value => String(value || '').trim(),
    convertMorningMeetingSheetToRows: worksheet => worksheet.rows,
    showMorningMeetingWorkbookError: message => errors.push(message),
    waterTreatment: {}, limestoneValues: {}
  });
  vm.runInContext(selection + '\n' + dates + '\nfunction validateFinalDates(uniqueReportDates) {\n' + finalDateValidation + '\nreturn { teamReportDateText, expectedWaterSourceDate, teamPreviousDate: teamPreviousDate.toISOString().slice(0, 10), scheduleDate: scheduleDate.toISOString().slice(0, 10), teamScheduleDate: teamScheduleDate.toISOString().slice(0, 10) };\n}', context);
  return { errors, state,
    select: entries => context.selectMorningMeetingSourceSheet(workbook(entries), 'electric'),
    finalDates: reportDates => context.validateFinalDates(reportDates)
  };
}
function workbook(entries) {
  return {
    SheetNames: entries.map(entry => entry.name),
    Sheets: Object.fromEntries(entries.map(entry => [entry.name, { rows: entry.rows || ['일일업무_' + entry.date, '업무내용 및 예정사항'] }]))
  };
}
const dated = (date, name = date) => ({ name, date });

test('Friday sheet alone satisfies the full Friday-to-Sunday collection', () => {
  const selected = harness().select([dated('2026-10-16')]);
  assert.equal(selected.normalizedReportDate, '2026-10-16');
});
test('Friday remains selected even when Saturday and Sunday sheets exist', () => {
  const selected = harness().select([dated('2026-10-16'), dated('2026-10-18'), dated('2026-10-17')]);
  assert.equal(selected.normalizedReportDate, '2026-10-16');
});
test('missing Friday reports the required single date and the actual detected date', () => {
  assert.throws(() => harness().select([dated('2026-10-15')]), error => {
    assert.match(error.message, /전기제어팀/);
    assert.match(error.message, /주말 시작 전 기준일\(2026-10-16\)/);
    assert.match(error.message, /확인된 날짜: 2026-10-15/);
    assert.doesNotMatch(error.message, /2026-10-16\s*~\s*2026-10-18/);
    return true;
  });
});
for (const date of ['2026-10-17', '2026-10-18']) {
  test(date + ' alone cannot substitute for Friday team content', () => {
    assert.throws(() => harness().select([dated(date)]), /주말 시작 전 기준일\(2026-10-16\)/);
  });
}
test('duplicate Friday sheets retain the last-sheet tie breaker', () => {
  const selected = harness().select([dated('2026-10-16', '첫 자료'), dated('2026-10-18'), dated('2026-10-16', '수정 자료')]);
  assert.equal(selected.sheetName, '수정 자료');
});
test('date in sheet content remains authoritative over a conflicting sheet name', () => {
  const selected = harness().select([dated('2026-10-15', '2026-10-16'), dated('2026-10-16', '최종')]);
  assert.equal(selected.sheetName, '최종');
});
test('sheet-name date fallback still selects Friday when content has no date', () => {
  const selected = harness().select([{ name: '10.16', rows: ['업무내용'] }, { name: '10.18', rows: ['업무내용'] }]);
  assert.equal(selected.normalizedReportDate, '2026-10-16');
});
test('weekday mode continues to use the exact selected work date', () => {
  const selected = harness({ enabled: false, workDate: '2026-10-18' }).select([dated('2026-10-16'), dated('2026-10-18')]);
  assert.equal(selected.normalizedReportDate, '2026-10-18');
  assert.throws(() => harness({ enabled: false }).select([dated('2026-10-16')]), /2026-10-18 업무내용 시트를 찾지 못했습니다/);
});
test('undated legacy workbook keeps its last meaningful sheet compatibility', () => {
  const selected = harness().select([{ name: '첫 양식', rows: ['업무내용'] }, { name: '빈 양식', rows: [''] }, { name: '마지막 양식', rows: ['예정사항'] }]);
  assert.equal(selected.sheetName, '마지막 양식');
});
test('empty workbook still reports missing meaningful sheets', () => {
  assert.throws(() => harness().select([{ name: '빈 양식', rows: ['', ' '] }]), /내용이 있는 엑셀 시트를 찾지 못했습니다/);
});
test('weekend mode uses state fallback when the optional public hook fails', () => {
  const selected = harness({ modeHook() { throw Error('Unavailable UI hook'); } }).select([dated('2026-10-16'), dated('2026-10-18')]);
  assert.equal(selected.normalizedReportDate, '2026-10-16');
});
test('public weekend hook remains authoritative when it returns valid settings', () => {
  const selected = harness({ modeHook: () => ({ enabled: true, startDate: '2026-10-17', endDate: '2026-10-18' }) }).select([dated('2026-10-16'), dated('2026-10-17'), dated('2026-10-18')]);
  assert.equal(selected.normalizedReportDate, '2026-10-17');
});
test('final Excel accepts Friday content while automatic data stays Sunday and meeting stays Monday', () => {
  const h = harness();
  const result = h.finalDates(['2026.10.16']);
  assert.equal(h.errors.length, 0);
  assert.equal(result.teamPreviousDate, '2026-10-16');
  assert.equal(result.expectedWaterSourceDate, '2026-10-18');
  assert.equal(result.scheduleDate, '2026-10-19');
  assert.equal(result.teamScheduleDate, '2026-10-19');
});
for (const date of ['2026.10.15', '2026.10.17', '2026.10.18']) {
  test('final Excel rejects cached team results from ' + date, () => {
    const h = harness();
    assert.equal(h.finalDates([date]), undefined);
    assert.equal(h.errors.length, 1);
    assert.match(h.errors[0], /2026-10-16/);
    assert.match(h.errors[0], new RegExp(date.replaceAll('.', '-')));
  });
}
test('undated final Excel compatibility retains Friday team date and Sunday automatic date', () => {
  const h = harness();
  const result = h.finalDates([]);
  assert.equal(h.errors.length, 0);
  assert.equal(result.teamPreviousDate, '2026-10-16');
  assert.equal(result.expectedWaterSourceDate, '2026-10-18');
});
test('weekday final Excel date behavior stays unchanged', () => {
  const h = harness({ enabled: false, workDate: '2026-10-16' });
  const result = h.finalDates(['2026.10.16']);
  assert.equal(result.teamPreviousDate, '2026-10-16');
  assert.equal(result.expectedWaterSourceDate, '2026-10-16');
  assert.equal(result.scheduleDate, '2026-10-17');
});
