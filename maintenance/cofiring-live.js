(function(root){
  'use strict';
  function create(options={}) {
    const contract=root.CofiringLiveContract||(typeof require==='function'?require('./cofiring-live-contract.js'):null);
    if(!contract)throw new Error('혼소율 조회 계약 모듈이 없습니다.');
    const fetcher=options.fetch||((...args)=>root.fetch(...args));
    const api=options.api||'/api/ois-data-requests',clock=options.now||Date.now;
    const setTimer=options.setTimeout||root.setTimeout?.bind(root),clearTimer=options.clearTimeout||root.clearTimeout?.bind(root);
    let targetDate='',identity='',generation=0,timer=null,disposed=false,loading=null;
    const days=new Map();
    const entry=()=>{if(!days.has(targetDate))days.set(targetDate,{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:'',clientRequestId:null});return days.get(targetDate);};
    function auth(){let h={};try{h=options.getHeaders?.()||{};}catch(_){}return {headers:h,key:String(h.Authorization||h.authorization||'')};}
    function syncAuth(){const a=auth();if(a.key!==identity){identity=a.key;generation++;days.clear();loading=null;clearTimer?.(timer);timer=null;}return a;}
    function eligible(){try{contract.completedDay(targetDate,clock());return true;}catch(_){return false;}}
    function state(){const a=syncAuth();return {targetDate,authenticated:!!a.key,canQuery:!!a.key&&options.canQuery?.()===true&&eligible(),eligible:eligible(),day:days.get(targetDate)||null};}
    function notify(){if(!disposed)options.onChange?.(state());}
    function current(g,date,key){return !disposed&&generation===g&&targetDate===date&&auth().key===key;}
    function schedule(){clearTimer?.(timer);timer=null;if(!disposed&&entry().active&&options.isVisible?.()!==false&&setTimer)timer=setTimer(()=>{timer=null;load({force:true});},5000);}
    async function request(url,init) {
      const ctrl=typeof AbortController!=='undefined'?new AbortController():null;
      const timeout=setTimer?.(()=>ctrl?.abort(),20000);
      try{const response=await fetcher(url,{cache:'no-store',credentials:'same-origin',...init,...(ctrl?{signal:ctrl.signal}:{})});
        let data;try{data=await response.json();}catch(_){throw new Error('서버 응답을 읽지 못했습니다. 웹 배포 완료 여부를 확인해 주세요.');}
        if(!response.ok||data?.ok!==true)throw new Error(data?.message||'혼소율 서버 요청을 완료하지 못했습니다.');return data;
      }finally{clearTimer?.(timeout);}
    }
    function select(date){syncAuth();if(date!==targetDate){targetDate=date;generation++;loading=null;clearTimer?.(timer);timer=null;
      // Bound raw-result memory; no browser localStorage is used for plant data.
      while(days.size>2)days.delete(days.keys().next().value);
    }notify();}
    async function load({force=false}={}) {
      const a=syncAuth();if(!a.key||disposed)return false;
      try{contract.day(targetDate);}catch(_){notify();return false;}
      if(loading)return loading;
      const date=targetDate,g=generation,d=entry();d.loading=true;d.error='';notify();
      const task=(async()=>{
        try{
          const url=api+'?action=cofiring_daily&targetDate='+encodeURIComponent(date)+(d.saved&&d.result?'&knownResultId='+encodeURIComponent(d.saved.id):'');
          const data=await request(url,{headers:a.headers});if(!current(g,date,a.key))return false;
          if(data.bridgeVersion!==1||data.targetDate!==date)throw new Error('응답 날짜 또는 연결 버전이 다릅니다.');
          for(const item of [data.saved,data.active,data.lastAttempt])if(item&&(!contract.uuid(item.id)||item.targetDate!==date||item.requestType!=='cofiring_daily'||!['pending','processing','complete','failed'].includes(item.status)))throw new Error('응답 요청 정보가 다릅니다.');
          if(data.saved&&data.saved.status!=='complete'||data.active&&!['pending','processing'].includes(data.active.status))throw new Error('저장 또는 진행 상태가 다릅니다.');
          let result=d.result;
          if(data.saved){
            if(data.result)result=contract.result(data.result,data.saved.id,date);
            else if(!d.result||d.saved?.id!==data.saved.id)throw new Error('저장 결과 본문을 확인하지 못했습니다.');
          }else{if(data.result)throw new Error('저장 요청 없이 결과가 반환됐습니다.');result=null;}
          d.saved=data.saved||null;d.result=result;d.active=data.active||null;d.lastAttempt=data.lastAttempt||null;d.error='';
          if(result)options.onResult?.(result,d.saved);
          return true;
        }catch(e){if(current(g,date,a.key))d.error=e.name==='AbortError'?'상태 확인 시간이 초과됐습니다. 진행 중인 회사 PC 조회를 다시 시작하지 않습니다.':e.message;return false;}
        finally{if(current(g,date,a.key)){d.loading=false;loading=null;notify();schedule();}}
      })();loading=task;return task;
    }
    async function query({explicit=false,force=false}={}) {
      const a=syncAuth(),s=state();if(disposed||!explicit||!s.canQuery)return false;
      const date=targetDate,g=generation,d=entry();
      if(d.submitting||d.active||d.loading)return false;
      if(d.saved&&!force)return load({force:true});
      if(!d.clientRequestId)d.clientRequestId=typeof root.crypto?.randomUUID==='function'?root.crypto.randomUUID():options.makeId?.();
      if(!contract.uuid(d.clientRequestId)){d.error='안전한 조회 요청 ID를 만들 수 없습니다. HTTPS 업무일지에서 사용해 주세요.';notify();return false;}
      d.submitting=true;d.error='';notify();
      try{
        const data=await request(api,{method:'POST',headers:{...a.headers,'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},body:JSON.stringify({action:'create',requestType:'cofiring_daily',targetDate:date,forceRefresh:force,clientRequestId:d.clientRequestId,expectedResultId:d.saved?.id||null})});
        if(!current(g,date,a.key))return false;
        if(data.targetDate!==date||data.item?.targetDate!==date||data.item?.requestType!=='cofiring_daily'||!contract.uuid(data.item?.id))throw new Error('조회 요청 확인 응답이 다릅니다.');
        d.clientRequestId=null;d.active=['pending','processing'].includes(data.item.status)?data.item:null;d.lastAttempt=data.item;return await load({force:true});
      }catch(e){if(current(g,date,a.key))d.error=e.message;return false;}
      finally{if(current(g,date,a.key)){d.submitting=false;notify();schedule();}}
    }
    function pause(){clearTimer?.(timer);timer=null;}
    function dispose(){disposed=true;generation++;pause();days.clear();}
    return {state,select,load,query,pause,dispose};
  }

  function createPeriod(options={}) {
    const contract=root.CofiringLiveContract||(typeof require==='function'?require('./cofiring-live-contract.js'):null);
    if(!contract)throw new Error('혼소율 조회 계약 모듈이 없습니다.');
    const fetcher=options.fetch||((...args)=>root.fetch(...args)),api=options.api||'/api/ois-data-requests';
    const setTimer=options.setTimeout||root.setTimeout?.bind(root),clearTimer=options.clearTimeout||root.clearTimeout?.bind(root);
    let selected=null,identity='',rejectedAuthKey='',generation=0,timer=null,disposed=false,loading=null;
    const periods=new Map();
    function auth(){let h={};try{h=options.getHeaders?.()||{};}catch(_){}return {headers:h,key:String(h.Authorization||h.authorization||'')};}
    function syncAuth(){const a=auth();if(a.key!==identity){identity=a.key;rejectedAuthKey='';generation++;periods.clear();loading=null;clearTimer?.(timer);timer=null;}return a;}
    function normalized(){return selected?contract.period(selected):null;}
    function key(){return selected?contract.periodKey(selected):'';}
    function entry(){const k=key();if(!k)return null;if(!periods.has(k))periods.set(k,{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:'',clientRequestId:null});return periods.get(k);}
    function eligible(){try{if(!selected)return false;contract.period(selected);return true;}catch(_){return false;}}
    function state(){const a=syncAuth(),authOk=!!a.key&&a.key!==rejectedAuthKey;return {period:selected,authenticated:authOk,canQuery:authOk&&options.canQuery?.()===true&&eligible(),eligible:eligible(),item:entry()};}
    function notify(){if(!disposed)options.onChange?.(state());}
    function current(g,k,authKey){return !disposed&&generation===g&&key()===k&&auth().key===authKey;}
    function schedule(){clearTimer?.(timer);timer=null;const d=entry(),a=auth();if(!disposed&&a.key&&a.key!==rejectedAuthKey&&d?.active&&options.isVisible?.()!==false&&setTimer)timer=setTimer(()=>{timer=null;load({force:true});},1000);}
    async function request(url,init){const ctrl=typeof AbortController!=='undefined'?new AbortController():null;const timeout=setTimer?.(()=>ctrl?.abort(),20000);try{const response=await fetcher(url,{cache:'no-store',credentials:'same-origin',...init,...(ctrl?{signal:ctrl.signal}:{})});let data;try{data=await response.json();}catch(_){throw new Error('서버 응답을 읽지 못했습니다. 웹 배포 완료 여부를 확인해 주세요.');}if(!response.ok||data?.ok!==true){const message=data?.message||'혼소율 기간 요청을 완료하지 못했습니다.',error=new Error(message);if(response.status===401||/세션.*만료|다시 로그인/.test(message))error.code='AUTH_EXPIRED';throw error;}return data;}finally{clearTimer?.(timeout);}}
    function select(spec){syncAuth();const next=contract.period(spec);const nextKey=contract.periodKey(next);if(nextKey!==key()){selected={startLocal:next.startLocal,endLocal:next.endLocal,stepUnit:next.stepUnit,stepValue:next.stepValue};generation++;loading=null;clearTimer?.(timer);timer=null;while(periods.size>4)periods.delete(periods.keys().next().value);}notify();}
    async function load({force=false}={}){const a=syncAuth();if(!a.key||disposed||!selected)return false;let p;try{p=contract.period(selected);}catch(_){notify();return false;}if(loading)return loading;const k=key(),g=generation,d=entry();d.loading=true;d.error='';notify();const task=(async()=>{try{const q=new URLSearchParams({action:'cofiring_period',start:p.startLocal,end:p.endLocal,stepUnit:p.stepUnit,stepValue:String(p.stepValue)});if(d.saved&&d.result)q.set('knownResultId',d.saved.id);const data=await request(api+'?'+q.toString(),{headers:a.headers});if(!current(g,k,a.key))return false;if(data.bridgeVersion!==2||data.periodKey!==k)throw new Error('기간 조회 응답 범위 또는 연결 버전이 다릅니다.');for(const item of [data.saved,data.active,data.lastAttempt])if(item&&(!contract.uuid(item.id)||item.requestType!=='cofiring_period'||!['pending','processing','complete','failed'].includes(item.status)))throw new Error('기간 요청 상태 정보가 다릅니다.');let result=d.result;if(data.saved){if(data.result)result=contract.periodResult(data.result,data.saved.id,p);else if(!d.result||d.saved?.id!==data.saved.id)throw new Error('기간 저장 결과 본문을 확인하지 못했습니다.');}else{if(data.result)throw new Error('저장 요청 없이 기간 결과가 반환됐습니다.');result=null;}d.saved=data.saved||null;d.result=result;d.active=data.active||null;d.lastAttempt=data.lastAttempt||null;d.error='';if(rejectedAuthKey===a.key)rejectedAuthKey='';if(result)options.onResult?.(result,d.saved);return true;}catch(e){if(current(g,k,a.key)){if(e.code==='AUTH_EXPIRED'){rejectedAuthKey=a.key;d.active=null;d.clientRequestId=null;clearTimer?.(timer);timer=null;}d.error=e.name==='AbortError'?'상태 확인 시간이 초과됐습니다. 진행 중인 회사 PC 조회를 다시 시작하지 않습니다.':e.message;}return false;}finally{if(current(g,k,a.key)){d.loading=false;loading=null;notify();schedule();}}})();loading=task;return task;}
    async function query({explicit=false,force=false}={}){const a=syncAuth(),s=state();if(disposed||!explicit||!s.canQuery||!selected)return false;const p=contract.period(selected),k=key(),g=generation,d=entry();if(d.submitting||d.active||d.loading)return false;if(d.saved&&!force)return load({force:true});if(!d.clientRequestId)d.clientRequestId=typeof root.crypto?.randomUUID==='function'?root.crypto.randomUUID():options.makeId?.();if(!contract.uuid(d.clientRequestId)){d.error='안전한 기간 조회 요청 ID를 만들 수 없습니다.';notify();return false;}d.submitting=true;d.error='';notify();try{const data=await request(api,{method:'POST',headers:{...a.headers,'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},body:JSON.stringify({action:'create',requestType:'cofiring_period',start:p.startLocal,end:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue,forceRefresh:force,clientRequestId:d.clientRequestId,expectedResultId:d.saved?.id||null})});if(!current(g,k,a.key))return false;if(data.periodKey!==k||data.item?.requestType!=='cofiring_period'||!contract.uuid(data.item?.id))throw new Error('기간 조회 요청 확인 응답이 다릅니다.');d.clientRequestId=null;d.active=['pending','processing'].includes(data.item.status)?data.item:null;d.lastAttempt=data.item;if(rejectedAuthKey===a.key)rejectedAuthKey='';return await load({force:true});}catch(e){if(current(g,k,a.key)){if(e.code==='AUTH_EXPIRED'){rejectedAuthKey=a.key;d.active=null;d.clientRequestId=null;clearTimer?.(timer);timer=null;}d.error=e.message;}return false;}finally{if(current(g,k,a.key)){d.submitting=false;notify();schedule();}}}
    function pause(){clearTimer?.(timer);timer=null;}
    function dispose(){disposed=true;generation++;pause();periods.clear();}
    return {state,select,load,query,pause,dispose};
  }
  root.CofiringLive={create,createPeriod};if(typeof module==='object'&&module.exports)module.exports=root.CofiringLive;
})(typeof globalThis==='object'?globalThis:this);
