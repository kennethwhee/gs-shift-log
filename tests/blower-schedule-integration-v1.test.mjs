import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { onRequestPost as requestPost } from '../functions/api/ois-data-requests.js';
import {
  fixture, browserCreate, agentClaim, agentComplete, agent, callApi,
  historyPost, addBrowserIdentity, BROWSER_TOKEN, BROWSER_EMPLOYEE_NO
} from './helpers/blower-incremental-fixture.mjs';

const TAG_A = '104ETH03AN601';
const TAG_B = '104ETH03AN602';
const SIGNAL_A = 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_104ETH03AN601';
const SIGNAL_B = 'GSPOGE.ABB_DCS.003ETH03AN602XB04';
const DEVICE_KEY = 'a'.repeat(64);
const RUN_TOKEN = 'b'.repeat(64);
const SLOT_KEY = '2026-09-15T19:00:00.000Z'; // 2026-09-16 04:00 KST.
const INITIAL_CLOCK = '2026-09-15T19:00:30.000Z';
const realDate = Date;

function installClock() {
  let now = realDate.parse(INITIAL_CLOCK);
  globalThis.Date = class extends realDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  return { advance(milliseconds) { now += milliseconds; } };
}

async function withFixture(callback) {
  const clock = installClock();
  let f;
  try {
    f = await fixture(TAG_A, true);
    const source = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    f.sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at=?, cycle_start_state=?,
      cycle_started_at=?, cycle_start_revision=?, cycle_runtime_revision=?, cycle_runtime_hours=?,
      cycle_runtime_state=?, runtime_hours=?, is_running=1 WHERE tag_number=?`).run(
      source.last_replacement_at, source.cycle_start_state, source.cycle_started_at,
      'schedule-second-start-r1', 'schedule-second-runtime-r1', 77, 'running', 77, TAG_B
    );
    await callback({ ...f, clock });
  } finally {
    f?.database.close();
    globalThis.Date = realDate;
  }
}

function metadata(extra = {}) {
  return { deviceKey: DEVICE_KEY, runToken: RUN_TOKEN, slotKey: SLOT_KEY, ...extra };
}

function item(sqlite, tag, dataParcTag) {
  const asset = sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  return {
    action: 'create_blower_runtime_probe', unifiedRefresh: true, incrementalRefresh: true,
    requireIncrementalAppend: false, assetTag: tag, dataParcTag, confirmRunSignal: true,
    startAt: asset.cycle_started_at || asset.last_replacement_at,
    expectedLastReplacementAt: asset.last_replacement_at,
    expectedCycleStartState: asset.cycle_start_state || 'legacy',
    expectedCycleStartedAt: asset.cycle_started_at || '',
    expectedCycleStartRevision: asset.cycle_start_revision || '',
    expectedCycleRuntimeRevision: asset.cycle_runtime_revision || ''
  };
}

function batchBody(sqlite, scheduledRefresh = metadata()) {
  return {
    action: 'create_blower_runtime_probe_batch', scheduledRefresh,
    requests: [item(sqlite, TAG_A, SIGNAL_A), item(sqlite, TAG_B, SIGNAL_B)]
  };
}

async function authenticatedPost(handler, database, route, body, {
  token = BROWSER_TOKEN, clientMode
} = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (clientMode) headers['X-GS-Client-Mode'] = clientMode;
  return callApi(handler, database, new Request(`https://example.test/api/${route}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  }));
}

function schedule(database, operation, body = {}, options) {
  return authenticatedPost(historyPost, database, 'blower-history', {
    action: 'scheduled_refresh', operation, ...body
  }, options);
}

function scheduledCreate(database, body, options) {
  return authenticatedPost(requestPost, database, 'ois-data-requests', body, options);
}

function successful(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.ok, true, JSON.stringify(response.body));
  return response.body;
}

async function registerAndClaim(database) {
  const registered = successful(await schedule(database, 'register', {
    deviceKey: DEVICE_KEY, confirmedPhysicalBco1: true, expectedRevision: 0
  }));
  assert.equal(registered.thisDevice, true);
  assert.equal(registered.enabled, true);
  assert.equal(registered.revision, 1);
  const claimed = successful(await schedule(database, 'claim', metadata()));
  assert.equal(claimed.acquired, true);
  assert.equal(claimed.slotKey, SLOT_KEY);
}

function storedReceipt(sqlite) {
  const row = sqlite.prepare('SELECT batch_receipt FROM blower_schedule_slots_v1 WHERE slot_key=?').get(SLOT_KEY);
  return row?.batch_receipt ? JSON.parse(row.batch_receipt) : null;
}

function queue(sqlite) {
  return sqlite.prepare("SELECT * FROM ois_data_requests WHERE request_type='blower_runtime_probe' ORDER BY id").all();
}

function expectedReceipt(body) {
  return {
    version: 1, requestedCount: body.requestedCount,
    items: body.results.filter(result => result.item).map(result => ({ id: result.item.id, assetTag: result.assetTag })),
    upToDateTags: body.results.filter(result => result.upToDate === true).map(result => result.assetTag)
  };
}

function validProbeResult(claimed) {
  const expected = agent.parseClaim(claimed);
  const runningSeconds = 90;
  return agent.normalizeResult({
    ...claimed.probe, ok: true, observedAt: claimed.probe.endAt,
    collectedAt: new Date().toISOString(), completedChunkCount: 1,
    startState: 'stopped', endState: 'stopped', runningSeconds,
    totalRunningHours: runningSeconds / 3600,
    chunks: [{ index: 1, startAt: claimed.probe.startAt, endAt: claimed.probe.endAt,
      startState: 'stopped', endState: 'stopped', runningSeconds,
      totalRunningHours: runningSeconds / 3600 }]
  }, expected);
}

test('authenticated slot creates one atomic batch with exact durable receipt; replay cannot enqueue again', async () => {
  await withFixture(async ({ database, sqlite }) => {
    await registerAndClaim(database);
    const body = batchBody(sqlite);
    const created = successful(await scheduledCreate(database, body), 201);
    assert.equal(created.createdCount, 2);
    assert.equal(created.atomic, true);
    const ids = created.results.map(result => result.item.id);
    assert.equal(new Set(ids.map(id => id.slice(0, 45))).size, 1, 'both assets belong to one Agent batch');
    assert.deepEqual(queue(sqlite).map(row => row.id).sort(), [...ids].sort());
    const receipt = expectedReceipt(created);
    assert.deepEqual(storedReceipt(sqlite), receipt);

    const beforeReplay = queue(sqlite);
    const replay = await scheduledCreate(database, body);
    assert.equal(replay.status, 409, JSON.stringify(replay.body));
    assert.equal(replay.body.ok, false);
    assert.deepEqual(queue(sqlite), beforeReplay);
    assert.deepEqual(storedReceipt(sqlite), receipt);

    const recovered = successful(await schedule(database, 'check', { ...metadata(), purpose: 'resume' }));
    assert.equal(recovered.allowed, true);
    assert.deepEqual(recovered.batchReceipt, receipt, 'lost HTTP response can recover the committed IDs');
  });
});

test('receipt records an actually completed reused request and a new sibling without replacing the reused ID', async () => {
  await withFixture(async ({ database, sqlite }) => {
    const manual = successful(await browserCreate(database, item(sqlite, TAG_A, SIGNAL_A)), 201);
    const claimed = successful(await agentClaim(database)).items.excel;
    assert.equal(claimed.id, manual.item.id);
    successful(await agentComplete(database, claimed.id, validProbeResult(claimed)));
    await registerAndClaim(database);

    const created = successful(await scheduledCreate(database, batchBody(sqlite)), 201);
    assert.equal(created.createdCount, 1);
    assert.equal(created.reusedCount, 1);
    assert.equal(created.results[0].disposition, 'reused_complete');
    assert.equal(created.results[0].item.id, manual.item.id);
    assert.equal(created.results[1].disposition, 'created');
    assert.equal(queue(sqlite).length, 2);
    assert.deepEqual(storedReceipt(sqlite), expectedReceipt(created));
    const recovered = successful(await schedule(database, 'check', { ...metadata(), purpose: 'resume' }));
    assert.deepEqual(recovered.batchReceipt, expectedReceipt(created));
  });
});

test('configuration revision race at the real transaction boundary leaves no receipt or partial queue', async () => {
  await withFixture(async ({ database, sqlite }) => {
    await registerAndClaim(database);
    const originalBatch = database.batch.bind(database);
    let injected = false;
    database.batch = async statements => {
      if (!injected && statements.some(statement => /BLOWER_SCHEDULE_BATCH_CAS_V1/.test(statement.sql))) {
        injected = true;
        sqlite.prepare('UPDATE blower_schedule_config_v1 SET revision=revision+1 WHERE singleton=1').run();
      }
      return originalBatch(statements);
    };
    const rejected = await scheduledCreate(database, batchBody(sqlite));
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(injected, true);
    assert.equal(storedReceipt(sqlite), null);
    assert.deepEqual(queue(sqlite), []);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM blower_runtime_probe_intents_v4').get().count, 0);
  });
});

test('asset cycle race rolls back the scheduled receipt, prior-request retirement and all new siblings', async () => {
  await withFixture(async ({ database, sqlite }) => {
    await registerAndClaim(database);
    const manual = successful(await browserCreate(database, item(sqlite, TAG_A, SIGNAL_A)), 201);
    sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
      .run('prepared-schedule-runtime-r2', TAG_A);
    const body = batchBody(sqlite);
    const beforeQueue = queue(sqlite);
    const beforeIntent = sqlite.prepare('SELECT * FROM blower_runtime_probe_intents_v4 WHERE request_id=?').get(manual.item.id);
    const originalBatch = database.batch.bind(database);
    let injected = false;
    database.batch = async statements => {
      if (!injected && statements.some(statement => /BLOWER_RUNTIME_BATCH_ASSET_CAS_V1/.test(statement.sql))) {
        injected = true;
        sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
          .run('newer-schedule-runtime-r3', TAG_A);
      }
      return originalBatch(statements);
    };

    const rejected = await scheduledCreate(database, body);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_SNAPSHOT_CONFLICT');
    assert.equal(injected, true);
    assert.equal(storedReceipt(sqlite), null, 'receipt written earlier in the batch must roll back too');
    assert.deepEqual(queue(sqlite), beforeQueue);
    assert.deepEqual(sqlite.prepare('SELECT * FROM blower_runtime_probe_intents_v4 WHERE request_id=?').get(manual.item.id), beforeIntent);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM blower_runtime_probe_intents_v4').get().count, 1);
    assert.equal(sqlite.prepare('SELECT cycle_runtime_revision FROM blower_history_assets WHERE tag_number=?').get(TAG_A).cycle_runtime_revision,
      'newer-schedule-runtime-r3');
  });
});

test('wrong login, wrong credentials, expired runs and extra request metadata reject without queue writes', async () => {
  await withFixture(async ({ database, sqlite, clock }) => {
    await registerAndClaim(database);
    addBrowserIdentity(sqlite, { token: 'other-browser-token', employeeNo: 'other-employee', name: '다른 로그인' });
    const cases = [
      { name: 'wrong login', body: batchBody(sqlite), token: 'other-browser-token', status: 403 },
      { name: 'wrong device', body: batchBody(sqlite, metadata({ deviceKey: 'c'.repeat(64) })), status: 403 },
      { name: 'wrong run token', body: batchBody(sqlite, metadata({ runToken: 'd'.repeat(64) })), status: 403 },
      { name: 'malformed key', body: batchBody(sqlite, metadata({ deviceKey: 'short' })), status: 400 },
      { name: 'extra scheduling key', body: batchBody(sqlite, metadata({ unreviewedOption: true })), status: 400 },
      { name: 'extra batch key', body: { ...batchBody(sqlite), unreviewedOption: true }, status: 400 }
    ];
    for (const entry of cases) {
      const response = await scheduledCreate(database, entry.body, { token: entry.token || BROWSER_TOKEN });
      assert.equal(response.status, entry.status, `${entry.name}: ${JSON.stringify(response.body)}`);
      assert.deepEqual(queue(sqlite), [], entry.name);
      assert.equal(storedReceipt(sqlite), null, entry.name);
    }
    clock.advance(10 * 60 * 1000 + 1);
    const expired = await scheduledCreate(database, batchBody(sqlite));
    assert.equal(expired.status, 409, JSON.stringify(expired.body));
    assert.deepEqual(queue(sqlite), []);
    assert.equal(storedReceipt(sqlite), null);
  });
});

test('public and mobile clients cannot register or submit scheduled work through actual API routes', async () => {
  await withFixture(async ({ database, sqlite }) => {
    const register = { deviceKey: DEVICE_KEY, confirmedPhysicalBco1: true, expectedRevision: 0 };
    const publicRegister = await schedule(database, 'register', register, { token: null });
    assert.equal(publicRegister.status, 401, JSON.stringify(publicRegister.body));
    const mobileRegister = await schedule(database, 'register', register, { clientMode: 'mobile-monitoring' });
    assert.equal(mobileRegister.status, 403, JSON.stringify(mobileRegister.body));
    const status = successful(await schedule(database, 'status', { deviceKey: DEVICE_KEY }));
    assert.equal(status.enabled, false);
    assert.equal(status.revision, 0);
    await registerAndClaim(database);

    for (const [options, expectedStatus] of [[{ token: null }, 401], [{ clientMode: 'mobile-monitoring' }, 403]]) {
      const response = await scheduledCreate(database, batchBody(sqlite), options);
      assert.equal(response.status, expectedStatus, JSON.stringify(response.body));
      assert.deepEqual(queue(sqlite), []);
      assert.equal(storedReceipt(sqlite), null);
    }
  });
});

test('unauthenticated malformed scheduling requests cannot look up slot state or disclose its receipt', async () => {
  await withFixture(async ({ database, sqlite }) => {
    await registerAndClaim(database);
    successful(await scheduledCreate(database, batchBody(sqlite)), 201);
    const receipt = storedReceipt(sqlite);
    const originalPrepare = database.prepare.bind(database);
    let slotLookups = 0;
    database.prepare = sql => {
      if (/\bFROM\s+blower_schedule_slots_v1\b/i.test(sql)) slotLookups += 1;
      return originalPrepare(sql);
    };
    const malformedCheck = await schedule(database, 'check', {
      ...metadata(), runToken: { value: RUN_TOKEN }, purpose: 'resume'
    }, { token: null });
    assert.equal(malformedCheck.status, 401, JSON.stringify(malformedCheck.body));
    const malformedBatch = await scheduledCreate(database, batchBody(sqlite, []), { token: null });
    assert.equal(malformedBatch.status, 401, JSON.stringify(malformedBatch.body));

    for (const [handler, route] of [[historyPost, 'blower-history'], [requestPost, 'ois-data-requests']]) {
      const response = await callApi(handler, database, new Request(`https://example.test/api/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
      }));
      assert.ok([400, 401].includes(response.status), JSON.stringify(response.body));
      assert.equal(response.body.ok, false);
      assert.equal(response.body.batchReceipt, undefined);
    }
    assert.equal(slotLookups, 0);
    assert.equal(malformedCheck.body.batchReceipt, undefined);
    assert.equal(malformedBatch.body.batchReceipt, undefined);
    assert.deepEqual(storedReceipt(sqlite), receipt);
  });
});

test('slot receipt survives disable and re-enable so a second registration cannot rerun the same KST slot', async () => {
  await withFixture(async ({ database, sqlite }) => {
    await registerAndClaim(database);
    const repeated = successful(await schedule(database, 'claim', metadata({ runToken: 'e'.repeat(64) })));
    assert.equal(repeated.acquired, false);
    successful(await schedule(database, 'disable', { deviceKey: DEVICE_KEY, expectedRevision: 1 }));
    successful(await schedule(database, 'register', {
      deviceKey: DEVICE_KEY, confirmedPhysicalBco1: true, expectedRevision: 2
    }));
    const afterRegistration = successful(await schedule(database, 'claim', metadata({ runToken: 'f'.repeat(64) })));
    assert.equal(afterRegistration.acquired, false);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM blower_schedule_slots_v1').get().count, 1);
    const staleAuthorization = await scheduledCreate(database, batchBody(sqlite));
    assert.equal(staleAuthorization.status, 409, JSON.stringify(staleAuthorization.body));
    assert.deepEqual(queue(sqlite), []);
    assert.equal(storedReceipt(sqlite), null);
  });
});

test('a fresh session for the original user recovers a lost response after the create window without reenqueuing', async () => {
  await withFixture(async ({ database, sqlite, clock }) => {
    await registerAndClaim(database);
    successful(await scheduledCreate(database, batchBody(sqlite)), 201);
    // Treat the HTTP create response as lost; only durable server state is used.
    const persisted = storedReceipt(sqlite);
    const beforeResume = queue(sqlite);
    clock.advance(11 * 60 * 1000);
    const replacementToken = 'relogged-in-original-owner';
    sqlite.prepare(`INSERT INTO shift_log_sessions(token_hash,employee_no,expires_at,last_used_at)
      VALUES (?,?,?,?)`).run(
      createHash('sha256').update(replacementToken).digest('hex'), BROWSER_EMPLOYEE_NO,
      new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()
    );
    const options = { token: replacementToken };
    const recovered = successful(await schedule(database, 'check', { ...metadata(), purpose: 'resume' }, options));
    assert.deepEqual(recovered.batchReceipt, persisted);
    assert.deepEqual(recovered.batchReceipt.items.map(entry => entry.id).sort(), beforeResume.map(entry => entry.id).sort());
    const replay = await scheduledCreate(database, batchBody(sqlite), options);
    assert.equal(replay.status, 409, JSON.stringify(replay.body));
    assert.deepEqual(queue(sqlite), beforeResume);
    assert.deepEqual(storedReceipt(sqlite), persisted);
  });
});
