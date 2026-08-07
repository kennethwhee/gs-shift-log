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

/* =========================================================
  신규 업무일지 실제 첨부파일 연결

  저장:
  - 실제 파일: R2 ATTACHMENTS
  - 파일 정보: D1 shift_log_attachments

  업무일지를 불러올 때
  log.attachments 배열에 실제 첨부파일 객체를 넣는다.
========================================================= */


/* =========================================================
  첨부파일 DB 행 → 화면용 객체
========================================================= */

function convertShiftLogAttachmentRow(
  row
) {
  if (
    !row ||
    typeof row !==
      "object"
  ) {
    return null;
  }


  const attachmentId =
    normalizeText(
      row.id
    );


  if (
    !attachmentId
  ) {
    return null;
  }


  const fileName =
    normalizeText(
      row.original_name
    ) ||
    "첨부파일";


  const fileUrl =
    `/api/shift-log-files?id=${encodeURIComponent(
      attachmentId
    )}`;


  return {
    id:
      attachmentId,

    attachmentId,

    logId:
      normalizeText(
        row.log_id
      ),

    name:
      fileName,

    fileName,

    storedName:
      normalizeText(
        row.stored_name
      ),

    mimeType:
      normalizeText(
        row.content_type
      ) ||
      "application/octet-stream",

    fileSize:
      Number(
        row.file_size ||
        0
      ),

    uploadedById:
      normalizeEmployeeNo(
        row.uploaded_by_id
      ),

    uploadedByName:
      normalizeText(
        row.uploaded_by_name
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    /*
      실제 파일 조회 주소
    */
    url:
      fileUrl,

    previewUrl:
      fileUrl,

    downloadUrl:
      `${fileUrl}&download=1`
  };
}


/* =========================================================
  여러 업무일지의 첨부파일 한 번에 조회

  이유:
  업무일지마다 SELECT를 따로 실행하면
  조회 건수가 많을 때 D1 요청이 지나치게 많아진다.

  업무일지 ID를 묶어서 조회한다.
========================================================= */

async function attachShiftLogAttachments(
  database,
  logs
) {
  const safeLogs =
    (
      Array.isArray(
        logs
      )
        ? logs
        : []
    )
      .filter(
        log => {
          return (
            log &&
            typeof log ===
              "object"
          );
        }
      );


  if (
    !database ||
    safeLogs.length ===
      0
  ) {
    return safeLogs;
  }


  const logIds = [
    ...new Set(
      safeLogs
        .map(
          log => {
            return normalizeText(
              log.id
            );
          }
        )
        .filter(
          Boolean
        )
    )
  ];


  if (
    logIds.length ===
      0
  ) {
    return safeLogs;
  }


  const attachmentMap =
    new Map(
      logIds.map(
        logId => {
          return [
            logId,
            []
          ];
        }
      )
    );


  try {
    /*
      D1 바인딩 개수를 줄이기 위해
      작은 묶음으로 나누어 조회한다.
    */
    const chunkSize =
      80;


    for (
      let startIndex = 0;
      startIndex <
        logIds.length;
      startIndex +=
        chunkSize
    ) {
      const currentLogIds =
        logIds.slice(
          startIndex,
          startIndex +
            chunkSize
        );


      const placeholders =
        currentLogIds
          .map(
            () => "?"
          )
          .join(
            ", "
          );


      /*
        특정 열 이름을 직접 나열하지 않는다.

        배포된 D1 첨부파일 테이블의
        열 구성이 조금 달라도 전체 업무일지 조회가
        함께 실패하지 않도록 한다.
      */
      const result =
        await database
          .prepare(`
            SELECT
              *

            FROM shift_log_attachments

            WHERE
              log_id IN (
                ${placeholders}
              )
          `)
          .bind(
            ...currentLogIds
          )
          .all();


      const rows =
        Array.isArray(
          result.results
        )
          ? result.results
          : [];


      rows.forEach(
        row => {
          const logId =
            normalizeText(
              row.log_id
            );


          const attachment =
            convertShiftLogAttachmentRow(
              row
            );


          if (
            !logId ||
            !attachment
          ) {
            return;
          }


          if (
            !attachmentMap.has(
              logId
            )
          ) {
            attachmentMap.set(
              logId,
              []
            );
          }


          attachmentMap
            .get(
              logId
            )
            .push(
              attachment
            );
        }
      );
    }

  } catch (
    error
  ) {
    /*
      shift_log_attachments 테이블이 아직 없거나
      테이블 열 구성이 다른 경우에도
      업무일지 본문은 정상적으로 반환한다.

      첨부파일 오류 때문에 홈페이지 전체가
      먹통이 되는 것을 막는 안전장치다.
    */
    console.warn(
      "업무일지 첨부파일 조회를 건너뜁니다:",
      error
    );


    return safeLogs.map(
      log => {
        return {
          ...log,

          attachments:
            Array.isArray(
              log.attachments
            )
              ? log.attachments
              : []
        };
      }
    );
  }


  return safeLogs.map(
    log => {
      return {
        ...log,

        attachments:
          attachmentMap.get(
            normalizeText(
              log.id
            )
          ) ||
          []
      };
    }
  );
}

/* =========================================================
  업무일지 1건 첨부파일 연결
========================================================= */

async function attachShiftLogAttachmentsToOne(
  database,
  log
) {
  if (
    !log
  ) {
    return null;
  }


  const attachedLogs =
    await attachShiftLogAttachments(
      database,
      [
        log
      ]
    );


  return (
    attachedLogs[0] ||
    log
  );
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

        WHERE
          id = ?

        LIMIT 1
      `)
      .bind(
        id
      )
      .first();


  if (
    !row
  ) {
    return null;
  }


  const log =
    convertRowToLog(
      row
    );


  return attachShiftLogAttachmentsToOne(
    database,
    log
  );
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
          work_date = ?
          AND shift = ?
          AND role = ?

        LIMIT 1
      `)
      .bind(
        date,
        shift,
        role
      )
      .first();


  if (
    !row
  ) {
    return null;
  }


  const log =
    convertRowToLog(
      row
    );


  return attachShiftLogAttachmentsToOne(
    database,
    log
  );
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
  점검주기표 업무일지 자동완료 서버 기준

  적용 대상:
  - 날짜가 명확하게 정해진 일간·주간·월간·분기 점검
  - 조건부 일정도 실제 수행 문구가 있으면 완료

  제외:
  - 교대근무 업무일지 자체
  - 타부서 참고 일정
  - 날짜가 정해지지 않은 매월 유동 일정
  - 수시 일정

  담당 보직:
  - 무관
  - 어떤 보직의 업무일지에서든 수행 문구가 있으면 인정
========================================================= */

const INSPECTION_AUTO_COMPLETION_DEFAULT_SCHEDULES = [
  {
    id:
      "daily-night-patrol",

    title:
      "야간 순찰 점검 일지",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-freeze-prevention",

    title:
      "동파방지 점검일지(동결, 동파 취약개소)",

    shifts: [
      "NS"
    ],

    conditional:
      true,

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-fbhe-vbelt",

    title:
      "FBHE, Seal Pot Blower V-Belt 상태 점검",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-suction-filter",

    title:
      "회전기기 Suction Filter 상태 점검",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-pump-strainer-dp",

    title:
      "6.9kV Pump Suction Strainer DP 점검",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-silo-co",

    title:
      "Day Silo(Bio, Coal) CO 수치 점검 (CO₂ Tank Level 점검)",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-air-pollution-dp",

    title:
      "대기오염방지시설 DP 점검 및 운전정보시스템 입력",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-bio-hopper",

    title:
      "Bio Hopper Bin 내부 점검 및 청소",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-bed-ash-discharge",

    title:
      "주보일러 연소실 Bed Ash 배출(4회/일)",

    shifts: [
      "DS",
      "NS"
    ],

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-boiler-air-comp",

    title:
      "Boiler Air Comp. #B&C 무부하 30분 운전",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "weekly-lng-system",

    title:
      "LNG System 점검",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },


  {
    id:
      "weekly-high-pressure-gas",

    title:
      "고압가스 저장시설 주간점검",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },


  {
    id:
      "weekly-soot-blower",

    title:
      "보일러 Soot Blower 점검",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },


  {
    id:
      "weekly-aux-air-comp",

    title:
      "Aux BLR Air-Comp 기동 Test 및 회전기기 Hand Turning",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        6
      ]
    }
  },


  {
    id:
      "weekly-bed-ash-screen",

    title:
      "Bed Ash Vibrating Screen 청소",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        2,
        5
      ]
    }
  },


  {
    id:
      "weekly-lime-slurry-flushing",

    title:
      "Lime Slurry Density Meter Flushing 및 Lime Slurry Feed Tank 상부 Screen 이물질 청소",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        4
      ]
    }
  },


  {
    id:
      "weekly-bed-ash-be",

    title:
      "Bed Ash Bucket Elevator 하부 점검(청소)",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        1
      ]
    }
  },


  {
    id:
      "weekly-bag-filter-offline",

    title:
      "Bag Filter Off-Line Mode 진행",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        2
      ]
    }
  },


  {
    id:
      "weekly-fly-ash-sampling",

    title:
      "Fly Ash Sampling",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        1
      ]
    }
  },


  {
    id:
      "weekly-sda-hopper-ash",

    title:
      "SDA Hopper Ash 배출(톤백 2개/회·호기)",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        2,
        5
      ]
    }
  },


  {
    id:
      "weekly-sda-return-line",

    title:
      "SDA Lime Slurry Return Line 점검",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        1,
        4
      ]
    }
  },


  {
    id:
      "weekly-silo-vent-velocity",

    title:
      "1,2호기 유기성고형연료 Silo Vent Line Duct 유속 측정",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },


  {
    id:
      "weekly-cooling-tower-damper",

    title:
      "냉각탑 Damper 작동 Test",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-extinguisher",

    title:
      "소화기 점검",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "monthlyDate",

      day:
        4
    }
  },


  {
    id:
      "monthly-emergency-generator",

    title:
      "비상발전기 기동 점검",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        3
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-main-boiler-rotation",

    title:
      "주보일러 회전기기 교체 점검",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        3
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-turbine-oil-gsc",

    title:
      "터빈/발전기 Oil&GSC계통 회전기기 교체운전 점검",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "monthlyWeek",

      months: [
        2,
        4,
        6,
        8,
        10,
        12
      ],

      weeks: [
        4
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-turbine-bop",

    title:
      "터빈/발전기 BOP계통, 보조보일러, HVAC 및 급탕 Sys. 회전기기 교체운전 점검",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        4
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-sda-atomizer-hours",

    title:
      "SDA Atomizer 가동 시간(Wheel 교체주기) 점검",

    shifts: [
      "NS"
    ],

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        2,
        4
      ],

      days: [
        5
      ]
    }
  },


  {
    id:
      "monthly-atomizer-wheel",

    title:
      "Atomizer Wheel 점검 및 Support Cone 부위 Cleaning TM발행",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        2
      ],

      days: [
        1
      ]
    }
  },


  {
    id:
      "monthly-silo-vent-filter",

    title:
      "Fly Ash Silo, Lime Silo 상부 Vent Filter/Fan 점검",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        2,
        4
      ],

      days: [
        5
      ]
    }
  },


  {
    id:
      "monthly-steam-unit-heater",

    title:
      "Steam Unit Heater(보일러, 터빈 etc) 점검",

    shifts: [
      "NS"
    ],

    conditional:
      true,

    rule: {
      type:
        "monthlyWeek",

      months: [
        12,
        1,
        2,
        3
      ],

      weeks: [
        4
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-service-air-drain",

    title:
      "동절기 Service Air Line 응축수 Drain",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "monthlyWeek",

      months: [
        12,
        1,
        2,
        3
      ],

      weeks: [
        1,
        3
      ],

      days: [
        6
      ]
    }
  },


  {
    id:
      "quarterly-co2-release",

    title:
      "CO2 구역별 방출 Test",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "monthlyWeek",

      months: [
        3,
        6,
        9,
        12
      ],

      weeks: [
        3
      ],

      days: [
        3
      ]
    }
  },


  {
    id:
      "other-bio-storage-silo",

    title:
      "Bio Storage silo 내부 육안 점검",

    shifts: [
      "DS"
    ],

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        3
      ],

      days: [
        5
      ]
    }
  }
];


/* =========================================================
  점검명별 업무일지 인식 문구

  같은 뜻의 약칭·영문·현장 표현을 묶는다.
========================================================= */

const INSPECTION_AUTO_COMPLETION_ALIASES = {
  "daily-night-patrol": [
    "야간 순찰",
    "야간 현장 순찰"
  ],

  "daily-freeze-prevention": [
    "동파 방지",
    "동파 취약",
    "동결 취약"
  ],

  "daily-fbhe-vbelt": [
    "FBHE V BELT",
    "FBHE A V BELT",
    "FBHE B V BELT",
    "FBHE C V BELT",
    "SEAL POT BLOWER V BELT",
    "FBHE 벨트"
  ],

  "daily-suction-filter": [
    "SUCTION FILTER",
    "흡입 FILTER",
    "흡입 필터"
  ],

  "daily-pump-strainer-dp": [
    "PUMP SUCTION STRAINER DP",
    "PUMP STRAINER DP",
    "BFP STRAINER DP",
    "MCWP STRAINER DP",
    "ACWP STRAINER DP",
    "COP STRAINER DP",
    "CCWP STRAINER DP",
    "펌프 STRAINER DP"
  ],

  "daily-silo-co": [
    "DAY SILO CO",
    "BIO SILO CO",
    "COAL SILO CO",
    "CO2 TANK LEVEL"
  ],

  "daily-air-pollution-dp": [
    "대기오염방지시설 DP",
    "운전정보시스템 입력"
  ],

  "daily-bio-hopper": [
    "BIO HOPPER BIN",
    "BIO HOPPER"
  ],

  "daily-bed-ash-discharge": [
    "BED ASH 배출",
    "BED ASH DISCHARGE"
  ],

  "daily-boiler-air-comp": [
    "BOILER AIR COMP",
    "BLR AIR COMP",
    "보일러 AIR COMP"
  ],

  "weekly-lng-system": [
    "LNG SYSTEM",
    "LNG 설비"
  ],

  "weekly-high-pressure-gas": [
    "고압가스 저장시설",
    "CO2 고압가스 저장시설",
    "고압가스 주간"
  ],

  "weekly-soot-blower": [
    "SOOT BLOWER",
    "매연 취입기"
  ],

  "weekly-aux-air-comp": [
    "AUX BLR AIR COMP",
    "AUX BOILER AIR COMP",
    "HAND TURNING"
  ],

  "weekly-bed-ash-screen": [
    "BED ASH VIBRATING SCREEN",
    "BED ASH SCREEN"
  ],

  "weekly-lime-slurry-flushing": [
    "LIME SLURRY DENSITY METER",
    "LIME SLURRY D M",
    "LIME SLURRY FLUSHING",
    "LIME SLURRY FEED TANK"
  ],

  "weekly-bed-ash-be": [
    "BED ASH BUCKET ELEVATOR",
    "BED ASH B E",
    "BE601"
  ],

  "weekly-bag-filter-offline": [
    "BAG FILTER OFF LINE",
    "BAG FILTER OFFLINE"
  ],

  "weekly-fly-ash-sampling": [
    "FLY ASH SAMPLING",
    "FLYASH SAMPLING"
  ],

  "weekly-sda-hopper-ash": [
    "SDA HOPPER ASH",
    "SDA HOPPER 배출"
  ],

  "weekly-sda-return-line": [
    "SDA LIME SLURRY RETURN",
    "SDA SLURRY RETURN"
  ],

  "weekly-silo-vent-velocity": [
    "SILO VENT LINE DUCT",
    "SILO VENT DUCT",
    "SILO VENT 유속"
  ],

  "weekly-cooling-tower-damper": [
    "냉각탑 DAMPER",
    "COOLING TOWER DAMPER"
  ],

  "monthly-extinguisher": [
    "소화기"
  ],

  "monthly-emergency-generator": [
    "비상발전기",
    "EMERGENCY GENERATOR"
  ],

  "monthly-main-boiler-rotation": [
    "주보일러 회전기기",
    "MAIN BOILER 회전기기"
  ],

  "monthly-turbine-oil-gsc": [
    "OIL GSC",
    "OIL&GSC",
    "터빈 발전기 OIL"
  ],

  "monthly-turbine-bop": [
    "터빈 발전기 BOP",
    "보조보일러 HVAC",
    "급탕 SYS 회전기기"
  ],

  "monthly-sda-atomizer-hours": [
    "SDA ATOMIZER 가동 시간",
    "ATOMIZER 가동 시간",
    "WHEEL 교체주기"
  ],

  "monthly-atomizer-wheel": [
    "ATOMIZER WHEEL",
    "SUPPORT CONE"
  ],

  "monthly-silo-vent-filter": [
    "FLY ASH SILO VENT FILTER",
    "LIME SILO VENT FILTER",
    "SILO VENT FILTER FAN"
  ],

  "monthly-steam-unit-heater": [
    "STEAM UNIT HEATER",
    "UNIT HEATER"
  ],

  "monthly-service-air-drain": [
    "SERVICE AIR LINE",
    "SERVICE AIR 응축수"
  ],

  "quarterly-co2-release": [
    "CO2 구역별 방출",
    "CO2 방출 TEST"
  ],

  "other-bio-storage-silo": [
    "BIO STORAGE SILO",
    "BIO 저장 SILO"
  ]
};


/* =========================================================
  실제 수행 문구

  아래 단어가 있어야 자동 완료 후보가 된다.
========================================================= */

const INSPECTION_AUTO_COMPLETION_ACTION_PATTERN =
  /(점검|확인|청소|세척|FLUSHING|플러싱|측정|TEST|시험|기동|가동|운전|배출|DISCHARGE|SAMPLING|DRAIN|드레인|교체|HAND\s*TURNING|OFF\s*LINE|입력|실시|시행|완료|진행|작동|정상|양호|이상\s*없음|이상없음)/i;


/* =========================================================
  확실한 수행 완료 문구

  예:
  - 점검 실시
  - 청소 완료
  - 측정함
  - 정상 확인
  - 이상 없음
========================================================= */

const INSPECTION_AUTO_COMPLETION_DEFINITE_PATTERN =
  /((점검|확인|청소|세척|측정|TEST|시험|기동|가동|운전|배출|DISCHARGE|SAMPLING|DRAIN|드레인|교체|HAND\s*TURNING|FLUSHING|플러싱)(?:을|를)?\s*(실시|시행|완료|함)|정상\s*확인|작동\s*확인|이상\s*없음|이상없음|양호)/i;


/* =========================================================
  완료로 처리하지 않는 문구

  예:
  - 점검 예정
  - 청소 필요
  - 점검 요청
  - 미실시
  - 작업 불가

  단, "점검 완료 후 정비 요청"처럼
  실제 완료가 명확하면 완료를 우선한다.
========================================================= */

const INSPECTION_AUTO_COMPLETION_NEGATIVE_PATTERN =
  /(미실시|미완료|미점검|미확인|못함|불가|보류|취소|예정|계획|요청|필요|대기|준비\s*중|작업\s*전|점검\s*전)/i;


/* =========================================================
  점검명 자동 비교 시 제외할 일반 단어
========================================================= */

const INSPECTION_AUTO_COMPLETION_TITLE_STOP_WORDS =
  new Set([
    "점검",
    "일지",
    "상태",
    "내부",
    "외부",
    "부위",
    "구역별",
    "주간",
    "일일",
    "매일",
    "매주",
    "매월",
    "기동",
    "작동",
    "운전",
    "진행",
    "청소",
    "측정",
    "TEST",
    "시험",
    "실시",
    "시행",
    "완료",
    "교체",
    "교체운전",
    "가동",
    "시간",
    "상부",
    "하부",
    "수치",
    "LINE",
    "MODE",
    "SYSTEM",
    "SYS",
    "및",
    "부",
    "회전기기"
  ]);

/* =========================================================
  점검주기표 자동완료 날짜·문구 비교

  기능:
  - 화면과 동일한 월 주차 계산
  - 해당 날짜의 점검 일정 선별
  - D/S·N/S 근무 확인
  - 관리자 수정·추가·사용 중지 일정 반영
  - 모든 보직의 업무내용 수집
  - 실제 수행 문구만 완료 후보로 판정
  - 이전 근무에서 자동으로 가져온 내용은 제외

  이 단계에서는 완료 후보만 만든다.
  실제 D1 완료 기록 생성·수정·삭제는 다음 단계에서 연결한다.
========================================================= */


/* =========================================================
  점검명·업무내용 비교용 문자열 정리

  예:
  - CO₂ → CO2
  - Oil&GSC → OIL GSC
  - Off-Line → OFF LINE
  - 여러 공백 → 한 칸
========================================================= */

function normalizeInspectionAutoCompletionText(
  value
) {
  return String(
    value ??
    ""
  )
    .normalize(
      "NFKC"
    )
    .replace(
      /[\u200B-\u200D\u2060\uFEFF]/g,
      ""
    )
    .toUpperCase()
    .replace(
      /[^0-9A-Z가-힣]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


/*
  점검명에서 제외할 일반 단어도
  동일한 방식으로 미리 정리한다.
*/
const INSPECTION_AUTO_COMPLETION_NORMALIZED_STOP_WORDS =
  new Set(
    [
      ...INSPECTION_AUTO_COMPLETION_TITLE_STOP_WORDS
    ]
      .map(
        normalizeInspectionAutoCompletionText
      )
      .filter(
        Boolean
      )
  );


/* =========================================================
  서버용 날짜 생성

  UTC 날짜를 사용하여
  Cloudflare 서버 시간대에 따른 날짜 밀림을 방지한다.
========================================================= */

function createInspectionAutoCompletionDate(
  value
) {
  const text =
    normalizeText(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  ) {
    return null;
  }


  const [
    year,
    month,
    day
  ] =
    text
      .split(
        "-"
      )
      .map(
        Number
      );


  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );


  return (
    date.getUTCFullYear() ===
      year &&
    date.getUTCMonth() ===
      month - 1 &&
    date.getUTCDate() ===
      day
  )
    ? date
    : null;
}


/* =========================================================
  월 주차 계산

  화면 점검주기표와 같은 기준:

  - 월 1일이 일~금요일이면 해당 주를 첫째 주
  - 월 1일이 토요일이면 다음 일요일부터 첫째 주
========================================================= */

function getInspectionAutoCompletionWeekOfMonth(
  dateValue
) {
  const date =
    createInspectionAutoCompletionDate(
      dateValue
    );


  if (
    !date
  ) {
    return 0;
  }


  const year =
    date.getUTCFullYear();


  const monthIndex =
    date.getUTCMonth();


  const firstDay =
    new Date(
      Date.UTC(
        year,
        monthIndex,
        1
      )
    );


  let firstWeekStart;


  /*
    1일이 토요일이면
    다음 날인 2일부터 첫째 주
  */
  if (
    firstDay.getUTCDay() ===
      6
  ) {
    firstWeekStart =
      new Date(
        Date.UTC(
          year,
          monthIndex,
          2
        )
      );

  } else {
    /*
      1일이 일~금요일이면
      1일이 포함된 일요일부터 첫째 주
    */
    firstWeekStart =
      new Date(
        Date.UTC(
          year,
          monthIndex,
          1 -
            firstDay.getUTCDay()
        )
      );
  }


  const currentWeekStart =
    new Date(
      Date.UTC(
        year,
        monthIndex,
        date.getUTCDate() -
          date.getUTCDay()
      )
    );


  return (
    Math.floor(
      (
        currentWeekStart.getTime() -
        firstWeekStart.getTime()
      ) /
      604800000
    ) +
    1
  );
}


/* =========================================================
  적용 월 확인

  예:
  - 동절기: 12·1·2·3월
  - 분기: 3·6·9·12월
  - 짝수월: 2·4·6·8·10·12월
========================================================= */

function isInspectionAutoCompletionActiveInMonth(
  scheduleItem,
  monthNumber
) {
  const months =
    Array.isArray(
      scheduleItem
        ?.rule
        ?.months
    )
      ? scheduleItem.rule.months
          .map(
            Number
          )
          .filter(
            Number.isInteger
          )
      : [];


  return (
    months.length ===
      0 ||
    months.includes(
      Number(
        monthNumber
      )
    )
  );
}


/* =========================================================
  해당 날짜에 실행할 점검인지 확인
========================================================= */

function isInspectionAutoCompletionDueOnDate(
  scheduleItem,
  dateValue
) {
  const date =
    createInspectionAutoCompletionDate(
      dateValue
    );


  const rule =
    scheduleItem
      ?.rule;


  if (
    !date ||
    !rule ||
    typeof rule !==
      "object"
  ) {
    return false;
  }


  const monthNumber =
    date.getUTCMonth() +
    1;


  const weekday =
    date.getUTCDay();


  if (
    !isInspectionAutoCompletionActiveInMonth(
      scheduleItem,
      monthNumber
    )
  ) {
    return false;
  }


  const ruleType =
    normalizeText(
      rule.type
    );


  /*
    매일
  */
  if (
    ruleType ===
      "daily"
  ) {
    return true;
  }


  /*
    지정 요일
  */
  if (
    [
      "weekdays",
      "weekly"
    ].includes(
      ruleType
    )
  ) {
    return (
      Array.isArray(
        rule.days
      ) &&
      rule.days
        .map(
          Number
        )
        .includes(
          weekday
        )
    );
  }


  /*
    매월 지정 날짜
  */
  if (
    ruleType ===
      "monthlyDate"
  ) {
    return (
      date.getUTCDate() ===
      Number(
        rule.day
      )
    );
  }


  /*
    매월 지정 주차·요일
  */
  if (
    ruleType ===
      "monthlyWeek"
  ) {
    const weekNumber =
      getInspectionAutoCompletionWeekOfMonth(
        dateValue
      );


    return (
      Array.isArray(
        rule.weeks
      ) &&
      rule.weeks
        .map(
          Number
        )
        .includes(
          weekNumber
        ) &&

      Array.isArray(
        rule.days
      ) &&
      rule.days
        .map(
          Number
        )
        .includes(
          weekday
        )
    );
  }


  /*
    monthlyFloating·adHoc처럼
    정확한 예정일이 없는 일정은 자동완료하지 않는다.
  */
  return false;
}


/* =========================================================
  일정의 완료 대상 근무 확인

  반환:
  - "DS"
  - "NS"
  - ""    : 별도 근무 지정 없음
  - null  : 현재 업무일지 근무와 다른 일정
========================================================= */

function getInspectionAutoCompletionDueShift(
  scheduleItem,
  workShift
) {
  const normalizedWorkShift =
    normalizeShift(
      workShift
    );


  const scheduleShifts =
    [
      ...new Set(
        (
          Array.isArray(
            scheduleItem?.shifts
          )
            ? scheduleItem.shifts
            : []
        )
          .map(
            normalizeShift
          )
          .filter(
            Boolean
          )
      )
    ];


  /*
    근무가 지정되지 않은 일정은
    완료 기록에도 빈 근무값을 사용한다.
  */
  if (
    scheduleShifts.length ===
      0
  ) {
    return "";
  }


  return scheduleShifts.includes(
    normalizedWorkShift
  )
    ? normalizedWorkShift
    : null;
}


/* =========================================================
  D1 점검 일정 JSON 읽기
========================================================= */

function parseInspectionAutoCompletionScheduleJson(
  value
) {
  const parsed =
    parseJsonObject(
      value
    );


  return (
    parsed &&
    typeof parsed ===
      "object" &&
    !Array.isArray(
      parsed
    )
  )
    ? parsed
    : {};
}


/* =========================================================
  서버의 실제 점검주기표 생성

  기본 일정:
  - 앞 단계에서 추가한
    INSPECTION_AUTO_COMPLETION_DEFAULT_SCHEDULES

  관리자 변경:
  - inspection_schedule_overrides
  - 활성 변경 일정은 기본 일정 교체
  - 사용 중지 일정은 제거
  - 사용자 추가 일정은 새로 포함
========================================================= */

async function loadInspectionAutoCompletionEffectiveSchedules(
  database
) {
  const effectiveScheduleMap =
    new Map();


  /*
    서버 기본 일정 복사
  */
  INSPECTION_AUTO_COMPLETION_DEFAULT_SCHEDULES
    .forEach(
      scheduleItem => {
        const id =
          normalizeText(
            scheduleItem?.id
          );


        if (
          !id
        ) {
          return;
        }


        effectiveScheduleMap.set(
          id,

          JSON.parse(
            JSON.stringify(
              scheduleItem
            )
          )
        );
      }
    );


  try {
    const result =
      await database
        .prepare(`
          SELECT
            id,
            schedule_json,
            is_active,
            is_custom

          FROM inspection_schedule_overrides
        `)
        .all();


    const rows =
      Array.isArray(
        result.results
      )
        ? result.results
        : [];


    rows.forEach(
      row => {
        const id =
          normalizeText(
            row.id
          );


        if (
          !id
        ) {
          return;
        }


        /*
          사용 중지된 기본·추가 일정 제거
        */
        if (
          Number(
            row.is_active
          ) !==
            1
        ) {
          effectiveScheduleMap.delete(
            id
          );


          return;
        }


        const scheduleItem =
          parseInspectionAutoCompletionScheduleJson(
            row.schedule_json
          );


        if (
          !normalizeText(
            scheduleItem.id ||
            id
          ) ||
          !normalizeText(
            scheduleItem.title
          )
        ) {
          return;
        }


        /*
          수정된 기본 일정 또는 사용자 추가 일정 반영
        */
        effectiveScheduleMap.set(
          id,

          {
            ...scheduleItem,

            id,

            autoCompletionIsCustom:
              Number(
                row.is_custom
              ) ===
              1
          }
        );
      }
    );

  } catch (
    error
  ) {
    const message =
      String(
        error?.message ||
        error ||
        ""
      );


    /*
      점검 일정 관리 API가 아직 한 번도 실행되지 않아
      테이블이 없는 경우에는 기본 일정만 사용한다.
    */
    if (
      !/no such table/i.test(
        message
      )
    ) {
      console.warn(
        "점검 자동완료 일정 변경사항 조회 실패:",
        error
      );
    }
  }


  return [
    ...effectiveScheduleMap.values()
  ];
}


/* =========================================================
  해당 날짜·근무의 점검 일정 선별
========================================================= */

function getInspectionAutoCompletionDueSchedules(
  schedules,
  workDate,
  workShift
) {
  return (
    Array.isArray(
      schedules
    )
      ? schedules
      : []
  )
    .filter(
      scheduleItem => {
        return (
          normalizeText(
            scheduleItem?.id
          ) &&

          /*
            업무일지 자체는 자동완료 대상 제외
          */
          scheduleItem.id !==
            "daily-shift-log" &&

          /*
            타부서 참고 일정 제외
          */
          scheduleItem.referenceOnly !==
            true &&

          isInspectionAutoCompletionDueOnDate(
            scheduleItem,
            workDate
          ) &&

          getInspectionAutoCompletionDueShift(
            scheduleItem,
            workShift
          ) !==
            null
        );
      }
    )
    .map(
      scheduleItem => {
        return {
          ...scheduleItem,

          dueShift:
            getInspectionAutoCompletionDueShift(
              scheduleItem,
              workShift
            )
        };
      }
    );
}


/* =========================================================
  점검명에서 비교 토큰 추출

  예:
  Bed Ash Vibrating Screen 청소
  → BED, ASH, VIBRATING, SCREEN
========================================================= */

function getInspectionAutoCompletionTitleTokens(
  scheduleItem
) {
  const normalizedTitle =
    normalizeInspectionAutoCompletionText(
      scheduleItem?.title
    );


  return [
    ...new Set(
      normalizedTitle
        .split(
          " "
        )
        .map(
          token => {
            return token.trim();
          }
        )
        .filter(
          token => {
            return (
              token.length >=
                2 &&

              !/^[0-9]+$/.test(
                token
              ) &&

              !INSPECTION_AUTO_COMPLETION_NORMALIZED_STOP_WORDS
                .has(
                  token
                )
            );
          }
        )
    )
  ];
}


/* =========================================================
  일정별 별칭 목록 생성
========================================================= */

function getInspectionAutoCompletionAliases(
  scheduleItem
) {
  const scheduleId =
    normalizeText(
      scheduleItem?.id
    );


  const aliases =
    Array.isArray(
      INSPECTION_AUTO_COMPLETION_ALIASES[
        scheduleId
      ]
    )
      ? INSPECTION_AUTO_COMPLETION_ALIASES[
          scheduleId
        ]
      : [];


  const titleKeyword =
    normalizeText(
      scheduleItem?.titleKeyword
    );


  return [
    ...new Set(
      [
        ...aliases,
        titleKeyword
      ]
        .map(
          normalizeInspectionAutoCompletionText
        )
        .filter(
          Boolean
        )
    )
  ];
}


/* =========================================================
  실제 수행 문구 확인

  완료 인정:
  - 점검 실시
  - 청소 완료
  - Bed Ash 배출
  - Soot Blower 실시
  - 정상 확인
  - 이상 없음

  완료 제외:
  - 점검 예정
  - 청소 필요
  - 교체 요청
  - 미실시
  - 작업 불가

  한 문장 안에 확실한 완료 문구가 있으면
  예정·요청 단어가 함께 있어도 완료를 우선한다.
========================================================= */

function hasInspectionAutoCompletionExecutionText(
  value
) {
  const text =
    normalizeText(
      value
    );


  if (
    !text ||
    !INSPECTION_AUTO_COMPLETION_ACTION_PATTERN.test(
      text
    )
  ) {
    return false;
  }


  const definite =
    INSPECTION_AUTO_COMPLETION_DEFINITE_PATTERN.test(
      text
    );


  const negative =
    INSPECTION_AUTO_COMPLETION_NEGATIVE_PATTERN.test(
      text
    );


  return (
    definite ||
    !negative
  );
}


/* =========================================================
  업무내용 1건과 점검 일정 비교

  우선순위:
  1. 등록된 별칭
  2. 일정의 titleKeyword
  3. 사용자 추가 일정은 점검명 주요 토큰 비교

  기본 일정은 유사한 설비끼리 오인식하지 않도록
  별칭이 등록된 경우 토큰 비교로 넘어가지 않는다.
========================================================= */

function findInspectionAutoCompletionTextMatch(
  scheduleItem,
  sourceText
) {
  const rawText =
    normalizeText(
      sourceText
    );


  if (
    !hasInspectionAutoCompletionExecutionText(
      rawText
    )
  ) {
    return null;
  }


  const normalizedText =
    normalizeInspectionAutoCompletionText(
      rawText
    );


  if (
    !normalizedText
  ) {
    return null;
  }


  const aliases =
    getInspectionAutoCompletionAliases(
      scheduleItem
    );


  const matchedAlias =
    aliases.find(
      alias => {
        return normalizedText.includes(
          alias
        );
      }
    ) ||
    "";


  if (
    matchedAlias
  ) {
    return {
      matchType:
        "alias",

      matchedKeyword:
        matchedAlias,

      score:
        100
    };
  }


  /*
    기본 일정의 별칭이 존재하지만
    별칭이 맞지 않으면 다른 일정으로 판단한다.
  */
  if (
    aliases.length >
      0 &&
    scheduleItem
      ?.autoCompletionIsCustom !==
      true
  ) {
    return null;
  }


  /*
    사용자 추가 일정 또는 별칭이 없는 일정은
    점검명의 핵심 단어를 비교한다.
  */
  const titleTokens =
    getInspectionAutoCompletionTitleTokens(
      scheduleItem
    );


  if (
    titleTokens.length ===
      0
  ) {
    return null;
  }


  const sourceTokens =
    normalizedText.split(
      " "
    );


  const matchedTokens =
    titleTokens.filter(
      token => {
        return sourceTokens.includes(
          token
        );
      }
    );


  const matchRatio =
    matchedTokens.length /
    titleTokens.length;


  const matched =
    titleTokens.length ===
      1
      ? (
          matchedTokens.length ===
            1 &&
          titleTokens[0].length >=
            3
        )

      : titleTokens.length ===
          2
        ? matchedTokens.length ===
            2

        : (
            matchedTokens.length >=
              3 ||

            (
              matchedTokens.length >=
                2 &&
              matchRatio >=
                0.5
            )
          );


  if (
    !matched
  ) {
    return null;
  }


  return {
    matchType:
      "title-token",

    matchedKeyword:
      matchedTokens.join(
        " "
      ),

    score:
      Math.round(
        matchRatio *
        100
      )
  };
}


/* =========================================================
  업무일지에서 자동완료 검사 대상 내용 수집

  확인 배열:
  - entries
  - tmEntries
  - handoverEntries
  - remarkEntries

  제외:
  - 이전 근무 자동 가져오기 내용
  - inheritedFromDate가 있는 항목

  파트장 취합 내용:
  - 최초 원본 업무일지·보직·작성자를 유지
========================================================= */

function collectInspectionAutoCompletionSourceEntries(
  log
) {
  const result =
    [];


  const usedKeys =
    new Set();


  const collections = [
    [
      "entries",
      log?.entries
    ],
    [
      "tmEntries",
      log?.tmEntries
    ],
    [
      "handoverEntries",
      log?.handoverEntries
    ],
    [
      "remarkEntries",
      log?.remarkEntries
    ]
  ];


  collections.forEach(
    (
      [
        collectionName,
        source
      ]
    ) => {
      (
        Array.isArray(
          source
        )
          ? source
          : []
      ).forEach(
        (
          rawEntry,
          entryIndex
        ) => {
          const entry =
            rawEntry &&
            typeof rawEntry ===
              "object" &&
            !Array.isArray(
              rawEntry
            )
              ? rawEntry
              : {
                  content:
                    String(
                      rawEntry ||
                      ""
                    )
                };


          const content =
            normalizeText(
              entry.content ||
              entry.text ||
              entry.description ||
              entry.value
            );


          if (
            !content
          ) {
            return;
          }


          const sourceType =
            normalizeText(
              entry.source
            ).toLowerCase();


          /*
            이전 일지에서 자동으로 가져온 내용은
            현재 근무자가 수행한 점검으로 인정하지 않는다.
          */
          if (
            sourceType.includes(
              "previous-shift"
            ) ||
            normalizeText(
              entry.inheritedFromDate
            )
          ) {
            return;
          }


          const sourceLogId =
            normalizeText(
              entry.importedFromLogId ||
              log?.id
            );


          if (
            !sourceLogId
          ) {
            return;
          }


          const stableEntryId =
            normalizeText(
              entry.id
            ) ||
            (
              Number.isInteger(
                Number(
                  entry.importedFromEntryIndex
                )
              )
                ? `imported-${Number(
                    entry.importedFromEntryIndex
                  )}`

                : `${collectionName}-${entryIndex}`
            );


          const sourceEntryKey = [
            sourceLogId,
            stableEntryId
          ].join(
            "||"
          );


          const contentKey = [
            sourceEntryKey,

            normalizeInspectionAutoCompletionText(
              content
            )
          ].join(
            "||"
          );


          if (
            usedKeys.has(
              contentKey
            )
          ) {
            return;
          }


          usedKeys.add(
            contentKey
          );


          result.push({
            sourceLogId,

            sourceEntryKey,

            sourceRole:
              normalizeLogRole(
                entry.importedFromRole ||
                log?.role
              ),

            sourceAuthorId:
              normalizeEmployeeNo(
                entry.importedFromAuthorId ||
                log?.authorId
              ),

            sourceAuthor:
              normalizeText(
                entry.importedFromAuthor ||
                log?.author
              ),

            sourceText:
              content.slice(
                0,
                1000
              ),

            sourceUpdatedAt:
              normalizeText(
                log?.updatedAt ||
                log?.createdAt
              ),

            collectionName,

            entryIndex
          });
        }
      );
    }
  );


  return result;
}

/* =========================================================
  점검 자동완료 호기 구분

  기본 원칙:
  - BCO1 / BO1 = 1호기
  - BCO2 / BO2 = 2호기

  업무내용에 호기가 직접 적혀 있으면
  문구의 호기를 우선한다.

  반환:
  - 1
  - 2
  - 0 : 호기 구분 없음
========================================================= */

function getInspectionAutoCompletionUnitFromRole(
  role
) {
  const normalizedRole =
    normalizeLogRole(
      role
    );


  if (
    [
      "BCO1",
      "BO1"
    ].includes(
      normalizedRole
    )
  ) {
    return 1;
  }


  if (
    [
      "BCO2",
      "BO2"
    ].includes(
      normalizedRole
    )
  ) {
    return 2;
  }


  return 0;
}


function getInspectionAutoCompletionUnitFromText(
  value
) {
  const text =
    normalizeInspectionAutoCompletionText(
      value
    );


  if (
    !text
  ) {
    return 0;
  }


  /*
    1호기 표현
  */
  if (
    /(?:^|\s)(?:1\s*호기|#\s*1|UNIT\s*1|1\s*UNIT)(?:\s|$)/i.test(
      text
    )
  ) {
    return 1;
  }


  /*
    2호기 표현
  */
  if (
    /(?:^|\s)(?:2\s*호기|#\s*2|UNIT\s*2|2\s*UNIT)(?:\s|$)/i.test(
      text
    )
  ) {
    return 2;
  }


  return 0;
}


/* =========================================================
  점검 자동완료 호기 일치 검사

  현재 GS Shift Log 운전 보직 기준:

  BCO1 / BO1
  → 1호기

  BCO2 / BO2
  → 2호기

  TGO / TO / 파트장
  → 호기 공통

  중요:
  SDA Hopper Ash처럼 호기별로 각각 수행하는 업무는
  1호기 업무가 2호기 완료 근거가 되면 안 된다.
========================================================= */

function isInspectionAutoCompletionUnitCompatible(
  scheduleItem,
  sourceEntry
) {
  const scheduleId =
    normalizeText(
      scheduleItem?.id
    );


  /*
    현재 반드시 1·2호기를 분리해야 하는 점검.

    이후 호기별 점검이 추가되면
    이 Set에 일정 ID만 추가하면 된다.
  */
  const unitSeparatedScheduleIds =
    new Set([
      "weekly-sda-hopper-ash"
    ]);


  /*
    호기 분리가 필요 없는 점검은
    기존 방식 그대로 허용한다.
  */
  if (
    !unitSeparatedScheduleIds.has(
      scheduleId
    )
  ) {
    return true;
  }


  const sourceTextUnit =
    getInspectionAutoCompletionUnitFromText(
      sourceEntry?.sourceText
    );


  const sourceRoleUnit =
    getInspectionAutoCompletionUnitFromRole(
      sourceEntry?.sourceRole
    );


  /*
    문구에 호기가 직접 적혀 있으면
    그 값을 최우선으로 사용한다.

    예:
    BCO1 업무일지에
    "2호기 SDA Hopper Ash 배출"
    이라고 적은 경우 → 2호기 수행으로 본다.
  */
  const sourceUnit =
    sourceTextUnit ||
    sourceRoleUnit;


  /*
    BCO1 / BO1 / BCO2 / BO2가 아닌 경우에는
    기존과 동일하게 허용한다.

    예:
    파트장 직접 입력 등
  */
  if (
    sourceUnit ===
      0
  ) {
    return true;
  }


  /*
    현재 SDA Hopper Ash 일정 자체는
    하나의 schedule ID를 사용하고 있으므로,

    후보를 만드는 단계에서
    출처 보직의 호기를 반드시 유지해야 한다.

    여기서는 잘못된 반대 호기 전파를 막는다.
  */
  return (
    sourceUnit ===
      sourceRoleUnit ||
    sourceRoleUnit ===
      0
  );
}

/* =========================================================
  점검주기 자동완료 담당 보직 규칙

  원칙:
  - TGO / TO : 터빈·공통 설비
  - BCO1 / BO1 : 보일러 1호기
  - BCO2 / BO2 : 보일러 2호기
  - 파트장 취합 항목은 collect 단계에서
    importedFromRole을 유지하므로 원 작성 보직으로 판정

  주간 점검표 기준 담당 보직을 우선 적용한다.
========================================================= */

function getInspectionAutoCompletionAllowedRoles(
  scheduleItem
) {
  const scheduleId =
    normalizeText(
      scheduleItem?.id
    );


  const roleMap = {
    /*
      =====================================================
      일일
      =====================================================
    */

    "daily-night-patrol": [
      "TO",
      "BO1",
      "BO2"
    ],

    "daily-freeze-prevention": [
      "TO",
      "BO1",
      "BO2"
    ],

    "daily-fbhe-vbelt": [
      "BO1",
      "BO2"
    ],

    "daily-suction-filter": [
      "TGO",
      "TO",
      "BCO1",
      "BCO2",
      "BO1",
      "BO2"
    ],

    "daily-pump-strainer-dp": [
      "TGO",
      "TO"
    ],

    "daily-silo-co": [
      "BCO1",
      "BCO2",
      "BO1",
      "BO2"
    ],

    "daily-air-pollution-dp": [
      "BCO1",
      "BCO2"
    ],

    "daily-bio-hopper": [
      "BO1",
      "BO2"
    ],

    "daily-bed-ash-discharge": [
      "BCO1",
      "BCO2",
      "BO1",
      "BO2"
    ],

    "daily-boiler-air-comp": [
      "BO1",
      "BO2"
    ],


    /*
      =====================================================
      주간
      =====================================================
    */

    "weekly-lng-system": [
      "TO"
    ],

    "weekly-high-pressure-gas": [
      "TO"
    ],

    "weekly-soot-blower": [
      "BO1",
      "BO2"
    ],

    "weekly-aux-air-comp": [
      "TO"
    ],

    "weekly-bed-ash-screen": [
      "BO1",
      "BO2"
    ],

    "weekly-lime-slurry-flushing": [
      "BO1",
      "BO2"
    ],

    "weekly-bed-ash-be": [
      "BO1",
      "BO2"
    ],

    "weekly-bag-filter-offline": [
      "BCO1",
      "BCO2"
    ],

    "weekly-fly-ash-sampling": [
      "BO1",
      "BO2"
    ],

    "weekly-sda-hopper-ash": [
      "BCO1",
      "BCO2",
      "BO1",
      "BO2"
    ],

    "weekly-sda-return-line": [
      "BO1",
      "BO2"
    ],

    "weekly-silo-vent-velocity": [
      "BO1",
      "BO2"
    ],

    "weekly-cooling-tower-damper": [
      "TGO"
    ]
  };


  /*
    관리자 수정 일정에 담당보직 정보가
    저장되어 있다면 그것을 가장 우선한다.

    지원 필드:
    assignedRoles
    roles
    positions
  */

  const configuredRoles =
    [
      ...(
        Array.isArray(
          scheduleItem?.assignedRoles
        )
          ? scheduleItem.assignedRoles
          : []
      ),

      ...(
        Array.isArray(
          scheduleItem?.roles
        )
          ? scheduleItem.roles
          : []
      ),

      ...(
        Array.isArray(
          scheduleItem?.positions
        )
          ? scheduleItem.positions
          : []
      )
    ]
      .map(
        normalizeLogRole
      )
      .filter(
        Boolean
      );


  if (
    configuredRoles.length >
      0
  ) {
    return [
      ...new Set(
        configuredRoles
      )
    ];
  }


  return (
    Array.isArray(
      roleMap[
        scheduleId
      ]
    )
      ? roleMap[
          scheduleId
        ]
      : []
  );
}


/* =========================================================
  보일러 호기 번호

  1호기:
  - BCO1
  - BO1

  2호기:
  - BCO2
  - BO2

  터빈/공통:
  - TGO
  - TO

  반환:
  - 1
  - 2
  - 0
========================================================= */

function getInspectionAutoCompletionUnitByRole(
  role
) {
  const normalizedRole =
    normalizeLogRole(
      role
    );


  if (
    [
      "BCO1",
      "BO1"
    ].includes(
      normalizedRole
    )
  ) {
    return 1;
  }


  if (
    [
      "BCO2",
      "BO2"
    ].includes(
      normalizedRole
    )
  ) {
    return 2;
  }


  return 0;
}


/* =========================================================
  해당 일정이 1·2호기 분리가 필요한지 확인

  담당 목록에
  1호기 보직 + 2호기 보직이 함께 있으면
  호기별 독립 점검으로 판단한다.
========================================================= */

function isInspectionAutoCompletionUnitSeparated(
  scheduleItem
) {
  const allowedRoles =
    getInspectionAutoCompletionAllowedRoles(
      scheduleItem
    );


  const hasUnit1 =
    allowedRoles.some(
      role => {
        return (
          getInspectionAutoCompletionUnitByRole(
            role
          ) ===
          1
        );
      }
    );


  const hasUnit2 =
    allowedRoles.some(
      role => {
        return (
          getInspectionAutoCompletionUnitByRole(
            role
          ) ===
          2
        );
      }
    );


  return (
    hasUnit1 &&
    hasUnit2
  );
}


/* =========================================================
  일정과 업무일지 보직 일치 확인
========================================================= */

function isInspectionAutoCompletionRoleAllowed(
  scheduleItem,
  sourceEntry,
  targetUnit = 0
) {
  const sourceRole =
    normalizeLogRole(
      sourceEntry?.sourceRole
    );


  if (
    !sourceRole
  ) {
    return false;
  }


  const allowedRoles =
    getInspectionAutoCompletionAllowedRoles(
      scheduleItem
    );


  /*
    담당보직 설정이 없는 기존 일정은
    이전 방식 그대로 허용한다.
  */
  if (
    allowedRoles.length ===
      0
  ) {
    return true;
  }


  if (
    !allowedRoles.includes(
      sourceRole
    )
  ) {
    return false;
  }


  /*
    호기 분리 일정이면
    대상 호기와 작성 보직 호기가 같아야 한다.
  */
  if (
    targetUnit ===
      1 ||
    targetUnit ===
      2
  ) {
    return (
      getInspectionAutoCompletionUnitByRole(
        sourceRole
      ) ===
      targetUnit
    );
  }


  return true;
}

/* =========================================================
  같은 날짜·근무 전체 업무일지에서 자동완료 후보 생성

  핵심 규칙:

  터빈/공통:
  - 담당 보직 업무만 검사
  - 예: TGO / TO

  보일러:
  - 1호기와 2호기를 완전히 분리
  - BCO1 / BO1 → 1호기
  - BCO2 / BO2 → 2호기

  문구:
  - "점검 완료"처럼 완료라는 단어를 강제하지 않는다.
  - 배출, 점검, 청소, 측정, TEST 등
    실제 수행 의미가 있으면 기존 매칭 규칙으로 인정한다.

  부정 문구:
  - 예정
  - 필요
  - 요청
  - 미실시
  - 불가
  등은 기존 실행 판정에서 제외한다.
========================================================= */

function buildInspectionAutoCompletionCandidates(
  logs,
  schedules,
  workDate,
  workShift
) {
  const dueSchedules =
    getInspectionAutoCompletionDueSchedules(
      schedules,
      workDate,
      workShift
    );


  const sourceEntries =
    (
      Array.isArray(
        logs
      )
        ? logs
        : []
    )
      .flatMap(
        collectInspectionAutoCompletionSourceEntries
      )
      .sort(
        (
          firstEntry,
          secondEntry
        ) => {
          return String(
            secondEntry.sourceUpdatedAt ||
            ""
          ).localeCompare(
            String(
              firstEntry.sourceUpdatedAt ||
              ""
            )
          );
        }
      );


  const candidates =
    [];


  dueSchedules.forEach(
    scheduleItem => {
      const unitSeparated =
        isInspectionAutoCompletionUnitSeparated(
          scheduleItem
        );


      /*
        =====================================================
        1·2호기 독립 점검
        =====================================================
      */

      if (
        unitSeparated
      ) {
        [
          1,
          2
        ].forEach(
          unitNo => {
            let selectedMatch =
              null;


            for (
              const sourceEntry of
              sourceEntries
            ) {
              /*
                담당 보직 + 호기 검사

                1호기:
                BCO1 / BO1만

                2호기:
                BCO2 / BO2만
              */
              if (
                !isInspectionAutoCompletionRoleAllowed(
                  scheduleItem,
                  sourceEntry,
                  unitNo
                )
              ) {
                continue;
              }


              const match =
                findInspectionAutoCompletionTextMatch(
                  scheduleItem,
                  sourceEntry.sourceText
                );


              if (
                !match
              ) {
                continue;
              }


              selectedMatch = {
                ...sourceEntry,
                ...match,

                unitNo
              };


              break;
            }


            if (
              !selectedMatch
            ) {
              return;
            }


            /*
              중요

              D1의 현재 UNIQUE 키는
              schedule_id + due_date + shift 이다.

              따라서 동일 일정의 1·2호기를
              독립 저장하기 위해 내부 완료 ID만
              호기별로 나눈다.

              원래 점검 ID:
              weekly-sda-hopper-ash

              내부 완료 ID:
              weekly-sda-hopper-ash::unit1
              weekly-sda-hopper-ash::unit2
            */

            const unitScheduleId =
              `${normalizeText(
                scheduleItem.id
              )}::unit${unitNo}`;


            const baseTitle =
              normalizeText(
                scheduleItem.title
              );


            candidates.push({
              scheduleId:
                unitScheduleId,

              baseScheduleId:
                normalizeText(
                  scheduleItem.id
                ),

              unitNo,

              scheduleTitle:
                `${unitNo}호기 ${baseTitle}`,

              dueDate:
                normalizeText(
                  workDate
                ),

              shift:
                scheduleItem.dueShift,

              sourceLogId:
                selectedMatch.sourceLogId,

              sourceEntryKey:
                selectedMatch.sourceEntryKey,

              sourceRole:
                selectedMatch.sourceRole,

              sourceAuthorId:
                selectedMatch.sourceAuthorId,

              sourceAuthor:
                selectedMatch.sourceAuthor,

              sourceText:
                selectedMatch.sourceText,

              sourceUpdatedAt:
                selectedMatch.sourceUpdatedAt,

              matchType:
                selectedMatch.matchType,

              matchedKeyword:
                selectedMatch.matchedKeyword,

              matchScore:
                selectedMatch.score
            });
          }
        );


        return;
      }


      /*
        =====================================================
        호기 구분이 없는 점검

        TGO / TO 등의 담당 보직 규칙은 그대로 적용한다.
        =====================================================
      */

      let selectedMatch =
        null;


      for (
        const sourceEntry of
        sourceEntries
      ) {
        if (
          !isInspectionAutoCompletionRoleAllowed(
            scheduleItem,
            sourceEntry,
            0
          )
        ) {
          continue;
        }


        const match =
          findInspectionAutoCompletionTextMatch(
            scheduleItem,
            sourceEntry.sourceText
          );


        if (
          !match
        ) {
          continue;
        }


        selectedMatch = {
          ...sourceEntry,
          ...match
        };


        break;
      }


      if (
        !selectedMatch
      ) {
        return;
      }


      candidates.push({
        scheduleId:
          normalizeText(
            scheduleItem.id
          ),

        baseScheduleId:
          normalizeText(
            scheduleItem.id
          ),

        unitNo:
          0,

        scheduleTitle:
          normalizeText(
            scheduleItem.title
          ),

        dueDate:
          normalizeText(
            workDate
          ),

        shift:
          scheduleItem.dueShift,

        sourceLogId:
          selectedMatch.sourceLogId,

        sourceEntryKey:
          selectedMatch.sourceEntryKey,

        sourceRole:
          selectedMatch.sourceRole,

        sourceAuthorId:
          selectedMatch.sourceAuthorId,

        sourceAuthor:
          selectedMatch.sourceAuthor,

        sourceText:
          selectedMatch.sourceText,

        sourceUpdatedAt:
          selectedMatch.sourceUpdatedAt,

        matchType:
          selectedMatch.matchType,

        matchedKeyword:
          selectedMatch.matchedKeyword,

        matchScore:
          selectedMatch.score
      });
    }
  );


  return candidates;
}

/* =========================================================
  점검주기표 업무일지 자동완료 D1 동기화

  처리:
  - 같은 날짜의 D/S·N/S 전체 업무일지 재검사
  - 어떤 보직이 작성했는지와 관계없이 완료 인정
  - 업무일지 저장 상태와 관계없이 즉시 반영
  - 자동완료 생성·출처 변경·자동완료 삭제
  - 수동 완료 기록은 수정하거나 삭제하지 않음
========================================================= */


/* =========================================================
  점검 완료 기록 식별키

  점검 일정 ID + 예정일 + 근무
========================================================= */

function createInspectionAutoCompletionStatusKey(
  scheduleId,
  dueDate,
  shift
) {
  return [
    normalizeText(
      scheduleId
    ),

    normalizeText(
      dueDate
    ),

    normalizeShift(
      shift
    )
  ].join(
    "||"
  );
}


/* =========================================================
  업무일지 저장 시각 정리
========================================================= */

function normalizeInspectionAutoCompletionTimestamp(
  value,
  fallbackValue
) {
  const parsedDate =
    new Date(
      value ||
      0
    );


  if (
    !Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return parsedDate
      .toISOString();
  }


  return normalizeText(
    fallbackValue
  );
}


/* =========================================================
  자동완료 화면 표시명

  예:
  업무일지 자동인식 · BCO1 박문수
========================================================= */

function getInspectionAutoCompletionDisplayName(
  candidate
) {
  const sourceName = [
    normalizeLogRole(
      candidate?.sourceRole
    ),

    normalizeText(
      candidate?.sourceAuthor
    )
  ]
    .filter(
      Boolean
    )
    .join(
      " "
    );


  return sourceName
    ? `업무일지 자동인식 · ${sourceName}`
    : "업무일지 자동인식";
}


/* =========================================================
  자동완료 테이블 생성·업그레이드

  inspection-schedule-status.js와
  같은 열 이름을 사용한다.
========================================================= */

async function ensureInspectionAutoCompletionStatusTable(
  database
) {
  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        inspection_schedule_status
      (
        id TEXT PRIMARY KEY,

        schedule_id TEXT NOT NULL,
        due_date TEXT NOT NULL,
        shift TEXT NOT NULL DEFAULT '',
        schedule_title TEXT NOT NULL DEFAULT '',

        status TEXT NOT NULL DEFAULT '완료',
        note TEXT NOT NULL DEFAULT '',

        completed_by_id TEXT NOT NULL DEFAULT '',
        completed_by_name TEXT NOT NULL DEFAULT '',
        completed_at TEXT NOT NULL DEFAULT '',

        completion_source TEXT NOT NULL DEFAULT 'manual',

        source_log_id TEXT NOT NULL DEFAULT '',
        source_entry_key TEXT NOT NULL DEFAULT '',
        source_role TEXT NOT NULL DEFAULT '',
        source_author TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        revision INTEGER NOT NULL DEFAULT 1,

        UNIQUE (
          schedule_id,
          due_date,
          shift
        )
      )
    `)
    .run();


  const tableInfoResult =
    await database
      .prepare(`
        PRAGMA table_info(
          inspection_schedule_status
        )
      `)
      .all();


  const existingColumns =
    new Set(
      (
        Array.isArray(
          tableInfoResult.results
        )
          ? tableInfoResult.results
          : []
      )
        .map(
          column => {
            return normalizeText(
              column?.name
            );
          }
        )
        .filter(
          Boolean
        )
    );


  const requiredColumns = [
    {
      name:
        "completion_source",

      definition:
        "TEXT NOT NULL DEFAULT 'manual'"
    },

    {
      name:
        "source_log_id",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    },

    {
      name:
        "source_entry_key",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    },

    {
      name:
        "source_role",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    },

    {
      name:
        "source_author",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    },

    {
      name:
        "source_text",

      definition:
        "TEXT NOT NULL DEFAULT ''"
    }
  ];


  for (
    const column of
    requiredColumns
  ) {
    if (
      existingColumns.has(
        column.name
      )
    ) {
      continue;
    }


    try {
      await database
        .prepare(`
          ALTER TABLE
            inspection_schedule_status

          ADD COLUMN
            ${column.name}
            ${column.definition}
        `)
        .run();

    } catch (
      error
    ) {
      const message =
        String(
          error?.message ||
          error ||
          ""
        ).toLowerCase();


      /*
        동시에 실행된 다른 요청이
        먼저 열을 만들었으면 정상으로 처리한다.
      */
      if (
        !message.includes(
          "duplicate column"
        )
      ) {
        throw error;
      }
    }
  }


  /*
    기존 완료 자료는 수동 완료로 보호한다.
  */
  await database
    .prepare(`
      UPDATE inspection_schedule_status

      SET
        completion_source =
          'manual'

      WHERE
        completion_source IS NULL
        OR TRIM(
          completion_source
        ) = ''
        OR completion_source NOT IN (
          'manual',
          'shift_log'
        )
    `)
    .run();


  await database.batch([
    database.prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_inspection_schedule_status_due_date

      ON inspection_schedule_status (
        due_date DESC
      )
    `),


    database.prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_inspection_schedule_status_source

      ON inspection_schedule_status (
        completion_source,
        source_log_id
      )
    `)
  ]);
}


/* =========================================================
  기존 자동완료 기록과 후보가 같은지 비교

  같은 경우 revision과 완료시각을
  불필요하게 변경하지 않는다.
========================================================= */

function isSameInspectionAutoCompletionStatusRow(
  row,
  candidate
) {
  const displayName =
    getInspectionAutoCompletionDisplayName(
      candidate
    );


  return (
    normalizeText(
      row.schedule_title
    ) ===
      normalizeText(
        candidate.scheduleTitle
      ) &&

    normalizeText(
      row.status
    ) ===
      "완료" &&

    normalizeText(
      row.note
    ) ===
      "업무일지 자동인식" &&

    normalizeEmployeeNo(
      row.completed_by_id
    ) ===
      normalizeEmployeeNo(
        candidate.sourceAuthorId
      ) &&

    normalizeText(
      row.completed_by_name
    ) ===
      displayName &&

    normalizeText(
      row.completion_source
    ).toLowerCase() ===
      "shift_log" &&

    normalizeText(
      row.source_log_id
    ) ===
      normalizeText(
        candidate.sourceLogId
      ) &&

    normalizeText(
      row.source_entry_key
    ) ===
      normalizeText(
        candidate.sourceEntryKey
      ) &&

    normalizeLogRole(
      row.source_role
    ) ===
      normalizeLogRole(
        candidate.sourceRole
      ) &&

    normalizeText(
      row.source_author
    ) ===
      normalizeText(
        candidate.sourceAuthor
      ) &&

    normalizeText(
      row.source_text
    ) ===
      normalizeText(
        candidate.sourceText
      )
  );
}


/* =========================================================
  업무일지 자동완료 최종 동기화

  날짜 전체를 다시 계산하는 이유:
  - D/S 업무일지 수정
  - N/S 업무일지 수정
  - 업무일지 삭제
  - 다른 보직에 같은 점검 내용이 남아 있는 경우

  위 상황을 모두 정확하게 반영하기 위함이다.
========================================================= */

async function synchronizeInspectionScheduleAutoCompletionsForWorkDate(
  context,
  options = {}
) {
  const database =
    context
      ?.env
      ?.DB;


  const workDate =
    normalizeText(
      options.workDate
    );


  if (
    !database ||
    !isValidIsoDate(
      workDate
    )
  ) {
    return {
      ok:
        false,

      skipped:
        true,

      message:
        "점검 자동완료 날짜 또는 D1 연결을 확인할 수 없습니다."
    };
  }


  try {
    await ensureInspectionAutoCompletionStatusTable(
      database
    );


    /* =====================================================
      해당 날짜의 모든 보직·모든 근무 업무일지 조회
    ====================================================== */

    const logResult =
      await database
        .prepare(`
          SELECT
            *

          FROM shift_logs

          WHERE
            work_date = ?
            AND shift IN (
              'DS',
              'NS'
            )

          ORDER BY
            updated_at DESC,
            created_at DESC
        `)
        .bind(
          workDate
        )
        .all();


    const allLogs =
      (
        Array.isArray(
          logResult.results
        )
          ? logResult.results
          : []
      ).map(
        convertRowToLog
      );


    /*
      관리자 수정·추가·사용 중지 일정을 포함한
      실제 점검주기표를 가져온다.
    */
    const schedules =
      await loadInspectionAutoCompletionEffectiveSchedules(
        database
      );


    /* =====================================================
      D/S·N/S 각각 완료 후보 생성
    ====================================================== */

    const rawCandidates =
      [
        "DS",
        "NS"
      ].flatMap(
        shift => {
          const shiftLogs =
            allLogs.filter(
              log => {
                return (
                  normalizeShift(
                    log?.shift
                  ) ===
                  shift
                );
              }
            );


          return buildInspectionAutoCompletionCandidates(
            shiftLogs,
            schedules,
            workDate,
            shift
          );
        }
      );


    /*
      근무 미지정 일정은 D/S·N/S 양쪽에서
      같은 완료키가 만들어질 수 있다.

      같은 완료키에서는 가장 최근에 저장된
      업무일지를 최종 출처로 사용한다.
    */
    rawCandidates.sort(
      (
        firstCandidate,
        secondCandidate
      ) => {
        return String(
          secondCandidate
            .sourceUpdatedAt ||
          ""
        ).localeCompare(
          String(
            firstCandidate
              .sourceUpdatedAt ||
            ""
          )
        );
      }
    );


    const candidateMap =
      new Map();


    rawCandidates.forEach(
      candidate => {
        const key =
          createInspectionAutoCompletionStatusKey(
            candidate.scheduleId,
            candidate.dueDate,
            candidate.shift
          );


        if (
          !candidateMap.has(
            key
          )
        ) {
          candidateMap.set(
            key,
            candidate
          );
        }
      }
    );


    /* =====================================================
      기존 완료 기록 조회

      같은 날짜의 수동·자동 완료를 모두 확인한다.
    ====================================================== */

    const existingResult =
      await database
        .prepare(`
          SELECT
            *

          FROM inspection_schedule_status

          WHERE
            due_date = ?
        `)
        .bind(
          workDate
        )
        .all();


    const existingRows =
      Array.isArray(
        existingResult.results
      )
        ? existingResult.results
        : [];


    const existingMap =
      new Map();


    existingRows.forEach(
      row => {
        existingMap.set(
          createInspectionAutoCompletionStatusKey(
            row.schedule_id,
            row.due_date,
            row.shift
          ),

          row
        );
      }
    );


    const deleteStatements =
      [];


    const updateStatements =
      [];


    const insertStatements =
      [];


    const timestamp =
      new Date()
        .toISOString();


    let createdCount =
      0;


    let updatedCount =
      0;


    let deletedCount =
      0;


    let unchangedCount =
      0;


    let manualProtectedCount =
      0;


    /* =====================================================
      후보 생성·수정

      수동 완료가 이미 있으면
      자동 완료로 덮어쓰지 않는다.
    ====================================================== */

    candidateMap.forEach(
      (
        candidate,
        key
      ) => {
        const existingRow =
          existingMap.get(
            key
          ) ||
          null;


        const completionSource =
          normalizeText(
            existingRow
              ?.completion_source
          ).toLowerCase();


        /*
          사용자가 직접 완료한 기록 보호
        */
        if (
          existingRow &&
          completionSource !==
            "shift_log"
        ) {
          manualProtectedCount +=
            1;


          return;
        }


        const completedAt =
          normalizeInspectionAutoCompletionTimestamp(
            candidate.sourceUpdatedAt,
            timestamp
          );


        const completedByName =
          getInspectionAutoCompletionDisplayName(
            candidate
          );


        /*
          기존 자동 완료 기록 갱신
        */
        if (
          existingRow
        ) {
          if (
            isSameInspectionAutoCompletionStatusRow(
              existingRow,
              candidate
            )
          ) {
            unchangedCount +=
              1;


            return;
          }


          updateStatements.push(
            database
              .prepare(`
                UPDATE
                  inspection_schedule_status

                SET
                  schedule_title = ?,
                  status = '완료',
                  note = '업무일지 자동인식',

                  completed_by_id = ?,
                  completed_by_name = ?,
                  completed_at = ?,

                  completion_source =
                    'shift_log',

                  source_log_id = ?,
                  source_entry_key = ?,
                  source_role = ?,
                  source_author = ?,
                  source_text = ?,

                  updated_at = ?,

                  revision =
                    revision + 1

                WHERE
                  id = ?
                  AND completion_source =
                    'shift_log'
              `)
              .bind(
                candidate.scheduleTitle,

                candidate.sourceAuthorId,
                completedByName,
                completedAt,

                candidate.sourceLogId,
                candidate.sourceEntryKey,
                candidate.sourceRole,
                candidate.sourceAuthor,
                candidate.sourceText,

                timestamp,

                existingRow.id
              )
          );


          updatedCount +=
            1;


          return;
        }


        /*
          신규 자동 완료 생성
        */
        insertStatements.push(
          database
            .prepare(`
              INSERT INTO
                inspection_schedule_status
              (
                id,

                schedule_id,
                due_date,
                shift,
                schedule_title,

                status,
                note,

                completed_by_id,
                completed_by_name,
                completed_at,

                completion_source,

                source_log_id,
                source_entry_key,
                source_role,
                source_author,
                source_text,

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

                '완료',
                '업무일지 자동인식',

                ?,
                ?,
                ?,

                'shift_log',

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
              crypto.randomUUID(),

              candidate.scheduleId,
              candidate.dueDate,
              candidate.shift,
              candidate.scheduleTitle,

              candidate.sourceAuthorId,
              completedByName,
              completedAt,

              candidate.sourceLogId,
              candidate.sourceEntryKey,
              candidate.sourceRole,
              candidate.sourceAuthor,
              candidate.sourceText,

              timestamp,
              timestamp
            )
        );


        createdCount +=
          1;
      }
    );


    /* =====================================================
      근거가 사라진 자동 완료 삭제

      삭제 대상:
      - completion_source = shift_log
      - 현재 업무일지 후보에는 더 이상 존재하지 않음

      보호:
      - manual 완료는 절대 삭제하지 않음
    ====================================================== */

    existingRows.forEach(
      row => {
        const completionSource =
          normalizeText(
            row.completion_source
          ).toLowerCase();


        if (
          completionSource !==
            "shift_log"
        ) {
          return;
        }


        const key =
          createInspectionAutoCompletionStatusKey(
            row.schedule_id,
            row.due_date,
            row.shift
          );


        if (
          candidateMap.has(
            key
          )
        ) {
          return;
        }


        deleteStatements.push(
          database
            .prepare(`
              DELETE FROM
                inspection_schedule_status

              WHERE
                id = ?
                AND completion_source =
                  'shift_log'
            `)
            .bind(
              row.id
            )
        );


        deletedCount +=
          1;
      }
    );


    /*
      삭제를 먼저 처리한 뒤
      수정·신규 순서로 실행한다.
    */
    const statements = [
      ...deleteStatements,
      ...updateStatements,
      ...insertStatements
    ];


    if (
      statements.length >
        0
    ) {
      await database.batch(
        statements
      );
    }


    return {
      ok:
        true,

      skipped:
        false,

      workDate,

      logCount:
        allLogs.length,

      scheduleCount:
        schedules.length,

      candidateCount:
        candidateMap.size,

      createdCount,
      updatedCount,
      deletedCount,
      unchangedCount,
      manualProtectedCount
    };

  } catch (
    error
  ) {
    console.error(
      "점검주기표 업무일지 자동완료 동기화 실패:",
      error
    );


    return {
      ok:
        false,

      skipped:
        false,

      workDate,

      message:
        error instanceof Error
          ? error.message
          : "점검 자동완료 처리 중 오류가 발생했습니다."
    };
  }
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

/* =========================================================
  업무일지 저장 시 석회석 자동 동기화 문구 분석

  숫자 뒤 단위가 없어도 ton으로 처리한다.
========================================================= */

function extractLimestoneSyncItems(
  entry
) {
  const content =
    String(
      entry?.content ||
      entry?.text ||
      ""
    )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .trim();


  if (
    !content
  ) {
    return [];
  }


  const entryTime =
    findLimestoneSyncTime(
      entry?.time
    );


  const result =
    [];


  const lines =
    content
      .split(
        "\n"
      )
      .map(
        line => {
          return line.trim();
        }
      )
      .filter(
        Boolean
      );


  lines.forEach(
    (
      line,
      lineIndex
    ) => {
      /*
        지원 형식

        Limestone 입고(30.34)
        Limestone 입고 30.34
        Limestone 입고 30.34ton
        석회석 입고량 30.34톤
        석회석 입고 완료 (30.34)
        30.34t Limestone 입고
      */
      const patterns = [
        /*
          석회석 문구 뒤에 수량이 나오는 형식

          수량 뒤 ton·t·톤은 있어도 되고
          없어도 된다.
        */
        /(?:lime\s*stone|석회석)[^\r\n]{0,60}?입고(?:\s*(?:량|완료))?[^0-9\r\n]{0,30}?(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(?:tons?|t|톤))?(?![:\d.])/gi,


        /*
          수량과 단위가 먼저 나오는 형식
        */
        /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:tons?|t|톤)[^\r\n]{0,50}?(?:lime\s*stone|석회석)[^\r\n]{0,30}?입고(?:\s*(?:량|완료))?/gi
      ];


      const lineItems =
        new Map();


      patterns.forEach(
        pattern => {
          let match;


          while (
            (
              match =
                pattern.exec(
                  line
                )
            ) !==
            null
          ) {
            const quantityTon =
              normalizeLimestoneSyncQuantity(
                match[1]
              );


            const receiptTime =
              findLimestoneSyncTime(
                line.slice(
                  0,
                  match.index
                )
              ) ||

              findLimestoneSyncTime(
                line
              ) ||

              entryTime;


            /*
              입고량 또는 시간이 없으면
              자동 기록을 만들지 않는다.
            */
            if (
              quantityTon ===
                null ||
              !receiptTime
            ) {
              continue;
            }


            const itemKey = [
              receiptTime,
              quantityTon.toFixed(
                2
              )
            ].join(
              "||"
            );


            /*
              같은 줄을 두 패턴이 동시에 인식해도
              한 건만 남긴다.
            */
            if (
              lineItems.has(
                itemKey
              )
            ) {
              continue;
            }


            lineItems.set(
              itemKey,
              {
                receiptTime,

                quantityTon,

                sourceText:
                  line
              }
            );
          }
        }
      );


      [
        ...lineItems.values()
      ].forEach(
        (
          item,
          matchIndex
        ) => {
          result.push({
            ...item,

            lineIndex,

            matchIndex
          });
        }
      );
    }
  );


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

async function synchronizeLimestoneReceiptsForShiftContext(
  context,
  options = {}
) {
  const database = context?.env?.DB;
  const workDate = normalizeText(options.workDate);
  const shift = normalizeShift(options.shift);
  const user = options.user || {};

  const removedSourceLogIds = new Set(
    (
      Array.isArray(options.removedSourceLogIds)
        ? options.removedSourceLogIds
        : []
    )
      .map(normalizeText)
      .filter(Boolean)
  );

  if (
    !database ||
    !isValidIsoDate(workDate) ||
    !VALID_SHIFTS.has(shift)
  ) {
    return {
      ok: false,
      skipped: true,
      message: "석회석 자동 동기화 조건을 확인할 수 없습니다."
    };
  }

  try {
    /* =====================================================
      같은 날짜·근무의 연동 대상 업무일지
    ====================================================== */

    const logResult = await database
      .prepare(`
        SELECT *
        FROM shift_logs
        WHERE
          work_date = ?
          AND shift = ?
          AND role IN ('BCO1', 'BO1', 'BCO2', 'BO2')
      `)
      .bind(workDate, shift)
      .all();

    const logs = (
      Array.isArray(logResult.results)
        ? logResult.results
        : []
    ).map(convertRowToLog);

    const currentSourceLogIds = new Set(
      logs
        .map(log => normalizeText(log.id))
        .filter(Boolean)
    );

    const managedSourceLogIds = new Set([
      ...currentSourceLogIds,
      ...removedSourceLogIds
    ]);

    if (managedSourceLogIds.size === 0) {
      return {
        ok: true,
        skipped: true,
        workDate,
        shift,
        selectedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        manualProtectedCount: 0,
        priorityProtectedCount: 0
      };
    }

    const candidates = buildLimestoneSyncCandidates(logs);

    const candidateSourceKeys = new Set(
      candidates
        .map(candidate => normalizeText(candidate.sourceKey))
        .filter(Boolean)
    );

    const receiptDateEnd =
      addLimestoneSyncDateDays(
        workDate,
        1
      );

    const sourceLogIdList = [
      ...managedSourceLogIds
    ];

    const placeholders =
      sourceLogIdList
        .map(() => "?")
        .join(", ");

    /* =====================================================
      기존 기록 조회

      - 현재·삭제 업무일지에서 생성된 자동기록
      - 기준일과 다음 날의 수기·자동기록

      N/S 00:00~06:59 입고는 다음 날짜로 저장되므로
      다음 날까지 함께 확인한다.
    ====================================================== */

    const existingResult = await database
      .prepare(`
        SELECT *
        FROM limestone_receipts
        WHERE
          (
            source_type = 'shift_log'
            AND source_log_id IN (${placeholders})
          )
          OR
          (
            receipt_date >= ?
            AND receipt_date <= ?
            AND unit_no IN (1, 2)
          )
      `)
      .bind(
        ...sourceLogIdList,
        workDate,
        receiptDateEnd
      )
      .all();

    const existingRows =
      Array.isArray(existingResult.results)
        ? existingResult.results
        : [];

    const getSourceType = row =>
      normalizeText(
        row?.source_type
      ).toLowerCase();

    const createRowBusinessKey = row => [
      normalizeText(
        row?.receipt_date
      ),

      normalizeText(
        row?.receipt_time
      ),

      String(
        Number(
          row?.unit_no
        ) || ""
      ),

      Number(
        row?.quantity_ton
      ).toFixed(2)
    ].join("||");

    const getRolePriority = role =>
      Number(
        LIMESTONE_SYNC_ROLE_PRIORITY[
          normalizeLogRole(role)
        ] || 0
      );

    const rowsByBusinessKey =
      new Map();

    const autoRowBySourceKey =
      new Map();

    existingRows.forEach(row => {
      const businessKey =
        createRowBusinessKey(row);

      if (
        !rowsByBusinessKey.has(
          businessKey
        )
      ) {
        rowsByBusinessKey.set(
          businessKey,
          []
        );
      }

      rowsByBusinessKey
        .get(businessKey)
        .push(row);

      const sourceKey =
        normalizeText(
          row.source_key
        );

      if (
        getSourceType(row) ===
          "shift_log" &&
        sourceKey &&
        !autoRowBySourceKey.has(
          sourceKey
        )
      ) {
        autoRowBySourceKey.set(
          sourceKey,
          row
        );
      }
    });

    const isSameAutomaticRow = (
      row,
      candidate
    ) => (
      getSourceType(row) ===
        "shift_log" &&

      normalizeText(
        row.receipt_date
      ) ===
        candidate.receiptDate &&

      normalizeText(
        row.receipt_time
      ) ===
        candidate.receiptTime &&

      Number(
        row.unit_no
      ) ===
        candidate.unitNo &&

      Number(
        row.quantity_ton
      ).toFixed(2) ===
        Number(
          candidate.quantityTon
        ).toFixed(2) &&

      normalizeText(
        row.note
      ) ===
        candidate.note &&

      normalizeText(
        row.source_log_id
      ) ===
        candidate.sourceLogId &&

      normalizeText(
        row.source_entry_id
      ) ===
        candidate.sourceEntryId &&

      normalizeText(
        row.source_key
      ) ===
        candidate.sourceKey &&

      normalizeText(
        row.source_role
      ) ===
        candidate.sourceRole &&

      normalizeText(
        row.source_author
      ) ===
        candidate.sourceAuthor &&

      normalizeText(
        row.source_text
      ) ===
        candidate.sourceText
    );

    /* =====================================================
      D1 반영 문장

      삭제 → 수정 → 신규 순서로 실행하여
      source_key 중복 충돌을 방지한다.
    ====================================================== */

    const deleteStatements = [];
    const updateStatements = [];
    const insertStatements = [];

    const keptAutomaticIds =
      new Set();

    const queuedDeleteIds =
      new Set();

    const timestamp =
      new Date()
        .toISOString();

    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let manualProtectedCount = 0;
    let priorityProtectedCount = 0;

    const queueDelete = row => {
      const rowId =
        normalizeText(
          row?.id
        );

      if (
        !rowId ||
        getSourceType(row) !==
          "shift_log" ||
        queuedDeleteIds.has(
          rowId
        ) ||
        keptAutomaticIds.has(
          rowId
        )
      ) {
        return;
      }

      queuedDeleteIds.add(
        rowId
      );

      deleteStatements.push(
        database
          .prepare(`
            DELETE FROM limestone_receipts
            WHERE
              id = ?
              AND source_type = 'shift_log'
          `)
          .bind(
            rowId
          )
      );

      deletedCount += 1;
    };

    const queueUpdate = (
      row,
      candidate
    ) => {
      const rowId =
        normalizeText(
          row?.id
        );

      if (!rowId) {
        return;
      }

      keptAutomaticIds.add(
        rowId
      );

      if (
        isSameAutomaticRow(
          row,
          candidate
        )
      ) {
        return;
      }

      const authorId =
        candidate.sourceAuthorId ||
        normalizeEmployeeNo(
          user.employeeNo
        );

      const authorName =
        candidate.sourceAuthor ||
        normalizeText(
          user.name
        ) ||
        "업무일지 자동연동";

      const modifierId =
        normalizeEmployeeNo(
          user.employeeNo
        ) ||
        authorId;

      const modifierName =
        normalizeText(
          user.name
        ) ||
        authorName;

      updateStatements.push(
        database
          .prepare(`
            UPDATE limestone_receipts

            SET
              receipt_date = ?,
              receipt_time = ?,
              unit_no = ?,
              quantity_ton = ?,
              note = ?,

              source_type = 'shift_log',
              source_log_id = ?,
              source_entry_id = ?,
              source_key = ?,
              source_role = ?,
              source_author = ?,
              source_text = ?,

              updated_by_id = ?,
              updated_by_name = ?,
              updated_at = ?,

              revision =
                revision + 1

            WHERE
              id = ?
              AND source_type = 'shift_log'
          `)
          .bind(
            candidate.receiptDate,
            candidate.receiptTime,
            candidate.unitNo,
            candidate.quantityTon,
            candidate.note,

            candidate.sourceLogId,
            candidate.sourceEntryId,
            candidate.sourceKey,
            candidate.sourceRole,
            candidate.sourceAuthor,
            candidate.sourceText,

            modifierId,
            modifierName,
            timestamp,

            rowId
          )
      );

      updatedCount += 1;
    };

    const queueInsert = candidate => {
      const authorId =
        candidate.sourceAuthorId ||
        normalizeEmployeeNo(
          user.employeeNo
        );

      const authorName =
        candidate.sourceAuthor ||
        normalizeText(
          user.name
        ) ||
        "업무일지 자동연동";

      const modifierId =
        normalizeEmployeeNo(
          user.employeeNo
        ) ||
        authorId;

      const modifierName =
        normalizeText(
          user.name
        ) ||
        authorName;

      insertStatements.push(
        database
          .prepare(`
            INSERT INTO limestone_receipts (
              id,

              receipt_date,
              receipt_time,
              unit_no,
              quantity_ton,
              note,

              source_type,
              source_log_id,
              source_entry_id,
              source_key,
              source_role,
              source_author,
              source_text,

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

              'shift_log',
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
          `)
          .bind(
            crypto.randomUUID(),

            candidate.receiptDate,
            candidate.receiptTime,
            candidate.unitNo,
            candidate.quantityTon,
            candidate.note,

            candidate.sourceLogId,
            candidate.sourceEntryId,
            candidate.sourceKey,
            candidate.sourceRole,
            candidate.sourceAuthor,
            candidate.sourceText,

            authorId,
            authorName,
            modifierId,
            modifierName,

            timestamp,
            timestamp
          )
      );

      createdCount += 1;
    };

    /* =====================================================
      후보별 수기 보호·상위 보직 우선순위 적용
    ====================================================== */

    candidates.forEach(candidate => {
      const businessKey =
        createLimestoneSyncBusinessKey(
          candidate
        );

      const businessRows =
        rowsByBusinessKey.get(
          businessKey
        ) || [];

      const manualRows =
        businessRows.filter(
          row => {
            return (
              getSourceType(row) ===
              "manual"
            );
          }
        );

      const automaticRows =
        businessRows.filter(
          row => {
            return (
              getSourceType(row) ===
              "shift_log"
            );
          }
        );

      /*
        삭제된 업무일지 또는 현재 업무일지에서
        더 이상 존재하지 않는 항목의 자동기록은
        상위 보직 경쟁 대상으로 사용하지 않는다.
      */
      const validAutomaticRows =
        automaticRows
          .filter(row => {
            const sourceLogId =
              normalizeText(
                row.source_log_id
              );

            const sourceKey =
              normalizeText(
                row.source_key
              );

            if (
              removedSourceLogIds.has(
                sourceLogId
              )
            ) {
              return false;
            }

            if (
              currentSourceLogIds.has(
                sourceLogId
              )
            ) {
              return candidateSourceKeys.has(
                sourceKey
              );
            }

            return true;
          })
          .sort((
            firstRow,
            secondRow
          ) => {
            const priorityDifference =
              getRolePriority(
                secondRow.source_role
              ) -
              getRolePriority(
                firstRow.source_role
              );

            if (
              priorityDifference !== 0
            ) {
              return priorityDifference;
            }

            return String(
              secondRow.updated_at ||
              secondRow.created_at ||
              ""
            ).localeCompare(
              String(
                firstRow.updated_at ||
                firstRow.created_at ||
                ""
              )
            );
          });

      const validAutomaticIds =
        new Set(
          validAutomaticRows
            .map(row => {
              return normalizeText(
                row.id
              );
            })
            .filter(Boolean)
        );

      automaticRows.forEach(row => {
        const rowId =
          normalizeText(
            row.id
          );

        if (
          !validAutomaticIds.has(
            rowId
          )
        ) {
          queueDelete(
            row
          );
        }
      });

      const sameSourceRow =
        autoRowBySourceKey.get(
          candidate.sourceKey
        ) || null;

      /* ===================================================
        수기 기록 보호

        같은 실제 입고에 수기 기록이 있으면
        수기는 유지하고 자동기록만 제거한다.
      ==================================================== */

      if (
        manualRows.length > 0
      ) {
        manualProtectedCount += 1;

        automaticRows.forEach(
          queueDelete
        );

        if (
          sameSourceRow &&
          !automaticRows.some(
            row => {
              return (
                normalizeText(
                  row.id
                ) ===
                normalizeText(
                  sameSourceRow.id
                )
              );
            }
          )
        ) {
          queueDelete(
            sameSourceRow
          );
        }

        return;
      }

      const strongestRow =
        validAutomaticRows[0] ||
        null;

      const strongestPriority =
        strongestRow
          ? getRolePriority(
              strongestRow.source_role
            )
          : 0;

      const candidatePriority =
        getRolePriority(
          candidate.sourceRole
        );

      /* ===================================================
        기존 상위 보직 자동기록 보호

        BCO1이 있으면 BO1을 만들지 않고,
        BCO2가 있으면 BO2를 만들지 않는다.
      ==================================================== */

      if (
        strongestRow &&
        strongestPriority >
          candidatePriority
      ) {
        const strongestId =
          normalizeText(
            strongestRow.id
          );

        if (strongestId) {
          keptAutomaticIds.add(
            strongestId
          );
        }

        validAutomaticRows
          .slice(1)
          .forEach(
            queueDelete
          );

        if (
          sameSourceRow &&
          normalizeText(
            sameSourceRow.id
          ) !==
            strongestId
        ) {
          queueDelete(
            sameSourceRow
          );
        }

        priorityProtectedCount += 1;

        return;
      }

      /* ===================================================
        같은 원본 → 같은 실제 입고 → 신규 순서로 반영
      ==================================================== */

      const targetRow =
        sameSourceRow ||
        strongestRow ||
        null;

      if (targetRow) {
        queueUpdate(
          targetRow,
          candidate
        );

        const targetId =
          normalizeText(
            targetRow.id
          );

        automaticRows.forEach(row => {
          if (
            normalizeText(
              row.id
            ) !==
              targetId
          ) {
            queueDelete(
              row
            );
          }
        });

        return;
      }

      queueInsert(
        candidate
      );
    });

    /* =====================================================
      현재·삭제 업무일지의 오래된 자동기록 정리

      후보로 유지되지 않은 shift_log 기록만 삭제한다.
      manual 기록은 절대로 삭제하지 않는다.
    ====================================================== */

    existingRows.forEach(row => {
      const rowId =
        normalizeText(
          row.id
        );

      const sourceLogId =
        normalizeText(
          row.source_log_id
        );

      if (
        getSourceType(row) !==
          "shift_log" ||
        !managedSourceLogIds.has(
          sourceLogId
        ) ||
        !rowId ||
        keptAutomaticIds.has(
          rowId
        ) ||
        queuedDeleteIds.has(
          rowId
        )
      ) {
        return;
      }

      queueDelete(
        row
      );
    });

    const statements = [
      ...deleteStatements,
      ...updateStatements,
      ...insertStatements
    ];

    if (
      statements.length > 0
    ) {
      await database.batch(
        statements
      );
    }

    return {
      ok: true,
      skipped: false,

      workDate,
      shift,

      selectedCount:
        candidates.length,

      createdCount,
      updatedCount,
      deletedCount,

      manualProtectedCount,
      priorityProtectedCount
    };

  } catch (error) {
    console.error(
      "석회석 입고기록 자동 동기화 실패:",
      error
    );

    return {
      ok: false,
      skipped: false,

      workDate,
      shift,

      message:
        error instanceof Error
          ? error.message
          : "석회석 자동 동기화 오류"
    };
  }
}

/* =========================================================
  점검주기표 업무일지 자동완료

  처리:
  - 같은 날짜·근무의 모든 보직 업무일지를 다시 조회
  - 점검명과 업무내용의 핵심 단어·문구 유사도 비교
  - 예정·필요·미실시 문구는 완료에서 제외
  - 가장 유사한 업무내용 1건을 자동완료 근거로 사용
  - 완료 상태 API를 호출하여 생성·수정·해제
========================================================= */

const INSPECTION_AUTO_STATUS_PATH =
  "/api/inspection-schedule-status";

const INSPECTION_AUTO_MIN_SCORE =
  0.64;

const INSPECTION_AUTO_STOP_WORDS =
  new Set([
    "점검",
    "확인",
    "상태",
    "업무",
    "작업",
    "설비",
    "관련",
    "정기",
    "일일",
    "주간",
    "월간",
    "분기",
    "반기",
    "연간",
    "매일",
    "매주",
    "매월",
    "실시",
    "시행",
    "수행",
    "완료",
    "결과",
    "이상",
    "유무",
    "및",
    "또는",
    "대한",
    "the",
    "and",
    "or",
    "for",
    "with",
    "check",
    "inspection",
    "daily",
    "weekly",
    "monthly"
  ]);

const INSPECTION_AUTO_ACTION_PATTERN =
  /(?:점검|확인|검사|측정|시험|테스트|실시|시행|수행|완료|처리|조치|청소|세정|세척|flushing|flush|교체|보수|정비|체크|check|검교정|교정|이상\s*없|이상\s*무|양호|정상)/i;

const INSPECTION_AUTO_NEGATIVE_PATTERNS = [
  /미\s*(?:실시|수행|점검|완료|확인|처리)/i,

  /(?:점검|확인|검사|작업)?\s*(?:예정|계획|보류|미정)/i,

  /(?:추후|차후|다음\s*근무|익일)\s*(?:실시|진행|점검|확인|예정)?/i,

  /(?:실시|수행|점검|확인|처리)\s*(?:필요|요망)/i,

  /(?:요청|조치|교체|정비)\s*(?:필요|요망)/i,

  /(?:해야\s*(?:함|됨)|하지\s*못|못\s*함|불가)/i
];


/* =========================================================
  자동완료 비교 문자열 정리
========================================================= */

function normalizeInspectionAutoText(
  value
) {
  return normalizeText(
    value
  )
    .normalize(
      "NFKC"
    )
    .toLowerCase()
    .replace(
      /fire\s*extinguisher/g,
      " 소화기 "
    )
    .replace(
      /d\s*[\/.-]\s*m\b/g,
      " density meter "
    )
    .replace(
      /density\s*m(?:eter)?\b/g,
      " density meter "
    )
    .replace(
      /lime\s*slurry/g,
      " lime slurry "
    )
    .replace(
      /arm\s*[- ]?roll/g,
      " armroll "
    )
    .replace(
      /scrap\s*[- ]?box/g,
      " scrapbox "
    )
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function createInspectionAutoCompactText(
  value
) {
  return normalizeInspectionAutoText(
    value
  ).replace(
    /\s+/g,
    ""
  );
}


function getInspectionAutoTokens(
  value
) {
  return [
    ...new Set(
      normalizeInspectionAutoText(
        value
      )
        .split(
          " "
        )
        .map(
          token => {
            return token.trim();
          }
        )
        .filter(
          token => {
            return (
              token.length >=
                2 &&

              !/^\d+$/.test(
                token
              ) &&

              !INSPECTION_AUTO_STOP_WORDS.has(
                token
              )
            );
          }
        )
    )
  ];
}


/* =========================================================
  두 글자 묶음 유사도
========================================================= */

function createInspectionAutoBigrams(
  value
) {
  const compactText =
    createInspectionAutoCompactText(
      value
    );


  if (
    compactText.length <
      2
  ) {
    return [];
  }


  const bigrams =
    [];


  for (
    let index = 0;
    index <
      compactText.length -
      1;
    index += 1
  ) {
    bigrams.push(
      compactText.slice(
        index,
        index +
          2
      )
    );
  }


  return bigrams;
}


function calculateInspectionAutoDiceScore(
  firstValue,
  secondValue
) {
  const firstBigrams =
    createInspectionAutoBigrams(
      firstValue
    );


  const secondBigrams =
    createInspectionAutoBigrams(
      secondValue
    );


  if (
    firstBigrams.length ===
      0 ||
    secondBigrams.length ===
      0
  ) {
    return 0;
  }


  const secondCounts =
    new Map();


  secondBigrams.forEach(
    bigram => {
      secondCounts.set(
        bigram,

        (
          secondCounts.get(
            bigram
          ) ||
          0
        ) +
          1
      );
    }
  );


  let intersectionCount =
    0;


  firstBigrams.forEach(
    bigram => {
      const remainingCount =
        secondCounts.get(
          bigram
        ) ||
        0;


      if (
        remainingCount <
          1
      ) {
        return;
      }


      intersectionCount +=
        1;


      secondCounts.set(
        bigram,
        remainingCount -
          1
      );
    }
  );


  return (
    2 *
    intersectionCount
  ) /
  (
    firstBigrams.length +
    secondBigrams.length
  );
}


/* =========================================================
  실제 수행 문구인지 확인
========================================================= */

function hasInspectionAutoCompletionEvidence(
  sourceText
) {
  const text =
    normalizeText(
      sourceText
    );


  if (
    !text ||
    !INSPECTION_AUTO_ACTION_PATTERN.test(
      text
    )
  ) {
    return false;
  }


  return !INSPECTION_AUTO_NEGATIVE_PATTERNS.some(
    pattern => {
      return pattern.test(
        text
      );
    }
  );
}


/* =========================================================
  점검명과 업무내용 유사도
========================================================= */

function calculateInspectionAutoMatchScore(
  scheduleTitle,
  sourceText
) {
  if (
    !hasInspectionAutoCompletionEvidence(
      sourceText
    )
  ) {
    return 0;
  }


  const titleCompact =
    createInspectionAutoCompactText(
      scheduleTitle
    );


  const sourceCompact =
    createInspectionAutoCompactText(
      sourceText
    );


  if (
    !titleCompact ||
    !sourceCompact
  ) {
    return 0;
  }


  /*
    점검명이 문장 안에 그대로 있으면
    가장 확실한 완료 근거다.
  */
  if (
    titleCompact.length >=
      4 &&

    sourceCompact.includes(
      titleCompact
    )
  ) {
    return 1;
  }


  const titleTokens =
    getInspectionAutoTokens(
      scheduleTitle
    );


  const sourceTokens =
    new Set(
      getInspectionAutoTokens(
        sourceText
      )
    );


  const matchedTokens =
    titleTokens.filter(
      token => {
        return sourceTokens.has(
          token
        );
      }
    );


  const matchedCount =
    matchedTokens.length;


  const recall =
    titleTokens.length >
      0
      ? matchedCount /
        titleTokens.length
      : 0;


  const precision =
    sourceTokens.size >
      0
      ? matchedCount /
        sourceTokens.size
      : 0;


  let tokenScore =
    recall *
      0.82 +

    precision *
      0.18;


  /*
    소화기 점검처럼 핵심 명사가 하나인 경우
  */
  if (
    titleTokens.length ===
      1 &&

    matchedCount ===
      1
  ) {
    tokenScore =
      0.92;
  }


  /*
    핵심 단어가 여러 개면
    최소 두 단어가 일치해야 한다.
  */
  if (
    titleTokens.length >=
      2 &&

    matchedCount <
      2
  ) {
    tokenScore =
      0;
  }


  const diceScore =
    calculateInspectionAutoDiceScore(
      scheduleTitle,
      sourceText
    );


  return Math.max(
    tokenScore,
    diceScore
  );
}


/* =========================================================
  업무일지 내용 수집
========================================================= */

function collectInspectionAutoSourceEntries(
  log
) {
  const result =
    [];


  const usedKeys =
    new Set();


  const collections = [
    [
      "entries",
      log?.entries
    ],

    [
      "tmEntries",
      log?.tmEntries
    ],

    [
      "handoverEntries",
      log?.handoverEntries
    ],

    [
      "remarkEntries",
      log?.remarkEntries
    ]
  ];


  const appendText = (
    sourceText,
    collectionName,
    entry,
    entryIndex
  ) => {
    const lines =
      String(
        sourceText ||
        ""
      )
        .replace(
          /\r\n?/g,
          "\n"
        )
        .split(
          "\n"
        )
        .map(
          line => {
            return line.trim();
          }
        )
        .filter(
          Boolean
        );


    lines.forEach(
      (
        line,
        lineIndex
      ) => {
        const normalizedLine =
          normalizeInspectionAutoText(
            line
          );


        if (
          !normalizedLine
        ) {
          return;
        }


        const duplicateKey = [
          normalizeText(
            log?.id
          ),

          normalizedLine
        ].join(
          "||"
        );


        if (
          usedKeys.has(
            duplicateKey
          )
        ) {
          return;
        }


        usedKeys.add(
          duplicateKey
        );


        const entryId =
          normalizeText(
            entry?.id
          );


        const sourceEntryKey = [
          normalizeText(
            log?.id
          ),

          collectionName,

          entryId ||
            String(
              entryIndex
            ),

          String(
            lineIndex
          )
        ].join(
          "||"
        );


        result.push({
          sourceLogId:
            normalizeText(
              log?.id
            ),

          sourceEntryKey,

          sourceRole:
            normalizeLogRole(
              log?.role
            ),

          sourceAuthor:
            normalizeText(
              log?.author
            ),

          sourceAuthorId:
            normalizeEmployeeNo(
              log?.authorId
            ),

          sourceText:
            line.slice(
              0,
              1000
            ),

          sourceUpdatedAt:
            normalizeText(
              log?.updatedAt ||
              log?.createdAt
            )
        });
      }
    );
  };


  collections.forEach(
    (
      [
        collectionName,
        rawEntries
      ]
    ) => {
      (
        Array.isArray(
          rawEntries
        )
          ? rawEntries
          : []
      ).forEach(
        (
          rawEntry,
          entryIndex
        ) => {
          const entry =
            rawEntry &&
            typeof rawEntry ===
              "object" &&
            !Array.isArray(
              rawEntry
            )
              ? rawEntry
              : {
                  content:
                    String(
                      rawEntry ||
                      ""
                    )
                };


          const sourceType =
            normalizeText(
              entry?.source
            ).toLowerCase();


          /*
            이전 근무에서 자동으로 가져온 문구는
            현재 근무 완료 근거로 사용하지 않는다.
          */
          if (
            sourceType.includes(
              "previous-shift"
            ) ||

            normalizeText(
              entry?.inheritedFromDate
            )
          ) {
            return;
          }


          appendText(
            entry?.content ||
              entry?.text ||
              entry?.description ||
              "",

            collectionName,

            entry,

            entryIndex
          );
        }
      );
    }
  );


  /*
    구버전 단일 비고 문자열 호환
  */
  [
    [
      "note",
      log?.note
    ],

    [
      "remark",
      log?.remark
    ],

    [
      "remarks",
      log?.remarks
    ]
  ].forEach(
    (
      [
        fieldName,
        fieldValue
      ],
      fieldIndex
    ) => {
      if (
        typeof fieldValue !==
          "string"
      ) {
        return;
      }


      appendText(
        fieldValue,

        fieldName,

        {
          id:
            fieldName
        },

        fieldIndex
      );
    }
  );


  return result;
}


/* =========================================================
  클라이언트에서 전달된 실제 점검 목록 정리
========================================================= */

function normalizeInspectionAutoOccurrences(
  rawOccurrences,
  workDate,
  shift
) {
  if (
    !Array.isArray(
      rawOccurrences
    )
  ) {
    return null;
  }


  const uniqueOccurrences =
    new Map();


  rawOccurrences
    .slice(
      0,
      300
    )
    .forEach(
      rawOccurrence => {
        if (
          !rawOccurrence ||
          typeof rawOccurrence !==
            "object" ||
          Array.isArray(
            rawOccurrence
          )
        ) {
          return;
        }


        const scheduleId =
          normalizeText(
            rawOccurrence.scheduleId ||
            rawOccurrence.id
          );


        const scheduleTitle =
          normalizeText(
            rawOccurrence.scheduleTitle ||
            rawOccurrence.title
          );


        const dueDate =
          normalizeText(
            rawOccurrence.dueDate ||
            workDate
          );


        const occurrenceShift =
          rawOccurrence.shift ===
            null ||

          rawOccurrence.shift ===
            undefined ||

          normalizeText(
            rawOccurrence.shift
          ) ===
            ""
              ? ""
              : normalizeShift(
                  rawOccurrence.shift
                );


        if (
          !scheduleId ||
          !scheduleTitle ||

          dueDate !==
            workDate ||

          !isValidIsoDate(
            dueDate
          )
        ) {
          return;
        }


        if (
          occurrenceShift &&
          occurrenceShift !==
            shift
        ) {
          return;
        }


        const key = [
          scheduleId,
          dueDate,
          occurrenceShift
        ].join(
          "||"
        );


        if (
          uniqueOccurrences.has(
            key
          )
        ) {
          return;
        }


        uniqueOccurrences.set(
          key,
          {
            scheduleId:
              scheduleId.slice(
                0,
                120
              ),

            scheduleTitle:
              scheduleTitle.slice(
                0,
                300
              ),

            dueDate,

            shift:
              occurrenceShift
          }
        );
      }
    );


  return [
    ...uniqueOccurrences.values()
  ];
}


/* =========================================================
  일정별 가장 유사한 업무내용 선택
========================================================= */

function buildInspectionAutoMatches(
  occurrences,
  logs
) {
  const sourceEntries =
    (
      Array.isArray(
        logs
      )
        ? logs
        : []
    ).flatMap(
      log => {
        return collectInspectionAutoSourceEntries(
          log
        );
      }
    );


  return occurrences
    .map(
      occurrence => {
        let bestMatch =
          null;


        sourceEntries.forEach(
          sourceEntry => {
            const score =
              calculateInspectionAutoMatchScore(
                occurrence.scheduleTitle,
                sourceEntry.sourceText
              );


            if (
              score <
                INSPECTION_AUTO_MIN_SCORE ||

              (
                bestMatch &&
                score <=
                  bestMatch.score
              )
            ) {
              return;
            }


            bestMatch = {
              ...sourceEntry,

              score
            };
          }
        );


        if (
          !bestMatch
        ) {
          return null;
        }


        return {
          scheduleId:
            occurrence.scheduleId,

          scheduleTitle:
            occurrence.scheduleTitle,

          dueDate:
            occurrence.dueDate,

          shift:
            occurrence.shift,

          sourceLogId:
            bestMatch.sourceLogId,

          sourceEntryKey:
            bestMatch.sourceEntryKey,

          sourceRole:
            bestMatch.sourceRole,

          sourceAuthor:
            bestMatch.sourceAuthor,

          sourceAuthorId:
            bestMatch.sourceAuthorId,

          sourceText:
            bestMatch.sourceText,

          matchScore:
            Math.round(
              bestMatch.score *
              1000
            ) /
            1000
        };
      }
    )
    .filter(
      Boolean
    )
    .sort(
      (
        firstMatch,
        secondMatch
      ) => {
        return (
          secondMatch.matchScore -
          firstMatch.matchScore
        );
      }
    );
}


/* =========================================================
  완료 상태 API 호출
========================================================= */

async function postInspectionAutoStatusSync(
  context,
  payload
) {
  const endpoint =
    new URL(
      INSPECTION_AUTO_STATUS_PATH,
      context.request.url
    );


  const authorization =
    normalizeText(
      context.request.headers.get(
        "Authorization"
      )
    );


  const response =
    await fetch(
      endpoint.toString(),
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json; charset=utf-8",

          "Accept":
            "application/json",

          "Cache-Control":
            "no-store",

          ...(
            authorization
              ? {
                  Authorization:
                    authorization
                }
              : {}
          )
        },

        body:
          JSON.stringify(
            payload
          )
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
    !response.ok ||
    responseData?.ok !==
      true
  ) {
    return {
      ok:
        false,

      skipped:
        false,

      status:
        response.status,

      message:
        normalizeText(
          responseData?.message
        ) ||
        `점검 자동완료 동기화 요청 실패 (HTTP ${response.status})`
    };
  }


  return responseData;
}


/* =========================================================
  같은 날짜·근무 전체 재검사
========================================================= */

async function synchronizeInspectionSchedulesForShiftContext(
  context,
  options = {}
) {
  const database =
    context?.env?.DB;


  const workDate =
    normalizeText(
      options.workDate
    );


  const shift =
    normalizeShift(
      options.shift
    );


  const occurrences =
    normalizeInspectionAutoOccurrences(
      options.scheduleOccurrences,
      workDate,
      shift
    );


  /*
    null은 캘린더 목록을 아직 전달받지 못한 상태다.

    이때 기존 자동완료를 삭제하면 안 되므로
    동기화를 건너뛴다.
  */
  if (
    !database ||

    !isValidIsoDate(
      workDate
    ) ||

    !VALID_SHIFTS.has(
      shift
    ) ||

    occurrences ===
      null
  ) {
    return {
      ok:
        true,

      skipped:
        true,

      reason:
        occurrences ===
          null
          ? "schedule-not-ready"
          : "invalid-context",

      workDate,

      shift
    };
  }


  try {
    const logResult =
      await database
        .prepare(`
          SELECT
            *

          FROM shift_logs

          WHERE
            work_date = ?
            AND shift = ?
        `)
        .bind(
          workDate,
          shift
        )
        .all();


    const logs =
      (
        Array.isArray(
          logResult.results
        )
          ? logResult.results
          : []
      ).map(
        convertRowToLog
      );


    const currentSourceLogIds =
      logs
        .map(
          log => {
            return normalizeText(
              log?.id
            );
          }
        )
        .filter(
          Boolean
        );


    const removedSourceLogIds =
      (
        Array.isArray(
          options.removedSourceLogIds
        )
          ? options.removedSourceLogIds
          : []
      )
        .map(
          normalizeText
        )
        .filter(
          Boolean
        );


    const matches =
      buildInspectionAutoMatches(
        occurrences,
        logs
      );


    const syncResult =
      await postInspectionAutoStatusSync(
        context,
        {
          action:
            "sync-shift-log",

          workDate,

          shift,

          matches,

          managedSourceLogIds:
            currentSourceLogIds,

          removedSourceLogIds
        }
      );


    return {
      ...syncResult,

      workDate,

      shift,

      scheduleCount:
        occurrences.length,

      logCount:
        logs.length,

      detectedCount:
        matches.length
    };

  } catch (
    error
  ) {
    console.error(
      "점검주기표 업무일지 자동완료 실패:",
      error
    );


    return {
      ok:
        false,

      skipped:
        false,

      workDate,

      shift,

      message:
        error instanceof
          Error
          ? error.message
          : "점검주기표 자동완료 처리 중 오류가 발생했습니다."
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
  기존 업무일지 수정 가능 여부 최종본

  최고관리자:
  - 모든 업무일지 수정 가능

  일반 보직:
  - 작성자·로그인 보직과 관계없이
    임시저장 상태 수정 가능

  파트장 업무일지:
  - 파트장 계정이면 작성자와 관계없이
    임시저장·저장완료 상태 수정 가능

  결재요청·결재완료:
  - 기존 결재취소 절차 유지
========================================================= */

function canEditExistingLog(
  existingLog,
  user
) {
  if (
    !existingLog ||
    !user
  ) {
    return false;
  }


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


  /* =====================================================
    파트장 업무일지

    기존 작성자 사번은 비교하지 않는다.
  ====================================================== */

  if (
    logRole ===
      "파트장"
  ) {
    return (
      user.role ===
        "admin" &&

      [
        "임시저장",
        "저장완료"
      ].includes(
        status
      )
    );
  }


  /* =====================================================
    일반 보직 업무일지

    계정 권한이나 기존 작성자를 비교하지 않는다.
  ====================================================== */

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

/* =========================================================
  기존 업무일지 저장 규칙 최종본

  작성자가 다른 업무일지를 수정한 경우:
  - 최초 작성자 → originalAuthor에 보존
  - 현재 저장한 사용자 → author로 변경
  - lastModifiedBy에도 현재 사용자 기록

  적용:
  - 일반 보직 임시저장
  - 파트장 임시저장·저장완료

  최고관리자가 파트장 일지를 수정하는 경우:
  - 기존 파트장 작성자 유지
========================================================= */

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


  /*
    일반 보직 임시저장
  */
  const isEditableMemberDraft =
    isMemberLog &&

    existingStatus ===
      "임시저장";


  /*
    다른 파트장이 수정할 수 있는
    파트장 임시저장·저장완료 자료

    최고관리자는 기존 작성자를 유지하므로
    이 조건에서는 제외한다.
  */
  const isEditableLeaderDraft =
    isLeaderLog &&

    user.role ===
      "admin" &&

    [
      "임시저장",
      "저장완료"
    ].includes(
      existingStatus
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
          normalizeEmployeeNo(
            user.employeeNo
          )
      : (
          previousAuthorName &&
          previousAuthorName !==
            normalizeText(
              user.name
            )
        );


  const shouldChangeAuthor =
    isEditableMemberDraft ||
    isEditableLeaderDraft;


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


  /* =====================================================
    기존 최초 작성자 정보 유지
  ====================================================== */

  log.originalAuthor =
    existingLog.originalAuthor ||
    "";


  log.originalAuthorId =
    existingLog.originalAuthorId ||
    "";


  log.originalAuthorRole =
    existingLog.originalAuthorRole ||
    "";


  /* =====================================================
    작성자가 바뀌는 최초 시점에
    기존 작성자를 원 작성자로 보존
  ====================================================== */

  if (
    shouldChangeAuthor &&
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


  /* =====================================================
    현재 저장한 사람을 작성자로 변경

    일반 보직:
    - 로그인 권한과 관계없이 실제 저장자 적용

    파트장:
    - 파트장 계정이 수정한 경우 실제 저장자 적용
    - 최고관리자 수정은 기존 작성자 유지
  ====================================================== */

  if (
    shouldChangeAuthor
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


  /* =====================================================
    상태 유지 및 전환
  ====================================================== */

  if (
    isLeaderLog
  ) {
    /*
      파트장 업무일지는 일반 저장으로
      결재 상태를 변경하지 않는다.
    */
    log.status =
      existingStatus;

  } else if (
    isEditableMemberDraft
  ) {
    /*
      일반 보직 임시저장은
      임시저장 또는 결재요청으로 전환 가능
    */
    log.status =
      [
        "임시저장",
        "결재요청"
      ].includes(
        requestedStatus
      )
        ? requestedStatus
        : existingStatus;

  } else {
    log.status =
      existingStatus;
  }


  /* =====================================================
    최종 수정자 기록
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
  await attachShiftLogAttachments(
    context.env.DB,

    (
      Array.isArray(
        result.results
      )
        ? result.results
        : []
    ).map(
      convertRowToLog
    )
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


/* =====================================================
  요청 작업 구분
====================================================== */

const action =
  normalizeText(
    body.action ||
    "save"
  )
    .toLowerCase();


/* =====================================================
  기존 저장 업무일지 점검 자동완료 재검사

  업무일지를 다시 저장하지 않아도
  해당 날짜·근무의 모든 보직 일지를 조회하여
  점검명 유사 문구를 다시 판정한다.
====================================================== */

if (
  action ===
    "resync-inspection"
) {
  const workDate =
    normalizeText(
      body.workDate ||
      body.work_date
    );


  const shift =
    normalizeShift(
      body.shift
    );


  if (
    !isValidIsoDate(
      workDate
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "점검 자동완료 재검사 날짜를 확인해 주세요."
      },
      400
    );
  }


  if (
    !VALID_SHIFTS.has(
      shift
    )
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "점검 자동완료 재검사 근무를 확인해 주세요."
      },
      400
    );
  }


  const inspectionScheduleSync =
    await synchronizeInspectionSchedulesForShiftContext(
      context,
      {
        workDate,

        shift,

        scheduleOccurrences:
          body.inspectionScheduleOccurrences
      }
    );


  if (
    inspectionScheduleSync.ok ===
      false
  ) {
    console.error(
      "기존 업무일지 점검 자동완료 재검사 실패:",
      inspectionScheduleSync
    );
  }


  return jsonResponse(
    {
      ok:
        inspectionScheduleSync.ok !==
        false,

      resynced:
        inspectionScheduleSync.skipped !==
        true,

      workDate,

      shift,

      inspectionScheduleSync
    },

    inspectionScheduleSync.ok ===
      false
        ? 500
        : 200
  );
}


/* =====================================================
  일반 업무일지 저장·결재 작업
====================================================== */

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
          석회석 입고기록 즉시 자동 저장

          업무일지가 D1에 저장된 직후 실행한다.

          적용 상태:
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


        if (
          limestoneSync.ok !==
            true
        ) {
          console.error(
            "신규 업무일지 석회석 자동 동기화 실패:",
            limestoneSync
          );
        }

                /* =================================================
          점검주기표 업무일지 자동완료

          어떤 보직이든 점검 수행 문구가 있으면
          해당 날짜의 점검을 즉시 완료 처리한다.
        ================================================= */

        const inspectionAutoCompletionSync =
          await synchronizeInspectionScheduleAutoCompletionsForWorkDate(
            context,
            {
              workDate:
                savedLog.date,

              user
            }
          );


        if (
          inspectionAutoCompletionSync.ok !==
            true
        ) {
          console.error(
            "신규 업무일지 점검 자동완료 실패:",
            inspectionAutoCompletionSync
          );
        }

                /* =================================================
          점검주기표 자동완료

          같은 날짜·근무의 모든 보직 업무일지를
          다시 검사한다.
        ================================================= */

        const inspectionScheduleSync =
          await synchronizeInspectionSchedulesForShiftContext(
            context,
            {
              workDate:
                savedLog.date,

              shift:
                savedLog.shift,

              scheduleOccurrences:
                body.inspectionScheduleOccurrences
            }
          );


        if (
          inspectionScheduleSync.ok !==
            true
        ) {
          console.error(
            "신규 업무일지 점검 자동완료 실패:",
            inspectionScheduleSync
          );
        }

        return jsonResponse(
          {
            ok:
              true,

            created:
              true,

            log:
              savedLog,

            limestoneSync,

            inspectionScheduleSync,

            inspectionAutoCompletionSync
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
      석회석 입고기록 즉시 자동 저장

      임시저장·수정·결재요청·결재완료·결재취소
      모든 저장 작업 직후 석회석 기록을 재구성한다.

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


    if (
      limestoneSync.ok !==
        true
    ) {
      console.error(
        "업무일지 석회석 자동 동기화 실패:",
        limestoneSync
      );
    }

        /* =====================================================
      점검주기표 업무일지 자동완료

      임시저장·수정·결재요청·결재완료·결재취소
      모든 저장 작업 직후 날짜 전체를 재검사한다.
    ====================================================== */

    const inspectionAutoCompletionSync =
      await synchronizeInspectionScheduleAutoCompletionsForWorkDate(
        context,
        {
          workDate:
            savedLog.date,

          user
        }
      );


    if (
      inspectionAutoCompletionSync.ok !==
        true
    ) {
      console.error(
        "업무일지 점검 자동완료 실패:",
        inspectionAutoCompletionSync
      );
    }

        /* =====================================================
      점검주기표 자동완료 재검사

      적용:
      - 임시저장
      - 내용 수정
      - 결재요청
      - 결재완료
      - 결재취소
    ====================================================== */

    const inspectionScheduleSync =
      await synchronizeInspectionSchedulesForShiftContext(
        context,
        {
          workDate:
            savedLog.date,

          shift:
            savedLog.shift,

          scheduleOccurrences:
            body.inspectionScheduleOccurrences
        }
      );


    if (
      inspectionScheduleSync.ok !==
        true
    ) {
      console.error(
        "업무일지 점검 자동완료 실패:",
        inspectionScheduleSync
      );
    }

    return jsonResponse({
      ok:
        true,

      created:
        false,

      log:
        savedLog,

      limestoneSync,

      inspectionScheduleSync,

      inspectionAutoCompletionSync
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

          /*
      삭제 후 점검 자동완료를 재검사하기 위한
      해당 날짜·근무의 점검 목록
    */

    let deleteBody =
      {};


    try {
      const parsedDeleteBody =
        await context.request.json();


      if (
        parsedDeleteBody &&
        typeof parsedDeleteBody ===
          "object" &&
        !Array.isArray(
          parsedDeleteBody
        )
      ) {
        deleteBody =
          parsedDeleteBody;
      }

    } catch {
      deleteBody =
        {};
    }

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

          /* =====================================================
      업무일지 삭제 후 점검 자동완료 재계산

      삭제한 일지가 유일한 완료 근거였다면:
      - 자동 완료 삭제

      다른 보직 업무일지에 같은 점검 근거가 남아 있다면:
      - 자동 완료 유지
      - 남아 있는 업무일지를 새 출처로 적용

      수동 완료:
      - 항상 유지
    ====================================================== */

    const inspectionAutoCompletionSync =
      await synchronizeInspectionScheduleAutoCompletionsForWorkDate(
        context,
        {
          workDate:
            existingLog.date,

          user
        }
      );


    if (
      inspectionAutoCompletionSync.ok !==
        true
    ) {
      console.error(
        "업무일지 삭제 후 점검 자동완료 재계산 실패:",
        inspectionAutoCompletionSync
      );
    }

          /* =====================================================
      삭제 후 점검주기표 자동완료 재검사

      삭제된 업무일지의 문구로 자동완료된 기록은
      같은 날짜·근무의 다른 업무일지 근거를 다시 찾는다.

      다른 근거가 없으면 자동완료를 해제한다.
    ====================================================== */

    const inspectionScheduleSync =
      await synchronizeInspectionSchedulesForShiftContext(
        context,
        {
          workDate:
            existingLog.date,

          shift:
            existingLog.shift,

          scheduleOccurrences:
            deleteBody.inspectionScheduleOccurrences,

          removedSourceLogIds: [
            existingLog.id
          ]
        }
      );


    if (
      inspectionScheduleSync.ok !==
        true
    ) {
      console.error(
        "업무일지 삭제 후 점검 자동완료 실패:",
        inspectionScheduleSync
      );
    }

    return jsonResponse({
      ok:
        true,

      deletedId:
        id,

      limestoneSync,

      inspectionScheduleSync,

      inspectionAutoCompletionSync
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