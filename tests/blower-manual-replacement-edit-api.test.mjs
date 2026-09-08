import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { __blowerHistoryTest as api } from "../functions/api/blower-history.js";

const TAG = "104SDF01AN001";
const REPLACED = "2026-08-19T15:00:00.000Z";
const NOW = new Date("2026-09-08T15:00:00.000Z");
const OWNER = { employeeNo: "operator-a", name: "수정자" };
const START = "2026-08-20T01:00:00+09:00";
const STOP = "2026-08-21T01:00:00+09:00";
function databaseFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const database = {
    afterStatement: null,
    prepare(sql) {
      return {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async first() { return sqlite.prepare(sql).get(...this.values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...this.values).changes) } }; }
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const [index, statement] of statements.entries()) {
          results.push(await statement.run());
          if (database.afterStatement) await database.afterStatement({ index, sqlite, statement });
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    }
  };
  return { database, sqlite };
}
function addEvent(sqlite, event = {}) {
  const value = {
    id: "manual-replacement", tag_number: TAG, event_type: "replacement", event_date: REPLACED,
    runtime_hours: 2052.1, issue_type: "이상진동", action_type: "V-Belt 교체", note: "입력 착오",
    source_type: "manual", source_log_id: "", source_text: "",
    created_by_id: "original-operator", created_by_name: "등록자",
    created_at: "2026-09-08T14:20:00.000Z", updated_at: "2026-09-08T14:20:00.000Z", ...event
  };
  sqlite.prepare(`INSERT INTO blower_history_events (${Object.keys(value).join(",")}) VALUES (${Object.keys(value).map(() => "?").join(",")})`).run(...Object.values(value));
}
async function fixture({ active = false } = {}) {
  const f = databaseFixture();
  await api.ensureSchema(f.database);
  f.sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at = ?, cycle_started_at = ?,
    cycle_start_state = ?, cycle_start_revision = 'start-r1', cycle_runtime_hours = ?,
    cycle_runtime_anchor_at = ?, cycle_runtime_state = ?, cycle_runtime_revision = 'runtime-r1',
    runtime_hours = ?, runtime_anchor_at = ?, is_running = ?, updated_at = '2026-09-08T14:20:00.000Z'
    WHERE tag_number = ?`).run(REPLACED, active ? new Date(START).toISOString() : null,
      active ? "started" : "pending", active ? 123.5 : 0, active ? NOW.toISOString() : REPLACED,
      active ? "running" : "stopped", active ? 123.5 : 0, active ? NOW.toISOString() : null, active ? 1 : 0, TAG);
  addEvent(f.sqlite, { id: "older-replacement", event_date: "2025-12-18T15:00:00.000Z", source_type: "shift_log_history_auto", created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z" });
  addEvent(f.sqlite, { id: "old-dataparc", event_type: "runtime_correction", event_date: "2026-09-08T14:16:00.000Z",
    action_type: "DataPARC 정지 동기화", issue_type: "DataPARC", source_type: "dataparc_runtime",
    source_log_id: "original-probe", source_text: '{"schemaVersion":1,"untouched":"original DataPARC audit bytes"}',
    created_at: "2026-09-08T14:17:00.000Z", updated_at: "2026-09-08T14:17:00.000Z" });
  addEvent(f.sqlite);
  return f;
}
const asset = sqlite => sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number = ?").get(TAG);
const event = (sqlite, id = "manual-replacement") => sqlite.prepare("SELECT * FROM blower_history_events WHERE id = ?").get(id);
const state = sqlite => JSON.stringify({
  assets: sqlite.prepare("SELECT * FROM blower_history_assets ORDER BY tag_number").all(),
  events: sqlite.prepare("SELECT * FROM blower_history_events ORDER BY id").all(),
  audit: sqlite.prepare("SELECT * FROM blower_history_asset_history ORDER BY id").all(),
  guards: sqlite.prepare("SELECT * FROM blower_history_atomic_guard ORDER BY id").all()
});
function body(sqlite, overrides = {}) {
  const a = asset(sqlite), e = event(sqlite);
  return { tagNumber: TAG, eventId: e.id, eventDate: e.event_date, issueType: "정기주기", note: "정정한 내용",
    operationMode: "preserve", expectedEventUpdatedAt: e.updated_at,
    expectedLastReplacementAt: a.last_replacement_at, expectedCycleStartRevision: a.cycle_start_revision,
    expectedCycleRuntimeRevision: a.cycle_runtime_revision, ...overrides };
}
async function edit(f, overrides = {}, suppliedBody = null) {
  const response = await api.editCurrentManualReplacement(f.database, OWNER, suppliedBody || body(f.sqlite, overrides), { now: NOW });
  return { status: response.status, body: await response.json() };
}

test("screenshot pending cycle can edit its manual replacement while preserving original DataPARC and evidence", async () => {
  const f = await fixture();
  try {
    const before = { ...asset(f.sqlite) }, original = { ...event(f.sqlite) };
    const dataparc = JSON.stringify(event(f.sqlite, "old-dataparc"));
    const result = await edit(f, { eventDate: "2026-08-21T00:00:00+09:00" });
    assert.equal(result.status, 200, result.body.message);
    const after = asset(f.sqlite), edited = event(f.sqlite);
    assert.equal(after.last_replacement_at, "2026-08-20T15:00:00.000Z");
    assert.equal(after.cycle_start_state, "pending");
    assert.equal(after.cycle_runtime_hours, 0);
    assert.notEqual(after.cycle_start_revision, before.cycle_start_revision);
    assert.notEqual(after.cycle_runtime_revision, before.cycle_runtime_revision);
    for (const key of ["id", "runtime_hours", "created_by_id", "created_by_name", "created_at", "source_type", "source_text", "action_type"]) assert.equal(edited[key], original[key]);
    assert.equal(JSON.stringify(event(f.sqlite, "old-dataparc")), dataparc);
    assert.equal(result.body.runtimeCorrectionEventId, "");
    const audit = f.sqlite.prepare("SELECT * FROM blower_history_asset_history").get();
    assert.deepEqual(JSON.parse(audit.before_json), { asset: before, event: original });
    assert.deepEqual(JSON.parse(audit.after_json).asset, { ...after });
    assert.equal(audit.changed_by_name, OWNER.name);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM blower_history_events").get().n, 3);
  } finally { f.sqlite.close(); }
});

test("active preserve edits only metadata without moving runtime anchors or revisions", async () => {
  const f = await fixture({ active: true });
  try {
    const before = asset(f.sqlite);
    const result = await edit(f, { eventDate: "2026-08-20T00:00:00+09:00" });
    assert.equal(result.status, 200, result.body.message);
    const after = asset(f.sqlite);
    for (const key of ["last_replacement_at", "cycle_start_state", "cycle_started_at", "cycle_start_revision", "cycle_runtime_revision", "cycle_runtime_hours", "cycle_runtime_anchor_at", "cycle_runtime_state", "runtime_hours", "runtime_anchor_at", "is_running"]) assert.equal(after[key], before[key], key);
    assert.equal(event(f.sqlite).note, "정정한 내용");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM blower_history_events").get().n, 3);
  } finally { f.sqlite.close(); }
});

test("running and stopped modes use only the specified continuous interval and add one current correction", async t => {
  for (const mode of ["running", "stopped", "pending"]) await t.test(mode, async () => {
    const f = await fixture({ active: mode === "pending" });
    try {
      const oldEvents = f.sqlite.prepare("SELECT * FROM blower_history_events WHERE id <> 'manual-replacement' ORDER BY id").all();
      const before = asset(f.sqlite);
      const result = await edit(f, { operationMode: mode, startupAt: START, stoppedAt: STOP });
      assert.equal(result.status, 200, result.body.message);
      const after = asset(f.sqlite), correction = event(f.sqlite, result.body.runtimeCorrectionEventId);
      const expectedHours = mode === "pending" ? 0 : mode === "stopped" ? 24 : (NOW - new Date(START)) / 3600000;
      assert.equal(after.cycle_runtime_hours, expectedHours);
      assert.equal(after.runtime_hours, expectedHours);
      assert.equal(after.cycle_runtime_anchor_at, NOW.toISOString());
      assert.equal(after.runtime_anchor_at, mode === "running" ? NOW.toISOString() : null);
      assert.equal(after.is_running, mode === "running" ? 1 : 0);
      assert.equal(after.cycle_start_state, mode === "pending" ? "pending" : "started");
      assert.equal(after.cycle_started_at, mode === "pending" ? null : new Date(START).toISOString());
      assert.notEqual(after.cycle_start_revision, before.cycle_start_revision);
      assert.notEqual(after.cycle_runtime_revision, before.cycle_runtime_revision);
      assert.equal(correction.source_type, "manual");
      assert.equal(correction.event_date, NOW.toISOString());
      assert.equal(correction.runtime_hours, expectedHours);
      assert.equal(correction.event_type, "runtime_correction");
      assert.ok(correction.note && !correction.note.startsWith("{"));
      if (mode !== "running") assert.match(correction.action_type, /정지/);
      const provenance = JSON.parse(correction.source_text);
      assert.equal(provenance.replacementEdit, true);
      assert.equal(provenance.before.cycleRuntimeRevision, before.cycle_runtime_revision);
      assert.equal(provenance.after.cycleRuntimeRevision, after.cycle_runtime_revision);
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM blower_history_events WHERE id <> 'manual-replacement' AND id <> ? ORDER BY id").all(correction.id), oldEvents);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM blower_history_events").get().n, 4);
    } finally { f.sqlite.close(); }
  });
});

test("invalid date, zone, sequence and operation mode inputs cause no writes", async t => {
  const cases = [
    ["timezone-free", { eventDate: "2026-08-20T00:00:00" }],
    ["impossible day", { eventDate: "2026-02-30T00:00:00+09:00" }],
    ["impossible offset", { eventDate: "2026-08-20T00:00:00+15:00" }],
    ["future replacement", { eventDate: "2026-09-09T01:00:00+09:00" }],
    ["before previous", { eventDate: "2025-12-01T00:00:00+09:00" }],
    ["equal previous", { eventDate: "2025-12-19T00:00:00+09:00" }],
    ["unknown state", { operationMode: "random" }],
    ["missing startup", { operationMode: "running" }],
    ["timezone-free startup", { operationMode: "running", startupAt: "2026-08-20T01:00:00" }],
    ["startup before replacement", { operationMode: "running", startupAt: "2026-08-19T00:00:00+09:00" }],
    ["future startup", { operationMode: "running", startupAt: "2026-09-09T01:00:00+09:00" }],
    ["missing stop", { operationMode: "stopped", startupAt: START }],
    ["stop before startup", { operationMode: "stopped", startupAt: START, stoppedAt: "2026-08-20T00:30:00+09:00" }],
    ["future stop", { operationMode: "stopped", startupAt: START, stoppedAt: "2026-09-09T01:00:00+09:00" }]
  ];
  for (const [label, overrides] of cases) await t.test(label, async () => {
    const f = await fixture();
    try { const before = state(f.sqlite); assert.equal((await edit(f, overrides)).status, 400); assert.equal(state(f.sqlite), before); }
    finally { f.sqlite.close(); }
  });
});

test("active date change needs an explicit state but same-date duplicate legacy evidence permits metadata editing", async () => {
  const f = await fixture({ active: true });
  try {
    const before = state(f.sqlite);
    assert.equal((await edit(f, { eventDate: "2026-08-21T00:00:00+09:00" })).status, 400);
    assert.equal(state(f.sqlite), before);
    addEvent(f.sqlite, { id: "same-date-legacy", source_type: "shift_log_history_auto", created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z" });
    assert.equal((await edit(f)).status, 200);
  } finally { f.sqlite.close(); }
});

test("stale fields, another cycle, older event and nonmanual replacement reject without writes", async t => {
  const cases = [
    ["stale updated", { expectedEventUpdatedAt: "stale" }],
    ["stale replacement", { expectedLastReplacementAt: "stale" }],
    ["stale start revision", { expectedCycleStartRevision: "stale" }],
    ["stale runtime revision", { expectedCycleRuntimeRevision: "stale" }],
    ["older event", { eventId: "older-replacement" }],
    ["missing event", { eventId: "missing" }, 404],
    ["missing snapshot", { expectedCycleStartRevision: "" }, 400]
  ];
  for (const [label, overrides, status = 409] of cases) await t.test(label, async () => {
    const f = await fixture();
    try { const before = state(f.sqlite); assert.equal((await edit(f, overrides)).status, status); assert.equal(state(f.sqlite), before); }
    finally { f.sqlite.close(); }
  });
  for (const mutation of ["UPDATE blower_history_events SET source_type = 'shift_log_auto' WHERE id = 'manual-replacement'",
    "UPDATE blower_history_assets SET last_replacement_at = '2026-08-20T15:00:00.000Z' WHERE tag_number = '104SDF01AN001'"]) {
    const f = await fixture();
    try { f.sqlite.exec(mutation); const before = state(f.sqlite); assert.equal((await edit(f)).status, 409); assert.equal(state(f.sqlite), before); }
    finally { f.sqlite.close(); }
  }
});

test("replaying the same saved request cannot create another correction or audit record", async () => {
  const f = await fixture();
  try {
    const request = body(f.sqlite, { operationMode: "stopped", startupAt: START, stoppedAt: STOP });
    assert.equal((await edit(f, {}, request)).status, 200);
    const saved = state(f.sqlite);
    assert.equal((await edit(f, {}, request)).status, 409);
    assert.equal(state(f.sqlite), saved);
  } finally { f.sqlite.close(); }
});

test("failed final guard rolls back asset, selected event, correction, audit and guards together", async () => {
  const f = await fixture();
  try {
    const before = state(f.sqlite);
    f.database.afterStatement = ({ index, sqlite }) => {
      if (index === 4) sqlite.prepare("UPDATE blower_history_events SET runtime_hours = 999 WHERE id = 'manual-replacement'").run();
    };
    assert.equal((await edit(f, { operationMode: "running", startupAt: START })).status, 409);
    assert.equal(state(f.sqlite), before);
  } finally { f.sqlite.close(); }
});

test("snapshot changes immediately before the batch fail its first guard without touching newer values", async () => {
  const f = await fixture();
  try {
    const originalBatch = f.database.batch;
    f.database.batch = async statements => {
      f.sqlite.prepare("UPDATE blower_history_assets SET cycle_runtime_revision = 'concurrent-revision' WHERE tag_number = ?").run(TAG);
      return originalBatch(statements);
    };
    const beforeEvent = event(f.sqlite);
    assert.equal((await edit(f, { operationMode: "running", startupAt: START })).status, 409);
    assert.equal(asset(f.sqlite).cycle_runtime_revision, "concurrent-revision");
    assert.deepEqual(event(f.sqlite), beforeEvent);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM blower_history_asset_history").get().n, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM blower_history_atomic_guard").get().n, 0);
  } finally { f.sqlite.close(); }
});

test("future boundary prevents a correction that would not supersede it", async () => {
  const f = await fixture();
  try {
    addEvent(f.sqlite, { id: "future-boundary", event_type: "operation_stop", event_date: "2026-09-08T15:01:00.000Z" });
    const before = state(f.sqlite);
    assert.equal((await edit(f, { operationMode: "stopped", startupAt: START, stoppedAt: STOP })).status, 409);
    assert.equal(state(f.sqlite), before);
  } finally { f.sqlite.close(); }
});

function storeProbeForCurrentCycle(sqlite) {
  const a = asset(sqlite);
  const startAt = "2026-09-01T00:00:00.000Z";
  const endAt = "2026-09-08T14:59:30.000Z";
  const probe = {
    schemaVersion: 1, requestType: "blower_runtime_probe", requestId: "probe-before-edit", ok: true, readOnly: true,
    assetTag: TAG, dataParcTag: "GSPOGE.ABB_DCS.TEST_CONFIRMED_ORGANIC_1A_RUN",
    startAt, endAt, observedAt: endAt, collectedAt: "2026-09-08T14:59:40.000Z",
    expectedLastReplacementAt: a.last_replacement_at, expectedCycleStartState: a.cycle_start_state,
    expectedCycleStartedAt: a.cycle_started_at || "", expectedCycleStartRevision: a.cycle_start_revision,
    expectedCycleRuntimeRevision: a.cycle_runtime_revision,
    startState: "stopped", endState: "running", totalRunningHours: 3.5, runningSeconds: 12600,
    chunkDays: 31, chunkCount: 1, completedChunkCount: 1,
    chunks: [{ index: 1, startAt, endAt, startState: "stopped", endState: "running", totalRunningHours: 3.5, runningSeconds: 12600 }]
  };
  sqlite.exec(`CREATE TABLE ois_data_requests (id TEXT PRIMARY KEY, request_type TEXT, status TEXT,
    target_date TEXT, requested_by_id TEXT, result_json TEXT, completed_at TEXT);
    CREATE TABLE blower_runtime_probe_intents_v3 (
      request_id TEXT PRIMARY KEY, schema_version INTEGER, asset_tag TEXT, dataparc_tag TEXT,
      window_start TEXT, window_end TEXT, chunk_days INTEGER, chunk_count INTEGER,
      expected_last_replacement_at TEXT, expected_cycle_start_state TEXT, expected_cycle_started_at TEXT,
      expected_cycle_start_revision TEXT, expected_cycle_runtime_revision TEXT);`);
  sqlite.prepare("INSERT INTO ois_data_requests VALUES (?, 'blower_runtime_probe', 'complete', ?, ?, ?, ?)")
    .run(probe.requestId, `v1|${TAG}|${startAt}|${endAt}`, OWNER.employeeNo, JSON.stringify(probe), probe.collectedAt);
  sqlite.prepare("INSERT INTO blower_runtime_probe_intents_v3 VALUES (?, 1, ?, ?, ?, ?, 31, 1, ?, ?, ?, ?, ?)")
    .run(probe.requestId, TAG, probe.dataParcTag, startAt, endAt, a.last_replacement_at,
      a.cycle_start_state, a.cycle_started_at || "", a.cycle_start_revision, a.cycle_runtime_revision);
  return probe;
}

test("a valid old-cycle probe conflicts after correction and an invalid pending-cycle probe remains rejected", async t => {
  for (const mode of ["running", "pending"]) await t.test(mode, async () => {
    const f = await fixture({ active: mode === "running" });
    try {
      const probe = storeProbeForCurrentCycle(f.sqlite);
      assert.equal((await edit(f, mode === "running"
        ? { operationMode: "stopped", startupAt: START, stoppedAt: STOP }
        : { eventDate: "2026-08-21T00:00:00+09:00" })).status, 200);
      const before = state(f.sqlite);
      const response = await api.applyDataParcRuntimeSync(f.database, OWNER, { requestId: probe.requestId }, { now: NOW });
      const result = await response.json();
      if (mode === "running") {
        assert.equal(response.status, 409, JSON.stringify(result));
        assert.equal(result.code, "DATAPARC_RUNTIME_CYCLE_CONFLICT");
      } else {
        // A pending cycle cannot create a valid probe in the first place.
        assert.ok([400, 409].includes(response.status));
        assert.ok(["DATAPARC_RUNTIME_CYCLE_CONFLICT", "DATAPARC_RUNTIME_CYCLE_PENDING", "DATAPARC_RUNTIME_PROBE_INVALID"].includes(result.code), JSON.stringify(result));
      }
      assert.equal(state(f.sqlite), before);
    } finally { f.sqlite.close(); }
  });
});

test("metadata-only replacement edit keeps a current DataPARC probe eligible and both histories intact", async () => {
  const f = await fixture({ active: true });
  try {
    const probe = storeProbeForCurrentCycle(f.sqlite);
    assert.equal((await edit(f)).status, 200);
    const response = await api.applyDataParcRuntimeSync(f.database, OWNER, { requestId: probe.requestId }, { now: NOW });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(asset(f.sqlite).cycle_runtime_hours, 3.5);
    assert.equal(event(f.sqlite).note, "정정한 내용");
    assert.ok(event(f.sqlite, "old-dataparc"));
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM blower_history_asset_history").get().n, 1);
  } finally { f.sqlite.close(); }
});
