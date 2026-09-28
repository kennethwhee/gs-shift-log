import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2]||process.cwd());
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');
const v4=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-v4.css'),'utf8');
const v6=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-compact-v6.css'),'utf8');
const r1=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-compact-v6-r1.css'),'utf8');

test('V6 R1 remains CSS-only on top of the published V4 and V6 comparison implementation',()=>{
  assert.match(ui,/COFIRING_ADJUSTED_COMPARISON_CARDS_V4/);
  assert.match(ui,/container\.__cfvAdjustedComparisonState = adjusted/);
  assert.match(v4,/\.cfv52-summary-grid > \.cfv-adjustment-card/);
  assert.match(v6,/COFIRING ADJUSTED COMPARISON CARDS V6/);
  assert.match(r1,/COFIRING ADJUSTED COMPARISON CARDS V6 R1/);
});

test('active adjustment state is now the approved red emphasis',()=>{
  const block=r1.match(/\[data-cfv56-adjust\]\.is-active\s*\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(block,/background:\s*#fff0f0\s*!important/);
  assert.match(block,/border-color:\s*#ef7777\s*!important/);
  assert.match(block,/color:\s*#c73636\s*!important/);
});

test('desktop cards are slightly more compact than V6 without hiding the original deadline block',()=>{
  assert.match(r1,/@media screen and \(min-width: 901px\)/);
  assert.match(r1,/\.cfv52-summary-grid\s*\{[\s\S]*?gap:\s*7px 12px/s);
  assert.match(r1,/\.cfv52-summary-grid > \.cfv-adjustment-card\s*\{[\s\S]*?margin-top:\s*14px/s);
  assert.match(r1,/\.cfv52-summary-grid > \.cfv-adjustment-original-card \[data-cfv6-target\]/);
  assert.doesNotMatch(r1,/\.cfv-adjustment-original-card[^}]*display:\s*none/s);
});

test('changed delta values are larger than the V6 compact value',()=>{
  assert.match(v6,/\.cfv52-summary-grid > \.cfv-adjustment-card \.cfv-adjustment-delta\s*\{[\s\S]*?font-size:\s*8\.5px/s);
  assert.match(r1,/\.cfv52-summary-grid > \.cfv-adjustment-card \.cfv-adjustment-delta\s*\{[\s\S]*?font-size:\s*10\.5px/s);
});

test('R1 stylesheet loads after V6 so its final visual refinements win',()=>{
  const v6Pos=index.indexOf('/maintenance/cofiring-adjustment-comparison-compact-v6.css');
  const r1Pos=index.indexOf('/maintenance/cofiring-adjustment-comparison-compact-v6-r1.css?v=20260928-adjusted-comparison-compact-v6-r1');
  assert.ok(v6Pos>=0&&r1Pos>v6Pos);
});
