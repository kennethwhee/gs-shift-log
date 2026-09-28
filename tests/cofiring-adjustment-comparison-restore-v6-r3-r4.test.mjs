import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2]||process.cwd());
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');
const css=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-restore-v6-r3-r4.css'),'utf8');
const r2=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-compact-v6-r2.css'),'utf8');

function block(name,nextName){
  const start=ui.indexOf('function '+name);
  assert.ok(start>=0,name+' exists');
  const end=nextName?ui.indexOf('function '+nextName,start+1):-1;
  return ui.slice(start,end>start?end:start+6000);
}

test('V6 R3 R4 keeps published comparison behavior and adds only a restore-layout guard',()=>{
  assert.match(ui,/COFIRING_ADJUSTED_COMPARISON_CARDS_V4/);
  assert.match(r2,/COFIRING ADJUSTED COMPARISON CARDS V6 R2/);
  assert.match(ui,/COFIRING_ADJUSTED_COMPARISON_RESTORE_FLASH_FIX_V6_R3_R4/);
  assert.match(ui,/function cfvSummaryLayoutPending\(active\)/);
});

test('nested async periodChanged signature enables pending guard before null summary rendering',()=>{
  const start=ui.indexOf('async function periodChanged(');
  assert.ok(start>=0);
  const end=ui.indexOf('function refreshDailyForClick',start);
  const b=ui.slice(start,end>start?end:start+7000);
  const pending=b.indexOf("cfvSummaryLayoutPending(queryMode(container)==='daily')");
  const placeholder=b.indexOf('renderSummary(container,null');
  assert.ok(pending>=0&&placeholder>pending,'pending guard must precede null summary render');
});

test('final render and terminal preparation reveal the grid',()=>{
  const render=block('renderDisplay','adjustmentContext');
  assert.match(render,/\{cfvSummaryLayoutPending\(false\);/);
  const prep=block('prepLabel','renderDisplay');
  assert.match(prep,/tone==='ready'\|\|tone==='error'/);
  assert.match(prep,/cfvSummaryLayoutPending\(false\)/);
});

test('desktop CSS suppresses temporary summary children and preserves footprint',()=>{
  assert.match(css,/@media screen and \(min-width: 901px\)/);
  assert.match(css,/cfv-summary-final-layout-pending \[data-cfv52-summary-grid\][\s\S]*?min-height:\s*250px/s);
  assert.match(css,/cfv-summary-final-layout-pending \[data-cfv52-summary-grid\] > \*[\s\S]*?visibility:\s*hidden\s*!important/s);
  assert.doesNotMatch(css,/display:\s*none\s*!important/);
});

test('R3 R3 stylesheet loads after R2',()=>{
  const r2Pos=index.indexOf('/maintenance/cofiring-adjustment-comparison-compact-v6-r2.css');
  const r3Pos=index.indexOf('/maintenance/cofiring-adjustment-comparison-restore-v6-r3-r4.css?v=20260928-adjusted-comparison-restore-v6-r3-r4');
  assert.ok(r2Pos>=0&&r3Pos>r2Pos);
});
