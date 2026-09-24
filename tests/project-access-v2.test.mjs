import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import * as employees from '../functions/api/employees.js';
import * as login from '../functions/api/login.js';
import * as passwordApi from '../functions/api/account-password.js';
import { ATTACHMENT_COOKIE, protectedRequest } from '../functions/_shared/attachment-access.js';

const routes = {};
for (const name of ['legacy-login','legacy-diaries','legacy-import','legacy-logs','legacy-attachment','shift-log-files','shift-logs']) {
  routes[name] = await import(`../functions/api/${name}.js`);
}
const hash = value => createHash('sha256').update(value).digest('hex');
export function createDatabase() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, employee_no TEXT UNIQUE, name TEXT, password_hash TEXT, role TEXT, is_active INTEGER, approved_at TEXT, approved_by TEXT, created_at TEXT, last_login_at TEXT);
    CREATE TABLE employees (employee_no TEXT PRIMARY KEY, name TEXT, default_role TEXT, position TEXT, is_allowed INTEGER);
    CREATE TABLE shift_log_sessions (token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT, created_at TEXT, last_used_at TEXT);
    CREATE TABLE legacy_logs (id INTEGER PRIMARY KEY, legacy_diary_id TEXT, work_date TEXT, shift TEXT, role TEXT, author TEXT, writer_id TEXT, status TEXT, operation_status TEXT, entries_json TEXT, original_json TEXT, legacy_position TEXT, legacy_version TEXT, source_updated_at TEXT, imported_at TEXT, updated_at TEXT);
    CREATE TABLE legacy_attachments (id INTEGER PRIMARY KEY, legacy_diary_id TEXT, file_name TEXT, original_url TEXT, r2_key TEXT, mime_type TEXT, file_size INTEGER, uploaded_at TEXT);
    CREATE TABLE shift_logs (id TEXT PRIMARY KEY, role TEXT, author_id TEXT, status TEXT);
    CREATE TABLE shift_log_attachments (id TEXT PRIMARY KEY, log_id TEXT, original_name TEXT, r2_key TEXT, content_type TEXT, file_size INTEGER, created_at TEXT);
    INSERT INTO legacy_attachments VALUES (1,'diary-1','사진.png','', 'fixture.png','image/png',68,'');
    INSERT INTO legacy_attachments VALUES (2,'diary-1','도면.pdf','', 'fixture.pdf','application/pdf',10,'');
    INSERT INTO legacy_attachments VALUES (3,'diary-1','test.svg','', 'fixture.svg','image/svg+xml',10,'');
    INSERT INTO shift_logs VALUES ('log-1','BO1','9000002','저장완료');
    INSERT INTO shift_log_attachments VALUES ('file-1','log-1','사진.png','fixture.png','image/png',68,'');
  `);
  const db = {
    raw, writes: 0, attachmentReads: 0, failAt: 0,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { if (/FROM (legacy_attachments|shift_log_attachments)/.test(sql)) db.attachmentReads++; return raw.prepare(sql).get(...args) || null; },
        async all() { return { results: raw.prepare(sql).all(...args) }; },
        async run() { db.writes++; if (db.failAt === db.writes) throw Error('synthetic SQL failure'); const result = raw.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
      };
    },
    async batch(statements) {
      raw.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    }
  };
  for (const [id, role, token, active, expiry] of [
    ['9000001','super_admin','admin-token',1,'2099-01-01'],
    ['9000002','user','user-token',1,'2099-01-01'],
    ['9000003','user','disabled-token',0,'2099-01-01'],
    ['9000004','super_admin','expired-token',1,'2020-01-01'],
    ['9000005','user','malformed-token',1,'invalid']
  ]) {
    raw.prepare('INSERT INTO users(employee_no,name,role,is_active,password_hash) VALUES(?,?,?,?,?)').run(id,'검토 직원',role,active,'unchanged-hash');
    raw.prepare('INSERT INTO employees VALUES(?,?,?,?,?)').run(id,'검토 직원',role,'BO1',active);
    raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?,?)').run(hash(token),id,expiry,'','');
  }
  return db;
}
function fixture(t) { const db = createDatabase(); t.after(() => db.raw.close()); return db; }
export function requestContext(DB, route, { token, method = 'GET', body, headers = {}, bucket } = {}) {
  return { env: { DB, ATTACHMENTS: bucket || { async get() { return { body: 'fixture', size: 7 }; } } },
    request: new Request('https://review.invalid/api/' + route, {
      method, headers: { 'Content-Type':'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
    }), waitUntil(task) { task.catch(() => {}); }
  };
}
async function call(db, route, options = {}) {
  const name = route.split('?')[0];
  const method = options.method || (name === 'legacy-import' ? 'POST' : 'GET');
  return routes[name]['onRequest' + method[0] + method.slice(1).toLowerCase()](requestContext(db,route,{ ...options, method }));
}

test('anonymous, expired, malformed and disabled sessions cannot read or import; no DB/R2/network side effects', async t => {
  const db = fixture(t); let external = 0, r2 = 0;
  t.mock.method(globalThis,'fetch',async () => { external++; throw Error('Unexpected network'); });
  for (const token of [undefined,'wrong-token','expired-token','disabled-token','malformed-token']) {
    for (const route of ['legacy-login','legacy-diaries?date=20260923&shift=DAY','legacy-import','legacy-logs?date=2026-09-23','legacy-attachment?id=1','shift-log-files?id=file-1','shift-logs']) {
      const response = await call(db, route, { token, ...(route==='legacy-import'?{body:{date:'20260923',shift:'DAY'}}:{}), bucket:{async get(){r2++;}} });
      assert.equal(response.status,401, route + '/' + token);
    }
  }
  assert.equal(db.writes,0); assert.equal(db.attachmentReads,0); assert.equal(r2,0); assert.equal(external,0);
});

test('ordinary users can read legacy logs and receive cookies scoped to attachment reads', async t => {
  const db = fixture(t);
  const response = await call(db,'legacy-logs?date=2026-09-23',{token:'user-token'});
  assert.equal(response.status,200); assert.equal((await response.json()).success,true);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length,2);
  for (const cookie of cookies) {
    assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);
    assert.match(cookie,/Path=\/api\/(legacy-attachment|shift-log-files);/);
    assert.doesNotMatch(cookie,/Domain=/);
  }
});

test('Bearer and attachment cookies open legacy and new files; invalid explicit Bearer cannot fall back', async t => {
  const db = fixture(t);
  const cookie = `${ATTACHMENT_COOKIE}=user-token`;
  for (const route of ['legacy-attachment?id=1','legacy-attachment?id=2','shift-log-files?id=file-1']) {
    for (const options of [{token:'user-token'},{headers:{Cookie:cookie}}]) {
      const response = await call(db,route,options);
      assert.equal(response.status,200,route); assert.equal(await response.text(),'fixture');
      assert.match(response.headers.get('Content-Disposition'),/filename\*=UTF-8''/);
      assert.match(response.headers.get('Content-Security-Policy'),/sandbox/);
      assert.match(response.headers.get('Cache-Control'),/no-store/);
    }
    assert.equal((await call(db,route,{token:'wrong-token',headers:{Cookie:cookie}})).status,401);
    assert.equal((await call(db,route,{headers:{Cookie:cookie,'Sec-Fetch-Site':'cross-site'}})).status,401);
    assert.equal((await call(db,route,{headers:{Cookie:cookie+'; '+cookie}})).status,401);
  }
  assert.equal((await call(db,'legacy-attachment?id=999',{token:'user-token'})).status,404);
  assert.equal((await call(db,'legacy-attachment?id=3',{token:'user-token'})).headers.get('X-Content-Type-Options'),'nosniff');
});

test('attachment cookies and query-string tokens never authorize other APIs or writes', async t => {
  const db = fixture(t), headers = { Cookie:`${ATTACHMENT_COOKIE}=admin-token` };
  assert.equal((await call(db,'legacy-logs?date=2026-09-23',{headers})).status,401);
  assert.equal((await call(db,'legacy-import',{headers,body:{date:'20260923',shift:'DAY'}})).status,401);
  assert.equal((await call(db,'legacy-attachment?id=1&token=user-token')).status,401);
  assert.equal((await employees.onRequestDelete(requestContext(db,'employees?employeeNo=9000002',{method:'DELETE',headers}))).status,401);
  assert.equal((await routes['shift-log-files'].onRequestDelete(requestContext(db,'shift-log-files?id=file-1',{method:'DELETE',headers}))).status,401);
  assert.equal(db.writes,0);
});

test('ordinary single-shift sync forwards Bearer only to the same origin and forbids redirect following', async t => {
  const db = fixture(t), calls = [];
  t.mock.method(globalThis,'fetch', async (url,options) => {
    calls.push({url,options}); return Response.json({success:true,items:[]});
  });
  const response = await call(db,'legacy-import',{token:'user-token',body:{date:'20260923',shift:'DAY'}});
  assert.equal(response.status,200); assert.equal((await response.json()).failedShiftCount,0);
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0].url).origin,'https://review.invalid');
  assert.equal(new URL(calls[0].url).pathname,'/api/legacy-diaries');
  assert.equal(calls[0].options.headers.Authorization,'Bearer user-token');
  assert.equal(calls[0].options.redirect,'error');
});

test('bulk/ALL sync and upstream login diagnostics require administrator; forged role fields have no effect', async t => {
  const db = fixture(t); let calls = 0;
  t.mock.method(globalThis,'fetch',async () => { calls++; return Response.json({success:true,items:[]}); });
  for (const body of [{date:'20260923',shift:'ALL',isSuperAdmin:true},{startDate:'20260923',endDate:'20260923',shift:'DAY'},{date:'20260923',startDate:'20260923',shift:'DAY'}]) {
    assert.equal((await call(db,'legacy-import',{token:'user-token',body})).status,403);
  }
  assert.equal((await call(db,'legacy-login',{token:'user-token'})).status,403);
  assert.equal(calls,0);
  const response = await call(db,'legacy-import',{token:'admin-token',body:{date:'20260923',shift:'ALL'}});
  assert.equal(response.status,200); assert.equal(calls,2);
  assert.equal((await call(db,'legacy-import',{token:'user-token',body:'{bad'})).status,400);
});

const employee = {employeeNo:'9000002',name:'검토 직원',defaultRole:'user',position:'BO1',isAllowed:true};
test('employee removal atomically deactivates login, revokes every session and preserves historical account', async t => {
  const db = fixture(t);
  db.raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?,?)').run(hash('second-token'),'9000002','2099-01-01','','');
  const response = await employees.onRequestDelete(requestContext(db,'employees?employeeNo=9000002',{method:'DELETE',token:'admin-token'}));
  assert.equal(response.status,200);
  assert.equal(db.raw.prepare('SELECT is_active FROM users WHERE employee_no=?').get('9000002').is_active,0);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM employees WHERE employee_no=?').get('9000002').n,0);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM shift_log_sessions WHERE employee_no=?').get('9000002').n,0);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM shift_logs').get().n,1);
  assert.equal((await login.onRequestPost(requestContext(db,'login',{method:'POST',body:{employeeNo:'9000002',password:'9000002'}}))).status,401);
  assert.equal((await call(db,'legacy-attachment?id=1',{headers:{Cookie:`${ATTACHMENT_COOKIE}=user-token`}})).status,401);
});

test('employee delete and multi-row save roll back completely on a mid-batch failure', async t => {
  t.mock.method(console,'error',()=>{});
  for (const action of ['delete','save']) {
    const db = fixture(t); db.failAt=2;
    const response = action==='delete'
      ? await employees.onRequestDelete(requestContext(db,'employees?employeeNo=9000002',{method:'DELETE',token:'admin-token'}))
      : await employees.onRequestPost(requestContext(db,'employees',{method:'POST',token:'admin-token',body:{accountSecurityVersion:6,employees:[{...employee,isAllowed:false},{...employee,employeeNo:'9000099'}]}}));
    assert.equal(response.status,500); assert.doesNotMatch(await response.text(),/SQL|synthetic/);
    assert.equal(db.raw.prepare('SELECT is_active FROM users WHERE employee_no=?').get('9000002').is_active,1);
    assert.equal(db.raw.prepare('SELECT count(*) n FROM shift_log_sessions WHERE employee_no=?').get('9000002').n,1);
    assert.equal(db.raw.prepare('SELECT count(*) n FROM employees WHERE employee_no=?').get('9000002').n,1);
    assert.equal(db.raw.prepare('SELECT count(*) n FROM users WHERE employee_no=?').get('9000099').n,0);
  }
});

test('disabling an employee revokes sessions; re-enabling preserves password and does not resurrect old sessions', async t => {
  const db = fixture(t);
  for (const allowed of [false,true]) {
    const response = await employees.onRequestPost(requestContext(db,'employees',{method:'POST',token:'admin-token',body:{...employee,isAllowed:allowed,reactivateAccount:allowed}}));
    assert.equal(response.status,200);
    const user = db.raw.prepare('SELECT * FROM users WHERE employee_no=?').get(employee.employeeNo);
    assert.equal(user.is_active,Number(allowed)); assert.equal(user.password_hash,'unchanged-hash');
    assert.equal((await call(db,'legacy-attachment?id=1',{token:'user-token'})).status,401);
  }
});

test('ordinary employee edits and spreadsheet imports cannot silently reactivate a disabled account', async t => {
  const db = fixture(t);
  for (const body of [{...employee,employeeNo:'9000003'},{employees:[{...employee,employeeNo:'9000003'}]}]) {
    const response = await employees.onRequestPost(requestContext(db,'employees',{method:'POST',token:'admin-token',body}));
    assert.equal(response.status,200);
    assert.equal(db.raw.prepare('SELECT is_active FROM users WHERE employee_no=?').get('9000003').is_active,0);
    assert.equal((await call(db,'legacy-attachment?id=1',{token:'disabled-token'})).status,401);
  }
});

test('self-deactivation and self-removal are rejected before any writes', async t => {
  const db = fixture(t);
  assert.equal((await employees.onRequestDelete(requestContext(db,'employees?employeeNo=9000001',{method:'DELETE',token:'admin-token'}))).status,409);
  assert.equal((await employees.onRequestPost(requestContext(db,'employees',{method:'POST',token:'admin-token',body:{...employee,employeeNo:'9000001',isAllowed:false}}))).status,409);
  assert.equal(db.writes,0);
});

test('role changes revoke previous sessions while retaining the employee password', async t => {
  const db = fixture(t);
  const response = await employees.onRequestPost(requestContext(db,'employees',{method:'POST',token:'admin-token',body:{...employee,defaultRole:'leader'}}));
  assert.equal(response.status,200);
  assert.equal(db.raw.prepare('SELECT password_hash FROM users WHERE employee_no=?').get(employee.employeeNo).password_hash,'unchanged-hash');
  assert.equal((await login.onRequestGet(requestContext(db,'login',{token:'user-token'}))).status,401);
});

test('new employee sets a private password before login issues a working session and attachment cookies', async t => {
  const db = fixture(t), employeeNo='9000099';
  const created = await employees.onRequestPost(requestContext(db,'employees',{method:'POST',token:'admin-token',body:{...employee,employeeNo,accountSecurityVersion:6}}));
  assert.equal(created.status,201);
  const temporary = (await created.json()).temporaryCredentials[0].temporaryPassword;
  assert.equal((await login.onRequestPost(requestContext(db,'login',{method:'POST',body:{employeeNo,password:temporary}}))).status,403);
  const password='review-private-password-1234';
  assert.equal((await passwordApi.onRequestPost(requestContext(db,'account-password',{method:'POST',body:{action:'change',employeeNo,currentPassword:temporary,newPassword:password}}))).status,200);
  const response = await login.onRequestPost(requestContext(db,'login',{method:'POST',body:{employeeNo,password}}));
  assert.equal(response.status,200);
  const result = await response.json();
  assert.ok(result.user.sessionToken); assert.equal(result.user.password,undefined);
  assert.equal(response.headers.getSetCookie().length,2);
  assert.equal((await call(db,'legacy-attachment?id=1',{token:result.user.sessionToken})).status,200);
  assert.ok(db.raw.prepare('SELECT token_hash FROM shift_log_sessions WHERE token_hash=?').get(hash(result.user.sessionToken)));
});

test('login validation establishes attachment access, logout clears both cookies and revokes the session', async t => {
  const db = fixture(t);
  const response = await login.onRequestGet(requestContext(db,'login',{token:'user-token'}));
  assert.equal(response.status,200); assert.equal(response.headers.getSetCookie().length,2);
  const logout = await login.onRequestDelete(requestContext(db,'login',{method:'DELETE',token:'user-token'}));
  assert.equal(logout.status,200);
  for (const cookie of logout.headers.getSetCookie()) assert.match(cookie,/Max-Age=0;/);
  assert.equal((await call(db,'shift-log-files?id=file-1',{headers:{Cookie:`${ATTACHMENT_COOKIE}=user-token`}})).status,401);
});

test('database authentication failure fails closed without leaking database details', async () => {
  const response = await protectedRequest(requestContext({prepare(){throw Error('private SQL details');}},'legacy-logs',{token:'user-token'}),()=>{throw Error('Handler must not run');});
  assert.equal(response.status,503); assert.doesNotMatch(await response.text(),/SQL|private/);
});

const preferencesSource = fs.readFileSync(new URL('../assets/login-preferences.js',import.meta.url),'utf8');
test('remembered login migrates plaintext passwords immediately and stores only employee ID', () => {
  const values = new Map([['gsShiftLog.rememberedLogin',JSON.stringify({employeeId:'9000002',password:'old-password',savedAt:'old'})],['gsShiftLog.currentUser','existing-session']]);
  const localStorage = {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const sandbox = {localStorage}; vm.runInNewContext(preferencesSource,sandbox);
  assert.deepEqual(JSON.parse(values.get('gsShiftLog.rememberedLogin')),{employeeId:'9000002'});
  sandbox.GSShiftLogLoginPreferences.remember(' 9000007 ','must-never-be-stored');
  assert.deepEqual(JSON.parse(values.get('gsShiftLog.rememberedLogin')),{employeeId:'9000007'});
  assert.equal(values.get('gsShiftLog.currentUser'),'existing-session');
  sandbox.GSShiftLogLoginPreferences.clear(); assert.equal(values.has('gsShiftLog.rememberedLogin'),false);
});

test('malformed or disabled browser storage does not break the login preferences', () => {
  for (const raw of ['{bad','null','[]','{"password":"old-password"}']) {
    let removed=false; const sandbox={localStorage:{getItem:()=>raw,removeItem:()=>{removed=true;},setItem(){}}};
    vm.runInNewContext(preferencesSource,sandbox); assert.equal(removed,true); assert.equal(sandbox.GSShiftLogLoginPreferences.read(),null);
  }
  const sandbox={}; Object.defineProperty(sandbox,'localStorage',{get(){throw Error('disabled');}});
  assert.doesNotThrow(()=>vm.runInNewContext(preferencesSource,sandbox));
  assert.doesNotThrow(()=>sandbox.GSShiftLogLoginPreferences.remember('9000002'));
});
