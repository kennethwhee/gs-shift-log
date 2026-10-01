import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');

test('latest exact-period CLEAR state overrides stale adjusted closed snapshot',()=>{
  const source=read('functions/api/cofiring-closed-history.js');
  assert.match(source,/async function latestClosedPeriodAdjustmentState/);
  assert.match(source,/async function latestClosedPeriodAdjustment/);
  assert.match(source,/if\(state\.found\)\{/);
  assert.match(source,/item\.adjustmentApplied=false;/);
  assert.match(source,/item\.effectiveResult=snapshot\.originalResult\|\|snapshot\.result;/);
  assert.match(source,/item\.adjustmentSource='period_adjustment_cleared';/);
  const statePos=source.indexOf('if(state.found){');
  const fallbackPos=source.indexOf("if(snapshot.result?.adjustment?.applied===true){",statePos);
  assert.ok(statePos>=0&&fallbackPos>statePos,'history state must precede snapshot fallback');
});

test('monthly adjustment state can explicitly clear a stale snapshot marker',()=>{
  const source=read('functions/api/cofiring-closed-history.js');
  assert.match(source,/async function adjustmentStatesByDate/);
  assert.match(source,/function closedDailyAdjustmentDate/);
  assert.match(source,/states\.set\(date,!!closedStoredAdjustment\(row\)\)/);
  assert.match(source,/if\(states\.has\(date\)\)item\.adjustmentApplied=states\.get\(date\);/);
  // V3 compatibility contract remains present.
  assert.match(source,/async function activeAdjustmentDates/);
});

test('apply and revert notify already-open closed history UI',()=>{
  const source=read('maintenance/cofiring-period-ui-v5.js');
  assert.match(source,/function notifyPeriodAdjustmentChanged\(\)/);
  assert.match(source,/cofiring:period-adjustment-changed/);
  assert.match(source,/renderDisplay\(result,\{adjusted:true\}\);notifyPeriodAdjustmentChanged\(\);/);
  assert.match(source,/renderDisplay\(lastResult,\{adjusted:false\}\);notifyPeriodAdjustmentChanged\(\);/);
});

test('V5 CSS makes adjustment action obvious and preserves left-table readability',()=>{
  const source=read('maintenance/cofiring-closed-history-fix-v5.css');
  assert.match(source,/\[data-cfv56-adjust\]:not\(:disabled\)/);
  assert.match(source,/color:#111827!important;/);
  assert.match(source,/font-weight:900!important;/);
  assert.match(source,/--cfh-final-drawer-width:clamp\(480px,33vw,520px\)!important;/);
  assert.match(source,/font-size:11px!important;/);
  assert.match(source,/font-size:12\.5px!important;/);
});

test('index keeps existing V2 detail assets and adds V5 override/cache-bust',()=>{
  const source=read('index.html');
  assert.equal((source.match(/cofiring-closed-history-final-detail-v1\.css\?v=20261001-v2/g)||[]).length,1);
  assert.equal((source.match(/cofiring-closed-history-final-detail-v1\.js\?v=20261001-v2/g)||[]).length,1);
  assert.equal((source.match(/cofiring-closed-history-fix-v5\.css\?v=20261001-v5/g)||[]).length,1);
  assert.match(source,/cofiring-period-ui-v5\.js\?[^"]*closedHistorySync=20261001-v5/);
  assert.ok(source.indexOf('cofiring-closed-history-fix-v5.css')>source.indexOf('cofiring-closed-history-final-detail-v1.css'));
});
