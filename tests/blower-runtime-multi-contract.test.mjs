import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import { onRequestGet, onRequestPost } from "../functions/api/ois-data-requests.js";
import { onRequestPost as historyPost, __blowerHistoryTest as history } from "../functions/api/blower-history.js";

const BROWSER_TOKEN = "multi-contract-browser-token";
const BROWSER_EMPLOYEE_NO = "multi-contract-owner";
const AGENT_KEY = "multi-contract-agent-secret";
const AGENT_ID = "multi-contract-agent";
const floorToSecond = milliseconds => Math.floor(milliseconds / 1000) * 1000;

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

const source = await readFile(new URL("../local-tools/ois-agent/ois-login.js", import.meta.url), "utf8");
const declarationsStart = source.indexOf("const BLOWER_RUNTIME_PROBE_REQUEST_TYPE =");
const declarationsEnd = source.indexOf("/*", declarationsStart);
const parserStart = source.indexOf("function parseBlowerRuntimeProbeTimestamp(");
const parserEnd = source.indexOf("async function collectBlowerRuntimeProbeValues(", parserStart);
assert.ok(declarationsStart >= 0 && declarationsEnd > declarationsStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart);
const agent = vm.createContext({ Array, Date, Error, Math, Number, Set, String });
vm.runInContext(`
  ${source.slice(declarationsStart, declarationsEnd)}
  ${source.slice(parserStart, parserEnd)}
  this.parseClaim = parseBlowerRuntimeProbeRequest;
  this.normalizeResult = normalizeBlowerRuntimeProbeResult;
`, agent);


async function fixture(assetTag, legacy) {
  const database = createD1TestDatabase();
  await history.ensureSchema(database);
  await history.ensureBlowerHistorySchemaReady(database);
  const sqlite = database.raw();
  const clock = floorToSecond(Date.now());
  const replacementAt = new Date(clock - 3 * 86400000).toISOString();
  const startAt = new Date(clock - 2 * 86400000).toISOString();
  sqlite.exec(`CREATE TABLE users (employee_no TEXT PRIMARY KEY, name TEXT, role TEXT, is_active INTEGER);
    CREATE TABLE shift_log_sessions (token_hash TEXT PRIMARY KEY, employee_no TEXT, expires_at TEXT, last_used_at TEXT);
    CREATE TABLE ois_data_requests (
      id TEXT PRIMARY KEY NOT NULL, request_type TEXT NOT NULL, target_date TEXT NOT NULL,
      status TEXT NOT NULL, requested_by_id TEXT NOT NULL, requested_by_name TEXT NOT NULL,
      requested_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, agent_id TEXT NOT NULL DEFAULT '',
      result_json TEXT, error_message TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  addBrowserIdentity(sqlite, { token: BROWSER_TOKEN, employeeNo: BROWSER_EMPLOYEE_NO, name: "통합 검사 사용자", clock });
  sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at = ?, cycle_start_state = ?,
    cycle_started_at = ?, cycle_start_revision = ?, cycle_runtime_revision = 'contract-runtime-r1',
    cycle_runtime_hours = 77, cycle_runtime_state = 'running', runtime_hours = 77, is_running = 1 WHERE tag_number = ?`)
    .run(replacementAt, legacy ? "legacy" : "started", legacy ? null : startAt, legacy ? "" : "contract-start-r1", assetTag);
  return { database, sqlite, startAt, replacementAt };
}

// Only the Excel/DataPARC numeric bridge is simulated. Queue creation, claim,
// Agent parsing/normalization, completion API and history POST use product code.
for (const scenario of [
  { label: "non-pilot Bag Filter 1A explicitly confirmed RUN=0", tag: "104ETG30AN601", source: "GSPOGE.ABB_DCS.TEST_ONLY_FIELD_CONFIRMED_RUN", legacy: false, runningSeconds: 0 },
  { label: "legacy Silo B keeps the proven source without requesting TAG input", tag: "104ETH03AN602", source: "GSPOGE.ABB_DCS.003ETH03AN602XB04", legacy: true, runningSeconds: 3601 }
]) {
  test(`actual queue → Agent → completion → history contract: ${scenario.label}`, async () => {
    const { database, sqlite, startAt, replacementAt } = await fixture(scenario.tag, scenario.legacy);
    try {
      const create = await browserCreate(database, {
        action: "create_blower_runtime_probe", startAt,
        ...(scenario.legacy ? {} : { assetTag: scenario.tag, dataParcTag: scenario.source, confirmRunSignal: true })
      });
      assert.equal(create.status, 201, JSON.stringify(create.body));
      assert.equal(create.body.item.probe.assetTag, scenario.tag);
      assert.equal(create.body.item.probe.dataParcTag, scenario.source);
      const claimed = await agentClaim(database);
      assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
      const item = claimed.body.items.excel;
      assert.equal(item.id, create.body.item.id);
      assert.deepEqual(item.probe, create.body.item.probe);
      const expected = agent.parseClaim(item);
      assert.equal(expected.assetTag, scenario.tag);
      assert.equal(expected.dataParcTag, scenario.source);
      assert.equal(expected.expectedCycleStartState, scenario.legacy ? "legacy" : "started");
      const runState = scenario.runningSeconds > 0 ? "running" : "stopped";
      const totalRunningHours = Math.round(scenario.runningSeconds / 3600 * 1e6) / 1e6;
      const collectedAt = new Date().toISOString();
      const captured = {
        ...item.probe, ok: true, observedAt: item.probe.endAt,
        collectedAt: collectedAt.replace("Z", "1234Z"),
        completedChunkCount: 1, startState: runState, endState: runState,
        runningSeconds: scenario.runningSeconds, totalRunningHours,
        chunks: [{ index: 1, startAt: item.probe.startAt, endAt: item.probe.endAt,
          startState: runState, endState: runState, runningSeconds: scenario.runningSeconds, totalRunningHours }]
      };
      const normalized = agent.normalizeResult(captured, expected);
      assert.equal(normalized.collectedAt, collectedAt, "PowerShell seven-digit timestamp becomes canonical milliseconds");
      const beforeComplete = JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets ORDER BY tag_number").all());
      const complete = await agentComplete(database, item.id, normalized);
      assert.equal(complete.status, 200, JSON.stringify(complete.body));
      assert.equal(complete.body.item.status, "complete");
      assert.equal(complete.body.item.result.assetTag, scenario.tag);
      assert.equal(complete.body.item.result.dataParcTag, scenario.source);
      assert.equal(complete.body.item.result.isRunning, runState === "running");
      assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets ORDER BY tag_number").all()), beforeComplete);
      const beforeOtherAssets = JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number <> ? ORDER BY tag_number").all(scenario.tag));
      const sync = async () => callApi(historyPost, database, new Request("https://example.test/api/blower-history", {
        method: "POST", headers: { Authorization: `Bearer ${BROWSER_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dataparc_runtime_sync", requestId: item.id })
      }));
      const saved = await sync();
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.equal(saved.body.assetTag, scenario.tag);
      assert.equal(saved.body.dataParcTag, scenario.source);
      assert.equal(saved.body.runtimeHours, scenario.runningSeconds / 3600);
      assert.equal(saved.body.isRunning, runState === "running");
      const row = sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number = ?").get(scenario.tag);
      assert.equal(row.cycle_runtime_hours, scenario.runningSeconds / 3600);
      assert.equal(row.cycle_runtime_state, runState);
      assert.equal(row.last_replacement_at, replacementAt);
      assert.equal(row.cycle_start_state, scenario.legacy ? "legacy" : "started");
      assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number <> ? ORDER BY tag_number").all(scenario.tag)), beforeOtherAssets);
      const events = sqlite.prepare("SELECT * FROM blower_history_events WHERE source_log_id = ?").all(item.id);
      assert.equal(events.length, 1);
      assert.equal(events[0].tag_number, scenario.tag);
      assert.equal(JSON.parse(events[0].source_text).dataParcTag, scenario.source);
      assert.equal((await sync()).body.replayed, true);
      assert.deepEqual(sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number = ?").get(scenario.tag), row);
      assert.deepEqual(sqlite.prepare("SELECT * FROM blower_history_events WHERE source_log_id = ?").all(item.id), events);
    } finally { database.close(); }
  });
}
