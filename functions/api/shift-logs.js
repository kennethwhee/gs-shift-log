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
  업무일지 상태별 연동 가능 여부
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
    파트장 업무일지는 저장완료 후 연동
  */
  if (
    role ===
      "파트장"
  ) {
    return (
      status ===
      "저장완료"
    );
  }


  /*
    파트원 업무일지는 결재완료 후 연동
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
  Navigator 점검이력 항목 생성
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


  const uniqueItems =
    new Map();


  /*
    entries와 분리 배열에 같은 과거 항목이
    중복 저장된 경우를 확인한다.
  */
  const legacyContentOwners =
    new Map();


  const storedEntryIds =
    new Set();


  collectNavigatorInspectionSourceEntries(
    log
  ).forEach(
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
      const sourceKey = [
        sourceLogId,
        sourceEntryId
      ].join(
        "||"
      );


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
      const legacyContentKey = [
        category,

        normalizeText(
          entry?.time
        ),

        tagNo,

        content.replace(
          /\s+/g,
          " "
        )
      ].join(
        "||"
      );


      const legacyOwnerCollection =
        legacyContentOwners.get(
          legacyContentKey
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
          legacyContentKey,
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
  - 파트장: 저장완료
  - 파트원: 임시저장 또는 결재요청

  과거 업무일지 이전:
  - legacy_logs에서 원래 상태를 서버가 직접 확인
  - 결재완료 자료는 결재완료 그대로 유지
  - 결재요청·임시저장도 원래 상태 그대로 유지
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
    과거 업무일지인 경우에만
    legacy_logs에서 신뢰할 수 있는 상태를 조회한다.
  */
  const trustedMigrationStatus =
    isMigration
      ? await getTrustedLegacyMigrationStatus(
          database,
          log
        )
      : "";


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


    /*
      최고관리자가 아닌 사용자는
      다른 작성자의 과거 자료를 이전할 수 없다.
    */
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
      과거 원 작성자를 그대로 유지한다.
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
      새로 작성한 업무일지는
      현재 로그인 사용자를 작성자로 저장한다.
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
    isMigration &&
    trustedMigrationStatus
  ) {
    /*
      과거 업무일지의 원래 상태를 그대로 유지한다.

      예:
      APPROVED  → 결재완료
      SUBMITTED → 결재요청
      DRAFT     → 임시저장
    */
    log.status =
      trustedMigrationStatus;

  } else if (
    log.role ===
      "파트장"
  ) {
    /*
      일반 신규 파트장 업무일지
    */
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

  } else {
    /*
      일반 신규 파트원 업무일지

      파트원은 새 작성 시
      임시저장 또는 결재요청만 가능하다.
    */
    const requestedStatus =
      normalizeStatus(
        log.status
      );


    log.status =
      [
        "임시저장",
        "결재요청"
      ].includes(
        requestedStatus
      )
        ? requestedStatus
        : "임시저장";
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
    이미 기록된 최초 작성자 정보는 유지한다.
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
    다른 사람이 일반 보직 일지를 이어서 저장하면
    변경 전 작성자를 최초 작성자로 보존한다.
  */
  if (
    !user.isSuperAdmin &&
    isMemberLog &&
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
    일반 보직 일지는 실제 저장한 사람을
    현재 작성자로 변경한다.
  */
  if (
    !user.isSuperAdmin &&
    isMemberLog
  ) {
    log.author =
      user.name;

    log.authorId =
      user.employeeNo;

    log.authorRole =
      user.role;

  /*
    파트장 일지와 최고관리자 수정에서는
    기존 작성자를 유지한다.
  */
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
    최고관리자 또는 파트장 일지는
    수정으로 상태를 변경하지 않는다.
  */
  if (
    user.isSuperAdmin ||
    isLeaderLog
  ) {
    log.status =
      existingStatus;

  /*
    일반 보직의 작성중 일지는
    임시저장 또는 결재요청으로 저장한다.
  */
  } else if (
    isMemberLog &&
    existingStatus ===
      "임시저장"
  ) {
    log.status =
      [
        "임시저장",
        "결재요청"
      ].includes(
        requestedStatus
      )
        ? requestedStatus
        : "임시저장";

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


  /*
    결재완료

    - 파트장 또는 최고관리자만 가능
    - 일반 보직의 결재요청 상태만 가능
  */
  if (
    action ===
      "approve"
  ) {
    if (
      !isLeaderOrSuperAdmin
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
      !isMemberLog ||
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


  /*
    결재취소

    결재요청 상태
    - 현재 작성자 본인만 취소 가능
    - 다른 일반회원은 취소 불가
    - 파트장·최고관리자도 취소 불가

    결재완료 상태
    - 파트장·최고관리자만 취소 가능
  */
  else if (
    action ===
      "cancel"
  ) {
    const canAuthorCancelRequest =
      isMemberLog &&
      previousStatus ===
        "결재요청" &&
      isAuthor;


    const canLeaderCancelCompleted =
      isMemberLog &&
      previousStatus ===
        "결재완료" &&
      isLeaderOrSuperAdmin;


    if (
      !canAuthorCancelRequest &&
      !canLeaderCancelCompleted
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


  else {
    const error =
      new Error(
        "지원하지 않는 결재 작업입니다."
      );

    error.status =
      400;

    throw error;
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
