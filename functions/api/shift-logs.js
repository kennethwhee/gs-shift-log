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


function canEditExistingLog(
  existingLog,
  user
) {
  if (
    user.isSuperAdmin
  ) {
    return true;
  }

  const isAuthor =
    normalizeEmployeeNo(
      existingLog.authorId
    ) ===
      user.employeeNo;

  if (
    !isAuthor
  ) {
    return false;
  }

  const status =
    normalizeStatus(
      existingLog.status
    );

  if (
    status ===
      "임시저장"
  ) {
    return true;
  }

  return (
    user.role ===
      "admin" &&
    normalizeLogRole(
      existingLog.role
    ) ===
      "파트장" &&
    status ===
      "저장완료"
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


function applyCreateRules(
  log,
  user,
  action,
  now
) {
  const isMigration =
    action ===
      "migrate";

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
    log.author =
      user.name;

    log.authorId =
      user.employeeNo;

    log.authorRole =
      user.role;
  }

  if (
    log.role ===
      "파트장"
  ) {
    if (
      user.role ===
        "admin" ||
      user.isSuperAdmin
    ) {
      log.status =
        "저장완료";
    } else {
      log.status =
        "임시저장";
    }

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

  if (
    user.isSuperAdmin
  ) {
    log.author =
      existingLog.author;

    log.authorId =
      existingLog.authorId;

    log.authorRole =
      existingLog.authorRole;

    log.status =
      normalizeStatus(
        existingLog.status
      );

    log.originalAuthor =
      existingLog.originalAuthor ||
      "";

    log.originalAuthorId =
      existingLog.originalAuthorId ||
      "";

    log.originalAuthorRole =
      existingLog.originalAuthorRole ||
      "";

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

    const existingStatus =
      normalizeStatus(
        existingLog.status
      );

    if (
      existingStatus ===
        "임시저장"
    ) {
      log.status =
        [
          "임시저장",
          "결재요청"
        ].includes(
          incomingLog.status
        )
          ? incomingLog.status
          : "임시저장";

    } else {
      log.status =
        existingStatus;
    }
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

  const isLeaderOrAdmin =
    user.role ===
      "admin" ||
    user.isSuperAdmin;

  const isAuthor =
    normalizeEmployeeNo(
      existingLog.authorId
    ) ===
      user.employeeNo;

  if (
    action ===
      "approve"
  ) {
    if (
      !isLeaderOrAdmin
    ) {
      const error =
        new Error(
          "파트장 또는 최고관리자만 결재할 수 있습니다."
        );

      error.status =
        403;

      throw error;
    }

    if (
      existingLog.role ===
        "파트장" ||
      previousStatus !==
        "결재요청"
    ) {
      const error =
        new Error(
          "결재요청 상태의 파트원 업무일지만 결재할 수 있습니다."
        );

      error.status =
        400;

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
  }

  if (
    action ===
      "cancel"
  ) {
    const canCancel =
      (
        isLeaderOrAdmin &&
        [
          "결재요청",
          "결재완료"
        ].includes(
          previousStatus
        )
      ) ||
      (
        isAuthor &&
        previousStatus ===
          "결재요청"
      );

    if (
      existingLog.role ===
        "파트장" ||
      !canCancel
    ) {
      const error =
        new Error(
          "현재 계정으로는 이 업무일지의 결재를 취소할 수 없습니다."
        );

      error.status =
        403;

      throw error;
    }

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
        applyCreateRules(
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

        return jsonResponse(
          {
            ok:
              true,
            created:
              true,
            log:
              savedLog
          },
          201
        );

      } catch (error) {
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

    return jsonResponse({
      ok:
        true,
      created:
        false,
      log:
        savedLog
    });

  } catch (error) {
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

    const isAuthor =
      normalizeEmployeeNo(
        existingLog.authorId
      ) ===
        user.employeeNo;

    const canDelete =
      user.isSuperAdmin ||
      (
        isAuthor &&
        normalizeStatus(
          existingLog.status
        ) ===
          "임시저장"
      ) ||
      (
        isAuthor &&
        user.role ===
          "admin" &&
        existingLog.role ===
          "파트장" &&
        normalizeStatus(
          existingLog.status
        ) ===
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

    const deleteResult =
      await context.env.DB
        .prepare(`
          DELETE FROM shift_logs
          WHERE
            id = ? AND
            revision = ?
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

    return jsonResponse({
      ok:
        true,
      deletedId:
        id
    });

  } catch (error) {
    console.error(
      "공용 업무일지 삭제 오류:",
      error
    );

    return jsonResponse(
      {
        ok:
          false,
        message:
          "공용 업무일지를 삭제하는 중 오류가 발생했습니다.",
        error:
          String(
            error
          )
      },
      500
    );
  }
}
