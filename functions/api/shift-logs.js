/* =========================================================
  GS Shift Log 신규 업무일지 공용 저장 API

  GET    /api/shift-logs
  POST   /api/shift-logs
  DELETE /api/shift-logs?id=...&revision=...

  핵심 규칙
  - 신규 업무일지는 Cloudflare D1에 공용 저장
  - 로그인 세션으로 사용자와 권한 확인
  - 최고관리자는 모든 보직·상태 수정 가능
  - 최고관리자가 내용을 수정해도 원 작성자·결재 상태 유지
  - revision 값으로 동시 수정 충돌 방지
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";

const VALID_SHIFTS =
  new Set([
    "DS",
    "NS"
  ]);

const VALID_ROLES =
  new Set([
    "파트장",
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ]);

const VALID_STATUSES =
  new Set([
    "임시저장",
    "결재요청",
    "결재완료",
    "저장완료"
  ]);

const MAX_LOG_JSON_BYTES =
  900000;


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
          "no-store"
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
  const role =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );

  if (
    [
      "super_admin",
      "superadmin"
    ].includes(
      role
    )
  ) {
    return "super_admin";
  }

  if (
    [
      "admin",
      "leader"
    ].includes(
      role
    )
  ) {
    return "admin";
  }

  return "user";
}


function normalizeLogRole(
  value
) {
  const role =
    normalizeText(
      value
    )
      .replace(
        /\s+/g,
        ""
      )
      .toUpperCase();

  const roleMap = {
    파트장:
      "파트장",
    TGO:
      "TGO",
    BCO1:
      "BCO1",
    BCO2:
      "BCO2",
    TO:
      "TO",
    BO1:
      "BO1",
    BO2:
      "BO2"
  };

  return (
    roleMap[
      role
    ] ||
    ""
  );
}


function normalizeShift(
  value
) {
  const shift =
    normalizeText(
      value
    )
      .toUpperCase()
      .replace(
        /[^A-Z]/g,
        ""
      );

  if (
    [
      "DS",
      "D"
    ].includes(
      shift
    )
  ) {
    return "DS";
  }

  if (
    [
      "NS",
      "N"
    ].includes(
      shift
    )
  ) {
    return "NS";
  }

  return "";
}


function normalizeStatus(
  value
) {
  const status =
    normalizeText(
      value
    );

  const statusMap = {
    작성중:
      "임시저장",
    임시저장:
      "임시저장",
    작성완료:
      "결재요청",
    결재요청:
      "결재요청",
    결재완료:
      "결재완료",
    저장완료:
      "저장완료"
  };

  return (
    statusMap[
      status
    ] ||
    ""
  );
}


function isValidIsoDate(
  value
) {
  const date =
    normalizeText(
      value
    );

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date
    )
  ) {
    return false;
  }

  const parsedDate =
    new Date(
      `${date}T00:00:00.000Z`
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
      date
  );
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
    .join("");
}


async function hashSessionToken(
  token
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        token
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
    await hashSessionToken(
      token
    );

  const session =
    await context.env.DB
      .prepare(`
        SELECT
          session.employee_no,
          session.expires_at,
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
    await context.env.DB
      .prepare(`
        DELETE FROM shift_log_sessions
        WHERE token_hash = ?
      `)
      .bind(
        tokenHash
      )
      .run();

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

  return {
    user: {
      employeeNo,
      name:
        normalizeText(
          session.name
        ),
      role,
      isAdmin:
        role ===
          "admin" ||
        role ===
          "super_admin",
      isSuperAdmin:
        role ===
          "super_admin"
    }
  };
}


function parseJsonObject(
  value
) {
  try {
    const parsedValue =
      JSON.parse(
        normalizeText(
          value
        ) ||
        "{}"
      );

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


function convertRowToLog(
  row
) {
  const storedLog =
    parseJsonObject(
      row.log_json
    );

  return {
    ...storedLog,
    id:
      normalizeText(
        row.id
      ),
    date:
      normalizeText(
        row.work_date
      ),
    shift:
      normalizeShift(
        row.shift
      ),
    role:
      normalizeLogRole(
        row.role
      ),
    team:
      normalizeText(
        row.team
      ),
    author:
      normalizeText(
        row.author
      ),
    authorId:
      normalizeEmployeeNo(
        row.author_id
      ),
    authorRole:
      normalizeAccountRole(
        row.author_role
      ),
    status:
      normalizeStatus(
        row.status
      ),
    lastModifiedBy:
      normalizeText(
        row.last_modified_by
      ),
    lastModifiedById:
      normalizeEmployeeNo(
        row.last_modified_by_id
      ),
    serverRevision:
      Number(
        row.revision
      ) ||
      1,
    createdAt:
      normalizeText(
        row.created_at
      ),
    updatedAt:
      normalizeText(
        row.updated_at
      ),
    source:
      "shared-d1"
  };
}


async function findLogById(
  database,
  id
) {
  const row =
    await database
      .prepare(`
        SELECT
          *
        FROM shift_logs
        WHERE id = ?
        LIMIT 1
      `)
      .bind(
        id
      )
      .first();

  return row
    ? convertRowToLog(
        row
      )
    : null;
}


async function findLogByGroup(
  database,
  date,
  shift,
  role
) {
  const row =
    await database
      .prepare(`
        SELECT
          *
        FROM shift_logs
        WHERE
          work_date = ? AND
          shift = ? AND
          role = ?
        LIMIT 1
      `)
      .bind(
        date,
        shift,
        role
      )
      .first();

  return row
    ? convertRowToLog(
        row
      )
    : null;
}


function removeServerOnlyFields(
  log
) {
  const cleanLog = {
    ...log
  };

  delete cleanLog.serverRevision;

  return cleanLog;
}


function appendApprovalHistory(
  log,
  action,
  user,
  previousStatus,
  nextStatus,
  timestamp
) {
  const previousHistory =
    Array.isArray(
      log.approvalHistory
    )
      ? log.approvalHistory
      : [];

  log.approvalHistory = [
    ...previousHistory,
    {
      id:
        crypto.randomUUID(),
      action,
      user:
        user.name,
      userId:
        user.employeeNo,
      userRole:
        user.role,
      previousStatus,
      nextStatus,
      createdAt:
        timestamp
    }
  ];
}


function validateLogInput(
  rawLog
) {
  if (
    !rawLog ||
    typeof rawLog !==
      "object" ||
    Array.isArray(
      rawLog
    )
  ) {
    return {
      error:
        "업무일지 데이터 형식이 올바르지 않습니다."
    };
  }

  const log = {
    ...rawLog,
    id:
      normalizeText(
        rawLog.id
      ),
    date:
      normalizeText(
        rawLog.date
      ),
    shift:
      normalizeShift(
        rawLog.shift
      ),
    role:
      normalizeLogRole(
        rawLog.role
      ),
    team:
      normalizeText(
        rawLog.team
      ),
    status:
      normalizeStatus(
        rawLog.status
      )
  };

  if (
    !log.id ||
    log.id.length >
      120
  ) {
    return {
      error:
        "업무일지 ID를 확인할 수 없습니다."
    };
  }

  if (
    !isValidIsoDate(
      log.date
    )
  ) {
    return {
      error:
        "업무일지 날짜가 올바르지 않습니다."
    };
  }

  if (
    !VALID_SHIFTS.has(
      log.shift
    )
  ) {
    return {
      error:
        "업무일지 근무 구분이 올바르지 않습니다."
    };
  }

  if (
    !VALID_ROLES.has(
      log.role
    )
  ) {
    return {
      error:
        "업무일지 보직이 올바르지 않습니다."
    };
  }

  if (
    !VALID_STATUSES.has(
      log.status
    )
  ) {
    return {
      error:
        "업무일지 상태가 올바르지 않습니다."
    };
  }

  const jsonText =
    JSON.stringify(
      log
    );

  if (
    new TextEncoder()
      .encode(
        jsonText
      )
      .byteLength >
      MAX_LOG_JSON_BYTES
  ) {
    return {
      error:
        "업무일지 데이터가 너무 큽니다."
    };
  }

  return {
    log
  };
}

/* =========================================================
  석회석 입고기록 업무일지 자동 동기화

  - 업무일지가 D1에 저장되기만 하면 반영
  - 상태와 무관: 임시저장·결재요청·결재완료·저장완료
  - 1호기: BCO1 > BO1
  - 2호기: BCO2 > BO2
  - 같은 실제일자·시간·호기·수량이면 상위 보직만 유지
========================================================= */

const LIMESTONE_SYNC_ROLE_TO_UNIT = {
  BCO1: 1,
  BO1: 1,
  BCO2: 2,
  BO2: 2
};

const LIMESTONE_SYNC_ROLE_PRIORITY = {
  BCO1: 20,
  BO1: 10,
  BCO2: 20,
  BO2: 10
};

function normalizeLimestoneSyncQuantity(value) {
  const quantity = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(quantity)) return null;
  const rounded = Math.round(quantity * 100) / 100;
  return rounded >= 0.01 && rounded <= 999.99 ? rounded : null;
}

function addLimestoneSyncDateDays(dateValue, dayCount) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(dayCount || 0));
  return date.toISOString().slice(0, 10);
}

function findLimestoneSyncTime(value) {
  const matches = [
    ...String(value || "").matchAll(
      /(?:^|[^\d])([01]\d|2[0-3]):([0-5]\d)(?!\d)/g
    )
  ];
  if (!matches.length) return "";
  const match = matches[matches.length - 1];
  return `${match[1]}:${match[2]}`;
}

function getLimestoneSyncReceiptDate(workDate, shift, receiptTime) {
  const hour = Number(String(receiptTime || "").slice(0, 2));
  return normalizeShift(shift) === "NS" && hour >= 0 && hour < 7
    ? addLimestoneSyncDateDays(workDate, 1)
    : normalizeText(workDate);
}

function collectLimestoneSyncEntries(log) {
  const result = [];
  const usedKeys = new Set();
  const collections = [
    ["entries", log?.entries],
    ["tmEntries", log?.tmEntries],
    ["handoverEntries", log?.handoverEntries]
  ];

  collections.forEach(([collectionName, source]) => {
    (Array.isArray(source) ? source : []).forEach((rawEntry, entryIndex) => {
      const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)
        ? rawEntry
        : { content: String(rawEntry || "") };

      const content = normalizeText(entry.content || entry.text);
      if (!content) return;

      const sourceType = normalizeText(entry.source).toLowerCase();
      if (sourceType.includes("previous-shift") || normalizeText(entry.inheritedFromDate)) {
        return;
      }

      const entryId = normalizeText(entry.id);
      const key = entryId || [
        normalizeText(entry.time),
        normalizeText(entry.category),
        normalizeText(entry.tag),
        content.replace(/\s+/g, " ").toUpperCase()
      ].join("||");

      if (usedKeys.has(key)) return;
      usedKeys.add(key);
      result.push({ entry, entryIndex, collectionName });
    });
  });

  return result;
}

function extractLimestoneSyncItems(entry) {
  const content = String(entry?.content || entry?.text || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!content) return [];

  const entryTime = findLimestoneSyncTime(entry?.time);
  const result = [];

  content.split("\n").map(line => line.trim()).filter(Boolean).forEach((line, lineIndex) => {
    const patterns = [
      /(?:lime\s*stone|석회석)[^\r\n]{0,60}?입고(?:량|완료)?[^0-9\r\n]{0,30}?(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:tons?|t|톤)/gi,
      /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:tons?|t|톤)[^\r\n]{0,50}?(?:lime\s*stone|석회석)[^\r\n]{0,30}?입고(?:량|완료)?/gi
    ];

    const lineItems = new Map();
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const quantityTon = normalizeLimestoneSyncQuantity(match[1]);
        const receiptTime = findLimestoneSyncTime(line.slice(0, match.index))
          || findLimestoneSyncTime(line)
          || entryTime;
        if (quantityTon === null || !receiptTime) continue;
        lineItems.set(`${receiptTime}||${quantityTon.toFixed(2)}`, {
          receiptTime,
          quantityTon,
          sourceText: line
        });
      }
    });

    [...lineItems.values()].forEach((item, matchIndex) => {
      result.push({ ...item, lineIndex, matchIndex });
    });
  });

  return result;
}

function createLimestoneSyncBusinessKey(item) {
  return [
    item.receiptDate,
    item.receiptTime,
    item.unitNo,
    Number(item.quantityTon).toFixed(2)
  ].join("||");
}

function buildLimestoneSyncCandidates(logs) {
  const latestByRole = new Map();

  (Array.isArray(logs) ? logs : [])
    .filter(log => Object.hasOwn(LIMESTONE_SYNC_ROLE_TO_UNIT, normalizeLogRole(log?.role)))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .forEach(log => {
      const role = normalizeLogRole(log.role);
      if (!latestByRole.has(role)) latestByRole.set(role, log);
    });

  const rawCandidates = [];

  latestByRole.forEach((log, role) => {
    const unitNo = LIMESTONE_SYNC_ROLE_TO_UNIT[role];

    collectLimestoneSyncEntries(log).forEach(({ entry, entryIndex, collectionName }) => {
      extractLimestoneSyncItems(entry).forEach(extracted => {
        const receiptDate = getLimestoneSyncReceiptDate(log.date, log.shift, extracted.receiptTime);
        if (!isValidIsoDate(receiptDate)) return;

        const originalIndex = Number(entry.importedFromEntryIndex);
        const stableIndex = Number.isInteger(originalIndex) && originalIndex >= 0
          ? originalIndex
          : entryIndex;
        const baseEntryId = normalizeText(entry.id)
          || `entry-legacy-${log.id}-${stableIndex}-${collectionName}`;
        const sourceEntryId = `${baseEntryId}-limestone-${extracted.lineIndex}-${extracted.matchIndex}`;
        const sourceLogId = normalizeText(log.id);
        if (!sourceLogId) return;

        rawCandidates.push({
          receiptDate,
          receiptTime: extracted.receiptTime,
          unitNo,
          quantityTon: extracted.quantityTon,
          note: "",
          sourceLogId,
          sourceEntryId,
          sourceKey: `${sourceLogId}||${sourceEntryId}`,
          sourceRole: role,
          sourceAuthor: normalizeText(log.author),
          sourceAuthorId: normalizeEmployeeNo(log.authorId),
          sourceText: normalizeText(extracted.sourceText).slice(0, 1000),
          sourceUpdatedAt: normalizeText(log.updatedAt || log.createdAt)
        });
      });
    });
  });

  rawCandidates.sort((a, b) => {
    const priority = LIMESTONE_SYNC_ROLE_PRIORITY[b.sourceRole]
      - LIMESTONE_SYNC_ROLE_PRIORITY[a.sourceRole];
    if (priority !== 0) return priority;
    return String(b.sourceUpdatedAt).localeCompare(String(a.sourceUpdatedAt));
  });

  const selected = new Map();
  rawCandidates.forEach(candidate => {
    const key = createLimestoneSyncBusinessKey(candidate);
    if (!selected.has(key)) selected.set(key, candidate);
  });

  return [...selected.values()];
}

function isSameLimestoneSyncRow(row, candidate) {
  return normalizeText(row.receipt_date) === candidate.receiptDate
    && normalizeText(row.receipt_time) === candidate.receiptTime
    && Number(row.unit_no) === candidate.unitNo
    && Number(row.quantity_ton).toFixed(2) === Number(candidate.quantityTon).toFixed(2)
    && normalizeText(row.note) === candidate.note
    && normalizeText(row.source_role) === candidate.sourceRole
    && normalizeText(row.source_author) === candidate.sourceAuthor
    && normalizeText(row.source_text) === candidate.sourceText;
}

async function synchronizeLimestoneReceiptsForShiftContext(context, options = {}) {
  const database = context?.env?.DB;
  const workDate = normalizeText(options.workDate);
  const shift = normalizeShift(options.shift);
  const user = options.user || {};
  const removedIds = new Set(
    (Array.isArray(options.removedSourceLogIds) ? options.removedSourceLogIds : [])
      .map(normalizeText)
      .filter(Boolean)
  );

  if (!database || !isValidIsoDate(workDate) || !VALID_SHIFTS.has(shift)) {
    return { ok: false, skipped: true, message: "석회석 자동 동기화 조건을 확인할 수 없습니다." };
  }

  try {
    const logResult = await database.prepare(`
      SELECT * FROM shift_logs
      WHERE work_date = ? AND shift = ?
        AND role IN ('BCO1', 'BO1', 'BCO2', 'BO2')
    `).bind(workDate, shift).all();

    const logs = (Array.isArray(logResult.results) ? logResult.results : []).map(convertRowToLog);
    const sourceIds = new Set(logs.map(log => normalizeText(log.id)).filter(Boolean));
    removedIds.forEach(id => sourceIds.add(id));

    if (!sourceIds.size) {
      return { ok: true, skipped: true, selectedCount: 0, createdCount: 0, updatedCount: 0, deletedCount: 0 };
    }

    const candidates = buildLimestoneSyncCandidates(logs);
    const sourceIdList = [...sourceIds];
    const placeholders = sourceIdList.map(() => "?").join(", ");
    const existingResult = await database.prepare(`
      SELECT * FROM limestone_receipts
      WHERE source_type = 'shift_log'
        AND source_log_id IN (${placeholders})
    `).bind(...sourceIdList).all();

    const existingRows = Array.isArray(existingResult.results) ? existingResult.results : [];
    const existingBySourceKey = new Map();
    existingRows.forEach(row => {
      const key = normalizeText(row.source_key);
      if (key && !existingBySourceKey.has(key)) existingBySourceKey.set(key, row);
    });

    const keptIds = new Set();
    const statements = [];
    const timestamp = new Date().toISOString();
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    candidates.forEach(candidate => {
      const existing = existingBySourceKey.get(candidate.sourceKey);
      const authorId = candidate.sourceAuthorId || normalizeEmployeeNo(user.employeeNo);
      const authorName = candidate.sourceAuthor || normalizeText(user.name) || "업무일지 자동연동";
      const modifierId = normalizeEmployeeNo(user.employeeNo) || authorId;
      const modifierName = normalizeText(user.name) || authorName;

      if (existing) {
        keptIds.add(normalizeText(existing.id));
        if (!isSameLimestoneSyncRow(existing, candidate)) {
          statements.push(database.prepare(`
            UPDATE limestone_receipts SET
              receipt_date = ?, receipt_time = ?, unit_no = ?, quantity_ton = ?, note = ?,
              source_log_id = ?, source_entry_id = ?, source_key = ?, source_role = ?,
              source_author = ?, source_text = ?, updated_by_id = ?, updated_by_name = ?,
              updated_at = ?, revision = revision + 1
            WHERE id = ?
          `).bind(
            candidate.receiptDate, candidate.receiptTime, candidate.unitNo,
            candidate.quantityTon, candidate.note, candidate.sourceLogId,
            candidate.sourceEntryId, candidate.sourceKey, candidate.sourceRole,
            candidate.sourceAuthor, candidate.sourceText, modifierId, modifierName,
            timestamp, existing.id
          ));
          updatedCount += 1;
        }
        return;
      }

      statements.push(database.prepare(`
        INSERT INTO limestone_receipts (
          id, receipt_date, receipt_time, unit_no, quantity_ton, note,
          source_type, source_log_id, source_entry_id, source_key, source_role,
          source_author, source_text, created_by_id, created_by_name,
          updated_by_id, updated_by_name, created_at, updated_at, revision
        ) VALUES (
          ?, ?, ?, ?, ?, ?, 'shift_log', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
        )
      `).bind(
        crypto.randomUUID(), candidate.receiptDate, candidate.receiptTime,
        candidate.unitNo, candidate.quantityTon, candidate.note,
        candidate.sourceLogId, candidate.sourceEntryId, candidate.sourceKey,
        candidate.sourceRole, candidate.sourceAuthor, candidate.sourceText,
        authorId, authorName, modifierId, modifierName, timestamp, timestamp
      ));
      createdCount += 1;
    });

    existingRows.forEach(row => {
      const id = normalizeText(row.id);
      if (!id || keptIds.has(id)) return;
      statements.push(database.prepare(
        "DELETE FROM limestone_receipts WHERE id = ?"
      ).bind(id));
      deletedCount += 1;
    });

    if (statements.length) await database.batch(statements);

    return {
      ok: true,
      skipped: false,
      workDate,
      shift,
      selectedCount: candidates.length,
      createdCount,
      updatedCount,
      deletedCount
    };
  } catch (error) {
    console.error("석회석 입고기록 자동 동기화 실패:", error);
    return {
      ok: false,
      skipped: false,
      workDate,
      shift,
      message: error instanceof Error ? error.message : "석회석 자동 동기화 오류"
    };
  }
}

/* =========================================================
  Facility Navigator 점검이력 연동 대상 선별

  연동 대상:
  - TAG와 내용이 있는 항목
  - TM/BM/CM 발행·작업
  - 파트원: 결재완료
  - 파트장: 저장완료

  연동 제외:
  - 임시저장
  - 결재요청
  - 인계사항
  - 비고
  - 운전현황

  항목 식별:
  1. 기존 고정 ID
  2. 최초 원본 일지 ID + 원본 항목 번호
========================================================= */

const NAVIGATOR_INSPECTION_SYNC_CATEGORIES =
  new Set([
    "TM 발행",
    "TM 작업",
    "BM 발행",
    "BM 작업",
    "CM 발행",
    "CM 작업"
  ]);


const NAVIGATOR_INSPECTION_SYNC_MEMBER_ROLES =
  new Set([
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ]);


/* =========================================================
  Navigator 연동용 구분명 정규화
========================================================= */

function normalizeNavigatorInspectionCategory(
  value
) {
  const compactCategory =
    normalizeText(
      value
    )
      .toUpperCase()
      .replace(
        /\s+/g,
        ""
      );


  const categoryPrefixes = [
    [
      "TM발행",
      "TM 발행"
    ],
    [
      "TM작업",
      "TM 작업"
    ],
    [
      "BM발행",
      "BM 발행"
    ],
    [
      "BM작업",
      "BM 작업"
    ],
    [
      "CM발행",
      "CM 발행"
    ],
    [
      "CM작업",
      "CM 작업"
    ]
  ];


  const matchedCategory =
    categoryPrefixes.find(
      (
        [
          prefix
        ]
      ) => {
        return compactCategory
          .startsWith(
            prefix
          );
      }
    );


  return (
    matchedCategory?.[1] ||
    ""
  );
}


/* =========================================================
  원본 항목 번호 정규화
========================================================= */

function normalizeNavigatorInspectionEntryIndex(
  value
) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const numericValue =
    Number(
      value
    );


  return (
    Number.isInteger(
      numericValue
    ) &&
    numericValue >= 0
  )
    ? numericValue
    : null;
}


/* =========================================================
  Navigator 연동용 고정 항목 ID
========================================================= */

function createNavigatorInspectionSourceEntryId(
  log,
  entry,
  entryIndex
) {
  const existingEntryId =
    normalizeText(
      entry?.id
    );


  /*
    저장된 고정 ID가 있으면
    가장 먼저 사용한다.
  */
  if (
    existingEntryId
  ) {
    return existingEntryId;
  }


  /*
    파트장에게 취합된 항목은
    최초 원본 업무일지 ID를 유지한다.
  */
  const sourceLogId =
    normalizeText(
      entry
        ?.importedFromLogId ||
      log?.id
    );


  const importedEntryIndex =
    normalizeNavigatorInspectionEntryIndex(
      entry
        ?.importedFromEntryIndex
    );


  const fallbackEntryIndex =
    normalizeNavigatorInspectionEntryIndex(
      entryIndex
    );


  const sourceEntryIndex =
    importedEntryIndex ??
    fallbackEntryIndex;


  if (
    !sourceLogId ||
    sourceEntryIndex ===
      null
  ) {
    return "";
  }


  /*
    ID가 없는 과거 항목도
    같은 원본이면 항상 같은 ID를 사용한다.
  */
  return [
    "entry-legacy",
    sourceLogId,
    sourceEntryIndex
  ].join(
    "-"
  );
}


/* =========================================================
  저장 구조별 업무 항목 수집

  새 구조와 기존 entries가 함께 저장되어도
  이후 단계에서 같은 항목은 한 번만 남긴다.
========================================================= */

function collectNavigatorInspectionSourceEntries(
  log
) {
  const sourceEntries = [];


  const appendEntries = (
    entries,
    collection,
    fallbackCategory = ""
  ) => {
    if (
      !Array.isArray(
        entries
      )
    ) {
      return;
    }


    entries.forEach(
      (
        entry,
        entryIndex
      ) => {
        if (
          !entry ||
          typeof entry !==
            "object" ||
          Array.isArray(
            entry
          )
        ) {
          return;
        }


        sourceEntries.push({
          entry,
          entryIndex,
          collection,
          fallbackCategory
        });
      }
    );
  };


  /*
    기존 공통 배열
  */
  appendEntries(
    log?.entries,
    "entries"
  );


  /*
    새 분리 저장 배열
  */
  appendEntries(
    log?.tmEntries,
    "tmEntries",
    "TM 발행"
  );


  appendEntries(
    log?.handoverEntries,
    "handoverEntries"
  );


  /*
    비고는 수집하더라도
    최종 대상 선별에서 제외된다.
  */
  appendEntries(
    log?.remarkEntries,
    "remarkEntries",
    "비고"
  );


  return sourceEntries;
}


/* =========================================================
  업무일지 상태별 Navigator 연동 가능 여부

  파트장:
  - 결재완료 후 연동

  파트원:
  - 결재완료 후 연동
========================================================= */

function isNavigatorInspectionPublishableLog(
  log
) {
  const role =
    normalizeLogRole(
      log?.role
    );


  const status =
    normalizeStatus(
      log?.status
    );


  /*
    파트장 업무일지는
    결재완료 상태에서 연동한다.
  */
  if (
    role ===
      "파트장"
  ) {
    return (
      status ===
      "결재완료"
    );
  }


  /*
    파트원 업무일지도
    결재완료 상태에서 연동한다.
  */
  return (
    NAVIGATOR_INSPECTION_SYNC_MEMBER_ROLES
      .has(
        role
      ) &&

    status ===
      "결재완료"
  );
}


/* =========================================================
  네비게이터 이력관리 제외값 확인

  지원 값:
  - true
  - 1
  - "1"
  - "true"
  - "yes"
  - "y"
  - "exclude"
  - "excluded"
  - "제외"

  기존 업무일지처럼 값이 없으면 false로 처리하여
  기존과 동일하게 네비게이터 이력에 포함한다.
========================================================= */

function isNavigatorInspectionHistoryExcluded(
  value
) {
  if (
    value === true ||
    value === 1
  ) {
    return true;
  }


  const normalizedValue =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /\s+/g,
        ""
      );


  return [
    "1",
    "true",
    "yes",
    "y",
    "exclude",
    "excluded",
    "제외"
  ].includes(
    normalizedValue
  );
}


/* =========================================================
  Navigator 항목 내용 비교 키 생성

  목적:
  entries와 tmEntries 등에 같은 항목이
  중복 저장되어 있을 때 한쪽 배열에만 제외값이 있어도
  최종적으로 같은 항목 전체를 제외한다.
========================================================= */

function createNavigatorInspectionContentKey(
  category,
  entry,
  tagNo,
  content
) {
  return [
    normalizeText(
      category
    ),

    normalizeText(
      entry?.time
    ),

    normalizeText(
      tagNo
    )
      .toUpperCase(),

    normalizeText(
      content
    )
      .normalize(
        "NFKC"
      )
      .replace(
        /[\u200B-\u200D\u2060\uFEFF]/g,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .toUpperCase()
  ].join(
    "||"
  );
}


/* =========================================================
  Navigator 점검이력 항목 생성 최종본

  연동 대상:
  - TM/BM/CM 발행·작업
  - TAG 존재
  - 내용 존재
  - 이력관리 제외가 체크되지 않은 항목

  연동 제외:
  - excludeFromNavigatorHistory = true
  - entries와 분리 배열 중 하나라도 제외 처리된 동일 항목
========================================================= */

function createNavigatorInspectionSyncItems(
  log
) {
  const containerLogId =
    normalizeText(
      log?.id
    );


  const inspectionDate =
    normalizeText(
      log?.date
    );


  const shift =
    normalizeShift(
      log?.shift
    );


  const containerRole =
    normalizeLogRole(
      log?.role
    );


  /*
    업무일지의 모든 저장 배열을 한 번만 수집한다.

    지원:
    - entries
    - tmEntries
    - handoverEntries
    - remarkEntries
  */
  const sourceEntries =
    collectNavigatorInspectionSourceEntries(
      log
    );


  /*
    제외 대상 식별 정보

    sourceKey:
    원본 일지 ID + 항목 ID

    contentKey:
    구분 + 시간 + TAG + 내용
  */
  const excludedSourceKeys =
    new Set();


  const excludedContentKeys =
    new Set();


  /* =====================================================
    1차 순회

    전체 배열을 먼저 확인하여
    제외 처리된 항목의 식별값을 수집한다.

    entries에는 false,
    tmEntries에는 true가 들어 있는 예외 상황에서도
    true를 우선하도록 한다.
  ====================================================== */

  sourceEntries.forEach(
    source => {
      const {
        entry,
        entryIndex,
        fallbackCategory
      } = source;


      const category =
        normalizeNavigatorInspectionCategory(
          entry?.category ||
          fallbackCategory
        );


      const tagNo =
        normalizeText(
          entry?.tag
        )
          .toUpperCase();


      const content =
        normalizeText(
          entry?.content
        );


      /*
        네비게이터 대상 구분이 아니거나
        TAG·내용이 없으면 제외 맵을 만들 필요가 없다.
      */
      if (
        !NAVIGATOR_INSPECTION_SYNC_CATEGORIES
          .has(
            category
          ) ||
        !tagNo ||
        !content
      ) {
        return;
      }


      if (
        !isNavigatorInspectionHistoryExcluded(
          entry
            ?.excludeFromNavigatorHistory
        )
      ) {
        return;
      }


      const sourceLogId =
        normalizeText(
          entry
            ?.importedFromLogId ||
          containerLogId
        );


      const sourceEntryId =
        createNavigatorInspectionSourceEntryId(
          log,
          entry,
          entryIndex
        );


      if (
        sourceLogId &&
        sourceEntryId
      ) {
        excludedSourceKeys.add(
          [
            sourceLogId,
            sourceEntryId
          ].join(
            "||"
          )
        );
      }


      excludedContentKeys.add(
        createNavigatorInspectionContentKey(
          category,
          entry,
          tagNo,
          content
        )
      );
    }
  );


  /* =====================================================
    최종 연동 항목
  ====================================================== */

  const uniqueItems =
    new Map();


  /*
    ID가 없는 과거 자료가
    entries와 분리 배열 양쪽에 저장된 경우
    동일 내용을 한 번만 사용한다.
  */
  const legacyContentOwners =
    new Map();


  /*
    고정 ID 중복 확인
  */
  const storedEntryIds =
    new Set();


  /* =====================================================
    2차 순회

    실제 네비게이터 전송 항목을 만든다.
  ====================================================== */

  sourceEntries.forEach(
    source => {
      const {
        entry,
        entryIndex,
        collection,
        fallbackCategory
      } = source;


      const category =
        normalizeNavigatorInspectionCategory(
          entry?.category ||
          fallbackCategory
        );


      const tagNo =
        normalizeText(
          entry?.tag
        )
          .toUpperCase();


      const content =
        normalizeText(
          entry?.content
        );


      /*
        TAG가 있는 TM/BM/CM 발행·작업만
        점검이력 대상으로 사용한다.
      */
      if (
        !NAVIGATOR_INSPECTION_SYNC_CATEGORIES
          .has(
            category
          ) ||
        !tagNo ||
        !content
      ) {
        return;
      }


      const sourceLogId =
        normalizeText(
          entry
            ?.importedFromLogId ||
          containerLogId
        );


      const sourceEntryIndex =
        normalizeNavigatorInspectionEntryIndex(
          entry
            ?.importedFromEntryIndex
        ) ??
        normalizeNavigatorInspectionEntryIndex(
          entryIndex
        );


      const sourceEntryId =
        createNavigatorInspectionSourceEntryId(
          log,
          entry,
          entryIndex
        );


      if (
        !sourceLogId ||
        !sourceEntryId
      ) {
        return;
      }


      const sourceKey = [
        sourceLogId,
        sourceEntryId
      ].join(
        "||"
      );


      const contentKey =
        createNavigatorInspectionContentKey(
          category,
          entry,
          tagNo,
          content
        );


      /* ===================================================
        네비게이터 이력관리 제외

        현재 항목 자체가 제외 상태이거나,
        다른 저장 배열의 동일 항목이 제외 상태면
        최종 전송 대상에서 제외한다.
      ==================================================== */

      const excluded =
        isNavigatorInspectionHistoryExcluded(
          entry
            ?.excludeFromNavigatorHistory
        ) ||
        excludedSourceKeys.has(
          sourceKey
        ) ||
        excludedContentKeys.has(
          contentKey
        );


      if (
        excluded
      ) {
        return;
      }


      const storedEntryId =
        normalizeText(
          entry?.id
        );


      /*
        같은 고정 ID가 entries와 분리 배열에
        동시에 있으면 한 번만 사용한다.
      */
      if (
        storedEntryId &&
        storedEntryIds.has(
          storedEntryId
        )
      ) {
        return;
      }


      /*
        원본 업무일지 ID + 항목 ID를
        최종 중복 방지 키로 사용한다.
      */
      if (
        uniqueItems.has(
          sourceKey
        )
      ) {
        return;
      }


      /*
        ID가 없는 과거 자료가 entries와
        분리 배열 양쪽에 있으면 내용으로 한 번 더 제거한다.
      */
      const legacyOwnerCollection =
        legacyContentOwners.get(
          contentKey
        );


      if (
        !storedEntryId &&
        legacyOwnerCollection &&
        legacyOwnerCollection !==
          collection
      ) {
        return;
      }


      if (
        !storedEntryId &&
        !legacyOwnerCollection
      ) {
        legacyContentOwners.set(
          contentKey,
          collection
        );
      }


      uniqueItems.set(
        sourceKey,
        {
          /*
            Navigator가 동일 항목을
            생성·수정·삭제할 때 사용하는 식별 정보
          */
          sourceKey,

          sourceLogId,

          sourceEntryId,

          sourceEntryIndex,


          /*
            파트장 취합 항목은
            최초 작성 보직과 작성자를 유지한다.
          */
          sourceRole:
            normalizeLogRole(
              entry
                ?.importedFromRole
            ) ||
            containerRole,

          sourceAuthor:
            normalizeText(
              entry
                ?.importedFromAuthor ||
              log?.author
            ),


          /*
            점검이력 표시 정보
          */
          tagNo,

          inspectionDate,

          shift,

          category,

          time:
            normalizeText(
              entry?.time
            ),

          content,

          attachmentName:
            normalizeText(
              entry
                ?.attachmentName
            )
        }
      );


      if (
        storedEntryId
      ) {
        storedEntryIds.add(
          storedEntryId
        );
      }
    }
  );


  return [
    ...uniqueItems.values()
  ];
}

/* =========================================================
  Navigator 전송 대상 최종 선택

  publish:
  - 현재 업무일지의 연동 대상 전체 전송

  purge:
  - 기존에 이 업무일지가 연동한 항목 해제
========================================================= */

function createNavigatorInspectionSyncSelection(
  log
) {
  const containerLogId =
    normalizeText(
      log?.id
    );


  const publishable =
    isNavigatorInspectionPublishableLog(
      log
    );


  const items =
    publishable
      ? createNavigatorInspectionSyncItems(
          log
        )
      : [];


  return {
    containerLogId,

    /*
      연동 가능한 상태라도 대상 항목이 없으면
      이전 점검이력 연결을 해제해야 한다.
    */
    disposition:
      publishable &&
      items.length > 0
        ? "publish"
        : "purge",

    items:
      publishable
        ? items
        : []
  };
}

/* =========================================================
  Facility Navigator 점검이력 서버 간 전송

  업무일지 서버 환경변수:
  - FACILITY_NAVIGATOR_SYNC_URL
  - FACILITY_NAVIGATOR_SYNC_SECRET

  전용 수신 주소:
  - /api/shift-log-inspection-sync

  저장된 업무일지 전체를 컨테이너 스냅샷으로 전송한다.
  publish는 현재 전체 항목을 보내고,
  purge는 items: []로 해당 업무일지의 연동 주장을 제거한다.
========================================================= */

const NAVIGATOR_INSPECTION_SYNC_SCHEMA_VERSION = 1;
const NAVIGATOR_INSPECTION_SYNC_TIMEOUT_MS = 7000;
const NAVIGATOR_INSPECTION_SYNC_MAX_ATTEMPTS = 2;

const NAVIGATOR_INSPECTION_SYNC_RETRY_STATUS_CODES =
  new Set([
    408,
    425,
    429,
    500,
    502,
    503,
    504
  ]);


/* =========================================================
  Navigator revision 정규화
========================================================= */

function normalizeNavigatorInspectionSyncRevision(
  value
) {
  const revision =
    Number(
      value
    );


  return (
    Number.isInteger(
      revision
    ) &&
    revision > 0
  )
    ? revision
    : null;
}


/* =========================================================
  Navigator 전송 사유 정규화
========================================================= */

function normalizeNavigatorInspectionSyncTrigger(
  value
) {
  return (
    normalizeText(
      value ||
      "realtime"
    )
      .toLowerCase()
      .replace(
        /[^a-z0-9_-]/g,
        ""
      )
      .slice(
        0,
        40
      ) ||
    "realtime"
  );
}


/* =========================================================
  Navigator 연동 환경변수 확인
========================================================= */

function getNavigatorInspectionSyncConfig(
  context
) {
  const endpoint =
    normalizeText(
      context
        ?.env
        ?.FACILITY_NAVIGATOR_SYNC_URL
    );


  const secret =
    normalizeText(
      context
        ?.env
        ?.FACILITY_NAVIGATOR_SYNC_SECRET
    );


  if (
    !endpoint ||
    !secret
  ) {
    return {
      ok:
        false,

      reason:
        "not-configured",

      message:
        "Facility Navigator 연동 환경변수가 아직 등록되지 않았습니다."
    };
  }


  if (
    secret.length < 32
  ) {
    return {
      ok:
        false,

      reason:
        "weak-secret",

      message:
        "Facility Navigator 연동 비밀키는 32자 이상이어야 합니다."
    };
  }


  let parsedEndpoint;


  try {
    parsedEndpoint =
      new URL(
        endpoint
      );

  } catch {
    return {
      ok:
        false,

      reason:
        "invalid-endpoint",

      message:
        "Facility Navigator 연동 주소 형식이 올바르지 않습니다."
    };
  }


  const isLocalDevelopment =
    parsedEndpoint.protocol ===
      "http:" &&

    [
      "localhost",
      "127.0.0.1",
      "::1"
    ].includes(
      parsedEndpoint.hostname
    );


  if (
    parsedEndpoint.protocol !==
      "https:" &&
    !isLocalDevelopment
  ) {
    return {
      ok:
        false,

      reason:
        "insecure-endpoint",

      message:
        "Facility Navigator 연동 주소는 HTTPS여야 합니다."
    };
  }


  if (
    parsedEndpoint.username ||
    parsedEndpoint.password
  ) {
    return {
      ok:
        false,

      reason:
        "invalid-endpoint",

      message:
        "Facility Navigator 연동 주소에 사용자 정보가 포함되면 안 됩니다."
    };
  }


  return {
    ok:
      true,

    endpoint:
      parsedEndpoint
        .toString(),

    secret
  };
}


/* =========================================================
  Navigator 전송 이벤트 ID 생성
========================================================= */

async function createNavigatorInspectionSyncEventId(
  containerLogId,
  containerRevision
) {
  const identityText = [
    `v${NAVIGATOR_INSPECTION_SYNC_SCHEMA_VERSION}`,
    containerLogId,
    String(
      containerRevision
    )
  ].join(
    "\n"
  );


  const digest =
    await crypto.subtle.digest(
      "SHA-256",

      new TextEncoder()
        .encode(
          identityText
        )
    );


  return (
    "gssl-" +
    bytesToHex(
      new Uint8Array(
        digest
      )
    )
  );
}


/* =========================================================
  Navigator 전송 데이터 생성
========================================================= */

async function createNavigatorInspectionSyncPayload(
  log,
  options = {}
) {
  const selection =
    createNavigatorInspectionSyncSelection(
      log
    );


  const containerLogId =
    normalizeText(
      selection
        .containerLogId
    );


  const containerRevision =
    normalizeNavigatorInspectionSyncRevision(
      options
        .containerRevision ??
      log
        ?.serverRevision
    );


  if (
    !containerLogId ||
    containerRevision ===
      null
  ) {
    return {
      ok:
        false,

      reason:
        "invalid-log",

      message:
        "연동할 업무일지 ID 또는 서버 revision을 확인할 수 없습니다."
    };
  }


  const disposition =
    options.forcePurge ===
      true
        ? "purge"
        : selection.disposition;


  const items =
    disposition ===
      "publish" &&
    Array.isArray(
      selection.items
    )
      ? selection.items
      : [];


  const eventId =
    await createNavigatorInspectionSyncEventId(
      containerLogId,
      containerRevision
    );


  return {
    ok:
      true,

    payload: {
      schemaVersion:
        NAVIGATOR_INSPECTION_SYNC_SCHEMA_VERSION,

      eventType:
        "inspection-history.container-snapshot",

      sourceSystem:
        "gs-shift-log",

      eventId,

      operation:
        "replace-container-snapshot",

      disposition,

      container: {
        logId:
          containerLogId,

        revision:
          containerRevision,

        role:
          normalizeLogRole(
            log?.role
          ),

        status:
          normalizeStatus(
            log?.status
          ),

        deleted:
          options.deleted ===
            true,

        updatedAt:
          normalizeText(
            options
              .containerUpdatedAt ||
            log?.updatedAt ||
            log?.createdAt
          )
      },

      /*
        purge는 현재 남은 항목만 지우는 요청이 아니라
        이 업무일지가 과거에 연동한 전체 항목을 해제하는 요청이다.
      */
      items
    }
  };
}


/* =========================================================
  Navigator 전송 오류 생성
========================================================= */

function createNavigatorInspectionSyncError(
  message,
  status = 0,
  retryable = false
) {
  const error =
    new Error(
      message
    );


  error.status =
    status;

  error.retryable =
    retryable;


  return error;
}


/* =========================================================
  Navigator 재전송 대기
========================================================= */

function waitForNavigatorInspectionSyncRetry(
  attempt
) {
  const delayMs =
    250 *
    Math.max(
      1,
      Number(
        attempt
      ) ||
      1
    );


  return new Promise(
    resolve => {
      setTimeout(
        resolve,
        delayMs
      );
    }
  );
}


/* =========================================================
  Navigator 서버 전송
========================================================= */

async function postNavigatorInspectionSyncPayload(
  config,
  payload,
  bodyText,
  trigger
) {
  const abortController =
    new AbortController();


  const timeoutId =
    setTimeout(
      () => {
        abortController
          .abort();
      },

      NAVIGATOR_INSPECTION_SYNC_TIMEOUT_MS
    );


  const requestId =
    crypto.randomUUID();


  try {
    const response =
      await fetch(
        config.endpoint,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json; charset=utf-8",

            "Accept":
              "application/json",

            "Authorization":
              `Bearer ${config.secret}`,

            "Cache-Control":
              "no-store",

            "X-GS-Sync-Version":
              String(
                NAVIGATOR_INSPECTION_SYNC_SCHEMA_VERSION
              ),

            "X-GS-Sync-Request-Id":
              requestId,

            "X-GS-Sync-Trigger":
              trigger,

            "Idempotency-Key":
              payload.eventId
          },

          body:
            bodyText,

          signal:
            abortController.signal,

          /*
            다른 주소로 이동될 때
            Authorization 비밀키가 전달되지 않게 한다.
          */
          redirect:
            "error"
        }
      );


    const responseText =
      await response.text();


    let responseData =
      null;


    if (
      responseText
    ) {
      try {
        responseData =
          JSON.parse(
            responseText
          );

      } catch {
        responseData =
          null;
      }
    }


    if (
      !response.ok
    ) {
      throw createNavigatorInspectionSyncError(
        normalizeText(
          responseData?.message ||
          responseData?.error
        ) ||
        `Facility Navigator 연동 요청 실패 (HTTP ${response.status})`,

        response.status,

        NAVIGATOR_INSPECTION_SYNC_RETRY_STATUS_CODES
          .has(
            response.status
          )
      );
    }


    if (
      !responseData ||
      typeof responseData !==
        "object" ||
      Array.isArray(
        responseData
      ) ||
      responseData.ok !==
        true
    ) {
      throw createNavigatorInspectionSyncError(
        "Facility Navigator 연동 서버 응답 형식이 올바르지 않습니다.",

        502,

        true
      );
    }


    return {
      status:
        response.status,

      requestId,

      data:
        responseData
    };

  } catch (
    error
  ) {
    if (
      error?.name ===
        "AbortError"
    ) {
      throw createNavigatorInspectionSyncError(
        "Facility Navigator 연동 요청 시간이 초과되었습니다.",

        0,

        true
      );
    }


    if (
      typeof error?.retryable ===
        "boolean"
    ) {
      throw error;
    }


    throw createNavigatorInspectionSyncError(
      error instanceof
        Error
          ? error.message
          : "Facility Navigator 연동 네트워크 오류가 발생했습니다.",

      0,

      true
    );

  } finally {
    clearTimeout(
      timeoutId
    );
  }
}


/* =========================================================
  Facility Navigator 최종 서버 간 전송

  실시간 저장과 수동 최신화가 함께 사용한다.

  실패 결과를 반환하지만 예외는 던지지 않는다.
  실제 저장 흐름에서는 다음 단계에서
  context.waitUntil()로 호출한다.
========================================================= */

async function syncNavigatorInspectionHistory(
  context,
  log,
  options = {}
) {
  const config =
    getNavigatorInspectionSyncConfig(
      context
    );


  if (
    !config.ok
  ) {
    return {
      ok:
        false,

      skipped:
        true,

      reason:
        config.reason,

      message:
        config.message
    };
  }


  let payloadResult;


  try {
    payloadResult =
      await createNavigatorInspectionSyncPayload(
        log,
        options
      );

  } catch (
    error
  ) {
    return {
      ok:
        false,

      skipped:
        false,

      reason:
        "payload-error",

      message:
        error instanceof
          Error
            ? error.message
            : "Facility Navigator 연동 데이터를 만들지 못했습니다."
    };
  }


  if (
    !payloadResult.ok
  ) {
    return {
      ok:
        false,

      skipped:
        true,

      reason:
        payloadResult.reason,

      message:
        payloadResult.message
    };
  }


  const payload =
    payloadResult.payload;


  const trigger =
    normalizeNavigatorInspectionSyncTrigger(
      options.trigger
    );


  /*
    재시도해도 완전히 같은 본문과 eventId가
    전송되도록 JSON 문자열을 한 번만 만든다.
  */
  const bodyText =
    JSON.stringify(
      payload
    );


  let lastError =
    null;


  let attemptCount =
    0;


  for (
    let attempt = 1;
    attempt <=
      NAVIGATOR_INSPECTION_SYNC_MAX_ATTEMPTS;
    attempt += 1
  ) {
    attemptCount =
      attempt;


    try {
      const response =
        await postNavigatorInspectionSyncPayload(
          config,
          payload,
          bodyText,
          trigger
        );


      return {
        ok:
          true,

        skipped:
          false,

        eventId:
          payload.eventId,

        disposition:
          payload.disposition,

        containerLogId:
          payload.container.logId,

        containerRevision:
          payload.container.revision,

        itemCount:
          payload.items.length,

        attempts:
          attempt,

        requestId:
          response.requestId,

        status:
          response.status,

        result:
          response.data.result ||
          "applied"
      };

    } catch (
      error
    ) {
      lastError =
        error;


      const canRetry =
        error?.retryable ===
          true &&

        attempt <
          NAVIGATOR_INSPECTION_SYNC_MAX_ATTEMPTS;


      if (
        !canRetry
      ) {
        break;
      }


      await waitForNavigatorInspectionSyncRetry(
        attempt
      );
    }
  }


  const failureResult = {
    ok:
      false,

    skipped:
      false,

    reason:
      "request-failed",

    eventId:
      payload.eventId,

    disposition:
      payload.disposition,

    containerLogId:
      payload.container.logId,

    containerRevision:
      payload.container.revision,

    itemCount:
      payload.items.length,

    attempts:
      attemptCount,

    status:
      Number(
        lastError?.status
      ) ||
      0,

    retryable:
      lastError?.retryable ===
        true,

    message:
      lastError instanceof
        Error
          ? lastError.message
          : "Facility Navigator 점검이력 연동에 실패했습니다."
  };


  console.error(
    "Facility Navigator 점검이력 연동 실패:",
    failureResult
  );


  return failureResult;
}

/* =========================================================
  Facility Navigator 비동기 전송 예약

  Navigator 연동 실패가 업무일지 저장·수정·삭제
  응답에 영향을 주지 않도록 waitUntil로 분리한다.
========================================================= */

function scheduleNavigatorInspectionSync(
  context,
  log,
  options = {}
) {
  if (
    !context ||
    typeof context.waitUntil !==
      "function"
  ) {
    console.error(
      "Facility Navigator 연동 예약 실패: context.waitUntil()을 사용할 수 없습니다."
    );

    return;
  }


  /*
    실제 연동 함수에서 예상하지 못한 예외가 발생해도
    업무일지 요청에는 예외가 전달되지 않게 한다.
  */
  const syncTask =
    Promise.resolve()
      .then(
        () => {
          return syncNavigatorInspectionHistory(
            context,
            log,
            options
          );
        }
      )
      .catch(
        error => {
          console.error(
            "Facility Navigator 점검이력 비동기 연동 오류:",
            error
          );


          return {
            ok:
              false,

            skipped:
              false,

            reason:
              "unexpected-error",

            message:
              error instanceof
                Error
                  ? error.message
                  : "Facility Navigator 비동기 연동 중 오류가 발생했습니다."
          };
        }
      );


  try {
    context.waitUntil(
      syncTask
    );

  } catch (
    error
  ) {
    console.error(
      "Facility Navigator waitUntil 등록 오류:",
      error
    );
  }
}

/* =========================================================
  기존 업무일지 수정 가능 여부

  최고관리자:
  - 모든 상태 수정 가능

  파트장:
  - 본인의 파트장 업무일지만 가능
  - 임시저장 가능
  - 기존 저장완료 자료 호환
  - 결재완료는 먼저 결재취소

  일반 보직:
  - 임시저장 상태만 수정 가능
========================================================= */

function canEditExistingLog(
  existingLog,
  user
) {
  /*
    최고관리자는 모든 업무일지 수정 가능
  */
  if (
    user.isSuperAdmin
  ) {
    return true;
  }


  const logRole =
    normalizeLogRole(
      existingLog.role
    );


  const status =
    normalizeStatus(
      existingLog.status
    );


  const isAuthor =
    normalizeEmployeeNo(
      existingLog.authorId
    ) ===
      normalizeEmployeeNo(
        user.employeeNo
      );


  /*
    파트장 계정
  */
  if (
    user.role ===
      "admin"
  ) {
    return (
      logRole ===
        "파트장" &&

      isAuthor &&

      [
        "임시저장",
        "저장완료"
      ].includes(
        status
      )
    );
  }


  /*
    일반회원은 파트장 업무일지 수정 불가
  */
  if (
    logRole ===
      "파트장"
  ) {
    return false;
  }


  const editableMemberRoles = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ];


  return (
    editableMemberRoles.includes(
      logRole
    ) &&

    status ===
      "임시저장"
  );
}

function createConflictResponse(
  currentLog,
  message =
    "다른 사용자가 먼저 업무일지를 수정했습니다. 최신 내용을 다시 불러와 주세요."
) {
  return jsonResponse(
    {
      ok:
        false,
      conflict:
        true,
      message,
      currentLog
    },
    409
  );
}

/* =========================================================
  과거 업무일지의 원래 결재 상태 확인

  목적:
  - 브라우저에서 전달한 상태를 그대로 신뢰하지 않는다.
  - legacy_logs에 저장된 원래 상태를 서버에서 확인한다.
  - APPROVED 자료는 결재완료 상태로 이전한다.
========================================================= */

async function getTrustedLegacyMigrationStatus(
  database,
  log
) {
  if (
    !database ||
    !log ||
    typeof log !==
      "object"
  ) {
    return "";
  }


  const logId =
    normalizeText(
      log.id
    );


  /*
    우선 legacyDiaryId를 사용하고,
    없으면 legacy- 접두사가 붙은 ID에서 추출한다.
  */
  const legacyDiaryId =
    normalizeText(
      log.legacyDiaryId ||
      (
        logId.startsWith(
          "legacy-"
        )
          ? logId.slice(
              "legacy-".length
            )
          : ""
      )
    );


  if (
    !legacyDiaryId
  ) {
    return "";
  }


  const legacyRow =
    await database
      .prepare(`
        SELECT
          status

        FROM legacy_logs

        WHERE
          legacy_diary_id = ?

          AND work_date = ?

          AND shift = ?

          AND role = ?

        LIMIT 1
      `)
      .bind(
        legacyDiaryId,

        normalizeText(
          log.date
        ),

        normalizeShift(
          log.shift
        ),

        normalizeLogRole(
          log.role
        )
      )
      .first();


  if (
    !legacyRow
  ) {
    return "";
  }


  const rawStatus =
    normalizeText(
      legacyRow.status
    );


  /*
    legacy_logs에 현재 한글 상태값으로
    저장된 경우
  */
  const normalizedStatus =
    normalizeStatus(
      rawStatus
    );


  if (
    normalizedStatus
  ) {
    return normalizedStatus;
  }


  /*
    혹시 이전 버전 데이터에 영문 상태가
    남아 있는 경우까지 호환한다.
  */
  const legacyStatusMap = {
    APPROVED:
      "결재완료",

    SUBMITTED:
      "결재요청",

    REQUESTED:
      "결재요청",

    DRAFT:
      "임시저장",

    WRITING:
      "임시저장",

    REJECTED:
      "임시저장"
  };


  return (
    legacyStatusMap[
      rawStatus.toUpperCase()
    ] ||
    ""
  );
}

/* =========================================================
  신규 업무일지 생성 규칙 최종본

  일반 신규 작성:
  - 파트장: 임시저장
  - 파트원: 임시저장 또는 결재요청

  과거 업무일지 이전:
  - legacy_logs에 저장된 기존 상태 유지
========================================================= */

async function applyCreateRules(
  database,
  log,
  user,
  action,
  now
) {
  const isMigration =
    action ===
      "migrate";


  /*
    과거 업무일지인 경우
    서버의 legacy_logs에서 원래 상태를 확인한다.
  */
  const trustedMigrationStatus =
    isMigration
      ? await getTrustedLegacyMigrationStatus(
          database,
          log
        )
      : "";


  /* =====================================================
    작성자 결정
  ====================================================== */

  if (
    isMigration
  ) {
    const suppliedAuthorId =
      normalizeEmployeeNo(
        log.authorId ||
        log.writerId
      );


    const suppliedAuthor =
      normalizeText(
        log.author
      );


    if (
      !user.isSuperAdmin &&
      (
        (
          suppliedAuthorId &&
          suppliedAuthorId !==
            user.employeeNo
        ) ||
        (
          !suppliedAuthorId &&
          suppliedAuthor &&
          suppliedAuthor !==
            user.name
        )
      )
    ) {
      const error =
        new Error(
          "다른 작성자의 브라우저 자료는 이전할 수 없습니다."
        );


      error.status =
        403;


      throw error;
    }


    /*
      과거 원 작성자를 유지한다.
    */
    log.author =
      suppliedAuthor ||
      user.name;


    log.authorId =
      suppliedAuthorId ||
      user.employeeNo;


    log.authorRole =
      normalizeAccountRole(
        log.authorRole
      ) ||
      user.role;

  } else {
    /*
      새 업무일지는 현재 로그인 사용자가 작성자다.
    */
    log.author =
      user.name;


    log.authorId =
      user.employeeNo;


    log.authorRole =
      user.role;
  }


  /* =====================================================
    상태 결정
  ====================================================== */

  if (
    isMigration
  ) {
    /*
      과거 자료는 서버에서 확인한 기존 상태를 유지한다.
      확인되지 않는 경우 임시저장으로 처리한다.
    */
    log.status =
      trustedMigrationStatus ||
      "임시저장";

  } else if (
    log.role ===
      "파트장"
  ) {
    if (
      !(
        user.role ===
          "admin" ||
        user.isSuperAdmin
      )
    ) {
      const error =
        new Error(
          "파트장 또는 최고관리자만 파트장 업무일지를 작성할 수 있습니다."
        );


      error.status =
        403;


      throw error;
    }


    /*
      파트장 신규 업무일지도
      먼저 임시저장 상태로 생성한다.
    */
    log.status =
      "임시저장";

  } else if (
    ![
      "임시저장",
      "결재요청"
    ].includes(
      log.status
    )
  ) {
    log.status =
      "임시저장";
  }


  /* =====================================================
    생성·수정 정보
  ====================================================== */

  log.createdAt =
    isMigration &&
    normalizeText(
      log.createdAt
    )
      ? normalizeText(
          log.createdAt
        )
      : now;


  log.updatedAt =
    now;


  log.lastModifiedBy =
    user.name;


  log.lastModifiedById =
    user.employeeNo;


  log.lastModifiedByRole =
    user.role;


  log.source =
    "shared-d1";


  return log;
}

function applySaveRules(
  incomingLog,
  existingLog,
  user,
  now
) {
  if (
    !canEditExistingLog(
      existingLog,
      user
    )
  ) {
    const error =
      new Error(
        "현재 계정으로는 이 업무일지를 수정할 수 없습니다."
      );

    error.status =
      403;

    throw error;
  }


  const existingStatus =
    normalizeStatus(
      existingLog.status
    );


  const requestedStatus =
    normalizeStatus(
      incomingLog.status
    );


  const logRole =
    normalizeLogRole(
      existingLog.role
    );


  const isLeaderLog =
    logRole ===
      "파트장";


  const editableMemberRoles = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ];


  const isMemberLog =
    editableMemberRoles.includes(
      logRole
    );


  const isEditableMemberDraft =
    isMemberLog &&
    existingStatus ===
      "임시저장";


  const previousAuthorId =
    normalizeEmployeeNo(
      existingLog.authorId
    );


  const previousAuthorName =
    normalizeText(
      existingLog.author
    );


  const isDifferentAuthor =
    previousAuthorId
      ? previousAuthorId !==
          user.employeeNo
      : (
          previousAuthorName &&
          previousAuthorName !==
            user.name
        );


  const log = {
    ...incomingLog,

    id:
      existingLog.id,

    date:
      existingLog.date,

    shift:
      existingLog.shift,

    role:
      existingLog.role,

    team:
      incomingLog.team ||
      existingLog.team,

    createdAt:
      existingLog.createdAt,

    source:
      "shared-d1"
  };


  /*
    기존 최초 작성자 정보 유지
  */
  log.originalAuthor =
    existingLog.originalAuthor ||
    "";

  log.originalAuthorId =
    existingLog.originalAuthorId ||
    "";

  log.originalAuthorRole =
    existingLog.originalAuthorRole ||
    "";


  /*
    다른 사용자가 임시저장 일지를 이어서 저장하면
    기존 작성자를 최초 작성자로 보존한다.

    최고관리자도 동일하게 적용한다.
  */
  if (
    isEditableMemberDraft &&
    isDifferentAuthor
  ) {
    log.originalAuthor =
      log.originalAuthor ||
      existingLog.author ||
      "";

    log.originalAuthorId =
      log.originalAuthorId ||
      existingLog.authorId ||
      "";

    log.originalAuthorRole =
      log.originalAuthorRole ||
      existingLog.authorRole ||
      "";
  }


  /*
    일반 보직 임시저장 자료는
    실제 저장한 사용자를 현재 작성자로 변경한다.
  */
  if (
    isEditableMemberDraft
  ) {
    log.author =
      user.name;

    log.authorId =
      user.employeeNo;

    log.authorRole =
      user.role;

  } else {
    log.author =
      existingLog.author ||
      user.name;

    log.authorId =
      existingLog.authorId ||
      user.employeeNo;

    log.authorRole =
      existingLog.authorRole ||
      user.role;
  }


  /*
    파트장 업무일지는 일반 저장으로
    결재 상태를 변경하지 않는다.
  */
  if (
    isLeaderLog
  ) {
    log.status =
      existingStatus;


  /*
    일반 보직 임시저장은
    최고관리자 여부와 관계없이
    임시저장 또는 결재요청으로 전환한다.
  */
  } else if (
    isEditableMemberDraft
  ) {
    log.status =
      [
        "임시저장",
        "결재요청"
      ].includes(
        requestedStatus
      )
        ? requestedStatus
        : existingStatus;


  /*
    결재요청·결재완료 상태는
    일반 저장으로 변경하지 않는다.
  */
  } else {
    log.status =
      existingStatus;
  }


  log.lastModifiedBy =
    user.name;

  log.lastModifiedById =
    user.employeeNo;

  log.lastModifiedByRole =
    user.role;

  log.updatedAt =
    now;


  return log;
}

/* =========================================================
  업무일지 결재완료·결재취소 최종본

  파트원:
  - 결재요청 → 결재완료
  - 작성자 결재요청 취소
  - 파트장·최고관리자 결재완료 취소

  파트장:
  - 임시저장 → 결재완료
  - 기존 저장완료 → 결재완료
  - 결재완료 → 임시저장
========================================================= */

function applyApprovalAction(
  existingLog,
  user,
  action,
  now
) {
  const log = {
    ...existingLog
  };


  const previousStatus =
    normalizeStatus(
      existingLog.status
    );


  const logRole =
    normalizeLogRole(
      existingLog.role
    );


  const isLeaderOrSuperAdmin =
    user.role ===
      "admin" ||
    user.isSuperAdmin;


  const isAuthor =
    normalizeEmployeeNo(
      existingLog.authorId
    ) ===
      normalizeEmployeeNo(
        user.employeeNo
      );


  const memberRoles = [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ];


  const isMemberLog =
    memberRoles.includes(
      logRole
    );


  const isLeaderLog =
    logRole ===
      "파트장";


  /* =====================================================
    결재완료
  ====================================================== */

  if (
    action ===
      "approve"
  ) {
    /*
      파트원 업무일지 결재
    */
    const canApproveMemberLog =
      isMemberLog &&

      previousStatus ===
        "결재요청" &&

      isLeaderOrSuperAdmin;


    /*
      파트장 본인 업무일지 결재완료

      저장완료는 기존 자료 호환용이다.
    */
    const canCompleteLeaderLog =
      isLeaderLog &&

      [
        "임시저장",
        "저장완료"
      ].includes(
        previousStatus
      ) &&

      isLeaderOrSuperAdmin &&

      (
        isAuthor ||
        user.isSuperAdmin
      );


    if (
      !canApproveMemberLog &&
      !canCompleteLeaderLog
    ) {
      const error =
        new Error(
          isLeaderLog
            ? "본인의 임시저장 상태 파트장 업무일지만 결재완료할 수 있습니다."
            : "결재요청 상태의 파트원 업무일지만 결재할 수 있습니다."
        );


      error.status =
        isLeaderOrSuperAdmin
          ? 400
          : 403;


      throw error;
    }


    log.status =
      "결재완료";


    log.approvedAt =
      now;


    log.approvedBy =
      user.name;


    log.approvedById =
      user.employeeNo;


    log.approvedByRole =
      user.role;


    appendApprovalHistory(
      log,
      "결재완료",
      user,
      previousStatus,
      log.status,
      now
    );


  /* =====================================================
    결재취소
  ====================================================== */

  } else if (
    action ===
      "cancel"
  ) {
    /*
      파트원 본인의 결재요청 취소
    */
    const canAuthorCancelRequest =
      isMemberLog &&

      previousStatus ===
        "결재요청" &&

      isAuthor;


    /*
      파트장 또는 최고관리자의
      파트원 결재완료 취소
    */
    const canLeaderCancelCompletedMember =
      isMemberLog &&

      previousStatus ===
        "결재완료" &&

      isLeaderOrSuperAdmin;


    /*
      파트장 본인 일지 결재취소
    */
    const canCancelCompletedLeaderLog =
      isLeaderLog &&

      previousStatus ===
        "결재완료" &&

      isLeaderOrSuperAdmin &&

      (
        isAuthor ||
        user.isSuperAdmin
      );


    if (
      !canAuthorCancelRequest &&
      !canLeaderCancelCompletedMember &&
      !canCancelCompletedLeaderLog
    ) {
      const error =
        new Error(
          previousStatus ===
            "결재요청"
            ? "결재요청한 작성자 본인만 결재를 취소할 수 있습니다."
            : "현재 계정으로는 이 업무일지의 결재를 취소할 수 없습니다."
        );


      error.status =
        403;


      throw error;
    }


    /*
      결재취소 후 다시 임시저장으로 되돌린다.
    */
    log.status =
      "임시저장";


    delete log.approvedAt;

    delete log.approvedBy;

    delete log.approvedById;

    delete log.approvedByRole;


    log.approvalCancelledAt =
      now;


    log.approvalCancelledBy =
      user.name;


    log.approvalCancelledById =
      user.employeeNo;


    log.approvalCancelledFrom =
      previousStatus;


    appendApprovalHistory(
      log,
      "결재취소",
      user,
      previousStatus,
      log.status,
      now
    );


  } else {
    const error =
      new Error(
        "지원하지 않는 결재 작업입니다."
      );


    error.status =
      400;


    throw error;
  }


  /* =====================================================
    최종 수정 정보
  ====================================================== */

  log.lastModifiedBy =
    user.name;


  log.lastModifiedById =
    user.employeeNo;


  log.lastModifiedByRole =
    user.role;


  log.updatedAt =
    now;


  return log;
}


async function insertLog(
  database,
  log,
  user
) {
  const cleanLog =
    removeServerOnlyFields(
      log
    );

  await database
    .prepare(`
      INSERT INTO shift_logs (
        id,
        work_date,
        shift,
        role,
        team,
        author,
        author_id,
        author_role,
        status,
        log_json,
        revision,
        created_at,
        updated_at,
        last_modified_by,
        last_modified_by_id
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        1, ?, ?, ?, ?
      )
    `)
    .bind(
      cleanLog.id,
      cleanLog.date,
      cleanLog.shift,
      cleanLog.role,
      cleanLog.team,
      cleanLog.author,
      cleanLog.authorId,
      cleanLog.authorRole,
      cleanLog.status,
      JSON.stringify(
        cleanLog
      ),
      cleanLog.createdAt,
      cleanLog.updatedAt,
      user.name,
      user.employeeNo
    )
    .run();

  return findLogById(
    database,
    cleanLog.id
  );
}


async function updateLog(
  database,
  log,
  user,
  expectedRevision
) {
  const cleanLog =
    removeServerOnlyFields(
      log
    );

  const updateResult =
    await database
      .prepare(`
        UPDATE shift_logs
        SET
          team = ?,
          author = ?,
          author_id = ?,
          author_role = ?,
          status = ?,
          log_json = ?,
          revision =
            revision + 1,
          updated_at = ?,
          last_modified_by = ?,
          last_modified_by_id = ?
        WHERE
          id = ? AND
          revision = ?
      `)
      .bind(
        cleanLog.team,
        cleanLog.author,
        cleanLog.authorId,
        cleanLog.authorRole,
        cleanLog.status,
        JSON.stringify(
          cleanLog
        ),
        cleanLog.updatedAt,
        user.name,
        user.employeeNo,
        cleanLog.id,
        expectedRevision
      )
      .run();

  if (
    Number(
      updateResult?.meta?.changes ||
      0
    ) !==
      1
  ) {
    return null;
  }

  return findLogById(
    database,
    cleanLog.id
  );
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

    const url =
      new URL(
        context.request.url
      );

    const date =
      normalizeText(
        url.searchParams.get(
          "date"
        )
      );

    const from =
      normalizeText(
        url.searchParams.get(
          "from"
        )
      );

    const to =
      normalizeText(
        url.searchParams.get(
          "to"
        )
      );

    const shift =
      normalizeShift(
        url.searchParams.get(
          "shift"
        )
      );

    if (
      date &&
      !isValidIsoDate(
        date
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,
          message:
            "date 값이 올바르지 않습니다."
        },
        400
      );
    }

    if (
      from &&
      !isValidIsoDate(
        from
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,
          message:
            "from 값이 올바르지 않습니다."
        },
        400
      );
    }

    if (
      to &&
      !isValidIsoDate(
        to
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,
          message:
            "to 값이 올바르지 않습니다."
        },
        400
      );
    }

    let queryText = `
      SELECT
        *
      FROM shift_logs
      WHERE 1 = 1
    `;

    const bindValues = [];

    if (
      date
    ) {
      queryText += `
        AND work_date = ?
      `;

      bindValues.push(
        date
      );
    } else {
      if (
        from
      ) {
        queryText += `
          AND work_date >= ?
        `;

        bindValues.push(
          from
        );
      }

      if (
        to
      ) {
        queryText += `
          AND work_date <= ?
        `;

        bindValues.push(
          to
        );
      }
    }

    if (
      shift
    ) {
      queryText += `
        AND shift = ?
      `;

      bindValues.push(
        shift
      );
    }

    queryText += `
      ORDER BY
        work_date DESC,
        CASE shift
          WHEN 'NS' THEN 1
          WHEN 'DS' THEN 2
          ELSE 9
        END,
        CASE role
          WHEN '파트장' THEN 1
          WHEN 'TGO' THEN 2
          WHEN 'BCO1' THEN 3
          WHEN 'BCO2' THEN 4
          WHEN 'TO' THEN 5
          WHEN 'BO1' THEN 6
          WHEN 'BO2' THEN 7
          ELSE 99
        END
      LIMIT 10000
    `;

    const result =
      await context.env.DB
        .prepare(
          queryText
        )
        .bind(
          ...bindValues
        )
        .all();

    const logs =
      (
        Array.isArray(
          result.results
        )
          ? result.results
          : []
      ).map(
        convertRowToLog
      );

    return jsonResponse({
      ok:
        true,
      logs,
      totalCount:
        logs.length
    });

  } catch (error) {
    console.error(
      "공용 업무일지 조회 오류:",
      error
    );

    return jsonResponse(
      {
        ok:
          false,
        message:
          "공용 업무일지를 불러오는 중 오류가 발생했습니다.",
        error:
          String(
            error
          )
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


    const user =
      authentication.user;


    let body;


    try {
      body =
        await context.request.json();

    } catch {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "요청 데이터 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const action =
      normalizeText(
        body.action ||
        "save"
      )
        .toLowerCase();


    if (
      ![
        "save",
        "migrate",
        "approve",
        "cancel"
      ].includes(
        action
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "지원하지 않는 업무일지 작업입니다."
        },
        400
      );
    }


    const validation =
      validateLogInput(
        body.log
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


    const incomingLog =
      validation.log;


    const expectedRevision =
      Number(
        body.expectedRevision ??
        incomingLog.serverRevision ??
        0
      );


    let existingLog =
      await findLogById(
        context.env.DB,
        incomingLog.id
      );


    if (
      !existingLog
    ) {
      existingLog =
        await findLogByGroup(
          context.env.DB,
          incomingLog.date,
          incomingLog.shift,
          incomingLog.role
        );
    }


    if (
      existingLog &&
      action ===
        "migrate"
    ) {
      return createConflictResponse(
        existingLog,
        "이미 서버에 같은 날짜·근무·보직의 업무일지가 있습니다."
      );
    }


    const now =
      new Date()
        .toISOString();


    /* =====================================================
      신규 업무일지 생성
    ====================================================== */

    if (
      !existingLog
    ) {
      if (
        [
          "approve",
          "cancel"
        ].includes(
          action
        )
      ) {
        return jsonResponse(
          {
            ok:
              false,

            message:
              "상태를 변경할 업무일지를 찾을 수 없습니다."
          },
          404
        );
      }


      const createdLog =
        await applyCreateRules(
          context.env.DB,

          {
            ...incomingLog
          },

          user,

          action,

          now
        );


      try {
        const savedLog =
          await insertLog(
            context.env.DB,
            createdLog,
            user
          );


        /* =================================================
          Facility Navigator 점검이력 연동
        ================================================= */

        scheduleNavigatorInspectionSync(
          context,
          savedLog,
          {
            trigger:
              action ===
                "migrate"
                ? "migration-create"
                : "realtime-create",

            containerRevision:
              savedLog.serverRevision,

            containerUpdatedAt:
              savedLog.updatedAt
          }
        );


        /* =================================================
          석회석 입고기록 자동 동기화

          신규 업무일지가 D1에 저장되면
          결재 상태와 관계없이 바로 반영한다.

          대상 상태:
          - 임시저장
          - 결재요청
          - 결재완료
          - 저장완료
        ================================================= */

        const limestoneSync =
          await synchronizeLimestoneReceiptsForShiftContext(
            context,
            {
              workDate:
                savedLog.date,

              shift:
                savedLog.shift,

              user
            }
          );


        return jsonResponse(
          {
            ok:
              true,

            created:
              true,

            log:
              savedLog,

            limestoneSync
          },
          201
        );

      } catch (
        error
      ) {
        const currentLog =
          await findLogByGroup(
            context.env.DB,
            createdLog.date,
            createdLog.shift,
            createdLog.role
          );


        if (
          currentLog
        ) {
          return createConflictResponse(
            currentLog
          );
        }


        throw error;
      }
    }


    /* =====================================================
      기존 업무일지 revision 확인
    ====================================================== */

    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision <
        1 ||
      expectedRevision !==
        existingLog.serverRevision
    ) {
      return createConflictResponse(
        existingLog
      );
    }


    let nextLog;


    /* =====================================================
      일반 저장 또는 결재 상태 변경
    ====================================================== */

    if (
      action ===
        "save"
    ) {
      nextLog =
        applySaveRules(
          incomingLog,
          existingLog,
          user,
          now
        );

    } else {
      nextLog =
        applyApprovalAction(
          existingLog,
          user,
          action,
          now
        );
    }


    const savedLog =
      await updateLog(
        context.env.DB,
        nextLog,
        user,
        expectedRevision
      );


    if (
      !savedLog
    ) {
      const currentLog =
        await findLogById(
          context.env.DB,
          existingLog.id
        );


      return createConflictResponse(
        currentLog
      );
    }


    /* =====================================================
      Facility Navigator 점검이력 연동
    ====================================================== */

    scheduleNavigatorInspectionSync(
      context,
      savedLog,
      {
        trigger:
          `realtime-${action}`,

        containerRevision:
          savedLog.serverRevision,

        containerUpdatedAt:
          savedLog.updatedAt
      }
    );


    /* =====================================================
      석회석 입고기록 자동 동기화

      업무일지 저장·수정·결재·결재취소 후
      같은 날짜와 근무의 아래 보직을 다시 비교한다.

      1호기:
      BCO1 > BO1

      2호기:
      BCO2 > BO2
    ====================================================== */

    const limestoneSync =
      await synchronizeLimestoneReceiptsForShiftContext(
        context,
        {
          workDate:
            savedLog.date,

          shift:
            savedLog.shift,

          user
        }
      );


    return jsonResponse({
      ok:
        true,

      created:
        false,

      log:
        savedLog,

      limestoneSync
    });

  } catch (
    error
  ) {
    console.error(
      "공용 업무일지 저장 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "공용 업무일지 저장 중 오류가 발생했습니다."
      },
      Number(
        error?.status
      ) ||
      500
    );
  }
}


/* =========================================================
  업무일지 삭제 최종본

  처리:
  1. 로그인 및 삭제 권한 확인
  2. revision 충돌 확인
  3. 업무일지 D1 삭제
  4. Facility Navigator 점검이력 해제
  5. 같은 날짜·근무의 석회석 입고기록 재구성

  석회석 재구성 예:
  - BCO1 삭제 후 BO1 기록이 남아 있으면 BO1 자동 복구
  - BCO2 삭제 후 BO2 기록이 남아 있으면 BO2 자동 복구
  - 하위 보직까지 없으면 해당 자동기록 삭제
  - 직접 등록한 manual 기록은 유지
========================================================= */

export async function onRequestDelete(
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


    const user =
      authentication.user;


    const url =
      new URL(
        context.request.url
      );


    const id =
      normalizeText(
        url.searchParams.get(
          "id"
        )
      );


    const expectedRevision =
      Number(
        url.searchParams.get(
          "revision"
        )
      );


    /* =====================================================
      삭제 대상 ID 확인
    ====================================================== */

    if (
      !id
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "삭제할 업무일지 ID가 필요합니다."
        },
        400
      );
    }


    /* =====================================================
      삭제 대상 업무일지 조회
    ====================================================== */

    const existingLog =
      await findLogById(
        context.env.DB,
        id
      );


    if (
      !existingLog
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "삭제할 업무일지를 찾을 수 없습니다."
        },
        404
      );
    }


    /* =====================================================
      revision 충돌 확인
    ====================================================== */

    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision !==
        existingLog.serverRevision
    ) {
      return createConflictResponse(
        existingLog
      );
    }


    /* =====================================================
      삭제 권한

      최고관리자:
      - 모든 업무일지 삭제 가능

      일반 작성자:
      - 본인 임시저장 업무일지 삭제 가능

      파트장:
      - 본인 파트장 임시저장 업무일지 삭제 가능
      - 기존 저장완료 상태 호환
    ====================================================== */

    const isAuthor =
      normalizeEmployeeNo(
        existingLog.authorId
      ) ===
      normalizeEmployeeNo(
        user.employeeNo
      );


    const existingStatus =
      normalizeStatus(
        existingLog.status
      );


    const existingRole =
      normalizeLogRole(
        existingLog.role
      );


    const canDelete =
      user.isSuperAdmin ||

      (
        isAuthor &&
        existingStatus ===
          "임시저장"
      ) ||

      (
        isAuthor &&
        user.role ===
          "admin" &&
        existingRole ===
          "파트장" &&
        existingStatus ===
          "저장완료"
      );


    if (
      !canDelete
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "현재 계정으로는 이 업무일지를 삭제할 수 없습니다."
        },
        403
      );
    }


    /* =====================================================
      업무일지 실제 삭제
    ====================================================== */

    const deleteResult =
      await context.env.DB
        .prepare(`
          DELETE FROM shift_logs

          WHERE
            id = ?
            AND revision = ?
        `)
        .bind(
          id,
          expectedRevision
        )
        .run();


    if (
      Number(
        deleteResult?.meta?.changes ||
        0
      ) !==
        1
    ) {
      const currentLog =
        await findLogById(
          context.env.DB,
          id
        );


      return createConflictResponse(
        currentLog
      );
    }


    const deletedAt =
      new Date()
        .toISOString();


    /*
      삭제된 업무일지의 기존 revision보다
      1 높은 값을 삭제 이벤트 revision으로 사용한다.
    */
    const deletedRevision =
      expectedRevision +
      1;


    /* =====================================================
      Facility Navigator 점검이력 해제

      이 업무일지가 과거 전송했던
      점검이력 전체를 purge한다.
    ====================================================== */

    scheduleNavigatorInspectionSync(
      context,
      existingLog,
      {
        trigger:
          "realtime-delete",

        containerRevision:
          deletedRevision,

        containerUpdatedAt:
          deletedAt,

        deleted:
          true,

        forcePurge:
          true
      }
    );


    /* =====================================================
      석회석 입고기록 자동 재동기화

      삭제된 업무일지 ID도 조회 범위에 포함하여
      이 업무일지에서 만들어진 기존 자동기록을 찾는다.

      이후 같은 날짜·근무의 남은 업무일지를 다시 비교한다.

      1호기:
      BCO1 > BO1

      2호기:
      BCO2 > BO2
    ====================================================== */

    const limestoneSync =
      await synchronizeLimestoneReceiptsForShiftContext(
        context,
        {
          workDate:
            existingLog.date,

          shift:
            existingLog.shift,

          user,

          removedSourceLogIds: [
            existingLog.id
          ]
        }
      );


    return jsonResponse({
      ok:
        true,

      deletedId:
        id,

      limestoneSync
    });

  } catch (
    error
  ) {
    console.error(
      "공용 업무일지 삭제 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "공용 업무일지를 삭제하는 중 오류가 발생했습니다.",

        error:
          String(
            error
          )
      },
      Number(
        error?.status
      ) ||
      500
    );
  }
}