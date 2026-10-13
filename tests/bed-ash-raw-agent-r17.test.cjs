'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {BED_ASH_RAW_PROFILE,BED_ASH_NATIVE_HELPER_SHA256,createBedAshMinuteCollector}=require('../local-tools/ois-agent/bed-ash-minute-dataparc-agent.js');

const now=Date.parse('2026-10-13T00:08:30+09:00');
const kst=value=>new Date(value+32400000).toISOString().slice(0,19)+'+09:00';

function packet(runId,targetDate,intervalEnd) {
  const intervalStart=targetDate+'T00:00:00+09:00',start=Date.parse(intervalStart),end=Date.parse(intervalEnd);
  const metadata={queryProfile:BED_ASH_RAW_PROFILE,formulaCount:0,rawQueryCount:2,
    rawQueryMethod:'fnTagRawArray',rawValueOnly:false,rawIncludeBounds:true,
    nativeHelperMode:'embedded_net40',nativeHelperSha256:BED_ASH_NATIVE_HELPER_SHA256,nativeHelperVerified:true};
  const units=[1,2].map(unitNo=>({unitNo,tagNumber:unitNo+'04HDC01CW101XQ01',itemName:'Bed Ash Unit '+unitNo,
    samples:Array.from({length:(end-start)/60000+1},(_,index)=>({
      sampledAt:kst(start+index*60000),levelTon:index===1||index===2?null:index===0?0:50+unitNo,
      quality:index===1?'No Data, Bad':index===2?'Raw, Bad':'Raw, Good',
      returnedAt:kst(start+index*60000+(index===1?0:10000))
    }))}));
  const raw={...metadata,schemaVersion:2,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60,
    targetDate,intervalStart,intervalEnd,rawQueryEnd:kst(end+60000),collectedAt:new Date(now).toISOString(),
    runId,mode:'bed_ash_minute_dataparc',ok:true,cleanupVerified:true,allCellsReturned:true,databaseWritten:false,
    sampleSelection:'first_raw_in_half_open_minute',missingBucketRule:'derived_NoData_Bad_at_bucket_start',
    rawDataValidationPassed:true,validCounts:Object.fromEntries(units.map(unit=>['unit'+unit.unitNo,unit.samples.filter(s=>s.levelTon!==null).length])),units};
  const report={schemaVersion:2,runId,targetDate,intervalEnd,mode:'bed_ash_minute_dataparc',ok:true,
    timedOut:false,workerExitCode:0,resultReceived:true,resultOk:true,cleanupVerified:true,
    processCleanupVerified:true,cleanupErrors:[],databaseWritten:false,completedAtUtc:new Date(now).toISOString(),
    ownedExcel:{ProcessId:842,Path:'C:\\Office\\EXCEL.EXE'},arrayDiagnostics:{...metadata,
      arrayFormulaAssignedCount:0,scalarControlFormulaCount:0,failure:null,rawDiagnostics:{
        queryMethod:'fnTagRawArray',sampleSelection:raw.sampleSelection,missingBucketRule:raw.missingBucketRule,
        startedQueryCount:2,returnedQueryCount:2,rawDataValidationPassed:true,calls:units.map(unit=>({
          unitNo:unit.unitNo,tagNumber:unit.tagNumber,method:'fnTagRawArray',valueOnly:false,includeBounds:true,
          status:'normalized',failure:null,matrix:{rank:2,columns:4,rows:unit.samples.length},
          normalization:{matrixRows:unit.samples.length,matrixColumns:4,sourceRows:unit.samples.length-1,terminalBlankRows:1,
            observedBucketCount:unit.samples.length-1,derivedEmptyBucketCount:1,validCount:raw.validCounts['unit'+unit.unitNo]}
        }))}}};
  return {raw,report};
}

function harness(t,{change=()=>{},targetDate='2026-10-12',normalizeResult}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bed-ash-raw-r17-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let outputDirectory;const calls=[];
  const collector=createBedAshMinuteCollector({platform:'win32',now:()=>now,runsDirectory:root,log:()=>{},normalizeResult,
    spawnProcess:(executable,args,options)=>{
      calls.push({executable,args,options});
      const value=key=>args[args.indexOf(key)+1];
      outputDirectory=value('-OutputDirectory');
      const child=new EventEmitter();child.pid=482;child.stdout=new PassThrough();child.stderr=new PassThrough();
      const data=packet(value('-RunId'),targetDate,value('-IntervalEnd'));
      change(data);
      fs.writeFileSync(path.join(outputDirectory,'pilot-result.json'),JSON.stringify(data.raw));
      fs.writeFileSync(path.join(outputDirectory,'pilot-report.json'),JSON.stringify(data.report));
      setImmediate(()=>child.emit('close',0,null));return child;
    }});
  return {collect:()=>collector({}, {targetDate}),calls,root,directory:()=>outputDirectory};
}

test('raw collection keeps all 2,882 previous-day samples, zero, missing and bad observations without exposing diagnostics',async t=>{
  const h=harness(t),result=await h.collect();
  assert.equal(h.calls.length,1);
  assert.equal(result.units.reduce((sum,unit)=>sum+unit.samples.length,0),2882);
  for(const unit of result.units) {
    assert.equal(unit.samples[0].levelTon,0);
    assert.deepEqual(unit.samples[1],{sampledAt:'2026-10-12T00:01:00+09:00',levelTon:null,quality:'No Data, Bad',returnedAt:'2026-10-12T00:01:00+09:00'});
    assert.deepEqual(unit.samples[2],{sampledAt:'2026-10-12T00:02:00+09:00',levelTon:null,quality:'Raw, Bad',returnedAt:'2026-10-12T00:02:10+09:00'});
    assert.equal(unit.samples.at(-1).sampledAt,'2026-10-13T00:00:00+09:00');
  }
  for(const key of ['queryProfile','rawQueryCount','nativeHelperSha256','arrayDiagnostics','validCounts','sampleSelection'])assert.equal(result[key],undefined);
  assert.equal(fs.existsSync(path.join(h.directory(),'bridge-result.json')),true);
});

test('current-day raw collection only returns the frozen completed-minute interval',async t=>{
  const h=harness(t,{targetDate:'2026-10-13'}),result=await h.collect();
  assert.equal(result.intervalEnd,'2026-10-13T00:03:00+09:00');
  assert.equal(result.units[0].samples.length,4);
  assert.equal(result.units[1].samples.length,4);
  assert.equal(h.calls[0].args[h.calls[0].args.indexOf('-IntervalEnd')+1],result.intervalEnd);
});

const malformedCases=[
  ['old scalar profile',({raw})=>raw.queryProfile='bed_ash_minute_dataparc_v1'],
  ['trial profile',({raw})=>raw.queryProfile='bed_ash_minute_raw_pilot_r16'],
  ['missing query metadata',({raw})=>delete raw.rawQueryCount],
  ['only one raw call',({raw})=>raw.rawQueryCount=1],
  ['string count',({raw})=>raw.rawQueryCount='2'],
  ['value-only raw data',({raw})=>raw.rawValueOnly=true],
  ['missing include-bounds',({raw})=>raw.rawIncludeBounds=false],
  ['different selection rule',({raw})=>raw.sampleSelection='last_good_in_minute'],
  ['interpolated missing rows',({raw})=>raw.missingBucketRule='carry_forward'],
  ['string validation flag',({raw})=>raw.rawDataValidationPassed='true'],
  ['formula retry',({raw})=>raw.formulaCount=1],
  ['not all cells returned',({raw})=>raw.allCellsReturned=false],
  ['database-written packet',({raw})=>raw.databaseWritten=true],
  ['unverified helper',({raw})=>raw.nativeHelperVerified=false],
  ['different helper',({raw})=>raw.nativeHelperSha256='0'.repeat(64)],
  ['different requested interval',({raw})=>raw.intervalEnd='2026-10-12T23:59:00+09:00'],
  ['raw query excludes final minute',({raw})=>raw.rawQueryEnd=raw.intervalEnd],
  ['diagnostic profile differs',({report})=>report.arrayDiagnostics.queryProfile='other'],
  ['scalar diagnostic retry',({report})=>report.arrayDiagnostics.scalarControlFormulaCount=6],
  ['array diagnostic retry',({report})=>report.arrayDiagnostics.arrayFormulaAssignedCount=6],
  ['query did not return',({report})=>report.arrayDiagnostics.rawDiagnostics.returnedQueryCount=1],
  ['query did not start',({report})=>report.arrayDiagnostics.rawDiagnostics.startedQueryCount=1],
  ['missing second query evidence',({report})=>report.arrayDiagnostics.rawDiagnostics.calls.pop()],
  ['duplicate first unit query',({report})=>report.arrayDiagnostics.rawDiagnostics.calls[1]=report.arrayDiagnostics.rawDiagnostics.calls[0]],
  ['normalization not finished',({report})=>report.arrayDiagnostics.rawDiagnostics.calls[1].status='query_returned'],
  ['wrong matrix rank',({report})=>report.arrayDiagnostics.rawDiagnostics.calls[0].matrix.rank=1],
  ['wrong matrix columns',({report})=>report.arrayDiagnostics.rawDiagnostics.calls[0].matrix.columns=3],
  ['missing terminator',({report})=>report.arrayDiagnostics.rawDiagnostics.calls[0].normalization.terminalBlankRows=0],
  ['wrong bucket count',({report})=>report.arrayDiagnostics.rawDiagnostics.calls[0].normalization.derivedEmptyBucketCount=0],
  ['wrong valid count',({report})=>report.arrayDiagnostics.rawDiagnostics.calls[0].normalization.validCount=1441],
  ['missing unit',({raw})=>raw.units.pop()],
  ['missing minute row',({raw})=>raw.units[0].samples.pop()],
  ['missing diagnostics',({report})=>delete report.arrayDiagnostics]
];

for(const [label,change] of malformedCases)test('rejects '+label+' before publishing a result',async t=>{
  let normalizations=0;
  const h=harness(t,{change,normalizeResult:()=>{normalizations++;return {};}});
  await assert.rejects(h.collect(),error=>error.code==='BED_ASH_MINUTE_QUERY_FAILED'&&error.cleanupVerified===true);
  assert.equal(normalizations,0);
  assert.equal(fs.existsSync(path.join(h.directory(),'bridge-result.json')),false);
  assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),false);
});

test('hourly data cannot be mislabeled as a successful raw precise packet',async t=>{
  const h=harness(t,{change:({raw})=>{raw.sourceKind='ois_hourly_fallback';raw.sampleIntervalSeconds=3600;}});
  await assert.rejects(h.collect(),error=>error.code==='BED_ASH_MINUTE_QUERY_FAILED');
  assert.equal(fs.existsSync(path.join(h.directory(),'bridge-result.json')),false);
});

test('a malformed or database-written cleanup report keeps the persistent process block',async t=>{
  for(const change of [({report})=>report.databaseWritten=true,({report})=>report.cleanupErrors.push('unverified process')]) {
    const h=harness(t,{change});
    await assert.rejects(h.collect(),error=>error.cleanupVerified===false&&error.code==='BED_ASH_MINUTE_CLEANUP_UNVERIFIED');
    assert.equal(fs.existsSync(path.join(h.root,'cleanup-blocked.json')),true);
    assert.equal(fs.existsSync(path.join(h.directory(),'bridge-result.json')),false);
  }
});
