'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {createDailyOperationCollector}=require('../local-tools/ois-agent/daily-operation-dataparc-agent.js');
const contract=require('../daily-operation/daily-operation-query-contract.js');
const DAY='2026-09-01';
// Git on Windows may check out source as CRLF while the embedded worker is LF.
// Normalize line endings only; whitespace and all guard logic remain exact.
const normalizeSource=source=>source.replace(/\r\n/g,'\n');
const readSource=file=>normalizeSource(fs.readFileSync(file,'utf8'));
function sourceSection(source,startMarker,endMarker,label,useLastEnd=false){
 const start=source.indexOf(startMarker);
 assert.ok(start>=0,`${label}: start marker is missing`);
 const end=useLastEnd?source.lastIndexOf(endMarker):source.indexOf(endMarker,start+startMarker.length);
 assert.ok(end>start,`${label}: end marker is missing or precedes start`);
 return source.slice(start,end);
}
function harness(t,timeoutMilliseconds=500){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'daily-operation-query-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const scriptPath=path.join(directory,'controller.ps1');fs.writeFileSync(scriptPath,'# mock');const children=[];
 const collect=createDailyOperationCollector({platform:'win32',runsDirectory:directory,scriptPath,timeoutMilliseconds,log(){},spawnProcess(exe,args,opts){
  assert.equal(path.win32.basename(exe),'powershell.exe');assert.equal(opts.shell,false);assert.equal(opts.windowsHide,true);assert.equal(args[args.indexOf('-TargetDate')+1],DAY);
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.directory=args[args.indexOf('-OutputDirectory')+1];child.kill=()=>assert.fail('controller cleanup must retain ownership');children.push(child);return child;
 }});
 function results(child){
  const range=contract.interval(DAY);const raw={requestType:contract.TYPE,mode:contract.TYPE,schemaVersion:1,targetDate:DAY,source:'dataparc_hidden_excel',step:'1D',...range,cleanupVerified:true,runId:'a'.repeat(32),databaseWritten:false,
    samples:contract.definitions.map((d,i)=>({...d,date:DAY,value:i,qualityText:'Good',returnedTimeText:DAY+' 12:00:00',periodStartKst:range.startLocal.replace('T',' '),periodEndKst:range.endLocal.replace('T',' ')}))};
  const report={schemaVersion:1,mode:contract.TYPE,runId:raw.runId,targetDate:DAY,ok:true,timedOut:false,workerExitCode:0,resultReceived:true,resultOk:true,cleanupVerified:true,cleanupErrors:[],failure:null,databaseWritten:false,ownedExcel:{ProcessId:321,Path:'C:\\Office\\EXCEL.EXE'}};
  fs.writeFileSync(path.join(child.directory,'pilot-result.json'),JSON.stringify(raw));fs.writeFileSync(path.join(child.directory,'pilot-report.json'),JSON.stringify(report));child.stdout.write('PASS\n');
 }
 return {collect,children,results};
}
test('requires controller exit, matching report and records diagnostics on failures',async t=>{
 for(const scenario of ['success','exit','no-report']){
  const h=harness(t);const promise=h.collect({},{targetDate:DAY});const child=h.children[0];if(scenario!=='no-report')h.results(child);child.emit('close',scenario==='exit'?1:0,null);
  if(scenario==='success')assert.equal((await promise).values.water_demi_avg,0);else await assert.rejects(promise,/진단 폴더/);
  assert.equal(fs.existsSync(path.join(child.directory,'controller-stdout.log')),true);
 }
});
test('soft timeout never kills controller; overlapping launch blocked until owned cleanup closes',async t=>{
 const h=harness(t,15);const promise=h.collect({},{targetDate:DAY});h.results(h.children[0]);await assert.rejects(promise,/대기시간/);
 await assert.rejects(h.collect({},{targetDate:DAY}),/정리 중/);assert.equal(h.children.length,1);
 h.children[0].emit('close',0,null);const next=h.collect({},{targetDate:DAY});h.results(h.children[1]);h.children[1].emit('close',0,null);assert.equal((await next).samples.length,14);
});
test('company-tested worker ownership and cleanup functions remain unchanged after environment namespacing',()=>{
 const directory=path.join(__dirname,'../local-tools/ois-agent');const original=readSource(path.join(directory,'organic-silo-dataparc.ps1'));
 const encoded=original.match(/\$embeddedWorkerBase64 = '([^']+)'/);
 assert.ok(encoded,'reviewed embedded worker is missing');
 const before=normalizeSource(Buffer.from(encoded[1],'base64').toString('utf8')).replace(/GS_ORGANIC/g,'GS_DAILY_OPERATION');
 const worker=readSource(path.join(directory,'daily-operation-dataparc-worker.ps1'));
 const start='function Write-ProbeStage',end='  $queryWorkbook = $workbooks.Add()';
 assert.equal(sourceSection(worker,start,end,'daily worker ownership'),sourceSection(before,start,end,'reviewed worker ownership'));
 const cleanupStart='} finally {\n  Write-ProbeStage "조회용 Excel·DataPARC Host 정리"',cleanupEnd='if ($cleanupErrors.Count -gt 0)';
 assert.equal(sourceSection(worker,cleanupStart,cleanupEnd,'daily worker cleanup',true),sourceSection(before,cleanupStart,cleanupEnd,'reviewed worker cleanup',true));
 const controller=readSource(path.join(directory,'daily-operation-dataparc.ps1'));
 assert.match(controller,/Local\\GSShiftLog\.BlowerRuntimeDataParcHiddenExcelNativeOmV1/);
 assert.match(worker,/Local\\GSShiftLog\.BlowerRuntimeDataParcHiddenExcelNativeOmV1/);
 assert.match(controller,/\$workerPath = Join-Path \$PSScriptRoot 'daily-operation-dataparc-worker.ps1'/);
});

test('PowerShell fixed 14 definitions match canonical TAG, unit and statistic; ValidateOnly precedes Excel resolution',()=>{
 const directory=path.join(__dirname,'../local-tools/ois-agent');
 const worker=readSource(path.join(directory,'daily-operation-dataparc-worker.ps1'));
 const rows=[...worker.matchAll(/\[pscustomobject\]@\{ Key='([^']+)'; Label='([^']+)'; Tag='([^']+)'; Statistic='([^']+)'; Unit='([^']+)' \}/g)];
 assert.equal(rows.length,14);
 assert.deepEqual(rows.map(m=>({key:m[1],label:m[2],tag:m[3],statistic:m[4],unit:m[5]})),contract.definitions.map(({key,label,tag,statistic,unit})=>({key,label,tag,statistic,unit})));
 const controller=readSource(path.join(directory,'daily-operation-dataparc.ps1'));
 sourceSection(controller,'Language.Parser]::ParseInput($workerText','if ($ValidateOnly)','worker parse before validation');
 sourceSection(controller,'if ($ValidateOnly)','$expectedExcelPath = Resolve-ControllerExcelExecutable','validation before Excel');
});

test('source comparisons normalize CRLF only and reject missing ownership or cleanup boundaries',()=>{
 const original='before\nSTART\n  guarded();\nEND\nafter\r';
 const crlf=original.replace(/\n/g,'\r\n');
 assert.equal(normalizeSource(crlf),original);
 assert.equal(sourceSection(normalizeSource(crlf),'START','END','CRLF fixture'),sourceSection(original,'START','END','LF fixture'));
 assert.notEqual(normalizeSource(original.replace('  guarded();',' guarded();')),original);
 assert.throws(()=>sourceSection(original,'MISSING','END','fixture'),/start marker is missing/);
 assert.throws(()=>sourceSection(original,'START','MISSING','fixture'),/end marker is missing/);
 assert.throws(()=>sourceSection(original,'END','START','fixture',true),/end marker is missing or precedes start/);
});
