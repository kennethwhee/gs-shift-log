'use strict';

const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {normalizeMinuteBedAshResult}=require('../../efficiency/bed-ash-minute-contract.js');

const BED_ASH_READER_SHA256='36d6676c88e49bae8549d92b52627882160fc5bcc96ff9de975ddc70761fe2a7';
const defaultRuns=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'GSShiftLog','bed-ash-minute-dataparc','runs');
const blockFile=path.join(defaultRuns,'cleanup-blocked.json');
const isBedAshExcelBlocked=()=>fs.existsSync(blockFile);
const kst=value=>new Date(value+32400000).toISOString().slice(0,19)+'+09:00';

function bedAshMinuteInterval(targetDate,now=Date.now()) {
  const day=typeof targetDate==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(targetDate)?Date.parse(targetDate+'T00:00:00Z'):NaN;
  if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==targetDate||!Number.isFinite(now)) {
    throw new Error('Bed Ash 조회 날짜가 올바르지 않습니다.');
  }
  const start=day-32400000,today=new Date(now+32400000).toISOString().slice(0,10);
  if(targetDate<'2021-01-01'||targetDate>today)throw new Error('Bed Ash는 오늘까지의 자료만 조회할 수 있습니다.');
  const end=targetDate===today?Math.floor((now-300000)/60000)*60000:start+86400000;
  if(end<start||end+60000>now)throw new Error('Bed Ash 조회에 사용할 완료된 분 경계가 없습니다.');
  return {intervalStart:kst(start),intervalEnd:kst(end)};
}

function matchesCleanupReport(report,runId,targetDate,intervalEnd) {
  return !!report&&report.schemaVersion===2&&report.mode==='bed_ash_minute_dataparc'&&
    report.runId===runId&&report.targetDate===targetDate&&report.intervalEnd===intervalEnd&&
    report.cleanupVerified===true&&report.processCleanupVerified===true&&
    Array.isArray(report.cleanupErrors)&&report.cleanupErrors.length===0&&report.databaseWritten===false&&
    Number.isFinite(Date.parse(report.completedAtUtc));
}

function createBedAshMinuteCollector(options={}) {
  const spawnProcess=options.spawnProcess||spawn,platform=options.platform||process.platform;
  const now=options.now||Date.now,log=options.log||console.log;
  const script=options.scriptPath||path.join(__dirname,'bed-ash-minute-dataparc.ps1');
  const expectedHash=options.readerSha256||BED_ASH_READER_SHA256;
  const root=options.runsDirectory||defaultRuns,blocked=path.join(root,'cleanup-blocked.json');
  const normalize=options.normalizeResult||normalizeMinuteBedAshResult;
  const timeoutMilliseconds=options.timeoutMilliseconds??450000;
  let active=null;
  return async function collectBedAshMinuteDataParcValues(_config,request) {
    const targetDate=request?.targetDate??request?.target_date;
    let interval;
    try{interval=bedAshMinuteInterval(targetDate,now());}catch(error){error.cleanupVerified=true;error.code='BED_ASH_MINUTE_DATE_INVALID';throw error;}
    if(active||fs.existsSync(blocked)) {
      const error=new Error('이전 Bed Ash 조회용 Excel 정리가 확인되지 않았습니다.');
      error.cleanupVerified=false;error.code='BED_ASH_MINUTE_CLEANUP_UNVERIFIED';throw error;
    }
    if(platform!=='win32'||!fs.existsSync(script)||crypto.createHash('sha256').update(fs.readFileSync(script)).digest('hex')!==expectedHash) {
      const error=new Error(platform!=='win32'?'Bed Ash DataPARC 조회에는 회사 Windows PC가 필요합니다.':'Bed Ash 1분 조회 스크립트가 없거나 검증된 파일과 다릅니다.');
      error.cleanupVerified=true;error.code='BED_ASH_MINUTE_READER_UNAVAILABLE';throw error;
    }
    fs.mkdirSync(root,{recursive:true});
    const runId=crypto.randomUUID().replaceAll('-',''),dir=fs.mkdtempSync(path.join(root,targetDate+'-'));
    const executable=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    let launched=false,exitCode=null,closeSignal=null;
    const readJson=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8').replace(/^\uFEFF/,''));
    log('Bed Ash 1분 DataPARC 조회 시작 · '+targetDate);
    try {
      await new Promise((resolve,reject)=>{
        let child;
        try{child=spawnProcess(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,
          '-TargetDate',targetDate,'-IntervalEnd',interval.intervalEnd,'-RunId',runId,'-OutputDirectory',dir],
          {windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],cwd:path.dirname(script)});}catch(error){reject(error);return;}
        launched=true;active=child;
        let stdout='',stderr='',settled=false;
        const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
        // This is a soft wait deadline. The owned controller continues its independent
        // watchdog/cleanup; never kill it or release the active lane from here.
        const timer=setTimeout(()=>finish(new Error('Bed Ash 1분 조회 대기시간을 초과했습니다.')),timeoutMilliseconds);
        child.stdout?.setEncoding('utf8');child.stderr?.setEncoding('utf8');
        child.stdout?.on('data',chunk=>{stdout=(stdout+String(chunk)).slice(-1048576);});
        child.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-1048576);});
        child.once('error',error=>{if(!child.pid){launched=false;if(active===child)active=null;}finish(error);});
        child.once('close',(code,signal)=>{
          exitCode=code;closeSignal=signal;if(active===child)active=null;
          try{fs.writeFileSync(path.join(dir,'controller-stdout.log'),stdout);fs.writeFileSync(path.join(dir,'controller-stderr.log'),stderr);}catch(error){finish(error);return;}
          if(signal||code!==0)finish(new Error('Bed Ash 1분 조회가 정상 완료되지 않았습니다.'));else finish();
        });
      });
      const report=readJson('pilot-report.json'),raw=readJson('pilot-result.json');
      if(!matchesCleanupReport(report,runId,targetDate,interval.intervalEnd)||report.ok!==true||
        report.timedOut!==false||report.workerExitCode!==0||report.resultReceived!==true||report.resultOk!==true||
        raw.runId!==runId||raw.mode!=='bed_ash_minute_dataparc'||raw.cleanupVerified!==true||raw.ok!==true||
        !report.ownedExcel||!Number.isInteger(report.ownedExcel.ProcessId)||report.ownedExcel.ProcessId<=0||
        path.win32.basename(String(report.ownedExcel.Path)).toLowerCase()!=='excel.exe') {
        throw new Error('Bed Ash 실행·종료 보고서 검증을 통과하지 못했습니다.');
      }
      const result=normalize(raw,targetDate,now());
      fs.writeFileSync(path.join(dir,'bridge-result.json'),JSON.stringify(result));
      log('Bed Ash 1분 DataPARC 조회·정리 완료 · '+targetDate);
      return result;
    } catch(cause) {
      let report=null;try{report=readJson('pilot-report.json');}catch(_){}
      // Cleanup may succeed even when the tag/query/data failed. Only an exact,
      // independently verified controller report permits the hourly fallback.
      const cleanupVerified=!launched||(active===null&&!closeSignal&&Number.isInteger(exitCode)&&
        matchesCleanupReport(report,runId,targetDate,interval.intervalEnd));
      if(!cleanupVerified)fs.writeFileSync(blocked,JSON.stringify({runId,targetDate,at:new Date(now()).toISOString(),diagnosticDirectory:dir},null,2));
      fs.writeFileSync(path.join(dir,'bridge-error.json'),JSON.stringify({runId,targetDate,cleanupVerified,message:String(cause.message)},null,2));
      const error=new Error(cleanupVerified?'Bed Ash 1분 원본 조회를 완료하지 못했습니다.':'Bed Ash 조회용 프로세스 정리를 확인하지 못했습니다. 추가 조회를 보류합니다.');
      error.code=cleanupVerified?'BED_ASH_MINUTE_QUERY_FAILED':'BED_ASH_MINUTE_CLEANUP_UNVERIFIED';
      error.cleanupVerified=cleanupVerified;error.diagnosticDirectory=dir;
      throw error;
    }
  };
}

async function collectBedAshWithHourlyFallback(config,request,{precise=collectBedAshMinuteDataParcValues,hourly,log=console.warn}={}) {
  try{return await precise(config,request);}catch(error){
    if(error?.cleanupVerified!==true||typeof hourly!=='function')throw error;
    log('Bed Ash 1분 원본 조회 실패 · 정리 확인 완료 · 기존 OIS 시간별 자료로 조회합니다.');
    const result=await hourly();
    return {...result,sourceKind:'ois_hourly_fallback',sampleIntervalSeconds:3600,
      source:'OIS 시간별 자료 (1분 원본 조회 실패)',precisionFailure:error.code||'BED_ASH_MINUTE_QUERY_FAILED'};
  }
}

const collectBedAshMinuteDataParcValues=createBedAshMinuteCollector();
module.exports={BED_ASH_READER_SHA256,bedAshMinuteInterval,matchesCleanupReport,createBedAshMinuteCollector,
  collectBedAshMinuteDataParcValues,collectBedAshWithHourlyFallback,isBedAshExcelBlocked};
