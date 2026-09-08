import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  onRequestGet,
  onRequestPost
} from "../functions/api/ois-data-requests.js";
import { __oisDataRequestsTest } from "../functions/api/ois-data-requests.js";


const ASSET_TAG = "104ETH03AN602";
const SOURCE_TAG = "GSPOGE.ABB_DCS.003ETH03AN602XB04";
const BROWSER_TOKEN = "blower-runtime-browser-token";
const BROWSER_EMPLOYEE_NO = "probe-browser-owner";
const AGENT_KEY = "blower-runtime-agent-secret";
const AGENT_ID = "excel-agent-test";


function createD1TestDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  let batchTail = Promise.resolve();

  const database = {
    prepare(sql) {
      return {
        sql,
        bindings: [],

        bind(...bindings) {
          this.bindings = bindings;
          return this;
        },

        async run() {
          const result = sqlite.prepare(this.sql).run(...this.bindings);
          return { meta: { changes: Number(result.changes) } };
        },

        async all() {
          return { results: sqlite.prepare(this.sql).all(...this.bindings) };
        },

        async first() {
          return sqlite.prepare(this.sql).get(...this.bindings) || null;
        }
      };
    },

    async batch(statements) {
      const previousBatch = batchTail;
      let releaseBatch;
      batchTail = new Promise(resolve => {
        releaseBatch = resolve;
      });
      await previousBatch;

      const results = [];
      sqlite.exec("BEGIN IMMEDIATE");

      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        releaseBatch();
      }

      return results;
    },

    raw() {
      return sqlite;
    },

    close() {
      sqlite.close();
    }
  };

  return database;
}


function floorToSecond(milliseconds) {
  return Math.floor(milliseconds / 1000) * 1000;
}


function createFixture() {
  const database = createD1TestDatabase();
  const sqlite = database.raw();
  const clock = floorToSecond(Date.now());
  const replacementAt = new Date(clock - 3 * 86400000).toISOString();
  const cycleStartedAt = new Date(clock - 2 * 86400000 + 321).toISOString();

  sqlite.exec(`
    CREATE TABLE users (
      employee_no TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );

    CREATE TABLE shift_log_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      employee_no TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT
    );

    CREATE TABLE blower_history_assets (
      tag_number TEXT PRIMARY KEY NOT NULL,
      enabled INTEGER NOT NULL,
      last_replacement_at TEXT,
      cycle_start_state TEXT NOT NULL,
      cycle_started_at TEXT,
      cycle_start_revision TEXT NOT NULL,
      cycle_runtime_revision TEXT NOT NULL
    );

    CREATE TABLE ois_data_requests (
      id TEXT PRIMARY KEY NOT NULL,
      request_type TEXT NOT NULL,
      target_date TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by_id TEXT NOT NULL,
      requested_by_name TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      agent_id TEXT NOT NULL DEFAULT '',
      result_json TEXT,
      error_message TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  addBrowserIdentity(sqlite, {
    token: BROWSER_TOKEN,
    employeeNo: BROWSER_EMPLOYEE_NO,
    name: "Probe Browser Owner",
    clock
  });
  sqlite.prepare(`
    INSERT INTO blower_history_assets (
      tag_number, enabled, last_replacement_at,
      cycle_start_state, cycle_started_at,
      cycle_start_revision, cycle_runtime_revision
    ) VALUES (?, 1, ?, 'started', ?, 'cycle-start-r1', 'cycle-runtime-r1')
  `).run(ASSET_TAG, replacementAt, cycleStartedAt);

  for (const tag of ALL_ASSETS.filter(tag => tag !== ASSET_TAG)) {
    sqlite.prepare(`INSERT INTO blower_history_assets SELECT ?, enabled, last_replacement_at,
      cycle_start_state, cycle_started_at, cycle_start_revision, cycle_runtime_revision
      FROM blower_history_assets WHERE tag_number = ?`).run(tag, ASSET_TAG);
  }
  return { database, sqlite, replacementAt, cycleStartedAt };
}


function addBrowserIdentity(sqlite, {
  token,
  employeeNo,
  name,
  clock = floorToSecond(Date.now())
}) {
  sqlite.prepare(`
    INSERT INTO users (employee_no, name, role, is_active)
    VALUES (?, ?, 'user', 1)
  `).run(employeeNo, name);
  sqlite.prepare(`
    INSERT INTO shift_log_sessions (
      token_hash, employee_no, expires_at, last_used_at
    ) VALUES (?, ?, ?, ?)
  `).run(
    createHash("sha256").update(token).digest("hex"),
    employeeNo,
    new Date(clock + 86400000).toISOString(),
    new Date(clock).toISOString()
  );
}


async function callApi(handler, database, request) {
  const response = await handler({
    request,
    env: {
      DB: database,
      OIS_AGENT_KEY: AGENT_KEY
    }
  });

  return {
    status: response.status,
    body: await response.json()
  };
}


async function browserCreate(database, body = {
  action: "create_blower_runtime_probe"
}, token = BROWSER_TOKEN) {
  return await callApi(
    onRequestPost,
    database,
    new Request("https://example.test/api/ois-data-requests", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    })
  );
}


async function agentClaim(database) {
  return await callApi(
    onRequestGet,
    database,
    new Request(
      "https://example.test/api/ois-data-requests" +
        "?action=next_lanes" +
        "&oisRequestTypes=water_environment" +
        "&excelRequestTypes=blower_runtime_probe",
      {
        headers: {
          "X-OIS-Agent-Key": AGENT_KEY,
          "X-OIS-Agent-Id": AGENT_ID
        }
      }
    )
  );
}


async function agentComplete(database, requestId, result) {
  return await callApi(
    onRequestPost,
    database,
    new Request("https://example.test/api/ois-data-requests", {
      method: "POST",
      headers: {
        "X-OIS-Agent-Key": AGENT_KEY,
        "X-OIS-Agent-Id": AGENT_ID,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "complete",
        requestId,
        result
      })
    })
  );
}


function zeroRuntimeResult(item) {
  const probe = item.probe;

  return {
    schemaVersion: 1,
    requestType: "blower_runtime_probe",
    requestId: item.id,
    ok: true,
    readOnly: true,
    assetTag: probe.assetTag,
    dataParcTag: probe.dataParcTag,
    startAt: probe.startAt,
    endAt: probe.endAt,
    observedAt: probe.endAt,
    expectedLastReplacementAt: probe.expectedLastReplacementAt,
    expectedCycleStartState: probe.expectedCycleStartState,
    expectedCycleStartedAt: probe.expectedCycleStartedAt,
    expectedCycleStartRevision: probe.expectedCycleStartRevision,
    expectedCycleRuntimeRevision: probe.expectedCycleRuntimeRevision,
    chunkDays: 31,
    chunkCount: 1,
    completedChunkCount: 1,
    chunks: [{
      index: 1,
      startAt: probe.startAt,
      endAt: probe.endAt,
      startState: "stopped",
      endState: "stopped",
      totalRunningHours: 0,
      runningSeconds: 0
    }],
    startState: "stopped",
    endState: "stopped",
    totalRunningHours: 0,
    runningSeconds: 0,
    collectedAt: new Date().toISOString()
  };
}



const ALL_ASSETS = [
  "104ETH03AN601", "104ETH03AN602", "104ETG30AN601", "104ETG30AN602",
  "204ETG30AN601", "204ETG30AN602", "104SDF01AN001", "104SDF01AN002",
  "204SDF01AN001", "204SDF01AN002", "204LMDF01AN001"
];
// Deliberately synthetic test-only signals; these are not production mappings.
const testSignal = tag => `GSPOGE.ABB_DCS.TEST_ONLY_${ALL_ASSETS.indexOf(tag)}_RUN`;
const createBody = (tag, extra = {}) => ({
  action: "create_blower_runtime_probe", assetTag: tag,
  ...(tag === ASSET_TAG ? {} : { dataParcTag: testSignal(tag), confirmRunSignal: true }), ...extra
});
const requestCount = fixture => fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM ois_data_requests").get().count;

test("all eleven supported assets queue their exact confirmed signal without retiring another asset", async () => {
  const f = createFixture();
  try {
    const ids = new Set();
    for (const tag of ALL_ASSETS) {
      const response = await browserCreate(f.database, createBody(tag));
      assert.equal(response.status, 201, JSON.stringify(response.body));
      const item = response.body.item;
      assert.equal(item.probe.assetTag, tag);
      assert.equal(item.probe.dataParcTag, tag === ASSET_TAG ? SOURCE_TAG : testSignal(tag));
      assert.equal(item.targetDate, `v1|${tag}|${item.probe.startAt}|${item.probe.endAt}`);
      ids.add(item.id);
      const again = await browserCreate(f.database, createBody(tag));
      assert.equal(again.body.item.id, item.id);
      assert.equal(again.body.disposition, "reused_active");
    }
    assert.equal(ids.size, 11);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM ois_data_requests WHERE status = 'pending'").get().count, 11);
  } finally { f.database.close(); }
});

test("legacy Silo B still needs no TAG input and cannot be remapped", async () => {
  const f = createFixture();
  try {
    const oldBrowser = await browserCreate(f.database);
    assert.equal(oldBrowser.status, 201);
    assert.equal(oldBrowser.body.item.probe.assetTag, ASSET_TAG);
    assert.equal(oldBrowser.body.item.probe.dataParcTag, SOURCE_TAG);
    const explicitSame = await browserCreate(f.database, createBody(ASSET_TAG, { dataParcTag: SOURCE_TAG }));
    assert.equal(explicitSame.body.item.id, oldBrowser.body.item.id);
    const remap = await browserCreate(f.database, createBody(ASSET_TAG, { dataParcTag: testSignal(ASSET_TAG), confirmRunSignal: true }));
    assert.equal(remap.status, 400);
    assert.equal(remap.body.code, "BLOWER_RUNTIME_PROBE_SERVER_TAG_ONLY");
    assert.equal(requestCount(f), 1);
  } finally { f.database.close(); }
});

test("non-pilot signals require an explicit binary RUN confirmation and safe literal TAG", async () => {
  const f = createFixture();
  try {
    const tag = ALL_ASSETS[0];
    const invalidBodies = [
      { action: "create_blower_runtime_probe", assetTag: tag },
      createBody(tag, { confirmRunSignal: false }),
      createBody(tag, { confirmRunSignal: "true" }),
      createBody(tag, { dataParcTag: null }),
      createBody(tag, { dataParcTag: "" }),
      ...['GSPOGE.ABB_DCS.TEST RUN', 'GSPOGE.ABB_DCS.X"', "GSPOGE.ABB_DCS.X'", "GSPOGE.ABB_DCS.X\n", "GSPOGE.ABB_DCS.X;STOP", "GSPOGE.ABB_DCS.$(X)", "GSPOGE.ABB_DCS.<X>", "GSPOGE.ABB_DCS./X", "GSPOGE.ABB_DCS.X/Y", "GSPOGE.ABB_DCS.lowercase", "GSPOGE.ABB_DCS.X|Y", "OTHER.ABB_DCS.TEST", "GSPOGE.ABB_DCS." + "X".repeat(186)].map(dataParcTag => createBody(tag, { dataParcTag })),
      createBody("104HHL60AP611"), createBody("204LMDF01AN002"), createBody(null),
      createBody(tag, { tagNumber: tag }), createBody(tag, { sourceTag: testSignal(tag) })
    ];
    for (const body of invalidBodies) {
      const response = await browserCreate(f.database, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(requestCount(f), 0);
    }
    assert.equal(__oisDataRequestsTest.isValidBlowerRuntimeProbeMapping(tag, "GSPOGE.ABB_DCS." + "X".repeat(185)), true);
  } finally { f.database.close(); }
});

test("changing one asset signal or cycle retires only that asset and source-specific keys never reuse old results", async () => {
  const f = createFixture();
  try {
    const tag = ALL_ASSETS[0];
    const first = (await browserCreate(f.database, createBody(tag))).body.item;
    const other = (await browserCreate(f.database, createBody(ALL_ASSETS[2]))).body.item;
    const sourceChange = await browserCreate(f.database, createBody(tag, { dataParcTag: "GSPOGE.ABB_DCS.TEST_ONLY_REPLACED_SIGNAL" }));
    assert.equal(sourceChange.status, 201);
    assert.notEqual(sourceChange.body.item.id, first.id);
    assert.equal(f.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id=?").get(first.id).status, "failed");
    assert.equal(f.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id=?").get(other.id).status, "pending");
    assert.equal(f.sqlite.prepare("SELECT dataparc_tag FROM blower_runtime_probe_intents_v3 WHERE request_id=?").get(first.id).dataparc_tag, testSignal(tag));
    f.sqlite.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='changed' WHERE tag_number=?").run(tag);
    const revisionChange = await browserCreate(f.database, createBody(tag, { dataParcTag: "GSPOGE.ABB_DCS.TEST_ONLY_REPLACED_SIGNAL" }));
    assert.equal(revisionChange.status, 201);
    assert.equal(f.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id=?").get(other.id).status, "pending");
  } finally { f.database.close(); }
});

test("claim and completion preserve canonical pair, reject forged equipment/source, and remain read-only", async () => {
  const f = createFixture();
  try {
    const tag = ALL_ASSETS[10];
    const created = await browserCreate(f.database, createBody(tag));
    const claimed = await agentClaim(f.database);
    const item = claimed.body.items.excel;
    assert.equal(item.id, created.body.item.id);
    assert.deepEqual(item.probe, created.body.item.probe);
    assert.ok(Date.parse(item.expiresAt) - Date.parse(item.startedAt) >= 119 * 60000);
    const result = zeroRuntimeResult(item);
    const before = f.sqlite.prepare("SELECT * FROM blower_history_assets").all();
    for (const patch of [{ assetTag: ALL_ASSETS[0] }, { dataParcTag: testSignal(ALL_ASSETS[0]) }, { assetTag: ASSET_TAG, dataParcTag: SOURCE_TAG }]) {
      const forged = await agentComplete(f.database, item.id, { ...result, ...patch });
      assert.equal(forged.status, 400);
      assert.equal(forged.body.code, "BLOWER_RUNTIME_PROBE_INVALID_RESULT");
    }
    const complete = await agentComplete(f.database, item.id, result);
    assert.equal(complete.status, 200, JSON.stringify(complete.body));
    assert.equal(complete.body.item.result.assetTag, tag);
    assert.equal(complete.body.item.result.dataParcTag, testSignal(tag));
    assert.equal(complete.body.item.result.isRunning, false);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM blower_history_assets").all(), before);
    const replay = await agentComplete(f.database, item.id, result);
    assert.equal(replay.body.replayed, true);
    const reused = await browserCreate(f.database, createBody(tag));
    assert.equal(reused.body.disposition, "reused_complete");
    assert.equal(reused.body.item.id, item.id);
  } finally { f.database.close(); }
});

test("queue target tampering cannot complete against a mismatched intent", async () => {
  const f = createFixture();
  try {
    await browserCreate(f.database, createBody(ALL_ASSETS[0]));
    const item = (await agentClaim(f.database)).body.items.excel;
    const result = zeroRuntimeResult(item);
    f.sqlite.prepare("UPDATE ois_data_requests SET target_date=? WHERE id=?").run(`v1|${ASSET_TAG}|${item.probe.startAt}|${item.probe.endAt}`, item.id);
    const rejected = await agentComplete(f.database, item.id, result);
    assert.equal(rejected.status, 400);
    assert.equal(f.sqlite.prepare("SELECT status FROM ois_data_requests WHERE id=?").get(item.id).status, "processing");
  } finally { f.database.close(); }
});

test("V2 migration preserves existing B intent exactly, retains old tables, and reuses its active request", async () => {
  const f = createFixture();
  try {
    const old = (await browserCreate(f.database)).body.item;
    f.sqlite.exec("INSERT INTO blower_runtime_probe_intents_v2 SELECT * FROM blower_runtime_probe_intents_v3; DROP TABLE blower_runtime_probe_intents_v3;");
    const oldRow = f.sqlite.prepare("SELECT * FROM blower_runtime_probe_intents_v2 WHERE request_id=?").get(old.id);
    const freshDatabase = { prepare: f.database.prepare, batch: f.database.batch };
    await __oisDataRequestsTest.ensureBlowerRuntimeProbeSchema(freshDatabase);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM blower_runtime_probe_intents_v3 WHERE request_id=?").get(old.id), oldRow);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM blower_runtime_probe_intents_v2 WHERE request_id=?").get(old.id), oldRow);
    const reused = await browserCreate(freshDatabase);
    assert.equal(reused.body.item.id, old.id);
    assert.equal(reused.body.disposition, "reused_active");
    await __oisDataRequestsTest.ensureBlowerRuntimeProbeSchema({ prepare: f.database.prepare, batch: f.database.batch });
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM blower_runtime_probe_intents_v3").get().count, 1);
    assert.throws(() => f.sqlite.prepare("UPDATE blower_runtime_probe_intents_v3 SET asset_tag='104HHL60AP611' WHERE request_id=?").run(old.id), /CHECK constraint/);
    assert.throws(() => f.sqlite.prepare("UPDATE blower_runtime_probe_intents_v3 SET dataparc_tag='GSPOGE.ABB_DCS.OTHER' WHERE request_id=?").run(old.id), /CHECK constraint/);
  } finally { f.database.close(); }
});


test("the verified Silo B RUN signal cannot be copied to another equipment", async () => {
  const f = createFixture();
  try {
    for (const assetTag of ALL_ASSETS.filter(tag => tag !== ASSET_TAG)) {
      const response = await browserCreate(f.database, createBody(assetTag, { dataParcTag: SOURCE_TAG }));
      assert.equal(response.status, 400);
      assert.equal(requestCount(f), 0);
      assert.equal(__oisDataRequestsTest.isValidBlowerRuntimeProbeMapping(assetTag, SOURCE_TAG), false);
    }
    const created = await browserCreate(f.database, createBody(ALL_ASSETS[0]));
    const item = (await agentClaim(f.database)).body.items.excel;
    assert.equal(item.id, created.body.item.id);
    const result = zeroRuntimeResult(item);
    const copiedPair = { ...item.probe, dataParcTag: SOURCE_TAG };
    const completion = __oisDataRequestsTest.normalizeBlowerRuntimeProbeResult(
      { ...result, dataParcTag: SOURCE_TAG }, copiedPair, item.id
    );
    assert.ok(completion.error, "even a matching result cannot validate a copied pilot mapping");
  } finally { f.database.close(); }
});
