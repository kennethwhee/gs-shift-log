"use strict";


/* =========================================================
  효율팀 Bed Ash 반출 확인 API

  GET /api/bed-ash-discharge?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  - 완료된 bed_ash_level OIS 결과를 시간별 표본으로 정규화
  - 5.000 t 이상 하락한 반출 후보를 서버에서 판정
  - 확정 반출량과 미확인 예상량을 분리해 반환

  GET /api/bed-ash-discharge?mode=summary
  - 저장된 미확인 후보 요약만 반환 (OIS 요청 생성 없음)

  POST /api/bed-ash-discharge
  - PC 로그인 사용자의 확인/제외 검토 저장
  - revision 조건부 갱신 및 append-only 이력 저장
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const REQUEST_TYPE =
  "bed_ash_level";


const ALGORITHM_VERSION =
  "bed-ash-drop-v1";


const DISCHARGE_THRESHOLD_TON =
  5;


const LEVEL_NOISE_TOLERANCE_TON =
  0.5;


const MAXIMUM_EVENT_WINDOW_HOURS =
  8;


const MAXIMUM_SAMPLE_GAP_HOURS =
  2;


const MAXIMUM_QUERY_DAYS =
  31;


const EVENT_UPSERT_CHUNK_SIZE =
  6;


const KST_OFFSET_MILLISECONDS =
  9 * 60 * 60 * 1000;


const HOUR_MILLISECONDS =
  60 * 60 * 1000;


const SAMPLE_SETTLING_GRACE_MILLISECONDS =
  5 * 60 * 1000;


const UNIT_DEFINITIONS = {
  1: {
    unitNo:
      1,

    tagNumber:
      "104HDC01CW101XQ01"
  },

  2: {
    unitNo:
      2,

    tagNumber:
      "204HDC01CW101XQ01"
  }
};


function jsonResponse(
  data,
  status =
    200
) {
  return Response.json(
    data,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",

        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}


function normalizeText(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function normalizeEmployeeNo(
  value
) {
  return normalizeText(
    value
  ).replace(
    /\s+/g,
    ""
  );
}


function normalizeAccountRole(
  value
) {
  const normalizedRole =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );


  if (
    normalizedRole ===
      "super_admin" ||
    normalizedRole ===
      "superadmin"
  ) {
    return "super_admin";
  }


  if (
    normalizedRole ===
      "admin" ||
    normalizedRole ===
      "leader"
  ) {
    return "admin";
  }


  return "user";
}


function normalizeClientMode(
  request
) {
  return normalizeText(
    request.headers.get(
      "X-GS-Client-Mode"
    )
  )
    .toLowerCase()
    .replace(
      /[\s-]+/g,
      "_"
    );
}


function isMobileClient(
  request
) {
  const clientMode =
    normalizeClientMode(
      request
    );


  return (
    clientMode ===
      "app" ||
    clientMode ===
      "mobile_app" ||
    clientMode ===
      "mobile" ||
    clientMode.startsWith(
      "mobile_"
    )
  );
}


function roundToStoredPrecision(
  value
) {
  const numericValue =
    Number(
      value
    );


  return Number.isFinite(
    numericValue
  )
    ? Math.round(
        numericValue *
        1000
      ) /
      1000
    : null;
}


function getLevelDifferenceTon(
  highLevelTon,
  lowLevelTon
) {
  return roundToStoredPrecision(
    Number(
      highLevelTon
    ) -
    Number(
      lowLevelTon
    )
  ) ||
  0;
}


function isValidIsoDate(
  value
) {
  const normalizedDate =
    normalizeText(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalizedDate
    )
  ) {
    return false;
  }


  const parsedDate =
    new Date(
      `${normalizedDate}T00:00:00.000Z`
    );


  return (
    !Number.isNaN(
      parsedDate.getTime()
    ) &&
    parsedDate
      .toISOString()
      .slice(
        0,
        10
      ) ===
      normalizedDate
  );
}


function addIsoDateDays(
  dateValue,
  dayCount
) {
  const parsedDate =
    new Date(
      `${dateValue}T00:00:00.000Z`
    );


  parsedDate.setUTCDate(
    parsedDate.getUTCDate() +
    Number(
      dayCount ||
      0
    )
  );


  return parsedDate
    .toISOString()
    .slice(
      0,
      10
    );
}


function getDateRangeDayCount(
  startDate,
  endDate
) {
  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    )
  ) {
    return 0;
  }


  return Math.floor(
    (
      Date.parse(
        `${endDate}T00:00:00.000Z`
      ) -
      Date.parse(
        `${startDate}T00:00:00.000Z`
      )
    ) /
    (
      24 *
      HOUR_MILLISECONDS
    )
  ) +
  1;
}


function createDateRange(
  startDate,
  endDate
) {
  const dayCount =
    getDateRangeDayCount(
      startDate,
      endDate
    );


  if (
    dayCount <
      1
  ) {
    return [];
  }


  return Array.from(
    {
      length:
        dayCount
    },
    (
      unused,
      dayIndex
    ) => {
      return addIsoDateDays(
        startDate,
        dayIndex
      );
    }
  );
}


function padTwoDigits(
  value
) {
  return String(
    value
  ).padStart(
    2,
    "0"
  );
}


function formatKstIsoFromEpoch(
  epochMilliseconds
) {
  const shiftedDate =
    new Date(
      epochMilliseconds +
      KST_OFFSET_MILLISECONDS
    );


  return [
    shiftedDate.getUTCFullYear(),
    "-",
    padTwoDigits(
      shiftedDate.getUTCMonth() +
      1
    ),
    "-",
    padTwoDigits(
      shiftedDate.getUTCDate()
    ),
    "T",
    padTwoDigits(
      shiftedDate.getUTCHours()
    ),
    ":",
    padTwoDigits(
      shiftedDate.getUTCMinutes()
    ),
    ":",
    padTwoDigits(
      shiftedDate.getUTCSeconds()
    ),
    "+09:00"
  ].join(
    ""
  );
}


function getKstDateFromTimestamp(
  timestamp
) {
  const parsedTime =
    Date.parse(
      timestamp
    );


  if (
    !Number.isFinite(
      parsedTime
    )
  ) {
    return "";
  }


  return new Date(
    parsedTime +
    KST_OFFSET_MILLISECONDS
  )
    .toISOString()
    .slice(
      0,
      10
    );
}


function getExpectedSample(
  targetDate,
  hour
) {
  const normalizedHour =
    Number(
      hour
    );


  if (
    !isValidIsoDate(
      targetDate
    ) ||
    !Number.isInteger(
      normalizedHour
    ) ||
    normalizedHour <
      1 ||
    normalizedHour >
      24
  ) {
    return null;
  }


  const epochMilliseconds =
    Date.parse(
      `${targetDate}T00:00:00+09:00`
    ) +
    normalizedHour *
    HOUR_MILLISECONDS;


  return {
    epochMilliseconds,

    sampledAt:
      formatKstIsoFromEpoch(
        epochMilliseconds
      )
  };
}


function parseJsonObject(
  value
) {
  try {
    const parsedValue =
      typeof value ===
        "string"
        ? JSON.parse(
            value
          )
        : value;


    return (
      parsedValue &&
      typeof parsedValue ===
        "object" &&
      !Array.isArray(
        parsedValue
      )
    )
      ? parsedValue
      : {};

  } catch {
    return {};
  }
}


async function readJsonBody(
  request
) {
  try {
    return parseJsonObject(
      await request.json()
    );

  } catch {
    return {};
  }
}


function getBearerToken(
  request
) {
  const authorization =
    normalizeText(
      request.headers.get(
        "Authorization"
      )
    );


  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );


  return normalizeText(
    match?.[1]
  );
}


function bytesToHex(
  bytes
) {
  return [
    ...bytes
  ]
    .map(
      byte => {
        return byte
          .toString(
            16
          )
          .padStart(
            2,
            "0"
          );
      }
    )
    .join(
      ""
    );
}


async function hashText(
  value
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder()
        .encode(
          String(
            value ||
            ""
          )
        )
    );


  return bytesToHex(
    new Uint8Array(
      digest
    )
  );
}


async function getAuthenticatedUser(
  context
) {
  if (
    !context.env.DB
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "D1 바인딩 DB가 등록되지 않았습니다."
          },
          500
        )
    };
  }


  const token =
    getBearerToken(
      context.request
    );


  if (
    !token
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "로그인이 필요합니다."
          },
          401
        )
    };
  }


  const tokenHash =
    await hashText(
      token
    );


  const session =
    await context.env.DB
      .prepare(`
        SELECT
          session.employee_no,
          session.expires_at,
          session.last_used_at,
          user.name,
          user.role,
          user.is_active

        FROM shift_log_sessions AS session

        INNER JOIN users AS user
          ON user.employee_no = session.employee_no

        WHERE session.token_hash = ?

        LIMIT 1
      `)
      .bind(
        tokenHash
      )
      .first();


  const now =
    new Date();


  const expiresAt =
    new Date(
      session?.expires_at ||
      0
    );


  if (
    !session ||
    Number(
      session.is_active
    ) !==
      1 ||
    Number.isNaN(
      expiresAt.getTime()
    ) ||
    expiresAt <=
      now
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
          },
          401
        )
    };
  }


  const employeeNo =
    normalizeEmployeeNo(
      session.employee_no
    );


  const previousLastUsedAt =
    new Date(
      session.last_used_at ||
      0
    );


  if (
    Number.isNaN(
      previousLastUsedAt.getTime()
    ) ||
    now.getTime() -
      previousLastUsedAt.getTime() >=
      5 *
      60 *
      1000
  ) {
    await context.env.DB
      .prepare(`
        UPDATE shift_log_sessions

        SET last_used_at = ?
        WHERE token_hash = ?
      `)
      .bind(
        now.toISOString(),
        tokenHash
      )
      .run();
  }


  return {
    user: {
      employeeNo,

      name:
        normalizeText(
          session.name
        ),

      role:
        employeeNo ===
          FORCED_SUPER_ADMIN_EMPLOYEE_NO
          ? "super_admin"
          : normalizeAccountRole(
              session.role
            )
    }
  };
}


async function ensureSchema(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        bed_ash_discharge_events (
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


  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_bed_ash_events_range_v1

      ON bed_ash_discharge_events (
        threshold_crossed_at,
        candidate_active,
        status,
        unit_no
      )
    `)
    .run();


  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        bed_ash_discharge_review_history (
          history_id TEXT PRIMARY KEY,
          event_key TEXT NOT NULL,
          event_revision INTEGER NOT NULL,
          previous_status TEXT NOT NULL,
          new_status TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          reviewed_by_id TEXT NOT NULL,
          reviewed_by_name TEXT NOT NULL,
          reviewed_at TEXT NOT NULL
        )
    `)
    .run();


  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_bed_ash_review_history_event_v1

      ON bed_ash_discharge_review_history (
        event_key,
        event_revision DESC,
        reviewed_at DESC
      )
    `)
    .run();
}


function normalizeCompletedRequestSamples(
  requestRow,
  nowMilliseconds =
    Date.now()
) {
  const targetDate =
    normalizeText(
      requestRow?.target_date
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return [];
  }


  const result =
    parseJsonObject(
      requestRow?.result_json
    );


  const immutableCutoffCandidates = [
    Number(
      nowMilliseconds
    )
  ];


  [
    result.collectedAt,
    result.collected_at,
    requestRow?.completed_at
  ].forEach(
    value => {
      const parsedTime =
        Date.parse(
          normalizeText(
            value
          )
        );


      if (
        Number.isFinite(
          parsedTime
        )
      ) {
        immutableCutoffCandidates.push(
          parsedTime
        );
      }
    }
  );


  const maximumSampleTime =
    Math.min(
      ...immutableCutoffCandidates
    ) -
    SAMPLE_SETTLING_GRACE_MILLISECONDS;


  const resultTargetDate =
    normalizeText(
      result.targetDate ||
      result.target_date
    );


  if (
    resultTargetDate &&
    resultTargetDate !==
      targetDate
  ) {
    return [];
  }


  const units =
    Array.isArray(
      result.units
    )
      ? result.units
      : [];


  const normalizedSampleMap =
    new Map();


  units.forEach(
    rawUnit => {
      const unitNo =
        Number(
          rawUnit?.unitNo ??
          rawUnit?.unit
        );


      const definition =
        UNIT_DEFINITIONS[
          unitNo
        ];


      const tagNumber =
        normalizeText(
          rawUnit?.tagNumber ||
          rawUnit?.tag
        ).toUpperCase();


      if (
        !definition ||
        tagNumber !==
          definition.tagNumber
      ) {
        return;
      }


      const samples =
        Array.isArray(
          rawUnit?.samples
        )
          ? rawUnit.samples
          : [];


      samples.forEach(
        rawSample => {
          const expectedSample =
            getExpectedSample(
              targetDate,
              Number(
                rawSample?.hour
              )
            );


          const rawLevelTon =
            rawSample?.levelTon ??
            rawSample?.value;


          if (
            rawLevelTon ===
              null ||
            typeof rawLevelTon ===
              "undefined" ||
            normalizeText(
              rawLevelTon
            ) ===
              ""
          ) {
            return;
          }


          const levelTon =
            roundToStoredPrecision(
              rawLevelTon
            );


          if (
            !expectedSample ||
            levelTon ===
              null
          ) {
            return;
          }


          const suppliedSampledAt =
            normalizeText(
              rawSample?.sampledAt ||
              rawSample?.sampled_at
            );


          if (
            suppliedSampledAt
          ) {
            const suppliedTime =
              Date.parse(
                suppliedSampledAt
              );


            if (
              !Number.isFinite(
                suppliedTime
              ) ||
              Math.abs(
                suppliedTime -
                expectedSample.epochMilliseconds
              ) >
                60 *
                1000
            ) {
              return;
            }
          }


          /*
            현재 날짜의 OIS hd 미래 칸은 0으로 채워질 수 있다.
            값 자체가 0인지와 무관하게 아직 오지 않은 정시는
            표본으로 저장하지 않는다.
          */
          if (
            expectedSample.epochMilliseconds >
              maximumSampleTime
          ) {
            return;
          }


          const normalizedSample = {
            unitNo:
              definition.unitNo,

            tagNumber:
              definition.tagNumber,

            sampledAt:
              expectedSample.sampledAt,

            sampleDate:
              getKstDateFromTimestamp(
                expectedSample.sampledAt
              ),

            sourceDate:
              targetDate,

            levelTon,

            sourceRequestId:
              normalizeText(
                requestRow?.id
              ),

            sourceCompletedAt:
              normalizeText(
                requestRow?.completed_at ||
                requestRow?.updated_at ||
                requestRow?.requested_at
              )
          };


          normalizedSampleMap.set(
            `${unitNo}:${normalizedSample.sampledAt}`,
            normalizedSample
          );
        }
      );
    }
  );


  return [
    ...normalizedSampleMap.values()
  ].sort(
    (
      firstSample,
      secondSample
    ) => {
      return (
        firstSample.sampledAt.localeCompare(
          secondSample.sampledAt
        ) ||
        firstSample.unitNo -
          secondSample.unitNo
      );
    }
  );
}


async function runStatementsInChunks(
  database,
  statements,
  chunkSize =
    75
) {
  for (
    let statementIndex =
      0;
    statementIndex <
      statements.length;
    statementIndex +=
      chunkSize
  ) {
    await database.batch(
      statements.slice(
        statementIndex,
        statementIndex +
        chunkSize
      )
    );
  }
}


function isAllowedSampleGap(
  firstSample,
  secondSample
) {
  const gapHours =
    (
      secondSample.epochMilliseconds -
      firstSample.epochMilliseconds
    ) /
    HOUR_MILLISECONDS;


  return (
    Number.isInteger(
      gapHours
    ) &&
    gapHours >=
      1 &&
    gapHours <=
      MAXIMUM_SAMPLE_GAP_HOURS
  );
}


function buildEventCandidate(
  unitNo,
  candidate,
  closeReason
) {
  if (
    !candidate?.thresholdCrossedAt
  ) {
    return null;
  }


  const estimatedTon =
    getLevelDifferenceTon(
      candidate.start.levelTon,
      candidate.trough.levelTon
    );


  if (
    estimatedTon ===
      null ||
    estimatedTon <
      DISCHARGE_THRESHOLD_TON
  ) {
    return null;
  }


  const descentHours =
    (
      candidate.trough.epochMilliseconds -
      candidate.start.epochMilliseconds
    ) /
    HOUR_MILLISECONDS;


  const containsTwoHourGap =
    candidate.points.some(
      (
        point,
        pointIndex
      ) => {
        if (
          pointIndex ===
            0
        ) {
          return false;
        }


        return (
          point.epochMilliseconds -
          candidate.points[
            pointIndex -
            1
          ].epochMilliseconds
        ) /
        HOUR_MILLISECONDS ===
          2;
      }
    );


  let confidence =
    "high";


  if (
    descentHours <=
      1
  ) {
    confidence =
      "low";

  } else if (
    containsTwoHourGap ||
    descentHours <=
      2 ||
    closeReason ===
      "data_end"
  ) {
    confidence =
      "medium";
  }


  return {
    algorithmVersion:
      ALGORITHM_VERSION,

    unitNo,

    tagNumber:
      UNIT_DEFINITIONS[
        unitNo
      ].tagNumber,

    startAt:
      candidate.start.sampledAt,

    endAt:
      candidate.trough.sampledAt,

    thresholdCrossedAt:
      candidate.thresholdCrossedAt,

    startLevelTon:
      candidate.start.levelTon,

    endLevelTon:
      candidate.trough.levelTon,

    estimatedTon,

    confidence,

    closeReason,

    evidencePoints:
      candidate.points.map(
        point => {
          return {
            sampledAt:
              point.sampledAt,

            levelTon:
              point.levelTon
          };
        }
      )
  };
}


function detectBedAshEventsForUnit(
  unitNo,
  rawSamples
) {
  const definition =
    UNIT_DEFINITIONS[
      unitNo
    ];


  if (
    !definition
  ) {
    return [];
  }


  const sampleMap =
    new Map();


  rawSamples.forEach(
    rawSample => {
      const sampledAt =
        normalizeText(
          rawSample?.sampledAt
        );


      const epochMilliseconds =
        Number.isFinite(
          rawSample?.epochMilliseconds
        )
          ? rawSample.epochMilliseconds
          : Date.parse(
              sampledAt
            );


      const levelTon =
        roundToStoredPrecision(
          rawSample?.levelTon
        );


      if (
        !sampledAt ||
        !Number.isFinite(
          epochMilliseconds
        ) ||
        levelTon ===
          null
      ) {
        return;
      }


      sampleMap.set(
        sampledAt,
        {
          ...rawSample,
          sampledAt,
          epochMilliseconds,
          levelTon
        }
      );
    }
  );


  const samples =
    [
      ...sampleMap.values()
    ].sort(
      (
        firstSample,
        secondSample
      ) => {
        return firstSample.epochMilliseconds -
          secondSample.epochMilliseconds;
      }
    );


  const detectedEvents =
    [];


  let recentSamples =
    [];


  let candidate =
    null;


  const appendCandidate =
    closeReason => {
      const detectedEvent =
        buildEventCandidate(
          unitNo,
          candidate,
          closeReason
        );


      if (
        detectedEvent
      ) {
        detectedEvents.push(
          detectedEvent
        );
      }
    };


  const rebuildRecentSamples =
    points => {
      if (
        points.length ===
          0
      ) {
        recentSamples =
          [];

        return;
      }


      const finalPoint =
        points[
          points.length -
          1
        ];


      recentSamples =
        points.filter(
          point => {
            return (
              finalPoint.epochMilliseconds -
              point.epochMilliseconds
            ) <=
              MAXIMUM_EVENT_WINDOW_HOURS *
              HOUR_MILLISECONDS;
          }
        );
    };


  const startCandidateFromRecentSamples =
    sample => {
      const peakSample =
        recentSamples.reduce(
          (
            highestSample,
            currentSample
          ) => {
            return (
              !highestSample ||
              currentSample.levelTon >
                highestSample.levelTon
            )
              ? currentSample
              : highestSample;
          },
          null
        );


      if (
        !peakSample ||
        peakSample.sampledAt ===
          sample.sampledAt ||
        getLevelDifferenceTon(
          peakSample.levelTon,
          sample.levelTon
        ) <=
          LEVEL_NOISE_TOLERANCE_TON
      ) {
        return;
      }


      const peakIndex =
        recentSamples.findIndex(
          point => {
            return point.sampledAt ===
              peakSample.sampledAt;
          }
        );


      candidate = {
        start:
          peakSample,

        trough:
          sample,

        thresholdCrossedAt:
          getLevelDifferenceTon(
            peakSample.levelTon,
            sample.levelTon
          ) >=
            DISCHARGE_THRESHOLD_TON
            ? sample.sampledAt
            : "",

        stableCount:
          0,

        points:
          recentSamples.slice(
            Math.max(
              0,
              peakIndex
            )
          )
      };
    };


  for (
    const sample of
      samples
  ) {
    const previousSample =
      candidate?.points?.[
        candidate.points.length -
        1
      ] ||
      recentSamples[
        recentSamples.length -
        1
      ] ||
      null;


    if (
      previousSample &&
      !isAllowedSampleGap(
        previousSample,
        sample
      )
    ) {
      appendCandidate(
        "data_gap"
      );

      candidate =
        null;

      recentSamples = [
        sample
      ];

      continue;
    }


    if (
      candidate
    ) {
      const elapsedHours =
        (
          sample.epochMilliseconds -
          candidate.start.epochMilliseconds
        ) /
        HOUR_MILLISECONDS;


      if (
        elapsedHours >
          MAXIMUM_EVENT_WINDOW_HOURS
      ) {
        const candidateWasTriggered =
          Boolean(
            candidate.thresholdCrossedAt
          );


        const previousCandidatePoints =
          candidate.points;


        appendCandidate(
          "max_window"
        );

        candidate =
          null;

        if (
          candidateWasTriggered
        ) {
          recentSamples = [
            sample
          ];

        } else {
          rebuildRecentSamples([
            ...previousCandidatePoints,
            sample
          ]);

          startCandidateFromRecentSamples(
            sample
          );
        }

        continue;
      }


      candidate.points.push(
        sample
      );


      if (
        sample.levelTon <
          candidate.trough.levelTon
      ) {
        candidate.trough =
          sample;

        candidate.stableCount =
          0;

      } else if (
        getLevelDifferenceTon(
          sample.levelTon,
          candidate.trough.levelTon
        ) <=
          LEVEL_NOISE_TOLERANCE_TON
      ) {
        candidate.stableCount +=
          1;

      } else {
        appendCandidate(
          "refill"
        );

        candidate =
          null;

        recentSamples = [
          sample
        ];

        continue;
      }


      if (
        candidate &&
        !candidate.thresholdCrossedAt &&
        getLevelDifferenceTon(
          candidate.start.levelTon,
          candidate.trough.levelTon
        ) >=
          DISCHARGE_THRESHOLD_TON
      ) {
        candidate.thresholdCrossedAt =
          sample.sampledAt;
      }


      if (
        candidate?.thresholdCrossedAt &&
        candidate.stableCount >=
          2
      ) {
        appendCandidate(
          "stable"
        );

        candidate =
          null;

        recentSamples = [
          sample
        ];

        continue;
      }


      if (
        candidate
      ) {
        continue;
      }
    }


    recentSamples.push(
      sample
    );


    rebuildRecentSamples(
      recentSamples
    );

    startCandidateFromRecentSamples(
      sample
    );
  }


  appendCandidate(
    "data_end"
  );


  return detectedEvents;
}


async function attachEventIdentity(
  rawEvent
) {
  const eventKey =
    [
      rawEvent.algorithmVersion,
      `u${rawEvent.unitNo}`,
      rawEvent.thresholdCrossedAt
    ].join(
      ":"
    );


  const evidenceFingerprint =
    await hashText(
      JSON.stringify({
        algorithmVersion:
          rawEvent.algorithmVersion,

        unitNo:
          rawEvent.unitNo,

        startAt:
          rawEvent.startAt,

        endAt:
          rawEvent.endAt,

        thresholdCrossedAt:
          rawEvent.thresholdCrossedAt,

        startLevelTon:
          rawEvent.startLevelTon,

        endLevelTon:
          rawEvent.endLevelTon,

        estimatedTon:
          rawEvent.estimatedTon,

        closeReason:
          rawEvent.closeReason,

        evidencePoints:
          rawEvent.evidencePoints
      })
    );


  return {
    ...rawEvent,
    eventKey,
    evidenceFingerprint
  };
}


async function detectBedAshEvents(
  samples
) {
  const rawEvents =
    [
      1,
      2
    ].flatMap(
      unitNo => {
        return detectBedAshEventsForUnit(
          unitNo,
          samples.filter(
            sample => {
              return sample.unitNo ===
                unitNo;
            }
          )
        );
      }
    );


  return await Promise.all(
    rawEvents.map(
      attachEventIdentity
    )
  );
}


async function findOisRequestRows(
  database,
  startDate,
  endDate
) {
  const queryResult =
    await database
      .prepare(`
        SELECT
          id,
          target_date,
          status,
          result_json,
          error_message,
          requested_at,
          completed_at,
          updated_at

        FROM ois_data_requests

        WHERE request_type = ?
          AND target_date >= ?
          AND target_date <= ?

        ORDER BY
          target_date ASC,
          COALESCE(
            completed_at,
            updated_at,
            requested_at,
            ''
          ) DESC,
          requested_at DESC,
          id DESC
      `)
      .bind(
        REQUEST_TYPE,
        startDate,
        endDate
      )
      .all();


  return Array.isArray(
    queryResult.results
  )
    ? queryResult.results
    : [];
}


function selectRequestRowsByDate(
  rows
) {
  const latestByDate =
    new Map();


  const completedByDate =
    new Map();


  rows.forEach(
    row => {
      const targetDate =
        normalizeText(
          row.target_date
        );


      if (
        !isValidIsoDate(
          targetDate
        )
      ) {
        return;
      }


      if (
        !latestByDate.has(
          targetDate
        )
      ) {
        latestByDate.set(
          targetDate,
          row
        );
      }


      if (
        normalizeText(
          row.status
        ) ===
          "complete" &&
        normalizeText(
          row.result_json
        ) &&
        !completedByDate.has(
          targetDate
        )
      ) {
        completedByDate.set(
          targetDate,
          row
        );
      }
    }
  );


  return {
    latestByDate,
    completedByDate
  };
}


function buildCoverage(
  dates,
  latestByDate,
  completedByDate,
  baselineDate
) {
  const completeDates =
    [];


  const missingDates =
    [];


  const pendingDates =
    [];


  const failedDates =
    [];


  const requests =
    [];


  dates.forEach(
    date => {
      const latestRequest =
        latestByDate.get(
          date
        ) ||
        null;


      const completedRequest =
        completedByDate.get(
          date
        ) ||
        null;


      if (
        completedRequest
      ) {
        completeDates.push(
          date
        );
      }


      if (
        !latestRequest
      ) {
        missingDates.push(
          date
        );

      } else {
        const status =
          normalizeText(
            latestRequest.status
          );


        if (
          status ===
            "pending" ||
          status ===
            "processing"
        ) {
          pendingDates.push(
            date
          );

        } else if (
          status ===
            "failed" ||
          status ===
            "expired"
        ) {
          failedDates.push(
            date
          );
        }


        requests.push({
          date,

          status,

          requestId:
            normalizeText(
              latestRequest.id
            ),

          updatedAt:
            normalizeText(
              latestRequest.completed_at ||
              latestRequest.updated_at ||
              latestRequest.requested_at
            ),

          errorMessage:
            normalizeText(
              latestRequest.error_message
            )
        });
      }
    }
  );


  const baselineRequest =
    latestByDate.get(
      baselineDate
    ) ||
    null;


  const baselineComplete =
    completedByDate.has(
      baselineDate
    );


  return {
    dates,
    completeDates,
    missingDates,
    pendingDates,
    failedDates,
    requests,

    baseline: {
      date:
        baselineDate,

      status:
        normalizeText(
          baselineRequest?.status
        ) ||
        "missing",

      complete:
        baselineComplete,

      missing:
        !baselineComplete,

      requestId:
        normalizeText(
          baselineRequest?.id
        ) ||
        null,

      updatedAt:
        normalizeText(
          baselineRequest?.completed_at ||
          baselineRequest?.updated_at ||
          baselineRequest?.requested_at
        ) ||
        null,

      errorMessage:
        normalizeText(
          baselineRequest?.error_message
        )
    }
  };
}


async function synchronizeDetectedEvents(
  database,
  startTimestamp,
  endTimestampExclusive,
  detectedEvents
) {
  const now =
    new Date()
      .toISOString();


  await database
    .prepare(`
      UPDATE bed_ash_discharge_events

      SET
        candidate_active = 0,
        updated_at = ?

      WHERE threshold_crossed_at >= ?
        AND threshold_crossed_at < ?
        AND status = 'pending'
    `)
    .bind(
      now,
      startTimestamp,
      endTimestampExclusive
    )
    .run();


  const statements =
    [];


  for (
    let eventIndex =
      0;
    eventIndex <
      detectedEvents.length;
    eventIndex +=
      EVENT_UPSERT_CHUNK_SIZE
  ) {
    const eventChunk =
      detectedEvents.slice(
        eventIndex,
        eventIndex +
        EVENT_UPSERT_CHUNK_SIZE
      );


    const valueClauses =
      eventChunk.map(
        () => {
          return `(
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            'pending', NULL, NULL, '', '', '', NULL,
            1, 1, ?, ?, ?
          )`;
        }
      ).join(
        ",\n"
      );


    const bindings =
      eventChunk.flatMap(
        event => {
          return [
            event.eventKey,
            event.algorithmVersion,
            event.unitNo,
            event.tagNumber,
            event.startAt,
            event.endAt,
            event.thresholdCrossedAt,
            event.startLevelTon,
            event.endLevelTon,
            event.estimatedTon,
            event.confidence,
            event.evidenceFingerprint,
            event.closeReason,
            now,
            now,
            now
          ];
        }
      );


    statements.push(
      database
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
              first_detected_at,
              last_detected_at,
              updated_at
            )
            VALUES ${valueClauses}

            ON CONFLICT (event_key)
            DO UPDATE SET
              algorithm_version = excluded.algorithm_version,
              unit_no = excluded.unit_no,
              tag_number = excluded.tag_number,
              event_start_at = excluded.event_start_at,
              event_end_at = excluded.event_end_at,
              threshold_crossed_at = excluded.threshold_crossed_at,
              start_level_ton = excluded.start_level_ton,
              end_level_ton = excluded.end_level_ton,
              estimated_ton = excluded.estimated_ton,
              confidence = excluded.confidence,
              close_reason = excluded.close_reason,
              evidence_fingerprint = excluded.evidence_fingerprint,
              revision = CASE
                WHEN bed_ash_discharge_events.evidence_fingerprint <>
                     excluded.evidence_fingerprint
                  THEN bed_ash_discharge_events.revision + 1
                ELSE bed_ash_discharge_events.revision
              END,
              candidate_active = 1,
              last_detected_at = excluded.last_detected_at,
              updated_at = excluded.updated_at

            WHERE bed_ash_discharge_events.status = 'pending'
          `)
        .bind(
          ...bindings
        )
    );
  }


  await runStatementsInChunks(
    database,
    statements
  );
}


function convertEventRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  const reviewedAt =
    normalizeText(
      row.reviewed_at
    );


  const reviewerEmployeeNo =
    normalizeText(
      row.reviewed_by_id
    );


  const reviewerName =
    normalizeText(
      row.reviewed_by_name
    );


  return {
    eventKey:
      normalizeText(
        row.event_key
      ),

    revision:
      Math.max(
        1,
        Number(
          row.revision
        ) ||
        1
      ),

    unitNo:
      Number(
        row.unit_no
      ),

    tagNumber:
      normalizeText(
        row.tag_number
      ),

    startAt:
      normalizeText(
        row.event_start_at
      ),

    endAt:
      normalizeText(
        row.event_end_at
      ),

    thresholdCrossedAt:
      normalizeText(
        row.threshold_crossed_at
      ),

    startLevelTon:
      roundToStoredPrecision(
        row.start_level_ton
      ),

    endLevelTon:
      roundToStoredPrecision(
        row.end_level_ton
      ),

    estimatedTon:
      roundToStoredPrecision(
        row.estimated_ton
      ),

    confidence:
      normalizeText(
        row.confidence
      ) ||
      "medium",

    status:
      [
        "confirmed",
        "excluded"
      ].includes(
        normalizeText(
          row.status
        )
      )
        ? normalizeText(
            row.status
          )
        : "pending",

    confirmedAt:
      normalizeText(
        row.confirmed_at
      ) ||
      null,

    confirmedTon:
      row.confirmed_ton ===
        null ||
      typeof row.confirmed_ton ===
        "undefined"
        ? null
        : roundToStoredPrecision(
            row.confirmed_ton
          ),

    note:
      normalizeText(
        row.note
      ),

    reviewer:
      reviewedAt ||
      reviewerEmployeeNo ||
      reviewerName
        ? {
            employeeNo:
              reviewerEmployeeNo,

            name:
              reviewerName,

            reviewedAt:
              reviewedAt ||
              null
          }
        : null,

    evidenceFingerprint:
      normalizeText(
        row.evidence_fingerprint
      )
  };
}


async function findActiveEventRows(
  database,
  startTimestamp,
  endTimestampExclusive
) {
  const queryResult =
    await database
      .prepare(`
        SELECT *

        FROM bed_ash_discharge_events

        WHERE (
          status = 'pending'
          AND candidate_active = 1
          AND datetime(
            threshold_crossed_at
          ) >= datetime(?)
          AND datetime(
            threshold_crossed_at
          ) < datetime(?)
        )

        OR (
          status = 'confirmed'
          AND datetime(
            confirmed_at
          ) >= datetime(?)
          AND datetime(
            confirmed_at
          ) < datetime(?)
        )

        OR (
          status = 'excluded'
          AND datetime(
            threshold_crossed_at
          ) >= datetime(?)
          AND datetime(
            threshold_crossed_at
          ) < datetime(?)
        )

        ORDER BY
          CASE status
            WHEN 'confirmed' THEN datetime(
              confirmed_at
            )
            WHEN 'excluded' THEN datetime(
              threshold_crossed_at
            )
            ELSE datetime(
              threshold_crossed_at
            )
          END DESC,
          unit_no ASC,
          event_key ASC
      `)
      .bind(
        startTimestamp,
        endTimestampExclusive,
        startTimestamp,
        endTimestampExclusive,
        startTimestamp,
        endTimestampExclusive
      )
      .all();


  return (
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : []
  ).map(
    convertEventRow
  );
}


function buildSummary(
  events
) {
  const confirmedEvents =
    events.filter(
      event => {
        return event.status ===
          "confirmed";
      }
    );


  const pendingEvents =
    events.filter(
      event => {
        return event.status ===
          "pending";
      }
    );


  const sumTon =
    (
      sourceEvents,
      tonSelector
    ) => {
      return roundToStoredPrecision(
        sourceEvents.reduce(
          (
            totalTon,
            event
          ) => {
            return totalTon +
              Number(
                tonSelector(
                  event
                ) ||
                0
              );
          },
          0
        )
      ) ||
      0;
    };


  return {
    confirmedCount:
      confirmedEvents.length,

    confirmedTon:
      sumTon(
        confirmedEvents,
        event => {
          return event.confirmedTon;
        }
      ),

    pendingCount:
      pendingEvents.length,

    pendingEstimatedTon:
      sumTon(
        pendingEvents,
        event => {
          return event.estimatedTon;
        }
      ),

    unit1Ton:
      sumTon(
        confirmedEvents.filter(
          event => {
            return event.unitNo ===
              1;
          }
        ),
        event => {
          return event.confirmedTon;
        }
      ),

    unit2Ton:
      sumTon(
        confirmedEvents.filter(
          event => {
            return event.unitNo ===
              2;
          }
        ),
        event => {
          return event.confirmedTon;
        }
      )
  };
}


function buildLatestLevels(
  samples,
  startTimestamp,
  endTimestampExclusive
) {
  const latestLevels = {
    1:
      null,

    2:
      null
  };


  samples.forEach(
    sample => {
      if (
        sample.sampledAt <
          startTimestamp ||
        sample.sampledAt >=
          endTimestampExclusive
      ) {
        return;
      }


      const currentLatest =
        latestLevels[
          sample.unitNo
        ];


      if (
        !currentLatest ||
        sample.sampledAt >
          currentLatest.sampledAt
      ) {
        latestLevels[
          sample.unitNo
        ] = {
          unitNo:
            sample.unitNo,

          tagNumber:
            sample.tagNumber,

          sampledAt:
            sample.sampledAt,

          levelTon:
            sample.levelTon,

          sourceDate:
            sample.sourceDate
        };
      }
    }
  );


  return latestLevels;
}


async function handleSummaryGet(
  context
) {
  const queryResult =
    await context.env.DB
      .prepare(`
        SELECT *

        FROM bed_ash_discharge_events

        WHERE candidate_active = 1
          AND status = 'pending'

        ORDER BY
          threshold_crossed_at DESC,
          unit_no ASC
      `)
      .all();


  const pendingRows =
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : [];


  return jsonResponse({
    ok:
      true,

    data: {
      pendingCount:
        pendingRows.length,

      latestPending:
        pendingRows.length >
          0
          ? convertEventRow(
              pendingRows[0]
            )
          : null
    }
  });
}


async function handleRangeGet(
  context,
  requestUrl
) {
  const startDate =
    normalizeText(
      requestUrl.searchParams.get(
        "startDate"
      ) ||
      requestUrl.searchParams.get(
        "start_date"
      )
    );


  const endDate =
    normalizeText(
      requestUrl.searchParams.get(
        "endDate"
      ) ||
      requestUrl.searchParams.get(
        "end_date"
      )
    );


  const dayCount =
    getDateRangeDayCount(
      startDate,
      endDate
    );


  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    ) ||
    dayCount <
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "Bed Ash 조회 시작일과 종료일을 확인해 주세요."
      },
      400
    );
  }


  if (
    dayCount >
      MAXIMUM_QUERY_DAYS
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          `Bed Ash 반출 이력은 한 번에 최대 ${MAXIMUM_QUERY_DAYS}일까지 조회할 수 있습니다.`
      },
      400
    );
  }


  const dates =
    createDateRange(
      startDate,
      endDate
    );


  const baselineDate =
    addIsoDateDays(
      startDate,
      -1
    );


  const detectorEndDate =
    addIsoDateDays(
      endDate,
      1
    );


  const requestRows =
    await findOisRequestRows(
      context.env.DB,
      baselineDate,
      detectorEndDate
    );


  const {
    latestByDate,
    completedByDate
  } =
    selectRequestRowsByDate(
      requestRows
    );


  const normalizedSamples =
    [];


  completedByDate.forEach(
    completedRow => {
      normalizedSamples.push(
        ...normalizeCompletedRequestSamples(
          completedRow
        )
      );
    }
  );


  const startTimestamp =
    `${startDate}T00:00:00+09:00`;


  const baselineTimestamp =
    `${baselineDate}T00:00:00+09:00`;


  const endTimestampExclusive =
    `${addIsoDateDays(
      endDate,
      1
    )}T00:00:00+09:00`;


  const detectorEndTimestamp =
    formatKstIsoFromEpoch(
      Date.parse(
        endTimestampExclusive
      ) +
      MAXIMUM_EVENT_WINDOW_HOURS *
      HOUR_MILLISECONDS
    );


  const detectionSamples =
    normalizedSamples.filter(
      sample => {
        return (
          sample.sampledAt >=
            baselineTimestamp &&
          sample.sampledAt <=
            detectorEndTimestamp
        );
      }
    );


  const allDetectedEvents =
    await detectBedAshEvents(
      detectionSamples
    );


  const rangeDetectedEvents =
    allDetectedEvents.filter(
      event => {
        return (
          event.thresholdCrossedAt >=
            startTimestamp &&
          event.thresholdCrossedAt <
            endTimestampExclusive
        );
      }
    );


  await synchronizeDetectedEvents(
    context.env.DB,
    startTimestamp,
    endTimestampExclusive,
    rangeDetectedEvents
  );


  const events =
    await findActiveEventRows(
      context.env.DB,
      startTimestamp,
      endTimestampExclusive
    );


  return jsonResponse({
    ok:
      true,

    data: {
      range: {
        startDate,
        endDate
      },

      events,

      summary:
        buildSummary(
          events
        ),

      latestLevels:
        buildLatestLevels(
          detectionSamples,
          startTimestamp,
          endTimestampExclusive
        ),

      coverage:
        buildCoverage(
          dates,
          latestByDate,
          completedByDate,
          baselineDate
        )
    }
  });
}


function normalizeConfirmedAt(
  value,
  defaultTimestamp
) {
  const normalizedValue =
    normalizeText(
      value
    );


  if (
    !normalizedValue
  ) {
    return defaultTimestamp;
  }


  let parseValue =
    normalizedValue;


  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      parseValue
    )
  ) {
    parseValue =
      `${parseValue}T00:00:00+09:00`;

  } else if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(
      parseValue
    )
  ) {
    parseValue =
      `${parseValue}+09:00`;
  }


  const parsedTime =
    Date.parse(
      parseValue
    );


  return Number.isFinite(
    parsedTime
  )
    ? formatKstIsoFromEpoch(
        parsedTime
      )
    : "";
}


async function findEventRowByKey(
  database,
  eventKey
) {
  return await database
    .prepare(`
      SELECT *

      FROM bed_ash_discharge_events

      WHERE event_key = ?

      LIMIT 1
    `)
    .bind(
      eventKey
    )
    .first();
}


function createConflictResponse(
  currentEvent,
  message =
    "Bed Ash 반출 후보가 변경되었습니다. 최신 자료를 다시 확인해 주세요."
) {
  return jsonResponse(
    {
      ok:
        false,

      message,

      data: {
        currentEvent:
          currentEvent ||
          null
      }
    },
    409
  );
}


async function recomputeEventByKey(
  database,
  eventRow
) {
  const eventStartTime =
    Date.parse(
      eventRow.event_start_at
    );


  const eventEndTime =
    Date.parse(
      eventRow.event_end_at
    );


  if (
    !Number.isFinite(
      eventStartTime
    ) ||
    !Number.isFinite(
      eventEndTime
    )
  ) {
    return null;
  }


  const queryStart =
    formatKstIsoFromEpoch(
      eventStartTime -
      MAXIMUM_EVENT_WINDOW_HOURS *
      HOUR_MILLISECONDS
    );


  const queryEnd =
    formatKstIsoFromEpoch(
      eventEndTime +
      MAXIMUM_EVENT_WINDOW_HOURS *
      HOUR_MILLISECONDS
    );


  const queryStartDate =
    addIsoDateDays(
      getKstDateFromTimestamp(
        eventRow.event_start_at
      ),
      -1
    );


  const queryEndDate =
    addIsoDateDays(
      getKstDateFromTimestamp(
        eventRow.event_end_at
      ),
      1
    );


  const requestRows =
    await findOisRequestRows(
      database,
      queryStartDate,
      queryEndDate
    );


  const {
    completedByDate
  } =
    selectRequestRowsByDate(
      requestRows
    );


  const samples =
    [];


  completedByDate.forEach(
    completedRow => {
      samples.push(
        ...normalizeCompletedRequestSamples(
          completedRow
        )
      );
    }
  );


  const events =
    await detectBedAshEvents(
      samples.filter(
        sample => {
          return (
            sample.unitNo ===
              Number(
                eventRow.unit_no
              ) &&
            sample.sampledAt >=
              queryStart &&
            sample.sampledAt <=
              queryEnd
          );
        }
      )
    );


  return events.find(
    event => {
      return event.eventKey ===
        normalizeText(
          eventRow.event_key
        );
    }
  ) ||
  null;
}


async function handleReviewPost(
  context,
  body,
  user
) {
  if (
    normalizeText(
      body.action
    )
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      ) !==
      "review"
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "지원하지 않는 Bed Ash 작업입니다."
      },
      400
    );
  }


  const eventKey =
    normalizeText(
      body.eventKey ||
      body.event_key
    ).slice(
      0,
      500
    );


  const expectedRevision =
    Number(
      body.revision
    );


  const status =
    normalizeText(
      body.status
    )
      .toLowerCase();


  if (
    !eventKey ||
    !Number.isInteger(
      expectedRevision
    ) ||
    expectedRevision <
      1 ||
    ![
      "confirmed",
      "excluded"
    ].includes(
      status
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "반출 후보, revision, 확인 상태를 확인해 주세요."
      },
      400
    );
  }


  const existingRow =
    await findEventRowByKey(
      context.env.DB,
      eventKey
    );


  if (
    !existingRow
  ) {
    return createConflictResponse(
      null,
      "확인할 Bed Ash 반출 후보가 더 이상 존재하지 않습니다."
    );
  }


  if (
    normalizeText(
      existingRow.status
    ) !==
      "pending" ||
    Number(
      existingRow.candidate_active
    ) !==
      1
  ) {
    return createConflictResponse(
      convertEventRow(
        existingRow
      ),
      "이미 검토되었거나 현재 유효하지 않은 Bed Ash 반출 후보입니다."
    );
  }


  const recomputedEvent =
    await recomputeEventByKey(
      context.env.DB,
      existingRow
    );


  if (
    !recomputedEvent
  ) {
    return createConflictResponse(
      convertEventRow(
        existingRow
      ),
      "현재 시간별 Level에서 해당 반출 후보를 다시 확인할 수 없습니다."
    );
  }


  if (
    normalizeText(
      existingRow.evidence_fingerprint
    ) !==
      recomputedEvent.evidenceFingerprint
  ) {
    const refreshedAt =
      new Date()
        .toISOString();


    await context.env.DB
      .prepare(`
        UPDATE bed_ash_discharge_events

        SET
          event_start_at = ?,
          event_end_at = ?,
          threshold_crossed_at = ?,
          start_level_ton = ?,
          end_level_ton = ?,
          estimated_ton = ?,
          confidence = ?,
          close_reason = ?,
          evidence_fingerprint = ?,
          revision = revision + 1,
          candidate_active = 1,
          last_detected_at = ?,
          updated_at = ?

        WHERE event_key = ?
          AND revision = ?
          AND status = 'pending'
      `)
      .bind(
        recomputedEvent.startAt,
        recomputedEvent.endAt,
        recomputedEvent.thresholdCrossedAt,
        recomputedEvent.startLevelTon,
        recomputedEvent.endLevelTon,
        recomputedEvent.estimatedTon,
        recomputedEvent.confidence,
        recomputedEvent.closeReason,
        recomputedEvent.evidenceFingerprint,
        refreshedAt,
        refreshedAt,
        eventKey,
        Number(
          existingRow.revision
        )
      )
      .run();


    return createConflictResponse(
      convertEventRow(
        await findEventRowByKey(
          context.env.DB,
          eventKey
        )
      )
    );
  }


  if (
    Number(
      existingRow.revision
    ) !==
      expectedRevision
  ) {
    return createConflictResponse(
      convertEventRow(
        existingRow
      )
    );
  }


  const estimatedTon =
    roundToStoredPrecision(
      existingRow.estimated_ton
    );


  let confirmedAt =
    null;


  let confirmedTon =
    null;


  if (
    status ===
      "confirmed"
  ) {
    confirmedAt =
      normalizeConfirmedAt(
        body.confirmedAt ??
        body.confirmed_at,
        normalizeText(
          existingRow.threshold_crossed_at
        )
      );


    confirmedTon =
      typeof body.confirmedTon ===
        "undefined" &&
      typeof body.confirmed_ton ===
        "undefined"
        ? estimatedTon
        : roundToStoredPrecision(
            body.confirmedTon ??
            body.confirmed_ton
          );


    const confirmedAtMilliseconds =
      Date.parse(
        confirmedAt
      );


    const detectedStartMilliseconds =
      Date.parse(
        existingRow.event_start_at
      );


    const detectedEndMilliseconds =
      Date.parse(
        existingRow.event_end_at
      );


    const confirmedAtIsReasonable =
      Number.isFinite(
        confirmedAtMilliseconds
      ) &&
      Number.isFinite(
        detectedStartMilliseconds
      ) &&
      Number.isFinite(
        detectedEndMilliseconds
      ) &&
      confirmedAtMilliseconds <=
        Date.now() +
        60 *
        1000 &&
      confirmedAtMilliseconds >=
        detectedStartMilliseconds -
        24 *
        HOUR_MILLISECONDS &&
      confirmedAtMilliseconds <=
        detectedEndMilliseconds +
        24 *
        HOUR_MILLISECONDS;


    if (
      !confirmedAt ||
      !confirmedAtIsReasonable ||
      confirmedTon ===
        null ||
      confirmedTon <=
        0 ||
      confirmedTon >
        10000
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "확정 반출 시각과 반출량을 확인해 주세요."
        },
        400
      );
    }
  }


  const note =
    normalizeText(
      body.note
    ).slice(
      0,
      1000
    );


  const reviewedAt =
    formatKstIsoFromEpoch(
      Date.now()
    );


  const nextRevision =
    expectedRevision +
    1;


  const historyId =
    crypto.randomUUID();


  const historySnapshot =
    JSON.stringify({
      eventKey,
      revision:
        nextRevision,
      status,
      confirmedAt,
      confirmedTon,
      note,
      evidenceFingerprint:
        normalizeText(
          existingRow.evidence_fingerprint
        )
    });


  const batchResults =
    await context.env.DB.batch([
      context.env.DB
        .prepare(`
        UPDATE bed_ash_discharge_events

        SET
          status = ?,
          confirmed_at = ?,
          confirmed_ton = ?,
          note = ?,
          reviewed_by_id = ?,
          reviewed_by_name = ?,
          reviewed_at = ?,
          revision = revision + 1,
          updated_at = ?

        WHERE event_key = ?
          AND revision = ?
          AND candidate_active = 1
          AND status = 'pending'
        `)
        .bind(
          status,
          confirmedAt,
          confirmedTon,
          note,
          user.employeeNo,
          user.name,
          reviewedAt,
          reviewedAt,
          eventKey,
          expectedRevision
        ),

      context.env.DB
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

          SELECT
            ?,
            event_key,
            revision,
            'pending',
            ?,
            ?,
            ?,
            ?,
            ?

          FROM bed_ash_discharge_events

          WHERE event_key = ?
            AND revision = ?
            AND status = ?
            AND reviewed_at = ?
            AND changes() = 1
        `)
        .bind(
          historyId,
          status,
          historySnapshot,
          user.employeeNo,
          user.name,
          reviewedAt,
          eventKey,
          nextRevision,
          status,
          reviewedAt
        )
    ]);


  const updateResult =
    batchResults[
      0
    ];


  const historyResult =
    batchResults[
      1
    ];


  if (
    Number(
      updateResult?.meta?.changes ||
      0
    ) !==
      1
  ) {
    return createConflictResponse(
      convertEventRow(
        await findEventRowByKey(
          context.env.DB,
          eventKey
        )
      )
    );
  }


  if (
    Number(
      historyResult?.meta?.changes ||
      0
    ) !==
      1
  ) {
    throw new Error(
      "Bed Ash 반출 검토 이력을 저장하지 못했습니다."
    );
  }


  const savedRow =
    await findEventRowByKey(
      context.env.DB,
      eventKey
    );


  const savedEvent =
    convertEventRow(
      savedRow
    );


  return jsonResponse({
    ok:
      true,

    data: {
      event:
        savedEvent
    }
  });
}


export async function onRequestGet(
  context
) {
  try {
    const authentication =
      await getAuthenticatedUser(
        context
      );


    if (
      authentication.error
    ) {
      return authentication.error;
    }


    await ensureSchema(
      context.env.DB
    );


    const requestUrl =
      new URL(
        context.request.url
      );


    const mode =
      normalizeText(
        requestUrl.searchParams.get(
          "mode"
        )
      )
        .toLowerCase();


    if (
      mode ===
        "summary"
    ) {
      return await handleSummaryGet(
        context
      );
    }


    return await handleRangeGet(
      context,
      requestUrl
    );

  } catch (
    error
  ) {
    console.error(
      "Bed Ash 반출 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          "Bed Ash 반출 이력을 불러오지 못했습니다."
      },
      500
    );
  }
}


export async function onRequestPost(
  context
) {
  try {
    const authentication =
      await getAuthenticatedUser(
        context
      );


    if (
      authentication.error
    ) {
      return authentication.error;
    }


    if (
      isMobileClient(
        context.request
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "모바일에서는 Bed Ash 반출 확인 상태를 변경할 수 없습니다."
        },
        403
      );
    }


    await ensureSchema(
      context.env.DB
    );


    return await handleReviewPost(
      context,
      await readJsonBody(
        context.request
      ),
      authentication.user
    );

  } catch (
    error
  ) {
    console.error(
      "Bed Ash 반출 확인 저장 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          "Bed Ash 반출 확인 내용을 저장하지 못했습니다."
      },
      500
    );
  }
}


/*
  브라우저 번들에서는 사용하지 않는다.
  Node 회귀 테스트가 판정 경계값을 직접 검증할 수 있게 한다.
*/
export const __bedAshTest = {
  detectBedAshEvents,
  detectBedAshEventsForUnit,
  getExpectedSample,
  normalizeCompletedRequestSamples,
  synchronizeDetectedEvents
};
