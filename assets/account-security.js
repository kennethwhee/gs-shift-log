(function () {
  'use strict';
  const doc = document;
  const changeForm = doc.getElementById('passwordChangeForm');
  const lookupForm = doc.getElementById('passwordLookupForm');
  const resetForm = doc.getElementById('passwordResetForm');
  const back = new URLSearchParams(location.search).get('return');
  doc.getElementById('accountBack').href = back === '/mobile/' ? '/mobile/' : '/';
  let sessionToken = '', target = null, lookupSequence = 0, sessionGeneration = 0;
  function message(id, text, error = false) { const node = doc.getElementById(id); node.textContent = text; node.dataset.error = String(error); }
  function busy(form, state) { for (const element of form.elements) element.disabled = state; }
  function clearSecrets() { for (const input of doc.querySelectorAll('input[type=password]')) input.value = ''; }
  window.addEventListener('pagehide', clearSecrets);
  window.addEventListener('pageshow', clearSecrets);
  function currentSession(employeeNo) {
    try {
      const saved = JSON.parse(localStorage.getItem('gsShiftLog.currentUser') || 'null');
      return String(saved?.employeeNo || saved?.employee_no || '') === employeeNo ? String(saved?.sessionToken || saved?.session_token || '') : '';
    } catch { return ''; }
  }
  async function request(method, body, query = '', authenticated = false, ownSession = '') {
    let response, result;
    try {
      response = await fetch('/api/account-password' + query, { method, cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...((authenticated ? sessionToken : ownSession) ? { Authorization: 'Bearer ' + (authenticated ? sessionToken : ownSession) } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      result = await response.json();
    } catch {
      const error = new Error(body?.action === 'reset'
        ? '발급 여부를 확인하지 못했습니다. 직원을 다시 조회한 뒤 필요하면 새 임시 비밀번호를 발급해 주세요.'
        : body?.action === 'change' ? '응답을 받지 못했습니다. 새 비밀번호로 로그인해 변경 여부를 확인해 주세요.'
        : '직원 정보를 확인하지 못했습니다. 다시 조회해 주세요.');
      error.code = 'RESPONSE_UNKNOWN'; throw error;
    }
    if (!response.ok || !result.ok) throw new Error(result.message || '요청을 처리하지 못했습니다.');
    return result;
  }
  changeForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (changeForm.querySelector('button').disabled) return;
    if (changeForm.elements.newPassword.value !== changeForm.elements.confirmPassword.value) {
      message('passwordChangeMessage', '새 비밀번호와 확인 값이 다릅니다.', true); return;
    }
    const body = { action: 'change', employeeNo: changeForm.elements.employeeNo.value.trim(),
      currentPassword: changeForm.elements.currentPassword.value, newPassword: changeForm.elements.newPassword.value };
    busy(changeForm, true); message('passwordChangeMessage', '비밀번호를 변경하고 있습니다.');
    try {
      const result = await request('POST', body, '', false, currentSession(body.employeeNo));
      try {
        const saved = JSON.parse(localStorage.getItem('gsShiftLog.currentUser') || 'null');
        if (String(saved?.employeeNo || saved?.employee_no || '') === body.employeeNo) localStorage.removeItem('gsShiftLog.currentUser');
      } catch { /* Server-side revocation remains authoritative. */ }
      clearSecrets(); sessionGeneration++; sessionToken = ''; target = null; doc.getElementById('passwordResetSection').hidden = true;
      message('passwordChangeMessage', result.message);
    } catch (error) { message('passwordChangeMessage', error.message, true); }
    finally { body.currentPassword = ''; body.newPassword = ''; busy(changeForm, false); }
  });
  lookupForm.elements.employeeNo.addEventListener('input', () => {
    lookupSequence++; target = null; resetForm.hidden = true; resetForm.reset();
  });
  lookupForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (lookupForm.querySelector('button').disabled) return;
    const sequence = ++lookupSequence;
    target = null; resetForm.hidden = true; resetForm.reset();
    busy(lookupForm, true); message('passwordResetMessage', '직원을 확인하고 있습니다.');
    try {
      const result = await request('GET', null, '?employeeNo=' + encodeURIComponent(lookupForm.elements.employeeNo.value.trim()), true);
      if (sequence !== lookupSequence) return;
      if (!result.isActive) throw new Error('사용 중인 계정만 초기화할 수 있습니다.');
      target = result; doc.getElementById('passwordResetTarget').textContent = `${result.name} · ${result.employeeNo}`;
      resetForm.hidden = false; message('passwordResetMessage', '대상 직원이 맞는지 확인해 주세요.');
    } catch (error) { if (sequence === lookupSequence) message('passwordResetMessage', error.message, true); }
    finally { busy(lookupForm, false); }
  });
  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!target || !resetForm.elements.confirmed.checked || resetForm.querySelector('button').disabled) return;
    const body = { action: 'reset', employeeNo: target.employeeNo, revision: target.revision, currentPassword: resetForm.elements.currentPassword.value };
    busy(resetForm, true); busy(lookupForm, true);
    try {
      GSShiftLogLoginPreferences.requireCredentialDisplay();
      const result = await request('POST', body, '', true);
      target = null; resetForm.reset(); resetForm.hidden = true;
      const issued = { temporaryCredentials: [{ employeeNo: result.employeeNo, name: result.name, temporaryPassword: result.temporaryPassword }] };
      result.temporaryPassword = '';
      message('passwordResetMessage', result.message);
      await GSShiftLogLoginPreferences.showTemporaryCredentials(issued);
    } catch (error) {
      if (error.code === 'RESPONSE_UNKNOWN') { target = null; resetForm.hidden = true; }
      message('passwordResetMessage', error.message, true);
    }
    finally { body.currentPassword = ''; resetForm.elements.currentPassword.value = ''; busy(resetForm, false); busy(lookupForm, false); }
  });
  async function validateAdministrator() {
    const generation = sessionGeneration;
    try {
      const user = JSON.parse(localStorage.getItem('gsShiftLog.currentUser') || 'null');
      const token = String(user?.sessionToken || user?.session_token || '');
      if (!token) return;
      const response = await fetch('/api/login', { cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer ' + token } });
      const result = await response.json();
      if (generation === sessionGeneration && response.ok && result.ok && result.user?.isSuperAdmin) {
        sessionToken = token; doc.getElementById('passwordResetSection').hidden = false;
        if (location.hash === '#reset') doc.getElementById('passwordResetSection').scrollIntoView();
      }
    } catch { /* Password change remains available without a session. */ }
  }
  validateAdministrator();
})();
