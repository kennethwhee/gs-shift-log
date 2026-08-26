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
  ["진동", "이상진동"],
  ["이상", "이상"]
];

const REPLACEMENT_KEYWORDS = [
  "교체",
  "신품",
  "replacement",
  "replace"
];

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

function buildAssetState(asset, setting, latestProblem, now = new Date()) {
  const runtimeHours = currentRuntimeHours(asset, now);
  const cycleDays = toNullableNumber(setting?.cycle_days);
  const warningDays = toNullableNumber(setting?.warning_days);
  const criticalDays = toNullableNumber(setting?.critical_days);

  let severity = "normal";
  let remainingHours = null;
  let progressPct = null;

  if (!asset.last_replacement_at) {
    severity = "uninitialized";
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
    latestProblem: latestProblem || null
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
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 300));

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
  const safeStatus = ["pending", "confirmed", "excluded"].includes(status)
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

  const latestProblemMap = new Map();

  for (const row of Array.isArray(problemResult.results) ? problemResult.results : []) {
    if (!latestProblemMap.has(row.tag_number)) {
      latestProblemMap.set(row.tag_number, {
        id: row.id,
        eventDate: row.event_date,
        issueType: normalizeText(row.issue_type),
        actionType: normalizeText(row.action_type),
        note: normalizeText(row.note)
      });
    }
  }

  const now = new Date();

  return assets.map(asset =>
    buildAssetState(
      asset,
      settings[asset.blower_type],
      latestProblemMap.get(asset.tag_number),
      now
    )
  );
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

async function buildFullData(database, user) {
  const settings = await loadSettings(database);
  const assets = await loadAssetStates(database, settings);
  const events = await loadEvents(database, 400);
  const candidates = await loadCandidates(database, "pending", 300);
  const settingHistory = await loadSettingHistory(database, 60);

  return {
    ok: true,
    user,
    types: TYPE_DEFINITIONS,
    settings,
    assets,
    events,
    candidates,
    settingHistory,
    missingTags: buildMissingTagSummary(assets),
    generatedAt: new Date().toISOString()
  };
}

function buildSummaryFromAssets(assets) {
  const severityRank = {
    overdue: 4,
    critical: 3,
    warning: 2,
    unset: 1,
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

  const beforeRuntime = currentRuntimeHours(asset);
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

  const runtimeHours = currentRuntimeHours(asset);
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
    if (normalized.includes(keyword.toLowerCase())) {
      return label;
    }
  }

  return "";
}

function hasReplacementKeyword(text) {
  const normalized = normalizeText(text).toLowerCase();
  return REPLACEMENT_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
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

function fingerprintText(text) {
  let hash = 2166136261;
  const source = String(text || "");

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
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
  const assetsResult = await database
    .prepare(`
      SELECT tag_number
      FROM blower_history_assets
      WHERE enabled = 1
    `)
    .all();

  const knownTags = (Array.isArray(assetsResult.results) ? assetsResult.results : [])
    .map(row => normalizeText(row.tag_number).toUpperCase())
    .filter(Boolean);

  const now = new Date().toISOString();
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

    for (const fragment of fragments) {
      const upper = fragment.toUpperCase();
      const matchedTags = knownTags.filter(tag => upper.includes(tag));

      if (matchedTags.length === 0) {
        continue;
      }

      const replacementDetected = hasReplacementKeyword(fragment);
      const issueType = findIssueType(fragment);

      if (!replacementDetected && !issueType) {
        continue;
      }

      const detectedType = replacementDetected ? "replacement" : "problem";
      const actionType = replacementDetected ? "교체" : "확인";

      for (const tagNumber of matchedTags) {
        detectedCount += 1;

        const fingerprint = fingerprintText(
          [row.id, row.work_date, tagNumber, detectedType, fragment].join("||")
        );

        const insertResult = await database
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
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
          `)
          .bind(
            crypto.randomUUID(),
            fingerprint,
            tagNumber,
            detectedType,
            normalizeDateTime(row.work_date),
            issueType,
            actionType,
            row.id,
            normalizeText(row.shift),
            normalizeText(row.role),
            normalizeText(row.author),
            fragment.slice(0, 2000),
            now
          )
          .run();

        insertedCount += Number(insertResult?.meta?.changes || 0);
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