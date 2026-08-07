"use strict";


/* =========================================================
  OIS 과거 LOG SHEET 조회 API

  저장 테이블:
  ois_legacy_logs

  GET:
  /api/ois-legacy-logs?date=2022-09-22

  또는:

  /api/ois-legacy-logs
    ?startDate=2022-09-01
    &endDate=2022-09-30

  선택 조건:
  role=TGO
  shift=DAY | AFTER | NIGHT

  중요:
  - OIS 원본 DAY / AFTER / NIGHT 그대로 반환
  - 2교대/3교대 변환은 화면단에서 수행
========================================================= */


const MAXIMUM_QUERY_DAYS =
  366;


/* =========================================================
  공통 응답
========================================================= */

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


/* =========================================================
  날짜 검사
========================================================= */

function isValidIsoDate(
  value
) {
  const normalizedValue =
    normalizeText(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalizedValue
    )
  ) {
    return false;
  }


  const parsedDate =
    new Date(
      `${normalizedValue}T00:00:00.000Z`
    );


  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return false;
  }


  return (
    parsedDate
      .toISOString()
      .slice(
        0,
        10
      ) ===
    normalizedValue
  );
}


/* =========================================================
  기간 일수
========================================================= */

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
  인증 토큰
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


/* =========================================================
  SHA-256
========================================================= */

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
  로그인 사용자 확인

  기존 GS Shift Log 세션을 그대로 사용한다.
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
            success:
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
            success:
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

          user.name,
          user.role,
          user.is_active

        FROM shift_log_sessions
          AS session

        INNER JOIN users
          AS user

          ON user.employee_no =
             session.employee_no

        WHERE session.token_hash = ?

        LIMIT 1
      `)
      .bind(
        tokenHash
      )
      .first();


  if (
    !session ||
    Number(
      session.is_active
    ) !==
      1
  ) {
    return {
      error:
        jsonResponse(
          {
            success:
              false,

            message:
              "로그인 세션을 확인할 수 없습니다."
          },
          401
        )
    };
  }


  const expiresAt =
    new Date(
      session.expires_at ||
      0
    );


  if (
    Number.isNaN(
      expiresAt.getTime()
    ) ||
    expiresAt <=
      new Date()
  ) {
    return {
      error:
        jsonResponse(
          {
            success:
              false,

            message:
              "로그인 세션이 만료되었습니다."
          },
          401
        )
    };
  }


  return {
    user: {
      employeeNo:
        normalizeText(
          session.employee_no
        ),

      name:
        normalizeText(
          session.name
        ),

      role:
        normalizeText(
          session.role
        )
    }
  };
}


/* =========================================================
  원본 JSON 읽기
========================================================= */

function parseOriginalJson(
  value
) {
  const text =
    normalizeText(
      value
    );


  if (
    !text
  ) {
    return {};
  }


  try {
    const parsed =
      JSON.parse(
        text
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

  } catch {
    return {};
  }
}


/* =========================================================
  DB 행 → API 응답
========================================================= */

function convertOisLegacyLogRow(
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

    workDate:
      normalizeText(
        row.work_date
      ),

    role:
      normalizeText(
        row.role
      )
        .toUpperCase(),

    /*
      OIS 원본 근무

      DAY
      AFTER
      NIGHT
    */
    originalShift:
      normalizeText(
        row.original_shift
      )
        .toUpperCase(),

    worker:
      normalizeText(
        row.worker
      ),

    content:
      String(
        row.content ||
        ""
      )
        .replace(
          /\r\n?/g,
          "\n"
        )
        .trim(),

    hasContent:
      Number(
        row.has_content
      ) ===
        1,

    workerApproval:
      normalizeText(
        row.worker_approval
      ),

    partApproval:
      normalizeText(
        row.part_approval
      ),

    approvalState:
      normalizeText(
        row.approval_state
      ),

    oisState:
      normalizeText(
        row.ois_state
      ),

    sheetCode:
      normalizeText(
        row.sheet_code
      ),

    oisRequestId:
      normalizeText(
        row.ois_request_id
      ),

    collectedAt:
      normalizeText(
        row.collected_at
      ),

    original:
      parseOriginalJson(
        row.original_json
      ),

    createdAt:
      normalizeText(
        row.created_at
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      ),

    source:
      "ois-legacy"
  };
}


/* =========================================================
  날짜별 교대 사용 흔적 요약

  자동 확정 용도가 아니라 참고값이다.

  THREE_SHIFT:
  AFTER 업무내용 존재

  TWO_SHIFT:
  AFTER 업무내용 없음
  + DAY 내용 존재
  + NIGHT 내용 존재

  UNKNOWN:
  그 외
========================================================= */

function createDateShiftSummaries(
  items
) {
  const dateMap =
    new Map();


  (
    Array.isArray(
      items
    )
      ? items
      : []
  )
    .forEach(
      item => {
        const workDate =
          normalizeText(
            item.workDate
          );


        if (
          !workDate
        ) {
          return;
        }


        if (
          !dateMap.has(
            workDate
          )
        ) {
          dateMap.set(
            workDate,
            {
              workDate,

              dayContentCount:
                0,

              afterContentCount:
                0,

              nightContentCount:
                0
            }
          );
        }


        if (
          !item.hasContent
        ) {
          return;
        }


        const summary =
          dateMap.get(
            workDate
          );


        if (
          item.originalShift ===
            "DAY"
        ) {
          summary.dayContentCount +=
            1;
        }


        if (
          item.originalShift ===
            "AFTER"
        ) {
          summary.afterContentCount +=
            1;
        }


        if (
          item.originalShift ===
            "NIGHT"
        ) {
          summary.nightContentCount +=
            1;
        }
      }
    );


  return [
    ...dateMap.values()
  ]
    .map(
      summary => {
        let workSystemHint =
          "UNKNOWN";


        if (
          summary.afterContentCount >
            0
        ) {
          workSystemHint =
            "THREE_SHIFT";

        } else if (
          summary.dayContentCount >
            0 &&
          summary.nightContentCount >
            0
        ) {
          workSystemHint =
            "TWO_SHIFT";
        }


        return {
          ...summary,

          workSystemHint
        };
      }
    )
    .sort(
      (
        first,
        second
      ) => {
        return first
          .workDate
          .localeCompare(
            second.workDate
          );
      }
    );
}


/* =========================================================
  GET
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
          success:
            false,

          message:
            "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      );
    }


    const authentication =
      await getAuthenticatedUser(
        context
      );


    if (
      authentication.error
    ) {
      return authentication.error;
    }


    const requestUrl =
      new URL(
        context.request.url
      );


    /*
      단일 날짜

      date=2022-09-22
    */

    const singleDate =
      normalizeText(
        requestUrl.searchParams.get(
          "date"
        )
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


    if (
      singleDate
    ) {
      startDate =
        singleDate;


      endDate =
        singleDate;
    }


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
          success:
            false,

          message:
            "조회 시작일과 종료일을 확인해 주세요."
        },
        400
      );
    }


    const dayCount =
      getDateRangeDayCount(
        startDate,
        endDate
      );


    if (
      dayCount <
        1
    ) {
      return jsonResponse(
        {
          success:
            false,

          message:
            "시작일은 종료일보다 늦을 수 없습니다."
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
          success:
            false,

          message:
            `OIS 과거 업무일지는 한 번에 최대 ${MAXIMUM_QUERY_DAYS}일까지 조회할 수 있습니다.`
        },
        400
      );
    }


    /* =====================================================
      선택 보직
    ====================================================== */

    const requestedRole =
      normalizeText(
        requestUrl.searchParams.get(
          "role"
        )
      )
        .toUpperCase();


    const allowedRoles = [
      "TGO",
      "BCO1",
      "BCO2",
      "TO",
      "BO1",
      "BO2"
    ];


    if (
      requestedRole &&
      !allowedRoles.includes(
        requestedRole
      )
    ) {
      return jsonResponse(
        {
          success:
            false,

          message:
            "OIS 업무일지 보직 조건을 확인해 주세요."
        },
        400
      );
    }


    /* =====================================================
      선택 근무
    ====================================================== */

    const requestedShift =
      normalizeText(
        requestUrl.searchParams.get(
          "shift"
        )
      )
        .toUpperCase();


    const allowedShifts = [
      "DAY",
      "AFTER",
      "NIGHT"
    ];


    if (
      requestedShift &&
      !allowedShifts.includes(
        requestedShift
      )
    ) {
      return jsonResponse(
        {
          success:
            false,

          message:
            "OIS 업무일지 근무 조건을 확인해 주세요."
        },
        400
      );
    }


    /* =====================================================
      SQL 조건
    ====================================================== */

    const whereConditions = [
      "work_date >= ?",
      "work_date <= ?"
    ];


    const bindValues = [
      startDate,
      endDate
    ];


    if (
      requestedRole
    ) {
      whereConditions.push(
        "role = ?"
      );


      bindValues.push(
        requestedRole
      );
    }


    if (
      requestedShift
    ) {
      whereConditions.push(
        "original_shift = ?"
      );


      bindValues.push(
        requestedShift
      );
    }


    const queryResult =
      await context.env.DB
        .prepare(`
          SELECT
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

          FROM ois_legacy_logs

          WHERE
            ${whereConditions.join(
              "\nAND "
            )}

          ORDER BY
            work_date DESC,

            CASE original_shift
              WHEN 'DAY'
                THEN 1
              WHEN 'AFTER'
                THEN 2
              WHEN 'NIGHT'
                THEN 3
              ELSE 99
            END ASC,

            CASE role
              WHEN 'TGO'
                THEN 1
              WHEN 'BCO1'
                THEN 2
              WHEN 'BCO2'
                THEN 3
              WHEN 'TO'
                THEN 4
              WHEN 'BO1'
                THEN 5
              WHEN 'BO2'
                THEN 6
              ELSE 99
            END ASC
        `)
        .bind(
          ...bindValues
        )
        .all();


    const items =
      (
        Array.isArray(
          queryResult.results
        )
          ? queryResult.results
          : []
      )
        .map(
          convertOisLegacyLogRow
        )
        .filter(
          Boolean
        );


    const contentItems =
      items.filter(
        item => {
          return item.hasContent;
        }
      );


    const dateSummaries =
      createDateShiftSummaries(
        items
      );


    return jsonResponse({
      success:
        true,

      range: {
        startDate,
        endDate,
        dayCount
      },

      filter: {
        role:
          requestedRole,

        shift:
          requestedShift
      },

      summary: {
        totalCount:
          items.length,

        contentCount:
          contentItems.length,

        emptyCount:
          items.length -
          contentItems.length,

        dayContentCount:
          contentItems.filter(
            item => {
              return (
                item.originalShift ===
                "DAY"
              );
            }
          ).length,

        afterContentCount:
          contentItems.filter(
            item => {
              return (
                item.originalShift ===
                "AFTER"
              );
            }
          ).length,

        nightContentCount:
          contentItems.filter(
            item => {
              return (
                item.originalShift ===
                "NIGHT"
              );
            }
          ).length
      },

      dateSummaries,

      items
    });

  } catch (
    error
  ) {
    console.error(
      "OIS 과거 업무일지 조회 오류:",
      error
    );


    return jsonResponse(
      {
        success:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "OIS 과거 업무일지를 조회하지 못했습니다."
      },
      500
    );
  }
}