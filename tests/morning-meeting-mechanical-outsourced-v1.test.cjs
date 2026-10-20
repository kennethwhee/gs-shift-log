'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const repo = process.env.MECHANICAL_OUTSOURCED_REPO || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'script.js'), 'utf8');
const start = source.indexOf('function normalizeMorningMeetingText(');
const end = source.indexOf('function bindMorningMeetingPreviewEditing(', start);
assert.ok(start >= 0 && end > start, 'production analyzer boundaries must exist');
const analyzer = source.slice(start, end);

const HEADERS = ['구분', '주요 작업명', '작업위치', '작업시간', '작업자', '비고'];
const JOBS = [
  ['외주', '반송기 체인 점검 및 조치', 'A-101', '종일', '협력업체A', '일반(발주처)'],
  ['외주', '안전 방호 덮개 보강', '#2 BLR', '09:00~17:00', '협력업체B', '고소(발주처)']
];
const FALLBACK_WIDTHS = [8.377, 41.883, 12.565, 8.377, 12.341, 16.458];

function columnName(column) {
  let result = '';
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + (value - 1) % 26) + result;
  }
  return result;
}

function worksheet({
  teamName = '기계팀', jobs = JOBS, heading = '◇ 외주공사',
  headerPositions = [0, 2, 12, 15, 17, 21], headers = HEADERS,
  startColumn = 1, startRow = 1, before = [], after = [], withWidths = false
} = {}) {
  const width = Math.max(28, headerPositions.at(-1) + 7);
  const matrix = Array.from({ length: 17 }, () => Array(width).fill(''));
  matrix[0][0] = '일일업무_2026.10.19';
  matrix[2][0] = `4. ${teamName}`;
  matrix[4][0] = '◇ 전일 특이사항 (26.10.19)';
  matrix[5][0] = '1. 완료 정비';
  matrix[6][0] = '2. 압력 1.5 bar 확인';
  matrix[10][0] = '◇ 예정 사항 (26.10.20)';
  matrix[11][0] = '1. 예정 정비';
  matrix[12][0] = '2. 외주공사 준비 및 작업허가 확인';
  for (const text of before) matrix.push([text]);
  matrix.push([heading]);
  const headerIndex = matrix.length;
  const header = Array(width).fill('');
  headers.forEach((label, index) => { header[headerPositions[index]] = label; });
  matrix.push(header);
  for (const job of jobs) {
    const row = Array(width).fill('');
    job.forEach((value, index) => { row[headerPositions[index]] = value; });
    matrix.push(row);
  }
  for (const text of after) matrix.push([text]);
  matrix.push(Array(width).fill(''));
  const result = {
    matrix,
    '!ref': `${columnName(startColumn)}${startRow + 1}:${columnName(startColumn + width - 1)}${startRow + matrix.length}`,
    '!merges': headerPositions.map((column, index) => ({
      s: { r: startRow + headerIndex, c: startColumn + column },
      e: { r: startRow + headerIndex, c: startColumn + (headerPositions[index + 1] ?? width) - 1 }
    }))
  };
  if (withWidths) {
    result['!cols'] = [];
    const widths = [...Array(18).fill(5.69921875), 3.8984375, 4.09765625, 3.09765625,
      3.59765625, 5.69921875, 2.5, 1, 1.3984375, 1.69921875, 6.5];
    for (let index = 0; index < width; index += 1) {
      result['!cols'][startColumn + index] = { width: widths[index] ?? 5.69921875 };
    }
  }
  return result;
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
      mechanical: { name: '기계팀' }, safety: { name: '안전팀' },
      environment: { name: '환경팀' }, electrical: { name: '전기제어팀' }
    },
    XLSX: {
      read(buffer, options) { xlsxCalls.push({ buffer, options }); return inputWorkbook; },
      utils: {
        sheet_to_json(sheet, options) {
          assert.equal(options.header, 1);
          assert.equal(options.defval, '');
          assert.equal(options.raw, false);
          assert.equal(options.blankrows, true);
          return sheet.matrix;
        }
      }
    }
  });
  vm.runInContext(analyzer, context);
  return { context, preview, previewList, previewCount, xlsxCalls };
}

const plain = value => JSON.parse(JSON.stringify(value));

test('mechanical table keeps source columns separate and original plans unchanged', () => {
  const h = harness();
  const sheet = worksheet();
  const rows = h.context.convertMorningMeetingSheetToRows(sheet);
  const sections = h.context.extractMorningMeetingTeamSections(rows, '기계팀');
  assert.equal(sections.previousText, '1) 완료 정비\n2) 압력 1.5 bar 확인');
  assert.equal(sections.previousCount, 2);
  assert.equal(sections.scheduleText, '1) 예정 정비\n2) 외주공사 준비 및 작업허가 확인');
  assert.equal(sections.scheduleCount, 2);
  assert.deepEqual(plain(h.context.extractMorningMeetingOutsourcedWorkTable(sheet)), {
    headers: HEADERS, rows: JOBS, columnWidths: FALLBACK_WIDTHS
  });
});

test('empty source table exists without category-only phantom records', () => {
  const h = harness();
  const sheet = worksheet({ jobs: [[], ['외주'], ['외주', '-'], ['외주', '없음'], ['외주', '해당 없음']] });
  const table = h.context.extractMorningMeetingOutsourcedWorkTable(sheet);
  assert.deepEqual(plain(table.rows), []);
  assert.deepEqual(plain(table.headers), HEADERS);
  const html = h.context.renderMorningMeetingOutsourcedWorkPreview({ teamKey: 'mechanical', outsourcedWork: table });
  assert.match(html, /<thead>/);
  assert.equal((html.match(/<td /g) || []).length, 6);
});

test('header detection tolerates moved rows, shifted !ref origin and separated source columns', () => {
  const h = harness();
  const jobs = [...JOBS, ['외주', '밸브 정비', '터빈동', '오후', '협력업체C', '일반']];
  const sheet = worksheet({
    jobs, before: ['', '3. 추가 예정 정비', '', ''], heading: '◆ 외주 공사 (작업 계획)',
    startColumn: 4, startRow: 3, headerPositions: [1, 4, 11, 17, 20, 24]
  });
  const table = h.context.extractMorningMeetingOutsourcedWorkTable(sheet);
  assert.deepEqual(plain(table.rows), jobs);
  assert.deepEqual(plain(table.headers), HEADERS);
  const sections = h.context.extractMorningMeetingTeamSections(h.context.convertMorningMeetingSheetToRows(sheet), '기계팀');
  assert.equal(sections.scheduleCount, 3);
  assert.doesNotMatch(sections.scheduleText, /반송기|안전 방호|밸브 정비/);
});

for (const heading of ['◇ 기타사항', '근태 현황', '◇ 별도 보고', '5. 전기제어팀']) {
  test(`table stops before another section: ${heading}`, () => {
    const h = harness();
    const sheet = worksheet({ jobs: [JOBS[0]], after: [heading, '수집하면 안 되는 별도 내용'] });
    assert.deepEqual(plain(h.context.extractMorningMeetingOutsourcedWorkTable(sheet).rows), [JOBS[0]]);
  });
}

test('duplicate work records remain separate source rows', () => {
  const h = harness();
  const sheet = worksheet({ jobs: [JOBS[0], JOBS[0]] });
  assert.deepEqual(plain(h.context.extractMorningMeetingOutsourcedWorkTable(sheet).rows), [JOBS[0], JOBS[0]]);
});

test('multiline values and source labels retain embedded line breaks in six columns', () => {
  const h = harness();
  const job = ['외주', '점검 및\r\n보강 작업', 'A-201\n지하', '09:00~17:00', '협력업체D', '일반'];
  const headers = ['구분', '주요\n작업명', '작업\n위치', '작업시간', '작업자', '비고'];
  const table = h.context.extractMorningMeetingOutsourcedWorkTable(worksheet({ jobs: [job], headers }));
  assert.deepEqual(plain(table.headers), headers);
  assert.deepEqual(plain(table.rows), [[...job.slice(0, 1), '점검 및\n보강 작업', ...job.slice(2)]]);
});

test('source column dimensions account for !ref offset and merged widths', () => {
  const h = harness();
  const table = h.context.extractMorningMeetingOutsourcedWorkTable(worksheet({ withWidths: true }));
  assert.deepEqual(plain(table.columnWidths), [11.3984375, 56.9921875, 17.09765625, 11.3984375, 16.79296875, 22.39453125]);
  const total = table.columnWidths.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(table.columnWidths[1] / total - 0.4188) < 0.001);
});

test('incomplete source dimensions use one consistent fallback unit', () => {
  const h = harness();
  const sheet = worksheet({ withWidths: true });
  delete sheet['!cols'][4];
  assert.deepEqual(plain(h.context.extractMorningMeetingOutsourcedWorkTable(sheet).columnWidths), FALLBACK_WIDTHS);
});

test('a planned work reference does not become an external table without its heading and header', () => {
  const h = harness();
  assert.equal(h.context.extractMorningMeetingOutsourcedWorkTable(worksheet({ heading: '' })), null);
  const noHeader = worksheet();
  noHeader.matrix[18] = [''];
  assert.equal(h.context.extractMorningMeetingOutsourcedWorkTable(noHeader), null);
});

for (const [teamKey, teamName] of [['safety', '안전팀'], ['environment', '환경팀'], ['electrical', '전기제어팀']]) {
  test(`${teamName} keeps existing sections and receives no external table`, async () => {
    const sheet = worksheet({ teamName });
    const h = harness({ SheetNames: ['보고서'], Sheets: { 보고서: sheet } });
    const result = await h.context.analyzeMorningMeetingTeamFile(teamKey, { name: 'team.xlsx', arrayBuffer: async () => new ArrayBuffer(1) });
    assert.equal(result.scheduleText, '1) 예정 정비\n2) 외주공사 준비 및 작업허가 확인');
    assert.equal(result.scheduleCount, 2);
    assert.equal(result.outsourcedWork, null);
    assert.equal(h.context.renderMorningMeetingOutsourcedWorkPreview({ ...result, outsourcedWork: { headers: HEADERS, rows: JOBS } }), '');
  });
}

test('file analysis selects the content date and previews the structured table below plans', async () => {
  const wrong = worksheet();
  wrong.matrix[0][0] = '일일업무_2026.10.18';
  const input = { SheetNames: ['2026-10-19', '10(17)'], Sheets: { '2026-10-19': wrong, '10(17)': worksheet({ withWidths: true }) } };
  const h = harness(input);
  const buffer = new ArrayBuffer(8);
  const result = await h.context.analyzeMorningMeetingTeamFile('mechanical', {
    name: 'synthetic-mechanical-report.xlsx', arrayBuffer: async () => buffer
  });
  assert.equal(h.xlsxCalls.length, 1);
  assert.equal(h.xlsxCalls[0].buffer, buffer);
  assert.deepEqual(plain(h.xlsxCalls[0].options), { type: 'array', cellFormula: true, cellDates: false, cellStyles: true });
  assert.equal(result.sheetName, '10(17)');
  assert.equal(result.reportDate, '2026.10.19');
  assert.equal(result.scheduleCount, 2);
  assert.deepEqual(plain(result.outsourcedWork.rows), JOBS);
  h.context.renderMorningMeetingAnalysisPreview([result]);
  assert.equal(h.preview.hidden, false);
  assert.equal(h.previewCount.textContent, '1개 팀');
  const scheduleTextarea = h.previewList.innerHTML.match(/data-morning-meeting-analysis-section="scheduleText"[\s\S]*?>([\s\S]*?)<\/textarea>/);
  assert.ok(scheduleTextarea, 'editable planned-work preview exists');
  assert.equal(scheduleTextarea[1], result.scheduleText);
  assert.ok(h.previewList.innerHTML.indexOf('data-morning-meeting-outsourced-work=') > h.previewList.innerHTML.indexOf('data-morning-meeting-analysis-section="scheduleText"'));
  assert.match(h.previewList.innerHTML, /background:#9DC3E6/);
  assert.equal((h.previewList.innerHTML.match(/<th scope="col"/g) || []).length, 6);
  assert.equal((h.previewList.innerHTML.match(/<td /g) || []).length, 12);
  for (const job of JOBS) for (const value of job) assert.ok(h.previewList.innerHTML.includes(value));
});

test('source cell HTML is escaped and newline rendering remains explicit', () => {
  const h = harness();
  const table = { headers: HEADERS, rows: [['외주', '<img src=x onerror="alert(1)">\n보강', 'A&B', '종일', '업체', '일반']], columnWidths: FALLBACK_WIDTHS };
  const html = h.context.renderMorningMeetingOutsourcedWorkPreview({ teamKey: 'mechanical', outsourcedWork: table });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;\n보강/);
  assert.match(html, /A&amp;B/);
  assert.match(html, /white-space:pre-line/);
});

test('reanalyzing source replaces structured rows without reusing a previous table', async () => {
  const sheet = worksheet();
  const h = harness({ SheetNames: ['원본'], Sheets: { 원본: sheet } });
  const file = { name: 'team.xlsx', arrayBuffer: async () => new ArrayBuffer(1) };
  const first = await h.context.analyzeMorningMeetingTeamFile('mechanical', file);
  sheet.matrix[19][2] = '수정된 공사';
  sheet.matrix[20] = [];
  const second = await h.context.analyzeMorningMeetingTeamFile('mechanical', file);
  assert.equal(first.outsourcedWork.rows.length, 2);
  assert.equal(second.outsourcedWork.rows.length, 1);
  assert.equal(second.outsourcedWork.rows[0][1], '수정된 공사');
  assert.equal(first.outsourcedWork.rows[0][1], JOBS[0][1]);
});
