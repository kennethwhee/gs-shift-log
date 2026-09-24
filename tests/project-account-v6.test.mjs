import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as login from '../functions/api/login.js';
import * as passwordApi from '../functions/api/account-password.js';
import * as employees from '../functions/api/employees.js';
import * as setup from '../functions/api/create-initial-admin.js';
import { hashPassword, verifyPassword, limitPasswordAttempt, sha256, ensureSecuritySchema } from '../functions/_shared/account-security.js';
import { accountDatabase, seedAccount, accountContext as context, digest } from './helpers/account-review-fixture.mjs';

const employeeNo = '9000002', adminNo = '9000001';
const password = '검토용 기존 비밀번호 1234', newPassword = '검토용 새 비밀번호 5678';
const oldHash = await hashPassword(password), adminHash = await hashPassword('관리자 검토용 비밀번호 1234');
const employee = { employeeNo, name: '검토 직원', defaultRole: 'user', isAllowed: true, accountSecurityVersion: 6 };
function dbFixture(t) {
  const db = accountDatabase(t);
  seedAccount(db, adminNo, adminHash, { role: 'super_admin', token: 'admin-token' });
  seedAccount(db, employeeNo, oldHash, { token: 'user-token' });
  return db;
}
const loginAs = (db, pwd = password, id = employeeNo, headers = {}) => login.onRequestPost(context(db, 'login', { body: { employeeNo: id, password: pwd }, headers }));
const change = (db, body = {}, options = {}) => passwordApi.onRequestPost(context(db, 'account-password', {
  body: { action: 'change', employeeNo, currentPassword: password, newPassword, ...body }, ...options
}));
const sessionCount = db => db.raw.prepare('SELECT count(*) n FROM shift_log_sessions WHERE employee_no=?').get(employeeNo).n;
const storedHash = db => db.raw.prepare('SELECT password_hash FROM users WHERE employee_no=?').get(employeeNo).password_hash;
async function resetBody(db, extra = {}) {
  const response = await passwordApi.onRequestGet(context(db, 'account-password?employeeNo=' + employeeNo, { method: 'GET', token: 'admin-token' }));
  assert.equal(response.status, 200);
  return { action: 'reset', employeeNo, revision: (await response.json()).revision, currentPassword: '관리자 검토용 비밀번호 1234', ...extra };
}
const reset = (db, body, token = 'admin-token') => passwordApi.onRequestPost(context(db, 'account-password', { body, token }));

test('ten concurrent account attempts are reserved atomically across Worker requests', async t => {
  const db = dbFixture(t), now = 1700000000000;
  const results = await Promise.all(Array.from({ length: 25 }, () => limitPasswordAttempt(context(db), employeeNo, now)));
  assert.equal(results.filter(r => r === null).length, 10);
  for (const r of results.filter(Boolean)) { assert.equal(r.status, 429); assert.equal(r.headers.get('Retry-After'), '300'); }
  assert.equal(db.raw.prepare('SELECT attempts FROM auth_attempt_limits_v6').get().attempts, 10);
});
test('limits expire without permanent lockout and one account does not lock another', async t => {
  const db = dbFixture(t), now = 1700000000000;
  for (let i = 0; i < 10; i++) assert.equal(await limitPasswordAttempt(context(db), employeeNo, now), null);
  assert.equal(await limitPasswordAttempt(context(db), '9000099', now), null);
  assert.equal((await limitPasswordAttempt(context(db), employeeNo, now + 299000)).headers.get('Retry-After'), '1');
  assert.equal(await limitPasswordAttempt(context(db), employeeNo, now + 300000), null);
});
test('Cloudflare source limit covers many accounts and forged forwarded headers cannot evade it', async t => {
  const db = dbFixture(t), now = 1700000000000;
  for (let i = 0; i < 60; i++) assert.equal(await limitPasswordAttempt(context(db, 'login', { headers: { 'CF-Connecting-IP': '192.0.2.10', 'X-Forwarded-For': '198.51.100.' + i } }), String(9000000 + i), now), null);
  const denied = await limitPasswordAttempt(context(db, 'login', { headers: { 'CF-Connecting-IP': '192.0.2.10', 'X-Forwarded-For': '198.51.100.200' } }), '9999999', now);
  assert.equal(denied.status, 429);
  assert.equal(await limitPasswordAttempt(context(db, 'login', { headers: { 'CF-Connecting-IP': '192.0.2.11' } }), '9999999', now), null);
  const stored = JSON.stringify(db.raw.prepare('SELECT * FROM auth_attempt_limits_v6').all());
  assert.doesNotMatch(stored, /192\.0\.2|9000002/);
});
test('malformed, oversized and cross-site authentication requests cause no database access', async t => {
  const db = dbFixture(t);
  for (const body of ['{bad', 'null', '[]', { employeeNo: 9000002, password }, { employeeNo, password: [] }, { employeeNo, password: '가'.repeat(6000) }]) {
    const r = await login.onRequestPost(context(db, 'login', { body })); assert.ok([400, 401, 413].includes(r.status));
  }
  for (const headers of [{ Origin: 'https://other.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await loginAs(db, password, employeeNo, headers)).status, 403);
    assert.equal((await change(db, {}, { headers })).status, 403);
  }
  assert.equal(db.statements.length, 0);
});
test('unknown, disabled and wrong-password login have the same public failure', async t => {
  const db = dbFixture(t); seedAccount(db, '9000003', oldHash, { active: 0 });
  const results = await Promise.all([loginAs(db, 'wrong-password'), loginAs(db, password, '9999999'), loginAs(db, password, '9000003')]);
  const bodies = [];
  for (const r of results) { assert.equal(r.status, 401); assert.equal(r.headers.getSetCookie().length, 0); bodies.push(await r.json()); }
  assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(bodies[1], bodies[2]); assert.equal(sessionCount(db), 1);
});
test('custom legacy passwords continue to log in and keep the attachment cookie contract', async t => {
  const db = dbFixture(t); const response = await loginAs(db); assert.equal(response.status, 200);
  const body = await response.json(); assert.ok(body.user.sessionToken); assert.equal(body.user.password_hash, undefined);
  assert.equal(response.headers.getSetCookie().length, 2); assert.equal(storedHash(db), oldHash);
  db.raw.prepare('UPDATE users SET role=NULL WHERE employee_no=?').run(employeeNo);
  assert.equal((await loginAs(db)).status, 200, 'legacy nullable account role remains compatible');
});
test('employee-number and temporary passwords require setup without issuing a session', async t => {
  for (const temporary of [false, true]) {
    const db = accountDatabase(t), pwd = temporary ? 'temporary-secret-for-review' : employeeNo;
    seedAccount(db, employeeNo, await hashPassword(pwd, temporary), temporary ? {} : {token:'prior-session'});
    const r = await loginAs(db, pwd); assert.equal(r.status, 403); assert.equal((await r.json()).code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal(sessionCount(db), temporary ? 0 : 1); assert.equal(r.headers.getSetCookie().length, 0);
    if (!temporary) assert.equal((await change(db, { currentPassword: pwd })).status, 403);
    assert.equal((await change(db, { currentPassword: pwd }, temporary ? {} : {token:'prior-session'})).status, 200);
    assert.equal((await loginAs(db, newPassword)).status, 200);
  }
});
test('a password change atomically revokes every session and clears attachment cookies', async t => {
  const db = dbFixture(t); db.raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?,?)').run(digest('another'), employeeNo, '2099-01-01', '', '');
  const r = await change(db); assert.equal(r.status, 200); assert.equal(sessionCount(db), 0);
  assert.ok(r.headers.getSetCookie().every(c => /Max-Age=0/.test(c)));
  assert.ok(await verifyPassword(newPassword, storedHash(db))); assert.equal(await verifyPassword(password, storedHash(db)), false);
  const audit = db.raw.prepare('SELECT * FROM auth_password_audit_v6').get();
  assert.equal(audit.action, 'change'); assert.doesNotMatch(JSON.stringify(audit), /5678|1234|pbkdf2/);
  assert.equal((await login.onRequestGet(context(db, 'login', { method: 'GET', token: 'user-token' }))).status, 401);
});
test('a known employee-number password cannot claim an account using another employee or stale session', async t => {
  const db = dbFixture(t); const initialHash = await hashPassword(employeeNo);
  db.raw.prepare('UPDATE users SET password_hash=? WHERE employee_no=?').run(initialHash, employeeNo);
  for (const token of [undefined, 'wrong-token', 'admin-token']) {
    assert.equal((await change(db, { currentPassword: employeeNo }, { token })).status, 403);
  }
  db.raw.prepare('UPDATE shift_log_sessions SET expires_at=? WHERE employee_no=?').run('2020-01-01', employeeNo);
  assert.equal((await change(db, { currentPassword: employeeNo }, { token: 'user-token' })).status, 403);
  assert.equal(storedHash(db), initialHash);
});
test('legacy default-password change cannot outlive its authorizing existing session', async t => {
  const db = dbFixture(t); const initialHash = await hashPassword(employeeNo);
  db.raw.prepare('UPDATE users SET password_hash=? WHERE employee_no=?').run(initialHash, employeeNo);
  db.hook = statements => {
    if (statements.some(s => /INSERT INTO auth_change_guards_v6/.test(s.sql))) {
      db.raw.prepare('DELETE FROM shift_log_sessions WHERE employee_no=?').run(employeeNo);
    }
  };
  assert.equal((await change(db, { currentPassword: employeeNo }, { token: 'user-token' })).status, 409);
  assert.equal(storedHash(db), initialHash);
});
test('short, repeated, unchanged and invalid new passwords cannot alter accounts', async t => {
  const db = dbFixture(t);
  for (const value of ['short', 'a'.repeat(20), password, '123456789012345', false, ['long-enough-password'], 'x'.repeat(101)]) {
    assert.equal((await change(db, { newPassword: value })).status, 400);
  }
  assert.equal(storedHash(db), oldHash); assert.equal(sessionCount(db), 1); assert.equal(db.statements.length, 0);
});
test('wrong current password and disabled accounts cannot change credentials', async t => {
  const db = dbFixture(t);
  assert.equal((await change(db, { currentPassword: 'incorrect' })).status, 401);
  db.raw.prepare('UPDATE users SET is_active=0 WHERE employee_no=?').run(employeeNo);
  assert.equal((await change(db)).status, 401); assert.equal(storedHash(db), oldHash);
});
test('concurrent password changes cannot overwrite the first committed change', async t => {
  const db = dbFixture(t);
  const responses = await Promise.all([change(db), change(db, { newPassword: '또 다른 새 비밀번호 9012' })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM auth_password_audit_v6').get().n, 1);
});
test('login cannot issue a token after password reset, deactivation or role change races verification', async t => {
  for (const action of ['password', 'active', 'role', 'employeeRole']) {
    const db = dbFixture(t);
    db.hook = statements => {
      if (!statements.some(s => /INSERT INTO shift_log_sessions/.test(s.sql))) return;
      if (action === 'password') db.raw.prepare('UPDATE users SET password_hash=? WHERE employee_no=?').run('replacement', employeeNo);
      if (action === 'active') db.raw.prepare('UPDATE users SET is_active=0 WHERE employee_no=?').run(employeeNo);
      if (action === 'role') db.raw.prepare('UPDATE users SET role=? WHERE employee_no=?').run('admin', employeeNo);
      if (action === 'employeeRole') db.raw.prepare('UPDATE employees SET default_role=? WHERE employee_no=?').run('leader', employeeNo);
    };
    const r = await loginAs(db); assert.equal(r.status, 409); assert.equal(r.headers.getSetCookie().length, 0); assert.equal(sessionCount(db), 1);
  }
});
test('password update, revocation and audit roll back together when any statement fails', async t => {
  t.mock.method(console, 'error', () => {});
  for (const failed of [/DELETE FROM shift_log_sessions/, /INSERT INTO auth_password_audit_v6/]) {
    const db = dbFixture(t); await ensureSecuritySchema(db); db.failSql = failed;
    const r = await change(db); assert.equal(r.status, 500); assert.doesNotMatch(await r.text(), /synthetic|SQL|password_hash/);
    assert.equal(storedHash(db), oldHash); assert.equal(sessionCount(db), 1); assert.equal(db.raw.prepare('SELECT count(*) n FROM auth_password_audit_v6').get().n, 0);
  }
});
test('rate limiting also applies to pre-login password change and does not revoke active sessions', async t => {
  const db = dbFixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await change(db, { currentPassword: 'incorrect' })).status, 401);
  assert.equal((await loginAs(db)).status, 429);
  assert.equal((await login.onRequestGet(context(db, 'login', { method: 'GET', token: 'user-token' }))).status, 200);
  assert.equal(sessionCount(db), 1);
});
test('new account registration returns a unique random temporary credential once and preserves existing hashes', async t => {
  const db = dbFixture(t), id = '9000099';
  let r = await employees.onRequestPost(context(db, 'employees', { token: 'admin-token', body: { ...employee, employeeNo: id } }));
  assert.equal(r.status, 201); let body = await r.json(); assert.equal(body.temporaryCredentials.length, 1);
  const secret = body.temporaryCredentials[0].temporaryPassword; assert.ok(secret.length >= 32); assert.notEqual(secret, id);
  assert.equal((await loginAs(db, secret, id)).status, 403);
  const saved = db.raw.prepare('SELECT password_hash FROM users WHERE employee_no=?').get(id).password_hash; assert.match(saved, /^pbkdf2-temp\$/);
  r = await employees.onRequestPost(context(db, 'employees', { token: 'admin-token', body: { ...employee, employeeNo: id, name: '수정 직원' } }));
  assert.deepEqual((await r.json()).temporaryCredentials, []); assert.equal(db.raw.prepare('SELECT password_hash FROM users WHERE employee_no=?').get(id).password_hash, saved);
  assert.equal(storedHash(db), oldHash); assert.match(r.headers.get('Cache-Control'), /no-store/);
});
test('an old client cannot create a new account or partly apply its bulk import', async t => {
  const db = dbFixture(t);
  const r = await employees.onRequestPost(context(db, 'employees', { token: 'admin-token', body: { employees: [{ ...employee, isAllowed: false }, { ...employee, employeeNo: '9000099' }] } }));
  assert.equal(r.status, 409); assert.equal(storedHash(db), oldHash); assert.equal(sessionCount(db), 1);
  assert.equal(db.raw.prepare('SELECT is_active FROM users WHERE employee_no=?').get(employeeNo).is_active, 1);
  assert.equal(db.raw.prepare('SELECT * FROM users WHERE employee_no=?').get('9000099'), undefined);
});
test('concurrent employee creation never reports an unused temporary password', async t => {
  const db = dbFixture(t), id = '9000099';
  const results = await Promise.all([1, 2].map(() => employees.onRequestPost(context(db, 'employees', { token: 'admin-token', body: { ...employee, employeeNo: id } }))));
  const bodies = await Promise.all(results.map(r => r.json()));
  const credentials = bodies.flatMap(r => r.temporaryCredentials); assert.equal(credentials.length, 1);
  assert.ok(await verifyPassword(credentials[0].temporaryPassword, db.raw.prepare('SELECT password_hash FROM users WHERE employee_no=?').get(id).password_hash));
});
test('reset rejects anonymous, ordinary, expired, inactive and forged-role requests', async t => {
  const db = dbFixture(t); const body = await resetBody(db, { isSuperAdmin: true, role: 'super_admin' });
  for (const token of [null, 'wrong-token', 'user-token']) assert.ok([401, 403].includes((await reset(db, body, token)).status));
  db.raw.prepare('UPDATE shift_log_sessions SET expires_at=? WHERE employee_no=?').run('invalid', adminNo);
  assert.equal((await reset(db, body)).status, 401);
  db.raw.prepare('UPDATE shift_log_sessions SET expires_at=? WHERE employee_no=?').run('2099-01-01', adminNo);
  db.raw.prepare('UPDATE users SET is_active=0 WHERE employee_no=?').run(adminNo);
  assert.equal((await reset(db, body)).status, 401); assert.equal(storedHash(db), oldHash);
});
test('administrator reset requires current password and explicit current target revision', async t => {
  const db = dbFixture(t);
  assert.equal((await reset(db, await resetBody(db, { currentPassword: 'incorrect' }))).status, 401);
  assert.equal((await reset(db, await resetBody(db, { revision: '0'.repeat(64) }))).status, 409);
  assert.equal((await reset(db, await resetBody(db, { employeeNo: adminNo }))).status, 409);
  assert.equal((await reset(db, await resetBody(db, { employeeNo: '2014081' }))).status, 409);
  assert.equal(storedHash(db), oldHash);
});
test('successful reset revokes the target only, creates a setup credential and rejects stale retries', async t => {
  const db = dbFixture(t), body = await resetBody(db);
  const r = await reset(db, body); assert.equal(r.status, 200); const issued = await r.json();
  assert.equal(sessionCount(db), 0); assert.ok(issued.temporaryPassword); assert.match(storedHash(db), /^pbkdf2-temp\$/);
  assert.equal((await reset(db, body)).status, 409);
  assert.equal((await loginAs(db, issued.temporaryPassword)).status, 403);
  assert.equal((await login.onRequestGet(context(db, 'login', { method: 'GET', token: 'admin-token' }))).status, 200);
  assert.equal((await change(db, { currentPassword: issued.temporaryPassword })).status, 200);
  assert.equal((await loginAs(db, newPassword)).status, 200);
});
test('reset final transaction rechecks administrator session, role, password and target activation', async t => {
  for (const action of ['session', 'role', 'password', 'target']) {
    const db = dbFixture(t), body = await resetBody(db);
    db.hook = statements => {
      if (!statements.some(s => /INSERT INTO auth_change_guards_v6/.test(s.sql))) return;
      if (action === 'session') db.raw.prepare('DELETE FROM shift_log_sessions WHERE employee_no=?').run(adminNo);
      if (action === 'role') db.raw.prepare('UPDATE users SET role=? WHERE employee_no=?').run('user', adminNo);
      if (action === 'password') db.raw.prepare('UPDATE users SET password_hash=? WHERE employee_no=?').run('replacement', adminNo);
      if (action === 'target') db.raw.prepare('UPDATE users SET is_active=0 WHERE employee_no=?').run(employeeNo);
    };
    assert.equal((await reset(db, body)).status, 409); assert.equal(storedHash(db), oldHash); assert.equal(sessionCount(db), 1);
  }
});
test('retired alternative provisioning endpoints perform no database action even with old secrets', async t => {
  const db = dbFixture(t);
  for (const name of ['create-user', 'employees-seed']) {
    const endpoint = await import('../functions/api/' + name + '.js');
    const r = await endpoint.onRequestPost(context(db, name, { body: employee, headers: { 'X-Setup-Key': 'old-key', 'X-Seed-Secret': 'old-secret' } }));
    assert.equal(r.status, 410);
  }
  assert.equal(db.statements.length, 0);
});
test('one-time initial setup rejects weak passwords while existing users are unaffected', async t => {
  const db = accountDatabase(t), key = 'synthetic-setup-key-at-least-32-characters';
  const ctx = context(db, 'create-initial-admin', { body: { employeeNo: adminNo, name: '관리자', password: 'short-password' }, headers: { 'X-Setup-Key': key } });
  ctx.env.USER_SETUP_KEY = key;
  assert.equal((await setup.onRequestPost(ctx)).status, 400); assert.equal(db.raw.prepare('SELECT count(*) n FROM users').get().n, 0);
});
test('database failures fail closed without returning internal details or login cookies', async t => {
  const db = dbFixture(t); t.mock.method(console, 'error', () => {}); db.failSql = /auth_attempt_limits_v6/;
  const r = await loginAs(db); assert.equal(r.status, 500); assert.doesNotMatch(await r.text(), /synthetic|SQL|pbkdf2/); assert.equal(r.headers.getSetCookie().length, 0);
});
