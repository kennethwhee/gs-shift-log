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
  root.GSShiftLogLoginPreferences = Object.freeze({ read, remember, clear });
  read(); // Migrate even when an existing session opens the app without its login form.
})(globalThis);
