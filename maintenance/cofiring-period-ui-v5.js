(function(root){
  'use strict';
  const core=root.CofiringCore||(typeof require==='function'?require('./cofiring-core.js'):null);
  const liveApi=root.CofiringLive;
  const settingsApi=root.CofiringCalculationSettingsStorage;
  const manualApi=root.CofiringPeriodManualStorage;
  const adjustmentApi=root.CofiringPeriodAdjustmentV56||(typeof require==='function'?require('./cofiring-period-adjustment-v56.js'):null);
  const targetReferenceApi=root.CofiringTargetReferenceV6||(typeof require==='function'?require('./cofiring-target-reference-v6.js'):null);
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
    return {busy,buttonText,failureMessage:failure?(String(failure.errorMessage||'').trim()||'DataPARC 조회에 실패했습니다.'):''};
  }
  function authHeaders(){return typeof root.getShiftLogAuthHeaders==='function'?root.getShiftLogAuthHeaders():{};}
  function isMobile(){try{return /^\/mobile(?:\/|$)/i.test(root.location?.pathname||'')||/Android|iPhone|iPad|iPod|Mobile/i.test(root.navigator?.userAgent||'')||(root.navigator?.platform==='MacIntel'&&Number(root.navigator?.maxTouchPoints)>0)||(typeof root.isShiftLogMobileView==='function'?root.isShiftLogMobileView():!!root.matchMedia?.('(max-width: 768px)').matches);}catch(_){return true;}}
  function kstNowMinute(offsetMinutes=0){const ms=Date.now()+9*3600000+offsetMinutes*60000;return new Date(ms).toISOString().slice(0,16);}
  function defaultPeriod(){let end=kstNowMinute(-2),start=end.slice(0,10)+'T00:00';if(end<=start){const d=new Date(Date.now()+9*3600000-24*3600000).toISOString().slice(0,10);start=d+'T00:00';end=new Date(Date.parse(d+'T00:00:00Z')+24*3600000).toISOString().slice(0,16);}return {start,end};}
  function periodSpec(container){const start=container.querySelector('[data-cfv5-start]')?.value||'',end=container.querySelector('[data-cfv5-end]')?.value||'',stepUnit=container.querySelector('[data-cfv5-step-unit]')?.value||'hour',stepValue=Number(container.querySelector('[data-cfv5-step-value]')?.value||1);return core.periodRange(start,end,stepUnit,stepValue);}
  function markup(){
    const d=defaultPeriod();
    return `<div class="cfv5-sheet">
      <div class="cfv5-title-row">
        <div class="cfv5-title-copy"><span class="cfv5-eyebrow">FUEL OPERATIONS</span><h2>혼소율 분석</h2></div>
        <span class="cfv5-version"><i aria-hidden="true"></i>Bio 목표 <strong>25%</strong></span>
      </div>

      <div class="cfv5-query-box">
        <div class="cfv5-query-grid">
          <label>조회 시작<input data-cfv5-start type="datetime-local" value="${d.start}" step="60"></label>
          <label>조회 종료<input data-cfv5-end type="datetime-local" value="${d.end}" step="60"></label>
          <label>집계 간격<span class="cfv5-step"><input data-cfv5-step-value type="number" min="1" max="1440" step="1" value="1"><select data-cfv5-step-unit><option value="minute">분</option><option value="hour" selected>시간</option><option value="day">일</option></select></span></label>
          <div class="cfv5-query-actions">
            <button type="button" class="cfv5-get" data-cfv5-query>계산하기</button>
            <button type="button" class="cfv5-requery" data-cfv5-requery>재조회</button>
          </div>
        </div>
        <div class="cfv5-query-meta"><span data-cfv5-range>—</span><span class="cfv56-query-state"><em data-cfv56-prep>조회 준비 대기</em><strong data-cfv5-live-state>조회 전</strong></span></div>
        <span class="cfv6-data-source" data-cfv6-data-source>저장된 조회 결과가 있으면 바로 계산합니다.</span>
        <p data-cfv5-status role="status" aria-live="polite">기간을 지정한 뒤 [계산하기]를 누르세요. 저장결과가 없으면 DataPARC 조회 후 자동 계산합니다.</p>
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

      <details class="cfv6-target-basis"><summary>25% 투입 참고치 계산 기준</summary><p>선택기간의 평균 Coal+Bio 투입열량을 유지하며 Bio 열량 25%, Coal 열량 75%로 배분한 시간당 실사용량입니다. 호기별 발열량과 보정계수를 반영하며, 위 Coal 참고치와 함께 성립합니다. 현재 평균은 선택기간 누적 실사용량 ÷ 기간 시간입니다.</p><p>Bio 참고치(t/h) = (Coal+Bio 열량 Gcal ÷ 기간 시간) × 25% × 1,000 ÷ Bio 발열량(kcal/kg). 순간 투입 지시값이나 마감 시각까지 부족분을 보충하는 값은 아닙니다. 혼소 조정 적용 시 조정된 표시값을 기준으로 계산합니다.</p></details>

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
      </div>${targetReferenceMarkup(null)}<div class="cfv52-fuel-grid">${FUEL_KEYS.map(f=>summaryMetric(FUEL_LABEL[f]+' 사용량',null,{suffix:'t'})).join('')}</div></article>`);
    cards.push(`<article class="cfv52-card cfv52-card-total"><header><strong>1·2호기 합산</strong><span>열량 가중 기준</span></header><div class="cfv52-total-ratios">${summaryMetric('바이오 혼소율',null,{ratio:true})}${summaryMetric('유기성 및 축분 혼소율',null,{ratio:true})}${summaryMetric('종합혼소율',null,{ratio:true,emphasis:true})}</div></article>`);
    return cards.join('');
  }
  function targetReferenceMarkup(reference){
    const ready=!!reference;
    const target=reference?.targetBioTonPerHour,current=reference?.currentBioTonPerHour,difference=reference?.differenceBioTonPerHour;
    const delta=typeof difference==='number'&&Number.isFinite(difference)?Math.abs(difference)<0.005?'현재 평균과 동일':`현재 평균 대비 ${num(Math.abs(difference))} t/h ${difference>0?'높음':'낮음'}`:'조회 후 참고치 표시';
    const measured=reference?.targetMeasuredBioTonPerHour;
    const measuredNote=typeof measured==='number'&&Math.abs(measured-target)>=0.005?` · Bio 계측 환산 ${num(measured)} t/h`:'';
    return `<div class="cfv6-target" data-cfv6-target><div class="cfv6-target-main"><div><span class="cfv6-target-label">Bio 25% 목표 참고치</span><strong data-cfv6-target-bio>${ready?num(target):'—'} <small>t/h</small></strong></div><div class="cfv6-target-comparison"><span>현재 평균 <b data-cfv6-current-bio>${ready?num(current):'—'} t/h</b></span><span data-cfv6-target-delta>${delta}</span></div></div><p>동일 열량 기준 Coal <b data-cfv6-target-coal>${ready?num(reference.targetCoalTonPerHour):'—'} t/h</b>${measuredNote}</p></div>`;
  }
  function rowsPlaceholder(count,cols){return Array.from({length:count},(_,i)=>`<tr><th>${i<2?i+1+'호기':'계'}</th>${Array.from({length:cols-1},()=>'<td>—</td>').join('')}</tr>`).join('');}
  function manualRowsPlaceholder(){return `<tr data-cfv5-manual-row="unit1"><th>1호기</th>${Array.from({length:14},()=>'<td>—</td>').join('')}</tr><tr data-cfv5-manual-row="unit2"><th>2호기</th>${Array.from({length:14},()=>'<td>—</td>').join('')}</tr><tr data-cfv5-manual-row="sum"><th>계</th>${Array.from({length:14},()=>'<td>—</td>').join('')}</tr>`;}
  function readSettings(container){const output={unit1:{},unit2:{}};for(const unit of UNITS)for(const fuel of FUEL_KEYS){const c=Number(container.querySelector(`[data-cfv5-calorific="${unit}:${fuel}"]`)?.value),f=Number(container.querySelector(`[data-cfv5-coefficient="${unit}:${fuel}"]`)?.value);if(!Number.isFinite(c)||c<=0||c>50000||!Number.isFinite(f)||f<=0||f>100)throw new Error(`${unit==='unit1'?'1':'2'}호기 ${FUEL_LABEL[fuel]} 발열량·보정계수를 확인해 주세요.`);output[unit][fuel]={calorific:c,coefficient:f};}return output;}
  function writeSettings(container,settings){if(!settings)return;for(const unit of UNITS)for(const fuel of FUEL_KEYS){const s=settings?.[unit]?.[fuel];if(!s)continue;const c=container.querySelector(`[data-cfv5-calorific="${unit}:${fuel}"]`),f=container.querySelector(`[data-cfv5-coefficient="${unit}:${fuel}"]`);if(c)c.value=String(s.calorific);if(f)f.value=String(s.coefficient);}}
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
  function renderSummary(container,result,manualValues){
    const host=container.querySelector('[data-cfv52-summary-grid]'),note=container.querySelector('[data-cfv52-summary-note]');if(!host)return;
    if(!result){host.innerHTML=summaryPlaceholder();if(note)note.textContent='DataPARC 조회 전';return;}
    const cards=[];
    for(const [i,unit] of UNITS.entries()){
      const u=result?.units?.[unit],manualComplete=!!(u?.organic?.complete&&u?.manure?.complete),bioReady=coalBioRatio(u)!==null;
      cards.push(`<article class="cfv52-card" data-cfv52-unit="${unit}"><header><div class="cfv52-unit-title"><span class="cfv52-unit-number" aria-hidden="true">0${i+1}</span><div><strong>${i+1}호기</strong></div></div><span class="cfv52-card-status${manualComplete&&bioReady?'':' is-waiting'}">${manualComplete&&bioReady?'계산 완료':bioReady?'종합 계산 대기':'조회값 확인'}</span></header><div class="cfv52-metrics">
        ${summaryMetric('바이오 혼소율',coalBioRatio(u),{ratio:true})}
        ${summaryMetric('유기성 및 축분 혼소율',u?.fuelRatios?.organicGroup,{ratio:true})}
        ${summaryMetric('종합혼소율',u?.fuelRatios?.total,{ratio:true,emphasis:true})}
      </div>${targetReferenceMarkup(targetReferenceApi?.forUnit(u,result?.period?.durationHours))}<div class="cfv52-fuel-grid">${FUEL_KEYS.map(f=>summaryMetric(FUEL_LABEL[f]+' 사용량',u?.[f]?.quantity,{suffix:'t'})).join('')}</div></article>`);
    }
    cards.push(`<article class="cfv52-card cfv52-card-total"><header><strong>1·2호기 합산</strong><span>열량 가중 기준</span></header><div class="cfv52-total-ratios">
      ${summaryMetric('바이오 혼소율',combinedCoalBio(result).ratio,{ratio:true})}
      ${summaryMetric('유기성 및 축분 혼소율',result?.combined?.fuelRatios?.organicGroup,{ratio:true})}
      ${summaryMetric('종합혼소율',result?.combined?.ratios?.total,{ratio:true,emphasis:true})}
    </div></article>`);
    host.innerHTML=cards.join('');
    if(note)note.textContent=result?.warnings?.length?'자료 확인 필요':'계산 완료';
  }
  function safeHours(container){try{return periodSpec(container).durationHours;}catch(_){return 0;}}
  function settingFactor(container,unit,fuel){const n=Number(container.querySelector(`[data-cfv5-coefficient="${unit}:${fuel}"]`)?.value);return Number.isFinite(n)?n:null;}
  function setStatus(container,text,tone=''){const el=container.querySelector('[data-cfv5-status]');if(el){el.textContent=text;el.dataset.tone=tone;}}
  function updateRange(container){try{const p=periodSpec(container);container.querySelector('[data-cfv5-range]').textContent=`${p.startLocal.replace('T',' ')} ~ ${p.endLocal.replace('T',' ')} · ${p.durationMinutes.toLocaleString('ko-KR')}분 · ${p.stepValue}${p.stepUnit==='minute'?'분':p.stepUnit==='hour'?'시간':'일'} 간격`;return p;}catch(e){container.querySelector('[data-cfv5-range]').textContent=e.message;return null;}}
  function renderWarnings(container,result){const box=container.querySelector('[data-cfv5-warning-box]'),list=container.querySelector('[data-cfv5-warnings]'),warnings=result?.warnings||[];box.hidden=!warnings.length;list.innerHTML=warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join('');}
  function mount(container){
    if(!container||container.dataset.cofiringV5Mounted==='true')return null;container.dataset.cofiringV5Mounted='true';container.classList.add('cofiring-period-v5');container.innerHTML=markup();
    const mobile=isMobile();let reference=null,lastResult=null,displayResult=null,periodGeneration=0,settingsDirty=false,manualDirty=false,disposed=false,fastPrepTimer=null,fastPrepGeneration=0,adjustmentActive=false,conflictRetrying=false,selectedStoreKey='';
    const settings=settingsApi?.create({getHeaders:authHeaders,canEdit:()=>!isMobile(),onChange:()=>paintSettings()})||null;
    const manual=manualApi?.create({getHeaders:authHeaders,canEdit:()=>!isMobile(),onChange:()=>paintManual()})||null;
    const live=liveApi?.createPeriod({getHeaders:authHeaders,canQuery:()=>!isMobile(),isVisible:()=>visible(),onChange:s=>paintLive(s),onResult:r=>{reference=r.report.reference;if(storesReady())calculate();}})||null;
    function visible(){return !container.closest?.('[hidden], [aria-hidden="true"]');}
    function currentSpec(){const p=periodSpec(container);return {startLocal:p.startLocal,endLocal:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue};}
    function prepLabel(text,tone=''){const el=container.querySelector('[data-cfv56-prep]');if(el){el.textContent=text;el.dataset.tone=tone;}}
    function renderDisplay(result,{adjusted=false}={}){displayResult=result;const manualValues=readManual(container);renderMain(container,result);renderOrganic(container,result,manualValues);renderSummary(container,result,manualValues);renderWarnings(container,result);adjustmentActive=!!adjusted;const b=container.querySelector('[data-cfv56-adjust]');if(b){b.disabled=!lastResult||mobile;b.classList.toggle('is-active',adjustmentActive);b.textContent=adjustmentActive?'혼소 조정 적용중':'혼소 조정';}const note=container.querySelector('[data-cfv52-summary-note]');if(note&&adjusted)note.textContent='혼소 조정 적용';}
    function adjustmentContext(){return {result:lastResult,settings:readSettings(container),spec:currentSpec()};}
    let adjuster=null;
    function scheduleFastPrep(delay=900){if(fastPrepTimer){root.clearTimeout?.(fastPrepTimer);fastPrepTimer=null;}const epoch=++fastPrepGeneration;if(disposed||mobile||!visible()||!live)return;prepLabel('고속 준비 예약');fastPrepTimer=root.setTimeout?.(()=>{fastPrepTimer=null;void fastPrepare(epoch);},delay);}
    async function fastPrepare(epoch){if(disposed||epoch!==fastPrepGeneration||mobile||!visible()||!live)return;try{prepLabel('저장값 확인','working');live.select(currentSpec());await live.load({force:true});if(disposed||epoch!==fastPrepGeneration)return;const s=live.state();if(liveRequestPresentation(s).failureMessage){paintLive(s);return;}if(s.item?.saved&&reference){prepLabel(storesReady()?'즉시 계산 가능':'입력 기준 확인 중',storesReady()?'ready':'working');return;}if(s.item?.active){prepLabel('동일기간 조회 진행중','working');return;}if(!s.canQuery){prepLabel(s.authenticated?'조회 준비 불가':'로그인 필요',s.authenticated?'':'error');return;}prepLabel('조회 준비 완료','ready');setStatus(container,'저장된 결과가 없습니다. 자동 DataPARC 조회는 시작하지 않습니다. [계산하기]를 누르면 현재 표시 기간으로 1회 조회합니다.','');}catch(e){prepLabel('저장값 확인 실패','error');}}
    function waitMs(ms){return new Promise(resolve=>{if(root.setTimeout)root.setTimeout(resolve,ms);else resolve();});}
    async function queryWithBusyRetry({force=false,maxRetries=20}={}){
      const signature=JSON.stringify(currentSpec());let attempt=0;conflictRetrying=true;paintLive(live.state());
      try{
        while(!disposed&&visible()&&JSON.stringify(currentSpec())===signature){
          const ok=await live.query({explicit:true,force}),state=live.state();
          if(ok||state.item?.active||(!force&&state.item?.saved))return true;
          const message=String(state.item?.error||'');
          if(!/같은 시작일의 다른 혼소율 기간 조회/.test(message)||attempt>=maxRetries)return false;
          attempt+=1;prepLabel('이전 조회 정리 대기','working');
          setStatus(container,`이전 자동 준비 조회가 아직 종료되지 않았습니다. 종료되는 즉시 현재 기간으로 자동 재시도합니다. (${attempt}/${maxRetries})`,'working');
          await waitMs(3000);
          if(disposed||!visible()||JSON.stringify(currentSpec())!==signature)return false;
          live.select(currentSpec());
        }
        return false;
      }finally{conflictRetrying=false;paintLive(live.state());}
    }
    function storeKey(){const p=periodSpec(container),h=authHeaders();return JSON.stringify([p.startLocal,p.endLocal,h.Authorization||h.authorization||'']);}
    function storesReady(){return [settings,manual].every(store=>{const s=store?.state();return !!s?.loaded&&!s.loading&&!s.saving&&!s.error;});}
    async function selectStores({force=false}={}){
      const p=periodSpec(container),next=storeKey();
      if(next!==selectedStoreKey){selectedStoreKey=next;periodGeneration++;reference=null;lastResult=null;displayResult=null;adjustmentActive=false;settingsDirty=false;manualDirty=false;settings?.select(p.targetDate);manual?.select(p.startLocal,p.endLocal);writeManual(container,manualApi.blank());}
      const epoch=periodGeneration;live?.select(currentSpec());
      await Promise.all([settings?.load({force})||true,manual?.load({force})||true]);
      if(disposed||epoch!==periodGeneration||next!==storeKey())return false;
      paintSettings();paintManual();if(!storesReady()){prepLabel('입력 기준 확인 필요','error');setStatus(container,settings?.state()?.error||manual?.state()?.error||'발열량과 사용량 저장 상태를 확인하고 있습니다.','error');return false;}if(reference)calculate();return true;
    }
    function paintSettings(force=false){if(!settings)return;const s=settings.state(),state=container.querySelector('[data-cfv5-settings-state]');if((force||!settingsDirty)&&s.loaded)writeSettings(container,s.settings);if(state)state.textContent=s.error?s.error:s.saving?'저장 중...':s.loading?'불러오는 중...':settingsDirty?'수정됨 · 미저장':s.source==='saved'?`${s.effectiveDate} 적용값${s.updatedByName?' · '+s.updatedByName:''}`:'기본값';for(const el of container.querySelectorAll('[data-cfv5-calorific],[data-cfv5-coefficient]'))el.disabled=mobile||s.saving;container.querySelector('[data-cfv5-settings-save]').disabled=mobile||!s.canEdit||s.saving;}
    function currentManualFromFields(){try{return readManual(container);}catch(_){return manual?.state().values||manualApi.blank();}}
    function paintManual(force=false){if(!manual)return;const s=manual.state(),label=container.querySelector('[data-cfv5-manual-state]');if((force||!manualDirty)&&s.loaded)writeManual(container,s.values);if(label)label.textContent=s.error?s.error:s.saving?'저장 중...':s.loading?'불러오는 중...':manualDirty?'수정됨 · 미저장':s.revision?`저장 v${s.revision}${s.updatedByName?' · '+s.updatedByName:''}`:'저장값 없음';container.querySelector('[data-cfv5-manual-save]').disabled=mobile||!s.canEdit||s.saving;for(const el of container.querySelectorAll('[data-cfv5-manual]'))el.disabled=mobile||s.saving;const values=currentManualFromFields();renderOrganic(container,displayResult||lastResult,values);renderSummary(container,displayResult||lastResult,values);bindManualInputs();}
    function bindManualInputs(){for(const el of container.querySelectorAll('[data-cfv5-manual]'))if(el.dataset.cfv5Bound!=='1'){el.dataset.cfv5Bound='1';el.addEventListener('input',()=>{manualDirty=true;const label=container.querySelector('[data-cfv5-manual-state]');if(label)label.textContent='수정됨 · 미저장';if(reference&&storesReady()){try{readManual(container);calculate();}catch(_){}}});el.addEventListener('change',()=>{if(reference)calculate();});}}
    function paintLive(s){
      const item=s?.item,state=container.querySelector('[data-cfv5-live-state]'),active=item?.active,queryButton=container.querySelector('[data-cfv5-query]');
      const presentation=liveRequestPresentation(s,{conflictRetrying}),hardBusy=presentation.busy,failureMessage=presentation.failureMessage,requery=container.querySelector('[data-cfv5-requery]');
      queryButton.disabled=mobile||!s?.canQuery||hardBusy;
      queryButton.textContent=presentation.buttonText;
      if(requery)requery.disabled=mobile||!s?.canQuery||!item?.saved||hardBusy||!!active;
      const qualityGapSaved=!!(item?.saved&&reference?.summaries?.some?.(x=>x?.dataComplete===false));
      const stateText=!s?.authenticated?'로그인 필요':item?.error?item.error:item?.submitting?'요청 등록 중':active?.status==='pending'?'Agent 대기':active?.status==='processing'?'DataPARC 작업 중':failureMessage?(item?.saved&&reference?'재조회 실패 · 저장값 유지':'조회 실패'):item?.saved&&reference?(qualityGapSaved?'경계값 계산 · 품질 공백':'계산 완료'):item?.saved?'결과 확인 중':'저장결과 없음';
      if(state)state.textContent=stateText;
      const source=container.querySelector('[data-cfv6-data-source]');
      if(source){const completed=s?.item?.result?.report?.completedAtUtc,date=completed?new Date(completed):null;
        source.textContent=date&&Number.isFinite(date.getTime())?`DataPARC 조회 완료 ${date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})} KST · 저장결과 기준${active?' · 최신조회 진행 중':failureMessage?' · 최근 조회 실패':''}`:active?'새 DataPARC 결과를 기다리고 있습니다.':failureMessage?'DataPARC 조회에 실패했습니다. 저장된 결과가 아직 없습니다.':'저장된 DataPARC 결과가 아직 없습니다.';
      }

      if(!s?.authenticated){prepLabel('로그인 필요','error');setStatus(container,'로그인 세션이 만료되었습니다. 다시 로그인하면 고속 준비와 계산을 다시 시작할 수 있습니다.','error');}
      else if(item?.error)setStatus(container,item.error,'error');
      else if(item?.submitting)setStatus(container,'기간 조회 요청을 등록하고 있습니다. 아직 계산 전입니다.','working');
      else if(active?.status==='pending')setStatus(container,'회사 PC Agent 대기 중입니다. 아직 계산 전입니다.','working');
      else if(active?.status==='processing')setStatus(container,'DataPARC 조회·Excel 정리 작업이 진행 중입니다. 서버에 저장 결과가 도착하면 숫자가 자동 표시됩니다. 아직 계산 완료가 아닙니다.','working');
      else if(failureMessage){prepLabel(item?.saved&&reference?'재조회 실패 · 저장값 유지':'조회 실패','error');setStatus(container,`${failureMessage} ${item?.saved&&reference?'이전 저장 결과를 표시합니다. 새 조회는 [재조회]를 눌러주세요.':'[계산하기]를 누르면 새 조회를 요청합니다.'}`,'error');}
      else if(item?.saved&&reference)setStatus(container,qualityGapSaved?'DataPARC 중간 품질 공백이 있어도 시작·종료 누적 경계가 정상인 사용량은 표시합니다. [자료 확인 내용]에서 품질 공백 시간을 확인해 주세요.':lastResult?.warnings?.length?'저장값으로 혼소율을 계산했습니다. 빈칸 유기성·축분은 0t로 계산하며 자료 품질 경고는 [자료 확인 내용]에서 확인해 주세요.':'저장된 DataPARC 결과를 불러와 혼소율 계산까지 완료했습니다. 빈칸 유기성·축분은 0t로 계산됩니다.','success');
      else if(!item?.saved)setStatus(container,'저장된 결과가 없습니다. [계산하기]를 누르면 현재 표시 기간으로 조회합니다.','');
    }
    function analyze(){if(!reference)return null;const p=periodSpec(container),setting=readSettings(container),mv=manualForCalculation(readManual(container)),calorifics={unit1:{},unit2:{}},coefficients={unit1:{},unit2:{}};for(const u of UNITS)for(const fuel of FUEL_KEYS){calorifics[u][fuel]=setting[u][fuel].calorific;coefficients[u][fuel]=setting[u][fuel].coefficient;}return core.analyzePeriodSummary(reference,{startLocal:p.startLocal,endLocal:p.endLocal,calorifics,coefficients,organic:{start:p.start,end:p.end,unit1:mv.unit1.organic,unit2:mv.unit2.organic},manure:{start:p.start,end:p.end,unit1:mv.unit1.manure,unit2:mv.unit2.manure}});}
    function calculate(){
      try{
        lastResult=analyze();if(!lastResult)return null;
        let shown=lastResult,adjusted=false;
        if(adjuster){try{const stored=adjuster.resolve(lastResult,readSettings(container),currentSpec());if(stored?.ok){shown=stored.result;adjusted=true;}}catch(_){}}
        renderDisplay(shown,{adjusted});
        const refreshing=!!live?.state()?.item?.active;prepLabel(refreshing?'저장값 재계산':'계산 완료',refreshing?'working':'ready');
        setStatus(container,refreshing?'저장된 결과와 현재 입력값으로 재계산했습니다. 최신 DataPARC 조회는 진행 중입니다.':adjusted?'선택 기간 혼소율 계산과 저장된 혼소 조정을 적용했습니다.':lastResult.warnings?.length?'혼소율을 계산했습니다. 자료 품질 경고는 [자료 확인 내용]에서 확인해 주세요. 빈칸 유기성·축분은 0t로 계산됩니다.':'선택 기간 혼소율 계산이 완료되었습니다. 빈칸 유기성·축분은 0t로 계산됩니다.','success');
        return shown;
      }catch(e){setStatus(container,e.message||'혼소율을 계산하지 못했습니다.','error');return null;}
    }
    async function periodChanged(){
      fastPrepGeneration++;if(fastPrepTimer){root.clearTimeout?.(fastPrepTimer);fastPrepTimer=null;}reference=null;lastResult=null;displayResult=null;adjustmentActive=false;renderMain(container,null);renderOrganic(container,null,currentManualFromFields());renderSummary(container,null,currentManualFromFields());updateRange(container);renderWarnings(container,null);const ab=container.querySelector('[data-cfv56-adjust]');if(ab){ab.disabled=true;ab.classList.remove('is-active');ab.textContent='혼소 조정';}
      try{const pending=selectStores();setStatus(container,'기간이 변경되었습니다. 저장된 결과만 확인합니다. 새 DataPARC 조회는 [계산하기]를 눌렀을 때 시작합니다.','');scheduleFastPrep(0);await pending;}catch(e){setStatus(container,e.message,'error');}
    }
    for(const el of container.querySelectorAll('[data-cfv5-start],[data-cfv5-end],[data-cfv5-step-value],[data-cfv5-step-unit]'))el.addEventListener('change',periodChanged);
    for(const el of container.querySelectorAll('[data-cfv5-calorific],[data-cfv5-coefficient]'))el.addEventListener('input',()=>{settingsDirty=true;paintSettings();if(reference&&storesReady())calculate();});
    container.querySelector('[data-cfv5-settings-save]').addEventListener('click',async()=>{try{const values=readSettings(container);const ok=await settings.save(values);if(ok){settingsDirty=false;paintSettings(true);if(reference)calculate();}}catch(e){setStatus(container,e.message,'error');}});
    container.querySelector('[data-cfv5-manual-save]').addEventListener('click',async()=>{try{const values=readManual(container),ok=await manual.save(values);if(ok){manualDirty=false;paintManual(true);if(reference)calculate();}}catch(e){setStatus(container,e.message,'error');}});
    container.querySelector('[data-cfv5-query]').addEventListener('click',async()=>{try{
      const spec=currentSpec();live.select(spec);const cached=cachedReference(live.state(),spec);
      if(cached&&selectedStoreKey===storeKey()&&storesReady()){
        reference=cached;const result=calculate();
        if(result)setStatus(container,'저장된 DataPARC 결과와 현재 입력값으로 즉시 재계산했습니다. 최신 데이터 조회는 [재조회]를 사용하세요.','success');
        return;
      }
      setStatus(container,'저장된 기간 결과를 먼저 확인하고 있습니다.','working');
      if(!await selectStores())return;const s=currentSpec();live.select(s);
      const loaded=await live.load({force:true});let liveState=live.state();
      if(liveState.item?.saved&&reference&&!liveState.item?.active){calculate();return;}
      if(liveState.item?.active){setStatus(container,'같은 기간의 DataPARC 요청 상태를 다시 확인했습니다. Agent 대기/작업 중이면 완료 후 자동 계산합니다.','working');return;}
      if(!loaded&&liveState.item?.error){setStatus(container,liveState.item.error,'error');return;}
      setStatus(container,'저장된 결과가 없어 현재 표시 기간으로 DataPARC 조회를 시작합니다. 완료되면 자동 계산합니다.','working');
      const ok=await queryWithBusyRetry({force:false});liveState=live.state();
      if(!ok&&!liveState.item?.active&&!liveState.item?.saved&&!/같은 시작일의 다른 혼소율 기간 조회/.test(String(liveState.item?.error||'')))setStatus(container,liveState.item?.error||'기간 조회 요청을 시작하지 못했습니다. 로그인 상태와 조회 기간을 확인해 주세요.','error');
    }catch(e){setStatus(container,e.message,'error');}});
    container.querySelector('[data-cfv5-requery]').addEventListener('click',async()=>{try{if(!root.confirm||root.confirm('현재 저장 결과를 보존한 채 같은 기간을 다시 조회하시겠습니까?')){setStatus(container,'같은 기간을 다시 조회하도록 요청하고 있습니다.','working');if(!await selectStores())return;live.select(currentSpec());const ok=await queryWithBusyRetry({force:true});const liveState=live.state();if(!ok&&!liveState.item?.active)setStatus(container,liveState.item?.error||'재조회 요청을 시작하지 못했습니다.','error');}}catch(e){setStatus(container,e.message,'error');}});
    adjuster=adjustmentApi?.create({container,getHeaders:authHeaders,getContext:adjustmentContext,onMessage:m=>setStatus(container,m,'error'),onApply:(result)=>{renderDisplay(result,{adjusted:true});setStatus(container,'혼소 조정값을 선택기간 계산 화면에 적용했습니다. 원본 DataPARC 저장값은 변경하지 않습니다.','success');},onReset:()=>{if(lastResult){renderDisplay(lastResult,{adjusted:false});setStatus(container,'혼소 조정을 원복했습니다. DataPARC 원본 계산값을 표시합니다.','success');}}})||null;
    const adjustButton=container.querySelector('[data-cfv56-adjust]');if(adjustButton){adjustButton.disabled=true;adjustButton.addEventListener('click',()=>{try{Promise.resolve(adjuster?.open()).catch(e=>setStatus(container,e.message,'error'));}catch(e){setStatus(container,e.message,'error');}});}
    const observer=root.MutationObserver?new root.MutationObserver(()=>{if(visible()){scheduleFastPrep(0);}else{fastPrepGeneration++;if(fastPrepTimer){root.clearTimeout?.(fastPrepTimer);fastPrepTimer=null;}live?.pause();}}):null;const view=container.closest?.('[data-efficiency-view]'),modal=root.document?.getElementById?.('efficiencyTeamModal');for(const node of [view,modal])if(node&&observer)observer.observe(node,{attributes:true,attributeFilter:['hidden','aria-hidden']});
    updateRange(container);writeSettings(container,settings?.defaults?.()||{unit1:{coal:{calorific:5868,coefficient:1},bio:{calorific:3237,coefficient:1},organic:{calorific:3487,coefficient:1},manure:{calorific:3487,coefficient:1}},unit2:{coal:{calorific:5868,coefficient:1},bio:{calorific:3237,coefficient:1},organic:{calorific:3487,coefficient:1},manure:{calorific:3487,coefficient:1}}});const initialManual=manualApi?.blank?.()||{unit1:{organic:null,manure:null},unit2:{organic:null,manure:null}};renderMain(container,null);renderOrganic(container,null,initialManual);renderSummary(container,null,initialManual);bindManualInputs();selectStores().catch(e=>setStatus(container,e.message,'error'));scheduleFastPrep(0);
    return {calculate,periodChanged,settings,manual,live,getResult:()=>lastResult,getDisplayResult:()=>displayResult,getSpec:currentSpec,dispose(){disposed=true;fastPrepGeneration++;if(fastPrepTimer)root.clearTimeout?.(fastPrepTimer);observer?.disconnect();adjuster?.dispose?.();settings?.dispose();manual?.dispose();live?.dispose();}};
  }
  root.CofiringPeriodV5={mount,periodSpec,markup,readSettings,readManual,manualForCalculation,coalBioHeat,coalBioRatio,combinedCoalBio,cachedReference,liveRequestPresentation};if(typeof module==='object'&&module.exports)module.exports=root.CofiringPeriodV5;
  if(root.document){const init=()=>{const container=root.document.querySelector('[data-cofiring-draft-root]');if(container)mount(container);};if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();}
})(typeof globalThis==='object'?globalThis:this);
