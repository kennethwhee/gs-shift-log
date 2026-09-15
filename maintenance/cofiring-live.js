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
    let selected=null,identity='',rejectedAuthKey='',generation=0,timer=null,disposed=false,loading=null,paused=false;
    const periods=new Map(),activeStatuses=['pending','processing'],allStatuses=[...activeStatuses,'complete','failed'];
    const maxStatusFailures=3,maxStatusPolls=900;
    function auth(){let h={};try{h=options.getHeaders?.()||{};}catch(_){}return {headers:h,key:String(h.Authorization||h.authorization||'')};}
    function syncAuth(){const a=auth();if(a.key!==identity){identity=a.key;rejectedAuthKey='';generation++;periods.clear();loading=null;clearTimer?.(timer);timer=null;}return a;}
    function key(){return selected?contract.periodKey(selected):'';}
    function entry(){const k=key();if(!k)return null;if(!periods.has(k))periods.set(k,{saved:null,result:null,active:null,lastAttempt:null,loading:false,submitting:false,error:'',clientRequestId:null,statusFailures:0,statusPolls:0,statusStopped:false});return periods.get(k);}
    function eligible(){try{if(!selected)return false;contract.period(selected);return true;}catch(_){return false;}}
    function state(){const a=syncAuth(),authOk=!!a.key&&a.key!==rejectedAuthKey;return {period:selected,authenticated:authOk,canQuery:authOk&&options.canQuery?.()===true&&eligible(),eligible:eligible(),item:entry()};}
    function notify(){if(!disposed)options.onChange?.(state());}
    function current(g,k,authKey){return !disposed&&generation===g&&key()===k&&auth().key===authKey;}
    function schedule(){
      clearTimer?.(timer);timer=null;
      const d=entry(),a=auth();
      if(!disposed&&!paused&&a.key&&a.key!==rejectedAuthKey&&d?.active&&!d.statusStopped&&options.isVisible?.()!==false&&setTimer){
        timer=setTimer(()=>{timer=null;return pollActive();},d.statusFailures?2000:1000);
      }
    }
    async function request(url,init){
      const ctrl=typeof AbortController!=='undefined'?new AbortController():null;
      const timeout=setTimer?.(()=>ctrl?.abort(),20000);
      try{
        const response=await fetcher(url,{cache:'no-store',credentials:'same-origin',...init,...(ctrl?{signal:ctrl.signal}:{})});
        if(response.status===401){const error=new Error('로그인 세션이 만료됐습니다. 다시 로그인해 주세요.');error.code='AUTH_EXPIRED';throw error;}
        let data;try{data=await response.json();}catch(_){throw new Error('서버 응답을 읽지 못했습니다. 웹 배포 완료 여부를 확인해 주세요.');}
        if(!response.ok||data?.ok!==true){const message=data?.message||'혼소율 기간 요청을 완료하지 못했습니다.',error=new Error(message);if(/세션.*만료|다시 로그인/.test(message))error.code='AUTH_EXPIRED';throw error;}
        return data;
      }finally{clearTimer?.(timeout);}
    }
    function rejectAuth(a,d){rejectedAuthKey=a.key;d.active=null;d.clientRequestId=null;d.statusStopped=true;clearTimer?.(timer);timer=null;}
    function errorText(e){return e.name==='AbortError'?'상태 확인 시간이 초과됐습니다. 진행 중인 회사 PC 조회를 다시 시작하지 않습니다.':e.message;}
    function select(spec){syncAuth();const next=contract.period(spec,Number.MAX_SAFE_INTEGER),nextKey=contract.periodKey(next);if(nextKey!==key()){selected={startLocal:next.startLocal,endLocal:next.endLocal,stepUnit:next.stepUnit,stepValue:next.stepValue};generation++;loading=null;clearTimer?.(timer);timer=null;while(periods.size>4)periods.delete(periods.keys().next().value);}notify();}
    // Full period reads remain authoritative for saved results. Status polling
    // only follows the exact accepted request; it never submits a replacement.
    async function load({force=false,terminal=null}={}){
      const a=syncAuth();if(!a.key||a.key===rejectedAuthKey||disposed||!selected)return false;
      let p;try{p=contract.period(selected);}catch(_){notify();return false;}
      if(loading)return loading;
      const k=key(),g=generation,d=entry();
      if(!terminal){paused=false;d.statusStopped=false;d.statusFailures=0;d.statusPolls=0;}
      clearTimer?.(timer);timer=null;d.loading=true;d.error='';notify();
      const task=(async()=>{
        try{
          const q=new URLSearchParams({action:'cofiring_period',start:p.startLocal,end:p.endLocal,stepUnit:p.stepUnit,stepValue:String(p.stepValue)});
          if(d.saved&&d.result)q.set('knownResultId',d.saved.id);
          const data=await request(api+'?'+q.toString(),{headers:a.headers});if(!current(g,k,a.key))return false;
          if(data.bridgeVersion!==2||data.periodKey!==k)throw new Error('기간 조회 응답 범위 또는 연결 버전이 다릅니다.');
          for(const item of [data.saved,data.active,data.lastAttempt])if(item&&(!contract.uuid(item.id)||item.requestType!=='cofiring_period'||!allStatuses.includes(item.status)))throw new Error('기간 요청 상태 정보가 다릅니다.');
          if(data.saved&&data.saved.status!=='complete'||data.active&&!activeStatuses.includes(data.active.status))throw new Error('기간 저장 또는 진행 상태가 다릅니다.');
          if(terminal&&(data.active?.id===terminal.id||terminal.status==='complete'&&data.saved?.id!==terminal.id||terminal.status==='failed'&&(data.lastAttempt?.id!==terminal.id||data.lastAttempt.status!=='failed')))throw new Error('이번 요청의 완료 결과를 확인하지 못했습니다. 자동 확인을 멈췄습니다.');
          let result=d.result;
          if(data.saved){if(data.result)result=contract.periodResult(data.result,data.saved.id,p);else if(!d.result||d.saved?.id!==data.saved.id)throw new Error('기간 저장 결과 본문을 확인하지 못했습니다.');}
          else{if(data.result)throw new Error('저장 요청 없이 기간 결과가 반환됐습니다.');result=null;}
          d.saved=data.saved||null;d.result=result;d.active=data.active||null;d.lastAttempt=data.lastAttempt||null;d.error='';
          if(result&&terminal?.status!=='failed')options.onResult?.(result,d.saved);
          return true;
        }catch(e){if(current(g,k,a.key)){if(e.code==='AUTH_EXPIRED')rejectAuth(a,d);if(terminal)d.statusStopped=true;d.error=errorText(e);}return false;}
        finally{if(current(g,k,a.key)){d.loading=false;loading=null;notify();schedule();}}
      })();loading=task;return task;
    }
    function validateStatus(data,id,p){
      if(!Array.isArray(data.requestedIds)||data.requestedIds.length!==1||data.requestedIds[0]!==id||!Array.isArray(data.missingIds)||data.missingIds.length||!Array.isArray(data.items)||data.items.length!==1)throw new Error('이번 요청의 상태 응답이 누락되거나 일치하지 않습니다.');
      const item=data.items[0];
      if(item?.id!==id||!contract.uuid(item.id)||item.requestType!=='cofiring_period'||item.targetDate!==p.targetDate||!allStatuses.includes(item.status))throw new Error('이번 혼소율 요청의 상태 정보가 다릅니다.');
      const raw=item.result;
      const spec=raw?.kind==='cofiring_period_request'?raw:['cofiring_period_progress','cofiring_period_live_result'].includes(raw?.kind)?raw.request:null;
      if(!spec||contract.periodKey(spec)!==contract.periodKey(p)||raw.schemaVersion!==1)throw new Error('이번 혼소율 요청의 조회 범위가 다릅니다.');
      let progress=null;
      if(raw.kind==='cofiring_period_progress'){
        if(!['starting','reading','cleanup','uploading'].includes(raw.phase)||!Number.isInteger(raw.completedTags)||raw.completedTags<0||raw.completedTags>10)throw new Error('혼소율 진행정보가 올바르지 않습니다.');
        progress={phase:raw.phase,completedTags:raw.completedTags,updatedAt:raw.updatedAt};
      }
      if(item.status==='complete'&&(raw.kind!=='cofiring_period_live_result'||raw.requestId!==id))throw new Error('이번 요청의 완료 결과 식별자가 다릅니다.');
      // The result itself is validated by the final authoritative period read.
      return {...item,result:undefined,progress};
    }
    async function pollActive(){
      const a=syncAuth(),d=entry();
      if(disposed||paused||!a.key||a.key===rejectedAuthKey||!d?.active||d.statusStopped||options.isVisible?.()===false)return false;
      if(loading)return loading;
      let p;try{p=contract.period(selected);}catch(_){return false;}
      const id=d.active.id,k=key(),g=generation;
      if(!contract.uuid(id)||++d.statusPolls>maxStatusPolls){d.statusStopped=true;d.error='자동 상태 확인 한도에 도달했습니다. 계산하기로 저장 상태를 다시 확인해 주세요.';notify();return false;}
      d.loading=true;notify();let terminal=null;
      const task=(async()=>{
        try{
          const q=new URLSearchParams({action:'status_batch',ids:id});
          const data=await request(api+'?'+q.toString(),{headers:a.headers});
          if(!current(g,k,a.key)||d.active?.id!==id)return false;
          const item=validateStatus(data,id,p);d.statusFailures=0;d.error='';
          if(activeStatuses.includes(item.status)){d.active=item;d.lastAttempt=item;return true;}
          terminal={id,status:item.status};
          return true;
        }catch(e){
          if(current(g,k,a.key)&&d.active?.id===id){
            if(e.code==='AUTH_EXPIRED')rejectAuth(a,d);
            d.statusFailures+=1;if(d.statusFailures>=maxStatusFailures)d.statusStopped=true;
            d.error=errorText(e)+(d.statusStopped&&e.code!=='AUTH_EXPIRED'?' 자동 확인을 멈췄습니다. 계산하기로 저장 상태를 다시 확인해 주세요.':'');
          }
          return false;
        }finally{
          if(current(g,k,a.key)){
            d.loading=false;loading=null;
            if(terminal&&!paused&&options.isVisible?.()!==false){
              // Keep the accepted ID until its final range read succeeds. A stale
              // saved value or failed final read cannot finish this measurement.
              d.statusStopped=true;
              await load({force:true,terminal});
            }else{notify();schedule();}
          }
        }
      })();loading=task;return task;
    }
    async function query({explicit=false,force=false}={}){
      const a=syncAuth(),s=state();if(disposed||!explicit||!s.canQuery||!selected)return false;
      const p=contract.period(selected),k=key(),g=generation,d=entry();
      if(d.submitting||d.active||d.loading)return false;
      if(d.saved&&!force)return load({force:true});
      if(!d.clientRequestId)d.clientRequestId=typeof root.crypto?.randomUUID==='function'?root.crypto.randomUUID():options.makeId?.();
      if(!contract.uuid(d.clientRequestId)){d.error='안전한 기간 조회 요청 ID를 만들 수 없습니다.';notify();return false;}
      paused=false;d.statusStopped=false;d.statusFailures=0;d.statusPolls=0;d.submitting=true;d.error='';notify();
      try{
        const data=await request(api,{method:'POST',headers:{...a.headers,'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},body:JSON.stringify({action:'create',requestType:'cofiring_period',start:p.startLocal,end:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue,forceRefresh:force,clientRequestId:d.clientRequestId,expectedResultId:d.saved?.id||null})});
        if(!current(g,k,a.key))return false;
        if(data.periodKey!==k||data.item?.requestType!=='cofiring_period'||!contract.uuid(data.item?.id)||!allStatuses.includes(data.item.status))throw new Error('기간 조회 요청 확인 응답이 다릅니다.');
        d.clientRequestId=null;d.active=activeStatuses.includes(data.item.status)?data.item:null;d.lastAttempt=data.item;
        return await load({force:true});
      }catch(e){if(current(g,k,a.key)){if(e.code==='AUTH_EXPIRED')rejectAuth(a,d);d.error=errorText(e);}return false;}
      finally{if(current(g,k,a.key)){d.submitting=false;notify();schedule();}}
    }
    function pause(){paused=true;clearTimer?.(timer);timer=null;}
    function dispose(){disposed=true;generation++;pause();periods.clear();}
    return {state,select,load,query,pause,dispose};
  }
  root.CofiringLive={create,createPeriod};if(typeof module==='object'&&module.exports)module.exports=root.CofiringLive;
})(typeof globalThis==='object'?globalThis:this);
