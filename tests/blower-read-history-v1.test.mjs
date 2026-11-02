import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as history } from '../functions/api/blower-history.js';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  const queries = [], batches = [];
  let firstGate = null, gatePattern = /./, batchError = null, metadataError = null;
  const db = {
    prepare(text) {
      return {
        text, values: [],
        bind(...values) { assert.ok(values.length <= 100, 'D1 statement bind limit'); this.values = values; return this; },
        async first() {
          queries.push({ text: this.text, values: this.values.slice() });
          if (firstGate && gatePattern.test(this.text)) { const gate = firstGate; firstGate = null; await gate; }
          if (metadataError && /FROM sqlite_master/.test(this.text)) throw metadataError;
          return sql.prepare(this.text).get(...this.values) || null;
        },
        async all() {
          const rows = sql.prepare(this.text).all(...this.values);
          queries.push({ text: this.text, values: this.values.slice(), rows });
          return { results: rows };
        },
        async run() {
          queries.push({ text: this.text, values: this.values.slice() });
          const result = sql.prepare(this.text).run(...this.values);
          return { meta: { changes: Number(result.changes) } };
        }
      };
    },
    async batch(statements) {
      batches.push(statements.map(statement => statement.text));
      if (batchError) throw batchError;
      sql.exec('BEGIN IMMEDIATE');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sql.exec('COMMIT');
        return result;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
  return { db, sql, queries, batches,
    reset() { queries.length = 0; batches.length = 0; },
    gate(promise, pattern = /./) { firstGate = promise; gatePattern = pattern; },
    failMetadata(error) { metadataError = error; },
    failBatch(error) { batchError = error; },
    close() { sql.close(); }
  };
}
const readyFixture = async () => { const f = fixture(); await history.ensureSchema(f.db); f.sql.exec('UPDATE blower_history_assets SET cycle_runtime_hours=COALESCE(cycle_runtime_hours,0)'); f.reset(); return f; };
const runtimeQuery = query => /SELECT id, tag_number, event_type, event_date, runtime_hours/.test(query.text);

const presenceQueries = f => f.queries.filter(query => /FROM sqlite_master/.test(query.text));

test('cold schema readiness preserves every original check while warm calls cache metadata alone', async () => {
  const f = await readyFixture();
  try {
    await history.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(f.queries.length, 5); assert.equal(presenceQueries(f).length, 1);
    assert.match(f.queries[0].text, /setting_count/);
    assert.match(f.queries[1].text, /limestone_basis_confirmation/);
    assert.match(f.queries[2].text, /cycle_runtime_hours IS NULL/);
    assert.match(f.queries[3].text, /blower_history_asset_history/);
    assert.match(f.queries[4].text, /guard_ready[\s\S]*active_slot_ready[\s\S]*canonical_tag_ready/);
    f.reset(); await history.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(f.queries.length, 4); assert.equal(presenceQueries(f).length, 0);
    assert.match(f.queries[0].text, /sentinel_asset_count/);
    assert.match(f.queries[2].text, /cycle_runtime_hours IS NULL/);
    assert.equal(f.batches.length, 0);
  } finally { f.close(); }
});

test('concurrent calls coalesce only the pending metadata scan and keep each data check fresh', async () => {
  const f = await readyFixture();
  try {
    let release; f.gate(new Promise(resolve => { release = resolve; }), /FROM sqlite_master/);
    const first = history.ensureBlowerHistorySchemaReady(f.db), second = history.ensureBlowerHistorySchemaReady(f.db);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(presenceQueries(f).length, 1);
    assert.equal(f.queries.filter(query => /setting_count/.test(query.text)).length, 2);
    release(); await Promise.all([first, second]);
    assert.equal(f.queries.length, 9); assert.equal(f.batches.length, 0);
  } finally { f.close(); }
});

test('failed metadata and fallback initialization are discarded so the next request retries immediately', async () => {
  const f = await readyFixture();
  try {
    f.failMetadata(new Error('synthetic metadata failure'));
    f.failBatch(new Error('synthetic initialization failure'));
    await assert.rejects(history.ensureBlowerHistorySchemaReady(f.db), /synthetic initialization/);
    assert.equal(presenceQueries(f).length, 1); assert.equal(f.batches.length, 1);
    f.failMetadata(null); f.failBatch(null); f.reset();
    await history.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(presenceQueries(f).length, 1); assert.equal(f.batches.length, 0);
  } finally { f.close(); }
});

test('successful metadata expires at sixty seconds and missing objects still take the original full fallback', async t => {
  const f = await readyFixture(); let clock = 100000;
  t.mock.method(Date, 'now', () => clock);
  try {
    await history.ensureBlowerHistorySchemaReady(f.db); f.reset();
    clock += 59999; await history.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(presenceQueries(f).length, 0); assert.equal(f.queries.length, 4);
    f.reset(); clock += 1; await history.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(presenceQueries(f).length, 1);
    f.sql.exec('DROP TABLE blower_history_atomic_guard'); f.reset(); clock += 60000;
    await history.ensureBlowerHistorySchemaReady(f.db);
    assert.ok(f.batches.some(batch => batch.some(text => /CREATE TABLE IF NOT EXISTS blower_history_atomic_guard/.test(text))));
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='blower_history_atomic_guard'").get().n, 1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name LIKE '%source_pair%'").get().n, 0);
  } finally { f.close(); }
});

test('metadata cache is isolated by database binding and a cold database still initializes its original schema', async () => {
  const a = await readyFixture(), b = fixture();
  try {
    await history.ensureBlowerHistorySchemaReady(a.db);
    await history.ensureBlowerHistorySchemaReady(b.db);
    assert.ok(b.batches.some(batch => batch.some(text => /CREATE TABLE IF NOT EXISTS blower_history_events/.test(text))));
    b.sql.exec('UPDATE blower_history_assets SET cycle_runtime_hours=COALESCE(cycle_runtime_hours,0)'); b.reset();
    await history.ensureBlowerHistorySchemaReady(b.db);
    assert.equal(presenceQueries(b).length, 1);
    a.reset(); await history.ensureBlowerHistorySchemaReady(a.db);
    assert.equal(presenceQueries(a).length, 0); assert.equal(a.queries.length, 4);
  } finally { a.close(); b.close(); }
});

test('warm metadata cannot delay seed repair or NULL-runtime initialization and is invalidated after fallback', async () => {
  const f = await readyFixture();
  try {
    await history.ensureBlowerHistorySchemaReady(f.db);
    f.sql.prepare('DELETE FROM blower_history_assets WHERE tag_number=?').run('204LMDF01AN001'); f.reset();
    await history.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM blower_history_assets WHERE tag_number='204LMDF01AN001'").get().n, 1);
    assert.ok(f.batches.length > 0);
    f.sql.exec('UPDATE blower_history_assets SET cycle_runtime_hours=COALESCE(cycle_runtime_hours,0)');
    await history.ensureBlowerHistorySchemaReady(f.db); f.reset();
    f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=NULL WHERE tag_number=?').run('104HHL60AP611');
    await history.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(f.sql.prepare("SELECT cycle_runtime_hours n FROM blower_history_assets WHERE tag_number='104HHL60AP611'").get().n, 0);
    assert.ok(f.batches.length > 0);
    f.reset(); await history.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(presenceQueries(f).length, 1);
  } finally { f.close(); }
});

function seedRuntimeRows(f) {
  const active = '104HHL60AP611', second = '204HHL60AP611', disabled = '104HHL60AP621';
  f.sql.prepare('UPDATE blower_history_assets SET enabled=0 WHERE tag_number=?').run(disabled);
  const insert = f.sql.prepare(`INSERT INTO blower_history_events
    (id,tag_number,event_type,event_date,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < 1050; i++) {
    const type = ['runtime_correction','startup','operation_start','operation_stop'][i % 4];
    const stamp = new Date(Date.parse('2026-10-01T00:00:00Z') + i * 1000).toISOString();
    insert.run('active-'+String(i).padStart(4,'0'),active,type,stamp,'manual','','','test','Test',stamp,stamp);
  }
  for (const [id,tag,type] of [['other-active',second,'operation_stop'],['disabled',disabled,'runtime_correction'],['unrelated','UNKNOWN-TAG','startup'],['problem',active,'problem']]) {
    insert.run(id,tag,type,'2026-10-02T00:00:00Z','manual','','','test','Test','2026-10-03T00:00:00Z','2026-10-03T00:00:00Z');
  }
  return { active, second, disabled };
}

test('full asset loading scopes runtime history to every current asset without trimming any per-tag history or changing order', async () => {
  const f = await readyFixture();
  try {
    const { active, disabled } = seedRuntimeRows(f);
    const baseline = f.sql.prepare(`SELECT id,tag_number,event_type,event_date,runtime_hours,source_type,source_log_id,source_text,created_at,updated_at,issue_type,action_type,note
      FROM blower_history_events WHERE event_type IN ('runtime_correction','startup','operation_start','operation_stop')
      ORDER BY created_at DESC,event_date DESC,id DESC`).all();
    const currentTags = f.sql.prepare('SELECT tag_number FROM blower_history_assets WHERE enabled=1 ORDER BY sort_order,tag_number').all().map(row => row.tag_number);
    const states = await history.loadAssetStates(f.db, {});
    const query = f.queries.find(runtimeQuery);
    assert.match(query.text, /AND tag_number IN \(/);
    assert.deepEqual(query.values, [JSON.stringify(currentTags)]);
    assert.equal(/LIMIT/i.test(query.text), false);
    assert.deepEqual(query.rows, baseline.filter(row => currentTags.includes(row.tag_number)));
    assert.equal(query.rows.filter(row => row.tag_number === active).length, 1050);
    assert.equal(query.rows.some(row => row.tag_number === disabled || row.tag_number === 'UNKNOWN-TAG'), false);
    assert.equal(states.some(asset => asset.tagNumber === disabled), false);
  } finally { f.close(); }
});

test('selected-asset planning keeps its full ordered history and an empty selection executes no runtime-history query', async () => {
  const f = await readyFixture();
  try {
    const { active } = seedRuntimeRows(f);
    const selected = f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').all(active);
    await history.loadAssetStates(f.db, {}, { planning: true, skipDecorations: true, assetRows: selected });
    const query = f.queries.find(runtimeQuery);
    assert.deepEqual(query.values, [active]); assert.equal(query.rows.length, 1050);
    f.reset(); assert.deepEqual(await history.loadAssetStates(f.db, {}, { planning: true, skipDecorations: true, assetRows: [] }), []);
    assert.equal(f.queries.some(runtimeQuery), false);
  } finally { f.close(); }
});

test('warm schema readiness never caches live assets or runtime-event results', async () => {
  const f = await readyFixture();
  try {
    const { active } = seedRuntimeRows(f);
    await history.ensureBlowerHistorySchemaReady(f.db);
    const selected = () => f.sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').all(active);
    await history.loadAssetStates(f.db, {}, { planning: true, skipDecorations: true, assetRows: selected() });
    f.sql.prepare('UPDATE blower_history_assets SET display_name=? WHERE tag_number=?').run('Fresh display', active);
    f.sql.prepare("UPDATE blower_history_events SET note='Fresh note' WHERE id='active-0000'").run();
    f.reset(); await history.ensureBlowerHistorySchemaReady(f.db);
    assert.equal(f.queries.length, 4); assert.equal(presenceQueries(f).length, 0);
    const states = await history.loadAssetStates(f.db, {}, { planning: true, skipDecorations: true, assetRows: selected() });
    assert.equal(states[0].displayName, 'Fresh display');
    assert.equal(f.queries.find(runtimeQuery).rows.find(row => row.id === 'active-0000').note, 'Fresh note');
  } finally { f.close(); }
});

function listRouteFixture(expectedTable, row) {
  const calls = [];
  const db = { prepare(text) {
    assert.match(text, new RegExp('FROM '+expectedTable+' AS'));
    return { values: [], bind(...values) { this.values = values; return this; }, async all() { calls.push({ text, values: this.values }); return { results: [row] }; } };
  } };
  return { calls, context: action => ({ env: { DB: db }, request: new Request('https://test/api/blower-history?'+action) }) };
}
const routeRow = { id: 'event-1', tag_number: 'TAG', blower_type: 'fbhe', unit_no: '1', position_label: '#A', display_name: 'Test Blower',
  event_type: 'operation_stop', event_date: '2026-11-01T00:00:00Z', runtime_hours: 12.5, issue_type: 'Test', action_type: 'Stop', note: 'Original note',
  source_type: 'manual', source_log_id: 'source-1', source_text: 'Original source', created_by_id: 'actor', created_by_name: 'Actor',
  created_at: '2026-11-01T00:00:01Z', updated_at: '2026-11-01T00:00:02Z' };
const eventPayload = { id: 'event-1', tagNumber: 'TAG', blowerType: 'fbhe', unitNo: '1', positionLabel: '#A', displayName: 'Test Blower',
  eventType: 'operation_stop', eventDate: '2026-11-01T00:00:00Z', runtimeHours: 12.5, issueType: 'Test', actionType: 'Stop', note: 'Original note',
  sourceType: 'manual', sourceLogId: 'source-1', sourceText: 'Original source', createdById: 'actor', createdByName: 'Actor',
  createdAt: '2026-11-01T00:00:01Z', updatedAt: '2026-11-01T00:00:02Z' };

test('events action returns the same private or sanitized payload and limit using its single list query only', async () => {
  for (const user of [null, { employeeNo: 'test', isSuperAdmin: true }]) {
    const f = listRouteFixture('blower_history_events', routeRow);
    const response = await history.handleGet(f.context('action=events&limit=3'), user);
    const expected = { ...eventPayload };
    if (!user) for (const key of ['id','sourceLogId','createdById','createdByName','createdAt','updatedAt']) delete expected[key];
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, permissions: { canWrite: !!user, canReview: !!user, canAdmin: !!user }, events: [expected] });
    assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].values, [3]);
    assert.match(f.calls[0].text, /event\.event_type <> '_deleted'[\s\S]*ORDER BY event\.event_date DESC, event\.created_at DESC/);
  }
});

test('candidates action preserves authentication, status normalization, bounds and payload without loading asset projections', async () => {
  const user = { employeeNo: 'test', isSuperAdmin: false };
  const row = { ...routeRow, detected_type: 'replacement', detected_date: '2026-10-31', source_shift: 'Day', source_role: 'Control', source_author: 'Author',
    status: 'confirmed', reviewed_by_id: 'reviewer', reviewed_by_name: 'Reviewer', reviewed_at: '2026-11-01' };
  const f = listRouteFixture('blower_history_candidates', row);
  const unauthorized = await history.handleGet(f.context('action=candidates'), null);
  assert.equal(unauthorized.status, 401); assert.equal(f.calls.length, 0);
  const response = await history.handleGet(f.context('action=candidates&status=confirmed&limit=2000'), user);
  assert.equal(response.status, 200); assert.deepEqual(f.calls[0].values, ['confirmed', 1000]);
  assert.deepEqual(await response.json(), { ok: true, permissions: { canWrite: true, canReview: true, canAdmin: false }, candidates: [{
    id: 'event-1', tagNumber: 'TAG', blowerType: 'fbhe', unitNo: '1', positionLabel: '#A', displayName: 'Test Blower', detectedType: 'replacement',
    detectedDate: '2026-10-31', issueType: 'Test', actionType: 'Stop', sourceLogId: 'source-1', sourceShift: 'Day', sourceRole: 'Control', sourceAuthor: 'Author',
    sourceText: 'Original source', status: 'confirmed', reviewedById: 'reviewer', reviewedByName: 'Reviewer', reviewedAt: '2026-11-01', createdAt: '2026-11-01T00:00:01Z'
  }] });
  await history.handleGet(f.context('action=candidates&status=unknown'), user);
  assert.deepEqual(f.calls[1].values, ['pending', 300]); assert.equal(f.calls.length, 2);
});

test('unknown actions retain the full-data fallback payload while loading settings and runtime history only once', async () => {
  const f = await readyFixture();
  try {
    const context = action => ({ env: { DB: f.db }, request: new Request('https://test/api/blower-history?action='+action) });
    const normal = await (await history.handleGet(context('data'), null)).json();
    assert.equal(f.queries.filter(runtimeQuery).length, 1);
    f.reset(); const fallback = await (await history.handleGet(context('unknown-action'), null)).json();
    assert.equal(f.queries.filter(runtimeQuery).length, 1);
    assert.equal(f.queries.filter(query => /FROM blower_history_settings/.test(query.text)).length, 1);
    delete normal.generatedAt; delete fallback.generatedAt;
    assert.deepEqual(fallback, normal);
  } finally { f.close(); }
});


test('more than one hundred active assets use one JSON bind and retain every selected runtime event in order', async () => {
  const f = await readyFixture();
  try {
    seedRuntimeRows(f);
    const insertAsset = f.sql.prepare(`INSERT INTO blower_history_assets
      (tag_number,blower_type,unit_no,position_label,display_name,sort_order,created_at,updated_at) VALUES(?,'fbhe','1',?,?,?,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')`);
    const insertEvent = f.sql.prepare(`INSERT INTO blower_history_events
      (id,tag_number,event_type,event_date,created_by_id,created_by_name,created_at,updated_at)
      VALUES(?,?,'runtime_correction','2026-11-01T00:00:00Z','test','Test','2026-11-02T00:00:00Z','2026-11-02T00:00:00Z')`);
    for (let i = 0; i < 120; i++) {
      const tag = 'CUSTOM'+String(i).padStart(3,'0');
      insertAsset.run(tag,'#X'+i,'Custom asset '+i,1000+i); insertEvent.run('custom-event-'+i,tag);
    }
    const tags = f.sql.prepare('SELECT tag_number FROM blower_history_assets WHERE enabled=1 ORDER BY sort_order,tag_number').all().map(row => row.tag_number);
    assert.ok(tags.length > 100);
    const selectedTags = new Set(tags);
    const expected = f.sql.prepare(`SELECT id,tag_number,event_type,event_date,runtime_hours,source_type,source_log_id,source_text,created_at,updated_at,issue_type,action_type,note
      FROM blower_history_events WHERE event_type IN ('runtime_correction','startup','operation_start','operation_stop')
      ORDER BY created_at DESC,event_date DESC,id DESC`).all().filter(row => selectedTags.has(row.tag_number));
    const assets = await history.loadAssetStates(f.db, {});
    const query = f.queries.find(runtimeQuery);
    assert.match(query.text, /tag_number IN \(SELECT value FROM json_each\(\?\)\)/);
    assert.deepEqual(query.values, [JSON.stringify(tags)]); assert.equal(query.values.length, 1);
    assert.deepEqual(query.rows, expected); assert.equal(query.rows.length, 1171);
    assert.equal(assets.length, tags.length);
    const selected = f.sql.prepare('SELECT * FROM blower_history_assets WHERE enabled=1 ORDER BY sort_order,tag_number').all();
    f.reset(); await history.loadAssetStates(f.db, {}, { planning: true, skipDecorations: true, assetRows: selected });
    const selectedQuery = f.queries.find(runtimeQuery);
    assert.deepEqual(selectedQuery.values, [JSON.stringify(tags)]); assert.equal(selectedQuery.values.length, 1);
    assert.deepEqual(selectedQuery.rows, expected);
  } finally { f.close(); }
});
