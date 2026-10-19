'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const repo = process.env.MECHANICAL_OUTSOURCED_REPO || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'script.js'), 'utf8');

function productionPart(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'production function boundaries must exist');
  return source.slice(a, b);
}

const analyzer = productionPart(
  'function normalizeMorningMeetingText(',
  'function bindMorningMeetingPreviewEditing('
);
const outputLines = productionPart(
  'function normalizeMorningMeetingOutputLine(',
  'function escapeMorningMeetingXml('
);
const dynamicRows = productionPart(
  'function buildMorningMeetingDynamicRows(',
  'function shiftMorningMeetingExistingRow('
);

const JOB_A = '반송기 체인 점검 및 조치 A-101 종일 협력업체A 일반(발주처)';
const JOB_B = '안전 방호 덮개 보강 #2 BLR 09:00~17:00 협력업체B 고소(발주처)';
const TABLE_HEADER = '구분 주요 작업명 작업위치 작업시간 작업자 비고';

function joinedRows({
  teamName = '기계팀',
  jobs = [`외주 ${JOB_A}`, `외주 ${JOB_B}`],
  extraBefore = [],
  extraAfter = [],
  heading = '◇ 외주공사'
} = {}) {
  return [
    '일일업무_2026.10.19', `4. ${teamName}`, '',
    '◇ 전일 특이사항 (26.10.19)',
    '1. 완료 정비', '2. 압력 1.5 bar 확인', '',
    '◇ 예정 사항 (26.10.20)',
    '1. 예정 정비', '2. 외주공사 준비 및 작업허가 확인', '',
    ...extraBefore, heading, TABLE_HEADER, ...jobs, ...extraAfter
  ];
}

function sparseRow(values) {
  const row = Array(29).fill('');
  for (const [column, value] of Object.entries(values)) row[Number(column)] = value;
  return row;
}

function representativeMatrix() {
  const rows = Array.from({ length: 23 }, () => sparseRow({}));
  rows[1] = sparseRow({ 1: '일일업무_2026.10.19' });
  rows[3] = sparseRow({ 1: '4. 기계팀' });
  rows[5] = sparseRow({ 1: '◇ 전일 특이사항 (26.10.19)' });
  rows[6] = sparseRow({ 1: '1. 완료 정비' });
  rows[7] = sparseRow({ 1: '2. 압력 1.5 bar 확인' });
  rows[11] = sparseRow({ 1: '◇ 예정 사항 (26.10.20)' });
  rows[12] = sparseRow({ 1: '1. 예정 정비' });
  rows[13] = sparseRow({ 1: '2. 외주공사 준비 및 작업허가 확인' });
  rows[18] = sparseRow({ 1: '◇ 외주공사' });
  rows[19] = sparseRow({ 1: '구분', 3: '주요 작업명', 13: '작업위치', 16: '작업시간', 18: '작업자', 22: '비고' });
  rows[20] = sparseRow({ 1: '외주', 3: '반송기 체인 점검 및 조치', 13: 'A-101', 16: '종일', 18: '협력업체A', 22: '일반(발주처)' });
  rows[21] = sparseRow({ 1: '외주', 3: '안전 방호 덮개 보강', 13: '#2 BLR', 16: '09:00~17:00', 18: '협력업체B', 22: '고소(발주처)' });
  return rows;
}

function workbook(entries) {
  return {
    SheetNames: entries.map(entry => entry.name),
    Sheets: Object.fromEntries(entries.map(entry => [entry.name, {
      matrix: entry.matrix || entry.rows.map(value => sparseRow({ 1: value }))
    }]))
  };
}

function harness(inputWorkbook) {
  const preview = { hidden: true };
  const previewList = { innerHTML: '' };
  const previewCount = { textContent: '' };
  const elements = {
    efficiencyMorningMeetingPreview: preview,
    efficiencyMorningMeetingPreviewList: previewList,
    efficiencyMorningMeetingPreviewCount: previewCount
  };
  const xlsxCalls = [];
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    window: { efficiencyMorningMeetingUploadState: { workDate: '2026-10-19', weekendMode: { enabled: false } } },
    document: { getElementById: id => elements[id] || null },
    TEAM_CONFIG: {
      mechanical: { name: '기계팀' },
      safety: { name: '안전팀' },
      environment: { name: '환경팀' },
      electrical: { name: '전기제어팀' }
    },
    XLSX: {
      read(buffer, options) {
        xlsxCalls.push({ buffer, options });
        return inputWorkbook;
      },
      utils: {
        sheet_to_json(worksheet, options) {
          assert.equal(options.header, 1);
          assert.equal(options.defval, '');
          assert.equal(options.raw, false);
          assert.equal(options.blankrows, true);
          return worksheet.matrix;
        }
      }
    },
    MORNING_MEETING_DYNAMIC_TEAM_CONFIG: [{ key: 'mechanical', teamName: '기계팀', sectionNumber: 4 }],
    formatMorningMeetingShortDate: date => String(date).slice(5).replace('-', '.'),
    cloneMorningMeetingDynamicRow: (_document, template, rowNumber, text) => ({ template, rowNumber, text })
  });
  vm.runInContext(`${analyzer}\n${outputLines}\n${dynamicRows}`, context);
  return { context, preview, previewList, previewCount, xlsxCalls };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('mechanical import preserves both external jobs and every populated table column', () => {
  const h = harness();
  const rows = h.context.convertMorningMeetingSheetToRows({ matrix: representativeMatrix() });
  const result = h.context.extractMorningMeetingTeamSections(rows, '기계팀');
  assert.equal(result.previousText, '1) 완료 정비\n2) 압력 1.5 bar 확인');
  assert.equal(result.previousCount, 2);
  assert.equal(result.scheduleText, [
    '1) 예정 정비', '2) 외주공사 준비 및 작업허가 확인',
    `[외주공사] ${JOB_A}`, `[외주공사] ${JOB_B}`
  ].join('\n'));
  assert.equal(result.scheduleCount, 4);
  assert.doesNotMatch(result.scheduleText, /주요 작업명|작업위치|작업시간|작업자 비고/);
});

test('empty external table and category-only template rows add no phantom entries', () => {
  const h = harness();
  const result = h.context.extractMorningMeetingTeamSections(joinedRows({
    jobs: ['', ' ', '외주', ' 외주 ', '외주 -', '외주 없음', '외주 해당 없음']
  }), '기계팀');
  assert.equal(result.scheduleCount, 2);
  assert.equal(result.scheduleText, '1) 예정 정비\n2) 외주공사 준비 및 작업허가 확인');
  assert.deepEqual(plain(h.context.extractMorningMeetingOutsourcedWorkRows(['◇ 외주공사', TABLE_HEADER])), []);
});

test('shifted external heading and three jobs retain their original order', () => {
  const h = harness();
  const jobs = [`외주 ${JOB_A}`, `외주 ${JOB_B}`, '외주 밸브 정비 터빈동 오후 협력업체C 일반'];
  const result = h.context.extractMorningMeetingTeamSections(joinedRows({
    extraBefore: ['', '', '3. 추가 예정 정비', '', ''],
    heading: '◆ 외주 공사 (작업 계획)', jobs
  }), '기계팀');
  assert.equal(result.scheduleCount, 6);
  assert.deepEqual(result.scheduleText.split('\n').slice(-3), jobs.map(job => `[외주공사] ${job.slice(3)}`));
});

for (const heading of ['◇ 기타사항', '근태 현황', '◇ 별도 보고', '5. 전기제어팀']) {
  test(`external work stops before the next section: ${heading}`, () => {
    const h = harness();
    const result = h.context.extractMorningMeetingTeamSections(joinedRows({
      jobs: [`외주 ${JOB_A}`], extraAfter: [heading, '수집하면 안 되는 별도 내용']
    }), '기계팀');
    assert.equal(result.scheduleCount, 3);
    assert.match(result.scheduleText, /반송기 체인 점검/);
    assert.doesNotMatch(result.scheduleText, /수집하면 안 되는|기타사항|근태 현황|별도 보고|전기제어팀/);
  });
}

test('duplicate external jobs remain separate rows', () => {
  const h = harness();
  const result = h.context.extractMorningMeetingTeamSections(joinedRows({
    jobs: [`외주 ${JOB_A}`, `외주 ${JOB_A}`]
  }), '기계팀');
  assert.equal(result.scheduleCount, 4);
  assert.equal(result.scheduleText.split('\n').filter(line => line === `[외주공사] ${JOB_A}`).length, 2);
});

test('multiline external cells become one entry without losing continuation text', () => {
  const h = harness();
  const result = h.context.extractMorningMeetingTeamSections(joinedRows({
    jobs: ['외주 점검 및\r\n보강 작업 A-201\n지하 09:00~17:00 협력업체D\t일반']
  }), '기계팀');
  assert.equal(result.scheduleCount, 3);
  assert.equal(result.scheduleText.split('\n').at(-1), '[외주공사] 점검 및 보강 작업 A-201 지하 09:00~17:00 협력업체D 일반');
  assert.equal(h.context.splitMorningMeetingOutputLines(result.scheduleText).length, 3);
});

test('ordinary planned text mentioning external work is retained without a separate table', () => {
  const h = harness();
  const rows = joinedRows().slice(0, 11);
  rows.push('3. 최종 확인');
  const result = h.context.extractMorningMeetingTeamSections(rows, '기계팀');
  assert.equal(result.scheduleCount, 3);
  assert.equal(result.scheduleText, '1) 예정 정비\n2) 외주공사 준비 및 작업허가 확인\n3) 최종 확인');
  assert.deepEqual(plain(h.context.extractMorningMeetingOutsourcedWorkRows(rows)), []);
});

for (const teamName of ['안전팀', '환경팀', '전기제어팀']) {
  test(`${teamName} keeps its existing two-section import without appending external table rows`, () => {
    const h = harness();
    const result = h.context.extractMorningMeetingTeamSections(joinedRows({ teamName }), teamName);
    assert.equal(result.previousText, '1) 완료 정비\n2) 압력 1.5 bar 확인');
    assert.equal(result.previousCount, 2);
    assert.equal(result.scheduleText, '1) 예정 정비\n2) 외주공사 준비 및 작업허가 확인');
    assert.equal(result.scheduleCount, 2);
  });
}

test('file analysis selects content date over sheet name and passes external jobs to preview and Excel rows', async () => {
  const input = workbook([
    { name: '2026-10-19', rows: ['일일업무_2026.10.18', '4. 기계팀', '◇ 예정 사항', '1. 다른 날짜 정비'] },
    { name: '10(18)', matrix: representativeMatrix() }
  ]);
  const h = harness(input);
  const buffer = new ArrayBuffer(8);
  const result = await h.context.analyzeMorningMeetingTeamFile('mechanical', {
    name: 'synthetic-mechanical-report.xlsx', arrayBuffer: async () => buffer
  });
  assert.equal(h.xlsxCalls.length, 1);
  assert.equal(h.xlsxCalls[0].buffer, buffer);
  assert.deepEqual(plain(h.xlsxCalls[0].options), { type: 'array', cellFormula: true, cellDates: false });
  assert.equal(result.sheetName, '10(18)');
  assert.equal(result.reportDate, '2026.10.19');
  assert.equal(result.scheduleCount, 4);
  assert.doesNotMatch(result.scheduleText, /다른 날짜/);

  h.context.renderMorningMeetingAnalysisPreview([result]);
  assert.equal(h.preview.hidden, false);
  assert.equal(h.previewCount.textContent, '1개 팀');
  const scheduleTextarea = h.previewList.innerHTML.match(/data-morning-meeting-analysis-section="scheduleText"[\s\S]*?>([\s\S]*?)<\/textarea>/);
  assert.ok(scheduleTextarea, 'editable planned-work preview exists');
  assert.equal(scheduleTextarea[1], result.scheduleText);

  const templates = Object.fromEntries([
    'title', 'blankAfterTitle', 'previousHeading', 'previousContent',
    'separatorBlank', 'scheduleHeading', 'scheduleContent', 'finalBlank'
  ].map(key => [key, key]));
  const exported = h.context.buildMorningMeetingDynamicRows({
    safetyStartRow: 100, teams: { mechanical: { templates } },
    sheetData: { ownerDocument: {} }
  }, { mechanical: result }, '2026-10-19', '2026-10-20');
  const scheduleRows = exported.rows.filter(row => row.element.template === 'scheduleContent');
  assert.deepEqual(plain(scheduleRows.map(row => row.element.text)), [
    ' 1) 예정 정비', ' 2) 외주공사 준비 및 작업허가 확인',
    ` [외주공사] ${JOB_A}`, ` [외주공사] ${JOB_B}`
  ]);
  assert.equal(exported.newTmStartRow, 112);
  assert.deepEqual(plain(exported.teamRanges.mechanical), { startRow: 100, endRow: 111 });
});
