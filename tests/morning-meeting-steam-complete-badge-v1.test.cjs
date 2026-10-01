const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'maintenance',
    'morning-meeting-steam-ois-probe-v1.js'
  ),
  'utf8'
);

test('steam complete status uses the same green morning-card badge contract',()=>{
  assert.match(
    source,
    /if \(phase === "complete"\) return "조회 완료";/
  );

  assert.match(
    source,
    /element\.classList\.add\(\s*"efficiency-morning-meeting-auto-card__badge"\s*\)/
  );

  assert.match(
    source,
    /else if \(phase === "complete"\) \{\s*element\.classList\.add\("is-complete"\);/
  );

  assert.match(
    source,
    /applyStatusBadgeState\(statusElement\)/
  );
});

test('steam loading and error states retain the common badge state classes',()=>{
  assert.match(
    source,
    /phase === "loading"[\s\S]*classList\.add\("is-loading"\)/
  );

  assert.match(
    source,
    /phase === "error"[\s\S]*classList\.add\("is-error"\)/
  );
});
