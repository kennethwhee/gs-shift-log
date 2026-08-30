import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";


const apiUrl = new URL("../functions/api/blower-history.js", import.meta.url);
const apiSource = await readFile(apiUrl, "utf8");

assert.match(
  apiSource,
  /async function editLatestRuntimeBoundary\s*\(/,
  "the current Blower API must contain the V9.2 runtime-history editor"
);

// Load the current production source verbatim and expose only a test hook in the
// generated module. The production API file itself is deliberately not changed.
const instrumentedSource = `${apiSource}

export const __runtimeHistoryEditInstrumentation = {
  ensureSchema,
  editLatestRuntimeBoundary
};
`;
const instrumentedApi = await import(
  `data:text/javascript;base64,${Buffer.from(instrumentedSource).toString("base64")}`
);
const {
  ensureSchema,
  editLatestRuntimeBoundary
} = instrumentedApi.__runtimeHistoryEditInstrumentation;


const TAG_NUMBER = "204HHL60AP631";
const USER = Object.freeze({
  employeeNo: "runtime-edit-test",
  name: "Runtime Edit Tester"
});
const REPLACEMENT_AT = "2020-01-01T00:00:00.000Z";
const START_AT = "2020-01-02T00:00:00.000Z";
const STOP_AT = "2020-01-02T10:00:00.000Z";
const EDITED_STOP_AT = "2020-01-02T12:30:00.000Z";


function createD1TestDatabase() {
  const sqlite = new DatabaseSync(":memory:");

  return {
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
}


function configureAsset(sqlite, overrides = {}) {
  const values = {
    lastReplacementAt: REPLACEMENT_AT,
    cycleStartedAt: START_AT,
    cycleStartState: "started",
    cycleStartRevision: "start-revision-1",
    cycleRuntimeHours: 10,
    cycleRuntimeAnchorAt: STOP_AT,
    cycleRuntimeState: "stopped",
    cycleRuntimeRevision: "runtime-revision-1",
    runtimeHours: 10,
    runtimeAnchorAt: null,
    isRunning: 0,
    ...overrides
  };

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
      last_modified_by_id = '',
      last_modified_by_name = '',
      updated_at = '2020-01-03T00:00:00.000Z'
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
    TAG_NUMBER
  );

  return values;
}


function insertEvent(sqlite, overrides = {}) {
  const event = {
    id: "stop-event",
    eventType: "operation_stop",
    eventDate: STOP_AT,
    runtimeHours: 10,
    actionType: "정지",
    note: "original note",
    sourceType: "manual",
    createdAt: "2020-01-02T10:00:01.000Z",
    updatedAt: "2020-01-02T10:00:01.000Z",
    ...overrides
  };

  sqlite.prepare(`
    INSERT INTO blower_history_events (
      id, tag_number, event_type, event_date, runtime_hours,
      issue_type, action_type, note, source_type,
      source_log_id, source_text,
      created_by_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, '', '', 'fixture', 'Fixture', ?, ?)
  `).run(
    event.id,
    TAG_NUMBER,
    event.eventType,
    event.eventDate,
    event.runtimeHours,
    event.actionType,
    event.note,
    event.sourceType,
    event.createdAt,
    event.updatedAt
  );

  return event;
}


async function createFixture({ asset = {}, events = [] } = {}) {
  const database = createD1TestDatabase();
  await ensureSchema(database);
  const sqlite = database.raw();

  sqlite.prepare("DELETE FROM blower_history_events WHERE tag_number = ?").run(TAG_NUMBER);
  sqlite.prepare("DELETE FROM blower_history_asset_history WHERE tag_number = ?").run(TAG_NUMBER);
  sqlite.exec("DELETE FROM blower_history_atomic_guard");
  const assetValues = configureAsset(sqlite, asset);
  const eventValues = events.map(event => insertEvent(sqlite, event));

  return { database, sqlite, asset: assetValues, events: eventValues };
}


function editBody(asset, event, overrides = {}) {
  return {
    tagNumber: TAG_NUMBER,
    eventId: event.id,
    expectedEventUpdatedAt: event.updatedAt,
    expectedCycleRuntimeRevision: asset.cycleRuntimeRevision,
    expectedLastReplacementAt: asset.lastReplacementAt,
    eventDate: EDITED_STOP_AT,
    note: "corrected stop",
    changeNote: "V9.2 regression",
    ...overrides
  };
}


async function invokeEdit(database, body) {
  const response = await editLatestRuntimeBoundary(database, USER, body);
  return {
    status: response.status,
    body: await response.json()
  };
}


function readState(sqlite) {
  return {
    asset: sqlite.prepare(`
      SELECT
        tag_number, last_replacement_at, cycle_started_at,
        cycle_start_state, cycle_start_revision,
        cycle_runtime_hours, cycle_runtime_anchor_at,
        cycle_runtime_state, cycle_runtime_revision,
        runtime_hours, runtime_anchor_at, is_running,
        last_modified_by_id, last_modified_by_name, updated_at
      FROM blower_history_assets
      WHERE tag_number = ?
    `).get(TAG_NUMBER),
    events: sqlite.prepare(`
      SELECT *
      FROM blower_history_events
      WHERE tag_number = ?
      ORDER BY event_date, created_at, id
    `).all(TAG_NUMBER),
    audit: sqlite.prepare(`
      SELECT *
      FROM blower_history_asset_history
      WHERE tag_number = ?
      ORDER BY changed_at, id
    `).all(TAG_NUMBER),
    guards: sqlite.prepare(`
      SELECT *
      FROM blower_history_atomic_guard
      ORDER BY id
    `).all()
  };
}


function assertRejectedWithoutWrites(before, after, result) {
  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.deepEqual(after, before, "a rejected edit must not leave partial writes");
}


test(
  "V9.2 edits the latest manual stop and aligns recomputed runtime with its audit record",
  async () => {
    const fixture = await createFixture({
      events: [
        {
          id: "start-event",
          eventType: "operation_start",
          eventDate: START_AT,
          runtimeHours: 0,
          actionType: "기동",
          note: "cycle start",
          createdAt: "2020-01-02T00:00:01.000Z",
          updatedAt: "2020-01-02T00:00:01.000Z"
        },
        { id: "stop-event" }
      ]
    });

    try {
      const selected = fixture.events[1];
      const result = await invokeEdit(
        fixture.database,
        editBody(fixture.asset, selected)
      );

      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
      assert.match(result.body.message, /12\.5시간/);

      const state = readState(fixture.sqlite);
      const liveEvent = state.events.find(event => event.id === selected.id);
      const audit = state.audit.at(-1);
      const beforeAudit = JSON.parse(audit.before_json);
      const afterAudit = JSON.parse(audit.after_json);

      assert.equal(state.asset.cycle_runtime_hours, 12.5);
      assert.equal(state.asset.runtime_hours, 12.5);
      assert.equal(state.asset.cycle_runtime_anchor_at, EDITED_STOP_AT);
      assert.equal(state.asset.cycle_runtime_state, "stopped");
      assert.equal(state.asset.runtime_anchor_at, null);
      assert.equal(state.asset.is_running, 0);
      assert.notEqual(state.asset.cycle_runtime_revision, fixture.asset.cycleRuntimeRevision);
      assert.equal(state.asset.last_modified_by_id, USER.employeeNo);
      assert.equal(state.asset.last_modified_by_name, USER.name);

      assert.equal(liveEvent.event_date, EDITED_STOP_AT);
      assert.equal(liveEvent.runtime_hours, 12.5);
      assert.equal(liveEvent.note, "corrected stop");
      assert.equal(liveEvent.updated_at, state.asset.updated_at);

      assert.equal(audit.action_type, "runtime_event_edit");
      assert.equal(audit.change_note, "V9.2 regression");
      assert.equal(audit.changed_at, liveEvent.updated_at);
      assert.deepEqual(
        {
          eventDate: beforeAudit.eventDate,
          eventHours: beforeAudit.runtimeHours,
          cycleHours: beforeAudit.cycleRuntimeHours,
          cycleAnchor: beforeAudit.cycleRuntimeAnchorAt
        },
        {
          eventDate: STOP_AT,
          eventHours: 10,
          cycleHours: 10,
          cycleAnchor: STOP_AT
        }
      );
      assert.deepEqual(
        {
          eventDate: afterAudit.eventDate,
          eventHours: afterAudit.runtimeHours,
          cycleHours: afterAudit.cycleRuntimeHours,
          cycleAnchor: afterAudit.cycleRuntimeAnchorAt,
          cycleState: afterAudit.cycleRuntimeState
        },
        {
          eventDate: liveEvent.event_date,
          eventHours: liveEvent.runtime_hours,
          cycleHours: state.asset.cycle_runtime_hours,
          cycleAnchor: state.asset.cycle_runtime_anchor_at,
          cycleState: state.asset.cycle_runtime_state
        }
      );
      assert.deepEqual(state.guards, []);
    } finally {
      fixture.database.close();
    }
  }
);


test(
  "V9.2 restores a first legacy stop to startup-pending with zero runtime",
  async () => {
    const firstStopAt = "2020-01-01T05:00:00.000Z";
    const fixture = await createFixture({
      asset: {
        cycleStartedAt: null,
        cycleStartState: "legacy",
        cycleStartRevision: "legacy-start-revision",
        cycleRuntimeHours: 5,
        cycleRuntimeAnchorAt: firstStopAt,
        cycleRuntimeState: "stopped",
        cycleRuntimeRevision: "legacy-runtime-revision",
        runtimeHours: 5
      },
      events: [
        {
          id: "first-legacy-stop",
          eventDate: firstStopAt,
          runtimeHours: 5,
          createdAt: "2020-01-01T05:00:01.000Z",
          updatedAt: "2020-01-01T05:00:01.000Z"
        }
      ]
    });

    try {
      const selected = fixture.events[0];
      const result = await invokeEdit(
        fixture.database,
        editBody(fixture.asset, selected, {
          resetToStartupPending: true,
          eventDate: "2030-01-01T00:00:00.000Z",
          note: "replacement-time stop"
        })
      );

      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
      assert.match(result.body.message, /기동 대기·누적 0시간/);

      const state = readState(fixture.sqlite);
      const liveEvent = state.events[0];
      const audit = state.audit[0];
      const afterAudit = JSON.parse(audit.after_json);

      assert.equal(state.asset.cycle_started_at, null);
      assert.equal(state.asset.cycle_start_state, "pending");
      assert.notEqual(state.asset.cycle_start_revision, fixture.asset.cycleStartRevision);
      assert.equal(state.asset.cycle_runtime_hours, 0);
      assert.equal(state.asset.runtime_hours, 0);
      assert.equal(state.asset.cycle_runtime_anchor_at, REPLACEMENT_AT);
      assert.equal(state.asset.cycle_runtime_state, "stopped");
      assert.equal(state.asset.runtime_anchor_at, null);
      assert.equal(state.asset.is_running, 0);

      assert.equal(liveEvent.event_date, REPLACEMENT_AT);
      assert.equal(liveEvent.runtime_hours, 0);
      assert.equal(liveEvent.action_type, "교체 당시 정지");
      assert.equal(liveEvent.note, "replacement-time stop");
      assert.equal(afterAudit.cycleStartState, "pending");
      assert.equal(afterAudit.runtimeHours, 0);
      assert.equal(afterAudit.cycleRuntimeHours, 0);
      assert.equal(afterAudit.eventDate, REPLACEMENT_AT);
      assert.deepEqual(state.guards, []);
    } finally {
      fixture.database.close();
    }
  }
);


test(
  "V9.2 rejects stale event or Cycle revisions without partial writes",
  async t => {
    for (const scenario of [
      {
        name: "stale expectedEventUpdatedAt",
        override: { expectedEventUpdatedAt: "2019-12-31T23:59:59.000Z" }
      },
      {
        name: "stale expectedCycleRuntimeRevision",
        override: { expectedCycleRuntimeRevision: "stale-runtime-revision" }
      }
    ]) {
      await t.test(scenario.name, async () => {
        const fixture = await createFixture({ events: [{ id: "stop-event" }] });

        try {
          const selected = fixture.events[0];
          const before = readState(fixture.sqlite);
          const result = await invokeEdit(
            fixture.database,
            editBody(fixture.asset, selected, scenario.override)
          );
          const after = readState(fixture.sqlite);

          assertRejectedWithoutWrites(before, after, result);
        } finally {
          fixture.database.close();
        }
      });
    }
  }
);


test(
  "V9.2 rejects older, automatic, and non-runtime events without writes",
  async t => {
    const scenarios = [
      {
        name: "older manual boundary when a later boundary exists",
        events: [
          {
            id: "older-start",
            eventType: "operation_start",
            eventDate: START_AT,
            runtimeHours: 0,
            actionType: "기동",
            createdAt: "2020-01-02T00:00:01.000Z",
            updatedAt: "2020-01-02T00:00:01.000Z"
          },
          { id: "latest-stop" }
        ],
        selectedIndex: 0
      },
      {
        name: "automatically sourced latest boundary",
        events: [{ id: "automatic-stop", sourceType: "shift_log" }],
        selectedIndex: 0
      },
      {
        name: "manual non-runtime event",
        events: [{ id: "problem-event", eventType: "problem", actionType: "확인" }],
        selectedIndex: 0
      }
    ];

    for (const scenario of scenarios) {
      await t.test(scenario.name, async () => {
        const fixture = await createFixture({ events: scenario.events });

        try {
          const selected = fixture.events[scenario.selectedIndex];
          const before = readState(fixture.sqlite);
          const result = await invokeEdit(
            fixture.database,
            editBody(fixture.asset, selected)
          );
          const after = readState(fixture.sqlite);

          assertRejectedWithoutWrites(before, after, result);
        } finally {
          fixture.database.close();
        }
      });
    }
  }
);
