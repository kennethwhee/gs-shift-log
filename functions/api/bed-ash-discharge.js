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
  "bed-ash-drop-v2";


const DISCHARGE_THRESHOLD_TON =
  5;


/*
  현장 차량 1대의 Bed Ash 반출량은 10 t를 조금 넘는 수준이다.
  계측 오차와 반출 중 Silo 유입량을 감안해 15 t까지는 한 차량 후보로
  보존하되, 이를 초과한 연속 하락은 실제 OIS 표본 경계에서만 나눈다.
*/
const MAXIMUM_SINGLE_TRUCK_TON =
  15;


const NOMINAL_SINGLE_TRUCK_TON =
  10.7;


/*
  5 t는 반출 감지 민감도이고 차량 분할량의 의미 있는 하한은 아니다.
  여러 차량으로 나눌 때는 계측·운전 오차를 허용한 9 t 이상만 채택한다.
*/
const MINIMUM_SPLIT_TRUCK_TON =
  9;


const LEVEL_NOISE_TOLERANCE_TON =
  0.5;


const MAXIMUM_EVENT_WINDOW_HOURS =
  8;


const MAXIMUM_SAMPLE_GAP_HOURS =
  2;


const MAXIMUM_QUERY_DAYS =
  31;


const KST_OFFSET_MILLISECONDS =
  9 * 60 * 60 * 1000;


const HOUR_MILLISECONDS =
  60 * 60 * 1000;


const SAMPLE_SETTLING_GRACE_MILLISECONDS =
  5 * 60 * 1000;


const REQUEST_SNAPSHOT_CTES_SQL = `
  expected_requests AS (
    SELECT
      COALESCE(
        json_extract(value, '$.id'),
        ''
      ) AS id,
      COALESCE(
        json_extract(value, '$.date'),
        ''
      ) AS target_date,
      COALESCE(
        json_extract(value, '$.status'),
        ''
      ) AS status,
      COALESCE(
        json_extract(value, '$.requestedAt'),
        ''
      ) AS requested_at,
      COALESCE(
        json_extract(value, '$.completedAt'),
        ''
      ) AS completed_at,
      COALESCE(
        json_extract(value, '$.updatedAt'),
        ''
      ) AS updated_at

    FROM json_each(?)
  ),

  current_requests AS (
    SELECT
      COALESCE(id, '') AS id,
      COALESCE(target_date, '') AS target_date,
      COALESCE(status, '') AS status,
      COALESCE(requested_at, '') AS requested_at,
      COALESCE(completed_at, '') AS completed_at,
      COALESCE(updated_at, '') AS updated_at

    FROM ois_data_requests

    WHERE request_type = 'bed_ash_level'
      AND target_date >= ?
      AND target_date <= ?
  ),

  snapshot_guard AS (
    SELECT
      NOT EXISTS (
        SELECT
          id,
          target_date,
          status,
          requested_at,
          completed_at,
          updated_at

        FROM current_requests

        EXCEPT

        SELECT
          id,
          target_date,
          status,
          requested_at,
          completed_at,
          updated_at

        FROM expected_requests
      )
      AND NOT EXISTS (
        SELECT
          id,
          target_date,
          status,
          requested_at,
          completed_at,
          updated_at

        FROM expected_requests

        EXCEPT

        SELECT
          id,
          target_date,
          status,
          requested_at,
          completed_at,
          updated_at

        FROM current_requests
      ) AS ok
  )
`;


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
          review_ready INTEGER NOT NULL DEFAULT 0,
          first_detected_at TEXT NOT NULL,
          last_detected_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
    `)
    .run();


  const eventColumnResult =
    await database
      .prepare(`
        PRAGMA table_info(
          bed_ash_discharge_events
        )
      `)
      .all();


  const eventColumns =
    Array.isArray(
      eventColumnResult.results
    )
      ? eventColumnResult.results
      : [];


  if (
    !eventColumns.some(
      column => {
        return normalizeText(
          column.name
        ) ===
          "review_ready";
      }
    )
  ) {
    try {
      await database
        .prepare(`
          ALTER TABLE bed_ash_discharge_events
          ADD COLUMN review_ready INTEGER NOT NULL DEFAULT 0
        `)
        .run();

    } catch (
      error
    ) {
      if (
        !/duplicate column|already exists/i.test(
          normalizeText(
            error?.message
          )
        )
      ) {
        throw error;
      }
    }
  }


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


  /*
    차량 분할 동기화는 확정·제외 이력과 시간 구간이 겹치는지 확인한다.
    이 부분 인덱스는 장기간 누적된 pending 후보를 제외하고 검토 완료 이력만
    unit/status별로 좁혀, 월 단위 JSON upsert의 상관 서브쿼리 비용을 제한한다.
  */
  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_bed_ash_events_reviewed_overlap_v2

      ON bed_ash_discharge_events (
        unit_no,
        status,
        datetime(
          event_end_at
        ),
        datetime(
          event_start_at
        )
      )

      WHERE status IN (
        'confirmed',
        'excluded'
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


function getRequestImmutableCutoffMilliseconds(
  requestRow,
  nowMilliseconds =
    Date.now(),
  allowNowFallback =
    false
) {
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


  if (
    immutableCutoffCandidates.length ===
      1
  ) {
    return allowNowFallback
      ? Number(
          nowMilliseconds
        ) -
        SAMPLE_SETTLING_GRACE_MILLISECONDS
      : Number.NaN;
  }


  return Math.min(
    ...immutableCutoffCandidates
  ) -
  SAMPLE_SETTLING_GRACE_MILLISECONDS;
}


function hasRequestCoverageThrough(
  requestRow,
  requiredTimestamp,
  nowMilliseconds =
    Date.now(),
  requiredUnitNumbers = [
    1,
    2
  ]
) {
  const requiredTime =
    Date.parse(
      requiredTimestamp
    );


  const immutableCutoff =
    getRequestImmutableCutoffMilliseconds(
      requestRow,
      nowMilliseconds
    );


  if (
    !(
    Number.isFinite(
      requiredTime
    ) &&
    Number.isFinite(
      immutableCutoff
    ) &&
    immutableCutoff >=
      requiredTime
    )
  ) {
    return false;
  }


  const samples =
    normalizeCompletedRequestSamples(
      requestRow,
      nowMilliseconds
    );


  return requiredUnitNumbers.every(
    unitNo => {
      return samples.some(
        sample => {
          return (
            sample.unitNo ===
              Number(
                unitNo
              ) &&
            sample.sampledAt ===
              requiredTimestamp
          );
        }
      );
    }
  );
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


  const maximumSampleTime =
    getRequestImmutableCutoffMilliseconds(
      requestRow,
      nowMilliseconds,
      true
    );


  if (
    !Number.isFinite(
      maximumSampleTime
    )
  ) {
    return [];
  }


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


function hasRequestHourRangeCoverage(
  requestRow,
  startHour,
  endHour,
  requiredUnitNumbers = [
    1,
    2
  ],
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
    return false;
  }


  const samples =
    normalizeCompletedRequestSamples(
      requestRow,
      nowMilliseconds
    );


  const sampleKeys =
    new Set(
      samples.map(
        sample => {
          return `${sample.unitNo}:${sample.sampledAt}`;
        }
      )
    );


  return requiredUnitNumbers.every(
    unitNo => {
      for (
        let hour =
          startHour;
        hour <=
          endHour;
        hour +=
          1
      ) {
        const expectedSample =
          getExpectedSample(
            targetDate,
            hour
          );


        if (
          !expectedSample ||
          !sampleKeys.has(
            `${unitNo}:${expectedSample.sampledAt}`
          )
        ) {
          return false;
        }
      }


      return true;
    }
  );
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


function getCandidateDescentPoints(
  candidate
) {
  const points =
    Array.isArray(
      candidate?.points
    )
      ? candidate.points
      : [];


  const troughIndex =
    points.findIndex(
      point => {
        return point.sampledAt ===
          candidate?.trough?.sampledAt;
      }
    );


  return troughIndex >=
    0
    ? points.slice(
        0,
        troughIndex +
          1
      )
    : [];
}


function findTruckSplitBoundaryIndices(
  points
) {
  if (
    points.length <
      3
  ) {
    return [];
  }


  const totalDropTon =
    getLevelDifferenceTon(
      points[0].levelTon,
      points[
        points.length -
        1
      ].levelTon
    );


  if (
    totalDropTon <=
      MAXIMUM_SINGLE_TRUCK_TON
  ) {
    return [
      points.length -
        1
    ];
  }


  /*
    경계는 임의의 시각이나 균등 분할값을 만들지 않고 실제 OIS 표본 중
    새 최저값이 기록된 지점만 사용한다. 이렇게 하면 분할된 반출량의 합이
    원래 관측 하락량과 정확히 일치한다.
  */
  const eligibleIndices = [
    0
  ];


  let lowestLevelTon =
    points[0].levelTon;


  for (
    let pointIndex =
      1;
    pointIndex <
      points.length;
    pointIndex +=
      1
  ) {
    if (
      points[
        pointIndex
      ].levelTon <
        lowestLevelTon
    ) {
      eligibleIndices.push(
        pointIndex
      );

      lowestLevelTon =
        points[
          pointIndex
        ].levelTon;
    }
  }


  const finalIndex =
    points.length -
    1;


  if (
    eligibleIndices[
      eligibleIndices.length -
      1
    ] !==
      finalIndex
  ) {
    eligibleIndices.push(
      finalIndex
    );
  }


  const maximumSegmentCount =
    Math.min(
      Math.floor(
        totalDropTon /
        MINIMUM_SPLIT_TRUCK_TON
      ),
      eligibleIndices.length -
        1
    );


  const candidateSegmentCounts =
    Array.from(
      {
        length:
          Math.max(
            0,
            maximumSegmentCount -
            1
          )
      },
      (
        unused,
        countIndex
      ) => {
        return countIndex +
          2;
      }
    ).filter(
      segmentCount => {
        return totalDropTon /
          segmentCount <=
            MAXIMUM_SINGLE_TRUCK_TON;
      }
    ).sort(
      (
        firstCount,
        secondCount
      ) => {
        const firstDistance =
          Math.abs(
            totalDropTon /
              firstCount -
            NOMINAL_SINGLE_TRUCK_TON
          );


        const secondDistance =
          Math.abs(
            totalDropTon /
              secondCount -
            NOMINAL_SINGLE_TRUCK_TON
          );


        return firstDistance -
          secondDistance ||
          firstCount -
          secondCount;
      }
    );


  const findBestPath =
    segmentCount => {
      const idealSegmentTon =
        totalDropTon /
        segmentCount;


      const search =
        (
          eligiblePosition,
          remainingSegments
        ) => {
          const startPointIndex =
            eligibleIndices[
              eligiblePosition
            ];


          if (
            remainingSegments ===
              1
          ) {
            const finalDropTon =
              getLevelDifferenceTon(
                points[
                  startPointIndex
                ].levelTon,
                points[
                  finalIndex
                ].levelTon
              );


            if (
              finalDropTon <
                MINIMUM_SPLIT_TRUCK_TON ||
              finalDropTon >
                MAXIMUM_SINGLE_TRUCK_TON
            ) {
              return null;
            }


            return {
              boundaries: [
                finalIndex
              ],

              cost:
                (
                  finalDropTon -
                  idealSegmentTon
                ) **
                2
            };
          }


          let bestPath =
            null;


          const finalBoundaryPosition =
            eligibleIndices.length -
            remainingSegments;


          for (
            let boundaryPosition =
              eligiblePosition +
              1;
            boundaryPosition <=
              finalBoundaryPosition;
            boundaryPosition +=
              1
          ) {
            const boundaryPointIndex =
              eligibleIndices[
                boundaryPosition
              ];


            const segmentDropTon =
              getLevelDifferenceTon(
                points[
                  startPointIndex
                ].levelTon,
                points[
                  boundaryPointIndex
                ].levelTon
              );


            if (
              segmentDropTon <
                MINIMUM_SPLIT_TRUCK_TON
            ) {
              continue;
            }


            if (
              segmentDropTon >
                MAXIMUM_SINGLE_TRUCK_TON
            ) {
              break;
            }


            const remainingPath =
              search(
                boundaryPosition,
                remainingSegments -
                  1
              );


            if (
              !remainingPath
            ) {
              continue;
            }


            const path = {
              boundaries: [
                boundaryPointIndex,
                ...remainingPath.boundaries
              ],

              cost:
                remainingPath.cost +
                (
                  segmentDropTon -
                  idealSegmentTon
                ) **
                2
            };


            if (
              !bestPath ||
              path.cost <
                bestPath.cost
            ) {
              bestPath =
                path;
            }
          }


          return bestPath;
        };


      return search(
        0,
        segmentCount
      );
    };


  for (
    const segmentCount of
      candidateSegmentCounts
  ) {
    const bestPath =
      findBestPath(
        segmentCount
      );


    if (
      bestPath
    ) {
      return bestPath.boundaries;
    }
  }


  return [];
}


function buildEventCandidates(
  unitNo,
  candidate,
  closeReason
) {
  if (
    !candidate?.thresholdCrossedAt
  ) {
    return [];
  }


  const descentPoints =
    getCandidateDescentPoints(
      candidate
    );


  if (
    descentPoints.length <
      2
  ) {
    return [];
  }


  const totalDropTon =
    getLevelDifferenceTon(
      descentPoints[0].levelTon,
      descentPoints[
        descentPoints.length -
        1
      ].levelTon
    );


  if (
    totalDropTon <=
      MAXIMUM_SINGLE_TRUCK_TON
  ) {
    const event =
      buildEventCandidate(
        unitNo,
        candidate,
        closeReason
      );


    return event
      ? [
          event
        ]
      : [];
  }


  const boundaryIndices =
    findTruckSplitBoundaryIndices(
      descentPoints
    );


  if (
    boundaryIndices.length <
      2
  ) {
    const unresolvedEvent =
      buildEventCandidate(
        unitNo,
        candidate,
        "truck_boundary_unresolved"
      );


    return unresolvedEvent
      ? [
          {
            ...unresolvedEvent,
            confidence:
              "low"
          }
        ]
      : [];
  }


  const events =
    [];


  let startIndex =
    0;


  boundaryIndices.forEach(
    (
      boundaryIndex,
      boundaryOrder
    ) => {
      const segmentPoints =
        descentPoints.slice(
          startIndex,
          boundaryIndex +
            1
        );


      const segmentStart =
        segmentPoints[0];


      const segmentTrough =
        segmentPoints[
          segmentPoints.length -
          1
        ];


      const thresholdPoint =
        segmentPoints.find(
          point => {
            return getLevelDifferenceTon(
              segmentStart.levelTon,
              point.levelTon
            ) >=
              DISCHARGE_THRESHOLD_TON;
          }
        );


      const segmentEvent =
        buildEventCandidate(
          unitNo,
          {
            start:
              segmentStart,
            trough:
              segmentTrough,
            thresholdCrossedAt:
              thresholdPoint?.sampledAt ||
              "",
            points:
              segmentPoints
          },
          [
            "data_end",
            "data_gap"
          ].includes(
            closeReason
          )
            ? closeReason
            : boundaryOrder ===
                boundaryIndices.length -
                1
              ? closeReason
              : "truck_split"
        );


      if (
        segmentEvent
      ) {
        events.push(
          segmentEvent
        );
      }


      startIndex =
        boundaryIndex;
    }
  );


  return events;
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
      const candidateEvents =
        buildEventCandidates(
          unitNo,
          candidate,
          closeReason
        );


      detectedEvents.push(
        ...candidateEvents
      );
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


function normalizeRequestSnapshot(
  requestSnapshot
) {
  const startDate =
    normalizeText(
      requestSnapshot?.startDate ??
      requestSnapshot?.start_date
    );


  const endDate =
    normalizeText(
      requestSnapshot?.endDate ??
      requestSnapshot?.end_date
    );


  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    ) ||
    getDateRangeDayCount(
      startDate,
      endDate
    ) <
      1
  ) {
    return {
      startDate:
        "",
      endDate:
        "",
      requests:
        []
    };
  }


  const snapshotById =
    new Map();


  (
    Array.isArray(
      requestSnapshot?.requests
    )
      ? requestSnapshot.requests
      : []
  ).forEach(
    item => {
      const date =
        normalizeText(
          item?.date ??
          item?.target_date
        );


      const id =
        normalizeText(
          item?.id
        );


      if (
        !id ||
        !isValidIsoDate(
          date
        ) ||
        date <
          startDate ||
        date >
          endDate
      ) {
        return;
      }


      snapshotById.set(
        id,
        {
          id,
          date,

          status:
            normalizeText(
              item?.status
            ),

          requestedAt:
            normalizeText(
              item?.requestedAt ??
              item?.requested_at
            ),

          completedAt:
            normalizeText(
              item?.completedAt ??
              item?.completed_at
            ),

          updatedAt:
            normalizeText(
              item?.updatedAt ??
              item?.updated_at
            )
        }
      );
    }
  );


  return {
    startDate,
    endDate,

    requests:
      [
        ...snapshotById.values()
      ].sort(
        (
          firstItem,
          secondItem
        ) => {
          return (
            firstItem.date.localeCompare(
              secondItem.date
            ) ||
            firstItem.id.localeCompare(
              secondItem.id
            )
          );
        }
      )
  };
}


function createRequestSnapshot(
  startDate,
  endDate,
  requestRows
) {
  return normalizeRequestSnapshot(
    {
      startDate,
      endDate,

      requests:
        requestRows.map(
          row => {
            return {
              id:
                normalizeText(
                  row.id
                ),
              date:
                normalizeText(
                  row.target_date
                ),
              status:
                normalizeText(
                  row.status
                ),
              requestedAt:
                normalizeText(
                  row.requested_at
                ),
              completedAt:
                normalizeText(
                  row.completed_at
                ),
              updatedAt:
                normalizeText(
                  row.updated_at
                )
            };
          }
        )
    }
  );
}


async function isRequestSnapshotCurrent(
  database,
  requestSnapshot
) {
  const normalizedSnapshot =
    normalizeRequestSnapshot(
      requestSnapshot
    );


  if (
    !normalizedSnapshot.startDate ||
    !normalizedSnapshot.endDate
  ) {
    return true;
  }


  const result =
    await database
      .prepare(`
        WITH
          ${REQUEST_SNAPSHOT_CTES_SQL}

        SELECT ok AS snapshot_current
        FROM snapshot_guard
      `)
      .bind(
        JSON.stringify(
          normalizedSnapshot.requests
        ),
        normalizedSnapshot.startDate,
        normalizedSnapshot.endDate
      )
      .first();


  return Number(
    result?.snapshot_current
  ) ===
    1;
}


function getSettledCompletedRequest(
  date,
  latestByDate,
  completedByDate
) {
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
    !latestRequest ||
    !completedRequest ||
    normalizeText(
      latestRequest.status
    ) !==
      "complete" ||
    normalizeText(
      latestRequest.id
    ) !==
      normalizeText(
        completedRequest.id
      )
  ) {
    return null;
  }


  return completedRequest;
}


function buildCoverage(
  dates,
  latestByDate,
  completedByDate,
  baselineDate,
  lookaheadDate,
  nowMilliseconds =
    Date.now()
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
        getSettledCompletedRequest(
          date,
          latestByDate,
          completedByDate
        );


      const complete =
        Boolean(
          completedRequest
        ) &&
        hasRequestCoverageThrough(
          completedRequest,
          `${addIsoDateDays(
            date,
            1
          )}T00:00:00+09:00`
        ) &&
        hasRequestHourRangeCoverage(
          completedRequest,
          1,
          24
        );


      if (
        complete
      ) {
        completeDates.push(
          date
        );
      }


      if (
        !latestRequest ||
        (
          !complete &&
          normalizeText(
            latestRequest.status
          ) ===
            "complete"
        )
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


  const buildSupportCoverage =
    (
      date,
      available =
        true,
      requiredTimestamp =
        `${addIsoDateDays(
          date,
          1
        )}T00:00:00+09:00`,
      requiredStartHour =
        1,
      requiredEndHour =
        24
    ) => {
      const latestRequest =
        latestByDate.get(
          date
        ) ||
        null;


      const complete =
        available &&
        hasRequestCoverageThrough(
          getSettledCompletedRequest(
            date,
            latestByDate,
            completedByDate
          ),
          requiredTimestamp
        ) &&
        hasRequestHourRangeCoverage(
          getSettledCompletedRequest(
            date,
            latestByDate,
            completedByDate
          ),
          requiredStartHour,
          requiredEndHour
        );


      const status =
        available
          ? normalizeText(
              latestRequest?.status
            ) ||
            "missing"
          : "future";


      const pending =
        available &&
        [
          "pending",
          "processing"
        ].includes(
          status
        );


      const failed =
        available &&
        [
          "failed",
          "expired"
        ].includes(
          status
        );


      return {
        date,
        available,
        status,
        complete,
        missing:
          available &&
          !complete &&
          !pending &&
          !failed,
        pending,
        failed,

        requestId:
          normalizeText(
            latestRequest?.id
          ) ||
          null,

        updatedAt:
          normalizeText(
            latestRequest?.completed_at ||
            latestRequest?.updated_at ||
            latestRequest?.requested_at
          ) ||
          null,

        errorMessage:
          normalizeText(
            latestRequest?.error_message
          )
      };
    };


  const baseline =
    buildSupportCoverage(
      baselineDate,
      true,
      `${addIsoDateDays(
        baselineDate,
        1
      )}T00:00:00+09:00`,
      16,
      24
    );


  const lookahead =
    buildSupportCoverage(
      lookaheadDate,
      nowMilliseconds >=
        Date.parse(
          `${lookaheadDate}T${padTwoDigits(
            MAXIMUM_EVENT_WINDOW_HOURS
          )}:00:00+09:00`
        ) +
        SAMPLE_SETTLING_GRACE_MILLISECONDS,
      `${lookaheadDate}T${padTwoDigits(
        MAXIMUM_EVENT_WINDOW_HOURS
      )}:00:00+09:00`,
      1,
      MAXIMUM_EVENT_WINDOW_HOURS
    );


  const selectedDatesReviewReady =
    dates.every(
      date => {
        return isEventDateReviewReady(
          date,
          latestByDate,
          completedByDate,
          nowMilliseconds
        );
      }
    );


  return {
    dates,
    completeDates,
    missingDates,
    pendingDates,
    failedDates,
    requests,

    baseline,
    lookahead,

    reviewReady:
      selectedDatesReviewReady
  };
}


function isEventDateReviewReady(
  eventDate,
  latestByDate,
  completedByDate,
  nowMilliseconds =
    Date.now(),
  requiredUnitNo =
    null
) {
  if (
    !isValidIsoDate(
      eventDate
    )
  ) {
    return false;
  }


  const baselineDate =
    addIsoDateDays(
      eventDate,
      -1
    );


  const lookaheadDate =
    addIsoDateDays(
      eventDate,
      1
    );


  const lookaheadBoundary =
    `${lookaheadDate}T${padTwoDigits(
      MAXIMUM_EVENT_WINDOW_HOURS
    )}:00:00+09:00`;


  const requiredUnitNumbers =
    [
      1,
      2
    ].includes(
      Number(
        requiredUnitNo
      )
    )
      ? [
          Number(
            requiredUnitNo
          )
        ]
      : [
          1,
          2
        ];


  const baselineRequest =
    getSettledCompletedRequest(
      baselineDate,
      latestByDate,
      completedByDate
    );


  const eventDateRequest =
    getSettledCompletedRequest(
      eventDate,
      latestByDate,
      completedByDate
    );


  const lookaheadRequest =
    getSettledCompletedRequest(
      lookaheadDate,
      latestByDate,
      completedByDate
    );


  return (
    nowMilliseconds >=
      Date.parse(
        lookaheadBoundary
      ) +
      SAMPLE_SETTLING_GRACE_MILLISECONDS &&
    hasRequestCoverageThrough(
      baselineRequest,
      `${eventDate}T00:00:00+09:00`,
      nowMilliseconds,
      requiredUnitNumbers
    ) &&
    hasRequestCoverageThrough(
      eventDateRequest,
      `${lookaheadDate}T00:00:00+09:00`,
      nowMilliseconds,
      requiredUnitNumbers
    ) &&
    hasRequestCoverageThrough(
      lookaheadRequest,
      lookaheadBoundary,
      nowMilliseconds,
      requiredUnitNumbers
    ) &&
    hasContinuousEventDateSupport(
      eventDate,
      [
        baselineRequest,
        eventDateRequest,
        lookaheadRequest
      ],
      requiredUnitNumbers,
      nowMilliseconds
    )
  );
}


function hasContinuousEventDateSupport(
  eventDate,
  requestRows,
  requiredUnitNumbers,
  nowMilliseconds =
    Date.now()
) {
  const supportStartTime =
    Date.parse(
      `${eventDate}T00:00:00+09:00`
    ) -
    MAXIMUM_EVENT_WINDOW_HOURS *
    HOUR_MILLISECONDS;


  const supportEndTime =
    Date.parse(
      `${addIsoDateDays(
        eventDate,
        1
      )}T00:00:00+09:00`
    ) +
    MAXIMUM_EVENT_WINDOW_HOURS *
    HOUR_MILLISECONDS;


  const sampleKeys =
    new Set(
      requestRows.flatMap(
        requestRow => {
          return normalizeCompletedRequestSamples(
            requestRow,
            nowMilliseconds
          );
        }
      ).map(
        sample => {
          return `${sample.unitNo}:${sample.sampledAt}`;
        }
      )
    );


  return requiredUnitNumbers.every(
    unitNo => {
      for (
        let sampleTime =
          supportStartTime;
        sampleTime <=
          supportEndTime;
        sampleTime +=
          HOUR_MILLISECONDS
      ) {
        if (
          !sampleKeys.has(
            `${unitNo}:${formatKstIsoFromEpoch(
              sampleTime
            )}`
          )
        ) {
          return false;
        }
      }


      return true;
    }
  );
}


function isDetectedEventReviewReady(
  event,
  latestByDate,
  completedByDate,
  nowMilliseconds =
    Date.now()
) {
  return isEventDateReviewReady(
    getKstDateFromTimestamp(
      event?.thresholdCrossedAt
    ),
    latestByDate,
    completedByDate,
    nowMilliseconds,
    event?.unitNo
  ) &&
  ![
    "data_end",
    "data_gap",
    "truck_boundary_unresolved"
  ].includes(
    normalizeText(
      event?.closeReason
    )
  );
}


async function synchronizeDetectedEvents(
  database,
  startTimestamp,
  endTimestampExclusive,
  detectedEvents,
  authoritativeDates =
    [],
  blockedReviewDates =
    [],
  requestSnapshot =
    []
) {
  const now =
    new Date()
      .toISOString();


  const currentDetectedEvents =
    Array.isArray(
      detectedEvents
    )
      ? detectedEvents.filter(
          event => {
            return normalizeText(
              event?.algorithmVersion
            ) ===
              ALGORITHM_VERSION;
          }
        )
      : [];


  const normalizedAuthoritativeDates =
    [
      ...new Set(
        Array.isArray(
          authoritativeDates
        )
          ? authoritativeDates.filter(
              isValidIsoDate
            )
          : []
      )
    ];


  const authoritativeDateClause =
    normalizedAuthoritativeDates.length >
      0
      ? `
          OR substr(
            threshold_crossed_at,
            1,
            10
          ) IN (${normalizedAuthoritativeDates.map(
            () => {
              return "?";
            }
          ).join(
            ", "
          )})
        `
      : "";


  const normalizedBlockedReviewDates =
    [
      ...new Set(
        Array.isArray(
          blockedReviewDates
        )
          ? blockedReviewDates.filter(
              isValidIsoDate
            )
          : []
      )
    ];


  const normalizedRequestSnapshot =
    normalizeRequestSnapshot(
      requestSnapshot
    );


  const hasRequestSnapshot =
    Boolean(
      normalizedRequestSnapshot.startDate &&
      normalizedRequestSnapshot.endDate
    );


  const requestSnapshotJson =
    JSON.stringify(
      normalizedRequestSnapshot
        .requests
    );


  const requestSnapshotBindings =
    hasRequestSnapshot
      ? [
          requestSnapshotJson,
          normalizedRequestSnapshot.startDate,
          normalizedRequestSnapshot.endDate
        ]
      : [];


  const requestSnapshotCtePrefix =
    hasRequestSnapshot
      ? `WITH ${REQUEST_SNAPSHOT_CTES_SQL}`
      : "";


  const requestSnapshotWhereClause =
    hasRequestSnapshot
      ? "AND (SELECT ok FROM snapshot_guard) = 1"
      : "";


  const statements =
    [];


  if (
    normalizedBlockedReviewDates.length >
      0
  ) {
    statements.push(
      database
        .prepare(`
          ${requestSnapshotCtePrefix}

          UPDATE bed_ash_discharge_events

          SET
            review_ready = 0,
            updated_at = ?

          WHERE threshold_crossed_at >= ?
            AND threshold_crossed_at < ?
            AND status = 'pending'
            AND candidate_active = 1
            AND substr(
              threshold_crossed_at,
              1,
              10
            ) IN (${normalizedBlockedReviewDates.map(
              () => {
                return "?";
              }
            ).join(
              ", "
            )})
            ${requestSnapshotWhereClause}
        `)
        .bind(
          ...requestSnapshotBindings,
          now,
          startTimestamp,
          endTimestampExclusive,
          ...normalizedBlockedReviewDates
        )
    );
  }


  statements.push(
    database
      .prepare(`
      ${requestSnapshotCtePrefix}

      UPDATE bed_ash_discharge_events

      SET
        candidate_active = 0,
        review_ready = 0,
        updated_at = ?

      WHERE threshold_crossed_at >= ?
        AND threshold_crossed_at < ?
        AND status = 'pending'
        AND (
          algorithm_version <> ?
          OR review_ready = 0
          OR EXISTS (
            SELECT 1

            FROM bed_ash_discharge_events AS reviewed

            WHERE reviewed.status IN (
                'confirmed',
                'excluded'
              )
              AND reviewed.unit_no =
                bed_ash_discharge_events.unit_no
              AND datetime(
                reviewed.event_start_at
              ) < datetime(
                bed_ash_discharge_events.event_end_at
              )
              AND datetime(
                reviewed.event_end_at
              ) > datetime(
                bed_ash_discharge_events.event_start_at
              )
          )
          ${authoritativeDateClause}
        )
        ${requestSnapshotWhereClause}
      `)
      .bind(
        ...requestSnapshotBindings,
        now,
        startTimestamp,
        endTimestampExclusive,
        ALGORITHM_VERSION,
        ...normalizedAuthoritativeDates
      )
  );


  if (
    currentDetectedEvents.length >
      0
  ) {
    const eventPayload =
      JSON.stringify(
        currentDetectedEvents.map(
          event => {
            return {
              eventKey:
                event.eventKey,
              algorithmVersion:
                event.algorithmVersion,
              unitNo:
                event.unitNo,
              tagNumber:
                event.tagNumber,
              startAt:
                event.startAt,
              endAt:
                event.endAt,
              thresholdCrossedAt:
                event.thresholdCrossedAt,
              startLevelTon:
                event.startLevelTon,
              endLevelTon:
                event.endLevelTon,
              estimatedTon:
                event.estimatedTon,
              confidence:
                event.confidence,
              evidenceFingerprint:
                event.evidenceFingerprint,
              closeReason:
                event.closeReason,
              reviewReady:
                event.reviewReady ===
                  true
            };
          }
        )
      );


    statements.push(
      database
        .prepare(`
            WITH
              ${
                hasRequestSnapshot
                  ? `${REQUEST_SNAPSHOT_CTES_SQL},`
                  : ""
              }

              incoming AS (
              SELECT
                json_extract(value, '$.eventKey') AS event_key,
                json_extract(value, '$.algorithmVersion') AS algorithm_version,
                json_extract(value, '$.unitNo') AS unit_no,
                json_extract(value, '$.tagNumber') AS tag_number,
                json_extract(value, '$.startAt') AS event_start_at,
                json_extract(value, '$.endAt') AS event_end_at,
                json_extract(value, '$.thresholdCrossedAt') AS threshold_crossed_at,
                json_extract(value, '$.startLevelTon') AS start_level_ton,
                json_extract(value, '$.endLevelTon') AS end_level_ton,
                json_extract(value, '$.estimatedTon') AS estimated_ton,
                json_extract(value, '$.confidence') AS confidence,
                json_extract(value, '$.evidenceFingerprint') AS evidence_fingerprint,
                json_extract(value, '$.closeReason') AS close_reason,
                CASE
                  WHEN json_extract(value, '$.reviewReady') = 1
                    THEN 1
                  ELSE 0
                END AS review_ready
              FROM json_each(?)
            )

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

            SELECT
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
              'pending',
              NULL,
              NULL,
              '',
              '',
              '',
              NULL,
              1,
              1,
              review_ready,
              ?,
              ?,
              ?

            FROM incoming

            WHERE 1 = 1
              AND NOT EXISTS (
                SELECT 1

                FROM bed_ash_discharge_events AS reviewed

                WHERE reviewed.status IN (
                    'confirmed',
                    'excluded'
                  )
                  AND reviewed.unit_no = incoming.unit_no
                  AND datetime(
                    reviewed.event_start_at
                  ) < datetime(
                    incoming.event_end_at
                  )
                  AND datetime(
                    reviewed.event_end_at
                  ) > datetime(
                    incoming.event_start_at
                  )
              )
              ${requestSnapshotWhereClause}

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
              review_ready = excluded.review_ready,
              last_detected_at = excluded.last_detected_at,
              updated_at = excluded.updated_at

            WHERE bed_ash_discharge_events.status = 'pending'
              AND (
                bed_ash_discharge_events.review_ready = 0
                OR excluded.review_ready = 1
              )
          `)
        .bind(
          ...requestSnapshotBindings,
          eventPayload,
          now,
          now,
          now
        )
    );
  }


  await database.batch(
    statements
  );


  return {
    synchronized:
      !hasRequestSnapshot ||
      await isRequestSnapshotCurrent(
        database,
        normalizedRequestSnapshot
      )
  };
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

    algorithmVersion:
      normalizeText(
        row.algorithm_version
      ),

    revision:
      Math.max(
        1,
        Number(
          row.revision
        ) ||
        1
      ),

    reviewReady:
      Number(
        row.review_ready
      ) ===
        1,

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

    closeReason:
      normalizeText(
        row.close_reason
      ),

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
          AND algorithm_version = ?
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
        ALGORITHM_VERSION,
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
        return (
          event.status ===
            "pending" &&
          event.reviewReady ===
            true
        );
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
        SELECT legacy_or_current.*

        FROM bed_ash_discharge_events AS legacy_or_current

        WHERE legacy_or_current.candidate_active = 1
          AND legacy_or_current.status = 'pending'
          AND legacy_or_current.review_ready = 1
          AND (
            legacy_or_current.algorithm_version = ?

            OR NOT EXISTS (
              SELECT 1

              FROM bed_ash_discharge_events AS current_event

              WHERE current_event.algorithm_version = ?
                AND current_event.unit_no =
                  legacy_or_current.unit_no
                AND (
                  (
                    current_event.status = 'pending'
                    AND current_event.candidate_active = 1
                  )
                  OR current_event.status IN (
                    'confirmed',
                    'excluded'
                  )
                )
                AND datetime(
                  current_event.event_start_at
                ) < datetime(
                  legacy_or_current.event_end_at
                )
                AND datetime(
                  current_event.event_end_at
                ) > datetime(
                  legacy_or_current.event_start_at
                )
            )
          )

        ORDER BY
          legacy_or_current.threshold_crossed_at DESC,
          CASE
            WHEN legacy_or_current.algorithm_version = ?
              THEN 0
            ELSE 1
          END ASC,
          legacy_or_current.unit_no ASC
      `)
      .bind(
        ALGORITHM_VERSION,
        ALGORITHM_VERSION,
        ALGORITHM_VERSION
      )
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
  requestUrl,
  snapshotRetryCount =
    0
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


  const requestSnapshot =
    createRequestSnapshot(
      baselineDate,
      detectorEndDate,
      requestRows
    );


  const evaluationTime =
    Date.now();


  const coverage =
    buildCoverage(
      dates,
      latestByDate,
      completedByDate,
      baselineDate,
      detectorEndDate,
      evaluationTime
    );


  const authoritativeDates =
    dates.filter(
      date => {
        return isEventDateReviewReady(
          date,
          latestByDate,
          completedByDate,
          evaluationTime
        );
      }
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
    ).map(
      event => {
        return {
          ...event,

          reviewReady:
            isDetectedEventReviewReady(
              event,
              latestByDate,
              completedByDate,
              evaluationTime
            )
        };
      }
    );


  const authoritativeDateSet =
    new Set(
      authoritativeDates
    );


  const blockedReviewDates =
    [
      ...new Set([
        ...dates.filter(
          date => {
            return !authoritativeDateSet.has(
              date
            );
          }
        ),
        ...rangeDetectedEvents.filter(
          event => {
            return event.reviewReady !==
              true;
          }
        ).map(
          event => {
            return getKstDateFromTimestamp(
              event.thresholdCrossedAt
            );
          }
        )
      ])
    ].filter(
      isValidIsoDate
    );


  const synchronizationResult =
    await synchronizeDetectedEvents(
      context.env.DB,
      startTimestamp,
      endTimestampExclusive,
      rangeDetectedEvents,
      authoritativeDates,
      blockedReviewDates,
      requestSnapshot
    );


  if (
    synchronizationResult.synchronized !==
      true
  ) {
    if (
      snapshotRetryCount <
        1
    ) {
      return await handleRangeGet(
        context,
        requestUrl,
        snapshotRetryCount +
          1
      );
    }


    return jsonResponse(
      {
        ok:
          false,

        message:
          "OIS 자료가 갱신되어 최신 Bed Ash 자료를 다시 불러와 주세요."
      },
      409
    );
  }


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
        coverage
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


async function isStoredEventReviewReady(
  database,
  eventRow
) {
  const eventDate =
    getKstDateFromTimestamp(
      eventRow?.threshold_crossed_at
    );


  if (
    !isValidIsoDate(
      eventDate
    )
  ) {
    return {
      ready:
        false,
      requests:
        []
    };
  }


  const requestRows =
    await findOisRequestRows(
      database,
      addIsoDateDays(
        eventDate,
        -1
      ),
      addIsoDateDays(
        eventDate,
        1
      )
    );


  const {
    latestByDate,
    completedByDate
  } =
    selectRequestRowsByDate(
      requestRows
    );


  const supportDates = [
    addIsoDateDays(
      eventDate,
      -1
    ),
    eventDate,
    addIsoDateDays(
      eventDate,
      1
    )
  ];


  return {
    ready:
      isDetectedEventReviewReady(
        {
          thresholdCrossedAt:
            eventRow.threshold_crossed_at,
          unitNo:
            Number(
              eventRow.unit_no
            ),
          closeReason:
            normalizeText(
              eventRow.close_reason
            )
        },
        latestByDate,
        completedByDate
      ),

    requests:
      supportDates.map(
        date => {
          return {
            date,
            requestId:
              normalizeText(
                latestByDate.get(
                  date
                )?.id
              )
          };
        }
      )
  };
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
      existingRow.algorithm_version
    ) !==
      ALGORITHM_VERSION &&
    normalizeText(
      existingRow.status
    ) ===
      "pending"
  ) {
    await context.env.DB
      .prepare(`
        UPDATE bed_ash_discharge_events

        SET
          candidate_active = 0,
          review_ready = 0,
          updated_at = ?

        WHERE event_key = ?
          AND revision = ?
          AND status = 'pending'
          AND algorithm_version <> ?
      `)
      .bind(
        new Date()
          .toISOString(),
        eventKey,
        Number(
          existingRow.revision
        ),
        ALGORITHM_VERSION
      )
      .run();


    return createConflictResponse(
      convertEventRow(
        await findEventRowByKey(
          context.env.DB,
          eventKey
        )
      ),
      "이전 판정 방식의 후보입니다. 최신 Level을 조회해 차량별 후보로 갱신해 주세요."
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


  if (
    Number(
      existingRow.review_ready
    ) !==
      1
  ) {
    return createConflictResponse(
      convertEventRow(
        existingRow
      ),
      "첫날 기준 자료와 마지막 날 후속 자료가 모두 수집된 뒤 확인할 수 있습니다."
    );
  }


  const supportValidation =
    await isStoredEventReviewReady(
      context.env.DB,
      existingRow
    );


  if (
    supportValidation.ready !==
      true
  ) {
    await context.env.DB
      .prepare(`
        UPDATE bed_ash_discharge_events

        SET
          review_ready = 0,
          updated_at = ?

        WHERE event_key = ?
          AND revision = ?
          AND updated_at = ?
          AND candidate_active = 1
          AND status = 'pending'
      `)
      .bind(
        new Date()
          .toISOString(),
        eventKey,
        Number(
          existingRow.revision
        ),
        normalizeText(
          existingRow.updated_at
        )
      )
      .run();


    return createConflictResponse(
      convertEventRow(
        await findEventRowByKey(
          context.env.DB,
          eventKey
        )
      ),
      "OIS 최신 자료 수집이 끝난 뒤 다시 확인해 주세요."
    );
  }


  const supportRequestSnapshot =
    JSON.stringify(
      supportValidation.requests
    );


  const recomputedEvent =
    await recomputeEventByKey(
      context.env.DB,
      existingRow
    );


  if (
    !recomputedEvent
  ) {
    await context.env.DB
      .prepare(`
        UPDATE bed_ash_discharge_events

        SET
          candidate_active = 0,
          review_ready = 0,
          updated_at = ?

        WHERE event_key = ?
          AND revision = ?
          AND updated_at = ?
          AND candidate_active = 1
          AND status = 'pending'
      `)
      .bind(
        new Date()
          .toISOString(),
        eventKey,
        Number(
          existingRow.revision
        ),
        normalizeText(
          existingRow.updated_at
        )
      )
      .run();


    return createConflictResponse(
      convertEventRow(
        await findEventRowByKey(
          context.env.DB,
          eventKey
        )
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


    const refreshResult =
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
          AND candidate_active = 1
          AND review_ready = 1
          AND NOT EXISTS (
            SELECT 1

            FROM json_each(?) AS expected

            WHERE COALESCE(
              (
                SELECT request.id

                FROM ois_data_requests AS request

                WHERE request.request_type = 'bed_ash_level'
                  AND request.target_date = json_extract(
                    expected.value,
                    '$.date'
                  )

                ORDER BY
                  COALESCE(
                    request.completed_at,
                    request.updated_at,
                    request.requested_at,
                    ''
                  ) DESC,
                  request.requested_at DESC,
                  request.id DESC

                LIMIT 1
              ),
              ''
            ) <> json_extract(
              expected.value,
              '$.requestId'
            )
          )
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
        ),
        supportRequestSnapshot
      )
      .run();


    if (
      Number(
        refreshResult?.meta?.changes ||
        0
      ) !==
        1
    ) {
      await context.env.DB
        .prepare(`
          UPDATE bed_ash_discharge_events

          SET
            review_ready = 0,
            updated_at = ?

          WHERE event_key = ?
            AND revision = ?
            AND updated_at = ?
            AND candidate_active = 1
            AND status = 'pending'
        `)
        .bind(
          new Date()
            .toISOString(),
          eventKey,
          Number(
            existingRow.revision
          ),
          normalizeText(
            existingRow.updated_at
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
          AND review_ready = 1
          AND NOT EXISTS (
            SELECT 1

            FROM json_each(?) AS expected

            WHERE COALESCE(
              (
                SELECT request.id

                FROM ois_data_requests AS request

                WHERE request.request_type = 'bed_ash_level'
                  AND request.target_date = json_extract(
                    expected.value,
                    '$.date'
                  )

                ORDER BY
                  COALESCE(
                    request.completed_at,
                    request.updated_at,
                    request.requested_at,
                    ''
                  ) DESC,
                  request.requested_at DESC,
                  request.id DESC

                LIMIT 1
              ),
              ''
            ) <> json_extract(
              expected.value,
              '$.requestId'
            )
          )
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
          expectedRevision,
          supportRequestSnapshot
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
    await context.env.DB
      .prepare(`
        UPDATE bed_ash_discharge_events

        SET
          review_ready = 0,
          updated_at = ?

        WHERE event_key = ?
          AND revision = ?
          AND updated_at = ?
          AND candidate_active = 1
          AND status = 'pending'
      `)
      .bind(
        new Date()
          .toISOString(),
        eventKey,
        Number(
          existingRow.revision
        ),
        normalizeText(
          existingRow.updated_at
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
  buildCoverage,
  buildSummary,
  detectBedAshEvents,
  detectBedAshEventsForUnit,
  ensureSchema,
  findActiveEventRows,
  getExpectedSample,
  handleReviewPost,
  handleSummaryGet,
  isDetectedEventReviewReady,
  normalizeCompletedRequestSamples,
  synchronizeDetectedEvents
};
