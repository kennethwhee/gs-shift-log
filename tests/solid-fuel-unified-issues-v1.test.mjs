import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const source = fs.readFileSync(new URL('../functions/api/solid-fuel-trouble.js', import.meta.url), 'utf8');
const TOKEN = 'solid-fuel-issues-fixture-token';
const DATE = '2035-02-03';
let isolate = 0;

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    sqlite,
    prepare(sql) {
      return {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...this.values).changes) } }; },
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
  sqlite.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT);`);
  const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN))).toString('hex');
  sqlite.prepare('INSERT INTO users VALUES(?,?,?,?)').run('issue-user', '이슈 사용자', 'admin', 1);
  sqlite.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?)').run(tokenHash, 'issue-user', new Date(Date.now() + 86400000).toISOString());
  const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#issues-${++isolate}`);
  const f = {
    sqlite,
    close() { sqlite.close(); },
    async request(method = 'GET', query = `?from=${DATE}&to=${DATE}`, body, token = TOKEN) {
      const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
      const request = new Request(`https://fixture.invalid/api/solid-fuel-trouble${query}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      const response = await api[`onRequest${method[0] + method.slice(1).toLowerCase()}`]({ request, env: { DB: db } });
      return { status: response.status, body: await response.json() };
    },
    async create(fields = {}) {
      const result = await this.request('POST', '', { entity: 'unloading', unloadingDate: DATE, fuelType: 'organic', receiptTons: 25.5, companyName: '시험업체', vehicleNo: '4202', siloRoute: '#B', arrivalTime: '13:00', departureTime: '14:20', note: '', ...fields });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.body;
    }
  };
  return f;
}

test('existing ordinary unloading remarks appear as editable issue rows without adding or changing stored records', async () => {
  const f = await fixture();
  try {
    const created = await f.create({ note: '#B하역중 막힘으로 #A 나머지 이송' });
    const before = f.sqlite.prepare('SELECT * FROM solid_fuel_unloading_logs WHERE id=?').get(created.id);
    const result = await f.request();
    assert.equal(result.status, 200);
    assert.equal(result.body.items.length, 0);
    assert.equal(result.body.issueItems.length, 1);
    const issue = result.body.issueItems[0];
    assert.equal(issue.id, created.id);
    assert.equal(issue.sourceEntity, 'unloading');
    assert.equal(issue.note, before.note);
    assert.equal(issue.sourceRecord.id, created.id);
    assert.equal(issue.sourceRecord.version, 1);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM solid_fuel_unloading_logs WHERE id=?').get(created.id), before);
  } finally { f.close(); }
});

test('combined create saves an explicit source relation and projects one issue while preserving raw lists', async () => {
  const f = await fixture();
  try {
    const saved = await f.create({ entity: 'combined', equipment: '하역 곡관부 막힘', note: '역가압 후 재개' });
    const result = (await f.request()).body;
    assert.equal(result.items.length, 1);
    assert.equal(result.unloadingLogs.length, 1);
    assert.equal(result.issueItems.length, 1);
    assert.equal(result.items[0].sourceKey, `unloading:${saved.unloadingId}`);
    assert.equal(result.issueItems[0].id, saved.troubleId);
    assert.equal(result.issueItems[0].sourceEntity, 'trouble');
    assert.equal(result.issueItems[0].equipment, '하역 곡관부 막힘');
    assert.equal(result.issueItems[0].note, '역가압 후 재개');
    assert.equal(result.issueItems[0].unloadingNote, undefined);
  } finally { f.close(); }
});

test('legacy combined records de-duplicate only unique exact signatures, without backfilling source keys', async () => {
  const f = await fixture();
  try {
    const saved = await f.create({ entity: 'combined', equipment: 'Storage #A 막힘', note: '해소' });
    f.sqlite.prepare('UPDATE solid_fuel_trouble_records SET source_key=NULL WHERE id=?').run(saved.troubleId);
    let result = (await f.request()).body;
    assert.equal(result.issueItems.length, 1);
    assert.equal(f.sqlite.prepare('SELECT source_key FROM solid_fuel_trouble_records WHERE id=?').get(saved.troubleId).source_key, null);
    // A second independently created Trouble with an indistinguishable signature
    // is ambiguous, so the projection must not guess which record owns the unload.
    f.sqlite.prepare(`INSERT INTO solid_fuel_trouble_records(id,occurrence_date,company_name,vehicle_no,equipment,note,created_at,updated_at)
      SELECT 'ambiguous-trouble',occurrence_date,company_name,vehicle_no,equipment,note,created_at,updated_at
      FROM solid_fuel_trouble_records WHERE id=?`).run(saved.troubleId);
    result = (await f.request()).body;
    assert.equal(result.issueItems.length, 3);
    assert.equal(result.issueItems.filter(x => x.sourceEntity === 'unloading').length, 1);
  } finally { f.close(); }
});

test('ordinary rows with identical remarks remain distinct; blank and placeholder dashes do not become issues', async () => {
  const f = await fixture();
  try {
    await f.create({ note: '입고 지연' });
    await f.create({ note: '입고 지연' });
    for (const note of ['', '  ', '\n\t-\r', ' — – − ', '\u200b-']) await f.create({ note });
    const result = (await f.request()).body;
    assert.equal(result.unloadingLogs.length, 7);
    assert.equal(result.issueItems.length, 2);
    assert.notEqual(result.issueItems[0].id, result.issueItems[1].id);
  } finally { f.close(); }
});

test('updated unloading remarks appear beside a linked Trouble without discarding either stored note', async () => {
  const f = await fixture();
  try {
    const saved = await f.create({ entity: 'combined', equipment: '곡관 막힘', note: '현장 확인' });
    const response = await f.request('PUT', '', { entity: 'unloading', id: saved.unloadingId, version: 1, unloadingDate: DATE, companyName: '시험업체', vehicleNo: '4202', siloRoute: '#B', arrivalTime: '13:00', departureTime: '14:20', fuelType: 'organic', receiptTons: 25.5, note: '추가 조치 후 #A로 이송' });
    assert.equal(response.status, 200);
    const result = (await f.request()).body;
    assert.equal(result.issueItems.length, 1);
    assert.equal(result.issueItems[0].note, '현장 확인');
    assert.equal(result.issueItems[0].unloadingNote, '추가 조치 후 #A로 이송');
    assert.equal(result.unloadingLogs[0].note, '추가 조치 후 #A로 이송');
  } finally { f.close(); }
});

test('searching either linked source retains the complete issue, photos and original edit target', async () => {
  const f = await fixture();
  try {
    const saved = await f.create({ entity: 'combined', equipment: '곡관 막힘', note: '현장 확인' });
    f.sqlite.prepare('UPDATE solid_fuel_unloading_logs SET note=? WHERE id=?').run('추가 조치 후 이송', saved.unloadingId);
    f.sqlite.prepare('UPDATE solid_fuel_trouble_records SET legacy_photo_path=? WHERE id=?').run('/maintenance/solid-fuel-trouble-assets/excel-001.jpeg', saved.troubleId);
    f.sqlite.prepare('INSERT INTO solid_fuel_trouble_photos(id,trouble_id,r2_key,original_name,created_at) VALUES(?,?,?,?,?)')
      .run('filtered-photo', saved.troubleId, 'fixture/filtered-photo.png', 'sample.png', `${DATE}T01:00:00Z`);

    for (const search of ['곡관 막힘', '추가 조치', '#B']) {
      const result = (await f.request('GET', `?from=${DATE}&to=${DATE}&search=${encodeURIComponent(search)}`)).body;
      const troubleMatches = search === '곡관 막힘';
      assert.equal(result.items.length, troubleMatches ? 1 : 0, 'the original Trouble list keeps its filters');
      assert.equal(result.unloadingLogs.length, troubleMatches ? 0 : 1, 'the original unloading list keeps its filters');
      assert.equal(result.issueItems.length, 1);
      const issue = result.issueItems[0];
      assert.equal(issue.id, saved.troubleId);
      assert.equal(issue.sourceEntity, 'trouble');
      assert.equal(issue.equipment, '곡관 막힘');
      assert.equal(issue.note, '현장 확인');
      assert.equal(issue.unloadingNote, '추가 조치 후 이송');
      assert.equal(issue.photos.length, 2);
      assert.equal(issue.photos.some(photo => photo.id === 'filtered-photo'), true);
      assert.equal(issue.sourceRecord.id, saved.troubleId);
      assert.equal(issue.sourceRecord.version, 1);
    }
    const unrelated = (await f.request('GET', `?from=${DATE}&to=${DATE}&search=${encodeURIComponent('해당 없음')}`)).body;
    assert.equal(unrelated.issueItems.length, 0);
  } finally { f.close(); }
});

test('date, company and vehicle filters can select the unloading side without losing its linked Trouble', async () => {
  const f = await fixture();
  try {
    const saved = await f.create({ entity: 'combined', equipment: '원래 이슈', note: '최초 조치' });
    f.sqlite.prepare('UPDATE solid_fuel_unloading_logs SET unloading_date=?,company_name=?,vehicle_no=?,note=? WHERE id=?')
      .run('2035-02-04', '변경업체', '9100', '추가 하역 비고', saved.unloadingId);
    const query = '?from=2035-02-04&to=2035-02-04&company=' + encodeURIComponent('변경업체') + '&vehicle=9100';
    const result = (await f.request('GET', query)).body;
    assert.equal(result.items.length, 0);
    assert.equal(result.unloadingLogs.length, 1);
    assert.equal(result.issueItems.length, 1);
    assert.equal(result.issueItems[0].id, saved.troubleId);
    assert.equal(result.issueItems[0].unloadingNote, '추가 하역 비고');
    assert.equal(result.issueItems[0].sourceRecord.occurrenceDate, DATE);
    const unrelated = (await f.request('GET', query.replace('9100', '9999'))).body;
    assert.equal(unrelated.issueItems.length, 0);
  } finally { f.close(); }
});

test('authenticated detail lookup returns an original Trouble and photos independently of list filters', async () => {
  const f = await fixture();
  try {
    const saved = await f.create({ entity: 'combined', equipment: '저장된 이슈', note: '사진 재시도' });
    f.sqlite.prepare('UPDATE solid_fuel_trouble_records SET legacy_photo_path=? WHERE id=?').run('/maintenance/solid-fuel-trouble-assets/excel-001.jpeg', saved.troubleId);
    const photoInsert = f.sqlite.prepare('INSERT INTO solid_fuel_trouble_photos(id,trouble_id,r2_key,original_name,created_at,upload_state) VALUES(?,?,?,?,?,?)');
    photoInsert.run('detail-ready', saved.troubleId, 'fixture/detail-ready.png', 'uploaded.png', `${DATE}T01:00:00Z`, 'ready');
    photoInsert.run('detail-pending', saved.troubleId, 'fixture/detail-pending.png', 'pending.png', `${DATE}T02:00:00Z`, 'pending');
    const query = `?recordId=${encodeURIComponent(saved.troubleId)}&from=2036-01-01&to=2036-01-31&company=excluded`;
    const result = await f.request('GET', query);
    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body).sort(), ['item', 'ok']);
    assert.equal(result.body.item.id, saved.troubleId);
    assert.equal(result.body.item.version, 1);
    assert.equal(result.body.item.photos.length, 2);
    assert.equal(result.body.item.photos.some(photo => photo.id === 'detail-ready'), true);
    assert.equal(result.body.item.photos.some(photo => photo.id === 'detail-pending'), false);
    assert.equal(result.body.item.note, '사진 재시도');
    assert.equal('sourceRecord' in result.body.item, false);

    const anonymous = await f.request('GET', query, undefined, '');
    assert.equal(anonymous.status, 401);
    assert.deepEqual(Object.keys(anonymous.body).sort(), ['message', 'ok']);
    assert.equal((await f.request('GET', '?recordId=missing-record')).status, 404);
    await f.request('DELETE', `?entity=trouble&id=${encodeURIComponent(saved.troubleId)}`);
    assert.equal((await f.request('GET', query)).status, 404);
  } finally { f.close(); }
});

test('deleting a separate Trouble preserves its receipt and the surviving unloading remark', async () => {
  const f = await fixture();
  try {
    const saved = await f.create({ entity: 'combined', equipment: '이슈 내용', note: '유지할 하역 비고' });
    const before = f.sqlite.prepare('SELECT * FROM solid_fuel_unloading_logs WHERE id=?').get(saved.unloadingId);
    assert.equal((await f.request('DELETE', `?entity=trouble&id=${encodeURIComponent(saved.troubleId)}`)).status, 200);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM solid_fuel_unloading_logs WHERE id=?').get(saved.unloadingId), before);
    const result = (await f.request()).body;
    assert.equal(result.items.length, 0);
    assert.equal(result.unloadingLogs.length, 1);
    assert.equal(result.issueItems.length, 1);
    assert.equal(result.issueItems[0].sourceEntity, 'unloading');
    assert.equal(result.issueItems[0].note, before.note);
    assert.equal(result.issueItems[0].sourceRecord.receiptTons, 25.5);
  } finally { f.close(); }
});

test('issue-note filtering occurs before the unloading list cap, and retains the original edit record', async () => {
  const f = await fixture();
  try {
    const old = await f.create({ note: '이전 비고도 이슈에서 조회' });
    f.sqlite.prepare("UPDATE solid_fuel_unloading_logs SET departure_time='23:59' WHERE id=?").run(old.id);
    const insert = f.sqlite.prepare(`INSERT INTO solid_fuel_unloading_logs(id,unloading_date,arrival_time,departure_time,duration_minutes,note,created_at,updated_at)
      VALUES(?,?,'00:00','00:01',1,'',?,?)`);
    for (let i = 0; i < 2005; i++) insert.run(`ordinary-${i}`, DATE, '2035-02-03T12:00:00Z', '2035-02-03T12:00:00Z');
    const result = (await f.request()).body;
    assert.equal(result.unloadingLogs.length, 2000);
    assert.equal(result.unloadingLogs.some(x => x.id === old.id), false);
    assert.equal(result.issueItems.length, 1);
    assert.equal(result.issueItems[0].sourceRecord.id, old.id);
  } finally { f.close(); }
});

test('issue date/search/sort filters agree with the corresponding stored notes', async () => {
  const f = await fixture();
  try {
    await f.create({ unloadingDate: '2035-02-02', note: '첫날 특별조치' });
    await f.create({ unloadingDate: DATE, note: '둘째날 특별조치' });
    await f.create({ unloadingDate: '2035-02-04', note: '제외되는 내용' });
    const result = (await f.request('GET', '?from=2035-02-02&to=2035-02-04&search=' + encodeURIComponent('특별조치') + '&sort=asc')).body;
    assert.deepEqual(result.issueItems.map(x => x.occurrenceDate), ['2035-02-02', DATE]);
  } finally { f.close(); }
});

test('anonymous issue projection contains no original IDs, versions or nested edit payload', async () => {
  const f = await fixture();
  try {
    await f.create({ note: '일반 비고' });
    await f.create({ entity: 'combined', equipment: '설비 이슈', note: '조치 비고' });
    const result = await f.request('GET', `?from=${DATE}&to=${DATE}`, undefined, '');
    assert.equal(result.status, 200);
    assert.equal(result.body.issueItems.length, 2);
    for (const item of result.body.issueItems) {
      for (const key of ['id', 'sourceKey', 'sourceRecord', 'version', 'createdAt', 'updatedAt']) assert.equal(key in item, false, key);
      assert.ok(['trouble', 'unloading'].includes(item.sourceEntity));
    }
    assert.equal(result.body.permissions.canEdit, false);
    const matchedNote = await f.request('GET', `?from=${DATE}&to=${DATE}&search=${encodeURIComponent('#B')}`, undefined, '');
    assert.equal(matchedNote.body.items.length, 0);
    for (const item of matchedNote.body.issueItems) {
      for (const key of ['id', 'sourceKey', 'sourceRecord', 'version', 'createdAt', 'updatedAt']) assert.equal(key in item, false, key);
    }
  } finally { f.close(); }
});

test('existing photo-only Trouble rows remain in issues and notes do not create photo upload targets', async () => {
  const f = await fixture();
  try {
    await f.create({ note: '사진 없는 비고' });
    f.sqlite.prepare(`INSERT INTO solid_fuel_trouble_records(id,occurrence_date,company_name,vehicle_no,equipment,note,legacy_photo_path,created_at,updated_at)
      VALUES('photo-only',?,'','','','','/maintenance/solid-fuel-trouble-assets/excel-001.jpeg',?,?)`).run(DATE, '2035-02-03T00:00:00Z', '2035-02-03T00:00:00Z');
    const result = (await f.request()).body;
    assert.equal(result.issueItems.length, 2);
    const photo = result.issueItems.find(x => x.id === 'photo-only');
    assert.equal(photo.sourceEntity, 'trouble');
    assert.equal(photo.photos.length, 1);
    assert.equal(result.issueItems.find(x => x.sourceEntity === 'unloading').photos.length, 0);
  } finally { f.close(); }
});
