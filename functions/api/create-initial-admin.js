// Initial setup is disabled unless the existing USER_SETUP_KEY is supplied.
const json = (data, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" }
});
const ADMIN_PREDICATE = `
  lower(replace(role, '-', '_')) IN ('superadmin', 'super_admin')
  OR approved_by = 'initial-system' OR employee_no = '2014081'
`;

async function matchesSetupKey(request, env) {
  const configured = String(env?.USER_SETUP_KEY || "");
  const supplied = String(request.headers.get("X-Setup-Key") || "");
  if (configured.length < 32 || !supplied || supplied.length > 1024) return false;
  const digest = value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [left, right] = await Promise.all([digest(configured), digest(supplied)]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let different = 0;
  for (let index = 0; index < a.length; index += 1) different |= a[index] ^ b[index];
  return different === 0;
}

async function passwordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  const base64 = bytes => btoa(String.fromCharCode(...bytes));
  return ["pbkdf2", 100000, base64(salt), base64(new Uint8Array(bits))].join("$");
}

export async function onRequestPost(context) {
  try {
    if (!await matchesSetupKey(context.request, context.env)) {
      return json({ ok: false, message: "최초 관리자 생성 권한이 없습니다." }, 403);
    }
    const db = context.env?.DB;
    if (!db) return json({ ok: false, message: "DB 연결을 확인해 주세요." }, 503);
    let body;
    try { body = await context.request.json(); } catch {
      return json({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
    }
    const employeeNo = String(body?.employeeNo || "").trim();
    const name = String(body?.name || "").trim();
    const password = String(body?.password || "");
    if (!/^\d{6,10}$/.test(employeeNo) || name.length < 2 || name.length > 30 || password.length < 8 || password.length > 100) {
      return json({ ok: false, message: "사번 6~10자리, 이름 2~30자, 비밀번호 8~100자를 확인해 주세요." }, 400);
    }
    if (await db.prepare(`SELECT id FROM users WHERE ${ADMIN_PREDICATE} LIMIT 1`).first()) {
      return json({ ok: false, message: "최초 최고관리자는 이미 생성되었습니다." }, 409);
    }
    if (await db.prepare("SELECT id FROM users WHERE employee_no = ? LIMIT 1").bind(employeeNo).first()) {
      return json({ ok: false, message: "이미 등록된 사번입니다." }, 409);
    }
    const hash = await passwordHash(password);
    // A single conditional insert prevents concurrent setup requests creating two admins.
    const result = await db.prepare(`
      INSERT INTO users (employee_no, name, password_hash, role, is_active, approved_at, approved_by, created_at)
      SELECT ?, ?, ?, 'super_admin', 1, datetime('now'), 'initial-system', datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE ${ADMIN_PREDICATE})
        AND NOT EXISTS (SELECT 1 FROM users WHERE employee_no = ?)
    `).bind(employeeNo, name, hash, employeeNo).run();
    if (Number(result?.meta?.changes) !== 1) {
      return json({ ok: false, message: "최초 최고관리자 또는 같은 사번이 이미 생성되었습니다." }, 409);
    }
    return json({ ok: true, message: "최초 최고관리자 계정이 생성되었습니다.", user: {
      id: Number(result.meta.last_row_id), employeeNo, name, role: "super_admin"
    } }, 201);
  } catch (cause) {
    console.error("Initial administrator setup failed", cause);
    return json({ ok: false, message: "최초 최고관리자 생성 중 오류가 발생했습니다." }, 500);
  }
}

export function onRequestGet() {
  return json({ ok: false, message: "지원하지 않는 요청 방식입니다." }, 405);
}
