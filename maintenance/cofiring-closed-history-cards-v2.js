(function(root){
  'use strict';

  if(root.__cofiringClosedHistoryMonthlyV3Installed)return;
  root.__cofiringClosedHistoryMonthlyV3Installed=true;

  const API='/api/cofiring-closed-history';
  const VERSION='COFIRING_CLOSED_HISTORY_COMPACT_V4_R3';
  const UNITS=['unit1','unit2'];
  const FUELS=['coal','bio','organic','manure'];

  const number=value=>{
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  };

  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  function fmtTon(value){
    const n=number(value);
    return n===null?'—':n.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function fmtPct(value){
    const n=number(value);
    return n===null?'—':n.toFixed(2)+'%';
  }

  function scalar(value){
    const n=number(value);
    return n===null?'—':n.toLocaleString('ko-KR',{maximumFractionDigits:6});
  }

  function authHeaders(){
    try{
      return typeof root.getShiftLogAuthHeaders==='function'?root.getShiftLogAuthHeaders():{};
    }catch(_){return {};}
  }

  async function api(path='',options={}){
    const response=await root.fetch(API+path,{
      credentials:'same-origin',
      cache:'no-store',
      ...options,
      headers:{...authHeaders(),Accept:'application/json',...(options.headers||{})}
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
      const a=number(result?.units?.unit1?.heats?.coal),b=number(result?.units?.unit2?.heats?.coal);
      if(a!==null&&b!==null)coal=a+b;
    }
    if(bio===null){
      const a=number(result?.units?.unit1?.heats?.bio),b=number(result?.units?.unit2?.heats?.bio);
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
      organicGroupRatio:number(unit?.fuelRatios?.organicGroup)??number(unit?.ratios?.organicGroup)??number(fallback?.organicGroupRatio),
      totalRatio:number(unit?.fuelRatios?.total)??number(unit?.ratios?.total)??number(fallback?.totalRatio)
    };
  }

  function deriveSnapshot(item){
    const snapshot=item?.snapshot||{};
    const result=snapshot?.result||{};
    const fallback=snapshot?.summary||item?.summary||{};
    return {
      targetDate:String(item?.targetDate||snapshot?.targetDate||''),
      unit1:unitSnapshot(result,'unit1',fallback?.unit1),
      unit2:unitSnapshot(result,'unit2',fallback?.unit2),
      combined:{
        bioRatio:combinedBioRatio(result)??number(fallback?.combined?.bioRatio),
        organicGroupRatio:number(result?.combined?.fuelRatios?.organicGroup)??number(result?.combined?.ratios?.organicGroup)??number(fallback?.combined?.organicGroupRatio),
        totalRatio:number(result?.combined?.fuelRatios?.total)??number(result?.combined?.ratios?.total)??number(fallback?.combined?.totalRatio)
      },
      settings:snapshot?.settings||{},
      manual:snapshot?.manual||{},
      capturedAt:String(snapshot?.capturedAt||''),
      sourceRequestId:String(item?.sourceRequestId||snapshot?.sourceRequestId||''),
      savedByName:String(item?.savedByName||''),
      updatedAt:String(item?.updatedAt||''),
      revision:item?.revision??''
    };
  }

  function normalizeMonth(value){
    const m=/^(20\d{2})-(\d{2})$/.exec(String(value||''));
    if(!m)return '';
    const month=Number(m[2]);
    return month>=1&&month<=12?m[1]+'-'+m[2]:'';
  }

  function koreanCurrentMonth(){
    return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7);
  }

  function shiftMonth(value,delta){
    const valid=normalizeMonth(value)||koreanCurrentMonth();
    const [y,m]=valid.split('-').map(Number);
    const d=new Date(Date.UTC(y,m-1+delta,1));
    return d.toISOString().slice(0,7);
  }

  function monthLabel(value){
    const valid=normalizeMonth(value);
    if(!valid)return '조회 월';
    const [y,m]=valid.split('-');
    return `${y}년 ${Number(m)}월`;
  }

  function dateTime(value){
    if(!value)return '—';
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))return escapeHtml(value);
    return escapeHtml(d.toLocaleString('ko-KR',{
      timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'
    }));
  }

  const NUMERIC_PATHS=[
    ['unit1','coal'],['unit1','bio'],['unit1','organic'],['unit1','manure'],['unit1','bioRatio'],['unit1','organicGroupRatio'],['unit1','totalRatio'],
    ['unit2','coal'],['unit2','bio'],['unit2','organic'],['unit2','manure'],['unit2','bioRatio'],['unit2','organicGroupRatio'],['unit2','totalRatio'],
    ['combined','bioRatio'],['combined','organicGroupRatio'],['combined','totalRatio']
  ];

  function pathValue(row,path){
    let value=row;
    for(const key of path)value=value?.[key];
    return number(value);
  }

  function averageRows(rows){
    const out={unit1:{},unit2:{},combined:{}};
    for(const path of NUMERIC_PATHS){
      const values=rows.map(row=>pathValue(row,path)).filter(v=>v!==null);
      const avg=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
      out[path[0]][path[1]]=avg;
    }
    return out;
  }

  function settingsRows(settings){
    const labels={coal:'Coal',bio:'Bio',organic:'유기성',manure:'축분'};
    return FUELS.map(fuel=>`
      <tr>
        <th>${labels[fuel]}</th>
        <td>${scalar(settings?.unit1?.[fuel]?.calorific)}</td>
        <td>${scalar(settings?.unit1?.[fuel]?.coefficient)}</td>
        <td>${scalar(settings?.unit2?.[fuel]?.calorific)}</td>
        <td>${scalar(settings?.unit2?.[fuel]?.coefficient)}</td>
      </tr>`).join('');
  }

  function detailMarkup(item,row){
    return `
      <div class="cfv15-detail-shell">
        <div class="cfv15-detail-grid">
          <section>
            <h4>마감 당시 발열량 · 보정계수</h4>
            <div class="cfv15-detail-table-wrap">
              <table>
                <thead><tr><th>연료</th><th>1호기 발열량</th><th>1호기 보정</th><th>2호기 발열량</th><th>2호기 보정</th></tr></thead>
                <tbody>${settingsRows(row.settings)}</tbody>
              </table>
            </div>
          </section>
          <section>
            <h4>마감 정보</h4>
            <dl class="cfv15-detail-meta">
              <div><dt>마감자</dt><dd>${escapeHtml(row.savedByName||'—')}</dd></div>
              <div><dt>마감 시각</dt><dd>${dateTime(row.updatedAt)}</dd></div>
              <div><dt>Revision</dt><dd>${escapeHtml(row.revision||'—')}</dd></div>
              <div><dt>스냅샷 생성</dt><dd>${dateTime(row.capturedAt)}</dd></div>
              <div class="is-wide"><dt>DataPARC 요청</dt><dd title="${escapeHtml(row.sourceRequestId)}">${escapeHtml(row.sourceRequestId||'—')}</dd></div>
            </dl>
            <div class="cfv15-detail-actions"><button type="button" data-cfv15-go="${escapeHtml(row.targetDate)}">계산일로 이동</button></div>
          </section>
        </div>
      </div>`;
  }

  function fuelCell(unit){
    return `<div class="cfv16-fuel-grid">
      <span><b>C</b><strong>${fmtTon(unit.coal)}</strong></span>
      <span><b>B</b><strong>${fmtTon(unit.bio)}</strong></span>
      <span><b>유</b><strong>${fmtTon(unit.organic)}</strong></span>
      <span><b>축</b><strong>${fmtTon(unit.manure)}</strong></span>
    </div>`;
  }

  function ratioCell(unit){
    return `<div class="cfv16-ratio-grid">
      <span><b>Bio</b><strong>${fmtPct(unit.bioRatio)}</strong></span>
      <span><b>유·축</b><strong>${fmtPct(unit.organicGroupRatio)}</strong></span>
      <span class="is-total"><b>종합</b><strong>${fmtPct(unit.totalRatio)}</strong></span>
    </div>`;
  }

  function combinedCell(row){
    return `<div class="cfv16-combined-grid">
      <span><b>Bio</b><strong>${fmtPct(row.combined.bioRatio)}</strong></span>
      <span><b>유·축</b><strong>${fmtPct(row.combined.organicGroupRatio)}</strong></span>
      <span class="is-total"><b>종합</b><strong>${fmtPct(row.combined.totalRatio)}</strong></span>
    </div>`;
  }

  function closeMetaCell(row){
    return `<div class="cfv16-meta"><strong>${escapeHtml(row.savedByName||'—')}</strong><span>${dateTime(row.updatedAt)}</span></div>`;
  }

  function rowMarkup(row){
    return `
      <tr data-cfv15-row="${escapeHtml(row.targetDate)}">
        <th scope="row"><strong>${escapeHtml(row.targetDate)}</strong></th>
        <td class="is-fuel is-unit1">${fuelCell(row.unit1)}</td>
        <td class="is-ratio is-unit1">${ratioCell(row.unit1)}</td>
        <td class="is-fuel is-unit2">${fuelCell(row.unit2)}</td>
        <td class="is-ratio is-unit2">${ratioCell(row.unit2)}</td>
        <td class="is-combined">${combinedCell(row)}</td>
        <td class="is-meta">${closeMetaCell(row)}</td>
        <td class="is-actions"><button type="button" data-cfv15-view="${escapeHtml(row.targetDate)}" aria-expanded="false">보기</button><button type="button" class="danger" data-cfv15-delete="${escapeHtml(row.targetDate)}">삭제</button></td>
      </tr>`;
  }

  function averageMarkup(rows){
    const a=averageRows(rows);
    const avgRow={combined:a.combined};
    return `
      <tr class="cfv15-average-row">
        <th scope="row"><strong>월 평균</strong><small>${rows.length}일</small></th>
        <td class="is-fuel is-unit1">${fuelCell(a.unit1)}</td>
        <td class="is-ratio is-unit1">${ratioCell(a.unit1)}</td>
        <td class="is-fuel is-unit2">${fuelCell(a.unit2)}</td>
        <td class="is-ratio is-unit2">${ratioCell(a.unit2)}</td>
        <td class="is-combined">${combinedCell(avgRow)}</td>
        <td class="is-meta"><div class="cfv16-meta"><strong>평균</strong><span>저장일 기준</span></div></td>
        <td class="is-actions"><span class="cfv16-average-note">평균</span></td>
      </tr>`;
  }

  function tableMarkup(rows,month){
    if(!rows.length){
      return `<div class="cfv15-state"><strong>${escapeHtml(monthLabel(month))} 마감 데이터가 없습니다.</strong><span>해당 월에 마감 저장된 날짜가 생기면 일별 한 줄로 표시됩니다.</span></div>`;
    }
    return `
      <div class="cfv15-table-wrap" tabindex="0">
        <table class="cfv15-history-table cfv16-compact-table" aria-label="${escapeHtml(monthLabel(month))} 혼소율 마감 데이터">
          <thead>
            <tr class="cfv15-group-head">
              <th rowspan="2" class="is-date">일자</th>
              <th colspan="2" class="is-unit1">1호기</th>
              <th colspan="2" class="is-unit2">2호기</th>
              <th rowspan="2" class="is-combined">1·2호기 종합</th>
              <th rowspan="2">마감정보</th>
              <th rowspan="2">관리</th>
            </tr>
            <tr class="cfv15-column-head">
              <th class="is-unit1">연료사용량<small>C / B / 유 / 축 · t</small></th>
              <th class="is-unit1">혼소율<small>Bio / 유·축 / 종합 · %</small></th>
              <th class="is-unit2">연료사용량<small>C / B / 유 / 축 · t</small></th>
              <th class="is-unit2">혼소율<small>Bio / 유·축 / 종합 · %</small></th>
            </tr>
          </thead>
          <tbody>${rows.map(rowMarkup).join('')}</tbody>
          <tfoot>${averageMarkup(rows)}</tfoot>
        </table>
      </div>`;
  }

  async function mapLimit(items,limit,worker){
    const result=new Array(items.length);
    let cursor=0;
    async function run(){
      while(cursor<items.length){
        const index=cursor++;
        result[index]=await worker(items[index],index);
      }
    }
    await Promise.all(Array.from({length:Math.min(limit,items.length)},run));
    return result;
  }

  function mount(){
    const panel=root.document?.querySelector?.('.cfv12-history-panel');
    if(!panel||panel.dataset.cfv15Mounted==='1')return false;
    const head=panel.querySelector('.cfv12-history-head');
    if(!head)return false;

    panel.dataset.cfv15Mounted='1';
    panel.classList.add('cfv15-monthly');

    panel.querySelector('.cfv14-history-list')?.remove();

    const toolbar=root.document.createElement('div');
    toolbar.className='cfv15-month-toolbar';
    toolbar.innerHTML=`
      <div class="cfv15-month-nav">
        <button type="button" data-cfv15-prev aria-label="이전 달">‹</button>
        <label><span>조회 월</span><input type="month" data-cfv15-month></label>
        <button type="button" data-cfv15-next aria-label="다음 달">›</button>
      </div>
      <div class="cfv15-month-status"><strong data-cfv15-month-label>조회 월</strong><span data-cfv15-count>0일 저장</span></div>`;

    const host=root.document.createElement('div');
    host.className='cfv15-history-host';
    host.setAttribute('data-cfv15-host','');
    head.after(toolbar,host);

    const monthInput=toolbar.querySelector('[data-cfv15-month]');
    const monthText=toolbar.querySelector('[data-cfv15-month-label]');
    const countText=toolbar.querySelector('[data-cfv15-count]');
    const detailCache=new Map();
    let listItems=[];
    let selectedMonth='';
    let loadEpoch=0;
    let openDate='';

    async function getDetail(item){
      const date=String(item?.targetDate||'');
      if(detailCache.has(date))return detailCache.get(date);
      const promise=api('?targetDate='+encodeURIComponent(date)).then(payload=>payload?.item||null);
      detailCache.set(date,promise);
      try{return await promise;}catch(error){detailCache.delete(date);throw error;}
    }

    function setMonth(month){
      selectedMonth=normalizeMonth(month)||koreanCurrentMonth();
      monthInput.value=selectedMonth;
      monthText.textContent=monthLabel(selectedMonth);
      void renderMonth();
    }

    async function loadList({keepMonth=true}={}){
      const epoch=++loadEpoch;
      host.innerHTML='<div class="cfv15-state">마감 데이터 목록을 확인하는 중입니다...</div>';
      try{
        const payload=await api('?limit=366');
        if(epoch!==loadEpoch)return;
        listItems=Array.isArray(payload?.items)?payload.items:[];
        const latestMonth=normalizeMonth(listItems[0]?.targetDate?.slice?.(0,7));
        if(!keepMonth||!selectedMonth)selectedMonth=latestMonth||koreanCurrentMonth();
        monthInput.value=selectedMonth;
        monthText.textContent=monthLabel(selectedMonth);
        await renderMonth(epoch);
      }catch(error){
        if(epoch!==loadEpoch)return;
        host.innerHTML=`<div class="cfv15-state is-error">${escapeHtml(error.message)}</div>`;
      }
    }

    async function renderMonth(epoch=loadEpoch){
      openDate='';
      const items=listItems.filter(item=>String(item?.targetDate||'').slice(0,7)===selectedMonth);
      countText.textContent=`${items.length}일 저장`;
      monthText.textContent=monthLabel(selectedMonth);
      if(!items.length){host.innerHTML=tableMarkup([],selectedMonth);return;}

      host.innerHTML=`<div class="cfv15-state"><strong>${escapeHtml(monthLabel(selectedMonth))}</strong><span>${items.length}일의 마감 스냅샷을 표로 정리하는 중입니다...</span></div>`;
      const rows=await mapLimit(items,6,async item=>{
        try{
          const detail=await getDetail(item);
          return deriveSnapshot(detail||item);
        }catch(_){
          return deriveSnapshot(item);
        }
      });
      if(epoch!==loadEpoch||selectedMonth!==monthInput.value)return;
      rows.sort((a,b)=>String(b.targetDate).localeCompare(String(a.targetDate)));
      host.innerHTML=tableMarkup(rows,selectedMonth);
    }

    async function toggleDetail(date){
      const row=host.querySelector(`[data-cfv15-row="${date}"]`);
      if(!row)return;
      const existing=host.querySelector('[data-cfv15-detail-row]');
      if(existing){
        const was=existing.getAttribute('data-cfv15-detail-row');
        existing.remove();
        host.querySelector(`[data-cfv15-view="${was}"]`)?.setAttribute('aria-expanded','false');
        if(was===date){openDate='';return;}
      }

      const button=host.querySelector(`[data-cfv15-view="${date}"]`);
      button?.setAttribute('aria-expanded','true');
      const detailRow=root.document.createElement('tr');
      detailRow.className='cfv15-detail-row';
      detailRow.setAttribute('data-cfv15-detail-row',date);
      detailRow.innerHTML='<td colspan="8"><div class="cfv15-state">상세 기준값을 불러오는 중입니다...</div></td>';
      row.after(detailRow);
      openDate=date;

      try{
        const item=listItems.find(x=>x.targetDate===date);
        const detail=await getDetail(item||{targetDate:date});
        if(openDate!==date||!detailRow.isConnected)return;
        const derived=deriveSnapshot(detail);
        detailRow.innerHTML=`<td colspan="8">${detailMarkup(detail,derived)}</td>`;
      }catch(error){
        if(detailRow.isConnected)detailRow.innerHTML=`<td colspan="8"><div class="cfv15-state is-error">${escapeHtml(error.message)}</div></td>`;
      }
    }

    async function deleteDate(date){
      if(!root.confirm?.(date+' 마감 데이터를 삭제하시겠습니까?'))return;
      try{
        await api('?targetDate='+encodeURIComponent(date),{method:'DELETE'});
        detailCache.delete(date);
        await loadList({keepMonth:true});
      }catch(error){root.alert?.(error.message);}
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
      panel.parentElement?.querySelector?.('.cfv12-tabs .cfv12-tab')?.click?.();
    }

    toolbar.addEventListener('click',event=>{
      if(event.target.closest?.('[data-cfv15-prev]'))setMonth(shiftMonth(selectedMonth,-1));
      if(event.target.closest?.('[data-cfv15-next]'))setMonth(shiftMonth(selectedMonth,1));
    });
    monthInput.addEventListener('change',()=>setMonth(monthInput.value));

    host.addEventListener('click',event=>{
      const view=event.target.closest?.('[data-cfv15-view]');
      const del=event.target.closest?.('[data-cfv15-delete]');
      const go=event.target.closest?.('[data-cfv15-go]');
      if(view){void toggleDetail(view.getAttribute('data-cfv15-view')||'');return;}
      if(del){void deleteDate(del.getAttribute('data-cfv15-delete')||'');return;}
      if(go)goDate(go.getAttribute('data-cfv15-go')||'');
    });

    panel.querySelector('[data-cfv12-refresh]')?.addEventListener('click',()=>void loadList({keepMonth:true}));

    const observer=root.MutationObserver?new root.MutationObserver(()=>{if(!panel.hidden)void loadList({keepMonth:true});}):null;
    observer?.observe(panel,{attributes:true,attributeFilter:['hidden']});

    if(!panel.hidden)void loadList({keepMonth:false});
    return true;
  }

  function boot(){
    if(mount())return;
    if(!root.document?.body||!root.MutationObserver)return;
    const observer=new root.MutationObserver(()=>{if(mount())observer.disconnect();});
    observer.observe(root.document.body,{childList:true,subtree:true});
  }

  const exported={VERSION,deriveSnapshot,averageRows,normalizeMonth,shiftMonth,unitBioRatio,combinedBioRatio};
  root.CofiringClosedHistoryMonthlyV3=exported;
  if(typeof module==='object'&&module.exports)module.exports=exported;

  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }
})(typeof globalThis==='object'?globalThis:this);
