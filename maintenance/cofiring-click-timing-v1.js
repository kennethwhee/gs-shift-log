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
    function empty(){return {status:'idle',mode:'',period:null,startedAt:null,finishedAt:null,elapsedMs:0,phase:'',pendingRequest:false,expectedRequestId:null,previousRequestId:null,requestId:null,source:null,querySeconds:null,workerSeconds:null,controllerSeconds:null,reason:null};}
    function state(){return {...value,period:value.period?{...value.period}:null};}
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
        elapsed();clearWork();Object.assign(value,result,{status:'complete',finishedAt:stamp(),reason:null});token=null;emit();
      }));
      return true;
    }
    function fail(t,reason){if(!current(t))return false;return terminate('failed',reason||'calculation_failed');}
    function cancel(reason){if(disposed)return false;return terminate('cancelled',reason||'cancelled');}
    function dispose(){if(disposed)return;cancel('disposed');disposed=true;token=null;clearWork();}
    return {start,requireRequest,acceptRequest,phase,finish,fail,cancel,state,dispose};
  }
  const api={create};root.CofiringClickTimingV1=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
