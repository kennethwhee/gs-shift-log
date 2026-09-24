// Employee writes require the same server-verified super-admin policy as login.
const text = value => String(value ?? "").trim();
const error = (message, status) => ({ error: Response.json({ ok: false, message }, {
  status, headers: { "Cache-Control": "no-store" }
}) });

function isSuperAdmin(role) {
  return ["super_admin", "superadmin", "최고관리자"].includes(
    text(role).toLowerCase().replace(/[\s-]+/g, "_")
  );
}

export async function authenticateEmployeeRequest(context, { write = false } = {}) {
  const token = /^Bearer\s+(.+)$/i.exec(text(context.request.headers.get("Authorization")))?.[1]?.trim();
  if (!token) return error("로그인이 필요합니다.", 401);
  if (!context.env?.DB) return error("DB 연결을 확인해 주세요.", 503);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const session = await context.env.DB.prepare(`
    SELECT s.employee_no, s.expires_at, u.is_active, u.role,
           COALESCE(e.default_role, '') AS default_role
    FROM shift_log_sessions s
    INNER JOIN users u ON u.employee_no = s.employee_no
    LEFT JOIN employees e ON e.employee_no = s.employee_no
    WHERE s.token_hash = ? LIMIT 1
  `).bind(hash).first();
  const expires = Date.parse(session?.expires_at || "");
  if (!session || Number(session.is_active) !== 1 || !Number.isFinite(expires) || expires <= Date.now()) {
    return error("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.", 401);
  }
  // The legacy fixed administrator comes from the database session, never input.
  const administrator = text(session.employee_no) === "2014081" ||
    isSuperAdmin(session.role) || isSuperAdmin(session.default_role);
  if (write && !administrator) return error("최고관리자만 직원 정보를 변경할 수 있습니다.", 403);
  return { user: { employeeNo: text(session.employee_no), isSuperAdmin: administrator, expiresAt: session.expires_at } };
}
