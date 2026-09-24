import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { collectWebAssets, buildWeb } from '../scripts/build-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const employees = await import('../functions/api/employees.js');
const setup = await import('../functions/api/create-initial-admin.js');
const hash = value => createHash('sha256').update(value).digest('hex');
function database(t, { role = 'user', active = 1, expires = '2099-01-01T00:00:00Z', seed = true } = {}) {
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  raw.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, employee_no TEXT UNIQUE, name TEXT, password_hash TEXT, role TEXT, is_active INTEGER, approved_at TEXT, approved_by TEXT, created_at TEXT, last_login_at TEXT);
    CREATE TABLE employees (employee_no TEXT PRIMARY KEY, name TEXT, default_role TEXT, position TEXT, is_allowed INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE shift_log_sessions (token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT, last_used_at TEXT);`);
  if (seed) {
    raw.prepare('INSERT INTO users(employee_no,name,role,is_active) VALUES(?,?,?,?)').run('9000001','검토 사용자',role,active);
    raw.prepare('INSERT INTO employees(employee_no,name,default_role) VALUES(?,?,?)').run('9000001','검토 사용자',role);
    raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(hash('review-token'),'9000001',expires,'');
  }
  return { raw, prepare(sql) { let args = []; return {
    bind(...values) { args = values; return this; },
    async first() { return raw.prepare(sql).get(...args) || null; },
    async all() { return { results: raw.prepare(sql).all(...args) }; },
    async run() { const r=raw.prepare(sql).run(...args); return { success:true, meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)} }; }
  }; } };
}
function context(DB, method, {token, body, url='employees', key, env={}} = {}) {
  return { env: { DB, ...env }, request: new Request('https://review.invalid/api/'+url, {
    method, headers: { ...(token ? {Authorization:'Bearer '+token}:{}), ...(key ? {'X-Setup-Key':key}:{}), 'Content-Type':'application/json' },
    ...(body !== undefined ? {body:JSON.stringify(body)} : {})
  }) };
}
const newEmployee = { employeeNo:'9000002', name:'검토 직원', defaultRole:'user', position:'', isAllowed:true };

test('anonymous employee reads, creates, and deletes are rejected without writes', async t => {
  const db=database(t);
  for (const method of ['Get','Post','Delete']) {
    const response=await employees['onRequest'+method](context(db,method.toUpperCase(),{body:method==='Post'?{...newEmployee,defaultRole:'super_admin'}:undefined}));
    assert.equal(response.status,401);
  }
  assert.equal(db.raw.prepare('SELECT count(*) n FROM users').get().n,1);
});
test('ordinary user cannot spoof administrator fields but can read leader directory', async t => {
  const db=database(t);
  const response=await employees.onRequestPost(context(db,'POST',{token:'review-token',body:{...newEmployee,role:'super_admin',employeeNo:'2014081'}}));
  assert.equal(response.status,403);
  assert.equal((await employees.onRequestGet(context(db,'GET',{token:'review-token',url:'employees?type=users'}))).status,200);
});
test('expired, malformed, and inactive admin sessions cannot write', async t => {
  for (const options of [{role:'super_admin',expires:'2020-01-01'}, {role:'super_admin',expires:'invalid'}, {role:'super_admin',active:0}]) {
    const db=database(t,options);
    assert.equal((await employees.onRequestPost(context(db,'POST',{token:'review-token',body:newEmployee}))).status,401);
  }
});
test('authenticated super-admin can create employee; existing password remains unchanged', async t => {
  const db=database(t,{role:'super_admin'});
  assert.equal((await employees.onRequestPost(context(db,'POST',{token:'review-token',body:newEmployee}))).status,201);
  const first=db.raw.prepare('SELECT password_hash FROM users WHERE employee_no=?').get(newEmployee.employeeNo).password_hash;
  assert.equal((await employees.onRequestPost(context(db,'POST',{token:'review-token',body:{...newEmployee,name:'수정 직원'}}))).status,200);
  assert.equal(db.raw.prepare('SELECT password_hash FROM users WHERE employee_no=?').get(newEmployee.employeeNo).password_hash,first);
});
const setupKey='local-test-setup-key-32-characters-only';
const initial={employeeNo:'9000010',name:'검토 관리자',password:'Test-password-123'};
test('initial administrator endpoint is disabled without a valid setup key', async t => {
  const db=database(t,{seed:false});
  for (const options of [{},{key:setupKey},{key:'wrong',env:{USER_SETUP_KEY:setupKey}},{key:'short',env:{USER_SETUP_KEY:'short'}}]) {
    assert.equal((await setup.onRequestPost(context(db,'POST',{url:'create-initial-admin',body:initial,...options}))).status,403);
  }
  assert.equal(db.raw.prepare('SELECT count(*) n FROM users').get().n,0);
});
test('all existing administrator spellings block repeated setup', async t => {
  for (const role of ['super_admin','superadmin']) {
    const db=database(t,{role});
    assert.equal((await setup.onRequestPost(context(db,'POST',{body:initial,key:setupKey,env:{USER_SETUP_KEY:setupKey}}))).status,409);
  }
});
test('concurrent initial setup produces exactly one administrator', async t => {
  const db=database(t,{seed:false});
  const results=await Promise.all([initial,{...initial,employeeNo:'9000011'}].map(body => setup.onRequestPost(context(db,'POST',{body,key:setupKey,env:{USER_SETUP_KEY:setupKey}}))));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM users').get().n,1);
});
test('malformed initial setup input returns a client error and no SQL details', async t => {
  const db=database(t,{seed:false});
  const response=await setup.onRequestPost({env:{DB:db,USER_SETUP_KEY:setupKey},request:new Request('https://review.invalid/api/create-initial-admin',{method:'POST',headers:{'X-Setup-Key':setupKey},body:'{bad'})});
  assert.equal(response.status,400); assert.equal((await response.json()).error,undefined);
});
function loadBrowserModule(relative, property) {
  // Browser bootstrap stays dormant; calculation exports are exercised directly.
  const sandbox={console,module:{exports:{}},setTimeout(){},clearTimeout(){},document:{readyState:'loading',addEventListener(){}}};
  sandbox.window=sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root,relative),'utf8'),sandbox,{filename:relative});
  return sandbox[property] || sandbox.module.exports;
}
test('missing co-firing values remain null, while a real zero remains zero', () => {
  const api=loadBrowserModule('maintenance/cofiring-date-history-v1.js','CofiringDateHistoryV1');
  const result=api.summaryFromResult({units:{unit1:{coal:{quantity:null},bio:{quantity:0},organic:{quantity:''},manure:{quantity:false}}}});
  assert.equal(result.unit1.coal,null);assert.equal(result.unit1.bio,0);assert.equal(result.unit1.organic,null);assert.equal(result.unit1.manure,null);
});
test('monthly average excludes missing values and keeps explicit zeros', () => {
  const api=loadBrowserModule('maintenance/cofiring-closed-history-cards-v2.js','CofiringClosedHistoryMonthlyV3');
  assert.equal(api.averageRows([{unit1:{coal:10}},{unit1:{coal:null}}]).unit1.coal,10);
  assert.equal(api.averageRows([{unit1:{coal:10}},{unit1:{coal:0}}]).unit1.coal,5);
  assert.equal(api.averageRows([{unit1:{coal:null}}]).unit1.coal,null);
});
test('all co-firing worker integrity hashes match exact shipped bytes', async () => {
  const agent=await import('../local-tools/ois-agent/cofiring-dataparc-agent.js');
  const worker=fs.readFileSync(path.join(root,'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'));
  const controller=fs.readFileSync(path.join(root,'local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1'));
  assert.equal(hash(worker),agent.PERIOD_WORKER_SHA256); assert.equal(hash(controller),agent.PERIOD_CONTROLLER_SHA256);
  assert.ok(controller.toString().includes("$expectedWorkerSha256='"+hash(worker)+"'"));
});
test('co-firing UI module can be imported without a browser', async () => {
  const ui=await import('../maintenance/cofiring-period-ui-v5.js');assert.ok(ui);
});
test('public build excludes Agent credentials, backups, tests, server sources and retired assets', async t => {
  const files=await collectWebAssets(root);
  assert.ok(files.includes('index.html'));assert.ok(files.includes('maintenance/cofiring-core.js'));
  assert.ok(!files.some(p=>/^(?:functions|local-tools|tests)\/|\.env|\.bak|before-|mobile-runtime-v13/.test(p)));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gs-web-build-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const output=path.join(tmp,'public');const result=await buildWeb(root,output);
  assert.equal(result.files,files.length);
  await assert.rejects(buildWeb(root,output),/EEXIST/);
});
