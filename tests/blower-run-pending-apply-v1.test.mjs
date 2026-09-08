import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { __blowerHistoryTest as api } from "../functions/api/blower-history.js";

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


const ASSETS = ["104ETH03AN601", "104ETH03AN602", "104ETG30AN601", "104ETG30AN602", "204ETG30AN601", "204ETG30AN602", "104SDF01AN001", "104SDF01AN002", "204SDF01AN001", "204SDF01AN002", "204LMDF01AN001", "104HHL60AP611", "104HHL60AP621", "104HHL60AP631", "204HHL60AP611", "204HHL60AP621", "204HHL60AP631", "104HHL10AN611", "104HHL10AN621", "104HHL10AN631", "204HHL10AN611", "204HHL10AN621", "204HHL10AN631"];
const B = "104ETH03AN602";
const B_SOURCE = "GSPOGE.ABB_DCS.003ETH03AN602XB04";
const OWNER = { employeeNo: "test-owner", name: "조회자" };
const NOW = new Date("2026-09-08T13:00:00.000Z");
const START = "2026-09-01T00:00:00+09:00";
const END = "2026-09-08T21:59:30+09:00";
const REPLACED = "2026-08-20T00:00:00.000Z";
const sourceFor = tag => tag === B ? B_SOURCE : `GSPOGE.ABB_DCS.TEST_CONFIRMED_${tag}_RUN`;
const rawProbe = (tag, source = sourceFor(tag), stopped = false) => ({
  schemaVersion: 1, requestType: "blower_runtime_probe", requestId: `multi-${tag}`, ok: true, readOnly: true,
  assetTag: tag, dataParcTag: source, startAt: START, endAt: END, observedAt: END,
  collectedAt: "2026-09-08T12:59:45.000Z", expectedLastReplacementAt: REPLACED,
  expectedCycleStartState: "legacy", expectedCycleStartedAt: "", expectedCycleStartRevision: "legacy-r1",
  expectedCycleRuntimeRevision: "runtime-r1", startState: "stopped", endState: stopped ? "stopped" : "running",
  totalRunningHours: stopped ? 0 : 3.500278, runningSeconds: stopped ? 0 : 12601,
  chunkDays: 31, chunkCount: 1, completedChunkCount: 1,
  chunks: [{ index: 1, startAt: START, endAt: END, startState: "stopped", endState: stopped ? "stopped" : "running",
    totalRunningHours: stopped ? 0 : 3.500278, runningSeconds: stopped ? 0 : 12601 }]
});
function putIntent(sqlite, probe, table = "blower_runtime_probe_intents_v4") {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS ${table} (
    request_id TEXT PRIMARY KEY, schema_version INTEGER, asset_tag TEXT, dataparc_tag TEXT,
    window_start TEXT, window_end TEXT, chunk_days INTEGER, chunk_count INTEGER,
    expected_last_replacement_at TEXT, expected_cycle_start_state TEXT, expected_cycle_started_at TEXT,
    expected_cycle_start_revision TEXT, expected_cycle_runtime_revision TEXT)`);
  sqlite.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(probe.requestId, 1, probe.assetTag, probe.dataParcTag, probe.startAt, probe.endAt, 31, 1,
      probe.expectedLastReplacementAt, probe.expectedCycleStartState, probe.expectedCycleStartedAt,
      probe.expectedCycleStartRevision, probe.expectedCycleRuntimeRevision);
}
function putRequest(sqlite, probe) {
  sqlite.prepare(`INSERT INTO ois_data_requests VALUES (?, 'blower_runtime_probe', 'complete', ?, ?, ?, ?)`)
    .run(probe.requestId, `v1|${probe.assetTag}|${probe.startAt}|${probe.endAt}`, OWNER.employeeNo,
      JSON.stringify(probe), probe.collectedAt);
}
async function fixture(tag = ASSETS[0], { table = "blower_runtime_probe_intents_v4", stopped = false } = {}) {
  const database = createD1TestDatabase();
  await api.ensureSchema(database);
  const sqlite = database.raw();
  sqlite.exec(`CREATE TABLE ois_data_requests (id TEXT PRIMARY KEY, request_type TEXT, status TEXT,
    target_date TEXT, requested_by_id TEXT, result_json TEXT, completed_at TEXT)`);
  sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at = ?, cycle_start_state = 'legacy',
    cycle_started_at = NULL, cycle_start_revision = 'legacy-r1', cycle_runtime_hours = 77,
    cycle_runtime_state = 'running', cycle_runtime_revision = 'runtime-r1', runtime_hours = 77 WHERE tag_number = ?`)
    .run(REPLACED, tag);
  const probe = rawProbe(tag, sourceFor(tag), stopped);
  putRequest(sqlite, probe);
  if (table) putIntent(sqlite, probe, table);
  return { database, sqlite, probe };
}
async function apply(database, probe, now = NOW) {
  const response = await api.applyDataParcRuntimeSync(database, OWNER, { requestId: probe.requestId }, { now });
  return { status: response.status, body: await response.json() };
}
const state = sqlite => JSON.stringify({
  assets: sqlite.prepare("SELECT * FROM blower_history_assets ORDER BY tag_number").all(),
  events: sqlite.prepare("SELECT * FROM blower_history_events ORDER BY id").all(),
  guards: sqlite.prepare("SELECT * FROM blower_history_atomic_guard").all()
});

test("all twenty-three confirmed pairs apply only to their asset and replay without changes", async t => {
  for (const [index, tag] of ASSETS.entries()) await t.test(tag, async () => {
    const { database, sqlite, probe } = await fixture(tag, { stopped: index % 2 === 0 });
    try {
      const othersBefore = JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number <> ? ORDER BY tag_number").all(tag));
      const result = await apply(database, probe);
      assert.equal(result.status, 200, result.body.message);
      assert.equal(result.body.assetTag, tag);
      assert.equal(result.body.dataParcTag, sourceFor(tag));
      assert.equal(result.body.runtimeHours, probe.runningSeconds / 3600);
      const asset = sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number = ?").get(tag);
      assert.equal(asset.cycle_runtime_state, probe.endState);
      assert.equal(asset.runtime_anchor_at, probe.endState === "running" ? new Date(END).toISOString() : null);
      assert.equal(asset.last_replacement_at, REPLACED);
      assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number <> ? ORDER BY tag_number").all(tag)), othersBefore);
      const after = state(sqlite);
      assert.equal((await apply(database, probe, new Date("2026-09-10T00:00:00Z"))).body.replayed, true);
      assert.equal(state(sqlite), after);
    } finally { database.close(); }
  });
});

test("missing canonical intents fail for both the pilot and a new asset", async () => {
  for (const tag of [B, ASSETS[0]]) {
    const { database, sqlite, probe } = await fixture(tag, { table: null });
    try {
      const before = state(sqlite);
      assert.equal((await apply(database, probe)).body.code, "DATAPARC_RUNTIME_INTENT_CONFLICT");
      assert.equal(state(sqlite), before);
    } finally { database.close(); }
  }
});

test("V2 compatibility admits the pilot only and does not bypass a conflicting V3 intent", async () => {
  for (const tag of [B, ASSETS[0]]) {
    const { database, sqlite, probe } = await fixture(tag, { table: "blower_runtime_probe_intents_v2" });
    try {
      assert.equal((await apply(database, probe)).status, tag === B ? 200 : 409);
      if (tag === B) {
        putIntent(sqlite, { ...probe, expectedCycleRuntimeRevision: "tampered" });
        const before = state(sqlite);
        assert.equal((await apply(database, probe)).body.code, "DATAPARC_RUNTIME_INTENT_CONFLICT");
        assert.equal(state(sqlite), before);
      }
    } finally { database.close(); }
  }
});

test("source, equipment, time boundaries and every cycle field are bound to the stored intent", async t => {
  const tampering = {
    asset_tag: "204ETG30AN602", dataparc_tag: "GSPOGE.ABB_DCS.A_DIFFERENT_CONFIRMED_RUN",
    window_start: "2026-08-31T15:00:00.000Z", window_end: "2026-09-08T12:59:30.000Z",
    chunk_count: 2, expected_last_replacement_at: "2026-08-21T00:00:00.000Z",
    expected_cycle_start_state: "started", expected_cycle_started_at: START,
    expected_cycle_start_revision: "different-cycle", expected_cycle_runtime_revision: "different-runtime"
  };
  for (const [field, value] of Object.entries(tampering)) await t.test(field, async () => {
    const { database, sqlite, probe } = await fixture();
    try {
      sqlite.prepare(`UPDATE blower_runtime_probe_intents_v4 SET ${field} = ?`).run(value);
      const before = state(sqlite);
      const result = await apply(database, probe);
      assert.equal(result.body.code, "DATAPARC_RUNTIME_INTENT_CONFLICT");
      assert.equal(state(sqlite), before);
    } finally { database.close(); }
  });
});

test("literal source grammar rejects formula characters, unqualified tags, extra whitespace and unsupported equipment", () => {
  for (const bad of ["RUN_TAG", "GSPOGE.ABB_DCS.lowercase", " GSPOGE.ABB_DCS.RUN", "GSPOGE.ABB_DCS.RUN ",
    "GSPOGE.ABB_DCS.RUN\"", "GSPOGE.ABB_DCS.RUN;", "GSPOGE.ABB_DCS.RUN\nX", "GSPOGE.ABB_DCS.RUN/STOP", "GSPOGE.ABB_DCS." + "A".repeat(190)]) {
    assert.ok(api.normalizeDataParcRuntimeProbeResult(rawProbe(ASSETS[0], bad), `multi-${ASSETS[0]}`, NOW).error, bad);
  }
  for (const tag of ["104HHL60AP612", "104HHL10AN612", "204LMDF01AN002"]) {
    assert.ok(api.normalizeDataParcRuntimeProbeResult(rawProbe(tag), `multi-${tag}`, NOW).error);
  }
  assert.ok(api.normalizeDataParcRuntimeProbeResult(rawProbe(B, "GSPOGE.ABB_DCS.WRONG_RUN"), `multi-${B}`, NOW).error);
  assert.ok(api.normalizeDataParcRuntimeProbeResult(rawProbe(ASSETS[0], B_SOURCE), `multi-${ASSETS[0]}`, NOW).error, "the proven B signal cannot be reassigned to A");
});

test("GET returns the successful source across replacement cycles and replay uses its original pair", async () => {
  const { database, sqlite, probe } = await fixture();
  try {
    assert.equal((await apply(database, probe)).status, 200);
    const read = () => api.loadAssetStates(database, {});
    assert.equal((await read()).find(row => row.tagNumber === probe.assetTag).dataParcTag, probe.dataParcTag);
    const pilot = (await read()).find(row => row.tagNumber === B);
    assert.equal(pilot.dataParcTag, B_SOURCE);
    const current = sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number = ?").get(probe.assetTag);
    const second = { ...probe, requestId: "same-asset-new-confirmed-source", dataParcTag: "GSPOGE.ABB_DCS.NEW_CONFIRMED_RUN",
      expectedCycleRuntimeRevision: current.cycle_runtime_revision };
    putRequest(sqlite, second); putIntent(sqlite, second);
    assert.equal((await apply(database, second)).status, 200);
    // Later committed observations supply the form default, not a mutable global mapping.
    sqlite.prepare("UPDATE blower_history_events SET created_at = ? WHERE source_log_id = ?").run("2026-09-08T13:01:00.000Z", second.requestId);
    assert.equal((await read()).find(row => row.tagNumber === probe.assetTag).dataParcTag, second.dataParcTag);
    sqlite.prepare("UPDATE blower_history_assets SET last_replacement_at = ?, cycle_start_state = 'pending' WHERE tag_number = ?")
      .run("2026-09-09T00:00:00.000Z", probe.assetTag);
    assert.equal((await read()).find(row => row.tagNumber === probe.assetTag).dataParcTag, second.dataParcTag);
    const after = state(sqlite);
    assert.equal((await apply(database, probe)).body.replayed, true);
    assert.equal(state(sqlite), after);
  } finally { database.close(); }
});

test("failed or mismatched event evidence cannot become a remembered source", () => {
  const tag = ASSETS[0];
  const valid = { id: "dataparc_runtime:saved-1", tag_number: tag, event_type: "runtime_correction", source_type: "dataparc_runtime",
    source_log_id: "saved-1", source_text: JSON.stringify({ requestType: "blower_runtime_probe", requestId: "saved-1", assetTag: tag, dataParcTag: sourceFor(tag) }) };
  assert.equal(api.latestSuccessfulDataParcTag(tag, [valid]), sourceFor(tag));
  for (const bad of [{ ...valid, id: "manual-id" }, { ...valid, tag_number: B }, { ...valid, source_type: "manual" },
    { ...valid, source_text: "invalid JSON" }, { ...valid, source_text: valid.source_text.replace(tag, B) }]) {
    assert.equal(api.latestSuccessfulDataParcTag(tag, [bad]), "");
  }
});

test("FBHE pending cycles use the legacy Agent wire contract but apply to the exact pending revision and remain appendable", async () => {
  const tag = "104HHL60AP621";
  const database = createD1TestDatabase();
  await api.ensureSchema(database);
  const sqlite = database.raw();
  try {
    sqlite.exec(`CREATE TABLE ois_data_requests (id TEXT PRIMARY KEY, request_type TEXT, status TEXT,
      target_date TEXT, requested_by_id TEXT, result_json TEXT, completed_at TEXT)`);
    sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at = ?, cycle_start_state = 'pending',
      cycle_started_at = NULL, cycle_start_revision = 'pending-start-r1', cycle_runtime_hours = 0,
      cycle_runtime_anchor_at = NULL, cycle_runtime_state = 'unknown', cycle_runtime_revision = 'runtime-r1',
      runtime_hours = 0, runtime_anchor_at = NULL, is_running = 0 WHERE tag_number = ?`).run(REPLACED, tag);

    const probe = {
      ...rawProbe(tag),
      requestId: `pending-${tag}`,
      expectedCycleStartState: 'legacy',
      expectedCycleStartedAt: '',
      expectedCycleStartRevision: 'signal-only-v1:pending-start-r1',
      expectedCycleRuntimeRevision: 'runtime-r1',
      runningSeconds: 7200,
      totalRunningHours: 2,
      endState: 'running',
      chunks: [{ index:1, startAt:START, endAt:END, startState:'stopped', endState:'running', totalRunningHours:2, runningSeconds:7200 }]
    };
    putRequest(sqlite, probe);
    putIntent(sqlite, probe);

    const result = await apply(database, probe);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.runtimeHours, 2);
    const asset = sqlite.prepare(`SELECT * FROM blower_history_assets WHERE tag_number = ?`).get(tag);
    assert.equal(asset.cycle_start_state, 'pending', 'manual startup is not fabricated by a RUN=1 signal');
    assert.equal(asset.cycle_started_at, null);
    assert.equal(asset.cycle_start_revision, 'pending-start-r1');
    assert.equal(asset.cycle_runtime_hours, 2);
    assert.equal(asset.cycle_runtime_state, 'running');

    const event = sqlite.prepare(`SELECT * FROM blower_history_events WHERE id = ?`).get(`dataparc_runtime:${probe.requestId}`);
    const source = JSON.parse(event.source_text);
    assert.equal(source.signalOnlyCycle, true);
    assert.equal(source.expectedCycleStartState, 'legacy');
    assert.equal(source.expectedCycleStartRevision, 'pending-start-r1');
    assert.equal(api.currentDataParcRuntimeBasis(asset, [event])?.runtimeHours, 2);
  } finally { database.close(); }
});
