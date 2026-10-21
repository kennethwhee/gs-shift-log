'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const repo=path.resolve(process.env.GS_COFIRING_TEST_ROOT||path.join(__dirname,'..'));
const assets=fs.existsSync(path.join(repo,'maintenance/cofiring-core.js'))?path.join(repo,'maintenance'):path.join(repo,'payload');
const contract=require(path.join(assets,'cofiring-live-contract.js'));
const core=require(path.join(assets,'cofiring-core.js'));
const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/cofiring-bio-zero-v1.json'),'utf8'));
const clone=value=>structuredClone(value);
const spec=Object.fromEntries(['startLocal','endLocal','stepUnit','stepValue'].map(key=>[key,raw[key]]));
const target=report=>report.summaries.find(item=>item.key==='unit2Bio');
const basis='constant_bio_counter_full_good_both_nodata_fallback';
function recoveredReport(){
  const report=clone(raw),item=target(report);
  report.status='PERIOD_READY';
  Object.assign(item,{usageTon:0,usageBasis:basis,startBoundaryFallbackApplied:true,
    startBoundaryFallbackValue:item.min,endBoundaryFallbackApplied:true,
    endBoundaryFallbackValue:item.max,boundaryValid:true,dataComplete:true});
  return report;
}
function calculate(reference){
  const periodManual={start:spec.startLocal+':00+09:00',end:spec.endLocal+':00+09:00',unit1:0,unit2:0};
  return core.analyzePeriodSummary(reference,{...spec,organic:periodManual,manure:periodManual});
}

test('the supplied failed report keeps both original missing boundaries and is rejected',()=>{
  assert.equal(raw.status,'FAIL');
  assert.equal(target(raw).startValue,null);
  assert.equal(target(raw).endValue,null);
  assert.equal(target(raw).durationGoodSeconds,17*3600);
  assert.equal(target(raw).durationBadSeconds,0);
  assert.equal(target(raw).min,51213.6640625);
  assert.equal(target(raw).min,target(raw).max);
  assert.throws(()=>contract.validatePeriodReport(clone(raw),spec));
  const falselyReady=clone(raw);falselyReady.status='PERIOD_READY';
  assert.throws(()=>contract.validatePeriodReport(falselyReady,spec));
});
test('verified constant Bio returns zero without rewriting raw null or Bad quality',()=>{
  const input=recoveredReport(),before=clone(input);
  const valid=contract.validatePeriodReport(input,spec),item=target(valid);
  assert.deepEqual(input,before,'validation is pure');
  assert.equal(item.startValue,null);assert.equal(item.endValue,null);
  assert.equal(item.startQuality,'No Data, Bad');assert.equal(item.endQuality,'No Data, Bad');
  assert.equal(item.startBoundaryRecovered,true);assert.equal(item.endBoundaryRecovered,true);
  assert.equal(item.effectiveStartValue,51213.6640625);
  assert.equal(item.effectiveEndValue,item.effectiveStartValue);
  assert.equal(item.usageTon,0);assert.equal(item.dataComplete,true);
  assert.deepEqual(valid.summaries.slice(0,9).map(x=>x.usageTon),raw.summaries.slice(0,9).map(x=>x.usageTon));
  const result=calculate(valid.reference);
  assert.equal(result.units.unit1.coal.quantity,391.60546875);
  assert.equal(result.units.unit1.bio.quantity,324.8515625);
  assert.equal(result.units.unit2.coal.quantity,555.01953125);
  assert.equal(result.units.unit2.bio.quantity,0);
  assert.equal(result.units.unit2.bio.complete,true);
  assert.equal(result.qualityVerified,true);
  assert.equal(result.units.unit2.ratios.bio,0);
  assert.ok(result.combined.ratios.bio>0);
  assert.equal(result.warnings.length,1);
  assert.match(result.warnings[0],/양쪽 경계.*0t/);
});
const invalid={
  'nonzero counter spread':s=>{s.max+=1;s.rangeSpread=1;s.delta=1;},
  'tiny nonzero spread below existing tolerance':s=>s.max+=0.0000001,
  'nonzero delta':s=>s.delta=1,
  'tiny nonzero delta':s=>s.delta=Number.EPSILON,
  'nonzero reported usage':s=>s.usageTon=0.0000001,
  'contradictory range spread':s=>s.rangeSpread=0.0000001,
  'missing range spread':s=>delete s.rangeSpread,
  'negative constant':s=>{s.min=s.max=s.startBoundaryFallbackValue=s.endBoundaryFallbackValue=-1;},
  'missing minimum':s=>s.min=null,
  'NaN maximum':s=>s.max=NaN,
  'infinite fallback':s=>s.startBoundaryFallbackValue=Infinity,
  'numeric string statistic':s=>s.min=String(s.min),
  'numeric string fallback':s=>s.endBoundaryFallbackValue=String(s.max),
  'different fallback constant':s=>s.startBoundaryFallbackValue+=0.0000001,
  'missing start flag':s=>delete s.startBoundaryFallbackApplied,
  'false end flag':s=>s.endBoundaryFallbackApplied=false,
  'coerced flag':s=>s.startBoundaryFallbackApplied='true',
  'wrong basis':s=>s.usageBasis='end_minus_start_boundary',
  'raw zero is not missing':s=>s.startValue=0,
  'raw string is not missing':s=>s.endValue='',
  'raw numeric string is not missing':s=>s.startValue='51213.6640625',
  'missing raw property is not null':s=>delete s.startValue,
  'NaN raw value is not null':s=>s.endValue=NaN,
  'Good quality does not describe No Data':s=>s.startQuality='Raw, Good',
  'No Data Good is not No Data Bad':s=>s.endQuality='No Data, Good',
  'additional quality error':s=>s.startQuality='No Data, Bad, Connection Error',
  'nonzero bad duration':s=>s.durationBadSeconds=1,
  'tiny nonzero bad duration':s=>s.durationBadSeconds=Number.EPSILON,
  'incomplete duration':s=>s.durationGoodSeconds-=3,
  'expanded query minute is not accounting duration':s=>s.durationGoodSeconds+=60,
  'negative good duration':s=>s.durationGoodSeconds=-1,
  'missing good duration':s=>s.durationGoodSeconds=null,
  'unverified worker boundary':s=>s.boundaryValid=false,
  'unverified worker duration':s=>s.durationCoverageValid=false,
  'late start timestamp':s=>s.startTime='2026-10-21T00:01:00+09:00',
  'early end timestamp':s=>s.endTime='2026-10-21T16:59:59+09:00',
  'missing timestamp':s=>s.endTime=null
};
for(const [label,mutate] of Object.entries(invalid))test('contract refuses '+label,()=>{
  const input=recoveredReport();mutate(target(input));
  assert.throws(()=>contract.validatePeriodReport(input,spec));
});
test('zero recovery is restricted to Bio, not Coal',()=>{
  const input=recoveredReport(),item=clone(target(input)),coal=contract.definitions[0];
  Object.assign(item,{key:coal.id,unit:coal.unit,fuel:coal.fuel,tag:coal.queryTag});
  input.summaries[0]=item;
  assert.throws(()=>contract.validatePeriodReport(input,spec));
});
test('two-second duration rounding allowance remains; padded end minute is excluded',()=>{
  for(const adjustment of [-2,2]){
    const input=recoveredReport();target(input).durationGoodSeconds+=adjustment;
    assert.doesNotThrow(()=>contract.validatePeriodReport(input,spec));
  }
});
test('normal zero and existing one-boundary Bio recovery retain their behavior',()=>{
  const direct=recoveredReport(),counter=target(direct);
  Object.assign(counter,{startValue:counter.min,endValue:counter.max,startQuality:'Raw, Good',endQuality:'Raw, Good',
    usageBasis:'end_minus_start_boundary',startBoundaryFallbackApplied:false,endBoundaryFallbackApplied:false,
    startBoundaryFallbackValue:null,endBoundaryFallbackValue:null});
  assert.equal(calculate(contract.validatePeriodReport(direct,spec).reference).units.unit2.bio.quantity,0);
  for(const side of ['start','end']){
    const input=recoveredReport(),item=target(input);
    Object.assign(item,{min:100,max:110,delta:10,rangeSpread:10,usageTon:10});
    if(side==='start')Object.assign(item,{startValue:null,startQuality:'No Data, Bad',endValue:110,endQuality:'Raw, Good',
      usageBasis:'end_minus_period_min_start_nodata_fallback',startBoundaryFallbackValue:100,
      endBoundaryFallbackApplied:false,endBoundaryFallbackValue:null});
    else Object.assign(item,{startValue:100,startQuality:'Raw, Good',endValue:null,endQuality:'No Data, Bad',
      usageBasis:'period_max_end_nodata_fallback_minus_start_boundary',endBoundaryFallbackValue:110,
      startBoundaryFallbackApplied:false,startBoundaryFallbackValue:null});
    const valid=contract.validatePeriodReport(input,spec),result=calculate(valid.reference);
    assert.equal(result.units.unit2.bio.quantity,10);
    assert.equal(target(valid).startBoundaryRecovered,side==='start');
    assert.equal(target(valid).endBoundaryRecovered,side==='end');
  }
});
const invalidCanonical={
  'one recovered flag missing':s=>delete s.startBoundaryRecovered,
  'false recovered flag':s=>s.endBoundaryRecovered=false,
  'coerced recovered flag':s=>s.startBoundaryRecovered='true',
  'wrong effective start':s=>s.effectiveStartValue+=0.0000001,
  'wrong effective end':s=>s.effectiveEndValue-=0.0000001,
  'raw start changed to zero':s=>s.startValue=0,
  'nonzero bad time below old tolerance':s=>s.durationBadSeconds=Number.EPSILON,
  'nonzero delta below old tolerance':s=>s.delta=Number.EPSILON,
  'wrong range spread':s=>s.rangeSpread=Number.EPSILON,
  'wrong fallback basis':s=>s.usageBasis='end_minus_start_boundary',
  'unsupported quality':s=>s.endQuality='No Data, Good'
};
for(const [label,mutate] of Object.entries(invalidCanonical))test('core refuses canonical recovery with '+label,()=>{
  const valid=contract.validatePeriodReport(recoveredReport(),spec);
  mutate(valid.reference.summaries.find(s=>s.key==='unit2Bio'));
  const result=calculate(valid.reference);
  assert.equal(result.units.unit2.bio.quantity,null);
  assert.equal(result.units.unit2.bio.complete,false);
});
test('core does not grant recovery to raw unvalidated worker metadata',()=>{
  const valid=contract.validatePeriodReport(recoveredReport(),spec);
  valid.reference.summaries=recoveredReport().summaries;
  assert.equal(calculate(valid.reference).units.unit2.bio.quantity,null);
});
const apiPath=path.join(repo,'functions/api/ois-data-requests.js');
test('the deployed API validator is byte-identical and accepts the same actual regression',
  {skip:!fs.existsSync(apiPath)&&'package-only run; API integration runs in repository'},()=>{
    const shared=fs.readFileSync(path.join(assets,'cofiring-live-contract.js'),'utf8').replace(/\r\n/g,'\n').split('\n(function(root)')[0];
    const api=fs.readFileSync(apiPath,'utf8').replace(/\r\n/g,'\n');
    assert.ok(api.includes(shared),'API must contain the exact shared validator');
    const server=vm.runInNewContext(shared+'\ncreateCofiringLiveContract();',{TextEncoder});
    const result=server.validatePeriodReport(recoveredReport(),spec);
    assert.equal(target(result).usageTon,0);assert.equal(target(result).startBoundaryRecovered,true);
    const invalidInput=recoveredReport();target(invalidInput).delta=1;
    assert.throws(()=>server.validatePeriodReport(invalidInput,spec));
});
