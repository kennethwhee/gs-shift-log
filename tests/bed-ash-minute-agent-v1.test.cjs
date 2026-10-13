'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {BED_ASH_READER_SHA256,BED_ASH_RAW_PROFILE,BED_ASH_NATIVE_HELPER_SHA256,bedAshMinuteInterval,createBedAshMinuteCollector,collectBedAshWithHourlyFallback}=require('../local-tools/ois-agent/bed-ash-minute-dataparc-agent.js');

const targetDate='2026-10-13';
const now=Date.parse(targetDate+'T00:08:30+09:00');
const kst=value=>new Date(value+32400000).toISOString().slice(0,19)+'+09:00';

function rawFixture(runId,intervalEnd) {
  const intervalStart=targetDate+'T00:00:00+09:00',start=Date.parse(intervalStart),end=Date.parse(intervalEnd);
  return {
    schemaVersion:2,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60,
    targetDate,collectedAt:new Date(now).toISOString(),intervalStart,intervalEnd,
    runId,mode:'bed_ash_minute_dataparc',ok:true,cleanupVerified:true,
    queryProfile:BED_ASH_RAW_PROFILE,formulaCount:0,rawQueryCount:2,rawQueryMethod:'fnTagRawArray',rawValueOnly:false,rawIncludeBounds:true,
    sampleSelection:'first_raw_in_half_open_minute',missingBucketRule:'derived_NoData_Bad_at_bucket_start',
    rawDataValidationPassed:true,allCellsReturned:true,databaseWritten:false,rawQueryEnd:kst(end+60000),
    nativeHelperMode:'embedded_net40',nativeHelperSha256:BED_ASH_NATIVE_HELPER_SHA256,nativeHelperVerified:true,
    validCounts:{unit1:(end-start)/60000,unit2:(end-start)/60000},
    privatePath:'C:\\private-diagnostic-only',units:[1,2].map(unitNo=>({
      unitNo,tagNumber:unitNo+'04HDC01CW101XQ01',itemName:'#'+unitNo+' UNIT BED ASH SILO WE WT-201'+unitNo,
      samples:Array.from({length:(end-start)/60000+1},(_,index)=>({
        sampledAt:kst(start+index*60000),levelTon:index===2?null:(index===0?0:50-unitNo-index),
        quality:index===2?'Raw, Bad':'Raw, Good',returnedAt:index===2?null:kst(start+index*60000+10000)
      }))
    }))
  };
}

function harness(t,{code=0,reportChange=()=>{},rawChange=()=>{},delayed=false}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bed-ash-minute-agent-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const calls=[];let release;
  const collector=createBedAshMinuteCollector({platform:'win32',now:()=>now,runsDirectory:root,log:()=>{},spawnProcess:(exe,args,options)=>{
    calls.push({exe,args,options});
    const child=new EventEmitter();child.pid=123;child.stdout=new PassThrough();child.stderr=new PassThrough();
    release=()=>{
      const value=key=>args[args.indexOf(key)+1],runId=value('-RunId'),intervalEnd=value('-IntervalEnd'),dir=value('-OutputDirectory');
      const raw=rawFixture(runId,intervalEnd);
      const report={schemaVersion:2,runId,targetDate,mode:'bed_ash_minute_dataparc',intervalEnd,
        ok:code===0,timedOut:false,workerExitCode:code,resultReceived:true,resultOk:code===0,
        cleanupVerified:true,processCleanupVerified:true,cleanupErrors:[],databaseWritten:false,
        completedAtUtc:new Date(now).toISOString(),ownedExcel:{ProcessId:42,Path:'C:\\Office\\EXCEL.EXE'},
        arrayDiagnostics:{queryProfile:BED_ASH_RAW_PROFILE,formulaCount:0,rawQueryCount:2,arrayFormulaAssignedCount:0,scalarControlFormulaCount:0,
          rawQueryMethod:'fnTagRawArray',rawValueOnly:false,rawIncludeBounds:true,nativeHelperMode:'embedded_net40',
          nativeHelperSha256:BED_ASH_NATIVE_HELPER_SHA256,nativeHelperVerified:true,failure:null,
          rawDiagnostics:{queryMethod:'fnTagRawArray',sampleSelection:raw.sampleSelection,missingBucketRule:raw.missingBucketRule,
            startedQueryCount:2,returnedQueryCount:2,rawDataValidationPassed:true,calls:raw.units.map(unit=>({
              unitNo:unit.unitNo,tagNumber:unit.tagNumber,method:'fnTagRawArray',valueOnly:false,includeBounds:true,status:'normalized',failure:null,
              matrix:{rank:2,rows:unit.samples.length+1,columns:4},normalization:{matrixRows:unit.samples.length+1,matrixColumns:4,
                sourceRows:unit.samples.length,terminalBlankRows:1,observedBucketCount:unit.samples.length,derivedEmptyBucketCount:0,
                validCount:raw.validCounts['unit'+unit.unitNo]}
            }))}}};
      rawChange(raw);reportChange(report);
      fs.writeFileSync(path.join(dir,'pilot-result.json'),JSON.stringify(raw));
      fs.writeFileSync(path.join(dir,'pilot-report.json'),JSON.stringify(report));
      child.stdout.write('owned controller completed\n');
      setImmediate(()=>child.emit('close',code,null));
    };
    if(!delayed)setImmediate(release);
    return child;
  }});
  return {root,calls,collector,release:()=>release()};
}

test('current-day cutoff is frozen five minutes earlier and prior day includes the midnight boundary',()=>{
  assert.deepEqual(bedAshMinuteInterval(targetDate,now),{intervalStart:targetDate+'T00:00:00+09:00',intervalEnd:targetDate+'T00:03:00+09:00'});
  assert.deepEqual(bedAshMinuteInterval('2026-10-12',now),{intervalStart:'2026-10-12T00:00:00+09:00',intervalEnd:targetDate+'T00:00:00+09:00'});
  for(const date of ['2026-02-30','2026-10-14','invalid'])assert.throws(()=>bedAshMinuteInterval(date,now));
  assert.throws(()=>bedAshMinuteInterval(targetDate,Date.parse(targetDate+'T00:04:59+09:00')),/완료된 분 경계/);
  assert.throws(()=>bedAshMinuteInterval('2026-10-12',Date.parse(targetDate+'T00:04:59+09:00')),/완료된 분 경계/);
  assert.equal(bedAshMinuteInterval('2026-10-12',Date.parse(targetDate+'T00:05:00+09:00')).intervalEnd,targetDate+'T00:00:00+09:00');
});

test('one exact reader invocation returns both units, explicit zero and missing rows without leaking diagnostics',async t=>{
  const h=harness(t),result=await h.collector({}, {targetDate});
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].options.shell,false);
  assert.equal(h.calls[0].options.windowsHide,true);
  assert.equal(h.calls[0].args[h.calls[0].args.indexOf('-IntervalEnd')+1],targetDate+'T00:03:00+09:00');
  assert.equal(result.schemaVersion,2);
  assert.equal(result.sourceKind,'dataparc_bed_ash_minute');
  assert.equal(result.units.length,2);
  assert.equal(result.units[0].samples.length,4);
  assert.equal(result.units[0].samples[0].levelTon,0);
  assert.equal(result.units[0].samples[2].levelTon,null);
  assert.equal(result.units[0].samples[2].quality,'Raw, Bad');
  assert.equal(result.units[0].samples[1].returnedAt,targetDate+'T00:01:10+09:00');
  assert.equal(result.privatePath,undefined);
  assert.equal(result.runId,undefined);
  assert.equal(result.cleanupVerified,undefined);
});

test('a numeric bad-quality, stale-time or altered-tag source cannot be posted as precise data',async t=>{
  for(const rawChange of [
    raw=>raw.units[0].samples[1].quality='Raw, Bad',
    raw=>raw.units[0].samples[1].returnedAt=targetDate+'T00:00:59+09:00',
    raw=>raw.units[1].tagNumber='104HDC01CW101XQ01'
  ]) {
    const h=harness(t,{rawChange});
    await assert.rejects(h.collector({}, {targetDate}),error=>error.cleanupVerified===true&&error.code==='BED_ASH_MINUTE_QUERY_FAILED');
    assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),false);
  }
});

test('an exact independent cleanup report permits hourly fallback after a failed query',async t=>{
  const h=harness(t,{code:1});let hourlyCalls=0;
  const result=await collectBedAshWithHourlyFallback({}, {targetDate},{precise:h.collector,hourly:async()=>{
    hourlyCalls++;return {targetDate,source:'old OIS hourly',units:[{unitNo:1,samples:[{hour:1,levelTon:40}]}]};
  },log:()=>{}});
  assert.equal(hourlyCalls,1);
  assert.equal(result.sourceKind,'ois_hourly_fallback');
  assert.equal(result.sampleIntervalSeconds,3600);
  assert.equal(result.precisionFailure,'BED_ASH_MINUTE_QUERY_FAILED');
  assert.match(result.source,/OIS 시간별 자료/);
  assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),false);
});

test('unverified cleanup or a foreign run report blocks fallback and future launches persistently',async t=>{
  for(const reportChange of [report=>report.cleanupVerified=false,report=>report.runId='f'.repeat(32),report=>report.intervalEnd=targetDate+'T00:02:00+09:00']) {
    const h=harness(t,{code:1,reportChange});let hourlyCalls=0;
    await assert.rejects(collectBedAshWithHourlyFallback({}, {targetDate},{precise:h.collector,hourly:async()=>{hourlyCalls++;return {};},log:()=>{}}),error=>error.cleanupVerified===false);
    assert.equal(hourlyCalls,0);
    assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),true);
    await assert.rejects(h.collector({}, {targetDate}),/정리가 확인되지/);
    assert.equal(h.calls.length,1);
  }
});

test('controller ownership stays active until the process actually closes',async t=>{
  const h=harness(t,{delayed:true}),first=h.collector({}, {targetDate});
  await assert.rejects(h.collector({}, {targetDate}),error=>error.cleanupVerified===false);
  assert.equal(h.calls.length,1);
  h.release();
  assert.equal((await first).units.length,2);
});

test('precise success does not call hourly fallback and no-cleanup exceptions never authorize it',async()=>{
  let called=0;
  const precise={schemaVersion:2,sourceKind:'dataparc_bed_ash_minute'};
  assert.equal(await collectBedAshWithHourlyFallback({}, {targetDate},{precise:async()=>precise,hourly:async()=>{called++;},log:()=>{}}),precise);
  await assert.rejects(collectBedAshWithHourlyFallback({}, {targetDate},{precise:async()=>{throw Error('unconfirmed');},hourly:async()=>{called++;},log:()=>{}}),/unconfirmed/);
  assert.equal(called,0);
});

test('reader hash locks the dedicated two-tag worker and owned cleanup machinery',()=>{
  const script=fs.readFileSync('local-tools/ois-agent/bed-ash-minute-dataparc.ps1');
  assert.equal(crypto.createHash('sha256').update(script).digest('hex'),BED_ASH_READER_SHA256);
  const source=script.toString('utf8'),base=/\$embeddedWorkerBase64 = '([^']+)'/.exec(source)[1];
  const worker=Buffer.from(base,'base64').toString('utf8');
  for(const tag of ['104HDC01CW101XQ01/PLOT','204HDC01CW101XQ01/PLOT'])assert.ok(worker.includes(tag));
  assert.match(worker,/Local\\GSShiftLog\.BlowerRuntimeDataParcHiddenExcelNativeOmV1/);
  assert.match(worker,/\$excel\.Run\('fnTagRawArray'/);
  assert.match(worker,/Convert-BedAshRawMatrix -Matrix \$rawMatrix/);
  assert.match(worker,/queryProfile='bed_ash_minute_raw_r17'/);
  assert.doesNotMatch(worker,/\$queryRange\.Formula=\$formulas|\.FormulaArray\s*=/);
  assert.doesNotMatch(worker,/fnTagStat[^\n]*"Linear"/);
  assert.match(source,/processCleanupVerified=\[bool\]\$cleanupVerified/);
  assert.doesNotMatch(source,/taskkill|Stop-Process\s+-Name/);
});
