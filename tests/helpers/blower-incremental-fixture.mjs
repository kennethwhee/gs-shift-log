import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import { onRequestGet, onRequestPost } from "../../functions/api/ois-data-requests.js";
import { onRequestPost as historyPost, __blowerHistoryTest as history } from "../../functions/api/blower-history.js";

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

const source = await readFile(new URL("../../local-tools/ois-agent/ois-login.js", import.meta.url), "utf8");
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


export { fixture, browserCreate, agentClaim, agentComplete, callApi, agent, addBrowserIdentity, BROWSER_TOKEN, BROWSER_EMPLOYEE_NO, history, historyPost };
