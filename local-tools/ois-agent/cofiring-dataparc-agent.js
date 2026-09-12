'use strict';
// Web bridge only. The V7 Excel controller remains byte-for-byte unchanged.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const contract=require('../../maintenance/cofiring-live-contract.js');
const COFIRING_REQUEST_TYPE=contract.TYPE;
const READER_SHA256='a0e0264138d6c7bc6e2d53d8e2ad04138a2d6b9fdabc93702ada178106fa22ca';
const runsDirectory=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'GSShiftLog','cofiring-dataparc','runs');
const blockFile=path.join(runsDirectory,'cleanup-blocked.json');
function isCofiringExcelBlocked(){return fs.existsSync(blockFile);}
function createCofiringCollector(options={}) {
  const spawnProcess=options.spawnProcess||spawn,platform=options.platform||process.platform;
  const root=options.runsDirectory||runsDirectory,log=options.log||console.log;
  const script=options.scriptPath||path.join(__dirname,'cofiring-daily-v7','test-cofiring-dataparc-daily-v7.ps1');
  const blocked=path.join(root,'cleanup-blocked.json');
  let active=null;
  return async function collect(config,request,callbacks={}) {
    const id=request?.id,date=request?.targetDate;
    contract.completedDay(date);
    if(request?.requestType!==COFIRING_REQUEST_TYPE||request.status!=='processing'||!contract.uuid(id)||
       request.agentId!==config.agentId||!request.agentId||!Number.isFinite(Date.parse(request.startedAt))||
       Date.parse(request.expiresAt)-Date.now()<18*60000)throw new Error('혼소율 요청 소유권 또는 남은 처리시간이 올바르지 않습니다.');
    if(platform!=='win32')throw new Error('혼소율 DataPARC 조회는 회사 Windows PC에서 실행해야 합니다.');
    if(active||fs.existsSync(blocked))throw new Error('이전 혼소율 조회의 Excel 정리가 확인되지 않았습니다. 추가 조회를 시작하지 않습니다.');
    if(!fs.existsSync(script)||crypto.createHash('sha256').update(fs.readFileSync(script)).digest('hex')!==READER_SHA256)throw new Error('검증된 V7 조회 파일이 없거나 변경됐습니다. 설치 파일을 확인해 주세요.');
    fs.mkdirSync(root,{recursive:true});
    const dir=fs.mkdtempSync(path.join(root,date+'-'));
    const progress={phase:'starting',completedTags:0};
    let progressTask=Promise.resolve(),closed=false,lastProgress='';
    function sendProgress(force=false) {
      if(typeof callbacks.postProgress!=='function'||closed)return;
      const snapshot={...progress},signature=JSON.stringify(snapshot);
      if(!force&&signature===lastProgress)return;lastProgress=signature;
      progressTask=progressTask.then(()=>callbacks.postProgress(snapshot)).catch(e=>log('[혼소율] 진행상태 전송 보류: '+String(e.message).slice(0,160)));
    }
    sendProgress();
    let stdout='',stderr='',carry='',softTimer,heartbeat;
    const executable=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const append=(text,isError)=>{
      if(isError){stderr=(stderr+text).slice(-2*1024*1024);return;}
      stdout=(stdout+text).slice(-2*1024*1024);carry+=text;
      const lines=carry.split(/\r?\n/);carry=lines.pop();
      for(const line of lines){
        if(!line.trim())continue;log('[혼소율] '+line.slice(0,700));
        const tag=/TAG (\d+)\/10/.exec(line);
        if(tag){progress.phase='reading';progress.completedTags=Math.max(progress.completedTags,Number(tag[1])-1);if(/동일 응답 3\/3/.test(line))progress.completedTags=Number(tag[1]);}
        if(/수신 결과 검증|조회용 Excel·DataPARC Host 정리/.test(line))progress.phase='cleanup';
        sendProgress();
      }
    };
    let launched=false;
    try {
      await new Promise((resolve,reject)=>{
        const child=spawnProcess(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Date',date,'-OutputDirectory',dir],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],cwd:path.dirname(script)});
        active=child;launched=true;
        child.stdout?.setEncoding('utf8');child.stderr?.setEncoding('utf8');
        child.stdout?.on('data',chunk=>append(String(chunk),false));child.stderr?.on('data',chunk=>append(String(chunk),true));
        heartbeat=setInterval(()=>sendProgress(true),20000);heartbeat.unref?.();
        // Do not release the Excel lane or kill the watchdog/controller at this soft deadline.
        softTimer=setTimeout(()=>{progress.phase='cleanup';sendProgress();log('[혼소율] 18분 초과: 조회용 프로세스가 끝날 때까지 Excel 레인을 유지합니다.');},18*60000);softTimer.unref?.();
        child.once('error',error=>{if(!child.pid)launched=false;reject(error);});
        child.once('close',(code,signal)=>{if(active===child)active=null;closed=true;if(signal||code!==0)reject(new Error(`혼소율 조회 프로세스 종료 오류 (exit=${code}, signal=${signal||'none'})`));else resolve();});
      });
      await progressTask;
      const raw=JSON.parse(fs.readFileSync(path.join(dir,'pilot-report.json'),'utf8').replace(/^\uFEFF/,''));
      const result=contract.result({kind:'cofiring_live_result',schemaVersion:1,requestId:id,targetDate:date,report:raw},id,date);
      fs.writeFileSync(path.join(dir,'bridge-result.json'),JSON.stringify(result),'utf8');
      log(`[혼소율] ${date} 조회·정리 완료 · ${result.report.status} · 누락 ${result.report.noDataRows}개 · 서버 저장 대기`);
      return result;
    } catch(error) {
      let report=null;
      try{report=JSON.parse(fs.readFileSync(path.join(dir,'pilot-report.json'),'utf8').replace(/^\uFEFF/,''));}catch(_){}
      if(launched&&!(report?.cleanupVerified===true&&report?.processCleanupVerified===true&&report?.safeToStartNextDay===true&&Array.isArray(report.cleanupErrors)&&report.cleanupErrors.length===0)){
        fs.writeFileSync(blocked,JSON.stringify({requestId:id,targetDate:date,diagnosticDirectory:dir,at:new Date().toISOString(),message:'조회용 Excel 종료를 확인한 후에만 수동 해제하세요.'},null,2),'utf8');
      }
      throw new Error(error.message+' · 혼소율 진단 폴더: '+dir);
    } finally {
      clearTimeout(softTimer);clearInterval(heartbeat);closed=true;
      fs.writeFileSync(path.join(dir,'bridge-stdout.log'),stdout,'utf8');fs.writeFileSync(path.join(dir,'bridge-stderr.log'),stderr,'utf8');
    }
  };
}
const collectCofiringDailyValues=createCofiringCollector();

const COFIRING_PERIOD_REQUEST_TYPE=contract.PERIOD_TYPE;
const PERIOD_CONTROLLER_SHA256='588742e9730285bbaad71b588002db570fcdbfd98db08794593115ff3c75f40d';
const PERIOD_WORKER_SHA256='c0ecc7572b8d2704e23627eb9dad1bc97d2fa87ab2759ca57ae0a26944b01e35';
function periodRequestSpec(request) {
  const value=request?.result;
  if(value?.kind==='cofiring_period_request')return value;
  if(value?.kind==='cofiring_period_progress'&&value.request)return value.request;
  return null;
}
function createCofiringPeriodCollector(options={}) {
  const spawnProcess=options.spawnProcess||spawn,platform=options.platform||process.platform;
  const root=options.runsDirectory||runsDirectory,log=options.log||console.log;
  const controller=options.controllerPath||path.join(__dirname,'cofiring-period-v5','run-cofiring-period-v5.ps1');
  const worker=options.workerPath||path.join(__dirname,'cofiring-period-v5','cofiring-period-worker-v5.ps1');
  let active=null;
  return async function collect(config,request,callbacks={}) {
    const id=request?.id,spec0=periodRequestSpec(request),spec=contract.period(spec0||{});
    if(request?.requestType!==COFIRING_PERIOD_REQUEST_TYPE||request.status!=='processing'||!contract.uuid(id)||request.agentId!==config.agentId||!request.agentId||!Number.isFinite(Date.parse(request.startedAt))||Date.parse(request.expiresAt)-Date.now()<5*60000)throw new Error('혼소율 기간 요청 소유권 또는 남은 처리시간이 올바르지 않습니다.');
    if(platform!=='win32')throw new Error('혼소율 기간 DataPARC 조회는 회사 Windows PC에서 실행해야 합니다.');
    if(active||fs.existsSync(blockFile))throw new Error('이전 혼소율 조회의 Excel 정리가 확인되지 않았습니다. 추가 조회를 시작하지 않습니다.');
    for(const [file,expected] of [[controller,PERIOD_CONTROLLER_SHA256],[worker,PERIOD_WORKER_SHA256]]){
      if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)throw new Error('기간 조회 PowerShell 파일이 없거나 변경됐습니다. 설치 파일을 확인해 주세요.');
    }
    fs.mkdirSync(root,{recursive:true});
    const safeStart=spec.startLocal.replace(/[:T]/g,'-'),dir=fs.mkdtempSync(path.join(root,'period-'+safeStart+'-'));
    const progress={phase:'starting',completedTags:0};let progressTask=Promise.resolve(),closed=false,lastProgress='';
    function sendProgress(force=false){
      if(typeof callbacks.postProgress!=='function'||closed)return;
      const snapshot={...progress},signature=JSON.stringify(snapshot);
      if(!force&&signature===lastProgress)return;
      lastProgress=signature;
      progressTask=progressTask.then(()=>callbacks.postProgress(snapshot)).catch(e=>log('[혼소율 기간] 진행상태 전송 보류: '+String(e.message).slice(0,160)));
    }
    sendProgress();
    let stdout='',stderr='',carry='',heartbeat;
    const executable=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    let launched=false;
    try{
      await new Promise((resolve,reject)=>{
        const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',controller,'-Start',spec.startLocal,'-End',spec.endLocal,'-StepUnit',spec.stepUnit,'-StepValue',String(spec.stepValue),'-OutputDirectory',dir];
        const child=spawnProcess(executable,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],cwd:path.dirname(controller)});
        active=child;launched=true;child.stdout?.setEncoding('utf8');child.stderr?.setEncoding('utf8');
        const append=(text,isError)=>{
          if(isError){stderr=(stderr+text).slice(-2*1024*1024);return;}
          stdout=(stdout+text).slice(-2*1024*1024);carry+=text;
          const lines=carry.split(/\r?\n/);carry=lines.pop();
          for(const line of lines){
            if(!line.trim())continue;
            log('[혼소율 기간] '+line.slice(0,700));
            if(/고속 요약 계산 완료|FAST SUMMARY RESULT|PERIOD V5/i.test(line)){progress.phase='reading';progress.completedTags=10;}
            if(/Excel.*정리|cleanup/i.test(line))progress.phase='cleanup';
            sendProgress();
          }
        };
        child.stdout?.on('data',chunk=>append(String(chunk),false));child.stderr?.on('data',chunk=>append(String(chunk),true));
        heartbeat=setInterval(()=>sendProgress(true),20000);heartbeat.unref?.();
        child.once('error',error=>{if(!child.pid)launched=false;reject(error);});
        child.once('close',(code,signal)=>{if(active===child)active=null;closed=true;if(signal||code!==0)reject(new Error(`혼소율 기간 조회 프로세스 종료 오류 (exit=${code}, signal=${signal||'none'})`));else resolve();});
      });
      await progressTask;
      const report=JSON.parse(fs.readFileSync(path.join(dir,'period-report.json'),'utf8').replace(/^\uFEFF/,''));
      const raw={kind:'cofiring_period_live_result',schemaVersion:1,requestId:id,request:{startLocal:spec.startLocal,endLocal:spec.endLocal,stepUnit:spec.stepUnit,stepValue:spec.stepValue},report};
      const result=contract.periodResult(raw,id,spec);
      fs.writeFileSync(path.join(dir,'bridge-result.json'),JSON.stringify(result),'utf8');
      log(`[혼소율 기간] ${spec.startLocal} ~ ${spec.endLocal} 조회·정리 완료 · ${result.report.status} · 서버 저장 대기`);
      return result;
    }catch(error){
      let report=null;try{report=JSON.parse(fs.readFileSync(path.join(dir,'period-report.json'),'utf8').replace(/^\uFEFF/,''));}catch(_){}
      if(launched&&!(report?.cleanupVerified===true&&report?.processCleanupVerified===true&&Array.isArray(report.cleanupErrors)&&report.cleanupErrors.length===0)){
        fs.writeFileSync(blockFile,JSON.stringify({requestId:id,period:{startLocal:spec.startLocal,endLocal:spec.endLocal},diagnosticDirectory:dir,at:new Date().toISOString(),message:'기간 조회용 Excel 종료를 확인한 후에만 수동 해제하세요.'},null,2),'utf8');
      }
      throw new Error(error.message+' · 혼소율 기간 진단 폴더: '+dir);
    }finally{
      clearInterval(heartbeat);closed=true;
      fs.writeFileSync(path.join(dir,'bridge-stdout.log'),stdout,'utf8');
      fs.writeFileSync(path.join(dir,'bridge-stderr.log'),stderr,'utf8');
    }
  };
}
const collectCofiringPeriodValues=createCofiringPeriodCollector();
module.exports={COFIRING_REQUEST_TYPE,COFIRING_PERIOD_REQUEST_TYPE,READER_SHA256,PERIOD_CONTROLLER_SHA256,PERIOD_WORKER_SHA256,createCofiringCollector,createCofiringPeriodCollector,collectCofiringDailyValues,collectCofiringPeriodValues,isCofiringExcelBlocked};
