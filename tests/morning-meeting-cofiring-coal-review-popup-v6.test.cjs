'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');

const overlay = fs.readFileSync(
  path.join(
    repo,
    'maintenance',
    'morning-meeting-cofiring-coal-review-popup-v4.js'
  ),
  'utf8'
);

assert.match(
  overlay,
  /MORNING-MEETING-COFIRING-COAL-REVIEW-V11-MAX-TOAST/
);

assert.match(
  overlay,
  /getElementById\(\s*["']efficiencyMorningMeetingView["']\s*\)/
);

assert.match(
  overlay,
  /normalizeText\([\s\S]*?button\.textContent[\s\S]*?\)\s*!==\s*["']혼소 조정["']/
);

assert.match(
  overlay,
  /\[data-cfv56-auto\]/
);

assert.match(
  overlay,
  /cfv56-adjust-modal/
);

assert.match(
  overlay,
  /showCoalReviewToast\(\)/
);

assert.match(
  overlay,
  /3000/
);

assert.match(
  overlay,
  /data-mmcr11-close/
);

assert.match(
  overlay,
  /1·2호기 석탄 사용량 검토 필요/
);

assert.match(
  overlay,
  /z-index:\s*20000/
);

assert.doesNotMatch(
  overlay,
  /showModal/
);

assert.doesNotMatch(
  overlay,
  /window\.confirm|root\.confirm/
);

assert.doesNotMatch(
  overlay,
  /stopImmediatePropagation/
);

/*
  Only inspect the global click router.
  The toast X button intentionally calls preventDefault/stopPropagation,
  so a whole-file regex is too broad and caused V11's false failure.
*/
const onClickStart = overlay.indexOf('  function onClick(');
const onClickEnd = overlay.indexOf(
  '  /*\n    Non-blocking behavior:',
  onClickStart
);

assert.ok(
  onClickStart >= 0 && onClickEnd > onClickStart,
  'onClick router section must be found'
);

const onClickSource = overlay.slice(
  onClickStart,
  onClickEnd
);

assert.doesNotMatch(
  onClickSource,
  /preventDefault|stopPropagation|stopImmediatePropagation/
);

assert.match(
  onClickSource,
  /isMaximumAdjustment\([\s\S]*?showCoalReviewToast\(\)/
);

assert.match(
  overlay,
  /Morning Meeting card "혼소 조정" opens normally/
);

console.log(
  'PASS: V11 R1 shows a non-blocking 3-second Coal-review toast only on Morning Meeting maximum co-firing adjustment (17).'
);
