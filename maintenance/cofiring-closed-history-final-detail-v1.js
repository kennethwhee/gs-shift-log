(function(root){
  'use strict';

  if(root.__cofiringClosedHistoryFinalDetailV1Installed)return;
  root.__cofiringClosedHistoryFinalDetailV1Installed=true;

  const API='/api/cofiring-closed-history';
  const PANEL_SELECTOR='#efficiencyCofiringDraftView .cfv12-history-panel';
  const VERSION='COFIRING_CLOSED_HISTORY_FINAL_DETAIL_V1';
  const FUELS=['coal','bio','organic','manure'];
  const FUEL_LABEL={coal:'Coal',bio:'Bio',organic:'유기성',manure:'축분'};
  const markerCache=new Map();

  let drawer=null;
  let content=null;
  let currentDate='';
  let opener=null;
  let requestEpoch=0;
  let markerEpoch=0;
  let hostObserver=null;
  let markerTimer=null;

  const number=value=>{
    if(value===null||value===undefined||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  };

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  const fmtTon=value=>{
    const n=number(value);
    return n===null?'—':n.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
  };

  const fmtPct=value=>{
    const n=number(value);
    return n===null?'—':n.toFixed(2)+'%';
  };

  const fmtScalar=value=>{
    const n=number(value);
    return n===null?'—':n.toLocaleString('ko-KR',{maximumFractionDigits:6});
  };

  function authHeaders(){
    try{
      return typeof root.getShiftLogAuthHeaders==='function'?root.getShiftLogAuthHeaders():{};
    }catch(_){
      return {};
    }
  }

  async function api(path=''){
    const response=await root.fetch(API+path,{
      credentials:'same-origin',
      cache:'no-store',
      headers:{...authHeaders(),Accept:'application/json'}
    });
    let payload=null;
    try{payload=await response.json();}catch(_){}
    if(!response.ok||payload?.ok!==true){
      throw new Error(payload?.message||'마감 데이터를 불러오지 못했습니다.');
    }
    return payload;
  }

  function bioRatio(unit){
    const coal=number(unit?.heats?.coal);
    const bio=number(unit?.heats?.bio);
    if(coal===null||bio===null||coal+bio<=0)return null;
    return bio/(coal+bio)*100;
  }

  function unitView(result,key){
    const unit=result?.units?.[key]||{};
    return {
      coal:number(unit?.coal?.quantity),
      bio:number(unit?.bio?.quantity),
      organic:number(unit?.organic?.quantity),
      manure:number(unit?.manure?.quantity),
      bioRatio:bioRatio(unit),
      organicGroupRatio:number(unit?.fuelRatios?.organicGroup)??number(unit?.ratios?.organic),
      totalRatio:number(unit?.fuelRatios?.total)??number(unit?.ratios?.total)
    };
  }

  function combinedView(result){
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
    const bioValue=coal!==null&&bio!==null&&coal+bio>0?bio/(coal+bio)*100:null;
    return {
      bioRatio:bioValue,
      organicGroupRatio:number(result?.combined?.fuelRatios?.organicGroup)??number(result?.combined?.ratios?.organic),
      totalRatio:number(result?.combined?.fuelRatios?.total)??number(result?.combined?.ratios?.total)
    };
  }

  function resultView(result){
    return {
      unit1:unitView(result,'unit1'),
      unit2:unitView(result,'unit2'),
      combined:combinedView(result)
    };
  }

  function localDateTime(value){
    if(!value)return '—';
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))return esc(value);
    return esc(d.toLocaleString('ko-KR',{
      timeZone:'Asia/Seoul',
      year:'numeric',
      month:'2-digit',
      day:'2-digit',
      hour:'2-digit',
      minute:'2-digit'
    }));
  }

  function dateHeading(date){
    const valid=/^20\d{2}-\d{2}-\d{2}$/.test(String(date||''));
    if(!valid)return esc(date);
    const weekday=['일','월','화','수','목','금','토'][new Date(date+'T00:00:00Z').getUTCDay()];
    return `${esc(date.replaceAll('-','.'))} <small>(${weekday}요일)</small>`;
  }

  function periodLabel(period){
    const start=String(period?.startLocal||'');
    const end=String(period?.endLocal||'');
    if(!start||!end)return '—';
    const s=start.slice(11,16)||start;
    const e=end.slice(11,16)||end;
    const next=start.slice(0,10)!==end.slice(0,10);
    return `${esc(s)} ~ ${next?'익일 ':''}${esc(e)}`;
  }

  function delta(value,unit=''){
    const n=number(value);
    if(n===null)return '<span class="cfh-final-delta is-zero">—</span>';
    if(Math.abs(n)<0.0000005)return `<span class="cfh-final-delta is-zero">0.00${unit}</span>`;
    const up=n>0;
    return `<span class="cfh-final-delta ${up?'is-up':'is-down'}">${up?'+':''}${n.toFixed(2)}${unit} ${up?'▲':'▼'}</span>`;
  }

  function ratioCard(view,label,kind){
    return `
      <section class="cfh-final-ratio-card ${kind}">
        <span class="cfh-final-ratio-tag">${esc(label)}</span>
        <div class="cfh-final-ratio-main"><span>종합 혼소율</span><strong>${fmtPct(view.totalRatio)}</strong></div>
        <dl>
          <div><dt>바이오 혼소율</dt><dd>${fmtPct(view.bioRatio)}</dd></div>
          <div><dt>유기성·축분 혼소율</dt><dd>${fmtPct(view.organicGroupRatio)}</dd></div>
        </dl>
      </section>`;
  }

  function fuelCompare(original,final){
    return `
      <div class="cfh-final-fuel-table" role="table" aria-label="연료 실사용량 비교">
        <div class="cfh-final-fuel-head" role="row">
          <strong role="columnheader">연료 실사용량 (t)</strong>
          <span role="columnheader">원본</span>
          <span aria-hidden="true"></span>
          <span role="columnheader">혼소조정 후</span>
          <span role="columnheader">증감</span>
        </div>
        ${FUELS.map(fuel=>{
          const before=number(original?.[fuel]);
          const after=number(final?.[fuel]);
          const diff=before===null||after===null?null:after-before;
          return `<div class="cfh-final-fuel-row" role="row">
            <span role="cell">${FUEL_LABEL[fuel]}</span>
            <b role="cell">${fmtTon(before)}</b>
            <span class="cfh-final-fuel-arrow" aria-hidden="true">→</span>
            <b role="cell">${fmtTon(after)}</b>
            <span role="cell">${delta(diff)}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  function fuelSingle(final){
    return `
      <div class="cfh-final-fuel-single" role="table" aria-label="연료 실사용량">
        <div class="cfh-final-fuel-single-head" role="row">
          <strong role="columnheader">연료 실사용량 (t)</strong><span role="columnheader">최종값</span>
        </div>
        ${FUELS.map(fuel=>`<div class="cfh-final-fuel-single-row" role="row">
          <span role="cell">${FUEL_LABEL[fuel]}</span><b role="cell">${fmtTon(final?.[fuel])}</b>
        </div>`).join('')}
      </div>`;
  }

  function compareUnit(index,original,final){
    const totalBefore=number(original?.totalRatio);
    const totalAfter=number(final?.totalRatio);
    const bioBefore=number(original?.bioRatio);
    const bioAfter=number(final?.bioRatio);
    return `
      <section class="cfh-final-unit-block">
        <header><strong><span>0${index}</span> ${index}호기</strong><em>● 마감 완료</em></header>
        <div class="cfh-final-compare-cards">
          ${ratioCard(original,'원본 (계산값)','is-original')}
          <div class="cfh-final-big-arrow" aria-hidden="true">→</div>
          <section class="cfh-final-ratio-card is-adjusted">
            <span class="cfh-final-ratio-tag">혼소조정 후 (최종 마감)</span>
            <div class="cfh-final-ratio-main">
              <span>종합 혼소율</span>
              <strong>${fmtPct(final.totalRatio)}</strong>
              ${delta(totalBefore===null||totalAfter===null?null:totalAfter-totalBefore,'%p')}
            </div>
            <dl>
              <div><dt>바이오 혼소율</dt><dd>${fmtPct(final.bioRatio)} ${delta(bioBefore===null||bioAfter===null?null:bioAfter-bioBefore,'%p')}</dd></div>
              <div><dt>유기성·축분 혼소율</dt><dd>${fmtPct(final.organicGroupRatio)}</dd></div>
            </dl>
          </section>
        </div>
        ${fuelCompare(original,final)}
      </section>`;
  }

  function singleUnit(index,final){
    return `
      <section class="cfh-final-unit-block is-single">
        <header><strong><span>0${index}</span> ${index}호기</strong><em>● 마감 완료</em></header>
        <div class="cfh-final-single-grid">
          <section class="cfh-final-ratio-card is-final">
            <span class="cfh-final-ratio-tag">최종 마감 (원본과 동일)</span>
            <div class="cfh-final-ratio-main"><span>종합 혼소율</span><strong>${fmtPct(final.totalRatio)}</strong></div>
            <dl>
              <div><dt>바이오 혼소율</dt><dd>${fmtPct(final.bioRatio)}</dd></div>
              <div><dt>유기성·축분 혼소율</dt><dd>${fmtPct(final.organicGroupRatio)}</dd></div>
            </dl>
          </section>
          ${fuelSingle(final)}
        </div>
      </section>`;
  }

  function combinedStrip(original,final,adjusted){
    if(adjusted&&original){
      const entries=[
        ['종합',original.totalRatio,final.totalRatio],
        ['Bio',original.bioRatio,final.bioRatio],
        ['유·축',original.organicGroupRatio,final.organicGroupRatio]
      ];
      return `<section class="cfh-final-combined">
        <strong>1·2호기 종합</strong>
        ${entries.map(([label,a,b])=>`<div><span>${label}</span><b>${fmtPct(a)} <i>→</i> ${fmtPct(b)}</b>${delta(number(a)===null||number(b)===null?null:number(b)-number(a),'%p')}</div>`).join('')}
      </section>`;
    }
    return `<section class="cfh-final-combined">
      <strong>1·2호기 종합</strong>
      <div><span>종합</span><b>${fmtPct(final.totalRatio)}</b></div>
      <div><span>Bio</span><b>${fmtPct(final.bioRatio)}</b></div>
      <div><span>유·축</span><b>${fmtPct(final.organicGroupRatio)}</b></div>
    </section>`;
  }

  function settingsMarkup(settings){
    return `
      <section class="cfh-final-info-card">
        <h3>마감 당시 발열량 · 보정계수</h3>
        <div class="cfh-final-settings-wrap">
          <table>
            <thead><tr><th>연료</th><th>1호기 발열량</th><th>1호기 보정</th><th>2호기 발열량</th><th>2호기 보정</th></tr></thead>
            <tbody>${FUELS.map(fuel=>`<tr>
              <th>${FUEL_LABEL[fuel]}</th>
              <td>${fmtScalar(settings?.unit1?.[fuel]?.calorific)}</td>
              <td>${fmtScalar(settings?.unit1?.[fuel]?.coefficient)}</td>
              <td>${fmtScalar(settings?.unit2?.[fuel]?.calorific)}</td>
              <td>${fmtScalar(settings?.unit2?.[fuel]?.coefficient)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </section>`;
  }

  function metaMarkup(item,snapshot){
    const adjustment=snapshot?.result?.adjustment||{};
    return `
      <section class="cfh-final-info-card">
        <h3>마감 저장 정보</h3>
        <dl class="cfh-final-meta-list">
          <div><dt>마감자</dt><dd>${esc(item?.savedByName||'—')}</dd></div>
          <div><dt>마감 시각</dt><dd>${localDateTime(item?.updatedAt)}</dd></div>
          <div><dt>Revision</dt><dd>${esc(item?.revision??'—')}</dd></div>
          <div><dt>스냅샷 생성</dt><dd>${localDateTime(snapshot?.capturedAt)}</dd></div>
          <div><dt>혼소조정</dt><dd>${adjustment?.applied===true?'적용 · '+esc(adjustment.mode||'조정'):'미적용'}</dd></div>
          <div class="is-wide"><dt>DataPARC 요청</dt><dd>${esc(item?.sourceRequestId||snapshot?.sourceRequestId||'—')}</dd></div>
        </dl>
      </section>`;
  }

  function dateButtons(date){
    const dates=[...root.document.querySelectorAll(`${PANEL_SELECTOR} [data-cfv15-view]`)]
      .map(el=>String(el.getAttribute('data-cfv15-view')||''))
      .filter(value=>/^20\d{2}-\d{2}-\d{2}$/.test(value));
    const unique=[...new Set(dates)].sort();
    const index=unique.indexOf(date);
    const prev=index>0?unique[index-1]:'';
    const next=index>=0&&index<unique.length-1?unique[index+1]:'';
    return {prev,next};
  }

  function render(item){
    const snapshot=item?.snapshot||{};
    const finalResult=snapshot?.result||{};
    const adjusted=finalResult?.adjustment?.applied===true;
    const originalResult=snapshot?.originalResult||null;
    const final=resultView(finalResult);
    const original=originalResult?resultView(originalResult):null;
    const nav=dateButtons(item?.targetDate||'');
    const comparisonReady=adjusted&&original;

    const notice=adjusted
      ? comparisonReady
        ? ''
        : `<div class="cfh-final-notice is-warning"><strong>혼소조정은 적용되어 있습니다.</strong><span>이전 저장분의 원본 비교값을 복원하지 못해 최종 마감값만 표시합니다.</span></div>`
      : `<div class="cfh-final-notice"><strong>이 날짜는 혼소조정을 적용하지 않았습니다.</strong><span>최종 마감값은 원본 계산값과 동일합니다.</span></div>`;

    return `
      <div class="cfh-final-heading">
        <div>
          <h2>${dateHeading(item?.targetDate||'')}</h2>
          <span class="cfh-final-status ${adjusted?'is-adjusted':'is-original'}">${adjusted?'혼소조정 적용':'혼소조정 없음'}</span>
        </div>
        <div class="cfh-final-nav">
          <button type="button" data-cfh-final-date="${esc(nav.prev)}" ${nav.prev?'':'disabled'}>이전일</button>
          <button type="button" data-cfh-final-date="${esc(nav.next)}" ${nav.next?'':'disabled'}>다음일</button>
        </div>
      </div>

      <div class="cfh-final-summary-meta">
        <span>마감 저장 <b>${localDateTime(item?.updatedAt)}</b></span>
        <span>계산 기준 <b>${periodLabel(snapshot?.period)}</b></span>
        <span>저장자 <b>${esc(item?.savedByName||'—')}</b></span>
      </div>

      ${notice}

      <nav class="cfh-final-tabs" role="tablist" aria-label="마감 데이터 상세 탭">
        <button type="button" class="is-active" data-cfh-final-tab="compare" role="tab" aria-selected="true">${adjusted?'원본값 ↔ 혼소조정 비교':'최종 마감값'}</button>
        <button type="button" data-cfh-final-tab="basis" role="tab" aria-selected="false">마감 기준</button>
        <button type="button" data-cfh-final-tab="meta" role="tab" aria-selected="false">저장 정보</button>
      </nav>

      <div class="cfh-final-tab-panel is-active" data-cfh-final-panel="compare">
        ${combinedStrip(original?.combined||null,final.combined,comparisonReady)}
        ${comparisonReady
          ? compareUnit(1,original.unit1,final.unit1)+compareUnit(2,original.unit2,final.unit2)
          : singleUnit(1,final.unit1)+singleUnit(2,final.unit2)}
      </div>

      <div class="cfh-final-tab-panel" data-cfh-final-panel="basis" hidden>
        ${settingsMarkup(snapshot?.settings||{})}
      </div>

      <div class="cfh-final-tab-panel" data-cfh-final-panel="meta" hidden>
        ${metaMarkup(item,snapshot)}
      </div>

      <div class="cfh-final-remark"><strong>비고</strong><span>특이사항이 없습니다.</span></div>`;
  }

  function ensureDrawer(){
    if(drawer?.isConnected)return drawer;
    const panel=root.document.querySelector('.efficiency-team-panel');
    if(!panel)return null;

    drawer=root.document.createElement('aside');
    drawer.className='cfh-final-drawer';
    drawer.setAttribute('aria-label','마감 데이터 상세');
    drawer.setAttribute('aria-hidden','true');
    drawer.hidden=true;
    drawer.innerHTML=`
      <header class="cfh-final-drawer-head">
        <strong>마감 데이터 상세</strong>
        <button type="button" data-cfh-final-close aria-label="마감 데이터 상세 닫기">×</button>
      </header>
      <div class="cfh-final-drawer-body" data-cfh-final-content></div>
      <footer class="cfh-final-drawer-foot"><button type="button" data-cfh-final-close>닫기</button></footer>`;
    panel.appendChild(drawer);
    content=drawer.querySelector('[data-cfh-final-content]');

    drawer.addEventListener('click',event=>{
      const close=event.target.closest?.('[data-cfh-final-close]');
      if(close){closeDrawer();return;}

      const dateButton=event.target.closest?.('[data-cfh-final-date]');
      if(dateButton&&!dateButton.disabled){
        const date=dateButton.getAttribute('data-cfh-final-date')||'';
        if(date)void openDate(date,null);
        return;
      }

      const tab=event.target.closest?.('[data-cfh-final-tab]');
      if(tab){
        const key=tab.getAttribute('data-cfh-final-tab');
        drawer.querySelectorAll('[data-cfh-final-tab]').forEach(button=>{
          const active=button===tab;
          button.classList.toggle('is-active',active);
          button.setAttribute('aria-selected',active?'true':'false');
        });
        drawer.querySelectorAll('[data-cfh-final-panel]').forEach(panelEl=>{
          const active=panelEl.getAttribute('data-cfh-final-panel')===key;
          panelEl.hidden=!active;
          panelEl.classList.toggle('is-active',active);
        });
      }
    });

    return drawer;
  }

  function showDrawer(){
    const el=ensureDrawer();
    if(!el)return null;
    el.hidden=false;
    el.setAttribute('aria-hidden','false');
    el.closest('.efficiency-team-panel')?.classList.add('cfh-final-drawer-open');
    return el;
  }

  function closeDrawer(){
    requestEpoch++;
    currentDate='';
    if(opener){
      opener.setAttribute('aria-expanded','false');
      try{opener.focus({preventScroll:true});}catch(_){}
    }
    opener=null;
    if(drawer){
      drawer.hidden=true;
      drawer.setAttribute('aria-hidden','true');
      drawer.closest('.efficiency-team-panel')?.classList.remove('cfh-final-drawer-open');
    }
  }

  async function openDate(date,button){
    if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))return;
    const el=showDrawer();
    if(!el)return;

    if(opener&&opener!==button)opener.setAttribute('aria-expanded','false');
    opener=button||root.document.querySelector(`${PANEL_SELECTOR} [data-cfv15-view="${date}"]`)||null;
    opener?.setAttribute('aria-expanded','true');

    currentDate=date;
    const epoch=++requestEpoch;
    content.innerHTML=`<div class="cfh-final-loading"><strong>${esc(date)}</strong><span>마감 상세 자료를 불러오는 중입니다...</span></div>`;

    try{
      const payload=await api('?targetDate='+encodeURIComponent(date));
      if(epoch!==requestEpoch||currentDate!==date)return;
      if(!payload?.item)throw new Error('선택한 날짜의 마감 데이터를 찾지 못했습니다.');
      content.innerHTML=render(payload.item);
      content.scrollTop=0;
    }catch(error){
      if(epoch!==requestEpoch)return;
      content.innerHTML=`<div class="cfh-final-loading is-error"><strong>상세 조회 실패</strong><span>${esc(error.message)}</span></div>`;
    }
  }

  async function loadMonthFlags(month){
    if(markerCache.has(month))return markerCache.get(month);
    const promise=api('?month='+encodeURIComponent(month)).then(payload=>Array.isArray(payload?.items)?payload.items:[]);
    markerCache.set(month,promise);
    try{return await promise;}
    catch(error){
      if(markerCache.get(month)===promise)markerCache.delete(month);
      throw error;
    }
  }

  async function syncMarkers(){
    const panel=root.document.querySelector(PANEL_SELECTOR);
    if(!panel)return;
    const groups=[...panel.querySelectorAll('.cfh-day-group[data-cfh-date]')];
    if(!groups.length)return;
    const month=String(panel.querySelector('[data-cfv15-month]')?.value||groups[0].getAttribute('data-cfh-date')?.slice(0,7)||'');
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return;

    const epoch=++markerEpoch;
    try{
      const items=await loadMonthFlags(month);
      if(epoch!==markerEpoch)return;
      const map=new Map(items.map(item=>[String(item?.targetDate||''),item?.adjustmentApplied===true]));
      for(const group of groups){
        const date=String(group.getAttribute('data-cfh-date')||'');
        const dateCell=group.querySelector('.cfh-date');
        group.classList.remove('cfh-final-adjusted-day');
        dateCell?.querySelector('.cfh-final-adjust-dot')?.remove();
        if(map.get(date)!==true)continue;
        group.classList.add('cfh-final-adjusted-day');
        const strong=dateCell?.querySelector('strong');
        if(strong){
          const dot=root.document.createElement('span');
          dot.className='cfh-final-adjust-dot';
          dot.setAttribute('aria-label','혼소조정 적용');
          dot.setAttribute('title','혼소조정 적용');
          strong.insertAdjacentElement('afterend',dot);
        }
      }
    }catch(_){
      // Marker decoration is non-critical; the existing history table remains usable.
    }
  }

  function scheduleMarkers(){
    if(markerTimer!==null)root.clearTimeout(markerTimer);
    markerTimer=root.setTimeout(()=>{
      markerTimer=null;
      void syncMarkers();
    },80);
  }

  function attachHostObserver(){
    const host=root.document.querySelector(`${PANEL_SELECTOR} [data-cfv15-host]`);
    if(!host)return false;
    if(hostObserver)hostObserver.disconnect();
    hostObserver=new MutationObserver(scheduleMarkers);
    hostObserver.observe(host,{childList:true,subtree:true});
    scheduleMarkers();
    return true;
  }

  function captureView(event){
    const view=event.target?.closest?.('[data-cfv15-view]');
    if(!view||!view.closest(PANEL_SELECTOR))return;
    const date=String(view.getAttribute('data-cfv15-view')||'');
    if(!date)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    void openDate(date,view);
  }

  function boot(){
    root.document.addEventListener('click',captureView,true);

    const modal=root.document.getElementById('efficiencyTeamModal');
    if(modal&&root.MutationObserver){
      new MutationObserver(()=>{
        if(modal.getAttribute('aria-hidden')==='true')closeDrawer();
      }).observe(modal,{attributes:true,attributeFilter:['aria-hidden']});
    }

    if(attachHostObserver())return;
    if(!root.MutationObserver||!root.document.body)return;
    const observer=new MutationObserver(()=>{
      if(attachHostObserver())observer.disconnect();
    });
    observer.observe(root.document.body,{childList:true,subtree:true});
  }

  root.addEventListener?.('cofiring:closed-history-changed',()=>{
    markerCache.clear();
    scheduleMarkers();
    if(currentDate)void openDate(currentDate,opener);
  });

  root.CofiringClosedHistoryFinalDetailV1={
    VERSION,
    resultView,
    unitView,
    combinedView,
    openDate,
    closeDrawer,
    syncMarkers
  };

  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }
})(typeof globalThis==='object'?globalThis:this);
