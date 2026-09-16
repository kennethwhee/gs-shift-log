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
  function install(root) {
    if (root.__blowerScheduleBrowserV1) return;
    root.__blowerScheduleBrowserV1 = true;
    const document = root.document;
    let controller, timer, blockedToken = '', lastBusy = false, paused = false;
    const readIdentity = () => identity(root, blockedToken);
    const api = createApi(root, readIdentity);
    const byId = id => document.getElementById(id);
    const text = (id, value) => { const el = byId(id); if (el && el.textContent !== value) el.textContent = value; };
    function changed() {
      root.dispatchEvent(new root.Event('gs-blower-schedule-complete'));
      try { root.localStorage.setItem(CHANGE_KEY, String(Date.now())); } catch (_) {}
    }
    function render(snapshot = {}) {
      const loggedIn = Boolean(readIdentity());
      const panel = byId('blowerSchedulePanel');
      if (panel) panel.hidden = !loggedIn;
      const status = snapshot.status || {};
      const here = status.enabled === true && status.thisDevice === true;
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
      if (register) { register.hidden = !loggedIn || here; register.disabled = Boolean(snapshot.busy) || !status.version; }
      if (disable) { disable.hidden = !loggedIn || !here; disable.disabled = Boolean(snapshot.busy); }
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
      byId('blowerScheduleRegister')?.addEventListener('click', async () => {
        if (!readIdentity() || !controller) return;
        if (!root.confirm('지금 사용 중인 컴퓨터가 BCO1 PC인가요?\n이 브라우저를 매일 00·04·08·12·16·20시 자동조회용으로 지정합니다. 기존 지정은 해제됩니다.')) return;
        try { await controller.register({confirmedPhysicalBco1:true}); } catch (error) { showError(error); }
      });
      byId('blowerScheduleDisable')?.addEventListener('click', async () => {
        if (!readIdentity() || !controller) return;
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
  return {identity, createApi, formatKst, install};
});
