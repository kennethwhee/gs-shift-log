/* BCO1 scheduled Blower refresh: page/login adapter, no persistent Excel. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root.document) api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const AUTH_KEY = 'gsShiftLog.currentUser';
  const CHANGE_KEY = 'gsShiftLog.blowerSchedule.resultsChanged.v1';
  const VERSION = 'blower-schedule-v2';
  const INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
  const DEFAULT_TIMING = {intervalHours: 24, startTime: '00:00'};
  const MOBILE = '(max-width: 700px), (max-width: 1024px) and (hover: none) and (pointer: coarse)';
  function accessError() {
    const error = new Error('로그인 상태가 변경되어 자동조회를 중단했습니다.');
    error.status = 403; error.code = 'WRITE_ACCESS_CHANGED'; return error;
  }
  function identity(root, blockedToken = '') {
    try {
      if (root.matchMedia(MOBILE).matches) return null;
      const document = root.document;
      const shell = document.getElementById('appShell');
      const login = document.getElementById('loginScreen');
      const blower = document.documentElement?.dataset?.shiftLogPage === 'blower-history';
      if (!blower && (!shell || shell.hidden || !login?.hidden)) return null;
      const user = JSON.parse(root.localStorage.getItem(AUTH_KEY) || 'null');
      const token = String(user?.sessionToken || user?.session_token || '').trim();
      const employeeNo = String(user?.employeeNo || user?.employee_no || user?.employeeId || user?.employee_id || '').trim();
      if (!token || token === blockedToken || !employeeNo) return null;
      return {token, employeeNo};
    } catch (_) { return null; }
  }
  function createApi(root, readIdentity) {
    const active = new Set();
    const assert = token => { if (!token || readIdentity()?.token !== token) throw accessError(); };
    async function request(options = {}, token) {
      assert(token);
      const url = new URL(options.url || '/api/blower-history', root.location.origin);
      if (url.origin !== root.location.origin || !['/api/blower-history', '/api/ois-data-requests'].includes(url.pathname)) {
        throw new Error('자동조회 API 경로가 올바르지 않습니다.');
      }
      const abort = new root.AbortController();
      const entry = {token, abort}; active.add(entry);
      const timer = root.setTimeout(() => abort.abort(), Math.max(1000, Math.min(60000, Number(options.timeoutMs) || 30000)));
      try {
        const response = await root.fetch(url.href, {
          method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          headers: {Accept:'application/json', Authorization:`Bearer ${token}`, 'X-GS-Client-Mode':'desktop',
            ...(options.body ? {'Content-Type':'application/json'} : {})},
          body: options.body ? JSON.stringify(options.body) : undefined, signal: abort.signal
        });
        assert(token);
        const body = await response.json();
        assert(token);
        if (!response.ok || body?.ok === false) {
          const error = new Error(body?.message || '자동조회 요청을 처리하지 못했습니다.');
          error.status = response.status; error.code = body?.code || 'HTTP_ERROR'; throw error;
        }
        return body;
      } catch (error) {
        assert(token);
        if (error?.name === 'AbortError') {
          const timeout = new Error('자동조회 응답 대기시간을 초과했습니다.');
          timeout.status = 0; timeout.code = 'REQUEST_TIMEOUT'; throw timeout;
        }
        throw error;
      } finally { root.clearTimeout(timer); active.delete(entry); }
    }
    request.invalidate = (all = false) => {
      const current = readIdentity()?.token;
      for (const entry of active) if (all || entry.token !== current) entry.abort.abort();
    };
    return request;
  }
  function formatKst(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '확인 중';
    return new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(date);
  }
  function timingValue(value) {
    if (!value || !INTERVAL_HOURS.includes(value.intervalHours) ||
        typeof value.startTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.startTime)) return null;
    return {intervalHours: value.intervalHours, startTime: value.startTime};
  }
  function sameTiming(left, right) {
    return Boolean(left && right && left.intervalHours === right.intervalHours && left.startTime === right.startTime);
  }
  function timingText(value) {
    const timing = timingValue(value);
    if (!timing) return {summary: '자동조회 시각 확인 중', preview: ''};
    const period = timing.intervalHours * 60;
    const [hour, minute] = timing.startTime.split(':').map(Number);
    const first = (hour * 60 + minute) % period;
    const slots = [];
    for (let at = first; at < 1440; at += period) {
      slots.push(String(Math.floor(at / 60)).padStart(2, '0') + ':' + String(at % 60).padStart(2, '0'));
    }
    return {
      summary: timing.intervalHours === 24 ? `매일 ${timing.startTime} · 1회` : `매일 ${timing.intervalHours}시간 간격 · ${slots.length}회`,
      preview: slots.length <= 8 ? `실행 시각 · ${slots.join(' · ')} (한국시간)`
        : `매일 ${slots[0]}부터 ${timing.intervalHours}시간 간격 (${slots.at(-1)}까지) · 한국시간`
    };
  }
  function install(root) {
    if (root.__blowerScheduleBrowserV1) return;
    root.__blowerScheduleBrowserV1 = true;
    const document = root.document;
    let controller, timer, blockedToken = '', lastBusy = false, paused = false;
    let draftOwner = '', draftDirty = false, settingsPending = false, settingsNotice = '';
    let draft = {...DEFAULT_TIMING};
    const readIdentity = () => identity(root, blockedToken);
    const api = createApi(root, readIdentity);
    const byId = id => document.getElementById(id);
    const text = (id, value) => { const el = byId(id); if (el && el.textContent !== value) el.textContent = value; };
    function changed() {
      root.dispatchEvent(new root.Event('gs-blower-schedule-complete'));
      try { root.localStorage.setItem(CHANGE_KEY, String(Date.now())); } catch (_) {}
    }
    function render(snapshot = {}) {
      const identityNow = readIdentity();
      const loggedIn = Boolean(identityNow);
      const owner = identityNow ? `${identityNow.employeeNo}\n${identityNow.token}` : '';
      if (owner !== draftOwner) {
        draftOwner = owner; draftDirty = false; settingsNotice = ''; draft = {...DEFAULT_TIMING};
      }
      const panel = byId('blowerSchedulePanel');
      if (panel) panel.hidden = !loggedIn;
      const status = snapshot.status || {};
      const here = status.enabled === true && status.thisDevice === true;
      const confirmedTiming = timingValue(status.timing);
      const ready = status.version === VERSION && Boolean(confirmedTiming) && Number.isInteger(status.revision);
      const editable = loggedIn && ready && (status.thisDevice === true || status.revision === 0);
      if (!draftDirty && !settingsPending && confirmedTiming) draft = {...confirmedTiming};
      const interval = byId('blowerScheduleInterval'), startTime = byId('blowerScheduleTime');
      if (interval) {
        if (!draftDirty && !settingsPending) interval.value = String(draft.intervalHours);
        interval.disabled = !editable || Boolean(snapshot.busy) || settingsPending;
      }
      if (startTime) {
        if (!draftDirty && !settingsPending) startTime.value = draft.startTime;
        startTime.disabled = !editable || Boolean(snapshot.busy) || settingsPending;
      }
      text('blowerScheduleCadence', timingText(confirmedTiming).summary);
      text('blowerSchedulePreview', timingValue(draft) ? timingText(draft).preview : '조회 주기와 시각을 확인해 주세요.');
      const save = byId('blowerScheduleSave');
      if (save) {
        save.hidden = !loggedIn || status.thisDevice !== true;
        save.disabled = !editable || Boolean(snapshot.busy) || settingsPending || !draftDirty || !timingValue(draft);
      }
      text('blowerScheduleDraftStatus', settingsNotice || (draftDirty ? '저장 전 설정입니다.' :
        !ready ? '현재 설정을 확인 중입니다.' : status.thisDevice === true ? '저장한 설정은 다음 예약부터 적용됩니다.' :
          status.revision === 0 ? '주기와 시각을 선택한 뒤 BCO1 지정을 눌러 주세요.' : '시간 설정은 지정된 BCO1 브라우저에서 변경할 수 있습니다.'));
      const errorText = snapshot.error ? snapshot.message || (typeof snapshot.error === 'string' ? snapshot.error : snapshot.error?.message) || '' : '';
      text('blowerScheduleState', !loggedIn ? '로그인 후 설정' : here ? '이 PC에서 자동조회 사용 중' :
        status.enabled ? '다른 브라우저가 BCO1으로 지정됨' : '자동조회 꺼짐');
      text('blowerScheduleNext', here ? '다음 예약 · ' + formatKst(status.nextSlotAt) : 'BCO1 PC에서 한 번 지정해 주세요.');
      text('blowerScheduleProgress', errorText || snapshot.message || (snapshot.busy ? '자동조회 진행 중' : ''));
      const latest = status.latestSlot;
      const names = {running:'진행 중', complete:'완료', partial:'부분 완료', failed:'실패', interrupted:'중단'};
      text('blowerScheduleLast', latest ? '최근 예약 · ' + formatKst(latest.slotKey) + ' · ' + (names[latest.state] || '확인 필요') +
        (Number.isInteger(latest.completedCount) ? ' · 반영 ' + latest.completedCount + '건' : '') : '예약 실행 기록 없음');
      const register = byId('blowerScheduleRegister'), disable = byId('blowerScheduleDisable');
      if (register) { register.hidden = !loggedIn || here; register.disabled = Boolean(snapshot.busy) || settingsPending || !ready || !timingValue(draft); }
      if (disable) { disable.hidden = !loggedIn || !here; disable.disabled = Boolean(snapshot.busy) || settingsPending; }
      const menu = byId('blowerScheduleMenuStatus');
      if (menu) {
        /* 햄버거 메뉴 보조 문구는 자동조회가 실제 설정된 경우에만 표시한다. */
        menu.hidden = !loggedIn || status.enabled !== true;
        menu.textContent = snapshot.busy ? '자동조회 진행 중' : errorText ? '자동조회 확인 필요' : here ?
          '자동조회 예약 · ' + formatKst(status.nextSlotAt) : 'BCO1 자동조회 사용 중';
      }
      if (lastBusy && !snapshot.busy) changed();
      lastBusy = Boolean(snapshot.busy);
    }
    function showError(error) {
      const snapshot = controller?.snapshot() || {};
      render({...snapshot, error: 'SCHEDULE_ADAPTER_ERROR', message: error?.message || '자동조회 설정을 확인해 주세요.'});
    }
    function tick() {
      if (paused || !controller) return;
      api.invalidate();
      Promise.resolve(controller.tick()).catch(showError);
      render(controller.snapshot());
    }
    function start() {
      if (!root.BlowerScheduleV1 || !root.BlowerUnifiedRefresh) {
        text('blowerScheduleProgress', '자동조회 모듈을 불러오지 못했습니다. Ctrl+F5로 새로고침해 주세요.'); return;
      }
      let storage;
      try { storage = root.localStorage; storage.getItem(AUTH_KEY); }
      catch (_) { text('blowerScheduleProgress', '브라우저 저장소를 사용할 수 없어 자동조회를 시작하지 못했습니다.'); return; }
      paused = false;
      controller = root.BlowerScheduleV1.createController({
        core: root.BlowerUnifiedRefresh, api, storage, locks: root.navigator.locks,
        identity: readIdentity, clock: Date.now, monotonicNow: () => root.performance.now(),
        randomKey: () => Array.from(root.crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2,'0')).join(''),
        onState: render, sleep: ms => new Promise(resolve => root.setTimeout(resolve, ms))
      });
      tick(); timer = root.setInterval(tick, 15000);
    }
    function ready() {
      const readDraft = () => timingValue({
        intervalHours: Number(byId('blowerScheduleInterval')?.value),
        startTime: byId('blowerScheduleTime')?.value
      });
      const draftChanged = () => {
        if (!controller || settingsPending) return;
        const snapshot = controller.snapshot(), status = snapshot.status || {};
        if (!readIdentity() || snapshot.busy || status.version !== VERSION ||
            !(status.thisDevice === true || status.revision === 0)) return;
        draft = {intervalHours: Number(byId('blowerScheduleInterval')?.value), startTime: byId('blowerScheduleTime')?.value || ''};
        draftDirty = !sameTiming(timingValue(draft), timingValue(status.timing));
        settingsNotice = '';
        render(snapshot);
      };
      for (const id of ['blowerScheduleInterval', 'blowerScheduleTime']) {
        byId(id)?.addEventListener('input', draftChanged);
        byId(id)?.addEventListener('change', draftChanged);
      }
      async function saveTiming(register) {
        const snapshot = controller?.snapshot(), status = snapshot?.status || {};
        if (!readIdentity() || !controller || snapshot.busy || settingsPending || status.version !== VERSION) return;
        const selected = readDraft();
        if (!selected || (!register && status.thisDevice !== true)) return;
        if (register && !root.confirm(`지금 사용 중인 컴퓨터가 BCO1 PC인가요?\n${timingText(selected).summary}\n${timingText(selected).preview}\n이 브라우저를 자동조회용으로 지정합니다. 기존 지정은 해제됩니다.`)) return;
        const owner = draftOwner;
        settingsPending = true; settingsNotice = '자동조회 설정을 저장 중입니다.';
        render(snapshot);
        try {
          if (register) await controller.register({confirmedPhysicalBco1: true, timing: selected});
          else await controller.configure(selected);
          const currentIdentity = readIdentity();
          if (owner !== draftOwner || !currentIdentity || `${currentIdentity.employeeNo}\n${currentIdentity.token}` !== owner) throw accessError();
          const updated = controller.snapshot();
          if (updated.status?.version !== VERSION || !sameTiming(timingValue(updated.status.timing), selected) ||
              updated.status.thisDevice !== true || (register && updated.status.enabled !== true)) {
            throw new Error('설정 저장 결과를 확인하지 못했습니다. 현재 설정을 다시 확인해 주세요.');
          }
          draft = {...selected}; draftDirty = false;
          settingsNotice = register ? 'BCO1 지정 완료 · 다음 예약부터 자동조회합니다.' :
            updated.status.enabled ? '설정 저장 완료 · 다음 예약부터 적용됩니다.' : '설정 저장 완료 · 자동조회는 꺼진 상태로 유지됩니다.';
        } catch (error) {
          if (owner === draftOwner && readIdentity() && `${readIdentity().employeeNo}\n${readIdentity().token}` === owner) {
            draftDirty = true;
            settingsNotice = error?.message || '자동조회 설정을 저장하지 못했습니다.';
          }
        } finally {
          settingsPending = false;
          render(controller.snapshot());
        }
      }
      byId('blowerScheduleRegister')?.addEventListener('click', () => saveTiming(true));
      byId('blowerScheduleSave')?.addEventListener('click', () => saveTiming(false));
      byId('blowerScheduleDisable')?.addEventListener('click', async () => {
        if (!readIdentity() || !controller || settingsPending || controller.snapshot().busy) return;
        try { await controller.disable(); } catch (error) { showError(error); }
      });
      document.addEventListener('click', event => {
        if (event.target.closest?.('#logoutButton')) {
          blockedToken = readIdentity()?.token || blockedToken;
          api.invalidate(); tick();
        }
      }, true);
      const observer = new root.MutationObserver(tick);
      for (const id of ['appShell','loginScreen']) {
        const el = byId(id); if (el) observer.observe(el, {attributes:true,attributeFilter:['hidden']});
      }
      root.addEventListener('storage', event => {
        if (event.key === CHANGE_KEY) root.dispatchEvent(new root.Event('gs-blower-schedule-complete'));
        if (event.key === AUTH_KEY || event.key === null || event.key?.startsWith('gsShiftLog.blowerSchedule.')) tick();
      });
      root.addEventListener('pagehide', () => { paused = true; root.clearInterval(timer); controller?.stop(); api.invalidate(true); });
      root.addEventListener('pageshow', event => { if (event.persisted && paused) start(); });
      root.addEventListener('online', tick);
      document.addEventListener('visibilitychange', tick);
      root.matchMedia(MOBILE).addEventListener?.('change', tick);
      start();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once:true});
    else ready();
  }
  return {identity, createApi, formatKst, timingValue, timingText, install};
});
