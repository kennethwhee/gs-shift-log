/* Selected-day operating report. No source query runs on navigation. */
(() => {
  'use strict';
  if (window.__gsDailyOperationReportsInstalled) return;
  window.__gsDailyOperationReportsInstalled = true;

  const API = '/api/daily-operation-reports';
  const VIEW_ID = 'efficiencyDailyOperationView';
  const layout = window.GSDailyOperationLayout || window.DailyOperationLayout;
  if (!layout || !Array.isArray(layout.fields)) return;
  const fields = new Map(layout.fields.map(field => [field.id, field]));
  const localFormulas = new Set(['sumComplete', 'subtractComplete', 'safeRate(daily,hours)', 'bioSiloTonnes', 'coalSiloTonnes']);
  const state = {
    date: '', values: {}, sources: {}, version: 0, note: '', dirty: false,
    loaded: false, hasRecord: false, busy: '', generation: 0, controller: null,
    invalid: new Set(), edited: new Set(), archiveSequence: 0,
    archiveMonth: '', items: [], initialized: false, conflict: false
  };
  let view;
  const sessionKey = () => {
    if (typeof getShiftLogSessionToken === 'function') return String(getShiftLogSessionToken() || '');
    if (typeof getShiftLogAuthHeaders === 'function') return String(getShiftLogAuthHeaders().Authorization || '');
    return '';
  };
  let sessionIdentity = sessionKey();
  const byId = id => document.getElementById(id);
  const hasValue = value => value !== null && value !== undefined && value !== '';
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const today = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const moveDate = amount => {
    const date = new Date(`${state.date}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  };
  const node = (tag, attributes = {}, text = '') => {
    const element = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'class') element.className = value;
      else if (key === 'style') element.style.cssText = value;
      else element.setAttribute(key, String(value));
    });
    if (text !== '') element.textContent = text;
    return element;
  };
  const button = (action, text, className = '') => node('button', {
    type: 'button', 'data-dor-action': action, class: `dor-button ${className}`
  }, text);
  const manualSource = () => ({
    source: 'manual', label: '직접 입력', date: state.date, updatedAt: new Date().toISOString()
  });

  function checkSession() {
    const current = sessionKey();
    if (current === sessionIdentity) return false;
    sessionIdentity = current;
    if (state.controller) state.controller.abort();
    state.generation += 1; state.archiveSequence += 1;
    Object.assign(state, { values: {}, sources: {}, note: '', version: 0, loaded: false, hasRecord: false, dirty: false, busy: '', items: [], conflict: false, archiveMonth: '' });
    state.invalid.clear(); state.edited.clear();
    if (state.initialized) {
      fillForm(); renderArchive(); showWarnings();
      byId('dailyOperationListStatus').textContent = '';
      message('로그인 정보가 변경되었습니다. 저장자료를 다시 조회해 주세요.');
      byId('dailyOperationStatus').append(' ', button('retry', '다시 조회'));
      updateControls();
    }
    return true;
  }

  function ensureSameSession(expected) {
    if (sessionKey() === expected) return;
    checkSession();
    const error = new Error('로그인 정보가 변경되어 이전 요청을 취소했습니다.');
    error.name = 'AbortError';
    throw error;
  }

  async function request(url, options = {}) {
    const expectedSession = sessionKey();
    const extra = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const headers = typeof getEfficiencyDailyWorkApiHeaders === 'function'
      ? getEfficiencyDailyWorkApiHeaders(extra)
      : typeof getShiftLogAuthHeaders === 'function' ? getShiftLogAuthHeaders(extra) : extra;
    const response = await fetch(url, { cache: 'no-store', ...options, headers });
    ensureSameSession(expectedSession);
    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error(`서버 응답을 확인할 수 없습니다. (HTTP ${response.status})`); }
    ensureSameSession(expectedSession);
    if (response.status === 401) {
      if (typeof clearCurrentUser === 'function') clearCurrentUser();
      if (typeof openLoginScreen === 'function') openLoginScreen();
    }
    if (!response.ok || result.ok === false || result.success === false) {
      const error = new Error(result.message || result.error || `요청에 실패했습니다. (HTTP ${response.status})`);
      error.status = response.status;
      error.result = result;
      throw error;
    }
    return result;
  }

  function message(text, type = '') {
    const status = byId('dailyOperationStatus');
    if (!status) return;
    status.textContent = text;
    status.className = `dor-status ${type ? `is-${type}` : ''}`;
    status.setAttribute('role', type === 'error' ? 'alert' : 'status');
  }

  function setBusy(value) {
    state.busy = value;
    view.setAttribute('aria-busy', value ? 'true' : 'false');
    updateControls();
  }

  function updateControls() {
    if (!view) return;
    view.querySelectorAll('[data-dor-action]').forEach(control => {
      const action = control.dataset.dorAction;
      const isDate = ['previous', 'next', 'today'].includes(action);
      const archive = ['refresh-list', 'open-record'].includes(action);
      control.disabled = archive ? state.busy === 'save' || state.busy === 'delete'
        : isDate ? ['save', 'delete'].includes(state.busy)
        : action === 'retry' ? !!state.busy
        : action === 'reload' ? !!state.busy
        : action === 'print' ? !state.loaded || !!state.busy
        : action === 'delete-record' ? !!state.busy
        : !!state.busy || !state.loaded || (action === 'save' && (state.invalid.size > 0 || state.conflict));
    });
    byId('dailyOperationDate').disabled = ['save', 'delete'].includes(state.busy);
    view.querySelectorAll('[data-dor-field], #dailyOperationNote').forEach(input => {
      input.disabled = !state.loaded || ['load', 'save', 'delete'].includes(state.busy);
    });
    const badge = byId('dailyOperationSaveState');
    badge.textContent = state.busy === 'save' ? '저장 중…' : state.dirty ? '미저장 변경' : state.loaded && state.hasRecord ? '저장된 자료' : state.loaded ? '새 자료' : '조회 필요';
    badge.className = `dor-save-state${state.dirty ? ' is-dirty' : state.loaded && state.hasRecord ? ' is-saved' : ''}`;
    byId('dailyOperationConflict').hidden = !state.conflict;
  }

  function formatValue(field, value) {
    if (!hasValue(value)) return '';
    if (field.type === 'text') return String(value);
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('en-US', {
      minimumFractionDigits: field.precision || 0, maximumFractionDigits: field.precision || 0
    }) : '';
  }

  function sourceDescription(id) {
    const field = fields.get(id);
    const source = state.sources[id];
    if (!source) return `${field.label}${field.unit ? ` (${field.unit})` : ''} · 미입력`;
    return `${field.label}${field.unit ? ` (${field.unit})` : ''} · ${source.label || source.source || '저장값'}${source.sourceDate ? ` · 기준일 ${source.sourceDate}` : ''}${source.note ? ` · ${source.note}` : ''}`;
  }

  function updateField(id, preserveFocus = true) {
    const field = fields.get(id);
    view.querySelectorAll('[data-dor-field]').forEach(input => {
      if (input.dataset.dorField !== id) return;
      if (!preserveFocus || document.activeElement !== input) input.value = formatValue(field, state.values[id]);
      input.title = sourceDescription(id);
      input.classList.toggle('is-manual', state.sources[id]?.source === 'manual');
      input.setAttribute('aria-invalid', state.invalid.has(id) ? 'true' : 'false');
    });
  }

  function recalculate() {
    // Two passes resolve totals which depend on calculated per-unit averages.
    for (let pass = 0; pass < 2; pass += 1) layout.fields.forEach(field => {
      if (!localFormulas.has(field.formula)) return;
      const values = field.dependencies.map(id => state.values[id]);
      let value = null;
      if (field.dependencies.every(id => !state.invalid.has(id)) && values.every(v => hasValue(v) && Number.isFinite(Number(v)))) {
        const numbers = values.map(Number);
        if (field.formula === 'sumComplete') value = numbers.reduce((sum, item) => sum + item, 0);
        if (field.formula === 'subtractComplete') value = numbers[0] - numbers[1];
        if (field.formula === 'safeRate(daily,hours)') value = numbers[1] > 0 ? numbers[0] / numbers[1] : numbers[0] === 0 && numbers[1] === 0 ? 0 : null;
        if (field.formula === 'bioSiloTonnes' && typeof window.GSDailyOperationSources?.bioSiloTonnes === 'function') value = window.GSDailyOperationSources.bioSiloTonnes(numbers[0]);
        if (field.formula === 'coalSiloTonnes' && typeof window.GSDailyOperationSources?.coalSiloTonnes === 'function') value = window.GSDailyOperationSources.coalSiloTonnes(numbers[0]);
      }
      state.values[field.id] = value;
      if (value !== null) state.sources[field.id] = { source: 'calculated', label: '입력값 계산', date: state.date, note: field.dependencies.map(id => fields.get(id)?.label || id).join(' / ') };
      else delete state.sources[field.id];
      updateField(field.id);
    });
  }

  function invalidateMonthly(changedId) {
    const affected = new Set([changedId]);
    let grew = true;
    while (grew) {
      grew = false;
      layout.fields.forEach(field => {
        if (!localFormulas.has(field.formula) || affected.has(field.id)) return;
        if (field.dependencies.some(id => affected.has(id))) { affected.add(field.id); grew = true; }
      });
    }
    let cleared = 0;
    let manual = 0;
    layout.fields.forEach(field => {
      if (!String(field.formula || '').startsWith('month') || !field.dependencies.some(id => affected.has(id))) return;
      if (state.sources[field.id]?.source === 'manual') { manual += 1; return; }
      const hadValue = hasValue(state.values[field.id]);
      state.values[field.id] = null;
      state.sources[field.id] = { source: 'invalidated_daily_change', label: '일일값 변경 · 누계 재계산 필요', date: state.date, note: '자료 불러오기로 일별자료를 다시 합산해 주세요.' };
      state.edited.delete(field.id);
      updateField(field.id);
      if (hadValue) cleared += 1;
    });
    return { cleared, manual };
  }

  function fillForm() {
    layout.fields.forEach(field => updateField(field.id, false));
    byId('dailyOperationNote').value = state.note;
    byId('dailyOperationDate').value = state.date;
    const date = new Date(`${state.date}T00:00:00Z`);
    byId('dailyOperationPaperDate').textContent = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    }).format(date);
    byId('dailyOperationSourceDetail').textContent = '숫자를 선택하면 가져온 자료의 출처를 확인할 수 있습니다.';
    updateControls();
  }

  function createInput(id) {
    const field = fields.get(id);
    const input = node('input', {
      type: 'text', class: 'dor-field', 'data-dor-field': id,
      'aria-label': `${field.label}${field.unit ? ` (${field.unit})` : ''}`,
      autocomplete: 'off', spellcheck: 'false', maxlength: field.type === 'text' ? '2000' : '30'
    });
    if (field.type === 'number') input.inputMode = 'decimal';
    if (localFormulas.has(field.formula)) {
      input.readOnly = true;
      input.classList.add('is-calculated');
      input.setAttribute('aria-label', `${field.label} (자동 계산)`);
    }
    return input;
  }

  function renderPaper() {
    const paper = node('article', { class: 'dor-paper', id: 'dailyOperationPaper', 'aria-label': '일일 운전현황 보고서' });
    const header = node('header', { class: 'dor-paper-header' });
    const heading = node('div', { class: 'dor-paper-heading' });
    heading.append(node('h2', {}, layout.title), node('p', { id: 'dailyOperationPaperDate' }));
    const approval = node('table', { class: 'dor-approval', 'aria-label': '결재' });
    const top = node('tr');
    top.append(node('th', { rowspan: '2', class: 'dor-approval-label' }, '결\n재'));
    ['담당', '파트장', '팀장'].forEach(label => top.append(node('th', {}, label)));
    const bottom = node('tr');
    ['approval_staff', 'approval_leader', 'approval_manager'].forEach(id => {
      const cell = node('td'); cell.append(createInput(id)); bottom.append(cell);
    });
    approval.append(top, bottom); header.append(heading, approval); paper.append(header);
    const totalWidth = layout.columnWidths.reduce((a, b) => a + b, 0);
    layout.sections.forEach(section => {
      const block = node('section', { class: `dor-paper-section dor-section-${section.id}` });
      if (section.title) block.append(node('h3', {}, section.title));
      const table = node('table', { class: 'dor-report-table', 'aria-label': section.title || ({ materials: '약품 사용량', receipts: '부재료 입고 및 반출량', closing: '저장량 및 SMP' }[section.id]) });
      const columns = node('colgroup');
      layout.columnWidths.forEach(width => columns.append(node('col', { style: `width:${width / totalWidth * 100}%` })));
      table.append(columns);
      const body = node('tbody');
      section.rows.forEach(row => {
        const tr = node('tr', { style: `height:${Number(row.height || 18)}px` });
        row.cells.forEach(cell => {
          const td = node('td', { colspan: cell.colspan, rowspan: cell.rowspan });
          const style = cell.style || {};
          if (style.fill?.theme === '5') td.style.backgroundColor = '#f2dcdb';
          if (style.fill?.rgb?.slice(-6).toUpperCase() === 'FFFF00') td.style.backgroundColor = '#ffff00';
          if (style.bold) td.style.fontWeight = '700';
          td.style.fontSize = `${Math.max(10, Math.min(14, Number(style.fontSize || 11)))}px`;
          if (cell.fieldId && fields.has(cell.fieldId)) td.append(createInput(cell.fieldId));
          else td.textContent = String(cell.text || '').replace(/Nm3/g, 'Nm³');
          if (!cell.fieldId && style.alignment?.horizontal === 'right') td.style.textAlign = 'right';
          tr.append(td);
        });
        body.append(tr);
      });
      table.append(body); block.append(table); paper.append(block);
    });
    return paper;
  }

  function render() {
    view.replaceChildren();
    view.classList.add('daily-operation-view');
    const heading = node('div', { class: 'dor-heading' });
    heading.append(node('h2', {}, '일일운전현황'), node('span', { id: 'dailyOperationSaveState', class: 'dor-save-state' }));
    const toolbar = node('div', { class: 'dor-toolbar' });
    const dates = node('div', { class: 'dor-date-controls' });
    const dateLabel = node('label', { for: 'dailyOperationDate', class: 'dor-sr-only' }, '운전현황 기준일');
    dates.append(dateLabel, button('previous', '‹'), node('input', { type: 'date', id: 'dailyOperationDate', min: '2000-01-01', max: '2099-12-31' }), button('next', '›'), button('today', '오늘'));
    dates.querySelector('[data-dor-action="previous"]').setAttribute('aria-label', '전날');
    dates.querySelector('[data-dor-action="next"]').setAttribute('aria-label', '다음날');
    const actions = node('div', { class: 'dor-actions' });
    actions.append(button('collect', '자료 불러오기'), button('query', '운영정보 조회'), button('save', '저장', 'dor-button-primary'), button('print', '인쇄'));
    toolbar.append(dates, actions);
    const status = node('p', { id: 'dailyOperationStatus', class: 'dor-status', role: 'status', 'aria-live': 'polite' });
    const warning = node('details', { id: 'dailyOperationWarnings', class: 'dor-warnings', hidden: '' });
    warning.append(node('summary', {}, '확인이 필요한 항목'), node('ul', { id: 'dailyOperationWarningsList' }));
    const conflict = node('div', { id: 'dailyOperationConflict', class: 'dor-conflict', hidden: '' });
    conflict.append(node('span', {}, '다른 사용자가 이 날짜의 자료를 변경했습니다. 현재 입력은 유지되어 있습니다. 저장된 최신 자료를 불러온 뒤 다시 수정해 주세요.'), button('reload', '최신 저장자료 불러오기'));
    const content = node('div', { class: 'dor-content' });
    const archive = node('aside', { class: 'dor-archive', 'aria-label': '저장목록 관리' });
    const archiveHeading = node('div', { class: 'dor-archive-heading' });
    archiveHeading.append(node('h3', {}, '저장목록'), button('refresh-list', '새로고침'));
    archive.append(archiveHeading, node('label', { for: 'dailyOperationMonth', class: 'dor-sr-only' }, '저장목록 조회월'), node('input', { type: 'month', id: 'dailyOperationMonth', min: '2000-01', max: '2099-12' }), node('p', { id: 'dailyOperationListStatus', class: 'dor-list-status', role: 'status' }), node('div', { id: 'dailyOperationList', class: 'dor-list' }));
    const report = node('div', { class: 'dor-report-area' });
    const scroll = node('div', { class: 'dor-paper-scroll', tabindex: '0', 'aria-label': '운전현황 양식, 좁은 화면에서 좌우 스크롤' });
    scroll.append(renderPaper());
    report.append(node('p', { class: 'dor-help' }, '선택일의 저장자료를 먼저 표시합니다. 자료 불러오기는 빈 항목을 채우며, 누락값은 직접 입력할 수 있습니다.'), scroll,
      node('p', { id: 'dailyOperationSourceDetail', class: 'dor-source-detail', role: 'status' }),
      node('label', { for: 'dailyOperationNote', class: 'dor-note-label' }, '저장 메모'), node('textarea', { id: 'dailyOperationNote', rows: '2', maxlength: '2000', placeholder: '전달 사항이나 변경 사유를 남겨주세요.' }));
    content.append(archive, report);
    view.append(heading, toolbar, status, warning, conflict, content);
    view.addEventListener('click', handleClick);
    view.addEventListener('input', handleInput);
    view.addEventListener('focusin', event => {
      const input = event.target.closest('[data-dor-field]');
      if (!input) return;
      byId('dailyOperationSourceDetail').textContent = sourceDescription(input.dataset.dorField);
      const field = fields.get(input.dataset.dorField);
      if (!input.readOnly && field.type === 'number' && !state.invalid.has(field.id)) input.value = hasValue(state.values[field.id]) ? String(state.values[field.id]) : '';
    });
    view.addEventListener('focusout', event => {
      const input = event.target.closest('[data-dor-field]');
      if (input && !state.invalid.has(input.dataset.dorField)) updateField(input.dataset.dorField, false);
    });
    byId('dailyOperationDate').addEventListener('change', event => navigate(event.target.value));
    byId('dailyOperationMonth').addEventListener('change', event => loadArchive(event.target.value));
    window.addEventListener('beforeunload', event => {
      if (state.dirty) { event.preventDefault(); event.returnValue = ''; }
    });
  }

  function handleInput(event) {
    if (checkSession()) return;
    const input = event.target;
    if (input.id === 'dailyOperationNote') {
      state.note = input.value; state.dirty = true; updateControls(); return;
    }
    const id = input.dataset.dorField;
    if (!id || input.readOnly || !state.loaded) return;
    const field = fields.get(id);
    const previousValue = state.values[id];
    const raw = input.value.trim();
    let value = raw;
    if (field.type === 'number') {
      const groupingValid = !raw.includes(',') || /^-?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(raw);
      const normalized = raw.replace(/,/g, '');
      const valid = groupingValid && (normalized === '' || (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized)) && (field.minimum === undefined || Number(normalized) >= field.minimum) && (field.maximum === undefined || Number(normalized) <= field.maximum)));
      if (!valid) state.invalid.add(id);
      else state.invalid.delete(id);
      value = normalized === '' || !valid ? null : Number(normalized);
    }
    state.values[id] = value;
    state.sources[id] = manualSource();
    state.edited.add(id);
    state.dirty = true;
    const monthly = value !== previousValue ? invalidateMonthly(id) : { cleared: 0, manual: 0 };
    updateField(id);
    recalculate();
    if (state.invalid.size) message('입력값을 확인해 주세요. 숫자만 입력하고 운전시간은 0~24시간으로 입력합니다.', 'error');
    else if (monthly.cleared || monthly.manual) message(`${monthly.cleared ? '일일값 변경으로 관련 누계를 비웠습니다. 자료 불러오기로 다시 계산해 주세요. ' : ''}${monthly.manual ? '직접 입력한 관련 누계는 유지했습니다. 변경된 일일값을 반영했는지 확인해 주세요. ' : ''}변경 후 저장해 주세요.`, 'notice');
    else message('변경한 내용은 저장 버튼을 눌러야 반영됩니다.');
    updateControls();
  }

  function showWarnings(warnings = []) {
    const list = byId('dailyOperationWarningsList');
    list.replaceChildren();
    [...new Set(warnings.filter(Boolean).map(String))].forEach(warning => list.append(node('li', {}, warning)));
    byId('dailyOperationWarnings').hidden = !list.childElementCount;
  }

  function mayDiscard() {
    return !state.dirty || window.confirm('저장하지 않은 변경 내용이 있습니다. 변경 내용을 버리고 이동할까요?');
  }

  async function navigate(date, force = false) {
    checkSession();
    if (!validDate(date) || date < '2000-01-01' || date > '2099-12-31') {
      byId('dailyOperationDate').value = state.date;
      message('올바른 날짜를 선택해 주세요. (2000~2099년)', 'error'); return;
    }
    if (['save', 'delete'].includes(state.busy)) return;
    if (!force && date === state.date && state.loaded) return;
    if (!mayDiscard()) { byId('dailyOperationDate').value = state.date; return; }
    if (state.controller) state.controller.abort();
    const controller = new AbortController(); state.controller = controller;
    const generation = ++state.generation;
    Object.assign(state, { date, values: {}, sources: {}, version: 0, note: '', dirty: false, loaded: false, hasRecord: false, conflict: false });
    state.invalid.clear(); state.edited.clear(); showWarnings();
    setBusy('load'); fillForm(); message(`${date} 저장자료를 확인하고 있습니다…`);
    const month = date.slice(0, 7);
    if (state.archiveMonth !== month) loadArchive(month);
    try {
      const result = await request(`${API}?date=${encodeURIComponent(date)}`, { signal: controller.signal });
      if (generation !== state.generation) return;
      if (result.item && result.item.workDate !== date) throw new Error('선택 날짜와 저장자료의 날짜가 다릅니다. 다시 조회해 주세요.');
      state.version = Number(result.version || result.item?.version || 0);
      state.hasRecord = !!result.item;
      state.values = { ...(result.item?.values || {}) };
      state.sources = { ...(result.item?.sources || {}) };
      state.note = result.item?.note || '';
      state.loaded = true;
      fillForm();
      message(result.item ? `${date} 저장자료를 불러왔습니다.${result.item.updatedAt ? ` · ${formatTimestamp(result.item.updatedAt)}` : ''}` : `${date} 저장자료가 없습니다. 자료를 불러오거나 직접 입력한 뒤 저장해 주세요.`);
    } catch (error) {
      if (generation !== state.generation || error.name === 'AbortError') return;
      message(`저장자료 조회 실패: ${error.message}`, 'error');
      const retry = button('retry', '다시 조회'); byId('dailyOperationStatus').append(' ', retry);
    } finally {
      if (generation === state.generation) { setBusy(''); renderArchive(); }
    }
  }

  const formatTimestamp = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) : '';
  };

  async function collect(queryMissing) {
    if (!state.loaded || state.busy) return;
    const adapter = window.GSDailyOperationSources;
    if (typeof adapter?.collect !== 'function') { message('자료 조회 기능을 불러오지 못했습니다. 화면을 새로고침해 주세요.', 'error'); return; }
    const generation = state.generation;
    const date = state.date;
    const controller = new AbortController(); state.controller = controller;
    setBusy('collect');
    message(queryMissing ? '빈 항목의 운영정보를 조회하고 있습니다…' : '선택일에 저장된 오전회의자료를 확인하고 있습니다…');
    try {
      const result = await adapter.collect(date, {
        queryMissing, request, signal: controller.signal,
        existingValues: { ...state.values },
        invalidatedMonthly: Object.keys(state.sources).filter(id => state.sources[id]?.source === 'invalidated_daily_change'),
        preservedBlankFields: Object.keys(state.sources).filter(id => state.sources[id]?.source === 'manual' && !hasValue(state.values[id])),
        missingFields: layout.fields.filter(field => !hasValue(state.values[field.id]) && !state.edited.has(field.id) && state.sources[field.id]?.source !== 'manual').map(field => field.id),
        onProgress: text => { if (generation === state.generation) message(String(text || '자료를 조회하고 있습니다…')); }
      });
      if (generation !== state.generation || controller.signal.aborted || date !== state.date) return;
      let count = 0;
      Object.entries(result.values || {}).forEach(([id, value]) => {
        if (!fields.has(id) || !hasValue(value) || hasValue(state.values[id]) || state.edited.has(id) || state.sources[id]?.source === 'manual') return;
        const source = result.sources?.[id];
        if (source?.date && source.date !== date) return;
        if (fields.get(id).type === 'number' && !Number.isFinite(Number(value))) return;
        state.values[id] = fields.get(id).type === 'number' ? Number(value) : String(value);
        state.sources[id] = source || { source: 'imported', label: '자료 불러오기', date };
        updateField(id); count += 1;
      });
      if (count) { recalculate(); state.dirty = true; }
      showWarnings(result.warnings || []);
      message(count ? `${count}개 항목을 채웠습니다. 내용을 확인한 뒤 저장해 주세요.` : '새로 채울 수 있는 자료가 없습니다. 안내 항목을 확인해 주세요.', count ? '' : 'notice');
    } catch (error) {
      if (generation === state.generation && error.name !== 'AbortError') message(`자료 조회 실패: ${error.message}`, 'error');
    } finally { if (generation === state.generation) setBusy(''); }
  }

  async function save() {
    if (!state.loaded || state.busy || state.invalid.size || state.conflict) return;
    const date = state.date;
    const generation = state.generation;
    setBusy('save'); message(`${date} 자료를 저장하고 있습니다…`);
    try {
      const result = await request(API, {
        method: state.version ? 'PUT' : 'POST',
        body: JSON.stringify({ workDate: date, schemaVersion: 1, version: state.version, values: state.values, sources: state.sources, note: state.note })
      });
      if (generation !== state.generation) return;
      if (!result.item || result.item.workDate !== date || !Number.isInteger(Number(result.version || result.item.version))) throw new Error('저장 결과를 확인할 수 없습니다. 저장자료를 다시 확인해 주세요.');
      state.version = Number(result.version || result.item.version);
      state.hasRecord = true;
      state.values = { ...result.item.values }; state.sources = { ...result.item.sources };
      state.note = result.item.note || ''; state.dirty = false; state.edited.clear();
      fillForm(); message(`${date} 자료를 저장했습니다.`, 'success'); loadArchive(state.archiveMonth);
    } catch (error) {
      if (generation !== state.generation || error.name === 'AbortError') return;
      if (error.status === 409) state.conflict = true;
      message(`저장 실패: ${error.message} 입력한 내용은 유지되어 있습니다.`, 'error');
    } finally { if (generation === state.generation) setBusy(''); }
  }

  async function loadArchive(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) return;
    state.archiveMonth = month; byId('dailyOperationMonth').value = month;
    const sequence = ++state.archiveSequence;
    byId('dailyOperationListStatus').textContent = '저장목록 조회 중…';
    state.items = []; renderArchive();
    try {
      const result = await request(`${API}?month=${encodeURIComponent(month)}&limit=100`);
      if (sequence !== state.archiveSequence) return;
      state.items = Array.isArray(result.items) ? result.items.filter(item => validDate(item.workDate) && item.workDate.slice(0, 7) === month) : [];
      byId('dailyOperationListStatus').textContent = state.items.length ? `${state.items.length}일 저장됨` : '이 달의 저장자료가 없습니다.';
      renderArchive();
    } catch (error) {
      if (sequence === state.archiveSequence) byId('dailyOperationListStatus').textContent = `목록 조회 실패: ${error.message}`;
    }
  }

  function renderArchive() {
    const list = byId('dailyOperationList'); if (!list) return;
    list.replaceChildren();
    state.items.forEach(item => {
      const entry = node('div', { class: `dor-record${item.workDate === state.date ? ' is-active' : ''}` });
      const open = button('open-record', '', 'dor-record-open');
      open.dataset.date = item.workDate;
      open.append(node('strong', {}, item.workDate.slice(5).replace('-', '.')), node('span', {}, `${item.updatedByName || item.authorName || '저장자료'}${item.updatedAt ? ` · ${formatTimestamp(item.updatedAt)}` : ''}`));
      if (item.workDate === state.date) open.setAttribute('aria-current', 'date');
      const remove = button('delete-record', '삭제', 'dor-record-delete');
      remove.dataset.date = item.workDate; remove.dataset.version = String(item.version);
      remove.setAttribute('aria-label', `${item.workDate} 저장자료 삭제`);
      entry.append(open, remove); list.append(entry);
    });
    updateControls();
  }

  async function deleteRecord(date, version) {
    if (state.busy || !validDate(date) || !Number.isInteger(version) || version < 1) return;
    if (!window.confirm(`${date} 일일운전현황 저장자료를 삭제할까요?${date === state.date && state.dirty ? '\n현재 입력 중인 변경 내용도 비워집니다.' : ''}`)) return;
    const generation = state.generation;
    setBusy('delete'); message(`${date} 저장자료를 삭제하고 있습니다…`);
    try {
      const result = await request(API, { method: 'DELETE', body: JSON.stringify({ workDate: date, version }) });
      if (generation !== state.generation) return;
      if (!result.deleted || result.workDate !== date) throw new Error('삭제 결과를 확인할 수 없습니다.');
      if (date === state.date) {
        state.values = {}; state.sources = {}; state.note = ''; state.version = Number(result.version);
        state.hasRecord = false; state.dirty = false; state.conflict = false; state.invalid.clear(); state.edited.clear(); fillForm();
      }
      message(`${date} 일일운전현황 저장자료를 삭제했습니다.`, 'success'); loadArchive(state.archiveMonth);
    } catch (error) {
      if (generation !== state.generation || error.name === 'AbortError') return;
      if (error.status === 409 && date === state.date) state.conflict = true;
      message(`삭제 실패: ${error.message}`, 'error'); loadArchive(state.archiveMonth);
    } finally { if (generation === state.generation) setBusy(''); }
  }

  function print() {
    if (!state.loaded || state.busy) return;
    if (state.invalid.size) { message('잘못 입력한 숫자를 수정한 뒤 인쇄해 주세요.', 'error'); return; }
    const popup = window.open('', '_blank', 'width=1100,height=900');
    if (!popup) { message('인쇄 창이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.', 'error'); return; }
    // Finalize the initial about:blank document before adding the stylesheet;
    // otherwise some Chromium builds leave the popup parser/loading unfinished.
    popup.document.open();
    popup.document.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body></body></html>');
    popup.document.close();
    popup.document.title = `일일운전현황_${state.date}`;
    // Reuse the already loaded, same-origin report CSS. This also keeps the
    // print window usable when a second stylesheet request stalls or is blocked.
    let printCss = '';
    try {
      const sourceSheet = Array.from(document.styleSheets).find(sheet => sheet.href && /\/maintenance\/daily-operation-reports\.css(?:[?#]|$)/.test(sheet.href));
      if (sourceSheet) printCss = Array.from(sourceSheet.cssRules).map(rule => rule.cssText).join('\n');
    } catch (_) { /* A cross-origin deployment may require the link fallback. */ }
    const cloned = byId('dailyOperationPaper').cloneNode(true);
    cloned.querySelectorAll('input').forEach(input => {
      const field = fields.get(input.dataset.dorField);
      const span = popup.document.createElement('span');
      span.className = `dor-print-value${field.type === 'text' ? ' dor-print-text' : ''}`;
      span.textContent = formatValue(field, state.values[input.dataset.dorField]);
      input.replaceWith(span);
    });
    popup.document.body.className = 'dor-print-document';
    popup.document.body.append(cloned);
    const openPrintDialog = () => { popup.focus(); popup.print(); };
    if (printCss) {
      const style = popup.document.createElement('style'); style.textContent = printCss;
      popup.document.head.append(style);
      popup.requestAnimationFrame(() => popup.requestAnimationFrame(openPrintDialog));
    } else {
      const link = popup.document.createElement('link'); link.rel = 'stylesheet';
      link.href = new URL('maintenance/daily-operation-reports.css', window.location.href).href;
      link.onload = openPrintDialog;
      link.onerror = () => { popup.close(); message('인쇄 양식을 불러오지 못했습니다. 다시 시도해 주세요.', 'error'); };
      popup.document.head.append(link);
    }
  }

  function handleClick(event) {
    if (checkSession()) return;
    const control = event.target.closest('[data-dor-action]');
    if (!control || control.disabled) return;
    const action = control.dataset.dorAction;
    if (action === 'previous') navigate(moveDate(-1));
    else if (action === 'next') navigate(moveDate(1));
    else if (action === 'today') navigate(today());
    else if (action === 'retry' || action === 'reload') navigate(state.date, true);
    else if (action === 'collect') collect(false);
    else if (action === 'query') collect(true);
    else if (action === 'save') save();
    else if (action === 'print') print();
    else if (action === 'refresh-list') loadArchive(state.archiveMonth);
    else if (action === 'open-record') navigate(control.dataset.date);
    else if (action === 'delete-record') deleteRecord(control.dataset.date, Number(control.dataset.version));
  }

  window.openDailyOperationReportView = function () {
    view = byId(VIEW_ID); if (!view) return;
    checkSession();
    if (!state.initialized) { render(); state.initialized = true; navigate(today()); }
    else if (!state.loaded && !state.busy) navigate(state.date || today(), true);
    else updateControls();
  };
  ['saveCurrentUser', 'clearCurrentUser'].forEach(name => {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function (...args) { const result = original.apply(this, args); checkSession(); return result; };
  });
  window.addEventListener('storage', event => { if (event.key === 'gsShiftLog.currentUser' || event.key === null) checkSession(); });
  window.addEventListener('focus', checkSession);
})();
