(function(root){
  'use strict';

  if(root.__cofiringClosedHistoryMonthlyV3Installed)return;
  root.__cofiringClosedHistoryMonthlyV3Installed=true;

  const API='/api/cofiring-closed-history';
  const HYPOTHESIS_API='/api/cofiring-provisional-v12';
  const HYPOTHESIS_DATES=new Set(['2026-10-23','2026-10-24']);
  const VERSION='COFIRING_CLOSED_HISTORY_READABLE_V1';
  const UNITS=['unit1','unit2'];
  const FUELS=['coal','bio','organic','manure'];

  const number=value=>{
    if(value===null||value===undefined||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))return null;
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

  // An unverified calculation is an auditable, separately saved record. It may
  // appear in the SAME monthly table, but is never a certified closing row.
  async function hypothesisApi(query=''){
    const response=await root.fetch(HYPOTHESIS_API+query,{credentials:'same-origin',cache:'no-store',headers:{...authHeaders(),Accept:'application/json'}});
    const payload=await response.json().catch(()=>null);
    if(!response.ok||payload?.ok!==true)throw new Error(payload?.message||'가정 계산 기록을 불러오지 못했습니다.');
    return payload;
  }
  function isHypothesis(item){
    return !!item&&HYPOTHESIS_DATES.has(item.targetDate)&&item.recordKind==='hypothesis'&&
      item.verificationStatus==='unverified'&&item.officialClose===false&&
      item.assumption?.silo==='organicStorageSiloB'&&item.assumption?.boundaryLocal==='2026-10-24T00:00'&&
      Math.abs(item.assumption.tons-19.143)<0.00001&&
      ['unit1','unit2'].every(u=>['coal','bio','organic','manure','bioRatio','organicGroupRatio','totalRatio']
        .every(f=>typeof item.summary?.[u]?.[f]==='number'&&Number.isFinite(item.summary[u][f])&&item.summary[u][f]>=0));
  }
  function mergeOfficialAndHypothesis(official,hypothesis){
    const byDate=new Map((official||[]).filter(x=>x&&typeof x.targetDate==='string').map(x=>[x.targetDate,x]));
    for(const item of hypothesis||[]){if(isHypothesis(item)&&!byDate.has(item.targetDate))byDate.set(item.targetDate,item);}
    return [...byDate.values()].sort((a,b)=>b.targetDate.localeCompare(a.targetDate));
  }

  // COFIRING_TOTAL_HEAT_BASIS_V2_R3: read the canonical total-heat Bio ratio from the stored result.
  function unitBioRatio(unit){
    const direct=number(unit?.fuelRatios?.bio)??number(unit?.ratios?.bio);
    if(direct!==null)return direct;
    const bio=number(unit?.heats?.bio),total=number(unit?.heats?.total);
    return bio===null||total===null||total<=0?null:bio/total*100;
  }

  function combinedBioRatio(result){
    const direct=number(result?.combined?.fuelRatios?.bio)??number(result?.combined?.ratios?.bio);
    if(direct!==null)return direct;
    let bio=number(result?.combined?.heats?.bio),total=number(result?.combined?.heats?.total);
    if(bio===null){const a=number(result?.units?.unit1?.heats?.bio),b=number(result?.units?.unit2?.heats?.bio);if(a!==null&&b!==null)bio=a+b;}
    if(total===null){const a=number(result?.units?.unit1?.heats?.total),b=number(result?.units?.unit2?.heats?.total);if(a!==null&&b!==null)total=a+b;}
    return bio===null||total===null||total<=0?null:bio/total*100;
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
    if(isHypothesis(item)){
      const record=item.record||{};
      return {targetDate:item.targetDate,unit1:unitSnapshot(null,'unit1',item.summary.unit1),
        unit2:unitSnapshot(null,'unit2',item.summary.unit2),
        combined:{bioRatio:number(item.summary.combined?.bioRatio),organicGroupRatio:number(item.summary.combined?.organicGroupRatio),totalRatio:number(item.summary.combined?.totalRatio)},
        settings:record.settings||{},manual:{},sourceRequestId:item.sourceRequestId||'',savedByName:item.savedByName||'',
        updatedAt:item.savedAt||'',adjustmentApplied:false,revision:item.revision||'',isHypothesis:true,
        hypothesisNote:'유기성 Storage B 2026-10-24 00:00 재고를 19.143t으로 가정한 미확정 저장 기록 · 재확인 필요'};
    }
    const snapshot=item?.snapshot||{};
    const result=item?.effectiveResult||snapshot?.result||{};
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
      adjustmentApplied:item?.adjustmentApplied===true||result?.adjustment?.applied===true,
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
    if(row.isHypothesis){return `<div class="cfh-readable-detail-head"><strong>${escapeHtml(row.targetDate)} 가정 계산 상세 · 미확정</strong><button type="button" data-cfh-detail-close>접기</button></div>
      <p class="cfh-hypothesis-notice">${escapeHtml(row.hypothesisNote)}. DataPARC 원본값이 아니며 공식 마감으로 인정되지 않습니다.</p>
      <div class="cfh-readable-detail-units">${UNITS.map((u,index)=>`<section class="cfh-readable-detail-unit"><h4>${index+1}호기</h4>
        <dl class="cfh-readable-detail-ratios">${[['바이오',row[u].bioRatio],['유기성·축분',row[u].organicGroupRatio],['종합 혼소율',row[u].totalRatio]].map(([label,value])=>`<div><dt>${label}</dt><dd>${fmtPct(value)}</dd></div>`).join('')}</dl>
        <dl class="cfh-readable-detail-fuels">${FUELS.map((fuel,i)=>`<div><dt>${['Coal','Bio','유기성','축분'][i]}</dt><dd>${fmtTon(row[u][fuel])} <small>t</small></dd></div>`).join('')}</dl>
        </section>`).join('')}</div>
      <p class="cfh-hypothesis-notice">별도 가정 기록 · 저장자 ${escapeHtml(row.savedByName||'—')} · 저장 ${dateTime(row.updatedAt)} · 공식 마감자료를 대체하지 않습니다.</p>`;}
    return `
      <div class="cfh-readable-detail-head"><strong>${escapeHtml(row.targetDate)} 마감 상세</strong><button type="button" data-cfh-detail-close>접기</button></div>
      <div class="cfh-readable-detail-units">${UNITS.map((key,index)=>`
        <section class="cfh-readable-detail-unit"><h4>${index+1}호기</h4>
          <dl class="cfh-readable-detail-ratios">${[['바이오',row[key].bioRatio],['유기성·축분',row[key].organicGroupRatio],['종합 혼소율',row[key].totalRatio]].map(([label,value])=>`<div><dt>${label}</dt><dd>${fmtPct(value)}</dd></div>`).join('')}</dl>
          <dl class="cfh-readable-detail-fuels">${FUELS.map((fuel,i)=>`<div><dt>${['Coal','Bio','유기성','축분'][i]}</dt><dd>${fmtTon(row[key][fuel])} <small>t</small></dd></div>`).join('')}</dl>
        </section>`).join('')}</div>
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

  function numericCells(unit,index){
    const ratios=['bioRatio','organicGroupRatio','totalRatio'];
    return `<th class="cfh-unit cfh-unit-${index+1}" scope="row">${index+1}호기</th>`+
      FUELS.map(fuel=>`<td class="cfh-value${number(unit[fuel])===0?' cfh-zero':''}">${fmtTon(unit[fuel])}</td>`).join('')+
      ratios.map((key,i)=>`<td class="cfh-value${i===0?' cfh-rate-start':''}${i===2?' cfh-unit-total':''}">${fmtPct(unit[key]).replace(/%$/,'')}</td>`).join('');
  }

  function combinedCell(combined){
    return `<td class="cfh-combined" rowspan="2">
      <div class="cfh-combined-main"><span>종합</span><strong>${fmtPct(combined.totalRatio)}</strong></div>
      <div class="cfh-combined-sub"><span>Bio</span><b>${fmtPct(combined.bioRatio)}</b></div>
      <div class="cfh-combined-sub"><span>유·축</span><b>${fmtPct(combined.organicGroupRatio)}</b></div>
    </td>`;
  }

  function rowMarkup(row){
    const date=String(row.targetDate||'');
    const hypothesis=row.isHypothesis===true;
    const valid=/^20\d{2}-\d{2}-\d{2}$/.test(date);
    const weekday=valid?['일','월','화','수','목','금','토'][new Date(date+'T00:00:00Z').getUTCDay()]:'';
    const adjusted=row?.adjustmentApplied===true;
    const adjustmentMark=adjusted?'<span class="cfh-list-adjust-dot" aria-label="혼소조정 적용" title="혼소조정 적용"></span>':'';
    return `<tbody class="cfh-day-group${adjusted?' cfh-list-adjusted-day':''}${hypothesis?' cfh-hypothesis-day':''}" data-cfh-date="${escapeHtml(date)}" data-cfh-list-adjustment="1"${hypothesis?' data-cfh-hypothesis="true" title="가정 계산 · 미확정 · 공식 마감 아님"':''}>
      <tr data-cfv15-row="${escapeHtml(date)}">
        <th class="cfh-date" scope="rowgroup" rowspan="2" aria-label="${escapeHtml(date)}"><span class="cfh-date-line"><strong>${escapeHtml(valid?date.slice(5).replace('-','.'):date)}</strong>${adjustmentMark}${hypothesis?'<span class="cfh-hypothesis-tag" title="00:00 재고 가정 · 재확인 필요">가정</span>':''}</span><small>${weekday?weekday+'요일':''}</small></th>
        ${numericCells(row.unit1,0)}${combinedCell(row.combined)}
        <td class="cfh-actions" rowspan="2"><button type="button" data-cfv15-view="${escapeHtml(date)}" ${hypothesis?'data-cfv15-hypothesis="true" ':''}aria-label="${escapeHtml(date)} ${hypothesis?'가정 계산':'마감'} 상세 보기" aria-controls="cfh-readable-detail" aria-expanded="false">보기</button>${hypothesis?'<span class="cfh-hypothesis-readonly" title="실측 마감과 별도 보존된 미확정 기록입니다">미확정</span>':`<button type="button" class="danger" data-cfv15-delete="${escapeHtml(date)}" aria-label="${escapeHtml(date)} 마감 데이터 삭제">삭제</button>`}</td>
      </tr><tr>${numericCells(row.unit2,1)}</tr>
    </tbody>`;
  }

  function averageMarkup(rows){
    // An assumed inventory must never change certified monthly KPIs.
    const certified=rows.filter(row=>row.isHypothesis!==true);
    if(!certified.length)return '';
    const a=averageRows(certified);
    return `<tfoot class="cfh-average-group">
      <tr><th class="cfh-date" scope="rowgroup" rowspan="2"><strong>월평균</strong><small>${certified.length}일 · 실측만</small></th>
        ${numericCells(a.unit1,0)}${combinedCell(a.combined)}<td class="cfh-average-label" rowspan="2">평균</td>
      </tr><tr>${numericCells(a.unit2,1)}</tr>
    </tfoot>`;
  }

  function tableMarkup(rows,month){
    if(!rows.length){
      return `<div class="cfv15-state"><strong>${escapeHtml(monthLabel(month))} 마감 데이터가 없습니다.</strong><span>마감 저장 후 날짜별 1·2호기 수치를 확인할 수 있습니다.</span></div>`;
    }
    return `
      ${rows.some(row=>row.isHypothesis)?'<p class="cfh-hypothesis-notice"><strong>가정 계산 · 미확정 기록 포함</strong> · 2026-10-24 00:00 Storage B 재고 추정(19.143t) · 통신 오류로 실제 계측값과 다를 수 있습니다. 월평균에서는 제외됩니다.</p>':''}
      <div class="cfv15-table-wrap cfh-readable-wrap" tabindex="0" role="region" aria-label="날짜별 마감 데이터 비교 표">
        <table class="cfv15-history-table cfh-readable-table" aria-label="${escapeHtml(monthLabel(month))} 혼소율 마감 데이터">
          <colgroup><col class="cfh-date-col"><col class="cfh-unit-col"><col span="4" class="cfh-fuel-col"><col span="3" class="cfh-ratio-col"><col class="cfh-combined-col"><col class="cfh-actions-col"></colgroup>
          <thead>
            <tr>
              <th rowspan="2" scope="col">일자</th><th rowspan="2" scope="col">호기</th>
              <th colspan="4" scope="colgroup">연료 사용량 · t</th>
              <th colspan="3" scope="colgroup" class="cfh-rate-start">혼소율 · %</th>
              <th rowspan="2" scope="col" class="cfh-combined-head">1·2호기 종합</th>
              <th rowspan="2" scope="col">관리</th>
            </tr>
            <tr>
              <th scope="col">Coal</th><th scope="col">Bio</th><th scope="col">유기성</th><th scope="col">축분</th>
              <th scope="col" class="cfh-rate-start">Bio</th><th scope="col">유·축</th><th scope="col">종합</th>
            </tr>
          </thead>
          ${rows.map(rowMarkup).join('')}${averageMarkup(rows)}
        </table>
      </div><div class="cfh-readable-notes"><span>유·축 = 유기성·축분 혼소율 · 일별 종합: 열량 가중</span><span>월평균: 공식 마감일만 산술평균 · 가정값 제외</span></div>`;
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
    panel.classList.add('cfv15-monthly','cfh-readable-panel');

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
      const fetcher=isHypothesis(item)?hypothesisApi:api;
      const promise=fetcher('?targetDate='+encodeURIComponent(date)).then(payload=>{
        if(payload?.item&&payload.item.targetDate!==date)throw new Error('마감 상세 자료의 날짜가 다릅니다.');
        return payload?.item||null;
      });
      detailCache.set(date,promise);
      try{return await promise;}catch(error){if(detailCache.get(date)===promise)detailCache.delete(date);throw error;}
    }

    function setMonth(month){
      selectedMonth=normalizeMonth(month)||koreanCurrentMonth();
      monthInput.value=selectedMonth;
      monthText.textContent=monthLabel(selectedMonth);
      void loadList({keepMonth:true});
    }

    async function loadList({keepMonth=true}={}){
      const epoch=++loadEpoch;
      detailCache.clear();
      host.innerHTML='<div class="cfv15-state">마감 데이터 목록을 확인하는 중입니다...</div>';
      try{
        if(!keepMonth||!selectedMonth){
          const [latest,hypothesis]=await Promise.all([api('?limit=1'),hypothesisApi('?limit=1').catch(()=>({items:[]}))]);
          if(epoch!==loadEpoch)return;
          const latestDate=[latest.items?.[0]?.targetDate,hypothesis.items?.[0]?.targetDate].filter(Boolean).sort().at(-1);
          selectedMonth=normalizeMonth(latestDate?.slice?.(0,7))||koreanCurrentMonth();
        }
        const month=selectedMonth;
        const [payload,hypothetical]=await Promise.all([api('?month='+encodeURIComponent(month)),
          hypothesisApi('?limit=180').catch(error=>{root.console?.warn?.('가정 계산 목록 조회 실패',error?.message);return {items:[]};})]);
        if(epoch!==loadEpoch||month!==selectedMonth)return;
        listItems=mergeOfficialAndHypothesis(payload?.items, hypothetical.items);
        monthInput.value=selectedMonth;monthText.textContent=monthLabel(selectedMonth);
        await renderMonth(epoch);
      }catch(error){
        if(epoch!==loadEpoch)return;
        host.innerHTML=`<div class="cfv15-state is-error">${escapeHtml(error.message)}</div>`;
      }
    }

    async function renderMonth(epoch=loadEpoch){
      openDate='';
      const month=selectedMonth;
      const items=listItems.filter(item=>String(item?.targetDate||'').slice(0,7)===month);
      const estimatedCount=items.filter(isHypothesis).length;
      countText.textContent=`${items.length}일 표시${estimatedCount?' · 가정 '+estimatedCount+'일':''}`;
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
      if(epoch!==loadEpoch||month!==selectedMonth||month!==monthInput.value)return;
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
      const detailRow=root.document.createElement('section');
      detailRow.className='cfh-readable-detail';
      detailRow.id='cfh-readable-detail';
      detailRow.setAttribute('data-cfv15-detail-row',date);
      detailRow.setAttribute('aria-label',date+' 마감 상세');
      detailRow.innerHTML='<div class="cfv15-state" role="status">상세 기준값을 불러오는 중입니다...</div>';
      host.append(detailRow);
      openDate=date;

      try{
        const item=listItems.find(x=>x.targetDate===date);
        const detail=await getDetail(item||{targetDate:date});
        if(openDate!==date||!detailRow.isConnected)return;
        const derived=deriveSnapshot(detail);
        detailRow.innerHTML=detailMarkup(detail,derived);
        detailRow.scrollIntoView?.({block:'nearest'});
      }catch(error){
        if(detailRow.isConnected)detailRow.innerHTML=`<div class="cfv15-state is-error" role="alert">${escapeHtml(error.message)}</div>`;
      }
    }

    async function deleteDate(date){
      const item=listItems.find(row=>row.targetDate===date);
      if(!item||isHypothesis(item)){root.alert?.('가정 계산 기록은 공식 마감 삭제 기능으로 처리하지 않습니다.');return;}
      if(!root.confirm?.(date+' 마감 데이터를 삭제하시겠습니까?'))return;
      try{
        if(!item||!Number.isSafeInteger(item.revision)||!/^[a-f0-9]{64}$/.test(item.version||''))throw new Error('마감 목록을 새로고침하고 다시 확인해 주세요.');
        const query=new URLSearchParams({targetDate:date,expectedRevision:item.revision,expectedVersion:item.version});
        await api('?'+query.toString(),{method:'DELETE'});
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
      if(event.target.closest?.('[data-cfh-detail-close]')){
        const date=openDate;
        host.querySelector('[data-cfv15-detail-row]')?.remove();
        const button=host.querySelector(`[data-cfv15-view="${date}"]`);
        button?.setAttribute('aria-expanded','false');
        button?.focus({preventScroll:true});
        openDate='';
        return;
      }
      const view=event.target.closest?.('[data-cfv15-view]');
      const del=event.target.closest?.('[data-cfv15-delete]');
      const go=event.target.closest?.('[data-cfv15-go]');
      if(view){void toggleDetail(view.getAttribute('data-cfv15-view')||'');return;}
      if(del){void deleteDate(del.getAttribute('data-cfv15-delete')||'');return;}
      if(go)goDate(go.getAttribute('data-cfv15-go')||'');
    });

    panel.querySelector('[data-cfv12-refresh]')?.addEventListener('click',()=>void loadList({keepMonth:true}));
    root.addEventListener?.('cofiring:closed-history-changed',()=>{
      detailCache.clear();if(!panel.hidden)void loadList({keepMonth:true});
    });

    root.addEventListener?.('cofiring:period-adjustment-changed',()=>{
      detailCache.clear();
      if(!panel.hidden)void loadList({keepMonth:true});
    });
    root.addEventListener?.('cofiring:provisional-inline-updated',()=>{
      detailCache.clear();
      if(!panel.hidden)void loadList({keepMonth:true});
    });

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

  const exported={VERSION,deriveSnapshot,averageRows,normalizeMonth,shiftMonth,unitBioRatio,combinedBioRatio,isHypothesis,mergeOfficialAndHypothesis,rowMarkup,tableMarkup,detailMarkup};
  root.CofiringClosedHistoryMonthlyV3=exported;
  if(typeof module==='object'&&module.exports)module.exports=exported;

  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }
})(typeof globalThis==='object'?globalThis:this);
// Readable table markup owns its columns, dates and average rows directly.
