const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ui=fs.readFileSync(
  'maintenance/cofiring-period-ui-v5.js',
  'utf8'
);

const core=require('../maintenance/cofiring-core.js');
const {inventoryReport}=require('./helpers/cofiring-period-dom.cjs');
function allocation(receipt){
  const spec={startLocal:'2026-09-20T00:00',endLocal:'2026-09-21T00:00'};
  const report=inventoryReport(spec);
  return core.organicInventoryUsage({...spec,organicInventory:report.organicInventory,organicInventoryReady:true},receipt,spec);
}
test('verified organic inventory is automatically split equally with four-decimal allocation',()=>{
  const actual=allocation(64.315);assert.equal(actual.ok,true);
  assert.equal(actual.allocation.unit1,27.1575);assert.equal(actual.allocation.unit2,27.1575);
  assert.equal(actual.allocation.mode,'equal-50-50');
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

test('missing receipt is rejected and a verified zero remains zero',()=>{
  assert.equal(allocation(null).ok,false);
  assert.equal(allocation(10).usage,0);
  assert.equal(allocation(10).allocation.unit1,0);
});
