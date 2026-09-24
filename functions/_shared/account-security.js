// Password verification limits are shared by all Worker instances through D1.
export const ACCOUNT_SECURITY_VERSION = 6;
const encoder = new TextEncoder();
const schemas = new WeakMap();
export const securityJson = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', ...headers }
});
export class SecurityInputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function readSecurityBody(request) {
  const origin = request.headers.get('Origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new SecurityInputError('같은 사이트에서 다시 요청해 주세요.', 403);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SecurityInputError('요청 내용을 확인해 주세요.');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new SecurityInputError('요청 내용이 너무 큽니다.', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return body;
  } catch (error) {
    if (error instanceof SecurityInputError) throw error;
    throw new SecurityInputError('요청 형식이 올바르지 않습니다.');
  } finally { reader.releaseLock(); }
}

export function credentials(body, passwordField = 'password') {
  if (typeof body.employeeNo !== 'string' || typeof body[passwordField] !== 'string') {
    throw new SecurityInputError('사번과 비밀번호를 입력해 주세요.');
  }
  const employeeNo = body.employeeNo.trim();
  const password = body[passwordField];
  if (!/^\d{6,10}$/.test(employeeNo) || password.length < 4 || password.length > 100) {
    throw new SecurityInputError('사번 또는 비밀번호가 올바르지 않습니다.', 401);
  }
  return { employeeNo, password };
}

export function newPasswordError(password, employeeNo, currentPassword = '') {
  if (typeof password !== 'string' || [...password].length < 15 || password.length > 100) {
    return '새 비밀번호는 15~100자로 입력해 주세요. 띄어쓰기를 포함한 문장도 사용할 수 있습니다.';
  }
  if (password === currentPassword || password.trim() === employeeNo || /^(.)\1+$/u.test(password)) {
    return '현재 비밀번호, 사번 또는 같은 글자의 반복은 사용할 수 없습니다.';
  }
  if (['password123456789', '123456789012345', '1234567890123456', 'qwertyuiopasdfgh', 'qwertyuiopasdfghjkl'].includes(password.toLowerCase())) {
    return '쉽게 추측할 수 있는 비밀번호입니다. 다른 문장을 사용해 주세요.';
  }
  return '';
}

export async function sha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
const base64 = bytes => btoa(String.fromCharCode(...bytes));
export function randomSecret() {
  return base64(crypto.getRandomValues(new Uint8Array(24))).replace(/\+/g, '-').replace(/\//g, '_');
}
export async function hashPassword(password, temporary = false) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return [temporary ? 'pbkdf2-temp' : 'pbkdf2', 100000, base64(salt), base64(new Uint8Array(bits))].join('$');
}
const dummyHash = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
export async function verifyPassword(password, storedHash) {
  try {
    const parts = String(storedHash || dummyHash).split('$');
    if (parts.length !== 4 || !['pbkdf2', 'pbkdf2-temp'].includes(parts[0])) return false;
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000 || parts[2].length > 88 || parts[3].length !== 44) return false;
    const salt = Uint8Array.from(atob(parts[2]), ch => ch.charCodeAt(0));
    const stored = Uint8Array.from(atob(parts[3]), ch => ch.charCodeAt(0));
    if (salt.length < 16 || salt.length > 64 || stored.length !== 32) return false;
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
    let difference = 0;
    for (let i = 0; i < stored.length; i++) difference |= stored[i] ^ bits[i];
    return Boolean(storedHash) && difference === 0;
  } catch { return false; }
}

export function ensureSecuritySchema(db) {
  if (!schemas.has(db)) {
    const promise = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS auth_attempt_limits_v6 (
        key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)`),
      db.prepare('CREATE INDEX IF NOT EXISTS auth_attempt_limits_v6_expiry ON auth_attempt_limits_v6(expires_at)'),
      db.prepare('CREATE TABLE IF NOT EXISTS auth_change_guards_v6 (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid = 1))'),
      db.prepare(`CREATE TABLE IF NOT EXISTS auth_password_audit_v6 (
        id TEXT PRIMARY KEY, employee_no TEXT NOT NULL, actor_employee_no TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL)`)
    ]).catch(error => { schemas.delete(db); throw error; });
    schemas.set(db, promise);
  }
  return schemas.get(db);
}

export async function limitPasswordAttempt(context, employeeNo, now = Date.now()) {
  const db = context.env.DB;
  await ensureSecuritySchema(db);
  const buckets = [{ identity: 'account:' + employeeNo, limit: 10, duration: 300000 }];
  // Cloudflare supplies this header. Untrusted forwarded headers are never used.
  const ip = context.request.headers.get('CF-Connecting-IP');
  if (ip) buckets.unshift({ identity: 'source:' + ip, limit: 60, duration: 60000 });
  for (const bucket of buckets) {
    const key = await sha256(bucket.identity);
    const row = await db.prepare(`INSERT INTO auth_attempt_limits_v6(key, window_start, attempts, expires_at)
      VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET
        window_start = CASE WHEN expires_at <= ? THEN excluded.window_start ELSE window_start END,
        attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
        expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
      WHERE expires_at <= ? OR attempts < ? RETURNING expires_at`)
      .bind(key, now, now + bucket.duration, now, now, now, now, bucket.limit).first();
    if (!row) {
      const existing = await db.prepare('SELECT expires_at FROM auth_attempt_limits_v6 WHERE key = ?').bind(key).first();
      const seconds = Math.max(1, Math.ceil((Number(existing?.expires_at || now + bucket.duration) - now) / 1000));
      return securityJson({ ok: false, code: 'RATE_LIMITED', retryAfter: seconds,
        message: `비밀번호 확인 요청이 많습니다. ${seconds}초 후 다시 시도해 주세요.` }, 429, { 'Retry-After': String(seconds) });
    }
  }
  // Bounded cleanup; a cleanup failure must not authorize an otherwise denied request.
  if (typeof context.waitUntil === 'function') {
    context.waitUntil(db.prepare(`DELETE FROM auth_attempt_limits_v6 WHERE key IN
      (SELECT key FROM auth_attempt_limits_v6 WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)`)
      .bind(now).run().catch(() => {}));
  }
  return null;
}
