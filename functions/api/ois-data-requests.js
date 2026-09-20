import { prepareScheduledBatch, scheduledBatchStatements, isScheduledBatchConflict } from "../_shared/blower-schedule-v1.js";
import { loadAppendBase, verifiedAppendBase, ensureAppendSchema, appendIntentStatement } from "../_shared/blower-incremental.js";

"use strict";
/* COFIRING_API_BUILD_FINGERPRINT_V1 */
const COFIRING_API_BUILD_FINGERPRINT =
  "organic-start2-endactual-20260920-v1";


/* =========================================================
  OIS 사내자료 요청 대기열 API

  경로:
  functions/api/ois-data-requests.js

  업무일지 사용자:
  POST /api/ois-data-requests
  - 날짜별 OIS 자료 요청 생성

  GET /api/ois-data-requests?id=요청ID
  - 요청 처리 상태와 결과 확인

  회사 PC OIS 연동 프로그램:
  GET /api/ois-data-requests?action=next
  - 처리할 다음 요청 가져오기

  POST /api/ois-data-requests
  action: complete
  - 조회 결과 등록

  POST /api/ois-data-requests
  action: fail
  - 조회 실패 등록
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const DEFAULT_REQUEST_TYPE =
  "limestone_stock";


/*
  에이전트가 요청을 가져가기 전
  대기열에서 기다릴 수 있는 시간
*/
const REQUEST_TIMEOUT_MINUTES =
  60;


/*
  에이전트가 요청을 가져간 뒤
  실제 OIS 조회를 완료할 수 있는 시간
*/
const REQUEST_PROCESSING_TIMEOUT_MINUTES =
  30;


/* =========================================================
  Blower DataPARC read-only runtime queries

  - Only the pilot B mapping is preconfigured. Other signals require explicit confirmation.
  - The server freezes the exact cycle/revision window.
  - One Agent request may span a long cycle; the Agent reads it
    in consecutive chunks of at most 31 days.
========================================================= */

const BLOWER_RUNTIME_PROBE_REQUEST_TYPE =
  "blower_runtime_probe";


const BLOWER_RUNTIME_PROBE_ASSET_TAG =
  "104ETH03AN602";


const BLOWER_RUNTIME_PROBE_DATAPARC_TAG =
  "GSPOGE.ABB_DCS.003ETH03AN602XB04";


const BLOWER_RUNTIME_PROBE_ALLOWED_ASSET_TAGS = Object.freeze([
  "104ETH03AN601", "104ETH03AN602",
  "104ETG30AN601", "104ETG30AN602", "204ETG30AN601", "204ETG30AN602",
  "104SDF01AN001", "104SDF01AN002", "204SDF01AN001", "204SDF01AN002",
  "204LMDF01AN001",
  "104HHL60AP611", "104HHL60AP621", "104HHL60AP631",
  "204HHL60AP611", "204HHL60AP621", "204HHL60AP631",
  "104HHL10AN611", "104HHL10AN621", "104HHL10AN631",
  "204HHL10AN611", "204HHL10AN621", "204HHL10AN631"
]);

function isValidBlowerRuntimeProbeMapping(assetTag, dataParcTag) {
  return typeof assetTag === "string" &&
    BLOWER_RUNTIME_PROBE_ALLOWED_ASSET_TAGS.includes(assetTag) &&
    typeof dataParcTag === "string" && dataParcTag.length <= 200 &&
    /^GSPOGE\.ABB_DCS\.[A-Z0-9][A-Z0-9._-]*$/.test(dataParcTag) &&
    dataParcTag === dataParcTag.trim() &&
    (assetTag !== BLOWER_RUNTIME_PROBE_ASSET_TAG || dataParcTag === BLOWER_RUNTIME_PROBE_DATAPARC_TAG) &&
    (dataParcTag !== BLOWER_RUNTIME_PROBE_DATAPARC_TAG || assetTag === BLOWER_RUNTIME_PROBE_ASSET_TAG);
}

function resolveBlowerRuntimeProbeMapping(body) {
  const forbidden = ["tagNumber", "tag_number", "asset_tag", "dataparcTag", "dataparc_tag", "sourceTag", "source_tag"];
  if (forbidden.some(name => Object.prototype.hasOwnProperty.call(body, name))) {
    return { code: "BLOWER_RUNTIME_PROBE_SERVER_TAG_ONLY", error: "설비와 운전 신호는 기간조회 창에서 선택해 주세요." };
  }
  const assetTag = Object.prototype.hasOwnProperty.call(body, "assetTag") ? body.assetTag : BLOWER_RUNTIME_PROBE_ASSET_TAG;
  if (!BLOWER_RUNTIME_PROBE_ALLOWED_ASSET_TAGS.includes(assetTag)) {
    return { code: "BLOWER_RUNTIME_PROBE_ASSET_UNSUPPORTED", error: "DataPARC 기간조회를 지원하는 Blower 설비를 선택해 주세요." };
  }
  if (assetTag === BLOWER_RUNTIME_PROBE_ASSET_TAG) {
    if (Object.prototype.hasOwnProperty.call(body, "dataParcTag") && body.dataParcTag !== BLOWER_RUNTIME_PROBE_DATAPARC_TAG) {
      return { code: "BLOWER_RUNTIME_PROBE_SERVER_TAG_ONLY", error: "Fly Ash Silo #B는 기존에 확인된 DataPARC 운전 TAG를 사용합니다." };
    }
    return { assetTag, dataParcTag: BLOWER_RUNTIME_PROBE_DATAPARC_TAG };
  }
  if (!isValidBlowerRuntimeProbeMapping(assetTag, body.dataParcTag)) {
    return { code: "BLOWER_RUNTIME_PROBE_SIGNAL_REQUIRED", error: "이 설비의 실제 DataPARC 운전 TAG를 GSPOGE.ABB_DCS.로 시작하는 전체 이름으로 입력해 주세요. 공백과 따옴표는 사용할 수 없습니다." };
  }
  if (body.confirmRunSignal !== true) {
    return { code: "BLOWER_RUNTIME_PROBE_SIGNAL_CONFIRM_REQUIRED", error: "입력한 TAG가 선택한 Blower의 운전 신호이며 0=정지, 1=기동인지 확인해 주세요." };
  }
  return { assetTag, dataParcTag: body.dataParcTag };
}

function isValidBlowerRuntimeProbeIntentIdentity(probe, requestId, targetDate) {
  return !!probe && probe.requestId === requestId && probe.schemaVersion === 1 &&
    probe.requestType === BLOWER_RUNTIME_PROBE_REQUEST_TYPE && probe.readOnly === true &&
    isValidBlowerRuntimeProbeMapping(probe.assetTag, probe.dataParcTag) &&
    (targetDate === undefined || targetDate === buildBlowerRuntimeProbeTargetDate(probe.startAt, probe.endAt, probe.assetTag));
}

const BLOWER_RUNTIME_PROBE_SCHEMA_VERSION =
  1;


const BLOWER_RUNTIME_PROBE_CHUNK_DAYS =
  31;


const BLOWER_RUNTIME_PROBE_MAX_RANGE_DAYS =
  366;


const BLOWER_RUNTIME_PROBE_LEASE_HOURS =
  2;


const BLOWER_RUNTIME_PROBE_COMPLETE_FRESH_MINUTES =
  15;


const BLOWER_RUNTIME_PROBE_MAX_RESULT_BYTES =
  256 * 1024;


/* [FBHE-OIS-RUNTIME-ANALYSIS-V2]
  FBHE 진동 장기 분석은 31일 단위로 최대 12개 요청(약 1년)으로 나눈다.
  한 요청은 TAG 24개를 기간 API로 조회하므로 날짜별 24개 요청을 만들지 않는다.
*/
const FBHE_VIBRATION_RANGE_CHUNK_DAYS =
  31;

const FBHE_VIBRATION_RANGE_MAX_DAYS =
  366;

const FBHE_VIBRATION_RANGE_QUEUE_HOURS =
  12;

/* [FBHE-OIS-RESUME-TIMEOUT-V4-R3] */
const FBHE_VIBRATION_STALL_MINUTES = 5;

/*
  기간 일괄 계산:
  한 번에 최대 62일까지 허용한다.
*/
const MAXIMUM_LIMESTONE_USAGE_BATCH_DAYS =
  62;


/*
  기간 요청은 대기열에서 오래 기다릴 수 있으므로
  개별 요청 유효기간을 48시간으로 설정한다.
*/
const LIMESTONE_USAGE_BATCH_QUEUE_HOURS =
  48;  

/* =========================================================
  OIS 과거 업무일지 기간 가져오기

  한 번 요청:
  최대 62일

  대기열 보존:
  최대 72시간

  긴 과거 기간은 홈페이지에서
  62일씩 자동으로 나누어 등록한다.
========================================================= */

const MAXIMUM_OIS_LEGACY_BATCH_DAYS =
  62;


const OIS_LEGACY_BATCH_QUEUE_HOURS =
  72;  

/* =========================================================
  공통 응답
========================================================= */

function jsonResponse(
  data,
  status = 200
) {
  return Response.json(
    data,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",

        "X-GS-Cofiring-Api-Build":

          COFIRING_API_BUILD_FINGERPRINT,


        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}


/* =========================================================
  문자열 정리
========================================================= */

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


/* =========================================================
  날짜 검증
========================================================= */

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


function parseStrictRfc3339(
  value
) {
  const text =
    normalizeText(
      value
    );


  const match =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
    );


  if (
    !match
  ) {
    return null;
  }


  const timestamp =
    Date.parse(
      text
    );


  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return null;
  }


  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);


  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }


  /*
    Date.parse normalizes invalid calendar dates such as February 30.
    Rebuild the local date portion with the submitted offset and compare it
    so only real RFC3339 calendar timestamps are accepted.
  */
  const offsetText = match[8];
  let offsetMinutes = 0;


  if (
    offsetText !==
      "Z"
  ) {
    const sign =
      offsetText[0] ===
        "-"
        ? -1
        : 1;


    offsetMinutes =
      sign *
      (
        Number(offsetText.slice(1, 3)) * 60 +
        Number(offsetText.slice(4, 6))
      );
  }


  const localDate =
    new Date(
      timestamp +
      offsetMinutes * 60 * 1000
    );


  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() + 1 !== month ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hour ||
    localDate.getUTCMinutes() !== minute ||
    localDate.getUTCSeconds() !== second
  ) {
    return null;
  }


  return {
    text,
    timestamp,
    date:
      new Date(
        timestamp
      )
  };
}


function formatKstRfc3339(
  value
) {
  const date =
    value instanceof Date
      ? value
      : new Date(
          value
        );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }


  return new Date(
    Math.floor(
      date.getTime() /
      1000
    ) *
      1000 +
    9 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(
      0,
      19
    ) +
    "+09:00";
}


function buildBlowerRuntimeProbeTargetDate(
  startAt,
  endAt,
  assetTag = BLOWER_RUNTIME_PROBE_ASSET_TAG
) {
  return [
    `v${BLOWER_RUNTIME_PROBE_SCHEMA_VERSION}`,
    assetTag,
    normalizeText(startAt),
    normalizeText(endAt)
  ].join(
    "|"
  );
}


function buildBlowerRuntimeProbeChunks(
  startAt,
  endAt
) {
  const parsedStart =
    parseStrictRfc3339(
      startAt
    );


  const parsedEnd =
    parseStrictRfc3339(
      endAt
    );


  if (
    !parsedStart ||
    !parsedEnd ||
    parsedEnd.timestamp <=
      parsedStart.timestamp
  ) {
    return [];
  }


  const chunkMilliseconds =
    BLOWER_RUNTIME_PROBE_CHUNK_DAYS *
    24 *
    60 *
    60 *
    1000;


  const chunks = [];
  let cursor =
    parsedStart.timestamp;


  while (
    cursor <
    parsedEnd.timestamp
  ) {
    const next =
      Math.min(
        parsedEnd.timestamp,
        cursor +
          chunkMilliseconds
      );


    chunks.push({
      index:
        chunks.length +
        1,
      startAt:
        formatKstRfc3339(
          cursor
        ),
      endAt:
        formatKstRfc3339(
          next
        )
    });


    cursor =
      next;
  }


  return chunks;
}


function getRequestProcessingTimeoutMinutes(
  requestType
) {
  return normalizeText(
    requestType
  ) ===
    BLOWER_RUNTIME_PROBE_REQUEST_TYPE
      ? BLOWER_RUNTIME_PROBE_LEASE_HOURS *
        60
      : REQUEST_PROCESSING_TIMEOUT_MINUTES;
}

function inclusiveIsoDateCount(
  startDate,
  endDate
) {
  if (
    !isValidIsoDate(startDate) ||
    !isValidIsoDate(endDate)
  ) {
    return 0;
  }

  const start =
    new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end =
    new Date(`${endDate}T00:00:00.000Z`).getTime();

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start
  ) {
    return 0;
  }

  return Math.floor((end - start) / 86400000) + 1;
}

function buildFbheVibrationRangeChunks(
  startDate,
  endDate
) {
  const dayCount =
    inclusiveIsoDateCount(
      startDate,
      endDate
    );

  if (
    dayCount < 1 ||
    dayCount > FBHE_VIBRATION_RANGE_MAX_DAYS
  ) {
    return [];
  }

  const chunks = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const candidateEnd =
      addIsoDateDays(
        cursor,
        FBHE_VIBRATION_RANGE_CHUNK_DAYS - 1
      );
    const chunkEnd =
      candidateEnd && candidateEnd < endDate
        ? candidateEnd
        : endDate;

    chunks.push({
      startDate: cursor,
      endDate: chunkEnd,
      targetDate: `${cursor}~${chunkEnd}`,
      dayCount:
        inclusiveIsoDateCount(cursor, chunkEnd)
    });

    cursor =
      addIsoDateDays(
        chunkEnd,
        1
      );
  }

  return chunks;
}

/* =========================================================
  날짜 더하기
========================================================= */

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

/* =========================================================
  기간 일수 계산
========================================================= */

function getLimestoneUsageBatchDayCount(
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


  const startTime =
    new Date(
      `${startDate}T00:00:00.000Z`
    ).getTime();


  const endTime =
    new Date(
      `${endDate}T00:00:00.000Z`
    ).getTime();


  if (
    startTime >
    endTime
  ) {
    return 0;
  }


  return (
    Math.floor(
      (
        endTime -
        startTime
      ) /
      86400000
    ) +
    1
  );
}


/* =========================================================
  시작일~종료일 날짜 배열 생성

  예:
  2026-08-01 ~ 2026-08-03

  결과:
  [
    "2026-08-01",
    "2026-08-02",
    "2026-08-03"
  ]
========================================================= */

function createLimestoneUsageBatchDates(
  startDate,
  endDate
) {
  const dayCount =
    getLimestoneUsageBatchDayCount(
      startDate,
      endDate
    );


  if (
    dayCount <
      1
  ) {
    return [];
  }


  const dates = [];


  for (
    let dayIndex = 0;
    dayIndex <
      dayCount;
    dayIndex +=
      1
  ) {
    dates.push(
      addIsoDateDays(
        startDate,
        dayIndex
      )
    );
  }


  return dates;
}


/* =========================================================
  JSON 요청 읽기
========================================================= */

async function readJsonBody(
  request
) {
  try {
    const body =
      await request.json();


    return (
      body &&
      typeof body ===
        "object" &&
      !Array.isArray(
        body
      )
    )
      ? body
      : {};

  } catch {
    return {};
  }
}


/* =========================================================
  로그인 세션 토큰
========================================================= */

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


/* =========================================================
  업무일지 로그인 사용자 확인
========================================================= */

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
          ON user.employee_no =
             session.employee_no

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


  const role =
    employeeNo ===
      FORCED_SUPER_ADMIN_EMPLOYEE_NO
        ? "super_admin"
        : normalizeAccountRole(
            session.role
          );


  /*
    [D1-POLLING-OPT-V1]

    상태조회 요청마다 last_used_at을 쓰지 않는다.
    인증 SELECT에서 이미 읽은 last_used_at을 이용해
    5분 이상 지난 경우에만 실제 UPDATE를 수행한다.

    세션 만료 판단은 expires_at 기준이므로
    오전회의 조회 속도/로그인 유효성에는 영향이 없다.
  */
  const previousLastUsedAt =
    new Date(
      session.last_used_at ||
      0
    );


  const shouldRefreshLastUsedAt =
    Number.isNaN(
      previousLastUsedAt.getTime()
    ) ||
    (
      now.getTime() -
      previousLastUsedAt.getTime()
    ) >=
      5 *
      60 *
      1000;


  if (
    shouldRefreshLastUsedAt
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

      role
    }
  };
}


/* =========================================================
  OIS 연동 프로그램 인증

  회사 PC 프로그램은 다음 헤더를 사용한다.

  X-OIS-Agent-Key: 비밀키
========================================================= */

async function authenticateOisAgent(
  context
) {
  const savedAgentKey =
    normalizeText(
      context.env
        .OIS_AGENT_KEY
    );


  if (
    !savedAgentKey
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "Cloudflare 비밀변수 OIS_AGENT_KEY가 등록되지 않았습니다."
          },
          500
        )
    };
  }


  const requestedAgentKey =
    normalizeText(
      context.request.headers.get(
        "X-OIS-Agent-Key"
      )
    );


  if (
    !requestedAgentKey
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "OIS 연동 프로그램 인증키가 없습니다."
          },
          401
        )
    };
  }


  const [
    savedHash,
    requestedHash
  ] =
    await Promise.all([
      hashText(
        savedAgentKey
      ),

      hashText(
        requestedAgentKey
      )
    ]);


  if (
    savedHash !==
      requestedHash
  ) {
    return {
      error:
        jsonResponse(
          {
            ok:
              false,

            message:
              "OIS 연동 프로그램 인증키가 올바르지 않습니다."
          },
          403
        )
    };
  }


  return {
    agentId:
      normalizeText(
        context.request.headers.get(
          "X-OIS-Agent-Id"
        )
      ) ||
      "company-pc"
  };
}

/* =========================================================
  OIS 요청 유형 정리

  지원:
  - limestone_stock
  - water_environment
  - turbine_gear_pinion
  - auxiliary_materials
  - silo_level
  - bed_ash_level
  - fbhe_vibration
  - daily_data_excel
  - organic_silo_dataparc
  - steam_status
  - logsheet_approval
========================================================= */

/* [FBHE-VIBRATION-SHADOW-V1] OIS queue request type */
const OIS_REQUEST_TYPES = [
  "cofiring_daily",
  "cofiring_period",
  "limestone_stock",
  "water_environment",
  "turbine_gear_pinion",
  "auxiliary_materials",
  "silo_level",
  "bed_ash_level",
  "fbhe_vibration",
  "daily_data_excel",
  "organic_silo_dataparc",
  "steam_status",
  "logsheet_approval",
  "logsheet_pdf",
  "seal_pot_runtime",
  BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
  "open_final_excel_folder"
];


function normalizeRequestType(
  value
) {
  const requestType =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );


  if (
    !requestType
  ) {
    return DEFAULT_REQUEST_TYPE;
  }


  return OIS_REQUEST_TYPES.includes(
    requestType
  )
    ? requestType
    : "";
}


/* =========================================================
  에이전트 통합 조회용 요청 유형 목록 정리

  예:
  water_environment,limestone_stock,silo_level

  - 지원 유형만 허용
  - 중복 제거
  - 전달된 순서는 그대로 유지
========================================================= */

function normalizeRequestTypeList(
  value
) {
  const requestTypes = [];


  const seenRequestTypes =
    new Set();


  String(
    value ||
    ""
  )
    .split(
      ","
    )
    .forEach(
      rawRequestType => {
        const requestType =
          normalizeText(
            rawRequestType
          )
            .toLowerCase()
            .replace(
              /[\s-]+/g,
              "_"
            );


        if (
          !OIS_REQUEST_TYPES.includes(
            requestType
          ) ||
          seenRequestTypes.has(
            requestType
          )
        ) {
          return;
        }


        seenRequestTypes.add(
          requestType
        );


        requestTypes.push(
          requestType
        );
      }
    );


  return requestTypes;
}

/* =========================================================
  숫자 정리
========================================================= */

function normalizeOisNumber(
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


/* ORGANIC_SILO_DATAPARC_API_V1
  A separate result type preserves all other Daily DATA card fields.
  Store only a full, Good, correctly dated inventory after owned Excel cleanup.
*/
const ORGANIC_SILO_DATAPARC_REQUEST_TYPE = "organic_silo_dataparc";
const ORGANIC_SILO_DATAPARC_TAGS = [
  { key: "organicDaySilo", label: "Day Silo", tag: "GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT" },
  { key: "organicStorageSiloA", label: "Storage A", tag: "GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT" },
  { key: "organicStorageSiloB", label: "Storage B", tag: "GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT" }
];

function isOrganicSiloQualityGood(value) {
  if (typeof value !== "string") return false;
  const tokens = value.split(",").map(token => token.trim().toLowerCase());
  return (tokens.length === 1 && tokens[0] === "good") ||
    (tokens.length === 2 && tokens.includes("raw") && tokens.includes("good"));
}

function normalizeOrganicSiloDataParcResult(rawResult, targetDate) {
  const invalid = message => ({ error: `유기성 Silo DataPARC 결과: ${message}` });
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const equalNumber = (left, right) => number(left) && number(right) &&
    Math.abs(left - right) <= 1e-9;
  if (!object(rawResult) || !isValidIsoDate(targetDate) || rawResult.targetDate !== targetDate) {
    return invalid("요청 날짜와 결과 날짜가 일치하지 않습니다.");
  }
  const intervalStartKst = `${targetDate}T00:00:00+09:00`;
  const start = Date.parse(intervalStartKst);
  const end = start + 86400000;
  const intervalEndKst = formatKstRfc3339(new Date(end).toISOString());
  if (rawResult.schemaVersion !== 1 || rawResult.source !== "dataparc_hidden_excel" ||
      rawResult.aggregation !== "End" || rawResult.step !== "1D" ||
      rawResult.intervalStartKst !== intervalStartKst || rawResult.intervalEndKst !== intervalEndKst) {
    return invalid("조회 출처, 집계 방식 또는 하루 조회 구간이 일치하지 않습니다.");
  }
  if (rawResult.qualityValidationVersion !== "1.2" || rawResult.allQualitiesGood !== true ||
      rawResult.cleanupVerified !== true) {
    return invalid("정상 품질과 조회용 Excel 종료 확인이 필요합니다.");
  }
  if (!Array.isArray(rawResult.samples) || rawResult.samples.length !== 3) {
    return invalid("조회일의 Silo 표본 3개가 필요합니다.");
  }
  const periodStartKst = intervalStartKst.replace("T", " ");
  const periodEndKst = intervalEndKst.replace("T", " ");
  const samples = [];
  const values = {};
  for (const definition of ORGANIC_SILO_DATAPARC_TAGS) {
    const matches = rawResult.samples.filter(sample => object(sample) && sample.key === definition.key);
    const sample = matches[0];
    if (matches.length !== 1 || sample.date !== targetDate || sample.label !== definition.label ||
        sample.tag !== definition.tag || !equalNumber(sample.value, rawResult[definition.key])) {
      return invalid(`Silo TAG, 날짜 또는 재고값이 일치하지 않습니다: ${definition.key}`);
    }
    if (!isOrganicSiloQualityGood(sample.qualityText)) {
      return invalid(`품질이 Good이 아닙니다: ${definition.label}`);
    }
    if ((sample.periodStartKst !== undefined && sample.periodStartKst !== periodStartKst) ||
        (sample.periodEndKst !== undefined && sample.periodEndKst !== periodEndKst) ||
        (sample.statistic !== undefined && sample.statistic !== "End")) {
      return invalid(`표본의 하루 End 구간이 일치하지 않습니다: ${definition.label}`);
    }
    const timeText = sample.returnedTimeText;
    const parsedTime = typeof timeText === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timeText)
      ? parseStrictRfc3339(`${timeText.replace(" ", "T")}+09:00`)
      : null;
    if (!parsedTime || parsedTime.timestamp < start || parsedTime.timestamp > end) {
      return invalid(`반환 시각이 조회 구간에 없습니다: ${definition.label}`);
    }
    values[definition.key] = sample.value;
    samples.push({
      date: targetDate, key: definition.key, label: definition.label, tag: definition.tag,
      value: sample.value, qualityText: sample.qualityText.trim(), qualityGood: true,
      returnedTimeText: timeText, periodStartKst, periodEndKst, statistic: "End"
    });
  }
  const total = values.organicDaySilo + values.organicStorageSiloA + values.organicStorageSiloB;
  if (!equalNumber(rawResult.organicSiloTotal, total)) {
    return invalid("총 재고량이 반올림 전 Silo 3개 값의 합계와 일치하지 않습니다.");
  }
  return { result: {
    schemaVersion: 1, source: "dataparc_hidden_excel", targetDate, aggregation: "End", step: "1D",
    intervalStartKst, intervalEndKst, ...values, organicSiloTotal: total, samples,
    qualityValidationVersion: "1.2", allQualitiesGood: true, cleanupVerified: true
  } };
}


/* =========================================================
  효율팀 Bed Ash Level 에이전트 결과 검증

  - 요청 날짜와 결과 날짜가 같아야 한다.
  - 1·2호기의 허용된 TAG가 모두 있어야 한다.
  - 각 호기에 유효한 시간별 표본이 하나 이상 있어야 한다.
  - 반출 판정은 전용 API에서 수행하므로 여기서는 원시 Level만
    허용 목록 형태로 정규화한다.
========================================================= */

const BED_ASH_LEVEL_UNIT_DEFINITIONS = [
  {
    unitNo:
      1,

    tagNumber:
      "104HDC01CW101XQ01",

    itemName:
      "#1 UNIT BED ASH SILO WE WT-2011"
  },

  {
    unitNo:
      2,

    tagNumber:
      "204HDC01CW101XQ01",

    itemName:
      "#2 UNIT BED ASH SILO WE WT-2012"
  }
];


function getBedAshExpectedSampleAt(
  targetDate,
  hour
) {
  const normalizedHour =
    Number(
      hour
    );


  if (
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
    60 *
    60 *
    1000;


  const shiftedDate =
    new Date(
      epochMilliseconds +
      9 *
      60 *
      60 *
      1000
    );


  const pad =
    value => {
      return String(
        value
      ).padStart(
        2,
        "0"
      );
    };


  return {
    epochMilliseconds,

    sampledAt:
      [
        shiftedDate.getUTCFullYear(),
        "-",
        pad(
          shiftedDate.getUTCMonth() +
          1
        ),
        "-",
        pad(
          shiftedDate.getUTCDate()
        ),
        "T",
        pad(
          shiftedDate.getUTCHours()
        ),
        ":00:00+09:00"
      ].join(
        ""
      )
  };
}


function normalizeBedAshLevelResult(
  rawResult,
  targetDate
) {
  if (
    !rawResult ||
    typeof rawResult !==
      "object" ||
    Array.isArray(
      rawResult
    )
  ) {
    return {
      error:
        "Bed Ash Level 결과가 올바른 객체 형식이 아닙니다."
    };
  }


  const resultTargetDate =
    normalizeText(
      rawResult.targetDate ||
      rawResult.target_date
    );


  if (
    resultTargetDate !==
      targetDate
  ) {
    return {
      error:
        "Bed Ash Level 결과 날짜가 요청 날짜와 다릅니다."
    };
  }


  const rawUnits =
    Array.isArray(
      rawResult.units
    )
      ? rawResult.units
      : [];


  const validationNow =
    Date.now();


  const rawCollectedAt =
    normalizeText(
      rawResult.collectedAt ||
      rawResult.collected_at
    );


  const parsedCollectedAt =
    Date.parse(
      rawCollectedAt
    );


  const collectedAtMilliseconds =
    Number.isFinite(
      parsedCollectedAt
    )
      ? Math.min(
          parsedCollectedAt,
          validationNow
        )
      : validationNow;


  const maximumSampleTime =
    collectedAtMilliseconds -
    5 *
    60 *
    1000;


  const normalizedUnits =
    [];


  for (
    const definition of
      BED_ASH_LEVEL_UNIT_DEFINITIONS
  ) {
    const rawUnit =
      rawUnits.find(
        candidate => {
          return Number(
            candidate?.unitNo ??
            candidate?.unit_no
          ) ===
            definition.unitNo;
        }
      );


    const tagNumber =
      normalizeText(
        rawUnit?.tagNumber ||
        rawUnit?.tag_number ||
        rawUnit?.tag
      ).toUpperCase();


    if (
      !rawUnit ||
      tagNumber !==
        definition.tagNumber
    ) {
      return {
        error:
          `${definition.unitNo}호기 Bed Ash TAG 결과가 없거나 올바르지 않습니다.`
      };
    }


    const sampleMap =
      new Map();


    const rawSamples =
      Array.isArray(
        rawUnit.samples
      )
        ? rawUnit.samples
        : [];


    rawSamples.forEach(
      rawSample => {
        const expectedSample =
          getBedAshExpectedSampleAt(
            targetDate,
            rawSample?.hour
          );


        const rawLevelTon =
          rawSample?.levelTon ??
          rawSample?.level_ton;


        if (
          !expectedSample ||
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
          normalizeOisNumber(
            rawLevelTon
          );


        if (
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


        if (
          expectedSample.epochMilliseconds >
            maximumSampleTime
        ) {
          return;
        }


        sampleMap.set(
          Number(
            rawSample.hour
          ),
          {
            hour:
              Number(
                rawSample.hour
              ),

            sampledAt:
              expectedSample.sampledAt,

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
          return firstSample.hour -
            secondSample.hour;
        }
      );


    if (
      samples.length ===
        0
    ) {
      return {
        error:
          `${definition.unitNo}호기 Bed Ash 시간별 Level 값이 없습니다.`
      };
    }


    normalizedUnits.push({
      unitNo:
        definition.unitNo,

      tag:
        definition.tagNumber,

      tagNumber:
        definition.tagNumber,

      itemName:
        normalizeText(
          rawUnit.itemName ||
          rawUnit.item_name
        ).slice(
          0,
          200
        ) ||
        definition.itemName,

      unit:
        "t",

      samples,

      sampleCount:
        samples.length
    });
  }


  return {
    result: {
      source:
        normalizeText(
          rawResult.source
        ).slice(
          0,
          200
        ),

      targetDate,

      thresholdTon:
        5,

      units:
        normalizedUnits,

      collectedAt:
        new Date(
          collectedAtMilliseconds
        ).toISOString()
    }
  };
}

/* =========================================================
  석회석 사용량 숫자 정리

  규칙:
  - 반올림하지 않음
  - 소수점 둘째 자리 아래 절삭
  - 부동소수점 오차 보정

  예:
  38.70400000000001 → 38.70
  33.89699999999999 → 33.89
========================================================= */

function normalizeLimestoneUsageNumber(
  value
) {
  const numericValue =
    Number(
      value
    );


  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return null;
  }


  /*
    33.89가 내부적으로
    33.889999999999처럼 표현되는 문제를 보정한다.
  */
  const floatingPointCorrection =
    Math.sign(
      numericValue
    ) *
    0.000000001;


  return (
    Math.trunc(
      (
        numericValue +
        floatingPointCorrection
      ) *
      100
    ) /
    100
  );
}

/* =========================================================
  사용량 DB 행 → API 응답
========================================================= */

function convertLimestoneUsageRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    usageDate:
      normalizeText(
        row.usage_date
      ),

    unitNo:
      Number(
        row.unit_no
      ),

    startStock:
      normalizeOisNumber(
        row.start_stock
      ),

    receiptQuantity:
      normalizeOisNumber(
        row.receipt_quantity
      ),

    endStock:
      normalizeOisNumber(
        row.end_stock
      ),

    usageQuantity:
      normalizeOisNumber(
        row.usage_quantity
      ),

    oisTag:
      normalizeText(
        row.ois_tag
      ),

    oisRequestId:
      normalizeText(
        row.ois_request_id
      ),

    oisCollectedAt:
      normalizeText(
        row.ois_collected_at
      ),

    agentId:
      normalizeText(
        row.agent_id
      ),

    calculationMode:
      normalizeText(
        row.calculation_mode
      ),

    batchId:
      normalizeText(
        row.batch_id
      ),

    createdById:
      normalizeText(
        row.created_by_id
      ),

    createdByName:
      normalizeText(
        row.created_by_name
      ),

    updatedById:
      normalizeText(
        row.updated_by_id
      ),

    updatedByName:
      normalizeText(
        row.updated_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    revision:
      Number(
        row.revision
      ) ||
      1
  };
}


/* =========================================================
  날짜별 저장 사용량 조회
========================================================= */

async function findLimestoneUsageRecordsByDate(
  database,
  usageDate
) {
  const queryResult =
    await database
      .prepare(`
        SELECT
          *

        FROM limestone_usage_records

        WHERE usage_date = ?

        ORDER BY unit_no ASC
      `)
      .bind(
        usageDate
      )
      .all();


  return (
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : []
  )
    .map(
      convertLimestoneUsageRow
    )
    .filter(
      Boolean
    );
}


/* =========================================================
  날짜별 1·2호기 입고량 합계 조회

  입고기록이 없는 호기는 0 ton
========================================================= */

async function loadLimestoneReceiptQuantitiesByUnit(
  database,
  usageDate
) {
  const queryResult =
    await database
      .prepare(`
        SELECT
          unit_no,

          COALESCE(
            SUM(
              quantity_ton
            ),
            0
          ) AS total_quantity

        FROM limestone_receipts

        WHERE
          receipt_date = ?
          AND unit_no IN (
            1,
            2
          )

        GROUP BY unit_no
      `)
      .bind(
        usageDate
      )
      .all();


  const receiptByUnit = {
    1:
      0,

    2:
      0
  };


  const rows =
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : [];


  rows.forEach(
    row => {
      const unitNo =
        Number(
          row.unit_no
        );


      const quantity =
        normalizeLimestoneUsageNumber(
          row.total_quantity
        );


      if (
        [
          1,
          2
        ].includes(
          unitNo
        ) &&
        quantity !==
          null
      ) {
        receiptByUnit[
          unitNo
        ] =
          quantity;
      }
    }
  );


  return receiptByUnit;
}


/* =========================================================
  OIS 석회석 재고 결과 → 사용량 자동 계산·저장

  계산식:
  사용량 =
    전일 재고
    + 당일 입고량
    - 24시 재고

  같은 날짜·호기가 이미 있으면:
  신규 행을 만들지 않고 최신 값으로 갱신한다.
========================================================= */

async function saveLimestoneUsageRecords(
  database,
  options
) {
  const requestItem =
    options?.requestItem ||
    {};


  const normalizedResult =
    options?.normalizedResult ||
    {};


  const usageDate =
    normalizeText(
      normalizedResult.targetDate ||
      requestItem.targetDate
    );


  if (
    !isValidIsoDate(
      usageDate
    )
  ) {
    throw new Error(
      "석회석 사용량 저장 날짜가 올바르지 않습니다."
    );
  }


  /*
    실제 석회석 입고기록 기준으로
    1·2호기 입고량을 다시 계산한다.
  */
  const receiptByUnit =
    await loadLimestoneReceiptQuantitiesByUnit(
      database,
      usageDate
    );


  const agentId =
    normalizeText(
      options?.agentId ||
      requestItem.agentId
    );


  const calculationMode =
    normalizeText(
      options?.calculationMode
    ) ||
    "single";


  const batchId =
    normalizeText(
      options?.batchId
    );


  const requestedById =
    normalizeEmployeeNo(
      requestItem.requestedById
    );


  const requestedByName =
    normalizeText(
      requestItem.requestedByName
    );


  const oisCollectedAt =
    normalizeText(
      normalizedResult.collectedAt
    );


  const timestamp =
    new Date()
      .toISOString();


  /*
    2026-08-10부터는
    석회석 관리와 부재료 관리가 연동된다.
  */
  const shouldSyncAuxiliaryMaterial =
    usageDate >=
      "2026-08-10";


  /*
    부재료 테이블이 없는 환경에서도
    안전하게 연동할 수 있도록 준비한다.
  */
  if (
    shouldSyncAuxiliaryMaterial
  ) {
    await ensureAuxiliaryMaterialDailyTable(
      database
    );
  }


  const unitDefinitions = [
    {
      unitNo:
        1,

      defaultTag:
        "103HRJ01CW201XQ01",

      result:
        normalizedResult.unitOne ||
        {}
    },

    {
      unitNo:
        2,

      defaultTag:
        "203HRJ01CW201XQ01",

      result:
        normalizedResult.unitTwo ||
        {}
    }
  ];


  for (
    const unitDefinition of
    unitDefinitions
  ) {
    const unitNo =
      unitDefinition.unitNo;


    const startStock =
      normalizeOisNumber(
        unitDefinition
          .result
          .startStock
      );


    const endStock =
      normalizeOisNumber(
        unitDefinition
          .result
          .endStock
      );


    const receiptQuantity =
      normalizeLimestoneUsageNumber(
        receiptByUnit[
          unitNo
        ] ||
        0
      );


    if (
      startStock ===
        null ||
      endStock ===
        null ||
      receiptQuantity ===
        null
    ) {
      throw new Error(
        `${unitNo}호기 석회석 사용량 계산값을 확인할 수 없습니다.`
      );
    }


    /*
      사용량 =
      전일 재고 + 당일 입고량 - 24시 재고
    */
    const usageQuantity =
      normalizeLimestoneUsageNumber(
        startStock +
        receiptQuantity -
        endStock
      );


    if (
      usageQuantity ===
        null
    ) {
      throw new Error(
        `${unitNo}호기 석회석 사용량을 계산하지 못했습니다.`
      );
    }


    const oisTag =
      normalizeText(
        unitDefinition
          .result
          .tag
      ) ||
      unitDefinition
        .defaultTag;


    /* =====================================================
      1. 석회석 사용량 원본 저장
    ====================================================== */

    await database
      .prepare(`
        INSERT INTO limestone_usage_records (
          id,

          usage_date,
          unit_no,

          start_stock,
          receipt_quantity,
          end_stock,
          usage_quantity,

          ois_tag,
          ois_request_id,
          ois_collected_at,
          agent_id,

          calculation_mode,
          batch_id,

          created_by_id,
          created_by_name,
          updated_by_id,
          updated_by_name,

          created_at,
          updated_at,
          revision
        )
        VALUES (
          ?,

          ?,
          ?,

          ?,
          ?,
          ?,
          ?,

          ?,
          ?,
          ?,
          ?,

          ?,
          ?,

          ?,
          ?,
          ?,
          ?,

          ?,
          ?,
          1
        )

        ON CONFLICT (
          usage_date,
          unit_no
        )

        DO UPDATE SET
          start_stock =
            excluded.start_stock,

          receipt_quantity =
            excluded.receipt_quantity,

          end_stock =
            excluded.end_stock,

          usage_quantity =
            excluded.usage_quantity,

          ois_tag =
            excluded.ois_tag,

          ois_request_id =
            excluded.ois_request_id,

          ois_collected_at =
            excluded.ois_collected_at,

          agent_id =
            excluded.agent_id,

          calculation_mode =
            excluded.calculation_mode,

          batch_id =
            excluded.batch_id,

          updated_by_id =
            excluded.updated_by_id,

          updated_by_name =
            excluded.updated_by_name,

          updated_at =
            excluded.updated_at,

          revision =
            limestone_usage_records.revision +
            1
      `)
      .bind(
        crypto.randomUUID(),

        usageDate,
        unitNo,

        startStock,
        receiptQuantity,
        endStock,
        usageQuantity,

        oisTag,
        normalizeText(
          requestItem.id
        ),
        oisCollectedAt,
        agentId,

        calculationMode,
        batchId,

        requestedById,
        requestedByName,
        requestedById,
        requestedByName,

        timestamp,
        timestamp
      )
      .run();


    /* =====================================================
      2. 부재료 일별 현황 동기화

      중요:
      부재료 행이 이미 존재하는 경우에만 갱신한다.

      여기서 신규 부재료 행을 만들지는 않는다.

      동기화:
      - 시작 재고
      - 입고량
      - 종료 재고
      - Limestone 사용량

      그 외:
      - SOx
      - NOx
      - Slurry
      - Lime Powder
      - Ammonia

      기존 값을 그대로 유지한다.
    ====================================================== */

    if (
      shouldSyncAuxiliaryMaterial
    ) {
      await database
        .prepare(`
          INSERT INTO auxiliary_material_daily (
            id,
            record_date,
            unit_no,

            limestone_start_stock,
            limestone_receipt_ton,
            limestone_end_stock,
            limestone_usage_tpd,

            created_by_id,
            created_by_name,
            updated_by_id,
            updated_by_name,

            created_at,
            updated_at
          )
          VALUES (
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?
          )

          ON CONFLICT(record_date, unit_no)
          DO UPDATE SET
            limestone_start_stock =
              excluded.limestone_start_stock,

            limestone_receipt_ton =
              excluded.limestone_receipt_ton,

            limestone_end_stock =
              excluded.limestone_end_stock,

            limestone_usage_tpd =
              excluded.limestone_usage_tpd,

            updated_by_id =
              excluded.updated_by_id,

            updated_by_name =
              excluded.updated_by_name,

            updated_at =
              excluded.updated_at,

            revision =
              auxiliary_material_daily.revision + 1
        `)
        .bind(
          crypto.randomUUID(),
          usageDate,
          unitNo,

          startStock,
          receiptQuantity,
          endStock,
          usageQuantity,

          requestedById,
          requestedByName,
          requestedById,
          requestedByName,

          timestamp,
          timestamp
        )
        .run();
    }
  }


  return await findLimestoneUsageRecordsByDate(
    database,
    usageDate
  );
}

/* =========================================================
  석회석 OIS 결과 검증
========================================================= */

function normalizeLimestoneStockResult(
  rawResult,
  targetDate
) {
  const result =
    rawResult &&
    typeof rawResult ===
      "object" &&
    !Array.isArray(
      rawResult
    )
      ? rawResult
      : {};


  const unitOne =
    result.unitOne ||
    result.unit1 ||
    {};


  const unitTwo =
    result.unitTwo ||
    result.unit2 ||
    {};


  const unitOneStartStock =
    normalizeOisNumber(
      unitOne.startStock
    );


  const unitOneEndStock =
    normalizeOisNumber(
      unitOne.endStock
    );


  const unitTwoStartStock =
    normalizeOisNumber(
      unitTwo.startStock
    );


  const unitTwoEndStock =
    normalizeOisNumber(
      unitTwo.endStock
    );


  if (
    unitOneStartStock ===
      null ||
    unitOneEndStock ===
      null ||
    unitTwoStartStock ===
      null ||
    unitTwoEndStock ===
      null
  ) {
    return {
      error:
        "1호기와 2호기의 시작·종료 재고값을 모두 확인해 주세요."
    };
  }


  const nextDate =
    addIsoDateDays(
      targetDate,
      1
    );


  return {
    result: {
      targetDate,

      nextDate,

      unitOne: {
        tag:
          "103HRJ01CW201XQ01",

        startStock:
          unitOneStartStock,

        endStock:
          unitOneEndStock
      },

      unitTwo: {
        tag:
          "203HRJ01CW201XQ01",

        startStock:
          unitTwoStartStock,

        endStock:
          unitTwoEndStock
      },

      collectedAt:
        normalizeText(
          result.collectedAt
        ) ||
        new Date()
          .toISOString()
    }
  };
}

/* =========================================================
  OIS 과거 LOG SHEET 업무일지 결과 정규화

  중요:
  - DAY / AFTER / NIGHT 원본을 그대로 보존
  - 이 단계에서는 DS / NS 변환하지 않음
  - 내용 없는 AFTER 행도 저장하여
    향후 2교대 전환시점 확인에 사용
========================================================= */

function normalizeOisLegacyApprovalResult(
  rawResult,
  targetDate
) {
  const result =
    rawResult &&
    typeof rawResult ===
      "object" &&
    !Array.isArray(
      rawResult
    )
      ? rawResult
      : {};


  const allowedRoles =
    new Set([
      "TGO",
      "BCO1",
      "BCO2",
      "TO",
      "BO1",
      "BO2"
    ]);


  const allowedShifts =
    new Set([
      "DAY",
      "AFTER",
      "NIGHT"
    ]);


  const rawRecords =
    Array.isArray(
      result.records
    )
      ? result.records
      : [];


  const records =
    rawRecords
      .map(
        (
          rawRecord,
          recordIndex
        ) => {
          const source =
            rawRecord &&
            typeof rawRecord ===
              "object"
              ? rawRecord
              : {};


          const original =
            source.original &&
            typeof source.original ===
              "object"
              ? source.original
              : {};


          const role =
            normalizeText(
              source.role ||
              original.sheet_alias ||
              original.sheetAlias
            )
              .toUpperCase();


          const originalShift =
            normalizeText(
              source.originalShift ||
              source.original_shift ||
              original.time ||
              original.work_time
            )
              .toUpperCase();


          if (
            !allowedRoles.has(
              role
            ) ||
            !allowedShifts.has(
              originalShift
            )
          ) {
            return null;
          }


          /*
            업무내용은 줄바꿈을 보존한다.
          */

          const content =
            String(
              source.content ??
              original.rmk ??
              ""
            )
              .replace(
                /\r\n?/g,
                "\n"
              )
              .trim();


          return {
            workDate:
              targetDate,

            role,

            originalShift,

            worker:
              normalizeText(
                source.worker ||
                original.worker
              ),

            content,

            hasContent:
              Boolean(
                content
              ),

            workerApproval:
              normalizeText(
                source.workerApproval ||
                source.worker_approval ||
                original.work_state
              ),

            partApproval:
              normalizeText(
                source.partApproval ||
                source.part_approval ||
                original.part_state
              ),

            approvalState:
              normalizeText(
                source.approvalState ||
                source.approval_state ||
                original.aprv_state
              ),

            oisState:
              normalizeText(
                source.state ||
                original.state
              ),

            sheetCode:
              normalizeText(
                source.sheetCode ||
                source.sheet_code ||
                original.sheet_code ||
                original.sheet ||
                original.pos_info_code
              ),

            sourceRowIndex:
              Number(
                source.sourceRowIndex ??
                recordIndex
              ),

            original:
              Object.keys(
                original
              ).length
                ? original
                : source
          };
        }
      )
      .filter(
        Boolean
      );


  return {
    result: {
      ...result,

      targetDate,

      records
    }
  };
}


/* =========================================================
  OIS 과거 LOG SHEET 업무일지 D1 저장

  고유 기준:
  날짜 + 보직 + 원본 근무

  예:
  2022-09-22 + BCO1 + NIGHT

  같은 자료를 다시 가져오면
  신규 행을 만들지 않고 최신값으로 갱신한다.
========================================================= */

async function saveOisLegacyApprovalRecords(
  database,
  options
) {
  const requestItem =
    options?.requestItem ||
    {};


  const normalizedResult =
    options?.normalizedResult ||
    {};


  const agentId =
    normalizeText(
      options?.agentId
    );


  const targetDate =
    normalizeText(
      normalizedResult.targetDate ||
      requestItem.targetDate
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    throw new Error(
      "OIS 과거 업무일지 저장 날짜가 올바르지 않습니다."
    );
  }


  const records =
    Array.isArray(
      normalizedResult.records
    )
      ? normalizedResult.records
      : [];


  const now =
    new Date()
      .toISOString();


  const requestId =
    normalizeText(
      requestItem.id
    );


  const collectedAt =
    normalizeText(
      normalizedResult.collectedAt
    ) ||
    now;


  let createdCount =
    0;


  let updatedCount =
    0;


  for (
    const record of
    records
  ) {
    const role =
      normalizeText(
        record.role
      )
        .toUpperCase();


    const originalShift =
      normalizeText(
        record.originalShift
      )
        .toUpperCase();


    if (
      !role ||
      !originalShift
    ) {
      continue;
    }


    const existingRow =
      await database
        .prepare(`
          SELECT
            id

          FROM ois_legacy_logs

          WHERE
            work_date = ?
            AND role = ?
            AND original_shift = ?

          LIMIT 1
        `)
        .bind(
          targetDate,
          role,
          originalShift
        )
        .first();


    const recordId =
      normalizeText(
        existingRow?.id
      ) ||
      crypto.randomUUID();


    await database
      .prepare(`
        INSERT INTO ois_legacy_logs (
          id,

          work_date,
          role,
          original_shift,

          worker,
          content,
          has_content,

          worker_approval,
          part_approval,
          approval_state,
          ois_state,

          sheet_code,

          ois_request_id,
          collected_at,

          original_json,

          created_at,
          updated_at
        )
        VALUES (
          ?,

          ?,
          ?,
          ?,

          ?,
          ?,
          ?,

          ?,
          ?,
          ?,
          ?,

          ?,

          ?,
          ?,

          ?,

          ?,
          ?
        )

        ON CONFLICT (
          work_date,
          role,
          original_shift
        )
        DO UPDATE SET
          worker =
            excluded.worker,

          content =
            excluded.content,

          has_content =
            excluded.has_content,

          worker_approval =
            excluded.worker_approval,

          part_approval =
            excluded.part_approval,

          approval_state =
            excluded.approval_state,

          ois_state =
            excluded.ois_state,

          sheet_code =
            excluded.sheet_code,

          ois_request_id =
            excluded.ois_request_id,

          collected_at =
            excluded.collected_at,

          original_json =
            excluded.original_json,

          updated_at =
            excluded.updated_at
      `)
      .bind(
        recordId,

        targetDate,
        role,
        originalShift,

        normalizeText(
          record.worker
        ),

        String(
          record.content ||
          ""
        ),

        record.hasContent
          ? 1
          : 0,

        normalizeText(
          record.workerApproval
        ),

        normalizeText(
          record.partApproval
        ),

        normalizeText(
          record.approvalState
        ),

        normalizeText(
          record.oisState
        ),

        normalizeText(
          record.sheetCode
        ),

        requestId,

        collectedAt,

        JSON.stringify(
          record.original ||
          {}
        ),

        existingRow
          ? now
          : now,

        now
      )
      .run();


    if (
      existingRow
    ) {
      updatedCount +=
        1;

    } else {
      createdCount +=
        1;
    }
  }


  return {
    targetDate,

    totalCount:
      records.length,

    createdCount,

    updatedCount,

    agentId
  };
}

/* =========================================================
  DB 행 → 응답
========================================================= */

function convertRequestRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  let result =
    null;


  const resultJson =
    normalizeText(
      row.result_json
    );


  if (
    resultJson
  ) {
    try {
      result =
        JSON.parse(
          resultJson
        );

    } catch {
      result =
        null;
    }
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    requestType:
      normalizeText(
        row.request_type
      ),

    targetDate:
      normalizeText(
        row.target_date
      ),

    status:
      normalizeText(
        row.status
      ),

    requestedById:
      normalizeText(
        row.requested_by_id
      ),

    requestedByName:
      normalizeText(
        row.requested_by_name
      ),

    requestedAt:
      normalizeText(
        row.requested_at
      ),

    startedAt:
      normalizeText(
        row.started_at
      ),

    completedAt:
      normalizeText(
        row.completed_at
      ),

    agentId:
      normalizeText(
        row.agent_id
      ),

    result,

    errorMessage:
      normalizeText(
        row.error_message
      ),

    expiresAt:
      normalizeText(
        row.expires_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      )
  };
}


const blowerRuntimeProbeSchemaPromises =
  new WeakMap();


async function ensureBlowerRuntimeProbeSchema(
  database
) {
  const existingPromise =
    blowerRuntimeProbeSchemaPromises.get(
      database
    );


  if (
    existingPromise
  ) {
    return await existingPromise;
  }


  const schemaPromise =
    database
      .batch([
        /*
          V1 table is kept only as a migration source so requests created
          before the range-query rollout can still be copied forward.
        */
        database.prepare(`
          CREATE TABLE IF NOT EXISTS blower_runtime_probe_intents (
            request_id TEXT PRIMARY KEY NOT NULL,
            reuse_key TEXT UNIQUE,
            schema_version INTEGER NOT NULL,
            asset_tag TEXT NOT NULL,
            dataparc_tag TEXT NOT NULL,
            window_start TEXT NOT NULL,
            window_end TEXT NOT NULL,
            chunk_days INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL,
            expected_last_replacement_at TEXT NOT NULL,
            expected_cycle_start_state TEXT NOT NULL,
            expected_cycle_started_at TEXT NOT NULL,
            expected_cycle_start_revision TEXT NOT NULL,
            expected_cycle_runtime_revision TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK(schema_version = 1),
            CHECK(asset_tag = '104ETH03AN602'),
            CHECK(dataparc_tag = 'GSPOGE.ABB_DCS.003ETH03AN602XB04'),
            CHECK(expected_cycle_start_state = 'started'),
            CHECK(chunk_days = 31),
            CHECK(chunk_count >= 1)
          )
        `),

        /*
          V2 intent storage permits the existing legacy Cycle to be used as
          a read-only DataPARC range baseline. Pending Cycles are still
          rejected by the request creator.
        */
        database.prepare(`
          CREATE TABLE IF NOT EXISTS blower_runtime_probe_intents_v2 (
            request_id TEXT PRIMARY KEY NOT NULL,
            reuse_key TEXT UNIQUE,
            schema_version INTEGER NOT NULL,
            asset_tag TEXT NOT NULL,
            dataparc_tag TEXT NOT NULL,
            window_start TEXT NOT NULL,
            window_end TEXT NOT NULL,
            chunk_days INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL,
            expected_last_replacement_at TEXT NOT NULL,
            expected_cycle_start_state TEXT NOT NULL,
            expected_cycle_started_at TEXT NOT NULL,
            expected_cycle_start_revision TEXT NOT NULL,
            expected_cycle_runtime_revision TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK(schema_version = 1),
            CHECK(asset_tag = '104ETH03AN602'),
            CHECK(dataparc_tag = 'GSPOGE.ABB_DCS.003ETH03AN602XB04'),
            CHECK(expected_cycle_start_state IN ('legacy', 'started')),
            CHECK(chunk_days = 31),
            CHECK(chunk_count >= 1)
          )
        `),

        database.prepare(`
          INSERT OR IGNORE INTO blower_runtime_probe_intents_v2 (
            request_id,
            reuse_key,
            schema_version,
            asset_tag,
            dataparc_tag,
            window_start,
            window_end,
            chunk_days,
            chunk_count,
            expected_last_replacement_at,
            expected_cycle_start_state,
            expected_cycle_started_at,
            expected_cycle_start_revision,
            expected_cycle_runtime_revision,
            created_at,
            updated_at
          )
          SELECT
            request_id,
            reuse_key,
            schema_version,
            asset_tag,
            dataparc_tag,
            window_start,
            window_end,
            chunk_days,
            chunk_count,
            expected_last_replacement_at,
            expected_cycle_start_state,
            expected_cycle_started_at,
            expected_cycle_start_revision,
            expected_cycle_runtime_revision,
            created_at,
            updated_at
          FROM blower_runtime_probe_intents
        `),

        database.prepare(`
          CREATE INDEX IF NOT EXISTS
            idx_blower_runtime_probe_intents_v2_asset_revision

          ON blower_runtime_probe_intents_v2 (
            asset_tag,
            expected_cycle_start_revision,
            expected_cycle_runtime_revision,
            created_at DESC
          )
        `),

        // V3 snapshots the selected asset and explicitly confirmed RUN signal.
        database.prepare(`
          CREATE TABLE IF NOT EXISTS blower_runtime_probe_intents_v3 (
            request_id TEXT PRIMARY KEY NOT NULL,
            reuse_key TEXT UNIQUE,
            schema_version INTEGER NOT NULL,
            asset_tag TEXT NOT NULL,
            dataparc_tag TEXT NOT NULL,
            window_start TEXT NOT NULL,
            window_end TEXT NOT NULL,
            chunk_days INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL,
            expected_last_replacement_at TEXT NOT NULL,
            expected_cycle_start_state TEXT NOT NULL,
            expected_cycle_started_at TEXT NOT NULL,
            expected_cycle_start_revision TEXT NOT NULL,
            expected_cycle_runtime_revision TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK(schema_version = 1),
            CHECK(asset_tag IN ('104ETH03AN601', '104ETH03AN602', '104ETG30AN601', '104ETG30AN602', '204ETG30AN601', '204ETG30AN602', '104SDF01AN001', '104SDF01AN002', '204SDF01AN001', '204SDF01AN002', '204LMDF01AN001')),
            CHECK(length(dataparc_tag) BETWEEN 16 AND 200),
            CHECK(substr(dataparc_tag, 1, 15) = 'GSPOGE.ABB_DCS.'),
            CHECK(substr(dataparc_tag, 16, 1) GLOB '[A-Z0-9]'),
            CHECK(dataparc_tag NOT GLOB '*[^A-Z0-9._-]*'),
            CHECK(asset_tag <> '104ETH03AN602' OR dataparc_tag = 'GSPOGE.ABB_DCS.003ETH03AN602XB04'),
            CHECK(expected_cycle_start_state IN ('legacy', 'started')),
            CHECK(chunk_days = 31),
            CHECK(chunk_count >= 1)
          )
        `),

        database.prepare(`
          INSERT OR IGNORE INTO blower_runtime_probe_intents_v3
          SELECT * FROM blower_runtime_probe_intents_v2
        `),

        database.prepare(`
          CREATE INDEX IF NOT EXISTS idx_blower_runtime_probe_intents_v3_asset_revision
          ON blower_runtime_probe_intents_v3 (
            asset_tag, expected_cycle_start_revision,
            expected_cycle_runtime_revision, created_at DESC
          )
        `),

        // V4 adds FBHE/Seal Pot equipment without rebuilding or dropping the V3 table.
        database.prepare(`
          CREATE TABLE IF NOT EXISTS blower_runtime_probe_intents_v4 (
            request_id TEXT PRIMARY KEY NOT NULL,
            reuse_key TEXT UNIQUE,
            schema_version INTEGER NOT NULL,
            asset_tag TEXT NOT NULL,
            dataparc_tag TEXT NOT NULL,
            window_start TEXT NOT NULL,
            window_end TEXT NOT NULL,
            chunk_days INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL,
            expected_last_replacement_at TEXT NOT NULL,
            expected_cycle_start_state TEXT NOT NULL,
            expected_cycle_started_at TEXT NOT NULL,
            expected_cycle_start_revision TEXT NOT NULL,
            expected_cycle_runtime_revision TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK(schema_version = 1),
            CHECK(asset_tag IN ('104ETH03AN601', '104ETH03AN602', '104ETG30AN601', '104ETG30AN602', '204ETG30AN601', '204ETG30AN602', '104SDF01AN001', '104SDF01AN002', '204SDF01AN001', '204SDF01AN002', '204LMDF01AN001', '104HHL60AP611', '104HHL60AP621', '104HHL60AP631', '204HHL60AP611', '204HHL60AP621', '204HHL60AP631', '104HHL10AN611', '104HHL10AN621', '104HHL10AN631', '204HHL10AN611', '204HHL10AN621', '204HHL10AN631')),
            CHECK(length(dataparc_tag) BETWEEN 16 AND 200),
            CHECK(substr(dataparc_tag, 1, 15) = 'GSPOGE.ABB_DCS.'),
            CHECK(substr(dataparc_tag, 16, 1) GLOB '[A-Z0-9]'),
            CHECK(dataparc_tag NOT GLOB '*[^A-Z0-9._-]*'),
            CHECK(asset_tag <> '104ETH03AN602' OR dataparc_tag = 'GSPOGE.ABB_DCS.003ETH03AN602XB04'),
            CHECK(dataparc_tag <> 'GSPOGE.ABB_DCS.003ETH03AN602XB04' OR asset_tag = '104ETH03AN602'),
            CHECK(expected_cycle_start_state IN ('legacy', 'started')),
            CHECK(chunk_days = 31),
            CHECK(chunk_count >= 1)
          )
        `),

        database.prepare(`
          INSERT OR IGNORE INTO blower_runtime_probe_intents_v4
          SELECT * FROM blower_runtime_probe_intents_v3
        `),

        database.prepare(`
          CREATE INDEX IF NOT EXISTS idx_blower_runtime_probe_intents_v4_asset_revision
          ON blower_runtime_probe_intents_v4 (
            asset_tag, expected_cycle_start_revision,
            expected_cycle_runtime_revision, created_at DESC
          )
        `)
      ])
      .catch(
        error => {
          blowerRuntimeProbeSchemaPromises.delete(
            database
          );

          throw error;
        }
      );


  blowerRuntimeProbeSchemaPromises.set(
    database,
    schemaPromise
  );


  return await schemaPromise;
}


function convertBlowerRuntimeProbeIntentRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  return {
    requestId:
      normalizeText(
        row.request_id
      ),

    schemaVersion:
      Number(
        row.schema_version
      ) ||
      BLOWER_RUNTIME_PROBE_SCHEMA_VERSION,

    requestType:
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE,

    assetTag:
      normalizeText(
        row.asset_tag
      ),

    dataParcTag:
      normalizeText(
        row.dataparc_tag
      ),

    startAt:
      normalizeText(
        row.window_start
      ),

    endAt:
      normalizeText(
        row.window_end
      ),

    chunkDays:
      Number(
        row.chunk_days
      ) ||
      BLOWER_RUNTIME_PROBE_CHUNK_DAYS,

    chunkCount:
      Number(
        row.chunk_count
      ) ||
      0,

    expectedLastReplacementAt:
      normalizeText(
        row.expected_last_replacement_at
      ),

    expectedCycleStartState:
      normalizeText(
        row.expected_cycle_start_state
      ),

    expectedCycleStartedAt:
      normalizeText(
        row.expected_cycle_started_at
      ),

    expectedCycleStartRevision:
      normalizeText(
        row.expected_cycle_start_revision
      ),

    expectedCycleRuntimeRevision:
      normalizeText(
        row.expected_cycle_runtime_revision
      ),

    readOnly:
      true
  };
}


async function findBlowerRuntimeProbeIntent(
  database,
  requestId
) {
  await ensureBlowerRuntimeProbeSchema(
    database
  );


  const row =
    await database
      .prepare(`
        SELECT *
        FROM blower_runtime_probe_intents_v4
        WHERE request_id = ?
        LIMIT 1
      `)
      .bind(
        requestId
      )
      .first();


  return convertBlowerRuntimeProbeIntentRow(
    row
  );
}


async function attachBlowerRuntimeProbeIntent(
  database,
  requestItem
) {
  if (
    !requestItem ||
    normalizeText(
      requestItem.requestType
    ) !==
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE
  ) {
    return requestItem;
  }


  const probe =
    await findBlowerRuntimeProbeIntent(
      database,
      requestItem.id
    );


  return {
    ...requestItem,
    probe: isValidBlowerRuntimeProbeIntentIdentity(probe, requestItem.id, requestItem.targetDate) ? probe : null
  };
}


/* =========================================================
  요청 한 건 조회
========================================================= */

async function findRequestById(
  database,
  requestId
) {
  const row =
    await database
      .prepare(`
        SELECT
          *

        FROM ois_data_requests

        WHERE id = ?

        LIMIT 1
      `)
      .bind(
        requestId
      )
      .first();


  return await attachBlowerRuntimeProbeIntent(
    database,
    convertRequestRow(
      row
    )
  );
}

/* =========================================================
  기간 계산 DB 행 → API 응답
========================================================= */

function convertLimestoneUsageBatchRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    startDate:
      normalizeText(
        row.start_date
      ),

    endDate:
      normalizeText(
        row.end_date
      ),

    totalDays:
      Number(
        row.total_days
      ) ||
      0,

    status:
      normalizeText(
        row.status
      ),

    requestedById:
      normalizeText(
        row.requested_by_id
      ),

    requestedByName:
      normalizeText(
        row.requested_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    completedAt:
      normalizeText(
        row.completed_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    lastError:
      normalizeText(
        row.last_error
      )
  };
}


/* =========================================================
  기간 계산 작업 한 건 조회
========================================================= */

async function findLimestoneUsageBatchById(
  database,
  batchId
) {
  const row =
    await database
      .prepare(`
        SELECT
          *

        FROM limestone_usage_batches

        WHERE id = ?

        LIMIT 1
      `)
      .bind(
        batchId
      )
      .first();


  return convertLimestoneUsageBatchRow(
    row
  );
}


/* =========================================================
  OIS 요청이 속한 기간 계산 작업 조회
========================================================= */

async function findLimestoneUsageBatchLinkByRequestId(
  database,
  requestId
) {
  const row =
    await database
      .prepare(`
        SELECT
          batch_id,
          usage_date

        FROM limestone_usage_batch_items

        WHERE ois_request_id = ?

        LIMIT 1
      `)
      .bind(
        requestId
      )
      .first();


  if (
    !row
  ) {
    return null;
  }


  return {
    batchId:
      normalizeText(
        row.batch_id
      ),

    usageDate:
      normalizeText(
        row.usage_date
      )
  };
}


/* =========================================================
  기간 계산 진행 상태 갱신·조회
========================================================= */

async function refreshLimestoneUsageBatchStatus(
  database,
  batchId
) {
  const existingBatch =
    await findLimestoneUsageBatchById(
      database,
      batchId
    );


  if (
    !existingBatch
  ) {
    return null;
  }


  const queryResult =
    await database
      .prepare(`
        SELECT
          item.usage_date,
          item.ois_request_id,

          request.status,
          request.error_message,
          request.requested_at,
          request.started_at,
          request.completed_at,
          request.agent_id

        FROM limestone_usage_batch_items
          AS item

        INNER JOIN ois_data_requests
          AS request

          ON request.id =
             item.ois_request_id

        WHERE item.batch_id = ?

        ORDER BY
          item.usage_date ASC
      `)
      .bind(
        batchId
      )
      .all();


  const rows =
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : [];


  const items =
    rows.map(
      row => {
        return {
          usageDate:
            normalizeText(
              row.usage_date
            ),

          requestId:
            normalizeText(
              row.ois_request_id
            ),

          status:
            normalizeText(
              row.status
            ),

          errorMessage:
            normalizeText(
              row.error_message
            ),

          requestedAt:
            normalizeText(
              row.requested_at
            ),

          startedAt:
            normalizeText(
              row.started_at
            ),

          completedAt:
            normalizeText(
              row.completed_at
            ),

          agentId:
            normalizeText(
              row.agent_id
            )
        };
      }
    );


  const counts = {
    pending:
      0,

    processing:
      0,

    complete:
      0,

    failed:
      0
  };


  items.forEach(
    item => {
      if (
        Object.prototype
          .hasOwnProperty
          .call(
            counts,
            item.status
          )
      ) {
        counts[
          item.status
        ] +=
          1;
      }
    }
  );


  const completedCount =
    counts.complete;


  const failedCount =
    counts.failed;


  const processedCount =
    completedCount +
    failedCount;


  const remainingCount =
    counts.pending +
    counts.processing;


  let status =
    "pending";


  if (
    items.length <
      1
  ) {
    status =
      "failed";

  } else if (
    remainingCount >
      0
  ) {
    status =
      counts.processing >
        0 ||
      processedCount >
        0
        ? "processing"
        : "pending";

  } else if (
    completedCount ===
      items.length
  ) {
    status =
      "complete";

  } else if (
    failedCount ===
      items.length
  ) {
    status =
      "failed";

  } else {
    status =
      "partial_failed";
  }


  const isFinished =
    [
      "complete",
      "failed",
      "partial_failed"
    ].includes(
      status
    );


  const now =
    new Date()
      .toISOString();


  const completedAt =
    isFinished
      ? (
          existingBatch.completedAt ||
          now
        )
      : "";


  const failedItems =
    items.filter(
      item => {
        return item.status ===
          "failed";
      }
    );


  const lastError =
    failedItems.length >
      0
      ? normalizeText(
          failedItems[
            failedItems.length -
            1
          ].errorMessage
        )
      : "";


  await database
    .prepare(`
      UPDATE limestone_usage_batches

      SET
        status = ?,
        completed_at = ?,
        updated_at = ?,
        last_error = ?

      WHERE id = ?
    `)
    .bind(
      status,
      completedAt,
      now,
      lastError,
      batchId
    )
    .run();


  const updatedBatch =
    await findLimestoneUsageBatchById(
      database,
      batchId
    );


  const totalDays =
    Math.max(
      Number(
        updatedBatch?.totalDays ||
        items.length ||
        0
      ),
      0
    );


  const progressPercent =
    totalDays >
      0
      ? Math.min(
          100,

          Math.round(
            (
              processedCount /
              totalDays
            ) *
            100
          )
        )
      : 0;


  return {
    batch:
      updatedBatch,

    progress: {
      totalDays,

      processedCount,

      completedCount,

      failedCount,

      pendingCount:
        counts.pending,

      processingCount:
        counts.processing,

      remainingCount,

      percent:
        progressPercent
    },

    items
  };
}

/* =========================================================
  만료된 요청 정리
========================================================= */

async function expireOldRequests(
  database
) {
  const now =
    new Date()
      .toISOString();


  await database
    .prepare(`
      UPDATE ois_data_requests

      SET
        status = 'failed',
        error_message =
          'OIS 연동 프로그램의 응답 시간이 초과되었습니다.',
        completed_at = ?,
        updated_at = ?

      WHERE
        status IN (
          'pending',
          'processing'
        )
        AND expires_at < ?
    `)
    .bind(
      now,
      now,
      now
    )
    .run();
}

/* =========================================================
  저장된 석회석 사용량 조회

  GET:
  /api/ois-data-requests
    ?action=usage_records
    &targetDate=2026-08-06
========================================================= */

async function handleLimestoneUsageRecordsGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const targetDate =
    normalizeText(
      requestUrl.searchParams.get(
        "targetDate"
      ) ||
      requestUrl.searchParams.get(
        "date"
      )
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "불러올 석회석 사용량 날짜를 확인해 주세요."
      },
      400
    );
  }


  const items =
    await findLimestoneUsageRecordsByDate(
      context.env.DB,
      targetDate
    );


  const unitOne =
    items.find(
      item => {
        return Number(
          item.unitNo
        ) ===
          1;
      }
    ) ||
    null;


  const unitTwo =
    items.find(
      item => {
        return Number(
          item.unitNo
        ) ===
          2;
      }
    ) ||
    null;


  const unitOneUsage =
    Number(
      unitOne?.usageQuantity
    );


  const unitTwoUsage =
    Number(
      unitTwo?.usageQuantity
    );


  const hasCompleteResult =
    Boolean(
      unitOne &&
      unitTwo &&
      Number.isFinite(
        unitOneUsage
      ) &&
      Number.isFinite(
        unitTwoUsage
      )
    );


  return jsonResponse({
    ok:
      true,

    targetDate,

    hasSavedResult:
      hasCompleteResult,

    items,

    summary: {
      unitOneUsage:
        Number.isFinite(
          unitOneUsage
        )
          ? unitOneUsage
          : null,

      unitTwoUsage:
        Number.isFinite(
          unitTwoUsage
        )
          ? unitTwoUsage
          : null,

      totalUsage:
        hasCompleteResult
          ? unitOneUsage +
            unitTwoUsage
          : null
    }
  });
}

/* =========================================================
  기간 계산 진행 상태 조회

  GET:
  /api/ois-data-requests
    ?action=usage_batch
    &batchId=배치ID
========================================================= */

async function handleLimestoneUsageBatchGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  await expireOldRequests(
    context.env.DB
  );


  const batchId =
    normalizeText(
      requestUrl.searchParams.get(
        "batchId"
      ) ||
      requestUrl.searchParams.get(
        "id"
      )
    );


  if (
    !batchId
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "조회할 기간 계산 작업 ID가 없습니다."
      },
      400
    );
  }


  const progress =
    await refreshLimestoneUsageBatchStatus(
      context.env.DB,
      batchId
    );


  if (
    !progress
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "기간 계산 작업을 찾을 수 없습니다."
      },
      404
    );
  }


  return jsonResponse({
    ok:
      true,

    ...progress
  });
}

/* =========================================================
  석회석 사용량 숫자 확인
========================================================= */

function normalizeLimestoneUsageHistoryNumber(
  value
) {
  const numericValue =
    Number(
      value
    );


  return Number.isFinite(
    numericValue
  )
    ? numericValue
    : null;
}


/* =========================================================
  저장된 석회석 사용량 기간 조회

  GET:
  /api/ois-data-requests
    ?action=usage_history
    &startDate=2026-08-01
    &endDate=2026-08-31

  반환:
  - 날짜별 1호기 사용량
  - 날짜별 2호기 사용량
  - 날짜별 전체 사용량
  - 기간 합계
  - 미저장 날짜
========================================================= */

async function handleLimestoneUsageHistoryGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const startDate =
    normalizeText(
      requestUrl.searchParams.get(
        "startDate"
      )
    );


  const endDate =
    normalizeText(
      requestUrl.searchParams.get(
        "endDate"
      )
    );


  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "사용량 조회 시작일과 종료일을 확인해 주세요."
      },
      400
    );
  }


  const dayCount =
    getLimestoneUsageBatchDayCount(
      startDate,
      endDate
    );


  if (
    dayCount <
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "사용량 조회 시작일은 종료일보다 늦을 수 없습니다."
      },
      400
    );
  }


  if (
    dayCount >
      366
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "석회석 사용량은 한 번에 최대 366일까지 조회할 수 있습니다."
      },
      400
    );
  }


  const queryResult =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM limestone_usage_records

        WHERE
          usage_date >= ?
          AND usage_date <= ?

        ORDER BY
          usage_date ASC,
          unit_no ASC
      `)
      .bind(
        startDate,
        endDate
      )
      .all();


  const savedRecords =
    (
      Array.isArray(
        queryResult.results
      )
        ? queryResult.results
        : []
    )
      .map(
        convertLimestoneUsageRow
      )
      .filter(
        Boolean
      );


  /*
    날짜별 기록 묶음
  */
  const dailyMap =
    new Map();


  createLimestoneUsageBatchDates(
    startDate,
    endDate
  ).forEach(
    usageDate => {
      dailyMap.set(
        usageDate,
        {
          usageDate,

          unitOne:
            null,

          unitTwo:
            null
        }
      );
    }
  );


  savedRecords.forEach(
    record => {
      const usageDate =
        normalizeText(
          record.usageDate
        );


      const unitNo =
        Number(
          record.unitNo
        );


      if (
        !dailyMap.has(
          usageDate
        )
      ) {
        return;
      }


      const dailyItem =
        dailyMap.get(
          usageDate
        );


      if (
        unitNo ===
          1
      ) {
        dailyItem.unitOne =
          record;

      } else if (
        unitNo ===
          2
      ) {
        dailyItem.unitTwo =
          record;
      }
    }
  );


  let unitOneTotal =
    0;


  let unitTwoTotal =
    0;


  let completeDays =
    0;


  let partialDays =
    0;


  let missingDays =
    0;


  const dailyItems = [
    ...dailyMap.values()
  ]
    .map(
      dailyItem => {
        const unitOneUsage =
          normalizeLimestoneUsageHistoryNumber(
            dailyItem
              .unitOne
              ?.usageQuantity
          );


        const unitTwoUsage =
          normalizeLimestoneUsageHistoryNumber(
            dailyItem
              .unitTwo
              ?.usageQuantity
          );


        const hasUnitOne =
          unitOneUsage !==
            null;


        const hasUnitTwo =
          unitTwoUsage !==
            null;


        let status =
          "missing";


        if (
          hasUnitOne &&
          hasUnitTwo
        ) {
          status =
            "complete";


          completeDays +=
            1;

        } else if (
          hasUnitOne ||
          hasUnitTwo
        ) {
          status =
            "partial";


          partialDays +=
            1;

        } else {
          missingDays +=
            1;
        }


        if (
          hasUnitOne
        ) {
          unitOneTotal +=
            unitOneUsage;
        }


        if (
          hasUnitTwo
        ) {
          unitTwoTotal +=
            unitTwoUsage;
        }


        const availableUsages = [
          unitOneUsage,
          unitTwoUsage
        ].filter(
          value => {
            return value !==
              null;
          }
        );


        const totalUsage =
          availableUsages.length >
            0
            ? availableUsages.reduce(
                (
                  total,
                  value
                ) => {
                  return total +
                    value;
                },
                0
              )
            : null;


        const updatedAtCandidates = [
          normalizeText(
            dailyItem
              .unitOne
              ?.updatedAt
          ),

          normalizeText(
            dailyItem
              .unitTwo
              ?.updatedAt
          )
        ]
          .filter(
            Boolean
          )
          .sort();


        return {
          usageDate:
            dailyItem.usageDate,

          status,

          unitOne:
            dailyItem.unitOne,

          unitTwo:
            dailyItem.unitTwo,

          unitOneUsage,

          unitTwoUsage,

          totalUsage,

          updatedAt:
            updatedAtCandidates[
              updatedAtCandidates.length -
              1
            ] ||
            ""
        };
      }
    )
    /*
      화면에서는 최신 날짜가 위로 오도록 정렬한다.
    */
    .sort(
      (
        firstItem,
        secondItem
      ) => {
        return secondItem
          .usageDate
          .localeCompare(
            firstItem.usageDate
          );
      }
    );


  return jsonResponse({
    ok:
      true,

    range: {
      startDate,
      endDate,
      dayCount
    },

    summary: {
      unitOneTotal,

      unitTwoTotal,

      totalUsage:
        unitOneTotal +
        unitTwoTotal,

      completeDays,

      partialDays,

      missingDays,

      savedDays:
        completeDays +
        partialDays
    },

    items:
      dailyItems
  });
}

/* =========================================================
  부재료 자료 적용 기준

  - 2026-08-09까지: 기존 엑셀 업로드 자료
  - 2026-08-10부터: OIS 자동수집 자료
========================================================= */

const AUXILIARY_MATERIAL_EXCEL_END_DATE =
  "2026-08-09";


const AUXILIARY_MATERIAL_OIS_START_DATE =
  "2026-08-10";


const MAXIMUM_AUXILIARY_MATERIAL_IMPORT_DAYS =
  40;


/* =========================================================
  기존 D1 테이블에 새 열을 안전하게 추가
========================================================= */

async function ensureAuxiliaryMaterialDailyColumn(
  database,
  columnName,
  columnDefinition
) {
  const tableInfo =
    await database
      .prepare(`
        PRAGMA table_info(
          auxiliary_material_daily
        )
      `)
      .all();


  const hasColumn =
    (
      Array.isArray(
        tableInfo.results
      )
        ? tableInfo.results
        : []
    ).some(
      column =>
        normalizeText(
          column.name
        ) ===
        columnName
    );


  if (
    hasColumn
  ) {
    return;
  }


  try {
    await database
      .prepare(`
        ALTER TABLE
          auxiliary_material_daily
        ADD COLUMN
          ${columnDefinition}
      `)
      .run();

  } catch (
    error
  ) {
    const message =
      normalizeText(
        error instanceof Error
          ? error.message
          : error
      );


    /*
      동시에 최초 접근한 요청이 먼저 열을 추가한 경우는
      정상 완료로 처리한다.
    */
    if (
      !/duplicate column name/i.test(
        message
      )
    ) {
      throw error;
    }
  }
}


/* =========================================================
  부재료 일별 자료 D1 테이블

  한 행:
  - 날짜 1일
  - 호기 1개

  저장 항목:
  - Limestone 입고·재고·사용량
  - Lime Slurry 합산 유량·밀도·Lime Powder
  - Ammonia
  - SOx / NOx
  - 비고
  - 자료 출처
========================================================= */

async function ensureAuxiliaryMaterialDailyTable(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS auxiliary_material_daily (
        id TEXT PRIMARY KEY,
        record_date TEXT NOT NULL,
        unit_no INTEGER NOT NULL,

        limestone_start_stock REAL,
        limestone_receipt_ton REAL,
        limestone_end_stock REAL,
        limestone_usage_tpd REAL,

        lime_slurry_flow_m3h REAL,
        lime_slurry_density_kgm3 REAL,
        lime_powder_tpd REAL,

        ammonia_flow_m3h REAL,
        ammonia_m3d REAL,

        sox_ppm REAL,
        nox_ppm REAL,

        remarks TEXT NOT NULL DEFAULT '',
        data_source TEXT NOT NULL DEFAULT 'ois',

        sample_count INTEGER NOT NULL DEFAULT 0,
        is_complete INTEGER NOT NULL DEFAULT 0,

        source_tags_json TEXT NOT NULL DEFAULT '{}',
        raw_result_json TEXT NOT NULL DEFAULT '{}',

        ois_request_id TEXT NOT NULL DEFAULT '',
        ois_collected_at TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL DEFAULT '',

        created_by_id TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        updated_by_id TEXT NOT NULL DEFAULT '',
        updated_by_name TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,

        UNIQUE(record_date, unit_no)
      )
    `)
    .run();


  /*
    이미 만들어진 운영 D1 테이블에도
    비고와 자료 출처 열을 추가한다.
  */
  await ensureAuxiliaryMaterialDailyColumn(
    database,
    "remarks",
    "remarks TEXT NOT NULL DEFAULT ''"
  );


  await ensureAuxiliaryMaterialDailyColumn(
    database,
    "data_source",
    "data_source TEXT NOT NULL DEFAULT 'ois'"
  );


  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_auxiliary_material_daily_date

      ON auxiliary_material_daily (
        record_date,
        unit_no
      )
    `)
    .run();


  await ensureAuxiliaryMaterialDensitySettingsTable(
    database
  );
}


/* =========================================================
  Slurry 밀도 고정값 D1 테이블

  - 1호기·2호기별 한 행
  - 적용 시작일 이후 OIS 저장자료에 고정값 우선 적용
========================================================= */

async function ensureAuxiliaryMaterialDensitySettingsTable(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS auxiliary_material_density_settings (
        unit_no INTEGER PRIMARY KEY,
        density_kgm3 REAL NOT NULL,
        effective_from TEXT NOT NULL,

        created_by_id TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        updated_by_id TEXT NOT NULL DEFAULT '',
        updated_by_name TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,

        CHECK (unit_no IN (1, 2))
      )
    `)
    .run();
}


function convertAuxiliaryMaterialDensitySetting(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  const unitNo =
    Number(
      row.unit_no
    );


  const densityKgm3 =
    normalizeAuxiliaryMaterialNumber(
      row.density_kgm3
    );


  const effectiveFrom =
    normalizeText(
      row.effective_from
    );


  if (
    !(
      unitNo ===
        1 ||
      unitNo ===
        2
    ) ||
    densityKgm3 ===
      null ||
    !isValidIsoDate(
      effectiveFrom
    )
  ) {
    return null;
  }


  return {
    unitNo,
    densityKgm3,
    effectiveFrom,

    updatedByName:
      normalizeText(
        row.updated_by_name
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    revision:
      Number(
        row.revision
      ) ||
      1
  };
}


async function loadAuxiliaryMaterialDensitySettings(
  database
) {
  await ensureAuxiliaryMaterialDensitySettingsTable(
    database
  );


  const result =
    await database
      .prepare(`
        SELECT *
        FROM auxiliary_material_density_settings
        ORDER BY unit_no ASC
      `)
      .all();


  return (
    Array.isArray(
      result.results
    )
      ? result.results
      : []
  )
    .map(
      convertAuxiliaryMaterialDensitySetting
    )
    .filter(
      Boolean
    );
}

function normalizeAuxiliaryMaterialNumber(
  value,
  decimalPlaces = 6
) {
  if (
    value ===
      null ||
    value ===
      undefined ||
    String(
      value
    ).trim() ===
      ""
  ) {
    return null;
  }


  const numericValue =
    Number(
      value
    );


  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return null;
  }


  const multiplier =
    10 **
    decimalPlaces;


  return Math.round(
    numericValue *
    multiplier
  ) /
  multiplier;
}


function calculateLimePowderTonPerDay(
  totalSlurryFlow,
  density
) {
  const flowValue =
    normalizeAuxiliaryMaterialNumber(
      totalSlurryFlow
    );


  const densityValue =
    normalizeAuxiliaryMaterialNumber(
      density
    );


  if (
    flowValue ===
      null ||
    densityValue ===
      null ||
    flowValue <=
      0 ||
    densityValue <=
      1000
  ) {
    return null;
  }


  /*
    기존 부재료 엑셀과 같은 계산식

    (A+B+C) × 밀도
    × (밀도-1000)/(1102-1000)
    × 15% × 24시간 ÷ 1000
  */
  return normalizeAuxiliaryMaterialNumber(
    flowValue *
    densityValue *
    (
      densityValue -
      1000
    ) /
    (
      1102 -
      1000
    ) *
    0.15 *
    24 /
    1000
  );
}


function convertAuxiliaryMaterialRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  let sourceTags = {};


  try {
    sourceTags =
      JSON.parse(
        normalizeText(
          row.source_tags_json
        ) ||
        "{}"
      );

  } catch {
    sourceTags = {};
  }


  return {
    id:
      normalizeText(
        row.id
      ),

    recordDate:
      normalizeText(
        row.record_date
      ),

    unitNo:
      Number(
        row.unit_no
      ),

    limestoneStartStock:
      normalizeAuxiliaryMaterialNumber(
        row.limestone_start_stock
      ),

    limestoneReceiptTon:
      normalizeAuxiliaryMaterialNumber(
        row.limestone_receipt_ton
      ),

    limestoneEndStock:
      normalizeAuxiliaryMaterialNumber(
        row.limestone_end_stock
      ),

    limestoneUsageTpd:
      normalizeAuxiliaryMaterialNumber(
        row.limestone_usage_tpd
      ),

    limeSlurryFlowM3h:
      normalizeAuxiliaryMaterialNumber(
        row.lime_slurry_flow_m3h
      ),

    limeSlurryDensityKgm3:
      normalizeAuxiliaryMaterialNumber(
        row.lime_slurry_density_kgm3
      ),

    limePowderTpd:
      normalizeAuxiliaryMaterialNumber(
        row.lime_powder_tpd
      ),

    ammoniaFlowM3h:
      normalizeAuxiliaryMaterialNumber(
        row.ammonia_flow_m3h
      ),

    ammoniaM3d:
      normalizeAuxiliaryMaterialNumber(
        row.ammonia_m3d
      ),

    soxPpm:
      normalizeAuxiliaryMaterialNumber(
        row.sox_ppm
      ),

    noxPpm:
      normalizeAuxiliaryMaterialNumber(
        row.nox_ppm
      ),

    remarks:
      normalizeText(
        row.remarks
      ),

    sampleCount:
      Number(
        row.sample_count
      ) ||
      0,

    isComplete:
      Number(
        row.is_complete
      ) ===
      1,

    sourceTags,

    oisRequestId:
      normalizeText(
        row.ois_request_id
      ),

    oisCollectedAt:
      normalizeText(
        row.ois_collected_at
      ),

    agentId:
      normalizeText(
        row.agent_id
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    revision:
      Number(
        row.revision
      ) ||
      1
  };
}


async function saveAuxiliaryMaterialDailyRecords(
  database,
  options
) {
  await ensureAuxiliaryMaterialDailyTable(
    database
  );


  const requestItem =
    options?.requestItem ||
    {};


  const rawResult =
    options?.rawResult &&
    typeof options.rawResult ===
      "object" &&
    !Array.isArray(
      options.rawResult
    )
      ? options.rawResult
      : {};


  const recordDate =
    normalizeText(
      rawResult.targetDate ||
      requestItem.targetDate
    );


  if (
    !isValidIsoDate(
      recordDate
    )
  ) {
    throw new Error(
      "부재료 저장 날짜가 올바르지 않습니다."
    );
  }


  /*
    해당 날짜에 적용되는
    1·2호기 Slurry 고정 밀도
  */
  const fixedDensitySettings =
    await loadAuxiliaryMaterialDensitySettings(
      database
    );


  const fixedDensityByUnit =
    new Map(
      fixedDensitySettings
        .filter(
          setting =>
            recordDate >=
            setting.effectiveFrom
        )
        .map(
          setting => [
            setting.unitNo,
            setting.densityKgm3
          ]
        )
    );


  const receiptByUnit =
    await loadLimestoneReceiptQuantitiesByUnit(
      database,
      recordDate
    );


  const requestedById =
    normalizeEmployeeNo(
      requestItem.requestedById
    );


  const requestedByName =
    normalizeText(
      requestItem.requestedByName
    );


  const agentId =
    normalizeText(
      options?.agentId ||
      requestItem.agentId
    );


  const collectedAt =
    normalizeText(
      rawResult.collectedAt
    );


  const now =
    new Date()
      .toISOString();


  const unitDefinitions = [
    {
      unitNo:
        1,

      result:
        rawResult.unitOne ||
        rawResult.unit1 ||
        {}
    },

    {
      unitNo:
        2,

      result:
        rawResult.unitTwo ||
        rawResult.unit2 ||
        {}
    }
  ];


  const savedItems = [];


  for (
    const unitDefinition of
    unitDefinitions
  ) {
    const unitNo =
      unitDefinition.unitNo;


    const result =
      unitDefinition.result;


    const startStock =
      normalizeAuxiliaryMaterialNumber(
        result.startStock
      );


    const endStock =
      normalizeAuxiliaryMaterialNumber(
        result.endStock
      );


    const receiptQuantity =
      normalizeAuxiliaryMaterialNumber(
        receiptByUnit[
          unitNo
        ] ||
        0
      );


    const limestoneUsage =
      startStock !==
        null &&
      endStock !==
        null &&
      receiptQuantity !==
        null
        ? normalizeLimestoneUsageNumber(
            startStock +
            receiptQuantity -
            endStock
          )
        : null;


    const totalSlurryFlow =
      normalizeAuxiliaryMaterialNumber(
        result.limeSlurryFlowM3h
      );


    /*
      OIS에서 조회한 원래 밀도
    */
    const oisDensity =
      normalizeAuxiliaryMaterialNumber(
        result.limeSlurryDensityKgm3
      );


    /*
      적용 시작일 이후에는
      저장된 호기별 고정 밀도를 우선 사용한다.

      적용되는 고정값이 없으면
      OIS 조회 밀도를 그대로 사용한다.
    */
    const fixedDensity =
      normalizeAuxiliaryMaterialNumber(
        fixedDensityByUnit.has(
          unitNo
        )
          ? fixedDensityByUnit.get(
              unitNo
            )
          : null
      );


    const density =
      fixedDensity !==
        null
        ? fixedDensity
        : oisDensity;


    /*
      최종 적용된 밀도로
      Lime Powder를 다시 계산한다.
    */
    const limePowder =
      calculateLimePowderTonPerDay(
        totalSlurryFlow,
        density
      );


    const ammoniaFlow =
      normalizeAuxiliaryMaterialNumber(
        result.ammoniaFlowM3h
      );


    const ammoniaM3d =
      ammoniaFlow !==
        null
        ? normalizeAuxiliaryMaterialNumber(
            ammoniaFlow *
            24
          )
        : null;


    const soxPpm =
      normalizeAuxiliaryMaterialNumber(
        result.soxPpm
      );


    const noxPpm =
      normalizeAuxiliaryMaterialNumber(
        result.noxPpm
      );


    const sampleCount =
      Math.max(
        0,
        Math.min(
          24,
          Number(
            result.sampleCount
          ) ||
          0
        )
      );


    const isComplete =
      sampleCount >=
        24 &&
      limestoneUsage !==
        null &&
      limePowder !==
        null &&
      ammoniaM3d !==
        null &&
      soxPpm !==
        null &&
      noxPpm !==
        null;


    await database
      .prepare(`
        INSERT INTO auxiliary_material_daily (
          id,
          record_date,
          unit_no,

          limestone_start_stock,
          limestone_receipt_ton,
          limestone_end_stock,
          limestone_usage_tpd,

          lime_slurry_flow_m3h,
          lime_slurry_density_kgm3,
          lime_powder_tpd,

          ammonia_flow_m3h,
          ammonia_m3d,

          sox_ppm,
          nox_ppm,

          sample_count,
          is_complete,

          source_tags_json,
          raw_result_json,

          ois_request_id,
          ois_collected_at,
          agent_id,

          created_by_id,
          created_by_name,
          updated_by_id,
          updated_by_name,

          created_at,
          updated_at,
          revision
        )
        VALUES (
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, 1
        )

        ON CONFLICT (
          record_date,
          unit_no
        )
        DO UPDATE SET
          limestone_start_stock = excluded.limestone_start_stock,
          limestone_receipt_ton = excluded.limestone_receipt_ton,
          limestone_end_stock = excluded.limestone_end_stock,
          limestone_usage_tpd = excluded.limestone_usage_tpd,
          lime_slurry_flow_m3h = excluded.lime_slurry_flow_m3h,
          lime_slurry_density_kgm3 = excluded.lime_slurry_density_kgm3,
          lime_powder_tpd = excluded.lime_powder_tpd,
          ammonia_flow_m3h = excluded.ammonia_flow_m3h,
          ammonia_m3d = excluded.ammonia_m3d,
          sox_ppm = excluded.sox_ppm,
          nox_ppm = excluded.nox_ppm,
          sample_count = excluded.sample_count,
          is_complete = excluded.is_complete,
          source_tags_json = excluded.source_tags_json,
          raw_result_json = excluded.raw_result_json,
          ois_request_id = excluded.ois_request_id,
          ois_collected_at = excluded.ois_collected_at,
          agent_id = excluded.agent_id,
          updated_by_id = excluded.updated_by_id,
          updated_by_name = excluded.updated_by_name,
          updated_at = excluded.updated_at,
          revision = auxiliary_material_daily.revision + 1
      `)
      .bind(
        crypto.randomUUID(),
        recordDate,
        unitNo,

        startStock,
        receiptQuantity,
        endStock,
        limestoneUsage,

        totalSlurryFlow,
        density,
        limePowder,

        ammoniaFlow,
        ammoniaM3d,

        soxPpm,
        noxPpm,

        sampleCount,
        isComplete
          ? 1
          : 0,

        JSON.stringify(
          result.tags ||
          {}
        ),
        JSON.stringify(
          result
        ),

        normalizeText(
          requestItem.id
        ),
        collectedAt,
        agentId,

        requestedById,
        requestedByName,
        requestedById,
        requestedByName,

        now,
        now
      )
      .run();


    const savedRow =
      await database
        .prepare(`
          SELECT *
          FROM auxiliary_material_daily
          WHERE record_date = ?
            AND unit_no = ?
          LIMIT 1
        `)
        .bind(
          recordDate,
          unitNo
        )
        .first();


    savedItems.push(
      convertAuxiliaryMaterialRow(
        savedRow
      )
    );
  }


  return savedItems.filter(
    Boolean
  );
}

async function handleAuxiliaryMaterialHistoryGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const startDate =
    normalizeText(
      requestUrl.searchParams.get(
        "startDate"
      )
    );


  const endDate =
    normalizeText(
      requestUrl.searchParams.get(
        "endDate"
      )
    );


  const dayCount =
    getLimestoneUsageBatchDayCount(
      startDate,
      endDate
    );


  if (
    dayCount <
      1 ||
    dayCount >
      366
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "부재료 조회 기간은 1일 이상 366일 이하로 선택해 주세요."
      },
      400
    );
  }


  await ensureAuxiliaryMaterialDailyTable(
    context.env.DB
  );


  const [
    queryResult,
    fixedDensitySettings
  ] =
    await Promise.all([
      context.env.DB
        .prepare(`
          SELECT *
          FROM auxiliary_material_daily
          WHERE record_date >= ?
            AND record_date <= ?
          ORDER BY record_date DESC,
                   unit_no ASC
        `)
        .bind(
          startDate,
          endDate
        )
        .all(),

      loadAuxiliaryMaterialDensitySettings(
        context.env.DB
      )
    ]);


  const records =
    (
      Array.isArray(
        queryResult.results
      )
        ? queryResult.results
        : []
    )
      .map(
        convertAuxiliaryMaterialRow
      )
      .filter(
        Boolean
      );


  const savedDateCount =
    new Set(
      records.map(
        item => item.recordDate
      )
    ).size;


  return jsonResponse({
    ok:
      true,

    range: {
      startDate,
      endDate,
      dayCount
    },

    summary: {
      savedDateCount,

      missingDateCount:
        Math.max(
          0,
          dayCount -
          savedDateCount
        ),

      completeRecordCount:
        records.filter(
          item => item.isComplete
        ).length,

      recordCount:
        records.length
    },

    items:
      records,

    fixedDensitySettings
  });
}

/* =========================================================
  부재료 수동 수정값 확인
========================================================= */

function normalizeAuxiliaryMaterialManualValue(
  value,
  label,
  options = {}
) {
  const normalizedText =
    normalizeText(
      value
    );


  if (
    value ===
      null ||
    value ===
      undefined ||
    normalizedText ===
      "" ||
    normalizedText ===
      "-" ||
    normalizedText ===
      "—"
  ) {
    return null;
  }


  const numericValue =
    Number(
      String(
        value
      ).replace(
        /,/g,
        ""
      )
    );


  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    throw new Error(
      `${label} 값을 숫자로 입력해 주세요.`
    );
  }


  const minimum =
    Number.isFinite(
      Number(
        options.minimum
      )
    )
      ? Number(
          options.minimum
        )
      : 0;


  const maximum =
    Number.isFinite(
      Number(
        options.maximum
      )
    )
      ? Number(
          options.maximum
        )
      : 1000000;


  const isMinimumExclusive =
    options.minimumExclusive ===
      true;


  if (
    (
      isMinimumExclusive
        ? numericValue <=
          minimum
        : numericValue <
          minimum
    ) ||
    numericValue >
      maximum
  ) {
    const minimumText =
      isMinimumExclusive
        ? `${minimum} 초과`
        : `${minimum} 이상`;


    throw new Error(
      `${label} 값은 ${minimumText} ${maximum} 이하로 입력해 주세요.`
    );
  }


  return normalizeAuxiliaryMaterialNumber(
    numericValue
  );
}

/*
  [AUXILIARY-MATERIAL-EDIT-VALIDATION-V1]

  최신 화면은 변경한 숫자 필드만 보낸다.
  변경하지 않은 값은 브라우저 값을 신뢰하지 않고
  현재 D1 행에서 다시 읽어 그대로 보존한다.
*/
const AUXILIARY_MATERIAL_MANUAL_FIELD_DEFINITIONS = [
  {
    key:
      "soxPpm",

    databaseColumn:
      "sox_ppm",

    label:
      "SOx"
  },

  {
    key:
      "limestoneUsageTpd",

    databaseColumn:
      "limestone_usage_tpd",

    label:
      "Limestone 사용량"
  },

  {
    key:
      "limestoneReceiptTon",

    databaseColumn:
      "limestone_receipt_ton",

    label:
      "Limestone 입고량"
  },

  {
    key:
      "limeSlurryFlowM3h",

    databaseColumn:
      "lime_slurry_flow_m3h",

    label:
      "Lime Slurry 유량"
  },

  {
    key:
      "limeSlurryDensityKgm3",

    databaseColumn:
      "lime_slurry_density_kgm3",

    label:
      "Slurry 밀도",

    options: {
      minimum:
        1000,

      minimumExclusive:
        true,

      maximum:
        2000
    }
  },

  {
    key:
      "limePowderTpd",

    databaseColumn:
      "lime_powder_tpd",

    label:
      "Lime Powder"
  },

  {
    key:
      "noxPpm",

    databaseColumn:
      "nox_ppm",

    label:
      "NOx"
  },

  {
    key:
      "ammoniaM3d",

    databaseColumn:
      "ammonia_m3d",

    label:
      "Ammonia 일사용량"
  }
];


const AUXILIARY_MATERIAL_MANUAL_FIELD_KEYS =
  new Set(
    AUXILIARY_MATERIAL_MANUAL_FIELD_DEFINITIONS.map(
      definition =>
        definition.key
    )
  );


function normalizeAuxiliaryMaterialManualTarget(
  rawItem,
  itemIndex
) {
  const recordDate =
    normalizeText(
      rawItem?.recordDate
    );

  const unitNo =
    Number(
      rawItem?.unitNo
    );

  if (
    !isValidIsoDate(
      recordDate
    ) ||
    !(
      unitNo === 1 ||
      unitNo === 2
    )
  ) {
    throw new Error(
      `${itemIndex + 1}번째 부재료 수정자료의 날짜·호기를 확인해 주세요.`
    );
  }

  const prefix =
    `${recordDate} ${unitNo}호기`;


  const values =
    rawItem?.values &&
    typeof rawItem.values ===
      "object" &&
    !Array.isArray(
      rawItem.values
    )
      ? rawItem.values
      : {};


  const hasChangedFields =
    Object.prototype.hasOwnProperty.call(
      rawItem || {},
      "changedFields"
    );


  const hasRemarksChanged =
    Object.prototype.hasOwnProperty.call(
      rawItem || {},
      "remarksChanged"
    );


  const isSparsePatch =
    hasChangedFields ||
    hasRemarksChanged;


  let changedFields =
    AUXILIARY_MATERIAL_MANUAL_FIELD_DEFINITIONS.map(
      definition =>
        definition.key
    );


  let remarksChanged =
    Object.prototype.hasOwnProperty.call(
      rawItem || {},
      "remarks"
    );


  if (
    isSparsePatch
  ) {
    if (
      !hasChangedFields ||
      !hasRemarksChanged ||
      !Array.isArray(
        rawItem.changedFields
      ) ||
      typeof rawItem.remarksChanged !==
        "boolean"
    ) {
      throw new Error(
        `${prefix} 변경 필드 형식을 확인해 주세요.`
      );
    }


    changedFields =
      rawItem.changedFields.map(
        fieldKey =>
          typeof fieldKey ===
            "string"
            ? fieldKey
            : ""
      );


    remarksChanged =
      rawItem.remarksChanged;


    if (
      remarksChanged &&
      !Object.prototype.hasOwnProperty.call(
        rawItem || {},
        "remarks"
      )
    ) {
      throw new Error(
        `${prefix} 변경한 비고 내용을 확인해 주세요.`
      );
    }


    if (
      changedFields.length >
        AUXILIARY_MATERIAL_MANUAL_FIELD_DEFINITIONS.length ||
      new Set(
        changedFields
      ).size !==
        changedFields.length ||
      changedFields.some(
        fieldKey =>
          !AUXILIARY_MATERIAL_MANUAL_FIELD_KEYS.has(
            fieldKey
          )
      )
    ) {
      throw new Error(
        `${prefix} 변경 필드 목록을 확인해 주세요.`
      );
    }


    const submittedValueKeys =
      Object.keys(
        values
      );


    if (
      submittedValueKeys.length !==
        changedFields.length ||
      submittedValueKeys.some(
        fieldKey =>
          !changedFields.includes(
            fieldKey
          )
      ) ||
      changedFields.some(
        fieldKey =>
          !Object.prototype.hasOwnProperty.call(
            values,
            fieldKey
          )
      )
    ) {
      throw new Error(
        `${prefix} 변경값과 필드 목록이 일치하지 않습니다.`
      );
    }


    if (
      changedFields.length <
        1 &&
      !remarksChanged
    ) {
      throw new Error(
        `${prefix} 변경된 부재료 수치가 없습니다.`
      );
    }


    if (
      !Number.isInteger(
        rawItem?.revision
      ) ||
      rawItem.revision < 1
    ) {
      throw new Error(
        `${prefix} 자료 버전을 확인해 주세요. 다시 조회한 뒤 수정해 주세요.`
      );
    }
  }


  return {
    rawItem,
    recordDate,
    unitNo,
    prefix,
    values,
    isSparsePatch,
    changedFields,
    remarksChanged,

    expectedRevision:
      Math.max(
        0,
        Number(
          rawItem?.revision
        ) ||
        0
      )
  };
}


function normalizeAuxiliaryMaterialManualRecord(
  rawItem,
  itemIndex,
  existingRow =
    null
) {
  const target =
    normalizeAuxiliaryMaterialManualTarget(
      rawItem,
      itemIndex
    );


  const changedFieldSet =
    new Set(
      target.changedFields
    );


  if (
    target.isSparsePatch &&
    !existingRow
  ) {
    throw new Error(
      `${target.prefix} 기존 저장자료를 확인할 수 없습니다.`
    );
  }


  const normalizedValues = {};


  AUXILIARY_MATERIAL_MANUAL_FIELD_DEFINITIONS.forEach(
    definition => {
      if (
        target.isSparsePatch &&
        !changedFieldSet.has(
          definition.key
        )
      ) {
        normalizedValues[
          definition.key
        ] =
          normalizeAuxiliaryMaterialNumber(
            existingRow?.[
              definition.databaseColumn
            ]
          );

        return;
      }


      normalizedValues[
        definition.key
      ] =
        normalizeAuxiliaryMaterialManualValue(
          target.values[
            definition.key
          ],
          `${target.prefix} ${definition.label}`,
          definition.options ||
            {}
        );
    }
  );


  const remarks =
    target.remarksChanged
      ? normalizeText(
          rawItem?.remarks
        )
      : normalizeText(
          existingRow?.remarks
        );

  if (
    remarks.length > 1000 &&
    target.remarksChanged
  ) {
    throw new Error(
      `${target.prefix} 비고는 1,000자 이하로 입력해 주세요.`
    );
  }


  return {
    recordDate:
      target.recordDate,

    unitNo:
      target.unitNo,

    expectedRevision:
      target.expectedRevision,

    remarks,

    values:
      normalizedValues,

    changedFields:
      target.changedFields,

    remarksChanged:
      target.remarksChanged,

    isSparsePatch:
      target.isSparsePatch
  };
}


function prepareAuxiliaryMaterialManualRevisionGuard(
  database,
  items,
  now
) {
  const expectedRows =
    items.map(
      item => ({
        recordDate:
          item.recordDate,

        unitNo:
          item.unitNo,

        expectedRevision:
          item.expectedRevision
      })
    );


  /*
    D1 batch()는 트랜잭션이다. SELECT 이후 저장 직전까지 다른 요청이
    행을 바꿨으면 첫 문장이 의도적으로 NOT NULL 제약을 위반한다.
    그러면 뒤의 모든 형제 UPDATE도 함께 롤백된다.
  */
  return database
    .prepare(`
      /* AUXILIARY_MATERIAL_MANUAL_REVISION_GUARD_V1 */
      WITH expected_rows AS (
        SELECT
          json_extract(value, '$.recordDate') AS record_date,
          CAST(json_extract(value, '$.unitNo') AS INTEGER) AS unit_no,
          CAST(json_extract(value, '$.expectedRevision') AS INTEGER) AS expected_revision

        FROM json_each(?)
      ),

      revision_conflict AS (
        SELECT 1

        FROM expected_rows AS expected

        WHERE NOT EXISTS (
          SELECT 1

          FROM auxiliary_material_daily AS current_row

          WHERE
            current_row.record_date = expected.record_date
            AND current_row.unit_no = expected.unit_no
            AND (
              expected.expected_revision < 1
              OR current_row.revision = expected.expected_revision
            )
        )

        LIMIT 1
      )

      INSERT INTO auxiliary_material_daily (
        id,
        record_date,
        unit_no,
        created_at,
        updated_at
      )
      SELECT
        'manual-revision-guard-' || lower(hex(randomblob(16))),
        NULL,
        0,
        ?,
        ?

      FROM revision_conflict
    `)
    .bind(
      JSON.stringify(
        expectedRows
      ),
      now,
      now
    );
}

/* =========================================================
  날짜·호기별 부재료 수치 수동 수정
========================================================= */

async function updateAuxiliaryMaterialManualRecords(context, body) {
  const authentication = await getAuthenticatedUser(context);

  if (authentication.error) {
    return authentication.error;
  }

  const rawItems = Array.isArray(body.items)
    ? body.items
    : [];

  if (rawItems.length < 1 || rawItems.length > 732) {
    return jsonResponse(
      {
        ok: false,
        message:
          "부재료 수정자료는 한 번에 1건 이상 732건 이하로 저장해 주세요."
      },
      400
    );
  }

  let targets;

  try {
    targets = rawItems.map((rawItem, itemIndex) => {
      return {
        ...normalizeAuxiliaryMaterialManualTarget(
          rawItem,
          itemIndex
        ),

        itemIndex
      };
    });

  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "부재료 수정값을 확인해 주세요."
      },
      400
    );
  }

  const targetKeys = new Set();

  for (const target of targets) {
    const key = `${target.recordDate}:${target.unitNo}`;

    if (targetKeys.has(key)) {
      return jsonResponse(
        {
          ok: false,
          message:
            `${target.recordDate} ${target.unitNo}호기 수정자료가 중복되었습니다.`
        },
        400
      );
    }

    targetKeys.add(key);
  }

  const database = context.env.DB;

  await ensureAuxiliaryMaterialDailyTable(database);

  const dates = targets
    .map(target => target.recordDate)
    .sort();

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const existingResult = await database
    .prepare(`
      SELECT *

      FROM auxiliary_material_daily

      WHERE
        record_date >= ?
        AND record_date <= ?
    `)
    .bind(
      firstDate,
      lastDate
    )
    .all();

  const existingRows = Array.isArray(
    existingResult.results
  )
    ? existingResult.results
    : [];

  const existingByKey = new Map(
    existingRows.map(row => [
      `${normalizeText(row.record_date)}:${Number(row.unit_no)}`,
      row
    ])
  );

  for (const target of targets) {
    const key = `${target.recordDate}:${target.unitNo}`;
    const existing = existingByKey.get(key);

    if (!existing) {
      return jsonResponse(
        {
          ok: false,
          message:
            `${target.recordDate} ${target.unitNo}호기 저장자료가 없어 수정할 수 없습니다.`
        },
        404
      );
    }

    if (
      target.expectedRevision > 0 &&
      Number(existing.revision) !== target.expectedRevision
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            `${target.recordDate} ${target.unitNo}호기 자료가 다른 사용자에 의해 변경되었습니다. 다시 조회한 뒤 수정해 주세요.`
        },
        409
      );
    }
  }


  let items;


  try {
    items = targets.map(target => {
      const key =
        `${target.recordDate}:${target.unitNo}`;


      return normalizeAuxiliaryMaterialManualRecord(
        target.rawItem,
        target.itemIndex,
        existingByKey.get(
          key
        )
      );
    });

  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "부재료 수정값을 확인해 주세요."
      },
      400
    );
  }

  function normalizeComparableNumber(value) {
    if (
      value === null ||
      value === undefined ||
      String(value).trim() === ""
    ) {
      return null;
    }

    const numericValue = Number(value);

    return Number.isFinite(numericValue)
      ? numericValue
      : null;
  }

  function areComparableNumbersEqual(first, second) {
    const firstNumber =
      normalizeComparableNumber(first);

    const secondNumber =
      normalizeComparableNumber(second);

    if (
      firstNumber === null ||
      secondNumber === null
    ) {
      return firstNumber === secondNumber;
    }

    return Math.abs(firstNumber - secondNumber) <
      0.0000001;
  }

  const user = authentication.user;
  const now = new Date().toISOString();

  const statements = [
    prepareAuxiliaryMaterialManualRevisionGuard(
      database,
      items,
      now
    )
  ];
  const limestoneSyncTargetKeys = new Set();

  for (const item of items) {
    const values = item.values;
    const key = `${item.recordDate}:${item.unitNo}`;
    const existing = existingByKey.get(key);

    const ammoniaFlowM3h =
      values.ammoniaM3d === null
        ? null
        : normalizeAuxiliaryMaterialNumber(
            values.ammoniaM3d / 24
          );

    const isComplete =
      values.limestoneUsageTpd !== null &&
      values.limePowderTpd !== null &&
      values.ammoniaM3d !== null &&
      values.soxPpm !== null &&
      values.noxPpm !== null;

    statements.push(
      database
        .prepare(`
          UPDATE auxiliary_material_daily

          SET
            limestone_receipt_ton = ?,
            limestone_usage_tpd = ?,

            lime_slurry_flow_m3h = ?,
            lime_slurry_density_kgm3 = ?,
            lime_powder_tpd = ?,

            ammonia_flow_m3h = ?,
            ammonia_m3d = ?,

            sox_ppm = ?,
            nox_ppm = ?,

            remarks = ?,
            is_complete = ?,

            updated_by_id = ?,
            updated_by_name = ?,
            updated_at = ?,

            revision = revision + 1

          WHERE
            record_date = ?
            AND unit_no = ?
            AND (
              ? < 1
              OR revision = ?
            )
        `)
        .bind(
          values.limestoneReceiptTon,
          values.limestoneUsageTpd,

          values.limeSlurryFlowM3h,
          values.limeSlurryDensityKgm3,
          values.limePowderTpd,

          ammoniaFlowM3h,
          values.ammoniaM3d,

          values.soxPpm,
          values.noxPpm,

          item.remarks,
          isComplete ? 1 : 0,

          user.employeeNo,
          user.name,
          now,

          item.recordDate,
          item.unitNo,

          item.expectedRevision,
          item.expectedRevision
        )
    );

    /*
      비고만 수정했을 때 Limestone 원본까지
      불필요하게 수정되지 않도록 실제 변경 여부 확인
    */
    const limestoneValuesChanged =
      !areComparableNumbersEqual(
        values.limestoneReceiptTon,
        existing?.limestone_receipt_ton
      ) ||
      !areComparableNumbersEqual(
        values.limestoneUsageTpd,
        existing?.limestone_usage_tpd
      );

    if (
      item.recordDate >=
        AUXILIARY_MATERIAL_OIS_START_DATE &&
      limestoneValuesChanged
    ) {
      limestoneSyncTargetKeys.add(key);

      statements.push(
        database
          .prepare(`
            UPDATE limestone_usage_records

            SET
              receipt_quantity = ?,
              usage_quantity = ?,

              calculation_mode = 'manual',

              updated_by_id = ?,
              updated_by_name = ?,
              updated_at = ?,

              revision = revision + 1

            WHERE
              usage_date = ?
              AND unit_no = ?
          `)
          .bind(
            values.limestoneReceiptTon,
            values.limestoneUsageTpd,

            user.employeeNo,
            user.name,
            now,

            item.recordDate,
            item.unitNo
          )
      );
    }
  }

  try {
    await database.batch(
      statements
    );

  } catch (
    error
  ) {
    if (
      /NOT NULL constraint failed:\s*auxiliary_material_daily\.record_date/i.test(
        String(
          error?.message ||
          error
        )
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "부재료 자료가 다른 사용자 또는 자동 수집에 의해 변경되었습니다. 다시 조회한 뒤 수정해 주세요."
        },
        409
      );
    }


    throw error;
  }

  const updatedResult = await database
    .prepare(`
      SELECT *

      FROM auxiliary_material_daily

      WHERE
        record_date >= ?
        AND record_date <= ?

      ORDER BY
        record_date DESC,
        unit_no ASC
    `)
    .bind(
      firstDate,
      lastDate
    )
    .all();

  const updatedItems = (
    Array.isArray(updatedResult.results)
      ? updatedResult.results
      : []
  )
    .filter(row => {
      const key =
        `${normalizeText(row.record_date)}:` +
        `${Number(row.unit_no)}`;

      return targetKeys.has(key);
    })
    .map(convertAuxiliaryMaterialRow)
    .filter(Boolean);

  let limestoneSyncedCount = 0;

  if (limestoneSyncTargetKeys.size > 0) {
    const limestoneResult = await database
      .prepare(`
        SELECT
          usage_date,
          unit_no

        FROM limestone_usage_records

        WHERE
          usage_date >= ?
          AND usage_date <= ?
      `)
      .bind(
        firstDate,
        lastDate
      )
      .all();

    limestoneSyncedCount = (
      Array.isArray(limestoneResult.results)
        ? limestoneResult.results
        : []
    ).filter(row => {
      const key =
        `${normalizeText(row.usage_date)}:` +
        `${Number(row.unit_no)}`;

      return limestoneSyncTargetKeys.has(key);
    }).length;
  }

  return jsonResponse({
    ok: true,

    items: updatedItems,
    updatedRecordCount: updatedItems.length,
    limestoneSyncedCount,

    message:
      limestoneSyncedCount > 0
        ? (
            `${updatedItems.length}건의 부재료 자료를 수정했습니다. ` +
            `Limestone ${limestoneSyncedCount}건도 동기화했습니다.`
          )
        : `${updatedItems.length}건의 부재료 자료를 수정했습니다.`
  });
}

/* =========================================================
  Slurry 밀도 고정값 저장
========================================================= */

async function saveAuxiliaryMaterialDensitySettings(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const effectiveFrom =
    normalizeText(
      body.effectiveFrom
    );


  if (
    !isValidIsoDate(
      effectiveFrom
    ) ||
    effectiveFrom <
      "2026-08-10"
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "Slurry 밀도 적용 시작일을 확인해 주세요."
      },
      400
    );
  }


  let unitOneDensityKgm3;
  let unitTwoDensityKgm3;


  try {
    unitOneDensityKgm3 =
      normalizeAuxiliaryMaterialManualValue(
        body.unitOneDensityKgm3,
        "1호기 Slurry 밀도",
        {
          minimum:
            1000,

          minimumExclusive:
            true,

          maximum:
            2000
        }
      );


    unitTwoDensityKgm3 =
      normalizeAuxiliaryMaterialManualValue(
        body.unitTwoDensityKgm3,
        "2호기 Slurry 밀도",
        {
          minimum:
            1000,

          minimumExclusive:
            true,

          maximum:
            2000
        }
      );


    if (
      unitOneDensityKgm3 ===
        null ||
      unitTwoDensityKgm3 ===
        null
    ) {
      throw new Error(
        "1호기와 2호기 Slurry 밀도를 모두 입력해 주세요."
      );
    }

  } catch (
    error
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "Slurry 밀도 고정값을 확인해 주세요."
      },
      400
    );
  }


  const database =
    context.env.DB;


  await ensureAuxiliaryMaterialDensitySettingsTable(
    database
  );


  const user =
    authentication.user;


  const now =
    new Date()
      .toISOString();


  const settings = [
    {
      unitNo:
        1,

      densityKgm3:
        unitOneDensityKgm3
    },

    {
      unitNo:
        2,

      densityKgm3:
        unitTwoDensityKgm3
    }
  ];


  const statements =
    settings.map(
      setting =>
        database
          .prepare(`
            INSERT INTO auxiliary_material_density_settings (
              unit_no,
              density_kgm3,
              effective_from,

              created_by_id,
              created_by_name,
              updated_by_id,
              updated_by_name,

              created_at,
              updated_at,
              revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)

            ON CONFLICT(unit_no)
            DO UPDATE SET
              density_kgm3 =
                excluded.density_kgm3,

              effective_from =
                excluded.effective_from,

              updated_by_id =
                excluded.updated_by_id,

              updated_by_name =
                excluded.updated_by_name,

              updated_at =
                excluded.updated_at,

              revision =
                auxiliary_material_density_settings.revision + 1
          `)
          .bind(
            setting.unitNo,
            setting.densityKgm3,
            effectiveFrom,

            user.employeeNo,
            user.name,
            user.employeeNo,
            user.name,

            now,
            now
          )
    );


  await database.batch(
    statements
  );


  const fixedDensitySettings =
    await loadAuxiliaryMaterialDensitySettings(
      database
    );


  return jsonResponse({
    ok:
      true,

    effectiveFrom,

    fixedDensitySettings,

    message:
      `${effectiveFrom}부터 1·2호기 Slurry 밀도 고정값을 저장했습니다.`
  });
}

/* =========================================================
  기존 부재료 엑셀 A:R 값 정리

  - 숫자와 쉼표 포함 숫자 허용
  - 빈칸, -, — 는 빈 값으로 저장
  - 수식 문자열·오류값은 저장 차단
========================================================= */

function normalizeAuxiliaryMaterialExcelNumber(value, label) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue =
    typeof value === "string"
      ? normalizeText(value).replace(/,/g, "")
      : value;

  if (
    normalizedValue === "" ||
    normalizedValue === "-" ||
    normalizedValue === "—"
  ) {
    return null;
  }

  const numericValue = Number(normalizedValue);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${label} 값이 숫자가 아닙니다.`);
  }

  return normalizeAuxiliaryMaterialNumber(numericValue);
}


function normalizeAuxiliaryMaterialExcelUnit(
  rawUnit,
  recordDate,
  unitNo
) {
  if (
    !rawUnit ||
    typeof rawUnit !== "object" ||
    Array.isArray(rawUnit)
  ) {
    throw new Error(`${recordDate} ${unitNo}호기 자료가 없습니다.`);
  }

  const prefix = `${recordDate} ${unitNo}호기`;

  return {
    soxPpm:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.soxPpm,
        `${prefix} SOx`
      ),

    limestoneUsageTpd:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limestoneUsageTpd,
        `${prefix} Limestone 사용량`
      ),

    limestoneReceiptTon:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limestoneReceiptTon,
        `${prefix} Limestone 입고량`
      ),

    limeSlurryFlowM3h:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limeSlurryFlowM3h,
        `${prefix} Lime Slurry 유량`
      ),

    limeSlurryDensityKgm3:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limeSlurryDensityKgm3,
        `${prefix} Slurry 밀도`
      ),

    limePowderTpd:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.limePowderTpd,
        `${prefix} Lime Powder`
      ),

    noxPpm:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.noxPpm,
        `${prefix} NOx`
      ),

    ammoniaM3d:
      normalizeAuxiliaryMaterialExcelNumber(
        rawUnit.ammoniaM3d,
        `${prefix} Ammonia 일사용량`
      )
  };
}


/* =========================================================
  기존 부재료 엑셀 40일 단위 D1 저장

  한 날짜:
  - unitOne: B:I
  - unitTwo: J:Q
  - remarks: R

  보호 규칙:
  - 관리자만 등록
  - 한 번에 최대 40일
  - 2026-08-09까지만 엑셀 자료로 저장
  - 2026-08-10 이후는 자동 제외
  - 같은 날짜·호기는 엑셀 값으로 교체
========================================================= */

async function importAuxiliaryMaterialExcelBatch(context, body) {
  const authentication = await getAuthenticatedUser(context);

  if (authentication.error) {
    return authentication.error;
  }

  const user = authentication.user;

  if (user.role !== "admin" && user.role !== "super_admin") {
    return jsonResponse(
      {
        ok: false,
        message: "부재료 기존 엑셀 자료는 관리자만 등록할 수 있습니다."
      },
      403
    );
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (
    rawItems.length < 1 ||
    rawItems.length > MAXIMUM_AUXILIARY_MATERIAL_IMPORT_DAYS
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          `부재료 엑셀 자료는 한 번에 1일 이상 ` +
          `${MAXIMUM_AUXILIARY_MATERIAL_IMPORT_DAYS}일 이하로 등록해 주세요.`
      },
      400
    );
  }

  const fileName =
    normalizeText(body.fileName).slice(0, 200) ||
    "부재료 기존자료.xlsx";

  const importId = crypto.randomUUID();
  const normalizedItems = [];
  const excludedDates = [];
  const receivedDates = new Set();

  try {
    for (let itemIndex = 0; itemIndex < rawItems.length; itemIndex += 1) {
      const rawItem = rawItems[itemIndex];

      if (
        !rawItem ||
        typeof rawItem !== "object" ||
        Array.isArray(rawItem)
      ) {
        throw new Error(
          `${itemIndex + 1}번째 엑셀 자료 형식이 올바르지 않습니다.`
        );
      }

      const recordDate = normalizeText(rawItem.recordDate);

      if (!isValidIsoDate(recordDate)) {
        throw new Error(
          `${itemIndex + 1}번째 엑셀 날짜가 올바르지 않습니다.`
        );
      }

      if (receivedDates.has(recordDate)) {
        throw new Error(
          `${recordDate} 자료가 한 요청에 두 번 포함되어 있습니다.`
        );
      }

      receivedDates.add(recordDate);

      if (
        recordDate > AUXILIARY_MATERIAL_EXCEL_END_DATE ||
        recordDate >= AUXILIARY_MATERIAL_OIS_START_DATE
      ) {
        excludedDates.push(recordDate);
        continue;
      }

      const remarks = normalizeText(rawItem.remarks);

      if (remarks.length > 1000) {
        throw new Error(
          `${recordDate} 비고는 1,000자 이하로 입력해 주세요.`
        );
      }

      normalizedItems.push({
        recordDate,
        sheetName: normalizeText(rawItem.sheetName).slice(0, 100),
        remarks,

        unitOne:
          normalizeAuxiliaryMaterialExcelUnit(
            rawItem.unitOne,
            recordDate,
            1
          ),

        unitTwo:
          normalizeAuxiliaryMaterialExcelUnit(
            rawItem.unitTwo,
            recordDate,
            2
          )
      });
    }

  } catch (error) {
    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "부재료 엑셀 자료를 확인하지 못했습니다."
      },
      400
    );
  }

  if (normalizedItems.length < 1) {
    return jsonResponse({
      ok: true,
      importId,
      fileName,

      summary: {
        receivedDateCount: rawItems.length,
        savedDateCount: 0,
        savedRecordCount: 0,
        newRecordCount: 0,
        replacedRecordCount: 0,
        excludedDateCount: excludedDates.length
      },

      excludedDates,

      message:
        "2026-08-10 이후 자료는 OIS 자동자료 보호를 위해 저장하지 않았습니다."
    });
  }

  const database = context.env.DB;

  await ensureAuxiliaryMaterialDailyTable(database);

  normalizedItems.sort((left, right) =>
    left.recordDate.localeCompare(right.recordDate)
  );

  const firstDate = normalizedItems[0].recordDate;

  const lastDate =
    normalizedItems[
      normalizedItems.length - 1
    ].recordDate;

  const targetDateSet =
    new Set(
      normalizedItems.map(
        item => item.recordDate
      )
    );

  const existingResult =
    await database
      .prepare(`
        SELECT record_date, unit_no
        FROM auxiliary_material_daily
        WHERE record_date >= ?
          AND record_date <= ?
      `)
      .bind(
        firstDate,
        lastDate
      )
      .all();

  const existingKeys =
    new Set(
      (
        Array.isArray(existingResult.results)
          ? existingResult.results
          : []
      )
        .filter(
          row =>
            targetDateSet.has(
              normalizeText(row.record_date)
            )
        )
        .map(
          row =>
            `${normalizeText(row.record_date)}:${Number(row.unit_no)}`
        )
    );

  const upsertSql = `
    INSERT INTO auxiliary_material_daily (
      id,
      record_date,
      unit_no,

      limestone_start_stock,
      limestone_receipt_ton,
      limestone_end_stock,
      limestone_usage_tpd,

      lime_slurry_flow_m3h,
      lime_slurry_density_kgm3,
      lime_powder_tpd,

      ammonia_flow_m3h,
      ammonia_m3d,

      sox_ppm,
      nox_ppm,

      remarks,
      data_source,

      sample_count,
      is_complete,

      source_tags_json,
      raw_result_json,

      ois_request_id,
      ois_collected_at,
      agent_id,

      created_by_id,
      created_by_name,
      updated_by_id,
      updated_by_name,

      created_at,
      updated_at,
      revision
    )

    VALUES (
      ?, ?, ?,
      NULL, ?, NULL, ?,
      ?, ?, ?,
      NULL, ?,
      ?, ?,
      ?, 'excel',
      24, 1,
      ?, ?,
      '', '', '',
      ?, ?, ?, ?,
      ?, ?, 1
    )

    ON CONFLICT (
      record_date,
      unit_no
    )

    DO UPDATE SET
      limestone_start_stock = NULL,
      limestone_receipt_ton = excluded.limestone_receipt_ton,
      limestone_end_stock = NULL,
      limestone_usage_tpd = excluded.limestone_usage_tpd,

      lime_slurry_flow_m3h = excluded.lime_slurry_flow_m3h,
      lime_slurry_density_kgm3 = excluded.lime_slurry_density_kgm3,
      lime_powder_tpd = excluded.lime_powder_tpd,

      ammonia_flow_m3h = NULL,
      ammonia_m3d = excluded.ammonia_m3d,

      sox_ppm = excluded.sox_ppm,
      nox_ppm = excluded.nox_ppm,

      remarks = excluded.remarks,
      data_source = 'excel',

      sample_count = 24,
      is_complete = 1,

      source_tags_json = excluded.source_tags_json,
      raw_result_json = excluded.raw_result_json,

      ois_request_id = '',
      ois_collected_at = '',
      agent_id = '',

      updated_by_id = excluded.updated_by_id,
      updated_by_name = excluded.updated_by_name,
      updated_at = excluded.updated_at,

      revision = auxiliary_material_daily.revision + 1
  `;

  const now =
    new Date()
      .toISOString();

  const statements = [];

  for (const item of normalizedItems) {
    const units = [
      {
        unitNo: 1,
        values: item.unitOne
      },
      {
        unitNo: 2,
        values: item.unitTwo
      }
    ];

    for (const unit of units) {
      const sourceInformation = {
        source: "excel",
        importId,
        fileName,
        sheetName: item.sheetName,
        recordDate: item.recordDate,
        unitNo: unit.unitNo
      };

      const rawImportRecord = {
        ...sourceInformation,
        values: unit.values,
        remarks: item.remarks
      };

      statements.push(
        database
          .prepare(upsertSql)
          .bind(
            crypto.randomUUID(),
            item.recordDate,
            unit.unitNo,

            unit.values.limestoneReceiptTon,
            unit.values.limestoneUsageTpd,

            unit.values.limeSlurryFlowM3h,
            unit.values.limeSlurryDensityKgm3,
            unit.values.limePowderTpd,

            unit.values.ammoniaM3d,

            unit.values.soxPpm,
            unit.values.noxPpm,

            item.remarks,

            JSON.stringify(
              sourceInformation
            ),

            JSON.stringify(
              rawImportRecord
            ),

            user.employeeNo,
            user.name,
            user.employeeNo,
            user.name,

            now,
            now
          )
      );
    }
  }

  await database.batch(
    statements
  );

  const savedRecordCount =
    normalizedItems.length * 2;

  const replacedRecordCount =
    existingKeys.size;

  const newRecordCount =
    Math.max(
      0,
      savedRecordCount - replacedRecordCount
    );

  const excludedMessage =
    excludedDates.length > 0
      ? `, ${excludedDates.length}일 제외`
      : "";

  return jsonResponse({
    ok: true,
    importId,
    fileName,

    range: {
      startDate: firstDate,
      endDate: lastDate
    },

    summary: {
      receivedDateCount: rawItems.length,
      savedDateCount: normalizedItems.length,
      savedRecordCount,
      newRecordCount,
      replacedRecordCount,
      excludedDateCount: excludedDates.length
    },

    excludedDates,

    message:
      `${normalizedItems.length}일의 부재료 엑셀 자료를 저장했습니다. ` +
      `(신규 ${newRecordCount}건, 교체 ${replacedRecordCount}건` +
      `${excludedMessage})`
  });
}

async function createAuxiliaryMaterialBatchRequest(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const startDate =
    normalizeText(
      body.startDate ||
      body.start_date
    );


  const endDate =
    normalizeText(
      body.endDate ||
      body.end_date
    );


  const forceRefresh =
    body.forceRefresh ===
      true;


  const dates =
    createLimestoneUsageBatchDates(
      startDate,
      endDate
    );


  if (
    dates.length <
      1 ||
    dates.length >
      62
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "부재료 OIS 조회 기간은 한 번에 1일 이상 62일 이하로 선택해 주세요."
      },
      400
    );
  }


  await ensureAuxiliaryMaterialDailyTable(
    context.env.DB
  );


  await expireOldRequests(
    context.env.DB
  );


  const user =
    authentication.user;


  const items = [];


  let createdCount =
    0;


  let reusedCount =
    0;


  let savedCount =
    0;


  const baseTime =
    Date.now();


  for (
    let dateIndex = 0;
    dateIndex <
      dates.length;
    dateIndex +=
      1
  ) {
    const targetDate =
      dates[
        dateIndex
      ];


    const savedRow =
      await context.env.DB
        .prepare(`
          SELECT
            COUNT(*) AS record_count,
            COALESCE(
              SUM(is_complete),
              0
            ) AS complete_count
          FROM auxiliary_material_daily
          WHERE record_date = ?
        `)
        .bind(
          targetDate
        )
        .first();


    if (
      !forceRefresh &&
      Number(
        savedRow?.record_count
      ) >=
        2 &&
      Number(
        savedRow?.complete_count
      ) >=
        2
    ) {
      savedCount +=
        1;


      items.push({
        targetDate,
        disposition:
          "saved"
      });


      continue;
    }


    const activeRow =
      await context.env.DB
        .prepare(`
          SELECT *
          FROM ois_data_requests
          WHERE request_type = 'auxiliary_materials'
            AND target_date = ?
            AND status IN ('pending', 'processing')
          ORDER BY requested_at DESC
          LIMIT 1
        `)
        .bind(
          targetDate
        )
        .first();


    if (
      activeRow
    ) {
      reusedCount +=
        1;


      items.push({
        ...convertRequestRow(
          activeRow
        ),
        disposition:
          "reused"
      });


      continue;
    }


    const requestId =
      crypto.randomUUID();


    const requestedAt =
      new Date(
        baseTime +
        dateIndex
      ).toISOString();


    const expiresAt =
      new Date(
        baseTime +
        72 *
        60 *
        60 *
        1000 +
        dateIndex
      ).toISOString();


    await context.env.DB
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
        )
        VALUES (
          ?,
          'auxiliary_materials',
          ?,
          'pending',
          ?,
          ?,
          ?,
          NULL,
          NULL,
          '',
          NULL,
          '',
          ?,
          ?
        )
      `)
      .bind(
        requestId,
        targetDate,
        user.employeeNo,
        user.name,
        requestedAt,
        expiresAt,
        requestedAt
      )
      .run();


    createdCount +=
      1;


    items.push({
      id:
        requestId,
      requestType:
        "auxiliary_materials",
      targetDate,
      status:
        "pending",
      disposition:
        "created"
    });
  }


  return jsonResponse(
    {
      ok:
        true,

      range: {
        startDate,
        endDate,
        dayCount:
          dates.length
      },

      createdCount,
      reusedCount,
      savedCount,
      items,

      message:
        `${dates.length}일 중 ${createdCount}일의 부재료 OIS 조회를 등록했습니다.`
    },
    createdCount >
      0
      ? 201
      : 200
  );
}





/* =========================================================
  업무일지 사용자 요청 상태 묶음 조회

  GET /api/ois-data-requests
    ?action=status_batch
    &ids=요청ID1,요청ID2,...

  - 한 번에 최대 24건
  - 사용자 인증은 묶음 전체에서 한 번만 수행
  - 전달받은 요청 중 실제 만료된 활성 요청만 정리
========================================================= */

const MAXIMUM_STATUS_BATCH_IDS =
  24;


function parseStatusBatchRequestIds(
  requestUrl
) {
  const rawValues =
    requestUrl.searchParams
      .getAll(
        "ids"
      );


  if (
    rawValues.length <
      1
  ) {
    return {
      error:
        "상태를 조회할 OIS 요청 ID가 없습니다."
    };
  }


  const rawIds =
    rawValues.flatMap(
      value => {
        return String(
          value ??
          ""
        ).split(
          ","
        );
      }
    );


  if (
    rawIds.length <
      1 ||
    rawIds.length >
      MAXIMUM_STATUS_BATCH_IDS
  ) {
    return {
      error:
        "OIS 요청 상태는 한 번에 최대 24건까지 조회할 수 있습니다."
    };
  }


  const requestIds = [];


  for (
    const rawId
    of rawIds
  ) {
    const requestId =
      normalizeText(
        rawId
      );


    if (
      !requestId ||
      requestId.length >
        128 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(
        requestId
      )
    ) {
      return {
        error:
          "OIS 요청 ID 형식이 올바르지 않습니다."
      };
    }


    if (
      !requestIds.includes(
        requestId
      )
    ) {
      requestIds.push(
        requestId
      );
    }
  }


  return {
    requestIds
  };
}


async function findRequestsByIds(
  database,
  requestIds
) {
  if (
    requestIds.length <
      1
  ) {
    return [];
  }


  const placeholders =
    requestIds
      .map(
        () => {
          return "?";
        }
      )
      .join(
        ", "
      );


  const query = [
    "SELECT *",
    "FROM ois_data_requests",
    "WHERE id IN (" +
      placeholders +
      ")"
  ].join(
    "\n"
  );


  const queryResult =
    await database
      .prepare(
        query
      )
      .bind(
        ...requestIds
      )
      .all();


  return Array.isArray(
    queryResult?.results
  )
    ? queryResult.results
    : [];
}


async function expireSelectedActiveRequests(
  database,
  rows
) {
  const nowDate =
    new Date();


  const now =
    nowDate.toISOString();


  const expiredRequestIds =
    rows
      .filter(
        row => {
          const status =
            normalizeText(
              row?.status
            )
              .toLowerCase();


          if (
            status !==
              "pending" &&
            status !==
              "processing"
          ) {
            return false;
          }


          const expiresAt =
            new Date(
              normalizeText(
                row?.expires_at
              )
            );


          return (
            !Number.isNaN(
              expiresAt.getTime()
            ) &&
            expiresAt <
              nowDate
          );
        }
      )
      .map(
        row => {
          return normalizeText(
            row.id
          );
        }
      );


  if (
    expiredRequestIds.length <
      1
  ) {
    return false;
  }


  const placeholders =
    expiredRequestIds
      .map(
        () => {
          return "?";
        }
      )
      .join(
        ", "
      );


  const updateQuery = [
    "UPDATE ois_data_requests",
    "SET",
    "  status = 'failed',",
    "  error_message = 'OIS 연동 프로그램의 응답 시간이 초과되었습니다.',",
    "  completed_at = ?,",
    "  updated_at = ?",
    "WHERE id IN (" +
      placeholders +
      ")",
    "  AND status IN ('pending', 'processing')",
    "  AND expires_at < ?"
  ].join(
    "\n"
  );


  await database
    .prepare(
      updateQuery
    )
    .bind(
      now,
      now,
      ...expiredRequestIds,
      now
    )
    .run();


  return true;
}


async function handleStatusBatchGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const parsedIds =
    parseStatusBatchRequestIds(
      requestUrl
    );


  if (
    parsedIds.error
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          parsedIds.error
      },
      400
    );
  }


  const requestIds =
    parsedIds.requestIds;


  let rows =
    await findRequestsByIds(
      context.env.DB,
      requestIds
    );


  const expiredAny =
    await expireSelectedActiveRequests(
      context.env.DB,
      rows
    );


  if (
    expiredAny
  ) {
    rows =
      await findRequestsByIds(
        context.env.DB,
        requestIds
      );
  }


  const rowsById =
    new Map(
      rows.map(
        row => {
          return [
            normalizeText(
              row.id
            ),
            row
          ];
        }
      )
    );


  const compact =
    normalizeText(
      requestUrl.searchParams.get(
        "compact"
      )
    ) ===
      "1";


  const items =
    requestIds
      .map(
        requestId => {
          return rowsById.get(
            requestId
          );
        }
      )
      .filter(
        Boolean
      )
      .map(
        row => {
          return compact
            ? compactFbheVibrationRequestRow(row)
            : convertRequestRow(row);
        }
      );


  const missingIds =
    requestIds.filter(
      requestId => {
        return !rowsById.has(
          requestId
        );
      }
    );


  return jsonResponse({
    ok:
      true,

    requestedIds:
      requestIds,

    items,

    missingIds
  });
}

/* =========================================================
  업무일지 사용자 상태 조회

  GET /api/ois-data-requests?id=...
========================================================= */

async function handleUserGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  await expireOldRequests(
    context.env.DB
  );


  const requestId =
    normalizeText(
      requestUrl.searchParams.get(
        "id"
      )
    );


  if (
    !requestId
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "조회할 OIS 요청 ID가 없습니다."
      },
      400
    );
  }


  const requestItem =
    await findRequestById(
      context.env.DB,
      requestId
    );


  if (
    !requestItem
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "OIS 요청을 찾을 수 없습니다."
      },
      404
    );
  }


  return jsonResponse({
    ok:
      true,

    item:
      requestItem
  });
}

/* =========================================================
  [D1-POLLING-OPT-V1]
  OIS Queue polling 인덱스

  Agent의 5초 polling 주기는 유지한다.
  대신 status='pending' 후보를 찾을 때
  과거 complete/failed 이력 전체를 훑지 않도록 한다.

  Worker 인스턴스당 최초 1회만 IF NOT EXISTS 확인 후
  같은 인스턴스에서는 resolved Promise를 재사용한다.
========================================================= */

let oisQueuePerformanceIndexPromise =
  null;


async function ensureOisQueuePerformanceIndexes(
  database
) {
  if (
    oisQueuePerformanceIndexPromise
  ) {
    return await oisQueuePerformanceIndexPromise;
  }


  oisQueuePerformanceIndexPromise =
    database
      .batch([
        database.prepare(`
          CREATE INDEX IF NOT EXISTS
            idx_ois_data_requests_status_requested_v1

          ON ois_data_requests (
            status,
            requested_at,
            request_type,
            id
          )
        `),

        database.prepare(`
          CREATE INDEX IF NOT EXISTS
            idx_ois_data_requests_status_expires_v1

          ON ois_data_requests (
            status,
            expires_at,
            id
          )
        `),

        database.prepare(`
          CREATE INDEX IF NOT EXISTS
            idx_ois_data_requests_type_status_requested_v1

          ON ois_data_requests (
            request_type,
            status,
            requested_at,
            id
          )
        `)
      ])
      .catch(
        error => {
          oisQueuePerformanceIndexPromise =
            null;

          throw error;
        }
      );


  return await oisQueuePerformanceIndexPromise;
}

/* =========================================================
  회사 PC가 DataPARC Blower 요청을 묶음으로 가져오기

  GET /api/ois-data-requests
    ?action=next_blower_batch
    &limit=1..23

  - limit 생략 시 23건
  - Blower read-only 요청만 오래된 순서로 claim
  - 조건부 UPDATE와 restart guard는 단건 claim과 동일
  - 다른 Agent와의 경쟁은 최대 3회 재조회
========================================================= */

const MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_CLAIMS =
  23;


const MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_CLAIM_ATTEMPTS =
  3;


/*
  Atomic browser creates use an opaque request ID that also carries a durable
  group identity. The underscore form intentionally stays inside the existing
  request-ID alphabet used by status/completion endpoints.

  brb1_<batch uuid>_<total 2 digits>_<item index 2 digits>
*/
const BRB1_INVALID_HEX_GLOB =
  "*[^0-9A-Fa-f]*";


const BRB1_TWO_DIGIT_GLOB =
  "[0-9][0-9]";


const BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH =
  45;


/*
  Cloudflare D1 inherits SQLite's 50-byte LIKE/GLOB pattern limit. Keep the
  actual patterns deliberately short and express the fixed layout with
  length/substr checks instead of one long full-ID pattern.
*/
function blowerRuntimeProbeCreateGroupSql(
  requestIdExpression
) {
  if (
    !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(
      requestIdExpression
    )
  ) {
    throw new Error(
      "Invalid Blower batch request-ID SQL expression."
    );
  }


  return `(
    length(${requestIdExpression}) = 47
    AND substr(${requestIdExpression}, 1, 5) = 'brb1_'
    AND substr(${requestIdExpression}, 14, 1) = '-'
    AND substr(${requestIdExpression}, 19, 1) = '-'
    AND substr(${requestIdExpression}, 24, 1) = '-'
    AND substr(${requestIdExpression}, 29, 1) = '-'
    AND substr(${requestIdExpression}, 42, 1) = '_'
    AND substr(${requestIdExpression}, 45, 1) = '_'
    AND substr(${requestIdExpression}, 6, 8) NOT GLOB '${BRB1_INVALID_HEX_GLOB}'
    AND substr(${requestIdExpression}, 15, 4) NOT GLOB '${BRB1_INVALID_HEX_GLOB}'
    AND substr(${requestIdExpression}, 20, 4) NOT GLOB '${BRB1_INVALID_HEX_GLOB}'
    AND substr(${requestIdExpression}, 25, 4) NOT GLOB '${BRB1_INVALID_HEX_GLOB}'
    AND substr(${requestIdExpression}, 30, 12) NOT GLOB '${BRB1_INVALID_HEX_GLOB}'
    AND substr(${requestIdExpression}, 43, 2) GLOB '${BRB1_TWO_DIGIT_GLOB}'
    AND substr(${requestIdExpression}, 46, 2) GLOB '${BRB1_TWO_DIGIT_GLOB}'
    AND CAST(substr(${requestIdExpression}, 43, 2) AS INTEGER) BETWEEN 1 AND ${MAXIMUM_STATUS_BATCH_IDS}
    AND CAST(substr(${requestIdExpression}, 46, 2) AS INTEGER) < CAST(substr(${requestIdExpression}, 43, 2) AS INTEGER)
  )`;
}


function parseBlowerRuntimeProbeCreateGroupRequestId(
  requestId
) {
  const match =
    /^brb1_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9]{2})_([0-9]{2})$/i.exec(
      normalizeText(
        requestId
      )
    );


  if (
    !match
  ) {
    return null;
  }


  const expectedCount =
    Number(
      match[2]
    );


  const itemIndex =
    Number(
      match[3]
    );


  if (
    !Number.isInteger(
      expectedCount
    ) ||
    expectedCount <
      1 ||
    expectedCount >
      MAXIMUM_STATUS_BATCH_IDS ||
    !Number.isInteger(
      itemIndex
    ) ||
    itemIndex <
      0 ||
    itemIndex >=
      expectedCount
  ) {
    return null;
  }


  return {
    groupId:
      `brb1_${match[1].toLowerCase()}_${match[2]}_`,
    expectedCount,
    itemIndex
  };
}


function parseBlowerRuntimeProbeBatchLimit(
  requestUrl
) {
  const rawLimit =
    requestUrl.searchParams.get(
      "limit"
    );


  if (
    rawLimit ===
      null
  ) {
    return {
      limit:
        MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_CLAIMS
    };
  }


  const limitText =
    normalizeText(
      rawLimit
    );


  if (
    !/^(?:[1-9]|1[0-9]|2[0-3])$/.test(
      limitText
    )
  ) {
    return {
      error:
        "DataPARC Blower 묶음 요청 limit은 1 이상 23 이하 정수여야 합니다."
    };
  }


  return {
    limit:
      Number(
        limitText
      )
  };
}


function convertJoinedBlowerRuntimeProbeIntentRow(
  row
) {
  return convertBlowerRuntimeProbeIntentRow({
    request_id:
      row?.probe_request_id,
    schema_version:
      row?.probe_schema_version,
    asset_tag:
      row?.probe_asset_tag,
    dataparc_tag:
      row?.probe_dataparc_tag,
    window_start:
      row?.probe_window_start,
    window_end:
      row?.probe_window_end,
    chunk_days:
      row?.probe_chunk_days,
    chunk_count:
      row?.probe_chunk_count,
    expected_last_replacement_at:
      row?.probe_expected_last_replacement_at,
    expected_cycle_start_state:
      row?.probe_expected_cycle_start_state,
    expected_cycle_started_at:
      row?.probe_expected_cycle_started_at,
    expected_cycle_start_revision:
      row?.probe_expected_cycle_start_revision,
    expected_cycle_runtime_revision:
      row?.probe_expected_cycle_runtime_revision
  });
}


async function findPendingBlowerRuntimeProbeRows(
  database,
  pollingNow,
  limit,
  agentId,
  primaryGroupId =
    ""
) {
  const queryResult =
    await database
      .prepare(`
        WITH queue_poll AS (
          SELECT
            ? AS polling_now,
            ? AS polling_agent
        ),

        pending_candidates AS (
          SELECT
            request.*,
            intent.request_id AS probe_request_id,
            intent.schema_version AS probe_schema_version,
            intent.asset_tag AS probe_asset_tag,
            intent.dataparc_tag AS probe_dataparc_tag,
            intent.window_start AS probe_window_start,
            intent.window_end AS probe_window_end,
            intent.chunk_days AS probe_chunk_days,
            intent.chunk_count AS probe_chunk_count,
            intent.expected_last_replacement_at AS probe_expected_last_replacement_at,
            intent.expected_cycle_start_state AS probe_expected_cycle_start_state,
            intent.expected_cycle_started_at AS probe_expected_cycle_started_at,
            intent.expected_cycle_start_revision AS probe_expected_cycle_start_revision,
            intent.expected_cycle_runtime_revision AS probe_expected_cycle_runtime_revision,
            queue_poll.polling_now,
            queue_poll.polling_agent,
            CASE
              WHEN length(request.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("request.id")}
                THEN substr(request.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH})
              ELSE ''
            END AS probe_create_group_id

          FROM ois_data_requests AS request
          INNER JOIN blower_runtime_probe_intents_v4 AS intent
            ON intent.request_id = request.id
          CROSS JOIN queue_poll

          WHERE
            request.request_type = ?
            AND request.status = 'pending'
            AND request.expires_at >= queue_poll.polling_now
            AND (
              substr(request.id, 1, 5) <> 'brb1_'
              OR (
                length(request.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("request.id")}
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM ois_data_requests AS restart_guard
              WHERE
                restart_guard.request_type = 'cofiring_restart_guard'
                AND restart_guard.status = 'guard'
                AND restart_guard.agent_id = queue_poll.polling_agent
                AND restart_guard.expires_at > queue_poll.polling_now
            )
        ),

        annotated_candidates AS (
          SELECT
            candidate.*,
            CASE
              WHEN candidate.probe_create_group_id = '' THEN 1
              ELSE (
                SELECT COUNT(*)
                FROM ois_data_requests AS sibling
                WHERE sibling.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                  AND sibling.requested_by_id = candidate.requested_by_id
                  AND length(sibling.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("sibling.id")}
                  AND substr(sibling.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = candidate.probe_create_group_id
                  AND sibling.status = 'pending'
                  AND sibling.expires_at >= candidate.polling_now
              )
            END AS probe_group_pending_count,
            CASE
              WHEN candidate.probe_create_group_id = '' THEN 0
              ELSE (
                SELECT COUNT(*)
                FROM ois_data_requests AS sibling
                WHERE sibling.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                  AND sibling.requested_by_id = candidate.requested_by_id
                  AND length(sibling.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("sibling.id")}
                  AND substr(sibling.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = candidate.probe_create_group_id
                  AND sibling.status = 'processing'
                  AND sibling.expires_at >= candidate.polling_now
                  AND sibling.agent_id = candidate.polling_agent
              )
            END AS probe_group_owned_processing_count,
            CASE
              WHEN candidate.probe_create_group_id = '' THEN 0
              ELSE (
                SELECT COUNT(*)
                FROM ois_data_requests AS sibling
                WHERE sibling.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                  AND sibling.requested_by_id = candidate.requested_by_id
                  AND sibling.id = candidate.probe_create_group_id || '00'
                  AND sibling.status = 'processing'
                  AND sibling.expires_at >= candidate.polling_now
                  AND sibling.agent_id = candidate.polling_agent
              )
            END AS probe_group_owned_leader_count,
            CASE
              WHEN candidate.probe_create_group_id = '' THEN 0
              ELSE (
                SELECT COUNT(*)
                FROM ois_data_requests AS sibling
                WHERE sibling.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                  AND sibling.requested_by_id = candidate.requested_by_id
                  AND length(sibling.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("sibling.id")}
                  AND substr(sibling.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = candidate.probe_create_group_id
                  AND sibling.status = 'processing'
                  AND sibling.expires_at >= candidate.polling_now
                  AND sibling.agent_id <> candidate.polling_agent
              )
            END AS probe_group_foreign_processing_count

          FROM pending_candidates AS candidate
        )

        SELECT *
        FROM annotated_candidates

        WHERE
          (
            (? = '' AND probe_create_group_id = '')
            OR (? <> '' AND probe_create_group_id = ?)
          )
          AND (
            probe_create_group_id = ''
            OR probe_group_foreign_processing_count = 0
          )

        ORDER BY
          CASE
            WHEN probe_create_group_id <> ''
              AND probe_group_owned_processing_count > 0
              THEN 0
            ELSE 1
          END ASC,
          requested_at ASC,
          probe_create_group_id ASC,
          id ASC

        LIMIT ?
      `)
      .bind(
        pollingNow,
        agentId,
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
        primaryGroupId,
        primaryGroupId,
        primaryGroupId,
        limit + MAXIMUM_STATUS_BATCH_IDS
      )
      .all();


  const rows =
    Array.isArray(
      queryResult?.results
    )
      ? queryResult.results
      : [];


  const candidates = rows
    .map(
      pendingRow => {
        const requestItem =
          convertRequestRow(
            pendingRow
          );


        const probe =
          convertJoinedBlowerRuntimeProbeIntentRow(
            pendingRow
          );


        const groupMetadata =
          parseBlowerRuntimeProbeCreateGroupRequestId(
            requestItem.id
          );


        const selectedGroupId =
          normalizeText(
            pendingRow.probe_create_group_id
          );


        return {
          pendingRow,
          probe,
          groupMetadata,
          valid:
            (
              !selectedGroupId ||
              groupMetadata?.groupId ===
                selectedGroupId
            ) &&
              isValidBlowerRuntimeProbeIntentIdentity(
                probe,
                requestItem.id,
                requestItem.targetDate
              )
        };
      }
    );


  /* Only explicit brb1 IDs form a group. Every legacy ID is a singleton. */
  const selected = [];
  for (let index = 0; index < candidates.length && selected.length < limit;) {
    const groupMetadata =
      candidates[
        index
      ].groupMetadata;


    if (
      !groupMetadata
    ) {
      if (
        candidates[
          index
        ].valid
      ) {
        selected.push(
          candidates[
            index
          ]
        );
      }


      index +=
        1;


      continue;
    }


    const group = [];
    while (
      index <
        candidates.length &&
      candidates[
        index
      ].groupMetadata?.groupId ===
        groupMetadata.groupId
    ) {
      group.push(
        candidates[
          index
        ]
      );


      index +=
        1;
    }


    const valid = group.filter(candidate => candidate.valid);


    const pendingCount =
      Number(
        group[0]?.pendingRow
          ?.probe_group_pending_count
      );


    const ownedProcessingCount =
      Number(
        group[0]?.pendingRow
          ?.probe_group_owned_processing_count
      );


    const foreignProcessingCount =
      Number(
        group[0]?.pendingRow
          ?.probe_group_foreign_processing_count
      );


    const ownedLeaderCount =
      Number(
        group[0]?.pendingRow
          ?.probe_group_owned_leader_count
      );


    if (
      group.length !==
        pendingCount ||
      valid.length !==
        group.length ||
      pendingCount +
        ownedProcessingCount !==
          groupMetadata.expectedCount ||
      ownedLeaderCount !==
        1 ||
      foreignProcessingCount !==
        0
    ) {
      continue;
    }


    if (
      selected.length +
        group.length >
          limit
    ) {
      break;
    }


    selected.push(
      ...group
    );


    /* Never mix an owned durable group with unrelated legacy requests. */
    break;
  }


  return selected;
}


function prepareBlowerRuntimeProbeBatchClaim(
  database,
  pendingCandidate,
  agentId,
  processingStartedAtText,
  processingExpiresAtText
) {
  const pendingRow =
    pendingCandidate?.pendingRow;


  const requestId =
    normalizeText(
      pendingRow?.id
    );


  return {
    requestId,
    pendingRow,
    groupMetadata:
      pendingCandidate?.groupMetadata ||
      null,
    probe:
      pendingCandidate?.probe ||
      null,
    statement:
      database
        .prepare(`
          UPDATE ois_data_requests

          SET
            status = 'processing',
            started_at = ?,
            agent_id = ?,
            expires_at = ?,
            updated_at = ?

          WHERE
            id = ?
            AND request_type = ?
            AND status = 'pending'
            AND expires_at >= ?
            AND NOT EXISTS (
              SELECT 1
              FROM ois_data_requests AS restart_guard
              WHERE
                restart_guard.request_type = 'cofiring_restart_guard'
                AND restart_guard.status = 'guard'
                AND restart_guard.agent_id = ?
                AND restart_guard.expires_at > ?
            )
        `)
        .bind(
          processingStartedAtText,
          agentId,
          processingExpiresAtText,
          processingStartedAtText,
          requestId,
          BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
          processingStartedAtText,
          agentId,
          processingStartedAtText
        )
  };
}


function prepareBlowerRuntimeProbeBatchClaimGuard(
  database,
  candidates,
  agentId,
  pollingNow
) {
  const plans =
    JSON.stringify(
      candidates.map(
        candidate => {
          const probe =
            candidate.probe;


          return {
            requestId:
              candidate.requestId,
            targetDate:
              normalizeText(
                candidate.pendingRow?.target_date
              ),
            requestedById:
              normalizeText(
                candidate.pendingRow?.requested_by_id
              ),
            groupId:
              candidate.groupMetadata?.groupId ||
              "",
            expectedCount:
              candidate.groupMetadata?.expectedCount ||
              1,
            assetTag:
              probe?.assetTag ||
              "",
            dataParcTag:
              probe?.dataParcTag ||
              "",
            startAt:
              probe?.startAt ||
              "",
            endAt:
              probe?.endAt ||
              "",
            chunkDays:
              probe?.chunkDays ||
              0,
            chunkCount:
              probe?.chunkCount ||
              0,
            expectedLastReplacementAt:
              probe?.expectedLastReplacementAt ||
              "",
            expectedCycleStartState:
              probe?.expectedCycleStartState ||
              "",
            expectedCycleStartedAt:
              probe?.expectedCycleStartedAt ||
              "",
            expectedCycleStartRevision:
              probe?.expectedCycleStartRevision ||
              "",
            expectedCycleRuntimeRevision:
              probe?.expectedCycleRuntimeRevision ||
              ""
          };
        }
      )
    );


  /*
    D1 batch() is transactional. This first statement deliberately violates a
    NOT NULL constraint only when any selected row/group changed after the
    look-ahead. That aborts every following sibling UPDATE in the same batch.
  */
  return database
    .prepare(`
      /* BLOWER_RUNTIME_BATCH_CLAIM_CAS_V1 */
      WITH plans AS (
        SELECT
          json_extract(value, '$.requestId') AS request_id,
          json_extract(value, '$.targetDate') AS target_date,
          json_extract(value, '$.requestedById') AS requested_by_id,
          json_extract(value, '$.groupId') AS group_id,
          CAST(json_extract(value, '$.expectedCount') AS INTEGER) AS expected_count,
          json_extract(value, '$.assetTag') AS asset_tag,
          json_extract(value, '$.dataParcTag') AS dataparc_tag,
          json_extract(value, '$.startAt') AS window_start,
          json_extract(value, '$.endAt') AS window_end,
          CAST(json_extract(value, '$.chunkDays') AS INTEGER) AS chunk_days,
          CAST(json_extract(value, '$.chunkCount') AS INTEGER) AS chunk_count,
          json_extract(value, '$.expectedLastReplacementAt') AS expected_last_replacement_at,
          json_extract(value, '$.expectedCycleStartState') AS expected_cycle_start_state,
          json_extract(value, '$.expectedCycleStartedAt') AS expected_cycle_started_at,
          json_extract(value, '$.expectedCycleStartRevision') AS expected_cycle_start_revision,
          json_extract(value, '$.expectedCycleRuntimeRevision') AS expected_cycle_runtime_revision
        FROM json_each(?)
      ),

      invalid_plan AS (
        SELECT 1
        FROM plans AS plan
        WHERE
          NOT EXISTS (
            SELECT 1
            FROM ois_data_requests AS request
            INNER JOIN blower_runtime_probe_intents_v4 AS intent
              ON intent.request_id = request.id
            WHERE request.id = plan.request_id
              AND request.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
              AND request.target_date = plan.target_date
              AND request.requested_by_id = plan.requested_by_id
              AND request.status = 'pending'
              AND request.expires_at >= ?
              AND intent.schema_version = ${BLOWER_RUNTIME_PROBE_SCHEMA_VERSION}
              AND intent.asset_tag = plan.asset_tag
              AND intent.dataparc_tag = plan.dataparc_tag
              AND intent.window_start = plan.window_start
              AND intent.window_end = plan.window_end
              AND intent.chunk_days = plan.chunk_days
              AND intent.chunk_count = plan.chunk_count
              AND intent.expected_last_replacement_at = plan.expected_last_replacement_at
              AND COALESCE(intent.expected_cycle_start_state, '') = plan.expected_cycle_start_state
              AND COALESCE(intent.expected_cycle_started_at, '') = plan.expected_cycle_started_at
              AND COALESCE(intent.expected_cycle_start_revision, '') = plan.expected_cycle_start_revision
              AND COALESCE(intent.expected_cycle_runtime_revision, '') = plan.expected_cycle_runtime_revision
          )
          OR (
            plan.group_id <> ''
            AND (
              (SELECT COUNT(*) FROM plans AS selected
                WHERE selected.group_id = plan.group_id
                  AND selected.requested_by_id = plan.requested_by_id) <>
                (SELECT COUNT(*) FROM ois_data_requests AS sibling
                  WHERE sibling.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                    AND sibling.requested_by_id = plan.requested_by_id
                    AND length(sibling.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("sibling.id")}
                    AND substr(sibling.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = plan.group_id
                    AND sibling.status = 'pending'
                    AND sibling.expires_at >= ?)
              OR plan.expected_count <>
                ((SELECT COUNT(*) FROM plans AS selected
                    WHERE selected.group_id = plan.group_id
                      AND selected.requested_by_id = plan.requested_by_id)
                  + (SELECT COUNT(*) FROM ois_data_requests AS sibling
                    WHERE sibling.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                      AND sibling.requested_by_id = plan.requested_by_id
                      AND length(sibling.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("sibling.id")}
                      AND substr(sibling.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = plan.group_id
                      AND sibling.status = 'processing'
                      AND sibling.expires_at >= ?
                      AND sibling.agent_id = ?))
              OR EXISTS (
                SELECT 1
                FROM ois_data_requests AS sibling
                WHERE sibling.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                  AND sibling.requested_by_id = plan.requested_by_id
                  AND length(sibling.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("sibling.id")}
                  AND substr(sibling.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = plan.group_id
                  AND sibling.status = 'processing'
                  AND sibling.expires_at >= ?
                  AND sibling.agent_id <> ?
              )
              OR NOT EXISTS (
                SELECT 1
                FROM ois_data_requests AS leader
                WHERE leader.id = plan.group_id || '00'
                  AND leader.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                  AND leader.requested_by_id = plan.requested_by_id
                  AND leader.status = 'processing'
                  AND leader.expires_at >= ?
                  AND leader.agent_id = ?
              )
            )
          )
          OR EXISTS (
            SELECT 1
            FROM ois_data_requests AS restart_guard
            WHERE restart_guard.request_type = 'cofiring_restart_guard'
              AND restart_guard.status = 'guard'
              AND restart_guard.agent_id = ?
              AND restart_guard.expires_at > ?
          )
        LIMIT 1
      )

      INSERT INTO blower_runtime_probe_intents_v4 (
        request_id,
        reuse_key,
        schema_version,
        asset_tag,
        dataparc_tag,
        window_start,
        window_end,
        chunk_days,
        chunk_count,
        expected_last_replacement_at,
        expected_cycle_start_state,
        expected_cycle_started_at,
        expected_cycle_start_revision,
        expected_cycle_runtime_revision,
        created_at,
        updated_at
      )
      SELECT
        'claim-cas-' || lower(hex(randomblob(16))),
        NULL,
        ${BLOWER_RUNTIME_PROBE_SCHEMA_VERSION},
        'claim-cas',
        NULL,
        '',
        '',
        ${BLOWER_RUNTIME_PROBE_CHUNK_DAYS},
        0,
        '',
        '',
        '',
        '',
        '',
        ?,
        ?
      FROM invalid_plan
    `)
    .bind(
      plans,
      pollingNow,
      pollingNow,
      pollingNow,
      agentId,
      pollingNow,
      agentId,
      pollingNow,
      agentId,
      agentId,
      pollingNow,
      pollingNow,
      pollingNow
    );
}


async function findBlowerRuntimeProbeIntentsByRequestIds(
  database,
  requestIds
) {
  if (
    requestIds.length <
      1
  ) {
    return new Map();
  }


  const placeholders =
    requestIds
      .map(
        () => {
          return "?";
        }
      )
      .join(
        ", "
      );


  const queryResult =
    await database
      .prepare(
        [
          "SELECT *",
          "FROM blower_runtime_probe_intents_v4",
          "WHERE request_id IN (" +
            placeholders +
            ")"
        ].join(
          "\n"
        )
      )
      .bind(
        ...requestIds
      )
      .all();


  const rows =
    Array.isArray(
      queryResult?.results
    )
      ? queryResult.results
      : [];


  return new Map(
    rows.map(
      row => {
        const probe =
          convertBlowerRuntimeProbeIntentRow(
            row
          );


        return [
          probe?.requestId ||
            "",
          probe
        ];
      }
    )
  );
}


async function claimBlowerRuntimeProbeBatchRound(
  database,
  pendingRows,
  agentId
) {
  const processingStartedAt =
    new Date();


  const processingStartedAtText =
    processingStartedAt.toISOString();


  const processingExpiresAtText =
    new Date(
      processingStartedAt.getTime() +
      getRequestProcessingTimeoutMinutes(
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE
      ) *
        60 *
        1000
    )
      .toISOString();


  const candidates =
    pendingRows.map(
      pendingCandidate => {
        return prepareBlowerRuntimeProbeBatchClaim(
          database,
          pendingCandidate,
          agentId,
          processingStartedAtText,
          processingExpiresAtText
        );
      }
    );


  let batchResults;


  try {
    batchResults =
      await database.batch([
        prepareBlowerRuntimeProbeBatchClaimGuard(
          database,
          candidates,
          agentId,
          processingStartedAtText
        ),
        ...candidates.map(
          candidate => {
            return candidate.statement;
          }
        )
      ]);

  } catch (
    error
  ) {
    if (
      /NOT NULL constraint failed:\s*blower_runtime_probe_intents_v4\.dataparc_tag/i.test(
        String(
          error?.message ||
          error
        )
      )
    ) {
      return {
        items: [],
        lostCompetition:
          true
      };
    }


    throw error;
  }


  const updateResults =
    batchResults.slice(
      1
    );


  const claimedCandidates =
    candidates.filter(
      (
        candidate,
        candidateIndex
      ) => {
        return Number(
          updateResults?.[
            candidateIndex
          ]?.meta?.changes
        ) ===
          1;
      }
    );


  const items =
    claimedCandidates.map(
      candidate => {
        const requestItem =
          convertRequestRow({
            ...candidate.pendingRow,
            status:
              "processing",
            started_at:
              processingStartedAtText,
            agent_id:
              agentId,
            expires_at:
              processingExpiresAtText,
            updated_at:
              processingStartedAtText
          });


        return {
          ...requestItem,
          probe:
            isValidBlowerRuntimeProbeIntentIdentity(
              candidate.probe,
              requestItem.id,
              requestItem.targetDate
            )
              ? candidate.probe
              : null
        };
      }
    );


  return {
    items,
    lostCompetition:
      claimedCandidates.length !==
        candidates.length
  };
}


async function findBlowerRuntimeProbeAgentPrimaryContext(
  database,
  pollingNow,
  agentId
) {
  const queryResult =
    await database
      .prepare(`
        SELECT
          id,
          requested_by_id,
          requested_at,
          started_at,
          updated_at
        FROM ois_data_requests
        WHERE request_type = ?
          AND status = 'processing'
          AND agent_id = ?
          AND expires_at >= ?
          AND (
            substr(id, 1, 5) <> 'brb1_'
            OR (
              length(id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("id")}
              AND substr(id, 46, 2) = '00'
            )
          )
        ORDER BY started_at DESC, id ASC
        LIMIT 2
      `)
      .bind(
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
        agentId,
        pollingNow
      )
      .all();


  const rows =
    Array.isArray(
      queryResult?.results
    )
      ? queryResult.results
      : [];


  if (
    rows.length <
      1
  ) {
    return {
      ambiguous:
        false,
      row:
        null,
      groupMetadata:
        null
    };
  }


  const newestStartedAt =
    normalizeText(
      rows[0].started_at
    );


  if (
    rows.length >
      1 &&
    normalizeText(
      rows[1].started_at
    ) ===
      newestStartedAt
  ) {
    return {
      ambiguous:
        true,
      row:
        null,
      groupMetadata:
        null
    };
  }


  const groupMetadata =
    parseBlowerRuntimeProbeCreateGroupRequestId(
      rows[0].id
    );


  if (
    normalizeText(
      rows[0].id
    ).startsWith(
      "brb1_"
    ) &&
    !groupMetadata
  ) {
    return {
      ambiguous:
        true,
      row:
        null,
      groupMetadata:
        null
    };
  }


  return {
    ambiguous:
      false,
    row:
      rows[0],
    groupMetadata
  };
}


async function findReplayableBlowerRuntimeProbeBatch(
  database,
  pollingNow,
  limit,
  agentId,
  primaryContext
) {
  const primaryGroupId =
    primaryContext?.groupMetadata?.groupId ||
    "";


  const requestedById =
    normalizeText(
      primaryContext?.row?.requested_by_id
    );


  if (
    !primaryGroupId ||
    !requestedById
  ) {
    return [];
  }


  const queryResult =
    await database
      .prepare(`
        WITH grouped_requests AS (
          SELECT
            request.*,
            substr(request.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) AS probe_create_group_id,
            CAST(substr(request.id, 43, 2) AS INTEGER) AS probe_create_group_count,
            CAST(substr(request.id, 46, 2) AS INTEGER) AS probe_create_group_index
          FROM ois_data_requests AS request
          WHERE request.request_type = ?
            AND length(request.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("request.id")}
        ),

        replay_group AS (
          SELECT
            grouped.probe_create_group_id,
            grouped.requested_by_id,
            grouped.probe_create_group_count,
            MIN(grouped.requested_at) AS first_requested_at
          FROM grouped_requests AS grouped
          WHERE grouped.probe_create_group_id = ?
            AND grouped.requested_by_id = ?
          GROUP BY
            grouped.probe_create_group_id,
            grouped.requested_by_id,
            grouped.probe_create_group_count
          HAVING COUNT(*) = grouped.probe_create_group_count
            AND grouped.probe_create_group_count - 1 <= ?
            AND SUM(
              CASE
                WHEN grouped.status = 'processing'
                  AND grouped.expires_at >= ?
                  AND grouped.agent_id = ?
                  THEN 1
                ELSE 0
              END
            ) = grouped.probe_create_group_count
            AND SUM(
              CASE
                WHEN grouped.id = grouped.probe_create_group_id || '00'
                  THEN 1
                ELSE 0
              END
            ) = 1
          ORDER BY first_requested_at ASC, grouped.probe_create_group_id ASC
          LIMIT 1
        )

        SELECT
          request.*,
          intent.request_id AS probe_request_id,
          intent.schema_version AS probe_schema_version,
          intent.asset_tag AS probe_asset_tag,
          intent.dataparc_tag AS probe_dataparc_tag,
          intent.window_start AS probe_window_start,
          intent.window_end AS probe_window_end,
          intent.chunk_days AS probe_chunk_days,
          intent.chunk_count AS probe_chunk_count,
          intent.expected_last_replacement_at AS probe_expected_last_replacement_at,
          intent.expected_cycle_start_state AS probe_expected_cycle_start_state,
          intent.expected_cycle_started_at AS probe_expected_cycle_started_at,
          intent.expected_cycle_start_revision AS probe_expected_cycle_start_revision,
          intent.expected_cycle_runtime_revision AS probe_expected_cycle_runtime_revision
        FROM grouped_requests AS request
        INNER JOIN replay_group
          ON replay_group.probe_create_group_id = request.probe_create_group_id
          AND replay_group.requested_by_id = request.requested_by_id
        INNER JOIN blower_runtime_probe_intents_v4 AS intent
          ON intent.request_id = request.id
        ORDER BY request.probe_create_group_index ASC
      `)
      .bind(
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
        primaryGroupId,
        requestedById,
        limit,
        pollingNow,
        agentId
      )
      .all();


  const rows =
    Array.isArray(
      queryResult?.results
    )
      ? queryResult.results
      : [];


  if (
    rows.length <
      2
  ) {
    return [];
  }


  const groupMetadata =
    parseBlowerRuntimeProbeCreateGroupRequestId(
      rows[0]?.id
    );


  if (
    !groupMetadata ||
    groupMetadata.groupId !==
      primaryGroupId ||
    rows.length !==
      groupMetadata.expectedCount
  ) {
    return [];
  }


  const items = [];


  for (
    const row of
      rows
  ) {
    const rowGroup =
      parseBlowerRuntimeProbeCreateGroupRequestId(
        row.id
      );


    const requestItem =
      convertRequestRow(
        row
      );


    const probe =
      convertJoinedBlowerRuntimeProbeIntentRow(
        row
      );


    if (
      rowGroup?.groupId !==
        groupMetadata.groupId ||
      !isValidBlowerRuntimeProbeIntentIdentity(
        probe,
        requestItem.id,
        requestItem.targetDate
      )
    ) {
      return [];
    }


    if (
      rowGroup.itemIndex >
        0
    ) {
      items.push({
        ...requestItem,
        probe
      });
    }
  }


  return items;
}


async function handleAgentNextBlowerRuntimeProbeBatch(
  context,
  requestUrl
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const parsedLimit =
    parseBlowerRuntimeProbeBatchLimit(
      requestUrl
    );


  if (
    parsedLimit.error
  ) {
    return jsonResponse(
      {
        ok:
          false,
        message:
          parsedLimit.error
      },
      400
    );
  }


  await ensureOisQueuePerformanceIndexes(
    context.env.DB
  );


  await ensureBlowerRuntimeProbeSchema(
    context.env.DB
  );


  const pollingNow =
    new Date()
      .toISOString();


  const primaryContext =
    await findBlowerRuntimeProbeAgentPrimaryContext(
      context.env.DB,
      pollingNow,
      authentication.agentId
    );


  if (
    primaryContext.ambiguous
  ) {
    return jsonResponse(
      {
        ok:
          false,
        code:
          "BLOWER_RUNTIME_PROBE_PRIMARY_AMBIGUOUS",
        message:
          "Agent의 현재 Blower 기준 요청을 하나로 확정할 수 없어 단건 조회를 차단했습니다."
      },
      409
    );
  }


  const replayItems =
    await findReplayableBlowerRuntimeProbeBatch(
      context.env.DB,
      pollingNow,
      parsedLimit.limit,
      authentication.agentId,
      primaryContext
    );


  if (
    replayItems.length >
      0
  ) {
    return jsonResponse({
      ok:
        true,
      replayed:
        true,
      items:
        replayItems
    });
  }


  const claimedItems = [];


  for (
    let attempt = 0;
    attempt <
      MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_CLAIM_ATTEMPTS;
    attempt +=
      1
  ) {
    const remainingLimit =
      parsedLimit.limit -
      claimedItems.length;


    if (
      remainingLimit <
        1
    ) {
      break;
    }


    const pendingRows =
      await findPendingBlowerRuntimeProbeRows(
        context.env.DB,
        new Date().toISOString(),
        remainingLimit,
        authentication.agentId,
        primaryContext
          .groupMetadata
          ?.groupId ||
          ""
      );


    if (
      pendingRows.length <
        1
    ) {
      break;
    }


    const roundResult =
      await claimBlowerRuntimeProbeBatchRound(
        context.env.DB,
        pendingRows,
        authentication.agentId
      );


    claimedItems.push(
      ...roundResult.items
    );


    if (
      !roundResult.lostCompetition
    ) {
      break;
    }
  }


  const expectedGroupedAdditionalCount =
    primaryContext
      .groupMetadata
      ? primaryContext
          .groupMetadata
          .expectedCount -
        1
      : null;


  if (
    expectedGroupedAdditionalCount !==
      null &&
    expectedGroupedAdditionalCount >
      0 &&
    claimedItems.length !==
      expectedGroupedAdditionalCount
  ) {
    /*
      A durable browser create group must never fall through to the Agent's
      single-probe path. Recheck once for a concurrent same-Agent claim whose
      HTTP response may have been lost; otherwise retire every still-active
      member and return a non-compatibility status so the existing Agent stops.
    */
    const lateReplayItems =
      await findReplayableBlowerRuntimeProbeBatch(
        context.env.DB,
        new Date()
          .toISOString(),
        parsedLimit.limit,
        authentication.agentId,
        primaryContext
      );


    if (
      lateReplayItems.length ===
        expectedGroupedAdditionalCount
    ) {
      return jsonResponse({
        ok:
          true,
        replayed:
          true,
        items:
          lateReplayItems
      });
    }


    const failedAt =
      new Date()
        .toISOString();


    const errorMessage =
      "Blower 원자적 요청 묶음 상태가 변경되어 단건 조회를 차단했습니다.";


    await failActiveBlowerRuntimeProbeCreateGroup(
      context.env.DB,
      {
        requestId:
          primaryContext.row.id,
        groupMetadata:
          primaryContext.groupMetadata,
        agentId:
          authentication.agentId,
        errorMessage,
        failedAt
      }
    );


    return jsonResponse(
      {
        ok:
          false,
        code:
          "BLOWER_RUNTIME_PROBE_GROUP_CONFLICT",
        message:
          errorMessage
      },
      409
    );
  }


  return jsonResponse({
    ok:
      true,
    items:
      claimedItems
  });
}

/* =========================================================
  회사 PC가 다음 요청 가져오기

  지원 방식:

  1) 새 통합 조회
     ?action=next
     &requestTypes=water_environment,limestone_stock,...

     → 한 번의 HTTP 요청으로
       전달된 순서대로 7개 유형의 대기열을 확인한다.

  2) 기존 단일 유형 조회
     ?action=next
     &requestType=limestone_stock

     → 구버전 에이전트와의 호환을 유지한다.
========================================================= */

async function handleAgentNextRequest(
  context,
  requestUrl
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  await ensureOisQueuePerformanceIndexes(
    context.env.DB
  );


  const rawRequestedTypeOrder =
    requestUrl.searchParams.get(
      "requestTypes"
    );


  const requestedTypeOrder =
    normalizeRequestTypeList(
      rawRequestedTypeOrder
    );


  const rawLegacyRequestType =
    requestUrl.searchParams.get(
      "requestType"
    );


  const legacyRequestTypeText =
    normalizeText(
      rawLegacyRequestType
    );


  if (
    rawRequestedTypeOrder !==
      null
  ) {
    const rawRequestTypes =
      String(
        rawRequestedTypeOrder
      )
        .split(
          ","
        )
        .map(
          value => {
            return normalizeText(
              value
            )
              .toLowerCase()
              .replace(
                /[\s-]+/g,
                "_"
              );
          }
        );


    if (
      rawRequestTypes.some(
        requestType => {
          return (
            !requestType ||
            !OIS_REQUEST_TYPES.includes(
              requestType
            )
          );
        }
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "requestTypes에 허용되지 않은 OIS 요청 유형이 포함되어 있습니다."
        },
        400
      );
    }
  }


  const legacyRequestType =
    legacyRequestTypeText
      ? normalizeRequestType(
          legacyRequestTypeText
        )
      : "";


  if (
    rawLegacyRequestType !==
      null &&
    (
      !legacyRequestTypeText ||
      !legacyRequestType
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "requestType에 허용되지 않은 OIS 요청 유형이 지정되었습니다."
      },
      400
    );
  }


  const requestTypes =
    requestedTypeOrder.length >
      0
      ? requestedTypeOrder
      : legacyRequestTypeText
        ? [
            legacyRequestType
          ]
        : [
            ...OIS_REQUEST_TYPES
          ];


  /*
    requestTypes 순서를 문자열 위치로 사용한다.

    예:
    ,water_environment,limestone_stock,silo_level,

    SQLite instr() 결과가 작은 유형을 먼저 선택하므로
    에이전트가 보내 준 순환 우선순위를 그대로 보존할 수 있다.
  */
  const requestTypeOrderKey =
    `,${requestTypes.join(",")},`;

  const pollingNow =
    new Date()
      .toISOString();


  /*
    동시에 여러 PC가 요청을 가져가더라도
    한 대만 processing 상태로 바꾸도록 한다.
  */
  for (
    let attempt = 0;
    attempt <
      3;
    attempt +=
      1
  ) {
    const pendingRow =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM ois_data_requests

          WHERE
            status = 'pending'

            AND expires_at >= ?

            AND instr(
              ?,
              ',' || request_type || ','
            ) >
              0

            AND (
              request_type <> '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
              OR substr(id, 1, 5) <> 'brb1_'
            )

          ORDER BY
            instr(
              ?,
              ',' || request_type || ','
            ) ASC,

            requested_at ASC

          LIMIT 1
        `)
        .bind(
          pollingNow,
          requestTypeOrderKey,
          requestTypeOrderKey
        )
        .first();


    if (
      !pendingRow
    ) {
      return jsonResponse({
        ok:
          true,

        item:
          null,

        checkedRequestTypes:
          requestTypes,

        message:
          "처리할 OIS 요청이 없습니다."
      });
    }


    const requestId =
      normalizeText(
        pendingRow.id
      );


    /*
      요청을 실제로 가져온 시점부터
      처리 제한시간을 새로 계산한다.
    */
    const processingStartedAt =
      new Date();


    const processingStartedAtText =
      processingStartedAt.toISOString();


    const processingExpiresAtText =
      new Date(
        processingStartedAt.getTime() +
        (
          getRequestProcessingTimeoutMinutes(
            pendingRow.request_type
          ) *
          60 *
          1000
        )
      )
        .toISOString();


    const updateResult =
      await context.env.DB
        .prepare(`
          UPDATE ois_data_requests

          SET
            status = 'processing',
            started_at = ?,
            agent_id = ?,
            expires_at = ?,
            updated_at = ?

          WHERE
            id = ?
            AND status = 'pending'
            AND (
              request_type <> '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
              OR substr(id, 1, 5) <> 'brb1_'
            )
            AND NOT EXISTS (SELECT 1 FROM ois_data_requests AS restart_guard
              WHERE restart_guard.request_type='cofiring_restart_guard' AND restart_guard.status='guard'
                AND restart_guard.agent_id=? AND restart_guard.expires_at>?)
        `)
        .bind(
          processingStartedAtText,
          authentication.agentId,
          processingExpiresAtText,
          processingStartedAtText,
          requestId,
          authentication.agentId,
          processingStartedAtText
        )
        .run();


    if (
      Number(
        updateResult?.meta?.changes
      ) !==
        1
    ) {
      continue;
    }


    const claimedRequest =
      await findRequestById(
        context.env.DB,
        requestId
      );


    return jsonResponse({
      ok:
        true,

      item:
        claimedRequest,

      checkedRequestTypes:
        requestTypes
    });
  }


  return jsonResponse({
    ok:
      true,

    item:
      null,

    checkedRequestTypes:
      requestTypes,

    message:
      "다른 OIS 연동 프로그램이 요청을 먼저 처리했습니다."
  });
}

/* =========================================================
  회사 PC가 OIS · Excel 두 실행 레인을 한 번에 가져오기

  중요:
  - HTTP 폴링 요청은 기존처럼 한 번만 사용한다.
  - OIS 레인과 Excel 레인은 각각 최대 한 건만 가져온다.
  - OIS 요청끼리는 병렬로 가져오지 않는다.
  - 기존 action=next는 구버전 에이전트를 위해 유지한다.
========================================================= */

const OIS_AGENT_OIS_LANE_REQUEST_TYPES = [
  "water_environment",
  "limestone_stock",
  "turbine_gear_pinion",
  "silo_level",
  "bed_ash_level",
  "auxiliary_materials",
  "logsheet_approval",
  "fbhe_vibration",
  "seal_pot_runtime"
];


const OIS_AGENT_EXCEL_LANE_REQUEST_TYPES = [
  "cofiring_daily",
  "cofiring_period",
  "daily_data_excel",
  "organic_silo_dataparc",
  "steam_status",
  "logsheet_pdf",
  BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
  "open_final_excel_folder"
];


function normalizeAgentLaneRequestTypes(
  value,
  allowedRequestTypes,
  parameterName
) {
  const allowedRequestTypeSet =
    new Set(
      allowedRequestTypes
    );


  /*
    파라미터가 아예 없을 때만 전체 레인을 기본값으로 쓴다.

    `?oisRequestTypes=`처럼 명시됐지만 비어 있는 값까지
    전체 허용으로 넓히면 호출자의 오타가 요청 범위를
    예상보다 크게 만들 수 있으므로 아래 검증에서 거부한다.
  */
  if (
    value ===
      null ||
    typeof value ===
      "undefined"
  ) {
    return {
      ok:
        true,

      requestTypes: [
        ...allowedRequestTypes
      ]
    };
  }


  const requestedTypes = [];


  const seenRequestTypes =
    new Set();


  const rawRequestTypes =
    String(
      value
    )
      .split(
        ","
      )
      .map(
        rawRequestType => {
          return normalizeText(
            rawRequestType
          )
            .toLowerCase()
            .replace(
              /[\s-]+/g,
              "_"
            );
        }
      );


  if (
    rawRequestTypes.length ===
      0
  ) {
    return {
      ok:
        false,

      message:
        `${parameterName}에 허용되지 않은 요청 유형이 포함되어 있습니다.`
    };
  }


  for (
    const requestType of
    rawRequestTypes
  ) {
    if (
      !requestType ||
      !OIS_REQUEST_TYPES.includes(
        requestType
      ) ||
      !allowedRequestTypeSet.has(
        requestType
      )
    ) {
      return {
        ok:
          false,

        message:
          `${parameterName}에 허용되지 않은 요청 유형이 포함되어 있습니다.`
      };
    }


    if (
      seenRequestTypes.has(
        requestType
      )
    ) {
      continue;
    }


    seenRequestTypes.add(
      requestType
    );


    requestedTypes.push(
      requestType
    );
  }


  return {
    ok:
      true,

    requestTypes:
      requestedTypes
  };
}


async function findNextOisAgentLaneCandidates(
  database,
  oisRequestTypes,
  excelRequestTypes,
  includeOisLane =
    true,
  includeExcelLane =
    true
) {
  const oisRequestTypeOrderKey =
    `,${oisRequestTypes.join(",")},`;


  const excelRequestTypeOrderKey =
    `,${excelRequestTypes.join(",")},`;

  const pollingNow =
    new Date()
      .toISOString();


  /*
    OIS와 Excel 후보를 CTE 한 SELECT로 함께 찾는다.

    대기 요청이 없는 평상시에는 기존 action=next와 같이
    후보 SELECT가 정확히 한 번만 실행된다.
  */
  const queryResult =
    await database
      .prepare(`
        WITH
          ois_candidate AS (
            SELECT
              'ois' AS claim_lane,
              request.*

            FROM ois_data_requests
              AS request

            WHERE
              ? = 1
              AND request.status = 'pending'
              AND request.expires_at >= ?

              AND instr(
                ?,
                ',' || request.request_type || ','
              ) >
                0

            ORDER BY
              instr(
                ?,
                ',' || request.request_type || ','
              ) ASC,

              request.requested_at ASC

            LIMIT 1
          ),

          excel_candidate AS (
            SELECT
              'excel' AS claim_lane,
              request.*

            FROM ois_data_requests
              AS request

            WHERE
              ? = 1
              AND request.status = 'pending'
              AND request.expires_at >= ?

              AND instr(
                ?,
                ',' || request.request_type || ','
              ) >
                0

              AND (
                request.request_type <> '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                OR substr(request.id, 1, 5) <> 'brb1_'
                OR (
                  length(request.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("request.id")}
                  AND substr(request.id, 46, 2) = '00'
                )
              )

            ORDER BY
              instr(
                ?,
                ',' || request.request_type || ','
              ) ASC,

              request.requested_at ASC,
              request.id ASC

            LIMIT 1
          )

        SELECT
          *

        FROM ois_candidate

        UNION ALL

        SELECT
          *

        FROM excel_candidate
      `)
      .bind(
        includeOisLane
          ? 1
          : 0,
        pollingNow,
        oisRequestTypeOrderKey,
        oisRequestTypeOrderKey,
        includeExcelLane
          ? 1
          : 0,
        pollingNow,
        excelRequestTypeOrderKey,
        excelRequestTypeOrderKey
      )
      .all();


  const rows =
    Array.isArray(
      queryResult?.results
    )
      ? queryResult.results
      : [];


  return {
    ois:
      rows.find(
        row => {
          return normalizeText(
            row?.claim_lane
          ) ===
            "ois";
        }
      ) ||
      null,

    excel:
      rows.find(
        row => {
          return normalizeText(
            row?.claim_lane
          ) ===
            "excel";
        }
      ) ||
      null
  };
}


async function failInvalidBlowerRuntimeProbeClaimCandidate(
  database,
  pendingRow,
  groupMetadata,
  agentId,
  failedAt
) {
  const requestId =
    normalizeText(
      pendingRow?.id
    );


  const requestedById =
    normalizeText(
      pendingRow?.requested_by_id
    );


  const groupId =
    groupMetadata?.groupId ||
    "";


  const errorMessage =
    "DataPARC Blower 요청 의도가 없거나 요청 스냅샷과 일치하지 않습니다.";


  const results =
    await database.batch([
      database
        .prepare(`
          UPDATE ois_data_requests
          SET
            status = 'failed',
            completed_at = ?,
            agent_id = ?,
            error_message = ?,
            updated_at = ?
          WHERE request_type = ?
            AND status = 'pending'
            AND (
              (? = '' AND id = ?)
              OR (
                ? <> ''
                AND requested_by_id = ?
                AND length(id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("id")}
                AND substr(id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = ?
                AND NOT EXISTS (
                  SELECT 1
                  FROM ois_data_requests AS active_sibling
                  WHERE active_sibling.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                    AND active_sibling.requested_by_id = ?
                    AND length(active_sibling.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("active_sibling.id")}
                    AND substr(active_sibling.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = ?
                    AND active_sibling.status = 'processing'
                    AND active_sibling.expires_at >= ?
                )
              )
            )
        `)
        .bind(
          failedAt,
          agentId,
          errorMessage,
          failedAt,
          BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
          groupId,
          requestId,
          groupId,
          requestedById,
          groupId,
          requestedById,
          groupId,
          failedAt
        ),
      database
        .prepare(`
          UPDATE blower_runtime_probe_intents_v4
          SET
            reuse_key = NULL,
            updated_at = ?
          WHERE request_id IN (
            SELECT id
            FROM ois_data_requests
            WHERE request_type = ?
              AND status = 'failed'
              AND error_message = ?
              AND updated_at = ?
          )
        `)
        .bind(
          failedAt,
          BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
          errorMessage,
          failedAt
        )
    ]);


  return Number(
    results?.[0]?.meta?.changes
  ) >
    0;
}


async function claimOisAgentLaneCandidate(
  database,
  pendingRow,
  agentId
) {
  if (
    !pendingRow
  ) {
    return null;
  }


  const requestId =
    normalizeText(
      pendingRow.id
    );


  const requestType =
    normalizeText(
      pendingRow.request_type
    );


  const reservedGroupNamespace =
    requestId.startsWith(
      "brb1_"
    );


  const groupMetadata =
    parseBlowerRuntimeProbeCreateGroupRequestId(
      requestId
    );


  let blowerProbe =
    null;


  if (
    requestType ===
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE
  ) {
    if (
      reservedGroupNamespace &&
      (
        !groupMetadata ||
        groupMetadata.itemIndex !==
          0
      )
    ) {
      if (
        !groupMetadata
      ) {
        await failInvalidBlowerRuntimeProbeClaimCandidate(
          database,
          pendingRow,
          null,
          agentId,
          new Date()
            .toISOString()
        );
      }


      return null;
    }


    /* Read and validate the immutable intent before any queue mutation. */
    blowerProbe =
      await findBlowerRuntimeProbeIntent(
        database,
        requestId
      );


    const requestItem =
      convertRequestRow(
        pendingRow
      );


    if (
      !isValidBlowerRuntimeProbeIntentIdentity(
        blowerProbe,
        requestItem.id,
        requestItem.targetDate
      )
    ) {
      await failInvalidBlowerRuntimeProbeClaimCandidate(
        database,
        pendingRow,
        groupMetadata,
        agentId,
        new Date()
          .toISOString()
      );


      return null;
    }
  }


  const processingStartedAt =
    new Date();


  const processingStartedAtText =
    processingStartedAt.toISOString();


  const processingExpiresAtText =
    new Date(
      processingStartedAt.getTime() +
      (
        getRequestProcessingTimeoutMinutes(
          pendingRow.request_type
        ) *
        60 *
        1000
      )
    )
      .toISOString();


  const blowerIntentClaimGuard =
    requestType ===
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE
      ? `AND EXISTS (
          SELECT 1
          FROM blower_runtime_probe_intents_v4 AS intent
          WHERE intent.request_id = ois_data_requests.id
            AND intent.schema_version = ?
            AND intent.asset_tag = ?
            AND intent.dataparc_tag = ?
            AND intent.window_start = ?
            AND intent.window_end = ?
            AND intent.chunk_days = ?
            AND intent.chunk_count = ?
            AND intent.expected_last_replacement_at = ?
            AND COALESCE(intent.expected_cycle_start_state, '') = ?
            AND COALESCE(intent.expected_cycle_started_at, '') = ?
            AND COALESCE(intent.expected_cycle_start_revision, '') = ?
            AND COALESCE(intent.expected_cycle_runtime_revision, '') = ?
        )`
      : "";


  const blowerIntentClaimBindings =
    requestType ===
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE
      ? [
          blowerProbe.schemaVersion,
          blowerProbe.assetTag,
          blowerProbe.dataParcTag,
          blowerProbe.startAt,
          blowerProbe.endAt,
          blowerProbe.chunkDays,
          blowerProbe.chunkCount,
          blowerProbe.expectedLastReplacementAt,
          blowerProbe.expectedCycleStartState,
          blowerProbe.expectedCycleStartedAt,
          blowerProbe.expectedCycleStartRevision,
          blowerProbe.expectedCycleRuntimeRevision
        ]
      : [];


  const blowerExistingPrimaryGuard =
    requestType ===
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE
      ? `AND NOT EXISTS (
          SELECT 1
          FROM ois_data_requests AS active_agent_primary
          WHERE active_agent_primary.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
            AND active_agent_primary.status = 'processing'
            AND active_agent_primary.agent_id = ?
            AND active_agent_primary.expires_at >= ?
        )`
      : "";


  const blowerExistingPrimaryBindings =
    requestType ===
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE
      ? [
          agentId,
          processingStartedAtText
        ]
      : [];


  /*
    다른 에이전트와 동시에 실행되더라도
    status='pending' 조건부 UPDATE에 성공한 한 곳만
    해당 요청을 가져간다.
  */
  const updateResult =
    await database
      .prepare(`
        UPDATE ois_data_requests

        SET
          status = 'processing',
          started_at = ?,
          agent_id = ?,
          expires_at = ?,
          updated_at = ?

        WHERE
          id = ?
          AND request_type = ?
          AND status = 'pending'
          AND expires_at >= ?
          AND (
            ? = ''
            OR (
              id = ? || '00'
              AND requested_by_id = ?
              AND ? = (
                SELECT COUNT(*)
                FROM ois_data_requests AS group_pending
                WHERE group_pending.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                  AND group_pending.requested_by_id = ?
                  AND length(group_pending.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("group_pending.id")}
                  AND substr(group_pending.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = ?
                  AND group_pending.status = 'pending'
                  AND group_pending.expires_at >= ?
              )
              AND NOT EXISTS (
                SELECT 1
                FROM ois_data_requests AS group_processing
                WHERE group_processing.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                  AND group_processing.requested_by_id = ?
                  AND length(group_processing.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("group_processing.id")}
                  AND substr(group_processing.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = ?
                  AND group_processing.status = 'processing'
                  AND group_processing.expires_at >= ?
              )
            )
          )
          ${blowerExistingPrimaryGuard}
          ${blowerIntentClaimGuard}
          AND NOT EXISTS (SELECT 1 FROM ois_data_requests AS restart_guard
            WHERE restart_guard.request_type='cofiring_restart_guard' AND restart_guard.status='guard'
              AND restart_guard.agent_id=? AND restart_guard.expires_at>?)
      `)
      .bind(
        processingStartedAtText,
        agentId,
        processingExpiresAtText,
        processingStartedAtText,
        requestId,
        requestType,
        processingStartedAtText,
        groupMetadata?.groupId ||
          "",
        groupMetadata?.groupId ||
          "",
        normalizeText(
          pendingRow.requested_by_id
        ),
        groupMetadata?.expectedCount ||
          1,
        normalizeText(
          pendingRow.requested_by_id
        ),
        groupMetadata?.groupId ||
          "",
        processingStartedAtText,
        normalizeText(
          pendingRow.requested_by_id
        ),
        groupMetadata?.groupId ||
          "",
        processingStartedAtText,
        ...blowerExistingPrimaryBindings,
        ...blowerIntentClaimBindings,
        agentId,
        processingStartedAtText
      )
      .run();


  if (
    Number(
      updateResult?.meta?.changes
    ) !==
      1
  ) {
    return null;
  }


  /*
    조건부 UPDATE가 성공한 뒤 별도 SELECT를 하지 않는다.

    UPDATE 후 재조회만 실패하여 이미 가져간 요청을
    응답하지 못하는 고아 처리 상태를 줄이기 위해,
    방금 선택한 행에 처리 정보를 반영해 즉시 반환한다.
  */
  const claimedRequest =
    convertRequestRow({
      ...pendingRow,

      status:
        "processing",

      started_at:
        processingStartedAtText,

      agent_id:
        agentId,

      expires_at:
        processingExpiresAtText,

      updated_at:
        processingStartedAtText
    });


  return requestType ===
    BLOWER_RUNTIME_PROBE_REQUEST_TYPE
    ? {
        ...claimedRequest,
        probe:
          blowerProbe
      }
    : claimedRequest;
}


function getOisAgentLaneErrorMessage(
  reason,
  fallbackMessage
) {
  return (
    normalizeText(
      reason instanceof
        Error
        ? reason.message
        : reason
    ) ||
    fallbackMessage
  );
}


async function handleAgentNextLaneRequests(
  context,
  requestUrl
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const oisRequestTypeResult =
    normalizeAgentLaneRequestTypes(
      requestUrl.searchParams.get(
        "oisRequestTypes"
      ),
      OIS_AGENT_OIS_LANE_REQUEST_TYPES,
      "oisRequestTypes"
    );


  const excelRequestTypeResult =
    normalizeAgentLaneRequestTypes(
      requestUrl.searchParams.get(
        "excelRequestTypes"
      ),
      OIS_AGENT_EXCEL_LANE_REQUEST_TYPES,
      "excelRequestTypes"
    );


  if (
    !oisRequestTypeResult.ok ||
    !excelRequestTypeResult.ok
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          oisRequestTypeResult.message ||
          excelRequestTypeResult.message ||
          "에이전트 레인 요청 유형을 확인해 주세요."
      },
      400
    );
  }


  const oisRequestTypes =
    oisRequestTypeResult
      .requestTypes;


  const excelRequestTypes =
    excelRequestTypeResult
      .requestTypes;


  await ensureOisQueuePerformanceIndexes(
    context.env.DB
  );


  const items = {
    ois:
      null,

    excel:
      null
  };


  const laneErrors = {
    ois:
      "",

    excel:
      ""
  };


  const unresolvedLanes = {
    ois:
      true,

    excel:
      true
  };


  /*
    첫 시도는 후보 SELECT 한 번으로 두 lane을 함께 찾는다.

    조건부 UPDATE 경쟁에서 진 lane만 최대 두 번 다시 찾고,
    이미 성공한 lane은 추가 요청을 가져오지 않는다.
  */
  for (
    let attempt = 0;
    attempt <
      3 &&
      (
        unresolvedLanes.ois ||
        unresolvedLanes.excel
      );
    attempt +=
      1
  ) {
    let candidates;


    try {
      candidates =
        await findNextOisAgentLaneCandidates(
          context.env.DB,
          oisRequestTypes,
          excelRequestTypes,
          unresolvedLanes.ois,
          unresolvedLanes.excel
        );

    } catch (
      error
    ) {
      /*
        후보 SELECT는 어느 행도 processing으로 바꾸지 않는다.
        이전 반복에서 성공한 item이 있다면 그대로 응답하고,
        아직 해결되지 않은 lane에만 오류를 기록한다.
      */
      if (
        unresolvedLanes.ois
      ) {
        laneErrors.ois =
          getOisAgentLaneErrorMessage(
            error,
            "OIS 레인 후보를 찾지 못했습니다."
          );


        unresolvedLanes.ois =
          false;
      }


      if (
        unresolvedLanes.excel
      ) {
        laneErrors.excel =
          getOisAgentLaneErrorMessage(
            error,
            "Excel 레인 후보를 찾지 못했습니다."
          );


        unresolvedLanes.excel =
          false;
      }


      break;
    }


    const claimLaneNames = [];


    const claimPromises = [];


    [
      "ois",
      "excel"
    ]
      .forEach(
        laneName => {
          if (
            !unresolvedLanes[
              laneName
            ]
          ) {
            return;
          }


          const candidate =
            candidates[
              laneName
            ];


          if (
            !candidate
          ) {
            unresolvedLanes[
              laneName
            ] =
              false;


            return;
          }


          claimLaneNames.push(
            laneName
          );


          claimPromises.push(
            claimOisAgentLaneCandidate(
              context.env.DB,
              candidate,
              authentication.agentId
            )
          );
        }
      );


    if (
      claimPromises.length ===
        0
    ) {
      break;
    }


    const claimResults =
      await Promise.allSettled(
        claimPromises
      );


    claimResults.forEach(
      (
        claimResult,
        claimIndex
      ) => {
        const laneName =
          claimLaneNames[
            claimIndex
          ];


        if (
          claimResult.status ===
            "rejected"
        ) {
          laneErrors[
            laneName
          ] =
            getOisAgentLaneErrorMessage(
              claimResult.reason,
              laneName ===
                "ois"
                ? "OIS 레인 요청을 가져오지 못했습니다."
                : "Excel 레인 요청을 가져오지 못했습니다."
            );


          unresolvedLanes[
            laneName
          ] =
            false;


          return;
        }


        if (
          claimResult.value
        ) {
          items[
            laneName
          ] =
            claimResult.value;


          unresolvedLanes[
            laneName
          ] =
            false;
        }


        /*
          value가 null이면 다른 agent가 먼저 UPDATE한 경쟁이다.
          이 lane만 다음 반복의 통합 SELECT에서 다시 찾는다.
        */
      }
    );
  }


  return jsonResponse({
    ok:
      true,

    items,

    checkedRequestTypes: {
      ois:
        oisRequestTypes,

      excel:
        excelRequestTypes
    },

    laneErrors
  });
}

/* =========================================================
  오전회의 자동수치 수동 보정값 테이블

  - OIS 원본 자료는 변경하지 않는다.
  - 날짜별 수동 보정값만 JSON으로 저장한다.
  - revision으로 동시 수정 충돌을 방지한다.
========================================================= */

async function ensureMorningMeetingAutoHistoryOverridesTable(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        morning_meeting_auto_history_overrides (
          target_date TEXT PRIMARY KEY,

          values_json TEXT NOT NULL
            DEFAULT '{}',

          created_by_id TEXT NOT NULL
            DEFAULT '',

          created_by_name TEXT NOT NULL
            DEFAULT '',

          created_at TEXT NOT NULL,

          updated_by_id TEXT NOT NULL
            DEFAULT '',

          updated_by_name TEXT NOT NULL
            DEFAULT '',

          updated_at TEXT NOT NULL,

          revision INTEGER NOT NULL
            DEFAULT 1

          ,reset_active INTEGER NOT NULL
            DEFAULT 0

          ,reset_at TEXT NOT NULL
            DEFAULT ''

          ,reset_by_id TEXT NOT NULL
            DEFAULT ''

          ,reset_by_name TEXT NOT NULL
            DEFAULT ''

          ,reset_snapshot_values_json TEXT NOT NULL
            DEFAULT ''

          ,reset_restored_at TEXT NOT NULL
            DEFAULT ''
        )
    `)
    .run();


  /*
    기존 D1에는 위 CREATE TABLE이 다시 실행되어도 새 열이 생기지 않는다.
    최초 접근 시 필요한 열만 추가하고, 여러 요청이 동시에 접근해
    duplicate column 경쟁이 난 경우에는 이미 완료된 것으로 본다.
  */
  const tableInfo =
    await database
      .prepare(`
        PRAGMA table_info(
          morning_meeting_auto_history_overrides
        )
      `)
      .all();


  const columnNames =
    new Set(
      (
        Array.isArray(
          tableInfo.results
        )
          ? tableInfo.results
          : []
      ).map(
        column =>
          normalizeText(
            column.name
          )
      )
    );


  const missingColumnDefinitions =
    [
      [
        "reset_active",
        "reset_active INTEGER NOT NULL DEFAULT 0"
      ],
      [
        "reset_at",
        "reset_at TEXT NOT NULL DEFAULT ''"
      ],
      [
        "reset_by_id",
        "reset_by_id TEXT NOT NULL DEFAULT ''"
      ],
      [
        "reset_by_name",
        "reset_by_name TEXT NOT NULL DEFAULT ''"
      ],
      [
        "reset_snapshot_values_json",
        "reset_snapshot_values_json TEXT NOT NULL DEFAULT ''"
      ],
      [
        "reset_restored_at",
        "reset_restored_at TEXT NOT NULL DEFAULT ''"
      ]
    ].filter(
      ([columnName]) =>
        !columnNames.has(
          columnName
        )
    );


  for (
    const [
      ,
      columnDefinition
    ] of missingColumnDefinitions
  ) {
    try {
      await database
        .prepare(`
          ALTER TABLE
            morning_meeting_auto_history_overrides
          ADD COLUMN
            ${columnDefinition}
        `)
        .run();

    } catch (
      error
    ) {
      const message =
        normalizeText(
          error instanceof Error
            ? error.message
            : error
        );


      if (
        !/duplicate column name/i.test(
          message
        )
      ) {
        throw error;
      }
    }
  }
}


const MORNING_MEETING_AUTO_HISTORY_RESET_REQUEST_TYPES =
  Object.freeze([
    "water_environment",
    "limestone_stock",
    "turbine_gear_pinion",
    "silo_level",
    "daily_data_excel",
    "organic_silo_dataparc",
    "steam_status"
  ]);

const MORNING_MEETING_AUTO_HISTORY_OVERRIDE_FIELD_NAMES =
  Object.freeze([
    "waterRawWaterInflow",
    "waterDemiProduction",
    "waterPureWaterUsage",

    "limestoneUnitOneUsage",
    "limestoneUnitTwoUsage",

    "gearWheel",
    "pinion",

    "flyAshSiloLevel",
    "bioStorageSiloLevel",

    "smpMinimum",
    "smpMaximum",
    "smpWeightedAverage",

    "steamSales",
    "steamProduction",

    "powerProduction",
    "powerSales",

    "powerSolar",
    "powerSolarMonthly",
    "powerSolarYearly",

    "organicTruckCount",
    "organicReceivedAmount",
    "organicStoredAmount"
  ]);

/* =========================================================
  오전회의 자동수치 수동 보정값 정리

  - 화면에서 수정 가능한 수치만 저장한다.
  - 빈칸은 null로 저장한다.
  - 쉼표가 포함된 숫자도 허용한다.
  - 음수나 비정상적으로 큰 값은 차단한다.
========================================================= */

function normalizeMorningMeetingAutoHistoryOverrideValues(
  rawValues
) {
  const maximumNumber =
    1000000000000;

  const maximumTextLength =
    100;

  const plainNumberPattern =
    /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;

  const commaNumberPattern =
    /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

  if (
    rawValues === null ||
    typeof rawValues !==
      "object" ||
    Array.isArray(
      rawValues
    )
  ) {
    throw new Error(
      "자동수치 수정값 형식을 확인해 주세요."
    );
  }

  const normalizedValues =
    {};

  const normalizeNumber = (
    value,
    fieldName
  ) => {
    if (
      !Number.isFinite(
        value
      ) ||
      value < 0 ||
      value >
        maximumNumber
    ) {
      throw new Error(
        `${fieldName} 값은 0 이상 1조 이하의 숫자로 입력해 주세요.`
      );
    }

    /*
      -0은 일반 0으로 저장한다.
    */
    return Object.is(
      value,
      -0
    )
      ? 0
      : value;
  };

  MORNING_MEETING_AUTO_HISTORY_OVERRIDE_FIELD_NAMES.forEach(
    fieldName => {
      if (
        !Object.prototype
          .hasOwnProperty.call(
            rawValues,
            fieldName
          )
      ) {
        return;
      }

      const rawValue =
        rawValues[
          fieldName
        ];

      /*
        빈 입력은 명시적 null 수정값이다.
      */
      if (
        rawValue === null ||
        rawValue === undefined
      ) {
        normalizedValues[
          fieldName
        ] =
          null;

        return;
      }

      if (
        typeof rawValue ===
          "number"
      ) {
        normalizedValues[
          fieldName
        ] =
          normalizeNumber(
            rawValue,
            fieldName
          );

        return;
      }

      /*
        boolean, 객체, 배열은
        문자열로 강제 변환하지 않는다.
      */
      if (
        typeof rawValue !==
          "string"
      ) {
        throw new Error(
          `${fieldName} 수정값 형식을 확인해 주세요.`
        );
      }

      const text =
        rawValue.trim();

      if (
        text === ""
      ) {
        normalizedValues[
          fieldName
        ] =
          null;

        return;
      }

      if (
        text.length >
          maximumTextLength
      ) {
        throw new Error(
          `${fieldName} 수정값은 100자 이하로 입력해 주세요.`
        );
      }

      const isNumericText =
        plainNumberPattern.test(
          text
        ) ||
        commaNumberPattern.test(
          text
        );

      /*
        숫자 형식이 아니면
        "정비중", "조회불가" 같은 문구로 저장한다.
      */
      if (
        !isNumericText
      ) {
        normalizedValues[
          fieldName
        ] =
          text;

        return;
      }

      const numericValue =
        Number(
          text.replace(
            /,/g,
            ""
          )
        );

      normalizedValues[
        fieldName
      ] =
        normalizeNumber(
          numericValue,
          fieldName
        );
    }
  );

  return normalizedValues;
}

/* =========================================================
  오전회의 자동수치 수정값 JSON 원문 읽기

  - 저장/복원 시 현재 화면이 모르는 레거시·향후 키도
    그대로 보존한다.
  - API 응답에는 아래 convert 함수가 허용된 키만 노출한다.
========================================================= */

function parseMorningMeetingAutoHistoryOverrideRawValues(
  row
) {
  if (
    !row
  ) {
    return {};
  }

  const valuesText =
    normalizeText(
      row.values_json
    );

  const values =
    valuesText
      ? JSON.parse(
          valuesText
        )
      : {};

  if (
    values === null ||
    typeof values !==
      "object" ||
    Array.isArray(
      values
    )
  ) {
    throw new Error(
      "저장된 자동수치 수정값 형식을 확인해 주세요."
    );
  }

  return values;
}

/* =========================================================
  오전회의 자동수치 수동 보정 DB 행 → API 응답

  - 손상된 날짜나 JSON 행은 제외한다.
  - 한 건의 오류가 월 전체 조회를 막지 않게 한다.
========================================================= */

function convertMorningMeetingAutoHistoryOverrideRow(
  row
) {
  if (
    !row
  ) {
    return null;
  }


  const targetDate =
    normalizeText(
      row.target_date
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return null;
  }


  let rawValues;


  try {
    rawValues =
      parseMorningMeetingAutoHistoryOverrideRawValues(
        row
      );

  } catch {
    return null;
  }


  let values;


  try {
    values =
      normalizeMorningMeetingAutoHistoryOverrideValues(
        rawValues
      );

  } catch {
    return null;
  }


  const revisionValue =
    Number(
      row.revision
    );


  return {
    targetDate,

    values,

    createdById:
      normalizeText(
        row.created_by_id
      ),

    createdByName:
      normalizeText(
        row.created_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedById:
      normalizeText(
        row.updated_by_id
      ),

    updatedByName:
      normalizeText(
        row.updated_by_name
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    revision:
      Number.isInteger(
        revisionValue
      ) &&
      revisionValue >
        0
        ? revisionValue
        : 1
  };
}


function getMorningMeetingAutoHistoryOverrideRevision(
  row
) {
  if (
    !row
  ) {
    return 0;
  }


  const revision =
    Number(
      row.revision
    );


  return Number.isInteger(
    revision
  ) &&
  revision >
    0
    ? revision
    : 1;
}


/* =========================================================
  오전회의 선택일 초기화 상태 공개 형태

  - snapshot 원문은 서버 내부 복구용이므로 절대 응답하지 않는다.
  - 행이 아직 없으면 revision 0의 비활성 상태를 반환한다.
========================================================= */

function convertMorningMeetingAutoHistoryResetRow(
  row,
  fallbackTargetDate = ""
) {
  const targetDate =
    normalizeText(
      row?.target_date ||
      fallbackTargetDate
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return null;
  }


  return {
    targetDate,

    active:
      Number(
        row?.reset_active ||
        0
      ) === 1,

    resetAt:
      normalizeText(
        row?.reset_at
      ),

    resetById:
      normalizeText(
        row?.reset_by_id
      ),

    resetByName:
      normalizeText(
        row?.reset_by_name
      ),

    restoredAt:
      normalizeText(
        row?.reset_restored_at
      ),

    revision:
      getMorningMeetingAutoHistoryOverrideRevision(
        row
      )
  };
}


async function findMorningMeetingAutoHistoryResets(
  database,
  startDate,
  endDate
) {
  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    ) ||
    startDate >
      endDate
  ) {
    return [];
  }


  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );


  const queryResult =
    await database
      .prepare(`
        SELECT
          target_date,
          reset_active,
          reset_at,
          reset_by_id,
          reset_by_name,
          reset_restored_at,
          revision

        FROM
          morning_meeting_auto_history_overrides

        WHERE
          target_date >= ?
          AND target_date <= ?
          AND (
            reset_active = 1
            OR TRIM(reset_at) <> ''
            OR TRIM(reset_restored_at) <> ''
          )

        ORDER BY
          target_date DESC
      `)
      .bind(
        startDate,
        endDate
      )
      .all();


  return (
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : []
  )
    .map(
      row =>
        convertMorningMeetingAutoHistoryResetRow(
          row
        )
    )
    .filter(
      Boolean
    );
}



/* =========================================================
  오전회의 자동수치 수동 보정값 기간 조회

  - 기존 completed_history 요청 내부에서 사용한다.
  - 브라우저의 API 요청 횟수는 증가하지 않는다.
========================================================= */

async function findMorningMeetingAutoHistoryOverrides(
  database,
  startDate,
  endDate
) {
  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    ) ||
    startDate >
      endDate
  ) {
    return [];
  }


  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );


  const queryResult =
    await database
      .prepare(`
        SELECT
          *

        FROM
          morning_meeting_auto_history_overrides

        WHERE
          target_date >= ?
          AND target_date <= ?

        ORDER BY
          target_date DESC
      `)
      .bind(
        startDate,
        endDate
      )
      .all();


  return (
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : []
  )
    .map(
      convertMorningMeetingAutoHistoryOverrideRow
    )
    .filter(
      Boolean
    );
}

async function saveMorningMeetingAutoHistoryOverride(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );

  if (
    authentication.error
  ) {
    return authentication.error;
  }

  const targetDate =
    normalizeText(
      body.targetDate ||
      body.target_date
    );

  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "수정할 자동수치 날짜를 확인해 주세요."
      },
      400
    );
  }

  let normalizedValues;

  try {
    normalizedValues =
      normalizeMorningMeetingAutoHistoryOverrideValues(
        body.values
      );

  } catch (
    error
  ) {
    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "수정할 자동수치 값을 확인해 주세요."
      },
      400
    );
  }

  if (
    Object.keys(
      normalizedValues
    ).length < 1
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "변경된 자동수치가 없습니다."
      },
      400
    );
  }

  const expectedRevision =
    Number(
      body.expectedRevision ??
      body.revision ??
      0
    );

  if (
    !Number.isInteger(
      expectedRevision
    ) ||
    expectedRevision < 0
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 수정 버전을 확인해 주세요."
      },
      400
    );
  }

  const database =
    context.env.DB;

  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );

  const existingRow =
    await database
      .prepare(`
        SELECT
          *

        FROM morning_meeting_auto_history_overrides

        WHERE
          target_date = ?

        LIMIT 1
      `)
      .bind(
        targetDate
      )
      .first();

  const existingItem =
    convertMorningMeetingAutoHistoryOverrideRow(
      existingRow
    );

  const currentRevision =
    existingRow
      ? (
          Number.isInteger(
            Number(
              existingRow.revision
            )
          ) &&
          Number(
            existingRow.revision
          ) > 0
            ? Number(
                existingRow.revision
              )
            : 1
        )
      : 0;

  if (
    expectedRevision !==
      currentRevision
  ) {
    return jsonResponse(
      {
        ok: false,

        currentItem:
          existingItem,

        message:
          "다른 사용자가 먼저 수정했습니다. 최신 자료를 다시 확인해 주세요."
      },
      409
    );
  }


  if (
    Number(
      existingRow?.reset_active ||
      0
    ) === 1
  ) {
    return jsonResponse(
      {
        ok: false,
        code:
          "MORNING_MEETING_AUTO_HISTORY_RESET_ACTIVE",
        currentItem:
          existingItem,
        reset:
          convertMorningMeetingAutoHistoryResetRow(
            existingRow,
            targetDate
          ),
        message:
          "선택일 자료가 초기화된 상태입니다. 먼저 원상복구하거나 전체조회를 완료해 주세요."
      },
      409
    );
  }

  /*
    기존에 수정했던 다른 항목은 유지하고
    이번에 바뀐 항목만 덮어쓴다.
  */
  let existingValues = {};

  try {
    existingValues =
      parseMorningMeetingAutoHistoryOverrideRawValues(
        existingRow
      );

  } catch (
    error
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "저장된 자동수치 수정값을 확인해 주세요."
      },
      500
    );
  }

  const mergedValues = {
    ...existingValues,
    ...normalizedValues
  };

  const valuesJson =
    JSON.stringify(
      mergedValues
    );

  const user =
    authentication.user;

  const now =
    new Date()
      .toISOString();

  let writeResult;

  if (
    existingRow
  ) {
    writeResult =
      await database
        .prepare(`
          UPDATE
            morning_meeting_auto_history_overrides

          SET
            values_json = ?,

            updated_by_id = ?,
            updated_by_name = ?,
            updated_at = ?,

            revision =
              revision + 1

          WHERE
            target_date = ?
            AND revision = ?
        `)
        .bind(
          valuesJson,

          user.employeeNo,
          user.name,
          now,

          targetDate,
          currentRevision
        )
        .run();

  } else {
    writeResult =
      await database
        .prepare(`
          INSERT OR IGNORE INTO
            morning_meeting_auto_history_overrides (
              target_date,
              values_json,

              created_by_id,
              created_by_name,
              created_at,

              updated_by_id,
              updated_by_name,
              updated_at,

              revision
            )

          VALUES (
            ?,
            ?,

            ?,
            ?,
            ?,

            ?,
            ?,
            ?,

            1
          )
        `)
        .bind(
          targetDate,
          valuesJson,

          user.employeeNo,
          user.name,
          now,

          user.employeeNo,
          user.name,
          now
        )
        .run();
  }

  if (
    Number(
      writeResult?.meta?.changes
    ) !== 1
  ) {
    const latestRow =
      await database
        .prepare(`
          SELECT
            *

          FROM morning_meeting_auto_history_overrides

          WHERE
            target_date = ?

          LIMIT 1
        `)
        .bind(
          targetDate
        )
        .first();

    return jsonResponse(
      {
        ok: false,

        currentItem:
          convertMorningMeetingAutoHistoryOverrideRow(
            latestRow
          ),

        message:
          "다른 사용자가 먼저 수정했습니다. 최신 자료를 다시 확인해 주세요."
      },
      409
    );
  }

  const savedRow =
    await database
      .prepare(`
        SELECT
          *

        FROM morning_meeting_auto_history_overrides

        WHERE
          target_date = ?

        LIMIT 1
      `)
      .bind(
        targetDate
      )
      .first();

  const savedItem =
    convertMorningMeetingAutoHistoryOverrideRow(
      savedRow
    );

  if (
    !savedItem
  ) {
    throw new Error(
      "저장된 자동수치 수정값을 확인하지 못했습니다."
    );
  }

  return jsonResponse({
    ok: true,

    item:
      savedItem,

    message:
      `${targetDate} 자동수치 수정값을 저장했습니다.`
  });
}

/* =========================================================
  오전회의 자동수치에서 빈칸으로 저장한 값 복원

  - 원본 OIS·Excel·석회석 자료는 변경하지 않는다.
  - 해당 날짜에서 현재 명시적으로 비운 필드만
    values_json에서 제거한다.
  - SMP·태양광 등 정상 자동 저장값은 지우지 않는다.
  - 빈 객체가 되어도 행과 revision은 유지해
    오래된 화면의 저장 요청과 충돌시킨다.
========================================================= */

async function restoreMorningMeetingAutoHistoryBlankOverrides(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );

  if (
    authentication.error
  ) {
    return authentication.error;
  }

  const targetDate =
    normalizeText(
      body.targetDate ||
      body.target_date
    );

  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "복원할 자동수치 날짜를 확인해 주세요."
      },
      400
    );
  }

  const expectedRevision =
    body.expectedRevision ??
    body.revision;

  if (
    typeof expectedRevision !==
      "number" ||
    !Number.isInteger(
      expectedRevision
    ) ||
    expectedRevision < 1
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 복원 버전을 확인해 주세요."
      },
      400
    );
  }

  const database =
    context.env.DB;

  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );

  const existingRow =
    await database
      .prepare(`
        SELECT
          *

        FROM morning_meeting_auto_history_overrides

        WHERE
          target_date = ?

        LIMIT 1
      `)
      .bind(
        targetDate
      )
      .first();

  const existingItem =
    convertMorningMeetingAutoHistoryOverrideRow(
      existingRow
    );

  const currentRevision =
    existingRow
      ? (
          Number.isInteger(
            Number(
              existingRow.revision
            )
          ) &&
          Number(
            existingRow.revision
          ) > 0
            ? Number(
                existingRow.revision
              )
            : 1
        )
      : 0;

  if (
    currentRevision !==
      expectedRevision
  ) {
    return jsonResponse(
      {
        ok: false,
        currentItem:
          existingItem,
        message:
          "다른 사용자가 먼저 수정했습니다. 최신 자료를 다시 확인해 주세요."
      },
      409
    );
  }


  if (
    Number(
      existingRow?.reset_active ||
      0
    ) === 1
  ) {
    return jsonResponse(
      {
        ok: false,
        code:
          "MORNING_MEETING_AUTO_HISTORY_RESET_ACTIVE",
        currentItem:
          existingItem,
        reset:
          convertMorningMeetingAutoHistoryResetRow(
            existingRow,
            targetDate
          ),
        message:
          "선택일 자료가 초기화된 상태이므로 빈칸 복원을 실행할 수 없습니다."
      },
      409
    );
  }

  let existingValues;

  try {
    existingValues =
      parseMorningMeetingAutoHistoryOverrideRawValues(
        existingRow
      );

  } catch (
    error
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "저장된 자동수치 수정값을 확인해 주세요."
      },
      500
    );
  }

  const fieldNames =
    MORNING_MEETING_AUTO_HISTORY_OVERRIDE_FIELD_NAMES.filter(
      fieldName => {
        if (
          !Object.prototype
          .hasOwnProperty
          .call(
            existingValues,
            fieldName
          )
        ) {
          return false;
        }

        const value =
          existingValues[
            fieldName
          ];

        return value === null ||
          (
            typeof value ===
              "string" &&
            value.trim() ===
              ""
          );
      }
    );

  if (
    fieldNames.length < 1
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "원본으로 복원할 빈칸 수정값이 없습니다."
      },
      400
    );
  }

  const restoredValues = {
    ...existingValues
  };

  fieldNames.forEach(
    fieldName => {
      delete restoredValues[
        fieldName
      ];
    }
  );

  const user =
    authentication.user;

  const now =
    new Date()
      .toISOString();

  const writeResult =
    await database
      .prepare(`
        UPDATE
          morning_meeting_auto_history_overrides

        SET
          values_json = ?,
          updated_by_id = ?,
          updated_by_name = ?,
          updated_at = ?,
          revision = revision + 1

        WHERE
          target_date = ?
          AND revision = ?
      `)
      .bind(
        JSON.stringify(
          restoredValues
        ),
        user.employeeNo,
        user.name,
        now,
        targetDate,
        expectedRevision
      )
      .run();

  if (
    Number(
      writeResult?.meta?.changes
    ) !== 1
  ) {
    const latestRow =
      await database
        .prepare(`
          SELECT
            *

          FROM morning_meeting_auto_history_overrides

          WHERE
            target_date = ?

          LIMIT 1
        `)
        .bind(
          targetDate
        )
        .first();

    return jsonResponse(
      {
        ok: false,
        currentItem:
          convertMorningMeetingAutoHistoryOverrideRow(
            latestRow
          ),
        message:
          "다른 사용자가 먼저 수정했습니다. 최신 자료를 다시 확인해 주세요."
      },
      409
    );
  }

  const savedRow =
    await database
      .prepare(`
        SELECT
          *

        FROM morning_meeting_auto_history_overrides

        WHERE
          target_date = ?

        LIMIT 1
      `)
      .bind(
        targetDate
      )
      .first();

  const savedItem =
    convertMorningMeetingAutoHistoryOverrideRow(
      savedRow
    );

  if (
    !savedItem
  ) {
    throw new Error(
      "복원된 자동수치 수정값을 확인하지 못했습니다."
    );
  }

  return jsonResponse({
    ok: true,
    item:
      savedItem,
    restoredFields:
      fieldNames,
    restoredCount:
      fieldNames.length,
    message:
      `${targetDate} 빈칸 ${fieldNames.length}개를 원본값으로 복원했습니다.`
  });
}


function normalizeMorningMeetingAutoHistoryResetRevision(
  rawRevision,
  allowZero = false
) {
  if (
    typeof rawRevision !==
      "number" ||
    !Number.isSafeInteger(
      rawRevision
    ) ||
    rawRevision <
      (
        allowZero
          ? 0
          : 1
      )
  ) {
    return null;
  }


  return rawRevision;
}


async function findMorningMeetingAutoHistoryResetRow(
  database,
  targetDate
) {
  return await database
    .prepare(`
      SELECT
        *

      FROM
        morning_meeting_auto_history_overrides

      WHERE
        target_date = ?

      LIMIT 1
    `)
    .bind(
      targetDate
    )
    .first();
}


async function findMorningMeetingAutoHistoryActiveRequestTypes(
  database,
  targetDate,
  activeAt = new Date().toISOString()
) {
  /* MORNING_MEETING_RESET_BLOCKER_CORE_ONLY_V1
    Reset is blocked only by foreground/core morning-meeting queries.
    organic_silo_dataparc is a background inventory refresh and
    steam_status is a legacy workbook alias; neither blocks reset.
  */
  const queryResult =
    await database
      .prepare(`
        SELECT DISTINCT
          request_type

        FROM
          ois_data_requests

        WHERE
          target_date = ?
          AND status IN (
            'pending',
            'processing'
          )
          AND request_type IN (
            'water_environment',
            'limestone_stock',
            'turbine_gear_pinion',
            'silo_level',
            'daily_data_excel'
          )
          AND (
            expires_at IS NULL
            OR expires_at >= ?
          )

        ORDER BY
          request_type ASC
      `)
      .bind(
        targetDate,
        activeAt
      )
      .all();


  return (
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : []
  )
    .map(
      row =>
        normalizeText(
          row.request_type
        )
    )
    .filter(
      requestType =>
        MORNING_MEETING_AUTO_HISTORY_RESET_REQUEST_TYPES.includes(
          requestType
        )
    );
}


const MORNING_MEETING_AUTO_HISTORY_RESET_FRESH_GROUPS =
  Object.freeze([
    Object.freeze([
      "water_environment"
    ]),
    Object.freeze([
      "limestone_stock"
    ]),
    Object.freeze([
      "turbine_gear_pinion"
    ]),
    Object.freeze([
      "silo_level"
    ]),
    Object.freeze([
      "daily_data_excel",
      "steam_status"
    ])
  ]);


async function findMorningMeetingAutoHistoryMissingFreshGroups(
  database,
  targetDate,
  resetAt
) {
  const queryResult =
    await database
      .prepare(`
        SELECT DISTINCT
          request_type

        FROM
          ois_data_requests

        WHERE
          target_date = ?
          AND status = 'complete'
          AND request_type IN (
            'water_environment',
            'limestone_stock',
            'turbine_gear_pinion',
            'silo_level',
            'daily_data_excel',
            'steam_status'
          )
          AND COALESCE(
            NULLIF(
              completed_at,
              ''
            ),
            updated_at,
            ''
          ) > ?
          AND result_json IS NOT NULL
          AND TRIM(result_json) <> ''
          AND CASE
            WHEN json_valid(result_json)
              THEN json_type(result_json)
            ELSE ''
          END = 'object'
          AND CASE
            WHEN json_valid(result_json)
              THEN json(result_json) <> '{}'
            ELSE 0
          END
      `)
      .bind(
        targetDate,
        resetAt
      )
      .all();


  const completedTypes =
    new Set(
      (
        Array.isArray(
          queryResult.results
        )
          ? queryResult.results
          : []
      ).map(
        row =>
          normalizeText(
            row.request_type
          )
      )
    );


  return MORNING_MEETING_AUTO_HISTORY_RESET_FRESH_GROUPS
    .filter(
      group =>
        !group.some(
          requestType =>
            completedTypes.has(
              requestType
            )
        )
    )
    .map(
      group =>
        group.join(
          "|"
        )
    );
}


function morningMeetingAutoHistoryResetConflictResponse(
  row,
  targetDate,
  message,
  code = "MORNING_MEETING_AUTO_HISTORY_RESET_CONFLICT",
  extra = {}
) {
  return jsonResponse(
    {
      ok: false,
      code,
      currentItem:
        convertMorningMeetingAutoHistoryResetRow(
          row,
          targetDate
        ),
      ...extra,
      message
    },
    409
  );
}


/* =========================================================
  오전회의 선택일 전체 초기화 상태 조회

  - 원본 OIS·Excel·석회석 저장행은 조회만 한다.
  - 복구 snapshot은 응답에 포함하지 않는다.
========================================================= */

async function handleMorningMeetingAutoHistoryResetStatusGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const targetDate =
    normalizeText(
      requestUrl.searchParams.get(
        "targetDate"
      ) ||
      requestUrl.searchParams.get(
        "target_date"
      )
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "초기화 상태를 확인할 날짜를 확인해 주세요."
      },
      400
    );
  }


  await ensureMorningMeetingAutoHistoryOverridesTable(
    context.env.DB
  );


  const row =
    await findMorningMeetingAutoHistoryResetRow(
      context.env.DB,
      targetDate
    );


  return jsonResponse({
    ok: true,
    item:
      convertMorningMeetingAutoHistoryResetRow(
        row,
        targetDate
      )
  });
}


/* =========================================================
  오전회의 선택일 전체 초기화

  - 현재 수동 보정 JSON을 snapshot으로 보존한다.
  - 보정값은 빈 객체로 만들고 reset_active를 켠다.
  - 원본 테이블과 완료 요청은 삭제하지 않는다.
  - 관련 조회가 진행 중이면 초기화하지 않는다.
========================================================= */


/* MORNING_MEETING_RESET_STALE_ACTIVE_V1
  The visible Morning Meeting may already be complete while an abandoned
  queue row is still pending/processing. Only rows with no update for six
  minutes are retired here. A genuinely recent/concurrent query still blocks
  reset through the existing active-request check and final SQL CAS guards.
*/
async function retireStaleMorningMeetingAutoHistoryActiveRequests(
  database,
  targetDate,
  nowText = new Date().toISOString()
) {
  const nowTime = Date.parse(nowText);
  const cutoffText = new Date(
    (Number.isFinite(nowTime) ? nowTime : Date.now()) -
    6 * 60 * 1000
  ).toISOString();

  const result = await database
    .prepare(`
      UPDATE ois_data_requests

      SET status = 'failed',
          error_message = '선택일 초기화 준비 중 장시간 응답이 없던 오전회의 조회 요청을 종료했습니다.',
          completed_at = CASE WHEN completed_at IS NULL OR completed_at = '' THEN ? ELSE completed_at END,
          updated_at = ?

      WHERE target_date = ?
        AND status IN ('pending', 'processing')
        AND request_type IN (
          'water_environment',
          'limestone_stock',
          'turbine_gear_pinion',
          'silo_level',
          'daily_data_excel'
        )
        AND COALESCE(
          NULLIF(updated_at, ''),
          NULLIF(started_at, ''),
          NULLIF(requested_at, ''),
          ''
        ) <= ?
    `)
    .bind(
      nowText,
      nowText,
      targetDate,
      cutoffText
    )
    .run();

  return Number(result?.meta?.changes || 0);
}

async function resetMorningMeetingAutoHistory(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const targetDate =
    normalizeText(
      body.targetDate ||
      body.target_date
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "초기화할 자동수치 날짜를 확인해 주세요."
      },
      400
    );
  }


  const expectedRevision =
    normalizeMorningMeetingAutoHistoryResetRevision(
      body.expectedRevision ??
      body.revision,
      true
    );


  if (
    expectedRevision ===
      null
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 초기화 버전을 확인해 주세요."
      },
      400
    );
  }


  const database =
    context.env.DB;


  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );


  const now =
    new Date()
      .toISOString();


  const existingRow =
    await findMorningMeetingAutoHistoryResetRow(
      database,
      targetDate
    );


  const currentRevision =
    getMorningMeetingAutoHistoryOverrideRevision(
      existingRow
    );


  if (
    currentRevision !==
      expectedRevision
  ) {
    return morningMeetingAutoHistoryResetConflictResponse(
      existingRow,
      targetDate,
      "다른 사용자가 먼저 변경했습니다. 최신 자료를 다시 확인해 주세요."
    );
  }


  if (
    Number(
      existingRow?.reset_active ||
      0
    ) === 1
  ) {
    return morningMeetingAutoHistoryResetConflictResponse(
      existingRow,
      targetDate,
      "선택일 자료는 이미 초기화된 상태입니다.",
      "MORNING_MEETING_AUTO_HISTORY_RESET_ALREADY_ACTIVE"
    );
  }


  let snapshotValues;


  try {
    snapshotValues =
      parseMorningMeetingAutoHistoryOverrideRawValues(
        existingRow
      );

  } catch (
    error
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "저장된 자동수치 수정값을 확인해 주세요."
      },
      500
    );
  }


  /*
    First expire normal queue timeouts, then retire only abandoned core
    requests that have not changed for six minutes. This frees orphan rows
    left behind by a timed-out browser/Agent run without bypassing a genuinely
    current query from another user.
  */
  await expireOldRequests(
    database
  );


  const retiredStaleRequestCount =
    await retireStaleMorningMeetingAutoHistoryActiveRequests(
      database,
      targetDate,
      now
    );


  if (
    retiredStaleRequestCount >
      0
  ) {
    console.warn(
      "Morning Meeting reset retired stale active requests:",
      targetDate,
      retiredStaleRequestCount
    );
  }

  const activeRequestTypes =
    await findMorningMeetingAutoHistoryActiveRequestTypes(
      database,
      targetDate,
      now
    );


  if (
    activeRequestTypes.length >
      0
  ) {
    return morningMeetingAutoHistoryResetConflictResponse(
      existingRow,
      targetDate,
      `선택일 핵심 자료를 아직 조회 중입니다 (${activeRequestTypes.join(", ")}). ` +
        "최근 시작된 조회가 끝난 뒤 다시 초기화해 주세요.",
      "MORNING_MEETING_AUTO_HISTORY_QUERY_ACTIVE",
      {
        activeRequestTypes
      }
    );
  }


  const user =
    authentication.user;


  const snapshotValuesJson =
    JSON.stringify(
      snapshotValues
    );


  let writeResult;


  if (
    existingRow
  ) {
    writeResult =
      await database
        .prepare(`
          UPDATE
            morning_meeting_auto_history_overrides

          SET
            values_json = '{}',
            reset_active = 1,
            reset_at = ?,
            reset_by_id = ?,
            reset_by_name = ?,
            reset_snapshot_values_json = ?,
            reset_restored_at = '',
            updated_by_id = ?,
            updated_by_name = ?,
            updated_at = ?,
            revision = revision + 1

          WHERE
            target_date = ?
            AND revision = ?
            AND reset_active = 0
            AND NOT EXISTS (
              SELECT 1

              FROM ois_data_requests

              WHERE
                target_date = ?
                AND status IN (
                  'pending',
                  'processing'
                )
                AND request_type IN (
                  'water_environment',
                  'limestone_stock',
                  'turbine_gear_pinion',
                  'silo_level',
                  'daily_data_excel'
                )
                AND (
                  expires_at IS NULL
                  OR expires_at >= ?
                )
            )
        `)
        .bind(
          now,
          user.employeeNo,
          user.name,
          snapshotValuesJson,
          user.employeeNo,
          user.name,
          now,
          targetDate,
          expectedRevision,
          targetDate,
          now
        )
        .run();

  } else {
    writeResult =
      await database
        .prepare(`
          INSERT OR IGNORE INTO
            morning_meeting_auto_history_overrides (
              target_date,
              values_json,
              created_by_id,
              created_by_name,
              created_at,
              updated_by_id,
              updated_by_name,
              updated_at,
              revision,
              reset_active,
              reset_at,
              reset_by_id,
              reset_by_name,
              reset_snapshot_values_json,
              reset_restored_at
            )

          SELECT
            ?,
            '{}',
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            1,
            1,
            ?,
            ?,
            ?,
            '{}',
            ''

          WHERE NOT EXISTS (
            SELECT 1

            FROM ois_data_requests

            WHERE
              target_date = ?
              AND status IN (
                'pending',
                'processing'
              )
              AND request_type IN (
                'water_environment',
                'limestone_stock',
                'turbine_gear_pinion',
                'silo_level',
                'daily_data_excel'
              )
              AND (
                expires_at IS NULL
                OR expires_at >= ?
              )
          )
        `)
        .bind(
          targetDate,
          user.employeeNo,
          user.name,
          now,
          user.employeeNo,
          user.name,
          now,
          now,
          user.employeeNo,
          user.name,
          targetDate,
          now
        )
        .run();
  }


  if (
    Number(
      writeResult?.meta?.changes
    ) !== 1
  ) {
    const [
      latestRow,
      latestActiveRequestTypes
    ] =
      await Promise.all([
        findMorningMeetingAutoHistoryResetRow(
          database,
          targetDate
        ),
        findMorningMeetingAutoHistoryActiveRequestTypes(
          database,
          targetDate,
          now
        )
      ]);


    if (
      latestActiveRequestTypes.length >
        0
    ) {
      return morningMeetingAutoHistoryResetConflictResponse(
        latestRow,
        targetDate,
        "선택일 핵심 자료 조회가 시작되어 초기화하지 않았습니다.",
        "MORNING_MEETING_AUTO_HISTORY_QUERY_ACTIVE",
        {
          activeRequestTypes:
            latestActiveRequestTypes
        }
      );
    }


    return morningMeetingAutoHistoryResetConflictResponse(
      latestRow,
      targetDate,
      "다른 사용자가 먼저 변경했습니다. 최신 자료를 다시 확인해 주세요."
    );
  }


  const savedRow =
    await findMorningMeetingAutoHistoryResetRow(
      database,
      targetDate
    );


  return jsonResponse({
    ok: true,
    item:
      convertMorningMeetingAutoHistoryResetRow(
        savedRow,
        targetDate
      ),
    message:
      `${targetDate} 자동수치를 초기화했습니다. 원본 자료는 보존됩니다.`
  });
}


/* =========================================================
  초기화 원상복구

  - 초기화 직전 snapshot을 values_json으로 되돌린다.
  - 원본 자료나 OIS 요청은 변경하지 않는다.
========================================================= */

async function restoreMorningMeetingAutoHistoryReset(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const targetDate =
    normalizeText(
      body.targetDate ||
      body.target_date
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "원상복구할 자동수치 날짜를 확인해 주세요."
      },
      400
    );
  }


  const expectedRevision =
    normalizeMorningMeetingAutoHistoryResetRevision(
      body.expectedRevision ??
      body.revision
    );


  if (
    expectedRevision ===
      null
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 원상복구 버전을 확인해 주세요."
      },
      400
    );
  }


  const database =
    context.env.DB;


  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );


  const existingRow =
    await findMorningMeetingAutoHistoryResetRow(
      database,
      targetDate
    );


  if (
    getMorningMeetingAutoHistoryOverrideRevision(
      existingRow
    ) !==
      expectedRevision
  ) {
    return morningMeetingAutoHistoryResetConflictResponse(
      existingRow,
      targetDate,
      "다른 사용자가 먼저 변경했습니다. 최신 자료를 다시 확인해 주세요."
    );
  }


  if (
    !existingRow ||
    Number(
      existingRow.reset_active ||
      0
    ) !== 1
  ) {
    return morningMeetingAutoHistoryResetConflictResponse(
      existingRow,
      targetDate,
      "선택일 자료는 초기화된 상태가 아닙니다.",
      "MORNING_MEETING_AUTO_HISTORY_RESET_NOT_ACTIVE"
    );
  }


  const snapshotValuesText =
    normalizeText(
      existingRow
        .reset_snapshot_values_json
    );


  let snapshotValues;


  try {
    snapshotValues =
      parseMorningMeetingAutoHistoryOverrideRawValues({
        values_json:
          snapshotValuesText
      });

  } catch (
    error
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "초기화 원상복구 자료를 확인해 주세요."
      },
      500
    );
  }


  const user =
    authentication.user;


  const now =
    new Date()
      .toISOString();


  const writeResult =
    await database
      .prepare(`
        UPDATE
          morning_meeting_auto_history_overrides

        SET
          values_json = ?,
          reset_active = 0,
          reset_snapshot_values_json = '',
          reset_restored_at = ?,
          updated_by_id = ?,
          updated_by_name = ?,
          updated_at = ?,
          revision = revision + 1

        WHERE
          target_date = ?
          AND revision = ?
          AND reset_active = 1
      `)
      .bind(
        JSON.stringify(
          snapshotValues
        ),
        now,
        user.employeeNo,
        user.name,
        now,
        targetDate,
        expectedRevision
      )
      .run();


  if (
    Number(
      writeResult?.meta?.changes
    ) !== 1
  ) {
    const latestRow =
      await findMorningMeetingAutoHistoryResetRow(
        database,
        targetDate
      );


    return morningMeetingAutoHistoryResetConflictResponse(
      latestRow,
      targetDate,
      "다른 사용자가 먼저 변경했습니다. 최신 자료를 다시 확인해 주세요."
    );
  }


  const savedRow =
    await findMorningMeetingAutoHistoryResetRow(
      database,
      targetDate
    );


  return jsonResponse({
    ok: true,
    item:
      convertMorningMeetingAutoHistoryResetRow(
        savedRow,
        targetDate
      ),
    message:
      `${targetDate} 자동수치를 초기화 직전 상태로 원상복구했습니다.`
  });
}


/* =========================================================
  전체 재조회 성공 후 초기화 상태 해제

  - reset_at 이후 필수 자료군이 모두 complete인지 서버가 확인한다.
  - snapshot은 폐기하고 빈 보정값을 유지한다.
  - 이후 completed_history는 최신 완료자료를 다시 표시한다.
========================================================= */

async function releaseMorningMeetingAutoHistoryReset(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const targetDate =
    normalizeText(
      body.targetDate ||
      body.target_date
    );


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "초기화 상태를 해제할 자동수치 날짜를 확인해 주세요."
      },
      400
    );
  }


  const expectedRevision =
    normalizeMorningMeetingAutoHistoryResetRevision(
      body.expectedRevision ??
      body.revision
    );


  if (
    expectedRevision ===
      null
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 초기화 해제 버전을 확인해 주세요."
      },
      400
    );
  }


  const database =
    context.env.DB;


  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );


  const existingRow =
    await findMorningMeetingAutoHistoryResetRow(
      database,
      targetDate
    );


  if (
    getMorningMeetingAutoHistoryOverrideRevision(
      existingRow
    ) !==
      expectedRevision
  ) {
    return morningMeetingAutoHistoryResetConflictResponse(
      existingRow,
      targetDate,
      "다른 사용자가 먼저 변경했습니다. 최신 자료를 다시 확인해 주세요."
    );
  }


  if (
    !existingRow ||
    Number(
      existingRow.reset_active ||
      0
    ) !== 1
  ) {
    return morningMeetingAutoHistoryResetConflictResponse(
      existingRow,
      targetDate,
      "선택일 자료는 초기화된 상태가 아닙니다.",
      "MORNING_MEETING_AUTO_HISTORY_RESET_NOT_ACTIVE"
    );
  }


  const resetAt =
    normalizeText(
      existingRow.reset_at
    );


  if (
    !resetAt ||
    Number.isNaN(
      new Date(
        resetAt
      ).getTime()
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "저장된 자동수치 초기화 시각을 확인하지 못했습니다."
      },
      500
    );
  }


  const missingRequestTypes =
    await findMorningMeetingAutoHistoryMissingFreshGroups(
      database,
      targetDate,
      resetAt
    );


  if (
    missingRequestTypes.length >
      0
  ) {
    return morningMeetingAutoHistoryResetConflictResponse(
      existingRow,
      targetDate,
      "선택일 전체조회가 아직 완료되지 않아 초기화 상태를 유지합니다.",
      "MORNING_MEETING_AUTO_HISTORY_FRESH_QUERY_INCOMPLETE",
      {
        missingRequestTypes
      }
    );
  }


  const user =
    authentication.user;


  const now =
    new Date()
      .toISOString();


  /*
    아래 EXISTS도 UPDATE 안에서 다시 검사한다.
    사전 확인과 CAS 사이에 상태가 달라져도 snapshot을 폐기하지 않는다.
  */
  const writeResult =
    await database
      .prepare(`
        UPDATE
          morning_meeting_auto_history_overrides

        SET
          reset_active = 0,
          reset_snapshot_values_json = '',
          reset_restored_at = ?,
          updated_by_id = ?,
          updated_by_name = ?,
          updated_at = ?,
          revision = revision + 1

        WHERE
          target_date = ?
          AND revision = ?
          AND reset_active = 1

          AND EXISTS (
            SELECT 1 FROM ois_data_requests
            WHERE target_date = ?
              AND status = 'complete'
              AND request_type = 'water_environment'
              AND COALESCE(NULLIF(completed_at, ''), updated_at, '') > ?
              AND result_json IS NOT NULL
              AND TRIM(result_json) <> ''
              AND CASE WHEN json_valid(result_json)
                THEN json_type(result_json) ELSE '' END = 'object'
              AND CASE WHEN json_valid(result_json)
                THEN json(result_json) <> '{}' ELSE 0 END
          )

          AND EXISTS (
            SELECT 1 FROM ois_data_requests
            WHERE target_date = ?
              AND status = 'complete'
              AND request_type = 'limestone_stock'
              AND COALESCE(NULLIF(completed_at, ''), updated_at, '') > ?
              AND result_json IS NOT NULL
              AND TRIM(result_json) <> ''
              AND CASE WHEN json_valid(result_json)
                THEN json_type(result_json) ELSE '' END = 'object'
              AND CASE WHEN json_valid(result_json)
                THEN json(result_json) <> '{}' ELSE 0 END
          )

          AND EXISTS (
            SELECT 1 FROM ois_data_requests
            WHERE target_date = ?
              AND status = 'complete'
              AND request_type = 'turbine_gear_pinion'
              AND COALESCE(NULLIF(completed_at, ''), updated_at, '') > ?
              AND result_json IS NOT NULL
              AND TRIM(result_json) <> ''
              AND CASE WHEN json_valid(result_json)
                THEN json_type(result_json) ELSE '' END = 'object'
              AND CASE WHEN json_valid(result_json)
                THEN json(result_json) <> '{}' ELSE 0 END
          )

          AND EXISTS (
            SELECT 1 FROM ois_data_requests
            WHERE target_date = ?
              AND status = 'complete'
              AND request_type = 'silo_level'
              AND COALESCE(NULLIF(completed_at, ''), updated_at, '') > ?
              AND result_json IS NOT NULL
              AND TRIM(result_json) <> ''
              AND CASE WHEN json_valid(result_json)
                THEN json_type(result_json) ELSE '' END = 'object'
              AND CASE WHEN json_valid(result_json)
                THEN json(result_json) <> '{}' ELSE 0 END
          )

          AND EXISTS (
            SELECT 1 FROM ois_data_requests
            WHERE target_date = ?
              AND status = 'complete'
              AND request_type IN (
                'daily_data_excel',
                'steam_status'
              )
              AND COALESCE(NULLIF(completed_at, ''), updated_at, '') > ?
              AND result_json IS NOT NULL
              AND TRIM(result_json) <> ''
              AND CASE WHEN json_valid(result_json)
                THEN json_type(result_json) ELSE '' END = 'object'
              AND CASE WHEN json_valid(result_json)
                THEN json(result_json) <> '{}' ELSE 0 END
          )

      `)
      .bind(
        now,
        user.employeeNo,
        user.name,
        now,
        targetDate,
        expectedRevision,
        targetDate,
        resetAt,
        targetDate,
        resetAt,
        targetDate,
        resetAt,
        targetDate,
        resetAt,
        targetDate,
        resetAt
      )
      .run();


  if (
    Number(
      writeResult?.meta?.changes
    ) !== 1
  ) {
    const latestRow =
      await findMorningMeetingAutoHistoryResetRow(
        database,
        targetDate
      );


    return morningMeetingAutoHistoryResetConflictResponse(
      latestRow,
      targetDate,
      "다른 변경 또는 조회 상태 충돌로 초기화 상태를 해제하지 않았습니다."
    );
  }


  const savedRow =
    await findMorningMeetingAutoHistoryResetRow(
      database,
      targetDate
    );


  return jsonResponse({
    ok: true,
    item:
      convertMorningMeetingAutoHistoryResetRow(
        savedRow,
        targetDate
      ),
    message:
      `${targetDate} 전체조회 완료자료를 적용했습니다.`
  });
}

/* =========================================================
  오전회의 자동수치 수정값 기간 조회

  GET:
  /api/ois-data-requests
    ?action=morning_meeting_auto_history_overrides
    &startDate=2026-08-01
    &endDate=2026-08-31

  저장된 수정값만 조회하며
  새로운 OIS 요청은 생성하지 않는다.
========================================================= */

async function handleMorningMeetingAutoHistoryOverridesGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const startDate =
    normalizeText(
      requestUrl.searchParams.get(
        "startDate"
      )
    );


  const endDate =
    normalizeText(
      requestUrl.searchParams.get(
        "endDate"
      )
    );


  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "자동수치 수정값 조회 시작일과 종료일을 확인해 주세요."
      },
      400
    );
  }


  const dayCount =
    getLimestoneUsageBatchDayCount(
      startDate,
      endDate
    );


  if (
    dayCount <
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "자동수치 수정값 조회 시작일은 종료일보다 늦을 수 없습니다."
      },
      400
    );
  }


  if (
    dayCount >
      366
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "자동수치 수정값은 한 번에 최대 366일까지 조회할 수 있습니다."
      },
      400
    );
  }


  await ensureMorningMeetingAutoHistoryOverridesTable(
    context.env.DB
  );


  const items =
    await findMorningMeetingAutoHistoryOverrides(
      context.env.DB,
      startDate,
      endDate
    );


  return jsonResponse({
    ok:
      true,

    range: {
      startDate,
      endDate,
      dayCount
    },

    summary: {
      savedDateCount:
        items.length
    },

    items
  });
}

/* =========================================================
  저장된 자동수치 기간 조회

  - 완료된 DB 자료만 조회한다.
  - 새로운 OIS 요청을 생성하지 않는다.
  - 같은 날짜와 자료 종류가 여러 개면 최신 자료만 반환한다.

  GET:
  /api/ois-data-requests
    ?action=completed_history
    &startDate=2026-08-01
    &endDate=2026-08-31
========================================================= */

async function handleCompletedHistoryGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );

  if (
    authentication.error
  ) {
    return authentication.error;
  }

  const startDate =
    normalizeText(
      requestUrl.searchParams.get(
        "startDate"
      )
    );

  const endDate =
    normalizeText(
      requestUrl.searchParams.get(
        "endDate"
      )
    );

  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 조회 시작일과 종료일을 확인해 주세요."
      },
      400
    );
  }

  const dayCount =
    getLimestoneUsageBatchDayCount(
      startDate,
      endDate
    );

  if (
    dayCount < 1
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 조회 시작일은 종료일보다 늦을 수 없습니다."
      },
      400
    );
  }

  if (
    dayCount > 366
  ) {
    return jsonResponse(
      {
        ok: false,
        message:
          "자동수치 이력은 한 번에 최대 366일까지 조회할 수 있습니다."
      },
      400
    );
  }

  /*
    저장이 완료된 기존 자동수치만 읽는다.

    새로운 OIS 요청 생성이나
    자동 재조회는 실행하지 않는다.
  */
  const queryResult =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM ois_data_requests

        WHERE
          target_date >= ?
          AND target_date <= ?
          AND status = 'complete'
          AND request_type IN (
            'water_environment',
            'turbine_gear_pinion',
            'silo_level',
            'daily_data_excel',
            'organic_silo_dataparc',
            'steam_status'
          )
          AND result_json IS NOT NULL
          AND TRIM(
            result_json
          ) <> ''
          AND CASE
            WHEN json_valid(result_json)
              THEN json_type(result_json)
            ELSE ''
          END = 'object'
          AND CASE
            WHEN json_valid(result_json)
              THEN json(result_json) <> '{}'
            ELSE 0
          END

        ORDER BY
          target_date DESC,

          CASE
            WHEN request_type = 'steam_status'
              THEN 'daily_data_excel'
            ELSE request_type
          END ASC,

          COALESCE(
            NULLIF(
              completed_at,
              ''
            ),
            updated_at,
            requested_at,
            ''
          ) DESC,

          CASE request_type
            WHEN 'daily_data_excel' THEN 0
            WHEN 'steam_status' THEN 1
            ELSE 0
          END ASC,

          requested_at DESC,
          id DESC
      `)
      .bind(
        startDate,
        endDate
      )
      .all();

  const rows =
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : [];

  /*
    날짜와 자료 종류가 같은 자료는
    가장 최신 자료 하나만 남긴다.
  */
  const resets =
    await findMorningMeetingAutoHistoryResets(
      context.env.DB,
      startDate,
      endDate
    );


  const activeResetByDate =
    new Map(
      resets
        .filter(
          item =>
            item.active
        )
        .map(
          item => [
            item.targetDate,
            item
          ]
        )
    );


  const savedKeys =
    new Set();

  const savedDates =
    new Set();

  const items =
    [];

  rows.forEach(
    row => {
      const convertedItem =
        convertRequestRow(
          row
        );

      if (
        !convertedItem ||
        !isValidIsoDate(
          convertedItem.targetDate
        ) ||
        !convertedItem.result ||
        typeof convertedItem.result !==
          "object" ||
        Array.isArray(
          convertedItem.result
        )
      ) {
        return;
      }


      const activeReset =
        activeResetByDate.get(
          convertedItem.targetDate
        );


      if (
        activeReset
      ) {
        const completedAt =
          normalizeText(
            convertedItem.completedAt ||
            convertedItem.updatedAt
          );


        /*
          초기화 시점 전에 저장된 결과는 원본 테이블에 그대로 두되
          reset_active 동안만 응답에서 감춘다. 초기화 이후 새로 완료된
          자료는 재조회 진행 상황을 보여 줄 수 있도록 반환한다.
        */
        if (
          !activeReset.resetAt ||
          !completedAt ||
          completedAt <=
            activeReset.resetAt
        ) {
          return;
        }
      }

      /*
        기존 steam_status 자료도
        현재 daily_data_excel 자료로 취급한다.
      */
      const requestType =
        convertedItem.requestType ===
          "steam_status"
          ? "daily_data_excel"
          : convertedItem.requestType;

      const savedKey =
        [
          convertedItem.targetDate,
          requestType
        ].join(
          ":"
        );

      if (
        savedKeys.has(
          savedKey
        )
      ) {
        return;
      }

      savedKeys.add(
        savedKey
      );

      savedDates.add(
        convertedItem.targetDate
      );

      items.push({
        id:
          convertedItem.id,

        requestType,

        sourceRequestType:
          convertedItem.requestType,

        targetDate:
          convertedItem.targetDate,

        status:
          "complete",

        result:
          convertedItem.result,

        completedAt:
          convertedItem.completedAt,

        updatedAt:
          convertedItem.updatedAt
      });
    }
  );

  /*
    날짜별 수동 수정값을 같은 응답에 포함한다.

    브라우저에서 별도의 조회 요청을
    추가로 보내지 않기 위한 구조다.
  */
  const overrides =
    await findMorningMeetingAutoHistoryOverrides(
      context.env.DB,
      startDate,
      endDate
    );

  return jsonResponse({
    ok:
      true,

    range: {
      startDate,
      endDate,
      dayCount
    },

    summary: {
      savedDateCount:
        savedDates.size,

      savedItemCount:
        items.length,

      overrideCount:
        overrides.length,

      resetCount:
        resets.length
    },

    items,

    overrides,

    resets
  });
}

/* =========================================================
  OIS 과거 LOG SHEET 전체 진행상황 조회

  GET:
  /api/ois-data-requests
    ?action=logsheet_batch_status

  선택:
  &startDate=2021-01-06
  &endDate=2023-07-20

  목적:
  - 브라우저를 새로고침해도 D1 기준 진행률 복원
  - pending / processing / complete / failed 집계
  - result_json은 읽지 않아 대량 조회 부담 최소화
========================================================= */

async function handleOisLegacyBatchStatusGet(
  context,
  requestUrl
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const user =
    authentication.user;


  if (
    user.role !==
      "super_admin"
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "최고관리자만 과거 업무일지 진행상황을 확인할 수 있습니다."
      },
      403
    );
  }


  await expireOldRequests(
    context.env.DB
  );


  let startDate =
    normalizeText(
      requestUrl.searchParams.get(
        "startDate"
      )
    );


  let endDate =
    normalizeText(
      requestUrl.searchParams.get(
        "endDate"
      )
    );


  /* =====================================================
    날짜가 전달되지 않은 경우

    가장 최근에 등록한 과거업무일지 요청 묶음을
    서버에서 자동으로 찾아 기간을 복원한다.

    62일 단위 여러 요청은 짧은 시간 안에 연속 등록되므로
    가장 최근 요청 시각 기준 이전 2시간을 같은 작업으로 본다.
  ====================================================== */

  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    )
  ) {
    const latestRow =
      await context.env.DB
        .prepare(`
          SELECT
            requested_at

          FROM ois_data_requests

          WHERE
            request_type =
              'logsheet_approval'

            AND requested_by_id = ?

          ORDER BY
            requested_at DESC

          LIMIT 1
        `)
        .bind(
          user.employeeNo
        )
        .first();


    if (
      !latestRow
    ) {
      return jsonResponse({
        ok:
          true,

        requestType:
          "logsheet_approval",

        range:
          null,

        summary: {
          total:
            0,

          complete:
            0,

          processing:
            0,

          pending:
            0,

          failed:
            0,

          missing:
            0,

          finished:
            0,

          remaining:
            0,

          percent:
            0
        },

        currentItem:
          null,

        failedItems:
          []
      });
    }


    const latestRequestedAt =
      new Date(
        normalizeText(
          latestRow.requested_at
        )
      );


    const batchWindowStart =
      new Date(
        (
          Number.isNaN(
            latestRequestedAt.getTime()
          )
            ? Date.now()
            : latestRequestedAt.getTime()
        ) -
        2 *
        60 *
        60 *
        1000
      )
        .toISOString();


    const batchWindowEnd =
      Number.isNaN(
        latestRequestedAt.getTime()
      )
        ? new Date()
            .toISOString()
        : latestRequestedAt
            .toISOString();


    const rangeRow =
      await context.env.DB
        .prepare(`
          SELECT
            MIN(
              target_date
            ) AS start_date,

            MAX(
              target_date
            ) AS end_date

          FROM ois_data_requests

          WHERE
            request_type =
              'logsheet_approval'

            AND requested_by_id = ?

            AND requested_at >= ?
            AND requested_at <= ?
        `)
        .bind(
          user.employeeNo,
          batchWindowStart,
          batchWindowEnd
        )
        .first();


    startDate =
      normalizeText(
        rangeRow?.start_date
      );


    endDate =
      normalizeText(
        rangeRow?.end_date
      );
  }


  const dayCount =
    getLimestoneUsageBatchDayCount(
      startDate,
      endDate
    );


  if (
    dayCount <
      1 ||
    dayCount >
      4000
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "과거 업무일지 진행상황 조회 기간을 확인해 주세요."
      },
      400
    );
  }


  /*
    result_json은 가져오지 않는다.

    진행률에 필요한 최소 정보만 조회하여
    900일 이상이어도 응답 크기를 작게 유지한다.
  */

  const queryResult =
    await context.env.DB
      .prepare(`
        SELECT
          id,
          target_date,
          status,

          requested_at,
          started_at,
          completed_at,

          agent_id,
          error_message,
          expires_at,
          updated_at

        FROM ois_data_requests

        WHERE
          request_type =
            'logsheet_approval'

          AND target_date >= ?
          AND target_date <= ?

        ORDER BY
          target_date ASC,
          requested_at DESC,
          updated_at DESC,
          id DESC
      `)
      .bind(
        startDate,
        endDate
      )
      .all();


  const rows =
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : [];


  /*
    같은 날짜에 재조회 이력이 여러 개 있으면
    가장 최근 요청 한 건만 현재 상태로 사용한다.
  */

  const latestByDate =
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
        ) ||
        latestByDate.has(
          targetDate
        )
      ) {
        return;
      }


      latestByDate.set(
        targetDate,
        {
          id:
            normalizeText(
              row.id
            ),

          targetDate,

          status:
            normalizeText(
              row.status
            )
              .toLowerCase(),

          requestedAt:
            normalizeText(
              row.requested_at
            ),

          startedAt:
            normalizeText(
              row.started_at
            ),

          completedAt:
            normalizeText(
              row.completed_at
            ),

          agentId:
            normalizeText(
              row.agent_id
            ),

          errorMessage:
            normalizeText(
              row.error_message
            ),

          expiresAt:
            normalizeText(
              row.expires_at
            ),

          updatedAt:
            normalizeText(
              row.updated_at
            )
        }
      );
    }
  );


  const counts = {
    total:
      dayCount,

    complete:
      0,

    processing:
      0,

    pending:
      0,

    failed:
      0,

    missing:
      0
  };


  let processingItem =
    null;


  let pendingItem =
    null;


  let latestCompletedDate =
    "";


  const failedItems =
    [];


  createLimestoneUsageBatchDates(
    startDate,
    endDate
  )
    .forEach(
      targetDate => {
        const item =
          latestByDate.get(
            targetDate
          );


        if (
          !item
        ) {
          counts.missing +=
            1;

          return;
        }


        if (
          item.status ===
            "complete"
        ) {
          counts.complete +=
            1;

          latestCompletedDate =
            targetDate;

          return;
        }


        if (
          item.status ===
            "processing"
        ) {
          counts.processing +=
            1;

          processingItem =
            processingItem ||
            item;

          return;
        }


        if (
          item.status ===
            "pending"
        ) {
          counts.pending +=
            1;

          pendingItem =
            pendingItem ||
            item;

          return;
        }


        if (
          item.status ===
            "failed"
        ) {
          counts.failed +=
            1;

          failedItems.push(
            item
          );

          return;
        }


        counts.missing +=
          1;
      }
    );


  const finished =
    counts.complete +
    counts.failed;


  const remaining =
    counts.processing +
    counts.pending +
    counts.missing;


  const percent =
    counts.total >
      0
      ? Math.min(
          100,

          Math.round(
            (
              finished /
              counts.total
            ) *
            100
          )
        )
      : 0;


  return jsonResponse({
    ok:
      true,

    requestType:
      "logsheet_approval",

    range: {
      startDate,
      endDate,
      totalDays:
        dayCount
    },

    summary: {
      ...counts,

      finished,

      remaining,

      percent
    },

    currentItem:
      processingItem ||
      pendingItem ||
      null,

    latestCompletedDate,

    failedItems:
      failedItems.slice(
        0,
        100
      )
  });
}

/* =========================================================
  GET 분기
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    if (
      !context.env.DB
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      );
    }


    const requestUrl =
      new URL(
        context.request.url
      );


    const action =
      normalizeText(
        requestUrl.searchParams.get(
          "action"
        )
      )
        .toLowerCase()
        .replace(
          /[\s-]+/g,
          "_"
        );

    if (action === "cofiring_daily") return await handleCofiringLiveGet(context, requestUrl);
    if (action === "cofiring_period") return await handleCofiringPeriodGet(context, requestUrl);
    if (action === "cofiring_period_latest") return await handleCofiringPeriodLatestGet(context, requestUrl);
    if (action === "cofiring_agent_idle") return await handleCofiringAgentIdle(context);

/*
  오전회의 자동수치 수정값 기간 조회
*/
if (
  action ===
    "morning_meeting_auto_history_overrides"
) {
  return await handleMorningMeetingAutoHistoryOverridesGet(
    context,
    requestUrl
  );
}

/*
  오전회의 선택일 전체 초기화 상태
*/
if (
  action ===
    "morning_meeting_auto_history_reset_status"
) {
  return await handleMorningMeetingAutoHistoryResetStatusGet(
    context,
    requestUrl
  );
}

/*
  OIS 과거 업무일지 기간 진행상황
*/
if (
  action ===
    "logsheet_batch_status"
) {
  return await handleOisLegacyBatchStatusGet(
    context,
    requestUrl
  );
}

/*
  저장된 자동수치 기간 조회
*/
if (
  action ===
    "completed_history"
) {
  return await handleCompletedHistoryGet(
    context,
    requestUrl
  );
}

/*
  저장된 부재료 일별 자료
*/
if (
  action ===
    "materials_history"
) {
  return await handleAuxiliaryMaterialHistoryGet(
    context,
    requestUrl
  );
}

    /*
      저장된 날짜별 사용량
    */
    if (
      action ===
        "usage_records"
    ) {
      return await handleLimestoneUsageRecordsGet(
        context,
        requestUrl
      );
    }

/*
  기간별 저장 사용량 조회
*/
if (
  action ===
    "usage_history"
) {
  return await handleLimestoneUsageHistoryGet(
    context,
    requestUrl
  );
}    

    /*
      기간 계산 진행률
    */
    if (
      action ===
        "usage_batch"
    ) {
      return await handleLimestoneUsageBatchGet(
        context,
        requestUrl
      );
    }



    /*
      일반 OIS 요청 상태 묶음 조회
    */
    if (
      action ===
        "status_batch"
    ) {
      return await handleStatusBatchGet(
        context,
        requestUrl
      );
    }


    /*
      회사 PC DataPARC Blower 묶음 요청
    */
    if (
      action ===
        "next_blower_batch"
    ) {
      return await handleAgentNextBlowerRuntimeProbeBatch(
        context,
        requestUrl
      );
    }


    /*
      회사 PC OIS · Excel 두 레인 동시 요청

      한 번의 HTTP 폴링으로
      OIS 최대 1건 + Excel 최대 1건을 가져온다.
    */
    if (
      action ===
        "next_lanes"
    ) {
      return await handleAgentNextLaneRequests(
        context,
        requestUrl
      );
    }
    /*
      회사 PC 다음 요청
    */
    if (
      action ===
        "next"
    ) {
      return await handleAgentNextRequest(
        context,
        requestUrl
      );
    }


    /*
      일반 OIS 요청 상태
    */
    return await handleUserGet(
      context,
      requestUrl
    );

  } catch (
    error
  ) {
    console.error(
      "OIS 요청 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "OIS 요청을 조회하지 못했습니다."
      },
      500
    );
  }
}

/* =========================================================
  기간 전체 OIS 계산 요청 생성

  POST:
  {
    action: "create_usage_batch",
    startDate: "2026-08-01",
    endDate: "2026-08-31"
  }

  처리:
  - 날짜별 OIS 요청 생성
  - 날짜별 요청과 배치 작업 연결
  - 화면을 닫아도 회사 PC 에이전트가 계속 처리
========================================================= */

async function createLimestoneUsageBatchRequest(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const user =
    authentication.user;


  const startDate =
    normalizeText(
      body.startDate ||
      body.start_date
    );


  const endDate =
    normalizeText(
      body.endDate ||
      body.end_date
    );


  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "기간 계산 시작일과 종료일을 확인해 주세요."
      },
      400
    );
  }


  const dates =
    createLimestoneUsageBatchDates(
      startDate,
      endDate
    );


  if (
    dates.length <
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "시작일은 종료일보다 늦을 수 없습니다."
      },
      400
    );
  }


  if (
    dates.length >
      MAXIMUM_LIMESTONE_USAGE_BATCH_DAYS
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          `기간 사용량 계산은 한 번에 최대 ${MAXIMUM_LIMESTONE_USAGE_BATCH_DAYS}일까지 실행할 수 있습니다.`
      },
      400
    );
  }


  await expireOldRequests(
    context.env.DB
  );


  /*
    같은 사용자가 같은 기간을 이미 처리 중이면
    중복 작업을 만들지 않고 기존 작업을 반환한다.
  */
  const existingRow =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM limestone_usage_batches

        WHERE
          start_date = ?
          AND end_date = ?
          AND requested_by_id = ?
          AND status IN (
            'pending',
            'processing'
          )

        ORDER BY
          created_at DESC

        LIMIT 1
      `)
      .bind(
        startDate,
        endDate,
        user.employeeNo
      )
      .first();


  if (
    existingRow
  ) {
    const existingBatch =
      convertLimestoneUsageBatchRow(
        existingRow
      );


    const existingProgress =
      await refreshLimestoneUsageBatchStatus(
        context.env.DB,
        existingBatch.id
      );


    return jsonResponse({
      ok:
        true,

      reused:
        true,

      ...existingProgress,

      message:
        "같은 기간의 사용량 계산을 이미 진행하고 있습니다."
    });
  }


  const batchId =
    crypto.randomUUID();


  const baseTime =
    Date.now();


  const createdAt =
    new Date(
      baseTime
    ).toISOString();


  const statements = [];


  statements.push(
    context.env.DB
      .prepare(`
        INSERT INTO limestone_usage_batches (
          id,

          start_date,
          end_date,
          total_days,

          status,

          requested_by_id,
          requested_by_name,

          created_at,
          completed_at,
          updated_at,

          last_error
        )
        VALUES (
          ?,

          ?,
          ?,
          ?,

          'pending',

          ?,
          ?,

          ?,
          '',
          ?,

          ''
        )
      `)
      .bind(
        batchId,

        startDate,
        endDate,
        dates.length,

        user.employeeNo,
        user.name,

        createdAt,
        createdAt
      )
  );


  dates.forEach(
    (
      usageDate,
      dateIndex
    ) => {
      const requestId =
        crypto.randomUUID();


      /*
        날짜 순서대로 대기열에서 처리되도록
        요청 시각을 1ms씩 증가시킨다.
      */
      const requestedAt =
        new Date(
          baseTime +
          dateIndex
        ).toISOString();


      const expiresAt =
        new Date(
          baseTime +
          (
            LIMESTONE_USAGE_BATCH_QUEUE_HOURS *
            60 *
            60 *
            1000
          ) +
          dateIndex
        ).toISOString();


      statements.push(
        context.env.DB
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
            )
            VALUES (
              ?,

              'limestone_stock',
              ?,
              'pending',

              ?,
              ?,

              ?,
              NULL,
              NULL,

              '',

              NULL,
              '',

              ?,
              ?
            )
          `)
          .bind(
            requestId,

            usageDate,

            user.employeeNo,
            user.name,

            requestedAt,

            expiresAt,
            requestedAt
          )
      );


      statements.push(
        context.env.DB
          .prepare(`
            INSERT INTO limestone_usage_batch_items (
              batch_id,
              usage_date,
              ois_request_id,
              created_at
            )
            VALUES (
              ?,
              ?,
              ?,
              ?
            )
          `)
          .bind(
            batchId,
            usageDate,
            requestId,
            requestedAt
          )
      );
    }
  );


  /*
    배치 작업과 날짜별 요청을
    하나의 D1 작업으로 저장한다.
  */
  await context.env.DB.batch(
    statements
  );


  const progress =
    await refreshLimestoneUsageBatchStatus(
      context.env.DB,
      batchId
    );


  return jsonResponse(
    {
      ok:
        true,

      reused:
        false,

      ...progress,

      message:
        `${dates.length}일의 석회석 사용량 계산 요청을 등록했습니다.`
    },
    201
  );
}

/* =========================================================
  OIS 과거 LOG SHEET 기간 요청 생성

  POST:
  {
    action: "create_logsheet_batch",
    startDate: "2022-09-01",
    endDate: "2022-10-31",
    forceRefresh: false
  }

  처리:
  - 날짜별 logsheet_approval 요청 생성
  - 이미 처리 중인 날짜는 기존 요청 재사용
  - forceRefresh=false:
      완료된 날짜도 기존 결과 재사용
  - forceRefresh=true:
      완료된 자료는 새로 조회
  - 최대 62일
========================================================= */

async function createOisLegacyLogBatchRequest(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const user =
    authentication.user;


  const startDate =
    normalizeText(
      body.startDate ||
      body.start_date
    );


  const endDate =
    normalizeText(
      body.endDate ||
      body.end_date
    );


  const forceRefresh =
    body.forceRefresh ===
      true;


  /* =====================================================
    날짜 검사
  ====================================================== */

  if (
    !isValidIsoDate(
      startDate
    ) ||
    !isValidIsoDate(
      endDate
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "OIS 과거 업무일지 시작일과 종료일을 확인해 주세요."
      },
      400
    );
  }


  /*
    기존 날짜 배열 생성 함수를 그대로 사용한다.

    함수 이름에는 Limestone이 들어 있지만
    실제 동작은 단순 YYYY-MM-DD 날짜 배열 생성이다.
  */

  const dates =
    createLimestoneUsageBatchDates(
      startDate,
      endDate
    );


  if (
    dates.length <
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "시작일은 종료일보다 늦을 수 없습니다."
      },
      400
    );
  }


  if (
    dates.length >
      MAXIMUM_OIS_LEGACY_BATCH_DAYS
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          `OIS 과거 업무일지는 한 번에 최대 ${MAXIMUM_OIS_LEGACY_BATCH_DAYS}일까지 요청할 수 있습니다.`
      },
      400
    );
  }


  await expireOldRequests(
    context.env.DB
  );


  const items = [];


  let createdCount =
    0;


  let reusedActiveCount =
    0;


  let reusedCompleteCount =
    0;


  const baseTime =
    Date.now();


  /* =====================================================
    날짜별 요청 생성
  ====================================================== */

  for (
    let dateIndex = 0;
    dateIndex <
      dates.length;
    dateIndex +=
      1
  ) {
    const targetDate =
      dates[
        dateIndex
      ];


    /* ===================================================
      1. 이미 pending / processing 상태가 있는지 확인

      forceRefresh 여부와 관계없이
      처리 중인 요청은 중복 생성하지 않는다.
    ==================================================== */

    const activeRow =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM ois_data_requests

          WHERE
            request_type =
              'logsheet_approval'

            AND target_date = ?

            AND status IN (
              'pending',
              'processing'
            )

          ORDER BY
            requested_at DESC

          LIMIT 1
        `)
        .bind(
          targetDate
        )
        .first();


    if (
      activeRow
    ) {
      items.push({
        ...convertRequestRow(
          activeRow
        ),

        batchDisposition:
          "reused_active"
      });


      reusedActiveCount +=
        1;


      continue;
    }


    /* ===================================================
      2. 저장된 완료자료 재사용

      forceRefresh=true이면 건너뛰고
      새 요청을 생성한다.
    ==================================================== */

    if (
      !forceRefresh
    ) {
      const completedRow =
        await context.env.DB
          .prepare(`
            SELECT
              *

            FROM ois_data_requests

            WHERE
              request_type =
                'logsheet_approval'

              AND target_date = ?

              AND status =
                'complete'

            ORDER BY
              completed_at DESC,
              requested_at DESC

            LIMIT 1
          `)
          .bind(
            targetDate
          )
          .first();


      if (
        completedRow
      ) {
        items.push({
          ...convertRequestRow(
            completedRow
          ),

          batchDisposition:
            "reused_complete"
        });


        reusedCompleteCount +=
          1;


        continue;
      }
    }


    /* ===================================================
      3. 신규 요청 생성
    ==================================================== */

    const requestId =
      crypto.randomUUID();


    /*
      날짜순으로 처리되게 요청시각을
      1ms씩 증가시킨다.
    */

    const requestedAt =
      new Date(
        baseTime +
        dateIndex
      );


    const requestedAtText =
      requestedAt
        .toISOString();


    /*
      과거자료는 여러 날짜가 대기할 수 있으므로
      일반 10분 제한을 사용하지 않는다.

      최대 72시간 동안 대기 가능.
    */

    const expiresAt =
      new Date(
        requestedAt.getTime() +
        (
          OIS_LEGACY_BATCH_QUEUE_HOURS *
          60 *
          60 *
          1000
        )
      );


    const expiresAtText =
      expiresAt
        .toISOString();


    await context.env.DB
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
        )
        VALUES (
          ?,

          'logsheet_approval',
          ?,
          'pending',

          ?,
          ?,

          ?,
          NULL,
          NULL,

          '',

          NULL,
          '',

          ?,
          ?
        )
      `)
      .bind(
        requestId,

        targetDate,

        user.employeeNo,
        user.name,

        requestedAtText,

        expiresAtText,
        requestedAtText
      )
      .run();


    items.push({
      id:
        requestId,

      requestType:
        "logsheet_approval",

      targetDate,

      status:
        "pending",

      requestedById:
        user.employeeNo,

      requestedByName:
        user.name,

      requestedAt:
        requestedAtText,

      startedAt:
        "",

      completedAt:
        "",

      agentId:
        "",

      result:
        null,

      errorMessage:
        "",

      expiresAt:
        expiresAtText,

      updatedAt:
        requestedAtText,

      batchDisposition:
        "created"
    });


    createdCount +=
      1;
  }


  /* =====================================================
    결과
  ====================================================== */

  return jsonResponse(
    {
      ok:
        true,

      requestType:
        "logsheet_approval",

      range: {
        startDate,

        endDate,

        totalDays:
          dates.length
      },

      createdCount,

      reusedActiveCount,

      reusedCompleteCount,

      reusedCount:
        reusedActiveCount +
        reusedCompleteCount,

      totalCount:
        items.length,

      forceRefresh,

      items,

      message:
        [
          `OIS 과거 업무일지 ${dates.length}일을 확인했습니다.`,

          `신규 요청 ${createdCount}일`,

          `진행 중 재사용 ${reusedActiveCount}일`,

          `완료자료 재사용 ${reusedCompleteCount}일`
        ].join(
          " "
        )
    },

    createdCount >
      0
      ? 201
      : 200
  );
}

/* =========================================================
  [FBHE-OIS-RUNTIME-ANALYSIS-V2]
  FBHE 진동 기간 일괄 요청

  - 최대 366일
  - 31일 단위 최대 12개 요청
  - 같은 구간의 완료자료는 일반 조회에서 재사용
  - 재조회(forceRefresh)는 새 요청을 만들되 진행 중 요청은 중복 생성하지 않음
========================================================= */

function compactFbheVibrationRequestRow(
  row,
  disposition = ""
) {
  if (!row) return null;

  return {
    id: normalizeText(row.id),
    requestType: normalizeText(row.request_type),
    targetDate: normalizeText(row.target_date),
    status: normalizeText(row.status),
    requestedAt: normalizeText(row.requested_at),
    startedAt: normalizeText(row.started_at),
    completedAt: normalizeText(row.completed_at),
    errorMessage: normalizeText(row.error_message),
    disposition
  };
}

/* [FBHE-OIS-RESUME-TIMEOUT-V4-R3] */
function isStaleFbheVibrationRequest(row) {
  if (!row) return false;
  const referenceText = normalizeText(
    row.updated_at ||
    row.started_at ||
    row.requested_at ||
    ""
  );
  const referenceTime = Date.parse(referenceText);
  return Number.isFinite(referenceTime) &&
    Date.now() - referenceTime >= FBHE_VIBRATION_STALL_MINUTES * 60 * 1000;
}

async function failFbheVibrationRequestIds(database, requestIds, reason) {
  const ids = [...new Set((requestIds || []).map(normalizeText).filter(Boolean))];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const result = await database
    .prepare([
      "UPDATE ois_data_requests",
      "SET status = 'failed', completed_at = ?, error_message = ?, updated_at = ?",
      "WHERE request_type = 'fbhe_vibration'",
      "AND id IN (" + placeholders + ")",
      "AND status IN ('pending', 'processing')"
    ].join("\n"))
    .bind(
      now,
      normalizeText(reason).slice(0, 1000) || "FBHE OIS request stopped.",
      now,
      ...ids
    )
    .run();
  return Number(result?.meta?.changes || 0);
}

async function failActiveFbheVibrationTarget(database, targetDate, reason) {
  const result = await database
    .prepare(`
      SELECT id
      FROM ois_data_requests
      WHERE request_type = 'fbhe_vibration'
        AND target_date = ?
        AND status IN ('pending', 'processing')
    `)
    .bind(targetDate)
    .all();
  const ids = (Array.isArray(result.results) ? result.results : [])
    .map(row => normalizeText(row.id))
    .filter(Boolean);
  return await failFbheVibrationRequestIds(database, ids, reason);
}


/* [SEAL-POT-OIS-SHADOW-V1-R3] */
async function failSealPotRuntimeRequestIds(database, requestIds, reason) {
  const ids = [...new Set((requestIds || []).map(normalizeText).filter(Boolean))];
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => "?").join(", ");
  const now = new Date().toISOString();

  const result = await database
    .prepare([
      "UPDATE ois_data_requests",
      "SET status = 'failed', completed_at = ?, error_message = ?, updated_at = ?",
      "WHERE request_type = 'seal_pot_runtime'",
      "AND id IN (" + placeholders + ")",
      "AND status IN ('pending', 'processing')"
    ].join("\n"))
    .bind(
      now,
      normalizeText(reason).slice(0, 1000) || "Seal Pot OIS request stopped.",
      now,
      ...ids
    )
    .run();

  return Number(result?.meta?.changes || 0);
}

async function failActiveSealPotRuntimeTarget(database, targetDate, reason) {
  const result = await database
    .prepare(`
      SELECT id
      FROM ois_data_requests
      WHERE request_type = 'seal_pot_runtime'
        AND target_date = ?
        AND status IN ('pending', 'processing')
    `)
    .bind(targetDate)
    .all();

  const ids = (Array.isArray(result.results) ? result.results : [])
    .map(row => normalizeText(row.id))
    .filter(Boolean);

  return await failSealPotRuntimeRequestIds(database, ids, reason);
}


function isPlainJsonObject(
  value
) {
  return Boolean(
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  );
}


function blowerRuntimeProbeValidationError(
  message
) {
  return {
    error:
      normalizeText(
        message
      ) ||
      "DataPARC Blower 운전시간 결과를 확인해 주세요."
  };
}


function normalizeBlowerRuntimeProbeState(
  value
) {
  const state =
    normalizeText(
      value
    )
      .toLowerCase();


  return [
    "running",
    "stopped"
  ].includes(
    state
  )
    ? state
    : "";
}


function normalizeBlowerRuntimeProbeResult(
  rawResult,
  probe,
  requestId,
  validationNow = new Date()
) {
  if (
    !isPlainJsonObject(
      rawResult
    ) ||
    !isValidBlowerRuntimeProbeIntentIdentity(probe, requestId)
  ) {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 운전시간 결과 형식이 올바르지 않습니다."
    );
  }


  let rawResultText =
    "";


  try {
    rawResultText =
      JSON.stringify(
        rawResult
      );
  } catch {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 운전시간 결과를 JSON으로 확인하지 못했습니다."
    );
  }


  if (
    new TextEncoder()
      .encode(
        rawResultText
      )
      .byteLength >
      BLOWER_RUNTIME_PROBE_MAX_RESULT_BYTES
  ) {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 운전시간 결과가 허용 크기를 초과했습니다."
    );
  }


  const exactTextFields = [
    ["requestType", BLOWER_RUNTIME_PROBE_REQUEST_TYPE],
    ["requestId", requestId],
    ["assetTag", probe.assetTag],
    ["dataParcTag", probe.dataParcTag],
    ["startAt", probe.startAt],
    ["endAt", probe.endAt],
    ["observedAt", probe.endAt],
    ["expectedLastReplacementAt", probe.expectedLastReplacementAt],
    ["expectedCycleStartState", probe.expectedCycleStartState],
    ["expectedCycleStartedAt", probe.expectedCycleStartedAt],
    ["expectedCycleStartRevision", probe.expectedCycleStartRevision],
    ["expectedCycleRuntimeRevision", probe.expectedCycleRuntimeRevision]
  ];


  for (
    const [
      fieldName,
      expectedValue
    ] of
      exactTextFields
  ) {
    if (
      typeof rawResult[fieldName] !==
        "string" ||
      rawResult[fieldName] !==
        normalizeText(
          expectedValue
        )
    ) {
      return blowerRuntimeProbeValidationError(
        `DataPARC Blower 결과의 ${fieldName} 값이 요청과 일치하지 않습니다.`
      );
    }
  }


  if (
    rawResult.schemaVersion !==
      BLOWER_RUNTIME_PROBE_SCHEMA_VERSION ||
    rawResult.ok !==
      true ||
    rawResult.readOnly !==
      true
  ) {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 결과의 버전 또는 read-only 표식을 확인해 주세요."
    );
  }


  const expectedChunks =
    buildBlowerRuntimeProbeChunks(
      probe.startAt,
      probe.endAt
    );


  const chunks =
    Array.isArray(
      rawResult.chunks
    )
      ? rawResult.chunks
      : [];


  if (
    rawResult.chunkDays !==
      BLOWER_RUNTIME_PROBE_CHUNK_DAYS ||
    !Number.isInteger(
      rawResult.chunkCount
    ) ||
    rawResult.chunkCount !==
      expectedChunks.length ||
    !Number.isInteger(
      rawResult.completedChunkCount
    ) ||
    rawResult.completedChunkCount !==
      expectedChunks.length ||
    Number(
      probe.chunkCount
    ) !==
      expectedChunks.length ||
    chunks.length !==
      expectedChunks.length ||
    chunks.length <
      1
  ) {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 31일 분할 조회가 모두 완료되지 않았습니다."
    );
  }


  const normalizedChunks = [];
  let chunkRunningSeconds =
    0;
  let chunkRunningHours =
    0;
  let previousEndState =
    "";


  for (
    let chunkIndex = 0;
    chunkIndex <
      chunks.length;
    chunkIndex +=
      1
  ) {
    const rawChunk =
      chunks[chunkIndex];


    const expectedChunk =
      expectedChunks[chunkIndex];


    if (
      !isPlainJsonObject(
        rawChunk
      ) ||
      !Number.isInteger(
        rawChunk.index
      ) ||
      rawChunk.index !==
        chunkIndex +
        1 ||
      normalizeText(
        rawChunk.startAt
      ) !==
        expectedChunk.startAt ||
      normalizeText(
        rawChunk.endAt
      ) !==
        expectedChunk.endAt
    ) {
      return blowerRuntimeProbeValidationError(
        `DataPARC Blower ${chunkIndex + 1}번 분할구간이 요청 범위와 일치하지 않습니다.`
      );
    }


    const startState =
      normalizeBlowerRuntimeProbeState(
        rawChunk.startState
      );


    const endState =
      normalizeBlowerRuntimeProbeState(
        rawChunk.endState
      );


    if (
      !startState ||
      !endState ||
      (
        previousEndState &&
        previousEndState !==
          startState
      )
    ) {
      return blowerRuntimeProbeValidationError(
        `DataPARC Blower ${chunkIndex + 1}번 분할구간의 RUN 상태 연결을 확인해 주세요.`
      );
    }


    const runningSeconds =
      Number(
        rawChunk.runningSeconds
      );


    const totalRunningHours =
      Number(
        rawChunk.totalRunningHours
      );


    const parsedChunkStart =
      parseStrictRfc3339(
        expectedChunk.startAt
      );


    const parsedChunkEnd =
      parseStrictRfc3339(
        expectedChunk.endAt
      );


    const chunkRangeSeconds =
      (
        parsedChunkEnd.timestamp -
        parsedChunkStart.timestamp
      ) /
      1000;


    if (
      typeof rawChunk.runningSeconds !==
        "number" ||
      !Number.isFinite(
        runningSeconds
      ) ||
      !Number.isInteger(
        runningSeconds
      ) ||
      runningSeconds <
        0 ||
      runningSeconds >
        chunkRangeSeconds +
        2 ||
      typeof rawChunk.totalRunningHours !==
        "number" ||
      !Number.isFinite(
        totalRunningHours
      ) ||
      totalRunningHours <
        0 ||
      Math.abs(
        totalRunningHours *
        3600 -
        runningSeconds
      ) >
        2
    ) {
      return blowerRuntimeProbeValidationError(
        `DataPARC Blower ${chunkIndex + 1}번 분할구간의 운전시간이 범위를 벗어났습니다.`
      );
    }


    normalizedChunks.push({
      index:
        chunkIndex +
        1,
      startAt:
        expectedChunk.startAt,
      endAt:
        expectedChunk.endAt,
      startState,
      endState,
      totalRunningHours:
        Math.round(
          totalRunningHours *
          1000000
        ) /
        1000000,
      runningSeconds:
        Math.round(
          runningSeconds
        )
    });


    chunkRunningSeconds +=
      runningSeconds;


    chunkRunningHours +=
      totalRunningHours;


    previousEndState =
      endState;
  }


  const startState =
    normalizeBlowerRuntimeProbeState(
      rawResult.startState
    );


  const endState =
    normalizeBlowerRuntimeProbeState(
      rawResult.endState
    );


  if (
    startState !==
      normalizedChunks[0].startState ||
    endState !==
      normalizedChunks[
        normalizedChunks.length -
        1
      ].endState
  ) {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 전체 구간의 시작·현재 RUN 상태가 분할 결과와 일치하지 않습니다."
    );
  }


  if (
    Object.prototype.hasOwnProperty.call(
      rawResult,
      "currentState"
    ) &&
    normalizeBlowerRuntimeProbeState(
      rawResult.currentState
    ) !==
      endState
  ) {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 현재 상태 값이 서로 일치하지 않습니다."
    );
  }


  if (
    Object.prototype.hasOwnProperty.call(
      rawResult,
      "isRunning"
    ) &&
    rawResult.isRunning !==
      (
        endState ===
          "running"
      )
  ) {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 현재 운전 여부가 RUN 상태와 일치하지 않습니다."
    );
  }


  const runningSeconds =
    Number(
      rawResult.runningSeconds
    );


  const totalRunningHours =
    Number(
      rawResult.totalRunningHours
    );


  const parsedStart =
    parseStrictRfc3339(
      probe.startAt
    );


  const parsedEnd =
    parseStrictRfc3339(
      probe.endAt
    );


  const rangeSeconds =
    (
      parsedEnd.timestamp -
      parsedStart.timestamp
    ) /
    1000;


  const aggregateToleranceSeconds =
    Math.max(
      2,
      chunks.length *
        2
    );


  if (
    typeof rawResult.runningSeconds !==
      "number" ||
    !Number.isFinite(
      runningSeconds
    ) ||
    !Number.isInteger(
      runningSeconds
    ) ||
    runningSeconds <
      0 ||
    runningSeconds >
      rangeSeconds +
      aggregateToleranceSeconds ||
    typeof rawResult.totalRunningHours !==
      "number" ||
    !Number.isFinite(
      totalRunningHours
    ) ||
    totalRunningHours <
      0 ||
    Math.abs(
      totalRunningHours *
      3600 -
      runningSeconds
    ) >
      aggregateToleranceSeconds ||
    Math.abs(
      chunkRunningSeconds -
      runningSeconds
    ) >
      aggregateToleranceSeconds ||
    Math.abs(
      chunkRunningHours *
      3600 -
      runningSeconds
    ) >
      aggregateToleranceSeconds
  ) {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 전체 운전시간이 조회기간 또는 분할 합계와 일치하지 않습니다."
    );
  }


  const parsedCollectedAt =
    parseStrictRfc3339(
      rawResult.collectedAt
    );


  const now =
    validationNow instanceof Date
      ? validationNow
      : new Date(
          validationNow
        );


  if (
    !parsedCollectedAt ||
    Number.isNaN(
      now.getTime()
    ) ||
    parsedCollectedAt.timestamp <
      parsedEnd.timestamp -
      5 *
      60 *
      1000 ||
    parsedCollectedAt.timestamp >
      now.getTime() +
      5 *
      60 *
      1000
  ) {
    return blowerRuntimeProbeValidationError(
      "DataPARC Blower 수집시각을 확인해 주세요."
    );
  }


  return {
    result: {
      schemaVersion:
        BLOWER_RUNTIME_PROBE_SCHEMA_VERSION,
      requestType:
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
      requestId:
        normalizeText(
          requestId
        ),
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
        BLOWER_RUNTIME_PROBE_CHUNK_DAYS,
      chunkCount:
        expectedChunks.length,
      completedChunkCount:
        expectedChunks.length,
      chunks:
        normalizedChunks,
      startState,
      endState,
      currentState:
        endState,
      isRunning:
        endState ===
          "running",
      totalRunningHours:
        Math.round(
          totalRunningHours *
          1000000
        ) /
        1000000,
      runningSeconds:
        Math.round(
          runningSeconds
        ),
      collectedAt:
        parsedCollectedAt.text
    }
  };
}


async function findActiveBlowerRuntimeProbeRequest(
  database,
  reuseKey,
  requestedById,
  assetTag = BLOWER_RUNTIME_PROBE_ASSET_TAG
) {
  const row =
    await database
      .prepare(`
        SELECT request.*
        FROM ois_data_requests AS request
        INNER JOIN blower_runtime_probe_intents_v4 AS intent
          ON intent.request_id = request.id
        WHERE request.request_type = ?
          AND request.requested_by_id = ?
          AND intent.asset_tag = ?
          AND intent.reuse_key = ?
          AND request.status IN ('pending', 'processing')
        ORDER BY datetime(request.requested_at) DESC, request.id DESC
        LIMIT 1
      `)
      .bind(
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
        requestedById,
        assetTag,
        reuseKey
      )
      .first();


  return row
    ? await findRequestById(
        database,
        row.id
      )
    : null;
}


async function retireStaleActiveBlowerRuntimeProbeRequests(
  database,
  reuseKey,
  staleRequestId,
  requestedById,
  now,
  assetTag = BLOWER_RUNTIME_PROBE_ASSET_TAG
) {
  await database.batch([
    database
      .prepare(`
        UPDATE ois_data_requests
        SET status = 'failed',
            completed_at = ?,
            error_message = ?,
            updated_at = ?
        WHERE request_type = ?
          AND requested_by_id = ?
          AND status IN ('pending', 'processing')
          AND id IN (
            SELECT request_id
            FROM blower_runtime_probe_intents_v4
            WHERE asset_tag = ?
              AND (
                COALESCE(reuse_key, '') <> ?
                OR request_id = ?
              )
          )
      `)
      .bind(
        now,
        "Blower Cycle snapshot changed before DataPARC probe completion.",
        now,
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
        requestedById,
        assetTag,
        reuseKey,
        staleRequestId
      ),

    database
      .prepare(`
        UPDATE blower_runtime_probe_intents_v4
        SET reuse_key = NULL,
            updated_at = ?
        WHERE asset_tag = ?
          AND (
            COALESCE(reuse_key, '') <> ?
            OR request_id = ?
          )
          AND EXISTS (
            SELECT 1
            FROM ois_data_requests
            WHERE id = blower_runtime_probe_intents_v4.request_id
              AND requested_by_id = ?
              AND status = 'failed'
          )
      `)
      .bind(
        now,
        assetTag,
        reuseKey,
        staleRequestId,
        requestedById
      )
  ]);
}


async function findCompleteBlowerRuntimeProbeRequest(
  database,
  reuseKey,
  requestedById,
  assetTag = BLOWER_RUNTIME_PROBE_ASSET_TAG
) {
  const row =
    await database
      .prepare(`
        SELECT request.*
        FROM ois_data_requests AS request
        INNER JOIN blower_runtime_probe_intents_v4 AS intent
          ON intent.request_id = request.id
        WHERE request.request_type = ?
          AND request.requested_by_id = ?
          AND intent.asset_tag = ?
          AND intent.reuse_key = ?
          AND request.status = 'complete'
        ORDER BY datetime(request.completed_at) DESC, request.id DESC
        LIMIT 1
      `)
      .bind(
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
        requestedById,
        assetTag,
        reuseKey
      )
      .first();


  return row
    ? await findRequestById(
        database,
        row.id
      )
    : null;
}


function isFreshBlowerRuntimeProbeWindow(
  requestItem,
  now = new Date()
) {
  const windowEnd =
    parseStrictRfc3339(
      requestItem?.probe?.endAt
    );


  const currentTime =
    now instanceof Date
      ? now.getTime()
      : new Date(
          now
        ).getTime();


  if (
    !windowEnd ||
    !Number.isFinite(
      currentTime
    )
  ) {
    return false;
  }


  const age =
    currentTime -
    windowEnd.timestamp;


  return (
    age >=
      0 &&
    age <=
      BLOWER_RUNTIME_PROBE_COMPLETE_FRESH_MINUTES *
      60 *
      1000
  );
}


function isFreshCompleteBlowerRuntimeProbeRequest(
  requestItem,
  now = new Date()
) {
  if (
    !requestItem ||
    requestItem.status !==
      "complete"
  ) {
    return false;
  }


  const windowEnd =
    parseStrictRfc3339(
      requestItem.probe?.endAt
    );


  const observedAt =
    parseStrictRfc3339(
      requestItem.result?.observedAt
    );


  const currentTime =
    now instanceof Date
      ? now.getTime()
      : new Date(
          now
        ).getTime();


  if (
    !windowEnd ||
    !observedAt ||
    !Number.isFinite(
      currentTime
    ) ||
    observedAt.timestamp !==
      windowEnd.timestamp
  ) {
    return false;
  }


  const freshnessMilliseconds =
    BLOWER_RUNTIME_PROBE_COMPLETE_FRESH_MINUTES *
    60 *
    1000;


  const windowAge =
    currentTime -
    windowEnd.timestamp;


  const observedAge =
    currentTime -
    observedAt.timestamp;


  return (
    windowAge >=
      0 &&
    windowAge <=
      freshnessMilliseconds &&
    observedAge >=
      0 &&
    observedAge <=
      freshnessMilliseconds
  );
}


function blowerRuntimeProbeCreateResponse(
  item,
  disposition,
  status = 200
) {
  return jsonResponse(
    blowerRuntimeProbeCreatePayload(
      item,
      disposition
    ),
    status
  );
}


function blowerRuntimeProbeCreatePayload(
  item,
  disposition
) {
  return {
    ok:
      true,
    reused:
      disposition !==
        "created",
    disposition,
    item,
    message:
      disposition ===
        "created"
        ? "선택한 기준시각 이후 Blower DataPARC read-only 조회를 요청했습니다."
        : disposition ===
            "reused_complete"
          ? "같은 Blower Cycle·Revision의 완료된 DataPARC 조회를 재사용합니다."
          : "진행 중인 Blower DataPARC 조회를 이어서 확인합니다."
  };
}


async function createBlowerRuntimeProbeRequest(
  context,
  body,
  internalOptions = {}
) {
  const authentication =
    internalOptions.authentication ||
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const mapping = resolveBlowerRuntimeProbeMapping(body);
  if (mapping.error) {
    return jsonResponse({ ok: false, code: mapping.code, message: mapping.error }, 400);
  }
  const { assetTag, dataParcTag } = mapping;


  const database =
    context.env.DB;


  const requestedById =
    normalizeEmployeeNo(
      authentication.user.employeeNo
    );


  if (
    internalOptions.prepareOnly !==
      true &&
    internalOptions.preflightDone !==
      true
  ) {
    await ensureBlowerRuntimeProbeSchema(
      database
    );


    await expireOldRequests(
      database
    );
  }


  const asset =
    internalOptions.assetsByTag instanceof Map
      ? internalOptions.assetsByTag.get(assetTag) || null
      : await database
      .prepare(`
        SELECT *
        FROM blower_history_assets
        WHERE tag_number = ?
        LIMIT 1
      `)
      .bind(
        assetTag
      )
      .first();


  if (
    !asset ||
    Number(
      asset.enabled
    ) !==
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,
        code:
          "BLOWER_RUNTIME_PROBE_ASSET_UNAVAILABLE",
        message:
          "선택한 Blower 활성 설비를 찾을 수 없습니다."
      },
      409
    );
  }


  const expectedLastReplacementAt =
    normalizeText(
      asset.last_replacement_at
    );


  const expectedCycleStartState =
    normalizeText(
      asset.cycle_start_state
    ) ||
    "legacy";


  const expectedCycleStartedAt =
    normalizeText(
      asset.cycle_started_at
    );


  const expectedCycleStartRevision =
    normalizeText(
      asset.cycle_start_revision
    );


  const expectedCycleRuntimeRevision =
    normalizeText(
      asset.cycle_runtime_revision
    );


  const assetSnapshot = {
    lastReplacementAt: expectedLastReplacementAt,
    cycleStartState: expectedCycleStartState,
    cycleStartedAt: expectedCycleStartedAt,
    cycleStartRevision: expectedCycleStartRevision,
    cycleRuntimeRevision: expectedCycleRuntimeRevision
  };


  const fbheSealBinaryRun =
    ["fbhe", "seal_pot"].includes(
      normalizeText(asset.blower_type)
    ) ||
    /^(?:104|204)HHL(?:60AP|10AN)(?:611|621|631)$/.test(assetTag);


  // FBHE / Seal Pot do not need a manually registered startup before a
  // DataPARC RUN=1/0 probe.  The existing Agent only accepts the historical
  // `legacy|started` wire contract, so an actual pending cycle is carried over
  // the wire as `legacy` while its exact revisions remain pinned.  Apply-time
  // CAS maps it back to the real pending row; no Agent restart is required.
  const signalOnlyCycle =
    fbheSealBinaryRun &&
    expectedCycleStartState === "pending";

  const probeExpectedCycleStartState =
    signalOnlyCycle ? "legacy" : expectedCycleStartState;

  const probeExpectedCycleStartedAt =
    signalOnlyCycle ? "" : expectedCycleStartedAt;

  const probeExpectedCycleStartRevision =
    signalOnlyCycle
      ? `signal-only-v1:${expectedCycleStartRevision}`
      : expectedCycleStartRevision;


  if (
    expectedCycleStartState === "pending" &&
    !fbheSealBinaryRun
  ) {
    return jsonResponse(
      {
        ok: false,
        code: "BLOWER_RUNTIME_PROBE_CYCLE_PENDING",
        message: "기동 대기 Cycle은 DataPARC 기간조회 대상에서 제외됩니다. 실제 기동 후 조회해 주세요."
      },
      409
    );
  }


  if (
    ![
      "legacy",
      "started",
      ...(fbheSealBinaryRun ? ["pending"] : [])
    ].includes(
      expectedCycleStartState
    ) ||
    !expectedLastReplacementAt ||
    !expectedCycleRuntimeRevision ||
    (
      expectedCycleStartState ===
        "started" &&
      (
        !expectedCycleStartedAt ||
        !expectedCycleStartRevision
      )
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,
        code:
          "BLOWER_RUNTIME_PROBE_CYCLE_NOT_READY",
        message:
          "V-Belt 교체 이력과 Cycle Revision을 확인한 뒤 DataPARC 기간조회를 실행해 주세요."
      },
      409
    );
  }


  if (body.unifiedRefresh === true && (
    body.expectedLastReplacementAt !== expectedLastReplacementAt ||
    body.expectedCycleStartState !== expectedCycleStartState ||
    body.expectedCycleStartedAt !== expectedCycleStartedAt ||
    body.expectedCycleStartRevision !== expectedCycleStartRevision ||
    body.expectedCycleRuntimeRevision !== expectedCycleRuntimeRevision
  )) {
    return jsonResponse({ ok: false, code: "BLOWER_RUNTIME_REFRESH_CYCLE_CONFLICT",
      message: "최신화 대기 중 교체·운전 이력이 변경되었습니다. 다시 최신화해 주세요." }, 409);
  }

  const parsedLastReplacementAt =
    parseStrictRfc3339(
      expectedLastReplacementAt
    );


  const parsedCycleStartedAt =
    expectedCycleStartState ===
      "started"
      ? parseStrictRfc3339(
          expectedCycleStartedAt
        )
      : null;


  const now =
    internalOptions.now instanceof Date
      ? internalOptions.now
      : new Date();


  const endAt =
    formatKstRfc3339(
      now
    );


  const parsedEndAt =
    parseStrictRfc3339(
      endAt
    );


  let requestedStartText =
    normalizeText(
      body.startAt ??
      body.start_at ??
      body.windowStart ??
      body.window_start ??
      ""
    );


  // BLOWER_INCREMENTAL_REFRESH_V1: only the top Latest action may append.
  // Never trust client-provided totals, checkpoints, or a manually entered start.
  let appendBase = null;
  if (body.incrementalRefresh === true) {
    if (body.unifiedRefresh !== true) return jsonResponse({ ok: false, code: "BLOWER_INCREMENTAL_MODE_INVALID",
      message: "증분 조회는 상단 최신화에서만 실행할 수 있습니다." }, 400);
    appendBase = internalOptions.appendBasesByTag instanceof Map
      ? internalOptions.appendBasesByTag.get(assetTag) || null
      : await loadAppendBase(database, asset, dataParcTag);
    if (body.requireIncrementalAppend === true && !appendBase) {
      return jsonResponse({ ok: false, code: "BLOWER_INCREMENTAL_BASE_REQUIRED",
        message: "기존 조회값 보호를 위해 전체 재조회로 전환하지 않았습니다. 증분 이어조회 기준을 확인해 주세요." }, 409);
    }
    if (appendBase) {
      requestedStartText = appendBase.observedAt;
      if (Date.parse(requestedStartText) >= parsedEndAt.timestamp) {
        if (internalOptions.prepareOnly === true) return {
          preparedBlowerRuntimeProbe: true,
          kind: "already_current",
          assetTag,
          dataParcTag,
          requestedById,
          assetSnapshot,
          appendBase,
          payload: { ok: true, upToDate: true, disposition: "already_current",
            message: "새 조회 구간 없음 · 마지막 성공값 유지" }
        };
        return jsonResponse({ ok: true, upToDate: true, disposition: "already_current",
          message: "새 조회 구간 없음 · 마지막 성공값 유지" });
      }
      if (
        internalOptions.prepareOnly !==
          true &&
        internalOptions.appendSchemaReady !==
          true
      ) {
        await ensureAppendSchema(database);
      }
    }
  }

  const parsedRequestedStart =
    requestedStartText
      ? parseStrictRfc3339(
          requestedStartText
        )
      : null;


  if (
    requestedStartText &&
    !parsedRequestedStart
  ) {
    return jsonResponse(
      {
        ok:
          false,
        code:
          "BLOWER_RUNTIME_PROBE_INVALID_START",
        message:
          "DataPARC 조회 시작일시는 시간대가 포함된 정확한 시각으로 선택해 주세요."
      },
      400
    );
  }


  const startAt =
    parsedRequestedStart
      ? formatKstRfc3339(
          parsedRequestedStart.date
        )
      : (
          parsedCycleStartedAt
            ? formatKstRfc3339(
                parsedCycleStartedAt.date
              )
            : (
                fbheSealBinaryRun && parsedLastReplacementAt
                  ? formatKstRfc3339(parsedLastReplacementAt.date)
                  : ""
              )
        );


  if (
    !startAt
  ) {
    return jsonResponse(
      {
        ok:
          false,
        code:
          "BLOWER_RUNTIME_PROBE_START_REQUIRED",
        message:
          "계획정비 이후의 DataPARC 조회 시작일시를 선택해 주세요."
      },
      400
    );
  }


  const parsedStartAt =
    parseStrictRfc3339(
      startAt
    );


  const minimumStartTimestamp =
    fbheSealBinaryRun && parsedCycleStartedAt
      ? Math.floor(parsedCycleStartedAt.timestamp / 1000) * 1000
      : (parsedLastReplacementAt?.timestamp ?? Number.POSITIVE_INFINITY);


  const maximumRangeMilliseconds =
    BLOWER_RUNTIME_PROBE_MAX_RANGE_DAYS *
    24 *
    60 *
    60 *
    1000;


  if (
    !parsedLastReplacementAt ||
    !parsedStartAt ||
    !parsedEndAt ||
    (
      parsedCycleStartedAt &&
      parsedCycleStartedAt.timestamp <
        parsedLastReplacementAt.timestamp
    ) ||
    parsedStartAt.timestamp <
      minimumStartTimestamp ||
    parsedStartAt.timestamp >=
      parsedEndAt.timestamp ||
    parsedEndAt.timestamp -
      parsedStartAt.timestamp >
        maximumRangeMilliseconds
  ) {
    return jsonResponse(
      {
        ok:
          false,
        code:
          "BLOWER_RUNTIME_PROBE_INVALID_RANGE",
        message:
          `DataPARC 조회 시작은 현재 V-Belt 교체 이후여야 하며 최대 ${BLOWER_RUNTIME_PROBE_MAX_RANGE_DAYS}일까지 조회할 수 있습니다.`
      },
      409
    );
  }


  const chunks =
    buildBlowerRuntimeProbeChunks(
      startAt,
      endAt
    );


  if (
    chunks.length <
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,
        code:
          "BLOWER_RUNTIME_PROBE_CHUNK_FAILED",
        message:
          "선택한 DataPARC 조회기간을 31일 단위로 나누지 못했습니다."
      },
      409
    );
  }


  const reuseKey =
    (appendBase ? "append-v1:" : "") +
    (signalOnlyCycle ? "signal-only-v1:" : "") +
    await hashText(
      JSON.stringify([
        BLOWER_RUNTIME_PROBE_SCHEMA_VERSION,
        requestedById,
        assetTag,
        startAt,
        expectedLastReplacementAt,
        expectedCycleStartState,
        expectedCycleStartedAt,
        expectedCycleStartRevision,
        expectedCycleRuntimeRevision,
        ...(assetTag === BLOWER_RUNTIME_PROBE_ASSET_TAG ? [] : [dataParcTag]),
        ...(appendBase ? ["incremental-v1", appendBase.eventId, appendBase.runningSeconds, appendBase.startAt] : [])
      ])
    );


  if (internalOptions.lookupOnly === true) return {
    preparedBlowerRuntimeProbeLookup: true,
    assetTag,
    reuseKey
  };


  const requestedAt =
    now.toISOString();


  const expiresAt =
    new Date(
      now.getTime() +
      BLOWER_RUNTIME_PROBE_LEASE_HOURS *
      60 *
      60 *
      1000
    )
      .toISOString();


  const targetDate =
    buildBlowerRuntimeProbeTargetDate(
      startAt,
      endAt,
      assetTag
    );


  const activeRequest =
    internalOptions.requestsByReuseKey instanceof Map
      ? (() => {
          const item = internalOptions.requestsByReuseKey.get(reuseKey);
          return ["pending", "processing"].includes(item?.status) ? item : null;
        })()
      : await findActiveBlowerRuntimeProbeRequest(
          database,
          reuseKey,
          requestedById,
          assetTag
        );


  if (
    activeRequest &&
    isFreshBlowerRuntimeProbeWindow(
      activeRequest,
      now
    )
  ) {
    if (internalOptions.prepareOnly === true) return {
      preparedBlowerRuntimeProbe: true,
      kind: "reused_active",
      assetTag,
      dataParcTag,
      requestedById,
      reuseKey,
      assetSnapshot,
      requestedByName:
        authentication.user.name,
      requestedAt,
      expiresAt,
      targetDate,
      startAt,
      endAt,
      chunkCount:
        chunks.length,
      expectedLastReplacementAt,
      probeExpectedCycleStartState,
      probeExpectedCycleStartedAt,
      probeExpectedCycleStartRevision,
      probeExpectedCycleRuntimeRevision:
        appendBase
          ? `append-v1:${expectedCycleRuntimeRevision}`
          : expectedCycleRuntimeRevision,
      appendBase,
      item: activeRequest
    };
    return blowerRuntimeProbeCreateResponse(
      activeRequest,
      "reused_active"
    );
  }


  if (
    internalOptions.prepareOnly !==
      true
  ) {
    await retireStaleActiveBlowerRuntimeProbeRequests(
      database,
      reuseKey,
      activeRequest?.id ||
        "",
      requestedById,
      now.toISOString(),
      assetTag
    );
  }


  const completeRequest =
    internalOptions.requestsByReuseKey instanceof Map
      ? (() => {
          const item = internalOptions.requestsByReuseKey.get(reuseKey);
          return item?.status === "complete" ? item : null;
        })()
      : await findCompleteBlowerRuntimeProbeRequest(
          database,
          reuseKey,
          requestedById,
          assetTag
        );


  if (
    isFreshCompleteBlowerRuntimeProbeRequest(
      completeRequest,
      now
    )
  ) {
    if (
      internalOptions.prepareOnly ===
        true
    ) {
      return {
        preparedBlowerRuntimeProbe: true,
        kind: "reused_complete",
        assetTag,
        requestedById,
        reuseKey,
        assetSnapshot,
        staleRequestId:
          activeRequest?.id ||
          "",
        hasStaleActiveRequest:
          internalOptions.requestsByReuseKey?.activeAssetTags instanceof Set &&
          internalOptions.requestsByReuseKey.activeAssetTags.has(
            assetTag
          ),
        item:
          completeRequest
      };
    }


    return blowerRuntimeProbeCreateResponse(
      completeRequest,
      "reused_complete"
    );
  }


  const requestId =
    crypto.randomUUID();


  if (
    internalOptions.prepareOnly ===
      true
  ) {
    return {
      preparedBlowerRuntimeProbe: true,
      kind: "created",
      assetTag,
      dataParcTag,
      requestedById,
      requestedByName:
        authentication.user.name,
      reuseKey,
      assetSnapshot,
      staleRequestId:
        activeRequest?.id ||
        "",
      completeRequestId:
        completeRequest?.id ||
        "",
      requestedAt,
      expiresAt,
      requestId,
      targetDate,
      startAt,
      endAt,
      chunkCount:
        chunks.length,
      expectedLastReplacementAt,
      probeExpectedCycleStartState,
      probeExpectedCycleStartedAt,
      probeExpectedCycleStartRevision,
      probeExpectedCycleRuntimeRevision:
        appendBase
          ? `append-v1:${expectedCycleRuntimeRevision}`
          : expectedCycleRuntimeRevision,
      appendBase
    };
  }


  await database
    .prepare(`
      UPDATE blower_runtime_probe_intents_v4
      SET reuse_key = NULL,
          updated_at = ?
      WHERE reuse_key = ?
        AND (
          EXISTS (
            SELECT 1
            FROM ois_data_requests
            WHERE id = blower_runtime_probe_intents_v4.request_id
              AND status = 'failed'
          )
          OR (
            request_id = ?
            AND EXISTS (
              SELECT 1
              FROM ois_data_requests
              WHERE id = blower_runtime_probe_intents_v4.request_id
                AND status = 'complete'
            )
          )
        )
    `)
    .bind(
      requestedAt,
      reuseKey,
      completeRequest?.id ||
        ""
    )
    .run();


  try {
    await database.batch([
      database
        .prepare(`
          INSERT INTO ois_data_requests (
            id, request_type, target_date, status,
            requested_by_id, requested_by_name, requested_at,
            started_at, completed_at, agent_id,
            result_json, error_message, expires_at, updated_at
          )
          VALUES (
            ?, ?, ?, 'pending',
            ?, ?, ?,
            NULL, NULL, '',
            NULL, '', ?, ?
          )
        `)
        .bind(
          requestId,
          BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
          targetDate,
          requestedById,
          authentication.user.name,
          requestedAt,
          expiresAt,
          requestedAt
        ),

      database
        .prepare(`
          INSERT INTO blower_runtime_probe_intents_v4 (
            request_id,
            reuse_key,
            schema_version,
            asset_tag,
            dataparc_tag,
            window_start,
            window_end,
            chunk_days,
            chunk_count,
            expected_last_replacement_at,
            expected_cycle_start_state,
            expected_cycle_started_at,
            expected_cycle_start_revision,
            expected_cycle_runtime_revision,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          requestId,
          reuseKey,
          BLOWER_RUNTIME_PROBE_SCHEMA_VERSION,
          assetTag,
          dataParcTag,
          startAt,
          endAt,
          BLOWER_RUNTIME_PROBE_CHUNK_DAYS,
          chunks.length,
          expectedLastReplacementAt,
          probeExpectedCycleStartState,
          probeExpectedCycleStartedAt,
          probeExpectedCycleStartRevision,
          // Older history deployments will reject this synthetic revision rather
          // than mistake a delta for a full-cycle total. The Agent just echoes it.
          appendBase ? `append-v1:${expectedCycleRuntimeRevision}` : expectedCycleRuntimeRevision,
          requestedAt,
          requestedAt
        ),
      ...(appendBase ? [appendIntentStatement(database, requestId, appendBase, requestedAt)] : [])
    ]);
  } catch (
    error
  ) {
    if (
      /UNIQUE constraint failed: blower_runtime_probe_intents_v4\.reuse_key/i.test(
        String(
          error?.message ||
          error
        )
      )
    ) {
      const concurrentRequest =
        await findActiveBlowerRuntimeProbeRequest(
          database,
          reuseKey,
          requestedById,
          assetTag
        );


      const reusableConcurrentActive =
        isFreshBlowerRuntimeProbeWindow(
          concurrentRequest
        )
          ? concurrentRequest
          : null;


      const concurrentCompleteRequest =
        reusableConcurrentActive
          ? null
          : await findCompleteBlowerRuntimeProbeRequest(
              database,
              reuseKey,
              requestedById,
              assetTag
            );


      const reusableConcurrentRequest =
        reusableConcurrentActive ||
        (
          isFreshCompleteBlowerRuntimeProbeRequest(
            concurrentCompleteRequest
          )
            ? concurrentCompleteRequest
            : null
        );


      if (
        reusableConcurrentRequest
      ) {
        return blowerRuntimeProbeCreateResponse(
          reusableConcurrentRequest,
          reusableConcurrentRequest.status ===
            "complete"
            ? "reused_complete"
            : "reused_active"
        );
      }
    }


    throw error;
  }


  const createdRequest =
    await findRequestById(
      database,
      requestId
    );


  return blowerRuntimeProbeCreateResponse(
    createdRequest,
    "created",
    201
  );
}


/* =========================================================
  Blower Latest atomic create batch

  The Agent polls once per second. All per-asset intents are validated before
  one D1 transaction makes any new queue row visible, so one Latest click
  cannot be split across several hidden-Excel startups during request create.
========================================================= */
const MAXIMUM_BLOWER_RUNTIME_CREATE_BATCH_ITEMS = MAXIMUM_STATUS_BATCH_IDS;
const MAXIMUM_BLOWER_RUNTIME_CREATE_BATCH_BYTES = 64 * 1024;

function blowerRuntimeProbePreparedRequestItem(prepared) {
  return {
    id: prepared.requestId,
    requestType: BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
    targetDate: prepared.targetDate,
    status: "pending",
    requestedById: prepared.requestedById,
    requestedByName: prepared.requestedByName,
    requestedAt: prepared.requestedAt,
    startedAt: "",
    completedAt: "",
    agentId: "",
    result: null,
    errorMessage: "",
    expiresAt: prepared.expiresAt,
    updatedAt: prepared.requestedAt,
    probe: {
      requestId: prepared.requestId,
      schemaVersion: BLOWER_RUNTIME_PROBE_SCHEMA_VERSION,
      requestType: BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
      assetTag: prepared.assetTag,
      dataParcTag: prepared.dataParcTag,
      startAt: prepared.startAt,
      endAt: prepared.endAt,
      chunkDays: BLOWER_RUNTIME_PROBE_CHUNK_DAYS,
      chunkCount: prepared.chunkCount,
      expectedLastReplacementAt: prepared.expectedLastReplacementAt,
      expectedCycleStartState: prepared.probeExpectedCycleStartState,
      expectedCycleStartedAt: prepared.probeExpectedCycleStartedAt,
      expectedCycleStartRevision: prepared.probeExpectedCycleStartRevision,
      expectedCycleRuntimeRevision: prepared.probeExpectedCycleRuntimeRevision,
      readOnly: true
    }
  };
}

async function loadBlowerRuntimeProbeBatchPreparation(database, mappings) {
  const assetTags = [...new Set(mappings.filter(item => !item.error).map(item => item.assetTag))];
  const tagsJson = JSON.stringify(assetTags);
  const assetsResult = await database.prepare(`SELECT * FROM blower_history_assets
    WHERE tag_number IN (SELECT value FROM json_each(?))`).bind(tagsJson).all();
  const assetsByTag = new Map((assetsResult.results || []).map(asset => [normalizeText(asset.tag_number), asset]));
  const eventsResult = await database.prepare(`SELECT event.* FROM blower_history_events AS event
    INNER JOIN blower_history_assets AS asset ON asset.tag_number=event.tag_number
    WHERE event.tag_number IN (SELECT value FROM json_each(?))
      AND event.event_type IN ('runtime_correction','startup','operation_start','operation_stop')
      AND datetime(event.event_date)>=datetime(asset.last_replacement_at)
    ORDER BY event.event_date DESC,event.updated_at DESC,event.created_at DESC,event.id DESC`)
    .bind(tagsJson).all();
  const eventsByTag = new Map();
  for (const event of eventsResult.results || []) {
    const tag = normalizeText(event.tag_number);
    if (!eventsByTag.has(tag)) eventsByTag.set(tag, []);
    eventsByTag.get(tag).push(event);
  }
  const appendBasesByTag = new Map();
  for (const mapping of mappings) {
    if (mapping.error || appendBasesByTag.has(mapping.assetTag)) continue;
    appendBasesByTag.set(mapping.assetTag, verifiedAppendBase(
      assetsByTag.get(mapping.assetTag), eventsByTag.get(mapping.assetTag) || [], mapping.dataParcTag
    ));
  }
  return {assetsByTag, appendBasesByTag};
}

async function loadBlowerRuntimeProbeBatchReuseRequests(
  database,
  reuseKeys,
  requestedById,
  assetTags = []
) {
  if (!reuseKeys.length && !assetTags.length) return new Map();
  const requestedReuseKeys = new Set(reuseKeys);
  const result = await database.prepare(`SELECT intent.*,request.*
    FROM blower_runtime_probe_intents_v4 AS intent
    INNER JOIN ois_data_requests AS request ON request.id=intent.request_id
    WHERE (intent.reuse_key IN (SELECT value FROM json_each(?))
      OR (intent.asset_tag IN (SELECT value FROM json_each(?))
        AND request.status IN ('pending','processing')))
      AND request.request_type=? AND request.requested_by_id=?
      AND request.status IN ('pending','processing','complete')`)
    .bind(JSON.stringify([...requestedReuseKeys]), JSON.stringify([...new Set(assetTags)]),
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE, requestedById).all();
  const requestsByReuseKey = new Map();
  const activeAssetTags = new Set();
  const activeGroupIdsByAsset = new Map();
  for (const row of result.results || []) {
    const item = convertRequestRow(row);
    const probe = convertBlowerRuntimeProbeIntentRow(row);
    if (['pending','processing'].includes(item.status)) {
      const activeAssetTag = normalizeText(row.asset_tag);
      activeAssetTags.add(activeAssetTag);
      const activeGroup = parseBlowerRuntimeProbeCreateGroupRequestId(item.id);
      if (activeGroup) {
        if (!activeGroupIdsByAsset.has(activeAssetTag)) {
          activeGroupIdsByAsset.set(activeAssetTag, new Set());
        }
        activeGroupIdsByAsset.get(activeAssetTag).add(activeGroup.groupId);
      }
    }
    const reuseKey = normalizeText(row.reuse_key);
    if (!requestedReuseKeys.has(reuseKey)) continue;
    requestsByReuseKey.set(reuseKey, {
      ...item,
      probe: isValidBlowerRuntimeProbeIntentIdentity(probe, item.id, item.targetDate) ? probe : null
    });
  }
  requestsByReuseKey.activeAssetTags = activeAssetTags;
  requestsByReuseKey.activeGroupIdsByAsset = activeGroupIdsByAsset;
  return requestsByReuseKey;
}

function blowerRuntimeProbeBatchMutationStatements(database, preparedItems, requestedById, now) {
  const prepared = preparedItems.filter(item => item?.preparedBlowerRuntimeProbe === true);
  if (!prepared.length) return [];

  const serializePlans = items => JSON.stringify(items.map(item => ({
    assetTag: item.assetTag,
    dataParcTag: item.dataParcTag || item.item?.probe?.dataParcTag || "",
    reuseKey: item.reuseKey,
    staleRequestId: item.staleRequestId || "",
    staleGroupId:
      parseBlowerRuntimeProbeCreateGroupRequestId(
        item.staleRequestId
      )?.groupId ||
      "",
    completeRequestId: item.kind === "created" ? item.completeRequestId || "" : "",
    createNew: item.kind === "created" ? 1 : 0,
    kind: item.kind,
    queueGuardKind: item.reusedActiveGuard === true ? "reused_active" : item.kind,
    itemId: item.item?.id || "",
    lastReplacementAt: item.assetSnapshot.lastReplacementAt,
    cycleStartState: item.assetSnapshot.cycleStartState,
    cycleStartedAt: item.assetSnapshot.cycleStartedAt,
    cycleStartRevision: item.assetSnapshot.cycleStartRevision,
    cycleRuntimeRevision: item.assetSnapshot.cycleRuntimeRevision,
    startAt: item.startAt || item.item?.probe?.startAt || "",
    endAt: item.endAt || item.item?.probe?.endAt || "",
    chunkCount: item.chunkCount || item.item?.probe?.chunkCount || 1,
    probeCycleStartState: item.probeExpectedCycleStartState || item.item?.probe?.expectedCycleStartState || "legacy",
    probeCycleStartedAt: item.probeExpectedCycleStartedAt || item.item?.probe?.expectedCycleStartedAt || "",
    probeCycleStartRevision: item.probeExpectedCycleStartRevision || item.item?.probe?.expectedCycleStartRevision || "",
    probeCycleRuntimeRevision: item.probeExpectedCycleRuntimeRevision || item.item?.probe?.expectedCycleRuntimeRevision || "",
    requestedAt: item.requestedAt || item.item?.requestedAt || now
  })));
  const guardPlans = serializePlans(prepared);
  const mutable = prepared.filter(item => ["created", "reused_complete"].includes(item.kind));
  const plans = serializePlans(mutable);
  const statements = [
    // A mismatched row selects one deliberately invalid request_id. V4 declares
    // it NOT NULL, so D1 aborts this entire batch before any retirement/insert.
    database.prepare(`/* BLOWER_RUNTIME_BATCH_ASSET_CAS_V1 */
      INSERT INTO blower_runtime_probe_intents_v4
        (request_id,reuse_key,schema_version,asset_tag,dataparc_tag,window_start,window_end,chunk_days,chunk_count,
         expected_last_replacement_at,expected_cycle_start_state,expected_cycle_started_at,expected_cycle_start_revision,
         expected_cycle_runtime_revision,created_at,updated_at)
      SELECT NULL,NULL,?,json_extract(plan.value,'$.assetTag'),json_extract(plan.value,'$.dataParcTag'),
        json_extract(plan.value,'$.startAt'),json_extract(plan.value,'$.endAt'),?,
        CAST(json_extract(plan.value,'$.chunkCount') AS INTEGER),json_extract(plan.value,'$.lastReplacementAt'),
        json_extract(plan.value,'$.probeCycleStartState'),json_extract(plan.value,'$.probeCycleStartedAt'),
        json_extract(plan.value,'$.probeCycleStartRevision'),json_extract(plan.value,'$.probeCycleRuntimeRevision'),
        json_extract(plan.value,'$.requestedAt'),json_extract(plan.value,'$.requestedAt')
      FROM json_each(?) AS plan
      LEFT JOIN blower_history_assets AS asset ON asset.tag_number=json_extract(plan.value,'$.assetTag')
      WHERE asset.tag_number IS NULL OR CAST(asset.enabled AS INTEGER)<>1
        OR COALESCE(TRIM(asset.last_replacement_at),'')<>json_extract(plan.value,'$.lastReplacementAt')
        OR COALESCE(NULLIF(TRIM(asset.cycle_start_state),''),'legacy')<>json_extract(plan.value,'$.cycleStartState')
        OR COALESCE(TRIM(asset.cycle_started_at),'')<>json_extract(plan.value,'$.cycleStartedAt')
        OR COALESCE(TRIM(asset.cycle_start_revision),'')<>json_extract(plan.value,'$.cycleStartRevision')
        OR COALESCE(TRIM(asset.cycle_runtime_revision),'')<>json_extract(plan.value,'$.cycleRuntimeRevision')
      LIMIT 1`).bind(BLOWER_RUNTIME_PROBE_SCHEMA_VERSION, BLOWER_RUNTIME_PROBE_CHUNK_DAYS, guardPlans)
  ];
  const guardedReuse = prepared.filter(item =>
    ["reused_active", "reused_complete"].includes(item.kind) || item.reusedActiveGuard === true);
  if (guardedReuse.length) statements.push(
    database.prepare(`/* BLOWER_RUNTIME_BATCH_QUEUE_CAS_V1 */
      INSERT INTO blower_runtime_probe_intents_v4
        (request_id,reuse_key,schema_version,asset_tag,dataparc_tag,window_start,window_end,chunk_days,chunk_count,
         expected_last_replacement_at,expected_cycle_start_state,expected_cycle_started_at,expected_cycle_start_revision,
         expected_cycle_runtime_revision,created_at,updated_at)
      SELECT 'queue-cas:'||json_extract(plan.value,'$.itemId'),NULL,?,NULL,
        json_extract(plan.value,'$.dataParcTag'),json_extract(plan.value,'$.startAt'),json_extract(plan.value,'$.endAt'),?,
        CAST(json_extract(plan.value,'$.chunkCount') AS INTEGER),json_extract(plan.value,'$.lastReplacementAt'),
        json_extract(plan.value,'$.probeCycleStartState'),json_extract(plan.value,'$.probeCycleStartedAt'),
        json_extract(plan.value,'$.probeCycleStartRevision'),json_extract(plan.value,'$.probeCycleRuntimeRevision'),
        json_extract(plan.value,'$.requestedAt'),json_extract(plan.value,'$.requestedAt')
      FROM json_each(?) AS plan
      WHERE json_extract(plan.value,'$.queueGuardKind') IN ('reused_active','reused_complete')
        AND NOT EXISTS (SELECT 1 FROM ois_data_requests AS request
          INNER JOIN blower_runtime_probe_intents_v4 AS intent ON intent.request_id=request.id
          WHERE request.id=json_extract(plan.value,'$.itemId') AND request.request_type=?
            AND request.requested_by_id=? AND intent.asset_tag=json_extract(plan.value,'$.assetTag')
            AND intent.reuse_key=json_extract(plan.value,'$.reuseKey')
            AND ((json_extract(plan.value,'$.queueGuardKind')='reused_active' AND request.status IN ('pending','processing'))
              OR (json_extract(plan.value,'$.queueGuardKind')='reused_complete' AND request.status='complete')))
      LIMIT 1`).bind(BLOWER_RUNTIME_PROBE_SCHEMA_VERSION, BLOWER_RUNTIME_PROBE_CHUNK_DAYS, guardPlans,
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE, requestedById)
  );
  if (!mutable.length) return statements;
  statements.push(
      database.prepare(`/* BLOWER_RUNTIME_BATCH_RETIRE_GROUP_CAS_V1 */
        WITH plans AS (
          SELECT json_extract(value,'$.assetTag') asset_tag,
                 json_extract(value,'$.reuseKey') reuse_key,
                 json_extract(value,'$.staleRequestId') stale_request_id,
                 CAST(json_extract(value,'$.createNew') AS INTEGER) create_new
          FROM json_each(?)
        ), initial_retire_ids AS (
          SELECT intent.request_id
          FROM blower_runtime_probe_intents_v4 AS intent
          JOIN ois_data_requests AS request ON request.id=intent.request_id
          JOIN plans ON plans.asset_tag=intent.asset_tag
          WHERE request.request_type=? AND request.requested_by_id=?
            AND (request.status IN ('pending','processing')
              OR (request.status='complete' AND plans.create_new=1))
            AND (COALESCE(intent.reuse_key,'')<>plans.reuse_key
              OR intent.request_id=plans.stale_request_id)
        ), retire_groups AS (
          SELECT DISTINCT
            substr(request.id,1,${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) group_id,
            request.requested_by_id requested_by_id
          FROM ois_data_requests AS request
          WHERE request.id IN (SELECT request_id FROM initial_retire_ids)
            AND length(request.id)=47
                AND ${blowerRuntimeProbeCreateGroupSql("request.id")}
        ), processing_conflicts AS (
          SELECT 'request:' || request.id conflict_id
          FROM ois_data_requests AS request
          WHERE request.id IN (SELECT request_id FROM initial_retire_ids)
            AND request.status='processing'
          UNION
          SELECT 'group:' || retire_group.group_id conflict_id
          FROM retire_groups AS retire_group
          WHERE EXISTS (SELECT 1 FROM ois_data_requests AS active_group
              WHERE active_group.request_type=?
                AND active_group.requested_by_id=retire_group.requested_by_id
                AND length(active_group.id)=47
                  AND ${blowerRuntimeProbeCreateGroupSql("active_group.id")}
                AND substr(active_group.id,1,${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH})=
                  retire_group.group_id
                AND active_group.status='processing')
        )
        INSERT INTO blower_runtime_probe_intents_v4
          (request_id,reuse_key,schema_version,asset_tag,dataparc_tag,window_start,window_end,chunk_days,chunk_count,
           expected_last_replacement_at,expected_cycle_start_state,expected_cycle_started_at,expected_cycle_start_revision,
           expected_cycle_runtime_revision,created_at,updated_at)
        SELECT 'retire-group-cas:'||processing_conflict.conflict_id,NULL,?,NULL,
          'retire-group-cas','','',?,1,'','legacy','','','',?,?
        FROM processing_conflicts AS processing_conflict
        LIMIT 1`)
        .bind(plans, BLOWER_RUNTIME_PROBE_REQUEST_TYPE, requestedById,
          BLOWER_RUNTIME_PROBE_REQUEST_TYPE,
          BLOWER_RUNTIME_PROBE_SCHEMA_VERSION, BLOWER_RUNTIME_PROBE_CHUNK_DAYS,
          now, now)
  );
  statements.push(
    database.prepare(`WITH plans AS (
        SELECT json_extract(value,'$.assetTag') asset_tag,
               json_extract(value,'$.reuseKey') reuse_key,
               json_extract(value,'$.staleRequestId') stale_request_id,
               json_extract(value,'$.staleGroupId') stale_group_id,
               CAST(json_extract(value,'$.createNew') AS INTEGER) create_new FROM json_each(?)
      ), initial_retire_ids AS (
        SELECT intent.request_id
        FROM blower_runtime_probe_intents_v4 intent
        JOIN ois_data_requests request ON request.id=intent.request_id
        JOIN plans ON plans.asset_tag=intent.asset_tag
        WHERE request.request_type=? AND request.requested_by_id=?
          AND (request.status IN ('pending','processing')
            OR (request.status='complete' AND plans.create_new=1))
          AND (COALESCE(intent.reuse_key,'')<>plans.reuse_key OR intent.request_id=plans.stale_request_id)
      ), retire_groups AS (
        SELECT DISTINCT
          substr(request.id,1,${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) group_id,
          request.requested_by_id requested_by_id
        FROM ois_data_requests request
        WHERE request.id IN (SELECT request_id FROM initial_retire_ids)
          AND length(request.id)=47
                AND ${blowerRuntimeProbeCreateGroupSql("request.id")}
      ), retire_ids AS (
        SELECT request_id FROM initial_retire_ids
        UNION
        SELECT grouped.id
        FROM ois_data_requests AS grouped
        JOIN retire_groups ON retire_groups.requested_by_id=grouped.requested_by_id
          AND length(grouped.id)=47
                AND ${blowerRuntimeProbeCreateGroupSql("grouped.id")}
          AND substr(grouped.id,1,${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH})=retire_groups.group_id
        WHERE grouped.request_type='${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
          AND grouped.requested_by_id=?
      ) UPDATE ois_data_requests
      SET status='failed',completed_at=?,error_message=?,updated_at=?
      WHERE request_type=? AND requested_by_id=? AND status IN ('pending','processing')
        AND id IN (SELECT request_id FROM retire_ids)`)
      .bind(plans, BLOWER_RUNTIME_PROBE_REQUEST_TYPE, requestedById, requestedById,
        now, "Blower Cycle snapshot changed before DataPARC probe completion.", now,
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE, requestedById),
    database.prepare(`WITH plans AS (
        SELECT json_extract(value,'$.assetTag') asset_tag,
               json_extract(value,'$.reuseKey') reuse_key,
               json_extract(value,'$.staleRequestId') stale_request_id,
               json_extract(value,'$.staleGroupId') stale_group_id,
               json_extract(value,'$.completeRequestId') complete_request_id,
               CAST(json_extract(value,'$.createNew') AS INTEGER) create_new FROM json_each(?)
      ), initial_retire_ids AS (
        SELECT intent.request_id
        FROM blower_runtime_probe_intents_v4 intent
        JOIN ois_data_requests request ON request.id=intent.request_id
        JOIN plans ON plans.asset_tag=intent.asset_tag
        WHERE request.request_type=? AND request.requested_by_id=?
          AND (request.status IN ('pending','processing')
            OR (request.status='complete' AND plans.create_new=1)
            OR (request.status='failed' AND request.completed_at=? AND request.updated_at=?
              AND request.error_message=?))
          AND (COALESCE(intent.reuse_key,'')<>plans.reuse_key OR intent.request_id=plans.stale_request_id)
      ), retire_groups AS (
        SELECT DISTINCT
          substr(request.id,1,${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) group_id,
          request.requested_by_id requested_by_id
        FROM ois_data_requests request
        WHERE request.id IN (SELECT request_id FROM initial_retire_ids)
          AND length(request.id)=47
                AND ${blowerRuntimeProbeCreateGroupSql("request.id")}
      ), retire_ids AS (
        SELECT request_id FROM initial_retire_ids
        UNION
        SELECT grouped.id
        FROM ois_data_requests grouped
        JOIN retire_groups ON retire_groups.requested_by_id=grouped.requested_by_id
          AND length(grouped.id)=47
                AND ${blowerRuntimeProbeCreateGroupSql("grouped.id")}
          AND substr(grouped.id,1,${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH})=retire_groups.group_id
        WHERE grouped.request_type='${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
      ) UPDATE blower_runtime_probe_intents_v4 SET reuse_key=NULL,updated_at=?
      WHERE request_id IN (SELECT request.id
        FROM ois_data_requests request
        INNER JOIN blower_runtime_probe_intents_v4 intent ON intent.request_id=request.id
        WHERE request.requested_by_id=? AND (
          (request.status='failed' AND (request.id IN (SELECT request_id FROM retire_ids)
            OR EXISTS (SELECT 1 FROM plans WHERE plans.create_new=1 AND intent.reuse_key=plans.reuse_key)))
          OR (request.status='complete' AND EXISTS (
            SELECT 1 FROM plans WHERE plans.create_new=1 AND request.id=plans.complete_request_id))))`)
      .bind(plans, BLOWER_RUNTIME_PROBE_REQUEST_TYPE, requestedById,
        now, now, "Blower Cycle snapshot changed before DataPARC probe completion.",
        now, requestedById)
  );

  const created = mutable.filter(item => item.kind === "created");
  if (!created.length) return statements;
  const requestRows = JSON.stringify(created.map(item => ({requestId:item.requestId,targetDate:item.targetDate,
    requestedById:item.requestedById,requestedByName:item.requestedByName,requestedAt:item.requestedAt,expiresAt:item.expiresAt})));
  statements.push(database.prepare(`INSERT INTO ois_data_requests
      (id,request_type,target_date,status,requested_by_id,requested_by_name,requested_at,started_at,completed_at,
       agent_id,result_json,error_message,expires_at,updated_at)
    SELECT json_extract(value,'$.requestId'),?,json_extract(value,'$.targetDate'),'pending',
      json_extract(value,'$.requestedById'),json_extract(value,'$.requestedByName'),json_extract(value,'$.requestedAt'),
      NULL,NULL,'',NULL,'',json_extract(value,'$.expiresAt'),json_extract(value,'$.requestedAt') FROM json_each(?)`)
    .bind(BLOWER_RUNTIME_PROBE_REQUEST_TYPE, requestRows));

  const intentRows = JSON.stringify(created.map(item => ({requestId:item.requestId,reuseKey:item.reuseKey,
    assetTag:item.assetTag,dataParcTag:item.dataParcTag,startAt:item.startAt,endAt:item.endAt,chunkCount:item.chunkCount,
    expectedLastReplacementAt:item.expectedLastReplacementAt,expectedCycleStartState:item.probeExpectedCycleStartState,
    expectedCycleStartedAt:item.probeExpectedCycleStartedAt,expectedCycleStartRevision:item.probeExpectedCycleStartRevision,
    expectedCycleRuntimeRevision:item.probeExpectedCycleRuntimeRevision,requestedAt:item.requestedAt})));
  statements.push(database.prepare(`INSERT INTO blower_runtime_probe_intents_v4
      (request_id,reuse_key,schema_version,asset_tag,dataparc_tag,window_start,window_end,chunk_days,chunk_count,
       expected_last_replacement_at,expected_cycle_start_state,expected_cycle_started_at,expected_cycle_start_revision,
       expected_cycle_runtime_revision,created_at,updated_at)
    SELECT json_extract(value,'$.requestId'),json_extract(value,'$.reuseKey'),?,json_extract(value,'$.assetTag'),
      json_extract(value,'$.dataParcTag'),json_extract(value,'$.startAt'),json_extract(value,'$.endAt'),?,
      CAST(json_extract(value,'$.chunkCount') AS INTEGER),json_extract(value,'$.expectedLastReplacementAt'),
      json_extract(value,'$.expectedCycleStartState'),json_extract(value,'$.expectedCycleStartedAt'),
      json_extract(value,'$.expectedCycleStartRevision'),json_extract(value,'$.expectedCycleRuntimeRevision'),
      json_extract(value,'$.requestedAt'),json_extract(value,'$.requestedAt') FROM json_each(?)`)
    .bind(BLOWER_RUNTIME_PROBE_SCHEMA_VERSION, BLOWER_RUNTIME_PROBE_CHUNK_DAYS, intentRows));

  const appends = created.filter(item => item.appendBase);
  if (appends.length) {
    const appendRows = JSON.stringify(appends.map(item => ({requestId:item.requestId,baseEventId:item.appendBase.eventId,
      baseRevision:item.appendBase.cycleRuntimeRevision,baseObservedAt:item.appendBase.observedAt,
      coverageStartAt:item.appendBase.startAt,baseRunningSeconds:item.appendBase.runningSeconds,requestedAt:item.requestedAt})));
    statements.push(database.prepare(`INSERT INTO blower_runtime_append_v1
        (request_id,base_event_id,base_revision,base_observed_at,coverage_start_at,base_running_seconds,created_at)
      SELECT json_extract(value,'$.requestId'),json_extract(value,'$.baseEventId'),json_extract(value,'$.baseRevision'),
        json_extract(value,'$.baseObservedAt'),json_extract(value,'$.coverageStartAt'),
        CAST(json_extract(value,'$.baseRunningSeconds') AS INTEGER),json_extract(value,'$.requestedAt') FROM json_each(?)`)
      .bind(appendRows));
  }
  return statements;
}

async function createBlowerRuntimeProbeBatchRequest(context, body) {
  const authentication = await getAuthenticatedUser(context);
  if (authentication.error) return authentication.error;
  let bodyBytes = Infinity;
  try { bodyBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength; } catch {}
  const requests = Array.isArray(body.requests) ? body.requests : [];
  const topKeysValid = Object.keys(body).every(key => ["action", "requests", "scheduledRefresh"].includes(key));
  if (!topKeysValid || body.action !== "create_blower_runtime_probe_batch" ||
      bodyBytes > MAXIMUM_BLOWER_RUNTIME_CREATE_BATCH_BYTES || !requests.length ||
      requests.length > MAXIMUM_BLOWER_RUNTIME_CREATE_BATCH_ITEMS) {
    return jsonResponse({ok:false,code:"BLOWER_RUNTIME_CREATE_BATCH_INVALID",
      message:"Blower 최신화 요청은 한 번에 1~24대의 일괄 요청으로 보내 주세요."}, 400);
  }
  const invalidIndex = requests.findIndex(item => !isPlainJsonObject(item) ||
    item.action !== "create_blower_runtime_probe" || item.unifiedRefresh !== true || item.incrementalRefresh !== true ||
    typeof item.requireIncrementalAppend !== "boolean" || item.confirmRunSignal !== true);
  if (invalidIndex >= 0) return jsonResponse({ok:false,code:"BLOWER_RUNTIME_CREATE_BATCH_ITEM_INVALID",failedIndex:invalidIndex,
    message:"Blower 최신화 일괄 요청 항목 형식을 확인해 주세요. 개별 요청으로 전환하지 않았습니다."}, 400);

  const mappings = requests.map(resolveBlowerRuntimeProbeMapping);
  const seenAssets = new Set();
  for (let index = 0; index < mappings.length; index += 1) {
    const assetTag = mappings[index].assetTag;
    if (!assetTag || !seenAssets.has(assetTag)) {
      if (assetTag) seenAssets.add(assetTag);
      continue;
    }
    return jsonResponse({ok:false,code:"BLOWER_RUNTIME_CREATE_BATCH_DUPLICATE_ASSET",failedIndex:index,assetTag,
      message:"같은 Blower가 최신화 일괄 요청에 두 번 포함되어 아무 요청도 등록하지 않았습니다."}, 400);
  }

  const database = context.env.DB;
  const requestedById = normalizeEmployeeNo(authentication.user.employeeNo);
  let scheduledGuard = null;
  if (Object.prototype.hasOwnProperty.call(body, "scheduledRefresh")) {
    if (String(context.request.headers.get("X-GS-Client-Mode") || "").trim().toLowerCase() === "mobile-monitoring") {
      return jsonResponse({ok:false,code:"SCHEDULE_DESKTOP_REQUIRED",message:"자동조회는 지정한 BCO1 PC에서만 실행합니다."}, 403);
    }
    try {
      scheduledGuard = await prepareScheduledBatch(database, authentication.user, body.scheduledRefresh);
    } catch (error) {
      return jsonResponse({ok:false,code:error.code || "SCHEDULE_CREATE_REJECTED",message:"자동조회 실행 조건이 변경되어 새 요청을 등록하지 않았습니다."}, error.status || 409);
    }
  }
  // Schema/expiry writes happen once before preparation; prepareOnly itself is read-only.
  await ensureBlowerRuntimeProbeSchema(database);
  await ensureAppendSchema(database);
  await expireOldRequests(database);

  const batchGroupId = crypto.randomUUID();
  let queueGuardRetrySignature = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const now = new Date();
    const batchPreparation = await loadBlowerRuntimeProbeBatchPreparation(database, mappings);
    const lookupKeys = [];
    for (let index = 0; index < requests.length; index += 1) {
      const lookup = await createBlowerRuntimeProbeRequest(context, requests[index], {
        authentication,preflightDone:true,appendSchemaReady:true,prepareOnly:true,lookupOnly:true,now,...batchPreparation
      });
      if (lookup?.preparedBlowerRuntimeProbeLookup === true) {
        lookupKeys.push(lookup.reuseKey);
        continue;
      }
      if (lookup?.preparedBlowerRuntimeProbe === true) continue;
      const payload = await lookup.json();
      if (lookup.status < 200 || lookup.status >= 300 || payload.ok === false) {
        return jsonResponse({ok:false,code:payload.code || "BLOWER_RUNTIME_CREATE_BATCH_ITEM_REJECTED",failedIndex:index,
          assetTag:normalizeText(requests[index].assetTag),message:payload.message ||
            "Blower 최신화 일괄 요청을 검증하지 못했습니다. 아무 요청도 등록하지 않았습니다."}, lookup.status);
      }
    }
    const requestsByReuseKey = await loadBlowerRuntimeProbeBatchReuseRequests(
      database,
      lookupKeys,
      requestedById,
      mappings.filter(item => !item.error).map(item => item.assetTag)
    );
    const preparedItems = [];
    for (let index = 0; index < requests.length; index += 1) {
      const requestBody = requests[index];
      const prepared = await createBlowerRuntimeProbeRequest(context, requestBody, {
        authentication,preflightDone:true,appendSchemaReady:true,prepareOnly:true,now,
        ...batchPreparation,requestsByReuseKey
      });
      if (prepared?.preparedBlowerRuntimeProbe === true) {
        preparedItems.push(prepared);
      } else {
        const payload = await prepared.json();
        if (prepared.status < 200 || prepared.status >= 300 || payload.ok === false) {
          return jsonResponse({ok:false,code:payload.code || "BLOWER_RUNTIME_CREATE_BATCH_ITEM_REJECTED",failedIndex:index,
            assetTag:normalizeText(requestBody.assetTag),message:payload.message ||
              "Blower 최신화 일괄 요청을 검증하지 못했습니다. 아무 요청도 등록하지 않았습니다."}, prepared.status);
        }
        preparedItems.push({preparedBlowerRuntimeProbe:false,kind:"immediate",
          assetTag:mappings[index].assetTag,payload});
      }
    }

    /*
      A pure reuse response leaves an existing request/group intact. New work
      absorbs every selected active request so this click still reaches one
      Excel batch. For a durable request this retires omitted old siblings too;
      keeping one member would otherwise split the click across Excel sessions.
      If a stale plan forces one selected group to be rebuilt, that conversion
      itself becomes new work and all other selected active requests converge
      on the same new group. The mutation CAS blocks any processing member.
    */
    const hasNewQueueWork =
      preparedItems.some(
        item =>
          item.kind ===
            "created"
      );


    const touchedActiveGroupIds =
      new Set();


    for (
      const item of
        preparedItems
    ) {
      if (
        item.kind !==
          "created" &&
        !(
          item.kind ===
            "reused_complete" &&
          item.hasStaleActiveRequest ===
            true
        )
      ) {
        continue;
      }


      for (
        const groupId of
          requestsByReuseKey.activeGroupIdsByAsset?.get(
            item.assetTag
          ) ||
          []
      ) {
        touchedActiveGroupIds.add(
          groupId
        );
      }
    }


    const activeGroups =
      new Map();


    const activeLegacyItems =
      [];


    for (
      const item of
        preparedItems
    ) {
      if (
        item.kind !==
          "reused_active"
      ) {
        continue;
      }


      const group =
        parseBlowerRuntimeProbeCreateGroupRequestId(
          item.item?.id
        );


      if (
        !group
      ) {
        activeLegacyItems.push(
          item
        );
        continue;
      }


      if (
        !activeGroups.has(
          group.groupId
        )
      ) {
        activeGroups.set(
          group.groupId,
          {
            metadata:
              group,
            items: []
          }
        );
      }


      activeGroups.get(
        group.groupId
      ).items.push(
        item
      );
    }


    const mustRegroupSelectedActive =
      hasNewQueueWork ||
      [...activeGroups.keys()].some(
        groupId =>
          touchedActiveGroupIds.has(
            groupId
          )
      );


    if (
      mustRegroupSelectedActive
    ) {
      for (
        const item of
          activeLegacyItems
      ) {
        item.reusedActiveGuard =
          true;
        item.kind =
          "created";
        item.staleRequestId =
          item.item.id;
      }
    }


    for (
      const activeGroup of
        activeGroups.values()
    ) {
      if (
        !mustRegroupSelectedActive
      ) {
        continue;
      }


      for (
        const item of
          activeGroup.items
      ) {
        item.reusedActiveGuard =
          true;
        item.kind =
          "created";
        item.staleRequestId =
          item.item.id;
      }
    }

    const createdItems = preparedItems.filter(item => item.kind === "created");
    createdItems.forEach((item, index) => {
      item.requestId = `brb1_${batchGroupId}_${String(createdItems.length).padStart(2, "0")}_${String(index).padStart(2, "0")}`;
    });
    const preparedSignature = JSON.stringify(preparedItems.map(item => [
      item.assetTag,item.kind,item.item?.id || "",item.reuseKey || ""
    ]));
    if (queueGuardRetrySignature && preparedSignature !== queueGuardRetrySignature) {
      return jsonResponse({ok:false,code:"BLOWER_RUNTIME_CREATE_BATCH_QUEUE_CONFLICT",
        message:"최신화 요청 등록 중 기존 Blower 조회 상태가 변경되어 아무 요청도 등록하지 않았습니다. 다시 최신화해 주세요."}, 409);
    }

    try {
      const statements = blowerRuntimeProbeBatchMutationStatements(database, preparedItems, requestedById, now.toISOString());
      if (scheduledGuard) {
        const receipt = {version:1,requestedCount:preparedItems.length,items:[],upToDateTags:[]};
        for (const item of preparedItems) {
          if (item.kind === "created") receipt.items.push({id:item.requestId,assetTag:item.assetTag});
          else if (item.item?.id) receipt.items.push({id:item.item.id,assetTag:item.assetTag});
          else if (item.payload?.upToDate === true) receipt.upToDateTags.push(item.assetTag);
          else throw new Error("Scheduled Blower batch receipt is incomplete.");
        }
        statements.unshift(...scheduledBatchStatements(database, scheduledGuard, receipt));
      }
      if (statements.length) await database.batch(statements);
    } catch (error) {
      if (isScheduledBatchConflict(error)) return jsonResponse({ok:false,code:"SCHEDULE_BATCH_CONFLICT",
        message:"다른 탭에서 이미 실행했거나 자동조회 설정이 변경되어 중복 요청을 등록하지 않았습니다."}, 409);
      const assetSnapshotRace = /NOT NULL constraint failed:\s*blower_runtime_probe_intents_v4\.request_id/i
        .test(String(error?.message || error));
      if (assetSnapshotRace) return jsonResponse({ok:false,code:"BLOWER_RUNTIME_CREATE_BATCH_SNAPSHOT_CONFLICT",
        message:"최신화 요청 등록 중 Blower 교체·운전 이력이 변경되어 아무 요청도 등록하지 않았습니다. 다시 최신화해 주세요."}, 409);
      const queueStateRace = /NOT NULL constraint failed:\s*blower_runtime_probe_intents_v4\.asset_tag/i
        .test(String(error?.message || error));
      if (queueStateRace && attempt === 0) {
        queueGuardRetrySignature = preparedSignature;
        continue;
      }
      if (queueStateRace) return jsonResponse({ok:false,code:"BLOWER_RUNTIME_CREATE_BATCH_QUEUE_CONFLICT",
        message:"최신화 요청 등록 중 기존 Blower 조회 상태가 변경되어 아무 요청도 등록하지 않았습니다. 다시 최신화해 주세요."}, 409);
      const reuseRace = /UNIQUE constraint failed:\s*blower_runtime_probe_intents_v4\.reuse_key/i.test(String(error?.message || error));
      if (reuseRace && attempt === 0) continue;
      if (reuseRace) return jsonResponse({ok:false,code:"BLOWER_RUNTIME_CREATE_BATCH_CONFLICT",
        message:"다른 화면의 Blower 최신화 요청과 겹쳐 일괄 등록하지 않았습니다. 잠시 후 다시 최신화해 주세요."}, 409);
      throw error;
    }

    const results = [];
    for (const prepared of preparedItems) {
      let payload;
      if (prepared.kind === "created") {
        payload = blowerRuntimeProbeCreatePayload(blowerRuntimeProbePreparedRequestItem(prepared), "created");
      } else if (prepared.kind === "reused_complete") {
        payload = blowerRuntimeProbeCreatePayload(prepared.item, "reused_complete");
      } else if (prepared.kind === "reused_active") {
        payload = blowerRuntimeProbeCreatePayload(prepared.item, "reused_active");
      } else if (prepared.kind === "already_current") {
        payload = prepared.payload;
      } else payload = prepared.payload;
      results.push({assetTag:prepared.assetTag,...payload});
    }
    const createdCount = results.filter(result => result.disposition === "created").length;
    const upToDateCount = results.filter(result => result.upToDate === true).length;
    const reusedCount = results.length - createdCount - upToDateCount;
    return jsonResponse({ok:true,atomic:true,batchVersion:1,requestedCount:requests.length,createdCount,reusedCount,
      upToDateCount,results,message:`Blower ${requests.length}대 요청을 한 번에 검증했습니다. 신규 ${createdCount}대 · 재사용 ${reusedCount}대 · 최신 ${upToDateCount}대`},
      createdCount ? 201 : 200);
  }
  return jsonResponse({ok:false,code:"BLOWER_RUNTIME_CREATE_BATCH_CONFLICT",
    message:"Blower 최신화 일괄 요청 상태가 변경되어 등록하지 않았습니다."}, 409);
}

async function cancelSealPotRuntimeBatchRequests(context, body) {
  const authentication = await getAuthenticatedUser(context);
  if (authentication.error) return authentication.error;

  const requestIds = [...new Set(
    (Array.isArray(body.requestIds || body.request_ids)
      ? (body.requestIds || body.request_ids)
      : [])
      .map(normalizeText)
      .filter(Boolean)
  )];

  if (requestIds.length < 1 || requestIds.length > MAXIMUM_STATUS_BATCH_IDS) {
    return jsonResponse(
      {ok: false, message: "중단할 Seal Pot OIS 요청을 확인해 주세요."},
      400
    );
  }

  const canceledCount = await failSealPotRuntimeRequestIds(
    context.env.DB,
    requestIds,
    normalizeText(body.reason) ||
      "Seal Pot OIS 기간조회가 진행되지 않아 자동 종료했습니다."
  );

  return jsonResponse({
    ok: true,
    canceledCount,
    message: "진행 중이던 Seal Pot OIS 요청만 종료했습니다. 완료자료는 보존됩니다."
  });
}

/* BLOWER_UNIFIED_REFRESH_V1: never reuse an unfinished-day snapshot as a closed day. */
function completedOisChunkCoversEnd(row, endDate) {
  const bound = new Date(`${endDate}T00:00:00+09:00`).getTime() + 86400000;
  return Number.isFinite(bound) && Date.parse(row.started_at || row.requested_at || "") >= bound;
}

async function createSealPotRuntimeBatchRequest(context, body) {
  const authentication = await getAuthenticatedUser(context);
  if (authentication.error) return authentication.error;

  const user = authentication.user;
  const startDate = normalizeText(body.startDate || body.start_date);
  const endDate = normalizeText(body.endDate || body.end_date);
  const forceRefresh = body.forceRefresh === true;
  const dayCount = inclusiveIsoDateCount(startDate, endDate);

  if (dayCount < 1 || dayCount > FBHE_VIBRATION_RANGE_MAX_DAYS) {
    return jsonResponse(
      {
        ok: false,
        message: `Seal Pot 조회기간은 1일 이상 ${FBHE_VIBRATION_RANGE_MAX_DAYS}일 이하로 선택해 주세요.`
      },
      400
    );
  }

  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  if (endDate > todayKst) {
    return jsonResponse(
      {ok: false, message: "미래 날짜의 Seal Pot OIS는 조회할 수 없습니다."},
      400
    );
  }

  const chunks = buildFbheVibrationRangeChunks(startDate, endDate);

  if (chunks.length < 1 || chunks.length > MAXIMUM_STATUS_BATCH_IDS) {
    return jsonResponse(
      {ok: false, message: "Seal Pot 조회기간을 OIS 요청 단위로 나누지 못했습니다."},
      400
    );
  }

  await expireOldRequests(context.env.DB);

  const requestedAt = new Date();
  const expiresAtText = new Date(
    requestedAt.getTime() + FBHE_VIBRATION_RANGE_QUEUE_HOURS * 60 * 60 * 1000
  ).toISOString();

  const items = [];
  let createdCount = 0;
  let reusedActiveCount = 0;
  let reusedCompleteCount = 0;
  let canceledCount = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];

    if (!forceRefresh) {
      const completedRow = await context.env.DB
        .prepare(`
          SELECT *
          FROM ois_data_requests
          WHERE request_type = 'seal_pot_runtime'
            AND target_date = ?
            AND status = 'complete'
          ORDER BY datetime(completed_at) DESC, datetime(requested_at) DESC, id DESC
          LIMIT 1
        `)
        .bind(chunk.targetDate)
        .first();

      if (completedRow && !(body.refreshLatest === true &&
          (chunk.endDate >= todayKst || !completedOisChunkCoversEnd(completedRow, chunk.endDate)))) {
        canceledCount += await failActiveSealPotRuntimeTarget(
          context.env.DB,
          chunk.targetDate,
          "이미 완료된 Seal Pot OIS 구간이 있어 중복 진행 요청을 종료했습니다."
        );

        reusedCompleteCount += 1;
        items.push(compactFbheVibrationRequestRow(completedRow, "reused_complete"));
        continue;
      }
    } else {
      canceledCount += await failActiveSealPotRuntimeTarget(
        context.env.DB,
        chunk.targetDate,
        "Seal Pot 전체 재조회로 기존 진행 요청을 종료했습니다."
      );
    }

    if (!forceRefresh) {
      let activeRow = await context.env.DB
        .prepare(`
          SELECT *
          FROM ois_data_requests
          WHERE request_type = 'seal_pot_runtime'
            AND target_date = ?
            AND status IN ('pending', 'processing')
          ORDER BY datetime(requested_at) DESC, id DESC
          LIMIT 1
        `)
        .bind(chunk.targetDate)
        .first();

      if (activeRow && isStaleFbheVibrationRequest(activeRow)) {
        canceledCount += await failSealPotRuntimeRequestIds(
          context.env.DB,
          [activeRow.id],
          "Seal Pot OIS 요청이 장시간 진행되지 않아 이어조회를 위해 종료했습니다."
        );
        activeRow = null;
      }

      if (activeRow) {
        reusedActiveCount += 1;
        items.push(compactFbheVibrationRequestRow(activeRow, "reused_active"));
        continue;
      }
    }

    const requestId = crypto.randomUUID();
    const requestedAtText = new Date(
      requestedAt.getTime() + chunkIndex
    ).toISOString();

    await context.env.DB
      .prepare(`
        INSERT INTO ois_data_requests (
          id, request_type, target_date, status,
          requested_by_id, requested_by_name, requested_at,
          started_at, completed_at, agent_id,
          result_json, error_message, expires_at, updated_at
        )
        VALUES (
          ?, 'seal_pot_runtime', ?, 'pending',
          ?, ?, ?,
          NULL, NULL, '',
          NULL, '', ?, ?
        )
      `)
      .bind(
        requestId,
        chunk.targetDate,
        user.employeeNo,
        user.name,
        requestedAtText,
        expiresAtText,
        requestedAtText
      )
      .run();

    createdCount += 1;

    items.push({
      id: requestId,
      requestType: "seal_pot_runtime",
      targetDate: chunk.targetDate,
      status: "pending",
      requestedAt: requestedAtText,
      startedAt: "",
      completedAt: "",
      errorMessage: "",
      disposition: "created"
    });
  }

  return jsonResponse(
    {
      ok: true,
      range: {
        startDate,
        endDate,
        dayCount,
        chunkCount: chunks.length,
        chunkDays: FBHE_VIBRATION_RANGE_CHUNK_DAYS
      },
      forceRefresh,
      createdCount,
      reusedActiveCount,
      reusedCompleteCount,
      canceledCount,
      items,
      message: [
        `Seal Pot ${dayCount}일을 ${chunks.length}개 구간으로 확인합니다.`,
        forceRefresh ? "전체 재조회" : `완료자료 재사용 ${reusedCompleteCount}구간`,
        `신규 ${createdCount}구간`,
        `진행 중 재사용 ${reusedActiveCount}구간`
      ].join(" ")
    },
    createdCount > 0 ? 201 : 200
  );
}


async function cancelFbheVibrationBatchRequests(context, body) {
  const authentication = await getAuthenticatedUser(context);
  if (authentication.error) return authentication.error;

  const requestIds = [...new Set(
    (Array.isArray(body.requestIds || body.request_ids)
      ? (body.requestIds || body.request_ids)
      : [])
      .map(normalizeText)
      .filter(Boolean)
  )];

  if (requestIds.length < 1 || requestIds.length > MAXIMUM_STATUS_BATCH_IDS) {
    return jsonResponse(
      { ok: false, message: "중단할 FBHE OIS 요청을 확인해 주세요." },
      400
    );
  }

  const canceledCount = await failFbheVibrationRequestIds(
    context.env.DB,
    requestIds,
    normalizeText(body.reason) ||
      "FBHE OIS 기간조회가 5분간 진행되지 않아 자동 종료했습니다."
  );

  return jsonResponse({
    ok: true,
    canceledCount,
    message:
      "진행 중이던 FBHE OIS 요청만 종료했습니다. 이미 완료된 구간 자료는 그대로 보존됩니다."
  });
}

async function createFbheVibrationBatchRequest(context, body) {
  const authentication = await getAuthenticatedUser(context);
  if (authentication.error) return authentication.error;

  const user = authentication.user;
  const startDate = normalizeText(body.startDate || body.start_date);
  const endDate = normalizeText(body.endDate || body.end_date);
  const forceRefresh = body.forceRefresh === true;
  const dayCount = inclusiveIsoDateCount(startDate, endDate);

  if (dayCount < 1 || dayCount > FBHE_VIBRATION_RANGE_MAX_DAYS) {
    return jsonResponse(
      {
        ok: false,
        message: `FBHE 진동 조회기간은 1일 이상 ${FBHE_VIBRATION_RANGE_MAX_DAYS}일 이하로 선택해 주세요.`
      },
      400
    );
  }

  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (endDate > todayKst) {
    return jsonResponse(
      { ok: false, message: "미래 날짜의 FBHE 진동은 조회할 수 없습니다." },
      400
    );
  }

  const chunks = buildFbheVibrationRangeChunks(startDate, endDate);
  if (chunks.length < 1 || chunks.length > MAXIMUM_STATUS_BATCH_IDS) {
    return jsonResponse(
      { ok: false, message: "FBHE 진동 조회기간을 안전한 OIS 요청 단위로 나누지 못했습니다." },
      400
    );
  }

  await expireOldRequests(context.env.DB);

  const requestedAt = new Date();
  const expiresAtText = new Date(
    requestedAt.getTime() + FBHE_VIBRATION_RANGE_QUEUE_HOURS * 60 * 60 * 1000
  ).toISOString();

  const items = [];
  let createdCount = 0;
  let reusedActiveCount = 0;
  let reusedCompleteCount = 0;
  let canceledCount = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];

    if (!forceRefresh) {
      const completedRow = await context.env.DB
        .prepare(`
          SELECT *
          FROM ois_data_requests
          WHERE request_type = 'fbhe_vibration'
            AND target_date = ?
            AND status = 'complete'
          ORDER BY datetime(completed_at) DESC, datetime(requested_at) DESC, id DESC
          LIMIT 1
        `)
        .bind(chunk.targetDate)
        .first();

      if (completedRow && !(body.refreshLatest === true &&
          (chunk.endDate >= todayKst || !completedOisChunkCoversEnd(completedRow, chunk.endDate)))) {
        canceledCount += await failActiveFbheVibrationTarget(
          context.env.DB,
          chunk.targetDate,
          "이미 완료된 FBHE OIS 구간이 있어 중복 진행 요청을 종료했습니다."
        );
        reusedCompleteCount += 1;
        items.push(
          compactFbheVibrationRequestRow(completedRow, "reused_complete")
        );
        continue;
      }
    } else {
      canceledCount += await failActiveFbheVibrationTarget(
        context.env.DB,
        chunk.targetDate,
        "FBHE OIS 전체 재조회로 기존 진행 요청을 종료했습니다."
      );
    }

    if (!forceRefresh) {
      let activeRow = await context.env.DB
        .prepare(`
          SELECT *
          FROM ois_data_requests
          WHERE request_type = 'fbhe_vibration'
            AND target_date = ?
            AND status IN ('pending', 'processing')
          ORDER BY datetime(requested_at) DESC, id DESC
          LIMIT 1
        `)
        .bind(chunk.targetDate)
        .first();

      if (activeRow && isStaleFbheVibrationRequest(activeRow)) {
        canceledCount += await failFbheVibrationRequestIds(
          context.env.DB,
          [activeRow.id],
          "FBHE OIS 요청이 5분간 완료되지 않아 이어조회를 위해 종료했습니다."
        );
        activeRow = null;
      }

      if (activeRow) {
        reusedActiveCount += 1;
        items.push(
          compactFbheVibrationRequestRow(activeRow, "reused_active")
        );
        continue;
      }
    }

    const requestId = crypto.randomUUID();
    const requestedAtText = new Date(
      requestedAt.getTime() + chunkIndex
    ).toISOString();

    await context.env.DB
      .prepare(`
        INSERT INTO ois_data_requests (
          id, request_type, target_date, status,
          requested_by_id, requested_by_name, requested_at,
          started_at, completed_at, agent_id,
          result_json, error_message, expires_at, updated_at
        )
        VALUES (
          ?, 'fbhe_vibration', ?, 'pending',
          ?, ?, ?,
          NULL, NULL, '',
          NULL, '', ?, ?
        )
      `)
      .bind(
        requestId,
        chunk.targetDate,
        user.employeeNo,
        user.name,
        requestedAtText,
        expiresAtText,
        requestedAtText
      )
      .run();

    createdCount += 1;
    items.push({
      id: requestId,
      requestType: "fbhe_vibration",
      targetDate: chunk.targetDate,
      status: "pending",
      requestedAt: requestedAtText,
      startedAt: "",
      completedAt: "",
      errorMessage: "",
      disposition: "created"
    });
  }

  return jsonResponse(
    {
      ok: true,
      range: {
        startDate,
        endDate,
        dayCount,
        chunkCount: chunks.length,
        chunkDays: FBHE_VIBRATION_RANGE_CHUNK_DAYS
      },
      forceRefresh,
      createdCount,
      reusedActiveCount,
      reusedCompleteCount,
      canceledCount,
      items,
      message: [
        `FBHE 진동 ${dayCount}일을 ${chunks.length}개 구간으로 확인합니다.`,
        forceRefresh ? "전체 재조회" : `완료자료 재사용 ${reusedCompleteCount}구간`,
        `신규 ${createdCount}구간`,
        `진행 중 재사용 ${reusedActiveCount}구간`
      ].join(" ")
    },
    createdCount > 0 ? 201 : 200
  );
}

/* =========================================================
  업무일지에서 새 OIS 요청 생성
========================================================= */

async function createUserRequest(
  context,
  body
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const user =
    authentication.user;


  const targetDate =
    normalizeText(
      body.targetDate ||
      body.target_date
    );


  const hasExplicitRequestType =
    Object.prototype.hasOwnProperty.call(
      body,
      "requestType"
    ) ||
    Object.prototype.hasOwnProperty.call(
      body,
      "request_type"
    );


  const rawRequestType =
    normalizeText(
      body.requestType ??
      body.request_type ??
      ""
    );


  const requestType =
    normalizeRequestType(
      rawRequestType
    );


  // [COFIRING-WEB-BRIDGE-V1] Explicit authenticated desktop-only daily intent.
  if (requestType === "cofiring_daily") return await createCofiringLiveRequest(context, body, user);
  if (requestType === "cofiring_period") return await createCofiringPeriodRequest(context, body, user);

  const forceRefresh =
    body.forceRefresh ===
      true;


  if (
    hasExplicitRequestType &&
    (
      !rawRequestType ||
      !requestType
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "지원하지 않는 OIS 요청 유형입니다."
      },
      400
    );
  }


  /* [FBHE-OPERATIONS-CONTROL-V1] Any authenticated desktop user may request FBHE vibration data. */


  if (
    !isValidIsoDate(
      targetDate
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "OIS 조회 날짜를 확인해 주세요."
      },
      400
    );
  }


  if (
    requestType ===
      "fbhe_vibration"
  ) {
    const todayKst =
      new Date(
        Date.now() +
        9 * 60 * 60 * 1000
      )
        .toISOString()
        .slice(
          0,
          10
        );


    if (
      targetDate >
        todayKst
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "미래 날짜의 FBHE 진동은 조회할 수 없습니다."
        },
        400
      );
    }
  }


  if (requestType === ORGANIC_SILO_DATAPARC_REQUEST_TYPE) {
    const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (targetDate < "2021-01-01" || targetDate >= todayKst) {
      return jsonResponse({ ok: false, message: "유기성 Silo는 2021-01-01 이후의 완료된 과거 날짜만 조회할 수 있습니다." }, 400);
    }
  }


  await expireOldRequests(
    context.env.DB
  );


  /*
    이미 처리 중인 같은 날짜 요청이 있으면
    새 요청을 만들지 않고 기존 요청을 반환한다.
  */
  const activeRow =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM ois_data_requests

        WHERE
          request_type = ?
          AND target_date = ?
          AND status IN (
            'pending',
            'processing'
          )

        ORDER BY
          requested_at DESC

        LIMIT 1
      `)
      .bind(
        requestType,
        targetDate
      )
      .first();


  if (
    activeRow
  ) {
    return jsonResponse({
      ok:
        true,

      reused:
        true,

      item:
        convertRequestRow(
          activeRow
        ),

      message:
        "같은 날짜의 OIS 자료를 이미 조회하고 있습니다."
    });
  }


  /*
    이미 완료된 결과가 있으면 재사용한다.

    강제 새로고침을 요청한 경우에는
    새 요청을 생성한다.
  */
  if (
    !forceRefresh
  ) {
    const completedRow =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM ois_data_requests

          WHERE
            request_type = ?
            AND target_date = ?
            AND status = 'complete'

          ORDER BY
            completed_at DESC,
            requested_at DESC

          LIMIT 1
        `)
        .bind(
          requestType,
          targetDate
        )
        .first();


    if (
      completedRow
    ) {
      return jsonResponse({
        ok:
          true,

        reused:
          true,

        item:
          convertRequestRow(
            completedRow
          ),

        message:
          "저장된 OIS 조회 결과를 불러왔습니다."
      });
    }
  }


  const requestId =
    crypto.randomUUID();


  const requestedAt =
    new Date();


  const expiresAt =
    new Date(
      requestedAt.getTime() +
      (
        REQUEST_TIMEOUT_MINUTES *
        60 *
        1000
      )
    );


  const requestedAtText =
    requestedAt.toISOString();


  const expiresAtText =
    expiresAt.toISOString();


  await context.env.DB
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
      )
      VALUES (
        ?,

        ?,
        ?,
        'pending',

        ?,
        ?,

        ?,
        NULL,
        NULL,

        '',

        NULL,
        '',

        ?,
        ?
      )
    `)
    .bind(
      requestId,

      requestType,
      targetDate,

      user.employeeNo,
      user.name,

      requestedAtText,

      expiresAtText,
      requestedAtText
    )
    .run();


  const createdRequest =
    await findRequestById(
      context.env.DB,
      requestId
    );


  return jsonResponse(
    {
      ok:
        true,

      reused:
        false,

      item:
        createdRequest,

      message:
        "OIS 자료 조회를 요청했습니다."
    },
    201
  );
}



/* =========================================================
  회사 PC 처리 완료

  석회석 재고 조회인 경우:
  1. OIS 결과 검증
  2. 당일 입고량 조회
  3. 사용량 자동 계산
  4. limestone_usage_records 저장
  5. OIS 요청 완료 처리
========================================================= */


/* =========================================================
  DAILY DATA SOLAR HISTORY REBUILD V1

  - source: Plant row 55 daily solar values
  - validate Jan-1 -> target date recurrence
  - update existing history rows only
  - preserve every non-solar value in values_json
========================================================= */

function roundSolarHistoryRebuildNumber(
  value
) {
  return Math.round(
    (
      Number(value) +
      Number.EPSILON
    ) *
      1000
  ) /
    1000;
}


function normalizeSolarHistoryRebuildNumber(
  value
) {
  if (
    value ===
      null ||
    value ===
      undefined ||
    normalizeText(
      value
    ) ===
      ""
  ) {
    return null;
  }

  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    ) ||
    number <
      0 ||
    number >
      1000000000000
  ) {
    return null;
  }

  return roundSolarHistoryRebuildNumber(
    number
  );
}


function isSameSolarHistoryRebuildNumber(
  left,
  right
) {
  const a =
    normalizeSolarHistoryRebuildNumber(
      left
    );

  const b =
    normalizeSolarHistoryRebuildNumber(
      right
    );

  if (
    a ===
      null ||
    b ===
      null
  ) {
    return (
      a ===
      b
    );
  }

  return (
    Math.abs(
      a -
      b
    ) <=
      0.002
  );
}


function validateSolarHistoryRebuildRows(
  rawRows,
  targetDate,
  normalizedResult
) {
  const normalizedTargetDate =
    normalizeText(
      targetDate
    );

  if (
    !isValidIsoDate(
      normalizedTargetDate
    )
  ) {
    return {
      ok:
        false,
      reason:
        "invalid_target_date",
      rows:
        []
    };
  }

  if (
    !Array.isArray(
      rawRows
    )
  ) {
    return {
      ok:
        false,
      reason:
        "history_rows_missing",
      rows:
        []
    };
  }

  const yearStart =
    normalizedTargetDate.slice(
      0,
      4
    ) +
    "-01-01";

  const expectedCount =
    inclusiveIsoDateCount(
      yearStart,
      normalizedTargetDate
    );

  if (
    expectedCount <
      1 ||
    expectedCount >
      366 ||
    rawRows.length !==
      expectedCount
  ) {
    return {
      ok:
        false,
      reason:
        "history_row_count_mismatch",
      expectedCount,
      receivedCount:
        rawRows.length,
      rows:
        []
    };
  }

  if (
    normalizedResult
      ?.solarCumulative
      ?.year
      ?.complete !==
        true
  ) {
    return {
      ok:
        false,
      reason:
        "year_source_incomplete",
      rows:
        []
    };
  }

  const rows = [];

  let runningYear =
    0;

  let runningMonth =
    0;

  let currentMonthKey =
    "";

  for (
    let index =
      0;
    index <
      rawRows.length;
    index +=
      1
  ) {
    const expectedDate =
      addIsoDateDays(
        yearStart,
        index
      );

    const rawRow =
      rawRows[index] &&
      typeof rawRows[index] ===
        "object" &&
      !Array.isArray(
        rawRows[index]
      )
        ? rawRows[index]
        : {};

    const date =
      normalizeText(
        rawRow.date
      );

    if (
      date !==
        expectedDate
    ) {
      return {
        ok:
          false,
        reason:
          "history_date_sequence_mismatch",
        index,
        expectedDate,
        receivedDate:
          date,
        rows:
          []
      };
    }

    const daily =
      normalizeSolarHistoryRebuildNumber(
        rawRow.daily
      );

    const monthly =
      normalizeSolarHistoryRebuildNumber(
        rawRow.monthly
      );

    const yearly =
      normalizeSolarHistoryRebuildNumber(
        rawRow.yearly
      );

    if (
      daily ===
        null ||
      monthly ===
        null ||
      yearly ===
        null
    ) {
      return {
        ok:
          false,
        reason:
          "history_value_invalid",
        index,
        date,
        rows:
          []
      };
    }

    const monthKey =
      date.slice(
        0,
        7
      );

    if (
      monthKey !==
        currentMonthKey
    ) {
      currentMonthKey =
        monthKey;

      runningMonth =
        0;
    }

    runningMonth +=
      daily;

    runningYear +=
      daily;

    const expectedMonthly =
      roundSolarHistoryRebuildNumber(
        runningMonth
      );

    const expectedYearly =
      roundSolarHistoryRebuildNumber(
        runningYear
      );

    if (
      !isSameSolarHistoryRebuildNumber(
        monthly,
        expectedMonthly
      ) ||
      !isSameSolarHistoryRebuildNumber(
        yearly,
        expectedYearly
      )
    ) {
      return {
        ok:
          false,
        reason:
          "history_recurrence_mismatch",
        index,
        date,
        expectedMonthly,
        receivedMonthly:
          monthly,
        expectedYearly,
        receivedYearly:
          yearly,
        rows:
          []
      };
    }

    rows.push({
      date,
      daily,
      monthly:
        expectedMonthly,
      yearly:
        expectedYearly
    });
  }

  const finalRow =
    rows[
      rows.length -
      1
    ];

  const resultDaily =
    normalizeSolarHistoryRebuildNumber(
      normalizedResult
        ?.solarDailyGeneration ??
      normalizedResult
        ?.solarDaily
    );

  const resultMonthly =
    normalizeSolarHistoryRebuildNumber(
      normalizedResult
        ?.solarMonthlyCumulative ??
      normalizedResult
        ?.solarCumulative
        ?.month
        ?.total
    );

  const resultYearly =
    normalizeSolarHistoryRebuildNumber(
      normalizedResult
        ?.solarYearlyCumulative ??
      normalizedResult
        ?.solarCumulative
        ?.year
        ?.total
    );

  if (
    !finalRow ||
    resultDaily ===
      null ||
    resultMonthly ===
      null ||
    resultYearly ===
      null ||
    !isSameSolarHistoryRebuildNumber(
      finalRow.daily,
      resultDaily
    ) ||
    !isSameSolarHistoryRebuildNumber(
      finalRow.monthly,
      resultMonthly
    ) ||
    !isSameSolarHistoryRebuildNumber(
      finalRow.yearly,
      resultYearly
    )
  ) {
    return {
      ok:
        false,
      reason:
        "target_totals_mismatch",
      rows:
        []
    };
  }

  return {
    ok:
      true,
    startDate:
      yearStart,
    endDate:
      normalizedTargetDate,
    rows
  };
}


async function rebuildSolarHistoryOverridesFromDailyData(
  database,
  options = {}
) {
  const requestItem =
    options.requestItem ||
    {};

  const normalizedResult =
    options.normalizedResult &&
    typeof options.normalizedResult ===
      "object" &&
    !Array.isArray(
      options.normalizedResult
    )
      ? options.normalizedResult
      : {};

  const validation =
    validateSolarHistoryRebuildRows(
      options.rawRows,
      requestItem.targetDate,
      normalizedResult
    );

  if (
    !validation.ok
  ) {
    return {
      ok:
        false,
      applied:
        false,
      reason:
        validation.reason,
      expectedCount:
        validation.expectedCount ??
        null,
      receivedCount:
        validation.receivedCount ??
        (
          Array.isArray(
            options.rawRows
          )
            ? options.rawRows.length
            : 0
        )
    };
  }

  await ensureMorningMeetingAutoHistoryOverridesTable(
    database
  );

  const existingItems =
    await findMorningMeetingAutoHistoryOverrides(
      database,
      validation.startDate,
      validation.endDate
    );


  const activeResetDates =
    new Set(
      (
        await findMorningMeetingAutoHistoryResets(
          database,
          validation.startDate,
          validation.endDate
        )
      )
        .filter(
          item =>
            item.active
        )
        .map(
          item =>
            item.targetDate
        )
    );

  const existingByDate =
    new Map(
      existingItems.map(
        item => [
          item.targetDate,
          item
        ]
      )
    );

  const actorId =
    normalizeText(
      requestItem.requestedById
    ) ||
    (
      "ois-agent:" +
      (
        normalizeText(
          options.agentId
        ) ||
        "unknown"
      )
    );

  const actorName =
    normalizeText(
      requestItem.requestedByName
    ) ||
    "OIS Agent";

  const now =
    new Date()
      .toISOString();

  const jobs = [];

  let absentCount =
    0;

  let unchangedCount =
    0;

  let resetActiveSkippedCount =
    0;

  for (
    const row of
    validation.rows
  ) {
    if (
      activeResetDates.has(
        row.date
      )
    ) {
      resetActiveSkippedCount +=
        1;

      continue;
    }


    const existingItem =
      existingByDate.get(
        row.date
      );

    /*
      Do not create dates that were not already part of the
      saved history. This avoids solar-only synthetic rows.
    */
    if (
      !existingItem
    ) {
      absentCount +=
        1;

      continue;
    }

    const existingValues =
      existingItem.values &&
      typeof existingItem.values ===
        "object" &&
      !Array.isArray(
        existingItem.values
      )
        ? existingItem.values
        : {};

    const desiredSolarValues =
      normalizeMorningMeetingAutoHistoryOverrideValues({
        powerSolar:
          row.daily,
        powerSolarMonthly:
          row.monthly,
        powerSolarYearly:
          row.yearly
      });

    const unchanged =
      isSameSolarHistoryRebuildNumber(
        existingValues.powerSolar,
        desiredSolarValues.powerSolar
      ) &&
      isSameSolarHistoryRebuildNumber(
        existingValues.powerSolarMonthly,
        desiredSolarValues.powerSolarMonthly
      ) &&
      isSameSolarHistoryRebuildNumber(
        existingValues.powerSolarYearly,
        desiredSolarValues.powerSolarYearly
      );

    if (
      unchanged
    ) {
      unchangedCount +=
        1;

      continue;
    }

    const mergedValues = {
      ...existingValues,
      ...desiredSolarValues
    };

    const revision =
      Number.isInteger(
        Number(
          existingItem.revision
        )
      ) &&
      Number(
        existingItem.revision
      ) >
        0
        ? Number(
            existingItem.revision
          )
        : 1;

    jobs.push({
      date:
        row.date,

      statement:
        database
          .prepare(`
            UPDATE
              morning_meeting_auto_history_overrides

            SET
              values_json = ?,
              updated_by_id = ?,
              updated_by_name = ?,
              updated_at = ?,
              revision = revision + 1

            WHERE
              target_date = ?
              AND revision = ?
              AND reset_active = 0
          `)
          .bind(
            JSON.stringify(
              mergedValues
            ),
            actorId,
            actorName,
            now,
            row.date,
            revision
          )
    });
  }

  let updatedCount =
    0;

  const conflictDates =
    [];

  const batchSize =
    50;

  for (
    let offset =
      0;
    offset <
      jobs.length;
    offset +=
      batchSize
  ) {
    const chunk =
      jobs.slice(
        offset,
        offset +
          batchSize
      );

    const results =
      await database.batch(
        chunk.map(
          job =>
            job.statement
        )
      );

    chunk.forEach(
      (
        job,
        index
      ) => {
        const changes =
          Number(
            results?.[index]
              ?.meta
              ?.changes ||
            0
          );

        if (
          changes ===
            1
        ) {
          updatedCount +=
            1;
        }
        else {
          conflictDates.push(
            job.date
          );
        }
      }
    );
  }


  const initialConflictCount =
    conflictDates.length;

  let retryRoundCount =
    0;

  let retryAttemptedCount =
    0;

  let retryUpdatedCount =
    0;

  let retryAlreadyCorrectCount =
    0;

  let pendingConflictDates =
    [
      ...new Set(
        conflictDates
      )
    ];


  for (
    let retryRound =
      1;
    retryRound <=
        2 &&
    pendingConflictDates.length >
      0;
    retryRound +=
      1
  ) {
    retryRoundCount =
      retryRound;

    const latestItems =
      await findMorningMeetingAutoHistoryOverrides(
        database,
        validation.startDate,
        validation.endDate
      );

    const latestActiveResetDates =
      new Set(
        (
          await findMorningMeetingAutoHistoryResets(
            database,
            validation.startDate,
            validation.endDate
          )
        )
          .filter(
            item =>
              item.active
          )
          .map(
            item =>
              item.targetDate
          )
      );

    const latestByDate =
      new Map(
        latestItems.map(
          item => [
            item.targetDate,
            item
          ]
        )
      );

    const sourceByDate =
      new Map(
        validation.rows.map(
          row => [
            row.date,
            row
          ]
        )
      );

    const retryJobs =
      [];

    const unresolvedWithoutRow =
      [];


    /*
      Prefer the current request date first because that is the
      row most likely to be racing with the foreground auto-save.
    */
    pendingConflictDates.sort(
      (
        left,
        right
      ) => {
        const targetDate =
          normalizeText(
            requestItem.targetDate
          );

        if (
          left ===
            targetDate &&
          right !==
            targetDate
        ) {
          return -1;
        }

        if (
          right ===
            targetDate &&
          left !==
            targetDate
        ) {
          return 1;
        }

        return left.localeCompare(
          right
        );
      }
    );


    for (
      const date of
      pendingConflictDates
    ) {
      if (
        latestActiveResetDates.has(
          date
        )
      ) {
        resetActiveSkippedCount +=
          1;

        continue;
      }


      const latestItem =
        latestByDate.get(
          date
        );

      const sourceRow =
        sourceByDate.get(
          date
        );

      if (
        !latestItem ||
        !sourceRow
      ) {
        unresolvedWithoutRow.push(
          date
        );

        continue;
      }

      const latestValues =
        latestItem.values &&
        typeof latestItem.values ===
          "object" &&
        !Array.isArray(
          latestItem.values
        )
          ? latestItem.values
          : {};

      const desiredSolarValues =
        normalizeMorningMeetingAutoHistoryOverrideValues({
          powerSolar:
            sourceRow.daily,

          powerSolarMonthly:
            sourceRow.monthly,

          powerSolarYearly:
            sourceRow.yearly
        });

      const isAlreadyCorrect =
        isSameSolarHistoryRebuildNumber(
          latestValues.powerSolar,
          desiredSolarValues.powerSolar
        ) &&
        isSameSolarHistoryRebuildNumber(
          latestValues.powerSolarMonthly,
          desiredSolarValues.powerSolarMonthly
        ) &&
        isSameSolarHistoryRebuildNumber(
          latestValues.powerSolarYearly,
          desiredSolarValues.powerSolarYearly
        );

      if (
        isAlreadyCorrect
      ) {
        retryAlreadyCorrectCount +=
          1;

        continue;
      }

      const latestRevision =
        Number.isInteger(
          Number(
            latestItem.revision
          )
        ) &&
        Number(
          latestItem.revision
        ) >
          0
          ? Number(
              latestItem.revision
            )
          : 1;

      const mergedValues = {
        ...latestValues,
        ...desiredSolarValues
      };

      retryJobs.push({
        date,

        statement:
          database
            .prepare(`
              UPDATE
                morning_meeting_auto_history_overrides

              SET
                values_json = ?,
                updated_by_id = ?,
                updated_by_name = ?,
                updated_at = ?,
                revision = revision + 1

              WHERE
                target_date = ?
                AND revision = ?
                AND reset_active = 0
            `)
            .bind(
              JSON.stringify(
                mergedValues
              ),
              actorId,
              actorName,
              new Date()
                .toISOString(),
              date,
              latestRevision
            )
      });
    }


    retryAttemptedCount +=
      retryJobs.length;

    const nextConflictDates =
      [
        ...unresolvedWithoutRow
      ];


    for (
      let offset =
        0;
      offset <
        retryJobs.length;
      offset +=
        batchSize
    ) {
      const chunk =
        retryJobs.slice(
          offset,
          offset +
            batchSize
        );

      const results =
        await database.batch(
          chunk.map(
            job =>
              job.statement
          )
        );

      chunk.forEach(
        (
          job,
          index
        ) => {
          const changes =
            Number(
              results?.[index]
                ?.meta
                ?.changes ||
              0
            );

          if (
            changes ===
              1
          ) {
            retryUpdatedCount +=
              1;
          }
          else {
            nextConflictDates.push(
              job.date
            );
          }
        }
      );
    }


    pendingConflictDates =
      [
        ...new Set(
          nextConflictDates
        )
      ];
  }


  const conflictCount =
    pendingConflictDates.length;

  return {
    ok:
      true,
    applied:
      true,
    source:
      "Plant row 55",
    startDate:
      validation.startDate,
    endDate:
      validation.endDate,
    sourceRowCount:
      validation.rows.length,
    existingRowCount:
      existingItems.length,
    updatedCount,
    unchangedCount,
    absentCount,
    resetActiveSkippedCount,
    initialConflictCount,

    retryRoundCount,

    retryAttemptedCount,

    retryUpdatedCount,

    retryAlreadyCorrectCount,

    conflictCount,
    complete:
      conflictCount ===
        0
  };
}


const MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_COMPLETIONS =
  24;


function parseBlowerRuntimeProbeCompletionBatch(
  body
) {
  const rawItems =
    Array.isArray(
      body?.items
    )
      ? body.items
      : [];


  if (
    rawItems.length <
      1 ||
    rawItems.length >
      MAXIMUM_BLOWER_RUNTIME_PROBE_BATCH_COMPLETIONS
  ) {
    return {
      error:
        "DataPARC Blower 완료 결과는 한 번에 1건 이상 24건 이하로 보내 주세요."
    };
  }


  const requestIds =
    new Set();


  const items = [];


  for (
    const rawItem
    of rawItems
  ) {
    if (
      !isPlainJsonObject(
        rawItem
      )
    ) {
      return {
        error:
          "DataPARC Blower 완료 항목 형식이 올바르지 않습니다."
      };
    }


    const requestId =
      normalizeText(
        rawItem.requestId
      );


    if (
      typeof rawItem.requestId !==
        "string" ||
      rawItem.requestId !==
        requestId ||
      !requestId ||
      requestId.length >
        128 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(
        requestId
      )
    ) {
      return {
        error:
          "DataPARC Blower 완료 요청 ID 형식이 올바르지 않습니다."
      };
    }


    if (
      requestIds.has(
        requestId
      )
    ) {
      return {
        error:
          "DataPARC Blower 완료 요청 ID는 묶음 안에서 중복될 수 없습니다."
      };
    }


    if (
      !isPlainJsonObject(
        rawItem.result
      ) ||
      rawItem.result.requestId !==
        requestId
    ) {
      return {
        error:
          "DataPARC Blower 완료 항목과 결과의 requestId가 일치하지 않습니다."
      };
    }


    if (
      rawItem.result.requestType !==
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE
    ) {
      return {
        error:
          "DataPARC Blower 완료 결과의 requestType을 확인해 주세요."
      };
    }


    requestIds.add(
      requestId
    );


    items.push({
      requestId,
      result:
        rawItem.result
    });
  }


  return {
    items
  };
}


async function completeAgentBlowerRuntimeProbeBatch(
  context,
  body
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const parsedBatch =
    parseBlowerRuntimeProbeCompletionBatch(
      body
    );


  if (
    parsedBatch.error
  ) {
    return jsonResponse(
      {
        ok:
          false,
        message:
          parsedBatch.error
      },
      400
    );
  }


  const failureItem = (
    requestId,
    httpStatus,
    message
  ) => {
    return {
      requestId,
      ok:
        false,
      status:
        "failed",
      httpStatus,
      message:
        normalizeText(
          message
        ) ||
        "DataPARC Blower 완료 처리에 실패했습니다."
    };
  };


  const requestIds =
    parsedBatch.items.map(
      item => {
        return item.requestId;
      }
    );


  let requestRows;
  let intentsByRequestId;


  try {
    await ensureBlowerRuntimeProbeSchema(
      context.env.DB
    );


    [
      requestRows,
      intentsByRequestId
    ] = await Promise.all([
      findRequestsByIds(
        context.env.DB,
        requestIds
      ),
      findBlowerRuntimeProbeIntentsByRequestIds(
        context.env.DB,
        requestIds
      )
    ]);
  } catch (
    error
  ) {
    const message =
      error instanceof
        Error
        ? error.message
        : error;


    return jsonResponse({
      ok:
        true,
      items:
        requestIds.map(
          requestId => {
            return failureItem(
              requestId,
              500,
              message
            );
          }
        )
    });
  }


  const requestRowsById =
    new Map(
      requestRows.map(
        row => {
          return [
            normalizeText(
              row?.id
            ),
            row
          ];
        }
      )
    );


  const completedAt =
    new Date();


  const completedAtText =
    completedAt.toISOString();


  const items =
    new Array(
      parsedBatch.items.length
    );


  const updateCandidates = [];


  for (
    let itemIndex = 0;
    itemIndex <
      parsedBatch.items.length;
    itemIndex +=
      1
  ) {
    const batchItem =
      parsedBatch.items[
        itemIndex
      ];


    const requestRow =
      requestRowsById.get(
        batchItem.requestId
      );


    if (
      !requestRow
    ) {
      items[itemIndex] =
        failureItem(
          batchItem.requestId,
          404,
          "완료할 OIS 요청을 찾을 수 없습니다."
        );

      continue;
    }


    const requestItem =
      convertRequestRow(
        requestRow
      );


    if (
      requestItem.requestType !==
        BLOWER_RUNTIME_PROBE_REQUEST_TYPE
    ) {
      items[itemIndex] =
        failureItem(
          batchItem.requestId,
          400,
          "DataPARC Blower 완료 요청이 아닙니다."
        );

      continue;
    }


    const rawProbe =
      intentsByRequestId.get(
        batchItem.requestId
      ) ||
      null;


    const probe =
      isValidBlowerRuntimeProbeIntentIdentity(
        rawProbe,
        requestItem.id,
        requestItem.targetDate
      )
        ? rawProbe
        : null;


    if (
      requestItem.status ===
        "complete"
    ) {
      const replayValidation =
        normalizeBlowerRuntimeProbeResult(
          batchItem.result,
          probe,
          batchItem.requestId,
          completedAt
        );


      if (
        replayValidation.error
      ) {
        items[itemIndex] =
          failureItem(
            batchItem.requestId,
            400,
            replayValidation.error
          );

        continue;
      }


      if (
        JSON.stringify(
          replayValidation.result
        ) !==
          JSON.stringify(
            requestItem.result
          )
      ) {
        items[itemIndex] =
          failureItem(
            batchItem.requestId,
            409,
            "이미 완료된 DataPARC Blower 요청과 다른 결과는 저장할 수 없습니다."
          );

        continue;
      }


      items[itemIndex] = {
        requestId:
          batchItem.requestId,
        ok:
          true,
        status:
          "complete",
        replayed:
          true
      };

      continue;
    }


    if (
      requestItem.status !==
        "processing" ||
      !requestItem.agentId ||
      requestItem.agentId !==
        authentication.agentId ||
      !Number.isFinite(
        Date.parse(
          requestItem.expiresAt
        )
      ) ||
      Date.parse(
        requestItem.expiresAt
      ) <=
        completedAt.getTime()
    ) {
      items[itemIndex] =
        failureItem(
          batchItem.requestId,
          409,
          "이 DataPARC Blower 요청을 가져간 Excel Agent만 처리시간 안에 완료할 수 있습니다."
        );

      continue;
    }


    const validation =
      normalizeBlowerRuntimeProbeResult(
        batchItem.result,
        probe,
        batchItem.requestId,
        completedAt
      );


    if (
      validation.error
    ) {
      items[itemIndex] =
        failureItem(
          batchItem.requestId,
          400,
          validation.error
        );

      continue;
    }


    updateCandidates.push({
      itemIndex,
      requestId:
        batchItem.requestId,
      statement:
        context.env.DB
          .prepare(`
            UPDATE ois_data_requests

            SET
              status = 'complete',
              completed_at = ?,
              agent_id = ?,
              result_json = ?,
              error_message = '',
              updated_at = ?

            WHERE
              id = ?
              AND request_type = 'blower_runtime_probe'
              AND status = 'processing'
              AND agent_id = ?
              AND expires_at > ?
          `)
          .bind(
            completedAtText,
            authentication.agentId,
            JSON.stringify(
              validation.result
            ),
            completedAtText,
            batchItem.requestId,
            authentication.agentId,
            completedAtText
          )
    });
  }


  if (
    updateCandidates.length >
      0
  ) {
    let updateResults;


    try {
      updateResults =
        await context.env.DB.batch(
          updateCandidates.map(
            candidate => {
              return candidate.statement;
            }
          )
        );
    } catch (
      error
    ) {
      const message =
        error instanceof
          Error
          ? error.message
          : error;


      for (
        const candidate
        of updateCandidates
      ) {
        items[candidate.itemIndex] =
          failureItem(
            candidate.requestId,
            500,
            message
          );
      }


      return jsonResponse({
        ok:
          true,
        items
      });
    }


    for (
      let candidateIndex = 0;
      candidateIndex <
        updateCandidates.length;
      candidateIndex +=
        1
    ) {
      const candidate =
        updateCandidates[
          candidateIndex
        ];


      items[candidate.itemIndex] =
        Number(
          updateResults?.[
            candidateIndex
          ]?.meta?.changes
        ) ===
          1
          ? {
              requestId:
                candidate.requestId,
              ok:
                true,
              status:
                "complete"
            }
          : failureItem(
              candidate.requestId,
              409,
              "OIS 요청 상태가 변경되어 완료 처리하지 못했습니다."
            );
    }
  }


  return jsonResponse({
    ok:
      true,
    items
  });
}


async function completeAgentRequest(
  context,
  body
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const requestId =
    normalizeText(
      body.requestId ||
      body.request_id
    );


  if (
    !requestId
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "완료할 OIS 요청 ID가 없습니다."
      },
      400
    );
  }


  const existingRequest =
    await findRequestById(
      context.env.DB,
      requestId
    );


  if (
    !existingRequest
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "완료할 OIS 요청을 찾을 수 없습니다."
      },
      404
    );
  }


  if (existingRequest.requestType === "cofiring_daily") return await completeCofiringLiveRequest(context, body, authentication, existingRequest);
  if (existingRequest.requestType === "cofiring_period") return await completeCofiringPeriodRequest(context, body, authentication, existingRequest);

  if (existingRequest.requestType === ORGANIC_SILO_DATAPARC_REQUEST_TYPE) {
    if (!existingRequest.agentId || existingRequest.agentId !== authentication.agentId ||
        !["processing", "complete"].includes(existingRequest.status) ||
        (existingRequest.status === "processing" &&
          !(Date.parse(existingRequest.expiresAt) > Date.now()))) {
      return jsonResponse({ ok: false, code: "ORGANIC_SILO_CLAIM_REQUIRED",
        message: "이 유기성 Silo 요청을 가져간 Excel Agent만 처리시간 안에 완료할 수 있습니다." }, 409);
    }
    if (existingRequest.status === "complete") {
      const replay = normalizeOrganicSiloDataParcResult(body.result, existingRequest.targetDate);
      if (replay.error) return jsonResponse({ ok: false, message: replay.error }, 400);
      if (JSON.stringify(replay.result) !== JSON.stringify(existingRequest.result)) {
        return jsonResponse({ ok: false, code: "ORGANIC_SILO_RESULT_CONFLICT",
          message: "이미 완료된 유기성 Silo 요청과 다른 결과는 저장할 수 없습니다." }, 409);
      }
      return jsonResponse({ ok: true, replayed: true, item: existingRequest,
        message: "이미 저장된 유기성 Silo 재고를 확인했습니다." });
    }
  }


  if (
    existingRequest.requestType ===
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE &&
    existingRequest.status ===
      "complete"
  ) {
    const replayValidation =
      normalizeBlowerRuntimeProbeResult(
        body.result,
        existingRequest.probe,
        requestId
      );


    if (
      replayValidation.error
    ) {
      return jsonResponse(
        {
          ok:
            false,
          code:
            "BLOWER_RUNTIME_PROBE_INVALID_RESULT",
          message:
            replayValidation.error
        },
        400
      );
    }


    if (
      JSON.stringify(
        replayValidation.result
      ) !==
        JSON.stringify(
          existingRequest.result
        )
    ) {
      return jsonResponse(
        {
          ok:
            false,
          code:
            "BLOWER_RUNTIME_PROBE_RESULT_CONFLICT",
          message:
            "이미 완료된 DataPARC Blower 요청과 다른 결과는 저장할 수 없습니다."
        },
        409
      );
    }


    return jsonResponse({
      ok:
        true,
      replayed:
        true,
      item:
        existingRequest,
      message:
        "이미 저장된 DataPARC Blower read-only 결과를 확인했습니다."
    });
  }


  if (
    existingRequest.requestType ===
      BLOWER_RUNTIME_PROBE_REQUEST_TYPE
  ) {
    const expiresAt =
      new Date(
        existingRequest.expiresAt
      );


    if (
      existingRequest.status !==
        "processing" ||
      !existingRequest.agentId ||
      existingRequest.agentId !==
        authentication.agentId ||
      Number.isNaN(
        expiresAt.getTime()
      ) ||
      expiresAt <=
        new Date()
    ) {
      return jsonResponse(
        {
          ok:
            false,
          code:
            "BLOWER_RUNTIME_PROBE_CLAIM_REQUIRED",
          message:
            "이 DataPARC Blower 요청을 가져간 Excel Agent만 처리시간 안에 완료할 수 있습니다."
        },
        409
      );
    }
  }


  if (
    ![
      "pending",
      "processing"
    ].includes(
      existingRequest.status
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          `현재 상태가 ${existingRequest.status}이므로 완료 처리할 수 없습니다.`
      },
      409
    );
  }


  let normalizedResult;


let limestoneUsageRecords = [];

let auxiliaryMaterialRecords = [];

let oisLegacySaveResult =
  null;

let solarHistoryRowsForRepair =
  null;


  if (
    existingRequest.requestType ===
      "limestone_stock"
  ) {
    const validation =
      normalizeLimestoneStockResult(
        body.result,
        existingRequest.targetDate
      );


    if (
      validation.error
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            validation.error
        },
        400
      );
    }


    normalizedResult =
      validation.result;


    /*
      OIS 요청을 완료 처리하기 전에
      사용량 계산·저장을 먼저 실행한다.

      저장 실패 시 요청이 complete로 바뀌지 않으므로
      계산값 없는 완료 요청이 생기지 않는다.
    */

const batchLink =
  await findLimestoneUsageBatchLinkByRequestId(
    context.env.DB,
    requestId
  );


limestoneUsageRecords =
  await saveLimestoneUsageRecords(
    context.env.DB,
    {
      requestItem:
        existingRequest,

      normalizedResult,

      agentId:
        authentication.agentId,

      calculationMode:
        batchLink
          ? "batch"
          : "single",

      batchId:
        batchLink?.batchId ||
        ""
    }
  );      

} else if (
  existingRequest.requestType ===
    "auxiliary_materials"
) {
  normalizedResult =
    body.result &&
    typeof body.result ===
      "object" &&
    !Array.isArray(
      body.result
    )
      ? body.result
      : {};


  auxiliaryMaterialRecords =
    await saveAuxiliaryMaterialDailyRecords(
      context.env.DB,
      {
        requestItem:
          existingRequest,

        rawResult:
          normalizedResult,

        agentId:
          authentication.agentId
      }
    );

} else if (
  existingRequest.requestType ===
    "bed_ash_level"
) {
  const validation =
    normalizeBedAshLevelResult(
      body.result,
      existingRequest.targetDate
    );


  if (
    validation.error
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          validation.error
      },
      400
    );
  }


  normalizedResult =
    validation.result;

} else if (existingRequest.requestType === ORGANIC_SILO_DATAPARC_REQUEST_TYPE) {
  const validation = normalizeOrganicSiloDataParcResult(body.result, existingRequest.targetDate);
  if (validation.error) {
    return jsonResponse({ ok: false, code: "ORGANIC_SILO_INVALID_RESULT", message: validation.error }, 400);
  }
  normalizedResult = validation.result;

} else if (
  existingRequest.requestType ===
    BLOWER_RUNTIME_PROBE_REQUEST_TYPE
) {
  const validation =
    normalizeBlowerRuntimeProbeResult(
      body.result,
      existingRequest.probe,
      requestId
    );


  if (
    validation.error
  ) {
    return jsonResponse(
      {
        ok:
          false,
        code:
          "BLOWER_RUNTIME_PROBE_INVALID_RESULT",
        message:
          validation.error
      },
      400
    );
  }


  normalizedResult =
    validation.result;

} else if (
  existingRequest.requestType ===
    "logsheet_approval"
) {
  const validation =
    normalizeOisLegacyApprovalResult(
      body.result,
      existingRequest.targetDate
    );


  normalizedResult =
    validation.result;


  /*
    요청을 complete 처리하기 전에
    과거 업무일지 원본을 D1에 먼저 저장한다.

    저장에 실패하면 요청도 complete가 되지 않는다.
  */

  oisLegacySaveResult =
    await saveOisLegacyApprovalRecords(
      context.env.DB,
      {
        requestItem:
          existingRequest,

        normalizedResult,

        agentId:
          authentication.agentId
      }
    );

} else {
  normalizedResult =
    body.result &&
    typeof body.result ===
      "object"
      ? body.result
      : {};
}


  if (
    [
      "daily_data_excel",
      "steam_status"
    ].includes(
      existingRequest.requestType
    )
  ) {
    solarHistoryRowsForRepair =
      Array.isArray(
        normalizedResult
          ?.solarHistoryRows
      )
        ? normalizedResult
            .solarHistoryRows
        : Array.isArray(
            normalizedResult
              ?.solarCumulative
              ?.historyRows
          )
          ? normalizedResult
              .solarCumulative
              .historyRows
          : null;

    normalizedResult = {
      ...normalizedResult
    };

    delete normalizedResult
      .solarHistoryRows;

    if (
      normalizedResult.solarCumulative &&
      typeof normalizedResult.solarCumulative ===
        "object" &&
      !Array.isArray(
        normalizedResult.solarCumulative
      )
    ) {
      normalizedResult.solarCumulative = {
        ...normalizedResult.solarCumulative
      };

      delete normalizedResult
        .solarCumulative
        .historyRows;
    }
  }


  const now =
    new Date()
      .toISOString();


  const agentClaimGuard =
    existingRequest.requestType ===
      ORGANIC_SILO_DATAPARC_REQUEST_TYPE
      ? "AND request_type = 'organic_silo_dataparc' AND status = 'processing' AND agent_id = ? AND expires_at > ?"
      : existingRequest.requestType ===
          BLOWER_RUNTIME_PROBE_REQUEST_TYPE
        ? "AND request_type = 'blower_runtime_probe' AND status = 'processing' AND agent_id = ? AND expires_at > ?"
        : "";


  const agentClaimBindings =
    agentClaimGuard
      ? [
          authentication.agentId,
          now
        ]
      : [];


  const updateResult =
    await context.env.DB
      .prepare(`
        UPDATE ois_data_requests

        SET
          status = 'complete',
          completed_at = ?,
          agent_id = ?,
          result_json = ?,
          error_message = '',
          updated_at = ?

        WHERE
          id = ?
          AND status IN (
            'pending',
            'processing'
          )
          ${agentClaimGuard}
      `)
      .bind(
        now,
        authentication.agentId,
        JSON.stringify(
          normalizedResult
        ),
        now,
        requestId,
        ...agentClaimBindings
      )
      .run();


  if (
    Number(
      updateResult?.meta?.changes
    ) !==
      1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "OIS 요청 상태가 변경되어 완료 처리하지 못했습니다."
      },
      409
    );
  }



  if (
    [
      "daily_data_excel",
      "steam_status"
    ].includes(
      existingRequest.requestType
    )
  ) {
    let solarHistoryRepair =
      null;

    try {
      solarHistoryRepair =
        await rebuildSolarHistoryOverridesFromDailyData(
          context.env.DB,
          {
            requestItem:
              existingRequest,
            normalizedResult,
            rawRows:
              solarHistoryRowsForRepair,
            agentId:
              authentication.agentId
          }
        );
    }
    catch (
      error
    ) {
      solarHistoryRepair = {
        ok:
          false,
        applied:
          false,
        reason:
          "repair_exception",
        message:
          error instanceof Error
            ? error.message
            : String(
                error ||
                "unknown solar history rebuild error"
              )
      };
    }

    console.log(
      "Daily DATA solar history rebuild:",
      solarHistoryRepair
    );
  }


  const completedRequest =
    await findRequestById(
      context.env.DB,
      requestId
    );


return jsonResponse({
  ok:
    true,

  item: {
    ...completedRequest,

    usageRecords:
      limestoneUsageRecords,

    auxiliaryMaterialRecords,

    oisLegacySaveResult
  },

  usageRecords:
    limestoneUsageRecords,

  auxiliaryMaterialRecords,

  oisLegacySaveResult,

  message:
    existingRequest.requestType ===
      "limestone_stock"
      ? "OIS 조회 결과와 석회석 사용량을 저장했습니다."
      : existingRequest.requestType ===
          "auxiliary_materials"
        ? "OIS 부재료 일별 자료를 D1에 저장했습니다."
        : existingRequest.requestType ===
            "bed_ash_level"
          ? "OIS Bed Ash 시간별 Level을 D1에 저장했습니다."
        : existingRequest.requestType ===
            "logsheet_approval"
          ? "OIS 과거 업무일지를 D1에 저장했습니다."
        : existingRequest.requestType ===
            BLOWER_RUNTIME_PROBE_REQUEST_TYPE
          ? "Silo Aeration Blower #B DataPARC read-only 결과를 저장했습니다."
          : "OIS 조회 결과를 저장했습니다."
});
}

/* =========================================================
  회사 PC 처리 실패
========================================================= */

async function failActiveBlowerRuntimeProbeCreateGroup(
  database,
  {
    requestId,
    groupMetadata,
    agentId,
    errorMessage,
    failedAt
  }
) {
  if (
    !groupMetadata
  ) {
    return 0;
  }


  const updateResults =
    await database.batch([
      database
        .prepare(`
          UPDATE ois_data_requests
          SET
            status = 'failed',
            completed_at = ?,
            agent_id = ?,
            error_message = ?,
            updated_at = ?
          WHERE request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
            AND length(id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("id")}
            AND substr(id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = ?
            AND requested_by_id = (
              SELECT requested_by_id
              FROM ois_data_requests AS triggering_owner
              WHERE triggering_owner.id = ?
                AND triggering_owner.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
            )
            AND (
              status = 'pending'
              OR (status = 'processing' AND agent_id = ?)
            )
            AND EXISTS (
              SELECT 1
              FROM ois_data_requests AS triggering_member
              WHERE triggering_member.id = ?
                AND triggering_member.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                AND triggering_member.requested_by_id = ois_data_requests.requested_by_id
                AND triggering_member.status = 'processing'
                AND triggering_member.agent_id = ?
                AND triggering_member.expires_at > ?
            )
            AND NOT EXISTS (
              SELECT 1
              FROM ois_data_requests AS foreign_sibling
              WHERE foreign_sibling.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
                AND length(foreign_sibling.id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("foreign_sibling.id")}
                AND substr(foreign_sibling.id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = ?
                AND foreign_sibling.status = 'processing'
                AND foreign_sibling.agent_id <> ?
            )
        `)
        .bind(
          failedAt,
          agentId,
          errorMessage,
          failedAt,
          groupMetadata.groupId,
          requestId,
          agentId,
          requestId,
          agentId,
          failedAt,
          groupMetadata.groupId,
          agentId
        ),
      database
        .prepare(`
          UPDATE blower_runtime_probe_intents_v4
          SET
            reuse_key = NULL,
            updated_at = ?
          WHERE request_id IN (
            SELECT id
            FROM ois_data_requests
            WHERE request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
              AND length(id) = 47
                AND ${blowerRuntimeProbeCreateGroupSql("id")}
              AND substr(id, 1, ${BLOWER_RUNTIME_PROBE_CREATE_GROUP_PREFIX_LENGTH}) = ?
              AND status = 'failed'
          )
          AND EXISTS (
            SELECT 1
            FROM ois_data_requests AS failed_trigger
            WHERE failed_trigger.id = ?
              AND failed_trigger.request_type = '${BLOWER_RUNTIME_PROBE_REQUEST_TYPE}'
              AND failed_trigger.status = 'failed'
              AND failed_trigger.agent_id = ?
              AND failed_trigger.updated_at = ?
          )
        `)
        .bind(
          failedAt,
          groupMetadata.groupId,
          requestId,
          agentId,
          failedAt
        )
    ]);


  return Number(
    updateResults?.[0]?.meta?.changes
  );
}


async function failAgentRequest(
  context,
  body
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  const requestId =
    normalizeText(
      body.requestId ||
      body.request_id
    );


  const errorMessage =
    normalizeText(
      body.errorMessage ||
      body.error_message
    ).slice(
      0,
      1000
    ) ||
    "OIS 조회에 실패했습니다.";


  if (
    !requestId
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "실패 처리할 OIS 요청 ID가 없습니다."
      },
      400
    );
  }


  const now =
    new Date()
      .toISOString();


  const groupMetadata =
    parseBlowerRuntimeProbeCreateGroupRequestId(
      requestId
    );


  const groupedFailure =
    Boolean(
      groupMetadata
    );


  let updateResult;


  if (
    groupedFailure
  ) {
    updateResult = {
      meta: {
        changes:
          await failActiveBlowerRuntimeProbeCreateGroup(
            context.env.DB,
            {
              requestId,
              groupMetadata,
              agentId:
                authentication.agentId,
              errorMessage,
              failedAt:
                now
            }
          )
      }
    };

  } else {
    updateResult =
      await context.env.DB
        .prepare(`
          UPDATE ois_data_requests

          SET
            status = 'failed',
            completed_at = ?,
            agent_id = ?,
            error_message = ?,
            updated_at = ?

          WHERE
            id = ?
            AND status IN (
              'pending',
              'processing'
            )
            AND (request_type != 'cofiring_daily' OR (status = 'processing' AND agent_id = ?))
        `)
        .bind(
          now,
          authentication.agentId,
          errorMessage,
          now,
          requestId,
          authentication.agentId
        )
        .run();
  }


  if (
    groupedFailure
      ? Number(
          updateResult?.meta?.changes
        ) <
          1
      : Number(
          updateResult?.meta?.changes
        ) !==
          1
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "실패 처리할 수 있는 OIS 요청이 없습니다."
      },
      409
    );
  }


  return jsonResponse({
    ok:
      true,

    item:
      await findRequestById(
        context.env.DB,
        requestId
      ),

    message:
      "OIS 조회 실패 내용을 저장했습니다."
  });
}


/* =========================================================
  POST 분기
========================================================= */

export async function onRequestPost(
  context
) {
  try {
    if (
      !context.env.DB
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      );
    }


    const body =
      await readJsonBody(
        context.request
      );


    const action =
      normalizeText(
        body.action
      )
        .toLowerCase()
        .replace(
          /[\s-]+/g,
          "_"
        );


    /*
      회사 PC 조회 완료
    */
    if (action === "cofiring_progress") return await handleCofiringProgress(context, body);
    if (action === "cofiring_period_progress") return await handleCofiringPeriodProgress(context, body);
    if (action === "cofiring_restart_guard") return await handleCofiringRestartGuard(context, body);

    if (
      action ===
        "complete_blower_runtime_probe_batch"
    ) {
      return await completeAgentBlowerRuntimeProbeBatch(
        context,
        body
      );
    }

    if (
      action ===
        "complete"
    ) {
      return await completeAgentRequest(
        context,
        body
      );
    }


    /*
      회사 PC 조회 실패
    */
    if (
      action ===
        "fail"
    ) {
      return await failAgentRequest(
        context,
        body
      );
    }

/*
  오전회의 자동수치 수동 수정값 저장

  - PC 수정 저장 버튼을 눌렀을 때만 실행
  - 새로운 OIS 조회는 생성하지 않음
*/
if (
  action ===
    "save_morning_meeting_auto_history_override"
) {
  return await saveMorningMeetingAutoHistoryOverride(
    context,
    body
  );
}

/*
  오전회의 자동수치에서 빈칸으로 저장한 값 원복

  - 원본 자료를 재조회하거나 변경하지 않음
  - 해당 날짜의 null 보정 키만 제거
*/
if (
  action ===
    "restore_morning_meeting_auto_history_blanks"
) {
  return await restoreMorningMeetingAutoHistoryBlankOverrides(
    context,
    body
  );
}

/*
  오전회의 선택일 전체 초기화 / 원상복구 / 재조회 적용
*/
if (
  action ===
    "reset_morning_meeting_auto_history"
) {
  return await resetMorningMeetingAutoHistory(
    context,
    body
  );
}

if (
  action ===
    "restore_morning_meeting_auto_history_reset"
) {
  return await restoreMorningMeetingAutoHistoryReset(
    context,
    body
  );
}

if (
  action ===
    "release_morning_meeting_auto_history_reset"
) {
  return await releaseMorningMeetingAutoHistoryReset(
    context,
    body
  );
}

/*
  부재료 날짜·호기별 수치 수정
*/
if (
  action ===
    "update_auxiliary_material_rows"
) {
  return await updateAuxiliaryMaterialManualRecords(
    context,
    body
  );
}


/*
  Slurry 밀도 고정값 저장
*/
if (
  action ===
    "save_auxiliary_material_density_settings"
) {
  return await saveAuxiliaryMaterialDensitySettings(
    context,
    body
  );
}    

    /*
      FBHE 진동 기간 OIS 조회
    */
    /* [FBHE-OIS-RESUME-TIMEOUT-V4-R3] */
    if (
      action ===
        "cancel_fbhe_vibration_batch"
    ) {
      return await cancelFbheVibrationBatchRequests(
        context,
        body
      );
    }

    if (
      action ===
        "create_fbhe_vibration_batch"
    ) {
      return await createFbheVibrationBatchRequest(
        context,
        body
      );
    }


    /*
      Blower DataPARC read-only probe

      Client body:
      {
        action: "create_blower_runtime_probe",
        startAt: "RFC3339 start selected after planned maintenance",
        assetTag: "supported equipment TAG (omitted for legacy Silo B)",
        dataParcTag: "full confirmed RUN signal (non-pilot only)",
        confirmRunSignal: true
      }
    */
    if (
      action ===
        "create_blower_runtime_probe_batch"
    ) {
      return await createBlowerRuntimeProbeBatchRequest(
        context,
        body
      );
    }


    if (
      action ===
        "create_blower_runtime_probe"
    ) {
      return await createBlowerRuntimeProbeRequest(
        context,
        body
      );
    }


    /*
      기존 부재료 엑셀 자료 등록
    */
        if (
      action ===
        "cancel_seal_pot_runtime_batch"
    ) {
      return await cancelSealPotRuntimeBatchRequests(
        context,
        body
      );
    }

    if (
      action ===
        "create_seal_pot_runtime_batch"
    ) {
      return await createSealPotRuntimeBatchRequest(
        context,
        body
      );
    }

    if (
      action ===
        "import_auxiliary_material_excel"
    ) {
      return await importAuxiliaryMaterialExcelBatch(
        context,
        body
      );
    }


    /*
      부재료 기간 OIS 조회
    */
    if (
      action ===
        "create_materials_batch"
    ) {
      return await createAuxiliaryMaterialBatchRequest(
        context,
        body
      );
    }


    /*
      기간 전체 사용량 계산
    */
    if (
      action ===
        "create_usage_batch"
    ) {
      return await createLimestoneUsageBatchRequest(
        context,
        body
      );
    }


    /*
      OIS 과거 LOG SHEET 기간 가져오기
    */
    if (
      action ===
        "create_logsheet_batch"
    ) {
      return await createOisLegacyLogBatchRequest(
        context,
        body
      );
    }


    /*
      단일 날짜 OIS 조회
    */
    return await createUserRequest(
      context,
      body
    );

  } catch (
    error
  ) {
    console.error(
      "OIS 요청 저장 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "OIS 요청을 저장하지 못했습니다."
      },
      500
    );
  }
}


export const __oisDataRequestsTest = {
  completedOisChunkCoversEnd, createFbheVibrationBatchRequest, createSealPotRuntimeBatchRequest,
  formatKstRfc3339,
  parseStrictRfc3339,
  buildBlowerRuntimeProbeTargetDate,
  buildBlowerRuntimeProbeChunks,
  getRequestProcessingTimeoutMinutes,
  isFreshBlowerRuntimeProbeWindow,
  isFreshCompleteBlowerRuntimeProbeRequest,
  normalizeBlowerRuntimeProbeResult,
  resolveBlowerRuntimeProbeMapping,
  isValidBlowerRuntimeProbeMapping,
  ensureBlowerRuntimeProbeSchema,
  parseBlowerRuntimeProbeBatchLimit,
  handleAgentNextBlowerRuntimeProbeBatch,
  parseBlowerRuntimeProbeCompletionBatch,
  completeAgentBlowerRuntimeProbeBatch,
  ensureMorningMeetingAutoHistoryOverridesTable,
  normalizeMorningMeetingAutoHistoryOverrideValues,
  restoreMorningMeetingAutoHistoryBlankOverrides,
  ensureAuxiliaryMaterialDailyTable,
  normalizeAuxiliaryMaterialManualTarget,
  normalizeAuxiliaryMaterialManualRecord,
  updateAuxiliaryMaterialManualRecords,
  normalizeOrganicSiloDataParcResult,
  isOrganicSiloQualityGood
};

/* DAILY_DATA_SOLAR_HISTORY_REBUILD_API_V1 */

/* DAILY_DATA_SOLAR_HISTORY_REBUILD_REVISION_RETRY_V101 */

/* COFIRING_LIVE_CONTRACT_V1. One pure validator used by browser, Agent and API.
   The API copy is generated byte-for-byte; tests prevent drift. No I/O here. */
function createCofiringLiveContract() {
  'use strict';
  const TYPE = 'cofiring_daily';
  const MAX_BYTES = 1500000;
  const definitions = [{"id":"unit1CoalA1","unit":"unit1","fuel":"coal","queryTag":"GSPOGE.ABB_DCS.BLR1 COAL FEEDER A-1 REFERENSE","tag":"GSPOGE.ABB_DCS.BLR1 COAL FEEDER A-1 REFERENSE/PLOT"},{"id":"unit1CoalA2","unit":"unit1","fuel":"coal","queryTag":"GSPOGE.ABB_DCS.BLR1 COAL FEEDER A-2 REFERENSE","tag":"GSPOGE.ABB_DCS.BLR1 COAL FEEDER A-2 REFERENSE/PLOT"},{"id":"unit1CoalB1","unit":"unit1","fuel":"coal","queryTag":"GSPOGE.ABB_DCS.BLR1 COAL FEEDER B-1 REFERENSE","tag":"GSPOGE.ABB_DCS.BLR1 COAL FEEDER B-1 REFERENSE/PLOT"},{"id":"unit1CoalB2","unit":"unit1","fuel":"coal","queryTag":"GSPOGE.ABB_DCS.BLR1 COAL FEEDER B-2 REFERENSE","tag":"GSPOGE.ABB_DCS.BLR1 COAL FEEDER B-2 REFERENSE/PLOT"},{"id":"unit1Bio","unit":"unit1","fuel":"bio","queryTag":"GSPOGE.ABB_DCS.BLR1 BIO SRF REFERENCE","tag":"GSPOGE.ABB_DCS.BLR1 BIO SRF REFERENCE/PLOT"},{"id":"unit2CoalA1","unit":"unit2","fuel":"coal","queryTag":"GSPOGE.ABB_DCS.BLR2 COAL FEEDER A-1 REFERENSE","tag":"GSPOGE.ABB_DCS.BLR2 COAL FEEDER A-1 REFERENSE/PLOT"},{"id":"unit2CoalA2","unit":"unit2","fuel":"coal","queryTag":"GSPOGE.ABB_DCS.BLR2 COAL FEEDER A-2 REFERENSE","tag":"GSPOGE.ABB_DCS.BLR2 COAL FEEDER A-2 REFERENSE/PLOT"},{"id":"unit2CoalB1","unit":"unit2","fuel":"coal","queryTag":"GSPOGE.ABB_DCS.BLR2 COAL FEEDER B-1 REFERENSE","tag":"GSPOGE.ABB_DCS.BLR2 COAL FEEDER B-1 REFERENSE/PLOT"},{"id":"unit2CoalB2","unit":"unit2","fuel":"coal","queryTag":"GSPOGE.ABB_DCS.BLR2 COAL FEEDER B-2 REFERENSE","tag":"GSPOGE.ABB_DCS.BLR2 COAL FEEDER B-2 REFERENSE/PLOT"},{"id":"unit2Bio","unit":"unit2","fuel":"bio","queryTag":"GSPOGE.ABB_DCS.BLR2 BIO SRF REFERENCE","tag":"GSPOGE.ABB_DCS.BLR2 BIO SRF REFERENCE/PLOT"}];
  const inventoryDefinitions = [
    {key:'organicDaySilo',label:'Day Silo',tag:'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT'},
    {key:'organicStorageSiloA',label:'Storage Silo A',tag:'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT'},
    {key:'organicStorageSiloB',label:'Storage Silo B',tag:'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'}
  ];
  const good = q => typeof q === 'string' && /^(?:good|raw\s*,\s*good|good\s*,\s*raw)$/i.test(q.trim());
  const noData = q => typeof q === 'string' && ['bad,no data','no data,bad'].includes(q.toLowerCase().split(',').map(s=>s.trim()).join(','));
  const uuid = s => typeof s==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
  const number = n => typeof n==='number' && Number.isFinite(n);
  const fail = s => {throw new Error('COFIRING_RESULT_INVALID: '+s);};
  function day(targetDate) {
    if(typeof targetDate!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(targetDate))fail('날짜 하나가 필요합니다.');
    const date = new Date(targetDate+'T00:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==targetDate||targetDate<'2021-01-01')fail('계산일을 확인해 주세요.');
    const next=new Date(date.getTime()+86400000).toISOString().slice(0,10);
    return {targetDate,start:targetDate+'T00:00:00+09:00',end:next+'T00:00:00+09:00',
      queryStart:targetDate+' 00:00',queryEnd:next+' 00:01',startMs:date.getTime()-32400000};
  }
  function completedDay(targetDate,now=Date.now()) {
    const d=day(targetDate);
    if(d.startMs+86460000>now)fail('다음 날 00:01이 지난 날짜만 하루 조회할 수 있습니다.');
    return d;
  }
  function validateReport(r,targetDate) {
    const d=day(targetDate), data=r?.reference;
    if(!r||r.kind!=='cofiring_dataparc_pilot'||r.schemaVersion!==2||r.pilotVersion!==7 ||
       !['PASS','REFERENCE_UNVERIFIED','DATA_GAPS'].includes(r.status))fail('지원하는 V7 완료 결과가 아닙니다.');
    if(r.executionSucceeded!==true||r.resultReceived!==true||r.timedOut!==false||r.workerExitCode!==0||
       r.completedTagCount!==10||r.cleanupVerified!==true||r.processCleanupVerified!==true||r.safeToStartNextDay!==true||
       r.databaseWritten!==false||r.productionReady!==false||!Array.isArray(r.cleanupErrors)||r.cleanupErrors.length)fail('전체 수신·Excel 종료가 확인되지 않았습니다.');
    if(typeof r.runId!=='string'||!/^[a-f0-9]{32}$/i.test(r.runId)||r.targetDate!==targetDate||r.mode!=='daily'||
       r.timeZone!=='Asia/Seoul'||r.start!==d.queryStart||r.end!==d.end.slice(0,16).replace('T',' ')||
       r.queryStart!==d.queryStart||r.queryEnd!==d.queryEnd||r.durationMinutes!==1440||r.queryDurationMinutes!==1441||r.boundaryCount!==1441)fail('조회일·실행 ID·하루 범위가 다릅니다.');
    if(!data||data.source?.kind!=='dataparc_hidden_excel'||data.source?.qualityRecorded!==true||data.source.runId!==r.runId||
       data.schemaVersion!=='cofiring-reference-v1'||data.targetDate!==targetDate||data.mode!=='daily'||data.timeZone!=='Asia/Seoul'||
       Date.parse(data.start)!==d.startMs||Date.parse(data.end)!==d.startMs+86400000||
       Date.parse(data.queryStart)!==d.startMs||Date.parse(data.queryEnd)!==d.startMs+86460000||
       data.durationMinutes!==1440||data.queryDurationMinutes!==1441||data.boundaryCount!==1441||data.aggregation!=='Start'||data.stepSeconds!==60)fail('분별 자료의 하루 계약이 다릅니다.');
    if(!Array.isArray(data.timestamps)||data.timestamps.length!==1441||data.timestamps.some((t,i)=>Date.parse(t)!==d.startMs+i*60000))fail('분 경계 시각 누락·중복·변경');
    if(!Array.isArray(data.series)||data.series.length!==10||!Array.isArray(r.tagSummary)||r.tagSummary.length!==10)fail('10개 TAG 전체가 필요합니다.');
    const input=new Map(data.series.map(s=>[s?.id,s])), summary=new Map(r.tagSummary.map(s=>[s?.key,s]));
    if(input.size!==10||summary.size!==10)fail('중복 TAG');
    let gaps=0,validRows=0;
    const canonicalSeries=[], canonicalSummary=[];
    const timestamps=Array.from({length:1441},(_,i)=>new Date(d.startMs+i*60000+32400000).toISOString().slice(0,19)+'+09:00');
    for(const def of definitions) {
      const s=input.get(def.id),t=summary.get(def.id);
      if(!s||!t||s.unit!==def.unit||s.fuel!==def.fuel||s.tag!==def.tag||s.queryTag!==def.queryTag||s.unitOfMeasure!=='ton'||t.tag!==def.queryTag)fail('TAG 식별 불일치: '+def.id);
      for(const key of ['values','qualities','returnedTimes'])if(!Array.isArray(s[key])||s[key].length!==1441)fail('배열 크기: '+def.id);
      let previous=null;
      const missing=[];
      for(let i=0;i<1441;i++) {
        const v=s.values[i],q=s.qualities[i],time=s.returnedTimes[i];
        const at=typeof time==='string'&&/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(time)?Date.parse(time):NaN;
        if(!Number.isFinite(at)||at<d.startMs+i*60000||at>=d.startMs+(i+1)*60000)fail('반환 시각 범위: '+def.id);
        if(v===null) {
          if(!noData(q)||i===0||i===1440)fail('설명 없는 누락 또는 시작·끝 경계 누락');
          missing.push(timestamps[i]);gaps++;
        } else {
          if(!number(v)||v<0||!good(q)||previous!==null&&v<previous)fail('누적값 초기화·음수·비정상 품질: '+def.id);
          previous=v;validRows++;
        }
      }
      if(t.expectedRows!==1441||t.receivedRows!==1441||t.validRows!==1441-missing.length||t.noDataRows!==missing.length||
         t.minuteDataComplete!==(missing.length===0)||!Array.isArray(t.missingTimes)||t.missingTimes.length!==missing.length||
         t.missingTimes.some((x,i)=>Date.parse(x)!==Date.parse(missing[i])))fail('TAG 집계 불일치: '+def.id);
      canonicalSeries.push({...def,unitOfMeasure:'ton',values:s.values.slice(),qualities:s.qualities.map(q=>good(q)?'Raw, Good':'No Data, Bad'),returnedTimes:s.returnedTimes.slice()});
      canonicalSummary.push({key:def.id,tag:def.queryTag,expectedRows:1441,receivedRows:1441,validRows:1441-missing.length,noDataRows:missing.length,missingTimes:missing,minuteDataComplete:missing.length===0});
    }
    const response=r.response, comparison=r.referenceComparison;
    if(!response||response.rows!==14410||response.returnedRows!==14410||response.complete!==true||response.shapeValid!==true||response.readState!=='READ_OK'||
       response.valueRows!==validRows||response.noDataRows!==gaps||r.noDataRows!==gaps||
       !['errorRows','pendingRows','metadataPendingRows','otherPendingRows'].every(k=>response[k]===0))fail('완료 응답 집계 불일치');
    if(!comparison||comparison.expectedSamples!==14410||comparison.mismatchSamples!==0||
       !Number.isInteger(comparison.comparedSamples)||comparison.comparedSamples<0||comparison.comparedSamples>validRows||
       !number(comparison.toleranceTon)||comparison.toleranceTon!==0.001)fail('원본 대조 계약 불일치');
    const status=gaps?'DATA_GAPS':comparison.comparedSamples===14410?'PASS':'REFERENCE_UNVERIFIED';
    if(r.status!==status||r.dataValidated!==(gaps===0)||comparison.matched!==(status==='PASS'))fail('상태와 실제 자료가 다릅니다.');
    if(!Number.isFinite(Date.parse(r.completedAtUtc)))fail('조회 완료 시각이 없습니다.');
    const calorifics={},coefficients={};
    for(const unit of ['unit1','unit2']){calorifics[unit]={};coefficients[unit]={};for(const fuel of ['coal','bio','organic']){
      const heat=data.calorifics?.[unit]?.[fuel],coefficient=data.coefficients?.[unit]?.[fuel];
      if(!number(heat)||heat<=0||heat>100000||coefficient!==1)fail('원본 발열량·보정계수 계약이 다릅니다.');
      calorifics[unit][fuel]=heat;coefficients[unit][fuel]=coefficient;
    }}
    // Original calculation assumptions are preserved for the legacy parser; the UI uses its current heating-value inputs.
    // Workstation paths, PID lists and manual organic amounts are never sent to the website.
    return {schemaVersion:2,pilotVersion:7,kind:r.kind,runId:r.runId,status,start:r.start,end:r.end,timeZone:'Asia/Seoul',
      targetDate,queryStart:d.queryStart,queryEnd:d.queryEnd,mode:'daily',dataValidated:gaps===0,durationMinutes:1440,queryDurationMinutes:1441,boundaryCount:1441,
      cleanupVerified:true,timedOut:false,workerExitCode:0,resultReceived:true,processCleanupVerified:true,executionSucceeded:true,safeToStartNextDay:true,
      completedTagCount:10,response:{rows:14410,shapeValid:true,readState:'READ_OK',returnedRows:14410,valueRows:validRows,noDataRows:gaps,errorRows:0,pendingRows:0,metadataPendingRows:0,otherPendingRows:0,complete:true},
      tagSummary:canonicalSummary,noDataRows:gaps,cleanupErrors:[],databaseWritten:false,productionReady:false,completedAtUtc:r.completedAtUtc,
      referenceComparison:{requiredForPass:true,matched:status==='PASS',expectedSamples:14410,comparedSamples:comparison.comparedSamples,mismatchSamples:0,toleranceTon:0.001},
      reference:{schemaVersion:'cofiring-reference-v1',source:{kind:'dataparc_hidden_excel',qualityRecorded:true,runId:r.runId},start:d.start,end:d.end,timeZone:'Asia/Seoul',timestamps,series:canonicalSeries,calorifics,coefficients,
        targetDate,queryStart:d.start,queryEnd:d.queryEnd.replace(' ','T')+':00+09:00',durationMinutes:1440,queryDurationMinutes:1441,mode:'daily',aggregation:'Start',stepSeconds:60,boundaryCount:1441}};
  }
  function result(raw,requestId,targetDate) {
    if(!uuid(requestId)||raw?.kind!=='cofiring_live_result'||raw.schemaVersion!==1||raw.requestId!==requestId||raw.targetDate!==targetDate)fail('서버 요청 ID와 결과가 다릅니다.');
    const report=validateReport(raw.report,targetDate);
    const value={kind:'cofiring_live_result',schemaVersion:1,requestId,targetDate,report};
    if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_BYTES)fail('결과 저장 용량 제한 초과');
    return value;
  }

  const PERIOD_TYPE = 'cofiring_period';
  function period(spec, now=Date.now()) {
    const failPeriod = s => fail('기간 조회: '+s);
    const x=spec||{},pattern=/^(20\d{2}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
    const sm=pattern.exec(x.startLocal||''), em=pattern.exec(x.endLocal||'');
    if(!sm||!em)failPeriod('시작·종료일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.');
    const parse=v=>Date.parse(v+':00+09:00'),startMs=parse(x.startLocal),endMs=parse(x.endLocal);
    if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||new Date(startMs+32400000).toISOString().slice(0,16)!==x.startLocal||new Date(endMs+32400000).toISOString().slice(0,16)!==x.endLocal)failPeriod('유효한 한국 시간 날짜를 지정해 주세요.');
    const durationMinutes=(endMs-startMs)/60000;
    if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>44640)failPeriod('1분 이상 최대 31일까지 조회할 수 있습니다.');
    const stepUnit=String(x.stepUnit||'').toLowerCase(),stepValue=Number(x.stepValue);
    if(!['minute','hour','day'].includes(stepUnit)||!Number.isInteger(stepValue)||stepValue<1||stepValue>1440)failPeriod('계산 간격은 분/시간/일과 1 이상의 정수로 지정해 주세요.');
    const stepMinutes=stepUnit==='minute'?stepValue:stepUnit==='hour'?stepValue*60:stepValue*1440;
    if(stepMinutes>durationMinutes&&durationMinutes>1)failPeriod('계산 간격이 전체 기간보다 큽니다.');
    if(endMs+60000>now+120000)failPeriod('종료 경계 다음 1분까지 완료된 시각만 조회할 수 있습니다.');
    return {startLocal:x.startLocal,endLocal:x.endLocal,stepUnit,stepValue,stepMinutes,durationMinutes,startMs,endMs,targetDate:x.startLocal.slice(0,10),queryEndLocal:new Date(endMs+60000+32400000).toISOString().slice(0,16)};
  }
  function periodKey(spec) { const p=period(spec,Number.MAX_SAFE_INTEGER); return [p.startLocal,p.endLocal,p.stepUnit,p.stepValue].join('|'); }
  function periodEnvelope(spec) { const p=period(spec); return {kind:'cofiring_period_request',schemaVersion:1,startLocal:p.startLocal,endLocal:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue,key:periodKey(p)}; }
  function validatePeriodSummaryItem(item,def,p) {
    // COFIRING_BIO_BOUNDARY_NODATA_CONTRACT_V4
    if(!item||item.key!==def.id||item.unit!==def.unit||item.fuel!==def.fuel||item.tag!==def.queryTag)fail('기간 TAG 식별 불일치: '+def.id);
    const numericKeys=['min','max','delta','usageTon','durationGoodSeconds','durationBadSeconds'];
    for(const k of numericKeys)if(!number(item[k]))fail('기간 숫자 누락: '+def.id+' '+k);
    const startApplied=item.startBoundaryFallbackApplied===true,endApplied=item.endBoundaryFallbackApplied===true;
    if(startApplied&&endApplied)fail('기간 Bio 양쪽 경계를 동시에 복구할 수 없습니다: '+def.id);
    const startFallback=(def.fuel==='bio'&&startApplied&&!endApplied&&item.usageBasis==='end_minus_period_min_start_nodata_fallback'&&!number(item.startValue)&&number(item.endValue)&&number(item.startBoundaryFallbackValue)&&item.startBoundaryFallbackValue>=0&&noData(item.startQuality)&&good(item.endQuality));
    const endFallback=(def.fuel==='bio'&&endApplied&&!startApplied&&item.usageBasis==='period_max_end_nodata_fallback_minus_start_boundary'&&number(item.startValue)&&!number(item.endValue)&&number(item.endBoundaryFallbackValue)&&item.endBoundaryFallbackValue>=0&&good(item.startQuality)&&noData(item.endQuality));
    const direct=number(item.startValue)&&number(item.endValue)&&!startApplied&&!endApplied;
    if(startApplied&&!startFallback)fail('기간 시작 경계 fallback 메타데이터 불일치: '+def.id);
    if(endApplied&&!endFallback)fail('기간 종료 경계 fallback 메타데이터 불일치: '+def.id);
    if(!direct&&!startFallback&&!endFallback)fail('기간 경계 숫자 누락: '+def.id);
    const effectiveStart=startFallback?item.startBoundaryFallbackValue:item.startValue;
    const effectiveEnd=endFallback?item.endBoundaryFallbackValue:item.endValue;
    if(effectiveStart<0||effectiveEnd<0||item.min<0||item.max<0||item.usageTon<-0.001)fail('기간 누적값 음수: '+def.id);
    if(direct&&(!good(item.startQuality)||!good(item.endQuality)))fail('기간 경계 품질 불량: '+def.id);
    const st=Date.parse(item.startTime),et=Date.parse(item.endTime);
    if(!Number.isFinite(st)||st<p.startMs||st>=p.startMs+60000||!Number.isFinite(et)||et<p.endMs||et>=p.endMs+60000)fail('기간 경계 반환시각 불일치: '+def.id);
    const usage=effectiveEnd-effectiveStart,spread=item.max-item.min;
    if(usage<-0.001||Math.abs(usage-item.usageTon)>0.001)fail('기간 사용량/경계값 불일치: '+def.id);
    if(spread<-0.001||Math.abs(spread-item.delta)>0.001)fail('기간 Delta/MinMax 불일치: '+def.id);
    if(number(item.rangeSpread)&&Math.abs(spread-item.rangeSpread)>0.001)fail('기간 RangeSpread/MinMax 불일치: '+def.id);
    if(startFallback&&Math.abs(item.startBoundaryFallbackValue-item.min)>0.001)fail('기간 시작 경계 fallback/Min 불일치: '+def.id);
    if(endFallback&&Math.abs(item.endBoundaryFallbackValue-item.max)>0.001)fail('기간 종료 경계 fallback/Max 불일치: '+def.id);
    if(item.min+0.001<effectiveStart||item.max-0.001>effectiveEnd)fail('기간 Min/Max가 누적 경계와 모순됩니다: '+def.id);
    const expected=p.durationMinutes*60;
    if(item.durationGoodSeconds<0||item.durationBadSeconds<0||Math.abs(item.durationGoodSeconds+item.durationBadSeconds-expected)>2)fail('기간 품질 지속시간 불일치: '+def.id);
    if((startFallback||endFallback)&&item.durationBadSeconds>0.001)fail('기간 Bio 경계 fallback은 전체 Good 구간에서만 허용됩니다: '+def.id);
    if(item.boundaryValid!==true||item.durationCoverageValid!==true)fail('기간 Worker 경계 검증 실패: '+def.id);
    return {...item,effectiveStartValue:effectiveStart,effectiveEndValue:effectiveEnd,startBoundaryRecovered:startFallback,endBoundaryRecovered:endFallback,dataComplete:item.durationBadSeconds<=0.001};
  }
  function validateOrganicInventory(raw,p) {/* COFIRING_ORGANIC_START_BOUNDARY_2MIN_V1: Worker accepts the first valid inventory sample inside the first two minutes. *//* COFIRING_ORGANIC_LAST_ACTUAL_END_V1: allow the last actual inventory sample inside the selected period while retaining the existing legacy upper bound. */
    if(raw===null||raw===undefined)return null;
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.schemaVersion!==1||raw.basis!=='dataparc_period_boundary'||
       raw.startLocal!==p.startLocal||raw.endLocal!==p.endLocal)fail('유기성 재고 기간 계약이 다릅니다.');
    if(!Array.isArray(raw.samples)||raw.samples.length!==inventoryDefinitions.length)fail('유기성 재고 3개 TAG 경계값이 필요합니다.');
    const map=new Map(raw.samples.map(sample=>[sample?.key,sample]));
    if(map.size!==inventoryDefinitions.length)fail('유기성 재고 TAG가 중복됐습니다.');
    const canonical=[],start={},end={};let startTotal=0,endTotal=0;
    const expected=p.durationMinutes*60;
    for(const def of inventoryDefinitions){
      const sample=map.get(def.key);
      if(!sample||sample.key!==def.key||sample.label!==def.label||sample.tag!==def.tag)fail('유기성 재고 TAG 식별 불일치: '+def.key);
      if(!number(sample.startValue)||sample.startValue<0||!number(sample.endValue)||sample.endValue<0)fail('유기성 재고 경계값 누락: '+def.key);
      if(!good(sample.startQuality)||!good(sample.endQuality))fail('유기성 재고 경계 품질 불량: '+def.key);
      const st=Date.parse(sample.startTime),et=Date.parse(sample.endTime);
      if(!Number.isFinite(st)||st<p.startMs-120000||st>p.startMs||!Number.isFinite(et)||et<p.startMs||et>=p.endMs+60000)fail('유기성 재고 반환시각 불일치: '+def.key);
      if(!number(sample.durationGoodSeconds)||sample.durationGoodSeconds<0||!number(sample.durationBadSeconds)||sample.durationBadSeconds<0||
         Math.abs(sample.durationGoodSeconds+sample.durationBadSeconds-expected)>2||sample.durationCoverageValid!==true)fail('유기성 재고 품질 지속시간 불일치: '+def.key);
      if(sample.boundaryValid!==true||sample.dataComplete!==true)fail('유기성 재고 경계 검증 실패: '+def.key);
      start[def.key]=sample.startValue;end[def.key]=sample.endValue;startTotal+=sample.startValue;endTotal+=sample.endValue;
      canonical.push({...sample,min:number(sample.min)?sample.min:null,max:number(sample.max)?sample.max:null,delta:number(sample.delta)?sample.delta:null});
    }
    const validateSide=(side,values,total,label)=>{
      if(!side||typeof side!=='object'||Array.isArray(side)||!number(side.total)||side.total<0)fail('유기성 '+label+' 재고 합계가 없습니다.');
      for(const def of inventoryDefinitions)if(!number(side[def.key])||Math.abs(side[def.key]-values[def.key])>0.001)fail('유기성 '+label+' 재고와 TAG 값이 다릅니다: '+def.key);
      if(Math.abs(side.total-total)>0.001)fail('유기성 '+label+' 총 재고량이 Silo 합계와 다릅니다.');
    };
    validateSide(raw.start,start,startTotal,'시작');
    validateSide(raw.end,end,endTotal,'종료');
    return {schemaVersion:1,basis:'dataparc_period_boundary',startLocal:p.startLocal,endLocal:p.endLocal,
      start:{...start,total:startTotal},end:{...end,total:endTotal},samples:canonical};
  }
  function validatePeriodReport(r,spec) {
    const p=period(spec,Number.MAX_SAFE_INTEGER);
    if(!r||r.kind!=='cofiring_dataparc_period_report'||r.schemaVersion!==1||!['PERIOD_READY','PERIOD_DATA_GAPS'].includes(r.status))fail('지원하는 기간 조회 결과가 아닙니다.');
    if(r.executionSucceeded!==true||r.cleanupVerified!==true||r.processCleanupVerified!==true||r.timedOut!==false||r.workerExitCode!==0||!Array.isArray(r.cleanupErrors)||r.cleanupErrors.length)fail('기간 조회용 Excel 종료/실행 확인이 완료되지 않았습니다.');
    if(typeof r.runId!=='string'||!/^[a-f0-9]{32}$/i.test(r.runId)||r.startLocal!==p.startLocal||r.endLocal!==p.endLocal||r.stepUnit!==p.stepUnit||r.stepValue!==p.stepValue||r.queryEndLocal!==p.queryEndLocal)fail('기간 요청과 결과 범위가 다릅니다.');
    if(!Array.isArray(r.summaries)||r.summaries.length!==10)fail('기간 Coal/Bio 10개 TAG 요약이 필요합니다.');
    const input=new Map(r.summaries.map(s=>[s?.key,s]));if(input.size!==10)fail('기간 TAG가 중복됐습니다.');
    const summaries=definitions.map(def=>validatePeriodSummaryItem(input.get(def.id),def,p));
    const hasGaps=summaries.some(s=>!s.dataComplete),status=hasGaps?'PERIOD_DATA_GAPS':'PERIOD_READY';
    if(r.status!==status)fail('기간 데이터 상태와 결과 상태가 다릅니다.');
    if(!Number.isFinite(Date.parse(r.completedAtUtc)))fail('기간 조회 완료시각이 없습니다.');
    const hasInventoryFields=Object.prototype.hasOwnProperty.call(r,'organicInventory')||Object.prototype.hasOwnProperty.call(r,'organicInventoryReady');
    let organicInventory=null;
    if(hasInventoryFields){
      if(r.organicInventoryReady===true)organicInventory=validateOrganicInventory(r.organicInventory,p);
      else if(r.organicInventoryReady===false&&(r.organicInventory===null||r.organicInventory===undefined))organicInventory=null;
      else fail('유기성 재고 준비 상태와 결과가 다릅니다.');
    }
    const calorifics={unit1:{coal:5868,bio:3237,organic:3487,manure:3487},unit2:{coal:5868,bio:3237,organic:3487,manure:3487}};
    const coefficients={unit1:{coal:1,bio:1,organic:1,manure:1},unit2:{coal:1,bio:1,organic:1,manure:1}};
    const reference={kind:'cofiring_period_summary_v1',schemaVersion:1,startLocal:p.startLocal,endLocal:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue,summaries,calorifics,coefficients};
    if(organicInventory)reference.organicInventory=organicInventory;
    return hasInventoryFields?{...r,status,summaries,organicInventoryReady:organicInventory!==null,organicInventory,reference}:{...r,status,summaries,reference};
  }
  function periodResult(raw,requestId,spec) {
    const p=period(spec,Number.MAX_SAFE_INTEGER);
    if(!uuid(requestId)||raw?.kind!=='cofiring_period_live_result'||raw.schemaVersion!==1||raw.requestId!==requestId)fail('기간 서버 요청 ID가 다릅니다.');
    if(periodKey(raw.request)!==periodKey(p))fail('기간 서버 요청 범위가 다릅니다.');
    const report=validatePeriodReport(raw.report,p),value={kind:'cofiring_period_live_result',schemaVersion:1,requestId,request:{startLocal:p.startLocal,endLocal:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue},report};
    if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_BYTES)fail('기간 결과 저장 용량 제한 초과');
    return value;
  }
  return {TYPE,PERIOD_TYPE,MAX_BYTES,definitions,inventoryDefinitions,uuid,good,noData,day,completedDay,validateReport,result,period,periodKey,periodEnvelope,validateOrganicInventory,validatePeriodReport,periodResult};
}


const COFIRING_LIVE = createCofiringLiveContract();
const cofiringIndexPromises = new WeakMap();
async function ensureCofiringLiveIndexes(db) {
  if (!cofiringIndexPromises.has(db)) cofiringIndexPromises.set(db,(async()=>{
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_cofiring_one_active_day_v1 ON ois_data_requests(target_date) WHERE request_type='cofiring_daily' AND status IN ('pending','processing')").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_cofiring_day_history_v1 ON ois_data_requests(target_date,status,requested_at DESC) WHERE request_type='cofiring_daily'").run();
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_cofiring_one_active_period_v1 ON ois_data_requests(target_date) WHERE request_type='cofiring_period' AND status IN ('pending','processing')").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_cofiring_period_history_v1 ON ois_data_requests(target_date,status,requested_at DESC) WHERE request_type='cofiring_period'").run();
  })().catch(e=>{cofiringIndexPromises.delete(db);throw e;}));
  return cofiringIndexPromises.get(db);
}
function cofiringJson(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-GS-Cofiring-Api-Build':COFIRING_API_BUILD_FINGERPRINT,'X-Content-Type-Options':'nosniff'}});}
function cofiringPublicRequest(row) {
  if (!row) return null;
  let progress=null;
  try {const p=JSON.parse(row.result_json||'null');if(p?.kind==='cofiring_progress')progress=p;}catch(_){}
  return {id:row.id,targetDate:row.target_date,requestType:row.request_type,status:row.status,requestedAt:row.requested_at,startedAt:row.started_at,
    completedAt:row.completed_at,expiresAt:row.expires_at,requestedByName:row.requested_by_name,errorMessage:row.error_message||'',progress};
}
async function expireCofiringLiveRequests(db) {
  const now=new Date().toISOString();
  await db.prepare("UPDATE ois_data_requests SET status='failed',error_message='회사 PC Agent 응답 시간이 초과되었습니다. 기존 저장 결과는 유지합니다.',completed_at=?,updated_at=? WHERE request_type='cofiring_daily' AND status IN ('pending','processing') AND expires_at<=?").bind(now,now,now).run();
}
async function cofiringLatestRow(db,date,status) {
  return db.prepare("SELECT * FROM ois_data_requests WHERE request_type='cofiring_daily' AND target_date=? AND status=? ORDER BY requested_at DESC,id DESC LIMIT 1").bind(date,status).first();
}
async function handleCofiringLiveGet(context,url) {
  const auth=await getAuthenticatedUser(context);if(auth.error)return auth.error;
  const date=url.searchParams.get('targetDate');try{COFIRING_LIVE.day(date);}catch(e){return cofiringJson({ok:false,message:e.message},400);}
  const db=context.env.DB;await ensureCofiringLiveIndexes(db);await expireCofiringLiveRequests(db);
  // The full result JSON is fetched only when its request ID differs from the browser's cached ID.
  const saved=await db.prepare("SELECT id,target_date,request_type,status,requested_at,started_at,completed_at,expires_at,requested_by_name,error_message FROM ois_data_requests WHERE request_type='cofiring_daily' AND target_date=? AND status='complete' ORDER BY requested_at DESC,id DESC LIMIT 1").bind(date).first();
  const active=await db.prepare("SELECT * FROM ois_data_requests WHERE request_type='cofiring_daily' AND target_date=? AND status IN ('pending','processing') ORDER BY requested_at DESC,id DESC LIMIT 1").bind(date).first();
  const last=await db.prepare("SELECT id,target_date,request_type,status,requested_at,started_at,completed_at,expires_at,requested_by_name,error_message FROM ois_data_requests WHERE request_type='cofiring_daily' AND target_date=? ORDER BY requested_at DESC,id DESC LIMIT 1").bind(date).first();
  let result=null;
  if(saved&&saved.id!==url.searchParams.get('knownResultId')) {
    const row=await db.prepare("SELECT result_json FROM ois_data_requests WHERE id=? AND request_type='cofiring_daily' AND status='complete'").bind(saved.id).first();
    try{result=COFIRING_LIVE.result(JSON.parse(row?.result_json||'null'),saved.id,date);}catch(e){return cofiringJson({ok:false,message:'서버 저장 결과 검증 실패: '+e.message},500);}
  }
  return cofiringJson({ok:true,bridgeVersion:1,targetDate:date,saved:cofiringPublicRequest(saved),result,active:cofiringPublicRequest(active),lastAttempt:cofiringPublicRequest(last)});
}
async function createCofiringLiveRequest(context,body,user) {
  const req=context.request,origin=req.headers.get('Origin');
  if(origin&&origin!==new URL(req.url).origin)return cofiringJson({ok:false,message:'같은 업무일지 화면에서 조회해 주세요.'},403);
  if(req.headers.get('X-ShiftLog-Client')!=='desktop'||/Android|iPhone|iPad|iPod|Mobile/i.test(req.headers.get('User-Agent')||''))return cofiringJson({ok:false,message:'새 DataPARC 조회는 로그인한 PC에서 가능합니다.'},403);
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')||''))return cofiringJson({ok:false,message:'JSON 요청이 필요합니다.'},415);
  if(new TextEncoder().encode(JSON.stringify(body)).length>4096)return cofiringJson({ok:false,message:'조회 요청이 너무 큽니다.'},413);
  const allowed=['action','requestType','targetDate','forceRefresh','clientRequestId','expectedResultId'];
  if(Object.keys(body).some(k=>!allowed.includes(k))||body.requestType!=='cofiring_daily'||body.action!=='create'||
     typeof body.forceRefresh!=='boolean'||!COFIRING_LIVE.uuid(body.clientRequestId)||
     (body.expectedResultId!==null&&!COFIRING_LIVE.uuid(body.expectedResultId)))return cofiringJson({ok:false,message:'하루 조회 요청 형식을 확인해 주세요.'},400);
  try{COFIRING_LIVE.completedDay(body.targetDate);}catch(e){return cofiringJson({ok:false,message:e.message},400);}
  const db=context.env.DB,date=body.targetDate;await ensureCofiringLiveIndexes(db);await expireCofiringLiveRequests(db);
  const reply=(r,reused=true)=>cofiringJson({ok:true,reused,bridgeVersion:1,targetDate:date,item:cofiringPublicRequest(r)},reused?200:201);
  const repeated=await db.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(body.clientRequestId).first();
  if(repeated){if(repeated.request_type!=='cofiring_daily'||repeated.target_date!==date||repeated.requested_by_id!==user.employeeNo)return cofiringJson({ok:false,message:'이미 다른 내용으로 처리된 요청입니다.'},409);return reply(repeated);}
  const active=await db.prepare("SELECT * FROM ois_data_requests WHERE request_type='cofiring_daily' AND target_date=? AND status IN ('pending','processing') LIMIT 1").bind(date).first();
  if(active)return reply(active);
  const saved=await cofiringLatestRow(db,date,'complete');
  if(saved&&!body.forceRefresh)return reply(saved);
  if(body.forceRefresh&&(saved?.id||null)!==body.expectedResultId)return cofiringJson({ok:false,code:'COFIRING_RESULT_CHANGED',message:'다른 화면에서 조회 결과가 갱신됐습니다. 저장값을 다시 확인해 주세요.'},409);
  const now=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();
  // INSERT/NOT EXISTS is atomic; the partial unique index is a second guard for concurrent first requests.
  await db.prepare(`INSERT INTO ois_data_requests(id,request_type,target_date,status,requested_by_id,requested_by_name,requested_at,started_at,completed_at,agent_id,result_json,error_message,expires_at,updated_at)
    SELECT ?,'cofiring_daily',?,'pending',?,?,?,NULL,NULL,'',NULL,'',?,?
    WHERE NOT EXISTS(SELECT 1 FROM ois_data_requests WHERE request_type='cofiring_daily' AND target_date=? AND status IN ('pending','processing'))
      AND ((?=0 AND NOT EXISTS(SELECT 1 FROM ois_data_requests WHERE request_type='cofiring_daily' AND target_date=? AND status='complete'))
        OR (?=1 AND COALESCE((SELECT id FROM ois_data_requests WHERE request_type='cofiring_daily' AND target_date=? AND status='complete' ORDER BY requested_at DESC,id DESC LIMIT 1),'')=?))
    ON CONFLICT DO NOTHING`).bind(body.clientRequestId,date,user.employeeNo,user.name,now,expires,now,date,body.forceRefresh?1:0,date,body.forceRefresh?1:0,date,body.expectedResultId||'').run();
  const created=await db.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(body.clientRequestId).first();
  if(created)return reply(created,false);
  const concurrent=await db.prepare("SELECT * FROM ois_data_requests WHERE request_type='cofiring_daily' AND target_date=? AND status IN ('pending','processing') LIMIT 1").bind(date).first();
  if(concurrent)return reply(concurrent);
  const latest=await cofiringLatestRow(db,date,'complete');if(latest&&!body.forceRefresh)return reply(latest);
  return cofiringJson({ok:false,code:'COFIRING_RESULT_CHANGED',message:'조회 상태가 변경됐습니다. 저장값을 다시 확인해 주세요.'},409);
}
async function completeCofiringLiveRequest(context,body,auth,existing) {
  if(!existing.agentId||existing.agentId!==auth.agentId||!['processing','complete'].includes(existing.status)||
     existing.status==='processing'&&Date.parse(existing.expiresAt)<=Date.now())return cofiringJson({ok:false,code:'COFIRING_CLAIM_REQUIRED',message:'이 요청을 가져간 Agent만 처리시간 안에 완료할 수 있습니다.'},409);
  let result;try{result=COFIRING_LIVE.result(body.result,existing.id,existing.targetDate);}catch(e){return cofiringJson({ok:false,message:e.message},400);}
  const completed=Date.parse(result.report.completedAtUtc);
  if(!Number.isFinite(Date.parse(existing.startedAt))||completed<Date.parse(existing.startedAt)-120000||completed>Date.now()+120000)return cofiringJson({ok:false,message:'이번 요청 이후에 완료된 조회 결과가 아닙니다. 회사 PC 시각도 확인해 주세요.'},400);
  const canonical=JSON.stringify(result);
  if(existing.status==='complete') {
    if(canonical!==JSON.stringify(existing.result))return cofiringJson({ok:false,code:'COFIRING_RESULT_CONFLICT',message:'이미 완료된 요청의 다른 결과는 저장할 수 없습니다.'},409);
    return cofiringJson({ok:true,replayed:true,requestId:existing.id,targetDate:existing.targetDate,stored:true,status:result.report.status});
  }
  const now=new Date().toISOString();
  const updated=await context.env.DB.prepare("UPDATE ois_data_requests SET status='complete',completed_at=?,result_json=?,error_message='',updated_at=? WHERE id=? AND request_type='cofiring_daily' AND status='processing' AND agent_id=? AND expires_at>?").bind(now,canonical,now,existing.id,auth.agentId,now).run();
  if(Number(updated?.meta?.changes)!==1)return cofiringJson({ok:false,message:'요청 소유권 또는 처리시간이 변경되어 저장하지 않았습니다.'},409);
  return cofiringJson({ok:true,requestId:existing.id,targetDate:existing.targetDate,stored:true,status:result.report.status});
}
async function handleCofiringProgress(context,body) {
  const auth=await authenticateOisAgent(context);if(auth.error)return auth.error;
  if(!COFIRING_LIVE.uuid(body.requestId)||!['starting','reading','cleanup','uploading'].includes(body.phase)||
    !Number.isInteger(body.completedTags)||body.completedTags<0||body.completedTags>10)return cofiringJson({ok:false,message:'잘못된 혼소율 진행 정보입니다.'},400);
  const now=new Date().toISOString(),p={kind:'cofiring_progress',phase:body.phase,completedTags:body.completedTags,updatedAt:now};
  const u=await context.env.DB.prepare("UPDATE ois_data_requests SET result_json=?,updated_at=? WHERE id=? AND request_type='cofiring_daily' AND status='processing' AND agent_id=? AND expires_at>?").bind(JSON.stringify(p),now,body.requestId,auth.agentId,now).run();
  return cofiringJson({ok:Number(u?.meta?.changes)===1},Number(u?.meta?.changes)===1?200:409);
}
async function handleCofiringAgentIdle(context) {
  const auth=await authenticateOisAgent(context);if(auth.error)return auth.error;
  const rows=await context.env.DB.prepare("SELECT id,request_type,target_date FROM ois_data_requests WHERE status='processing' AND agent_id=?").bind(auth.agentId).all();
  const guard=await context.env.DB.prepare("SELECT id,requested_by_id,expires_at FROM ois_data_requests WHERE request_type='cofiring_restart_guard' AND status='guard' AND agent_id=? AND expires_at>? LIMIT 1").bind(auth.agentId,new Date().toISOString()).first();
  return cofiringJson({ok:true,bridgeVersion:1,periodBridgeVersion:1,agentId:auth.agentId,busy:(rows.results||[]).length>0,items:rows.results||[],guard:guard?{token:guard.requested_by_id,expiresAt:guard.expires_at}:null});
}

// A short-lived control row only; never a plant value, pending request or new data table.
async function handleCofiringRestartGuard(context,body) {
  const auth=await authenticateOisAgent(context);if(auth.error)return auth.error;
  if(!COFIRING_LIVE.uuid(body.guardToken)||!['acquire','release'].includes(body.operation))return cofiringJson({ok:false,message:'재시작 보호 요청 형식이 다릅니다.'},400);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(auth.agentId)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const id='cofiring-restart-'+hash,db=context.env.DB,now=new Date().toISOString();
  if(body.operation==='release') {
    await db.prepare("DELETE FROM ois_data_requests WHERE id=? AND request_type='cofiring_restart_guard' AND agent_id=? AND requested_by_id=?").bind(id,auth.agentId,body.guardToken).run();
    return cofiringJson({ok:true,bridgeVersion:1,released:true,agentId:auth.agentId});
  }
  const expires=new Date(Date.now()+120000).toISOString();
  await db.prepare(`INSERT INTO ois_data_requests(id,request_type,target_date,status,requested_by_id,requested_by_name,requested_at,started_at,completed_at,agent_id,result_json,error_message,expires_at,updated_at)
    VALUES(?,'cofiring_restart_guard',?,'guard',?,'Agent restart guard',?,NULL,NULL,?,NULL,'',?,?)
    ON CONFLICT(id) DO UPDATE SET status='guard',requested_by_id=excluded.requested_by_id,expires_at=excluded.expires_at,updated_at=excluded.updated_at
    WHERE ois_data_requests.request_type='cofiring_restart_guard' AND (ois_data_requests.expires_at<=? OR ois_data_requests.requested_by_id=?)`)
    .bind(id,now.slice(0,10),body.guardToken,now,auth.agentId,expires,now,now,body.guardToken).run();
  const guard=await db.prepare("SELECT requested_by_id,expires_at FROM ois_data_requests WHERE id=? AND request_type='cofiring_restart_guard'").bind(id).first();
  if(guard?.requested_by_id!==body.guardToken)return cofiringJson({ok:false,message:'다른 재시작 작업이 진행 중입니다.'},409);
  return cofiringJson({ok:true,bridgeVersion:1,agentId:auth.agentId,guardToken:body.guardToken,expiresAt:guard.expires_at});
}


function parseCofiringPeriodRequestValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.kind === 'cofiring_period_request') return value;
  if (value.kind === 'cofiring_period_progress' && value.request) return value.request;
  if (value.kind === 'cofiring_period_live_result' && value.request) return value.request;
  return null;
}
function cofiringPeriodPublicRequest(row) {
  if (!row) return null;
  let request=null,progress=null;
  try {
    const parsed=JSON.parse(row.result_json||'null');
    request=parseCofiringPeriodRequestValue(parsed);
    if(parsed?.kind==='cofiring_period_progress') progress={phase:parsed.phase,completedTags:parsed.completedTags,updatedAt:parsed.updatedAt};
  } catch (_) {}
  return {id:row.id,targetDate:row.target_date,requestType:row.request_type,status:row.status,requestedAt:row.requested_at,startedAt:row.started_at,
    completedAt:row.completed_at,expiresAt:row.expires_at,requestedByName:row.requested_by_name,errorMessage:row.error_message||'',request,progress};
}
async function expireCofiringPeriodRequests(db) {
  const now=new Date().toISOString();
  await db.prepare("UPDATE ois_data_requests SET status='failed',error_message='기간 DataPARC Agent 응답 시간이 초과되었습니다. 기존 저장 결과는 유지합니다.',completed_at=?,updated_at=? WHERE request_type='cofiring_period' AND status IN ('pending','processing') AND expires_at<=?").bind(now,now,now).run();
}
function specFromPeriodUrl(url) {
  return {startLocal:url.searchParams.get('start')||'',endLocal:url.searchParams.get('end')||'',stepUnit:url.searchParams.get('stepUnit')||'',stepValue:Number(url.searchParams.get('stepValue'))};
}
async function findMatchingPeriodComplete(db,p) {
  const rows=await db.prepare("SELECT * FROM ois_data_requests WHERE request_type='cofiring_period' AND target_date=? AND status='complete' AND CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.request.startLocal') END=? AND CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.request.endLocal') END=? AND CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.request.stepUnit') END=? AND CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.request.stepValue') END=? ORDER BY requested_at DESC,id DESC LIMIT 20").bind(p.targetDate,p.startLocal,p.endLocal,p.stepUnit,p.stepValue).all();
  for(const row of rows.results||[]){
    try { const parsed=JSON.parse(row.result_json||'null'); const validated=COFIRING_LIVE.periodResult(parsed,row.id,p); return {row,validated}; } catch (_) {}
  }
  return null;
}
async function findMatchingPeriodAttempt(db,p) {
  const rows=await db.prepare("SELECT * FROM ois_data_requests WHERE request_type='cofiring_period' AND target_date=? ORDER BY requested_at DESC,id DESC LIMIT 20").bind(p.targetDate).all();
  const wanted=COFIRING_LIVE.periodKey(p);
  for(const row of rows.results||[]){
    try { const parsed=JSON.parse(row.result_json||'null'),req=parseCofiringPeriodRequestValue(parsed); if(req&&COFIRING_LIVE.periodKey(req)===wanted)return row; } catch (_) {}
  }
  return null;
}
/* COFIRING_LATEST_DAY_READ_V1. Restore a validated saved midnight prefix without
   creating requests, expiring work, or changing schemas/results. Authentication
   keeps the existing session bookkeeping. Candidate reads/validation are bounded. */
async function findLatestCofiringDayComplete(db,d,now) {
  const startLocal=d.targetDate+'T00:00',endLocal=d.end.slice(0,16);
  const pageSize=20,maxPages=10;
  let cursor=null;
  // A malformed JSON row must not abort discovery. The date/status index narrows
  // history first; JSON guards omit unrelated hourly/custom periods before LIMIT.
  const requestField=name=>`CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.request.${name}') END`;
  const completion="COALESCE(completed_at,'')",requested="COALESCE(requested_at,'')";
  const filters=`request_type='cofiring_period' AND target_date=? AND status='complete'
    AND length(result_json)<=? AND ${requestField('startLocal')}=?
    AND ${requestField('endLocal')}>? AND ${requestField('endLocal')}<=?
    AND ${requestField('stepUnit')}='minute' AND ${requestField('stepValue')}=1`;
  for(let page=0;page<maxPages;page++) {
    const after=cursor?` AND (${completion}<? OR (${completion}=? AND (${requested}<? OR (${requested}=? AND id<?))))`:'';
    const args=[d.targetDate,COFIRING_LIVE.MAX_BYTES,startLocal,startLocal,endLocal];
    if(cursor)args.push(cursor.completed,cursor.completed,cursor.requested,cursor.requested,cursor.id);
    const rows=await db.prepare(`SELECT * FROM ois_data_requests WHERE ${filters}${after}
      ORDER BY ${completion} DESC,${requested} DESC,id DESC LIMIT ${pageSize+1}`).bind(...args).all();
    const items=rows.results||[];
    for(const row of items.slice(0,pageSize)) {
      try {
        if(!Number.isFinite(Date.parse(row.completed_at))||!Number.isFinite(Date.parse(row.requested_at)))continue;
        const parsed=JSON.parse(row.result_json||'null'),p=COFIRING_LIVE.period(parsed?.request,now);
        if(p.startLocal!==startLocal||p.endMs>d.startMs+86400000||p.endMs+60000>now||p.stepUnit!=='minute'||p.stepValue!==1)continue;
        const validated=COFIRING_LIVE.periodResult(parsed,row.id,p);
        return {row,validated,period:p};
      } catch (_) { /* Invalid/unrelated saved rows cannot replace an authoritative result. */ }
    }
    if(items.length<=pageSize)return null;
    const last=items[pageSize-1];
    cursor={completed:last.completed_at||'',requested:last.requested_at||'',id:last.id};
  }
  const error=new Error('저장 이력이 많아 최신 결과 확인을 완료하지 못했습니다. 조회 기간을 지정해 저장 결과를 확인해 주세요.');
  error.code='COFIRING_LATEST_SCAN_LIMIT';
  throw error;
}
async function handleCofiringPeriodLatestGet(context,url) {
  const auth=await getAuthenticatedUser(context);if(auth.error)return auth.error;
  const targetDate=url.searchParams.get('targetDate'),now=Date.now();
  let d;try{d=COFIRING_LIVE.day(targetDate);if(d.startMs>now)throw new Error('미래 날짜의 저장 결과는 조회할 수 없습니다.');}
  catch(e){return cofiringJson({ok:false,message:e.message},400);}
  let match;try{match=await findLatestCofiringDayComplete(context.env.DB,d,now);}
  catch(e){if(e.code==='COFIRING_LATEST_SCAN_LIMIT')return cofiringJson({ok:false,code:e.code,message:e.message},503);throw e;}
  if(!match)return cofiringJson({ok:true,bridgeVersion:2,targetDate,periodKey:null,period:null,saved:null,result:null});
  const p=match.period,saved={...cofiringPeriodPublicRequest(match.row),request:match.validated.request,progress:null,errorMessage:''};
  return cofiringJson({ok:true,bridgeVersion:2,targetDate,periodKey:COFIRING_LIVE.periodKey(p),
    period:{start:p.startLocal,end:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue},saved,result:match.validated});
}
/* COFIRING_LATEST_DAY_READ_V1_END */
async function handleCofiringPeriodGet(context,url) {
  const auth=await getAuthenticatedUser(context);if(auth.error)return auth.error;
  let p;try{p=COFIRING_LIVE.period(specFromPeriodUrl(url));}catch(e){return cofiringJson({ok:false,message:e.message},400);}
  const db=context.env.DB;await ensureCofiringLiveIndexes(db);await expireCofiringPeriodRequests(db);
  const wanted=COFIRING_LIVE.periodKey(p);
  const savedMatch=await findMatchingPeriodComplete(db,p),saved=savedMatch?.row||null;
  const activeRows=await db.prepare("SELECT * FROM ois_data_requests WHERE request_type='cofiring_period' AND target_date=? AND status IN ('pending','processing') ORDER BY requested_at DESC,id DESC").bind(p.targetDate).all();
  let active=null;for(const row of activeRows.results||[]){try{const req=parseCofiringPeriodRequestValue(JSON.parse(row.result_json||'null'));if(req&&COFIRING_LIVE.periodKey(req)===wanted){active=row;break;}}catch(_){}}
  const last=await findMatchingPeriodAttempt(db,p);
  let result=null;if(saved&&saved.id!==url.searchParams.get('knownResultId'))result=savedMatch.validated;
  return cofiringJson({ok:true,bridgeVersion:2,periodKey:wanted,period:{start:p.startLocal,end:p.endLocal,stepUnit:p.stepUnit,stepValue:p.stepValue},saved:cofiringPeriodPublicRequest(saved),result,active:cofiringPeriodPublicRequest(active),lastAttempt:cofiringPeriodPublicRequest(last)});
}
async function createCofiringPeriodRequest(context,body,user) {
  const req=context.request,origin=req.headers.get('Origin');
  if(origin&&origin!==new URL(req.url).origin)return cofiringJson({ok:false,message:'같은 업무일지 화면에서 조회해 주세요.'},403);
  if(req.headers.get('X-ShiftLog-Client')!=='desktop'||/Android|iPhone|iPad|iPod|Mobile/i.test(req.headers.get('User-Agent')||''))return cofiringJson({ok:false,message:'기간 DataPARC 조회는 로그인한 PC에서 가능합니다.'},403);
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')||''))return cofiringJson({ok:false,message:'JSON 요청이 필요합니다.'},415);
  if(new TextEncoder().encode(JSON.stringify(body)).length>4096)return cofiringJson({ok:false,message:'기간 조회 요청이 너무 큽니다.'},413);
  const allowed=['action','requestType','start','end','stepUnit','stepValue','forceRefresh','clientRequestId','expectedResultId'];
  if(Object.keys(body).some(k=>!allowed.includes(k))||body.requestType!=='cofiring_period'||body.action!=='create'||typeof body.forceRefresh!=='boolean'||!COFIRING_LIVE.uuid(body.clientRequestId)||(body.expectedResultId!==null&&!COFIRING_LIVE.uuid(body.expectedResultId)))return cofiringJson({ok:false,message:'기간 조회 요청 형식을 확인해 주세요.'},400);
  let p,envelope;try{p=COFIRING_LIVE.period({startLocal:body.start,endLocal:body.end,stepUnit:body.stepUnit,stepValue:body.stepValue});envelope=COFIRING_LIVE.periodEnvelope(p);}catch(e){return cofiringJson({ok:false,message:e.message},400);}
  const db=context.env.DB;await ensureCofiringLiveIndexes(db);await expireCofiringPeriodRequests(db);const wanted=COFIRING_LIVE.periodKey(p);
  const reply=(r,reused=true)=>cofiringJson({ok:true,reused,bridgeVersion:2,periodKey:wanted,item:cofiringPeriodPublicRequest(r)},reused?200:201);
  const repeated=await db.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(body.clientRequestId).first();
  if(repeated){let same=false;try{const req0=parseCofiringPeriodRequestValue(JSON.parse(repeated.result_json||'null'));same=repeated.request_type==='cofiring_period'&&repeated.requested_by_id===user.employeeNo&&req0&&COFIRING_LIVE.periodKey(req0)===wanted;}catch(_){}if(!same)return cofiringJson({ok:false,message:'이미 다른 내용으로 처리된 요청입니다.'},409);return reply(repeated);}
  const active=await db.prepare("SELECT * FROM ois_data_requests WHERE request_type='cofiring_period' AND target_date=? AND status IN ('pending','processing') LIMIT 1").bind(p.targetDate).first();
  if(active){let activeKey='';try{const req0=parseCofiringPeriodRequestValue(JSON.parse(active.result_json||'null'));activeKey=req0?COFIRING_LIVE.periodKey(req0):'';}catch(_){}if(activeKey===wanted)return reply(active);return cofiringJson({ok:false,code:'COFIRING_PERIOD_BUSY',message:'같은 시작일의 다른 혼소율 기간 조회가 진행 중입니다. 완료 후 다시 실행해 주세요.'},409);}
  const savedMatch=await findMatchingPeriodComplete(db,p),saved=savedMatch?.row||null;if(saved&&!body.forceRefresh)return reply(saved);
  if(body.forceRefresh&&(saved?.id||null)!==body.expectedResultId)return cofiringJson({ok:false,code:'COFIRING_PERIOD_RESULT_CHANGED',message:'다른 화면에서 기간 조회 결과가 갱신됐습니다. 저장값을 다시 확인해 주세요.'},409);
  const now=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();
  await db.prepare(`INSERT INTO ois_data_requests(id,request_type,target_date,status,requested_by_id,requested_by_name,requested_at,started_at,completed_at,agent_id,result_json,error_message,expires_at,updated_at)
    VALUES(?,'cofiring_period',?,'pending',?,?,?,NULL,NULL,'',?,'',?,?) ON CONFLICT DO NOTHING`).bind(body.clientRequestId,p.targetDate,user.employeeNo,user.name,now,JSON.stringify(envelope),expires,now).run();
  const created=await db.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(body.clientRequestId).first();if(created)return reply(created,false);
  return cofiringJson({ok:false,code:'COFIRING_PERIOD_RESULT_CHANGED',message:'기간 조회 상태가 변경됐습니다. 다시 확인해 주세요.'},409);
}
async function completeCofiringPeriodRequest(context,body,auth,existing) {
  if(!existing.agentId||existing.agentId!==auth.agentId||!['processing','complete'].includes(existing.status)||(existing.status==='processing'&&Date.parse(existing.expiresAt)<=Date.now()))return cofiringJson({ok:false,code:'COFIRING_PERIOD_CLAIM_REQUIRED',message:'이 기간 요청을 가져간 Agent만 처리시간 안에 완료할 수 있습니다.'},409);
  let requestSpec=parseCofiringPeriodRequestValue(existing.result);if(existing.status==='complete'&&existing.result?.request)requestSpec=existing.result.request;
  if(!requestSpec)return cofiringJson({ok:false,message:'기간 요청 범위를 복원하지 못했습니다.'},409);
  let result;try{result=COFIRING_LIVE.periodResult(body.result,existing.id,requestSpec);}catch(e){return cofiringJson({ok:false,message:e.message},400);}
  const completed=Date.parse(result.report.completedAtUtc);if(!Number.isFinite(Date.parse(existing.startedAt))||completed<Date.parse(existing.startedAt)-120000||completed>Date.now()+120000)return cofiringJson({ok:false,message:'이번 기간 요청 이후에 완료된 결과가 아닙니다.'},400);
  const canonical=JSON.stringify(result);if(existing.status==='complete'){if(canonical!==JSON.stringify(existing.result))return cofiringJson({ok:false,code:'COFIRING_PERIOD_RESULT_CONFLICT',message:'이미 완료된 기간 요청의 다른 결과는 저장할 수 없습니다.'},409);return cofiringJson({ok:true,replayed:true,requestId:existing.id,stored:true,status:result.report.status});}
  const now=new Date().toISOString(),updated=await context.env.DB.prepare("UPDATE ois_data_requests SET status='complete',completed_at=?,result_json=?,error_message='',updated_at=? WHERE id=? AND request_type='cofiring_period' AND status='processing' AND agent_id=? AND expires_at>?").bind(now,canonical,now,existing.id,auth.agentId,now).run();
  if(Number(updated?.meta?.changes)!==1)return cofiringJson({ok:false,message:'기간 요청 소유권 또는 처리시간이 변경되어 저장하지 않았습니다.'},409);
  return cofiringJson({ok:true,requestId:existing.id,stored:true,status:result.report.status});
}
async function handleCofiringPeriodProgress(context,body) {
  const auth=await authenticateOisAgent(context);if(auth.error)return auth.error;
  if(!COFIRING_LIVE.uuid(body.requestId)||!['starting','reading','cleanup','uploading'].includes(body.phase)||!Number.isInteger(body.completedTags)||body.completedTags<0||body.completedTags>10)return cofiringJson({ok:false,message:'잘못된 기간 혼소율 진행 정보입니다.'},400);
  const row=await context.env.DB.prepare("SELECT result_json FROM ois_data_requests WHERE id=? AND request_type='cofiring_period' AND status='processing' AND agent_id=?").bind(body.requestId,auth.agentId).first();if(!row)return cofiringJson({ok:false},409);
  let request=null;try{request=parseCofiringPeriodRequestValue(JSON.parse(row.result_json||'null'));}catch(_){}if(!request)return cofiringJson({ok:false,message:'기간 요청 범위를 복원하지 못했습니다.'},409);
  const now=new Date().toISOString(),p={kind:'cofiring_period_progress',schemaVersion:1,request,phase:body.phase,completedTags:body.completedTags,updatedAt:now};
  const u=await context.env.DB.prepare("UPDATE ois_data_requests SET result_json=?,updated_at=? WHERE id=? AND request_type='cofiring_period' AND status='processing' AND agent_id=? AND expires_at>?").bind(JSON.stringify(p),now,body.requestId,auth.agentId,now).run();
  return cofiringJson({ok:Number(u?.meta?.changes)===1},Number(u?.meta?.changes)===1?200:409);
}

export const __cofiringLiveTest = {contract:COFIRING_LIVE,createCofiringLiveRequest,completeCofiringLiveRequest,handleCofiringLiveGet,handleCofiringProgress,createCofiringPeriodRequest,completeCofiringPeriodRequest,handleCofiringPeriodGet,handleCofiringPeriodProgress};
// COFIRING_WEB_BRIDGE_V1_END
