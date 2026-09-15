import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestPost } from '../functions/api/ois-data-requests.js';
import {
  fixture,
  browserCreate,
  agentClaim,
  agentComplete,
  callApi,
  agent,
  BROWSER_TOKEN,
  historyPost
} from './helpers/blower-incremental-fixture.mjs';

const TAG_A = '104ETH03AN601';
const TAG_B = '104ETH03AN602';
const TAG_C = '104ETG30AN601';
const TAG_D = '104ETG30AN602';
const SIGNAL_A = 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_104ETH03AN601';
const SIGNAL_B = 'GSPOGE.ABB_DCS.003ETH03AN602XB04';
const SIGNAL_C = 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_104ETG30AN601';
const SIGNAL_D = 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_104ETG30AN602';
const SUPPORTED_TAGS = [
  '104ETH03AN601', '104ETH03AN602',
  '104ETG30AN601', '104ETG30AN602', '204ETG30AN601', '204ETG30AN602',
  '104SDF01AN001', '104SDF01AN002', '204SDF01AN001', '204SDF01AN002', '204LMDF01AN001',
  '104HHL60AP611', '104HHL60AP621', '104HHL60AP631',
  '204HHL60AP611', '204HHL60AP621', '204HHL60AP631',
  '104HHL10AN611', '104HHL10AN621', '104HHL10AN631',
  '204HHL10AN611', '204HHL10AN621', '204HHL10AN631'
];
const realDate = Date;
const API_SOURCE = readFileSync(
  new URL('../functions/api/ois-data-requests.js', import.meta.url),
  'utf8'
);


test('durable group SQL patterns stay within the D1 50-byte GLOB limit', () => {
  const patternValues = new Map(
    [...API_SOURCE.matchAll(/const\s+([A-Z0-9_]+_GLOB)\s*=\s*\n?\s*"([^"]*)";/g)]
      .map(match => [match[1], match[2]])
  );
  const patternReferences = [
    ...API_SOURCE.matchAll(/\b(?:LIKE|GLOB)\s+'(?:\$\{([A-Z0-9_]+_GLOB)\}|([^']*))'/g)
  ];
  assert.ok(patternReferences.length >= 7, 'expected durable-group GLOB checks');
  for (const match of patternReferences) {
    const value = match[1] ? patternValues.get(match[1]) : match[2];
    assert.notEqual(value, undefined, `missing SQL pattern constant ${match[1]}`);
    assert.ok(
      Buffer.byteLength(value, 'utf8') <= 50,
      `D1 rejects ${Buffer.byteLength(value, 'utf8')}-byte pattern ${value}`
    );
  }
  assert.doesNotMatch(
    API_SOURCE,
    /brb1_\?{8}-\?{4}-\?{4}-\?{4}-\?{12}/,
    'durable IDs must use short segment checks instead of a full-ID GLOB'
  );
});

function installClock(initial) {
  let clock = realDate.parse(initial);
  globalThis.Date = class extends realDate {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() {
      return clock;
    }
  };
  return milliseconds => {
    clock += milliseconds;
  };
}

function configureSecondAsset(sqlite, sourceRow) {
  sqlite.prepare(`UPDATE blower_history_assets
    SET last_replacement_at = ?, cycle_start_state = ?, cycle_started_at = ?,
        cycle_start_revision = ?, cycle_runtime_revision = ?, cycle_runtime_hours = ?,
        cycle_runtime_state = ?, runtime_hours = ?, is_running = 1
    WHERE tag_number = ?`).run(
      sourceRow.last_replacement_at,
      sourceRow.cycle_start_state,
      sourceRow.cycle_started_at,
      'second-start-r1',
      'second-runtime-r1',
      77,
      'running',
      77,
      TAG_B
    );
}

function configureThirdAsset(sqlite, sourceRow) {
  sqlite.prepare(`UPDATE blower_history_assets
    SET last_replacement_at = ?, cycle_start_state = ?, cycle_started_at = ?,
        cycle_start_revision = ?, cycle_runtime_revision = ?, cycle_runtime_hours = ?,
        cycle_runtime_state = ?, runtime_hours = ?, is_running = 1
    WHERE tag_number = ?`).run(
      sourceRow.last_replacement_at,
      sourceRow.cycle_start_state,
      sourceRow.cycle_started_at,
      'third-start-r1',
      'third-runtime-r1',
      88,
      'running',
      88,
      TAG_C
    );
}

function configureFourthAsset(sqlite, sourceRow) {
  sqlite.prepare(`UPDATE blower_history_assets
    SET last_replacement_at = ?, cycle_start_state = ?, cycle_started_at = ?,
        cycle_start_revision = ?, cycle_runtime_revision = ?, cycle_runtime_hours = ?,
        cycle_runtime_state = ?, runtime_hours = ?, is_running = 1
    WHERE tag_number = ?`).run(
      sourceRow.last_replacement_at,
      sourceRow.cycle_start_state,
      sourceRow.cycle_started_at,
      'fourth-start-r1',
      'fourth-runtime-r1',
      99,
      'running',
      99,
      TAG_D
    );
}

function createBody(sqlite, tag, dataParcTag, extra = {}) {
  const asset = sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number = ?').get(tag);
  return {
    action: 'create_blower_runtime_probe',
    unifiedRefresh: true,
    incrementalRefresh: true,
    requireIncrementalAppend: false,
    assetTag: tag,
    dataParcTag,
    confirmRunSignal: true,
    startAt: asset.cycle_started_at || asset.last_replacement_at,
    expectedLastReplacementAt: asset.last_replacement_at,
    expectedCycleStartState: asset.cycle_start_state || 'legacy',
    expectedCycleStartedAt: asset.cycle_started_at || '',
    expectedCycleStartRevision: asset.cycle_start_revision || '',
    expectedCycleRuntimeRevision: asset.cycle_runtime_revision || '',
    ...extra
  };
}

async function batchCreate(database, requests) {
  return browserCreate(database, {
    action: 'create_blower_runtime_probe_batch',
    requests
  });
}

function countExecutedStatements(database) {
  const originalPrepare = database.prepare.bind(database);
  let count = 0;
  database.prepare = sql => {
    const statement = originalPrepare(sql);
    for (const method of ['run', 'all', 'first']) {
      const original = statement[method].bind(statement);
      statement[method] = async (...args) => {
        count += 1;
        return original(...args);
      };
    }
    return statement;
  };
  return () => count;
}

function insertPendingProbe(sqlite, { id, requestedAt, owner = 'batch-owner' }) {
  const startAt = '2026-09-10T00:00:00+09:00';
  const endAt = '2026-09-11T00:00:00+09:00';
  const assetTag = TAG_B;
  sqlite.prepare(`INSERT INTO ois_data_requests
    (id,request_type,target_date,status,requested_by_id,requested_by_name,requested_at,started_at,completed_at,
     agent_id,result_json,error_message,expires_at,updated_at)
    VALUES (?,'blower_runtime_probe',?,'pending',?,'queue test',?,NULL,NULL,'',NULL,'',?,?)`).run(
      id, `v1|${assetTag}|${startAt}|${endAt}`, owner, requestedAt, '2026-09-13T00:00:00.000Z', requestedAt
    );
  sqlite.prepare(`INSERT INTO blower_runtime_probe_intents_v4
    (request_id,reuse_key,schema_version,asset_tag,dataparc_tag,window_start,window_end,chunk_days,chunk_count,
     expected_last_replacement_at,expected_cycle_start_state,expected_cycle_started_at,expected_cycle_start_revision,
     expected_cycle_runtime_revision,created_at,updated_at)
    VALUES (?,?,1,?,?,?, ?,31,1,?,'legacy','','',?,?,?)`).run(
      id, `queue:${id}`, assetTag, SIGNAL_B, startAt, endAt, startAt, `${id}:runtime`, requestedAt, requestedAt
    );
}

function groupedRequestId(uuid, total, index) {
  return `brb1_${uuid}_${String(total).padStart(2, '0')}_${String(index).padStart(2, '0')}`;
}

function agentHeaders(agentId) {
  return {
    'X-OIS-Agent-Key': 'multi-contract-agent-secret',
    'X-OIS-Agent-Id': agentId
  };
}

async function agentGet(database, query, agentId) {
  return callApi(onRequestGet, database,
    new Request(`https://example.test/api/ois-data-requests?${query}`, { headers: agentHeaders(agentId) }));
}

async function agentPost(database, body, agentId) {
  return callApi(onRequestPost, database,
    new Request('https://example.test/api/ois-data-requests', {
      method: 'POST',
      headers: { ...agentHeaders(agentId), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }));
}

function validProbeResult(item, seconds = 60) {
  const expected = agent.parseClaim(item);
  const hours = seconds / 3600;
  return agent.normalizeResult({
    ...item.probe,
    ok: true,
    observedAt: item.probe.endAt,
    collectedAt: new Date().toISOString(),
    completedChunkCount: item.probe.chunkCount,
    startState: 'stopped',
    endState: 'stopped',
    runningSeconds: seconds,
    totalRunningHours: hours,
    chunks: [{
      index: 1,
      startAt: item.probe.startAt,
      endAt: item.probe.endAt,
      startState: 'stopped',
      endState: 'stopped',
      runningSeconds: seconds,
      totalRunningHours: hours
    }]
  }, expected);
}

async function completeAndSync(database, item, seconds = 3600) {
  const claim = await agentClaim(database);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  const claimed = claim.body.items.excel;
  assert.equal(claimed.id, item.id);
  const expected = agent.parseClaim(claimed);
  const hours = seconds / 3600;
  const raw = {
    ...claimed.probe,
    ok: true,
    observedAt: claimed.probe.endAt,
    collectedAt: new Date().toISOString(),
    completedChunkCount: 1,
    startState: 'running',
    endState: 'running',
    runningSeconds: seconds,
    totalRunningHours: hours,
    chunks: [{
      index: 1,
      startAt: claimed.probe.startAt,
      endAt: claimed.probe.endAt,
      startState: 'running',
      endState: 'running',
      runningSeconds: seconds,
      totalRunningHours: hours
    }]
  };
  const done = await agentComplete(database, item.id, agent.normalizeResult(raw, expected));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const saved = await callApi(
    historyPost,
    database,
    new Request('https://example.test/api/blower-history', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BROWSER_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'dataparc_runtime_sync', requestId: item.id })
    })
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
}

test('valid create bodies become visible together with one timestamp and repeat idempotently', async () => {
  const advance = installClock('2026-09-12T07:00:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const first = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number = ?').get(TAG_A);
    configureSecondAsset(f.sqlite, first);
    const requests = [createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)];
    const batchCalls = [];
    const originalBatch = f.database.batch.bind(f.database);
    f.database.batch = async statements => {
      batchCalls.push(statements.map(statement => statement.sql));
      return originalBatch(statements);
    };

    advance(1000);
    const created = await batchCreate(f.database, requests);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.atomic, true);
    assert.equal(created.body.batchVersion, 1);
    assert.equal(created.body.createdCount, 2);
    assert.deepEqual(created.body.results.map(result => result.assetTag), [TAG_A, TAG_B]);
    assert.ok(created.body.results.every(result => result.disposition === 'created'));

    const rows = f.sqlite.prepare(`SELECT request.requested_at, intent.asset_tag, intent.window_end
      FROM ois_data_requests AS request
      JOIN blower_runtime_probe_intents_v4 AS intent ON intent.request_id = request.id
      WHERE request.request_type = 'blower_runtime_probe'
      ORDER BY intent.asset_tag`).all();
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(row => row.requested_at)).size, 1);
    assert.equal(new Set(rows.map(row => row.window_end)).size, 1);
    const atomicPublish = batchCalls.find(sql => sql.some(value => /INSERT INTO ois_data_requests/.test(value) && /json_each/.test(value)));
    assert.ok(atomicPublish, 'expected one D1 batch containing the bulk queue publish');
    assert.ok(atomicPublish.length <= 6, 'asset CAS plus bulk JSON statements must stay bounded for the full 24-item batch');
    assert.ok(atomicPublish.some(value => /INSERT INTO blower_runtime_probe_intents_v4/.test(value)));

    const processingId = created.body.results[0].item.id;
    f.sqlite.prepare("UPDATE ois_data_requests SET status='processing', agent_id='already-running' WHERE id=?").run(processingId);
    const repeated = await batchCreate(f.database, requests);
    assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
    assert.equal(repeated.body.createdCount, 0);
    assert.equal(repeated.body.reusedCount, 2);
    assert.deepEqual(
      repeated.body.results.map(result => result.item.id),
      created.body.results.map(result => result.item.id)
    );
    assert.equal(f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?').get(processingId).status, 'processing');
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 2);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('cold maximum supported batch stays below the Workers D1 statement budget', async () => {
  installClock('2026-09-12T07:03:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    for (const [index, tag] of SUPPORTED_TAGS.entries()) {
      f.sqlite.prepare(`UPDATE blower_history_assets SET enabled=1,last_replacement_at=?,cycle_start_state='legacy',
        cycle_started_at=NULL,cycle_start_revision='',cycle_runtime_revision=?,cycle_runtime_hours=0,
        cycle_runtime_state='stopped',runtime_hours=0,is_running=0 WHERE tag_number=?`)
        .run(reference.last_replacement_at, `budget-runtime-${index}`, tag);
    }
    const requests = SUPPORTED_TAGS.map(tag => createBody(f.sqlite, tag,
      tag === TAG_B ? SIGNAL_B : `GSPOGE.ABB_DCS.TEST_${tag}`));
    const getCount = countExecutedStatements(f.database);
    const created = await batchCreate(f.database, requests);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.createdCount, SUPPORTED_TAGS.length);
    assert.ok(getCount() <= 24, `cold 23-item create executed ${getCount()} D1 statements`);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('batch mode rejects a non-boolean append gate before queue preflight', async () => {
  installClock('2026-09-12T07:04:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const body = createBody(f.sqlite, TAG_A, SIGNAL_A, { requireIncrementalAppend: 'false' });
    const rejected = await batchCreate(f.database, [body]);
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_ITEM_INVALID');
    assert.equal(rejected.body.failedIndex, 0);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('atomic create returns its complete prepared contract without any post-commit SELECT', async () => {
  installClock('2026-09-12T07:05:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const request = createBody(f.sqlite, TAG_A, SIGNAL_A);
    const originalPrepare = f.database.prepare.bind(f.database);
    const originalBatch = f.database.batch.bind(f.database);
    let publishCommitted = false;
    let postCommitPrepareCount = 0;
    f.database.prepare = sql => {
      if (publishCommitted) {
        postCommitPrepareCount += 1;
        throw new Error('injected post-commit read failure');
      }
      return originalPrepare(sql);
    };
    f.database.batch = async statements => {
      const publishesQueue = statements.some(statement =>
        /INSERT INTO ois_data_requests/.test(statement.sql) && /json_each/.test(statement.sql));
      const result = await originalBatch(statements);
      if (publishesQueue) publishCommitted = true;
      return result;
    };

    const created = await batchCreate(f.database, [request]);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(postCommitPrepareCount, 0);
    const item = created.body.results[0].item;
    assert.deepEqual({
      id: item.id,
      requestType: item.requestType,
      targetDate: item.targetDate,
      status: item.status,
      requestedById: item.requestedById,
      requestedByName: item.requestedByName,
      requestedAt: item.requestedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      agentId: item.agentId,
      result: item.result,
      errorMessage: item.errorMessage,
      expiresAt: item.expiresAt,
      updatedAt: item.updatedAt
    }, {
      id: item.id,
      requestType: 'blower_runtime_probe',
      targetDate: 'v1|104ETH03AN601|2026-09-09T16:05:00+09:00|2026-09-12T16:05:00+09:00',
      status: 'pending',
      requestedById: 'multi-contract-owner',
      requestedByName: '통합 검사 사용자',
      requestedAt: item.requestedAt,
      startedAt: '',
      completedAt: '',
      agentId: '',
      result: null,
      errorMessage: '',
      expiresAt: item.expiresAt,
      updatedAt: item.requestedAt
    });
    assert.deepEqual(item.probe, {
      requestId: item.id,
      schemaVersion: 1,
      requestType: 'blower_runtime_probe',
      assetTag: request.assetTag,
      dataParcTag: request.dataParcTag,
      startAt: '2026-09-09T16:05:00+09:00',
      endAt: item.probe.endAt,
      chunkDays: 31,
      chunkCount: 1,
      expectedLastReplacementAt: request.expectedLastReplacementAt,
      expectedCycleStartState: request.expectedCycleStartState,
      expectedCycleStartedAt: request.expectedCycleStartedAt,
      expectedCycleStartRevision: request.expectedCycleStartRevision,
      expectedCycleRuntimeRevision: request.expectedCycleRuntimeRevision,
      readOnly: true
    });
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('asset snapshot change between preparation and publish aborts retirement and queue creation', async () => {
  installClock('2026-09-12T07:08:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const old = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(old.status, 201, JSON.stringify(old.body));
    f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
      .run('prepared-runtime-r2', TAG_A);
    const request = createBody(f.sqlite, TAG_A, SIGNAL_A);

    const originalBatch = f.database.batch.bind(f.database);
    let injected = false;
    f.database.batch = async statements => {
      if (!injected && statements.some(statement => /BLOWER_RUNTIME_BATCH_ASSET_CAS_V1/.test(statement.sql))) {
        injected = true;
        f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
          .run('newer-runtime-r3', TAG_A);
      }
      return originalBatch(statements);
    };

    const rejected = await batchCreate(f.database, [request]);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_SNAPSHOT_CONFLICT');
    assert.equal(injected, true);
    assert.equal(f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?').get(old.body.item.id).status, 'pending');
    assert.ok(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(old.body.item.id).reuse_key);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 1);
    assert.equal(f.sqlite.prepare('SELECT cycle_runtime_revision FROM blower_history_assets WHERE tag_number=?').get(TAG_A).cycle_runtime_revision,
      'newer-runtime-r3');
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a reused-active sibling also participates in the final asset CAS', async () => {
  installClock('2026-09-12T07:09:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const active = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(active.status, 201, JSON.stringify(active.body));
    const requests = [createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)];
    const originalBatch = f.database.batch.bind(f.database);
    let injected = false;
    f.database.batch = async statements => {
      if (!injected && statements.some(statement => /BLOWER_RUNTIME_BATCH_ASSET_CAS_V1/.test(statement.sql))) {
        injected = true;
        f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
          .run('active-newer-runtime-r2', TAG_A);
      }
      return originalBatch(statements);
    };
    const rejected = await batchCreate(f.database, requests);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_SNAPSHOT_CONFLICT');
    assert.equal(f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?').get(active.body.item.id).status, 'pending');
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 1);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a reused-active row turning failed before commit cannot publish its sibling', async () => {
  installClock('2026-09-12T07:10:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const active = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(active.status, 201, JSON.stringify(active.body));
    const originalBatch = f.database.batch.bind(f.database);
    let injected = false;
    f.database.batch = async statements => {
      if (!injected && statements.some(statement => /BLOWER_RUNTIME_BATCH_QUEUE_CAS_V1/.test(statement.sql))) {
        injected = true;
        f.sqlite.prepare("UPDATE ois_data_requests SET status='failed',completed_at=?,updated_at=? WHERE id=?")
          .run('2026-09-12T07:10:00.000Z', '2026-09-12T07:10:00.000Z', active.body.item.id);
      }
      return originalBatch(statements);
    };
    const rejected = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_QUEUE_CONFLICT');
    assert.equal(f.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id=?").get(active.body.item.id).status, 'failed');
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 1);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a changed member replaces and retires its entire prior durable group', async () => {
  installClock('2026-09-12T07:10:30.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const requests = [createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)];
    const first = await batchCreate(f.database, requests);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.createdCount, 2);
    const oldIds = first.body.results.map(result => result.item.id);

    f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
      .run('group-aware-runtime-r2', TAG_A);
    const replacement = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
    assert.equal(replacement.body.createdCount, 2);
    assert.ok(replacement.body.results.every(result => result.disposition === 'created'));
    const newIds = replacement.body.results.map(result => result.item.id);
    assert.equal(new Set(newIds.map(id => id.slice(0, 45))).size, 1);
    assert.ok(newIds.every(id => !oldIds.includes(id)));
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) AND status='failed'`).get(...oldIds).count, 2);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id IN (?,?) AND reuse_key IS NOT NULL`).get(...oldIds).count, 0);
    const staleFail = await agentPost(f.database, {
      action: 'fail', requestId: oldIds[1], errorMessage: 'late stale worker failure'
    }, 'late-stale-agent');
    assert.equal(staleFail.status, 409, JSON.stringify(staleFail.body));
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) AND status='pending'`).get(...newIds).count, 2);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a partial refresh retires every pending member of the prior durable group', async () => {
  installClock('2026-09-12T07:10:45.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const first = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const oldIds = first.body.results.map(result => result.item.id);
    f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
      .run('partial-group-runtime-r2', TAG_A);

    const replacement = await batchCreate(f.database, [createBody(f.sqlite, TAG_A, SIGNAL_A)]);
    assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
    assert.equal(replacement.body.createdCount, 1);
    assert.match(replacement.body.results[0].item.id, /^brb1_[0-9a-f-]{36}_01_00$/);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) AND status='failed'`).get(...oldIds).count, 2);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id IN (?,?) AND reuse_key IS NOT NULL`).get(...oldIds).count, 0);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('partial unchanged reuse preserves its complete pending durable group', async () => {
  installClock('2026-09-12T07:10:47.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const first = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const oldIds = first.body.results.map(result => result.item.id);

    const replacement = await batchCreate(f.database, [createBody(f.sqlite, TAG_A, SIGNAL_A)]);
    assert.equal(replacement.status, 200, JSON.stringify(replacement.body));
    assert.equal(replacement.body.createdCount, 0);
    assert.equal(replacement.body.reusedCount, 1);
    assert.equal(replacement.body.results[0].disposition, 'reused_active');
    const item = replacement.body.results[0].item;
    assert.equal(item.id, oldIds[0]);
    assert.equal(item.status, 'pending');
    assert.equal(item.requestedById, 'multi-contract-owner');
    assert.equal(item.probe.requestId, item.id);
    assert.equal(item.probe.assetTag, TAG_A);
    assert.equal(item.probe.dataParcTag, SIGNAL_A);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) AND status='pending'`).get(...oldIds).count, 2);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id IN (?,?) AND reuse_key IS NOT NULL`).get(...oldIds).count, 2);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 2);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('new work absorbs a selected pending legacy singleton into one durable group', async () => {
  installClock('2026-09-12T07:10:47.500Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const legacy = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
    assert.doesNotMatch(legacy.body.item.id, /^brb1_/);

    const grouped = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(grouped.status, 201, JSON.stringify(grouped.body));
    assert.equal(grouped.body.createdCount, 2);
    assert.ok(grouped.body.results.every(result => result.disposition === 'created'));
    const newIds = grouped.body.results.map(result => result.item.id);
    assert.equal(new Set(newIds.map(id => id.slice(0, 45))).size, 1);
    assert.ok(newIds.every(id => /^brb1_[0-9a-f-]{36}_02_0[01]$/.test(id)));
    assert.equal(f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?')
      .get(legacy.body.item.id).status, 'failed');
    assert.equal(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(legacy.body.item.id).reuse_key, null);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('processing legacy singleton blocks regroup and sibling publication atomically', async () => {
  installClock('2026-09-12T07:10:47.750Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const legacy = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
    f.sqlite.prepare(`UPDATE ois_data_requests SET status='processing',agent_id=?,started_at=?,updated_at=?
      WHERE id=?`).run(
      'legacy-processing-agent', '2026-09-12T07:10:47.700Z',
      '2026-09-12T07:10:47.700Z', legacy.body.item.id
    );

    const rejected = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_QUEUE_CONFLICT');
    assert.deepEqual(
      {...f.sqlite.prepare('SELECT status,agent_id FROM ois_data_requests WHERE id=?')
        .get(legacy.body.item.id)},
      {status: 'processing', agent_id: 'legacy-processing-agent'}
    );
    assert.ok(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(legacy.body.item.id).reuse_key);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'")
      .get().count, 1);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('an unrelated fresh complete reuse does not regroup an unchanged active group', async () => {
  installClock('2026-09-12T07:10:48.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    configureThirdAsset(f.sqlite, reference);

    const completeC = await browserCreate(f.database, createBody(f.sqlite, TAG_C, SIGNAL_C));
    assert.equal(completeC.status, 201, JSON.stringify(completeC.body));
    const claimC = await agentClaim(f.database);
    assert.equal(claimC.body.items.excel.id, completeC.body.item.id);
    const settledC = await agentComplete(
      f.database,
      completeC.body.item.id,
      validProbeResult(claimC.body.items.excel, 90)
    );
    assert.equal(settledC.status, 200, JSON.stringify(settledC.body));

    const activeGroup = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(activeGroup.status, 201, JSON.stringify(activeGroup.body));
    const activeIds = activeGroup.body.results.map(result => result.item.id);

    const reused = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_C, SIGNAL_C)
    ]);
    assert.equal(reused.status, 200, JSON.stringify(reused.body));
    assert.equal(reused.body.createdCount, 0);
    assert.deepEqual(reused.body.results.map(result => result.disposition), [
      'reused_active', 'reused_complete'
    ]);
    assert.equal(reused.body.results[0].item.id, activeIds[0]);
    assert.equal(reused.body.results[1].item.id, completeC.body.item.id);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) AND status='pending'`).get(...activeIds).count, 2);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id IN (?,?) AND reuse_key IS NOT NULL`).get(...activeIds).count, 2);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('stale-group conversion reaches a global regroup fixpoint for every selected active request', async () => {
  installClock('2026-09-12T07:10:48.500Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    configureThirdAsset(f.sqlite, reference);
    configureFourthAsset(f.sqlite, reference);

    const firstGroup = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(firstGroup.status, 201, JSON.stringify(firstGroup.body));
    const firstIds = firstGroup.body.results.map(result => result.item.id);
    const staleBReuseKey = f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(firstIds[1]).reuse_key;

    f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
      .run('fresh-complete-b-runtime-r2', TAG_B);
    const freshCompleteB = await browserCreate(f.database, createBody(f.sqlite, TAG_B, SIGNAL_B));
    assert.equal(freshCompleteB.status, 201, JSON.stringify(freshCompleteB.body));
    f.sqlite.prepare(`UPDATE ois_data_requests
      SET status='complete',completed_at=?,result_json=?,updated_at=? WHERE id=?`).run(
      '2026-09-12T07:10:48.500Z',
      JSON.stringify({observedAt: freshCompleteB.body.item.probe.endAt}),
      '2026-09-12T07:10:48.500Z', freshCompleteB.body.item.id
    );
    f.sqlite.prepare(`UPDATE ois_data_requests SET status='pending',started_at=NULL,completed_at=NULL,
      agent_id='',result_json=NULL,error_message='',updated_at=? WHERE id=?`)
      .run('2026-09-12T07:10:48.500Z', firstIds[1]);
    f.sqlite.prepare('UPDATE blower_runtime_probe_intents_v4 SET reuse_key=?,updated_at=? WHERE request_id=?')
      .run(staleBReuseKey, '2026-09-12T07:10:48.500Z', firstIds[1]);

    const secondGroup = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_C, SIGNAL_C), createBody(f.sqlite, TAG_D, SIGNAL_D)
    ]);
    assert.equal(secondGroup.status, 201, JSON.stringify(secondGroup.body));
    const secondIds = secondGroup.body.results.map(result => result.item.id);

    const converged = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A),
      createBody(f.sqlite, TAG_B, SIGNAL_B),
      createBody(f.sqlite, TAG_C, SIGNAL_C)
    ]);
    assert.equal(converged.status, 201, JSON.stringify(converged.body));
    assert.equal(converged.body.createdCount, 2);
    assert.deepEqual(converged.body.results.map(result => result.disposition), [
      'created', 'reused_complete', 'created'
    ]);
    const createdIds = [converged.body.results[0].item.id, converged.body.results[2].item.id];
    assert.equal(new Set(createdIds.map(id => id.slice(0, 45))).size, 1);
    assert.ok(createdIds.every(id => /^brb1_[0-9a-f-]{36}_02_0[01]$/.test(id)));
    const retiredIds = [...firstIds, ...secondIds];
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?,?,?) AND status='failed'`).get(...retiredIds).count, 4);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id IN (?,?,?,?) AND reuse_key IS NOT NULL`).get(...retiredIds).count, 0);
    assert.equal(f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?')
      .get(freshCompleteB.body.item.id).status, 'complete');
    assert.ok(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(freshCompleteB.body.item.id).reuse_key);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('new work regroups a selected durable member and retires omitted old siblings', async () => {
  installClock('2026-09-12T07:10:49.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    configureThirdAsset(f.sqlite, reference);
    const activeGroup = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(activeGroup.status, 201, JSON.stringify(activeGroup.body));
    const activeIds = activeGroup.body.results.map(result => result.item.id);

    const mixed = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_C, SIGNAL_C)
    ]);
    assert.equal(mixed.status, 201, JSON.stringify(mixed.body));
    assert.equal(mixed.body.createdCount, 2);
    assert.ok(mixed.body.results.every(result => result.disposition === 'created'));
    const newIds = mixed.body.results.map(result => result.item.id);
    assert.equal(new Set(newIds.map(id => id.slice(0, 45))).size, 1);
    assert.ok(newIds.every(id => /^brb1_[0-9a-f-]{36}_02_0[01]$/.test(id)));
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) AND status='failed'`).get(...activeIds).count, 2);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id IN (?,?) AND reuse_key IS NOT NULL`).get(...activeIds).count, 0);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('unrelated new work cannot regroup a selected durable member already processing', async () => {
  installClock('2026-09-12T07:10:49.500Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    configureThirdAsset(f.sqlite, reference);
    const activeGroup = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(activeGroup.status, 201, JSON.stringify(activeGroup.body));
    const activeIds = activeGroup.body.results.map(result => result.item.id);
    const primary = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe',
      'durable-processing-agent');
    assert.equal(primary.body.items.excel.id, activeIds[0]);

    const rejected = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_C, SIGNAL_C)
    ]);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_QUEUE_CONFLICT');
    assert.deepEqual(f.sqlite.prepare(`SELECT status,COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) GROUP BY status ORDER BY status`).all(...activeIds).map(row => ({...row})), [
      {status: 'pending', count: 1}, {status: 'processing', count: 1}
    ]);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'")
      .get().count, 2);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('browser regroup never retires a durable group already processing on the Agent', async () => {
  installClock('2026-09-12T07:10:50.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const first = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const oldIds = first.body.results.map(result => result.item.id);
    const claimed = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', 'regroup-owner');
    assert.equal(claimed.body.items.excel.id, oldIds[0]);
    f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
      .run('processing-group-runtime-r2', TAG_A);

    const rejected = await batchCreate(f.database, [createBody(f.sqlite, TAG_A, SIGNAL_A)]);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_QUEUE_CONFLICT');
    assert.deepEqual(f.sqlite.prepare(`SELECT status,COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) GROUP BY status ORDER BY status`).all(...oldIds).map(row => ({...row})), [
      {status: 'pending', count: 1}, {status: 'processing', count: 1}
    ]);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 2);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id IN (?,?) AND reuse_key IS NOT NULL`).get(...oldIds).count, 2);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a complete seed cannot hide its processing durable sibling from retirement CAS', async () => {
  installClock('2026-09-12T07:10:55.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const group = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(group.status, 201, JSON.stringify(group.body));
    const [completeId, processingId] = group.body.results.map(result => result.item.id);
    f.sqlite.prepare(`UPDATE ois_data_requests SET status='processing',agent_id=?,started_at=?,updated_at=?
      WHERE id IN (?,?)`).run(
      'retire-cas-agent', '2026-09-12T07:10:50.000Z', '2026-09-12T07:10:50.000Z',
      completeId, processingId
    );
    f.sqlite.prepare(`UPDATE ois_data_requests SET status='complete',completed_at=?,updated_at=?
      WHERE id=?`).run('2026-09-12T07:10:52.000Z', '2026-09-12T07:10:52.000Z', completeId);
    f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
      .run('complete-seed-new-runtime-r2', TAG_A);

    const rejected = await batchCreate(f.database, [createBody(f.sqlite, TAG_A, SIGNAL_A)]);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_QUEUE_CONFLICT');
    assert.deepEqual(
      f.sqlite.prepare(`SELECT id,status,agent_id FROM ois_data_requests WHERE id IN (?,?) ORDER BY id`)
        .all(completeId, processingId).map(row => ({...row})),
      [
        {id: completeId, status: 'complete', agent_id: 'retire-cas-agent'},
        {id: processingId, status: 'processing', agent_id: 'retire-cas-agent'}
      ]
    );
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 2);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id IN (?,?) AND reuse_key IS NOT NULL`).get(completeId, processingId).count, 2);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('an already-current sibling also participates in the final asset CAS', async () => {
  installClock('2026-09-12T07:11:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const initial = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(initial.status, 201, JSON.stringify(initial.body));
    await completeAndSync(f.database, initial.body.item, 1800);
    const requests = [
      createBody(f.sqlite, TAG_A, SIGNAL_A, { requireIncrementalAppend: true }),
      createBody(f.sqlite, TAG_B, SIGNAL_B)
    ];
    const originalBatch = f.database.batch.bind(f.database);
    let injected = false;
    f.database.batch = async statements => {
      if (!injected && statements.some(statement => /BLOWER_RUNTIME_BATCH_ASSET_CAS_V1/.test(statement.sql))) {
        injected = true;
        f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
          .run('current-newer-runtime-r2', TAG_A);
      }
      return originalBatch(statements);
    };
    const rejected = await batchCreate(f.database, requests);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'BLOWER_RUNTIME_CREATE_BATCH_SNAPSHOT_CONFLICT');
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 1);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('claim lookahead leaves a 23-request atomic group whole behind older singleton backlog', async () => {
  installClock('2026-09-12T07:13:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(bootstrap.status, 201, JSON.stringify(bootstrap.body));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    insertPendingProbe(f.sqlite, { id: 'older-1', requestedAt: '2026-09-12T06:00:00.000Z' });
    insertPendingProbe(f.sqlite, { id: 'older-2', requestedAt: '2026-09-12T06:00:01.000Z' });
    const uuid = '11111111-1111-4111-8111-111111111111';
    for (let index = 0; index < 23; index += 1) {
      insertPendingProbe(f.sqlite, { id: groupedRequestId(uuid, 23, index),
        requestedAt: '2026-09-12T06:01:00.000Z' });
    }
    const claim = async () => callApi(onRequestGet, f.database,
      new Request('https://example.test/api/ois-data-requests?action=next_blower_batch&limit=23', {
        headers: { 'X-OIS-Agent-Key': 'multi-contract-agent-secret', 'X-OIS-Agent-Id': 'group-agent' }
      }));
    const first = await claim();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.items.map(item => item.id), ['older-1', 'older-2']);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE id LIKE 'brb1_%' AND status='pending'").get().count, 23);
    f.sqlite.prepare("UPDATE ois_data_requests SET status='complete', completed_at=?, updated_at=? WHERE id IN ('older-1', 'older-2')")
      .run('2026-09-12T07:13:00.100Z', '2026-09-12T07:13:00.100Z');
    const primary = await callApi(onRequestGet, f.database,
      new Request('https://example.test/api/ois-data-requests?action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', {
        headers: { 'X-OIS-Agent-Key': 'multi-contract-agent-secret', 'X-OIS-Agent-Id': 'group-agent' }
      }));
    assert.equal(primary.status, 200, JSON.stringify(primary.body));
    assert.equal(primary.body.items.excel.id, groupedRequestId(uuid, 23, 0));
    const second = await claim();
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.items.length, 22);
    assert.ok(second.body.items.every(item => item.id.startsWith(`brb1_${uuid}_23_`)));
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('two next-lanes Agents cannot split one create group and the winner claims every sibling', async () => {
  installClock('2026-09-12T07:14:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(bootstrap.status, 201, JSON.stringify(bootstrap.body));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const uuid = '22222222-2222-4222-8222-222222222222';
    for (let index = 0; index < 3; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 3, index), requestedAt: '2026-09-12T06:05:00.000Z'
    });
    const agentRequest = (action, agentId) => callApi(onRequestGet, f.database,
      new Request(`https://example.test/api/ois-data-requests?${action}`, { headers: {
        'X-OIS-Agent-Key': 'multi-contract-agent-secret', 'X-OIS-Agent-Id': agentId
      }}));
    const action = 'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe';
    const agentIds = ['group-agent-a', 'group-agent-b'];
    const firstClaims = await Promise.all(agentIds.map(agentId => agentRequest(action, agentId)));
    assert.ok(firstClaims.every(result => result.status === 200), JSON.stringify(firstClaims));
    const winnerIndex = firstClaims.findIndex(result => result.body.items.excel?.id);
    assert.notEqual(winnerIndex, -1);
    assert.equal(firstClaims.filter(result => result.body.items.excel?.id).length, 1);
    const winner = agentIds[winnerIndex];
    const additional = await agentRequest('action=next_blower_batch&limit=23', winner);
    assert.equal(additional.status, 200, JSON.stringify(additional.body));
    assert.equal(additional.body.items.length, 2);
    const owners = f.sqlite.prepare("SELECT DISTINCT agent_id FROM ois_data_requests WHERE id LIKE 'brb1_%'").all();
    assert.deepEqual(owners.map(row => row.agent_id), [winner]);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE id LIKE 'brb1_%' AND status='processing'").get().count, 3);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a sibling state race rolls the whole additional claim back', async () => {
  installClock('2026-09-12T07:15:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(bootstrap.status, 201, JSON.stringify(bootstrap.body));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const uuid = '33333333-3333-4333-8333-333333333333';
    for (let index = 0; index < 3; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 3, index), requestedAt: '2026-09-12T06:10:00.000Z'
    });
    const primary = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', 'race-agent');
    assert.equal(primary.body.items.excel.id, groupedRequestId(uuid, 3, 0));

    const originalBatch = f.database.batch.bind(f.database);
    let injected = false;
    f.database.batch = async statements => {
      if (!injected && statements.some(statement => /BLOWER_RUNTIME_BATCH_CLAIM_CAS_V1/.test(statement.sql))) {
        injected = true;
        f.sqlite.prepare("UPDATE ois_data_requests SET status='failed' WHERE id=?")
          .run(groupedRequestId(uuid, 3, 2));
      }
      return originalBatch(statements);
    };
    const additional = await agentGet(f.database, 'action=next_blower_batch&limit=23', 'race-agent');
    assert.equal(additional.status, 409, JSON.stringify(additional.body));
    assert.equal(additional.body.code, 'BLOWER_RUNTIME_PROBE_GROUP_CONFLICT');
    assert.equal(injected, true);
    const states = f.sqlite.prepare(`SELECT status,COUNT(*) count FROM ois_data_requests
      WHERE id LIKE ? GROUP BY status ORDER BY status`).all(`brb1_${uuid}_03_%`);
    assert.deepEqual(states.map(row => ({ status: row.status, count: row.count })), [
      { status: 'failed', count: 3 }
    ]);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id LIKE ? AND reuse_key IS NOT NULL`).get(`brb1_${uuid}_03_%`).count, 0);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('additional claim retry replays already-owned siblings after response loss', async () => {
  installClock('2026-09-12T07:16:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const uuid = '44444444-4444-4444-8444-444444444444';
    for (let index = 0; index < 3; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 3, index), requestedAt: '2026-09-12T06:11:00.000Z'
    });
    const primary = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', 'replay-agent');
    assert.equal(primary.body.items.excel.id, groupedRequestId(uuid, 3, 0));
    const claimed = await agentGet(f.database, 'action=next_blower_batch&limit=23', 'replay-agent');
    assert.equal(claimed.body.items.length, 2, JSON.stringify(claimed.body));
    const retried = await agentGet(f.database, 'action=next_blower_batch&limit=23', 'replay-agent');
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.replayed, true);
    assert.deepEqual(retried.body.items.map(item => item.id), claimed.body.items.map(item => item.id));
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a newer primary binds additional claim and replay to its exact group', async () => {
  const advance = installClock('2026-09-12T07:16:30.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(bootstrap.status, 201, JSON.stringify(bootstrap.body));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const staleUuid = '45454545-4545-4454-8454-454545454545';
    const currentUuid = '46464646-4646-4464-8464-464646464646';
    for (let index = 0; index < 3; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(staleUuid, 3, index), requestedAt: '2026-09-12T06:11:30.000Z'
    });
    const agentId = 'stable-replay-agent';
    const stalePrimary = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', agentId);
    assert.equal(stalePrimary.body.items.excel.id, groupedRequestId(staleUuid, 3, 0));
    const staleExtras = await agentGet(f.database, 'action=next_blower_batch&limit=23', agentId);
    assert.equal(staleExtras.body.items.length, 2, JSON.stringify(staleExtras.body));

    advance(1000);
    for (let index = 0; index < 3; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(currentUuid, 3, index), requestedAt: '2026-09-12T06:11:31.000Z'
    });
    /* Simulate a current leader left by an older deployment or duplicate process. */
    f.sqlite.prepare(`UPDATE ois_data_requests
      SET status='processing',started_at=?,agent_id=?,expires_at=?,updated_at=? WHERE id=?`).run(
      '2026-09-12T07:16:31.000Z', agentId, '2026-09-13T00:00:00.000Z',
      '2026-09-12T07:16:31.000Z', groupedRequestId(currentUuid, 3, 0)
    );

    const currentExtras = await agentGet(f.database, 'action=next_blower_batch&limit=23', agentId);
    assert.equal(currentExtras.status, 200, JSON.stringify(currentExtras.body));
    assert.deepEqual(currentExtras.body.items.map(item => item.id), [
      groupedRequestId(currentUuid, 3, 1), groupedRequestId(currentUuid, 3, 2)
    ]);
    const replay = await agentGet(f.database, 'action=next_blower_batch&limit=23', agentId);
    assert.equal(replay.body.replayed, true, JSON.stringify(replay.body));
    assert.deepEqual(replay.body.items.map(item => item.id), currentExtras.body.items.map(item => item.id));
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id LIKE ? AND status='processing' AND agent_id=?`).get(`brb1_${staleUuid}_03_%`, agentId).count, 3);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('concurrent polls sharing one Agent ID cannot start two durable primaries', async () => {
  installClock('2026-09-12T07:16:45.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(bootstrap.status, 201, JSON.stringify(bootstrap.body));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const uuids = [
      '47474747-4747-4474-8474-474747474747',
      '48484848-4848-4484-8484-484848484848'
    ];
    for (const uuid of uuids) for (let index = 0; index < 2; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 2, index), requestedAt: `2026-09-12T06:11:${uuid === uuids[0] ? '40' : '41'}.000Z`
    });
    const query = 'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe';
    const responses = await Promise.all([
      agentGet(f.database, query, 'shared-agent-id'),
      agentGet(f.database, query, 'shared-agent-id')
    ]);
    assert.ok(responses.every(response => response.status === 200), JSON.stringify(responses));
    assert.equal(responses.filter(response => response.body.items.excel).length, 1, JSON.stringify(responses));
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE status='processing' AND id LIKE 'brb1_%' AND substr(id,46,2)='00'`).get().count, 1);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a shared Agent ID cannot mix a legacy primary with a durable group', async () => {
  installClock('2026-09-12T07:16:50.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(bootstrap.status, 201, JSON.stringify(bootstrap.body));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    insertPendingProbe(f.sqlite, {id: 'legacy-shared-primary', requestedAt: '2026-09-12T06:11:45.000Z'});
    const uuid = '49494949-4949-4494-8494-494949494949';
    for (let index = 0; index < 2; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 2, index), requestedAt: '2026-09-12T06:11:46.000Z'
    });
    const query = 'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe';
    const responses = await Promise.all([
      agentGet(f.database, query, 'legacy-shared-agent'),
      agentGet(f.database, query, 'legacy-shared-agent')
    ]);
    assert.ok(responses.every(response => response.status === 200), JSON.stringify(responses));
    assert.equal(responses.filter(response => response.body.items.excel).length, 1, JSON.stringify(responses));
    assert.equal(responses.find(response => response.body.items.excel).body.items.excel.id, 'legacy-shared-primary');
    assert.equal(f.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id='legacy-shared-primary'").get().status, 'processing');
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE id LIKE 'brb1_%' AND status='pending'").get().count, 2);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('same-owner same-millisecond batches retain distinct durable groups', async () => {
  installClock('2026-09-12T07:17:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const uuids = [
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666'
    ];
    for (const uuid of uuids) for (let index = 0; index < 2; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 2, index), requestedAt: '2026-09-12T06:12:00.000Z', owner: 'same-owner'
    });
    const firstPrimary = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', 'same-ms-a');
    assert.equal(firstPrimary.body.items.excel.id, groupedRequestId(uuids[0], 2, 0));
    const firstExtra = await agentGet(f.database, 'action=next_blower_batch&limit=23', 'same-ms-a');
    assert.deepEqual(firstExtra.body.items.map(item => item.id), [groupedRequestId(uuids[0], 2, 1)]);
    const secondPrimary = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', 'same-ms-b');
    assert.equal(secondPrimary.body.items.excel.id, groupedRequestId(uuids[1], 2, 0));
    const secondExtra = await agentGet(f.database, 'action=next_blower_batch&limit=23', 'same-ms-b');
    assert.deepEqual(secondExtra.body.items.map(item => item.id), [groupedRequestId(uuids[1], 2, 1)]);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('legacy action=next cannot claim a durable batch member', async () => {
  installClock('2026-09-12T07:18:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const uuid = '77777777-7777-4777-8777-777777777777';
    for (let index = 0; index < 2; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 2, index), requestedAt: '2026-09-12T06:13:00.000Z'
    });
    const legacy = await agentGet(f.database, 'action=next&requestType=blower_runtime_probe', 'legacy-agent');
    assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
    assert.equal(legacy.body.item, null);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE status='processing'").get().count, 0);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('malformed reserved durable IDs stay excluded from every generic claim', async () => {
  installClock('2026-09-12T07:18:30.000Z');
  const f = await fixture(TAG_A, true);
  try {
    await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const validUuid = '78787878-7878-4787-8787-787878787878';
    const malformedIds = [
      groupedRequestId('gggggggg-gggg-4ggg-8ggg-gggggggggggg', 2, 0),
      groupedRequestId('gggggggg-gggg-4ggg-8ggg-gggggggggggg', 2, 1),
      groupedRequestId('70707070-7070-4070-8070-707070707070', 0, 0),
      groupedRequestId('71717171-7171-4171-8171-717171717171', 25, 0),
      groupedRequestId(validUuid, 2, 2)
    ];
    for (const id of malformedIds) insertPendingProbe(f.sqlite, {
      id, requestedAt: '2026-09-12T05:00:00.000Z'
    });
    for (let index = 0; index < 2; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(validUuid, 2, index), requestedAt: '2026-09-12T06:13:30.000Z'
    });

    const primary = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe',
      'malformed-id-agent');
    assert.equal(primary.status, 200, JSON.stringify(primary.body));
    assert.equal(primary.body.items.excel.id, groupedRequestId(validUuid, 2, 0));
    const extras = await agentGet(f.database,
      'action=next_blower_batch&limit=23', 'malformed-id-agent');
    assert.deepEqual(extras.body.items.map(item => item.id), [groupedRequestId(validUuid, 2, 1)]);

    const placeholders = malformedIds.map(() => '?').join(',');
    const malformedRows = f.sqlite.prepare(`SELECT status,agent_id FROM ois_data_requests
      WHERE id IN (${placeholders}) ORDER BY id`).all(...malformedIds);
    assert.equal(malformedRows.length, malformedIds.length);
    assert.ok(malformedRows.every(row => row.status === 'pending' && row.agent_id === ''));
    const legacy = await agentGet(f.database,
      'action=next&requestType=blower_runtime_probe', 'malformed-legacy-agent');
    assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
    assert.equal(legacy.body.item, null);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('owned leader siblings take priority over older legacy backlog', async () => {
  installClock('2026-09-12T07:19:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    insertPendingProbe(f.sqlite, { id: 'older-legacy', requestedAt: '2026-09-12T05:00:00.000Z' });
    const uuid = '88888888-8888-4888-8888-888888888888';
    for (let index = 0; index < 3; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 3, index), requestedAt: '2026-09-12T06:14:00.000Z'
    });
    f.sqlite.prepare("UPDATE ois_data_requests SET status='processing',agent_id='priority-agent' WHERE id=?")
      .run(groupedRequestId(uuid, 3, 0));
    const additional = await agentGet(f.database, 'action=next_blower_batch&limit=23', 'priority-agent');
    assert.deepEqual(additional.body.items.map(item => item.id), [
      groupedRequestId(uuid, 3, 1), groupedRequestId(uuid, 3, 2)
    ]);
    assert.equal(f.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id='older-legacy'").get().status, 'pending');
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('invalid older intent is failed before a valid durable group is claimed', async () => {
  installClock('2026-09-12T07:20:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    insertPendingProbe(f.sqlite, { id: 'invalid-older', requestedAt: '2026-09-12T05:10:00.000Z' });
    f.sqlite.prepare('DELETE FROM blower_runtime_probe_intents_v4 WHERE request_id=?').run('invalid-older');
    const uuid = '99999999-9999-4999-8999-999999999999';
    for (let index = 0; index < 3; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 3, index), requestedAt: '2026-09-12T06:15:00.000Z'
    });
    const primary = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', 'intent-agent');
    assert.equal(primary.status, 200, JSON.stringify(primary.body));
    assert.equal(primary.body.items.excel.id, groupedRequestId(uuid, 3, 0));
    assert.equal(f.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id='invalid-older'").get().status, 'failed');
    const extras = await agentGet(f.database, 'action=next_blower_batch&limit=23', 'intent-agent');
    assert.equal(extras.body.items.length, 2, JSON.stringify(extras.body));
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('preclaim intent read failure leaves every group member pending', async () => {
  installClock('2026-09-12T07:21:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    for (let index = 0; index < 2; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 2, index), requestedAt: '2026-09-12T06:16:00.000Z'
    });
    const originalPrepare = f.database.prepare.bind(f.database);
    let failedRead = false;
    f.database.prepare = sql => {
      const statement = originalPrepare(sql);
      if (/FROM blower_runtime_probe_intents_v4\s+WHERE request_id = \?/s.test(sql)) {
        statement.first = async () => {
          failedRead = true;
          throw new Error('injected intent read failure');
        };
      }
      return statement;
    };
    const response = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', 'read-fail-agent');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.items.excel, null);
    assert.match(response.body.laneErrors.excel, /injected intent read failure/);
    assert.equal(failedRead, true);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE status='processing'").get().count, 0);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('next-lanes performs no fallible intent SELECT after claiming the leader', async () => {
  installClock('2026-09-12T07:22:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const bootstrap = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    f.sqlite.exec('DELETE FROM blower_runtime_probe_intents_v4; DELETE FROM ois_data_requests;');
    const uuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    for (let index = 0; index < 2; index += 1) insertPendingProbe(f.sqlite, {
      id: groupedRequestId(uuid, 2, index), requestedAt: '2026-09-12T06:17:00.000Z'
    });
    const originalPrepare = f.database.prepare.bind(f.database);
    let claimed = false;
    let intentReads = 0;
    f.database.prepare = sql => {
      const statement = originalPrepare(sql);
      if (/FROM blower_runtime_probe_intents_v4\s+WHERE request_id = \?/s.test(sql)) {
        const originalFirst = statement.first.bind(statement);
        statement.first = async (...args) => {
          intentReads += 1;
          if (claimed) throw new Error('post-claim intent read');
          return originalFirst(...args);
        };
      }
      if (/UPDATE ois_data_requests/.test(sql) && /status = 'processing'/.test(sql)) {
        const originalRun = statement.run.bind(statement);
        statement.run = async (...args) => {
          const result = await originalRun(...args);
          if (Number(result?.meta?.changes) === 1) claimed = true;
          return result;
        };
      }
      return statement;
    };
    const response = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', 'no-post-read-agent');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.items.excel.id, groupedRequestId(uuid, 2, 0));
    assert.equal(intentReads, 1);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('brb1 IDs pass status, grouped claims, and batch completion end to end', async () => {
  installClock('2026-09-12T07:23:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const created = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A),
      createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const ids = created.body.results.map(result => result.item.id);
    assert.ok(ids.every(id => /^brb1_[0-9a-f-]{36}_02_0[01]$/.test(id)));

    const status = await callApi(onRequestGet, f.database,
      new Request(`https://example.test/api/ois-data-requests?action=status_batch&ids=${ids.join(',')}`, {
        headers: { Authorization: `Bearer ${BROWSER_TOKEN}` }
      }));
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.deepEqual(status.body.items.map(item => item.id).sort(), [...ids].sort());

    const agentId = 'e2e-agent';
    const primaryResponse = await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', agentId);
    const primary = primaryResponse.body.items.excel;
    assert.equal(primary.id, ids[0]);
    const extrasResponse = await agentGet(f.database, 'action=next_blower_batch&limit=23', agentId);
    assert.equal(extrasResponse.body.items.length, 1, JSON.stringify(extrasResponse.body));
    const claimed = [primary, ...extrasResponse.body.items];
    const completed = await agentPost(f.database, {
      action: 'complete_blower_runtime_probe_batch',
      items: claimed.map(item => ({ requestId: item.id, result: validProbeResult(item) }))
    }, agentId);
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.ok(completed.body.items.every(item => item.ok === true && item.status === 'complete'));
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) AND status='complete'`).get(...ids).count, 2);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('failing a grouped leader retires active siblings and permits a fresh group', async () => {
  installClock('2026-09-12T07:24:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const requests = [createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)];
    const created = await batchCreate(f.database, requests);
    const oldIds = created.body.results.map(result => result.item.id);
    const agentId = 'cascade-agent';
    const primary = (await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', agentId)).body.items.excel;
    const extras = await agentGet(f.database, 'action=next_blower_batch&limit=23', agentId);
    assert.equal(extras.body.items.length, 1);
    const failed = await agentPost(f.database, {
      action: 'fail', requestId: primary.id, errorMessage: 'injected grouped collection failure'
    }, agentId);
    assert.equal(failed.status, 200, JSON.stringify(failed.body));
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ois_data_requests
      WHERE id IN (?,?) AND status IN ('pending','processing')`).get(...oldIds).count, 0);
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM blower_runtime_probe_intents_v4
      WHERE request_id IN (?,?) AND reuse_key IS NOT NULL`).get(...oldIds).count, 0);

    const fresh = await batchCreate(f.database, requests);
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
    assert.equal(fresh.body.createdCount, 2);
    assert.ok(fresh.body.results.every(result => !oldIds.includes(result.item.id)));
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('only the owning Agent can fail a nonleader and completed siblings stay preserved', async () => {
  installClock('2026-09-12T07:24:30.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const reference = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG_A);
    configureSecondAsset(f.sqlite, reference);
    const created = await batchCreate(f.database, [
      createBody(f.sqlite, TAG_A, SIGNAL_A), createBody(f.sqlite, TAG_B, SIGNAL_B)
    ]);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const ids = created.body.results.map(result => result.item.id);
    const owner = 'nonleader-owner-agent';
    const primary = (await agentGet(f.database,
      'action=next_lanes&oisRequestTypes=water_environment&excelRequestTypes=blower_runtime_probe', owner)).body.items.excel;
    const extras = (await agentGet(f.database, 'action=next_blower_batch&limit=23', owner)).body.items;
    assert.equal(primary.id, ids[0]);
    assert.equal(extras[0].id, ids[1]);
    f.sqlite.prepare(`UPDATE ois_data_requests SET status='complete',completed_at=?,updated_at=? WHERE id=?`)
      .run('2026-09-12T07:24:30.100Z', '2026-09-12T07:24:30.100Z', primary.id);

    const foreign = await agentPost(f.database, {
      action: 'fail', requestId: extras[0].id, errorMessage: 'foreign failure attempt'
    }, 'foreign-agent');
    assert.equal(foreign.status, 409, JSON.stringify(foreign.body));
    assert.equal(f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?').get(primary.id).status, 'complete');
    assert.deepEqual({...f.sqlite.prepare('SELECT status,agent_id FROM ois_data_requests WHERE id=?').get(extras[0].id)}, {
      status: 'processing', agent_id: owner
    });
    assert.ok(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(extras[0].id).reuse_key);

    const owned = await agentPost(f.database, {
      action: 'fail', requestId: extras[0].id, errorMessage: 'owned nonleader failure'
    }, owner);
    assert.equal(owned.status, 200, JSON.stringify(owned.body));
    assert.equal(f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?').get(primary.id).status, 'complete');
    assert.equal(f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?').get(extras[0].id).status, 'failed');
    assert.ok(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(primary.id).reuse_key);
    assert.equal(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(extras[0].id).reuse_key, null);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a rejected item prevents valid siblings and stale-request retirement from being committed', async () => {
  installClock('2026-09-12T07:10:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const first = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number = ?').get(TAG_A);
    configureSecondAsset(f.sqlite, first);
    const old = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(old.status, 201, JSON.stringify(old.body));

    f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision = ? WHERE tag_number = ?')
      .run('new-runtime-revision', TAG_A);
    const validReplacement = createBody(f.sqlite, TAG_A, SIGNAL_A);
    const invalidSibling = createBody(f.sqlite, TAG_B, SIGNAL_B, {
      expectedCycleRuntimeRevision: 'wrong-revision'
    });
    const result = await batchCreate(f.database, [validReplacement, invalidSibling]);
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, 'BLOWER_RUNTIME_REFRESH_CYCLE_CONFLICT');
    assert.equal(result.body.failedIndex, 1);

    const oldRow = f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id = ?').get(old.body.item.id);
    assert.equal(oldRow.status, 'pending', 'prevalidated sibling must not retire the old row on whole-batch rejection');
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 1);
    assert.ok(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id = ?').get(old.body.item.id).reuse_key);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('a bulk insert failure rolls stale retirement back with the new queue rows', async () => {
  installClock('2026-09-12T07:15:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const old = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(old.status, 201, JSON.stringify(old.body));
    const oldReuseKey = f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(old.body.item.id).reuse_key;
    f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_revision=? WHERE tag_number=?')
      .run('rollback-runtime-r2', TAG_A);
    f.sqlite.exec(`CREATE TRIGGER reject_atomic_batch BEFORE INSERT ON blower_runtime_probe_intents_v4
      WHEN NEW.request_id <> '${old.body.item.id}' BEGIN SELECT RAISE(ABORT,'atomic batch insertion rejected'); END;`);

    const failed = await batchCreate(f.database, [createBody(f.sqlite, TAG_A, SIGNAL_A)]);
    assert.equal(failed.status, 500, JSON.stringify(failed.body));
    assert.match(failed.body.message, /atomic batch insertion rejected/);
    const oldRow = f.sqlite.prepare('SELECT status FROM ois_data_requests WHERE id=?').get(old.body.item.id);
    assert.equal(oldRow.status, 'pending');
    assert.equal(f.sqlite.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v4 WHERE request_id=?')
      .get(old.body.item.id).reuse_key, oldReuseKey);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM ois_data_requests WHERE request_type='blower_runtime_probe'").get().count, 1);
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});

test('atomic batch preserves one append receipt per created incremental request', async () => {
  const advance = installClock('2026-09-12T07:20:00.000Z');
  const f = await fixture(TAG_A, true);
  try {
    const first = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number = ?').get(TAG_A);
    configureSecondAsset(f.sqlite, first);

    const initialA = await browserCreate(f.database, createBody(f.sqlite, TAG_A, SIGNAL_A));
    assert.equal(initialA.status, 201, JSON.stringify(initialA.body));
    await completeAndSync(f.database, initialA.body.item, 1800);
    advance(2000);
    const initialB = await browserCreate(f.database, createBody(f.sqlite, TAG_B, SIGNAL_B));
    assert.equal(initialB.status, 201, JSON.stringify(initialB.body));
    await completeAndSync(f.database, initialB.body.item, 2400);
    advance(3600000);

    const requests = [
      createBody(f.sqlite, TAG_A, SIGNAL_A, { requireIncrementalAppend: true }),
      createBody(f.sqlite, TAG_B, SIGNAL_B, { requireIncrementalAppend: true })
    ];
    const created = await batchCreate(f.database, requests);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.createdCount, 2);

    const requestIds = created.body.results.map(result => result.item.id);
    const placeholders = requestIds.map(() => '?').join(',');
    const receipts = f.sqlite.prepare(`SELECT * FROM blower_runtime_append_v1 WHERE request_id IN (${placeholders}) ORDER BY request_id`).all(...requestIds);
    assert.equal(receipts.length, 2);
    assert.ok(receipts.every(receipt => receipt.base_event_id && receipt.base_observed_at && receipt.coverage_start_at));
    const intents = f.sqlite.prepare(`SELECT expected_cycle_runtime_revision FROM blower_runtime_probe_intents_v4 WHERE request_id IN (${placeholders})`).all(...requestIds);
    assert.equal(intents.length, 2);
    assert.ok(intents.every(intent => intent.expected_cycle_runtime_revision.startsWith('append-v1:')));
  } finally {
    f.database.close();
    globalThis.Date = realDate;
  }
});
