(function (root) {
  'use strict';
  const key = 'gsShiftLog.rememberedLogin';
  function clear() {
    try { root.localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  }
  function remember(employeeId) {
    const id = String(employeeId || '').trim();
    if (!id) { clear(); return null; }
    const value = { employeeId: id };
    try { root.localStorage.setItem(key, JSON.stringify(value)); }
    catch { clear(); }
    return value;
  }
  function read() {
    try {
      const raw = root.localStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) { clear(); return null; }
      // Rebuild using an allowlist, removing passwords saved by previous versions.
      return remember(value.employeeId);
    } catch { clear(); return null; }
  }
  function requireCredentialDisplay() {
    if (!root.document?.body || typeof root.HTMLDialogElement !== 'function' || typeof root.HTMLDialogElement.prototype.showModal !== 'function') {
      throw new Error('임시 비밀번호를 표시할 수 없습니다. 최신 브라우저에서 다시 시도해 주세요.');
    }
  }
  function showTemporaryCredentials(result) {
    const rows = Array.isArray(result?.temporaryCredentials) ? result.temporaryCredentials : [];
    if (!rows.length) return Promise.resolve();
    requireCredentialDisplay();
    const doc = root.document, dialog = doc.createElement('dialog');
    dialog.className = 'account-credentials';
    const title = doc.createElement('h2'); title.textContent = '임시 비밀번호';
    const info = doc.createElement('p');
    info.textContent = '닫으면 다시 볼 수 없습니다. 각 직원에게 본인의 정보만 전달해 주세요. 첫 로그인 전에 비밀번호 설정·변경에서 새 비밀번호를 설정해야 합니다.';
    const table = doc.createElement('table'), head = doc.createElement('tr');
    for (const label of ['사번', '이름', '임시 비밀번호']) { const th = doc.createElement('th'); th.textContent = label; head.append(th); }
    table.append(head);
    for (const row of rows) {
      const tr = doc.createElement('tr');
      for (const value of [row.employeeNo, row.name, row.temporaryPassword]) {
        const td = doc.createElement('td'); td.textContent = String(value || ''); tr.append(td);
      }
      table.append(tr); row.temporaryPassword = '';
    }
    result.temporaryCredentials = [];
    const close = doc.createElement('button'); close.type = 'button'; close.textContent = '전달 내용을 확인했습니다 · 닫기';
    dialog.append(title, info, table, close); doc.body.append(dialog);
    return new Promise(resolve => {
      const cleanup = () => { dialog.replaceChildren(); dialog.remove(); root.removeEventListener('pagehide', cleanup); resolve(); };
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', cleanup, { once: true });
      dialog.addEventListener('cancel', event => event.preventDefault());
      root.addEventListener('pagehide', cleanup, { once: true });
      dialog.showModal(); close.focus();
    });
  }
  function mountAccountLinks() {
    const doc = root.document;
    if (!doc?.querySelector) return;
    if (!doc.querySelector('link[href*="/assets/account-security.css"]')) {
      const css = doc.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/account-security.css?v=20260925-compact-account-v7'; doc.head.append(css);
    }
    const back = root.location?.pathname?.startsWith('/mobile') ? '/mobile/' : '/';
    function link(parent, text, kind, reset = false) {
      if (!parent) return;
      const a = doc.createElement('a'); a.className = 'account-security-link account-security-link--' + kind;
      const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
      const outline = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      outline.setAttribute('d', 'M7 10V7a5 5 0 0 1 10 0v3M12 14v3M6 10h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z');
      icon.append(outline);
      const label = doc.createElement('span'); label.textContent = text; a.append(icon, label);
      a.href = '/assets/account-security.html?return=' + encodeURIComponent(back) + (reset ? '#reset' : ''); parent.append(a);
    }
    const login = doc.querySelector('#loginForm, #mobileV6LoginForm');
    // Match the server and password-change page's 100-character limit.
    const loginPassword = login?.querySelector('input[type="password"]');
    if (loginPassword) loginPassword.maxLength = 100;
    link(login, '비밀번호 설정·변경', 'login');
    link(doc.getElementById('logoutButton')?.parentElement, '비밀번호 변경', 'header');
    link(doc.getElementById('employeeManagementSearch')?.parentElement, '직원 임시 비밀번호 발급', 'admin', true);
  }
  root.GSShiftLogLoginPreferences = Object.freeze({ read, remember, clear, requireCredentialDisplay, showTemporaryCredentials });
  read(); // Migrate even when an existing session opens the app without its login form.
  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mountAccountLinks, { once: true });
  else mountAccountLinks();
})(globalThis);
