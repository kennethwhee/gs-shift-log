/* STRUCTURE V17 TO POWER RENDER CORE R3 START */
/* Pure Morning Meeting power-card renderer extracted from script.js.
 * No fetch, auth, storage, DB, workbook, Agent or Excel ownership lives here.
 * Reviewed original block SHA256 (LF-normalized): 8bd09c6e384e25e2afaa788a5d8a50c84a45cd51a325ee0293b67b34f7db3400
 */
(function installGSToNightPowerRenderCore(global){
  if(!global) return;
  const version='20260927-structure-v17-r3';
  if(global.GSToNightPowerRenderCore?.version===version) return;
  function renderDailyPower(input){
    if(!input||typeof input!=='object') throw new TypeError('TO power render input is required.');
    const {
      elements,
      hideValues,
      formatAmount,
      solarDailyGeneration,
      solarMonthlyCumulative,
      solarYearlyCumulative,
      generatorEcmsGen1,
      ismartReception,
      epowerTransmission
    }=input;
    if(!elements||typeof elements!=='object') throw new TypeError('TO power render elements are required.');
    if(typeof formatAmount!=='function') throw new TypeError('TO power formatAmount is required.');

        if (
          elements.solarDailyGeneration
        ) {
          elements.solarDailyGeneration.textContent =
            hideValues
              ? "-"
              : formatAmount(
                  solarDailyGeneration,
                  "kWh"
                );
        }


        if (
          elements.solarMonthlyCumulative
        ) {
          elements.solarMonthlyCumulative.textContent =
            hideValues
              ? "-"
              : formatAmount(
                  solarMonthlyCumulative,
                  "kWh"
                );
        }


        if (
          elements.solarYearlyCumulative
        ) {
          elements.solarYearlyCumulative.textContent =
            hideValues
              ? "-"
              : formatAmount(
                  solarYearlyCumulative,
                  "kWh"
                );
        }


        if (
          elements.generatorEcmsGen1
        ) {
          elements.generatorEcmsGen1.textContent =
            hideValues
              ? "-"
              : formatAmount(
                  generatorEcmsGen1,
                  "kWh"
                );
        }


        if (
          elements.ismartReception
        ) {
          elements.ismartReception.textContent =
            hideValues
              ? "-"
              : formatAmount(
                  ismartReception,
                  "kWh"
                );
        }


        if (
          elements.epowerTransmission
        ) {
          elements.epowerTransmission.textContent =
            hideValues
              ? "-"
              : formatAmount(
                  epowerTransmission,
                  "kWh"
                );
        }
  }
  const api=Object.freeze({version,renderDailyPower,reviewedBlockSha256:'8bd09c6e384e25e2afaa788a5d8a50c84a45cd51a325ee0293b67b34f7db3400'});
  Object.defineProperty(global,'GSToNightPowerRenderCore',{configurable:true,enumerable:false,writable:false,value:api});
})(typeof window!=='undefined'?window:globalThis);
/* STRUCTURE V17 TO POWER RENDER CORE R3 END */

/* Night TO power entry + read-only morning-meeting provider. No Excel/Agent call.
 * R5: keep the last confirmed date/session-scoped manual record through legacy
 * synchronization, background refresh and transient errors. Never POST from sync.
 * Server-derived solar month/year cumulative values follow TO daily solar input and
 * are read-only overlays for Morning Meeting / final workbook output.
 */
(function (root) {
  'use strict';
  const FIELDS = Object.freeze([
    ['generatorEcmsGen1', '발전량', 'GeneratorEcmsGen1'],
    ['ismartReception', '수전량', 'IsmartReception'],
    ['epowerTransmission', '송전량', 'EpowerTransmission'],
    ['solarDailyGeneration', '태양광 발전량', 'SolarGeneration']
  ]);
  // TO_NIGHT_POWER_EXCEL_ORDER_V1_R3
  // Excel top-to-bottom source order: solar -> generation -> reception -> transmission.
  const FORM_FIELDS = Object.freeze([
    FIELDS.find(([key]) => key === 'solarDailyGeneration'),
    FIELDS.find(([key]) => key === 'generatorEcmsGen1'),
    FIELDS.find(([key]) => key === 'ismartReception'),
    FIELDS.find(([key]) => key === 'epowerTransmission')
  ]);
  const API = '/api/to-night-power', PREFIX = 'efficiencyMorningMeetingAutoDaily';
  const dateValid = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
  const validCumulative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 366e12;
  function parseInput(value) {
    const text = String(value ?? '').trim();
    if (!text) throw new Error('값을 입력해 주세요. 실제 사용량이 없으면 0을 입력해 주세요.');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) {
      throw new Error('0 이상의 숫자를 입력해 주세요. 쉼표는 천 단위로만 사용할 수 있습니다.');
    }
    const number = Number(text.replaceAll(',', ''));
    if (!validNumber(number)) throw new Error('입력 가능한 숫자 범위를 확인해 주세요.');
    return number;
  }
  function normalizePayload(payload, date) {
    if (!dateValid(date) || payload?.ok !== true || payload.targetDate !== date ||
        payload.shift !== 'NS' || payload.role !== 'TO' || payload.unit !== 'kWh' ||
        typeof payload.canEdit !== 'boolean' || !Object.hasOwn(payload, 'item')) {
      throw new Error('전력 응답의 날짜·근무·단위를 확인하지 못했습니다.');
    }
    const duty = payload.sourceLog;
    if (duty !== null && (!duty || typeof duty.id !== 'string' || !duty.id || !Number.isSafeInteger(duty.revision) || duty.revision < 1)) {
      throw new Error('TO 담당 업무일지 정보를 확인하지 못했습니다.');
    }
    if (payload.canEdit && !duty) throw new Error('TO 담당자를 확인하지 못했습니다.');
    const item = payload.item;
    if (item !== null && (!item || item.targetDate !== date || item.shift !== 'NS' || item.role !== 'TO' || item.unit !== 'kWh' ||
        !Number.isSafeInteger(item.revision) || item.revision < 1 || !item.values ||
        FIELDS.some(([key]) => !validNumber(item.values[key])))) {
      throw new Error('저장된 전력 자료를 확인하지 못했습니다.');
    }
    const solarCumulative = payload.solarCumulative;
    if (item === null) {
      if (solarCumulative !== null) throw new Error('저장되지 않은 날짜에 태양광 누적값이 포함되어 있습니다.');
    } else if (!solarCumulative || typeof solarCumulative !== 'object' || Array.isArray(solarCumulative) ||
        !Object.hasOwn(solarCumulative, 'monthly') || !Object.hasOwn(solarCumulative, 'yearly') ||
        (solarCumulative.monthly !== null && !validCumulative(solarCumulative.monthly)) ||
        (solarCumulative.yearly !== null && !validCumulative(solarCumulative.yearly))) {
      throw new Error('태양광 누적 자료를 확인하지 못했습니다.');
    }
    return {...payload,
      item: item === null ? null : {...item, values: Object.fromEntries(FIELDS.map(([key]) => [key, item.values[key]]))},
      solarCumulative: item === null ? null : {monthly: solarCumulative.monthly, yearly: solarCumulative.yearly}};
  }
  function acceptRefresh(previous, incoming, date) {
    const next = normalizePayload(incoming, date);
    if (!previous?.item) return next;
    const prior = normalizePayload(previous, date);
    // This feature has no delete endpoint: a missing row or an older revision is
    // not an instruction to erase a previously confirmed manual record.
    if (!next.item) throw new Error('저장된 TO 전력 자료가 재조회 응답에서 누락되었습니다. 마지막 저장값을 유지합니다.');
    if (next.item.revision < prior.item.revision) throw new Error('이전 버전의 TO 전력 응답입니다. 마지막 저장값을 유지합니다.');
    if (next.item.revision === prior.item.revision && FIELDS.some(([key]) => next.item.values[key] !== prior.item.values[key])) {
      throw new Error('TO 전력 저장 버전과 값이 일치하지 않습니다. 마지막 저장값을 유지합니다.');
    }
    return next;
  }
  function mergeValues(dailyData, payload, date, suppressed = false) {
    const source = dailyData && typeof dailyData === 'object' ? {...dailyData} : {};
    if (suppressed || !payload?.item) return source;
    const result = normalizePayload(payload, date);
    return {...source, ...result.item.values,
      ...(validCumulative(result.solarCumulative?.monthly) ? {solarMonthlyCumulative: result.solarCumulative.monthly} : {}),
      ...(validCumulative(result.solarCumulative?.yearly) ? {solarYearlyCumulative: result.solarCumulative.yearly} : {})};
  }
  if (typeof module === 'object' && module.exports) module.exports = {FIELDS, dateValid, parseInput, normalizePayload, acceptRefresh, mergeValues};
  if (!root?.document || root.toNightPower) return;
  const doc = root.document, cache = new Map(), pending = new Map();
  let session = '', generation = 0, selectionStamp = '', uiQueued = false, meetingQueued = false;
  let dialog = null, form = null, message = null, modalState = null, busy = false;
  const byId = id => doc.getElementById(id);
  const setText = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };
  const setHidden = (element, value) => { if (element && element.hidden !== value) element.hidden = value; };
  const prettyDate = date => date.replaceAll('-', '.');
  function authHeaders() {
    const headers = new Headers(typeof root.getShiftLogAuthHeaders === 'function' ? root.getShiftLogAuthHeaders() : {});
    if (!headers.get('Authorization') && typeof getShiftLogSessionToken === 'function') {
      const token = getShiftLogSessionToken();
      if (token) headers.set('Authorization', 'Bearer ' + token);
    }
    headers.set('Accept', 'application/json');
    return headers;
  }
  function checkSession() {
    const current = authHeaders().get('Authorization') || '';
    if (current !== session) {
      for (const request of pending.values()) request.controller.abort();
      cache.clear(); pending.clear(); generation++; session = current; selectionStamp = '';
      if (dialog?.open) { dialog.close(); form.reset(); modalState = null; }
      for (const button of doc.querySelectorAll('[data-to-night-power-button]')) setHidden(button, true);
    }
    return current;
  }
  function selectedDuty() {
    try {
      if (typeof appState === 'undefined') return {date: '', shift: ''};
      const date = typeof formatInputDate === 'function' ? formatInputDate(appState.selectedDate) : '';
      const shift = String(appState.selectedShift || '');
      const logs = (Array.isArray(appState.logs) ? appState.logs : []).filter(log =>
        log.date === date && log.shift === 'NS' && String(log.role || '').toUpperCase() === 'TO');
      const stamp = logs.map(log => [log.id, log.revision, log.authorId, log.updatedAt].join(':')).sort().join('|');
      return {date, shift, stamp};
    } catch { return {date: '', shift: ''}; }
  }
  function targetDate() {
    const selected = root.morningMeetingClosedCofiring?.targetDate?.();
    if (dateValid(selected)) return selected;
    const panelDate = byId('efficiencyMorningMeetingWaterPanel')?.dataset.morningMeetingAutoBaseDate;
    return dateValid(panelDate) ? panelDate : '';
  }
  function blocked(date) {
    return root.isMorningMeetingSelectedDateResetActive?.(date) === true ||
      root.morningMeetingQuerySources?.resetState?.(date)?.active === true;
  }
  async function request(date, options = {}) {
    const headers = authHeaders();
    if (!headers.get('Authorization')) throw new Error('로그인 상태를 확인해 주세요.');
    const controller = options.controller || new AbortController();
    const timer = root.setTimeout(() => controller.abort(), 15000);
    try {
      if (options.body) headers.set('Content-Type', 'application/json');
      const response = await root.fetch(API + (options.body ? '' : '?date=' + encodeURIComponent(date)), {
        method: options.body ? 'POST' : 'GET', headers, credentials: 'same-origin', cache: 'no-store',
        signal: controller.signal, ...(options.body ? {body: JSON.stringify(options.body)} : {})
      });
      const raw = await response.text();
      if (raw.length > 100000) throw new Error('전력 서버 응답이 너무 큽니다.');
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('전력 서버 응답을 읽지 못했습니다.'); }
      if (!response.ok || data.ok === false) {
        const error = new Error(data.message || '전력 자료 조회·저장에 실패했습니다.');
        error.status = response.status; throw error;
      }
      return normalizePayload(data, date);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('전력 요청 시간이 초과되었거나 취소되었습니다. 다시 시도해 주세요.');
      throw error;
    } finally { root.clearTimeout(timer); }
  }
  function load(date, force = false) {
    checkSession();
    if (!dateValid(date) || !session) return Promise.reject(new Error('날짜 또는 로그인 상태를 확인해 주세요.'));
    if (pending.has(date)) return pending.get(date).promise;
    const entry = cache.get(date);
    if (!force && entry?.status === 'ready' && Date.now() - entry.at < 30000) return Promise.resolve(entry.payload);
    const ownGeneration = generation, ownSession = session, controller = new AbortController();
    const previous = entry?.payload?.item ? entry.payload : null;
    cache.set(date, {status: 'loading', ...(previous ? {payload: previous, at: entry.at} : {})});
    const job = {controller, promise: null};
    job.promise = request(date, {controller}).then(payload => {
      checkSession();
      if (generation !== ownGeneration || session !== ownSession || pending.get(date) !== job) {
        throw new Error('로그인 또는 조회 상태가 변경되었습니다.');
      }
      const accepted = acceptRefresh(previous, payload, date);
      cache.set(date, {status: 'ready', payload: accepted, at: Date.now()});
      return accepted;
    }).catch(error => {
      if (generation === ownGeneration && pending.get(date) === job) {
        // Never retain protected values after the server rejects authentication.
        const retain = previous && error.status !== 401 && error.status !== 403;
        cache.set(date, {status: 'error', error: error.message,
          ...(retain ? {payload: previous, at: entry.at} : {})});
      }
      throw error;
    }).finally(() => {
      if (pending.get(date) === job) pending.delete(date);
      queueUI(); redrawMeeting();
    });
    pending.set(date, job);
    return job.promise;
  }
  function queueUI() {
    if (uiQueued) return;
    uiQueued = true; queueMicrotask(() => { uiQueued = false; syncCard(); });
  }
  function paintInputButton(button, entry, eligible) {
    const ready = eligible && entry?.status === 'ready' && entry?.payload?.canEdit === true;
    const checking = eligible && (!entry || entry.status === 'loading');
    const complete = ready && Boolean(entry.payload.item);
    setHidden(button, !(ready || checking));
    button.disabled = checking;
    button.classList.toggle('is-pending', ready && !complete);
    button.classList.toggle('is-complete', complete);
    button.classList.toggle('is-checking', checking);
    if (checking) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
    if (checking) {
      setText(button, '확인 중…');
      button.title = '저장된 전력 입력 여부를 확인하고 있습니다.';
    } else if (complete) {
      setText(button, '✓ 입력 완료');
      button.title = '전력 입력 완료 · 클릭하여 저장값 확인/수정';
    } else if (ready) {
      setText(button, '전력 입력');
      button.title = 'N/S TO 전력 실적 입력 (kWh)';
    }
  }
  function syncCard() {
    checkSession();
    const selected = selectedDuty();
    const stamp = [session, selected.date, selected.shift, selected.stamp].join('||');
    const changed = stamp !== selectionStamp;
    selectionStamp = stamp;
    const eligible = selected.shift === 'NS' && dateValid(selected.date) && Boolean(session);
    if (changed && eligible) void load(selected.date, true).catch(() => {});
    const entry = cache.get(selected.date);
    for (const card of doc.querySelectorAll('#shiftMemberGrid .shift-member-card')) {
      if (String(card.dataset.role || '').toUpperCase() !== 'TO') continue;
      let button = card.querySelector('[data-to-night-power-button]');
      if (!button) {
        button = doc.createElement('button'); button.type = 'button'; button.textContent = '전력 입력';
        button.className = 'to-night-power-button'; button.dataset.toNightPowerButton = 'true'; button.hidden = true;
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void openDialog(); });
        button.addEventListener('keydown', event => { event.stopPropagation(); });
        card.classList.add('has-to-night-power'); card.appendChild(button);
      }
      paintInputButton(button, entry, eligible);
    }
  }
  function say(text, error = false) {
    setText(message, text); message?.classList.toggle('is-error', error);
  }
  function setBusy(value) {
    busy = value;
    if (!form) return;
    for (const input of form.querySelectorAll('input, button')) input.disabled = value;
    setText(byId('toNightPowerSave'), value ? '처리 중…' : '저장');
  }
  function makeDialog() {
    if (dialog) return;
    dialog = doc.createElement('dialog'); dialog.id = 'toNightPowerDialog'; dialog.className = 'to-night-power-dialog';
    dialog.setAttribute('aria-labelledby', 'toNightPowerTitle');
    dialog.innerHTML = `<form novalidate>
      <header><div><span class="to-night-power-eyebrow">N/S · TO</span><h2 id="toNightPowerTitle">전력 실적 입력</h2></div>
        <button type="button" data-close aria-label="입력창 닫기" class="to-night-power-close">×</button></header>
      <div class="to-night-power-date"><span>실적 기준일</span><strong id="toNightPowerDate"></strong></div>
      <p class="to-night-power-help">선택한 야간 근무 시작일 기준 · 단위 kWh</p>
      <div class="to-night-power-fields">${FORM_FIELDS.map(([key, label]) => `<label for="toNightPower-${key}">${label}
        <span class="to-night-power-input"><input id="toNightPower-${key}" name="${key}" type="text" inputmode="decimal"
          autocomplete="off" maxlength="32" placeholder="0" required aria-describedby="toNightPowerMessage"><span>kWh</span></span></label>`).join('')}</div>
      <p id="toNightPowerMessage" class="to-night-power-message" role="status" aria-live="polite"></p>
      <footer><button type="button" id="toNightPowerReload">저장자료 다시 불러오기</button>
        <div><button type="button" data-close>취소</button><button type="submit" id="toNightPowerSave">저장</button></div></footer>
    </form>`;
    form = dialog.querySelector('form'); doc.body.appendChild(dialog); message = byId('toNightPowerMessage');
    for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    form.addEventListener('submit', event => { event.preventDefault(); void save(); });
    form.addEventListener('input', event => event.target.removeAttribute('aria-invalid'));
    byId('toNightPowerReload').addEventListener('click', () => {
      if (busy) return;
      if (root.confirm('현재 입력 중인 값은 저장되지 않고 서버의 저장값으로 바뀝니다. 다시 불러오시겠습니까?')) void fillDialog();
    });
  }
  function closeDialog() {
    if (busy) return;
    if (modalState && isDirty() && !root.confirm('저장하지 않은 전력 입력값을 닫으시겠습니까?')) return;
    dialog.close(); modalState = null; form.reset();
  }
  function isDirty() {
    if (!modalState?.baseline) return false;
    return FORM_FIELDS.some(([key]) => form.elements.namedItem(key).value !== modalState.baseline[key]);
  }
  async function openDialog() {
    checkSession(); const selected = selectedDuty();
    if (selected.shift !== 'NS' || !dateValid(selected.date)) return;
    makeDialog(); if (dialog.open) return;
    modalState = {date: selected.date, session, payload: null, baseline: null}; form.reset();
    setText(byId('toNightPowerDate'), prettyDate(selected.date)); dialog.showModal();
    await fillDialog();
  }
  async function fillDialog() {
    const state = modalState;
    if (!state || busy) return;
    setBusy(true); say('저장자료와 TO 담당자를 확인하고 있습니다.');
    try {
      const payload = await load(state.date, true);
      if (state !== modalState || state.session !== checkSession()) return;
      if (!payload.canEdit) throw new Error('해당 날짜 N/S TO 담당자만 입력·수정할 수 있습니다.');
      state.payload = payload; state.baseline = {};
      for (const [key] of FORM_FIELDS) {
        const value = payload.item ? String(payload.item.values[key]) : '';
        form.elements.namedItem(key).value = value; form.elements.namedItem(key).removeAttribute('aria-invalid'); state.baseline[key] = value;
      }
      say(payload.item ? `저장자료를 불러왔습니다. 입력자: ${payload.item.updatedBy || 'TO 담당자'}` : '네 항목을 모두 입력해 주세요. 사용량이 없으면 0을 입력해 주세요.');
    } catch (error) { if (state === modalState) { state.payload = null; say(error.message, true); } }
    finally {
      setBusy(false);
      if (state === modalState) {
        byId('toNightPowerSave').disabled = !state.payload?.canEdit;
        if (state.payload?.canEdit) form.elements.namedItem(FORM_FIELDS[0][0]).focus();
      }
    }
  }
  async function save() {
    if (busy || !modalState?.payload?.canEdit) return;
    const state = modalState;
    if (state.session !== checkSession()) return;
    const selected = selectedDuty();
    if (selected.shift !== 'NS' || selected.date !== state.date) { say('선택한 근무가 바뀌었습니다. 입력창을 닫고 해당 N/S 카드에서 다시 열어 주세요.', true); return; }
    const values = {};
    for (const [key, label] of FORM_FIELDS) {
      const input = form.elements.namedItem(key);
      try { values[key] = parseInput(input.value); }
      catch (error) { input.setAttribute('aria-invalid', 'true'); input.focus(); say(`${label}: ${error.message}`, true); return; }
    }
    setBusy(true); say('저장하고 있습니다.');
    try {
      const payload = await request(state.date, {body: {targetDate: state.date, shift: 'NS', role: 'TO', values,
        expectedRevision: state.payload.item?.revision || 0, sourceLogId: state.payload.sourceLog.id,
        sourceLogRevision: state.payload.sourceLog.revision}});
      if (state !== modalState || state.session !== checkSession()) return;
      // A prior GET must never overwrite a successful save.
      pending.get(state.date)?.controller.abort(); pending.delete(state.date);
      cache.set(state.date, {status: 'ready', payload, at: Date.now()});
      dialog.close(); modalState = null; form.reset(); queueUI(); redrawMeeting();
    } catch (error) {
      if (state === modalState) {
        say(error.message + ' 현재 입력값은 그대로 유지됩니다.', true);
        if (error.status === 403 || error.status === 409) {
          state.payload.canEdit = false;
          const previous = cache.get(state.date);
          cache.set(state.date, {status: 'error', error: error.message,
            ...(previous?.payload?.item ? {payload: previous.payload, at: previous.at} : {})});
          queueUI(); redrawMeeting();
        }
      }
    } finally {
      setBusy(false);
      if (state === modalState) byId('toNightPowerSave').disabled = !state.payload?.canEdit;
    }
  }
  function redrawMeeting() {
    if (meetingQueued) return;
    meetingQueued = true;
    queueMicrotask(() => {
      meetingQueued = false;
      if (typeof root.renderEfficiencyMorningMeetingSteamStatus === 'function') root.renderEfficiencyMorningMeetingSteamStatus();
      renderMeeting();
    });
  }
  function renderSolarCumulative(payload) {
    const cumulative = payload?.solarCumulative;
    if (validCumulative(cumulative?.monthly)) {
      setText(byId('efficiencyMorningMeetingAutoSolarMonthlyCumulative'),
        cumulative.monthly.toLocaleString('ko-KR', {maximumFractionDigits: 6}) + ' kWh');
    }
    if (validCumulative(cumulative?.yearly)) {
      setText(byId('efficiencyMorningMeetingAutoSolarYearlyCumulative'),
        cumulative.yearly.toLocaleString('ko-KR', {maximumFractionDigits: 6}) + ' kWh');
    }
  }
  function renderMeeting() {
    checkSession();
    const card = byId(PREFIX + 'PowerCard'), date = targetDate();
    if (!card || !dateValid(date) || blocked(date)) return;
    const status = byId(PREFIX + 'PowerStatus');
    const badge = (text, state) => {
      setText(status, text);
      for (const value of ['loading', 'complete', 'error']) status?.classList.toggle('is-' + value, state === value);
    };
    let entry = cache.get(date);
    if (session && entry?.status === 'ready' && Date.now() - entry.at >= 30000) {
      void load(date, true).catch(() => {});
      entry = cache.get(date);
    }
    if (session && entry?.payload?.item && entry.status !== 'ready') {
      for (const [key, , suffix] of FIELDS) setText(byId(PREFIX + suffix), entry.payload.item.values[key].toLocaleString('ko-KR', {maximumFractionDigits: 6}) + ' kWh');
      renderSolarCumulative(entry.payload);
      setText(byId(PREFIX + 'PowerDate'), date);
      badge(entry.status === 'error' ? '재조회 실패 · 마지막 저장값 유지' : '재확인 중 · 마지막 저장값 유지', entry.status === 'error' ? 'error' : 'loading');
      card.title = `${date} N/S TO · ${entry.payload.item.updatedBy || 'TO 담당자'} · ${entry.payload.item.updatedAt || ''} · 마지막 저장값 (재확인 전)` + (entry.error ? ` · ${entry.error}` : '');
      return;
    }
    if (!session || !entry || entry.status === 'loading' || entry.status === 'error') {
      for (const [, , suffix] of FIELDS) setText(byId(PREFIX + suffix), '-');
      setText(byId(PREFIX + 'PowerDate'), date);
      badge(!session ? '로그인 필요' : entry?.status === 'error' ? 'TO 전력 재조회 필요' : 'TO 저장자료 확인 중', entry?.status === 'error' ? 'error' : session ? 'loading' : 'idle');
      if (entry?.status === 'error') card.title = entry.error;
      if (session && !entry) void load(date).catch(() => {});
      return;
    }
    if (entry.payload.item) {
      for (const [key, , suffix] of FIELDS) setText(byId(PREFIX + suffix), entry.payload.item.values[key].toLocaleString('ko-KR', {maximumFractionDigits: 6}) + ' kWh');
      renderSolarCumulative(entry.payload);
      setText(byId(PREFIX + 'PowerDate'), date);
      badge('TO 입력 완료', 'complete');
      card.title = `${date} N/S TO · ${entry.payload.item.updatedBy || 'TO 담당자'} · ${entry.payload.item.updatedAt || ''} · kWh`;
    } else {
      const hasExisting = FIELDS.some(([, , suffix]) => /\d/.test(byId(PREFIX + suffix)?.textContent || ''));
      badge(hasExisting ? 'TO 미입력 · 기존 조회값' : 'TO 미입력', hasExisting ? 'complete' : 'idle');
    }
  }
  async function refreshMeeting() {
    const date = targetDate(); if (!dateValid(date)) return;
    if (blocked(date)) { redrawMeeting(); return; }
    try { await load(date, true); } catch { /* Error is visible on the power card. */ }
  }
  async function ensureForWorkbook(date) {
    if (!dateValid(date)) throw new Error('최종 엑셀 전력 실적 기준일을 확인해 주세요.');
    if (blocked(date)) return;
    await load(date, true);
    if (targetDate() !== date) throw new Error('전력 조회 중 기준일이 바뀌었습니다. 선택일을 확인하고 다시 생성해 주세요.');
  }
  function valuesForWorkbook(dailyData, options = {}) {
    const date = options.targetDate || targetDate();
    if (options.suppressClosedValues || blocked(date)) return dailyData || {};
    checkSession(); const entry = cache.get(date);
    if (entry?.status !== 'ready') throw new Error('TO 전력 저장자료를 확인하지 못했습니다. 전력 카드에서 재조회 후 다시 생성해 주세요.');
    return mergeValues(dailyData, entry.payload, date);
  }
  root.toNightPower = {version: '20260928-v1-r6-state1', targetDate, renderMeeting, refreshMeeting, ensureForWorkbook, valuesForWorkbook,
    refreshDuty: () => { selectionStamp = ''; queueUI(); }};
  function init() {
    const original = root.updateShiftMemberCardStates;
    if (typeof original === 'function') root.updateShiftMemberCardStates = function (...args) {
      const result = original.apply(this, args); queueUI(); return result;
    };
    const clearUser = root.clearCurrentUser;
    if (typeof clearUser === 'function') root.clearCurrentUser = function (...args) {
      const result = clearUser.apply(this, args); checkSession(); queueUI(); redrawMeeting(); return result;
    };
    const grid = byId('shiftMemberGrid');
    if (grid) new MutationObserver(queueUI).observe(grid, {childList: true, subtree: true});
    const panel = byId('efficiencyMorningMeetingWaterPanel');
    if (panel) new MutationObserver(() => redrawMeeting()).observe(panel,
      {attributes: true, attributeFilter: ['data-morning-meeting-auto-base-date']});
    root.addEventListener('storage', event => {
      if (event.key === 'gsShiftLog.currentUser') { checkSession(); queueUI(); redrawMeeting(); }
    });
    root.addEventListener('focus', () => { selectionStamp = ''; queueUI(); void refreshMeeting(); });
    // The existing app dispatches this non-bubbling event on document.
    doc.addEventListener('efficiencyMorningMeetingSteamStatusLoaded', () => { void refreshMeeting(); });
    const meetingView = byId('efficiencyMorningMeetingView');
    if (meetingView) {
      let wasVisible = !meetingView.hidden && meetingView.getClientRects().length > 0;
      new MutationObserver(() => {
        const visible = !meetingView.hidden && meetingView.getClientRects().length > 0;
        if (visible && !wasVisible) void refreshMeeting();
        wasVisible = visible;
      }).observe(meetingView, {attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden']});
    }
    queueUI(); redrawMeeting();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, {once: true}); else init();
})(typeof window === 'object' ? window : null);
