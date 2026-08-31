const FORCED_SUPER_ADMIN_EMPLOYEE_NO = "2014081";

const TYPE_DEFINITIONS = [
  {
    key: "fbhe",
    label: "FBHE Blower",
    important: true,
    expected: { "1": 3, "2": 3 }
  },
  {
    key: "seal_pot",
    label: "Seal Pot Blower",
    important: false,
    expected: { "1": 3, "2": 3 }
  },
  {
    key: "organic_fuel",
    label: "유기성 고형연료 Blower",
    important: false,
    expected: { "1": 2, "2": 2 }
  },
  {
    key: "flyash_bag",
    label: "Fly Ash Bag Filter Aeration Blower",
    important: false,
    expected: { "1": 2, "2": 2 }
  },
  {
    key: "flyash_silo",
    label: "Fly Ash Silo Aeration Blower",
    important: false,
    expected: { shared: 2 }
  }
];

// 실제 TAG와 호기가 확인되지 않은 설비는 DB asset으로 만들지 않는다.
// TAG가 확정되기 전까지는 조회 전용 placeholder로만 노출해 이력 오귀속을 막는다.
const PENDING_ASSET_SLOTS = Object.freeze([
  {
    slotKey: "organic_fuel_manure_pending",
    blowerType: "organic_fuel",
    groupKey: "manure",
    groupLabel: "축분 Blower",
    positionLabel: "#1",
    displayName: "축분 Blower",
    identityPending: true
  }
]);

const ASSET_SEEDS = [
  ["104HHL60AP611", "fbhe", "1", "#A", "#1 FBHE Blower #A", 101],
  ["104HHL60AP621", "fbhe", "1", "#B", "#1 FBHE Blower #B", 102],
  ["104HHL60AP631", "fbhe", "1", "#C", "#1 FBHE Blower #C", 103],
  ["204HHL60AP611", "fbhe", "2", "#A", "#2 FBHE Blower #A", 201],
  ["204HHL60AP621", "fbhe", "2", "#B", "#2 FBHE Blower #B", 202],
  ["204HHL60AP631", "fbhe", "2", "#C", "#2 FBHE Blower #C", 203],

  ["104HHL10AN611", "seal_pot", "1", "#A", "#1 Seal Pot Blower #A", 301],
  ["104HHL10AN621", "seal_pot", "1", "#B", "#1 Seal Pot Blower #B", 302],
  ["104HHL10AN631", "seal_pot", "1", "#C", "#1 Seal Pot Blower #C", 303],
  ["204HHL10AN611", "seal_pot", "2", "#A", "#2 Seal Pot Blower #A", 351],
  ["204HHL10AN621", "seal_pot", "2", "#B", "#2 Seal Pot Blower #B", 352],
  ["204HHL10AN631", "seal_pot", "2", "#C", "#2 Seal Pot Blower #C", 353],

  ["104SDF01AN001", "organic_fuel", "1", "#A", "#1 유기성 고형연료 Blower #A", 401],
  ["104SDF01AN002", "organic_fuel", "1", "#B", "#1 유기성 고형연료 Blower #B", 402],
  ["204SDF01AN001", "organic_fuel", "2", "#A", "#2 유기성 고형연료 Blower #A", 451],
  ["204SDF01AN002", "organic_fuel", "2", "#B", "#2 유기성 고형연료 Blower #B", 452],

  ["104ETG30AN601", "flyash_bag", "1", "#A", "#1 Fly Ash Bag Filter Aeration Blower #A", 501],
  ["104ETG30AN602", "flyash_bag", "1", "#B", "#1 Fly Ash Bag Filter Aeration Blower #B", 502],
  ["204ETG30AN601", "flyash_bag", "2", "#A", "#2 Fly Ash Bag Filter Aeration Blower #A", 551],
  ["204ETG30AN602", "flyash_bag", "2", "#B", "#2 Fly Ash Bag Filter Aeration Blower #B", 552],

  ["104ETH03AN601", "flyash_silo", "shared", "#A", "Fly Ash Silo Aeration Blower #A", 601],
  ["104ETH03AN602", "flyash_silo", "shared", "#B", "Fly Ash Silo Aeration Blower #B", 602]
];

const ASSET_SEED_TAG_SET = new Set(ASSET_SEEDS.map(seed => seed[0]));
const ASSET_SEED_TAG_ASSETS = ASSET_SEEDS.map(seed => ({ tag_number: seed[0] }));

const PROBLEM_KEYWORDS = [
  ["파손", "파손"],
  ["소손", "소손"],
  ["끊김", "끊김"],
  ["끊킴", "끊김"],
  ["절손", "절손"],
  ["크랙", "크랙"],
  ["crack", "크랙"],
  ["균열", "균열"],
  ["손상", "손상"],
  ["누설", "누설"],
  ["leak", "누설"],
  ["마모", "마모"],
  ["변형", "변형"],
  ["천공", "천공"],
  ["파열", "파열"],
  ["진동", "이상진동"]
];

const REPLACEMENT_KEYWORDS = [
  "교체",
  "교환",
  "replacement",
  "replace",
  "exchange"
];

const REPLACEMENT_PLAN_KEYWORDS = [
  "교체 예정",
  "교체예정",
  "교체 계획",
  "교체계획",
  "교체 필요",
  "교체필요",
  "교체 검토",
  "교체검토",
  "교체 요청",
  "교체요청",
  "교체 준비",
  "교체준비",
  "교체 여부",
  "교체여부",
  "교체 대상",
  "교체대상",
  "교체 주기",
  "교체주기",
  "교체 시기",
  "교체시기",
  "교체 가능",
  "교체가능",
  "명일 교체",
  "명일교체",
  "차후 교체",
  "차후교체",
  "추후 교체",
  "추후교체",
  "향후 교체",
  "향후교체",
  "교체 요망",
  "교체요망",
  "교체 지시",
  "교체지시"
];

const REPLACEMENT_COMPLETE_KEYWORDS = [
  "교체 완료",
  "교체완료",
  "교체 작업 완료",
  "교체작업 완료",
  "교체작업완료",
  "교체 실시",
  "교체실시",
  "교체 시행",
  "교체시행",
  "교체함",
  "교체하였",
  "교체하여",
  "교체했",
  "교환 완료",
  "교환완료",
  "교환 실시",
  "교환실시",
  "교환함",
  "교환하였",
  "교환했",
  "replaced",
  "replacement complete",
  "replacement completed"
];

const REPLACEMENT_EXCLUSION_KEYWORDS = [
  "교체운전",
  "교체 운전",
  "tm 발행",
  "tm발행",
  "작업 요청",
  "작업요청",
  "작업 예정",
  "작업예정",
  "교체 중",
  "교체중",
  "교체 작업 중",
  "교체작업중",
  "미교체",
  "교체 미실시",
  "교체미실시",
  "교체 미완료",
  "교체미완료",
  "교체 보류",
  "교체보류",
  "교체 취소",
  "교체취소",
  "교체 불가",
  "교체불가",
  "교체하지 않",
  "교체 안",
  "not replaced",
  "replacement cancelled",
  "replacement canceled"
];

const COMPONENT_REPLACEMENT_KEYWORDS = [
  "bearing",
  "베어링",
  "coupling",
  "커플링",
  "filter",
  "필터",
  "grease",
  "그리스",
  "oil",
  "오일",
  "packing",
  "패킹",
  "mechanical seal",
  "메카니컬씰",
  "motor",
  "모터",
  "impeller",
  "임펠러",
  "bolt",
  "볼트"
];

const HISTORY_BACKFILL_ID = "shift_logs_approved_canonical_replacements_v9";
const HISTORY_BACKFILL_START_DATE = "2021-01-01";
const HISTORY_BACKFILL_BATCH_SIZE = 200;
const HISTORY_BACKFILL_STALE_LEASE_MS = 2 * 60 * 1000;
const HISTORY_AUDIT_VERSION = "blower_vbelt_missing_history_audit_v11_r2";
const HISTORY_RECOVERY_V12_ID = "blower_vbelt_confirmed_recovery_v12";
const HISTORY_RECOVERY_V12_VERSION = "blower_vbelt_context_recovery_v13_r2";
const HISTORY_RECOVERY_V12_CUTOFF_DATE = "2026-08-26";
const HISTORY_RECOVERY_V12_EXPECTED_EVENTS = 0;
const HISTORY_RECOVERY_V12_SOURCE_ORDER = ["shift_logs", "legacy_logs"];
const HISTORY_RECOVERY_V12_SHIFT_SCAN_BATCH = 20;
const HISTORY_RECOVERY_V12_LEGACY_SCAN_BATCH = 40;
const HISTORY_RECOVERY_V12_LEASE_MS = 30 * 1000;
const HISTORY_RECOVERY_V12_LOCK_STALE_MS = 35 * 1000;

const HISTORY_RECOVERY_V13_SOURCE_TYPE = "shift_log_history_v13";
const HISTORY_RECOVERY_V13_CREATED_BY_ID = "history_v13";
const HISTORY_RECOVERY_V13_CREATED_BY_NAME = "업무일지 V13 문맥복구";
const OPERATION_AUTO_SOURCE_TYPE = "shift_log_operation_auto";
const OPERATION_AUTO_CREATED_BY_ID = "operation_auto";
const OPERATION_AUTO_CREATED_BY_NAME = "업무일지 교체운전 자동";
const OPERATION_SYNC_DEFAULT_DAYS = 14;

/* [FBHE-VIBRATION-SHADOW-V1]
  OIS 진동값은 Shadow 검증에만 사용한다.
  이 버전은 실제 기동·정지, 누적시간, V-Belt Cycle을 자동 변경하지 않는다.
*/
const FBHE_VIBRATION_REQUEST_TYPE = "fbhe_vibration";
const FBHE_VIBRATION_ASSET_TAGS = Object.freeze(
  ASSET_SEEDS
    .filter(seed => seed[1] === "fbhe")
    .map(seed => seed[0])
);
const FBHE_VIBRATION_SENSOR_ROLES = Object.freeze([
  "blower_de",
  "blower_nde",
  "motor_de",
  "motor_nde"
]);
const FBHE_VIBRATION_STOP_DROP_RATIO = 0.35;
const FBHE_VIBRATION_START_RISE_RATIO = 2.8;
const FBHE_VIBRATION_ABSOLUTE_STOP_MAX = 0.5;
const FBHE_VIBRATION_ABSOLUTE_RUN_MIN = 1.0;
const FBHE_VIBRATION_MANUAL_MATCH_WINDOW_MS = 90 * 60 * 1000;
const FBHE_VIBRATION_MAX_TRANSITION_GAP_MS = 90 * 60 * 1000;
const FBHE_VIBRATION_RANGE_CHUNK_DAYS = 31;
const FBHE_VIBRATION_RANGE_MAX_DAYS = 366;
const FBHE_VIBRATION_RUNTIME_GAP_MS = 90 * 60 * 1000;

const HISTORY_RECOVERY_V13_TAG_ALIASES = Object.freeze({
  "103ETG30AN601": "104ETG30AN601",
  "103ETG30AN602": "104ETG30AN602",
  "203ETG30AN601": "204ETG30AN601",
  "203ETG30AN602": "204ETG30AN602"
});
const HISTORY_AUDIT_BATCH_SIZES = Object.freeze({
  shift_logs: 5,
  legacy_logs: 3,
  event_archive: 10
});
const HISTORY_AUDIT_LEGACY_SCAN_BATCH_SIZE = 100;

const HISTORY_AUDIT_SOURCE_ORDER = [
  "shift_logs",
  "legacy_logs",
  "event_archive"
];

const DUPLICATE_SIMILARITY_THRESHOLD = 0.70;

const DUTY_ROLE_SUPERIOR = {
  BO1: "BCO1",
  BO2: "BCO2",
  TO: "TGO"
};

const DUTY_ROLE_HIGHER = new Set(Object.values(DUTY_ROLE_SUPERIOR));
const DUTY_ROLE_LOWER = new Set(Object.keys(DUTY_ROLE_SUPERIOR));

const DUTY_ROLE_UNIT = {
  BCO1: "1",
  BO1: "1",
  BCO2: "2",
  BO2: "2"
};

const TYPE_CONTEXT_KEYWORDS = {
  fbhe: ["fbhe", "hhl60"],
  seal_pot: ["seal pot", "sealpot", "hhl10"],
  organic_fuel: ["유기성 고형연료", "유기성고형연료", "organic fuel", "sdf01"],
  flyash_bag: ["fly ash bag filter", "flyash bag filter", "bag filter aeration", "etg30"],
  flyash_silo: ["fly ash silo", "flyash silo", "silo aeration", "eth03"]
};

const TYPE_IDENTITY_LABELS = {
  fbhe: "FBHE",
  seal_pot: "Seal Pot",
  organic_fuel: "유기성 고형연료",
  flyash_bag: "Fly Ash Bag Filter Aeration",
  flyash_silo: "Fly Ash Silo Aeration"
};

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isMobileMonitoringRequest(context) {
  return normalizeText(context?.request?.headers?.get("X-GS-Client-Mode")) === "mobile-monitoring";
}

function normalizeEmployeeNo(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeRole(value) {
  const role = normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (["super_admin", "superadmin"].includes(role)) {
    return "super_admin";
  }

  if (["admin", "leader"].includes(role)) {
    return "admin";
  }

  if (["team_manager", "teammanager"].includes(role)) {
    return "team_manager";
  }

  return "user";
}

function getBearerToken(request) {
  const authorization = normalizeText(
    request.headers.get("Authorization")
  );

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return normalizeText(match?.[1]);
}

function bytesToHex(bytes) {
  return [...bytes]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return bytesToHex(new Uint8Array(digest));
}

async function getAuthenticatedUser(context, options = {}) {
  const database = context?.env?.DB;
  const optional = options.optional === true;

  if (!database) {
    return {
      error: jsonResponse(
        {
          ok: false,
          message: "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      )
    };
  }

  const token = getBearerToken(context.request);

  if (!token) {
    if (optional) {
      return { user: null };
    }

    return {
      error: jsonResponse(
        {
          ok: false,
          message: "로그인이 필요합니다."
        },
        401
      )
    };
  }

  const tokenHash = await hashSessionToken(token);

  const session = await database
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
    .bind(tokenHash)
    .first();

  const now = new Date();
  const expiresAt = new Date(session?.expires_at || 0);

  if (
    !session ||
    Number(session.is_active) !== 1 ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt <= now
  ) {
    if (!optional && session) {
      await database
        .prepare(`
          DELETE FROM shift_log_sessions
          WHERE token_hash = ?
        `)
        .bind(tokenHash)
        .run();
    }

    if (optional) {
      return { user: null };
    }

    return {
      error: jsonResponse(
        {
          ok: false,
          message: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
        },
        401
      )
    };
  }

  const employeeNo = normalizeEmployeeNo(session.employee_no);
  const role =
    employeeNo === FORCED_SUPER_ADMIN_EMPLOYEE_NO
      ? "super_admin"
      : normalizeRole(session.role);

  const lastUsedAt = new Date(session.last_used_at || 0);
  const shouldTouch =
    Number.isNaN(lastUsedAt.getTime()) ||
    now.getTime() - lastUsedAt.getTime() >= 5 * 60 * 1000;

  if (shouldTouch) {
    await database
      .prepare(`
        UPDATE shift_log_sessions
        SET last_used_at = ?
        WHERE token_hash = ?
      `)
      .bind(now.toISOString(), tokenHash)
      .run();
  }

  return {
    user: {
      employeeNo,
      name: normalizeText(session.name),
      role,
      isAdmin: role === "admin" || role === "super_admin",
      isSuperAdmin: role === "super_admin"
    }
  };
}

function buildPermissions(user) {
  return {
    canWrite: Boolean(user),
    canReview: Boolean(user),
    canAdmin: Boolean(user?.isSuperAdmin)
  };
}

function sanitizeSettingsForAnonymous(settings) {
  return Object.fromEntries(
    Object.entries(settings || {}).map(([key, value]) => {
      const {
        updatedById: _updatedById,
        updatedByName: _updatedByName,
        ...publicValue
      } = value || {};

      return [key, publicValue];
    })
  );
}

function sanitizeEventsForAnonymous(events) {
  return (events || []).map(event => {
    const {
      id: _id,
      sourceLogId: _sourceLogId,
      createdById: _createdById,
      createdByName: _createdByName,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...publicEvent
    } = event || {};

    return publicEvent;
  });
}

function sanitizeAssetsForAnonymous(assets) {
  return (assets || []).map(asset => {
    if (!asset) return asset;

    const publicReference = asset.latestReference
      ? (() => {
          const {
            sourceLogId: _sourceLogId,
            ...reference
          } = asset.latestReference;
          return reference;
        })()
      : null;

    const publicProblem = asset.latestProblem
      ? (() => {
          const {
            id: _id,
            ...problem
          } = asset.latestProblem;
          return problem;
        })()
      : null;

    return {
      ...asset,
      latestProblem: publicProblem,
      latestReference: publicReference
    };
  });
}

function sanitizeBackfillForAnonymous(backfill) {
  if (!backfill) return null;

  return {
    targetDate: normalizeText(backfill.targetDate),
    status: normalizeText(backfill.status),
    isCompleteForToday: backfill.isCompleteForToday === true,
    hasRun: backfill.hasRun === true,
    requiresInitialRebuild: backfill.requiresInitialRebuild === true,
    requiresCatchUp: backfill.requiresCatchUp === true
  };
}

async function ensureSchema(database) {
  await database.batch([
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_settings (
        blower_type TEXT PRIMARY KEY NOT NULL,
        cycle_days REAL,
        warning_days REAL,
        critical_days REAL,
        updated_by_id TEXT NOT NULL DEFAULT '',
        updated_by_name TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_setting_history (
        id TEXT PRIMARY KEY NOT NULL,
        blower_type TEXT NOT NULL,
        old_cycle_days REAL,
        new_cycle_days REAL,
        old_warning_days REAL,
        new_warning_days REAL,
        old_critical_days REAL,
        new_critical_days REAL,
        changed_by_id TEXT NOT NULL,
        changed_by_name TEXT NOT NULL,
        changed_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_assets (
        tag_number TEXT PRIMARY KEY NOT NULL,
        blower_type TEXT NOT NULL,
        unit_no TEXT NOT NULL,
        asset_group TEXT NOT NULL DEFAULT '',
        position_label TEXT NOT NULL,
        display_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        asset_revision TEXT NOT NULL DEFAULT '',
        last_replacement_at TEXT,
        cycle_started_at TEXT,
        cycle_start_state TEXT NOT NULL DEFAULT 'legacy',
        cycle_start_revision TEXT NOT NULL DEFAULT '',
        cycle_runtime_hours REAL,
        cycle_runtime_anchor_at TEXT,
        cycle_runtime_state TEXT NOT NULL DEFAULT '',
        cycle_runtime_revision TEXT NOT NULL DEFAULT '',
        runtime_hours REAL NOT NULL DEFAULT 0,
        runtime_anchor_at TEXT,
        is_running INTEGER NOT NULL DEFAULT 0,
        last_modified_by_id TEXT NOT NULL DEFAULT '',
        last_modified_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_asset_history (
        id TEXT PRIMARY KEY NOT NULL,
        action_type TEXT NOT NULL,
        tag_number TEXT NOT NULL,
        before_json TEXT NOT NULL DEFAULT '',
        after_json TEXT NOT NULL DEFAULT '',
        change_note TEXT NOT NULL DEFAULT '',
        changed_by_id TEXT NOT NULL,
        changed_by_name TEXT NOT NULL,
        changed_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_blower_history_asset_history_tag_date
      ON blower_history_asset_history (tag_number, changed_at DESC)
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_atomic_guard (
        id TEXT PRIMARY KEY NOT NULL,
        valid INTEGER NOT NULL CHECK(valid = 1)
      )
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_events (
        id TEXT PRIMARY KEY NOT NULL,
        tag_number TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_date TEXT NOT NULL,
        runtime_hours REAL NOT NULL DEFAULT 0,
        issue_type TEXT NOT NULL DEFAULT '',
        action_type TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_log_id TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        created_by_id TEXT NOT NULL,
        created_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_blower_history_events_tag_date
      ON blower_history_events (tag_number, event_date DESC)
    `),
    database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_blower_history_events_type_date
      ON blower_history_events (event_type, event_date DESC)
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_candidates (
        id TEXT PRIMARY KEY NOT NULL,
        source_fingerprint TEXT NOT NULL UNIQUE,
        tag_number TEXT NOT NULL,
        detected_type TEXT NOT NULL,
        detected_date TEXT NOT NULL,
        issue_type TEXT NOT NULL DEFAULT '',
        action_type TEXT NOT NULL DEFAULT '',
        source_log_id TEXT NOT NULL,
        source_shift TEXT NOT NULL DEFAULT '',
        source_role TEXT NOT NULL DEFAULT '',
        source_author TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_id TEXT NOT NULL DEFAULT '',
        reviewed_by_name TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT,
        created_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_blower_history_candidates_status_date
      ON blower_history_candidates (status, detected_date DESC)
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_backfill_state (
        id TEXT PRIMARY KEY NOT NULL,
        target_date TEXT NOT NULL DEFAULT '',
        cursor_date TEXT NOT NULL DEFAULT '',
        cursor_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'idle',
        scanned_logs INTEGER NOT NULL DEFAULT 0,
        auto_confirmed_events INTEGER NOT NULL DEFAULT 0,
        pending_candidates INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_references (
        tag_number TEXT PRIMARY KEY NOT NULL,
        reference_date TEXT NOT NULL,
        source_log_id TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        reference_kind TEXT NOT NULL DEFAULT 'mention',
        updated_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_event_archive (
        migration_id TEXT NOT NULL,
        id TEXT NOT NULL,
        tag_number TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_date TEXT NOT NULL,
        runtime_hours REAL NOT NULL DEFAULT 0,
        issue_type TEXT NOT NULL DEFAULT '',
        action_type TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT '',
        source_log_id TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        created_by_id TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        PRIMARY KEY (migration_id, id)
      )
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_candidate_archive (
        migration_id TEXT NOT NULL,
        id TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        tag_number TEXT NOT NULL,
        detected_type TEXT NOT NULL,
        detected_date TEXT NOT NULL,
        issue_type TEXT NOT NULL DEFAULT '',
        action_type TEXT NOT NULL DEFAULT '',
        source_log_id TEXT NOT NULL DEFAULT '',
        source_shift TEXT NOT NULL DEFAULT '',
        source_role TEXT NOT NULL DEFAULT '',
        source_author TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        reviewed_by_id TEXT NOT NULL DEFAULT '',
        reviewed_by_name TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        PRIMARY KEY (migration_id, id)
      )
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_reference_archive (
        migration_id TEXT NOT NULL,
        tag_number TEXT NOT NULL,
        reference_date TEXT NOT NULL,
        source_log_id TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        reference_kind TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        PRIMARY KEY (migration_id, tag_number)
      )
    `)
  ]);

  await ensureAssetManagementSchema(database);

  const now = new Date().toISOString();

  const settingSeeds = [
    ["fbhe", 90, 7, 3],
    ["seal_pot", null, null, null],
    ["organic_fuel", null, null, null],
    ["flyash_bag", null, null, null],
    ["flyash_silo", null, null, null]
  ];

  for (const [type, cycleDays, warningDays, criticalDays] of settingSeeds) {
    await database
      .prepare(`
        INSERT OR IGNORE INTO blower_history_settings (
          blower_type,
          cycle_days,
          warning_days,
          critical_days,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(type, cycleDays, warningDays, criticalDays, now)
      .run();
  }

  for (const seed of ASSET_SEEDS) {
    const [tag, type, unitNo, position, displayName, sortOrder] = seed;

    await database
      .prepare(`
        INSERT OR IGNORE INTO blower_history_assets (
          tag_number,
          blower_type,
          unit_no,
          position_label,
          display_name,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        tag,
        type,
        unitNo,
        position,
        displayName,
        sortOrder,
        now,
        now
      )
      .run();
  }
}

async function ensureAssetManagementSchema(database) {
  const columnResult = await database
    .prepare(`PRAGMA table_info(blower_history_assets)`)
    .all();
  let columns = Array.isArray(columnResult.results) ? columnResult.results : [];
  const requiredColumns = [
    { name: "asset_group", definition: "asset_group TEXT NOT NULL DEFAULT ''" },
    { name: "asset_revision", definition: "asset_revision TEXT NOT NULL DEFAULT ''" },
    { name: "cycle_started_at", definition: "cycle_started_at TEXT" },
    { name: "cycle_start_state", definition: "cycle_start_state TEXT NOT NULL DEFAULT 'legacy'" },
    { name: "cycle_start_revision", definition: "cycle_start_revision TEXT NOT NULL DEFAULT ''" },
    { name: "cycle_runtime_hours", definition: "cycle_runtime_hours REAL" },
    { name: "cycle_runtime_anchor_at", definition: "cycle_runtime_anchor_at TEXT" },
    { name: "cycle_runtime_state", definition: "cycle_runtime_state TEXT NOT NULL DEFAULT ''" },
    { name: "cycle_runtime_revision", definition: "cycle_runtime_revision TEXT NOT NULL DEFAULT ''" }
  ];

  for (const required of requiredColumns) {
    if (columns.some(column => normalizeText(column.name) === required.name)) continue;
    try {
      await database
        .prepare(`ALTER TABLE blower_history_assets ADD COLUMN ${required.definition}`)
        .run();
    } catch (error) {
      const retryResult = await database
        .prepare(`PRAGMA table_info(blower_history_assets)`)
        .all();
      const retryColumns = Array.isArray(retryResult.results) ? retryResult.results : [];
      if (!retryColumns.some(column => normalizeText(column.name) === required.name)) {
        throw error;
      }
      columns = retryColumns;
    }
  }

  await database.batch([
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_asset_history (
        id TEXT PRIMARY KEY NOT NULL,
        action_type TEXT NOT NULL,
        tag_number TEXT NOT NULL,
        before_json TEXT NOT NULL DEFAULT '',
        after_json TEXT NOT NULL DEFAULT '',
        change_note TEXT NOT NULL DEFAULT '',
        changed_by_id TEXT NOT NULL,
        changed_by_name TEXT NOT NULL,
        changed_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_blower_history_asset_history_tag_date
      ON blower_history_asset_history (tag_number, changed_at DESC)
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_atomic_guard (
        id TEXT PRIMARY KEY NOT NULL,
        valid INTEGER NOT NULL CHECK(valid = 1)
      )
    `),
    database.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_blower_history_assets_active_slot
      ON blower_history_assets (
        blower_type,
        unit_no,
        asset_group,
        position_label COLLATE NOCASE
      )
      WHERE enabled = 1
    `),
    database.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_blower_history_assets_canonical_tag
      ON blower_history_assets (
        UPPER(REPLACE(REPLACE(REPLACE(REPLACE(tag_number, '.', ''), '_', ''), '/', ''), '-', ''))
      )
    `)
  ]);

  await initializeCycleRuntimeTracking(database);
}

async function ensureBlowerHistorySchemaReady(database) {
  // 운영 GET/POST마다 전체 CREATE TABLE/INDEX + seed INSERT를 반복하지 않는다.
  // 이미 운영 스키마/필수 seed가 준비되어 있으면 읽기 1회로 바로 진행한다.
  // 최초 설치/실제 schema 누락 시에만 기존 full ensureSchema를 실행한다.
  try {
    const ready = await database.prepare(`
      SELECT
        (
          SELECT COUNT(*)
          FROM blower_history_settings
          WHERE blower_type IN ('fbhe', 'seal_pot', 'organic_fuel', 'flyash_bag', 'flyash_silo')
        ) AS setting_count,
        (
          SELECT COUNT(*)
          FROM blower_history_assets
          WHERE tag_number IN (
            '204HHL60AP631',
            '204HHL10AN631',
            '204SDF01AN002',
            '204ETG30AN602',
            '104ETH03AN602'
          )
        ) AS sentinel_asset_count
    `).first();

    await database
      .prepare(`SELECT asset_group, asset_revision, cycle_started_at, cycle_start_state, cycle_start_revision, cycle_runtime_hours, cycle_runtime_anchor_at, cycle_runtime_state, cycle_runtime_revision FROM blower_history_assets LIMIT 1`)
      .first();
    const uninitializedCycleRuntime = await database
      .prepare(`SELECT COUNT(*) AS count FROM blower_history_assets WHERE cycle_runtime_hours IS NULL`)
      .first();
    await database
      .prepare(`SELECT id FROM blower_history_asset_history LIMIT 1`)
      .first();
    const atomicGuardTable = await database
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'blower_history_atomic_guard'
        LIMIT 1
      `)
      .first();
    const activeSlotIndex = await database
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_blower_history_assets_active_slot'
        LIMIT 1
      `)
      .first();
    const canonicalTagIndex = await database
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_blower_history_assets_canonical_tag'
        LIMIT 1
      `)
      .first();

    if (
      Number(ready?.setting_count || 0) >= 5 &&
      Number(ready?.sentinel_asset_count || 0) >= 5 &&
      Number(uninitializedCycleRuntime?.count || 0) === 0 &&
      atomicGuardTable?.name === "blower_history_atomic_guard" &&
      activeSlotIndex?.name === "idx_blower_history_assets_active_slot" &&
      canonicalTagIndex?.name === "idx_blower_history_assets_canonical_tag"
    ) {
      return;
    }
  } catch (error) {
    // 최초 설치처럼 base table 자체가 없으면 아래 full ensure로 이동한다.
  }

  await ensureSchema(database);
}

function typeExists(type) {
  return TYPE_DEFINITIONS.some(item => item.key === type);
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeDateTime(value) {
  const text = normalizeText(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T00:00:00+09:00`;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) {
    const kstParsed = new Date(`${text}+09:00`);
    return Number.isNaN(kstParsed.getTime()) ? "" : kstParsed.toISOString();
  }

  const parsed = new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString();
}

function formatKstDate(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
}

function addIsoCalendarDays(dateText, dayCount) {
  const date = new Date(`${normalizeText(dateText).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(dayCount || 0));
  return date.toISOString().slice(0, 10);
}

function detectionDateTime(row) {
  let workDate = normalizeText(row?.work_date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return "";

  const time = normalizeCanonicalEntryTime(row?.sourceTime) ||
    normalizeCanonicalEntryTime(row?.sourceText);
  if (!time) return normalizeDateTime(workDate);

  const hour = Number(time.slice(0, 2));
  if (normalizeShiftKey(row?.shift) === "NS" && hour >= 0 && hour < 7) {
    workDate = addIsoCalendarDays(workDate, 1);
  }

  return normalizeDateTime(`${workDate}T${time}:00+09:00`);
}

function currentRuntimeHours(asset, now = new Date()) {
  let hours = Math.max(0, Number(asset.runtime_hours || 0));

  if (Number(asset.is_running) === 1 && asset.runtime_anchor_at) {
    const anchor = new Date(asset.runtime_anchor_at);

    if (!Number.isNaN(anchor.getTime()) && anchor <= now) {
      hours += (now.getTime() - anchor.getTime()) / 3600000;
    }
  }

  return Math.max(0, hours);
}

function runtimeHoursAt(asset, eventDate) {
  const at = new Date(eventDate);

  if (Number.isNaN(at.getTime())) {
    return currentRuntimeHours(asset);
  }

  let hours = Math.max(0, Number(asset.runtime_hours || 0));

  if (Number(asset.is_running) === 1 && asset.runtime_anchor_at) {
    const anchor = new Date(asset.runtime_anchor_at);

    if (!Number.isNaN(anchor.getTime()) && anchor <= at) {
      hours += (at.getTime() - anchor.getTime()) / 3600000;
    }
  }

  return Math.max(0, hours);
}

function cycleElapsedHoursSince(lastReplacementAt, now = new Date()) {
  const replacementText = normalizeText(lastReplacementAt);
  if (!replacementText) return null;

  const replacementAt = new Date(replacementText);
  const currentAt = now instanceof Date ? now : new Date(now);

  if (Number.isNaN(replacementAt.getTime()) || Number.isNaN(currentAt.getTime())) {
    return null;
  }

  return Math.max(0, (currentAt.getTime() - replacementAt.getTime()) / 3600000);
}

async function initializeCycleRuntimeTracking(database) {
  const uninitializedResult = await database
    .prepare(`
      SELECT *
      FROM blower_history_assets
      WHERE cycle_runtime_hours IS NULL
      ORDER BY tag_number
    `)
    .all();
  const assets = Array.isArray(uninitializedResult.results) ? uninitializedResult.results : [];

  if (assets.length === 0) return;

  const correctionResult = await database
    .prepare(`
      SELECT tag_number, action_type, event_date, created_at
      FROM blower_history_events
      WHERE event_type = 'runtime_correction'
        AND source_type = 'manual'
      ORDER BY event_date DESC, created_at DESC
    `)
    .all();
  const corrections = Array.isArray(correctionResult.results) ? correctionResult.results : [];
  const baselineNow = new Date();
  const baselineAt = baselineNow.toISOString();
  const statements = assets.map(asset => {
    const cycleStartState = normalizeText(asset.cycle_start_state) || "legacy";
    const lastReplacementAt = normalizeText(asset.last_replacement_at);
    const effectiveStartAt = cycleStartState === "started"
      ? (normalizeText(asset.cycle_started_at) || lastReplacementAt)
      : lastReplacementAt;
    const cycleActive = Boolean(effectiveStartAt) && cycleStartState !== "pending";
    const elapsedHours = cycleActive
      ? (cycleElapsedHoursSince(effectiveStartAt, baselineNow) || 0)
      : 0;
    const startValue = new Date(effectiveStartAt);
    const latestCorrection = cycleActive
      ? corrections.find(correction => {
        if (normalizeText(correction.tag_number) !== normalizeText(asset.tag_number)) return false;
        const correctionAt = new Date(correction.event_date);
        return !Number.isNaN(correctionAt.getTime()) && (
          Number.isNaN(startValue.getTime()) || correctionAt >= startValue
        );
      })
      : null;
    const correctedStopped = /(?:정지|stop)/i.test(normalizeText(latestCorrection?.action_type));
    const operationState = cycleActive
      ? (latestCorrection && correctedStopped ? "stopped" : "running")
      : "stopped";

    return database
      .prepare(`
        UPDATE blower_history_assets
        SET
          cycle_runtime_hours = ?,
          cycle_runtime_anchor_at = ?,
          cycle_runtime_state = ?,
          cycle_runtime_revision = ?
        WHERE tag_number = ?
          AND cycle_runtime_hours IS NULL
      `)
      .bind(
        elapsedHours,
        baselineAt,
        operationState,
        crypto.randomUUID(),
        asset.tag_number
      );
  });

  await database.batch(statements);
}

function cycleRuntimeHoursAt(asset, eventDate) {
  const at = eventDate instanceof Date ? eventDate : new Date(eventDate);

  if (Number.isNaN(at.getTime())) return null;

  const storedHours = Number(asset.cycle_runtime_hours);
  if (!Number.isFinite(storedHours)) return null;

  let hours = Math.max(0, storedHours);
  const operationState = normalizeText(asset.cycle_runtime_state);
  const anchorAt = new Date(asset.cycle_runtime_anchor_at);

  if (
    operationState === "running" &&
    !Number.isNaN(anchorAt.getTime()) &&
    anchorAt <= at
  ) {
    hours += (at.getTime() - anchorAt.getTime()) / 3600000;
  }

  return Math.max(0, hours);
}

function eventRuntimeHoursAt(asset, eventDate) {
  const cycleHours = cycleRuntimeHoursAt(asset, eventDate);
  return normalizeText(asset.last_replacement_at) && Number.isFinite(cycleHours)
    ? cycleHours
    : runtimeHoursAt(asset, eventDate);
}

function buildAssetState(asset, setting, latestProblem, latestReference, now = new Date()) {
  const runtimeHours = currentRuntimeHours(asset, now);
  const cycleStartState = normalizeText(asset.cycle_start_state) || "legacy";
  const hasConfirmedReplacement = Boolean(normalizeText(asset.last_replacement_at));
  const cycleStartedAt = cycleStartState === "started"
    ? normalizeText(asset.cycle_started_at)
    : (cycleStartState === "pending" ? "" : normalizeText(asset.last_replacement_at));
  const cycleRuntimeTracked = (
    hasConfirmedReplacement &&
    asset.cycle_runtime_hours !== null &&
    asset.cycle_runtime_hours !== undefined &&
    asset.cycle_runtime_hours !== "" &&
    Number.isFinite(Number(asset.cycle_runtime_hours))
  );
  const cycleRuntimeState = normalizeText(asset.cycle_runtime_state) || "stopped";
  const cycleElapsedHours = !hasConfirmedReplacement || cycleStartState === "pending"
    ? null
    : (cycleRuntimeTracked
      ? cycleRuntimeHoursAt(asset, now)
      : cycleElapsedHoursSince(cycleStartedAt, now));
  const cycleDays = toNullableNumber(setting?.cycleDays ?? setting?.cycle_days);
  const warningDays = toNullableNumber(setting?.warningDays ?? setting?.warning_days);
  const criticalDays = toNullableNumber(setting?.criticalDays ?? setting?.critical_days);

  let severity = "normal";
  let remainingHours = null;
  let progressPct = null;
  let referenceElapsedHours = null;

  if (latestReference?.referenceDate) {
    const referenceAt = new Date(latestReference.referenceDate);
    if (!Number.isNaN(referenceAt.getTime()) && referenceAt <= now) {
      referenceElapsedHours = Math.max(0, (now.getTime() - referenceAt.getTime()) / 3600000);
    }
  }

  if (normalizeText(asset.last_replacement_at) && cycleStartState === "pending") {
    severity = "startup_pending";
  } else if (cycleElapsedHours === null) {
    severity = latestReference ? "reference" : "uninitialized";
  } else if (!(cycleDays > 0)) {
    severity = "unset";
  } else {
    const cycleHours = cycleDays * 24;
    remainingHours = cycleHours - cycleElapsedHours;
    progressPct = Math.max(0, Math.min(100, (cycleElapsedHours / cycleHours) * 100));

    if (remainingHours <= 0) {
      severity = "overdue";
    } else if (
      criticalDays !== null &&
      criticalDays >= 0 &&
      remainingHours <= criticalDays * 24
    ) {
      severity = "critical";
    } else if (
      warningDays !== null &&
      warningDays >= 0 &&
      remainingHours <= warningDays * 24
    ) {
      severity = "warning";
    }
  }

  return {
    tagNumber: asset.tag_number,
    blowerType: asset.blower_type,
    unitNo: asset.unit_no,
    assetGroup: normalizeText(asset.asset_group),
    positionLabel: asset.position_label,
    displayName: asset.display_name,
    sortOrder: Number(asset.sort_order || 0),
    lastReplacementAt: normalizeText(asset.last_replacement_at),
    cycleStartedAt,
    cycleStartState,
    cycleStartRevision: normalizeText(asset.cycle_start_revision),
    cycleRuntimeTracked,
    cycleRuntimeState,
    cycleRuntimeAnchorAt: normalizeText(asset.cycle_runtime_anchor_at),
    cycleRuntimeRevision: normalizeText(asset.cycle_runtime_revision),
    runtimeHours,
    isRunning: cycleRuntimeTracked
      ? cycleRuntimeState === "running"
      : Number(asset.is_running) === 1,
    cycleElapsedHours,
    remainingHours,
    progressPct,
    severity,
    latestProblem: latestProblem || null,
    latestReference: latestReference || null,
    referenceElapsedHours
  };
}

function assetCatalogItem(row) {
  return {
    tagNumber: normalizeText(row.tag_number),
    blowerType: normalizeText(row.blower_type),
    unitNo: normalizeText(row.unit_no),
    assetGroup: normalizeText(row.asset_group),
    positionLabel: normalizeText(row.position_label),
    displayName: normalizeText(row.display_name),
    sortOrder: Number(row.sort_order || 0),
    enabled: Number(row.enabled) === 1,
    lastModifiedById: normalizeText(row.last_modified_by_id),
    lastModifiedByName: normalizeText(row.last_modified_by_name),
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at)
  };
}

async function loadAssetCatalog(database) {
  const result = await database
    .prepare(`
      SELECT *
      FROM blower_history_assets
      ORDER BY enabled DESC, blower_type ASC, sort_order ASC, tag_number ASC
    `)
    .all();

  return (Array.isArray(result.results) ? result.results : []).map(assetCatalogItem);
}

async function loadSettings(database) {
  const result = await database
    .prepare(`
      SELECT *
      FROM blower_history_settings
      ORDER BY blower_type ASC
    `)
    .all();

  const rows = Array.isArray(result.results) ? result.results : [];
  const settings = {};

  for (const row of rows) {
    settings[row.blower_type] = {
      blowerType: row.blower_type,
      cycleDays: toNullableNumber(row.cycle_days),
      warningDays: toNullableNumber(row.warning_days),
      criticalDays: toNullableNumber(row.critical_days),
      updatedById: normalizeText(row.updated_by_id),
      updatedByName: normalizeText(row.updated_by_name),
      updatedAt: normalizeText(row.updated_at)
    };
  }

  return settings;
}

async function loadEvents(database, limit = 300) {
  const safeLimit = Math.max(1, Math.min(10000, Number(limit) || 300));

  const result = await database
    .prepare(`
      SELECT
        event.*,
        asset.blower_type,
        asset.unit_no,
        asset.position_label,
        asset.display_name
      FROM blower_history_events AS event
      INNER JOIN blower_history_assets AS asset
        ON asset.tag_number = event.tag_number
      ORDER BY event.event_date DESC, event.created_at DESC
      LIMIT ?
    `)
    .bind(safeLimit)
    .all();

  return (Array.isArray(result.results) ? result.results : []).map(row => ({
    id: row.id,
    tagNumber: row.tag_number,
    blowerType: row.blower_type,
    unitNo: row.unit_no,
    positionLabel: row.position_label,
    displayName: row.display_name,
    eventType: row.event_type,
    eventDate: row.event_date,
    runtimeHours: Number(row.runtime_hours || 0),
    issueType: normalizeText(row.issue_type),
    actionType: normalizeText(row.action_type),
    note: normalizeText(row.note),
    sourceType: normalizeText(row.source_type),
    sourceLogId: normalizeText(row.source_log_id),
    sourceText: normalizeText(row.source_text),
    createdById: normalizeText(row.created_by_id),
    createdByName: normalizeText(row.created_by_name),
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at)
  }));
}

async function loadCandidates(database, status = "pending", limit = 200) {
  const safeStatus = ["pending", "confirmed", "excluded", "auto_confirmed"].includes(status)
    ? status
    : "pending";
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));

  const result = await database
    .prepare(`
      SELECT
        candidate.*,
        asset.blower_type,
        asset.unit_no,
        asset.position_label,
        asset.display_name
      FROM blower_history_candidates AS candidate
      INNER JOIN blower_history_assets AS asset
        ON asset.tag_number = candidate.tag_number
      WHERE candidate.status = ?
      ORDER BY candidate.detected_date DESC, candidate.created_at DESC
      LIMIT ?
    `)
    .bind(safeStatus, safeLimit)
    .all();

  return (Array.isArray(result.results) ? result.results : []).map(row => ({
    id: row.id,
    tagNumber: row.tag_number,
    blowerType: row.blower_type,
    unitNo: row.unit_no,
    positionLabel: row.position_label,
    displayName: row.display_name,
    detectedType: row.detected_type,
    detectedDate: row.detected_date,
    issueType: normalizeText(row.issue_type),
    actionType: normalizeText(row.action_type),
    sourceLogId: normalizeText(row.source_log_id),
    sourceShift: normalizeText(row.source_shift),
    sourceRole: normalizeText(row.source_role),
    sourceAuthor: normalizeText(row.source_author),
    sourceText: normalizeText(row.source_text),
    status: row.status,
    reviewedById: normalizeText(row.reviewed_by_id),
    reviewedByName: normalizeText(row.reviewed_by_name),
    reviewedAt: normalizeText(row.reviewed_at),
    createdAt: normalizeText(row.created_at)
  }));
}

async function loadBackfillState(database) {
  const row = await database
    .prepare(`
      SELECT *
      FROM blower_history_backfill_state
      WHERE id = ?
      LIMIT 1
    `)
    .bind(HISTORY_BACKFILL_ID)
    .first();

  const today = formatKstDate(new Date());

  if (!row) {
    return {
      id: HISTORY_BACKFILL_ID,
      targetDate: today,
      cursorDate: "",
      cursorId: "",
      status: "pending",
      scannedLogs: 0,
      autoConfirmedEvents: 0,
      pendingCandidates: 0,
      startedAt: "",
      completedAt: "",
      updatedAt: "",
      isCompleteForToday: false,
      hasRun: false,
      requiresInitialRebuild: true,
      requiresCatchUp: false
    };
  }

  const targetDate = normalizeText(row.target_date);
  const status = normalizeText(row.status) || "idle";
  const isCompleteForToday = status === "complete" && targetDate === today;

  return {
    id: row.id,
    targetDate,
    cursorDate: normalizeText(row.cursor_date),
    cursorId: normalizeText(row.cursor_id),
    status,
    scannedLogs: Number(row.scanned_logs || 0),
    autoConfirmedEvents: Number(row.auto_confirmed_events || 0),
    pendingCandidates: Number(row.pending_candidates || 0),
    startedAt: normalizeText(row.started_at),
    completedAt: normalizeText(row.completed_at),
    updatedAt: normalizeText(row.updated_at),
    isCompleteForToday,
    hasRun: true,
    requiresInitialRebuild: false,
    requiresCatchUp: status === "complete" && targetDate !== today
  };
}

function defaultRecoveryV12StateForUi() {
  return {
    id: HISTORY_RECOVERY_V12_ID,
    version: HISTORY_RECOVERY_V12_VERSION,
    status: "pending",
    sourceTable: "shift_logs",
    cursorRowId: 0,
    scannedRows: 0,
    stagedEvents: 0,
    reviewRecords: 0,
    unmatchedRecords: 0,
    expectedEvents: HISTORY_RECOVERY_V12_EXPECTED_EVENTS,
    startedAt: "",
    completedAt: "",
    message: "",
    updatedAt: "",
    hasRun: false
  };
}

async function loadRecoveryV12StateForUi(database) {
  try {
    await ensureHistoryRecoveryV12Ready(database);
    const state = await v12LoadState(database);
    if (!state) return defaultRecoveryV12StateForUi();
    return { ...state, hasRun: true };
  } catch (error) {
    // V13 문맥복구 테이블은 최초 실행 전에는 아직 없을 수 있습니다.
    // 화면 조회 자체가 실패하지 않도록 '미실행' 상태로만 표시합니다.
    return defaultRecoveryV12StateForUi();
  }
}

async function loadSettingHistory(database, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const result = await database
    .prepare(`
      SELECT *
      FROM blower_history_setting_history
      ORDER BY changed_at DESC
      LIMIT ?
    `)
    .bind(safeLimit)
    .all();

  return (Array.isArray(result.results) ? result.results : []).map(row => ({
    id: row.id,
    blowerType: row.blower_type,
    oldCycleDays: toNullableNumber(row.old_cycle_days),
    newCycleDays: toNullableNumber(row.new_cycle_days),
    oldWarningDays: toNullableNumber(row.old_warning_days),
    newWarningDays: toNullableNumber(row.new_warning_days),
    oldCriticalDays: toNullableNumber(row.old_critical_days),
    newCriticalDays: toNullableNumber(row.new_critical_days),
    changedById: normalizeText(row.changed_by_id),
    changedByName: normalizeText(row.changed_by_name),
    changedAt: normalizeText(row.changed_at)
  }));
}

async function loadAssetStates(database, settings) {
  const assetResult = await database
    .prepare(`
      SELECT *
      FROM blower_history_assets
      WHERE enabled = 1
      ORDER BY sort_order ASC, tag_number ASC
    `)
    .all();

  const assets = Array.isArray(assetResult.results) ? assetResult.results : [];

  const problemResult = await database
    .prepare(`
      SELECT *
      FROM blower_history_events
      WHERE event_type = 'problem'
      ORDER BY event_date DESC, created_at DESC
    `)
    .all();

  const problemRows = Array.isArray(problemResult.results) ? problemResult.results : [];

  const referenceResult = await database
    .prepare(`
      SELECT *
      FROM blower_history_references
      ORDER BY reference_date DESC, updated_at DESC
    `)
    .all();

  const referenceRows = Array.isArray(referenceResult.results) ? referenceResult.results : [];
  const now = new Date();

  return assets.map(asset => {
    const replacementAt = asset.last_replacement_at ? new Date(asset.last_replacement_at) : null;
    const latestProblemRow = problemRows.find(row => {
      if (row.tag_number !== asset.tag_number) return false;
      if (!replacementAt || Number.isNaN(replacementAt.getTime())) return true;

      const problemAt = new Date(row.event_date);
      return !Number.isNaN(problemAt.getTime()) && problemAt >= replacementAt;
    });

    const latestProblem = latestProblemRow
      ? {
          id: latestProblemRow.id,
          eventDate: latestProblemRow.event_date,
          issueType: normalizeText(latestProblemRow.issue_type),
          actionType: normalizeText(latestProblemRow.action_type),
          note: normalizeText(latestProblemRow.note)
        }
      : null;

    const latestReferenceRow = referenceRows.find(row => row.tag_number === asset.tag_number);
    const latestReference = latestReferenceRow
      ? {
          referenceDate: normalizeText(latestReferenceRow.reference_date),
          sourceLogId: normalizeText(latestReferenceRow.source_log_id),
          sourceText: normalizeText(latestReferenceRow.source_text),
          referenceKind: normalizeText(latestReferenceRow.reference_kind) || "mention"
        }
      : null;

    return buildAssetState(
      asset,
      settings[asset.blower_type],
      latestProblem,
      latestReference,
      now
    );
  });
}

function buildMissingTagSummary(assetStates) {
  const counts = new Map();

  for (const asset of assetStates) {
    if (asset.assetGroup) continue;
    const key = `${asset.blowerType}::${asset.unitNo}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const missing = [];

  for (const type of TYPE_DEFINITIONS) {
    for (const [unitNo, expectedCount] of Object.entries(type.expected || {})) {
      const actualCount = counts.get(`${type.key}::${unitNo}`) || 0;

      if (actualCount < expectedCount) {
        missing.push({
          blowerType: type.key,
          unitNo,
          expectedCount,
          registeredCount: actualCount,
          missingCount: expectedCount - actualCount
        });
      }
    }
  }

  for (const slot of PENDING_ASSET_SLOTS) {
    const resolved = assetStates.some(asset => (
      asset.blowerType === slot.blowerType &&
      asset.assetGroup === slot.groupKey
    ));
    if (resolved) continue;

    missing.push({
      blowerType: slot.blowerType,
      groupKey: slot.groupKey,
      groupLabel: slot.groupLabel,
      expectedCount: 1,
      registeredCount: 0,
      missingCount: 1,
      identityPending: true
    });
  }

  return missing;
}

function expectedPositions(expectedCount) {
  if (Number(expectedCount) >= 3) return ["#A", "#B", "#C"];
  if (Number(expectedCount) === 2) return ["#A", "#B"];
  return ["#A"].slice(0, Math.max(0, Number(expectedCount) || 0));
}

function buildMissingSlotDetails(assetStates) {
  const registered = new Map();

  for (const asset of assetStates) {
    if (asset.assetGroup) continue;
    const key = `${asset.blowerType}::${asset.unitNo}`;
    if (!registered.has(key)) registered.set(key, new Set());
    registered.get(key).add(asset.positionLabel);
  }

  const missingSlots = [];

  for (const type of TYPE_DEFINITIONS) {
    for (const [unitNo, expectedCount] of Object.entries(type.expected || {})) {
      const key = `${type.key}::${unitNo}`;
      const positions = registered.get(key) || new Set();

      for (const positionLabel of expectedPositions(expectedCount)) {
        if (!positions.has(positionLabel)) {
          missingSlots.push({
            blowerType: type.key,
            unitNo,
            positionLabel,
            displayName: `${unitNo === "shared" ? "공용" : `#${unitNo}`} ${type.label} ${positionLabel}`
          });
        }
      }
    }
  }

  for (const slot of PENDING_ASSET_SLOTS) {
    const resolved = assetStates.some(asset => (
      asset.blowerType === slot.blowerType &&
      asset.assetGroup === slot.groupKey
    ));
    if (!resolved) missingSlots.push({ ...slot });
  }

  return missingSlots;
}

async function buildFullData(database, user) {
  const authenticated = Boolean(user);
  const settings = await loadSettings(database);
  const assets = await loadAssetStates(database, settings);
  const responseAssets = authenticated
    ? assets
    : sanitizeAssetsForAnonymous(assets);
  const events = await loadEvents(database, 10000);
  const candidates = authenticated
    ? await loadCandidates(database, "pending", 300)
    : [];
  const settingHistory = authenticated
    ? await loadSettingHistory(database, 60)
    : [];
  const backfill = await loadBackfillState(database);
  const recoveryV12 = authenticated
    ? await loadRecoveryV12StateForUi(database)
    : null;

  return {
    ok: true,
    user: user || null,
    permissions: buildPermissions(user),
    types: TYPE_DEFINITIONS,
    settings: authenticated
      ? settings
      : sanitizeSettingsForAnonymous(settings),
    assets: responseAssets,
    assetCatalog: user?.isSuperAdmin ? await loadAssetCatalog(database) : [],
    events: authenticated
      ? events
      : sanitizeEventsForAnonymous(events),
    candidates,
    settingHistory,
    backfill: authenticated
      ? backfill
      : sanitizeBackfillForAnonymous(backfill),
    recoveryV12,
    missingTags: buildMissingTagSummary(responseAssets),
    missingSlots: buildMissingSlotDetails(responseAssets),
    generatedAt: new Date().toISOString()
  };
}

function buildSummaryFromAssets(assets) {
  const severityRank = {
    overdue: 4,
    critical: 3,
    warning: 2,
    unset: 1,
    startup_pending: 1,
    reference: 1,
    uninitialized: 1,
    normal: 0
  };

  const alerts = assets
    .filter(asset => ["overdue", "critical", "warning"].includes(asset.severity))
    .sort((a, b) => {
      const rankDiff = severityRank[b.severity] - severityRank[a.severity];
      if (rankDiff !== 0) return rankDiff;
      return Number(a.remainingHours ?? 1e12) - Number(b.remainingHours ?? 1e12);
    });

  const counts = {
    normal: 0,
    warning: 0,
    critical: 0,
    overdue: 0,
    unset: 0,
    startup_pending: 0,
    reference: 0,
    uninitialized: 0
  };

  for (const asset of assets) {
    if (Object.prototype.hasOwnProperty.call(counts, asset.severity)) {
      counts[asset.severity] += 1;
    }
  }

  return {
    counts,
    alertCount: alerts.length,
    strongestSeverity: alerts[0]?.severity || "normal",
    alerts: alerts.slice(0, 12)
  };
}


/* [FBHE-OPERATIONS-CONTROL-V1] */
/* =========================================================
  [FBHE-VIBRATION-SHADOW-V1]
  FBHE Blower 진동 Shadow 판정

  판정 원칙:
  - 4개 센서의 절대값 단위를 임의로 가정하지 않는다.
  - 하루 자료에서 저진동/고진동 군집이 뚜렷할 때만 상태 후보를 만든다.
  - 급락·급상승은 Blower와 Motor가 함께 변할 때만 기동·정지 후보로 본다.
  - Motor 진동은 유지되고 Blower 진동만 급락하면 동력전달 이상 후보로 분리한다.
  - 결과는 읽기 전용 Shadow이며 실제 상태·누적시간을 변경하지 않는다.
========================================================= */

function isValidFbheVibrationDate(value) {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00+09:00`);
  return !Number.isNaN(parsed.getTime()) && formatKstDate(parsed) === text;
}


/* [FBHE-OIS-RUNTIME-ANALYSIS-V2] */
function addFbheVibrationDateDays(value, days) {
  if (!isValidFbheVibrationDate(value)) return "";
  const parsed = new Date(`${value}T00:00:00+09:00`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return formatKstDate(parsed);
}

function countFbheVibrationRangeDays(startDate, endDate) {
  if (!isValidFbheVibrationDate(startDate) || !isValidFbheVibrationDate(endDate)) return 0;
  const start = new Date(`${startDate}T00:00:00+09:00`).getTime();
  const end = new Date(`${endDate}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

function buildFbheVibrationRangeChunks(startDate, endDate) {
  const dayCount = countFbheVibrationRangeDays(startDate, endDate);
  if (dayCount < 1 || dayCount > FBHE_VIBRATION_RANGE_MAX_DAYS) return [];

  const chunks = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const candidateEnd = addFbheVibrationDateDays(cursor, FBHE_VIBRATION_RANGE_CHUNK_DAYS - 1);
    const chunkEnd = candidateEnd && candidateEnd < endDate ? candidateEnd : endDate;
    chunks.push({
      startDate: cursor,
      endDate: chunkEnd,
      targetDate: `${cursor}~${chunkEnd}`,
      dayCount: countFbheVibrationRangeDays(cursor, chunkEnd)
    });
    cursor = addFbheVibrationDateDays(chunkEnd, 1);
  }
  return chunks;
}

function parseFbheVibrationRangeKey(value) {
  const text = normalizeText(value);
  const matched = /^(\d{4}-\d{2}-\d{2})(?:~(\d{4}-\d{2}-\d{2}))?$/.exec(text);
  if (!matched) return null;
  const startDate = matched[1];
  const endDate = matched[2] || matched[1];
  const dayCount = countFbheVibrationRangeDays(startDate, endDate);
  if (dayCount < 1 || dayCount > FBHE_VIBRATION_RANGE_MAX_DAYS) return null;
  return { key: text, startDate, endDate, dayCount };
}

function fbheVibrationRangeBounds(startDate, endDate, now = new Date()) {
  const startAt = new Date(`${startDate}T00:00:00+09:00`);
  const endExclusive = new Date(`${addFbheVibrationDateDays(endDate, 1)}T00:00:00+09:00`);
  const safeEnd = endExclusive > now ? now : endExclusive;
  return {
    startAt,
    endAt: safeEnd,
    startAtText: startAt.toISOString(),
    endAtText: safeEnd.toISOString()
  };
}

function parseFbheVibrationJson(value) {
  const text = normalizeText(value);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function finiteFbheVibrationNumber(value) {
  if (value === null || value === undefined || normalizeText(value) === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.abs(numberValue) : null;
}

function medianFbheVibration(values) {
  const numbers = (values || [])
    .map(finiteFbheVibrationNumber)
    .filter(value => value !== null)
    .sort((left, right) => left - right);

  if (numbers.length === 0) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 1
    ? numbers[middle]
    : (numbers[middle - 1] + numbers[middle]) / 2;
}

function roundFbheVibration(value, digits = 4) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  const factor = 10 ** Math.max(0, Number(digits) || 0);
  return Math.round(numberValue * factor) / factor;
}

function normalizeFbheVibrationSensor(sensor) {
  const role = normalizeText(sensor?.role).toLowerCase();
  if (!FBHE_VIBRATION_SENSOR_ROLES.includes(role)) return null;

  const samples = (Array.isArray(sensor?.samples) ? sensor.samples : [])
    .map(sample => {
      const sampledAt = normalizeDateTime(sample?.sampledAt || sample?.sampled_at);
      const value = finiteFbheVibrationNumber(sample?.value);
      if (!sampledAt || value === null) return null;
      return {
        sampledAt,
        value
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sampledAt.localeCompare(right.sampledAt));

  return {
    role,
    label: normalizeText(sensor?.label) || role,
    tag: normalizeText(sensor?.tag),
    itemName: normalizeText(sensor?.itemName || sensor?.item_name),
    unit: normalizeText(sensor?.unit),
    samples,
    sampleCount: samples.length,
    error: normalizeText(sensor?.error)
  };
}

function buildFbheVibrationHourlyPoints(rawAsset) {
  const sensors = (Array.isArray(rawAsset?.sensors) ? rawAsset.sensors : [])
    .map(normalizeFbheVibrationSensor)
    .filter(Boolean);
  const sensorByRole = new Map(sensors.map(sensor => [sensor.role, sensor]));
  const sampledAtSet = new Set();

  for (const sensor of sensors) {
    for (const sample of sensor.samples) sampledAtSet.add(sample.sampledAt);
  }

  const sampleMaps = new Map(
    sensors.map(sensor => [
      sensor.role,
      new Map(sensor.samples.map(sample => [sample.sampledAt, sample.value]))
    ])
  );

  const points = [...sampledAtSet]
    .sort()
    .map(sampledAt => {
      const values = Object.fromEntries(
        FBHE_VIBRATION_SENSOR_ROLES.map(role => [
          role,
          sampleMaps.get(role)?.get(sampledAt) ?? null
        ])
      );
      const blowerValues = [values.blower_de, values.blower_nde]
        .filter(value => value !== null);
      const motorValues = [values.motor_de, values.motor_nde]
        .filter(value => value !== null);
      const allValues = [...blowerValues, ...motorValues];
      const blowerIndex = medianFbheVibration(blowerValues);
      const motorIndex = medianFbheVibration(motorValues);
      const combinedIndex = blowerIndex !== null && motorIndex !== null
        ? Math.sqrt(Math.max(0, blowerIndex * motorIndex))
        : medianFbheVibration(allValues);

      return {
        sampledAt,
        values,
        validSensorCount: allValues.length,
        blowerValidCount: blowerValues.length,
        motorValidCount: motorValues.length,
        blowerIndex,
        motorIndex,
        combinedIndex
      };
    });

  return {
    sensors,
    sensorByRole,
    points
  };
}

function findFbheVibrationCluster(points) {
  const values = (points || [])
    .map(point => finiteFbheVibrationNumber(point?.combinedIndex))
    .filter(value => value !== null)
    .sort((left, right) => left - right);

  if (values.length < 8) return null;

  let best = null;
  const minimumClusterCount = Math.max(3, Math.floor(values.length * 0.2));

  for (
    let lowerEnd = minimumClusterCount - 1;
    lowerEnd <= values.length - minimumClusterCount - 1;
    lowerEnd += 1
  ) {
    const lowerEdge = values[lowerEnd];
    const upperEdge = values[lowerEnd + 1];
    const lowerValues = values.slice(0, lowerEnd + 1);
    const upperValues = values.slice(lowerEnd + 1);
    const lowerMedian = medianFbheVibration(lowerValues);
    const upperMedian = medianFbheVibration(upperValues);
    const edgeRatio = lowerEdge <= 1e-9
      ? (upperEdge > 1e-9 ? Number.POSITIVE_INFINITY : 1)
      : upperEdge / lowerEdge;
    const separationRatio = (lowerMedian ?? 0) <= 1e-9
      ? ((upperMedian ?? 0) > 1e-9 ? Number.POSITIVE_INFINITY : 1)
      : (upperMedian ?? 0) / lowerMedian;

    if (edgeRatio < 1.8 || separationRatio < 2.5) continue;

    const balance = Math.min(lowerValues.length, upperValues.length)
      / Math.max(lowerValues.length, upperValues.length);
    const finiteEdgeRatio = Number.isFinite(edgeRatio) ? edgeRatio : 1000;
    const score = Math.log(finiteEdgeRatio) * balance;

    if (!best || score > best.score) {
      best = {
        threshold: lowerEdge <= 1e-9
          ? upperEdge * 0.25
          : Math.sqrt(lowerEdge * upperEdge),
        lowerMedian,
        upperMedian,
        edgeRatio,
        separationRatio,
        lowerCount: lowerValues.length,
        upperCount: upperValues.length,
        score
      };
    }
  }

  return best;
}

function midpointFbheVibrationTime(leftValue, rightValue) {
  const left = new Date(leftValue);
  const right = new Date(rightValue);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return "";
  return new Date((left.getTime() + right.getTime()) / 2).toISOString();
}

function absoluteFbheVibrationClass(point) {
  if (!point || point.blowerIndex === null || point.motorIndex === null) return "unknown";

  if (
    point.motorIndex >= FBHE_VIBRATION_ABSOLUTE_RUN_MIN &&
    point.blowerIndex <= FBHE_VIBRATION_ABSOLUTE_STOP_MAX
  ) {
    return "drive_anomaly";
  }

  if (
    point.blowerIndex >= FBHE_VIBRATION_ABSOLUTE_RUN_MIN &&
    point.motorIndex >= FBHE_VIBRATION_ABSOLUTE_RUN_MIN
  ) {
    return "high";
  }

  if (
    point.blowerIndex <= FBHE_VIBRATION_ABSOLUTE_STOP_MAX &&
    point.motorIndex <= FBHE_VIBRATION_ABSOLUTE_STOP_MAX
  ) {
    return "low";
  }

  return "unknown";
}

function classifyFbheVibrationPoint(point, cluster) {
  const absoluteClass = absoluteFbheVibrationClass(point);
  if (absoluteClass !== "unknown") return absoluteClass;

  if (!point || point.blowerIndex === null || point.motorIndex === null) return "unknown";

  if (
    cluster &&
    point.motorIndex > cluster.threshold &&
    point.blowerIndex <= cluster.threshold &&
    point.motorIndex >= Math.max(point.blowerIndex * 3, cluster.threshold)
  ) {
    return "drive_anomaly";
  }

  if (!cluster || point.combinedIndex === null) return "unknown";
  return point.combinedIndex <= cluster.threshold ? "low" : "high";
}


function fbheVibrationRuntimeState(point, cluster) {
  if (!point) return "unknown";
  const validValues = Object.values(point.values || {}).filter(value => value !== null && Number.isFinite(Number(value)));

  if (
    point.validSensorCount >= 3 &&
    validValues.length >= 3 &&
    validValues.every(value => Math.abs(Number(value)) <= 1e-9)
  ) {
    return "stopped";
  }

  const classified = classifyFbheVibrationPoint(point, cluster);
  if (classified === "high") return "running";
  if (classified === "low") return "stopped";
  if (classified === "drive_anomaly") return "anomaly";
  return "unknown";
}

function stabilizeFbheVibrationRuntimeStates(points, cluster) {
  const states = (points || []).map(point => fbheVibrationRuntimeState(point, cluster));
  const output = [...states];

  for (let index = 1; index < states.length - 1; index += 1) {
    const previous = states[index - 1];
    const current = states[index];
    const next = states[index + 1];
    const previousAt = new Date(points[index - 1]?.sampledAt || 0).getTime();
    const nextAt = new Date(points[index + 1]?.sampledAt || 0).getTime();
    const localSpan = nextAt - previousAt;

    if (!Number.isFinite(localSpan) || localSpan > 2 * FBHE_VIBRATION_RUNTIME_GAP_MS) continue;

    if (
      ["running", "stopped"].includes(previous) &&
      previous === next &&
      current !== previous &&
      current !== "anomaly"
    ) {
      output[index] = previous;
    }
  }

  return output;
}

function appendFbheVibrationRuntimeSegment(segments, state, startAt, endAt) {
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  const end = endAt instanceof Date ? endAt : new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return;

  const previous = segments.at(-1);
  if (previous && previous.state === state && previous.endAt === start.toISOString()) {
    previous.endAt = end.toISOString();
    previous.hours = roundFbheVibration((new Date(previous.endAt).getTime() - new Date(previous.startAt).getTime()) / 3600000, 3);
    return;
  }

  segments.push({
    state,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    hours: roundFbheVibration((end.getTime() - start.getTime()) / 3600000, 3)
  });
}

function buildFbheVibrationRuntimeAnalysis(points, cluster, startAtValue, endAtValue) {
  const startAt = startAtValue instanceof Date ? startAtValue : new Date(startAtValue);
  const endAt = endAtValue instanceof Date ? endAtValue : new Date(endAtValue);
  const safePoints = (points || [])
    .filter(point => {
      const time = new Date(point?.sampledAt || 0).getTime();
      return Number.isFinite(time) && time >= startAt.getTime() && time <= endAt.getTime();
    })
    .sort((left, right) => left.sampledAt.localeCompare(right.sampledAt));
  const segments = [];

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt || safePoints.length === 0) {
    return {
      segments,
      runningHours: 0,
      stoppedHours: 0,
      anomalyHours: 0,
      unknownHours: Math.max(0, Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) ? 0 : (endAt.getTime() - startAt.getTime()) / 3600000),
      classifiedHours: 0,
      totalHours: Math.max(0, Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) ? 0 : (endAt.getTime() - startAt.getTime()) / 3600000),
      coveragePct: 0,
      currentState: "unknown",
      lastStartAt: "",
      lastStopAt: "",
      transitions: []
    };
  }

  const states = stabilizeFbheVibrationRuntimeStates(safePoints, cluster);
  const pointTimes = safePoints.map(point => new Date(point.sampledAt));
  const firstTime = pointTimes[0];
  const firstState = states[0];
  const leadingGap = firstTime.getTime() - startAt.getTime();
  appendFbheVibrationRuntimeSegment(
    segments,
    leadingGap >= 0 && leadingGap <= FBHE_VIBRATION_RUNTIME_GAP_MS && ["running", "stopped", "anomaly"].includes(firstState)
      ? firstState
      : "unknown",
    startAt,
    firstTime
  );

  for (let index = 0; index < safePoints.length - 1; index += 1) {
    const leftTime = pointTimes[index];
    const rightTime = pointTimes[index + 1];
    const gapMs = rightTime.getTime() - leftTime.getTime();
    const leftState = states[index];
    const rightState = states[index + 1];

    if (!Number.isFinite(gapMs) || gapMs <= 0) continue;

    if (gapMs > FBHE_VIBRATION_RUNTIME_GAP_MS) {
      appendFbheVibrationRuntimeSegment(segments, "unknown", leftTime, rightTime);
      continue;
    }

    if (leftState === rightState && ["running", "stopped", "anomaly"].includes(leftState)) {
      appendFbheVibrationRuntimeSegment(segments, leftState, leftTime, rightTime);
      continue;
    }

    if (
      ["running", "stopped"].includes(leftState) &&
      ["running", "stopped"].includes(rightState)
    ) {
      const midpoint = new Date((leftTime.getTime() + rightTime.getTime()) / 2);
      appendFbheVibrationRuntimeSegment(segments, leftState, leftTime, midpoint);
      appendFbheVibrationRuntimeSegment(segments, rightState, midpoint, rightTime);
      continue;
    }

    if (leftState === "anomaly" || rightState === "anomaly") {
      appendFbheVibrationRuntimeSegment(segments, "anomaly", leftTime, rightTime);
      continue;
    }

    appendFbheVibrationRuntimeSegment(segments, "unknown", leftTime, rightTime);
  }

  const lastTime = pointTimes.at(-1);
  const lastState = states.at(-1);
  const trailingGap = endAt.getTime() - lastTime.getTime();
  appendFbheVibrationRuntimeSegment(
    segments,
    trailingGap >= 0 && trailingGap <= FBHE_VIBRATION_RUNTIME_GAP_MS && ["running", "stopped", "anomaly"].includes(lastState)
      ? lastState
      : "unknown",
    lastTime,
    endAt
  );

  const totals = {
    running: 0,
    stopped: 0,
    anomaly: 0,
    unknown: 0
  };
  for (const segment of segments) {
    totals[segment.state] = (totals[segment.state] || 0) + Number(segment.hours || 0);
  }

  const transitions = [];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (
      ["running", "stopped"].includes(previous.state) &&
      ["running", "stopped"].includes(current.state) &&
      previous.state !== current.state
    ) {
      transitions.push({
        type: current.state === "running" ? "start" : "stop",
        estimatedAt: current.startAt,
        method: "hourly_runtime_timeline",
        confidence: "high"
      });
    }
  }

  const totalHours = Math.max(0, (endAt.getTime() - startAt.getTime()) / 3600000);
  const classifiedHours = totals.running + totals.stopped;
  const latestSegment = segments.at(-1);
  const currentState = latestSegment && ["running", "stopped"].includes(latestSegment.state) && latestSegment.endAt === endAt.toISOString()
    ? latestSegment.state
    : "unknown";

  return {
    segments,
    runningHours: roundFbheVibration(totals.running, 3),
    stoppedHours: roundFbheVibration(totals.stopped, 3),
    anomalyHours: roundFbheVibration(totals.anomaly, 3),
    unknownHours: roundFbheVibration(totals.unknown, 3),
    classifiedHours: roundFbheVibration(classifiedHours, 3),
    totalHours: roundFbheVibration(totalHours, 3),
    coveragePct: totalHours > 0 ? roundFbheVibration((classifiedHours / totalHours) * 100, 1) : 0,
    currentState,
    lastStartAt: transitions.filter(item => item.type === "start").at(-1)?.estimatedAt || "",
    lastStopAt: transitions.filter(item => item.type === "stop").at(-1)?.estimatedAt || "",
    transitions
  };
}

function sumFbheVibrationSegmentHours(segments, state, startAtValue, endAtValue) {
  const startAt = startAtValue instanceof Date ? startAtValue : new Date(startAtValue);
  const endAt = endAtValue instanceof Date ? endAtValue : new Date(endAtValue);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) return 0;

  let total = 0;
  for (const segment of segments || []) {
    if (segment.state !== state) continue;
    const segmentStart = new Date(segment.startAt);
    const segmentEnd = new Date(segment.endAt);
    const clippedStart = segmentStart > startAt ? segmentStart : startAt;
    const clippedEnd = segmentEnd < endAt ? segmentEnd : endAt;
    if (clippedEnd > clippedStart) total += (clippedEnd.getTime() - clippedStart.getTime()) / 3600000;
  }
  return roundFbheVibration(total, 3);
}

function coverageFbheVibrationSegmentHours(segments, startAtValue, endAtValue) {
  return roundFbheVibration(
    sumFbheVibrationSegmentHours(segments, "running", startAtValue, endAtValue) +
    sumFbheVibrationSegmentHours(segments, "stopped", startAtValue, endAtValue),
    3
  );
}

function dedupeFbheVibrationTransitions(transitions) {
  const sorted = [...(transitions || [])]
    .filter(item => item?.type && item?.estimatedAt)
    .sort((left, right) => left.estimatedAt.localeCompare(right.estimatedAt));
  const output = [];

  for (const transition of sorted) {
    const previous = output.at(-1);
    const previousAt = new Date(previous?.estimatedAt || 0);
    const currentAt = new Date(transition.estimatedAt);
    const tooClose = previous && previous.type === transition.type &&
      !Number.isNaN(previousAt.getTime()) && !Number.isNaN(currentAt.getTime()) &&
      currentAt.getTime() - previousAt.getTime() <= 2 * 60 * 60 * 1000;

    if (!tooClose) {
      output.push(transition);
      continue;
    }

    if (transition.confidence === "high" && previous.confidence !== "high") {
      output[output.length - 1] = transition;
    }
  }

  return output;
}

function buildFbheVibrationTransitions(points, cluster) {
  const transitions = [];
  const classified = (points || []).map(point => classifyFbheVibrationPoint(point, cluster));

  if (cluster) {
    let stableState = "";
    let stableIndex = -1;

    for (let index = 0; index < classified.length; index += 1) {
      const currentState = classified[index];
      if (!["low", "high"].includes(currentState)) continue;

      if (!stableState) {
        stableState = currentState;
        stableIndex = index;
        continue;
      }

      if (currentState === stableState) {
        stableIndex = index;
        continue;
      }

      const nextState = classified[index + 1];
      if (nextState !== currentState) continue;

      const previousPoint = points[Math.max(0, stableIndex)];
      const currentPoint = points[index];
      const nextPoint = points[index + 1];
      const previousTime = new Date(previousPoint?.sampledAt || 0).getTime();
      const currentTime = new Date(currentPoint?.sampledAt || 0).getTime();
      const nextTime = new Date(nextPoint?.sampledAt || 0).getTime();
      const transitionGap = currentTime - previousTime;
      const confirmationGap = nextTime - currentTime;

      if (
        !Number.isFinite(transitionGap) ||
        !Number.isFinite(confirmationGap) ||
        transitionGap <= 0 ||
        confirmationGap <= 0 ||
        transitionGap > FBHE_VIBRATION_MAX_TRANSITION_GAP_MS ||
        confirmationGap > FBHE_VIBRATION_MAX_TRANSITION_GAP_MS
      ) {
        stableState = currentState;
        stableIndex = index;
        continue;
      }

      transitions.push({
        type: currentState === "low" ? "stop" : "start",
        confidence: "high",
        fromAt: previousPoint.sampledAt,
        toAt: currentPoint.sampledAt,
        estimatedAt: midpointFbheVibrationTime(previousPoint.sampledAt, currentPoint.sampledAt),
        blowerBefore: roundFbheVibration(previousPoint.blowerIndex),
        blowerAfter: roundFbheVibration(currentPoint.blowerIndex),
        motorBefore: roundFbheVibration(previousPoint.motorIndex),
        motorAfter: roundFbheVibration(currentPoint.motorIndex),
        method: "two_cluster"
      });

      stableState = currentState;
      stableIndex = index;
    }
  }

  for (let index = 1; index < points.length; index += 1) {
    const currentPoint = points[index];
    if (
      currentPoint.blowerIndex === null ||
      currentPoint.motorIndex === null
    ) {
      continue;
    }

    const currentTime = new Date(currentPoint.sampledAt).getTime();
    const previousWindow = points
      .slice(Math.max(0, index - 3), index)
      .filter(point => {
        if (point.blowerIndex === null || point.motorIndex === null) return false;
        const pointTime = new Date(point.sampledAt).getTime();
        const gapMs = currentTime - pointTime;
        return Number.isFinite(gapMs) && gapMs > 0 && gapMs <= 3 * FBHE_VIBRATION_MAX_TRANSITION_GAP_MS;
      });
    const previousPoint = previousWindow.at(-1) || null;
    const previousPointTime = new Date(previousPoint?.sampledAt || 0).getTime();

    if (
      !previousPoint ||
      !Number.isFinite(currentTime) ||
      !Number.isFinite(previousPointTime) ||
      currentTime - previousPointTime > FBHE_VIBRATION_MAX_TRANSITION_GAP_MS
    ) {
      continue;
    }

    const previousBlower = medianFbheVibration(previousWindow.map(point => point.blowerIndex));
    const previousMotor = medianFbheVibration(previousWindow.map(point => point.motorIndex));

    if (
      previousBlower === null ||
      previousMotor === null ||
      previousBlower <= 1e-9 ||
      previousMotor <= 1e-9
    ) {
      continue;
    }

    const blowerRatio = currentPoint.blowerIndex / previousBlower;
    const motorRatio = currentPoint.motorIndex / previousMotor;
    const common = {
      fromAt: previousPoint.sampledAt,
      toAt: currentPoint.sampledAt,
      estimatedAt: midpointFbheVibrationTime(previousPoint.sampledAt, currentPoint.sampledAt),
      blowerBefore: roundFbheVibration(previousBlower),
      blowerAfter: roundFbheVibration(currentPoint.blowerIndex),
      motorBefore: roundFbheVibration(previousMotor),
      motorAfter: roundFbheVibration(currentPoint.motorIndex),
      method: "relative_change"
    };

    if (
      blowerRatio <= 0.3 &&
      motorRatio >= 0.65 &&
      currentPoint.motorIndex >= Math.max(currentPoint.blowerIndex * 3, 1e-9)
    ) {
      transitions.push({
        ...common,
        type: "drive_anomaly",
        confidence: "high"
      });
      continue;
    }

    if (
      blowerRatio <= FBHE_VIBRATION_STOP_DROP_RATIO &&
      motorRatio <= FBHE_VIBRATION_STOP_DROP_RATIO &&
      Math.min(blowerRatio, motorRatio) <= 0.2
    ) {
      transitions.push({
        ...common,
        type: "stop",
        confidence: "medium"
      });
      continue;
    }

    if (
      blowerRatio >= FBHE_VIBRATION_START_RISE_RATIO &&
      motorRatio >= FBHE_VIBRATION_START_RISE_RATIO &&
      Math.max(blowerRatio, motorRatio) >= 4
    ) {
      transitions.push({
        ...common,
        type: "start",
        confidence: "medium"
      });
    }
  }

  return dedupeFbheVibrationTransitions(transitions);
}

function fbheVibrationOperationEventState(event) {
  const eventType = normalizeText(event?.event_type || event?.eventType);
  if (["startup", "operation_start"].includes(eventType)) return "running";
  if (["replacement", "operation_stop"].includes(eventType)) return "stopped";
  if (eventType === "runtime_correction") {
    const correctionText = [
      normalizeText(event?.action_type || event?.actionType),
      normalizeText(event?.note)
    ].filter(Boolean).join(" ");

    if (/(?:미기동|정지|stop|stopped)/i.test(correctionText)) return "stopped";
    if (/(?:운전중|재기동|기동|start|started|run|running)/i.test(correctionText)) return "running";
  }
  return "";
}

function matchFbheVibrationTransitionsToEvents(transitions, events) {
  const normalizedEvents = (events || [])
    .map(event => {
      const eventDate = normalizeDateTime(event?.event_date || event?.eventDate);
      const targetState = fbheVibrationOperationEventState(event);
      return eventDate && targetState
        ? {
            eventDate,
            targetState,
            eventType: normalizeText(event?.event_type || event?.eventType),
            sourceType: normalizeText(event?.source_type || event?.sourceType),
            createdAt: normalizeDateTime(event?.created_at || event?.createdAt),
            id: normalizeText(event?.id)
          }
        : null;
    })
    .filter(Boolean);

  return (transitions || []).map(transition => {
    if (!["start", "stop"].includes(transition.type)) {
      return {
        ...transition,
        manualMatch: "not_applicable",
        manualEvent: null
      };
    }

    const targetState = transition.type === "start" ? "running" : "stopped";
    const transitionAt = new Date(transition.estimatedAt);
    const nearest = normalizedEvents
      .map(event => ({
        ...event,
        distanceMs: Math.abs(new Date(event.eventDate).getTime() - transitionAt.getTime())
      }))
      .filter(event => Number.isFinite(event.distanceMs) && event.distanceMs <= FBHE_VIBRATION_MANUAL_MATCH_WINDOW_MS)
      .sort((left, right) => {
        const distanceOrder = left.distanceMs - right.distanceMs;
        if (distanceOrder !== 0) return distanceOrder;
        const targetOrder = Number(right.targetState === targetState) - Number(left.targetState === targetState);
        if (targetOrder !== 0) return targetOrder;
        const createdOrder = normalizeText(right.createdAt).localeCompare(normalizeText(left.createdAt));
        if (createdOrder !== 0) return createdOrder;
        return normalizeText(right.id).localeCompare(normalizeText(left.id));
      })[0] || null;

    return {
      ...transition,
      manualMatch: !nearest
        ? "unrecorded"
        : nearest.targetState === targetState
          ? "matched"
          : "conflict",
      manualEvent: nearest
        ? {
            eventDate: nearest.eventDate,
            targetState: nearest.targetState,
            eventType: nearest.eventType,
            sourceType: nearest.sourceType,
            distanceMinutes: Math.round(nearest.distanceMs / 60000)
          }
        : null
    };
  });
}

function manualFbheVibrationStateAt(events, sampledAt) {
  const targetTime = new Date(sampledAt);
  if (Number.isNaN(targetTime.getTime())) return "unknown";

  const latest = (events || [])
    .map(event => {
      const eventDate = normalizeDateTime(event?.event_date || event?.eventDate);
      const state = fbheVibrationOperationEventState(event);
      const parsed = new Date(eventDate);
      if (!eventDate || !state || Number.isNaN(parsed.getTime()) || parsed > targetTime) return null;

      const createdAt = normalizeDateTime(event?.created_at || event?.createdAt);
      const createdTime = new Date(createdAt).getTime();
      return {
        eventDate,
        state,
        time: parsed.getTime(),
        createdAt,
        createdTime: Number.isNaN(createdTime) ? 0 : createdTime,
        id: normalizeText(event?.id)
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.time !== right.time) return left.time - right.time;
      if (left.createdTime !== right.createdTime) return left.createdTime - right.createdTime;
      return left.id.localeCompare(right.id);
    })
    .at(-1) || null;

  return latest?.state || "unknown";
}

function latestStableFbheVibrationClass(points, cluster) {
  const safePoints = Array.isArray(points) ? points : [];
  const latestPoint = safePoints.at(-1) || null;
  const latestAbsoluteClass = absoluteFbheVibrationClass(latestPoint);

  // FBHE measured values show a wide stop/run separation. When the latest
  // Blower and Motor indices are both inside the conservative absolute band,
  // a single fresh hourly sample is enough for the current-state Shadow.
  if (["low", "high", "drive_anomaly"].includes(latestAbsoluteClass)) {
    return latestAbsoluteClass;
  }

  if (!cluster) return "unknown";

  const stableClasses = safePoints
    .map(point => classifyFbheVibrationPoint(point, cluster))
    .filter(value => ["low", "high", "drive_anomaly"].includes(value));

  const latest = stableClasses.at(-1) || "unknown";
  const previous = stableClasses.at(-2) || "unknown";

  return latest === previous && ["low", "high"].includes(latest)
    ? latest
    : latest === "drive_anomaly"
      ? "drive_anomaly"
      : "unknown";
}

function buildFbheVibrationAssetShadow(assetState, rawAsset, operationEvents = [], analysisRange = null) {
  const normalized = buildFbheVibrationHourlyPoints(rawAsset || {});
  const cluster = findFbheVibrationCluster(normalized.points);
  const rawTransitions = buildFbheVibrationTransitions(normalized.points, cluster);
  const transitions = matchFbheVibrationTransitionsToEvents(rawTransitions, operationEvents);
  const latestPoint = normalized.points.at(-1) || null;
  const latestClass = latestStableFbheVibrationClass(normalized.points, cluster);
  const latestTransition = transitions
    .filter(transition => ["start", "stop"].includes(transition.type))
    .at(-1) || null;

  let shadowState = "unknown";
  let shadowReason = "운전·정지 기준 분리가 충분하지 않습니다.";

  if (latestClass === "high") {
    shadowState = "running";
    shadowReason = latestPoint && absoluteFbheVibrationClass(latestPoint) === "high"
      ? `최신 Blower/Motor 진동이 운전 기준(${FBHE_VIBRATION_ABSOLUTE_RUN_MIN} 이상)을 함께 충족합니다.`
      : "기간 진동값이 저진동·고진동 두 군집으로 분리되어 최신 값이 고진동 군집에 있습니다.";
  } else if (latestClass === "low") {
    shadowState = "stopped";
    shadowReason = latestPoint && absoluteFbheVibrationClass(latestPoint) === "low"
      ? `최신 Blower/Motor 진동이 정지 기준(${FBHE_VIBRATION_ABSOLUTE_STOP_MAX} 이하)을 함께 충족합니다.`
      : "기간 진동값이 저진동·고진동 두 군집으로 분리되어 최신 값이 저진동 군집에 있습니다.";
  } else if (latestTransition?.type === "start") {
    shadowState = "running";
    shadowReason = "Blower와 Motor 진동의 동시 급상승 이후 반대 전환이 없습니다.";
  } else if (latestTransition?.type === "stop") {
    shadowState = "stopped";
    shadowReason = "Blower와 Motor 진동의 동시 급락 이후 반대 전환이 없습니다.";
  } else if (
    latestPoint &&
    latestPoint.validSensorCount >= 3 &&
    Object.values(latestPoint.values).filter(value => value !== null).every(value => value <= 1e-9)
  ) {
    shadowState = "stopped";
    shadowReason = "최신 시간대의 유효 진동값이 모두 0입니다.";
  }

  let signalState = "unknown";
  if (latestPoint?.validSensorCount >= 3) {
    if (
      Object.values(latestPoint.values).filter(value => value !== null).every(value => value <= 1e-9)
    ) {
      signalState = "no_vibration";
    } else if (
      latestClass === "drive_anomaly"
    ) {
      signalState = "drive_anomaly";
    } else {
      signalState = "vibration_present";
    }
  } else if (latestPoint) {
    signalState = "insufficient";
  }

  const manualState = latestPoint
    ? manualFbheVibrationStateAt(operationEvents, latestPoint.sampledAt)
    : "unknown";
  const comparison = shadowState === "unknown" || manualState === "unknown"
    ? "unknown"
    : shadowState === manualState
      ? "match"
      : "mismatch";
  const sensorByRole = new Map(normalized.sensors.map(sensor => [sensor.role, sensor]));
  const successfulSensorCount = FBHE_VIBRATION_SENSOR_ROLES
    .filter(role => Number(sensorByRole.get(role)?.sampleCount || 0) > 0)
    .length;
  const failedSensors = FBHE_VIBRATION_SENSOR_ROLES
    .filter(role => Number(sensorByRole.get(role)?.sampleCount || 0) === 0)
    .map(role => {
      const sensor = sensorByRole.get(role);
      return {
        role,
        tag: normalizeText(sensor?.tag),
        error: normalizeText(sensor?.error) || "TAG 응답 없음"
      };
    });
  const units = [...new Set(normalized.sensors.map(sensor => sensor.unit).filter(Boolean))];
  const runtimeAnalysis = analysisRange?.startAt && analysisRange?.endAt
    ? buildFbheVibrationRuntimeAnalysis(
        normalized.points,
        cluster,
        analysisRange.startAt,
        analysisRange.endAt
      )
    : null;
  const replacementText = normalizeText(assetState?.lastReplacementAt);
  const replacementAt = new Date(replacementText);
  const hasReplacementAt = Boolean(replacementText) && !Number.isNaN(replacementAt.getTime());
  const analysisStartAt = analysisRange?.startAt instanceof Date
    ? analysisRange.startAt
    : new Date(analysisRange?.startAt || 0);
  const analysisEndAt = analysisRange?.endAt instanceof Date
    ? analysisRange.endAt
    : new Date(analysisRange?.endAt || 0);
  const cycleWindowStartAt = hasReplacementAt && !Number.isNaN(analysisStartAt.getTime())
    ? (replacementAt > analysisStartAt ? replacementAt : analysisStartAt)
    : null;
  const cycleWindowEndAt = !Number.isNaN(analysisEndAt.getTime())
    ? analysisEndAt
    : null;
  const cycleWindowHours = cycleWindowStartAt && cycleWindowEndAt && cycleWindowEndAt > cycleWindowStartAt
    ? (cycleWindowEndAt.getTime() - cycleWindowStartAt.getTime()) / 3600000
    : 0;
  const oisCycleRuntimeHours = runtimeAnalysis && cycleWindowStartAt && cycleWindowEndAt
    ? sumFbheVibrationSegmentHours(runtimeAnalysis.segments, "running", cycleWindowStartAt, cycleWindowEndAt)
    : null;
  const oisCycleCoverageHours = runtimeAnalysis && cycleWindowStartAt && cycleWindowEndAt
    ? coverageFbheVibrationSegmentHours(runtimeAnalysis.segments, cycleWindowStartAt, cycleWindowEndAt)
    : null;
  const registeredCycleRuntimeHours = Number(assetState?.cycleElapsedHours);
  const hasRegisteredCycleRuntime = Number.isFinite(registeredCycleRuntimeHours);

  return {
    tagNumber: normalizeText(assetState?.tagNumber || rawAsset?.assetTag || rawAsset?.tagNumber),
    displayName: normalizeText(assetState?.displayName || rawAsset?.displayName),
    unitNo: normalizeText(assetState?.unitNo || rawAsset?.unitNo),
    positionLabel: normalizeText(assetState?.positionLabel || rawAsset?.positionLabel),
    currentCardState: assetState?.isRunning === true ? "running" : "stopped",
    manualState,
    shadowState,
    shadowReason,
    signalState,
    comparison,
    successfulSensorCount,
    failedSensorCount: failedSensors.length,
    failedSensors,
    samplePointCount: normalized.points.length,
    latestSampleAt: latestPoint?.sampledAt || "",
    latest: latestPoint
      ? {
          blowerIndex: roundFbheVibration(latestPoint.blowerIndex),
          motorIndex: roundFbheVibration(latestPoint.motorIndex),
          combinedIndex: roundFbheVibration(latestPoint.combinedIndex),
          validSensorCount: latestPoint.validSensorCount,
          values: Object.fromEntries(
            Object.entries(latestPoint.values).map(([key, value]) => [key, roundFbheVibration(value)])
          ),
          unit: units.length === 1 ? units[0] : ""
        }
      : null,
    cluster: cluster
      ? {
          threshold: roundFbheVibration(cluster.threshold),
          lowerMedian: roundFbheVibration(cluster.lowerMedian),
          upperMedian: roundFbheVibration(cluster.upperMedian),
          separationRatio: roundFbheVibration(cluster.separationRatio, 2),
          lowerCount: cluster.lowerCount,
          upperCount: cluster.upperCount
        }
      : null,
    runtime: runtimeAnalysis
      ? {
          rangeRunningHours: runtimeAnalysis.runningHours,
          rangeStoppedHours: runtimeAnalysis.stoppedHours,
          rangeAnomalyHours: runtimeAnalysis.anomalyHours,
          rangeUnknownHours: runtimeAnalysis.unknownHours,
          rangeCoveragePct: runtimeAnalysis.coveragePct,
          rangeTotalHours: runtimeAnalysis.totalHours,
          oisState: runtimeAnalysis.currentState,
          latestStartAt: runtimeAnalysis.lastStartAt,
          latestStopAt: runtimeAnalysis.lastStopAt,
          transitionCount: runtimeAnalysis.transitions.length,
          segments: runtimeAnalysis.segments.slice(-500),
          cycleStartAt: hasReplacementAt ? replacementAt.toISOString() : "",
          cycleWindowStartAt: cycleWindowStartAt?.toISOString?.() || "",
          cycleWindowHours: roundFbheVibration(cycleWindowHours, 3),
          cycleRuntimeHours: oisCycleRuntimeHours,
          cycleCoverageHours: oisCycleCoverageHours,
          cycleCoveragePct: cycleWindowHours > 0 && oisCycleCoverageHours !== null
            ? roundFbheVibration((oisCycleCoverageHours / cycleWindowHours) * 100, 1)
            : 0,
          cycleRangeComplete: hasReplacementAt && !Number.isNaN(analysisStartAt.getTime())
            ? replacementAt >= analysisStartAt
            : false,
          registeredCycleRuntimeHours: hasRegisteredCycleRuntime
            ? roundFbheVibration(registeredCycleRuntimeHours, 3)
            : null,
          runtimeDifferenceHours: oisCycleRuntimeHours !== null && hasRegisteredCycleRuntime
            ? roundFbheVibration(oisCycleRuntimeHours - registeredCycleRuntimeHours, 3)
            : null
        }
      : null,
    transitions,
    unrecordedTransitionCount: transitions.filter(transition => transition.manualMatch === "unrecorded").length,
    anomalyCount: transitions.filter(transition => transition.type === "drive_anomaly").length
  };
}

/* [FBHE-OIS-RESUME-TIMEOUT-V4-R3] */
async function loadFbheVibrationRequestRows(database, startDate, endDate) {
  const chunks = buildFbheVibrationRangeChunks(startDate, endDate);
  if (chunks.length === 0) return { chunks: [], rows: [] };

  const targetDates = chunks.map(chunk => chunk.targetDate);
  const placeholders = targetDates.map(() => "?").join(", ");
  const result = await database
    .prepare(`
      SELECT
        id, request_type, target_date, status,
        requested_by_id, requested_by_name,
        requested_at, started_at, completed_at,
        agent_id, result_json, error_message,
        expires_at, updated_at
      FROM ois_data_requests
      WHERE request_type = ?
        AND target_date IN (${placeholders})
      ORDER BY datetime(requested_at) DESC, id DESC
    `)
    .bind(FBHE_VIBRATION_REQUEST_TYPE, ...targetDates)
    .all();

  const latestByTargetDate = new Map();
  const latestCompleteByTargetDate = new Map();

  for (const row of Array.isArray(result.results) ? result.results : []) {
    const targetDate = normalizeText(row.target_date);
    if (!latestByTargetDate.has(targetDate)) {
      latestByTargetDate.set(targetDate, row);
    }
    if (
      normalizeText(row.status) === "complete" &&
      !latestCompleteByTargetDate.has(targetDate)
    ) {
      latestCompleteByTargetDate.set(targetDate, row);
    }
  }

  return {
    chunks,
    rows: chunks.map(
      chunk =>
        latestCompleteByTargetDate.get(chunk.targetDate) ||
        latestByTargetDate.get(chunk.targetDate) ||
        null
    )
  };
}

function mergeFbheVibrationRawResults(rows, startDate, endDate) {
  const rangeBounds = fbheVibrationRangeBounds(startDate, endDate, new Date("9999-12-31T00:00:00Z"));
  const startTime = rangeBounds.startAt.getTime();
  const endTime = new Date(`${addFbheVibrationDateDays(endDate, 1)}T00:00:00+09:00`).getTime();
  const assetMap = new Map();
  let successfulSensorChunkCount = 0;
  let failedSensorChunkCount = 0;

  for (const row of rows || []) {
    if (!row || normalizeText(row.status) !== "complete") continue;
    const rawResult = parseFbheVibrationJson(row.result_json);
    if (!rawResult) continue;

    successfulSensorChunkCount += Number(rawResult.successfulSensorCount || 0);
    failedSensorChunkCount += Number(rawResult.failedSensorCount || 0);

    for (const rawAsset of Array.isArray(rawResult.assets) ? rawResult.assets : []) {
      const assetTag = normalizeText(rawAsset?.assetTag || rawAsset?.tagNumber).toUpperCase();
      if (!assetTag) continue;

      if (!assetMap.has(assetTag)) {
        assetMap.set(assetTag, {
          assetTag,
          tagNumber: assetTag,
          displayName: normalizeText(rawAsset?.displayName),
          unitNo: normalizeText(rawAsset?.unitNo),
          positionLabel: normalizeText(rawAsset?.positionLabel),
          sensorMap: new Map()
        });
      }

      const mergedAsset = assetMap.get(assetTag);
      for (const rawSensor of Array.isArray(rawAsset?.sensors) ? rawAsset.sensors : []) {
        const role = normalizeText(rawSensor?.role).toLowerCase();
        if (!FBHE_VIBRATION_SENSOR_ROLES.includes(role)) continue;

        if (!mergedAsset.sensorMap.has(role)) {
          mergedAsset.sensorMap.set(role, {
            role,
            label: normalizeText(rawSensor?.label) || role,
            tag: normalizeText(rawSensor?.tag),
            itemName: normalizeText(rawSensor?.itemName || rawSensor?.item_name),
            unit: normalizeText(rawSensor?.unit),
            sampleMap: new Map(),
            errors: []
          });
        }

        const mergedSensor = mergedAsset.sensorMap.get(role);
        if (!mergedSensor.tag) mergedSensor.tag = normalizeText(rawSensor?.tag);
        if (!mergedSensor.itemName) mergedSensor.itemName = normalizeText(rawSensor?.itemName || rawSensor?.item_name);
        if (!mergedSensor.unit) mergedSensor.unit = normalizeText(rawSensor?.unit);
        const error = normalizeText(rawSensor?.error);
        if (error && !mergedSensor.errors.includes(error)) mergedSensor.errors.push(error);

        for (const sample of Array.isArray(rawSensor?.samples) ? rawSensor.samples : []) {
          const sampledAt = normalizeDateTime(sample?.sampledAt || sample?.sampled_at);
          const value = finiteFbheVibrationNumber(sample?.value);
          const sampleTime = new Date(sampledAt).getTime();
          if (!sampledAt || value === null || !Number.isFinite(sampleTime)) continue;
          if (sampleTime < startTime || sampleTime > endTime) continue;
          mergedSensor.sampleMap.set(sampledAt, { sampledAt, value });
        }
      }
    }
  }

  const assets = [...assetMap.values()].map(asset => ({
    assetTag: asset.assetTag,
    tagNumber: asset.tagNumber,
    displayName: asset.displayName,
    unitNo: asset.unitNo,
    positionLabel: asset.positionLabel,
    sensors: FBHE_VIBRATION_SENSOR_ROLES.map(role => {
      const sensor = asset.sensorMap.get(role);
      return sensor
        ? {
            role: sensor.role,
            label: sensor.label,
            tag: sensor.tag,
            itemName: sensor.itemName,
            unit: sensor.unit,
            samples: [...sensor.sampleMap.values()].sort((left, right) => left.sampledAt.localeCompare(right.sampledAt)),
            sampleCount: sensor.sampleMap.size,
            error: sensor.sampleMap.size > 0 ? "" : sensor.errors.join(" · ")
          }
        : {
            role,
            label: role,
            tag: "",
            itemName: "",
            unit: "",
            samples: [],
            sampleCount: 0,
            error: "TAG 응답 없음"
          };
    })
  }));

  return {
    assets,
    successfulSensorChunkCount,
    failedSensorChunkCount
  };
}

async function loadFbheVibrationOperationEvents(database) {
  const placeholders = FBHE_VIBRATION_ASSET_TAGS.map(() => "?").join(", ");
  const result = await database
    .prepare(`
      SELECT
        id, tag_number, event_type, event_date, action_type, note,
        source_type, created_at
      FROM blower_history_events
      WHERE tag_number IN (${placeholders})
        AND event_type IN ('replacement', 'startup', 'operation_start', 'operation_stop', 'runtime_correction')
      ORDER BY datetime(event_date) DESC, created_at DESC, id DESC
      LIMIT 2000
    `)
    .bind(...FBHE_VIBRATION_ASSET_TAGS)
    .all();

  return Array.isArray(result.results) ? result.results : [];
}

async function buildFbheVibrationShadowResponse(database, assetStates, startDate, endDate) {
  const dayCount = countFbheVibrationRangeDays(startDate, endDate);
  if (dayCount < 1 || dayCount > FBHE_VIBRATION_RANGE_MAX_DAYS) {
    return {
      ok: false,
      message: `FBHE 진동 조회기간은 1일 이상 ${FBHE_VIBRATION_RANGE_MAX_DAYS}일 이하로 선택해 주세요.`,
      status: 400
    };
  }

  const today = formatKstDate(new Date());
  if (endDate > today) {
    return {
      ok: false,
      message: "미래 날짜의 FBHE 진동은 조회할 수 없습니다.",
      status: 400
    };
  }

  const requestSet = await loadFbheVibrationRequestRows(database, startDate, endDate);
  const chunks = requestSet.chunks;
  const rows = requestSet.rows;
  const queueItems = chunks.map((chunk, index) => {
    const row = rows[index];
    return row
      ? {
          id: normalizeText(row.id),
          targetDate: normalizeText(row.target_date),
          status: normalizeText(row.status),
          requestedAt: normalizeText(row.requested_at),
          startedAt: normalizeText(row.started_at),
          completedAt: normalizeText(row.completed_at),
          errorMessage: normalizeText(row.error_message),
          expiresAt: normalizeText(row.expires_at),
          updatedAt: normalizeText(row.updated_at)
        }
      : {
          id: "",
          targetDate: chunk.targetDate,
          status: "missing",
          requestedAt: "",
          startedAt: "",
          completedAt: "",
          errorMessage: "",
          expiresAt: "",
          updatedAt: ""
        };
  });
  const statusCount = status => queueItems.filter(item => item.status === status).length;
  const queue = {
    status: statusCount("processing") > 0
      ? "processing"
      : statusCount("pending") > 0
        ? "pending"
        : statusCount("failed") + statusCount("expired") > 0
          ? "partial_failed"
          : statusCount("complete") === chunks.length && chunks.length > 0
            ? "complete"
            : "partial",
    chunkCount: chunks.length,
    completeCount: statusCount("complete"),
    pendingCount: statusCount("pending"),
    processingCount: statusCount("processing"),
    failedCount: statusCount("failed") + statusCount("expired"),
    missingCount: statusCount("missing"),
    items: queueItems
  };

  const baseResponse = {
    ok: true,
    startDate,
    endDate,
    dayCount,
    queue,
    automaticApply: false,
    actualStateChanged: false,
    runtimeChanged: false,
    cycleChanged: false,
    assets: [],
    summary: {
      assetCount: 0,
      shadowDecidedCount: 0,
      matchCount: 0,
      mismatchCount: 0,
      unknownCount: 0,
      transitionCount: 0,
      unrecordedTransitionCount: 0,
      anomalyCount: 0,
      successfulSensorChunkCount: 0,
      failedSensorChunkCount: 0,
      averageCoveragePct: 0,
      completeChunkCount: queue.completeCount,
      chunkCount: queue.chunkCount
    }
  };

  const completeRows = rows.filter(row => row && normalizeText(row.status) === "complete");
  if (completeRows.length === 0) return baseResponse;

  const merged = mergeFbheVibrationRawResults(completeRows, startDate, endDate);
  const rawAssetByTag = new Map(
    merged.assets.map(rawAsset => [
      normalizeText(rawAsset?.assetTag || rawAsset?.tagNumber).toUpperCase(),
      rawAsset
    ])
  );
  const operationEvents = await loadFbheVibrationOperationEvents(database);
  const eventsByTag = new Map();
  for (const event of operationEvents) {
    const tagNumber = normalizeText(event.tag_number).toUpperCase();
    if (!eventsByTag.has(tagNumber)) eventsByTag.set(tagNumber, []);
    eventsByTag.get(tagNumber).push(event);
  }

  const bounds = fbheVibrationRangeBounds(startDate, endDate, new Date());
  const analysisRange = {
    startAt: bounds.startAt,
    endAt: bounds.endAt
  };
  const fbheAssets = (assetStates || [])
    .filter(asset => asset.blowerType === "fbhe")
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  const assets = fbheAssets.map(asset => {
    const tagNumber = normalizeText(asset.tagNumber).toUpperCase();
    return buildFbheVibrationAssetShadow(
      asset,
      rawAssetByTag.get(tagNumber) || {
        assetTag: asset.tagNumber,
        displayName: asset.displayName,
        unitNo: asset.unitNo,
        positionLabel: asset.positionLabel,
        sensors: []
      },
      eventsByTag.get(tagNumber) || [],
      analysisRange
    );
  });

  const coverageValues = assets
    .map(asset => Number(asset.runtime?.rangeCoveragePct))
    .filter(Number.isFinite);
  const summary = {
    assetCount: assets.length,
    shadowDecidedCount: assets.filter(asset => (asset.runtime?.oisState || asset.shadowState) !== "unknown").length,
    matchCount: assets.filter(asset => asset.comparison === "match").length,
    mismatchCount: assets.filter(asset => asset.comparison === "mismatch").length,
    unknownCount: assets.filter(asset => (asset.runtime?.oisState || asset.shadowState) === "unknown").length,
    transitionCount: assets.reduce((sum, asset) => sum + Number(asset.runtime?.transitionCount || asset.transitions.length || 0), 0),
    unrecordedTransitionCount: assets.reduce((sum, asset) => sum + asset.unrecordedTransitionCount, 0),
    anomalyCount: assets.reduce((sum, asset) => sum + asset.anomalyCount, 0),
    successfulSensorChunkCount: merged.successfulSensorChunkCount,
    failedSensorChunkCount: merged.failedSensorChunkCount,
    averageCoveragePct: coverageValues.length > 0
      ? roundFbheVibration(coverageValues.reduce((sum, value) => sum + value, 0) / coverageValues.length, 1)
      : 0,
    completeChunkCount: queue.completeCount,
    chunkCount: queue.chunkCount
  };

  return {
    ...baseResponse,
    source: {
      source: "OIS TAG Log Direct API",
      collectedAt: completeRows
        .map(row => parseFbheVibrationJson(row.result_json)?.collectedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || "",
      outputIntervalHours: 1,
      requestedSensorCountPerChunk: 24,
      successfulSensorChunkCount: merged.successfulSensorChunkCount,
      failedSensorChunkCount: merged.failedSensorChunkCount
    },
    analysis: {
      startAt: bounds.startAtText,
      endAt: bounds.endAtText,
      readOnly: true,
      runtimeUnit: "hour",
      transitionEstimate: "hourly_midpoint"
    },
    assets,
    summary
  };
}

async function handleGet(context, user) {
  const database = context.env.DB;
  const url = new URL(context.request.url);
  const action = normalizeText(url.searchParams.get("action")) || "data";
  const permissions = buildPermissions(user);

  if (action === "candidates" && !user) {
    return jsonResponse(
      { ok: false, message: "로그인이 필요합니다.", permissions },
      401
    );
  }

  const settings = await loadSettings(database);
  const assets = await loadAssetStates(database, settings);
  const responseAssets = user
    ? assets
    : sanitizeAssetsForAnonymous(assets);

  if (action === "vibration_shadow") {
    if (!user) {
      return jsonResponse(
        { ok: false, message: "FBHE OIS 진동 조회는 로그인이 필요합니다.", permissions },
        401
      );
    }

    const legacyTargetDate = normalizeText(url.searchParams.get("targetDate"));
    const startDate = normalizeText(url.searchParams.get("startDate")) || legacyTargetDate;
    const endDate = normalizeText(url.searchParams.get("endDate")) || legacyTargetDate || startDate;
    const result = await buildFbheVibrationShadowResponse(database, assets, startDate, endDate);
    if (result.ok === false) {
      return jsonResponse({ ...result, permissions }, Number(result.status || 400));
    }
    return jsonResponse({ ...result, permissions, generatedAt: new Date().toISOString() });
  }

  if (action === "summary") {
    return jsonResponse({
      ok: true,
      permissions,
      ...buildSummaryFromAssets(responseAssets),
      generatedAt: new Date().toISOString()
    });
  }

  if (action === "events") {
    const events = await loadEvents(
      database,
      Number(url.searchParams.get("limit")) || 500
    );

    return jsonResponse({
      ok: true,
      permissions,
      events: user ? events : sanitizeEventsForAnonymous(events)
    });
  }

  if (action === "candidates") {
    return jsonResponse({
      ok: true,
      permissions,
      candidates: await loadCandidates(
        database,
        normalizeText(url.searchParams.get("status")) || "pending",
        Number(url.searchParams.get("limit")) || 300
      )
    });
  }

  return jsonResponse(await buildFullData(database, user));
}

function validateSettingsInput(body) {
  const blowerType = normalizeText(body.blowerType);
  const cycleDays = toNullableNumber(body.cycleDays);
  const warningDays = toNullableNumber(body.warningDays);
  const criticalDays = toNullableNumber(body.criticalDays);

  if (!typeExists(blowerType)) {
    return { error: "Blower 종류를 확인해 주세요." };
  }

  if (cycleDays === null) {
    return {
      blowerType,
      cycleDays: null,
      warningDays: null,
      criticalDays: null
    };
  }

  if (!(cycleDays > 0 && cycleDays <= 3650)) {
    return { error: "교체주기는 0일 초과 3,650일 이하로 입력해 주세요." };
  }

  if (
    warningDays === null ||
    criticalDays === null ||
    warningDays < 0 ||
    criticalDays < 0
  ) {
    return { error: "교체 예정/임박 알림 일수를 입력해 주세요." };
  }

  if (!(criticalDays < warningDays && warningDays < cycleDays)) {
    return {
      error: "교체 임박 일수 < 교체 예정 일수 < 교체주기 순서가 되어야 합니다."
    };
  }

  return {
    blowerType,
    cycleDays,
    warningDays,
    criticalDays
  };
}

async function updateSettings(database, user, body) {
  const validated = validateSettingsInput(body);

  if (validated.error) {
    return jsonResponse({ ok: false, message: validated.error }, 400);
  }

  const current = await database
    .prepare(`
      SELECT *
      FROM blower_history_settings
      WHERE blower_type = ?
      LIMIT 1
    `)
    .bind(validated.blowerType)
    .first();

  const now = new Date().toISOString();

  await database.batch([
    database
      .prepare(`
        UPDATE blower_history_settings
        SET
          cycle_days = ?,
          warning_days = ?,
          critical_days = ?,
          updated_by_id = ?,
          updated_by_name = ?,
          updated_at = ?
        WHERE blower_type = ?
      `)
      .bind(
        validated.cycleDays,
        validated.warningDays,
        validated.criticalDays,
        user.employeeNo,
        user.name,
        now,
        validated.blowerType
      ),
    database
      .prepare(`
        INSERT INTO blower_history_setting_history (
          id,
          blower_type,
          old_cycle_days,
          new_cycle_days,
          old_warning_days,
          new_warning_days,
          old_critical_days,
          new_critical_days,
          changed_by_id,
          changed_by_name,
          changed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        crypto.randomUUID(),
        validated.blowerType,
        toNullableNumber(current?.cycle_days),
        validated.cycleDays,
        toNullableNumber(current?.warning_days),
        validated.warningDays,
        toNullableNumber(current?.critical_days),
        validated.criticalDays,
        user.employeeNo,
        user.name,
        now
      )
  ]);

  return jsonResponse({
    ok: true,
    message: "교체주기 설정을 저장했습니다.",
    settings: await loadSettings(database)
  });
}

function validateAssetInput(body) {
  const mode = normalizeText(body.mode);
  const originalTag = normalizeText(body.originalTag).toUpperCase();
  const tagNumber = normalizeText(body.tagNumber).toUpperCase();
  const blowerType = normalizeText(body.blowerType);
  const unitNo = normalizeText(body.unitNo);
  const assetGroup = normalizeText(body.assetGroup);
  const rawPositionLabel = normalizeText(body.positionLabel);
  const compactPositionLabel = rawPositionLabel.replace(/\s+/g, "").toUpperCase();
  const positionLabel = /^#?[ABC]$/.test(compactPositionLabel)
    ? `#${compactPositionLabel.slice(-1)}`
    : rawPositionLabel;
  const displayName = normalizeText(body.displayName);
  const sortOrder = Number(body.sortOrder);
  const enabled = body.enabled;
  const expectedUpdatedAt = normalizeText(body.expectedUpdatedAt);
  const changeNote = normalizeText(body.changeNote).slice(0, 300);

  if (!["create", "update"].includes(mode)) {
    return { error: "추가 또는 수정 모드를 확인해 주세요." };
  }

  if (!/^[A-Z0-9](?:[A-Z0-9._/-]{1,78}[A-Z0-9])$/.test(tagNumber)) {
    return { error: "TAG는 영문 대문자·숫자로 시작하고 끝나는 3~80자로 입력해 주세요. 중간에는 . _ / -를 사용할 수 있습니다." };
  }

  if (tagNumber.replace(/[^A-Z0-9]/g, "").length < 3) {
    return { error: "TAG는 구분기호를 제외한 영문 대문자·숫자를 3자 이상 포함해야 합니다." };
  }

  const compactSlashTag = tagNumber.replace(/[._-]/g, "");
  const ambiguousGroupedTag = [
    /^(?:104|204)HHL60AP(?:611|621|631)(?:\/(?:(?:104|204)HHL60AP)?(?:611|621|631))+$/,
    /^(?:104|204)HHL10AN(?:611|621|631)(?:\/(?:(?:104|204)HHL10AN)?(?:611|621|631))+$/,
    /^(?:104|204)SDF01AN(?:001|002)(?:\/(?:(?:104|204)SDF01AN)?(?:001|002))+$/,
    /^(?:104|204)ETG30AN(?:601|602)(?:\/(?:(?:104|204)ETG30AN)?(?:601|602))+$/,
    /^104ETH03AN(?:601|602)(?:\/(?:104ETH03AN)?(?:601|602))+$/
  ].some(pattern => pattern.test(compactSlashTag));
  if (ambiguousGroupedTag) {
    return { error: "여러 기존 TAG의 묶음 표기와 구분할 수 없는 TAG입니다. 개별 설비를 식별하는 TAG를 입력해 주세요." };
  }

  if (mode === "update" && (!originalTag || tagNumber !== originalTag)) {
    return { error: "기존 TAG는 교체이력 연결을 위해 변경할 수 없습니다. 기존 설비를 사용 중지하고 새 TAG를 추가해 주세요." };
  }

  if (!typeExists(blowerType)) {
    return { error: "Blower 종류를 확인해 주세요." };
  }

  if (!["", "manure"].includes(assetGroup)) {
    return { error: "카드 그룹을 확인해 주세요." };
  }

  if (!["1", "2", "shared"].includes(unitNo)) {
    return { error: "호기는 #1호기, #2호기 또는 1·2호기 공용 중에서 선택해 주세요." };
  }

  if (assetGroup === "manure" && blowerType !== "organic_fuel") {
    return { error: "축분 그룹은 유기성 고형연료 Blower에서만 사용할 수 있습니다." };
  }

  if (!positionLabel || positionLabel.length > 30) {
    return { error: "카드 위치명은 1~30자로 입력해 주세요." };
  }

  if (!displayName || displayName.length > 120) {
    return { error: "설비명은 1~120자로 입력해 주세요." };
  }

  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    return { error: "표시 순서는 0~9,999 사이의 정수로 입력해 주세요." };
  }

  if (typeof enabled !== "boolean") {
    return { error: "사용 여부를 확인해 주세요." };
  }

  if (mode === "update" && !expectedUpdatedAt) {
    return { error: "수정 기준시각이 없어 최신 설비정보를 다시 불러와야 합니다." };
  }

  return {
    mode,
    originalTag,
    tagNumber,
    blowerType,
    unitNo,
    assetGroup,
    positionLabel,
    displayName,
    sortOrder,
    enabled,
    expectedUpdatedAt,
    changeNote
  };
}

function isAssetUniquenessError(error) {
  return /(?:unique|constraint|idx_blower_history_assets_(?:active_slot|canonical_tag))/i.test(
    error instanceof Error ? error.message : String(error || "")
  );
}

function nextAssetUpdatedAt(expectedUpdatedAt = "") {
  const expectedTime = Date.parse(normalizeText(expectedUpdatedAt));
  const minimumTime = Number.isFinite(expectedTime) ? expectedTime + 1 : 0;
  return new Date(Math.max(Date.now(), minimumTime)).toISOString();
}

async function saveAsset(database, user, body) {
  const validated = validateAssetInput(body);

  if (validated.error) {
    return jsonResponse({ ok: false, message: validated.error }, 400);
  }

  const existing = await database
    .prepare(`SELECT * FROM blower_history_assets WHERE tag_number = ? LIMIT 1`)
    .bind(validated.mode === "create" ? validated.tagNumber : validated.originalTag)
    .first();

  if (validated.mode === "create" && existing) {
    return jsonResponse({ ok: false, message: "이미 등록된 TAG입니다." }, 409);
  }

  if (validated.mode === "update" && !existing) {
    return jsonResponse({ ok: false, message: "수정할 Blower를 찾을 수 없습니다." }, 404);
  }

  if (validated.mode === "update") {
    const existingPositionRaw = normalizeText(existing.position_label);
    const existingPositionCompact = existingPositionRaw.replace(/\s+/g, "").toUpperCase();
    const existingPosition = /^#?[ABC]$/.test(existingPositionCompact)
      ? `#${existingPositionCompact.slice(-1)}`
      : existingPositionRaw;
    const structuralIdentityChanged = (
      normalizeText(existing.blower_type) !== validated.blowerType ||
      normalizeText(existing.unit_no) !== validated.unitNo ||
      normalizeText(existing.asset_group) !== validated.assetGroup ||
      existingPosition !== validated.positionLabel
    );

    if (structuralIdentityChanged) {
      return jsonResponse({
        ok: false,
        code: "ASSET_IDENTITY_IMMUTABLE",
        message: "기존 Blower의 종류·호기·그룹·위치는 과거 이력 보호를 위해 변경할 수 없습니다. 기존 설비를 사용 중지하고 새 TAG를 추가해 주세요."
      }, 400);
    }
  }

  const canonicalTag = compactEquipmentText(validated.tagNumber);
  const canonicalCollision = validated.mode === "create"
    ? await database
      .prepare(`
        SELECT tag_number
        FROM blower_history_assets
        WHERE tag_number <> ?
          AND (
            UPPER(REPLACE(REPLACE(REPLACE(REPLACE(tag_number, '.', ''), '_', ''), '/', ''), '-', '')) = ?
            OR INSTR(UPPER(REPLACE(REPLACE(REPLACE(REPLACE(tag_number, '.', ''), '_', ''), '/', ''), '-', '')), ?) > 0
            OR INSTR(?, UPPER(REPLACE(REPLACE(REPLACE(REPLACE(tag_number, '.', ''), '_', ''), '/', ''), '-', ''))) > 0
          )
        LIMIT 1
      `)
      .bind(validated.tagNumber, canonicalTag, canonicalTag, canonicalTag)
      .first()
    : null;

  if (canonicalCollision) {
    return jsonResponse({
      ok: false,
      code: "ASSET_UNIQUENESS_CONFLICT",
      message: `${canonicalCollision.tag_number}와 문자 구성이 겹치는 TAG입니다. 서로 포함되지 않는 새 TAG를 입력해 주세요.`
    }, 409);
  }

  if (
    validated.mode === "update" &&
    normalizeText(existing.updated_at) !== validated.expectedUpdatedAt
  ) {
    return jsonResponse({
      ok: false,
      code: "ASSET_EDIT_CONFLICT",
      message: "다른 사용자가 먼저 설비정보를 변경했습니다. 새로고침 후 다시 수정해 주세요."
    }, 409);
  }

  if (validated.enabled) {
    const duplicatePosition = await database
      .prepare(`
        SELECT tag_number
        FROM blower_history_assets
        WHERE tag_number <> ?
          AND enabled = 1
          AND blower_type = ?
          AND unit_no = ?
          AND COALESCE(asset_group, '') = ?
          AND UPPER(position_label) = UPPER(?)
        LIMIT 1
      `)
      .bind(
        validated.tagNumber,
        validated.blowerType,
        validated.unitNo,
        validated.assetGroup,
        validated.positionLabel
      )
      .first();

    if (duplicatePosition) {
      return jsonResponse({
        ok: false,
        message: `같은 종류·그룹·호기에 ${validated.positionLabel} 위치가 이미 등록되어 있습니다.`
      }, 409);
    }
  }

  const now = nextAssetUpdatedAt(
    validated.mode === "update" ? validated.expectedUpdatedAt : ""
  );
  const assetRevision = crypto.randomUUID();
  const cycleRuntimeRevision = crypto.randomUUID();
  const after = {
    tagNumber: validated.tagNumber,
    blowerType: validated.blowerType,
    unitNo: validated.unitNo,
    assetGroup: validated.assetGroup,
    positionLabel: validated.positionLabel,
    displayName: validated.displayName,
    sortOrder: validated.sortOrder,
    enabled: validated.enabled,
    lastModifiedById: user.employeeNo,
    lastModifiedByName: user.name,
    createdAt: normalizeText(existing?.created_at) || now,
    updatedAt: now
  };
  const historyValues = [
    crypto.randomUUID(),
    validated.mode,
    validated.tagNumber,
    existing ? JSON.stringify(assetCatalogItem(existing)) : "",
    JSON.stringify(after),
    validated.changeNote,
    user.employeeNo,
    user.name,
    now
  ];

  if (validated.mode === "create") {
    let results;
    try {
      results = await database.batch([
        database
          .prepare(`
            INSERT INTO blower_history_assets (
              tag_number, blower_type, unit_no, asset_group, position_label,
              display_name, sort_order, enabled, asset_revision,
              cycle_runtime_hours, cycle_runtime_anchor_at, cycle_runtime_state, cycle_runtime_revision,
              last_modified_by_id, last_modified_by_name, created_at, updated_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'stopped', ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
              SELECT 1
              FROM blower_history_assets
              WHERE
                INSTR(UPPER(REPLACE(REPLACE(REPLACE(REPLACE(tag_number, '.', ''), '_', ''), '/', ''), '-', '')), ?) > 0
                OR INSTR(?, UPPER(REPLACE(REPLACE(REPLACE(REPLACE(tag_number, '.', ''), '_', ''), '/', ''), '-', ''))) > 0
            )
          `)
          .bind(
            validated.tagNumber,
            validated.blowerType,
            validated.unitNo,
            validated.assetGroup,
            validated.positionLabel,
            validated.displayName,
            validated.sortOrder,
            validated.enabled ? 1 : 0,
            assetRevision,
            now,
            cycleRuntimeRevision,
            user.employeeNo,
            user.name,
            now,
            now,
            canonicalTag,
            canonicalTag
          ),
        database
          .prepare(`
            INSERT INTO blower_history_asset_history (
              id, action_type, tag_number, before_json, after_json, change_note,
              changed_by_id, changed_by_name, changed_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM blower_history_assets
              WHERE tag_number = ? AND asset_revision = ?
            )
          `)
          .bind(...historyValues, validated.tagNumber, assetRevision)
      ]);
    } catch (error) {
      if (isAssetUniquenessError(error)) {
        return jsonResponse({
          ok: false,
          code: "ASSET_UNIQUENESS_CONFLICT",
          message: "같거나 구분할 수 없는 TAG 또는 같은 종류·그룹·호기·위치가 먼저 등록되었습니다. 새로고침 후 다시 확인해 주세요."
        }, 409);
      }
      throw error;
    }

    if (Number(results?.[0]?.meta?.changes || 0) === 0) {
      return jsonResponse({
        ok: false,
        code: "ASSET_UNIQUENESS_CONFLICT",
        message: "같거나 문자 구성이 겹치는 TAG가 먼저 등록되었습니다. 새로고침 후 다시 확인해 주세요."
      }, 409);
    }
  } else {
    let results;
    try {
      results = await database.batch([
        database
          .prepare(`
            UPDATE blower_history_assets
            SET blower_type = ?, unit_no = ?, asset_group = ?, position_label = ?,
                display_name = ?, sort_order = ?, enabled = ?,
                asset_revision = ?, last_modified_by_id = ?, last_modified_by_name = ?, updated_at = ?
            WHERE tag_number = ? AND updated_at = ?
          `)
          .bind(
            validated.blowerType,
            validated.unitNo,
            validated.assetGroup,
            validated.positionLabel,
            validated.displayName,
            validated.sortOrder,
            validated.enabled ? 1 : 0,
            assetRevision,
            user.employeeNo,
            user.name,
            now,
            validated.originalTag,
            validated.expectedUpdatedAt
          ),
        database
          .prepare(`
            INSERT INTO blower_history_asset_history (
              id, action_type, tag_number, before_json, after_json, change_note,
              changed_by_id, changed_by_name, changed_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM blower_history_assets
              WHERE tag_number = ? AND asset_revision = ?
            )
          `)
          .bind(...historyValues, validated.originalTag, assetRevision)
      ]);
    } catch (error) {
      if (isAssetUniquenessError(error)) {
        return jsonResponse({
          ok: false,
          code: "ASSET_UNIQUENESS_CONFLICT",
          message: "같은 종류·그룹·호기·위치가 먼저 사용 중으로 등록되었습니다. 새로고침 후 다시 확인해 주세요."
        }, 409);
      }
      throw error;
    }

    if (Number(results?.[0]?.meta?.changes || 0) === 0) {
      return jsonResponse({
        ok: false,
        code: "ASSET_EDIT_CONFLICT",
        message: "다른 사용자가 먼저 설비정보를 변경했습니다. 새로고침 후 다시 수정해 주세요."
      }, 409);
    }
  }

  return jsonResponse({
    ok: true,
    message: validated.mode === "create"
      ? "새 Blower를 추가했습니다. 교체이력은 별도로 등록할 때까지 비어 있습니다."
      : (validated.enabled ? "Blower 정보를 수정했습니다." : "Blower를 사용 중지했습니다. 기존 이력은 보존됩니다."),
    assetCatalog: await loadAssetCatalog(database)
  });
}

async function findAsset(database, tagNumber) {
  return database
    .prepare(`
      SELECT *
      FROM blower_history_assets
      WHERE tag_number = ? AND enabled = 1
      LIMIT 1
    `)
    .bind(tagNumber)
    .first();
}

async function insertEvent(database, user, data) {
  const now = new Date().toISOString();
  const id = normalizeText(data.id) || crypto.randomUUID();

  const result = await database
    .prepare(`
      INSERT OR IGNORE INTO blower_history_events (
        id,
        tag_number,
        event_type,
        event_date,
        runtime_hours,
        issue_type,
        action_type,
        note,
        source_type,
        source_log_id,
        source_text,
        created_by_id,
        created_by_name,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      data.tagNumber,
      data.eventType,
      data.eventDate,
      Math.max(0, Number(data.runtimeHours || 0)),
      normalizeText(data.issueType),
      normalizeText(data.actionType),
      normalizeText(data.note),
      normalizeText(data.sourceType) || "manual",
      normalizeText(data.sourceLogId),
      normalizeText(data.sourceText).slice(0, 2000),
      user.employeeNo,
      user.name,
      now,
      now
    )
    .run();

  return {
    id,
    inserted: Number(result?.meta?.changes || 0) > 0
  };
}

async function registerReplacement(database, user, body, source = {}) {
  const tagNumber = normalizeText(body.tagNumber).toUpperCase();
  const asset = await findAsset(database, tagNumber);

  if (!asset) {
    return jsonResponse({ ok: false, message: "등록된 Blower TAG를 찾을 수 없습니다." }, 404);
  }

  const eventDate = normalizeDateTime(body.eventDate || body.date);

  if (!eventDate) {
    return jsonResponse({ ok: false, message: "교체날짜를 확인해 주세요." }, 400);
  }

  const eventDateValue = new Date(eventDate);

  if (eventDateValue > new Date(Date.now() + 24 * 3600000)) {
    return jsonResponse({ ok: false, message: "교체날짜가 현재보다 너무 미래입니다." }, 400);
  }

  const beforeRuntime = eventRuntimeHoursAt(asset, eventDate);
  const issueType = normalizeText(body.issueType) || "정기주기";
  const actionType = normalizeText(body.actionType) || "교체";
  const note = normalizeText(body.note);
  const startImmediately = body.startImmediately === true;
  const cycleStartAt = startImmediately
    ? normalizeDateTime(body.startupAt)
    : "";

  if (startImmediately) {
    if (!normalizeText(body.startupAt) || !cycleStartAt) {
      return jsonResponse({ ok: false, message: "실제 기동일시를 입력해 주세요." }, 400);
    }
    const startupValue = new Date(cycleStartAt);
    if (
      !cycleStartAt ||
      Number.isNaN(startupValue.getTime()) ||
      startupValue < eventDateValue
    ) {
      return jsonResponse({ ok: false, message: "실제 기동일시는 V-Belt 교체일보다 빠를 수 없습니다." }, 400);
    }
    if (startupValue > new Date(Date.now() + 5 * 60000)) {
      return jsonResponse({ ok: false, message: "실제 기동일시는 현재 이후로 등록할 수 없습니다." }, 400);
    }
  }

  const currentReplacement = asset.last_replacement_at
    ? new Date(asset.last_replacement_at)
    : null;

  const shouldUpdateCurrentState =
    !currentReplacement ||
    Number.isNaN(currentReplacement.getTime()) ||
    eventDateValue >= currentReplacement;

  if (shouldUpdateCurrentState) {
    const now = new Date().toISOString();
    const cycleStartRevision = crypto.randomUUID();
    const cycleRuntimeRevision = crypto.randomUUID();
    const replacementEventId = crypto.randomUUID();
    const startupEventId = crypto.randomUUID();
    const currentCycleStartRevision = normalizeText(asset.cycle_start_revision);
    const currentCycleRuntimeRevision = normalizeText(asset.cycle_runtime_revision);
    const currentLastReplacementAt = normalizeText(asset.last_replacement_at);
    const sourceType = normalizeText(source.sourceType) || "manual";
    const sourceLogId = normalizeText(source.sourceLogId);
    const sourceText = normalizeText(source.sourceText).slice(0, 2000);
    const statements = [
      database.prepare(`
        UPDATE blower_history_assets
        SET
          last_replacement_at = ?,
          cycle_started_at = ?,
          cycle_start_state = ?,
          cycle_start_revision = ?,
          cycle_runtime_hours = 0,
          cycle_runtime_anchor_at = ?,
          cycle_runtime_state = ?,
          cycle_runtime_revision = ?,
          runtime_hours = 0,
          runtime_anchor_at = ?,
          is_running = ?,
          last_modified_by_id = ?,
          last_modified_by_name = ?,
          updated_at = ?
        WHERE tag_number = ?
          AND enabled = 1
          AND COALESCE(last_replacement_at, '') = ?
          AND cycle_start_revision = ?
          AND cycle_runtime_revision = ?
      `)
      .bind(
        eventDate,
        startImmediately ? cycleStartAt : null,
        startImmediately ? "started" : "pending",
        cycleStartRevision,
        startImmediately ? cycleStartAt : eventDate,
        startImmediately ? "running" : "stopped",
        cycleRuntimeRevision,
        startImmediately ? cycleStartAt : null,
        startImmediately ? 1 : 0,
        user.employeeNo,
        user.name,
        now,
        tagNumber,
        currentLastReplacementAt,
        currentCycleStartRevision,
        currentCycleRuntimeRevision
      ),
      database.prepare(`
        INSERT INTO blower_history_events (
          id, tag_number, event_type, event_date, runtime_hours,
          issue_type, action_type, note, source_type, source_log_id,
          source_text, created_by_id, created_by_name, created_at, updated_at
        )
        SELECT ?, ?, 'replacement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM blower_history_assets
          WHERE tag_number = ?
            AND last_replacement_at = ?
            AND cycle_start_revision = ?
            AND cycle_runtime_revision = ?
        )
      `).bind(
        replacementEventId,
        tagNumber,
        eventDate,
        beforeRuntime,
        issueType,
        actionType,
        note,
        sourceType,
        sourceLogId,
        sourceText,
        user.employeeNo,
        user.name,
        now,
        now,
        tagNumber,
        eventDate,
        cycleStartRevision,
        cycleRuntimeRevision
      )
    ];

    if (startImmediately) {
      statements.push(database.prepare(`
        INSERT INTO blower_history_events (
          id, tag_number, event_type, event_date, runtime_hours,
          issue_type, action_type, note, source_type, source_log_id,
          source_text, created_by_id, created_by_name, created_at, updated_at
        )
        SELECT ?, ?, 'startup', ?, 0, '', '교체 후 즉시 기동', ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM blower_history_assets
          WHERE tag_number = ?
            AND last_replacement_at = ?
            AND cycle_start_state = 'started'
            AND cycle_start_revision = ?
            AND cycle_runtime_revision = ?
        )
      `).bind(
        startupEventId,
        tagNumber,
        cycleStartAt,
        note,
        sourceType,
        sourceLogId,
        sourceText,
        user.employeeNo,
        user.name,
        now,
        now,
        tagNumber,
        eventDate,
        cycleStartRevision,
        cycleRuntimeRevision
      ));
    }

    const results = await database.batch(statements);
    if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
      return jsonResponse({ ok: false, message: "최근 Cycle이 변경되었습니다. 새로고침 후 교체 이력을 다시 등록해 주세요." }, 409);
    }
    if (Number(results?.[1]?.meta?.changes || 0) !== 1 || (startImmediately && Number(results?.[2]?.meta?.changes || 0) !== 1)) {
      throw new Error("교체 상태와 교체·기동 이력을 함께 저장하지 못했습니다.");
    }
  } else {
    await insertEvent(database, user, {
      tagNumber,
      eventType: "replacement",
      eventDate,
      runtimeHours: beforeRuntime,
      issueType,
      actionType,
      note,
      sourceType: source.sourceType || "manual",
      sourceLogId: source.sourceLogId || "",
      sourceText: source.sourceText || ""
    });

    if (startImmediately) {
      await insertEvent(database, user, {
        tagNumber,
        eventType: "startup",
        eventDate: cycleStartAt,
        runtimeHours: 0,
        issueType: "",
        actionType: "교체 후 즉시 기동",
        note,
        sourceType: source.sourceType || "manual",
        sourceLogId: source.sourceLogId || "",
        sourceText: source.sourceText || ""
      });
    }
  }

  return jsonResponse({
    ok: true,
    message: shouldUpdateCurrentState
      ? (startImmediately
        ? "교체 이력과 기동을 함께 등록하고 새 Cycle을 시작했습니다."
        : "교체 이력을 등록했습니다. 실제 기동 전까지 Cycle 계산은 시작하지 않습니다.")
      : "과거 교체 이력을 등록했습니다. 현재 Cycle은 변경하지 않았습니다."
  });
}

async function registerStartup(database, user, body, source = {}) {
  const tagNumber = normalizeText(body.tagNumber).toUpperCase();
  const asset = await findAsset(database, tagNumber);

  if (!asset) {
    return jsonResponse({ ok: false, message: "등록된 Blower TAG를 찾을 수 없습니다." }, 404);
  }

  if (!normalizeText(asset.last_replacement_at)) {
    return jsonResponse({ ok: false, message: "먼저 V-Belt 교체 이력을 등록해 주세요." }, 409);
  }

  if (normalizeText(asset.cycle_start_state) !== "pending") {
    return jsonResponse({ ok: false, message: "이미 이 Cycle의 기동이 등록되어 있습니다." }, 409);
  }

  const expectedLastReplacementAt = normalizeDateTime(body.expectedLastReplacementAt);
  const currentLastReplacementAt = normalizeText(asset.last_replacement_at);
  if (!expectedLastReplacementAt || expectedLastReplacementAt !== normalizeDateTime(currentLastReplacementAt)) {
    return jsonResponse({ ok: false, message: "최근 교체 이력이 변경되었습니다. 새로고침 후 다시 등록해 주세요." }, 409);
  }

  const eventDate = normalizeDateTime(body.eventDate || body.date);

  if (!eventDate) {
    return jsonResponse({ ok: false, message: "실제 기동일을 확인해 주세요." }, 400);
  }

  const replacementAt = new Date(asset.last_replacement_at);
  const startupAt = new Date(eventDate);
  const futureLimit = new Date(Date.now() + 5 * 60000);

  if (
    Number.isNaN(replacementAt.getTime()) ||
    Number.isNaN(startupAt.getTime()) ||
    startupAt < replacementAt
  ) {
    return jsonResponse({ ok: false, message: "기동일은 최근 V-Belt 교체일보다 빠를 수 없습니다." }, 400);
  }

  if (startupAt > futureLimit) {
    return jsonResponse({ ok: false, message: "기동일은 현재 이후로 등록할 수 없습니다." }, 400);
  }

  const latestRuntimeBoundary = await loadLatestExplicitRuntimeBoundary(database, asset);
  const latestRuntimeBoundaryAt = new Date(latestRuntimeBoundary?.event_date);
  if (
    latestRuntimeBoundary &&
    !Number.isNaN(latestRuntimeBoundaryAt.getTime()) &&
    startupAt < latestRuntimeBoundaryAt
  ) {
    return jsonResponse({
      ok: false,
      message: "기동일은 현재 Cycle에 보존된 최신 정지·상태보정 시각보다 빠를 수 없습니다."
    }, 400);
  }

  const note = normalizeText(body.note);
  const sourceType = normalizeText(source.sourceType) || "manual";
  const sourceLogId = normalizeText(source.sourceLogId);
  const sourceText = normalizeText(source.sourceText).slice(0, 2000);
  const startupActionType = normalizeText(source.actionType) || "기동";
  const now = new Date().toISOString();
  const currentCycleRevision = normalizeText(asset.cycle_start_revision);
  const nextCycleRevision = crypto.randomUUID();
  const nextCycleRuntimeRevision = crypto.randomUUID();
  const startupEventId = normalizeText(source.eventId) || crypto.randomUUID();
  const results = await database.batch([
    database
      .prepare(`
        UPDATE blower_history_assets
        SET
          cycle_started_at = ?,
          cycle_start_state = 'started',
          cycle_start_revision = ?,
          cycle_runtime_hours = 0,
          cycle_runtime_anchor_at = ?,
          cycle_runtime_state = 'running',
          cycle_runtime_revision = ?,
          runtime_hours = 0,
          runtime_anchor_at = ?,
          is_running = 1,
          last_modified_by_id = ?,
          last_modified_by_name = ?,
          updated_at = ?
        WHERE tag_number = ?
          AND cycle_start_state = 'pending'
          AND cycle_start_revision = ?
          AND last_replacement_at = ?
      `)
      .bind(
        eventDate,
        nextCycleRevision,
        eventDate,
        nextCycleRuntimeRevision,
        eventDate,
        user.employeeNo,
        user.name,
        now,
        tagNumber,
        currentCycleRevision,
        currentLastReplacementAt
      ),
    database
      .prepare(`
        INSERT INTO blower_history_events (
          id, tag_number, event_type, event_date, runtime_hours,
          issue_type, action_type, note, source_type, source_log_id,
          source_text, created_by_id, created_by_name, created_at, updated_at
        )
        SELECT ?, ?, 'startup', ?, 0, '', ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM blower_history_assets
          WHERE tag_number = ?
            AND cycle_start_state = 'started'
            AND cycle_start_revision = ?
            AND last_replacement_at = ?
        )
      `)
      .bind(
        startupEventId,
        tagNumber,
        eventDate,
        startupActionType,
        note,
        sourceType,
        sourceLogId,
        sourceText,
        user.employeeNo,
        user.name,
        now,
        now,
        tagNumber,
        nextCycleRevision,
        currentLastReplacementAt
      )
  ]);

  if (Number(results?.[0]?.meta?.changes || 0) === 0) {
    return jsonResponse({ ok: false, message: "기동 상태가 이미 변경되었습니다. 새로고침 후 확인해 주세요." }, 409);
  }

  if (Number(results?.[1]?.meta?.changes || 0) !== 1) {
    throw new Error("기동 상태와 기동 이력을 함께 저장하지 못했습니다.");
  }

  return jsonResponse({
    ok: true,
    message: "실제 기동을 등록했습니다. 이 시점부터 Cycle 계산을 시작합니다."
  });
}

async function registerProblem(database, user, body, source = {}) {
  const tagNumber = normalizeText(body.tagNumber).toUpperCase();
  const asset = await findAsset(database, tagNumber);

  if (!asset) {
    return jsonResponse({ ok: false, message: "등록된 Blower TAG를 찾을 수 없습니다." }, 404);
  }

  const eventDate = normalizeDateTime(body.eventDate || body.date);

  if (!eventDate) {
    return jsonResponse({ ok: false, message: "문제 발생일을 확인해 주세요." }, 400);
  }

  const runtimeHours = eventRuntimeHoursAt(asset, eventDate);
  const issueType = normalizeText(body.issueType) || "기타";
  const actionType = normalizeText(body.actionType) || "확인";

  await insertEvent(database, user, {
    tagNumber,
    eventType: "problem",
    eventDate,
    runtimeHours,
    issueType,
    actionType,
    note: normalizeText(body.note),
    sourceType: source.sourceType || "manual",
    sourceLogId: source.sourceLogId || "",
    sourceText: source.sourceText || ""
  });

  return jsonResponse({
    ok: true,
    message: "문제 발생 이력을 등록했습니다. 교체 Cycle은 유지됩니다."
  });
}

async function loadLatestExplicitRuntimeBoundary(database, asset) {
  const lastReplacementAt = normalizeText(asset?.last_replacement_at);
  if (!lastReplacementAt) return null;

  return database
    .prepare(`
      SELECT *
      FROM blower_history_events
      WHERE tag_number = ?
        AND event_type IN ('startup', 'operation_start', 'operation_stop', 'runtime_correction')
        AND datetime(event_date) >= datetime(?)
      ORDER BY datetime(event_date) DESC, created_at DESC, id DESC
      LIMIT 1
    `)
    .bind(asset.tag_number, lastReplacementAt)
    .first();
}

function runtimeBoundaryState(event) {
  const eventType = normalizeText(event?.event_type);
  if (["startup", "operation_start"].includes(eventType)) return "running";
  if (eventType === "operation_stop") return "stopped";
  if (eventType !== "runtime_correction") return "";
  return /(?:정지|stop)/i.test(normalizeText(event?.action_type)) ? "stopped" : "running";
}

async function loadPreviousExplicitRuntimeBoundary(database, asset, selectedEvent) {
  const boundaries = await loadPreviousExplicitRuntimeBoundaries(database, asset, selectedEvent);
  return boundaries[0] || null;
}

async function loadPreviousExplicitRuntimeBoundaries(database, asset, selectedEvent) {
  const lastReplacementAt = normalizeText(asset?.last_replacement_at);
  if (!lastReplacementAt || !selectedEvent) return [];

  const result = await database
    .prepare(`
      SELECT *
      FROM blower_history_events
      WHERE tag_number = ?
        AND event_type IN ('startup', 'operation_start', 'operation_stop', 'runtime_correction')
        AND datetime(event_date) >= datetime(?)
        AND id <> ?
        AND (
          datetime(event_date) < datetime(?)
          OR (
            datetime(event_date) = datetime(?)
            AND (
              created_at < ?
              OR (created_at = ? AND id < ?)
            )
          )
        )
      ORDER BY datetime(event_date) DESC, created_at DESC, id DESC
    `)
    .bind(
      asset.tag_number,
      lastReplacementAt,
      selectedEvent.id,
      selectedEvent.event_date,
      selectedEvent.event_date,
      selectedEvent.created_at,
      selectedEvent.created_at,
      selectedEvent.id
    )
    .all();

  return Array.isArray(result.results) ? result.results : [];
}

async function editLatestRuntimeBoundary(database, user, body) {
  const tagNumber = normalizeText(body.tagNumber).toUpperCase();
  const eventId = normalizeText(body.eventId);
  const expectedEventUpdatedAt = normalizeText(body.expectedEventUpdatedAt);
  const expectedRuntimeRevision = normalizeText(body.expectedCycleRuntimeRevision);
  const expectedLastReplacementAt = normalizeText(body.expectedLastReplacementAt);
  const resetToStartupPending = body.resetToStartupPending === true;
  const confirmRuntimeBoundaryOverride = body.confirmRuntimeBoundaryOverride === true;
  const asset = await findAsset(database, tagNumber);

  if (!asset) {
    return jsonResponse({ ok: false, message: "등록된 Blower TAG를 찾을 수 없습니다." }, 404);
  }

  if (!eventId || !expectedEventUpdatedAt || !expectedRuntimeRevision || !expectedLastReplacementAt) {
    return jsonResponse({ ok: false, message: "수정할 운전상태 이력 정보를 확인해 주세요." }, 400);
  }

  if (
    expectedRuntimeRevision !== normalizeText(asset.cycle_runtime_revision) ||
    expectedLastReplacementAt !== normalizeText(asset.last_replacement_at)
  ) {
    return jsonResponse({ ok: false, message: "교체 또는 운전상태 이력이 변경되었습니다. 새로고침 후 다시 수정해 주세요." }, 409);
  }

  const selectedEvent = await database
    .prepare(`
      SELECT *
      FROM blower_history_events
      WHERE id = ? AND tag_number = ?
      LIMIT 1
    `)
    .bind(eventId, tagNumber)
    .first();

  if (!selectedEvent) {
    return jsonResponse({ ok: false, message: "수정할 운전상태 이력을 찾을 수 없습니다." }, 404);
  }

  if (
    !["operation_start", "operation_stop"].includes(normalizeText(selectedEvent.event_type)) ||
    normalizeText(selectedEvent.source_type) !== "manual"
  ) {
    return jsonResponse({ ok: false, message: "수동으로 등록한 최신 정지·재기동 이력만 수정할 수 있습니다." }, 409);
  }

  if (normalizeText(selectedEvent.updated_at) !== expectedEventUpdatedAt) {
    return jsonResponse({ ok: false, message: "이 운전상태 이력이 먼저 수정되었습니다. 새로고침 후 다시 확인해 주세요." }, 409);
  }

  const latestBoundary = await loadLatestExplicitRuntimeBoundary(database, asset);
  if (!latestBoundary || normalizeText(latestBoundary.id) !== eventId) {
    return jsonResponse({ ok: false, message: "이후 운전상태 또는 누적시간 이력이 있어 최신 이력만 수정할 수 있습니다." }, 409);
  }

  const eventType = normalizeText(selectedEvent.event_type);
  const cycleStartState = normalizeText(asset.cycle_start_state) || "legacy";
  if (cycleStartState === "pending") {
    return jsonResponse({
      ok: false,
      message: "이미 교체 당시 정지·누적 0시간으로 정정된 Cycle입니다. 다음 기동 등록 전에는 이력을 다시 수정할 수 없습니다."
    }, 409);
  }
  const expectedState = eventType === "operation_stop" ? "stopped" : "running";
  const currentState = normalizeText(asset.cycle_runtime_state);
  if (currentState !== expectedState) {
    return jsonResponse({ ok: false, message: "현재 운전상태와 선택한 이력이 일치하지 않습니다. 새로고침 후 확인해 주세요." }, 409);
  }

  const oldEventAt = new Date(selectedEvent.event_date);
  const currentAnchorAt = new Date(asset.cycle_runtime_anchor_at);
  if (
    Number.isNaN(oldEventAt.getTime()) ||
    Number.isNaN(currentAnchorAt.getTime()) ||
    oldEventAt.getTime() !== currentAnchorAt.getTime()
  ) {
    return jsonResponse({ ok: false, message: "현재 Cycle 기준시각과 선택한 이력이 일치하지 않습니다." }, 409);
  }

  const previousBoundaries = await loadPreviousExplicitRuntimeBoundaries(database, asset, selectedEvent);
  const previousBoundary = previousBoundaries[0] || null;
  const previousState = runtimeBoundaryState(previousBoundary);
  const hasRunningBoundary = previousBoundaries.some(boundary => runtimeBoundaryState(boundary) === "running");
  const cycleStartRevision = normalizeText(asset.cycle_start_revision);
  const replacementAt = new Date(asset.last_replacement_at);
  const cycleStartedAt = new Date(
    cycleStartState === "started"
      ? (normalizeText(asset.cycle_started_at) || asset.last_replacement_at)
      : asset.last_replacement_at
  );
  const requestedEventDate = resetToStartupPending
    ? (previousBoundary
      ? normalizeDateTime(selectedEvent.event_date)
      : normalizeDateTime(asset.last_replacement_at))
    : normalizeDateTime(body.eventDate || body.date);
  const requestedEventAt = new Date(requestedEventDate);

  if (!requestedEventDate || Number.isNaN(requestedEventAt.getTime())) {
    return jsonResponse({ ok: false, message: "수정할 한국시간을 확인해 주세요." }, 400);
  }

  if (requestedEventAt > new Date(Date.now() + 5 * 60000)) {
    return jsonResponse({ ok: false, message: "수정할 시각은 현재 이후로 지정할 수 없습니다." }, 400);
  }

  const canRestoreStartupPending = (
    eventType === "operation_stop" &&
    cycleStartState !== "pending"
  );
  const canInferStartupPendingFromDate = (
    canRestoreStartupPending &&
    cycleStartState === "legacy" &&
    !previousBoundary
  );
  const beforeReplacement = !Number.isNaN(replacementAt.getTime()) && requestedEventAt < replacementAt;
  const restoreStartupPending = canRestoreStartupPending && (
    resetToStartupPending ||
    (canInferStartupPendingFromDate && (
      beforeReplacement ||
      requestedEventAt.getTime() === replacementAt.getTime()
    ))
  );

  if (resetToStartupPending && !canRestoreStartupPending) {
    return jsonResponse({
      ok: false,
      message: "현재 Cycle 상태에서는 교체 후 미기동·0시간 복원을 실행할 수 없습니다."
    }, 409);
  }

  if (resetToStartupPending && hasRunningBoundary && !confirmRuntimeBoundaryOverride) {
    return jsonResponse({
      ok: false,
      code: "RUNTIME_RESET_OVERRIDE_CONFIRMATION_REQUIRED",
      message: "최근 교체 후 기동·재기동 또는 운전중 보정 이력이 있습니다. 해당 기록을 감사이력에 보존한 채 현재 Cycle을 미기동·0시간으로 복원하려면 다시 확인해 주세요."
    }, 409);
  }

  if (
    resetToStartupPending &&
    Math.abs(Number(selectedEvent.runtime_hours) - Number(asset.cycle_runtime_hours)) > 0.05
  ) {
    return jsonResponse({
      ok: false,
      message: "선택한 정지 이력의 누적시간과 현재 Cycle이 일치하지 않습니다. 새로고침 후 다시 확인해 주세요."
    }, 409);
  }

  if (beforeReplacement && !restoreStartupPending) {
    return jsonResponse({ ok: false, message: "수정 시각은 최근 V-Belt 교체일보다 빠를 수 없습니다." }, 400);
  }

  const firstCycleStartupEdit = (
    eventType === "operation_start" &&
    !previousBoundary &&
    cycleStartState === "started" &&
    Math.abs(Number(selectedEvent.runtime_hours)) < 0.000001
  );
  const minimumBoundaryAt = previousBoundary
    ? new Date(previousBoundary.event_date)
    : (firstCycleStartupEdit ? replacementAt : cycleStartedAt);
  if (
    !restoreStartupPending &&
    !Number.isNaN(minimumBoundaryAt.getTime()) &&
    requestedEventAt < minimumBoundaryAt
  ) {
    return jsonResponse({
      ok: false,
      message: previousBoundary
        ? "수정 시각은 직전 운전상태 이력보다 빠를 수 없습니다."
        : "수정 시각은 현재 V-Belt Cycle 시작보다 빠를 수 없습니다."
    }, 400);
  }

  if (
    !restoreStartupPending &&
    eventType === "operation_stop" &&
    previousBoundary &&
    previousState !== "running"
  ) {
    return jsonResponse({ ok: false, message: "직전 이력이 운전중 상태가 아니어서 정지시각을 다시 계산할 수 없습니다." }, 409);
  }

  if (
    !restoreStartupPending &&
    eventType === "operation_start" &&
    previousBoundary &&
    previousState !== "stopped"
  ) {
    return jsonResponse({ ok: false, message: "직전 이력이 정지 상태가 아니어서 재기동시각을 수정할 수 없습니다." }, 409);
  }

  let revisedHours;
  if (restoreStartupPending) {
    revisedHours = 0;
  } else if (eventType === "operation_start") {
    revisedHours = Number(selectedEvent.runtime_hours);
  } else {
    const baseAt = previousBoundary ? new Date(previousBoundary.event_date) : cycleStartedAt;
    const baseHours = previousBoundary ? Number(previousBoundary.runtime_hours) : 0;
    revisedHours = Number.isFinite(baseHours) && !Number.isNaN(baseAt.getTime())
      ? Math.max(0, baseHours + ((requestedEventAt.getTime() - baseAt.getTime()) / 3600000))
      : null;
  }

  if (!Number.isFinite(revisedHours)) {
    return jsonResponse({ ok: false, message: "수정 후 누적 운전시간을 계산하지 못했습니다." }, 409);
  }

  const now = new Date().toISOString();
  const nextRuntimeRevision = crypto.randomUUID();
  const nextCycleStartRevision = restoreStartupPending ? crypto.randomUUID() : cycleStartRevision;
  const nextCycleStartState = restoreStartupPending ? "pending" : cycleStartState;
  const nextCycleStartedAt = restoreStartupPending
    ? null
    : (firstCycleStartupEdit ? requestedEventDate : asset.cycle_started_at);
  const nextActionType = restoreStartupPending
    ? (resetToStartupPending && previousBoundary
      ? "교체 후 미기동 · 0시간 정정"
      : (beforeReplacement ? "교체 전 정지 지속" : "교체 당시 정지"))
    : normalizeText(selectedEvent.action_type);
  const nextNote = normalizeText(body.note);
  const nextRuntimeAnchorAt = restoreStartupPending
    ? normalizeDateTime(asset.last_replacement_at)
    : requestedEventDate;
  const beforeJson = JSON.stringify({
    eventId,
    eventType,
    eventDate: normalizeText(selectedEvent.event_date),
    runtimeHours: Number(selectedEvent.runtime_hours),
    actionType: normalizeText(selectedEvent.action_type),
    note: normalizeText(selectedEvent.note),
    cycleStartState,
    cycleRuntimeHours: Number(asset.cycle_runtime_hours),
    cycleRuntimeAnchorAt: normalizeText(asset.cycle_runtime_anchor_at),
    cycleRuntimeState: currentState,
    previousRuntimeBoundaries: previousBoundaries.map(boundary => ({
      id: normalizeText(boundary.id),
      eventType: normalizeText(boundary.event_type),
      eventDate: normalizeText(boundary.event_date),
      runtimeHours: Number(boundary.runtime_hours),
      actionType: normalizeText(boundary.action_type),
      sourceType: normalizeText(boundary.source_type)
    }))
  });
  const afterJson = JSON.stringify({
    eventId,
    eventType,
    eventDate: requestedEventDate,
    runtimeHours: revisedHours,
    actionType: nextActionType,
    note: nextNote,
    cycleStartState: nextCycleStartState,
    cycleRuntimeHours: revisedHours,
    cycleRuntimeAnchorAt: nextRuntimeAnchorAt,
    cycleRuntimeState: currentState
  });
  const auditId = crypto.randomUUID();
  const guardId = crypto.randomUUID();
  const skipLatestBoundaryGuard = restoreStartupPending && beforeReplacement ? 1 : 0;
  let results;

  try {
    results = await database.batch([
      database
      .prepare(`
        UPDATE blower_history_assets
        SET
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
          last_modified_by_id = ?,
          last_modified_by_name = ?,
          updated_at = ?
        WHERE tag_number = ?
          AND enabled = 1
          AND cycle_start_state = ?
          AND cycle_start_revision = ?
          AND cycle_runtime_state = ?
          AND cycle_runtime_revision = ?
          AND last_replacement_at = ?
          AND cycle_runtime_anchor_at = ?
          AND EXISTS (
            SELECT 1 FROM blower_history_events
            WHERE id = ?
              AND tag_number = ?
              AND event_type = ?
              AND source_type = 'manual'
              AND event_date = ?
              AND updated_at = ?
          )
          AND ? = (
            SELECT id
            FROM blower_history_events
            WHERE tag_number = ?
              AND event_type IN ('startup', 'operation_start', 'operation_stop', 'runtime_correction')
              AND datetime(event_date) >= datetime(?)
            ORDER BY datetime(event_date) DESC, created_at DESC, id DESC
            LIMIT 1
          )
      `)
      .bind(
        nextCycleStartedAt,
        nextCycleStartState,
        nextCycleStartRevision,
        revisedHours,
        nextRuntimeAnchorAt,
        currentState,
        nextRuntimeRevision,
        revisedHours,
        currentState === "running" ? requestedEventDate : null,
        currentState === "running" ? 1 : 0,
        user.employeeNo,
        user.name,
        now,
        tagNumber,
        cycleStartState,
        cycleStartRevision,
        currentState,
        expectedRuntimeRevision,
        expectedLastReplacementAt,
        selectedEvent.event_date,
        eventId,
        tagNumber,
        eventType,
        selectedEvent.event_date,
        expectedEventUpdatedAt,
        eventId,
        tagNumber,
        expectedLastReplacementAt
      ),
      database
      .prepare(`
        UPDATE blower_history_events
        SET event_date = ?, runtime_hours = ?, action_type = ?, note = ?, updated_at = ?
        WHERE id = ?
          AND tag_number = ?
          AND event_type = ?
          AND source_type = 'manual'
          AND event_date = ?
          AND updated_at = ?
          AND EXISTS (
            SELECT 1 FROM blower_history_assets
            WHERE tag_number = ? AND cycle_runtime_revision = ?
          )
      `)
      .bind(
        requestedEventDate,
        revisedHours,
        nextActionType,
        nextNote,
        now,
        eventId,
        tagNumber,
        eventType,
        selectedEvent.event_date,
        expectedEventUpdatedAt,
        tagNumber,
        nextRuntimeRevision
      ),
      database
      .prepare(`
        INSERT INTO blower_history_asset_history (
          id, action_type, tag_number, before_json, after_json, change_note,
          changed_by_id, changed_by_name, changed_at
        )
        SELECT ?, 'runtime_event_edit', ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM blower_history_assets
          WHERE tag_number = ? AND cycle_runtime_revision = ?
        )
          AND EXISTS (
            SELECT 1 FROM blower_history_events
            WHERE id = ? AND updated_at = ?
          )
      `)
      .bind(
        auditId,
        tagNumber,
        beforeJson,
        afterJson,
        normalizeText(body.changeNote) || "운전상태 이력 시각 수정",
        user.employeeNo,
        user.name,
        now,
        tagNumber,
        nextRuntimeRevision,
        eventId,
        now
      ),
      database
        .prepare(`
          INSERT INTO blower_history_atomic_guard (id, valid)
          VALUES (
            ?,
            CASE WHEN
              EXISTS (
                SELECT 1 FROM blower_history_assets
                WHERE tag_number = ?
                  AND cycle_runtime_revision = ?
                  AND cycle_start_state = ?
                  AND COALESCE(cycle_started_at, '') = COALESCE(?, '')
                  AND ABS(COALESCE(cycle_runtime_hours, 0) - ?) < 0.000001
                  AND cycle_runtime_anchor_at = ?
                  AND cycle_runtime_state = ?
                  AND ABS(COALESCE(runtime_hours, 0) - ?) < 0.000001
                  AND COALESCE(runtime_anchor_at, '') = COALESCE(?, '')
                  AND is_running = ?
              )
              AND EXISTS (
                SELECT 1 FROM blower_history_events
                WHERE id = ?
                  AND event_date = ?
                  AND ABS(COALESCE(runtime_hours, 0) - ?) < 0.000001
                  AND action_type = ?
                  AND note = ?
                  AND updated_at = ?
              )
              AND EXISTS (
                SELECT 1 FROM blower_history_asset_history
                WHERE id = ?
              )
              AND (
                ? = 1
                OR ? = (
                  SELECT id
                  FROM blower_history_events
                  WHERE tag_number = ?
                    AND event_type IN ('startup', 'operation_start', 'operation_stop', 'runtime_correction')
                    AND datetime(event_date) >= datetime(?)
                  ORDER BY datetime(event_date) DESC, created_at DESC, id DESC
                  LIMIT 1
                )
              )
            THEN 1 ELSE 0 END
          )
        `)
        .bind(
          guardId,
          tagNumber,
          nextRuntimeRevision,
          nextCycleStartState,
          nextCycleStartedAt,
          revisedHours,
          nextRuntimeAnchorAt,
          currentState,
          revisedHours,
          currentState === "running" ? requestedEventDate : null,
          currentState === "running" ? 1 : 0,
          eventId,
          requestedEventDate,
          revisedHours,
          nextActionType,
          nextNote,
          now,
          auditId,
          skipLatestBoundaryGuard,
          eventId,
          tagNumber,
          expectedLastReplacementAt
        ),
      database
        .prepare(`DELETE FROM blower_history_atomic_guard WHERE id = ?`)
        .bind(guardId)
    ]);
  } catch (error) {
    if (/CHECK constraint failed(?:: valid = 1|.*blower_history_atomic_guard)/i.test(String(error?.message || error))) {
      return jsonResponse({ ok: false, message: "이력이 동시에 변경되었습니다. 새로고침 후 다시 수정해 주세요." }, 409);
    }
    throw error;
  }

  if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
    return jsonResponse({ ok: false, message: "Cycle 상태가 먼저 변경되었습니다. 새로고침 후 다시 수정해 주세요." }, 409);
  }
  if (Number(results?.[1]?.meta?.changes || 0) !== 1) {
    throw new Error("운전상태 이력 시각을 함께 수정하지 못했습니다.");
  }
  if (Number(results?.[2]?.meta?.changes || 0) !== 1) {
    throw new Error("운전상태 이력 수정 감사기록을 저장하지 못했습니다.");
  }
  if (
    Number(results?.[3]?.meta?.changes || 0) !== 1 ||
    Number(results?.[4]?.meta?.changes || 0) !== 1
  ) {
    throw new Error("운전상태 이력 수정 원자성 검증을 완료하지 못했습니다.");
  }

  return jsonResponse({
    ok: true,
    message: restoreStartupPending
      ? "교체 당시부터 정지 상태로 바로잡았습니다. 현재 Cycle은 기동 대기·누적 0시간입니다."
      : eventType === "operation_stop"
        ? `정지시각을 수정하고 누적 운전시간을 ${revisedHours.toFixed(1)}시간으로 다시 계산했습니다.`
        : "재기동시각을 수정했습니다. 수정한 시각부터 Cycle 계산을 이어갑니다."
  });
}

async function changeRuntimeState(database, user, body, source = {}) {
  const tagNumber = normalizeText(body.tagNumber).toUpperCase();
  const asset = await findAsset(database, tagNumber);

  if (!asset) {
    return jsonResponse({ ok: false, message: "등록된 Blower TAG를 찾을 수 없습니다." }, 404);
  }

  if (!normalizeText(asset.last_replacement_at)) {
    return jsonResponse({ ok: false, message: "먼저 V-Belt 교체 이력을 등록해 주세요." }, 409);
  }

  if (normalizeText(asset.cycle_start_state) === "pending") {
    return jsonResponse({ ok: false, message: "기동 대기 Cycle은 [기동 등록]으로 시작해 주세요." }, 409);
  }

  const storedCycleHours = Number(asset.cycle_runtime_hours);
  const cycleStartState = normalizeText(asset.cycle_start_state) || "legacy";
  const cycleStartRevision = normalizeText(asset.cycle_start_revision);
  const currentState = normalizeText(asset.cycle_runtime_state);
  const currentRevision = normalizeText(asset.cycle_runtime_revision);
  const expectedRevision = normalizeText(body.expectedCycleRuntimeRevision);

  if (
    !Number.isFinite(storedCycleHours) ||
    !["running", "stopped"].includes(currentState) ||
    !currentRevision
  ) {
    return jsonResponse({ ok: false, message: "Cycle 운전상태를 준비 중입니다. 새로고침 후 다시 시도해 주세요." }, 409);
  }

  if (!expectedRevision || expectedRevision !== currentRevision) {
    return jsonResponse({ ok: false, message: "Cycle 상태가 변경되었습니다. 새로고침 후 다시 등록해 주세요." }, 409);
  }

  if (typeof body.isRunning !== "boolean") {
    return jsonResponse({ ok: false, message: "변경할 운전상태를 확인해 주세요." }, 400);
  }

  const targetState = body.isRunning ? "running" : "stopped";
  if (targetState === currentState) {
    return jsonResponse({
      ok: false,
      message: targetState === "running" ? "이미 운전중입니다." : "이미 정지 상태입니다."
    }, 409);
  }

  const eventDate = normalizeDateTime(body.eventDate || body.date);
  if (!eventDate) {
    return jsonResponse({ ok: false, message: "상태 변경일시를 확인해 주세요." }, 400);
  }

  const eventAt = new Date(eventDate);
  const anchorAt = new Date(asset.cycle_runtime_anchor_at);
  const replacementAt = new Date(asset.last_replacement_at);
  const cycleStartedAt = new Date(
    cycleStartState === "started"
      ? (normalizeText(asset.cycle_started_at) || asset.last_replacement_at)
      : asset.last_replacement_at
  );
  const futureLimit = new Date(Date.now() + 5 * 60000);

  if (Number.isNaN(eventAt.getTime()) || eventAt > futureLimit) {
    return jsonResponse({ ok: false, message: "상태 변경일시는 현재 이후로 등록할 수 없습니다." }, 400);
  }

  const latestBoundary = await loadLatestExplicitRuntimeBoundary(database, asset);
  const latestBoundaryAt = new Date(latestBoundary?.event_date);
  const hasExplicitBoundary = Boolean(latestBoundary) && !Number.isNaN(latestBoundaryAt.getTime());
  const beforeReplacement = !Number.isNaN(replacementAt.getTime()) && eventAt < replacementAt;
  const initialCycleCorrection = body.initialCycleCorrection === true;
  const canRestorePreReplacementStop = (
    beforeReplacement &&
    targetState === "stopped" &&
    initialCycleCorrection &&
    cycleStartState === "legacy" &&
    !hasExplicitBoundary
  );

  if (initialCycleCorrection && !canRestorePreReplacementStop) {
    return jsonResponse({
      ok: false,
      code: "INITIAL_CYCLE_CORRECTION_NOT_ALLOWED",
      message: "현재 Cycle에는 이미 기동·정지 또는 누적시간 보정 이력이 있어 교체 후 미기동 상태로 정정할 수 없습니다."
    }, 409);
  }

  if (beforeReplacement && !canRestorePreReplacementStop) {
    return jsonResponse({
      ok: false,
      code: targetState === "stopped" ? "INITIAL_CYCLE_CORRECTION_REQUIRED" : "PRE_REPLACEMENT_RUNTIME_STATE",
      message: targetState === "stopped"
        ? "이 정지는 최근 교체 전입니다. 교체 당시 이미 정지 중이었다면 기동 대기 상태로 정정해 주세요."
        : "상태 변경일시는 최근 V-Belt 교체일보다 빠를 수 없습니다."
    }, targetState === "stopped" ? 409 : 400);
  }

  const minimumBoundaryAt = hasExplicitBoundary ? latestBoundaryAt : cycleStartedAt;
  if (
    !canRestorePreReplacementStop &&
    !Number.isNaN(minimumBoundaryAt.getTime()) &&
    eventAt < minimumBoundaryAt
  ) {
    return jsonResponse({
      ok: false,
      message: hasExplicitBoundary
        ? "상태 변경일시는 직전 기동·정지 시각보다 빠를 수 없습니다."
        : "상태 변경일시는 현재 V-Belt Cycle 시작 시각보다 빠를 수 없습니다."
    }, 400);
  }

  const historicalInitialStop = (
    targetState === "stopped" &&
    !canRestorePreReplacementStop &&
    !Number.isNaN(anchorAt.getTime()) &&
    eventAt < anchorAt
  );
  let elapsedHours;

  if (canRestorePreReplacementStop) {
    elapsedHours = 0;
  } else if (historicalInitialStop) {
    const boundaryHours = hasExplicitBoundary ? Number(latestBoundary.runtime_hours) : 0;
    const boundaryAt = hasExplicitBoundary ? latestBoundaryAt : cycleStartedAt;
    elapsedHours = Number.isFinite(boundaryHours) && !Number.isNaN(boundaryAt.getTime())
      ? Math.max(0, boundaryHours + ((eventAt.getTime() - boundaryAt.getTime()) / 3600000))
      : null;
  } else {
    elapsedHours = cycleRuntimeHoursAt(asset, eventAt);
  }

  if (!Number.isFinite(elapsedHours)) {
    return jsonResponse({ ok: false, message: "누적 운전시간을 계산하지 못했습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  }

  const now = new Date().toISOString();
  const nextRevision = crypto.randomUUID();
  const nextCycleStartRevision = canRestorePreReplacementStop
    ? crypto.randomUUID()
    : cycleStartRevision;
  const eventId = normalizeText(source.eventId) || crypto.randomUUID();
  const eventType = targetState === "running" ? "operation_start" : "operation_stop";
  const defaultActionType = targetState === "running"
    ? "재기동"
    : (canRestorePreReplacementStop
      ? "교체 전 정지 지속"
      : (historicalInitialStop ? "초기 정지시각 정정" : "정지"));
  const actionType = normalizeText(source.actionType) || defaultActionType;
  const sourceType = normalizeText(source.sourceType) || "manual";
  const sourceLogId = normalizeText(source.sourceLogId);
  const sourceText = normalizeText(source.sourceText).slice(0, 2000);
  const note = normalizeText(body.note) || (canRestorePreReplacementStop
    ? "최근 V-Belt 교체 전부터 정지 상태였으며 교체 후 아직 기동하지 않음"
    : (historicalInitialStop ? "V9 적용 전 실제 정지시각 반영" : ""));
  const nextCycleStartState = canRestorePreReplacementStop ? "pending" : cycleStartState;
  const results = await database.batch([
    database
      .prepare(`
        UPDATE blower_history_assets
        SET
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
          last_modified_by_id = ?,
          last_modified_by_name = ?,
          updated_at = ?
        WHERE tag_number = ?
          AND enabled = 1
          AND cycle_start_state = ?
          AND cycle_start_revision = ?
          AND cycle_runtime_state = ?
          AND cycle_runtime_revision = ?
          AND last_replacement_at = ?
      `)
      .bind(
        canRestorePreReplacementStop ? null : asset.cycle_started_at,
        nextCycleStartState,
        nextCycleStartRevision,
        elapsedHours,
        eventDate,
        targetState,
        nextRevision,
        elapsedHours,
        targetState === "running" ? eventDate : null,
        targetState === "running" ? 1 : 0,
        user.employeeNo,
        user.name,
        now,
        tagNumber,
        cycleStartState,
        cycleStartRevision,
        currentState,
        currentRevision,
        asset.last_replacement_at
      ),
    database
      .prepare(`
        INSERT INTO blower_history_events (
          id, tag_number, event_type, event_date, runtime_hours,
          issue_type, action_type, note, source_type, source_log_id,
          source_text, created_by_id, created_by_name, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM blower_history_assets
          WHERE tag_number = ?
            AND cycle_start_state = ?
            AND cycle_start_revision = ?
            AND cycle_runtime_state = ?
            AND cycle_runtime_revision = ?
            AND last_replacement_at = ?
        )
      `)
      .bind(
        eventId,
        tagNumber,
        eventType,
        eventDate,
        elapsedHours,
        actionType,
        note,
        sourceType,
        sourceLogId,
        sourceText,
        user.employeeNo,
        user.name,
        now,
        now,
        tagNumber,
        nextCycleStartState,
        nextCycleStartRevision,
        targetState,
        nextRevision,
        asset.last_replacement_at
      )
  ]);

  if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
    return jsonResponse({ ok: false, message: "Cycle 상태가 이미 변경되었습니다. 새로고침 후 확인해 주세요." }, 409);
  }

  if (Number(results?.[1]?.meta?.changes || 0) !== 1) {
    throw new Error("운전상태와 변경 이력을 함께 저장하지 못했습니다.");
  }

  return jsonResponse({
    ok: true,
    message: canRestorePreReplacementStop
      ? "교체 전부터 정지 중이었던 상태를 반영했습니다. 현재 V-Belt Cycle은 기동 대기·누적 0시간입니다."
      : historicalInitialStop
        ? "V9 적용 전 실제 정지시각을 반영했습니다. 해당 시각에서 Cycle 계산과 알림을 멈췄습니다."
        : targetState === "running"
          ? "재기동을 등록했습니다. 정지 전 누적시간부터 Cycle 계산을 다시 시작합니다."
          : "정지를 등록했습니다. 재기동 전까지 Cycle 경과·D-day·알림을 멈춥니다."
  });
}

async function correctRuntime(database, user, body) {
  const tagNumber = normalizeText(body.tagNumber).toUpperCase();
  const asset = await findAsset(database, tagNumber);

  if (!asset) {
    return jsonResponse({ ok: false, message: "등록된 Blower TAG를 찾을 수 없습니다." }, 404);
  }

  if (normalizeText(asset.cycle_start_state) === "pending") {
    return jsonResponse({ ok: false, message: "기동 대기 Cycle은 누적시간을 보정할 수 없습니다. 먼저 [기동 등록]을 완료해 주세요." }, 409);
  }

  if (!normalizeText(asset.last_replacement_at)) {
    return jsonResponse({ ok: false, message: "확정된 V-Belt 교체 이력이 없어 Cycle 누적시간을 보정할 수 없습니다." }, 409);
  }

  const runtimeHours = Number(body.runtimeHours);

  if (!Number.isFinite(runtimeHours) || runtimeHours < 0 || runtimeHours > 200000) {
    return jsonResponse({ ok: false, message: "누적 운전시간을 확인해 주세요." }, 400);
  }

  const now = new Date().toISOString();
  const cycleEligible = (
    Boolean(normalizeText(asset.last_replacement_at)) &&
    normalizeText(asset.cycle_start_state) !== "pending" &&
    asset.cycle_runtime_hours !== null &&
    asset.cycle_runtime_hours !== undefined &&
    asset.cycle_runtime_hours !== "" &&
    Number.isFinite(Number(asset.cycle_runtime_hours)) &&
    Boolean(normalizeText(asset.cycle_runtime_revision))
  );
  const isRunning = cycleEligible
    ? normalizeText(asset.cycle_runtime_state) === "running"
    : Number(asset.is_running) === 1;
  const currentRevision = normalizeText(asset.cycle_runtime_revision);
  const expectedRevision = normalizeText(body.expectedCycleRuntimeRevision);
  const nextRevision = cycleEligible ? crypto.randomUUID() : currentRevision;
  const eventId = crypto.randomUUID();

  if (!cycleEligible) {
    return jsonResponse({ ok: false, message: "Cycle 운전시간을 준비 중입니다. 새로고침 후 다시 보정해 주세요." }, 409);
  }

  if (!expectedRevision || expectedRevision !== currentRevision) {
    return jsonResponse({ ok: false, message: "Cycle 상태가 변경되었습니다. 새로고침 후 다시 보정해 주세요." }, 409);
  }

  const updateStatement = database
    .prepare(`
        UPDATE blower_history_assets
        SET
          runtime_hours = ?,
          runtime_anchor_at = ?,
          is_running = ?,
          cycle_runtime_hours = ?,
          cycle_runtime_anchor_at = ?,
          cycle_runtime_state = ?,
          cycle_runtime_revision = ?,
          last_modified_by_id = ?,
          last_modified_by_name = ?,
          updated_at = ?
        WHERE tag_number = ?
          AND enabled = 1
          AND cycle_start_state <> 'pending'
          AND cycle_runtime_revision = ?
      `)
    .bind(
      runtimeHours,
      isRunning ? now : null,
      isRunning ? 1 : 0,
      runtimeHours,
      now,
      isRunning ? "running" : "stopped",
      nextRevision,
      user.employeeNo,
      user.name,
      now,
      tagNumber,
      currentRevision
    );
  const results = await database.batch([
    updateStatement,
    database
      .prepare(`
        INSERT INTO blower_history_events (
          id, tag_number, event_type, event_date, runtime_hours,
          issue_type, action_type, note, source_type, source_log_id,
          source_text, created_by_id, created_by_name, created_at, updated_at
        )
        SELECT ?, ?, 'runtime_correction', ?, ?, '', ?, ?, 'manual', '', '', ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM blower_history_assets
          WHERE tag_number = ?
            AND cycle_runtime_revision = ?
        )
      `)
      .bind(
        eventId,
        tagNumber,
        now,
        runtimeHours,
        isRunning ? "운전중" : "정지",
        normalizeText(body.note),
        user.employeeNo,
        user.name,
        now,
        now,
        tagNumber,
        nextRevision
      )
  ]);

  if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
    return jsonResponse({ ok: false, message: "Cycle 상태가 이미 변경되었습니다. 새로고침 후 다시 보정해 주세요." }, 409);
  }

  if (Number(results?.[1]?.meta?.changes || 0) !== 1) {
    throw new Error("누적 운전시간과 보정 이력을 함께 저장하지 못했습니다.");
  }

  return jsonResponse({
    ok: true,
    message: "누적 운전시간을 보정했습니다. 현재 Cycle에도 같은 값을 반영했습니다."
  });
}


function normalizeDutyPosition(value) {
  const raw = normalizeText(value);

  if (!raw) return "";
  if (/파트장/i.test(raw)) return "PART_LEADER";

  const compact = raw
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]/g, "");

  if (["BCO1", "BCO2", "BO1", "BO2", "TGO", "TO"].includes(compact)) {
    return compact;
  }

  if (["PARTLEADER", "SHIFTLEADER"].includes(compact)) {
    return "PART_LEADER";
  }

  return compact;
}

function normalizeShiftKey(value) {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]/g, "");
}

function rolePriorityGroupKey(row, dutyPosition) {
  return [
    normalizeText(row?.work_date).slice(0, 10),
    normalizeShiftKey(row?.shift),
    normalizeDutyPosition(dutyPosition)
  ].join("::");
}

const CANONICAL_SHIFT_LOG_ENTRY_COLLECTIONS = [
  "entries",
  "tmEntries",
  "handoverEntries",
  "remarkEntries"
];

function isApprovedShiftLogRow(row, parsedLog) {
  return normalizeText(row?.status || parsedLog?.status) === "결재완료";
}

function normalizeCanonicalEvidence(value) {
  return normalizeText(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/^[\s]*(?:(?:[-*•▪◦‣]+)|(?:\d{1,3}[.)]))[\s]*/u, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeCanonicalEntryTime(value) {
  const match = normalizeText(value).match(/(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function fragmentSourceText(fragment) {
  if (fragment && typeof fragment === "object" && !Array.isArray(fragment)) {
    return normalizeText(fragment.sourceText);
  }

  return normalizeText(fragment);
}

function fragmentIdentityText(fragment) {
  if (fragment && typeof fragment === "object" && !Array.isArray(fragment)) {
    return normalizeText(fragment.identityText);
  }

  return "";
}

function fragmentSourceRole(fragment) {
  if (fragment && typeof fragment === "object" && !Array.isArray(fragment)) {
    return normalizeDutyPosition(fragment.sourceRole);
  }

  return "";
}

function fragmentSourceTime(fragment) {
  if (fragment && typeof fragment === "object" && !Array.isArray(fragment)) {
    return normalizeCanonicalEntryTime(fragment.sourceTime);
  }

  return normalizeCanonicalEntryTime(fragmentSourceText(fragment));
}

function fragmentAnalysisText(fragment) {
  return [fragmentIdentityText(fragment), fragmentSourceText(fragment)]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function fragmentHasIdentityConflict(fragment, assets = []) {
  if (fragment && typeof fragment === "object" && !Array.isArray(fragment)) {
    if (Object.prototype.hasOwnProperty.call(fragment, "identityConflict")) {
      return fragment.identityConflict === true;
    }
  }

  const identityTags = extractRecognizedBlowerTags(fragmentIdentityText(fragment), assets);
  const sourceTags = extractRecognizedBlowerTags(fragmentSourceText(fragment), assets);
  if (identityTags.length === 0 || sourceTags.length === 0) return false;
  return (
    identityTags.length !== sourceTags.length ||
    identityTags.some(tag => !sourceTags.includes(tag))
  );
}

function fragmentStableKey(fragment) {
  return [
    compactEquipmentText(fragmentIdentityText(fragment)),
    fragmentHasIdentityConflict(fragment) ? "identity-conflict" : "identity-ok",
    fragmentSourceRole(fragment),
    fragmentSourceTime(fragment),
    normalizeSimilarityText(fragmentSourceText(fragment))
  ].join("::");
}

function splitMixedAssetLine(value) {
  const line = normalizeText(value);
  if (!line) return [];

  const marker = [
    "#\\s*[ABC]\\b",
    "(?:104|204)(?:HHL(?:60AP|10AN)(?:611|621|631)|SDF01AN(?:001|002)|ETG30AN(?:601|602))",
    "104ETH03AN(?:601|602)",
    "(?:FBHE|SEAL\\s*POT|SEALPOT|유기성\\s*고형연료|FLY\\s*ASH\\s*(?:BAG\\s*FILTER|SILO))"
  ].join("|");
  const separator = new RegExp(`\\s*(?:/|,|→|➡|⇒)\\s*(?=${marker})`, "gi");
  const output = [];
  let start = 0;
  let match;

  while ((match = separator.exec(line)) !== null) {
    const prefix = line.slice(start, match.index).trim();
    const describesWork = /(?:v\s*[-/]?\s*belt|vbelt|belt|벨트|교체|교환)/i.test(prefix);

    if (!describesWork) continue;
    if (prefix) output.push(prefix);
    start = separator.lastIndex;
  }

  const tail = line.slice(start).trim();
  if (tail) output.push(tail);
  return output.length > 0 ? output : [line];
}

function splitEvidenceWorkSegments(value) {
  const fullEvidence = normalizeCanonicalEvidence(value);
  if (!fullEvidence) return [];

  const segments = fullEvidence
    .split(/\s*(?:->|=>|→|➡|⇒)\s*|\s+(?:[-–—]{1,3})\s+/g)
    .map(normalizeCanonicalEvidence)
    .filter(item => item.length >= 3);

  if (segments.length <= 1) {
    return [fullEvidence];
  }

  const fullTypes = detectBlowerTypes(fullEvidence);
  const fullPositions = detectPositionLabels(fullEvidence);
  const canStandAlone = segment => {
    if (!hasBeltReplacementPhrase(segment)) return false;
    if (!hasExplicitReplacementCompletion(segment)) return false;
    if (hasReplacementPlanContext(segment)) return false;
    if (hasReplacementExclusionContext(segment)) return false;
    if (hasBeltAccessoryReplacementPhrase(segment)) return false;

    if (fullTypes.length > 0 && detectBlowerTypes(segment).length === 0) {
      return false;
    }

    if (fullPositions.length > 0 && detectPositionLabels(segment).length === 0) {
      return false;
    }

    return true;
  };
  const hasStandaloneCompletion = segments.some(canStandAlone);
  const output = hasStandaloneCompletion
    ? segments
    : [...segments, fullEvidence];

  return [...new Set(output)];
}

function splitCanonicalEntryClauses(value) {
  const normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+(?=(?:[-*•▪◦‣]+\s+|\d{1,3}[.)]\s+|(?:[01]?\d|2[0-3]):[0-5]\d\s+))/g, "\n")
    .replace(/([.!?。])\s+(?=(?:[-*•▪◦‣]+|\d{1,3}[.)]|(?:[01]?\d|2[0-3]):[0-5]\d|#\s*[12ABC]))/g, "$1\n");

  const clauses = [];

  for (const rawLine of normalized.split(/\n|\||;|；/g)) {
    for (const line of splitMixedAssetLine(rawLine)) {
      for (const evidence of splitEvidenceWorkSegments(line)) {
        if (evidence.length >= 3 && evidence.length <= 2000) {
          clauses.push(evidence);
        }
      }
    }
  }

  return clauses;
}

function collectCanonicalShiftLogFragments(parsedLog, row, assets = []) {
  const fragments = [];
  const usedEntries = new Set();
  const usedFragments = new Set();

  const appendEntry = (rawEntry, collectionName, entryIndex) => {
      const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)
        ? rawEntry
        : { content: String(rawEntry || "") };
      const content = normalizeText(
        entry.content ||
        entry.text ||
        entry.description ||
        entry.value ||
        entry.note ||
        entry.remark ||
        entry.remarks
      );

      if (!content) return;

      const sourceType = normalizeText(entry.source).toLowerCase();
      if (sourceType.includes("previous-shift") || normalizeText(entry.inheritedFromDate)) {
        return;
      }

      const entryIdentity = normalizeText(entry.id) || [
        normalizeText(entry.importedFromLogId),
        normalizeText(entry.importedFromEntryIndex),
        normalizeSimilarityText(content)
      ].join("::");
      const entryKey = `${collectionName}::${entryIdentity || `${entryIndex}::${normalizeSimilarityText(content)}`}`;

      if (usedEntries.has(entryKey)) return;
      usedEntries.add(entryKey);

      const entryTime = normalizeCanonicalEntryTime(entry.time) ||
        normalizeCanonicalEntryTime(content.split(/\r?\n/, 1)[0]);
      const entryEquipmentValues = [
        entry.equipmentName,
        entry.equipment,
        entry.title,
        entry.name,
        entry.category
      ].filter(Boolean);
      const entryEquipmentIdentity = entryEquipmentValues.join(" ");
      const structuredTags = extractRecognizedBlowerTags(
        [
          entry.tag,
          entry.tagNumber,
          entry.equipmentTag,
          entryEquipmentIdentity
        ].filter(Boolean).join(" "),
        assets
      );
      const structuredUnitRaw = normalizeText(entry.unitNo || entry.unit || "");
      const structuredUnit = /^[12]$/.test(structuredUnitRaw)
        ? structuredUnitRaw
        : detectUnitNo(structuredUnitRaw);
      const sourceRole = normalizeDutyPosition(entry.importedFromRole || row?.role);
      const roleUnit = DUTY_ROLE_UNIT[sourceRole] || "";
      const entryEquipmentSemanticValues = entryEquipmentValues.map(value => (
        textWithoutRecognizedTagSpans(value, assets)
      ));
      const entryEquipmentSemanticIdentity = entryEquipmentSemanticValues.join(" ");
      const structuredTypes = detectBlowerTypes(entryEquipmentSemanticIdentity);
      const structuredType = structuredTypes.length === 1 ? structuredTypes[0] : "";
      const structuredManureContext = entryEquipmentSemanticValues.some(label => (
        hasManureBlowerContext(label) || isStandaloneManureGroupLabel(label)
      ));
      const structuredPositionText = [
        entry.positionLabel,
        entry.position,
        entryEquipmentSemanticIdentity
      ].filter(Boolean).join(" ");
      const structuredPositions = detectPositionLabels(structuredPositionText);
      const structuredPosition = structuredPositions.length === 1
        ? structuredPositions[0]
        : "";
      const structuredTagResolution = structuredTags.length > 0
        ? resolveExplicitTagIdentity([
          structuredTags.join(" "),
          entryEquipmentSemanticIdentity,
          structuredUnit ? `#${structuredUnit} BLR` : "",
          structuredPosition,
          structuredManureContext ? "축분 Blower" : ""
        ].filter(Boolean).join(" "), structuredTags, assets)
        : null;
      const structuredTagIdentityConflict = (
        structuredTags.length > 0 &&
        !structuredTagResolution?.consistent
      );
      const effectiveStructuredTags = (
        structuredTags.length > 0 && structuredTagResolution?.consistent
      )
        ? structuredTagResolution.tags
        : structuredTags;
      let runningContentTags = [];
      let runningType = structuredType;
      let runningUnit = structuredUnit;
      let runningPosition = structuredPosition;
      let runningAssetGroup = structuredManureContext
        ? "manure"
        : (structuredType === "organic_fuel" ? "" : null);
      let runningStructuredTags = [...effectiveStructuredTags];
      let structuredTagConflictActive = structuredTagIdentityConflict;
      let contentTagConflictActive = false;

      for (const clause of splitCanonicalEntryClauses(content)) {
        const inlineTime = normalizeCanonicalEntryTime(clause);
        const evidence = clause;
        const explicitTags = extractRecognizedBlowerTags(evidence, assets);
        const explicitTagResolution = resolveExplicitTagIdentity(evidence, explicitTags, assets);
        const explicitUnits = explicitTagResolution.units;
        const explicitTypes = explicitTagResolution.types;
        const explicitManureContext = (
          explicitTagResolution.manureContext ||
          isStandaloneManureGroupLabel(explicitTagResolution.semanticText)
        );
        const explicitPositions = explicitTagResolution.positions;
        const explicitTagAssets = explicitTagResolution.assets;
        const compatibleExplicitTags = explicitTagResolution.tags;
        const explicitTagIdentityConflict = (
          explicitTags.length > 0 && !explicitTagResolution.consistent
        );
        const hasExplicitSemanticSelector = (
          explicitTypes.length > 0 ||
          explicitUnits.length > 0 ||
          explicitPositions.length > 0 ||
          explicitManureContext
        );
        if (structuredTags.length > 0) {
          structuredTagConflictActive = (
            structuredTagConflictActive || explicitTagIdentityConflict
          );
        } else if (explicitTags.length > 0) {
          // Without a structured entry TAG, poison only the conflicting
          // content context. A later fully explicit valid TAG starts a new
          // context, while a generic continuation remains blocked.
          contentTagConflictActive = explicitTagIdentityConflict;
        } else if (contentTagConflictActive && hasExplicitSemanticSelector) {
          const semanticIdentity = {
            types: explicitTypes,
            units: explicitUnits,
            positions: explicitPositions,
            assetGroup: explicitManureContext
              ? "manure"
              : (explicitTypes.includes("organic_fuel") ? "" : undefined)
          };
          const semanticTags = new Set((assets || [])
            .filter(asset => recognizedTagsMatchIdentity([
              normalizeText(asset?.tag_number || asset?.tagNumber).toUpperCase()
            ], semanticIdentity, assets))
            .map(asset => normalizeText(asset?.tag_number || asset?.tagNumber).toUpperCase())
            .filter(Boolean));
          if (semanticTags.size === 1) contentTagConflictActive = false;
        }
        if (structuredTags.length > 0 && explicitTags.length > 0) {
          const rawTagSetConflict = (
            structuredTags.length !== explicitTags.length ||
            structuredTags.some(tag => !explicitTags.includes(tag))
          );
          const narrowedStructuredTags = compatibleExplicitTags.filter(tag => (
            effectiveStructuredTags.includes(tag)
          ));
          const contentTagConflict = (
            !explicitTagResolution.consistent ||
            rawTagSetConflict ||
            narrowedStructuredTags.length === 0
          );
          structuredTagConflictActive = structuredTagConflictActive || contentTagConflict;
          if (!contentTagConflict) runningStructuredTags = narrowedStructuredTags;
        } else if (
          structuredTags.length > 0 &&
          (
            hasExplicitSemanticSelector
          )
        ) {
          // A clause may select one member of a structured TAG group without
          // repeating the TAG (for example "#A V-Belt 교체 완료"). Resolve
          // against the complete structured set on every selector clause so
          // a later #B clause can switch intentionally; generic continuation
          // clauses keep the last compatible subset.
          const structuredClauseResolution = resolveExplicitTagIdentity(
            evidence,
            effectiveStructuredTags,
            assets
          );
          const narrowedStructuredTags = structuredClauseResolution.tags;
          const contentIdentityConflict = !structuredClauseResolution.consistent;
          structuredTagConflictActive = (
            structuredTagConflictActive || contentIdentityConflict
          );
          if (!contentIdentityConflict) {
            const keepsRunningSubset = (
              runningStructuredTags.length > 0 &&
              runningStructuredTags.every(tag => narrowedStructuredTags.includes(tag))
            );
            if (!keepsRunningSubset || narrowedStructuredTags.length < effectiveStructuredTags.length) {
              runningStructuredTags = narrowedStructuredTags;
            }
          }
        }
        const tagTypes = new Set(explicitTagAssets.map(asset => normalizeText(
          asset.blower_type || asset.blowerType
        )).filter(Boolean));
        const tagUnits = new Set(explicitTagAssets.map(asset => normalizeText(
          asset.unit_no || asset.unitNo
        )).filter(Boolean));
        const tagPositions = new Set(explicitTagAssets.map(asset => normalizeText(
          asset.position_label || asset.positionLabel
        ).toUpperCase()).filter(Boolean));
        const explicitTagGroups = new Set(
          explicitTagAssets.map(asset => assetGroupKey(asset))
        );
        let explicitTextAssetGroup;
        if (explicitManureContext) {
          explicitTextAssetGroup = "manure";
        } else if (explicitTagResolution.assetGroup !== undefined) {
          explicitTextAssetGroup = explicitTagResolution.assetGroup;
        } else if (explicitTags.length === 0 && explicitTypes.length === 1) {
          explicitTextAssetGroup = explicitTypes[0] === "organic_fuel" ? "" : null;
        }
        const explicitTagIdentityConsistent = explicitTagResolution.consistent;
        let explicitAssetGroup = explicitTextAssetGroup;
        if (explicitTags.length > 0 && explicitTextAssetGroup === undefined) {
          explicitAssetGroup = explicitTagIdentityConsistent && explicitTagGroups.size === 1
            ? [...explicitTagGroups][0]
            : null;
        } else if (explicitTypes.length === 1) {
          explicitAssetGroup ??= explicitTypes[0] === "organic_fuel" ? "" : null;
        }

        const typeBoundaryChanged = (
          explicitTypes.length > 0 &&
          runningType &&
          !explicitTypes.includes(runningType)
        );
        const unitBoundaryChanged = (
          explicitUnits.length > 0 &&
          runningUnit &&
          !explicitUnits.includes(runningUnit)
        );
        const groupBoundaryChanged = (
          explicitAssetGroup !== undefined &&
          runningAssetGroup !== null &&
          explicitAssetGroup !== runningAssetGroup
        );
        let tagBoundaryChanged = false;

        if (structuredTags.length === 0) {
          if (explicitTags.length > 0) {
            tagBoundaryChanged = (
              !explicitTagIdentityConsistent ||
              runningContentTags.length > 0 &&
              (
                runningContentTags.length !== compatibleExplicitTags.length ||
                runningContentTags.some(tag => !compatibleExplicitTags.includes(tag))
              )
            );
            runningContentTags = explicitTagIdentityConsistent ? [...compatibleExplicitTags] : [];
          } else if (
            runningContentTags.length > 0 &&
            !recognizedTagsMatchIdentity(runningContentTags, {
              types: explicitTypes,
              units: explicitUnits,
              positions: explicitPositions,
              assetGroup: explicitManureContext
                ? "manure"
                : (explicitTypes.includes("organic_fuel") ? "" : undefined)
              }, assets)
          ) {
            tagBoundaryChanged = true;
            runningContentTags = [];
          }
        }

        if (
          explicitPositions.length === 0 &&
          (typeBoundaryChanged || unitBoundaryChanged || groupBoundaryChanged || tagBoundaryChanged)
        ) {
          runningPosition = structuredPosition;
        }
        if (
          explicitUnits.length === 0 &&
          (typeBoundaryChanged || groupBoundaryChanged || tagBoundaryChanged)
        ) {
          runningUnit = structuredUnit;
        }

        if (explicitTypes.length > 0) {
          runningType = explicitTypes.length === 1 ? explicitTypes[0] : "";
        } else if (explicitTags.length > 0) {
          runningType = explicitTagIdentityConsistent && tagTypes.size === 1
            ? [...tagTypes][0]
            : "";
        }
        if (explicitUnits.length > 0) {
          runningUnit = explicitUnits.length === 1 ? explicitUnits[0] : "";
        } else if (explicitTags.length > 0) {
          runningUnit = explicitTagIdentityConsistent && tagUnits.size === 1
            ? [...tagUnits][0]
            : "";
        }
        if (explicitPositions.length > 0) {
          runningPosition = explicitPositions.length === 1 ? explicitPositions[0] : "";
        } else if (explicitTags.length > 0) {
          runningPosition = explicitTagIdentityConsistent && tagPositions.size === 1
            ? [...tagPositions][0]
            : "";
        }
        if (explicitAssetGroup !== undefined) runningAssetGroup = explicitAssetGroup;

        if (explicitTags.length > 0 && !explicitTagIdentityConsistent) {
          runningContentTags = [];
          runningType = structuredType;
          runningUnit = structuredUnit;
          runningPosition = structuredPosition;
          runningAssetGroup = structuredManureContext
            ? "manure"
            : (structuredType === "organic_fuel" ? "" : null);
        }

        const identityTags = runningStructuredTags.length > 0
          ? runningStructuredTags
          : runningContentTags;
        const trustedUnit = identityTags.length > 0 || explicitUnits.length > 0
          ? ""
          : (runningUnit || roleUnit);
        const trustedType = identityTags.length > 0 || explicitTypes.length > 0
          ? ""
          : runningType;
        const trustedPosition = identityTags.length > 0 || explicitPositions.length > 0
          ? ""
          : runningPosition;
        const trustedManureGroup = structuredManureContext || (
          runningAssetGroup === "manure" &&
          !explicitManureContext &&
          identityTags.length === 0 &&
          explicitTypes.length === 0
        );
        const identityText = [
          identityTags.join(" "),
          trustedManureGroup ? "축분 Blower" : "",
          trustedType ? TYPE_IDENTITY_LABELS[trustedType] : "",
          trustedUnit ? `#${trustedUnit} BLR` : "",
          trustedPosition
        ].filter(Boolean).join(" ");
        const fragmentKey = [
          compactEquipmentText(identityText),
          sourceRole,
          normalizeSimilarityText(evidence)
        ].join("::");

        if (!fragmentKey || usedFragments.has(fragmentKey)) continue;
        usedFragments.add(fragmentKey);
        fragments.push({
          sourceText: evidence,
          identityText,
          sourceTime: inlineTime || entryTime,
          sourceRole,
          identityConflict: structuredTagConflictActive || contentTagConflictActive
        });
      }
  };

  for (const collectionName of CANONICAL_SHIFT_LOG_ENTRY_COLLECTIONS) {
    const collection = parsedLog?.[collectionName];
    if (!Array.isArray(collection)) continue;

    collection.forEach((rawEntry, entryIndex) => {
      appendEntry(rawEntry, collectionName, entryIndex);

      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        return;
      }

      for (const fieldName of ["note", "remark", "remarks"]) {
        const fieldValue = rawEntry[fieldName];
        if (typeof fieldValue !== "string" || !normalizeText(fieldValue)) continue;

        appendEntry(
          {
            ...rawEntry,
            id: `${normalizeText(rawEntry.id) || entryIndex}-${fieldName}`,
            content: fieldValue,
            text: "",
            description: "",
            value: "",
            note: "",
            remark: "",
            remarks: ""
          },
          `${collectionName}.${fieldName}`,
          entryIndex
        );
      }
    });
  }

  for (const fieldName of ["note", "remark", "remarks"]) {
    const fieldValue = parsedLog?.[fieldName];
    if (typeof fieldValue !== "string" || !normalizeText(fieldValue)) continue;

    appendEntry(
      {
        id: `legacy-${fieldName}`,
        content: fieldValue
      },
      fieldName,
      0
    );
  }

  return fragments;
}

function parseShiftLogFragments(row, assets = []) {
  let parsed;

  try {
    parsed = JSON.parse(row?.log_json || "{}");
  } catch {
    return [];
  }

  if (!isApprovedShiftLogRow(row, parsed)) {
    return [];
  }

  return collectCanonicalShiftLogFragments(parsed, row, assets);
}

function isBlowerScanRelevantFragment(text, assets = []) {
  const normalized = fragmentAnalysisText(text);
  if (!normalized) return false;

  return (
    extractRecognizedBlowerTags(normalized, assets).length > 0 ||
    detectBlowerTypes(normalized).length > 0 ||
    /(?:blower|fan|블로워|브로워)/i.test(normalized) ||
    hasBeltWord(normalized) ||
    hasProblemKeyword(normalized)
  );
}

function normalizeSimilarityText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function buildBigramCounts(value) {
  const counts = new Map();

  for (let index = 0; index < value.length - 1; index += 1) {
    const token = value.slice(index, index + 2);
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return counts;
}

function contentSimilarity(left, right) {
  const a = normalizeSimilarityText(fragmentSourceText(left));
  const b = normalizeSimilarityText(fragmentSourceText(right));

  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 8) return 0;

  const aCounts = buildBigramCounts(a);
  const bCounts = buildBigramCounts(b);
  let intersection = 0;
  let aTotal = 0;
  let bTotal = 0;

  for (const count of aCounts.values()) aTotal += count;
  for (const count of bCounts.values()) bTotal += count;

  for (const [token, count] of aCounts.entries()) {
    intersection += Math.min(count, bCounts.get(token) || 0);
  }

  if (aTotal + bTotal === 0) return 0;
  return (2 * intersection) / (aTotal + bTotal);
}


function identitySetCoveredBy(left, right) {
  if (left.length === 0) return true;
  if (right.length === 0) return false;
  const rightSet = new Set(right);
  return left.every(item => rightSet.has(item));
}

function duplicateAssetGroupKeys(text, tags, types, assets) {
  const tagGroups = new Set();
  for (const tag of tags || []) {
    const asset = recognizedTagAsset(tag, assets);
    const assetType = normalizeText(asset?.blower_type || asset?.blowerType);
    if (asset && assetType === "organic_fuel") tagGroups.add(assetGroupKey(asset));
  }
  if (tagGroups.size > 0) return [...tagGroups];

  if ((types || []).length === 1 && types[0] === "organic_fuel") {
    return [hasManureBlowerContext(text) ? "manure" : ""];
  }
  return [];
}

function duplicateIdentityDescriptor(text, assets = []) {
  const tags = extractRecognizedBlowerTags(text, assets);
  const types = new Set(detectBlowerTypes(text));
  const units = new Set(detectUnitNos(text));
  const positions = new Set(detectPositionLabels(text));
  const groups = new Set(duplicateAssetGroupKeys(text, tags, [...types], assets));

  for (const tag of tags) {
    const asset = recognizedTagAsset(tag, assets);
    if (!asset) continue;

    const type = normalizeText(asset.blower_type || asset.blowerType);
    const unit = normalizeText(asset.unit_no || asset.unitNo);
    const position = normalizeText(asset.position_label || asset.positionLabel).toUpperCase();
    if (type) types.add(type);
    if (unit) units.add(unit);
    if (position) positions.add(position);
    if (type === "organic_fuel") groups.add(assetGroupKey(asset));
  }

  return {
    tags,
    types: [...types],
    groups: [...groups],
    units: [...units],
    positions: [...positions]
  };
}

function duplicateIdentityCompatible(left, right, assets = []) {
  if (
    fragmentHasIdentityConflict(left, assets) ||
    fragmentHasIdentityConflict(right, assets)
  ) {
    return false;
  }

  const leftText = fragmentAnalysisText(left);
  const rightText = fragmentAnalysisText(right);
  const leftIdentity = duplicateIdentityDescriptor(leftText, assets);
  const rightIdentity = duplicateIdentityDescriptor(rightText, assets);

  if (
    leftIdentity.tags.length > 0 &&
    rightIdentity.tags.length > 0 &&
    !identitySetCoveredBy(leftIdentity.tags, rightIdentity.tags)
  ) {
    return false;
  }

  if (!identitySetCoveredBy(leftIdentity.types, rightIdentity.types)) {
    return false;
  }

  if (!identitySetCoveredBy(leftIdentity.groups, rightIdentity.groups)) {
    return false;
  }

  if (!identitySetCoveredBy(leftIdentity.units, rightIdentity.units)) {
    return false;
  }

  if (!identitySetCoveredBy(leftIdentity.positions, rightIdentity.positions)) {
    return false;
  }

  return true;
}

function buildRolePriorityContext(rows, assets = []) {
  const context = new Map();

  for (const row of rows || []) {
    const fragments = parseShiftLogFragments(row, assets)
      .filter(fragment => isBlowerScanRelevantFragment(fragment, assets));

    if (fragments.length === 0) continue;

    for (const fragment of fragments) {
      const role = fragmentSourceRole(fragment) || normalizeDutyPosition(row?.role);
      if (!DUTY_ROLE_HIGHER.has(role)) continue;

      const key = rolePriorityGroupKey(row, role);
      if (!context.has(key)) {
        context.set(key, []);
      }

      context.get(key).push(fragment);
    }
  }

  for (const [key, fragments] of context.entries()) {
    const unique = new Map();
    for (const fragment of fragments) {
      unique.set(fragmentStableKey(fragment), fragment);
    }
    context.set(key, [...unique.values()]);
  }

  return context;
}

function applyDutyRolePriority(row, fragments, rolePriorityContext, assets = []) {
  const containerRole = normalizeDutyPosition(row?.role);
  let suppressedDuplicateFragments = 0;
  const retained = [];
  let excludedNativePartLeaderFragments = 0;

  for (const fragment of fragments) {
    const role = fragmentSourceRole(fragment) || containerRole;

    if (containerRole === "PART_LEADER" && role === "PART_LEADER") {
      excludedNativePartLeaderFragments += 1;
      continue;
    }

    const higherRole = DUTY_ROLE_SUPERIOR[role];
    const higherFragments = higherRole && rolePriorityContext
      ? (rolePriorityContext.get(rolePriorityGroupKey(row, higherRole)) || [])
      : [];

    if (!isBlowerScanRelevantFragment(fragment, assets)) {
      retained.push(fragment);
      continue;
    }

    const duplicated = higherFragments.length > 0 && higherFragments.some(higherFragment =>
      duplicateIdentityCompatible(fragment, higherFragment, assets) &&
      contentSimilarity(fragment, higherFragment) >= DUPLICATE_SIMILARITY_THRESHOLD
    );

    if (duplicated) {
      suppressedDuplicateFragments += 1;
      continue;
    }

    retained.push(fragment);
  }

  return {
    fragments: retained,
    excludedPartLeader: (
      containerRole === "PART_LEADER" &&
      retained.length === 0 &&
      excludedNativePartLeaderFragments > 0
    ),
    suppressedDuplicateFragments,
    role: containerRole
  };
}

async function loadUpperRoleRowsForDates(database, rows) {
  const dates = [...new Set(
    (rows || [])
      .filter(row => DUTY_ROLE_LOWER.has(normalizeDutyPosition(row?.role)))
      .map(row => normalizeText(row?.work_date).slice(0, 10))
      .filter(Boolean)
  )];

  if (dates.length === 0) return [];

  const output = [];
  const chunkSize = 90;

  for (let offset = 0; offset < dates.length; offset += chunkSize) {
    const chunk = dates.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");

    const result = await database
      .prepare(`
        SELECT id, work_date, shift, role, author, status, log_json
        FROM shift_logs
        WHERE substr(work_date, 1, 10) IN (${placeholders})
          AND status = '결재완료'
          AND REPLACE(REPLACE(REPLACE(UPPER(role), ' ', ''), '-', ''), '_', '')
              IN ('BCO1', 'BCO2', 'TGO')
      `)
      .bind(...chunk)
      .all();

    if (Array.isArray(result.results)) {
      output.push(...result.results);
    }
  }

  return output;
}

function findIssueType(text) {
  const normalized = normalizeText(text).toLowerCase();

  for (const [keyword, label] of PROBLEM_KEYWORDS) {
    const token = keyword.toLowerCase();
    let index = normalized.indexOf(token);

    while (index >= 0) {
      const tail = normalized
        .slice(index + token.length, index + token.length + 12)
        .replace(/\s+/g, "");
      const negated =
        tail.startsWith("없") ||
        tail.startsWith("미발생") ||
        tail.startsWith("무") ||
        tail.startsWith("x") ||
        tail.startsWith("no");

      if (!negated) {
        return label;
      }

      index = normalized.indexOf(token, index + token.length);
    }
  }

  return "";
}

function hasReplacementKeyword(text) {
  const normalized = normalizeText(text).toLowerCase();

  if (REPLACEMENT_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()))) {
    return true;
  }

  return (
    normalized.includes("신품") &&
    ["취부", "설치", "장착"].some(keyword => normalized.includes(keyword))
  );
}

function hasProblemKeyword(text) {
  return Boolean(findIssueType(text));
}

function fingerprintText(text) {
  let hash = 2166136261;
  const source = String(text || "");

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildDetectionFingerprint(row, tagNumber, detectedType) {
  return fingerprintText([
    "v9",
    normalizeText(row?.id),
    detectionDateTime(row) || normalizeText(row?.work_date),
    normalizeText(tagNumber).toUpperCase(),
    normalizeText(detectedType),
    normalizeSimilarityText(row?.sourceText)
  ].join("||"));
}

function compactEquipmentText(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function classifyRecognizedBlowerTag(tagNumber) {
  const tag = compactEquipmentText(tagNumber);
  let match;

  match = tag.match(/^([12])04HHL60AP(611|621|631)$/);
  if (match) {
    const positionMap = { "611": "#A", "621": "#B", "631": "#C" };
    const position = positionMap[match[2]];
    const unitNo = match[1];
    return {
      tagNumber: tag,
      blowerType: "fbhe",
      unitNo,
      positionLabel: position,
      displayName: `#${unitNo} FBHE Blower ${position}`,
      sortOrder: (unitNo === "1" ? 100 : 200) + { "#A": 1, "#B": 2, "#C": 3 }[position]
    };
  }

  match = tag.match(/^([12])04HHL10AN(611|621|631)$/);
  if (match) {
    const positionMap = { "611": "#A", "621": "#B", "631": "#C" };
    const position = positionMap[match[2]];
    const unitNo = match[1];
    return {
      tagNumber: tag,
      blowerType: "seal_pot",
      unitNo,
      positionLabel: position,
      displayName: `#${unitNo} Seal Pot Blower ${position}`,
      sortOrder: (unitNo === "1" ? 300 : 350) + { "#A": 1, "#B": 2, "#C": 3 }[position]
    };
  }

  match = tag.match(/^([12])04SDF01AN(001|002)$/);
  if (match) {
    const positionMap = { "001": "#A", "002": "#B" };
    const position = positionMap[match[2]];
    const unitNo = match[1];
    return {
      tagNumber: tag,
      blowerType: "organic_fuel",
      unitNo,
      positionLabel: position,
      displayName: `#${unitNo} 유기성 고형연료 Blower ${position}`,
      sortOrder: (unitNo === "1" ? 400 : 450) + { "#A": 1, "#B": 2 }[position]
    };
  }

  match = tag.match(/^([12])04ETG30AN(601|602)$/);
  if (match) {
    const positionMap = { "601": "#A", "602": "#B" };
    const position = positionMap[match[2]];
    const unitNo = match[1];
    return {
      tagNumber: tag,
      blowerType: "flyash_bag",
      unitNo,
      positionLabel: position,
      displayName: `#${unitNo} Fly Ash Bag Filter Aeration Blower ${position}`,
      sortOrder: (unitNo === "1" ? 500 : 550) + { "#A": 1, "#B": 2 }[position]
    };
  }

  match = tag.match(/^104ETH03AN(601|602)$/);
  if (match) {
    const positionMap = { "601": "#A", "602": "#B" };
    const position = positionMap[match[1]];
    return {
      tagNumber: tag,
      blowerType: "flyash_silo",
      unitNo: "shared",
      positionLabel: position,
      displayName: `Fly Ash Silo Aeration Blower ${position}`,
      sortOrder: 600 + { "#A": 1, "#B": 2 }[position]
    };
  }

  return null;
}

function extractCatalogBlowerTagMatches(text, assets = []) {
  const source = normalizeText(text).toUpperCase();
  if (!source) return { tags: [], matches: [] };

  const candidates = [];
  const seenCanonical = new Set();
  const byCanonical = new Map();
  const tagNumbers = (assets || [])
    .map(asset => normalizeText(asset?.tag_number || asset?.tagNumber).toUpperCase())
    .filter(Boolean);

  for (const tagNumber of tagNumbers) {
    const compactTag = compactEquipmentText(tagNumber);
    if (compactTag.length < 3 || seenCanonical.has(compactTag)) continue;
    seenCanonical.add(compactTag);
    byCanonical.set(compactTag, tagNumber);

    const boundaryPattern = catalogTagBoundaryPattern(compactTag);
    boundaryPattern.lastIndex = 0;
    let match;
    while ((match = boundaryPattern.exec(source)) !== null) {
      const matchedTag = match[1] || "";
      const start = match.index + match[0].length - matchedTag.length;
      candidates.push({
        tagNumber,
        compactTag,
        start,
        end: start + matchedTag.length
      });
    }
    boundaryPattern.lastIndex = 0;

    const broadPattern = catalogTagBoundaryPattern(compactTag, false);
    broadPattern.lastIndex = 0;
    while ((match = broadPattern.exec(source)) !== null) {
      const matchedTag = match[1] || "";
      const start = match.index + match[0].length - matchedTag.length;
      const end = start + matchedTag.length;
      if (!isLegacyFixedTagContext(source, start, end)) continue;
      candidates.push({ tagNumber, compactTag, start, end });
    }
    broadPattern.lastIndex = 0;
  }

  for (const tokenMatch of source.matchAll(/[A-Z0-9][A-Z0-9._/-]*/g)) {
    const token = tokenMatch[0];
    if (!token.includes("/")) continue;
    const tokenStart = tokenMatch.index;
    const fullCanonical = compactEquipmentText(token);
    const fullTagNumber = byCanonical.get(fullCanonical);
    if (fullTagNumber) {
      candidates.push({
        tagNumber: fullTagNumber,
        compactTag: fullCanonical,
        start: tokenStart,
        end: tokenStart + token.length
      });
      continue;
    }

    const segmentMatches = [...token.matchAll(/[^/]+/g)];
    const resolvedSegments = segmentMatches.map(segmentMatch => {
      const segmentCanonical = compactEquipmentText(segmentMatch[0]);
      return {
        segmentMatch,
        segmentCanonical,
        segmentTagNumber: byCanonical.get(segmentCanonical)
      };
    });

    // Treat a slash token as an equipment list only when every segment is a
    // registered TAG.  This preserves "P101/Q202" while rejecting path-like
    // text such as "DOC/P101/ARCHIVE" or an incomplete "P101/UNKNOWN" list.
    if (resolvedSegments.length < 2 || resolvedSegments.some(item => !item.segmentTagNumber)) {
      continue;
    }

    for (const { segmentMatch, segmentCanonical, segmentTagNumber } of resolvedSegments) {
      const start = tokenStart + segmentMatch.index;
      candidates.push({
        tagNumber: segmentTagNumber,
        compactTag: segmentCanonical,
        start,
        end: start + segmentMatch[0].length
      });
    }
  }

  candidates.sort((left, right) => (
    right.compactTag.length - left.compactTag.length ||
    (right.end - right.start) - (left.end - left.start) ||
    left.start - right.start ||
    left.tagNumber.localeCompare(right.tagNumber)
  ));

  const selected = [];
  for (const candidate of candidates) {
    const overlapsLongerMatch = selected.some(match => (
      candidate.start < match.end && candidate.end > match.start
    ));
    if (!overlapsLongerMatch) selected.push(candidate);
  }
  selected.sort((left, right) => left.start - right.start || left.tagNumber.localeCompare(right.tagNumber));

  return {
    tags: [...new Set(selected.map(match => match.tagNumber))],
    matches: selected
  };
}

function extractCatalogBlowerTags(text, assets = []) {
  return extractCatalogBlowerTagMatches(text, assets).tags;
}

function flexibleCanonicalTagPattern(tagNumber, separatorPattern = "[\\s._/-]*") {
  return [...compactEquipmentText(tagNumber)].join(separatorPattern);
}

const CATALOG_TAG_PATTERN_CACHE = new Map();

function catalogTagBoundaryPattern(compactTag, strictTagBoundary = true) {
  const cacheKey = `${strictTagBoundary ? "strict" : "broad"}:${compactTag}`;
  let pattern = CATALOG_TAG_PATTERN_CACHE.get(cacheKey);
  if (pattern) return pattern;

  const boundary = strictTagBoundary ? "[^A-Z0-9._/-]" : "[^A-Z0-9]";
  pattern = new RegExp(
    `(?:^|${boundary})(${flexibleCanonicalTagPattern(compactTag)})(?=$|${boundary})`,
    "giu"
  );
  if (CATALOG_TAG_PATTERN_CACHE.size >= 512) CATALOG_TAG_PATTERN_CACHE.clear();
  CATALOG_TAG_PATTERN_CACHE.set(cacheKey, pattern);
  return pattern;
}

function isLegacyFixedTagContext(source, start, end) {
  const isTagCharacter = character => /[A-Z0-9._/-]/.test(character || "");
  let tokenStart = start;
  let tokenEnd = end;
  while (tokenStart > 0 && isTagCharacter(source[tokenStart - 1])) tokenStart -= 1;
  while (tokenEnd < source.length && isTagCharacter(source[tokenEnd])) tokenEnd += 1;

  const surroundingTokens = [
    ...source.slice(tokenStart, start).split(/[._/-]+/),
    ...source.slice(end, tokenEnd).split(/[._/-]+/)
  ].map(value => value.trim()).filter(Boolean);
  const allowed = new Set([
    "TAG", "TAGNO", "NO", "A", "B", "C", "V", "VBELT", "BELT",
    "1", "2", "FBHE", "FHBE", "SEAL", "SEALPOT", "POT", "BLOWER", "BLR", "FAN",
    "ORGANIC", "FUEL", "FLY", "ASH", "BAG", "FILTER", "AERATION", "SILO"
  ]);
  if (surroundingTokens.some(token => !allowed.has(token))) return false;
  if (surroundingTokens.length > 0) return true;

  const leftAdjacent = source.slice(Math.max(0, tokenStart - 24), tokenStart);
  const rightAdjacent = source.slice(tokenEnd, Math.min(source.length, tokenEnd + 24));
  const koreanContext = "(?:벨트|교체|교환|블로워|브로워|유기성|고형연료|축분)";
  return (
    new RegExp(`${koreanContext}\\s*$`, "i").test(leftAdjacent) ||
    new RegExp(`^\\s*${koreanContext}`, "i").test(rightAdjacent)
  );
}

function extractRecognizedBlowerTags(text, assets = []) {
  const groupedSource = normalizeText(text).toUpperCase();
  const dynamicAssets = (assets || []).filter(asset => (
    !ASSET_SEED_TAG_SET.has(
      normalizeText(asset?.tag_number || asset?.tagNumber).toUpperCase()
    )
  ));
  const catalogMatches = extractCatalogBlowerTagMatches(
    text,
    [...ASSET_SEED_TAG_ASSETS, ...dynamicAssets]
  );
  const found = new Set(catalogMatches.tags);
  const groupedFamilies = [
    { prefixes: ["104HHL60AP", "204HHL60AP"], suffixes: ["611", "621", "631"] },
    { prefixes: ["104HHL10AN", "204HHL10AN"], suffixes: ["611", "621", "631"] },
    { prefixes: ["104SDF01AN", "204SDF01AN"], suffixes: ["001", "002"] },
    { prefixes: ["104ETG30AN", "204ETG30AN"], suffixes: ["601", "602"] },
    { prefixes: ["104ETH03AN"], suffixes: ["601", "602"] }
  ];

  for (const family of groupedFamilies) {
    const prefix = `(?:${family.prefixes.map(value => flexibleCanonicalTagPattern(value, "[\\s._-]*")).join("|")})`;
    const suffix = `(?:${family.suffixes.map(value => flexibleCanonicalTagPattern(value, "[\\s._-]*")).join("|")})`;
    const groupPattern = new RegExp(
      `(?:^|[^A-Z0-9])(${prefix})(${suffix})((?:\\s*[/,&+·]\\s*(?:${prefix})?${suffix})+)(?=$|[^A-Z0-9])`,
      "giu"
    );

    for (const groupMatch of groupedSource.matchAll(groupPattern)) {
      const basePrefix = compactEquipmentText(groupMatch[1]);
      const firstTag = `${basePrefix}${compactEquipmentText(groupMatch[2])}`;
      const groupStart = groupMatch.index + groupMatch[0].length - (
        groupMatch[1].length + groupMatch[2].length + groupMatch[3].length
      );
      const groupEnd = groupMatch.index + groupMatch[0].length;
      const strictGroupBoundary = (
        (groupStart === 0 || !/[A-Z0-9._/-]/.test(groupedSource[groupStart - 1])) &&
        (groupEnd === groupedSource.length || !/[A-Z0-9._/-]/.test(groupedSource[groupEnd]))
      );
      if (!strictGroupBoundary && !isLegacyFixedTagContext(groupedSource, groupStart, groupEnd)) {
        continue;
      }
      const coveredByLongerCatalogTag = catalogMatches.matches.some(match => (
        match.compactTag.length > compactEquipmentText(firstTag).length &&
        match.start <= groupStart &&
        match.end >= groupEnd
      ));
      if (coveredByLongerCatalogTag) continue;
      if (classifyRecognizedBlowerTag(firstTag)) found.add(firstTag);

      const tailPattern = new RegExp(
        `[/,&+·]\\s*(${prefix})?(${suffix})`,
        "giu"
      );
      for (const tailMatch of groupMatch[3].matchAll(tailPattern)) {
        const tagNumber = `${tailMatch[1] ? compactEquipmentText(tailMatch[1]) : basePrefix}${compactEquipmentText(tailMatch[2])}`;
        if (classifyRecognizedBlowerTag(tagNumber)) found.add(tagNumber);
      }
    }
  }

  return [...found];
}

const DISCOVERED_ASSET_TAG_CACHE = new WeakMap();

async function ensureDiscoveredAssets(database, text, assets) {
  let known = DISCOVERED_ASSET_TAG_CACHE.get(assets);
  if (!known) {
    known = new Set(assets.map(asset => normalizeText(asset.tag_number).toUpperCase()));
    DISCOVERED_ASSET_TAG_CACHE.set(assets, known);
  }
  const now = new Date().toISOString();

  for (const tagNumber of extractRecognizedBlowerTags(text, assets)) {
    if (known.has(tagNumber)) continue;

    const definition = classifyRecognizedBlowerTag(tagNumber);
    if (!definition) continue;

    await database
      .prepare(`
        INSERT OR IGNORE INTO blower_history_assets (
          tag_number,
          blower_type,
          unit_no,
          position_label,
          display_name,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        definition.tagNumber,
        definition.blowerType,
        definition.unitNo,
        definition.positionLabel,
        definition.displayName,
        definition.sortOrder,
        now,
        now
      )
      .run();

    const inserted = await database
      .prepare(`SELECT * FROM blower_history_assets WHERE tag_number = ? AND enabled = 1 LIMIT 1`)
      .bind(definition.tagNumber)
      .first();

    if (inserted) {
      assets.push(inserted);
    }
    // disabled 기존 seed도 같은 요청에서 다시 INSERT/SELECT하지 않도록 기억한다.
    known.add(definition.tagNumber);
  }
}

function detectUnitNos(text) {
  const normalized = normalizeText(text);
  const found = new Set();

  const patterns = [
    { unit: "1", regex: /(?:#\s*1(?:\b|호)|1\s*호기|1\s*호\b|UNIT\s*#?\s*1\b|U\s*1\b|#?\s*1\s*BLR\b|1BLR\b)/ig },
    { unit: "2", regex: /(?:#\s*2(?:\b|호)|2\s*호기|2\s*호\b|UNIT\s*#?\s*2\b|U\s*2\b|#?\s*2\s*BLR\b|2BLR\b)/ig }
  ];

  for (const item of patterns) {
    if (item.regex.test(normalized)) found.add(item.unit);
  }

  return [...found];
}

function detectUnitNo(text) {
  const units = detectUnitNos(text);
  return units.length === 1 ? units[0] : "";
}

function addPositionTokens(raw, output) {
  const token = normalizeText(raw).toUpperCase();
  for (const match of token.matchAll(/[ABC]/g)) {
    output.add(`#${match[0]}`);
  }
}

function detectExplicitPositionLabels(text) {
  const normalized = normalizeText(text).toUpperCase();
  const found = new Set();

  for (const match of normalized.matchAll(/#\s*([ABC])\b/g)) {
    found.add(`#${match[1]}`);
  }

  const positionSequence = "(?:#\\s*)?[ABC]\\b(?:\\s*[,/&·+\\-]\\s*(?:#\\s*)?[ABC]\\b){0,2}";
  const equipmentName = "(?:BLOWER|FAN|블로워|브로워)";
  const typeName = [
    "FBHE",
    "SEAL\\s*POT",
    "SEALPOT",
    "ORGANIC\\s*FUEL",
    "유기성\\s*고형연료",
    "FLY\\s*ASH\\s*BAG\\s*FILTER(?:\\s*AERATION)?",
    "BAG\\s*FILTER\\s*AERATION",
    "FLY\\s*ASH\\s*SILO(?:\\s*AERATION)?",
    "SILO\\s*AERATION"
  ].join("|");
  const equipmentPatterns = [
    new RegExp(`${equipmentName}\\s*(?:NO\\.?\\s*)?(${positionSequence})`, "g"),
    new RegExp(`(?:^|[^A-Z0-9])(${positionSequence})\\s*${equipmentName}`, "g"),
    new RegExp(`(?:${typeName})\\s*(?:${equipmentName}\\s*)?(?:NO\\.?\\s*)?(${positionSequence})`, "g")
  ];

  for (const pattern of equipmentPatterns) {
    for (const match of normalized.matchAll(pattern)) {
      addPositionTokens(match[1], found);
    }
  }

  return ["#A", "#B", "#C"].filter(position => found.has(position));
}

function detectPositionLabels(text) {
  const normalized = normalizeText(text).toUpperCase();
  const found = new Set(detectExplicitPositionLabels(normalized));

  for (const [suffix, position] of [
    ["AP611", "#A"], ["AP621", "#B"], ["AP631", "#C"],
    ["AN611", "#A"], ["AN621", "#B"], ["AN631", "#C"],
    ["AN001", "#A"], ["AN002", "#B"],
    ["AN601", "#A"], ["AN602", "#B"]
  ]) {
    if (normalized.includes(suffix)) found.add(position);
  }

  for (const groupMatch of normalized.matchAll(
    /(?:AP|AN)(?:611|621|631|001|002|601|602)(?:\s*[/,&+·]\s*(?:(?:AP|AN))?(?:611|621|631|001|002|601|602))+/g
  )) {
    for (const suffixMatch of groupMatch[0].matchAll(/(?:AP|AN)?(611|621|631|001|002|601|602)/g)) {
      const position = ({
        "611": "#A", "621": "#B", "631": "#C",
        "001": "#A", "002": "#B",
        "601": "#A", "602": "#B"
      })[suffixMatch[1]];
      if (position) found.add(position);
    }
  }

  return ["#A", "#B", "#C"].filter(position => found.has(position));
}

function detectPositionLabel(text) {
  const positions = detectPositionLabels(text);
  return positions.length === 1 ? positions[0] : "";
}

function detectBlowerTypes(text) {
  const normalized = normalizeText(text).toLowerCase();
  const matches = [];

  for (const [type, keywords] of Object.entries(TYPE_CONTEXT_KEYWORDS)) {
    if (keywords.some(keyword => normalized.includes(keyword.toLowerCase()))) {
      matches.push(type);
    }
  }

  if (hasManureBlowerContext(text) && !matches.includes("organic_fuel")) {
    matches.push("organic_fuel");
  }

  return matches;
}

function assetGroupKey(asset) {
  const value = asset && Object.prototype.hasOwnProperty.call(asset, "asset_group")
    ? asset.asset_group
    : asset?.assetGroup;
  return normalizeText(value);
}

function recognizedTagAsset(tagNumber, assets = []) {
  const tag = normalizeText(tagNumber).toUpperCase();
  const catalogAsset = (assets || []).find(asset => (
    normalizeText(asset?.tag_number || asset?.tagNumber).toUpperCase() === tag
  ));
  return catalogAsset || classifyRecognizedBlowerTag(tag);
}

function recognizedTagsMatchIdentity(tags, identity, assets = []) {
  const tagAssets = (tags || []).map(tag => recognizedTagAsset(tag, assets));
  if (tagAssets.length === 0) return true;
  if (tagAssets.some(asset => !asset)) return false;

  const types = identity?.types || [];
  if (types.length > 0 && tagAssets.some(asset => (
    !types.includes(normalizeText(asset.blower_type || asset.blowerType))
  ))) {
    return false;
  }

  const units = identity?.units || [];
  if (units.length > 0 && tagAssets.some(asset => (
    !units.includes(normalizeText(asset.unit_no || asset.unitNo))
  ))) {
    return false;
  }

  const positions = (identity?.positions || []).map(value => normalizeText(value).toUpperCase());
  if (positions.length > 0 && tagAssets.some(asset => (
    !positions.includes(normalizeText(asset.position_label || asset.positionLabel).toUpperCase())
  ))) {
    return false;
  }

  if (identity && identity.assetGroup !== undefined && tagAssets.some(asset => (
    assetGroupKey(asset) !== identity.assetGroup
  ))) {
    return false;
  }

  return true;
}

function textWithoutRecognizedTagSpans(text, assets = []) {
  const source = normalizeText(text);
  if (!source) return "";

  const recognitionAssets = [...ASSET_SEED_TAG_ASSETS, ...(assets || [])];
  const matches = extractCatalogBlowerTagMatches(source, recognitionAssets).matches;
  if (matches.length === 0) return source;

  const characters = source.split("");
  for (const match of matches) {
    for (let index = match.start; index < match.end && index < characters.length; index += 1) {
      characters[index] = " ";
    }
  }
  return normalizeText(characters.join(""));
}

function detectTextPositionLabels(text) {
  const normalized = normalizeText(text).toUpperCase();
  const found = new Set(detectExplicitPositionLabels(normalized));

  for (const match of normalized.matchAll(/#\s*([ABC])(?=$|[^A-Z0-9])/g)) {
    found.add(`#${match[1]}`);
  }
  for (const [range, positions] of [
    [/(?:#\s*)?A\s*(?:~|－|–|—|-)\s*(?:#\s*)?C\b/, ["#A", "#B", "#C"]],
    [/(?:#\s*)?A\s*(?:~|－|–|—|-)\s*(?:#\s*)?B\b/, ["#A", "#B"]],
    [/(?:#\s*)?B\s*(?:~|－|–|—|-)\s*(?:#\s*)?C\b/, ["#B", "#C"]]
  ]) {
    if (range.test(normalized)) positions.forEach(position => found.add(position));
  }

  return ["#A", "#B", "#C"].filter(position => found.has(position));
}

function resolveExplicitTagIdentity(text, tags, assets = []) {
  const semanticText = textWithoutRecognizedTagSpans(text, assets);
  const types = detectBlowerTypes(semanticText);
  const units = detectUnitNos(semanticText);
  const positions = detectTextPositionLabels(semanticText);
  const manureContext = hasManureBlowerContext(semanticText);
  // "유기성 고형연료 Blower"는 축분 설비에도 쓰이는 상위 종류명이다.
  // exact TAG가 있을 때는 명시적인 축분 문맥만 group constraint로 사용한다.
  const assetGroup = manureContext ? "manure" : undefined;
  const pairs = (tags || []).map(tag => ({
    tag,
    asset: recognizedTagAsset(tag, assets)
  }));
  const compatiblePairs = pairs.filter(({ asset }) => {
    if (!asset) return false;
    const type = normalizeText(asset.blower_type || asset.blowerType);
    const unit = normalizeText(asset.unit_no || asset.unitNo);
    const position = normalizeText(asset.position_label || asset.positionLabel).toUpperCase();
    if (types.length > 0 && !types.includes(type)) return false;
    if (units.length > 0 && !units.includes(unit)) return false;
    if (positions.length > 0 && !positions.includes(position)) return false;
    if (assetGroup !== undefined && assetGroupKey(asset) !== assetGroup) return false;
    return true;
  });
  const compatibleTypes = new Set(compatiblePairs.map(({ asset }) => normalizeText(
    asset.blower_type || asset.blowerType
  )));
  const compatibleUnits = new Set(compatiblePairs.map(({ asset }) => normalizeText(
    asset.unit_no || asset.unitNo
  )));

  return {
    semanticText,
    types,
    units,
    positions,
    assetGroup,
    manureContext,
    tags: compatiblePairs.map(pair => pair.tag),
    assets: compatiblePairs.map(pair => pair.asset),
    consistent: (
      pairs.length > 0 &&
      pairs.every(pair => Boolean(pair.asset)) &&
      compatiblePairs.length > 0 &&
      types.every(type => compatibleTypes.has(type)) &&
      units.every(unit => compatibleUnits.has(unit))
    )
  };
}

function hasManureBlowerContext(text) {
  const normalized = normalizeText(text);
  const blower = "(?:blower|blwr|fan|블로워|브로워)";
  const manurePrefix = "(?:축분(?:용|계통)?|manure)";
  const organicLabel = "(?:(?:유기성\\s*)?고형연료\\s*)?";
  return (
    new RegExp(`${manurePrefix}\\s*${organicLabel}${blower}`, "i").test(normalized) ||
    new RegExp(`${blower}\\s*(?:[([\\-]\\s*)?${manurePrefix}`, "i").test(normalized)
  );
}

function isStandaloneManureGroupLabel(text) {
  return /^(?:축분\s*(?:용|계통)?|manure)$/i.test(normalizeText(text));
}

function splitSemanticClauses(text) {
  const normalized = normalizeText(text);
  const parts = normalized
    .split(/\s*(?:\||\r?\n|→|➡|▶|⇒|;|；)\s*/g)
    .map(item => normalizeText(item))
    .filter(Boolean);

  return parts.length > 0 ? parts : [normalized];
}

function hasReplacementPlanContext(text) {
  const normalized = normalizeText(text).toLowerCase();
  const completed = hasExplicitReplacementCompletion(normalized);
  const prospective = (
    /(?:교체|교환)(?:\s*작업|\s*실시|\s*시행)?.{0,16}(?:예정|계획|요청|요망|필요|검토|준비|지시|발행)/i.test(normalized) ||
    /(?:명일|차후|추후|향후|예방정비).{0,40}(?:교체|교환)/i.test(normalized) ||
    /(?:tm|bm|cm)\s*발행.{0,40}(?:교체|교환)/i.test(normalized)
  );

  if (prospective) {
    if (!completed) return true;
    if (hasDirectCompletedBeltReplacement(normalized)) return false;
    if (hasCompletedForeignComponentReplacement(normalized)) return true;
  }

  const planned = REPLACEMENT_PLAN_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
  return planned && !completed;
}

function hasExplicitReplacementCompletion(text) {
  const normalized = normalizeText(text).toLowerCase();

  if (REPLACEMENT_COMPLETE_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()))) {
    return true;
  }

  return (
    /(?:교체|교환)\s*(?:작업\s*)?(?:완료|실시|시행|함|하였|했|하여)/i.test(normalized) ||
    /(?:교체|교환)\s*(?:후|및).{0,40}(?:완료|정상|양호|stand\s*by|시운전)/i.test(normalized) ||
    /신품(?:으로)?\s*(?:교체|교환)(?:\s*(?:완료|실시|함|하였|했))?/i.test(normalized) ||
    /(?:v\s*[-/]?\s*belt|vbelt|belt|v\s*[-/]?\s*벨트|v벨트|벨트).{0,20}신품.{0,16}(?:취부|설치|장착).{0,16}(?:완료|실시|함|하였|했)/i.test(normalized) ||
    /신품.{0,16}(?:v\s*[-/]?\s*belt|vbelt|belt|v\s*[-/]?\s*벨트|v벨트|벨트).{0,16}(?:취부|설치|장착).{0,16}(?:완료|실시|함|하였|했)/i.test(normalized) ||
    /(?:v\s*[-/]?\s*belt|vbelt|belt|v\s*[-/]?\s*벨트|v벨트|벨트).{0,24}(?:취외|취부).{0,24}(?:완료|정상|양호)/i.test(normalized)
  );
}

function hasHardReplacementExclusion(text) {
  const normalized = normalizeText(text).toLowerCase();
  const hardKeywords = [
    "교체운전",
    "교체 운전",
    "교체 중",
    "교체중",
    "교체 작업 중",
    "교체작업중",
    "미교체",
    "교체 미실시",
    "교체미실시",
    "교체 미완료",
    "교체미완료",
    "교체 보류",
    "교체보류",
    "교체 취소",
    "교체취소",
    "교체 불가",
    "교체불가",
    "교체하지 않",
    "교체 안",
    "not replaced",
    "replacement cancelled",
    "replacement canceled"
  ];

  if (hardKeywords.some(keyword => normalized.includes(keyword))) {
    return true;
  }

  const negatedCompletion = (
    /(?:교체|교환)(?:가|는|은)?\s*(?:작업\s*)?(?:완료|실시|시행)?\s*(?:하지\s*못(?:함|했|하였)?|못\s*(?:함|했|하였)|안\s*(?:됨|했|함)|되(?:지)?\s*(?:않|못)|미실시|미완료|취소|보류|불발|실패|불가)/i.test(normalized) ||
    /(?:교체|교환).{0,16}(?:완료|실시|시행)\s*(?:여부|미확인|실패|불가)/i.test(normalized) ||
    /(?:교체|교환)\s*(?:작업\s*)?(?:미실시|미완료|취소|보류|실패|불발|불가)/i.test(normalized) ||
    /(?:교체|교환)\s*(?:(?:완료|실시|시행)\s*)?(?:여부|미확인|되었는지|했는지|하였는지)/i.test(normalized)
  );

  return negatedCompletion;
}

function hasReplacementExclusionContext(text) {
  const normalized = normalizeText(text).toLowerCase();

  if (hasHardReplacementExclusion(normalized)) {
    return true;
  }

  if (hasExplicitReplacementCompletion(normalized)) {
    return false;
  }

  return REPLACEMENT_EXCLUSION_KEYWORDS.some(keyword =>
    normalized.includes(keyword.toLowerCase())
  );
}

function componentReplacementPhrase(text) {
  const normalized = normalizeText(text).toLowerCase();

  for (const keyword of COMPONENT_REPLACEMENT_KEYWORDS) {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const forward = new RegExp(`${escaped}.{0,18}(?:교체|replace)`, "i");
    const reverse = new RegExp(`(?:교체|replace).{0,18}${escaped}`, "i");
    if (forward.test(normalized) || reverse.test(normalized)) return true;
  }

  return false;
}

function hasBeltWord(text) {
  const normalized = normalizeText(text);
  return /(?:\bV\s*[-\/]?\s*BELT\b|\bVBELT\b|\bBELT\b|V\s*[-\/]?\s*벨트|V벨트|벨트)/i.test(normalized);
}

function isValidBeltToReplacementGap(value) {
  const gap = normalizeText(value).toLowerCase();
  const foreignComponent = COMPONENT_REPLACEMENT_KEYWORDS
    .map(keyword => ({ keyword, index: gap.indexOf(keyword.toLowerCase()) }))
    .filter(item => item.index >= 0)
    .sort((left, right) => left.index - right.index)[0]?.keyword;

  if (!foreignComponent) return true;

  const escaped = foreignComponent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(?:및|와|과|&|\\+|,)\\s*${escaped}(?:\\b|\\s|$)`, "i").test(gap);
}

function hasBeltReplacementPhrase(text) {
  const normalized = normalizeText(text);
  const belt = "(?:V\\s*[-\\/]?\\s*BELT|VBELT|BELT|V\\s*[-\\/]?\\s*벨트|V벨트|벨트)";
  const action = "(?:교체|교환|REPLACE(?:MENT|D)?|EXCHANGE(?:D)?)";
  const forward = new RegExp(`${belt}(.{0,24})${action}`, "gi");
  const reverseEnglish = new RegExp(
    `(?:REPLACE(?:MENT|D)?|EXCHANGE(?:D)?)(.{0,24})${belt}`,
    "gi"
  );
  const removeAndInstall = new RegExp(
    `${belt}.{0,32}(?:취외|제거|탈거).{0,32}(?:신품|NEW)?.{0,12}(?:취부|설치|장착)`,
    "i"
  );
  const directNewInstall = new RegExp(
    `(?:${belt}.{0,20}(?:신품|NEW)|(?:신품|NEW).{0,16}${belt}).{0,16}(?:취부|설치|장착)`,
    "i"
  );
  const validForward = [...normalized.matchAll(forward)]
    .some(match => isValidBeltToReplacementGap(match[1]));
  const validReverseEnglish = [...normalized.matchAll(reverseEnglish)]
    .some(match => !/(?:후|뒤|이후|다음|점검)/i.test(match[1]));

  return validForward || validReverseEnglish || removeAndInstall.test(normalized) || directNewInstall.test(normalized);
}

function hasBeltAccessoryReplacementPhrase(text) {
  const normalized = normalizeText(text);
  const belt = "(?:V\\s*[-\\/]?\\s*BELT|VBELT|BELT|V\\s*[-\\/]?\\s*벨트|V벨트|벨트)";
  const accessory = "(?:GUARD|COVER|AUTO\\s*TENSION(?:ER)?|TENSIONER|PULLEY|SHEAVE|가드|커버|오토\\s*텐션(?:너)?|자동\\s*장력조정기|텐션(?:너)?|풀리|쉬브)";
  const action = "(?:교체|교환|REPLACE(?:MENT|D)?|EXCHANGE(?:D)?)";
  const conjunction = "(?:및|와|과|&|\\+|,)";
  const combinedForward = new RegExp(
    `${belt}\\s*${conjunction}\\s*${accessory}.{0,20}${action}`,
    "i"
  );
  const combinedReverse = new RegExp(
    `${accessory}\\s*${conjunction}\\s*${belt}.{0,20}${action}`,
    "i"
  );

  if (combinedForward.test(normalized) || combinedReverse.test(normalized)) {
    return false;
  }

  const forward = new RegExp(`${belt}.{0,16}${accessory}.{0,20}${action}`, "i");
  const reverse = new RegExp(`${action}.{0,20}${belt}.{0,16}${accessory}`, "i");
  return forward.test(normalized) || reverse.test(normalized);
}

function hasDirectCompletedBeltReplacement(text) {
  const normalized = normalizeText(text);
  const belt = "(?:V\\s*[-\\/]?\\s*BELT|VBELT|BELT|V\\s*[-\\/]?\\s*벨트|V벨트|벨트)";
  const completedAction = new RegExp(
    `${belt}(.{0,24})(?:교체|교환)\\s*(?:작업\\s*)?(?:완료|실시|시행|함|하였|했|하여)`,
    "gi"
  );
  const englishAction = new RegExp(`${belt}(.{0,24})(?:REPLACED|EXCHANGED)`, "gi");
  const newInstall = new RegExp(
    `(?:${belt}.{0,20}(?:신품|NEW)|(?:신품|NEW).{0,16}${belt}).{0,16}(?:취부|설치|장착).{0,16}(?:완료|실시|함|하였|했)`,
    "i"
  );
  const direct = [...normalized.matchAll(completedAction), ...normalized.matchAll(englishAction)]
    .some(match => (
      isValidBeltToReplacementGap(match[1]) &&
      !hasBeltAccessoryReplacementPhrase(match[0])
    ));

  return direct || newInstall.test(normalized);
}

function hasCompletedForeignComponentReplacement(text) {
  const normalized = normalizeText(text);
  const componentKeywords = [
    ...COMPONENT_REPLACEMENT_KEYWORDS,
    "guard",
    "cover",
    "auto tensioner",
    "tensioner",
    "pulley",
    "sheave",
    "가드",
    "커버",
    "오토 텐션너",
    "자동 장력조정기",
    "텐션너",
    "풀리",
    "쉬브"
  ];

  return componentKeywords.some(keyword => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (
      new RegExp(
        `${escaped}.{0,18}(?:교체|교환)\\s*(?:작업\\s*)?(?:완료|실시|시행|함|하였|했|하여)`,
        "i"
      ).test(normalized) ||
      new RegExp(`${escaped}.{0,18}(?:REPLACED|EXCHANGED)`, "i").test(normalized)
    );
  });
}

function hasDirectTagBeltReplacement(text, assets = []) {
  const normalized = normalizeText(text);
  if (extractRecognizedBlowerTags(normalized, assets).length === 0) return false;
  if (!hasBeltReplacementPhrase(normalized)) return false;
  if (hasReplacementPlanContext(normalized)) return false;
  if (hasReplacementExclusionContext(normalized)) return false;
  if (!hasExplicitReplacementCompletion(normalized)) return false;
  return true;
}

function hasContextualBlowerBeltReplacement(text) {
  const normalized = normalizeText(text);
  if (!hasBeltReplacementPhrase(normalized)) return false;
  if (hasReplacementPlanContext(normalized)) return false;
  if (hasReplacementExclusionContext(normalized)) return false;
  if (!hasExplicitReplacementCompletion(normalized)) return false;

  const types = detectBlowerTypes(normalized);
  const positions = detectPositionLabels(normalized);
  const units = detectUnitNos(normalized);
  const hasBlowerWord = /(?:blower|fan|블로워|브로워)/i.test(normalized);
  const hasShortTag = /\b(?:AP(?:611|621|631)|AN(?:611|621|631)|AN(?:001|002)|AN(?:601|602))\b/i.test(normalized);

  if (types.length !== 1) return false;
  if (positions.length === 0 && !hasShortTag) return false;
  if (units.length > 1) return false;

  return hasBlowerWord || positions.length > 0 || hasShortTag;
}

function hasActualBlowerBeltReplacementSignal(text, assets = []) {
  for (const clause of splitSemanticClauses(text)) {
    if (!hasBeltWord(clause)) continue;
    if (!hasReplacementKeyword(clause)) continue;
    if (!hasBeltReplacementPhrase(clause)) continue;
    if (hasBeltAccessoryReplacementPhrase(clause)) continue;
    if (!hasExplicitReplacementCompletion(clause)) continue;
    if (hasReplacementPlanContext(clause)) continue;
    if (hasReplacementExclusionContext(clause)) continue;

    if (hasDirectTagBeltReplacement(clause, assets)) return true;
    if (hasContextualBlowerBeltReplacement(clause)) return true;
  }

  return false;
}

function hasComponentReplacementContext(text, assets = []) {
  if (hasActualBlowerBeltReplacementSignal(text, assets)) return false;
  return splitSemanticClauses(text).some(componentReplacementPhrase);
}

function managedAssetAllowsContextualMatch(asset, workDate) {
  const tagNumber = normalizeText(asset?.tag_number).toUpperCase();
  if (ASSET_SEED_TAG_SET.has(tagNumber) || !normalizeText(asset?.asset_revision)) return true;

  const sourceDate = normalizeText(workDate).slice(0, 10);
  const createdAt = new Date(normalizeText(asset?.created_at));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || Number.isNaN(createdAt.getTime())) return false;
  return sourceDate >= formatKstDate(createdAt);
}

function findAssetMatches(fragment, assets, recognitionAssets = assets, workDate = "") {
  if (fragmentHasIdentityConflict(fragment, recognitionAssets)) return [];
  const sourceText = fragmentSourceText(fragment);
  const structuredTags = extractRecognizedBlowerTags(fragmentIdentityText(fragment), recognitionAssets);
  const analysisText = fragmentAnalysisText(fragment);
  const compact = compactEquipmentText(analysisText);
  const recognizedTags = new Set(extractRecognizedBlowerTags(analysisText, recognitionAssets));
  const explicitTagResolution = recognizedTags.size > 0
    ? resolveExplicitTagIdentity(analysisText, [...recognizedTags], recognitionAssets)
    : null;
  const unitNos = detectUnitNos(analysisText);
  const positions = detectPositionLabels(analysisText);
  const typeMatches = detectBlowerTypes(analysisText);
  const explicitUnitNos = explicitTagResolution?.units || detectUnitNos(sourceText);
  const explicitPositions = explicitTagResolution?.positions || detectExplicitPositionLabels(sourceText);
  const explicitTypeMatches = explicitTagResolution?.types || detectBlowerTypes(sourceText);
  const manureContext = explicitTagResolution
    ? explicitTagResolution.assetGroup === "manure"
    : hasManureBlowerContext(analysisText);
  const compatibleExplicitTags = new Set(explicitTagResolution?.tags || []);
  const exact = [];

  if (recognizedTags.size > 0 && !explicitTagResolution?.consistent) {
    return [];
  }

  for (const asset of assets) {
    const tag = normalizeText(asset.tag_number).toUpperCase();

    const conflictsWithContent = (
      (explicitTypeMatches.length > 0 && !explicitTypeMatches.includes(asset.blower_type)) ||
      (asset.unit_no !== "shared" && explicitUnitNos.length > 0 && !explicitUnitNos.includes(asset.unit_no)) ||
      (explicitPositions.length > 0 && !explicitPositions.includes(asset.position_label)) ||
      (manureContext && assetGroupKey(asset) !== "manure")
    );

    if (compatibleExplicitTags.has(tag) && !conflictsWithContent) {
      exact.push({ asset, strong: true, reason: "full_tag" });
    }
  }

  if (exact.length > 0) {
    const exactTagSet = new Set(exact.map(match => normalizeText(match.asset.tag_number).toUpperCase()));
    const hasUnresolvedRecognizedTag = [...recognizedTags].some(tag => !exactTagSet.has(tag));
    const exactPositionsAreExplicit = exact.every(match =>
      explicitPositions.includes(match.asset.position_label)
    );
    const groupIdentityIsConsistent = (
      !hasUnresolvedRecognizedTag &&
      exact.length === 1 &&
      structuredTags.length === 1 &&
      explicitPositions.length > 1 &&
      exactPositionsAreExplicit &&
      explicitTypeMatches.length === 1 &&
      explicitTypeMatches[0] === exact[0].asset.blower_type &&
      (
        exact[0].asset.unit_no === "shared"
          ? explicitUnitNos.length === 0
          : (explicitUnitNos.length === 1 && explicitUnitNos[0] === exact[0].asset.unit_no)
      )
    );

    if (groupIdentityIsConsistent) {
      const blowerType = exact[0].asset.blower_type;
      const unitNo = exact[0].asset.unit_no;
      const groupKey = assetGroupKey(exact[0].asset);
      const exactTags = new Set(exact.map(match => match.asset.tag_number));

      for (const asset of assets) {
        if (asset.blower_type !== blowerType || asset.unit_no !== unitNo) continue;
        if (assetGroupKey(asset) !== groupKey) continue;
        if (!explicitPositions.includes(asset.position_label)) continue;
        if (exactTags.has(asset.tag_number)) continue;
        if (!managedAssetAllowsContextualMatch(asset, workDate)) continue;
        exact.push({ asset, strong: true, reason: "structured_tag_group_position" });
        exactTags.add(asset.tag_number);
      }
    }

    return exact;
  }

  // A recognized TAG is an explicit equipment identity.  If that TAG is not
  // present in the active catalog (for example, a disabled predecessor), do
  // not fall back to type/unit/position and accidentally attribute its old
  // log entry to a replacement asset in the same slot.
  if (recognizedTags.size > 0) {
    return [];
  }

  if (structuredTags.length > 0) {
    return [];
  }

  const contextual = [];

  for (const asset of assets) {
    if (!managedAssetAllowsContextualMatch(asset, workDate)) continue;
    if (typeMatches.length !== 1 || !typeMatches.includes(asset.blower_type)) {
      continue;
    }

    const requiredGroup = asset.blower_type === "organic_fuel" && manureContext
      ? "manure"
      : "";
    if (assetGroupKey(asset) !== requiredGroup) continue;

    if (asset.unit_no !== "shared") {
      if (unitNos.length !== 1 || unitNos[0] !== asset.unit_no) continue;
    }

    const tag = normalizeText(asset.tag_number).toUpperCase();
    const fixedTagDefinition = classifyRecognizedBlowerTag(tag);
    const suffix = compactEquipmentText(tag.slice(3));
    const shortToken = compactEquipmentText(tag.slice(-5));
    const suffixMatched = Boolean(fixedTagDefinition && suffix && compact.includes(suffix));
    const shortMatched = Boolean(fixedTagDefinition && shortToken && compact.includes(shortToken));
    const positionMatched = positions.includes(asset.position_label);

    if (suffixMatched || shortMatched || positionMatched) {
      contextual.push({ asset, strong: true, reason: positionMatched ? "content_type_unit_position" : "type_unit_context" });
    }
  }

  return contextual;
}

function isGroupedContextReference(fragment, matches) {
  if (matches.length < 2) return false;
  const analysisText = fragmentAnalysisText(fragment);
  const types = detectBlowerTypes(analysisText);
  const units = detectUnitNos(analysisText);
  const positions = detectPositionLabels(analysisText);
  if (types.length !== 1 || positions.length < 2) return false;
  if (matches.some(match => match.asset.blower_type !== types[0])) return false;

  const nonShared = matches.filter(match => match.asset.unit_no !== "shared");
  if (nonShared.length > 0) {
    if (units.length !== 1 || nonShared.some(match => match.asset.unit_no !== units[0])) return false;
  }

  const matchedPositions = new Set(matches.map(match => match.asset.position_label));
  return positions.every(position => matchedPositions.has(position));
}

function detectedEventSpecs(fragment, assets = []) {
  const sourceText = fragmentSourceText(fragment);
  const analysisText = fragmentAnalysisText(fragment);
  const hasBeltReplacement = (
    hasReplacementKeyword(sourceText) &&
    hasBeltReplacementPhrase(sourceText)
  );

  if (!hasBeltReplacement) {
    return [];
  }

  if (hasBeltAccessoryReplacementPhrase(sourceText)) {
    return [];
  }

  const autoEligible = hasActualBlowerBeltReplacementSignal(analysisText, assets);

  if (
    !autoEligible &&
    (hasReplacementPlanContext(sourceText) || hasReplacementExclusionContext(sourceText))
  ) {
    return [];
  }

  return [{
    detectedType: "replacement",
    issueType: findIssueType(sourceText) || "정기주기",
    actionType: "V-Belt 교체",
    autoEligible
  }];
}

function resolveHistoricalMatches(fragment, matches, spec) {
  if (matches.length === 1) return [matches[0]];
  if (matches.length === 0) return [];

  const analysisText = fragmentAnalysisText(fragment);

  const exactOnly = matches.every(match =>
    ["full_tag", "structured_tag_group_position"].includes(match.reason)
  );
  if (exactOnly) {
    const types = new Set(matches.map(match => match.asset.blower_type));
    const units = new Set(matches.map(match => match.asset.unit_no));
    const mentionedPositions = new Set(detectPositionLabels(analysisText));
    const matchedPositions = new Set(matches.map(match => match.asset.position_label));
    const allPositionsExplicit = [...matchedPositions].every(position =>
      mentionedPositions.has(position)
    );

    if (types.size === 1 && units.size === 1 && allPositionsExplicit) {
      return matches;
    }
  }

  if (isGroupedContextReference(fragment, matches)) {
    return matches;
  }

  return [];
}

async function findExistingDetection(database, row, tagNumber, detectedType) {
  const fingerprint = buildDetectionFingerprint(row, tagNumber, detectedType);
  const candidate = await database
    .prepare(`
      SELECT *
      FROM blower_history_candidates
      WHERE source_fingerprint = ?
      LIMIT 1
    `)
    .bind(fingerprint)
    .first();

  if (candidate) {
    return { candidate, event: null };
  }

  const excludedResult = await database
    .prepare(`
      SELECT *
      FROM blower_history_candidates
      WHERE source_log_id = ?
        AND tag_number = ?
        AND detected_type = ?
        AND status = 'excluded'
      ORDER BY reviewed_at DESC, created_at DESC
      LIMIT 20
    `)
    .bind(normalizeText(row?.id), tagNumber, detectedType)
    .all();
  const currentSourceKey = normalizeSimilarityText(row?.sourceText);
  const priorExcluded = (Array.isArray(excludedResult.results) ? excludedResult.results : [])
    .find(item => (
      currentSourceKey &&
      normalizeSimilarityText(item.source_text) === currentSourceKey
    ));

  if (priorExcluded) {
    return { candidate: priorExcluded, event: null };
  }

  const detectedDate = detectionDateTime(row) || normalizeDateTime(row.work_date);
  const parsedDetectedDate = new Date(detectedDate);
  const dayText = Number.isNaN(parsedDetectedDate.getTime())
    ? normalizeText(row.work_date).slice(0, 10)
    : formatKstDate(parsedDetectedDate);
  const event = await database
    .prepare(`
      SELECT *
      FROM blower_history_events
      WHERE source_log_id = ?
        AND tag_number = ?
        AND event_type = ?
      LIMIT 1
    `)
    .bind(row.id, tagNumber, detectedType)
    .first();

  if (event) {
    return { candidate: null, event, dayText };
  }

  const sameDayCandidate = await database
    .prepare(`
      SELECT *
      FROM blower_history_candidates
      WHERE tag_number = ?
        AND detected_type = ?
        AND date(detected_date, '+9 hours') = ?
        AND status IN ('confirmed', 'auto_confirmed')
      ORDER BY created_at ASC
      LIMIT 1
    `)
    .bind(tagNumber, detectedType, dayText)
    .first();

  if (sameDayCandidate) {
    return { candidate: sameDayCandidate, event: null, dayText };
  }

  const sameDayEvent = await findSameDayEvent(
    database,
    tagNumber,
    detectedType,
    detectedDate,
    ""
  );

  return { candidate: null, event: sameDayEvent, dayText };
}

async function findSameDayEvent(database, tagNumber, detectedType, eventDate, issueType) {
  const parsedEventDate = new Date(eventDate);
  const dateText = Number.isNaN(parsedEventDate.getTime())
    ? normalizeText(eventDate).slice(0, 10)
    : formatKstDate(parsedEventDate);

  if (detectedType === "replacement") {
    return database
      .prepare(`
        SELECT id, event_date, source_type, created_by_id
        FROM blower_history_events
        WHERE tag_number = ?
          AND event_type = 'replacement'
          AND date(event_date, '+9 hours') = ?
        LIMIT 1
      `)
      .bind(tagNumber, dateText)
      .first();
  }

  return database
    .prepare(`
      SELECT id, event_date, source_type, created_by_id
      FROM blower_history_events
      WHERE tag_number = ?
        AND event_type = 'problem'
        AND date(event_date, '+9 hours') = ?
        AND issue_type = ?
      LIMIT 1
    `)
    .bind(tagNumber, dateText, normalizeText(issueType))
    .first();
}

async function estimateHistoricalRuntime(database, tagNumber, eventDate) {
  const previous = await database
    .prepare(`
      SELECT event_date
      FROM blower_history_events
      WHERE tag_number = ?
        AND event_type = 'replacement'
        AND event_date < ?
      ORDER BY event_date DESC, created_at DESC
      LIMIT 1
    `)
    .bind(tagNumber, eventDate)
    .first();

  if (!previous?.event_date) {
    return 0;
  }

  const previousDate = new Date(previous.event_date);
  const currentDate = new Date(eventDate);

  if (Number.isNaN(previousDate.getTime()) || Number.isNaN(currentDate.getTime())) {
    return 0;
  }

  return Math.max(0, (currentDate.getTime() - previousDate.getTime()) / 3600000);
}

async function insertDetectionCandidate(database, row, tagNumber, spec, status, reviewedAt = null) {
  const existing = await findExistingDetection(database, row, tagNumber, spec.detectedType);

  if (existing.candidate || existing.event) {
    return {
      candidate: existing.candidate,
      inserted: false,
      alreadyEvent: Boolean(existing.event)
    };
  }

  const now = new Date().toISOString();
  const fingerprint = buildDetectionFingerprint(row, tagNumber, spec.detectedType);
  const id = crypto.randomUUID();

  const result = await database
    .prepare(`
      INSERT OR IGNORE INTO blower_history_candidates (
        id,
        source_fingerprint,
        tag_number,
        detected_type,
        detected_date,
        issue_type,
        action_type,
        source_log_id,
        source_shift,
        source_role,
        source_author,
        source_text,
        status,
        reviewed_by_id,
        reviewed_by_name,
        reviewed_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      fingerprint,
      tagNumber,
      spec.detectedType,
      detectionDateTime(row) || normalizeDateTime(row.work_date),
      spec.issueType,
      spec.actionType,
      row.id,
      normalizeText(row.shift),
      normalizeText(row.role),
      normalizeText(row.author),
      normalizeText(row.sourceText).slice(0, 2000),
      status,
      status === "auto_confirmed" ? "history_auto" : "",
      status === "auto_confirmed" ? "업무일지 과거 자동반영" : "",
      reviewedAt,
      now
    )
    .run();

  const inserted = Number(result?.meta?.changes || 0) > 0;
  const candidate = inserted
    ? await database.prepare(`SELECT * FROM blower_history_candidates WHERE id = ? LIMIT 1`).bind(id).first()
    : await database
        .prepare(`
          SELECT *
          FROM blower_history_candidates
          WHERE source_fingerprint = ?
          LIMIT 1
        `)
        .bind(fingerprint)
        .first();

  return { candidate, inserted, alreadyEvent: false };
}

async function reconcileHistoricalReplacementState(database, tagNumber, eventDate) {
  const asset = await findAsset(database, tagNumber);
  if (!asset) return false;

  const eventValue = new Date(eventDate);
  const currentValue = asset.last_replacement_at ? new Date(asset.last_replacement_at) : null;
  const shouldUpdateCurrent = (
    !Number.isNaN(eventValue.getTime()) &&
    (!currentValue || Number.isNaN(currentValue.getTime()) || eventValue > currentValue)
  );

  if (!shouldUpdateCurrent) return false;

  const laterManualCorrection = await database
    .prepare(`
      SELECT id
      FROM blower_history_events
      WHERE tag_number = ?
        AND event_type = 'runtime_correction'
        AND source_type = 'manual'
        AND event_date >= ?
      ORDER BY event_date DESC, created_at DESC
      LIMIT 1
    `)
    .bind(tagNumber, eventDate)
    .first();
  const now = new Date().toISOString();

  if (laterManualCorrection) {
    await database
      .prepare(`
        UPDATE blower_history_assets
        SET last_replacement_at = ?, updated_at = ?
        WHERE tag_number = ?
      `)
      .bind(eventDate, now, tagNumber)
      .run();
    return true;
  }

  const isRunning = Number(asset.is_running) === 1;
  await database
    .prepare(`
      UPDATE blower_history_assets
      SET
        last_replacement_at = ?,
        runtime_hours = 0,
        runtime_anchor_at = ?,
        last_modified_by_id = 'history_auto',
        last_modified_by_name = '업무일지 과거 자동반영',
        updated_at = ?
      WHERE tag_number = ?
    `)
    .bind(eventDate, isRunning ? eventDate : null, now, tagNumber)
    .run();
  return true;
}

async function insertHistoricalEvent(database, row, candidate, spec) {
  const tagNumber = normalizeText(candidate.tag_number).toUpperCase();
  const eventDate = normalizeDateTime(candidate.detected_date || row.work_date);

  const sameDay = await findSameDayEvent(
    database,
    tagNumber,
    spec.detectedType,
    eventDate,
    spec.issueType
  );

  if (sameDay) {
    if (
      spec.detectedType === "replacement" &&
      normalizeText(sameDay.source_type) === "shift_log_history_auto" &&
      normalizeText(sameDay.created_by_id) === "history_auto"
    ) {
      await reconcileHistoricalReplacementState(database, tagNumber, sameDay.event_date);
    }

    await database
      .prepare(`
        UPDATE blower_history_candidates
        SET
          status = 'auto_confirmed',
          reviewed_by_id = 'history_auto',
          reviewed_by_name = '업무일지 과거 자동반영',
          reviewed_at = ?
        WHERE id = ? AND status = 'pending'
      `)
      .bind(new Date().toISOString(), candidate.id)
      .run();

    return { inserted: false, duplicate: true };
  }

  const runtimeHours = await estimateHistoricalRuntime(database, tagNumber, eventDate);
  const systemUser = {
    employeeNo: "history_auto",
    name: "업무일지 과거 자동반영"
  };

  const eventResult = await insertEvent(database, systemUser, {
    id: `history-auto:${candidate.id}`,
    tagNumber,
    eventType: spec.detectedType,
    eventDate,
    runtimeHours,
    issueType: spec.issueType,
    actionType: spec.actionType,
    note: "",
    sourceType: "shift_log_history_auto",
    sourceLogId: row.id,
    sourceText: normalizeText(row.sourceText)
  });

  if (spec.detectedType === "replacement") {
    await reconcileHistoricalReplacementState(database, tagNumber, eventDate);
  }

  await database
    .prepare(`
      UPDATE blower_history_candidates
      SET
        status = 'auto_confirmed',
        reviewed_by_id = 'history_auto',
        reviewed_by_name = '업무일지 과거 자동반영',
        reviewed_at = ?
      WHERE id = ?
    `)
    .bind(new Date().toISOString(), candidate.id)
    .run();

  return { inserted: eventResult.inserted, duplicate: !eventResult.inserted };
}

async function processHistoricalLog(
  database,
  row,
  assets,
  fragmentsOverride = null,
  recognitionAssets = assets
) {
  const sourceFragments = Array.isArray(fragmentsOverride)
    ? fragmentsOverride
    : parseShiftLogFragments(row, recognitionAssets);
  const uniqueFragments = new Map();

  for (const fragment of sourceFragments) {
    uniqueFragments.set(fragmentStableKey(fragment), fragment);
  }

  const fragments = [...uniqueFragments.values()];

  if (fragments.length === 0) {
    return { autoEvents: 0, pending: 0 };
  }

  let autoEvents = 0;
  let pending = 0;
  const seen = new Set();

  for (const fragment of fragments) {
    await ensureDiscoveredAssets(database, fragmentAnalysisText(fragment), assets);

    const matches = findAssetMatches(
      fragment,
      assets,
      recognitionAssets,
      row?.work_date
    );
    const specs = detectedEventSpecs(fragment, recognitionAssets);
    if (specs.length === 0 || matches.length === 0) {
      continue;
    }

    for (const spec of specs) {
      const resolvedMatches = (
        spec.autoEligible
          ? resolveHistoricalMatches(fragment, matches, spec)
          : (matches.length === 1 || isGroupedContextReference(fragment, matches) ? matches : [])
      )
        .filter(match => match && match.strong);

      for (const match of resolvedMatches) {
        const eventKey = `${row.id}::${match.asset.tag_number}::${spec.detectedType}`;

        if (seen.has(eventKey)) {
          continue;
        }

        seen.add(eventKey);
        const sourceRow = {
          ...row,
          sourceText: fragmentSourceText(fragment),
          sourceTime: fragmentSourceTime(fragment)
        };
        const detection = await insertDetectionCandidate(
          database,
          sourceRow,
          match.asset.tag_number,
          spec,
          spec.autoEligible ? "auto_confirmed" : "pending",
          spec.autoEligible ? new Date().toISOString() : null
        );

        if (detection.alreadyEvent) {
          continue;
        }

        if (!spec.autoEligible) {
          if (detection.inserted) pending += 1;
          continue;
        }

        const candidate = detection.candidate;

        if (!candidate || (["confirmed", "excluded"].includes(candidate.status) && !detection.inserted)) {
          continue;
        }

        const result = await insertHistoricalEvent(database, sourceRow, candidate, spec);
        if (result.inserted) autoEvents += 1;
      }
    }
  }

  return { autoEvents, pending };
}

async function resetHistoricalAutoDataForV9(database, today) {
  const now = new Date().toISOString();

  await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_event_archive (
        migration_id,
        id,
        tag_number,
        event_type,
        event_date,
        runtime_hours,
        issue_type,
        action_type,
        note,
        source_type,
        source_log_id,
        source_text,
        created_by_id,
        created_by_name,
        created_at,
        updated_at,
        archived_at
      )
      SELECT
        ?,
        id,
        tag_number,
        event_type,
        event_date,
        runtime_hours,
        issue_type,
        action_type,
        note,
        source_type,
        source_log_id,
        source_text,
        created_by_id,
        created_by_name,
        created_at,
        updated_at,
        ?
      FROM blower_history_events
      WHERE source_type IN ('shift_log_auto', 'shift_log_history_auto')
    `).bind(HISTORY_BACKFILL_ID, now),
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_candidate_archive (
        migration_id,
        id,
        source_fingerprint,
        tag_number,
        detected_type,
        detected_date,
        issue_type,
        action_type,
        source_log_id,
        source_shift,
        source_role,
        source_author,
        source_text,
        status,
        reviewed_by_id,
        reviewed_by_name,
        reviewed_at,
        created_at,
        archived_at
      )
      SELECT
        ?,
        id,
        source_fingerprint,
        tag_number,
        detected_type,
        detected_date,
        issue_type,
        action_type,
        source_log_id,
        source_shift,
        source_role,
        source_author,
        source_text,
        status,
        reviewed_by_id,
        reviewed_by_name,
        reviewed_at,
        created_at,
        ?
      FROM blower_history_candidates
      WHERE status IN ('pending', 'confirmed', 'auto_confirmed')
    `).bind(HISTORY_BACKFILL_ID, now),
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_reference_archive (
        migration_id,
        tag_number,
        reference_date,
        source_log_id,
        source_text,
        reference_kind,
        updated_at,
        archived_at
      )
      SELECT
        ?,
        tag_number,
        reference_date,
        source_log_id,
        source_text,
        reference_kind,
        updated_at,
        ?
      FROM blower_history_references
    `).bind(HISTORY_BACKFILL_ID, now),
    database.prepare(`
      UPDATE blower_history_assets
      SET
        last_replacement_at = (
          SELECT event.event_date
          FROM blower_history_events AS event
          WHERE event.tag_number = blower_history_assets.tag_number
            AND event.event_type = 'replacement'
            AND event.source_type NOT IN ('shift_log_auto', 'shift_log_history_auto')
          ORDER BY event.event_date DESC, event.created_at DESC
          LIMIT 1
        ),
        runtime_hours = CASE
          WHEN EXISTS (
            SELECT 1
            FROM blower_history_events AS event
            WHERE event.tag_number = blower_history_assets.tag_number
              AND event.event_type = 'replacement'
              AND event.source_type IN ('shift_log_auto', 'shift_log_history_auto')
              AND event.event_date = blower_history_assets.last_replacement_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM blower_history_events AS correction
            WHERE correction.tag_number = blower_history_assets.tag_number
              AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= blower_history_assets.last_replacement_at
          ) THEN 0
          ELSE runtime_hours
        END,
        runtime_anchor_at = CASE
          WHEN EXISTS (
            SELECT 1
            FROM blower_history_events AS event
            WHERE event.tag_number = blower_history_assets.tag_number
              AND event.event_type = 'replacement'
              AND event.source_type IN ('shift_log_auto', 'shift_log_history_auto')
              AND event.event_date = blower_history_assets.last_replacement_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM blower_history_events AS correction
            WHERE correction.tag_number = blower_history_assets.tag_number
              AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= blower_history_assets.last_replacement_at
          ) THEN NULL
          ELSE runtime_anchor_at
        END,
        is_running = CASE
          WHEN EXISTS (
            SELECT 1
            FROM blower_history_events AS event
            WHERE event.tag_number = blower_history_assets.tag_number
              AND event.event_type = 'replacement'
              AND event.source_type IN ('shift_log_auto', 'shift_log_history_auto')
              AND event.event_date = blower_history_assets.last_replacement_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM blower_history_events AS correction
            WHERE correction.tag_number = blower_history_assets.tag_number
              AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= blower_history_assets.last_replacement_at
          ) THEN 0
          ELSE is_running
        END,
        last_modified_by_id = CASE
          WHEN EXISTS (
            SELECT 1
            FROM blower_history_events AS event
            WHERE event.tag_number = blower_history_assets.tag_number
              AND event.event_type = 'replacement'
              AND event.source_type IN ('shift_log_auto', 'shift_log_history_auto')
              AND event.event_date = blower_history_assets.last_replacement_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM blower_history_events AS correction
            WHERE correction.tag_number = blower_history_assets.tag_number
              AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= blower_history_assets.last_replacement_at
          ) THEN ''
          ELSE last_modified_by_id
        END,
        last_modified_by_name = CASE
          WHEN EXISTS (
            SELECT 1
            FROM blower_history_events AS event
            WHERE event.tag_number = blower_history_assets.tag_number
              AND event.event_type = 'replacement'
              AND event.source_type IN ('shift_log_auto', 'shift_log_history_auto')
              AND event.event_date = blower_history_assets.last_replacement_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM blower_history_events AS correction
            WHERE correction.tag_number = blower_history_assets.tag_number
              AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= blower_history_assets.last_replacement_at
          ) THEN ''
          ELSE last_modified_by_name
        END,
        updated_at = ?
      WHERE enabled = 1
        AND EXISTS (
          SELECT 1
          FROM blower_history_events AS event
          WHERE event.tag_number = blower_history_assets.tag_number
            AND event.event_type = 'replacement'
            AND event.source_type IN ('shift_log_auto', 'shift_log_history_auto')
        )
    `).bind(now),
    database.prepare(`
      DELETE FROM blower_history_candidates
      WHERE status IN ('pending', 'confirmed', 'auto_confirmed')
        AND EXISTS (
          SELECT 1
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = blower_history_candidates.tag_number
            AND asset.enabled = 1
        )
    `),
    database.prepare(`
      DELETE FROM blower_history_events
      WHERE source_type IN ('shift_log_auto', 'shift_log_history_auto')
        AND EXISTS (
          SELECT 1
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = blower_history_events.tag_number
            AND asset.enabled = 1
        )
    `),
    database.prepare(`
      DELETE FROM blower_history_references
      WHERE EXISTS (
        SELECT 1
        FROM blower_history_assets AS asset
        WHERE asset.tag_number = blower_history_references.tag_number
          AND asset.enabled = 1
      )
    `),
    database.prepare(`
      UPDATE blower_history_backfill_state
      SET status = 'running', updated_at = ?
      WHERE id = ? AND status = 'initializing'
    `).bind(now, HISTORY_BACKFILL_ID)
  ]);
}

async function initializeBackfillRun(database, today) {
  let state = await database
    .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
    .bind(HISTORY_BACKFILL_ID)
    .first();
  const now = new Date().toISOString();

  if (!state) {
    const claim = await database
      .prepare(`
        INSERT OR IGNORE INTO blower_history_backfill_state (
          id,
          target_date,
          cursor_date,
          cursor_id,
          status,
          scanned_logs,
          auto_confirmed_events,
          pending_candidates,
          started_at,
          completed_at,
          updated_at
        )
        VALUES (?, ?, '', '', 'initializing', 0, 0, 0, ?, NULL, ?)
      `)
      .bind(HISTORY_BACKFILL_ID, today, now, now)
      .run();

    if (Number(claim?.meta?.changes || 0) === 0) {
      return database
        .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
        .bind(HISTORY_BACKFILL_ID)
        .first();
    }

    await resetHistoricalAutoDataForV9(database, today);

    return database
      .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
      .bind(HISTORY_BACKFILL_ID)
      .first();
  }

  if (normalizeText(state.status) === "initializing") {
    const stateUpdatedAt = new Date(state.updated_at || 0);
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);

    if (!Number.isNaN(stateUpdatedAt.getTime()) && stateUpdatedAt > staleBefore) {
      return state;
    }

    const reclaim = await database
      .prepare(`
        UPDATE blower_history_backfill_state
        SET target_date = ?, updated_at = ?
        WHERE id = ?
          AND status = 'initializing'
          AND updated_at = ?
      `)
      .bind(today, now, HISTORY_BACKFILL_ID, normalizeText(state.updated_at))
      .run();

    if (Number(reclaim?.meta?.changes || 0) === 0) {
      return database
        .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
        .bind(HISTORY_BACKFILL_ID)
        .first();
    }

    await resetHistoricalAutoDataForV9(database, today);

    return database
      .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
      .bind(HISTORY_BACKFILL_ID)
      .first();
  }

  if (normalizeText(state.status) === "processing") {
    const stateUpdatedAt = new Date(state.updated_at || 0);
    const staleBefore = new Date(Date.now() - HISTORY_BACKFILL_STALE_LEASE_MS);

    if (!Number.isNaN(stateUpdatedAt.getTime()) && stateUpdatedAt > staleBefore) {
      return state;
    }

    const reclaimed = await database
      .prepare(`
        UPDATE blower_history_backfill_state
        SET status = 'running', updated_at = ?
        WHERE id = ?
          AND status = 'processing'
          AND updated_at = ?
      `)
      .bind(now, HISTORY_BACKFILL_ID, normalizeText(state.updated_at))
      .run();

    if (Number(reclaimed?.meta?.changes || 0) === 0) {
      return database
        .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
        .bind(HISTORY_BACKFILL_ID)
        .first();
    }

    state = await database
      .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
      .bind(HISTORY_BACKFILL_ID)
      .first();

    if (normalizeText(state?.status) === "processing") {
      return state;
    }
  }

  if (normalizeText(state.status) === "complete" && normalizeText(state.target_date) === today) {
    return state;
  }

  if (normalizeText(state.target_date) !== today) {
    const previousTarget = normalizeText(state.target_date);
    const previousStatus = normalizeText(state.status);
    const advancedTarget = previousStatus === "complete"
      ? await database
          .prepare(`
            UPDATE blower_history_backfill_state
            SET
              target_date = ?,
              cursor_date = ?,
              cursor_id = '',
              status = 'running',
              scanned_logs = 0,
              auto_confirmed_events = 0,
              pending_candidates = 0,
              started_at = ?,
              completed_at = NULL,
              updated_at = ?
            WHERE id = ?
              AND status = 'complete'
              AND target_date = ?
              AND updated_at = ?
          `)
          .bind(
            today,
            previousTarget,
            now,
            now,
            HISTORY_BACKFILL_ID,
            previousTarget,
            normalizeText(state.updated_at)
          )
          .run()
      : await database
          .prepare(`
            UPDATE blower_history_backfill_state
            SET
              target_date = ?,
              status = 'running',
              started_at = COALESCE(started_at, ?),
              completed_at = NULL,
              updated_at = ?
            WHERE id = ?
              AND status = ?
              AND target_date = ?
              AND cursor_date = ?
              AND cursor_id = ?
              AND updated_at = ?
          `)
          .bind(
            today,
            now,
            now,
            HISTORY_BACKFILL_ID,
            previousStatus,
            previousTarget,
            normalizeText(state.cursor_date),
            normalizeText(state.cursor_id),
            normalizeText(state.updated_at)
          )
          .run();

    if (Number(advancedTarget?.meta?.changes || 0) === 0) {
      return database
        .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
        .bind(HISTORY_BACKFILL_ID)
        .first();
    }
  } else if (normalizeText(state.status) !== "running") {
    const resumed = await database
      .prepare(`
        UPDATE blower_history_backfill_state
        SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = ?
          AND status = ?
          AND updated_at = ?
      `)
      .bind(now, now, HISTORY_BACKFILL_ID, normalizeText(state.status), normalizeText(state.updated_at))
      .run();

    if (Number(resumed?.meta?.changes || 0) === 0) {
      return database
        .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
        .bind(HISTORY_BACKFILL_ID)
        .first();
    }
  }

  return database
    .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
    .bind(HISTORY_BACKFILL_ID)
    .first();
}

async function historicalBackfillStep(database) {
  const today = formatKstDate(new Date());
  const state = await initializeBackfillRun(database, today);

  if (normalizeText(state?.status) === "initializing") {
    return jsonResponse({
      ok: true,
      done: false,
      busy: true,
      message: "과거 자동반영 자료를 안전하게 정리하고 있습니다. 잠시 후 다시 실행해 주세요.",
      backfill: await loadBackfillState(database)
    });
  }

  if (normalizeText(state?.status) === "processing") {
    return jsonResponse({
      ok: true,
      done: false,
      busy: true,
      message: "다른 재구성 작업이 같은 구간을 처리하고 있습니다.",
      backfill: await loadBackfillState(database)
    });
  }

  if (normalizeText(state.status) === "complete" && normalizeText(state.target_date) === today) {
    return jsonResponse({
      ok: true,
      done: true,
      message: `${today}까지 과거 업무일지 자동 반영이 완료되어 있습니다.`,
      backfill: await loadBackfillState(database)
    });
  }

  const leaseAt = new Date().toISOString();
  const lease = await database
    .prepare(`
      UPDATE blower_history_backfill_state
      SET status = 'processing', updated_at = ?
      WHERE id = ?
        AND status = 'running'
        AND cursor_date = ?
        AND cursor_id = ?
        AND updated_at = ?
    `)
    .bind(
      leaseAt,
      HISTORY_BACKFILL_ID,
      normalizeText(state.cursor_date),
      normalizeText(state.cursor_id),
      normalizeText(state.updated_at)
    )
    .run();

  if (Number(lease?.meta?.changes || 0) === 0) {
    return jsonResponse({
      ok: true,
      done: false,
      busy: true,
      message: "다른 재구성 작업이 먼저 시작되었습니다.",
      backfill: await loadBackfillState(database)
    });
  }

  const cursorDate = normalizeText(state.cursor_date);
  const cursorId = normalizeText(state.cursor_id);
  let query;

  if (cursorDate) {
    query = database
      .prepare(`
        SELECT id, work_date, shift, role, author, status, log_json
        FROM shift_logs
        WHERE work_date >= ?
          AND work_date <= ?
          AND status = '결재완료'
          AND (work_date > ? OR (work_date = ? AND id > ?))
        ORDER BY work_date ASC, id ASC
        LIMIT ?
      `)
      .bind(HISTORY_BACKFILL_START_DATE, today, cursorDate, cursorDate, cursorId, HISTORY_BACKFILL_BATCH_SIZE);
  } else {
    query = database
      .prepare(`
        SELECT id, work_date, shift, role, author, status, log_json
        FROM shift_logs
        WHERE work_date >= ?
          AND work_date <= ?
          AND status = '결재완료'
        ORDER BY work_date ASC, id ASC
        LIMIT ?
      `)
      .bind(HISTORY_BACKFILL_START_DATE, today, HISTORY_BACKFILL_BATCH_SIZE);
  }

  const result = await query.all();
  const logs = Array.isArray(result.results) ? result.results : [];

  if (logs.length === 0) {
    const now = new Date().toISOString();
    const completed = await database
      .prepare(`
        UPDATE blower_history_backfill_state
        SET
          status = 'complete',
          auto_confirmed_events = (
            SELECT COUNT(*)
            FROM blower_history_events
            WHERE source_type = 'shift_log_history_auto'
              AND created_by_id = 'history_auto'
          ),
          pending_candidates = (
            SELECT COUNT(*)
            FROM blower_history_candidates
            WHERE status = 'pending'
          ),
          completed_at = ?,
          updated_at = ?
        WHERE id = ?
          AND status = 'processing'
          AND updated_at = ?
      `)
      .bind(now, now, HISTORY_BACKFILL_ID, leaseAt)
      .run();

    if (Number(completed?.meta?.changes || 0) === 0) {
      return jsonResponse({
        ok: true,
        done: false,
        busy: true,
        message: "재구성 작업 상태가 변경되어 현재 상태를 다시 확인합니다.",
        backfill: await loadBackfillState(database)
      });
    }

    return jsonResponse({
      ok: true,
      done: true,
      message: `${today}까지 과거 업무일지 자동 반영을 완료했습니다.`,
      backfill: await loadBackfillState(database)
    });
  }

  const assetResult = await database
    .prepare(`
      SELECT *
      FROM blower_history_assets
      ORDER BY sort_order ASC, tag_number ASC
    `)
    .all();
  const recognitionAssets = Array.isArray(assetResult.results) ? assetResult.results : [];
  const assets = recognitionAssets.filter(asset => Number(asset.enabled) === 1);
  const upperRoleRows = await loadUpperRoleRowsForDates(database, logs);
  const rolePriorityContext = buildRolePriorityContext([
    ...logs,
    ...upperRoleRows
  ], recognitionAssets);
  let autoEvents = 0;
  let pending = 0;
  let excludedPartLeaderLogs = 0;
  let suppressedDuplicateFragments = 0;

  for (const row of logs) {
    const fragments = parseShiftLogFragments(row, recognitionAssets);
    const prioritized = applyDutyRolePriority(row, fragments, rolePriorityContext, recognitionAssets);

    if (prioritized.excludedPartLeader) {
      excludedPartLeaderLogs += 1;
      continue;
    }

    suppressedDuplicateFragments += prioritized.suppressedDuplicateFragments;

    const processed = await processHistoricalLog(
      database,
      row,
      assets,
      prioritized.fragments,
      recognitionAssets
    );
    autoEvents += processed.autoEvents;
    pending += processed.pending;
  }

  const last = logs[logs.length - 1];
  const done = logs.length < HISTORY_BACKFILL_BATCH_SIZE;
  const now = new Date().toISOString();

  const advanced = await database
    .prepare(`
      UPDATE blower_history_backfill_state
      SET
        cursor_date = ?,
        cursor_id = ?,
        status = ?,
        scanned_logs = scanned_logs + ?,
        auto_confirmed_events = CASE
          WHEN ? = 1 THEN (
            SELECT COUNT(*)
            FROM blower_history_events
            WHERE source_type = 'shift_log_history_auto'
              AND created_by_id = 'history_auto'
          )
          ELSE auto_confirmed_events + ?
        END,
        pending_candidates = CASE
          WHEN ? = 1 THEN (
            SELECT COUNT(*)
            FROM blower_history_candidates
            WHERE status = 'pending'
          )
          ELSE pending_candidates + ?
        END,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
        AND status = 'processing'
        AND updated_at = ?
    `)
    .bind(
      normalizeText(last.work_date),
      normalizeText(last.id),
      done ? "complete" : "running",
      logs.length,
      done ? 1 : 0,
      autoEvents,
      done ? 1 : 0,
      pending,
      done ? now : null,
      now,
      HISTORY_BACKFILL_ID,
      leaseAt
    )
    .run();

  if (Number(advanced?.meta?.changes || 0) === 0) {
    return jsonResponse({
      ok: true,
      done: false,
      busy: true,
      message: "재구성 작업 상태가 변경되어 현재 상태를 다시 확인합니다.",
      backfill: await loadBackfillState(database)
    });
  }

  return jsonResponse({
    ok: true,
    done,
    message: done
      ? `${today}까지 과거 업무일지 자동 반영을 완료했습니다.`
      : `과거 업무일지 ${logs.length}건을 추가 확인했습니다.`,
    batchScanned: logs.length,
    batchAutoEvents: autoEvents,
    batchPending: pending,
    batchExcludedPartLeaderLogs: excludedPartLeaderLogs,
    batchSuppressedDuplicateFragments: suppressedDuplicateFragments,
    backfill: await loadBackfillState(database)
  });
}


const OPERATION_POSITION_TOKEN_SOURCE = "(?:#\\s*[ABC]\\b|(?:AP|AN)?\\s*(?:611|621|631|001|002|601|602)\\b)";
const OPERATION_START_KEYWORD_SOURCE = "(?:재?기동|가동|START(?:ED)?|운전\\s*(?:시작|개시))";
const OPERATION_STOP_KEYWORD_SOURCE = "(?:정지|STOP(?:PED)?|SHUT\\s*DOWN)";

function operationPositionFromToken(value) {
  const normalized = normalizeText(value).toUpperCase().replace(/\s+/g, "");
  const letter = normalized.match(/#?([ABC])\b/);
  if (letter) return `#${letter[1]}`;

  const suffix = normalized.match(/(611|621|631|001|002|601|602)$/)?.[1] || "";
  return ({
    "611": "#A", "621": "#B", "631": "#C",
    "001": "#A", "002": "#B",
    "601": "#A", "602": "#B"
  })[suffix] || "";
}

function operationPositionTokens(text) {
  const source = normalizeText(text);
  const pattern = new RegExp(OPERATION_POSITION_TOKEN_SOURCE, "gi");
  return [...source.matchAll(pattern)]
    .map(match => ({
      position: operationPositionFromToken(match[0]),
      start: Number(match.index || 0),
      end: Number(match.index || 0) + match[0].length,
      raw: match[0]
    }))
    .filter(item => item.position);
}

function operationPositionsNearKeyword(text, keywordSource) {
  const source = normalizeText(text);
  const tokens = operationPositionTokens(source);
  const keywords = [...source.matchAll(new RegExp(keywordSource, "gi"))];
  const found = new Set();

  for (const keyword of keywords) {
    const keywordStart = Number(keyword.index || 0);
    const keywordEnd = keywordStart + keyword[0].length;
    let best = null;

    for (const token of tokens) {
      const distance = token.end <= keywordStart
        ? keywordStart - token.end
        : (token.start >= keywordEnd ? token.start - keywordEnd : 0);
      if (distance > 24) continue;
      if (!best || distance < best.distance) best = { token, distance };
    }

    if (best) found.add(best.token.position);
  }

  return [...found];
}

function operationArrowPair(text) {
  const source = normalizeText(text);
  const tokens = operationPositionTokens(source);

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const from = tokens[index];
    const to = tokens[index + 1];
    if (from.position === to.position) continue;

    const bridge = source.slice(from.end, to.start);
    const afterTo = source.slice(to.end, Math.min(source.length, to.end + 5));
    const arrow = /(?:->|=>|→|➡|⇒)/.test(bridge);
    const fromTo = /에서\s*$/.test(bridge) && /^\s*로/.test(afterTo);
    if (arrow || fromTo) {
      return { fromPosition: from.position, toPosition: to.position };
    }
  }

  return null;
}

function operationSwitchTargetPosition(text) {
  const source = normalizeText(text);
  const tokens = operationPositionTokens(source);
  const switchMatches = [...source.matchAll(/(?:교체\s*운전|절체\s*운전|운전\s*(?:교체|절체|전환)|change\s*over|changeover|switch\s*over)/gi)];
  const targets = new Set();

  for (const switchMatch of switchMatches) {
    const start = Number(switchMatch.index || 0);
    const end = start + switchMatch[0].length;
    let best = null;

    for (const token of tokens) {
      const before = token.end <= start;
      const distance = before
        ? start - token.end
        : (token.start >= end ? token.start - end : 0);
      if (distance > 36) continue;

      const bridge = before
        ? source.slice(token.end, start)
        : source.slice(end, token.start);
      if (/[\n:;]/.test(bridge)) continue;
      if (/(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트)/i.test(bridge)) continue;

      const score = distance + (before ? 0 : 8);
      if (!best || score < best.score) best = { position: token.position, score };
    }

    if (best) targets.add(best.position);
  }

  return targets.size === 1 ? [...targets][0] : "";
}

function operationChangeoverPair(text) {
  const source = normalizeText(text);
  const stopPositions = operationPositionsNearKeyword(source, OPERATION_STOP_KEYWORD_SOURCE);
  const startPositions = operationPositionsNearKeyword(source, OPERATION_START_KEYWORD_SOURCE);

  if (
    stopPositions.length === 1 &&
    startPositions.length === 1 &&
    stopPositions[0] !== startPositions[0]
  ) {
    return { fromPosition: stopPositions[0], toPosition: startPositions[0] };
  }

  return operationArrowPair(source);
}

function hasCompletedOperationChangeover(text) {
  const source = normalizeText(text);
  const hasSwitchWording = /(?:교체\s*운전|교체운전|절체\s*운전|절체운전|운전\s*(?:교체|절체|전환)|change\s*over|changeover|switch\s*over)/i.test(source);
  const hasExplicitStates = (
    new RegExp(OPERATION_START_KEYWORD_SOURCE, "i").test(source) &&
    new RegExp(OPERATION_STOP_KEYWORD_SOURCE, "i").test(source)
  );
  if (!hasSwitchWording && !hasExplicitStates) return false;

  // 예정·요청 문구에 "정지 후 기동"이 포함돼도 실제 운전 전환으로 처리하지 않는다.
  if (/(?:예정|계획|요청|검토|필요|문의|준비|보류|취소|불가|미실시|미완료|하지\s*않|안\s*함)/i.test(source)) {
    return false;
  }

  const completed = /(?:실시|시행|완료|변경\s*(?:함|완료|실시)?|전환\s*(?:함|완료|실시)?|교체\s*운전\s*(?:함|하였|했)|절체\s*운전\s*(?:함|하였|했)|재?기동|정지|가동|운전\s*중|START(?:ED)?|STOP(?:PED)?)/i.test(source);
  return hasExplicitStates || completed;
}

function operationContextAsset(context, position, assets, workDate) {
  const enabledAssets = (assets || []).filter(asset => Number(asset?.enabled) === 1);
  const taggedAssets = (context?.tags || [])
    .map(tag => enabledAssets.find(asset => normalizeText(asset?.tag_number).toUpperCase() === tag))
    .filter(Boolean);
  const taggedMatches = taggedAssets.filter(asset => normalizeText(asset.position_label).toUpperCase() === position);

  if (taggedMatches.length === 1) return taggedMatches[0];
  if (taggedMatches.length > 1) return null;

  const types = [...new Set([
    ...(context?.types || []),
    ...taggedAssets.map(asset => normalizeText(asset.blower_type))
  ].filter(Boolean))];
  if (types.length !== 1) return null;
  const blowerType = types[0];
  const taggedUnits = taggedAssets.map(asset => normalizeText(asset.unit_no)).filter(Boolean);
  const contextUnits = (context?.units || []).filter(Boolean);
  const units = blowerType === "flyash_silo"
    ? ["shared"]
    : [...new Set([...contextUnits, ...taggedUnits])];
  if (units.length !== 1) return null;

  const taggedGroups = [...new Set(taggedAssets.map(assetGroupKey))];
  const requiredGroup = blowerType === "organic_fuel"
    ? (context?.assetGroup === "manure" || taggedGroups[0] === "manure" ? "manure" : "")
    : "";
  if (taggedGroups.length > 1 || (taggedGroups.length === 1 && taggedGroups[0] !== requiredGroup)) return null;

  const matches = enabledAssets.filter(asset => (
    managedAssetAllowsContextualMatch(asset, workDate) &&
    normalizeText(asset.blower_type) === blowerType &&
    normalizeText(asset.unit_no) === units[0] &&
    assetGroupKey(asset) === requiredGroup &&
    normalizeText(asset.position_label).toUpperCase() === position
  ));

  return matches.length === 1 ? matches[0] : null;
}

function detectOperationChangeover(fragment, row, assets) {
  const sourceText = fragmentSourceText(fragment);
  if (!sourceText || !hasCompletedOperationChangeover(sourceText)) return null;

  const pair = operationChangeoverPair(sourceText);
  const targetPosition = pair ? pair.toPosition : operationSwitchTargetPosition(sourceText);
  if (!pair && !targetPosition) return null;

  const sourceTime = fragmentSourceTime(fragment);
  if (!sourceTime) return { skippedReason: "missing_time" };

  const role = fragmentSourceRole(fragment) || normalizeDutyPosition(row?.role);
  const context = fragment?.v13Context || v13IdentityFromText(
    sourceText,
    role,
    assets,
    fragmentIdentityText(fragment)
  );
  if (!context || context.identityConflict) return { skippedReason: "identity_conflict" };

  const workDate = normalizeText(row?.work_date).slice(0, 10);
  const fromAsset = pair
    ? operationContextAsset(context, pair.fromPosition, assets, workDate)
    : null;
  const toAsset = operationContextAsset(context, targetPosition, assets, workDate);
  if (!toAsset || (pair && (!fromAsset || fromAsset.tag_number === toAsset.tag_number))) {
    return { skippedReason: "unresolved_asset" };
  }

  const eventDate = detectionDateTime({
    ...row,
    sourceTime,
    sourceText
  });
  if (!eventDate) return { skippedReason: "invalid_time" };

  return {
    fromAsset,
    toAsset,
    targetOnly: !pair,
    eventDate,
    sourceText: normalizeText(fragment?.v13EvidenceText || sourceText),
    sourceLogId: normalizeText(row?.id),
    workDate,
    shift: normalizeText(row?.shift),
    role
  };
}

async function inferRunningOperationSource(database, targetAsset) {
  const result = await database
    .prepare(`
      SELECT *
      FROM blower_history_assets
      WHERE enabled = 1
        AND blower_type = ?
        AND unit_no = ?
        AND asset_group = ?
        AND tag_number <> ?
        AND cycle_start_state <> 'pending'
        AND cycle_runtime_state = 'running'
        AND is_running = 1
      ORDER BY sort_order ASC, tag_number ASC
      LIMIT 2
    `)
    .bind(
      normalizeText(targetAsset.blower_type),
      normalizeText(targetAsset.unit_no),
      assetGroupKey(targetAsset),
      normalizeText(targetAsset.tag_number).toUpperCase()
    )
    .all();
  const matches = Array.isArray(result.results) ? result.results : [];
  return matches.length === 1 ? matches[0] : null;
}

async function automaticOperationEventExists(database, eventId) {
  if (!eventId) return false;
  const existing = await database
    .prepare(`SELECT id FROM blower_history_events WHERE id = ? LIMIT 1`)
    .bind(eventId)
    .first();
  return Boolean(existing);
}

async function hasManualRuntimeBoundaryAtOrAfter(database, tagNumber, eventDate) {
  const existing = await database
    .prepare(`
      SELECT id
      FROM blower_history_events
      WHERE tag_number = ?
        AND source_type = 'manual'
        AND event_type IN ('startup', 'operation_start', 'operation_stop', 'runtime_correction')
        AND datetime(event_date) >= datetime(?)
      ORDER BY datetime(event_date) DESC, created_at DESC, id DESC
      LIMIT 1
    `)
    .bind(tagNumber, eventDate)
    .first();
  return Boolean(existing);
}

async function responseMessage(response) {
  try {
    const payload = await response.clone().json();
    return normalizeText(payload?.message);
  } catch {
    return "";
  }
}

async function planAutomaticOperationState(database, change, targetAsset, targetRunning, eventId) {
  const asset = await findAsset(database, targetAsset.tag_number);
  if (!asset || !normalizeText(asset.last_replacement_at)) {
    return { allowed: false, needed: false, reason: "no_replacement" };
  }

  const eventAt = new Date(change.eventDate);
  const replacementAt = new Date(asset.last_replacement_at);
  if (
    Number.isNaN(eventAt.getTime()) ||
    Number.isNaN(replacementAt.getTime()) ||
    eventAt < replacementAt
  ) {
    return { allowed: false, needed: false, reason: "before_replacement" };
  }

  if (await hasManualRuntimeBoundaryAtOrAfter(database, asset.tag_number, change.eventDate)) {
    return { allowed: false, needed: false, reason: "manual_priority" };
  }

  const duplicate = await automaticOperationEventExists(database, eventId);
  const latestBoundary = await loadLatestExplicitRuntimeBoundary(database, asset);
  const latestBoundaryAt = new Date(latestBoundary?.event_date);
  if (
    latestBoundary &&
    !Number.isNaN(latestBoundaryAt.getTime()) &&
    latestBoundaryAt >= eventAt &&
    !duplicate
  ) {
    return { allowed: false, needed: false, reason: "newer_boundary" };
  }

  const pending = normalizeText(asset.cycle_start_state) === "pending";
  const currentRunning = !pending && normalizeText(asset.cycle_runtime_state) === "running";
  const desiredSatisfied = targetRunning ? currentRunning : !currentRunning;
  if (duplicate || desiredSatisfied || (pending && !targetRunning)) {
    return {
      allowed: true,
      needed: false,
      reason: duplicate
        ? "duplicate"
        : (targetRunning ? "already_running" : "already_stopped"),
      asset
    };
  }

  return {
    allowed: true,
    needed: true,
    reason: targetRunning ? "start_required" : "stop_required",
    asset,
    pending
  };
}

async function applyAutomaticOperationState(database, change, plan, targetRunning, eventId) {
  if (!plan?.allowed || !plan?.needed || !plan.asset) {
    return { applied: false, reason: plan?.reason || "not_required" };
  }

  const asset = plan.asset;
  const source = {
    eventId,
    sourceType: OPERATION_AUTO_SOURCE_TYPE,
    sourceLogId: change.sourceLogId,
    sourceText: change.sourceText,
    actionType: targetRunning ? "교체운전 자동 기동" : "교체운전 자동 정지"
  };
  const systemUser = {
    employeeNo: OPERATION_AUTO_CREATED_BY_ID,
    name: OPERATION_AUTO_CREATED_BY_NAME
  };
  let response;

  if (plan.pending) {
    response = await registerStartup(database, systemUser, {
      tagNumber: asset.tag_number,
      eventDate: change.eventDate,
      expectedLastReplacementAt: asset.last_replacement_at,
      note: "업무일지 교체운전 문구에서 자동 반영"
    }, source);
  } else {
    response = await changeRuntimeState(database, systemUser, {
      tagNumber: asset.tag_number,
      eventDate: change.eventDate,
      isRunning: targetRunning,
      expectedCycleRuntimeRevision: normalizeText(asset.cycle_runtime_revision),
      note: "업무일지 교체운전 문구에서 자동 반영"
    }, source);
  }

  if (!response.ok) {
    const refreshed = await findAsset(database, asset.tag_number);
    const refreshedPending = normalizeText(refreshed?.cycle_start_state) === "pending";
    const refreshedRunning = !refreshedPending && normalizeText(refreshed?.cycle_runtime_state) === "running";
    if ((targetRunning && refreshedRunning) || (!targetRunning && !refreshedRunning)) {
      return { applied: false, reason: "concurrent_desired_state" };
    }
    return {
      applied: false,
      reason: "rejected",
      message: await responseMessage(response)
    };
  }

  return { applied: true, reason: targetRunning ? "started" : "stopped" };
}

async function syncOperationChanges(database, user, body = {}) {
  const days = Math.max(1, Math.min(365, Number(body.days) || OPERATION_SYNC_DEFAULT_DAYS));
  const fromDate = new Date(Date.now() - days * 24 * 3600000);
  const fromDateText = formatKstDate(fromDate);
  const logResult = await database
    .prepare(`
      SELECT id, work_date, shift, role, author, status, log_json, updated_at
      FROM shift_logs
      WHERE work_date >= ?
        AND status = '결재완료'
      ORDER BY work_date ASC, updated_at ASC, id ASC
      LIMIT 5000
    `)
    .bind(fromDateText)
    .all();
  const logs = Array.isArray(logResult.results) ? logResult.results : [];
  const assetResult = await database
    .prepare(`SELECT * FROM blower_history_assets ORDER BY sort_order ASC, tag_number ASC`)
    .all();
  const recognitionAssets = Array.isArray(assetResult.results) ? assetResult.results : [];
  const assets = recognitionAssets.filter(asset => Number(asset.enabled) === 1);
  const upperRoleRows = await loadUpperRoleRowsForDates(database, logs);
  const rolePriorityContext = buildRolePriorityContext([...logs, ...upperRoleRows], recognitionAssets);
  const seen = new Set();
  const skipped = {};
  let detectedChangeovers = 0;
  let appliedChangeovers = 0;
  let appliedStateChanges = 0;

  const addSkip = reason => {
    const key = normalizeText(reason) || "unknown";
    skipped[key] = Number(skipped[key] || 0) + 1;
  };

  for (const row of logs) {
    const rawFragments = parseShiftLogFragments(row, recognitionAssets);
    const prioritized = applyDutyRolePriority(row, rawFragments, rolePriorityContext, recognitionAssets);
    const fragments = v13ContextualizeScanFragments(prioritized.fragments, row, recognitionAssets);

    for (const fragment of fragments) {
      const analysisText = fragmentAnalysisText(fragment);
      if (!/(?:교체\s*운전|교체운전|절체\s*운전|절체운전|운전\s*(?:교체|절체|전환)|change\s*over|changeover|switch\s*over|재?기동|정지)/i.test(analysisText)) {
        continue;
      }

      const change = detectOperationChangeover(fragment, row, recognitionAssets);
      if (!change || change.skippedReason) {
        if (change?.skippedReason) addSkip(change.skippedReason);
        continue;
      }

      if (!change.fromAsset && change.targetOnly) {
        change.fromAsset = await inferRunningOperationSource(database, change.toAsset);
        if (!change.fromAsset) {
          addSkip("unresolved_running_source");
          continue;
        }
      }

      const fingerprint = fingerprintText([
        "operation_v2",
        change.sourceLogId,
        change.eventDate,
        change.fromAsset.tag_number,
        change.toAsset.tag_number
      ].join("||"));
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      detectedChangeovers += 1;

      const stopEventId = `operation-auto:${fingerprint}:stop`;
      const startEventId = `operation-auto:${fingerprint}:start`;
      const stopPlan = await planAutomaticOperationState(
        database,
        change,
        change.fromAsset,
        false,
        stopEventId
      );
      const startPlan = await planAutomaticOperationState(
        database,
        change,
        change.toAsset,
        true,
        startEventId
      );

      if (!stopPlan.allowed || !startPlan.allowed) {
        addSkip(!stopPlan.allowed ? stopPlan.reason : startPlan.reason);
        continue;
      }

      // 새 운전기를 먼저 기동한 뒤 기존 운전기를 정지한다. 동시 수동조작이 발생해도
      // CAS 검증과 재조회로 사용자의 최신 상태가 최종 우선권을 갖는다.
      const startResult = await applyAutomaticOperationState(
        database,
        change,
        startPlan,
        true,
        startEventId
      );
      if (startPlan.needed && !startResult.applied && startResult.reason !== "concurrent_desired_state") {
        addSkip(startResult.reason);
        continue;
      }

      const stopResult = await applyAutomaticOperationState(
        database,
        change,
        stopPlan,
        false,
        stopEventId
      );
      const pairApplied = Number(startResult.applied) + Number(stopResult.applied);
      if (pairApplied > 0) appliedChangeovers += 1;
      appliedStateChanges += pairApplied;
      if (!startResult.applied) addSkip(startResult.reason);
      if (!stopResult.applied) addSkip(stopResult.reason);
    }
  }

  return jsonResponse({
    ok: true,
    message: appliedStateChanges > 0
      ? `업무일지 교체운전 ${appliedChangeovers}건에서 기동·정지 ${appliedStateChanges}건을 자동 반영했습니다.`
      : "새로 반영할 업무일지 교체운전 상태가 없습니다.",
    scannedDays: days,
    scannedLogCount: logs.length,
    detectedChangeovers,
    appliedChangeovers,
    appliedStateChanges,
    skipped
  });
}

async function scanShiftLogs(database, user, body) {
  const days = Math.max(1, Math.min(3650, Number(body.days) || 180));
  const fromDate = new Date(Date.now() - days * 24 * 3600000);
  const fromDateText = formatKstDate(fromDate);

  const logResult = await database
    .prepare(`
      SELECT
        id,
        work_date,
        shift,
        role,
        author,
        status,
        log_json
      FROM shift_logs
      WHERE work_date >= ?
        AND status = '결재완료'
      ORDER BY work_date DESC, updated_at DESC
      LIMIT 10000
    `)
    .bind(fromDateText)
    .all();

  const logs = Array.isArray(logResult.results) ? logResult.results : [];
  const assetResult = await database
    .prepare(`
      SELECT *
      FROM blower_history_assets
      ORDER BY sort_order ASC, tag_number ASC
    `)
    .all();
  const recognitionAssets = Array.isArray(assetResult.results) ? assetResult.results : [];
  const assets = recognitionAssets.filter(asset => Number(asset.enabled) === 1);
  const upperRoleRows = await loadUpperRoleRowsForDates(database, logs);
  const rolePriorityContext = buildRolePriorityContext([
    ...logs,
    ...upperRoleRows
  ], recognitionAssets);
  let detectedCount = 0;
  let insertedCount = 0;
  let excludedPartLeaderLogs = 0;
  let suppressedDuplicateFragments = 0;

  for (const row of logs) {
    const rawFragments = parseShiftLogFragments(row, recognitionAssets);
    const prioritized = applyDutyRolePriority(row, rawFragments, rolePriorityContext, recognitionAssets);

    if (prioritized.excludedPartLeader) {
      excludedPartLeaderLogs += 1;
      continue;
    }

    suppressedDuplicateFragments += prioritized.suppressedDuplicateFragments;
    const fragments = v13ContextualizeScanFragments(prioritized.fragments, row, recognitionAssets);
    const seen = new Set();

    for (const fragment of fragments) {
      await ensureDiscoveredAssets(database, fragmentAnalysisText(fragment), assets);
      const sourceText = fragmentSourceText(fragment);
      if (!v13ActualBeltReplacement(sourceText, row.work_date, false)) continue;

      const v13Record = {
        sourceText,
        identityText: fragmentIdentityText(fragment),
        role: fragmentSourceRole(fragment) || row.role,
        workDate: row.work_date,
        v13Context: fragment.v13Context
      };
      const targets = v13ResolveTargets(v13Record, assets, recognitionAssets);
      if (targets.length === 0) continue;

      const spec = {
        detectedType: "replacement",
        issueType: findIssueType(sourceText) || "정기주기",
        actionType: "V-Belt 교체",
        autoEligible: true
      };

      for (const asset of targets) {
        const key = `${row.id}::${asset.tag_number}::replacement`;
        if (seen.has(key)) continue;
        seen.add(key);
        detectedCount += 1;

        const sourceRow = {
          ...row,
          sourceText: normalizeText(fragment.v13EvidenceText || sourceText),
          sourceTime: fragmentSourceTime(fragment)
        };
        const detection = await insertDetectionCandidate(
          database,
          sourceRow,
          asset.tag_number,
          spec,
          "pending"
        );

        if (detection.inserted) insertedCount += 1;
      }
    }
  }

  return jsonResponse({
    ok: true,
    message:
      `업무일지 ${logs.length}건 확인 · 파트장 ${excludedPartLeaderLogs}건 제외 · ` +
      `70% 이상 중복 하위보직 구절 ${suppressedDuplicateFragments}건은 상위보직 기준 처리 · V13 문맥 기반 설비 귀속`,
    scannedDays: days,
    scannedLogCount: logs.length,
    excludedPartLeaderLogs,
    suppressedDuplicateFragments,
    duplicateSimilarityThreshold: DUPLICATE_SIMILARITY_THRESHOLD,
    detectedCount,
    insertedCount,
    pendingCandidates: await loadCandidates(database, "pending", 300)
  });
}

async function reviewCandidate(database, user, body) {
  const id = normalizeText(body.id);
  const decision = normalizeText(body.decision);

  if (!id || !["confirm", "exclude"].includes(decision)) {
    return jsonResponse({ ok: false, message: "자동감지 검토 요청을 확인해 주세요." }, 400);
  }

  const candidate = await database
    .prepare(`
      SELECT *
      FROM blower_history_candidates
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first();

  if (!candidate) {
    return jsonResponse({ ok: false, message: "자동감지 후보를 찾을 수 없습니다." }, 404);
  }

  if (candidate.status !== "pending") {
    return jsonResponse({ ok: false, message: "이미 검토된 자동감지 후보입니다." }, 409);
  }

  const now = new Date().toISOString();
  const staleClaimBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const claim = await database
    .prepare(`
      UPDATE blower_history_candidates
      SET
        reviewed_by_id = ?,
        reviewed_by_name = ?,
        reviewed_at = ?
      WHERE id = ?
        AND status = 'pending'
        AND (reviewed_at IS NULL OR reviewed_at = '' OR reviewed_at < ?)
    `)
    .bind(user.employeeNo, user.name, now, id, staleClaimBefore)
    .run();

  if (Number(claim?.meta?.changes || 0) === 0) {
    return jsonResponse(
      { ok: false, message: "다른 사용자가 이 자동감지 후보를 검토하고 있습니다." },
      409
    );
  }

  if (decision === "exclude") {
    const excluded = await database
      .prepare(`
        UPDATE blower_history_candidates
        SET
          status = 'excluded',
          reviewed_at = ?
        WHERE id = ?
          AND status = 'pending'
          AND reviewed_by_id = ?
          AND reviewed_at = ?
      `)
      .bind(now, id, user.employeeNo, now)
      .run();

    if (Number(excluded?.meta?.changes || 0) === 0) {
      return jsonResponse({ ok: false, message: "후보 제외 상태가 변경되어 다시 확인해 주세요." }, 409);
    }

    return jsonResponse({ ok: true, message: "자동감지 후보에서 제외했습니다." });
  }

  const mergedBody = {
    tagNumber: candidate.tag_number,
    eventDate: normalizeDateTime(body.eventDate) || candidate.detected_date,
    issueType: normalizeText(body.issueType) || normalizeText(candidate.issue_type),
    actionType: normalizeText(body.actionType) || normalizeText(candidate.action_type),
    note: normalizeText(body.note)
  };

  if (typeof body.startImmediately === "boolean") {
    mergedBody.startImmediately = body.startImmediately;
  }
  if (body.startupAt !== undefined) {
    mergedBody.startupAt = body.startupAt;
  }

  const source = {
    sourceType: "shift_log_auto",
    sourceLogId: candidate.source_log_id,
    sourceText: candidate.source_text
  };

  const existingConfirmedEvent = await database
    .prepare(`
      SELECT id
      FROM blower_history_events
      WHERE source_type = 'shift_log_auto'
        AND source_log_id = ?
        AND tag_number = ?
        AND event_type = ?
      LIMIT 1
    `)
    .bind(candidate.source_log_id, candidate.tag_number, candidate.detected_type)
    .first();

  const result = existingConfirmedEvent
    ? jsonResponse({ ok: true, message: "이미 반영된 이력을 후보와 연결했습니다." })
    : candidate.detected_type === "replacement"
      ? await registerReplacement(database, user, mergedBody, source)
      : await registerProblem(database, user, mergedBody, source);

  if (!result.ok) {
    await database
      .prepare(`
        UPDATE blower_history_candidates
        SET reviewed_by_id = '', reviewed_by_name = '', reviewed_at = NULL
        WHERE id = ?
          AND status = 'pending'
          AND reviewed_by_id = ?
          AND reviewed_at = ?
      `)
      .bind(id, user.employeeNo, now)
      .run();
    return result;
  }

  const confirmed = await database
    .prepare(`
      UPDATE blower_history_candidates
      SET
        status = 'confirmed',
        reviewed_at = ?
      WHERE id = ?
        AND status = 'pending'
        AND reviewed_by_id = ?
        AND reviewed_at = ?
    `)
    .bind(now, id, user.employeeNo, now)
    .run();

  if (Number(confirmed?.meta?.changes || 0) === 0) {
    return jsonResponse({ ok: false, message: "후보 확정 상태가 변경되어 다시 확인해 주세요." }, 409);
  }

  return jsonResponse({
    ok: true,
    message: "자동감지 내용을 확정하여 이력에 반영했습니다."
  });
}

function normalizeHistoricalAuditCursor(value) {
  const source = HISTORY_AUDIT_SOURCE_ORDER.includes(normalizeText(value?.source))
    ? normalizeText(value.source)
    : HISTORY_AUDIT_SOURCE_ORDER[0];
  const rowId = Math.max(0, Math.floor(Number(value?.rowId) || 0));

  return { source, rowId };
}

function nextHistoricalAuditSource(source) {
  const index = HISTORY_AUDIT_SOURCE_ORDER.indexOf(source);
  return index >= 0 && index + 1 < HISTORY_AUDIT_SOURCE_ORDER.length
    ? HISTORY_AUDIT_SOURCE_ORDER[index + 1]
    : "";
}

function historicalAuditBatchSize(source, requestedLimit) {
  const defaultLimit = HISTORY_AUDIT_BATCH_SIZES[source] || HISTORY_AUDIT_BATCH_SIZES.shift_logs;
  const normalizedLimit = Math.floor(Number(requestedLimit) || 0);

  return normalizedLimit > 0
    ? Math.max(1, Math.min(defaultLimit, normalizedLimit))
    : defaultLimit;
}

function historicalAuditLegacyScanBatchSize(requestedLimit) {
  const normalizedLimit = Math.floor(Number(requestedLimit) || 0);

  return normalizedLimit > 0
    ? Math.max(1, Math.min(HISTORY_AUDIT_LEGACY_SCAN_BATCH_SIZE, normalizedLimit))
    : HISTORY_AUDIT_LEGACY_SCAN_BATCH_SIZE;
}

function historicalAuditRowMayContainBelt(row) {
  let belt = false;
  let replacement = false;

  for (const value of Object.values(row || {})) {
    if (typeof value !== "string") continue;
    if (!belt && hasBeltWord(value)) belt = true;
    if (!replacement && hasReplacementKeyword(value)) replacement = true;
    if (belt && replacement) return true;
  }

  return false;
}

function auditPotentialTagNumbers() {
  const tags = new Set(ASSET_SEEDS.map(seed => normalizeText(seed[0]).toUpperCase()));

  for (const unitNo of ["1", "2"]) {
    for (const suffix of ["611", "621", "631"]) {
      tags.add(`${unitNo}04HHL60AP${suffix}`);
      tags.add(`${unitNo}04HHL10AN${suffix}`);
    }
    for (const suffix of ["001", "002"]) {
      tags.add(`${unitNo}04SDF01AN${suffix}`);
    }
    for (const suffix of ["601", "602"]) {
      tags.add(`${unitNo}04ETG30AN${suffix}`);
    }
  }

  tags.add("104ETH03AN601");
  tags.add("104ETH03AN602");
  return [...tags];
}

function buildHistoricalAuditAssets(storedAssets) {
  const byTag = new Map();

  for (const asset of storedAssets || []) {
    const tagNumber = normalizeText(asset?.tag_number).toUpperCase();
    if (!tagNumber) continue;
    byTag.set(tagNumber, {
      ...asset,
      tag_number: tagNumber,
      audit_registered: true
    });
  }

  for (const tagNumber of auditPotentialTagNumbers()) {
    if (byTag.has(tagNumber)) continue;
    const definition = classifyRecognizedBlowerTag(tagNumber);
    if (!definition) continue;
    byTag.set(tagNumber, {
      tag_number: definition.tagNumber,
      blower_type: definition.blowerType,
      unit_no: definition.unitNo,
      position_label: definition.positionLabel,
      display_name: definition.displayName,
      sort_order: definition.sortOrder,
      enabled: 1,
      audit_registered: false
    });
  }

  return [...byTag.values()];
}

function auditJsonValue(value) {
  const text = normalizeText(value);
  if (!text || !/^[\[{]/.test(text)) return null;

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function auditIdentityFromObject(value, inheritedIdentity, fallbackRole, assets = []) {
  const tagText = [
    value?.tag,
    value?.tagNumber,
    value?.equipmentTag,
    value?.tag_number
  ].filter(Boolean).join(" ");
  const tags = extractRecognizedBlowerTags(tagText, assets);
  const labelValues = [
    value?.equipmentName,
    value?.equipment,
    value?.title,
    value?.name,
    value?.category
  ].filter(Boolean);
  const labelSemanticValues = labelValues.map(label => (
    textWithoutRecognizedTagSpans(label, assets)
  ));
  const labelText = labelSemanticValues.join(" ");
  const types = detectBlowerTypes(labelText);
  const manureContext = labelSemanticValues.some(label => (
    hasManureBlowerContext(label) || isStandaloneManureGroupLabel(label)
  ));
  const positions = detectPositionLabels(labelText);
  const explicitUnits = detectUnitNos(labelText);
  const sourceRole = normalizeDutyPosition(
    value?.importedFromRole || value?.sourceRole || fallbackRole
  );
  const roleUnit = DUTY_ROLE_UNIT[sourceRole] || "";

  return [
    inheritedIdentity,
    tags.join(" "),
    manureContext ? "축분 Blower" : "",
    types.map(type => TYPE_IDENTITY_LABELS[type]).filter(Boolean).join(" "),
    explicitUnits.length > 0
      ? explicitUnits.map(unit => `#${unit} BLR`).join(" ")
      : (roleUnit ? `#${roleUnit} BLR` : ""),
    positions.join(" ")
  ].filter(Boolean).join(" ");
}

function collectUnknownHistoricalAuditFragments(value, options = {}) {
  const fragments = [];
  const used = new Set();
  const seenObjects = new WeakSet();

  const appendText = (rawText, identityText, sourceField, sourceRole) => {
    const text = normalizeText(rawText);
    if (!text || !hasBeltWord(text)) return;

    for (const clause of splitCanonicalEntryClauses(text)) {
      if (!hasBeltWord(clause)) continue;
      const fragment = {
        sourceText: clause,
        identityText: normalizeText(identityText),
        sourceTime: normalizeCanonicalEntryTime(clause),
        sourceField: normalizeText(sourceField),
        sourceRole: normalizeDutyPosition(sourceRole || options.role)
      };
      const key = [
        compactEquipmentText(fragment.identityText),
        normalizeSimilarityText(fragment.sourceText),
        fragment.sourceField
      ].join("::");
      if (used.has(key)) continue;
      used.add(key);
      fragments.push(fragment);
    }
  };

  const visit = (item, path, inheritedIdentity, inheritedRole) => {
    if (item == null) return;

    if (typeof item === "string") {
      const parsed = auditJsonValue(item);
      if (parsed) {
        visit(parsed, path, inheritedIdentity, inheritedRole);
        return;
      }
      appendText(item, inheritedIdentity, path, inheritedRole);
      return;
    }

    if (typeof item !== "object") return;
    if (seenObjects.has(item)) return;
    seenObjects.add(item);

    if (Array.isArray(item)) {
      item.forEach((entry, index) => {
        visit(entry, `${path}[${index}]`, inheritedIdentity, inheritedRole);
      });
      return;
    }

    const sourceRole = normalizeDutyPosition(
      item.importedFromRole || item.sourceRole || inheritedRole || options.role
    );
    const identityText = auditIdentityFromObject(
      item,
      inheritedIdentity,
      sourceRole,
      options.assets || []
    );

    for (const [key, nested] of Object.entries(item)) {
      if (["status", "author", "authorId", "createdAt", "updatedAt"].includes(key)) {
        continue;
      }
      visit(nested, path ? `${path}.${key}` : key, identityText, sourceRole);
    }
  };

  visit(value, options.sourceField || "legacy", options.identityText || "", options.role || "");
  return fragments;
}

function historicalAuditReasons(fragment, matches, resolvedMatches, assets = []) {
  const analysisText = fragmentAnalysisText(fragment);
  const reasons = [];
  const tags = extractRecognizedBlowerTags(analysisText, assets);
  const types = detectBlowerTypes(analysisText);
  const units = detectUnitNos(analysisText);
  const positions = detectPositionLabels(analysisText);

  if (tags.length === 0) reasons.push("전체 TAG 없음");
  if (types.length === 0) reasons.push("Blower 종류 미인식");
  if (types.length > 1) reasons.push("Blower 종류가 둘 이상");
  if (units.length === 0 && !types.includes("flyash_silo")) reasons.push("호기 미인식");
  if (units.length > 1) reasons.push("호기가 둘 이상");
  if (positions.length === 0) reasons.push("위치 A/B/C 미인식");
  if (matches.length > 1 && resolvedMatches.length === 0) reasons.push("복수 설비 귀속 불명확");
  if (matches.length === 0 && tags.length > 0) reasons.push("TAG와 본문 설비정보 충돌 또는 미등록");
  return reasons;
}

function analyzeHistoricalAuditFragment(
  fragment,
  row,
  sourceTable,
  auditAssets,
  recognitionAssets = auditAssets
) {
  const sourceText = fragmentSourceText(fragment);
  if (!hasBeltWord(sourceText) || !hasReplacementKeyword(sourceText)) return null;

  const specs = detectedEventSpecs(fragment, recognitionAssets);
  const matches = findAssetMatches(
    fragment,
    auditAssets,
    recognitionAssets,
    row?.work_date || row?.event_date
  );
  const resolved = [];

  for (const spec of specs) {
    const specMatches = spec.autoEligible
      ? resolveHistoricalMatches(fragment, matches, spec)
      : (matches.length === 1 || isGroupedContextReference(fragment, matches) ? matches : []);

    for (const match of specMatches) {
      if (match?.strong && !resolved.some(item => item.asset.tag_number === match.asset.tag_number)) {
        resolved.push(match);
      }
    }
  }

  let classification;
  if (specs.length === 0) {
    if (
      hasReplacementPlanContext(sourceText) ||
      hasReplacementExclusionContext(sourceText) ||
      hasBeltAccessoryReplacementPhrase(sourceText)
    ) {
      classification = "excluded_context";
    } else {
      classification = "parser_miss";
    }
  } else if (matches.length === 0) {
    classification = "asset_unmatched";
  } else if (resolved.length === 0) {
    classification = "asset_ambiguous";
  } else if (specs.some(spec => spec.autoEligible)) {
    classification = resolved.some(match => match.asset.audit_registered === false)
      ? "confirmed_unregistered_asset"
      : "confirmed_match";
  } else {
    classification = "needs_review";
  }

  const analysisText = fragmentAnalysisText(fragment);
  return {
    key: fingerprintText([
      HISTORY_AUDIT_VERSION,
      sourceTable,
      normalizeText(row?.id || row?.source_log_id || row?.audit_rowid),
      normalizeSimilarityText(sourceText),
      normalizeText(fragment?.sourceField)
    ].join("||")),
    sourceTable,
    sourceRowId: Number(row?.audit_rowid || 0),
    sourceLogId: normalizeText(row?.id || row?.source_log_id),
    workDate: normalizeText(row?.work_date || row?.event_date).slice(0, 10),
    shift: normalizeText(row?.shift),
    role: normalizeDutyPosition(fragment?.sourceRole || row?.role),
    author: normalizeText(row?.author || row?.created_by_name),
    sourceField: normalizeText(fragment?.sourceField) || "canonical",
    sourceTime: fragmentSourceTime(fragment),
    sourceText,
    identityText: fragmentIdentityText(fragment),
    identityConflict: fragmentHasIdentityConflict(fragment, recognitionAssets),
    classification,
    detectedTags: extractRecognizedBlowerTags(analysisText, recognitionAssets),
    detectedTypes: detectBlowerTypes(analysisText),
    detectedUnits: detectUnitNos(analysisText),
    detectedPositions: detectPositionLabels(analysisText),
    matchedAssets: resolved.map(match => ({
      tagNumber: match.asset.tag_number,
      blowerType: match.asset.blower_type,
      unitNo: match.asset.unit_no,
      positionLabel: match.asset.position_label,
      registered: match.asset.audit_registered !== false,
      reason: match.reason
    })),
    reasons: historicalAuditReasons(fragment, matches, resolved, recognitionAssets)
  };
}

function summarizeHistoricalAuditRecords(records) {
  const classifications = {};
  const sourceTables = {};

  for (const record of records || []) {
    classifications[record.classification] = (classifications[record.classification] || 0) + 1;
    sourceTables[record.sourceTable] = (sourceTables[record.sourceTable] || 0) + 1;
  }

  return {
    relevantRecords: (records || []).length,
    classifications,
    sourceTables
  };
}

function analyzeHistoricalAuditRows(
  rows,
  sourceTable,
  auditAssets,
  recognitionAssets = auditAssets
) {
  const records = [];

  for (const row of rows || []) {
    let fragments;

    if (sourceTable === "shift_logs") {
      fragments = parseShiftLogFragments(row, recognitionAssets);
    } else if (sourceTable === "legacy_logs") {
      fragments = collectUnknownHistoricalAuditFragments(row, {
        sourceField: "legacy_row",
        role: row?.role,
        assets: recognitionAssets
      });
    } else {
      const sourceText = normalizeText(row?.source_text);
      if (!sourceText) {
        if (normalizeText(row?.event_type) === "replacement") {
          records.push({
            key: fingerprintText([
              HISTORY_AUDIT_VERSION,
              sourceTable,
              normalizeText(row?.id),
              normalizeText(row?.tag_number),
              normalizeText(row?.event_date)
            ].join("||")),
            sourceTable,
            sourceRowId: Number(row?.audit_rowid || 0),
            sourceLogId: normalizeText(row?.source_log_id),
            workDate: normalizeText(row?.event_date).slice(0, 10),
            shift: "",
            role: "",
            author: normalizeText(row?.created_by_name),
            sourceField: "archive.source_text",
            sourceTime: "",
            sourceText: "",
            classification: "archive_without_evidence",
            detectedTags: normalizeText(row?.tag_number) ? [normalizeText(row.tag_number)] : [],
            detectedTypes: [],
            detectedUnits: [],
            detectedPositions: [],
            matchedAssets: [],
            reasons: ["V9 이전 자동 이력에 근거 문장 없음"]
          });
        }
        continue;
      }

      if (!hasBeltWord(sourceText) || !hasReplacementKeyword(sourceText)) {
        records.push({
          key: fingerprintText([
            HISTORY_AUDIT_VERSION,
            sourceTable,
            normalizeText(row?.id),
            normalizeText(row?.tag_number),
            normalizeText(row?.event_date),
            normalizeSimilarityText(sourceText)
          ].join("||")),
          sourceTable,
          sourceRowId: Number(row?.audit_rowid || 0),
          sourceLogId: normalizeText(row?.source_log_id),
          workDate: normalizeText(row?.event_date).slice(0, 10),
          shift: "",
          role: "",
          author: normalizeText(row?.created_by_name),
          sourceField: "archive.source_text",
          sourceTime: "",
          sourceText,
          classification: "archive_non_vbelt_evidence",
          detectedTags: normalizeText(row?.tag_number) ? [normalizeText(row.tag_number)] : [],
          detectedTypes: detectBlowerTypes(sourceText),
          detectedUnits: detectUnitNos(sourceText),
          detectedPositions: detectPositionLabels(sourceText),
          matchedAssets: [],
          reasons: ["V9 이전 자동 이력의 근거가 V-Belt 교체 문장이 아님"]
        });
        continue;
      }
      fragments = [{
        sourceText,
        identityText: normalizeText(row?.tag_number),
        sourceTime: "",
        sourceField: "archive.source_text",
        sourceRole: ""
      }];
    }

    for (const fragment of fragments || []) {
      const record = analyzeHistoricalAuditFragment(
        fragment,
        row,
        sourceTable,
        auditAssets,
        recognitionAssets
      );
      if (record) records.push(record);
    }
  }

  return [...new Map(records.map(record => [record.key, record])).values()];
}

async function loadHistoricalAuditRows(database, cursor, requestedLimit, requestedScanLimit) {
  const parseBatchSize = historicalAuditBatchSize(cursor.source, requestedLimit);

  if (cursor.source === "shift_logs") {
    const result = await database
      .prepare(`
        SELECT rowid AS audit_rowid, id, work_date, shift, role, author, status, log_json
        FROM shift_logs
        WHERE rowid > ?
          AND work_date >= ?
          AND status = '결재완료'
          AND (
            INSTR(LOWER(COALESCE(log_json, '')), 'belt') > 0
            OR INSTR(COALESCE(log_json, ''), '벨트') > 0
          )
          AND (
            INSTR(COALESCE(log_json, ''), '교체') > 0
            OR INSTR(COALESCE(log_json, ''), '교환') > 0
            OR INSTR(LOWER(COALESCE(log_json, '')), 'replac' || 'e') > 0
            OR INSTR(LOWER(COALESCE(log_json, '')), 'replacement') > 0
            OR INSTR(LOWER(COALESCE(log_json, '')), 'exchange') > 0
          )
        ORDER BY rowid ASC
        LIMIT ?
      `)
      .bind(cursor.rowId, HISTORY_BACKFILL_START_DATE, parseBatchSize)
      .all();
    const rows = Array.isArray(result.results) ? result.results : [];
    return {
      rows,
      scannedRows: rows.length,
      cursorRowId: rows.length > 0
        ? Number(rows[rows.length - 1]?.audit_rowid || cursor.rowId)
        : cursor.rowId,
      sourceComplete: rows.length < parseBatchSize,
      parseBatchSize,
      scanBatchSize: parseBatchSize
    };
  }

  if (cursor.source === "legacy_logs") {
    const legacyScanBatchSize = historicalAuditLegacyScanBatchSize(requestedScanLimit);
    const result = await database
      .prepare(`
        SELECT rowid AS audit_rowid, *
        FROM legacy_logs
        WHERE rowid > ?
          AND work_date >= ?
          AND (status = '결재완료' OR UPPER(status) = 'APPROVED')
        ORDER BY rowid ASC
        LIMIT ?
      `)
      .bind(cursor.rowId, HISTORY_BACKFILL_START_DATE, legacyScanBatchSize)
      .all();
    const loadedRows = Array.isArray(result.results) ? result.results : [];
    const rows = [];
    let scannedRows = 0;
    let cursorRowId = cursor.rowId;
    let stoppedAtParseLimit = false;

    for (const row of loadedRows) {
      scannedRows += 1;
      cursorRowId = Number(row?.audit_rowid || cursorRowId);

      if (!historicalAuditRowMayContainBelt(row)) continue;
      rows.push(row);

      if (rows.length >= parseBatchSize) {
        stoppedAtParseLimit = true;
        break;
      }
    }

    return {
      rows,
      scannedRows,
      cursorRowId,
      sourceComplete:
        !stoppedAtParseLimit && loadedRows.length < legacyScanBatchSize,
      parseBatchSize,
      scanBatchSize: legacyScanBatchSize
    };
  }

  const result = await database
    .prepare(`
      SELECT
        rowid AS audit_rowid,
        id,
        tag_number,
        event_type,
        event_date,
        source_log_id,
        source_text,
        created_by_name
      FROM blower_history_event_archive
      WHERE rowid > ?
        AND migration_id = ?
        AND event_type = 'replacement'
      ORDER BY rowid ASC
      LIMIT ?
    `)
    .bind(cursor.rowId, HISTORY_BACKFILL_ID, parseBatchSize)
    .all();
  const rows = Array.isArray(result.results) ? result.results : [];
  return {
    rows,
    scannedRows: rows.length,
    cursorRowId: rows.length > 0
      ? Number(rows[rows.length - 1]?.audit_rowid || cursor.rowId)
      : cursor.rowId,
    sourceComplete: rows.length < parseBatchSize,
    parseBatchSize,
    scanBatchSize: parseBatchSize
  };
}

async function historicalAuditStep(database, body) {
  const cursor = normalizeHistoricalAuditCursor(body?.cursor);
  let page;

  try {
    page = await loadHistoricalAuditRows(
      database,
      cursor,
      body?.analysisLimit,
      body?.scanLimit
    );
  } catch (error) {
    return jsonResponse({
      ok: false,
      readOnly: true,
      retryable: true,
      code: "AUDIT_SOURCE_UNAVAILABLE",
      message: "누락 진단 원본 조회가 일시적으로 실패했습니다. 같은 위치에서 다시 시도합니다.",
      cursor,
      diagnostics: {
        sourceTable: cursor.source,
        detail: error instanceof Error ? error.message : String(error)
      }
    }, 503);
  }

  let storedResult;

  try {
    storedResult = await database
      .prepare(`
        SELECT *
        FROM blower_history_assets
        ORDER BY sort_order ASC, tag_number ASC
      `)
      .all();
  } catch (error) {
    return jsonResponse({
      ok: false,
      readOnly: true,
      retryable: true,
      code: "AUDIT_ASSETS_UNAVAILABLE",
      message: "Blower 설비 기준 조회가 일시적으로 실패했습니다. 같은 위치에서 다시 시도합니다.",
      cursor,
      diagnostics: {
        sourceTable: cursor.source,
        detail: error instanceof Error ? error.message : String(error)
      }
    }, 503);
  }

  const rows = Array.isArray(page?.rows) ? page.rows : [];
  const storedAssets = Array.isArray(storedResult.results) ? storedResult.results : [];
  const recognitionAssets = buildHistoricalAuditAssets(storedAssets);
  const auditAssets = recognitionAssets.filter(asset => Number(asset.enabled) === 1);
  const records = analyzeHistoricalAuditRows(
    rows,
    cursor.source,
    auditAssets,
    recognitionAssets
  );
  const lastRowId = Number(page?.cursorRowId || cursor.rowId);
  const sourceComplete = page?.sourceComplete === true;
  const nextSource = sourceComplete ? nextHistoricalAuditSource(cursor.source) : cursor.source;
  const done = sourceComplete && !nextSource;
  const nextCursor = done
    ? null
    : {
        source: nextSource || cursor.source,
        rowId: sourceComplete ? 0 : lastRowId
      };

  return jsonResponse({
    ok: true,
    readOnly: true,
    version: HISTORY_AUDIT_VERSION,
    done,
    cursor,
    nextCursor,
    scannedRows: Math.max(0, Number(page?.scannedRows) || 0),
    analyzedRows: rows.length,
    summary: summarizeHistoricalAuditRecords(records),
    diagnostics: {
      sourceTable: cursor.source,
      sourceComplete,
      parseBatchSize: page?.parseBatchSize,
      scanBatchSize: page?.scanBatchSize,
      warnings: []
    },
    records
  });
}


async function ensureHistoryRecoveryV12ArchiveCycleSchema(database) {
  const columnResult = await database
    .prepare(`PRAGMA table_info(blower_history_asset_archive_v12)`)
    .all();
  let columns = Array.isArray(columnResult.results) ? columnResult.results : [];
  const requiredColumns = [
    { name: "cycle_started_at", definition: "cycle_started_at TEXT" },
    { name: "cycle_start_state", definition: "cycle_start_state TEXT NOT NULL DEFAULT 'legacy'" },
    { name: "cycle_start_revision", definition: "cycle_start_revision TEXT NOT NULL DEFAULT ''" },
    { name: "cycle_runtime_hours", definition: "cycle_runtime_hours REAL" },
    { name: "cycle_runtime_anchor_at", definition: "cycle_runtime_anchor_at TEXT" },
    { name: "cycle_runtime_state", definition: "cycle_runtime_state TEXT NOT NULL DEFAULT ''" },
    { name: "cycle_runtime_revision", definition: "cycle_runtime_revision TEXT NOT NULL DEFAULT ''" }
  ];

  for (const required of requiredColumns) {
    if (columns.some(column => normalizeText(column.name) === required.name)) continue;

    try {
      await database
        .prepare(`ALTER TABLE blower_history_asset_archive_v12 ADD COLUMN ${required.definition}`)
        .run();
    } catch (error) {
      const retryResult = await database
        .prepare(`PRAGMA table_info(blower_history_asset_archive_v12)`)
        .all();
      const retryColumns = Array.isArray(retryResult.results) ? retryResult.results : [];

      if (!retryColumns.some(column => normalizeText(column.name) === required.name)) {
        throw error;
      }

      columns = retryColumns;
    }
  }
}

async function ensureHistoryRecoveryV12Schema(database) {
  await database.batch([
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_recovery_v12_state (
        id TEXT PRIMARY KEY NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scanning',
        source_table TEXT NOT NULL DEFAULT 'shift_logs',
        cursor_row_id INTEGER NOT NULL DEFAULT 0,
        scanned_rows INTEGER NOT NULL DEFAULT 0,
        staged_events INTEGER NOT NULL DEFAULT 0,
        review_records INTEGER NOT NULL DEFAULT 0,
        unmatched_records INTEGER NOT NULL DEFAULT 0,
        expected_events INTEGER NOT NULL DEFAULT 0,
        lock_token TEXT NOT NULL DEFAULT '',
        lock_expires_at TEXT NOT NULL DEFAULT '',
        started_at TEXT,
        completed_at TEXT,
        message TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_recovery_v12_stage (
        event_key TEXT PRIMARY KEY NOT NULL,
        tag_number TEXT NOT NULL,
        event_date TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_row_id INTEGER NOT NULL DEFAULT 0,
        source_log_id TEXT NOT NULL DEFAULT '',
        source_role TEXT NOT NULL DEFAULT '',
        source_author TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        decision_reason TEXT NOT NULL DEFAULT '',
        support_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_blower_history_recovery_v12_stage_tag_date
      ON blower_history_recovery_v12_stage (tag_number, event_date)
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_recovery_v12_audit (
        record_key TEXT PRIMARY KEY NOT NULL,
        category TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_row_id INTEGER NOT NULL DEFAULT 0,
        source_log_id TEXT NOT NULL DEFAULT '',
        work_date TEXT NOT NULL DEFAULT '',
        source_role TEXT NOT NULL DEFAULT '',
        source_author TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        resolved_tags TEXT NOT NULL DEFAULT '[]',
        resolved_dates TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )
    `),
    database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_blower_history_recovery_v12_audit_category
      ON blower_history_recovery_v12_audit (category, work_date, source_row_id)
    `),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS blower_history_asset_archive_v12 (
        migration_id TEXT NOT NULL,
        tag_number TEXT NOT NULL,
        blower_type TEXT NOT NULL,
        unit_no TEXT NOT NULL,
        position_label TEXT NOT NULL,
        display_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_replacement_at TEXT,
        cycle_started_at TEXT,
        cycle_start_state TEXT NOT NULL DEFAULT 'legacy',
        cycle_start_revision TEXT NOT NULL DEFAULT '',
        cycle_runtime_hours REAL,
        cycle_runtime_anchor_at TEXT,
        cycle_runtime_state TEXT NOT NULL DEFAULT '',
        cycle_runtime_revision TEXT NOT NULL DEFAULT '',
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
    `)
  ]);

  await ensureHistoryRecoveryV12ArchiveCycleSchema(database);

  const now = new Date().toISOString();
  await database.prepare(`
    INSERT OR IGNORE INTO blower_history_recovery_v12_state (
      id, version, status, source_table, cursor_row_id, scanned_rows,
      staged_events, review_records, unmatched_records, expected_events,
      started_at, updated_at
    ) VALUES (?, ?, 'scanning', 'shift_logs', 0, 0, 0, 0, 0, ?, ?, ?)
  `).bind(
    HISTORY_RECOVERY_V12_ID,
    HISTORY_RECOVERY_V12_VERSION,
    HISTORY_RECOVERY_V12_EXPECTED_EVENTS,
    now,
    now
  ).run();

  const recoveryState = await database
    .prepare(`
      SELECT version, status
      FROM blower_history_recovery_v12_state
      WHERE id = ?
      LIMIT 1
    `)
    .bind(HISTORY_RECOVERY_V12_ID)
    .first();

  if (
    recoveryState &&
    normalizeText(recoveryState.version) !== HISTORY_RECOVERY_V12_VERSION &&
    normalizeText(recoveryState.status) !== "complete"
  ) {
    const migrationNow = new Date().toISOString();

    await database.batch([
      database.prepare(`DELETE FROM blower_history_recovery_v12_stage`),
      database.prepare(`DELETE FROM blower_history_recovery_v12_audit`),
      database.prepare(`
        UPDATE blower_history_recovery_v12_state
        SET version = ?,
            status = 'scanning',
            source_table = 'shift_logs',
            cursor_row_id = 0,
            scanned_rows = 0,
            staged_events = 0,
            review_records = 0,
            unmatched_records = 0,
            expected_events = ?,
            lock_token = '',
            lock_expires_at = '',
            started_at = ?,
            completed_at = NULL,
            message = 'V13 업무일지 문맥 기반 복구를 새로 시작합니다.',
            updated_at = ?
        WHERE id = ?
      `).bind(
        HISTORY_RECOVERY_V12_VERSION,
        HISTORY_RECOVERY_V12_EXPECTED_EVENTS,
        migrationNow,
        migrationNow,
        HISTORY_RECOVERY_V12_ID
      )
    ]);
  }

}

async function ensureHistoryRecoveryV12Ready(database) {
  // 정상 운영/복구 요청마다 CREATE TABLE/INDEX DDL을 반복하지 않는다.
  // 현재 V13 state가 이미 존재하면 단일 SELECT만 수행하고 바로 진행한다.
  try {
    const current = await database.prepare(`
      SELECT version, status
      FROM blower_history_recovery_v12_state
      WHERE id = ?
      LIMIT 1
    `).bind(HISTORY_RECOVERY_V12_ID).first();

    if (
      current &&
      normalizeText(current.version) === HISTORY_RECOVERY_V12_VERSION
    ) {
      return;
    }
  } catch (error) {
    // 최초 설치처럼 state table 자체가 아직 없으면 아래 full schema ensure로 이동한다.
  }

  await ensureHistoryRecoveryV12Schema(database);
}


function v13CanonicalTagNumbers(text, assets = []) {
  const normalized = normalizeText(text).toUpperCase();
  const tags = new Set(extractRecognizedBlowerTags(normalized, assets));

  for (const [legacyTag, canonicalTag] of Object.entries(HISTORY_RECOVERY_V13_TAG_ALIASES)) {
    if (normalized.includes(legacyTag)) tags.add(canonicalTag);
  }

  return [...tags];
}

function v13DetectTypes(text) {
  const normalized = normalizeText(text).toLowerCase();
  const found = new Set();

  if (/(?:\bfbhe\b|\bfhbe\b|hhl60)/i.test(normalized)) found.add('fbhe');
  if (/(?:seal\s*pot|sealpot|hhl10)/i.test(normalized)) found.add('seal_pot');
  if (/(?:유기성\s*고형연료|유기성고형연료|organic\s*fuel|sdf01)/i.test(normalized)) found.add('organic_fuel');
  if (hasManureBlowerContext(text)) found.add('organic_fuel');

  if (/(?:fly\s*ash\s*silo\s*aeration|silo\s*aeration|eth03)/i.test(normalized)) {
    found.add('flyash_silo');
  }

  if (/(?:fly\s*ash\s*bag\s*filter(?:\s*aeration)?|bag\s*filter\s*(?:fly\s*ash\s*)?aeration|bagfilter\s*aeration|etg30)/i.test(normalized)) {
    found.add('flyash_bag');
  } else if (
    /fly\s*ash\s*aeration\s*(?:blower|blwr|fan)?/i.test(normalized) &&
    !found.has('flyash_silo')
  ) {
    // 과거 업무일지에서 "Fly Ash Aeration Blower"는 Bag Filter Aeration의 축약명으로 사용됨.
    found.add('flyash_bag');
  }

  return [...found];
}

function v13DetectUnitPositionPairs(text) {
  const normalized = normalizeText(text).toUpperCase();
  const pairs = [];
  const seen = new Set();

  for (const match of normalized.matchAll(/(?:^|[^0-9A-Z])([12])\s*[-_/]\s*#?\s*([ABC])(?=$|[^A-Z0-9])/g)) {
    const key = `${match[1]}:#${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ unit: match[1], position: `#${match[2]}` });
  }

  return pairs;
}

function v13SuffixPositions(types, text) {
  const normalized = normalizeText(text).toUpperCase();
  const found = new Set();
  const typeSet = new Set(types || []);

  if (typeSet.has('fbhe') || typeSet.has('seal_pot')) {
    if (/\b611\b/.test(normalized)) found.add('#A');
    if (/\b621\b/.test(normalized)) found.add('#B');
    if (/\b631\b/.test(normalized)) found.add('#C');
  }
  if (typeSet.has('organic_fuel')) {
    if (/\b001\b/.test(normalized)) found.add('#A');
    if (/\b002\b/.test(normalized)) found.add('#B');
  }
  if (typeSet.has('flyash_bag') || typeSet.has('flyash_silo')) {
    if (/\b601\b/.test(normalized)) found.add('#A');
    if (/\b602\b/.test(normalized)) found.add('#B');
  }

  return [...found];
}

function v13HasExplicitMultiUnit(text) {
  const normalized = normalizeText(text);
  return (
    /(?:#\s*)?1\s*[,/&+·]\s*(?:#\s*)?2(?:\s*호기|\s*호|\s*BLR|\b)/i.test(normalized) ||
    /(?:1\s*,\s*2|1\s*&\s*2)\s*호기/i.test(normalized) ||
    /양\s*호기/.test(normalized)
  );
}

function v13HistoricalPositionLabels(text) {
  const normalized = normalizeText(text).toUpperCase();
  const found = new Set(v12ExpandPositionRange(normalized));

  // 기존 detectPositionLabels()의 \\b는 "_" 뒤에서 경계로 인식되지 않는다.
  // 과거 일지의 "#C_11월7일", "#A_12/17" 같은 요약 표기를 별도로 인식한다.
  for (const match of normalized.matchAll(/#\s*([ABC])(?=$|[^A-Z0-9])/g)) {
    found.add(`#${match[1]}`);
  }

  return ['#A', '#B', '#C'].filter(position => found.has(position));
}

function v13DirectBeltPositions(text) {
  const normalized = normalizeText(text).toUpperCase();
  const found = new Set();
  const beltWord = '(?:V\\s*[-/]?\\s*BELT|VBELT|BELT|V\\s*[-/]?\\s*벨트|V벨트|벨트)';

  // Belt 바로 앞의 단일/목록 위치만 직접 대상으로 본다.
  // 교체운전 화살표의 출발/도착 위치는 이 패턴에 들어오지 않는다.
  const listBeforeBelt = new RegExp(
    `(#\\s*[ABC](?:\\s*[,/&+·]\\s*#?\\s*[ABC]){0,2})\\s*${beltWord}`,
    'g'
  );
  for (const match of normalized.matchAll(listBeforeBelt)) {
    addPositionTokens(match[1], found);
  }

  // #A-C / #A~#C 같은 실제 다중 교체 범위가 Belt 바로 앞에 있는 경우만 확장한다.
  const rangeBeforeBelt = new RegExp(
    `#?\\s*([ABC])\\s*(?:~|－|–|—|-)\\s*#?\\s*([ABC])\\s*${beltWord}`,
    'g'
  );
  for (const match of normalized.matchAll(rangeBeforeBelt)) {
    const order = ['A', 'B', 'C'];
    const a = order.indexOf(match[1]);
    const b = order.indexOf(match[2]);
    if (a < 0 || b < 0) continue;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) found.add(`#${order[i]}`);
  }

  // 실제 Belt 교체 표현까지 다른 #표기가 끼지 않는 위치만 추가한다.
  // 예: "#B 교체 운전 실시 : FBHE Blower #A V-Belt 교체 완료" -> #A만.
  const nearBelt = new RegExp(
    `#\\s*([ABC])(?=[^#\\n]{0,32}${beltWord}[^#\\n]{0,32}(?:교체|교환))`,
    'g'
  );
  for (const match of normalized.matchAll(nearBelt)) {
    found.add(`#${match[1]}`);
  }

  // 과거 요약형: "#C_11월7일 Belt 교체", "#B 11월3일 Belt 교체".
  const datedNearBelt = new RegExp(
    `#\\s*([ABC])(?=[^#\\n]{0,36}(?:\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일?|\\d{1,2}\\s*[./-]\\s*\\d{1,2})?[^#\\n]{0,12}${beltWord}[^#\\n]{0,24}(?:교체|교환))`,
    'g'
  );
  for (const match of normalized.matchAll(datedNearBelt)) {
    found.add(`#${match[1]}`);
  }

  return ['#A', '#B', '#C'].filter(position => found.has(position));
}

function v13IdentityFromText(text, role, assets, structuredText = '') {
  const source = normalizeText(text);
  const structured = normalizeText(structuredText);
  const combined = [structured, source].filter(Boolean).join(' ');
  const detectedTags = v13CanonicalTagNumbers(combined, assets);
  const tagResolution = detectedTags.length > 0
    ? resolveExplicitTagIdentity(combined, detectedTags, assets)
    : null;
  const identityConflict = detectedTags.length > 0 && !tagResolution?.consistent;
  const tags = new Set(identityConflict ? [] : (tagResolution?.tags || []));
  const semanticCombined = tagResolution?.semanticText || combined;
  const semanticSource = textWithoutRecognizedTagSpans(source, assets);
  const types = new Set(v13DetectTypes(semanticCombined));
  const explicitManureGroup = hasManureBlowerContext(semanticCombined);
  const tagGroups = new Set();
  const explicitUnits = new Set(detectUnitNos(semanticCombined));
  const directPositions = new Set(v13DirectBeltPositions(semanticSource));
  const broadPositions = new Set(detectTextPositionLabels(semanticCombined));
  const switchLike = /(?:교체운전|교체\s*운전|->|→)/i.test(source);
  const sourceHasBeltAction = v13HasDirectBeltAction(source) || hasBeltReplacementPhrase(source);
  const explicitPositions = new Set(
    directPositions.size > 0
      ? directPositions
      : (switchLike && sourceHasBeltAction ? [] : broadPositions)
  );
  const pairs = v13DetectUnitPositionPairs(semanticCombined);

  for (const pair of pairs) {
    explicitUnits.add(pair.unit);
    if (directPositions.size === 0) explicitPositions.add(pair.position);
  }

  for (const tag of tags) {
    const asset = (assets || []).find(item => normalizeText(item?.tag_number).toUpperCase() === tag);
    if (!asset) continue;
    types.add(asset.blower_type);
    tagGroups.add(assetGroupKey(asset));
    explicitUnits.add(asset.unit_no);
    if (directPositions.size === 0) explicitPositions.add(asset.position_label);
  }

  if (directPositions.size === 0 && broadPositions.size === 0) {
    for (const position of v13SuffixPositions([...types], semanticCombined)) {
      explicitPositions.add(position);
    }
  }

  if (v13HasExplicitMultiUnit(semanticCombined)) {
    explicitUnits.add('1');
    explicitUnits.add('2');
  }

  const roleUnit = DUTY_ROLE_UNIT[normalizeDutyPosition(role)] || '';
  const units = new Set(explicitUnits);
  if (units.size === 0 && roleUnit) units.add(roleUnit);
  if (types.size === 1 && types.has('flyash_silo')) {
    units.clear();
    units.add('shared');
  }

  let assetGroup = explicitManureGroup ? 'manure' : null;
  if (!explicitManureGroup && tagGroups.size === 1) assetGroup = [...tagGroups][0];
  if (assetGroup === null && tags.size === 0 && types.size === 1 && types.has('organic_fuel')) assetGroup = '';

  return {
    tags: [...tags],
    types: [...types],
    units: [...units],
    positions: ['#A', '#B', '#C'].filter(position => explicitPositions.has(position)),
    assetGroup,
    directPositions: ['#A', '#B', '#C'].filter(position => directPositions.has(position)),
    explicitUnits: [...explicitUnits],
    explicitPositions: ['#A', '#B', '#C'].filter(position => explicitPositions.has(position)),
    roleUnit,
    hasManagedIdentity: !identityConflict && (tags.size > 0 || types.size > 0),
    explicitMultiUnit: v13HasExplicitMultiUnit(semanticCombined),
    identityConflict
  };
}

function v13IsForeignEquipmentText(text, identity) {
  if (identity?.hasManagedIdentity) return false;
  const normalized = normalizeText(text);
  return /(?:limestone|bed\s*ash|bed\s*material|dust\s*collector|dosing\s*conveyor|ahu[-\s]*\d*|hvac|fin\s*fan|vent\s*filter\s*fan|vent\s*fan|screw\s*feeder|보조보일러)/i.test(normalized);
}

function v13ContextBucket(record) {
  const field = normalizeText(record?.sourceField) || 'canonical';
  const indexed = field.match(/^(.+?\[\d+\])/);
  if (indexed) return indexed[1];
  return field.split('.').slice(0, 2).join('.') || field;
}

function v13MergeContext(previous, own, sourceText) {
  if (own?.hasManagedIdentity) {
    return {
      ...own,
      inherited: false,
      evidenceText: normalizeText(sourceText)
    };
  }

  if (!previous) {
    return {
      ...own,
      inherited: false,
      evidenceText: normalizeText(sourceText)
    };
  }

  const units = own.explicitUnits?.length > 0
    ? [...own.explicitUnits]
    : [...(previous.units || [])];
  const positions = own.explicitPositions?.length > 0
    ? [...own.explicitPositions]
    : [...(previous.positions || [])];
  const evidenceParts = [normalizeText(previous.evidenceText), normalizeText(sourceText)].filter(Boolean);

  // 이전 문장에 TAG가 있었더라도 현재 문장이 #A/#B/#C 또는 호기를 새로 명시하면
  // 이전 TAG를 고정하지 않는다. 설비 종류 문맥만 이어받고 현재 위치/호기로 다시 귀속한다.
  const hasOwnLocator =
    (own.explicitUnits?.length || 0) > 0 ||
    (own.explicitPositions?.length || 0) > 0;
  const tags = hasOwnLocator ? [] : [...(previous.tags || [])];

  return {
    ...previous,
    tags,
    units,
    positions,
    directPositions: own.directPositions?.length > 0 ? [...own.directPositions] : [],
    explicitUnits: own.explicitUnits || [],
    explicitPositions: own.explicitPositions || [],
    inherited: true,
    evidenceText: [...new Set(evidenceParts)].join(' → ')
  };
}

function v13ContextualizeAuditRecords(records, assets) {
  const active = new Map();
  const output = [];

  for (const record of records || []) {
    const role = normalizeDutyPosition(record?.role);
    const key = [record?.sourceTable, record?.sourceRowId, role, v13ContextBucket(record)].join('::');
    if (fragmentHasIdentityConflict(record, assets)) {
      active.delete(key);
      output.push({
        ...record,
        v13Context: { identityConflict: true, hasManagedIdentity: false },
        v13EvidenceText: normalizeText(record?.sourceText)
      });
      continue;
    }
    const own = v13IdentityFromText(
      record?.sourceText,
      role,
      assets,
      record?.identityText || (record?.detectedTags || []).join(' ')
    );

    if (own.identityConflict) {
      active.delete(key);
      output.push({ ...record, v13Context: own, v13EvidenceText: normalizeText(record?.sourceText) });
      continue;
    }

    if (v13IsForeignEquipmentText(record?.sourceText, own)) {
      active.delete(key);
      output.push({ ...record, v13Context: own, v13EvidenceText: normalizeText(record?.sourceText) });
      continue;
    }

    const previous = active.get(key) || null;
    const context = v13MergeContext(previous, own, record?.sourceText);

    if (context?.hasManagedIdentity || (previous && (own.explicitUnits?.length || own.explicitPositions?.length))) {
      active.set(key, context);
    }

    output.push({
      ...record,
      v13Context: context,
      v13EvidenceText: normalizeText(context?.evidenceText || record?.sourceText)
    });
  }

  return output;
}

function v13ContextIdentityText(context) {
  if (!context) return '';
  const typeLabels = (context.types || []).map(type => TYPE_IDENTITY_LABELS[type]).filter(Boolean);
  const units = (context.units || []).filter(unit => unit !== 'shared').map(unit => `#${unit} BLR`);
  return [
    ...(context.tags || []),
    context.assetGroup === 'manure' ? '축분 Blower' : '',
    ...typeLabels,
    ...units,
    ...(context.positions || [])
  ].filter(Boolean).join(' ');
}

function v13ContextualizeScanFragments(fragments, row, assets) {
  const output = [];
  let active = null;

  for (const fragment of fragments || []) {
    const role = fragmentSourceRole(fragment) || normalizeDutyPosition(row?.role);
    if (fragmentHasIdentityConflict(fragment, assets)) {
      active = null;
      output.push({
        ...fragment,
        v13Context: { identityConflict: true, hasManagedIdentity: false },
        v13EvidenceText: fragmentSourceText(fragment)
      });
      continue;
    }
    const own = v13IdentityFromText(
      fragmentSourceText(fragment),
      role,
      assets,
      fragmentIdentityText(fragment)
    );

    if (own.identityConflict) {
      active = null;
      output.push({
        ...fragment,
        v13Context: own,
        v13EvidenceText: fragmentSourceText(fragment)
      });
      continue;
    }

    if (v13IsForeignEquipmentText(fragmentSourceText(fragment), own)) {
      active = null;
      output.push({ ...fragment, v13Context: own, v13EvidenceText: fragmentSourceText(fragment) });
      continue;
    }

    const context = v13MergeContext(active, own, fragmentSourceText(fragment));
    if (context?.hasManagedIdentity || (active && (own.explicitUnits?.length || own.explicitPositions?.length))) {
      active = context;
    }

    output.push({
      ...fragment,
      identityText: [fragmentIdentityText(fragment), v13ContextIdentityText(context)].filter(Boolean).join(' '),
      v13Context: context,
      v13EvidenceText: normalizeText(context?.evidenceText || fragmentSourceText(fragment))
    });
  }

  return output;
}

function v13HasDirectBeltAction(text) {
  const normalized = normalizeText(text);
  return (
    /(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트)\s*(?:전량\s*)?(?:교체|교환)(?=\s|[,/&+.)\]]|$)/i.test(normalized) ||
    /(?:교체|교환)\s*(?:완료|실시|시행|함|하였|했|하여)?\s*(?:한|된)?\s*(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트)\b/i.test(normalized)
  );
}

function v13HardNegativeReplacement(text) {
  const normalized = normalizeText(text);
  return /(?:미교체|미실시|미완료|교체\s*미실시|교체\s*미완료|교체\s*보류|교체\s*취소|교체\s*불가|교체\s*안\s*함|교체하지\s*않|교체\s*하려.{0,12}미실시|not\s*replaced|replacement\s*cancell?ed)/i.test(normalized);
}

function v13SoftPlanReplacement(text) {
  const normalized = normalizeText(text);
  return (
    /(?:교체|교환)\s*(?:작업\s*)?(?:예정|요청|문의|요망|필요|검토|준비|지시)/i.test(normalized) ||
    /(?:명일|차주|차후|추후|향후).{0,40}(?:belt|벨트).{0,24}(?:교체|교환)/i.test(normalized) ||
    /(?:belt|벨트).{0,24}(?:교체|교환)\s*(?:관련\s*정지|위해|입회|지원)/i.test(normalized) ||
    /(?:belt|벨트).{0,24}(?:교체|교환)(?:로|을|를)?\s*(?:인해|관련)\s*(?:정지|대기|정상화)/i.test(normalized) ||
    /(?:교체|교환)\s*(?:작업\s*)?입회/i.test(normalized)
  );
}

function v13InheritedGenericCompletion(record) {
  if (record?.v13Context?.inherited !== true) return false;
  const current = normalizeText(record?.sourceText);
  const evidence = normalizeText(record?.v13EvidenceText);
  if (!current || !evidence || !hasBeltWord(evidence)) return false;
  if (hasBeltWord(current)) return false;
  if (v13HardNegativeReplacement(current) || v13SoftPlanReplacement(current)) return false;
  if (/(?:filter|필터|oil|오일|psv|sensor|센서|bearing|베어링|pulley|풀리|seal|씰|gasket|가스켓|hose|호스|motor|모터|bolt|볼트|grease|구리스|impeller|임펠러)/i.test(current)) return false;
  return /(?:교체|교환)\s*(?:작업\s*)?(?:완료|실시|시행|함|하였|했|하여|후\s*(?:재?기동|기동|정상화|정상|양호))/i.test(current);
}

function v13AuditRelevantRecord(record) {
  const current = normalizeText(record?.sourceText);
  if (hasBeltWord(current) && hasReplacementKeyword(current)) return true;
  return v13InheritedGenericCompletion(record);
}

function v13StrongReplacementCompletion(text) {
  const normalized = normalizeText(text);
  if (v13HardNegativeReplacement(normalized)) return false;

  if (hasDirectCompletedBeltReplacement(normalized)) return true;
  if (/(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트).{0,28}(?:전량\s*)?(?:교체|교환)\s*(?:작업\s*)?(?:완료|실시|시행|함|하였|했|하여)(?=\s|[,/&+.)\]]|$)/i.test(normalized)) return true;
  if (/(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트).{0,28}(?:전량\s*)?(?:교체|교환)\s*후\s*(?:재?기동|운전|정상|양호|stand\s*by)/i.test(normalized)) return true;
  if (/(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트).{0,28}(?:전량\s*)?(?:교체|교환)\s*(?:및|,)\s*.{0,60}(?:상태\s*)?(?:정상|양호|stand\s*by)/i.test(normalized)) return true;
  if (/(?:신품|new).{0,18}(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트).{0,18}(?:교체|교환|취부|설치|장착)/i.test(normalized)) return true;
  if (/(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트).{0,18}(?:신품|new).{0,18}(?:교체|교환|취부|설치|장착)/i.test(normalized)) return true;
  return false;
}

function v13BareReplacementAction(text) {
  const normalized = normalizeText(text);
  if (!v13HasDirectBeltAction(normalized) && !hasBeltReplacementPhrase(normalized)) return false;
  if (v13HardNegativeReplacement(normalized) || v13SoftPlanReplacement(normalized)) return false;
  if (/(?:교체|교환)\s*(?:작업\s*)?입회|교체\s*건\s*$/i.test(normalized)) return false;

  return (
    /(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트).{0,18}(?:전량\s*)?(?:교체|교환)(?:\s*[,/&+]|\s*$|\s*\)|\s*\])/i.test(normalized) ||
    /(?:TM|BM|CM)\s*작업.{0,80}(?:V\s*[-/]?\s*Belt|V-Belt|Belt|벨트).{0,18}(?:교체|교환)/i.test(normalized) ||
    /(?:[01]?\d|2[0-3]):[0-5]\d.{0,100}(?:V\s*[-/]?\s*Belt|V-Belt|Belt|벨트).{0,18}(?:교체|교환)/i.test(normalized)
  );
}

function v13ActualBeltReplacement(text, workDate, allowHistoricalReference = true) {
  const normalized = normalizeText(text);
  if (!normalized || !hasBeltWord(normalized) || !hasReplacementKeyword(normalized)) return false;
  if (!v13HasDirectBeltAction(normalized) && !hasBeltReplacementPhrase(normalized)) return false;
  if (hasBeltAccessoryReplacementPhrase(normalized) && !hasDirectCompletedBeltReplacement(normalized)) return false;
  if (v13HardNegativeReplacement(normalized)) return false;

  const switchLike = /(?:교체운전|교체\s*운전|->|→)/i.test(normalized);
  // 교체운전은 설비 운전 전환이지 Belt 교체가 아니다. 같은 문장에 Belt 자체의 직접 교체 표현이
  // 별도로 있을 때만 실제 교체 판정을 계속한다.
  if (switchLike && !v13HasDirectBeltAction(normalized) && !hasDirectCompletedBeltReplacement(normalized)) return false;

  const softPlan = v13SoftPlanReplacement(normalized);
  const replacementMentions = (normalized.match(/(?:교체|교환)/g) || []).length;
  // "교체 요청 (작업 완료)"처럼 요청 처리 완료를 실제 Belt 교체로 오인하지 않는다.
  // 요청/예정 뒤에 별도의 두 번째 교체 완료 표현이 있을 때만 아래 완료 판정을 허용한다.
  if (softPlan && replacementMentions < 2) return false;
  if (v13StrongReplacementCompletion(normalized)) return true;
  if (softPlan) return false;

  if (allowHistoricalReference && v12ExtractDateTokens(normalized, workDate).length > 0) {
    return true;
  }

  return v13BareReplacementAction(normalized);
}

function v13ResolveTargets(record, assets, recognitionAssets = assets) {
  if (fragmentHasIdentityConflict(record, recognitionAssets)) return [];
  const context = record?.v13Context || v13IdentityFromText(
    record?.sourceText,
    record?.role,
    recognitionAssets,
    record?.identityText || ''
  );
  if (context?.identityConflict) return [];
  const targets = new Map();
  const directPositions = new Set(context?.directPositions || []);

  for (const tag of context?.tags || []) {
    const asset = (assets || []).find(item => normalizeText(item?.tag_number).toUpperCase() === tag);
    if (!asset) continue;
    // 같은 문장 안에서 TAG와 Belt 대상 위치가 충돌하면 자동 확정하지 않는다.
    if (directPositions.size > 0 && !directPositions.has(asset.position_label)) continue;
    if (context?.assetGroup !== null && context?.assetGroup !== undefined && assetGroupKey(asset) !== context.assetGroup) continue;
    targets.set(asset.tag_number, asset);
  }

  const unresolvedExplicitTag = (context?.tags || []).some(tag => !targets.has(tag));

  // An explicit TAG that is no longer active must never fall through to
  // type/unit/position matching, or an old log can be assigned to a successor
  // occupying the same slot.
  if ((context?.tags || []).length > 0 && targets.size === 0) {
    return [];
  }

  if (targets.size > 0) {
    if (unresolvedExplicitTag) {
      return [...targets.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    }

    const types = new Set([...targets.values()].map(item => item.blower_type));
    const units = new Set([...targets.values()].map(item => item.unit_no));
    const groups = new Set([...targets.values()].map(item => assetGroupKey(item)));
    if (types.size === 1 && units.size === 1 && groups.size === 1 && (context?.positions || []).length > 1) {
      const type = [...types][0];
      const unit = [...units][0];
      const group = [...groups][0];
      for (const asset of assets || []) {
        if (
          asset.blower_type === type &&
          asset.unit_no === unit &&
          assetGroupKey(asset) === group &&
          context.positions.includes(asset.position_label)
        ) {
          if (!targets.has(asset.tag_number) && !managedAssetAllowsContextualMatch(asset, record?.workDate)) continue;
          targets.set(asset.tag_number, asset);
        }
      }
    }
    return [...targets.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }

  const types = context?.types || [];
  if (types.length !== 1) return [];
  const type = types[0];
  const positions = context?.positions || [];
  if (positions.length === 0) return [];
  const units = type === 'flyash_silo' ? ['shared'] : (context?.units || []);
  if (units.length === 0) return [];
  if (units.length > 1 && !context?.explicitMultiUnit) return [];

  for (const asset of assets || []) {
    if (!managedAssetAllowsContextualMatch(asset, record?.workDate)) continue;
    if (asset.blower_type !== type) continue;
    const requiredGroup = type === 'organic_fuel' && context?.assetGroup === 'manure'
      ? 'manure'
      : '';
    if (assetGroupKey(asset) !== requiredGroup) continue;
    if (!units.includes(asset.unit_no)) continue;
    if (!positions.includes(asset.position_label)) continue;
    targets.set(asset.tag_number, asset);
  }

  return [...targets.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function v13EventsForRecord(record, targets) {
  const workDate = normalizeText(record?.workDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return [];
  const text = normalizeText(record?.sourceText);
  const byPosition = v12PositionSpecificDates(text, workDate);
  const explicitDates = v12ExtractDateTokens(text, workDate);
  const events = [];

  if (targets.length === 1 && explicitDates.length > 0) {
    for (const date of explicitDates) events.push({ target: targets[0], date });
    return events;
  }

  if (byPosition.size > 0) {
    for (const target of targets) {
      const date = byPosition.get(target.position_label);
      if (date) events.push({ target, date });
    }
    if (events.length === targets.length) return events;
  }

  if (explicitDates.length === 1) {
    for (const target of targets) events.push({ target, date: explicitDates[0] });
    return events;
  }

  if (explicitDates.length > 1) return [];

  for (const target of targets) events.push({ target, date: workDate });
  return events;
}

function v13EvaluateAuditRecord(record, assets) {
  const text = normalizeText(record?.sourceText);
  const inheritedGenericCompletion = v13InheritedGenericCompletion(record);
  const evaluationText = inheritedGenericCompletion
    ? normalizeText(record?.v13EvidenceText)
    : text;
  if (!text || (!hasBeltWord(text) || !hasReplacementKeyword(text)) && !inheritedGenericCompletion) {
    return { category: 'unmatched', reason: 'V-Belt 교체 문장 아님', events: [] };
  }
  if (normalizeDutyPosition(record?.role) === 'PART_LEADER') {
    return { category: 'review', reason: '파트장 원문은 자동 복구 제외', events: [] };
  }
  if (!v13ActualBeltReplacement(evaluationText, record?.workDate, true)) {
    return { category: 'excluded', reason: '실제 V-Belt 교체 완료 근거 없음', events: [] };
  }

  const targets = v13ResolveTargets(record, assets);
  if (targets.length === 0) {
    const context = record?.v13Context;
    const managed = (context?.types || []).length === 1 || (context?.tags || []).length > 0;
    return {
      category: managed ? 'review' : 'unmatched',
      reason: managed ? '설비는 식별했지만 A/B/C 위치 확정 불가' : '관리 대상 Blower 귀속 불명확',
      events: []
    };
  }

  const events = v13EventsForRecord(record, targets);
  if (events.length === 0) {
    return { category: 'review', reason: '교체일 확정 불가', events: [] };
  }
  if (events.some(item => item.date > HISTORY_RECOVERY_V12_CUTOFF_DATE)) {
    return { category: 'review', reason: 'V13 기준일 이후 날짜', events: [] };
  }

  const inherited = record?.v13Context?.inherited === true;
  return {
    category: 'confirmed',
    reason: inherited ? 'V13 업무일지 문맥 승계로 실제 V-Belt 교체 확정' : 'V13 업무일지 직접 문맥으로 실제 V-Belt 교체 확정',
    events
  };
}

function v12RolePriority(role) {
  return ({ BCO1: 60, BCO2: 60, TGO: 55, BO1: 40, BO2: 40, TO: 35, PART_LEADER: 10 })[
    normalizeDutyPosition(role)
  ] || 20;
}

function v12ExpandPositionRange(text) {
  const found = new Set(detectPositionLabels(text));
  const normalized = normalizeText(text).toUpperCase();
  if (/(?:#\s*)?A\s*(?:~|－|–|—|-)\s*(?:#\s*)?C\b/.test(normalized)) {
    found.add('#A'); found.add('#B'); found.add('#C');
  }
  if (/(?:#\s*)?A\s*(?:~|－|–|—|-)\s*(?:#\s*)?B\b/.test(normalized)) {
    found.add('#A'); found.add('#B');
  }
  if (/(?:#\s*)?B\s*(?:~|－|–|—|-)\s*(?:#\s*)?C\b/.test(normalized)) {
    found.add('#B'); found.add('#C');
  }
  return ['#A', '#B', '#C'].filter(position => found.has(position));
}

function v12DirectBeltTargetPositions(text) {
  const normalized = normalizeText(text).toUpperCase();
  const found = new Set();
  const patterns = [
    /(?:BLOWER|FAN|블로워|브로워)?\s*(#\s*[ABC](?:\s*[,/&+·]\s*#?\s*[ABC]){0,2})\s*(?:V\s*[-/]?\s*BELT|VBELT|BELT|V\s*[-/]?\s*벨트|V벨트|벨트)/g,
    /(#\s*[ABC](?:\s*[,/&+·]\s*#?\s*[ABC]){0,2}).{0,28}?(?:V\s*[-/]?\s*BELT|VBELT|BELT|V\s*[-/]?\s*벨트|V벨트|벨트).{0,28}?(?:교체|교환)/g
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) addPositionTokens(match[1], found);
  }
  if (/(?:#\s*)?A\s*(?:~|－|–|—|-)\s*(?:#\s*)?C\b/.test(normalized)) {
    found.add('#A'); found.add('#B'); found.add('#C');
  }
  if (/(?:#\s*)?A\s*(?:~|－|–|—|-)\s*(?:#\s*)?B\b/.test(normalized)) {
    found.add('#A'); found.add('#B');
  }
  if (/(?:#\s*)?B\s*(?:~|－|–|—|-)\s*(?:#\s*)?C\b/.test(normalized)) {
    found.add('#B'); found.add('#C');
  }
  return ['#A', '#B', '#C'].filter(position => found.has(position));
}

function v12DetectUnits(text, role) {
  const normalized = normalizeText(text).toUpperCase();
  const explicit = new Set(detectUnitNos(normalized));
  if (/(?:#\s*)?1\s*[,/&+·]\s*(?:#\s*)?2(?:\s*호기|\s*호|\s*BLR|\b)/i.test(normalized) ||
      /(?:1\s*,\s*2|1\s*&\s*2)\s*호기/i.test(normalized) ||
      /양\s*호기/.test(normalized)) {
    explicit.add('1'); explicit.add('2');
  }
  if (explicit.size > 0) return [...explicit].sort();
  const roleUnit = DUTY_ROLE_UNIT[normalizeDutyPosition(role)] || '';
  return roleUnit ? [roleUnit] : [];
}

function v12DetectTypes(text) {
  const found = new Set(detectBlowerTypes(text));
  const normalized = normalizeText(text).toLowerCase();
  if (/fly\s*ash\s*bag\s*filter\s*(?:aeration\s*)?(?:blower|fan)/i.test(normalized)) found.add('flyash_bag');
  if (/fly\s*ash\s*silo\s*(?:aeration\s*)?(?:blower|fan)/i.test(normalized)) found.add('flyash_silo');
  return [...found];
}

function v12StrongCompletion(text) {
  const normalized = normalizeText(text);
  const directBeltCompleted = /(?:V\s*[-/]?\s*Belt|V-Belt|Belt|V\s*[-/]?\s*벨트|V벨트|벨트).{0,18}(?:교체|교환).{0,12}(?:완료|실시|시행|함|하였|했)/i.test(normalized);
  if (!hasBeltWord(normalized) || !hasReplacementKeyword(normalized)) return false;
  if (!hasBeltReplacementPhrase(normalized) && !directBeltCompleted && !hasDirectCompletedBeltReplacement(normalized)) return false;
  if (hasBeltAccessoryReplacementPhrase(normalized) && !directBeltCompleted && !hasDirectCompletedBeltReplacement(normalized)) return false;
  if (/교체\s*(?:예정|계획|요망|필요|검토|준비|지시)/i.test(normalized)) return false;
  if (/명일.{0,40}(?:belt|벨트).{0,24}교체/i.test(normalized)) return false;
  if (/(?:교체\s*요청|교체요청)(?!\s*건.{0,24}(?:작업\s*)?완료)/i.test(normalized)) return false;
  if (/(?:미교체|교체\s*미실시|교체\s*미완료|교체\s*보류|교체\s*취소|교체\s*불가)/i.test(normalized)) return false;

  if (hasExplicitReplacementCompletion(normalized)) return true;
  if (/(?:교체\s*요청|교체요청)\s*건.{0,28}(?:작업\s*)?완료/i.test(normalized)) return true;
  if (/(?:마지막|최근|참고|이력).{0,32}(?:belt|벨트).{0,18}교체/i.test(normalized)) return true;
  if (/(?:belt|벨트)\s*교체\s*$/i.test(normalized)) return true;
  if (/(?:blower|블로워|브로워).{0,24}#?\s*[ABC].{0,20}(?:belt|벨트)\s*교체(?:\s|$)/i.test(normalized)) return true;
  return false;
}

function v12SwitchOperationHasSeparateReplacement(text) {
  const normalized = normalizeText(text);
  if (!/(?:교체운전|교체\s*운전|->|→)/i.test(normalized)) return true;
  const directTargets = v12DirectBeltTargetPositions(normalized);
  if (directTargets.length === 0) return false;
  return /(?:belt|벨트).{0,28}(?:교체\s*(?:완료|실시|시행|작업\s*실시)|교체\s*작업\s*완료)/i.test(normalized);
}

function v12ResolveTargets(record, assets, recognitionAssets = assets) {
  if (fragmentHasIdentityConflict(record, recognitionAssets)) return [];
  const text = normalizeText(record?.sourceText);
  const detectedTags = extractRecognizedBlowerTags(text, recognitionAssets);
  const tagResolution = detectedTags.length > 0
    ? resolveExplicitTagIdentity(text, detectedTags, recognitionAssets)
    : null;
  if (detectedTags.length > 0 && !tagResolution?.consistent) return [];
  const recognizedTags = tagResolution?.tags || [];
  const semanticText = tagResolution?.semanticText || text;
  const manureContext = hasManureBlowerContext(semanticText);
  const targets = new Map();

  for (const tag of recognizedTags) {
    const asset = assets.find(item => normalizeText(item.tag_number).toUpperCase() === tag);
    if (asset && (!manureContext || assetGroupKey(asset) === 'manure')) {
      targets.set(asset.tag_number, asset);
    }
  }

  const types = v12DetectTypes(semanticText);
  let units = v12DetectUnits(semanticText, record?.role);
  let positions = v12DirectBeltTargetPositions(semanticText);
  if (positions.length === 0) positions = v12ExpandPositionRange(semanticText);

  const unresolvedExplicitTag = detectedTags.some(tag => !targets.has(tag));

  if (
    recognizedTags.length > 0 &&
    targets.size > 0 &&
    !unresolvedExplicitTag &&
    positions.length > 1
  ) {
    const existing = [...targets.values()][0];
    const oneType = new Set([...targets.values()].map(item => item.blower_type));
    const oneUnit = new Set([...targets.values()].map(item => item.unit_no));
    const oneGroup = new Set([...targets.values()].map(item => assetGroupKey(item)));
    if (oneType.size === 1 && oneUnit.size === 1 && oneGroup.size === 1) {
      for (const asset of assets) {
        if (asset.blower_type === existing.blower_type && asset.unit_no === existing.unit_no && positions.includes(asset.position_label)) {
          if (assetGroupKey(asset) !== assetGroupKey(existing)) continue;
          if (!targets.has(asset.tag_number) && !managedAssetAllowsContextualMatch(asset, record?.workDate)) continue;
          targets.set(asset.tag_number, asset);
        }
      }
    }
  }

  if (detectedTags.length > 0) {
    return [...targets.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }

  if (targets.size === 0) {
    if (types.length !== 1 || positions.length === 0) return [];
    const type = types[0];
    if (type === 'flyash_silo') units = ['shared'];
    if (units.length === 0) return [];
    const explicitMultiUnit = units.length > 1;
    if (explicitMultiUnit && !/(?:#\s*)?1\s*[,/&+·]\s*(?:#\s*)?2|양\s*호기|1\s*,\s*2\s*호기/i.test(text)) return [];

    for (const asset of assets) {
      if (!managedAssetAllowsContextualMatch(asset, record?.workDate)) continue;
      if (asset.blower_type !== type) continue;
      const requiredGroup = type === 'organic_fuel' && manureContext ? 'manure' : '';
      if (assetGroupKey(asset) !== requiredGroup) continue;
      if (!units.includes(asset.unit_no)) continue;
      if (!positions.includes(asset.position_label)) continue;
      targets.set(asset.tag_number, asset);
    }
  }

  return [...targets.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function v12InferDate(year, month, day, workDate) {
  const work = /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(workDate)) ? normalizeText(workDate) : '';
  if (!work) return '';
  let resolvedYear = Number(year || work.slice(0, 4));
  if (resolvedYear < 100) resolvedYear += 2000;
  const mm = Number(month), dd = Number(day);
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return '';
  let date = `${String(resolvedYear).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  if (!year && date > work) {
    resolvedYear -= 1;
    date = `${resolvedYear}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) return '';
  return date;
}

function v12ExtractDateTokens(text, workDate) {
  const normalized = normalizeText(text);
  const dates = [];
  const seen = new Set();
  const push = date => { if (date && !seen.has(date)) { seen.add(date); dates.push(date); } };
  for (const match of normalized.matchAll(/(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    push(v12InferDate(match[1], match[2], match[3], workDate));
  }
  for (const match of normalized.matchAll(/\b(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/g)) {
    push(v12InferDate(match[1], match[2], match[3], workDate));
  }
  for (const match of normalized.matchAll(/(?<!\d)(\d{1,2})\s*[/\-]\s*(\d{1,2})(?!\d|\s*[:])/g)) {
    push(v12InferDate('', match[1], match[2], workDate));
  }
  return dates;
}

function v12PositionSpecificDates(text, workDate) {
  const normalized = normalizeText(text);
  const output = new Map();
  const tokenPattern = '((?:\\d{2,4}\\s*년\\s*)?\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일|20\\d{2}[.\\-/]\\d{1,2}[.\\-/]\\d{1,2}|\\d{1,2}\\s*[/\\-]\\s*\\d{1,2})';
  const pattern = new RegExp(`#\\s*([ABC])[^#\\n]{0,12}?${tokenPattern}[^#\\n]{0,28}?(?:V\\s*[-/]?\\s*Belt|V-Belt|Belt|벨트)[^#\\n]{0,20}?교체`, 'ig');
  for (const match of normalized.matchAll(pattern)) {
    const tokenDates = v12ExtractDateTokens(match[2], workDate);
    if (tokenDates[0]) output.set(`#${match[1].toUpperCase()}`, tokenDates[0]);
  }
  return output;
}

function v12EventsForRecord(record, targets) {
  const workDate = normalizeText(record?.workDate).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return [];
  const text = normalizeText(record?.sourceText);
  const byPosition = v12PositionSpecificDates(text, workDate);
  const explicitDates = v12ExtractDateTokens(text, workDate);
  const events = [];

  if (targets.length === 1 && explicitDates.length > 0) {
    for (const date of explicitDates) events.push({ target: targets[0], date });
    return events;
  }

  if (explicitDates.length === 1) {
    for (const target of targets) events.push({ target, date: explicitDates[0] });
    return events;
  }

  if (byPosition.size > 0) {
    for (const target of targets) {
      const date = byPosition.get(target.position_label);
      if (date) events.push({ target, date });
    }
    if (events.length > 0) return events;
  }

  if (explicitDates.length === 1) {
    for (const target of targets) events.push({ target, date: explicitDates[0] });
    return events;
  }

  for (const target of targets) events.push({ target, date: workDate });
  return events;
}

function v12EvaluateAuditRecord(record, assets) {
  return v13EvaluateAuditRecord(record, assets);
}

async function v12LoadSourcePage(database, source, cursorRowId) {
  if (source === 'shift_logs') {
    const result = await database.prepare(`
      SELECT rowid AS audit_rowid, id, work_date, shift, role, author, status, log_json
      FROM shift_logs
      WHERE rowid > ? AND work_date >= ? AND work_date <= ? AND status = '결재완료'
      ORDER BY rowid ASC LIMIT ?
    `).bind(cursorRowId, HISTORY_BACKFILL_START_DATE, HISTORY_RECOVERY_V12_CUTOFF_DATE, HISTORY_RECOVERY_V12_SHIFT_SCAN_BATCH).all();
    const loaded = Array.isArray(result.results) ? result.results : [];
    const rows = loaded.filter(historicalAuditRowMayContainBelt);
    return {
      rows,
      scannedRows: loaded.length,
      cursorRowId: loaded.length ? Number(loaded[loaded.length - 1].audit_rowid) : cursorRowId,
      complete: loaded.length < HISTORY_RECOVERY_V12_SHIFT_SCAN_BATCH
    };
  }

  // legacy_logs는 큰 JSON 컬럼과 상태/날짜 조건을 함께 걸면 D1에서 첫 페이지가 오래 걸릴 수 있다.
  // rowid 범위만 사용해 항상 작은 연속 블록을 읽고, 날짜/승인/Belt 필터는 JS에서 수행한다.
  const result = await database.prepare(`
    SELECT
      rowid AS audit_rowid,
      id,
      legacy_diary_id,
      work_date,
      shift,
      role,
      author,
      status,
      entries_json,
      original_json
    FROM legacy_logs
    WHERE rowid > ?
    ORDER BY rowid ASC
    LIMIT ?
  `).bind(cursorRowId, HISTORY_RECOVERY_V12_LEGACY_SCAN_BATCH).all();
  const loaded = Array.isArray(result.results) ? result.results : [];
  const eligible = loaded.filter(row => {
    const workDate = normalizeText(row?.work_date).slice(0, 10);
    const status = normalizeText(row?.status).toUpperCase();
    const approved = status === '결재완료' || status === 'APPROVED';
    return approved
      && workDate >= HISTORY_BACKFILL_START_DATE
      && workDate <= HISTORY_RECOVERY_V12_CUTOFF_DATE;
  });
  const rows = eligible.filter(historicalAuditRowMayContainBelt);
  return {
    rows,
    scannedRows: loaded.length,
    cursorRowId: loaded.length ? Number(loaded[loaded.length - 1].audit_rowid) : cursorRowId,
    complete: loaded.length < HISTORY_RECOVERY_V12_LEGACY_SCAN_BATCH
  };
}

async function v12InsertAuditRecord(database, record, evaluation, now) {
  const tags = evaluation.events.map(item => item.target.tag_number);
  const dates = evaluation.events.map(item => item.date);
  const inserted = await database.prepare(`
    INSERT OR IGNORE INTO blower_history_recovery_v12_audit (
      record_key, category, source_table, source_row_id, source_log_id, work_date,
      source_role, source_author, source_text, resolved_tags, resolved_dates, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `${record.sourceTable}:${record.key}`,
    evaluation.category,
    normalizeText(record.sourceTable),
    Number(record.sourceRowId || 0),
    normalizeText(record.sourceLogId),
    normalizeText(record.workDate).slice(0,10),
    normalizeDutyPosition(record.role),
    normalizeText(record.author),
    normalizeText(record.sourceText).slice(0,2000),
    JSON.stringify(tags),
    JSON.stringify(dates),
    evaluation.reason,
    now
  ).run();
  return Number(inserted?.meta?.changes || 0) > 0;
}

async function v12StageEvent(database, record, item, reason, now) {
  const tag = normalizeText(item.target.tag_number).toUpperCase();
  const date = normalizeText(item.date).slice(0,10);
  const eventKey = `${tag}|${date}`;
  const existing = await database.prepare(`SELECT source_role FROM blower_history_recovery_v12_stage WHERE event_key = ? LIMIT 1`).bind(eventKey).first();
  if (!existing) {
    await database.prepare(`
      INSERT INTO blower_history_recovery_v12_stage (
        event_key, tag_number, event_date, source_table, source_row_id, source_log_id,
        source_role, source_author, source_text, decision_reason, support_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(
      eventKey, tag, `${date}T00:00:00+09:00`, normalizeText(record.sourceTable), Number(record.sourceRowId || 0),
      normalizeText(record.sourceLogId), normalizeDutyPosition(record.role), normalizeText(record.author),
      normalizeText(record.v13EvidenceText || record.sourceText).slice(0,2000), reason, now, now
    ).run();
    return;
  }
  const replaceEvidence = v12RolePriority(record.role) > v12RolePriority(existing.source_role);
  await database.prepare(`
    UPDATE blower_history_recovery_v12_stage
    SET support_count = support_count + 1,
        source_table = CASE WHEN ? THEN ? ELSE source_table END,
        source_row_id = CASE WHEN ? THEN ? ELSE source_row_id END,
        source_log_id = CASE WHEN ? THEN ? ELSE source_log_id END,
        source_role = CASE WHEN ? THEN ? ELSE source_role END,
        source_author = CASE WHEN ? THEN ? ELSE source_author END,
        source_text = CASE WHEN ? THEN ? ELSE source_text END,
        updated_at = ?
    WHERE event_key = ?
  `).bind(
    replaceEvidence ? 1 : 0, normalizeText(record.sourceTable),
    replaceEvidence ? 1 : 0, Number(record.sourceRowId || 0),
    replaceEvidence ? 1 : 0, normalizeText(record.sourceLogId),
    replaceEvidence ? 1 : 0, normalizeDutyPosition(record.role),
    replaceEvidence ? 1 : 0, normalizeText(record.author),
    replaceEvidence ? 1 : 0, normalizeText(record.v13EvidenceText || record.sourceText).slice(0,2000),
    now, eventKey
  ).run();
}

async function v12RefreshCounts(database) {
  const [staged, review, unmatched] = await Promise.all([
    database.prepare(`SELECT COUNT(*) AS count FROM blower_history_recovery_v12_stage`).first(),
    database.prepare(`SELECT COUNT(*) AS count FROM blower_history_recovery_v12_audit WHERE category = 'review'`).first(),
    database.prepare(`SELECT COUNT(*) AS count FROM blower_history_recovery_v12_audit WHERE category IN ('unmatched','excluded')`).first()
  ]);
  return { staged: Number(staged?.count || 0), review: Number(review?.count || 0), unmatched: Number(unmatched?.count || 0) };
}

async function v12LoadState(database) {
  const row = await database.prepare(`SELECT * FROM blower_history_recovery_v12_state WHERE id = ? LIMIT 1`).bind(HISTORY_RECOVERY_V12_ID).first();
  if (!row) return null;
  return {
    id: row.id, version: row.version, status: row.status, sourceTable: row.source_table,
    cursorRowId: Number(row.cursor_row_id || 0), scannedRows: Number(row.scanned_rows || 0),
    stagedEvents: Number(row.staged_events || 0), reviewRecords: Number(row.review_records || 0),
    unmatchedRecords: Number(row.unmatched_records || 0), expectedEvents: Number(row.expected_events || 0),
    startedAt: normalizeText(row.started_at), completedAt: normalizeText(row.completed_at),
    message: normalizeText(row.message), updatedAt: normalizeText(row.updated_at)
  };
}

async function v12ClaimLock(database) {
  const now = new Date();
  const nowIso = now.toISOString();
  const token = crypto.randomUUID();
  const expires = new Date(now.getTime() + HISTORY_RECOVERY_V12_LEASE_MS).toISOString();
  const staleBefore = new Date(now.getTime() - HISTORY_RECOVERY_V12_LOCK_STALE_MS).toISOString();
  const claim = await database.prepare(`
    UPDATE blower_history_recovery_v12_state SET lock_token = ?, lock_expires_at = ?, updated_at = ?
    WHERE id = ? AND (
      lock_token = ''
      OR lock_expires_at = ''
      OR lock_expires_at < ?
      OR updated_at < ?
    )
  `).bind(token, expires, nowIso, HISTORY_RECOVERY_V12_ID, nowIso, staleBefore).run();
  return Number(claim?.meta?.changes || 0) > 0 ? { token, nowIso } : null;
}

async function v12ReleaseLock(database, token) {
  await database.prepare(`UPDATE blower_history_recovery_v12_state SET lock_token = '', lock_expires_at = '' WHERE id = ? AND lock_token = ?`).bind(HISTORY_RECOVERY_V12_ID, token).run();
}

async function v12ApplyConfirmedEvents(database) {
  const activeStage = await database.prepare(`
    SELECT COUNT(*) AS count
    FROM blower_history_recovery_v12_stage AS stage
    WHERE EXISTS (
      SELECT 1 FROM blower_history_assets AS asset
      WHERE asset.tag_number = stage.tag_number AND asset.enabled = 1
    )
  `).first();
  const activeStagedEvents = Number(activeStage?.count || 0);
  if (activeStagedEvents <= 0) {
    return { ok: false, blocked: true, message: 'V13에서 확정된 V-Belt 교체 이력이 없어 실제 이력은 변경하지 않았습니다.' };
  }
  const now = new Date().toISOString();
  const today = formatKstDate(new Date());
  const applyResults = await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_asset_archive_v12 (
        migration_id, tag_number, blower_type, unit_no, position_label, display_name, sort_order,
        enabled, last_replacement_at,
        cycle_started_at, cycle_start_state, cycle_start_revision,
        cycle_runtime_hours, cycle_runtime_anchor_at, cycle_runtime_state, cycle_runtime_revision,
        runtime_hours, runtime_anchor_at, is_running,
        last_modified_by_id, last_modified_by_name, created_at, updated_at, archived_at
      ) SELECT ?, tag_number, blower_type, unit_no, position_label, display_name, sort_order,
        enabled, last_replacement_at,
        cycle_started_at, cycle_start_state, cycle_start_revision,
        cycle_runtime_hours, cycle_runtime_anchor_at, cycle_runtime_state, cycle_runtime_revision,
        runtime_hours, runtime_anchor_at, is_running,
        last_modified_by_id, last_modified_by_name, created_at, updated_at, ?
        FROM blower_history_assets
        WHERE EXISTS (
          SELECT 1
          FROM blower_history_recovery_v12_stage AS stage
          JOIN blower_history_assets AS active_asset
            ON active_asset.tag_number = stage.tag_number
          WHERE active_asset.enabled = 1
        )
    `).bind(HISTORY_RECOVERY_V12_ID, now),
    database.prepare(`
      UPDATE blower_history_asset_archive_v12 AS snapshot
      SET
        cycle_started_at = (
          SELECT asset.cycle_started_at
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = snapshot.tag_number
        ),
        cycle_start_state = COALESCE((
          SELECT asset.cycle_start_state
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = snapshot.tag_number
        ), 'legacy'),
        cycle_start_revision = COALESCE((
          SELECT asset.cycle_start_revision
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = snapshot.tag_number
        ), ''),
        cycle_runtime_hours = (
          SELECT asset.cycle_runtime_hours
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = snapshot.tag_number
        ),
        cycle_runtime_anchor_at = (
          SELECT asset.cycle_runtime_anchor_at
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = snapshot.tag_number
        ),
        cycle_runtime_state = COALESCE((
          SELECT asset.cycle_runtime_state
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = snapshot.tag_number
        ), ''),
        cycle_runtime_revision = COALESCE((
          SELECT asset.cycle_runtime_revision
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = snapshot.tag_number
        ), '')
      WHERE snapshot.migration_id = ?
        AND COALESCE(snapshot.cycle_runtime_revision, '') = ''
        AND EXISTS (
          SELECT 1
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = snapshot.tag_number
        )
    `).bind(HISTORY_RECOVERY_V12_ID),
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_event_archive (
        migration_id, id, tag_number, event_type, event_date, runtime_hours, issue_type, action_type,
        note, source_type, source_log_id, source_text, created_by_id, created_by_name, created_at, updated_at, archived_at
      ) SELECT ?, id, tag_number, event_type, event_date, runtime_hours, issue_type, action_type,
        note, source_type, source_log_id, source_text, created_by_id, created_by_name, created_at, updated_at, ?
        FROM blower_history_events
        WHERE event_type = 'replacement' AND source_type IN ('shift_log_auto','shift_log_history_auto','shift_log_history_v12','shift_log_history_v13')
          AND EXISTS (
            SELECT 1
            FROM blower_history_recovery_v12_stage AS stage
            JOIN blower_history_assets AS active_asset
              ON active_asset.tag_number = stage.tag_number
            WHERE active_asset.enabled = 1
          )
    `).bind(HISTORY_RECOVERY_V12_ID, now),
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_candidate_archive (
        migration_id, id, source_fingerprint, tag_number, detected_type, detected_date, issue_type, action_type,
        source_log_id, source_shift, source_role, source_author, source_text, status, reviewed_by_id,
        reviewed_by_name, reviewed_at, created_at, archived_at
      ) SELECT ?, id, source_fingerprint, tag_number, detected_type, detected_date, issue_type, action_type,
        source_log_id, source_shift, source_role, source_author, source_text, status, reviewed_by_id,
        reviewed_by_name, reviewed_at, created_at, ?
        FROM blower_history_candidates
        WHERE detected_type = 'replacement'
          AND ((status = 'auto_confirmed' AND reviewed_by_id = 'history_auto') OR (status = 'pending' AND COALESCE(reviewed_by_id,'') = ''))
          AND EXISTS (
            SELECT 1
            FROM blower_history_recovery_v12_stage AS stage
            JOIN blower_history_assets AS active_asset
              ON active_asset.tag_number = stage.tag_number
            WHERE active_asset.enabled = 1
          )
    `).bind(HISTORY_RECOVERY_V12_ID, now),
    database.prepare(`
      DELETE FROM blower_history_candidates
      WHERE detected_type = 'replacement'
        AND ((status = 'auto_confirmed' AND reviewed_by_id = 'history_auto') OR (status = 'pending' AND COALESCE(reviewed_by_id,'') = ''))
        AND EXISTS (
          SELECT 1 FROM blower_history_assets AS asset
          WHERE asset.tag_number = blower_history_candidates.tag_number AND asset.enabled = 1
        )
        AND EXISTS (
          SELECT 1
          FROM blower_history_recovery_v12_stage AS stage
          JOIN blower_history_assets AS active_asset
            ON active_asset.tag_number = stage.tag_number
          WHERE active_asset.enabled = 1
        )
    `),
    database.prepare(`
      DELETE FROM blower_history_events
      WHERE event_type = 'replacement' AND source_type IN ('shift_log_auto','shift_log_history_auto','shift_log_history_v12','shift_log_history_v13')
        AND EXISTS (
          SELECT 1 FROM blower_history_assets AS asset
          WHERE asset.tag_number = blower_history_events.tag_number AND asset.enabled = 1
        )
        AND EXISTS (
          SELECT 1
          FROM blower_history_recovery_v12_stage AS stage
          JOIN blower_history_assets AS active_asset
            ON active_asset.tag_number = stage.tag_number
          WHERE active_asset.enabled = 1
        )
    `),
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_events (
        id, tag_number, event_type, event_date, runtime_hours, issue_type, action_type, note,
        source_type, source_log_id, source_text, created_by_id, created_by_name, created_at, updated_at
      ) SELECT 'v13:' || event_key, tag_number, 'replacement', event_date, 0, '정기주기', 'V-Belt 교체',
        'V13 업무일지 문맥 복구', 'shift_log_history_v13', source_log_id, source_text,
        'history_v13', '업무일지 V13 문맥복구', ?, ?
        FROM blower_history_recovery_v12_stage
        WHERE EXISTS (
          SELECT 1 FROM blower_history_assets AS asset
          WHERE asset.tag_number = blower_history_recovery_v12_stage.tag_number AND asset.enabled = 1
        )
    `).bind(now, now),
    database.prepare(`
      UPDATE blower_history_assets AS asset
      SET
        last_replacement_at = (
          SELECT event.event_date FROM blower_history_events event
          WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement'
          ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1
        ),
        runtime_hours = CASE
          WHEN EXISTS (
            SELECT 1 FROM blower_history_events correction
            WHERE correction.tag_number = asset.tag_number AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'9999-12-31')
          ) THEN COALESCE((SELECT snap.runtime_hours FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number), asset.runtime_hours)
          WHEN (SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1) IS NULL
            THEN COALESCE((SELECT snap.runtime_hours FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number), asset.runtime_hours)
          WHEN COALESCE((SELECT snap.last_replacement_at FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number),'') = COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'')
            THEN COALESCE((SELECT snap.runtime_hours FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number), asset.runtime_hours)
          ELSE 0 END,
        runtime_anchor_at = CASE
          WHEN EXISTS (
            SELECT 1 FROM blower_history_events correction
            WHERE correction.tag_number = asset.tag_number AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'9999-12-31')
          ) THEN (SELECT snap.runtime_anchor_at FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number)
          WHEN COALESCE((SELECT snap.last_replacement_at FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number),'') = COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'')
            THEN (SELECT snap.runtime_anchor_at FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number)
          WHEN COALESCE((SELECT snap.is_running FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number), asset.is_running) = 1
            THEN (SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1)
          ELSE NULL END,
        is_running = COALESCE((SELECT snap.is_running FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number), asset.is_running),
        last_modified_by_id = CASE
          WHEN EXISTS (
            SELECT 1 FROM blower_history_events correction
            WHERE correction.tag_number = asset.tag_number AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'9999-12-31')
          ) OR COALESCE((SELECT snap.last_replacement_at FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number),'') = COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'')
          THEN COALESCE((SELECT snap.last_modified_by_id FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number), asset.last_modified_by_id)
          ELSE 'history_v13' END,
        last_modified_by_name = CASE
          WHEN EXISTS (
            SELECT 1 FROM blower_history_events correction
            WHERE correction.tag_number = asset.tag_number AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'9999-12-31')
          ) OR COALESCE((SELECT snap.last_replacement_at FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number),'') = COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'')
          THEN COALESCE((SELECT snap.last_modified_by_name FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number), asset.last_modified_by_name)
          ELSE '업무일지 V13 문맥복구' END,
        updated_at = ?
      WHERE asset.enabled = 1
        AND EXISTS (SELECT 1 FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number)
        AND EXISTS (
          SELECT 1
          FROM blower_history_recovery_v12_stage AS stage
          JOIN blower_history_assets AS active_asset
            ON active_asset.tag_number = stage.tag_number
          WHERE active_asset.enabled = 1
      )
    `).bind(
      HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID,
      HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID,
      HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID,
      HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID,
      now, HISTORY_RECOVERY_V12_ID
    ),
    database.prepare(`
      WITH archived_cycle AS (
        SELECT *
        FROM blower_history_asset_archive_v12
        WHERE migration_id = ?
      ),
      cycle_context AS (
        SELECT
          asset.tag_number,
          asset.last_replacement_at AS recovered_last_replacement_at,
          asset.runtime_hours AS recovered_runtime_hours,
          asset.runtime_anchor_at AS recovered_runtime_anchor_at,
          asset.is_running AS recovered_is_running,
          snapshot.last_replacement_at AS archived_last_replacement_at,
          snapshot.cycle_started_at AS archived_cycle_started_at,
          snapshot.cycle_start_state AS archived_cycle_start_state,
          snapshot.cycle_start_revision AS archived_cycle_start_revision,
          snapshot.cycle_runtime_hours AS archived_cycle_runtime_hours,
          snapshot.cycle_runtime_anchor_at AS archived_cycle_runtime_anchor_at,
          snapshot.cycle_runtime_state AS archived_cycle_runtime_state,
          snapshot.cycle_runtime_revision AS archived_cycle_runtime_revision,
          CASE
            WHEN snapshot.last_replacement_at IS NULL
              AND asset.last_replacement_at IS NULL
              THEN 1
            WHEN JULIANDAY(snapshot.last_replacement_at) IS NOT NULL
              AND JULIANDAY(asset.last_replacement_at) IS NOT NULL
              AND ABS(
                JULIANDAY(snapshot.last_replacement_at)
                - JULIANDAY(asset.last_replacement_at)
              ) < 0.000000001
              THEN 1
            ELSE 0
          END AS same_latest_replacement,
          CASE WHEN EXISTS (
            SELECT 1
            FROM blower_history_events AS correction
            WHERE correction.tag_number = asset.tag_number
              AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND JULIANDAY(correction.event_date) >= JULIANDAY(asset.last_replacement_at)
          ) THEN 1 ELSE 0 END AS has_current_cycle_correction,
          asset.last_replacement_at AS reinitialized_cycle_anchor_at
        FROM blower_history_assets AS asset
        INNER JOIN archived_cycle AS snapshot
          ON snapshot.tag_number = asset.tag_number
        WHERE asset.enabled = 1
      )
      UPDATE blower_history_assets AS asset
      SET
        cycle_started_at = CASE
          WHEN (SELECT context.same_latest_replacement FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
            THEN (SELECT context.archived_cycle_started_at FROM cycle_context AS context WHERE context.tag_number = asset.tag_number)
          ELSE NULL
        END,
        cycle_start_state = CASE
          WHEN (SELECT context.same_latest_replacement FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
            THEN COALESCE(NULLIF((SELECT context.archived_cycle_start_state FROM cycle_context AS context WHERE context.tag_number = asset.tag_number), ''), 'legacy')
          ELSE 'legacy'
        END,
        cycle_start_revision = CASE
          WHEN (SELECT context.same_latest_replacement FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
            THEN (SELECT context.archived_cycle_start_revision FROM cycle_context AS context WHERE context.tag_number = asset.tag_number)
          ELSE LOWER(HEX(RANDOMBLOB(16)))
        END,
        cycle_runtime_hours = CASE
          WHEN (SELECT context.same_latest_replacement FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
            THEN (SELECT context.archived_cycle_runtime_hours FROM cycle_context AS context WHERE context.tag_number = asset.tag_number)
          WHEN (SELECT context.recovered_last_replacement_at FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) IS NULL
            THEN 0
          WHEN (SELECT context.has_current_cycle_correction FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
            THEN COALESCE(
              (SELECT context.archived_cycle_runtime_hours FROM cycle_context AS context WHERE context.tag_number = asset.tag_number),
              (SELECT context.recovered_runtime_hours FROM cycle_context AS context WHERE context.tag_number = asset.tag_number),
              0
            )
          ELSE 0
        END,
        cycle_runtime_anchor_at = CASE
          WHEN (SELECT context.same_latest_replacement FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
            THEN (SELECT context.archived_cycle_runtime_anchor_at FROM cycle_context AS context WHERE context.tag_number = asset.tag_number)
          WHEN (SELECT context.recovered_last_replacement_at FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) IS NULL
            THEN NULL
          WHEN (SELECT context.has_current_cycle_correction FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
            THEN (SELECT context.archived_cycle_runtime_anchor_at FROM cycle_context AS context WHERE context.tag_number = asset.tag_number)
          ELSE (SELECT context.reinitialized_cycle_anchor_at FROM cycle_context AS context WHERE context.tag_number = asset.tag_number)
        END,
        cycle_runtime_state = CASE
          WHEN (SELECT context.same_latest_replacement FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
            THEN COALESCE(NULLIF((SELECT context.archived_cycle_runtime_state FROM cycle_context AS context WHERE context.tag_number = asset.tag_number), ''), 'stopped')
          WHEN (SELECT context.recovered_last_replacement_at FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) IS NULL
            THEN 'stopped'
          ELSE COALESCE(
            NULLIF((SELECT context.archived_cycle_runtime_state FROM cycle_context AS context WHERE context.tag_number = asset.tag_number), ''),
            CASE
              WHEN (SELECT context.recovered_is_running FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
                THEN 'running'
              ELSE 'stopped'
            END
          )
        END,
        cycle_runtime_revision = CASE
          WHEN (SELECT context.same_latest_replacement FROM cycle_context AS context WHERE context.tag_number = asset.tag_number) = 1
            THEN (SELECT context.archived_cycle_runtime_revision FROM cycle_context AS context WHERE context.tag_number = asset.tag_number)
          ELSE LOWER(HEX(RANDOMBLOB(16)))
        END
      WHERE asset.enabled = 1
        AND EXISTS (
          SELECT 1
          FROM cycle_context AS context
          WHERE context.tag_number = asset.tag_number
        )
        AND EXISTS (
          SELECT 1
          FROM blower_history_recovery_v12_stage AS stage
          JOIN blower_history_assets AS active_asset
            ON active_asset.tag_number = stage.tag_number
          WHERE active_asset.enabled = 1
        )
    `).bind(HISTORY_RECOVERY_V12_ID),
    database.prepare(`
      INSERT INTO blower_history_backfill_state (
        id, target_date, cursor_date, cursor_id, status, scanned_logs, auto_confirmed_events,
        pending_candidates, started_at, completed_at, updated_at
      )
      SELECT ?, ?, ?, '', 'complete', active.count, active.count, 0, ?, ?, ?
      FROM (
        SELECT COUNT(*) AS count
        FROM blower_history_recovery_v12_stage AS stage
        WHERE EXISTS (
          SELECT 1
          FROM blower_history_assets AS asset
          WHERE asset.tag_number = stage.tag_number AND asset.enabled = 1
        )
      ) AS active
      WHERE active.count > 0
      ON CONFLICT(id) DO UPDATE SET
        target_date = excluded.target_date, cursor_date = excluded.cursor_date, cursor_id = '',
        status = 'complete', scanned_logs = excluded.scanned_logs,
        auto_confirmed_events = excluded.auto_confirmed_events,
        pending_candidates = 0, completed_at = excluded.completed_at, updated_at = excluded.updated_at
    `).bind(HISTORY_BACKFILL_ID, today, HISTORY_RECOVERY_V12_CUTOFF_DATE, now, now, now),
    database.prepare(`
      UPDATE blower_history_recovery_v12_state
      SET
        status = 'complete',
        staged_events = (
          SELECT COUNT(*)
          FROM blower_history_recovery_v12_stage AS stage
          WHERE EXISTS (
            SELECT 1
            FROM blower_history_assets AS asset
            WHERE asset.tag_number = stage.tag_number AND asset.enabled = 1
          )
        ),
        completed_at = ?,
        message = 'V13 업무일지 문맥 복구 ' || (
          SELECT COUNT(*)
          FROM blower_history_recovery_v12_stage AS stage
          WHERE EXISTS (
            SELECT 1
            FROM blower_history_assets AS asset
            WHERE asset.tag_number = stage.tag_number AND asset.enabled = 1
          )
        ) || '건 적용 완료',
        updated_at = ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1
          FROM blower_history_recovery_v12_stage AS stage
          JOIN blower_history_assets AS asset
            ON asset.tag_number = stage.tag_number
          WHERE asset.enabled = 1
        )
    `).bind(now, now, HISTORY_RECOVERY_V12_ID)
  ]);
  const recoveryUpdate = applyResults[applyResults.length - 1];
  if (Number(recoveryUpdate?.meta?.changes || 0) === 0) {
    return { ok: false, blocked: true, message: 'V13에서 확정된 V-Belt 교체 이력이 없어 실제 이력은 변경하지 않았습니다.' };
  }
  const appliedState = await v12LoadState(database);
  const appliedEvents = Number(appliedState?.stagedEvents || 0);
  return { ok: true, applied: true, message: `업무일지에서 확정된 V-Belt 교체 이력 ${appliedEvents}건을 V13으로 복구했습니다.` };
}

async function historicalRecoveryV12Step(database) {
  await ensureHistoryRecoveryV12Ready(database);
  let state = await v12LoadState(database);
  if (state?.status === 'complete') return jsonResponse({ ok: true, done: true, applied: true, recovery: state, message: state.message });
  if (state?.status === 'blocked') return jsonResponse({ ok: false, done: true, blocked: true, recovery: state, message: state.message }, 409);
  const lock = await v12ClaimLock(database);
  if (!lock) return jsonResponse({ ok: true, busy: true, done: false, recovery: state, message: '다른 V13 복구 작업이 진행 중입니다.' });

  try {
    state = await v12LoadState(database);
    if (state.status === 'ready') {
      const applied = await v12ApplyConfirmedEvents(database);
      if (!applied.ok) {
        const now = new Date().toISOString();
        await database.prepare(`UPDATE blower_history_recovery_v12_state SET status='blocked', message=?, updated_at=? WHERE id=?`).bind(applied.message, now, HISTORY_RECOVERY_V12_ID).run();
        return jsonResponse({ ...applied, done: true, recovery: await v12LoadState(database) }, 409);
      }
      return jsonResponse({ ...applied, done: true, recovery: await v12LoadState(database) });
    }

    const source = HISTORY_RECOVERY_V12_SOURCE_ORDER.includes(state.sourceTable) ? state.sourceTable : HISTORY_RECOVERY_V12_SOURCE_ORDER[0];
    let page;
    try {
      page = await v12LoadSourcePage(database, source, state.cursorRowId);
    } catch (error) {
      return jsonResponse({ ok: false, retryable: true, code: 'V13_SOURCE_UNAVAILABLE', message: 'V13 업무일지 원문 조회가 일시적으로 실패했습니다. 같은 위치에서 재시도합니다.', detail: error instanceof Error ? error.message : String(error), recovery: state }, 503);
    }

    const stored = await database.prepare(`SELECT * FROM blower_history_assets ORDER BY sort_order, tag_number`).all();
    const recognitionAssets = buildHistoricalAuditAssets(Array.isArray(stored.results) ? stored.results : []);
    const assets = recognitionAssets.filter(asset => Number(asset.enabled) === 1);
    const rawRecords = analyzeHistoricalAuditRows(page.rows, source, assets, recognitionAssets);
    const contextualRecords = v13ContextualizeAuditRecords(rawRecords, recognitionAssets);
    // 문맥 승계 계산은 모든 fragment로 수행하되, D1 write는 실제 V-Belt 교체 후보/제외 후보에만 수행한다.
    // 한 업무일지에 unrelated fragment가 많아도 매 STEP에서 수십~수백 건의 audit INSERT가 발생하지 않게 한다.
    const records = contextualRecords.filter(v13AuditRelevantRecord);
    const now = new Date().toISOString();
    for (const record of records) {
      const evaluation = v13EvaluateAuditRecord(record, assets);
      const inserted = await v12InsertAuditRecord(database, record, evaluation, now);
      if (inserted && evaluation.category === 'confirmed') {
        for (const item of evaluation.events) await v12StageEvent(database, record, item, evaluation.reason, now);
      }
    }

    const sourceIndex = HISTORY_RECOVERY_V12_SOURCE_ORDER.indexOf(source);
    const nextSource = page.complete && sourceIndex + 1 < HISTORY_RECOVERY_V12_SOURCE_ORDER.length
      ? HISTORY_RECOVERY_V12_SOURCE_ORDER[sourceIndex + 1] : source;
    const allDone = page.complete && sourceIndex === HISTORY_RECOVERY_V12_SOURCE_ORDER.length - 1;
    const counts = await v12RefreshCounts(database);
    const nextStatus = allDone ? (counts.staged > 0 ? 'ready' : 'blocked') : 'scanning';
    const message = allDone
      ? (counts.staged > 0
        ? `V13 문맥 검증 완료: 확정 ${counts.staged}건 · 검토 ${counts.review}건 · 미귀속/제외 ${counts.unmatched}건`
        : 'V13에서 확정 가능한 V-Belt 교체 이력이 없어 기존 저장값을 유지합니다.')
      : `V13 업무일지 문맥 확인 중: 확정 ${counts.staged}건`;
    const progressUpdate = await database.prepare(`
      UPDATE blower_history_recovery_v12_state SET status=?, source_table=?, cursor_row_id=?,
        scanned_rows=scanned_rows+?, staged_events=?, review_records=?, unmatched_records=?, message=?, updated_at=?
      WHERE id=? AND lock_token=?
    `).bind(nextStatus, nextSource, page.complete && !allDone ? 0 : page.cursorRowId, page.scannedRows, counts.staged, counts.review, counts.unmatched, message, now, HISTORY_RECOVERY_V12_ID, lock.token).run();
    if (Number(progressUpdate?.meta?.changes || 0) === 0) {
      return jsonResponse({ ok: true, busy: true, done: false, recovery: await v12LoadState(database), message: 'V13 작업 잠금이 갱신되어 현재 단계 결과는 중복 적용하지 않았습니다.' });
    }

    const updated = await v12LoadState(database);
    if (nextStatus === 'blocked') return jsonResponse({ ok: false, done: true, blocked: true, applied: false, recovery: updated, message }, 409);
    return jsonResponse({ ok: true, done: false, ready: nextStatus === 'ready', recovery: updated, message });
  } finally {
    await v12ReleaseLock(database, lock.token);
  }
}

async function resetHistoricalRecoveryV12(database) {
  await ensureHistoryRecoveryV12Ready(database);
  const current = await v12LoadState(database);
  if (current?.status === 'complete') return jsonResponse({ ok: false, message: '이미 적용 완료된 V13은 화면에서 초기화할 수 없습니다.' }, 409);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`DELETE FROM blower_history_recovery_v12_stage`),
    database.prepare(`DELETE FROM blower_history_recovery_v12_audit`),
    database.prepare(`UPDATE blower_history_recovery_v12_state SET status='scanning', source_table='shift_logs', cursor_row_id=0, scanned_rows=0, staged_events=0, review_records=0, unmatched_records=0, lock_token='', lock_expires_at='', started_at=?, completed_at=NULL, message='', updated_at=? WHERE id=?`).bind(now, now, HISTORY_RECOVERY_V12_ID)
  ]);
  return jsonResponse({ ok: true, message: 'V13 문맥검증 상태를 초기화했습니다.', recovery: await v12LoadState(database) });
}

async function exportHistoricalRecoveryV12(database, category) {
  await ensureHistoryRecoveryV12Ready(database);
  const safeCategory = ['confirmed','review','unmatched'].includes(normalizeText(category)) ? normalizeText(category) : 'confirmed';
  let rows;
  if (safeCategory === 'confirmed') {
    const result = await database.prepare(`SELECT * FROM blower_history_recovery_v12_stage ORDER BY event_date, tag_number`).all();
    rows = Array.isArray(result.results) ? result.results : [];
  } else if (safeCategory === 'review') {
    const result = await database.prepare(`SELECT * FROM blower_history_recovery_v12_audit WHERE category='review' ORDER BY work_date, source_row_id`).all();
    rows = Array.isArray(result.results) ? result.results : [];
  } else {
    const result = await database.prepare(`SELECT * FROM blower_history_recovery_v12_audit WHERE category IN ('unmatched','excluded') ORDER BY work_date, source_row_id`).all();
    rows = Array.isArray(result.results) ? result.results : [];
  }
  return jsonResponse({ ok: true, version: HISTORY_RECOVERY_V12_VERSION, category: safeCategory, expectedConfirmed: HISTORY_RECOVERY_V12_EXPECTED_EVENTS, recovery: await v12LoadState(database), records: rows });
}

async function handlePost(context, user, body) {
  const action = normalizeText(body.action);
  const database = context.env.DB;

  if (isMobileMonitoringRequest(context)) {
    return jsonResponse({
      ok: false,
      message: "모바일에서는 Blower 현황과 이력만 조회할 수 있습니다."
    }, 403);
  }

  if (action === "settings") {
    return updateSettings(database, user, body);
  }

  if (action === "asset_save") {
    if (!user.isSuperAdmin) {
      return jsonResponse({ ok: false, message: "Blower 추가·수정은 최고관리자만 할 수 있습니다." }, 403);
    }
    return saveAsset(database, user, body);
  }

  if (action === "replacement") {
    return registerReplacement(database, user, body);
  }

  if (action === "startup") {
    return registerStartup(database, user, body);
  }

  if (action === "problem") {
    return registerProblem(database, user, body);
  }

  if (action === "runtime") {
    return correctRuntime(database, user, body);
  }

  if (action === "runtime_state") {
    return changeRuntimeState(database, user, body);
  }

  if (action === "runtime_event_edit") {
    return editLatestRuntimeBoundary(database, user, body);
  }

  if (action === "historical_backfill_step") {
    return jsonResponse({
      ok: false,
      code: "LEGACY_BACKFILL_DISABLED_V12",
      message: "기존 [과거 이력 재구성]은 차단되었습니다. [업무일지 이력 복구 V13]을 사용해 주세요."
    }, 409);
  }

  if (action === "historical_recovery_v12_step") {
    if (!user.isSuperAdmin) {
      return jsonResponse({ ok: false, message: "V13 업무일지 이력 복구는 최고관리자만 실행할 수 있습니다." }, 403);
    }
    return historicalRecoveryV12Step(database);
  }

  if (action === "historical_recovery_v12_reset") {
    if (!user.isSuperAdmin) {
      return jsonResponse({ ok: false, message: "V13 초기화는 최고관리자만 실행할 수 있습니다." }, 403);
    }
    return resetHistoricalRecoveryV12(database);
  }

  if (action === "historical_recovery_v12_export") {
    if (!user.isSuperAdmin) {
      return jsonResponse({ ok: false, message: "V13 감사자료는 최고관리자만 내려받을 수 있습니다." }, 403);
    }
    return exportHistoricalRecoveryV12(database, body.category);
  }

  if (action === "historical_audit_step") {
    if (!user.isSuperAdmin) {
      return jsonResponse(
        { ok: false, message: "누락 이력 진단은 최고관리자만 실행할 수 있습니다." },
        403
      );
    }

    return historicalAuditStep(database, body);
  }

  if (action === "operation_sync") {
    return syncOperationChanges(database, user, body);
  }

  if (action === "scan") {
    return scanShiftLogs(database, user, body);
  }

  if (action === "candidate_review") {
    return reviewCandidate(database, user, body);
  }

  return jsonResponse({ ok: false, message: "지원하지 않는 요청입니다." }, 400);
}

export async function onRequestGet(context) {
  try {
    const authentication = await getAuthenticatedUser(
      context,
      { optional: true }
    );

    if (authentication.error) {
      return authentication.error;
    }

    if (authentication.user) {
      await ensureBlowerHistorySchemaReady(context.env.DB);
    }
    return await handleGet(context, authentication.user);
  } catch (error) {
    console.error("Blower 교체 이력 조회 오류:", error);
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Blower 교체 이력 조회 중 오류가 발생했습니다."
      },
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    const authentication = await getAuthenticatedUser(context);

    if (authentication.error) {
      return authentication.error;
    }

    let body = {};

    try {
      body = await context.request.json();
    } catch {
      return jsonResponse({ ok: false, message: "요청 내용을 읽을 수 없습니다." }, 400);
    }

    const action = normalizeText(body?.action);

    if (action !== "historical_audit_step") {
      await ensureBlowerHistorySchemaReady(context.env.DB);
    }

    return await handlePost(context, authentication.user, body);
  } catch (error) {
    console.error("Blower 교체 이력 저장 오류:", error);
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Blower 교체 이력 저장 중 오류가 발생했습니다."
      },
      500
    );
  }
}

/* Node 회귀 테스트에서 V13 복구와 Cycle 상태 경계를 실제 SQLite로 검증한다. */
export const __blowerHistoryTest = {
  ensureSchema,
  ensureHistoryRecoveryV12Schema,
  v12ApplyConfirmedEvents,
  operationPositionFromToken,
  operationChangeoverPair,
  operationSwitchTargetPosition,
  hasCompletedOperationChangeover,
  detectOperationChangeover,
  findFbheVibrationCluster,
  buildFbheVibrationTransitions,
  matchFbheVibrationTransitionsToEvents,
  manualFbheVibrationStateAt,
  buildFbheVibrationAssetShadow
};
