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
const HISTORY_RECOVERY_V12_VERSION = "blower_vbelt_confirmed_recovery_v12_r2";
const HISTORY_RECOVERY_V12_CUTOFF_DATE = "2026-08-26";
const HISTORY_RECOVERY_V12_EXPECTED_EVENTS = 76;
const HISTORY_RECOVERY_V12_SOURCE_ORDER = ["shift_logs", "legacy_logs"];
const HISTORY_RECOVERY_V12_SHIFT_SCAN_BATCH = 40;
const HISTORY_RECOVERY_V12_LEGACY_SCAN_BATCH = 40;
const HISTORY_RECOVERY_V12_LEASE_MS = 30 * 1000;
const HISTORY_RECOVERY_V12_LOCK_STALE_MS = 35 * 1000;

const HISTORY_RECOVERY_V12_R2_AUDITED_RULES = Object.freeze([
  { sourceTable: "legacy_logs", sourceRowId: 4858, textIncludes: "FBHE Blower #A V-Belt 교체 완료", category: "confirmed", reason: "V12.2 감사보정: #B는 교체운전 대상이며 실제 V-Belt 교체는 #A", events: [["104HHL60AP611", "2024-02-06"]] },
  { sourceTable: "legacy_logs", sourceRowId: 7186, textIncludes: "V-Belt 교체 문의", category: "excluded", reason: "V12.2 감사보정: 교체 문의 문장" },
  { sourceTable: "legacy_logs", sourceRowId: 17441, textIncludes: "V-Belt 교체 및 점검요청", category: "excluded", reason: "V12.2 감사보정: 교체·점검 요청 문장" },
  { sourceTable: "legacy_logs", sourceRowId: 37600, textIncludes: "Belt 교체 및 점검 예정", category: "excluded", reason: "V12.2 감사보정: 교체 예정 문장" },
  { sourceTable: "legacy_logs", sourceRowId: 38159, textIncludes: "교체 하려했지만 미실시", category: "excluded", reason: "V12.2 감사보정: V-Belt 교체 미실시" },

  { sourceTable: "legacy_logs", sourceRowId: 3963, textIncludes: "Fly Ash Aeration Blower #A, #B Belt 교체 실시", category: "confirmed", reason: "V12.2 감사보정: Fly Ash Bag Filter Aeration 역사 명칭", events: [["204ETG30AN601", "2023-10-04"], ["204ETG30AN602", "2023-10-04"]] },
  { sourceTable: "legacy_logs", sourceRowId: 4277, textIncludes: "Bag Filter Fly Ash Aeration Blower #A V-Belt 교체 완료", category: "confirmed", reason: "V12.2 감사보정: Fly Ash Bag Filter Aeration 역사 명칭", events: [["104ETG30AN601", "2023-11-27"]] },
  { sourceTable: "legacy_logs", sourceRowId: 5118, textIncludes: "Bag Filter Fly Ash Aeration Blower #A Belt 교체", category: "confirmed", reason: "V12.2 감사보정: Fly Ash Bag Filter Aeration 역사 명칭", events: [["204ETG30AN601", "2024-03-05"]] },
  { sourceTable: "legacy_logs", sourceRowId: 35747, textIncludes: "FBHE Blower #A V-Belt 1가닥", category: "confirmed", reason: "V12.2 감사보정: 끊어짐 확인 후 교체완료", events: [["104HHL60AP611", "2024-04-22"]] },
  { sourceTable: "legacy_logs", sourceRowId: 36022, textIncludes: "Fly Ash Aeration Blower #A, B V-Belt 교체 완료", category: "confirmed", reason: "V12.2 감사보정: Fly Ash Bag Filter Aeration 역사 명칭", events: [["104ETG30AN601", "2024-07-27"], ["104ETG30AN602", "2024-07-27"]] },
  { sourceTable: "legacy_logs", sourceRowId: 16825, textIncludes: "FBHE Blower #B V-belt 교체", category: "confirmed", reason: "V12.2 감사보정: V-Belt와 타 부품이 함께 교체된 완료 문장", events: [["204HHL60AP621", "2024-10-17"]] },
  { sourceTable: "legacy_logs", sourceRowId: 7423, textIncludes: "Fly Ash Aeration Blower #B V-Belt 교체 완료", category: "confirmed", reason: "V12.2 감사보정: Fly Ash Bag Filter Aeration 역사 명칭", events: [["104ETG30AN602", "2024-12-02"]] },
  { sourceTable: "legacy_logs", sourceRowId: 36412, textIncludes: "BagFilter Aeration Blower #B V-Belt 교체완료", category: "confirmed", reason: "V12.2 감사보정: Bag Filter Aeration 역사 명칭", events: [["204ETG30AN602", "2024-12-23"]] },
  { sourceTable: "legacy_logs", sourceRowId: 10092, textIncludes: "유기성 고형연료 Blower 1-A Belt 교체 후 정상 기동 실시", category: "confirmed", reason: "V12.2 감사보정: 1-A 위치 표기 인식", events: [["104SDF01AN001", "2025-12-19"]] },
  { sourceTable: "legacy_logs", sourceRowId: 10135, textIncludes: "Fly Ash Aeration Blower #A Belt 교체", category: "confirmed", reason: "V12.2 감사보정: Fly Ash Bag Filter Aeration 역사 명칭", events: [["204ETG30AN601", "2025-12-22"]] },
  { sourceTable: "legacy_logs", sourceRowId: 20928, textIncludes: "Bag Filter Fly Ash Aeration Blower #B V-Belt 교체 완료", category: "confirmed", reason: "V12.2 감사보정: Fly Ash Bag Filter Aeration 역사 명칭", events: [["104ETG30AN602", "2025-12-26"]] },
  { sourceTable: "legacy_logs", sourceRowId: 1783, textIncludes: "FBHE Blower #A V-Belt 교체", category: "confirmed", reason: "V12.2 감사보정: V-Belt 교체와 Base 보강 동시 작업", events: [["104HHL60AP611", "2026-02-12"]] },
  { sourceTable: "legacy_logs", sourceRowId: 21489, textIncludes: "FBHE Blower #C V-Belt 및 Suction Filter 교체 완료", category: "confirmed", reason: "V12.2 감사보정: V-Belt와 Suction Filter 동시 교체 완료", events: [["204HHL60AP631", "2026-02-25"]] },
  { sourceTable: "legacy_logs", sourceRowId: 21489, textIncludes: "Seal Pot Blower #C V-Belt 및 Suction Filter 교체 완료", category: "confirmed", reason: "V12.2 감사보정: V-Belt와 Suction Filter 동시 교체 완료", events: [["204HHL10AN631", "2026-02-25"]] }
]);
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

async function getAuthenticatedUser(context) {
  const database = context?.env?.DB;

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
    await database
      .prepare(`
        DELETE FROM shift_log_sessions
        WHERE token_hash = ?
      `)
      .bind(tokenHash)
      .run();

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
        position_label TEXT NOT NULL,
        display_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_replacement_at TEXT,
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

function buildAssetState(asset, setting, latestProblem, latestReference, now = new Date()) {
  const runtimeHours = currentRuntimeHours(asset, now);
  const cycleElapsedHours = cycleElapsedHoursSince(asset.last_replacement_at, now);
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

  if (cycleElapsedHours === null) {
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
    positionLabel: asset.position_label,
    displayName: asset.display_name,
    sortOrder: Number(asset.sort_order || 0),
    lastReplacementAt: normalizeText(asset.last_replacement_at),
    runtimeHours,
    isRunning: Number(asset.is_running) === 1,
    cycleElapsedHours,
    remainingHours,
    progressPct,
    severity,
    latestProblem: latestProblem || null,
    latestReference: latestReference || null,
    referenceElapsedHours
  };
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
    // V12 테이블은 최초 실행 전에는 아직 없을 수 있습니다.
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

  return missingSlots;
}

async function buildFullData(database, user) {
  const settings = await loadSettings(database);
  const assets = await loadAssetStates(database, settings);
  const events = await loadEvents(database, 10000);
  const candidates = await loadCandidates(database, "pending", 300);
  const settingHistory = await loadSettingHistory(database, 60);
  const backfill = await loadBackfillState(database);
  const recoveryV12 = await loadRecoveryV12StateForUi(database);

  return {
    ok: true,
    user,
    types: TYPE_DEFINITIONS,
    settings,
    assets,
    events,
    candidates,
    settingHistory,
    backfill,
    recoveryV12,
    missingTags: buildMissingTagSummary(assets),
    missingSlots: buildMissingSlotDetails(assets),
    generatedAt: new Date().toISOString()
  };
}

function buildSummaryFromAssets(assets) {
  const severityRank = {
    overdue: 4,
    critical: 3,
    warning: 2,
    unset: 1,
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

async function handleGet(context, user) {
  const database = context.env.DB;
  const url = new URL(context.request.url);
  const action = normalizeText(url.searchParams.get("action")) || "data";

  const settings = await loadSettings(database);
  const assets = await loadAssetStates(database, settings);

  if (action === "summary") {
    return jsonResponse({
      ok: true,
      ...buildSummaryFromAssets(assets),
      generatedAt: new Date().toISOString()
    });
  }

  if (action === "events") {
    return jsonResponse({
      ok: true,
      events: await loadEvents(database, Number(url.searchParams.get("limit")) || 500)
    });
  }

  if (action === "candidates") {
    return jsonResponse({
      ok: true,
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
  if (!user.isAdmin) {
    return jsonResponse(
      {
        ok: false,
        message: "교체주기 설정은 관리자만 변경할 수 있습니다."
      },
      403
    );
  }

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

  const beforeRuntime = runtimeHoursAt(asset, eventDate);
  const issueType = normalizeText(body.issueType) || "정기주기";
  const actionType = normalizeText(body.actionType) || "교체";
  const note = normalizeText(body.note);
  const shouldRun = typeof body.isRunning === "boolean"
    ? body.isRunning
    : Number(asset.is_running) === 1;

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

  const currentReplacement = asset.last_replacement_at
    ? new Date(asset.last_replacement_at)
    : null;

  const shouldUpdateCurrentState =
    !currentReplacement ||
    Number.isNaN(currentReplacement.getTime()) ||
    eventDateValue >= currentReplacement;

  if (shouldUpdateCurrentState) {
    const now = new Date().toISOString();

    await database
      .prepare(`
        UPDATE blower_history_assets
        SET
          last_replacement_at = ?,
          runtime_hours = 0,
          runtime_anchor_at = ?,
          is_running = ?,
          last_modified_by_id = ?,
          last_modified_by_name = ?,
          updated_at = ?
        WHERE tag_number = ?
      `)
      .bind(
        eventDate,
        shouldRun ? eventDate : null,
        shouldRun ? 1 : 0,
        user.employeeNo,
        user.name,
        now,
        tagNumber
      )
      .run();
  }

  return jsonResponse({
    ok: true,
    message: shouldUpdateCurrentState
      ? "교체 이력을 등록하고 새 Cycle을 시작했습니다."
      : "과거 교체 이력을 등록했습니다. 현재 Cycle은 변경하지 않았습니다."
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

  const runtimeHours = runtimeHoursAt(asset, eventDate);
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

async function correctRuntime(database, user, body) {
  const tagNumber = normalizeText(body.tagNumber).toUpperCase();
  const asset = await findAsset(database, tagNumber);

  if (!asset) {
    return jsonResponse({ ok: false, message: "등록된 Blower TAG를 찾을 수 없습니다." }, 404);
  }

  const runtimeHours = Number(body.runtimeHours);

  if (!Number.isFinite(runtimeHours) || runtimeHours < 0 || runtimeHours > 200000) {
    return jsonResponse({ ok: false, message: "누적 운전시간을 확인해 주세요." }, 400);
  }

  const isRunning = body.isRunning === true;
  const now = new Date().toISOString();

  await database
    .prepare(`
      UPDATE blower_history_assets
      SET
        runtime_hours = ?,
        runtime_anchor_at = ?,
        is_running = ?,
        last_modified_by_id = ?,
        last_modified_by_name = ?,
        updated_at = ?
      WHERE tag_number = ?
    `)
    .bind(
      runtimeHours,
      isRunning ? now : null,
      isRunning ? 1 : 0,
      user.employeeNo,
      user.name,
      now,
      tagNumber
    )
    .run();

  await insertEvent(database, user, {
    tagNumber,
    eventType: "runtime_correction",
    eventDate: now,
    runtimeHours,
    issueType: "",
    actionType: isRunning ? "운전중" : "정지",
    note: normalizeText(body.note),
    sourceType: "manual"
  });

  return jsonResponse({
    ok: true,
    message: "누적 운전시간과 운전상태를 보정했습니다."
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

function fragmentStableKey(fragment) {
  return [
    compactEquipmentText(fragmentIdentityText(fragment)),
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

function collectCanonicalShiftLogFragments(parsedLog, row) {
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
      const structuredTags = extractRecognizedBlowerTags(
        entry.tag || entry.tagNumber || entry.equipmentTag || ""
      );
      const contentTags = extractRecognizedBlowerTags(content);
      const entryContentTag = contentTags.length === 1 ? contentTags[0] : "";
      const structuredUnitRaw = normalizeText(entry.unitNo || entry.unit || "");
      const structuredUnit = /^[12]$/.test(structuredUnitRaw)
        ? structuredUnitRaw
        : detectUnitNo(structuredUnitRaw);
      const sourceRole = normalizeDutyPosition(entry.importedFromRole || row?.role);
      const roleUnit = DUTY_ROLE_UNIT[sourceRole] || "";
      const entryTypes = detectBlowerTypes(content);
      const entryType = entryTypes.length === 1 ? entryTypes[0] : "";
      const entryUnits = detectUnitNos(content);
      const entryUnit = entryUnits.length === 1 ? entryUnits[0] : "";
      const entryPositions = detectPositionLabels(content);
      const entryPosition = entryPositions.length === 1 ? entryPositions[0] : "";

      for (const clause of splitCanonicalEntryClauses(content)) {
        const inlineTime = normalizeCanonicalEntryTime(clause);
        const evidence = clause;
        const explicitTags = extractRecognizedBlowerTags(evidence);
        const explicitUnits = detectUnitNos(evidence);
        const explicitTypes = detectBlowerTypes(evidence);
        const explicitPositions = detectPositionLabels(evidence);
        const inheritedContentTag = (
          structuredTags.length === 0 &&
          explicitTags.length === 0 &&
          entryContentTag
        )
          ? entryContentTag
          : "";
        const identityTags = structuredTags.length > 0
          ? structuredTags
          : (inheritedContentTag ? [inheritedContentTag] : []);
        const trustedUnit = identityTags.length > 0 || explicitUnits.length > 0
          ? ""
          : (structuredUnit || entryUnit || roleUnit);
        const trustedType = identityTags.length > 0 || explicitTypes.length > 0
          ? ""
          : entryType;
        const trustedPosition = identityTags.length > 0 || explicitPositions.length > 0
          ? ""
          : entryPosition;
        const identityText = [
          identityTags.join(" "),
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
          sourceRole
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

function parseShiftLogFragments(row) {
  let parsed;

  try {
    parsed = JSON.parse(row?.log_json || "{}");
  } catch {
    return [];
  }

  if (!isApprovedShiftLogRow(row, parsed)) {
    return [];
  }

  return collectCanonicalShiftLogFragments(parsed, row);
}

function isBlowerScanRelevantFragment(text) {
  const normalized = fragmentAnalysisText(text);
  if (!normalized) return false;

  return (
    extractRecognizedBlowerTags(normalized).length > 0 ||
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


function hasSetOverlap(left, right) {
  const rightSet = new Set(right);
  return left.some(item => rightSet.has(item));
}

function duplicateIdentityCompatible(left, right) {
  const leftText = fragmentAnalysisText(left);
  const rightText = fragmentAnalysisText(right);
  const leftTags = extractRecognizedBlowerTags(leftText);
  const rightTags = extractRecognizedBlowerTags(rightText);

  if (leftTags.length > 0 && rightTags.length > 0 && !hasSetOverlap(leftTags, rightTags)) {
    return false;
  }

  const leftTypes = detectBlowerTypes(leftText);
  const rightTypes = detectBlowerTypes(rightText);

  if (leftTypes.length > 0 && rightTypes.length > 0 && !hasSetOverlap(leftTypes, rightTypes)) {
    return false;
  }

  const leftUnits = detectUnitNos(leftText);
  const rightUnits = detectUnitNos(rightText);

  if (leftUnits.length > 0 && rightUnits.length > 0 && !hasSetOverlap(leftUnits, rightUnits)) {
    return false;
  }

  const leftPositions = detectPositionLabels(leftText);
  const rightPositions = detectPositionLabels(rightText);

  if (leftPositions.length > 0 && rightPositions.length > 0 && !hasSetOverlap(leftPositions, rightPositions)) {
    return false;
  }

  return true;
}

function buildRolePriorityContext(rows) {
  const context = new Map();

  for (const row of rows || []) {
    const fragments = parseShiftLogFragments(row)
      .filter(isBlowerScanRelevantFragment);

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

function applyDutyRolePriority(row, fragments, rolePriorityContext) {
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

    if (!isBlowerScanRelevantFragment(fragment)) {
      retained.push(fragment);
      continue;
    }

    const duplicated = higherFragments.length > 0 && higherFragments.some(higherFragment =>
      duplicateIdentityCompatible(fragment, higherFragment) &&
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

function extractRecognizedBlowerTags(text) {
  const compact = compactEquipmentText(text);
  const pattern = /(?:104|204)HHL60AP(?:611|621|631)|(?:104|204)HHL10AN(?:611|621|631)|(?:104|204)SDF01AN(?:001|002)|(?:104|204)ETG30AN(?:601|602)|104ETH03AN(?:601|602)/g;
  const found = new Set(compact.match(pattern) || []);
  const groupedSource = normalizeText(text)
    .toUpperCase()
    .replace(/[\s[\](){}_\-]+/g, "");
  const groupedFamilies = [
    { prefix: "(?:104|204)HHL60AP", suffix: "(?:611|621|631)" },
    { prefix: "(?:104|204)HHL10AN", suffix: "(?:611|621|631)" },
    { prefix: "(?:104|204)SDF01AN", suffix: "(?:001|002)" },
    { prefix: "(?:104|204)ETG30AN", suffix: "(?:601|602)" },
    { prefix: "104ETH03AN", suffix: "(?:601|602)" }
  ];

  for (const family of groupedFamilies) {
    const groupPattern = new RegExp(
      `(${family.prefix})(${family.suffix})((?:[/,&+·](?:${family.prefix})?${family.suffix})+)`,
      "g"
    );

    for (const groupMatch of groupedSource.matchAll(groupPattern)) {
      const basePrefix = groupMatch[1];
      const firstTag = `${basePrefix}${groupMatch[2]}`;
      if (classifyRecognizedBlowerTag(firstTag)) found.add(firstTag);

      const tailPattern = new RegExp(
        `[/,&+·](${family.prefix})?(${family.suffix})`,
        "g"
      );
      for (const tailMatch of groupMatch[3].matchAll(tailPattern)) {
        const tagNumber = `${tailMatch[1] || basePrefix}${tailMatch[2]}`;
        if (classifyRecognizedBlowerTag(tagNumber)) found.add(tagNumber);
      }
    }
  }

  return [...found];
}

async function ensureDiscoveredAssets(database, text, assets) {
  const known = new Set(assets.map(asset => normalizeText(asset.tag_number).toUpperCase()));
  const now = new Date().toISOString();

  for (const tagNumber of extractRecognizedBlowerTags(text)) {
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
      .prepare(`SELECT * FROM blower_history_assets WHERE tag_number = ? LIMIT 1`)
      .bind(definition.tagNumber)
      .first();

    if (inserted) {
      assets.push(inserted);
      known.add(definition.tagNumber);
    }
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

function detectPositionLabels(text) {
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

  for (const [suffix, position] of [
    ["AP611", "#A"], ["AP621", "#B"], ["AP631", "#C"],
    ["AN611", "#A"], ["AN621", "#B"], ["AN631", "#C"],
    ["AN001", "#A"], ["AN002", "#B"],
    ["AN601", "#A"], ["AN602", "#B"]
  ]) {
    if (normalized.includes(suffix)) found.add(position);
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

  return matches;
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

function hasDirectTagBeltReplacement(text) {
  const normalized = normalizeText(text);
  if (extractRecognizedBlowerTags(normalized).length === 0) return false;
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

function hasActualBlowerBeltReplacementSignal(text) {
  for (const clause of splitSemanticClauses(text)) {
    if (!hasBeltWord(clause)) continue;
    if (!hasReplacementKeyword(clause)) continue;
    if (!hasBeltReplacementPhrase(clause)) continue;
    if (hasBeltAccessoryReplacementPhrase(clause)) continue;
    if (!hasExplicitReplacementCompletion(clause)) continue;
    if (hasReplacementPlanContext(clause)) continue;
    if (hasReplacementExclusionContext(clause)) continue;

    if (hasDirectTagBeltReplacement(clause)) return true;
    if (hasContextualBlowerBeltReplacement(clause)) return true;
  }

  return false;
}

function hasComponentReplacementContext(text) {
  if (hasActualBlowerBeltReplacementSignal(text)) return false;
  return splitSemanticClauses(text).some(componentReplacementPhrase);
}

function findAssetMatches(fragment, assets) {
  const sourceText = fragmentSourceText(fragment);
  const structuredTags = extractRecognizedBlowerTags(fragmentIdentityText(fragment));
  const analysisText = fragmentAnalysisText(fragment);
  const compact = compactEquipmentText(analysisText);
  const unitNos = detectUnitNos(analysisText);
  const positions = detectPositionLabels(analysisText);
  const typeMatches = detectBlowerTypes(analysisText);
  const explicitUnitNos = detectUnitNos(sourceText);
  const explicitPositions = detectPositionLabels(sourceText);
  const explicitTypeMatches = detectBlowerTypes(sourceText);
  const exact = [];

  for (const asset of assets) {
    const tag = normalizeText(asset.tag_number).toUpperCase();
    const compactTag = compactEquipmentText(tag);

    const conflictsWithContent = (
      (explicitTypeMatches.length > 0 && !explicitTypeMatches.includes(asset.blower_type)) ||
      (asset.unit_no !== "shared" && explicitUnitNos.length > 0 && !explicitUnitNos.includes(asset.unit_no)) ||
      (explicitPositions.length > 0 && !explicitPositions.includes(asset.position_label))
    );

    if (compactTag && compact.includes(compactTag) && !conflictsWithContent) {
      exact.push({ asset, strong: true, reason: "full_tag" });
    }
  }

  if (exact.length > 0) {
    const exactPositionsAreExplicit = exact.every(match =>
      explicitPositions.includes(match.asset.position_label)
    );
    const groupIdentityIsConsistent = (
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
      const exactTags = new Set(exact.map(match => match.asset.tag_number));

      for (const asset of assets) {
        if (asset.blower_type !== blowerType || asset.unit_no !== unitNo) continue;
        if (!explicitPositions.includes(asset.position_label)) continue;
        if (exactTags.has(asset.tag_number)) continue;
        exact.push({ asset, strong: true, reason: "structured_tag_group_position" });
        exactTags.add(asset.tag_number);
      }
    }

    return exact;
  }

  if (structuredTags.length > 0) {
    return [];
  }

  const contextual = [];

  for (const asset of assets) {
    if (typeMatches.length !== 1 || !typeMatches.includes(asset.blower_type)) {
      continue;
    }

    if (asset.unit_no !== "shared") {
      if (unitNos.length !== 1 || unitNos[0] !== asset.unit_no) continue;
    }

    const tag = normalizeText(asset.tag_number).toUpperCase();
    const suffix = compactEquipmentText(tag.slice(3));
    const shortToken = compactEquipmentText(tag.slice(-5));
    const suffixMatched = suffix && compact.includes(suffix);
    const shortMatched = shortToken && compact.includes(shortToken);
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

function detectedEventSpecs(fragment) {
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

  const autoEligible = hasActualBlowerBeltReplacementSignal(analysisText);

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

async function processHistoricalLog(database, row, assets, fragmentsOverride = null) {
  const sourceFragments = Array.isArray(fragmentsOverride)
    ? fragmentsOverride
    : parseShiftLogFragments(row);
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

    const matches = findAssetMatches(fragment, assets);
    const specs = detectedEventSpecs(fragment);
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
      WHERE EXISTS (
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
    `),
    database.prepare(`
      DELETE FROM blower_history_events
      WHERE source_type IN ('shift_log_auto', 'shift_log_history_auto')
    `),
    database.prepare(`
      DELETE FROM blower_history_references
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
      WHERE enabled = 1
      ORDER BY sort_order ASC, tag_number ASC
    `)
    .all();
  const assets = Array.isArray(assetResult.results) ? assetResult.results : [];
  const upperRoleRows = await loadUpperRoleRowsForDates(database, logs);
  const rolePriorityContext = buildRolePriorityContext([
    ...logs,
    ...upperRoleRows
  ]);
  let autoEvents = 0;
  let pending = 0;
  let excludedPartLeaderLogs = 0;
  let suppressedDuplicateFragments = 0;

  for (const row of logs) {
    const fragments = parseShiftLogFragments(row);
    const prioritized = applyDutyRolePriority(row, fragments, rolePriorityContext);

    if (prioritized.excludedPartLeader) {
      excludedPartLeaderLogs += 1;
      continue;
    }

    suppressedDuplicateFragments += prioritized.suppressedDuplicateFragments;

    const processed = await processHistoricalLog(
      database,
      row,
      assets,
      prioritized.fragments
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
      WHERE enabled = 1
      ORDER BY sort_order ASC, tag_number ASC
    `)
    .all();
  const assets = Array.isArray(assetResult.results) ? assetResult.results : [];
  const upperRoleRows = await loadUpperRoleRowsForDates(database, logs);
  const rolePriorityContext = buildRolePriorityContext([
    ...logs,
    ...upperRoleRows
  ]);
  let detectedCount = 0;
  let insertedCount = 0;
  let excludedPartLeaderLogs = 0;
  let suppressedDuplicateFragments = 0;

  for (const row of logs) {
    const rawFragments = parseShiftLogFragments(row);
    const prioritized = applyDutyRolePriority(row, rawFragments, rolePriorityContext);

    if (prioritized.excludedPartLeader) {
      excludedPartLeaderLogs += 1;
      continue;
    }

    suppressedDuplicateFragments += prioritized.suppressedDuplicateFragments;
    const fragments = prioritized.fragments;
    const seen = new Set();

    for (const fragment of fragments) {
      await ensureDiscoveredAssets(database, fragmentAnalysisText(fragment), assets);
      const specs = detectedEventSpecs(fragment);
      if (specs.length === 0) continue;

      const matches = findAssetMatches(fragment, assets);
      if (matches.length === 0) continue;

      for (const spec of specs) {
        const resolved = spec.autoEligible
          ? resolveHistoricalMatches(fragment, matches, spec)
          : (matches.length === 1 || isGroupedContextReference(fragment, matches) ? matches : []);

        for (const match of resolved) {
          const key = `${row.id}::${match.asset.tag_number}::${spec.detectedType}`;
          if (seen.has(key)) continue;
          seen.add(key);
          detectedCount += 1;

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
            "pending"
          );

          if (detection.inserted) insertedCount += 1;
        }
      }
    }
  }

  return jsonResponse({
    ok: true,
    message:
      `업무일지 ${logs.length}건 확인 · 파트장 ${excludedPartLeaderLogs}건 제외 · ` +
      `70% 이상 중복 하위보직 구절 ${suppressedDuplicateFragments}건은 상위보직 기준 처리`,
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

  if (typeof body.isRunning === "boolean") {
    mergedBody.isRunning = body.isRunning;
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

function auditIdentityFromObject(value, inheritedIdentity, fallbackRole) {
  const tagText = [
    value?.tag,
    value?.tagNumber,
    value?.equipmentTag,
    value?.tag_number
  ].filter(Boolean).join(" ");
  const tags = extractRecognizedBlowerTags(tagText);
  const labelText = [
    value?.equipmentName,
    value?.equipment,
    value?.title,
    value?.name,
    value?.category
  ].filter(Boolean).join(" ");
  const types = detectBlowerTypes(labelText);
  const positions = detectPositionLabels(labelText);
  const explicitUnits = detectUnitNos(labelText);
  const sourceRole = normalizeDutyPosition(
    value?.importedFromRole || value?.sourceRole || fallbackRole
  );
  const roleUnit = DUTY_ROLE_UNIT[sourceRole] || "";

  return [
    inheritedIdentity,
    tags.join(" "),
    types.length === 1 ? TYPE_IDENTITY_LABELS[types[0]] : "",
    explicitUnits.length === 1
      ? `#${explicitUnits[0]} BLR`
      : (roleUnit ? `#${roleUnit} BLR` : ""),
    positions.length === 1 ? positions[0] : ""
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
      sourceRole
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

function historicalAuditReasons(fragment, matches, resolvedMatches) {
  const analysisText = fragmentAnalysisText(fragment);
  const reasons = [];
  const tags = extractRecognizedBlowerTags(analysisText);
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

function analyzeHistoricalAuditFragment(fragment, row, sourceTable, auditAssets) {
  const sourceText = fragmentSourceText(fragment);
  if (!hasBeltWord(sourceText) || !hasReplacementKeyword(sourceText)) return null;

  const specs = detectedEventSpecs(fragment);
  const matches = findAssetMatches(fragment, auditAssets);
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
    classification,
    detectedTags: extractRecognizedBlowerTags(analysisText),
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
    reasons: historicalAuditReasons(fragment, matches, resolved)
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

function analyzeHistoricalAuditRows(rows, sourceTable, auditAssets) {
  const records = [];

  for (const row of rows || []) {
    let fragments;

    if (sourceTable === "shift_logs") {
      fragments = parseShiftLogFragments(row);
    } else if (sourceTable === "legacy_logs") {
      fragments = collectUnknownHistoricalAuditFragments(row, {
        sourceField: "legacy_row",
        role: row?.role
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
      const record = analyzeHistoricalAuditFragment(fragment, row, sourceTable, auditAssets);
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
        WHERE enabled = 1
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
  const auditAssets = buildHistoricalAuditAssets(storedAssets);
  const records = analyzeHistoricalAuditRows(rows, cursor.source, auditAssets);
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
        expected_events INTEGER NOT NULL DEFAULT 76,
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
            message = 'V12.2 감사자료 교차검토 기준으로 사전검증을 다시 시작합니다.',
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
  // 현재 V12.2 state가 이미 존재하면 단일 SELECT만 수행하고 바로 진행한다.
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


function v12AuditedOverride(record, assets) {
  const sourceTable = normalizeText(record?.sourceTable);
  const sourceRowId = Number(record?.sourceRowId || 0);
  const sourceText = normalizeText(record?.sourceText);

  const rule = HISTORY_RECOVERY_V12_R2_AUDITED_RULES.find(item => (
    item.sourceTable === sourceTable &&
    Number(item.sourceRowId) === sourceRowId &&
    sourceText.includes(item.textIncludes)
  ));

  if (!rule) return null;

  if (rule.category !== "confirmed") {
    return { category: rule.category, reason: rule.reason, events: [] };
  }

  const events = [];
  for (const [tagNumber, eventDate] of rule.events || []) {
    const target = assets.find(asset =>
      normalizeText(asset?.tag_number).toUpperCase() ===
      normalizeText(tagNumber).toUpperCase()
    );

    if (!target) {
      return {
        category: "review",
        reason: `V12.2 감사보정 TAG 미등록: ${tagNumber}`,
        events: []
      };
    }

    events.push({ target, date: eventDate });
  }

  return { category: "confirmed", reason: rule.reason, events };
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

function v12ResolveTargets(record, assets) {
  const text = normalizeText(record?.sourceText);
  const recognizedTags = extractRecognizedBlowerTags(text);
  const targets = new Map();

  for (const tag of recognizedTags) {
    const asset = assets.find(item => normalizeText(item.tag_number).toUpperCase() === tag);
    if (asset) targets.set(asset.tag_number, asset);
  }

  const types = v12DetectTypes(text);
  let units = v12DetectUnits(text, record?.role);
  let positions = v12DirectBeltTargetPositions(text);
  if (positions.length === 0) positions = v12ExpandPositionRange(text);

  if (recognizedTags.length > 0 && targets.size > 0 && positions.length > 1) {
    const existing = [...targets.values()][0];
    const oneType = new Set([...targets.values()].map(item => item.blower_type));
    const oneUnit = new Set([...targets.values()].map(item => item.unit_no));
    if (oneType.size === 1 && oneUnit.size === 1) {
      for (const asset of assets) {
        if (asset.blower_type === existing.blower_type && asset.unit_no === existing.unit_no && positions.includes(asset.position_label)) {
          targets.set(asset.tag_number, asset);
        }
      }
    }
  }

  if (targets.size === 0) {
    if (types.length !== 1 || positions.length === 0) return [];
    const type = types[0];
    if (type === 'flyash_silo') units = ['shared'];
    if (units.length === 0) return [];
    const explicitMultiUnit = units.length > 1;
    if (explicitMultiUnit && !/(?:#\s*)?1\s*[,/&+·]\s*(?:#\s*)?2|양\s*호기|1\s*,\s*2\s*호기/i.test(text)) return [];

    for (const asset of assets) {
      if (asset.blower_type !== type) continue;
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
  const text = normalizeText(record?.sourceText);
  if (!text || !hasBeltWord(text) || !hasReplacementKeyword(text)) {
    return { category: 'unmatched', reason: 'V-Belt 교체 문장 아님', events: [] };
  }
  if (normalizeDutyPosition(record?.role) === 'PART_LEADER') {
    return { category: 'review', reason: '파트장 원문은 자동 복구 제외', events: [] };
  }

  const auditedOverride = v12AuditedOverride(record, assets);
  if (auditedOverride) return auditedOverride;

  if (hasCompletedForeignComponentReplacement(text) && !hasDirectCompletedBeltReplacement(text)) {
    return { category: 'excluded', reason: '다른 부품 교체 문장', events: [] };
  }
  if (!v12StrongCompletion(text)) {
    return { category: 'excluded', reason: '교체 완료 근거 불충분/예정·요청 문장', events: [] };
  }
  if (!v12SwitchOperationHasSeparateReplacement(text)) {
    return { category: 'excluded', reason: '교체운전 문맥만 존재', events: [] };
  }

  const targets = v12ResolveTargets(record, assets);
  if (targets.length === 0) {
    return { category: 'unmatched', reason: '설비 TAG/종류/호기/위치 귀속 불명확', events: [] };
  }
  const events = v12EventsForRecord(record, targets);
  if (events.length === 0) {
    return { category: 'review', reason: '교체일 확정 불가', events: [] };
  }
  if (events.some(item => item.date > HISTORY_RECOVERY_V12_CUTOFF_DATE)) {
    return { category: 'review', reason: 'V12 기준일 이후 날짜', events: [] };
  }
  return { category: 'confirmed', reason: 'V12 실제 V-Belt 교체 확정', events };
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
      normalizeText(record.sourceText).slice(0,2000), reason, now, now
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
    replaceEvidence ? 1 : 0, normalizeText(record.sourceText).slice(0,2000),
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
  const counts = await v12RefreshCounts(database);
  if (counts.staged !== HISTORY_RECOVERY_V12_EXPECTED_EVENTS) {
    return { ok: false, blocked: true, message: `확정 복구 건수가 ${counts.staged}건으로 기대값 ${HISTORY_RECOVERY_V12_EXPECTED_EVENTS}건과 달라 실제 이력은 변경하지 않았습니다.` };
  }
  const now = new Date().toISOString();
  const today = formatKstDate(new Date());
  await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_asset_archive_v12 (
        migration_id, tag_number, blower_type, unit_no, position_label, display_name, sort_order,
        enabled, last_replacement_at, runtime_hours, runtime_anchor_at, is_running,
        last_modified_by_id, last_modified_by_name, created_at, updated_at, archived_at
      ) SELECT ?, tag_number, blower_type, unit_no, position_label, display_name, sort_order,
        enabled, last_replacement_at, runtime_hours, runtime_anchor_at, is_running,
        last_modified_by_id, last_modified_by_name, created_at, updated_at, ?
        FROM blower_history_assets
    `).bind(HISTORY_RECOVERY_V12_ID, now),
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_event_archive (
        migration_id, id, tag_number, event_type, event_date, runtime_hours, issue_type, action_type,
        note, source_type, source_log_id, source_text, created_by_id, created_by_name, created_at, updated_at, archived_at
      ) SELECT ?, id, tag_number, event_type, event_date, runtime_hours, issue_type, action_type,
        note, source_type, source_log_id, source_text, created_by_id, created_by_name, created_at, updated_at, ?
        FROM blower_history_events
        WHERE event_type = 'replacement' AND source_type IN ('shift_log_auto','shift_log_history_auto','shift_log_history_v12')
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
    `).bind(HISTORY_RECOVERY_V12_ID, now),
    database.prepare(`
      DELETE FROM blower_history_candidates
      WHERE detected_type = 'replacement'
        AND ((status = 'auto_confirmed' AND reviewed_by_id = 'history_auto') OR (status = 'pending' AND COALESCE(reviewed_by_id,'') = ''))
    `),
    database.prepare(`
      DELETE FROM blower_history_events
      WHERE event_type = 'replacement' AND source_type IN ('shift_log_auto','shift_log_history_auto','shift_log_history_v12')
    `),
    database.prepare(`
      INSERT OR IGNORE INTO blower_history_events (
        id, tag_number, event_type, event_date, runtime_hours, issue_type, action_type, note,
        source_type, source_log_id, source_text, created_by_id, created_by_name, created_at, updated_at
      ) SELECT 'v12:' || event_key, tag_number, 'replacement', event_date, 0, '정기주기', 'V-Belt 교체',
        'V12 확정 복구', 'shift_log_history_v12', source_log_id, source_text,
        'history_v12', '업무일지 V12 확정복구', ?, ?
        FROM blower_history_recovery_v12_stage
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
          ELSE 'history_v12' END,
        last_modified_by_name = CASE
          WHEN EXISTS (
            SELECT 1 FROM blower_history_events correction
            WHERE correction.tag_number = asset.tag_number AND correction.event_type = 'runtime_correction'
              AND correction.source_type = 'manual'
              AND correction.event_date >= COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'9999-12-31')
          ) OR COALESCE((SELECT snap.last_replacement_at FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number),'') = COALESCE((SELECT event.event_date FROM blower_history_events event WHERE event.tag_number = asset.tag_number AND event.event_type = 'replacement' ORDER BY event.event_date DESC, event.created_at DESC LIMIT 1),'')
          THEN COALESCE((SELECT snap.last_modified_by_name FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number), asset.last_modified_by_name)
          ELSE '업무일지 V12 확정복구' END,
        updated_at = ?
      WHERE EXISTS (SELECT 1 FROM blower_history_asset_archive_v12 snap WHERE snap.migration_id = ? AND snap.tag_number = asset.tag_number)
    `).bind(
      HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID,
      HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID,
      HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID,
      HISTORY_RECOVERY_V12_ID, HISTORY_RECOVERY_V12_ID,
      now, HISTORY_RECOVERY_V12_ID
    ),
    database.prepare(`
      INSERT INTO blower_history_backfill_state (
        id, target_date, cursor_date, cursor_id, status, scanned_logs, auto_confirmed_events,
        pending_candidates, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, '', 'complete', ?, ?, 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        target_date = excluded.target_date, cursor_date = excluded.cursor_date, cursor_id = '',
        status = 'complete', scanned_logs = excluded.scanned_logs,
        auto_confirmed_events = excluded.auto_confirmed_events,
        pending_candidates = 0, completed_at = excluded.completed_at, updated_at = excluded.updated_at
    `).bind(HISTORY_BACKFILL_ID, today, HISTORY_RECOVERY_V12_CUTOFF_DATE, counts.staged, counts.staged, now, now, now),
    database.prepare(`
      UPDATE blower_history_recovery_v12_state
      SET status = 'complete', staged_events = ?, completed_at = ?, message = ?, updated_at = ?
      WHERE id = ?
    `).bind(counts.staged, now, `V12 확정 복구 ${counts.staged}건 적용 완료`, now, HISTORY_RECOVERY_V12_ID)
  ]);
  return { ok: true, applied: true, message: `확정된 V-Belt 교체 이력 ${counts.staged}건을 V12로 복구했습니다.` };
}

async function historicalRecoveryV12Step(database) {
  await ensureHistoryRecoveryV12Ready(database);
  let state = await v12LoadState(database);
  if (state?.status === 'complete') return jsonResponse({ ok: true, done: true, applied: true, recovery: state, message: state.message });
  if (state?.status === 'blocked') return jsonResponse({ ok: false, done: true, blocked: true, recovery: state, message: state.message }, 409);
  const lock = await v12ClaimLock(database);
  if (!lock) return jsonResponse({ ok: true, busy: true, done: false, recovery: state, message: '다른 V12 복구 작업이 진행 중입니다.' });

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
      return jsonResponse({ ok: false, retryable: true, code: 'V12_SOURCE_UNAVAILABLE', message: 'V12 원문 조회가 일시적으로 실패했습니다. 같은 위치에서 재시도합니다.', detail: error instanceof Error ? error.message : String(error), recovery: state }, 503);
    }

    const stored = await database.prepare(`SELECT * FROM blower_history_assets WHERE enabled = 1 ORDER BY sort_order, tag_number`).all();
    const assets = buildHistoricalAuditAssets(Array.isArray(stored.results) ? stored.results : []);
    const records = analyzeHistoricalAuditRows(page.rows, source, assets);
    const now = new Date().toISOString();
    for (const record of records) {
      const evaluation = v12EvaluateAuditRecord(record, assets);
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
    const nextStatus = allDone ? (counts.staged === HISTORY_RECOVERY_V12_EXPECTED_EVENTS ? 'ready' : 'blocked') : 'scanning';
    const message = allDone
      ? (counts.staged === HISTORY_RECOVERY_V12_EXPECTED_EVENTS
        ? `사전검증 완료: 확정 ${counts.staged}건 / 기대 ${HISTORY_RECOVERY_V12_EXPECTED_EVENTS}건`
        : `안전 차단: 확정 ${counts.staged}건 / 기대 ${HISTORY_RECOVERY_V12_EXPECTED_EVENTS}건. 기존 저장값은 변경하지 않았습니다.`)
      : `V12 원문 확인 중: 확정 ${counts.staged}건`;
    const progressUpdate = await database.prepare(`
      UPDATE blower_history_recovery_v12_state SET status=?, source_table=?, cursor_row_id=?,
        scanned_rows=scanned_rows+?, staged_events=?, review_records=?, unmatched_records=?, message=?, updated_at=?
      WHERE id=? AND lock_token=?
    `).bind(nextStatus, nextSource, page.complete && !allDone ? 0 : page.cursorRowId, page.scannedRows, counts.staged, counts.review, counts.unmatched, message, now, HISTORY_RECOVERY_V12_ID, lock.token).run();
    if (Number(progressUpdate?.meta?.changes || 0) === 0) {
      return jsonResponse({ ok: true, busy: true, done: false, recovery: await v12LoadState(database), message: 'V12 작업 잠금이 갱신되어 현재 단계 결과는 중복 적용하지 않았습니다.' });
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
  if (current?.status === 'complete') return jsonResponse({ ok: false, message: '이미 적용 완료된 V12는 화면에서 초기화할 수 없습니다.' }, 409);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`DELETE FROM blower_history_recovery_v12_stage`),
    database.prepare(`DELETE FROM blower_history_recovery_v12_audit`),
    database.prepare(`UPDATE blower_history_recovery_v12_state SET status='scanning', source_table='shift_logs', cursor_row_id=0, scanned_rows=0, staged_events=0, review_records=0, unmatched_records=0, lock_token='', lock_expires_at='', started_at=?, completed_at=NULL, message='', updated_at=? WHERE id=?`).bind(now, now, HISTORY_RECOVERY_V12_ID)
  ]);
  return jsonResponse({ ok: true, message: 'V12 사전검증 상태를 초기화했습니다.', recovery: await v12LoadState(database) });
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

  if (action === "settings") {
    return updateSettings(database, user, body);
  }

  if (action === "replacement") {
    return registerReplacement(database, user, body);
  }

  if (action === "problem") {
    return registerProblem(database, user, body);
  }

  if (action === "runtime") {
    return correctRuntime(database, user, body);
  }

  if (action === "historical_backfill_step") {
    return jsonResponse({
      ok: false,
      code: "LEGACY_BACKFILL_DISABLED_V12",
      message: "기존 [과거 이력 재구성]은 V12에서 차단되었습니다. [확정 이력 복구 V12]를 사용해 주세요."
    }, 409);
  }

  if (action === "historical_recovery_v12_step") {
    if (!user.isSuperAdmin) {
      return jsonResponse({ ok: false, message: "V12 확정 복구는 최고관리자만 실행할 수 있습니다." }, 403);
    }
    return historicalRecoveryV12Step(database);
  }

  if (action === "historical_recovery_v12_reset") {
    if (!user.isSuperAdmin) {
      return jsonResponse({ ok: false, message: "V12 초기화는 최고관리자만 실행할 수 있습니다." }, 403);
    }
    return resetHistoricalRecoveryV12(database);
  }

  if (action === "historical_recovery_v12_export") {
    if (!user.isSuperAdmin) {
      return jsonResponse({ ok: false, message: "V12 감사자료는 최고관리자만 내려받을 수 있습니다." }, 403);
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
    const authentication = await getAuthenticatedUser(context);

    if (authentication.error) {
      return authentication.error;
    }

    await ensureSchema(context.env.DB);
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
      await ensureSchema(context.env.DB);
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
