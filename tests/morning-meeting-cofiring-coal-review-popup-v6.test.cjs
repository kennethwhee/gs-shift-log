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
  /MORNING-MEETING-COFIRING-COAL-REVIEW-POPUP-V8-DIRECT-HANDLER-API/
);

assert.match(
  overlay,
  /confirmBeforeOpen\s*:\s*showReviewDialog/
);

assert.match(
  overlay,
  /1·2호기 석탄 사용량 검토 필요/
);

assert.match(
  overlay,
  /showModal/
);

assert.doesNotMatch(
  overlay,
  /window\.addEventListener\(\s*["']click["']/
);

assert.match(
  ui,
  /const adjustButton=container\.querySelector\('\[data-cfv56-adjust\]'\)/
);

assert.match(
  ui,
  /adjustButton\.addEventListener\('click',async\(\)=>/
);

assert.match(
  ui,
  /container\.closest\?\.\('\[data-efficiency-view="morning-meeting"\],#efficiencyMorningMeetingView'\)/
);

assert.match(
  ui,
  /root\.MorningMeetingCofiringCoalReviewPopupV8/
);

assert.match(
  ui,
  /await reviewApi\.confirmBeforeOpen\(\)/
);

assert.match(
  ui,
  /1·2호기 석탄 사용량 검토 필요/
);

assert.match(
  ui,
  /await Promise\.resolve\(adjuster\?\.open\(\)\)/
);

const confirmAt = ui.indexOf('await reviewApi.confirmBeforeOpen()');
const openAt = ui.indexOf('await Promise.resolve(adjuster?.open())');

assert.ok(
  confirmAt >= 0 && openAt > confirmAt,
  'review confirmation must occur before adjuster.open()'
);

console.log(
  'PASS: morning-meeting co-firing coal review V8 direct-handler contracts (13).'
);
