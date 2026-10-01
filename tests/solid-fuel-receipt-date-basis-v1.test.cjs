const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'functions',
    'api',
    'solid-fuel-trouble.js'
  ),
  'utf8'
);

test('receipt accounting uses unloading_date completion date and half-open bounds',()=>{
  assert.equal(
    source.includes("date(unloading_date,'+1 day')"),
    false
  );

  assert.equal(
    source.includes("ELSE unloading_date||'T'||departure_time"),
    true
  );

  assert.equal(
    source.includes("WHERE completed_local>=? AND completed_local<?"),
    true
  );

  assert.equal(
    source.includes('const paddedDaily='),
    true
  );

  assert.equal(
    source.includes('effectiveEndLocal'),
    true
  );
});
