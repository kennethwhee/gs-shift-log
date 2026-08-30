import assert from "node:assert/strict";
import test from "node:test";

import {
  __bedAshTest
} from "../functions/api/bed-ash-discharge.js";


const {
  detectBedAshEvents,
  detectBedAshEventsForUnit,
  normalizeCompletedRequestSamples,
  synchronizeDetectedEvents
} =
  __bedAshTest;


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
  "event persistence uses at most 96 binds per bulk statement",
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
            7
        },
        (
          unused,
          eventIndex
        ) => {
          return {
            eventKey:
              `event-${eventIndex}`,

            algorithmVersion:
              "bed-ash-drop-v1",

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
      2
    );

    assert.deepEqual(
      upsertStatements.map(
        statement => {
          return statement.bindings.length;
        }
      ),
      [
        96,
        16
      ]
    );

    assert.equal(
      batches.length,
      1
    );
  }
);
