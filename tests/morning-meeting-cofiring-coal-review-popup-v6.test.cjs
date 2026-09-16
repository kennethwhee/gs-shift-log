'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo =
  path.resolve(
    __dirname,
    '..'
  );

const adjustment =
  fs.readFileSync(
    path.join(
      repo,
      'maintenance',
      'cofiring-period-adjustment-v56.js'
    ),
    'utf8'
  );

const index =
  fs.readFileSync(
    path.join(
      repo,
      'index.html'
    ),
    'utf8'
  );

assert.ok(
  adjustment.includes(
    'COFIRING-MAX-COAL-REVIEW-TOAST-DIRECT-V13-R1'
  )
);

assert.ok(
  adjustment.includes(
    '1·2호기 석탄 사용량 검토 필요'
  )
);

assert.ok(
  adjustment.includes(
    '3000'
  )
);

assert.ok(
  adjustment.includes(
    'z-index:2147483000'
  )
);

const handlerRegex =
  /q\s*\(\s*['"]\[data-cfv56-auto\]['"]\s*\)\s*\.addEventListener\s*\(\s*['"]click['"]\s*,\s*\(\s*\)\s*=>\s*\{\s*showCoalReviewToastV13R1\(\);/;

const match =
  handlerRegex.exec(
    adjustment
  );

assert.ok(
  match,
  'maximum adjustment handler must call toast directly'
);

const handlerStart =
  match.index;

const toastIndex =
  adjustment.indexOf(
    'showCoalReviewToastV13R1();',
    handlerStart
  );

const autoMaxIndex =
  adjustment.indexOf(
    'autoMax(',
    toastIndex
  );

assert.ok(
  toastIndex >= handlerStart
);

assert.ok(
  autoMaxIndex > toastIndex,
  'existing autoMax calculation must remain after toast call'
);

assert.ok(
  index.includes(
    'cofiring-period-adjustment-v56.js?v=20260917-coal-review-direct-v13-r1'
  )
);

assert.ok(
  !index.includes(
    'morning-meeting-cofiring-coal-review-popup-v4.js'
  )
);

assert.ok(
  !index.includes(
    'morning-meeting-permanent-purge-v1.js'
  )
);

console.log(
  'PASS: V13 R1 directly injects the 3-second Coal-review toast into the real maximum-cofiring button handler while preserving autoMax and login hotfix (10).'
);