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

  function validDate(value){
    if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
    const d=new Date(value+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
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
      throw new Error(payload?.message||'발열량·보정계수 저장 이력을 불러오지 못했습니다.');
    }
    return payload;
  }

  function unitSummary(settings,unit){
    return `
      <div class="cfv13-unit-summary">
        ${FUELS.map(([key,label])=>`
          <span>
            <b>${label}</b>
            <em>${formatNumber(settings?.[unit]?.[key]?.calorific)} / ${formatNumber(settings?.[unit]?.[key]?.coefficient)}</em>
          </span>
        `).join('')}
      </div>
    `;
  }

  function listMarkup(items){
    if(!Array.isArray(items)||items.length===0){
      return `
        <div class="cfv12-empty">
          <strong>저장된 발열량·보정계수 이력이 없습니다.</strong>
          <span>혼소율 계산 화면에서 [발열량/보정계수 저장]을 누르면 적용일별로 여기에 기록됩니다.</span>
        </div>
      `;
    }

    return `
      <div class="cfv12-history-table-wrap">
        <table class="cfv12-history-table cfv13-history-table">
          <thead>
            <tr>
              <th>적용일</th>
              <th>1호기 기준 <small>발열량 / 보정</small></th>
              <th>2호기 기준 <small>발열량 / 보정</small></th>
              <th>저장자</th>
              <th>저장 시각</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item=>`
              <tr>
                <td><strong>${escapeHtml(item.effectiveDate||'—')}</strong></td>
                <td>${unitSummary(item.settings,'unit1')}</td>
                <td>${unitSummary(item.settings,'unit2')}</td>
                <td>${escapeHtml(item.updatedByName||'—')}</td>
                <td>${escapeHtml(formatTime(item.updatedAt))}</td>
                <td>
                  <div class="cfv12-row-actions">
                    <button type="button" data-cfv13-view="${escapeHtml(item.effectiveDate||'')}">보기</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function detailMarkup(item){
    if(!item)return '';
    const settings=item.settings||{};
    const rows=FUELS.map(([key,label])=>`
      <tr>
        <th>${label}</th>
        <td>${formatNumber(settings?.unit1?.[key]?.calorific)}</td>
        <td>${formatNumber(settings?.unit1?.[key]?.coefficient)}</td>
        <td>${formatNumber(settings?.unit2?.[key]?.calorific)}</td>
        <td>${formatNumber(settings?.unit2?.[key]?.coefficient)}</td>
      </tr>
    `).join('');

    return `
      <div class="cfv12-detail cfv13-detail">
        <div class="cfv12-detail-head">
          <div>
            <strong>${escapeHtml(item.effectiveDate||'—')} 발열량 · 보정계수</strong>
            <span>${escapeHtml(item.updatedByName||'—')} · ${escapeHtml(formatTime(item.updatedAt))}</span>
          </div>
          <button type="button" data-cfv13-go="${escapeHtml(item.effectiveDate||'')}">계산일로 이동</button>
        </div>
        <div class="cfv13-basis-table-wrap">
          <table class="cfv13-basis-table">
            <thead>
              <tr>
                <th rowspan="2">연료</th>
                <th colspan="2">1호기</th>
                <th colspan="2">2호기</th>
              </tr>
              <tr>
                <th>발열량 <small>kcal/kg</small></th>
                <th>보정계수</th>
                <th>발열량 <small>kcal/kg</small></th>
                <th>보정계수</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function mount(){
    const container=root.document?.querySelector?.('[data-cofiring-draft-root]');
    const sheet=container?.querySelector?.('.cfv5-sheet');
    const tabs=sheet?.querySelector?.('.cfv12-tabs');
    const toolbar=sheet?.querySelector?.('.cfv12-toolbar');

    if(!container||!sheet||!tabs||!toolbar)return false;
    if(sheet.dataset.cfv13SettingsHistory==='1')return true;

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
          <strong>발열량 · 보정계수 저장 이력</strong>
          <span>저장 버튼으로 등록한 값을 적용일별로 표시합니다. 같은 적용일은 가장 최근 저장값을 표시합니다.</span>
        </div>
        <button type="button" data-cfv13-refresh>새로고침</button>
      </div>
      <div class="cfv12-history-body" data-cfv13-body>
        <div class="cfv12-loading">저장 이력 확인 중...</div>
      </div>
      <div data-cfv13-detail></div>
    `;
    oldPanel.after(panel);

    const body=panel.querySelector('[data-cfv13-body]');
    const detail=panel.querySelector('[data-cfv13-detail]');
    const refresh=panel.querySelector('[data-cfv13-refresh]');
    let items=[];

    async function loadList(){
      body.innerHTML='<div class="cfv12-loading">저장 이력 확인 중...</div>';
      detail.innerHTML='';
      try{
        const payload=await api('?history=1&limit=180');
        items=Array.isArray(payload.items)?payload.items:[];
        body.innerHTML=listMarkup(items);
      }catch(error){
        items=[];
        body.innerHTML=`<div class="cfv12-error">${escapeHtml(error.message)}</div>`;
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

    panel.addEventListener('click',event=>{
      const view=event.target.closest?.('[data-cfv13-view]');
      const go=event.target.closest?.('[data-cfv13-go]');

      if(view){
        const date=view.getAttribute('data-cfv13-view')||'';
        const item=items.find(entry=>entry.effectiveDate===date);
        detail.innerHTML=detailMarkup(item);
        detail.scrollIntoView?.({behavior:'smooth',block:'nearest'});
        return;
      }

      if(go){
        const date=go.getAttribute('data-cfv13-go')||'';
        const input=container.querySelector('[data-cfv7-date]');
        const mode=container.querySelector('[data-cfv8-mode]');
        if(mode)mode.value='daily';
        if(input&&validDate(date)){
          input.value=date;
          input.dispatchEvent(new Event('change',{bubbles:true}));
        }
        calc.click();
      }
    });

    sheet.dataset.cfv13SettingsHistory='1';
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

  const exported={validDate,listMarkup,detailMarkup};
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
