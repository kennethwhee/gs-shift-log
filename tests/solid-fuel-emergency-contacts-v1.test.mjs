import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const source = fs.readFileSync(new URL('../functions/api/solid-fuel-trouble.js', import.meta.url), 'utf8');
let isolate = 0;
const TOKEN = 'contact-fixture-session-token';
const PRIVATE_COMPANY = '연락망 전용 업체';
const PRIVATE_DRIVER = '비공개 기사';
const PRIVATE_PHONE = '010-9876-4321';

async function freshApi() {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#contact-fixture-${++isolate}`);
}
function database() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    sqlite,
    prepare(sql) {
      return {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async run() { const result = sqlite.prepare(sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; },
        async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
        async first() { return sqlite.prepare(sql).get(...this.values) || null; }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
}
async function fixture() {
  const db = database();
  db.sqlite.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT);`);
  const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN))).toString('hex');
  db.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?)').run('contact-user', '연락망 사용자', 'user', 1);
  db.sqlite.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?)').run(tokenHash, 'contact-user', new Date(Date.now() + 86_400_000).toISOString());
  let api = await freshApi();
  return {
    db,
    async reload() { api = await freshApi(); },
    close() { db.sqlite.close(); },
    async request(method = 'GET', query = '?entity=contact', body, token = TOKEN) {
      const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
      const request = new Request(`https://fixture.invalid/api/solid-fuel-trouble${query}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      const response = await api[`onRequest${method[0] + method.slice(1).toLowerCase()}`]({ request, env: { DB: db } });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
    create(fields = {}) { return this.request('POST', '', { entity: 'contact', companyName: PRIVATE_COMPANY, driverName: PRIVATE_DRIVER, phoneNumber: PRIVATE_PHONE, ...fields }); }
  };
}

test('contact directory requires an active authenticated session for every operation', async () => {
  const f = await fixture();
  try {
    for (const token of ['', 'invalid-session']) {
      assert.equal((await f.request('GET', '?entity=contact', undefined, token)).status, 401);
      assert.equal((await f.request('POST', '', { entity: 'contact' }, token)).status, 401);
      assert.equal((await f.request('PUT', '', { entity: 'contact' }, token)).status, 401);
      assert.equal((await f.request('DELETE', '?entity=contact', undefined, token)).status, 401);
    }
    f.db.sqlite.prepare('UPDATE users SET is_active=0').run();
    assert.equal((await f.request()).status, 401);
  } finally { f.close(); }
});

test('contacts persist in D1 across fresh isolates and allow multiple drivers per company', async () => {
  const f = await fixture();
  try {
    const first = await f.create();
    const second = await f.create({ driverName: '두 번째 기사', phoneNumber: '+82 (10) 1234-5678' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body.contact.id, second.body.contact.id);
    assert.equal(first.body.contact.version, 1);
    assert.equal(first.body.contact.createdByName, '연락망 사용자');
    await f.reload();
    const loaded = await f.request();
    assert.equal(loaded.status, 200);
    assert.equal(loaded.headers.get('cache-control'), 'no-store');
    assert.equal(loaded.body.permissions.canManageContacts, true);
    assert.equal(loaded.body.contacts.length, 2);
    assert.ok(loaded.body.contacts.some(row => row.phoneNumber === PRIVATE_PHONE));
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM solid_fuel_emergency_contacts').get().n, 2);
  } finally { f.close(); }
});

test('contact changes leave unloading history, Trouble records and company settings untouched', async () => {
  const f = await fixture();
  try {
    await f.request();
    const snapshot = () => JSON.stringify({
      unloading: f.db.sqlite.prepare('SELECT * FROM solid_fuel_unloading_logs ORDER BY id').all(),
      trouble: f.db.sqlite.prepare('SELECT * FROM solid_fuel_trouble_records ORDER BY id').all(),
      companies: f.db.sqlite.prepare('SELECT * FROM solid_fuel_companies ORDER BY company_name').all()
    });
    const before = snapshot();
    const created = await f.create();
    const edited = await f.request('PUT', '', { entity: 'contact', ...created.body.contact, companyName: '바뀐 연락망 업체', driverName: '바뀐 기사' });
    assert.equal(edited.status, 200);
    const deleted = await f.request('DELETE', `?entity=contact&id=${created.body.contact.id}&version=2`);
    assert.equal(deleted.status, 200);
    assert.equal(snapshot(), before);
  } finally { f.close(); }
});

test('anonymous historical record responses do not expose contact names, phones or directory data', async () => {
  const f = await fixture();
  try {
    await f.create();
    for (const token of ['', 'invalid-session']) {
      const result = await f.request('GET', '', undefined, token);
      assert.equal(result.status, 200);
      const encoded = JSON.stringify(result.body);
      assert.equal('contacts' in result.body, false);
      assert.equal(encoded.includes(PRIVATE_COMPANY), false);
      assert.equal(encoded.includes(PRIVATE_DRIVER), false);
      assert.equal(encoded.includes(PRIVATE_PHONE), false);
    }
  } finally { f.close(); }
});

test('strict required field and phone validation rejects unsafe values without inserting data', async () => {
  const f = await fixture();
  try {
    const invalid = [
      { companyName: '' }, { companyName: 'x'.repeat(81) }, { driverName: '' }, { driverName: 'x'.repeat(81) },
      { companyName: '업체\n' }, { driverName: '\r기사' }, { phoneNumber: '010-1234-5678\n' },
      { phoneNumber: 'javascript:alert(1)' }, { phoneNumber: 'tel:01012345678' }, { phoneNumber: '*12345678#' },
      { phoneNumber: '123456' }, { phoneNumber: '1234567890123456' }, { phoneNumber: '++821012345678' },
      { phoneNumber: 'x'.repeat(41) }, { phoneNumber: 1012345678 }, { companyName: [] }, { driverName: null }
    ];
    for (const fields of invalid) assert.equal((await f.create(fields)).status, 400, JSON.stringify(fields));
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM solid_fuel_emergency_contacts').get().n, 0);
    for (const phoneNumber of ['031-123-4567', '01012345678', '+82 (10) 1234-5678']) assert.equal((await f.create({ phoneNumber })).status, 201);
  } finally { f.close(); }
});

test('parameterized storage preserves literal names rather than executing SQL', async () => {
  const f = await fixture();
  try {
    const companyName = "업체'); DROP TABLE solid_fuel_companies;--";
    const result = await f.create({ companyName, driverName: '<script>기사</script>' });
    assert.equal(result.status, 201);
    assert.equal(result.body.contact.companyName, companyName);
    assert.ok(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM solid_fuel_companies').get().n > 0);
  } finally { f.close(); }
});

test('versions prevent lost updates and stale deletions for ordinary logged-in users', async () => {
  const f = await fixture();
  try {
    const created = (await f.create()).body.contact;
    const updated = await f.request('PUT', '', { entity: 'contact', ...created, driverName: '새 기사' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.contact.version, 2);
    assert.equal(updated.body.contact.updatedByName, '연락망 사용자');
    assert.equal((await f.request('PUT', '', { entity: 'contact', ...created, driverName: '오래된 덮어쓰기' })).status, 409);
    assert.equal((await f.request('DELETE', `?entity=contact&id=${created.id}&version=1`)).status, 409);
    assert.equal((await f.request()).body.contacts[0].driverName, '새 기사');
    assert.equal((await f.request('DELETE', `?entity=contact&id=${created.id}&version=2`)).status, 200);
    assert.deepEqual((await f.request()).body.contacts, []);
    const raw = f.db.sqlite.prepare('SELECT * FROM solid_fuel_emergency_contacts WHERE id=?').get(created.id);
    assert.ok(raw.deleted_at);
    assert.equal(raw.deleted_by_id, 'contact-user');
    assert.equal(raw.version, 3);
    assert.equal((await f.request('DELETE', `?entity=contact&id=${created.id}&version=2`)).status, 404);
    assert.equal((await f.request('PUT', '', { entity: 'contact', ...created })).status, 404);
  } finally { f.close(); }
});

test('concurrent updates from the same version have exactly one winner', async () => {
  const f = await fixture();
  try {
    const contact = (await f.create()).body.contact;
    const responses = await Promise.all(['기사 A', '기사 B'].map(driverName => f.request('PUT', '', { entity: 'contact', ...contact, driverName })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    assert.equal((await f.request()).body.contacts[0].version, 2);
  } finally { f.close(); }
});

test('malformed IDs or versions cannot update or delete contact rows', async () => {
  const f = await fixture();
  try {
    const contact = (await f.create()).body.contact;
    for (const version of [undefined, null, false, {}, [1], 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1e0']) {
      assert.equal((await f.request('PUT', '', { entity: 'contact', ...contact, version })).status, 400);
    }
    assert.equal((await f.request('PUT', '', { entity: 'contact', ...contact, id: "' OR 1=1--" })).status, 400);
    assert.equal((await f.request('DELETE', `?entity=contact&id=${contact.id}&version=1.5`)).status, 400);
    assert.equal((await f.request()).body.contacts[0].version, 1);
  } finally { f.close(); }
});
