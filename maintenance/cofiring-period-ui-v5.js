(function(root){
  'use strict';
  const core=root.CofiringCore||(typeof require==='function'?require('./cofiring-core.js'):null);
  const liveApi=root.CofiringLive;
  const settingsApi=root.CofiringCalculationSettingsStorage;
  const manualApi=root.CofiringPeriodManualStorage;
  const adjustmentApi=root.CofiringPeriodAdjustmentV56||(typeof require==='function'?require('./cofiring-period-adjustment-v56.js'):null);
  const deadlineTargetApi=root.CofiringDeadlineTargetV1||(typeof require==='function'?require('./cofiring-deadline-target-v1.js'):null);
  const FUEL_LABEL={coal:'Coal',bio:'Bio',organic:'유기성',manure:'축분'};
  const FUEL_KEYS=['coal','bio','organic','manure'];
  const UNITS=['unit1','unit2'];
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,p=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ko-KR',{minimumFractionDigits:p,maximumFractionDigits:p}):'—';
  const pct=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(2)+'%':'—';
  const sum=values=>values.every(v=>typeof v==='number'&&Number.isFinite(v))?values.reduce((a,b)=>a+b,0):null;
  function coalBioHeat(unit){const coal=unit?.heats?.coal,bio=unit?.heats?.bio;return typeof coal==='number'&&Number.isFinite(coal)&&typeof bio==='number'&&Number.isFinite(bio)?coal+bio:null;}
  function coalBioRatio(unit){const total=coalBioHeat(unit),bio=unit?.heats?.bio;return total!==null&&total>0&&typeof bio==='number'&&Number.isFinite(bio)?bio/total*100:null;}
  function combinedCoalBio(result){const coal=result?.combined?.heats?.coal,bio=result?.combined?.heats?.bio;const total=typeof coal==='number'&&Number.isFinite(coal)&&typeof bio==='number'&&Number.isFinite(bio)?coal+bio:null;return {heat:total,ratio:total!==null&&total>0?bio/total*100:null};}
  function cachedReference(state,spec){
    const item=state?.item,reference=item?.result?.report?.reference;
    if(!state?.authenticated||!state.canQuery||!item?.saved||!reference||item.active||item.loading||item.submitting||item.error)return null;
    if(item.result.requestId!==item.saved.id||reference.kind!=='cofiring_period_summary_v1')return null;
    for(const key of ['startLocal','endLocal','stepUnit','stepValue'])if(state.period?.[key]!==spec?.[key]||reference[key]!==spec?.[key])return null;
    return reference;
  }
  function liveRequestPresentation(state,{conflictRetrying=false}={}){
    const item=state?.item,active=item?.active;
    const busy=!!(item?.submitting||item?.loading||conflictRetrying);
    const failure=!active&&item?.lastAttempt?.status==='failed'?item.lastAttempt:null;
    const buttonText=!state?.authenticated?'로그인 필요':conflictRetrying?'이전 조회 대기...':item?.submitting?'요청 등록 중...':active?'상태 확인':item?.loading?'상태 확인 중...':'계산하기';
    const labels={starting:'조회 환경 준비 중',reading:'DataPARC 계산 중',cleanup:'조회용 Excel 정리 중',uploading:'결과 저장 중'};
    const details={starting:'회사 PC에서 조회 환경과 DataPARC 연결을 준비하고 있습니다.',reading:'선택 기간의 사용량과 데이터 품질을 확인하고 있습니다.',cleanup:'조회에 사용한 Excel의 종료를 확인하고 있습니다.',uploading:'검증된 조회 결과를 서버에 저장하고 있습니다.'};
    const fallbackLabel=active?.status==='processing'?'DataPARC 작업 중':'';
    const phase=active?.status==='processing'&&Object.hasOwn(labels,active.progress?.phase)?active.progress.phase:null;
    return {busy,buttonText,failureMessage:failure?(String(failure.errorMessage||'').trim()||'DataPARC 조회에 실패했습니다.'):'',progressLabel:phase?labels[phase]:fallbackLabel,progressMessage:active?.status==='processing'?`${phase?details[phase]:'DataPARC 조회·Excel 정리 작업이 진행 중입니다.'} 서버에 저장 결과가 도착하면 숫자가 자동 표시됩니다. 아직 계산 완료가 아닙니다.`:''};
  }
  function authHeaders(){return typeof root.getShiftLogAuthHeaders==='function'?root.getShiftLogAuthHeaders():{};}
  function isMobile(){try{return /^\/mobile(?:\/|$)/i.test(root.location?.pathname||'')||/Android|iPhone|iPad|iPod|Mobile/i.test(root.navigator?.userAgent||'')||(root.navigator?.platform==='MacIntel'&&Number(root.navigator?.maxTouchPoints)>0)||(typeof root.isShiftLogMobileView==='function'?root.isShiftLogMobileView():!!root.matchMedia?.('(max-width: 768px)').matches);}catch(_){return true;}}
  function defaultCalculationDate(now=Date.now()){return new Date(now+9*3600000).toISOString().slice(0,10);}
  function dailySpec(targetDate){const day=core.dailyRange(targetDate);if(targetDate<'2021-01-01')throw new Error('2021년 1월 1일 이후의 계산일을 선택해 주세요.');return core.periodRange(day.start.slice(0,16),day.end.slice(0,16),'minute',1);}
  function queryMode(container){return container.querySelector('[data-cfv8-mode]')?.value==='period'?'period':'daily';}
  function customSpec(start,end){
    if(!/^20\d\d-\d\d-\d\dT\d\d:\d\d$/.test(start)||!/^20\d\d-\d\d-\d\dT\d\d:\d\d$/.test(end)||start<'2021-01-01T00:00')throw new Error('2021년 이후의 시작·종료 날짜와 시간을 선택해 주세요.');
    const p=core.periodRange(start,end,'minute',1);
    if(new Date(p.startMs+32400000).toISOString().slice(0,16)!==start||new Date(p.endMs+32400000).toISOString().slice(0,16)!==end)throw new Error('시작·종료 날짜와 시간을 확인해 주세요.');
    return p;
  }
  function currentDaySpec(now=Date.now()){const end=new Date(now+32400000-60000).toISOString().slice(0,16),date=new Date(now+32400000).toISOString().slice(0,10);return customSpec(date+'T00:00',end);}
  const dailySelections=new WeakMap();
  const statusRefreshers=new WeakMap();
  // COFIRING_DAILY_CUMULATIVE_V4
  function dailySelectionSpec(targetDate,now=Date.now()){
    const full=dailySpec(targetDate),today=defaultCalculationDate(now);
    if(targetDate<today)return full;
    if(targetDate===today&&now>=full.startMs+120000)return currentDaySpec(now);
    return customSpec(targetDate+'T00:00',targetDate+'T00:01');
  }
  function captureDailySelection(container,now=Date.now()){
    const date=container.querySelector('[data-cfv7-date]')?.value||'';
    const period=dailySelectionSpec(date,now);dailySelections.set(container,{date,period});return period;
  }
  function periodSpec(container){
    if(queryMode(container)==='period')return customSpec(container.querySelector('[data-cfv8-start]')?.value||'',container.querySelector('[data-cfv8-end]')?.value||'');
    const date=container.querySelector('[data-cfv7-date]')?.value||'',selected=dailySelections.get(container);
    return selected?.date===date?selected.period:captureDailySelection(container);
  }
  function availabilityFor(p,now,daily){
    const readyAt=Date.parse(p.queryEnd),ready=now>=readyAt;
    return {ready,readyAt,period:p,message:ready?'':daily&&p.durationHours<24?`${p.targetDate} 00:02 이후 해당일 00시부터 현재까지 누적 혼소율을 계산할 수 있습니다.`:`${p.queryEnd.slice(0,16).replace('T',' ')} 이후 조회할 수 있습니다. 완료된 시간까지 선택해 주세요.`};
  }
  function dayAvailability(targetDate,now=Date.now()){try{return availabilityFor(dailySelectionSpec(targetDate,now),now,true);}catch(e){return {ready:false,readyAt:null,period:null,message:e.message};}}
  function selectedAvailability(container,now=Date.now()){
    try{return availabilityFor(periodSpec(container),now,queryMode(container)==='daily');}catch(e){return {ready:false,readyAt:null,period:null,message:e.message};}
  }
  function updateModeControls(container){const daily=queryMode(container)==='daily';const date=container.querySelector('[data-cfv8-daily-fields]'),period=container.querySelector('[data-cfv8-period-fields]');if(date)date.hidden=!daily;if(period)period.hidden=daily;}
  function markup(){
    const date=defaultCalculationDate(),d=dailySelectionSpec(date);let partial;try{partial=currentDaySpec();}catch(_){partial=d;}
    return `<div class="cfv5-sheet">
      <div class="cfv5-title-row">
        <div class="cfv5-title-copy"><span class="cfv5-eyebrow">FUEL OPERATIONS</span><h2>혼소율 분석</h2></div>
        <span class="cfv5-version"><i aria-hidden="true"></i>Bio 목표 <strong>25%</strong></span>
      </div>

      <div class="cfv5-query-box">
        <div class="cfv8-query-mode"><label>계산 방식<select data-cfv8-mode><option value="daily" selected>일별 계산</option><option value="period">시간 · 기간 지정</option></select></label><span>오늘은 00:00부터 현재까지 누적, 지난 날짜는 00:00부터 다음 날 00:01까지 계산합니다.</span></div>
        <div class="cfv5-query-grid">
          <label data-cfv8-daily-fields>혼소율 계산일<input data-cfv7-date type="date" min="2021-01-01" value="${date}"></label>
          <div class="cfv8-period-fields" data-cfv8-period-fields hidden><label>계산 시작<input data-cfv8-start type="datetime-local" min="2021-01-01T00:00" step="60" value="${partial.startLocal}"></label><label>계산 종료<input data-cfv8-end type="datetime-local" min="2021-01-01T00:01" step="60" value="${partial.endLocal}"></label><button type="button" data-cfv8-today>오늘 00시~현재</button></div>
          <div class="cfv7-daily-range"><span>자동 조회 범위 · 한국 시간</span><output data-cfv7-daily-window>${d.startLocal.replace('T',' ')} ~ ${d.queryEnd.slice(0,16).replace('T',' ')}</output></div>
          <div class="cfv5-query-actions">
            <button type="button" class="cfv5-get" data-cfv5-query>계산하기</button>
            <button type="button" class="cfv5-requery" data-cfv5-requery>재조회</button>
          </div>
        </div>
        <div class="cfv11-status-row"><p data-cfv11-status-line role="status" aria-live="polite">저장 결과 확인 중</p><details class="cfv11-status-details" data-cfv11-status-details><summary>상세</summary><div class="cfv11-status-body">
        <div class="cfv5-query-meta"><span data-cfv5-range>—</span><span class="cfv56-query-state"><em data-cfv56-prep>조회 준비 대기</em><strong data-cfv5-live-state>조회 전</strong></span></div>
        <span class="cfv6-data-source" data-cfv6-data-source>저장된 조회 결과가 있으면 바로 계산합니다.</span>
        <span class="cfv6-data-source" data-cfv7-click-timing hidden aria-live="off"></span>
        <p data-cfv5-status>날짜를 선택한 뒤 [계산하기]를 누르세요. 오늘은 00:00부터 현재 완료분까지, 지난 날짜는 다음 날 00:01 경계까지 조회합니다.</p>
        </div></details></div>
      </div>

      <div class="cfv52-manual-panel">
        <div class="cfv52-manual-head">
          <div><strong>유기성 · 축분 사용량 입력</strong><span>선택기간 누적량 · 빈칸=0t로 계산</span></div>
          <div class="cfv52-manual-actions"><span data-cfv5-manual-state>저장값 없음</span><button type="button" data-cfv5-manual-save>사용량 저장</button></div>
        </div>
        <div class="cfv52-manual-grid">
          ${UNITS.map((unit,i)=>`<fieldset class="cfv52-manual-unit"><legend><span class="cfv52-unit-dot" aria-hidden="true"></span>${i+1}호기</legend><label><span>유기성 <small>t</small></span>${manualInput(unit,'organic',null,false)}</label><label><span>축분 <small>t</small></span>${manualInput(unit,'manure',null,false)}</label></fieldset>`).join('')}
        </div>
      </div>

      <div class="cfv52-summary-head">
        <div class="cfv52-summary-title"><strong>주요 계산값</strong><span class="cfv6-summary-caption">선택기간 · 보정계수 적용</span></div>
        <div class="cfv56-summary-actions"><span data-cfv52-summary-note>DataPARC 조회 전</span><button type="button" data-cfv56-adjust disabled>혼소 조정</button></div>
      </div>
      <div class="cfv52-summary-grid" data-cfv52-summary-grid>${summaryPlaceholder()}</div>

      <details class="cfv6-target-basis"><summary>마감까지 Bio 25% 필요 투입량 계산 기준</summary><p>해당일 00:00부터 조회한 누적 Coal·Bio 사용량을 기준으로, 다음 날 00:01에 Bio 열량이 Coal+Bio 열량의 25%가 되도록 환산합니다. 남은 시간의 Coal 투입량은 조회 구간의 시간당 평균이 유지된다고 가정합니다.</p><p>마감 예상 Coal = 누적 Coal + Coal 평균(t/h) × 자료 기준 시각부터 남은 시간. 추가 Bio 필요량 = 마감 예상 Coal × Coal 발열량 ÷ Bio 발열량 ÷ 3 − 누적 Bio. 이를 남은 시간으로 나누어 Bio t/h를 표시하며, 보정 전 계측 투입량도 함께 환산합니다.</p><p>오늘 날짜의 <strong>일별 계산</strong>은 00:00부터 현재까지의 혼소율과 마감 목표를 함께 확인합니다. 00시부터 시작하지 않은 구간이나 여러 날의 결과는 하루 누적량이 없어 목표를 계산하지 않습니다. 자료 기준 시각 이후의 실제 사용량은 새 조회에서 반영됩니다. 혼소 조정을 적용하면 조정된 표시값 기준입니다.</p></details>

      <details class="cfv52-fold">
        <summary><span>발열량 · 보정계수 설정</span><small>연료별 계산 기준 관리</small></summary>
        <div class="cfv5-basis-wrap">
          <div class="cfv5-basis-title">#1 / #2 기준 발열량(Net Calorific Value) · 보정계수</div>
          <table class="cfv5-basis-table"><thead><tr><th>연료</th><th colspan="2">1호기</th><th colspan="2">2호기</th></tr><tr><th></th><th>발열량<br><small>kcal/kg</small></th><th>보정계수</th><th>발열량<br><small>kcal/kg</small></th><th>보정계수</th></tr></thead><tbody>
          ${FUEL_KEYS.map(f=>`<tr><th>${FUEL_LABEL[f]}</th>${UNITS.map(u=>`<td class="cfv5-input-yellow"><input type="number" min="1" max="50000" step="any" data-cfv5-calorific="${u}:${f}"></td><td class="cfv5-input-blue"><input type="number" min="0.000001" max="100" step="any" data-cfv5-coefficient="${u}:${f}"></td>`).join('')}</tr>`).join('')}
          </tbody></table>
          <div class="cfv5-basis-actions"><button type="button" data-cfv5-settings-save>발열량/보정계수 저장</button><span data-cfv5-settings-state>기본값</span></div>
        </div>
      </details>

      <details class="cfv52-fold cfv52-detail">
        <summary><span>상세 계산표 보기</span><small>계측량 · 보정계수 · 실사용량 · 열량</small></summary>
        <div class="cfv5-section-label">Coal &amp; Bio-SRF 상세</div>
        <div class="cfv5-table-scroll"><table class="cfv5-grid cfv5-coal-bio"><thead>
          <tr><th rowspan="3">설비구분</th><th colspan="6" class="cfv5-head-coal">Coal</th><th colspan="6" class="cfv5-head-bio">Bio-SRF</th><th colspan="2" class="cfv5-head-ratio">혼소율 산정</th></tr>
          <tr><th colspan="2">계측 사용량</th><th rowspan="2">계측기<br>보정계수</th><th colspan="2">실 사용량</th><th rowspan="2">투입열량<br>(Gcal)</th><th colspan="2">계측 사용량</th><th rowspan="2">계측기<br>보정계수</th><th colspan="2">실 사용량</th><th rowspan="2">투입열량<br>(Gcal)</th><th rowspan="2">Coal+Bio<br>투입열량<br>(Gcal)</th><th rowspan="2">Bio 혼소율<br><small>(Coal+Bio 기준)</small><br>(%)</th></tr>
          <tr><th>기간(t)</th><th>평균(t/h)</th><th>기간(t)</th><th>평균(t/h)</th><th>기간(t)</th><th>평균(t/h)</th><th>기간(t)</th><th>평균(t/h)</th></tr>
        </thead><tbody data-cfv5-main-body>${rowsPlaceholder(3,15)}</tbody></table></div>

        <div class="cfv5-section-label">유기성 고형연료 · 축분 상세</div>
        <div class="cfv5-table-scroll"><table class="cfv5-grid cfv5-organic"><thead>
          <tr><th rowspan="3">설비구분</th><th colspan="6" class="cfv5-head-organic">유기성 고형연료</th><th colspan="6" class="cfv5-head-manure">축분</th><th colspan="2" class="cfv5-head-ratio">혼소율 산정</th></tr>
          <tr><th colspan="2">사용량</th><th rowspan="2">보정계수</th><th colspan="2">실 사용량</th><th rowspan="2">투입열량<br>(Gcal)</th><th colspan="2">사용량</th><th rowspan="2">보정계수</th><th colspan="2">실 사용량</th><th rowspan="2">투입열량<br>(Gcal)</th><th rowspan="2">총투입열량<br>(Gcal)</th><th rowspan="2">유기성 및 축분 혼소율<br>(%)</th></tr>
          <tr><th>기간(t)</th><th>평균(t/h)</th><th>기간(t)</th><th>평균(t/h)</th><th>기간(t)</th><th>평균(t/h)</th><th>기간(t)</th><th>평균(t/h)</th></tr>
        </thead><tbody data-cfv5-organic-body>${manualRowsPlaceholder()}</tbody></table></div>
      </details>

      <details class="cfv5-warnings" data-cfv5-warning-box hidden><summary>자료 확인 내용</summary><ul data-cfv5-warnings></ul></details>
      <p class="cfv5-foot"><strong>계산 기준</strong> 바이오 혼소율은 Coal+Bio 열량 기준입니다. 유기성 및 축분 혼소율과 종합혼소율은 전체 연료 열량 기준이며, 사용량 빈칸은 0t로 계산합니다.</p>
    </div>`;
  }
  function summaryPlaceholder(){
    const cards=UNITS.map((unit,i)=>`<article class="cfv52-card" data-cfv52-unit="${unit}"><header><div class="cfv52-unit-title"><span class="cfv52-unit-number" aria-hidden="true">0${i+1}</span><div><strong>${i+1}호기</strong></div></div><span class="cfv52-card-status is-waiting">조회 전</span></header><div class="cfv52-metrics">
      ${summaryMetric('바이오 혼소율',null,{ratio:true})}
      ${summaryMetric('유기성 및 축분 혼소율',null,{ratio:true})}
      ${summaryMetric('종합혼소율',null,{ratio:true,emphasis:true})}
      </div>${fuelUsageMarkup(null)}${targetReferenceMarkup(null)}</article>`);
    cards.push(`<article class="cfv52-card cfv52-card-total"><header><strong>1,2호기 종합 혼소율</strong><span>열량 가중 기준</span></header><div class="cfv52-total-ratios">${summaryMetric('바이오 혼소율',null,{ratio:true})}${summaryMetric('유기성 및 축분 혼소율',null,{ratio:true})}${summaryMetric('종합혼소율',null,{ratio:true,emphasis:true})}</div></article>`);
    return cards.join('');
  }
  function targetReferenceMarkup(reference,{open=false}={}){
    const ready=reference?.ready===true,closed=reference?.status==='closed';
    const basis=reference?.dataAsOfLocal?.replace('T',' '),deadline=reference?.deadlineLocal?.replace('T',' ');
    const deadlineShort=deadline?deadline.slice(5):'다음 날 00:01';
    const message=reference?.message||'오늘 누적 조회 후 표시';
    const state=closed?'마감 완료':reference?.status==='invalid_input'?'입력 기준 확인 필요':ready?'':'당일 누적 조회 필요';
    const warning=reference?.status==='above_target'?`추가 Bio 0t여도 마감 예상 ${pct(reference.projectedRatioPercent)} · 25% 초과`:'';
    return `<section class="cfv6-target cfv8-deadline-target cfv10-target${ready?'':' is-unavailable'}" data-cfv6-target>
      <div class="cfv10-target-head"><span class="cfv6-target-label">마감까지 Bio 필요 투입량 <b>25% 목표</b></span><span class="cfv10-target-deadline">${ready?escapeHtml(deadlineShort)+'까지':escapeHtml(state)}</span></div>
      <div class="cfv10-target-main"><strong class="cfv10-target-value" data-cfv6-target-bio>${ready?num(reference.targetBioTonPerHour):closed?'마감 완료':'—'}${ready?' <small>t/h <span>실사용</span></small>':''}</strong>${ready?`<span class="cfv10-target-assumption">${escapeHtml(basis?.slice(11))} 기준<br>Coal ${num(reference.coalTonPerHour)} t/h 유지 가정</span>`:`<span class="cfv10-target-state">${closed?'추가 투입 목표 없음':escapeHtml(message)}</span>`}</div>
      ${warning?`<p class="cfv10-target-warning" role="status">${escapeHtml(warning)}</p>`:''}
      ${ready?`<details class="cfv10-target-details" data-cfv10-target-details${open?' open':''}><summary>계산 근거</summary><div class="cfv10-target-detail-body"><p data-cfv8-target-basis>자료 ${escapeHtml(basis)} → 마감 ${escapeHtml(deadline)} · ${num(reference.remainingHours,2)}시간 기준</p><dl><div><dt>조회 Bio 평균</dt><dd><b data-cfv6-current-bio>${num(reference.currentBioTonPerHour)} t/h</b></dd></div><div><dt>추가 Bio 필요량</dt><dd data-cfv6-target-delta>${num(reference.additionalBioTon)} t</dd></div><div><dt>Coal 유지 가정</dt><dd><b data-cfv6-target-coal>${num(reference.coalTonPerHour)} t/h</b></dd></div><div><dt>Bio 계측 투입 환산</dt><dd><b data-cfv8-target-measured>${num(reference.targetMeasuredBioTonPerHour)} t/h</b></dd></div></dl><p class="cfv8-target-note" data-cfv8-target-note>자료 이후 ${num(reference.lagHours*60,1)}분 경과 · 현재 구간을 다시 [계산하기]로 조회하면 최신 자료로 갱신합니다.</p></div></details>`:''}
    </section>`;
  }
  function fuelUsageMarkup(unit){
    return `<section class="cfv10-fuels" aria-label="연료 실사용량"><div class="cfv10-fuels-head"><strong>연료 실사용량</strong><span>선택기간 누적 · 보정 적용</span></div><div class="cfv52-fuel-grid cfv10-fuel-grid">${FUEL_KEYS.map(f=>{const value=unit?.[f]?.quantity,ready=typeof value==='number'&&Number.isFinite(value);return `<div class="cfv10-fuel cfv10-fuel-${f}${ready?'':' is-unavailable'}" data-cfv10-fuel="${f}"><span class="cfv10-fuel-label">${FUEL_LABEL[f]}</span><strong class="cfv10-fuel-value">${ready?num(value):'—'}${ready?' <small>t</small>':''}</strong></div>`;}).join('')}</div></section>`;
  }
  function rowsPlaceholder(count,cols){return Array.from({length:count},(_,i)=>`<tr><th>${i<2?i+1+'호기':'계'}</th>${Array.from({length:cols-1},()=>'<td>—</td>').join('')}</tr>`).join('');}
  function manualRowsPlaceholder(){return `<tr data-cfv5-manual-row="unit1"><th>1호기</th>${Array.from({length:14},()=>'<td>—</td>').join('')}</tr><tr data-cfv5-manual-row="unit2"><th>2호기</th>${Array.from({length:14},()=>'<td>—</td>').join('')}</tr><tr data-cfv5-manual-row="sum"><th>계</th>${Array.from({length:14},()=>'<td>—</td>').join('')}</tr>`;}
  function readSettings(container){const output={unit1:{},unit2:{}};for(const fuel of FUEL_KEYS){const c=Number(container.querySelector(`[data-cfv5-calorific="unit1:${fuel}"]`)?.value),f=Number(container.querySelector(`[data-cfv5-coefficient="unit1:${fuel}"]`)?.value);if(!Number.isFinite(c)||c<=0||c>50000||!Number.isFinite(f)||f<=0||f>100)throw new Error(`${FUEL_LABEL[fuel]} 발열량·보정계수를 확인해 주세요.`);output.unit1[fuel]={calorific:c,coefficient:f};output.unit2[fuel]={calorific:c,coefficient:f};}return output;}
  function writeSettings(container,settings){if(!settings)return;for(const fuel of FUEL_KEYS){const s=settings?.unit1?.[fuel]||settings?.unit2?.[fuel];if(!s)continue;for(const unit of UNITS){const c=container.querySelector(`[data-cfv5-calorific="${unit}:${fuel}"]`),f=container.querySelector(`[data-cfv5-coefficient="${unit}:${fuel}"]`);if(c)c.value=String(s.calorific);if(f)f.value=String(s.coefficient);}}}
  function readManual(container){const out={unit1:{},unit2:{}};for(const unit of UNITS)for(const fuel of ['organic','manure'])out[unit][fuel]=manualApi.parseValue(container.querySelector(`[data-cfv5-manual="${unit}:${fuel}"]`)?.value??'');return out;}
  function manualForCalculation(values){const out={unit1:{},unit2:{}};for(const unit of UNITS)for(const fuel of ['organic','manure']){const value=values?.[unit]?.[fuel];out[unit][fuel]=typeof value==='number'&&Number.isFinite(value)?value:0;}return out;}
  function writeManual(container,values){for(const unit of UNITS)for(const fuel of ['organic','manure']){const input=container.querySelector(`[data-cfv5-manual="${unit}:${fuel}"]`);if(input)input.value=values?.[unit]?.[fuel]==null?'':String(values[unit][fuel]);}}
  function average(q,hours){return typeof q==='number'&&Number.isFinite(q)&&hours>0?q/hours:null;}
  function coefficientCell(values){const a=values[0],b=values[1];return typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<1e-12?num(a,4):'—';}
  function renderMain(container,result){const body=container.querySelector('[data-cfv5-main-body]');if(!body)return;const hours=result?.period?.durationHours||0,rows=[];
    for(const [i,unit] of UNITS.entries()){
      const u=result?.units?.[unit];if(!u){rows.push(`<tr><th>${i+1}호기</th>${Array.from({length:14},()=>'<td>—</td>').join('')}</tr>`);continue;}
      rows.push(`<tr><th>${i+1}호기</th><td class="cfv5-measured">${num(u.coal.measuredQuantity)}</td><td>${num(average(u.coal.measuredQuantity,hours))}</td><td class="cfv5-factor">${num(u.coal.coefficient,4)}</td><td class="cfv5-actual">${num(u.coal.quantity)}</td><td>${num(u.coal.averageTonPerHour)}</td><td>${num(u.heats.coal,1)}</td><td class="cfv5-measured">${num(u.bio.measuredQuantity)}</td><td>${num(average(u.bio.measuredQuantity,hours))}</td><td class="cfv5-factor">${num(u.bio.coefficient,4)}</td><td class="cfv5-actual">${num(u.bio.quantity)}</td><td>${num(u.bio.averageTonPerHour)}</td><td>${num(u.heats.bio,1)}</td><td>${num(coalBioHeat(u),1)}</td><td class="cfv5-ratio">${pct(coalBioRatio(u))}</td></tr>`);
    }
    const one=result?.units?.unit1,two=result?.units?.unit2;
    rows.push(`<tr class="cfv5-sum"><th>계</th><td>${num(sum([one?.coal?.measuredQuantity,two?.coal?.measuredQuantity]))}</td><td>${num(sum([average(one?.coal?.measuredQuantity,hours),average(two?.coal?.measuredQuantity,hours)]))}</td><td>${coefficientCell([one?.coal?.coefficient,two?.coal?.coefficient])}</td><td class="cfv5-actual">${num(sum([one?.coal?.quantity,two?.coal?.quantity]))}</td><td>${num(sum([one?.coal?.averageTonPerHour,two?.coal?.averageTonPerHour]))}</td><td>${num(result?.combined?.heats?.coal,1)}</td><td>${num(sum([one?.bio?.measuredQuantity,two?.bio?.measuredQuantity]))}</td><td>${num(sum([average(one?.bio?.measuredQuantity,hours),average(two?.bio?.measuredQuantity,hours)]))}</td><td>${coefficientCell([one?.bio?.coefficient,two?.bio?.coefficient])}</td><td class="cfv5-actual">${num(sum([one?.bio?.quantity,two?.bio?.quantity]))}</td><td>${num(sum([one?.bio?.averageTonPerHour,two?.bio?.averageTonPerHour]))}</td><td>${num(result?.combined?.heats?.bio,1)}</td><td>${num(combinedCoalBio(result).heat,1)}</td><td class="cfv5-ratio">${pct(combinedCoalBio(result).ratio)}</td></tr>`);body.innerHTML=rows.join('');
  }
  function manualInput(unit,fuel,value,disabled){return `<input class="cfv5-manual-input" type="text" inputmode="decimal" data-cfv5-manual="${unit}:${fuel}" value="${value==null?'':escapeHtml(value)}" placeholder="0" ${disabled?'disabled':''}>`;}
  function renderOrganic(container,result,manualValues){
    const body=container.querySelector('[data-cfv5-organic-body]');if(!body)return;const hours=result?.period?.durationHours||safeHours(container),rows=[];
    for(const [i,unit] of UNITS.entries()){
      const u=result?.units?.[unit],ov=manualValues?.[unit]?.organic,mv=manualValues?.[unit]?.manure;
      rows.push(`<tr><th>${i+1}호기</th><td class="cfv5-measured">${num(ov)}</td><td>${num(average(ov,hours))}</td><td class="cfv5-factor">${num(u?.organic?.coefficient??settingFactor(container,unit,'organic'),4)}</td><td class="cfv5-actual">${num(u?.organic?.quantity)}</td><td>${num(u?.organic?.averageTonPerHour)}</td><td>${num(u?.heats?.organic,1)}</td><td class="cfv5-measured">${num(mv)}</td><td>${num(average(mv,hours))}</td><td class="cfv5-factor">${num(u?.manure?.coefficient??settingFactor(container,unit,'manure'),4)}</td><td class="cfv5-actual">${num(u?.manure?.quantity)}</td><td>${num(u?.manure?.averageTonPerHour)}</td><td>${num(u?.heats?.manure,1)}</td><td>${num(u?.heats?.total,1)}</td><td class="cfv5-ratio">${pct(u?.fuelRatios?.organicGroup)}</td></tr>`);
    }
    const one=result?.units?.unit1,two=result?.units?.unit2;
    rows.push(`<tr class="cfv5-sum"><th>계</th><td>${num(sum([manualValues?.unit1?.organic,manualValues?.unit2?.organic]))}</td><td>${num(sum([average(manualValues?.unit1?.organic,hours),average(manualValues?.unit2?.organic,hours)]))}</td><td>${coefficientCell([one?.organic?.coefficient??settingFactor(container,'unit1','organic'),two?.organic?.coefficient??settingFactor(container,'unit2','organic')])}</td><td class="cfv5-actual">${num(sum([one?.organic?.quantity,two?.organic?.quantity]))}</td><td>${num(sum([one?.organic?.averageTonPerHour,two?.organic?.averageTonPerHour]))}</td><td>${num(result?.combined?.heats?.organic,1)}</td><td>${num(sum([manualValues?.unit1?.manure,manualValues?.unit2?.manure]))}</td><td>${num(sum([average(manualValues?.unit1?.manure,hours),average(manualValues?.unit2?.manure,hours)]))}</td><td>${coefficientCell([one?.manure?.coefficient??settingFactor(container,'unit1','manure'),two?.manure?.coefficient??settingFactor(container,'unit2','manure')])}</td><td class="cfv5-actual">${num(sum([one?.manure?.quantity,two?.manure?.quantity]))}</td><td>${num(sum([one?.manure?.averageTonPerHour,two?.manure?.averageTonPerHour]))}</td><td>${num(result?.combined?.heats?.manure,1)}</td><td>${num(result?.combined?.heats?.total,1)}</td><td class="cfv5-ratio">${pct(result?.combined?.fuelRatios?.organicGroup)}</td></tr>`);body.innerHTML=rows.join('');
  }
  function summaryMetric(label,value,{digits=2,suffix='',ratio=false,emphasis=false}={}){
    const ready=typeof value==='number'&&Number.isFinite(value);
    const shown=ready?(ratio?value.toFixed(2)+'%':num(value,digits)+(suffix?' '+suffix:'')):'—';
    return `<div class="cfv52-metric${ratio?' cfv52-metric-ratio':''}${emphasis?' cfv52-metric-emphasis':''}"><span>${label}</span><strong>${shown}</strong></div>`;
  }
  function renderSummary(container,result,manualValues,targetError=''){
    const host=container.querySelector('[data-cfv52-summary-grid]'),note=container.querySelector('[data-cfv52-summary-note]');if(!host)return;
    if(!result){host.innerHTML=summaryPlaceholder();if(note)note.textContent='DataPARC 조회 전';return;}
    const cards=[];
    for(const [i,unit] of UNITS.entries()){
      const u=result?.units?.[unit],manualComplete=!!(u?.organic?.complete&&u?.manure?.complete),bioReady=coalBioRatio(u)!==null;
      cards.push(`<article class="cfv52-card" data-cfv52-unit="${unit}"><header><div class="cfv52-unit-title"><span class="cfv52-unit-number" aria-hidden="true">0${i+1}</span><div><strong>${i+1}호기</strong></div></div><span class="cfv52-card-status${manualComplete&&bioReady?'':' is-waiting'}">${manualComplete&&bioReady?'계산 완료':bioReady?'종합 계산 대기':'조회값 확인'}</span></header><div class="cfv52-metrics">
        ${summaryMetric('바이오 혼소율',coalBioRatio(u),{ratio:true})}
        ${summaryMetric('유기성 및 축분 혼소율',u?.fuelRatios?.organicGroup,{ratio:true})}
        ${summaryMetric('종합혼소율',u?.fuelRatios?.total,{ratio:true,emphasis:true})}
      </div>${fuelUsageMarkup(u)}${targetReferenceMarkup(targetError?{status:'invalid_input',ready:false,message:targetError}:deadlineTargetApi?{...deadlineTargetApi.forUnit(u,result.period),ratioPercent:coalBioRatio(u)}:null,{open:host.querySelector?.('[data-cfv52-unit="'+unit+'"]')?.querySelector?.('[data-cfv10-target-details]')?.open===true})}</article>`);
    }
    cards.push(`<article class="cfv52-card cfv52-card-total"><header><strong>1,2호기 종합 혼소율</strong><span>열량 가중 기준</span></header><div class="cfv52-total-ratios">
      ${summaryMetric('바이오 혼소율',combinedCoalBio(result).ratio,{ratio:true})}
      ${summaryMetric('유기성 및 축분 혼소율',result?.combined?.fuelRatios?.organicGroup,{ratio:true})}
      ${summaryMetric('종합혼소율',result?.combined?.ratios?.total,{ratio:true,emphasis:true})}
    </div></article>`);
    host.innerHTML=cards.join('');
    if(note)note.textContent=result?.warnings?.length?'자료 확인 필요':'계산 완료';
  }
  function safeHours(container){try{return periodSpec(container).durationHours;}catch(_){return 0;}}
  function settingFactor(container,unit,fuel){const n=Number(container.querySelector(`[data-cfv5-coefficient="unit1:${fuel}"]`)?.value);return Number.isFinite(n)?n:null;}
  function setStatus(container,text,tone=''){const el=container.querySelector('[data-cfv5-status]');if(el){el.textContent=text;el.dataset.tone=tone;}statusRefreshers.get(container)?.();}
  function updateRange(container){updateModeControls(container);try{const p=periodSpec(container);container.querySelector('[data-cfv5-range]').textContent=queryMode(container)==='daily'?(p.durationHours<24?`${p.targetDate} 현재까지 누적 · 자료 기준 ${p.endLocal.slice(11)} · 계산하기로 현재까지 갱신`:`${p.targetDate} 하루 혼소율 · 24시간 기준`):`선택 기간 ${num(p.durationHours,2)}시간 · 1분 기준 · 종료 누적값 확인을 위해 다음 1분까지 조회`;const out=container.querySelector('[data-cfv7-daily-window]');if(out)out.textContent=`${p.startLocal.replace('T',' ')} ~ ${p.queryEnd.slice(0,16).replace('T',' ')}`;return p;}catch(e){container.querySelector('[data-cfv5-range]').textContent=e.message;const out=container.querySelector('[data-cfv7-daily-window]');if(out)out.textContent=queryMode(container)==='daily'?'계산일을 선택해 주세요.':'시작·종료 날짜와 시간을 확인해 주세요.';return null;}}
  function renderWarnings(container,result){const box=container.querySelector('[data-cfv5-warning-box]'),list=container.querySelector('[data-cfv5-warnings]'),warnings=result?.warnings||[];box.hidden=!warnings.length;list.innerHTML=warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join('');}
  function mount(container){
    if(!container||container.dataset.cofiringV5Mounted==='true')return null;container.dataset.cofiringV5Mounted='true';container.classList.add('cofiring-period-v5','cfv7-daily-date','cfv10-summary-ui','cfv11-status-ui');container.innerHTML=markup();
    const mobile=isMobile();let reference=null,lastResult=null,displayResult=null,periodGeneration=0,settingsDirty=false,manualDirty=false,disposed=false,fastPrepTimer=null,fastPrepGeneration=0,adjustmentActive=false,conflictRetrying=false,selectedStoreKey='';
    let clickTiming=null,clickToken=null,clickContext=null,clickBusy=false,renderedRequestId=null,dayBoundaryTimer=null,deadlineRefreshTimer=null,selectionEpoch=0,deadlineInputError='',pendingDailyDraft=null,restoringSaved=false;
    // COFIRING_MORNING_MEETING_ORGANIC_AUTOFILL_V1
    let morningOrganicSelection='',morningCardObserver=null,morningCardObserved=null,morningCardBindTimer=null,morningCardBindAttempts=0;
    const morningOrganicTouched=new Set(),morningOrganicAuto=new Map();
    const settings=settingsApi?.create({getHeaders:authHeaders,canEdit:()=>!isMobile(),onChange:()=>paintSettings()})||null;
    const manual=manualApi?.create({getHeaders:authHeaders,canEdit:()=>!isMobile(),onChange:()=>paintManual()})||null;
    const live=liveApi?.createPeriod({getHeaders:authHeaders,canQuery:()=>!isMobile()&&selectedDayAvailability().ready,isVisible:()=>visible(),onChange:s=>paintLive(s),onResult:r=>{if(!sameSelectedPeriod(r?.report?.reference)||!selectedDayAvailability().ready)return;reference=r.report.reference;if(storesReady())calculate();}})||null;
    clickTiming=root.CofiringClickTimingV1?.create({isCurrent:()=>clickIsCurrent(),onChange:s=>paintClickTiming(s)});
    function clickIsCurrent(){try{return !!clickContext&&!disposed&&visible()&&clickContext.epoch===selectionEpoch&&clickContext.spec===JSON.stringify(currentSpec())&&clickContext.auth===String(authHeaders().Authorization||authHeaders().authorization||'');}catch(_){return false;}}
    function paintClickTiming(s){const el=container.querySelector('[data-cfv7-click-timing]');if(!el)return;if(!clickIsCurrent()){el.hidden=true;el.textContent='';return;}el.hidden=s.status==='idle';const seconds=(s.elapsedMs/1000).toFixed(1);const label=s.mode==='resume_existing'?'상태 확인부터':'계산 시간';if(s.status==='complete'){const source=s.source==='saved_recalculate'?'저장값 재계산':s.source==='resume_existing'?'진행 중 조회 결과':'새 DataPARC 결과';const backend=s.source==='new_query'&&Number.isFinite(s.controllerSeconds)?` · 회사 PC ${s.controllerSeconds.toFixed(1)}초${Number.isFinite(s.querySeconds)?` (DataPARC ${s.querySeconds.toFixed(1)}초 포함)`:''}`:'';el.textContent=`${label} ${seconds}초 · ${source}${backend}`;}else if(s.status==='failed')el.textContent=`${label} ${seconds}초 · 완료되지 않음`;else if(s.status==='cancelled')el.textContent=`${label} ${seconds}초 · 측정 중단`;else el.textContent=`${label} ${seconds}초 · ${s.phase||'결과 확인 중'}`;refreshStatusLine();}
    function refreshStatusLine(){
      const line=container.querySelector('[data-cfv11-status-line]');if(!line||disposed)return;
      const state=live?.state(),item=state?.item,active=item?.active,availability=selectedDayAvailability();
      const failure=!!(!active&&item?.lastAttempt?.status==='failed'),hasResult=!!displayResult;
      const timing=clickTiming?.state(),timingCurrent=clickIsCurrent(),parts=[];let tone='';
      if(!state?.authenticated){parts.push('로그인 필요');tone='error';}
      else if(!availability.ready)parts.push(availability.message);
      else if(deadlineInputError){parts.push('입력값 확인 필요');tone='error';}
      else if([settings,manual].some(store=>store?.state()?.error)){parts.push('계산 기준 확인 실패 · 상세 확인');tone='error';}
      else if(restoringSaved)parts.push('저장 결과 확인 중');
      else if(item?.submitting||active){parts.push(item?.submitting?'조회 요청 중':active.status==='pending'?'회사 PC 대기 중':liveRequestPresentation(state).progressLabel||'조회 중');tone='working';}
      else if(item?.error||failure){parts.push(hasResult?'조회 실패 · 이전 결과 표시':'조회 실패 · 상세 확인');tone='error';}
      else if(container.querySelector('[data-cfv5-status]')?.dataset.tone==='error'){parts.push('확인 필요 · 상세 확인');tone='error';}
      else if(hasResult){parts.push(displayResult.warnings?.length?'계산 완료 · 자료 확인 필요':'계산 완료');tone='success';}
      else if(item?.loading)parts.push('저장 결과 확인 중');
      else parts.push('저장 결과 없음 · 계산하기를 누르세요');
      if(hasResult&&state?.authenticated){const p=displayResult.period;parts.push(queryMode(container)==='daily'&&p.durationHours===24?'하루 전체':p.endLocal.slice(0,10)===defaultCalculationDate()?`${p.endLocal.slice(11)} 기준`:`${p.endLocal.replace('T',' ')} 기준`);}
      if(timingCurrent&&timing&&['running','finishing','complete','failed'].includes(timing.status))parts.push(`${(timing.elapsedMs/1000).toFixed(1)}초`);
      line.textContent=parts.join(' · ');line.dataset.tone=tone;
    }
    function startClickTiming(mode){if(!clickTiming)return null;const old=clickTiming.state(),s=live.state();if(mode==='resume_existing'&&['running','finishing'].includes(old.status)&&clickIsCurrent()&&s.item?.active?.id===old.expectedRequestId)return clickToken;clickContext={epoch:selectionEpoch,spec:JSON.stringify(currentSpec()),auth:String(authHeaders().Authorization||authHeaders().authorization||'')};clickToken=clickTiming.start({mode,period:currentSpec(),previousRequestId:s.item?.saved?.id||null,activeRequestId:s.item?.active?.id||null});return clickToken;}
    function finishClickTiming(){if(!clickTiming||!clickToken||!clickIsCurrent())return;const s=live.state(),item=s.item,id=item?.saved?.id;if(!id||id!==renderedRequestId||!displayResult||!cachedReference(s,currentSpec())||!storesReady())return;const state=clickTiming.state(),r=item.result.report;clickTiming.finish(clickToken,{requestId:id,source:state.mode==='resume_existing'?'resume_existing':state.expectedRequestId?'new_query':'saved_recalculate',querySeconds:r.queryElapsedSeconds,workerSeconds:r.workerElapsedSeconds,controllerSeconds:r.timing?.controllerElapsedSeconds},()=>clickIsCurrent()&&renderedRequestId===id&&live.state().item?.saved?.id===id&&!!cachedReference(live.state(),currentSpec())&&storesReady());}
    function acceptClickRequest(token){const item=live.state().item,request=item?.active||item?.lastAttempt;if(request?.status==='failed'||(item?.error&&!item.active)){clickTiming?.fail(token,'조회 실패');return;}if(request?.id&&['pending','processing','complete'].includes(request.status))clickTiming?.acceptRequest(token,request.id);else clickTiming?.fail(token,'요청 상태 확인 실패');finishClickTiming();}
    function visible(){return !container.closest?.('[hidden], [aria-hidden="true"]');}
    function currentSpec(){const p=periodSpec(container);return {startLocal:p.startLocal,endLocal:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue};}
    function selectedDayAvailability(){return selectedAvailability(container);}
    function sameSelectedPeriod(spec){try{const selected=currentSpec();return ['startLocal','endLocal','stepUnit','stepValue'].every(k=>spec?.[k]===selected[k]);}catch(_){return false;}}
    function clearDayBoundary(){if(dayBoundaryTimer!==null){root.clearTimeout?.(dayBoundaryTimer);dayBoundaryTimer=null;}}
    function showDayUnavailable(){
      const a=selectedDayAvailability();if(a.ready)return false;live?.pause();updateRange(container);
      const daily=queryMode(container)==='daily',waiting=a.period?'자료 대기':(daily?'날짜 선택':'기간 확인');
      prepLabel(a.period?'조회 가능 시각 대기':waiting);setStatus(container,a.message,'');
      const state=container.querySelector('[data-cfv5-live-state]');if(state)state.textContent=waiting;
      const source=container.querySelector('[data-cfv6-data-source]');if(source)source.textContent=daily?'오늘은 00:00부터 현재까지 누적, 지난 날짜는 00:00부터 다음 날 00:01까지 계산합니다.':'완료된 시간의 선택 구간을 기준으로 계산합니다.';
      const query=container.querySelector('[data-cfv5-query]');query.disabled=true;query.textContent=waiting;container.querySelector('[data-cfv5-requery]').disabled=true;
      for(const el of container.querySelectorAll('[data-cfv5-calorific],[data-cfv5-coefficient],[data-cfv5-manual],[data-cfv5-settings-save],[data-cfv5-manual-save],[data-cfv56-adjust]'))el.disabled=true;
      const settingsState=container.querySelector('[data-cfv5-settings-state]'),manualState=container.querySelector('[data-cfv5-manual-state]');if(settingsState)settingsState.textContent='조회 범위 확인 대기';if(manualState)manualState.textContent='조회 범위 확인 대기';
      if(a.readyAt!==null&&dayBoundaryTimer===null&&!disposed&&visible()&&root.setTimeout){dayBoundaryTimer=root.setTimeout(()=>{dayBoundaryTimer=null;if(!disposed&&visible())void periodChanged();},Math.min(2147483000,Math.max(50,a.readyAt-Date.now()+10)));}return true;
    }
    function clearDeadlineRefresh(){if(deadlineRefreshTimer!==null){root.clearTimeout?.(deadlineRefreshTimer);deadlineRefreshTimer=null;}}
    function scheduleDeadlineRefresh(){
      clearDeadlineRefresh();if(disposed||!visible()||!displayResult||!deadlineTargetApi||deadlineInputError)return;
      const targets=UNITS.map(unit=>deadlineTargetApi.forUnit(displayResult.units[unit],displayResult.period)).filter(t=>t.ready),deadline=Math.min(...targets.map(t=>t.deadlineMs));
      if(!Number.isFinite(deadline)||deadline<=Date.now())return;
      deadlineRefreshTimer=root.setTimeout?.(()=>{deadlineRefreshTimer=null;if(disposed||!visible()||!displayResult)return;renderSummary(container,displayResult,currentManualFromFields(),deadlineInputError);scheduleDeadlineRefresh();},Math.min(60000,Math.max(20,deadline-Date.now()+10)));
    }
    function prepLabel(text,tone=''){const el=container.querySelector('[data-cfv56-prep]');if(el){el.textContent=text;el.dataset.tone=tone;}}
    function renderDisplay(result,{adjusted=false}={}){displayResult=result;const manualValues=readManual(container);renderMain(container,result);renderOrganic(container,result,manualValues);renderSummary(container,result,manualValues,deadlineInputError);renderWarnings(container,result);scheduleDeadlineRefresh();adjustmentActive=!!adjusted;const b=container.querySelector('[data-cfv56-adjust]');if(b){b.disabled=!lastResult||mobile;b.classList.toggle('is-active',adjustmentActive);b.textContent=adjustmentActive?'혼소 조정 적용중':'혼소 조정';}const note=container.querySelector('[data-cfv52-summary-note]');if(note&&adjusted)note.textContent='혼소 조정 적용';}
    function adjustmentContext(){return {result:lastResult,settings:readSettings(container),spec:currentSpec()};}
    let adjuster=null;
    function scheduleFastPrep(delay=900){if(fastPrepTimer){root.clearTimeout?.(fastPrepTimer);fastPrepTimer=null;}const epoch=++fastPrepGeneration;restoringSaved=false;if(disposed||mobile||!visible()||!live)return;prepLabel('고속 준비 예약');fastPrepTimer=root.setTimeout?.(()=>{fastPrepTimer=null;void fastPrepare(epoch);},delay);}
    async function restoreLatestDaily(epoch){
      const date=container.querySelector('[data-cfv7-date]')?.value||'',item=live?.state()?.item;
      if(!live?.readLatestDaily||queryMode(container)!=='daily'||date!==defaultCalculationDate()||reference||displayResult||item?.active||item?.submitting||manualDirty||settingsDirty||clickBusy)return true;
      const auth=String(authHeaders().Authorization||authHeaders().authorization||''),selection=selectionEpoch;
      const current=()=>!disposed&&visible()&&epoch===fastPrepGeneration&&selection===selectionEpoch&&!clickBusy&&!manualDirty&&!settingsDirty&&queryMode(container)==='daily'&&container.querySelector('[data-cfv7-date]')?.value===date&&date===defaultCalculationDate()&&String(authHeaders().Authorization||authHeaders().authorization||'')===auth;
      if(!auth)return true;
      restoringSaved=true;refreshStatusLine();
      try{
        const saved=await live.readLatestDaily(date);if(!current())return false;
        if(saved){
          const p=customSpec(saved.period.startLocal,saved.period.endLocal);
          // The live reader validates the report; the UI also keeps its date/range contract explicit.
          if(p.startLocal!==date+'T00:00'||p.stepUnit!=='minute'||p.stepValue!==1||Date.parse(p.queryEnd)>Date.now()||p.endMs>dailySpec(date).endMs)throw new Error('저장된 오늘 누적 결과의 범위를 확인하지 못했습니다.');
          dailySelections.set(container,{date,period:p});clickTiming?.cancel('저장 결과 복원');if(clickTiming)paintClickTiming(clickTiming.state());updateRange(container);live.select(currentSpec());
          const loaded=await selectStores();if(!current()||!loaded)return false;
        }
        return true;
      }finally{if(epoch===fastPrepGeneration){restoringSaved=false;refreshStatusLine();}}
    }
    async function fastPrepare(epoch){
      if(disposed||epoch!==fastPrepGeneration||mobile||!visible()||!live)return;if(showDayUnavailable())return;
      try{
        prepLabel('저장값 확인','working');if(!await restoreLatestDaily(epoch))return;
        if(disposed||epoch!==fastPrepGeneration||!visible()||clickBusy)return;
        live.select(currentSpec());await live.load({force:true});if(disposed||epoch!==fastPrepGeneration||!visible())return;
        const s=live.state();if(liveRequestPresentation(s).failureMessage){paintLive(s);return;}
        if(s.item?.saved&&reference){prepLabel(storesReady()?'즉시 계산 가능':'입력 기준 확인 중',storesReady()?'ready':'working');return;}
        if(s.item?.active){prepLabel('동일기간 조회 진행중','working');return;}
        if(!s.canQuery){prepLabel(s.authenticated?'조회 준비 불가':'로그인 필요',s.authenticated?'':'error');return;}
        prepLabel('조회 준비 완료','ready');setStatus(container,'저장된 결과가 없습니다. [계산하기]를 누르면 표시된 범위로 조회합니다.','');
      }catch(e){if(!disposed&&epoch===fastPrepGeneration){prepLabel('저장값 확인 실패','error');setStatus(container,e.message||'저장값 확인 실패','error');const line=container.querySelector('[data-cfv11-status-line]');if(line){line.textContent='저장 결과 확인 실패 · 상세 확인';line.dataset.tone='error';}}}
    }
    function waitMs(ms){return new Promise(resolve=>{if(root.setTimeout)root.setTimeout(resolve,ms);else resolve();});}
    async function queryWithBusyRetry({force=false,maxRetries=20}={}){
      const epoch=selectionEpoch,signature=JSON.stringify(currentSpec()),authKey=String(authHeaders().Authorization||authHeaders().authorization||'');let attempt=0;conflictRetrying=true;paintLive(live.state());
      try{
        while(!disposed&&epoch===selectionEpoch&&visible()&&selectedDayAvailability().ready&&JSON.stringify(currentSpec())===signature&&String(authHeaders().Authorization||authHeaders().authorization||'')===authKey){
          const ok=await live.query({explicit:true,force}),state=live.state();
          if(ok||state.item?.active||(!force&&state.item?.saved))return true;
          const message=String(state.item?.error||'');
          if(!/같은 시작일의 다른 혼소율 기간 조회/.test(message)||attempt>=maxRetries)return false;
          attempt+=1;prepLabel('이전 조회 정리 대기','working');
          setStatus(container,`이전 자동 준비 조회가 아직 종료되지 않았습니다. 종료되는 즉시 현재 기간으로 자동 재시도합니다. (${attempt}/${maxRetries})`,'working');
          await waitMs(3000);
          if(disposed||epoch!==selectionEpoch||!visible()||JSON.stringify(currentSpec())!==signature||String(authHeaders().Authorization||authHeaders().authorization||'')!==authKey)return false;
          live.select(currentSpec());
        }
        return false;
      }finally{conflictRetrying=false;paintLive(live.state());}
    }
    function storeKey(){const p=periodSpec(container),h=authHeaders();return JSON.stringify([p.startLocal,p.endLocal,h.Authorization||h.authorization||'']);}
    function storesReady(){return [settings,manual].every(store=>{const s=store?.state();return !!s?.loaded&&!s.loading&&!s.saving&&!s.error;});}
    // COFIRING_CLOSED_MANUAL_RESTORE_V1
    async function restoreClosedManualSnapshot(){
      /*
        Explicit manual-usage storage remains authoritative.
        Closed snapshot is used only when that period has
        no separately saved manual revision.
      */
      if(
        queryMode(container)!=='daily' ||
        manualDirty ||
        !manual
      ){
        return false;
      }

      const manualState=manual.state?.();

      if(
        !manualState?.loaded ||
        manualState.loading ||
        manualState.saving ||
        manualState.error
      ){
        return false;
      }

      if(Number(manualState.revision)>0){
        return false;
      }

      const date=String(
        container.querySelector(
          '[data-cfv7-date]'
        )?.value||''
      );

      if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)){
        return false;
      }

      /*
        Today's calculation must remain live/current.
        Closed-snapshot restoration is only for past dates.
      */
      if(date>=defaultCalculationDate()){
        return false;
      }

      const selectedSpec=currentSpec();
      const selectedEpoch=periodGeneration;
      const selectedStore=storeKey();

      let response;
      let payload;

      try{
        response=await root.fetch(
          '/api/cofiring-closed-history?targetDate='+
            encodeURIComponent(date),
          {
            method:'GET',
            credentials:'same-origin',
            cache:'no-store',
            headers:{
              ...authHeaders(),
              Accept:'application/json'
            }
          }
        );

        payload=await response.json();
      }catch(_){
        return false;
      }

      /*
        Ignore a late response if the operator changed date
        while the request was in flight.
      */
      if(
        disposed ||
        selectedEpoch!==periodGeneration ||
        selectedStore!==storeKey()
      ){
        return false;
      }

      if(
        !response.ok ||
        payload?.ok!==true ||
        !payload?.item?.snapshot
      ){
        return false;
      }

      const snapshot=payload.item.snapshot;

      /*
        Never apply a snapshot from another date/period.
      */
      if(
        snapshot.targetDate!==date ||
        snapshot.period?.startLocal!==selectedSpec.startLocal ||
        snapshot.period?.endLocal!==selectedSpec.endLocal ||
        snapshot.period?.stepUnit!==selectedSpec.stepUnit ||
        Number(snapshot.period?.stepValue)!==
          Number(selectedSpec.stepValue)
      ){
        return false;
      }

      /*
        Old/current closed snapshots may hold the finalized
        quantity in slightly different places.

        Priority:
        1) snapshot.manual
        2) snapshot.summary
        3) snapshot.result.units.*.*.quantity

        This also recovers a finalized closed result even if
        the operator did not separately press [사용량 저장].
      */
      function closedQuantity(unit,fuel){
        const candidates=[
          snapshot?.manual?.[unit]?.[fuel],
          snapshot?.summary?.[unit]?.[fuel],
          snapshot?.result?.units?.[unit]?.[fuel]?.quantity
        ];

        for(const raw of candidates){
          if(
            raw===null ||
            raw===undefined ||
            String(raw).trim()===''
          ){
            continue;
          }

          const value=Number(raw);

          if(
            Number.isFinite(value) &&
            value>=0
          ){
            return value;
          }
        }

        return null;
      }

      const restored={
        unit1:{
          organic:closedQuantity('unit1','organic'),
          manure:closedQuantity('unit1','manure')
        },
        unit2:{
          organic:closedQuantity('unit2','organic'),
          manure:closedQuantity('unit2','manure')
        }
      };

      const quantities=[
        restored.unit1.organic,
        restored.unit1.manure,
        restored.unit2.organic,
        restored.unit2.manure
      ];

      /*
        Require at least one finalized numeric quantity.
        0 is valid and must be restored.
      */
      if(
        !quantities.some(
          value=>
            typeof value==='number' &&
            Number.isFinite(value)
        )
      ){
        return false;
      }

      writeManual(
        container,
        restored
      );

      /*
        Closed data is finalized data.
        Prevent the Morning Meeting organic draft from
        overwriting the restored finalized organic values.
      */
      for(const unit of UNITS){
        const key=`${unit}:organic`;

        morningOrganicTouched.add(key);
        morningOrganicAuto.delete(key);
      }

      const label=container.querySelector(
        '[data-cfv5-manual-state]'
      );

      if(label){
        label.textContent='마감 데이터 복원';
      }

      const values=currentManualFromFields();

      renderOrganic(
        container,
        displayResult||lastResult,
        values
      );

      renderSummary(
        container,
        displayResult||lastResult,
        values,
        deadlineInputError
      );

      return true;
    }
    async function selectStores({force=false}={}){
      if(showDayUnavailable())return false;
      const p=periodSpec(container),next=storeKey();
      if(next!==selectedStoreKey){
        const draft=pendingDailyDraft?.signature===JSON.stringify(currentSpec())&&pendingDailyDraft.auth===String(authHeaders().Authorization||authHeaders().authorization||'')?pendingDailyDraft:null;pendingDailyDraft=null;
        selectedStoreKey=next;periodGeneration++;reference=null;lastResult=null;displayResult=null;adjustmentActive=false;settingsDirty=!!draft?.settings;manualDirty=!!draft?.manual;
        settings?.select(p.targetDate);manual?.select(p.startLocal,p.endLocal);writeManual(container,manualApi.blank());
        for(const [selector,value] of [...(draft?.manual||[]),...(draft?.settings||[])]){const input=container.querySelector(selector);if(input)input.value=value;}
      }
      const epoch=periodGeneration;live?.select(currentSpec());
      await Promise.all([settings?.load({force})||true,manual?.load({force})||true]);
      if(disposed||epoch!==periodGeneration||next!==storeKey())return false;
      paintSettings();paintManual();const closedManualRestored=await restoreClosedManualSnapshot();if(!closedManualRestored)applyMorningMeetingOrganicDraft({recalculate:false});if(!storesReady()){prepLabel('입력 기준 확인 필요','error');setStatus(container,settings?.state()?.error||manual?.state()?.error||'발열량과 사용량 저장 상태를 확인하고 있습니다.','error');return false;}if(reference)calculate();return true;
    }
    function paintSettings(force=false){if(!settings||showDayUnavailable())return;const s=settings.state(),state=container.querySelector('[data-cfv5-settings-state]');if((force||!settingsDirty)&&s.loaded)writeSettings(container,s.settings);if(state)state.textContent=s.error?s.error:s.saving?'저장 중...':s.loading?'불러오는 중...':settingsDirty?'수정됨 · 미저장':s.source==='saved'?`${s.effectiveDate} 적용값${s.updatedByName?' · '+s.updatedByName:''}`:'기본값';for(const el of container.querySelectorAll('[data-cfv5-calorific],[data-cfv5-coefficient]'))el.disabled=mobile||s.saving;container.querySelector('[data-cfv5-settings-save]').disabled=mobile||!s.canEdit||s.saving;}
    function currentManualFromFields(){try{return readManual(container);}catch(_){return manual?.state().values||manualApi.blank();}}
    function paintManual(force=false){if(!manual||showDayUnavailable())return;const s=manual.state(),label=container.querySelector('[data-cfv5-manual-state]');if((force||!manualDirty)&&s.loaded)writeManual(container,s.values);if(label)label.textContent=s.error?s.error:s.saving?'저장 중...':s.loading?'불러오는 중...':manualDirty?'수정됨 · 미저장':s.revision?`저장 v${s.revision}${s.updatedByName?' · '+s.updatedByName:''}`:'저장값 없음';container.querySelector('[data-cfv5-manual-save]').disabled=mobile||!s.canEdit||s.saving;for(const el of container.querySelectorAll('[data-cfv5-manual]'))el.disabled=mobile||s.saving;const values=currentManualFromFields();renderOrganic(container,displayResult||lastResult,values);renderSummary(container,displayResult||lastResult,values,deadlineInputError);bindManualInputs();}
    function morningOrganicSelectionKey(){
      return queryMode(container)==='daily'?(container.querySelector('[data-cfv7-date]')?.value||''):'';
    }
    function syncMorningOrganicSelection(){
      const next=morningOrganicSelectionKey();
      if(next!==morningOrganicSelection){morningOrganicSelection=next;morningOrganicTouched.clear();morningOrganicAuto.clear();}
      return next;
    }
    function parseMorningMeetingOrganicValue(id){
      const text=String(root.document?.getElementById?.(id)?.textContent||'').replace(/,/g,'').trim();
      if(!text||text==='-'||text==='—')return null;
      const match=text.match(/-?\d+(?:\.\d+)?/);
      if(!match)return null;
      const value=Number(match[0]);
      return Number.isFinite(value)&&value>=0?value:null;
    }
    function morningMeetingOrganicSource(){
      const targetDate=syncMorningOrganicSelection();
      if(!targetDate)return null;
      const cardDateText=String(root.document?.getElementById?.('efficiencyMorningMeetingCofiringDate')?.textContent||'');
      const cardDate=cardDateText.match(/20\d\d-\d\d-\d\d/)?.[0]||'';
      if(cardDate!==targetDate)return null;
      const values={
        unit1:parseMorningMeetingOrganicValue('efficiencyMorningMeetingCofiringUnit1OrganicInput'),
        unit2:parseMorningMeetingOrganicValue('efficiencyMorningMeetingCofiringUnit2OrganicInput')
      };
      return values.unit1===null&&values.unit2===null?null:{targetDate,values};
    }
    function applyMorningMeetingOrganicDraft({recalculate=true}={}){
      if(disposed||!manual)return false;
      const source=morningMeetingOrganicSource();
      if(!source)return false;
      let currentKey='';try{currentKey=storeKey();}catch(_){return false;}
      if(selectedStoreKey!==currentKey)return false;
      const state=manual.state();
      if(!state?.loaded||state.loading||state.saving||state.error)return false;
      let changed=false,hasAuto=false;
      for(const unit of UNITS){
        const value=source.values[unit];
        if(typeof value!=='number'||!Number.isFinite(value))continue;
        const key=`${unit}:organic`,input=container.querySelector(`[data-cfv5-manual="${key}"]`);
        if(!input||morningOrganicTouched.has(key))continue;
        const next=String(value),current=String(input.value??'').trim(),previous=morningOrganicAuto.get(key);
        if(previous!==undefined&&current!==String(previous)&&current!==''){morningOrganicTouched.add(key);morningOrganicAuto.delete(key);continue;}
        if(current!==next){input.value=next;changed=true;}
        morningOrganicAuto.set(key,next);hasAuto=true;
      }
      if(!changed)return false;
      manualDirty=true;
      const label=container.querySelector('[data-cfv5-manual-state]');if(label)label.textContent=hasAuto?'오전회의자료 자동입력 · 미저장':'수정됨 · 미저장';
      const values=currentManualFromFields();renderOrganic(container,displayResult||lastResult,values);renderSummary(container,displayResult||lastResult,values,deadlineInputError);
      if(recalculate&&reference&&storesReady())calculate();
      return true;
    }
    function bindMorningMeetingOrganicObserver(){
      if(disposed||!root.document||!root.MutationObserver)return;
      const card=root.document.getElementById('efficiencyMorningMeetingAutoCofiringCard');
      if(!card){
        if(morningCardBindAttempts>=40||morningCardBindTimer!==null)return;
        morningCardBindAttempts++;
        morningCardBindTimer=root.setTimeout?.(()=>{morningCardBindTimer=null;bindMorningMeetingOrganicObserver();},250)??null;
        return;
      }
      morningCardBindAttempts=0;
      if(card===morningCardObserved&&morningCardObserver){applyMorningMeetingOrganicDraft();return;}
      morningCardObserver?.disconnect();morningCardObserved=card;
      morningCardObserver=new root.MutationObserver(()=>{applyMorningMeetingOrganicDraft();});
      morningCardObserver.observe(card,{subtree:true,childList:true,characterData:true});
      applyMorningMeetingOrganicDraft();
    }

    function bindManualInputs(){for(const el of container.querySelectorAll('[data-cfv5-manual]'))if(el.dataset.cfv5Bound!=='1'){el.dataset.cfv5Bound='1';el.addEventListener('input',()=>{const manualKey=el.getAttribute('data-cfv5-manual')||'';if(/^unit[12]:organic$/.test(manualKey)){morningOrganicTouched.add(manualKey);morningOrganicAuto.delete(manualKey);}manualDirty=true;const label=container.querySelector('[data-cfv5-manual-state]');if(label)label.textContent='수정됨 · 미저장';if(reference&&storesReady())calculate();});el.addEventListener('change',()=>{if(reference)calculate();});}}
    // COFIRING_MANUAL_PROGRAMMATIC_RECALC_V1
    container.addEventListener('cofiring:manual-recalculate',()=>{if(reference)calculate();});
    function paintLive(s){
      if(showDayUnavailable()||!sameSelectedPeriod(s?.period))return;
      const item=s?.item,state=container.querySelector('[data-cfv5-live-state]'),active=item?.active,queryButton=container.querySelector('[data-cfv5-query]');
      const presentation=liveRequestPresentation(s,{conflictRetrying}),hardBusy=presentation.busy,failureMessage=presentation.failureMessage,requery=container.querySelector('[data-cfv5-requery]');
      queryButton.disabled=mobile||!s?.canQuery||hardBusy;
      queryButton.textContent=presentation.buttonText;
      if(requery)requery.disabled=mobile||!s?.canQuery||!item?.saved||hardBusy||!!active;
      const qualityGapSaved=!!(item?.saved&&reference?.summaries?.some?.(x=>x?.dataComplete===false));
      const stateText=!s?.authenticated?'로그인 필요':item?.error?item.error:item?.submitting?'요청 등록 중':active?.status==='pending'?'Agent 대기':active?.status==='processing'?presentation.progressLabel:failureMessage?(item?.saved&&reference?'재조회 실패 · 저장값 유지':'조회 실패'):item?.saved&&reference?(qualityGapSaved?'경계값 계산 · 품질 공백':'계산 완료'):item?.saved?'결과 확인 중':'저장결과 없음';
      if(state)state.textContent=stateText;
      if(clickTiming&&clickToken&&clickIsCurrent()){
        clickTiming.phase(clickToken,item?.submitting?'요청 등록 중':active?.status==='pending'?'회사 PC 대기':active?.status==='processing'?(presentation.progressLabel||'조회 중'):item?.loading?'결과 확인 중':'화면 반영 중');
        const expected=clickTiming.state().expectedRequestId;
        if(!s?.authenticated)clickTiming.cancel('로그인 상태 변경');
        else if(!active&&expected&&item?.lastAttempt?.id===expected&&item.lastAttempt.status==='failed')clickTiming.fail(clickToken,'조회 실패');
        finishClickTiming();
      }
      const source=container.querySelector('[data-cfv6-data-source]');
      if(source){const completed=s?.item?.result?.report?.completedAtUtc,date=completed?new Date(completed):null;
        const basis=(()=>{try{const p=currentSpec(),start=String(p?.startLocal||''),end=String(p?.endLocal||''),m=end.match(/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})$/);if(!m)return '자료 기준 확인 필요';const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]))-60000),pad=n=>String(n).padStart(2,'0'),dateText=`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,timeText=`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;return dateText!==start.slice(0,10)&&timeText==='00:00'?'자료 기준 하루 전체':`자료 기준 ${timeText}`;}catch(_){return '자료 기준 확인 필요';}})();
        source.textContent=date&&Number.isFinite(date.getTime())?`저장된 DataPARC 결과 사용 · ${basis} · 조회 완료 ${date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})} KST${active?' · 최신조회 진행 중':failureMessage?' · 최근 조회 실패':''}`:active?'새 DataPARC 결과를 기다리고 있습니다.':failureMessage?'DataPARC 조회에 실패했습니다. 저장된 결과가 아직 없습니다.':'저장된 DataPARC 결과가 아직 없습니다.';
      }

      if(!s?.authenticated){prepLabel('로그인 필요','error');setStatus(container,'로그인 세션이 만료되었습니다. 다시 로그인하면 고속 준비와 계산을 다시 시작할 수 있습니다.','error');}
      else if(item?.error)setStatus(container,item.error,'error');
      else if(item?.submitting)setStatus(container,'기간 조회 요청을 등록하고 있습니다. 아직 계산 전입니다.','working');
      else if(active?.status==='pending')setStatus(container,'회사 PC Agent 대기 중입니다. 아직 계산 전입니다.','working');
      else if(active?.status==='processing')setStatus(container,presentation.progressMessage,'working');
      else if(failureMessage){prepLabel(item?.saved&&reference?'재조회 실패 · 저장값 유지':'조회 실패','error');setStatus(container,`${failureMessage} ${item?.saved&&reference?'이전 저장 결과를 표시합니다. 새 조회는 [재조회]를 눌러주세요.':'[계산하기]를 누르면 새 조회를 요청합니다.'}`,'error');}
      else if(item?.saved&&reference)setStatus(container,qualityGapSaved?'DataPARC 중간 품질 공백이 있어도 시작·종료 누적 경계가 정상인 사용량은 표시합니다. [자료 확인 내용]에서 품질 공백 시간을 확인해 주세요.':lastResult?.warnings?.length?'저장값으로 혼소율을 계산했습니다. 빈칸 유기성·축분은 0t로 계산하며 자료 품질 경고는 [자료 확인 내용]에서 확인해 주세요.':'저장된 DataPARC 결과를 불러와 혼소율 계산까지 완료했습니다. 빈칸 유기성·축분은 0t로 계산됩니다.','success');
      else if(!item?.saved)setStatus(container,'저장된 결과가 없습니다. [계산하기]를 누르면 현재 표시 기간으로 조회합니다.','');
    }
    function analyze(){if(!reference)return null;const p=periodSpec(container),setting=readSettings(container),mv=manualForCalculation(readManual(container)),calorifics={unit1:{},unit2:{}},coefficients={unit1:{},unit2:{}};for(const u of UNITS)for(const fuel of FUEL_KEYS){calorifics[u][fuel]=setting[u][fuel].calorific;coefficients[u][fuel]=setting[u][fuel].coefficient;}return core.analyzePeriodSummary(reference,{startLocal:p.startLocal,endLocal:p.endLocal,calorifics,coefficients,organic:{start:p.start,end:p.end,unit1:mv.unit1.organic,unit2:mv.unit2.organic},manure:{start:p.start,end:p.end,unit1:mv.unit1.manure,unit2:mv.unit2.manure}});}
    function calculate(){
      try{
        lastResult=analyze();if(!lastResult)return null;deadlineInputError='';
        let shown=lastResult,adjusted=false;
        if(adjuster){try{const stored=adjuster.resolve(lastResult,readSettings(container),currentSpec());if(stored?.ok){shown=stored.result;adjusted=true;}}catch(_){}}
        renderDisplay(shown,{adjusted});
        renderedRequestId=live?.state()?.item?.saved?.id||null;
        const refreshing=!!live?.state()?.item?.active;prepLabel(refreshing?'저장값 재계산':'계산 완료',refreshing?'working':'ready');
        setStatus(container,refreshing?'저장된 결과와 현재 입력값으로 재계산했습니다. 최신 DataPARC 조회는 진행 중입니다.':adjusted?'선택 기간 혼소율 계산과 저장된 혼소 조정을 적용했습니다.':lastResult.warnings?.length?'혼소율을 계산했습니다. 자료 품질 경고는 [자료 확인 내용]에서 확인해 주세요. 빈칸 유기성·축분은 0t로 계산됩니다.':'선택 기간 혼소율 계산이 완료되었습니다. 빈칸 유기성·축분은 0t로 계산됩니다.','success');
        finishClickTiming();return shown;
      }catch(e){deadlineInputError=e.message||'계산 입력값을 확인해 주세요.';clearDeadlineRefresh();renderSummary(container,displayResult||lastResult,currentManualFromFields(),deadlineInputError);clickTiming?.fail(clickToken,'계산 오류');setStatus(container,deadlineInputError,'error');return null;}
    }
    async function periodChanged({deferReads=false,draft=null,capturedAt=Date.now()}={}){
      restoringSaved=false;pendingDailyDraft=draft;try{if(queryMode(container)==='daily')captureDailySelection(container,capturedAt);}catch(_){}
      selectionEpoch++;deadlineInputError='';clearDayBoundary();clearDeadlineRefresh();live?.pause();selectedStoreKey='';writeManual(container,manualApi.blank());
      clickTiming?.cancel('기간 변경');if(clickTiming)paintClickTiming(clickTiming.state());renderedRequestId=null;
      fastPrepGeneration++;if(fastPrepTimer){root.clearTimeout?.(fastPrepTimer);fastPrepTimer=null;}reference=null;lastResult=null;displayResult=null;adjustmentActive=false;renderMain(container,null);renderOrganic(container,null,currentManualFromFields());renderSummary(container,null,currentManualFromFields());updateRange(container);renderWarnings(container,null);const ab=container.querySelector('[data-cfv56-adjust]');if(ab){ab.disabled=true;ab.classList.remove('is-active');ab.textContent='혼소 조정';}
      try{const a=selectedDayAvailability();if(a.period)live?.select(currentSpec());if(showDayUnavailable()||deferReads)return;const pending=selectStores();setStatus(container,queryMode(container)==='daily'?'오늘은 00:00부터 현재까지 누적, 지난 날짜는 00:00부터 다음 날 00:01까지 계산합니다. [계산하기]를 눌러주세요.':'조회 기간이 변경되었습니다. [계산하기]를 누르면 표시한 기간으로 계산합니다.','');scheduleFastPrep(0);await pending;}catch(e){setStatus(container,e.message,'error');}
    }
    function refreshDailyForClick(){
      if(queryMode(container)!=='daily')return;
      const item=live?.state()?.item;if(item?.active||item?.submitting)return;
      const capturedAt=Date.now(),date=container.querySelector('[data-cfv7-date]')?.value||'',next=dailySelectionSpec(date,capturedAt),old=currentSpec();
      const spec={startLocal:next.startLocal,endLocal:next.endLocal,stepUnit:next.stepUnit,stepValue:next.stepValue};
      if(JSON.stringify(old)===JSON.stringify(spec))return;
      const inputDraft=(attribute)=>Array.from(container.querySelectorAll('['+attribute+']')).map(el=>['['+attribute+'="'+el.getAttribute(attribute)+'"]',el.value]);
      const sameDay=old.startLocal===spec.startLocal&&selectedStoreKey===storeKey(),draft={signature:JSON.stringify(spec),auth:String(authHeaders().Authorization||authHeaders().authorization||''),manual:null,settings:null};
      if(sameDay&&manualDirty)draft.manual=inputDraft('data-cfv5-manual');
      if(sameDay&&settingsDirty)draft.settings=[...inputDraft('data-cfv5-calorific'),...inputDraft('data-cfv5-coefficient')];
      // Reset synchronously and defer all reads until the click timer is started.
      void periodChanged({deferReads:true,draft,capturedAt});
    }
    for(const el of container.querySelectorAll('[data-cfv7-date],[data-cfv8-mode],[data-cfv8-start],[data-cfv8-end]'))el.addEventListener('change',periodChanged);
    container.querySelector('[data-cfv8-today]').addEventListener('click',async()=>{try{const p=currentDaySpec();container.querySelector('[data-cfv8-mode]').value='period';container.querySelector('[data-cfv8-start]').value=p.startLocal;container.querySelector('[data-cfv8-end]').value=p.endLocal;await periodChanged();}catch(_){setStatus(container,'오늘 누적 조회는 한국 시간 00:02 이후 사용할 수 있습니다.','');}});
    for(const el of container.querySelectorAll('[data-cfv5-calorific],[data-cfv5-coefficient]'))el.addEventListener('input',()=>{settingsDirty=true;paintSettings();if(reference&&storesReady())calculate();});
    container.querySelector('[data-cfv5-settings-save]').addEventListener('click',async()=>{try{const values=readSettings(container);const ok=await settings.save(values);if(ok){settingsDirty=false;paintSettings(true);if(reference)calculate();}}catch(e){setStatus(container,e.message,'error');}});
    container.querySelector('[data-cfv5-manual-save]').addEventListener('click',async()=>{try{const values=readManual(container),ok=await manual.save(values);if(ok){manualDirty=false;paintManual(true);if(reference)calculate();}}catch(e){setStatus(container,e.message,'error');}});
    container.querySelector('[data-cfv5-query]').addEventListener('click',async()=>{if(clickBusy)return;clickBusy=true;fastPrepGeneration++;restoringSaved=false;if(fastPrepTimer){root.clearTimeout?.(fastPrepTimer);fastPrepTimer=null;}let token=null;try{
      refreshDailyForClick();if(showDayUnavailable())return;
      const epoch=selectionEpoch,spec=currentSpec(),authKey=String(authHeaders().Authorization||authHeaders().authorization||''),signature=JSON.stringify(spec),stillSelected=()=>!disposed&&epoch===selectionEpoch&&visible()&&JSON.stringify(currentSpec())===signature&&String(authHeaders().Authorization||authHeaders().authorization||'')===authKey;
      token=startClickTiming(live.state().item?.active?'resume_existing':'calculate');live.select(spec);const cached=cachedReference(live.state(),spec);
      if(cached&&!live.state().item?.active&&selectedStoreKey===storeKey()&&storesReady()){
        reference=cached;const result=calculate();
        if(result)setStatus(container,'저장된 DataPARC 결과와 현재 입력값으로 즉시 재계산했습니다. 최신 데이터 조회는 [재조회]를 사용하세요.','success');
        return;
      }
      setStatus(container,'저장된 기간 결과를 먼저 확인하고 있습니다.','working');
      const storesTask=selectStores(),resultTask=live.load({force:true});
      const [storesLoaded,loaded]=await Promise.all([storesTask,resultTask]);
      if(!stillSelected())return;
      if(!storesLoaded){clickTiming?.fail(token,'계산 기준 확인 실패');return;}
      let liveState=live.state();
      if(liveState.item?.saved&&reference&&!liveState.item?.active){calculate();return;}
      if(liveState.item?.active){clickTiming?.acceptRequest(token,liveState.item.active.id);setStatus(container,'같은 기간의 DataPARC 요청 상태를 다시 확인했습니다. Agent 대기/작업 중이면 완료 후 자동 계산합니다.','working');return;}
      if(!loaded&&liveState.item?.error){clickTiming?.fail(token,'결과 확인 실패');setStatus(container,liveState.item.error,'error');return;}
      setStatus(container,'저장된 결과가 없어 현재 표시 기간으로 DataPARC 조회를 시작합니다. 완료되면 자동 계산합니다.','working');
      clickTiming?.requireRequest(token);
      const ok=await queryWithBusyRetry({force:false});liveState=live.state();
      if(!stillSelected())return;
      if(ok||liveState.item?.active){acceptClickRequest(token);}
      else{clickTiming?.fail(token,'조회 요청 확인 실패');if(!liveState.item?.saved)setStatus(container,liveState.item?.error||'기간 조회 요청을 시작하지 못했습니다. 로그인 상태와 조회 기간을 확인해 주세요.','error');}
    }catch(e){clickTiming?.fail(token,'조회 오류');setStatus(container,e.message,'error');}finally{clickBusy=false;}});
    container.querySelector('[data-cfv5-requery]').addEventListener('click',async()=>{if(clickBusy)return;clickBusy=true;fastPrepGeneration++;restoringSaved=false;if(fastPrepTimer){root.clearTimeout?.(fastPrepTimer);fastPrepTimer=null;}let token=null;try{if(!root.confirm||root.confirm('표시된 기간을 다시 조회하시겠습니까? 오늘 일별 계산은 현재까지로 갱신합니다.')){
      refreshDailyForClick();if(showDayUnavailable())return;
      const epoch=selectionEpoch,spec=currentSpec(),authKey=String(authHeaders().Authorization||authHeaders().authorization||''),signature=JSON.stringify(spec),stillSelected=()=>!disposed&&epoch===selectionEpoch&&visible()&&JSON.stringify(currentSpec())===signature&&String(authHeaders().Authorization||authHeaders().authorization||'')===authKey;
      token=startClickTiming('forced_requery');clickTiming?.requireRequest(token);setStatus(container,'같은 기간을 다시 조회하도록 요청하고 있습니다.','working');
      if(!await selectStores()){clickTiming?.fail(token,'계산 기준 확인 실패');return;}if(!stillSelected())return;live.select(spec);const ok=await queryWithBusyRetry({force:true});if(!stillSelected())return;const liveState=live.state();
      if(ok||liveState.item?.active)acceptClickRequest(token);else{clickTiming?.fail(token,'재조회 요청 확인 실패');setStatus(container,liveState.item?.error||'재조회 요청을 시작하지 못했습니다.','error');}
    }}catch(e){clickTiming?.fail(token,'재조회 오류');setStatus(container,e.message,'error');}finally{clickBusy=false;}});
    adjuster=adjustmentApi?.create({container,getHeaders:authHeaders,getContext:adjustmentContext,onMessage:m=>setStatus(container,m,'error'),onApply:(result)=>{renderDisplay(result,{adjusted:true});setStatus(container,'혼소 조정값을 선택기간 계산 화면에 적용했습니다. 원본 DataPARC 저장값은 변경하지 않습니다.','success');},onReset:()=>{if(lastResult){renderDisplay(lastResult,{adjusted:false});setStatus(container,'혼소 조정을 원복했습니다. DataPARC 원본 계산값을 표시합니다.','success');}}})||null;
    const adjustButton=container.querySelector('[data-cfv56-adjust]');if(adjustButton){adjustButton.disabled=true;adjustButton.addEventListener('click',()=>{try{Promise.resolve(adjuster?.open()).catch(e=>setStatus(container,e.message,'error'));}catch(e){setStatus(container,e.message,'error');}});}
    const observer=root.MutationObserver?new root.MutationObserver(()=>{if(visible()){if(showDayUnavailable())return;if(selectedStoreKey!==storeKey())void periodChanged();else{if(displayResult)renderSummary(container,displayResult,currentManualFromFields(),deadlineInputError);scheduleDeadlineRefresh();scheduleFastPrep(0);}}else{restoringSaved=false;clearDayBoundary();clearDeadlineRefresh();clickTiming?.cancel('화면 닫힘');fastPrepGeneration++;if(fastPrepTimer){root.clearTimeout?.(fastPrepTimer);fastPrepTimer=null;}live?.pause();}}):null;const view=container.closest?.('[data-efficiency-view]'),modal=root.document?.getElementById?.('efficiencyTeamModal');for(const node of [view,modal])if(node&&observer)observer.observe(node,{attributes:true,attributeFilter:['hidden','aria-hidden']});
    statusRefreshers.set(container,refreshStatusLine);
    updateRange(container);writeSettings(container,settings?.defaults?.()||{unit1:{coal:{calorific:5868,coefficient:1},bio:{calorific:3237,coefficient:1},organic:{calorific:3487,coefficient:1},manure:{calorific:3487,coefficient:1}},unit2:{coal:{calorific:5868,coefficient:1},bio:{calorific:3237,coefficient:1},organic:{calorific:3487,coefficient:1},manure:{calorific:3487,coefficient:1}}});const initialManual=manualApi?.blank?.()||{unit1:{organic:null,manure:null},unit2:{organic:null,manure:null}};renderMain(container,null);renderOrganic(container,null,initialManual);renderSummary(container,null,initialManual);bindManualInputs();bindMorningMeetingOrganicObserver();selectStores().catch(e=>setStatus(container,e.message,'error'));scheduleFastPrep(0);
    return {calculate,periodChanged,settings,manual,live,getResult:()=>lastResult,getDisplayResult:()=>displayResult,getSpec:currentSpec,dispose(){statusRefreshers.delete(container);clearDayBoundary();clearDeadlineRefresh();clickTiming?.dispose();disposed=true;fastPrepGeneration++;if(fastPrepTimer)root.clearTimeout?.(fastPrepTimer);observer?.disconnect();morningCardObserver?.disconnect();if(morningCardBindTimer!==null)root.clearTimeout?.(morningCardBindTimer);adjuster?.dispose?.();settings?.dispose();manual?.dispose();live?.dispose();}};
  }
  root.CofiringPeriodV5={mount,periodSpec,dailySpec,dailySelectionSpec,dayAvailability,defaultCalculationDate,queryMode,customSpec,currentDaySpec,selectedAvailability,targetReferenceMarkup,fuelUsageMarkup,markup,readSettings,readManual,manualForCalculation,coalBioHeat,coalBioRatio,combinedCoalBio,cachedReference,liveRequestPresentation};if(typeof module==='object'&&module.exports)module.exports=root.CofiringPeriodV5;
  if(root.document){const init=()=>{const container=root.document.querySelector('[data-cofiring-draft-root]');if(container)root.__cofiringPeriodV5Controller=mount(container);};if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();}
})(typeof globalThis==='object'?globalThis:this);
/* ===== COFIRING_BASIS_DETAIL_COMPACT_V10 ===== */
(function () {
  'use strict';

  let queued = false;

  function cellText(cell) {
    return String(cell?.textContent || '').trim() || '—';
  }

  function makeCell(tag, text, className) {
    const cell = document.createElement(tag);
    if (className) {
      cell.className = className;
    }
    cell.textContent = text;
    return cell;
  }

  function makePairCell(periodValue, averageValue) {
    const td = document.createElement('td');
    td.className = 'cfv10-detail-pair';

    const period = document.createElement('span');
    const periodLabel = document.createElement('small');
    const periodStrong = document.createElement('strong');

    periodLabel.textContent = '기간';
    periodStrong.textContent = periodValue;

    period.append(periodLabel, periodStrong);

    const average = document.createElement('span');
    const averageLabel = document.createElement('small');
    const averageStrong = document.createElement('strong');

    averageLabel.textContent = '평균';
    averageStrong.textContent = averageValue;

    average.append(averageLabel, averageStrong);

    td.append(period, average);
    return td;
  }

  function addCompactColgroup(table) {
    if (table.querySelector(':scope > colgroup.cfv10-detail-cols')) {
      return;
    }

    const group = document.createElement('colgroup');
    group.className = 'cfv10-detail-cols';

    const widths = [
      '7%',
      '10%',
      '7%',
      '10%',
      '8%',
      '10%',
      '7%',
      '10%',
      '8%',
      '11.5%',
      '11.5%'
    ];

    widths.forEach(function (width) {
      const col = document.createElement('col');
      col.style.width = width;
      group.appendChild(col);
    });

    table.insertBefore(group, table.firstChild);
  }

  function compactRow(row) {
    const cells = Array.from(row.children || []);

    /*
      Original detailed calculation row:
      0 unit
      1 measured period
      2 measured average
      3 factor
      4 actual period
      5 actual average
      6 heat
      7 measured period
      8 measured average
      9 factor
      10 actual period
      11 actual average
      12 heat
      13 total heat
      14 ratio
    */
    if (cells.length !== 15) {
      return false;
    }

    const values = cells.map(cellText);

    row.replaceChildren();

    row.appendChild(
      makeCell('th', values[0])
    );

    row.appendChild(
      makePairCell(values[1], values[2])
    );

    row.appendChild(
      makeCell('td', values[3], 'cfv10-detail-factor')
    );

    row.appendChild(
      makePairCell(values[4], values[5])
    );

    row.appendChild(
      makeCell('td', values[6], 'cfv10-detail-heat')
    );

    row.appendChild(
      makePairCell(values[7], values[8])
    );

    row.appendChild(
      makeCell('td', values[9], 'cfv10-detail-factor')
    );

    row.appendChild(
      makePairCell(values[10], values[11])
    );

    row.appendChild(
      makeCell('td', values[12], 'cfv10-detail-heat')
    );

    row.appendChild(
      makeCell('td', values[13], 'cfv10-detail-total-heat')
    );

    row.appendChild(
      makeCell('td', values[14], 'cfv10-detail-ratio')
    );

    return true;
  }

  function installDetailHeader(table, type) {
    if (table.dataset.cfv10DetailHeader === '1') {
      return;
    }

    table.dataset.cfv10DetailHeader = '1';
    table.classList.add('cfv10-detail-compact');

    addCompactColgroup(table);

    const thead = table.querySelector('thead');
    if (!thead) {
      return;
    }

    if (type === 'coalBio') {
      thead.innerHTML = `
        <tr>
          <th rowspan="2">설비</th>
          <th colspan="4" class="cfv5-head-coal">Coal</th>
          <th colspan="4" class="cfv5-head-bio">Bio-SRF</th>
          <th colspan="2" class="cfv5-head-ratio">혼소율 산정</th>
        </tr>
        <tr>
          <th>계측량<br><small>기간 / 평균</small></th>
          <th>보정</th>
          <th>실사용량<br><small>기간 / 평균</small></th>
          <th>열량<br><small>Gcal</small></th>

          <th>계측량<br><small>기간 / 평균</small></th>
          <th>보정</th>
          <th>실사용량<br><small>기간 / 평균</small></th>
          <th>열량<br><small>Gcal</small></th>

          <th>Coal+Bio<br>열량</th>
          <th>Bio<br>혼소율</th>
        </tr>
      `;
    } else {
      thead.innerHTML = `
        <tr>
          <th rowspan="2">설비</th>
          <th colspan="4" class="cfv5-head-organic">유기성 고형연료</th>
          <th colspan="4" class="cfv5-head-manure">축분</th>
          <th colspan="2" class="cfv5-head-ratio">혼소율 산정</th>
        </tr>
        <tr>
          <th>사용량<br><small>기간 / 평균</small></th>
          <th>보정</th>
          <th>실사용량<br><small>기간 / 평균</small></th>
          <th>열량<br><small>Gcal</small></th>

          <th>사용량<br><small>기간 / 평균</small></th>
          <th>보정</th>
          <th>실사용량<br><small>기간 / 평균</small></th>
          <th>열량<br><small>Gcal</small></th>

          <th>총 열량</th>
          <th>혼소율</th>
        </tr>
      `;
    }
  }

  function compactDetailTable(table, type) {
    if (!table) {
      return;
    }

    installDetailHeader(table, type);

    table
      .querySelectorAll('tbody tr')
      .forEach(compactRow);
  }

  function compactBasis(root) {
    const table = root.querySelector('.cfv5-basis-table');

    if (
      !table ||
      table.dataset.cfv10CommonBasis === '1'
    ) {
      return;
    }

    table.dataset.cfv10CommonBasis = '1';
    table.classList.add('cfv10-common-basis');

    const wrap = table.closest('.cfv5-basis-wrap');
    if (wrap) {
      wrap.classList.add('cfv10-common-basis-wrap');

      const title = wrap.querySelector('.cfv5-basis-title');
      if (title) {
        title.textContent =
          '공통 연료 발열량(Net Calorific Value) · 보정계수 · 1·2호기 동일 적용';
      }
    }

    const rows = table.tHead?.rows;

    if (rows?.[0]) {
      const cells = rows[0].cells;

      if (cells[1]) {
        cells[1].textContent = '공통 기준';
        cells[1].colSpan = 2;
      }

      if (cells[2]) {
        cells[2].hidden = true;
      }
    }

    if (rows?.[1]) {
      if (rows[1].cells[3]) {
        rows[1].cells[3].hidden = true;
      }

      if (rows[1].cells[4]) {
        rows[1].cells[4].hidden = true;
      }
    }

    table
      .querySelectorAll('tbody tr')
      .forEach(function (row) {
        if (row.cells[3]) {
          row.cells[3].hidden = true;
        }

        if (row.cells[4]) {
          row.cells[4].hidden = true;
        }
      });
  }

  function apply() {
    queued = false;

    const root =
      document.querySelector('[data-cofiring-draft-root]');

    if (!root) {
      return;
    }

    compactBasis(root);

    compactDetailTable(
      root.querySelector('.cfv5-coal-bio'),
      'coalBio'
    );

    compactDetailTable(
      root.querySelector('.cfv5-organic'),
      'organic'
    );
  }

  function schedule() {
    if (queued) {
      return;
    }

    queued = true;

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(apply);
    } else {
      setTimeout(apply, 0);
    }
  }

  function start() {
    apply();

    const root =
      document.querySelector('[data-cofiring-draft-root]');

    if (
      !root ||
      typeof MutationObserver !== 'function'
    ) {
      return;
    }

    new MutationObserver(schedule)
      .observe(root, {
        childList: true,
        subtree: true
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
/* ===== /COFIRING_BASIS_DETAIL_COMPACT_V10 ===== */
