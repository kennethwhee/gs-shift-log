const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const overlay=fs.readFileSync(
  path.join(__dirname,'..','maintenance','cofiring-adjustment-compact-fit-v1.js'),
  'utf8'
);

const index=fs.readFileSync(
  path.join(__dirname,'..','index.html'),
  'utf8'
);

test('compact overlay defines the cofiring modal compact contract',()=>{
  assert.match(overlay,/COFIRING_ADJUSTMENT_COMPACT_FIT_V1/);
  assert.match(overlay,/data-cofiring-adjustment-compact-root/);
  assert.match(overlay,/혼소 조정/);
  assert.match(overlay,/CO-FIRING ADJUSTMENT/);
  assert.match(overlay,/max-height:calc\(100vh - 24px\)/);
  assert.match(overlay,/grid-template-columns:minmax\(0,1\.25fr\) minmax\(0,1fr\)/);
});

test('index loads the compact overlay script',()=>{
  assert.match(
    index,
    /\/maintenance\/cofiring-adjustment-compact-fit-v1\.js\?v=20261002-r10/
  );
});
