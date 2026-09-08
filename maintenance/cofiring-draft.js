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
  function inputMarkup() {
    return `<header class="cofiring-draft__header"><div><span class="cf-eyebrow">CO-FIRING</span><h2>혼소율 (개발중)</h2><p class="cf-muted">날짜를 하나 선택해 하루 연료 사용량과 열량 기준 혼소율을 확인합니다.</p></div><span class="cf-draft-tag">개발중 · 자동조회 미연결</span></header>
      <p class="cf-notice" data-cf-development>개발중입니다. 웹 자동조회는 아직 연결되지 않았습니다. 9/7 참고자료 또는 별도로 조회한 시험 결과로만 계산하며, 운영 확정값으로 사용하지 마세요.</p>
      <div class="cf-panel"><div class="cf-period"><label class="cf-field">계산일<input data-cf-date type="date" value="2026-09-07" aria-describedby="cofiringDailyQueryRange"></label><span class="cf-day-badge">1일 단위</span><button type="button" data-cf-original>원본 하루 조건 보기</button></div><div class="cf-query-window"><span>DataPARC 시험 조회 범위</span><strong id="cofiringDailyQueryRange" data-cf-query-range></strong></div><p class="cf-period-meta" data-cf-period></p>
      <div class="cf-actions"><button type="button" class="cf-primary" data-cf-calculate>첨부자료로 계산</button><button type="button" data-cf-import>시험 결과 열기</button><input data-cf-file type="file" accept="application/json,.json" hidden></div></div>
      <p class="cf-notice" data-cf-status role="status" aria-live="polite">첨부 엑셀의 2026-09-07 자료로 계산하는 초안입니다. 실제 DataPARC 조회는 아직 연결하지 않았습니다.</p>
      <div class="cf-source"><span class="cf-source-name" data-cf-source>원본 1분 누적값 · 석탄 8개 / 바이오 2개 계측값</span><span class="cf-source-status" data-cf-quality>계산 전</span></div>
      <div class="cf-units" data-cf-results></div>
      <section class="cf-panel cf-inputs"><p class="cf-input-help" data-cf-organic-help>유기성은 호기별 카드에서 직접 입력·저장합니다. 빈칸은 미입력, 0 ton은 사용 없음입니다. 일일 DATA나 원본 수기값을 자동으로 가져오지 않습니다.</p>
      <details class="cf-details"><summary>발열량 · 계산 기준</summary><table class="cf-settings"><thead><tr><th>발열량 (kcal/kg)</th><th>석탄</th><th>바이오</th><th>유기성</th></tr></thead><tbody>${['unit1','unit2'].map((unit,index) => `<tr><th>${index+1}호기</th>${['coal','bio','organic'].map((fuel,i) => `<td><input aria-label="${index+1}호기 ${['석탄','바이오','유기성'][i]} 발열량" data-cf-calorific="${unit}:${fuel}" type="number" min="0" step="any" value="${[5868,3237,3487][i]}"></td>`).join('')}</tr>`).join('')}</tbody></table><p class="cf-formula">연료별 사용량 = 해당일 00:00부터 다음 날 00:00까지의 1분 누적값의 최댓값 − 최솟값. 석탄은 각 호기 4개 계측값을 합산합니다. 다음 날 00:01은 마지막 00:00 경계값을 읽기 위한 조회 종료이며, 계산 시간은 24시간입니다.</p><p class="cf-formula">혼소율 = (바이오 열량 + 유기성 열량) ÷ 전체 연료 열량 × 100. 연료별 열량은 사용량 × 발열량으로 계산합니다. 원본 보정계수 1.00을 사용합니다.</p></details></section>
      <details class="cf-panel cf-details" data-cf-check-panel hidden><summary>자료 확인 내용</summary><ul class="cf-checks" data-cf-checks></ul></details>
      <p class="cf-footer">숨김 Excel 조회·자동 종료는 별도 읽기 전용 시험으로 확인한 뒤 연결합니다. 유기성 사용량만 날짜·호기별로 서버에 저장합니다. 석탄·바이오 조회 결과와 혼소율은 아직 저장하지 않으며, 오전회의 자료와 연동하지 않습니다.</p>`;
  }
  function unitMarkup(unit, index, durationHours, options) {
    const data = unit || {};
    const referenceLabel = options?.live ? '조회값 참고 (미확정)' : '원본 참고';
    const valid = ['coal', 'bio', 'organic'].every(key => isNumber(data[key]?.quantity));
    const rows = [['coal','석탄 사용량'],['bio','바이오 사용량'],['organic','유기성 사용량']].map(([key,label]) => {
      if (key === 'organic' && options?.manual) return `<div data-cf-organic-slot="unit${index}"></div>`;
      const fuel = data[key] || {};
      const average = isNumber(fuel.quantity) && durationHours > 0 ? `${number(fuel.quantity / durationHours)} ton/h · 하루 평균` : key === 'organic' ? '해당일 사용량 입력' : '자료를 계산해 주세요';
      const reason = fuel.missingSamples > 0 ? `${fuel.missingSamples}개 시각 누락` : '품질 확인 필요';
      const reference = !isNumber(fuel.quantity) && isNumber(fuel.referenceQuantity) ? `<span class="cf-subvalue cf-reference-value">${referenceLabel} ${number(fuel.referenceQuantity)} ton · ${escapeHtml(reason)}</span>` : `<span class="cf-subvalue">${escapeHtml(average)}</span>`;
      return `<div class="cf-fuel-row"><span class="cf-fuel-name">${label}</span><div class="cf-value-block"><span class="cf-value">${number(fuel.quantity)}</span><span class="cf-unit-label">ton</span>${reference}</div></div>`;
    }).join('');
    const ratio = key => isNumber(data.ratios?.[key]) ? `${number(data.ratios[key], 2)}%` : '—';
    return `<article class="cf-unit"><header class="cf-unit__header"><h3>${index}호기</h3><span class="cf-unit__badge">${valid ? '하루 사용량 확인' : unit ? '일부 자료 확인 필요' : '계산 대기'}</span></header><div class="cf-unit__body">${rows}<div class="cf-ratios"><div class="cf-ratio"><span>바이오 혼소율</span><strong>${ratio('bio')}</strong></div><div class="cf-ratio"><span>유기성 혼소율</span><strong>${ratio('organic')}</strong></div><div class="cf-ratio cf-ratio--total"><span>총 혼소율</span><strong>${ratio('total')}</strong></div></div></div></article>`;
  }
  // The input panels are stable DOM nodes. Re-rendering fuel results moves them;
  // it does not replace typed drafts, handlers, or the per-unit save state.
  function organicPanelMarkup(unit,index) {
    return `<div class="cf-organic-title"><label for="cfOrganic-${unit}" class="cf-fuel-name">유기성 사용량</label><span class="cf-manual-tag">직접 입력</span></div>
      <div class="cf-organic-controls"><input id="cfOrganic-${unit}" type="text" data-cf-organic="${unit}" inputmode="decimal" maxlength="32" placeholder="미입력" aria-label="${index}호기 유기성 하루 사용량(ton)" aria-describedby="cfOrganicMessage-${unit}"><span>ton</span><button type="button" class="cf-primary" data-cf-organic-save="${unit}">저장</button><button type="button" data-cf-organic-edit="${unit}" hidden>수정</button><button type="button" data-cf-organic-cancel="${unit}" hidden>취소</button></div>
      <p class="cf-organic-meta" data-cf-organic-meta="${unit}"></p><p class="cf-organic-message" id="cfOrganicMessage-${unit}" data-cf-organic-message="${unit}" role="status" aria-live="polite"></p>
      <div class="cf-organic-secondary"><button type="button" data-cf-organic-reload="${unit}" hidden>다시 불러오기</button><button type="button" data-cf-organic-latest="${unit}" hidden>최신값 확인</button><button type="button" data-cf-organic-clear="${unit}" hidden>미입력으로 지우기</button></div>`;
  }
  function mount(container, options) {
    if (!container || container.dataset.cofiringMounted === 'true') return null;
    const config=options||{},core=root.CofiringCore;
    const storage=root.CofiringOrganicStorage;
    if(!core||!storage){container.textContent='혼소율 모듈을 불러오지 못했습니다. 배포 완료 후 Ctrl+F5로 새로고침해 주세요.';return null;}
    container.dataset.cofiringMounted='true';container.classList.add('cofiring-draft');container.innerHTML=inputMarkup();
    const find=selector=>container.querySelector(selector),date=find('[data-cf-date]');
    let reference=config.reference||root.COFIRING_DRAFT_REFERENCE||null,referencePromise=null;
    let sourceLabel='첨부 엑셀',sourceFilename='',pilotVerified=false,referenceVerified=false,gapSummary=null;
    let busy=false,calculated=false,lastResult=null,loadToken=0,savedSignature='',disposed=false;
    const panels={};
    function authHeaders(){return typeof root.getShiftLogAuthHeaders==='function'?root.getShiftLogAuthHeaders():{};}
    function isMobile(){
      try{return /^\/mobile(?:\/|$)/i.test(root.location?.pathname||'') || /Android|iPhone|iPad|iPod|Mobile/i.test(root.navigator?.userAgent||'') ||
        (root.navigator?.platform==='MacIntel'&&Number(root.navigator?.maxTouchPoints)>0) ||
        (typeof root.isShiftLogMobileView==='function'?root.isShiftLogMobileView():!!root.matchMedia?.('(max-width: 768px)').matches);}
      catch(_){return true;}
    }
    const organic=storage.create({getHeaders:authHeaders,canEdit:()=>!isMobile(),onChange:onOrganicChange});
    function status(message,tone){const e=find('[data-cf-status]');e.textContent=message;e.dataset.tone=tone||'';}
    function period(){return core.dailyRange(date.value);}
    function updatePeriod(){
      try{const v=period();find('[data-cf-query-range]').textContent=`${localTime(v.queryStart).replace('T',' ')} ~ ${localTime(v.queryEnd).replace('T',' ')}`;find('[data-cf-period]').textContent='1분 간격 · 1,441개 경계값 · 하루 24시간 계산 (1,440분)';}
      catch(e){find('[data-cf-query-range]').textContent='—';find('[data-cf-period]').textContent=e.message;}
    }
    for(const [index,unit] of ['unit1','unit2'].entries()){
      const panel=root.document.createElement('div');panel.className='cf-organic-editor';panel.innerHTML=organicPanelMarkup(unit,index+1);panels[unit]=panel;
      const get=key=>panel.querySelector(`[data-cf-organic${key?'-'+key:''}="${unit}"]`);
      get('').addEventListener('input',()=>organic.setDraft(unit,get('').value));
      get('save').addEventListener('click',()=>organic.save(unit));
      get('').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();organic.save(unit);}});
      get('edit').addEventListener('click',()=>{if(organic.edit(unit))get('').focus?.();});
      get('cancel').addEventListener('click',()=>organic.cancel(unit));
      get('reload').addEventListener('click',()=>organic.load({force:true}));
      get('latest').addEventListener('click',()=>{
        const u=organic.state().day?.units[unit];if(!u?.hasConflict)return;
        const value=u.conflict?.tons==null?'미입력':`${number(u.conflict.tons)} ton`;
        if(root.confirm?.(`${date.value} ${index+1}호기 최신 저장값은 ${value}입니다. 현재 미저장 입력을 버리고 최신값을 확인하시겠습니까?`))organic.useLatest(unit);
      });
      get('clear').addEventListener('click',()=>{
        if(root.confirm?.(`${date.value} ${index+1}호기의 유기성 저장값을 미입력으로 지울까요? 0 ton으로 바꾸는 것이 아니며 이전 저장 이력은 보존됩니다.`))organic.save(unit,{clear:true});
      });
    }
    function syncOrganicPanels(){
      const s=organic.state(),d=s.day;
      for(const unit of ['unit1','unit2']){
        const panel=panels[unit],u=d?.units[unit];if(!panel)continue;
        const get=key=>panel.querySelector(`[data-cf-organic${key?'-'+key:''}="${unit}"]`);
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
          r?.tons===0?'0 ton 저장됨 · 사용 없음':r?.tons!=null?'저장 완료 · 날짜별·호기별 보관': '해당일 사용량 입력 · 사용하지 않은 날은 0';
        get('message').textContent=message;get('message').dataset.tone=(u?.error||d?.error)?'error':r?.tons!=null&&!u?.dirty?'success':'';
      }
    }
    function renderCards(result){
      const destination=find('[data-cf-results]');
      destination.innerHTML=unitMarkup(result?.units.unit1||null,1,result?.period.durationHours||0,{live:pilotVerified,manual:true})+unitMarkup(result?.units.unit2||null,2,result?.period.durationHours||0,{live:pilotVerified,manual:true});
      for(const unit of ['unit1','unit2'])destination.querySelector(`[data-cf-organic-slot="${unit}"]`).appendChild(panels[unit]);
      syncOrganicPanels();
    }
    function resetResults(){calculated=false;lastResult=null;renderCards(null);find('[data-cf-quality]').textContent='계산 전';find('[data-cf-check-panel]').hidden=true;}
    function onOrganicChange(){
      if(disposed)return;
      syncOrganicPanels();
      const signature=JSON.stringify({date:date.value,values:organic.values()});
      if(signature===savedSignature)return;savedSignature=signature;
      if(calculated&&lastResult&&lastResult.period.start===period().start){
        try{display(core.analyzeDay(reference,numericOptions()));}catch(e){resetResults();status(e.message,'error');}
      }
    }
    function invalidatePeriod(){
      ++loadToken;resetResults();updatePeriod();organic.select(date.value);organic.load();
      find('[data-cf-source]').textContent='선택일의 하루 자료로 다시 계산해 주세요.';
      status('계산일이 변경되었습니다. 날짜 변경만으로 자동조회하지 않습니다. 유기성은 선택일의 서버 저장값만 불러옵니다. 연료 계산은 선택일의 시험 결과를 열어 주세요.');
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
      const current=period(),saved=organic.values(),calorifics={unit1:{},unit2:{}};
      for(const field of container.querySelectorAll('[data-cf-calorific]')){
        const [unit,fuel]=field.dataset.cfCalorific.split(':');const value=numericInput(field.value,'발열량');
        if(value===null||value===0)throw new Error('발열량은 0보다 큰 숫자로 입력해 주세요.');calorifics[unit][fuel]=value;
      }
      return {targetDate:current.targetDate,organic:{start:current.start,end:current.end,...saved},calorifics,requireQuality:reference?.source?.kind==='dataparc_hidden_excel'};
    }
    function display(result){
      calculated=true;lastResult=result;renderCards(result);
      const warnings=(result.warnings||[]).map(item=>typeof item==='string'?item:JSON.stringify(item));
      if(pilotVerified&&!referenceVerified&&!gapSummary)warnings.unshift('하루 값·품질·시각과 조회용 Excel 종료는 확인했지만 원본 Excel 전체 대조는 미완료입니다. 연료 조회 결과와 혼소율은 운영 저장하지 않습니다.');
      if(gapSummary)warnings.unshift(`10개 TAG 수신과 Excel 종료 확인 · 정상 숫자 ${gapSummary.validSamples.toLocaleString('ko-KR')}개 · 자료 없음 ${gapSummary.missingSamples}개. 누락은 0이나 보간값으로 채우지 않았습니다.`,`원본 대조 ${gapSummary.comparedSamples.toLocaleString('ko-KR')}/${gapSummary.expectedSamples.toLocaleString('ko-KR')}개는 조회 개수가 아닙니다. 누락 연료는 미확정이며 해당 호기 혼소율을 계산하지 않습니다. 유기성 수기 저장은 이 판정을 바꾸지 않습니다.`);
      const complete=Object.values(result.units).every(unit=>isNumber(unit.ratios?.total));
      find('[data-cf-source]').textContent=`${sourceLabel} · ${sourceFilename||reference.source?.filename||'1분 누적 자료'} · ${localTime(result.period.start).replace('T',' ')} ~ ${localTime(result.period.end).replace('T',' ')}`;
      find('[data-cf-quality]').textContent=gapSummary?`조회 완료 · 누락 ${gapSummary.missingSamples}개 / 원본 대조 ${gapSummary.comparedSamples.toLocaleString('ko-KR')}/${gapSummary.expectedSamples.toLocaleString('ko-KR')}`:result.qualityVerified&&pilotVerified?(referenceVerified?'품질·종료·원본 대조 확인':'값·품질·종료 확인 / 원본 대조 미완료'):'품질 정보 미검증';
      find('[data-cf-check-panel]').hidden=warnings.length===0;find('[data-cf-checks]').innerHTML=warnings.map(value=>`<li>${escapeHtml(value)}</li>`).join('');
      status(gapSummary?`조회 완료 · ${gapSummary.missingSamples}개 분 표본 누락. 정상 연료는 사용량을, 누락 연료는 조회값 참고(미확정)를 표시했습니다. 누락이 있는 호기의 혼소율은 표시하지 않습니다.`:complete?'서버에 저장된 유기성 사용량으로 혼소율을 계산했습니다. 연료 조회 결과·혼소율 자체는 아직 서버에 저장하지 않습니다.':'확인 가능한 사용량을 표시했습니다. 누락 자료 또는 유기성 저장값이 없는 호기는 혼소율을 표시하지 않습니다.',complete?'success':'');
    }
    async function calculate(){
      if(busy)return;const token=++loadToken;busy=true;find('[data-cf-calculate]').disabled=true;
      try{period();const data=await loadReference();if(token!==loadToken)return;const values=numericOptions();values.requireQuality=data.source?.kind==='dataparc_hidden_excel';const result=core.analyzeDay(data,values);reference=data;display(result);}
      catch(e){if(token===loadToken){resetResults();status(e.message||'자료를 계산하지 못했습니다.','error');}}
      finally{busy=false;find('[data-cf-calculate]').disabled=false;}
    }
    date.addEventListener('change',invalidatePeriod);date.addEventListener('input',invalidatePeriod);
    find('[data-cf-calculate]').addEventListener('click',calculate);
    for(const field of container.querySelectorAll('[data-cf-calorific]'))field.addEventListener('input',()=>{++loadToken;if(calculated)resetResults();status('발열량이 변경되었습니다. 다시 계산해 주세요.');});
    find('[data-cf-original]').addEventListener('click',async()=>{
      if(busy)return;const token=++loadToken;
      try{const data=await loadReference();if(token!==loadToken)return;const sourceDay=core.validateDailySource(data);reference=data;date.value=sourceDay.targetDate;invalidatePeriod();
        for(const field of container.querySelectorAll('[data-cf-calorific]')){const [unit,fuel]=field.dataset.cfCalorific.split(':');const value=data.calorifics?.[unit]?.[fuel];if(isNumber(value))field.value=String(value);}
        // Original manualOrganic (including 59.84) is NEVER used as a default or a save.
        await calculate();
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
        sourceLabel=pilotVerified?'불러온 하루 조회 자료':'불러온 참고 자료';sourceFilename=file.name;date.value=imported.day.targetDate;invalidatePeriod();
        display(core.analyzeDay(data,numericOptions()));find('[data-cf-calculate]').textContent=pilotVerified?'시험 자료로 계산':'불러온 자료로 계산';
      }catch(e){if(accepted||token===loadToken)status(e.message||'시험 결과 파일을 읽지 못했습니다.','error');}
      finally{event.target.value='';}
    });
    function visible(){return !container.closest?.('[hidden], [aria-hidden="true"]');}
    function activate(){onOrganicChange();if(visible())return organic.load({force:true});return Promise.resolve(false);}
    const view=container.closest?.('[data-efficiency-view]'),modal=root.document.getElementById?.('efficiencyTeamModal');
    let observer=null;
    if(root.MutationObserver&&view){observer=new root.MutationObserver(()=>{if(visible())activate();});for(const node of [view,modal])if(node)observer.observe(node,{attributes:true,attributeFilter:['hidden','aria-hidden']});}
    const focus=()=>{activate();},resize=()=>{onOrganicChange();},storageChanged=e=>{if(!e.key||e.key==='gsShiftLog.currentUser')activate();};
    root.addEventListener?.('focus',focus);root.addEventListener?.('storage',storageChanged);root.addEventListener?.('resize',resize);
    container.addEventListener('focusin',()=>{onOrganicChange();});
    resetResults();updatePeriod();organic.select(date.value);if(visible())organic.load();
    return {calculate,resetResults,activate,organic,dispose(){disposed=true;++loadToken;observer?.disconnect();organic.dispose();root.removeEventListener?.('focus',focus);root.removeEventListener?.('storage',storageChanged);root.removeEventListener?.('resize',resize);}};
  }
  root.CofiringDraft={mount,unitMarkup,numericInput,asKst,parseImportedReport,toKstInput:localTime};
  if(typeof module==='object'&&module.exports) module.exports=root.CofiringDraft;
  if(root.document) {
    const init=()=>{const container=root.document.querySelector('[data-cofiring-draft-root]');if(container)mount(container);};
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  }
})(typeof globalThis==='object'?globalThis:this);
