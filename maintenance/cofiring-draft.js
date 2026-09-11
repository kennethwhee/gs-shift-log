(function (root) {
  'use strict';
  const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const isNumber = value => typeof value === 'number' && Number.isFinite(value);
  const number = (value, places = 3) => isNumber(value) ? value.toLocaleString('ko-KR', { minimumFractionDigits: places, maximumFractionDigits: places }) : '—';
  const localTime = value => { const timestamp=Date.parse(value); return Number.isFinite(timestamp)?new Date(timestamp+9*60*60*1000).toISOString().slice(0,16):''; };
  const asKst = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+09:00` : '';
  function numericInput(value, label) {
    if (String(value).trim() === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label}은 0 이상의 숫자로 입력해 주세요.`);
    return parsed;
  }
  // V7 completed-with-gaps reports are DISPLAYABLE, never promoted to validated data.
  // Recompute identities, rows, qualities, returned times and gaps rather than trusting status alone.
  function validateGapReport(report, data, day, core) {
    const fail = message => { throw new Error('누락 포함 하루 결과를 열 수 없습니다: ' + message); };
    if (report.schemaVersion !== 2 || report.pilotVersion !== 7 || report.dataValidated !== false ||
        report.executionSucceeded !== true || report.resultReceived !== true || report.timedOut !== false ||
        report.workerExitCode !== 0 || report.completedTagCount !== 10 || report.cleanupVerified !== true ||
        report.processCleanupVerified !== true || report.safeToStartNextDay !== true ||
        report.databaseWritten !== false || report.productionReady !== false ||
        !Array.isArray(report.cleanupErrors) || report.cleanupErrors.length !== 0) fail('V7 전체 수신·조회용 프로세스 종료 확인이 필요합니다.');
    if (typeof report.runId !== 'string' || !report.runId || data.source.kind !== 'dataparc_hidden_excel' ||
        data.source.qualityRecorded !== true || data.source.runId !== report.runId ||
        report.mode !== 'daily' || report.timeZone !== 'Asia/Seoul' || report.durationMinutes !== 1440 ||
        report.queryDurationMinutes !== 1441 || report.boundaryCount !== 1441 ||
        report.start !== localTime(day.start).replace('T',' ') || report.end !== localTime(day.end).replace('T',' ') ||
        data.aggregation !== 'Start' || data.boundaryCount !== 1441 || data.mode !== 'daily') fail('실행 ID 또는 하루 조회 계약이 다릅니다.');
    const definitions = core.requiredSeries;
    if (data.series.length !== definitions.length || !Array.isArray(report.tagSummary) || report.tagSummary.length !== definitions.length) fail('10개 TAG 전체가 필요합니다.');
    const entries = new Map(data.series.map(series => [series.id, series]));
    const summaries = new Map(report.tagSummary.map(item => [item.key, item]));
    if (entries.size !== 10 || summaries.size !== 10) fail('중복 TAG가 있습니다.');
    let goodRows = 0, gaps = 0;
    const gapTags = [];
    for (const definition of definitions) {
      const series = entries.get(definition.id), summary = summaries.get(definition.id);
      if (!series || !summary || series.tag !== definition.tag || series.queryTag !== definition.queryTag ||
          series.unit !== definition.unit || series.fuel !== definition.fuel || series.unitOfMeasure !== 'ton' ||
          summary.tag !== definition.queryTag) fail('TAG 식별 정보가 일치하지 않습니다.');
      if (!['values','qualities','returnedTimes'].every(key => Array.isArray(series[key]) && series[key].length === 1441)) fail('분별 값·품질·시각 배열 크기가 다릅니다.');
      let previous = null;
      const missingTimes = [];
      for (let i = 0; i < 1441; i += 1) {
        const value = series.values[i], quality = series.qualities[i], time = series.returnedTimes[i];
        const at = typeof time === 'string' && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(time) ? Date.parse(time) : NaN;
        if (!Number.isFinite(at) || at < day.startMs + i*60000 || at >= day.startMs + (i+1)*60000) fail('반환 시각이 해당 분과 다릅니다.');
        if (value === null) {
          const parts = typeof quality === 'string' ? quality.toLowerCase().split(',').map(part => part.trim()).sort() : [];
          if (JSON.stringify(parts) !== JSON.stringify(['bad','no data'])) fail('명시적인 No Data, Bad 이외의 누락/오류가 있습니다.');
          if (i === 0 || i === 1440) fail('하루 시작·끝 누적 경계값이 누락됐습니다.');
          missingTimes.push(data.timestamps[i]); gaps += 1;
        } else {
          if (!isNumber(value) || value < 0 || !core.qualityGood(quality)) fail('비정상 누적값 또는 품질이 있습니다.');
          if (previous !== null && value < previous) fail('누적값 감소/초기화가 있습니다.');
          previous = value; goodRows += 1;
        }
      }
      if (summary.expectedRows !== 1441 || summary.receivedRows !== 1441 || summary.validRows !== 1441-missingTimes.length ||
          summary.noDataRows !== missingTimes.length || summary.minuteDataComplete !== (missingTimes.length === 0) ||
          !Array.isArray(summary.missingTimes) || summary.missingTimes.length !== missingTimes.length ||
          summary.missingTimes.some((time,i) => time !== missingTimes[i])) fail('TAG별 집계와 실제 배열이 다릅니다.');
      if (missingTimes.length) gapTags.push({id: definition.id, count: missingTimes.length, times: missingTimes});
    }
    const response = report.response, compared = report.referenceComparison;
    if (gaps <= 0 || report.noDataRows !== gaps || !response || response.rows !== 14410 || response.shapeValid !== true ||
        response.readState !== 'READ_OK' || response.complete !== true || response.returnedRows !== 14410 ||
        response.valueRows !== goodRows || response.noDataRows !== gaps ||
        !['errorRows','pendingRows','metadataPendingRows','otherPendingRows'].every(key => response[key] === 0)) fail('전체 응답 집계가 실제 배열과 다릅니다.');
    if (!compared || compared.expectedSamples !== 14410 || compared.mismatchSamples !== 0 ||
        !Number.isInteger(compared.comparedSamples) || compared.comparedSamples < 0 || compared.comparedSamples > goodRows ||
        compared.matched !== false) fail('원본 대조 집계가 유효하지 않습니다.');
    return {missingSamples:gaps, validSamples:goodRows, expectedSamples:14410, comparedSamples:compared.comparedSamples, gapTags};
  }
  function parseImportedReport(report) {
    const isPilot = report?.kind === 'cofiring_dataparc_pilot';
    const unverified = isPilot && report.schemaVersion === 2 && report.status === 'REFERENCE_UNVERIFIED';
    const hasDataGaps = isPilot && report.status === 'DATA_GAPS';
    if (isPilot && ((!unverified && !hasDataGaps && report.status !== 'PASS') || report.cleanupVerified !== true || report.databaseWritten !== false || report.productionReady !== false)) {
      throw new Error('조회와 시험용 Excel 정리가 확인된 읽기 전용 결과만 열 수 있습니다.');
    }
    if (unverified && (report.dataValidated !== true || report.referenceComparison?.mismatchSamples !== 0 ||
        report.referenceComparison?.expectedSamples !== 14410 || !Number.isInteger(report.referenceComparison?.comparedSamples) ||
        report.referenceComparison.comparedSamples < 0 || report.referenceComparison.comparedSamples >= 14410)) {
      throw new Error('원본 대조 미완료 자료는 하루 값·품질·시각 검증과 불일치 0건이 확인되어야 합니다.');
    }
    if (report?.status && !unverified && !hasDataGaps && !['PASS','OK','SUCCESS'].includes(String(report.status).toUpperCase())) throw new Error('실패한 시험 결과는 계산 자료로 사용할 수 없습니다.');
    if (report?.reference && !isPilot) throw new Error('지원하는 혼소율 읽기 전용 시험 결과가 아닙니다.');
    const data = isPilot ? report.reference : report;
    if (!data || !Array.isArray(data.timestamps) || !Array.isArray(data.series) || !data.source) throw new Error('1분 누적값이 포함된 혼소율 시험 결과 JSON을 선택해 주세요.');
    if (data.source.kind === 'dataparc_hidden_excel' && !isPilot) throw new Error('DataPARC 자료는 Excel 종료 결과가 포함된 pilot-report.json으로 열어 주세요.');
    const core = root.CofiringCore || (typeof require === 'function' ? require('./cofiring-core.js') : null);
    if (!core) throw new Error('혼소율 계산 모듈을 불러오지 못했습니다.');
    const day = core.validateDailySource(data);
    if (isPilot && report.schemaVersion === 2 && (report.targetDate !== day.targetDate ||
        report.queryStart !== localTime(day.queryStart).replace('T',' ') ||
        report.queryEnd !== localTime(day.queryEnd).replace('T',' '))) throw new Error('시험 보고서의 날짜 또는 조회 범위가 일별 자료와 다릅니다.');
    if (unverified) {
      const checked = core.analyzeDay(data, {targetDate: day.targetDate, requireQuality: true});
      if (!checked.qualityVerified || !['unit1','unit2'].every(unit => checked.units[unit].coal.complete && checked.units[unit].bio.complete)) throw new Error('미검증 참고 자료에 누락·비정상 값이 있습니다.');
      for (const series of data.series) {
        if (!Array.isArray(series.returnedTimes) || series.returnedTimes.length !== day.boundaryCount ||
            series.returnedTimes.some((time, i) => { const at=Date.parse(time); return !Number.isFinite(at) || at < day.startMs+i*60000 || at >= day.startMs+(i+1)*60000; })) throw new Error('반환 시각이 하루 분 경계와 일치하지 않습니다.');
      }
    }
    const gapSummary = hasDataGaps ? validateGapReport(report, data, day, core) : null;
    return { reference: data, pilotVerified: isPilot, referenceVerified: isPilot && !unverified && !hasDataGaps, hasDataGaps, gapSummary, day };
  }
  function analyzeReference(core, data, options) {
    return core.analyzeDay(data, options);
  }
  const FUEL_LABELS = Object.freeze({coal:'Coal',bio:'Bio-SRF',organic:'유기성 고형연료',manure:'축분'});
  const FUEL_KEYS = Object.freeze(['coal','bio','organic','manure']);
  const DEFAULT_SETTING_VALUES = Object.freeze({coal:[5868,1],bio:[3237,1],organic:[3487,1],manure:[3487,1]});
  function settingsRowsMarkup() {
    return FUEL_KEYS.map(fuel => `<tr><th scope="row">${FUEL_LABELS[fuel]}</th>${['unit1','unit2'].map((unit,index) => {
      const values=DEFAULT_SETTING_VALUES[fuel];
      return `<td><div class="cf-setting-cell"><input aria-label="${index+1}호기 ${FUEL_LABELS[fuel]} 발열량" data-cf-calorific="${unit}:${fuel}" type="number" min="1" max="50000" step="any" value="${values[0]}"><span>kcal/kg</span></div></td><td><input class="cf-coefficient-input" aria-label="${index+1}호기 ${FUEL_LABELS[fuel]} 보정계수" data-cf-coefficient="${unit}:${fuel}" type="number" min="0.000001" max="100" step="any" value="${values[1]}"></td>`;
    }).join('')}</tr>`).join('');
  }
  function inputMarkup() {
    return `<header class="cofiring-draft__header"><div><span class="cf-eyebrow">CO-FIRING</span><h2>혼소율 (개발중)</h2><p class="cf-muted">날짜별 Coal·Bio-SRF·유기성 고형연료·축분 사용량을 발열량 기준으로 환산합니다.</p></div><span class="cf-draft-tag">개발중 · 웹 조회 연결</span></header>
      <p class="cf-notice" data-cf-development>개발중입니다. [DataPARC 조회]를 누를 때만 회사 PC의 숨김 Excel에서 선택일 00:00~다음 날 00:01의 Coal·Bio-SRF 하루 자료를 읽습니다. 유기성 고형연료와 축분은 날짜·호기별 수기 저장값을 사용합니다. 날짜 선택만으로는 조회하지 않습니다.</p>
      <div class="cf-panel"><div class="cf-period"><label class="cf-field">계산일<input data-cf-date type="date" value="2026-09-07" aria-describedby="cofiringDailyQueryRange"></label><span class="cf-day-badge">1일 단위</span><button type="button" data-cf-original>원본 하루 조건 보기</button></div><div class="cf-query-window"><span>DataPARC 시험 조회 범위</span><strong id="cofiringDailyQueryRange" data-cf-query-range></strong></div><p class="cf-period-meta" data-cf-period></p>
      <div class="cf-live-panel" data-cf-live-panel hidden><div class="cf-live-actions"><button type="button" class="cf-primary" data-cf-live-query>DataPARC 조회</button><button type="button" data-cf-live-requery>재조회</button><button type="button" data-cf-live-load>저장 결과 불러오기</button><span data-cf-live-saved></span></div><p data-cf-live-status role="status" aria-live="polite"></p></div>
      <div class="cf-actions"><button type="button" class="cf-primary" data-cf-calculate>첨부자료로 계산</button><button type="button" data-cf-import>시험 결과 열기</button><input data-cf-file type="file" accept="application/json,.json" hidden></div></div>
      <p class="cf-notice" data-cf-status role="status" aria-live="polite">첨부 엑셀의 2026-09-07 자료로 계산하는 초안입니다. 실제 DataPARC 조회는 아직 연결하지 않았습니다.</p>
      <div class="cf-source"><span class="cf-source-name" data-cf-source>원본 1분 누적값 · Coal 8개 / Bio-SRF 2개 계측값</span><span class="cf-source-status" data-cf-quality>계산 전</span></div>
      <section class="cf-panel cf-calculation-settings"><div class="cf-settings-heading"><div><span class="cf-settings-kicker">CALCULATION BASIS</span><h3>발열량 · 보정계수 설정</h3><p>계산일에 적용할 값을 1·2호기별로 설정합니다. 실사용량 = 사용량 × 보정계수입니다.</p></div><div class="cf-settings-actions"><button type="button" class="cf-primary" data-cf-settings-save>이 날짜부터 적용 저장</button><span data-cf-settings-status>기본값</span></div></div>
        <div class="cf-table-scroll"><table class="cf-settings cf-settings--matrix"><thead><tr><th rowspan="2">연료</th><th colspan="2">1호기</th><th colspan="2">2호기</th></tr><tr><th>발열량 (kcal/kg)</th><th>보정계수</th><th>발열량 (kcal/kg)</th><th>보정계수</th></tr></thead><tbody>${settingsRowsMarkup()}</tbody></table></div>
        <p class="cf-formula">투입열량(Gcal/d) = 실사용량(t/d) × 발열량(kcal/kg) ÷ 1,000. Bio 혼소율은 Bio-SRF 열량, 유기성 혼소율은 유기성 고형연료+축분 열량을 각각 전체 투입열량으로 나눠 계산합니다. 종합 혼소율은 Bio-SRF+유기성 고형연료+축분 열량의 합을 전체 투입열량으로 나눕니다.</p>
      </section>
      <div class="cf-units" data-cf-results></div>
      <section class="cf-panel cf-inputs"><p class="cf-input-help" data-cf-organic-help>유기성 고형연료와 축분은 호기별 카드에서 직접 입력·저장합니다. 빈칸은 미입력, 0 ton은 사용 없음입니다. Coal·Bio-SRF는 DataPARC 조회값을 사용합니다.</p></section>
      <details class="cf-panel cf-details" data-cf-check-panel hidden><summary>자료 확인 내용</summary><ul class="cf-checks" data-cf-checks></ul></details>
      <p class="cf-footer">Coal·Bio-SRF 하루 누적 조회 결과와 유기성 고형연료·축분 수기값을 결합해 계산합니다. 발열량·보정계수는 계산일 기준 설정을 사용하며 오전회의 자료와 자동 연동하지 않습니다.</p>`;
  }
  function fuelRowMarkup(data,key,options) {
    const fuel=data[key]||{};
    const measured=isNumber(fuel.measuredQuantity)?fuel.measuredQuantity:isNumber(fuel.enteredQuantity)?fuel.enteredQuantity:null;
    const actual=isNumber(fuel.quantity)?fuel.quantity:null;
    const factor=isNumber(fuel.coefficient)?fuel.coefficient:null;
    const calorific=isNumber(data.calorifics?.[key])?data.calorifics[key]:null;
    const heat=isNumber(data.heats?.[key])?data.heats[key]:null;
    const referenceLabel=options?.live?'조회값 참고 (미확정)':'원본 참고';
    const reference=!isNumber(actual)&&isNumber(fuel.referenceQuantity)?`<span class="cf-table-reference">${referenceLabel} ${number(fuel.referenceQuantity)} ton${fuel.missingSamples>0?` · ${fuel.missingSamples}개 시각 누락`:''}</span>`:'';
    return `<tr data-cf-fuel-row="${key}"><th scope="row">${FUEL_LABELS[key]}</th><td>${number(measured)}${reference}</td><td>${number(factor,4)}</td><td class="cf-actual-cell"><strong>${number(actual)}</strong></td><td>${number(calorific,0)}</td><td>${number(heat,2)}</td></tr>`;
  }
  function combinedMarkup(result) {
    const combined=result?.combined||{};
    const ratio=key=>isNumber(combined.ratios?.[key])?`${number(combined.ratios[key],2)}%`:'—';
    return `<section class="cf-combined-summary" data-cf-combined><div class="cf-combined-main"><span>종합 혼소율</span><strong>${ratio('total')}</strong><small>1·2호기 열량 합산</small></div><div class="cf-combined-metrics"><div><span>Bio 혼소율</span><strong>${ratio('bio')}</strong></div><div><span>유기성 혼소율</span><strong>${ratio('organic')}</strong><small>유기성+축분</small></div><div><span>총 투입열량</span><strong>${number(combined.heats?.total,1)}</strong><small>Gcal/d</small></div></div></section>`;
  }
  function unitMarkup(unit, index, durationHours, options) {
    const data=unit||{};
    const valid=FUEL_KEYS.every(key=>isNumber(data[key]?.quantity));
    const ratio=key=>isNumber(data.ratios?.[key])?`${number(data.ratios[key],2)}%`:'—';
    const manual=options?.manual?`<div class="cf-manual-grid"><div data-cf-organic-slot="unit${index}"></div><div data-cf-manure-slot="unit${index}"></div></div>`:'';
    return `<article class="cf-unit"><header class="cf-unit__header"><div><span class="cf-unit-kicker">UNIT ${index}</span><h3>${index}호기</h3></div><span class="cf-unit__badge">${valid?'계산 완료':unit?'일부 자료 확인 필요':'계산 대기'}</span></header><div class="cf-unit__body">${manual}<div class="cf-table-scroll"><table class="cf-fuel-table"><thead><tr><th>연료</th><th>사용량<br><small>t/d</small></th><th>보정계수</th><th>실사용량<br><small>t/d</small></th><th>발열량<br><small>kcal/kg</small></th><th>투입열량<br><small>Gcal/d</small></th></tr></thead><tbody>${FUEL_KEYS.map(key=>fuelRowMarkup(data,key,options)).join('')}</tbody></table></div><div class="cf-ratios"><div class="cf-ratio"><span>Bio 혼소율</span><strong>${ratio('bio')}</strong></div><div class="cf-ratio"><span>유기성 혼소율</span><strong>${ratio('organic')}</strong><small>유기성+축분</small></div><div class="cf-ratio cf-ratio--total"><span>${index}호기 총 혼소율</span><strong>${ratio('total')}</strong></div></div></div></article>`;
  }
  // Manual input panels are stable DOM nodes. Re-rendering result tables moves
  // them without replacing drafts, handlers or per-unit save state.
  function manualPanelMarkup(kind,unit,index) {
    const isManure=kind==='manure',label=isManure?'축분':'유기성 고형연료',prefix=isManure?'manure':'organic';
    return `<div class="cf-organic-title"><label for="cf-${prefix}-${unit}" class="cf-fuel-name">${label} 사용량</label><span class="cf-manual-tag">직접 입력</span></div>
      <div class="cf-organic-controls"><input id="cf-${prefix}-${unit}" type="text" data-cf-${prefix}="${unit}" inputmode="decimal" maxlength="32" placeholder="미입력" aria-label="${index}호기 ${label} 하루 사용량(ton)" aria-describedby="cf-${prefix}-message-${unit}"><span>ton</span><button type="button" class="cf-primary" data-cf-${prefix}-save="${unit}">저장</button><button type="button" data-cf-${prefix}-edit="${unit}" hidden>수정</button><button type="button" data-cf-${prefix}-cancel="${unit}" hidden>취소</button></div>
      <p class="cf-organic-meta" data-cf-${prefix}-meta="${unit}"></p><p class="cf-organic-message" id="cf-${prefix}-message-${unit}" data-cf-${prefix}-message="${unit}" role="status" aria-live="polite"></p>
      <div class="cf-organic-secondary"><button type="button" data-cf-${prefix}-reload="${unit}" hidden>다시 불러오기</button><button type="button" data-cf-${prefix}-latest="${unit}" hidden>최신값 확인</button><button type="button" data-cf-${prefix}-clear="${unit}" hidden>미입력으로 지우기</button></div>`;
  }
  function organicPanelMarkup(unit,index) { return manualPanelMarkup('organic',unit,index); }
  function mount(container, options) {
    if (!container || container.dataset.cofiringMounted === 'true') return null;
    const config=options||{},core=root.CofiringCore;
    const organicStorage=root.CofiringOrganicStorage;
    const manureStorage=root.CofiringManureStorage;
    const settingsStorage=root.CofiringCalculationSettingsStorage;
    if(!core||!organicStorage||!manureStorage){container.textContent='혼소율 모듈을 불러오지 못했습니다. 배포 완료 후 Ctrl+F5로 새로고침해 주세요.';return null;}
    container.dataset.cofiringMounted='true';container.classList.add('cofiring-draft');container.innerHTML=inputMarkup();
    const find=selector=>container.querySelector(selector),date=find('[data-cf-date]');
    let reference=config.reference||root.COFIRING_DRAFT_REFERENCE||null,referencePromise=null;
    let sourceLabel='첨부 엑셀',sourceFilename='',pilotVerified=false,referenceVerified=false,gapSummary=null;
    let busy=false,calculated=false,lastResult=null,loadToken=0,savedSignature='',disposed=false;
    let live=null,sourceLive=false,sourceMode='live',displayedLiveId='';
    let settingsDirty=false,settingsAppliedKey='';
    const panels={organic:{},manure:{}};
    function authHeaders(){return typeof root.getShiftLogAuthHeaders==='function'?root.getShiftLogAuthHeaders():{};}
    function isMobile(){
      try{return /^\/mobile(?:\/|$)/i.test(root.location?.pathname||'') || /Android|iPhone|iPad|iPod|Mobile/i.test(root.navigator?.userAgent||'') ||
        (root.navigator?.platform==='MacIntel'&&Number(root.navigator?.maxTouchPoints)>0) ||
        (typeof root.isShiftLogMobileView==='function'?root.isShiftLogMobileView():!!root.matchMedia?.('(max-width: 768px)').matches);}
      catch(_){return true;}
    }
    const organic=organicStorage.create({getHeaders:authHeaders,canEdit:()=>!isMobile(),onChange:onManualChange});
    const manure=manureStorage.create({getHeaders:authHeaders,canEdit:()=>!isMobile(),onChange:onManualChange});
    const settings=settingsStorage?.create({getHeaders:authHeaders,canEdit:()=>!isMobile(),onChange:onSettingsChange})||null;
    function status(message,tone){const e=find('[data-cf-status]');e.textContent=message;e.dataset.tone=tone||'';}
    function period(){return core.dailyRange(date.value);}
    function updatePeriod(){
      try{const v=period();find('[data-cf-query-range]').textContent=`${localTime(v.queryStart).replace('T',' ')} ~ ${localTime(v.queryEnd).replace('T',' ')}`;find('[data-cf-period]').textContent='하루 24시간 계산 · 1분 간격 1,441개 경계 · DataPARC 조회 종료는 다음 날 00:01 (마지막 00:00 경계 확인용)';}
      catch(e){find('[data-cf-query-range]').textContent='—';find('[data-cf-period]').textContent=e.message;}
    }
    function bindManualPanels(kind,store,label){
      for(const [index,unit] of ['unit1','unit2'].entries()){
        const panel=root.document.createElement('div');panel.className=`cf-organic-editor cf-manual-editor cf-manual-editor--${kind}`;panel.innerHTML=manualPanelMarkup(kind,unit,index+1);panels[kind][unit]=panel;
        const get=key=>panel.querySelector(`[data-cf-${kind}${key?'-'+key:''}="${unit}"]`);
        get('').addEventListener('input',()=>store.setDraft(unit,get('').value));
        get('save').addEventListener('click',()=>store.save(unit));
        get('').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();store.save(unit);}});
        get('edit').addEventListener('click',()=>{if(store.edit(unit))get('').focus?.();});
        get('cancel').addEventListener('click',()=>store.cancel(unit));
        get('reload').addEventListener('click',()=>store.load({force:true}));
        get('latest').addEventListener('click',()=>{
          const u=store.state().day?.units[unit];if(!u?.hasConflict)return;
          const value=u.conflict?.tons==null?'미입력':`${number(u.conflict.tons)} ton`;
          if(root.confirm?.(`${date.value} ${index+1}호기 ${label} 최신 저장값은 ${value}입니다. 현재 미저장 입력을 버리고 최신값을 확인하시겠습니까?`))store.useLatest(unit);
        });
        get('clear').addEventListener('click',()=>{
          if(root.confirm?.(`${date.value} ${index+1}호기의 ${label} 저장값을 미입력으로 지울까요? 0 ton으로 바꾸는 것이 아니며 이전 저장 이력은 보존됩니다.`))store.save(unit,{clear:true});
        });
      }
    }
    bindManualPanels('organic',organic,'유기성 고형연료');
    bindManualPanels('manure',manure,'축분');
    function syncManualPanels(kind,store){
      const s=store.state(),d=s.day;
      for(const unit of ['unit1','unit2']){
        const panel=panels[kind][unit],u=d?.units[unit];if(!panel)continue;
        const get=key=>panel.querySelector(`[data-cf-${kind}${key?'-'+key:''}="${unit}"]`);
        const field=get(''),editable=!!(s.canEdit&&d?.loaded&&!d.loading&&u&&!u.saving&&!u.hasConflict);
        const wanted=u?.draft||'';if(field.value!==wanted)field.value=wanted;
        field.disabled=!editable||!u?.editing;field.setAttribute?.('aria-invalid',u?.error?'true':'false');
        get('save').hidden=!s.canEdit||!!(d?.loaded&&!u?.editing);get('save').disabled=!editable;get('save').textContent=u?.saving?'저장 중…':'저장';
        get('edit').hidden=!s.canEdit||!d?.loaded||!!u?.editing;get('edit').disabled=!editable;
        get('cancel').hidden=!s.canEdit||!u?.editing||(!u?.record&&!u?.dirty);get('cancel').disabled=!!u?.saving;
        get('clear').hidden=!s.canEdit||!u?.editing||u?.record?.tons==null;get('clear').disabled=!editable;
        get('reload').hidden=!s.authenticated||!d?.error;get('reload').disabled=!!d?.loading||!!u?.saving;
        get('latest').hidden=!u?.hasConflict;get('latest').disabled=!!u?.saving;
        const r=u?.record;
        get('meta').textContent=r?`${r.tons===null?'미입력으로 변경':'서버 저장 '+number(r.tons)+' ton'} · ${r.updatedByName||r.updatedById} · ${localTime(r.updatedAt).replace('T',' ')} (KST)`:'서버 저장값 없음';
        let message=!s.targetDate?'계산일을 선택해 주세요.':!s.authenticated?'로그인 후 저장값을 확인할 수 있습니다.':
          d?.loading?'저장값을 불러오는 중입니다.':d?.error?d.error:!d?.loaded?'저장값 확인 대기':u?.saving?'서버에 저장 중입니다.':
          u?.error?u.error:!s.canEdit?'모바일 조회 전용 · 입력·수정은 PC에서 해 주세요.':u?.dirty?'미저장 입력 · 계산에는 서버 저장값만 사용합니다.':
          r?.tons===0?'0 ton 저장됨 · 사용 없음':r?.tons!=null?'저장 완료 · 날짜별·호기별 보관':'해당일 사용량 입력 · 사용하지 않은 날은 0';
        get('message').textContent=message;get('message').dataset.tone=(u?.error||d?.error)?'error':r?.tons!=null&&!u?.dirty?'success':'';
      }
    }
    function syncAllManualPanels(){syncManualPanels('organic',organic);syncManualPanels('manure',manure);}
    function readSettingsFields(){
      const values={unit1:{},unit2:{}};
      for(const unit of ['unit1','unit2'])for(const fuel of FUEL_KEYS)values[unit][fuel]={calorific:null,coefficient:null};
      for(const field of container.querySelectorAll('[data-cf-calorific]')){
        const [unit,fuel]=field.dataset.cfCalorific.split(':');const value=numericInput(field.value,'발열량');
        if(value===null||value===0)throw new Error('발열량은 0보다 큰 숫자로 입력해 주세요.');values[unit][fuel].calorific=value;
      }
      for(const field of container.querySelectorAll('[data-cf-coefficient]')){
        const [unit,fuel]=field.dataset.cfCoefficient.split(':');const value=numericInput(field.value,'보정계수');
        if(value===null||value===0)throw new Error('보정계수는 0보다 큰 숫자로 입력해 주세요.');values[unit][fuel].coefficient=value;
      }
      return values;
    }
    function applySettingsFields(values){
      if(!values)return;
      for(const field of container.querySelectorAll('[data-cf-calorific]')){const [unit,fuel]=field.dataset.cfCalorific.split(':');const value=values?.[unit]?.[fuel]?.calorific;if(isNumber(value))field.value=String(value);}
      for(const field of container.querySelectorAll('[data-cf-coefficient]')){const [unit,fuel]=field.dataset.cfCoefficient.split(':');const value=values?.[unit]?.[fuel]?.coefficient;if(isNumber(value))field.value=String(value);}
    }
    function syncSettings(){
      const label=find('[data-cf-settings-status]'),button=find('[data-cf-settings-save]');
      if(!settings){if(label)label.textContent='기본값 · 설정 저장 모듈 미연결';if(button)button.disabled=true;return false;}
      const s=settings.state();let applied=false;
      if(s.loaded&&!settingsDirty){const key=JSON.stringify([s.targetDate,s.source,s.effectiveDate,s.settings]);if(key!==settingsAppliedKey){settingsAppliedKey=key;applySettingsFields(s.settings);applied=true;}}
      for(const field of [...container.querySelectorAll('[data-cf-calorific]'),...container.querySelectorAll('[data-cf-coefficient]')])field.disabled=isMobile();
      button.disabled=!s.canEdit||s.loading||s.saving||!date.value;
      button.textContent=s.saving?'저장 중…':'이 날짜부터 적용 저장';
      label.dataset.tone=s.error?'error':s.source==='saved'?'success':'';
      label.textContent=s.loading?'설정 불러오는 중…':s.error?s.error:s.source==='saved'?
        `${s.effectiveDate||date.value}부터 적용 · ${s.updatedByName||s.updatedById||'저장 설정'}${s.updatedAt?' · '+localTime(s.updatedAt).replace('T',' ')+' (KST)':''}`:
        s.authenticated?'기본값 · 저장하면 선택일부터 적용':'기본값 · 로그인 후 저장 가능';
      return applied;
    }
    function recalculateCurrent(){
      if(!calculated||!reference)return;
      try{display(analyzeReference(core,reference,numericOptions()));}catch(e){resetResults();status(e.message,'error');}
    }
    function onSettingsChange(){if(disposed)return;const applied=syncSettings();if(applied)recalculateCurrent();}
    find('[data-cf-settings-save]').addEventListener('click',async()=>{
      if(!settings)return;try{const values=readSettingsFields();const ok=await settings.save(values);if(ok){settingsDirty=false;settingsAppliedKey='';syncSettings();recalculateCurrent();}}catch(e){status(e.message||'설정을 저장하지 못했습니다.','error');}
    });
    function onSettingInput(){settingsDirty=true;++loadToken;if(calculated)resetResults();syncSettings();status('발열량 또는 보정계수가 변경되었습니다. 현재 조회 자료로 다시 계산할 수 있습니다.');}
    for(const field of container.querySelectorAll('[data-cf-calorific]'))field.addEventListener('input',onSettingInput);
    for(const field of container.querySelectorAll('[data-cf-coefficient]'))field.addEventListener('input',onSettingInput);
    function renderCards(result){
      const destination=find('[data-cf-results]');
      destination.innerHTML=combinedMarkup(result)+unitMarkup(result?.units.unit1||null,1,result?.period.durationHours||0,{live:pilotVerified,manual:true})+unitMarkup(result?.units.unit2||null,2,result?.period.durationHours||0,{live:pilotVerified,manual:true});
      for(const unit of ['unit1','unit2']){
        destination.querySelector(`[data-cf-organic-slot="${unit}"]`)?.appendChild(panels.organic[unit]);
        destination.querySelector(`[data-cf-manure-slot="${unit}"]`)?.appendChild(panels.manure[unit]);
      }
      syncAllManualPanels();
    }
    function resetResults(){calculated=false;lastResult=null;renderCards(null);find('[data-cf-quality]').textContent='계산 전';find('[data-cf-check-panel]').hidden=true;}
    function onManualChange(){
      if(disposed)return;syncAllManualPanels();
      const signature=JSON.stringify({date:date.value,organic:organic.values(),manure:manure.values()});
      if(signature===savedSignature)return;savedSignature=signature;recalculateCurrent();
    }
    function invalidatePeriod(skipLive=false){
      ++loadToken;resetResults();updatePeriod();settingsDirty=false;settingsAppliedKey='';
      organic.select(date.value);organic.load();manure.select(date.value);manure.load();
      if(settings){settings.select(date.value);settings.load();}syncSettings();
      sourceLive=false;displayedLiveId='';
      if(live&&skipLive===true){live.select(date.value);live.pause();}
      if(live&&skipLive!==true){sourceMode='live';reference=null;pilotVerified=false;referenceVerified=false;gapSummary=null;live.select(date.value);if(visible())live.load();}
      find('[data-cf-source]').textContent='선택일의 하루 자료로 다시 계산해 주세요.';
      status('계산일이 변경되었습니다. 날짜 선택만으로 DataPARC를 실행하지 않습니다. 유기성 고형연료·축분·발열량·보정계수는 선택일 기준 저장값을 불러옵니다.');
    }
    async function loadReference(){
      if(reference)return reference;
      if(!referencePromise)referencePromise=(async()=>{
        const response=await root.fetch(config.referenceUrl||'/maintenance/cofiring-draft-reference.json?v=20260908-daily-v2',{credentials:'same-origin'});
        if(!response.ok)throw new Error('첨부 기준 자료를 불러오지 못했습니다. 화면을 새로고침한 뒤 다시 계산해 주세요.');return response.json();
      })().catch(e=>{referencePromise=null;throw e;});
      return referencePromise;
    }
    function numericOptions(){
      const current=period(),organicSaved=organic.values(),manualSettings=readSettingsFields();
      const calorifics={unit1:{},unit2:{}},coefficients={unit1:{},unit2:{}};
      for(const unit of ['unit1','unit2'])for(const fuel of FUEL_KEYS){calorifics[unit][fuel]=manualSettings[unit][fuel].calorific;coefficients[unit][fuel]=manualSettings[unit][fuel].coefficient;}
      const values={targetDate:current.targetDate,organic:{start:current.start,end:current.end,...organicSaved},calorifics,coefficients,requireQuality:reference?.source?.kind==='dataparc_hidden_excel'};
      // Backward-compatible tests/reference views without an authenticated manure
      // store still calculate as pre-manure (= 0). In the signed-in app, manure is
      // explicit: blank means not entered and therefore blocks the final ratio.
      if(manure.state().authenticated)values.manure={start:current.start,end:current.end,...manure.values()};
      return values;
    }
    function display(result){
      calculated=true;lastResult=result;renderCards(result);
      const warnings=(result.warnings||[]).map(item=>typeof item==='string'?item:JSON.stringify(item));
      if(pilotVerified&&!referenceVerified&&!gapSummary&&!sourceLive)warnings.unshift('하루 값·품질·시각과 조회용 Excel 종료는 확인했지만 원본 Excel 전체 대조는 미완료입니다. 연료 조회 결과와 혼소율은 운영 저장하지 않습니다.');
      if(gapSummary)warnings.unshift(`10개 TAG 수신과 Excel 종료 확인 · 정상 숫자 ${gapSummary.validSamples.toLocaleString('ko-KR')}개 · 자료 없음 ${gapSummary.missingSamples}개. 누락은 0이나 보간값으로 채우지 않았습니다.`,`원본 대조 ${gapSummary.comparedSamples.toLocaleString('ko-KR')}/${gapSummary.expectedSamples.toLocaleString('ko-KR')}개는 조회 개수가 아닙니다. 누락 연료는 미확정이며 해당 호기 혼소율을 계산하지 않습니다. 유기성 고형연료·축분 수기 저장은 이 판정을 바꾸지 않습니다.`);
      if(sourceLive)warnings.unshift('서버 저장된 하루 조회 자료입니다. 혼소율은 현재 유기성 고형연료·축분 저장값과 화면 발열량·보정계수로 계산하며, 확정 혼소율 기록으로 저장하지 않습니다.');
      const complete=Object.values(result.units).every(unit=>isNumber(unit.ratios?.total));
      find('[data-cf-source]').textContent=`${sourceLabel} · ${sourceFilename||reference.source?.filename||'1분 누적 자료'} · ${localTime(result.period.start).replace('T',' ')} ~ ${localTime(result.period.end).replace('T',' ')}`;
      find('[data-cf-quality]').textContent=gapSummary?`조회 완료 · 누락 ${gapSummary.missingSamples}개 / 원본 대조 ${gapSummary.comparedSamples.toLocaleString('ko-KR')}/${gapSummary.expectedSamples.toLocaleString('ko-KR')}`:result.qualityVerified&&pilotVerified?(referenceVerified?'품질·종료·원본 대조 확인':'값·품질·종료 확인 / 원본 대조 미완료'):'품질 정보 미검증';
      find('[data-cf-check-panel]').hidden=warnings.length===0;find('[data-cf-checks]').innerHTML=warnings.map(value=>`<li>${escapeHtml(value)}</li>`).join('');
      status(sourceLive&&!gapSummary?'서버 저장 결과를 표시했습니다. 혼소율은 저장된 유기성 고형연료·축분과 현재 발열량·보정계수로 계산합니다.':gapSummary?`조회 완료 · ${gapSummary.missingSamples}개 분 표본 누락. 정상 연료는 사용량을, 누락 연료는 조회값 참고(미확정)를 표시했습니다. 누락이 있는 호기의 혼소율은 표시하지 않습니다.`:complete?'저장된 유기성 고형연료·축분 사용량과 발열량·보정계수로 혼소율을 계산했습니다.':'확인 가능한 사용량을 표시했습니다. 누락 자료 또는 수기 저장값이 없는 호기는 혼소율을 표시하지 않습니다.',complete?'success':'');
    }
    async function calculate(){
      if(busy)return;const token=++loadToken;busy=true;find('[data-cf-calculate]').disabled=true;
      try{
        period();if(live&&sourceMode==='live'&&!reference)throw new Error('선택일의 서버 저장 결과가 없습니다. [DataPARC 조회]를 눌러 주세요.');
        await Promise.all([organic.load(),manure.load(),settings?settings.load():Promise.resolve(true)]);if(token!==loadToken)return;
        const data=await loadReference();if(token!==loadToken)return;const values=numericOptions();values.requireQuality=data.source?.kind==='dataparc_hidden_excel';const result=analyzeReference(core,data,values);reference=data;display(result);
      }
      catch(e){if(token===loadToken){resetResults();status(e.message||'자료를 계산하지 못했습니다.','error');}}
      finally{busy=false;find('[data-cf-calculate]').disabled=false;}
    }
    date.addEventListener('change',invalidatePeriod);date.addEventListener('input',invalidatePeriod);
    find('[data-cf-calculate]').addEventListener('click',calculate);
    find('[data-cf-original]').addEventListener('click',async()=>{
      if(busy)return;const token=++loadToken;
      if(live){sourceMode='reference';sourceLive=false;sourceLabel='첨부 엑셀';sourceFilename='';reference=null;pilotVerified=false;referenceVerified=false;gapSummary=null;live.pause();}
      try{const data=await loadReference();if(token!==loadToken)return;const sourceDay=core.validateDailySource(data);reference=data;date.value=sourceDay.targetDate;invalidatePeriod(true);
        // Original manualOrganic (including 59.84) is NEVER used as a default or a save.
        // Calculation assumptions come from the selected-day settings, not the attachment.
        await Promise.all([organic.load(),manure.load(),settings?settings.load():Promise.resolve(true)]);await calculate();
      }catch(e){if(token===loadToken)status(e.message,'error');}
    });
    find('[data-cf-import]').addEventListener('click',()=>find('[data-cf-file]').click());
    find('[data-cf-file]').addEventListener('change',async event=>{
      const file=event.target.files?.[0];if(!file)return;const token=++loadToken;let accepted=false;
      try{
        if(file.size>MAX_IMPORT_BYTES)throw new Error('시험 결과 파일은 20 MB 이하의 JSON 파일을 선택해 주세요.');
        const text=await file.text();if(token!==loadToken)return;const imported=parseImportedReport(JSON.parse(text)),data=imported.reference;
        // Validate first; a bad import must leave current values/drafts untouched.
        core.analyzeDay(data,{targetDate:imported.day.targetDate,organic:{start:data.start,end:data.end,unit1:null,unit2:null},requireQuality:imported.pilotVerified});
        accepted=true;++loadToken;reference=data;pilotVerified=imported.pilotVerified;referenceVerified=imported.referenceVerified;gapSummary=imported.gapSummary;
        sourceMode='import';sourceLive=false;live?.pause();sourceLabel=pilotVerified?'불러온 하루 조회 자료':'불러온 참고 자료';sourceFilename=file.name;date.value=imported.day.targetDate;invalidatePeriod(true);
        await Promise.all([organic.load(),manure.load(),settings?settings.load():Promise.resolve(true)]);
        display(core.analyzeDay(data,numericOptions()));find('[data-cf-calculate]').textContent=pilotVerified?'시험 자료로 계산':'불러온 자료로 계산';
      }catch(e){if(accepted||token===loadToken)status(e.message||'시험 결과 파일을 읽지 못했습니다.','error');}
      finally{event.target.value='';}
    });
    function visible(){return !container.closest?.('[hidden], [aria-hidden="true"]');}
    function activate(){onManualChange();syncSettings();if(visible()){if(live&&sourceMode==='live'){live.select(date.value);live.load({force:true});}return Promise.all([organic.load({force:true}),manure.load({force:true}),settings?settings.load({force:true}):Promise.resolve(true)]);}live?.pause();return Promise.resolve(false);}
    const view=container.closest?.('[data-efficiency-view]'),modal=root.document.getElementById?.('efficiencyTeamModal');
    let observer=null;
    if(root.MutationObserver&&view){observer=new root.MutationObserver(()=>{if(visible())activate();else live?.pause();});for(const node of [view,modal])if(node)observer.observe(node,{attributes:true,attributeFilter:['hidden','aria-hidden']});}
    const focus=()=>{activate();},resize=()=>{onManualChange();syncSettings();},storageChanged=e=>{if(!e.key||e.key==='gsShiftLog.currentUser')activate();};
    root.addEventListener?.('focus',focus);root.addEventListener?.('storage',storageChanged);root.addEventListener?.('resize',resize);
    container.addEventListener('focusin',()=>{onManualChange();syncSettings();});
    if(root.CofiringLive&&root.CofiringLiveContract) {
      const maxDay=new Date(Date.now()+9*3600000-60000-86400000).toISOString().slice(0,10);
      date.value=maxDay;date.max=maxDay;
      find('[data-cf-live-panel]').hidden=false;
      const tag=container.querySelector('.cf-draft-tag');if(tag)tag.textContent='개발중 · 웹 조회 연결';
      find('[data-cf-development]').textContent='개발중입니다. [DataPARC 조회]를 누를 때만 회사 PC의 숨김 Excel에서 Coal·Bio-SRF 하루 자료를 읽습니다. 유기성 고형연료와 축분은 별도 수기 저장값을 사용하며 날짜 선택만으로는 조회하지 않습니다.';
      const foot=container.querySelector('.cf-footer');if(foot)foot.textContent='Coal·Bio-SRF 조회 결과는 날짜별로 서버에 저장하고, 유기성 고형연료·축분 및 발열량·보정계수는 별도 저장값을 사용합니다. 재조회해도 수기값과 계산 설정은 유지됩니다.';
      const rangeLabel=container.querySelector('.cf-query-window > span');if(rangeLabel)rangeLabel.textContent='DataPARC 하루 조회 범위';
      // Keep sample/import tools available, but out of the normal query workflow.
      const actions=container.querySelector('.cf-actions');
      if(actions){const details=root.document.createElement('details');details.className='cf-test-tools';const summary=root.document.createElement('summary');summary.textContent='참고자료·시험 결과';details.appendChild(summary);actions.parentNode.insertBefore(details,actions);details.appendChild(find('[data-cf-original]'));details.appendChild(actions);}
      function paintLive(s) {
        if(!live||disposed)return;
        if(!s.authenticated&&sourceLive){sourceLive=false;reference=null;displayedLiveId='';resetResults();find('[data-cf-source]').textContent='로그인 후 서버 저장 결과를 확인해 주세요.';}
        const d=s.day,active=d?.active,p=active?.progress;
        const disabled=!s.canQuery||!!d?.loading||!!d?.submitting||!!active;
        find('[data-cf-live-query]').disabled=disabled;
        find('[data-cf-live-query]').textContent=active?'조회 진행 중':d?.saved?'저장 결과 보기':'DataPARC 조회';
        find('[data-cf-live-requery]').disabled=disabled||!d?.saved;
        find('[data-cf-live-load]').disabled=!s.authenticated||!!d?.loading||!!d?.submitting;
        find('[data-cf-live-saved]').textContent=d?.saved?'서버 저장 '+localTime(d.saved.completedAt).replace('T',' ')+' (KST)':'선택일 저장 결과 없음';
        for(const key of ['import','original','calculate'])find('[data-cf-'+key+']').disabled=!!active||!!d?.submitting;
        let message=!s.authenticated?'로그인 후 저장 결과를 확인할 수 있습니다.':d?.error?d.error:d?.submitting?'하루 조회 요청을 등록하고 있습니다.':
          active?.status==='pending'?'회사 PC Agent 요청 대기 중입니다. PC와 Agent가 실행 중이어야 합니다.':active?.status==='processing'?
          p?.phase==='cleanup'?'하루 조회 결과 검증과 조회용 Excel 종료를 확인하고 있습니다.':`회사 PC에서 하루 DataPARC 자료를 조회 중입니다. 숨김 Excel 종료 확인 후 서버에 저장합니다.`:
          d?.lastAttempt?.status==='failed'?`최근 조회 실패: ${d.lastAttempt.errorMessage}${d.saved?' 기존 저장 결과는 유지했습니다.':''}`:
          d?.loading?'서버 저장 결과를 확인하고 있습니다.':d?.saved?`서버 저장 완료 · ${d.result?.report?.noDataRows?'누락 '+d.result.report.noDataRows+'개 (미확정 포함)':'분별 자료 정상'} · 다시 열 때 Excel을 실행하지 않습니다.`:
          !s.eligible?'다음 날 00:01이 지난 날짜를 선택해 주세요.':!s.canQuery?'모바일 조회 전용 · 새 조회는 로그인한 PC에서 실행해 주세요.':'[DataPARC 조회]로 선택일 하루를 읽습니다. 조회가 끝나면 결과가 자동으로 표시됩니다.';
        find('[data-cf-live-status]').textContent=message;
      }
      live=root.CofiringLive.create({getHeaders:authHeaders,canQuery:()=>!isMobile(),isVisible:()=>visible()&&sourceMode==='live',onChange:paintLive,
        onResult:async(value,saved)=>{
          if(sourceMode!=='live'||date.value!==value.targetDate||disposed)return;
          if(sourceLive&&displayedLiveId===saved.id)return;
          await Promise.all([organic.load(),manure.load(),settings?settings.load():Promise.resolve(true)]);
          if(sourceMode!=='live'||date.value!==value.targetDate||disposed)return;
          const imported=parseImportedReport(value.report);++loadToken;reference=imported.reference;pilotVerified=true;referenceVerified=imported.referenceVerified;gapSummary=imported.gapSummary;
          sourceLabel='서버 저장 · DataPARC 하루 조회';sourceFilename='조회 완료 '+localTime(saved.completedAt).replace('T',' ')+' (KST)';sourceLive=true;displayedLiveId=saved.id;
          display(core.analyzeDay(reference,numericOptions()));find('[data-cf-calculate]').textContent='현재 자료로 다시 계산';
        }});
      find('[data-cf-live-query]').addEventListener('click',()=>{sourceMode='live';live.select(date.value);return live.query({explicit:true});});
      find('[data-cf-live-load]').addEventListener('click',()=>{sourceMode='live';sourceLive=false;live.select(date.value);return live.load({force:true});});
      find('[data-cf-live-requery]').addEventListener('click',()=>{
        live.select(date.value);if(!live.state().canQuery)return;
        if(root.confirm?.(`${date.value} 하루 DataPARC 자료를 새로 조회할까요? 저장한 유기성 고형연료·축분·계산 설정은 유지합니다. 기존 결과는 새 조회·종료·저장이 확인될 때까지 보존합니다.`)){sourceMode='live';return live.query({explicit:true,force:true});}
      });
      live.select(date.value);if(visible())live.load();
      status('선택일의 저장 결과를 확인합니다. 날짜를 선택하는 것만으로 회사 PC 조회를 시작하지 않습니다.');
    }
    resetResults();updatePeriod();organic.select(date.value);manure.select(date.value);settings?.select(date.value);syncSettings();if(visible()){organic.load();manure.load();settings?.load();}
    return {calculate,resetResults,activate,organic,manure,settings,live,dispose(){disposed=true;++loadToken;observer?.disconnect();organic.dispose();manure.dispose();settings?.dispose();live?.dispose();root.removeEventListener?.('focus',focus);root.removeEventListener?.('storage',storageChanged);root.removeEventListener?.('resize',resize);}};
  }
  root.CofiringDraft={mount,unitMarkup,numericInput,asKst,parseImportedReport,analyzeReference,toKstInput:localTime};
  if(typeof module==='object'&&module.exports) module.exports=root.CofiringDraft;
  if(root.document) {
    const init=()=>{const container=root.document.querySelector('[data-cofiring-draft-root]');if(container)mount(container);};
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  }
})(typeof globalThis==='object'?globalThis:this);
