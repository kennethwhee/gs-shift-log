import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2]||process.cwd());
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');
const v4=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-v4.css'),'utf8');
const r1=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-compact-v6-r1.css'),'utf8');
const r2=fs.readFileSync(path.join(root,'maintenance/cofiring-adjustment-comparison-compact-v6-r2.css'),'utf8');

test('V6 R2 remains CSS-only on top of the published comparison implementation',()=>{
  assert.match(ui,/COFIRING_ADJUSTED_COMPARISON_CARDS_V4/);
  assert.match(v4,/\.cfv52-summary-grid > \.cfv-adjustment-card/);
  assert.match(r1,/COFIRING ADJUSTED COMPARISON CARDS V6 R1/);
  assert.match(r2,/COFIRING ADJUSTED COMPARISON CARDS V6 R2/);
});

test('ratio secondary metrics use horizontal label-value layout on desktop',()=>{
  assert.match(r2,/@media screen and \(min-width: 901px\)/);
  assert.match(r2,/\.cfv52-summary-grid > \.cfv-adjustment-original-card \.cfv52-metric:not\(\.cfv52-metric-emphasis\)[\s\S]*?display:\s*flex\s*!important/s);
  assert.match(r2,/\.cfv52-metric:not\(\.cfv52-metric-emphasis\) > strong[\s\S]*?font-size:\s*15\.5px\s*!important/s);
});

test('fuel usage boxes use one horizontal line and larger values',()=>{
  assert.match(r2,/\.cfv52-summary-grid > \.cfv-adjustment-original-card \.cfv10-fuel,[\s\S]*?display:\s*flex\s*!important/s);
  assert.match(r2,/\.cfv10-fuel-value[\s\S]*?font-size:\s*15\.5px\s*!important/s);
  assert.match(r2,/\.cfv-adjustment-card \.cfv-adjustment-delta[\s\S]*?font-size:\s*11px\s*!important/s);
});

test('original closing area remains present and adjusted deadline removal stays owned by V4',()=>{
  assert.match(r2,/\.cfv-adjustment-original-card \[data-cfv6-target\]/);
  assert.match(v4,/\.cfv-adjustment-card \[data-cfv6-target\][\s\S]*?display:\s*none\s*!important/s);
  assert.doesNotMatch(r2,/\.cfv-adjustment-original-card[^}]*display:\s*none/s);
});

test('R2 stylesheet loads after R1 so the approved final row layout wins',()=>{
  const r1Pos=index.indexOf('/maintenance/cofiring-adjustment-comparison-compact-v6-r1.css');
  const r2Pos=index.indexOf('/maintenance/cofiring-adjustment-comparison-compact-v6-r2.css?v=20260928-adjusted-comparison-compact-v6-r2');
  assert.ok(r1Pos>=0&&r2Pos>r1Pos);
});
