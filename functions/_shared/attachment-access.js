import { authenticateEmployeeRequest } from './employee-auth.js';

// Only these read endpoints accept a cookie. All writes still require Bearer.
export const ATTACHMENT_COOKIE = '__Secure-gsShiftLogAttachment';
const paths = ['/api/legacy-attachment', '/api/shift-log-files'];
const bearer = request => /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '')?.[1]?.trim() || '';
const failure = (message, status) => Response.json({ ok: false, success: false, message }, {
  status, headers: { 'Cache-Control': 'no-store' }
});

export function attachmentDisposition(fileName, disposition = 'inline') {
  const name = String(fileName || 'attachment').replace(/[\x00-\x1f\x7f]/g, '').replace(/[\\/]/g, '_') || 'attachment';
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name.toWellFormed()).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  return `${disposition === 'attachment' ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function attachmentCookies(response, token = '', expiresAt = '') {
  const remaining = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
  const maxAge = token && Number.isFinite(remaining) && remaining > 0 ? remaining : 0;
  const headers = new Headers(response.headers);
  for (const path of paths) {
    headers.append('Set-Cookie', `${ATTACHMENT_COOKIE}=${maxAge ? encodeURIComponent(token) : ''}; Path=${path}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`);
  }
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function attachmentContext(context) {
  const request = context.request;
  const pathname = new URL(request.url).pathname.replace(/\/$/, '');
  if (request.method !== 'GET' || !paths.includes(pathname) || request.headers.has('Authorization')) return context;
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return context;
  const matches = (request.headers.get('Cookie') || '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(ATTACHMENT_COOKIE + '='));
  if (matches.length !== 1) return context;
  let token;
  try { token = decodeURIComponent(matches[0].slice(ATTACHMENT_COOKIE.length + 1)); } catch { return context; }
  if (!token || token.length > 512 || /[\s\x00-\x1f\x7f]/.test(token)) return context;
  const headers = new Headers(request.headers);
  headers.set('Authorization', 'Bearer ' + token);
  return { ...context, request: new Request(request, { headers }) };
}

export async function protectedRequest(context, handler, policy = 'read') {
  try {
    const authenticatedContext = policy === 'attachment' ? attachmentContext(context) : context;
    const auth = await authenticateEmployeeRequest(authenticatedContext);
    if (auth.error) return auth.error;
    if (policy === 'admin' && !auth.user.isSuperAdmin) return failure('최고관리자 권한이 필요합니다.', 403);
    if (policy === 'legacy-import' && !auth.user.isSuperAdmin) {
      let body;
      try { body = await context.request.clone().json(); } catch { return failure('요청 데이터 형식이 올바르지 않습니다.', 400); }
      // The existing single-shift button is available to all signed-in staff.
      // Range/all-shift imports are administrative operations.
      if (!body || !/^\d{8}$/.test(String(body.date || '')) || body.startDate || body.endDate ||
          !['DAY', 'NIGHT'].includes(String(body.shift || '').toUpperCase())) {
        return failure('기간·전체 근무 동기화는 최고관리자만 실행할 수 있습니다.', 403);
      }
    }
    let response = await handler(authenticatedContext);
    if (response.status >= 500) return failure('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', response.status);
    if (policy === 'attachment') {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'private, no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Referrer-Policy', 'no-referrer');
      // An uploaded SVG/HTML document must never execute in the application's origin.
      headers.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      response = new Response(response.body, { status: response.status, headers });
    }
    if (policy === 'read-with-attachments' && response.ok) {
      response = attachmentCookies(response, bearer(context.request), auth.user.expiresAt);
    }
    return response;
  } catch {
    return failure('접근 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503);
  }
}

// Login still authenticates using its existing password/session implementation.
export async function loginAttachmentResponse(context, handler) {
  const response = await handler(context);
  if (context.request.method === 'DELETE') return attachmentCookies(response);
  if (!response.ok) return response;
  const result = await response.clone().json();
  if (!result.ok) return response;
  const token = context.request.method === 'POST' ? result.user?.sessionToken : bearer(context.request);
  return token ? attachmentCookies(response, token, result.expiresAt || result.user?.sessionExpiresAt) : response;
}
