import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeContent,
  isReplacementCandidate,
  normalizeAnnotation,
} from '../maintenance/diary-vbelt-core-v1.js';

const CONTENT = 'FBHE Blower #A V-Belt 교체 완료';
const TARGET = Object.freeze({
  tagNumber: '104HHL60AP611',
  replacedOn: '2026-08-25',
  completedTime: '14:25',
});
const confirmation = (content = CONTENT, targets = [{...TARGET}]) => ({
  version: 1,
  confirmed: true,
  content: normalizeContent(content),
  targets,
});

// These quotations are actual diary wording, not evidence of physical event counts.
// OIS references identify export_rowid in ois_legacy_logs; newer references identify
// their original table row. Each positive result only means "show an unchecked box".
const positiveCorpusCases = [
  ['OIS 277: emergency replacement completed',
    '4. 19:10~20:42 BM발행 후 FBHE Blower #C V-belt 교체 완료'],
  ['OIS 536: exchange requested, not automatically completed',
    '7. FBHE Blower #A V-Belt 교환 요청 (TM발행)'],
  ['OIS 6523: equipment and completion inherited within one item',
    "3. 17:26 FBHE Blower #C 작업 완료\n           - V-belt 신품 교체\n           - Disch' 측 PSV air Leak 관련 O-ring 교체 실시"],
  ['OIS 7601: truncated completion spelling still exposes a candidate',
    '6. 10:11 Fly Ash Bag Filter Aeration Blower #A Belt 교체 완ㄹ'],
  ['OIS 11471: Korean belt spelling',
    '8. 11:20 FBHE Blower #C 벨트 교체 작업 완료. 기존에 사용하던 업무일지 벨트 교체 이력 시트에 기입 완료.'],
  ['OIS 12202: completed belt and separately planned cover repair',
    '8. FBHE Blower #A V-belt 교체완료 -> 안전커버 그물망 손상되어 용접 작업 예정'],
  ['OIS 12834: historical mention is a candidate, not today\'s event',
    '4. FBHE Blower #A Belt 한가닥 스윙 있어 추이 관찰 중.(벨트 교체 : 12/6일 완료)'],
  ['OIS 14060: different equipment has completed and planned work',
    '5. FBHE Blower 관련\n - FBHE Blower #A Belt 교체 완료 (12:30)\n - FBHE Blower #B Belt 교체 필요'],
  ['OIS 14111: device typo and V- belt spacing do not auto-select a device',
    '1.08:00 BHE Blower #B Pulley측 온도상승관련 V- belt 교체'],
  ['OIS 14699: actual belt replacement plus tension adjustment',
    '6. FBHE Blower #C Belt 교체, Tension 조정 (TM 완료)'],
  ['OIS 16397: implicit action after belt defect, within device item',
    '9. 13:22 FBHE Blower #C To #A 교체운전 실시\n - #C Belt Crack 발견(1가닥)_현장 교체 실시완료'],
  ['legacy_logs 2248: several units and positions remain only a candidate',
    '#1 ,2 FBHE Blower #A-C V-Belt 전량 교체 완료'],
  ['corpus B1555/B1556: belt and filter are parallel replacement objects',
    'FBHE Blower #C V-Belt 및 Suction Filter 교체 완료'],
];

for (const [label, content] of positiveCorpusCases) {
  test(`candidate: ${label}`, () => {
    assert.equal(isReplacementCandidate(content), true);
    assert.equal(normalizeAnnotation(null, content), null,
      'finding even explicit completion words must not create confirmation');
    const unchecked = normalizeAnnotation({
      version: 1, confirmed: false, content: normalizeContent(content), targets: [],
    }, content);
    assert.equal(unchecked?.confirmed, false);
    assert.deepEqual(unchecked?.targets, []);
  });
}

const negativeCorpusCases = [
  ['OIS 7115: filter replaced; belt only adjusted',
    '4. 10:07 FBHE Blower #C → #A 교체운전\n  - #C V-belt Tension 조정 및 Suction Filter 교체 완료'],
  ['OIS 14076: requested replacement superseded by adjustment',
    '1. 23:50 FBHE Blower #B 기동\n  - V-Belt 교체 요청하였으나, 자재 부족으로 Tension 조정\n  - #B Pully, Belt Temp 상승 중'],
  ['OIS 6533: broken belt led to switching the running machine',
    '9. FBHE Blower #C V-Belt 끊어짐으로 인한 교체 운전\n   (#C →B)'],
  ['OIS 4189: blower installation and belt fastening, not replacement',
    '7. FBHE BLWR, Seal Pot BLWR 취부 완료(Belt 체결 중)'],
  ['OIS 12250: AHU fan replacement is not a blower replacement',
    '1. HVAC AHU-202 흡기팬, 환기팬 V-Belt 교체 및 Tension 조정 실시 - 운전상태 양호'],
  ['OIS 8890: coal feeder belt replacement is a different device',
    '1. Coal Feeder #A Belt 교체 후 Local Mode 기동 Test (양호)'],
  ['OIS 14996: coal belt and blower cap are unrelated numbered jobs',
    '2. 07:32 Coal Feeder #B Belt Slip 발생 Tension 조정\n   - 좌우측 각각 반바퀴, 현장점검시 밸트 사행 확인바람\n10. FBHE Blower #Oil 주입구 Leak 관련 Cap 교체작업'],
  ['legacy_logs 6238: explicit nonreplacement',
    'Motor 위치 변경하여 장력 조정(Belt는 상태양호하여 미교체)'],
  ['corpus B1463: silencer replacement and a later belt inspection request',
    'FBHE Blower Silencer 교체작업 때 Belt 점검 요청하기로 함.'],
  ['corpus B1715: adding history fields is administrative work',
    '#1,2 BLR FBHE, Seal Pot 등 V-Belt 이력관리 추가(교체연월일, 제조사 등)'],
];

for (const [label, content] of negativeCorpusCases) {
  test(`not a candidate: ${label}`, () => {
    assert.equal(isReplacementCandidate(content), false);
    assert.equal(normalizeAnnotation(confirmation(content), content), null,
      'a forged checked annotation cannot turn nonreplacement text into replacement');
  });
}

test('bare replacement can expose a checkbox before an asset is selected', () => {
  const content = 'V Belt 교체 완료';
  assert.equal(isReplacementCandidate(content), true);
  assert.equal(normalizeAnnotation(confirmation(content, []), content), null);
});

test('pure tension or another part replacement cannot borrow the belt word', () => {
  for (const content of [
    'FBHE Blower #A V-Belt 장력 조정 완료',
    'FBHE Blower #A V-Belt Tension 조절 실시',
    'FBHE Blower #A V-Belt 안전 Cover 교체 완료',
    'FBHE Blower #A V-Belt Pulley 교체 완료',
    '1. FBHE Blower #A V-Belt 점검\n2. FBHE Blower #B Suction Filter 교체 완료',
  ]) {
    assert.equal(isReplacementCandidate(content), false, content);
    assert.equal(normalizeAnnotation(confirmation(content), content), null,
      'manual confirmation cannot bypass a tension-only or wrong-part exclusion');
  }
});

test('an unrelated blower elsewhere cannot relabel an AHU belt job', () => {
  const content = '1. AHU-202 V-Belt 교체 완료\n2. FBHE Blower #A Suction Filter 교체 완료';
  assert.equal(isReplacementCandidate(content), false);
  assert.equal(normalizeAnnotation(confirmation(content), content), null);
});

test('a later genuine belt replacement survives an earlier tension phrase', () => {
  assert.equal(isReplacementCandidate(
    'FBHE Blower #A Belt Tension 조정 후 V-Belt 교체 완료'), true);
});

test('a requested job superseded by adjustment remains nonreplacement across an arrow', () => {
  const content = 'FBHE Blower #A V-Belt 교체 요청 → 자재 부족으로 Tension 조정';
  assert.equal(isReplacementCandidate(content), false);
  assert.equal(normalizeAnnotation(confirmation(content), content), null);
});

test('separate negative work does not erase an actual replacement candidate', () => {
  assert.equal(isReplacementCandidate(
    '1. FBHE Blower #A V-Belt 교체 완료\n2. FBHE Blower #B V-Belt 미교체'), true);
});

test('normalization is deterministic, preserves task boundaries, and accepts only text', () => {
  const content = '  FBHE Blower #A V-Belt 교체 완료\r\n  - Test 양호  ';
  const normalized = normalizeContent(content);
  assert.equal(typeof normalized, 'string');
  assert.equal(normalizeContent(normalized), normalized);
  assert.ok(normalized.includes('\n'));
  assert.ok(!normalized.includes('\r'));
  for (const value of [null, undefined, 7, true, [], {}]) {
    assert.equal(normalizeContent(value), '');
    assert.equal(isReplacementCandidate(value), false);
  }
});

test('valid confirmation preserves explicit date and optional time without inventing midnight', () => {
  const targets = [
    {...TARGET, tagNumber: ' 104hhl60ap611 ', completedTime: ''},
    {...TARGET, tagNumber: '204HHL60AP611', replacedOn: '2024-02-29', completedTime: '00:00'},
  ];
  const raw = confirmation(CONTENT, targets);
  const before = structuredClone(raw);
  assert.deepEqual(normalizeAnnotation(raw, CONTENT), {
    version: 1, confirmed: true, content: normalizeContent(CONTENT),
    targets: [
      {...TARGET, completedTime: ''},
      {...TARGET, tagNumber: '204HHL60AP611', replacedOn: '2024-02-29', completedTime: '00:00'},
    ],
  });
  assert.deepEqual(raw, before, 'normalization must not mutate caller state');
});

test('unchecking clears targets and never retains a hidden positive confirmation', () => {
  const raw = {...confirmation(), confirmed: false};
  assert.deepEqual(normalizeAnnotation(raw, CONTENT), {
    version: 1, confirmed: false, content: normalizeContent(CONTENT), targets: [],
  });
  assert.equal(raw.targets.length, 1);
});

test('confirmation must bind to current normalized content', () => {
  const raw = confirmation();
  assert.equal(normalizeAnnotation(raw, CONTENT.replace('#A', '#B')), null);
  assert.equal(normalizeAnnotation(raw, 'FBHE Blower #A V-Belt 장력 조정 완료'), null);
  assert.equal(normalizeAnnotation({...raw, content: ''}, CONTENT), null);
  assert.ok(normalizeAnnotation(raw, `\r\n${CONTENT}\r\n`));
});

test('malformed annotations cannot coerce version or confirmation state', () => {
  const valid = confirmation();
  for (const raw of [null, undefined, [], 'true', 1, {},
    {...valid, version: '1'}, {...valid, version: 2},
    {...valid, confirmed: 'false'}, {...valid, confirmed: 'true'},
    {...valid, confirmed: 1}, {...valid, confirmed: null},
    {...valid, content: null},
  ]) assert.equal(normalizeAnnotation(raw, CONTENT), null, JSON.stringify(raw));
});

test('confirmed annotations require a nonempty bounded target array', () => {
  for (const targets of [undefined, null, {}, [], '104HHL60AP611']) {
    assert.equal(normalizeAnnotation({...confirmation(), targets}, CONTENT), null);
  }
  const targets = Array.from({length: 27}, (_, i) => ({
    ...TARGET, tagNumber: `104HHL60AP${String(601 + i)}`,
  }));
  assert.equal(normalizeAnnotation(confirmation(CONTENT, targets), CONTENT)?.targets.length, 27);
  targets.push({...TARGET, tagNumber: '204HHL60AP611'});
  assert.equal(normalizeAnnotation(confirmation(CONTENT, targets), CONTENT), null);
});

test('malformed target objects and tags invalidate the entire confirmation', () => {
  for (const target of [null, [], '104HHL60AP611', {},
    {...TARGET, tagNumber: ''}, {...TARGET, tagNumber: 'FBHE-A'},
    {...TARGET, tagNumber: '104 HHL60AP611'}, {...TARGET, tagNumber: '104HHL60AP611!'},
    {...TARGET, tagNumber: 104},
  ]) {
    assert.equal(normalizeAnnotation(confirmation(CONTENT, [{...TARGET}, target]), CONTENT), null);
  }
});

test('duplicate normalized tags are rejected even with conflicting dates or times', () => {
  const targets = [{...TARGET}, {
    ...TARGET, tagNumber: ' 104hhl60ap611 ', replacedOn: '2026-08-24', completedTime: '01:00',
  }];
  assert.equal(normalizeAnnotation(confirmation(CONTENT, targets), CONTENT), null);
});

test('calendar dates must be real exact YYYY-MM-DD dates', () => {
  for (const replacedOn of ['', '2023-02-29', '2024-02-30', '2026-04-31',
    '2026-13-01', '2026-00-01', '2026-01-00', '2026-8-25',
    '26-08-25', '2026-08-25T00:00:00Z', null, 20260825]) {
    const targets = [{...TARGET, replacedOn}];
    assert.equal(normalizeAnnotation(confirmation(CONTENT, targets), CONTENT), null, String(replacedOn));
  }
});

test('time stays absent or exact HH:mm within a real clock day', () => {
  for (const completedTime of ['', '00:00', '09:05', '23:59']) {
    const value = normalizeAnnotation(confirmation(CONTENT, [{...TARGET, completedTime}]), CONTENT);
    assert.equal(value?.targets[0].completedTime, completedTime);
  }
  for (const completedTime of ['24:00', '23:60', '9:05', '09:5', '09:05:00',
    ' 09:05', '-1:00', 'NaN', null, undefined, 930]) {
    assert.equal(normalizeAnnotation(confirmation(CONTENT, [{...TARGET, completedTime}]), CONTENT), null,
      String(completedTime));
  }
});

test('one invalid target never silently drops out of a multi-asset confirmation', () => {
  const targets = [{...TARGET}, {
    ...TARGET, tagNumber: '204HHL60AP611', replacedOn: '2026-02-30',
  }];
  assert.equal(normalizeAnnotation(confirmation(CONTENT, targets), CONTENT), null);
});
