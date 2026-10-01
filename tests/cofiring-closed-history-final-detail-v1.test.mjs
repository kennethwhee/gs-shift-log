import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');

test('closed validator preserves server-derived original result only for adjusted closes',()=>{
  const source=read('functions/_shared/cofiring-closed-validation.js');
  assert.match(source,/const originalResult = result;/);
  assert.match(source,/validationVersion: 6/);
  assert.match(source,/\.\.\.\(shown\.adjustment\?\.applied===true\?\{originalResult\}:\{\}\), result, summary/);
});

test('closed history API exposes adjustment flag and reconstructs old adjusted originals read-only',()=>{
  const source=read('functions/api/cofiring-closed-history.js');
  assert.match(source,/adjustmentApplied/);
  assert.match(source,/json_extract\(snapshot_json,'\$\.result\.adjustment\.applied'\)/);
  assert.match(source,/async function hydrateClosedComparison/);
  assert.match(source,/await hydrateClosedComparison\(db,item\);/);
  assert.match(source,/item\.snapshot=\{\.\.\.item\.snapshot,originalResult:canonical\.snapshot\.originalResult\}/);
});

test('history table retains one action pair per date and 1·2 unit combined column',()=>{
  const source=read('maintenance/cofiring-closed-history-cards-v2.js');
  assert.match(source,/class="cfh-actions" rowspan="2"/);
  assert.match(source,/>보기<\/button><button type="button" class="danger"/);
  assert.match(source,/1·2호기 종합/);
  assert.match(source,/class="cfh-combined" rowspan="2"/);
});

test('new detail layer intercepts only View and opens right-side drawer with adjusted/original states',()=>{
  const source=read('maintenance/cofiring-closed-history-final-detail-v1.js');
  assert.match(source,/data-cfv15-view/);
  assert.match(source,/addEventListener\('click',captureView,true\)/);
  assert.doesNotMatch(source,/closest\?\.\('\[data-cfv15-delete\]'\)/);
  assert.match(source,/혼소조정 적용/);
  assert.match(source,/혼소조정 없음/);
  assert.match(source,/원본값 ↔ 혼소조정 비교/);
  assert.match(source,/1·2호기 종합/);
  assert.match(source,/cfh-final-adjust-dot/);
});

test('index loads final detail assets exactly once after closed-history assets',()=>{
  const source=read('index.html');
  assert.equal((source.match(/cofiring-closed-history-final-detail-v1\.css/g)||[]).length,1);
  assert.equal((source.match(/cofiring-closed-history-final-detail-v1\.js/g)||[]).length,1);
  assert.ok(source.indexOf('cofiring-closed-history-final-detail-v1.css')>source.indexOf('cofiring-closed-history-table-rebuild-v1.css'));
  assert.ok(source.indexOf('cofiring-closed-history-final-detail-v1.js')>source.indexOf('cofiring-closed-history-table-rebuild-v1.js'));
});
