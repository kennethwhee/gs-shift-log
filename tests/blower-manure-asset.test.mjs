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


const TAG = "204LMDF01AN001";

test("confirmed manure asset seeds once as unit 2 with unknown state and no invented replacement", async () => {
  const database = createD1TestDatabase();
  try {
    await api.ensureSchema(database);
    const sqlite = database.raw();
    let row = sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number = ?").get(TAG);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM blower_history_assets").get().n, 23);
    assert.equal(row.blower_type, "organic_fuel");
    assert.equal(row.asset_group, "manure");
    assert.equal(row.unit_no, "2");
    assert.equal(row.position_label, "#1");
    assert.equal(row.last_replacement_at, null);
    assert.equal(row.cycle_started_at, null);
    assert.equal(row.cycle_start_state, "pending");
    assert.equal(row.cycle_runtime_hours, 0);
    assert.equal(row.cycle_runtime_state, "unknown");
    assert.equal(row.runtime_anchor_at, null);
    assert.equal(row.cycle_runtime_anchor_at, null);
    const before = JSON.stringify(row);
    await api.ensureSchema(database);
    row = sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number = ?").get(TAG);
    assert.equal(JSON.stringify(row), before);
    const states = await api.loadAssetStates(database, {});
    const manure = states.find(asset => asset.tagNumber === TAG);
    assert.equal(manure.operationState, "unknown");
    assert.equal(manure.cycleElapsedHours, null);
    assert.equal(manure.severity, "uninitialized");
    assert.equal(manure.dataParcTag, "");
    assert.ok(!api.buildMissingTagSummary(states).some(item => item.groupKey === "manure"));
  } finally { database.close(); }
});

test("schema readiness adds the newly confirmed asset to an established 22-asset database without changing existing data", async () => {
  const database = createD1TestDatabase();
  try {
    await api.ensureSchema(database);
    await api.ensureBlowerHistorySchemaReady(database);
    const sqlite = database.raw();
    sqlite.prepare("DELETE FROM blower_history_assets WHERE tag_number = ?").run(TAG);
    sqlite.exec(`UPDATE blower_history_settings SET cycle_days = 123, updated_by_name = '기존 수정자' WHERE blower_type = 'organic_fuel';
      UPDATE blower_history_assets SET display_name = '기존 사용자 이름', cycle_runtime_hours = 55,
        cycle_runtime_state = 'stopped', last_replacement_at = '2026-08-01T00:00:00Z' WHERE tag_number = '204SDF01AN002';`);
    const existing = JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets ORDER BY tag_number").all());
    const settings = JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_settings ORDER BY blower_type").all());
    await api.ensureBlowerHistorySchemaReady(database);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM blower_history_assets").get().n, 23);
    assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number <> ? ORDER BY tag_number").all(TAG)), existing);
    assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_settings ORDER BY blower_type").all()), settings);
    const state = JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets ORDER BY tag_number").all());
    let writes = 0;
    database.afterStatement = () => writes++;
    await api.ensureBlowerHistorySchemaReady(database);
    assert.equal(writes, 0, "ready path must not execute any schema or seed writes");
    assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets ORDER BY tag_number").all()), state);
  } finally { database.close(); }
});

test("an existing manure asset and its operator-entered history are never overwritten by seeding", async () => {
  const database = createD1TestDatabase();
  try {
    await api.ensureSchema(database);
    const sqlite = database.raw();
    sqlite.prepare(`UPDATE blower_history_assets SET display_name = '현장 축분 설비', enabled = 0,
      last_replacement_at = '2026-08-01T00:00:00Z', cycle_start_state = 'started',
      cycle_started_at = '2026-08-02T00:00:00Z', cycle_runtime_hours = 44, cycle_runtime_state = 'running',
      cycle_start_revision = 'manual-start', cycle_runtime_revision = 'manual-runtime' WHERE tag_number = ?`).run(TAG);
    const before = JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number = ?").get(TAG));
    await api.ensureSchema(database);
    assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM blower_history_assets WHERE tag_number = ?").get(TAG)), before);
  } finally { database.close(); }
});

test("exact LMDF identity is recognized in replacement text and remains separate from the four organic blowers", () => {
  const definition = api.classifyRecognizedBlowerTag(TAG);
  assert.equal(definition.tagNumber, TAG);
  assert.equal(definition.blowerType, "organic_fuel");
  assert.equal(definition.assetGroup, "manure");
  assert.equal(definition.unitNo, "2");
  assert.deepEqual(api.extractRecognizedBlowerTags("204LMDF01AN001 축분 Blower V-Belt 교체 완료"), [TAG]);
  assert.deepEqual(api.extractRecognizedBlowerTags("204 LMDF01AN001 V-Belt 교체 완료"), [TAG]);
  assert.equal(api.classifyRecognizedBlowerTag("204LMDF01AN002"), null);
  assert.deepEqual(api.extractRecognizedBlowerTags("204SDF01AN001 유기성 Blower V-Belt 교체 완료"), ["204SDF01AN001"]);
});


test("replacement identity matching uses the exact manure TAG without assigning work to organic A or B", async () => {
  const database = createD1TestDatabase();
  try {
    await api.ensureSchema(database);
    const rows = database.raw().prepare("SELECT * FROM blower_history_assets").all();
    for (const text of ["204LMDF01AN001 축분 Blower V-Belt 교체 완료", "204LMDF01AN001 유기성 고형연료 Blower V-Belt 교체 완료"]) {
      assert.deepEqual(api.findAssetMatches(text, rows).map(match => match.asset.tag_number), [TAG]);
    }
    assert.deepEqual(api.findAssetMatches("204SDF01AN001 유기성 고형연료 Blower V-Belt 교체 완료", rows).map(match => match.asset.tag_number), ["204SDF01AN001"]);
    assert.deepEqual(api.findAssetMatches("104SDF01AN001 축분 Blower V-Belt 교체 완료", rows), []);
  } finally { database.close(); }
});
