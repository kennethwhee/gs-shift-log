'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../maintenance/cofiring-core.js'),draft=require('../maintenance/cofiring-draft.js');
const near=(a,b,t=1e-8)=>assert.ok(typeof a==='number'&&Math.abs(a-b)<=t,`${a} differs from ${b}`);

function syntheticDay(){
  const day=core.dailyRange('2026-09-08');
  const measured={unit1:{coal:562.15,bio:434.99},unit2:{coal:653.91,bio:314.55}};
  const timestamps=Array.from({length:1441},(_,i)=>new Date(day.startMs+i*60000).toISOString().replace('.000Z','Z'));
  const series=core.requiredSeries.map(def=>{
    const usage=def.fuel==='coal'?measured[def.unit].coal/4:measured[def.unit].bio;
    return {id:def.id,unit:def.unit,fuel:def.fuel,queryTag:def.queryTag,tag:def.tag,unitOfMeasure:'ton',
      values:Array.from({length:1441},(_,i)=>usage*i/1440)};
  });
  return {schemaVersion:1,targetDate:day.targetDate,timeZone:'Asia/Seoul',mode:'daily',
    start:day.start,end:day.end,queryStart:day.queryStart,queryEnd:day.queryEnd,stepSeconds:60,
    timestamps,series,source:{kind:'synthetic-test'}};
}

const settings=()=>({
  calorifics:{unit1:{coal:5868,bio:3237,organic:3487,manure:3487},unit2:{coal:5868,bio:3237,organic:3487,manure:3487}},
  coefficients:{unit1:{coal:1,bio:1,organic:1,manure:1},unit2:{coal:1,bio:1,organic:1,manure:1}}
});

test('four-fuel calculation exposes measured -> correction -> actual tonnage and heat shares',()=>{
  const data=syntheticDay(),day=core.dailyRange('2026-09-08'),base=settings();
  base.coefficients.unit1={coal:.98,bio:1.02,organic:.95,manure:1.1};
  const result=core.analyzeDay(data,{targetDate:'2026-09-08',organic:{start:day.start,end:day.end,unit1:40,unit2:30},
    manure:{start:day.start,end:day.end,unit1:5,unit2:6},...base});
  const u=result.units.unit1;
  near(u.coal.quantity,u.coal.measuredQuantity*.98);
  near(u.bio.quantity,u.bio.measuredQuantity*1.02);
  near(u.organic.quantity,40*.95);
  near(u.manure.quantity,5*1.1);
  near(u.ratios.total,(u.heats.bio+u.heats.organic+u.heats.manure)/u.heats.total*100);
  near(u.ratios.organic,(u.heats.organic+u.heats.manure)/u.heats.total*100);
  assert.ok(result.combined.heats.manure>0);
});

test('explicit blank manure remains missing instead of becoming silent zero',()=>{
  const data=syntheticDay(),day=core.dailyRange('2026-09-08'),base=settings();
  const result=core.analyzeDay(data,{targetDate:'2026-09-08',organic:{start:day.start,end:day.end,unit1:0,unit2:0},
    manure:{start:day.start,end:day.end,unit1:null,unit2:null},...base});
  assert.equal(result.units.unit1.manure.quantity,null);
  assert.equal(result.units.unit1.ratios.total,null);
  assert.match(result.warnings.join(' '),/축분/);
});

test('requested Excel columns and per-unit/combined ratio labels are rendered',()=>{
  const data=syntheticDay(),day=core.dailyRange('2026-09-08'),base=settings();
  const result=core.analyzeDay(data,{targetDate:'2026-09-08',organic:{start:day.start,end:day.end,unit1:0,unit2:0},
    manure:{start:day.start,end:day.end,unit1:0,unit2:0},...base});
  const html=draft.unitMarkup(result.units.unit1,1,24,{manual:true});
  for(const text of ['Coal','Bio-SRF','유기성 고형연료','축분','사용량','보정계수','실사용량','발열량','투입열량','Bio 혼소율','유기성 혼소율','1호기 총 혼소율'])
    assert.match(html,new RegExp(text));
});

test('Excel screenshot sample reproduces unit ratios and the 1+2 heat-weighted combined co-firing rate',()=>{
  const data=syntheticDay(),day=core.dailyRange('2026-09-08'),base=settings();
  const result=core.analyzeDay(data,{targetDate:'2026-09-08',organic:{start:day.start,end:day.end,unit1:45.89,unit2:45.89},
    manure:{start:day.start,end:day.end,unit1:0,unit2:0},...base});
  near(result.units.unit1.heats.total,4866.77726,1e-6);
  near(result.units.unit2.heats.total,5015.36066,1e-6);
  near(result.units.unit1.fuelRatios.bio,28.9321362942,1e-8);
  near(result.units.unit1.fuelRatios.organicGroup,3.2879752134,1e-8);
  near(result.units.unit2.fuelRatios.bio,20.3015978117,1e-8);
  near(result.units.unit2.fuelRatios.organicGroup,3.1905667578,1e-8);
  near(result.combined.ratios.total,27.7905232879,1e-8);
});
