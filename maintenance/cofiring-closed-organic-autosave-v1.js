(function(root){
  'use strict';
  const MARKER='COFIRING_CLOSED_ORGANIC_AUTOSAVE_V2';
  const RECALC_EVENT='cofiring:manual-recalculate';
  const STYLE_ID='cofiring-organic-manual-readability-v2';
  if(root.__cofiringClosedOrganicAutosaveV1Installed)return;
  root.__cofiringClosedOrganicAutosaveV1Installed=true;

  const API='/api/ois-data-requests';
  const REQUEST_TYPES=['daily_data_excel','steam_status'];
  const states=new WeakMap();

  function isoDate(value){
    const s=String(value||'').trim();
    if(!/^20\d{2}-\d{2}-\d{2}$/.test(s))return '';
    const d=new Date(s+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:'';
  }
  function nextDate(date){
    const d=new Date(date+'T00:00:00Z');
    return new Date(d.getTime()+86400000).toISOString().slice(0,10);
  }
  function isClosedDate(date,now=Date.now()){
    if(!isoDate(date))return false;
    return now>=Date.parse(nextDate(date)+'T00:01:00+09:00');
  }
  function finiteNonNegative(value){
    if(value===null||value===undefined||String(value).trim()==='')return null;
    const n=typeof value==='number'?value:Number(String(value).replace(/,/g,'').trim());
    return Number.isFinite(n)&&n>=0?n:null;
  }
  function roundTwo(value){
    const n=finiteNonNegative(value);
    if(n===null)return null;
    return Math.round((n+Number.EPSILON)*100)/100;
  }
  function formatTwo(value){
    const n=roundTwo(value);
    return n===null?'':n.toFixed(2);
  }
  function installReadabilityStyle(){
    if(!root.document||root.document.getElementById(STYLE_ID))return;
    const style=root.document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      .cofiring-period-v5 .cfv52-manual-unit label{color:#3f5568!important;font-size:12px!important;font-weight:700!important;}
      .cofiring-period-v5 .cfv52-manual-unit label>span{letter-spacing:-.1px;}
      .cofiring-period-v5 .cfv52-manual-unit label small{color:#53697b!important;font-size:11px!important;font-weight:650!important;}
      .cofiring-period-v5 .cfv5-manual-input{color:#17364b!important;font-size:14px!important;font-weight:700!important;font-variant-numeric:tabular-nums;}
    `;
    (root.document.head||root.document.documentElement).appendChild(style);
  }
  function requestType(item){return String(item?.requestType||item?.sourceRequestType||'').trim();}
  function selectDailyDataItem(payload,date){
    const items=Array.isArray(payload?.items)?payload.items:[];
    for(const type of REQUEST_TYPES){
      const item=items.find(x=>String(x?.targetDate||'').trim()===date&&String(x?.status||'').trim().toLowerCase()==='complete'&&requestType(x)===type&&x?.result&&typeof x.result==='object'&&!Array.isArray(x.result));
      if(item)return item;
    }
    return null;
  }
  function extractOrganic(payload,date){
    const item=selectDailyDataItem(payload,date);
    if(!item)return null;
    const result=item.result||{};
    const unit1=finiteNonNegative(result.organicUsageUnitOne);
    const unit2=finiteNonNegative(result.organicUsageUnitTwo);
    if(unit1===null&&unit2===null)return null;
    return {itemId:String(item.id||'').trim(),requestType:requestType(item),unit1,unit2,completedAt:String(item.completedAt||item.updatedAt||'').trim()};
  }
  function modeIsDaily(container){
    const mode=container.querySelector('[data-cfv8-mode]');
    if(!mode)return true;
    const value=String(mode.value||'').trim().toLowerCase();
    return value===''||value==='daily'||value==='day'||value==='일별';
  }
  function selectedDate(container){return isoDate(container.querySelector('[data-cfv7-date]')?.value);}
  function resultIsFinal(container){
    const texts=[
      container.querySelector('[data-cfv5-live-state]')?.textContent,
      container.querySelector('[data-cfv52-summary-note]')?.textContent,
      container.querySelector('[data-cfv5-status]')?.textContent
    ].map(v=>String(v||'').replace(/\s+/g,' ').trim());
    return texts.some(t=>/계산\s*완료|마감\s*완료|즉시\s*계산\s*가능/.test(t));
  }
  function headers(){
    let h={Accept:'application/json'};
    try{if(typeof root.getShiftLogAuthHeaders==='function')h={...h,...(root.getShiftLogAuthHeaders()||{})};}catch(_){}
    return h;
  }
  async function readCompletedHistory(date){
    const u=new URL(API,root.location?.origin||'https://local.invalid');
    u.searchParams.set('action','completed_history');
    u.searchParams.set('startDate',date);
    u.searchParams.set('endDate',date);
    u.searchParams.set('_',String(Date.now()));
    const response=await root.fetch(u.toString(),{method:'GET',headers:headers(),cache:'no-store',credentials:'same-origin'});
    const text=await response.text();
    let payload={};
    if(text.trim())payload=JSON.parse(text);
    if(!response.ok||payload?.ok===false||payload?.success===false)throw new Error(payload?.message||payload?.error||('오전회의 저장자료 조회 실패 (HTTP '+response.status+')'));
    return payload;
  }
  function inputFor(container,unit){return container.querySelector('[data-cfv5-manual="'+unit+':organic"]');}
  function manualLabel(container){return container.querySelector('[data-cfv5-manual-state]');}
  function saveButton(container){return container.querySelector('[data-cfv5-manual-save]');}
  function setValue(input,value){
    if(!input||value===null)return false;
    const rounded=roundTwo(value);
    if(rounded===null)return false;
    const next=rounded.toFixed(2);
    const changed=String(input.value||'')!==next;
    input.value=next;
    if(changed){
      const EventCtor=root.Event||Event;
      input.dispatchEvent(new EventCtor('input',{bubbles:true}));
      input.dispatchEvent(new EventCtor('change',{bubbles:true}));
    }
    return changed;
  }
  function normalizeManualDisplay(input){
    if(!input?.matches?.('[data-cfv5-manual]'))return false;
    const raw=String(input.value??'').trim();
    if(raw==='')return false;
    const next=formatTwo(raw);
    if(!next||String(input.value)===next)return false;
    input.value=next;
    return true;
  }
  function normalizeAllManualDisplays(container){
    let changed=false;
    for(const input of container.querySelectorAll('[data-cfv5-manual]'))changed=normalizeManualDisplay(input)||changed;
    return changed;
  }
  function requestRecalculate(container,source='organic-autofill'){
    if(!container?.dispatchEvent)return false;
    try{
      const Ctor=root.CustomEvent||root.Event||Event;
      const event=root.CustomEvent?new Ctor(RECALC_EVENT,{bubbles:false,detail:{source}}):new Ctor(RECALC_EVENT,{bubbles:false});
      return container.dispatchEvent(event);
    }catch(_){return false;}
  }
  function sourceSignature(date,source){return [date,source?.itemId||'',source?.unit1??'',source?.unit2??''].join('|');}
  function wait(ms){return new Promise(resolve=>(root.setTimeout||setTimeout)(resolve,ms));}
  async function waitForSave(container,startedAt,timeout=12000){
    while(Date.now()-startedAt<timeout){
      const text=String(manualLabel(container)?.textContent||'').trim();
      if(/^저장 v\d+/.test(text))return true;
      if(/실패|오류|저장하지 못|권한/.test(text))return false;
      await wait(120);
    }
    return false;
  }
  function setLabel(container,text){const label=manualLabel(container);if(label)label.textContent=text;}

  async function synchronize(container,state){
    if(state.inFlight)return;
    const date=selectedDate(container);
    if(!date||!modeIsDaily(container)||!isClosedDate(date)||!resultIsFinal(container))return;
    if(state.userDirty)return;
    const generation=state.generation;
    const editSeq=state.editSeq;
    state.inFlight=true;
    try{
      const payload=await readCompletedHistory(date);
      if(state.generation!==generation||state.editSeq!==editSeq||state.userDirty||selectedDate(container)!==date||!resultIsFinal(container))return;
      const source=extractOrganic(payload,date);
      if(!source)return;
      const signature=sourceSignature(date,source);
      if(state.appliedSignature===signature)return;
      const u1=inputFor(container,'unit1'),u2=inputFor(container,'unit2');
      if(!u1||!u2)return;
      setLabel(container,'오전회의 유기성 자동 입력 중...');
      const changed1=setValue(u1,source.unit1);
      const changed2=setValue(u2,source.unit2);
      normalizeAllManualDisplays(container);
      requestRecalculate(container,'organic-autofill-before-save');
      await wait(0);
      if(state.generation!==generation||state.editSeq!==editSeq||state.userDirty||selectedDate(container)!==date)return;
      const button=saveButton(container);
      if(!button||button.disabled){
        setLabel(container,(changed1||changed2)?'오전회의 유기성 적용 · 저장 대기':'오전회의 유기성 확인 · 저장 대기');
        return;
      }
      setLabel(container,'오전회의 유기성 자동 저장 중...');
      const started=Date.now();
      button.click();
      const saved=await waitForSave(container,started);
      if(saved){
        state.appliedSignature=signature;
        state.userDirty=false;
        normalizeAllManualDisplays(container);
        requestRecalculate(container,'organic-autofill-after-save');
        const label=manualLabel(container);
        if(label&&/^저장 v\d+/.test(String(label.textContent||'').trim()))label.textContent=String(label.textContent||'').trim()+' · 오전회의 유기성 자동반영';
      }
    }catch(err){
      if(state.generation===generation&&!state.userDirty){
        const message=String(err?.message||err||'').trim();
        if(message)setLabel(container,'오전회의 유기성 자동반영 보류');
        try{console.warn('[COFIRING CLOSED ORGANIC AUTOSAVE]',message);}catch(_){}
      }
    }finally{
      state.inFlight=false;
    }
  }
  function schedule(container,state,delay=80){
    if(state.timer)(root.clearTimeout||clearTimeout)(state.timer);
    state.timer=(root.setTimeout||setTimeout)(()=>{state.timer=null;normalizeAllManualDisplays(container);void synchronize(container,state);},delay);
  }
  function bind(container){
    if(!container||states.has(container))return;
    installReadabilityStyle();
    const state={generation:0,editSeq:0,userDirty:false,inFlight:false,timer:null,appliedSignature:''};
    states.set(container,state);
    container.addEventListener('input',event=>{
      if(!event.isTrusted)return;
      if(event.target?.matches?.('[data-cfv5-manual]')){state.editSeq++;state.userDirty=true;state.appliedSignature='';}
    },true);
    const reset=()=>{state.generation++;state.userDirty=false;state.appliedSignature='';schedule(container,state,120);};
    container.addEventListener('change',event=>{
      if(event.target?.matches?.('[data-cfv5-manual]'))normalizeManualDisplay(event.target);
      if(event.target?.matches?.('[data-cfv7-date],[data-cfv8-mode]'))reset();
    },true);
    container.addEventListener('click',event=>{if(event.target?.closest?.('[data-cfv5-query],[data-cfv5-requery]')){state.generation++;state.appliedSignature='';schedule(container,state,250);}},true);
    if(root.MutationObserver){
      const observer=new root.MutationObserver(()=>schedule(container,state,100));
      observer.observe(container,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','data-tone']});
      state.observer=observer;
    }
    schedule(container,state,150);
  }
  function scan(){
    if(!root.document)return;
    const nodes=root.document.querySelectorAll('.cofiring-period-v5,[data-cofiring-draft-root]');
    for(const node of nodes){
      const container=node.matches?.('.cofiring-period-v5')?node:(node.closest?.('.cofiring-period-v5')||node);
      bind(container);
    }
  }
  const api={MARKER,RECALC_EVENT,isoDate,nextDate,isClosedDate,finiteNonNegative,roundTwo,formatTwo,selectDailyDataItem,extractOrganic,sourceSignature};
  root.CofiringClosedOrganicAutosaveV1=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
    if(root.MutationObserver){const pageObserver=new root.MutationObserver(scan);pageObserver.observe(root.document.documentElement,{subtree:true,childList:true});}
  }
})(typeof globalThis==='object'?globalThis:this);
