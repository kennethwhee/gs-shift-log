// Regression coverage for the 2026-10-19 2호기 Bio warning misclassification.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const warning=require('../maintenance/cofiring-communication-warning-v2.js');
const begin='2026-10-19T00:00',end='2026-10-20T00:00';
const cleanItem=()=>({unit:'unit2',fuel:'bio',startQuality:'Raw, Good',endQuality:'Raw, Good',
  startValue:43000,endValue:43250.27,effectiveStartValue:43000,effectiveEndValue:43250.27,usageTon:250.27,
  usageBasis:'end_minus_start_boundary',startBoundaryRecovered:false,endBoundaryRecovered:false,
  startBoundaryFallbackApplied:false,endBoundaryFallbackApplied:false,boundaryValid:true,
  durationCoverageValid:true,durationBadSeconds:0,dataComplete:true});
const ref=summary=>({startLocal:begin,endLocal:end,summaries:[summary]});
const originalJSON=()=>JSON.stringify(ref(cleanItem()));
function recoveredStart(){const item=cleanItem();
  item.startValue=null;item.startQuality='No Data, Bad';item.startBoundaryFallbackApplied=true;
  item.startBoundaryRecovered=true;item.usageBasis='end_minus_period_min_start_nodata_fallback';
  item.startBoundaryFallbackValue=43000;item.min=43000;item.max=43250.27;
  return item;
}
function recoveredEnd(){const item=cleanItem();
  item.endValue=null;item.endQuality='No Data, Bad';item.endBoundaryFallbackApplied=true;
  item.endBoundaryRecovered=true;item.usageBasis='period_max_end_nodata_fallback_minus_start_boundary';
  item.endBoundaryFallbackValue=43250.27;item.min=43000;item.max=43250.27;
  return item;
}
function host(){return {hidden:true,textContent:'',dataset:{}};}

test('healthy source is quiet and never emits a generic communication warning',()=>{
  const a=host();assert.deepEqual(warning.render(a,ref(cleanItem()),{missing:[]}),[]);
  assert.equal(a.hidden,true);assert.equal(a.textContent,'');
});
test('October 19 2호기 Bio valid recovery is INFO, not a false transmission alarm',()=>{
  const item=recoveredStart(),reference=ref(item),frozen=JSON.stringify(reference),a=host();
  assert.equal(warning.verifiedRecovery(item,'start'),true);
  const items=warning.notices(reference,{missing:[]});assert.equal(items.length,1);
  assert.equal(items[0].level,'info');assert.match(items[0].text,/2호기 Bio.*10월 19일 00:00.*기간 최솟값.*계산을 완료/);
  assert.doesNotMatch(items[0].text,/통신 오류|계측 품질 확인이 필요|재확인 필요/);
  warning.render(a,reference,{missing:[]});assert.equal(a.hidden,false);assert.equal(a.dataset.tone,'info');
  assert.match(a.textContent,/^ℹ/);assert.equal(JSON.stringify(reference),frozen,'source never mutated');
});
test('verified end fallback also becomes informational, and not an unverified assumption',()=>{
  const item=recoveredEnd(),a=host();warning.render(a,ref(item),{});
  assert.equal(a.dataset.tone,'info');assert.match(a.textContent,/10월 20일 00:00.*기간 최댓값/);
});
test('both missing Bio boundaries with fully-verified constant 0t are informational once',()=>{
  const item=cleanItem();Object.assign(item,{startQuality:'No Data, Bad',endQuality:'No Data, Bad',
    startValue:null,endValue:null,startBoundaryFallbackApplied:true,endBoundaryFallbackApplied:true,
    startBoundaryRecovered:true,endBoundaryRecovered:true,
    usageBasis:'constant_bio_counter_full_good_both_nodata_fallback',
    min:43250,max:43250,delta:0,usageTon:0,
    startBoundaryFallbackValue:43250,endBoundaryFallbackValue:43250,
    effectiveStartValue:43250,effectiveEndValue:43250});
  const lines=warning.notices(ref(item),{});assert.equal(lines.length,1);
  assert.equal(lines[0].level,'info');assert.match(lines[0].text,/Bio 0t/);
});
test('unverified restored source, false quality and mismatched usage never masquerade as success',()=>{
  const mutate=[
    x=>x.boundaryValid=false,
    x=>x.dataComplete=false,
    x=>x.durationBadSeconds=60,
    x=>x.usageTon=120,
    x=>x.startBoundaryFallbackValue=42900,
    x=>x.usageBasis='unknown',
    x=>x.startBoundaryFallbackApplied=false,
    x=>x.startQuality='Raw, Bad',
    x=>x.min=42900,
  ];
  for(const change of mutate){const item=recoveredStart();change(item);
    assert.equal(warning.verifiedRecovery(item,'start'),false);
    assert.ok(warning.notices(ref(item),{}).some(x=>x.level==='warning'));
  }
});
test('true middle-period data gap remains warning, never misleadingly labelled as midnight transmission',()=>{
  const item=cleanItem();item.durationBadSeconds=72.5;item.dataComplete=false;
  const a=host();warning.render(a,ref(item),{});
  assert.equal(a.dataset.tone,'warning');assert.match(a.textContent,/조회 기간 중 계측 품질 공백 72\.5초/);
  assert.doesNotMatch(a.textContent,/00:00 기준 통신 오류/);
});
test('organic Storage B provisional error stays warning, mixed info does not suppress it',()=>{
  const a=host(),data={missing:[{silo:'organicStorageSiloB',boundaryLocal:end}],
    autoEstimates:[{silo:'organicStorageSiloB',boundaryLocal:end}],ok:true};
  warning.render(a,ref(recoveredStart()),data);
  assert.equal(a.dataset.tone,'warning');assert.match(a.textContent,/1·2호기 유기성 고형연료\(Storage B\).*재확인/);
  assert.match(a.textContent,/2호기 Bio/);
});
test('UI integration remains read-only, preserves summary cards and busts only warning module cache',()=>{
  const dir=path.join(__dirname,'..');const uiFile=path.join(dir,'maintenance/cofiring-period-ui-v5.js');
  const index=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  const css=fs.readFileSync(path.join(dir,'maintenance/cofiring-communication-warning-v2.css'),'utf8');
  if(fs.existsSync(uiFile)){const ui=fs.readFileSync(uiFile,'utf8');
    assert.match(ui,/communicationWarning\?\.render/);
    assert.match(ui,/data-cfv-communication-warning/);}
  assert.match(index,/cofiring-communication-warning-v2\.js\?v=20261026-quality-v3(?:&amp;compact=20261026-v5(?:&amp;shared=20261026-v6)?)?/);
  assert.match(index,/cofiring-communication-warning-v2\.css\?v=20261026-(?:quality-v3|oct23-v4)/);
  assert.match(css,/data-tone="info"/);
  assert.doesNotMatch(index,/cofiring-communication-warning-v2\.(?:js|css)\?v=20261026-auto-v2/);
});
