'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./cofiring-calculation-basis-v1.test.cjs');
const core=require('../maintenance/cofiring-core.js');
const basis=require('../maintenance/cofiring-calculation-basis-v1.js');
const adjustment=require('../maintenance/cofiring-period-adjustment-v56.js');
function harness(){
  const host={innerHTML:'',querySelector:()=>null},note={textContent:''};
  const container={querySelector:s=>s==='[data-cfv52-summary-grid]'?host:s==='[data-cfv52-summary-note]'?note:null};
  const context=vm.createContext({CofiringCore:core,CofiringCalculationBasisV1:basis,
    CofiringPeriodAdjustmentV56:{},document:{readyState:'loading',addEventListener(){}},setTimeout:()=>1,clearTimeout(){}});
  const source=fs.readFileSync(require.resolve('../maintenance/cofiring-period-ui-v5.js'),'utf8');
  vm.runInContext(source.replace('root.CofiringPeriodV5={mount,','root.CofiringPeriodV5={__render:renderSummaryOriginal,mount,'),context);
  return {host,note,container,render:r=>context.CofiringPeriodV5.__render(container,r,{})};
}
test('verified gaps have separate basis and caution chips with exact quantities retained',()=>{
  const h=harness(),{result}=fixture(),before=JSON.stringify(result);h.render(result);
  assert.equal((h.host.innerHTML.match(/class="cfv-basis-chip">누적계 계산/g)||[]).length,2);
  assert.equal((h.host.innerHTML.match(/class="cfv-quality-chip">품질 공백/g)||[]).length,2);
  assert.equal((h.host.innerHTML.match(/class="cfv-quality-gap-label"/g)||[]).length,4);
  assert.match(h.host.innerHTML,/원본 누적계 기준 · 품질 공백 최대 34\.5초/);
  for(const unit of ['unit1','unit2'])for(const fuel of ['coal','bio'])
    assert.ok(h.host.innerHTML.includes(result.units[unit][fuel].quantity.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})+' <small>t'));
  assert.doesNotMatch(h.host.innerHTML,/≈|\(추정\)/);assert.equal(JSON.stringify(result),before);
});
test('only the affected unit and fuel get source-quality styling',()=>{
  const h=harness(),{result}=fixture(def=>def.unit==='unit1'&&def.fuel==='coal'?12:0);h.render(result);
  assert.equal((h.host.innerHTML.match(/cfv-quality-gap-card/g)||[]).length,1);
  assert.equal((h.host.innerHTML.match(/class="cfv-quality-gap-label"/g)||[]).length,1);
  assert.match(h.host.innerHTML,/cfv10-fuel-coal cfv-quality-gap-fuel/);
  assert.doesNotMatch(h.host.innerHTML,/cfv10-fuel-(?:bio|organic|manure) cfv-quality-gap-fuel/);
});
test('a subsequent healthy or unknown-boundary result clears the special presentation',()=>{
  const h=harness();h.render(fixture().result);h.render(fixture(0).result);
  assert.doesNotMatch(h.host.innerHTML,/cfv-quality-gap-(?:card|fuel|status)|cfv-quality-chip/);
  const invalid=fixture().result;invalid.units.unit1.coal.counters[0].summary.startValue=null;h.render(invalid);
  assert.doesNotMatch(h.host.innerHTML,/cfv-quality-gap-(?:card|fuel|status)|cfv-quality-chip/);
});
test('estimated inventory keeps its own approximate quantity and unconfirmed state',()=>{
  const h=harness(),result=fixture().result;result.hypothesisDisplay={kind:'estimated'};
  result.organicUsage.provisional=true;const before=JSON.stringify(result);h.render(result);
  assert.match(h.host.innerHTML,/추정 계산 · 미확정/);assert.match(h.host.innerHTML,/≈12\.00/);
  assert.match(h.host.innerHTML,/cfv18-hypothesis-organic/);
  assert.doesNotMatch(h.host.innerHTML,/cfv-quality-gap-card|cfv-quality-chip/);
  assert.equal(JSON.stringify(result),before);
});
test('matching adjusted view retains numeric adjustments and source-quality provenance',()=>{
  const h=harness(),{result:base}=fixture();
  const settings=Object.fromEntries(['unit1','unit2'].map(u=>[u,Object.fromEntries(['coal','bio','organic','manure'].map(f=>[f,{calorific:base.units[u].calorifics[f]}]))]));
  const changed=adjustment.manualTransfer(base,settings,1,5);assert.equal(changed.ok,true);
  const result=changed.result,before=JSON.stringify({base,result});
  h.container.__cfvAdjustedComparisonState={active:true,base,adjusted:result};h.render(result);
  assert.match(h.host.innerHTML,/cfv-quality-gap-card/);
  assert.ok(h.host.innerHTML.includes(result.units.unit1.bio.quantity.toFixed(2)+' <small>t'));
  assert.equal(JSON.stringify({base,result}),before);
});
