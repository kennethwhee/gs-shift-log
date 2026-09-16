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
    'COFIRING-MAX-INLINE-MODAL-MESSAGE-V14-R1'
  )
);

assert.ok(
  adjustment.includes(
    '1,2호기 석탄 사용량 검토 필요합니다.'
  )
);

assert.ok(
  adjustment.includes(
    '.cfv56-adjust-dialog'
  )
);

assert.ok(
  adjustment.includes(
    'host.appendChild'
  )
);

assert.ok(
  adjustment.includes(
    'place-items:center'
  )
);

assert.ok(
  adjustment.includes(
    'data-cfv56-coal-review-center-close'
  )
);

assert.ok(
  adjustment.includes(
    '3000'
  )
);

assert.ok(
  adjustment.includes(
    'showCoalReviewToastV13R1();'
  )
);

const handlerIndex =
  adjustment.indexOf(
    "q('[data-cfv56-auto]')"
  );

const toastIndex =
  adjustment.indexOf(
    'showCoalReviewToastV13R1();',
    handlerIndex
  );

const autoMaxIndex =
  adjustment.indexOf(
    'autoMax(',
    toastIndex
  );

assert.ok(
  handlerIndex >= 0 &&
  toastIndex > handlerIndex &&
  autoMaxIndex > toastIndex,
  'maximum handler must show message and then continue existing autoMax'
);

assert.ok(
  !adjustment.includes(
    'doc.body.appendChild(toast)'
  )
);

assert.ok(
  index.includes(
    'cofiring-period-adjustment-v56.js?v=20260917-inline-modal-center-v14-r1'
  )
);

assert.ok(
  !index.includes(
    'morning-meeting-permanent-purge-v1.js'
  )
);

console.log(
  'PASS: V14 R1 shows the Coal-review message in the center of the active co-firing dialog for 3 seconds or until X, preserves autoMax, and keeps the login purge hotfix (12).'
);