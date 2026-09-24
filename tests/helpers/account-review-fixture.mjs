import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function accountDatabase(t) {
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  raw.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, employee_no TEXT UNIQUE, name TEXT, password_hash TEXT, role TEXT, is_active INTEGER, approved_at TEXT, approved_by TEXT, created_at TEXT, last_login_at TEXT);
    CREATE TABLE employees(employee_no TEXT PRIMARY KEY, name TEXT, default_role TEXT, position TEXT, is_allowed INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT, created_at TEXT, last_used_at TEXT);`);
  let queue = Promise.resolve();
  const db = { raw, hook: null, failSql: null, statements: [],
    prepare(sql) {
      let args = [];
      const execute = mode => {
        db.statements.push(sql);
        if (db.failSql?.test(sql)) throw Error('synthetic private SQL detail');
        if (mode === 'first') return raw.prepare(sql).get(...args) || null;
        if (mode === 'all') return { results: raw.prepare(sql).all(...args) };
        const r = raw.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      };
      return { sql, bind(...values) { args = values; return this; },
        async first() { return execute('first'); }, async all() { return execute('all'); }, async run() { return execute('run'); } };
    },
    batch(statements) {
      const task = queue.then(async () => {
        if (db.hook) await db.hook(statements);
        raw.exec('BEGIN');
        try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results; }
        catch (error) { raw.exec('ROLLBACK'); throw error; }
      });
      queue = task.catch(() => {}); return task;
    }
  };
  return db;
}
export function seedAccount(db, employeeNo, passwordHash, { role = 'user', active = 1, token, expires = '2099-01-01' } = {}) {
  db.raw.prepare('INSERT INTO users(employee_no,name,password_hash,role,is_active) VALUES(?,?,?,?,?)').run(employeeNo,'검토 직원',passwordHash,role,active);
  db.raw.prepare('INSERT INTO employees VALUES(?,?,?,?,?)').run(employeeNo,'검토 직원',role,'',active);
  if (token) db.raw.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?,?)').run(digest(token),employeeNo,expires,'','');
}
export function accountContext(db, route = 'login', { method = 'POST', body, token, headers = {}, background = false } = {}) {
  return { env: { DB: db }, request: new Request('https://review.invalid/api/' + route, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
  }), ...(background ? { waitUntil(promise) { promise.catch(() => {}); } } : {}) };
}
