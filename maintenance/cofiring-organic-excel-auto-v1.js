(function(root){
  'use strict';
  if(root.__cofiringOrganicExcelAutoV1Installed)return;
  root.__cofiringOrganicExcelAutoV1Installed=true;

  const API='/api/ois-data-requests';
  const REQUEST_TYPE='daily_data_excel';
  const POLL_MS=5000;
  const MAX_WAIT_MS=180000;
  const containers=new WeakMap();

  function authHeaders(extra={}){
    return typeof root.getShiftLogAuthHeaders==='function'
      ? root.getShiftLogAuthHeaders(extra)
      : {Accept:'application/json',...extra};
  }
  async function jsonResponse(response,fallback){
    const text=await response.text();let data={};
    if(text.trim()){
      try{data=JSON.parse(text);}
      catch(_){throw new Error('일일DATA 자동입력 서버 응답 형식이 올바르지 않습니다.');}
    }
    if(!response.ok||data?.ok===false)throw new Error(data?.message||data?.error||fallback||('HTTP '+response.status));
    return data;
  }
  function sleep(ms){return new Promise(resolve=>root.setTimeout(resolve,ms));}
  function roundInput(value){
    const n=Number(value);
    if(!Number.isFinite(n)||n<0)return null;
    return String(Math.round((n+Number.EPSILON)*1000)/1000);
  }
  // COFIRING_ORGANIC_CURRENT_SELECTORS_V4
function queryMode(container){
    return container.querySelector('[data-cfv8-mode]')?.value==='period'?'period':'daily';
  }
  function selectedDate(container){
    if(queryMode(container)==='daily'){
      const date=String(container.querySelector('[data-cfv7-date]')?.value||'');
      return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
    }
    const start=String(container.querySelector('[data-cfv8-start]')?.value||'');
    return /^\d{4}-\d{2}-\d{2}T/.test(start)?start.slice(0,10):'';
  }
  function dailyStart(container){
    if(queryMode(container)==='daily')return true;
    return /T00:00$/.test(String(container.querySelector('[data-cfv8-start]')?.value||''));
  }
  function ensureStatus(container){
    let el=container.querySelector('[data-cfv5-organic-excel-state]');
    if(el)return el;
    const head=container.querySelector('.cfv52-manual-head>div:first-child');
    if(!head)return null;
    el=root.document.createElement('span');
    el.setAttribute('data-cfv5-organic-excel-state','');
    el.style.cssText='display:inline-flex;align-items:center;margin-left:7px;color:#667f8f;font-size:10px;font-weight:650;line-height:1.4;';
    el.textContent='일일DATA 자동입력 대기';
    head.appendChild(el);
    return el;
  }
  function stateText(container,text,tone=''){
    const el=ensureStatus(container);if(!el)return;
    el.textContent=text;el.dataset.tone=tone;
    el.style.color=tone==='error'?'#b54a4a':tone==='success'?'#24745f':tone==='working'?'#3f7195':'#667f8f';
  }
  async function createRequest(date,forceRefresh){
    const response=await root.fetch(API,{
      method:'POST',
      headers:authHeaders({'Content-Type':'application/json'}),
      cache:'no-store',credentials:'same-origin',
      body:JSON.stringify({requestType:REQUEST_TYPE,targetDate:date,forceRefresh:forceRefresh===true})
    });
    return jsonResponse(response,'일일DATA Excel 조회 요청을 만들지 못했습니다.');
  }
  async function getRequest(id){
    const u=new URL(API,root.location.origin);
    u.searchParams.set('id',id);u.searchParams.set('_',String(Date.now()));
    const response=await root.fetch(u.toString(),{
      method:'GET',headers:authHeaders(),cache:'no-store',credentials:'same-origin'
    });
    return jsonResponse(response,'일일DATA Excel 조회 상태를 확인하지 못했습니다.');
  }
  function validateResult(item,date){
    if(!item||item.status!=='complete'||!item.result||typeof item.result!=='object')return null;
    const r=item.result;
    if(String(r.targetDate||r.sourceDate||item.targetDate||'')!==date)return null;
    const one=roundInput(r.organicUsageUnitOne),two=roundInput(r.organicUsageUnitTwo);
    return {one,two};
  }
  function bind(container){
    if(!container||containers.has(container))return;
    const query=container.querySelector('[data-cfv5-query]');
    const requery=container.querySelector('[data-cfv5-requery]');
    const one=container.querySelector('[data-cfv5-manual="unit1:organic"]');
    const two=container.querySelector('[data-cfv5-manual="unit2:organic"]');
    if(!query||!one||!two)return;

    const state={generation:0,userEditSeq:0,armSeq:0,pendingArm:null};
    containers.set(container,state);ensureStatus(container);

    for(const input of [one,two]){
      input.addEventListener('input',event=>{if(event.isTrusted)state.userEditSeq+=1;},true);
    }

    async function refresh({force=true,expectedEditSeq=null}={}){
      const generation=++state.generation,editSeq=expectedEditSeq==null?state.userEditSeq:expectedEditSeq,date=selectedDate(container);
      if(!date)return;
      if(!dailyStart(container)){
        stateText(container,'일일DATA 자동입력은 00:00 시작 일별 계산에서만 사용','');
        return;
      }

      stateText(container,'일일DATA 유기성 자동입력 요청 중…','working');
      try{
        const created=await createRequest(date,force);
        let item=created?.item||null;
        if(!item?.id)throw new Error('일일DATA Excel 요청 ID가 없습니다.');

        const deadline=Date.now()+MAX_WAIT_MS;
        while(item&&item.status!=='complete'&&item.status!=='failed'){
          if(generation!==state.generation||selectedDate(container)!==date)return;
          if(Date.now()>=deadline)throw new Error('일일DATA 유기성 자동입력 대기 시간이 초과됐습니다.');
          stateText(container,'일일DATA 유기성 자동입력 · '+(item.status==='processing'?'Excel 읽는 중':'회사 PC Agent 대기'),'working');
          await sleep(POLL_MS);
          item=(await getRequest(item.id))?.item||null;
        }

        if(generation!==state.generation||selectedDate(container)!==date)return;
        if(!item)throw new Error('일일DATA Excel 조회 결과가 없습니다.');
        if(item.status==='failed')throw new Error(item.errorMessage||item.error||'일일DATA Excel 조회가 실패했습니다.');

        const values=validateResult(item,date);
        if(!values)throw new Error('일일DATA Excel 결과 날짜 또는 형식을 확인해 주세요.');
        if(values.one===null&&values.two===null){
          stateText(container,'일일DATA 유기성 값이 비어 있어 기존 입력을 유지합니다.','error');
          return;
        }
        if(state.userEditSeq!==editSeq){
          stateText(container,'일일DATA 값 확보 · 조회 중 사용자가 수정하여 기존 입력 유지','');
          return;
        }

        if(values.one!==null)one.value=values.one;
        if(values.two!==null)two.value=values.two;
        if(values.one!==null)one.dispatchEvent(new Event('input',{bubbles:true}));
        if(values.two!==null)two.dispatchEvent(new Event('input',{bubbles:true}));

        stateText(
          container,
          '일일DATA 자동입력 · 1호기 '+(values.one===null?'빈칸':values.one+'t')+
          ' · 2호기 '+(values.two===null?'빈칸':values.two+'t')+' · 저장 전',
          'success'
        );
      }catch(error){
        if(generation!==state.generation)return;
        stateText(container,'일일DATA 자동입력 실패 · '+String(error?.message||error),'error');
      }
    }

    // COFIRING_ORGANIC_AFTER_HOST_SUCCESS_V1_R1
    // Do NOT start daily_data_excel in parallel with the host DataPARC job.
    // Both use the Agent's Excel lane. Arm on click, then start only after
    // the host calculation actually reaches its success status.
    const hostStatus=container.querySelector('[data-cfv5-status]');
    function armAfterHostCalculation(){
      const date=selectedDate(container);
      if(!date)return;
      if(!dailyStart(container)){
        state.pendingArm=null;
        stateText(container,'일일DATA 자동입력은 00:00 시작 일별 계산에서만 사용','');
        return;
      }
      state.pendingArm={
        id:++state.armSeq,
        date,
        editSeq:state.userEditSeq
      };
      stateText(container,'혼소율 계산 완료 후 일일DATA 유기성 자동입력 예정','');
    }
    function handleHostStatusMutation(){
      const arm=state.pendingArm;
      if(!arm||!hostStatus)return;
      if(selectedDate(container)!==arm.date){
        state.pendingArm=null;
        return;
      }
      const tone=String(hostStatus.dataset.tone||'');
      if(tone==='error'){
        state.pendingArm=null;
        stateText(container,'혼소율 계산이 완료되지 않아 일일DATA 자동입력을 시작하지 않았습니다.','error');
        return;
      }
      if(tone!=='success')return;
      state.pendingArm=null;
      void refresh({force:true,expectedEditSeq:arm.editSeq});
    }
    if(hostStatus){
      const statusObserver=new MutationObserver(handleHostStatusMutation);
      statusObserver.observe(hostStatus,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-tone']});
    }

    query.addEventListener('click',armAfterHostCalculation,true);
    requery?.addEventListener('click',armAfterHostCalculation,true);

    for(const input of container.querySelectorAll('[data-cfv7-date],[data-cfv8-mode],[data-cfv8-start],[data-cfv8-end]')){
      input.addEventListener('change',()=>{
        state.pendingArm=null;
        state.generation+=1;
        stateText(container,'일일DATA 자동입력 대기','');
      });
    }
  }

  function scan(){for(const container of root.document.querySelectorAll('.cofiring-period-v5'))bind(container);}
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
  const observer=new MutationObserver(scan);
  observer.observe(root.document.documentElement,{childList:true,subtree:true});
})(typeof globalThis==='object'?globalThis:window);
