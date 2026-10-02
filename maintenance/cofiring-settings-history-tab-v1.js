(function(root){
  'use strict';

  const API='/api/cofiring-calculation-settings';
  const FUELS=[
    ['coal','Coal'],
    ['bio','Bio'],
    ['organic','유기성'],
    ['manure','축분']
  ];

  function authHeaders(){
    try{
      return typeof root.getShiftLogAuthHeaders==='function'
        ? root.getShiftLogAuthHeaders()
        : {};
    }catch(_){
      return {};
    }
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,ch=>({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[ch]));
  }

  function formatNumber(value){
    const n=Number(value);
    if(!Number.isFinite(n))return '—';
    return n.toLocaleString('ko-KR',{maximumFractionDigits:6});
  }

  function formatTime(value){
    if(!value)return '—';
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))return '—';
    return d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
  }

  async function api(path=''){
    const response=await root.fetch(API+path,{
      credentials:'same-origin',
      cache:'no-store',
      headers:{
        ...authHeaders(),
        Accept:'application/json'
      }
    });

    let payload=null;
    try{payload=await response.json();}catch(_){}
    if(!response.ok||payload?.ok!==true){
      throw new Error(payload?.message||'발열량 저장 이력을 불러오지 못했습니다.');
    }
    return payload;
  }

  // COFIRING_CALORIFIC_HISTORY_MANAGE_V2
  async function deleteHistory(effectiveDate){
    const response=await root.fetch(API+'?effectiveDate='+encodeURIComponent(effectiveDate),{
      method:'DELETE',
      credentials:'same-origin',
      cache:'no-store',
      headers:{
        ...authHeaders(),
        Accept:'application/json',
        'X-ShiftLog-Client':'desktop'
      }
    });
    let payload=null;
    try{payload=await response.json();}catch(_){ }
    if(!response.ok||payload?.ok!==true){
      throw new Error(payload?.message||'발열량 저장 이력을 삭제하지 못했습니다.');
    }
    return payload;
  }
  function calorific(settings,key){
    return formatNumber(settings?.unit1?.[key]?.calorific);
  }

  function listMarkup(items){
    // Native history table: render the final layout once, including empty states.
    if(!Array.isArray(items)||items.length===0){
      return '<div class="cfv-cal-empty"><strong>저장된 발열량 이력이 없습니다.</strong><span>발열량을 저장하면 적용일별 이력이 표시됩니다.</span></div>';
    }

    function dateLabel(value){
      const raw=String(value||'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return escapeHtml(raw||'—');
      const date=new Date(raw+'T00:00:00Z');
      if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==raw)return escapeHtml(raw);
      const weekday=['일','월','화','수','목','금','토'][date.getUTCDay()];
      return `<time datetime="${raw}">${raw.replaceAll('-','.')} <span>(${weekday})</span></time>`;
    }

    function valueText(item,fuel){
      const value=item?.settings?.unit1?.[fuel]?.calorific ?? item?.settings?.unit2?.[fuel]?.calorific;
      if(value==null||value===''||!Number.isFinite(Number(value)))return '—';
      return Number(value).toLocaleString('ko-KR',{maximumFractionDigits:2});
    }

    function savedTime(value){
      const date=new Date(value||'');
      if(!value||!Number.isFinite(date.getTime()))return '—';
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
        timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',hourCycle:'h23'
      }).formatToParts(date).map(part=>[part.type,part.value]));
      return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
    }

    return `<div class="cfv-cal-history-meta"><span class="cfv-cal-common">1·2호기 공통</span><span>발열량 단위 <b>kcal/kg</b></span><span class="cfv-cal-history-count">${items.length}개 적용일</span></div>
      <div class="cfv-cal-table-scroll" tabindex="0" role="region" aria-label="적용일별 발열량 이력">
        <table class="cfv-cal-native-history">
          <caption>적용일별 연료 발열량과 저장 시각. 발열량 단위 kcal/kg, 저장 시각 한국 시간.</caption>
          <thead><tr><th scope="col">적용 시작일</th>${FUELS.map(([,label])=>`<th scope="col">${label}</th>`).join('')}<th scope="col">저장 시각 <span>· 한국 시간</span></th><th scope="col" class="cfv-cal-manage-head">관리</th></tr></thead>
          <tbody>${items.map(item=>`<tr data-cfv-cal-history-date="${escapeHtml(item.effectiveDate)}"><th scope="row">${dateLabel(item.effectiveDate)}</th>${FUELS.map(([fuel])=>`<td class="cfv-cal-value">${escapeHtml(valueText(item,fuel))}</td>`).join('')}<td class="cfv-cal-saved-time">${escapeHtml(savedTime(item.updatedAt))}</td><td class="cfv-cal-manage"><button type="button" class="cfv-cal-row-edit" data-cfv-cal-edit="${escapeHtml(item.effectiveDate)}">수정</button><button type="button" class="cfv-cal-row-delete" data-cfv-cal-delete="${escapeHtml(item.effectiveDate)}">삭제</button></td></tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function mount(){
    const container=root.document?.querySelector?.('[data-cofiring-draft-root]');
    const sheet=container?.querySelector?.('.cfv5-sheet');
    const tabs=sheet?.querySelector?.('.cfv12-tabs');
    const toolbar=sheet?.querySelector?.('.cfv12-toolbar');

    if(!container||!sheet||!tabs||!toolbar)return false;
    if(sheet.dataset.cfv14SettingsHistory==='1')return true;

    const existingTabs=Array.from(tabs.querySelectorAll('.cfv12-tab'));
    const calc=existingTabs.find(button=>button.textContent.trim()==='혼소율 계산');
    const history=existingTabs.find(button=>button.textContent.trim()==='마감 데이터');
    const oldPanel=sheet.querySelector('.cfv12-history-panel');
    const closeButton=toolbar.querySelector('.cfv12-close-save');

    if(!calc||!history||!oldPanel)return false;

    const settingsTab=root.document.createElement('button');
    settingsTab.type='button';
    settingsTab.className='cfv12-tab cfv13-settings-tab';
    settingsTab.textContent='발열량/보정계수';
    settingsTab.setAttribute('aria-selected','false');
    tabs.append(settingsTab);

    const panel=root.document.createElement('section');
    panel.className='cfv12-history-panel cfv13-settings-panel';
    panel.hidden=true;
    panel.innerHTML=`
      <div class="cfv12-history-head">
        <div>
          <strong>발열량 저장 이력</strong>
          <span>1·2호기에 동일 적용되는 연료별 발열량만 표시합니다. 같은 적용일은 가장 최근 저장값을 표시합니다.</span>
        </div>
        <button type="button" data-cfv14-refresh>새로고침</button>
      </div>
      <div class="cfv12-history-body" data-cfv14-body>
        <div class="cfv12-loading">저장 이력 확인 중...</div>
      </div>
    `;
    oldPanel.after(panel);

    const body=panel.querySelector('[data-cfv14-body]');
    const refresh=panel.querySelector('[data-cfv14-refresh]');

    async function loadList(){
      body.innerHTML='<div class="cfv12-loading">저장 이력 확인 중...</div>';
      try{
        const payload=await api('?history=1&limit=180');
        const items=Array.isArray(payload.items)?payload.items:[];
        body.innerHTML=listMarkup(items);
      }catch(error){
        body.innerHTML=`<div class="cfv12-error">${escapeHtml(error.message)}</div>`;
      }
    }

    async function editHistoryDate(effectiveDate){
      const modal=root.CofiringCalorificHistoryAdjustV1;
      if(!modal?.open){
        root.alert?.('발열량 수정창을 불러오지 못했습니다. Ctrl+F5 후 다시 시도해 주세요.');
        return;
      }
      await modal.open(effectiveDate,{lockDate:true});
    }
    async function deleteHistoryDate(effectiveDate,button){
      const ok=root.confirm?.(`${effectiveDate} 적용 발열량 이력을 삭제할까요?\n삭제하면 해당 적용일의 저장 revision 전체가 제거되며 이후 계산은 직전 적용값을 사용합니다.`);
      if(ok===false)return;
      const previous=button?.textContent||'삭제';
      if(button){button.disabled=true;button.textContent='삭제 중';}
      try{
        await deleteHistory(effectiveDate);
        await loadList();
      }catch(error){
        root.alert?.(error?.message||'발열량 저장 이력을 삭제하지 못했습니다.');
        if(button?.isConnected){button.disabled=false;button.textContent=previous;}
      }
    }
    function leaveSettingsTab(){
      panel.hidden=true;
      settingsTab.setAttribute('aria-selected','false');
    }

    function selectSettingsTab(){
      sheet.classList.add('cfv12-history-mode');
      oldPanel.hidden=true;
      panel.hidden=false;
      if(closeButton)closeButton.hidden=true;
      calc.setAttribute('aria-selected','false');
      history.setAttribute('aria-selected','false');
      settingsTab.setAttribute('aria-selected','true');
      void loadList();
    }

    settingsTab.addEventListener('click',selectSettingsTab);
    calc.addEventListener('click',leaveSettingsTab);
    history.addEventListener('click',leaveSettingsTab);
    refresh?.addEventListener('click',()=>void loadList());
    body.addEventListener('click',(event)=>{
      const edit=event.target.closest?.('[data-cfv-cal-edit]');
      if(edit){void editHistoryDate(edit.dataset.cfvCalEdit);return;}
      const del=event.target.closest?.('[data-cfv-cal-delete]');
      if(del){void deleteHistoryDate(del.dataset.cfvCalDelete,del);}
    });

    sheet.dataset.cfv14SettingsHistory='1';
    return true;
  }

  function boot(){
    if(mount())return;
    if(!root.MutationObserver||!root.document?.body)return;
    const observer=new root.MutationObserver(()=>{
      if(mount())observer.disconnect();
    });
    observer.observe(root.document.body,{childList:true,subtree:true});
  }

  const exported={listMarkup};
  root.CofiringSettingsHistoryTabV1=exported;

  if(typeof module==='object'&&module.exports){
    module.exports=exported;
  }

  if(root.document){
    if(root.document.readyState==='loading'){
      root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    }else{
      boot();
    }
  }
})(typeof globalThis==='object'?globalThis:this);
