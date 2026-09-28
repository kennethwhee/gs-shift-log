import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const js = fs.readFileSync(path.join(root, 'maintenance/to-night-power.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'maintenance/to-night-power.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function ordered(haystack, needles){
  let cursor=-1;
  for(const needle of needles){
    const next=haystack.indexOf(needle, cursor+1);
    assert.ok(next>cursor, 'missing/out-of-order: '+needle);
    cursor=next;
  }
}

test('TO power entry follows the Excel top-to-bottom source order', () => {
  const marker = js.indexOf('TO_NIGHT_POWER_EXCEL_ORDER_V1_R3');
  assert.ok(marker >= 0);
  const block = js.slice(marker, marker + 900);
  ordered(block, [
    "key === 'solarDailyGeneration'",
    "key === 'generatorEcmsGen1'",
    "key === 'ismartReception'",
    "key === 'epowerTransmission'"
  ]);
  assert.match(js, /\$\{FORM_FIELDS\.map\(\(\[key\s*,\s*label\]\)\s*=>/);
  assert.match(js, /for \(const \[key, label\] of FORM_FIELDS\)/);
  assert.match(js, /FORM_FIELDS\[0\]\[0\]/);
});

test('canonical payload FIELDS remains defined separately from presentation order', () => {
  assert.match(js, /const\s+FIELDS\s*=\s*Object\.freeze/);
  assert.match(js, /const\s+FORM_FIELDS\s*=\s*Object\.freeze/);
  assert.doesNotMatch(js, /module\.exports\s*=\s*\{[^}]*FORM_FIELDS/);
});

test('TO power fields are one vertical sequence on desktop and stack safely on narrow screens', () => {
  assert.match(css, /TO_NIGHT_POWER_EXCEL_ORDER_V1_R3/);
  assert.match(css, /\.to-night-power-fields\s*\{[\s\S]*grid-template-columns:\s*1fr\s*!important/);
  assert.match(css, /\.to-night-power-fields > label\s*\{[\s\S]*grid-template-columns:\s*minmax\(118px,\s*138px\)\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width:\s*460px\)/);
});

test('TO power JS and CSS cache URLs are refreshed', () => {
  assert.match(index, /\/maintenance\/to-night-power\.js\?[^"']*excelOrder=20260928-excel-order-v1-r3/);
  assert.match(index, /\/maintenance\/to-night-power\.css\?[^"']*excelOrder=20260928-excel-order-v1-r3/);
});
