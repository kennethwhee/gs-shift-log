import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  onRequestGet,
  onRequestPost
} from "../functions/api/ois-data-requests.js";


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

  return {
    database,
    sqlite,
    replacementAt,
    cycleStartedAt
  };
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
    assetTag: ASSET_TAG,
    dataParcTag: SOURCE_TAG,
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


test("queue lifecycle creates, reuses, claims canonical item.probe, completes, and refreshes by revision", async () => {
  const fixture = createFixture();

  try {
    const rejectedTag = await browserCreate(fixture.database, {
      action: "create_blower_runtime_probe",
      dataParcTag: "CLIENT.SUPPLIED.TAG"
    });
    assert.equal(rejectedTag.status, 400);
    assert.equal(rejectedTag.body.code, "BLOWER_RUNTIME_PROBE_SERVER_TAG_ONLY");
    assert.equal(
      fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM ois_data_requests")
        .get().count,
      0
    );

    const created = await browserCreate(fixture.database);
    assert.equal(created.status, 201);
    assert.equal(created.body.reused, false);
    assert.equal(created.body.disposition, "created");
    const firstItem = created.body.item;
    assert.equal(firstItem.requestType, "blower_runtime_probe");
    assert.equal(firstItem.status, "pending");
    assert.equal(firstItem.probe.requestId, firstItem.id);
    assert.equal(firstItem.probe.assetTag, ASSET_TAG);
    assert.equal(firstItem.probe.dataParcTag, SOURCE_TAG);
    assert.equal(firstItem.probe.readOnly, true);
    assert.equal(firstItem.probe.chunkDays, 31);
    assert.equal(firstItem.probe.chunkCount, 1);
    assert.equal(firstItem.probe.expectedLastReplacementAt, fixture.replacementAt);
    assert.equal(firstItem.probe.expectedCycleStartedAt, fixture.cycleStartedAt);
    assert.equal(firstItem.probe.expectedCycleRuntimeRevision, "cycle-runtime-r1");
    assert.equal(
      firstItem.targetDate,
      `v1|${ASSET_TAG}|${firstItem.probe.startAt}|${firstItem.probe.endAt}`
    );

    const activeReuse = await browserCreate(fixture.database);
    assert.equal(activeReuse.status, 200);
    assert.equal(activeReuse.body.reused, true);
    assert.equal(activeReuse.body.disposition, "reused_active");
    assert.equal(activeReuse.body.item.id, firstItem.id);

    const claim = await agentClaim(fixture.database);
    assert.equal(claim.status, 200);
    assert.equal(claim.body.items.ois, null);
    assert.equal(claim.body.items.excel.id, firstItem.id);
    assert.equal(claim.body.items.excel.status, "processing");
    assert.deepEqual(claim.body.items.excel.probe, firstItem.probe);
    assert.ok(
      new Date(claim.body.items.excel.expiresAt).getTime() -
        new Date(claim.body.items.excel.startedAt).getTime() >=
        119 * 60 * 1000,
      "probe claims must retain the two-hour Excel processing lease"
    );
    const assetBeforeCompletion = fixture.sqlite.prepare(`
      SELECT * FROM blower_history_assets WHERE tag_number = ?
    `).get(ASSET_TAG);

    const completionResult = zeroRuntimeResult(claim.body.items.excel);
    const invalidResult = {
      ...completionResult,
      endState: "unknown",
      chunks: [{
        ...completionResult.chunks[0],
        endState: "unknown"
      }]
    };
    const rejectedCompletion = await agentComplete(
      fixture.database,
      firstItem.id,
      invalidResult
    );
    assert.equal(rejectedCompletion.status, 400);
    assert.equal(
      rejectedCompletion.body.code,
      "BLOWER_RUNTIME_PROBE_INVALID_RESULT"
    );
    assert.equal(
      fixture.sqlite.prepare(`
        SELECT status FROM ois_data_requests WHERE id = ?
      `).get(firstItem.id).status,
      "processing"
    );

    const completed = await agentComplete(
      fixture.database,
      firstItem.id,
      completionResult
    );
    assert.equal(completed.status, 200);
    assert.equal(completed.body.item.status, "complete");
    assert.equal(completed.body.item.result.readOnly, true);
    assert.equal(completed.body.item.result.runningSeconds, 0);
    assert.equal(completed.body.item.result.isRunning, false);
    assert.deepEqual(
      fixture.sqlite.prepare(`
        SELECT * FROM blower_history_assets WHERE tag_number = ?
      `).get(ASSET_TAG),
      assetBeforeCompletion,
      "probe completion itself must stay read-only"
    );

    const completionReplay = await agentComplete(
      fixture.database,
      firstItem.id,
      completionResult
    );
    assert.equal(completionReplay.status, 200);
    assert.equal(completionReplay.body.replayed, true);

    const conflictingCompletion = await agentComplete(
      fixture.database,
      firstItem.id,
      {
        ...completionResult,
        endState: "running",
        currentState: "running",
        isRunning: true,
        chunks: [{
          ...completionResult.chunks[0],
          endState: "running"
        }]
      }
    );
    assert.equal(conflictingCompletion.status, 409);
    assert.equal(
      conflictingCompletion.body.code,
      "BLOWER_RUNTIME_PROBE_RESULT_CONFLICT"
    );

    const freshReuse = await browserCreate(fixture.database);
    assert.equal(freshReuse.status, 200);
    assert.equal(freshReuse.body.disposition, "reused_complete");
    assert.equal(freshReuse.body.item.id, firstItem.id);

    fixture.sqlite.prepare(`
      UPDATE blower_history_assets
      SET cycle_runtime_revision = 'cycle-runtime-r2'
      WHERE tag_number = ?
    `).run(ASSET_TAG);

    const changedRevision = await browserCreate(fixture.database);
    assert.equal(changedRevision.status, 201);
    assert.equal(changedRevision.body.disposition, "created");
    assert.notEqual(changedRevision.body.item.id, firstItem.id);
    assert.equal(
      changedRevision.body.item.probe.expectedCycleRuntimeRevision,
      "cycle-runtime-r2"
    );
    assert.equal(
      fixture.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM ois_data_requests
        WHERE request_type = 'blower_runtime_probe'
      `).get().count,
      2
    );
  } finally {
    fixture.database.close();
  }
});


test("an unchanged cycle creates a new request when its completed probe is stale", async () => {
  const fixture = createFixture();

  try {
    const original = await browserCreate(fixture.database);
    assert.equal(original.status, 201);

    const staleEndAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    fixture.sqlite.prepare(`
      UPDATE blower_runtime_probe_intents
      SET window_end = ?
      WHERE request_id = ?
    `).run(staleEndAt, original.body.item.id);
    fixture.sqlite.prepare(`
      UPDATE ois_data_requests
      SET
        target_date = ?,
        status = 'complete',
        result_json = ?,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      `v1|${ASSET_TAG}|${original.body.item.probe.startAt}|${staleEndAt}`,
      JSON.stringify({ observedAt: staleEndAt }),
      staleEndAt,
      staleEndAt,
      original.body.item.id
    );

    const refreshed = await browserCreate(fixture.database);
    assert.equal(refreshed.status, 201);
    assert.equal(refreshed.body.disposition, "created");
    assert.notEqual(refreshed.body.item.id, original.body.item.id);
    assert.equal(
      refreshed.body.item.probe.expectedCycleRuntimeRevision,
      original.body.item.probe.expectedCycleRuntimeRevision
    );
    assert.ok(
      Date.parse(refreshed.body.item.probe.endAt) > Date.parse(staleEndAt)
    );

    const intents = fixture.sqlite.prepare(`
      SELECT request_id, reuse_key
      FROM blower_runtime_probe_intents
      ORDER BY created_at, request_id
    `).all();
    const oldIntent = intents.find(row =>
      row.request_id === original.body.item.id
    );
    const newIntent = intents.find(row =>
      row.request_id === refreshed.body.item.id
    );
    assert.equal(oldIntent.reuse_key, null);
    assert.ok(newIntent.reuse_key);
  } finally {
    fixture.database.close();
  }
});


test("retires an active request whose frozen observation window is stale", async () => {
  const fixture = createFixture();

  try {
    const original = await browserCreate(fixture.database);
    assert.equal(original.status, 201);
    const staleEndAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    fixture.sqlite.prepare(`
      UPDATE blower_runtime_probe_intents
      SET window_end = ?
      WHERE request_id = ?
    `).run(staleEndAt, original.body.item.id);

    const refreshed = await browserCreate(fixture.database);
    assert.equal(refreshed.status, 201);
    assert.notEqual(refreshed.body.item.id, original.body.item.id);

    const retired = fixture.sqlite.prepare(`
      SELECT status, error_message
      FROM ois_data_requests
      WHERE id = ?
    `).get(original.body.item.id);
    assert.equal(retired.status, "failed");
    assert.match(retired.error_message, /snapshot changed/i);
    assert.equal(
      fixture.sqlite.prepare(`
        SELECT reuse_key
        FROM blower_runtime_probe_intents
        WHERE request_id = ?
      `).get(original.body.item.id).reuse_key,
      null
    );
  } finally {
    fixture.database.close();
  }
});


test("retires a same-owner active request after the cycle snapshot changes", async () => {
  const fixture = createFixture();

  try {
    const original = await browserCreate(fixture.database);
    fixture.sqlite.prepare(`
      UPDATE blower_history_assets
      SET cycle_runtime_revision = 'cycle-runtime-r2'
      WHERE tag_number = ?
    `).run(ASSET_TAG);

    const refreshed = await browserCreate(fixture.database);
    assert.equal(refreshed.status, 201);
    assert.notEqual(refreshed.body.item.id, original.body.item.id);
    assert.equal(
      refreshed.body.item.probe.expectedCycleRuntimeRevision,
      "cycle-runtime-r2"
    );
    assert.equal(
      fixture.sqlite.prepare(`
        SELECT status FROM ois_data_requests WHERE id = ?
      `).get(original.body.item.id).status,
      "failed"
    );
  } finally {
    fixture.database.close();
  }
});


test("active reuse is isolated by requesting browser owner", async () => {
  const fixture = createFixture();
  const secondToken = "second-browser-token";
  const secondEmployeeNo = "second-probe-owner";
  addBrowserIdentity(fixture.sqlite, {
    token: secondToken,
    employeeNo: secondEmployeeNo,
    name: "Second Probe Owner"
  });

  try {
    const ownerA = await browserCreate(fixture.database);
    const ownerB = await browserCreate(
      fixture.database,
      { action: "create_blower_runtime_probe" },
      secondToken
    );

    assert.equal(ownerA.status, 201);
    assert.equal(ownerB.status, 201);
    assert.notEqual(ownerA.body.item.id, ownerB.body.item.id);
    assert.equal(ownerA.body.item.requestedById, BROWSER_EMPLOYEE_NO);
    assert.equal(ownerB.body.item.requestedById, secondEmployeeNo);

    const statuses = fixture.sqlite.prepare(`
      SELECT id, status FROM ois_data_requests ORDER BY id
    `).all();
    assert.equal(statuses.length, 2);
    assert.ok(statuses.every(row => row.status === "pending"));

    const ownerAReuse = await browserCreate(fixture.database);
    const ownerBReuse = await browserCreate(
      fixture.database,
      { action: "create_blower_runtime_probe" },
      secondToken
    );
    assert.equal(ownerAReuse.body.item.id, ownerA.body.item.id);
    assert.equal(ownerBReuse.body.item.id, ownerB.body.item.id);
  } finally {
    fixture.database.close();
  }
});


test("a different browser never reuses or retires another owner's completed probe", async () => {
  const fixture = createFixture();
  const secondToken = "completed-owner-token";
  const secondEmployeeNo = "completed-probe-owner";
  addBrowserIdentity(fixture.sqlite, {
    token: secondToken,
    employeeNo: secondEmployeeNo,
    name: "Completed Probe Owner"
  });

  try {
    const ownerB = await browserCreate(
      fixture.database,
      { action: "create_blower_runtime_probe" },
      secondToken
    );
    const claim = await agentClaim(fixture.database);
    assert.equal(claim.body.items.excel.id, ownerB.body.item.id);
    const completed = await agentComplete(
      fixture.database,
      ownerB.body.item.id,
      zeroRuntimeResult(claim.body.items.excel)
    );
    assert.equal(completed.status, 200);

    const ownerBReuseKey = fixture.sqlite.prepare(`
      SELECT reuse_key
      FROM blower_runtime_probe_intents
      WHERE request_id = ?
    `).get(ownerB.body.item.id).reuse_key;
    assert.ok(ownerBReuseKey);

    const ownerA = await browserCreate(fixture.database);
    assert.equal(ownerA.status, 201);
    assert.notEqual(ownerA.body.item.id, ownerB.body.item.id);
    assert.equal(ownerA.body.item.requestedById, BROWSER_EMPLOYEE_NO);

    const ownerBAfter = fixture.sqlite.prepare(`
      SELECT request.status, intent.reuse_key
      FROM ois_data_requests AS request
      INNER JOIN blower_runtime_probe_intents AS intent
        ON intent.request_id = request.id
      WHERE request.id = ?
    `).get(ownerB.body.item.id);
    assert.equal(ownerBAfter.status, "complete");
    assert.equal(ownerBAfter.reuse_key, ownerBReuseKey);
  } finally {
    fixture.database.close();
  }
});


test("simultaneous same-owner creates converge on one active request", async () => {
  const fixture = createFixture();

  try {
    const [left, right] = await Promise.all([
      browserCreate(fixture.database),
      browserCreate(fixture.database)
    ]);

    assert.deepEqual(
      [left.status, right.status].sort((a, b) => a - b),
      [200, 201]
    );
    assert.equal(left.body.item.id, right.body.item.id);
    assert.equal(
      fixture.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM ois_data_requests
      `).get().count,
      1
    );
    assert.deepEqual(
      [left.body.disposition, right.body.disposition].sort(),
      ["created", "reused_active"]
    );
  } finally {
    fixture.database.close();
  }
});


test("create remains compatible with the earlier intent schema that has no owner column", async () => {
  const fixture = createFixture();

  try {
    fixture.sqlite.exec(`
      CREATE TABLE blower_runtime_probe_intents (
        request_id TEXT PRIMARY KEY NOT NULL,
        reuse_key TEXT UNIQUE,
        schema_version INTEGER NOT NULL,
        asset_tag TEXT NOT NULL,
        dataparc_tag TEXT NOT NULL,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        chunk_days INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        expected_last_replacement_at TEXT NOT NULL,
        expected_cycle_start_state TEXT NOT NULL,
        expected_cycle_started_at TEXT NOT NULL,
        expected_cycle_start_revision TEXT NOT NULL,
        expected_cycle_runtime_revision TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const created = await browserCreate(fixture.database);
    assert.equal(created.status, 201);
    assert.equal(created.body.item.probe.requestId, created.body.item.id);

    const columnNames = fixture.sqlite.prepare(`
      PRAGMA table_info(blower_runtime_probe_intents)
    `).all().map(column => column.name);
    assert.equal(columnNames.includes("requested_by_id"), false);
  } finally {
    fixture.database.close();
  }
});
