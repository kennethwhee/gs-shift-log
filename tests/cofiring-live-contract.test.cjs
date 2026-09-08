'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{gunzipSync}=require('zlib');
const c=require('../maintenance/cofiring-live-contract.js'),core=require('../maintenance/cofiring-core.js'),draft=require('../maintenance/cofiring-draft.js');
const fixtures=JSON.parse(gunzipSync(fs.readFileSync(process.env.COFIRING_V7_TEST_FIXTURE || path.join(__dirname,'fixtures/cofiring-live-v7.json.gz'))));
const clone=x=>JSON.parse(JSON.stringify(x));
test('server generated validator is byte-identical to the Agent/browser validator',()=>{
 const shared=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-live-contract.js'),'utf8').replace(/\r\n/g,'\n').split('\n(function(root)')[0];const api=fs.readFileSync(path.join(__dirname,'../functions/api/ois-data-requests.js'),'utf8').replace(/\r\n/g,'\n');assert.ok(api.includes(shared));assert.deepEqual(c.definitions,core.requiredSeries);
});
for(const date of Object.keys(fixtures))test('V7-format '+date+' data survives validation without filling missing values',()=>{
 const input=fixtures[date],r=c.validateReport(input,date);assert.equal(r.noDataRows,date.endsWith('07')?10:54);assert.equal(draft.parseImportedReport(r).hasDataGaps,true);
 for(let i=0;i<10;i++){assert.deepEqual(r.reference.series[i].values,input.reference.series[i].values);assert.deepEqual(r.reference.series[i].returnedTimes,input.reference.series[i].returnedTimes);}
 const calculated=core.analyzeDay(r.reference,{targetDate:date,requireQuality:true});assert.equal(calculated.units.unit2.bio.quantity,null);assert.equal(calculated.units.unit2.ratios.total,null);assert.equal(calculated.units.unit1.organic.quantity,null);
});
test('calendar month/year/leap transitions retain 1440-min accounting and one extra query minute',()=>{
 for(const [date,next]of [['2026-09-30','2026-10-01'],['2026-12-31','2027-01-01'],['2028-02-29','2028-03-01']])assert.equal(c.day(date).queryEnd,next+' 00:01');
 for(const date of ['2026-02-29','2026-09-01T00:00','2026-09-01~02','',null])assert.throws(()=>c.day(date));
 const at=Date.parse('2026-09-09T00:01:00+09:00');assert.throws(()=>c.completedDay('2026-09-08',at-1));assert.doesNotThrow(()=>c.completedDay('2026-09-08',at));
});
const cases={
 'false cleanup':r=>r.cleanupVerified=false,'false independent cleanup':r=>r.processCleanupVerified=false,'cleanup error':r=>r.cleanupErrors=['RPC failure'],
 'timed out':r=>r.timedOut=true,'nonzero worker':r=>r.workerExitCode=1,'wrong day':r=>r.targetDate='2026-09-07','wrong run':r=>r.reference.source.runId='0'.repeat(32),
 'query double-padding':r=>r.queryEnd='2026-09-09 00:02','two days':r=>r.durationMinutes=2880,'duplicate tag':r=>r.reference.series[1]=clone(r.reference.series[0]),
 'counter reset':r=>r.reference.series[0].values[100]=0,'negative':r=>r.reference.series[0].values[100]=-1,'coerced string':r=>r.reference.series[0].values[100]='1',
 'bad numeric quality':r=>r.reference.series[0].qualities[1]='Raw, Bad','unknown quality':r=>r.reference.series[0].qualities[1]='Calculated, Good',
 'blank metadata':r=>r.reference.series[0].returnedTimes[1]='','shifted time':r=>r.reference.series[0].returnedTimes[1]=r.reference.series[0].returnedTimes[2],
 'late time':r=>r.reference.series[0].returnedTimes[0]='2026-09-08T00:01:00+09:00','missing boundary':r=>{r.reference.series[0].values[0]=null;r.reference.series[0].qualities[0]='No Data, Bad';},
 'false count':r=>r.noDataRows=0,'missing summary':r=>r.tagSummary.pop(),'false gap times':r=>r.tagSummary[1].missingTimes[0]='2026-09-08T18:25:00+09:00',
 'false valid flag':r=>r.dataValidated=true,'pending rows':r=>r.response.pendingRows=1,'wrong aggregation':r=>r.reference.aggregation='Average',
 'reference mismatch':r=>r.referenceComparison.mismatchSamples=1,'fake reference pass':r=>r.referenceComparison.matched=true,'missing completed time':r=>r.completedAtUtc='',
 'unknown version':r=>r.pilotVersion=8,'foreign request kind':r=>r.kind='generic','saved in collector':r=>r.databaseWritten=true
};
for(const [name,change]of Object.entries(cases))test('reject '+name,()=>{const r=clone(fixtures['2026-09-08']);change(r);assert.throws(()=>c.validateReport(r,'2026-09-08'));});
test('synthetic complete zero counters remain zero, not blank; complete status must be consistent',()=>{
 const r=clone(fixtures['2026-09-08']);for(const s of r.reference.series){s.values.fill(0);s.qualities.fill('Raw, Good');}
 for(const t of r.tagSummary){t.validRows=1441;t.noDataRows=0;t.missingTimes=[];t.minuteDataComplete=true;}
 Object.assign(r.response,{valueRows:14410,noDataRows:0});r.noDataRows=0;r.dataValidated=true;r.status='REFERENCE_UNVERIFIED';
 const valid=c.validateReport(r,r.targetDate);assert.ok(valid.reference.series.every(s=>s.values.every(n=>n===0)));
 r.status='PASS';assert.throws(()=>c.validateReport(r,r.targetDate));r.referenceComparison.comparedSamples=14410;r.referenceComparison.matched=true;assert.equal(c.validateReport(r,r.targetDate).status,'PASS');
});
