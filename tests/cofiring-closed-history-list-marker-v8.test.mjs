import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');

test('monthly rows preserve hydrated effectiveResult and adjustmentApplied',()=>{
  const source=read('maintenance/cofiring-closed-history-cards-v2.js');
  assert.match(source,/const result=item\?\.effectiveResult\|\|snapshot\?\.result\|\|\{\};/);
  assert.match(source,/adjustmentApplied:item\?\.adjustmentApplied===true\|\|result\?\.adjustment\?\.applied===true/);
});

test('active adjusted dates render the orange marker directly in monthly rows',()=>{
  const source=read('maintenance/cofiring-closed-history-cards-v2.js');
  assert.match(source,/const adjusted=row\?\.adjustmentApplied===true;/);
  assert.match(source,/cfh-list-adjust-dot/);
  assert.match(source,/cfh-list-adjusted-day/);
  assert.match(source,/data-cfh-list-adjustment="1"/);
  assert.match(source,/cfh-date-line/);
});

test('monthly list reloads on co-firing adjustment apply or reset',()=>{
  const source=read('maintenance/cofiring-closed-history-cards-v2.js');
  assert.match(source,/cofiring:period-adjustment-changed/);
  assert.match(source,/detailCache\.clear\(\);/);
  assert.match(source,/if\(!panel\.hidden\)void loadList\(\{keepMonth:true\}\);/);
});

test('V8 CSS hides only legacy duplicate marker on V8-owned rows',()=>{
  const css=read('maintenance/cofiring-closed-history-list-marker-v8.css');
  assert.match(css,/\.cfh-list-adjust-dot/);
  assert.match(css,/background:#f59e0b/);
  assert.match(css,/data-cfh-list-adjustment="1"/);
  assert.match(css,/\.cfh-final-adjust-dot/);
  assert.match(css,/display:none!important/);
});

test('index bumps monthly script only and preserves final-detail V2 cache contracts',()=>{
  const source=read('index.html');
  assert.equal((source.match(/cofiring-closed-history-list-marker-v8\.css\?v=20261001-v8/g)||[]).length,1);
  assert.equal((source.match(/cofiring-closed-history-cards-v2\.js\?v=20261001-v8/g)||[]).length,1);
  assert.equal((source.match(/cofiring-closed-history-final-detail-v1\.css\?v=20261001-v2/g)||[]).length,1);
  assert.equal((source.match(/cofiring-closed-history-final-detail-v1\.js\?v=20261001-v2/g)||[]).length,1);
});
