'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const overlayPath = path.join(
  repo,
  'maintenance',
  'morning-meeting-cofiring-coal-review-popup-v4.js'
);

const source = fs.readFileSync(overlayPath, 'utf8');

assert.match(
  source,
  /MORNING-MEETING-COFIRING-COAL-REVIEW-POPUP-V6-WINDOW-CAPTURE/
);

assert.match(
  source,
  /window\.addEventListener\(\s*["']click["'][\s\S]*?interceptMaximumAdjustment[\s\S]*?true\s*\)/
);

assert.match(
  source,
  /\[data-cfv56-auto\]/
);

assert.match(
  source,
  /\[data-efficiency-tab="morning-meeting"\]/
);

assert.match(
  source,
  /classList\.contains\(\s*["']is-active["']\s*\)/
);

assert.match(
  source,
  /aria-selected/
);

assert.match(
  source,
  /stopImmediatePropagation\(\)/
);

assert.match(
  source,
  /showModal/
);

assert.match(
  source,
  /dialog\[data-mm-cofiring-coal-review-v6\]::backdrop/
);

assert.match(
  source,
  /WeakSet/
);

assert.match(
  source,
  /replayButtons\.add/
);

assert.match(
  source,
  /button\.click\(\)/
);

assert.match(
  source,
  /1·2호기 석탄 사용량 검토 필요/
);

assert.doesNotMatch(
  source,
  /\bfetch\s*\(/
);

assert.doesNotMatch(
  source,
  /\/api\//
);

console.log(
  'PASS: morning-meeting co-firing coal review V6 window-capture/top-layer contracts (15).'
);
