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

  ["104SDF01AN001", "organic_fuel", "1", "#A", "#1 유기성 고형연료 Blower #A", 401],
  ["104SDF01AN002", "organic_fuel", "1", "#B", "#1 유기성 고형연료 Blower #B", 402],

  ["104ETG30AN601", "flyash_bag", "1", "#A", "#1 Fly Ash Bag Filter Aeration Blower #A", 501],
  ["104ETG30AN602", "flyash_bag", "1", "#B", "#1 Fly Ash Bag Filter Aeration Blower #B", 502],

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
  "replacement",
  "replace"
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
  "교체가능"
];

const REPLACEMENT_COMPLETE_KEYWORDS = [
  "교체 완료",
  "교체완료",
  "교체 실시",
  "교체실시",
  "교체 시행",
  "교체시행",
  "교체함",
  "교체하였",
  "신품 교체",
  "신품교체",
  "취외",
  "취부"
];

const COMPONENT_REPLACEMENT_KEYWORDS = [
  "bearing",
  "베어링",
  "belt",
  "벨트",
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

const HISTORY_BACKFILL_ID = "shift_logs_full_v4";
const HISTORY_BACKFILL_START_DATE = "2021-01-01";
const HISTORY_BACKFILL_BATCH_SIZE = 200;

const TYPE_CONTEXT_KEYWORDS = {
  fbhe: ["fbhe", "hhl60"],
  seal_pot: ["seal pot", "sealpot", "hhl10"],
  organic_fuel: ["유기성 고형연료", "유기성고형연료", "organic fuel", "sdf01"],
  flyash_bag: ["fly ash bag filter", "flyash bag filter", "bag filter aeration", "etg30"],
  flyash_silo: ["fly ash silo", "flyash silo", "silo aeration", "eth03"]
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

function buildAssetState(asset, setting, latestProblem, latestReference, now = new Date()) {
  const runtimeHours = currentRuntimeHours(asset, now);
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

  if (!asset.last_replacement_at) {
    severity = latestReference ? "reference" : "uninitialized";
  } else if (!(cycleDays > 0)) {
    severity = "unset";
  } else {
    const cycleHours = cycleDays * 24;
    remainingHours = cycleHours - runtimeHours;
    progressPct = Math.max(0, Math.min(100, (runtimeHours / cycleHours) * 100));

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
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 300));

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
      isCompleteForToday: false
    };
  }

  return {
    id: row.id,
    targetDate: normalizeText(row.target_date),
    cursorDate: normalizeText(row.cursor_date),
    cursorId: normalizeText(row.cursor_id),
    status: normalizeText(row.status) || "idle",
    scannedLogs: Number(row.scanned_logs || 0),
    autoConfirmedEvents: Number(row.auto_confirmed_events || 0),
    pendingCandidates: Number(row.pending_candidates || 0),
    startedAt: normalizeText(row.started_at),
    completedAt: normalizeText(row.completed_at),
    updatedAt: normalizeText(row.updated_at),
    isCompleteForToday:
      normalizeText(row.status) === "complete" && normalizeText(row.target_date) === today
  };
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
  const events = await loadEvents(database, 2000);
  const candidates = await loadCandidates(database, "pending", 300);
  const settingHistory = await loadSettingHistory(database, 60);
  const backfill = await loadBackfillState(database);

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
  const id = crypto.randomUUID();

  await database
    .prepare(`
      INSERT INTO blower_history_events (
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

  return id;
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
  const shouldRun = body.isRunning !== false;

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

function collectObjectTextFragments(value, output = new Set(), depth = 0) {
  if (depth > 12 || value === null || value === undefined) {
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectTextFragments(item, output, depth + 1);
    }
    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  const directValues = [];

  for (const item of Object.values(value)) {
    if (["string", "number", "boolean"].includes(typeof item)) {
      const text = normalizeText(item);
      if (text) directValues.push(text);
    }
  }

  const joined = directValues.join(" | ").trim();

  if (joined.length >= 3 && joined.length <= 3000) {
    output.add(joined);
  }

  for (const item of Object.values(value)) {
    if (item && typeof item === "object") {
      collectObjectTextFragments(item, output, depth + 1);
    }
  }

  return output;
}

function collectLocalScalarValues(value, depth = 0, maxDepth = 2, output = []) {
  if (depth > maxDepth || value === null || value === undefined) return output;
  if (Array.isArray(value)) return output;

  if (["string", "number"].includes(typeof value)) {
    const text = normalizeText(value);
    if (text) output.push(text);
    return output;
  }

  if (typeof value !== "object") return output;

  for (const item of Object.values(value)) {
    if (Array.isArray(item)) continue;
    collectLocalScalarValues(item, depth + 1, maxDepth, output);
  }

  return output;
}

function collectHistoricalFragments(value, output = new Set(), depth = 0) {
  if (depth > 14 || value === null || value === undefined) {
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectHistoricalFragments(item, output, depth + 1);
    }
    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  const directValues = Object.values(value)
    .filter(item => ["string", "number"].includes(typeof item))
    .map(item => normalizeText(item))
    .filter(Boolean);

  const localValues = collectLocalScalarValues(value, 0, 2, []);
  if (localValues.length > directValues.length && localValues.length <= 10) {
    const localJoined = localValues.join(" | ").trim();
    const recognizedTags = extractRecognizedBlowerTags(localJoined);
    const contextualIdentity = detectBlowerTypes(localJoined).length === 1 && detectUnitNo(localJoined) && detectPositionLabel(localJoined);

    if (
      localJoined.length >= 3 &&
      localJoined.length <= 3000 &&
      (recognizedTags.length === 1 || contextualIdentity)
    ) {
      output.add(localJoined);
    }
  }

  for (const text of directValues) {
    if (text.length >= 3 && text.length <= 3000) {
      output.add(text);
    }
  }

  if (directValues.length > 0 && directValues.length <= 6) {
    const joined = directValues.join(" | ").trim();
    if (joined.length >= 3 && joined.length <= 3000) {
      output.add(joined);
    }
  } else if (directValues.length > 6) {
    for (let index = 0; index < directValues.length; index += 1) {
      const start = Math.max(0, index - 2);
      const end = Math.min(directValues.length, index + 3);
      const joined = directValues.slice(start, end).join(" | ").trim();
      if (joined.length >= 3 && joined.length <= 3000) {
        output.add(joined);
      }
    }
  }

  for (const item of Object.values(value)) {
    if (item && typeof item === "object") {
      collectHistoricalFragments(item, output, depth + 1);
    }
  }

  return output;
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
  return [...new Set(compact.match(pattern) || [])];
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

function detectUnitNo(text) {
  const normalized = normalizeText(text);

  if (/(?:#\s*1(?:\b|호)|1\s*호기|UNIT\s*#?\s*1\b)/i.test(normalized)) {
    return "1";
  }

  if (/(?:#\s*2(?:\b|호)|2\s*호기|UNIT\s*#?\s*2\b)/i.test(normalized)) {
    return "2";
  }

  return "";
}

function detectPositionLabel(text) {
  const normalized = normalizeText(text);

  for (const position of ["A", "B", "C"]) {
    const hashPattern = new RegExp(`#\\s*${position}(?:\\b|호|번)`, "i");
    const blowerPattern = new RegExp(`(?:BLOWER|FAN)\\s*#?\\s*${position}\\b`, "i");
    const trailingPattern = new RegExp(`\\b${position}\\s*(?:BLOWER|FAN)\\b`, "i");

    if (hashPattern.test(normalized) || blowerPattern.test(normalized) || trailingPattern.test(normalized)) {
      return `#${position}`;
    }
  }

  return "";
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

function hasReplacementPlanContext(text) {
  const normalized = normalizeText(text).toLowerCase();
  const planned = REPLACEMENT_PLAN_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
  const completed = REPLACEMENT_COMPLETE_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
  return planned && !completed;
}

function hasExplicitWholeBlowerReplacement(text) {
  const normalized = normalizeText(text).toLowerCase();
  const equipment = "(?:blower|fan|블로워|브로워)";
  const position = "(?:\\s*#?\\s*[abc])?";
  const replacement = "(?:교체|replace(?:ment)?|신품(?:으로)?\\s*(?:교체|취부|설치)?)";
  const forward = new RegExp(`${equipment}${position}[\\s:;,_\\-]{0,8}${replacement}`, "i");
  const reverse = new RegExp(`${replacement}[\\s:;,_\\-]{0,8}${equipment}${position}`, "i");
  return forward.test(normalized) || reverse.test(normalized);
}

function hasComponentReplacementContext(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (hasExplicitWholeBlowerReplacement(normalized)) return false;

  return COMPONENT_REPLACEMENT_KEYWORDS.some(keyword => {
    const componentIndex = normalized.indexOf(keyword.toLowerCase());
    if (componentIndex < 0) return false;

    const replacementIndex = normalized.indexOf("교체");
    const replaceIndex = normalized.indexOf("replace");
    const nearest = [replacementIndex, replaceIndex]
      .filter(index => index >= 0)
      .reduce((best, index) => Math.min(best, Math.abs(index - componentIndex)), Infinity);

    return nearest <= 35;
  });
}

function findAssetMatches(fragment, assets) {
  const compact = compactEquipmentText(fragment);
  const unitNo = detectUnitNo(fragment);
  const positionLabel = detectPositionLabel(fragment);
  const typeMatches = detectBlowerTypes(fragment);
  const exact = [];

  for (const asset of assets) {
    const tag = normalizeText(asset.tag_number).toUpperCase();
    const compactTag = compactEquipmentText(tag);

    if (compactTag && compact.includes(compactTag)) {
      exact.push({ asset, strong: true, reason: "full_tag" });
    }
  }

  if (exact.length > 0) {
    return exact;
  }

  const contextual = [];

  for (const asset of assets) {
    if (!typeMatches.includes(asset.blower_type)) {
      continue;
    }

    if (asset.unit_no !== "shared" && unitNo !== asset.unit_no) {
      continue;
    }

    const tag = normalizeText(asset.tag_number).toUpperCase();
    const suffix = compactEquipmentText(tag.slice(3));
    const shortToken = compactEquipmentText(tag.slice(-5));
    const suffixMatched = suffix && compact.includes(suffix);
    const shortMatched = shortToken && compact.includes(shortToken);
    const positionMatched = positionLabel && positionLabel === asset.position_label;

    if (suffixMatched || shortMatched || positionMatched) {
      contextual.push({ asset, strong: true, reason: "type_unit_context" });
    }
  }

  return contextual;
}

async function upsertHistoricalReference(database, row, tagNumber, sourceText, referenceKind = "mention") {
  const referenceDate = normalizeDateTime(row.work_date);
  if (!referenceDate) return;

  const now = new Date().toISOString();

  await database
    .prepare(`
      INSERT INTO blower_history_references (
        tag_number,
        reference_date,
        source_log_id,
        source_text,
        reference_kind,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tag_number) DO UPDATE SET
        reference_date = excluded.reference_date,
        source_log_id = excluded.source_log_id,
        source_text = excluded.source_text,
        reference_kind = excluded.reference_kind,
        updated_at = excluded.updated_at
      WHERE excluded.reference_date >= blower_history_references.reference_date
    `)
    .bind(
      normalizeText(tagNumber).toUpperCase(),
      referenceDate,
      normalizeText(row.id),
      normalizeText(sourceText).slice(0, 2000),
      normalizeText(referenceKind) || "mention",
      now
    )
    .run();
}

function detectedEventSpecs(fragment) {
  const issueType = findIssueType(fragment);
  const replacementDetected = hasReplacementKeyword(fragment);
  const specs = [];

  if (issueType) {
    specs.push({
      detectedType: "problem",
      issueType,
      actionType: "확인",
      autoEligible: true
    });
  }

  if (replacementDetected) {
    specs.push({
      detectedType: "replacement",
      issueType: issueType || "정기주기",
      actionType: "교체",
      autoEligible: !hasReplacementPlanContext(fragment) && !hasComponentReplacementContext(fragment)
    });
  }

  return specs;
}

function resolveHistoricalMatch(fragment, matches, spec) {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0 || !fragment.includes("|")) return null;

  if (spec.detectedType === "replacement" && spec.issueType && spec.issueType !== "정기주기") {
    const problemMatch = resolveHistoricalMatch(fragment, matches, {
      detectedType: "problem",
      issueType: spec.issueType,
      actionType: "확인",
      autoEligible: true
    });
    if (problemMatch) return problemMatch;
  }

  const segments = fragment
    .split("|")
    .map(segment => normalizeText(segment))
    .filter(Boolean);

  const eventIndexes = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segmentSpecs = detectedEventSpecs(segments[index]);
    if (segmentSpecs.some(item => item.detectedType === spec.detectedType && item.autoEligible)) {
      eventIndexes.push(index);
    }
  }

  if (eventIndexes.length === 0) return null;

  const scored = [];
  for (const match of matches) {
    const identityIndexes = [];

    for (let index = 0; index < segments.length; index += 1) {
      if (findAssetMatches(segments[index], [match.asset]).length === 1) {
        identityIndexes.push(index);
      }
    }

    if (identityIndexes.length === 0) continue;

    let distance = Infinity;
    for (const identityIndex of identityIndexes) {
      for (const eventIndex of eventIndexes) {
        distance = Math.min(distance, Math.abs(identityIndex - eventIndex));
      }
    }

    scored.push({ match, distance });
  }

  scored.sort((a, b) => a.distance - b.distance);
  if (scored.length === 0 || scored[0].distance > 2) return null;
  if (scored.length > 1 && scored[0].distance === scored[1].distance) return null;
  return scored[0].match;
}

async function findExistingDetection(database, row, tagNumber, detectedType) {
  const candidate = await database
    .prepare(`
      SELECT *
      FROM blower_history_candidates
      WHERE source_log_id = ?
        AND tag_number = ?
        AND detected_type = ?
      ORDER BY created_at ASC
      LIMIT 1
    `)
    .bind(row.id, tagNumber, detectedType)
    .first();

  if (candidate) {
    return { candidate, event: null };
  }

  const dayText = normalizeText(row.work_date).slice(0, 10);
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

  return { candidate: null, event, dayText };
}

async function findSameDayEvent(database, tagNumber, detectedType, eventDate, issueType) {
  const dateText = normalizeText(eventDate).slice(0, 10);

  if (detectedType === "replacement") {
    return database
      .prepare(`
        SELECT id
        FROM blower_history_events
        WHERE tag_number = ?
          AND event_type = 'replacement'
          AND substr(event_date, 1, 10) = ?
        LIMIT 1
      `)
      .bind(tagNumber, dateText)
      .first();
  }

  return database
    .prepare(`
      SELECT id
      FROM blower_history_events
      WHERE tag_number = ?
        AND event_type = 'problem'
        AND substr(event_date, 1, 10) = ?
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
  const fingerprint = fingerprintText(
    ["v4", row.id, row.work_date, tagNumber, spec.detectedType].join("||")
  );
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
      normalizeDateTime(row.work_date),
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

  await insertEvent(database, systemUser, {
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
    const asset = await findAsset(database, tagNumber);
    const eventValue = new Date(eventDate);
    const currentValue = asset?.last_replacement_at ? new Date(asset.last_replacement_at) : null;
    const shouldUpdateCurrent =
      asset &&
      (!currentValue || Number.isNaN(currentValue.getTime()) || eventValue >= currentValue);

    if (shouldUpdateCurrent) {
      const now = new Date().toISOString();
      await database
        .prepare(`
          UPDATE blower_history_assets
          SET
            last_replacement_at = ?,
            runtime_hours = 0,
            runtime_anchor_at = ?,
            is_running = 1,
            last_modified_by_id = 'history_auto',
            last_modified_by_name = '업무일지 과거 자동반영',
            updated_at = ?
          WHERE tag_number = ?
        `)
        .bind(eventDate, eventDate, now, tagNumber)
        .run();
    }
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

  return { inserted: true, duplicate: false };
}

async function processHistoricalLog(database, row, assets) {
  let parsed;

  try {
    parsed = JSON.parse(row.log_json || "{}");
  } catch {
    return { autoEvents: 0, pending: 0 };
  }

  const fragments = [...new Set([
    ...collectHistoricalFragments(parsed),
    ...collectObjectTextFragments(parsed)
  ])];
  let autoEvents = 0;
  const seen = new Set();

  const rawTags = extractRecognizedBlowerTags(row.log_json || "");
  for (const tagNumber of rawTags) {
    await ensureDiscoveredAssets(database, tagNumber, assets);
    const asset = assets.find(item => normalizeText(item.tag_number).toUpperCase() === tagNumber);
    if (!asset) continue;

    const sourceFragment = fragments.find(fragment => compactEquipmentText(fragment).includes(tagNumber)) || tagNumber;
    await upsertHistoricalReference(database, row, tagNumber, sourceFragment, "exact_tag");
  }

  for (const fragment of fragments) {
    await ensureDiscoveredAssets(database, fragment, assets);

    const matches = findAssetMatches(fragment, assets);
    if (matches.length === 1 && matches[0].strong) {
      await upsertHistoricalReference(
        database,
        row,
        matches[0].asset.tag_number,
        fragment,
        matches[0].reason || "context"
      );
    }

    const specs = detectedEventSpecs(fragment).filter(spec => spec.autoEligible);
    if (specs.length === 0 || matches.length === 0) {
      continue;
    }

    for (const spec of specs) {
      const match = resolveHistoricalMatch(fragment, matches, spec);
      if (!match || !match.strong) continue;

      const eventKey = `${row.id}::${match.asset.tag_number}::${spec.detectedType}`;

      if (seen.has(eventKey)) {
        continue;
      }

      seen.add(eventKey);
      const sourceRow = { ...row, sourceText: fragment };
      const detection = await insertDetectionCandidate(
        database,
        sourceRow,
        match.asset.tag_number,
        spec,
        "auto_confirmed",
        new Date().toISOString()
      );

      if (detection.alreadyEvent) {
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

  return { autoEvents, pending: 0 };
}

async function resetHistoricalAutoDataForV4(database, today) {
  const now = new Date().toISOString();

  await database.batch([
    database.prepare(`
      UPDATE blower_history_assets
      SET
        last_replacement_at = NULL,
        runtime_hours = 0,
        runtime_anchor_at = NULL,
        is_running = 0,
        last_modified_by_id = '',
        last_modified_by_name = '',
        updated_at = ?
      WHERE EXISTS (
        SELECT 1
        FROM blower_history_events AS event
        WHERE event.tag_number = blower_history_assets.tag_number
          AND event.event_type = 'replacement'
          AND event.source_type = 'shift_log_history_auto'
          AND event.created_by_id = 'history_auto'
          AND event.event_date = blower_history_assets.last_replacement_at
      )
    `).bind(now),
    database.prepare(`
      DELETE FROM blower_history_events
      WHERE source_type = 'shift_log_history_auto'
        AND created_by_id = 'history_auto'
    `),
    database.prepare(`
      DELETE FROM blower_history_candidates
      WHERE source_log_id <> ''
        AND substr(detected_date, 1, 10) >= ?
        AND substr(detected_date, 1, 10) <= ?
        AND (reviewed_by_id = 'history_auto' OR status = 'pending')
    `).bind(HISTORY_BACKFILL_START_DATE, today),
    database.prepare(`
      DELETE FROM blower_history_references
    `)
  ]);
}

async function initializeBackfillRun(database, today) {
  let state = await database
    .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
    .bind(HISTORY_BACKFILL_ID)
    .first();
  const now = new Date().toISOString();

  if (!state) {
    await resetHistoricalAutoDataForV4(database, today);

    await database
      .prepare(`
        INSERT INTO blower_history_backfill_state (
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
        VALUES (?, ?, '', '', 'running', 0, 0, 0, ?, NULL, ?)
      `)
      .bind(HISTORY_BACKFILL_ID, today, now, now)
      .run();

    return database
      .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
      .bind(HISTORY_BACKFILL_ID)
      .first();
  }

  if (normalizeText(state.status) === "complete" && normalizeText(state.target_date) === today) {
    return state;
  }

  if (normalizeText(state.target_date) !== today) {
    const resumeDate = normalizeText(state.target_date);

    await database
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
      `)
      .bind(today, resumeDate, now, now, HISTORY_BACKFILL_ID)
      .run();
  } else if (normalizeText(state.status) !== "running") {
    await database
      .prepare(`
        UPDATE blower_history_backfill_state
        SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = ?
      `)
      .bind(now, now, HISTORY_BACKFILL_ID)
      .run();
  }

  return database
    .prepare(`SELECT * FROM blower_history_backfill_state WHERE id = ? LIMIT 1`)
    .bind(HISTORY_BACKFILL_ID)
    .first();
}

async function historicalBackfillStep(database) {
  const today = formatKstDate(new Date());
  const state = await initializeBackfillRun(database, today);

  if (normalizeText(state.status) === "complete" && normalizeText(state.target_date) === today) {
    return jsonResponse({
      ok: true,
      done: true,
      message: `${today}까지 과거 업무일지 자동 반영이 완료되어 있습니다.`,
      backfill: await loadBackfillState(database)
    });
  }

  const cursorDate = normalizeText(state.cursor_date);
  const cursorId = normalizeText(state.cursor_id);
  let query;

  if (cursorDate) {
    query = database
      .prepare(`
        SELECT id, work_date, shift, role, author, log_json
        FROM shift_logs
        WHERE work_date >= ?
          AND work_date <= ?
          AND (work_date > ? OR (work_date = ? AND id > ?))
        ORDER BY work_date ASC, id ASC
        LIMIT ?
      `)
      .bind(HISTORY_BACKFILL_START_DATE, today, cursorDate, cursorDate, cursorId, HISTORY_BACKFILL_BATCH_SIZE);
  } else {
    query = database
      .prepare(`
        SELECT id, work_date, shift, role, author, log_json
        FROM shift_logs
        WHERE work_date >= ?
          AND work_date <= ?
        ORDER BY work_date ASC, id ASC
        LIMIT ?
      `)
      .bind(HISTORY_BACKFILL_START_DATE, today, HISTORY_BACKFILL_BATCH_SIZE);
  }

  const result = await query.all();
  const logs = Array.isArray(result.results) ? result.results : [];

  if (logs.length === 0) {
    const now = new Date().toISOString();
    await database
      .prepare(`
        UPDATE blower_history_backfill_state
        SET status = 'complete', completed_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .bind(now, now, HISTORY_BACKFILL_ID)
      .run();

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
  let autoEvents = 0;
  let pending = 0;

  for (const row of logs) {
    const processed = await processHistoricalLog(database, row, assets);
    autoEvents += processed.autoEvents;
    pending += processed.pending;
  }

  const last = logs[logs.length - 1];
  const done = logs.length < HISTORY_BACKFILL_BATCH_SIZE;
  const now = new Date().toISOString();

  await database
    .prepare(`
      UPDATE blower_history_backfill_state
      SET
        cursor_date = ?,
        cursor_id = ?,
        status = ?,
        scanned_logs = scanned_logs + ?,
        auto_confirmed_events = auto_confirmed_events + ?,
        pending_candidates = pending_candidates + ?,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `)
    .bind(
      normalizeText(last.work_date),
      normalizeText(last.id),
      done ? "complete" : "running",
      logs.length,
      autoEvents,
      pending,
      done ? now : null,
      now,
      HISTORY_BACKFILL_ID
    )
    .run();

  return jsonResponse({
    ok: true,
    done,
    message: done
      ? `${today}까지 과거 업무일지 자동 반영을 완료했습니다.`
      : `과거 업무일지 ${logs.length}건을 추가 확인했습니다.`,
    batchScanned: logs.length,
    batchAutoEvents: autoEvents,
    batchPending: pending,
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
        log_json
      FROM shift_logs
      WHERE work_date >= ?
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
  let detectedCount = 0;
  let insertedCount = 0;

  for (const row of logs) {
    let parsed;

    try {
      parsed = JSON.parse(row.log_json || "{}");
    } catch {
      continue;
    }

    const fragments = [...collectObjectTextFragments(parsed)];
    const seen = new Set();

    for (const fragment of fragments) {
      const specs = detectedEventSpecs(fragment);
      if (specs.length === 0) continue;

      const matches = findAssetMatches(fragment, assets);
      if (matches.length === 0) continue;

      for (const match of matches) {
        for (const spec of specs) {
          const key = `${row.id}::${match.asset.tag_number}::${spec.detectedType}`;
          if (seen.has(key)) continue;
          seen.add(key);
          detectedCount += 1;

          const sourceRow = { ...row, sourceText: fragment };
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
    message: `업무일지 ${logs.length}건을 확인했습니다.`,
    scannedDays: days,
    scannedLogCount: logs.length,
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

  if (decision === "exclude") {
    await database
      .prepare(`
        UPDATE blower_history_candidates
        SET
          status = 'excluded',
          reviewed_by_id = ?,
          reviewed_by_name = ?,
          reviewed_at = ?
        WHERE id = ? AND status = 'pending'
      `)
      .bind(user.employeeNo, user.name, now, id)
      .run();

    return jsonResponse({ ok: true, message: "자동감지 후보에서 제외했습니다." });
  }

  const mergedBody = {
    tagNumber: candidate.tag_number,
    eventDate: normalizeDateTime(body.eventDate) || candidate.detected_date,
    issueType: normalizeText(body.issueType) || normalizeText(candidate.issue_type),
    actionType: normalizeText(body.actionType) || normalizeText(candidate.action_type),
    isRunning: body.isRunning !== false,
    note: normalizeText(body.note)
  };

  const source = {
    sourceType: "shift_log_auto",
    sourceLogId: candidate.source_log_id,
    sourceText: candidate.source_text
  };

  const result =
    candidate.detected_type === "replacement"
      ? await registerReplacement(database, user, mergedBody, source)
      : await registerProblem(database, user, mergedBody, source);

  if (!result.ok) {
    return result;
  }

  await database
    .prepare(`
      UPDATE blower_history_candidates
      SET
        status = 'confirmed',
        reviewed_by_id = ?,
        reviewed_by_name = ?,
        reviewed_at = ?
      WHERE id = ? AND status = 'pending'
    `)
    .bind(user.employeeNo, user.name, now, id)
    .run();

  return jsonResponse({
    ok: true,
    message: "자동감지 내용을 확정하여 이력에 반영했습니다."
  });
}

async function handlePost(context, user) {
  let body = {};

  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, message: "요청 내용을 읽을 수 없습니다." }, 400);
  }

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
    return historicalBackfillStep(database);
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

    await ensureSchema(context.env.DB);
    return await handlePost(context, authentication.user);
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