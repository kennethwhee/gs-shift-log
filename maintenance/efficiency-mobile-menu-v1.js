/* GS_EFFICIENCY_MOBILE_MENU_V1: stored co-firing values only; no calculation or write requests. */
(function (root) {
  'use strict';
  const APIS = Object.freeze({
    closed: '/api/cofiring-closed-history',
    estimate: '/api/cofiring-provisional-v12',
    settings: '/api/cofiring-calculation-settings'
  });
  const FUELS = [['coal', 'Coal'], ['bio', 'Bio'], ['organic', '유기성'], ['manure', '축분']];
  const MENU_IDS = ['efficiencyLimestoneTab', 'efficiencyCofiringMonitorTab', 'efficiencySolidFuelTab',
    'efficiencyAuxiliaryMaterialsTab', 'efficiencyBedAshDischargeTab', 'efficiencyArmRollTab'];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const format = (value, digits = 3) => finite(value) === null ? '—' : value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  });
  function validDate(value) {
    if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }
  const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const shiftDate = (date, days) => validDate(date) ? new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10) : '';
  function savedSummary(item) {
    const result = item?.effectiveResult || item?.snapshot?.result;
    if (!result) return item?.summary || null;
    // Copy the stored/effective server fields. Never recalculate or substitute
    // stale snapshot numbers for missing values in an effective adjustment.
    const ratios = value => ({
      bioRatio: finite(value?.fuelRatios?.bio) ?? finite(value?.ratios?.bio),
      organicGroupRatio: finite(value?.fuelRatios?.organicGroup) ?? finite(value?.ratios?.organic),
      totalRatio: finite(value?.fuelRatios?.total) ?? finite(value?.ratios?.total)
    });
    return {
      combined: ratios(result.combined),
      ...Object.fromEntries(['unit1', 'unit2'].map(unit => [unit, {
        ...ratios(result.units?.[unit]),
        ...Object.fromEntries(FUELS.map(([fuel]) => [fuel, finite(result.units?.[unit]?.[fuel]?.quantity)]))
      }]))
    };
  }
  function chooseRecord(closed, estimate, date) {
    for (const item of [closed, estimate]) {
      if (item && item.targetDate !== date) throw new Error('응답 날짜가 선택한 날짜와 다릅니다. 다시 조회해 주세요.');
    }
    if (closed) return {item: closed, summary: savedSummary(closed), estimated: false};
    if (estimate) {
      if (estimate.recordKind !== 'hypothesis' || estimate.officialClose !== false || estimate.verificationStatus !== 'unverified') {
        throw new Error('추정 저장값의 상태를 확인하지 못했습니다.');
      }
      return {item: estimate, summary: estimate.summary || null, estimated: true};
    }
    return null;
  }
  function mergeHistory(closed, estimates, month) {
    if (!Array.isArray(closed) || !Array.isArray(estimates)) throw new Error('저장 목록 응답을 확인하지 못했습니다.');
    const records = new Map();
    for (const item of estimates) {
      if (!validDate(item?.targetDate) || item.targetDate.slice(0, 7) !== month) throw new Error('응답 월이 조회 월과 다릅니다.');
      records.set(item.targetDate, chooseRecord(null, item, item.targetDate));
    }
    for (const item of closed) {
      if (!validDate(item?.targetDate) || item.targetDate.slice(0, 7) !== month) throw new Error('응답 월이 조회 월과 다릅니다.');
      records.set(item.targetDate, chooseRecord(item, null, item.targetDate));
    }
    return [...records.values()].sort((a, b) => b.item.targetDate.localeCompare(a.item.targetDate));
  }
  function timeLabel(value) {
    const time = new Date(value || '');
    return Number.isFinite(time.getTime()) ? time.toLocaleString('ko-KR', {timeZone:'Asia/Seoul', hour12:false}) : '—';
  }
  const empty = message => `<p class="gsm-empty">${escapeHtml(message)}</p>`;
  function recordMarkup(record) {
    if (!record) return empty('이 날짜에 저장된 계산 결과가 없습니다.');
    const {item, summary, estimated} = record;
    const value = (number, digits, approximate = estimated) => (approximate && finite(number) !== null ? '≈ ' : '') + format(number, digits);
    const estimatedClass = estimated ? ' gsm-estimated' : '';
    const period = item.snapshot?.period || item.record?.period;
    return `<div class="gsm-total${estimatedClass}"><span>종합 혼소율</span><strong>${value(summary?.combined?.totalRatio, 2)}${finite(summary?.combined?.totalRatio) === null ? '' : '%'}</strong></div>
      <div class="gsm-record-meta"><strong class="gsm-badge${estimatedClass}">${estimated ? '추정 저장 · 미확정' : '마감 저장'}</strong>
      ${item.adjustmentApplied || item.adjustment ? '<span>혼소 조정 반영</span>' : ''}</div>
      ${estimated ? '<p class="gsm-note">추정값이 포함되어 있습니다. 공식 마감값이 아닙니다.</p>' : ''}
      <div class="gsm-table-wrap"><table><caption>저장된 연료 사용량 및 혼소율</caption><thead><tr><th scope="col">항목</th><th scope="col">1호기</th><th scope="col">2호기</th></tr></thead>
      <tbody>${FUELS.map(([key, label]) => `<tr><th scope="row">${label} <small>t</small></th>${['unit1','unit2'].map(unit => `<td class="${estimated && key === 'organic' ? estimatedClass : ''}">${value(summary?.[unit]?.[key], 3, estimated && key === 'organic')}</td>`).join('')}</tr>`).join('')}
      ${[['bioRatio','Bio'],['organicGroupRatio','유기성·축분'],['totalRatio','총 혼소율']].map(([key,label]) => `<tr class="gsm-ratio-row"><th scope="row">${label} <small>%</small></th>${['unit1','unit2'].map(unit => `<td class="${estimatedClass}">${value(summary?.[unit]?.[key], 2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${period ? `<p class="gsm-note">기간 ${escapeHtml(period.startLocal || '')} ~ ${escapeHtml(period.endLocal || '')}</p>` : ''}
      <p class="gsm-note">저장 ${escapeHtml(timeLabel(item.updatedAt || item.savedAt))}${item.savedByName ? ' · ' + escapeHtml(item.savedByName) : ''}</p>`;
  }
  function settingsMarkup(payload, history, date) {
    if (payload.targetDate !== date) throw new Error('발열량 응답 날짜가 선택한 날짜와 다릅니다.');
    const table = settings => `<div class="gsm-table-wrap"><table><caption>호기별 연료 발열량과 보정계수</caption><thead><tr><th scope="col">연료</th><th scope="col">1호기</th><th scope="col">2호기</th></tr></thead><tbody>
      ${FUELS.map(([key,label]) => `<tr><th scope="row">${label}</th>${['unit1','unit2'].map(unit => `<td>${format(settings?.[unit]?.[key]?.calorific, 0)}<small class="gsm-coefficient">보정계수 ${format(settings?.[unit]?.[key]?.coefficient, 3)}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return `<div class="gsm-record-meta"><strong>${payload.source === 'saved' ? escapeHtml(payload.effectiveDate) + ' 적용값' : '기본값 · 저장 이력 없음'}</strong><span>kcal/kg</span></div>
      ${table(payload.settings)}<p class="gsm-note">${payload.source === 'saved' ? '저장 ' + escapeHtml(timeLabel(payload.updatedAt)) : '선택일 이전에 저장된 적용값이 없어 기본값을 표시합니다.'}</p>
      <details class="gsm-settings-history"><summary>발열량 저장 이력</summary>${Array.isArray(history.items) && history.items.length ? history.items.map(item => `<details><summary>${escapeHtml(item.effectiveDate)} 적용</summary>${table(item.settings)}<p class="gsm-note">저장 ${escapeHtml(timeLabel(item.updatedAt))}</p></details>`).join('') : empty('저장된 발열량 이력이 없습니다.')}</details>`;
  }
  const exported = {validDate, shiftDate, savedSummary, chooseRecord, mergeHistory, recordMarkup, settingsMarkup};
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (!root.document) return;

  const document = root.document;
  const mobile = root.matchMedia('(max-width: 768px)');
  let controller = null;
  root.GSEfficiencyMobileV1 = {selectView: view => controller?.selectView(view)};
  function init() {
    const modal = document.getElementById('efficiencyTeamModal');
    const panel = document.getElementById('efficiencyCofiringMonitorView');
    const solid = document.getElementById('efficiencySolidFuelView');
    if (!modal || !panel || !solid) return;
    panel.innerHTML = `<div class="gsm-monitor"><header class="gsm-monitor-heading"><h3>혼소율</h3><span>조회 전용 · 저장된 값 기준</span></header>
      <div class="gsm-subtabs" role="tablist" aria-label="혼소율 모니터링">
        ${[['result','계산 결과'],['history','마감데이터'],['settings','발열량']].map(([key,label],i) => `<button type="button" id="gsm-tab-${key}" role="tab" aria-controls="gsm-result-body" aria-selected="${i === 0}" data-gsm-tab="${key}">${label}</button>`).join('')}
      </div><div class="gsm-datebar"><button type="button" data-gsm-day="-1" aria-label="이전 날짜">‹</button>
        <label><span class="gsm-sr-only">조회 날짜</span><input type="date" data-gsm-date value="${shiftDate(today(), -1)}"></label>
        <button type="button" data-gsm-day="1" aria-label="다음 날짜">›</button><button type="button" data-gsm-today>오늘</button></div>
      <label class="gsm-monthbar" hidden>조회 월 <input type="month" data-gsm-month value="${today().slice(0,7)}"></label>
      <div class="gsm-refresh-row"><span data-gsm-state role="status"></span><button type="button" data-gsm-refresh>새로고침</button></div>
      <div id="gsm-result-body" role="tabpanel" aria-labelledby="gsm-tab-result" data-gsm-body></div></div>`;
    const body = panel.querySelector('[data-gsm-body]');
    const status = panel.querySelector('[data-gsm-state]');
    const dateInput = panel.querySelector('[data-gsm-date]');
    const monthInput = panel.querySelector('[data-gsm-month]');
    let tab = 'result', sequence = 0, activeRequest = null, loadedKey = '';
    function headers() {
      try {
        if (typeof root.getShiftLogAuthHeaders === 'function') return root.getShiftLogAuthHeaders();
        const user = JSON.parse(root.localStorage.getItem('gsShiftLog.currentUser') || 'null');
        const token = String(user?.sessionToken || user?.session_token || user?.accessToken || user?.access_token || user?.token || user?.session?.token || '').trim();
        return token ? {Authorization: 'Bearer ' + token} : {};
      } catch (_) { return {}; }
    }
    const credential = () => { const value = headers(); return String(value.Authorization || value.authorization || ''); };
    const visible = () => mobile.matches && modal.classList.contains('is-open') && !panel.hidden;
    function cancel() { sequence++; activeRequest?.abort(); activeRequest = null; }
    async function get(kind, query, signal, auth) {
      const response = await root.fetch(APIS[kind] + '?' + query, {
        method: 'GET', headers: {...auth, Accept:'application/json'}, credentials:'same-origin', cache:'no-store', signal
      });
      let payload;
      try { payload = await response.json(); } catch (_) { throw new Error('서버 응답을 확인하지 못했습니다.'); }
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || '저장 자료를 불러오지 못했습니다.');
      return payload;
    }
    async function load() {
      cancel();
      if (!visible()) return;
      body.innerHTML = '';
      loadedKey = '';
      const auth = headers(), key = credential(), current = sequence;
      if (!key) { status.textContent = '로그인 후 저장된 자료를 확인할 수 있습니다.'; return; }
      const date = dateInput.value, month = monthInput.value;
      if ((tab === 'history' && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) || (tab !== 'history' && !validDate(date))) {
        status.textContent = '조회 날짜를 확인해 주세요.'; return;
      }
      const request = new AbortController(); activeRequest = request;
      let timedOut = false;
      const timer = root.setTimeout(() => { timedOut = true; request.abort(); }, 20000);
      status.textContent = '저장 자료 조회 중…'; body.setAttribute('aria-busy', 'true');
      try {
        const query = tab === 'history' ? 'month=' + encodeURIComponent(month) : 'targetDate=' + encodeURIComponent(date);
        const data = tab === 'settings'
          ? await Promise.all([get('settings', query, request.signal, auth), get('settings', 'history=1&limit=180', request.signal, auth)])
          : await Promise.all([get('closed', query, request.signal, auth), get('estimate', query, request.signal, auth)]);
        if (current !== sequence || key !== credential() || !visible()) return;
        if (tab === 'result') body.innerHTML = recordMarkup(chooseRecord(data[0].item, data[1].item, date));
        else if (tab === 'settings') body.innerHTML = settingsMarkup(data[0], data[1], date);
        else {
          const records = mergeHistory(data[0].items, data[1].items, month);
          body.innerHTML = records.length ? `<div class="gsm-history-list">${records.map(record => `<button type="button" data-gsm-open-date="${record.item.targetDate}" class="gsm-history-item${record.estimated ? ' gsm-estimated' : ''}"><strong>${record.item.targetDate}</strong><span>${record.estimated ? '추정 · 미확정' : '마감'}${record.item.adjustmentApplied ? ' · 조정' : ''}</span><span>상세 보기 ›</span></button>`).join('')}</div>` : empty('이 달에 저장된 마감·추정 자료가 없습니다.');
        }
        status.textContent = '저장 자료 조회 완료'; loadedKey = key;
      } catch (error) {
        if (current !== sequence || key !== credential() || !visible()) return;
        status.textContent = timedOut ? '조회 시간이 초과되었습니다. 새로고침해 주세요.' : error.message || '조회하지 못했습니다.';
        body.innerHTML = '';
      } finally {
        root.clearTimeout(timer);
        if (current === sequence) {
          activeRequest = null; body.removeAttribute('aria-busy');
          if (key !== credential()) { body.innerHTML = ''; loadedKey = ''; status.textContent = '로그인 상태가 변경되었습니다. 새로고침해 주세요.'; }
        }
      }
    }
    function selectTab(next) {
      tab = next;
      panel.querySelectorAll('[data-gsm-tab]').forEach(button => {
        button.setAttribute('aria-selected', String(button.dataset.gsmTab === tab));
      });
      body.setAttribute('aria-labelledby', 'gsm-tab-' + tab);
      panel.querySelector('.gsm-datebar').hidden = tab === 'history';
      panel.querySelector('.gsm-monthbar').hidden = tab !== 'history';
      void load();
    }
    panel.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || !panel.contains(button)) return;
      if (button.dataset.gsmTab) selectTab(button.dataset.gsmTab);
      else if (button.hasAttribute('data-gsm-day')) { dateInput.value = shiftDate(dateInput.value, Number(button.dataset.gsmDay)); void load(); }
      else if (button.hasAttribute('data-gsm-today')) { dateInput.value = today(); void load(); }
      else if (button.hasAttribute('data-gsm-refresh')) void load();
      else if (button.dataset.gsmOpenDate) { dateInput.value = button.dataset.gsmOpenDate; selectTab('result'); }
    });
    dateInput.addEventListener('change', () => void load());
    monthInput.addEventListener('change', () => void load());
    let frame = null;
    function openSolid() {
      if (frame) return;
      frame = document.createElement('iframe');
      frame.title = '고형연료 관리'; frame.className = 'gsm-solid-frame';
      frame.src = '/maintenance/solid-fuel-trouble?embed=efficiency-mobile&v=20261030-mobile-compact-v3';
      solid.replaceChildren(frame);
    }
    function focusMenu() {
      if (!mobile.matches) return;
      const buttons = MENU_IDS.map(id => document.getElementById(id)).filter(Boolean);
      const active = buttons.find(button => button.getAttribute('aria-selected') === 'true') || buttons[0];
      buttons.forEach(button => { button.tabIndex = button === active ? 0 : -1; });
    }
    controller = {selectView(view) {
      if (mobile.matches && ['cofiring-monitor', 'solid-fuel'].includes(view)) modal.dataset.gsmActiveView = view;
      else delete modal.dataset.gsmActiveView;
      focusMenu();
      if (view === 'cofiring-monitor' && mobile.matches) void load();
      else { cancel(); if (view === 'solid-fuel' && mobile.matches) openSolid(); }
    }};
    const menu = modal.querySelector('.efficiency-team-tabs');
    menu.addEventListener('keydown', event => {
      if (!mobile.matches || !['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      const buttons = MENU_IDS.map(id => document.getElementById(id));
      const index = buttons.indexOf(event.target); if (index < 0) return;
      const steps = {ArrowRight:1, ArrowLeft:-1, ArrowDown:3, ArrowUp:-3};
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 5 : (index + steps[event.key] + 6) % 6;
      event.preventDefault(); buttons[next].click(); buttons[next].focus();
    });
    function modeChanged() {
      if (!mobile.matches && (!panel.hidden || !solid.hidden)) root.switchEfficiencyTeamView?.('');
      else focusMenu();
    }
    mobile.addEventListener('change', modeChanged);
    root.addEventListener('storage', event => {
      if (event.key === 'gsShiftLog.currentUser' || event.key === null) {
        cancel(); body.innerHTML = ''; loadedKey = ''; status.textContent = '로그인 상태가 변경되었습니다. 새로고침해 주세요.';
      }
    });
    root.addEventListener('focus', () => {
      if (loadedKey && loadedKey !== credential()) { cancel(); body.innerHTML = ''; loadedKey = ''; status.textContent = '로그인 상태가 변경되었습니다. 새로고침해 주세요.'; }
    });
    new MutationObserver(() => { if (!visible()) cancel(); }).observe(modal, {attributes:true, attributeFilter:['class']});
    modeChanged();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})(typeof globalThis === 'object' ? globalThis : this);
