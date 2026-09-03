import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  __blowerHistoryTest
} from "../functions/api/blower-history.js";


const {
  applyDataParcRuntimeSync,
  ensureSchema
} = __blowerHistoryTest;


const ASSET_TAG = "104ETH03AN602";
const SOURCE_TAG = "GSPOGE.ABB_DCS.003ETH03AN602XB04";
const REQUEST_ID = "blower-runtime-probe-sqlite-1";
const RAW_START_AT = "2026-08-20T00:00:00.000Z";
const CYCLE_STARTED_AT = "2026-08-20T00:00:00.321Z";
const RAW_END_AT = "2026-09-03T11:59:30.000Z";
const COLLECTED_AT = "2026-09-03T11:59:40.000Z";
const REPLACEMENT_AT = "2026-08-19T00:00:00.000Z";
const NOW = new Date("2026-09-03T12:00:00.000Z");
const OWNER = Object.freeze({
  employeeNo: "runtime-probe-owner",
  name: "Runtime Probe Owner",
  isSuperAdmin: false
});


function createD1TestDatabase() {
  const sqlite = new DatabaseSync(":memory:");

  const database = {
    afterStatement: null,

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
      const results = [];
      sqlite.exec("BEGIN IMMEDIATE");

      try {
        for (let index = 0; index < statements.length; index += 1) {
          results.push(await statements[index].run());

          if (typeof database.afterStatement === "function") {
            await database.afterStatement({
              index,
              sqlite,
              statement: statements[index]
            });
          }
        }

        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
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


function probeResult({
  requestId = REQUEST_ID,
  runningSeconds = 9001,
  totalRunningHours = 2.500278,
  startState = "stopped",
  endState = "running",
  ...overrides
} = {}) {
  const result = {
    schemaVersion: 1,
    requestType: "blower_runtime_probe",
    requestId,
    ok: true,
    readOnly: true,
    assetTag: ASSET_TAG,
    dataParcTag: SOURCE_TAG,
    startAt: RAW_START_AT,
    endAt: RAW_END_AT,
    observedAt: RAW_END_AT,
    collectedAt: COLLECTED_AT,
    expectedLastReplacementAt: REPLACEMENT_AT,
    expectedCycleStartState: "started",
    expectedCycleStartedAt: CYCLE_STARTED_AT,
    expectedCycleStartRevision: "cycle-start-r1",
    expectedCycleRuntimeRevision: "cycle-runtime-r1",
    startState,
    endState,
    totalRunningHours,
    runningSeconds,
    chunkDays: 31,
    chunkCount: 1,
    completedChunkCount: 1,
    chunks: [{
      index: 1,
      startAt: RAW_START_AT,
      endAt: RAW_END_AT,
      startState,
      endState,
      totalRunningHours,
      runningSeconds
    }]
  };

  return { ...result, ...overrides };
}


function configureAsset(sqlite, overrides = {}) {
  const values = {
    assetRevision: "asset-r1",
    lastReplacementAt: REPLACEMENT_AT,
    cycleStartedAt: CYCLE_STARTED_AT,
    cycleStartState: "started",
    cycleStartRevision: "cycle-start-r1",
    cycleRuntimeHours: 77,
    cycleRuntimeAnchorAt: "2026-09-03T10:00:00.000Z",
    cycleRuntimeState: "running",
    cycleRuntimeRevision: "cycle-runtime-r1",
    runtimeHours: 77,
    runtimeAnchorAt: "2026-09-03T10:00:00.000Z",
    isRunning: 1,
    ...overrides
  };

  sqlite.prepare(`
    UPDATE blower_history_assets
    SET
      enabled = 1,
      asset_revision = ?,
      last_replacement_at = ?,
      cycle_started_at = ?,
      cycle_start_state = ?,
      cycle_start_revision = ?,
      cycle_runtime_hours = ?,
      cycle_runtime_anchor_at = ?,
      cycle_runtime_state = ?,
      cycle_runtime_revision = ?,
      runtime_hours = ?,
      runtime_anchor_at = ?,
      is_running = ?,
      last_modified_by_id = 'fixture',
      last_modified_by_name = 'Fixture',
      updated_at = '2026-09-03T10:00:00.000Z'
    WHERE tag_number = ?
  `).run(
    values.assetRevision,
    values.lastReplacementAt,
    values.cycleStartedAt,
    values.cycleStartState,
    values.cycleStartRevision,
    values.cycleRuntimeHours,
    values.cycleRuntimeAnchorAt,
    values.cycleRuntimeState,
    values.cycleRuntimeRevision,
    values.runtimeHours,
    values.runtimeAnchorAt,
    values.isRunning,
    ASSET_TAG
  );

  return values;
}


function insertManualHistory(sqlite) {
  const statement = sqlite.prepare(`
    INSERT INTO blower_history_events (
      id, tag_number, event_type, event_date, runtime_hours,
      issue_type, action_type, note, source_type, source_log_id,
      source_text, created_by_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', '', '', ?, ?, ?, ?)
  `);

  statement.run(
    "manual-replacement",
    ASSET_TAG,
    "replacement",
    REPLACEMENT_AT,
    0,
    "V-Belt",
    "교체",
    "must remain byte-identical",
    "fixture",
    "Fixture",
    REPLACEMENT_AT,
    REPLACEMENT_AT
  );
  statement.run(
    "manual-cycle-start",
    ASSET_TAG,
    "operation_start",
    CYCLE_STARTED_AT,
    0,
    "",
    "기동",
    "must also remain byte-identical",
    "fixture",
    "Fixture",
    CYCLE_STARTED_AT,
    CYCLE_STARTED_AT
  );

  sqlite.prepare(`
    INSERT INTO blower_history_asset_history (
      id, action_type, tag_number, before_json, after_json,
      change_note, changed_by_id, changed_by_name, changed_at
    ) VALUES (?, 'fixture', ?, ?, ?, ?, 'fixture', 'Fixture', ?)
  `).run(
    "manual-audit",
    ASSET_TAG,
    '{"runtime":76}',
    '{"runtime":77}',
    "must remain byte-identical",
    "2026-09-03T10:00:00.000Z"
  );
}


function insertProbeRequest(sqlite, rawResult, overrides = {}) {
  const row = {
    id: rawResult.requestId,
    requestType: "blower_runtime_probe",
    status: "complete",
    targetDate: `v1|${ASSET_TAG}|${rawResult.startAt}|${rawResult.endAt}`,
    requestedById: OWNER.employeeNo,
    completedAt: COLLECTED_AT,
    ...overrides
  };

  sqlite.prepare(`
    INSERT INTO ois_data_requests (
      id, request_type, target_date, status,
      requested_by_id, result_json, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.requestType,
    row.targetDate,
    row.status,
    row.requestedById,
    JSON.stringify(rawResult),
    row.completedAt
  );
}


async function createFixture({
  result = probeResult(),
  asset = {},
  request = {}
} = {}) {
  const database = createD1TestDatabase();
  await ensureSchema(database);
  const sqlite = database.raw();

  sqlite.exec(`
    CREATE TABLE ois_data_requests (
      id TEXT PRIMARY KEY NOT NULL,
      request_type TEXT NOT NULL,
      target_date TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by_id TEXT NOT NULL,
      result_json TEXT,
      completed_at TEXT
    );
  `);
  sqlite.prepare("DELETE FROM blower_history_events WHERE tag_number = ?")
    .run(ASSET_TAG);
  sqlite.prepare("DELETE FROM blower_history_asset_history WHERE tag_number = ?")
    .run(ASSET_TAG);
  sqlite.exec("DELETE FROM blower_history_atomic_guard");

  configureAsset(sqlite, asset);
  insertManualHistory(sqlite);
  insertProbeRequest(sqlite, result, request);

  return { database, sqlite, result };
}


function plain(value) {
  return JSON.parse(JSON.stringify(value));
}


function readState(sqlite) {
  return plain({
    asset: sqlite.prepare(`
      SELECT * FROM blower_history_assets WHERE tag_number = ?
    `).get(ASSET_TAG),
    events: sqlite.prepare(`
      SELECT * FROM blower_history_events
      WHERE tag_number = ?
      ORDER BY id
    `).all(ASSET_TAG),
    history: sqlite.prepare(`
      SELECT * FROM blower_history_asset_history
      WHERE tag_number = ?
      ORDER BY id
    `).all(ASSET_TAG),
    guards: sqlite.prepare(`
      SELECT * FROM blower_history_atomic_guard ORDER BY id
    `).all()
  });
}


function readManualRows(state) {
  return state.events.filter(event => event.source_type === "manual");
}


async function invokeSync(
  database,
  user = OWNER,
  body = { requestId: REQUEST_ID },
  now = NOW
) {
  const response = await applyDataParcRuntimeSync(
    database,
    user,
    body,
    { now }
  );

  return {
    status: response.status,
    body: await response.json()
  };
}


test("atomically applies canonical seconds, preserves manual history, and replays without churn", async () => {
  const fixture = await createFixture();

  try {
    const before = readState(fixture.sqlite);
    const result = await invokeSync(
      fixture.database,
      OWNER,
      {
        requestId: REQUEST_ID,
        tagNumber: "CLIENT-TAMPERED-ASSET",
        dataParcTag: "CLIENT.TAMPERED.TAG",
        runtimeHours: 999999,
        isRunning: false
      }
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.applied, true);
    assert.equal(result.body.replayed, false);
    assert.equal(result.body.assetTag, ASSET_TAG);
    assert.equal(result.body.dataParcTag, SOURCE_TAG);
    assert.equal(result.body.runtimeHours, 9001 / 3600);
    assert.equal(result.body.isRunning, true);

    const after = readState(fixture.sqlite);
    assert.equal(after.asset.runtime_hours, 9001 / 3600);
    assert.equal(after.asset.cycle_runtime_hours, 9001 / 3600);
    assert.notEqual(after.asset.runtime_hours, fixture.result.totalRunningHours);
    assert.equal(after.asset.runtime_anchor_at, RAW_END_AT);
    assert.equal(after.asset.cycle_runtime_anchor_at, RAW_END_AT);
    assert.equal(after.asset.is_running, 1);
    assert.equal(after.asset.cycle_runtime_state, "running");
    assert.notEqual(after.asset.cycle_runtime_revision, "cycle-runtime-r1");
    assert.equal(after.asset.last_replacement_at, before.asset.last_replacement_at);
    assert.equal(after.asset.cycle_started_at, before.asset.cycle_started_at);
    assert.equal(after.asset.cycle_start_state, before.asset.cycle_start_state);
    assert.equal(after.asset.cycle_start_revision, before.asset.cycle_start_revision);
    assert.equal(after.asset.asset_revision, before.asset.asset_revision);
    assert.deepEqual(readManualRows(after), readManualRows(before));
    assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.guards, []);

    const syncEvent = after.events.find(event =>
      event.id === `dataparc_runtime:${REQUEST_ID}`
    );
    assert.ok(syncEvent);
    assert.equal(syncEvent.event_type, "runtime_correction");
    assert.equal(syncEvent.event_date, RAW_END_AT);
    assert.equal(syncEvent.runtime_hours, 9001 / 3600);
    assert.equal(syncEvent.issue_type, "DataPARC");
    assert.equal(syncEvent.source_type, "dataparc_runtime");
    assert.equal(syncEvent.source_log_id, REQUEST_ID);
    assert.deepEqual(
      {
        requestId: JSON.parse(syncEvent.source_text).requestId,
        assetTag: JSON.parse(syncEvent.source_text).assetTag,
        dataParcTag: JSON.parse(syncEvent.source_text).dataParcTag,
        totalRunningHours: JSON.parse(syncEvent.source_text).totalRunningHours,
        runningSeconds: JSON.parse(syncEvent.source_text).runningSeconds
      },
      {
        requestId: REQUEST_ID,
        assetTag: ASSET_TAG,
        dataParcTag: SOURCE_TAG,
        totalRunningHours: 2.500278,
        runningSeconds: 9001
      }
    );

    const replay = await invokeSync(
      fixture.database,
      OWNER,
      { requestId: REQUEST_ID },
      new Date("2026-09-03T13:00:00.000Z")
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.applied, false);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(readState(fixture.sqlite), after);

    const conflictingProbe = probeResult({
      runningSeconds: 0,
      totalRunningHours: 0,
      startState: "stopped",
      endState: "stopped"
    });
    fixture.sqlite.prepare(`
      UPDATE ois_data_requests SET result_json = ? WHERE id = ?
    `).run(JSON.stringify(conflictingProbe), REQUEST_ID);
    const conflict = await invokeSync(fixture.database);
    assert.equal(conflict.status, 409);
    assert.equal(
      conflict.body.code,
      "DATAPARC_RUNTIME_IDEMPOTENCY_CONFLICT"
    );
    assert.deepEqual(readState(fixture.sqlite), after);
  } finally {
    fixture.database.close();
  }
});


test("accepts a zero-runtime stopped probe with the correct stopped anchors", async () => {
  const result = probeResult({
    runningSeconds: 0,
    totalRunningHours: 0,
    startState: "stopped",
    endState: "stopped"
  });
  const fixture = await createFixture({ result });

  try {
    const response = await invokeSync(fixture.database);
    assert.equal(response.status, 200);
    assert.equal(response.body.runtimeHours, 0);
    assert.equal(response.body.isRunning, false);

    const state = readState(fixture.sqlite);
    assert.equal(state.asset.runtime_hours, 0);
    assert.equal(state.asset.cycle_runtime_hours, 0);
    assert.equal(state.asset.runtime_anchor_at, null);
    assert.equal(state.asset.cycle_runtime_anchor_at, RAW_END_AT);
    assert.equal(state.asset.is_running, 0);
    assert.equal(state.asset.cycle_runtime_state, "stopped");

    const event = state.events.find(candidate =>
      candidate.id === `dataparc_runtime:${REQUEST_ID}`
    );
    assert.equal(event.runtime_hours, 0);
  } finally {
    fixture.database.close();
  }
});


test("enforces request ownership for both first apply and replay while allowing super-admin", async () => {
  const fixture = await createFixture();
  const stranger = {
    employeeNo: "someone-else",
    name: "Someone Else",
    isSuperAdmin: false
  };
  const administrator = {
    employeeNo: "site-admin",
    name: "Site Admin",
    isSuperAdmin: true
  };

  try {
    const before = readState(fixture.sqlite);
    const forbidden = await invokeSync(fixture.database, stranger);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, "DATAPARC_RUNTIME_PROBE_FORBIDDEN");
    assert.deepEqual(readState(fixture.sqlite), before);

    const applied = await invokeSync(fixture.database, administrator);
    assert.equal(applied.status, 200);
    assert.equal(applied.body.applied, true);
    const after = readState(fixture.sqlite);
    assert.equal(after.asset.last_modified_by_id, administrator.employeeNo);

    const forbiddenReplay = await invokeSync(
      fixture.database,
      stranger,
      { requestId: REQUEST_ID },
      new Date("2026-09-03T13:00:00.000Z")
    );
    assert.equal(forbiddenReplay.status, 403);
    assert.deepEqual(readState(fixture.sqlite), after);
  } finally {
    fixture.database.close();
  }
});


test("rejects stale first-use probes, non-complete queue rows, and target-date tampering without writes", async t => {
  const cases = [
    {
      name: "stale first use",
      now: new Date("2026-09-03T12:16:00.000Z"),
      expectedStatus: 409,
      expectedCode: "DATAPARC_RUNTIME_PROBE_STALE"
    },
    {
      name: "wrong request type",
      request: { requestType: "steam_status" },
      expectedStatus: 409,
      expectedCode: "DATAPARC_RUNTIME_PROBE_NOT_COMPLETE"
    },
    {
      name: "pending request",
      request: { status: "pending" },
      expectedStatus: 409,
      expectedCode: "DATAPARC_RUNTIME_PROBE_NOT_COMPLETE"
    },
    {
      name: "target date changed after enqueue",
      request: { targetDate: `v1|${ASSET_TAG}|tampered|${RAW_END_AT}` },
      expectedStatus: 400,
      expectedCode: "DATAPARC_RUNTIME_PROBE_INVALID"
    }
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const fixture = await createFixture({ request: testCase.request });

      try {
        const before = readState(fixture.sqlite);
        const result = await invokeSync(
          fixture.database,
          OWNER,
          { requestId: REQUEST_ID },
          testCase.now || NOW
        );

        assert.equal(result.status, testCase.expectedStatus);
        assert.equal(result.body.code, testCase.expectedCode);
        assert.deepEqual(readState(fixture.sqlite), before);
      } finally {
        fixture.database.close();
      }
    });
  }
});


test("rejects every stale cycle snapshot field and pending cycles with zero writes", async t => {
  const cases = [
    ["last replacement", "last_replacement_at", "2026-08-19T00:00:01.000Z"],
    ["cycle start state", "cycle_start_state", "legacy"],
    ["cycle start timestamp", "cycle_started_at", "2026-08-20T00:00:00.999Z"],
    ["cycle start revision", "cycle_start_revision", "cycle-start-r2"],
    ["cycle runtime revision", "cycle_runtime_revision", "cycle-runtime-r2"]
  ];

  for (const [name, column, value] of cases) {
    await t.test(name, async () => {
      const fixture = await createFixture();

      try {
        fixture.sqlite.prepare(`
          UPDATE blower_history_assets SET ${column} = ? WHERE tag_number = ?
        `).run(value, ASSET_TAG);
        const before = readState(fixture.sqlite);
        const result = await invokeSync(fixture.database);

        assert.equal(result.status, 409);
        assert.equal(result.body.code, "DATAPARC_RUNTIME_CYCLE_CONFLICT");
        assert.deepEqual(readState(fixture.sqlite), before);
      } finally {
        fixture.database.close();
      }
    });
  }

  await t.test("pending cycle", async () => {
    const fixture = await createFixture({
      asset: { cycleStartState: "pending" }
    });

    try {
      const before = readState(fixture.sqlite);
      const result = await invokeSync(fixture.database);
      assert.equal(result.status, 409);
      assert.equal(result.body.code, "DATAPARC_RUNTIME_CYCLE_PENDING");
      assert.deepEqual(readState(fixture.sqlite), before);
    } finally {
      fixture.database.close();
    }
  });
});


test("rolls back the asset, event, and guard when the atomic verification fails", async () => {
  const fixture = await createFixture();

  try {
    const before = readState(fixture.sqlite);
    fixture.database.afterStatement = ({ sqlite, statement }) => {
      if (!/INSERT\s+INTO\s+blower_history_events/i.test(statement.sql)) {
        return;
      }

      sqlite.prepare(`
        UPDATE blower_history_events
        SET note = note || ' [fault injected]'
        WHERE source_type = 'dataparc_runtime'
      `).run();
    };

    const result = await invokeSync(fixture.database);
    fixture.database.afterStatement = null;

    assert.equal(result.status, 409);
    assert.equal(result.body.code, "DATAPARC_RUNTIME_CYCLE_CONFLICT");
    assert.deepEqual(readState(fixture.sqlite), before);
    assert.deepEqual(readState(fixture.sqlite).guards, []);
  } finally {
    fixture.database.close();
  }
});
