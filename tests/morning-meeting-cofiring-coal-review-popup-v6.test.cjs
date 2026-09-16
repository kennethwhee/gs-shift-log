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
  /COFIRING-COAL-REVIEW-V12-MAX-TOAST-UNCONDITIONAL/
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
  /data-cfcr12-close/
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
  /morningCardContext/
);

assert.doesNotMatch(
  overlay,
  /isMorningMeetingCardEntry/
);

assert.doesNotMatch(
  overlay,
  /isAnalysisPageEntry/
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
  /Every visible "최대혼소 조정" click keeps its original calculation handler/
);

console.log(
  'PASS: V12 always shows a non-blocking 3-second Coal-review toast on visible maximum co-firing adjustment clicks (17).'
);
