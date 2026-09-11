'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../maintenance/cofiring-core.js'),contract=require('../maintenance/cofiring-live-contract.js'),ui=require('../maintenance/cofiring-period-ui-v5.js');
const spec={startLocal:'2026-09-10T00:00',endLocal:'2026-09-10T13:00',stepUnit:'hour',stepValue:1};
function report({bad=false}={}){
 const p=contract.period(spec,Number.MAX_SAFE_INTEGER),duration=p.durationMinutes*60;
 const summaries=contract.definitions.map((def,i)=>{const usage=def.fuel==='coal'?100+i:50+i;return {key:def.id,unit:def.unit,fuel:def.fuel,tag:def.queryTag,startValue:1000+i*100,endValue:1000+i*100+usage,min:1000+i*100,max:1000+i*100+usage,delta:usage,usageTon:usage,startQuality:'Raw, Good',endQuality:'Good, Raw',startTime:spec.startLocal+':00+09:00',endTime:spec.endLocal+':00+09:00',durationGoodSeconds:bad&&i===0?duration-60:duration,durationBadSeconds:bad&&i===0?60:0,boundaryValid:true,durationCoverageValid:true};});
 return {kind:'cofiring_dataparc_period_report',schemaVersion:1,status:bad?'PERIOD_DATA_GAPS':'PERIOD_READY',runId:'0123456789abcdef0123456789abcdef',startLocal:spec.startLocal,endLocal:spec.endLocal,stepUnit:spec.stepUnit,stepValue:spec.stepValue,queryEndLocal:p.queryEndLocal,executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],completedAtUtc:'2026-09-10T04:02:00Z',summaries};
}
test('period supports minute/hour/day step with a 31-day guard',()=>{
 const p=core.periodRange(spec.startLocal,spec.endLocal,'hour',1);assert.equal(p.durationMinutes,780);assert.equal(p.durationHours,13);assert.equal(p.stepMinutes,60);
 assert.equal(core.periodRange('2026-09-10T00:00','2026-09-10T01:00','minute',5).stepMinutes,5);
 assert.equal(core.periodRange('2026-09-10T00:00','2026-09-11T00:00','day',1).stepMinutes,1440);
 assert.throws(()=>core.periodRange('2026-09-10T00:00','2026-10-12T00:00','day',1),/최대 31일/);
});
test('period contract validates cumulative start/end summary and labels quality gaps',()=>{
 const clean=contract.validatePeriodReport(report(),spec);assert.equal(clean.status,'PERIOD_READY');assert.equal(clean.reference.kind,'cofiring_period_summary_v1');assert.equal(clean.reference.summaries.length,10);
 const gap=contract.validatePeriodReport(report({bad:true}),spec);assert.equal(gap.status,'PERIOD_DATA_GAPS');assert.equal(gap.summaries[0].dataComplete,false);
 const bad=report();bad.summaries[0].endTime='2026-09-10T13:02:00+09:00';assert.throws(()=>contract.validatePeriodReport(bad,spec),/경계 반환시각/);
});
test('period calculation uses heat shares and period-bound manual organic/manure',()=>{
 const ref=contract.validatePeriodReport(report(),spec).reference;
 const result=core.analyzePeriodSummary(ref,{...spec,organic:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:10,unit2:20},manure:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:2,unit2:3}});
 assert.equal(result.period.durationHours,13);assert.equal(result.units.unit1.organic.enteredQuantity,10);assert.equal(result.units.unit2.manure.enteredQuantity,3);assert.ok(result.combined.ratios.total>0);assert.equal(result.qualityVerified,true);
 const stale=core.analyzePeriodSummary(ref,{...spec,organic:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T12:59:00+09:00',unit1:10,unit2:20},manure:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:0,unit2:0}});assert.equal(stale.units.unit1.organic.quantity,null);assert.equal(stale.units.unit1.ratios.total,null);
});
test('V5 markup is worksheet-like and contains requested period controls and Excel headers',()=>{
 const html=ui.markup();for(const text of ['Start date','End date','Step size','Get Data','Coal','Bio-SRF','유기성 고형연료','축분','계측 사용량','보정계수','실 사용량'])assert.match(html,new RegExp(text));assert.ok(html.includes('총 혼소율(Bio+유기성+축분)'));
 assert.match(html,/value="minute"/);assert.match(html,/value="hour" selected/);assert.match(html,/value="day"/);
 const css=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.css'),'utf8');assert.match(css,/\.cfv5-input-yellow\{background:#fff200/);assert.match(css,/\.cfv5-input-blue\{background:#8ec9e6/);assert.match(css,/\.cfv5-ratio\{color:#f00000/);
});
test('host loads V5 period assets instead of the old daily draft UI',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');assert.match(html,/cofiring-period-ui-v5\.css\?v=20260911-period-excel-v5/);assert.match(html,/cofiring-period-manual-storage\.js\?v=20260911-period-excel-v5/);assert.match(html,/cofiring-period-ui-v5\.js\?v=20260911-period-excel-v5/);assert.doesNotMatch(html,/cofiring-draft\.js\?v=20260911-calc-layout-v4/);
});
