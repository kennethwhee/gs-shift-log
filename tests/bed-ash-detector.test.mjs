import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  __bedAshTest
} from "../functions/api/bed-ash-discharge.js";


const {
  buildCoverage,
  buildSummary,
  detectBedAshEvents,
  detectBedAshEventsForUnit,
  ensureSchema,
  findActiveEventRows,
  handleReviewPost,
  handleSummaryGet,
  isDetectedEventReviewReady,
  normalizeCompletedRequestSamples,
  synchronizeDetectedEvents
} =
  __bedAshTest;


function createD1TestDatabase() {
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
        bindings:
          [],

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
      const results =
        [];


      sqlite.exec(
        "BEGIN IMMEDIATE"
      );


      try {
        for (
          const statement of statements
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

    close() {
      sqlite.close();
    }
  };


  return database;
}


function makeSample(
  hour,
  levelTon,
  date =
    "2026-08-01"
) {
  return {
    unitNo:
      1,

    sampledAt:
      `${date}T${String(hour).padStart(2, "0")}:00:00+09:00`,

    levelTon
  };
}


async function insertStoredEvent(
  database,
  {
    eventKey,
    algorithmVersion =
      "bed-ash-drop-v2",
    status =
      "pending",
    startAt =
      "2026-08-01T07:00:00+09:00",
    endAt =
      "2026-08-01T11:00:00+09:00",
    thresholdCrossedAt =
      "2026-08-01T08:00:00+09:00",
    startLevelTon =
      92.3,
    endLevelTon =
      70.9,
    estimatedTon =
      21.4
  }
) {
  const isConfirmed =
    status ===
      "confirmed";


  const isReviewed =
    [
      "confirmed",
      "excluded"
    ].includes(
      status
    );


  const reviewedAt =
    isReviewed
      ? "2026-08-01T12:00:00+09:00"
      : null;


  const storedAt =
    "2026-08-02T09:00:00.000Z";


  await database
    .prepare(`
      INSERT INTO bed_ash_discharge_events (
        event_key,
        algorithm_version,
        unit_no,
        tag_number,
        event_start_at,
        event_end_at,
        threshold_crossed_at,
        start_level_ton,
        end_level_ton,
        estimated_ton,
        confidence,
        evidence_fingerprint,
        close_reason,
        status,
        confirmed_at,
        confirmed_ton,
        note,
        reviewed_by_id,
        reviewed_by_name,
        reviewed_at,
        revision,
        candidate_active,
        review_ready,
        first_detected_at,
        last_detected_at,
        updated_at
      )

      VALUES (
        ?, ?, 1, '104HDC01CW101XQ01', ?, ?, ?, ?, ?, ?,
        'high', ?, 'stable', ?, ?, ?, '', ?, ?, ?, 1, 1, 1, ?, ?, ?
      )
    `)
    .bind(
      eventKey,
      algorithmVersion,
      startAt,
      endAt,
      thresholdCrossedAt,
      startLevelTon,
      endLevelTon,
      estimatedTon,
      `${eventKey}-fingerprint`,
      status,
      isConfirmed
        ? reviewedAt
        : null,
      isConfirmed
        ? estimatedTon
        : null,
      isReviewed
        ? "legacy-reviewer"
        : "",
      isReviewed
        ? "기존 확인자"
        : "",
      reviewedAt,
      storedAt,
      storedAt,
      storedAt
    )
    .run();
}


test(
  "5.000 t is detected but 4.999 t is not",
  () => {
    const exactEvents =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 20),
          makeSample(1, 15),
          makeSample(2, 20)
        ]
      );


    const belowEvents =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 20),
          makeSample(1, 15.001),
          makeSample(2, 20)
        ]
      );


    assert.equal(
      exactEvents.length,
      1
    );

    assert.equal(
      exactEvents[0].estimatedTon,
      5
    );

    assert.equal(
      belowEvents.length,
      0
    );
  }
);


test(
  "a cumulative downward run becomes one event",
  () => {
    const events =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 20),
          makeSample(1, 17),
          makeSample(2, 14),
          makeSample(3, 14.2),
          makeSample(4, 14.1)
        ]
      );


    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].estimatedTon,
      6
    );

    assert.equal(
      events[0].thresholdCrossedAt,
      "2026-08-01T02:00:00+09:00"
    );
  }
);


test(
  "a 21.4 t continuous run is split at real samples into two truck events",
  () => {
    const samples = [
      makeSample(0, 92.3),
      makeSample(1, 87),
      makeSample(2, 81.6),
      makeSample(3, 76.2),
      makeSample(4, 70.9),
      makeSample(5, 70.9),
      makeSample(6, 70.9)
    ];


    const events =
      detectBedAshEventsForUnit(
        1,
        samples
      );


    assert.equal(
      events.length,
      2
    );

    assert.deepEqual(
      events.map(
        event => {
          return event.estimatedTon;
        }
      ),
      [
        10.7,
        10.7
      ]
    );

    assert.equal(
      events[0].endAt,
      events[1].startAt
    );

    assert.ok(
      samples.some(
        sample => {
          return sample.sampledAt ===
            events[0].endAt;
        }
      )
    );

    assert.equal(
      events.reduce(
        (
          totalTon,
          event
        ) => {
          return totalTon +
            event.estimatedTon;
        },
        0
      ),
      21.4
    );

    assert.ok(
      events.every(
        event => {
          return event.estimatedTon <=
            15;
        }
      )
    );
  }
);


test(
  "a gradual 14.2 t run remains one truck event",
  () => {
    const events =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 82.3),
          makeSample(1, 77.6),
          makeSample(2, 73),
          makeSample(3, 68.1),
          makeSample(4, 68.2),
          makeSample(5, 68.1)
        ]
      );


    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].estimatedTon,
      14.2
    );
  }
);


test(
  "an oversized one-interval drop is not divided without a real sample boundary",
  () => {
    const events =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 92.3),
          makeSample(1, 70.9),
          makeSample(2, 70.9),
          makeSample(3, 70.9)
        ]
      );


    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].estimatedTon,
      21.4
    );

    assert.equal(
      events[0].confidence,
      "low"
    );

    assert.equal(
      events[0].closeReason,
      "truck_boundary_unresolved"
    );
  }
);


test(
  "truck count follows the nominal load instead of minimizing segment count",
  () => {
    const events =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 80),
          makeSample(1, 70.3),
          makeSample(2, 60.7),
          makeSample(3, 51),
          makeSample(4, 51),
          makeSample(5, 51)
        ]
      );


    assert.equal(
      events.length,
      3
    );

    assert.deepEqual(
      events.map(
        event => {
          return event.estimatedTon;
        }
      ),
      [
        9.7,
        9.6,
        9.7
      ]
    );
  }
);


test(
  "a marginal 15.1 t run is not over-split into implausibly small trucks",
  () => {
    const events =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 30),
          makeSample(1, 22.5),
          makeSample(2, 14.9),
          makeSample(3, 14.9),
          makeSample(4, 14.9)
        ]
      );


    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].closeReason,
      "truck_boundary_unresolved"
    );
  }
);


test(
  "a single-hour V-shaped drop is preserved at low confidence",
  () => {
    const events =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 20),
          makeSample(1, 14),
          makeSample(2, 20)
        ]
      );


    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].confidence,
      "low"
    );
  }
);


test(
  "a gap over two hours cannot create a discharge",
  () => {
    const events =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 20),
          makeSample(3, 14),
          makeSample(4, 14)
        ]
      );


    assert.equal(
      events.length,
      0
    );
  }
);


test(
  "the local peak rolls forward after the eight-hour window",
  () => {
    const events =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(0, 20),
          makeSample(1, 19.4),
          makeSample(2, 18.8),
          makeSample(3, 18.2),
          makeSample(4, 17.6),
          makeSample(5, 17),
          makeSample(6, 16.4),
          makeSample(7, 15.8),
          makeSample(8, 15.2),
          makeSample(9, 14.4)
        ]
      );


    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].startAt,
      "2026-08-01T01:00:00+09:00"
    );

    assert.equal(
      events[0].estimatedTon,
      5
    );
  }
);


test(
  "midnight consecutive samples remain one sequence",
  () => {
    const events =
      detectBedAshEventsForUnit(
        1,
        [
          makeSample(23, 20, "2026-08-01"),
          makeSample(0, 16, "2026-08-02"),
          makeSample(1, 14, "2026-08-02"),
          makeSample(2, 20, "2026-08-02")
        ]
      );


    assert.equal(
      events.length,
      1
    );

    assert.equal(
      events[0].estimatedTon,
      6
    );
  }
);


test(
  "final-day lookahead completes one cross-midnight event without changing its key",
  async () => {
    const sample =
      (
        sampledAt,
        levelTon
      ) => {
        return {
          unitNo:
            1,

          sampledAt,
          levelTon
        };
      };


    const withoutLookahead = [
      sample("2026-08-01T21:00:00+09:00", 20),
      sample("2026-08-01T22:00:00+09:00", 17),
      sample("2026-08-01T23:00:00+09:00", 14),
      sample("2026-08-02T00:00:00+09:00", 14)
    ];


    const withLookahead = [
      ...withoutLookahead,
      sample("2026-08-02T01:00:00+09:00", 11),
      sample("2026-08-02T02:00:00+09:00", 11.1),
      sample("2026-08-02T03:00:00+09:00", 11.1)
    ];


    const [provisional] =
      await detectBedAshEvents(
        withoutLookahead
      );


    const [finalized] =
      await detectBedAshEvents(
        withLookahead
      );


    assert.equal(
      provisional.eventKey,
      "bed-ash-drop-v2:u1:2026-08-01T23:00:00+09:00"
    );

    assert.equal(
      provisional.estimatedTon,
      6
    );

    assert.equal(
      provisional.closeReason,
      "data_end"
    );

    assert.equal(
      finalized.eventKey,
      provisional.eventKey
    );

    assert.equal(
      finalized.endAt,
      "2026-08-02T01:00:00+09:00"
    );

    assert.equal(
      finalized.estimatedTon,
      9
    );

    assert.equal(
      finalized.closeReason,
      "stable"
    );

    assert.notEqual(
      finalized.evidenceFingerprint,
      provisional.evidenceFingerprint
    );
  }
);


test(
  "a missing first-day baseline keeps a key-shifting candidate provisional",
  async () => {
    const sample =
      (
        hour,
        levelTon
      ) => {
        return makeSample(
          hour,
          levelTon
        );
      };


    const selectedDayOnly = [
      sample(1, 80),
      sample(2, 77),
      sample(3, 74),
      sample(4, 74.1),
      sample(5, 74.1)
    ];


    const [withoutBaseline] =
      await detectBedAshEvents(
        selectedDayOnly
      );


    const [withBaseline] =
      await detectBedAshEvents([
        sample(0, 85),
        ...selectedDayOnly
      ]);


    assert.equal(
      withoutBaseline.eventKey,
      "bed-ash-drop-v2:u1:2026-08-01T03:00:00+09:00"
    );

    assert.equal(
      withoutBaseline.estimatedTon,
      6
    );

    assert.equal(
      withBaseline.eventKey,
      "bed-ash-drop-v2:u1:2026-08-01T01:00:00+09:00"
    );

    assert.equal(
      withBaseline.estimatedTon,
      11
    );

    assert.notEqual(
      withoutBaseline.eventKey,
      withBaseline.eventKey
    );
  }
);


test(
  "event key and evidence fingerprint are deterministic",
  async () => {
    const samples = [
      makeSample(0, 20),
      makeSample(1, 14),
      makeSample(2, 20)
    ];


    const firstEvents =
      await detectBedAshEvents(
        samples
      );


    const secondEvents =
      await detectBedAshEvents(
        samples
      );


    assert.equal(
      firstEvents[0].eventKey,
      secondEvents[0].eventKey
    );

    assert.equal(
      firstEvents[0].evidenceFingerprint,
      secondEvents[0].evidenceFingerprint
    );
  }
);


test(
  "split child event keys are unique and deterministic",
  async () => {
    const samples = [
      makeSample(7, 92.3),
      makeSample(8, 87),
      makeSample(9, 81.6),
      makeSample(10, 76.2),
      makeSample(11, 70.9),
      makeSample(12, 70.9),
      makeSample(13, 70.9)
    ];


    const firstEvents =
      await detectBedAshEvents(
        samples
      );


    const secondEvents =
      await detectBedAshEvents(
        samples
      );


    const firstKeys =
      firstEvents.map(
        event => {
          return event.eventKey;
        }
      );


    assert.equal(
      firstEvents.length,
      2
    );

    assert.equal(
      new Set(
        firstKeys
      ).size,
      firstKeys.length
    );

    assert.deepEqual(
      firstKeys,
      secondEvents.map(
        event => {
          return event.eventKey;
        }
      )
    );

    assert.deepEqual(
      firstEvents.map(
        event => {
          return event.evidenceFingerprint;
        }
      ),
      secondEvents.map(
        event => {
          return event.evidenceFingerprint;
        }
      )
    );
  }
);


test(
  "agent result is whitelisted and hd_24 becomes next midnight",
  () => {
    const samples =
      normalizeCompletedRequestSamples(
        {
          id:
            "request-1",

          target_date:
            "2026-08-01",

          result_json:
            JSON.stringify({
              targetDate:
                "2026-08-01",

              units: [
                {
                  unitNo:
                    1,

                  tag:
                    "104HDC01CW101XQ01",

                  samples: [
                    {
                      hour:
                        1,

                      sampledAt:
                        "2026-08-01T01:00:00+09:00",

                      levelTon:
                        20.1236
                    },

                    {
                      hour:
                        24,

                      sampledAt:
                        "2026-08-02T00:00:00+09:00",

                      levelTon:
                        14
                    }
                  ]
                }
              ]
            })
        },
        Date.parse(
          "2026-08-03T00:00:00+09:00"
        )
      );


    assert.equal(
      samples.length,
      2
    );

    assert.equal(
      samples[0].levelTon,
      20.124
    );

    assert.equal(
      samples[1].sampledAt,
      "2026-08-02T00:00:00+09:00"
    );
  }
);


test(
  "a later GET never rehydrates slots that were future at collection time",
  () => {
    const samples =
      normalizeCompletedRequestSamples(
        {
          id:
            "request-future-zero",

          target_date:
            "2026-08-01",

          completed_at:
            "2026-08-01T01:06:00+09:00",

          result_json:
            JSON.stringify({
              targetDate:
                "2026-08-01",

              collectedAt:
                "2026-08-01T01:05:00+09:00",

              units: [
                {
                  unitNo:
                    1,

                  tag:
                    "104HDC01CW101XQ01",

                  samples: [
                    {
                      hour:
                        1,

                      levelTon:
                        20
                    },

                    {
                      hour:
                        2,

                      levelTon:
                        0
                    }
                  ]
                }
              ]
            })
        },
        Date.parse(
          "2026-08-03T00:00:00+09:00"
        )
      );


    assert.deepEqual(
      samples.map(
        sample => {
          return sample.sampledAt;
        }
      ),
      [
        "2026-08-01T01:00:00+09:00"
      ]
    );
  }
);


test(
  "coverage becomes review-ready only after complete baseline and eight-hour lookahead",
  () => {
    const completedRow =
      (
        id,
        targetDate,
        collectedAt
      ) => {
        return {
          id,
          target_date:
            targetDate,
          status:
            "complete",
          completed_at:
            collectedAt,
          result_json:
            JSON.stringify({
              targetDate,
              collectedAt,
              units: [
                {
                  unitNo:
                    1,
                  tag:
                    "104HDC01CW101XQ01",
                  samples:
                    Array.from(
                      {
                        length:
                          24
                      },
                      (
                        unused,
                        hourIndex
                      ) => {
                        return {
                          hour:
                            hourIndex +
                            1,
                          levelTon:
                            20
                        };
                      }
                    )
                },
                {
                  unitNo:
                    2,
                  tag:
                    "204HDC01CW101XQ01",
                  samples:
                    Array.from(
                      {
                        length:
                          24
                      },
                      (
                        unused,
                        hourIndex
                      ) => {
                        return {
                          hour:
                            hourIndex +
                            1,
                          levelTon:
                            20
                        };
                      }
                    )
                }
              ]
            })
        };
      };


    const baseline =
      completedRow(
        "baseline",
        "2026-07-31",
        "2026-08-01T00:05:00+09:00"
      );


    const selected =
      completedRow(
        "selected",
        "2026-08-01",
        "2026-08-02T00:05:00+09:00"
      );


    const partialLookahead =
      completedRow(
        "lookahead-partial",
        "2026-08-02",
        "2026-08-02T02:05:00+09:00"
      );


    const completeLookahead =
      completedRow(
        "lookahead-complete",
        "2026-08-02",
        "2026-08-02T08:05:00+09:00"
      );


    const buildMaps =
      lookahead => {
        return {
          latestByDate:
            new Map([
              ["2026-07-31", baseline],
              ["2026-08-01", selected],
              ["2026-08-02", lookahead]
            ]),
          completedByDate:
            new Map([
              ["2026-07-31", baseline],
              ["2026-08-01", selected],
              ["2026-08-02", lookahead]
            ])
        };
      };


    const partialMaps =
      buildMaps(
        partialLookahead
      );


    const partialCoverage =
      buildCoverage(
        [
          "2026-08-01"
        ],
        partialMaps.latestByDate,
        partialMaps.completedByDate,
        "2026-07-31",
        "2026-08-02",
        Date.parse(
          "2026-08-02T09:00:00+09:00"
        )
      );


    assert.equal(
      partialCoverage.lookahead.available,
      true
    );

    assert.equal(
      partialCoverage.lookahead.complete,
      false
    );

    assert.equal(
      partialCoverage.reviewReady,
      false
    );


    const completeMaps =
      buildMaps(
        completeLookahead
      );


    const completeCoverage =
      buildCoverage(
        [
          "2026-08-01"
        ],
        completeMaps.latestByDate,
        completeMaps.completedByDate,
        "2026-07-31",
        "2026-08-02",
        Date.parse(
          "2026-08-02T09:00:00+09:00"
        )
      );


    assert.equal(
      completeCoverage.reviewReady,
      true
    );

    assert.equal(
      isDetectedEventReviewReady(
        {
          thresholdCrossedAt:
            "2026-08-01T23:00:00+09:00",
          unitNo:
            1,
          closeReason:
            "stable"
        },
        completeMaps.latestByDate,
        completeMaps.completedByDate,
        Date.parse(
          "2026-08-02T09:00:00+09:00"
        )
      ),
      true
    );


    const beforeBoundaryCoverage =
      buildCoverage(
        [
          "2026-08-01"
        ],
        completeMaps.latestByDate,
        completeMaps.completedByDate,
        "2026-07-31",
        "2026-08-02",
        Date.parse(
          "2026-08-02T08:04:59+09:00"
        )
      );


    assert.equal(
      beforeBoundaryCoverage.lookahead.available,
      false
    );

    assert.equal(
      beforeBoundaryCoverage.reviewReady,
      false
    );


    const gappedSelectedResult =
      JSON.parse(
        selected.result_json
      );


    gappedSelectedResult.units[0].samples =
      gappedSelectedResult.units[0].samples.filter(
        sample => {
          return sample.hour !==
            12;
        }
      );


    const gappedSelected = {
      ...selected,
      id:
        "selected-gapped",
      result_json:
        JSON.stringify(
          gappedSelectedResult
        )
    };


    const gappedCoverage =
      buildCoverage(
        [
          "2026-08-01"
        ],
        new Map([
          ["2026-07-31", baseline],
          ["2026-08-01", gappedSelected],
          ["2026-08-02", completeLookahead]
        ]),
        new Map([
          ["2026-07-31", baseline],
          ["2026-08-01", gappedSelected],
          ["2026-08-02", completeLookahead]
        ]),
        "2026-07-31",
        "2026-08-02",
        Date.parse(
          "2026-08-02T09:00:00+09:00"
        )
      );


    assert.deepEqual(
      gappedCoverage.missingDates,
      [
        "2026-08-01"
      ]
    );

    assert.equal(
      gappedCoverage.reviewReady,
      false
    );


    const pendingSelected = {
      id:
        "selected-refresh-pending",
      target_date:
        "2026-08-01",
      status:
        "processing",
      requested_at:
        "2026-08-02T09:01:00+09:00",
      result_json:
        ""
    };


    const refreshingCoverage =
      buildCoverage(
        [
          "2026-08-01"
        ],
        new Map([
          ["2026-07-31", baseline],
          ["2026-08-01", pendingSelected],
          ["2026-08-02", completeLookahead]
        ]),
        completeMaps.completedByDate,
        "2026-07-31",
        "2026-08-02",
        Date.parse(
          "2026-08-02T09:02:00+09:00"
        )
      );


    assert.deepEqual(
      refreshingCoverage.pendingDates,
      [
        "2026-08-01"
      ]
    );

    assert.equal(
      refreshingCoverage.reviewReady,
      false
    );


    const withoutBaseline =
      buildCoverage(
        [
          "2026-08-01"
        ],
        new Map([
          ["2026-08-01", selected],
          ["2026-08-02", completeLookahead]
        ]),
        new Map([
          ["2026-08-01", selected],
          ["2026-08-02", completeLookahead]
        ]),
        "2026-07-31",
        "2026-08-02",
        Date.parse(
          "2026-08-02T09:00:00+09:00"
        )
      );


    assert.equal(
      withoutBaseline.reviewReady,
      false
    );
  }
);


test(
  "server rejects review while support coverage is provisional",
  async () => {
    let batchCallCount =
      0;


    const eventRow = {
      event_key:
        "provisional-event",
      algorithm_version:
        "bed-ash-drop-v2",
      revision:
        1,
      status:
        "pending",
      candidate_active:
        1,
      review_ready:
        0,
      unit_no:
        1,
      threshold_crossed_at:
        "2026-08-01T03:00:00+09:00",
      event_start_at:
        "2026-08-01T01:00:00+09:00",
      event_end_at:
        "2026-08-01T03:00:00+09:00",
      start_level_ton:
        80,
      end_level_ton:
        74,
      estimated_ton:
        6
    };


    const database = {
      prepare() {
        return {
          bind() {
            return this;
          },

          async first() {
            return eventRow;
          }
        };
      },

      async batch() {
        batchCallCount +=
          1;
        return [];
      }
    };


    const response =
      await handleReviewPost(
        {
          env: {
            DB:
              database
          }
        },
        {
          action:
            "review",
          eventKey:
            eventRow.event_key,
          revision:
            1,
          status:
            "excluded"
        },
        {
          employeeNo:
            "test-user",
          name:
            "테스트 사용자"
        }
      );


    assert.equal(
      response.status,
      409
    );


    const payload =
      await response.json();


    assert.equal(
      payload.data.currentEvent.reviewReady,
      false
    );

    assert.match(
      payload.message,
      /자료.*수집/
    );

    assert.equal(
      batchCallCount,
      0
    );
  }
);


test(
  "a settled event review and append-only history commit together in SQLite",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    await database
      .prepare(`
        CREATE TABLE ois_data_requests (
          id TEXT PRIMARY KEY,
          request_type TEXT NOT NULL,
          target_date TEXT NOT NULL,
          status TEXT NOT NULL,
          result_json TEXT NOT NULL,
          error_message TEXT,
          requested_at TEXT,
          completed_at TEXT,
          updated_at TEXT
        )
      `)
      .run();


    const requestRow =
      (
        id,
        targetDate,
        collectedAt,
        unitOneLevel
      ) => {
        return {
          id,
          request_type:
            "bed_ash_level",
          target_date:
            targetDate,
          status:
            "complete",
          requested_at:
            collectedAt,
          completed_at:
            collectedAt,
          updated_at:
            collectedAt,
          result_json:
            JSON.stringify({
              targetDate,
              collectedAt,
              units: [
                {
                  unitNo:
                    1,
                  tag:
                    "104HDC01CW101XQ01",
                  samples:
                    Array.from(
                      {
                        length:
                          24
                      },
                      (
                        unused,
                        hourIndex
                      ) => {
                        const hour =
                          hourIndex +
                          1;


                        return {
                          hour,
                          levelTon:
                            unitOneLevel(
                              hour
                            )
                        };
                      }
                    )
                },
                {
                  unitNo:
                    2,
                  tag:
                    "204HDC01CW101XQ01",
                  samples:
                    Array.from(
                      {
                        length:
                          24
                      },
                      (
                        unused,
                        hourIndex
                      ) => {
                        return {
                          hour:
                            hourIndex +
                            1,
                          levelTon:
                            50
                        };
                      }
                    )
                }
              ]
            })
        };
      };


    const rows = [
      requestRow(
        "baseline-ready",
        "2026-07-31",
        "2026-08-01T00:05:00+09:00",
        () => {
          return 20;
        }
      ),
      requestRow(
        "event-ready",
        "2026-08-01",
        "2026-08-02T00:05:00+09:00",
        hour => {
          if (hour === 2) {
            return 14;
          }
          if (hour === 3 || hour === 4) {
            return 14.1;
          }
          return 20;
        }
      ),
      requestRow(
        "lookahead-ready",
        "2026-08-02",
        "2026-08-02T08:05:00+09:00",
        () => {
          return 20;
        }
      )
    ];


    for (
      const row of rows
    ) {
      await database
        .prepare(`
          INSERT INTO ois_data_requests (
            id,
            request_type,
            target_date,
            status,
            result_json,
            error_message,
            requested_at,
            completed_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)
        `)
        .bind(
          row.id,
          row.request_type,
          row.target_date,
          row.status,
          row.result_json,
          row.requested_at,
          row.completed_at,
          row.updated_at
        )
        .run();
    }


    const samples =
      rows.flatMap(
        row => {
          return normalizeCompletedRequestSamples(
            row,
            Date.parse(
              "2026-08-03T00:00:00+09:00"
            )
          );
        }
      );


    const detectedEvents =
      await detectBedAshEvents(
        samples
      );


    const event =
      detectedEvents.find(
        candidate => {
          return (
            candidate.unitNo ===
              1 &&
            candidate.thresholdCrossedAt ===
              "2026-08-01T02:00:00+09:00"
          );
        }
      );


    assert.ok(
      event
    );

    assert.equal(
      event.closeReason,
      "max_window"
    );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      [
        {
          ...event,
          reviewReady:
            true
        }
      ],
      [
        "2026-08-01"
      ],
      []
    );


    const originalBatch =
      database.batch.bind(
        database
      );


    let injectedRefresh =
      false;


    database.batch =
      async statements => {
        if (
          !injectedRefresh
        ) {
          injectedRefresh =
            true;


          await database
            .prepare(`
              INSERT INTO ois_data_requests (
                id,
                request_type,
                target_date,
                status,
                result_json,
                error_message,
                requested_at,
                completed_at,
                updated_at
              )
              VALUES (?, 'bed_ash_level', ?, 'processing', '', '', ?, NULL, ?)
            `)
            .bind(
              "lookahead-refresh-race",
              "2026-08-02",
              "2026-08-02T09:10:00+09:00",
              "2026-08-02T09:10:00+09:00"
            )
            .run();
        }


        return originalBatch(
          statements
        );
      };


    const raceResponse =
      await handleReviewPost(
        {
          env: {
            DB:
              database
          }
        },
        {
          action:
            "review",
          eventKey:
            event.eventKey,
          revision:
            1,
          status:
            "excluded",
          note:
            "시험 제외"
        },
        {
          employeeNo:
            "test-user",
          name:
            "테스트 사용자"
        }
      );


    assert.equal(
      raceResponse.status,
      409
    );


    const raceHistoryCount =
      await database
        .prepare(`
          SELECT COUNT(*) AS history_count
          FROM bed_ash_discharge_review_history
        `)
        .first();


    assert.equal(
      raceHistoryCount.history_count,
      0
    );


    database.batch =
      originalBatch;


    await database
      .prepare(`
        DELETE FROM ois_data_requests
        WHERE id = ?
      `)
      .bind(
        "lookahead-refresh-race"
      )
      .run();


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      [
        {
          ...event,
          reviewReady:
            true
        }
      ],
      [
        "2026-08-01"
      ],
      []
    );


    const response =
      await handleReviewPost(
        {
          env: {
            DB:
              database
          }
        },
        {
          action:
            "review",
          eventKey:
            event.eventKey,
          revision:
            1,
          status:
            "excluded",
          note:
            "시험 제외"
        },
        {
          employeeNo:
            "test-user",
          name:
            "테스트 사용자"
        }
      );


    assert.equal(
      response.status,
      200
    );


    const payload =
      await response.json();


    assert.equal(
      payload.data.event.status,
      "excluded"
    );


    const historyCount =
      await database
        .prepare(`
          SELECT COUNT(*) AS history_count
          FROM bed_ash_discharge_review_history
        `)
        .first();


    assert.equal(
      historyCount.history_count,
      1
    );
  }
);


test(
  "summary keeps a legacy-only badge but prefers an overlapping v2 candidate",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "legacy-only-pending",
        algorithmVersion:
          "bed-ash-drop-v1"
      }
    );


    const legacyResponse =
      await handleSummaryGet({
        env: {
          DB:
            database
        }
      });


    const legacyPayload =
      await legacyResponse.json();


    assert.equal(
      legacyPayload.data.pendingCount,
      1
    );

    assert.equal(
      legacyPayload.data.latestPending.algorithmVersion,
      "bed-ash-drop-v1"
    );

    assert.equal(
      legacyPayload.data.latestPending.thresholdCrossedAt,
      "2026-08-01T08:00:00+09:00"
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "current-overlap-pending",
        algorithmVersion:
          "bed-ash-drop-v2",
        endAt:
          "2026-08-01T09:00:00+09:00",
        endLevelTon:
          81.6,
        estimatedTon:
          10.7
      }
    );


    const deduplicatedResponse =
      await handleSummaryGet({
        env: {
          DB:
            database
        }
      });


    const deduplicatedPayload =
      await deduplicatedResponse.json();


    assert.equal(
      deduplicatedPayload.data.pendingCount,
      1
    );

    assert.equal(
      deduplicatedPayload.data.latestPending.eventKey,
      "current-overlap-pending"
    );

    assert.equal(
      deduplicatedPayload.data.latestPending.algorithmVersion,
      "bed-ash-drop-v2"
    );


    await database
      .prepare(`
        UPDATE bed_ash_discharge_events

        SET status = 'excluded'
        WHERE event_key = 'current-overlap-pending'
      `)
      .run();


    const reviewedOverlapResponse =
      await handleSummaryGet({
        env: {
          DB:
            database
        }
      });


    const reviewedOverlapPayload =
      await reviewedOverlapResponse.json();


    assert.equal(
      reviewedOverlapPayload.data.pendingCount,
      0
    );

    assert.equal(
      reviewedOverlapPayload.data.latestPending,
      null
    );
  }
);


test(
  "summary latest pending follows event time across algorithm versions",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "current-older-pending",
        algorithmVersion:
          "bed-ash-drop-v2",
        startAt:
          "2026-08-01T07:00:00+09:00",
        endAt:
          "2026-08-01T09:00:00+09:00",
        thresholdCrossedAt:
          "2026-08-01T08:00:00+09:00",
        startLevelTon:
          90,
        endLevelTon:
          80,
        estimatedTon:
          10
      }
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "legacy-newer-pending",
        algorithmVersion:
          "bed-ash-drop-v1",
        startAt:
          "2026-08-30T07:00:00+09:00",
        endAt:
          "2026-08-30T09:00:00+09:00",
        thresholdCrossedAt:
          "2026-08-30T08:00:00+09:00",
        startLevelTon:
          90,
        endLevelTon:
          80,
        estimatedTon:
          10
      }
    );


    const response =
      await handleSummaryGet({
        env: {
          DB:
            database
        }
      });


    const payload =
      await response.json();


    assert.equal(
      payload.data.pendingCount,
      2
    );

    assert.equal(
      payload.data.latestPending.eventKey,
      "legacy-newer-pending"
    );

    assert.equal(
      payload.data.latestPending.thresholdCrossedAt,
      "2026-08-30T08:00:00+09:00"
    );
  }
);


test(
  "v2 retires overlapping legacy pending candidates and rejects stale review",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    const detectedEvents =
      await detectBedAshEvents([
        makeSample(7, 92.3),
        makeSample(8, 87),
        makeSample(9, 81.6),
        makeSample(10, 76.2),
        makeSample(11, 70.9),
        makeSample(12, 70.9),
        makeSample(13, 70.9)
      ]);


    assert.equal(
      detectedEvents.length,
      2
    );


    const readyEvents =
      detectedEvents.map(
        event => {
          return {
            ...event,
            reviewReady:
              true
          };
        }
      );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      readyEvents,
      [
        "2026-08-01"
      ]
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "legacy-pending",
        algorithmVersion:
          "bed-ash-drop-v1"
      }
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "legacy-excluded",
        algorithmVersion:
          "bed-ash-drop-v1",
        status:
          "excluded"
      }
    );


    const summaryResponse =
      await handleSummaryGet({
        env: {
          DB:
            database
        }
      });


    const summaryPayload =
      await summaryResponse.json();


    assert.equal(
      summaryPayload.data.pendingCount,
      2
    );

    assert.equal(
      summaryPayload.data.latestPending.algorithmVersion,
      "bed-ash-drop-v2"
    );


    const visibleEvents =
      await findActiveEventRows(
        database,
        "2026-08-01T00:00:00+09:00",
        "2026-08-02T00:00:00+09:00"
      );


    assert.equal(
      visibleEvents.length,
      3
    );

    assert.ok(
      visibleEvents.filter(
        event => {
          return event.status ===
            "pending";
        }
      ).every(
        event => {
          return event.algorithmVersion ===
            "bed-ash-drop-v2";
        }
      )
    );

    assert.ok(
      visibleEvents.some(
        event => {
          return (
            event.status ===
              "excluded" &&
            event.algorithmVersion ===
              "bed-ash-drop-v1"
          );
        }
      )
    );


    const staleReviewResponse =
      await handleReviewPost(
        {
          env: {
            DB:
              database
          }
        },
        {
          action:
            "review",
          eventKey:
            "legacy-pending",
          revision:
            1,
          status:
            "confirmed",
          confirmedAt:
            "2026-08-01T09:00:00+09:00",
          confirmedTon:
            21.4
        },
        {
          employeeNo:
            "test-user",
          name:
            "테스트 사용자"
        }
      );


    assert.equal(
      staleReviewResponse.status,
      409
    );


    const staleReviewPayload =
      await staleReviewResponse.json();


    assert.match(
      staleReviewPayload.message,
      /이전 판정 방식/
    );


    const retiredByReview =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          WHERE event_key = 'legacy-pending'
        `)
        .first();


    assert.equal(
      retiredByReview.candidate_active,
      0
    );

    assert.equal(
      retiredByReview.review_ready,
      0
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "legacy-sync-pending",
        algorithmVersion:
          "bed-ash-drop-v1"
      }
    );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      readyEvents,
      [
        "2026-08-01"
      ]
    );


    const retiredBySync =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          WHERE event_key = 'legacy-sync-pending'
        `)
        .first();


    assert.equal(
      retiredBySync.candidate_active,
      0
    );

    assert.equal(
      retiredBySync.review_ready,
      0
    );


    const historyCount =
      await database
        .prepare(`
          SELECT COUNT(*) AS history_count
          FROM bed_ash_discharge_review_history
        `)
        .first();


    assert.equal(
      historyCount.history_count,
      0
    );
  }
);


test(
  "legacy confirmed aggregate suppresses overlapping v2 children without double total",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "legacy-confirmed",
        algorithmVersion:
          "bed-ash-drop-v1",
        status:
          "confirmed"
      }
    );


    const detectedEvents =
      await detectBedAshEvents([
        makeSample(7, 92.3),
        makeSample(8, 87),
        makeSample(9, 81.6),
        makeSample(10, 76.2),
        makeSample(11, 70.9),
        makeSample(12, 70.9),
        makeSample(13, 70.9)
      ]);


    const readyEvents =
      detectedEvents.map(
        event => {
          return {
            ...event,
            reviewReady:
              true
          };
        }
      );


    for (
      let synchronizationCount =
        0;
      synchronizationCount <
        2;
      synchronizationCount +=
        1
    ) {
      await synchronizeDetectedEvents(
        database,
        "2026-08-01T00:00:00+09:00",
        "2026-08-02T00:00:00+09:00",
        readyEvents,
        [
          "2026-08-01"
        ]
      );
    }


    const allRows =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          ORDER BY event_key
        `)
        .all();


    assert.equal(
      allRows.results.length,
      1
    );

    assert.equal(
      allRows.results[0].event_key,
      "legacy-confirmed"
    );

    assert.equal(
      allRows.results[0].status,
      "confirmed"
    );


    const visibleEvents =
      await findActiveEventRows(
        database,
        "2026-08-01T00:00:00+09:00",
        "2026-08-02T00:00:00+09:00"
      );


    assert.equal(
      visibleEvents.length,
      1
    );

    assert.equal(
      visibleEvents[0].algorithmVersion,
      "bed-ash-drop-v1"
    );


    const summary =
      buildSummary(
        visibleEvents
      );


    assert.equal(
      summary.confirmedCount,
      1
    );

    assert.equal(
      summary.confirmedTon,
      21.4
    );

    assert.equal(
      summary.pendingCount,
      0
    );
  }
);


test(
  "legacy excluded decision stays visible and suppresses overlapping v2 alerts idempotently",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "legacy-excluded-reviewed",
        algorithmVersion:
          "bed-ash-drop-v1",
        status:
          "excluded"
      }
    );


    await database
      .prepare(`
        INSERT INTO bed_ash_discharge_review_history (
          history_id,
          event_key,
          event_revision,
          previous_status,
          new_status,
          snapshot_json,
          reviewed_by_id,
          reviewed_by_name,
          reviewed_at
        )

        VALUES (
          'legacy-excluded-history',
          'legacy-excluded-reviewed',
          1,
          'pending',
          'excluded',
          '{"legacy":true}',
          'legacy-reviewer',
          '기존 확인자',
          '2026-08-01T12:00:00+09:00'
        )
      `)
      .run();


    const legacyBefore =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          WHERE event_key = 'legacy-excluded-reviewed'
        `)
        .first();


    const historyBefore =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_review_history
          WHERE history_id = 'legacy-excluded-history'
        `)
        .first();


    const detectedEvents =
      await detectBedAshEvents([
        makeSample(7, 92.3),
        makeSample(8, 87),
        makeSample(9, 81.6),
        makeSample(10, 76.2),
        makeSample(11, 70.9),
        makeSample(12, 70.9),
        makeSample(13, 70.9)
      ]);


    const readyEvents =
      detectedEvents.map(
        event => {
          return {
            ...event,
            reviewReady:
              true
          };
        }
      );


    for (
      let synchronizationCount =
        0;
      synchronizationCount <
        2;
      synchronizationCount +=
        1
    ) {
      await synchronizeDetectedEvents(
        database,
        "2026-08-01T00:00:00+09:00",
        "2026-08-02T00:00:00+09:00",
        readyEvents,
        [
          "2026-08-01"
        ]
      );
    }


    const allRows =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          ORDER BY event_key
        `)
        .all();


    assert.equal(
      allRows.results.length,
      1
    );

    assert.equal(
      allRows.results[0].event_key,
      "legacy-excluded-reviewed"
    );

    assert.equal(
      allRows.results[0].status,
      "excluded"
    );


    const visibleEvents =
      await findActiveEventRows(
        database,
        "2026-08-01T00:00:00+09:00",
        "2026-08-02T00:00:00+09:00"
      );


    assert.equal(
      visibleEvents.length,
      1
    );

    assert.equal(
      visibleEvents[0].status,
      "excluded"
    );

    assert.equal(
      visibleEvents[0].algorithmVersion,
      "bed-ash-drop-v1"
    );


    const summary =
      buildSummary(
        visibleEvents
      );


    assert.equal(
      summary.confirmedCount,
      0
    );

    assert.equal(
      summary.confirmedTon,
      0
    );

    assert.equal(
      summary.pendingCount,
      0
    );


    const alertResponse =
      await handleSummaryGet({
        env: {
          DB:
            database
        }
      });


    const alertPayload =
      await alertResponse.json();


    assert.equal(
      alertPayload.data.pendingCount,
      0
    );

    assert.equal(
      alertPayload.data.latestPending,
      null
    );


    const legacyAfter =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          WHERE event_key = 'legacy-excluded-reviewed'
        `)
        .first();


    const historyAfter =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_review_history
          WHERE history_id = 'legacy-excluded-history'
        `)
        .first();


    assert.deepEqual(
      legacyAfter,
      legacyBefore
    );

    assert.deepEqual(
      historyAfter,
      historyBefore
    );
  }
);


test(
  "reviewed overlap suppresses a child but an adjacent child remains eligible",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    await insertStoredEvent(
      database,
      {
        eventKey:
          "reviewed-first-interval",
        algorithmVersion:
          "bed-ash-drop-v1",
        status:
          "excluded",
        startAt:
          "2026-08-01T07:00:00+09:00",
        endAt:
          "2026-08-01T09:00:00+09:00",
        thresholdCrossedAt:
          "2026-08-01T08:00:00+09:00",
        startLevelTon:
          92.3,
        endLevelTon:
          81.6,
        estimatedTon:
          10.7
      }
    );


    const makeIncoming =
      (
        eventKey,
        startAt,
        endAt,
        thresholdCrossedAt
      ) => {
        return {
          eventKey,
          algorithmVersion:
            "bed-ash-drop-v2",
          unitNo:
            1,
          tagNumber:
            "104HDC01CW101XQ01",
          startAt,
          endAt,
          thresholdCrossedAt,
          startLevelTon:
            81.6,
          endLevelTon:
            70.9,
          estimatedTon:
            10.7,
          confidence:
            "high",
          evidenceFingerprint:
            `${eventKey}-fingerprint`,
          closeReason:
            "stable",
          reviewReady:
            true
        };
      };


    const overlappingChild =
      makeIncoming(
        "overlapping-child",
        "2026-08-01T08:00:00+09:00",
        "2026-08-01T10:00:00+09:00",
        "2026-08-01T09:00:00+09:00"
      );


    const adjacentChild =
      makeIncoming(
        "adjacent-child",
        "2026-08-01T09:00:00+09:00",
        "2026-08-01T11:00:00+09:00",
        "2026-08-01T10:00:00+09:00"
      );


    for (
      let synchronizationCount =
        0;
      synchronizationCount <
        2;
      synchronizationCount +=
        1
    ) {
      await synchronizeDetectedEvents(
        database,
        "2026-08-01T00:00:00+09:00",
        "2026-08-02T00:00:00+09:00",
        [
          overlappingChild,
          adjacentChild
        ],
        [
          "2026-08-01"
        ]
      );
    }


    const storedRows =
      await database
        .prepare(`
          SELECT event_key, status, candidate_active
          FROM bed_ash_discharge_events
          ORDER BY event_key
        `)
        .all();


    assert.deepEqual(
      storedRows.results.map(
        row => {
          return row.event_key;
        }
      ),
      [
        "adjacent-child",
        "reviewed-first-interval"
      ]
    );

    assert.equal(
      storedRows.results.find(
        row => {
          return row.event_key ===
            "adjacent-child";
        }
      ).candidate_active,
      1
    );


    const alertResponse =
      await handleSummaryGet({
        env: {
          DB:
            database
        }
      });


    const alertPayload =
      await alertResponse.json();


    assert.equal(
      alertPayload.data.pendingCount,
      1
    );

    assert.equal(
      alertPayload.data.latestPending.eventKey,
      "adjacent-child"
    );
  }
);


test(
  "reviewed overlap lookup uses its dedicated partial covering index",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    const indexRows =
      await database
        .prepare(`
          PRAGMA index_list(
            bed_ash_discharge_events
          )
        `)
        .all();


    assert.ok(
      indexRows.results.some(
        row => {
          return (
            row.name ===
              "idx_bed_ash_events_reviewed_overlap_v2" &&
            Number(
              row.partial
            ) ===
              1
          );
        }
      )
    );


    const queryPlan =
      await database
        .prepare(`
          EXPLAIN QUERY PLAN

          SELECT 1

          FROM bed_ash_discharge_events AS reviewed

          WHERE reviewed.status IN (
              'confirmed',
              'excluded'
            )
            AND reviewed.unit_no = ?
            AND datetime(
              reviewed.event_start_at
            ) < datetime(?)
            AND datetime(
              reviewed.event_end_at
            ) > datetime(?)
        `)
        .bind(
          1,
          "2026-08-01T11:00:00+09:00",
          "2026-08-01T07:00:00+09:00"
        )
        .all();


    assert.match(
      queryPlan.results.map(
        row => {
          return String(
            row.detail ||
            ""
          );
        }
      ).join(
        "\n"
      ),
      /idx_bed_ash_events_reviewed_overlap_v2/
    );
  }
);


test(
  "schema migration and provisional-to-final synchronization are idempotent in SQLite",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await database
      .prepare(`
        CREATE TABLE bed_ash_discharge_events (
          event_key TEXT PRIMARY KEY,
          algorithm_version TEXT NOT NULL,
          unit_no INTEGER NOT NULL,
          tag_number TEXT NOT NULL,
          event_start_at TEXT NOT NULL,
          event_end_at TEXT NOT NULL,
          threshold_crossed_at TEXT NOT NULL,
          start_level_ton REAL NOT NULL,
          end_level_ton REAL NOT NULL,
          estimated_ton REAL NOT NULL,
          confidence TEXT NOT NULL,
          evidence_fingerprint TEXT NOT NULL,
          close_reason TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          confirmed_at TEXT,
          confirmed_ton REAL,
          note TEXT NOT NULL DEFAULT '',
          reviewed_by_id TEXT NOT NULL DEFAULT '',
          reviewed_by_name TEXT NOT NULL DEFAULT '',
          reviewed_at TEXT,
          revision INTEGER NOT NULL DEFAULT 1,
          candidate_active INTEGER NOT NULL DEFAULT 1,
          first_detected_at TEXT NOT NULL,
          last_detected_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `)
      .run();


    await ensureSchema(
      database
    );

    await ensureSchema(
      database
    );


    const columnResult =
      await database
        .prepare(
          "PRAGMA table_info(bed_ash_discharge_events)"
        )
        .all();


    assert.equal(
      columnResult.results.filter(
        column => {
          return column.name ===
            "review_ready";
        }
      ).length,
      1
    );


    const sample =
      (
        sampledAt,
        levelTon
      ) => {
        return {
          unitNo:
            1,
          sampledAt,
          levelTon
        };
      };


    const provisionalSamples = [
      sample("2026-08-01T21:00:00+09:00", 20),
      sample("2026-08-01T22:00:00+09:00", 17),
      sample("2026-08-01T23:00:00+09:00", 14),
      sample("2026-08-02T00:00:00+09:00", 14)
    ];


    const [provisional] =
      await detectBedAshEvents(
        provisionalSamples
      );


    const [finalized] =
      await detectBedAshEvents([
        ...provisionalSamples,
        sample("2026-08-02T01:00:00+09:00", 11),
        sample("2026-08-02T02:00:00+09:00", 11.1),
        sample("2026-08-02T03:00:00+09:00", 11.1)
      ]);


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      [
        {
          ...provisional,
          reviewReady:
            false
        }
      ],
      [],
      [
        "2026-08-01"
      ]
    );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      [
        {
          ...finalized,
          reviewReady:
            true
        }
      ],
      [
        "2026-08-01"
      ],
      []
    );


    const savedResult =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
        `)
        .all();


    assert.equal(
      savedResult.results.length,
      1
    );


    const [savedRow] =
      savedResult.results;


    assert.equal(
      savedRow.estimated_ton,
      9
    );

    assert.equal(
      savedRow.revision,
      2
    );

    assert.equal(
      savedRow.candidate_active,
      1
    );

    assert.equal(
      savedRow.review_ready,
      1
    );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      [
        {
          ...provisional,
          reviewReady:
            false
        }
      ],
      [],
      []
    );


    const protectedReadyRow =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          WHERE event_key = ?
        `)
        .bind(
          finalized.eventKey
        )
        .first();


    assert.equal(
      protectedReadyRow.estimated_ton,
      9
    );

    assert.equal(
      protectedReadyRow.review_ready,
      1
    );

    assert.equal(
      protectedReadyRow.candidate_active,
      1
    );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      [
        {
          ...provisional,
          reviewReady:
            false
        }
      ],
      [],
      [
        "2026-08-01"
      ]
    );


    const downgradedRow =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          WHERE event_key = ?
        `)
        .bind(
          provisional.eventKey
        )
        .first();


    assert.equal(
      downgradedRow.review_ready,
      0
    );

    assert.equal(
      downgradedRow.estimated_ton,
      6
    );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      [
        {
          ...finalized,
          reviewReady:
            true
        }
      ],
      [
        "2026-08-01"
      ],
      []
    );


    const reactivatedRow =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          WHERE event_key = ?
        `)
        .bind(
          finalized.eventKey
        )
        .first();


    assert.equal(
      reactivatedRow.review_ready,
      1
    );

    assert.equal(
      reactivatedRow.estimated_ton,
      9
    );


    await database
      .prepare(
        "DELETE FROM bed_ash_discharge_events"
      )
      .run();


    const selectedDayOnly = [
      sample("2026-08-01T01:00:00+09:00", 80),
      sample("2026-08-01T02:00:00+09:00", 77),
      sample("2026-08-01T03:00:00+09:00", 74),
      sample("2026-08-01T04:00:00+09:00", 74.1),
      sample("2026-08-01T05:00:00+09:00", 74.1)
    ];


    const [oldKeyEvent] =
      await detectBedAshEvents(
        selectedDayOnly
      );


    const [newKeyEvent] =
      await detectBedAshEvents([
        sample("2026-08-01T00:00:00+09:00", 85),
        ...selectedDayOnly
      ]);


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-03T00:00:00+09:00",
      [
        {
          ...oldKeyEvent,
          reviewReady:
            true
        }
      ],
      [
        "2026-08-01"
      ],
      [
        "2026-08-02"
      ]
    );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-03T00:00:00+09:00",
      [
        {
          ...newKeyEvent,
          reviewReady:
            true
        }
      ],
      [
        "2026-08-01"
      ],
      [
        "2026-08-02"
      ]
    );


    const keyShiftRows =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          ORDER BY event_key
        `)
        .all();


    assert.equal(
      keyShiftRows.results.length,
      2
    );


    const oldKeyRow =
      keyShiftRows.results.find(
        row => {
          return row.event_key ===
            oldKeyEvent.eventKey;
        }
      );


    const newKeyRow =
      keyShiftRows.results.find(
        row => {
          return row.event_key ===
            newKeyEvent.eventKey;
        }
      );


    assert.equal(
      oldKeyRow.candidate_active,
      0
    );

    assert.equal(
      newKeyRow.candidate_active,
      1
    );

    assert.equal(
      newKeyRow.review_ready,
      1
    );
  }
);


test(
  "same-ID OIS completion fences a stale range synchronization",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    await database
      .prepare(`
        CREATE TABLE ois_data_requests (
          id TEXT PRIMARY KEY,
          request_type TEXT NOT NULL,
          target_date TEXT NOT NULL,
          status TEXT NOT NULL,
          result_json TEXT,
          error_message TEXT,
          requested_at TEXT,
          completed_at TEXT,
          updated_at TEXT
        )
      `)
      .run();


    await database
      .prepare(`
        INSERT INTO ois_data_requests (
          id,
          request_type,
          target_date,
          status,
          result_json,
          error_message,
          requested_at,
          completed_at,
          updated_at
        )
        VALUES (?, 'bed_ash_level', ?, 'complete', '{}', '', ?, ?, ?)
      `)
      .bind(
        "request-new",
        "2026-08-01",
        "2026-08-02T00:10:00+09:00",
        "2026-08-02T00:10:00+09:00",
        "2026-08-02T00:10:00+09:00"
      )
      .run();


    const makeEvent =
      (
        eventKey,
        thresholdCrossedAt,
        estimatedTon,
        evidenceFingerprint
      ) => {
        return {
          eventKey,
          algorithmVersion:
            "bed-ash-drop-v2",
          unitNo:
            1,
          tagNumber:
            "104HDC01CW101XQ01",
          startAt:
            "2026-08-01T00:00:00+09:00",
          endAt:
            thresholdCrossedAt,
          thresholdCrossedAt,
          startLevelTon:
            20,
          endLevelTon:
            20 -
            estimatedTon,
          estimatedTon,
          confidence:
            "high",
          evidenceFingerprint,
          closeReason:
            "max_window",
          reviewReady:
            true
        };
      };


    const newerEvent =
      makeEvent(
        "newer-event-key",
        "2026-08-01T03:00:00+09:00",
        9,
        "newer-fingerprint"
      );


    const currentResult =
      await synchronizeDetectedEvents(
        database,
        "2026-08-01T00:00:00+09:00",
        "2026-08-02T00:00:00+09:00",
        [
          newerEvent
        ],
        [
          "2026-08-01"
        ],
        [],
        {
          startDate:
            "2026-08-01",
          endDate:
            "2026-08-01",
          requests: [
            {
              id:
                "request-new",
              date:
                "2026-08-01",
              status:
                "complete",
              requestedAt:
                "2026-08-02T00:10:00+09:00",
              completedAt:
                "2026-08-02T00:10:00+09:00",
              updatedAt:
                "2026-08-02T00:10:00+09:00"
            }
          ]
        }
      );


    assert.equal(
      currentResult.synchronized,
      true
    );


    const staleEvent =
      makeEvent(
        "stale-event-key",
        "2026-08-01T02:00:00+09:00",
        6,
        "stale-fingerprint"
      );


    const staleResult =
      await synchronizeDetectedEvents(
        database,
        "2026-08-01T00:00:00+09:00",
        "2026-08-02T00:00:00+09:00",
        [
          staleEvent
        ],
        [
          "2026-08-01"
        ],
        [
          "2026-08-01"
        ],
        {
          startDate:
            "2026-08-01",
          endDate:
            "2026-08-01",
          requests: [
            {
              id:
                "request-new",
              date:
                "2026-08-01",
              status:
                "processing",
              requestedAt:
                "2026-08-02T00:10:00+09:00",
              completedAt:
                "",
              updatedAt:
                "2026-08-02T00:09:00+09:00"
            }
          ]
        }
      );


    assert.equal(
      staleResult.synchronized,
      false
    );


    const insertedRequestResult =
      await synchronizeDetectedEvents(
        database,
        "2026-08-01T00:00:00+09:00",
        "2026-08-02T00:00:00+09:00",
        [
          staleEvent
        ],
        [
          "2026-08-01"
        ],
        [
          "2026-08-01"
        ],
        {
          startDate:
            "2026-08-01",
          endDate:
            "2026-08-01",
          requests:
            []
        }
      );


    assert.equal(
      insertedRequestResult.synchronized,
      false
    );


    const storedResult =
      await database
        .prepare(`
          SELECT *
          FROM bed_ash_discharge_events
          ORDER BY event_key
        `)
        .all();


    assert.equal(
      storedResult.results.length,
      1
    );


    const [storedRow] =
      storedResult.results;


    assert.equal(
      storedRow.event_key,
      newerEvent.eventKey
    );

    assert.equal(
      storedRow.evidence_fingerprint,
      newerEvent.evidenceFingerprint
    );

    assert.equal(
      storedRow.estimated_ton,
      9
    );

    assert.equal(
      storedRow.candidate_active,
      1
    );

    assert.equal(
      storedRow.review_ready,
      1
    );
  }
);


test(
  "event persistence uses one bounded JSON upsert for a worst-case month",
  async () => {
    const preparedStatements =
      [];


    const batches =
      [];


    const database = {
      prepare(
        sql
      ) {
        const statement = {
          sql,

          bindings:
            [],

          bind(
            ...bindings
          ) {
            this.bindings =
              bindings;

            return this;
          },

          async run() {
            return {
              meta: {
                changes:
                  0
              }
            };
          }
        };


        preparedStatements.push(
          statement
        );

        return statement;
      },

      async batch(
        statements
      ) {
        batches.push(
          statements
        );

        return statements.map(
          () => {
            return {
              meta: {
                changes:
                  1
              }
            };
          }
        );
      }
    };


    const events =
      Array.from(
        {
          length:
            1488
        },
        (
          unused,
          eventIndex
        ) => {
          return {
            eventKey:
              `event-${eventIndex}`,

            algorithmVersion:
              "bed-ash-drop-v2",

            unitNo:
              eventIndex %
              2 +
              1,

            tagNumber:
              "tag",

            startAt:
              "2026-08-01T00:00:00+09:00",

            endAt:
              "2026-08-01T01:00:00+09:00",

            thresholdCrossedAt:
              "2026-08-01T01:00:00+09:00",

            startLevelTon:
              20,

            endLevelTon:
              14,

            estimatedTon:
              6,

            confidence:
              "low",

            evidenceFingerprint:
              `fingerprint-${eventIndex}`,

            closeReason:
              "refill"
          };
        }
      );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      events
    );


    const upsertStatements =
      preparedStatements.filter(
        statement => {
          return statement.sql.includes(
            "INSERT INTO bed_ash_discharge_events"
          );
        }
      );


    assert.equal(
      upsertStatements.length,
      1
    );

    assert.equal(
      upsertStatements[0].bindings.length,
      4
    );

    assert.match(
      upsertStatements[0].sql,
      /review_ready/
    );

    assert.match(
      upsertStatements[0].sql,
      /FROM json_each\(\?\)/
    );

    assert.equal(
      JSON.parse(
        upsertStatements[0].bindings[0]
      ).length,
      1488
    );

    assert.equal(
      batches.length,
      1
    );

    assert.equal(
      batches[0].length,
      2
    );
  }
);


test(
  "the bounded JSON upsert executes 1488 two-unit monthly events in real SQLite",
  async t => {
    const database =
      createD1TestDatabase();


    t.after(
      () => {
        database.close();
      }
    );


    await ensureSchema(
      database
    );


    const events =
      Array.from(
        {
          length:
            1488
        },
        (
          unused,
          eventIndex
        ) => {
          const hour =
            eventIndex %
            24;


          return {
            eventKey:
              `bulk-event-${eventIndex}`,
            algorithmVersion:
              "bed-ash-drop-v2",
            unitNo:
              eventIndex %
              2 +
              1,
            tagNumber:
              "test-tag",
            startAt:
              `2026-08-01T${String(
                hour
              ).padStart(
                2,
                "0"
              )}:00:00+09:00`,
            endAt:
              `2026-08-01T${String(
                hour
              ).padStart(
                2,
                "0"
              )}:30:00+09:00`,
            thresholdCrossedAt:
              `2026-08-01T${String(
                hour
              ).padStart(
                2,
                "0"
              )}:15:00+09:00`,
            startLevelTon:
              20,
            endLevelTon:
              14,
            estimatedTon:
              6,
            confidence:
              "high",
            evidenceFingerprint:
              `bulk-fingerprint-${eventIndex}`,
            closeReason:
              "stable",
            reviewReady:
              true
          };
        }
      );


    await synchronizeDetectedEvents(
      database,
      "2026-08-01T00:00:00+09:00",
      "2026-08-02T00:00:00+09:00",
      events,
      [
        "2026-08-01"
      ],
      []
    );


    const countRow =
      await database
        .prepare(`
          SELECT COUNT(*) AS event_count
          FROM bed_ash_discharge_events
        `)
        .first();


    assert.equal(
      countRow.event_count,
      1488
    );
  }
);
