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
  onRequestPost,
  __oisDataRequestsTest
} from "../functions/api/ois-data-requests.js";


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


const styleSource =
  readFileSync(
    new URL(
      "../style.css",
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


const BLANK_FIELDS = [
  "waterRawWaterInflow",
  "waterDemiProduction",
  "waterPureWaterUsage",
  "limestoneUnitOneUsage",
  "limestoneUnitTwoUsage",
  "gearWheel",
  "pinion",
  "flyAshSiloLevel",
  "bioStorageSiloLevel",
  "steamSales",
  "steamProduction",
  "powerProduction",
  "powerSales",
  "organicReceivedAmount",
  "organicStoredAmount"
];


const PRESERVED_VALUES = {
  smpMinimum:
    90.09,
  smpMaximum:
    161.59,
  smpWeightedAverage:
    104.45,
  powerSolar:
    538.7,
  powerSolarMonthly:
    6049.7,
  powerSolarYearly:
    97523.4,
  organicTruckCount:
    4
};


function createD1Database() {
  const sqlite =
    new DatabaseSync(
      ":memory:"
    );

  let beforeRestoreUpdate =
    null;

  const database = {
    prepare(sql) {
      return {
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
            beforeRestoreUpdate &&
            /UPDATE\s+morning_meeting_auto_history_overrides/i.test(
              sql
            )
          ) {
            const callback =
              beforeRestoreUpdate;

            beforeRestoreUpdate =
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
  };

  return {
    sqlite,
    database,

    setBeforeRestoreUpdate(callback) {
      beforeRestoreUpdate =
        callback;
    }
  };
}


const AUTH_TOKEN =
  "morning-meeting-auto-history-blank-restore-test-token";


async function createApiFixture(
  values,
  revision = 7
) {
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
      new Date()
        .toISOString()
    );

  await __oisDataRequestsTest
    .ensureMorningMeetingAutoHistoryOverridesTable(
      fixture.database
    );

  const createdAt =
    "2026-09-15T00:00:00.000Z";

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
      "2026-09-15",
      JSON.stringify(
        values
      ),
      "operator-1",
      "시험 사용자",
      createdAt,
      "operator-1",
      "시험 사용자",
      createdAt,
      revision
    );

  return fixture;
}


async function postRestore(
  database,
  expectedRevision
) {
  const request =
    new Request(
      "https://shift.test/api/ois-data-requests?action=restore_morning_meeting_auto_history_blanks",
      {
        method:
          "POST",
        headers: {
          Authorization:
            `Bearer ${AUTH_TOKEN}`,
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify({
            action:
              "restore_morning_meeting_auto_history_blanks",
            targetDate:
              "2026-09-15",
            expectedRevision
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


async function postSave(
  database,
  expectedRevision,
  values
) {
  const request =
    new Request(
      "https://shift.test/api/ois-data-requests?action=save_morning_meeting_auto_history_override",
      {
        method:
          "POST",
        headers: {
          Authorization:
            `Bearer ${AUTH_TOKEN}`,
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify({
            action:
              "save_morning_meeting_auto_history_override",
            targetDate:
              "2026-09-15",
            expectedRevision,
            values
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


function readOverrideRow(
  sqlite
) {
  return sqlite
    .prepare(`
      SELECT *
      FROM morning_meeting_auto_history_overrides
      WHERE target_date = '2026-09-15'
    `)
    .get();
}


function plain(value) {
  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}


test(
  "API restores the 15 blank edits while preserving SMP, solar and truck count",
  async () => {
    const blankValues =
      Object.fromEntries(
        BLANK_FIELDS.map(
          fieldName => [
            fieldName,
            null
          ]
        )
      );

    const fixture =
      await createApiFixture({
        ...blankValues,
        ...PRESERVED_VALUES
      });

    try {
      const result =
        await postRestore(
          fixture.database,
          7
        );

      assert.equal(
        result.status,
        200,
        result.body.message
      );

      assert.equal(
        result.body.restoredCount,
        15
      );

      assert.deepEqual(
        [
          ...result.body.restoredFields
        ].sort(),
        [
          ...BLANK_FIELDS
        ].sort()
      );

      const savedRow =
        readOverrideRow(
          fixture.sqlite
        );

      assert.ok(
        savedRow
      );

      assert.equal(
        savedRow.revision,
        8
      );

      assert.deepEqual(
        JSON.parse(
          savedRow.values_json
        ),
        PRESERVED_VALUES
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "API keeps an empty override row and advances revision after restoring its last blank",
  async () => {
    const fixture =
      await createApiFixture(
        {
          waterRawWaterInflow:
            null
        },
        3
      );

    try {
      const result =
        await postRestore(
          fixture.database,
          3
        );

      assert.equal(
        result.status,
        200,
        result.body.message
      );

      const savedRow =
        readOverrideRow(
          fixture.sqlite
        );

      assert.ok(
        savedRow,
        "the revision tombstone row must remain"
      );

      assert.equal(
        savedRow.values_json,
        "{}"
      );

      assert.equal(
        savedRow.revision,
        4
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "API removes only known blank fields and preserves every legacy or future value",
  async () => {
    const preservedRawValues = {
      smpMinimum:
        90.09,
      legacyNegativeNox:
        -0.04,
      retiredBlank:
        null,
      futureMetadata: {
        source:
          "legacy",
        value:
          null
      }
    };

    const fixture =
      await createApiFixture({
        waterRawWaterInflow:
          null,
        limestoneUnitOneUsage:
          "   ",
        ...preservedRawValues
      });

    try {
      const result =
        await postRestore(
          fixture.database,
          7
        );

      assert.equal(
        result.status,
        200,
        result.body.message
      );

      assert.deepEqual(
        result.body.restoredFields,
        [
          "waterRawWaterInflow",
          "limestoneUnitOneUsage"
        ]
      );

      const savedRow =
        readOverrideRow(
          fixture.sqlite
        );

      assert.equal(
        savedRow.revision,
        8
      );

      assert.deepEqual(
        JSON.parse(
          savedRow.values_json
        ),
        preservedRawValues
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "API sparse saves also preserve legacy and future values",
  async () => {
    const fixture =
      await createApiFixture({
        legacyNegativeNox:
          -0.04,
        retiredBlank:
          null,
        futureMetadata: {
          source:
            "legacy"
        },
        smpMinimum:
          90.09
      });

    try {
      const result =
        await postSave(
          fixture.database,
          7,
          {
            limestoneUnitOneUsage:
              35.7
          }
        );

      assert.equal(
        result.status,
        200,
        result.body.message
      );

      const savedRow =
        readOverrideRow(
          fixture.sqlite
        );

      assert.equal(
        savedRow.revision,
        8
      );

      assert.deepEqual(
        JSON.parse(
          savedRow.values_json
        ),
        {
          legacyNegativeNox:
            -0.04,
          retiredBlank:
            null,
          futureMetadata: {
            source:
              "legacy"
          },
          smpMinimum:
            90.09,
          limestoneUnitOneUsage:
            35.7
        }
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "API rejects stale revisions and rows without blank overrides without writes",
  async () => {
    const fixture =
      await createApiFixture({
        waterRawWaterInflow:
          null,
        smpMinimum:
          90.09
      });

    try {
      const before =
        readOverrideRow(
          fixture.sqlite
        );

      const booleanRevisionResult =
        await postRestore(
          fixture.database,
          true
        );

      assert.equal(
        booleanRevisionResult.status,
        400
      );

      assert.deepEqual(
        readOverrideRow(
          fixture.sqlite
        ),
        before
      );

      const staleResult =
        await postRestore(
          fixture.database,
          6
        );

      assert.equal(
        staleResult.status,
        409
      );

      assert.deepEqual(
        readOverrideRow(
          fixture.sqlite
        ),
        before
      );

      fixture.sqlite
        .prepare(`
          UPDATE morning_meeting_auto_history_overrides
          SET values_json = ?, revision = 8
          WHERE target_date = '2026-09-15'
        `)
        .run(
          JSON.stringify(
            PRESERVED_VALUES
          )
        );

      const noBlankBefore =
        readOverrideRow(
          fixture.sqlite
        );

      const noBlankResult =
        await postRestore(
          fixture.database,
          8
        );

      assert.equal(
        noBlankResult.status,
        400
      );

      assert.match(
        noBlankResult.body.message,
        /복원할 빈칸 수정값이 없습니다/
      );

      assert.deepEqual(
        readOverrideRow(
          fixture.sqlite
        ),
        noBlankBefore
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "API revision guard preserves an interleaved update instead of restoring over it",
  async () => {
    const fixture =
      await createApiFixture(
        {
          waterRawWaterInflow:
            null,
          smpMinimum:
            90.09
        },
        5
      );

    try {
      fixture.setBeforeRestoreUpdate(
        sqlite => {
          sqlite
            .prepare(`
              UPDATE morning_meeting_auto_history_overrides
              SET values_json = ?, revision = revision + 1
              WHERE target_date = '2026-09-15'
            `)
            .run(
              JSON.stringify({
                waterRawWaterInflow:
                  8123,
                smpMinimum:
                  90.09
              })
            );
        }
      );

      const result =
        await postRestore(
          fixture.database,
          5
        );

      assert.equal(
        result.status,
        409
      );

      const savedRow =
        readOverrideRow(
          fixture.sqlite
        );

      assert.equal(
        savedRow.revision,
        6
      );

      assert.deepEqual(
        JSON.parse(
          savedRow.values_json
        ),
        {
          waterRawWaterInflow:
            8123,
          smpMinimum:
            90.09
        }
      );

    } finally {
      fixture.sqlite.close();
    }
  }
);


test(
  "organic truck count is accepted by the same frontend and API field contract",
  () => {
    assert.deepEqual(
      __oisDataRequestsTest
        .normalizeMorningMeetingAutoHistoryOverrideValues({
          organicTruckCount:
            0
        }),
      {
        organicTruckCount:
          0
      }
    );

    const restoredRow =
      createOverrideHelpers()
        .applyOverride(
          {
            date:
              "2026-09-15",
            dailyData: {}
          },
          {
            targetDate:
              "2026-09-15",
            revision:
              1,
            values: {
              organicTruckCount:
                4
            }
          }
        );

    assert.equal(
      restoredRow.dailyData.sludgeTruckCount,
      4
    );
  }
);


function createOverrideHelpers() {
  const start =
    scriptSource.indexOf(
      "const MORNING_MEETING_AUTO_HISTORY_OVERRIDE_TARGETS ="
    );

  const end =
    scriptSource.indexOf(
      "/* =====================================================\n    저장 자료를 날짜별 행으로 병합",
      start
    );

  assert.ok(
    start >= 0 &&
    end > start,
    "blank override helper source must exist"
  );

  const context =
    vm.createContext({
      normalizeText(value) {
        return String(
          value ??
          ""
        ).trim();
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    `
      globalThis.__overrideHelpers = {
        getBlankFields: getMorningMeetingAutoHistoryBlankOverrideFields,
        applyOverride: applyMorningMeetingAutoHistoryOverride
      };
    `,
    context
  );

  return context
    .__overrideHelpers;
}


test(
  "frontend exposes restore only for explicit null overrides",
  () => {
    const getBlankFields =
      createOverrideHelpers()
        .getBlankFields;

    const values = {
      waterRawWaterInflow:
        null,
      limestoneUnitOneUsage:
        null,
      smpMinimum:
        90.09,
      powerSolar:
        538.7,
      organicTruckCount:
        4,
      unknownField:
        null
    };

    assert.deepEqual(
      plain(
        getBlankFields({
          morningMeetingAutoHistoryOverride: {
            values
          }
        })
      ),
      [
        "waterRawWaterInflow",
        "limestoneUnitOneUsage"
      ]
    );
  }
);


test(
  "frontend re-merge exposes source values after blank keys are removed",
  () => {
    const applyOverride =
      createOverrideHelpers()
        .applyOverride;

    const sourceRow = {
      date:
        "2026-09-15",
      water: {
        rawWaterInflow:
          7888,
        demiProduction:
          1942,
        pureWaterUsage:
          1912
      },
      limestone: {
        unitOneUsage:
          35.7,
        unitTwoUsage:
          47.87
      },
      dailyData: {
        steamSales:
          895.59,
        totalProduction:
          12969,
        generatorEcmsGen1:
          4056621.4,
        epowerTransmission:
          3545640,
        sludgeTotal:
          116.05,
        organicSiloTotal:
          30.54
      },
      smp: {
        minimum:
          90.09
      }
    };

    const restoredRow =
      applyOverride(
        sourceRow,
        {
          targetDate:
            "2026-09-15",
          revision:
            8,
          values:
            PRESERVED_VALUES
        }
      );

    assert.equal(
      restoredRow.water.rawWaterInflow,
      7888
    );
    assert.equal(
      restoredRow.limestone.unitTwoUsage,
      47.87
    );
    assert.equal(
      restoredRow.dailyData.steamSales,
      895.59
    );
    assert.equal(
      restoredRow.dailyData.generatorEcmsGen1,
      4056621.4
    );
    assert.equal(
      restoredRow.dailyData.sludgeTotal,
      116.05
    );
    assert.equal(
      restoredRow.smp.minimum,
      90.09
    );
    assert.equal(
      restoredRow.dailyData.solarDailyGeneration,
      538.7
    );
  }
);


function createMergeSavedRows() {
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
    start >= 0 &&
    end > start,
    "saved history merge source must exist"
  );

  const context =
    vm.createContext({
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
          value === null ||
          value === undefined ||
          value === ""
        ) {
          return null;
        }

        const numberValue =
          Number(
            value
          );

        return Number.isFinite(
          numberValue
        )
          ? numberValue
          : null;
      },
      addDateDays(dateValue) {
        assert.equal(
          dateValue,
          "2026-09-15"
        );

        return "2026-09-16";
      },
      readLocalSmpByDate() {
        return new Map([
          [
            "2026-09-16",
            {
              minimum:
                1,
              maximum:
                2,
              weightedAverage:
                1.5
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
    context
  );

  return context
    .__mergeSavedRows;
}


test(
  "completed history is re-merged with source values after the null keys are removed",
  () => {
    const mergeSavedRows =
      createMergeSavedRows();

    const rows =
      mergeSavedRows(
        {
          completedPayload: {
            items: [
              {
                targetDate:
                  "2026-09-15",
                requestType:
                  "water_environment",
                status:
                  "complete",
                result: {
                  rawWaterInflow:
                    7888,
                  demiProduction:
                    1942,
                  pureWaterUsage:
                    1912
                }
              },
              {
                targetDate:
                  "2026-09-15",
                requestType:
                  "turbine_gear_pinion",
                status:
                  "complete",
                result: {
                  gearWheel:
                    0.762,
                  pinion:
                    1.918
                }
              },
              {
                targetDate:
                  "2026-09-15",
                requestType:
                  "silo_level",
                status:
                  "complete",
                result: {
                  flyAshSiloLevel:
                    628.18,
                  bioStorageSiloLevel:
                    106
                }
              },
              {
                targetDate:
                  "2026-09-15",
                requestType:
                  "daily_data_excel",
                status:
                  "complete",
                result: {
                  steamSales:
                    895.59,
                  totalProduction:
                    12969,
                  generatorEcmsGen1:
                    4056621.4,
                  epowerTransmission:
                    3545640,
                  sludgeTotal:
                    116.05,
                  organicSiloTotal:
                    30.54
                }
              }
            ],
            overrides: [
              {
                targetDate:
                  "2026-09-15",
                revision:
                  8,
                values:
                  PRESERVED_VALUES
              }
            ]
          },
          limestonePayload: {
            items: [
              {
                usageDate:
                  "2026-09-15",
                status:
                  "complete",
                unitOneUsage:
                  35.7,
                unitTwoUsage:
                  47.87
              }
            ]
          },
          weatherPayload: {
            items: []
          }
        },
        "2026-09"
      );

    assert.equal(
      rows.length,
      1
    );

    const row =
      rows[0];

    assert.deepEqual(
      plain([
        row.water.rawWaterInflow,
        row.water.demiProduction,
        row.water.pureWaterUsage,
        row.limestone.unitOneUsage,
        row.limestone.unitTwoUsage,
        row.gearPinion.gearWheel,
        row.gearPinion.pinion,
        row.silo.flyAshSiloLevel,
        row.silo.bioStorageSiloLevel,
        row.dailyData.steamSales,
        row.dailyData.totalProduction,
        row.dailyData.generatorEcmsGen1,
        row.dailyData.epowerTransmission,
        row.dailyData.sludgeTotal,
        row.dailyData.organicSiloTotal
      ]),
      [
        7888,
        1942,
        1912,
        35.7,
        47.87,
        0.762,
        1.918,
        628.18,
        106,
        895.59,
        12969,
        4056621.4,
        3545640,
        116.05,
        30.54
      ]
    );

    assert.equal(
      row.smp.minimum,
      90.09
    );

    assert.equal(
      row.dailyData.solarDailyGeneration,
      538.7
    );

    assert.equal(
      row.dailyData.sludgeTruckCount,
      4
    );
  }
);


function createRestoreUiHarness({
  confirm = true,
  refreshResult = true,
  refreshError = null,
  responseStatus = 200,
  responseBody = {
    ok: true,
    restoredCount: 2,
    restoredFields: [
      "waterRawWaterInflow",
      "limestoneUnitOneUsage"
    ]
  }
} = {}) {
  const start =
    scriptSource.indexOf(
      "async function restoreMorningMeetingAutoHistoryBlankValues("
    );

  const end =
    scriptSource.indexOf(
      "async function saveMorningMeetingAutoHistoryDrafts()",
      start
    );

  assert.ok(
    start >= 0 &&
    end > start,
    "restore UI source must exist"
  );

  const requests = [];
  const refreshes = [];
  const messages = [];

  const row = {
    date:
      "2026-09-15",
    morningMeetingAutoHistoryOverride: {
      revision:
        7,
      values: {
        waterRawWaterInflow:
          null,
        limestoneUnitOneUsage:
          null,
        smpMinimum:
          90.09
      }
    }
  };

  const state = {
    loading:
      false,
    saving:
      false,
    editing:
      false,
    restoringDate:
      "",
    month:
      "2026-09",
    rows: [
      row
    ],
    cache:
      new Map([
        [
          "2026-09",
          {
            cached:
              true
          }
        ]
      ])
  };

  const status = {
    textContent:
      ""
  };

  const context =
    vm.createContext({
      API_URL:
        "/api/ois-data-requests",
      state,
      console: {
        error() {}
      },
      window: {
        confirm() {
          return confirm;
        },
        showToast(message) {
          messages.push(
            message
          );
        }
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
      getMorningMeetingAutoHistoryBlankOverrideFields(item) {
        return Object.entries(
          item
            ?.morningMeetingAutoHistoryOverride
            ?.values ||
          {}
        )
          .filter(
            ([, value]) =>
              value === null
          )
          .map(
            ([key]) =>
              key
          );
      },
      getElements() {
        return {
          status
        };
      },
      getShiftLogAuthHeaders(headers = {}) {
        return {
          Accept:
            "application/json",
          ...headers
        };
      },
      renderRows() {},
      updateMonthControls() {},
      async loadMonth(options) {
        refreshes.push(
          options
        );

        if (
          refreshError
        ) {
          throw refreshError;
        }

        return refreshResult;
      },
      async fetch(url, options) {
        requests.push({
          url,
          options
        });

        return {
          ok:
            responseStatus >= 200 &&
            responseStatus < 300,
          status:
            responseStatus,
          async json() {
            return responseBody;
          }
        };
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    "\nglobalThis.__restoreBlankValues = restoreMorningMeetingAutoHistoryBlankValues;",
    context
  );

  return {
    state,
    requests,
    refreshes,
    messages,
    restore:
      context.__restoreBlankValues
  };
}


test(
  "frontend confirms once, posts one revision-guarded restore and force-refreshes raw history",
  async () => {
    const harness =
      createRestoreUiHarness();

    await harness.restore(
      "2026-09-15"
    );

    assert.equal(
      harness.requests.length,
      1
    );

    assert.equal(
      harness.requests[0].options.method,
      "POST"
    );

    assert.deepEqual(
      JSON.parse(
        harness.requests[0].options.body
      ),
      {
        action:
          "restore_morning_meeting_auto_history_blanks",
        targetDate:
          "2026-09-15",
        expectedRevision:
          7
      }
    );

    assert.deepEqual(
      plain(
        harness.refreshes
      ),
      [
        {
          forceRefresh:
            true
        }
      ]
    );

    assert.equal(
      harness.state.cache.size,
      0
    );

    assert.equal(
      harness.state.restoringDate,
      ""
    );

    assert.match(
      harness.messages[0],
      /2개를 원본으로 복원/
    );
  }
);


test(
  "frontend sends no request when cancelled and never retries a 409 restore",
  async () => {
    const cancelled =
      createRestoreUiHarness({
        confirm:
          false
      });

    await cancelled.restore(
      "2026-09-15"
    );

    assert.equal(
      cancelled.requests.length,
      0
    );

    const conflicted =
      createRestoreUiHarness({
        responseStatus:
          409,
        responseBody: {
          ok: false,
          message:
            "다른 사용자가 먼저 수정했습니다. 최신 자료를 다시 확인해 주세요."
        }
      });

    await conflicted.restore(
      "2026-09-15"
    );

    assert.equal(
      conflicted.requests.length,
      1,
      "a destructive restore conflict must not be retried"
    );

    assert.equal(
      conflicted.refreshes.length,
      1,
      "the latest saved history must be reloaded after conflict"
    );
  }
);


test(
  "frontend distinguishes a committed restore from a failed history refresh",
  async () => {
    for (
      const options of [
        {
          refreshResult:
            false
        },
        {
          refreshError:
            new Error(
              "weather history unavailable"
            )
        }
      ]
    ) {
      const harness =
        createRestoreUiHarness(
          options
        );

      await harness.restore(
        "2026-09-15"
      );

      assert.equal(
        harness.requests.length,
        1,
        "the committed restore must never be posted again"
      );

      assert.equal(
        harness.refreshes.length,
        1
      );

      assert.equal(
        harness.state.cache.size,
        0
      );

      assert.equal(
        harness.state.restoringDate,
        ""
      );

      assert.match(
        harness.messages.at(-1),
        /복원은 완료됐지만 목록을 다시 불러오지 못했습니다/
      );

      assert.doesNotMatch(
        harness.messages.at(-1),
        /복원하지 못했습니다/
      );
    }
  }
);


function createSaveUiHarness({
  responses = null,
  responseStatus = 200,
  responseBody = {
    ok: true,
    item: {
      targetDate:
        "2026-09-15",
      revision:
        8,
      values: {
        waterRawWaterInflow:
          8123
      }
    }
  }
} = {}) {
  const start =
    scriptSource.indexOf(
      "async function saveMorningMeetingAutoHistoryDrafts()"
    );

  const end =
    scriptSource.indexOf(
      "/* =====================================================\n  월 이동",
      start
    );

  assert.ok(
    start >= 0 &&
    end > start,
    "save UI source must exist"
  );

  const requests = [];
  const refreshes = [];
  const messages = [];

  const drafts =
    new Map([
      [
        "2026-09-15",
        {
          waterRawWaterInflow:
            null
        }
      ]
    ]);

  const state = {
    saving:
      false,
    editing:
      true,
    restoringDate:
      "",
    month:
      "2026-09",
    drafts,
    rows: [
      {
        date:
          "2026-09-15",
        overrideRevision:
          0,
        morningMeetingAutoHistoryOverride: {
          revision:
            7,
          values: {
            waterRawWaterInflow:
              7888
          }
        }
      }
    ],
    cache:
      new Map([
        [
          "2026-09",
          {
            cached:
              true
          }
        ]
      ])
  };

  const status = {
    textContent:
      ""
  };

  const context =
    vm.createContext({
      API_URL:
        "/api/ois-data-requests",
      Map,
      MORNING_MEETING_AUTO_HISTORY_OVERRIDE_TARGETS: {
        waterRawWaterInflow: [
          "water",
          "rawWaterInflow"
        ]
      },
      state,
      console: {
        error() {}
      },
      window: {
        showToast(message) {
          messages.push(
            message
          );
        }
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
      getElements() {
        return {
          status
        };
      },
      getShiftLogAuthHeaders(headers = {}) {
        return {
          Accept:
            "application/json",
          ...headers
        };
      },
      renderRows() {},
      updateMonthControls() {},
      applyMorningMeetingAutoHistoryOverride(row, item) {
        return {
          ...row,
          morningMeetingAutoHistoryOverride:
            item
        };
      },
      async loadMonth(options) {
        refreshes.push(
          options
        );

        return true;
      },
      async fetch(url, options) {
        const responseIndex =
          requests.length;

        requests.push({
          url,
          options
        });

        const configuredResponse =
          Array.isArray(
            responses
          )
            ? responses[
                Math.min(
                  responseIndex,
                  responses.length - 1
                )
              ]
            : null;

        const currentStatus =
          configuredResponse?.status ??
          responseStatus;

        const currentBody =
          configuredResponse?.body ??
          responseBody;

        return {
          ok:
            currentStatus >= 200 &&
            currentStatus < 300,
          status:
            currentStatus,
          async json() {
            return currentBody;
          }
        };
      }
    });

  vm.runInContext(
    scriptSource.slice(
      start,
      end
    ) +
    "\nglobalThis.__saveDrafts = saveMorningMeetingAutoHistoryDrafts;",
    context
  );

  return {
    state,
    requests,
    refreshes,
    messages,
    save:
      context.__saveDrafts
  };
}


test(
  "frontend saves an existing override with its canonical revision in one request",
  async () => {
    const harness =
      createSaveUiHarness();

    await harness.save();

    assert.equal(
      harness.requests.length,
      1
    );

    const requestBody =
      JSON.parse(
        harness.requests[0]
          .options
          .body
      );

    assert.equal(
      requestBody.expectedRevision,
      7,
      "the canonical override revision must win over the legacy zero placeholder"
    );

    assert.equal(
      harness.state.editing,
      false
    );

    assert.equal(
      harness.state.drafts.size,
      0
    );
  }
);


test(
  "frontend never retries a stale blank save and keeps the draft for explicit review",
  async () => {
    const harness =
      createSaveUiHarness({
        responseStatus:
          409,
        responseBody: {
          ok: false,
          currentItem: {
            targetDate:
              "2026-09-15",
            revision:
              8,
            values: {}
          },
          message:
            "다른 사용자가 먼저 수정했습니다."
        }
      });

    await harness.save();

    assert.equal(
      harness.requests.length,
      1,
      "a stale null draft must not be reposted with the newer revision"
    );

    assert.deepEqual(
      plain(
        harness.refreshes
      ),
      [
        {
          forceRefresh:
            true
        }
      ]
    );

    assert.equal(
      harness.state.editing,
      true
    );

    assert.deepEqual(
      harness.state.drafts.get(
        "2026-09-15"
      ),
      {
        waterRawWaterInflow:
          null
      }
    );

    assert.equal(
      harness.state.cache.size,
      0
    );

    assert.match(
      harness.messages.at(-1),
      /이번 입력은 저장하지 않았습니다/
    );
  }
);


test(
  "frontend reports a prior successful date when a later date conflicts",
  async () => {
    const harness =
      createSaveUiHarness({
        responses: [
          {
            status:
              200,
            body: {
              ok: true,
              item: {
                targetDate:
                  "2026-09-15",
                revision:
                  8,
                values: {
                  waterRawWaterInflow:
                    8123
                }
              }
            }
          },
          {
            status:
              409,
            body: {
              ok: false,
              message:
                "다른 사용자가 먼저 수정했습니다."
            }
          }
        ]
      });

    harness.state.rows.push({
      date:
        "2026-09-14",
      overrideRevision:
        0,
      morningMeetingAutoHistoryOverride: {
        revision:
          3,
        values: {}
      }
    });

    harness.state.drafts.set(
      "2026-09-14",
      {
        waterRawWaterInflow:
          null
      }
    );

    await harness.save();

    assert.equal(
      harness.requests.length,
      2
    );

    assert.equal(
      harness.state.drafts.has(
        "2026-09-15"
      ),
      false
    );

    assert.equal(
      harness.state.drafts.has(
        "2026-09-14"
      ),
      true
    );

    assert.match(
      harness.messages.at(-1),
      /1일 자료는 먼저 저장했습니다/
    );

    assert.match(
      harness.messages.at(-1),
      /충돌한 날짜의 이번 입력은 저장하지 않았습니다/
    );
  }
);


test(
  "restore button styling and cache keys ship together",
  () => {
    assert.match(
      scriptSource,
      /auto-history-blank-restore-button/
    );

    assert.match(
      scriptSource,
      /data-auto-history-restore-date/
    );

    assert.match(
      styleSource,
      /\.auto-history-blank-restore-button/
    );

    assert.match(
      indexSource,
      /style\.css\?v=20260916-auto-history-blank-restore-v1/
    );

    assert.match(
      indexSource,
      /script\.js\?v=20260916-auto-history-blank-restore-v1/
    );
  }
);
