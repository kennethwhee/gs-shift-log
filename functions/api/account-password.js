import { authenticateEmployeeRequest } from '../_shared/employee-auth.js';
import { attachmentCookies } from '../_shared/attachment-access.js';
import { securityJson as json, readSecurityBody, credentials, newPasswordError, limitPasswordAttempt,
  hashPassword, verifyPassword, sha256, randomSecret, SecurityInputError } from '../_shared/account-security.js';

const accountSql = `SELECT u.*, COALESCE(e.default_role, '') AS default_role FROM users u
  LEFT JOIN employees e ON e.employee_no = u.employee_no WHERE u.employee_no = ?`;
const conflict = () => json({ ok: false, message: '계정 정보가 변경되었습니다. 다시 확인한 후 요청해 주세요.' }, 409);
const denied = () => json({ ok: false, message: '사번 또는 비밀번호가 올바르지 않습니다.' }, 401);

export async function onRequestGet(context) {
  try {
    const auth = await authenticateEmployeeRequest(context, { write: true });
    if (auth.error) return auth.error;
    const employeeNo = new URL(context.request.url).searchParams.get('employeeNo') || '';
    if (!/^\d{6,10}$/.test(employeeNo)) return json({ ok: false, message: '대상 사번을 확인해 주세요.' }, 400);
    const account = await context.env.DB.prepare(accountSql).bind(employeeNo).first();
    if (!account) return json({ ok: false, message: '등록된 계정을 찾을 수 없습니다.' }, 404);
    return json({ ok: true, employeeNo, name: account.name, isActive: Number(account.is_active) === 1,
      revision: await sha256(String(account.password_hash || '')) });
  } catch { return json({ ok: false, message: '계정 정보를 확인하지 못했습니다.' }, 500); }
}

export async function onRequestPost(context) {
  try {
    const body = await readSecurityBody(context.request);
    if (!['change', 'reset'].includes(body.action)) return json({ ok: false, message: '요청 종류를 확인해 주세요.' }, 400);
    const db = context.env.DB;
    let employeeNo, currentPassword, actor, actorTokenHash = '', target;
    if (body.action === 'change') {
      ({ employeeNo, password: currentPassword } = credentials(body, 'currentPassword'));
      const validation = newPasswordError(body.newPassword, employeeNo, currentPassword);
      if (validation) return json({ ok: false, message: validation }, 400);
      const limited = await limitPasswordAttempt(context, employeeNo);
      if (limited) return limited;
      target = await db.prepare(accountSql).bind(employeeNo).first();
      const matched = await verifyPassword(currentPassword, Number(target?.is_active) === 1 ? target.password_hash : null);
      if (!matched || Number(target?.is_active) !== 1) return denied();
      actor = target;
      if (currentPassword === employeeNo) {
        const auth = await authenticateEmployeeRequest(context);
        if (auth.error || auth.user.employeeNo !== employeeNo) {
          return json({ ok: false, message: '사번을 비밀번호로 쓰던 계정은 이미 로그인된 본인 화면에서 변경하거나, 최고관리자에게 임시 비밀번호 발급을 요청해 주세요.' }, 403);
        }
        const token = /^Bearer\s+(.+)$/i.exec(context.request.headers.get('Authorization') || '')?.[1]?.trim();
        actorTokenHash = await sha256(token || '');
      }
    } else {
      const auth = await authenticateEmployeeRequest(context, { write: true });
      if (auth.error) return auth.error;
      employeeNo = typeof body.employeeNo === 'string' ? body.employeeNo.trim() : '';
      if (!/^\d{6,10}$/.test(employeeNo) || typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision)) {
        return json({ ok: false, message: '먼저 대상 계정을 조회해 주세요.' }, 400);
      }
      if (employeeNo === auth.user.employeeNo || employeeNo === '2014081') {
        return json({ ok: false, message: '본인 및 기본 최고관리자 계정은 비밀번호 설정·변경을 이용해 주세요.' }, 409);
      }
      ({ password: currentPassword } = credentials({ employeeNo: auth.user.employeeNo, password: body.currentPassword }));
      const limited = await limitPasswordAttempt(context, auth.user.employeeNo);
      if (limited) return limited;
      actor = await db.prepare(accountSql).bind(auth.user.employeeNo).first();
      if (!actor || !await verifyPassword(currentPassword, actor.password_hash)) return denied();
      // A default/temporary password must be changed before it can authorize another account's reset.
      if (currentPassword === actor.employee_no || actor.password_hash.startsWith('pbkdf2-temp$')) {
        return json({ ok: false, message: '먼저 본인의 비밀번호를 변경해 주세요.' }, 403);
      }
      target = await db.prepare(accountSql).bind(employeeNo).first();
      if (!target || Number(target.is_active) !== 1) return json({ ok: false, message: '사용 중인 계정만 초기화할 수 있습니다.' }, 409);
      if (body.revision !== await sha256(String(target.password_hash || ''))) return conflict();
      const token = /^Bearer\s+(.+)$/i.exec(context.request.headers.get('Authorization') || '')?.[1]?.trim();
      actorTokenHash = await sha256(token || '');
    }
    const temporaryPassword = body.action === 'reset' ? randomSecret() : '';
    const nextHash = await hashPassword(temporaryPassword || body.newPassword, Boolean(temporaryPassword));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const guard = db.prepare(`INSERT INTO auth_change_guards_v6(id, valid) SELECT ?, CASE WHEN
      EXISTS (SELECT 1 FROM users WHERE employee_no = ? AND password_hash = ? AND is_active = 1)
      AND (? = '' OR EXISTS (SELECT 1 FROM shift_log_sessions s JOIN users u ON u.employee_no = s.employee_no
        LEFT JOIN employees e ON e.employee_no = u.employee_no
        WHERE s.token_hash = ? AND s.employee_no = ? AND julianday(s.expires_at) > julianday(?)
          AND u.is_active = 1 AND u.password_hash = ? AND u.role IS ? AND COALESCE(e.default_role, '') = ?))
      THEN 1 ELSE 0 END`).bind(id, employeeNo, target.password_hash, actorTokenHash, actorTokenHash,
        actor.employee_no, now, actor.password_hash, actor.role, actor.default_role);
    try {
      await db.batch([
        guard,
        db.prepare('UPDATE users SET password_hash = ? WHERE employee_no = ?').bind(nextHash, employeeNo),
        db.prepare('DELETE FROM shift_log_sessions WHERE employee_no = ?').bind(employeeNo),
        db.prepare('DELETE FROM auth_attempt_limits_v6 WHERE key = ?').bind(await sha256('account:' + employeeNo)),
        db.prepare('INSERT INTO auth_password_audit_v6(id, employee_no, actor_employee_no, action, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(id, employeeNo, actor.employee_no, body.action, now),
        db.prepare('DELETE FROM auth_change_guards_v6 WHERE id = ?').bind(id)
      ]);
    } catch (error) {
      if (/CHECK constraint failed.*valid/i.test(String(error?.message || error))) return conflict();
      throw error;
    }
    if (temporaryPassword) return json({ ok: true, employeeNo, name: target.name, temporaryPassword,
      message: '임시 비밀번호를 발급했습니다. 대상 직원에게 전달해 주세요. 기존 로그인은 모두 해제되었습니다.' });
    return attachmentCookies(json({ ok: true,
      message: '비밀번호를 변경했습니다. 모든 기기에서 로그아웃되었습니다. 새 비밀번호로 로그인해 주세요.' }));
  } catch (error) {
    if (error instanceof SecurityInputError) return json({ ok: false, message: error.message }, error.status);
    console.error('비밀번호 변경 처리 실패');
    return json({ ok: false, message: '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
  }
}
