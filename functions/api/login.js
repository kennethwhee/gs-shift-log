import { readSecurityBody, credentials, limitPasswordAttempt, verifyPassword, SecurityInputError } from "../_shared/account-security.js";
import { loginAttachmentResponse } from "../_shared/attachment-access.js";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1e3;
const FORCED_SUPER_ADMIN_EMPLOYEE_NO = "2014081";
function jsonResponse(data, status = 200) {
  return Response.json(
    data,
    {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
function runSessionMaintenance(context, task, label) {
  const guardedTask = Promise.resolve(
    task
  ).catch(
    (error) => {
      console.warn(
        `${label} 실패:`,
        error
      );
    }
  );
  if (typeof context.waitUntil === "function") {
    context.waitUntil(
      guardedTask
    );
  }
}
function normalizeEmployeeNo(value) {
  return String(
    value || ""
  ).trim().replace(
    /\s+/g,
    ""
  );
}
function normalizeRole(value, employeeNo = "") {
  if (normalizeEmployeeNo(
    employeeNo
  ) === FORCED_SUPER_ADMIN_EMPLOYEE_NO) {
    return "super_admin";
  }
  const role = String(
    value || ""
  ).trim().toLowerCase().replace(
    /[\s-]+/g,
    "_"
  );
  if ([
    "super_admin",
    "superadmin",
    "최고관리자"
  ].includes(
    role
  )) {
    return "super_admin";
  }
  if ([
    "team_manager",
    "teammanager",
    "팀장"
  ].includes(
    role
  )) {
    return "team_manager";
  }
  if ([
    "admin",
    "leader",
    "파트장"
  ].includes(
    role
  )) {
    return "admin";
  }
  return "user";
}
function resolveLoginRole(user) {
  const source = user && typeof user === "object" ? user : {};
  const employeeNo = normalizeEmployeeNo(
    source.employee_no || source.employeeNo
  );
  const accountRole = normalizeRole(
    source.role,
    employeeNo
  );
  const employeeRole = normalizeRole(
    source.default_role ?? source.defaultRole,
    employeeNo
  );
  if (accountRole === "super_admin" || employeeRole === "super_admin") {
    return "super_admin";
  }
  if (accountRole === "team_manager" || employeeRole === "team_manager") {
    return "team_manager";
  }
  if (accountRole === "admin" || employeeRole === "admin") {
    return "admin";
  }
  return "user";
}
function getAdminLevel(role) {
  if (role === "super_admin") {
    return 2;
  }
  if (role === "admin") {
    return 1;
  }
  return 0;
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(
      byte
    );
  }
  return btoa(
    binary
  ).replace(
    /\+/g,
    "-"
  ).replace(
    /\//g,
    "_"
  ).replace(
    /=+$/g,
    ""
  );
}
function createSessionToken() {
  const tokenBytes = new Uint8Array(
    32
  );
  crypto.getRandomValues(
    tokenBytes
  );
  return bytesToBase64Url(
    tokenBytes
  );
}
async function hashSessionToken(sessionToken) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      String(
        sessionToken || ""
      )
    )
  );
  return Array.from(
    new Uint8Array(
      digest
    )
  ).map(
    (byte) => byte.toString(
      16
    ).padStart(
      2,
      "0"
    )
  ).join(
    ""
  );
}
function getBearerToken(request) {
  const authorization = String(
    request.headers.get(
      "Authorization"
    ) || ""
  ).trim();
  const matched = authorization.match(
    /^Bearer\s+(.+)$/i
  );
  return String(
    matched?.[1] || ""
  ).trim();
}
async function handlePost(context) {
  try {
    const { employeeNo, password } = credentials(await readSecurityBody(context.request));
    const limited = await limitPasswordAttempt(context, employeeNo);
    if (limited) return limited;
    const db = context.env.DB;
    const user = await db.prepare(`SELECT account.*, COALESCE(employee.default_role, '') AS default_role,
      COALESCE(employee.position, '') AS position FROM users account
      LEFT JOIN employees employee ON employee.employee_no = account.employee_no
      WHERE account.employee_no = ? LIMIT 1`).bind(employeeNo).first();
    const matched = await verifyPassword(password, Number(user?.is_active) === 1 ? user.password_hash : null);
    if (!matched || !user || Number(user.is_active) !== 1) {
      return jsonResponse({ ok: false, message: "사번 또는 비밀번호가 올바르지 않습니다." }, 401);
    }
    if (password === employeeNo || user.password_hash.startsWith("pbkdf2-temp$")) {
      return jsonResponse({
        ok: false,
        code: "PASSWORD_CHANGE_REQUIRED",
        message: password === employeeNo
          ? "사번을 비밀번호로 쓰던 계정입니다. 최고관리자에게 임시 비밀번호 발급을 요청하거나, 이미 로그인된 본인 화면에서 비밀번호를 변경해 주세요."
          : "비밀번호 설정·변경에서 임시 비밀번호를 입력하고 새 비밀번호를 설정해 주세요."
      }, 403);
    }
    const role = resolveLoginRole(user);
    const employeeDefaultRole = normalizeRole(user.default_role, user.employee_no);
    const isTeamManager = role === "team_manager";
    const sessionToken = createSessionToken();
    const tokenHash = await hashSessionToken(sessionToken);
    const currentTime = /* @__PURE__ */ new Date();
    const currentTimeText = currentTime.toISOString();
    const expiresAt = new Date(currentTime.getTime() + SESSION_DURATION_MS).toISOString();
    const results = await db.batch([
      db.prepare(`INSERT INTO shift_log_sessions(token_hash, employee_no, expires_at, created_at, last_used_at)
        SELECT ?, ?, ?, ?, ? FROM users u LEFT JOIN employees e ON e.employee_no = u.employee_no
        WHERE u.employee_no = ? AND u.is_active = 1 AND u.password_hash = ? AND u.role IS ?
          AND COALESCE(e.default_role, '') = ?`).bind(tokenHash, employeeNo, expiresAt, currentTimeText, currentTimeText, employeeNo, user.password_hash, user.role, user.default_role),
      db.prepare(`UPDATE users SET last_login_at = ? WHERE employee_no = ? AND EXISTS
        (SELECT 1 FROM shift_log_sessions WHERE token_hash = ?)`).bind(currentTimeText, employeeNo, tokenHash)
    ]);
    if (Number(results[0]?.meta?.changes) !== 1) {
      return jsonResponse({ ok: false, message: "계정 정보가 변경되었습니다. 다시 로그인해 주세요." }, 409);
    }
    runSessionMaintenance(context, db.prepare("DELETE FROM shift_log_sessions WHERE expires_at <= ?").bind(currentTimeText).run(), "만료 로그인 세션 정리");
    const position = String(user.position || "").trim();
    const responseUser = {
      id: Number(user.id),
      employeeNo,
      employee_no: employeeNo,
      name: String(user.name || "").trim(),
      role,
      defaultRole: employeeDefaultRole,
      default_role: employeeDefaultRole,
      position,
      jobPosition: position,
      job_position: position,
      adminLevel: getAdminLevel(role),
      isAdmin: role === "admin" || role === "super_admin",
      isTeamManager,
      is_team_manager: isTeamManager,
      isSuperAdmin: role === "super_admin",
      lastLoginAt: currentTimeText,
      sessionToken,
      sessionExpiresAt: expiresAt
    };
    return jsonResponse({ ok: true, message: `${user.name}님, 로그인되었습니다.`, user: responseUser, sessionToken, expiresAt });
  } catch (error) {
    if (error instanceof SecurityInputError) return jsonResponse({ ok: false, message: error.message }, error.status);
    console.error("로그인 처리 실패");
    return jsonResponse({ ok: false, message: "로그인 처리 중 오류가 발생했습니다." }, 500);
  }
}
async function handleDelete(context) {
  try {
    const sessionToken = getBearerToken(
      context.request
    );
    if (sessionToken) {
      const tokenHash = await hashSessionToken(
        sessionToken
      );
      await context.env.DB.prepare(`
          DELETE FROM shift_log_sessions
          WHERE token_hash = ?
        `).bind(
        tokenHash
      ).run();
    }
    return jsonResponse({
      ok: true,
      message: "로그아웃되었습니다."
    });
  } catch (error) {
    console.error(
      "로그아웃 처리 오류:",
      error
    );
    return jsonResponse(
      {
        ok: false,
        message: "로그아웃 처리 중 오류가 발생했습니다."
      },
      500
    );
  }
}
async function handleGet(context) {
  try {
    if (!context.env.DB) {
      return jsonResponse(
        {
          ok: false,
          authenticated: false,
          message: "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      );
    }
    const sessionToken = getBearerToken(
      context.request
    );
    if (!sessionToken) {
      return jsonResponse(
        {
          ok: false,
          authenticated: false,
          message: "로그인이 필요합니다."
        },
        401
      );
    }
    const tokenHash = await hashSessionToken(
      sessionToken
    );
    const session = await context.env.DB.prepare(`
          SELECT
            session.employee_no,
            session.expires_at,
            user.name,
            user.role,
            user.is_active,
            COALESCE(
              employee.default_role,
              ''
            ) AS default_role,
            COALESCE(
              employee.position,
              ''
            ) AS position
          FROM shift_log_sessions AS session
          INNER JOIN users AS user
            ON user.employee_no =
               session.employee_no
          LEFT JOIN employees AS employee
            ON employee.employee_no =
               session.employee_no
          WHERE session.token_hash = ?
          LIMIT 1
        `).bind(
      tokenHash
    ).first();
    const now = /* @__PURE__ */ new Date();
    const expiresAt = new Date(
      session?.expires_at || 0
    );
    if (!session || Number(
      session.is_active
    ) !== 1 || Number.isNaN(
      expiresAt.getTime()
    ) || expiresAt <= now) {
      runSessionMaintenance(
        context,
        context.env.DB.prepare(`
            DELETE FROM shift_log_sessions
            WHERE token_hash = ?
          `).bind(
          tokenHash
        ).run(),
        "만료 로그인 세션 삭제"
      );
      return jsonResponse(
        {
          ok: false,
          authenticated: false,
          message: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
        },
        401
      );
    }
    const role = resolveLoginRole({
      employee_no: session.employee_no,
      role: session.role,
      default_role: session.default_role
    });
    const position = String(
      session.position || ""
    ).trim();
    runSessionMaintenance(
      context,
      context.env.DB.prepare(`
          UPDATE shift_log_sessions
          SET last_used_at = ?
          WHERE token_hash = ?
        `).bind(
        now.toISOString(),
        tokenHash
      ).run(),
      "로그인 세션 사용시각 기록"
    );
    return jsonResponse({
      ok: true,
      authenticated: true,
      expiresAt: session.expires_at,
      user: {
        employeeNo: String(
          session.employee_no || ""
        ).trim(),
        employee_no: String(
          session.employee_no || ""
        ).trim(),
        name: String(
          session.name || ""
        ).trim(),
        role,
        defaultRole: normalizeRole(
          session.default_role,
          session.employee_no
        ),
        default_role: normalizeRole(
          session.default_role,
          session.employee_no
        ),
        position,
        jobPosition: position,
        job_position: position,
        adminLevel: getAdminLevel(
          role
        ),
        isAdmin: role === "admin" || role === "super_admin",
        isTeamManager: role === "team_manager",
        is_team_manager: role === "team_manager",
        isSuperAdmin: role === "super_admin"
      }
    });
  } catch (error) {
    console.error(
      "로그인 세션 확인 오류:",
      error
    );
    return jsonResponse(
      {
        ok: false,
        authenticated: false,
        message: "로그인 세션을 확인하지 못했습니다."
      },
      500
    );
  }
}
async function onRequestGet(context) {
  return loginAttachmentResponse(context, handleGet);
}
async function onRequestPost(context) {
  return loginAttachmentResponse(context, handlePost);
}
async function onRequestDelete(context) {
  return loginAttachmentResponse(context, handleDelete);
}
export {
  onRequestDelete,
  onRequestGet,
  onRequestPost
};
