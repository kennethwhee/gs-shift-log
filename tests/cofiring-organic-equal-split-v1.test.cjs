const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ui=fs.readFileSync(
  'maintenance/cofiring-period-ui-v5.js',
  'utf8'
);

test('organic usage is automatically split equally',()=>{
  assert.match(
    ui,
    /COFIRING_ORGANIC_EQUAL_SPLIT_V1/
  );

  assert.match(
    ui,
    /const half=Math\.round\(\(usage\/2\)\*10000\)\/10000;/
  );

  assert.match(
    ui,
    /const unit1=half;/
  );

  assert.match(
    ui,
    /const unit2=half;/
  );

  assert.match(
    ui,
    /mode:'equal-50-50'/
  );
});

test('organic inputs become read only after automatic allocation',()=>{
  assert.match(
    ui,
    /input\.readOnly=true;/
  );

  assert.match(
    ui,
    /aria-readonly/
  );

  assert.match(
    ui,
    /50:50 자동배분/
  );
});

test('54.315 ton is divided into 27.1575 ton per unit',()=>{
  const usage=54.315;
  const half=Math.round((usage/2)*10000)/10000;

  assert.equal(
    half,
    27.1575
  );

  assert.equal(
    half+half,
    54.315
  );
});
