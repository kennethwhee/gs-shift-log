import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, browserCreate, agentClaim, agentComplete, callApi, BROWSER_TOKEN, history, historyPost } from './helpers/blower-incremental-fixture.mjs';

const realDate = Date;
const origin = '2026-05-11T00:00:00+09:00';
const firstBoundary = '2026-06-11T00:00:00+09:00';
const startup = '2026-06-11T00:03:15.000+09:00';
const firstRunStartedAt = new Date(startup).toISOString();
const sealA = '204HHL10AN611';
const sealC = '204HHL10AN631';

async function scenario(tag = sealA, signal = `GSPOGE.ABB_DCS.${tag}XB04`) {
  let clock = Date.parse('2026-06-15T00:00:00+09:00');
  globalThis.Date = class extends realDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  try {
    const f = await fixture(tag, true);
    f.sqlite.prepare('UPDATE blower_history_assets SET last_replacement_at = ? WHERE tag_number = ?').run(origin, tag);
    f.advance = () => { clock += 3600000; };
    f.asset = () => f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number = ?').get(tag);
    f.rows = () => f.sqlite.prepare(`SELECT * FROM blower_history_events WHERE tag_number = ?
      ORDER BY created_at DESC, event_date DESC, id DESC`).all(tag);
    f.basis = (rows = f.rows()) => history.currentDataParcRuntimeBasis(f.asset(), rows);
    f.create = async ({ startAt = origin, append = false } = {}) => {
      const asset = f.asset();
      const response = await browserCreate(f.database, {
        action: 'create_blower_runtime_probe', assetTag: tag, dataParcTag: signal,
        confirmRunSignal: true, startAt,
        ...(append ? { unifiedRefresh: true, incrementalRefresh: true,
          expectedLastReplacementAt: asset.last_replacement_at,
          expectedCycleStartState: asset.cycle_start_state,
          expectedCycleStartedAt: asset.cycle_started_at || '',
          expectedCycleStartRevision: asset.cycle_start_revision,
          expectedCycleRuntimeRevision: asset.cycle_runtime_revision } : {})
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      const claim = await agentClaim(f.database);
      assert.equal(claim.status, 200, JSON.stringify(claim.body));
      const item = claim.body.items.excel;
      assert.equal(item.id, response.body.item.id);
      return item;
    };
    f.complete = async (item, chunks, extra = {}) => {
      const runningSeconds = chunks.reduce((sum, chunk) => sum + chunk.runningSeconds, 0);
      const result = await agentComplete(f.database, item.id, {
        ...item.probe, ok: true, observedAt: item.probe.endAt, collectedAt: new Date().toISOString(),
        completedChunkCount: chunks.length, chunks, runningSeconds, totalRunningHours: runningSeconds / 3600,
        startState: chunks[0].startState, endState: chunks.at(-1).endState, ...extra
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return f.request(item.id);
    };
    f.request = id => JSON.parse(f.sqlite.prepare('SELECT result_json FROM ois_data_requests WHERE id = ?').get(id).result_json);
    f.sync = id => callApi(historyPost, f.database, new Request('https://example.test/api/blower-history', {
      method: 'POST', headers: { Authorization: `Bearer ${BROWSER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dataparc_runtime_sync', requestId: id, requireFirstRunStart: true })
    }));
    f.syncAppend = id => callApi(historyPost, f.database, new Request('https://example.test/api/blower-history', {
      method: 'POST', headers: { Authorization: `Bearer ${BROWSER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dataparc_runtime_sync', requestId: id })
    }));
    f.close = () => { f.database.close(); globalThis.Date = realDate; };
    return f;
  } catch (error) {
    globalThis.Date = realDate;
    throw error;
  }
}

function chunk(index, startAt, endAt, startState, endState, runningSeconds) {
  return { index, startAt, endAt, startState, endState, runningSeconds, totalRunningHours: runningSeconds / 3600 };
}

function fullChunks(item, prefixSeconds = 0, initialState = 'stopped') {
  return [chunk(1, item.probe.startAt, firstBoundary, initialState, 'stopped', prefixSeconds),
    chunk(2, firstBoundary, item.probe.endAt, 'stopped', 'running', 3600)];
}

for (const tag of [sealA, sealC]) test(`${tag} stores full verified first RUN, preserves origin, and carries proof through later transitions and replay`, async () => {
  const f = await scenario(tag);
  try {
    const item = await f.create();
    assert.equal((await f.complete(item, fullChunks(item), { firstRunStartedAt })).firstRunStartedAt, firstRunStartedAt);
    const result = await f.sync(item.id);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.runtimeHours, 1);
    assert.equal(f.asset().last_replacement_at, origin);
    assert.equal(f.asset().cycle_start_state, 'legacy');
    assert.equal(f.asset().cycle_started_at, null);
    assert.equal(f.basis().firstRunStartedAt, firstRunStartedAt);
    assert.equal(f.basis().coverageComplete, true);
    assert.equal(Date.parse(f.basis().startAt), Date.parse(origin));
    assert.equal((await f.sync(item.id)).body.replayed, true);

    f.advance();
    const append = await f.create({ append: true });
    const stop = chunk(1, append.probe.startAt, append.probe.endAt, 'running', 'stopped', 1800);
    assert.equal((await f.complete(append, [stop], { firstRunStartedAt })).firstRunStartedAt, undefined);
    const after = await f.syncAppend(append.id);
    assert.equal(after.status, 200, JSON.stringify(after.body));
    assert.equal(after.body.runtimeHours, 1.5);
    assert.equal(f.basis().firstRunStartedAt, firstRunStartedAt);
    assert.equal(JSON.parse(f.rows()[0].source_text).firstRunStartedAt, undefined);
    assert.equal(f.basis(f.rows().slice(0, 1)).firstRunStartedAt, undefined);
    assert.equal((await f.syncAppend(append.id)).body.replayed, true);
  } finally { f.close(); }
});

test('first RUN guard rejects a prior positive chunk even if its timestamp is forged into the saved completion', async () => {
  const f = await scenario();
  try {
    const item = await f.create();
    const normalized = await f.complete(item, fullChunks(item, 10), { firstRunStartedAt });
    assert.equal(normalized.firstRunStartedAt, undefined);
    f.sqlite.prepare('UPDATE ois_data_requests SET result_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...normalized, firstRunStartedAt }), item.id);
    const before = f.asset(), rows = f.rows();
    const result = await f.sync(item.id);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'DATAPARC_FIRST_RUN_UNVERIFIED');
    assert.deepEqual(f.asset(), before);
    assert.deepEqual(f.rows(), rows);
  } finally { f.close(); }
});

test('running at the origin and incomplete historical coverage cannot certify first RUN', async () => {
  const f = await scenario();
  try {
    const item = await f.create();
    assert.equal((await f.complete(item, fullChunks(item, 1, 'running'), { firstRunStartedAt })).firstRunStartedAt, undefined);
    assert.equal((await f.sync(item.id)).body.code, 'DATAPARC_FIRST_RUN_UNVERIFIED');

    f.advance();
    const partial = await f.create({ startAt: firstBoundary });
    const onlyChunk = chunk(1, partial.probe.startAt, partial.probe.endAt, 'stopped', 'running', 3600);
    assert.equal((await f.complete(partial, [onlyChunk], { firstRunStartedAt })).firstRunStartedAt, undefined);
    assert.equal((await f.sync(partial.id)).body.code, 'DATAPARC_FIRST_RUN_UNVERIFIED');
    assert.equal(f.asset().cycle_runtime_hours, 77);
    assert.deepEqual(f.rows(), []);
  } finally { f.close(); }
});

test('other equipment and non-matching RUN signal do not acquire the scoped first RUN proof', async () => {
  for (const [tag, signal] of [['204HHL10AN621', undefined], [sealA, 'GSPOGE.ABB_DCS.OTHER_SIGNAL']]) {
    const f = await scenario(tag, signal);
    try {
      const item = await f.create();
      assert.equal((await f.complete(item, fullChunks(item), { firstRunStartedAt })).firstRunStartedAt, undefined);
      assert.equal((await f.sync(item.id)).body.code, 'DATAPARC_FIRST_RUN_UNVERIFIED');
      assert.equal(f.asset().cycle_runtime_hours, 77);
    } finally { f.close(); }
  }
});
