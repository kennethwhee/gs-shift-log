import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";


const root =
  path.resolve(
    process.argv[2] ||
    process.cwd()
  );


const apiPath =
  path.join(
    root,
    "functions/api/ois-data-requests.js"
  );


const apiSource =
  fs.readFileSync(
    apiPath,
    "utf8"
  );


const apiModule =
  await import(
    pathToFileURL(
      apiPath
    ).href
  );


const {
  onRequestGet,
  onRequestPost,
  __oisDataRequestsTest
} = apiModule;


const BLOWER_REQUEST_TYPE =
  "blower_runtime_probe";


const AGENT_KEY =
  "batch-contract-secret";


const AGENT_ID =
  "batch-agent-a";


function createSqliteD1() {
  const sqlite =
    new DatabaseSync(
      ":memory:"
    );


  const database = {
    prepare(
      sql
    ) {
      return {
        sql,
        bindings: [],
        bind(
          ...bindings
        ) {
          this.bindings =
            bindings;

          return this;
        },
        async run() {
          const result =
            sqlite.prepare(
              this.sql
            ).run(
              ...this.bindings
            );

          return {
            meta: {
              changes:
                Number(
                  result.changes
                )
            }
          };
        },
        async all() {
          return {
            results:
              sqlite.prepare(
                this.sql
              ).all(
                ...this.bindings
              )
          };
        },
        async first() {
          return sqlite.prepare(
            this.sql
          ).get(
            ...this.bindings
          ) ||
            null;
        }
      };
    },
    async batch(
      statements
    ) {
      const results = [];

      sqlite.exec(
        "BEGIN IMMEDIATE"
      );

      try {
        for (
          const statement
          of statements
        ) {
          results.push(
            await statement.run()
          );
        }

        sqlite.exec(
          "COMMIT"
        );
      } catch (
        error
      ) {
        sqlite.exec(
          "ROLLBACK"
        );

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


function agentHeaders(
  extra = {}
) {
  return {
    "X-OIS-Agent-Key":
      AGENT_KEY,
    "X-OIS-Agent-Id":
      AGENT_ID,
    ...extra
  };
}


function createIntentRow(
  requestId,
  startAt,
  endAt
) {
  return {
    request_id:
      requestId,
    schema_version:
      1,
    asset_tag:
      "104ETH03AN602",
    dataparc_tag:
      "GSPOGE.ABB_DCS.003ETH03AN602XB04",
    window_start:
      startAt,
    window_end:
      endAt,
    chunk_days:
      31,
    chunk_count:
      1,
    expected_last_replacement_at:
      startAt,
    expected_cycle_start_state:
      "started",
    expected_cycle_started_at:
      startAt,
    expected_cycle_start_revision:
      `${requestId}-start`,
    expected_cycle_runtime_revision:
      `${requestId}-runtime`,
    created_at:
      "2026-09-11T00:00:00.000Z",
    updated_at:
      "2026-09-11T00:00:00.000Z"
  };
}


class MockStatement {
  constructor(
    database,
    sql
  ) {
    this.database =
      database;
    this.sql =
      String(
        sql
      );
    this.bindings = [];
  }


  bind(
    ...bindings
  ) {
    this.bindings =
      bindings;

    return this;
  }


  async all() {
    if (
      this.sql.includes(
        "FROM blower_runtime_probe_intents_v4"
      ) &&
      this.sql.includes(
        "request_id IN ("
      )
    ) {
      this.database.intentSelectCount +=
        1;

      if (
        this.database.failIntentInSelect
      ) {
        throw new Error(
          "simulated post-claim intent read failure"
        );
      }

      return {
        results:
          this.bindings
            .map(
              requestId => {
                return this.database.intents.get(
                  requestId
                );
              }
            )
            .filter(
              Boolean
            )
      };
    }


    if (
      this.sql.includes(
        "FROM ois_data_requests"
      ) &&
      this.sql.includes(
        "WHERE id IN ("
      )
    ) {
      this.database.requestSelectCount +=
        1;

      const requestedIds =
        new Set(
          this.bindings
        );

      return {
        results:
          this.database.rows.filter(
            row => {
              return requestedIds.has(
                row.id
              );
            }
          )
      };
    }


    if (
      this.sql.includes(
        "FROM ois_data_requests"
      ) &&
      this.sql.includes(
        "requested_at ASC"
      ) &&
      this.sql.includes(
        "LIMIT ?"
      )
    ) {
      this.database.pendingSelectCount +=
        1;

      const [
        requestType,
        pollingNow,
        agentId,
        guardNow,
        limit
      ] = this.bindings;

      assert.equal(
        requestType,
        BLOWER_REQUEST_TYPE
      );

      assert.equal(
        agentId,
        AGENT_ID
      );

      assert.equal(
        guardNow,
        pollingNow
      );

      if (
        this.database.restartGuardActive
      ) {
        return {
          results: []
        };
      }

      return {
        results:
          this.database.rows
            .filter(
              row => {
                return (
                  row.request_type ===
                    requestType &&
                  row.status ===
                    "pending" &&
                  row.expires_at >=
                    pollingNow &&
                  this.database.intents.has(
                    row.id
                  )
                );
              }
            )
            .sort(
              (left, right) => {
                return (
                  left.requested_at.localeCompare(
                    right.requested_at
                  ) ||
                  left.id.localeCompare(
                    right.id
                  )
                );
              }
            )
            .slice(
              0,
              Number(
                limit
              )
            )
            .map(
              row => {
                const intent =
                  this.database.intents.get(
                    row.id
                  );

                return {
                  ...row,
                  probe_request_id:
                    intent.request_id,
                  probe_schema_version:
                    intent.schema_version,
                  probe_asset_tag:
                    intent.asset_tag,
                  probe_dataparc_tag:
                    intent.dataparc_tag,
                  probe_window_start:
                    intent.window_start,
                  probe_window_end:
                    intent.window_end,
                  probe_chunk_days:
                    intent.chunk_days,
                  probe_chunk_count:
                    intent.chunk_count,
                  probe_expected_last_replacement_at:
                    intent.expected_last_replacement_at,
                  probe_expected_cycle_start_state:
                    intent.expected_cycle_start_state,
                  probe_expected_cycle_started_at:
                    intent.expected_cycle_started_at,
                  probe_expected_cycle_start_revision:
                    intent.expected_cycle_start_revision,
                  probe_expected_cycle_runtime_revision:
                    intent.expected_cycle_runtime_revision
                };
              }
            )
      };
    }


    throw new Error(
      `Unexpected mock all(): ${this.sql}`
    );
  }


  async run() {
    if (
      this.sql.includes(
        "UPDATE ois_data_requests"
      ) &&
      this.sql.includes(
        "status = 'complete'"
      )
    ) {
      this.database.completionUpdateCount +=
        1;

      const [
        completedAt,
        agentId,
        resultJson,
        updatedAt,
        requestId,
        guardedAgentId,
        liveAt
      ] = this.bindings;

      const row =
        this.database.rows.find(
          candidate => {
            return candidate.id ===
              requestId;
          }
        );

      if (
        this.database.completionCasFailureIds.has(
          requestId
        ) ||
        !row ||
        row.request_type !==
          BLOWER_REQUEST_TYPE ||
        row.status !==
          "processing" ||
        row.agent_id !==
          guardedAgentId ||
        agentId !==
          guardedAgentId ||
        row.expires_at <=
          liveAt
      ) {
        return {
          meta: {
            changes:
              0
          }
        };
      }

      row.status =
        "complete";
      row.completed_at =
        completedAt;
      row.agent_id =
        agentId;
      row.result_json =
        resultJson;
      row.error_message =
        "";
      row.updated_at =
        updatedAt;

      return {
        meta: {
          changes:
            1
        }
      };
    }


    if (
      this.sql.includes(
        "UPDATE ois_data_requests"
      ) &&
      this.sql.includes(
        "status = 'processing'"
      )
    ) {
      this.database.claimUpdateCount +=
        1;

      const [
        startedAt,
        agentId,
        expiresAt,
        updatedAt,
        requestId,
        requestType,
        liveAt
      ] = this.bindings;

      const row =
        this.database.rows.find(
          candidate => {
            return candidate.id ===
              requestId;
          }
        );

      if (
        this.database.forceCasFailure ||
        this.database.restartGuardActive ||
        !row ||
        row.request_type !==
          requestType ||
        row.status !==
          "pending" ||
        row.expires_at <
          liveAt
      ) {
        return {
          meta: {
            changes:
              0
          }
        };
      }

      row.status =
        "processing";
      row.started_at =
        startedAt;
      row.agent_id =
        agentId;
      row.expires_at =
        expiresAt;
      row.updated_at =
        updatedAt;

      return {
        meta: {
          changes:
            1
        }
      };
    }


    throw new Error(
      `Unexpected mock run(): ${this.sql}`
    );
  }


  async first() {
    if (
      this.sql.includes(
        "FROM blower_runtime_probe_intents_v4"
      )
    ) {
      return this.database.intents.get(
        this.bindings[0]
      ) ||
        null;
    }


    throw new Error(
      `Unexpected mock first(): ${this.sql}`
    );
  }
}


class MockDatabase {
  constructor(
    rows,
    intents,
    options = {}
  ) {
    this.rows =
      rows;
    this.intents =
      intents;
    this.forceCasFailure =
      options.forceCasFailure ===
        true;
    this.restartGuardActive =
      options.restartGuardActive ===
        true;
    this.pendingSelectCount =
      0;
    this.claimUpdateCount =
      0;
    this.claimBatchCount =
      0;
    this.intentSelectCount =
      0;
    this.requestSelectCount =
      0;
    this.completionBatchCount =
      0;
    this.completionUpdateCount =
      0;
    this.completionCasFailureIds =
      new Set(
        options.completionCasFailureIds ||
        []
      );
    this.failIntentInSelect =
      options.failIntentInSelect ===
        true;
  }


  prepare(
    sql
  ) {
    return new MockStatement(
      this,
      sql
    );
  }


  async batch(
    statements
  ) {
    if (
      statements.length >
        0 &&
      statements.every(
        statement => {
          return statement.sql.includes(
            "UPDATE ois_data_requests"
          ) &&
            statement.sql.includes(
              "status = 'complete'"
            );
        }
      )
    ) {
      this.completionBatchCount +=
        1;

      return await Promise.all(
        statements.map(
          statement => {
            return statement.run();
          }
        )
      );
    }


    if (
      statements.length >
        0 &&
      statements.every(
        statement => {
          return statement.sql.includes(
            "UPDATE ois_data_requests"
          ) &&
            statement.sql.includes(
              "status = 'processing'"
            );
        }
      )
    ) {
      this.claimBatchCount +=
        1;

      return await Promise.all(
        statements.map(
          statement => {
            return statement.run();
          }
        )
      );
    }


    return statements.map(
      () => {
        return {
          success:
            true,
          meta: {
            changes:
              0
          }
        };
      }
    );
  }
}


function createQueueFixture() {
  const startAt =
    "2026-09-01T00:00:00+09:00";
  const endAt =
    "2026-09-02T00:00:00+09:00";
  const targetDate =
    __oisDataRequestsTest
      .buildBlowerRuntimeProbeTargetDate(
        startAt,
        endAt,
        "104ETH03AN602"
      );

  const makeRow = (
    id,
    requestedAt,
    requestType =
      BLOWER_REQUEST_TYPE
  ) => {
    return {
      id,
      request_type:
        requestType,
      target_date:
        targetDate,
      status:
        "pending",
      requested_by_id:
        "user-a",
      requested_by_name:
        "User A",
      requested_at:
        requestedAt,
      started_at:
        "",
      completed_at:
        "",
      agent_id:
        "",
      result_json:
        "",
      error_message:
        "",
      expires_at:
        "2099-01-01T00:00:00.000Z",
      updated_at:
        requestedAt
    };
  };

  const rows = [
    makeRow(
      "other-oldest",
      "2026-09-11T00:00:00.000Z",
      "seal_pot_runtime"
    ),
    makeRow(
      "blower-b",
      "2026-09-11T00:02:00.000Z"
    ),
    makeRow(
      "blower-a",
      "2026-09-11T00:01:00.000Z"
    ),
    makeRow(
      "blower-c",
      "2026-09-11T00:03:00.000Z"
    )
  ];

  const intents =
    new Map(
      rows
        .filter(
          row => {
            return row.request_type ===
              BLOWER_REQUEST_TYPE;
          }
        )
        .map(
          row => {
            return [
              row.id,
              createIntentRow(
                row.id,
                startAt,
                endAt
              )
            ];
          }
        )
    );

  return {
    rows,
    intents
  };
}


function convertIntentForTest(
  intent
) {
  return {
    requestId:
      intent.request_id,
    schemaVersion:
      intent.schema_version,
    requestType:
      BLOWER_REQUEST_TYPE,
    assetTag:
      intent.asset_tag,
    dataParcTag:
      intent.dataparc_tag,
    startAt:
      intent.window_start,
    endAt:
      intent.window_end,
    chunkDays:
      intent.chunk_days,
    chunkCount:
      intent.chunk_count,
    expectedLastReplacementAt:
      intent.expected_last_replacement_at,
    expectedCycleStartState:
      intent.expected_cycle_start_state,
    expectedCycleStartedAt:
      intent.expected_cycle_started_at,
    expectedCycleStartRevision:
      intent.expected_cycle_start_revision,
    expectedCycleRuntimeRevision:
      intent.expected_cycle_runtime_revision,
    readOnly:
      true
  };
}


function createValidProbeResult(
  requestId,
  intent
) {
  const probe =
    convertIntentForTest(
      intent
    );

  return {
    schemaVersion:
      1,
    requestType:
      BLOWER_REQUEST_TYPE,
    requestId,
    ok:
      true,
    readOnly:
      true,
    assetTag:
      probe.assetTag,
    dataParcTag:
      probe.dataParcTag,
    startAt:
      probe.startAt,
    endAt:
      probe.endAt,
    observedAt:
      probe.endAt,
    expectedLastReplacementAt:
      probe.expectedLastReplacementAt,
    expectedCycleStartState:
      probe.expectedCycleStartState,
    expectedCycleStartedAt:
      probe.expectedCycleStartedAt,
    expectedCycleStartRevision:
      probe.expectedCycleStartRevision,
    expectedCycleRuntimeRevision:
      probe.expectedCycleRuntimeRevision,
    chunkDays:
      31,
    chunkCount:
      1,
    completedChunkCount:
      1,
    chunks: [
      {
        index:
          1,
        startAt:
          probe.startAt,
        endAt:
          probe.endAt,
        startState:
          "stopped",
        endState:
          "stopped",
        totalRunningHours:
          0,
        runningSeconds:
          0
      }
    ],
    startState:
      "stopped",
    endState:
      "stopped",
    currentState:
      "stopped",
    isRunning:
      false,
    totalRunningHours:
      0,
    runningSeconds:
      0,
    collectedAt:
      probe.endAt
  };
}


function createCompletionFixture(
  count
) {
  const queueFixture =
    createQueueFixture();
  const template =
    queueFixture.rows.find(
      row => row.id ===
        "blower-a"
    );
  const startAt =
    "2026-09-01T00:00:00+09:00";
  const endAt =
    "2026-09-02T00:00:00+09:00";

  const rows = [];
  const intents =
    new Map();
  const items = [];

  for (
    let index = 0;
    index <
      count;
    index +=
      1
  ) {
    const requestId =
      `completion-${String(
        index
      ).padStart(
        2,
        "0"
      )}`;
    const intent =
      createIntentRow(
        requestId,
        startAt,
        endAt
      );

    rows.push({
      ...template,
      id:
        requestId,
      status:
        "processing",
      started_at:
        "2026-09-11T00:00:00.000Z",
      agent_id:
        AGENT_ID,
      expires_at:
        "2099-01-01T00:00:00.000Z"
    });

    intents.set(
      requestId,
      intent
    );

    items.push({
      requestId,
      result:
        createValidProbeResult(
          requestId,
          intent
        )
    });
  }

  return {
    rows,
    intents,
    items
  };
}


test(
  "static API routes keep the fixed Blower batch and status-batch contracts",
  () => {
    assert.match(
      apiSource,
      /action\s*===\s*[\r\n\s]*"next_blower_batch"/
    );

    assert.match(
      apiSource,
      /action\s*===\s*[\r\n\s]*"complete_blower_runtime_probe_batch"/
    );

    assert.match(
      apiSource,
      /const MAXIMUM_STATUS_BATCH_IDS\s*=\s*24\s*;/
    );

    assert.match(
      apiSource,
      /상태는 한 번에 최대 24건까지 조회할 수 있습니다\./
    );

    assert.match(
      apiSource,
      /const MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_CLAIMS\s*=\s*23\s*;/
    );

    assert.match(
      apiSource,
      /const MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_COMPLETIONS\s*=\s*24\s*;/
    );

    assert.match(
      apiSource,
      /request_type = \?[\s\S]*?status = 'pending'[\s\S]*?expires_at >= \?[\s\S]*?requested_at ASC,[\s\S]*?id ASC/
    );

    assert.match(
      apiSource,
      /FROM ois_data_requests AS request[\s\S]*?INNER JOIN blower_runtime_probe_intents_v4 AS intent[\s\S]*?ON intent\.request_id = request\.id/
    );

    assert.match(
      apiSource,
      /MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_CLAIM_ATTEMPTS\s*=\s*3\s*;/
    );

    assert.match(
      apiSource,
      /claimBlowerRuntimeProbeBatchRound\([\s\S]*?database\.batch\(/
    );

    assert.match(
      apiSource,
      /FROM blower_runtime_probe_intents_v4[\s\S]*?WHERE request_id IN \(/
    );

    const claimRoundSource =
      apiSource.slice(
        apiSource.indexOf(
          "async function claimBlowerRuntimeProbeBatchRound"
        ),
        apiSource.indexOf(
          "async function handleAgentNextBlowerRuntimeProbeBatch"
        )
      );

    assert.doesNotMatch(
      claimRoundSource,
      /findBlowerRuntimeProbeIntentsByRequestIds/
    );

    assert.match(
      apiSource,
      /findRequestsByIds\([\s\S]*?findBlowerRuntimeProbeIntentsByRequestIds\(/
    );

    assert.match(
      apiSource,
      /updateCandidates\.map\([\s\S]*?candidate\.statement/
    );

    assert.match(
      apiSource,
      /request_type = 'blower_runtime_probe' AND status = 'processing' AND agent_id = \? AND expires_at > \?/
    );
  }
);


test(
  "GET next_blower_batch claims only the oldest live Blower rows and attaches each intent",
  async () => {
    const fixture =
      createQueueFixture();
    const database =
      new MockDatabase(
        fixture.rows,
        fixture.intents
      );

    const response =
      await onRequestGet({
        request:
          new Request(
            "https://example.test/api/ois-data-requests?action=next_blower_batch&limit=2",
            {
              headers:
                agentHeaders()
            }
          ),
        env: {
          DB:
            database,
          OIS_AGENT_KEY:
            AGENT_KEY
        }
      });

    assert.equal(
      response.status,
      200
    );

    const payload =
      await response.json();

    assert.deepEqual(
      Object.keys(
        payload
      ).sort(),
      [
        "items",
        "ok"
      ]
    );

    assert.deepEqual(
      payload.items.map(
        item => item.id
      ),
      [
        "blower-a",
        "blower-b"
      ]
    );

    for (
      const item
      of payload.items
    ) {
      assert.equal(
        item.requestType,
        BLOWER_REQUEST_TYPE
      );
      assert.equal(
        item.status,
        "processing"
      );
      assert.equal(
        item.agentId,
        AGENT_ID
      );
      assert.equal(
        item.probe.requestId,
        item.id
      );
      assert.equal(
        Date.parse(
          item.expiresAt
        ) -
          Date.parse(
            item.startedAt
          ),
        2 * 60 * 60 * 1000
      );
    }

    assert.equal(
      fixture.rows.find(
        row => row.id ===
          "blower-c"
      ).status,
      "pending"
    );

    assert.equal(
      database.pendingSelectCount,
      1
    );

    assert.equal(
      database.claimBatchCount,
      1
    );

    assert.equal(
      database.intentSelectCount,
      0
    );

    assert.equal(
      fixture.rows.find(
        row => row.id ===
          "other-oldest"
      ).status,
      "pending"
    );
  }
);


test(
  "GET next_blower_batch leaves every request pending while this Agent restart guard is active",
  async () => {
    const fixture =
      createQueueFixture();
    const database =
      new MockDatabase(
        fixture.rows,
        fixture.intents,
        {
          restartGuardActive:
            true
        }
      );

    const response =
      await onRequestGet({
        request:
          new Request(
            "https://example.test/api/ois-data-requests?action=next_blower_batch&limit=3",
            {
              headers:
                agentHeaders()
            }
          ),
        env: {
          DB:
            database,
          OIS_AGENT_KEY:
            AGENT_KEY
        }
      });

    assert.equal(
      response.status,
      200
    );

    const payload =
      await response.json();

    assert.deepEqual(
      payload,
      {
        ok:
          true,
        items:
          []
      }
    );

    assert.equal(
      database.pendingSelectCount,
      1
    );

    assert.equal(
      database.claimBatchCount,
      0
    );

    assert.equal(
      database.intentSelectCount,
      0
    );

    assert.ok(
      fixture.rows
        .filter(
          row => {
            return row.request_type ===
              BLOWER_REQUEST_TYPE;
          }
        )
        .every(
          row => {
            return row.status ===
              "pending";
          }
        )
    );
  }
);


test(
  "GET batch defaults to 23, rejects an explicit out-of-range limit, and retries CAS competition at most three times",
  async () => {
    assert.equal(
      __oisDataRequestsTest
        .parseBlowerRuntimeProbeBatchLimit(
          new URL(
            "https://example.test/?action=next_blower_batch"
          )
        )
        .limit,
      23
    );

    const invalidFixture =
      createQueueFixture();
    const invalidDatabase =
      new MockDatabase(
        invalidFixture.rows,
        invalidFixture.intents
      );

    const invalidResponse =
      await onRequestGet({
        request:
          new Request(
            "https://example.test/api/ois-data-requests?action=next_blower_batch&limit=24",
            {
              headers:
                agentHeaders()
            }
          ),
        env: {
          DB:
            invalidDatabase,
          OIS_AGENT_KEY:
            AGENT_KEY
        }
      });

    assert.equal(
      invalidResponse.status,
      400
    );

    assert.equal(
      invalidDatabase.pendingSelectCount,
      0
    );

    assert.equal(
      invalidDatabase.claimUpdateCount,
      0
    );

    const retryFixture =
      createQueueFixture();
    const retryDatabase =
      new MockDatabase(
        [
          retryFixture.rows.find(
            row => row.id ===
              "blower-a"
          )
        ],
        retryFixture.intents,
        {
          forceCasFailure:
            true
        }
      );

    const retryResponse =
      await onRequestGet({
        request:
          new Request(
            "https://example.test/api/ois-data-requests?action=next_blower_batch&limit=1",
            {
              headers:
                agentHeaders()
            }
          ),
        env: {
          DB:
            retryDatabase,
          OIS_AGENT_KEY:
            AGENT_KEY
        }
      });

    assert.equal(
      retryResponse.status,
      200
    );

    assert.deepEqual(
      await retryResponse.json(),
      {
        ok:
          true,
        items: []
      }
    );

    assert.equal(
      retryDatabase.pendingSelectCount,
      3
    );

    assert.equal(
      retryDatabase.claimUpdateCount,
      3
    );

    assert.equal(
      retryDatabase.claimBatchCount,
      3
    );

    assert.equal(
      retryDatabase.intentSelectCount,
      0
    );
  }
);


test(
  "GET normal 23-item claim uses one joined read and one update batch",
  async () => {
    const fixture =
      createQueueFixture();
    const template =
      fixture.rows.find(
        row => row.id ===
          "blower-a"
      );
    const startAt =
      "2026-09-01T00:00:00+09:00";
    const endAt =
      "2026-09-02T00:00:00+09:00";

    const rows =
      Array.from(
        {
          length:
            24
        },
        (
          unused,
          index
        ) => {
          return {
            ...template,
            id:
              `blower-${String(
                index
              ).padStart(
                2,
                "0"
              )}`,
            requested_at:
              new Date(
                Date.parse(
                  "2026-09-11T00:00:00.000Z"
                ) +
                index *
                  1000
              )
                .toISOString()
          };
        }
      );

    const intents =
      new Map(
        rows.map(
          row => {
            return [
              row.id,
              createIntentRow(
                row.id,
                startAt,
                endAt
              )
            ];
          }
        )
      );

    const database =
      new MockDatabase(
        rows,
        intents
      );

    const response =
      await onRequestGet({
        request:
          new Request(
            "https://example.test/api/ois-data-requests?action=next_blower_batch&limit=23",
            {
              headers:
                agentHeaders()
            }
          ),
        env: {
          DB:
            database,
          OIS_AGENT_KEY:
            AGENT_KEY
        }
      });

    const payload =
      await response.json();

    assert.equal(
      response.status,
      200
    );

    assert.equal(
      payload.items.length,
      23
    );

    assert.equal(
      rows.filter(
        row => row.status ===
          "processing"
      ).length,
      23
    );

    assert.equal(
      rows.filter(
        row => row.status ===
          "pending"
      ).length,
      1
    );

    assert.equal(
      database.pendingSelectCount,
      1
    );

    assert.equal(
      database.claimBatchCount,
      1
    );

    assert.equal(
      database.intentSelectCount,
      0
    );
  }
);


test(
  "GET leaves missing or mismatched intents pending and claims only a canonical joined probe",
  async () => {
    const fixture =
      createQueueFixture();

    fixture.intents.delete(
      "blower-a"
    );

    fixture.intents.get(
      "blower-b"
    ).dataparc_tag =
      "GSPOGE.ABB_DCS.WRONG_SIGNAL";

    const database =
      new MockDatabase(
        fixture.rows,
        fixture.intents
      );

    const response =
      await onRequestGet({
        request:
          new Request(
            "https://example.test/api/ois-data-requests?action=next_blower_batch&limit=2",
            {
              headers:
                agentHeaders()
            }
          ),
        env: {
          DB:
            database,
          OIS_AGENT_KEY:
            AGENT_KEY
        }
      });

    const payload =
      await response.json();

    assert.equal(
      response.status,
      200
    );

    assert.deepEqual(
      payload.items.map(
        item => item.id
      ),
      [
        "blower-c"
      ]
    );

    assert.equal(
      fixture.rows.find(
        row => row.id ===
          "blower-a"
      ).status,
      "pending"
    );

    assert.equal(
      fixture.rows.find(
        row => row.id ===
          "blower-b"
      ).status,
      "pending"
    );

    assert.equal(
      fixture.rows.find(
        row => row.id ===
          "blower-c"
      ).status,
      "processing"
    );

    assert.equal(
      database.pendingSelectCount,
      1
    );

    assert.equal(
      database.claimBatchCount,
      1
    );

    assert.equal(
      database.intentSelectCount,
      0
    );
  }
);


test(
  "GET has no fallible post-claim intent read that can orphan a processing row",
  async () => {
    const fixture =
      createQueueFixture();
    const row =
      fixture.rows.find(
        candidate => candidate.id ===
          "blower-a"
      );
    const database =
      new MockDatabase(
        [
          row
        ],
        fixture.intents,
        {
          failIntentInSelect:
            true
        }
      );

    const response =
      await onRequestGet({
        request:
          new Request(
            "https://example.test/api/ois-data-requests?action=next_blower_batch&limit=1",
            {
              headers:
                agentHeaders()
            }
          ),
        env: {
          DB:
            database,
          OIS_AGENT_KEY:
            AGENT_KEY
        }
      });

    const payload =
      await response.json();

    assert.equal(
      response.status,
      200
    );

    assert.deepEqual(
      payload.items.map(
        item => item.id
      ),
      [
        "blower-a"
      ]
    );

    assert.equal(
      row.status,
      "processing"
    );

    assert.equal(
      database.intentSelectCount,
      0
    );

    assert.equal(
      database.claimBatchCount,
      1
    );
  }
);


test(
  "POST completion batch validates identity first and reports independent per-request outcomes",
  async () => {
    const calls = [];

    const completeRequest =
      async (
        context,
        body,
        authentication
      ) => {
        calls.push(
          body.requestId
        );

        assert.equal(
          authentication.agentId,
          AGENT_ID
        );

        if (
          body.requestId ===
            "request-replay"
        ) {
          return Response.json({
            ok:
              true,
            replayed:
              true
          });
        }

        if (
          body.requestId ===
            "request-conflict"
        ) {
          return Response.json(
            {
              ok:
                false,
              message:
                "lease conflict"
            },
            {
              status:
                409
            }
          );
        }

        throw new Error(
          "isolated worker failure"
        );
      };

    const makeItem =
      requestId => {
        return {
          requestId,
          result: {
            requestId,
            requestType:
              BLOWER_REQUEST_TYPE
          }
        };
      };

    const completionFixture =
      createCompletionFixture(
        3
      );

    const replayItem =
      completionFixture.items[0];
    const replayProbe =
      convertIntentForTest(
        completionFixture.intents.get(
          replayItem.requestId
        )
      );
    const replayValidation =
      __oisDataRequestsTest
        .normalizeBlowerRuntimeProbeResult(
          replayItem.result,
          replayProbe,
          replayItem.requestId,
          new Date(
            "2026-09-11T00:00:00.000Z"
          )
        );

    assert.equal(
      replayValidation.error,
      undefined
    );

    completionFixture.rows[0].status =
      "complete";
    completionFixture.rows[0].result_json =
      JSON.stringify(
        replayValidation.result
      );
    completionFixture.rows[1].agent_id =
      "other-agent";

    const completionDatabase =
      new MockDatabase(
        completionFixture.rows,
        completionFixture.intents
      );

    const response =
      await __oisDataRequestsTest
        .completeAgentBlowerRuntimeProbeBatch(
          {
            request:
              new Request(
                "https://example.test/api/ois-data-requests",
                {
                  method:
                    "POST",
                  headers:
                    agentHeaders()
                }
              ),
            env: {
              DB:
                completionDatabase,
              OIS_AGENT_KEY:
                AGENT_KEY
            }
          },
          {
            items:
              completionFixture.items
          }
        );

    assert.equal(
      response.status,
      200
    );

    assert.deepEqual(
      calls,
      []
    );

    assert.deepEqual(
      await response.json(),
      {
        ok:
          true,
        items: [
          {
            requestId:
              "completion-00",
            ok:
              true,
            status:
              "complete",
            replayed:
              true
          },
          {
            requestId:
              "completion-01",
            ok:
              false,
            status:
              "failed",
            httpStatus:
              409,
            message:
              "이 DataPARC Blower 요청을 가져간 Excel Agent만 처리시간 안에 완료할 수 있습니다."
          },
          {
            requestId:
              "completion-02",
            ok:
              true,
            status:
              "complete"
          }
        ]
      }
    );

    assert.equal(
      completionDatabase.requestSelectCount,
      1
    );

    assert.equal(
      completionDatabase.intentSelectCount,
      1
    );

    assert.equal(
      completionDatabase.completionBatchCount,
      1
    );

    assert.equal(
      completionFixture.rows[2].status,
      "complete"
    );

    const invalidResponse =
      await onRequestPost({
        request:
          new Request(
            "https://example.test/api/ois-data-requests",
            {
              method:
                "POST",
              headers: {
                ...agentHeaders(),
                "Content-Type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  action:
                    "complete_blower_runtime_probe_batch",
                  items: [
                    {
                      requestId:
                        "request-outer",
                      result: {
                        requestId:
                          "request-inner",
                        requestType:
                          BLOWER_REQUEST_TYPE
                      }
                    }
                  ]
                })
            }
          ),
        env: {
          DB: {},
          OIS_AGENT_KEY:
            AGENT_KEY
        }
      });

    assert.equal(
      invalidResponse.status,
      400
    );

    const duplicate =
      makeItem(
        "request-duplicate"
      );

    const duplicateValidation =
      __oisDataRequestsTest
        .parseBlowerRuntimeProbeCompletionBatch({
          items: [
            duplicate,
            duplicate
          ]
        });

    assert.match(
      duplicateValidation.error,
      /중복/
    );

    const wrongTypeValidation =
      __oisDataRequestsTest
        .parseBlowerRuntimeProbeCompletionBatch({
          items: [
            {
              requestId:
                "request-wrong-type",
              result: {
                requestId:
                  "request-wrong-type",
                requestType:
                  "seal_pot_runtime"
              }
            }
          ]
        });

    assert.match(
      wrongTypeValidation.error,
      /requestType/
    );
  }
);


test(
  "POST normal 24-item completion uses two bulk reads and one guarded update batch",
  async () => {
    const fixture =
      createCompletionFixture(
        24
      );
    const database =
      new MockDatabase(
        fixture.rows,
        fixture.intents
      );

    const response =
      await onRequestPost({
        request:
          new Request(
            "https://example.test/api/ois-data-requests",
            {
              method:
                "POST",
              headers: {
                ...agentHeaders(),
                "Content-Type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  action:
                    "complete_blower_runtime_probe_batch",
                  items:
                    fixture.items
                })
            }
          ),
        env: {
          DB:
            database,
          OIS_AGENT_KEY:
            AGENT_KEY
        }
      });

    assert.equal(
      response.status,
      200
    );

    const payload =
      await response.json();

    assert.equal(
      payload.ok,
      true
    );

    assert.equal(
      payload.items.length,
      24
    );

    assert.equal(
      payload.items.every(
        item => {
          return (
            item.ok ===
              true &&
            item.status ===
              "complete" &&
            !Object.prototype.hasOwnProperty.call(
              item,
              "replayed"
            )
          );
        }
      ),
      true
    );

    assert.equal(
      fixture.rows.every(
        row => row.status ===
          "complete"
      ),
      true
    );

    assert.equal(
      database.requestSelectCount,
      1
    );

    assert.equal(
      database.intentSelectCount,
      1
    );

    assert.equal(
      database.completionBatchCount,
      1
    );

    assert.equal(
      database.completionUpdateCount,
      24
    );
  }
);


test(
  "batch claim, completion, and replay execute against real SQLite while invalid intent ownership stays pending",
  async () => {
    const database =
      createSqliteD1();


    try {
      const sqlite =
        database.raw();


      sqlite.exec(`
        CREATE TABLE ois_data_requests (
          id TEXT PRIMARY KEY NOT NULL,
          request_type TEXT NOT NULL,
          target_date TEXT NOT NULL,
          status TEXT NOT NULL,
          requested_by_id TEXT NOT NULL,
          requested_by_name TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          agent_id TEXT NOT NULL DEFAULT '',
          result_json TEXT,
          error_message TEXT NOT NULL DEFAULT '',
          expires_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);


      await __oisDataRequestsTest
        .ensureBlowerRuntimeProbeSchema(
          database
        );


      const now =
        Date.now();


      const startAt =
        __oisDataRequestsTest
          .formatKstRfc3339(
            new Date(
              now -
              60 *
              60 *
              1000
            )
          );


      const endAt =
        __oisDataRequestsTest
          .formatKstRfc3339(
            new Date(
              now
            )
          );


      const expiresAt =
        new Date(
          now +
          60 *
          60 *
          1000
        ).toISOString();


      const targetDate =
        __oisDataRequestsTest
          .buildBlowerRuntimeProbeTargetDate(
            startAt,
            endAt,
            "104ETH03AN602"
          );


      const insertRequest =
        sqlite.prepare(`
          INSERT INTO ois_data_requests (
            id, request_type, target_date, status,
            requested_by_id, requested_by_name, requested_at,
            started_at, completed_at, agent_id, result_json,
            error_message, expires_at, updated_at
          ) VALUES (?, 'blower_runtime_probe', ?, 'pending',
            'browser', 'Browser', ?, NULL, NULL, '', NULL, '', ?, ?)
        `);


      insertRequest.run(
        "good_joined_probe",
        targetDate,
        new Date(
          now -
          3000
        ).toISOString(),
        expiresAt,
        new Date(
          now -
          3000
        ).toISOString()
      );


      insertRequest.run(
        "missing_intent",
        targetDate,
        new Date(
          now -
          2000
        ).toISOString(),
        expiresAt,
        new Date(
          now -
          2000
        ).toISOString()
      );


      insertRequest.run(
        "mismatched_target",
        "not-the-frozen-target",
        new Date(
          now -
          1000
        ).toISOString(),
        expiresAt,
        new Date(
          now -
          1000
        ).toISOString()
      );


      const insertIntent =
        sqlite.prepare(`
          INSERT INTO blower_runtime_probe_intents_v4 (
            request_id, reuse_key, schema_version, asset_tag,
            dataparc_tag, window_start, window_end, chunk_days,
            chunk_count, expected_last_replacement_at,
            expected_cycle_start_state, expected_cycle_started_at,
            expected_cycle_start_revision, expected_cycle_runtime_revision,
            created_at, updated_at
          ) VALUES (?, ?, 1, '104ETH03AN602',
            'GSPOGE.ABB_DCS.003ETH03AN602XB04', ?, ?, 31,
            1, ?, 'started', ?, ?, ?, ?, ?)
        `);


      for (
        const requestId
        of [
          "good_joined_probe",
          "mismatched_target"
        ]
      ) {
        insertIntent.run(
          requestId,
          `reuse-${requestId}`,
          startAt,
          endAt,
          startAt,
          startAt,
          `${requestId}-start`,
          `${requestId}-runtime`,
          startAt,
          startAt
        );
      }


      const response =
        await onRequestGet({
          request:
            new Request(
              "https://example.test/api/ois-data-requests?action=next_blower_batch&limit=23",
              {
                headers:
                  agentHeaders()
              }
            ),
          env: {
            DB:
              database,
            OIS_AGENT_KEY:
              AGENT_KEY
          }
        });


      assert.equal(
        response.status,
        200
      );


      const payload =
        await response.json();


      assert.deepEqual(
        payload.items.map(
          item => item.id
        ),
        [
          "good_joined_probe"
        ]
      );


      assert.equal(
        payload.items[0]
          .probe.requestId,
        "good_joined_probe"
      );


      assert.deepEqual(
        sqlite.prepare(`
          SELECT id, status
          FROM ois_data_requests
          ORDER BY id
        `).all().map(
          row => ({
            id:
              row.id,
            status:
              row.status
          })
        ),
        [
          {
            id:
              "good_joined_probe",
            status:
              "processing"
          },
          {
            id:
              "mismatched_target",
            status:
              "pending"
          },
          {
            id:
              "missing_intent",
            status:
              "pending"
          }
        ]
      );


      const result =
        createValidProbeResult(
          "good_joined_probe",
          createIntentRow(
            "good_joined_probe",
            startAt,
            endAt
          )
        );


      const completeRequest =
        () => onRequestPost({
          request:
            new Request(
              "https://example.test/api/ois-data-requests",
              {
                method:
                  "POST",
                headers: {
                  ...agentHeaders(),
                  "Content-Type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    action:
                      "complete_blower_runtime_probe_batch",
                    items: [
                      {
                        requestId:
                          "good_joined_probe",
                        result
                      }
                    ]
                  })
              }
            ),
          env: {
            DB:
              database,
            OIS_AGENT_KEY:
              AGENT_KEY
          }
        });


      const completed =
        await completeRequest();


      assert.equal(
        completed.status,
        200
      );


      assert.deepEqual(
        (
          await completed.json()
        ).items,
        [
          {
            requestId:
              "good_joined_probe",
            ok:
              true,
            status:
              "complete"
          }
        ]
      );


      const storedBeforeReplay =
        sqlite.prepare(`
          SELECT completed_at, result_json
          FROM ois_data_requests
          WHERE id = 'good_joined_probe'
        `).get();


      const replayed =
        await completeRequest();


      assert.deepEqual(
        (
          await replayed.json()
        ).items,
        [
          {
            requestId:
              "good_joined_probe",
            ok:
              true,
            status:
              "complete",
            replayed:
              true
          }
        ]
      );


      const storedAfterReplay =
        sqlite.prepare(`
          SELECT completed_at, result_json
          FROM ois_data_requests
          WHERE id = 'good_joined_probe'
        `).get();


      assert.equal(
        storedAfterReplay.completed_at,
        storedBeforeReplay.completed_at
      );


      assert.equal(
        storedAfterReplay.result_json,
        storedBeforeReplay.result_json
      );
    } finally {
      database.close();
    }
  }
);
