(function(root){
  'use strict';

  if(root.__cofiringClosedHistoryCardsV2Installed)return;
  root.__cofiringClosedHistoryCardsV2Installed=true;

  const API='/api/cofiring-closed-history';
  const VERSION='COFIRING_CLOSED_HISTORY_CARDS_V2_R1';

  const number=value=>{
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  };

  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  const pct=value=>{
    const n=number(value);
    return n===null?'—':n.toFixed(2)+'%';
  };

  const tons=value=>{
    const n=number(value);
    return n===null?'—':n.toLocaleString('ko-KR',{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })+' t';
  };

  const scalar=value=>{
    const n=number(value);
    return n===null?'—':n.toLocaleString('ko-KR',{
      maximumFractionDigits:6
    });
  };

  function authHeaders(){
    try{
      return typeof root.getShiftLogAuthHeaders==='function'
        ? root.getShiftLogAuthHeaders()
        : {};
    }catch(_){
      return {};
    }
  }

  async function api(path='',options={}){
    const response=await root.fetch(API+path,{
      credentials:'same-origin',
      cache:'no-store',
      ...options,
      headers:{
        ...authHeaders(),
        Accept:'application/json',
        ...(options.headers||{})
      }
    });

    let payload=null;
    try{payload=await response.json();}catch(_){}

    if(!response.ok||payload?.ok!==true){
      throw new Error(payload?.message||'마감 데이터를 불러오지 못했습니다.');
    }
    return payload;
  }

  function unitBioRatio(unit){
    const coal=number(unit?.heats?.coal);
    const bio=number(unit?.heats?.bio);
    const total=(coal??0)+(bio??0);
    return coal===null||bio===null||total<=0?null:bio/total*100;
  }

  function combinedBioRatio(result){
    let coal=number(result?.combined?.heats?.coal);
    let bio=number(result?.combined?.heats?.bio);

    if(coal===null){
      const a=number(result?.units?.unit1?.heats?.coal);
      const b=number(result?.units?.unit2?.heats?.coal);
      if(a!==null&&b!==null)coal=a+b;
    }
    if(bio===null){
      const a=number(result?.units?.unit1?.heats?.bio);
      const b=number(result?.units?.unit2?.heats?.bio);
      if(a!==null&&b!==null)bio=a+b;
    }

    const total=(coal??0)+(bio??0);
    return coal===null||bio===null||total<=0?null:bio/total*100;
  }

  function unitSnapshot(result,unitKey,fallback={}){
    const unit=result?.units?.[unitKey]||{};
    return {
      coal:number(unit?.coal?.quantity)??number(fallback?.coal),
      bio:number(unit?.bio?.quantity)??number(fallback?.bio),
      organic:number(unit?.organic?.quantity)??number(fallback?.organic),
      manure:number(unit?.manure?.quantity)??number(fallback?.manure),
      bioRatio:unitBioRatio(unit)??number(fallback?.bioRatio),
      organicGroupRatio:
        number(unit?.fuelRatios?.organicGroup)??
        number(unit?.ratios?.organicGroup)??
        number(fallback?.organicGroupRatio),
      totalRatio:
        number(unit?.fuelRatios?.total)??
        number(unit?.ratios?.total)??
        number(fallback?.totalRatio)
    };
  }

  function deriveSnapshot(item){
    const snapshot=item?.snapshot||{};
    const result=snapshot?.result||{};
    const fallback=snapshot?.summary||item?.summary||{};

    return {
      unit1:unitSnapshot(result,'unit1',fallback?.unit1),
      unit2:unitSnapshot(result,'unit2',fallback?.unit2),
      combined:{
        bioRatio:combinedBioRatio(result)??number(fallback?.combined?.bioRatio),
        organicGroupRatio:
          number(result?.combined?.fuelRatios?.organicGroup)??
          number(result?.combined?.ratios?.organicGroup)??
          number(fallback?.combined?.organicGroupRatio),
        totalRatio:
          number(result?.combined?.fuelRatios?.total)??
          number(result?.combined?.ratios?.total)??
          number(fallback?.combined?.totalRatio)
      },
      settings:snapshot?.settings||{},
      manual:snapshot?.manual||{},
      period:snapshot?.period||{},
      capturedAt:String(snapshot?.capturedAt||''),
      sourceRequestId:String(item?.sourceRequestId||snapshot?.sourceRequestId||'')
    };
  }

  function dateTime(value){
    if(!value)return '—';
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))return escapeHtml(value);
    return escapeHtml(d.toLocaleString('ko-KR',{
      timeZone:'Asia/Seoul',
      year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit'
    }));
  }

  function summaryCardMarkup(item,index){
    const summary=item?.summary||{};
    const date=escapeHtml(item?.targetDate||'');
    const closer=escapeHtml(item?.savedByName||'—');
    const updated=dateTime(item?.updatedAt);

    return `
      <article class="cfv14-history-card${index===0?' is-latest':''}" data-cfv14-card="${date}">
        <header class="cfv14-history-card__header">
          <div class="cfv14-history-card__date">
            <span>${index===0?'LATEST CLOSED':'CLOSED SNAPSHOT'}</span>
            <strong>${date}</strong>
            <small>${closer} · ${updated}</small>
          </div>
          <div class="cfv14-history-card__quick">
            <div><span>1호기 Bio</span><strong>${pct(summary?.unit1?.bioRatio)}</strong></div>
            <div><span>2호기 Bio</span><strong>${pct(summary?.unit2?.bioRatio)}</strong></div>
            <div class="is-total"><span>종합 혼소율</span><strong>${pct(summary?.combined?.totalRatio)}</strong></div>
          </div>
          <div class="cfv14-history-card__actions">
            <button type="button" data-cfv14-expand="${date}" aria-expanded="false">전체값 보기</button>
            <button type="button" class="danger" data-cfv14-delete="${date}">삭제</button>
          </div>
        </header>
        <div class="cfv14-history-card__detail" data-cfv14-detail="${date}" hidden></div>
      </article>
    `;
  }

  function fuelCell(label,value,className=''){
    return `
      <div class="cfv14-fuel ${className}">
        <span>${label}</span>
        <strong>${tons(value)}</strong>
      </div>
    `;
  }

  function ratioCell(label,value,className=''){
    return `
      <div class="cfv14-ratio ${className}">
        <span>${label}</span>
        <strong>${pct(value)}</strong>
      </div>
    `;
  }

  function unitCardMarkup(label,unit){
    return `
      <section class="cfv14-unit-card">
        <header><span>BOILER UNIT</span><strong>${label}</strong></header>
        <div class="cfv14-ratio-grid">
          ${ratioCell('바이오 혼소율',unit.bioRatio)}
          ${ratioCell('유기성 및 축분 혼소율',unit.organicGroupRatio)}
          ${ratioCell('종합혼소율',unit.totalRatio,'is-emphasis')}
        </div>
        <div class="cfv14-fuel-grid">
          ${fuelCell('Coal',unit.coal,'is-coal')}
          ${fuelCell('Bio',unit.bio,'is-bio')}
          ${fuelCell('유기성',unit.organic,'is-organic')}
          ${fuelCell('축분',unit.manure,'is-manure')}
        </div>
      </section>
    `;
  }

  function settingsRows(settings){
    const labels={coal:'Coal',bio:'Bio',organic:'유기성',manure:'축분'};
    return ['coal','bio','organic','manure'].map(fuel=>`
      <tr>
        <th>${labels[fuel]}</th>
        <td>${scalar(settings?.unit1?.[fuel]?.calorific)}</td>
        <td>${scalar(settings?.unit1?.[fuel]?.coefficient)}</td>
        <td>${scalar(settings?.unit2?.[fuel]?.calorific)}</td>
        <td>${scalar(settings?.unit2?.[fuel]?.coefficient)}</td>
      </tr>
    `).join('');
  }

  function manualRows(manual){
    return `
      <tr><th>1호기</th><td>${tons(manual?.unit1?.organic)}</td><td>${tons(manual?.unit1?.manure)}</td></tr>
      <tr><th>2호기</th><td>${tons(manual?.unit2?.organic)}</td><td>${tons(manual?.unit2?.manure)}</td></tr>
    `;
  }

  function detailMarkup(item){
    const d=deriveSnapshot(item);
    const date=escapeHtml(item?.targetDate||'');
    const closer=escapeHtml(item?.savedByName||'—');

    return `
      <div class="cfv14-detail-shell">
        <div class="cfv14-main-grid">
          ${unitCardMarkup('1호기',d.unit1)}
          ${unitCardMarkup('2호기',d.unit2)}
        </div>

        <section class="cfv14-combined-card">
          <div>
            <span>1,2호기 종합</span>
            <strong>마감 당시 최종 혼소율</strong>
          </div>
          <div class="cfv14-combined-ratios">
            ${ratioCell('바이오 혼소율',d.combined.bioRatio)}
            ${ratioCell('유기성 및 축분 혼소율',d.combined.organicGroupRatio)}
            ${ratioCell('종합혼소율',d.combined.totalRatio,'is-final')}
          </div>
        </section>

        <details class="cfv14-basis">
          <summary>마감 당시 계산 기준값</summary>
          <div class="cfv14-basis-grid">
            <section>
              <h4>발열량 · 보정계수</h4>
              <div class="cfv14-table-wrap">
                <table>
                  <thead><tr><th>연료</th><th>1호기 발열량</th><th>1호기 보정</th><th>2호기 발열량</th><th>2호기 보정</th></tr></thead>
                  <tbody>${settingsRows(d.settings)}</tbody>
                </table>
              </div>
            </section>
            <section>
              <h4>유기성 · 축분 저장값</h4>
              <div class="cfv14-table-wrap">
                <table>
                  <thead><tr><th>호기</th><th>유기성</th><th>축분</th></tr></thead>
                  <tbody>${manualRows(d.manual)}</tbody>
                </table>
              </div>
            </section>
          </div>
        </details>

        <footer class="cfv14-meta">
          <div><span>마감자</span><strong>${closer}</strong></div>
          <div><span>마감 시각</span><strong>${dateTime(item?.updatedAt)}</strong></div>
          <div><span>Revision</span><strong>${escapeHtml(item?.revision??'—')}</strong></div>
          <div><span>DataPARC 요청</span><strong title="${escapeHtml(d.sourceRequestId)}">${escapeHtml(d.sourceRequestId||'—')}</strong></div>
          <div><span>스냅샷 생성</span><strong>${dateTime(d.capturedAt)}</strong></div>
          <div class="cfv14-meta__action"><button type="button" data-cfv14-go="${date}">계산일로 이동</button></div>
        </footer>
      </div>
    `;
  }

  function mount(){
    const panel=root.document?.querySelector?.('.cfv12-history-panel');
    if(!panel||panel.dataset.cfv14Mounted==='1')return false;

    panel.dataset.cfv14Mounted='1';
    panel.classList.add('cfv14-enhanced');

    const head=panel.querySelector('.cfv12-history-head');
    if(!head)return false;

    const host=root.document.createElement('div');
    host.className='cfv14-history-list';
    host.setAttribute('data-cfv14-list','');
    head.after(host);

    let loadEpoch=0;

    async function loadList(){
      const epoch=++loadEpoch;
      host.innerHTML='<div class="cfv14-state">마감 데이터 확인 중...</div>';
      try{
        const payload=await api('?limit=180');
        if(epoch!==loadEpoch)return;
        const items=Array.isArray(payload?.items)?payload.items:[];
        if(!items.length){
          host.innerHTML='<div class="cfv14-state"><strong>마감 저장된 데이터가 없습니다.</strong><span>마감 저장 후 날짜별 스냅샷이 표시됩니다.</span></div>';
          return;
        }
        host.innerHTML=items.map(summaryCardMarkup).join('');
        const first=items[0]?.targetDate;
        if(first)void expandDate(first,true);
      }catch(error){
        if(epoch!==loadEpoch)return;
        host.innerHTML=`<div class="cfv14-state is-error">${escapeHtml(error.message)}</div>`;
      }
    }

    async function expandDate(date,forceOpen=false){
      const card=host.querySelector(`[data-cfv14-card="${CSS.escape(date)}"]`);
      const detail=host.querySelector(`[data-cfv14-detail="${CSS.escape(date)}"]`);
      const button=host.querySelector(`[data-cfv14-expand="${CSS.escape(date)}"]`);
      if(!card||!detail||!button)return;

      const open=forceOpen||detail.hidden;
      if(!open){
        detail.hidden=true;
        card.classList.remove('is-open');
        button.setAttribute('aria-expanded','false');
        button.textContent='전체값 보기';
        return;
      }

      detail.hidden=false;
      card.classList.add('is-open');
      button.setAttribute('aria-expanded','true');
      button.textContent='접기';

      if(detail.dataset.loaded==='1')return;
      detail.innerHTML='<div class="cfv14-state">마감 스냅샷 불러오는 중...</div>';

      try{
        const payload=await api('?targetDate='+encodeURIComponent(date));
        if(!payload?.item)throw new Error('저장된 마감 스냅샷을 찾을 수 없습니다.');
        detail.innerHTML=detailMarkup(payload.item);
        detail.dataset.loaded='1';
      }catch(error){
        detail.innerHTML=`<div class="cfv14-state is-error">${escapeHtml(error.message)}</div>`;
      }
    }

    async function deleteDate(date){
      if(!root.confirm?.(date+' 마감 데이터를 삭제하시겠습니까?'))return;
      try{
        await api('?targetDate='+encodeURIComponent(date),{method:'DELETE'});
        await loadList();
      }catch(error){
        root.alert?.(error.message);
      }
    }

    function goDate(date){
      const container=root.document.querySelector('[data-cofiring-draft-root]');
      const input=container?.querySelector('[data-cfv7-date]');
      const mode=container?.querySelector('[data-cfv8-mode]');
      if(mode)mode.value='daily';
      if(input){
        input.value=date;
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const calcTab=panel.parentElement?.querySelector?.('.cfv12-tabs .cfv12-tab');
      calcTab?.click?.();
    }

    host.addEventListener('click',event=>{
      const expand=event.target.closest?.('[data-cfv14-expand]');
      const del=event.target.closest?.('[data-cfv14-delete]');
      const go=event.target.closest?.('[data-cfv14-go]');
      if(expand){void expandDate(expand.getAttribute('data-cfv14-expand')||'');return;}
      if(del){void deleteDate(del.getAttribute('data-cfv14-delete')||'');return;}
      if(go){goDate(go.getAttribute('data-cfv14-go')||'');}
    });

    panel.querySelector('[data-cfv12-refresh]')?.addEventListener('click',()=>void loadList());

    const observer=root.MutationObserver?new root.MutationObserver(()=>{
      if(!panel.hidden)void loadList();
    }):null;
    observer?.observe(panel,{attributes:true,attributeFilter:['hidden']});

    if(!panel.hidden)void loadList();
    return true;
  }

  function boot(){
    if(mount())return;
    if(!root.document?.body||!root.MutationObserver)return;
    const observer=new root.MutationObserver(()=>{
      if(mount())observer.disconnect();
    });
    observer.observe(root.document.body,{childList:true,subtree:true});
  }

  const exported={VERSION,deriveSnapshot,unitBioRatio,combinedBioRatio};
  root.CofiringClosedHistoryCardsV2=exported;
  if(typeof module==='object'&&module.exports)module.exports=exported;

  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }
})(typeof globalThis==='object'?globalThis:this);
