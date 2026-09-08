 'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const core=require('../maintenance/cofiring-core.js');
const reference=JSON.parse(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-draft-reference.json'),'utf8'));
test('September 8 accounting and query boundaries are deliberately distinct',()=>{
 const day=core.dailyRange('2026-09-08');assert.equal(day.start,'2026-09-08T00:00:00+09:00');assert.equal(day.end,'2026-09-09T00:00:00+09:00');assert.equal(day.queryEnd,'2026-09-09T00:01:00+09:00');assert.equal(day.durationMinutes,1440);assert.equal(day.durationHours,24);assert.equal(day.boundaryCount,1441);assert.equal(day.queryDurationMinutes,1441);
});
test('month, year and leap-day rollovers remain calendar-correct',()=>{
 for(const [date,next]of [['2026-09-30','2026-10-01'],['2026-12-31','2027-01-01'],['2028-02-28','2028-02-29'],['2028-02-29','2028-03-01'],['2026-02-28','2026-03-01']])assert.equal(core.dailyRange(date).queryEnd,next+'T00:01:00+09:00');
});
test('invalid dates, date-times and multi-date inputs are rejected',()=>{
 for(const date of ['',null,'2026-9-8','2026-02-29','2026-04-31','2026-09-08T13:00','2026-09-08 ~ 2026-09-09'])assert.throws(()=>core.dailyRange(date));
});
test('daily default reproduces workbook quantities without 1441-minute denominator',()=>{
 const result=core.analyzeDay(reference,{targetDate:'2026-09-07',organic:reference.manualOrganic});assert.equal(result.period.durationHours,24);assert.equal(result.units.unit1.coal.quantity,598.6298828125);assert.equal(result.units.unit1.coal.averageTonPerHour,598.6298828125/24);assert.equal(result.period.queryEnd,'2026-09-08T00:01:00+09:00');assert.equal(result.databaseWritten,false);assert.equal(result.productionReady,false);
});
test('arbitrary sub-day and next-day 00:01 accounting overrides are forbidden',()=>{
 for(const options of [{start:'2026-09-07T13:00:00+09:00'},{end:'2026-09-07T13:00:00+09:00'},{end:'2026-09-08T00:01:00+09:00'}])assert.throws(()=>core.analyzeDay(reference,options),/하루 단위/);
});
test('a different requested day never takes the reference day values',()=>{assert.throws(()=>core.analyzeDay(reference,{targetDate:'2026-09-08'}),/선택일 2026-09-08/);});
test('query end is extended once, and a double extension is rejected',()=>{
 const data=structuredClone(reference);data.queryStart=data.start;data.queryEnd='2026-09-08T00:01:00+09:00';assert.equal(core.validateDailySource(data).boundaryCount,1441);data.queryEnd='2026-09-08T00:02:00+09:00';assert.throws(()=>core.validateDailySource(data),/한 번만/);
});
test('source with 1442 points cannot include next day 00:01 consumption',()=>{
 const data=structuredClone(reference);data.timestamps.push('2026-09-08T00:01:00+09:00');data.series.forEach(s=>s.values.push(999999));assert.throws(()=>core.analyzeDay(data),/개수/);
});
test('missing final midnight boundary blocks daily computation',()=>{
 const data=structuredClone(reference);data.timestamps.pop();data.series.forEach(s=>s.values.pop());assert.throws(()=>core.analyzeDay(data),/개수/);
});
test('UTC representation of a KST day normalizes to the same selected date',()=>{
 const data=structuredClone(reference);data.start='2026-09-06T15:00:00Z';data.end='2026-09-07T15:00:00Z';assert.equal(core.validateDailySource(data).targetDate,'2026-09-07');
});
test('last counter increment is included exactly once while no following minute is invented',()=>{
 const data=structuredClone(reference);data.series.forEach(s=>{s.values=Array(1441).fill(100);s.values[1440]=101;});const result=core.analyzeDay(data,{organic:{start:data.start,end:data.end,unit1:0,unit2:0}});assert.equal(result.units.unit1.coal.quantity,4);assert.equal(result.units.unit1.bio.quantity,1);assert.equal(result.units.unit1.bio.averageTonPerHour,1/24);
});
test('manual organic value from any other calendar date is not reused',()=>{
 const result=core.analyzeDay(reference,{organic:{start:'2026-09-08T00:00:00+09:00',end:'2026-09-09T00:00:00+09:00',unit1:59.84,unit2:59.84}});assert.equal(result.units.unit1.organic.quantity,null);assert.equal(result.units.unit1.ratios.total,null);
});
test('quality classifier agrees with existing worker on the two Good/Raw token orders',()=>{assert.equal(core.qualityGood('Good, Raw'),true);assert.equal(core.qualityGood('Raw, Good'),true);assert.equal(core.qualityGood('Raw, Good, Bad'),false);});
