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

const ui = fs.readFileSync(
  path.join(
    repo,
    'maintenance',
    'cofiring-period-ui-v5.js'
  ),
  'utf8'
);

assert.match(
  overlay,
  /MORNING-MEETING-COFIRING-COAL-REVIEW-POPUP-V10-MORNING-CARD/
);

assert.match(
  overlay,
  /getElementById\(\s*["']efficiencyMorningMeetingView["']\s*\)/
);

assert.match(
  overlay,
  /normalizeButtonText\([\s\S]*?button\.textContent[\s\S]*?\)\s*!==\s*["']혼소 조정["']/
);

assert.match(
  overlay,
  /morningView\.contains\([\s\S]*?button[\s\S]*?\)/
);

assert.match(
  overlay,
  /button\.closest\?\.\([\s\S]*?cfv56-adjust-modal/
);

assert.match(
  overlay,
  /window\.addEventListener\(\s*["']click["'][\s\S]*?interceptMorningCardAdjustment[\s\S]*?true\s*\)/
);

assert.match(
  overlay,
  /stopImmediatePropagation\(\)/
);

assert.match(
  overlay,
  /showReviewDialog\(\)/
);

assert.match(
  overlay,
  /replayButtons\.add\([\s\S]*?button[\s\S]*?\)[\s\S]*?button\.click\(\)/
);

assert.match(
  overlay,
  /1·2호기 석탄 사용량 검토 필요/
);

assert.doesNotMatch(
  overlay,
  /\[data-cfv56-adjust\]/
);

assert.doesNotMatch(
  overlay,
  /\[data-cfv56-auto\]/
);

/* V8/V9 mistakenly altered the separate co-firing analysis-page button.
   V10 must restore its original direct open handler. */
assert.doesNotMatch(
  ui,
  /MorningMeetingCofiringCoalReviewPopupV8/
);

assert.doesNotMatch(
  ui,
  /MorningMeetingCofiringCoalReviewPopupV10/
);

assert.match(
  ui,
  /const adjustButton=container\.querySelector\('\[data-cfv56-adjust\]'\);if\(adjustButton\)\{adjustButton\.disabled=true;adjustButton\.addEventListener\('click',\(\)=>\{try\{Promise\.resolve\(adjuster\?\.open\(\)\)\.catch/
);

console.log(
  'PASS: V10 targets only the Morning Meeting "혼소 조정" card button and restores the separate analysis-page handler (15).'
);
