import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('script.js','utf8');

test('Fly Ash dispatch quantity uses K47 and keeps K48 only as legacy fallback',()=>{
  const fixed=/const\s+flyAshKg\s*=\s*getCellNumber\(\s*worksheet\s*,\s*["']K47["']\s*\)\s*\?\?\s*getCellNumber\(\s*worksheet\s*,\s*["']K48["']\s*\)\s*;/g;
  assert.equal((source.match(fixed)||[]).length,1);
});

test('old K48-only Fly Ash quantity declaration no longer exists',()=>{
  const old=/const\s+flyAshKg\s*=\s*getCellNumber\(\s*worksheet\s*,\s*["']K48["']\s*\)\s*;/g;
  assert.equal((source.match(old)||[]).length,0);
});

test('Fly Ash kg remains converted to ton by dividing by 1000',()=>{
  const block=/flyAshDispatch\s*:\s*\{[\s\S]{0,900}?quantityKg\s*:\s*flyAshKg[\s\S]{0,500}?quantityTon\s*:[\s\S]{0,500}?flyAshKg\s*\/\s*1000/;
  assert.match(source,block);
  assert.equal(391410/1000,391.41);
});

test('final workbook still maps Fly Ash vehicles to X21 and quantityTon to X22',()=>{
  const fnStart=source.indexOf('function applyMorningMeetingCoalNumericValues');
  assert.ok(fnStart>=0,'applyMorningMeetingCoalNumericValues missing');
  const section=source.slice(fnStart,fnStart+10000);

  assert.match(
    section,
    /address\s*:\s*["']X21["'][\s\S]{0,500}?values\.flyAshDispatch[\s\S]{0,180}?\?\.vehicles/
  );
  assert.match(
    section,
    /address\s*:\s*["']X22["'][\s\S]{0,500}?values\.flyAshDispatch[\s\S]{0,180}?\?\.quantityTon/
  );
});
