import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2]||process.cwd());
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');
const v4=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-v4.css'),'utf8');
const v6=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-compact-v6.css'),'utf8');

test('V6 is a CSS-only refinement on top of the published V4 comparison logic',()=>{
  assert.match(ui,/COFIRING_ADJUSTED_COMPARISON_CARDS_V4/);
  assert.match(ui,/container\.__cfvAdjustedComparisonState = adjusted/);
  assert.match(v4,/\.cfv52-summary-grid > \.cfv-adjustment-card/);
  assert.match(v4,/\.cfv-adjustment-card \[data-cfv6-target\]/);
  assert.doesNotMatch(v6,/display:\s*none[^}]*cfv-adjustment-original-card/s);
});

test('active co-firing adjustment button changes only its background to pale blue',()=>{
  assert.match(v6,/\[data-cfv56-adjust\]\.is-active\s*\{/);
  assert.match(v6,/background:\s*#eaf4ff\s*!important/);
  const block=v6.match(/\[data-cfv56-adjust\]\.is-active\s*\{([\s\S]*?)\}/)?.[1]||'';
  assert.doesNotMatch(block,/\bcolor\s*:/);
  assert.doesNotMatch(block,/border(?:-color)?\s*:/);
});

test('desktop original and adjusted cards are compacted while original deadline selectors remain present',()=>{
  assert.match(v6,/@media screen and \(min-width: 901px\)/);
  assert.match(v6,/\.cfv52-summary-grid\s*\{[\s\S]*?gap:\s*10px 14px/s);
  assert.match(v6,/\.cfv52-summary-grid > \.cfv-adjustment-card\s*\{[\s\S]*?margin-top:\s*18px/s);
  assert.match(v6,/\.cfv52-summary-grid > \.cfv-adjustment-original-card \[data-cfv6-target\]/);
  assert.match(v6,/\.cfv52-summary-grid > \.cfv-adjustment-original-card \.cfv10-target-main/);
});

test('V6 stylesheet loads after V4 so compact overrides win without rewriting V4',()=>{
  const v4Pos=index.indexOf('/maintenance/cofiring-adjustment-comparison-v4.css');
  const v6Pos=index.indexOf('/maintenance/cofiring-adjustment-comparison-compact-v6.css?v=20260928-adjusted-comparison-compact-v6');
  assert.ok(v4Pos>=0&&v6Pos>v4Pos);
});
