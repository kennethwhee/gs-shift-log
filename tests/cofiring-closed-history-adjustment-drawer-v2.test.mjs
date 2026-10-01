import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');

test('closed-history API resolves active persisted period adjustments for old auto-closed rows',()=>{
  const source=read('functions/api/cofiring-closed-history.js');
  assert.match(source,/PERIOD_ADJUSTMENT_TABLE='cofiring_period_adjustment_history'/);
  assert.match(source,/async function latestClosedPeriodAdjustment/);
  assert.match(source,/function projectClosedPeriodAdjustment/);
  assert.match(source,/adjustment\.adjustFinal\(base,snapshot\.settings,entry\.finalBioUnit1,entry\.finalBioUnit2,entry\)/);
  assert.match(source,/await hydrateActivePeriodAdjustment\(db,item\);/);
  assert.match(source,/async function activeAdjustmentDates/);
  assert.match(source,/await applyMonthAdjustmentFlags\(db,month,items\);/);
});

test('detail UI prefers effective projected adjusted result and fresh month flags',()=>{
  const source=read('maintenance/cofiring-closed-history-final-detail-v1.js');
  assert.match(source,/const finalResult=item\?\.effectiveResult\|\|snapshot\?\.result\|\|\{\};/);
  assert.match(source,/const adjusted=item\?\.adjustmentApplied===true\|\|finalResult\?\.adjustment\?\.applied===true;/);
  assert.match(source,/const originalResult=item\?\.effectiveOriginalResult\|\|snapshot\?\.originalResult\|\|null;/);
  assert.match(source,/const payload=await api\('\?month='\+encodeURIComponent\(month\)\);/);
  assert.doesNotMatch(source,/if\(markerCache\.has\(month\)\)return markerCache\.get\(month\)/);
});

test('open detail drawer yields real layout space and compacts the left history table',()=>{
  const source=read('maintenance/cofiring-closed-history-final-detail-v1.css');
  assert.match(source,/\.efficiency-team-panel\.cfh-final-drawer-open \.efficiency-team-modal__body/);
  assert.match(source,/padding-right:var\(--cfh-final-drawer-width\)!important/);
  assert.match(source,/table\.cfh-readable-table\{\s*width:100%!important;\s*min-width:0!important;/s);
  assert.match(source,/\.cfh-final-drawer\{\s*width:var\(--cfh-final-drawer-width\)!important;\s*min-width:520px!important;/s);
  assert.match(source,/\.cfh-final-adjusted-day \.cfh-date strong\{\s*display:inline-block!important;/s);
});

test('closed-history detail asset cache keys are bumped to v2',()=>{
  const source=read('index.html');
  assert.equal((source.match(/cofiring-closed-history-final-detail-v1\.css\?v=20261001-v2/g)||[]).length,1);
  assert.equal((source.match(/cofiring-closed-history-final-detail-v1\.js\?v=20261001-v2/g)||[]).length,1);
});
