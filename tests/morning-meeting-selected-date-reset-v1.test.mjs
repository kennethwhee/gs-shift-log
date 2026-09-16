import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

import {
  onRequestGet,
  onRequestPost,
  __oisDataRequestsTest
} from "../functions/api/ois-data-requests.js";


const apiSource =
  readFileSync(
    new URL(
      "../functions/api/ois-data-requests.js",
      import.meta.url
    ),
    "utf8"
  ).replace(
    /\r\n?/g,
    "\n"
  );


const scriptSource =
  readFileSync(
    new URL(
      "../script.js",
      import.meta.url
    ),
    "utf8"
  ).replace(
    /\r\n?/g,
    "\n"
  );


const querySource =
  readFileSync(
    new URL(
      "../maintenance/morning-meeting-query-sources.js",
      import.meta.url
    ),
    "utf8"
  ).replace(
    /\r\n?/g,
    "\n"
  );


const queryStyleSource =
  readFileSync(
    new URL(
      "../maintenance/morning-meeting-query-sources.css",
      import.meta.url
    ),
    "utf8"
  );


const indexSource =
  readFileSync(
    new URL(
      "../index.html",
      import.meta.url
    ),
    "utf8"
  );


const AUTH_TOKEN =
  "morning-meeting-selected-date-reset-test-token";


const TARGET_DATE =
  "2026-09-15";


const OTHER_DATE =
  "2026-09-14";


const PUBLIC_RESET_KEYS = [
  "active",
  "resetAt",
  "resetById",
  "resetByName",
  "restoredAt",
  "revision",
  "targetDate"
];


const ORIGINAL_OVERRIDE_VALUES = {
  waterRawWaterInflow:
    7888,
  limestoneUnitOneUsage:
    35.7,
  smpMinimum:
    90.09,
  powerSolar:
    538.7,
  organicTruckCount:
    4,
  futureMetadata: {
    source:
      "legacy"
  }
};


function plain(value) {
  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}


function assertPublicResetItem(
  item,
  {
    active,
    revision,
    resetById =
      "operator-1",
    resetByName =
      "시험 사용자"
  }
) {
  assert.deepEqual(
    Object.keys(
      item
    ).sort(),
    [
      ...PUBLIC_RESET_KEYS
    ].sort(),
    "reset snapshots and internal columns must never be exposed"
  );

  assert.equal(
    item.targetDate,
    TARGET_DATE
  );

  assert.equal(
    item.active,
    active
  );

  assert.equal(
    item.revision,
    revision
  );

  assert.equal(
    typeof item.resetAt,
    "string"
  );

  assert.equal(
    item.resetById,
    resetById
  );

  assert.equal(
    item.resetByName,
    resetByName
  );
}


function createD1Database() {
  const sqlite =
    new DatabaseSync(
      ":memory:"
    );

  let beforeResetUpdate =
    null;

  function createStatement(
    sql
  ) {
    return {
      sql,
      values: [],

      bind(...values) {
        this.values =
          values;

        return this;
      },

      async first() {
        return sqlite
          .prepare(
            sql
          )
          .get(
            ...this.values
          ) ||
          null;
      },

      async all() {
        return {
          results:
            sqlite
              .prepare(
                sql
              )
              .all(
                ...this.values
              )
        };
      },

      async run() {
        if (
          beforeResetUpdate &&
          /UPDATE\s+morning_meeting_auto_history_overrides/i.test(
            sql
          ) &&
          /reset_(?:active|snapshot_values_json)/i.test(
            sql
          )
        ) {
          const callback =
            beforeResetUpdate;

          beforeResetUpdate =
            null;

          await callback(
            sqlite
          );
        }

        const result =
          sqlite
            .prepare(
              sql
            )
            .run(
              ...this.values
            );

        return {
          meta: {
            changes:
              Number(
                result.changes
              )
          }
        };
      }
    };
  }

  const database = {
    prepare(
      sql
    ) {
      return createStatement(
        sql
      );
    },

    async batch(
      statements
    ) {
      const results = [];

      for (
        const statement of statements
      ) {
        results.push(
          await statement.run()
        );
      }

      return results;
    }
  };

  return {
    sqlite,
    database,

    setBeforeResetUpdate(
      callback
    ) {
      beforeResetUpdate =
        callback;
    }
  };
}


async function createApiFixture({
  targetValues =
    ORIGINAL_OVERRIDE_VALUES,
  targetRevision =
    7,
  includeTargetOverride =
    true
} = {}) {
  const fixture =
    createD1Database();

  fixture.sqlite.exec(`
    CREATE TABLE users (
      employee_no TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );

    CREATE TABLE shift_log_sessions (
      token_hash TEXT PRIMARY KEY,
      employee_no TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );

    CREATE TABLE ois_data_requests (
      id TEXT PRIMARY KEY,
      request_type TEXT NOT NULL,
      target_date TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by_id TEXT NOT NULL DEFAULT '',
      requested_by_name TEXT NOT NULL DEFAULT '',
      requested_at TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      agent_id TEXT,
      result_json TEXT,
      error_message TEXT,
      expires_at TEXT,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE limestone_usage_records (
      usage_date TEXT NOT NULL,
      unit_no INTEGER NOT NULL,
      usage_amount REAL,
      PRIMARY KEY (usage_date, unit_no)
    );

    CREATE TABLE morning_meeting_weather_forecasts (
      forecast_date TEXT NOT NULL,
      forecast_hour TEXT NOT NULL,
      location_code TEXT NOT NULL,
      condition_text TEXT,
      PRIMARY KEY (
        forecast_date,
        forecast_hour,
        location_code
      )
    );
  `);

  fixture.sqlite
    .prepare(
      "INSERT INTO users VALUES (?, ?, ?, ?)"
    )
    .run(
      "operator-1",
      "시험 사용자",
      "user",
      1
    );

  fixture.sqlite
    .prepare(
      "INSERT INTO shift_log_sessions VALUES (?, ?, ?, ?)"
    )
    .run(
      createHash(
        "sha256"
      )
        .update(
          AUTH_TOKEN
        )
        .digest(
          "hex"
        ),
      "operator-1",
      "2099-01-01T00:00:00.000Z",
      "2026-09-15T00:00:00.000Z"
    );

  await __oisDataRequestsTest
    .ensureMorningMeetingAutoHistoryOverridesTable(
      fixture.database
    );

  const insertOverride = (
    targetDate,
    values,
    revision
  ) => {
    fixture.sqlite
      .prepare(`
        INSERT INTO morning_meeting_auto_history_overrides (
          target_date,
          values_json,
          created_by_id,
          created_by_name,
          created_at,
          updated_by_id,
          updated_by_name,
          updated_at,
          revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        targetDate,
        JSON.stringify(
          values
        ),
        "operator-1",
        "시험 사용자",
        "2026-09-14T00:00:00.000Z",
        "operator-1",
        "시험 사용자",
        "2026-09-14T00:00:00.000Z",
        revision
      );
  };

  if (
    includeTargetOverride
  ) {
    insertOverride(
      TARGET_DATE,
      targetValues,
      targetRevision
    );
  }

  insertOverride(
    OTHER_DATE,
    {
      waterRawWaterInflow:
        6818
    },
    3
  );

  fixture.sqlite
    .prepare(
      "INSERT INTO limestone_usage_records VALUES (?, ?, ?)"
    )
    .run(
      TARGET_DATE,
      1,
      35.7
    );

  fixture.sqlite
    .prepare(
      "INSERT INTO morning_meeting_weather_forecasts VALUES (?, ?, ?, ?)"
    )
    .run(
      "2026-09-16",
      "09:00",
      "pocheon-sinbuk",
      "맑음"
    );

  return fixture;
}


function insertRequest(
  sqlite,
  {
    id,
    requestType,
    targetDate =
      TARGET_DATE,
    status =
      "complete",
    requestedAt =
      "2026-09-15T00:00:00.000Z",
    completedAt =
      "2026-09-15T00:01:00.000Z",
    updatedAt =
      completedAt,
    expiresAt =
      "2099-01-01T00:00:00.000Z",
    result = {
      value:
        1
    }
  }
) {
  sqlite
    .prepare(`
      INSERT INTO ois_data_requests (
        id,
        request_type,
        target_date,
        status,
        requested_by_id,
        requested_by_name,
        requested_at,
        started_at,
        completed_at,
        agent_id,
        result_json,
        error_message,
        expires_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      requestType,
      targetDate,
      status,
      "operator-1",
      "시험 사용자",
      requestedAt,
      status ===
        "processing"
        ? requestedAt
        : null,
      status ===
        "complete"
        ? completedAt
        : null,
      "agent-1",
      result ===
        null
        ? null
        : JSON.stringify(
            result
          ),
      null,
      expiresAt,
      updatedAt
    );
}


async function postAction(
  database,
  action,
  {
    targetDate =
      TARGET_DATE,
    expectedRevision,
    token =
      AUTH_TOKEN,
    body = {}
  } = {}
) {
  const headers = {
    "Content-Type":
      "application/json"
  };

  if (
    token
  ) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const request =
    new Request(
      `https://shift.test/api/ois-data-requests?action=${action}`,
      {
        method:
          "POST",
        headers,
        body:
          JSON.stringify({
            action,
            targetDate,
            ...(
              expectedRevision ===
                undefined
                ? {}
                : {
                    expectedRevision
                  }
            ),
            ...body
          })
      }
    );

  const response =
    await onRequestPost({
      request,
      env: {
        DB:
          database
      }
    });

  return {
    status:
      response.status,
    body:
      await response.json()
  };
}


async function postAgentComplete(
  database,
  requestId,
  result
) {
  const response =
    await onRequestPost({
      request:
        new Request(
          "https://shift.test/api/ois-data-requests",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
              "X-OIS-Agent-Key":
                "test-agent-key",
              "X-OIS-Agent-Id":
                "agent-1"
            },
            body:
              JSON.stringify({
                action:
                  "complete",
                requestId,
                result
              })
          }
        ),
      env: {
        DB:
          database,
        OIS_AGENT_KEY:
          "test-agent-key"
      }
    });

  return {
    status:
      response.status,
    body:
      await response.json()
  };
}


function createCompleteSolarHistoryRows(
  targetDate =
    TARGET_DATE
) {
  const rows = [];
  const cursor =
    new Date(
      `${targetDate.slice(0, 4)}-01-01T00:00:00.000Z`
    );
  const end =
    new Date(
      `${targetDate}T00:00:00.000Z`
    );

  let monthKey =
    "";
  let monthly =
    0;
  let yearly =
    0;

  while (
    cursor <=
      end
  ) {
    const date =
      cursor
        .toISOString()
        .slice(
          0,
          10
        );
    const nextMonthKey =
      date.slice(
        0,
        7
      );

    if (
      nextMonthKey !==
        monthKey
    ) {
      monthKey =
        nextMonthKey;
      monthly =
        0;
    }

    monthly +=
      1;
    yearly +=
      1;

    rows.push({
      date,
      daily:
        1,
      monthly,
      yearly
    });

    cursor.setUTCDate(
      cursor.getUTCDate() +
        1
    );
  }

  return rows;
}


async function getAction(
  database,
  action,
  parameters = {},
  token =
    AUTH_TOKEN
) {
  const requestUrl =
    new URL(
      "https://shift.test/api/ois-data-requests"
    );

  requestUrl.searchParams.set(
    "action",
    action
  );

  Object.entries(
    parameters
  ).forEach(
    ([
      key,
      value
    ]) => {
      requestUrl.searchParams.set(
        key,
        value
      );
    }
  );

  const headers = {};

  if (
    token
  ) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const response =
    await onRequestGet({
      request:
        new Request(
          requestUrl,
          {
            headers
          }
        ),
      env: {
        DB:
          database
      }
    });

  return {
    status:
      response.status,
    body:
      await response.json()
  };
}


function readOverrideRow(
  sqlite,
  targetDate =
    TARGET_DATE
) {
  return sqlite
    .prepare(`
      SELECT *
      FROM morning_meeting_auto_history_overrides
      WHERE target_date = ?
    `)
    .get(
      targetDate
    );
}


test(
  "reset API requires authentication, a real date and the exact non-negative revision",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      const unauthenticated =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7,
            token:
              ""
          }
        );

      assert.equal(
        unauthenticated.status,
        401
      );

      for (
        const invalidDate of [
          "",
          "2026-02-30",
          "2026/09/15"
        ]
      ) {
        const result =
          await postAction(
            fixture.database,
            "reset_morning_meeting_auto_history",
            {
              targetDate:
                invalidDate,
              expectedRevision:
                7
            }
          );

        assert.equal(
          result.status,
          400,
          invalidDate
        );
      }

      for (
        const invalidRevision of [
          true,
          -1,
          1.5,
          Number.MAX_SAFE_INTEGER +
            1,
          "7",
          null
        ]
      ) {
        const result =
          await postAction(
            fixture.database,
            "reset_morning_meeting_auto_history",
            {
              expectedRevision:
                invalidRevision
            }
          );

        assert.equal(
          result.status,
          400,
          String(
            invalidRevision
          )
        );
      }

      assert.equal(
        readOverrideRow(
          fixture.sqlite
        ).revision,
        7
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "reset atomically snapshots the raw override, clears it and preserves every source and other date",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      insertRequest(
        fixture.sqlite,
        {
          id:
            "old-water",
          requestType:
            "water_environment",
          result: {
            rawWaterInflow:
              7888
          }
        }
      );

      insertRequest(
        fixture.sqlite,
        {
          id:
            "other-water",
          requestType:
            "water_environment",
          targetDate:
            OTHER_DATE,
          result: {
            rawWaterInflow:
              6818
          }
        }
      );

      const requestsBefore =
        fixture.sqlite
          .prepare(
            "SELECT * FROM ois_data_requests ORDER BY id"
          )
          .all();

      const limestoneBefore =
        fixture.sqlite
          .prepare(
            "SELECT * FROM limestone_usage_records ORDER BY usage_date, unit_no"
          )
          .all();

      const weatherBefore =
        fixture.sqlite
          .prepare(
            "SELECT * FROM morning_meeting_weather_forecasts ORDER BY forecast_date"
          )
          .all();

      const otherBefore =
        readOverrideRow(
          fixture.sqlite,
          OTHER_DATE
        );

      const result =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        result.status,
        200,
        result.body.message
      );

      assert.equal(
        result.body.ok,
        true
      );

      assertPublicResetItem(
        result.body.item,
        {
          active:
            true,
          revision:
            8
        }
      );

      assert.match(
        result.body.item.resetAt,
        /^\d{4}-\d{2}-\d{2}T/
      );

      assert.equal(
        result.body.item.restoredAt,
        ""
      );

      const resetRow =
        readOverrideRow(
          fixture.sqlite
        );

      assert.equal(
        resetRow.values_json,
        "{}"
      );

      assert.equal(
        resetRow.reset_active,
        1
      );

      assert.deepEqual(
        JSON.parse(
          resetRow.reset_snapshot_values_json
        ),
        ORIGINAL_OVERRIDE_VALUES
      );

      assert.deepEqual(
        fixture.sqlite
          .prepare(
            "SELECT * FROM ois_data_requests ORDER BY id"
          )
          .all(),
        requestsBefore
      );

      assert.deepEqual(
        fixture.sqlite
          .prepare(
            "SELECT * FROM limestone_usage_records ORDER BY usage_date, unit_no"
          )
          .all(),
        limestoneBefore
      );

      assert.deepEqual(
        fixture.sqlite
          .prepare(
            "SELECT * FROM morning_meeting_weather_forecasts ORDER BY forecast_date"
          )
          .all(),
        weatherBefore
      );

      assert.deepEqual(
        readOverrideRow(
          fixture.sqlite,
          OTHER_DATE
        ),
        otherBefore
      );

      assert.doesNotMatch(
        JSON.stringify(
          result.body
        ),
        /snapshot|futureMetadata/i
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "reset rejects an active selected-date source request without changing any value",
  async () => {
    for (
      const status of [
        "pending",
        "processing"
      ]
    ) {
      const fixture =
        await createApiFixture();

      try {
        insertRequest(
          fixture.sqlite,
          {
            id:
              `active-${status}`,
            requestType:
              "limestone_stock",
            status,
            result:
              null
          }
        );

        const before =
          readOverrideRow(
            fixture.sqlite
          );

        const result =
          await postAction(
            fixture.database,
            "reset_morning_meeting_auto_history",
            {
              expectedRevision:
                7
            }
          );

        assert.equal(
          result.status,
          409,
          status
        );

        assert.deepEqual(
          readOverrideRow(
            fixture.sqlite
          ),
          before
        );

        assert.equal(
          fixture.sqlite
            .prepare(
              "SELECT status FROM ois_data_requests WHERE id = ?"
            )
            .get(
              `active-${status}`
            ).status,
          status
        );

      } finally {
        fixture.sqlite.close();
      }
    }
  }
);


test(
  "expired selected-date requests do not block reset and no request row is mutated",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      for (
        const status of [
          "pending",
          "processing"
        ]
      ) {
        insertRequest(
          fixture.sqlite,
          {
            id:
              `expired-${status}`,
            requestType:
              status ===
                "pending"
                ? "water_environment"
                : "daily_data_excel",
            status,
            requestedAt:
              "2000-01-01T00:00:00.000Z",
            completedAt:
              null,
            updatedAt:
              "2000-01-01T00:00:00.000Z",
            expiresAt:
              "2000-01-01T00:01:00.000Z",
            result:
              null
          }
        );
      }

      insertRequest(
          fixture.sqlite,
          {
            id:
            "other-date-expired",
          requestType:
            "water_environment",
          targetDate:
            OTHER_DATE,
          status:
            "pending",
          completedAt:
            null,
          updatedAt:
            "2026-09-15T00:00:00.000Z",
          expiresAt:
            "2000-01-01T00:01:00.000Z",
          result:
            null
        }
      );

      const requestsBefore =
        plain(
          fixture.sqlite
            .prepare(
              "SELECT * FROM ois_data_requests ORDER BY id"
            )
            .all()
        );

      const result =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        result.status,
        200,
        result.body.message
      );

      assert.deepEqual(
        plain(
          fixture.sqlite
            .prepare(
              "SELECT * FROM ois_data_requests ORDER BY id"
            )
            .all()
        ),
        requestsBefore,
        "reset must inspect request expiry without globally cleaning or rewriting the queue"
      );

      assert.equal(
        readOverrideRow(
          fixture.sqlite,
          OTHER_DATE
        ).revision,
        3
      );

      assert.equal(
        readOverrideRow(
          fixture.sqlite
        ).reset_active,
        1
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "reset CAS rejects stale and interleaved updates without overwriting the newer edit",
  async () => {
    const staleFixture =
      await createApiFixture();

    try {
      insertRequest(
        staleFixture.sqlite,
        {
          id:
            "stale-revision-expired-target",
          requestType:
            "water_environment",
          status:
            "pending",
          requestedAt:
            "2000-01-01T00:00:00.000Z",
          completedAt:
            null,
          updatedAt:
            "2000-01-01T00:00:00.000Z",
          expiresAt:
            "2000-01-01T00:01:00.000Z",
          result:
            null
        }
      );

      insertRequest(
        staleFixture.sqlite,
        {
          id:
            "stale-revision-expired-other-date",
          requestType:
            "daily_data_excel",
          targetDate:
            OTHER_DATE,
          status:
            "processing",
          requestedAt:
            "2000-01-01T00:00:00.000Z",
          completedAt:
            null,
          updatedAt:
            "2000-01-01T00:00:00.000Z",
          expiresAt:
            "2000-01-01T00:01:00.000Z",
          result:
            null
        }
      );

      const requestsBefore =
        plain(
          staleFixture.sqlite
            .prepare(
              "SELECT * FROM ois_data_requests ORDER BY id"
            )
            .all()
        );

      const stale =
        await postAction(
          staleFixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              6
          }
        );

      assert.equal(
        stale.status,
        409
      );

      assert.equal(
        readOverrideRow(
          staleFixture.sqlite
        ).revision,
        7
      );

      assert.deepEqual(
        plain(
          staleFixture.sqlite
            .prepare(
              "SELECT * FROM ois_data_requests ORDER BY id"
            )
            .all()
        ),
        requestsBefore,
        "a stale reset request must be entirely read-only"
      );

    } finally {
      staleFixture.sqlite.close();
    }

    const racingFixture =
      await createApiFixture();

    try {
      racingFixture.setBeforeResetUpdate(
        sqlite => {
          sqlite
            .prepare(`
              UPDATE morning_meeting_auto_history_overrides
              SET
                values_json = ?,
                revision = revision + 1
              WHERE target_date = ?
            `)
            .run(
              JSON.stringify({
                waterRawWaterInflow:
                  8123
              }),
              TARGET_DATE
            );
        }
      );

      const raced =
        await postAction(
          racingFixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        raced.status,
        409
      );

      const row =
        readOverrideRow(
          racingFixture.sqlite
        );

      assert.equal(
        row.revision,
        8
      );

      assert.deepEqual(
        JSON.parse(
          row.values_json
        ),
        {
          waterRawWaterInflow:
            8123
        }
      );

      assert.equal(
        row.reset_active,
        0
      );

    } finally {
      racingFixture.sqlite.close();
    }
  }
);


test(
  "an active reset blocks normal override save and blank restore writes",
  async () => {
    const fixture =
      await createApiFixture({
        targetValues: {
          waterRawWaterInflow:
            null,
          smpMinimum:
            90.09
        }
      });

    try {
      const reset =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        reset.status,
        200,
        reset.body.message
      );

      const save =
        await postAction(
          fixture.database,
          "save_morning_meeting_auto_history_override",
          {
            expectedRevision:
              8,
            body: {
              values: {
                waterRawWaterInflow:
                  9000
              }
            }
          }
        );

      const blankRestore =
        await postAction(
          fixture.database,
          "restore_morning_meeting_auto_history_blanks",
          {
            expectedRevision:
              8
          }
        );

      assert.equal(
        save.status,
        409
      );

      assert.equal(
        blankRestore.status,
        409
      );

      const row =
        readOverrideRow(
          fixture.sqlite
        );

      assert.equal(
        row.values_json,
        "{}"
      );

      assert.equal(
        row.revision,
        8
      );

      assert.equal(
        row.reset_active,
        1
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "reset restore reinstates the exact snapshot and deactivates the cutoff",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      const reset =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        reset.status,
        200,
        reset.body.message
      );

      const restored =
        await postAction(
          fixture.database,
          "restore_morning_meeting_auto_history_reset",
          {
            expectedRevision:
              8
          }
        );

      assert.equal(
        restored.status,
        200,
        restored.body.message
      );

      assertPublicResetItem(
        restored.body.item,
        {
          active:
            false,
          revision:
            9
        }
      );

      assert.match(
        restored.body.item.restoredAt,
        /^\d{4}-\d{2}-\d{2}T/
      );

      const row =
        readOverrideRow(
          fixture.sqlite
        );

      assert.deepEqual(
        JSON.parse(
          row.values_json
        ),
        ORIGINAL_OVERRIDE_VALUES
      );

      assert.equal(
        row.reset_active,
        0
      );

      assert.equal(
        row.reset_snapshot_values_json,
        ""
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "release requires every fresh canonical source and then discards the snapshot",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      const reset =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        reset.status,
        200,
        reset.body.message
      );

      for (
        const [
          index,
          requestType
        ] of [
          "water_environment",
          "limestone_stock",
          "turbine_gear_pinion",
          "silo_level"
        ].entries()
      ) {
        insertRequest(
          fixture.sqlite,
          {
            id:
              `fresh-${requestType}`,
            requestType,
            requestedAt:
              `2099-01-01T00:00:0${index}.000Z`,
            completedAt:
              `2099-01-01T00:00:1${index}.000Z`,
            updatedAt:
              `2099-01-01T00:00:1${index}.000Z`
          }
        );
      }

      const incompleteRelease =
        await postAction(
          fixture.database,
          "release_morning_meeting_auto_history_reset",
          {
            expectedRevision:
              8
          }
        );

      assert.equal(
        incompleteRelease.status,
        409
      );

      assert.equal(
        readOverrideRow(
          fixture.sqlite
        ).reset_active,
        1
      );

      insertRequest(
        fixture.sqlite,
        {
          id:
            "fresh-workbook",
          requestType:
            "daily_data_excel",
          requestedAt:
            "2099-01-01T00:00:04.000Z",
          completedAt:
            "2099-01-01T00:00:14.000Z",
          updatedAt:
            "2099-01-01T00:00:14.000Z"
        }
      );

      const released =
        await postAction(
          fixture.database,
          "release_morning_meeting_auto_history_reset",
          {
            expectedRevision:
              8
          }
        );

      assert.equal(
        released.status,
        200,
        released.body.message
      );

      assertPublicResetItem(
        released.body.item,
        {
          active:
            false,
          revision:
            9
        }
      );

      assert.match(
        released.body.item.restoredAt,
        /^\d{4}-\d{2}-\d{2}T/
      );

      const row =
        readOverrideRow(
          fixture.sqlite
        );

      assert.equal(
        row.values_json,
        "{}"
      );

      assert.equal(
        row.reset_active,
        0
      );

      assert.equal(
        row.reset_snapshot_values_json,
        ""
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "release rejects fresh rows whose result JSON is null, blank, malformed, scalar or an array",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      const reset =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        reset.status,
        200,
        reset.body.message
      );

      for (
        const [
          index,
          requestType
        ] of [
          "water_environment",
          "limestone_stock",
          "turbine_gear_pinion",
          "silo_level"
        ].entries()
      ) {
        insertRequest(
          fixture.sqlite,
          {
            id:
              `valid-${requestType}`,
            requestType,
            requestedAt:
              `2099-01-01T00:00:0${index}.000Z`,
            completedAt:
              `2099-01-01T00:00:1${index}.000Z`,
            updatedAt:
              `2099-01-01T00:00:1${index}.000Z`,
            result: {
              value:
                index
            }
          }
        );
      }

      const invalidResults = [
        [
          "empty-object",
          {},
          null
        ],
        [
          "null",
          null,
          null
        ],
        [
          "blank",
          {},
          "   "
        ],
        [
          "malformed",
          {},
          "{not-json"
        ],
        [
          "scalar",
          7,
          null
        ],
        [
          "array",
          [
            1
          ],
          null
        ]
      ];

      for (
        const [
          index,
          [
            label,
            result,
            rawResult
          ]
        ] of invalidResults.entries()
      ) {
        const id =
          `invalid-workbook-${label}`;

        insertRequest(
          fixture.sqlite,
          {
            id,
            requestType:
              index %
                2 ===
                0
                ? "daily_data_excel"
                : "steam_status",
            requestedAt:
              `2099-01-01T00:01:0${index}.000Z`,
            completedAt:
              `2099-01-01T00:01:1${index}.000Z`,
            updatedAt:
              `2099-01-01T00:01:1${index}.000Z`,
            result
          }
        );

        if (
          rawResult !==
            null
        ) {
          fixture.sqlite
            .prepare(
              "UPDATE ois_data_requests SET result_json = ? WHERE id = ?"
            )
            .run(
              rawResult,
              id
            );
        }
      }

      const release =
        await postAction(
          fixture.database,
          "release_morning_meeting_auto_history_reset",
          {
            expectedRevision:
              8
          }
        );

      assert.equal(
        release.status,
        409
      );

      assert.ok(
        release.body.missingRequestTypes.includes(
          "daily_data_excel|steam_status"
        )
      );

      const row =
        readOverrideRow(
          fixture.sqlite
        );

      assert.equal(
        row.reset_active,
        1
      );

      assert.equal(
        row.revision,
        8
      );

      assert.notEqual(
        row.reset_snapshot_values_json,
        ""
      );

      insertRequest(
        fixture.sqlite,
        {
          id:
            "valid-workbook-after-invalid-results",
          requestType:
            "daily_data_excel",
          requestedAt:
            "2099-01-01T00:02:00.000Z",
          completedAt:
            "2099-01-01T00:02:10.000Z",
          updatedAt:
            "2099-01-01T00:02:10.000Z",
          result: {
            source:
              "fresh workbook"
          }
        }
      );

      const validRelease =
        await postAction(
          fixture.database,
          "release_morning_meeting_auto_history_reset",
          {
            expectedRevision:
              8
          }
        );

      assert.equal(
        validRelease.status,
        200,
        validRelease.body.message
      );

      assert.equal(
        readOverrideRow(
          fixture.sqlite
        ).reset_active,
        0
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "fresh legacy steam releases reset and completed history canonicalizes it ahead of old daily workbook data",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      insertRequest(
        fixture.sqlite,
        {
          id:
            "old-daily-workbook",
          requestType:
            "daily_data_excel",
          requestedAt:
            "2000-01-01T00:00:00.000Z",
          completedAt:
            "2000-01-01T00:00:01.000Z",
          updatedAt:
            "2000-01-01T00:00:01.000Z",
          result: {
            source:
              "old daily"
          }
        }
      );

      const reset =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        reset.status,
        200,
        reset.body.message
      );

      for (
        const [
          index,
          requestType
        ] of [
          "water_environment",
          "limestone_stock",
          "turbine_gear_pinion",
          "silo_level"
        ].entries()
      ) {
        insertRequest(
          fixture.sqlite,
          {
            id:
              `fresh-alias-${requestType}`,
            requestType,
            requestedAt:
              `2099-01-01T00:00:0${index}.000Z`,
            completedAt:
              `2099-01-01T00:00:1${index}.000Z`,
            updatedAt:
              `2099-01-01T00:00:1${index}.000Z`
          }
        );
      }

      insertRequest(
        fixture.sqlite,
        {
          id:
            "fresh-legacy-steam",
          requestType:
            "steam_status",
          requestedAt:
            "2099-01-01T00:00:04.000Z",
          completedAt:
            "2099-01-01T00:00:14.000Z",
          updatedAt:
            "2099-01-01T00:00:14.000Z",
          result: {
            source:
              "fresh steam"
          }
        }
      );

      const release =
        await postAction(
          fixture.database,
          "release_morning_meeting_auto_history_reset",
          {
            expectedRevision:
              8
          }
        );

      assert.equal(
        release.status,
        200,
        release.body.message
      );

      const history =
        await getAction(
          fixture.database,
          "completed_history",
          {
            startDate:
              TARGET_DATE,
            endDate:
              TARGET_DATE
          }
        );

      assert.equal(
        history.status,
        200,
        history.body.message
      );

      const workbookItems =
        history.body.items.filter(
          item =>
            item.requestType ===
              "daily_data_excel"
        );

      assert.deepEqual(
        workbookItems,
        [
          {
            id:
              "fresh-legacy-steam",
            requestType:
              "daily_data_excel",
            sourceRequestType:
              "steam_status",
            targetDate:
              TARGET_DATE,
            status:
              "complete",
            result: {
              source:
                "fresh steam"
            },
            completedAt:
              "2099-01-01T00:00:14.000Z",
            updatedAt:
              "2099-01-01T00:00:14.000Z"
          }
        ]
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "fresh workbook completion cannot rebuild solar values into an active reset row or advance its revision",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      const reset =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        reset.status,
        200,
        reset.body.message
      );

      const before =
        readOverrideRow(
          fixture.sqlite
        );

      insertRequest(
        fixture.sqlite,
        {
          id:
            "fresh-workbook-with-solar-history",
          requestType:
            "daily_data_excel",
          status:
            "pending",
          requestedAt:
            "2099-01-01T00:00:00.000Z",
          completedAt:
            null,
          updatedAt:
            "2099-01-01T00:00:00.000Z",
          result:
            null
        }
      );

      const solarHistoryRows =
        createCompleteSolarHistoryRows();
      const finalSolarRow =
        solarHistoryRows.at(
          -1
        );

      const completed =
        await postAgentComplete(
          fixture.database,
          "fresh-workbook-with-solar-history",
          {
            solarDailyGeneration:
              finalSolarRow.daily,
            solarMonthlyCumulative:
              finalSolarRow.monthly,
            solarYearlyCumulative:
              finalSolarRow.yearly,
            solarCumulative: {
              year: {
                complete:
                  true,
                total:
                  finalSolarRow.yearly
              },
              month: {
                total:
                  finalSolarRow.monthly
              },
              historyRows:
                solarHistoryRows
            }
          }
        );

      assert.equal(
        completed.status,
        200,
        completed.body.message
      );

      assert.equal(
        completed.body.item.status,
        "complete"
      );

      const after =
        readOverrideRow(
          fixture.sqlite
        );

      assert.equal(
        after.values_json,
        "{}",
        "solar rebuild must not put values back on a deliberately blank reset date"
      );

      assert.equal(
        after.revision,
        8,
        "release must still be able to use the revision returned by reset"
      );

      assert.equal(
        after.reset_active,
        1
      );

      assert.equal(
        after.reset_snapshot_values_json,
        before.reset_snapshot_values_json,
        "the recovery snapshot must remain byte-for-byte intact"
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "completed history hides pre-reset sources, includes reset metadata and admits newer sources",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      insertRequest(
        fixture.sqlite,
        {
          id:
            "target-old-water",
          requestType:
            "water_environment",
          result: {
            rawWaterInflow:
              7888
          }
        }
      );

      insertRequest(
        fixture.sqlite,
        {
          id:
            "target-old-workbook",
          requestType:
            "daily_data_excel",
          result: {
            generatorEcmsGen1:
              4056621.4
          }
        }
      );

      insertRequest(
        fixture.sqlite,
        {
          id:
            "other-old-water",
          requestType:
            "water_environment",
          targetDate:
            OTHER_DATE,
          result: {
            rawWaterInflow:
              6818
          }
        }
      );

      const reset =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        reset.status,
        200,
        reset.body.message
      );

      const history =
        await getAction(
          fixture.database,
          "completed_history",
          {
            startDate:
              OTHER_DATE,
            endDate:
              TARGET_DATE
          }
        );

      assert.equal(
        history.status,
        200,
        history.body.message
      );

      assert.deepEqual(
        history.body.items.map(
          item =>
            item.id
        ),
        [
          "other-old-water"
        ]
      );

      assert.equal(
        history.body.resets.length,
        1
      );

      assertPublicResetItem(
        history.body.resets[0],
        {
          active:
            true,
          revision:
            8
        }
      );

      assert.equal(
        history.body.overrides.find(
          item =>
            item.targetDate ===
              TARGET_DATE
        ).values &&
        Object.keys(
          history.body.overrides.find(
            item =>
              item.targetDate ===
                TARGET_DATE
          ).values
        ).length,
        0
      );

      assert.doesNotMatch(
        JSON.stringify(
          history.body
        ),
        /snapshot|futureMetadata/i
      );

      insertRequest(
        fixture.sqlite,
        {
          id:
            "target-fresh-water",
          requestType:
            "water_environment",
          requestedAt:
            "2099-01-01T00:00:00.000Z",
          completedAt:
            "2099-01-01T00:00:01.000Z",
          updatedAt:
            "2099-01-01T00:00:01.000Z",
          result: {
            rawWaterInflow:
              9000
          }
        }
      );

      const refreshedHistory =
        await getAction(
          fixture.database,
          "completed_history",
          {
            startDate:
              TARGET_DATE,
            endDate:
              TARGET_DATE
          }
        );

      assert.deepEqual(
        refreshedHistory.body.items.map(
          item =>
            item.id
        ),
        [
          "target-fresh-water"
        ]
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "reset status lazily migrates a populated legacy override table without changing its values or revision",
  async () => {
    const fixture =
      createD1Database();

    try {
      fixture.sqlite.exec(`
        CREATE TABLE users (
          employee_no TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          is_active INTEGER NOT NULL
        );

        CREATE TABLE shift_log_sessions (
          token_hash TEXT PRIMARY KEY,
          employee_no TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_used_at TEXT NOT NULL
        );

        CREATE TABLE morning_meeting_auto_history_overrides (
          target_date TEXT PRIMARY KEY,
          values_json TEXT NOT NULL DEFAULT '{}',
          created_by_id TEXT NOT NULL DEFAULT '',
          created_by_name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT '',
          updated_by_id TEXT NOT NULL DEFAULT '',
          updated_by_name TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT '',
          revision INTEGER NOT NULL DEFAULT 1
        );
      `);

      fixture.sqlite
        .prepare(
          "INSERT INTO users VALUES (?, ?, ?, ?)"
        )
        .run(
          "operator-1",
          "시험 사용자",
          "user",
          1
        );

      fixture.sqlite
        .prepare(
          "INSERT INTO shift_log_sessions VALUES (?, ?, ?, ?)"
        )
        .run(
          createHash(
            "sha256"
          )
            .update(
              AUTH_TOKEN
            )
            .digest(
              "hex"
            ),
          "operator-1",
          "2099-01-01T00:00:00.000Z",
          "2026-09-15T00:00:00.000Z"
        );

      fixture.sqlite
        .prepare(`
          INSERT INTO morning_meeting_auto_history_overrides (
            target_date,
            values_json,
            created_by_id,
            created_by_name,
            created_at,
            updated_by_id,
            updated_by_name,
            updated_at,
            revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          TARGET_DATE,
          JSON.stringify(
            ORIGINAL_OVERRIDE_VALUES
          ),
          "legacy-user",
          "기존 사용자",
          "2026-09-01T00:00:00.000Z",
          "legacy-user",
          "기존 사용자",
          "2026-09-14T00:00:00.000Z",
          12
        );

      const status =
        await getAction(
          fixture.database,
          "morning_meeting_auto_history_reset_status",
          {
            targetDate:
              TARGET_DATE
          }
        );

      assert.equal(
        status.status,
        200,
        status.body.message
      );

      assertPublicResetItem(
        status.body.item,
        {
          active:
            false,
          revision:
            12,
          resetById:
            "",
          resetByName:
            ""
        }
      );

      const columnNames =
        fixture.sqlite
          .prepare(
            "PRAGMA table_info(morning_meeting_auto_history_overrides)"
          )
          .all()
          .map(
            column =>
              column.name
          );

      for (
        const columnName of [
          "reset_active",
          "reset_at",
          "reset_by_id",
          "reset_by_name",
          "reset_snapshot_values_json",
          "reset_restored_at"
        ]
      ) {
        assert.ok(
          columnNames.includes(
            columnName
          ),
          columnName
        );
      }

      const row =
        readOverrideRow(
          fixture.sqlite
        );

      assert.deepEqual(
        JSON.parse(
          row.values_json
        ),
        ORIGINAL_OVERRIDE_VALUES
      );

      assert.equal(
        row.revision,
        12
      );

      assert.equal(
        row.reset_active,
        0
      );

      assert.equal(
        row.reset_at,
        ""
      );

      assert.equal(
        row.reset_snapshot_values_json,
        ""
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "reset status GET is authenticated and returns only the public item contract",
  async () => {
    const fixture =
      await createApiFixture();

    try {
      const reset =
        await postAction(
          fixture.database,
          "reset_morning_meeting_auto_history",
          {
            expectedRevision:
              7
          }
        );

      assert.equal(
        reset.status,
        200,
        reset.body.message
      );

      const unauthenticated =
        await getAction(
          fixture.database,
          "morning_meeting_auto_history_reset_status",
          {
            targetDate:
              TARGET_DATE
          },
          ""
        );

      assert.equal(
        unauthenticated.status,
        401
      );

      const status =
        await getAction(
          fixture.database,
          "morning_meeting_auto_history_reset_status",
          {
            targetDate:
              TARGET_DATE
          }
        );

      assert.equal(
        status.status,
        200,
        status.body.message
      );

      assert.equal(
        status.body.ok,
        true
      );

      assertPublicResetItem(
        status.body.item,
        {
          active:
            true,
          revision:
            8
        }
      );

      assert.doesNotMatch(
        JSON.stringify(
          status.body
        ),
        /snapshot|futureMetadata/i
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


/*
  The UI harness is appended below after the production query/reset module.
  Keeping API and browser contracts in this one focused file makes the
  destructive selected-date flow travel as a single regression gate.
*/


class Element {
  constructor(
    tag =
      "div"
  ) {
    this.tagName =
      tag.toUpperCase();

    this.id =
      "";

    this.className =
      "";

    this.dataset =
      {};

    this.children =
      [];

    this.parentElement =
      null;

    this.attributes =
      new Map();

    this.listeners =
      new Map();

    this._text =
      "";

    this.hidden =
      false;

    this.disabled =
      false;

    this.title =
      "";

    this.value =
      "";

    const classNames =
      () =>
        new Set(
          this.className
            .split(
              /\s+/
            )
            .filter(
              Boolean
            )
        );

    const saveClassNames =
      names => {
        this.className =
          [
            ...names
          ].join(
            " "
          );
      };

    this.classList = {
      contains: name =>
        classNames().has(
          name
        ),

      add: (...names) => {
        const current =
          classNames();

        names.forEach(
          name =>
            current.add(
              name
            )
        );

        saveClassNames(
          current
        );
      },

      remove: (...names) => {
        const current =
          classNames();

        names.forEach(
          name =>
            current.delete(
              name
            )
        );

        saveClassNames(
          current
        );
      },

      toggle: (
        name,
        force
      ) => {
        const current =
          classNames();

        const shouldAdd =
          force ===
            undefined
            ? !current.has(
                name
              )
            : Boolean(
                force
              );

        if (
          shouldAdd
        ) {
          current.add(
            name
          );

        } else {
          current.delete(
            name
          );
        }

        saveClassNames(
          current
        );

        return shouldAdd;
      }
    };
  }

  get textContent() {
    return this._text +
      this.children
        .map(
          child =>
            child.textContent
        )
        .join(
          ""
        );
  }

  set textContent(
    value
  ) {
    this._text =
      String(
        value ??
        ""
      );

    this.children.forEach(
      child => {
        child.parentElement =
          null;
      }
    );

    this.children =
      [];
  }

  get firstChild() {
    return this.children[0] ||
      null;
  }

  get nextSibling() {
    const index =
      this.parentElement
        ?.children
        .indexOf(
          this
        ) ??
      -1;

    return index >=
      0
      ? this.parentElement
          .children[
            index +
            1
          ] ||
        null
      : null;
  }

  append(
    ...nodes
  ) {
    nodes.forEach(
      node =>
        this.insertBefore(
          node,
          null
        )
    );
  }

  appendChild(
    node
  ) {
    this.append(
      node
    );

    return node;
  }

  insertBefore(
    node,
    before
  ) {
    if (
      node.parentElement
    ) {
      const oldIndex =
        node.parentElement
          .children
          .indexOf(
            node
          );

      if (
        oldIndex >=
          0
      ) {
        node.parentElement
          .children
          .splice(
            oldIndex,
            1
          );
      }
    }

    node.parentElement =
      this;

    const nextIndex =
      before
        ? this.children.indexOf(
            before
          )
        : -1;

    if (
      nextIndex >=
        0
    ) {
      this.children.splice(
        nextIndex,
        0,
        node
      );

    } else {
      this.children.push(
        node
      );
    }

    return node;
  }

  matches(
    selector
  ) {
    if (
      selector.startsWith(
        "#"
      )
    ) {
      return this.id ===
        selector.slice(
          1
        );
    }

    if (
      selector.startsWith(
        "."
      )
    ) {
      return this.classList.contains(
        selector.slice(
          1
        )
      );
    }

    return this.tagName.toLowerCase() ===
      selector.toLowerCase();
  }

  querySelectorAll(
    selector
  ) {
    return this.children.flatMap(
      child => [
        ...(
          child.matches(
            selector
          )
            ? [
                child
              ]
            : []
        ),
        ...child.querySelectorAll(
          selector
        )
      ]
    );
  }

  querySelector(
    selector
  ) {
    return this.querySelectorAll(
      selector
    )[0] ||
      null;
  }

  setAttribute(
    key,
    value
  ) {
    this.attributes.set(
      key,
      String(
        value
      )
    );
  }

  getAttribute(
    key
  ) {
    return this.attributes.get(
      key
    ) ??
      null;
  }

  addEventListener(
    type,
    listener
  ) {
    const listeners =
      this.listeners.get(
        type
      ) ||
      [];

    listeners.push(
      listener
    );

    this.listeners.set(
      type,
      listeners
    );
  }

  dispatchEvent(
    event
  ) {
    event.target =
      event.target ||
      this;

    event.currentTarget =
      this;

    for (
      const listener of this.listeners.get(
        event.type
      ) ||
      []
    ) {
      listener(
        event
      );
    }

    return !event.defaultPrevented;
  }

  click() {
    if (
      this.hidden ||
      this.disabled
    ) {
      return;
    }

    this.dispatchEvent({
      type:
        "click",
      defaultPrevented:
        false,
      preventDefault() {
        this.defaultPrevented =
          true;
      }
    });
  }
}


function createResponse(
  status,
  body
) {
  return {
    ok:
      status >=
        200 &&
      status <
        300,
    status,
    async json() {
      return body;
    }
  };
}


function deferred() {
  let resolve;
  let reject;

  const promise =
    new Promise(
      (
        resolvePromise,
        rejectPromise
      ) => {
        resolve =
          resolvePromise;
        reject =
          rejectPromise;
      }
    );

  return {
    promise,
    resolve,
    reject
  };
}


function inactiveResetItem(
  revision =
    7
) {
  return {
    targetDate:
      TARGET_DATE,
    active:
      false,
    resetAt:
      "",
    resetById:
      "",
    resetByName:
      "",
    restoredAt:
      "",
    revision
  };
}


function activeResetItem(
  revision =
    8
) {
  return {
    targetDate:
      TARGET_DATE,
    active:
      true,
    resetAt:
      "2026-09-16T04:00:00.000Z",
    resetById:
      "operator-1",
    resetByName:
      "시험 사용자",
    restoredAt:
      "",
    revision
  };
}


function successfulOperations() {
  return Array.from(
    {
      length:
        6
    },
    (
      _value,
      index
    ) => ({
      status:
        "fulfilled",
      value: {
        key:
          `source-${index}`,
        status:
          "fulfilled",
        result: {
          complete:
            true
        }
      }
    })
  );
}


async function runRealForcedLimestoneBulkLoader(
  limestoneStatus
) {
  const start =
    scriptSource.indexOf(
      "async function loadLimestoneForBulk("
    );
  const end =
    scriptSource.indexOf(
      "async function loadWeatherForBulk(",
      start
    );

  assert.ok(
    start >=
      0 &&
    end >
      start,
    "the real forced limestone bulk loader must exist"
  );

  const dateInput = {
    value:
      TARGET_DATE
  };
  const calculator = {
    dataset: {
      limestoneUsageStatus:
        limestoneStatus
    }
  };
  const context =
    vm.createContext({
      document: {
        getElementById(
          id
        ) {
          if (
            id ===
              "limestoneUsageDate"
          ) {
            return dateInput;
          }

          if (
            id ===
              "limestoneUsageCalculatorView"
          ) {
            return calculator;
          }

          return null;
        }
      },
      window: {
        async loadLimestoneOisStock() {
          return undefined;
        }
      },
      hasBulkCompleteStatus() {
        return false;
      },
      console: {
        warn() {}
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    "\nglobalThis.__result = loadLimestoneForBulk({ forceRefresh: true });",
    context,
    {
      filename:
        "actual-forced-limestone-bulk-loader.js"
    }
  );

  return await context
    .__result;
}


function runRealOperationLoader(
  source,
  {
    success =
      true
  } = {}
) {
  const definitions = {
    water: {
      start:
        "async function loadWaterTreatment(",
      end:
        "/* =====================================================\n    기준일 변경 감지",
      createName:
        "createWaterRequest",
      stateKey:
        "waterTreatment"
    },
    gear: {
      start:
        "async function loadGearPinion(",
      end:
        "/* =====================================================\n    Gear / Pinion 결과 초기화",
      createName:
        "createGearPinionRequest",
      stateKey:
        "gearPinion"
    },
    silo: {
      start:
        "async function loadSiloLevel(",
      end:
        "/* =====================================================\n    Silo 결과 초기화",
      createName:
        "createSiloRequest",
      stateKey:
        "siloLevel"
    }
  };
  const definition =
    definitions[source];

  assert.ok(
    definition,
    source
  );

  const start =
    scriptSource.indexOf(
      definition.start
    );
  const end =
    scriptSource.indexOf(
      definition.end,
      start
    );

  assert.ok(
    start >=
      0 &&
    end >
      start,
    `the actual ${source} loader must exist`
  );

  const panel = {
    dataset: {
      morningMeetingAutoBaseDate:
        TARGET_DATE
    }
  };
  const loadButton = {
    disabled:
      false,
    textContent:
      "조회"
  };
  const state = {};
  const freshResult = {
    sourceDate:
      TARGET_DATE,
    targetDate:
      TARGET_DATE,
    source,
    fresh:
      true
  };
  const statusCalls = [];
  const errors = [];
  const requestItem = {
    id:
      `${source}-request`,
    status:
      "complete",
    targetDate:
      TARGET_DATE,
    result: {
      value:
        1
    }
  };
  const createRequest =
    async () => {
      if (
        !success
      ) {
        throw new Error(
          `${source} failed`
        );
      }

      return {
        item:
          requestItem
      };
    };
  const contextValues = {
    window: {
      renderEfficiencyMorningMeetingSiloLevelPreview() {}
    },
    document: {
      getElementById() {
        return null;
      }
    },
    Date,
    Map,
    Error,
    activeRunToken:
      0,
    activeRequestId:
      "",
    getState() {
      return state;
    },
    getElements() {
      return {
        panel,
        loadButton
      };
    },
    synchronizeTargetDate() {
      return TARGET_DATE;
    },
    normalizeText(value) {
      return String(
        value ??
        ""
      ).trim();
    },
    hideError() {},
    showError(message) {
      errors.push(
        message
      );
    },
    setStatus(
      status,
      message
    ) {
      statusCalls.push({
        status,
        message
      });
    },
    async waitForCompletion() {
      return requestItem;
    },
    applyWaterResult() {
      state.waterTreatment = {
        ...freshResult
      };

      return state.waterTreatment;
    },
    applyGearPinionResult() {
      state.gearPinion = {
        ...freshResult
      };

      return state.gearPinion;
    },
    applySiloResult() {
      state.siloLevel = {
        ...freshResult
      };

      return state.siloLevel;
    },
    console: {
      log() {},
      warn() {},
      error() {}
    }
  };

  contextValues[
    definition.createName
  ] =
    createRequest;

  const context =
    vm.createContext(
      contextValues
    );
  const functionName =
    source ===
      "water"
      ? "loadWaterTreatment"
      : source ===
          "gear"
        ? "loadGearPinion"
        : "loadSiloLevel";

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    `\nglobalThis.__result = ${functionName}({ forceRefresh: true });`,
    context,
    {
      filename:
        `actual-${source}-loader.js`
    }
  );

  return {
    promise:
      context.__result,
    state,
    panel,
    statusCalls,
    errors,
    freshResult
  };
}


function runRealForcedBulkItem(
  loaderResult,
  {
    statusComplete =
      false,
    key =
      "source"
  } = {}
) {
  const start =
    scriptSource.indexOf(
      "async function runBulkLookupItem("
    );
  const end =
    scriptSource.indexOf(
      "function runBulkLookup(",
      start
    );

  assert.ok(
    start >=
      0 &&
    end >
      start,
    "the actual operations result normalizer must exist"
  );

  const context =
    vm.createContext({
      isBulkItemCurrentDate() {
        return true;
      },
      hasBulkCompleteStatus() {
        return statusComplete;
      },
      hasBulkLoadingStatus() {
        return false;
      },
      hasBulkSourceCompleteStatus() {
        return statusComplete;
      },
      async waitForExistingBulkTask() {},
      keepBulkButtonLocked() {},
      setBulkControlsLocked() {},
      Error
    });

  context.__loaderResult =
    loaderResult;
  context.__item = {
    key,
    label:
      key,
    forceRefresh:
      true,
    statusIds: [
      `${key}-status`
    ],
    async load() {
      return context
        .__loaderResult;
    }
  };
  context.__button = {};

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    "\nglobalThis.__result = runBulkLookupItem(globalThis.__item, globalThis.__button);",
    context,
    {
      filename:
        "actual-forced-operation-result-normalizer.js"
    }
  );

  return context
    .__result;
}


function runRealForcedSmpLoader({
  responseOk =
    false,
  requireFresh =
    true
} = {}) {
  const moduleStart =
    scriptSource.indexOf(
      "(function initializeEfficiencyMorningMeetingSmpPrice()"
    );
  const start =
    scriptSource.indexOf(
      "async function loadDate(",
      moduleStart
    );
  const end =
    scriptSource.indexOf(
      "async function load(\n",
      start
    );

  assert.ok(
    moduleStart >=
      0 &&
    start >
      moduleStart &&
    end >
      start,
    "the actual SMP date loader must exist"
  );

  const staleItem = {
    sourceDate:
      "2026-09-16",
    minimum:
      1,
    stale:
      true
  };
  const state = {
    smpPriceByDate: {
      "2026-09-16":
        staleItem
    },
    smpPriceStatusByDate: {},
    smpPriceErrorByDate: {}
  };
  const context =
    vm.createContext({
      state,
      activeControllers: [],
      requestSequence:
        1,
      API_URL:
        "/api/smp-price",
      window: {
        location: {
          origin:
            "https://shift.test"
        }
      },
      document: {
        dispatchEvent() {}
      },
      CustomEvent: class {
        constructor(
          type,
          options
        ) {
          this.type =
            type;
          this.detail =
            options?.detail;
        }
      },
      AbortController,
      URL,
      Error,
      getState() {
        return state;
      },
      render() {},
      text(value) {
        return String(
          value ??
          ""
        ).trim();
      },
      normalizeResult(
        _result,
        expectedDate
      ) {
        return {
          sourceDate:
            expectedDate,
          minimum:
            2,
          fresh:
            true
        };
      },
      async fetch() {
        return {
          ok:
            responseOk,
          status:
            responseOk
              ? 200
              : 503,
          async json() {
            return responseOk
              ? {
                  ok:
                    true
                }
              : {
                  ok:
                    false,
                  message:
                    "fresh SMP unavailable"
                };
          }
        };
      },
      console: {
        error() {}
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    `\nglobalThis.__result = loadDate("2026-09-16", true, 1, ${
      requireFresh
        ? "true"
        : "false"
    });`,
    context,
    {
      filename:
        "actual-forced-smp-loader.js"
    }
  );

  return {
    promise:
      context.__result,
    staleItem,
    state
  };
}


function runRealForcedWeatherLoader({
  responseOk =
    false,
  requireFresh =
    true
} = {}) {
  const moduleStart =
    scriptSource.indexOf(
      "(function initializeEfficiencyMorningMeetingWeather()"
    );
  const normalizeStart =
    scriptSource.indexOf(
      "function normalizeApiItem(",
      moduleStart
    );
  const start =
    scriptSource.indexOf(
      "async function load(\n",
      normalizeStart
    );
  const end =
    scriptSource.indexOf(
      "function scheduleLoad(",
      start
    );

  assert.ok(
    moduleStart >=
      0 &&
    normalizeStart >
      moduleStart &&
    start >
      normalizeStart &&
    end >
      start,
    "the actual weather loader must exist"
  );

  const meetingDate =
    "2026-09-16";
  const staleItem = {
    sourceDate:
      meetingDate,
    condition:
      "old weather",
    stale:
      true
  };
  const weatherByDate =
    new Map([
      [
        meetingDate,
        staleItem
      ]
    ]);
  const statusByDate =
    new Map();
  const errorByDate =
    new Map();
  const context =
    vm.createContext({
      weatherByDate,
      statusByDate,
      errorByDate,
      activeController:
        null,
      requestSequence:
        0,
      API_URL:
        "/api/weather-forecast",
      FORECAST_HOUR:
        "09:00",
      window: {
        location: {
          origin:
            "https://shift.test"
        }
      },
      document: {
        dispatchEvent() {}
      },
      CustomEvent: class {
        constructor(
          type,
          options
        ) {
          this.type =
            type;
          this.detail =
            options?.detail;
        }
      },
      AbortController,
      URL,
      Date,
      Error,
      getMeetingDate() {
        return meetingDate;
      },
      isIsoDate(value) {
        return value ===
          meetingDate;
      },
      clean(value) {
        return String(
          value ??
          ""
        ).trim();
      },
      render() {},
      normalizeApiItem(
        _item,
        expectedDate
      ) {
        return {
          sourceDate:
            expectedDate,
          condition:
            "fresh weather",
          fresh:
            true
        };
      },
      async fetch() {
        return {
          ok:
            responseOk,
          status:
            responseOk
              ? 200
              : 503,
          async json() {
            return responseOk
              ? {
                  ok:
                    true,
                  item: {
                    sourceDate:
                      meetingDate
                  }
                }
              : {
                  ok:
                    false,
                  message:
                    "fresh weather unavailable"
                };
          }
        };
      },
      console: {
        log() {},
        error() {}
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    `\nglobalThis.__result = load({ forceRefresh: true, userInitiated: true, requireFresh: ${
      requireFresh
        ? "true"
        : "false"
    } });`,
    context,
    {
      filename:
        "actual-forced-weather-loader.js"
    }
  );

  return {
    promise:
      context.__result,
    staleItem,
    weatherByDate,
    statusByDate
  };
}


function createQueryUiHarness({
  initialReset =
    inactiveResetItem(),
  token =
    "session-token",
  mobile =
    false,
  confirm =
    true,
  responseHook =
    null,
  operationsResult =
    successfulOperations(),
  persistSmpResult =
    true,
  historyRefreshResult =
    true,
  workbookResult = {
    sourceDate:
      TARGET_DATE,
    generatorEcmsGen1:
      4056621.4
  }
} = {}) {
  const document =
    new Element(
      "body"
    );

  document.readyState =
    "complete";

  document.createElement =
    tag =>
      new Element(
        tag
      );

  document.getElementById =
    id =>
      document.querySelector(
        `#${id}`
      );

  const make = (
    id,
    parent =
      document,
    className =
      "",
    tag =
      "div"
  ) => {
    const element =
      new Element(
        tag
      );

    element.id =
      id;

    element.className =
      className;

    parent.append(
      element
    );

    return element;
  };

  const panel =
    make(
      "efficiencyMorningMeetingWaterPanel"
    );

  panel.dataset.morningMeetingAutoBaseDate =
    TARGET_DATE;

  const preview =
    make(
      "efficiencyMorningMeetingAutoPreview",
      panel
    );

  const grid =
    make(
      "morning-grid",
      preview,
      "efficiency-morning-meeting-auto-preview__grid"
    );

  const dateBar =
    make(
      "morning-date-bar",
      grid,
      "efficiency-morning-meeting-auto-common-date"
    );

  for (
    const id of [
      "efficiencyMorningMeetingAutoDailyPowerCard",
      "efficiencyMorningMeetingAutoSteamCard",
      "efficiencyMorningMeetingAutoCofiringCard",
      "efficiencyMorningMeetingAutoDailySludgeCard"
    ]
  ) {
    make(
      id,
      grid
    );
  }

  const miniIds = [
    "morningMeetingCofiringRefreshButton",
    "efficiencyMorningMeetingAutoDailyPowerRefreshButton",
    "efficiencyMorningMeetingAutoSteamRefreshButton",
    "efficiencyMorningMeetingAutoDailySludgeRefreshButton",
    "efficiencyMorningMeetingAutoRetry-water",
    "efficiencyMorningMeetingAutoRetry-limestone",
    "efficiencyMorningMeetingAutoRetry-gear-pinion",
    "efficiencyMorningMeetingAutoRetry-silo-level",
    "efficiencyMorningMeetingAutoSmpRefreshButton",
    "efficiencyMorningMeetingAutoWeatherRefreshButton"
  ];

  miniIds.forEach(
    id =>
      make(
        id,
        grid,
        "",
        "button"
      )
  );

  make(
    "loadEfficiencyMorningMeetingWaterButton",
    preview,
    "",
    "button"
  );

  make(
    "efficiencyMorningMeetingAutoPreviewStatus",
    preview
  );

  make(
    "resetEfficiencyMorningMeetingButton",
    document,
    "",
    "button"
  );

  const fetchCalls = [];
  const upstreamCalls = [];
  const confirmMessages = [];
  const toastMessages = [];
  const appliedResetItems = [];
  const restoredDates = [];
  const documentEvents = [];
  const persistSmpCalls = [];
  const historyRefreshCalls = [];
  const resetLifecycleCalls = [];
  const timers =
    new Map();

  let nextTimerId =
    0;

  let serverResetItem = {
    ...initialReset
  };

  const window = {
    navigator: {
      userAgent:
        mobile
          ? "Android Mobile"
          : "Windows",
      platform:
        "Win32",
      maxTouchPoints:
        0
    },

    matchMedia() {
      return {
        matches:
          mobile
      };
    },

    efficiencyMorningMeetingUploadState: {},

    getShiftLogAuthHeaders() {
      return token
        ? {
            Authorization:
              `Bearer ${token}`
          }
        : {};
    },

    confirm(
      message
    ) {
      confirmMessages.push(
        message
      );

      return confirm;
    },

    showToast(
      message,
      type =
        ""
    ) {
      toastMessages.push({
        message,
        type
      });
    },

    applyMorningMeetingSelectedDateResetState(
      item
    ) {
      appliedResetItems.push(
        plain(
          item
        )
      );
    },

    async restoreMorningMeetingSavedCompletedHistoryForDate(
      date
    ) {
      restoredDates.push(
        date
      );

      return true;
    },

    async runEfficiencyMorningMeetingBulkLookup(
      options
    ) {
      upstreamCalls.push({
        source:
          "operations",
        options:
          plain(
            options
          )
      });

      if (
        operationsResult instanceof
          Error
      ) {
        throw operationsResult;
      }

      return operationsResult;
    },

    async loadEfficiencyMorningMeetingDailyData(
      options
    ) {
      upstreamCalls.push({
        source:
          "workbook",
        options:
          plain(
            options
          )
      });

      if (
        workbookResult instanceof
          Error
      ) {
        throw workbookResult;
      }

      return workbookResult;
    },

    async persistEfficiencyMorningMeetingFreshSmpAfterReset(
      date,
      revision
    ) {
      persistSmpCalls.push({
        date,
        revision
      });
      resetLifecycleCalls.push({
        type:
          "persist-smp",
        date,
        revision
      });

      if (
        persistSmpResult instanceof
          Error
      ) {
        throw persistSmpResult;
      }

      return persistSmpResult;
    },

    async refreshEfficiencyMorningMeetingAutoHistory() {
      historyRefreshCalls.push(
        true
      );
      resetLifecycleCalls.push({
        type:
          "refresh-history"
      });

      if (
        historyRefreshResult instanceof
          Error
      ) {
        throw historyRefreshResult;
      }

      return historyRefreshResult;
    },

    setTimeout(
      callback
    ) {
      const timerId =
        ++nextTimerId;

      timers.set(
        timerId,
        callback
      );

      return timerId;
    },

    addEventListener() {},

    async fetch(
      url,
      options = {}
    ) {
      const call = {
        url:
          String(
            url
          ),
        options: {
          ...options
        }
      };

      fetchCalls.push(
        call
      );

      if (
        options.method ===
          "POST"
      ) {
        resetLifecycleCalls.push({
          type:
            "post",
          action:
            JSON.parse(
              options.body
            ).action
        });

      } else {
        resetLifecycleCalls.push({
          type:
            "get-status"
        });
      }

      if (
        typeof responseHook ===
          "function"
      ) {
        const overridden =
          await responseHook({
            call,
            serverResetItem: {
              ...serverResetItem
            }
          });

        if (
          overridden
        ) {
          return overridden;
        }
      }

      if (
        options.method ===
          "POST"
      ) {
        const requestBody =
          JSON.parse(
            options.body
          );

        if (
          requestBody.action ===
            "reset_morning_meeting_auto_history"
        ) {
          serverResetItem =
            activeResetItem(
              requestBody.expectedRevision +
              1
            );

        } else if (
          requestBody.action ===
            "restore_morning_meeting_auto_history_reset" ||
          requestBody.action ===
            "release_morning_meeting_auto_history_reset"
        ) {
          serverResetItem = {
            ...serverResetItem,
            active:
              false,
            restoredAt:
              "2026-09-16T04:10:00.000Z",
            revision:
              requestBody.expectedRevision +
              1
          };
        }

        return createResponse(
          200,
          {
            ok:
              true,
            item: {
              ...serverResetItem
            }
          }
        );
      }

      return createResponse(
        200,
        {
          ok:
            true,
          item: {
            ...serverResetItem
          }
        }
      );
    }
  };

  document.dispatchEvent =
    event => {
      documentEvents.push(
        event
      );

      return Element.prototype
        .dispatchEvent.call(
          document,
          event
        );
    };

  const context =
    vm.createContext({
      window,
      document,
      Date,
      Map,
      Set,
      Promise,
      console: {
        log() {},
        warn() {},
        error() {}
      },
      getShiftLogSessionToken() {
        return token;
      },
      CustomEvent: class {
        constructor(
          type,
          options = {}
        ) {
          this.type =
            type;

          this.detail =
            options.detail;

          this.defaultPrevented =
            false;
        }
      },
      MutationObserver: class {
        constructor(
          callback
        ) {
          this.callback =
            callback;
        }

        observe() {}
      }
    });

  vm.runInContext(
    querySource,
    context,
    {
      filename:
        "morning-meeting-query-sources.js"
    }
  );

  async function settle() {
    for (
      let attempt =
        0;
      attempt <
        8;
      attempt +=
        1
    ) {
      await Promise.resolve();

      const pendingTimers =
        [
          ...timers.entries()
        ];

      timers.clear();

      pendingTimers.forEach(
        ([
          ,
          callback
        ]) => {
          callback();
        }
      );
    }
  }

  return {
    window,
    document,
    panel,
    preview,
    grid,
    dateBar,
    fetchCalls,
    upstreamCalls,
    confirmMessages,
    toastMessages,
    appliedResetItems,
    restoredDates,
    documentEvents,
    persistSmpCalls,
    historyRefreshCalls,
    resetLifecycleCalls,
    timers,
    settle,
    api:
      window.morningMeetingQuerySources,
    byId:
      document.getElementById,
    getServerResetItem() {
      return {
        ...serverResetItem
      };
    },
    clearCalls() {
      fetchCalls.length =
        0;

      upstreamCalls.length =
        0;

      confirmMessages.length =
        0;

      toastMessages.length =
        0;

      appliedResetItems.length =
        0;

      restoredDates.length =
        0;

      persistSmpCalls.length =
        0;

      historyRefreshCalls.length =
        0;

      resetLifecycleCalls.length =
        0;
    }
  };
}


test(
  "desktop toolbar shows one selected-date reset control and authenticated status is loaded",
  async () => {
    const harness =
      createQueryUiHarness();

    await harness.settle();

    const toolbar =
      harness.byId(
        "morningMeetingQuerySources"
      );

    const resetButton =
      harness.byId(
        "morningMeetingResetButton"
      );

    assert.ok(
      toolbar
    );

    assert.equal(
      harness.dateBar.nextSibling,
      toolbar
    );

    assert.ok(
      resetButton
    );

    assert.equal(
      resetButton.textContent,
      "선택일 자료 초기화"
    );

    assert.equal(
      resetButton.hidden,
      false
    );

    assert.equal(
      resetButton.disabled,
      false
    );

    assert.ok(
      resetButton.classList.contains(
        "is-danger"
      )
    );

    assert.equal(
      harness.fetchCalls.length,
      1
    );

    assert.match(
      harness.fetchCalls[0].url,
      /action=morning_meeting_auto_history_reset_status/
    );

    assert.match(
      harness.fetchCalls[0].url,
      /targetDate=2026-09-15/
    );

    for (
      const options of [
        {
          token:
            ""
        },
        {
          mobile:
            true
        }
      ]
    ) {
      const blocked =
        createQueryUiHarness(
          options
        );

      await blocked.settle();

      assert.equal(
        blocked.byId(
          "morningMeetingResetButton"
        ).hidden,
        true
      );

      assert.equal(
        blocked.fetchCalls.length,
        0
      );
    }
  }
);


test(
  "frontend confirms the exact date once and posts one reset without querying any source",
  async () => {
    const harness =
      createQueryUiHarness();

    await harness.settle();
    harness.clearCalls();

    const result =
      await harness.api.toggleReset({
        userInitiated:
          true
      });

    assert.equal(
      result.active,
      true
    );

    assert.deepEqual(
      harness.confirmMessages,
      [
        `${TARGET_DATE} 오전회의 조회 자료를 모두 초기화하시겠습니까?\n\n선택일 화면만 비우며 원본 자료와 다른 날짜는 삭제하지 않습니다. 자동 재조회도 실행하지 않습니다.`
      ]
    );

    assert.equal(
      harness.fetchCalls.length,
      1
    );

    assert.equal(
      harness.fetchCalls[0].url,
      "/api/ois-data-requests"
    );

    assert.deepEqual(
      JSON.parse(
        harness.fetchCalls[0]
          .options
          .body
      ),
      {
        action:
          "reset_morning_meeting_auto_history",
        targetDate:
          TARGET_DATE,
        expectedRevision:
          7
      }
    );

    assert.equal(
      harness.upstreamCalls.length,
      0,
      "reset must not call OIS, workbook, DataPARC, weather or SMP loaders"
    );

    assert.equal(
      harness.api.resetState(
        TARGET_DATE
      ).active,
      true
    );

    assert.equal(
      harness.byId(
        "morningMeetingResetButton"
      ).textContent,
      "초기화 취소"
    );

    assert.equal(
      harness.byId(
        "morningMeetingQuerySources"
      ).dataset.resetActive,
      "true"
    );
  }
);


test(
  "cancelled reset sends nothing and a 409 response is never retried",
  async () => {
    const cancelled =
      createQueryUiHarness({
        confirm:
          false
      });

    await cancelled.settle();
    cancelled.clearCalls();

    await cancelled.api.toggleReset({
      userInitiated:
        true
    });

    assert.equal(
      cancelled.fetchCalls.length,
      0
    );

    assert.equal(
      cancelled.upstreamCalls.length,
      0
    );

    const conflicted =
      createQueryUiHarness({
        responseHook({
          call
        }) {
          if (
            call.options.method ===
              "POST"
          ) {
            return createResponse(
              409,
              {
                ok:
                  false,
                message:
                  "다른 사용자가 먼저 변경했습니다.",
                currentItem:
                  inactiveResetItem(
                    8
                  )
              }
            );
          }

          return null;
        }
      });

    await conflicted.settle();
    conflicted.clearCalls();

    const result =
      await conflicted.api.toggleReset({
        userInitiated:
          true
      });

    assert.equal(
      result,
      null
    );

    assert.equal(
      conflicted.fetchCalls.length,
      1,
      "a destructive conflict must not be retried"
    );

    assert.equal(
      conflicted.api.resetState(
        TARGET_DATE
      ).revision,
      8
    );

    assert.equal(
      conflicted.upstreamCalls.length,
      0
    );
  }
);


test(
  "a delayed lower-revision reset status cannot overwrite a newer reset mutation",
  async () => {
    let delayedStatus =
      null;

    const harness =
      createQueryUiHarness({
        responseHook({
          call
        }) {
          if (
            delayedStatus &&
            call.options.method !==
              "POST"
          ) {
            return delayedStatus
              .promise;
          }

          return null;
        }
      });

    await harness.settle();
    harness.clearCalls();

    delayedStatus =
      deferred();

    const pendingStatus =
      harness.api.loadResetStatus(
        TARGET_DATE,
        {
          force:
            true
        }
      );

    await Promise.resolve();

    const resetItem =
      await harness.api.resetSelectedDate(
        TARGET_DATE,
        {
          userInitiated:
            true,
          expectedRevision:
            7
        }
      );

    assert.equal(
      resetItem.revision,
      8
    );

    assert.equal(
      resetItem.active,
      true
    );

    delayedStatus.resolve(
      createResponse(
        200,
        {
          ok:
            true,
          item:
            inactiveResetItem(
              7
            )
        }
      )
    );

    const lateResult =
      await pendingStatus;

    assert.equal(
      lateResult.revision,
      8,
      "the caller must receive the retained newer state"
    );

    assert.equal(
      lateResult.active,
      true
    );

    assert.equal(
      harness.api.resetState(
        TARGET_DATE
      ).revision,
      8
    );

    assert.equal(
      harness.api.resetState(
        TARGET_DATE
      ).active,
      true
    );

    assert.deepEqual(
      harness.appliedResetItems.map(
        item =>
          item.revision
      ),
      [
        8
      ],
      "the stale status response must not repaint or notify selected-date state"
    );
  }
);


test(
  "while reset is active only all-query and reset-cancel remain enabled",
  async () => {
    const harness =
      createQueryUiHarness({
        initialReset:
          activeResetItem()
      });

    await harness.settle();

    assert.equal(
      harness.byId(
        "morningMeetingAllQueryButton"
      ).disabled,
      false
    );

    assert.equal(
      harness.byId(
        "morningMeetingOperationsQueryButton"
      ).disabled,
      true
    );

    assert.equal(
      harness.byId(
        "morningMeetingWorkbookQueryButton"
      ).disabled,
      true
    );

    assert.equal(
      harness.byId(
        "efficiencyMorningMeetingAutoRetry-water"
      ).disabled,
      true
    );

    assert.equal(
      harness.byId(
        "efficiencyMorningMeetingAutoDailyPowerRefreshButton"
      ).disabled,
      true
    );

    const resetButton =
      harness.byId(
        "morningMeetingResetButton"
      );

    assert.equal(
      resetButton.disabled,
      false
    );

    assert.equal(
      resetButton.textContent,
      "초기화 취소"
    );

    assert.equal(
      resetButton.getAttribute(
        "aria-pressed"
      ),
      "true"
    );

    assert.ok(
      resetButton.classList.contains(
        "is-reset-active"
      )
    );
  }
);


test(
  "active reset forces both all-query sources and releases only after both succeed",
  async () => {
    const harness =
      createQueryUiHarness({
        initialReset:
          activeResetItem()
      });

    await harness.settle();
    harness.clearCalls();

    const result =
      await harness.api.query(
        "all",
        {
          userInitiated:
            true
        }
      );

    assert.equal(
      result.length,
      2
    );

    assert.deepEqual(
      harness.upstreamCalls,
      [
        {
          source:
            "operations",
          options: {
            userInitiated:
              true,
            targetDate:
              TARGET_DATE,
            forceRefresh:
              true
          }
        },
        {
          source:
            "workbook",
          options: {
            userInitiated:
              true,
            forceRefresh:
              true,
            querySource:
              "daily_data_excel"
          }
        }
      ]
    );

    assert.equal(
      harness.fetchCalls.length,
      2,
      "release is followed by one forced reset-status refresh"
    );

    assert.deepEqual(
      JSON.parse(
        harness.fetchCalls[0]
          .options
          .body
      ),
      {
        action:
          "release_morning_meeting_auto_history_reset",
        targetDate:
          TARGET_DATE,
        expectedRevision:
          8
      }
    );

    assert.match(
      harness.fetchCalls[1].url,
      /action=morning_meeting_auto_history_reset_status/
    );

    assert.deepEqual(
      harness.persistSmpCalls,
      [
        {
          date:
            TARGET_DATE,
          revision:
            9
        }
      ],
      "fresh D+1 SMP is persisted exactly once, after reset release commits"
    );

    assert.deepEqual(
      harness.historyRefreshCalls,
      [
        true
      ]
    );

    assert.deepEqual(
      harness.resetLifecycleCalls.map(
        item =>
          item.type ===
            "post"
            ? `${item.type}:${item.action}`
            : item.type
      ),
      [
        "post:release_morning_meeting_auto_history_reset",
        "persist-smp",
        "get-status",
        "refresh-history"
      ],
      "release commits before SMP flush, status refresh and history repaint"
    );

    assert.equal(
      harness.api.resetState(
        TARGET_DATE
      ).active,
      false
    );

    const partial =
      createQueryUiHarness({
        initialReset:
          activeResetItem(),
        operationsResult: [
          {
            status:
              "fulfilled",
            value: {
              status:
                "fulfilled",
              result: {
                complete:
                  true
              }
            }
          },
          {
            status:
              "rejected",
            reason:
              new Error(
                "Silo unavailable"
              )
          }
        ]
      });

    await partial.settle();
    partial.clearCalls();

    await partial.api.query(
      "all",
      {
        userInitiated:
          true
      }
    );

    assert.equal(
      partial.upstreamCalls.length,
      2,
      "the independent workbook source still runs"
    );

    assert.equal(
      partial.fetchCalls.length,
      0,
      "partial source completion must retain the reset instead of releasing it"
    );

    assert.equal(
      partial.api.resetState(
        TARGET_DATE
      ).active,
      true
    );

    assert.deepEqual(
      partial.persistSmpCalls,
      [],
      "an incomplete full query cannot flush deferred SMP"
    );

    const releaseFailed =
      createQueryUiHarness({
        initialReset:
          activeResetItem(),
        responseHook({
          call
        }) {
          if (
            call.options.method ===
              "POST" &&
            JSON.parse(
              call.options.body
            ).action ===
              "release_morning_meeting_auto_history_reset"
          ) {
            return createResponse(
              409,
              {
                ok:
                  false,
                message:
                  "release conflict",
                currentItem:
                  activeResetItem(
                    9
                  )
              }
            );
          }

          return null;
        }
      });

    await releaseFailed.settle();
    releaseFailed.clearCalls();

    await releaseFailed.api.query(
      "all",
      {
        userInitiated:
          true
      }
    );

    assert.deepEqual(
      releaseFailed.persistSmpCalls,
      [],
      "a failed release must not persist deferred SMP"
    );

    assert.deepEqual(
      releaseFailed.historyRefreshCalls,
      []
    );

    assert.equal(
      releaseFailed.api.resetState(
        TARGET_DATE
      ).active,
      true,
      "a release conflict keeps the reset cutoff and its deferred SMP intact"
    );
  }
);


test(
  "active reset release accepts the real forced limestone success signal but not an unverified undefined result",
  async () => {
    const actualSuccess =
      await runRealForcedLimestoneBulkLoader(
        "complete"
      );

    assert.equal(
      actualSuccess,
      true,
      "the bulk adapter must convert the real loader's undefined success into an explicit result"
    );

    const successfulResults =
      successfulOperations();

    successfulResults[1]
      .value.result =
      actualSuccess;

    const successful =
      createQueryUiHarness({
        initialReset:
          activeResetItem(),
        operationsResult:
          successfulResults
      });

    await successful.settle();
    successful.clearCalls();

    await successful.api.query(
      "all",
      {
        userInitiated:
          true
      }
    );

    assert.deepEqual(
      successful.fetchCalls
        .filter(
          call =>
            call.options.method ===
              "POST"
        )
        .map(
        call =>
          JSON.parse(
            call.options.body
          ).action
      ),
      [
        "release_morning_meeting_auto_history_reset"
      ]
    );

    const unverifiedResult =
      await runRealForcedLimestoneBulkLoader(
        "error"
      );

    assert.equal(
      unverifiedResult,
      undefined
    );

    const incompleteResults =
      successfulOperations();

    incompleteResults[1]
      .value.result =
      unverifiedResult;

    const incomplete =
      createQueryUiHarness({
        initialReset:
          activeResetItem(),
        operationsResult:
          incompleteResults
      });

    await incomplete.settle();
    incomplete.clearCalls();

    await incomplete.api.query(
      "all",
      {
        userInitiated:
          true
      }
    );

    assert.equal(
      incomplete.fetchCalls.length,
      0,
      "the reset must remain active until every forced operation has a verified success result"
    );

    assert.equal(
      incomplete.api.resetState(
        TARGET_DATE
      ).active,
      true
    );
  }
);


test(
  "all four real forced operation loaders produce verified success and never release on unverified failure",
  async () => {
    const realSuccesses = [];

    for (
      const source of [
        "water",
        "gear",
        "silo"
      ]
    ) {
      const loader =
        runRealOperationLoader(
          source
        );
      const result =
        await loader.promise;

      assert.equal(
        result.fresh,
        true,
        `${source} must return the newly applied result`
      );

      assert.equal(
        result.source,
        source
      );

      realSuccesses.push({
        source,
        result,
        statusComplete:
          false
      });
    }

    const limestoneSuccess =
      await runRealForcedLimestoneBulkLoader(
        "complete"
      );

    assert.equal(
      limestoneSuccess,
      true,
      "limestone must normalize its real undefined completion from a current complete status"
    );

    realSuccesses.splice(
      1,
      0,
      {
        source:
          "limestone",
        result:
          limestoneSuccess,
        statusComplete:
          true
      }
    );

    const verifiedOperationValues =
      await Promise.all(
        realSuccesses.map(
          item =>
            runRealForcedBulkItem(
              item.result,
              {
                key:
                  item.source,
                statusComplete:
                  item.statusComplete
              }
            )
        )
      );

    assert.deepEqual(
      plain(
        verifiedOperationValues.map(
          item => ({
            key:
              item.key,
            status:
              item.status,
            hasResult:
              item.result !==
                undefined &&
              item.result !==
                null
          })
        )
      ),
      [
        {
          key:
            "water",
          status:
            "fulfilled",
          hasResult:
            true
        },
        {
          key:
            "limestone",
          status:
            "fulfilled",
          hasResult:
            true
        },
        {
          key:
            "gear",
          status:
            "fulfilled",
          hasResult:
            true
        },
        {
          key:
            "silo",
          status:
            "fulfilled",
          hasResult:
            true
        }
      ]
    );

    const completeHarness =
      createQueryUiHarness({
        initialReset:
          activeResetItem(),
        operationsResult: [
          ...verifiedOperationValues.map(
            value => ({
              status:
                "fulfilled",
              value
            })
          ),
          ...successfulOperations()
            .slice(
              4
            )
        ]
      });

    await completeHarness.settle();
    completeHarness.clearCalls();

    await completeHarness.api.query(
      "all",
      {
        userInitiated:
          true
      }
    );

    assert.deepEqual(
      completeHarness.fetchCalls
        .filter(
          call =>
            call.options.method ===
              "POST"
        )
        .map(
        call =>
          JSON.parse(
            call.options.body
          ).action
      ),
      [
        "release_morning_meeting_auto_history_reset"
      ]
    );

    const failedLoaderResults = [];

    for (
      const source of [
        "water",
        "gear",
        "silo"
      ]
    ) {
      const failedLoader =
        runRealOperationLoader(
          source,
          {
            success:
              false
          }
        );

      failedLoaderResults.push({
        source,
        result:
          await failedLoader.promise
      });
    }

    failedLoaderResults.splice(
      1,
      0,
      {
        source:
          "limestone",
        result:
          await runRealForcedLimestoneBulkLoader(
            "error"
          )
      }
    );

    const rejectedOperationValues =
      await Promise.allSettled(
        failedLoaderResults.map(
          item =>
            runRealForcedBulkItem(
              item.result,
              {
                key:
                  item.source,
                statusComplete:
                  false
              }
            )
        )
      );

    assert.deepEqual(
      rejectedOperationValues.map(
        item =>
          item.status
      ),
      [
        "rejected",
        "rejected",
        "rejected",
        "rejected"
      ],
      "null or undefined without a current complete status must fail the forced operation"
    );

    const failedHarness =
      createQueryUiHarness({
        initialReset:
          activeResetItem(),
        operationsResult: [
          ...rejectedOperationValues,
          ...successfulOperations()
            .slice(
              4
            )
        ]
      });

    await failedHarness.settle();
    failedHarness.clearCalls();

    await failedHarness.api.query(
      "all",
      {
        userInitiated:
          true
      }
    );

    assert.equal(
      failedHarness.fetchCalls.length,
      0
    );

    assert.equal(
      failedHarness.api.resetState(
        TARGET_DATE
      ).active,
      true
    );
  }
);


test(
  "forced SMP and weather failures reject stale cache fallbacks and keep the active reset",
  async () => {
    const bulkItemsStart =
      scriptSource.indexOf(
        "function createBulkLookupItems("
      );
    const bulkItemsEnd =
      scriptSource.indexOf(
        "async function runBulkLookupItem(",
        bulkItemsStart
      );
    const bulkItemsSource =
      scriptSource.slice(
        bulkItemsStart,
        bulkItemsEnd
      );

    assert.match(
      bulkItemsSource,
      /const requireFresh\s*=\s*forceRefresh;/,
      "forced operations must require fresh SMP and weather responses"
    );

    assert.match(
      bulkItemsSource,
      /loadEfficiencyMorningMeetingSmpPrice[\s\S]*requireFresh/
    );

    assert.match(
      bulkItemsSource,
      /loadWeatherForBulk\([\s\S]*requireFresh/
    );

    const smpLegacy =
      runRealForcedSmpLoader({
        requireFresh:
          false
      });
    const weatherLegacy =
      runRealForcedWeatherLoader({
        requireFresh:
          false
      });

    assert.equal(
      await smpLegacy.promise,
      smpLegacy.staleItem,
      "ordinary refresh behavior may preserve its prior display value"
    );

    assert.equal(
      await weatherLegacy.promise,
      weatherLegacy.staleItem
    );

    const smpFresh =
      runRealForcedSmpLoader({
        responseOk:
          true
      });
    const weatherFresh =
      runRealForcedWeatherLoader({
        responseOk:
          true
      });

    assert.equal(
      (
        await smpFresh.promise
      ).fresh,
      true
    );

    assert.equal(
      (
        await weatherFresh.promise
      ).fresh,
      true
    );

    const forcedFailures =
      await Promise.allSettled([
        runRealForcedSmpLoader()
          .promise,
        runRealForcedWeatherLoader()
          .promise
      ]);

    assert.deepEqual(
      forcedFailures.map(
        result =>
          result.status
      ),
      [
        "rejected",
        "rejected"
      ],
      "a required fresh lookup must surface failure instead of returning the stale item"
    );

    const operationResults =
      successfulOperations();

    operationResults.splice(
      4,
      2,
      ...forcedFailures
    );

    const harness =
      createQueryUiHarness({
        initialReset:
          activeResetItem(),
        operationsResult:
          operationResults
      });

    await harness.settle();
    harness.clearCalls();

    await harness.api.query(
      "all",
      {
        userInitiated:
          true
      }
    );

    assert.equal(
      harness.fetchCalls.length,
      0,
      "stale SMP/weather must never count as fresh completion for reset release"
    );

    assert.equal(
      harness.api.resetState(
        TARGET_DATE
      ).active,
      true
    );
  }
);


async function runRealDeferredSmpPersistence() {
  const source =
    extractInstalledFunction(
      scriptSource,
      "(function installEfficiencyMorningMeetingSmpD1Save()"
    );
  const storageKey =
    "gs-shift-log:morning-meeting:smp-manual-overrides:v1";
  const nextDate =
    "2026-09-16";
  const oldStoredItem = {
    sourceDate:
      nextDate,
    targetDate:
      nextDate,
    maximum:
      114.02,
    minimum:
      90.43,
    weightedAverage:
      101.7,
    marker:
      "pre-reset local value"
  };
  const freshItem = {
    sourceDate:
      nextDate,
    targetDate:
      nextDate,
    maximum:
      161.59,
    minimum:
      90.09,
    weightedAverage:
      104.45,
    source:
      "EPSIS"
  };
  const storage =
    new Map([
      [
        storageKey,
        JSON.stringify({
          [nextDate]:
            oldStoredItem
        })
      ]
    ]);
  const storageWrites = [];
  const fetchCalls = [];
  const appliedResetItems = [];
  const listeners =
    new Map();
  let resetActive =
    true;
  let resetRevision =
    8;
  const uploadState = {
    smpPriceByDate: {
      [nextDate]: {
        ...freshItem
      }
    },
    smpPriceStatusByDate: {
      [nextDate]:
        "complete"
    },
    smpPriceErrorByDate: {
      [nextDate]:
        ""
    }
  };
  const document = {
    addEventListener(
      type,
      listener
    ) {
      listeners.set(
        type,
        listener
      );
    }
  };
  const window = {
    efficiencyMorningMeetingUploadState:
      uploadState,
    isMorningMeetingSelectedDateResetActive(
      date
    ) {
      return date ===
          TARGET_DATE &&
        resetActive;
    },
    morningMeetingQuerySources: {
      resetState(
        date
      ) {
        return {
          targetDate:
            date,
          active:
            resetActive,
          revision:
            resetRevision
        };
      },
      applyResetState(
        item
      ) {
        appliedResetItems.push(
          plain(
            item
          )
        );
        resetRevision =
          item.revision;

        return item;
      }
    },
    renderEfficiencyMorningMeetingSmpPrice() {},
    showToast() {}
  };
  const localStorage = {
    getItem(
      key
    ) {
      return storage.has(
        key
      )
        ? storage.get(
            key
          )
        : null;
    },
    setItem(
      key,
      value
    ) {
      storageWrites.push({
        key,
        value:
          String(
            value
          )
      });
      storage.set(
        key,
        String(
          value
        )
      );
    }
  };
  const context =
    vm.createContext({
      window,
      document,
      localStorage,
      Date,
      Map,
      Number,
      Promise,
      String,
      JSON,
      Array,
      console: {
        log() {},
        warn() {},
        error() {}
      },
      getShiftLogAuthHeaders(
        headers
      ) {
        return {
          ...headers,
          Authorization:
            "Bearer session-token"
        };
      },
      async fetch(
        url,
        options
      ) {
        fetchCalls.push({
          url:
            String(
              url
            ),
          options: {
            ...options
          }
        });

        return createResponse(
          200,
          {
            ok:
              true,
            item: {
              targetDate:
                TARGET_DATE,
              values: {
                smpMinimum:
                  freshItem.minimum,
                smpMaximum:
                  freshItem.maximum,
                smpWeightedAverage:
                  freshItem.weightedAverage
              },
              revision:
                10
            }
          }
        );
      }
    });

  vm.runInContext(
    source,
    context,
    {
      filename:
        "actual-deferred-smp-persistence.js"
    }
  );

  const storedBeforeEvent =
    storage.get(
      storageKey
    );

  listeners.get(
    "efficiencyMorningMeetingSmpPriceLoaded"
  )({
    detail: {
      ...freshItem
    }
  });

  await Promise.resolve();

  const activeResult = {
    fetchCalls:
      fetchCalls.length,
    storageWrites:
      storageWrites.length,
    storedValue:
      storage.get(
        storageKey
      ),
    memoryValue:
      uploadState.smpPriceByDate[
        nextDate
      ]
  };

  resetActive =
    false;
  resetRevision =
    9;

  const flushed =
    await window
      .persistEfficiencyMorningMeetingFreshSmpAfterReset(
        TARGET_DATE,
        9
      );
  const flushedAgain =
    await window
      .persistEfficiencyMorningMeetingFreshSmpAfterReset(
        TARGET_DATE,
        10
      );

  return {
    activeResult,
    storedBeforeEvent,
    oldStoredItem,
    freshItem,
    storageKey,
    storage,
    storageWrites,
    fetchCalls,
    appliedResetItems,
    flushed,
    flushedAgain
  };
}


test(
  "fresh D+1 SMP stays deferred during reset and persists once only after release",
  async () => {
    const harness =
      await runRealDeferredSmpPersistence();

    assert.equal(
      harness.activeResult.fetchCalls,
      0,
      "the reset-active loader event must not write the override API"
    );

    assert.equal(
      harness.activeResult.storageWrites,
      0,
      "the reset-active loader event must not overwrite the pre-reset local fallback"
    );

    assert.equal(
      harness.activeResult.storedValue,
      harness.storedBeforeEvent
    );

    assert.deepEqual(
      harness.activeResult.memoryValue,
      harness.freshItem,
      "the loader's fresh in-memory preview remains available for the release flush"
    );

    assert.equal(
      harness.flushed,
      true
    );

    assert.equal(
      harness.flushedAgain,
      false,
      "a committed deferred item is consumed and cannot be saved twice"
    );

    assert.equal(
      harness.fetchCalls.length,
      1
    );

    assert.equal(
      harness.fetchCalls[0].url,
      "/api/ois-data-requests?action=save_morning_meeting_auto_history_override"
    );

    assert.deepEqual(
      JSON.parse(
        harness.fetchCalls[0]
          .options
          .body
      ),
      {
        action:
          "save_morning_meeting_auto_history_override",
        targetDate:
          TARGET_DATE,
        expectedRevision:
          9,
        values: {
          smpMinimum:
            90.09,
          smpMaximum:
            161.59,
          smpWeightedAverage:
            104.45
        }
      }
    );

    const storedAfterFlush =
      JSON.parse(
        harness.storage.get(
          harness.storageKey
        )
      );

    assert.equal(
      storedAfterFlush[
        "2026-09-16"
      ].minimum,
      90.09
    );

    assert.equal(
      storedAfterFlush[
        "2026-09-16"
      ].marker,
      undefined,
      "the old local value is replaced only by the successful post-release flush"
    );

    assert.deepEqual(
      harness.appliedResetItems.map(
        item =>
          item.revision
      ),
      [
        10
      ]
    );
  }
);


test(
  "reset restore posts once and refreshes saved history only after the server succeeds",
  async () => {
    const restored =
      createQueryUiHarness({
        initialReset:
          activeResetItem()
      });

    await restored.settle();
    restored.clearCalls();

    await restored.api.toggleReset({
      userInitiated:
        true
    });

    assert.deepEqual(
      restored.confirmMessages,
      [
        `${TARGET_DATE} 자료 초기화를 취소하고 저장된 원본 조회값을 다시 표시하시겠습니까?`
      ]
    );

    assert.equal(
      restored.fetchCalls.length,
      1
    );

    assert.equal(
      JSON.parse(
        restored.fetchCalls[0]
          .options
          .body
      ).action,
      "restore_morning_meeting_auto_history_reset"
    );

    assert.deepEqual(
      restored.restoredDates,
      [
        TARGET_DATE
      ]
    );

    const failed =
      createQueryUiHarness({
        initialReset:
          activeResetItem(),
        responseHook({
          call
        }) {
          if (
            call.options.method ===
              "POST"
          ) {
            return createResponse(
              409,
              {
                ok:
                  false,
                message:
                  "다른 변경과 충돌했습니다.",
                currentItem:
                  activeResetItem(
                    9
                  )
              }
            );
          }

          return null;
        }
      });

    await failed.settle();
    failed.clearCalls();

    await failed.api.toggleReset({
      userInitiated:
        true
    });

    assert.equal(
      failed.fetchCalls.length,
      1
    );

    assert.equal(
      failed.restoredDates.length,
      0,
      "the screen must not expose old values after a failed restore"
    );

    assert.equal(
      failed.api.resetState(
        TARGET_DATE
      ).active,
      true
    );
  }
);


test(
  "restoring a history-row date does not refresh the different date shown on the main cards",
  async () => {
    const restoredOtherDate = {
      ...inactiveResetItem(
        9
      ),
      targetDate:
        OTHER_DATE,
      resetAt:
        "2026-09-16T04:00:00.000Z",
      restoredAt:
        "2026-09-16T04:10:00.000Z"
    };
    const harness =
      createQueryUiHarness({
        responseHook({
          call
        }) {
          if (
            call.options.method ===
              "POST"
          ) {
            return createResponse(
              200,
              {
                ok:
                  true,
                item:
                  restoredOtherDate
              }
            );
          }

          return null;
        }
      });

    await harness.settle();
    harness.clearCalls();

    const result =
      await harness.api.restoreReset(
        OTHER_DATE,
        {
          userInitiated:
            true,
          expectedRevision:
            8
        }
      );

    assert.deepEqual(
      plain(
        result
      ),
      restoredOtherDate
    );

    assert.deepEqual(
      harness.restoredDates,
      [],
      "main-card completed history belongs to the currently selected date only"
    );

    assert.equal(
      harness.fetchCalls.length,
      1
    );

    assert.equal(
      JSON.parse(
        harness.fetchCalls[0]
          .options.body
      ).targetDate,
      OTHER_DATE
    );

    assert.equal(
      harness.toastMessages.some(
        item =>
          item.type ===
            "error"
      ),
      false
    );
  }
);


function createAutoHistoryResetRestoreHarness({
  restoredItem = {
    ...inactiveResetItem(
      9
    ),
    resetAt:
      "2026-09-16T04:00:00.000Z",
    restoredAt:
      "2026-09-16T04:10:00.000Z"
  },
  refreshResult =
    true
} = {}) {
  const start =
    scriptSource.indexOf(
      "async function restoreMorningMeetingAutoHistoryReset("
    );
  const end =
    scriptSource.indexOf(
      "async function saveMorningMeetingAutoHistoryDrafts(",
      start
    );

  assert.ok(
    start >=
      0 &&
    end >
      start,
    "the actual automatic-history reset restore function must exist"
  );

  const cachedPayload = {
    completedPayload: {
      items: [],
      resets: [
        activeResetItem()
      ]
    }
  };
  const state = {
    month:
      "2026-09",
    loading:
      false,
    saving:
      false,
    editing:
      false,
    restoringDate:
      "",
    restoringResetDate:
      "",
    rows: [
      {
        date:
          TARGET_DATE,
        morningMeetingReset:
          activeResetItem()
      }
    ],
    cache:
      new Map([
        [
          "2026-09",
          cachedPayload
        ]
      ])
  };
  const restoreCalls = [];
  const refreshCalls = [];
  const applyCalls = [];
  const toastCalls = [];
  const renderCalls = [];

  const window = {
    morningMeetingQuerySources: {
      async restoreReset(
        date,
        options
      ) {
        restoreCalls.push({
          date,
          options:
            plain(
              options
            )
        });

        return restoredItem;
      }
    },
    applyMorningMeetingSelectedDateResetState(
      item
    ) {
      applyCalls.push(
        plain(
          item
        )
      );
    },
    showToast(
      ...args
    ) {
      toastCalls.push(
        args
      );
    }
  };

  const context =
    vm.createContext({
      window,
      state,
      Map,
      Number,
      normalizeText(value) {
        return String(
          value ??
          ""
        ).trim();
      },
      isIsoDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(
          value
        );
      },
      renderRows() {
        renderCalls.push(
          "rows"
        );
      },
      updateMonthControls() {
        renderCalls.push(
          "controls"
        );
      },
      async loadMonth(
        options
      ) {
        refreshCalls.push({
          options:
            plain(
              options
            ),
          cachePresentBeforeLoad:
            state.cache.has(
              state.month
            )
        });

        return refreshResult;
      },
      console: {
        error() {}
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    "\nglobalThis.__restoreReset = restoreMorningMeetingAutoHistoryReset;",
    context,
    {
      filename:
        "actual-auto-history-reset-restore.js"
    }
  );

  return {
    state,
    cachedPayload,
    restoreCalls,
    refreshCalls,
    applyCalls,
    toastCalls,
    renderCalls,
    restore:
      context.__restoreReset
  };
}


function runRealMorningMeetingCreateButtonGuard(
  resetActive
) {
  const start =
    scriptSource.indexOf(
      "function updateMorningMeetingCreateButton()"
    );
  const end =
    scriptSource.indexOf(
      "window.updateEfficiencyMorningMeetingCreateButton =",
      start
    );

  assert.ok(
    start >=
      0 &&
    end >
      start,
    "the actual final workbook button guard must exist"
  );

  const createButton = {
    disabled:
      false
  };
  const message = {
    textContent:
      ""
  };
  const state = {
    templateFile: {},
    analysis: {
      safety: {},
      environment: {},
      mechanical: {},
      electrical: {}
    },
    shiftPart: {
      reportDate:
        TARGET_DATE,
      text:
        "교대 내용"
    },
    coalSelection: {
      selectedItems: []
    }
  };
  const context =
    vm.createContext({
      window: {
        isMorningMeetingSelectedDateResetActive() {
          return resetActive;
        }
      },
      document: {
        getElementById() {
          return null;
        }
      },
      Date,
      Number,
      String,
      Object,
      Array,
      TEAM_ORDER: [
        "safety",
        "environment",
        "mechanical",
        "electrical"
      ],
      getMorningMeetingWorkbookElements() {
        return {
          createButton,
          message
        };
      },
      getMorningMeetingWorkbookState() {
        return state;
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    "\nupdateMorningMeetingCreateButton();",
    context,
    {
      filename:
        "actual-final-workbook-button-guard.js"
    }
  );

  return {
    createButton,
    message,
    state
  };
}


async function runRealMorningMeetingWorkbookResetDefense({
  resetSequence = [
    true
  ]
} = {}) {
  const start =
    scriptSource.indexOf(
      "async function createMorningMeetingWorkbook()"
    );
  const end =
    scriptSource.indexOf(
      "/* =====================================================\n    기준 취합본 드래그 앤 드롭",
      start
    );

  assert.ok(
    start >=
      0 &&
    end >
      start,
    "the actual final workbook creation path must exist"
  );

  const templateFile = {
    name:
      "daily-template.xlsx",
    async arrayBuffer() {
      return new ArrayBuffer(
        8
      );
    }
  };
  const boilerTemperatures = {
    reportDate:
      TARGET_DATE,
    unitOne: {
      fbheLeft:
        701
    }
  };
  const otherDateWater = {
    sourceDate:
      OTHER_DATE,
    rawWaterInflow:
      6818
  };
  const state = {
    templateFile,
    shiftPart: {
      reportDate:
        TARGET_DATE,
      text:
        "교대파트 유지"
    },
    analysis: {
      safety: {
        reportDate:
          TARGET_DATE
      },
      environment: {
        reportDate:
          TARGET_DATE
      },
      mechanical: {
        reportDate:
          TARGET_DATE
      },
      electrical: {
        reportDate:
          TARGET_DATE
      }
    },
    coalSelection: {
      selectedItems: [],
      selectedTmItems: [],
      values: {
        staleCoalValue:
          999
      }
    },
    waterTreatment: {
      sourceDate:
        TARGET_DATE,
      rawWaterInflow:
        7888,
      stale:
        true
    },
    waterByDate: {
      [OTHER_DATE]:
        otherDateWater
    },
    boilerTemperatures,
    gearPinion: {
      sourceDate:
        TARGET_DATE,
      gearWheel:
        0.76,
      pinion:
        1.94,
      stale:
        true
    },
    siloLevel: {
      sourceDate:
        TARGET_DATE,
      flyAshSiloLevel:
        628.18,
      stale:
        true
    },
    steamStatus: {
      sourceDate:
        TARGET_DATE,
      generatorEcmsGen1:
        4056621.4,
      solarDailyGeneration:
        538.7,
      stale:
        true
    },
    smpPriceMeetingDate:
      "2026-09-16",
    smpPriceMeeting: {
      minimum:
        90.09,
      stale:
        true
    },
    morningWeatherDate:
      "2026-09-16",
    morningWeather: {
      condition:
        "맑음",
      stale:
        true
    }
  };
  const limestoneValues = {
    date:
      TARGET_DATE,
    unitOneUsage:
      35.7,
    stale:
      true
  };
  const createButton = {
    disabled:
      false,
    textContent:
      "최종 엑셀 만들기"
  };
  const message = {
    textContent:
      "",
    isConnected:
      false
  };
  const worksheetDocument = {
    kind:
      "worksheet"
  };
  const sharedStrings = [];
  const worksheetFile = {
    async async() {
      return "<worksheet/>";
    }
  };
  const sharedStringsFile = {
    async async() {
      return "<sst/>";
    }
  };
  const zipWrites = [];
  const zip = {
    file(
      path,
      value
    ) {
      if (
        arguments.length >
          1
      ) {
        zipWrites.push({
          path,
          value
        });

        return this;
      }

      return path ===
        "xl/sharedStrings.xml"
        ? sharedStringsFile
        : worksheetFile;
    },
    async generateAsync() {
      return {
        kind:
          "blob"
      };
    }
  };
  const calls = {
    resetDates: [],
    daily: [],
    coal: [],
    water: [],
    boiler: [],
    gear: [],
    limestone: [],
    preview: [],
    cofiring: [],
    clearedCells: [],
    downloads: [],
    errors: [],
    updateButton:
      0
  };
  let resetSequenceIndex =
    0;
  const deltaResult = {
    delta:
      0
  };
  const record =
    key =>
      (...args) => {
        calls[key].push(
          args
        );

        return key ===
          "preview"
          ? {
              applied:
                true
            }
          : {};
      };
  const window = {
    isMorningMeetingSelectedDateResetActive(
      date
    ) {
      calls.resetDates.push(
        date
      );

      const sequenceValue =
        resetSequence[
          Math.min(
            resetSequenceIndex,
            resetSequence.length -
              1
          )
        ];

      resetSequenceIndex +=
        1;

      return date ===
          TARGET_DATE &&
        Boolean(
          sequenceValue
        );
    },
    getEfficiencyMorningMeetingWeekendMode() {
      return {
        enabled:
          false
      };
    },
    async prepareMorningMeetingOutputFolderPermission() {},
    applyMorningMeetingCofiringExcelValues:
      record(
        "cofiring"
      ),
    confirm() {
      throw new Error(
        "reset-active export must not ask to reuse missing automatic values"
      );
    },
    setTimeout(
      callback
    ) {
      callback();

      return 1;
    }
  };
  const context =
    vm.createContext({
      window,
      document: {
        createElement() {
          return {};
        }
      },
      JSZip: {
        async loadAsync() {
          return zip;
        }
      },
      XMLSerializer: class {
        serializeToString() {
          return "<worksheet serialized='true'/>";
        }
      },
      MORNING_MEETING_DYNAMIC_TEAM_CONFIG: [
        {
          key:
            "safety"
        },
        {
          key:
            "environment"
        },
        {
          key:
            "mechanical"
        },
        {
          key:
            "electrical"
        }
      ],
      Set,
      Array,
      Date,
      Error,
      console: {
        log() {},
        warn() {},
        error(
          ...args
        ) {
          calls.errors.push(
            args
          );
        }
      },
      getMorningMeetingWorkbookElements() {
        return {
          createButton,
          message
        };
      },
      getMorningMeetingWorkbookState() {
        return state;
      },
      hideMorningMeetingWorkbookError() {},
      synchronizeMorningMeetingPreviewText() {},
      getMorningMeetingLimestoneWorkbookValues() {
        return limestoneValues;
      },
      showMorningMeetingWorkbookError(
        messageValue
      ) {
        calls.errors.push([
          messageValue
        ]);
      },
      parseMorningMeetingReportDate(
        value
      ) {
        const normalized =
          String(
            value
          ).replace(
            /[./]/g,
            "-"
          );

        return new Date(
          `${normalized}T00:00:00.000Z`
        );
      },
      addMorningMeetingDateDays(
        date,
        amount
      ) {
        const copy =
          new Date(
            date.getTime()
          );

        copy.setUTCDate(
          copy.getUTCDate() +
            amount
        );

        return copy;
      },
      async findMorningMeetingWorksheetPath() {
        return "xl/worksheets/sheet1.xml";
      },
      parseMorningMeetingSharedStrings() {
        return sharedStrings;
      },
      parseMorningMeetingXml() {
        return worksheetDocument;
      },
      captureMorningMeetingWeekendReferenceLayout() {
        return {};
      },
      normalizeMorningMeetingTemplateToWeekdayLayout() {
        return {
          normalized:
            false
        };
      },
      applyMorningMeetingIJKDashMerges() {
        return {};
      },
      applyMorningMeetingDailyDataValues:
        record(
          "daily"
        ),
      applyMorningMeetingCoalNumericValues:
        record(
          "coal"
        ),
      applyMorningMeetingWaterTreatmentValues:
        record(
          "water"
        ),
      applyMorningMeetingBoilerTemperatureValues:
        record(
          "boiler"
        ),
      applyMorningMeetingGearPinionValues:
        record(
          "gear"
        ),
      applyMorningMeetingLimestoneValues:
        record(
          "limestone"
        ),
      replaceMorningMeetingShiftPartArea() {
        return deltaResult;
      },
      replaceMorningMeetingFuelArea() {
        return deltaResult;
      },
      inspectMorningMeetingDynamicLayout() {
        return {};
      },
      buildMorningMeetingDynamicRows() {
        return {};
      },
      replaceMorningMeetingDynamicTeamArea() {
        return deltaResult;
      },
      replaceMorningMeetingTmArea() {
        return deltaResult;
      },
      finalizeMorningMeetingWeekdayOperationArea() {
        return {};
      },
      cleanupMorningMeetingOutOfPrintResidue() {
        return {};
      },
      applyMorningMeetingWeekendSupplementTables() {
        return {};
      },
      restoreMorningMeetingWeekendReferenceLayout() {
        return {};
      },
      applyMorningMeetingPreviewAutoValues:
        record(
          "preview"
        ),
      setMorningMeetingNumericCellValue(
        _document,
        address,
        value
      ) {
        calls.clearedCells.push({
          address,
          value
        });
      },
      async applyMorningMeetingManualInputCellFills() {
        return {};
      },
      async updateMorningMeetingWorkbookPrintArea() {},
      async forceMorningMeetingWorkbookRecalculation() {},
      formatMorningMeetingFileDate(
        date
      ) {
        return `${String(
          date.getUTCMonth() +
            1
        ).padStart(
          2,
          "0"
        )}.${String(
          date.getUTCDate()
        ).padStart(
          2,
          "0"
        )}`;
      },
      async downloadMorningMeetingWorkbook(
        blob,
        fileName
      ) {
        calls.downloads.push({
          blob,
          fileName
        });

        return {
          fileName,
          method:
            "download"
        };
      },
      updateMorningMeetingCreateButton() {
        calls.updateButton +=
          1;
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    "\nglobalThis.__creation = createMorningMeetingWorkbook();",
    context,
    {
      filename:
        "actual-final-workbook-reset-defense.js"
    }
  );

  await context.__creation;

  return {
    calls,
    state,
    templateFile,
    boilerTemperatures,
    otherDateWater,
    limestoneValues,
    worksheetDocument,
    zipWrites
  };
}


test(
  "automatic-history reset cancel discards the filtered month cache and force-refetches completed history",
  async () => {
    const harness =
      createAutoHistoryResetRestoreHarness();

    const result =
      await harness.restore(
        TARGET_DATE
      );

    assert.equal(
      result.active,
      false
    );

    assert.deepEqual(
      harness.restoreCalls,
      [
        {
          date:
            TARGET_DATE,
          options: {
            userInitiated:
              true,
            expectedRevision:
              8
          }
        }
      ]
    );

    assert.equal(
      harness.state.cache.has(
        "2026-09"
      ),
      false,
      "the payload that hid pre-reset source rows must not be rendered again"
    );

    assert.deepEqual(
      harness.refreshCalls,
      [
        {
          options: {
            forceRefresh:
              true
          },
          cachePresentBeforeLoad:
            false
        }
      ]
    );

    assert.equal(
      harness.applyCalls.length,
      1
    );

    const rejected =
      createAutoHistoryResetRestoreHarness({
        restoredItem:
          null
      });

    assert.equal(
      await rejected.restore(
        TARGET_DATE
      ),
      null
    );

    assert.equal(
      rejected.state.cache.has(
        "2026-09"
      ),
      true,
      "a failed server restore must keep the current filtered view"
    );

    assert.equal(
      rejected.refreshCalls.length,
      0
    );
  }
);


test(
  "final workbook button is disabled while the selected automatic date reset is active",
  () => {
    const ready =
      runRealMorningMeetingCreateButtonGuard(
        false
      );

    assert.equal(
      ready.createButton.disabled,
      false,
      "the fixture otherwise meets the final workbook prerequisites"
    );

    const reset =
      runRealMorningMeetingCreateButtonGuard(
        true
      );

    assert.equal(
      reset.createButton.disabled,
      true
    );

    assert.equal(
      reset.message.textContent,
      "선택 날짜가 전체 초기화 상태입니다. 전체자료를 다시 조회하거나 초기화 취소 후 생성해 주세요."
    );
  }
);


test(
  "direct final workbook creation masks every reset-scoped stale value while preserving unrelated inputs",
  async () => {
    const harness =
      await runRealMorningMeetingWorkbookResetDefense();
    const {
      calls
    } =
      harness;

    assert.equal(
      calls.errors.length,
      0,
      calls.errors
        .map(
          item =>
            item.join(
              " "
            )
        )
        .join(
          "\n"
        )
    );

    assert.equal(
      calls.downloads.length,
      1,
      "the direct path must still create a workbook with intentional blanks"
    );

    assert.deepEqual(
      plain(
        calls.daily[0][1]
      ),
      {},
      "power, solar, steam and organic workbook values are cleared"
    );

    assert.equal(
      calls.coal[0][2]
        .suppressAutomaticSilo,
      true
    );

    assert.equal(
      calls.water[0][1],
      null
    );

    assert.equal(
      calls.water[0][2]
        .suppressCurrentDate,
      true
    );

    assert.equal(
      calls.gear[0][1],
      null
    );

    assert.equal(
      calls.limestone[0][1],
      null
    );

    assert.equal(
      calls.preview[0][1]
        .suppressSelectedDateValues,
      true,
      "D+1 SMP and weather are suppressed"
    );

    assert.equal(
      calls.boiler[0][1],
      harness.boilerTemperatures,
      "boiler temperatures are outside selected-date reset scope"
    );

    assert.deepEqual(
      calls.clearedCells,
      [
        "I7",
        "I8",
        "N7",
        "N8",
        "X7",
        "X8",
        "Z7",
        "Z8",
        "AE7",
        "AE8",
        "X9",
        "AE9"
      ].map(
        address => ({
          address,
          value:
            null
        })
      ),
      "all 12 direct co-firing cells are blanked after the external writer"
    );

    assert.equal(
      calls.cofiring.length,
      1
    );

    assert.ok(
      calls.resetDates.length >=
        1,
      "the direct path checks reset state even when invoked programmatically"
    );

    assert.ok(
      calls.resetDates.every(
        date =>
          date ===
            TARGET_DATE
      )
    );

    assert.equal(
      harness.state.templateFile,
      harness.templateFile,
      "the uploaded workbook remains the output template"
    );

    assert.equal(
      harness.state.waterByDate[
        OTHER_DATE
      ],
      harness.otherDateWater,
      "another date's cached water result is not modified"
    );

    const raced =
      await runRealMorningMeetingWorkbookResetDefense({
        resetSequence: [
          false,
          false,
          true
        ]
      });

    assert.equal(
      raced.calls.errors.length,
      0
    );

    assert.ok(
      raced.calls.resetDates.length >=
        3,
      "creation rechecks reset state after its initial eligibility checks"
    );

    assert.deepEqual(
      plain(
        raced.calls.daily[0][1]
      ),
      {},
      "a reset that begins during creation still blanks daily automatic values"
    );

    assert.equal(
      raced.calls.water[0][2]
        .suppressCurrentDate,
      true,
      "the water writer receives an explicit current-date suppression guard"
    );

    assert.equal(
      raced.calls.gear[0][1],
      null
    );

    assert.equal(
      raced.calls.limestone[0][1],
      null
    );

    assert.equal(
      raced.calls.preview[0][1]
        .suppressSelectedDateValues,
      true,
      "a mid-creation reset also suppresses D+1 SMP and weather"
    );

    assert.equal(
      raced.calls.downloads.length,
      1
    );
  }
);


function extractInstalledFunction(
  source,
  marker
) {
  const start =
    source.indexOf(
      marker
    );

  const end =
    source.indexOf(
      "\n})();",
      start
    );

  assert.ok(
    start >=
      0 &&
    end >
      start,
    `${marker} source must exist`
  );

  return source.slice(
    start,
    end +
      "\n})();".length
  );
}


function createSelectedDateStateHarness() {
  const source =
    extractInstalledFunction(
      scriptSource,
      "(function installMorningMeetingSelectedDateResetState()"
    );

  const document =
    new Element(
      "body"
    );

  document.getElementById =
    id =>
      document.querySelector(
        `#${id}`
      );

  const panel =
    new Element();

  panel.id =
    "efficiencyMorningMeetingWaterPanel";

  panel.dataset.morningMeetingAutoBaseDate =
    TARGET_DATE;

  panel.dataset.waterStatus =
    "complete";

  panel.dataset.gearPinionStatus =
    "complete";

  panel.dataset.siloLevelStatus =
    "complete";

  panel.dataset.steamStatusStatus =
    "complete";

  document.append(
    panel
  );

  const cofiringStatus =
    new Element();

  cofiringStatus.id =
    "efficiencyMorningMeetingCofiringStatus";

  cofiringStatus.className =
    "is-complete";

  cofiringStatus.textContent =
    "조회 완료";

  document.append(
    cofiringStatus
  );

  const events = [];

  document.dispatchEvent =
    event => {
      events.push(
        event
      );

      return true;
    };

  const storage =
    new Map();

  storage.set(
    "gsShiftLog.morningMeetingAutoDataCache.v1",
    JSON.stringify({
      water: {
        [TARGET_DATE]: {
          rawWaterInflow:
            7888
        },
        [OTHER_DATE]: {
          rawWaterInflow:
            6818
        }
      },
      gearPinion: {
        [TARGET_DATE]: {
          gearWheel:
            0.76
        },
        [OTHER_DATE]: {
          gearWheel:
            0.75
        }
      },
      untouched: {
        keep:
          true
      }
    })
  );

  const renderCalls = [];

  const state = {
    waterTreatment: {
      sourceDate:
        TARGET_DATE,
      rawWaterInflow:
        7888
    },
    gearPinion: {
      sourceDate:
        TARGET_DATE,
      gearWheel:
        0.76
    },
    siloLevel: {
      sourceDate:
        TARGET_DATE,
      flyAshSiloLevel:
        628.18
    },
    steamStatus: {
      sourceDate:
        TARGET_DATE,
      generatorEcmsGen1:
        4056621.4
    },
    smpPriceMeetingDate:
      "2026-09-16",
    smpPriceMeeting: {
      minimum:
        90.09
    },
    smpPrice: {
      minimum:
        90.09
    },
    smpPriceLoadingDate:
      "2026-09-16",
    smpPriceError:
      "old error",
    smpPriceErrorDate:
      "2026-09-16",
    morningWeatherDate:
      "2026-09-16",
    morningWeather: {
      condition:
        "맑음"
    },
    morningWeatherError:
      "old weather error"
  };

  const window = {
    efficiencyMorningMeetingUploadState:
      state,
    renderEfficiencyMorningMeetingAutoPreview() {
      renderCalls.push(
        "auto"
      );
    },
    renderEfficiencyMorningMeetingSiloLevelPreview() {
      renderCalls.push(
        "silo"
      );
    },
    renderEfficiencyMorningMeetingDailyData() {
      renderCalls.push(
        "daily"
      );
    },
    renderEfficiencyMorningMeetingSmpPrice() {
      renderCalls.push(
        "smp"
      );
    },
    renderEfficiencyMorningMeetingWeather() {
      renderCalls.push(
        "weather"
      );
    },
    updateEfficiencyMorningMeetingCreateButton() {
      renderCalls.push(
        "create"
      );
    },
    morningMeetingQuerySources: {
      render() {
        renderCalls.push(
          "toolbar"
        );
      }
    }
  };

  const localStorage = {
    getItem(
      key
    ) {
      return storage.get(
        key
      ) ??
        null;
    },
    setItem(
      key,
      value
    ) {
      storage.set(
        key,
        String(
          value
        )
      );
    }
  };

  const context =
    vm.createContext({
      window,
      document,
      localStorage,
      Date,
      Map,
      console: {
        warn() {},
        error() {}
      },
      CustomEvent: class {
        constructor(
          type,
          options = {}
        ) {
          this.type =
            type;

          this.detail =
            options.detail;
        }
      }
    });

  vm.runInContext(
    source,
    context,
    {
      filename:
        "selected-date-reset-state.js"
    }
  );

  return {
    window,
    document,
    panel,
    cofiringStatus,
    storage,
    state,
    renderCalls,
    events
  };
}


test(
  "selected-date reset clears only matching browser caches and next-day SMP/weather presentation",
  () => {
    const harness =
      createSelectedDateStateHarness();

    const item =
      activeResetItem();

    const applied =
      harness.window
        .applyMorningMeetingSelectedDateResetState(
          item
        );

    assert.deepEqual(
      plain(
        applied
      ),
      item
    );

    assert.equal(
      harness.window
        .isMorningMeetingSelectedDateResetActive(
          TARGET_DATE
        ),
      true
    );

    assert.deepEqual(
      plain(
        harness.state
          .morningMeetingResetByDate[
            TARGET_DATE
          ]
      ),
      item
    );

    const savedCache =
      JSON.parse(
        harness.storage.get(
          "gsShiftLog.morningMeetingAutoDataCache.v1"
        )
      );

    assert.equal(
      Object.hasOwn(
        savedCache.water,
        TARGET_DATE
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        savedCache.gearPinion,
        TARGET_DATE
      ),
      false
    );

    assert.equal(
      savedCache.water[
        OTHER_DATE
      ].rawWaterInflow,
      6818
    );

    assert.equal(
      savedCache.gearPinion[
        OTHER_DATE
      ].gearWheel,
      0.75
    );

    assert.deepEqual(
      savedCache.untouched,
      {
        keep:
          true
      }
    );

    for (
      const key of [
        "waterStatus",
        "gearPinionStatus",
        "siloLevelStatus",
        "steamStatusStatus"
      ]
    ) {
      assert.equal(
        harness.panel.dataset[
          key
        ],
        "idle",
        key
      );
    }

    assert.equal(
      harness.state.smpPriceMeeting,
      null
    );

    assert.equal(
      harness.state.smpPrice,
      null
    );

    assert.equal(
      harness.state.morningWeather,
      null
    );

    assert.equal(
      harness.cofiringStatus.textContent,
      "조회 대기"
    );

    assert.ok(
      harness.renderCalls.includes(
        "auto"
      )
    );

    assert.ok(
      harness.renderCalls.includes(
        "toolbar"
      )
    );

    assert.equal(
      harness.events.at(
        -1
      ).type,
      "morningMeetingSelectedDateResetStateChanged"
    );
  }
);


test(
  "a reset marker for another date records metadata without clearing the selected date",
  () => {
    const harness =
      createSelectedDateStateHarness();

    const otherItem = {
      ...activeResetItem(),
      targetDate:
        OTHER_DATE
    };

    harness.window
      .applyMorningMeetingSelectedDateResetState(
        otherItem
      );

    const savedCache =
      JSON.parse(
        harness.storage.get(
          "gsShiftLog.morningMeetingAutoDataCache.v1"
        )
      );

    assert.equal(
      savedCache.water[
        TARGET_DATE
      ].rawWaterInflow,
      7888
    );

    assert.equal(
      savedCache.water[
        OTHER_DATE
      ].rawWaterInflow,
      6818
    );

    assert.deepEqual(
      harness.state.smpPriceMeeting,
      {
        minimum:
          90.09
      }
    );

    assert.deepEqual(
      harness.state.morningWeather,
      {
        condition:
          "맑음"
      }
    );

    assert.equal(
      harness.renderCalls.length,
      0
    );

    assert.equal(
      harness.window
        .isMorningMeetingSelectedDateResetActive(
          OTHER_DATE
        ),
      true
    );
  }
);


test(
  "late lower or same-revision conflicting history markers cannot deactivate or repaint newer reset state",
  () => {
    const harness =
      createSelectedDateStateHarness();
    const currentItem =
      activeResetItem(
        9
      );

    harness.window
      .applyMorningMeetingSelectedDateResetState(
        currentItem
      );

    const renderCount =
      harness.renderCalls.length;
    const eventCount =
      harness.events.length;

    const sameRevisionRetained =
      harness.window
        .applyMorningMeetingSelectedDateResetState(
          inactiveResetItem(
            9
          )
        );

    assert.deepEqual(
      plain(
        sameRevisionRetained
      ),
      currentItem,
      "the same revision cannot carry a contradictory active flag"
    );

    const retained =
      harness.window
        .applyMorningMeetingSelectedDateResetState(
          inactiveResetItem(
            8
          )
        );

    assert.deepEqual(
      plain(
        retained
      ),
      currentItem
    );

    assert.deepEqual(
      plain(
        harness.window
          .getMorningMeetingSelectedDateResetState(
            TARGET_DATE
          )
      ),
      currentItem
    );

    assert.equal(
      harness.window
        .isMorningMeetingSelectedDateResetActive(
          TARGET_DATE
        ),
      true
    );

    assert.equal(
      harness.renderCalls.length,
      renderCount,
      "ignored history must not repaint stale source values"
    );

    assert.equal(
      harness.events.length,
      eventCount,
      "ignored history must not emit a misleading state change"
    );

    assert.equal(
      harness.state
        .morningMeetingResetByDate[
          TARGET_DATE
        ].revision,
      9
    );
  }
);


function createAutoHistoryMergeSavedRows(
  knownResetItem
) {
  const start =
    scriptSource.indexOf(
      "const MORNING_MEETING_AUTO_HISTORY_OVERRIDE_TARGETS ="
    );
  const end =
    scriptSource.indexOf(
      "/* =====================================================\n  수처리 표시값",
      start
    );

  assert.ok(
    start >=
      0 &&
    end >
      start,
    "the actual automatic-history merge implementation must exist"
  );

  const context =
    vm.createContext({
      window: {
        efficiencyMorningMeetingUploadState: {
          morningMeetingResetByDate: {
            [knownResetItem.targetDate]: {
              ...knownResetItem
            }
          }
        }
      },
      Map,
      console: {
        warn() {}
      },
      normalizeText(value) {
        return String(
          value ??
          ""
        ).trim();
      },
      isIsoDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(
          value
        );
      },
      getMonthRange() {
        return {
          startDate:
            "2026-09-01",
          endDate:
            "2026-09-30"
        };
      },
      numberOrNull(value) {
        if (
          value ===
            null ||
          value ===
            undefined ||
          value ===
            ""
        ) {
          return null;
        }

        const number =
          Number(
            value
          );

        return Number.isFinite(
          number
        )
          ? number
          : null;
      },
      addDateDays(
        value
      ) {
        return value ===
          TARGET_DATE
          ? "2026-09-16"
          : "";
      },
      readLocalSmpByDate() {
        return new Map([
          [
            "2026-09-16",
            {
              minimum:
                90.09
            }
          ]
        ]);
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    "\nglobalThis.__mergeSavedRows = mergeSavedRows;",
    context,
    {
      filename:
        "actual-auto-history-merge.js"
    }
  );

  return context
    .__mergeSavedRows;
}


test(
  "automatic-history merge prefers a newer local active reset over a stale unfiltered completed-history payload",
  () => {
    const knownReset =
      activeResetItem(
        9
      );
    const mergeSavedRows =
      createAutoHistoryMergeSavedRows(
        knownReset
      );

    const rows =
      mergeSavedRows(
        {
          completedPayload: {
            resets: [
              inactiveResetItem(
                8
              )
            ],
            items: [
              {
                targetDate:
                  TARGET_DATE,
                requestType:
                  "water_environment",
                status:
                  "complete",
                result: {
                  rawWaterInflow:
                    7888
                }
              },
              {
                targetDate:
                  TARGET_DATE,
                requestType:
                  "daily_data_excel",
                status:
                  "complete",
                result: {
                  generatorEcmsGen1:
                    4056621.4
                }
              }
            ],
            overrides: [
              {
                targetDate:
                  TARGET_DATE,
                revision:
                  8,
                values: {
                  waterRawWaterInflow:
                    9000
                }
              }
            ]
          },
          limestonePayload: {
            items: [
              {
                usageDate:
                  TARGET_DATE,
                status:
                  "complete",
                unitOneUsage:
                  35.7
              }
            ]
          },
          weatherPayload: {
            items: [
              {
                forecastDate:
                  "2026-09-16",
                condition:
                  "맑음"
              }
            ]
          }
        },
        "2026-09"
      );

    assert.equal(
      rows.length,
      1
    );

    const row =
      plain(
        rows[0]
      );

    assert.equal(
      row.morningMeetingReset.active,
      true
    );

    assert.equal(
      row.morningMeetingReset.revision,
      9
    );

    assert.equal(
      row.water,
      null
    );

    assert.equal(
      row.limestone,
      null
    );

    assert.equal(
      row.dailyData,
      null
    );

    assert.equal(
      row.smp,
      null
    );

    assert.equal(
      row.weather,
      null
    );

    assert.equal(
      row.override,
      null
    );
  }
);


test(
  "reset UI, completed-history integration, styling and cache keys ship together",
  () => {
    for (
      const action of [
        "reset_morning_meeting_auto_history",
        "restore_morning_meeting_auto_history_reset",
        "release_morning_meeting_auto_history_reset"
      ]
    ) {
      assert.ok(
        apiSource.includes(
          action
        ),
        `backend action is missing: ${action}`
      );

      assert.ok(
        querySource.includes(
          action
        ),
        `toolbar action is missing: ${action}`
      );
    }

    assert.match(
      querySource,
      /morningMeetingResetButton/
    );

    assert.match(
      queryStyleSource,
      /\.morning-meeting-workbook-query__button\.is-danger/
    );

    assert.match(
      queryStyleSource,
      /\.is-danger\.is-reset-active/
    );

    assert.match(
      scriptSource,
      /installMorningMeetingSelectedDateResetState/
    );

    const historyStart =
      scriptSource.indexOf(
        "async function restoreMorningMeetingSavedCompletedHistoryForDate("
      );
    const historyEnd =
      scriptSource.indexOf(
        "const overrideItems =",
        historyStart
      );
    const historyResetRead =
      scriptSource.indexOf(
        "payload.resets",
        historyStart
      );
    const historyActiveReturn =
      scriptSource.indexOf(
        "resetItem?.active",
        historyStart
      );

    assert.ok(
      historyStart >=
        0 &&
      historyResetRead >
        historyStart &&
      historyActiveReturn >
        historyResetRead &&
      historyEnd >
        historyActiveReturn,
      "completed history must apply the reset marker and stop before restoring hidden override values"
    );

    const mainVersion =
      indexSource.match(
        /src="script\.js\?v=([^"\s]+)"/
      )?.[1];
    const queryScriptVersion =
      indexSource.match(
        /morning-meeting-query-sources\.js\?v=([^"\s]+)"/
      )?.[1];
    const queryStyleVersion =
      indexSource.match(
        /morning-meeting-query-sources\.css\?v=([^"\s]+)"/
      )?.[1];

    assert.ok(
      mainVersion
    );

    assert.equal(
      queryScriptVersion,
      mainVersion
    );

    assert.equal(
      queryStyleVersion,
      mainVersion
    );

    assert.match(
      mainVersion,
      /selected-date-reset-v1/
    );
  }
);
