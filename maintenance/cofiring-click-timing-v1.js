(function(root){
  'use strict';
  function create(options={}){
    const now=options.now||(()=>root.performance?.now?.()??Date.now());
    const utcNow=options.utcNow||(()=>new Date().toISOString());
    const setTimer=options.setTimeout||root.setTimeout?.bind(root);
    const clearTimer=options.clearTimeout||root.clearTimeout?.bind(root);
    const requestFrame=options.requestAnimationFrame||root.requestAnimationFrame?.bind(root);
    const cancelFrame=options.cancelAnimationFrame||root.cancelAnimationFrame?.bind(root);
    let sequence=0,token=null,disposed=false,startedMono=0,tick=null,frames=[],finishGuard=null;
    let value=empty();
    function empty(){return {status:'idle',mode:'',period:null,startedAt:null,finishedAt:null,elapsedMs:0,phase:'',pendingRequest:false,expectedRequestId:null,previousRequestId:null,requestId:null,source:null,querySeconds:null,workerSeconds:null,controllerSeconds:null,reason:null,marks:{},details:[]};}
    function state(){return {...value,period:value.period?{...value.period}:null,marks:{...value.marks},details:value.details.map(row=>({...row}))};}
    function emit(){if(!disposed){try{options.onChange?.(state());}catch(_){}}}
    function stamp(){try{const t=utcNow();return t instanceof Date?t.toISOString():String(t);}catch(_){return null;}}
    function time(){try{const n=Number(now());return Number.isFinite(n)?n:startedMono+value.elapsedMs;}catch(_){return startedMono+value.elapsedMs;}}
    function elapsed(){value.elapsedMs=Math.max(value.elapsedMs,0,time()-startedMono);}
    function id(v){return typeof v==='string'&&v.length>0&&v.length<=128?v:null;}
    function spec(p){if(!p||typeof p!=='object')return null;const out={};for(const k of ['startLocal','endLocal','stepUnit'])if(typeof p[k]==='string')out[k]=p[k];if(Number.isFinite(p.stepValue))out.stepValue=p.stepValue;return out;}
    function seconds(v){return typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;}
    function active(){return value.status==='running'||value.status==='finishing';}
    function matches(t){return !disposed&&t!==null&&t===token&&active();}
    function clearWork(){if(tick!==null){clearTimer?.(tick);tick=null;}for(const f of frames){if(f.kind==='frame')cancelFrame?.(f.handle);else clearTimer?.(f.handle);}frames=[];finishGuard=null;}
    function terminate(status,reason){if(!active())return false;elapsed();clearWork();value.status=status;value.reason=String(reason||status);value.finishedAt=stamp();value.pendingRequest=false;token=null;emit();return true;}
    function current(t){if(!matches(t))return false;let ok=true;try{ok=options.isCurrent?.(state())!==false;}catch(_){ok=false;}if(!ok){terminate('cancelled','context_changed');return false;}return true;}
    function scheduleTick(t){if(!setTimer||!matches(t))return;const handle=setTimer(()=>{if(tick!==handle||!matches(t))return;tick=null;if(!current(t))return;elapsed();emit();scheduleTick(t);},200);tick=handle;}
    function start(input={}){
      if(disposed)return null;
      if(active())terminate('cancelled','superseded');
      clearWork();token=++sequence;value=empty();
      value.status='running';value.mode=typeof input.mode==='string'?input.mode:'';value.period=spec(input.period);
      value.startedAt=stamp();value.previousRequestId=id(input.previousRequestId);value.expectedRequestId=id(input.activeRequestId);
      value.pendingRequest=!value.expectedRequestId&&['new_query','forced_requery'].includes(value.mode);
      startedMono=time();const startedToken=token;emit();
      if(current(startedToken))scheduleTick(startedToken);
      return startedToken;
    }
    function requireRequest(t){if(!current(t)||value.status!=='running')return false;value.pendingRequest=true;value.expectedRequestId=null;emit();return true;}
    function acceptRequest(t,requestId){const next=id(requestId);if(!next||!current(t)||value.status!=='running')return false;if(value.expectedRequestId&&value.expectedRequestId!==next)return false;value.expectedRequestId=next;value.pendingRequest=false;emit();return true;}
    function phase(t,label){if(!current(t))return false;value.phase=String(label||'');elapsed();emit();return true;}
    // Browser observations use one monotonic clock; they are not server timestamps.
    function mark(t,name,requestId){
      if(!current(t)||value.status!=='running'||!['request_start','request_accepted','processing_seen','complete_seen','result_received'].includes(name))return false;
      if(requestId&&value.expectedRequestId&&requestId!==value.expectedRequestId)return false;
      if(Object.hasOwn(value.marks,name))return false;
      elapsed();value.marks[name]=value.elapsedMs;return true;
    }
    function details(data){
      const rows=[],add=(label,n)=>{if(seconds(n)!==null)rows.push({label,seconds:n});};
      const delta=(a,b)=>seconds(a)!==null&&seconds(b)!==null&&b>=a?(b-a)/1000:null;
      const m=value.marks;
      if(data.source==='saved_recalculate')return rows;
      add('클릭 → 요청 확인',delta(0,m.request_accepted));
      add('요청 확인 → 실행 관측 (상태조회 포함)',delta(m.request_accepted,m.processing_seen));
      const saved=data.saved||{},requested=Date.parse(saved.requestedAt),started=Date.parse(saved.startedAt);
      if(Number.isFinite(requested)&&Number.isFinite(started)&&started>=requested&&started-requested<=3600000)add('서버 접수 → Agent 배정', (started-requested)/1000);
      const timing=data.reportTiming||{},stage=timing.agent?.workerStages||{};
      const phases=Array.isArray(timing.worker?.workerPhases)?timing.worker.workerPhases:[];
      const sums=name=>{const matches=phases.filter(p=>p?.name===name&&p.outcome==='complete'&&seconds(p.elapsedSeconds)!==null);return matches.length?matches.reduce((n,p)=>n+p.elapsedSeconds,0):null;};
      add('Excel 준비',seconds(stage.preparationSeconds));
      add('  Excel 연결 (준비에 포함)',sums('setupComAttach'));
      add('DataPARC 조회',data.querySeconds);
      add('Excel 종료·정리',seconds(stage.cleanupSeconds));
      if(seconds(stage.cleanupSeconds)===null){const names=['cleanupCloseQuit','cleanupComReleaseAndGc','cleanupExcelExit','cleanupHostExit','cleanupFinalUniverse'],values=names.map(sums);if(values.every(n=>n!==null))add('Excel 종료·정리',values.reduce((a,b)=>a+b,0));}
      add('  종료 호출',sums('cleanupCloseQuit'));add('  메모리 정리',sums('cleanupComReleaseAndGc'));add('  Excel 종료 확인',sums('cleanupExcelExit'));add('  Host 종료 확인',sums('cleanupHostExit'));add('  최종 프로세스 확인',sums('cleanupFinalUniverse'));
      add('진행상태 전송 마무리 (PC 처리에 포함)',seconds(timing.agent?.progressDrainSeconds));
      add('완료 관측 → 결과 수신',delta(m.complete_seen,m.result_received));
      add('결과 수신 → 화면 반영',delta(m.result_received,value.elapsedMs));
      if(data.source==='new_query'&&seconds(data.controllerSeconds)!==null&&value.elapsedMs/1000>=data.controllerSeconds)add('PC 실행 전후·통신·화면 처리 (잔여)',value.elapsedMs/1000-data.controllerSeconds);
      return rows;
    }
    function resultMatches(data){const actual=id(data?.requestId);if(value.pendingRequest)return false;if(value.expectedRequestId&&actual!==value.expectedRequestId)return false;if(value.mode==='forced_requery'&&value.previousRequestId&&actual===value.previousRequestId)return false;return true;}
    function guardPasses(guard){try{return typeof guard!=='function'||guard(state())!==false;}catch(_){return false;}}
    function nextFrame(t,callback){
      const ticket={kind:requestFrame?'frame':'timer',handle:null};frames.push(ticket);
      const run=()=>{frames=frames.filter(f=>f!==ticket);if(current(t))callback();};
      if(requestFrame)ticket.handle=requestFrame(run);
      else if(setTimer)ticket.handle=setTimer(run,0);
      else run();
    }
    function finish(t,data={},guardFn){
      if(!current(t)||value.status!=='running'||!resultMatches(data)||!guardPasses(guardFn))return false;
      const result={requestId:id(data.requestId),source:typeof data.source==='string'?data.source:null,querySeconds:seconds(data.querySeconds),workerSeconds:seconds(data.workerSeconds),controllerSeconds:seconds(data.controllerSeconds)};
      value.status='finishing';finishGuard=guardFn;elapsed();emit();
      // Two foreground animation opportunities approximate screen update. This
      // is not a measurement of the display's physical paint completion.
      nextFrame(t,()=>nextFrame(t,()=>{
        if(!resultMatches(result)||!guardPasses(finishGuard)){terminate('cancelled','context_changed');return;}
        elapsed();clearWork();Object.assign(value,result,{status:'complete',finishedAt:stamp(),reason:null,details:details(data)});token=null;emit();
      }));
      return true;
    }
    function fail(t,reason){if(!current(t))return false;return terminate('failed',reason||'calculation_failed');}
    function cancel(reason){if(disposed)return false;return terminate('cancelled',reason||'cancelled');}
    function dispose(){if(disposed)return;cancel('disposed');disposed=true;token=null;clearWork();}
    return {start,requireRequest,acceptRequest,phase,mark,finish,fail,cancel,state,dispose};
  }
  const api={create};root.CofiringClickTimingV1=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
