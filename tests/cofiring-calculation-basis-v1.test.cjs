'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const contract=require('../maintenance/cofiring-live-contract.js');
const core=require('../maintenance/cofiring-core.js');
const basis=require('../maintenance/cofiring-calculation-basis-v1.js');
const adjustment=require('../maintenance/cofiring-period-adjustment-v56.js');
const warning=require('../maintenance/cofiring-communication-warning-v2.js');
const spec={startLocal:'2026-11-12T00:00',endLocal:'2026-11-13T00:00',stepUnit:'minute',stepValue:1};

function fixture(gaps=34.5){
  const p=contract.period(spec,Number.MAX_SAFE_INTEGER),seconds=p.durationMinutes*60;
  const summaries=contract.definitions.map((def,i)=>{
    const start=1000+i*100,usage=def.fuel==='coal'?100+i:50+i,end=start+usage;
    const gap=typeof gaps==='function'?gaps(def,i):gaps;
    return {key:def.id,unit:def.unit,fuel:def.fuel,tag:def.queryTag,startValue:start,endValue:end,
      min:start,max:end,delta:usage,rangeSpread:usage,usageTon:usage,usageBasis:'end_minus_start_boundary',
      startQuality:'Raw, Good',endQuality:'Good, Raw',startTime:spec.startLocal+':00+09:00',endTime:spec.endLocal+':00+09:00',
      startBoundaryFallbackApplied:false,endBoundaryFallbackApplied:false,
      durationGoodSeconds:seconds-gap,durationBadSeconds:gap,boundaryValid:true,durationCoverageValid:true};
  });
  const raw={kind:'cofiring_dataparc_period_report',schemaVersion:1,status:summaries.some(s=>s.durationBadSeconds>.001)?'PERIOD_DATA_GAPS':'PERIOD_READY',
    runId:'0123456789abcdef0123456789abcdef',startLocal:spec.startLocal,endLocal:spec.endLocal,stepUnit:'minute',stepValue:1,
    queryEndLocal:p.queryEndLocal,executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,
    timedOut:false,workerExitCode:0,cleanupErrors:[],completedAtUtc:'2026-11-13T01:00:00Z',summaries};
  const report=contract.validatePeriodReport(raw,spec),reference=report.reference;
  const period=core.periodRange(spec.startLocal,spec.endLocal,'minute',1);
  const result=core.analyzePeriodSummary(reference,{organic:{start:period.start,end:period.end,unit1:12,unit2:12},manure:{start:period.start,end:period.end,unit1:0,unit2:0}});
  result.organicUsage={ok:true,basis:'operator-manual-v1',allocation:{unit1:12,unit2:12,total:24,ok:true}};
  return {result,reference,report};
}
const counter=result=>result.units.unit1.coal.counters[0];
function noPromotion(change){const {result}=fixture();change(result);assert.equal(basis.describe(result),null);}

test('validated boundary arithmetic yields a completed basis while preserving all numeric and quality data',()=>{
  const {result,reference,report}=fixture(),before=JSON.stringify({result,reference,report});
  const meta=basis.describe(result);
  assert.equal(meta.kind,'counter-boundary-quality-gap');
  assert.equal(meta.calculationLabel,'계산 완료 · 누적계 기준');
  assert.equal(meta.displayLabel,'계산 완료 · 누적계 기준 · 품질 공백 포함');
  assert.equal(meta.qualityLabel,'원본 품질 공백 최대 34.5초');
  assert.equal(meta.maxGapSeconds,34.5);
  assert.equal(meta.estimated,false);
  assert.equal(meta.affected.length,4);
  assert.equal(report.status,'PERIOD_DATA_GAPS');
  assert.equal(result.qualityVerified,false);
  assert.equal(counter(result).complete,true);
  assert.equal(counter(result).qualityVerified,false);
  assert.equal(JSON.stringify({result,reference,report}),before);
  assert.ok(warning.notices(reference,{}).some(item=>item.level==='warning'&&item.text.includes('34.5초')));
});
test('counter gaps are grouped by fuel using the maximum, never summed or asserted simultaneous',()=>{
  const {result}=fixture((def,i)=>i===0?7:i===1?34.5:def.fuel==='bio'?12:0);
  const meta=basis.describe(result);
  assert.equal(meta.maxGapSeconds,34.5);
  assert.equal(meta.affected.find(item=>item.unit==='unit1'&&item.fuel==='coal').maxGapSeconds,34.5);
  assert.deepEqual(meta.affected.find(item=>item.unit==='unit1'&&item.fuel==='coal').tags,['unit1CoalA1','unit1CoalA2']);
  assert.doesNotMatch(meta.note,/동시|공통|138/);
});
test('validated State/Exact source observations retain a direct counter basis and original source times',()=>{
  const {report}=fixture(),period=core.periodRange(spec.startLocal,spec.endLocal,'minute',1);
  const raw=JSON.parse(JSON.stringify(report));
  for(const item of raw.summaries){
    item.usageBasis='end_minus_start_totalizer_asof';item.totalizerStateVerified=true;item.constantNoInteriorSamples=false;
    item.startTime=new Date(period.startMs-1000).toISOString();
    item.startBoundaryRead={schemaVersion:1,sourceFunction:'fnAtTimeArray',method:'State',asOfTime:period.start,sourceTime:item.startTime,value:item.startValue,quality:item.startQuality};
    item.endBoundaryRead={schemaVersion:1,sourceFunction:'fnAtTimeArray',method:'Exact',asOfTime:period.end,sourceTime:item.endTime,value:item.endValue,quality:item.endQuality};
  }
  const validated=contract.validatePeriodReport(raw,spec);
  const result=core.analyzePeriodSummary(validated.reference,{organic:{start:period.start,end:period.end,unit1:12,unit2:12},manure:{start:period.start,end:period.end,unit1:0,unit2:0}});
  result.organicUsage={ok:true};
  const before=JSON.stringify(result);
  assert.equal(basis.describe(result).maxGapSeconds,34.5);
  assert.equal(JSON.stringify(result),before);
  counter(result).summary.startBoundaryRead.asOfTime=period.end;
  assert.equal(basis.describe(result),null,'an unverified as-of boundary cannot receive completion metadata');
});
test('missing or invalid original boundary cannot be relabelled complete',()=>{
  for(const change of [r=>{counter(r).summary.startValue=null;},r=>{counter(r).summary.boundaryValid=false;},r=>{counter(r).complete=false;},r=>{counter(r).issues.push('counter_reset');}])noPromotion(change);
});
test('missing organic usage and incomplete fuel inputs keep the existing pending presentation',()=>{
  noPromotion(r=>{delete r.organicUsage;});
  noPromotion(r=>{r.organicUsage.ok=false;});
  noPromotion(r=>{r.units.unit1.organic.quantity=null;r.units.unit1.organic.complete=false;});
  noPromotion(r=>{r.units.unit2.manure.complete=false;});
});
test('provisional, estimated, hypothesis and error cases are never promoted',()=>{
  for(const change of [
    r=>{r.organicUsage.provisional=true;},r=>{r.organicUsage.provisionalZero=true;},
    r=>{r.organicUsage.scenario={kind:'what-if'};},r=>{r.organicUsage.sharedScenarioPending=true;},
    r=>{r.organicUsage.autoEstimates=[{silo:'organicStorageSiloB'}];},
    r=>{r.organicUsage.corrections=[{method:'estimated'}];},r=>{r.hypothesisDisplay={kind:'pending'};},
    r=>{r.error='source unavailable';},r=>{r.organicUsage.error='inventory unavailable';}
  ])noPromotion(change);
});
test('unknown source quality or missing quality evidence is not replaced with healthy flags',()=>{
  for(const change of [
    r=>{counter(r).summary.startQuality='Raw, Bad';},r=>{delete counter(r).qualityGapSeconds;},
    r=>{counter(r).qualityVerified=true;},r=>{counter(r).summary.dataComplete=true;},
    r=>{counter(r).summary.durationBadSeconds=0;},r=>{counter(r).summary.durationGoodSeconds=0;}
  ])noPromotion(change);
});
test('unrecognized warnings retain a review state',()=>{
  noPromotion(r=>{r.warnings.push('발열량 확인 필요');});
  noPromotion(r=>{r.warnings=['unknown'];});
});
test('all ten exact counter identities are required',()=>{
  noPromotion(r=>{r.units.unit1.coal.counters.pop();});
  noPromotion(r=>{r.units.unit2.bio.counters[0].summary.tag='OTHER';});
  noPromotion(r=>{r.units.unit1.coal.counters[1]=r.units.unit1.coal.counters[0];});
  noPromotion(r=>{counter(r).summary.fuel='bio';});
});
test('boundary fallbacks cannot be described as direct counter arithmetic',()=>{
  noPromotion(r=>{counter(r).summary.startBoundaryFallbackApplied=true;});
  noPromotion(r=>{r.units.unit1.bio.counters[0].startBoundaryRecovered=true;});
});
test('unverified source, incomplete period, numeric corruption and healthy data do not receive the gap label',()=>{
  noPromotion(r=>{r.sourceKind='unknown';});
  noPromotion(r=>{r.period.durationMinutes=0;});
  noPromotion(r=>{counter(r).summary.usageTon+=1;});
  noPromotion(r=>{counter(r).summary.min-=1;});
  noPromotion(r=>{r.units.unit1.ratios.total=null;});
  assert.equal(basis.describe(fixture(0).result),null);
});
test('browser UMD loads before core/contract with no network, storage, or document dependency',()=>{
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../maintenance/cofiring-calculation-basis-v1.js'),'utf8'),context);
  assert.equal(context.CofiringCalculationBasisV1.describe(null),null);
  assert.equal(context.CofiringCalculationBasisV1.describe(fixture().result).maxGapSeconds,34.5);
});

function uiHarness(){
  const host={innerHTML:'',querySelector:()=>null},note={textContent:''},time={textContent:''};
  const container={querySelector:selector=>selector==='[data-cfv52-summary-grid]'?host:selector==='[data-cfv52-summary-note]'?note:selector==='[data-cfv-results-time]'?time:null};
  const context=vm.createContext({CofiringCore:core,CofiringCalculationBasisV1:basis,CofiringPeriodAdjustmentV56:{},
    document:{readyState:'loading',addEventListener(){}},setTimeout:()=>1,clearTimeout(){}});
  const source=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');
  vm.runInContext(source.replace('root.CofiringPeriodV5={mount,','root.CofiringPeriodV5={__render:renderSummaryOriginal,__basis:calculationBasisFor,mount,'),context);
  return {container,host,note,ui:context.CofiringPeriodV5};
}
test('summary cards show the basis and preserve the existing detailed quality warning',()=>{
  const h=uiHarness(),{result}=fixture(),before=JSON.stringify(result);
  h.ui.__render(h.container,result,{});
  assert.equal(h.note.textContent,'계산 완료 · 누적계 기준 · 품질 공백 포함');
  assert.equal((h.host.innerHTML.match(/계산 완료 · 누적계 기준/g)||[]).length,2);
  assert.equal(JSON.stringify(result),before);
  result.organicUsage.provisional=true;
  h.ui.__render(h.container,result,{});
  assert.doesNotMatch(h.host.innerHTML,/계산 완료 · 누적계 기준/);
});
test('adjusted presentation reads the matching original basis without changing either set of numbers',()=>{
  const h=uiHarness(),{result:base}=fixture();
  const settings=Object.fromEntries(['unit1','unit2'].map(unit=>[unit,Object.fromEntries(['coal','bio','organic','manure'].map(fuel=>[fuel,{calorific:base.units[unit].calorifics[fuel]}]))]));
  const changed=adjustment.manualTransfer(base,settings,1,5);assert.equal(changed.ok,true);
  const adjusted=changed.result,before=JSON.stringify({base,adjusted});
  assert.equal(basis.describe(adjusted),null,'adjusted usage is never passed off as original counter arithmetic');
  h.container.__cfvAdjustedComparisonState={active:true,base,adjusted};
  assert.equal(h.ui.__basis(adjusted,h.container).maxGapSeconds,34.5);
  h.ui.__render(h.container,adjusted,{});
  assert.equal(h.note.textContent,'계산 완료 · 누적계 기준 · 품질 공백 포함');
  assert.match(h.host.innerHTML,new RegExp(adjusted.units.unit1.bio.quantity.toFixed(2)+' <small>t'));
  assert.equal(JSON.stringify({base,adjusted}),before);
  h.container.__cfvAdjustedComparisonState.base={...base,period:{...base.period,endLocal:'2026-11-14T00:00'}};
  assert.equal(h.ui.__basis(adjusted,h.container),null,'unrelated original result cannot label an adjusted display');
});

module.exports={fixture};
