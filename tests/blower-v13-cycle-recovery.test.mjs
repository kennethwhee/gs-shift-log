import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  __blowerHistoryTest
} from "../functions/api/blower-history.js";


const {
  ensureSchema,
  ensureHistoryRecoveryV12Schema,
  v12ApplyConfirmedEvents
} = __blowerHistoryTest;


function createD1TestDatabase() {
  const sqlite = new DatabaseSync(":memory:");

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


function isoHoursFromNow(hours) {
  return new Date(Date.now() + Number(hours) * 3600000).toISOString();
}


function equivalentKstDateTime(isoValue) {
  const date = new Date(isoValue);
  const shifted = new Date(date.getTime() + 9 * 3600000);
  return `${shifted.toISOString().slice(0, -1)}+09:00`;
}


function createLegacyArchiveTable(sqlite) {
  sqlite.exec(`
    CREATE TABLE blower_history_asset_archive_v12 (
      migration_id TEXT NOT NULL,
      tag_number TEXT NOT NULL,
      blower_type TEXT NOT NULL,
      unit_no TEXT NOT NULL,
      position_label TEXT NOT NULL,
      display_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_replacement_at TEXT,
      runtime_hours REAL NOT NULL DEFAULT 0,
      runtime_anchor_at TEXT,
      is_running INTEGER NOT NULL DEFAULT 0,
      last_modified_by_id TEXT NOT NULL DEFAULT '',
      last_modified_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      PRIMARY KEY (migration_id, tag_number)
    )
  `);
}


function setCycle(sqlite, values) {
  sqlite.prepare(`
    UPDATE blower_history_assets
    SET
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
      updated_at = ?
    WHERE tag_number = ?
  `).run(
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
    isoHoursFromNow(0),
    values.tagNumber
  );
}


function insertLegacyArchiveSnapshot(sqlite, values) {
  sqlite.prepare(`
    INSERT INTO blower_history_asset_archive_v12 (
      migration_id, tag_number, blower_type, unit_no, position_label,
      display_name, sort_order, enabled, last_replacement_at,
      runtime_hours, runtime_anchor_at, is_running,
      last_modified_by_id, last_modified_by_name,
      created_at, updated_at, archived_at
    )
    SELECT
      'blower_vbelt_confirmed_recovery_v12', tag_number, blower_type,
      unit_no, position_label, display_name, sort_order, enabled,
      last_replacement_at, runtime_hours, runtime_anchor_at, is_running,
      last_modified_by_id, last_modified_by_name,
      created_at, updated_at, ?
    FROM blower_history_assets
    WHERE tag_number = ?
  `).run(isoHoursFromNow(0), values.tagNumber);
}


function insertStage(sqlite, eventKey, tagNumber, eventDate) {
  const now = isoHoursFromNow(0);
  sqlite.prepare(`
    INSERT INTO blower_history_recovery_v12_stage (
      event_key, tag_number, event_date, source_table, source_row_id,
      source_log_id, source_role, source_author, source_text,
      decision_reason, support_count, created_at, updated_at
    ) VALUES (?, ?, ?, 'shift_logs', 1, 'log-1', 'BCO1', 'tester',
      'V-Belt 교체 완료', 'test', 1, ?, ?)
  `).run(eventKey, tagNumber, eventDate, now, now);
}


test(
  "V13 recovery migrates its archive and keeps Cycle runtime aligned with the recovered latest replacement",
  async () => {
    const database = createD1TestDatabase();
    const sqlite = database.raw();

    try {
      await ensureSchema(database);
      createLegacyArchiveTable(sqlite);

      const changedTag = "204HHL60AP631";
      const unchangedTag = "204HHL10AN631";
      const reinitializedTag = "204SDF01AN002";
      const changedOldReplacement = isoHoursFromNow(-24 * 20);
      const changedRecoveredReplacement = isoHoursFromNow(-24 * 10);
      const unchangedReplacement = isoHoursFromNow(-24 * 8);
      const changedOriginal = {
        tagNumber: changedTag,
        lastReplacementAt: changedOldReplacement,
        cycleStartedAt: isoHoursFromNow(-24 * 20 + 2),
        cycleStartState: "started",
        cycleStartRevision: "changed-start-old",
        cycleRuntimeHours: 80,
        cycleRuntimeAnchorAt: isoHoursFromNow(-24 * 9),
        cycleRuntimeState: "stopped",
        cycleRuntimeRevision: "changed-runtime-old",
        runtimeHours: 80,
        runtimeAnchorAt: null,
        isRunning: 0
      };
      const unchangedOriginal = {
        tagNumber: unchangedTag,
        lastReplacementAt: unchangedReplacement,
        cycleStartedAt: isoHoursFromNow(-24 * 8 + 3),
        cycleStartState: "started",
        cycleStartRevision: "unchanged-start-revision",
        cycleRuntimeHours: 42.5,
        cycleRuntimeAnchorAt: isoHoursFromNow(-30),
        cycleRuntimeState: "stopped",
        cycleRuntimeRevision: "unchanged-runtime-revision",
        runtimeHours: 42.5,
        runtimeAnchorAt: null,
        isRunning: 0
      };
      const reinitializedOriginal = {
        tagNumber: reinitializedTag,
        lastReplacementAt: isoHoursFromNow(-24 * 30),
        cycleStartedAt: isoHoursFromNow(-24 * 30 + 1),
        cycleStartState: "started",
        cycleStartRevision: "reinitialized-start-old",
        cycleRuntimeHours: 55,
        cycleRuntimeAnchorAt: isoHoursFromNow(-24 * 6),
        cycleRuntimeState: "stopped",
        cycleRuntimeRevision: "reinitialized-runtime-old",
        runtimeHours: 55,
        runtimeAnchorAt: null,
        isRunning: 0
      };
      const reinitializedReplacement = isoHoursFromNow(-24 * 5);

      setCycle(sqlite, changedOriginal);
      setCycle(sqlite, unchangedOriginal);
      setCycle(sqlite, reinitializedOriginal);
      insertLegacyArchiveSnapshot(sqlite, unchangedOriginal);

      await ensureHistoryRecoveryV12Schema(database);

      const archiveColumns = new Set(
        sqlite.prepare("PRAGMA table_info(blower_history_asset_archive_v12)")
          .all()
          .map(column => column.name)
      );

      for (const column of [
        "cycle_started_at",
        "cycle_start_state",
        "cycle_start_revision",
        "cycle_runtime_hours",
        "cycle_runtime_anchor_at",
        "cycle_runtime_state",
        "cycle_runtime_revision"
      ]) {
        assert.equal(archiveColumns.has(column), true, `archive is missing ${column}`);
      }

      sqlite.prepare(`
        INSERT INTO blower_history_events (
          id, tag_number, event_type, event_date, runtime_hours,
          issue_type, action_type, note, source_type, source_log_id,
          source_text, created_by_id, created_by_name, created_at, updated_at
        ) VALUES (
          'manual-stop', ?, 'runtime_correction', ?, 80,
          '', '정지', '', 'manual', '', '', 'tester', 'Tester', ?, ?
        )
      `).run(
        changedTag,
        isoHoursFromNow(-24 * 9),
        isoHoursFromNow(-24 * 9),
        isoHoursFromNow(-24 * 9)
      );

      sqlite.prepare(`
        INSERT INTO blower_history_events (
          id, tag_number, event_type, event_date, runtime_hours,
          issue_type, action_type, note, source_type, source_log_id,
          source_text, created_by_id, created_by_name, created_at, updated_at
        ) VALUES (
          'operation-stop', ?, 'operation_stop', ?, 55,
          '', '정지', '', 'manual', '', '', 'tester', 'Tester', ?, ?
        )
      `).run(
        reinitializedTag,
        isoHoursFromNow(-24 * 4),
        isoHoursFromNow(-24 * 4),
        isoHoursFromNow(-24 * 4)
      );

      insertStage(sqlite, "changed-event", changedTag, changedRecoveredReplacement);
      insertStage(
        sqlite,
        "unchanged-event",
        unchangedTag,
        equivalentKstDateTime(unchangedReplacement)
      );
      insertStage(
        sqlite,
        "reinitialized-event",
        reinitializedTag,
        reinitializedReplacement
      );

      const result = await v12ApplyConfirmedEvents(database);

      assert.equal(result.ok, true);
      assert.equal(result.applied, true);

      const archiveRows = sqlite.prepare(`
        SELECT *
        FROM blower_history_asset_archive_v12
        WHERE tag_number IN (?, ?, ?)
        ORDER BY tag_number
      `).all(changedTag, unchangedTag, reinitializedTag);
      assert.equal(archiveRows.length, 3);

      const changedArchive = archiveRows.find(row => row.tag_number === changedTag);
      assert.equal(changedArchive.cycle_started_at, changedOriginal.cycleStartedAt);
      assert.equal(changedArchive.cycle_start_state, changedOriginal.cycleStartState);
      assert.equal(changedArchive.cycle_start_revision, changedOriginal.cycleStartRevision);
      assert.equal(changedArchive.cycle_runtime_hours, changedOriginal.cycleRuntimeHours);
      assert.equal(changedArchive.cycle_runtime_anchor_at, changedOriginal.cycleRuntimeAnchorAt);
      assert.equal(changedArchive.cycle_runtime_state, changedOriginal.cycleRuntimeState);
      assert.equal(changedArchive.cycle_runtime_revision, changedOriginal.cycleRuntimeRevision);

      const changed = sqlite.prepare(`
        SELECT * FROM blower_history_assets WHERE tag_number = ?
      `).get(changedTag);
      assert.equal(changed.last_replacement_at, changedRecoveredReplacement);
      assert.equal(changed.cycle_started_at, null);
      assert.equal(changed.cycle_start_state, "legacy");
      assert.notEqual(changed.cycle_start_revision, changedOriginal.cycleStartRevision);
      assert.match(changed.cycle_start_revision, /^[a-f0-9]{32}$/);
      assert.equal(changed.cycle_runtime_state, "stopped");
      assert.equal(changed.cycle_runtime_hours, changedOriginal.cycleRuntimeHours);
      assert.equal(changed.cycle_runtime_anchor_at, changedOriginal.cycleRuntimeAnchorAt);
      assert.notEqual(changed.cycle_runtime_revision, changedOriginal.cycleRuntimeRevision);
      assert.match(changed.cycle_runtime_revision, /^[a-f0-9]{32}$/);

      const unchanged = sqlite.prepare(`
        SELECT * FROM blower_history_assets WHERE tag_number = ?
      `).get(unchangedTag);
      assert.equal(
        Date.parse(unchanged.last_replacement_at),
        Date.parse(unchangedOriginal.lastReplacementAt)
      );
      assert.equal(unchanged.cycle_started_at, unchangedOriginal.cycleStartedAt);
      assert.equal(unchanged.cycle_start_state, unchangedOriginal.cycleStartState);
      assert.equal(unchanged.cycle_start_revision, unchangedOriginal.cycleStartRevision);
      assert.equal(unchanged.cycle_runtime_hours, unchangedOriginal.cycleRuntimeHours);
      assert.equal(unchanged.cycle_runtime_anchor_at, unchangedOriginal.cycleRuntimeAnchorAt);
      assert.equal(unchanged.cycle_runtime_state, unchangedOriginal.cycleRuntimeState);
      assert.equal(unchanged.cycle_runtime_revision, unchangedOriginal.cycleRuntimeRevision);

      const reinitialized = sqlite.prepare(`
        SELECT * FROM blower_history_assets WHERE tag_number = ?
      `).get(reinitializedTag);
      assert.equal(reinitialized.last_replacement_at, reinitializedReplacement);
      assert.equal(reinitialized.cycle_started_at, null);
      assert.equal(reinitialized.cycle_start_state, "legacy");
      assert.notEqual(
        reinitialized.cycle_start_revision,
        reinitializedOriginal.cycleStartRevision
      );
      assert.equal(reinitialized.cycle_runtime_state, "stopped");
      assert.notEqual(
        reinitialized.cycle_runtime_revision,
        reinitializedOriginal.cycleRuntimeRevision
      );
      assert.equal(reinitialized.cycle_runtime_hours, 0);
      assert.equal(
        Date.parse(reinitialized.cycle_runtime_anchor_at),
        Date.parse(reinitializedReplacement)
      );
    } finally {
      database.close();
    }
  }
);
