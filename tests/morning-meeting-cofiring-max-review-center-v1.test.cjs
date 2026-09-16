'use strict';

const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const path =
  require('node:path');

const repo =
  path.resolve(
    __dirname,
    '..'
  );

const morning =
  fs.readFileSync(
    path.join(
      repo,
      'maintenance',
      'morning-meeting-cofiring-adjustment.js'
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
  morning.includes(
    'MORNING-MEETING-COFIRING-MAX-COAL-REVIEW-CENTER-V1'
  )
);

assert.ok(
  morning.includes(
    'morningMeetingCofiringAdjustmentModal'
  )
);

assert.ok(
  morning.includes(
    'morning-meeting-cofiring-adjustment-dialog'
  )
);

assert.ok(
  morning.includes(
    'morningMeetingCofiringMaxAuto'
  )
);

assert.ok(
  morning.includes(
    '1,2호기 석탄 사용량 검토 필요합니다.'
  )
);

assert.ok(
  morning.includes(
    '3000'
  )
);

assert.ok(
  morning.includes(
    'hideMorningMeetingCofiringCoalReviewV1'
  )
);

const handlerRegex =
  /maxAuto\?\.\s*addEventListener\s*\(\s*"click"\s*,\s*\(\)\s*=>\s*\{\s*showMorningMeetingCofiringCoalReviewV1\(\);/;

const handler =
  handlerRegex.exec(
    morning
  );

assert.ok(
  handler,
  'morning-meeting maximum button must call the centered notice'
);

const handlerStart =
  handler.index;

const noticeIndex =
  morning.indexOf(
    'showMorningMeetingCofiringCoalReviewV1();',
    handlerStart
  );

const calculateIndex =
  morning.indexOf(
    'calculateMaxAutoAdjustment(',
    noticeIndex
  );

assert.ok(
  calculateIndex >
    noticeIndex,
  'notice must run before the existing maximum adjustment calculation'
);

assert.ok(
  index.includes(
    'morning-meeting-cofiring-adjustment.js?v=20260917-max-coal-review-center-v1'
  )
);

assert.ok(
  index.includes(
    'cofiring-period-adjustment-v56.js?'
  )
);

assert.ok(
  index.includes(
    'cofiring-period-ui-v5.js?'
  )
);

assert.ok(
  !index.includes(
    'morning-meeting-permanent-purge-v1.js'
  )
);

console.log(
  'PASS: Morning Meeting co-firing max button directly shows the centered 3-second Coal review notice with X close, without modifying the separate co-firing calculation menu (12).'
);